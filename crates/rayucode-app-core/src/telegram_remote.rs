//! Profile-local settings for the daemon's interactive Telegram transport.

mod approvals;
pub(crate) mod media;
pub mod uninstall;

use std::fs::{File, OpenOptions};
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use rayucode_base::telegram::remote::{Mode, Transport};
use serde::{Deserialize, Serialize};

pub(crate) use approvals::{
    authorize_tool, interact, interaction_definitions, is_remote, is_ticket, remote_tool_allowed,
    scope, take_ticket, ticket,
};

pub(crate) const DAEMON_CAPABILITY: &str = "telegram_remote";

pub async fn require_daemon() -> Result<()> {
    anyhow::ensure!(
        !crate::server::socket_path_is_custom(),
        "Telegram remote runs on the profile's shared daemon socket."
    );
    let capabilities = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let mut client = crate::server::Client::connect().await?;
        client.capabilities().await
    })
    .await
    .context("Timed out checking the Rayu daemon")?
    .context("Start the profile's shared daemon before pairing Telegram")?;
    anyhow::ensure!(
        capabilities
            .is_some_and(|capabilities| capabilities.iter().any(|cap| cap == DAEMON_CAPABILITY)),
        "The shared daemon needs a Rayu build with Telegram support. Update it and retry pairing."
    );
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Link {
    pub generation: uuid::Uuid,
    pub username: String,
    pub mode: Mode,
    pub owner: Option<i64>,
    pub pending: Option<Pending>,
    #[serde(default)]
    pub selected: Option<String>,
    #[serde(default)]
    pub pending_until: Option<i64>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Pending {
    code: String,
    expires: i64,
}

impl Link {
    pub fn new(username: String, mode: Mode) -> Self {
        Self {
            generation: uuid::Uuid::new_v4(),
            username,
            mode,
            owner: None,
            pending: None,
            selected: None,
            pending_until: Some(chrono::Utc::now().timestamp() + 600),
        }
    }

    pub fn pending_bot(mut self) -> (Self, String) {
        use base64::Engine;
        let code =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(rand::random::<[u8; 16]>());
        self.pending = Some(Pending {
            code: code.clone(),
            expires: chrono::Utc::now().timestamp() + 600,
        });
        (self, code)
    }

    pub fn accepts_code(&self, code: &str) -> bool {
        self.pending.as_ref().is_some_and(|pending| {
            pending.expires >= chrono::Utc::now().timestamp()
                && pending.code.len() == code.len()
                && pending
                    .code
                    .bytes()
                    .zip(code.bytes())
                    .fold(0, |diff, (a, b)| diff | (a ^ b))
                    == 0
        })
    }

    pub(crate) fn expired(&self) -> bool {
        self.owner.is_none()
            && self
                .pending_until
                .is_some_and(|until| until < chrono::Utc::now().timestamp())
    }

    pub(crate) fn active_account(&self) -> bool {
        match self.mode {
            Mode::Hosted { account } => {
                crate::rayu::read_session().is_some_and(|session| session.user.id == account)
            }
            Mode::BotFather { .. } => true,
        }
    }

    pub fn status(&self) -> &'static str {
        if !self.active_account() {
            "Rayu account signed out"
        } else if self.owner.is_some() {
            "Linked"
        } else if self.expired() {
            "Pairing expired"
        } else {
            "Waiting for pairing"
        }
    }
}

fn path() -> Result<PathBuf> {
    Ok(crate::storage::rayu_dir()?.join("telegram-remote.json"))
}

pub fn settings_path() -> Result<PathBuf> {
    path()
}

/// Encode `data` into a scannable ISO QR code SVG path (`M x y h w v 1 h -w z`)
/// with a 2-module quiet zone around the matrix.
pub fn qr_svg_path(data: &str) -> Option<(usize, String)> {
    use qrcode::{Color, QrCode};
    let code = QrCode::new(data.as_bytes()).ok()?;
    let width = code.width();
    const QUIET: usize = 2;
    let total = width + QUIET * 2;
    let mut d = String::with_capacity(width * width * 3);
    for y in 0..width {
        let mut x = 0;
        while x < width {
            if code[(x, y)] == Color::Dark {
                let start = x;
                while x < width && code[(x, y)] == Color::Dark {
                    x += 1;
                }
                let run = x - start;
                use std::fmt::Write;
                let _ = write!(
                    d,
                    "M{} {}h{}v1h-{}z",
                    start + QUIET,
                    y + QUIET,
                    run,
                    run
                );
            } else {
                x += 1;
            }
        }
    }
    Some((total, d))
}

pub fn load() -> Result<Option<Link>> {
    let path = path()?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(
            serde_json::from_slice(&bytes).context("Invalid Telegram remote settings")?,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn replace(expected: Option<uuid::Uuid>, link: Option<&Link>) -> Result<bool> {
    let path = path()?;
    let parent = path
        .parent()
        .context("Missing Telegram settings directory")?;
    crate::storage::ensure_dir(parent)?;
    let lock = file_lock("telegram-remote.settings.lock")?;
    lock.lock()?;
    if load()?.map(|current| current.generation) != expected {
        return Ok(false);
    }
    if let Some(link) = link {
        crate::storage::write_json_secret(&path, link)?;
    } else if expected.is_some() {
        std::fs::remove_file(&path)?;
    }
    Ok(true)
}

pub(crate) fn file_lock(name: &str) -> Result<File> {
    let path = crate::storage::rayu_dir()?.join(name);
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

pub(crate) fn claim_polling() -> Result<Option<File>> {
    let lock = file_lock("telegram-remote.poll.lock")?;
    match lock.try_lock() {
        Ok(()) => Ok(Some(lock)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub(crate) struct Cursor {
    generation: uuid::Uuid,
    pub after: i64,
    #[serde(default)]
    last_update_at: Option<i64>,
}

impl Cursor {
    fn path() -> Result<PathBuf> {
        Ok(crate::storage::rayu_dir()?.join("telegram-remote.cursor.json"))
    }

    pub(crate) fn load(link: &Link) -> Result<Self> {
        let path = Self::path()?;
        if path.try_exists()? {
            let mut cursor: Self = crate::storage::read_json(&path)?;
            if cursor.generation == link.generation {
                // Older cursors recorded only the offset. Use the file timestamp
                // until a newly received update writes a timestamp explicitly.
                if cursor.last_update_at.is_none() && cursor.after != 0 {
                    cursor.last_update_at = path
                        .metadata()
                        .ok()
                        .and_then(|metadata| metadata.modified().ok())
                        .map(|modified| {
                            chrono::DateTime::<chrono::Utc>::from(modified).timestamp()
                        });
                }
                return Ok(cursor);
            }
        }
        Ok(Self {
            generation: link.generation,
            ..Self::default()
        })
    }

    pub(crate) fn for_poll(mut self, mode: &Mode, now: i64) -> Self {
        // Telegram retains updates for at most a day and can choose a new
        // random ID after a week. Clear the old offset between those limits.
        const BOT_CURSOR_IDLE_SECS: i64 = 5 * 24 * 60 * 60;
        if matches!(mode, Mode::BotFather { .. })
            && self
                .last_update_at
                .is_none_or(|last| now.saturating_sub(last) >= BOT_CURSOR_IDLE_SECS)
        {
            self.after = 0;
            self.last_update_at = None;
        }
        self
    }

    pub(crate) fn advance(&mut self, id: i64) -> Result<()> {
        let next = Self {
            generation: self.generation,
            after: id,
            last_update_at: Some(chrono::Utc::now().timestamp()),
        };
        crate::storage::write_json_secret(&Self::path()?, &next)?;
        *self = next;
        Ok(())
    }
}

pub fn claim_setup() -> Result<File> {
    let lock = file_lock("telegram-remote.setup.lock")?;
    lock.try_lock()
        .context("Another Telegram setup or disconnect is active")?;
    Ok(lock)
}

pub async fn hosted_pairing(replace_existing: bool) -> Result<(Link, String)> {
    let (link, url, _code) = hosted_pairing_with_code(replace_existing).await?;
    Ok((link, url))
}

pub async fn hosted_pairing_with_code(replace_existing: bool) -> Result<(Link, String, String)> {
    let _setup = claim_setup()?;
    let existing_local = load()?;
    if existing_local.is_some() && !replace_existing {
        bail!("Run rayu telegram disconnect before pairing another bot.");
    }
    let account = crate::rayu::read_session()
        .context("Sign in locally with rayu login rayu before pairing the hosted bot.")?
        .user
        .id;
    let transport = Transport::new(Mode::Hosted { account })?;
    if transport.link().await?.linked {
        if !replace_existing {
            bail!(
                "This Rayu account already has a Telegram link. Run rayu telegram link --replace-existing to move it to this host."
            );
        }
        transport.unlink().await?;
    }
    let pairing = transport.pair().await?;
    let username = pairing
        .bot_username
        .context("The hosted Telegram bot is unavailable")?;
    let link = Link::new(username, transport.mode);
    let url = rayucode_base::telegram::remote::pairing_url(&link.username, &pairing.code)?;
    let expected = existing_local.map(|current| current.generation);
    if !replace(expected, Some(&link))? {
        bail!("Another Telegram setup is active");
    }
    Ok((link, url, pairing.code))
}

/// Validate a BotFather token against Telegram's `getMe` and `getWebhookInfo`,
/// register slash commands, and persist either a direct link (when `allowed_chat_id`
/// is supplied) or a 10-minute `/start <code>` pairing session.
pub async fn botfather_pairing(
    token: &str,
    allowed_chat_id: Option<i64>,
    replace_existing: bool,
) -> Result<(Link, Option<(String, String)>)> {
    let _setup = claim_setup()?;
    let existing_local = load()?;
    if existing_local.is_some() && !replace_existing {
        bail!(
            "A Telegram bot is already configured on this host. Disconnect it first or replace the existing link."
        );
    }
    let trimmed = token.trim();
    let bot_id =
        rayucode_base::telegram::remote::bot_id(trimmed).context("Invalid BotFather token")?;
    validate_bot(bot_id)?;
    if let Some(chat_id) = allowed_chat_id
        && chat_id <= 0
    {
        bail!("Allowed Telegram chat ID must be a positive private chat ID.");
    }
    let transport = Transport::new(Mode::BotFather {
        token: trimmed.to_owned(),
        bot_id,
    })?;
    let bot = transport.get_bot().await?;
    anyhow::ensure!(bot.id == bot_id, "BotFather returned a different bot ID");
    transport.check_polling().await?;
    if let Err(error) = transport.register_commands().await {
        crate::logging::warn(&format!("Telegram command menu: {error}"));
    }
    if let Some(existing) = &existing_local
        && matches!(existing.mode, Mode::Hosted { .. })
        && let Ok(hosted) = Transport::new(existing.mode.clone())
    {
        let _ = hosted.unlink().await;
    }
    let expected = existing_local.map(|current| current.generation);
    if let Some(chat_id) = allowed_chat_id {
        let mut link = Link::new(bot.username, transport.mode.clone());
        link.owner = Some(chat_id);
        link.pending = None;
        link.pending_until = None;
        if !replace(expected, Some(&link))? {
            bail!("Another Telegram setup is active");
        }
        if let Err(error) = transport
            .send(
                chat_id,
                "Rayu is linked. Use /sessions to choose a session.",
                None,
            )
            .await
        {
            crate::logging::warn(&format!(
                "Telegram initial welcome message skipped (open the bot in Telegram and tap Start if needed): {error}"
            ));
        }
        Ok((link, None))
    } else {
        let (link, code) = Link::new(bot.username, transport.mode).pending_bot();
        let url = rayucode_base::telegram::remote::pairing_url(&link.username, &code)?;
        if !replace(expected, Some(&link))? {
            bail!("Another Telegram setup is active");
        }
        Ok((link, Some((url, code))))
    }
}

pub fn disconnect_local(link: &Link) -> Result<()> {
    let _setup = claim_setup()?;
    if !replace(Some(link.generation), None)? {
        bail!("Telegram settings changed. Check rayu telegram status.");
    }
    Ok(())
}

pub fn select_session(session_id: &str) -> Result<Link> {
    let trimmed = session_id.trim();
    anyhow::ensure!(
        !trimmed.is_empty()
            && trimmed.len() <= 128
            && trimmed
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-')),
        "Invalid session ID `{trimmed}`"
    );
    let _setup = claim_setup()?;
    let mut link = load()?.context("Telegram is not currently configured on this host.")?;
    let expected = link.generation;
    link.selected = Some(trimmed.to_owned());
    if !replace(Some(expected), Some(&link))? {
        bail!("Telegram settings changed. Retry selecting the session.");
    }
    Ok(link)
}

pub async fn send_ping() -> Result<(String, i64, i64)> {
    let link = load()?.context("Telegram is not currently linked on this host.")?;
    anyhow::ensure!(
        link.active_account(),
        "Sign in with the linked Rayu account before sending a Telegram ping."
    );
    let chat_id = link
        .owner
        .context("Telegram pairing is still pending. Complete pairing in Telegram first.")?;
    let transport = Transport::new(link.mode.clone())?;
    let session_note = link
        .selected
        .as_deref()
        .map(|id| format!("\nDriving session: {id}"))
        .unwrap_or_default();
    let text = format!(
        "RayuCode host ping OK · @{}{session_note}",
        link.username
    );
    let message_id = transport.send(chat_id, &text, None).await?;
    Ok((link.username, chat_id, message_id))
}

pub fn validate_bot(bot_id: i64) -> Result<()> {
    let safety = &crate::config::config().safety;
    if safety.telegram_reply_enabled
        && safety.telegram_bot_token.as_deref().and_then(rayu_bot_id) == Some(bot_id)
    {
        bail!(
            "This bot is already used for ambient Telegram replies. Use a dedicated BotFather bot or disable ambient replies."
        );
    }
    Ok(())
}

fn rayu_bot_id(token: &str) -> Option<i64> {
    token.split_once(':')?.0.parse().ok()
}

pub async fn disconnect(link: &Link) -> Result<()> {
    let _setup = claim_setup()?;
    if !load()?.is_some_and(|current| current.generation == link.generation) {
        bail!("Telegram settings changed. Check rayu telegram status.");
    }
    if let Mode::Hosted { .. } = link.mode {
        Transport::new(link.mode.clone())?.unlink().await?;
    }
    if !replace(Some(link.generation), None)? {
        bail!("Telegram settings changed. Check rayu telegram status.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_botfather_cursor_can_accept_a_new_sequence() {
        let direct = Mode::BotFather {
            token: String::new(),
            bot_id: 123,
        };
        let hosted = Mode::Hosted { account: 42 };
        let cursor = Cursor {
            generation: uuid::Uuid::new_v4(),
            after: 800_000,
            last_update_at: Some(10),
        };
        let new_poll = 10 + 5 * 24 * 60 * 60;
        assert_eq!(
            cursor.clone().for_poll(&direct, new_poll - 1).after,
            800_000
        );
        let reset = cursor.clone().for_poll(&direct, new_poll);
        assert_eq!(reset.after, 0);
        assert_eq!(reset.generation, cursor.generation);
        assert_eq!(cursor.for_poll(&hosted, new_poll).after, 800_000);
    }
}
