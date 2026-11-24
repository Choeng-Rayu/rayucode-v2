#[test]
fn provider_oauth_account_label_defaults_and_roundtrips() -> Result<()> {
    for legacy in [
        r#"{"type":"history","id":1,"session_id":"test","messages":[]}"#,
        r#"{"type":"model_changed","id":1,"model":"test"}"#,
    ] {
        for label in [None, Some("work"), Some("personal-α")] {
            let mut value: serde_json::Value = serde_json::from_str(legacy)?;
            if let Some(label) = label {
                value["provider_oauth_account_label"] = label.into();
            }
            let event = parse_event_json(&value.to_string())?;
            let actual = match &event {
                ServerEvent::History {
                    provider_oauth_account_label,
                    ..
                }
                | ServerEvent::ModelChanged {
                    provider_oauth_account_label,
                    ..
                } => provider_oauth_account_label.as_deref(),
                _ => return Err(anyhow!("wrong event type")),
            };
            assert_eq!(actual, label);
            let wire = encode_event(&event);
            let encoded: serde_json::Value = serde_json::from_str(wire.trim())?;
            assert_eq!(
                encoded["provider_oauth_account_label"],
                serde_json::json!(label)
            );
            let decoded = parse_event_json(wire.trim())?;
            match decoded {
                ServerEvent::History {
                    provider_oauth_account_label,
                    ..
                }
                | ServerEvent::ModelChanged {
                    provider_oauth_account_label,
                    ..
                } => {
                    assert_eq!(provider_oauth_account_label.as_deref(), label);
                }
                _ => return Err(anyhow!("wrong event type")),
            }
        }
    }
    Ok(())
}

/// The server resolves the real window and reports it here. A remote client
/// cannot derive it itself: its provider is an inert placeholder with no model
/// catalog, and the static resolver has no entry for a model it does not
/// recognise, so without this field the panel shows the generic default.
#[test]
fn test_model_changed_roundtrip_carries_context_window() -> Result<()> {
    let event = ServerEvent::ModelChanged {
        id: 7,
        model: "auto/included".to_string(),
        provider_name: Some("OmniRouteV2".to_string()),
        context_window: Some(1_310_720),
        error: None,
        resolved_credential: None,
        provider_oauth_email: None,
        provider_oauth_account_label: None,
        reasoning_effort: None,
    };
    let json = encode_event(&event);
    assert!(
        json.contains("\"context_window\":1310720"),
        "window must reach the wire: {json}"
    );
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::ModelChanged { context_window, .. } = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(context_window, Some(1_310_720));
    Ok(())
}

/// An older server omits the field. It must not appear on the wire, and the
/// client must read it as unknown rather than as a number, so a missing value can
/// never be mistaken for a real one.
#[test]
fn test_model_changed_without_context_window_stays_absent() -> Result<()> {
    let event = ServerEvent::ModelChanged {
        id: 3,
        model: "m".to_string(),
        provider_name: None,
        context_window: None,
        error: None,
        resolved_credential: None,
        provider_oauth_email: None,
        provider_oauth_account_label: None,
        reasoning_effort: None,
    };
    let json = encode_event(&event);
    assert!(!json.contains("provider_oauth_email"));
    assert!(
        !json.contains("context_window"),
        "unknown window must be omitted, not sent as null: {json}"
    );
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::ModelChanged { context_window, .. } = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(context_window, None);
    Ok(())
}

#[test]
fn test_model_changed_oauth_identity_legacy_and_redaction() -> Result<()> {
    let legacy = parse_event_json(r#"{"type":"model_changed","id":0,"model":"test"}"#)?;
    assert!(!encode_event(&legacy).contains("provider_oauth_email"));
    let event = parse_event_json(
        r#"{"type":"model_changed","id":0,"model":"test","provider_oauth_email":"effective@example.test"}"#,
    )?;
    assert!(!format!("{event:?}").contains("effective@example.test"));
    let ServerEvent::ModelChanged {
        provider_oauth_email: Some(email),
        ..
    } = parse_event_json(encode_event(&event).trim())?
    else {
        return Err(anyhow!("identity missing"));
    };
    assert_eq!(email.as_str(), "effective@example.test");
    Ok(())
}

#[test]
fn test_request_roundtrip() -> Result<()> {
    let req = Request::Message {
        id: 1,
        content: "hello".to_string(),
        images: vec![],
        system_reminder: None,
        active_skill: Some("verification".to_string()),
        no_reply: false,
    };
    let json = serde_json::to_string(&req)?;
    let decoded = parse_request_json(&json)?;
    assert_eq!(decoded.id(), 1);
    Ok(())
}

#[test]
fn test_soft_interrupt_images_roundtrip_and_legacy_default() -> Result<()> {
    let req = Request::SoftInterrupt {
        id: 2,
        content: "look at this".to_string(),
        images: vec![("image/png".to_string(), "ZmFrZQ==".to_string())],
        urgent: true,
        client_id: None,
    };
    let json = serde_json::to_string(&req)?;
    let decoded = parse_request_json(&json)?;
    let Request::SoftInterrupt {
        content,
        images,
        urgent,
        ..
    } = decoded
    else {
        return Err(anyhow!("wrong request type"));
    };
    assert_eq!(content, "look at this");
    assert_eq!(
        images,
        vec![("image/png".to_string(), "ZmFrZQ==".to_string())]
    );
    assert!(urgent);

    let legacy = r#"{"type":"soft_interrupt","id":3,"content":"legacy","urgent":false}"#;
    let decoded = parse_request_json(legacy)?;
    let Request::SoftInterrupt { images, .. } = decoded else {
        return Err(anyhow!("wrong legacy request type"));
    };
    assert!(images.is_empty());
    Ok(())
}

#[test]
fn test_soft_interrupt_ids_wire_shape_and_legacy_defaults() -> Result<()> {
    let req = Request::SoftInterrupt {
        id: 4,
        content: "steer".to_string(),
        images: Vec::new(),
        urgent: false,
        client_id: Some("f1".to_string()),
    };
    assert_eq!(
        serde_json::to_string(&req)?,
        r#"{"type":"soft_interrupt","id":4,"content":"steer","urgent":false,"client_id":"f1"}"#
    );
    let legacy = parse_request_json(r#"{"type":"soft_interrupt","id":5,"content":"x"}"#)?;
    assert!(matches!(
        legacy,
        Request::SoftInterrupt {
            client_id: None,
            ..
        }
    ));

    let cancel_all = parse_request_json(r#"{"type":"cancel_soft_interrupts","id":6}"#)?;
    assert!(matches!(
        cancel_all,
        Request::CancelSoftInterrupts {
            client_ids: None,
            ..
        }
    ));
    let cancel_some = Request::CancelSoftInterrupts {
        id: 7,
        client_ids: Some(vec!["f1".to_string()]),
    };
    assert_eq!(
        serde_json::to_string(&cancel_some)?,
        r#"{"type":"cancel_soft_interrupts","id":7,"client_ids":["f1"]}"#
    );

    // An injection without ids keeps the pre-#1778 wire shape exactly.
    let injected = ServerEvent::SoftInterruptInjected {
        content: "a".to_string(),
        display_role: None,
        point: "D".to_string(),
        tools_skipped: None,
        client_ids: Vec::new(),
    };
    assert_eq!(
        serde_json::to_string(&injected)?,
        r#"{"type":"soft_interrupt_injected","content":"a","point":"D"}"#
    );
    let with_ids: ServerEvent = serde_json::from_str(
        r#"{"type":"soft_interrupt_injected","content":"a","point":"B","client_ids":["f1","f2"]}"#,
    )?;
    assert!(matches!(
        with_ids,
        ServerEvent::SoftInterruptInjected { client_ids, .. } if client_ids == ["f1", "f2"]
    ));
    Ok(())
}

#[test]
fn test_compacted_history_request_roundtrip() -> Result<()> {
    let req = Request::GetCompactedHistory {
        id: 7,
        recent_history: false,
        visible_messages: 64,
    };
    let json = serde_json::to_string(&req)?;
    assert!(json.contains("\"type\":\"get_compacted_history\""));
    let decoded = parse_request_json(&json)?;
    assert_eq!(decoded.id(), 7);
    let Request::GetCompactedHistory {
        visible_messages, ..
    } = decoded
    else {
        return Err(anyhow!("wrong request type"));
    };
    assert_eq!(visible_messages, 64);
    Ok(())
}

#[test]
fn recent_history_schema_is_opt_in_and_legacy_compatible() -> Result<()> {
    let legacy: crate::HistoryBase = serde_json::from_str(r#"{"count":0,"fingerprint":0}"#)?;
    assert_eq!(legacy.recent_messages, None);
    assert!(!serde_json::to_string(&legacy)?.contains("recent_messages"));
    let recent = crate::HistoryBase::recent(128);
    assert_eq!(recent.count, 0);
    assert_eq!(recent.fingerprint, 0);
    assert_eq!(recent.images_fingerprint, None);
    let decoded: crate::HistoryBase = serde_json::from_str(&serde_json::to_string(&recent)?)?;
    assert_eq!(decoded.recent_messages, Some(128));
    let legacy =
        parse_request_json(r#"{"type":"get_compacted_history","id":1,"visible_messages":64}"#)?;
    assert!(matches!(
        legacy,
        Request::GetCompactedHistory {
            recent_history: false,
            ..
        }
    ));
    let recent = parse_request_json(
        r#"{"type":"get_compacted_history","id":1,"visible_messages":192,"recent_history":true}"#,
    )?;
    assert!(matches!(
        recent,
        Request::GetCompactedHistory {
            recent_history: true,
            visible_messages: 192,
            ..
        }
    ));
    Ok(())
}

#[test]
fn test_notify_auth_changed_provider_hint_is_optional() -> Result<()> {
    let legacy = r#"{"type":"notify_auth_changed","id":9}"#;
    let decoded = parse_request_json(legacy)?;
    let Request::NotifyAuthChanged {
        id,
        provider,
        auth,
        prefer_strongest,
    } = decoded
    else {
        return Err(anyhow!("wrong request type"));
    };
    assert_eq!(id, 9);
    assert_eq!(provider, None);
    assert_eq!(auth, None);
    assert!(!prefer_strongest);

    let req = Request::NotifyAuthChanged {
        id: 10,
        provider: Some("azure-openai".to_string()),
        auth: None,
        prefer_strongest: true,
    };
    let json = serde_json::to_string(&req)?;
    assert!(json.contains("\"provider\":\"azure-openai\""));
    assert!(json.contains("\"prefer_strongest\":true"));
    let decoded = parse_request_json(&json)?;
    let Request::NotifyAuthChanged {
        id,
        provider,
        auth,
        prefer_strongest,
    } = decoded
    else {
        return Err(anyhow!("wrong request type"));
    };
    assert_eq!(id, 10);
    assert_eq!(provider.as_deref(), Some("azure-openai"));
    assert_eq!(auth, None);
    assert!(prefer_strongest);
    Ok(())
}

#[test]
fn test_invalidate_openai_usage_roundtrip_pins_account_scope() -> Result<()> {
    for account_label in [None, Some("reset-target".to_string())] {
        let request = Request::InvalidateOpenAiUsage {
            id: 41,
            account_label: account_label.clone(),
        };
        let json = serde_json::to_string(&request)?;
        assert!(json.contains("\"type\":\"invalidate_openai_usage\""));
        let decoded = parse_request_json(&json)?;
        assert_eq!(decoded.id(), 41);
        let Request::InvalidateOpenAiUsage {
            account_label: decoded_label,
            ..
        } = decoded
        else {
            return Err(anyhow!("wrong request type"));
        };
        assert_eq!(decoded_label, account_label);
    }
    Ok(())
}

#[test]
fn test_notify_auth_changed_typed_auth_payload_roundtrip() -> Result<()> {
    let req = Request::NotifyAuthChanged {
        id: 11,
        provider: Some("cerebras".to_string()),
        auth: Some(AuthChanged {
            provider: AuthProviderId::new("cerebras"),
            credential_source: Some(AuthCredentialSource::ApiKeyFile),
            auth_method: Some(AuthMethod::RemoteTuiPasteApiKey),
            expected_runtime: Some(RuntimeProviderKey::new("openai-compatible")),
            expected_catalog_namespace: Some(CatalogNamespace::new("cerebras")),
        }),
        prefer_strongest: false,
    };
    let json = serde_json::to_string(&req)?;
    assert!(json.contains("\"provider\":\"cerebras\""));
    assert!(json.contains("\"auth_method\":\"remote_tui_paste_api_key\""));
    assert!(json.contains("\"expected_runtime\":\"openai-compatible\""));
    assert!(json.contains("\"expected_catalog_namespace\":\"cerebras\""));

    let decoded = parse_request_json(&json)?;
    let Request::NotifyAuthChanged {
        id,
        provider,
        auth,
        prefer_strongest,
    } = decoded
    else {
        return Err(anyhow!("wrong request type"));
    };
    assert_eq!(id, 11);
    assert_eq!(provider.as_deref(), Some("cerebras"));
    assert!(!prefer_strongest);
    let auth = auth.expect("typed auth payload should roundtrip");
    assert_eq!(auth.provider.as_str(), "cerebras");
    assert_eq!(
        auth.credential_source,
        Some(AuthCredentialSource::ApiKeyFile)
    );
    assert_eq!(auth.auth_method, Some(AuthMethod::RemoteTuiPasteApiKey));
    assert_eq!(
        auth.expected_runtime
            .as_ref()
            .map(RuntimeProviderKey::as_str),
        Some("openai-compatible")
    );
    assert_eq!(
        auth.expected_catalog_namespace
            .as_ref()
            .map(CatalogNamespace::as_str),
        Some("cerebras")
    );
    Ok(())
}

#[test]
fn test_rewind_request_roundtrip() -> Result<()> {
    let req = Request::Rewind {
        id: 8,
        message_index: 3,
    };
    let json = serde_json::to_string(&req)?;
    assert!(json.contains("\"type\":\"rewind\""));
    let decoded = parse_request_json(&json)?;
    assert_eq!(decoded.id(), 8);
    let Request::Rewind { message_index, .. } = decoded else {
        return Err(anyhow!("wrong request type"));
    };
    assert_eq!(message_index, 3);
    Ok(())
}

#[test]
fn test_rewind_undo_request_roundtrip() -> Result<()> {
    let req = Request::RewindUndo { id: 9 };
    let json = serde_json::to_string(&req)?;
    assert!(json.contains("\"type\":\"rewind_undo\""));
    let decoded = parse_request_json(&json)?;
    assert_eq!(decoded.id(), 9);
    let Request::RewindUndo { .. } = decoded else {
        return Err(anyhow!("wrong request type"));
    };
    Ok(())
}

#[test]
fn test_rename_session_request_roundtrip() -> Result<()> {
    let req = Request::RenameSession {
        id: 10,
        title: Some("Release planning".to_string()),
    };
    let json = serde_json::to_string(&req)?;
    assert!(json.contains("\"type\":\"rename_session\""));
    assert!(json.contains("\"title\":\"Release planning\""));
    let decoded = parse_request_json(&json)?;
    assert_eq!(decoded.id(), 10);
    let Request::RenameSession { title, .. } = decoded else {
        return Err(anyhow!("wrong request type"));
    };
    assert_eq!(title.as_deref(), Some("Release planning"));
    Ok(())
}

#[test]
fn test_rename_session_clear_request_roundtrip_omits_title() -> Result<()> {
    let req = Request::RenameSession {
        id: 11,
        title: None,
    };
    let json = serde_json::to_string(&req)?;
    assert!(json.contains("\"type\":\"rename_session\""));
    assert!(!json.contains("\"title\""));
    let decoded = parse_request_json(&json)?;
    assert_eq!(decoded.id(), 11);
    let Request::RenameSession { title, .. } = decoded else {
        return Err(anyhow!("wrong request type"));
    };
    assert!(title.is_none());
    Ok(())
}

#[test]
fn test_event_roundtrip() -> Result<()> {
    let event = ServerEvent::TextDelta {
        text: "hello".to_string(),
    };
    let json = encode_event(&event);
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::TextDelta { text } = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(text, "hello");
    Ok(())
}

#[test]
fn test_context_message_added_event_roundtrip() -> Result<()> {
    let event = ServerEvent::ContextMessageAdded { id: 42 };
    let json = encode_event(&event);
    assert!(json.contains("\"type\":\"context_message_added\""));
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::ContextMessageAdded { id } = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(id, 42);
    Ok(())
}

#[test]
fn test_session_renamed_event_roundtrip() -> Result<()> {
    let event = ServerEvent::SessionRenamed {
        session_id: "sess_123".to_string(),
        title: Some("Release planning".to_string()),
        display_title: "Release planning".to_string(),
    };
    let json = encode_event(&event);
    assert!(json.contains("\"type\":\"session_renamed\""));
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::SessionRenamed {
        session_id,
        title,
        display_title,
    } = decoded
    else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(session_id, "sess_123");
    assert_eq!(title.as_deref(), Some("Release planning"));
    assert_eq!(display_title, "Release planning");
    Ok(())
}

#[test]
fn test_interrupted_event_decodes_from_json() -> Result<()> {
    let json = r#"{"type":"interrupted"}"#;
    let decoded = parse_event_json(json)?;
    let ServerEvent::Interrupted = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    Ok(())
}

#[test]
fn test_connection_type_event_roundtrip() -> Result<()> {
    let event = ServerEvent::ConnectionType {
        connection: "websocket".to_string(),
    };
    let json = encode_event(&event);
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::ConnectionType { connection } = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(connection, "websocket");
    Ok(())
}

#[test]
fn test_status_detail_event_roundtrip() -> Result<()> {
    let event = ServerEvent::StatusDetail {
        detail: "reusing websocket".to_string(),
    };
    let json = encode_event(&event);
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::StatusDetail { detail } = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(detail, "reusing websocket");
    Ok(())
}

#[test]
fn test_generated_image_event_roundtrip() -> Result<()> {
    let event = ServerEvent::GeneratedImage {
        id: "ig_123".to_string(),
        path: "/tmp/generated.png".to_string(),
        metadata_path: Some("/tmp/generated.json".to_string()),
        output_format: "png".to_string(),
        revised_prompt: Some("A polished image prompt".to_string()),
    };
    let json = encode_event(&event);
    assert!(json.contains("\"type\":\"generated_image\""));
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::GeneratedImage {
        id,
        path,
        metadata_path,
        output_format,
        revised_prompt,
    } = decoded
    else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(id, "ig_123");
    assert_eq!(path, "/tmp/generated.png");
    assert_eq!(metadata_path.as_deref(), Some("/tmp/generated.json"));
    assert_eq!(output_format, "png");
    assert_eq!(revised_prompt.as_deref(), Some("A polished image prompt"));
    Ok(())
}

#[test]
fn test_side_pane_images_event_roundtrip() -> Result<()> {
    let event = ServerEvent::SidePaneImages {
        session_id: "session_active".to_string(),
        images: vec![rayucode_session_types::RenderedImage {
            history_message_index: None,
            media_type: "image/png".to_string(),
            data: "base64-data".to_string(),
            label: Some("openclaw.png".to_string()),
            source: rayucode_session_types::RenderedImageSource::ToolResult {
                tool_name: "read".to_string(),
            },
            anchor: None,
        }],
    };
    let json = encode_event(&event);
    assert!(json.contains("\"type\":\"side_pane_images\""));
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::SidePaneImages { session_id, images } = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(session_id, "session_active");
    assert_eq!(images.len(), 1);
    assert_eq!(images[0].media_type, "image/png");
    assert_eq!(images[0].label.as_deref(), Some("openclaw.png"));
    assert_eq!(
        images[0].source,
        rayucode_session_types::RenderedImageSource::ToolResult {
            tool_name: "read".to_string(),
        }
    );
    Ok(())
}

#[test]
fn test_interrupted_event_roundtrip() -> Result<()> {
    let event = ServerEvent::Interrupted;
    let json = encode_event(&event);
    assert!(json.contains("\"type\":\"interrupted\""));
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::Interrupted = decoded else {
        return Err(anyhow!("wrong event type"));
    };
    Ok(())
}

#[test]
fn test_history_event_decodes_without_compaction_mode_for_older_servers() -> Result<()> {
    let json = r#"{
            "type":"history",
            "id":1,
            "session_id":"ses_test_123",
            "messages":[],
            "provider_name":"openai",
            "provider_model":"gpt-5.4",
            "available_models":["gpt-5.4"],
            "connection_type":"websocket"
        }"#;
    let decoded = parse_event_json(json)?;
    let ServerEvent::History {
        provider_name,
        provider_model,
        available_models,
        connection_type,
        compaction_mode,
        side_panel,
        agent_model_overrides,
        provider_oauth_email,
        available_service_tiers,
        ..
    } = decoded
    else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(provider_name.as_deref(), Some("openai"));
    assert_eq!(provider_model.as_deref(), Some("gpt-5.4"));
    assert_eq!(available_models, vec!["gpt-5.4"]);
    assert_eq!(connection_type.as_deref(), Some("websocket"));
    assert_eq!(
        compaction_mode,
        rayucode_config_types::CompactionMode::Reactive
    );
    assert!(!side_panel.has_pages());
    assert!(agent_model_overrides.is_empty());
    assert!(provider_oauth_email.is_none());
    assert!(available_service_tiers.is_none());
    assert!(!encode_event(&parse_event_json(json)?).contains("available_service_tiers"));
    Ok(())
}

#[test]
fn test_history_available_service_tiers_roundtrip() -> Result<()> {
    for tiers in [vec!["priority".to_string(), "flex".to_string()], Vec::new()] {
        let mut event =
            parse_event_json(r#"{"type":"history","id":1,"session_id":"test","messages":[]}"#)?;
        let ServerEvent::History {
            available_service_tiers,
            ..
        } = &mut event
        else {
            return Err(anyhow!("wrong event type"));
        };
        *available_service_tiers = Some(tiers.clone());
        let wire = encode_event(&event);
        assert!(wire.contains("\"available_service_tiers\":"));
        let ServerEvent::History {
            available_service_tiers,
            ..
        } = parse_event_json(wire.trim())?
        else {
            return Err(anyhow!("wrong event type"));
        };
        assert_eq!(available_service_tiers, Some(tiers));
    }
    Ok(())
}

#[test]
fn test_history_provider_oauth_email_roundtrip_redacts_debug() -> Result<()> {
    let decoded = parse_event_json(
        r#"{"type":"history","id":1,"session_id":"test","messages":[],"provider_oauth_email":"selected@example.test"}"#,
    )?;
    assert!(!format!("{decoded:?}").contains("selected@example.test"));
    let wire = encode_event(&decoded);
    assert!(wire.contains("\"provider_oauth_email\":\"selected@example.test\""));
    let ServerEvent::History {
        provider_oauth_email: Some(email),
        ..
    } = parse_event_json(wire.trim())?
    else {
        return Err(anyhow!("identity missing"));
    };
    assert_eq!(email.as_str(), "selected@example.test");
    assert_eq!(email.into_string(), "selected@example.test");
    Ok(())
}

#[test]
fn test_history_event_roundtrip_preserves_side_panel_snapshot() -> Result<()> {
    let event = ServerEvent::History {
        messages_base_count: None,
        images_unchanged: false,
        id: 101,
        session_id: "ses_test_456".to_string(),
        messages: vec![HistoryMessage {
            tool_duration_ms: None,
            response_stats: None,
            role: "assistant".to_string(),
            content: "hello".to_string(),
            tool_calls: None,
            tool_data: None,
        }],
        images: Vec::new(),
        provider_name: Some("openai".to_string()),
        provider_model: Some("gpt-5.4".to_string()),
        available_models: vec!["gpt-5.4".to_string()],
        available_model_routes: Vec::new(),
        available_service_tiers: None,
        mcp_servers: Vec::new(),
        skills: Vec::new(),
        total_tokens: Some((123, 45)),
        token_usage_totals: Some(TokenUsageTotals {
            cache_prompt_tokens: Some(130),
            messages_with_token_usage: 2,
            input_tokens: 123,
            output_tokens: 45,
            cache_reported_input_tokens: 100,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 10,
        }),
        all_sessions: Vec::new(),
        client_count: None,
        is_canary: None,
        reload_recovery: None,
        server_version: None,
        server_name: None,
        server_icon: None,
        server_has_update: None,
        was_interrupted: None,
        connection_type: Some("websocket".to_string()),
        status_detail: None,
        upstream_provider: None,
        resolved_credential: None,
        provider_oauth_email: None,
        provider_oauth_account_label: None,
        reasoning_effort: None,
        service_tier: None,
        subagent_model: None,
        agent_model_overrides: Default::default(),
        autoreview_enabled: None,
        autojudge_enabled: None,
        compaction_mode: rayucode_config_types::CompactionMode::Reactive,
        activity: None,
        applets: Default::default(),
        file_changes: None,
        side_panel: rayucode_side_panel_types::SidePanelSnapshot {
            focus_revision: 0,
            focused_page_id: Some("page-1".to_string()),
            pages: vec![rayucode_side_panel_types::SidePanelPage {
                id: "page-1".to_string(),
                title: "Notes".to_string(),
                file_path: "/tmp/notes.md".to_string(),
                format: rayucode_side_panel_types::SidePanelPageFormat::Markdown,
                pdf_data: None,
                source: rayucode_side_panel_types::SidePanelPageSource::Managed,
                content: "# Notes".to_string(),
                updated_at_ms: 42,
            }],
        },
    };
    let json = encode_event(&event);
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::History {
        id,
        side_panel,
        messages,
        provider_name,
        provider_model,
        total_tokens,
        token_usage_totals,
        ..
    } = decoded
    else {
        return Err(anyhow!("expected History event"));
    };
    assert_eq!(id, 101);
    assert_eq!(provider_name.as_deref(), Some("openai"));
    assert_eq!(provider_model.as_deref(), Some("gpt-5.4"));
    assert_eq!(total_tokens, Some((123, 45)));
    assert_eq!(
        token_usage_totals.map(|totals| totals.cache_read_input_tokens),
        Some(80)
    );
    assert_eq!(messages.len(), 1);
    assert_eq!(side_panel.focused_page_id.as_deref(), Some("page-1"));
    assert_eq!(side_panel.pages.len(), 1);
    assert_eq!(side_panel.pages[0].title, "Notes");
    assert_eq!(side_panel.pages[0].content, "# Notes");
    Ok(())
}

#[test]
fn test_compacted_history_event_roundtrip() -> Result<()> {
    let event = ServerEvent::CompactedHistory {
        id: 77,
        session_id: "ses_compact_123".to_string(),
        messages: vec![HistoryMessage {
            tool_duration_ms: None,
            response_stats: None,
            role: "assistant".to_string(),
            content: "older response".to_string(),
            tool_calls: None,
            tool_data: None,
        }],
        images: Vec::new(),
        compacted_total: 128,
        compacted_visible: 64,
        compacted_remaining: 64,
        compacted_hidden_prompts: 3,
    };
    let json = encode_event(&event);
    assert!(json.contains("\"type\":\"compacted_history\""));
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::CompactedHistory {
        id,
        session_id,
        messages,
        compacted_total,
        compacted_visible,
        compacted_remaining,
        ..
    } = decoded
    else {
        return Err(anyhow!("expected CompactedHistory event"));
    };
    assert_eq!(id, 77);
    assert_eq!(session_id, "ses_compact_123");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content, "older response");
    assert_eq!(compacted_total, 128);
    assert_eq!(compacted_visible, 64);
    assert_eq!(compacted_remaining, 64);
    Ok(())
}

#[test]
fn test_side_panel_state_event_roundtrip() -> Result<()> {
    let event = ServerEvent::SidePanelState {
        snapshot: rayucode_side_panel_types::SidePanelSnapshot {
            focus_revision: 0,
            focused_page_id: Some("page-1".to_string()),
            pages: vec![rayucode_side_panel_types::SidePanelPage {
                id: "page-1".to_string(),
                title: "Notes".to_string(),
                file_path: "/tmp/notes.md".to_string(),
                format: rayucode_side_panel_types::SidePanelPageFormat::Markdown,
                pdf_data: None,
                source: rayucode_side_panel_types::SidePanelPageSource::Managed,
                content: "updated".to_string(),
                updated_at_ms: 99,
            }],
        },
    };
    let json = encode_event(&event);
    assert!(json.contains("\"type\":\"side_panel_state\""));
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::SidePanelState { snapshot } = decoded else {
        return Err(anyhow!("expected SidePanelState event"));
    };
    assert_eq!(snapshot.focused_page_id.as_deref(), Some("page-1"));
    assert_eq!(snapshot.pages.len(), 1);
    assert_eq!(snapshot.pages[0].title, "Notes");
    assert_eq!(snapshot.pages[0].content, "updated");
    Ok(())
}

#[test]
fn test_error_event_retry_after_roundtrip() -> Result<()> {
    let event = ServerEvent::Error {
        id: 42,
        message: "rate limited".to_string(),
        retry_after_secs: Some(17),
    };
    let json = encode_event(&event);
    let decoded = parse_event_json(json.trim())?;
    let ServerEvent::Error {
        id,
        message,
        retry_after_secs,
    } = decoded
    else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(id, 42);
    assert_eq!(message, "rate limited");
    assert_eq!(retry_after_secs, Some(17));
    Ok(())
}

#[test]
fn test_error_event_retry_after_back_compat_default() -> Result<()> {
    let json = r#"{"type":"error","id":7,"message":"oops"}"#;
    let decoded = parse_event_json(json)?;
    let ServerEvent::Error {
        id,
        message,
        retry_after_secs,
    } = decoded
    else {
        return Err(anyhow!("wrong event type"));
    };
    assert_eq!(id, 7);
    assert_eq!(message, "oops");
    assert_eq!(retry_after_secs, None);
    Ok(())
}

#[test]
fn test_agent_models_session_setter_and_response_roundtrip() -> Result<()> {
    let clear = parse_request_json(r#"{"type":"set_agent_model","id":31,"target":"swarm"}"#)?;
    assert!(matches!(clear, Request::SetAgentModel { model: None, .. }));
    assert!(matches!(
        clear,
        Request::SetAgentModel { global: false, .. }
    ));
    let request = Request::SetAgentModel {
        id: 32,
        target: "review".into(),
        model: Some("inherit".into()),
        global: false,
    };
    let encoded = serde_json::to_string(&request)?;
    assert!(
        !encoded.contains("global"),
        "session updates keep the old wire shape"
    );
    let decoded = parse_request_json(&encoded)?;
    assert!(
        matches!(decoded, Request::SetAgentModel { model: Some(model), .. } if model == "inherit")
    );
    let global = Request::SetAgentModel {
        id: 33,
        target: "swarm".into(),
        model: Some("server-default".into()),
        global: true,
    };
    let decoded = parse_request_json(&serde_json::to_string(&global)?)?;
    assert!(matches!(
        decoded,
        Request::SetAgentModel { global: true, .. }
    ));
    let event = ServerEvent::AgentModelsChanged {
        id: 32,
        session_id: "session-a".into(),
        overrides: std::collections::BTreeMap::from([("review".into(), "inherit".into())]),
    };
    let decoded = parse_event_json(encode_event(&event).trim())?;
    assert!(
        matches!(decoded, ServerEvent::AgentModelsChanged { session_id, overrides, .. }
        if session_id == "session-a" && overrides.get("review").map(String::as_str) == Some("inherit"))
    );
    Ok(())
}

#[test]
fn history_prefix_fingerprint_is_stable_and_streaming_consistent() {
    let message = |role: &str, content: &str| HistoryMessage {
        tool_duration_ms: None,
        response_stats: None,
        role: role.to_string(),
        content: content.to_string(),
        tool_calls: None,
        tool_data: None,
    };
    let messages = vec![message("user", "hi"), message("assistant", "hello")];
    let whole =
        crate::history_prefix_fingerprint(messages.iter().map(crate::HistoryMessageRef::from));
    // Pinned value: client and server may run different builds, so the
    // fingerprint must never depend on process state or hasher seeds.
    assert_eq!(whole, 0x3396_f126_1f30_6a9e, "got {whole:#x}");
    let mut streaming = crate::HistoryFingerprinter::default();
    streaming.push((&messages[0]).into());
    let first = streaming.finish();
    streaming.push((&messages[1]).into());
    assert_eq!(streaming.finish(), whole);
    assert_eq!(streaming.base().count, 2);
    assert_ne!(first, whole);
    // Field boundaries must not alias.
    let shifted = vec![message("user", "hia"), message("ssistant", "hello")];
    assert_ne!(
        crate::history_prefix_fingerprint(shifted.iter().map(crate::HistoryMessageRef::from)),
        whole
    );
}

#[test]
fn history_delta_fields_are_backward_compatible() {
    let event: ServerEvent =
        serde_json::from_str(r#"{"type":"history","id":1,"session_id":"s","messages":[]}"#)
            .expect("legacy History without messages_base_count");
    let ServerEvent::History {
        messages_base_count,
        file_changes,
        ..
    } = event
    else {
        panic!("expected history");
    };
    assert_eq!(messages_base_count, None);
    assert_eq!(file_changes, None);
}

#[test]
fn file_changes_requests_events_and_history_roundtrip() -> Result<()> {
    for (kind, expected) in [
        (FileChangeKind::Created, "\"created\""),
        (FileChangeKind::Modified, "\"modified\""),
        (FileChangeKind::Deleted, "\"deleted\""),
        (FileChangeKind::Renamed, "\"renamed\""),
    ] {
        assert_eq!(serde_json::to_string(&kind)?, expected);
    }
    for (status, expected) in [
        (FileChangeStatus::Pending, "\"pending\""),
        (FileChangeStatus::Kept, "\"kept\""),
        (FileChangeStatus::Undone, "\"undone\""),
    ] {
        assert_eq!(serde_json::to_string(&status)?, expected);
    }
    for (action, expected) in [
        (FileChangeActionKind::Keep, "\"keep\""),
        (FileChangeActionKind::Undo, "\"undo\""),
        (FileChangeActionKind::Redo, "\"redo\""),
        (FileChangeActionKind::KeepAll, "\"keep_all\""),
        (FileChangeActionKind::UndoAll, "\"undo_all\""),
        (FileChangeActionKind::RedoAll, "\"redo_all\""),
    ] {
        assert_eq!(serde_json::to_string(&action)?, expected);
    }

    let req_get = Request::GetFileChanges { id: 10 };
    assert_eq!(req_get.id(), 10);
    let decoded_get = parse_request_json(&serde_json::to_string(&req_get)?)?;
    assert!(matches!(decoded_get, Request::GetFileChanges { id: 10 }));

    let req_diff = Request::GetFileChangeDiff {
        id: 11,
        path: "src/lib.rs".into(),
    };
    assert_eq!(req_diff.id(), 11);
    let decoded_diff = parse_request_json(&serde_json::to_string(&req_diff)?)?;
    assert!(matches!(
        decoded_diff,
        Request::GetFileChangeDiff { id: 11, path } if path == "src/lib.rs"
    ));

    // `force` defaults to false when omitted on the wire.
    let decoded_action = parse_request_json(
        r#"{"type":"file_change_action","id":12,"action":"undo","path":"src/lib.rs"}"#,
    )?;
    assert_eq!(decoded_action.id(), 12);
    assert!(matches!(
        decoded_action,
        Request::FileChangeAction {
            id: 12,
            action: FileChangeActionKind::Undo,
            path: Some(p),
            force: false
        } if p == "src/lib.rs"
    ));

    let snapshot = FileChangesSnapshot {
        session_id: "ses_fc".into(),
        latest_turn_id: 2,
        total_pending_files: 1,
        total_additions: 3,
        total_deletions: 1,
        files: vec![FileChangeEntrySummary {
            path: "/repo/src/lib.rs".into(),
            display_path: "src/lib.rs".into(),
            old_path: None,
            kind: FileChangeKind::Modified,
            status: FileChangeStatus::Pending,
            additions: 3,
            deletions: 1,
            changed_in_latest_turn: true,
            turn_id: 2,
            edit_count: 1,
            is_binary: false,
            undoable: true,
            can_redo: false,
            preview_hunks: vec![FileChangeHunk {
                old_start: 1,
                old_lines: 1,
                new_start: 1,
                new_lines: 3,
                header: "@@ -1,1 +1,3 @@".into(),
                lines: vec!["-a".into(), "+b".into(), "+c".into(), "+d".into()],
            }],
            preview_truncated: false,
            updated_at_ms: 1234,
        }],
    };

    let state_ev = ServerEvent::FileChangesState {
        snapshot: snapshot.clone(),
    };
    let encoded_state = encode_event(&state_ev);
    assert!(encoded_state.contains("\"type\":\"file_changes_state\""));
    let decoded_state = parse_event_json(encoded_state.trim())?;
    assert!(matches!(
        decoded_state,
        ServerEvent::FileChangesState { snapshot: s } if s == snapshot
    ));

    let diff_ev = ServerEvent::FileChangeDiff {
        id: 11,
        diff: FileChangeDiffPayload {
            path: "/repo/src/lib.rs".into(),
            display_path: "src/lib.rs".into(),
            old_path: None,
            kind: FileChangeKind::Modified,
            status: FileChangeStatus::Pending,
            additions: 3,
            deletions: 1,
            is_binary: false,
            original_content: "a\n".into(),
            modified_content: "b\nc\nd\n".into(),
            unified_diff: "--- a/src/lib.rs\n+++ b/src/lib.rs\n".into(),
            hunks: snapshot.files[0].preview_hunks.clone(),
        },
    };
    let encoded_diff = encode_event(&diff_ev);
    assert!(encoded_diff.contains("\"type\":\"file_change_diff\""));
    let decoded_diff_ev = parse_event_json(encoded_diff.trim())?;
    assert!(matches!(
        decoded_diff_ev,
        ServerEvent::FileChangeDiff { id: 11, .. }
    ));

    let action_ev = ServerEvent::FileChangeActionResult {
        id: 12,
        response: FileChangeActionResponse {
            ok: true,
            message: "Undid 1 file".into(),
            conflicts: Vec::new(),
            snapshot: snapshot.clone(),
        },
    };
    let encoded_action = encode_event(&action_ev);
    assert!(encoded_action.contains("\"type\":\"file_change_action_result\""));
    let decoded_action_ev = parse_event_json(encoded_action.trim())?;
    assert!(matches!(
        decoded_action_ev,
        ServerEvent::FileChangeActionResult { id: 12, response } if response.ok && response.snapshot == snapshot
    ));
    Ok(())
}

#[test]
fn live_bash_progress_roundtrips_and_legacy_tool_done_omits_duration() {
    let old = r#"{"type":"tool_done","id":"fixture","name":"bash","output":"done"}"#;
    let event = serde_json::from_str::<crate::ServerEvent>(old).unwrap();
    let crate::ServerEvent::ToolDone {
        tool_duration_ms, ..
    } = event
    else {
        panic!("expected tool_done");
    };
    assert_eq!(tool_duration_ms, None);
    let progress = crate::BashProgress {
        call_id: "fixture".into(),
        elapsed_ms: 1_000,
        output_bytes: 27,
        tail: "partial 界".into(),
    };
    let event = crate::ServerEvent::BashProgress {
        update: crate::BashProgressUpdate(std::sync::Arc::new(std::sync::Mutex::new(
            progress.clone(),
        ))),
    };
    let wire = serde_json::to_string(&event).unwrap();
    let crate::ServerEvent::BashProgress { update } = serde_json::from_str(&wire).unwrap() else {
        panic!("expected Bash progress");
    };
    assert_eq!(update.snapshot(), progress);
}
