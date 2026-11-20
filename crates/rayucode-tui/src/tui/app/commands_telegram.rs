use std::time::{Duration, Instant};

use super::{App, DisplayMessage};
use crate::telegram_remote;
use crate::tui::ui::telegram_pairing_message;

pub(super) enum Completion {
    Pairing { generation: u128, url: String },
    Disconnected,
}

pub(super) struct PairingWatch {
    generation: u128,
    next_check: Instant,
}

pub(super) fn handle(app: &mut App, input: &str) -> bool {
    let Some(command) = input.split_whitespace().next() else {
        return false;
    };
    let input = match command {
        "/telegram-bot" => input,
        "/disconnect-telegram" => "/telegram-bot disconnect",
        "/telegram-remote-uninstall" => {
            let setting = match input.split_whitespace().nth(1) {
                Some("on") => telegram_remote::uninstall::set_enabled(true),
                Some("off") => telegram_remote::uninstall::set_enabled(false),
                None | Some("status") => Ok(()),
                _ => {
                    app.push_display_message(DisplayMessage::system(
                        "Use /telegram-remote-uninstall [on|off|status].",
                    ));
                    return true;
                }
            };
            let message = match setting {
                Ok(()) => DisplayMessage::system(if telegram_remote::uninstall::enabled() {
                    "Telegram remote uninstall is enabled."
                } else {
                    "Telegram remote uninstall is disabled."
                }),
                Err(error) => DisplayMessage::error(error.to_string()),
            };
            app.push_display_message(message);
            return true;
        }
        _ => return false,
    };

    let input = input.trim();
    let status = match input {
        "/telegram-bot" | "/telegram-bot status" => match telegram_remote::load() {
            Ok(Some(link)) => format!("{} · @{}\nUse /telegram-bot disconnect to disconnect this host.", link.status(), link.username),
            Ok(None) if input == "/telegram-bot" => return start_operation(app, link(), "Starting Telegram pairing"),
            Ok(None) => "Telegram is disconnected. Use /telegram-bot to pair the hosted Rayu bot.".into(),
            Err(error) => format!("Could not read Telegram settings: {error}"),
        },
        "/telegram-bot link" => return start_operation(app, link(), "Starting Telegram pairing"),
        "/telegram-bot disconnect" => {
            return start_operation(app, disconnect_link(), "Disconnecting Telegram");
        }
        _ => "Use /telegram-bot [link|status|disconnect]. For BotFather tokens run rayu telegram link --botfather.".into(),
    };
    app.push_display_message(DisplayMessage::system(status));
    true
}

fn start_operation(
    app: &mut App,
    operation: impl Future<Output = anyhow::Result<Completion>> + Send + 'static,
    notice: &str,
) -> bool {
    if app.pending_telegram.is_some() {
        app.set_status_notice("A Telegram operation is already running");
        return true;
    }
    let (send, receiver) = tokio::sync::oneshot::channel();
    app.pending_telegram = Some(receiver);
    tokio::spawn(async move {
        let _ = send.send(operation.await);
    });
    app.set_status_notice(notice);
    true
}

async fn link() -> anyhow::Result<Completion> {
    telegram_remote::require_daemon().await?;
    let (link, url) = telegram_remote::hosted_pairing(false).await?;
    Ok(Completion::Pairing {
        generation: link.generation.as_u128(),
        url,
    })
}

async fn disconnect_link() -> anyhow::Result<Completion> {
    if let Some(link) = telegram_remote::load()? {
        telegram_remote::disconnect(&link).await?;
    }
    Ok(Completion::Disconnected)
}

pub(super) fn poll(app: &mut App) -> bool {
    poll_operation(app) | poll_pairing(app)
}

fn poll_operation(app: &mut App) -> bool {
    let Some(receiver) = app.pending_telegram.as_mut() else {
        return false;
    };
    let result = receiver.try_recv();
    let message = match result {
        Ok(Ok(Completion::Pairing { generation, url })) => {
            app.telegram_pairing = Some(PairingWatch {
                generation,
                next_check: Instant::now(),
            });
            telegram_pairing_message(url)
        }
        Ok(Ok(Completion::Disconnected)) => {
            app.telegram_pairing = None;
            DisplayMessage::system("Telegram disconnected on this host.")
        }
        Ok(Err(error)) => DisplayMessage::error(error.to_string()),
        Err(tokio::sync::oneshot::error::TryRecvError::Empty) => return false,
        Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
            DisplayMessage::error("Telegram operation was interrupted.")
        }
    };
    app.pending_telegram = None;
    app.push_display_message(message);
    true
}

fn poll_pairing(app: &mut App) -> bool {
    let Some(watch) = app.telegram_pairing.as_mut() else {
        return false;
    };
    let now = Instant::now();
    if now < watch.next_check {
        return false;
    }
    watch.next_check = now + Duration::from_secs(1);
    let Ok(link) = telegram_remote::load() else {
        return false;
    };
    let Some(link) = link.filter(|link| link.generation.as_u128() == watch.generation) else {
        app.telegram_pairing = None;
        return false;
    };
    let notice = match link.status() {
        "Linked" => format!("Telegram connected · @{}", link.username),
        "Pairing expired" => {
            "Telegram pairing expired. Use /telegram-bot disconnect before pairing again.".into()
        }
        "Rayu account signed out" => {
            "Telegram pairing stopped because the Rayu account signed out.".into()
        }
        _ => return false,
    };
    app.telegram_pairing = None;
    app.push_display_message(DisplayMessage::system(notice));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tui::app::{commands_dispatch::dispatch_local_command, tests::create_test_app};

    #[test]
    fn telegram_command_starts_pairing_while_status_only_reports() -> anyhow::Result<()> {
        let _sandbox = crate::auth::test_sandbox::AuthTestSandbox::new()?;
        let mut app = create_test_app();
        // Queue the pairing task without polling it or making network calls.
        let runtime = tokio::runtime::Builder::new_current_thread().build()?;
        let _runtime = runtime.enter();

        assert!(dispatch_local_command(&mut app, "/telegram-bot status"));
        assert!(app.pending_telegram.is_none());
        assert!(
            app.display_messages
                .last()
                .unwrap()
                .content
                .starts_with("Telegram is disconnected.")
        );

        assert!(dispatch_local_command(&mut app, "/telegram-bot"));
        assert!(app.pending_telegram.is_some());
        Ok(())
    }

    #[test]
    fn telegram_pairing_confirms_the_same_generation_once() -> anyhow::Result<()> {
        let _sandbox = crate::auth::test_sandbox::AuthTestSandbox::new()?;
        let mut app = create_test_app();
        let mut link = telegram_remote::Link::new(
            "fixture_bot".into(),
            crate::telegram::remote::Mode::BotFather {
                bot_id: 42,
                token: "fixture".into(),
            },
        );
        assert!(telegram_remote::replace(None, Some(&link))?);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.pending_telegram = Some(receiver);
        assert!(
            sender
                .send(Ok(Completion::Pairing {
                    generation: link.generation.as_u128(),
                    url: "https://t.me/fixture_bot?start=fixture_code".into(),
                }))
                .is_ok()
        );
        assert!(poll(&mut app));
        assert!(app.telegram_pairing.is_some());
        assert_eq!(
            app.display_messages.last().unwrap().title.as_deref(),
            Some("Telegram pairing")
        );

        link.owner = Some(7);
        assert!(telegram_remote::replace(
            Some(link.generation),
            Some(&link)
        )?);
        app.telegram_pairing.as_mut().unwrap().next_check = Instant::now();
        assert!(poll(&mut app));
        assert_eq!(
            app.display_messages.last().unwrap().content,
            "Telegram connected · @fixture_bot"
        );
        assert!(!poll(&mut app));
        Ok(())
    }
}
