use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, anyhow, ensure};
use async_trait::async_trait;
use rayucode_tool_types::questions::{
    ASK_USER_QUESTION, Question, QuestionCloseReason, QuestionOption, QuestionResponse,
};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use super::{Tool, ToolContext, ToolExecutionMode, ToolOutput};
use crate::protocol::ServerEvent;

tokio::task_local! {
    static TURN_CLIENT: Option<(String, Arc<QuestionConnection>)>;
}

pub(crate) fn scope<T>(
    session_id: &str,
    connection: Option<Arc<QuestionConnection>>,
    turn: impl Future<Output = T>,
) -> impl Future<Output = T> {
    TURN_CLIENT.scope(
        connection.map(|connection| (session_id.into(), connection)),
        turn,
    )
}

fn client(session_id: &str) -> Option<Arc<QuestionConnection>> {
    TURN_CLIENT
        .try_with(|owner| {
            owner.as_ref().and_then(|(owner_session, connection)| {
                (owner_session == session_id && !connection.events.is_closed())
                    .then(|| connection.clone())
            })
        })
        .ok()
        .flatten()
}

pub(crate) fn available(session_id: &str) -> bool {
    client(session_id).is_some_and(|connection| !connection.state.lock().unwrap().closed)
}

#[derive(Default)]
struct ConnectionState {
    closed: bool,
    pending: Option<Pending>,
}

struct Pending {
    session_id: String,
    request_id: String,
    questions: Vec<Question>,
    answer: Option<oneshot::Sender<QuestionResponse>>,
}

/// One live transport owns the question and its response channel. Never
/// publish questions to the public session bus, replay buffer, or history.
pub(crate) struct QuestionConnection {
    events: mpsc::UnboundedSender<ServerEvent>,
    state: Mutex<ConnectionState>,
}

impl QuestionConnection {
    pub(crate) fn new(events: mpsc::UnboundedSender<ServerEvent>) -> Self {
        Self {
            events,
            state: Mutex::default(),
        }
    }

    pub(crate) fn close(&self) {
        let mut state = self.state.lock().unwrap();
        state.closed = true;
        if let Some(pending) = state.pending.take() {
            self.notify_closed(pending, QuestionCloseReason::Cancelled);
        }
    }

    /// Detach on cross-session switch without writing any event onto the newly
    /// attached session's socket. Dropping any pending sender wakes the
    /// awaiting tool with a disconnect error and releases its attention guard.
    pub(crate) fn detach(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.closed = true;
        let _ = state.pending.take();
    }

    fn notify_closed(&self, pending: Pending, reason: QuestionCloseReason) {
        let _ = self.events.send(ServerEvent::QuestionClosed {
            session_id: pending.session_id,
            request_id: pending.request_id,
            reason,
        });
    }

    pub(crate) fn respond(
        &self,
        session_id: &str,
        request_id: &str,
        response: QuestionResponse,
    ) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let pending = state
            .pending
            .as_mut()
            .filter(|pending| pending.session_id == session_id && pending.request_id == request_id)
            .context("Unknown or closed question request")?;
        validate_response(&pending.questions, &response)?;
        pending
            .answer
            .take()
            .context("Question already answered")?
            .send(response)
            .map_err(|_| anyhow!("Question was cancelled"))
    }

    async fn ask(&self, ctx: &ToolContext, questions: &[Question]) -> Result<QuestionResponse> {
        let request_id = crate::id::new_id("question");
        let (sender, receiver) = oneshot::channel();
        {
            let mut state = self.state.lock().unwrap();
            ensure!(
                !state.closed && !self.events.is_closed(),
                "Question client disconnected"
            );
            ensure!(
                state.pending.is_none(),
                "A question is already open on this connection"
            );
            self.events
                .send(ServerEvent::QuestionRequest {
                    session_id: ctx.session_id.clone(),
                    request_id: request_id.clone(),
                    tool_call_id: ctx.tool_call_id.clone(),
                    questions: questions.to_vec(),
                })
                .map_err(|_| anyhow!("Question client disconnected"))?;
            state.pending = Some(Pending {
                session_id: ctx.session_id.clone(),
                request_id: request_id.clone(),
                questions: questions.to_vec(),
                answer: Some(sender),
            });
        }

        let summary = questions
            .first()
            .map(|q| {
                let text = q.question.trim();
                let header = q.header.trim();
                let raw = if header.is_empty() || text.starts_with(header) {
                    text.to_string()
                } else {
                    format!("{header}: {text}")
                };
                if raw.chars().count() > 120 {
                    let mut truncated: String = raw.chars().take(119).collect();
                    truncated.push('…');
                    truncated
                } else {
                    raw
                }
            })
            .unwrap_or_else(|| "Waiting for user answer".to_string());
        let _attention_guard = crate::server::attention_registry::register_attention(
            &ctx.session_id,
            crate::protocol::AgentAttention {
                kind: crate::protocol::AgentAttentionKind::Question,
                summary,
                request_id: Some(request_id.clone()),
                since_epoch_ms: None,
            },
        );
        let mut guard = QuestionGuard {
            connection: self,
            request_id,
            reason: QuestionCloseReason::Cancelled,
        };
        let response = receiver.await.context("Question client disconnected")?;
        guard.reason = match response {
            QuestionResponse::Answered { .. } => QuestionCloseReason::Answered,
            QuestionResponse::Declined => QuestionCloseReason::Declined,
        };
        Ok(response)
    }
}

struct QuestionGuard<'a> {
    connection: &'a QuestionConnection,
    request_id: String,
    reason: QuestionCloseReason,
}

impl Drop for QuestionGuard<'_> {
    fn drop(&mut self) {
        let mut state = self.connection.state.lock().unwrap();
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.request_id == self.request_id)
            && let Some(pending) = state.pending.take()
        {
            self.connection.notify_closed(pending, self.reason);
        }
    }
}

fn validate_response(questions: &[Question], response: &QuestionResponse) -> Result<()> {
    let QuestionResponse::Answered { answers } = response else {
        return Ok(());
    };
    ensure!(
        answers.len() == questions.len(),
        "Answer every question before submitting"
    );
    for question in questions {
        let answer = answers
            .get(&question.question)
            .with_context(|| format!("Missing answer for {:?}", question.question))?;
        let count = answer.selected.len() + answer.custom.len();
        ensure!(
            count > 0 && (question.multi_select || count == 1),
            "Invalid number of choices for {:?}",
            question.question
        );
        let mut selected = HashSet::new();
        ensure!(
            answer
                .selected
                .iter()
                .all(|&index| { index < question.options.len() && selected.insert(index) }),
            "Invalid or duplicate option for {:?}",
            question.question
        );
        ensure!(
            answer.custom.iter().all(|text| !text.trim().is_empty()),
            "Custom answer is empty for {:?}",
            question.question
        );
    }
    Ok(())
}

fn text_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(key)?.as_str().filter(|s| !s.trim().is_empty()))
}

fn derive_header(question: &str) -> String {
    let question = question.trim().trim_end_matches(['?', '.', '!']).trim_end();
    let mut header = String::new();
    for word in question.split_whitespace() {
        if header.chars().count() + word.chars().count() + usize::from(!header.is_empty()) > 12 {
            break;
        }
        if !header.is_empty() {
            header.push(' ');
        }
        header.push_str(word);
    }
    if !header.is_empty() {
        header
    } else if question.is_empty() {
        "Question".into()
    } else {
        question.chars().take(12).collect()
    }
}

fn parse_questions(input: &Value) -> Result<Vec<Question>> {
    let object = input.as_object().context("Expected a question object")?;
    for key in object.keys() {
        ensure!(
            matches!(
                key.as_str(),
                "questions" | "intent" | "metadata" | "accept_large_output"
            ),
            "Unexpected field: {key}"
        );
    }
    let items = input["questions"]
        .as_array()
        .context("questions must be an array")?;
    ensure!((1..=4).contains(&items.len()), "questions needs 1–4 items");
    let mut seen = HashSet::new();
    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let question = parse_question(item).with_context(|| format!("questions[{index}]"))?;
            ensure!(
                seen.insert(question.question.clone()),
                "questions[{index}].question must be unique"
            );
            Ok(question)
        })
        .collect()
}

fn parse_question(item: &Value) -> Result<Question> {
    let text = text_field(item, &["question", "q", "prompt", "query", "text", "title"])
        .context("question must be non-blank text")?;
    let header = text_field(
        item,
        &["header", "label", "tag", "category", "topic", "title"],
    )
    .map_or_else(|| derive_header(text), str::to_owned);
    let multi_select = item
        .get("multiSelect")
        .map(|value| value.as_bool().context("multiSelect must be a boolean"))
        .transpose()?
        .unwrap_or(false);
    let raw_options = item
        .get("options")
        .and_then(Value::as_array)
        .or_else(|| item.get("choices").and_then(Value::as_array))
        .context("options must be an array")?;
    ensure!(
        (2..=4).contains(&raw_options.len()),
        "options needs 2–4 items"
    );
    let mut labels = HashSet::new();
    let options = raw_options
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            let label = raw.as_str().filter(|s| !s.trim().is_empty()).or_else(|| {
                text_field(
                    raw,
                    &[
                        "label", "title", "text", "name", "value", "option", "choice",
                    ],
                )
            });
            let description = text_field(
                raw,
                &[
                    "description",
                    "desc",
                    "detail",
                    "details",
                    "explanation",
                    "subtitle",
                    "summary",
                ],
            );
            let label = label
                .or(description)
                .with_context(|| format!("options[{index}].label must be non-blank text"))?;
            ensure!(
                labels.insert(label),
                "options[{index}].label must be unique"
            );
            let preview = raw
                .get("preview")
                .map(|value| {
                    value
                        .as_str()
                        .with_context(|| format!("options[{index}].preview must be text"))
                })
                .transpose()?;
            Ok(QuestionOption {
                label: label.into(),
                description: description.unwrap_or(label).into(),
                preview: preview.map(str::to_owned),
            })
        })
        .collect::<Result<_>>()?;
    Ok(Question {
        question: text.into(),
        header,
        options,
        multi_select,
    })
}

pub(super) struct AskUserQuestionTool;

#[cfg(test)]
pub(crate) async fn execute_for_tests(input: Value, ctx: ToolContext) -> Result<ToolOutput> {
    AskUserQuestionTool.execute(input, ctx).await
}

pub(crate) fn definition() -> crate::message::ToolDefinition {
    AskUserQuestionTool.to_definition()
}

pub(crate) fn is_question(name: &str) -> bool {
    super::Registry::resolve_tool_name(name) == ASK_USER_QUESTION
}

#[async_trait]
impl Tool for AskUserQuestionTool {
    fn name(&self) -> &str {
        ASK_USER_QUESTION
    }

    fn model_visible(&self) -> bool {
        // The daemon adds this definition only to the live owner's turn.
        false
    }

    fn description(&self) -> &str {
        "Ask the user during a turn when an unresolved ambiguity or a meaningful decision would change the work. Inspect available context first. Batch related questions. Use distinct choices and put a recommended option first with (Recommended) in its label. Other is supplied by the client. Use multiSelect for independent choices and preview for concrete text, Markdown, or code comparisons on single-select questions. Use this for clarification and decisions, never for permissions, plan approval, or credentials."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object", "required": ["questions"], "additionalProperties": false,
            "properties": {
                "questions": {
                    "type": "array", "minItems": 1, "maxItems": 4,
                    "items": {
                        "type": "object", "required": ["question", "header", "options"],
                        "properties": {
                            "question": {"type": "string", "description": "A complete question with enough context to answer."},
                            "header": {"type": "string", "description": "Short topic label, up to 12 characters."},
                            "multiSelect": {"type": "boolean", "default": false},
                            "options": {
                                "type": "array", "minItems": 2, "maxItems": 4,
                                "items": {
                                    "type": "object", "required": ["label", "description"],
                                    "properties": {
                                        "label": {"type": "string", "description": "A concise, distinct choice."},
                                        "description": {"type": "string", "description": "What this choice means or changes."},
                                        "preview": {"type": "string", "description": "Optional text or Markdown example for a single-select choice."}
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let connection = client(&ctx.session_id)
            .filter(|_| ctx.execution_mode == ToolExecutionMode::AgentTurn)
            .context("No interactive question client is available. Ask in chat if you need clarification.")?;
        let questions = parse_questions(&input).map_err(|error| anyhow!("{error:#}"))?;
        let response = connection.ask(&ctx, &questions).await?;
        let QuestionResponse::Answered { answers } = response else {
            return Ok(ToolOutput::new(
                "The user declined to answer these questions. Continue any independent work and explain any remaining decision.",
            ));
        };
        let mut result = "User answered your questions:\n".to_owned();
        for question in &questions {
            let answer = &answers[&question.question];
            let mut details = json!({"answer": answer.display(question)});
            if !question.multi_select
                && let Some(preview) = answer
                    .selected
                    .first()
                    .and_then(|&index| question.options[index].preview.as_ref())
            {
                details["preview"] = json!(preview);
            }
            if let Some(notes) = answer
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                details["notes"] = json!(notes);
            }
            result.push_str(&format!("{}: {details}\n", json!(question.question)));
        }
        Ok(ToolOutput::new(result))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn question_input_repairs_nested_aliases_without_accepting_model_answers() {
        let input = json!({"questions":[{"prompt":"Which output format?", "choices":["JSON", {"desc":"Markdown"}]}]});
        let questions = parse_questions(&input).unwrap();
        assert_eq!(questions[0].header, "Which output");
        assert_eq!(questions[0].options[1].label, "Markdown");
        assert!(!questions[0].multi_select);

        let mut input = input;
        input["answers"] = json!({"Which output format?":"JSON"});
        assert!(parse_questions(&input).is_err());

        let bad = json!({"questions":[{"question":"Which?", "options":["Same", "Same"]}]});
        let error = parse_questions(&bad).unwrap_err();
        assert!(format!("{error:#}").contains("questions[0]: options[1].label must be unique"));
    }

    #[tokio::test]
    async fn question_disconnect_releases_the_waiter_and_rejects_future_replies() {
        let (events, mut rx) = mpsc::unbounded_channel();
        let connection = Arc::new(QuestionConnection::new(events));
        let context = ToolContext {
            session_id: "session".into(),
            message_id: "message".into(),
            tool_call_id: "call".into(),
            working_dir: None,
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: ToolExecutionMode::AgentTurn,
        };
        let worker = {
            let connection = connection.clone();
            tokio::spawn(async move {
                scope(
                    "session",
                    Some(connection),
                    AskUserQuestionTool.execute(
                        json!({
                            "questions": [{"question":"Choose?","options":["A","B"]}]
                        }),
                        context,
                    ),
                )
                .await
            })
        };
        let Some(ServerEvent::QuestionRequest { request_id, .. }) = rx.recv().await else {
            panic!("expected the question on the owner's transport");
        };
        connection.close();
        assert!(matches!(
            rx.recv().await,
            Some(ServerEvent::QuestionClosed {
                reason: QuestionCloseReason::Cancelled,
                ..
            })
        ));
        assert!(
            worker
                .await
                .unwrap()
                .unwrap_err()
                .to_string()
                .contains("disconnected")
        );
        assert!(
            connection
                .respond("session", &request_id, QuestionResponse::Declined)
                .is_err()
        );
    }

    #[test]
    fn question_rejects_partial_and_duplicate_submissions() {
        let questions = parse_questions(&json!({"questions":[
            {"question":"First?", "options":["A","B"], "multiSelect":true},
            {"question":"Second?", "options":["A","B"]},
        ]}))
        .unwrap();
        for payload in [
            json!({"First?":{"selected":[0]}}),
            json!({"First?":{"selected":[0,0]}, "Second?":{"selected":[0]}}),
            json!({"First?":{"selected":[0]}, "Second?":{"selected":[0,1]}}),
        ] {
            let reply =
                serde_json::from_value(json!({"kind":"answered","answers":payload})).unwrap();
            assert!(validate_response(&questions, &reply).is_err());
        }
        let reply = serde_json::from_value(json!({"kind":"answered","answers":{
            "First?":{"selected":[0,1],"custom":["C"]},
            "Second?":{"custom":["D"],"notes":"reason"}
        }}))
        .unwrap();
        validate_response(&questions, &reply).unwrap();
    }
}
