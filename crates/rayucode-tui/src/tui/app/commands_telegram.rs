use super::{App, DisplayMessage};
use crate::telegram_remote;

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

    let status = match input.trim() {
        "/telegram-bot" | "/telegram-bot status" => match telegram_remote::load() {
            Ok(Some(link)) => format!("{} · @{}\nUse /telegram-bot disconnect to disconnect this host.", link.status(), link.username),
            Ok(None) => "Telegram is disconnected. Use /telegram-bot link for the hosted Rayu bot, or run rayu telegram link --botfather in a terminal.".into(),
            Err(error) => format!("Could not read Telegram settings: {error}"),
        },
        "/telegram-bot link" | "/telegram-bot disconnect" => {
            if app.pending_telegram.is_some() {
                app.set_status_notice("A Telegram operation is already running");
                return true;
            }
            let disconnect = input.trim_end().ends_with("disconnect");
            let (send, receiver) = tokio::sync::oneshot::channel();
            app.pending_telegram = Some(receiver);
            tokio::spawn(async move {
                let result = if disconnect {
                    disconnect_link().await
                } else {
                    link().await
                };
                let _ = send.send(result);
            });
            app.set_status_notice("Updating Telegram link");
            return true;
        }
        _ => "Use /telegram-bot [link|status|disconnect]. For BotFather tokens run rayu telegram link --botfather.".into(),
    };
    app.push_display_message(DisplayMessage::system(status));
    true
}

async fn link() -> anyhow::Result<String> {
    telegram_remote::require_daemon().await?;
    let (_, url) = telegram_remote::hosted_pairing(false).await?;
    let qr = rayucode_terminal_prompt::qr::render_unicode_qr(&url).unwrap_or_default();
    Ok(format!(
        "Open this link in Telegram and tap Start. Treat this link as a password.\n{url}\n\n{qr}\n\nUse /telegram-bot status to check pairing."
    ))
}

async fn disconnect_link() -> anyhow::Result<String> {
    if let Some(link) = telegram_remote::load()? {
        telegram_remote::disconnect(&link).await?;
    }
    Ok("Telegram disconnected on this host.".into())
}

pub(super) fn poll(app: &mut App) -> bool {
    let Some(receiver) = app.pending_telegram.as_mut() else {
        return false;
    };
    let result = receiver.try_recv();
    let message = match result {
        Ok(Ok(message)) => DisplayMessage::system(message),
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
