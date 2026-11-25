//! Standalone pre-UI first-launch & Rayu Auth setup wizard.
//!
//! Runs BEFORE spawning the background daemon or launching the main CLI TUI,
//! matching `rayu-legacy`'s `showSetupScreens()` -> `launchRepl()` flow.

mod render;
mod state;

#[cfg(test)]
mod tests;

pub use state::{
    AuthPromptReason, AuthSubView, PreUiSetupConfig, PreUiSetupOutcome, PreUiSetupState,
    SetupEffect, SetupStep, ThemeChoice,
};

use crate::rayu::{self, ApiKeyVerdict, PreparedRayuLogin};
use anyhow::{Context, Result};
use crossterm::event::{self, Event};
use std::io::IsTerminal;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(80);

enum AsyncSetupEvent {
    OAuthPrepared {
        generation: u64,
        url: String,
        browser_suppressed: bool,
    },
    OAuthSucceeded {
        generation: u64,
    },
    OAuthFailed {
        generation: u64,
        message: String,
    },
    ApiKeyChecked {
        generation: u64,
        verdict: ApiKeyVerdict,
        save_error: Option<String>,
    },
}

struct PreUiTerminalGuard {
    terminal: ratatui::DefaultTerminal,
    bracketed_paste: bool,
}

impl PreUiTerminalGuard {
    fn enter() -> Result<Self> {
        let terminal = rayucode_tui_style::init_terminal()
            .context("failed to initialize pre-UI setup terminal")?;
        let bracketed_paste = crate::tui::enable_bracketed_paste().is_ok();
        Ok(Self {
            terminal,
            bracketed_paste,
        })
    }

    fn draw(&mut self, state: &PreUiSetupState) -> Result<()> {
        self.terminal.draw(|frame| {
            render::render(frame, state);
            rayucode_tui_style::adapt_buffer_for_display(frame.buffer_mut());
        })?;
        Ok(())
    }
}

impl Drop for PreUiTerminalGuard {
    fn drop(&mut self) {
        if self.bracketed_paste
            && let Err(err) = crate::tui::disable_bracketed_paste()
        {
            crate::logging::warn(&format!(
                "failed to disable bracketed paste on pre-UI setup exit: {err}"
            ));
        }
        rayucode_tui_style::restore_terminal_quietly();
    }
}

/// Run the standalone pre-UI setup wizard in raw terminal mode.
///
/// Returns `PreUiSetupOutcome::Completed` when every required step finishes,
/// or `PreUiSetupOutcome::Cancelled` when the user exits via double `Ctrl+C`.
pub async fn run_pre_ui_setup(config: PreUiSetupConfig) -> Result<PreUiSetupOutcome> {
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        anyhow::bail!("Rayu setup requires an interactive terminal (stdin/stdout must be a TTY).");
    }

    let mut state = PreUiSetupState::new(config);
    if state.is_empty() {
        return Ok(PreUiSetupOutcome::Completed);
    }

    let mut guard = PreUiTerminalGuard::enter()?;
    let (tx, mut rx) = mpsc::unbounded_channel::<AsyncSetupEvent>();
    let mut oauth_task: Option<JoinHandle<()>> = None;
    let mut oauth_generation: u64 = 0;
    let mut apikey_task: Option<JoinHandle<()>> = None;
    let mut apikey_generation: u64 = 0;

    let outcome = 'setup: loop {
        guard.draw(&state)?;

        while let Ok(async_event) = rx.try_recv() {
            match async_event {
                AsyncSetupEvent::OAuthPrepared {
                    generation,
                    url,
                    browser_suppressed,
                } if generation == oauth_generation => {
                    state.on_oauth_prepared(url, browser_suppressed);
                }
                AsyncSetupEvent::OAuthSucceeded { generation }
                    if generation == oauth_generation =>
                {
                    oauth_task = None;
                    let effects = state.on_oauth_succeeded();
                    if let Some(done) = apply_effects(
                        effects,
                        &tx,
                        &mut oauth_task,
                        &mut oauth_generation,
                        &mut apikey_task,
                        &mut apikey_generation,
                    ) {
                        break 'setup done;
                    }
                }
                AsyncSetupEvent::OAuthFailed {
                    generation,
                    message,
                } if generation == oauth_generation => {
                    oauth_task = None;
                    state.on_oauth_failed(message);
                }
                AsyncSetupEvent::ApiKeyChecked {
                    generation,
                    verdict,
                    save_error,
                } if generation == apikey_generation => {
                    apikey_task = None;
                    let effects = state.on_api_key_result(verdict, save_error);
                    if let Some(done) = apply_effects(
                        effects,
                        &tx,
                        &mut oauth_task,
                        &mut oauth_generation,
                        &mut apikey_task,
                        &mut apikey_generation,
                    ) {
                        break 'setup done;
                    }
                }
                _ => {}
            }
        }

        if let Some(done) = poll_terminal_events(
            &mut state,
            &tx,
            &mut oauth_task,
            &mut oauth_generation,
            &mut apikey_task,
            &mut apikey_generation,
        )? {
            break 'setup done;
        }
        state.tick(Instant::now());
        tokio::task::yield_now().await;
    };

    if let Some(handle) = oauth_task.take() {
        handle.abort();
    }
    if let Some(handle) = apikey_task.take() {
        handle.abort();
    }
    drop(guard);
    Ok(outcome)
}

fn poll_terminal_events(
    state: &mut PreUiSetupState,
    tx: &mpsc::UnboundedSender<AsyncSetupEvent>,
    oauth_task: &mut Option<JoinHandle<()>>,
    oauth_generation: &mut u64,
    apikey_task: &mut Option<JoinHandle<()>>,
    apikey_generation: &mut u64,
) -> Result<Option<PreUiSetupOutcome>> {
    if !event::poll(EVENT_POLL_INTERVAL)? {
        return Ok(None);
    }
    match event::read()? {
        Event::Key(key) => {
            let effects = state.handle_key(key, Instant::now());
            return Ok(apply_effects(
                effects,
                tx,
                oauth_task,
                oauth_generation,
                apikey_task,
                apikey_generation,
            ));
        }
        Event::Paste(text) => {
            let effects = state.handle_paste(&text);
            return Ok(apply_effects(
                effects,
                tx,
                oauth_task,
                oauth_generation,
                apikey_task,
                apikey_generation,
            ));
        }
        _ => {}
    }
    Ok(None)
}

fn apply_effects(
    effects: Vec<SetupEffect>,
    tx: &mpsc::UnboundedSender<AsyncSetupEvent>,
    oauth_task: &mut Option<JoinHandle<()>>,
    oauth_generation: &mut u64,
    apikey_task: &mut Option<JoinHandle<()>>,
    apikey_generation: &mut u64,
) -> Option<PreUiSetupOutcome> {
    for effect in effects {
        match effect {
            SetupEffect::PreviewTheme(mode) => {
                rayucode_tui_style::set_theme_mode(mode);
            }
            SetupEffect::SaveTheme(choice) => {
                if let Err(err) = crate::config::Config::set_display_theme(choice.as_config_str()) {
                    crate::logging::warn(&format!(
                        "Could not persist display.theme='{}': {err}",
                        choice.as_config_str()
                    ));
                }
            }
            SetupEffect::StartOAuthLogin => {
                abort_task(oauth_task);
                *oauth_generation = oauth_generation.wrapping_add(1);
                let generation = *oauth_generation;
                let tx_clone = tx.clone();
                let browser_suppressed = crate::auth::browser_suppressed(false);
                *oauth_task = Some(tokio::spawn(async move {
                    let prepared = match PreparedRayuLogin::prepare().await {
                        Ok(prepared) => prepared,
                        Err(err) => {
                            send_async_event(
                                &tx_clone,
                                AsyncSetupEvent::OAuthFailed {
                                    generation,
                                    message: err.to_string(),
                                },
                            );
                            return;
                        }
                    };
                    let url = prepared.auth_url().to_string();
                    send_async_event(
                        &tx_clone,
                        AsyncSetupEvent::OAuthPrepared {
                            generation,
                            url,
                            browser_suppressed,
                        },
                    );
                    if !browser_suppressed {
                        prepared.open_browser();
                    }
                    match prepared.wait_and_exchange().await {
                        Ok(_user) => {
                            send_async_event(
                                &tx_clone,
                                AsyncSetupEvent::OAuthSucceeded { generation },
                            );
                        }
                        Err(err) => {
                            send_async_event(
                                &tx_clone,
                                AsyncSetupEvent::OAuthFailed {
                                    generation,
                                    message: err.to_string(),
                                },
                            );
                        }
                    }
                }));
            }
            SetupEffect::SubmitCallbackUrl(callback_url) => {
                abort_task(oauth_task);
                *oauth_generation = oauth_generation.wrapping_add(1);
                let generation = *oauth_generation;
                let tx_clone = tx.clone();
                *oauth_task = Some(tokio::spawn(async move {
                    match rayu::exchange_callback_url(&callback_url).await {
                        Ok(_user) => {
                            send_async_event(
                                &tx_clone,
                                AsyncSetupEvent::OAuthSucceeded { generation },
                            );
                        }
                        Err(err) => {
                            send_async_event(
                                &tx_clone,
                                AsyncSetupEvent::OAuthFailed {
                                    generation,
                                    message: err.to_string(),
                                },
                            );
                        }
                    }
                }));
            }
            SetupEffect::CancelOAuthLogin => {
                abort_task(oauth_task);
                *oauth_generation = oauth_generation.wrapping_add(1);
            }
            SetupEffect::ValidateApiKey(key) => {
                abort_task(apikey_task);
                *apikey_generation = apikey_generation.wrapping_add(1);
                let generation = *apikey_generation;
                let tx_clone = tx.clone();
                *apikey_task = Some(tokio::spawn(async move {
                    let verdict = rayu::validate_api_key(&key).await;
                    let save_error = if verdict == ApiKeyVerdict::Valid {
                        if !rayu::has_usable_session() {
                            rayu::clear_session();
                        }
                        match rayu::save_api_key(&key) {
                            Ok(_) => {
                                if std::env::var_os(rayu::RAYU_API_KEY_ENV).is_some() {
                                    crate::env::set_var(rayu::RAYU_API_KEY_ENV, &key);
                                }
                                crate::auth::AuthStatus::invalidate_cache();
                                None
                            }
                            Err(err) => Some(format!("Could not save Rayu API key: {err}")),
                        }
                    } else {
                        None
                    };
                    send_async_event(
                        &tx_clone,
                        AsyncSetupEvent::ApiKeyChecked {
                            generation,
                            verdict,
                            save_error,
                        },
                    );
                }));
            }
            SetupEffect::Completed => return Some(PreUiSetupOutcome::Completed),
            SetupEffect::Cancelled => return Some(PreUiSetupOutcome::Cancelled),
        }
    }
    None
}

fn send_async_event(tx: &mpsc::UnboundedSender<AsyncSetupEvent>, event: AsyncSetupEvent) {
    if tx.send(event).is_err() {
        crate::logging::info("Pre-UI setup loop closed before async auth event arrived");
    }
}

fn abort_task(slot: &mut Option<JoinHandle<()>>) {
    if let Some(handle) = slot.take() {
        handle.abort();
    }
}
