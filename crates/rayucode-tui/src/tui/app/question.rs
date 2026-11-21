use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::Line,
    widgets::{Block, Clear, Paragraph, Wrap},
};
use rayucode_tool_types::questions::{Question, QuestionResponse, Questionnaire};

#[derive(Clone, Copy, Debug)]
enum TextField {
    Other,
    Note,
}

#[derive(Debug)]
pub(super) struct QuestionDialog {
    pub session_id: String,
    pub request_id: String,
    pub submitted: Option<u64>,
    form: Questionnaire,
    cursor: usize,
    scroll: u16,
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
            scroll: 0,
            editor: None,
            error: None,
        }
    }

    fn step_back(&mut self) {
        self.form.index = self.form.index.saturating_sub(1);
        self.cursor = 0;
        self.scroll = 0;
    }

    fn advance(&mut self) -> Option<QuestionResponse> {
        if self.form.auto_submit() {
            return self.form.response();
        }
        self.form.advance();
        self.cursor = 0;
        self.scroll = 0;
        None
    }

    fn edit(&mut self, field: TextField) {
        let answer = &self.form.answers[self.form.index];
        let original = match field {
            TextField::Note => answer.notes.clone().unwrap_or_default(),
            TextField::Other => answer.custom.first().cloned().unwrap_or_default(),
        };
        self.editor = Some((field, original));
    }

    pub fn paste(&mut self, text: &str) {
        if self.submitted.is_some() || self.form.index >= self.form.questions.len() {
            return;
        }
        if self.editor.is_none() {
            self.edit(TextField::Other);
        }
        if let Some((_, buffer)) = &mut self.editor {
            buffer.push_str(&safe_text(text));
        }
    }

    fn edit_key(&mut self, key: KeyEvent) -> Option<QuestionResponse> {
        let (field, text) = self.editor.as_mut()?;
        match key.code {
            KeyCode::Esc => self.editor = None,
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
                if matches!(field, TextField::Other) && text.is_empty() {
                    return None;
                }
                self.editor = None;
                let answer = &mut self.form.answers[self.form.index];
                match field {
                    TextField::Note => answer.notes = (!text.is_empty()).then_some(text),
                    TextField::Other => {
                        answer.custom = vec![text];
                        let choices = self.form.questions[self.form.index].options.len();
                        self.cursor = self.cursor.min(choices.saturating_sub(1));
                        if !self.form.questions[self.form.index].multi_select {
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

    pub fn key(&mut self, key: KeyEvent) -> Option<QuestionResponse> {
        if self.submitted.is_some() {
            return None;
        }
        self.error = None;
        if self.editor.is_some() {
            return self.edit_key(key);
        }
        if key.code == KeyCode::Esc {
            return Some(QuestionResponse::Declined);
        }
        let Some(question) = self.form.questions.get(self.form.index) else {
            return match key.code {
                KeyCode::PageUp => {
                    self.scroll = self.scroll.saturating_sub(4);
                    None
                }
                KeyCode::PageDown => {
                    self.scroll = self.scroll.saturating_add(4);
                    None
                }
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
                self.scroll = 0;
            }
            KeyCode::Down | KeyCode::Tab => {
                self.cursor = (self.cursor + 1).min(options);
                self.scroll = 0;
            }
            KeyCode::PageUp => self.scroll = self.scroll.saturating_sub(4),
            KeyCode::PageDown => self.scroll = self.scroll.saturating_add(4),
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

    pub fn draw(&self, frame: &mut Frame<'_>, area: Rect) {
        let width = area.width.min(98);
        let height = area.height.min(26);
        let rect = Rect::new(
            area.x + (area.width - width) / 2,
            area.y + (area.height - height) / 2,
            width,
            height,
        );
        frame.render_widget(Clear, rect);
        let block = Block::bordered()
            .title(" Question ")
            .title_alignment(Alignment::Left);
        let inner = block.inner(rect);
        frame.render_widget(block, rect);
        if inner.height < 3 || inner.width < 6 {
            return;
        }
        let footer = self.footer();
        let footer_height = footer.len().div_ceil(inner.width as usize).clamp(1, 3) as u16;
        let [body, footer_area] = Layout::vertical([
            Constraint::Min(1),
            Constraint::Length(footer_height.min(inner.height - 1)),
        ])
        .areas(inner);
        frame.render_widget(
            Paragraph::new(footer).wrap(Wrap { trim: true }),
            footer_area,
        );
        let Some(question) = self.form.questions.get(self.form.index) else {
            frame.render_widget(
                Paragraph::new(format!(
                    "Review your answers\n\n{}",
                    self.summary().replace(" · ", "\n")
                ))
                .wrap(Wrap { trim: false })
                .scroll((self.scroll, 0)),
                body,
            );
            return;
        };
        let answer = &self.form.answers[self.form.index];
        let mut lines = vec![
            Line::styled(
                format!(
                    "{} of {}  {}",
                    self.form.index + 1,
                    self.form.questions.len(),
                    safe_text(&question.header)
                ),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Line::from(safe_text(&question.question)),
            Line::default(),
        ];
        lines.extend(question.options.iter().enumerate().map(|(index, option)| {
            let mark = if question.multi_select && answer.selected.contains(&index) {
                "[x] "
            } else if question.multi_select {
                "[ ] "
            } else {
                ""
            };
            let cursor = if self.cursor == index { "› " } else { "  " };
            Line::from(format!("{cursor}{mark}{}", safe_text(&option.label)))
        }));
        lines.push(Line::from(format!(
            "{}Other{}",
            if self.cursor == question.options.len() {
                "› "
            } else {
                "  "
            },
            if answer.custom.is_empty() { "" } else { " ✓" }
        )));
        lines.push(Line::default());
        if let Some((field, text)) = &self.editor {
            lines.push(Line::from(format!("{field:?}: {}▏", safe_text(text))));
        } else {
            if let Some(option) = question.options.get(self.cursor) {
                lines.push(Line::from(safe_text(&option.description)));
            }
            if let Some(notes) = &answer.notes {
                lines.push(Line::from(format!("Note: {}", safe_text(notes))));
            }
        }
        let preview = question
            .options
            .get(self.cursor)
            .and_then(|option| option.preview.as_deref())
            .filter(|_| !question.multi_select && self.editor.is_none());
        if body.height < 8
            && let Some(preview) = preview
        {
            lines.push(Line::raw("Preview"));
            lines.extend(preview.lines().map(|line| Line::from(safe_text(line))));
        }
        let main = Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((self.scroll, 0));
        if let Some(preview) = preview.filter(|_| body.height >= 8) {
            let layout = if body.width >= 76 {
                Layout::horizontal([Constraint::Percentage(52), Constraint::Percentage(48)])
            } else {
                Layout::vertical([Constraint::Percentage(65), Constraint::Percentage(35)])
            };
            let [choices, example] = layout.areas(body);
            frame.render_widget(main, choices);
            frame.render_widget(
                Paragraph::new(safe_text(preview))
                    .block(Block::bordered().title(" Preview "))
                    .wrap(Wrap { trim: false })
                    .scroll((self.scroll, 0)),
                example,
            );
        } else {
            frame.render_widget(main, body);
        }
    }

    fn footer(&self) -> &str {
        if self.submitted.is_some() {
            "Sending reply…"
        } else if let Some(error) = &self.error {
            error
        } else if self.editor.is_some() {
            "Enter Save  Esc Back"
        } else if let Some(question) = self.form.questions.get(self.form.index) {
            if question.multi_select {
                "↑↓ Move  Space Toggle  Enter Next  ← Back  N Note  Esc Decline"
            } else {
                "↑↓ Move  Enter Choose  ← Back  N Note  Esc Decline"
            }
        } else {
            "Enter Submit  ← Back  Esc Decline"
        }
    }
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
