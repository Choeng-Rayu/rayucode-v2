//! `rayu-cli` design-system primitives (`Divider`, `Pane`, `Byline`,
//! `KeyboardShortcutHint`, and `FullscreenLayout` modal geometry).

use crate::glyphs::{DOT_SEPARATOR, HORIZONTAL_RULE, MODAL_TOP_DIVIDER};
use crate::truncate_line_with_ellipsis_to_width;
use ratatui::layout::Rect;
use ratatui::prelude::{Line, Span, Style};
use rayucode_tui_style::theme::{dim_color, permission_color};
use unicode_width::UnicodeWidthStr;

/// Number of transcript rows left visible above a bottom-anchored modal
/// (`MODAL_TRANSCRIPT_PEEK = 2` in `FullscreenLayout.tsx`).
pub const MODAL_TRANSCRIPT_PEEK: u16 = 2;

/// Render a full-width horizontal rule (`─` or `▔`) that fits `width` display cells,
/// optionally embedding an inline left- or right-aligned title.
pub fn render_horizontal_rule(
    width: usize,
    rule_char: &str,
    rule_style: Style,
    inline_title: Option<&Line<'static>>,
    align_right: bool,
    offset: usize,
) -> Line<'static> {
    if width == 0 {
        return Line::from("");
    }
    let ch_width = UnicodeWidthStr::width(rule_char).max(1);
    let Some(title) = inline_title.filter(|t| t.width() > 0 && width > offset + 2) else {
        let count = width / ch_width;
        return Line::from(Span::styled(rule_char.repeat(count), rule_style));
    };

    let max_title_width = width.saturating_sub(offset + 2).max(1);
    let clipped_title = truncate_line_with_ellipsis_to_width(title, max_title_width);
    let title_w = clipped_title.width();
    let remaining = width.saturating_sub(title_w);

    let (left_cells, right_cells) = if align_right {
        let right = offset.min(remaining);
        (remaining.saturating_sub(right), right)
    } else {
        let left = offset.min(remaining);
        (left, remaining.saturating_sub(left))
    };

    let mut spans = Vec::with_capacity(clipped_title.spans.len() + 2);
    if left_cells > 0 {
        spans.push(Span::styled(
            rule_char.repeat(left_cells / ch_width),
            rule_style,
        ));
    }
    spans.extend(clipped_title.spans);
    if right_cells > 0 {
        spans.push(Span::styled(
            rule_char.repeat(right_cells / ch_width),
            rule_style,
        ));
    }
    Line::from(spans)
}

/// Render a standard `rayu-cli` `<Divider />` line (`─` repeated to `width`).
pub fn render_divider(width: usize, style: Style) -> Line<'static> {
    render_horizontal_rule(width, HORIZONTAL_RULE, style, None, false, 0)
}

/// Render the `FullscreenLayout.tsx` modal top divider (`▔` repeated to `width`
/// in `permission` color).
pub fn render_modal_top_divider(width: usize) -> Line<'static> {
    render_horizontal_rule(
        width,
        MODAL_TOP_DIVIDER,
        Style::default().fg(permission_color()),
        None,
        false,
        0,
    )
}

/// Join non-empty span groups with a dimmed `" · "` separator (`<Byline>` in `rayu-cli`).
pub fn join_byline(parts: impl IntoIterator<Item = Vec<Span<'static>>>) -> Vec<Span<'static>> {
    let sep_style = Style::default().fg(dim_color());
    let mut out: Vec<Span<'static>> = Vec::new();
    for part in parts {
        if part.is_empty() || part.iter().all(|s| s.content.is_empty()) {
            continue;
        }
        if !out.is_empty() {
            out.push(Span::styled(DOT_SEPARATOR, sep_style));
        }
        out.extend(part);
    }
    out
}

/// Build a `<KeyboardShortcutHint shortcut={key} action={action} />` span pair.
pub fn shortcut_hint_spans(shortcut: &str, action: &str) -> Vec<Span<'static>> {
    let style = Style::default().fg(dim_color());
    vec![Span::styled(format!("{shortcut} to {action}"), style)]
}

/// Compute the bottom-anchored modal rect inside `viewport`, leaving
/// `MODAL_TRANSCRIPT_PEEK` rows of transcript visible at the top when possible.
pub fn bottom_modal_area(viewport: Rect, desired_rows: u16) -> Rect {
    if viewport.height <= MODAL_TRANSCRIPT_PEEK + 2 {
        return viewport;
    }
    let max_height = viewport.height.saturating_sub(MODAL_TRANSCRIPT_PEEK);
    let height = desired_rows.clamp(3, max_height);
    let y = viewport.y + viewport.height.saturating_sub(height);
    Rect {
        x: viewport.x,
        y,
        width: viewport.width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horizontal_rule_never_exceeds_width() {
        let title = Line::from(vec![
            Span::raw(" "),
            Span::raw("Rayu-CLI v2.5.3"),
            Span::raw(" "),
        ]);
        for width in [1, 5, 12, 24, 80] {
            let line = render_horizontal_rule(
                width,
                HORIZONTAL_RULE,
                Style::default(),
                Some(&title),
                false,
                3,
            );
            assert_eq!(line.width(), width, "rule width mismatch at {width}");
        }
    }

    #[test]
    fn modal_area_leaves_two_row_transcript_peek() {
        let viewport = Rect::new(0, 0, 80, 24);
        let modal = bottom_modal_area(viewport, 12);
        assert_eq!(modal.y, 12);
        assert_eq!(modal.height, 12);
        let full_modal = bottom_modal_area(viewport, 30);
        assert_eq!(full_modal.y, MODAL_TRANSCRIPT_PEEK);
        assert_eq!(full_modal.height, 24 - MODAL_TRANSCRIPT_PEEK);
    }
}
