//! Authenticated transports for interactive Telegram remote control.

use std::time::Duration;

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::rayu;

const TELEGRAM: &str = "https://api.telegram.org";
const MAX_IMAGE: usize = 10 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum Mode {
    Hosted { account: i64 },
    BotFather { token: String, bot_id: i64 },
}

pub struct Transport {
    pub mode: Mode,
    client: reqwest::Client,
    bot_origin: String,
}

#[derive(Deserialize)]
pub struct Bot {
    pub id: i64,
    pub username: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub code: String,
    pub bot_username: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub linked: bool,
    pub chat_id: Option<String>,
}

#[derive(Deserialize)]
struct HostedBatch {
    linked: bool,
    updates: Vec<Delivery>,
}

#[derive(Deserialize)]
pub struct Delivery {
    pub id: i64,
    #[serde(deserialize_with = "decode_update")]
    pub update: Option<Update>,
}

fn decode_update<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Update>, D::Error> {
    let payload = Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(payload).ok())
}

#[derive(Deserialize)]
pub struct Update {
    pub message: Option<Message>,
    pub callback_query: Option<Callback>,
}

#[derive(Deserialize)]
pub struct Message {
    pub message_id: i64,
    pub text: Option<String>,
    pub caption: Option<String>,
    pub chat: Chat,
    pub from: Option<User>,
    pub media_group_id: Option<String>,
    #[serde(default)]
    pub photo: Vec<Photo>,
    pub document: Option<Photo>,
}

#[derive(Deserialize)]
pub struct Photo {
    pub file_id: String,
    pub file_size: Option<usize>,
    pub mime_type: Option<String>,
}

#[derive(Deserialize)]
pub struct Chat {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

#[derive(Deserialize)]
pub struct User {
    pub id: i64,
    #[serde(default)]
    pub is_bot: bool,
}

#[derive(Deserialize)]
pub struct Callback {
    pub id: String,
    pub from: User,
    pub message: Option<Message>,
    pub data: Option<String>,
}

impl Chat {
    pub fn admits(&self, user: Option<&User>, owner: i64) -> bool {
        self.kind.as_deref() == Some("private")
            && self.id > 0
            && self.id == owner
            && user.is_some_and(|user| !user.is_bot && user.id == owner)
    }
}

#[derive(Debug)]
pub struct PollFailure {
    pub status: u16,
    pub retry_after: Option<u64>,
}

impl std::fmt::Display for PollFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Telegram request failed (HTTP {})", self.status)
    }
}

impl std::error::Error for PollFailure {}

#[derive(Deserialize)]
struct Envelope<T> {
    result: Option<T>,
    ok: bool,
    parameters: Option<RetryParameters>,
}

#[derive(Deserialize)]
struct RetryParameters {
    retry_after: Option<u64>,
}

pub fn bot_id(token: &str) -> Option<i64> {
    let (id, secret) = token.split_once(':')?;
    let id = id.parse::<i64>().ok()?;
    (id > 0
        && (20..=128).contains(&secret.len())
        && secret
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'))
    .then_some(id)
}

pub fn pairing_url(username: &str, code: &str) -> Result<String> {
    fn safe(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    }
    if !safe(username) || !safe(code) {
        bail!("Invalid Telegram pairing link");
    }
    Ok(format!("https://t.me/{username}?start={code}"))
}

impl Transport {
    pub fn new(mode: Mode) -> Result<Self> {
        if let Mode::BotFather {
            token,
            bot_id: expected,
        } = &mode
            && bot_id(token) != Some(*expected)
        {
            bail!("Invalid BotFather token");
        }
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(35))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            mode,
            client,
            bot_origin: TELEGRAM.into(),
        })
    }

    async fn hosted(
        &self,
        method: reqwest::Method,
        path: &str,
        configure: impl Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
    ) -> Result<reqwest::Response> {
        let Mode::Hosted { account } = self.mode else {
            bail!("Rayu account link required");
        };
        let url = format!("{}{path}", rayu::api_base().trim_end_matches('/'));
        let token = rayu::telegram_access_token(account, None)
            .await
            .ok_or_else(|| {
                anyhow::anyhow!("Sign in with the linked Rayu account using rayu login rayu")
            })?;
        let send = |token: &str| {
            Self::request(configure(self.client.request(method.clone(), &url)).bearer_auth(token))
        };
        let response = send(&token).await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED
            && let Some(renewed) = rayu::telegram_access_token(account, Some(&token)).await
        {
            return send(&renewed).await;
        }
        Ok(response)
    }

    fn bot(&self, method: &str) -> Result<reqwest::RequestBuilder> {
        let Mode::BotFather { token, .. } = &self.mode else {
            bail!("BotFather link required");
        };
        Ok(self
            .client
            .post(format!("{}/bot{token}/{method}", self.bot_origin)))
    }

    async fn request(request: reqwest::RequestBuilder) -> Result<reqwest::Response> {
        // Reqwest errors contain the request URL, which can contain a bot token.
        request
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Telegram connection failed"))
    }

    async fn read_json<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T> {
        const MAX_BODY: usize = 16 * 1024 * 1024;
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| anyhow::anyhow!("Telegram response was interrupted"))?
        {
            if body.len() + chunk.len() > MAX_BODY {
                bail!("Telegram response exceeded its size limit");
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_| anyhow::anyhow!("Invalid Telegram response"))
    }

    async fn plain<T: DeserializeOwned>(response: reqwest::Response) -> Result<T> {
        if !response.status().is_success() {
            return Err(PollFailure {
                status: response.status().as_u16(),
                retry_after: response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse().ok()),
            }
            .into());
        }
        Self::read_json(response).await
    }

    async fn envelope<T: DeserializeOwned>(request: reqwest::RequestBuilder) -> Result<T> {
        Self::decode_envelope(Self::request(request).await?).await
    }

    async fn decode_envelope<T: DeserializeOwned>(response: reqwest::Response) -> Result<T> {
        let status = response.status().as_u16();
        let data: Envelope<T> = Self::read_json(response).await.map_err(|_| PollFailure {
            status,
            retry_after: None,
        })?;
        if (200..300).contains(&status)
            && data.ok
            && let Some(result) = data.result
        {
            return Ok(result);
        }
        Err(PollFailure {
            status,
            retry_after: data.parameters.and_then(|p| p.retry_after),
        }
        .into())
    }

    pub async fn get_bot(&self) -> Result<Bot> {
        Self::envelope(self.bot("getMe")?).await
    }

    pub async fn check_polling(&self) -> Result<()> {
        #[derive(Deserialize)]
        struct Webhook {
            url: String,
        }
        let webhook: Webhook = Self::envelope(self.bot("getWebhookInfo")?).await?;
        if !webhook.url.is_empty() {
            bail!("This bot has a webhook. Use a dedicated BotFather bot for Rayu.");
        }
        Ok(())
    }

    pub async fn register_commands(&self) -> Result<()> {
        let commands = [
            ("sessions", "Choose a Rayu session"),
            ("switch", "Switch Rayu sessions"),
            ("status", "Show the linked Rayu session"),
            ("model", "Choose a configured model"),
            ("provider", "Browse configured providers"),
            ("connect", "Set up a provider on the host"),
            ("interrupt", "Cancel the current Telegram turn"),
            ("disconnect", "Disconnect the Telegram chat"),
        ]
        .map(|(command, description)| json!({"command": command, "description": description}));
        let _: bool = Self::envelope(
            self.bot("setMyCommands")?
                .json(&json!({"commands": commands})),
        )
        .await?;
        Ok(())
    }

    pub async fn pair(&self) -> Result<Pairing> {
        Self::plain(
            self.hosted(reqwest::Method::POST, "/telegram/pair", |req| req)
                .await?,
        )
        .await
    }

    pub async fn link(&self) -> Result<Link> {
        Self::plain(
            self.hosted(reqwest::Method::GET, "/telegram/link", |req| req)
                .await?,
        )
        .await
    }

    pub async fn unlink(&self) -> Result<()> {
        let _: Value = Self::plain(
            self.hosted(reqwest::Method::DELETE, "/telegram/link", |req| req)
                .await?,
        )
        .await?;
        Ok(())
    }

    pub async fn updates(&self, after: i64, wait: u64) -> Result<(bool, Vec<Delivery>)> {
        match &self.mode {
            Mode::Hosted { .. } => {
                let batch: HostedBatch = Self::plain(
                    self.hosted(reqwest::Method::GET, "/telegram/updates", |req| {
                        req.query(&[("after", after)])
                    })
                    .await?,
                )
                .await?;
                Ok((batch.linked, batch.updates))
            }
            Mode::BotFather { .. } => {
                let updates: Vec<Value> = Self::envelope(self.bot("getUpdates")?.json(&json!({
                    "offset": after.saturating_add(1),
                    "limit": 50,
                    "timeout": wait.min(25),
                    "allowed_updates": ["message", "callback_query"],
                })))
                .await?;
                Ok((
                    true,
                    updates
                        .into_iter()
                        .filter_map(|payload| {
                            let id = payload.get("update_id")?.as_i64()?;
                            Some(Delivery {
                                id,
                                update: serde_json::from_value(payload).ok(),
                            })
                        })
                        .collect(),
                ))
            }
        }
    }

    async fn relay(&self, method: &str, params: Value) -> Result<Value> {
        match &self.mode {
            Mode::Hosted { .. } => {
                let body = json!({ "method": method, "params": params });
                Self::decode_envelope(
                    self.hosted(reqwest::Method::POST, "/telegram/send", |req| {
                        req.json(&body)
                    })
                    .await?,
                )
                .await
            }
            Mode::BotFather { .. } => Self::envelope(self.bot(method)?.json(&params)).await,
        }
    }

    pub async fn send(&self, chat: i64, text: &str, buttons: Option<Value>) -> Result<i64> {
        let mut params = json!({"chat_id": chat.to_string(), "text": text});
        if let Some(buttons) = buttons {
            params["reply_markup"] = json!({"inline_keyboard": buttons});
        }
        let result = self.relay("sendMessage", params).await?;
        result
            .get("message_id")
            .and_then(Value::as_i64)
            .ok_or_else(|| anyhow::anyhow!("Telegram did not return a message ID"))
    }

    pub async fn edit(&self, chat: i64, message: i64, text: &str) -> Result<()> {
        self.relay(
            "editMessageText",
            json!({
                "chat_id": chat.to_string(),
                "message_id": message,
                "text": text,
                "reply_markup": {"inline_keyboard": []},
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn answer(&self, id: &str) -> Result<()> {
        self.relay("answerCallbackQuery", json!({"callback_query_id": id}))
            .await?;
        Ok(())
    }

    pub async fn device(&self, name: &str, device: &str, version: &str) -> Result<()> {
        let body = json!({
            "deviceName": name,
            "deviceId": device,
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "version": version,
        });
        let _: Value = Self::plain(
            self.hosted(reqwest::Method::POST, "/devices", |req| req.json(&body))
                .await?,
        )
        .await?;
        Ok(())
    }

    pub async fn snapshot(&self, device: &str, sessions: Vec<Value>) -> Result<()> {
        let body = json!({"sessions": sessions});
        let _: Value = Self::plain(
            self.hosted(
                reqwest::Method::POST,
                &format!("/devices/{device}/snapshot"),
                |req| req.json(&body),
            )
            .await?,
        )
        .await?;
        Ok(())
    }

    pub async fn upload(
        &self,
        chat: i64,
        bytes: Vec<u8>,
        filename: &str,
        video: bool,
    ) -> Result<()> {
        let (method, field) = if video {
            ("sendVideo", "video")
        } else {
            ("sendPhoto", "photo")
        };
        let form = reqwest::multipart::Form::new()
            .text("chat_id", chat.to_string())
            .part(
                field,
                reqwest::multipart::Part::bytes(bytes).file_name(filename.to_owned()),
            );
        let _: Value = Self::envelope(self.bot(method)?.multipart(form)).await?;
        Ok(())
    }

    pub async fn image(&self, photo: &Photo) -> Result<(String, String)> {
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        if photo.file_size.is_some_and(|size| size > MAX_IMAGE) {
            bail!("Telegram image exceeds 10 MiB");
        }
        let bytes = match &self.mode {
            Mode::Hosted { .. } => {
                #[derive(Deserialize)]
                struct File {
                    base64: String,
                }
                let file: File = Self::plain(
                    self.hosted(reqwest::Method::GET, "/telegram/file", |req| {
                        req.query(&[("file_id", &photo.file_id)])
                    })
                    .await?,
                )
                .await?;
                if file.base64.len() > MAX_IMAGE.div_ceil(3) * 4 {
                    bail!("Telegram image exceeds 10 MiB");
                }
                engine.decode(file.base64)?
            }
            Mode::BotFather { token, .. } => {
                #[derive(Deserialize)]
                struct File {
                    file_path: String,
                }
                let file: File = Self::envelope(
                    self.bot("getFile")?
                        .json(&json!({"file_id": photo.file_id})),
                )
                .await?;
                if !file.file_path.split('/').all(|part| {
                    !part.is_empty()
                        && !matches!(part, "." | "..")
                        && part
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
                }) {
                    bail!("Invalid Telegram media path");
                }
                let mut response = Self::request(self.client.get(format!(
                    "{}/file/bot{token}/{}",
                    self.bot_origin, file.file_path
                )))
                .await?;
                if !response.status().is_success() {
                    bail!("Telegram image download failed");
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = response
                    .chunk()
                    .await
                    .map_err(|_| anyhow::anyhow!("Telegram image download failed"))?
                {
                    if bytes.len() + chunk.len() > MAX_IMAGE {
                        bail!("Telegram image exceeds 10 MiB");
                    }
                    bytes.extend_from_slice(&chunk);
                }
                bytes
            }
        };
        if bytes.len() > MAX_IMAGE {
            bail!("Telegram image exceeds 10 MiB");
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            "image/jpeg"
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            "image/gif"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            bail!("Unsupported Telegram image");
        };
        Ok((mime.into(), engine.encode(bytes)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_route_components_and_never_formats_a_token_in_errors() {
        assert_eq!(bot_id("123:abcdefghijklmnopqrstuvwxyz"), Some(123));
        assert_eq!(bot_id("123:abcdefghijklmnopqrstuvwxyz/secret"), None);
        assert!(pairing_url("rayu_bot", "code_123").is_ok());
        assert!(pairing_url("rayu_bot@evil.test", "code").is_err());
    }

    #[test]
    fn admits_only_the_linked_private_sender() {
        let chat = Chat {
            id: 10,
            kind: Some("private".into()),
        };
        let mut user = User {
            id: 10,
            is_bot: false,
        };
        assert!(chat.admits(Some(&user), 10));
        assert!(!chat.admits(Some(&user), 11));
        assert!(!chat.admits(None, 10));
        user.is_bot = true;
        assert!(!chat.admits(Some(&user), 10));
        let missing = Chat { id: 10, kind: None };
        assert!(!missing.admits(Some(&user), 10));
    }
    #[tokio::test]
    async fn botfather_polls_private_updates_and_reports_conflicts() -> Result<()> {
        use std::io::{BufRead, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        let address = listener.local_addr()?;
        let server = std::thread::spawn(move || -> Result<()> {
            let examples = [
                (
                    "getMe",
                    "200 OK",
                    json!({"ok":true,"result":{"id":123,"username":"fixture_bot"}}),
                ),
                (
                    "getWebhookInfo",
                    "200 OK",
                    json!({"ok":true,"result":{"url":""}}),
                ),
                (
                    "getUpdates",
                    "200 OK",
                    json!({"ok":true,"result":[{
                        "update_id":10, "message":{"message_id":20,"text":"hello","chat":{"id":42,"type":"private"},"from":{"id":42,"is_bot":false}}
                    }]}),
                ),
                (
                    "getUpdates",
                    "409 Conflict",
                    json!({"ok":false,"description":"conflicting poller"}),
                ),
            ];
            for (method, status, payload) in examples {
                let (mut stream, _) = listener.accept()?;
                stream.set_read_timeout(Some(Duration::from_secs(4)))?;
                let mut reader = std::io::BufReader::new(&mut stream);
                let mut line = String::new();
                reader.read_line(&mut line)?;
                assert!(line.starts_with(&format!(
                    "POST /bot123:abcdefghijklmnopqrstuvwxyz/{method} "
                )));
                let mut size = 0;
                loop {
                    line.clear();
                    if reader.read_line(&mut line)? == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        size = value.trim().parse()?;
                    }
                }
                let mut body = vec![0; size];
                reader.read_exact(&mut body)?;
                if method == "getUpdates" {
                    let request: Value = serde_json::from_slice(&body)?;
                    assert_eq!(request["offset"], 10);
                }
                let body = payload.to_string();
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                )?;
            }
            Ok(())
        });
        let mut transport = Transport::new(Mode::BotFather {
            token: "123:abcdefghijklmnopqrstuvwxyz".into(),
            bot_id: 123,
        })?;
        transport.bot_origin = format!("http://{address}");
        assert_eq!(transport.get_bot().await?.username, "fixture_bot");
        transport.check_polling().await?;
        let (linked, updates) = transport.updates(9, 0).await?;
        assert!(linked);
        assert_eq!(updates[0].id, 10);
        let message = updates[0]
            .update
            .as_ref()
            .unwrap()
            .message
            .as_ref()
            .unwrap();
        assert!(message.chat.admits(message.from.as_ref(), 42));
        let Err(error) = transport.updates(9, 0).await else {
            panic!("Expected conflict")
        };
        assert_eq!(error.downcast_ref::<PollFailure>().unwrap().status, 409);
        assert!(!error.to_string().contains("abcdefghijklmnopqrstuvwxyz"));
        server.join().unwrap()
    }
}
