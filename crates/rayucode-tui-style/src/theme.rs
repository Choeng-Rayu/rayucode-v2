use crate::color;
use crate::color::rgb;
use ratatui::prelude::*;

pub fn user_color() -> Color {
    crate::palette::role_color(crate::palette::Role::User)
}
pub fn ai_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Ai)
}
pub fn tool_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Tool)
}
pub fn file_link_color() -> Color {
    crate::palette::role_color(crate::palette::Role::FileLink)
}
pub fn dim_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Dim)
}
pub fn accent_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Accent)
}
pub fn system_message_color() -> Color {
    crate::palette::role_color(crate::palette::Role::System)
}
pub fn queued_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Queued)
}
pub fn asap_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Asap)
}
pub fn pending_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Pending)
}
pub fn user_text() -> Color {
    crate::palette::role_color(crate::palette::Role::UserText)
}
pub fn user_bg() -> Color {
    crate::palette::role_color(crate::palette::Role::UserBg)
}
pub fn ai_text() -> Color {
    crate::palette::role_color(crate::palette::Role::AiText)
}
pub fn header_icon_color() -> Color {
    crate::palette::role_color(crate::palette::Role::HeaderIcon)
}
pub fn header_name_color() -> Color {
    crate::palette::role_color(crate::palette::Role::HeaderName)
}
pub fn header_session_color() -> Color {
    crate::palette::role_color(crate::palette::Role::HeaderSession)
}

/// Success / additions accent.
pub fn success_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Success)
}
/// Warning accent.
pub fn warning_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Warning)
}
/// Error / deletions accent.
pub fn error_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Error)
}
/// Informational accent.
pub fn info_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Info)
}
/// Borders and rules.
pub fn border_color() -> Color {
    crate::palette::role_color(crate::palette::Role::Border)
}
/// Selected-row background.
pub fn selection_bg_color() -> Color {
    crate::palette::role_color(crate::palette::Role::SelectionBg)
}

// ============================================================================
// Semantic Theme Color Accessors
// ============================================================================

/// Bright green `❯` prompt character and user message text (`rgb(0, 255, 136)` dark).
pub fn prompt_char_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::User),
        crate::themes::active_theme_tokens().prompt_char,
    )
}

/// Primary Rayu brand green (`rgb(70, 190, 130)` dark).
pub fn brand_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::Accent),
        crate::themes::active_theme_tokens().brand,
    )
}

/// Shimmer highlight for active spinner verbs (`rgb(120, 220, 165)` dark).
pub fn brand_shimmer_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().brand_shimmer;
    rgb(r, g, b)
}

/// Rounded box border color for `LogoV2` startup header (`#5bf58d` / `rgb(91, 245, 141)` dark).
pub fn header_border_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::HeaderName),
        crate::themes::active_theme_tokens().header_border,
    )
}

/// Top/bottom horizontal rules around `PromptInput` (`rgb(136, 136, 136)` dark).
pub fn prompt_border_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::Border),
        crate::themes::active_theme_tokens().prompt_border,
    )
}

/// Bright pink border and indicator for `!` bash mode (`rgb(253, 93, 177)` dark).
pub fn bash_border_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::System),
        crate::themes::active_theme_tokens().bash_border,
    )
}

/// Periwinkle blue for permissions, modal `▔` dividers, and suggestions (`rgb(177, 185, 249)` dark).
pub fn permission_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::Info),
        crate::themes::active_theme_tokens().permission,
    )
}

pub fn permission_shimmer_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().permission_shimmer;
    rgb(r, g, b)
}

pub fn suggestion_color() -> Color {
    permission_color()
}

/// Muted sage green for `⏸ plan mode on` (`rgb(72, 150, 140)` dark).
pub fn plan_mode_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().plan_mode;
    rgb(r, g, b)
}

/// Electric violet for `⏵⏵ accept edits on` (`rgb(175, 135, 255)` dark).
pub fn auto_accept_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().auto_accept;
    rgb(r, g, b)
}

/// Fast mode orange (`rgb(255, 120, 20)` dark).
pub fn fast_mode_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().fast_mode;
    rgb(r, g, b)
}

/// Muted inactive gray (`rgb(153, 153, 153)` dark).
pub fn inactive_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::Pending),
        crate::themes::active_theme_tokens().inactive,
    )
}

/// Subtle gray (`rgb(80, 80, 80)` dark).
pub fn subtle_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::Dim),
        crate::themes::active_theme_tokens().subtle,
    )
}

/// User prompt message background (`rgb(55, 55, 55)` dark).
pub fn user_message_bg_color() -> Color {
    crate::themes::role_or_token(
        Some(crate::palette::Role::UserBg),
        crate::themes::active_theme_tokens().user_message_bg,
    )
}

/// Default braille spinner glyph color (`#a46565` / `rgb(164, 101, 101)`).
pub fn spinner_glyph_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().spinner_glyph;
    rgb(r, g, b)
}

// Per-tool category colors
pub fn tool_execute_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().tool_execute;
    rgb(r, g, b)
}
pub fn tool_read_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().tool_read;
    rgb(r, g, b)
}
pub fn tool_search_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().tool_search;
    rgb(r, g, b)
}
pub fn tool_edit_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().tool_edit;
    rgb(r, g, b)
}
pub fn tool_web_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().tool_web;
    rgb(r, g, b)
}
pub fn tool_task_color() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().tool_task;
    rgb(r, g, b)
}

// Structured diff line and word-level colors
pub fn diff_added_bg() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().diff_added;
    rgb(r, g, b)
}
pub fn diff_removed_bg() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().diff_removed;
    rgb(r, g, b)
}
pub fn diff_added_word_bg() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().diff_added_word;
    rgb(r, g, b)
}
pub fn diff_removed_word_bg() -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().diff_removed_word;
    rgb(r, g, b)
}

// Spinner frames for animated status. Keep these single-cell because the fast
// spinner-only renderer patches one status cell between full TUI redraws.
const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Default braille breathing pulse sequence (`120ms`/frame, 1 cell wide).
pub const RAYU_PULSE_FRAMES: &[&str] = &["⠁", "⠇", "⠷", "⡿", "⣿", "⡿", "⠷", "⠇"];

/// Selectable spinner styles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SpinnerStyle {
    #[default]
    BraillePulse,
    Circles,
    Diamonds,
    Dots,
    Squares,
    Classic,
}

impl SpinnerStyle {
    pub fn frames(self) -> &'static [&'static str] {
        match self {
            Self::BraillePulse => RAYU_PULSE_FRAMES,
            Self::Circles => &["◜", "◝", "◞", "◟"],
            Self::Diamonds => &["◇", "◈", "◆", "◈"],
            Self::Dots => &["․", "‥", "…", "‥"],
            Self::Squares => &["◰", "◳", "◲", "◱"],
            Self::Classic => &["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"],
        }
    }
}

/// Frame rate for `RAYU_PULSE_FRAMES` (`120ms` per frame = `8.333` FPS).
pub const RAYU_PULSE_FPS: f32 = 1000.0 / 120.0;

pub fn rayu_spinner_frame(elapsed: f32) -> &'static str {
    let idx = ((elapsed * RAYU_PULSE_FPS) as usize) % RAYU_PULSE_FRAMES.len();
    RAYU_PULSE_FRAMES[idx]
}

/// Compute the per-character color for `rayu-cli`'s `GlimmerMessage` verb
/// (`"Rayu's Thinking…"`), including the 3-character shimmer band and stall
/// red shift (`rgb(171, 43, 63)` after 3s without stream tokens).
pub fn glimmer_char_color(
    char_idx: usize,
    total_chars: usize,
    elapsed_secs: f32,
    is_requesting: bool,
    stalled_intensity: f32,
) -> Color {
    let tokens = crate::themes::active_theme_tokens();
    let base = tokens.brand;
    let shimmer = tokens.brand_shimmer;

    // Shimmer band speed: 50ms/char when requesting (LTR), 200ms/char otherwise (RTL).
    let step_secs = if is_requesting { 0.05 } else { 0.20 };
    let cycle_len = total_chars.saturating_add(10).max(1);
    let step = ((elapsed_secs / step_secs) as usize) % cycle_len;
    let glimmer_center: isize = if is_requesting {
        step as isize - 5
    } else {
        (total_chars as isize + 5) - step as isize
    };

    let dist = (char_idx as isize - glimmer_center).abs();
    let (r, g, b) = if dist <= 1 { shimmer } else { base };

    if stalled_intensity > 0.01 {
        let t = stalled_intensity.clamp(0.0, 1.0);
        let stall_rgb = (171.0f32, 43.0f32, 63.0f32);
        rgb(
            (r as f32 + (stall_rgb.0 - r as f32) * t) as u8,
            (g as f32 + (stall_rgb.1 - g as f32) * t) as u8,
            (b as f32 + (stall_rgb.2 - b as f32) * t) as u8,
        )
    } else {
        rgb(r, g, b)
    }
}

/// Stall-aware spinner glyph color (`#a46565` shifting toward `#ab2b3f` when stalled).
pub fn stalled_spinner_glyph_color(stalled_intensity: f32) -> Color {
    let (r, g, b) = crate::themes::active_theme_tokens().spinner_glyph;
    if stalled_intensity > 0.01 {
        let t = stalled_intensity.clamp(0.0, 1.0);
        rgb(
            (r as f32 + (171.0 - r as f32) * t) as u8,
            (g as f32 + (43.0 - g as f32) * t) as u8,
            (b as f32 + (63.0 - b as f32) * t) as u8,
        )
    } else {
        rgb(r, g, b)
    }
}

/// Frame rate for slow, full-line "liveness" indicators that can only be
/// repainted by a full TUI redraw (e.g. the running-tool progress bar) when
/// decorative animations are disabled (Minimal tier, SSH, WSL, etc.). These
/// ride the ~1 Hz passive-liveness redraw, so advancing them faster would just
/// skip frames. Keep this slow so they read as alive without forcing more
/// expensive full-frame redraws.
pub const LIVENESS_INDICATOR_FPS: f32 = 1.5;

/// Frame rate for the low-cost single-cell circular spinner when decorative
/// animations are disabled. Unlike the full-line indicators above, this spinner
/// is patched by the cheap one-cell fast path between full redraws, so it can
/// animate at a smooth, responsive cadence (well above ~1 Hz) while still
/// staying very light on resources. Keep this in sync with the spinner-only
/// tick interval in the TUI run loop (`STATUS_SPINNER_ONLY_INTERVAL`, 80ms) so
/// each tick lands on exactly one new frame.
pub const LIVENESS_SPINNER_FPS: f32 = 12.5;

pub fn spinner_frame_index(elapsed: f32, fps: f32) -> usize {
    ((elapsed * fps) as usize) % SPINNER_FRAMES.len()
}

pub fn spinner_frame(elapsed: f32, fps: f32) -> &'static str {
    SPINNER_FRAMES[spinner_frame_index(elapsed, fps)]
}

/// Whether `symbol` is one of the cells owned by the primary activity spinner.
///
/// The TUI's single-cell spinner redraw uses this to avoid patching a status-row
/// cell after a late overlay, such as the slash-command palette, has taken
/// ownership of it.
pub fn is_activity_indicator_frame(symbol: &str) -> bool {
    SPINNER_FRAMES.contains(&symbol)
        || RAYU_PULSE_FRAMES.contains(&symbol)
        || SpinnerStyle::Circles.frames().contains(&symbol)
        || SpinnerStyle::Diamonds.frames().contains(&symbol)
        || SpinnerStyle::Dots.frames().contains(&symbol)
        || SpinnerStyle::Squares.frames().contains(&symbol)
        || SpinnerStyle::Classic.frames().contains(&symbol)
}

pub fn activity_indicator_frame_index(
    elapsed: f32,
    fps: f32,
    enable_decorative_animations: bool,
) -> usize {
    if enable_decorative_animations {
        spinner_frame_index(elapsed, fps)
    } else {
        // Keep ticking at the smooth liveness rate instead of freezing on a
        // single frame. The single-cell fast path repaints this cheaply, so it
        // can animate well above ~1 Hz without a full-frame redraw.
        spinner_frame_index(elapsed, LIVENESS_SPINNER_FPS)
    }
}

pub fn activity_indicator(
    elapsed: f32,
    fps: f32,
    enable_decorative_animations: bool,
) -> &'static str {
    SPINNER_FRAMES[activity_indicator_frame_index(elapsed, fps, enable_decorative_animations)]
}

/// Convert HSL to RGB (h in 0-360, s and l in 0-1)
/// Chroma color based on position and time - creates flowing rainbow wave
/// Calculate chroma color with fade-in from dim during startup
/// Calculate smooth animated color for the header (single color, no position)
pub fn color_to_floats(c: Color, fallback: (f32, f32, f32)) -> (f32, f32, f32) {
    match c {
        Color::Rgb(r, g, b) => (r as f32, g as f32, b as f32),
        Color::Indexed(n) => {
            let (r, g, b) = color::indexed_to_rgb(n);
            (r as f32, g as f32, b as f32)
        }
        _ => fallback,
    }
}

pub fn blend_color(from: Color, to: Color, t: f32) -> Color {
    let (fr, fg, fb) = color_to_floats(from, (80.0, 80.0, 80.0));
    let (tr, tg, tb) = color_to_floats(to, (200.0, 200.0, 200.0));
    let r = fr + (tr - fr) * t;
    let g = fg + (tg - fg) * t;
    let b = fb + (tb - fb) * t;
    rgb(
        r.clamp(0.0, 255.0) as u8,
        g.clamp(0.0, 255.0) as u8,
        b.clamp(0.0, 255.0) as u8,
    )
}

pub fn rainbow_prompt_color(distance: usize) -> Color {
    // Rainbow colors (hue progression): red -> orange -> yellow -> green -> cyan -> blue -> violet
    const RAINBOW: [(u8, u8, u8); 7] = [
        (255, 80, 80),   // Red (softened)
        (255, 160, 80),  // Orange
        (255, 230, 80),  // Yellow
        (80, 220, 100),  // Green
        (80, 200, 220),  // Cyan
        (100, 140, 255), // Blue
        (180, 100, 255), // Violet
    ];

    // Gray target (dim_color())
    const GRAY: (u8, u8, u8) = (80, 80, 80);

    // Exponential decay factor - how quickly we fade to gray
    // decay = e^(-distance * rate), rate of ~0.4 gives nice falloff
    let decay = (-0.4 * distance as f32).exp();

    // Select rainbow color based on distance (cycle through)
    let rainbow_idx = distance.min(RAINBOW.len() - 1);
    let (r, g, b) = RAINBOW[rainbow_idx];

    // Blend rainbow color with gray based on decay
    // At distance 0: 100% rainbow, as distance increases: approaches gray
    let blend = |rainbow: u8, gray: u8| -> u8 {
        (rainbow as f32 * decay + gray as f32 * (1.0 - decay)) as u8
    };

    rgb(blend(r, GRAY.0), blend(g, GRAY.1), blend(b, GRAY.2))
}

pub fn prompt_entry_color(base: Color, t: f32) -> Color {
    let peak = rgb(255, 230, 120);
    // Quick pulse in/out over the animation window.
    let phase = if t < 0.5 { t * 2.0 } else { (1.0 - t) * 2.0 };
    blend_color(base, peak, phase.clamp(0.0, 1.0) * 0.7)
}

pub fn prompt_entry_bg_color(base: Color, t: f32) -> Color {
    let spotlight = rgb(58, 66, 82);
    let ease_in = 1.0 - (1.0 - t).powi(3);
    let ease_out = (1.0 - t).powi(2);
    let phase = (ease_in * ease_out * 1.65).clamp(0.0, 1.0);
    blend_color(base, spotlight, phase * 0.85)
}

pub fn prompt_entry_shimmer_color(base: Color, pos: f32, t: f32) -> Color {
    let travel = (t * 1.15).clamp(0.0, 1.0);
    let width = 0.18;
    let dist = (pos - travel).abs();
    let shimmer = (1.0 - (dist / width).clamp(0.0, 1.0)).powf(2.2);
    let pulse = (1.0 - t).powf(0.55);
    let highlight = rgb(255, 248, 210);
    blend_color(base, highlight, shimmer * pulse * 0.7)
}

/// Generate an animated color that pulses between two colors
pub fn animated_tool_color(elapsed: f32, enable_decorative_animations: bool) -> Color {
    if !enable_decorative_animations {
        return tool_color();
    }

    // Cycle period of ~1.5 seconds
    let t = (elapsed * 2.0).sin() * 0.5 + 0.5; // 0.0 to 1.0

    // Interpolate between cyan and purple
    let r = (80.0 + t * 106.0) as u8; // 80 -> 186
    let g = (200.0 - t * 61.0) as u8; // 200 -> 139
    let b = (220.0 + t * 35.0) as u8; // 220 -> 255

    rgb(r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spinner_frames_are_circular_braille_sequence() {
        assert_eq!(
            SPINNER_FRAMES,
            &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        );
        assert!(is_activity_indicator_frame("⠋"));
        assert!(is_activity_indicator_frame("⠏"));
        assert!(!is_activity_indicator_frame("/"));
    }

    #[test]
    fn spinner_frame_wraps_at_sequence_length() {
        let fps = 10.0;
        assert_eq!(spinner_frame(0.0, fps), "⠋");
        assert_eq!(spinner_frame(0.9, fps), "⠏");
        assert_eq!(spinner_frame(1.0, fps), "⠋");
    }

    #[test]
    fn activity_indicator_still_advances_without_decorative_animations() {
        // With decorative animations disabled the single-cell spinner must keep
        // ticking instead of freezing on one frame.
        let first = activity_indicator(0.0, 12.5, false);
        let later = activity_indicator(1.0, 12.5, false);
        assert!(SPINNER_FRAMES.contains(&first));
        assert_ne!(
            first, later,
            "liveness spinner should advance within one second"
        );
    }

    #[test]
    fn liveness_spinner_advances_smoothly_within_a_few_frames() {
        // The single-cell fast path patches one status cell per 80ms tick, so the
        // non-decorative liveness spinner should advance well faster than ~1 Hz
        // (it should not still read as frozen between consecutive fast-path ticks).
        let frame_at = |elapsed: f32| activity_indicator(elapsed, 12.5, false);
        // One 80ms fast-path tick should already move to the next frame.
        assert_ne!(
            frame_at(0.0),
            frame_at(0.08),
            "liveness spinner should advance every fast-path tick (80ms)"
        );
        // It must be meaningfully faster than the old ~1.5 Hz cadence.
        const {
            assert!(
                LIVENESS_SPINNER_FPS >= 8.0,
                "liveness spinner should animate at a smooth, responsive rate"
            );
        }
    }
}
