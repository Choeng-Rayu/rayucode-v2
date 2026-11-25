use super::*;
use crossterm::event::MouseButton;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(crate) enum SourceFilterGroup {
    #[default]
    All,
    Rayu,
    Claude,
    Codex,
    Cursor,
    OpenCode,
    Pi,
}

impl SourceFilterGroup {
    pub(crate) const ALL: [Self; 7] = [
        Self::All,
        Self::Rayu,
        Self::Claude,
        Self::Codex,
        Self::Cursor,
        Self::OpenCode,
        Self::Pi,
    ];

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::Rayu => "Rayu",
            Self::Claude => "Claude",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor",
            Self::OpenCode => "OpenCode",
            Self::Pi => "Pi",
        }
    }

    pub(crate) fn glyph(self) -> &'static str {
        match self {
            Self::All => "*",
            Self::Rayu => "◆",
            Self::Claude => "C",
            Self::Codex => "X",
            Self::Cursor => "▸",
            Self::OpenCode => "O",
            Self::Pi => "π",
        }
    }

    pub(crate) fn matches(self, source: SessionSource) -> bool {
        match self {
            Self::All => true,
            Self::Rayu => matches!(source, SessionSource::Rayu | SessionSource::RayuCli),
            Self::Claude => matches!(source, SessionSource::ClaudeCode),
            Self::Codex => matches!(source, SessionSource::Codex),
            Self::Cursor => matches!(source, SessionSource::Cursor),
            Self::OpenCode => matches!(source, SessionSource::OpenCode),
            Self::Pi => matches!(source, SessionSource::Pi),
        }
    }

    pub(crate) fn index(self) -> usize {
        Self::ALL
            .iter()
            .position(|g| *g == self)
            .unwrap_or(0)
    }
}

fn truncate_display_cells(text: &str, max_cells: usize) -> String {
    if max_cells == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(text) <= max_cells {
        return text.to_string();
    }
    if max_cells == 1 {
        return "…".to_string();
    }
    let mut out = String::new();
    let mut used = 0usize;
    let limit = max_cells - 1;
    for ch in text.chars() {
        let w = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0);
        if used + w > limit {
            break;
        }
        out.push(ch);
        used += w;
    }
    out.push('…');
    out
}

impl SessionPicker {
    pub(crate) fn source_filter_counts(&self) -> [(SourceFilterGroup, usize); 7] {
        let all_refs = self.all_session_refs();
        let mut counts = [
            (SourceFilterGroup::All, 0usize),
            (SourceFilterGroup::Rayu, 0usize),
            (SourceFilterGroup::Claude, 0usize),
            (SourceFilterGroup::Codex, 0usize),
            (SourceFilterGroup::Cursor, 0usize),
            (SourceFilterGroup::OpenCode, 0usize),
            (SourceFilterGroup::Pi, 0usize),
        ];

        for session_ref in all_refs {
            let Some(session) = self.session_by_ref(session_ref) else {
                continue;
            };
            if !self.show_test_sessions && session.is_debug {
                continue;
            }
            for (group, count) in &mut counts {
                if group.matches(session.source) {
                    *count += 1;
                }
            }
        }
        counts
    }

    pub(crate) fn toggle_source_filter_popup(&mut self) {
        if self.source_filter_popup_open {
            self.source_filter_popup_open = false;
        } else {
            self.source_filter_popup_open = true;
            self.source_filter_popup_cursor = self.source_filter.index();
        }
    }

    pub(crate) fn select_source_filter(&mut self, group: SourceFilterGroup) {
        let changed = self.source_filter != group;
        self.source_filter = group;
        self.source_filter_popup_open = false;
        self.source_filter_popup_cursor = group.index();
        if changed {
            self.rebuild_items();
        }
    }

    pub(super) fn handle_source_filter_popup_key(
        &mut self,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> Option<OverlayAction> {
        if !self.source_filter_popup_open {
            return None;
        }
        match code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.source_filter_popup_open = false;
            }
            KeyCode::Char('f') if modifiers.contains(KeyModifiers::CONTROL) || modifiers.is_empty() => {
                self.source_filter_popup_open = false;
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.source_filter_popup_cursor = self
                    .source_filter_popup_cursor
                    .checked_sub(1)
                    .unwrap_or(SourceFilterGroup::ALL.len() - 1);
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.source_filter_popup_cursor =
                    (self.source_filter_popup_cursor + 1) % SourceFilterGroup::ALL.len();
            }
            KeyCode::Enter | KeyCode::Char(' ') => {
                let selected = SourceFilterGroup::ALL
                    .get(self.source_filter_popup_cursor)
                    .copied()
                    .unwrap_or(SourceFilterGroup::All);
                self.select_source_filter(selected);
            }
            _ => {}
        }
        Some(OverlayAction::Continue)
    }

    pub(super) fn handle_source_filter_mouse(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
        if mouse.kind != MouseEventKind::Down(MouseButton::Left) {
            return false;
        }
        let col = mouse.column;
        let row = mouse.row;

        if self.source_filter_popup_open {
            if let Some(popup_area) = self.last_source_filter_popup_area
                && col >= popup_area.x
                && col < popup_area.x.saturating_add(popup_area.width)
                && row >= popup_area.y
                && row < popup_area.y.saturating_add(popup_area.height)
            {
                // Inner rows start at popup_area.y + 1 (below top border)
                let inner_row = row.saturating_sub(popup_area.y + 1) as usize;
                if let Some(&group) = SourceFilterGroup::ALL.get(inner_row) {
                    self.select_source_filter(group);
                }
                return true;
            }
            // Clicking outside closes the popup
            self.source_filter_popup_open = false;
            return true;
        }

        if let Some(chip_area) = self.last_source_filter_chip_area
            && col >= chip_area.x
            && col < chip_area.x.saturating_add(chip_area.width)
            && row >= chip_area.y
            && row < chip_area.y.saturating_add(chip_area.height)
        {
            self.toggle_source_filter_popup();
            return true;
        }

        false
    }

    pub(super) fn render_source_filter_popup(&mut self, frame: &mut Frame) {
        if !self.source_filter_popup_open {
            self.last_source_filter_popup_area = None;
            return;
        }
        let frame_area = frame.area();
        if frame_area.width < 16 || frame_area.height < 6 {
            self.last_source_filter_popup_area = None;
            return;
        }

        let counts = self.source_filter_counts();
        let row_count = SourceFilterGroup::ALL.len() as u16;
        let popup_width = frame_area.width.saturating_sub(4).min(38).max(20);
        let popup_height = (row_count + 3).min(frame_area.height.saturating_sub(2));
        let area = Rect {
            x: frame_area.x + frame_area.width.saturating_sub(popup_width) / 2,
            y: frame_area.y + frame_area.height.saturating_sub(popup_height) / 2,
            width: popup_width,
            height: popup_height,
        };
        self.last_source_filter_popup_area = Some(area);

        frame.render_widget(Clear, area);

        let inner_width = area.width.saturating_sub(2) as usize;
        let max_visible_rows = area.height.saturating_sub(2) as usize;
        let mut lines: Vec<Line<'static>> = Vec::with_capacity(counts.len());

        for (idx, (group, count)) in counts.iter().enumerate().take(max_visible_rows) {
            let is_cursor = idx == self.source_filter_popup_cursor;
            let is_active = *group == self.source_filter;
            let marker = if is_active { "✓" } else { " " };
            let raw_row = format!(
                " {} {} {:<10} ({})",
                marker,
                group.glyph(),
                group.label(),
                count
            );
            let fitted = truncate_display_cells(&raw_row, inner_width);
            let style = if is_cursor {
                Style::default()
                    .fg(rgb(140, 220, 160))
                    .bg(rgb(36, 43, 42))
                    .add_modifier(Modifier::BOLD)
            } else if is_active {
                Style::default()
                    .fg(rgb(220, 235, 225))
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(rgb(190, 190, 200))
            };
            lines.push(Line::from(Span::styled(fitted, style)));
        }

        let title = truncate_display_cells(" Filter by agent ", inner_width);
        let footer = truncate_display_cells(" ↑↓/click · Enter · Esc ", inner_width);
        let popup = Paragraph::new(lines).block(
            Block::default()
                .title(title)
                .title_bottom(Line::from(Span::styled(
                    footer,
                    Style::default().fg(rgb(120, 120, 130)),
                )))
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(rgb(140, 220, 160))),
        );
        frame.render_widget(popup, area);
    }

    pub(super) fn source_filter_chip_label(&self) -> String {
        format!("[Source: {} ▾]", self.source_filter.label())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{MouseEvent, MouseEventKind};
    use ratatui::{Terminal, backend::TestBackend};

    fn make_session(id: &str, title: &str, source: SessionSource) -> SessionInfo {
        let now = chrono::Utc::now();
        SessionInfo {
            id: id.to_string(),
            parent_id: None,
            short_name: id.to_string(),
            icon: String::new(),
            title: title.to_string(),
            message_count: 2,
            user_message_count: 1,
            assistant_message_count: 1,
            created_at: now,
            last_message_time: now,
            last_active_at: Some(now),
            working_dir: Some("/tmp/repo".to_string()),
            model: None,
            provider_key: None,
            is_canary: false,
            is_debug: false,
            saved: false,
            save_label: None,
            status: SessionStatus::Closed,
            needs_catchup: false,
            estimated_tokens: 0,
            first_user_prompt: Some(title.to_string()),
            messages_preview: Vec::new(),
            search_index: title.to_lowercase(),
            server_name: None,
            server_icon: None,
            source,
            resume_target: ResumeTarget::RayuSession {
                session_id: id.to_string(),
            },
            external_path: None,
            todo_statuses: Vec::new(),
        }
    }

    #[test]
    fn source_filter_popup_filters_sessions_via_keyboard_and_mouse() {
        let sessions = vec![
            make_session("r1", "Rayu task", SessionSource::Rayu),
            make_session("c1", "Claude task", SessionSource::ClaudeCode),
            make_session("x1", "Codex task", SessionSource::Codex),
        ];
        let mut picker = SessionPicker::new(sessions);

        // Counts reflect all 3 sources
        let counts = picker.source_filter_counts();
        assert_eq!(counts[0], (SourceFilterGroup::All, 3));
        assert_eq!(counts[1], (SourceFilterGroup::Rayu, 1));
        assert_eq!(counts[2], (SourceFilterGroup::Claude, 1));
        assert_eq!(counts[3], (SourceFilterGroup::Codex, 1));

        // Open popup via 'f' key
        picker
            .handle_overlay_key(KeyCode::Char('f'), KeyModifiers::NONE)
            .unwrap();
        assert!(picker.source_filter_popup_open);

        // Navigate down 3 times (All -> Rayu -> Claude -> Codex) and press Enter
        for _ in 0..3 {
            picker
                .handle_overlay_key(KeyCode::Down, KeyModifiers::NONE)
                .unwrap();
        }
        picker
            .handle_overlay_key(KeyCode::Enter, KeyModifiers::NONE)
            .unwrap();
        assert!(!picker.source_filter_popup_open);
        assert_eq!(picker.source_filter, SourceFilterGroup::Codex);
        assert_eq!(picker.visible_sessions.len(), 1);
        assert_eq!(
            picker.selected_session().map(|s| s.id.as_str()),
            Some("x1")
        );

        // Render narrow terminal (60x20) with popup open to verify no wrapping and valid hit rect
        picker.toggle_source_filter_popup();
        let backend = TestBackend::new(60, 20);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| picker.render(frame)).unwrap();

        let popup_area = picker
            .last_source_filter_popup_area
            .expect("popup area recorded");
        assert!(popup_area.width <= 38);
        assert!(popup_area.height >= 6);

        // Click row 0 ("All") inside popup to restore all sessions
        picker.handle_overlay_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: popup_area.x + 2,
            row: popup_area.y + 1,
            modifiers: KeyModifiers::NONE,
        });
        assert!(!picker.source_filter_popup_open);
        assert_eq!(picker.source_filter, SourceFilterGroup::All);
        assert_eq!(picker.visible_sessions.len(), 3);
    }
}
