use super::*;

#[test]
fn legacy_swarm_member_status_and_live_status_deserialize_without_new_fields() {
    let legacy_member_json = serde_json::json!({
        "session_id": "sess-legacy",
        "friendly_name": "fox",
        "status": "running",
        "detail": "Compiling",
        "runtime": {
            "model": "claude-sonnet-4-6",
            "provider": "anthropic",
            "context_tokens": 12_000,
            "context_limit": 200_000,
            "live_status": {
                "phase": "running_tool",
                "elapsed_ms": 4200,
                "output_tps_milli": 48_200,
                "tool_name": "bash",
                "tool_intent": "cargo test"
            }
        }
    });

    let member: SwarmMemberStatus = serde_json::from_value(legacy_member_json).unwrap();
    assert_eq!(member.session_id, "sess-legacy");
    assert_eq!(member.runtime.stalled_secs, None);
    assert!(member.runtime.files_touched.is_empty());
    assert_eq!(member.runtime.pending_attention, None);
    assert_eq!(member.runtime.swarm_id, None);
    assert_eq!(member.runtime.swarm_label, None);
    assert_eq!(member.runtime.model.as_deref(), Some("claude-sonnet-4-6"));
    assert_eq!(member.runtime.context_tokens, Some(12_000));
    assert_eq!(member.runtime.context_limit, Some(200_000));
    assert!((member.runtime.tokens_per_sec().unwrap() - 48.2).abs() < 0.01);

    let live = member.runtime.live_status.as_ref().unwrap();
    assert_eq!(live.batch_progress, None);
    assert!((live.tokens_per_sec().unwrap() - 48.2).abs() < 0.01);

    // Ensure minimal legacy SwarmMemberStatus without `runtime` at all also deserializes.
    let minimal: SwarmMemberStatus =
        serde_json::from_str(r#"{"session_id":"s0","status":"ready"}"#).unwrap();
    assert!(minimal.runtime.is_empty());
    assert_eq!(minimal.runtime.pending_attention, None);
}

#[test]
fn enriched_swarm_member_runtime_and_batch_progress_roundtrip() {
    let mut member = SwarmMemberStatus {
        session_id: "sess-auth".into(),
        friendly_name: Some("worker-auth".into()),
        status: "running".into(),
        role: Some("agent".into()),
        ..Default::default()
    };
    member.runtime = SwarmMemberRuntime {
        live_status: Some(SwarmLiveStatus {
            phase: "running_tool".into(),
            elapsed_ms: 9100,
            tool_name: Some("batch".into()),
            tool_intent: Some("read auth modules".into()),
            batch_progress: Some((3, 8)),
            output_tps_milli: Some(36_500),
            ..Default::default()
        }),
        model: Some("claude-sonnet-4-6".into()),
        provider: Some("anthropic".into()),
        context_tokens: Some(64_000),
        context_limit: Some(200_000),
        stalled_secs: Some(45),
        files_touched: vec!["src/auth/pkce.rs".into(), "src/auth/token.rs".into()],
        pending_attention: Some(AgentAttention {
            kind: AgentAttentionKind::Permission,
            summary: "bash: cargo test".into(),
            request_id: Some("perm-42".into()),
            since_epoch_ms: Some(1_700_000_000_000),
        }),
        swarm_id: Some("swarm-1".into()),
        swarm_label: Some("auth-refactor".into()),
        ..Default::default()
    };

    assert!(!member.runtime.is_empty());
    let encoded = serde_json::to_value(&member).unwrap();
    assert_eq!(encoded["runtime"]["stalled_secs"], 45);
    assert_eq!(encoded["runtime"]["swarm_label"], "auth-refactor");
    assert_eq!(encoded["runtime"]["pending_attention"]["kind"], "permission");
    assert_eq!(
        encoded["runtime"]["live_status"]["batch_progress"],
        serde_json::json!([3, 8])
    );

    let decoded: SwarmMemberStatus = serde_json::from_value(encoded).unwrap();
    assert_eq!(decoded, member);

    // Individual new fields mark SwarmMemberRuntime non-empty.
    for runtime in [
        SwarmMemberRuntime {
            stalled_secs: Some(1),
            ..Default::default()
        },
        SwarmMemberRuntime {
            files_touched: vec!["a.rs".into()],
            ..Default::default()
        },
        SwarmMemberRuntime {
            pending_attention: Some(AgentAttention {
                kind: AgentAttentionKind::Stalled,
                summary: "stalled".into(),
                request_id: None,
                since_epoch_ms: None,
            }),
            ..Default::default()
        },
        SwarmMemberRuntime {
            swarm_id: Some("sw".into()),
            ..Default::default()
        },
        SwarmMemberRuntime {
            swarm_label: Some("lbl".into()),
            ..Default::default()
        },
    ] {
        assert!(!runtime.is_empty());
    }
}

#[test]
fn project_activity_types_and_events_roundtrip() {
    let attention = AgentAttention {
        kind: AgentAttentionKind::Question,
        summary: "Choose auth backend".into(),
        request_id: Some("q-9".into()),
        since_epoch_ms: Some(1_700_000_123_000),
    };
    let summary = ProjectActivitySummary {
        active_agents: 3,
        total_agents: 5,
        running_bg_tasks: 2,
        active_watchers: 1,
        active_runners: 1,
        attention_count: 1,
        primary_attention: Some(attention.clone()),
        active_runtime_note: Some("building self-dev".into()),
    };

    // Summary event round-trip (internally tagged enum with struct newtype variant)
    let summary_event = ServerEvent::ProjectActivitySummary(summary.clone());
    let encoded_summary = encode_event(&summary_event);
    let json_summary: serde_json::Value = serde_json::from_str(encoded_summary.trim()).unwrap();
    assert_eq!(json_summary["type"], "project_activity_summary");
    assert_eq!(json_summary["active_agents"], 3);
    assert_eq!(json_summary["primary_attention"]["kind"], "question");
    let decoded_summary: ServerEvent = serde_json::from_str(encoded_summary.trim()).unwrap();
    assert!(matches!(
        decoded_summary,
        ServerEvent::ProjectActivitySummary(actual) if actual == summary
    ));

    // Full snapshot round-trip
    let snapshot = ProjectActivitySnapshot {
        project_root: Some("/repo/rayucode-v2".into()),
        branch: Some("dev".into()),
        summary: summary.clone(),
        my_swarm_members: vec![SwarmMemberStatus {
            session_id: "coord".into(),
            friendly_name: Some("coordinator".into()),
            status: "running".into(),
            role: Some("coordinator".into()),
            ..Default::default()
        }],
        subagents: vec![SubagentActivityItem {
            subagent_id: "sub-1".into(),
            parent_session_id: "coord".into(),
            kind: "review".into(),
            label: "Security review".into(),
            role: "reviewer".into(),
            status: "running".into(),
            live_status: Some(SwarmLiveStatus {
                phase: "thinking".into(),
                elapsed_ms: 1500,
                ..Default::default()
            }),
            started_at_ms: 1_700_000_000_000,
        }],
        peer_sessions: vec![SwarmMemberStatus {
            session_id: "peer-fox".into(),
            friendly_name: Some("fox".into()),
            status: "ready".into(),
            ..Default::default()
        }],
        swarm_plans: vec![SwarmPlanSummary {
            swarm_id: "swarm-1".into(),
            swarm_label: Some("main".into()),
            total: 10,
            done: 6,
            running: 2,
            blocked: 1,
            failed: 1,
        }],
        background_tasks: vec![BackgroundTaskActivityItem {
            task_id: "bg-8492a1".into(),
            tool_name: "bash".into(),
            display_name: Some("cargo test --workspace".into()),
            session_id: "coord".into(),
            owner_label: Some("coordinator".into()),
            status: "running".into(),
            elapsed_secs: 72,
            progress_percent: Some(65),
            progress_label: Some("65%".into()),
            stalled: false,
            exit_code: None,
            is_watcher: false,
        }],
        runners: vec![AutonomousRunnerItem {
            id: "overnight-1".into(),
            kind: AutonomousRunnerKind::Overnight,
            title: "Nightly hardening".into(),
            status: "running".into(),
            step_current: Some(4),
            step_total: Some(12),
            detail: Some("Running integration suite".into()),
            next_run_secs: None,
            session_id: Some("sess-overnight".into()),
            elapsed_secs: Some(2520),
        }],
        generated_at_ms: 1_700_000_200_000,
    };

    let snapshot_event = ServerEvent::ProjectActivitySnapshot {
        id: Some(77),
        snapshot: snapshot.clone(),
    };
    let encoded_snap = encode_event(&snapshot_event);
    let decoded_snap: ServerEvent = serde_json::from_str(encoded_snap.trim()).unwrap();
    assert!(matches!(
        decoded_snap,
        ServerEvent::ProjectActivitySnapshot {
            id: Some(77),
            snapshot: actual
        } if actual == snapshot
    ));

    // Peek payload round-trip across all PeekTarget variants
    for target in [
        PeekTarget::Session {
            session_id: "sess-1".into(),
        },
        PeekTarget::BackgroundTask {
            task_id: "bg-1".into(),
        },
        PeekTarget::Overnight {
            run_id: "run-1".into(),
        },
        PeekTarget::Ambient,
    ] {
        let payload = SessionPeekPayload {
            target: target.clone(),
            title: "worker-auth".into(),
            subtitle: Some("swarm #1".into()),
            live_status: Some(SwarmLiveStatus {
                phase: "streaming".into(),
                elapsed_ms: 8200,
                batch_progress: Some((2, 4)),
                ..Default::default()
            }),
            model: Some("claude-sonnet-4-6".into()),
            provider: Some("anthropic".into()),
            context_used: Some(64_000),
            context_limit: Some(200_000),
            tokens_per_sec: Some(48.25),
            attention: Some(attention.clone()),
            todos: vec![SwarmTodoItem {
                content: "Run tests".into(),
                status: "in_progress".into(),
                tool_intents: Vec::new(),
            }],
            files_touched: vec!["src/lib.rs".into()],
            output_lines: vec!["line 1".into(), "line 2".into()],
            updated_at_ms: 1_700_000_300_000,
        };
        let peek_event = ServerEvent::SessionPeek {
            payload: payload.clone(),
        };
        let encoded_peek = encode_event(&peek_event);
        let decoded_peek: ServerEvent = serde_json::from_str(encoded_peek.trim()).unwrap();
        assert!(matches!(
            decoded_peek,
            ServerEvent::SessionPeek { payload: actual } if actual == payload
        ));
    }

    // BackgroundTaskCancelled round-trip
    let cancel_event = ServerEvent::BackgroundTaskCancelled {
        id: 88,
        task_id: "bg-8492a1".into(),
        cancelled: true,
        message: Some("Cancelled".into()),
    };
    let encoded_cancel = encode_event(&cancel_event);
    let decoded_cancel: ServerEvent = serde_json::from_str(encoded_cancel.trim()).unwrap();
    assert!(matches!(
        decoded_cancel,
        ServerEvent::BackgroundTaskCancelled {
            id: 88,
            task_id,
            cancelled: true,
            message
        } if task_id == "bg-8492a1" && message.as_deref() == Some("Cancelled")
    ));
}

#[test]
fn project_activity_requests_roundtrip_as_lightweight_control() {
    let cases = vec![
        (
            101,
            "get_project_activity",
            Request::GetProjectActivity {
                id: 101,
                session_id: Some("sess-1".into()),
            },
        ),
        (
            102,
            "subscribe_project_activity",
            Request::SubscribeProjectActivity {
                id: 102,
                enabled: true,
            },
        ),
        (
            103,
            "peek_session",
            Request::PeekSession {
                id: 103,
                target: Some(PeekTarget::BackgroundTask {
                    task_id: "bg-9".into(),
                }),
            },
        ),
        (
            104,
            "peek_session",
            Request::PeekSession {
                id: 104,
                target: None,
            },
        ),
        (
            105,
            "cancel_background_task",
            Request::CancelBackgroundTask {
                id: 105,
                task_id: "bg-9".into(),
            },
        ),
    ];

    for (expected_id, expected_type, request) in cases {
        assert_eq!(request.id(), expected_id);
        assert!(
            request.is_lightweight_control_request(),
            "{expected_type} must be a lightweight control request"
        );
        let serialized = serde_json::to_string(&request).unwrap();
        let json: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(json["type"], expected_type);
        let decoded = decode_request(&serialized).unwrap();
        assert_eq!(decoded.id(), expected_id);
        assert!(decoded.is_lightweight_control_request());
    }
}
