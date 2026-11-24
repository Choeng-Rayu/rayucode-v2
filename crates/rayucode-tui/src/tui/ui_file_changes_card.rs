//! Inline clickable end-of-turn File Changes Summary Card.
//!
//! Renders a calm, bordered card directly beneath the last finished turn whenever
//! the session has tracked file changes. Every chrome row strictly respects
//! terminal Unicode cell width (`unicode-width`), preserving 1 logical row per
//! visual row at narrow and wide widths (72 / 80 / 120 / 160 cols).

use super::{
    accent_color, centered_content_block_width, diff_add_color, diff_del_color, dim_color,
    file_link_color, queued_color, rgb, secondary_render_active, tint_span_with_diff_color,
    truncate_line_with_ellipsis_to_width,
};
use crate::file_changes::{
    FileChangeEntrySummary, FileChangeKind, FileChangeStatus, FileChangesSnapshot,
};
use crate::tui::markdown;
use ratatui::prelude::*;
use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

#[cfg(test)]
use std::cell::RefCell;

/// Interactive target registered for a clickable cell rectangle in the card.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FileChangeHitTarget {
    ExpandRow(String),
    OpenDiff(String),
    KeepFile(String),
    UndoFile(String),
    RedoFile(String),
    KeepAll,
    UndoAll,
    RedoAll,
    ToggleReceipt,
}

/// Line-local clickable range inside a rendered card.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CardLineHitRegion {
    pub line_offset: usize,
    pub col_start: u16,
    pub col_width: u16,
    pub target: FileChangeHitTarget,
    /// Specific action pills take precedence over full-row expand targets.
    pub is_pill: bool,
}

/// Fully rendered card lines plus their line-local clickable regions.
#[derive(Clone, Debug, Default)]
pub(crate) struct RenderedFileChangesCard {
    pub lines: Vec<Line<'static>>,
    pub hit_regions: Vec<CardLineHitRegion>,
}

#[derive(Clone, Debug)]
struct ScreenHitRect {
    rect: Rect,
    target: FileChangeHitTarget,
    is_pill: bool,
}

#[cfg(test)]
thread_local! {
    static TEST_HIT_RECTS: RefCell<Vec<ScreenHitRect>> = const { RefCell::new(Vec::new()) };
}

#[cfg(not(test))]
static HIT_RECTS: OnceLock<Mutex<Vec<ScreenHitRect>>> = OnceLock::new();

#[cfg(not(test))]
fn hit_rects_state() -> &'static Mutex<Vec<ScreenHitRect>> {
    HIT_RECTS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Clear all registered screen-space hit targets for the inline summary card.
pub(crate) fn clear_hit_rects() {
    if secondary_render_active() {
        return;
    }
    #[cfg(test)]
    {
        TEST_HIT_RECTS.with(|rects| rects.borrow_mut().clear());
        return;
    }
    #[cfg(not(test))]
    {
        let mut rects = hit_rects_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        rects.clear();
    }
}

/// Register the visible screen-space hit rectangles for the current frame.
pub(crate) fn set_hit_rects(
    card: &RenderedFileChangesCard,
    card_abs_line_start: usize,
    scroll: usize,
    visible_end: usize,
    content_area: Rect,
) {
    if secondary_render_active() {
        return;
    }
    let mut screen_rects = Vec::new();
    for region in &card.hit_regions {
        let abs_line = card_abs_line_start.saturating_add(region.line_offset);
        if abs_line < scroll || abs_line >= visible_end {
            continue;
        }
        let rel_row = (abs_line - scroll) as u16;
        let x = content_area.x.saturating_add(region.col_start);
        let max_w = content_area
            .x
            .saturating_add(content_area.width)
            .saturating_sub(x);
        let width = region.col_width.min(max_w);
        if width == 0 {
            continue;
        }
        screen_rects.push(ScreenHitRect {
            rect: Rect {
                x,
                y: content_area.y.saturating_add(rel_row),
                width,
                height: 1,
            },
            target: region.target.clone(),
            is_pill: region.is_pill,
        });
    }

    #[cfg(test)]
    {
        TEST_HIT_RECTS.with(|rects| *rects.borrow_mut() = screen_rects);
        return;
    }
    #[cfg(not(test))]
    {
        let mut rects = hit_rects_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *rects = screen_rects;
    }
}

/// Resolve the clickable target at `(column, row)` in screen coordinates.
/// Pill targets win over overlapping full-row targets.
pub(crate) fn hit_target_at(column: u16, row: u16) -> Option<FileChangeHitTarget> {
    let contains = |entry: &ScreenHitRect| {
        column >= entry.rect.x
            && column < entry.rect.x.saturating_add(entry.rect.width)
            && row >= entry.rect.y
            && row < entry.rect.y.saturating_add(entry.rect.height)
    };
    let resolve = |rects: &[ScreenHitRect]| -> Option<FileChangeHitTarget> {
        rects
            .iter()
            .find(|entry| entry.is_pill && contains(entry))
            .or_else(|| rects.iter().find(|entry| contains(entry)))
            .map(|entry| entry.target.clone())
    };
    #[cfg(test)]
    {
        TEST_HIT_RECTS.with(|rects| resolve(&rects.borrow()))
    }
    #[cfg(not(test))]
    {
        let rects = hit_rects_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        resolve(&rects)
    }
}

#[derive(Clone, PartialEq, Eq)]
struct CardRenderCacheKey {
    session_id: String,
    version: u64,
    latest_turn_id: u64,
    file_count: usize,
    pending_count: usize,
    width: u16,
    centered: bool,
    prefix_blank: bool,
}

static CARD_RENDER_CACHE: OnceLock<Mutex<Option<(CardRenderCacheKey, Arc<RenderedFileChangesCard>)>>> =
    OnceLock::new();

pub(crate) fn render_card_cached(
    snapshot: &FileChangesSnapshot,
    version: u64,
    expanded_paths: &HashSet<String>,
    receipt_expanded: bool,
    width: u16,
    centered: bool,
    prefix_blank: bool,
) -> Arc<RenderedFileChangesCard> {
    let key = CardRenderCacheKey {
        session_id: snapshot.session_id.clone(),
        version,
        latest_turn_id: snapshot.latest_turn_id,
        file_count: snapshot.files.len(),
        pending_count: snapshot.total_pending_files,
        width,
        centered,
        prefix_blank,
    };
    let cache = CARD_RENDER_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock()
        && let Some((cached_key, rendered)) = guard.as_ref()
        && *cached_key == key
    {
        return rendered.clone();
    }
    let rendered = Arc::new(render_file_changes_card(
        snapshot,
        expanded_paths,
        receipt_expanded,
        width,
        centered,
        prefix_blank,
    ));
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((key, rendered.clone()));
    }
    rendered
}

/// Left-truncate a file path by Unicode display cells so the filename stays visible
/// (`…/src/foo.rs`), guaranteed `result.width() <= max_cells`.
pub(crate) fn left_truncate_path(path: &str, max_cells: usize) -> String {
    if max_cells == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(path) <= max_cells {
        return path.to_string();
    }
    if max_cells == 1 {
        return "…".to_string();
    }
    let budget = max_cells - 1; // reserve 1 cell for '…'
    let mut suffix_chars: Vec<char> = Vec::new();
    let mut used = 0usize;
    for ch in path.chars().rev() {
        let w = UnicodeWidthChar::width(ch).unwrap_or(0);
        if used + w > budget {
            break;
        }
        used += w;
        suffix_chars.push(ch);
    }
    suffix_chars.reverse();
    let suffix: String = suffix_chars.into_iter().collect();
    // Prefer snapping cleanly to a path separator if doing so keeps at least half
    // the available budget (and keeps the filename intact).
    if let Some(slash_idx) = suffix.find('/') {
        let trimmed = &suffix[slash_idx..];
        let trimmed_w = UnicodeWidthStr::width(trimmed);
        if trimmed_w >= budget / 2 && trimmed.len() > 1 {
            return format!("…{trimmed}");
        }
    }
    format!("…{suffix}")
}

/// Right-truncate plain text by Unicode display cells with `…`, guaranteed `<= max_cells`.
pub(crate) fn right_truncate_cells(text: &str, max_cells: usize) -> String {
    if max_cells == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(text) <= max_cells {
        return text.to_string();
    }
    if max_cells == 1 {
        return "…".to_string();
    }
    let budget = max_cells - 1;
    let mut out = String::new();
    let mut used = 0usize;
    for ch in text.chars() {
        let w = UnicodeWidthChar::width(ch).unwrap_or(0);
        if used + w > budget {
            break;
        }
        used += w;
        out.push(ch);
    }
    out.push('…');
    out
}

fn kind_badge(kind: FileChangeKind) -> (&'static str, Color) {
    match kind {
        FileChangeKind::Created => ("A", diff_add_color()),
        FileChangeKind::Modified => ("M", queued_color()),
        FileChangeKind::Deleted => ("D", diff_del_color()),
        FileChangeKind::Renamed => ("R", file_link_color()),
    }
}

fn border_style() -> Style {
    Style::default().fg(rgb(78, 86, 102))
}

fn pill_style(color: Color) -> Style {
    Style::default().fg(color)
}

fn muted_style() -> Style {
    Style::default().fg(dim_color())
}

fn text_style() -> Style {
    Style::default().fg(rgb(218, 222, 232))
}

fn spans_display_width(spans: &[Span<'_>]) -> usize {
    spans
        .iter()
        .map(|span| UnicodeWidthStr::width(span.content.as_ref()))
        .sum()
}

/// Compose one bordered row `│ <inner> │` of exact width `box_width` (or truncated
/// cleanly if `box_width < 4`), returning the final `Line` and left padding offset.
fn build_bordered_row(
    pad_left: usize,
    box_width: usize,
    inner_spans: Vec<Span<'static>>,
) -> Line<'static> {
    let mut spans = Vec::with_capacity(inner_spans.len() + 4);
    if pad_left > 0 {
        spans.push(Span::raw(" ".repeat(pad_left)));
    }
    if box_width < 4 {
        spans.extend(inner_spans);
        return truncate_line_with_ellipsis_to_width(
            &Line::from(spans).alignment(Alignment::Left),
            pad_left + box_width,
        );
    }
    let inner_budget = box_width - 4;
    let mut inner_line = Line::from(inner_spans);
    if inner_line.width() > inner_budget {
        inner_line = truncate_line_with_ellipsis_to_width(&inner_line, inner_budget);
    }
    let used = inner_line.width();
    let pad_right = inner_budget.saturating_sub(used);

    spans.push(Span::styled("│ ", border_style()));
    spans.extend(inner_line.spans);
    if pad_right > 0 {
        spans.push(Span::raw(" ".repeat(pad_right)));
    }
    spans.push(Span::styled(" │", border_style()));
    Line::from(spans).alignment(Alignment::Left)
}

fn build_rule_row(pad_left: usize, box_width: usize, left: char, fill: char, right: char) -> Line<'static> {
    let mut spans = Vec::with_capacity(2);
    if pad_left > 0 {
        spans.push(Span::raw(" ".repeat(pad_left)));
    }
    let text = if box_width >= 2 {
        let mut s = String::with_capacity(box_width * 3);
        s.push(left);
        for _ in 0..(box_width - 2) {
            s.push(fill);
        }
        s.push(right);
        s
    } else {
        fill.to_string().repeat(box_width)
    };
    spans.push(Span::styled(text, border_style()));
    Line::from(spans).alignment(Alignment::Left)
}

/// Build the collapsed 1-line receipt shown when all files are resolved
/// (`total_pending_files == 0 && !receipt_expanded`).
fn render_collapsed_receipt(
    snapshot: &FileChangesSnapshot,
    width: u16,
    centered: bool,
    prefix_blank: bool,
) -> RenderedFileChangesCard {
    let mut lines = Vec::new();
    let mut hit_regions = Vec::new();
    if width == 0 || snapshot.is_empty() {
        return RenderedFileChangesCard { lines, hit_regions };
    }
    if prefix_blank {
        lines.push(Line::from("").alignment(Alignment::Left));
    }

    let box_width = if centered {
        centered_content_block_width(width, 96)
    } else {
        (width as usize).min(108)
    }
    .min(width as usize);
    let pad_left = if centered {
        (width as usize).saturating_sub(box_width) / 2
    } else {
        0
    };

    let kept_count = snapshot
        .files
        .iter()
        .filter(|f| f.status == FileChangeStatus::Kept)
        .count();
    let undone_count = snapshot
        .files
        .iter()
        .filter(|f| f.status == FileChangeStatus::Undone)
        .count();
    let any_redoable = snapshot
        .files
        .iter()
        .any(|f| f.status == FileChangeStatus::Undone && f.can_redo);
    let total_adds: usize = snapshot.files.iter().map(|f| f.additions).sum();
    let total_dels: usize = snapshot.files.iter().map(|f| f.deletions).sum();

    let plural = |n: usize| if n == 1 { "file" } else { "files" };
    let mut right_pills: Vec<(String, Color, FileChangeHitTarget)> = Vec::new();
    if any_redoable {
        let label = if box_width < 60 { "[Redo]" } else { "[Redo all]" };
        right_pills.push((label.to_string(), accent_color(), FileChangeHitTarget::RedoAll));
    }
    let expand_label = if box_width < 52 { "[+]" } else { "[Expand]" };
    right_pills.push((
        expand_label.to_string(),
        dim_color(),
        FileChangeHitTarget::ToggleReceipt,
    ));

    let right_width: usize = right_pills
        .iter()
        .map(|(l, _, _)| UnicodeWidthStr::width(l.as_str()))
        .sum::<usize>()
        + right_pills.len().saturating_sub(1);

    let line_offset = lines.len();
    let left_prefix_lead = "  ";
    let lead_w = UnicodeWidthStr::width(left_prefix_lead);
    let min_gap = 2usize;
    let left_budget = box_width.saturating_sub(lead_w + right_width + min_gap);

    let summary_text = if undone_count == 0 {
        if total_adds > 0 || total_dels > 0 {
            format!(
                "✓ Kept {} {} (+{} −{})",
                kept_count,
                plural(kept_count),
                total_adds,
                total_dels
            )
        } else {
            format!("✓ Kept {} {}", kept_count, plural(kept_count))
        }
    } else if kept_count == 0 {
        format!("↺ Undid {} {}", undone_count, plural(undone_count))
    } else {
        format!("✓ Kept {} · ↺ Undid {}", kept_count, undone_count)
    };
    let fitted_summary = right_truncate_cells(&summary_text, left_budget);
    let summary_color = if undone_count == 0 {
        diff_add_color()
    } else {
        dim_color()
    };

    let mut spans = Vec::new();
    if pad_left > 0 {
        spans.push(Span::raw(" ".repeat(pad_left)));
    }
    spans.push(Span::raw(left_prefix_lead));
    spans.push(Span::styled(fitted_summary.clone(), Style::default().fg(summary_color)));

    let used_left = lead_w + UnicodeWidthStr::width(fitted_summary.as_str());
    let gap = box_width.saturating_sub(used_left + right_width).max(1);
    spans.push(Span::raw(" ".repeat(gap)));

    let mut cursor_x = pad_left + used_left + gap;
    for (idx, (label, color, target)) in right_pills.iter().enumerate() {
        if idx > 0 {
            spans.push(Span::raw(" "));
            cursor_x += 1;
        }
        let w = UnicodeWidthStr::width(label.as_str());
        spans.push(Span::styled(label.clone(), pill_style(*color)));
        hit_regions.push(CardLineHitRegion {
            line_offset,
            col_start: cursor_x as u16,
            col_width: w as u16,
            target: target.clone(),
            is_pill: true,
        });
        cursor_x += w;
    }

    // Whole receipt row toggles expansion when clicked outside specific pills.
    hit_regions.push(CardLineHitRegion {
        line_offset,
        col_start: (pad_left + lead_w) as u16,
        col_width: box_width.saturating_sub(lead_w) as u16,
        target: FileChangeHitTarget::ToggleReceipt,
        is_pill: false,
    });

    let line = truncate_line_with_ellipsis_to_width(
        &Line::from(spans).alignment(Alignment::Left),
        width as usize,
    );
    lines.push(line);

    RenderedFileChangesCard { lines, hit_regions }
}

/// Render the inline clickable end-of-turn File Changes Summary Card.
pub(crate) fn render_file_changes_card(
    snapshot: &FileChangesSnapshot,
    expanded_paths: &HashSet<String>,
    receipt_expanded: bool,
    width: u16,
    centered: bool,
    prefix_blank: bool,
) -> RenderedFileChangesCard {
    if snapshot.is_empty() || width < 8 {
        return RenderedFileChangesCard::default();
    }

    if snapshot.total_pending_files == 0 && !receipt_expanded {
        return render_collapsed_receipt(snapshot, width, centered, prefix_blank);
    }

    let mut lines: Vec<Line<'static>> = Vec::new();
    let mut hit_regions: Vec<CardLineHitRegion> = Vec::new();

    if prefix_blank {
        lines.push(Line::from("").alignment(Alignment::Left));
    }

    let box_width = if centered {
        centered_content_block_width(width, 96)
    } else {
        (width as usize).min(108)
    }
    .min(width as usize);
    let pad_left = if centered {
        (width as usize).saturating_sub(box_width) / 2
    } else {
        0
    };
    let inner_width = box_width.saturating_sub(4); // `│ ` + inner + ` │`
    let inner_col_origin = pad_left + 2;
    let compact_pills = width < 78;

    // 1. Top border
    lines.push(build_rule_row(pad_left, box_width, '╭', '─', '╮'));

    // 2. Header row
    {
        let line_offset = lines.len();
        let plural = |n: usize| if n == 1 { "file" } else { "files" };
        let pending_in_latest_turn = snapshot
            .files
            .iter()
            .filter(|f| f.status == FileChangeStatus::Pending && f.changed_in_latest_turn)
            .count();
        let any_redoable = snapshot
            .files
            .iter()
            .any(|f| f.status == FileChangeStatus::Undone && f.can_redo);

        let mut header_pills: Vec<(&str, Color, FileChangeHitTarget)> = Vec::new();
        if snapshot.total_pending_files > 0 {
            if compact_pills {
                header_pills.push(("[Undo]", diff_del_color(), FileChangeHitTarget::UndoAll));
                header_pills.push(("[Keep]", diff_add_color(), FileChangeHitTarget::KeepAll));
            } else {
                header_pills.push(("[Undo all]", diff_del_color(), FileChangeHitTarget::UndoAll));
                header_pills.push(("[Keep all]", diff_add_color(), FileChangeHitTarget::KeepAll));
            }
        } else {
            if any_redoable {
                header_pills.push((
                    if compact_pills { "[Redo]" } else { "[Redo all]" },
                    accent_color(),
                    FileChangeHitTarget::RedoAll,
                ));
            }
            header_pills.push((
                if compact_pills { "[-]" } else { "[Collapse]" },
                dim_color(),
                FileChangeHitTarget::ToggleReceipt,
            ));
        }

        let pills_width: usize = header_pills
            .iter()
            .map(|(l, _, _)| UnicodeWidthStr::width(*l))
            .sum::<usize>()
            + header_pills.len().saturating_sub(1);

        let left_budget = inner_width.saturating_sub(pills_width + 2);
        let mut left_spans: Vec<Span<'static>> = Vec::new();
        if snapshot.total_pending_files > 0 {
            let count_label = format!(
                "{} {} changed",
                snapshot.total_pending_files,
                plural(snapshot.total_pending_files)
            );
            left_spans.push(Span::styled(
                count_label,
                text_style().add_modifier(Modifier::BOLD),
            ));
            if snapshot.total_additions > 0 || snapshot.total_deletions > 0 {
                left_spans.push(Span::raw("  "));
                if snapshot.total_additions > 0 {
                    left_spans.push(Span::styled(
                        format!("+{}", snapshot.total_additions),
                        Style::default().fg(diff_add_color()),
                    ));
                }
                if snapshot.total_deletions > 0 {
                    if snapshot.total_additions > 0 {
                        left_spans.push(Span::raw(" "));
                    }
                    left_spans.push(Span::styled(
                        format!("−{}", snapshot.total_deletions),
                        Style::default().fg(diff_del_color()),
                    ));
                }
            }
            if pending_in_latest_turn > 0 && pending_in_latest_turn < snapshot.total_pending_files {
                let turn_note = format!(" · {} in this turn", pending_in_latest_turn);
                if spans_display_width(&left_spans) + UnicodeWidthStr::width(turn_note.as_str())
                    <= left_budget
                {
                    left_spans.push(Span::styled(turn_note, muted_style()));
                }
            }
        } else {
            let total = snapshot.files.len();
            left_spans.push(Span::styled(
                format!("{total} {} resolved", plural(total)),
                text_style().add_modifier(Modifier::BOLD),
            ));
        }

        let mut left_line = Line::from(left_spans);
        if left_line.width() > left_budget {
            left_line = truncate_line_with_ellipsis_to_width(&left_line, left_budget);
        }
        let left_used = left_line.width();
        let gap = inner_width.saturating_sub(left_used + pills_width);

        let mut inner_spans = left_line.spans;
        if gap > 0 {
            inner_spans.push(Span::raw(" ".repeat(gap)));
        }

        let mut col = inner_col_origin + left_used + gap;
        for (idx, (label, color, target)) in header_pills.into_iter().enumerate() {
            if idx > 0 {
                inner_spans.push(Span::raw(" "));
                col += 1;
            }
            let w = UnicodeWidthStr::width(label);
            inner_spans.push(Span::styled(label.to_string(), pill_style(color)));
            hit_regions.push(CardLineHitRegion {
                line_offset,
                col_start: col as u16,
                col_width: w as u16,
                target,
                is_pill: true,
            });
            col += w;
        }

        lines.push(build_bordered_row(pad_left, box_width, inner_spans));
    }

    // 3. Divider
    lines.push(build_rule_row(pad_left, box_width, '├', '─', '┤'));

    // 4. Per-file rows (+ optional inline expanded preview hunks)
    for entry in &snapshot.files {
        let is_expanded = expanded_paths.contains(&entry.path);
        let row_line_offset = lines.len();
        render_file_row(
            entry,
            is_expanded,
            compact_pills,
            pad_left,
            box_width,
            inner_width,
            inner_col_origin,
            row_line_offset,
            &mut lines,
            &mut hit_regions,
        );

        if is_expanded {
            render_expanded_preview(
                entry,
                pad_left,
                box_width,
                inner_width,
                inner_col_origin,
                &mut lines,
                &mut hit_regions,
            );
        }
    }

    // 5. Footer hint row (strictly 1 row)
    {
        let hints = [
            "Click file to expand · Alt+R review overlay · /keep · /undo",
            "Click file to expand · Alt+R review · /keep · /undo",
            "Click to expand · Alt+R review · /keep · /undo",
            "Alt+R review · /keep · /undo",
        ];
        let hint = hints
            .iter()
            .copied()
            .find(|h| UnicodeWidthStr::width(*h) <= inner_width)
            .unwrap_or(hints[hints.len() - 1]);
        let fitted = right_truncate_cells(hint, inner_width);
        lines.push(build_bordered_row(
            pad_left,
            box_width,
            vec![Span::styled(fitted, muted_style())],
        ));
    }

    // 6. Bottom border
    lines.push(build_rule_row(pad_left, box_width, '╰', '─', '╯'));

    RenderedFileChangesCard { lines, hit_regions }
}

#[allow(clippy::too_many_arguments)]
fn render_file_row(
    entry: &FileChangeEntrySummary,
    is_expanded: bool,
    compact_pills: bool,
    pad_left: usize,
    box_width: usize,
    inner_width: usize,
    inner_col_origin: usize,
    line_offset: usize,
    lines: &mut Vec<Line<'static>>,
    hit_regions: &mut Vec<CardLineHitRegion>,
) {
    let glyph = if is_expanded { "▾ " } else { "▸ " };
    let (badge_str, badge_color) = kind_badge(entry.kind);

    // Build right-side status badge + clickable pills.
    let mut status_badge: Option<(&'static str, Color)> = None;
    let mut pills: Vec<(&'static str, Color, FileChangeHitTarget)> = Vec::new();
    match entry.status {
        FileChangeStatus::Pending => {
            if compact_pills {
                pills.push((
                    "[d]",
                    file_link_color(),
                    FileChangeHitTarget::OpenDiff(entry.path.clone()),
                ));
                if entry.undoable {
                    pills.push((
                        "[u]",
                        diff_del_color(),
                        FileChangeHitTarget::UndoFile(entry.path.clone()),
                    ));
                }
                pills.push((
                    "[k]",
                    diff_add_color(),
                    FileChangeHitTarget::KeepFile(entry.path.clone()),
                ));
            } else {
                pills.push((
                    "[Diff]",
                    file_link_color(),
                    FileChangeHitTarget::OpenDiff(entry.path.clone()),
                ));
                if entry.undoable {
                    pills.push((
                        "[Undo]",
                        diff_del_color(),
                        FileChangeHitTarget::UndoFile(entry.path.clone()),
                    ));
                }
                pills.push((
                    "[Keep]",
                    diff_add_color(),
                    FileChangeHitTarget::KeepFile(entry.path.clone()),
                ));
            }
        }
        FileChangeStatus::Undone => {
            status_badge = Some(("undone", dim_color()));
            pills.push((
                if compact_pills { "[d]" } else { "[Diff]" },
                file_link_color(),
                FileChangeHitTarget::OpenDiff(entry.path.clone()),
            ));
            if entry.can_redo {
                pills.push((
                    if compact_pills { "[r]" } else { "[Redo]" },
                    accent_color(),
                    FileChangeHitTarget::RedoFile(entry.path.clone()),
                ));
            }
        }
        FileChangeStatus::Kept => {
            status_badge = Some(("kept", dim_color()));
            pills.push((
                if compact_pills { "[d]" } else { "[Diff]" },
                file_link_color(),
                FileChangeHitTarget::OpenDiff(entry.path.clone()),
            ));
        }
    }

    // Build stats spans (`+A −R`, `bin`, or `>10M`).
    let mut stat_spans: Vec<Span<'static>> = Vec::new();
    if entry.is_binary {
        stat_spans.push(Span::styled("bin", muted_style()));
    } else if !entry.undoable && entry.additions == 0 && entry.deletions == 0 {
        stat_spans.push(Span::styled(">10M", muted_style()));
    } else if entry.additions > 0 || entry.deletions > 0 {
        if entry.additions > 0 {
            stat_spans.push(Span::styled(
                format!("+{}", entry.additions),
                Style::default().fg(diff_add_color()),
            ));
        }
        if entry.deletions > 0 {
            if entry.additions > 0 {
                stat_spans.push(Span::raw(" "));
            }
            stat_spans.push(Span::styled(
                format!("−{}", entry.deletions),
                Style::default().fg(diff_del_color()),
            ));
        }
    }

    let pill_sep = if compact_pills { "" } else { " " };
    let pill_sep_w = UnicodeWidthStr::width(pill_sep);
    let pills_width: usize = pills
        .iter()
        .map(|(l, _, _)| UnicodeWidthStr::width(*l))
        .sum::<usize>()
        + pills.len().saturating_sub(1) * pill_sep_w;
    let status_w = status_badge
        .map(|(s, _)| UnicodeWidthStr::width(s) + 1)
        .unwrap_or(0);
    let stats_w = spans_display_width(&stat_spans);
    let right_cluster_w = stats_w
        + usize::from(stats_w > 0 && (status_w > 0 || pills_width > 0))
        + status_w
        + pills_width;

    // Prefix: `▸ M `
    let prefix_w = UnicodeWidthStr::width(glyph) + UnicodeWidthStr::width(badge_str) + 1;
    let min_gap = 2usize;
    let path_budget = inner_width
        .saturating_sub(prefix_w + right_cluster_w + min_gap)
        .max(4);
    let display_path = left_truncate_path(&entry.display_path, path_budget);
    let path_w = UnicodeWidthStr::width(display_path.as_str());

    let path_style = match entry.status {
        FileChangeStatus::Pending => text_style(),
        FileChangeStatus::Kept | FileChangeStatus::Undone => muted_style(),
    };
    let effective_badge_color = match entry.status {
        FileChangeStatus::Pending => badge_color,
        FileChangeStatus::Kept | FileChangeStatus::Undone => dim_color(),
    };

    let mut inner_spans: Vec<Span<'static>> = vec![
        Span::styled(glyph, muted_style()),
        Span::styled(
            badge_str,
            Style::default()
                .fg(effective_badge_color)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::styled(display_path, path_style),
    ];

    let left_used = prefix_w + path_w;
    let gap = inner_width.saturating_sub(left_used + right_cluster_w);
    if gap > 0 {
        inner_spans.push(Span::raw(" ".repeat(gap)));
    }

    let mut col = inner_col_origin + left_used + gap;
    if stats_w > 0 {
        inner_spans.extend(stat_spans);
        col += stats_w;
        if status_w > 0 || pills_width > 0 {
            inner_spans.push(Span::raw(" "));
            col += 1;
        }
    }
    if let Some((badge, color)) = status_badge {
        inner_spans.push(Span::styled(badge, Style::default().fg(color)));
        inner_spans.push(Span::raw(" "));
        col += UnicodeWidthStr::width(badge) + 1;
    }

    for (idx, (label, color, target)) in pills.into_iter().enumerate() {
        if idx > 0 && pill_sep_w > 0 {
            inner_spans.push(Span::raw(pill_sep));
            col += pill_sep_w;
        }
        let w = UnicodeWidthStr::width(label);
        inner_spans.push(Span::styled(label, pill_style(color)));
        hit_regions.push(CardLineHitRegion {
            line_offset,
            col_start: col as u16,
            col_width: w as u16,
            target,
            is_pill: true,
        });
        col += w;
    }

    // Full row (fallback behind pills) toggles inline diff preview expansion.
    hit_regions.push(CardLineHitRegion {
        line_offset,
        col_start: inner_col_origin as u16,
        col_width: inner_width as u16,
        target: FileChangeHitTarget::ExpandRow(entry.path.clone()),
        is_pill: false,
    });

    lines.push(build_bordered_row(pad_left, box_width, inner_spans));
}

fn render_expanded_preview(
    entry: &FileChangeEntrySummary,
    pad_left: usize,
    box_width: usize,
    inner_width: usize,
    inner_col_origin: usize,
    lines: &mut Vec<Line<'static>>,
    hit_regions: &mut Vec<CardLineHitRegion>,
) {
    let indent = "  ";
    let indent_w = UnicodeWidthStr::width(indent);
    let body_budget = inner_width.saturating_sub(indent_w);

    if !entry.undoable {
        let msg = right_truncate_cells(
            "Exceeds 10 MiB snapshot limit — diff & snapshot undo unavailable",
            body_budget,
        );
        lines.push(build_bordered_row(
            pad_left,
            box_width,
            vec![Span::raw(indent), Span::styled(msg, muted_style())],
        ));
        return;
    }

    if entry.is_binary {
        let msg = right_truncate_cells("Binary file changed", body_budget);
        lines.push(build_bordered_row(
            pad_left,
            box_width,
            vec![Span::raw(indent), Span::styled(msg, muted_style())],
        ));
        return;
    }

    if let Some(old_path) = entry.old_path.as_deref() {
        let rename_note = right_truncate_cells(&format!("Renamed from {old_path}"), body_budget);
        lines.push(build_bordered_row(
            pad_left,
            box_width,
            vec![Span::raw(indent), Span::styled(rename_note, muted_style())],
        ));
    }

    if entry.preview_hunks.is_empty() {
        let msg = right_truncate_cells("(no textual diff lines — click [Diff] for details)", body_budget);
        lines.push(build_bordered_row(
            pad_left,
            box_width,
            vec![Span::raw(indent), Span::styled(msg, muted_style())],
        ));
        return;
    }

    let file_ext = std::path::Path::new(&entry.display_path)
        .extension()
        .and_then(|e| e.to_str());

    for hunk in &entry.preview_hunks {
        let hdr = right_truncate_cells(&hunk.header, body_budget);
        lines.push(build_bordered_row(
            pad_left,
            box_width,
            vec![
                Span::raw(indent),
                Span::styled(hdr, Style::default().fg(file_link_color())),
            ],
        ));

        for raw_line in &hunk.lines {
            let line_clean = raw_line.trim_end_matches(['\r', '\n']);
            let mut spans = vec![Span::raw(indent)];
            if let Some(rest) = line_clean.strip_prefix('+') {
                spans.push(Span::styled("+", Style::default().fg(diff_add_color())));
                for span in markdown::highlight_line(rest, file_ext) {
                    spans.push(tint_span_with_diff_color(span, diff_add_color()));
                }
            } else if let Some(rest) = line_clean.strip_prefix('-') {
                spans.push(Span::styled("-", Style::default().fg(diff_del_color())));
                for span in markdown::highlight_line(rest, file_ext) {
                    spans.push(tint_span_with_diff_color(span, diff_del_color()));
                }
            } else if let Some(rest) = line_clean.strip_prefix(' ') {
                spans.push(Span::styled(" ", muted_style()));
                spans.extend(markdown::highlight_line(rest, file_ext));
            } else {
                spans.push(Span::styled(line_clean.to_string(), muted_style()));
            }
            lines.push(build_bordered_row(pad_left, box_width, spans));
        }
    }

    if entry.preview_truncated {
        let line_offset = lines.len();
        let notice = right_truncate_cells(
            "… truncated — press [Diff] or Alt+R for full diff",
            body_budget,
        );
        lines.push(build_bordered_row(
            pad_left,
            box_width,
            vec![
                Span::raw(indent),
                Span::styled(notice, Style::default().fg(file_link_color())),
            ],
        ));
        hit_regions.push(CardLineHitRegion {
            line_offset,
            col_start: inner_col_origin as u16,
            col_width: inner_width as u16,
            target: FileChangeHitTarget::OpenDiff(entry.path.clone()),
            is_pill: false,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_changes::FileChangeHunk;

    fn sample_snapshot() -> FileChangesSnapshot {
        FileChangesSnapshot {
            session_id: "ses_test".into(),
            latest_turn_id: 2,
            total_pending_files: 3,
            total_additions: 42,
            total_deletions: 11,
            files: vec![
                FileChangeEntrySummary {
                    path: "/workspace/very/deep/nested/directory/structure/crates/rayucode-tui/src/tui/ui_file_changes_card.rs".into(),
                    display_path: "very/deep/nested/directory/structure/crates/rayucode-tui/src/tui/ui_file_changes_card.rs".into(),
                    old_path: None,
                    kind: FileChangeKind::Created,
                    status: FileChangeStatus::Pending,
                    additions: 30,
                    deletions: 0,
                    changed_in_latest_turn: true,
                    turn_id: 2,
                    edit_count: 1,
                    is_binary: false,
                    undoable: true,
                    can_redo: false,
                    preview_hunks: vec![FileChangeHunk {
                        old_start: 0,
                        old_lines: 0,
                        new_start: 1,
                        new_lines: 3,
                        header: "@@ -0,0 +1,3 @@".into(),
                        lines: vec![
                            "+pub fn hello() {".into(),
                            "+    println!(\"a very long line that would otherwise overflow narrow terminal widths easily without truncation\");".into(),
                            "+}".into(),
                        ],
                    }],
                    preview_truncated: true,
                    updated_at_ms: 200,
                },
                FileChangeEntrySummary {
                    path: "/workspace/src/中文路径/长文件名_module.rs".into(),
                    display_path: "src/中文路径/长文件名_module.rs".into(),
                    old_path: None,
                    kind: FileChangeKind::Modified,
                    status: FileChangeStatus::Pending,
                    additions: 12,
                    deletions: 5,
                    changed_in_latest_turn: true,
                    turn_id: 2,
                    edit_count: 2,
                    is_binary: false,
                    undoable: true,
                    can_redo: false,
                    preview_hunks: Vec::new(),
                    preview_truncated: false,
                    updated_at_ms: 150,
                },
                FileChangeEntrySummary {
                    path: "/workspace/old.rs".into(),
                    display_path: "old.rs".into(),
                    old_path: None,
                    kind: FileChangeKind::Deleted,
                    status: FileChangeStatus::Pending,
                    additions: 0,
                    deletions: 6,
                    changed_in_latest_turn: false,
                    turn_id: 1,
                    edit_count: 1,
                    is_binary: false,
                    undoable: true,
                    can_redo: false,
                    preview_hunks: Vec::new(),
                    preview_truncated: false,
                    updated_at_ms: 100,
                },
            ],
        }
    }

    #[test]
    fn file_change_card_respects_cell_width_invariants_across_widths() {
        let snapshot = sample_snapshot();
        let mut expanded = HashSet::new();
        expanded.insert(snapshot.files[0].path.clone());

        for width in [72u16, 80, 120, 160] {
            for centered in [false, true] {
                let card =
                    render_file_changes_card(&snapshot, &expanded, false, width, centered, true);
                assert!(
                    !card.lines.is_empty(),
                    "card must render lines at width={width}"
                );
                for (idx, line) in card.lines.iter().enumerate() {
                    let w = line.width();
                    assert!(
                        w <= width as usize,
                        "card line {idx} exceeded width {width} (centered={centered}): got {w} cells: {:?}",
                        super::super::line_plain_text(line)
                    );
                }
            }
        }

        // Verify compact pills are used at narrow width (72) and full pills at 80+.
        let narrow = render_file_changes_card(&snapshot, &HashSet::new(), false, 72, false, false);
        let narrow_text: String = narrow
            .lines
            .iter()
            .map(super::super::line_plain_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(narrow_text.contains("[d][u][k]"));

        let wide = render_file_changes_card(&snapshot, &HashSet::new(), false, 120, false, false);
        let wide_text: String = wide
            .lines
            .iter()
            .map(super::super::line_plain_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(wide_text.contains("[Diff] [Undo] [Keep]"));
        assert!(wide_text.contains("[Undo all] [Keep all]"));
        assert!(wide_text.contains("2 in this turn"));
    }

    #[test]
    fn file_change_card_resolved_receipt_fits_one_line_across_widths() {
        let mut snapshot = sample_snapshot();
        snapshot.total_pending_files = 0;
        snapshot.total_additions = 0;
        snapshot.total_deletions = 0;
        for f in &mut snapshot.files {
            f.status = FileChangeStatus::Kept;
        }
        for width in [72u16, 80, 120, 160] {
            let card =
                render_file_changes_card(&snapshot, &HashSet::new(), false, width, false, false);
            assert_eq!(card.lines.len(), 1, "resolved receipt must be 1 line");
            assert!(card.lines[0].width() <= width as usize);
            let text = super::super::line_plain_text(&card.lines[0]);
            assert!(text.contains("Kept 3 files"));
        }

        for f in &mut snapshot.files {
            f.status = FileChangeStatus::Undone;
            f.can_redo = true;
        }
        let undone =
            render_file_changes_card(&snapshot, &HashSet::new(), false, 80, false, false);
        assert_eq!(undone.lines.len(), 1);
        let text = super::super::line_plain_text(&undone.lines[0]);
        assert!(text.contains("Undid 3 files"));
        assert!(text.contains("[Redo all]"));
    }

    #[test]
    fn file_change_card_hit_test_resolution() {
        let snapshot = sample_snapshot();
        let card =
            render_file_changes_card(&snapshot, &HashSet::new(), false, 100, false, false);
        let content_area = Rect {
            x: 2,
            y: 5,
            width: 100,
            height: 30,
        };
        clear_hit_rects();
        set_hit_rects(&card, 0, 0, 30, content_area);

        let find_region = |pred: &dyn Fn(&FileChangeHitTarget) -> bool| {
            card.hit_regions
                .iter()
                .find(|r| pred(&r.target))
                .expect("expected hit region")
        };

        for check in [
            FileChangeHitTarget::UndoAll,
            FileChangeHitTarget::KeepAll,
            FileChangeHitTarget::OpenDiff(snapshot.files[0].path.clone()),
            FileChangeHitTarget::UndoFile(snapshot.files[0].path.clone()),
            FileChangeHitTarget::KeepFile(snapshot.files[0].path.clone()),
        ] {
            let r = find_region(&|t| t == &check);
            let hit = hit_target_at(
                content_area.x + r.col_start,
                content_area.y + r.line_offset as u16,
            );
            assert_eq!(hit, Some(check));
        }

        // Clicking the left side of row 0 (not on a pill) resolves to ExpandRow.
        let row_region = find_region(&|t| matches!(t, FileChangeHitTarget::ExpandRow(p) if p == &snapshot.files[0].path));
        let hit = hit_target_at(
            content_area.x + row_region.col_start + 1,
            content_area.y + row_region.line_offset as u16,
        );
        assert_eq!(
            hit,
            Some(FileChangeHitTarget::ExpandRow(
                snapshot.files[0].path.clone()
            ))
        );

        clear_hit_rects();
        assert_eq!(hit_target_at(content_area.x + 4, content_area.y + 3), None);
    }

    #[test]
    fn left_truncate_path_preserves_cell_budget_with_unicode() {
        let cjk = "crates/中文目录/深层子目录/文件名测试_module.rs";
        for cap in [8usize, 12, 20, 30] {
            let out = left_truncate_path(cjk, cap);
            assert!(
                UnicodeWidthStr::width(out.as_str()) <= cap,
                "cap={cap}, got {:?} (w={})",
                out,
                UnicodeWidthStr::width(out.as_str())
            );
            assert!(out.starts_with('…'));
        }
    }
}
