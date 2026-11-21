use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const ASK_USER_QUESTION: &str = "ask_user_question";
pub const QUESTION_CAPABILITY: &str = "user_questions";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Question {
    pub question: String,
    pub header: String,
    pub options: Vec<QuestionOption>,
    #[serde(default, rename = "multiSelect")]
    pub multi_select: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

/// Choices identify the original options by zero-based index. Custom text
/// stays separate so it cannot be mistaken for a choice with a preview.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuestionAnswer {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selected: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl QuestionAnswer {
    pub fn has_answer(&self) -> bool {
        !self.selected.is_empty() || self.custom.iter().any(|text| !text.trim().is_empty())
    }

    pub fn display(&self, question: &Question) -> String {
        self.selected
            .iter()
            .filter_map(|&index| {
                question
                    .options
                    .get(index)
                    .map(|option| option.label.as_str())
            })
            .chain(self.custom.iter().map(|text| text.trim()))
            .collect::<Vec<_>>()
            .join(", ")
    }

    pub fn toggle(&mut self, index: usize) {
        if let Some(position) = self.selected.iter().position(|&selected| selected == index) {
            self.selected.remove(position);
        } else {
            self.selected.push(index);
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum QuestionResponse {
    Answered {
        answers: BTreeMap<String, QuestionAnswer>,
    },
    Declined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionCloseReason {
    Answered,
    Declined,
    Cancelled,
}

/// Draft shared by the terminal and Telegram renderers.
#[derive(Debug)]
pub struct Questionnaire {
    pub questions: Vec<Question>,
    pub index: usize,
    pub answers: Vec<QuestionAnswer>,
}

impl Questionnaire {
    pub fn new(questions: Vec<Question>) -> Self {
        let answers = vec![QuestionAnswer::default(); questions.len()];
        Self {
            questions,
            index: 0,
            answers,
        }
    }

    pub fn auto_submit(&self) -> bool {
        self.questions.len() == 1 && !self.questions[0].multi_select
    }

    pub fn complete(&self) -> bool {
        self.answers.iter().all(QuestionAnswer::has_answer)
    }

    pub fn advance(&mut self) {
        self.index = (self.index + 1..self.answers.len())
            .chain(0..self.index.min(self.answers.len()))
            .find(|&index| !self.answers[index].has_answer())
            .unwrap_or(self.answers.len());
    }

    pub fn response(&self) -> Option<QuestionResponse> {
        self.complete().then(|| QuestionResponse::Answered {
            answers: self
                .questions
                .iter()
                .zip(&self.answers)
                .map(|(question, answer)| (question.question.clone(), answer.clone()))
                .collect(),
        })
    }
}
