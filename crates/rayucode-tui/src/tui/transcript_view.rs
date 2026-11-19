use std::cell::RefCell;
use std::sync::Arc;

use ratatui::{Frame, layout::Rect, style::Style, text::Line, widgets::Paragraph};
use rayucode_tui_messages::{
    ContentPos, DisplayMessage, PreparedChatFrame, PreparedMessages, PreparedSectionKind,
};
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Copy)]
struct SearchHit {
    raw_line: usize,
    start: usize,
    end: usize,
    row: usize,
}

#[derive(Default)]
struct SearchIndex {
    body: Option<Arc<PreparedMessages>>,
    hits: Vec<SearchHit>,
    selected: Option<usize>,
    position: Option<(ContentPos, usize)>,
}

/// Read-only state for the current live transcript.
pub struct TranscriptView {
    pub(super) origin_scroll: usize,
    pub(super) origin_paused: bool,
    pub(super) origin_position: Option<ContentPos>,
    pub(super) editing: Option<String>,
    query: String,
    pattern: Option<regex::Regex>,
    index: RefCell<SearchIndex>,
}

impl TranscriptView {
    pub(super) fn new(scroll: usize, paused: bool, position: Option<ContentPos>) -> Self {
        Self {
            origin_scroll: scroll,
            origin_paused: paused,
            origin_position: position,
            editing: None,
            query: String::new(),
            pattern: None,
            index: RefCell::default(),
        }
    }

    pub(super) fn set_query(&mut self, query: String) {
        self.pattern = (!query.is_empty())
            .then(|| {
                regex::RegexBuilder::new(&regex::escape(&query))
                    .case_insensitive(true)
                    .build()
                    .ok()
            })
            .flatten();
        self.query = query;
        *self.index.get_mut() = SearchIndex::default();
    }

    fn update_search(&self, frame: &PreparedChatFrame) -> Option<usize> {
        let pattern = self.pattern.as_ref()?;
        let body = frame
            .sections
            .iter()
            .find(|section| section.kind == PreparedSectionKind::Body)?;
        let mut index = self.index.borrow_mut();
        if index
            .body
            .as_ref()
            .is_some_and(|cached| Arc::ptr_eq(cached, &body.prepared))
        {
            return Some(body.line_start);
        }

        let mut rows = vec![0..0; body.prepared.raw_plain_lines.len()];
        for (row, wrap) in body.prepared.wrapped_line_map.iter().enumerate() {
            if let Some(raw_rows) = rows.get_mut(wrap.raw_line) {
                if raw_rows.start == raw_rows.end {
                    raw_rows.start = row;
                }
                raw_rows.end = row + 1;
            }
        }

        index.hits.clear();
        for (raw_line, text) in body.prepared.raw_plain_lines.iter().enumerate() {
            if rows[raw_line].start == rows[raw_line].end {
                continue;
            }
            let mut column = 0;
            let mut graphemes = text.grapheme_indices(true).peekable();
            for found in pattern.find_iter(text) {
                while let Some(&(byte, grapheme)) = graphemes.peek() {
                    if byte + grapheme.len() > found.start() {
                        break;
                    }
                    column += grapheme.width();
                    graphemes.next();
                }
                let start = column;
                let end = start
                    + graphemes
                        .clone()
                        .take_while(|(byte, _)| *byte < found.end())
                        .map(|(_, grapheme)| grapheme.width())
                        .sum::<usize>();
                let wraps = &body.prepared.wrapped_line_map;
                if let Some(row) = rows[raw_line].clone().find(|&row| {
                    let wrap = &wraps[row];
                    wrap.raw_line == raw_line && wrap.start_col < end && start < wrap.end_col
                }) {
                    index.hits.push(SearchHit {
                        raw_line,
                        start,
                        end,
                        row,
                    });
                }
            }
        }

        index.selected = index.position.and_then(|(position, column)| {
            let row = rayucode_tui_messages::resolve_content_pos(&position, frame, usize::MAX)?;
            index
                .hits
                .iter()
                .position(|hit| body.line_start + hit.row == row && hit.start == column)
        });
        index.body = Some(Arc::clone(&body.prepared));
        Some(body.line_start)
    }

    /// Existing message anchors number identical messages from the start of
    /// history. Account for newly loaded copies before resolving those anchors.
    pub(super) fn prepend_history(&mut self, messages: &[DisplayMessage]) {
        let advance = |position: &mut ContentPos| {
            if let ContentPos::Message(anchor) = position {
                anchor.occurrence += messages
                    .iter()
                    .filter(|msg| msg.stable_cache_hash() == anchor.msg_hash)
                    .count();
            }
        };
        if let Some(position) = &mut self.origin_position {
            advance(position);
        }
        if let Some((position, _)) = &mut self.index.get_mut().position {
            advance(position);
        }
    }

    pub(super) fn next_match(
        &self,
        frame: &PreparedChatFrame,
        current_row: usize,
        backward: bool,
    ) -> Option<usize> {
        let body_start = self.update_search(frame)?;
        let mut index = self.index.borrow_mut();
        let count = index.hits.len();
        if count == 0 {
            return None;
        }
        let selected = match (index.selected, backward) {
            (Some(selected), true) => selected.checked_sub(1).unwrap_or(count - 1),
            (Some(selected), false) => (selected + 1) % count,
            (None, true) => index
                .hits
                .iter()
                .rposition(|hit| body_start + hit.row <= current_row)
                .unwrap_or(count - 1),
            (None, false) => index
                .hits
                .iter()
                .position(|hit| body_start + hit.row >= current_row)
                .unwrap_or(0),
        };
        let hit = index.hits[selected];
        let row = body_start + hit.row;
        index.selected = Some(selected);
        index.position = rayucode_tui_messages::content_pos_at_row(frame, row)
            .map(|position| (position, hit.start));
        Some(row)
    }

    pub(super) fn highlight(
        &self,
        frame: &PreparedChatFrame,
        scroll: usize,
        lines: &mut [Line<'static>],
    ) {
        let Some(body_start) = self.update_search(frame) else {
            return;
        };
        let index = self.index.borrow();
        let Some(hit) = index.selected.and_then(|selected| index.hits.get(selected)) else {
            return;
        };
        let Some(body) = &index.body else { return };
        for (i, line) in lines.iter_mut().enumerate() {
            let absolute = scroll + i;
            let Some(wrap) = absolute
                .checked_sub(body_start)
                .and_then(|row| body.wrapped_line_map.get(row))
            else {
                continue;
            };
            if wrap.raw_line == hit.raw_line && hit.start < wrap.end_col && wrap.start_col < hit.end
            {
                let prefix = frame.wrapped_copy_offset(absolute).unwrap_or_default();
                let start = prefix + hit.start.saturating_sub(wrap.start_col);
                let end = prefix + hit.end.min(wrap.end_col).saturating_sub(wrap.start_col);
                *line = super::ui::selection_highlight::highlight_line_selection(line, start, end);
            }
        }
    }

    pub(super) fn draw_bar(&self, frame: &mut Frame, area: Rect) {
        if area.is_empty() {
            return;
        }
        let label = if let Some(query) = &self.editing {
            let width = usize::from(area.width.saturating_sub(2));
            let start = query
                .grapheme_indices(true)
                .rev()
                .scan(width, |remaining, (byte, grapheme)| {
                    *remaining = remaining.checked_sub(grapheme.width())?;
                    Some(byte)
                })
                .last()
                .unwrap_or(query.len());
            let suffix = &query[start..];
            let caret = (1 + suffix.width() as u16).min(area.width - 1);
            frame.set_cursor_position((area.x + caret, area.y));
            format!("/{suffix}")
        } else if !self.query.is_empty() {
            let index = self.index.borrow();
            let current = index.selected.map_or(0, |selected| selected + 1);
            format!("{current}/{} /{} · n/N · Esc", index.hits.len(), self.query)
        } else {
            if area.width < 34 {
                "Transcript / · Esc"
            } else {
                "Transcript · / search · Esc close"
            }
            .into()
        };
        let line = rayucode_tui_render::truncate_line_with_ellipsis_to_width(
            &Line::styled(
                label,
                Style::default().fg(rayucode_tui_style::theme::accent_color()),
            ),
            area.width as usize,
        );
        frame.render_widget(Paragraph::new(line), area);
    }
}
