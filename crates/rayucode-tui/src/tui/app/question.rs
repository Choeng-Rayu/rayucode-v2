use std::cell::RefCell;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::{
    Frame,
    layout::{Position, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
};
use rayucode_tui_render::truncate_line_with_ellipsis_to_width;
use rayucode_tui_style::theme::{accent_color, dim_color, error_color, success_color};

use crate::tui::markdown::wrap_line;
use rayucode_tool_types::questions::{Question, QuestionResponse, Questionnaire};

#[derive(Clone, Copy, Debug)]
enum TextField {
    Other,
    Note,
}

#[derive(Debug, Default)]
struct PanelViewport {
    area: Rect,
    offset: usize,
    max_offset: usize,
    rows: usize,
    choices: Vec<(Rect, usize)>,
}

#[derive(Default)]
struct PanelLines {
    title: Vec<Line<'static>>,
    body: Vec<(Line<'static>, Option<usize>)>,
    preview: Vec<Line<'static>>,
    editor: Vec<Line<'static>>,
    choices_width: u16,
}

#[derive(Debug)]
pub(super) struct QuestionDialog {
    pub session_id: String,
    pub request_id: String,
    pub submitted: Option<u64>,
    form: Questionnaire,
    cursor: usize,
    scroll: Option<usize>,
    viewport: RefCell<PanelViewport>,
    last_response: Option<QuestionResponse>,
    editor: Option<(TextField, String)>,
    pub error: Option<String>,
}

impl QuestionDialog {
    pub fn new(session_id: String, request_id: String, questions: Vec<Question>) -> Self {
        Self {
            session_id,
            request_id,
            submitted: None,
            form: Questionnaire::new(questions),
            cursor: 0,
            scroll: None,
            viewport: RefCell::default(),
            last_response: None,
            editor: None,
            error: None,
        }
    }

    fn step_back(&mut self) {
        self.form.index = self.form.index.saturating_sub(1);
        let answer = &self.form.answers[self.form.index];
        self.cursor = if answer.custom.is_empty() {
            answer.selected.first().copied().unwrap_or(0)
        } else {
            self.form.questions[self.form.index].options.len()
        };
        self.reset_viewport();
    }

    fn advance(&mut self) -> Option<QuestionResponse> {
        if self.form.auto_submit() {
            return self.form.response();
        }
        self.form.advance();
        self.cursor = 0;
        self.reset_viewport();
        None
    }

    fn edit(&mut self, field: TextField) {
        let answer = &self.form.answers[self.form.index];
        let original = match field {
            TextField::Note => answer.notes.clone().unwrap_or_default(),
            TextField::Other => answer.custom.first().cloned().unwrap_or_default(),
        };
        if matches!(field, TextField::Other) {
            self.cursor = self.form.questions[self.form.index].options.len();
        }
        self.editor = Some((field, original));
        self.reset_viewport();
    }

    pub fn paste(&mut self, text: &str) {
        if self.submitted.is_some() || self.form.index >= self.form.questions.len() {
            return;
        }
        if self.editor.is_none() {
            self.edit(TextField::Other);
        }
        self.error = None;
        self.last_response = None;
        if let Some((_, buffer)) = &mut self.editor {
            buffer.push_str(&safe_text(text));
        }
    }

    fn edit_key(&mut self, key: KeyEvent) -> Option<QuestionResponse> {
        let (field, text) = self.editor.as_mut()?;
        match key.code {
            KeyCode::Esc => {
                self.editor = None;
                self.reset_viewport();
            }
            KeyCode::Backspace => {
                text.pop();
            }
            KeyCode::Char(ch)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                text.push(ch);
            }
            KeyCode::Enter => {
                let field = *field;
                let text = text.trim().to_owned();
                let multi_select = self.form.questions[self.form.index].multi_select;
                if matches!(field, TextField::Other) && text.is_empty() && !multi_select {
                    self.error = Some("Type an answer or press Esc to go back.".into());
                    return None;
                }
                self.editor = None;
                self.reset_viewport();
                let answer = &mut self.form.answers[self.form.index];
                match field {
                    TextField::Note => answer.notes = (!text.is_empty()).then_some(text),
                    TextField::Other => {
                        answer.custom = (!text.is_empty()).then_some(text).into_iter().collect();
                        let choices = self.form.questions[self.form.index].options.len();
                        self.cursor = self.cursor.min(choices.saturating_sub(1));
                        if !multi_select {
                            answer.selected.clear();
                            return self.advance();
                        }
                    }
                }
            }
            _ => {}
        }
        None
    }

    fn reset_viewport(&mut self) {
        self.scroll = None;
        self.viewport.get_mut().choices.clear();
    }

    fn scroll_by(&mut self, delta: isize) {
        let viewport = self.viewport.get_mut();
        let offset = self
            .scroll
            .unwrap_or(viewport.offset)
            .min(viewport.max_offset);
        let step = viewport
            .rows
            .saturating_sub(1)
            .max(1)
            .min(delta.unsigned_abs()) as isize;
        self.scroll = Some(
            offset
                .saturating_add_signed(delta.signum() * step)
                .min(viewport.max_offset),
        );
    }

    /// True if the event hit the panel, even when it had no action.
    pub fn mouse(&mut self, event: MouseEvent) -> bool {
        let point = Position::new(event.column, event.row);
        if !self.viewport.get_mut().area.contains(point) {
            return false;
        }
        match event.kind {
            MouseEventKind::ScrollUp => self.scroll_by(-3),
            MouseEventKind::ScrollDown => self.scroll_by(3),
            MouseEventKind::Down(MouseButton::Left)
                if self.submitted.is_none() && self.editor.is_none() =>
            {
                if let Some((_, index)) = self
                    .viewport
                    .get_mut()
                    .choices
                    .iter()
                    .find(|(area, _)| area.contains(point))
                {
                    self.cursor = *index;
                    self.scroll = None;
                    self.error = None;
                    self.last_response = None;
                }
            }
            _ => {}
        }
        true
    }

    pub fn key(&mut self, key: KeyEvent) -> Option<QuestionResponse> {
        if matches!(key.code, KeyCode::PageUp | KeyCode::PageDown) {
            self.scroll_by(if key.code == KeyCode::PageUp { -4 } else { 4 });
            return None;
        }
        if self.submitted.is_some() {
            return None;
        }
        if self.error.is_some()
            && key.code == KeyCode::Enter
            && let Some(response) = &self.last_response
        {
            return Some(response.clone());
        }
        self.error = None;
        self.last_response = None;
        if self.editor.is_some() {
            return self.edit_key(key);
        }
        if key.code == KeyCode::Esc {
            return Some(QuestionResponse::Declined);
        }
        let Some(question) = self.form.questions.get(self.form.index) else {
            return match key.code {
                KeyCode::Enter => self.form.response(),
                KeyCode::Left | KeyCode::BackTab => {
                    self.step_back();
                    None
                }
                _ => None,
            };
        };
        let options = question.options.len();
        match key.code {
            KeyCode::Up => {
                self.cursor = self.cursor.saturating_sub(1);
                self.scroll = None;
            }
            KeyCode::Down | KeyCode::Tab => {
                self.cursor = (self.cursor + 1).min(options);
                self.scroll = None;
            }
            KeyCode::Left | KeyCode::BackTab => self.step_back(),
            KeyCode::Char('n') => self.edit(TextField::Note),
            KeyCode::Char(' ') if self.cursor == options => self.edit(TextField::Other),
            KeyCode::Char(' ') if question.multi_select => {
                self.form.answers[self.form.index].toggle(self.cursor);
            }
            KeyCode::Enter if self.cursor == options => self.edit(TextField::Other),
            KeyCode::Enter | KeyCode::Right if question.multi_select => {
                if self.form.answers[self.form.index].has_answer() {
                    return self.advance();
                }
                self.error = Some("Select or type at least one answer.".into());
            }
            KeyCode::Enter | KeyCode::Char(' ') => {
                let answer = &mut self.form.answers[self.form.index];
                answer.selected = vec![self.cursor];
                answer.custom.clear();
                return self.advance();
            }
            _ => {}
        }
        None
    }

    pub fn summary(&self) -> String {
        self.form
            .questions
            .iter()
            .zip(&self.form.answers)
            .map(|(question, answer)| {
                format!(
                    "{}: {}",
                    safe_text(&question.header),
                    safe_text(&answer.display(question))
                )
            })
            .collect::<Vec<_>>()
            .join(" · ")
    }

    pub fn remember_response(&mut self, response: QuestionResponse) {
        self.last_response = Some(response);
    }

    pub fn height(&self, width: u16, budget: u16) -> u16 {
        let layout = self.lines(width);
        let desired = layout.title.len()
            + layout.body.len().max(layout.preview.len())
            + layout.editor.len().min(3)
            + 1
            + usize::from(self.form.questions.len() > 1);
        desired.min(usize::from(budget)) as u16
    }

    fn lines(&self, width: u16) -> PanelLines {
        let bold = Style::default().add_modifier(Modifier::BOLD);
        let muted = Style::default().fg(dim_color());
        let accent = Style::default().fg(accent_color());
        let mut layout = PanelLines {
            choices_width: width,
            ..PanelLines::default()
        };
        let Some(question) = self.form.questions.get(self.form.index) else {
            layout.title = wrapped("Review your answers", bold, width);
            for (question, answer) in self.form.questions.iter().zip(&self.form.answers) {
                layout.body.extend(
                    wrapped(&question.question, bold, width)
                        .into_iter()
                        .map(|line| (line, None)),
                );
                let text = format!("  → {}", answer.display(question));
                layout.body.extend(
                    wrapped(&text, Style::default().fg(success_color()), width)
                        .into_iter()
                        .map(|line| (line, None)),
                );
                if let Some(notes) = &answer.notes {
                    layout.body.extend(
                        wrapped(&format!("  Note · {notes}"), muted, width)
                            .into_iter()
                            .map(|line| (line, None)),
                    );
                }
            }
            return layout;
        };
        layout.title = wrapped(&question.question, bold, width);
        let preview = question
            .options
            .get(self.cursor)
            .and_then(|option| option.preview.as_deref())
            .filter(|preview| {
                !question.multi_select && self.editor.is_none() && !preview.trim().is_empty()
            });
        let preview_width = if width >= 76 && preview.is_some() {
            layout.choices_width = width / 2;
            width - layout.choices_width - 2
        } else {
            width
        };
        let answer = &self.form.answers[self.form.index];
        let other_label = answer
            .custom
            .first()
            .map(|text| format!("Other — {text}"))
            .unwrap_or_else(|| "Other — type your answer".into());
        let choices = question
            .options
            .iter()
            .map(|option| (option.label.as_str(), option.description.as_str()))
            .chain(std::iter::once((other_label.as_str(), "")));
        for (index, (label, description)) in choices.enumerate() {
            let focused = self.cursor == index;
            let checked = answer.selected.contains(&index)
                || (index == question.options.len() && !answer.custom.is_empty());
            let pointer = if focused { "› " } else { "  " };
            let check = if checked {
                "✓ "
            } else if question.multi_select {
                "□ "
            } else {
                ""
            };
            let label_style = if focused {
                bold.fg(accent_color())
            } else {
                bold
            };
            let prefix = if layout.choices_width >= 6 {
                vec![
                    Span::styled(pointer, accent),
                    Span::styled(check, Style::default().fg(success_color())),
                ]
            } else {
                vec![Span::styled(
                    if focused {
                        "›"
                    } else if checked {
                        "✓"
                    } else {
                        " "
                    },
                    accent,
                )]
            };
            let label_width = usize::from(layout.choices_width)
                .saturating_sub(prefix.iter().map(Span::width).sum::<usize>())
                .max(1) as u16;
            for (row, mut line) in wrapped(label, label_style, label_width)
                .into_iter()
                .enumerate()
            {
                if row == 0 {
                    line.spans.splice(..0, prefix.iter().cloned());
                } else {
                    line.spans.insert(
                        0,
                        Span::raw(" ".repeat(prefix.iter().map(Span::width).sum())),
                    );
                }
                layout.body.push((line, Some(index)));
            }
            if !description.trim().is_empty() && description.trim() != label.trim() {
                layout.body.extend(
                    wrapped(
                        description,
                        muted,
                        layout.choices_width.saturating_sub(4).max(1),
                    )
                    .into_iter()
                    .map(|mut line| {
                        if layout.choices_width >= 6 {
                            line.spans.insert(0, Span::raw("    "));
                        }
                        (line, Some(index))
                    }),
                );
            }
        }
        if let Some(notes) = &answer.notes {
            layout.body.extend(
                wrapped(&format!("Note · {notes}"), muted, layout.choices_width)
                    .into_iter()
                    .map(|line| (line, None)),
            );
        }
        if let Some(preview) = preview {
            let lines = std::iter::once(Line::from(Span::styled("Preview", bold))).chain(wrapped(
                preview,
                Style::default(),
                preview_width,
            ));
            if preview_width < width {
                layout.preview.extend(lines);
            } else {
                layout.body.extend(lines.map(|line| (line, None)));
            }
        }
        if let Some((field, text)) = &self.editor {
            let label = match field {
                TextField::Other => "Your answer",
                TextField::Note => "Note",
            };
            layout.editor = wrapped(&format!("{label} › {text}▏"), accent, width);
        }
        layout
    }

    pub fn draw(&self, frame: &mut Frame<'_>, area: Rect) {
        let mut viewport = PanelViewport {
            area,
            ..PanelViewport::default()
        };
        if area.is_empty() {
            if !crate::tui::ui::secondary_render_active() {
                *self.viewport.borrow_mut() = viewport;
            }
            return;
        }
        let PanelLines {
            title,
            mut body,
            preview,
            editor,
            choices_width,
        } = self.lines(area.width);
        let mut y = area.y;
        let footer_rows = u16::from(area.height >= 3 && (editor.is_empty() || area.height >= 4));
        let editor_rows = if editor.is_empty() {
            0
        } else {
            (editor.len().min(3) as u16).min(area.height.saturating_sub(footer_rows + 2).max(1))
        };
        let title_rows = title.len().min(3).min(usize::from(
            area.height
                .saturating_sub(footer_rows + editor_rows + 1)
                .max(1),
        ));
        for line in title.iter().take(title_rows) {
            render_row(frame, area, y, line.clone());
            y += 1;
        }
        // Keep the start of a long prompt pinned, with its continuation in
        // the same viewport as the choices.
        if title_rows < title.len() {
            body.splice(
                0..0,
                title
                    .into_iter()
                    .skip(title_rows)
                    .flat_map(|line| wrap_line(line, usize::from(choices_width)))
                    .map(|line| (line, None)),
            );
        }
        if self.form.questions.len() > 1
            && area.bottom().saturating_sub(y) > footer_rows + editor_rows + 2
        {
            if let Some(question) = self.form.questions.get(self.form.index) {
                let label = format!(
                    "{} of {} · {}",
                    self.form.index + 1,
                    self.form.questions.len(),
                    question.header.replace(['\n', '\t'], " ")
                );
                render_row(
                    frame,
                    area,
                    y,
                    Line::styled(safe_text(&label), Style::default().fg(dim_color())),
                );
                y += 1;
            }
        }

        let body_end = area.bottom().saturating_sub(footer_rows + editor_rows);
        let rows = usize::from(body_end.saturating_sub(y));
        viewport.rows = rows;
        viewport.max_offset = body.len().max(preview.len()).saturating_sub(rows);
        let focused_row = body
            .iter()
            .position(|(_, index)| *index == Some(self.cursor))
            .unwrap_or(0);
        let focused_end = body
            .iter()
            .rposition(|(_, index)| *index == Some(self.cursor))
            .map_or(0, |index| index + 1);
        let focus_offset = focused_end.saturating_sub(rows).min(focused_row);
        viewport.offset = self.scroll.unwrap_or(focus_offset).min(viewport.max_offset);
        let choices_area = Rect {
            width: choices_width,
            ..area
        };
        let choices_start = viewport.offset.min(body.len().saturating_sub(rows));
        for (row, (line, index)) in body.into_iter().skip(choices_start).take(rows).enumerate() {
            let row = y + row as u16;
            render_row(frame, choices_area, row, line);
            if let Some(index) = index {
                viewport
                    .choices
                    .push((Rect::new(area.x, row, choices_width, 1), index));
            }
        }
        if !preview.is_empty() {
            let preview_area = Rect::new(
                area.x + choices_width + 2,
                area.y,
                area.width - choices_width - 2,
                area.height,
            );
            let start = viewport.offset.min(preview.len().saturating_sub(rows));
            for (row, line) in preview.into_iter().skip(start).take(rows).enumerate() {
                render_row(frame, preview_area, y + row as u16, line);
            }
        }
        for (row, line) in editor
            .into_iter()
            .rev()
            .take(usize::from(editor_rows))
            .enumerate()
        {
            render_row(
                frame,
                area,
                area.bottom() - footer_rows - 1 - row as u16,
                line,
            );
        }
        if footer_rows > 0 {
            let style = Style::default().fg(if self.error.is_some() {
                error_color()
            } else {
                dim_color()
            });
            render_row(
                frame,
                area,
                area.bottom() - 1,
                Line::styled(self.footer(area.width), style),
            );
        }
        if !crate::tui::ui::secondary_render_active() {
            *self.viewport.borrow_mut() = viewport;
        }
    }

    fn footer(&self, width: u16) -> String {
        if self.submitted.is_some() {
            "Sending reply…".into()
        } else if let Some(error) = &self.error {
            let error = safe_text(error).replace(['\n', '\t'], " ");
            if self.last_response.is_some() {
                format!("Enter retry · {error}")
            } else {
                error
            }
        } else if self.editor.is_some() {
            "Enter save · Esc back".into()
        } else if let Some(question) = self.form.questions.get(self.form.index) {
            let mut text = if question.multi_select {
                "↑↓ · Space toggle · Enter next"
            } else {
                "↑↓ · Enter choose"
            }
            .to_owned();
            if self.form.index > 0 {
                text.push_str(" · ← back");
            }
            if width >= 40 {
                text.push_str(" · N note");
            }
            text.push_str(" · Esc decline");
            text
        } else {
            "Enter submit · ← back · Esc decline".into()
        }
    }
}

fn render_row(frame: &mut Frame<'_>, area: Rect, row: u16, line: Line<'static>) {
    frame.render_widget(
        Paragraph::new(truncate_line_with_ellipsis_to_width(
            &line,
            area.width.into(),
        )),
        Rect::new(area.x, row, area.width, 1),
    );
}

fn wrapped(text: &str, style: Style, width: u16) -> Vec<Line<'static>> {
    safe_text(text)
        .replace('\t', "    ")
        .split('\n')
        .flat_map(|text| {
            wrap_line(
                Line::from(Span::styled(text.to_owned(), style)),
                usize::from(width),
            )
        })
        .collect()
}

fn safe_text(text: &str) -> String {
    text.chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};
    use serde_json::json;

    fn questions() -> Vec<Question> {
        serde_json::from_value(json!([
            {"question":"Pick a format?", "header":"Format", "options":[
                {"label":"JSON","description":"Structured","preview":"Demo preview"},
                {"label":"Markdown","description":"Readable"}
            ]}
        ]))
        .unwrap()
    }

    fn press(dialog: &mut QuestionDialog, code: KeyCode) -> Option<QuestionResponse> {
        dialog.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    #[test]
    fn question_dialog_shows_preview_in_narrow_terminal_and_submits_single_choice() {
        let mut dialog = QuestionDialog::new("session".into(), "question".into(), questions());
        let mut terminal = Terminal::new(TestBackend::new(40, 24)).unwrap();
        terminal
            .draw(|frame| dialog.draw(frame, frame.area()))
            .unwrap();
        let content = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(content.contains("Pick a format?"));
        assert!(content.contains("Demo preview"));
        assert!(press(&mut dialog, KeyCode::Char('n')).is_none());
        dialog.paste("keep it short");
        assert!(press(&mut dialog, KeyCode::Enter).is_none());
        let Some(QuestionResponse::Answered { answers }) = press(&mut dialog, KeyCode::Enter)
        else {
            panic!("expected single choice to submit immediately")
        };
        assert_eq!(answers["Pick a format?"].selected, vec![0]);
        assert_eq!(
            answers["Pick a format?"].notes.as_deref(),
            Some("keep it short")
        );
    }

    #[test]
    fn question_panel_styles_choices_and_supports_mouse_focus_at_short_height() {
        let mut questions = questions();
        questions[0].multi_select = true;
        let mut dialog = QuestionDialog::new("session".into(), "question".into(), questions);
        let mut terminal = Terminal::new(TestBackend::new(32, 5)).unwrap();
        terminal
            .draw(|frame| dialog.draw(frame, frame.area()))
            .unwrap();
        let first = dialog.viewport.borrow().choices[0].0;
        let buffer = terminal.backend().buffer();
        assert_eq!(buffer[(0, 0)].symbol(), "P");
        assert!(buffer[(0, 0)].modifier.contains(Modifier::BOLD));
        assert_eq!(buffer[(4, first.y)].symbol(), "J");
        assert!(buffer[(4, first.y)].modifier.contains(Modifier::BOLD));

        assert!(press(&mut dialog, KeyCode::Char(' ')).is_none());
        terminal
            .draw(|frame| dialog.draw(frame, frame.area()))
            .unwrap();
        assert_eq!(terminal.backend().buffer()[(2, first.y)].symbol(), "✓");
        let markdown = dialog
            .viewport
            .borrow()
            .choices
            .iter()
            .find(|(_, i)| *i == 1)
            .unwrap()
            .0;
        assert!(dialog.mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: markdown.x,
            row: markdown.y,
            modifiers: KeyModifiers::NONE,
        }));
        assert_eq!(dialog.form.answers[0].selected, vec![0]);
        press(&mut dialog, KeyCode::Down);
        terminal
            .draw(|frame| dialog.draw(frame, frame.area()))
            .unwrap();
        let other = dialog
            .viewport
            .borrow()
            .choices
            .iter()
            .find(|(_, i)| *i == 2)
            .unwrap()
            .0;
        assert_eq!(terminal.backend().buffer()[(0, other.y)].symbol(), "›");
        assert_eq!(terminal.backend().buffer()[(0, 0)].symbol(), "P");
    }

    #[test]
    fn question_panel_keeps_wide_preview_beside_descriptions() {
        let dialog = QuestionDialog::new("session".into(), "question".into(), questions());
        let mut terminal = Terminal::new(TestBackend::new(90, 12)).unwrap();
        terminal
            .draw(|frame| dialog.draw(frame, frame.area()))
            .unwrap();
        let buffer = terminal.backend().buffer();
        let row = |y| (0..90).map(|x| buffer[(x, y)].symbol()).collect::<String>();
        assert!(row(1).contains("JSON"));
        assert!(row(1).contains("Preview"));
        assert!(row(2).contains("Structured"));
        assert!(row(2).contains("Demo preview"));
    }

    #[test]
    fn question_panel_retries_the_original_custom_response() {
        let mut dialog = QuestionDialog::new("session".into(), "question".into(), questions());
        dialog.paste("custom answer");
        let response = press(&mut dialog, KeyCode::Enter).unwrap();
        dialog.remember_response(response.clone());
        dialog.error = Some("Send failed".into());
        assert_eq!(press(&mut dialog, KeyCode::Enter), Some(response));
    }

    #[test]
    fn question_dialog_can_remove_a_custom_multi_select_answer() {
        let mut questions = questions();
        questions[0].multi_select = true;
        let mut dialog = QuestionDialog::new("session".into(), "question".into(), questions);
        press(&mut dialog, KeyCode::Char(' '));
        dialog.paste("X");
        press(&mut dialog, KeyCode::Enter);
        press(&mut dialog, KeyCode::Down);
        press(&mut dialog, KeyCode::Down);
        press(&mut dialog, KeyCode::Enter);
        press(&mut dialog, KeyCode::Backspace);
        press(&mut dialog, KeyCode::Enter);
        assert!(dialog.editor.is_none());
        press(&mut dialog, KeyCode::Enter);
        let Some(QuestionResponse::Answered { answers }) = press(&mut dialog, KeyCode::Enter)
        else {
            panic!("expected reviewed answers")
        };
        assert_eq!(answers["Pick a format?"].selected, vec![0]);
        assert!(answers["Pick a format?"].custom.is_empty());
    }

    #[test]
    fn question_dialog_reviews_multi_select_and_custom_text() {
        let mut questions = questions();
        questions[0].multi_select = true;
        let mut dialog = QuestionDialog::new("session".into(), "question".into(), questions);
        assert!(press(&mut dialog, KeyCode::Char(' ')).is_none());
        dialog.paste("A custom choice");
        assert!(press(&mut dialog, KeyCode::Enter).is_none());
        assert!(press(&mut dialog, KeyCode::Enter).is_none());
        let Some(QuestionResponse::Answered { answers }) = press(&mut dialog, KeyCode::Enter)
        else {
            panic!("expected review to submit both answers")
        };
        assert_eq!(answers["Pick a format?"].selected, vec![0]);
        assert_eq!(answers["Pick a format?"].custom, vec!["A custom choice"]);
        assert_eq!(
            press(&mut dialog, KeyCode::Esc),
            Some(QuestionResponse::Declined)
        );
    }
}
