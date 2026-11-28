use super::*;
use crate::tui::app::tests::create_test_app;
use crate::tui::backend::RemoteConnection;

#[test]
fn stale_terminals_cannot_settle_or_touch_newer_work() {
    let mut app = create_test_app();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _guard = runtime.enter();
    let mut remote = RemoteConnection::dummy();
    app.is_processing = true;
    app.current_message_id = Some(99);
    app.status = ProcessingStatus::Sending;
    app.input = "unsent draft".into();
    app.replace_streaming_text("partial response".into());
    let activity = app.last_stream_activity;
    for event in [
        ServerEvent::Done { id: 98 },
        ServerEvent::Error {
            id: 98,
            message: "late failure".into(),
            retry_after_secs: None,
        },
        ServerEvent::Done { id: 100 },
    ] {
        assert!(!handle_server_event(&mut app, event, &mut remote));
        assert!(app.is_processing);
        assert_eq!(app.current_message_id, Some(99));
        assert!(matches!(app.status, ProcessingStatus::Sending));
        assert_eq!(app.input, "unsent draft");
        assert_eq!(app.streaming_text(), "partial response");
        assert_eq!(app.last_stream_activity, activity);
    }
    // Positive control: current terminal still settles the active turn.
    handle_server_event(&mut app, ServerEvent::Done { id: 99 }, &mut remote);
    assert!(!app.is_processing);
    assert_eq!(app.current_message_id, None);
}

#[test]
fn runtime_command_error_preserves_active_turn_and_clears_request_ownership() {
    let mut app = create_test_app();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let mut remote = RemoteConnection::dummy();
        let id = remote
            .runtime_command("config", vec!["invalid".into()])
            .await
            .unwrap();
        app.is_processing = true;
        app.pending_turn = true;
        app.current_message_id = Some(99);
        app.status = ProcessingStatus::Sending;
        app.input = "unsent draft".into();
        app.replace_streaming_text("partial response".into());
        let activity = app.last_stream_activity;
        assert!(handle_server_event(
            &mut app,
            ServerEvent::Error {
                id,
                message: "Session is busy. Retry this command after the current turn.".into(),
                retry_after_secs: None,
            },
            &mut remote
        ));
        assert!(app.is_processing);
        assert!(app.pending_turn);
        assert_eq!(app.current_message_id, Some(99));
        assert!(matches!(app.status, ProcessingStatus::Sending));
        assert_eq!(app.input, "unsent draft");
        assert_eq!(app.streaming_text(), "partial response");
        assert_eq!(app.last_stream_activity, activity);
        assert_eq!(app.display_messages.last().unwrap().role, "error");
        assert!(!remote.finish_runtime_command(id));

        let id = remote
            .runtime_command("poke", vec!["status".into()])
            .await
            .unwrap();
        assert!(handle_server_event(
            &mut app,
            ServerEvent::RuntimeCommandResult {
                id,
                command: "poke".into(),
                data: serde_json::json!({}),
                message: "Stopped".into(),
            },
            &mut remote
        ));
        assert!(!remote.finish_runtime_command(id));
        assert!(app.is_processing);
    });
}

#[test]
fn remote_poke_response_synchronizes_toggle_without_disrupting_turn() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _runtime_guard = runtime.enter();
    let mut app = create_test_app();
    let mut remote = RemoteConnection::dummy();
    app.is_processing = true;
    app.current_message_id = Some(99);
    app.input = "unsent draft".into();
    for enabled in [false, true, false] {
        assert!(handle_server_event(
            &mut app,
            ServerEvent::RuntimeCommandResult {
                id: 42,
                command: "poke".into(),
                data: serde_json::json!({"poke_enabled": enabled, "server_owned": true}),
                message: "Remote poke updated".into(),
            },
            &mut remote,
        ));
        assert_eq!(app.auto_poke_incomplete_todos, enabled);
        assert_eq!(app.auto_poke_default_on, enabled);
        assert!(app.is_processing);
        assert_eq!(app.current_message_id, Some(99));
        assert_eq!(app.input, "unsent draft");
        assert!(app.queued_messages.is_empty());
    }
}

#[test]
fn runtime_command_result_renders_without_starting_or_disrupting_turn() {
    let runtime = tokio::runtime::Runtime::new().unwrap();

    for active in [false, true] {
        let mut app = create_test_app();
        let _runtime_guard = runtime.enter();
        let mut remote = RemoteConnection::dummy();
        app.input = "draft prompt".into();
        app.is_processing = active;
        app.status = if active {
            ProcessingStatus::Sending
        } else {
            ProcessingStatus::Idle
        };
        app.current_message_id = active.then_some(99);
        let activity = app.last_stream_activity;
        let count = app.display_messages.len();
        let event: ServerEvent = serde_json::from_value(serde_json::json!({
            "type": "runtime_command_result", "id": 42, "command": "agents",
            "data": {"enabled": true}, "message": "Agents enabled\nDaemon configuration updated."
        }))
        .unwrap();

        assert!(handle_server_event(&mut app, event, &mut remote));
        assert_eq!(app.display_messages.len(), count + 1);
        let notice = app.display_messages.last().unwrap();
        assert_eq!(notice.role, "system");
        assert_eq!(
            notice.content,
            "Agents enabled\nDaemon configuration updated."
        );
        assert_eq!(app.is_processing, active);
        assert_eq!(matches!(app.status, ProcessingStatus::Sending), active);
        assert_eq!(app.current_message_id, active.then_some(99));
        assert_eq!(app.last_stream_activity, activity);
        assert_eq!(app.input, "draft prompt");
    }
}

#[test]
fn agents_runtime_result_syncs_daemon_overrides_into_client_mirror() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _runtime_guard = runtime.enter();
    let mut app = create_test_app();
    let mut remote = RemoteConnection::dummy();
    app.remote_session_id = Some("session_daemon_real".into());
    assert!(handle_server_event(
        &mut app,
        ServerEvent::RuntimeCommandResult {
            id: 7,
            command: "agents".into(),
            data: serde_json::json!({"scope": "session", "target": "review", "model": "coder",
                "overrides": {"review": "coder"}}),
            message: "review agent model [session] → coder".into(),
        },
        &mut remote,
    ));
    assert_eq!(
        app.session
            .agent_model_overrides
            .get("review")
            .map(String::as_str),
        Some("coder")
    );
    // Lookups go through the daemon's real session id, not the placeholder.
    assert_eq!(app.agent_models_session_id(), "session_daemon_real");
    assert_ne!(app.session.id, "session_daemon_real");
    // The synced mirror resolves the role even though the daemon's metadata
    // file is not present in this process.
    assert_eq!(
        app.session
            .effective_agent_model_for(&app.agent_models_session_id(), "review", None)
            .as_deref(),
        Some("coder")
    );
    // Results for other commands leave the mirror alone.
    assert!(handle_server_event(
        &mut app,
        ServerEvent::RuntimeCommandResult {
            id: 8,
            command: "poke".into(),
            data: serde_json::json!({"overrides": {}}),
            message: "ok".into(),
        },
        &mut remote,
    ));
    assert_eq!(app.session.agent_model_overrides.len(), 1);
}

#[test]
fn scoped_turn_fence_surfaces_control_errors_without_disrupting_turn() {
    let mut app = create_test_app();
    app.is_remote = true;
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _guard = runtime.enter();
    let mut remote = RemoteConnection::dummy();
    remote.mark_history_loaded();
    handle_server_event(
        &mut app,
        ServerEvent::TurnStarted {
            identity: crate::protocol::TurnIdentity {
                runtime_generation: "gen-1".into(),
                turn_id: 1,
            },
        },
        &mut remote,
    );
    app.current_message_id = Some(999);
    app.replace_streaming_text("streaming...".into());

    // 1. Rewind error must surface, clear pending notice, and restore history readiness.
    let rewind_id = runtime.block_on(remote.rewind(1)).unwrap();
    assert!(!remote.has_loaded_history());
    app.pending_remote_rewind_notice = Some(crate::tui::app::PendingRemoteRewindNotice {
        request_id: Some(rewind_id),
        undo: false,
        message_index: Some(1),
        changed_messages: 1,
    });
    assert!(handle_server_event(
        &mut app,
        ServerEvent::Error {
            id: rewind_id,
            message: "Cannot rewind while a turn is processing.".into(),
            retry_after_secs: None,
        },
        &mut remote,
    ));
    assert!(app.pending_remote_rewind_notice.is_none());
    assert!(remote.has_loaded_history());
    assert!(app.is_processing);
    assert_eq!(app.current_message_id, Some(999));
    assert!(
        app.display_messages
            .last()
            .unwrap()
            .content
            .contains("Cannot rewind")
    );

    // 2. Split error must clear split launch state and surface cleanly.
    let split_id = runtime.block_on(remote.split()).unwrap();
    app.pending_split_request = true;
    app.pending_split_label = Some("Review".into());
    assert!(handle_server_event(
        &mut app,
        ServerEvent::Error {
            id: split_id,
            message: "Split failed on daemon".into(),
            retry_after_secs: None,
        },
        &mut remote,
    ));
    assert!(!app.pending_split_request);
    assert!(app.pending_split_label.is_none());
    assert!(app.is_processing);
    assert_eq!(
        app.display_messages.last().unwrap().content,
        "Split failed on daemon"
    );

    // 3. Clear / feature control error must surface cleanly without dropping active turn.
    let clear_id = runtime.block_on(remote.clear()).unwrap();
    assert!(handle_server_event(
        &mut app,
        ServerEvent::Error {
            id: clear_id,
            message: "Cannot handle clear while the session is busy.".into(),
            retry_after_secs: Some(1),
        },
        &mut remote,
    ));
    assert!(app.is_processing);
    assert_eq!(app.current_message_id, Some(999));
    assert!(
        app.display_messages
            .last()
            .unwrap()
            .content
            .contains("Cannot handle clear")
    );

    // 4. Usage-reset cache invalidation Error must NOT flip refresh_usage = true.
    let reset_id = 777;
    app.usage_reset.invalidate_requests.insert(reset_id, None);
    app.usage_reset.refresh_usage = false;
    assert!(handle_server_event(
        &mut app,
        ServerEvent::Error {
            id: reset_id,
            message: "usage cache busy".into(),
            retry_after_secs: None,
        },
        &mut remote,
    ));
    assert!(!app.usage_reset.refresh_usage);
    assert!(
        app.display_messages
            .last()
            .unwrap()
            .content
            .contains("daemon usage cache could not be refreshed")
    );
}

#[test]
fn state_mutating_remote_events_request_redraw_and_error_clears_turn_fields() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _guard = runtime.enter();
    let mut app = create_test_app();
    app.is_remote = true;
    app.remote_session_id = Some("sess-1".into());
    let mut remote = RemoteConnection::dummy();

    app.is_processing = true;
    app.status = ProcessingStatus::RunningTool("bash".into());
    app.current_message_id = Some(55);
    app.processing_started = Some(Instant::now());
    app.visible_turn_started = Some(Instant::now());
    app.remote_resume_activity = Some(RemoteResumeActivity {
        session_id: "sess-1".into(),
        observed_at: Instant::now(),
        current_tool_name: Some("bash".into()),
    });
    app.streaming_tool_calls.push(crate::message::ToolCall {
        id: "call_1".into(),
        name: "bash".into(),
        input: serde_json::json!({}),
        intent: None,
        thought_signature: None,
    });
    app.replace_streaming_text("partial text".into());

    assert!(handle_server_event(
        &mut app,
        ServerEvent::Error {
            id: 55,
            message: "provider error".into(),
            retry_after_secs: None,
        },
        &mut remote,
    ));
    assert!(!app.is_processing);
    assert!(app.current_message_id.is_none());
    assert!(app.processing_started.is_none());
    assert!(app.remote_resume_activity.is_none());
    assert!(app.streaming_tool_calls.is_empty());
    assert!(app.streaming_text().is_empty());

    assert!(handle_server_event(
        &mut app,
        ServerEvent::Interrupted,
        &mut remote
    ));
    assert!(handle_server_event(
        &mut app,
        ServerEvent::ReasoningEffortChanged {
            id: 1,
            effort: Some("high".into()),
            error: None,
        },
        &mut remote,
    ));
    assert!(handle_server_event(
        &mut app,
        ServerEvent::TransportChanged {
            id: 2,
            transport: Some("websocket".into()),
            error: None,
        },
        &mut remote,
    ));
    assert!(handle_server_event(
        &mut app,
        ServerEvent::CompactionModeChanged {
            id: 3,
            mode: crate::config::CompactionMode::Reactive,
            error: None,
        },
        &mut remote,
    ));
    assert!(handle_server_event(
        &mut app,
        ServerEvent::CompactResult {
            id: 4,
            message: "Compacted".into(),
            success: true,
        },
        &mut remote,
    ));
    assert!(handle_server_event(
        &mut app,
        ServerEvent::ResumeAllResult {
            id: 5,
            resumed: 0,
            skipped: 0,
            resumed_sessions: vec![],
            message: "None".into(),
        },
        &mut remote,
    ));
    assert!(handle_server_event(
        &mut app,
        ServerEvent::StdinRequest {
            request_id: "r1".into(),
            prompt: "Password:".into(),
            is_password: true,
            tool_call_id: "c1".into(),
        },
        &mut remote,
    ));
    assert!(handle_server_event(
        &mut app,
        ServerEvent::McpStatus {
            servers: vec!["srv:1".into()],
        },
        &mut remote,
    ));
    assert!(!handle_server_event(
        &mut app,
        ServerEvent::McpStatus {
            servers: vec!["srv:1".into()],
        },
        &mut remote,
    ));
}

#[test]
fn disconnect_clears_stale_per_connection_request_state_and_busy_clear_is_blocked() {
    let mut app = create_test_app();
    app.is_remote = true;
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _guard = runtime.enter();
    let mut remote = RemoteConnection::dummy();
    remote.mark_history_loaded();

    app.push_display_message(DisplayMessage::user("keep me"));
    app.is_processing = true;
    app.input = "/clear".into();
    app.cursor_pos = app.input.len();
    runtime
        .block_on(app.handle_remote_key(KeyCode::Enter, KeyModifiers::empty(), &mut remote))
        .unwrap();
    assert!(
        app.display_messages
            .iter()
            .any(|m| m.role == "user" && m.content == "keep me"),
        "/clear while busy must not wipe transcript"
    );
    assert!(
        app.display_messages
            .last()
            .unwrap()
            .content
            .contains("Cannot clear session while a turn is processing")
    );

    app.remote_model_switch_in_flight = true;
    app.pending_agent_model_request_id = Some(42);
    app.pending_remote_file_change_request_ids.insert(43);
    app.pending_remote_rewind_notice = Some(crate::tui::app::PendingRemoteRewindNotice {
        request_id: Some(44),
        undo: false,
        message_index: Some(1),
        changed_messages: 1,
    });
    app.deferred_stream_done_id = Some(45);
    app.deferred_stream_done_identity = Some(crate::protocol::TurnIdentity {
        runtime_generation: "g".into(),
        turn_id: 2,
    });

    let mut run_state = super::super::RemoteRunState::default();
    super::super::handle_disconnect(&mut app, &mut run_state, None);

    assert!(!app.remote_model_switch_in_flight);
    assert!(app.pending_agent_model_request_id.is_none());
    assert!(app.pending_remote_file_change_request_ids.is_empty());
    assert!(app.pending_remote_rewind_notice.is_none());
    assert!(app.deferred_stream_done_id.is_none());
    assert!(app.deferred_stream_done_identity.is_none());
    assert!(!app.pending_transfer_request);
}

#[test]
fn transfer_and_subagent_errors_reset_launch_and_status_state() {
    let mut app = create_test_app();
    app.is_remote = true;
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _guard = runtime.enter();
    let mut remote = RemoteConnection::dummy();

    // 1. Unscoped Transfer error finishes split launch state even before any turn starts.
    crate::tui::app::remote::input_dispatch::begin_remote_split_launch(&mut app, "Transfer");
    app.pending_transfer_request = true;
    app.pending_split_label = Some("Transfer".into());
    let transfer_id = runtime.block_on(remote.transfer()).unwrap();
    assert!(handle_server_event(
        &mut app,
        ServerEvent::Error {
            id: transfer_id,
            message: "Cannot transfer while session is busy".into(),
            retry_after_secs: None,
        },
        &mut remote,
    ));
    assert!(!app.is_processing);
    assert!(matches!(app.status, ProcessingStatus::Idle));
    assert!(!app.pending_transfer_request);
    assert!(app.pending_split_label.is_none());
    assert!(
        app.display_messages
            .last()
            .unwrap()
            .content
            .contains("Cannot transfer")
    );

    // 2. Unscoped RunSubagent error clears app.subagent_status without disrupting active turn.
    handle_server_event(
        &mut app,
        ServerEvent::TurnStarted {
            identity: crate::protocol::TurnIdentity {
                runtime_generation: "gen-1".into(),
                turn_id: 3,
            },
        },
        &mut remote,
    );
    app.current_message_id = Some(101);
    app.subagent_status = Some("starting subagent".into());
    let subagent_id = transfer_id + 1;
    runtime
        .block_on(remote.run_subagent("inspect".into(), "explore".into(), None, None))
        .unwrap();
    assert!(handle_server_event(
        &mut app,
        ServerEvent::Error {
            id: subagent_id,
            message: "Already processing a message".into(),
            retry_after_secs: None,
        },
        &mut remote,
    ));
    assert!(app.subagent_status.is_none());
    assert!(app.is_processing);
    assert_eq!(app.current_message_id, Some(101));
    assert_eq!(
        app.display_messages.last().unwrap().content,
        "Already processing a message"
    );

    // 3. handle_disconnect clears pending_transfer_request as well.
    app.pending_transfer_request = true;
    let mut run_state = super::super::RemoteRunState::default();
    super::super::handle_disconnect(&mut app, &mut run_state, None);
    assert!(!app.pending_transfer_request);
}
