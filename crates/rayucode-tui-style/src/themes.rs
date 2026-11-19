//! Native Rayu theme presets (`dark`, `light`, `dark-daltonized`,
//! `light-daltonized`, `dark-ansi`, `light-ansi`, `auto`, `classic`).

use crate::color::rgb;
use crate::palette::{Role, configured_palette};
use crate::theme_mode::{ThemeMode, is_light_theme, set_theme_mode};
use ratatui::style::Color;
use std::sync::atomic::{AtomicU8, Ordering};

/// Named theme presets for the `/theme` picker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ThemePreset {
    #[default]
    Auto = 0,
    Dark = 1,
    Light = 2,
    DarkDaltonized = 3,
    LightDaltonized = 4,
    DarkAnsi = 5,
    LightAnsi = 6,
    Classic = 7,
}

pub const ALL_THEME_PRESETS: &[ThemePreset] = &[
    ThemePreset::Dark,
    ThemePreset::Light,
    ThemePreset::DarkDaltonized,
    ThemePreset::LightDaltonized,
    ThemePreset::DarkAnsi,
    ThemePreset::LightAnsi,
    ThemePreset::Auto,
    ThemePreset::Classic,
];

static ACTIVE_PRESET: AtomicU8 = AtomicU8::new(ThemePreset::Auto as u8);

impl ThemePreset {
    pub fn id(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Dark => "dark",
            Self::Light => "light",
            Self::DarkDaltonized => "dark-daltonized",
            Self::LightDaltonized => "light-daltonized",
            Self::DarkAnsi => "dark-ansi",
            Self::LightAnsi => "light-ansi",
            Self::Classic => "classic",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Auto => "Auto (match terminal)",
            Self::Dark => "Dark mode",
            Self::Light => "Light mode",
            Self::DarkDaltonized => "Dark mode (colorblind-friendly)",
            Self::LightDaltonized => "Light mode (colorblind-friendly)",
            Self::DarkAnsi => "Dark mode (ANSI colors only)",
            Self::LightAnsi => "Light mode (ANSI colors only)",
            Self::Classic => "Classic (legacy palette)",
        }
    }

    pub fn from_name(raw: &str) -> Option<Self> {
        let normalized = raw.trim().to_ascii_lowercase().replace('_', "-");
        match normalized.as_str() {
            "auto" | "system" | "default" => Some(Self::Auto),
            "dark" | "rayu-dark" => Some(Self::Dark),
            "light" | "rayu-light" => Some(Self::Light),
            "dark-daltonized" | "daltonized-dark" => Some(Self::DarkDaltonized),
            "light-daltonized" | "daltonized-light" => Some(Self::LightDaltonized),
            "dark-ansi" | "ansi-dark" => Some(Self::DarkAnsi),
            "light-ansi" | "ansi-light" => Some(Self::LightAnsi),
            "classic" | "legacy" => Some(Self::Classic),
            _ => None,
        }
    }

    /// Resolve `Auto` against current terminal light/dark mode.
    pub fn resolved(self) -> Self {
        match self {
            Self::Auto => {
                if is_light_theme() {
                    Self::Light
                } else {
                    Self::Dark
                }
            }
            other => other,
        }
    }

    pub fn is_light(self) -> bool {
        matches!(
            self.resolved(),
            Self::Light | Self::LightDaltonized | Self::LightAnsi
        )
    }
}

/// Set the active `rayu-cli` theme preset.
pub fn set_theme_preset(preset: ThemePreset) {
    ACTIVE_PRESET.store(preset as u8, Ordering::Relaxed);
    match preset {
        ThemePreset::Light | ThemePreset::LightDaltonized | ThemePreset::LightAnsi => {
            set_theme_mode(ThemeMode::Light);
        }
        ThemePreset::Dark
        | ThemePreset::DarkDaltonized
        | ThemePreset::DarkAnsi
        | ThemePreset::Classic => {
            set_theme_mode(ThemeMode::Dark);
        }
        ThemePreset::Auto => {}
    }
}

/// Get the configured `rayu-cli` theme preset (may be `ThemePreset::Auto`).
pub fn theme_preset() -> ThemePreset {
    match ACTIVE_PRESET.load(Ordering::Relaxed) {
        1 => ThemePreset::Dark,
        2 => ThemePreset::Light,
        3 => ThemePreset::DarkDaltonized,
        4 => ThemePreset::LightDaltonized,
        5 => ThemePreset::DarkAnsi,
        6 => ThemePreset::LightAnsi,
        7 => ThemePreset::Classic,
        _ => ThemePreset::Auto,
    }
}

/// Complete semantic color table for Rayu TUI themes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RayuThemeTokens {
    pub brand: (u8, u8, u8),
    pub brand_shimmer: (u8, u8, u8),
    pub header_border: (u8, u8, u8),
    pub prompt_char: (u8, u8, u8),
    pub prompt_border: (u8, u8, u8),
    pub prompt_border_shimmer: (u8, u8, u8),
    pub bash_border: (u8, u8, u8),
    pub permission: (u8, u8, u8),
    pub permission_shimmer: (u8, u8, u8),
    pub suggestion: (u8, u8, u8),
    pub plan_mode: (u8, u8, u8),
    pub auto_accept: (u8, u8, u8),
    pub fast_mode: (u8, u8, u8),
    pub fast_mode_shimmer: (u8, u8, u8),
    pub text: (u8, u8, u8),
    pub inverse_text: (u8, u8, u8),
    pub inactive: (u8, u8, u8),
    pub inactive_shimmer: (u8, u8, u8),
    pub subtle: (u8, u8, u8),
    pub success: (u8, u8, u8),
    pub error: (u8, u8, u8),
    pub warning: (u8, u8, u8),
    pub warning_shimmer: (u8, u8, u8),
    pub user_message_bg: (u8, u8, u8),
    pub user_message_bg_hover: (u8, u8, u8),
    pub bash_message_bg: (u8, u8, u8),
    pub memory_bg: (u8, u8, u8),
    pub selection_bg: (u8, u8, u8),
    pub spinner_glyph: (u8, u8, u8),
    pub diff_added: (u8, u8, u8),
    pub diff_removed: (u8, u8, u8),
    pub diff_added_dimmed: (u8, u8, u8),
    pub diff_removed_dimmed: (u8, u8, u8),
    pub diff_added_word: (u8, u8, u8),
    pub diff_removed_word: (u8, u8, u8),
    pub tool_execute: (u8, u8, u8),
    pub tool_read: (u8, u8, u8),
    pub tool_search: (u8, u8, u8),
    pub tool_edit: (u8, u8, u8),
    pub tool_web: (u8, u8, u8),
    pub tool_task: (u8, u8, u8),
    pub rate_limit_fill: (u8, u8, u8),
    pub rate_limit_empty: (u8, u8, u8),
}

pub const RAYU_DARK_TOKENS: RayuThemeTokens = RayuThemeTokens {
    brand: (70, 190, 130),
    brand_shimmer: (120, 220, 165),
    header_border: (91, 245, 141),
    prompt_char: (0, 255, 136),
    prompt_border: (136, 136, 136),
    prompt_border_shimmer: (166, 166, 166),
    bash_border: (253, 93, 177),
    permission: (177, 185, 249),
    permission_shimmer: (207, 215, 255),
    suggestion: (177, 185, 249),
    plan_mode: (72, 150, 140),
    auto_accept: (175, 135, 255),
    fast_mode: (255, 120, 20),
    fast_mode_shimmer: (255, 165, 70),
    text: (255, 255, 255),
    inverse_text: (0, 0, 0),
    inactive: (153, 153, 153),
    inactive_shimmer: (193, 193, 193),
    subtle: (80, 80, 80),
    success: (78, 186, 101),
    error: (255, 107, 128),
    warning: (255, 193, 7),
    warning_shimmer: (255, 223, 57),
    user_message_bg: (55, 55, 55),
    user_message_bg_hover: (70, 70, 70),
    bash_message_bg: (65, 60, 65),
    memory_bg: (55, 65, 70),
    selection_bg: (38, 79, 120),
    spinner_glyph: (164, 101, 101),
    diff_added: (34, 92, 43),
    diff_removed: (122, 41, 54),
    diff_added_dimmed: (71, 88, 74),
    diff_removed_dimmed: (105, 72, 77),
    diff_added_word: (56, 166, 96),
    diff_removed_word: (179, 89, 107),
    tool_execute: (255, 199, 89),
    tool_read: (94, 201, 138),
    tool_search: (86, 194, 214),
    tool_edit: (240, 150, 90),
    tool_web: (197, 160, 255),
    tool_task: (122, 162, 247),
    rate_limit_fill: (177, 185, 249),
    rate_limit_empty: (80, 83, 112),
};

pub const RAYU_LIGHT_TOKENS: RayuThemeTokens = RayuThemeTokens {
    brand: (44, 122, 57),
    brand_shimmer: (80, 165, 95),
    header_border: (44, 122, 57),
    prompt_char: (44, 122, 57),
    prompt_border: (153, 153, 153),
    prompt_border_shimmer: (123, 123, 123),
    bash_border: (255, 0, 135),
    permission: (87, 105, 247),
    permission_shimmer: (137, 155, 255),
    suggestion: (87, 105, 247),
    plan_mode: (51, 102, 102),
    auto_accept: (135, 0, 255),
    fast_mode: (215, 95, 0),
    fast_mode_shimmer: (240, 135, 40),
    text: (0, 0, 0),
    inverse_text: (255, 255, 255),
    inactive: (102, 102, 102),
    inactive_shimmer: (62, 62, 62),
    subtle: (175, 175, 175),
    success: (44, 122, 57),
    error: (171, 43, 63),
    warning: (150, 108, 30),
    warning_shimmer: (180, 138, 60),
    user_message_bg: (240, 240, 240),
    user_message_bg_hover: (228, 228, 228),
    bash_message_bg: (245, 238, 244),
    memory_bg: (235, 245, 248),
    selection_bg: (180, 213, 255),
    spinner_glyph: (164, 101, 101),
    diff_added: (105, 219, 124),
    diff_removed: (255, 168, 180),
    diff_added_dimmed: (199, 225, 203),
    diff_removed_dimmed: (253, 210, 216),
    diff_added_word: (47, 157, 68),
    diff_removed_word: (209, 69, 75),
    tool_execute: (176, 122, 0),
    tool_read: (34, 134, 80),
    tool_search: (0, 132, 150),
    tool_edit: (196, 90, 20),
    tool_web: (124, 58, 205),
    tool_task: (37, 99, 235),
    rate_limit_fill: (87, 105, 247),
    rate_limit_empty: (39, 47, 111),
};

pub const RAYU_DARK_DALTONIZED_TOKENS: RayuThemeTokens = RayuThemeTokens {
    brand: (70, 190, 130),
    brand_shimmer: (120, 220, 165),
    header_border: (91, 245, 141),
    prompt_char: (51, 175, 255),
    prompt_border: (136, 136, 136),
    prompt_border_shimmer: (166, 166, 166),
    bash_border: (253, 93, 177),
    permission: (153, 204, 255),
    permission_shimmer: (183, 224, 255),
    suggestion: (153, 204, 255),
    plan_mode: (102, 153, 204),
    auto_accept: (175, 135, 255),
    fast_mode: (255, 120, 20),
    fast_mode_shimmer: (255, 165, 70),
    text: (255, 255, 255),
    inverse_text: (0, 0, 0),
    inactive: (153, 153, 153),
    inactive_shimmer: (193, 193, 193),
    subtle: (80, 80, 80),
    success: (51, 153, 255),
    error: (255, 102, 102),
    warning: (255, 204, 0),
    warning_shimmer: (255, 234, 50),
    user_message_bg: (55, 55, 55),
    user_message_bg_hover: (70, 70, 70),
    bash_message_bg: (65, 60, 65),
    memory_bg: (55, 65, 70),
    selection_bg: (38, 79, 120),
    spinner_glyph: (164, 101, 101),
    diff_added: (32, 64, 96),
    diff_removed: (108, 48, 48),
    diff_added_dimmed: (58, 76, 94),
    diff_removed_dimmed: (94, 68, 68),
    diff_added_word: (51, 153, 255),
    diff_removed_word: (224, 92, 92),
    tool_execute: (255, 199, 89),
    tool_read: (86, 194, 214),
    tool_search: (122, 162, 247),
    tool_edit: (240, 150, 90),
    tool_web: (197, 160, 255),
    tool_task: (153, 204, 255),
    rate_limit_fill: (153, 204, 255),
    rate_limit_empty: (69, 92, 115),
};

pub const RAYU_LIGHT_DALTONIZED_TOKENS: RayuThemeTokens = RayuThemeTokens {
    brand: (44, 122, 57),
    brand_shimmer: (80, 165, 95),
    header_border: (44, 122, 57),
    prompt_char: (0, 102, 204),
    prompt_border: (153, 153, 153),
    prompt_border_shimmer: (123, 123, 123),
    bash_border: (255, 0, 135),
    permission: (51, 102, 255),
    permission_shimmer: (101, 152, 255),
    suggestion: (51, 102, 255),
    plan_mode: (51, 102, 153),
    auto_accept: (135, 0, 255),
    fast_mode: (215, 95, 0),
    fast_mode_shimmer: (240, 135, 40),
    text: (0, 0, 0),
    inverse_text: (255, 255, 255),
    inactive: (102, 102, 102),
    inactive_shimmer: (62, 62, 62),
    subtle: (175, 175, 175),
    success: (0, 102, 153),
    error: (204, 0, 0),
    warning: (255, 153, 0),
    warning_shimmer: (255, 183, 50),
    user_message_bg: (240, 240, 240),
    user_message_bg_hover: (228, 228, 228),
    bash_message_bg: (245, 238, 244),
    memory_bg: (235, 245, 248),
    selection_bg: (180, 213, 255),
    spinner_glyph: (164, 101, 101),
    diff_added: (153, 204, 255),
    diff_removed: (255, 204, 204),
    diff_added_dimmed: (209, 225, 240),
    diff_removed_dimmed: (240, 216, 216),
    diff_added_word: (51, 153, 255),
    diff_removed_word: (204, 102, 102),
    tool_execute: (176, 122, 0),
    tool_read: (0, 102, 153),
    tool_search: (0, 132, 150),
    tool_edit: (196, 90, 20),
    tool_web: (124, 58, 205),
    tool_task: (37, 99, 235),
    rate_limit_fill: (51, 102, 255),
    rate_limit_empty: (23, 46, 115),
};

/// Active `RayuThemeTokens` resolved for the current preset (and terminal dark/light mode).
pub fn active_theme_tokens() -> &'static RayuThemeTokens {
    // Note: Because `adapt_buffer_for_display` in `theme_mode.rs` automatically
    // flips dark-palette colors when `ThemeMode::Light` is active, we return the
    // canonical dark-based tokens during normal rendering so `adapt_buffer_for_display`
    // does not double-invert light tokens. Call `tokens_for_preset` when inspecting
    // a specific preset's raw colors.
    match theme_preset() {
        ThemePreset::DarkDaltonized | ThemePreset::LightDaltonized => &RAYU_DARK_DALTONIZED_TOKENS,
        _ => &RAYU_DARK_TOKENS,
    }
}

/// Raw tokens for an explicit preset.
pub fn tokens_for_preset(preset: ThemePreset) -> &'static RayuThemeTokens {
    match preset.resolved() {
        ThemePreset::Dark | ThemePreset::DarkAnsi | ThemePreset::Classic | ThemePreset::Auto => {
            &RAYU_DARK_TOKENS
        }
        ThemePreset::Light | ThemePreset::LightAnsi => &RAYU_LIGHT_TOKENS,
        ThemePreset::DarkDaltonized => &RAYU_DARK_DALTONIZED_TOKENS,
        ThemePreset::LightDaltonized => &RAYU_LIGHT_DALTONIZED_TOKENS,
    }
}

/// Helper: check if `role` is explicitly overridden by the user in `[display.colors]`,
/// and if so return the role's default color (which `adapt_buffer_for_display`
/// remaps to the user's configured color); otherwise return `fallback_rgb`.
#[inline]
pub(crate) fn role_or_token(role: Option<Role>, fallback_rgb: (u8, u8, u8)) -> Color {
    if let Some(role) = role
        && let Some(pal) = configured_palette()
        && pal.is_overridden(role)
    {
        return crate::palette::role_color(role);
    }
    rgb(fallback_rgb.0, fallback_rgb.1, fallback_rgb.2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_presets_roundtrip_by_id() {
        for preset in ALL_THEME_PRESETS.iter().copied() {
            assert_eq!(ThemePreset::from_name(preset.id()), Some(preset));
        }
    }

    #[test]
    fn dark_tokens_match_rayu_cli_theme_ts() {
        assert_eq!(RAYU_DARK_TOKENS.prompt_char, (0, 255, 136));
        assert_eq!(RAYU_DARK_TOKENS.brand, (70, 190, 130));
        assert_eq!(RAYU_DARK_TOKENS.brand_shimmer, (120, 220, 165));
        assert_eq!(RAYU_DARK_TOKENS.bash_border, (253, 93, 177));
        assert_eq!(RAYU_DARK_TOKENS.permission, (177, 185, 249));
        assert_eq!(RAYU_DARK_TOKENS.plan_mode, (72, 150, 140));
        assert_eq!(RAYU_DARK_TOKENS.auto_accept, (175, 135, 255));
        assert_eq!(RAYU_DARK_TOKENS.user_message_bg, (55, 55, 55));
    }
}
