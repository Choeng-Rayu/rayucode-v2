use super::*;

pub(super) fn handle_tool_done(
    app: &mut App,
    remote: &mut impl RemoteEventState,
    id: String,
    name: String,
    output: String,
    error: Option<String>,
    tool_duration_ms: Option<u64>,
) -> bool {
    // Read the raw output before client-side diff rendering replaces it.
    let observed_duration = remote.take_tool_duration(&id);
    let input = remote.get_tool_input(&id);
    let duration_secs = tool_duration_ms
        .map(|ms| ms as f32 / 1000.0)
        .or_else(|| DisplayMessage::tool_duration_from_output(&output))
        .or(observed_duration);
    let display_output = remote.handle_tool_done(&id, &name, &output);
    if display_output.starts_with('[')
        && display_output
            .split_once("] ")
            .is_some_and(|(_, result)| result != output)
    {
        app.raw_tool_results.insert(id.clone(), output.clone());
    }
    let display_output = if error.is_some()
        && !display_output.starts_with("Error:")
        && !display_output.starts_with("error:")
        && !display_output.starts_with("Failed:")
    {
        let reason = if output.trim().is_empty() {
            error.as_deref().unwrap_or("Tool call failed")
        } else {
            &display_output
        };
        format!("Error: {reason}")
    } else {
        display_output
    };
    let existing_tool_call = app
        .streaming_tool_calls
        .iter()
        .find(|tc| tc.id == id)
        .cloned()
        .map(|mut tool| {
            if tool.input.is_null() && !input.is_null() {
                tool.input = input.clone();
                tool.refresh_intent_from_input();
            }
            tool
        });
    let tool_call = existing_tool_call.unwrap_or_else(|| ToolCall {
        id: id.clone(),
        name: name.clone(),
        intent: ToolCall::intent_from_input(&input),
        input,
        thought_signature: None,
    });
    app.commit_pending_streaming_assistant_message();
    crate::tui::mermaid::clear_streaming_preview_diagram();
    let is_batch = tool_call.name == "batch";
    let display_output = if is_batch
        && matches!(
            error.as_deref(),
            Some("interrupted by reload" | "interrupted by user")
        ) {
        app.interrupted_batch_result(&tool_call.id, &display_output, tool_duration_ms)
            .unwrap_or(display_output)
    } else {
        display_output
    };
    app.observe_tool_result(&tool_call, &output, error.is_some(), None);
    app.note_tool_completed(&tool_call, error.is_some());
    app.push_display_message(DisplayMessage {
        role: "tool".to_string(),
        content: display_output,
        tool_calls: vec![],
        duration_secs,
        title: None,
        tool_data: Some(tool_call.clone()),
    });
    app.note_todo_gate_result(&tool_call, &output, error.is_some());
    if is_batch {
        app.batch_progress = None;
    }
    // Only remove the completed call. When the model emits several tool calls
    // in one assistant message, siblings that already streamed their parsed
    // input/intent are still waiting for their own ToolDone; clearing the
    // whole list here made their rows render with no intent or summary.
    app.streaming_tool_calls.retain(|tc| tc.id != id);
    app.status = ProcessingStatus::Streaming;
    true
}

pub(super) fn handle_generated_image(
    app: &mut App,
    id: String,
    path: String,
    metadata_path: Option<String>,
    output_format: String,
    revised_prompt: Option<String>,
) -> bool {
    app.pause_streaming_tps(false);
    app.commit_pending_streaming_assistant_message();
    let input = crate::message::generated_image_tool_input(
        &path,
        metadata_path.as_deref(),
        &output_format,
        revised_prompt.as_deref(),
    );
    let tool_call = ToolCall {
        id: id.clone(),
        name: crate::message::GENERATED_IMAGE_TOOL_NAME.to_string(),
        input,
        intent: Some("OpenAI native image generation".to_string()),
        thought_signature: None,
    };
    let summary = crate::message::generated_image_summary(
        &path,
        metadata_path.as_deref(),
        &output_format,
        revised_prompt.as_deref(),
    );
    app.push_display_message(DisplayMessage {
        role: "tool".to_string(),
        content: summary,
        tool_calls: vec![],
        duration_secs: None,
        title: Some("Generated image".to_string()),
        tool_data: Some(tool_call),
    });
    app.status = ProcessingStatus::Streaming;
    true
}
