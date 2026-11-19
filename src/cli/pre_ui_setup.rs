//! Pre-UI launch gate for interactive `rayu` sessions.
//!
//! Mirrors `rayu-legacy`'s `showSetupScreens()` -> `launchRepl()` order:
//! on first install, logged-out launch, or relaunch with a rejected/out-of-credit
//! Rayu API key, the standalone pre-UI setup screen runs **before** any daemon
//! spawns and **before** the main CLI TUI opens.

use anyhow::Result;
use std::io::IsTerminal;

use crate::pre_ui_setup::{
    AuthPromptReason, PreUiSetupConfig, PreUiSetupOutcome, ThemeChoice, run_pre_ui_setup,
};
use crate::rayu::{self, ApiKeyVerdict};

use super::args::Args;

#[derive(Debug, Clone, PartialEq, Eq)]
enum PreUiAction {
    /// Proceed directly to server spawn/connect & main TUI (prewarm theme if not resuming).
    Proceed { prewarm_theme: bool },
    /// Non-TTY interactive launch missing mandatory Rayu credentials: fail fast.
    FailMissingAuthNonTty,
    /// Run the full first-run wizard: Theme -> (Rayu Auth if missing creds) -> Security.
    RunFirstRunWizard { include_auth: bool },
    /// Already onboarded, but missing Rayu credentials (e.g., logged out): auth-only screen.
    RunAuthOnly {
        reason: AuthPromptReason,
        notice: Option<String>,
    },
    /// Already onboarded, API-key-only: check `ensure_api_key_validated_once()` before UI.
    ValidateApiKeyThenMaybePrompt,
}

#[derive(Debug, Clone, Copy)]
struct LaunchContext {
    auth_gate_enabled: bool,
    is_resuming: bool,
    fresh_spawn: bool,
    ssh_remote: bool,
    onboarding_sim: bool,
    is_tty: bool,
    onboarding_completed: bool,
    has_credentials: bool,
    has_usable_session: bool,
    has_api_key: bool,
}

fn decide_pre_ui_action(ctx: LaunchContext) -> PreUiAction {
    if ctx.is_resuming {
        return PreUiAction::Proceed {
            prewarm_theme: false,
        };
    }
    if ctx.fresh_spawn || ctx.ssh_remote || ctx.onboarding_sim || !ctx.auth_gate_enabled {
        return PreUiAction::Proceed {
            prewarm_theme: true,
        };
    }
    if !ctx.is_tty {
        if !ctx.has_credentials {
            return PreUiAction::FailMissingAuthNonTty;
        }
        return PreUiAction::Proceed {
            prewarm_theme: true,
        };
    }
    if !ctx.onboarding_completed {
        return PreUiAction::RunFirstRunWizard {
            include_auth: !ctx.has_credentials,
        };
    }
    if !ctx.has_credentials {
        return PreUiAction::RunAuthOnly {
            reason: AuthPromptReason::MissingCredentials,
            notice: None,
        };
    }
    if !ctx.has_usable_session && ctx.has_api_key {
        return PreUiAction::ValidateApiKeyThenMaybePrompt;
    }
    PreUiAction::Proceed {
        prewarm_theme: true,
    }
}

fn relaunch_notice_for_verdict(verdict: ApiKeyVerdict) -> Option<(AuthPromptReason, String)> {
    match verdict {
        ApiKeyVerdict::Invalid => Some((
            AuthPromptReason::RelaunchInvalidKey,
            "Your saved Rayu API key was rejected — it may have been revoked, expired, or regenerated."
                .to_string(),
        )),
        ApiKeyVerdict::NoCredit => Some((
            AuthPromptReason::RelaunchNoCredit,
            "Your Rayu account has no credits left, so the saved API key cannot be used right now."
                .to_string(),
        )),
        ApiKeyVerdict::Valid | ApiKeyVerdict::Unavailable => None,
    }
}

/// Ensure the user has completed pre-UI first-run setup and mandatory Rayu
/// authentication before spawning the server or launching the main CLI UI.
///
/// Returns `Ok(true)` to continue launching the server & main TUI, or
/// `Ok(false)` when the user exited pre-UI setup (e.g. double `Ctrl+C`).
pub(crate) async fn ensure_ready_for_interactive_launch(args: &Args) -> Result<bool> {
    let ctx = LaunchContext {
        auth_gate_enabled: rayu::auth_gate_enabled(),
        is_resuming: std::env::var_os("RAYU_RESUMING").is_some(),
        fresh_spawn: args.fresh_spawn,
        ssh_remote: std::env::var_os("RAYU_SSH_REMOTE").is_some(),
        onboarding_sim: args.onboarding_sim,
        is_tty: std::io::stdin().is_terminal() && std::io::stdout().is_terminal(),
        onboarding_completed: rayu::has_completed_first_run_onboarding(),
        has_credentials: rayu::has_credentials(),
        has_usable_session: rayu::has_usable_session(),
        has_api_key: rayu::has_api_key(),
    };

    match decide_pre_ui_action(ctx) {
        PreUiAction::Proceed { prewarm_theme } => {
            if prewarm_theme {
                crate::tui::theme_detect::prewarm_theme_mode();
            }
            Ok(true)
        }
        PreUiAction::FailMissingAuthNonTty => {
            rayu::require_auth_gate()?;
            Ok(true)
        }
        PreUiAction::RunFirstRunWizard { include_auth } => {
            let detected_theme = crate::tui::theme_detect::init_theme_mode();
            let initial_theme =
                ThemeChoice::from_config_str(&crate::config::config().display.theme);
            let outcome = run_pre_ui_setup(PreUiSetupConfig {
                include_theme: true,
                include_auth,
                include_security: true,
                reason: AuthPromptReason::FirstRun,
                notice: None,
                initial_theme,
                detected_theme,
            })
            .await?;
            if outcome == PreUiSetupOutcome::Cancelled {
                return Ok(false);
            }
            if let Err(err) = rayu::mark_first_run_onboarding_completed() {
                crate::logging::warn(&format!(
                    "Could not persist Rayu first-run onboarding state: {err}"
                ));
            }
            crate::auth::AuthStatus::invalidate_cache();
            Ok(true)
        }
        PreUiAction::RunAuthOnly { reason, notice } => {
            let detected_theme = crate::tui::theme_detect::init_theme_mode();
            let initial_theme =
                ThemeChoice::from_config_str(&crate::config::config().display.theme);
            let outcome = run_pre_ui_setup(PreUiSetupConfig {
                include_theme: false,
                include_auth: true,
                include_security: false,
                reason,
                notice,
                initial_theme,
                detected_theme,
            })
            .await?;
            if outcome == PreUiSetupOutcome::Cancelled {
                return Ok(false);
            }
            crate::auth::AuthStatus::invalidate_cache();
            Ok(true)
        }
        PreUiAction::ValidateApiKeyThenMaybePrompt => {
            if let Some(verdict) = rayu::ensure_api_key_validated_once().await
                && let Some((reason, notice)) = relaunch_notice_for_verdict(verdict)
            {
                let detected_theme = crate::tui::theme_detect::init_theme_mode();
                let initial_theme =
                    ThemeChoice::from_config_str(&crate::config::config().display.theme);
                let outcome = run_pre_ui_setup(PreUiSetupConfig {
                    include_theme: false,
                    include_auth: true,
                    include_security: false,
                    reason,
                    notice: Some(notice),
                    initial_theme,
                    detected_theme,
                })
                .await?;
                if outcome == PreUiSetupOutcome::Cancelled {
                    return Ok(false);
                }
                crate::auth::AuthStatus::invalidate_cache();
                return Ok(true);
            }
            crate::tui::theme_detect::prewarm_theme_mode();
            Ok(true)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_ctx() -> LaunchContext {
        LaunchContext {
            auth_gate_enabled: true,
            is_resuming: false,
            fresh_spawn: false,
            ssh_remote: false,
            onboarding_sim: false,
            is_tty: true,
            onboarding_completed: false,
            has_credentials: false,
            has_usable_session: false,
            has_api_key: false,
        }
    }

    #[test]
    fn fresh_interactive_install_runs_full_first_run_wizard_with_auth() {
        assert_eq!(
            decide_pre_ui_action(base_ctx()),
            PreUiAction::RunFirstRunWizard { include_auth: true }
        );
    }

    #[test]
    fn fresh_install_with_existing_rayu_key_skips_auth_step_only() {
        let mut ctx = base_ctx();
        ctx.has_credentials = true;
        ctx.has_api_key = true;
        assert_eq!(
            decide_pre_ui_action(ctx),
            PreUiAction::RunFirstRunWizard {
                include_auth: false
            }
        );
    }

    #[test]
    fn onboarded_logged_out_user_gets_auth_only_pre_ui_gate() {
        let mut ctx = base_ctx();
        ctx.onboarding_completed = true;
        assert_eq!(
            decide_pre_ui_action(ctx),
            PreUiAction::RunAuthOnly {
                reason: AuthPromptReason::MissingCredentials,
                notice: None,
            }
        );
    }

    #[test]
    fn onboarded_api_key_user_revalidates_before_ui_and_jwt_user_fast_paths() {
        let mut key_ctx = base_ctx();
        key_ctx.onboarding_completed = true;
        key_ctx.has_credentials = true;
        key_ctx.has_api_key = true;
        assert_eq!(
            decide_pre_ui_action(key_ctx),
            PreUiAction::ValidateApiKeyThenMaybePrompt
        );

        let mut jwt_ctx = base_ctx();
        jwt_ctx.onboarding_completed = true;
        jwt_ctx.has_credentials = true;
        jwt_ctx.has_usable_session = true;
        assert_eq!(
            decide_pre_ui_action(jwt_ctx),
            PreUiAction::Proceed {
                prewarm_theme: true
            }
        );
    }

    #[test]
    fn non_tty_without_credentials_fails_fast_and_exec_resume_bypasses_wizard() {
        let mut non_tty = base_ctx();
        non_tty.is_tty = false;
        assert_eq!(
            decide_pre_ui_action(non_tty),
            PreUiAction::FailMissingAuthNonTty
        );

        let mut resuming = base_ctx();
        resuming.is_resuming = true;
        assert_eq!(
            decide_pre_ui_action(resuming),
            PreUiAction::Proceed {
                prewarm_theme: false
            }
        );

        let mut disabled = base_ctx();
        disabled.auth_gate_enabled = false;
        assert_eq!(
            decide_pre_ui_action(disabled),
            PreUiAction::Proceed {
                prewarm_theme: true
            }
        );
    }

    #[test]
    fn relaunch_verdict_only_interrupts_on_invalid_or_no_credit() {
        assert!(matches!(
            relaunch_notice_for_verdict(ApiKeyVerdict::Invalid),
            Some((AuthPromptReason::RelaunchInvalidKey, _))
        ));
        assert!(matches!(
            relaunch_notice_for_verdict(ApiKeyVerdict::NoCredit),
            Some((AuthPromptReason::RelaunchNoCredit, _))
        ));
        assert!(relaunch_notice_for_verdict(ApiKeyVerdict::Valid).is_none());
        assert!(relaunch_notice_for_verdict(ApiKeyVerdict::Unavailable).is_none());
    }
}
