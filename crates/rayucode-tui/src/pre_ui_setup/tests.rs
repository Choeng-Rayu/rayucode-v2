use super::render;
use super::state::{
    AuthPromptReason, AuthSubView, PreUiSetupConfig, PreUiSetupState, SetupEffect, SetupStep,
    ThemeChoice,
};
use crate::rayu::ApiKeyVerdict;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use rayucode_tui_style::ThemeMode;
use std::time::{Duration, Instant};

fn press(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn ctrl(ch: char) -> KeyEvent {
    KeyEvent::new(KeyCode::Char(ch), KeyModifiers::CONTROL)
}

fn first_run_config() -> PreUiSetupConfig {
    PreUiSetupConfig {
        include_theme: true,
        include_auth: true,
        include_security: true,
        reason: AuthPromptReason::FirstRun,
        notice: None,
        initial_theme: ThemeChoice::Auto,
        detected_theme: ThemeMode::Dark,
    }
}

fn render_to_string(state: &PreUiSetupState) -> String {
    let backend = TestBackend::new(90, 32);
    let mut terminal = Terminal::new(backend).unwrap();
    terminal.draw(|frame| render::render(frame, state)).unwrap();
    let buf = terminal.backend().buffer();
    let mut out = String::new();
    for y in 0..buf.area.height {
        for x in 0..buf.area.width {
            out.push_str(buf[(x, y)].symbol());
        }
        out.push('\n');
    }
    out
}

#[test]
fn first_run_wizard_runs_theme_then_auth_then_security_and_freezes_steps() {
    let mut state = PreUiSetupState::new(first_run_config());
    let now = Instant::now();

    assert_eq!(state.steps.len(), 3);
    assert!(matches!(
        state.current_step(),
        Some(SetupStep::Theme { selected: 0 })
    ));

    // Down selects Dark mode and previews it immediately.
    let effects = state.handle_key(press(KeyCode::Down), now);
    assert_eq!(effects, vec![SetupEffect::PreviewTheme(ThemeMode::Dark)]);
    assert!(matches!(
        state.current_step(),
        Some(SetupStep::Theme { selected: 1 })
    ));

    // Down again selects Light mode.
    let effects = state.handle_key(press(KeyCode::Down), now);
    assert_eq!(effects, vec![SetupEffect::PreviewTheme(ThemeMode::Light)]);

    // Enter saves Light mode and advances to RayuAuth(Choose).
    let effects = state.handle_key(press(KeyCode::Enter), now);
    assert_eq!(
        effects,
        vec![
            SetupEffect::PreviewTheme(ThemeMode::Light),
            SetupEffect::SaveTheme(ThemeChoice::Light),
        ]
    );
    assert!(matches!(
        state.current_step(),
        Some(SetupStep::RayuAuth(AuthSubView::Choose { selected: 0, .. }))
    ));

    // Esc on root Choose MUST NOT bypass into main UI.
    let effects = state.handle_key(press(KeyCode::Esc), now);
    assert!(effects.is_empty());
    assert!(matches!(
        state.current_step(),
        Some(SetupStep::RayuAuth(AuthSubView::Choose {
            esc_hint: true,
            ..
        }))
    ));

    // Selecting option 1 starts OAuth login.
    let effects = state.handle_key(press(KeyCode::Char('1')), now);
    assert_eq!(effects, vec![SetupEffect::StartOAuthLogin]);
    assert!(matches!(
        state.current_step(),
        Some(SetupStep::RayuAuth(AuthSubView::OAuthLogin { .. }))
    ));

    // OAuth URL renders visibly so users can copy/paste it.
    let url = "https://rayucode.com/cli-login?port=41234&state=deadbeef".to_string();
    state.on_oauth_prepared(url.clone(), false);
    let screen = render_to_string(&state);
    assert!(screen.contains(&url));
    assert!(screen.contains("Sign in to Rayu"));

    // Completing OAuth advances to Security (frozen step list keeps index valid!).
    let effects = state.on_oauth_succeeded();
    assert!(effects.is_empty());
    assert!(matches!(state.current_step(), Some(SetupStep::Security)));

    // Enter on Security completes the wizard.
    let effects = state.handle_key(press(KeyCode::Enter), now);
    assert_eq!(effects, vec![SetupEffect::Completed]);
}

#[test]
fn oauth_cancel_and_error_return_cleanly_without_bypassing() {
    let mut state = PreUiSetupState::new(PreUiSetupConfig {
        include_theme: false,
        include_auth: true,
        include_security: false,
        reason: AuthPromptReason::MissingCredentials,
        notice: None,
        initial_theme: ThemeChoice::Auto,
        detected_theme: ThemeMode::Dark,
    });
    let now = Instant::now();

    assert_eq!(
        state.handle_key(press(KeyCode::Enter), now),
        vec![SetupEffect::StartOAuthLogin]
    );

    // Esc cancels the loopback listener and returns to the 2-option menu.
    assert_eq!(
        state.handle_key(press(KeyCode::Esc), now),
        vec![SetupEffect::CancelOAuthLogin]
    );
    assert!(matches!(
        state.current_step(),
        Some(SetupStep::RayuAuth(AuthSubView::Choose { selected: 0, .. }))
    ));

    // Pasted callback URL submits directly for SSH/headless login.
    assert_eq!(
        state.handle_key(press(KeyCode::Char('1')), now),
        vec![SetupEffect::StartOAuthLogin]
    );
    state.on_oauth_prepared(
        "https://rayucode.com/cli-login?port=99&state=abc".into(),
        true,
    );
    state.handle_paste("http://127.0.0.1:99/callback?code=c1&state=abc\n");
    assert_eq!(
        state.handle_key(press(KeyCode::Enter), now),
        vec![SetupEffect::SubmitCallbackUrl(
            "http://127.0.0.1:99/callback?code=c1&state=abc".to_string()
        )]
    );

    // OAuth failure keeps user inside OAuth screen with retry or Esc back to Choose.
    state.on_oauth_failed("Token exchange failed".into());
    let screen = render_to_string(&state);
    assert!(screen.contains("Token exchange failed"));
}

#[test]
fn api_key_input_masks_secret_validates_prefix_and_handles_all_verdicts() {
    let mut state = PreUiSetupState::new(PreUiSetupConfig {
        include_theme: false,
        include_auth: true,
        include_security: false,
        reason: AuthPromptReason::RelaunchInvalidKey,
        notice: Some("Your saved Rayu API key was rejected.".to_string()),
        initial_theme: ThemeChoice::Dark,
        detected_theme: ThemeMode::Dark,
    });
    let now = Instant::now();

    let choose_screen = render_to_string(&state);
    assert!(choose_screen.contains("Your saved Rayu API key was rejected."));
    assert!(choose_screen.contains("Sign in to Rayu"));
    assert!(choose_screen.contains("Use a Rayu API key"));

    // Choose option 2 (API key).
    assert!(state.handle_key(press(KeyCode::Char('2')), now).is_empty());

    // Wrong prefix is rejected inline before hitting network.
    state.handle_paste("sk-not-a-rayu-key");
    assert!(state.handle_key(press(KeyCode::Enter), now).is_empty());
    let err_screen = render_to_string(&state);
    assert!(err_screen.contains("rayu_sk_live_"));
    assert!(!err_screen.contains("sk-not-a-rayu-key"));

    // Clear with Ctrl+U and paste a properly prefixed secret key.
    assert!(state.handle_key(ctrl('u'), now).is_empty());
    let secret = "rayu_sk_live_SUPER_SECRET_TOKEN_12345";
    state.handle_paste(&format!("  {secret}\n"));
    let masked_screen = render_to_string(&state);
    assert!(masked_screen.contains(&"*".repeat(secret.len())));
    assert!(!masked_screen.contains(secret));

    // Submitting emits ValidateApiKey with trimmed key.
    assert_eq!(
        state.handle_key(press(KeyCode::Enter), now),
        vec![SetupEffect::ValidateApiKey(secret.to_string())]
    );
    let checking_screen = render_to_string(&state);
    assert!(checking_screen.contains("Checking your Rayu API key"));

    // Invalid, NoCredit, and Unavailable verdicts stay on the input with an error.
    for verdict in [
        ApiKeyVerdict::Invalid,
        ApiKeyVerdict::NoCredit,
        ApiKeyVerdict::Unavailable,
    ] {
        let effects = state.on_api_key_result(verdict, None);
        assert!(effects.is_empty());
        assert!(matches!(
            state.current_step(),
            Some(SetupStep::RayuAuth(AuthSubView::ApiKeyInput {
                checking: false,
                error: Some(_),
                ..
            }))
        ));
    }

    // Valid verdict completes the auth-only wizard.
    assert_eq!(
        state.on_api_key_result(ApiKeyVerdict::Valid, None),
        vec![SetupEffect::Completed]
    );
}

#[test]
fn double_ctrl_c_cancels_setup_before_entering_main_ui() {
    let mut state = PreUiSetupState::new(first_run_config());
    let t0 = Instant::now();

    // First Ctrl+C arms exit confirmation without cancelling yet.
    assert!(state.handle_key(ctrl('c'), t0).is_empty());
    assert!(state.ctrl_c_pending());
    assert!(render_to_string(&state).contains("Press Ctrl+C again to exit"));

    // Waiting past the 1.5s window clears the pending state.
    state.tick(t0 + Duration::from_secs(2));
    assert!(!state.ctrl_c_pending());

    // Pressing Ctrl+C twice within the window returns Cancelled.
    let t1 = t0 + Duration::from_secs(3);
    assert!(state.handle_key(ctrl('c'), t1).is_empty());
    assert_eq!(
        state.handle_key(ctrl('c'), t1 + Duration::from_millis(300)),
        vec![SetupEffect::Cancelled]
    );
}
