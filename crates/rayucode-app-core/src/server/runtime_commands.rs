//! Runtime-backed slash command execution. No command becomes an agent prompt.
use crate::agent::Agent;
use anyhow::{Result, bail};
use rayucode_harness_api::RuntimeCommand;
use serde_json::{Value, json};

pub(super) fn boolean_action(
    args: &[String],
    current: bool,
    toggle_empty: bool,
) -> Result<Option<bool>> {
    match args {
        [] if toggle_empty => Ok(Some(!current)),
        [] => Ok(None),
        [arg] => match arg.to_ascii_lowercase().as_str() {
            "status" | "show" => Ok(None),
            "on" | "enable" | "enabled" => Ok(Some(true)),
            "off" | "disable" | "disabled" => Ok(Some(false)),
            "toggle" => Ok(Some(!current)),
            _ => bail!("Expected on, off, toggle, or status"),
        },
        _ => bail!("Expected at most one argument"),
    }
}

fn status_only(args: &[String]) -> Result<()> {
    match args {
        [] => Ok(()),
        [arg] if matches!(arg.as_str(), "status" | "show" | "stats") => Ok(()),
        _ => bail!("This command accepts only status, show, or stats"),
    }
}

/// Live Rayu credits and plan status. Shared by the agent-backed executor and
/// the lightweight server control path so both render the same account data.
pub(super) async fn rayu_credits_data() -> Result<Value> {
    if !crate::rayu::has_credentials() {
        return Ok(json!({
            "configured": false,
            "source": "local",
            "auth_method": "none",
            "user": Value::Null,
            "message": "Log in to Rayu to fetch live credits and plan status."
        }));
    }
    let credential = crate::rayu::gateway_credential()
        .await
        .ok_or_else(|| anyhow::anyhow!("No Rayu credential is available"))?;
    let auth_method = match crate::rayu::RayuAuthKind::from_credential(&credential) {
        crate::rayu::RayuAuthKind::AccountJwt => "oauth",
        crate::rayu::RayuAuthKind::ApiKey => "api_key",
        crate::rayu::RayuAuthKind::Unknown => "none",
    };
    let credits = crate::rayu::fetch_credits(&credential).await?;
    let user = if auth_method == "oauth" {
        crate::rayu::read_session().map(|session| {
            json!({
                "id": session.user.id,
                "display_name": session.user.display_name,
                "email": session.user.email,
                "avatar_url": session.user.avatar_url,
                "role": session.user.role,
            })
        })
    } else {
        None
    };
    Ok(json!({
        "configured": true,
        "source": "live",
        "auth_method": auth_method,
        "user": user,
        "credits": {
            "plan": credits.plan,
            "plan_name": credits.plan_name,
            "credits_per_period": credits.credits_per_period,
            "used_credits": credits.used_credits,
            "remaining_credits": credits.remaining_credits,
            "reset_seconds": credits.reset_seconds,
            "period_end": credits.period_end,
            "topup_balance": credits.topup_balance,
            "top_up_enabled": credits.top_up_enabled,
            "credits_per_5h": credits.credits_per_5h,
            "window_used_credits": credits.window_used_credits,
            "window_remaining_credits": credits.window_remaining_credits,
            "window_reset_seconds": credits.window_reset_seconds,
            "session_window_minutes": credits.session_window_minutes,
            "credits_per_week": credits.credits_per_week,
            "week_used_credits": credits.week_used_credits,
            "week_remaining_credits": credits.week_remaining_credits,
            "week_reset_seconds": credits.week_reset_seconds,
            "limit_mode": credits.limit_mode,
            "api_key": credits.api_key.map(|limits| json!({
                "key_id": limits.key_id,
                "credit_limit": limits.credit_limit,
                "allowed_models": limits.allowed_models,
                "rate_limit_rpm": limits.rate_limit_rpm,
            })),
        }
    }))
}

pub(super) async fn execute(
    agent: &mut Agent,
    command: RuntimeCommand,
    args: &[String],
    swarm_enabled: bool,
    swarm_data: Value,
) -> Result<(Value, String)> {
    let config = crate::config::Config::load();
    let data = match command {
        RuntimeCommand::Review | RuntimeCommand::Judge | RuntimeCommand::Subagent => {
            let role = match command {
                RuntimeCommand::Review => "review",
                RuntimeCommand::Judge => "judge",
                _ => "swarm",
            };
            let (explicit_model, label, requested) = role_args(args, role)?;
            let prompt = match command {
                RuntimeCommand::Review => format!(
                    "Independently review the current working tree changes. Inspect the diff, correctness, regressions, security and tests. Report concrete findings with file references. Do not edit files. User focus: {requested}"
                ),
                RuntimeCommand::Judge => format!(
                    "Independently judge the current implementation against the user request. Inspect actual changes and verification evidence, identify unmet acceptance criteria and missing tests. Do not edit files. User focus: {requested}"
                ),
                _ if requested.trim().is_empty() => bail!("Usage: /subagent <task>"),
                _ => requested,
            };
            let global = match command {
                RuntimeCommand::Review => config.autoreview.model.clone(),
                RuntimeCommand::Judge => config.autojudge.model.clone(),
                _ => agent.subagent_model().or(config.agents.swarm_model.clone()),
            };
            let model = explicit_model.or_else(|| {
                agent
                    .session_for_split()
                    .effective_agent_model(role, global)
            });
            let output = agent
                .registry()
                .execute(
                    "swarm",
                    json!({"action": "spawn", "label": label, "prompt": prompt, "model": model}),
                    crate::tool::ToolContext {
                        session_id: agent.session_id().into(),
                        message_id: crate::id::new_id("msg"),
                        tool_call_id: crate::id::new_id("call"),
                        working_dir: agent.working_dir().map(std::path::PathBuf::from),
                        stdin_request_tx: None,
                        graceful_shutdown_signal: None,
                        execution_mode: crate::tool::ToolExecutionMode::Direct,
                    },
                )
                .await?;
            let metadata = output
                .metadata
                .ok_or_else(|| anyhow::anyhow!("Spawn returned no structured session metadata"))?;
            return Ok((
                json!({"spawned_session_id": metadata["session_id"], "role": role, "model": model}),
                output.output,
            ));
        }
        RuntimeCommand::ProviderTestCoverage => {
            let report = if args.is_empty() {
                let (coverage, path) = crate::live_tests::load_coverage(None)?;
                let summary = crate::live_tests::strict_live_provider_model_coverage_summary(
                    &coverage,
                    path.display().to_string(),
                );
                crate::live_tests::format_strict_live_provider_model_coverage_summary(&summary, 0)
            } else {
                let model = if args.len() > 1 {
                    args[1..].join(" ")
                } else {
                    agent.provider_model()
                };
                crate::live_tests::format_provider_test_coverage_report(&args[0], &model, None)
            };
            return Ok((
                json!({"report": report, "source": "persisted_verification"}),
                report,
            ));
        }
        RuntimeCommand::RefreshModelList
        | RuntimeCommand::Continue
        | RuntimeCommand::ResumeAll
        | RuntimeCommand::ServerReload => {
            bail!("Command must be routed through the server control handler")
        }
        RuntimeCommand::Skills => {
            status_only(args)?;
            agent.registry().skills().write().await.reload_global()?;
            let data = agent.runtime_skills_snapshot();
            return Ok((data.clone(), skills_report(&data)));
        }
        RuntimeCommand::Context => {
            status_only(args)?;
            agent.runtime_context_snapshot().await
        }
        RuntimeCommand::Info => {
            status_only(args)?;
            json!({"session_id": agent.session_id(), "working_dir": agent.working_dir(),
                "provider": agent.provider_name(), "model": agent.provider_model(),
                "reasoning_effort": agent.provider_reasoning_effort(),
                "context_window": agent.provider_context_window(),
                "last_usage": agent.last_usage(), "token_usage_totals": agent.token_usage_totals(),
                "memory_enabled": agent.memory_enabled(), "swarm_enabled": swarm_enabled,
                "autoreview_enabled": agent.autoreview_enabled().unwrap_or(config.autoreview.enabled),
                "autojudge_enabled": agent.autojudge_enabled().unwrap_or(config.autojudge.enabled),
                "subagent_model": agent.subagent_model(), "transport": agent.provider_handle().transport(),
                "service_tier": agent.provider_handle().service_tier()})
        }
        RuntimeCommand::Cache => {
            match args {
                [] => {}
                [arg] if matches!(arg.as_str(), "stats" | "status" | "show") => {}
                [arg] if matches!(arg.as_str(), "extend" | "1h" | "5m") => {
                    crate::config::Config::set_anthropic_cache_ttl_1h(arg != "5m")?;
                }
                _ => bail!(
                    "Usage: /cache [stats|status|extend|1h|5m]. Cache eviction/prewarming is not available through this runtime API."
                ),
            }
            json!({"anthropic_cache_ttl": if crate::provider::anthropic::is_cache_ttl_1h() { "1h" } else { "5m" },
                "setting_scope": "Anthropic, subsequent requests only", "provider": agent.provider_name(),
                "last_usage": agent.last_usage(), "token_usage_totals": agent.token_usage_totals(),
                "expiry": null, "expiry_available": false})
        }
        RuntimeCommand::Memory => {
            if args == ["extract"] {
                if !agent.memory_enabled() {
                    bail!("Memory is disabled for this session");
                }
                let transcript = agent.build_transcript_for_extraction();
                if transcript.len() < 200 {
                    bail!("Not enough transcript for memory extraction");
                }
                crate::memory_agent::trigger_final_extraction_with_dir(
                    transcript,
                    agent.session_id().into(),
                    agent.working_dir().map(str::to_string),
                );
                return Ok((
                    json!({"scheduled": true}),
                    "Memory extraction scheduled, not yet completed.".into(),
                ));
            }
            if let Some(enabled) = boolean_action(args, agent.memory_enabled(), true)? {
                agent.set_memory_enabled(enabled);
                if !enabled {
                    crate::memory::clear_pending_memory(agent.session_id());
                }
            }
            json!({"enabled": agent.memory_enabled(), "activity": agent.debug_memory_profile(), "pipeline_active": crate::memory_agent::is_active()})
        }
        RuntimeCommand::Swarm => {
            let sub = args.first().map(String::as_str).unwrap_or("status");
            if !matches!(sub, "status" | "show" | "stats" | "list" | "board") || args.len() > 1 {
                bail!("Usage: /swarm [status|show|list|board|on|off|toggle]");
            }
            let snapshots = load_durable_swarm_snapshots_async().await;
            let members = if !swarm_data.is_null() {
                swarm_data
            } else {
                let flattened: Vec<Value> = snapshots
                    .iter()
                    .flat_map(|snap| {
                        snap["members"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default()
                    })
                    .collect();
                json!(flattened)
            };
            let board: Vec<Value> = snapshots
                .iter()
                .flat_map(|snap| {
                    snap.get("messages")
                        .or_else(|| snap.get("board"))
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                })
                .collect();
            let plans: Vec<Value> = snapshots
                .iter()
                .filter_map(|snap| snap.get("plan").cloned())
                .filter(|v| !v.is_null())
                .collect();
            json!({
                "view": sub,
                "enabled": swarm_enabled,
                "config_default": config.features.swarm,
                "default_enabled": config.features.swarm,
                "swarm_id": Value::Null,
                "role": Value::Null,
                "members": members,
                "swarms": snapshots,
                "board": board,
                "plans": plans,
            })
        }
        RuntimeCommand::Agents => {
            let (global, args) = match args.split_first() {
                Some((scope, rest)) if matches!(scope.as_str(), "global" | "default") => {
                    (true, rest)
                }
                _ => (false, args),
            };
            if let Some((first, rest)) = args.split_first()
                && matches!(first.as_str(), "profile" | "profiles")
            {
                let message = crate::agent_profiles::run(agent.session_for_split(), global, rest)?;
                return Ok((
                    json!({"scope": if global { "global" } else { "session" }, "profiles": agent.session_for_split().effective_agent_profiles()}),
                    message,
                ));
            }
            match args {
                [] => {}
                [arg]
                    if matches!(
                        arg.as_str(),
                        "show" | "status" | "swarm" | "review" | "judge" | "memory" | "ambient"
                    ) => {}
                [target, model] => {
                    let model = if model == "default" {
                        None
                    } else {
                        Some(model.clone())
                    };
                    if global {
                        crate::config::Config::set_agent_model_default(target, model.as_deref())?;
                    } else {
                        agent.set_agent_model_override(target, model.clone())?;
                    }
                    let resolved = agent
                        .session_for_split()
                        .effective_agent_model(target, None);
                    let message = format!(
                        "{target} agent model [{}] → {}{}",
                        if global { "global" } else { "session" },
                        model.as_deref().unwrap_or("default"),
                        match (&model, resolved.as_deref()) {
                            (Some(raw), Some(res)) if raw != res && !global => format!(" ({res})"),
                            _ => String::new(),
                        }
                    );
                    return Ok((
                        json!({"scope": if global { "global" } else { "session" }, "target": target, "model": model, "overrides": agent.runtime_agent_model_overrides()}),
                        message,
                    ));
                }
                _ => bail!(
                    "Usage: /agents [global] [swarm|review|judge|memory|ambient] [model|inherit]."
                ),
            }
            let config = crate::config::Config::load();
            json!({"scope": if global { "global" } else { "session" }, "defaults": {"swarm": config.agents.swarm_model, "memory": config.agents.memory_model, "review": config.autoreview.model, "judge": config.autojudge.model, "ambient": config.ambient.model}, "overrides": agent.runtime_agent_model_overrides(), "models": agent.available_models_for_switching()})
        }
        RuntimeCommand::SubagentModel => {
            match args {
                [] => {}
                [arg] if matches!(arg.as_str(), "status" | "show") => {}
                [model] => agent.set_subagent_model(if model == "default" {
                    None
                } else {
                    Some(model.clone())
                })?,
                _ => bail!("Usage: /subagent-model [show|inherit|model]"),
            }
            json!({"model": agent.subagent_model(), "configured_default": config.agents.swarm_model, "inherit_model": agent.provider_model()})
        }
        RuntimeCommand::Autoreview => {
            let current = agent
                .autoreview_enabled()
                .unwrap_or(config.autoreview.enabled);
            if let Some(enabled) = boolean_action(args, current, false)? {
                agent.set_autoreview_enabled(enabled)?;
            }
            json!({"enabled": agent.autoreview_enabled().unwrap_or(config.autoreview.enabled), "default_enabled": config.autoreview.enabled})
        }
        RuntimeCommand::Autojudge => {
            let current = agent
                .autojudge_enabled()
                .unwrap_or(config.autojudge.enabled);
            if let Some(enabled) = boolean_action(args, current, false)? {
                agent.set_autojudge_enabled(enabled)?;
            }
            json!({"enabled": agent.autojudge_enabled().unwrap_or(config.autojudge.enabled), "default_enabled": config.autojudge.enabled})
        }
        RuntimeCommand::Transport => {
            let provider = agent.provider_handle();
            match args {
                [] => {}
                [arg] if matches!(arg.as_str(), "status" | "show") => {}
                [transport] if matches!(transport.as_str(), "auto" | "https" | "websocket") => {
                    provider.set_transport(transport)?
                }
                _ => bail!("Usage: /transport [status|auto|https|websocket]"),
            }
            json!({"transport": provider.transport(), "provider": provider.display_name()})
        }
        RuntimeCommand::Fast => {
            let provider = agent.provider_handle();
            let current = provider.service_tier();
            let action = match args {
                [] => Some(if current.as_deref() == Some("priority") {
                    "off"
                } else {
                    "priority"
                }),
                [arg] if matches!(arg.as_str(), "status" | "show") => None,
                [arg] if matches!(arg.as_str(), "on" | "fast" | "priority") => Some("priority"),
                [arg] if matches!(arg.as_str(), "ultra" | "ultrafast" | "ultra-fast") => {
                    Some("ultrafast")
                }
                [arg] if matches!(arg.as_str(), "off" | "flex" | "auto") => Some(arg.as_str()),
                _ => bail!("Usage: /fast [on|ultra|off|priority|flex|auto|status]"),
            };
            if let Some(tier) = action {
                provider.set_service_tier(tier)?;
            }
            json!({"service_tier": provider.service_tier(), "provider": provider.display_name()})
        }
        RuntimeCommand::Telemetry => {
            use crate::telemetry::TelemetryCategory;
            let usage = "Usage: /telemetry [all|none] or /telemetry <content|usage|crashes|features|cost|accounts> on|off";
            let parse_on = |v: &str| match v {
                "on" | "yes" | "true" | "1" => Some(true),
                "off" | "no" | "false" | "0" => Some(false),
                _ => None,
            };
            let mut checked = crate::telemetry::category_settings();
            let changed = match args {
                [] => false,
                [arg] if matches!(arg.as_str(), "show" | "status") => false,
                [arg] if matches!(arg.as_str(), "everything" | "all" | "on") => {
                    checked = [true; 6];
                    true
                }
                [arg] if matches!(arg.as_str(), "nothing" | "none" | "off") => {
                    checked = [false; 6];
                    true
                }
                [key, value] => {
                    let (Some(category), Some(on)) =
                        (TelemetryCategory::from_key(key), parse_on(value))
                    else {
                        bail!("{usage}");
                    };
                    if let Some(i) = TelemetryCategory::ALL.iter().position(|c| *c == category) {
                        checked[i] = on;
                    }
                    true
                }
                _ => bail!("{usage}"),
            };
            if changed {
                if checked.iter().any(|on| *on) && crate::telemetry::opt_out_forced_by_env() {
                    bail!("Telemetry is forced off by the runtime environment");
                }
                crate::telemetry::set_category_settings(checked);
            }
            let status = crate::telemetry::status();
            let categories: serde_json::Map<String, serde_json::Value> = TelemetryCategory::ALL
                .into_iter()
                .map(|c| (c.key().to_string(), json!(c.enabled())))
                .collect();
            json!({"enabled": status.enabled, "content_sharing_enabled": status.content_sharing_enabled, "categories": categories, "opt_out_source": status.opt_out_source.map(|source| source.as_str())})
        }
        RuntimeCommand::Subscription => {
            status_only(args)?;
            rayu_credits_data().await?
        }
        RuntimeCommand::Overnight
        | RuntimeCommand::Productivity
        | RuntimeCommand::Initiatives
        | RuntimeCommand::Premium
        | RuntimeCommand::Remote
        | RuntimeCommand::Auth
        | RuntimeCommand::Logout
        | RuntimeCommand::Background
        | RuntimeCommand::Mcp
        | RuntimeCommand::Telegram
        | RuntimeCommand::Features
        | RuntimeCommand::Doctor
        | RuntimeCommand::SessionSearch
        | RuntimeCommand::Schedules
        | RuntimeCommand::Ambient => {
            return super::runtime_special_commands::execute(agent, command, args).await;
        }
    };
    let message = serde_json::to_string_pretty(&data)?;
    Ok((data, message))
}

pub(super) async fn load_durable_swarm_snapshots_async() -> Vec<Value> {
    tokio::task::spawn_blocking(load_durable_swarm_snapshots)
        .await
        .unwrap_or_default()
}

fn load_durable_swarm_snapshots() -> Vec<Value> {
    let dir = if let Ok(runtime) = std::env::var("RAYU_RUNTIME_DIR")
        && !runtime.is_empty()
    {
        std::path::PathBuf::from(runtime).join("durable-state").join("swarm")
    } else if let Ok(rayu_dir) = crate::storage::rayu_dir() {
        rayu_dir.join("state").join("swarm")
    } else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut paths: Vec<std::path::PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    paths.sort();
    let mut snapshots = Vec::new();
    for path in paths {
        if let Ok(content) = std::fs::read_to_string(&path)
            && let Ok(value) = serde_json::from_str::<Value>(&content)
        {
            snapshots.push(value);
        }
    }
    snapshots
}

fn role_args(args: &[String], default_label: &str) -> Result<(Option<String>, String, String)> {
    let mut model = None;
    let mut label = default_label.to_string();
    let mut index = 0;
    if let Some(first) = args.first()
        && let Some((provider, _)) = first.split_once(':')
        && matches!(
            provider,
            "openai"
                | "openai-api"
                | "claude"
                | "anthropic"
                | "openrouter"
                | "gemini"
                | "copilot"
                | "cursor"
                | "bedrock"
                | "azure"
                | "grok"
        )
    {
        model = Some(first.clone());
        index = 1;
    }
    while let Some(arg) = args.get(index) {
        match arg.as_str() {
            "--model" | "--type" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for {arg}"))?;
                if arg == "--model" {
                    model = Some(value.clone());
                } else {
                    label = value.clone();
                }
                index += 2;
            }
            "--continue" => bail!(
                "Resuming an existing subagent is unavailable here. Use the swarm resume command for that session."
            ),
            flag if flag.starts_with("--") => bail!("Unknown role launch option {flag}"),
            _ => break,
        }
    }
    Ok((model, label, args[index..].join(" ")))
}

fn skills_report(data: &Value) -> String {
    let mut report = String::from("## Loaded skills\n\n");
    let loaded = data["skills"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    if loaded.is_empty() {
        report.push_str("No skills loaded. Add skills under `~/.rayu/skills/<name>/SKILL.md` or the workspace `.rayu/skills`.\n");
    }
    for skill in loaded {
        let name = skill["name"].as_str().unwrap_or("");
        let active = if data["active_skill"].as_str() == Some(name) {
            " (active)"
        } else {
            ""
        };
        report.push_str(&format!(
            "- **/{name}{active}**: {}\n  Path: `{}`\n",
            skill["description"].as_str().unwrap_or(""),
            skill["path"].as_str().unwrap_or("")
        ));
    }
    report.push_str("\n## Endorsed skills (recommended by Rayu)\n\n");
    for skill in data["endorsed"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        report.push_str(&format!(
            "- **/{}** [{}]: {}\n  Category: {}. Source: {}\n",
            skill["name"].as_str().unwrap_or(""),
            if skill["installed"] == true {
                "installed"
            } else {
                "not installed"
            },
            skill["description"].as_str().unwrap_or(""),
            skill["category"].as_str().unwrap_or(""),
            skill["source"].as_str().unwrap_or("")
        ));
        if skill["installed"] != true
            && let Some(install) = skill["install"].as_str()
        {
            report.push_str(&format!("  Install: `{install}`\n"));
        }
    }
    report.push_str("\nActivate a loaded skill using its slash command. Manage skills with the `skill_manage` tool.\n");
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Default)]
    struct NoInferenceProvider {
        tier: std::sync::Mutex<Option<String>>,
    }
    #[async_trait::async_trait]
    impl crate::provider::Provider for NoInferenceProvider {
        async fn complete(
            &self,
            _: &[crate::message::Message],
            _: &[crate::message::ToolDefinition],
            _: &str,
            _: Option<&str>,
        ) -> Result<crate::provider::EventStream> {
            panic!("Runtime status commands must never invoke a provider");
        }
        fn name(&self) -> &str {
            "test"
        }
        fn fork(&self) -> Arc<dyn crate::provider::Provider> {
            Arc::new(Self::default())
        }
        fn service_tier(&self) -> Option<String> {
            self.tier.lock().unwrap().clone()
        }
        fn set_service_tier(&self, tier: &str) -> Result<()> {
            *self.tier.lock().unwrap() = if tier == "off" {
                None
            } else {
                Some(tier.into())
            };
            Ok(())
        }
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn runtime_commands_read_actual_state_without_inference() {
        let _lock = crate::storage::lock_test_env();
        let home = tempfile::TempDir::new().unwrap();
        let old = std::env::var_os("RAYU_HOME");
        crate::env::set_var("RAYU_HOME", home.path());
        struct Restore(Option<std::ffi::OsString>);
        impl Drop for Restore {
            fn drop(&mut self) {
                if let Some(value) = &self.0 {
                    crate::env::set_var("RAYU_HOME", value);
                } else {
                    crate::env::remove_var("RAYU_HOME");
                }
            }
        }
        let _restore = Restore(old);
        let provider: Arc<dyn crate::provider::Provider> = Arc::new(NoInferenceProvider::default());
        let registry = crate::tool::Registry::new(provider.clone()).await;
        let mut agent =
            Agent::new_with_initial_working_dir(provider, registry, home.path().to_str());
        for command in [
            RuntimeCommand::Skills,
            RuntimeCommand::Context,
            RuntimeCommand::Info,
            RuntimeCommand::Cache,
            RuntimeCommand::Memory,
            RuntimeCommand::Agents,
            RuntimeCommand::SubagentModel,
            RuntimeCommand::Autoreview,
            RuntimeCommand::Autojudge,
            RuntimeCommand::Transport,
            RuntimeCommand::Fast,
            RuntimeCommand::Telemetry,
        ] {
            let (data, message) =
                execute(&mut agent, command, &["status".into()], true, Value::Null)
                    .await
                    .unwrap();
            assert!(data.is_object(), "{command:?}");
            assert!(!message.is_empty(), "{command:?}");
            if command == RuntimeCommand::Skills {
                assert!(
                    data["endorsed"]
                        .as_array()
                        .is_some_and(|skills| !skills.is_empty())
                );
                assert!(message.contains("Endorsed skills"));
            }
            if command == RuntimeCommand::Context {
                assert!(data.get("messages").is_some());
                assert!(data["system_prompt"]["pending_memory_included"] == false);
                let breakdown = data.get("token_breakdown").expect("token_breakdown present");
                assert!(breakdown.get("system").is_some());
                assert!(breakdown.get("tools").is_some());
                assert!(breakdown.get("memory").is_some());
                assert!(breakdown.get("files").is_some());
                assert!(breakdown.get("messages").is_some());
                assert!(breakdown.get("free").is_some());
            }
        }
        // Test v1.14 runtime commands and enriched Swarm/Overnight without inference.
        for (command, cmd_args) in [
            (RuntimeCommand::Background, vec!["list".into()]),
            (RuntimeCommand::Mcp, vec!["list".into()]),
            (RuntimeCommand::Telegram, vec!["status".into()]),
            (RuntimeCommand::Telegram, vec!["approvals".into()]),
            (RuntimeCommand::Telegram, vec!["uninstall".into(), "status".into()]),
            (RuntimeCommand::Features, vec!["status".into()]),
            (RuntimeCommand::Doctor, vec!["auth".into()]),
            (RuntimeCommand::Doctor, vec!["providers".into()]),
            (RuntimeCommand::SessionSearch, vec!["test-query".into()]),
            (RuntimeCommand::Schedules, vec!["list".into()]),
            (RuntimeCommand::Ambient, vec!["status".into()]),
            (RuntimeCommand::Ambient, vec!["approvals".into()]),
            (RuntimeCommand::Swarm, vec!["list".into()]),
            (RuntimeCommand::Swarm, vec!["board".into()]),
            (RuntimeCommand::Overnight, vec!["list".into()]),
        ] {
            let (data, message) = execute(&mut agent, command, &cmd_args, true, Value::Null)
                .await
                .unwrap_or_else(|e| panic!("command {command:?} {cmd_args:?} failed: {e:#}"));
            assert!(data.is_object(), "{command:?}");
            assert!(!message.is_empty(), "{command:?}");
        }

        // Verify Features::set persists to config.toml under temp RAYU_HOME.
        let (feat_data, _) = execute(
            &mut agent,
            RuntimeCommand::Features,
            &["set".into(), "mermaid".into(), "false".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(feat_data["key"], "mermaid");
        assert_eq!(feat_data["features"]["mermaid"], false);
        let (feat_status, _) = execute(
            &mut agent,
            RuntimeCommand::Features,
            &["status".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(feat_status["features"]["mermaid"], false);

        // Verify Schedules create -> list -> cancel roundtrip.
        let (created, _) = execute(
            &mut agent,
            RuntimeCommand::Schedules,
            &["create".into(), "30".into(), "Check build health".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        let sched_id = created["schedule"]["id"].as_str().unwrap().to_string();
        let (listed, _) = execute(
            &mut agent,
            RuntimeCommand::Schedules,
            &["list".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(listed["count"], 1);
        let (cancelled, _) = execute(
            &mut agent,
            RuntimeCommand::Schedules,
            &["cancel".into(), sched_id],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(cancelled["cancelled"], true);
        execute(
            &mut agent,
            RuntimeCommand::Autoreview,
            &["on".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(agent.autoreview_enabled(), Some(true));
        execute(
            &mut agent,
            RuntimeCommand::Autojudge,
            &["off".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(agent.autojudge_enabled(), Some(false));
        execute(
            &mut agent,
            RuntimeCommand::Agents,
            &["review".into(), "inherit".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(agent.runtime_agent_model_overrides()["review"], "inherit");
        for alias in ["ultra", "ultrafast", "ultra-fast"] {
            let (data, _) = execute(
                &mut agent,
                RuntimeCommand::Fast,
                &[alias.into()],
                true,
                Value::Null,
            )
            .await
            .unwrap();
            assert_eq!(data["service_tier"], "ultrafast");
            assert_eq!(
                agent.provider_handle().service_tier().as_deref(),
                Some("ultrafast")
            );
        }
        agent.provider_handle().set_service_tier("off").unwrap();
        execute(&mut agent, RuntimeCommand::Fast, &[], true, Value::Null)
            .await
            .unwrap();
        assert_eq!(
            agent.provider_handle().service_tier().as_deref(),
            Some("priority")
        );
        execute(&mut agent, RuntimeCommand::Fast, &[], true, Value::Null)
            .await
            .unwrap();
        assert_eq!(agent.provider_handle().service_tier(), None);
        assert!(
            execute(&mut agent, RuntimeCommand::Subagent, &[], true, Value::Null)
                .await
                .is_err()
        );
        assert!(
            execute(
                &mut agent,
                RuntimeCommand::Transport,
                &["typo".into()],
                true,
                Value::Null
            )
            .await
            .is_err()
        );
    }
    #[test]
    fn toggle_and_status_are_distinct() {
        assert_eq!(boolean_action(&[], true, true).unwrap(), Some(false));
        assert_eq!(
            boolean_action(&["status".into()], true, true).unwrap(),
            None
        );
        assert_eq!(boolean_action(&[], false, false).unwrap(), None);
        assert!(boolean_action(&["typo".into()], false, false).is_err());
        assert!(boolean_action(&["on".into(), "off".into()], false, false).is_err());
    }
    #[test]
    fn role_arguments_preserve_model_and_task_and_reject_unsupported_resume() {
        let args = [
            "--model",
            "openai:gpt-5",
            "--type",
            "research",
            "inspect",
            "code",
        ]
        .map(str::to_string);
        assert_eq!(
            role_args(&args, "swarm").unwrap(),
            (
                Some("openai:gpt-5".into()),
                "research".into(),
                "inspect code".into()
            )
        );
        let args = ["openai:gpt-5", "inspect", "code"].map(str::to_string);
        assert_eq!(
            role_args(&args, "review").unwrap().0.as_deref(),
            Some("openai:gpt-5")
        );
        assert!(role_args(&["--model".into()], "swarm").is_err());
        assert!(role_args(&["--continue".into(), "session".into()], "swarm").is_err());
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn rayu_credits_data_reports_auth_method_user_and_pacing_windows() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let _lock = crate::storage::lock_test_env();
        let temp = tempfile::TempDir::new().unwrap();
        let keys = [
            "RAYU_AUTH_CONFIG_DIR",
            "RAYU_HOME",
            "RAYU_CONFIG_DIR",
            "RAYU_API_KEY",
            "RAYU_GATEWAY_URL",
        ];
        let saved: Vec<(&str, Option<std::ffi::OsString>)> = keys
            .iter()
            .map(|key| (*key, std::env::var_os(key)))
            .collect();
        struct RestoreEnv(Vec<(&'static str, Option<std::ffi::OsString>)>);
        impl Drop for RestoreEnv {
            fn drop(&mut self) {
                for (key, value) in &self.0 {
                    match value {
                        Some(val) => crate::env::set_var(key, val),
                        None => crate::env::remove_var(key),
                    }
                }
            }
        }
        let _restore = RestoreEnv(saved);
        for key in keys {
            crate::env::remove_var(key);
        }
        crate::env::set_var("RAYU_AUTH_CONFIG_DIR", temp.path());
        crate::env::set_var("RAYU_HOME", temp.path());

        // 1. Signed-out state reports auth_method = "none" and user = null.
        let unconfigured = rayu_credits_data().await.unwrap();
        assert_eq!(unconfigured["configured"], false);
        assert_eq!(unconfigured["source"], "local");
        assert_eq!(unconfigured["auth_method"], "none");
        assert!(unconfigured["user"].is_null());

        // Spawn a minimal loopback gateway serving GET /v1/credits twice.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let body = serde_json::to_string(&json!({
                "plan": "plus",
                "planName": "Plus",
                "creditsPerPeriod": 5000.0,
                "usedCredits": 1250.5,
                "remainingCredits": 3749.5,
                "resetSeconds": 86400,
                "periodEnd": "2026-12-01T00:00:00Z",
                "topupBalance": 250.0,
                "topUpEnabled": true,
                "creditsPer5h": 500.0,
                "windowUsedCredits": 120.0,
                "windowRemainingCredits": 380.0,
                "windowResetSeconds": 7200,
                "sessionWindowMinutes": 300,
                "creditsPerWeek": 2000.0,
                "weekUsedCredits": 600.0,
                "weekRemainingCredits": 1400.0,
                "weekResetSeconds": 259200,
                "limitMode": "gated",
                "apiKey": {
                    "keyId": 99,
                    "creditLimit": 1000.0,
                    "allowedModels": ["claude-sonnet-4"],
                    "rateLimitRpm": 60
                }
            }))
            .unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                socket.write_all(response.as_bytes()).await.unwrap();
                let _ = socket.shutdown().await;
            }
        });
        crate::env::set_var("RAYU_GATEWAY_URL", format!("http://{addr}"));

        // 2. OAuth session reports auth_method = "oauth", full user profile, and pacing windows.
        let session = crate::rayu::RayuSession {
            access_token: "jwt-access-token".into(),
            refresh_token: "jwt-refresh-token".into(),
            expires_at: chrono::Utc::now().timestamp_millis() + 3_600_000,
            user: crate::rayu::RayuSessionUser {
                id: 42,
                email: Some("alice@example.invalid".into()),
                display_name: Some("Alice".into()),
                avatar_url: Some("https://example.invalid/alice.png".into()),
                role: "member".into(),
            },
        };
        crate::rayu::write_session(&session).unwrap();
        let oauth_data = rayu_credits_data().await.unwrap();
        assert_eq!(oauth_data["configured"], true);
        assert_eq!(oauth_data["source"], "live");
        assert_eq!(oauth_data["auth_method"], "oauth");
        assert_eq!(oauth_data["user"]["id"], 42);
        assert_eq!(oauth_data["user"]["display_name"], "Alice");
        assert_eq!(oauth_data["user"]["email"], "alice@example.invalid");
        assert_eq!(
            oauth_data["user"]["avatar_url"],
            "https://example.invalid/alice.png"
        );
        assert_eq!(oauth_data["user"]["role"], "member");
        assert_eq!(oauth_data["credits"]["plan"], "plus");
        assert_eq!(oauth_data["credits"]["credits_per_5h"], 500.0);
        assert_eq!(oauth_data["credits"]["window_used_credits"], 120.0);
        assert_eq!(oauth_data["credits"]["window_remaining_credits"], 380.0);
        assert_eq!(oauth_data["credits"]["window_reset_seconds"], 7200);
        assert_eq!(oauth_data["credits"]["session_window_minutes"], 300);
        assert_eq!(oauth_data["credits"]["credits_per_week"], 2000.0);
        assert_eq!(oauth_data["credits"]["week_used_credits"], 600.0);
        assert_eq!(oauth_data["credits"]["week_remaining_credits"], 1400.0);
        assert_eq!(oauth_data["credits"]["week_reset_seconds"], 259200);

        // 3. API-key-only auth reports auth_method = "api_key" and user = null.
        crate::rayu::clear_session();
        crate::env::set_var("RAYU_API_KEY", "rayu_sk_live_credits_test_key");
        let apikey_data = rayu_credits_data().await.unwrap();
        assert_eq!(apikey_data["configured"], true);
        assert_eq!(apikey_data["auth_method"], "api_key");
        assert!(apikey_data["user"].is_null());
        assert_eq!(apikey_data["credits"]["api_key"]["key_id"], 99);
        assert_eq!(apikey_data["credits"]["credits_per_5h"], 500.0);
        assert_eq!(apikey_data["credits"]["credits_per_week"], 2000.0);

        server.await.unwrap();
    }
}
