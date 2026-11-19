//! Pure state machine for the standalone pre-UI first-launch & Rayu Auth wizard.

use crate::rayu::{ApiKeyVerdict, api_key_verdict_message};
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use rayucode_tui_style::ThemeMode;
use std::time::{Duration, Instant};

const CTRL_C_EXIT_WINDOW: Duration = Duration::from_millis(1500);
const API_KEY_PREFIX: &str = "rayu_sk_live_";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreUiSetupOutcome {
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthPromptReason {
    FirstRun,
    MissingCredentials,
    RelaunchInvalidKey,
    RelaunchNoCredit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeChoice {
    Auto,
    Dark,
    Light,
}

impl ThemeChoice {
    pub const ALL: [Self; 3] = [Self::Auto, Self::Dark, Self::Light];

    pub fn from_config_str(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "dark" => Self::Dark,
            "light" => Self::Light,
            _ => Self::Auto,
        }
    }

    pub fn as_config_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Dark => "dark",
            Self::Light => "light",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Auto => "Auto (match terminal)",
            Self::Dark => "Dark mode",
            Self::Light => "Light mode",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Auto => "Follows your terminal background automatically",
            Self::Dark => "High-contrast dark palette (Rayu default)",
            Self::Light => "Adapted light-background palette",
        }
    }

    pub fn preview_mode(self, detected: ThemeMode) -> ThemeMode {
        match self {
            Self::Auto => detected,
            Self::Dark => ThemeMode::Dark,
            Self::Light => ThemeMode::Light,
        }
    }

    pub fn index(self) -> usize {
        match self {
            Self::Auto => 0,
            Self::Dark => 1,
            Self::Light => 2,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreUiSetupConfig {
    pub include_theme: bool,
    pub include_auth: bool,
    pub include_security: bool,
    pub reason: AuthPromptReason,
    pub notice: Option<String>,
    pub initial_theme: ThemeChoice,
    pub detected_theme: ThemeMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthSubView {
    Choose {
        selected: usize,
        error: Option<String>,
        esc_hint: bool,
    },
    OAuthLogin {
        auth_url: Option<String>,
        browser_suppressed: bool,
        callback_input: String,
        status: String,
        error: Option<String>,
        exchanging_callback: bool,
    },
    ApiKeyInput {
        input: String,
        checking: bool,
        error: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupStep {
    Theme { selected: usize },
    RayuAuth(AuthSubView),
    Security,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupEffect {
    PreviewTheme(ThemeMode),
    SaveTheme(ThemeChoice),
    StartOAuthLogin,
    SubmitCallbackUrl(String),
    CancelOAuthLogin,
    ValidateApiKey(String),
    Completed,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct PreUiSetupState {
    pub(crate) steps: Vec<SetupStep>,
    pub(crate) step_index: usize,
    pub(crate) detected_theme: ThemeMode,
    pub(crate) reason: AuthPromptReason,
    pub(crate) notice: Option<String>,
    pub(crate) ctrl_c_armed_at: Option<Instant>,
    pub(crate) spinner_tick: usize,
}

impl PreUiSetupState {
    /// Construct the wizard with a frozen step list (matching `rayu-legacy`'s
    /// `Onboarding.tsx` so mid-flow auth completion never shifts step indices).
    pub fn new(config: PreUiSetupConfig) -> Self {
        let mut steps = Vec::new();
        if config.include_theme {
            steps.push(SetupStep::Theme {
                selected: config.initial_theme.index(),
            });
        }
        if config.include_auth {
            steps.push(SetupStep::RayuAuth(AuthSubView::Choose {
                selected: 0,
                error: None,
                esc_hint: false,
            }));
        }
        if config.include_security {
            steps.push(SetupStep::Security);
        }
        Self {
            steps,
            step_index: 0,
            detected_theme: config.detected_theme,
            reason: config.reason,
            notice: config.notice,
            ctrl_c_armed_at: None,
            spinner_tick: 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn current_step(&self) -> Option<&SetupStep> {
        self.steps.get(self.step_index)
    }

    pub fn ctrl_c_pending(&self) -> bool {
        self.ctrl_c_armed_at.is_some()
    }

    pub fn spinner_char(&self) -> char {
        const FRAMES: [char; 10] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        FRAMES[self.spinner_tick % FRAMES.len()]
    }

    pub fn tick(&mut self, now: Instant) {
        self.spinner_tick = self.spinner_tick.wrapping_add(1);
        if let Some(armed_at) = self.ctrl_c_armed_at
            && now.saturating_duration_since(armed_at) >= CTRL_C_EXIT_WINDOW
        {
            self.ctrl_c_armed_at = None;
        }
    }

    pub fn handle_key(&mut self, key: KeyEvent, now: Instant) -> Vec<SetupEffect> {
        if key.kind == KeyEventKind::Release {
            return Vec::new();
        }
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            return self.handle_ctrl_c(now);
        }
        self.ctrl_c_armed_at = None;

        match self.steps.get_mut(self.step_index) {
            Some(SetupStep::Theme { .. }) => self.handle_theme_key(key),
            Some(SetupStep::RayuAuth(_)) => self.handle_auth_key(key),
            Some(SetupStep::Security) => self.handle_security_key(key),
            None => vec![SetupEffect::Completed],
        }
    }

    pub fn handle_paste(&mut self, pasted: &str) -> Vec<SetupEffect> {
        self.ctrl_c_armed_at = None;
        let cleaned = sanitize_pasted_single_line(pasted);
        if cleaned.is_empty() {
            return Vec::new();
        }
        match self.steps.get_mut(self.step_index) {
            Some(SetupStep::RayuAuth(AuthSubView::ApiKeyInput {
                input,
                checking,
                error,
            })) if !*checking => {
                input.push_str(&cleaned);
                *error = None;
            }
            Some(SetupStep::RayuAuth(AuthSubView::OAuthLogin {
                callback_input,
                exchanging_callback,
                error,
                ..
            })) if !*exchanging_callback => {
                callback_input.push_str(&cleaned);
                *error = None;
            }
            _ => {}
        }
        Vec::new()
    }

    pub fn on_oauth_prepared(&mut self, url: String, browser_suppressed: bool) {
        if let Some(SetupStep::RayuAuth(AuthSubView::OAuthLogin {
            auth_url,
            browser_suppressed: suppressed,
            status,
            error,
            ..
        })) = self.steps.get_mut(self.step_index)
        {
            *auth_url = Some(url);
            *suppressed = browser_suppressed;
            *error = None;
            *status = if browser_suppressed {
                "Open this URL in your browser to sign in:".to_string()
            } else {
                "Opening your browser to sign in…".to_string()
            };
        }
    }

    pub fn on_oauth_failed(&mut self, message: String) {
        if let Some(SetupStep::RayuAuth(AuthSubView::OAuthLogin {
            status,
            error,
            exchanging_callback,
            ..
        })) = self.steps.get_mut(self.step_index)
        {
            *exchanging_callback = false;
            *status = "Sign-in did not complete.".to_string();
            *error = Some(message);
        }
    }

    pub fn on_oauth_succeeded(&mut self) -> Vec<SetupEffect> {
        self.advance_step()
    }

    pub fn on_api_key_result(
        &mut self,
        verdict: ApiKeyVerdict,
        save_error: Option<String>,
    ) -> Vec<SetupEffect> {
        if verdict == ApiKeyVerdict::Valid && save_error.is_none() {
            return self.advance_step();
        }
        if let Some(SetupStep::RayuAuth(AuthSubView::ApiKeyInput {
            checking, error, ..
        })) = self.steps.get_mut(self.step_index)
        {
            *checking = false;
            *error =
                save_error.or_else(|| api_key_verdict_message(verdict).map(ToString::to_string));
        }
        Vec::new()
    }

    fn handle_ctrl_c(&mut self, now: Instant) -> Vec<SetupEffect> {
        if let Some(armed_at) = self.ctrl_c_armed_at
            && now.saturating_duration_since(armed_at) < CTRL_C_EXIT_WINDOW
        {
            let mut effects = Vec::new();
            if matches!(
                self.current_step(),
                Some(SetupStep::RayuAuth(AuthSubView::OAuthLogin { .. }))
            ) {
                effects.push(SetupEffect::CancelOAuthLogin);
            }
            effects.push(SetupEffect::Cancelled);
            return effects;
        }
        self.ctrl_c_armed_at = Some(now);
        Vec::new()
    }

    fn handle_theme_key(&mut self, key: KeyEvent) -> Vec<SetupEffect> {
        let Some(SetupStep::Theme { selected }) = self.steps.get_mut(self.step_index) else {
            return Vec::new();
        };
        let count = ThemeChoice::ALL.len();
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                *selected = (*selected + count - 1) % count;
                let choice = ThemeChoice::ALL[*selected];
                vec![SetupEffect::PreviewTheme(
                    choice.preview_mode(self.detected_theme),
                )]
            }
            KeyCode::Down | KeyCode::Char('j') => {
                *selected = (*selected + 1) % count;
                let choice = ThemeChoice::ALL[*selected];
                vec![SetupEffect::PreviewTheme(
                    choice.preview_mode(self.detected_theme),
                )]
            }
            KeyCode::Char('1') => {
                *selected = 0;
                vec![SetupEffect::PreviewTheme(
                    ThemeChoice::Auto.preview_mode(self.detected_theme),
                )]
            }
            KeyCode::Char('2') => {
                *selected = 1;
                vec![SetupEffect::PreviewTheme(ThemeMode::Dark)]
            }
            KeyCode::Char('3') => {
                *selected = 2;
                vec![SetupEffect::PreviewTheme(ThemeMode::Light)]
            }
            KeyCode::Enter => {
                let choice = ThemeChoice::ALL[*selected];
                let mut effects = vec![
                    SetupEffect::PreviewTheme(choice.preview_mode(self.detected_theme)),
                    SetupEffect::SaveTheme(choice),
                ];
                effects.extend(self.advance_step());
                effects
            }
            _ => Vec::new(),
        }
    }

    fn handle_auth_key(&mut self, key: KeyEvent) -> Vec<SetupEffect> {
        let Some(SetupStep::RayuAuth(view)) = self.steps.get_mut(self.step_index) else {
            return Vec::new();
        };
        match view {
            AuthSubView::Choose {
                selected,
                error,
                esc_hint,
            } => match key.code {
                KeyCode::Up | KeyCode::Char('k') => {
                    *selected = if *selected == 0 { 1 } else { 0 };
                    *esc_hint = false;
                    Vec::new()
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    *selected = (*selected + 1) % 2;
                    *esc_hint = false;
                    Vec::new()
                }
                KeyCode::Char('1') => {
                    *selected = 0;
                    *error = None;
                    *view = new_oauth_view();
                    vec![SetupEffect::StartOAuthLogin]
                }
                KeyCode::Char('2') => {
                    *selected = 1;
                    *error = None;
                    *view = AuthSubView::ApiKeyInput {
                        input: String::new(),
                        checking: false,
                        error: None,
                    };
                    Vec::new()
                }
                KeyCode::Enter => {
                    let chosen = *selected;
                    *error = None;
                    if chosen == 0 {
                        *view = new_oauth_view();
                        vec![SetupEffect::StartOAuthLogin]
                    } else {
                        *view = AuthSubView::ApiKeyInput {
                            input: String::new(),
                            checking: false,
                            error: None,
                        };
                        Vec::new()
                    }
                }
                KeyCode::Esc => {
                    *esc_hint = true;
                    Vec::new()
                }
                _ => Vec::new(),
            },
            AuthSubView::OAuthLogin {
                callback_input,
                status,
                error,
                exchanging_callback,
                ..
            } => match key.code {
                KeyCode::Esc => {
                    *view = AuthSubView::Choose {
                        selected: 0,
                        error: None,
                        esc_hint: false,
                    };
                    vec![SetupEffect::CancelOAuthLogin]
                }
                KeyCode::Backspace if !*exchanging_callback => {
                    callback_input.pop();
                    *error = None;
                    Vec::new()
                }
                KeyCode::Char('u')
                    if key.modifiers.contains(KeyModifiers::CONTROL) && !*exchanging_callback =>
                {
                    callback_input.clear();
                    *error = None;
                    Vec::new()
                }
                KeyCode::Enter if !*exchanging_callback => {
                    let trimmed = callback_input.trim().to_string();
                    if !trimmed.is_empty() {
                        *exchanging_callback = true;
                        *error = None;
                        *status = "Completing sign-in from pasted callback URL…".to_string();
                        vec![SetupEffect::SubmitCallbackUrl(trimmed)]
                    } else if error.is_some() {
                        *view = new_oauth_view();
                        vec![SetupEffect::StartOAuthLogin]
                    } else {
                        Vec::new()
                    }
                }
                KeyCode::Char(ch)
                    if !*exchanging_callback
                        && !key.modifiers.contains(KeyModifiers::CONTROL)
                        && !key.modifiers.contains(KeyModifiers::ALT) =>
                {
                    callback_input.push(ch);
                    *error = None;
                    Vec::new()
                }
                _ => Vec::new(),
            },
            AuthSubView::ApiKeyInput {
                input,
                checking,
                error,
            } => {
                if *checking {
                    if key.code == KeyCode::Esc {
                        *view = AuthSubView::Choose {
                            selected: 1,
                            error: None,
                            esc_hint: false,
                        };
                    }
                    return Vec::new();
                }
                match key.code {
                    KeyCode::Esc => {
                        *view = AuthSubView::Choose {
                            selected: 1,
                            error: None,
                            esc_hint: false,
                        };
                        Vec::new()
                    }
                    KeyCode::Backspace => {
                        input.pop();
                        *error = None;
                        Vec::new()
                    }
                    KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        input.clear();
                        *error = None;
                        Vec::new()
                    }
                    KeyCode::Enter => {
                        let trimmed = input
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .trim()
                            .to_string();
                        if trimmed.is_empty() {
                            *error = Some(
                                "Paste your Rayu API key (starts with 'rayu_sk_live_')."
                                    .to_string(),
                            );
                            return Vec::new();
                        }
                        if !trimmed.starts_with(API_KEY_PREFIX) {
                            *error = Some("Rayu API keys start with 'rayu_sk_live_'.".to_string());
                            return Vec::new();
                        }
                        *checking = true;
                        *error = None;
                        vec![SetupEffect::ValidateApiKey(trimmed)]
                    }
                    KeyCode::Char(ch)
                        if !key.modifiers.contains(KeyModifiers::CONTROL)
                            && !key.modifiers.contains(KeyModifiers::ALT) =>
                    {
                        input.push(ch);
                        *error = None;
                        Vec::new()
                    }
                    _ => Vec::new(),
                }
            }
        }
    }

    fn handle_security_key(&mut self, key: KeyEvent) -> Vec<SetupEffect> {
        match key.code {
            KeyCode::Enter | KeyCode::Char(' ') => self.advance_step(),
            _ => Vec::new(),
        }
    }

    fn advance_step(&mut self) -> Vec<SetupEffect> {
        if self.step_index + 1 < self.steps.len() {
            self.step_index += 1;
            Vec::new()
        } else {
            self.step_index = self.steps.len();
            vec![SetupEffect::Completed]
        }
    }
}

fn new_oauth_view() -> AuthSubView {
    AuthSubView::OAuthLogin {
        auth_url: None,
        browser_suppressed: false,
        callback_input: String::new(),
        status: "Starting local sign-in callback…".to_string(),
        error: None,
        exchanging_callback: false,
    }
}

fn sanitize_pasted_single_line(raw: &str) -> String {
    raw.chars()
        .filter(|ch| !matches!(ch, '\r' | '\n' | '\t'))
        .collect::<String>()
        .trim()
        .to_string()
}
