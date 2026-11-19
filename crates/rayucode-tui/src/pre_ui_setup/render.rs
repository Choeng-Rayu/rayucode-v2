//! Rendering for the standalone pre-UI first-launch & Rayu Auth setup wizard.

use crate::tui::brand_banner::{self, BannerVariant};
use crate::tui::color_support::rgb;
use ratatui::prelude::*;
use ratatui::widgets::{Paragraph, Wrap};

use super::state::{AuthPromptReason, AuthSubView, PreUiSetupState, SetupStep, ThemeChoice};

const ACCENT_EMERALD: (u8, u8, u8) = (52, 211, 153);
const ACCENT_CYAN: (u8, u8, u8) = (34, 211, 238);
const ACCENT_AMBER: (u8, u8, u8) = (250, 204, 21);
const ACCENT_RED: (u8, u8, u8) = (248, 113, 113);
const TEXT_PRIMARY: (u8, u8, u8) = (235, 240, 245);
const TEXT_MUTED: (u8, u8, u8) = (148, 163, 184);
const BORDER_DIM: (u8, u8, u8) = (71, 85, 105);

pub(crate) fn render(frame: &mut Frame, state: &PreUiSetupState) {
    let area = frame.area();
    if area.width == 0 || area.height == 0 {
        return;
    }

    let max_content_width = area.width.saturating_sub(4).min(78);
    let left_margin = area.x + area.width.saturating_sub(max_content_width) / 2;
    let content_area = Rect {
        x: left_margin,
        y: area.y.saturating_add(1),
        width: max_content_width,
        height: area.height.saturating_sub(2),
    };

    let mut lines = build_header_lines(content_area.width);
    lines.push(Line::from(""));

    match state.current_step() {
        Some(SetupStep::Theme { selected }) => {
            append_theme_lines(&mut lines, *selected);
        }
        Some(SetupStep::RayuAuth(view)) => {
            append_auth_lines(&mut lines, state, view);
        }
        Some(SetupStep::Security) => {
            append_security_lines(&mut lines);
        }
        None => {}
    }

    if state.ctrl_c_pending() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Press Ctrl+C again to exit",
            Style::default()
                .fg(rgb(ACCENT_AMBER.0, ACCENT_AMBER.1, ACCENT_AMBER.2))
                .add_modifier(Modifier::BOLD),
        )));
    }

    let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false });
    frame.render_widget(paragraph, content_area);
}

fn build_header_lines(max_width: u16) -> Vec<Line<'static>> {
    let mut lines = brand_banner::banner_lines(BannerVariant::Welcome, max_width);
    if !lines.is_empty() {
        lines.push(Line::from(""));
    }
    let version = rayucode_build_meta::version();
    lines.push(
        Line::from(vec![
            Span::styled(
                format!("{} ", brand_banner::BRAND_GLYPH),
                Style::default().fg(rgb(ACCENT_CYAN.0, ACCENT_CYAN.1, ACCENT_CYAN.2)),
            ),
            Span::styled(
                format!("Welcome to Rayu-CLI {version}"),
                Style::default()
                    .fg(rgb(ACCENT_EMERALD.0, ACCENT_EMERALD.1, ACCENT_EMERALD.2))
                    .add_modifier(Modifier::BOLD),
            ),
        ])
        .alignment(Alignment::Center),
    );
    lines.push(
        Line::from(Span::styled(
            "▲ Welcome!, Thank You For Choosing Rayu!",
            Style::default().fg(rgb(34, 224, 99)),
        ))
        .alignment(Alignment::Center),
    );
    lines
}

fn append_theme_lines(lines: &mut Vec<Line<'static>>, selected: usize) {
    let primary = rgb(TEXT_PRIMARY.0, TEXT_PRIMARY.1, TEXT_PRIMARY.2);
    let muted = rgb(TEXT_MUTED.0, TEXT_MUTED.1, TEXT_MUTED.2);
    let emerald = rgb(ACCENT_EMERALD.0, ACCENT_EMERALD.1, ACCENT_EMERALD.2);

    lines.push(Line::from(Span::styled(
        "Let's get started.",
        Style::default().fg(primary),
    )));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Choose the text style that looks best with your terminal",
        Style::default().fg(primary).add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(Span::styled(
        "To change this later, update display.theme in config.toml",
        Style::default().fg(muted),
    )));
    lines.push(Line::from(""));

    for (idx, choice) in ThemeChoice::ALL.iter().enumerate() {
        let is_selected = idx == selected;
        let pointer = if is_selected { "❯ " } else { "  " };
        let label_style = if is_selected {
            Style::default().fg(emerald).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(primary)
        };
        lines.push(Line::from(vec![
            Span::styled(pointer, label_style),
            Span::styled(format!("{}. {}", idx + 1, choice.label()), label_style),
            Span::styled(
                format!("  — {}", choice.description()),
                Style::default().fg(muted),
            ),
        ]));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Preview:",
        Style::default().fg(muted),
    )));
    lines.push(Line::from(vec![
        Span::styled("  + ", Style::default().fg(emerald)),
        Span::styled(
            "fn connect_rayu() -> Result<Session>",
            Style::default().fg(primary),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled(
            "  - ",
            Style::default().fg(rgb(ACCENT_RED.0, ACCENT_RED.1, ACCENT_RED.2)),
        ),
        Span::styled(
            "// unauthenticated startup disabled",
            Style::default().fg(muted),
        ),
    ]));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "↑/↓ navigate · Enter to continue · Ctrl+C twice to exit",
        Style::default().fg(muted),
    )));
}

fn append_auth_lines(lines: &mut Vec<Line<'static>>, state: &PreUiSetupState, view: &AuthSubView) {
    let primary = rgb(TEXT_PRIMARY.0, TEXT_PRIMARY.1, TEXT_PRIMARY.2);
    let muted = rgb(TEXT_MUTED.0, TEXT_MUTED.1, TEXT_MUTED.2);
    let emerald = rgb(ACCENT_EMERALD.0, ACCENT_EMERALD.1, ACCENT_EMERALD.2);
    let cyan = rgb(ACCENT_CYAN.0, ACCENT_CYAN.1, ACCENT_CYAN.2);
    let amber = rgb(ACCENT_AMBER.0, ACCENT_AMBER.1, ACCENT_AMBER.2);
    let red = rgb(ACCENT_RED.0, ACCENT_RED.1, ACCENT_RED.2);
    let border_dim = rgb(BORDER_DIM.0, BORDER_DIM.1, BORDER_DIM.2);

    if let Some(notice) = state.notice.as_deref() {
        lines.push(Line::from(Span::styled(
            format!("! {notice}"),
            Style::default().fg(amber).add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(""));
    }

    match view {
        AuthSubView::Choose {
            selected,
            error,
            esc_hint,
        } => {
            lines.push(Line::from(Span::styled(
                "Connect Rayu",
                Style::default().fg(primary).add_modifier(Modifier::BOLD),
            )));
            let subtitle = match state.reason {
                AuthPromptReason::FirstRun => {
                    "Sign in with your Rayu account or enter a Rayu API key before opening the CLI."
                }
                AuthPromptReason::MissingCredentials => {
                    "You are signed out. Sign in with your Rayu account or enter a Rayu API key to continue."
                }
                AuthPromptReason::RelaunchInvalidKey | AuthPromptReason::RelaunchNoCredit => {
                    "Sign in with your Rayu account or enter a working Rayu API key to continue."
                }
            };
            lines.push(Line::from(Span::styled(
                subtitle,
                Style::default().fg(muted),
            )));
            lines.push(Line::from(""));

            let options = [
                (
                    "Sign in to Rayu",
                    "Recommended — opens your browser for Rayu account login",
                ),
                (
                    "Use a Rayu API key",
                    "Paste a rayu_sk_live_… key from rayucode.com/dashboard/api-keys",
                ),
            ];
            for (idx, (title, subtitle)) in options.iter().enumerate() {
                let is_selected = idx == *selected;
                let pointer = if is_selected { "❯ " } else { "  " };
                let style = if is_selected {
                    Style::default().fg(emerald).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(primary)
                };
                lines.push(Line::from(vec![
                    Span::styled(pointer, style),
                    Span::styled(format!("{}. {title}", idx + 1), style),
                ]));
                lines.push(Line::from(Span::styled(
                    format!("     {subtitle}"),
                    Style::default().fg(muted),
                )));
            }

            if let Some(err) = error {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    format!("Error: {err}"),
                    Style::default().fg(red),
                )));
            }

            lines.push(Line::from(""));
            let hint = if *esc_hint {
                "Rayu authentication is required before opening the CLI · Choose 1 or 2, or press Ctrl+C twice to exit"
            } else {
                "↑/↓ or 1/2 to choose · Enter to continue · Ctrl+C twice to exit"
            };
            lines.push(Line::from(Span::styled(
                hint,
                Style::default().fg(if *esc_hint { amber } else { muted }),
            )));
        }
        AuthSubView::OAuthLogin {
            auth_url,
            browser_suppressed,
            callback_input,
            status,
            error,
            exchanging_callback,
        } => {
            lines.push(Line::from(Span::styled(
                "Sign in to Rayu",
                Style::default().fg(primary).add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));

            let status_prefix = if error.is_some() {
                "!"
            } else {
                &state.spinner_char().to_string()
            };
            let status_color = if error.is_some() { amber } else { emerald };
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{status_prefix} "),
                    Style::default()
                        .fg(status_color)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(status.clone(), Style::default().fg(primary)),
            ]));

            if let Some(url) = auth_url {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "If the browser didn't open, copy and open this URL:",
                    Style::default().fg(muted),
                )));
                lines.push(Line::from(Span::styled(
                    url.clone(),
                    Style::default().fg(cyan).add_modifier(Modifier::UNDERLINED),
                )));
            }

            if *browser_suppressed || !callback_input.is_empty() {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "Remote / SSH browser? Paste the callback URL and press Enter:",
                    Style::default().fg(muted),
                )));
                let display_cb = if callback_input.is_empty() {
                    "http://127.0.0.1:.../callback?code=...&state=...".to_string()
                } else {
                    callback_input.clone()
                };
                let cb_style = if callback_input.is_empty() {
                    Style::default().fg(border_dim)
                } else {
                    Style::default().fg(primary)
                };
                lines.push(Line::from(vec![
                    Span::styled("  > ", Style::default().fg(emerald)),
                    Span::styled(display_cb, cb_style),
                ]));
            }

            if let Some(err) = error {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    err.clone(),
                    Style::default().fg(amber),
                )));
            }

            lines.push(Line::from(""));
            let footer = if *exchanging_callback {
                "Completing sign-in… · Esc to cancel"
            } else if error.is_some() {
                "Enter to retry · Esc to go back · Ctrl+C twice to exit"
            } else {
                "Waiting for browser redirect… · Esc to cancel · Ctrl+C twice to exit"
            };
            lines.push(Line::from(Span::styled(footer, Style::default().fg(muted))));
        }
        AuthSubView::ApiKeyInput {
            input,
            checking,
            error,
        } => {
            lines.push(Line::from(Span::styled(
                "Enter your Rayu API key",
                Style::default().fg(primary).add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(Span::styled(
                "Paste a Rayu API key (rayu_sk_live_…). Create one at https://rayucode.com/dashboard/api-keys.",
                Style::default().fg(muted),
            )));
            lines.push(Line::from(""));

            let masked = "*".repeat(input.chars().count());
            let (display_value, value_style) = if masked.is_empty() {
                (
                    "rayu_sk_live_...".to_string(),
                    Style::default().fg(border_dim),
                )
            } else {
                (masked, Style::default().fg(primary))
            };
            let cursor_suffix = if *checking { "" } else { "▏" };
            lines.push(Line::from(vec![
                Span::styled(
                    "  API key: ",
                    Style::default().fg(emerald).add_modifier(Modifier::BOLD),
                ),
                Span::styled(display_value, value_style),
                Span::styled(cursor_suffix, Style::default().fg(emerald)),
            ]));

            if *checking {
                lines.push(Line::from(""));
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("{} ", state.spinner_char()),
                        Style::default().fg(emerald).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled("Checking your Rayu API key…", Style::default().fg(primary)),
                ]));
            }

            if let Some(err) = error {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    err.clone(),
                    Style::default().fg(amber),
                )));
            }

            lines.push(Line::from(""));
            let footer = if *checking {
                "Validating key against Rayu gateway… · Esc to go back"
            } else {
                "Enter to validate · Esc to go back · Ctrl+C twice to exit"
            };
            lines.push(Line::from(Span::styled(footer, Style::default().fg(muted))));
        }
    }
}

fn append_security_lines(lines: &mut Vec<Line<'static>>) {
    let primary = rgb(TEXT_PRIMARY.0, TEXT_PRIMARY.1, TEXT_PRIMARY.2);
    let muted = rgb(TEXT_MUTED.0, TEXT_MUTED.1, TEXT_MUTED.2);
    let emerald = rgb(ACCENT_EMERALD.0, ACCENT_EMERALD.1, ACCENT_EMERALD.2);

    lines.push(Line::from(Span::styled(
        "Security notes:",
        Style::default().fg(primary).add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    lines.push(Line::from(vec![
        Span::styled(
            "  1. ",
            Style::default().fg(emerald).add_modifier(Modifier::BOLD),
        ),
        Span::styled("Rayu can make mistakes", Style::default().fg(primary)),
    ]));
    lines.push(Line::from(Span::styled(
        "     You should always review Rayu's responses, especially when running code.",
        Style::default().fg(muted),
    )));
    lines.push(Line::from(""));

    lines.push(Line::from(vec![
        Span::styled(
            "  2. ",
            Style::default().fg(emerald).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "Due to prompt injection risks, only use it with code you trust",
            Style::default().fg(primary),
        ),
    ]));
    lines.push(Line::from(Span::styled(
        "     Keep provider credentials scoped and review generated changes before applying them.",
        Style::default().fg(muted),
    )));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Press Enter to continue · Ctrl+C twice to exit",
        Style::default().fg(emerald).add_modifier(Modifier::BOLD),
    )));
}
