use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{Result, ensure};
use serde_json::Value;
use uuid::Uuid;

use crate::safety::{PermissionRequest, Urgency, telegram};

pub(crate) const TICKET_PREFIX: &str = "rayu-internal-telegram:";
const TOOLS: &[&str] = &[
    "read",
    "glob",
    "grep",
    "agentgrep",
    "bash",
    "write",
    "edit",
    "apply_patch",
    "patch",
    "ask_user",
    "propose_plan",
    "send_media",
];

fn active() -> &'static Mutex<HashMap<String, Uuid>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, Uuid>>> = OnceLock::new();
    ACTIVE.get_or_init(Default::default)
}

struct Scope(String);

impl Drop for Scope {
    fn drop(&mut self) {
        active()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.0);
    }
}

struct Admission {
    session: String,
    generation: Uuid,
    issued: Instant,
}

fn tickets() -> &'static Mutex<HashMap<String, Admission>> {
    static TICKETS: OnceLock<Mutex<HashMap<String, Admission>>> = OnceLock::new();
    TICKETS.get_or_init(Default::default)
}

pub(crate) fn ticket(session: &str, generation: Uuid) -> String {
    let key = format!("{TICKET_PREFIX}{}", Uuid::new_v4());
    if let Ok(mut tickets) = tickets().lock() {
        tickets.retain(|_, admission| admission.issued.elapsed() < Duration::from_secs(20));
        tickets.insert(
            key.clone(),
            Admission {
                session: session.into(),
                generation,
                issued: Instant::now(),
            },
        );
    }
    key
}

pub(crate) fn is_ticket(reminder: &Option<String>) -> bool {
    reminder
        .as_deref()
        .is_some_and(|value| value.starts_with(TICKET_PREFIX))
}

pub(crate) fn take_ticket(reminder: &mut Option<String>, session: &str) -> Result<Option<Uuid>> {
    let Some(value) = reminder
        .as_deref()
        .filter(|value| value.starts_with(TICKET_PREFIX))
    else {
        return Ok(None);
    };
    let ticket = tickets()
        .lock()
        .ok()
        .and_then(|mut tickets| tickets.remove(value))
        .filter(|ticket| {
            ticket.session == session && ticket.issued.elapsed() < Duration::from_secs(20)
        })
        .ok_or_else(|| anyhow::anyhow!("Expired Telegram turn authorization"))?;
    ensure!(
        super::load()?
            .is_some_and(|link| link.generation == ticket.generation && link.owner.is_some()),
        "Telegram link has closed"
    );
    *reminder = None;
    Ok(Some(ticket.generation))
}

pub(crate) async fn scope<T>(
    session: String,
    generation: Option<Uuid>,
    turn: impl Future<Output = T>,
) -> T {
    let _scope = generation.map(|generation| {
        active()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(session.clone(), generation);
        Scope(session)
    });
    turn.await
}

pub(super) fn remote_generation(session: &str) -> Option<Uuid> {
    active()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(session)
        .copied()
}

pub(crate) fn is_remote(session: &str) -> bool {
    remote_generation(session).is_some()
}

pub(crate) fn remote_tool_allowed(name: &str) -> bool {
    TOOLS.contains(&name)
}

struct Pending(String);

impl Drop for Pending {
    fn drop(&mut self) {
        telegram::remove(&self.0);
    }
}

pub(crate) fn interaction_definitions() -> [crate::message::ToolDefinition; 3] {
    fn definition(name: &str, description: &str) -> crate::message::ToolDefinition {
        crate::message::ToolDefinition::new(
            name,
            description,
            serde_json::json!({
                "type": "object", "additionalProperties": false, "required": ["text"],
                "properties": { "text": { "type": "string", "maxLength": 3000 } }
            }),
        )
    }
    [
        definition(
            "ask_user",
            "Ask a question and wait for the linked user to answer. Never ask for passwords or credentials.",
        ),
        definition(
            "propose_plan",
            "Present the implementation plan for user approval before starting work.",
        ),
        crate::message::ToolDefinition::new(
            "send_media",
            "Ask permission to send a PNG, JPEG, WebP, or MP4 from the current project to the linked Telegram chat.",
            serde_json::json!({ "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": { "path": { "type": "string" } } }),
        ),
    ]
}

pub(crate) async fn interact(
    name: &str,
    input: Value,
    session: &str,
) -> Result<crate::tool::ToolOutput> {
    let text = input
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty() && text.encode_utf16().count() <= 3000)
        .ok_or_else(|| anyhow::anyhow!("Expected text of up to 3,000 UTF-16 units"))?;
    let reason = if name == "ask_user" {
        "The agent is waiting for your answer."
    } else {
        "The agent is waiting for your decision on this plan."
    };
    let decision = wait_for_decision(name, text.to_owned(), session, reason).await?;
    let result = match (name, decision.approved, decision.message) {
        ("ask_user", true, Some(answer)) => format!("User answered: {answer}"),
        ("ask_user", _, _) => "The user declined to answer.".into(),
        (_, true, _) => {
            "The user approved this plan. Tool actions still require individual approval.".into()
        }
        (_, false, Some(reason)) => format!("The user declined the plan: {reason}"),
        (_, false, None) => "The user declined the plan.".into(),
    };
    Ok(crate::tool::ToolOutput::new(result))
}

pub(crate) async fn authorize_tool(name: &str, input: &Value, session: &str) -> Result<()> {
    ensure!(
        remote_tool_allowed(name),
        "This tool is unavailable on Telegram"
    );
    let decision = wait_for_decision(
        name,
        serde_json::to_string_pretty(input)?,
        session,
        "A Telegram turn requested this tool.",
    )
    .await?;
    ensure!(decision.approved, "The tool was denied");
    Ok(())
}

async fn wait_for_decision(
    action: &str,
    description: String,
    session: &str,
    rationale: &str,
) -> Result<crate::safety::Decision> {
    let generation =
        remote_generation(session).ok_or_else(|| anyhow::anyhow!("Telegram turn has closed"))?;
    let linked = || {
        super::load().is_ok_and(|link| {
            link.is_some_and(|link| {
                link.generation == generation && link.owner.is_some() && link.active_account()
            })
        })
    };
    ensure!(linked(), "Telegram link has closed");
    let id = telegram::new_id();
    let mut visible = String::with_capacity(description.len());
    for ch in description.chars() {
        if matches!(ch, '\u{200e}' | '\u{200f}' | '\u{061c}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        {
            visible.extend(ch.escape_unicode());
        } else {
            visible.push(ch);
        }
    }
    let request = PermissionRequest {
        id: id.clone(),
        action: action.into(),
        description: visible,
        rationale: rationale.into(),
        urgency: Urgency::Normal,
        wait: true,
        created_at: chrono::Utc::now(),
        context: Some(serde_json::json!({ "session_id": session })),
    };
    telegram::publish(&telegram::Approval {
        request,
        generation,
        decision: None,
    })?;
    let _pending = Pending(id.clone());
    tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            ensure!(linked(), "Telegram link has closed");
            if let Some(decision) = telegram::read(&id)?.decision {
                return Ok(decision);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    })
    .await
    .map_err(|_| anyhow::anyhow!("Telegram approval expired"))?
}
