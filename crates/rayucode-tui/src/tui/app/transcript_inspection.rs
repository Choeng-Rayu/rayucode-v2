use super::{App, KeyCode, KeyModifiers, PendingResizeAnchor};
use crate::tui::{transcript_view::TranscriptView, ui};
use unicode_segmentation::UnicodeSegmentation;

pub(super) fn is_transcript_view_command(input: &str) -> bool {
    input.split_whitespace().eq(["/transcript", "view"])
}

impl App {
    pub(super) fn presentation_modal_blocked(&self) -> bool {
        self.inline_interactive_state
            .as_ref()
            .is_some_and(|picker| !picker.preview)
            || self.session_picker_overlay.is_some()
            || self.login_picker_overlay.is_some()
            || self.account_picker_overlay.is_some()
            || self.help_scroll.is_some()
            || self.prompt_history_search.is_some()
    }

    pub(super) fn handle_transcript_toggle(
        &mut self,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> bool {
        if self.presentation_modal_blocked()
            || self.theme_picker.is_some()
            || !self.toggle_keys.transcript.matches(code, modifiers)
        {
            return false;
        }
        if self.transcript_view.is_some() {
            self.close_transcript_view();
        } else {
            self.open_transcript_view();
        }
        true
    }

    pub(super) fn open_transcript_view(&mut self) {
        if self.transcript_view.is_some() {
            return;
        }
        let frame = ui::last_chat_frame();
        let scroll = frame
            .as_ref()
            .map_or(self.scroll_offset, |_| ui::last_resolved_chat_scroll());
        let position = frame
            .as_ref()
            .and_then(|frame| rayucode_tui_messages::content_pos_at_row(frame, scroll));
        self.transcript_view = Some(TranscriptView::new(
            scroll,
            self.auto_scroll_paused,
            position,
        ));
        self.exit_copy_selection_mode();
        self.pending_resize_anchor =
            position
                .filter(|_| self.auto_scroll_paused)
                .map(|target| PendingResizeAnchor {
                    target,
                    captured_width: 0,
                    captured_scroll: scroll,
                });
        if self.auto_scroll_paused {
            self.scroll_offset = scroll;
        } else {
            self.follow_chat_bottom();
        }
        self.request_full_repaint();
    }

    fn close_transcript_view(&mut self) {
        let Some(view) = self.transcript_view.take() else {
            return;
        };
        self.pending_history_anchor = None;
        self.exit_copy_selection_mode();
        if view.origin_paused {
            self.scroll_offset = view.origin_scroll;
            self.auto_scroll_paused = true;
            self.pending_resize_anchor = view.origin_position.map(|target| PendingResizeAnchor {
                target,
                captured_width: 0,
                captured_scroll: view.origin_scroll,
            });
        } else {
            self.follow_chat_bottom();
        }
        self.request_full_repaint();
    }

    pub(super) fn handle_transcript_view_key(
        &mut self,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> bool {
        if self.presentation_modal_blocked() {
            return false;
        }
        if self.transcript_view.is_some() && self.handle_transcript_toggle(code, modifiers) {
            return true;
        }
        if self
            .transcript_view
            .as_ref()
            .is_some_and(|view| view.editing.is_none())
        {
            if self.toggle_keys.copy_selection.matches(code, modifiers) {
                self.toggle_copy_selection_mode();
                return true;
            }
            if super::input::handle_visible_copy_shortcut(self, code, modifiers) {
                return true;
            }
        }
        let Some(view) = self.transcript_view.as_mut() else {
            return false;
        };
        if let Some(query) = &mut view.editing {
            match code {
                KeyCode::Esc => view.editing = None,
                KeyCode::Enter => {
                    let query = view.editing.take().unwrap_or_default();
                    view.set_query(query);
                    self.move_transcript_match(false);
                }
                KeyCode::Backspace => {
                    if let Some((byte, _)) = query.grapheme_indices(true).next_back() {
                        query.truncate(byte);
                    }
                }
                KeyCode::Char(ch) if modifiers.difference(KeyModifiers::SHIFT).is_empty() => {
                    if query.len() < 4096 {
                        query.push(
                            if modifiers.contains(KeyModifiers::SHIFT) && ch.is_ascii_lowercase() {
                                ch.to_ascii_uppercase()
                            } else {
                                ch
                            },
                        );
                    }
                }
                _ => {}
            }
            return true;
        }
        let page = ui::last_chat_viewport_height().saturating_sub(1).max(1);
        match (code, modifiers) {
            (KeyCode::Esc, _)
            | (KeyCode::Char('q'), KeyModifiers::NONE)
            | (KeyCode::Char('c'), KeyModifiers::CONTROL) => self.close_transcript_view(),
            (KeyCode::Char('/'), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
                view.editing = Some(String::new());
                self.pause_chat_auto_scroll();
            }
            (KeyCode::Char('n'), KeyModifiers::NONE) => self.move_transcript_match(false),
            (KeyCode::Char('N'), KeyModifiers::NONE | KeyModifiers::SHIFT)
            | (KeyCode::Char('n'), KeyModifiers::SHIFT) => self.move_transcript_match(true),
            (KeyCode::Up, _) => {
                self.scroll_up(1);
            }
            (KeyCode::Down, _) => {
                self.pause_chat_auto_scroll();
                self.scroll_down(1);
            }
            (KeyCode::PageUp, _) => {
                self.scroll_up(page);
            }
            (KeyCode::PageDown, _) => {
                self.pause_chat_auto_scroll();
                self.scroll_down(page);
            }
            (KeyCode::Home, _) => {
                self.scroll_transcript_to_row(0);
            }
            (KeyCode::End, _) => {
                self.follow_chat_bottom();
            }
            _ => {}
        }
        true
    }

    fn move_transcript_match(&mut self, backward: bool) {
        let Some(frame) = ui::last_chat_frame() else {
            return;
        };
        let Some(view) = &self.transcript_view else {
            return;
        };
        if let Some(row) = view.next_match(&frame, ui::last_resolved_chat_scroll(), backward) {
            self.scroll_transcript_to_row(row);
        }
    }

    fn scroll_transcript_to_row(&mut self, row: usize) {
        self.pending_history_anchor = None;
        self.pending_resize_anchor = None;
        self.scroll_offset = row.min(ui::last_max_scroll());
        self.auto_scroll_paused = true;
        self.maybe_queue_compacted_history_load();
        self.request_full_repaint();
    }

    pub(super) fn handle_transcript_view_paste(&mut self, text: &str) -> bool {
        if self.presentation_modal_blocked() {
            return false;
        }
        let Some(view) = self.transcript_view.as_mut() else {
            return false;
        };
        if let Some(query) = &mut view.editing {
            query.extend(
                text.chars()
                    .filter(|ch| !ch.is_control())
                    .take(4096usize.saturating_sub(query.len())),
            );
        }
        true
    }
}
