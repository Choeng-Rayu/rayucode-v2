//! Contract tests for Harness API v1.16:
//! - `HelloOk.capabilities` advertises `capabilities_v1`, `config_v1`, `frame_fidelity_v1`
//! - `GetCapabilities` curated command list, permission modes, feature flags
//! - `GetConfig` / `PatchConfig` isolated `RAYU_HOME/config.toml` + `ConfigChanged` fanout
//! - `ModelRouteInfo` enrichment (`supported_efforts`, `default_effort`, `context_window`)
//! - `translate.rs` frame fidelity (`seq`, `turn_id`, `duration_ms`, `stop_reason`,
//!   `HistoryMessage.origin`/`visibility`, `ErrorCode::Busy`/`Unsupported`)

use crate::{run_bridge_stream_with_config_bus, translate, write_json_line};
use rayucode_harness_api::{
    ApiEvent, CAPABILITIES_CAPABILITY, CONFIG_CAPABILITY, ErrorCode, FRAME_FIDELITY_CAPABILITY,
    MessageOrigin, MessageVisibility, ServerFrame,
};
use serde_json::{Value, json};
use std::ffi::OsString;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UnixListener;

struct RayuHomeGuard(Option<OsString>);

impl Drop for RayuHomeGuard {
    fn drop(&mut self) {
        match self.0.take() {
            Some(value) => unsafe { std::env::set_var("RAYU_HOME", value) },
            None => unsafe { std::env::remove_var("RAYU_HOME") },
        }
        rayucode_base::config::Config::invalidate_cache();
    }
}

fn temp_socket_path(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "rayu-v116-{label}-{}-{}.sock",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[tokio::test(flavor = "multi_thread")]
async fn hello_advertises_v1_16_capabilities_and_get_capabilities_is_curated() {
    let _lock = translate::rayu_home_test_lock();
    let home = tempfile::tempdir().unwrap();
    let _guard = RayuHomeGuard(std::env::var_os("RAYU_HOME"));
    unsafe { std::env::set_var("RAYU_HOME", home.path()) };
    rayucode_base::config::Config::invalidate_cache();

    let sock = temp_socket_path("caps");
    let listener = UnixListener::bind(&sock).unwrap();
    let (config_tx, _) = tokio::sync::broadcast::channel::<ServerFrame>(16);

    let (client, bridge) = tokio::io::duplex(64 * 1024);
    let (bridge_r, bridge_w) = tokio::io::split(bridge);
    let task = tokio::spawn(run_bridge_stream_with_config_bus(
        bridge_r,
        bridge_w,
        sock.clone(),
        config_tx,
    ));

    let (client_r, mut client_w) = tokio::io::split(client);
    let mut reader = BufReader::new(client_r);

    write_json_line(
        &mut client_w,
        &json!({"v": 1, "id": 1, "req": "hello", "min_version": 1, "max_version": 1, "client": "v116-test/1.0"}),
    )
    .await
    .unwrap();
    let (_daemon, _) = listener.accept().await.unwrap();

    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    let hello_reply: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(hello_reply["ev"], "hello_ok");
    let caps: Vec<&str> = hello_reply["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert!(caps.contains(&CAPABILITIES_CAPABILITY));
    assert!(caps.contains(&CONFIG_CAPABILITY));
    assert!(caps.contains(&FRAME_FIDELITY_CAPABILITY));

    // Request GetCapabilities
    write_json_line(
        &mut client_w,
        &json!({"v": 1, "id": 2, "req": "get_capabilities"}),
    )
    .await
    .unwrap();
    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let frame: ServerFrame = serde_json::from_str(&line).unwrap();
    assert_eq!(frame.reply_to, Some(2));
    let ApiEvent::Capabilities {
        commands,
        permission_modes,
        features,
    } = frame.event
    else {
        panic!("expected Capabilities reply, got {:?}", frame.event);
    };

    let names: Vec<&str> = commands.iter().map(|c| c.name.as_str()).collect();
    for expected in ["compact", "effort", "model", "review", "context", "cache", "clear"] {
        assert!(names.contains(&expected), "missing curated command `{expected}`");
    }
    for excluded in [
        "cls",
        "clear-view",
        "alignment",
        "debug-visual",
        "onboarding-sim",
        "update-sim",
        "terminal-setup",
        "new-terminal",
        "screenshot-mode",
    ] {
        assert!(
            !names.contains(&excluded),
            "TUI-only command `{excluded}` must not be exposed"
        );
    }
    assert!(permission_modes.iter().any(|m| m.id == "default" && m.is_default));
    assert!(permission_modes.iter().any(|m| m.id == "accept_edits"));
    assert!(permission_modes.iter().any(|m| m.id == "plan"));
    assert!(features.iter().any(|f| f.key == "features.memory"));

    drop(client_w);
    drop(reader);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), task).await;
    drop(listener);
    let _ = std::fs::remove_file(sock);
}

#[tokio::test(flavor = "multi_thread")]
async fn config_get_patch_and_peer_broadcast_over_bridge() {
    let _lock = translate::rayu_home_test_lock();
    let home = tempfile::tempdir().unwrap();
    let _guard = RayuHomeGuard(std::env::var_os("RAYU_HOME"));
    unsafe { std::env::set_var("RAYU_HOME", home.path()) };
    rayucode_base::config::Config::invalidate_cache();

    let config_path = home.path().join("config.toml");
    std::fs::write(
        &config_path,
        "# Top comment\n[display]\nemoji = true # keep inline\n",
    )
    .unwrap();
    rayucode_base::config::Config::invalidate_cache();

    let sock = temp_socket_path("cfg");
    let listener = UnixListener::bind(&sock).unwrap();
    let (config_tx, _) = tokio::sync::broadcast::channel::<ServerFrame>(16);

    // Spawn two peer clients sharing the same bridge config broadcast bus
    let (c1, b1) = tokio::io::duplex(64 * 1024);
    let (b1_r, b1_w) = tokio::io::split(b1);
    let t1 = tokio::spawn(run_bridge_stream_with_config_bus(
        b1_r,
        b1_w,
        sock.clone(),
        config_tx.clone(),
    ));
    let (c2, b2) = tokio::io::duplex(64 * 1024);
    let (b2_r, b2_w) = tokio::io::split(b2);
    let t2 = tokio::spawn(run_bridge_stream_with_config_bus(
        b2_r,
        b2_w,
        sock.clone(),
        config_tx,
    ));

    let (c1_r, mut c1_w) = tokio::io::split(c1);
    let (c2_r, mut c2_w) = tokio::io::split(c2);
    let mut r1 = BufReader::new(c1_r);
    let mut r2 = BufReader::new(c2_r);

    // Handshake both clients
    write_json_line(
        &mut c1_w,
        &json!({"v": 1, "id": 1, "req": "hello", "min_version": 1, "max_version": 1, "client": "peer-1"}),
    )
    .await
    .unwrap();
    let (_d1, _) = listener.accept().await.unwrap();
    let mut line = String::new();
    r1.read_line(&mut line).await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["ev"], "hello_ok");

    write_json_line(
        &mut c2_w,
        &json!({"v": 1, "id": 1, "req": "hello", "min_version": 1, "max_version": 1, "client": "peer-2"}),
    )
    .await
    .unwrap();
    let (_d2, _) = listener.accept().await.unwrap();
    line.clear();
    r2.read_line(&mut line).await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["ev"], "hello_ok");

    // Client 1 calls get_config
    write_json_line(
        &mut c1_w,
        &json!({"v": 1, "id": 2, "req": "get_config", "sections": ["display", "compaction"]}),
    )
    .await
    .unwrap();
    line.clear();
    r1.read_line(&mut line).await.unwrap();
    let cfg_frame: ServerFrame = serde_json::from_str(&line).unwrap();
    assert_eq!(cfg_frame.reply_to, Some(2));
    let ApiEvent::ConfigState {
        sections,
        values,
        schema,
        ..
    } = cfg_frame.event
    else {
        panic!("expected ConfigState, got {:?}", cfg_frame.event);
    };
    assert_eq!(sections, vec!["display", "compaction"]);
    assert_eq!(values.get("display.emoji"), Some(&json!(true)));
    assert!(schema.iter().any(|f| f.key == "display.emoji"));

    // Invalid patch returns InvalidRequest without modifying disk
    write_json_line(
        &mut c1_w,
        &json!({"v": 1, "id": 3, "req": "patch_config", "patch": {"provider.api_key": "nope"}}),
    )
    .await
    .unwrap();
    line.clear();
    r1.read_line(&mut line).await.unwrap();
    let err_frame: ServerFrame = serde_json::from_str(&line).unwrap();
    assert_eq!(err_frame.reply_to, Some(3));
    assert!(matches!(
        err_frame.event,
        ApiEvent::Error {
            code: ErrorCode::InvalidRequest,
            ..
        }
    ));

    // Valid patch updates config.toml, replies ConfigState to c1, and broadcasts ConfigChanged to c2
    write_json_line(
        &mut c1_w,
        &json!({"v": 1, "id": 4, "req": "patch_config", "patch": {"display.emoji": false}}),
    )
    .await
    .unwrap();
    line.clear();
    r1.read_line(&mut line).await.unwrap();
    let patched_frame: ServerFrame = serde_json::from_str(&line).unwrap();
    assert_eq!(patched_frame.reply_to, Some(4));
    let ApiEvent::ConfigState { values, .. } = patched_frame.event else {
        panic!("expected ConfigState reply, got {:?}", patched_frame.event);
    };
    assert_eq!(values.get("display.emoji"), Some(&json!(false)));

    // Peer client 2 receives ConfigChanged unsolicited broadcast
    let mut peer_line = String::new();
    tokio::time::timeout(std::time::Duration::from_secs(2), r2.read_line(&mut peer_line))
        .await
        .expect("peer should receive config_changed broadcast")
        .unwrap();
    let peer_frame: ServerFrame = serde_json::from_str(&peer_line).unwrap();
    assert_eq!(peer_frame.reply_to, None);
    let ApiEvent::ConfigChanged {
        changed_keys,
        requires_restart,
        values: changed_values,
    } = peer_frame.event
    else {
        panic!("expected ConfigChanged on peer, got {:?}", peer_frame.event);
    };
    assert_eq!(changed_keys, vec!["display.emoji".to_string()]);
    assert!(!requires_restart);
    assert_eq!(changed_values.get("display.emoji"), Some(&json!(false)));

    // Verify comment preservation on disk
    let on_disk = std::fs::read_to_string(&config_path).unwrap();
    assert!(on_disk.contains("# Top comment"));
    assert!(on_disk.contains("emoji = false # keep inline"));

    drop(c1_w);
    drop(c2_w);
    drop(r1);
    drop(r2);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), t1).await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), t2).await;
    drop(listener);
    let _ = std::fs::remove_file(sock);
}

#[test]
fn translate_attaches_seq_turn_id_duration_stop_reason_provenance_routes_and_error_codes() {
    let mut state = translate::BridgeState::default();

    // Attach to a session
    let actions = state.api_request_to_legacy(&json!({"id": 1, "req": "attach_session", "session_id": "sess_v116"}));
    let state_id = actions
        .iter()
        .find_map(|a| match a {
            translate::Outbound::Legacy(v) if v["type"] == "state" => v["id"].as_u64(),
            _ => None,
        })
        .unwrap();
    let catalog_id = actions
        .iter()
        .find_map(|a| match a {
            translate::Outbound::Legacy(v) if v["type"] == "get_model_catalog" => v["id"].as_u64(),
            _ => None,
        })
        .unwrap();

    let attached = state.legacy_event_to_api(&json!({
        "type": "state",
        "id": state_id,
        "session_id": "sess_v116",
        "is_processing": false
    }));
    assert!(attached.iter().any(|f| matches!(f.event, ApiEvent::Attached { .. })));

    // Model route enrichment: supported_efforts (minus swarm*), default_effort, context_window
    let catalog_frames = state.legacy_event_to_api(&json!({
        "type": "history",
        "id": catalog_id,
        "session_id": "sess_v116",
        "provider_name": "anthropic",
        "provider_model": "claude-opus-4-7",
        "available_models": ["claude-opus-4-7", "gpt-5.4"],
        "available_model_routes": [
            {
                "model": "claude-opus-4-7",
                "provider": "anthropic",
                "api_method": "messages",
                "available": true,
                "detail": "ready"
            },
            {
                "model": "gpt-5.4",
                "provider": "openai",
                "api_method": "responses",
                "available": true,
                "detail": "ready"
            }
        ]
    }));
    let runtime_info = catalog_frames
        .iter()
        .find_map(|f| match &f.event {
            ApiEvent::RuntimeInfo { routes, .. } => Some(routes),
            _ => None,
        })
        .expect("RuntimeInfo emitted");
    assert_eq!(runtime_info.len(), 2);
    let claude = &runtime_info[0];
    assert!(claude.supported_efforts.contains(&"xhigh".to_string()));
    assert!(!claude.supported_efforts.iter().any(|e| e.starts_with("swarm")));
    assert!(claude.default_effort.is_some());
    assert!(claude.context_window.is_some());

    let gpt = &runtime_info[1];
    assert!(gpt.supported_efforts.contains(&"minimal".to_string()));
    assert!(gpt.supported_efforts.contains(&"xhigh".to_string()));
    assert!(!gpt.supported_efforts.iter().any(|e| e.starts_with("swarm")));
    assert_eq!(gpt.context_window, Some(1_000_000));

    // Start a turn with TurnIdentity and verify monotonic seq, turn_id, duration_ms, stop_reason
    state.legacy_event_to_api(&json!({
        "type": "turn_started",
        "identity": {"runtime_generation": "gen1", "turn_id": 7}
    }));

    let delta_frames = state.legacy_event_to_api(&json!({
        "type": "turn_event",
        "identity": {"runtime_generation": "gen1", "turn_id": 7},
        "event": {"type": "text_delta", "text": "Hello"}
    }));
    assert_eq!(delta_frames.len(), 1);
    let seq1 = delta_frames[0].seq.expect("seq on TextDelta");
    assert_eq!(delta_frames[0].turn_id.as_deref(), Some("7"));

    let tool_frames = state.legacy_event_to_api(&json!({
        "type": "turn_event",
        "identity": {"runtime_generation": "gen1", "turn_id": 7},
        "event": {
            "type": "tool_done",
            "id": "call_1",
            "name": "bash",
            "output": "ok",
            "tool_duration_ms": 345
        }
    }));
    assert_eq!(tool_frames.len(), 1);
    let seq2 = tool_frames[0].seq.expect("seq on ToolDone");
    assert!(seq2 > seq1);
    assert_eq!(tool_frames[0].turn_id.as_deref(), Some("7"));
    assert!(matches!(
        &tool_frames[0].event,
        ApiEvent::ToolDone {
            duration_ms: Some(345),
            ..
        }
    ));

    let end_frames = state.legacy_event_to_api(&json!({
        "type": "turn_event",
        "identity": {"runtime_generation": "gen1", "turn_id": 7},
        "event": {"type": "message_end", "stop_reason": "end_turn"}
    }));
    assert_eq!(end_frames.len(), 1);
    let seq3 = end_frames[0].seq.expect("seq on TextDone");
    assert!(seq3 > seq2);
    assert_eq!(end_frames[0].turn_id.as_deref(), Some("7"));
    assert!(matches!(
        &end_frames[0].event,
        ApiEvent::TextDone {
            stop_reason: Some(reason),
            ..
        } if reason == "end_turn"
    ));

    // History provenance mapping
    let hist_req = state.api_request_to_legacy(&json!({"id": 10, "req": "get_history", "session_id": "sess_v116"}));
    let hist_legacy_id = match &hist_req[0] {
        translate::Outbound::Legacy(v) => v["id"].as_u64().unwrap(),
        other => panic!("expected Legacy, got {other:?}"),
    };
    let hist_frames = state.legacy_event_to_api(&json!({
        "type": "history",
        "id": hist_legacy_id,
        "session_id": "sess_v116",
        "messages": [
            {"role": "user", "content": "Fix the bug"},
            {"role": "system", "content": "Reassess the user's request", "is_engine_internal": true},
            {"role": "user", "content": "[System reminder: your previous response ended before completion]"},
            {"role": "assistant", "content": "Done"}
        ]
    }));
    let ApiEvent::History { messages, .. } = &hist_frames[0].event else {
        panic!("expected History reply");
    };
    assert_eq!(messages.len(), 4);
    assert_eq!(messages[0].origin, Some(MessageOrigin::UserTyped));
    assert_eq!(messages[0].visibility, Some(MessageVisibility::Visible));
    assert_eq!(messages[1].origin, Some(MessageOrigin::EngineInternal));
    assert_eq!(messages[1].visibility, Some(MessageVisibility::Hidden));
    assert_eq!(messages[2].origin, Some(MessageOrigin::EngineInternal));
    assert_eq!(messages[2].visibility, Some(MessageVisibility::Hidden));
    assert_eq!(messages[3].visibility, Some(MessageVisibility::Visible));

    // Busy and Unsupported error code classification
    let model_req = state.api_request_to_legacy(&json!({"id": 20, "req": "set_model", "session_id": "sess_v116", "model": "gpt-5.4"}));
    let model_legacy_id = match &model_req[0] {
        translate::Outbound::Legacy(v) => v["id"].as_u64().unwrap(),
        other => panic!("expected Legacy, got {other:?}"),
    };
    let busy_reply = state.legacy_event_to_api(&json!({
        "type": "model_changed",
        "id": model_legacy_id,
        "error": "Session is busy with a turn in progress"
    }));
    assert!(matches!(
        &busy_reply[0].event,
        ApiEvent::Error {
            code: ErrorCode::Busy,
            ..
        }
    ));

    let effort_req = state.api_request_to_legacy(&json!({"id": 21, "req": "set_reasoning_effort", "session_id": "sess_v116", "effort": "xhigh"}));
    let effort_legacy_id = match &effort_req[0] {
        translate::Outbound::Legacy(v) => v["id"].as_u64().unwrap(),
        other => panic!("expected Legacy, got {other:?}"),
    };
    let unsupported_reply = state.legacy_event_to_api(&json!({
        "type": "reasoning_effort_changed",
        "id": effort_legacy_id,
        "error": "Active model does not support reasoning effort"
    }));
    assert!(matches!(
        &unsupported_reply[0].event,
        ApiEvent::Error {
            code: ErrorCode::Unsupported,
            ..
        }
    ));
}
