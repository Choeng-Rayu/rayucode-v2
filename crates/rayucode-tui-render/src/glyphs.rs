//! Native glyph and figure constants for the Rayu TUI.

/// Prompt pointer (`❯`).
pub const POINTER: &str = "❯";

/// Brand glyph (`◈`).
pub const BRAND_GLYPH: &str = "◈";

/// 5-cell tool-result gutter (`"  ⎿  "` = 2 spaces + `⎿` + 2 spaces) from `MessageResponse.tsx`.
pub const TOOL_RESULT_GUTTER: &str = "  ⎿  ";

/// 5-cell continuation indent for multi-line tool results beneath `TOOL_RESULT_GUTTER`.
pub const TOOL_RESULT_INDENT: &str = "     ";

/// Upper one-eighth block (`▔`, `\u2594`) used for the top border of bottom-anchored modals in `FullscreenLayout.tsx`.
pub const MODAL_TOP_DIVIDER: &str = "▔";

/// Standard box-drawing horizontal rule (`─`).
pub const HORIZONTAL_RULE: &str = "─";

/// Heavy horizontal rule (`━`).
pub const HEAVY_HORIZONTAL: &str = "━";

/// Left bar for blockquotes (`▎`).
pub const BLOCKQUOTE_BAR: &str = "▎";

/// Plan mode pause icon (`⏸`).
pub const PAUSE_ICON: &str = "⏸";

/// Auto-accept / bypass permissions icon (`⏵⏵`).
pub const AUTO_ACCEPT_ICON: &str = "⏵⏵";

/// Fast mode lightning bolt (`↯`).
pub const LIGHTNING_BOLT: &str = "↯";

/// Up arrow (`↑`), used in `WelcomeTagline` and upload token counts.
pub const UP_ARROW: &str = "↑";

/// Down arrow (`↓`), used in `NewMessagesPill` and download token counts.
pub const DOWN_ARROW: &str = "↓";

/// Completed task / thought checkmark (`✔`).
pub const TICK: &str = "✔";

/// In-progress task square (`◼`).
pub const TASK_IN_PROGRESS: &str = "◼";

/// Pending task square (`◻`).
pub const TASK_PENDING: &str = "◻";

/// Teammate / blocked task pointer (`›`).
pub const SMALL_POINTER: &str = "›";

/// Center dot separator (`·`).
pub const DOT_SEPARATOR: &str = " · ";

/// Effort level indicators (`figures.ts`).
pub const EFFORT_LOW: &str = "○";
pub const EFFORT_MEDIUM: &str = "◐";
pub const EFFORT_HIGH: &str = "●";
pub const EFFORT_MAX: &str = "◉";

/// Assistant message & tool header bullet (`BLACK_CIRCLE` in `figures.ts`):
/// `⏺` on macOS (unless `RAYU_GLYPH_SAFE_MODE` is set), `●` on Linux/Windows.
pub fn black_circle() -> &'static str {
    if cfg!(target_os = "macos") && std::env::var_os("RAYU_GLYPH_SAFE_MODE").is_none() {
        "⏺"
    } else {
        "●"
    }
}
