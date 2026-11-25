use std::io::{self, IsTerminal, Write};
use std::time::Duration;

use crate::telegram_remote;
use crate::telegram::remote::Mode;
use anyhow::{Context, Result, bail, ensure};
use clap::Subcommand;

use super::provider_init::ProviderChoice;

#[derive(Subcommand, Debug)]
pub(crate) enum TelegramCommand {
    /// Pair your Rayu account or a dedicated BotFather bot with this daemon.
    Link {
        /// Enter a BotFather token in a masked prompt or through stdin.
        #[arg(long)]
        botfather: bool,

        /// Disconnect an existing hosted Telegram link before pairing this host.
        #[arg(long, conflicts_with = "botfather")]
        replace_existing: bool,
    },
    /// Control whether a linked chat may uninstall this managed CLI.
    Uninstall {
        #[arg(value_enum, default_value = "status")]
        action: UninstallAction,
    },
    /// Show the link status for this Rayu profile.
    Status,
    /// Disconnect Telegram from this Rayu profile.
    Disconnect {
        /// Remove local settings even when the hosted account is unavailable.
        #[arg(long)]
        local_only: bool,
    },
}

#[derive(clap::ValueEnum, Clone, Debug)]
pub(crate) enum UninstallAction {
    Enable,
    Disable,
    Status,
}

pub(crate) async fn run(
    action: TelegramCommand,
    provider: &ProviderChoice,
    model: Option<&str>,
    provider_profile: Option<&str>,
) -> Result<()> {
    let link = telegram_remote::load()?;
    match action {
        TelegramCommand::Uninstall { action } => {
            match action {
                UninstallAction::Enable => telegram_remote::uninstall::set_enabled(true)?,
                UninstallAction::Disable => telegram_remote::uninstall::set_enabled(false)?,
                UninstallAction::Status => {}
            }
            println!(
                "Telegram remote uninstall is {}.",
                if telegram_remote::uninstall::enabled() {
                    "enabled"
                } else {
                    "disabled"
                }
            );
        }

        TelegramCommand::Status => match link {
            Some(link) => {
                let mode = match link.mode {
                    Mode::Hosted { .. } => "Rayu account",
                    Mode::BotFather { .. } => "BotFather",
                };
                let online = super::dispatch::server_is_running().await;
                println!("{} · @{bot} · {mode}", link.status(), bot = link.username);
                println!("Daemon {}", if online { "running" } else { "offline" });
            }
            None => println!("Telegram is disconnected. Run rayu telegram link to pair."),
        },
        TelegramCommand::Disconnect { local_only } => {
            if let Some(link) = link {
                if local_only {
                    telegram_remote::disconnect_local(&link)?;
                } else {
                    telegram_remote::disconnect(&link).await?;
                }
            }
            println!("Telegram disconnected on this host.");
        }
        TelegramCommand::Link {
            botfather,
            replace_existing,
        } => {
            ensure!(
                !crate::server::socket_path_is_custom(),
                "Telegram remote runs on the profile's shared daemon socket."
            );
            ensure!(
                link.is_none(),
                "Run rayu telegram disconnect before pairing another bot."
            );
            if !super::dispatch::server_is_running().await {
                super::dispatch::spawn_server_with_executable(
                    provider,
                    model,
                    provider_profile,
                    Some(std::env::current_exe()?),
                )
                .await?;
            }
            telegram_remote::require_daemon().await?;
            let (link, url) = if botfather {
                if io::stdin().is_terminal() {
                    eprint!("BotFather token: ");
                    io::stderr().flush()?;
                }
                let token = rayucode_terminal_prompt::read_secret_line()?
                    .trim()
                    .to_owned();
                let (link, pairing) =
                    telegram_remote::botfather_pairing(&token, None, false).await?;
                let (url, _code) = pairing.context("Missing BotFather pairing link")?;
                (link, url)
            } else {
                telegram_remote::hosted_pairing(replace_existing).await?
            };
            println!("Open this link on Telegram and tap Start. Treat the link as a password.");
            println!("{url}");
            if io::stdout().is_terminal() {
                if let Ok(qr) = rayucode_terminal_prompt::qr::render_unicode_qr(&url) {
                    println!("{qr}");
                }
            }
            let start = tokio::time::Instant::now();
            while start.elapsed() < Duration::from_secs(600) {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let current =
                    telegram_remote::load()?.context("Telegram setup was disconnected")?;
                ensure!(
                    current.generation == link.generation,
                    "Telegram setup was replaced"
                );
                if current.owner.is_some() {
                    println!(
                        "Linked to @{}. Use /sessions in Telegram to pick a Rayu session.",
                        current.username
                    );
                    return Ok(());
                }
            }
            bail!(
                "Telegram pairing expired. Run rayu telegram disconnect --local-only and try again."
            );
        }
    }
    Ok(())
}
