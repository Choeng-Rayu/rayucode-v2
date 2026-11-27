use super::*;
use std::path::Path;

#[cfg(unix)]
#[tokio::test]
async fn acp_new_and_resumed_sessions_advertise_server_failover() {
    for resume in [false, true] {
        let (client, server) = tokio::net::UnixStream::pair().unwrap();
        let (reader, writer) = client.into_split();
        let daemon = tokio::spawn(async move {
            let (reader, mut writer) = server.into_split();
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let request: Request = serde_json::from_str(&line).unwrap();
            let Request::Subscribe {
                id,
                supports_server_failover,
                target_session_id,
                ..
            } = request
            else {
                panic!("expected ACP subscription");
            };
            assert!(
                supports_server_failover,
                "ACP must delegate account failover to the daemon"
            );
            assert_eq!(target_session_id.as_deref(), resume.then_some("existing"));
            // Stop after the subscription, without needing a live provider or daemon.
            let response = json!({"type": "error", "id": id, "message": "subscription captured"});
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        });
        let runtime = AcpRuntime::new(AcpProfile::Standard, ProviderChoice::Claude, None, None);
        let cwd = PathBuf::from("/acp-test");
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            if resume {
                runtime
                    .attach_existing_session_connected(
                        "existing".into(),
                        cwd,
                        false,
                        reader,
                        writer,
                    )
                    .await
            } else {
                runtime
                    .create_new_session_connected(cwd, reader, writer)
                    .await
            }
        })
        .await
        .expect("ACP subscription timed out");
        daemon.await.unwrap();
        assert_eq!(
            result
                .err()
                .expect("mock daemon rejects subscription")
                .to_string(),
            "subscription captured"
        );
    }
}

#[test]
fn acp_tool_kind_maps_core_tools() {
    assert_eq!(tool_kind("read"), "read");
    assert_eq!(tool_kind("apply_patch"), "edit");
    assert_eq!(tool_kind("bash"), "execute");
    assert_eq!(tool_kind("agentgrep"), "search");
    assert_eq!(tool_kind("webfetch"), "fetch");
    assert_eq!(tool_kind("swarm"), "other");
}

#[test]
fn json_rpc_parse_errors_use_standard_codes() {
    let (code, _) = JsonRpcMessage::parse("not json").unwrap_err();
    assert_eq!(code, JSONRPC_PARSE_ERROR);

    let (code, message) = JsonRpcMessage::parse(r#"{"method":"initialize"}"#).unwrap_err();
    assert_eq!(code, JSONRPC_INVALID_REQUEST);
    assert!(message.contains("jsonrpc"));
}

#[test]
fn prompt_from_params_accepts_text_images_and_resources() {
    let params = json!({
        "sessionId": "s1",
        "prompt": [
            {"type": "text", "text": "hello"},
            {"type": "image", "mimeType": "image/png", "data": "abc"},
            {"type": "resource", "resource": {"uri": "file:///tmp/a.rs", "text": "fn main(){}"}},
            {"type": "resource_link", "uri": "file:///tmp/b.rs", "name": "b.rs"}
        ]
    });
    let (text, images) = prompt_from_params(&params).unwrap();
    assert!(text.contains("hello"));
    assert!(text.contains("Embedded resource: file:///tmp/a.rs"));
    assert!(text.contains("Resource link: b.rs"));
    assert_eq!(images, vec![("image/png".to_string(), "abc".to_string())]);
}

#[test]
fn prompt_usage_deduplicates_live_snapshots_and_resets_per_call() {
    let mut usage = TurnUsage::default();
    usage.observe_snapshot(10, 2, Some(4), None);
    usage.observe_snapshot(10, 3, Some(4), Some(5));
    usage.observe_snapshot(10, 3, Some(4), Some(5));
    // Stale or partial snapshots must not lower the per-call watermark.
    usage.observe_snapshot(8, 1, Some(2), None);
    usage.observe_snapshot(10, 3, Some(4), Some(5));
    assert_eq!(usage.input_tokens, 10);
    assert_eq!(usage.output_tokens, 3);
    assert_eq!(usage.cached_read_tokens, Some(4));
    assert_eq!(usage.cached_write_tokens, Some(5));
    usage.begin_call();
    usage.observe_snapshot(20, 3, Some(6), Some(7));
    assert_eq!(usage.input_tokens, 30);
    assert_eq!(usage.output_tokens, 6);
    assert_eq!(usage.cached_read_tokens, Some(10));
    assert_eq!(usage.cached_write_tokens, Some(12));
}

#[test]
fn prompt_response_reports_usage_accumulated_across_the_turn() {
    let mut usage = TurnUsage::default();
    usage.add(10, 2, Some(4), Some(5));
    usage.add(20, 3, Some(6), Some(7));

    assert_eq!(
        prompt_response("end_turn", &usage),
        json!({
            "stopReason": "end_turn",
            "usage": {
                "totalTokens": 57,
                "inputTokens": 30,
                "outputTokens": 5,
                "cachedReadTokens": 10,
                "cachedWriteTokens": 12,
            }
        })
    );
}

#[test]
fn prompt_response_omits_unreported_usage_and_cache_fields() {
    assert_eq!(
        prompt_response("end_turn", &TurnUsage::default()),
        json!({ "stopReason": "end_turn" })
    );

    let mut usage = TurnUsage::default();
    usage.add(10, 2, None, None);
    assert_eq!(
        prompt_response("cancelled", &usage),
        json!({
            "stopReason": "cancelled",
            "usage": {
                "totalTokens": 12,
                "inputTokens": 10,
                "outputTokens": 2,
            }
        })
    );
}

#[test]
fn initialize_standard_omits_rayu_meta() {
    let result = initialize_result(&json!({"protocolVersion": 1}), AcpProfile::Standard);
    assert_eq!(result["protocolVersion"], 1);
    assert!(result["agentCapabilities"].get("_meta").is_none());
    assert_eq!(result["agentCapabilities"]["loadSession"], true);
}

#[test]
fn initialize_full_advertises_rayu_extension_meta() {
    let result = initialize_result(&json!({"protocolVersion": 1}), AcpProfile::Full);
    assert_eq!(
        result["agentCapabilities"]["_meta"]["rayu"]["profile"],
        "full"
    );
}

#[test]
fn event_mapper_maps_tool_lifecycle() {
    let mut mapper = EventMapper::new("session1".to_string(), AcpProfile::Standard);
    let start = mapper.map_event(ServerEvent::ToolStart {
        id: "tool1".to_string(),
        name: "bash".to_string(),
    });
    assert_eq!(start[0]["sessionUpdate"], "tool_call");
    assert_eq!(start[0]["kind"], "execute");

    let input = mapper.map_event(ServerEvent::ToolInput {
        id: None,
        delta: "{\"command\":\"true\"}".to_string(),
    });
    assert_eq!(input[0]["rawInput"]["command"], "true");

    let done = mapper.map_event(ServerEvent::ToolDone {
        tool_duration_ms: None,
        id: "tool1".to_string(),
        name: "bash".to_string(),
        output: "ok".to_string(),
        error: None,
    });
    assert_eq!(done[0]["status"], "completed");
    assert_eq!(done[0]["content"][0]["content"]["text"], "ok");
}

#[test]
fn event_mapper_keeps_overlapping_tool_inputs_on_their_call() {
    let mut mapper = EventMapper::new("session1".to_string(), AcpProfile::Standard);
    for id in ["a", "b"] {
        mapper.map_event(ServerEvent::ToolStart {
            id: id.to_string(),
            name: "bash".to_string(),
        });
        assert!(
            mapper
                .map_event(ServerEvent::ToolInput {
                    id: Some(id.to_string()),
                    delta: "{\"command\":".to_string(),
                })
                .is_empty()
        );
    }
    for (id, command) in [("a", "true"), ("b", "false")] {
        let updates = mapper.map_event(ServerEvent::ToolInput {
            id: Some(id.to_string()),
            delta: format!("\"{command}\"}}"),
        });
        assert_eq!(
            updates,
            vec![json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": id,
                "rawInput": {"command": command},
            })]
        );
    }
    for (id, command) in [("a", "true"), ("b", "false")] {
        let updates = mapper.map_event(ServerEvent::ToolExec {
            id: id.to_string(),
            name: "bash".to_string(),
        });
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0]["toolCallId"], id);
        assert_eq!(updates[0]["status"], "in_progress");
        assert_eq!(updates[0]["rawInput"], json!({"command": command}));
    }
}

#[test]
fn event_mapper_suppresses_incomplete_legacy_tool_input() {
    let mut mapper = EventMapper::new("session1".to_string(), AcpProfile::Standard);
    assert!(
        mapper
            .map_event(ServerEvent::ToolInput {
                id: None,
                delta: "ignored without a tool".to_string(),
            })
            .is_empty()
    );
    mapper.map_event(ServerEvent::ToolStart {
        id: "legacy".to_string(),
        name: "bash".to_string(),
    });
    for delta in ["", "{", "\"command\":"] {
        assert!(
            mapper
                .map_event(ServerEvent::ToolInput {
                    id: None,
                    delta: delta.to_string(),
                })
                .is_empty()
        );
    }
    let updates = mapper.map_event(ServerEvent::ToolInput {
        id: None,
        delta: "\"true\"}".to_string(),
    });
    assert_eq!(
        updates,
        vec![json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "legacy",
            "rawInput": {"command": "true"},
        })]
    );
}

#[test]
fn non_empty_mcp_servers_are_tolerated_until_session_scoped_mcp_is_supported() {
    let params = json!({"mcpServers": [{"name": "fs"}]});
    assert!(validate_acp_mcp_servers(&params).is_ok());

    let params = json!({"mcpServers": []});
    assert!(validate_acp_mcp_servers(&params).is_ok());
}

#[test]
fn advertised_commands_cover_all_acp_daemon_model_controls() {
    let commands = acp_available_commands();
    let names: Vec<&str> = commands
        .iter()
        .map(|command| command["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["model", "models", "effort", "mode"]);
    assert_eq!(commands[0]["input"]["hint"], "model id (optional)");
    assert!(commands[1].get("input").is_none());
    assert!(
        commands[2]["input"]["hint"]
            .as_str()
            .unwrap()
            .contains("high")
    );
    assert!(
        commands[3]["input"]["hint"]
            .as_str()
            .unwrap()
            .contains("plan")
    );
}

#[test]
fn advertised_commands_parse_to_real_dispatch_variants() {
    assert_eq!(
        parse_acp_slash_command("/model claude-sonnet-4-5")
            .unwrap()
            .unwrap(),
        AcpSlashCommand::Model(Some("claude-sonnet-4-5".to_string()))
    );
    assert_eq!(
        parse_acp_slash_command("/model ").unwrap().unwrap(),
        AcpSlashCommand::Model(None)
    );
    assert_eq!(
        parse_acp_slash_command("/models").unwrap().unwrap(),
        AcpSlashCommand::Models
    );
    assert_eq!(
        parse_acp_slash_command("/effort xhigh").unwrap().unwrap(),
        AcpSlashCommand::Effort(Some("xhigh".to_string()))
    );
    assert_eq!(
        parse_acp_slash_command("/mode plan").unwrap().unwrap(),
        AcpSlashCommand::Mode(Some("plan".to_string()))
    );
    assert_eq!(
        parse_acp_slash_command("/mode").unwrap().unwrap(),
        AcpSlashCommand::Mode(None)
    );
    assert!(parse_acp_slash_command("/models now").unwrap().is_err());
    assert!(parse_acp_slash_command("/not-advertised").is_none());
    assert!(parse_acp_slash_command(" /model literal").is_none());
    assert!(parse_acp_slash_command("ordinary prompt").is_none());
}

fn project_skills(names: &[&str]) -> (tempfile::TempDir, crate::skill::SkillRegistry) {
    let dir = tempfile::tempdir().unwrap();
    for name in names {
        let skill_dir = dir.path().join(".rayu/skills").join(name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: Test {name}\n---\nDo {name}.\n"),
        )
        .unwrap();
    }
    let registry = crate::skill::SkillRegistry::load_project_overlay(Some(dir.path())).unwrap();
    (dir, registry)
}

#[test]
fn slash_and_dollar_skill_invocations_resolve_with_trailing_prompt() {
    let (_dir, skills) = project_skills(&["interrogate"]);
    assert_eq!(
        resolve_acp_skill_invocation(&skills, "/interrogate"),
        Some(("interrogate".to_string(), None))
    );
    assert_eq!(
        resolve_acp_skill_invocation(&skills, "/interrogate the auth flow\n"),
        Some(("interrogate".to_string(), Some("the auth flow".to_string())))
    );
    assert_eq!(
        resolve_acp_skill_invocation(&skills, "$interrogate why"),
        Some(("interrogate".to_string(), Some("why".to_string())))
    );
}

#[test]
fn unknown_escaped_and_path_like_slash_text_is_untouched() {
    let (_dir, skills) = project_skills(&["interrogate"]);
    for text in [
        "/unknown do things",
        "/home/user/file.rs explain",
        " /interrogate escaped",
        "please /interrogate",
        "$HOME is set",
        "ordinary prompt",
    ] {
        assert_eq!(resolve_acp_skill_invocation(&skills, text), None, "{text}");
    }
}

#[test]
fn explicit_skill_metadata_is_read_from_prompt_meta() {
    assert_eq!(
        explicit_skill_from_params(&json!({"_meta": {"rayu": {"skill": "/interrogate"}}})),
        Some("interrogate".to_string())
    );
    assert_eq!(
        explicit_skill_from_params(&json!({"_meta": {"activeSkill": "$review"}})),
        Some("review".to_string())
    );
    assert_eq!(
        explicit_skill_from_params(&json!({"_meta": {"skill": " "}})),
        None
    );
    assert_eq!(explicit_skill_from_params(&json!({})), None);
}

#[test]
fn skill_commands_advertise_installed_skills_without_shadowing_builtins() {
    let (_dir, skills) = project_skills(&["interrogate", "model"]);
    let commands = acp_skill_commands(&skills);
    let names: Vec<&str> = commands
        .iter()
        .map(|command| command["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["interrogate"]);
    assert_eq!(commands[0]["description"], "Test interrogate");
}

#[test]
fn compatibility_methods_accept_host_field_names_and_aliases() {
    assert_eq!(
        compatibility_option_value(
            &json!({"modelId": "deepseek-v4-flash"}),
            &["modelId", "model"],
            "session/set_model"
        )
        .unwrap(),
        "deepseek-v4-flash"
    );
    assert_eq!(
        compatibility_option_value(
            &json!({"reasoningEffort": "high"}),
            &["effort", "reasoningEffort"],
            "session/set_reasoning_effort"
        )
        .unwrap(),
        "high"
    );
    assert!(
        compatibility_option_value(
            &json!({"effort": ""}),
            &["effort", "reasoningEffort"],
            "session/set_reasoning_effort"
        )
        .unwrap_err()
        .contains("non-empty")
    );
}

#[test]
fn cwd_must_be_absolute() {
    let params = json!({"cwd": "relative"});
    assert!(cwd_from_params(&params).is_err());
    let params = json!({"cwd": "/tmp"});
    assert_eq!(cwd_from_params(&params).unwrap(), Path::new("/tmp"));
}

#[test]
fn config_options_include_model_selector_and_effort_ladder() {
    let state = SessionUiState {
        provider_name: Some("openai".to_string()),
        model: Some("gpt-5.2".to_string()),
        available_models: vec!["gpt-5.2".to_string(), "gpt-5.2-codex".to_string()],
        reasoning_effort: Some("high".to_string()),
        permission_mode: None,
    };
    let options = session_config_options(&state);
    assert_eq!(options.len(), 2);

    let model = &options[0];
    assert_eq!(model["id"], CONFIG_ID_MODEL);
    assert_eq!(model["category"], "model");
    assert_eq!(model["type"], "select");
    assert_eq!(model["currentValue"], "gpt-5.2");
    assert_eq!(model["options"].as_array().unwrap().len(), 2);

    let effort = &options[1];
    assert_eq!(effort["id"], CONFIG_ID_EFFORT);
    assert_eq!(effort["category"], "thought_level");
    assert_eq!(effort["currentValue"], "high");
    let effort_values: Vec<&str> = effort["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["value"].as_str().unwrap())
        .collect();
    assert!(effort_values.contains(&"medium"));
    assert!(
        !effort_values.iter().any(|value| value.starts_with("swarm")),
        "swarm sentinels are TUI-only and must not leak over ACP: {effort_values:?}"
    );
}

#[test]
fn config_options_current_model_prepended_when_not_listed() {
    let state = SessionUiState {
        provider_name: Some("anthropic".to_string()),
        model: Some("claude-opus-4-6".to_string()),
        available_models: vec!["claude-sonnet-4-5".to_string()],
        reasoning_effort: None,
        permission_mode: None,
    };
    let options = session_config_options(&state);
    let model_values: Vec<&str> = options[0]["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["value"].as_str().unwrap())
        .collect();
    assert_eq!(model_values[0], "claude-opus-4-6");
    assert!(model_values.contains(&"claude-sonnet-4-5"));
}

#[test]
fn legacy_models_catalog_is_emitted_alongside_config_options() {
    let state = SessionUiState {
        provider_name: Some("deepseek".to_string()),
        model: Some("deepseek-v4-flash".to_string()),
        available_models: vec!["deepseek-v4-pro".to_string()],
        reasoning_effort: Some("high".to_string()),
        permission_mode: Some(PermissionMode::Default),
    };
    let mut result = json!({"sessionId": "s1"});
    insert_session_configuration(&mut result, &state);

    assert!(result["configOptions"].is_array());
    assert_eq!(result["models"]["currentModelId"], "deepseek-v4-flash");
    assert_eq!(result["modes"]["currentModeId"], "default");
    assert_eq!(result["modes"]["availableModes"].as_array().unwrap().len(), 5);
    let ids: Vec<&str> = result["models"]["availableModels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|model| model["modelId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["deepseek-v4-flash", "deepseek-v4-pro"]);
}

#[test]
fn config_options_empty_without_model_state() {
    let options = session_config_options(&SessionUiState::default());
    assert!(options.is_empty());
}

#[test]
fn context_limit_falls_back_to_default_for_unknown_models() {
    let state = SessionUiState {
        provider_name: Some("mystery".to_string()),
        model: Some("mystery-model-9000".to_string()),
        available_models: Vec::new(),
        reasoning_effort: None,
        permission_mode: None,
    };
    assert_eq!(
        state.context_limit(),
        crate::provider::DEFAULT_CONTEXT_LIMIT as u64
    );
}

#[test]
fn acp_turn_outcome_maps_terminal_limits_and_refusals() {
    use crate::protocol::TurnStopReason;
    let limit = |raw: Option<&str>, msg: &str| ServerEvent::TurnStopped {
        reason: TurnStopReason::LimitReached,
        message: msg.to_string(),
        provider_stop_reason: raw.map(str::to_string),
    };
    let mut o = TurnOutcome::default();
    o.observe(&ServerEvent::Ack { id: 7 }, 7);
    assert_eq!(o.stop_reason(false), "end_turn");
    o.observe(&limit(Some("max_tokens"), "truncated"), 7);
    assert_eq!(o.stop_reason(false), "max_tokens");
    // A continued model request clears an intermediate limit.
    o.observe(&ServerEvent::RetryRollback { attempt: 1, max: 3 }, 7);
    assert_eq!(o.stop_reason(false), "end_turn");
    o.observe(&limit(Some("max_turn_requests"), "limit"), 7);
    assert_eq!(o.stop_reason(false), "max_turn_requests");

    let mut o = TurnOutcome::default();
    o.observe(&ServerEvent::Ack { id: 7 }, 7);
    o.observe(
        &ServerEvent::ProviderGuardrail {
            stop_reason: Some("refusal".into()),
            message: "blocked".into(),
        },
        7,
    );
    assert_eq!(o.stop_reason(false), "refusal");
    // Cancellation wins over everything for the cancelled prompt.
    assert_eq!(o.stop_reason(true), "cancelled");

    // Non-refusal provider notices are not refusals.
    let mut o = TurnOutcome::default();
    o.observe(
        &ServerEvent::ProviderGuardrail {
            stop_reason: Some("end_turn".into()),
            message: "empty".into(),
        },
        7,
    );
    assert_eq!(o.stop_reason(false), "end_turn");
}

#[test]
fn acp_turn_outcome_ignores_stale_interrupt_before_ack() {
    let mut o = TurnOutcome::default();
    o.observe(&ServerEvent::Interrupted, 9);
    o.observe(&ServerEvent::Ack { id: 9 }, 9);
    assert_eq!(o.stop_reason(false), "end_turn");
    o.observe(&ServerEvent::Interrupted, 9);
    assert_eq!(o.stop_reason(false), "cancelled");
}

#[test]
fn initialize_advertises_full_session_mcp_and_auth_capabilities() {
    let params = json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": { "readTextFile": true, "writeTextFile": true },
            "terminal": true,
            "auth": { "terminal": true }
        },
        "clientInfo": { "name": "vscode", "version": "1.101.0" }
    });
    let result = initialize_result(&params, AcpProfile::Standard);
    let session_caps = &result["agentCapabilities"]["sessionCapabilities"];
    assert!(session_caps.get("list").is_some());
    assert!(session_caps.get("fork").is_some());
    assert!(session_caps.get("resume").is_some());
    assert!(session_caps.get("close").is_some());
    assert!(session_caps.get("delete").is_some());
    assert_eq!(result["agentCapabilities"]["mcpCapabilities"]["http"], true);
    assert_eq!(result["agentCapabilities"]["mcpCapabilities"]["sse"], true);

    let auth_methods = result["authMethods"].as_array().unwrap();
    assert_eq!(auth_methods.len(), 2);
    assert_eq!(auth_methods[0]["id"], auth::AUTH_METHOD_RAYU_LOGIN);
    assert!(auth_methods[0]["_meta"]["terminal-auth"]["command"].is_string());
    assert_eq!(auth_methods[1]["id"], auth::AUTH_METHOD_RAYU_API_KEY);
}

#[test]
fn mode_parser_handles_canonical_ids_and_ide_aliases() {
    assert_eq!(parse_acp_mode("default"), Some(PermissionMode::Default));
    assert_eq!(parse_acp_mode("ask"), Some(PermissionMode::Default));
    assert_eq!(parse_acp_mode("accept_edits"), Some(PermissionMode::AcceptEdits));
    assert_eq!(parse_acp_mode("acceptEdits"), Some(PermissionMode::AcceptEdits));
    assert_eq!(parse_acp_mode("code"), Some(PermissionMode::AcceptEdits));
    assert_eq!(parse_acp_mode("plan"), Some(PermissionMode::Plan));
    assert_eq!(parse_acp_mode("architect"), Some(PermissionMode::Plan));
    assert_eq!(parse_acp_mode("full_manage"), Some(PermissionMode::FullManage));
    assert_eq!(parse_acp_mode("bypassPermissions"), Some(PermissionMode::FullManage));
    assert_eq!(parse_acp_mode("orchestrator"), Some(PermissionMode::Orchestrator));
    assert_eq!(parse_acp_mode("unknown-mode"), None);
}

#[test]
fn permission_request_builder_and_decision_parser_cover_all_outcomes() {
    let params = build_permission_request_params(
        "sess_1",
        "tool_1",
        "edit",
        "edit src/main.rs",
        &json!({ "file_path": "src/main.rs", "line": 42 }),
        Some("bounded"),
        Some(Path::new("/workspace")),
    );
    assert_eq!(params["sessionId"], "sess_1");
    assert_eq!(params["toolCall"]["toolCallId"], "tool_1");
    assert_eq!(params["toolCall"]["kind"], "edit");
    assert_eq!(
        params["toolCall"]["locations"][0]["path"],
        "/workspace/src/main.rs"
    );
    assert_eq!(params["toolCall"]["locations"][0]["line"], 42);
    assert_eq!(params["options"].as_array().unwrap().len(), 3);

    assert_eq!(
        parse_permission_decision(&json!({
            "outcome": { "outcome": "selected", "optionId": "allow_once" }
        })),
        PermissionDecision::Allow
    );
    assert_eq!(
        parse_permission_decision(&json!({
            "outcome": { "outcome": "selected", "optionId": "allow_always" }
        })),
        PermissionDecision::AllowAlways
    );
    assert_eq!(
        parse_permission_decision(&json!({
            "outcome": { "outcome": "selected", "optionId": "reject_once" }
        })),
        PermissionDecision::Deny
    );
    assert_eq!(
        parse_permission_decision(&json!({
            "outcome": { "outcome": "cancelled" }
        })),
        PermissionDecision::Deny
    );
    assert_eq!(parse_permission_decision(&json!({})), PermissionDecision::Deny);
}

#[test]
fn event_mapper_emits_thoughts_plans_bash_progress_diffs_and_locations() {
    let mut mapper = EventMapper::new("sess_1".to_string(), AcpProfile::Standard)
        .with_working_dir(Some(PathBuf::from("/repo")));

    let thought = mapper.map_event(ServerEvent::ReasoningDelta {
        text: "analyzing...".to_string(),
    });
    assert_eq!(thought[0]["sessionUpdate"], "agent_thought_chunk");
    assert_eq!(thought[0]["content"]["text"], "analyzing...");

    let todos_payload = json!({
        "todos": [
            { "id": "1", "content": "Inspect files", "status": "completed", "priority": "high" },
            { "id": "2", "content": "Implement ACP", "status": "in_progress", "priority": "medium" }
        ]
    })
    .to_string();
    let plan = mapper.map_event(ServerEvent::Todos {
        session_id: "sess_1".to_string(),
        payload: todos_payload,
    });
    assert_eq!(plan[0]["sessionUpdate"], "plan");
    assert_eq!(plan[0]["entries"].as_array().unwrap().len(), 2);
    assert_eq!(plan[0]["entries"][0]["status"], "completed");
    assert_eq!(plan[0]["entries"][1]["status"], "in_progress");

    let bash_progress = mapper.map_event(ServerEvent::BashProgress {
        update: crate::protocol::BashProgressUpdate(std::sync::Arc::new(std::sync::Mutex::new(
            crate::protocol::BashProgress {
                call_id: "call_bash".to_string(),
                elapsed_ms: 500,
                output_bytes: 12,
                tail: "running tests".to_string(),
            },
        ))),
    });
    assert_eq!(bash_progress[0]["sessionUpdate"], "tool_call_update");
    assert_eq!(bash_progress[0]["toolCallId"], "call_bash");
    assert_eq!(bash_progress[0]["content"][0]["content"]["text"], "running tests");

    mapper.map_event(ServerEvent::ToolStart {
        id: "edit_1".to_string(),
        name: "edit".to_string(),
    });
    let input_updates = mapper.map_event(ServerEvent::ToolInput {
        id: Some("edit_1".to_string()),
        delta: json!({
            "file_path": "src/lib.rs",
            "line": 10,
            "old_string": "foo",
            "new_string": "bar"
        })
        .to_string(),
    });
    assert_eq!(input_updates[0]["locations"][0]["path"], "/repo/src/lib.rs");
    assert_eq!(input_updates[0]["locations"][0]["line"], 10);

    let done = mapper.map_event(ServerEvent::ToolDone {
        id: "edit_1".to_string(),
        name: "edit".to_string(),
        output: "Updated src/lib.rs".to_string(),
        tool_duration_ms: Some(15),
        error: None,
    });
    assert_eq!(done[0]["status"], "completed");
    assert_eq!(done[0]["locations"][0]["path"], "/repo/src/lib.rs");
    assert_eq!(done[0]["content"][0]["type"], "diff");
    assert_eq!(done[0]["content"][0]["path"], "/repo/src/lib.rs");
    assert_eq!(done[0]["content"][0]["oldText"], "foo");
    assert_eq!(done[0]["content"][0]["newText"], "bar");
    assert_eq!(done[0]["content"][1]["content"]["text"], "Updated src/lib.rs");

    assert_eq!(tool_title("mcp__github__create_issue"), "MCP: github/create_issue");
    assert_eq!(tool_kind("todo_write"), "think");
}

#[test]
fn mcp_servers_parser_supports_stdio_http_sse_and_kv_formats() {
    let params = json!({
        "mcpServers": [
            {
                "name": "local-fs",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem"],
                "env": [{ "name": "ROOT", "value": "/tmp" }]
            },
            {
                "type": "http",
                "name": "remote-api",
                "url": "https://mcp.example.com/v1",
                "headers": [{ "name": "Authorization", "value": "Bearer tok" }]
            },
            {
                "type": "sse",
                "name": "legacy-sse",
                "url": "https://sse.example.com/events",
                "headers": { "X-Api-Key": "secret" }
            }
        ]
    });
    let parsed = mcp_bridge::parse_acp_mcp_servers(&params).unwrap();
    assert_eq!(parsed.len(), 3);
    assert_eq!(parsed[0].name, "local-fs");
    assert!(parsed[0].config.is_stdio());
    assert!(!parsed[0].config.shared);
    assert_eq!(parsed[0].config.env.get("ROOT").map(String::as_str), Some("/tmp"));

    assert_eq!(parsed[1].name, "remote-api");
    assert!(parsed[1].config.is_remote());
    assert_eq!(
        parsed[1].config.headers.get("Authorization").map(String::as_str),
        Some("Bearer tok")
    );

    assert_eq!(parsed[2].name, "legacy-sse");
    assert!(parsed[2].config.is_remote());
    assert_eq!(
        parsed[2].config.headers.get("X-Api-Key").map(String::as_str),
        Some("secret")
    );

    assert!(mcp_bridge::parse_acp_mcp_servers(&json!({ "mcpServers": "bad" })).is_err());
    assert!(mcp_bridge::parse_acp_mcp_servers(&json!({ "mcpServers": [{}] })).is_err());
}

#[test]
fn session_list_filters_by_cwd_paginates_and_validates_cursor() {
    let _guard = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().unwrap();
    let prev = std::env::var_os("RAYU_HOME");
    crate::env::set_var("RAYU_HOME", temp.path());

    let active = vec![
        sessions::ListedSession {
            session_id: "ses_a".into(),
            cwd: "/workspace/alpha".into(),
            title: Some("Alpha 1".into()),
            updated_at_ms: 1_700_000_003_000,
        },
        sessions::ListedSession {
            session_id: "ses_b".into(),
            cwd: "/workspace/alpha".into(),
            title: Some("Alpha 2".into()),
            updated_at_ms: 1_700_000_002_000,
        },
        sessions::ListedSession {
            session_id: "ses_c".into(),
            cwd: "/workspace/beta".into(),
            title: Some("Beta 1".into()),
            updated_at_ms: 1_700_000_001_000,
        },
    ];

    // Paginate all sessions with page size 2.
    let page1 = sessions::list_sessions(None, None, &active, 2).unwrap();
    assert_eq!(page1["sessions"].as_array().unwrap().len(), 2);
    assert_eq!(page1["sessions"][0]["sessionId"], "ses_a");
    assert_eq!(page1["sessions"][1]["sessionId"], "ses_b");
    assert_eq!(page1["nextCursor"], "2");

    let page2 = sessions::list_sessions(None, Some("2"), &active, 2).unwrap();
    assert_eq!(page2["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(page2["sessions"][0]["sessionId"], "ses_c");
    assert!(page2.get("nextCursor").is_none());

    // Filter by cwd.
    let filtered =
        sessions::list_sessions(Some(Path::new("/workspace/alpha")), None, &active, 10).unwrap();
    let ids: Vec<&str> = filtered["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["sessionId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["ses_a", "ses_b"]);

    // Reject invalid cursor.
    let (code, _) = sessions::list_sessions(None, Some("not-a-cursor"), &active, 10).unwrap_err();
    assert_eq!(code, JSONRPC_INVALID_PARAMS);

    match prev {
        Some(val) => crate::env::set_var("RAYU_HOME", val),
        None => crate::env::remove_var("RAYU_HOME"),
    }
}

#[test]
fn session_delete_rejects_traversal_and_removes_persisted_files() {
    let _guard = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().unwrap();
    let prev = std::env::var_os("RAYU_HOME");
    crate::env::set_var("RAYU_HOME", temp.path());

    assert!(sessions::validate_session_id_for_fs("../etc/passwd").is_err());
    assert!(sessions::validate_session_id_for_fs("a/b").is_err());
    assert!(sessions::validate_session_id_for_fs("").is_err());

    let sessions_dir = temp.path().join("sessions");
    let todos_dir = temp.path().join("todos");
    std::fs::create_dir_all(&sessions_dir).unwrap();
    std::fs::create_dir_all(&todos_dir).unwrap();
    let json_path = sessions_dir.join("ses_del_1.json");
    let journal_path = sessions_dir.join("ses_del_1.journal.jsonl");
    let bak_path = sessions_dir.join("ses_del_1.bak");
    let todo_path = todos_dir.join("ses_del_1.json");
    let plan_path = todos_dir.join("ses_del_1-plan.json");
    std::fs::write(&json_path, r#"{"id":"ses_del_1"}"#).unwrap();
    std::fs::write(&journal_path, "").unwrap();
    std::fs::write(&bak_path, "").unwrap();
    std::fs::write(&todo_path, "[]").unwrap();
    std::fs::write(&plan_path, "{}").unwrap();

    sessions::delete_persisted_session("ses_del_1").unwrap();
    assert!(!json_path.exists());
    assert!(!journal_path.exists());
    assert!(!bak_path.exists());
    assert!(!todo_path.exists());
    assert!(!plan_path.exists());

    match prev {
        Some(val) => crate::env::set_var("RAYU_HOME", val),
        None => crate::env::remove_var("RAYU_HOME"),
    }
}

#[cfg(unix)]
#[tokio::test]
async fn bidirectional_permission_prompt_set_mode_and_streaming_end_to_end() {
    use tokio::io::duplex;

    // Pair 1: ACP client <-> AcpRuntime (bidirectional JSON-RPC 2.0)
    let (client_in, runtime_out) = duplex(64 * 1024);
    let (runtime_in, mut client_out) = duplex(64 * 1024);

    // Pair 2: AcpRuntime DaemonSession <-> Mock Rayu daemon
    let (daemon_client_side, daemon_server_side) = tokio::net::UnixStream::pair().unwrap();
    let (daemon_r, daemon_w) = daemon_client_side.into_split();

    let runtime = AcpRuntime::with_writer(
        runtime_out,
        AcpProfile::Standard,
        ProviderChoice::Claude,
        None,
        None,
    );

    // Pre-register a mock daemon session directly on the runtime so no live daemon is needed.
    let session = DaemonSession::new("ses_bidir".to_string(), daemon_r, daemon_w, 10)
        .with_working_dir(PathBuf::from("/workspace"))
        .with_ui_state(SessionUiState {
            provider_name: Some("rayu".to_string()),
            model: Some("claude-sonnet-4-6".to_string()),
            available_models: vec!["claude-sonnet-4-6".to_string()],
            reasoning_effort: Some("medium".to_string()),
            permission_mode: Some(PermissionMode::Default),
        });
    runtime
        .sessions
        .lock()
        .await
        .insert("ses_bidir".to_string(), Arc::new(session));

    let runtime_task = tokio::spawn(async move {
        runtime.run_on_io(BufReader::new(runtime_in)).await.unwrap();
    });

    // Mock daemon task: handles SetPermissionMode, then Message -> ReasoningDelta + PermissionRequest -> PermissionResponse -> TextDelta + Done.
    let daemon_task = tokio::spawn(async move {
        let (r, mut w) = daemon_server_side.into_split();
        let mut r = BufReader::new(r);
        let mut line = String::new();

        // 1. Expect SetPermissionMode(AcceptEdits)
        r.read_line(&mut line).await.unwrap();
        let req: Request = serde_json::from_str(&line).unwrap();
        let Request::SetPermissionMode { id, mode } = req else {
            panic!("expected SetPermissionMode, got {line}");
        };
        assert_eq!(mode, PermissionMode::AcceptEdits);
        w.write_all(format!("{}\n", serde_json::to_string(&ServerEvent::Ack { id }).unwrap()).as_bytes())
            .await
            .unwrap();

        // 2. Expect Message
        line.clear();
        r.read_line(&mut line).await.unwrap();
        let req: Request = serde_json::from_str(&line).unwrap();
        let Request::Message { id: prompt_id, .. } = req else {
            panic!("expected Message, got {line}");
        };
        for ev in [
            ServerEvent::Ack { id: prompt_id },
            ServerEvent::ReasoningDelta {
                text: "checking command".to_string(),
            },
            ServerEvent::ToolStart {
                id: "call_1".to_string(),
                name: "bash".to_string(),
            },
            ServerEvent::PermissionRequest {
                session_id: "ses_bidir".to_string(),
                request_id: "perm_1".to_string(),
                tool_name: "bash".to_string(),
                description: "Run `cargo test`".to_string(),
                input: json!({ "command": "cargo test" }),
                risk_tier: Some("confirm".to_string()),
            },
        ] {
            w.write_all(format!("{}\n", serde_json::to_string(&ev).unwrap()).as_bytes())
                .await
                .unwrap();
        }

        // 3. Expect PermissionResponse(AllowAlways) from ACP client!
        line.clear();
        r.read_line(&mut line).await.unwrap();
        let req: Request = serde_json::from_str(&line).unwrap();
        let Request::PermissionResponse {
            id: perm_ack_id,
            session_id,
            request_id,
            decision,
        } = req
        else {
            panic!("expected PermissionResponse, got {line}");
        };
        assert_eq!(session_id, "ses_bidir");
        assert_eq!(request_id, "perm_1");
        assert_eq!(decision, PermissionDecision::AllowAlways);

        for ev in [
            ServerEvent::Ack { id: perm_ack_id },
            ServerEvent::TextDelta {
                text: "All tests passed!".to_string(),
            },
            ServerEvent::Done { id: prompt_id },
        ] {
            w.write_all(format!("{}\n", serde_json::to_string(&ev).unwrap()).as_bytes())
                .await
                .unwrap();
        }
    });

    let mut client_reader = BufReader::new(client_in);
    let read_msg = async |reader: &mut BufReader<tokio::io::DuplexStream>| -> Value {
        let mut line = String::new();
        tokio::time::timeout(std::time::Duration::from_secs(5), reader.read_line(&mut line))
            .await
            .expect("client read timeout")
            .unwrap();
        serde_json::from_str(&line).unwrap()
    };

    // Step 1: initialize with extended profile request from Desktop
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientInfo": { "name": "rayucode-desktop", "version": "0.1.0" },
            "_meta": { "rayu": { "profile": "extended" } }
        }
    });
    client_out
        .write_all(format!("{init_req}\n").as_bytes())
        .await
        .unwrap();
    let init_resp = read_msg(&mut client_reader).await;
    assert_eq!(init_resp["id"], 1);
    assert_eq!(
        init_resp["result"]["agentCapabilities"]["_meta"]["rayu"]["profile"],
        "extended"
    );

    // Step 2: session/set_mode -> accept_edits
    let mode_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "session/set_mode",
        "params": { "sessionId": "ses_bidir", "modeId": "acceptEdits" }
    });
    client_out
        .write_all(format!("{mode_req}\n").as_bytes())
        .await
        .unwrap();
    let mode_resp = read_msg(&mut client_reader).await;
    assert_eq!(mode_resp["id"], 2);
    assert_eq!(mode_resp["result"], json!({}));
    let mode_notif = read_msg(&mut client_reader).await;
    assert_eq!(mode_notif["params"]["update"]["sessionUpdate"], "current_mode_update");
    assert_eq!(mode_notif["params"]["update"]["currentModeId"], "accept_edits");
    let cfg_notif = read_msg(&mut client_reader).await;
    assert_eq!(cfg_notif["params"]["update"]["sessionUpdate"], "config_option_update");

    // Step 3: session/prompt -> verify thought, permission request round-trip, text, end_turn
    let prompt_req = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "session/prompt",
        "params": {
            "sessionId": "ses_bidir",
            "prompt": [{ "type": "text", "text": "run cargo test" }]
        }
    });
    client_out
        .write_all(format!("{prompt_req}\n").as_bytes())
        .await
        .unwrap();

    let mut saw_thought = false;
    let mut saw_text = false;
    let mut saw_perm_request = false;
    let mut saw_rayu_ext = false;
    loop {
        let msg = read_msg(&mut client_reader).await;
        if msg.get("method").and_then(Value::as_str) == Some("_rayu/server_event") {
            saw_rayu_ext = true;
            continue;
        }
        if msg.get("method").and_then(Value::as_str) == Some("session/request_permission") {
            saw_perm_request = true;
            assert_eq!(msg["params"]["toolCall"]["toolCallId"], "call_1");
            assert_eq!(msg["params"]["toolCall"]["kind"], "execute");
            let reply = json!({
                "jsonrpc": "2.0",
                "id": msg["id"],
                "result": {
                    "outcome": { "outcome": "selected", "optionId": "allow_always" }
                }
            });
            client_out
                .write_all(format!("{reply}\n").as_bytes())
                .await
                .unwrap();
            continue;
        }
        if msg.get("method").and_then(Value::as_str) == Some("session/update") {
            match msg["params"]["update"]["sessionUpdate"].as_str() {
                Some("agent_thought_chunk") => saw_thought = true,
                Some("agent_message_chunk") => saw_text = true,
                _ => {}
            }
            continue;
        }
        if msg.get("id") == Some(&json!(3)) {
            assert_eq!(msg["result"]["stopReason"], "end_turn");
            break;
        }
    }

    assert!(saw_thought, "expected agent_thought_chunk");
    assert!(saw_perm_request, "expected session/request_permission");
    assert!(saw_text, "expected agent_message_chunk");
    assert!(saw_rayu_ext, "expected _rayu/server_event in extended profile");

    drop(client_out);
    daemon_task.await.unwrap();
    runtime_task.await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn request_split_returns_forked_session_id() {
    let (client, server) = tokio::net::UnixStream::pair().unwrap();
    let (r, w) = client.into_split();
    let session = DaemonSession::new("ses_parent".into(), r, w, 5);

    let daemon = tokio::spawn(async move {
        let (sr, mut sw) = server.into_split();
        let mut sr = BufReader::new(sr);
        let mut line = String::new();
        sr.read_line(&mut line).await.unwrap();
        let Request::Split { id } = serde_json::from_str(&line).unwrap() else {
            panic!("expected Split request");
        };
        let resp = ServerEvent::SplitResponse {
            id,
            new_session_id: "ses_child_fork".into(),
            new_session_name: "forked".into(),
        };
        sw.write_all(format!("{}\n", serde_json::to_string(&resp).unwrap()).as_bytes())
            .await
            .unwrap();
    });

    let child_id = request_split(&session).await.unwrap();
    assert_eq!(child_id, "ses_child_fork");
    daemon.await.unwrap();
}

#[tokio::test]
async fn authenticate_validates_method_id_and_missing_key() {
    let (code, _) = auth::execute_authenticate(&json!({})).await.unwrap_err();
    assert_eq!(code, JSONRPC_INVALID_PARAMS);

    let (code, _) = auth::execute_authenticate(&json!({ "methodId": "unsupported" }))
        .await
        .unwrap_err();
    assert_eq!(code, JSONRPC_INVALID_PARAMS);
}

#[cfg(unix)]
#[tokio::test]
async fn attach_existing_session_rejects_missing_session_instead_of_silently_creating() {
    let (client, server) = tokio::net::UnixStream::pair().unwrap();
    let (reader, writer) = client.into_split();
    let daemon = tokio::spawn(async move {
        let (sr, mut sw) = server.into_split();
        let mut sr = BufReader::new(sr);
        let mut line = String::new();
        sr.read_line(&mut line).await.unwrap();
        let Request::Subscribe { id, .. } = serde_json::from_str(&line).unwrap() else {
            panic!("expected Subscribe");
        };
        // Simulate daemon falling back to creating a fresh session (Done without matching History).
        let done = ServerEvent::Done { id };
        sw.write_all(format!("{}\n", serde_json::to_string(&done).unwrap()).as_bytes())
            .await
            .unwrap();
    });

    let runtime = AcpRuntime::new(AcpProfile::Standard, ProviderChoice::Claude, None, None);
    let err = runtime
        .attach_existing_session_connected(
            "does_not_exist".into(),
            PathBuf::from("/tmp"),
            true,
            reader,
            writer,
        )
        .await
        .err()
        .expect("attaching a missing session must fail");
    assert!(err.to_string().contains("not found"));
    daemon.await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn session_cancel_immediately_unblocks_pending_permission_with_deny() {
    use tokio::io::duplex;

    let (client_in, runtime_out) = duplex(64 * 1024);
    let (runtime_in, mut client_out) = duplex(64 * 1024);
    let (daemon_client_side, daemon_server_side) = tokio::net::UnixStream::pair().unwrap();
    let (daemon_r, daemon_w) = daemon_client_side.into_split();

    let runtime = AcpRuntime::with_writer(
        runtime_out,
        AcpProfile::Standard,
        ProviderChoice::Claude,
        None,
        None,
    );
    let session = DaemonSession::new("ses_cancel".into(), daemon_r, daemon_w, 10)
        .with_working_dir(PathBuf::from("/workspace"));
    runtime
        .sessions
        .lock()
        .await
        .insert("ses_cancel".into(), Arc::new(session));

    let runtime_task = tokio::spawn(async move {
        runtime.run_on_io(BufReader::new(runtime_in)).await.unwrap();
    });

    let daemon_task = tokio::spawn(async move {
        let (sr, mut sw) = daemon_server_side.into_split();
        let mut sr = BufReader::new(sr);
        let mut line = String::new();

        // Receive Message, emit Ack + PermissionRequest.
        sr.read_line(&mut line).await.unwrap();
        let Request::Message { id: prompt_id, .. } = serde_json::from_str(&line).unwrap() else {
            panic!("expected Message");
        };
        for ev in [
            ServerEvent::Ack { id: prompt_id },
            ServerEvent::PermissionRequest {
                session_id: "ses_cancel".into(),
                request_id: "perm_cancel".into(),
                tool_name: "bash".into(),
                description: "Run dangerous cmd".into(),
                input: json!({ "command": "rm -rf /tmp/x" }),
                risk_tier: Some("confirm".into()),
            },
        ] {
            sw.write_all(format!("{}\n", serde_json::to_string(&ev).unwrap()).as_bytes())
                .await
                .unwrap();
        }

        // Expect BOTH Cancel and PermissionResponse(Deny) (in either order).
        let mut saw_deny = false;
        let mut saw_cancel = false;
        while !(saw_deny && saw_cancel) {
            line.clear();
            sr.read_line(&mut line).await.unwrap();
            match serde_json::from_str::<Request>(&line).unwrap() {
                Request::PermissionResponse {
                    id,
                    decision: PermissionDecision::Deny,
                    ..
                } => {
                    saw_deny = true;
                    let ack = ServerEvent::Ack { id };
                    sw.write_all(format!("{}\n", serde_json::to_string(&ack).unwrap()).as_bytes())
                        .await
                        .unwrap();
                }
                Request::Cancel { .. } => {
                    saw_cancel = true;
                }
                other => panic!("unexpected daemon request: {}", serde_json::to_string(&other).unwrap()),
            }
        }
        for ev in [ServerEvent::Interrupted, ServerEvent::Done { id: prompt_id }] {
            sw.write_all(format!("{}\n", serde_json::to_string(&ev).unwrap()).as_bytes())
                .await
                .unwrap();
        }
    });

    let mut client_reader = BufReader::new(client_in);
    let read_msg = async |reader: &mut BufReader<tokio::io::DuplexStream>| -> Value {
        let mut line = String::new();
        tokio::time::timeout(std::time::Duration::from_secs(5), reader.read_line(&mut line))
            .await
            .expect("client read timeout")
            .unwrap();
        serde_json::from_str(&line).unwrap()
    };

    // Start prompt; when permission prompt arrives, send session/cancel notification instead of replying!
    let prompt_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": {
            "sessionId": "ses_cancel",
            "prompt": [{ "type": "text", "text": "do risky thing" }]
        }
    });
    client_out
        .write_all(format!("{prompt_req}\n").as_bytes())
        .await
        .unwrap();

    let perm_req = read_msg(&mut client_reader).await;
    assert_eq!(perm_req["method"], "session/request_permission");

    let cancel_notif = json!({
        "jsonrpc": "2.0",
        "method": "session/cancel",
        "params": { "sessionId": "ses_cancel" }
    });
    client_out
        .write_all(format!("{cancel_notif}\n").as_bytes())
        .await
        .unwrap();

    let prompt_resp = read_msg(&mut client_reader).await;
    assert_eq!(prompt_resp["id"], 1);
    assert_eq!(prompt_resp["result"]["stopReason"], "cancelled");

    drop(client_out);
    daemon_task.await.unwrap();
    runtime_task.await.unwrap();
}
