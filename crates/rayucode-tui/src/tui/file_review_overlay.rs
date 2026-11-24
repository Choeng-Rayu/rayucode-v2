//! Interactive File Review Overlay (`Alt+R` / `/changes` / `[Diff]`).
//!
//! Shows a selectable list of tracked session file changes alongside a
//! scrollable syntax-highlighted unified diff viewer, with keyboard and mouse
//! support for Keep, Undo, Redo, Keep all, Undo all, Force conflict override,
//! and opening in `$VISUAL`/`$EDITOR`.

use crate::file_changes::{
    FileChangeActionKind, FileChangeConflict, FileChangeDiffPayload, FileChangeEntrySummary,
    FileChangeHunk, FileChangeKind, FileChangeStatus, FileChangesSnapshot,
};
use crate::tui::markdown;
use crate::tui::ui::file_changes_card::{left_truncate_path, right_truncate_cells};
use crate::tui::ui_diff::{diff_add_color, diff_del_color, tint_span_with_diff_color};
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};
use rayucode_tui_style::theme::{
    accent_color, dim_color, error_color, file_link_color, queued_color, warning_color,
};
#[cfg(not(test))]
use std::sync::{Mutex, OnceLock};
use unicode_width::UnicodeWidthStr;

#[cfg(test)]
use std::cell::RefCell;

/// State of the open interactive File Review Overlay.
#[derive(Clone, Debug, Default)]
pub struct FileReviewOverlayState {
    pub selected_index: usize,
    pub selected_path: Option<String>,
    pub diff_scroll: usize,
    pub file_list_scroll: usize,
    pub loaded_diff: Option<FileChangeDiffPayload>,
    pub loading_path: Option<String>,
    pub conflicts: Vec<FileChangeConflict>,
    pub conflict_action: Option<(FileChangeActionKind, Option<String>)>,
    pub status_message: Option<String>,
    pub error_message: Option<String>,
}

impl FileReviewOverlayState {
    pub fn new(snapshot: Option<&FileChangesSnapshot>, initial_path: Option<&str>) -> Self {
        let mut state = Self::default();
        if let Some(snap) = snapshot {
            if let Some(target) = initial_path
                && let Some(idx) = snap
                    .files
                    .iter()
                    .position(|f| f.path == target || f.display_path == target)
            {
                state.selected_index = idx;
                state.selected_path = Some(snap.files[idx].path.clone());
                return state;
            }
            if let Some(first) = snap.files.first() {
                state.selected_index = 0;
                state.selected_path = Some(first.path.clone());
            }
        }
        state
    }

    /// Reconcile `selected_index` and `selected_path` after a snapshot refresh.
    pub fn sync_with_snapshot(&mut self, snapshot: Option<&FileChangesSnapshot>) {
        let Some(snap) = snapshot else {
            self.selected_index = 0;
            self.selected_path = None;
            self.loaded_diff = None;
            self.loading_path = None;
            return;
        };
        if snap.files.is_empty() {
            self.selected_index = 0;
            self.selected_path = None;
            self.loaded_diff = None;
            self.loading_path = None;
            return;
        }
        if let Some(path) = self.selected_path.as_deref()
            && let Some(idx) = snap.files.iter().position(|f| f.path == path)
        {
            self.selected_index = idx;
            return;
        }
        self.selected_index = self.selected_index.min(snap.files.len() - 1);
        self.selected_path = Some(snap.files[self.selected_index].path.clone());
    }

    pub fn select_index(&mut self, snapshot: Option<&FileChangesSnapshot>, idx: usize) -> Option<String> {
        let snap = snapshot?;
        if snap.files.is_empty() {
            return None;
        }
        let clamped = idx.min(snap.files.len() - 1);
        let changed = self.selected_index != clamped
            || self.selected_path.as_deref() != Some(snap.files[clamped].path.as_str());
        self.selected_index = clamped;
        let path = snap.files[clamped].path.clone();
        self.selected_path = Some(path.clone());
        if changed {
            self.diff_scroll = 0;
            self.error_message = None;
        }
        Some(path)
    }

    pub fn step_selection(&mut self, snapshot: Option<&FileChangesSnapshot>, delta: isize) -> Option<String> {
        let snap = snapshot?;
        if snap.files.is_empty() {
            return None;
        }
        let next = if delta < 0 {
            self.selected_index.saturating_sub(delta.unsigned_abs())
        } else {
            self.selected_index
                .saturating_add(delta as usize)
                .min(snap.files.len() - 1)
        };
        self.select_index(Some(snap), next)
    }

    pub fn scroll_diff(&mut self, delta: isize) {
        if delta < 0 {
            self.diff_scroll = self.diff_scroll.saturating_sub(delta.unsigned_abs());
        } else {
            self.diff_scroll = self.diff_scroll.saturating_add(delta as usize);
        }
    }

    pub fn selected_entry<'a>(
        &self,
        snapshot: Option<&'a FileChangesSnapshot>,
    ) -> Option<&'a FileChangeEntrySummary> {
        let snap = snapshot?;
        if let Some(path) = self.selected_path.as_deref()
            && let Some(entry) = snap.files.iter().find(|f| f.path == path)
        {
            return Some(entry);
        }
        snap.files.get(self.selected_index)
    }
}

/// Interactive targets inside the File Review Overlay.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum OverlayHitTarget {
    SelectFile(usize),
    KeepSelected,
    UndoSelected,
    RedoSelected,
    KeepAll,
    UndoAll,
    RedoAll,
    ForceConflict,
    OpenInEditor,
    Close,
}

#[derive(Clone, Debug, Default)]
struct OverlayLayoutRegistry {
    hits: Vec<(Rect, OverlayHitTarget)>,
    file_list_rect: Option<Rect>,
    diff_pane_rect: Option<Rect>,
    max_diff_scroll: usize,
}

#[cfg(test)]
thread_local! {
    static TEST_OVERLAY_LAYOUT: RefCell<OverlayLayoutRegistry> =
        RefCell::new(OverlayLayoutRegistry::default());
}

#[cfg(not(test))]
static OVERLAY_LAYOUT: OnceLock<Mutex<OverlayLayoutRegistry>> = OnceLock::new();

#[cfg(not(test))]
fn overlay_layout_state() -> &'static Mutex<OverlayLayoutRegistry> {
    OVERLAY_LAYOUT.get_or_init(|| Mutex::new(OverlayLayoutRegistry::default()))
}

pub(crate) fn clear_overlay_layout() {
    #[cfg(test)]
    {
        TEST_OVERLAY_LAYOUT.with(|state| *state.borrow_mut() = OverlayLayoutRegistry::default());
        return;
    }
    #[cfg(not(test))]
    {
        let mut state = overlay_layout_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *state = OverlayLayoutRegistry::default();
    }
}

fn store_overlay_layout(layout: OverlayLayoutRegistry) {
    #[cfg(test)]
    {
        TEST_OVERLAY_LAYOUT.with(|state| *state.borrow_mut() = layout);
        return;
    }
    #[cfg(not(test))]
    {
        let mut state = overlay_layout_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *state = layout;
    }
}

fn point_in_rect(col: u16, row: u16, rect: Rect) -> bool {
    col >= rect.x
        && col < rect.x.saturating_add(rect.width)
        && row >= rect.y
        && row < rect.y.saturating_add(rect.height)
}

pub(crate) fn overlay_hit_target_at(column: u16, row: u16) -> Option<OverlayHitTarget> {
    let lookup = |reg: &OverlayLayoutRegistry| {
        reg.hits
            .iter()
            .find(|(rect, _)| point_in_rect(column, row, *rect))
            .map(|(_, target)| target.clone())
    };
    #[cfg(test)]
    {
        TEST_OVERLAY_LAYOUT.with(|state| lookup(&state.borrow()))
    }
    #[cfg(not(test))]
    {
        let state = overlay_layout_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lookup(&state)
    }
}

pub(crate) fn overlay_point_in_file_list(column: u16, row: u16) -> bool {
    let check = |reg: &OverlayLayoutRegistry| {
        reg.file_list_rect
            .is_some_and(|rect| point_in_rect(column, row, rect))
    };
    #[cfg(test)]
    {
        TEST_OVERLAY_LAYOUT.with(|state| check(&state.borrow()))
    }
    #[cfg(not(test))]
    {
        let state = overlay_layout_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        check(&state)
    }
}

pub(crate) fn overlay_max_diff_scroll() -> usize {
    #[cfg(test)]
    {
        TEST_OVERLAY_LAYOUT.with(|state| state.borrow().max_diff_scroll)
    }
    #[cfg(not(test))]
    {
        overlay_layout_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .max_diff_scroll
    }
}

fn kind_badge(kind: FileChangeKind) -> (&'static str, Color) {
    match kind {
        FileChangeKind::Created => ("A", diff_add_color()),
        FileChangeKind::Modified => ("M", queued_color()),
        FileChangeKind::Deleted => ("D", diff_del_color()),
        FileChangeKind::Renamed => ("R", file_link_color()),
    }
}

/// Build syntax-highlighted unified diff lines from hunks using the shared
/// `markdown::highlight_line` + `ui_diff::tint_span_with_diff_color` pipeline.
pub(crate) fn build_highlighted_hunk_lines(
    hunks: &[FileChangeHunk],
    file_ext: Option<&str>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let max_line = hunks
        .iter()
        .map(|h| {
            h.old_start
                .saturating_add(h.old_lines)
                .max(h.new_start.saturating_add(h.new_lines))
        })
        .max()
        .unwrap_or(1);
    let num_w = max_line.to_string().len().max(3);
    let blank_num = " ".repeat(num_w);

    for hunk in hunks {
        out.push(Line::from(Span::styled(
            hunk.header.clone(),
            Style::default()
                .fg(file_link_color())
                .add_modifier(Modifier::BOLD),
        )));

        let mut old_ln = hunk.old_start;
        let mut new_ln = hunk.new_start;
        for raw in &hunk.lines {
            let line = raw.trim_end_matches(['\r', '\n']);
            if let Some(rest) = line.strip_prefix('+') {
                let prefix = format!("{blank_num} {:>num_w$} │+", new_ln);
                new_ln += 1;
                let mut spans = vec![Span::styled(prefix, Style::default().fg(diff_add_color()))];
                for span in markdown::highlight_line(rest, file_ext) {
                    spans.push(tint_span_with_diff_color(span, diff_add_color()));
                }
                out.push(Line::from(spans));
            } else if let Some(rest) = line.strip_prefix('-') {
                let prefix = format!("{:>num_w$} {blank_num} │-", old_ln);
                old_ln += 1;
                let mut spans = vec![Span::styled(prefix, Style::default().fg(diff_del_color()))];
                for span in markdown::highlight_line(rest, file_ext) {
                    spans.push(tint_span_with_diff_color(span, diff_del_color()));
                }
                out.push(Line::from(spans));
            } else if let Some(rest) = line.strip_prefix(' ') {
                let prefix = format!("{:>num_w$} {:>num_w$} │ ", old_ln, new_ln);
                old_ln += 1;
                new_ln += 1;
                let mut spans = vec![Span::styled(prefix, Style::default().fg(dim_color()))];
                spans.extend(markdown::highlight_line(rest, file_ext));
                out.push(Line::from(spans));
            } else {
                out.push(Line::from(Span::styled(
                    line.to_string(),
                    Style::default().fg(dim_color()),
                )));
            }
        }
    }
    out
}

/// Render the full-screen File Review Overlay.
pub(crate) fn draw_file_review_overlay(
    frame: &mut Frame,
    area: Rect,
    snapshot: Option<&FileChangesSnapshot>,
    overlay: &FileReviewOverlayState,
) {
    if area.width < 12 || area.height < 6 {
        clear_overlay_layout();
        return;
    }

    let mut registry = OverlayLayoutRegistry::default();

    let pending_count = snapshot.map_or(0, |s| s.total_pending_files);
    let total_adds = snapshot.map_or(0, |s| s.total_additions);
    let total_dels = snapshot.map_or(0, |s| s.total_deletions);
    let title_text = if pending_count > 0 {
        format!(" File Changes Review · {pending_count} pending (+{total_adds} −{total_dels}) ")
    } else if let Some(snap) = snapshot.filter(|s| !s.is_empty()) {
        format!(" File Changes Review · {} resolved ", snap.files.len())
    } else {
        " File Changes Review ".to_string()
    };
    let title_fitted = right_truncate_cells(&title_text, area.width.saturating_sub(2) as usize);

    let footer_raw = if !overlay.conflicts.is_empty() {
        " Conflict! f force · ↑↓ file · PgUp/Dn/^u/^d diff · q/Esc close "
    } else {
        " ↑↓/j file · PgUp/Dn/^u/^d diff · k keep · u undo · r redo · K/U all · o editor · q/Esc close "
    };
    let footer_fitted = right_truncate_cells(footer_raw, area.width.saturating_sub(2) as usize);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(accent_color()))
        .title(Span::styled(
            title_fitted,
            Style::default()
                .fg(accent_color())
                .add_modifier(Modifier::BOLD),
        ))
        .title_bottom(Line::from(Span::styled(
            footer_fitted,
            Style::default().fg(dim_color()),
        )));

    let inner = block.inner(area);
    frame.render_widget(block, area);

    if inner.width == 0 || inner.height == 0 {
        store_overlay_layout(registry);
        return;
    }

    let Some(snapshot) = snapshot.filter(|s| !s.is_empty()) else {
        let msg = overlay
            .status_message
            .as_deref()
            .unwrap_or("No file changes recorded in this session yet.");
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                format!(" {msg}"),
                Style::default().fg(dim_color()),
            ))),
            inner,
        );
        store_overlay_layout(registry);
        return;
    };

    let selected = overlay.selected_entry(Some(snapshot));
    let mut y = inner.y;
    let max_y = inner.y.saturating_add(inner.height);

    // Row 0: Action toolbar for selected file + batch actions
    if y < max_y {
        let toolbar_area = Rect {
            x: inner.x,
            y,
            width: inner.width,
            height: 1,
        };
        draw_toolbar_row(frame, toolbar_area, snapshot, selected, overlay, &mut registry);
        y += 1;
    }

    // Optional conflict banner row
    if !overlay.conflicts.is_empty() && y < max_y {
        let banner_area = Rect {
            x: inner.x,
            y,
            width: inner.width,
            height: 1,
        };
        draw_conflict_banner(frame, banner_area, &overlay.conflicts, &mut registry);
        y += 1;
    } else if let Some(err) = overlay.error_message.as_deref()
        && y < max_y
    {
        let err_line = right_truncate_cells(&format!(" ⚠ {err}"), inner.width as usize);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                err_line,
                Style::default().fg(error_color()),
            ))),
            Rect {
                x: inner.x,
                y,
                width: inner.width,
                height: 1,
            },
        );
        y += 1;
    } else if let Some(status) = overlay.status_message.as_deref()
        && y < max_y
    {
        let status_line = right_truncate_cells(&format!(" {status}"), inner.width as usize);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                status_line,
                Style::default().fg(diff_add_color()),
            ))),
            Rect {
                x: inner.x,
                y,
                width: inner.width,
                height: 1,
            },
        );
        y += 1;
    }

    // Horizontal divider below top chrome
    if y < max_y {
        let rule = "─".repeat(inner.width as usize);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                rule,
                Style::default().fg(dim_color()),
            ))),
            Rect {
                x: inner.x,
                y,
                width: inner.width,
                height: 1,
            },
        );
        y += 1;
    }

    let body_height = max_y.saturating_sub(y);
    if body_height == 0 {
        store_overlay_layout(registry);
        return;
    }

    let body_area = Rect {
        x: inner.x,
        y,
        width: inner.width,
        height: body_height,
    };

    if body_area.width >= 76 {
        let list_w = ((body_area.width as usize * 32) / 100).clamp(24, 42) as u16;
        let list_area = Rect {
            x: body_area.x,
            y: body_area.y,
            width: list_w.min(body_area.width.saturating_sub(10)),
            height: body_area.height,
        };
        let sep_area = Rect {
            x: list_area.x + list_area.width,
            y: body_area.y,
            width: 1,
            height: body_area.height,
        };
        let diff_area = Rect {
            x: sep_area.x + 1,
            y: body_area.y,
            width: body_area.width.saturating_sub(list_area.width + 1),
            height: body_area.height,
        };
        draw_file_list(frame, list_area, snapshot, overlay, &mut registry);
        let sep_lines: Vec<Line<'static>> = (0..sep_area.height)
            .map(|_| Line::from(Span::styled("│", Style::default().fg(dim_color()))))
            .collect();
        frame.render_widget(Paragraph::new(sep_lines), sep_area);
        draw_diff_pane(frame, diff_area, selected, overlay, &mut registry);
    } else {
        // Stacked layout for narrow terminals (e.g. 72 cols)
        let list_h = (snapshot.files.len() as u16)
            .clamp(1, 5)
            .min(body_area.height.saturating_sub(3).max(1));
        let list_area = Rect {
            x: body_area.x,
            y: body_area.y,
            width: body_area.width,
            height: list_h,
        };
        draw_file_list(frame, list_area, snapshot, overlay, &mut registry);

        let sep_y = body_area.y + list_h;
        if sep_y < max_y {
            let rule = "─".repeat(body_area.width as usize);
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    rule,
                    Style::default().fg(dim_color()),
                ))),
                Rect {
                    x: body_area.x,
                    y: sep_y,
                    width: body_area.width,
                    height: 1,
                },
            );
        }
        let diff_y = sep_y.saturating_add(1);
        if diff_y < max_y {
            let diff_area = Rect {
                x: body_area.x,
                y: diff_y,
                width: body_area.width,
                height: max_y.saturating_sub(diff_y),
            };
            draw_diff_pane(frame, diff_area, selected, overlay, &mut registry);
        }
    }

    store_overlay_layout(registry);
}

fn draw_toolbar_row(
    frame: &mut Frame,
    area: Rect,
    snapshot: &FileChangesSnapshot,
    selected: Option<&FileChangeEntrySummary>,
    _overlay: &FileReviewOverlayState,
    registry: &mut OverlayLayoutRegistry,
) {
    let compact = area.width < 74;
    let mut pills: Vec<(&'static str, Color, OverlayHitTarget)> = Vec::new();
    if let Some(entry) = selected {
        match entry.status {
            FileChangeStatus::Pending => {
                pills.push((
                    if compact { "[k]" } else { "[Keep]" },
                    diff_add_color(),
                    OverlayHitTarget::KeepSelected,
                ));
                if entry.undoable {
                    pills.push((
                        if compact { "[u]" } else { "[Undo]" },
                        diff_del_color(),
                        OverlayHitTarget::UndoSelected,
                    ));
                }
            }
            FileChangeStatus::Undone if entry.can_redo => {
                pills.push((
                    if compact { "[r]" } else { "[Redo]" },
                    accent_color(),
                    OverlayHitTarget::RedoSelected,
                ));
            }
            _ => {}
        }
        pills.push((
            if compact { "[o]" } else { "[Open]" },
            file_link_color(),
            OverlayHitTarget::OpenInEditor,
        ));
    }
    if snapshot.total_pending_files > 0 && !compact {
        pills.push(("[Keep all]", diff_add_color(), OverlayHitTarget::KeepAll));
        pills.push(("[Undo all]", diff_del_color(), OverlayHitTarget::UndoAll));
    } else if snapshot
        .files
        .iter()
        .any(|f| f.status == FileChangeStatus::Undone && f.can_redo)
        && !compact
    {
        pills.push(("[Redo all]", accent_color(), OverlayHitTarget::RedoAll));
    }
    pills.push(("[×]", dim_color(), OverlayHitTarget::Close));

    let pills_w: usize = pills
        .iter()
        .map(|(l, _, _)| UnicodeWidthStr::width(*l))
        .sum::<usize>()
        + pills.len().saturating_sub(1);
    let left_budget = (area.width as usize).saturating_sub(pills_w + 3);

    let mut spans = vec![Span::raw(" ")];
    let left_used = if let Some(entry) = selected {
        let (badge, color) = kind_badge(entry.kind);
        let stats = if entry.is_binary {
            " bin".to_string()
        } else if entry.additions > 0 || entry.deletions > 0 {
            format!(" +{} −{}", entry.additions, entry.deletions)
        } else {
            String::new()
        };
        let status_tag = match entry.status {
            FileChangeStatus::Pending => "",
            FileChangeStatus::Kept => " [kept]",
            FileChangeStatus::Undone => " [undone]",
        };
        let fixed_w = UnicodeWidthStr::width(badge)
            + 1
            + UnicodeWidthStr::width(stats.as_str())
            + UnicodeWidthStr::width(status_tag);
        let path_budget = left_budget.saturating_sub(fixed_w).max(4);
        let path_text = left_truncate_path(&entry.display_path, path_budget);
        let total = UnicodeWidthStr::width(badge)
            + 1
            + UnicodeWidthStr::width(path_text.as_str())
            + UnicodeWidthStr::width(stats.as_str())
            + UnicodeWidthStr::width(status_tag);
        spans.push(Span::styled(
            badge,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            path_text,
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ));
        if !stats.is_empty() {
            spans.push(Span::styled(stats, Style::default().fg(dim_color())));
        }
        if !status_tag.is_empty() {
            spans.push(Span::styled(status_tag, Style::default().fg(dim_color())));
        }
        total + 1
    } else {
        1
    };

    let gap = (area.width as usize).saturating_sub(left_used + pills_w + 1);
    if gap > 0 {
        spans.push(Span::raw(" ".repeat(gap)));
    }
    let mut x = area.x.saturating_add((left_used + gap) as u16);
    for (idx, (label, color, target)) in pills.into_iter().enumerate() {
        if idx > 0 {
            spans.push(Span::raw(" "));
            x = x.saturating_add(1);
        }
        let w = UnicodeWidthStr::width(label) as u16;
        spans.push(Span::styled(label, Style::default().fg(color)));
        registry.hits.push((
            Rect {
                x,
                y: area.y,
                width: w,
                height: 1,
            },
            target,
        ));
        x = x.saturating_add(w);
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn draw_conflict_banner(
    frame: &mut Frame,
    area: Rect,
    conflicts: &[FileChangeConflict],
    registry: &mut OverlayLayoutRegistry,
) {
    let pill = "[Force (f)]";
    let pill_w = UnicodeWidthStr::width(pill);
    let first = &conflicts[0];
    let extra = if conflicts.len() > 1 {
        format!(" (+{} more)", conflicts.len() - 1)
    } else {
        String::new()
    };
    let text = format!(" ⚠ Conflict ({}{}): {}", first.display_path, extra, first.reason);
    let left_budget = (area.width as usize).saturating_sub(pill_w + 2);
    let fitted = right_truncate_cells(&text, left_budget);
    let fitted_w = UnicodeWidthStr::width(fitted.as_str());
    let gap = (area.width as usize).saturating_sub(fitted_w + pill_w + 1);

    let mut spans = vec![Span::styled(
        fitted,
        Style::default()
            .fg(warning_color())
            .add_modifier(Modifier::BOLD),
    )];
    if gap > 0 {
        spans.push(Span::raw(" ".repeat(gap)));
    }
    let pill_x = area.x.saturating_add((fitted_w + gap) as u16);
    spans.push(Span::styled(
        pill,
        Style::default()
            .fg(error_color())
            .add_modifier(Modifier::BOLD),
    ));
    registry.hits.push((
        Rect {
            x: pill_x,
            y: area.y,
            width: pill_w as u16,
            height: 1,
        },
        OverlayHitTarget::ForceConflict,
    ));

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn draw_file_list(
    frame: &mut Frame,
    area: Rect,
    snapshot: &FileChangesSnapshot,
    overlay: &FileReviewOverlayState,
    registry: &mut OverlayLayoutRegistry,
) {
    registry.file_list_rect = Some(area);
    let height = area.height as usize;
    let total = snapshot.files.len();
    let selected = overlay.selected_index.min(total.saturating_sub(1));
    let start = if selected >= overlay.file_list_scroll + height {
        selected.saturating_add(1).saturating_sub(height)
    } else if selected < overlay.file_list_scroll {
        selected
    } else {
        overlay.file_list_scroll.min(total.saturating_sub(height))
    };

    let selected_bg = Color::Rgb(42, 48, 64);
    let mut lines = Vec::with_capacity(height);

    for (row_idx, idx) in (start..(start + height).min(total)).enumerate() {
        let entry = &snapshot.files[idx];
        let is_selected = idx == selected;
        let (badge, badge_color) = kind_badge(entry.kind);
        let status_mark = match entry.status {
            FileChangeStatus::Pending => " ",
            FileChangeStatus::Kept => "✓",
            FileChangeStatus::Undone => "↺",
        };
        let stats = if entry.is_binary {
            "bin".to_string()
        } else if entry.additions > 0 || entry.deletions > 0 {
            format!("+{} −{}", entry.additions, entry.deletions)
        } else {
            String::new()
        };
        let stats_w = UnicodeWidthStr::width(stats.as_str());
        let prefix = if is_selected { "▸" } else { " " };
        // `▸✓M <path> <stats>`
        let fixed_w = 1 + 1 + UnicodeWidthStr::width(badge) + 1 + stats_w + usize::from(stats_w > 0) + 1;
        let path_budget = (area.width as usize).saturating_sub(fixed_w).max(4);
        let path_str = left_truncate_path(&entry.display_path, path_budget);
        let used = 1
            + 1
            + UnicodeWidthStr::width(badge)
            + 1
            + UnicodeWidthStr::width(path_str.as_str())
            + stats_w
            + usize::from(stats_w > 0);
        let gap = (area.width as usize).saturating_sub(used);

        let mut spans = vec![
            Span::styled(prefix, Style::default().fg(accent_color())),
            Span::styled(status_mark, Style::default().fg(dim_color())),
            Span::styled(
                badge,
                Style::default()
                    .fg(if entry.status == FileChangeStatus::Pending {
                        badge_color
                    } else {
                        dim_color()
                    })
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(
                path_str,
                Style::default().fg(if entry.status == FileChangeStatus::Pending {
                    Color::Rgb(225, 228, 238)
                } else {
                    dim_color()
                }),
            ),
        ];
        if gap > 0 {
            spans.push(Span::raw(" ".repeat(gap)));
        }
        if stats_w > 0 {
            spans.push(Span::styled(stats, Style::default().fg(dim_color())));
        }
        let mut line = Line::from(spans);
        if is_selected {
            line = line.style(Style::default().bg(selected_bg));
        }
        lines.push(line);

        registry.hits.push((
            Rect {
                x: area.x,
                y: area.y.saturating_add(row_idx as u16),
                width: area.width,
                height: 1,
            },
            OverlayHitTarget::SelectFile(idx),
        ));
    }

    frame.render_widget(Paragraph::new(lines), area);
}

fn draw_diff_pane(
    frame: &mut Frame,
    area: Rect,
    selected: Option<&FileChangeEntrySummary>,
    overlay: &FileReviewOverlayState,
    registry: &mut OverlayLayoutRegistry,
) {
    registry.diff_pane_rect = Some(area);
    let Some(entry) = selected else {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                " No file selected.",
                Style::default().fg(dim_color()),
            ))),
            area,
        );
        return;
    };

    let loaded_matches = overlay
        .loaded_diff
        .as_ref()
        .filter(|d| d.path == entry.path);
    let file_ext = std::path::Path::new(&entry.display_path)
        .extension()
        .and_then(|e| e.to_str());

    let mut diff_lines: Vec<Line<'static>> = Vec::new();
    if let Some(payload) = loaded_matches {
        if payload.is_binary {
            diff_lines.push(Line::from(Span::styled(
                format!(" Binary file {} changed.", payload.display_path),
                Style::default().fg(dim_color()),
            )));
        } else if payload.hunks.is_empty() {
            diff_lines.push(Line::from(Span::styled(
                " (no textual diff hunks)",
                Style::default().fg(dim_color()),
            )));
        } else {
            diff_lines.extend(build_highlighted_hunk_lines(&payload.hunks, file_ext));
        }
    } else {
        if overlay.loading_path.as_deref() == Some(entry.path.as_str()) {
            diff_lines.push(Line::from(Span::styled(
                " Loading full diff…",
                Style::default().fg(dim_color()).add_modifier(Modifier::ITALIC),
            )));
        }
        if entry.is_binary {
            diff_lines.push(Line::from(Span::styled(
                format!(" Binary file {} changed.", entry.display_path),
                Style::default().fg(dim_color()),
            )));
        } else if !entry.preview_hunks.is_empty() {
            diff_lines.extend(build_highlighted_hunk_lines(&entry.preview_hunks, file_ext));
            if entry.preview_truncated {
                diff_lines.push(Line::from(Span::styled(
                    " … preview truncated while full diff loads",
                    Style::default().fg(dim_color()),
                )));
            }
        } else {
            diff_lines.push(Line::from(Span::styled(
                " (no diff preview available)",
                Style::default().fg(dim_color()),
            )));
        }
    }

    let visible_height = area.height as usize;
    let max_scroll = diff_lines.len().saturating_sub(visible_height);
    registry.max_diff_scroll = max_scroll;
    let scroll = overlay.diff_scroll.min(max_scroll);
    let end = scroll.saturating_add(visible_height).min(diff_lines.len());
    let visible: Vec<Line<'static>> = diff_lines
        .get(scroll..end)
        .unwrap_or(&[])
        .iter()
        .map(|line| {
            let max_w = area.width as usize;
            if line.width() > max_w {
                rayucode_tui_render::truncate_line_with_ellipsis_to_width(line, max_w)
            } else {
                line.clone()
            }
        })
        .collect();

    frame.render_widget(Paragraph::new(visible), area);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    fn sample_snapshot() -> FileChangesSnapshot {
        FileChangesSnapshot {
            session_id: "ses_overlay".into(),
            latest_turn_id: 1,
            total_pending_files: 2,
            total_additions: 5,
            total_deletions: 2,
            files: vec![
                FileChangeEntrySummary {
                    path: "/repo/src/a.rs".into(),
                    display_path: "src/a.rs".into(),
                    old_path: None,
                    kind: FileChangeKind::Modified,
                    status: FileChangeStatus::Pending,
                    additions: 3,
                    deletions: 1,
                    changed_in_latest_turn: true,
                    turn_id: 1,
                    edit_count: 1,
                    is_binary: false,
                    undoable: true,
                    can_redo: false,
                    preview_hunks: vec![FileChangeHunk {
                        old_start: 1,
                        old_lines: 2,
                        new_start: 1,
                        new_lines: 3,
                        header: "@@ -1,2 +1,3 @@".into(),
                        lines: vec![
                            " fn main() {".into(),
                            "-    old();".into(),
                            "+    new_a();".into(),
                            "+    new_b();".into(),
                        ],
                    }],
                    preview_truncated: false,
                    updated_at_ms: 20,
                },
                FileChangeEntrySummary {
                    path: "/repo/src/b.rs".into(),
                    display_path: "src/b.rs".into(),
                    old_path: None,
                    kind: FileChangeKind::Created,
                    status: FileChangeStatus::Pending,
                    additions: 2,
                    deletions: 1,
                    changed_in_latest_turn: true,
                    turn_id: 1,
                    edit_count: 1,
                    is_binary: false,
                    undoable: true,
                    can_redo: false,
                    preview_hunks: Vec::new(),
                    preview_truncated: false,
                    updated_at_ms: 10,
                },
            ],
        }
    }

    #[test]
    fn file_change_overlay_navigation_and_conflict_banner_render() {
        let snap = sample_snapshot();
        let mut state = FileReviewOverlayState::new(Some(&snap), None);
        assert_eq!(state.selected_index, 0);
        assert_eq!(state.selected_path.as_deref(), Some("/repo/src/a.rs"));

        state.step_selection(Some(&snap), 1);
        assert_eq!(state.selected_index, 1);
        assert_eq!(state.selected_path.as_deref(), Some("/repo/src/b.rs"));

        state.step_selection(Some(&snap), -1);
        assert_eq!(state.selected_index, 0);

        state.conflicts = vec![FileChangeConflict {
            path: "/repo/src/a.rs".into(),
            display_path: "src/a.rs".into(),
            reason: "File modified manually".into(),
        }];
        state.conflict_action = Some((FileChangeActionKind::Undo, Some("/repo/src/a.rs".into())));

        for width in [72u16, 80, 120] {
            let backend = TestBackend::new(width, 24);
            let mut terminal = Terminal::new(backend).unwrap();
            terminal
                .draw(|frame| {
                    let area = frame.area();
                    draw_file_review_overlay(frame, area, Some(&snap), &state);
                })
                .unwrap();

            let buf = terminal.backend().buffer();
            let full: String = (0..24)
                .map(|y| {
                    (0..width)
                        .map(|x| buf[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect::<Vec<_>>()
                .join("\n");
            assert!(full.contains("File Changes Review"), "width={width}");
            assert!(full.contains("Conflict"), "width={width}");
            assert!(full.contains("[Force (f)]"), "width={width}");
        }
    }
}
