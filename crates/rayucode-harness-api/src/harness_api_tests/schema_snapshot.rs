//! Schema snapshot tests: fail if the wire shape changes accidentally.

use crate::*;

#[test]
fn create_session_system_prompt_roundtrip_and_legacy_default() {
    let legacy = serde_json::json!({"req": "create_session"});
    let decoded: ApiRequest = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), legacy);
    for prompt in ["Custom system instructions\nwith unicode: 世界", ""] {
        let request = ApiRequest::CreateSession {
            working_dir: None,
            system_prompt: Some(prompt.into()),
        };
        let wire = serde_json::to_value(&request).unwrap();
        assert_eq!(wire["system_prompt"], prompt);
        assert_eq!(serde_json::from_value::<ApiRequest>(wire).unwrap(), request);
    }
}

#[test]
fn token_usage_preserves_cache_creation_and_accepts_legacy_frames() {
    let legacy = r#"{"v":1,"ev":"token_usage","session_id":"s1","input":10,"output":5,"cache_read_input":2}"#;
    let legacy_frame: ServerFrame = serde_json::from_str(legacy).unwrap();
    assert!(matches!(
        &legacy_frame.event,
        ApiEvent::TokenUsage {
            cache_creation_input: None,
            ..
        }
    ));
    assert_eq!(serde_json::to_string(&legacy_frame).unwrap(), legacy);

    for cache_creation_input in [Some(0), Some(42)] {
        let frame = ServerFrame::event(ApiEvent::TokenUsage {
            session_id: "s1".into(),
            input: 10,
            output: 5,
            cache_read_input: Some(2),
            cache_creation_input,
            effective_budget: None,
        });
        let wire = serde_json::to_value(&frame).unwrap();
        assert_eq!(wire["cache_creation_input"], cache_creation_input.unwrap());
        let decoded: ServerFrame = serde_json::from_value(wire).unwrap();
        assert_eq!(decoded.event, frame.event);
    }
}

#[test]
fn client_frame_wire_shape() {
    let frame = ClientFrame::new(
        7,
        ApiRequest::SendMessage {
            session_id: "s1".into(),
            content: "hi".into(),
            images: vec![],
            system_reminder: None,
            no_reply: false,
        },
    );
    let json = serde_json::to_string(&frame).unwrap();
    assert_eq!(
        json,
        r#"{"v":1,"id":7,"req":"send_message","session_id":"s1","content":"hi"}"#
    );
}

#[test]
fn send_message_no_reply_wire_shape_and_legacy_default() {
    let frame = ClientFrame::new(
        8,
        ApiRequest::SendMessage {
            session_id: "s1".into(),
            content: "context".into(),
            images: vec![],
            system_reminder: None,
            no_reply: true,
        },
    );
    let json = serde_json::to_string(&frame).unwrap();
    assert_eq!(
        json,
        r#"{"v":1,"id":8,"req":"send_message","session_id":"s1","content":"context","no_reply":true}"#
    );

    let legacy: ClientFrame = serde_json::from_str(
        r#"{"v":1,"id":9,"req":"send_message","session_id":"s1","content":"old","images":[]}"#,
    )
    .unwrap();
    assert!(matches!(
        legacy.request,
        ApiRequest::SendMessage {
            system_reminder: None,
            no_reply: false,
            ..
        }
    ));
}

#[test]
fn soft_interrupt_images_wire_shape_and_legacy_default() {
    let frame = ClientFrame::new(
        10,
        ApiRequest::SoftInterrupt {
            session_id: "s1".into(),
            content: "look".into(),
            images: vec![("image/png".into(), "aW1hZ2U=".into())],
            urgent: true,
            client_id: None,
        },
    );
    assert_eq!(
        serde_json::to_string(&frame).unwrap(),
        r#"{"v":1,"id":10,"req":"soft_interrupt","session_id":"s1","content":"look","images":[["image/png","aW1hZ2U="]],"urgent":true}"#
    );

    let legacy: ClientFrame = serde_json::from_str(
        r#"{"v":1,"id":11,"req":"soft_interrupt","session_id":"s1","content":"old"}"#,
    )
    .unwrap();
    assert!(matches!(
        legacy.request,
        ApiRequest::SoftInterrupt {
            images,
            urgent: false,
            ..
        } if images.is_empty()
    ));
}

#[test]
fn soft_interrupt_ids_requests_and_events_wire_shape() {
    let frame = ClientFrame::new(
        12,
        ApiRequest::SoftInterrupt {
            session_id: "s1".into(),
            content: "steer".into(),
            images: vec![],
            urgent: false,
            client_id: Some("f1".into()),
        },
    );
    assert_eq!(
        serde_json::to_string(&frame).unwrap(),
        r#"{"v":1,"id":12,"req":"soft_interrupt","session_id":"s1","content":"steer","urgent":false,"client_id":"f1"}"#
    );

    // Unfiltered cancel keeps the legacy shape; the filter is additive.
    let all: ClientFrame =
        serde_json::from_str(r#"{"v":1,"id":13,"req":"cancel_soft_interrupts","session_id":"s1"}"#)
            .unwrap();
    assert_eq!(
        all.request,
        ApiRequest::CancelSoftInterrupts {
            session_id: "s1".into(),
            client_ids: None
        }
    );
    let some = ClientFrame::new(
        14,
        ApiRequest::CancelSoftInterrupts {
            session_id: "s1".into(),
            client_ids: Some(vec!["f1".into()]),
        },
    );
    assert_eq!(
        serde_json::to_string(&some).unwrap(),
        r#"{"v":1,"id":14,"req":"cancel_soft_interrupts","session_id":"s1","client_ids":["f1"]}"#
    );

    let injected = ServerFrame::event(ApiEvent::SoftInterruptInjected {
        session_id: "s1".into(),
        client_ids: vec!["f1".into(), "f2".into()],
        point: "D".into(),
        tools_skipped: None,
        display_role: None,
    });
    assert_eq!(
        serde_json::to_string(&injected).unwrap(),
        r#"{"v":1,"ev":"soft_interrupt_injected","session_id":"s1","client_ids":["f1","f2"],"point":"D"}"#
    );

    let cancelled = ServerFrame::reply(
        14,
        ApiEvent::SoftInterruptsCancelled {
            cancelled: vec!["f1".into()],
            not_queued: vec![],
        },
    );
    assert_eq!(
        serde_json::to_string(&cancelled).unwrap(),
        r#"{"v":1,"reply_to":14,"ev":"soft_interrupts_cancelled","cancelled":["f1"],"not_queued":[]}"#
    );

    let moved = ServerFrame::reply(
        15,
        ApiEvent::BackgroundToolResult {
            moved: true,
            tool_call_id: Some("call_1".into()),
            tool_name: Some("bash".into()),
        },
    );
    assert_eq!(
        serde_json::to_string(&moved).unwrap(),
        r#"{"v":1,"reply_to":15,"ev":"background_tool_result","moved":true,"tool_call_id":"call_1","tool_name":"bash"}"#
    );

    // A turn with nothing left queued keeps the legacy `turn_done` shape.
    let done = ServerFrame::event(ApiEvent::TurnDone {
        session_id: "s1".into(),
        pending_soft_interrupts: None,
    });
    assert_eq!(
        serde_json::to_string(&done).unwrap(),
        r#"{"v":1,"ev":"turn_done","session_id":"s1"}"#
    );
}

#[test]
fn server_frame_wire_shape() {
    let frame = ServerFrame::reply(
        3,
        ApiEvent::HelloOk {
            version: 1,
            server: "rayu/0.55.1".into(),
            capabilities: vec![],
        },
    );
    let json = serde_json::to_string(&frame).unwrap();
    assert_eq!(
        json,
        r#"{"v":1,"reply_to":3,"ev":"hello_ok","version":1,"server":"rayu/0.55.1"}"#
    );
}

#[test]
fn unknown_event_kind_is_skippable() {
    let json = r#"{"v":1,"ev":"some_future_event","payload":123}"#;
    let frame: ServerFrame = serde_json::from_str(json).unwrap();
    assert_eq!(frame.event, ApiEvent::Unknown);
}

#[test]
fn unknown_fields_are_ignored() {
    let json = r#"{"v":1,"ev":"turn_done","session_id":"s1","future_field":true}"#;
    let frame: ServerFrame = serde_json::from_str(json).unwrap();
    assert_eq!(
        frame.event,
        ApiEvent::TurnDone {
            session_id: "s1".into(),
            pending_soft_interrupts: None,
        }
    );
}

#[test]
fn request_roundtrip() {
    let reqs = [
        ApiRequest::Hello {
            min_version: 1,
            max_version: 1,
            client: "test/0".into(),
            supports_user_response: false,
            supports_user_questions: false,
            supports_permissions: false,
        },
        ApiRequest::ListSessions {
            include_archived: false,
            limit: None,
            include_external: false,
            sources: None,
        },
        ApiRequest::ListExternalProjects {
            source: Some("codex_desktop".into()),
        },
        ApiRequest::ImportExternalSessions {
            items: vec![ImportExternalSessionItem {
                source: "codex".into(),
                external_session_id: "ext-1".into(),
                external_path: Some("/tmp/ext-1.jsonl".into()),
                working_dir: Some("/repo/app".into()),
            }],
            force_resync: false,
            fork_on_conflict: true,
        },
        ApiRequest::ArchiveSession {
            session_id: "s1".into(),
        },
        ApiRequest::RestoreSession {
            session_id: "s1".into(),
        },
        ApiRequest::SetRetentionPolicy {
            archive_after_days: Some(30),
        },
        ApiRequest::CreateSession {
            working_dir: None,
            system_prompt: None,
        },
        ApiRequest::AttachSession {
            session_id: "s1".into(),
        },
        ApiRequest::Cancel {
            session_id: "s1".into(),
        },
        ApiRequest::PermissionResponse {
            session_id: "s1".into(),
            request_id: "p1".into(),
            decision: PermissionDecision::Allow,
        },
        ApiRequest::SetPermissionMode {
            session_id: "s1".into(),
            mode: PermissionMode::AcceptEdits,
        },
        ApiRequest::GetRuntimeInfo {
            session_id: "s1".into(),
        },
        ApiRequest::SetApiKey {
            provider: "gemini".into(),
            api_key: "secret".into(),
        },
        ApiRequest::ClearApiKey {
            provider: "gemini".into(),
        },
        ApiRequest::ReadFile {
            session_id: "s1".into(),
            path: "src/lib.rs".into(),
            max_bytes: Some(1024),
        },
        ApiRequest::FindFiles {
            session_id: "s1".into(),
            query: "lib".into(),
            limit: Some(10),
        },
        ApiRequest::SearchText {
            session_id: "s1".into(),
            query: "needle".into(),
            path: Some("src".into()),
            limit: Some(10),
        },
        ApiRequest::FileStatus {
            session_id: "s1".into(),
            path: "src/lib.rs".into(),
        },
        ApiRequest::GetFileChanges {
            session_id: "s1".into(),
        },
        ApiRequest::GetFileChangeDiff {
            session_id: "s1".into(),
            path: "/repo/src/lib.rs".into(),
        },
        ApiRequest::FileChangeAction {
            session_id: "s1".into(),
            action: FileChangeActionKind::Undo,
            path: Some("/repo/src/lib.rs".into()),
            force: true,
        },
        ApiRequest::GetTodoState {
            session_id: "s1".into(),
        },
        ApiRequest::AckTodoFollowUp {
            session_id: "s1".into(),
            effects: rayucode_todo_policy::TodoEffects {
                clear_gate_observations: true,
                mark_long_session_review_delivered: false,
            },
        },
        ApiRequest::Ping,
    ];
    for req in reqs {
        let frame = ClientFrame::new(1, req);
        let json = serde_json::to_string(&frame).unwrap();
        let back: ClientFrame = serde_json::from_str(&json).unwrap();
        assert_eq!(frame, back);
    }
}

#[test]
fn client_handshake_over_in_memory_pipe() {
    // Server side scripted: one hello_ok line.
    let reply = serde_json::to_string(&ServerFrame::reply(
        1,
        ApiEvent::HelloOk {
            version: 1,
            server: "rayu/test".into(),
            capabilities: vec!["sessions".into()],
        },
    ))
    .unwrap()
        + "\n";
    let mut out: Vec<u8> = Vec::new();
    let mut client = HarnessClient::new(std::io::BufReader::new(reply.as_bytes()), &mut out);
    let frame = client.hello("test-client/0.1").unwrap();
    match frame.event {
        ApiEvent::HelloOk { version, .. } => assert_eq!(version, 1),
        other => panic!("unexpected event: {other:?}"),
    }
    let sent = String::from_utf8(out).unwrap();
    assert!(sent.contains(r#""req":"hello""#), "sent: {sent}");
}

// The questionnaire is opt-in and only exposed by the Rust SDK. Other
// protocol variants must still be mirrored and checked across both SDKs.
fn rust_sdk_only_frame(variant: &str) -> bool {
    matches!(
        variant,
        "question_response" | "question_request" | "question_closed"
    )
}

// PR 1 introduces the Rust v1.16 wire surface before PR 2 mirrors it into
// `sdk/typescript/src/protocol.ts`. Once the TypeScript SDK bumps to minor 16,
// this exemption automatically disables itself and enforces full parity.
fn pending_ts_sdk_v1_16_mirror(sdk: &str, variant: &str, field: Option<&str>) -> bool {
    if sdk.contains("API_VERSION_MINOR = 16") {
        return false;
    }
    matches!(
        (variant, field),
        (
            "get_capabilities"
                | "get_config"
                | "patch_config"
                | "capabilities"
                | "config_state"
                | "config_changed",
            _
        ) | ("text_done", Some("stop_reason"))
            | ("tool_done", Some("duration_ms"))
    )
}

/// The TypeScript SDK mirrors the shared enums by hand, so a variant added here
/// without a matching entry in `sdk/typescript/src/protocol.ts` silently
/// leaves every JS client unable to name the new frame. Checking from the
/// Rust side means the guard runs in the normal `cargo test` suite, where
/// the change is actually being made, rather than only in the SDK's own
/// Node tests which a Rust-only contributor never runs.
#[test]
fn typescript_sdk_lists_every_variant() {
    let Some(sdk) = sdk_protocol_source() else {
        // Absent in vendored/packaged builds: nothing to check.
        return;
    };
    for (file, enum_name) in [("requests.rs", "ApiRequest"), ("events.rs", "ApiEvent")] {
        for variant in enum_variants(file, enum_name) {
            if rust_sdk_only_frame(&variant) || pending_ts_sdk_v1_16_mirror(&sdk, &variant, None) {
                continue;
            }
            assert!(
                sdk.contains(&format!("\"{variant}\"")),
                "{enum_name}::{variant} is missing from sdk/typescript/src/protocol.ts; \
                 add it to the union and to KNOWN_*_KINDS"
            );
        }
    }
}

fn sdk_protocol_source() -> Option<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../sdk/typescript/src/protocol.ts");
    std::fs::read_to_string(path).ok()
}

/// Tag parity is not enough: a variant can keep its name and gain a field,
/// and every JS client would then be unable to read the new data while all
/// existing tests stay green. Renaming a field is worse, because the SDK
/// keeps compiling against a name the wire no longer carries. Check the
/// payload shape too, from the same side the change is made on.
#[test]
fn typescript_sdk_lists_every_field() {
    let Some(sdk) = sdk_protocol_source() else {
        return;
    };
    for (file, enum_name, tag) in [
        ("requests.rs", "ApiRequest", "req"),
        ("events.rs", "ApiEvent", "ev"),
    ] {
        for (variant, fields) in enum_variant_fields(file, enum_name) {
            if rust_sdk_only_frame(&variant) || pending_ts_sdk_v1_16_mirror(&sdk, &variant, None) {
                continue;
            }
            let Some(block) = sdk_variant_block(&sdk, tag, &variant) else {
                panic!(
                    "{enum_name}::{variant} has no `{tag}: \"{variant}\"` member in \
                     sdk/typescript/src/protocol.ts"
                );
            };
            for field in fields {
                if variant == "hello" && field == "supports_user_questions" {
                    continue;
                }
                if pending_ts_sdk_v1_16_mirror(&sdk, &variant, Some(&field)) {
                    continue;
                }
                assert!(
                    block.contains(&format!("{field}:")) || block.contains(&format!("{field}?:")),
                    "{enum_name}::{variant}.{field} is missing from its TypeScript member \
                     in sdk/typescript/src/protocol.ts:\n{block}"
                );
            }
        }
    }
}

/// The `{ ev: "tag"; ... }` object literal for one variant, braces balanced.
fn sdk_variant_block(sdk: &str, tag: &str, variant: &str) -> Option<String> {
    let needle = format!("{tag}: \"{variant}\"");
    let hit = sdk.find(&needle)?;
    let open = sdk[..hit].rfind('{')?;
    let mut depth = 0usize;
    for (offset, ch) in sdk[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(sdk[open..open + offset + 1].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// Snake-cased variant names paired with their serialized field names.
fn enum_variant_fields(file: &str, enum_name: &str) -> Vec<(String, Vec<String>)> {
    let body = enum_body(file, enum_name);
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for line in body.lines() {
        let Some(rest) = line.strip_prefix("    ") else {
            continue;
        };
        if rest.starts_with(' ') {
            // A field line inside the variant currently being collected.
            if let Some((_, fields)) = out.last_mut()
                && let Some(name) = field_name(rest)
            {
                fields.push(name);
            }
            continue;
        }
        let name: String = rest
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric())
            .collect();
        let Some(first) = name.chars().next() else {
            continue;
        };
        if !first.is_ascii_uppercase() || name == "Unknown" {
            continue;
        }
        // Single-line variants carry their fields inline: `Foo { a: T, b: U },`.
        let inline = rest
            .split_once('{')
            .and_then(|(_, tail)| tail.rsplit_once('}'))
            .map(|(inner, _)| {
                inner
                    .split(',')
                    .filter_map(|part| field_name(part.trim()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        out.push((snake_case(&name), inline));
    }
    out
}

/// `name` from a `name: Type` field line, skipping attributes and comments.
fn field_name(line: &str) -> Option<String> {
    let line = line.trim();
    if line.starts_with('#') || line.starts_with("//") || line.is_empty() {
        return None;
    }
    let (name, _) = line.split_once(':')?;
    let name = name.trim();
    if name.is_empty()
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return None;
    }
    Some(name.to_string())
}

fn enum_body(file: &str, enum_name: &str) -> String {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join(file),
    )
    .expect("read API source");
    let start = source
        .find(&format!("pub enum {enum_name} {{"))
        .expect("enum present");
    let body = &source[start..];
    let end = body.find("\n}").unwrap_or(body.len());
    body[..end].to_string()
}

/// Snake-cased variant names of `enum_name`, excluding the `Unknown` catch-all.
fn enum_variants(file: &str, enum_name: &str) -> Vec<String> {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join(file),
    )
    .expect("read API source");
    let start = source
        .find(&format!("pub enum {enum_name} {{"))
        .expect("enum present");
    let body = &source[start..];
    let end = body.find("\n}").unwrap_or(body.len());
    body[..end]
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("    ")?;
            if rest.starts_with(' ') {
                return None;
            }
            let name: String = rest
                .chars()
                .take_while(|ch| ch.is_ascii_alphanumeric())
                .collect();
            let mut chars = name.chars();
            let first = chars.next()?;
            if !first.is_ascii_uppercase() || name == "Unknown" {
                return None;
            }
            Some(snake_case(&name))
        })
        .collect()
}

fn snake_case(name: &str) -> String {
    let mut out = String::new();
    for (index, ch) in name.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if index > 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

#[test]
fn session_recovery_wire_shape_roundtrips_optional_notice() {
    for reconnect_notice in [None, Some("reconnected".into())] {
        let frame = ServerFrame::event(ApiEvent::SessionRecovery {
            session_id: "s1".into(),
            continuation_message: "continue task".into(),
            reconnect_notice: reconnect_notice.clone(),
        });
        let wire = serde_json::to_value(&frame).unwrap();
        assert_eq!(wire["ev"], "session_recovery");
        assert_eq!(wire["session_id"], "s1");
        assert_eq!(wire["continuation_message"], "continue task");
        assert_eq!(
            wire.get("reconnect_notice").is_some(),
            reconnect_notice.is_some()
        );
        assert!(wire.get("reply_to").is_none());
        assert_eq!(serde_json::from_value::<ServerFrame>(wire).unwrap(), frame);
    }
}

#[test]
fn hidden_system_reminder_wire_shape_and_legacy_default() {
    let frame = ClientFrame::new(
        12,
        ApiRequest::SendMessage {
            session_id: "s1".into(),
            content: String::new(),
            system_reminder: Some("continue task".into()),
            images: vec![],
            no_reply: false,
        },
    );
    let wire = serde_json::to_value(&frame).unwrap();
    assert_eq!(wire["content"], "");
    assert_eq!(wire["system_reminder"], "continue task");
    assert!(wire.get("no_reply").is_none());
    assert_eq!(serde_json::from_value::<ClientFrame>(wire).unwrap(), frame);
    let legacy: ClientFrame = serde_json::from_str(
        r#"{"v":1,"id":13,"req":"send_message","session_id":"s1","content":"hello"}"#,
    )
    .unwrap();
    assert!(matches!(
        legacy.request,
        ApiRequest::SendMessage {
            system_reminder: None,
            ..
        }
    ));
}

#[test]
fn side_panel_state_shared_types_roundtrip() {
    let snapshot = SidePanelSnapshot {
        focus_revision: 0,
        focused_page_id: Some("notes".into()),
        pages: vec![SidePanelPage {
            id: "notes".into(),
            title: "Notes".into(),
            file_path: "/notes.md".into(),
            content: "# Hello\n```mermaid\ngraph LR; A-->B\n```".into(),
            source: SidePanelPageSource::LinkedFile,
            updated_at_ms: 42,
            ..Default::default()
        }],
    };
    let mut pdf_snapshot = snapshot.clone();
    pdf_snapshot.focus_revision = 123;
    pdf_snapshot.pages[0].format = rayucode_side_panel_types::SidePanelPageFormat::Pdf;
    pdf_snapshot.pages[0].pdf_data = Some("JVBERi0xLjQKJSVFT0Y=".into());
    pdf_snapshot.pages[0].content = "PDF document fallback".into();
    for snapshot in [snapshot, pdf_snapshot, SidePanelSnapshot::default()] {
        let frame = ServerFrame::event(ApiEvent::SidePanelState {
            session_id: "s1".into(),
            snapshot,
        });
        let wire = serde_json::to_value(&frame).unwrap();
        assert_eq!(wire["ev"], "side_panel_state");
        assert_eq!(wire["session_id"], "s1");
        assert_eq!(serde_json::from_value::<ServerFrame>(wire).unwrap(), frame);
    }
}

#[test]
fn text_framing_is_additive_and_accepts_unframed_legacy_deltas() {
    let old = r#"{"v":1,"ev":"text_delta","session_id":"s1","text":"hello"}"#;
    let frame: ServerFrame = serde_json::from_str(old).unwrap();
    assert!(matches!(
        frame.event,
        ApiEvent::TextDelta {
            message_id: None,
            ..
        }
    ));
    assert_eq!(serde_json::to_string(&frame).unwrap(), old);
    for event in [
        ApiEvent::TextDelta {
            session_id: "s1".into(),
            text: "hi".into(),
            message_id: Some("m1".into()),
        },
        ApiEvent::TextDone {
            session_id: "s1".into(),
            message_id: Some("m1".into()),
            stop_reason: None,
        },
        ApiEvent::TextReplace {
            session_id: "s1".into(),
            text: "".into(),
            message_id: Some("m1".into()),
        },
    ] {
        let frame = ServerFrame::event(event);
        let wire = serde_json::to_value(&frame).unwrap();
        assert_eq!(wire["message_id"], "m1");
        assert_eq!(
            serde_json::from_value::<ServerFrame>(wire).unwrap().event,
            frame.event
        );
    }
}

#[test]
fn session_tool_control_wire_shapes_and_defaults() {
    use serde_json::json;
    for tools in [
        json!({}),
        json!({"enabled":null}),
        json!({"enabled":[]}),
        json!({"enabled":["read"],"disabled":["bash"],"custom":[{"name":"lookup","description":"Look up","parameters":{"type":"object"}}]}),
    ] {
        let wire = json!({"v":1,"id":1,"req":"configure_tools","session_id":"s1","tools":tools});
        let frame: ClientFrame = serde_json::from_value(wire).unwrap();
        let ApiRequest::ConfigureTools { tools: config, .. } = &frame.request else {
            panic!()
        };
        assert_eq!(
            config.enabled,
            tools
                .get("enabled")
                .filter(|v| !v.is_null())
                .map(|v| serde_json::from_value(v.clone()).unwrap())
        );
        assert_eq!(
            serde_json::from_value::<ClientFrame>(serde_json::to_value(&frame).unwrap()).unwrap(),
            frame
        );
    }
    for wire in [
        json!({"v":1,"id":2,"req":"list_tools","session_id":"s1"}),
        json!({"v":1,"id":3,"req":"tool_result","session_id":"s1","call_id":"c1","output":"ok"}),
        json!({"v":1,"id":4,"req":"tool_result","session_id":"s1","call_id":"c1","output":"","error":"failed"}),
    ] {
        let frame: ClientFrame = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(frame).unwrap(), wire);
    }
    for wire in [
        json!({"v":1,"reply_to":2,"ev":"tools","session_id":"s1","tools":[{"name":"read","description":"Read file","parameters":{"type":"object"}}]}),
        json!({"v":1,"ev":"tool_call","session_id":"s1","call_id":"c1","name":"lookup","input":{"key":1}}),
    ] {
        let frame: ServerFrame = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(frame).unwrap(), wire);
    }
    for parameters in [json!(null), json!([]), json!("object"), json!(42)] {
        assert!(
            serde_json::from_value::<SessionToolDefinition>(
                json!({"name":"bad","description":"bad","parameters":parameters})
            )
            .is_err()
        );
    }
    assert_eq!(
        serde_json::to_value(ToolConfiguration::default()).unwrap(),
        json!({})
    );
}

#[test]
fn turn_stopped_schema_and_future_reason_compatibility() {
    for reason in [
        "interrupted",
        "failure",
        "crash",
        "provider_guardrail",
        "limit_reached",
    ] {
        let wire = serde_json::json!({"v":1,"ev":"turn_stopped","session_id":"s1","reason":reason,"message":"Explanation"});
        let frame: ServerFrame = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(frame).unwrap(), wire);
    }
    let wire = serde_json::json!({"v":1,"ev":"turn_stopped","session_id":"s1","reason":"future_reason","message":"Explanation","provider_stop_reason":"refusal"});
    let frame: ServerFrame = serde_json::from_value(wire).unwrap();
    assert!(
        matches!(frame.event, ApiEvent::TurnStopped { reason: TurnStopReason::Unknown, provider_stop_reason: Some(reason), .. } if reason == "refusal")
    );
    let done: ServerFrame =
        serde_json::from_value(serde_json::json!({"v":1,"ev":"turn_done","session_id":"s1"}))
            .unwrap();
    assert!(matches!(done.event, ApiEvent::TurnDone { .. }));
}

#[test]
fn permission_mode_and_permission_frames_wire_shapes_and_aliases() {
    use serde_json::json;
    for (raw, expected, canonical) in [
        ("default", PermissionMode::Default, "default"),
        ("accept_edits", PermissionMode::AcceptEdits, "accept_edits"),
        ("acceptEdits", PermissionMode::AcceptEdits, "accept_edits"),
        ("plan", PermissionMode::Plan, "plan"),
        ("full_manage", PermissionMode::FullManage, "full_manage"),
        ("fullManage", PermissionMode::FullManage, "full_manage"),
        ("orchestrator", PermissionMode::Orchestrator, "orchestrator"),
    ] {
        let frame: ClientFrame = serde_json::from_value(json!({
            "v": 1, "id": 10, "req": "set_permission_mode", "session_id": "s1", "mode": raw
        }))
        .unwrap();
        assert_eq!(
            frame.request,
            ApiRequest::SetPermissionMode {
                session_id: "s1".into(),
                mode: expected,
            }
        );
        let wire = serde_json::to_value(&frame).unwrap();
        assert_eq!(wire["mode"], canonical);
    }

    // Legacy hello without supports_permissions defaults to false and omits it when false.
    let legacy_hello: ClientFrame = serde_json::from_value(json!({
        "v": 1, "id": 1, "req": "hello", "min_version": 1, "max_version": 1, "client": "legacy"
    }))
    .unwrap();
    assert!(matches!(
        legacy_hello.request,
        ApiRequest::Hello {
            supports_permissions: false,
            ..
        }
    ));
    let wire_legacy = serde_json::to_value(&legacy_hello).unwrap();
    assert!(wire_legacy.get("supports_permissions").is_none());

    let perm_hello = ClientFrame::new(
        2,
        ApiRequest::Hello {
            min_version: 1,
            max_version: 1,
            client: "desktop/1".into(),
            supports_user_response: false,
            supports_user_questions: false,
            supports_permissions: true,
        },
    );
    let wire_perm = serde_json::to_value(&perm_hello).unwrap();
    assert_eq!(wire_perm["supports_permissions"], true);
    assert_eq!(
        serde_json::from_value::<ClientFrame>(wire_perm).unwrap(),
        perm_hello
    );

    assert_eq!(API_VERSION_MINOR, 16);

    let event = ServerFrame::event(ApiEvent::PermissionRequest {
        session_id: "s1".into(),
        request_id: "perm_1".into(),
        tool_name: "bash".into(),
        description: "Run bash command".into(),
        risk_tier: None,
    });
    let wire = serde_json::to_value(&event).unwrap();
    assert_eq!(wire["ev"], "permission_request");
    assert!(wire.get("risk_tier").is_none());
    assert_eq!(
        serde_json::from_value::<ServerFrame>(wire).unwrap(),
        event
    );

    let event_with_risk = ServerFrame::event(ApiEvent::PermissionRequest {
        session_id: "s1".into(),
        request_id: "perm_2".into(),
        tool_name: "bash".into(),
        description: "Run rm -rf".into(),
        risk_tier: Some("confirm".into()),
    });
    let wire_risk = serde_json::to_value(&event_with_risk).unwrap();
    assert_eq!(wire_risk["risk_tier"], "confirm");
    assert_eq!(
        serde_json::from_value::<ServerFrame>(wire_risk).unwrap(),
        event_with_risk
    );

    let changed = ServerFrame::event(ApiEvent::PermissionModeChanged {
        session_id: "s1".into(),
        mode: PermissionMode::Plan,
    });
    let wire_changed = serde_json::to_value(&changed).unwrap();
    assert_eq!(wire_changed["ev"], "permission_mode_changed");
    assert_eq!(wire_changed["session_id"], "s1");
    assert_eq!(wire_changed["mode"], "plan");
    assert_eq!(
        serde_json::from_value::<ServerFrame>(wire_changed).unwrap(),
        changed
    );
}

#[test]
fn file_changes_wire_shapes_and_defaults() {
    use serde_json::json;

    // Minimal file_change_action omits optional path and defaults force to false.
    let minimal: ClientFrame = serde_json::from_value(json!({
        "v": 1,
        "id": 20,
        "req": "file_change_action",
        "session_id": "s1",
        "action": "keep_all"
    }))
    .unwrap();
    assert_eq!(
        minimal.request,
        ApiRequest::FileChangeAction {
            session_id: "s1".into(),
            action: FileChangeActionKind::KeepAll,
            path: None,
            force: false,
        }
    );
    let minimal_wire = serde_json::to_value(&minimal).unwrap();
    assert!(minimal_wire.get("path").is_none());
    assert_eq!(minimal_wire["force"], false);

    let hunk = FileChangeHunk {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 2,
        header: "@@ -1,1 +1,2 @@".into(),
        lines: vec!["-old".into(), "+new".into(), "+added".into()],
    };
    let snapshot = FileChangesSnapshot {
        session_id: "s1".into(),
        latest_turn_id: 2,
        total_pending_files: 1,
        total_additions: 2,
        total_deletions: 1,
        files: vec![FileChangeEntrySummary {
            path: "/repo/src/lib.rs".into(),
            display_path: "src/lib.rs".into(),
            old_path: None,
            kind: FileChangeKind::Modified,
            status: FileChangeStatus::Pending,
            additions: 2,
            deletions: 1,
            changed_in_latest_turn: true,
            turn_id: 2,
            edit_count: 1,
            is_binary: false,
            undoable: true,
            can_redo: false,
            preview_hunks: vec![hunk.clone()],
            preview_truncated: false,
            updated_at_ms: 1_700_000_000_000,
        }],
    };
    let state_frame = ServerFrame::event(ApiEvent::FileChangesState {
        session_id: "s1".into(),
        snapshot: snapshot.clone(),
    });
    let state_wire = serde_json::to_value(&state_frame).unwrap();
    assert_eq!(state_wire["ev"], "file_changes_state");
    assert_eq!(state_wire["session_id"], "s1");
    assert_eq!(
        serde_json::from_value::<ServerFrame>(state_wire).unwrap(),
        state_frame
    );

    let diff_frame = ServerFrame::reply(
        21,
        ApiEvent::FileChangeDiff {
            session_id: "s1".into(),
            diff: FileChangeDiffPayload {
                path: "/repo/src/lib.rs".into(),
                display_path: "src/lib.rs".into(),
                old_path: Some("/repo/src/old.rs".into()),
                kind: FileChangeKind::Renamed,
                status: FileChangeStatus::Pending,
                additions: 2,
                deletions: 1,
                is_binary: false,
                original_content: "old\n".into(),
                modified_content: "new\nadded\n".into(),
                unified_diff: "--- a/src/old.rs\n+++ b/src/lib.rs\n".into(),
                hunks: vec![hunk],
            },
        },
    );
    let diff_wire = serde_json::to_value(&diff_frame).unwrap();
    assert_eq!(diff_wire["ev"], "file_change_diff");
    assert_eq!(
        serde_json::from_value::<ServerFrame>(diff_wire).unwrap(),
        diff_frame
    );

    let action_frame = ServerFrame::reply(
        22,
        ApiEvent::FileChangeActionResult {
            session_id: "s1".into(),
            response: FileChangeActionResponse {
                ok: false,
                message: "1 conflict".into(),
                conflicts: vec![FileChangeConflict {
                    path: "/repo/src/lib.rs".into(),
                    display_path: "src/lib.rs".into(),
                    reason: "file modified outside AI session".into(),
                }],
                snapshot,
            },
        },
    );
    let action_wire = serde_json::to_value(&action_frame).unwrap();
    assert_eq!(action_wire["ev"], "file_change_action_result");
    assert_eq!(
        serde_json::from_value::<ServerFrame>(action_wire).unwrap(),
        action_frame
    );
}

#[test]
fn external_sessions_wire_shapes_and_legacy_defaults() {
    use serde_json::json;

    // Legacy ListSessions omits include_external/sources and defaults cleanly.
    let legacy_list: ClientFrame = serde_json::from_value(json!({
        "v": 1,
        "id": 30,
        "req": "list_sessions"
    }))
    .unwrap();
    assert_eq!(
        legacy_list.request,
        ApiRequest::ListSessions {
            include_archived: false,
            limit: None,
            include_external: false,
            sources: None,
        }
    );
    let legacy_wire = serde_json::to_value(&legacy_list).unwrap();
    assert!(legacy_wire.get("include_external").is_none());
    assert!(legacy_wire.get("sources").is_none());

    // Extended ListSessions roundtrips include_external + sources.
    let ext_list = ClientFrame::new(
        31,
        ApiRequest::ListSessions {
            include_archived: false,
            limit: Some(50),
            include_external: true,
            sources: Some(vec!["rayu".into(), "claude".into(), "codex".into()]),
        },
    );
    let ext_list_wire = serde_json::to_value(&ext_list).unwrap();
    assert_eq!(ext_list_wire["include_external"], true);
    assert_eq!(ext_list_wire["sources"], json!(["rayu", "claude", "codex"]));
    assert_eq!(
        serde_json::from_value::<ClientFrame>(ext_list_wire).unwrap(),
        ext_list
    );

    // Legacy SessionInfo omits all external fields and deserializes with defaults.
    let legacy_session: SessionInfo =
        serde_json::from_value(json!({"session_id": "s1", "status": "idle"})).unwrap();
    assert_eq!(legacy_session.source, None);
    assert_eq!(legacy_session.external_session_id, None);
    assert_eq!(legacy_session.external_path, None);
    assert_eq!(legacy_session.external_project_name, None);
    assert!(!legacy_session.imported);
    assert!(!legacy_session.sync_stale);
    let legacy_session_wire = serde_json::to_value(&legacy_session).unwrap();
    for field in [
        "source",
        "external_session_id",
        "external_path",
        "external_project_name",
        "imported",
        "sync_stale",
    ] {
        assert!(legacy_session_wire.get(field).is_none(), "{field} omitted");
    }

    // ExternalProjects and ExternalSessionsImported roundtrip.
    let imported_session = SessionInfo {
        source: Some("codex_desktop".into()),
        external_session_id: Some("codex-1".into()),
        external_path: Some("/tmp/codex-1.jsonl".into()),
        external_project_name: Some("rayucode".into()),
        imported: true,
        sync_stale: true,
        ..legacy_session
    };
    let projects_frame = ServerFrame::reply(
        32,
        ApiEvent::ExternalProjects {
            projects: vec![ExternalProjectInfo {
                id: "codex_desktop:/repo/rayucode".into(),
                source: "codex_desktop".into(),
                name: "rayucode".into(),
                working_dir: Some("/repo/rayucode".into()),
                session_count: 1,
                updated_at_ms: Some(1_700_000_000_000),
                sessions: vec![imported_session.clone()],
            }],
        },
    );
    let projects_wire = serde_json::to_value(&projects_frame).unwrap();
    assert_eq!(projects_wire["ev"], "external_projects");
    assert_eq!(
        serde_json::from_value::<ServerFrame>(projects_wire).unwrap(),
        projects_frame
    );

    let imported_frame = ServerFrame::reply(
        33,
        ApiEvent::ExternalSessionsImported {
            sessions: vec![imported_session],
            skipped: vec![ImportSkipInfo {
                source: "claude_code".into(),
                external_session_id: "cc-1".into(),
                reason: "conflict".into(),
                existing_session_id: Some("imported_cc_cc-1".into()),
                message: "local turns exist".into(),
            }],
        },
    );
    let imported_wire = serde_json::to_value(&imported_frame).unwrap();
    assert_eq!(imported_wire["ev"], "external_sessions_imported");
    assert_eq!(
        serde_json::from_value::<ServerFrame>(imported_wire).unwrap(),
        imported_frame
    );
}

#[test]
fn v1_16_capabilities_config_and_frame_fidelity_round_trip() {
    assert_eq!(API_VERSION_MAJOR, 1);
    assert_eq!(API_VERSION_MINOR, 16);
    assert_eq!(CAPABILITIES_CAPABILITY, "capabilities_v1");
    assert_eq!(CONFIG_CAPABILITY, "config_v1");
    assert_eq!(FRAME_FIDELITY_CAPABILITY, "frame_fidelity_v1");

    // GetCapabilities + Capabilities round-trip
    let req = ClientFrame::new(
        1,
        ApiRequest::GetCapabilities {
            session_id: Some("sess_1".into()),
        },
    );
    let raw = serde_json::to_string(&req).unwrap();
    assert!(raw.contains(r#""req":"get_capabilities""#));
    assert_eq!(serde_json::from_str::<ClientFrame>(&raw).unwrap(), req);

    let caps_reply = ServerFrame::reply(
        1,
        ApiEvent::Capabilities {
            commands: vec![CommandDescriptor {
                name: "compact".into(),
                description: "Compact conversation history".into(),
                category: CommandCategory::Session,
                arg_hint: None,
                requires_session: true,
                dispatch: CommandDispatch::ApiRequest {
                    req: "compact".into(),
                },
            }],
            permission_modes: vec![PermissionModeDescriptor {
                id: "default".into(),
                label: "Default".into(),
                description: "Prompt before mutating actions".into(),
                is_default: true,
            }],
            features: vec![FeatureFlagDescriptor {
                key: "features.memory".into(),
                enabled: true,
                description: "Enable memory retrieval".into(),
                requires_restart: false,
            }],
        },
    );
    let raw_caps = serde_json::to_string(&caps_reply).unwrap();
    assert!(raw_caps.contains(r#""ev":"capabilities""#));
    assert_eq!(
        serde_json::from_str::<ServerFrame>(&raw_caps).unwrap(),
        caps_reply
    );

    // GetConfig / PatchConfig / ConfigState / ConfigChanged round-trip
    let get_cfg = ClientFrame::new(
        2,
        ApiRequest::GetConfig {
            sections: Some(vec!["display".into(), "compaction".into()]),
        },
    );
    let raw_get_cfg = serde_json::to_string(&get_cfg).unwrap();
    assert!(raw_get_cfg.contains(r#""req":"get_config""#));
    assert_eq!(
        serde_json::from_str::<ClientFrame>(&raw_get_cfg).unwrap(),
        get_cfg
    );

    let mut patch = serde_json::Map::new();
    patch.insert("display.emoji".into(), serde_json::json!(false));
    let patch_cfg = ClientFrame::new(3, ApiRequest::PatchConfig { patch: patch.clone() });
    let raw_patch = serde_json::to_string(&patch_cfg).unwrap();
    assert!(raw_patch.contains(r#""req":"patch_config""#));
    assert_eq!(
        serde_json::from_str::<ClientFrame>(&raw_patch).unwrap(),
        patch_cfg
    );

    let cfg_state = ServerFrame::reply(
        2,
        ApiEvent::ConfigState {
            path: "/home/user/.rayu/config.toml".into(),
            sections: vec!["display".into()],
            values: patch.clone(),
            schema: vec![ConfigFieldSchema {
                key: "display.emoji".into(),
                section: "display".into(),
                label: "Emoji".into(),
                description: "Render emoji in terminal output".into(),
                kind: ConfigFieldKind::Boolean,
                options: None,
                default_value: serde_json::json!(true),
                apply_mode: ConfigApplyMode::Immediate,
            }],
        },
    );
    let raw_cfg_state = serde_json::to_string(&cfg_state).unwrap();
    assert!(raw_cfg_state.contains(r#""ev":"config_state""#));
    assert_eq!(
        serde_json::from_str::<ServerFrame>(&raw_cfg_state).unwrap(),
        cfg_state
    );

    let cfg_changed = ServerFrame::event(ApiEvent::ConfigChanged {
        changed_keys: vec!["display.emoji".into()],
        requires_restart: false,
        values: patch,
    });
    let raw_cfg_changed = serde_json::to_string(&cfg_changed).unwrap();
    assert!(raw_cfg_changed.contains(r#""ev":"config_changed""#));
    assert_eq!(
        serde_json::from_str::<ServerFrame>(&raw_cfg_changed).unwrap(),
        cfg_changed
    );

    // Frame fidelity: seq, turn_id, TextDone.stop_reason, ToolDone.duration_ms
    let frame = ServerFrame::event(ApiEvent::TextDone {
        session_id: "sess_1".into(),
        message_id: Some("m1".into()),
        stop_reason: Some("end_turn".into()),
    })
    .with_turn_meta(Some(42), Some("turn_7".into()));
    let raw_frame = serde_json::to_string(&frame).unwrap();
    assert!(raw_frame.contains(r#""seq":42"#));
    assert!(raw_frame.contains(r#""turn_id":"turn_7""#));
    assert!(raw_frame.contains(r#""stop_reason":"end_turn""#));
    assert_eq!(
        serde_json::from_str::<ServerFrame>(&raw_frame).unwrap(),
        frame
    );

    let tool_done = ServerFrame::event(ApiEvent::ToolDone {
        session_id: "sess_1".into(),
        call_id: "c1".into(),
        name: "bash".into(),
        output: "ok".into(),
        error: None,
        duration_ms: Some(125),
    });
    let raw_tool = serde_json::to_string(&tool_done).unwrap();
    assert!(raw_tool.contains(r#""duration_ms":125"#));
    assert_eq!(
        serde_json::from_str::<ServerFrame>(&raw_tool).unwrap(),
        tool_done
    );

    // HistoryMessage provenance + legacy compatibility
    let msg = HistoryMessage {
        response_stats: None,
        role: "system".into(),
        content: "Reassess request".into(),
        tool: None,
        origin: Some(MessageOrigin::EngineInternal),
        visibility: Some(MessageVisibility::Hidden),
    };
    let raw_msg = serde_json::to_string(&msg).unwrap();
    assert!(raw_msg.contains(r#""origin":"engine_internal""#));
    assert!(raw_msg.contains(r#""visibility":"hidden""#));
    assert_eq!(
        serde_json::from_str::<HistoryMessage>(&raw_msg).unwrap(),
        msg
    );

    // ModelRouteInfo extensions + legacy compatibility
    let route = ModelRouteInfo {
        model: "claude-opus-4-7".into(),
        provider: "anthropic".into(),
        api_method: "messages".into(),
        available: true,
        detail: "ready".into(),
        usage: None,
        supported_efforts: vec![
            "none".into(),
            "low".into(),
            "medium".into(),
            "high".into(),
            "xhigh".into(),
            "max".into(),
        ],
        default_effort: Some("medium".into()),
        context_window: Some(200_000),
    };
    let raw_route = serde_json::to_string(&route).unwrap();
    assert!(raw_route.contains(r#""supported_efforts""#));
    assert!(raw_route.contains(r#""default_effort":"medium""#));
    assert!(raw_route.contains(r#""context_window":200000"#));
    assert_eq!(
        serde_json::from_str::<ModelRouteInfo>(&raw_route).unwrap(),
        route
    );
    let legacy_route: ModelRouteInfo = serde_json::from_value(serde_json::json!({
        "model": "m",
        "provider": "p",
        "api_method": "a",
        "available": true,
        "detail": "ok"
    }))
    .unwrap();
    assert!(legacy_route.supported_efforts.is_empty());
    assert_eq!(legacy_route.default_effort, None);
    assert_eq!(legacy_route.context_window, None);

    // ErrorCode::Busy and ErrorCode::Unsupported
    let busy = ApiEvent::Error {
        code: ErrorCode::Busy,
        message: "turn in progress".into(),
    };
    assert!(
        serde_json::to_string(&busy)
            .unwrap()
            .contains(r#""code":"busy""#)
    );
    let unsupported = ApiEvent::Error {
        code: ErrorCode::Unsupported,
        message: "effort unsupported".into(),
    };
    assert!(
        serde_json::to_string(&unsupported)
            .unwrap()
            .contains(r#""code":"unsupported""#)
    );
}
