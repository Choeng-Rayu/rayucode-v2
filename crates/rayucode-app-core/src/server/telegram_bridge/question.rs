use rayucode_tool_types::questions::{
    Question, QuestionCloseReason, QuestionResponse, Questionnaire,
};
use serde_json::{Value, json};

pub(super) enum Event {
    Open {
        request_id: String,
        questions: Vec<Question>,
    },
    Close {
        request_id: String,
        reason: QuestionCloseReason,
    },
    Rejected {
        request_id: String,
        message: String,
    },
}

#[derive(Clone, Copy)]
enum TextTarget {
    Other,
    Note,
}

pub(super) struct Card {
    pub request_id: String,
    pub message_id: i64,
    pub submitting: bool,
    form: Questionnaire,
    text_target: Option<TextTarget>,
}

pub(super) enum Action {
    Ignore,
    Redraw,
    Submit(QuestionResponse),
}

impl Card {
    pub fn new(request_id: String, questions: Vec<Question>) -> Self {
        Self {
            request_id,
            message_id: 0,
            submitting: false,
            form: Questionnaire::new(questions),
            text_target: None,
        }
    }

    pub fn callback(&mut self, data: &str) -> Action {
        if self.submitting {
            return Action::Ignore;
        }
        let Some((page, action)) = data
            .strip_prefix("question:")
            .and_then(|data| data.split_once(':'))
        else {
            return Action::Ignore;
        };
        if page.parse::<usize>().ok() != Some(self.form.index) {
            return Action::Ignore;
        }
        match action {
            "back" => {
                self.form.index = self.form.index.saturating_sub(1);
                self.text_target = None;
                return Action::Redraw;
            }
            "decline" => return Action::Submit(QuestionResponse::Declined),
            "submit" => return self.form.response().map_or(Action::Ignore, Action::Submit),
            _ => {}
        }
        let Some(question) = self.form.questions.get(self.form.index) else {
            return Action::Ignore;
        };
        let answer = &mut self.form.answers[self.form.index];
        match action {
            "other" => self.text_target = Some(TextTarget::Other),
            "note" => self.text_target = Some(TextTarget::Note),
            "next" if question.multi_select && answer.has_answer() => return self.advance(),
            "next" => return Action::Ignore,
            index => {
                let Ok(index) = index.parse::<usize>() else {
                    return Action::Ignore;
                };
                if index >= question.options.len() {
                    return Action::Ignore;
                }
                self.text_target = None;
                if question.multi_select {
                    answer.toggle(index);
                } else {
                    answer.selected = vec![index];
                    answer.custom.clear();
                    return self.advance();
                }
            }
        }
        Action::Redraw
    }

    pub fn text(&mut self, text: &str) -> Action {
        let text = text.trim();
        if text.is_empty() || self.submitting {
            return Action::Ignore;
        }
        let Some(question) = self.form.questions.get(self.form.index) else {
            return Action::Ignore;
        };
        let answer = &mut self.form.answers[self.form.index];
        if matches!(self.text_target.take(), Some(TextTarget::Note)) {
            answer.notes = Some(text.into());
        } else if question.multi_select {
            if !answer.custom.iter().any(|value| value == text) {
                answer.custom.push(text.into());
            }
        } else {
            answer.selected.clear();
            answer.custom = vec![text.into()];
            return self.advance();
        }
        Action::Redraw
    }

    fn advance(&mut self) -> Action {
        self.text_target = None;
        if self.form.auto_submit() {
            self.form.response().map_or(Action::Ignore, Action::Submit)
        } else {
            self.form.advance();
            Action::Redraw
        }
    }

    pub fn summary(&self) -> String {
        let answers = self
            .form
            .questions
            .iter()
            .zip(&self.form.answers)
            .map(|(question, answer)| {
                format!(
                    "{}: {}",
                    clip(&question.header, 70),
                    clip(&answer.display(question), 400)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        answers
    }

    pub fn render(&self) -> (String, Value) {
        let page = self.form.index;
        let button = |label: &str, action: &str| {
            json!({
                "text": label, "callback_data": format!("question:{page}:{action}"),
            })
        };
        let mut rows = Vec::new();
        let mut lines = Vec::new();
        if let Some(question) = self.form.questions.get(page) {
            let answer = &self.form.answers[page];
            lines.push(format!(
                "{} of {} · {}",
                page + 1,
                self.form.questions.len(),
                clip(&question.header, 70)
            ));
            lines.push(String::new());
            lines.push(clip(&question.question, 650));
            lines.push(String::new());
            for (index, option) in question.options.iter().enumerate() {
                let mark = if question.multi_select {
                    if answer.selected.contains(&index) {
                        "☑ "
                    } else {
                        "☐ "
                    }
                } else {
                    ""
                };
                let label = format!("{mark}{}", clip(&option.label, 62));
                lines.push(format!("{label} — {}", clip(&option.description, 140)));
                if !question.multi_select
                    && let Some(preview) = &option.preview
                {
                    lines.push(clip(preview, 350));
                }
                rows.push(vec![button(&label, &index.to_string())]);
            }
            if question.multi_select && answer.has_answer() {
                lines.push(format!(
                    "Selected: {}",
                    clip(&answer.display(question), 210)
                ));
                rows.push(vec![button("Next", "next")]);
            }
            if let Some(notes) = &answer.notes {
                lines.push(format!("Note: {}", clip(notes, 170)));
            }
            rows.push(vec![button("Other…", "other"), button("Add note", "note")]);
            lines.push(String::new());
            lines.push(
                match self.text_target {
                    Some(TextTarget::Other) => "Send your own answer as a message.",
                    Some(TextTarget::Note) => "Send your note as a message.",
                    None if question.multi_select => {
                        "Toggle choices, then use Next. You can also type a choice."
                    }
                    None => "Choose an option or send your own answer.",
                }
                .into(),
            );
        } else {
            lines.push("Review your answers".into());
            lines.push(String::new());
            lines.push(self.summary());
            rows.push(vec![button("Submit", "submit")]);
        }
        let mut navigation = Vec::new();
        if page > 0 {
            navigation.push(button("Back", "back"));
        }
        navigation.push(button("Decline", "decline"));
        rows.push(navigation);
        (lines.join("\n"), json!(rows))
    }
}

fn clip(text: &str, max: usize) -> String {
    let mut remaining = max;
    let mut result = String::new();
    for ch in text.chars().filter(|ch| {
        (!ch.is_control() || *ch == '\n')
            && !matches!(ch, '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
    }) {
        if remaining < ch.len_utf16() {
            result.push('…');
            break;
        }
        remaining -= ch.len_utf16();
        result.push(ch);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn question_card_routes_choices_text_and_notes_through_review() {
        let questions = serde_json::from_value(json!([
            {"question":"Format?", "header":"Format", "options":[
                {"label":"JSON","description":"Structured","preview":"Example JSON"},
                {"label":"Text","description":"Readable"}
            ]},
            {"question":"Extras?", "header":"Extras", "multiSelect":true, "options":[
                {"label":"One","description":"First"},
                {"label":"Two","description":"Second"}
            ]}
        ]))
        .unwrap();
        let mut card = Card::new("request".into(), questions);
        let (text, keyboard) = card.render();
        assert!(text.contains("Example JSON"));
        assert_eq!(keyboard[0][0]["callback_data"], "question:0:0");
        assert!(matches!(card.callback("question:0:note"), Action::Redraw));
        assert!(matches!(card.text("keep it simple"), Action::Redraw));
        assert!(matches!(card.callback("question:0:0"), Action::Redraw));
        assert!(matches!(card.callback("question:0:0"), Action::Ignore));
        assert!(matches!(card.callback("question:1:0"), Action::Redraw));
        assert!(matches!(card.text("Three"), Action::Redraw));
        assert!(matches!(card.callback("question:1:next"), Action::Redraw));
        assert!(matches!(card.text("unrelated"), Action::Ignore));
        let Action::Submit(QuestionResponse::Answered { answers }) =
            card.callback("question:2:submit")
        else {
            panic!("expected the reviewed answers")
        };
        assert_eq!(answers["Format?"].notes.as_deref(), Some("keep it simple"));
        assert_eq!(answers["Extras?"].selected, vec![0]);
        assert_eq!(answers["Extras?"].custom, vec!["Three"]);
        assert!(matches!(
            card.callback("question:2:decline"),
            Action::Submit(QuestionResponse::Declined)
        ));
    }
}
