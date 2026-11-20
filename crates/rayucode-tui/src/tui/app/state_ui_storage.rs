use super::*;

pub(crate) fn compact_display_messages_for_storage(messages: &mut [DisplayMessage]) {
    // Local startup, reload snapshots, and paged history bypass the remote
    // History event handler. Normalize here too so persisted model-facing DMs
    // cannot return as full, pink system messages after a restore.
    super::remote_notifications::normalize_swarm_delivery_messages(messages);
}

pub(super) fn infer_spawned_session_startup_hints(
    message: &str,
) -> Option<(String, (String, String))> {
    let label = if message.starts_with("You are the automatic reviewer for parent session `") {
        "Autoreview"
    } else if message.starts_with("You are the automatic judge for parent session `") {
        "Autojudge"
    } else if message.starts_with("You are the one-shot reviewer for parent session `") {
        "Review"
    } else if message.starts_with("You are the one-shot judge for parent session `") {
        "Judge"
    } else {
        return None;
    };

    let parent_session_id = message.split('`').nth(1).unwrap_or("parent");
    let body = if label == "Autojudge" {
        format!(
            "🔍 {} session started for parent `{}`.\n\nThis session is analysis-only: it will inspect the recent work, send exactly one DM back telling the parent either to `CONTINUE:` with specific next steps or `STOP:` because the work is complete, and then stop. It should not continue the work or modify repo state.\n\nJudge sessions use a user-visible mirror of the parent conversation: user prompts, visible assistant replies, and shallow tool-call summaries - not the parent's full hidden tool context.",
            label, parent_session_id
        )
    } else {
        format!(
            "🔍 {} session started for parent `{}`.\n\nThis session is analysis-only: it will inspect the recent work, send exactly one DM back to the parent session, and stop. It should not continue the work or modify repo state.\n\nJudge sessions use a user-visible mirror of the parent conversation: user prompts, visible assistant replies, and shallow tool-call summaries - not the parent's full hidden tool context.",
            label, parent_session_id
        )
    };

    Some((format!("{} starting", label), (label.to_string(), body)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loaded_tool_inputs_remain_available_for_details() {
        let input = serde_json::json!({
            "command": "printf fixture".repeat(50),
            "timeout": 5000,
        });
        let mut messages = [DisplayMessage::tool(
            "fixture",
            ToolCall {
                id: "tool-fixture".into(),
                name: "bash".into(),
                input: input.clone(),
                intent: None,
                thought_signature: None,
            },
        )];
        compact_display_messages_for_storage(&mut messages);
        assert_eq!(messages[0].tool_data.as_ref().unwrap().input, input);
    }
}
