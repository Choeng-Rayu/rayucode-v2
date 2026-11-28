//! Runtime-backed slash command execution. No command becomes an agent prompt.
use std::sync::Arc;

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
            let (working_dir, clean_args) =
                strip_working_dir_arg(args, agent.working_dir().map(std::path::Path::new))?;
            let sub = clean_args
                .first()
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_else(|| "list".to_string());
            match sub.as_str() {
                "list" | "status" | "show" | "stats" => {
                    if clean_args.len() > 1 {
                        bail!("Usage: /skills [list|enable <name>|disable <name>|toggle <name>] [--working-dir <path>]");
                    }
                }
                "enable" | "disable" | "toggle" => {
                    let Some(name) = clean_args.get(1).filter(|s| !s.trim().is_empty()) else {
                        bail!("Usage: /skills {sub} <skill_name>");
                    };
                    match sub.as_str() {
                        "enable" => {
                            crate::config::Config::set_skill_disabled(name, false)?;
                        }
                        "disable" => {
                            crate::config::Config::set_skill_disabled(name, true)?;
                        }
                        _ => {
                            crate::config::Config::toggle_skill_disabled(name)?;
                        }
                    }
                }
                _ => bail!(
                    "Usage: /skills [list|enable <name>|disable <name>|toggle <name>] [--working-dir <path>]"
                ),
            }
            agent.registry().skills().write().await.reload_global()?;
            let active_skill = agent.active_skill().map(str::to_string);
            let data = tokio::task::spawn_blocking(move || {
                skills_snapshot_for_dir(working_dir.as_deref(), active_skill.as_deref())
            })
            .await??;
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
            let (working_dir, clean_args) =
                strip_working_dir_arg(args, agent.working_dir().map(std::path::Path::new))?;
            if clean_args
                .first()
                .is_some_and(|s| s.eq_ignore_ascii_case("list"))
            {
                let enabled = agent.memory_enabled();
                let data = tokio::task::spawn_blocking(move || {
                    memory_list_snapshot(working_dir.as_deref(), enabled, "session")
                })
                .await??;
                let message = serde_json::to_string_pretty(&data)?;
                return Ok((data, message));
            }
            if clean_args == ["extract"] {
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
            if let Some(enabled) = boolean_action(&clean_args, agent.memory_enabled(), true)? {
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
                return Ok((agents_snapshot_json(agent, global), message));
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
                    let mut snapshot = agents_snapshot_json(agent, global);
                    if let Some(obj) = snapshot.as_object_mut() {
                        obj.insert("target".into(), json!(target));
                        obj.insert("model".into(), json!(model));
                    }
                    return Ok((snapshot, message));
                }
                _ => bail!(
                    "Usage: /agents [global] [swarm|review|judge|memory|ambient] [model|inherit]."
                ),
            }
            agents_snapshot_json(agent, global)
        }
        RuntimeCommand::SubagentModel => {
            let (global, effective_args) = match args.split_first() {
                Some((scope, rest)) if matches!(scope.as_str(), "global" | "default") => {
                    (true, rest)
                }
                _ => (false, args),
            };
            match effective_args {
                [] => {}
                [arg] if matches!(arg.as_str(), "status" | "show") => {}
                [model] => {
                    let next = if is_subagent_clear_sentinel(model) {
                        None
                    } else {
                        Some(model.as_str())
                    };
                    if global {
                        crate::config::Config::set_agent_model_default("swarm", next)?;
                    } else {
                        agent.set_subagent_model(next.map(str::to_string))?;
                    }
                }
                _ => bail!("Usage: /subagent-model [global] [show|inherit|default|model]"),
            }
            let refreshed_cfg = crate::config::Config::load();
            json!({
                "model": agent.subagent_model(),
                "configured_default": refreshed_cfg.agents.swarm_model,
                "inherit_model": agent.provider_model(),
                "models": agent.available_models_for_switching(),
                "routes": agent.model_routes(),
            })
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

pub(super) struct SwarmControlContext<'a> {
    pub(super) sessions: &'a super::SessionAgents,
    pub(super) global_session_id: &'a Arc<tokio::sync::RwLock<String>>,
    pub(super) provider_template: &'a Arc<dyn crate::provider::Provider>,
    pub(super) mcp_pool: &'a Arc<crate::mcp::SharedMcpPool>,
    pub(super) swarm_members:
        &'a Arc<tokio::sync::RwLock<std::collections::HashMap<String, super::SwarmMember>>>,
    pub(super) swarms_by_id: &'a Arc<
        tokio::sync::RwLock<std::collections::HashMap<String, std::collections::HashSet<String>>>,
    >,
    pub(super) swarm_coordinators:
        &'a Arc<tokio::sync::RwLock<std::collections::HashMap<String, String>>>,
    pub(super) swarm_plans:
        &'a Arc<tokio::sync::RwLock<std::collections::HashMap<String, super::VersionedPlan>>>,
    pub(super) channel_subscriptions: &'a super::ChannelSubscriptions,
    pub(super) channel_subscriptions_by_session: &'a super::ChannelSubscriptions,
    pub(super) event_history:
        &'a Arc<tokio::sync::RwLock<std::collections::VecDeque<super::SwarmEvent>>>,
    pub(super) event_counter: &'a Arc<std::sync::atomic::AtomicU64>,
    pub(super) swarm_event_tx: &'a tokio::sync::broadcast::Sender<super::SwarmEvent>,
    pub(super) soft_interrupt_queues: &'a super::SessionInterruptQueues,
    pub(super) client_connections:
        &'a Arc<tokio::sync::RwLock<std::collections::HashMap<String, super::ClientConnectionInfo>>>,
    pub(super) swarm_mutation_runtime: &'a super::SwarmMutationRuntime,
}

fn is_subagent_clear_sentinel(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "default" | "inherit" | "reset" | "clear" | "none"
    )
}

#[derive(Debug, Default)]
struct ParsedSwarmSpawn {
    name: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    working_dir: Option<String>,
    spawn_mode: Option<crate::config::SwarmSpawnMode>,
    task: Option<String>,
}

fn parse_swarm_spawn_args(args: &[String]) -> Result<ParsedSwarmSpawn> {
    if args.len() == 1 && args[0].trim_start().starts_with('{') {
        let parsed: Value = serde_json::from_str(&args[0])
            .map_err(|e| anyhow::anyhow!("Invalid JSON payload for swarm spawn: {e}"))?;
        let name = parsed["name"]
            .as_str()
            .or_else(|| parsed["label"].as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let profile = parsed["profile"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let mut model = parsed["model"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if model.is_none()
            && let Some(profile_name) = profile
        {
            model = Some(if profile_name.starts_with("profile:") {
                profile_name.to_string()
            } else {
                format!("profile:{profile_name}")
            });
        }
        let effort = parsed["effort"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let working_dir = parsed["working_dir"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let spawn_mode = match parsed["spawn_mode"]
            .as_str()
            .or_else(|| parsed["mode"].as_str())
        {
            Some(raw) => Some(
                crate::config::SwarmSpawnMode::parse(raw).ok_or_else(|| {
                    anyhow::anyhow!(
                        "Invalid spawn mode `{raw}`. Expected headless, inline, visible, or auto."
                    )
                })?,
            ),
            None => None,
        };
        let task = parsed["task"]
            .as_str()
            .or_else(|| parsed["prompt"].as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        return Ok(ParsedSwarmSpawn {
            name,
            model,
            effort,
            working_dir,
            spawn_mode,
            task,
        });
    }

    let mut out = ParsedSwarmSpawn::default();
    let mut profile: Option<String> = None;
    let mut trailing_task: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        match arg {
            "--" => {
                trailing_task.extend(args[i + 1..].iter().cloned());
                break;
            }
            "--model" => {
                let val = args
                    .get(i + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for --model"))?;
                if !val.trim().is_empty() {
                    out.model = Some(val.trim().to_string());
                }
                i += 2;
            }
            "--profile" => {
                let val = args
                    .get(i + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for --profile"))?;
                if !val.trim().is_empty() {
                    profile = Some(val.trim().to_string());
                }
                i += 2;
            }
            "--effort" => {
                let val = args
                    .get(i + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for --effort"))?;
                if !val.trim().is_empty() {
                    out.effort = Some(val.trim().to_string());
                }
                i += 2;
            }
            "--working-dir" | "--cwd" => {
                let val = args
                    .get(i + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for {arg}"))?;
                if !val.trim().is_empty() {
                    out.working_dir = Some(val.trim().to_string());
                }
                i += 2;
            }
            "--mode" | "--spawn-mode" => {
                let val = args
                    .get(i + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for {arg}"))?;
                out.spawn_mode = Some(
                    crate::config::SwarmSpawnMode::parse(val).ok_or_else(|| {
                        anyhow::anyhow!(
                            "Invalid spawn mode `{val}`. Expected headless, inline, visible, or auto."
                        )
                    })?,
                );
                i += 2;
            }
            "--task" | "--prompt" => {
                let val = args
                    .get(i + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for {arg}"))?;
                if !val.trim().is_empty() {
                    out.task = Some(val.trim().to_string());
                }
                i += 2;
            }
            flag if flag.starts_with("--") => {
                bail!("Unknown swarm spawn option `{flag}`");
            }
            positional => {
                if out.name.is_none() {
                    out.name = Some(positional.trim().to_string());
                } else {
                    trailing_task.push(positional.to_string());
                }
                i += 1;
            }
        }
    }
    if out.model.is_none()
        && let Some(profile_name) = profile
    {
        out.model = Some(if profile_name.starts_with("profile:") {
            profile_name
        } else {
            format!("profile:{profile_name}")
        });
    }
    if out.task.is_none() && !trailing_task.is_empty() {
        let joined = trailing_task.join(" ").trim().to_string();
        if !joined.is_empty() {
            out.task = Some(joined);
        }
    }
    Ok(out)
}

async fn resolve_swarm_member_target(
    target: &str,
    swarm_members: &Arc<tokio::sync::RwLock<std::collections::HashMap<String, super::SwarmMember>>>,
) -> Result<(String, Option<String>, Option<String>)> {
    let target = target.trim();
    if target.is_empty() {
        bail!("Target worker session ID or name is required.");
    }
    let members = swarm_members.read().await;
    if let Some(m) = members.get(target) {
        return Ok((
            m.session_id.clone(),
            m.swarm_id.clone(),
            m.report_back_to_session_id.clone(),
        ));
    }
    let lower = target.to_ascii_lowercase();
    let mut matches: Vec<&super::SwarmMember> = members
        .values()
        .filter(|m| {
            m.friendly_name
                .as_deref()
                .is_some_and(|n| n.eq_ignore_ascii_case(&lower))
                || m.session_id.starts_with(target)
                || m.session_id.ends_with(target)
        })
        .collect();
    matches.sort_by(|a, b| a.session_id.cmp(&b.session_id));
    match matches.len() {
        0 => bail!("Unknown swarm member `{target}`."),
        1 => {
            let m = matches[0];
            Ok((
                m.session_id.clone(),
                m.swarm_id.clone(),
                m.report_back_to_session_id.clone(),
            ))
        }
        _ => bail!(
            "Ambiguous swarm member `{target}`. Provide an exact session ID."
        ),
    }
}

async fn resolve_swarm_driver_session(
    ctx: &SwarmControlContext<'_>,
    caller_session_id: Option<&str>,
    target_swarm_id: Option<&str>,
    owner_session_id: Option<&str>,
    fallback_session_id: Option<&str>,
) -> Option<String> {
    let members = ctx.swarm_members.read().await;
    if let Some(owner) = owner_session_id
        && let Some(m) = members.get(owner)
        && (target_swarm_id.is_none() || m.swarm_id.as_deref() == target_swarm_id)
    {
        return Some(owner.to_string());
    }
    if let Some(sid) = target_swarm_id {
        let coords = ctx.swarm_coordinators.read().await;
        if let Some(coord) = coords.get(sid)
            && members.contains_key(coord)
        {
            return Some(coord.clone());
        }
    }
    if let Some(caller) = caller_session_id
        && !caller.is_empty()
        && let Some(m) = members.get(caller)
        && (target_swarm_id.is_none() || m.swarm_id.as_deref() == target_swarm_id)
    {
        return Some(caller.to_string());
    }
    if let Some(sid) = target_swarm_id
        && let Some(any) = members
            .values()
            .find(|m| m.swarm_id.as_deref() == Some(sid) && m.role == "coordinator")
            .or_else(|| members.values().find(|m| m.swarm_id.as_deref() == Some(sid)))
    {
        return Some(any.session_id.clone());
    }
    if let Some(fb) = fallback_session_id
        && members.contains_key(fb)
    {
        return Some(fb.to_string());
    }
    members
        .values()
        .find(|m| m.role == "coordinator" && m.swarm_id.is_some())
        .or_else(|| members.values().find(|m| m.swarm_id.is_some()))
        .map(|m| m.session_id.clone())
}

async fn ensure_coordinator_for_swarm_spawn(
    ctx: &SwarmControlContext<'_>,
    caller_session_id: Option<&str>,
    working_dir: Option<&str>,
) -> Result<String> {
    if let Some(caller) = caller_session_id
        && !caller.is_empty()
    {
        let already_in_swarm = {
            let members = ctx.swarm_members.read().await;
            members
                .get(caller)
                .is_some_and(|m| m.swarm_id.is_some())
        };
        if already_in_swarm {
            return Ok(caller.to_string());
        }
        // Attach the caller into a swarm if it's a registered member without swarm_id.
        let mut members = ctx.swarm_members.write().await;
        if let Some(member) = members.get_mut(caller) {
            let sid = member
                .swarm_id
                .clone()
                .or_else(|| super::swarm_id_for_session(caller))
                .unwrap_or_else(|| format!("swarm-{caller}"));
            member.swarm_id = Some(sid.clone());
            member.swarm_enabled = true;
            if member.role.is_empty() {
                member.role = "coordinator".to_string();
            }
            drop(members);
            ctx.swarms_by_id
                .write()
                .await
                .entry(sid.clone())
                .or_default()
                .insert(caller.to_string());
            ctx.swarm_coordinators
                .write()
                .await
                .entry(sid)
                .or_insert_with(|| caller.to_string());
            return Ok(caller.to_string());
        }
    }

    // Global scope (or unattached caller): prefer an existing live coordinator
    // matching working_dir (if given), otherwise any live coordinator.
    {
        let members = ctx.swarm_members.read().await;
        let coords = ctx.swarm_coordinators.read().await;
        let desired_dir = working_dir.map(std::path::Path::new);
        if let Some(dir) = desired_dir
            && let Some(coord_id) = coords.values().find(|cid| {
                members.get(*cid).is_some_and(|m| {
                    m.swarm_id.is_some() && m.working_dir.as_deref() == Some(dir)
                })
            })
        {
            return Ok(coord_id.clone());
        }
        if let Some(coord_id) = coords
            .values()
            .find(|cid| members.get(*cid).is_some_and(|m| m.swarm_id.is_some()))
        {
            return Ok(coord_id.clone());
        }
        if let Some(member) = members
            .values()
            .find(|m| m.swarm_id.is_some() && m.report_back_to_session_id.is_none())
        {
            return Ok(member.session_id.clone());
        }
    }

    // No coordinator exists yet: spin up a headless coordinator session cleanly.
    let cmd = match working_dir {
        Some(dir) if !dir.trim().is_empty() => format!("create_session:{}", dir.trim()),
        _ => "create_session".to_string(),
    };
    let result_json = super::headless::create_headless_session(
        ctx.sessions,
        ctx.global_session_id,
        ctx.provider_template,
        &cmd,
        ctx.swarm_members,
        ctx.swarms_by_id,
        ctx.swarm_coordinators,
        ctx.swarm_plans,
        ctx.soft_interrupt_queues,
        false,
        None,
        None,
        None,
        None,
        Some(Arc::clone(ctx.mcp_pool)),
        None,
        super::headless::HeadlessMemoryScope::RealProject,
    )
    .await?;
    let coord_id = serde_json::from_str::<Value>(&result_json)
        .ok()
        .and_then(|v| v.get("session_id").and_then(Value::as_str).map(str::to_string))
        .ok_or_else(|| anyhow::anyhow!("Failed to parse coordinator session id"))?;

    let swarm_id = {
        let mut members = ctx.swarm_members.write().await;
        if let Some(member) = members.get_mut(&coord_id) {
            let sid = member
                .swarm_id
                .clone()
                .or_else(|| super::swarm_id_for_session(&coord_id))
                .unwrap_or_else(|| format!("swarm-{coord_id}"));
            member.swarm_id = Some(sid.clone());
            member.swarm_enabled = true;
            member.role = "coordinator".to_string();
            member.friendly_name = Some("coordinator".to_string());
            sid
        } else {
            format!("swarm-{coord_id}")
        }
    };
    ctx.swarms_by_id
        .write()
        .await
        .entry(swarm_id.clone())
        .or_default()
        .insert(coord_id.clone());
    ctx.swarm_coordinators
        .write()
        .await
        .insert(swarm_id, coord_id.clone());
    Ok(coord_id)
}

pub(super) async fn execute_swarm_command(
    ctx: &SwarmControlContext<'_>,
    caller_session_id: Option<&str>,
    swarm_enabled: bool,
    args: &[String],
) -> Result<(Value, String)> {
    let sub = args
        .first()
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "status".to_string());
    match sub.as_str() {
        "status" | "show" | "stats" | "list" | "board" => {
            if args.len() > 1 {
                bail!("Usage: /swarm [status|show|list|board|spawn|stop|resume|dm|broadcast]");
            }
            let data = super::client_lifecycle::build_live_swarm_snapshot(
                &sub,
                caller_session_id.unwrap_or(""),
                swarm_enabled,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.event_history,
            )
            .await;
            let message = serde_json::to_string_pretty(&data)?;
            Ok((data, message))
        }
        "spawn" => {
            let parsed = parse_swarm_spawn_args(&args[1..])?;
            let coord_id = ensure_coordinator_for_swarm_spawn(
                ctx,
                caller_session_id,
                parsed.working_dir.as_deref(),
            )
            .await?;
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            let nonce = Some(crate::id::new_id("swarm_spawn"));
            let label = parsed.name.clone().or_else(|| parsed.task.clone());
            // Default API/Desktop spawns to headless so workers stream inside the daemon
            // instead of popping external terminal windows unless `--mode` overrides it.
            let spawn_mode = Some(
                parsed
                    .spawn_mode
                    .unwrap_or(crate::config::SwarmSpawnMode::Headless),
            );
            super::comm_session::handle_comm_spawn(
                0,
                coord_id.clone(),
                None,
                parsed.working_dir.clone(),
                parsed.task.clone(),
                nonce,
                spawn_mode,
                parsed.model.clone(),
                parsed.effort.clone(),
                label,
                &tx,
                ctx.sessions,
                ctx.global_session_id,
                ctx.provider_template,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.channel_subscriptions,
                ctx.channel_subscriptions_by_session,
                ctx.event_history,
                ctx.event_counter,
                ctx.swarm_event_tx,
                ctx.mcp_pool,
                ctx.soft_interrupt_queues,
                ctx.swarm_mutation_runtime,
                ctx.client_connections,
            )
            .await;
            let mut spawned_id: Option<String> = None;
            while let Ok(event) = rx.try_recv() {
                match event {
                    crate::protocol::ServerEvent::CommSpawnResponse { new_session_id, .. } => {
                        spawned_id = Some(new_session_id);
                    }
                    crate::protocol::ServerEvent::Error { message, .. } => {
                        bail!("{message}");
                    }
                    _ => {}
                }
            }
            let spawned_id = spawned_id
                .ok_or_else(|| anyhow::anyhow!("Swarm spawn completed without returning a session id"))?;
            if let Some(ref explicit_name) = parsed.name {
                let mut members = ctx.swarm_members.write().await;
                if let Some(member) = members.get_mut(&spawned_id) {
                    member.friendly_name = Some(explicit_name.clone());
                }
            }
            let mut data = super::client_lifecycle::build_live_swarm_snapshot(
                "spawn",
                caller_session_id.unwrap_or(&coord_id),
                true,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.event_history,
            )
            .await;
            if let Some(obj) = data.as_object_mut() {
                obj.insert("spawned_session_id".into(), json!(spawned_id));
                obj.insert("coordinator_session_id".into(), json!(coord_id));
            }
            let message = format!("Spawned swarm worker `{spawned_id}`.");
            Ok((data, message))
        }
        "stop" => {
            let rest = &args[1..];
            let Some(target_arg) = rest.first().map(String::as_str) else {
                bail!("Usage: /swarm stop <session_id|name|all> [--force]");
            };
            let force = rest.iter().any(|a| a == "--force") || caller_session_id.is_none();
            if target_arg.eq_ignore_ascii_case("all") {
                let targets: Vec<(String, Option<String>, Option<String>)> = {
                    let members = ctx.swarm_members.read().await;
                    members
                        .values()
                        .filter(|m| m.role != "coordinator" && m.swarm_id.is_some())
                        .map(|m| {
                            (
                                m.session_id.clone(),
                                m.swarm_id.clone(),
                                m.report_back_to_session_id.clone(),
                            )
                        })
                        .collect()
                };
                let mut stopped = Vec::new();
                for (target_sid, swarm_id, owner) in targets {
                    let driver = resolve_swarm_driver_session(
                        ctx,
                        caller_session_id,
                        swarm_id.as_deref(),
                        owner.as_deref(),
                        Some(&target_sid),
                    )
                    .await
                    .unwrap_or_else(|| target_sid.clone());
                    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
                    super::comm_session::handle_comm_stop(
                        0,
                        driver,
                        target_sid.clone(),
                        true,
                        &tx,
                        ctx.sessions,
                        ctx.swarm_members,
                        ctx.swarms_by_id,
                        ctx.swarm_coordinators,
                        ctx.swarm_plans,
                        ctx.channel_subscriptions,
                        ctx.channel_subscriptions_by_session,
                        ctx.event_history,
                        ctx.event_counter,
                        ctx.swarm_event_tx,
                        ctx.soft_interrupt_queues,
                        ctx.swarm_mutation_runtime,
                    )
                    .await;
                    let mut had_err = false;
                    while let Ok(ev) = rx.try_recv() {
                        if matches!(ev, crate::protocol::ServerEvent::Error { .. }) {
                            had_err = true;
                        }
                    }
                    if !had_err {
                        stopped.push(target_sid);
                    }
                }
                let mut data = super::client_lifecycle::build_live_swarm_snapshot(
                    "stop",
                    caller_session_id.unwrap_or(""),
                    swarm_enabled,
                    ctx.swarm_members,
                    ctx.swarms_by_id,
                    ctx.swarm_coordinators,
                    ctx.swarm_plans,
                    ctx.event_history,
                )
                .await;
                if let Some(obj) = data.as_object_mut() {
                    obj.insert("stopped_session_ids".into(), json!(stopped));
                }
                let message = format!("Stopped {} swarm worker(s).", stopped.len());
                return Ok((data, message));
            }
            let (target_sid, swarm_id, owner) =
                resolve_swarm_member_target(target_arg, ctx.swarm_members).await?;
            let driver = resolve_swarm_driver_session(
                ctx,
                caller_session_id,
                swarm_id.as_deref(),
                owner.as_deref(),
                Some(&target_sid),
            )
            .await
            .ok_or_else(|| anyhow::anyhow!("No active swarm found for `{target_arg}`."))?;
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            super::comm_session::handle_comm_stop(
                0,
                driver,
                target_sid.clone(),
                force,
                &tx,
                ctx.sessions,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.channel_subscriptions,
                ctx.channel_subscriptions_by_session,
                ctx.event_history,
                ctx.event_counter,
                ctx.swarm_event_tx,
                ctx.soft_interrupt_queues,
                ctx.swarm_mutation_runtime,
            )
            .await;
            while let Ok(event) = rx.try_recv() {
                if let crate::protocol::ServerEvent::Error { message, .. } = event {
                    bail!("{message}");
                }
            }
            let mut data = super::client_lifecycle::build_live_swarm_snapshot(
                "stop",
                caller_session_id.unwrap_or(""),
                swarm_enabled,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.event_history,
            )
            .await;
            if let Some(obj) = data.as_object_mut() {
                obj.insert("stopped_session_id".into(), json!(target_sid));
            }
            Ok((data, format!("Stopped swarm worker `{target_sid}`.")))
        }
        "resume" | "wake" => {
            let rest = &args[1..];
            let Some(target_arg) = rest.first().map(String::as_str) else {
                bail!("Usage: /swarm resume <session_id|name> [message...]");
            };
            let note = if rest.len() > 1 {
                let joined = rest[1..].join(" ").trim().to_string();
                (!joined.is_empty()).then_some(joined)
            } else {
                None
            };
            let (target_sid, swarm_id, owner) =
                resolve_swarm_member_target(target_arg, ctx.swarm_members).await?;
            let driver = resolve_swarm_driver_session(
                ctx,
                caller_session_id,
                swarm_id.as_deref(),
                owner.as_deref(),
                Some(&target_sid),
            )
            .await
            .ok_or_else(|| anyhow::anyhow!("No active swarm coordinator found for `{target_arg}`."))?;
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            super::comm_control::handle_comm_task_control(
                0,
                driver,
                "resume".to_string(),
                String::new(),
                Some(target_sid.clone()),
                note,
                &tx,
                ctx.sessions,
                ctx.soft_interrupt_queues,
                ctx.client_connections,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_plans,
                ctx.swarm_coordinators,
                ctx.event_history,
                ctx.event_counter,
                ctx.swarm_event_tx,
                ctx.swarm_mutation_runtime,
            )
            .await;
            while let Ok(event) = rx.try_recv() {
                if let crate::protocol::ServerEvent::Error { message, .. } = event {
                    bail!("{message}");
                }
            }
            let mut data = super::client_lifecycle::build_live_swarm_snapshot(
                "resume",
                caller_session_id.unwrap_or(""),
                swarm_enabled,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.event_history,
            )
            .await;
            if let Some(obj) = data.as_object_mut() {
                obj.insert("resumed_session_id".into(), json!(target_sid));
            }
            Ok((data, format!("Resumed swarm worker `{target_sid}`.")))
        }
        "dm" => {
            let rest = &args[1..];
            if rest.len() < 2 {
                bail!("Usage: /swarm dm <session_id|name> <message...>");
            }
            let target_arg = &rest[0];
            let message_text = rest[1..].join(" ").trim().to_string();
            if message_text.is_empty() {
                bail!("DM message must not be empty.");
            }
            let (target_sid, swarm_id, owner) =
                resolve_swarm_member_target(target_arg, ctx.swarm_members).await?;
            let from_session = resolve_swarm_driver_session(
                ctx,
                caller_session_id,
                swarm_id.as_deref(),
                owner.as_deref(),
                Some(&target_sid),
            )
            .await
            .ok_or_else(|| anyhow::anyhow!("No active swarm found for `{target_arg}`."))?;
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            super::client_comm::handle_comm_message(
                0,
                from_session,
                message_text,
                Some(target_sid.clone()),
                None,
                None,
                Some(true),
                None,
                None,
                true,
                &tx,
                ctx.sessions,
                ctx.soft_interrupt_queues,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.channel_subscriptions,
                ctx.event_history,
                ctx.event_counter,
                ctx.swarm_event_tx,
                ctx.client_connections,
            )
            .await;
            while let Ok(event) = rx.try_recv() {
                if let crate::protocol::ServerEvent::Error { message, .. } = event {
                    bail!("{message}");
                }
            }
            let mut data = super::client_lifecycle::build_live_swarm_snapshot(
                "dm",
                caller_session_id.unwrap_or(""),
                swarm_enabled,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.event_history,
            )
            .await;
            if let Some(obj) = data.as_object_mut() {
                obj.insert("target_session_id".into(), json!(target_sid));
                obj.insert("delivered".into(), json!(true));
            }
            Ok((data, format!("Sent message to swarm worker `{target_sid}`.")))
        }
        "broadcast" => {
            let message_text = args[1..].join(" ").trim().to_string();
            if message_text.is_empty() {
                bail!("Usage: /swarm broadcast <message...>");
            }
            let from_session =
                resolve_swarm_driver_session(ctx, caller_session_id, None, None, None)
                    .await
                    .ok_or_else(|| {
                        anyhow::anyhow!("No active swarm is running. Spawn a worker first.")
                    })?;
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            super::client_comm::handle_comm_message(
                0,
                from_session,
                message_text,
                None,
                None,
                None,
                Some(true),
                None,
                None,
                false,
                &tx,
                ctx.sessions,
                ctx.soft_interrupt_queues,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.channel_subscriptions,
                ctx.event_history,
                ctx.event_counter,
                ctx.swarm_event_tx,
                ctx.client_connections,
            )
            .await;
            while let Ok(event) = rx.try_recv() {
                if let crate::protocol::ServerEvent::Error { message, .. } = event {
                    bail!("{message}");
                }
            }
            let mut data = super::client_lifecycle::build_live_swarm_snapshot(
                "broadcast",
                caller_session_id.unwrap_or(""),
                swarm_enabled,
                ctx.swarm_members,
                ctx.swarms_by_id,
                ctx.swarm_coordinators,
                ctx.swarm_plans,
                ctx.event_history,
            )
            .await;
            if let Some(obj) = data.as_object_mut() {
                obj.insert("broadcast".into(), json!(true));
            }
            Ok((data, "Broadcasted message to active swarm.".into()))
        }
        _ => bail!(
            "Usage: /swarm [status|show|list|board|on|off|toggle|spawn|stop|resume|dm|broadcast]"
        ),
    }
}

pub(super) async fn handle_global_runtime_command(
    id: u64,
    command: &str,
    args: &[String],
    ctx: &SwarmControlContext<'_>,
    client_event_tx: &tokio::sync::mpsc::UnboundedSender<crate::protocol::ServerEvent>,
) {
    match execute_global(command, args, ctx).await {
        Ok((data, message)) => {
            let _ = client_event_tx.send(crate::protocol::ServerEvent::RuntimeCommandResult {
                id,
                command: command.to_string(),
                data,
                message,
            });
        }
        Err(error) => {
            let _ = client_event_tx.send(crate::protocol::ServerEvent::Error {
                id,
                message: error.to_string(),
                retry_after_secs: None,
            });
        }
    }
}

pub(super) async fn execute_global(
    command: &str,
    args: &[String],
    ctx: &SwarmControlContext<'_>,
) -> Result<(Value, String)> {
    let provider_template = ctx.provider_template;
    let mcp_pool = Some(ctx.mcp_pool);
    let parsed: RuntimeCommand = serde_json::from_value(json!(command))?;
    if !parsed.supports_global_scope() {
        bail!(
            "Runtime command `{}` requires an attached session.",
            parsed.as_str()
        );
    }

    match parsed {
        RuntimeCommand::ServerReload => {
            if !args.is_empty() {
                bail!("Server reload accepts no arguments.");
            }
            crate::config::Config::invalidate_cache();
            let has_newer = super::server_has_newer_binary();
            if has_newer {
                let hash = rayucode_build_meta::git_hash().to_string();
                let _ = crate::server::send_reload_signal(hash, None, false);
            }
            let message = if has_newer {
                "Reloaded daemon configuration and queued binary upgrade."
            } else {
                "Reloaded daemon configuration; server is already running the newest binary."
            };
            let data = json!({
                "requested": true,
                "config_reloaded": true,
                "binary_upgrade_queued": has_newer,
                "already_latest_binary": !has_newer,
            });
            Ok((data, message.into()))
        }
        RuntimeCommand::RefreshModelList => {
            if !args.is_empty() {
                bail!("This command accepts no arguments");
            }
            tokio::time::timeout(
                std::time::Duration::from_secs(25),
                provider_template.refresh_model_catalog(),
            )
            .await
            .map_err(|_| anyhow::anyhow!("Timed out refreshing provider model catalog after 25s"))??;
            crate::bus::Bus::global().publish_models_updated();
            let data = json!({
                "refreshed": true,
                "models": provider_template.available_models_for_switching(),
                "routes": provider_template.model_routes(),
            });
            Ok((data, "Provider model catalog refreshed.".into()))
        }
        RuntimeCommand::Subscription => {
            if !args.is_empty() && args != ["status".to_string()] {
                bail!("Usage: subscription [status]");
            }
            let data = rayu_credits_data().await?;
            let message = serde_json::to_string_pretty(&data)?;
            Ok((data, message))
        }
        RuntimeCommand::Swarm => {
            let config = crate::config::Config::load();
            execute_swarm_command(ctx, None, config.features.swarm, args).await
        }
        RuntimeCommand::Agents => {
            let effective_args = match args.split_first() {
                Some((scope, rest)) if matches!(scope.as_str(), "global" | "default") => rest,
                _ => args,
            };
            if let Some((first, rest)) = effective_args.split_first()
                && matches!(first.as_str(), "profile" | "profiles")
            {
                let message = crate::agent_profiles::run_global(rest)?;
                return Ok((global_agents_snapshot_json(provider_template), message));
            }
            match effective_args {
                [] => {}
                [arg]
                    if matches!(
                        arg.as_str(),
                        "show" | "status" | "swarm" | "review" | "judge" | "memory" | "ambient"
                    ) => {}
                [target, model] => {
                    let next = if model == "default" {
                        None
                    } else {
                        Some(model.as_str())
                    };
                    crate::config::Config::set_agent_model_default(target, next)?;
                    let snapshot = global_agents_snapshot_json(provider_template);
                    let message = format!(
                        "{target} agent model [global] → {}",
                        next.unwrap_or("default")
                    );
                    return Ok((snapshot, message));
                }
                _ => bail!(
                    "Usage: /agents [global] [swarm|review|judge|memory|ambient] [model|inherit]."
                ),
            }
            let data = global_agents_snapshot_json(provider_template);
            let message = serde_json::to_string_pretty(&data)?;
            Ok((data, message))
        }
        RuntimeCommand::SubagentModel => {
            let effective_args = match args.split_first() {
                Some((scope, rest)) if matches!(scope.as_str(), "global" | "default") => rest,
                _ => args,
            };
            match effective_args {
                [] => {}
                [arg] if matches!(arg.as_str(), "status" | "show") => {}
                [model] => {
                    let next = if is_subagent_clear_sentinel(model) {
                        None
                    } else {
                        Some(model.as_str())
                    };
                    crate::config::Config::set_agent_model_default("swarm", next)?;
                }
                _ => bail!("Usage: /subagent-model [global] [show|inherit|default|model]"),
            }
            let cfg = crate::config::Config::load();
            let data = json!({
                "model": cfg.agents.swarm_model,
                "configured_default": cfg.agents.swarm_model,
                "inherit_model": provider_template.model(),
                "models": provider_template.available_models_for_switching(),
                "routes": provider_template.model_routes(),
            });
            let message = serde_json::to_string_pretty(&data)?;
            Ok((data, message))
        }
        RuntimeCommand::Mcp
            if args
                .first()
                .map(|s| s.to_ascii_lowercase())
                .as_deref()
                == Some("reload") =>
        {
            let (working_dir, _) = strip_working_dir_arg(args, None)?;
            let (connected_count, errors) = if let Some(pool) = mcp_pool {
                pool.reload().await
            } else {
                (0, Vec::new())
            };
            // Reconcile MCP tools on idle attached sessions without blocking active turns.
            let active_agents: Vec<Arc<tokio::sync::Mutex<crate::agent::Agent>>> = {
                let sessions = ctx.sessions.read().await;
                sessions.values().cloned().collect()
            };
            let mut reconciled_sessions = 0usize;
            for agent_arc in active_agents {
                if let Ok(guard) = agent_arc.try_lock() {
                    let reg = guard.registry();
                    if reg.tool_names().await.iter().any(|n| n == "mcp") {
                        let tool_ctx = crate::tool::ToolContext {
                            session_id: guard.session_id().to_string(),
                            message_id: crate::id::new_id("msg"),
                            tool_call_id: crate::id::new_id("call"),
                            working_dir: guard.working_dir().map(std::path::PathBuf::from),
                            stdin_request_tx: None,
                            graceful_shutdown_signal: None,
                            execution_mode: crate::tool::ToolExecutionMode::Direct,
                        };
                        if reg
                            .execute(
                                "mcp",
                                json!({"action": "reload", "intent": "Reconcile MCP servers after global reload"}),
                                tool_ctx,
                            )
                            .await
                            .is_ok()
                        {
                            reconciled_sessions += 1;
                        }
                    }
                }
            }
            let configured_count = tokio::task::spawn_blocking(move || {
                crate::mcp::McpConfig::load_for_dir(working_dir.as_deref())
                    .servers
                    .len()
            })
            .await?;
            let error_details: Vec<String> = errors
                .iter()
                .map(|(name, err)| format!("{name}: {err}"))
                .collect();
            let detail = if error_details.is_empty() {
                format!(
                    "Reloaded MCP configuration ({configured_count} configured, {connected_count} connected)."
                )
            } else {
                format!(
                    "Reloaded MCP configuration ({configured_count} configured, {connected_count} connected) with errors: {}",
                    error_details.join("; ")
                )
            };
            let data = json!({
                "reloaded": true,
                "configured_count": configured_count,
                "connected_count": connected_count,
                "reconciled_sessions": reconciled_sessions,
                "errors": error_details,
                "detail": detail,
            });
            Ok((data, detail))
        }
        RuntimeCommand::Skills => {
            let (working_dir, clean_args) = strip_working_dir_arg(args, None)?;
            let sub = clean_args
                .first()
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_else(|| "list".to_string());
            match sub.as_str() {
                "list" | "status" | "show" | "stats" => {
                    if clean_args.len() > 1 {
                        bail!("Usage: /skills [list|enable <name>|disable <name>|toggle <name>] [--working-dir <path>]");
                    }
                }
                "enable" | "disable" | "toggle" => {
                    let Some(name) = clean_args.get(1).filter(|s| !s.trim().is_empty()) else {
                        bail!("Usage: /skills {sub} <skill_name>");
                    };
                    match sub.as_str() {
                        "enable" => {
                            crate::config::Config::set_skill_disabled(name, false)?;
                        }
                        "disable" => {
                            crate::config::Config::set_skill_disabled(name, true)?;
                        }
                        _ => {
                            crate::config::Config::toggle_skill_disabled(name)?;
                        }
                    }
                    let _ = crate::skill::SkillRegistry::shared_registry()
                        .write()
                        .await
                        .reload_global();
                }
                _ => bail!(
                    "Usage: /skills [list|enable <name>|disable <name>|toggle <name>] [--working-dir <path>]"
                ),
            }
            let data = tokio::task::spawn_blocking(move || {
                skills_snapshot_for_dir(working_dir.as_deref(), None)
            })
            .await??;
            let report = skills_report(&data);
            Ok((data, report))
        }
        RuntimeCommand::Memory => {
            let (working_dir, clean_args) = strip_working_dir_arg(args, None)?;
            if clean_args
                .first()
                .is_some_and(|s| s.eq_ignore_ascii_case("list"))
            {
                let enabled = crate::config::Config::load().features.memory;
                let data = tokio::task::spawn_blocking(move || {
                    memory_list_snapshot(working_dir.as_deref(), enabled, "global")
                })
                .await??;
                let message = serde_json::to_string_pretty(&data)?;
                return Ok((data, message));
            }
            let cfg = crate::config::Config::load();
            if let Some(enabled) = boolean_action(&clean_args, cfg.features.memory, false)? {
                let mut patch = serde_json::Map::new();
                patch.insert("features.memory".to_string(), json!(enabled));
                crate::config::rpc_config::patch_curated_config(&patch)?;
            }
            let updated = crate::config::Config::load();
            let data = json!({
                "enabled": updated.features.memory,
                "scope": "global",
                "pipeline_active": crate::memory_agent::is_active(),
            });
            let message = serde_json::to_string_pretty(&data)?;
            Ok((data, message))
        }
        RuntimeCommand::Overnight
            if !super::runtime_special_commands::is_lock_free(RuntimeCommand::Overnight, args) =>
        {
            super::runtime_special_commands::overnight_start_global(provider_template, args).await
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
                    provider_template.model()
                };
                crate::live_tests::format_provider_test_coverage_report(&args[0], &model, None)
            };
            Ok((
                json!({"report": report, "source": "persisted_verification"}),
                report,
            ))
        }
        RuntimeCommand::ResumeAll => bail!("ResumeAll is dispatched via its dedicated handler."),
        other => {
            let lock_ctx = super::runtime_special_commands::LockFreeCommandContext {
                session_id: String::new(),
                working_dir: None,
                registry: None,
                mcp_pool: mcp_pool.cloned(),
                provider_name: provider_template.name().to_string(),
                provider_model: provider_template.model(),
                provider_context_window: provider_template.context_window(),
                provider_transport: provider_template.transport(),
                route_counts: None,
            };
            if let Some(res) =
                super::runtime_special_commands::try_execute_lock_free(&lock_ctx, other, args).await
            {
                res
            } else {
                bail!(
                    "Runtime command `{}` is not supported in global scope.",
                    other.as_str()
                )
            }
        }
    }
}

fn strip_working_dir_arg(
    args: &[String],
    default_dir: Option<&std::path::Path>,
) -> Result<(Option<std::path::PathBuf>, Vec<String>)> {
    let mut working_dir = default_dir.map(|p| p.to_path_buf());
    let mut clean = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        if matches!(args[i].as_str(), "--working-dir" | "--cwd") {
            let val = args
                .get(i + 1)
                .ok_or_else(|| anyhow::anyhow!("Missing value for {}", args[i]))?;
            if !val.trim().is_empty() {
                working_dir = Some(std::path::PathBuf::from(val.trim()));
            }
            i += 2;
        } else {
            clean.push(args[i].clone());
            i += 1;
        }
    }
    Ok((working_dir, clean))
}

fn skills_snapshot_for_dir(
    working_dir: Option<&std::path::Path>,
    active_skill: Option<&str>,
) -> Result<Value> {
    let (registry, disabled) = crate::skill::SkillRegistry::load_all_for_working_dir(working_dir)?;
    let mut loaded = registry.list();
    loaded.sort_by(|a, b| a.name.cmp(&b.name));
    let skills: Vec<Value> = loaded
        .iter()
        .map(|skill| {
            let is_disabled = disabled
                .iter()
                .any(|d| d.trim().eq_ignore_ascii_case(&skill.name));
            let tokens = crate::util::estimate_tokens(&skill.content);
            let scope = if working_dir
                .is_some_and(|wd| skill.path.starts_with(wd))
            {
                "project"
            } else {
                "global"
            };
            json!({
                "name": skill.name,
                "description": skill.description,
                "path": skill.path,
                "allowed_tools": skill.allowed_tools,
                "enabled": !is_disabled,
                "tokens": tokens,
                "scope": scope,
            })
        })
        .collect();
    let endorsed: Vec<Value> = crate::skill::endorsed_skills()
        .iter()
        .map(|skill| {
            json!({
                "name": skill.name,
                "description": skill.description,
                "category": skill.category,
                "source": skill.source,
                "install": skill.install,
                "installed": registry.contains(skill.name),
            })
        })
        .collect();
    Ok(json!({
        "skills": skills,
        "disabled": disabled,
        "endorsed": endorsed,
        "active_skill": active_skill,
    }))
}

fn memory_list_snapshot(
    working_dir: Option<&std::path::Path>,
    enabled: bool,
    scope_label: &str,
) -> Result<Value> {
    let mut instruction_files: Vec<Value> = Vec::new();
    let mut push_instruction = |path: std::path::PathBuf, scope: &str, label: &str| {
        if !path.is_file() {
            return;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            return;
        };
        let bytes = content.len();
        let tokens = crate::util::estimate_tokens(&content);
        let modified_ms = std::fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        let preview: String = content.chars().take(280).collect();
        instruction_files.push(json!({
            "name": label,
            "path": path.display().to_string(),
            "scope": scope,
            "bytes": bytes,
            "tokens": tokens,
            "modified_ms": modified_ms,
            "preview": preview,
        }));
    };

    if let Some(dir) = working_dir {
        for (rel, label) in [
            ("AGENTS.md", "AGENTS.md"),
            ("RAYU.md", "RAYU.md"),
            (".rayu/RAYU.md", ".rayu/RAYU.md"),
            ("RAYU.local.md", "RAYU.local.md"),
        ] {
            push_instruction(dir.join(rel), "project", label);
        }
    }
    if let Ok(home_agents) = crate::storage::user_home_path("AGENTS.md") {
        push_instruction(home_agents, "global", "~/AGENTS.md");
    }
    if let Ok(rayu_dir) = crate::storage::rayu_dir() {
        push_instruction(rayu_dir.join("RAYU.md"), "global", "~/.rayu/RAYU.md");
    }

    let mut manager = crate::memory::MemoryManager::new();
    if let Some(dir) = working_dir {
        manager = manager.with_project_dir(dir);
    }

    let mut graph_entries: Vec<Value> = Vec::new();
    let mut push_graph = |graph: crate::memory_graph::MemoryGraph, scope: &str| {
        let mut entries: Vec<&crate::memory::MemoryEntry> = graph
            .memories
            .values()
            .filter(|e| e.active)
            .collect();
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        for entry in entries.into_iter().take(100) {
            graph_entries.push(json!({
                "id": entry.id,
                "scope": scope,
                "category": entry.category,
                "content": entry.content,
                "tags": entry.tags,
                "confidence": entry.confidence,
                "trust": entry.trust,
                "source": entry.source,
                "created_at": entry.created_at,
                "updated_at": entry.updated_at,
                "tokens": crate::util::estimate_tokens(&entry.content),
            }));
        }
    };
    if working_dir.is_some()
        && let Ok(project_graph) = manager.load_project_graph()
    {
        push_graph(project_graph, "project");
    }
    if let Ok(global_graph) = manager.load_global_graph() {
        push_graph(global_graph, "global");
    }

    let jev_provider = crate::memory::memory_sidecar_enabled();
    Ok(json!({
        "enabled": enabled,
        "scope": scope_label,
        "pipeline_active": crate::memory_agent::is_active(),
        "jev_provider": jev_provider,
        "instruction_files": instruction_files,
        "graph_entries": graph_entries,
        "instruction_count": instruction_files.len(),
        "graph_count": graph_entries.len(),
    }))
}

pub(super) fn execute_agents_lock_free(
    session_id: &str,
    provider: &Arc<dyn crate::provider::Provider>,
    args: &[String],
) -> Result<(Value, String)> {
    let (global, effective_args) = match args.split_first() {
        Some((scope, rest)) if matches!(scope.as_str(), "global" | "default") => (true, rest),
        _ => (false, args),
    };
    let mut stub_session = crate::session::Session::create_with_id(session_id.to_string(), None, None);
    let _ = stub_session.refresh_agent_model_overrides();
    if let Some((first, rest)) = effective_args.split_first()
        && matches!(first.as_str(), "profile" | "profiles")
    {
        let message = crate::agent_profiles::run(&stub_session, global, rest)?;
        return Ok((
            session_agents_snapshot_lock_free(&stub_session, provider, global),
            message,
        ));
    }
    match effective_args {
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
                stub_session.set_agent_model_override(target, model.clone())?;
            }
            let resolved = stub_session.effective_agent_model(target, None);
            let message = format!(
                "{target} agent model [{}] → {}{}",
                if global { "global" } else { "session" },
                model.as_deref().unwrap_or("default"),
                match (&model, resolved.as_deref()) {
                    (Some(raw), Some(res)) if raw != res && !global => format!(" ({res})"),
                    _ => String::new(),
                }
            );
            let mut snapshot = session_agents_snapshot_lock_free(&stub_session, provider, global);
            if let Some(obj) = snapshot.as_object_mut() {
                obj.insert("target".into(), json!(target));
                obj.insert("model".into(), json!(model));
            }
            return Ok((snapshot, message));
        }
        _ => bail!(
            "Usage: /agents [global] [swarm|review|judge|memory|ambient] [model|inherit]."
        ),
    }
    let data = session_agents_snapshot_lock_free(&stub_session, provider, global);
    let message = serde_json::to_string_pretty(&data)?;
    Ok((data, message))
}

fn session_agents_snapshot_lock_free(
    session: &crate::session::Session,
    provider: &Arc<dyn crate::provider::Provider>,
    global: bool,
) -> Value {
    let config = crate::config::Config::load();
    let global_profiles = config.agents.profiles.clone();
    let session_profiles = session.session_agent_profiles();
    let effective_profiles = session.effective_agent_profiles();
    let annotated_profiles: Vec<Value> = effective_profiles
        .iter()
        .map(|profile| {
            let scope = if session_profiles
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case(&profile.name))
            {
                "session"
            } else {
                "global"
            };
            json!({
                "name": profile.name,
                "model": profile.model,
                "description": profile.description,
                "effort": profile.effort,
                "scope": scope,
            })
        })
        .collect();
    let overrides = crate::session::Session::read_agent_model_overrides(&session.id);
    let effective = json!({
        "swarm": session.effective_agent_model("swarm", config.agents.swarm_model.clone()),
        "memory": session.effective_agent_model("memory", config.agents.memory_model.clone()),
        "review": session.effective_agent_model("review", config.autoreview.model.clone()),
        "judge": session.effective_agent_model("judge", config.autojudge.model.clone()),
        "ambient": session.effective_agent_model("ambient", config.ambient.model.clone()),
    });
    json!({
        "scope": if global { "global" } else { "session" },
        "defaults": {
            "swarm": config.agents.swarm_model,
            "memory": config.agents.memory_model,
            "review": config.autoreview.model,
            "judge": config.autojudge.model,
            "ambient": config.ambient.model,
        },
        "overrides": overrides,
        "effective": effective,
        "subagent_model": config.agents.swarm_model,
        "inherit_model": provider.model(),
        "profiles": annotated_profiles,
        "global_profiles": global_profiles,
        "session_profiles": session_profiles,
        "swarm_allowlist": config.agents.swarm_model_allowlist,
        "models": provider.available_models_for_switching(),
        "routes": provider.model_routes(),
        "config_path": crate::config::Config::path().map(|p| p.display().to_string()),
    })
}

fn global_agents_snapshot_json(provider_template: &Arc<dyn crate::provider::Provider>) -> Value {
    let config = crate::config::Config::load();
    let global_profiles = config.agents.profiles.clone();
    let annotated_profiles: Vec<Value> = global_profiles
        .iter()
        .map(|profile| {
            json!({
                "name": profile.name,
                "model": profile.model,
                "description": profile.description,
                "effort": profile.effort,
                "scope": "global",
            })
        })
        .collect();
    let defaults = json!({
        "swarm": config.agents.swarm_model,
        "memory": config.agents.memory_model,
        "review": config.autoreview.model,
        "judge": config.autojudge.model,
        "ambient": config.ambient.model,
    });
    let resolve_global = |raw: &Option<String>| {
        raw.as_deref()
            .map(|value| crate::session::resolve_profile_reference(&global_profiles, value))
    };
    let effective = json!({
        "swarm": resolve_global(&config.agents.swarm_model),
        "memory": resolve_global(&config.agents.memory_model),
        "review": resolve_global(&config.autoreview.model),
        "judge": resolve_global(&config.autojudge.model),
        "ambient": resolve_global(&config.ambient.model),
    });
    json!({
        "scope": "global",
        "defaults": defaults,
        "overrides": json!({}),
        "effective": effective,
        "subagent_model": config.agents.swarm_model,
        "inherit_model": provider_template.model(),
        "profiles": annotated_profiles,
        "global_profiles": global_profiles,
        "session_profiles": Vec::<Value>::new(),
        "swarm_allowlist": config.agents.swarm_model_allowlist,
        "models": provider_template.available_models_for_switching(),
        "routes": provider_template.model_routes(),
        "config_path": crate::config::Config::path().map(|p| p.display().to_string()),
    })
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

fn agents_snapshot_json(agent: &crate::agent::Agent, global: bool) -> Value {
    let config = crate::config::Config::load();
    let session = agent.session_for_split();
    let global_profiles = config.agents.profiles.clone();
    let session_profiles = session.session_agent_profiles();
    let effective_profiles = session.effective_agent_profiles();
    let annotated_profiles: Vec<Value> = effective_profiles
        .iter()
        .map(|profile| {
            let scope = if session_profiles
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case(&profile.name))
            {
                "session"
            } else {
                "global"
            };
            json!({
                "name": profile.name,
                "model": profile.model,
                "description": profile.description,
                "effort": profile.effort,
                "scope": scope,
            })
        })
        .collect();
    let effective = json!({
        "swarm": session.effective_agent_model("swarm", config.agents.swarm_model.clone()),
        "memory": session.effective_agent_model("memory", config.agents.memory_model.clone()),
        "review": session.effective_agent_model("review", config.autoreview.model.clone()),
        "judge": session.effective_agent_model("judge", config.autojudge.model.clone()),
        "ambient": session.effective_agent_model("ambient", config.ambient.model.clone()),
    });
    json!({
        "scope": if global { "global" } else { "session" },
        "defaults": {
            "swarm": config.agents.swarm_model,
            "memory": config.agents.memory_model,
            "review": config.autoreview.model,
            "judge": config.autojudge.model,
            "ambient": config.ambient.model,
        },
        "overrides": agent.runtime_agent_model_overrides(),
        "effective": effective,
        "subagent_model": agent.subagent_model(),
        "inherit_model": agent.provider_model(),
        "profiles": annotated_profiles,
        "global_profiles": global_profiles,
        "session_profiles": session_profiles,
        "swarm_allowlist": config.agents.swarm_model_allowlist,
        "models": agent.available_models_for_switching(),
        "routes": agent.model_routes(),
        "config_path": crate::config::Config::path().map(|p| p.display().to_string()),
    })
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

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn agents_profiles_and_subagent_model_roundtrip() {
        let _lock = crate::storage::lock_test_env();
        let home = tempfile::TempDir::new().unwrap();
        let old_home = std::env::var_os("RAYU_HOME");
        let old_cfg = std::env::var_os("RAYU_CONFIG_DIR");
        crate::env::set_var("RAYU_HOME", home.path());
        crate::env::set_var("RAYU_CONFIG_DIR", home.path());
        struct Restore(Option<std::ffi::OsString>, Option<std::ffi::OsString>);
        impl Drop for Restore {
            fn drop(&mut self) {
                match &self.0 {
                    Some(v) => crate::env::set_var("RAYU_HOME", v),
                    None => crate::env::remove_var("RAYU_HOME"),
                }
                match &self.1 {
                    Some(v) => crate::env::set_var("RAYU_CONFIG_DIR", v),
                    None => crate::env::remove_var("RAYU_CONFIG_DIR"),
                }
                crate::config::invalidate_config_cache();
            }
        }
        let _restore = Restore(old_home, old_cfg);
        crate::config::invalidate_config_cache();

        let provider: Arc<dyn crate::provider::Provider> = Arc::new(NoInferenceProvider::default());
        let mut agent = crate::agent::Agent::new(
            provider.clone(),
            crate::tool::Registry::new(provider).await,
        );

        // Add global persona profile + session persona profile
        let (added_global, _) = execute(
            &mut agent,
            RuntimeCommand::Agents,
            &[
                "global".into(),
                "profile".into(),
                "add".into(),
                "architect".into(),
                "rayu:claude-opus-4-5".into(),
                "--effort".into(),
                "high".into(),
                "System design and deep reviews".into(),
            ],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        let profiles = added_global["profiles"].as_array().unwrap();
        let arch = profiles.iter().find(|p| p["name"] == "architect").unwrap();
        assert_eq!(arch["scope"], "global");
        assert_eq!(arch["model"], "rayu:claude-opus-4-5");
        assert_eq!(arch["effort"], "high");

        let (added_session, _) = execute(
            &mut agent,
            RuntimeCommand::Agents,
            &[
                "profile".into(),
                "add".into(),
                "coder".into(),
                "rayu:claude-sonnet-4-5".into(),
                "--effort".into(),
                "medium".into(),
                "Fast edits and tests".into(),
            ],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        let profiles = added_session["profiles"].as_array().unwrap();
        assert_eq!(profiles.len(), 2);
        let coder = profiles.iter().find(|p| p["name"] == "coder").unwrap();
        assert_eq!(coder["scope"], "session");

        // Assign role to persona profile and confirm effective resolution
        let (assigned, _) = execute(
            &mut agent,
            RuntimeCommand::Agents,
            &["review".into(), "architect".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(assigned["overrides"]["review"], "architect");
        assert_eq!(assigned["effective"]["review"], "rayu:claude-opus-4-5");

        // Subagent default model session + global roundtrip
        let (sub_data, _) = execute(
            &mut agent,
            RuntimeCommand::SubagentModel,
            &["coder".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(sub_data["model"], "coder");

        let (sub_global, _) = execute(
            &mut agent,
            RuntimeCommand::SubagentModel,
            &["global".into(), "rayu:claude-sonnet-4-5".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(sub_global["configured_default"], "rayu:claude-sonnet-4-5");

        // Remove session profile
        let (after_rm, _) = execute(
            &mut agent,
            RuntimeCommand::Agents,
            &["profile".into(), "rm".into(), "coder".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(after_rm["session_profiles"].as_array().unwrap().len(), 0);
        assert_eq!(after_rm["global_profiles"].as_array().unwrap().len(), 1);

        // Regression: `/subagent-model global show` must NOT write `"show"` to config.toml.
        let (sub_show, _) = execute(
            &mut agent,
            RuntimeCommand::SubagentModel,
            &["global".into(), "show".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert_eq!(sub_show["configured_default"], "rayu:claude-sonnet-4-5");
        assert!(sub_show.get("routes").is_some());

        // Regression: `/subagent-model inherit` clears session subagent_model to None.
        let (sub_cleared, _) = execute(
            &mut agent,
            RuntimeCommand::SubagentModel,
            &["inherit".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert!(sub_cleared["model"].is_null());

        // Regression: global agents snapshot resolves profile references in `effective` and includes `routes`.
        let _ = crate::config::Config::set_agent_model_default("review", Some("architect"));
        let global_snap = global_agents_snapshot_json(&agent.provider_handle());
        assert_eq!(global_snap["effective"]["review"], "rayu:claude-opus-4-5");
        assert!(global_snap.get("routes").is_some());

        // Regression: skills disable/enable persists `[skills] disabled` and filters SkillRegistry::load_global.
        let skill_dir = home.path().join("skills").join("demo-parity-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: demo-parity-skill\ndescription: Parity test skill\n---\nInstructions body.",
        )
        .unwrap();
        let (skills_disabled, _) = execute(
            &mut agent,
            RuntimeCommand::Skills,
            &["disable".into(), "demo-parity-skill".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        let disabled_entry = skills_disabled["skills"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "demo-parity-skill")
            .expect("skill listed even when disabled");
        assert_eq!(disabled_entry["enabled"], false);
        assert!(
            !crate::skill::SkillRegistry::load_global()
                .unwrap()
                .contains("demo-parity-skill"),
            "disabled skill must be excluded from active SkillRegistry"
        );
        let (skills_enabled, _) = execute(
            &mut agent,
            RuntimeCommand::Skills,
            &["enable".into(), "demo-parity-skill".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        let enabled_entry = skills_enabled["skills"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "demo-parity-skill")
            .unwrap();
        assert_eq!(enabled_entry["enabled"], true);
        assert!(
            crate::skill::SkillRegistry::load_global()
                .unwrap()
                .contains("demo-parity-skill")
        );

        // Regression: memory list returns instruction_files and graph_entries, and context returns granular breakdown.
        std::fs::write(home.path().join("AGENTS.md"), "# Test repo instructions\n").unwrap();
        let (mem_list, _) = execute(
            &mut agent,
            RuntimeCommand::Memory,
            &[
                "list".into(),
                "--working-dir".into(),
                home.path().display().to_string(),
            ],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        assert!(
            mem_list["instruction_files"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["name"] == "AGENTS.md")
        );
        assert!(mem_list["graph_entries"].is_array());

        let (ctx_data, _) = execute(
            &mut agent,
            RuntimeCommand::Context,
            &["status".into()],
            true,
            Value::Null,
        )
        .await
        .unwrap();
        let tb = &ctx_data["token_breakdown"];
        assert!(tb.get("system_base").is_some());
        assert!(tb.get("instruction_files").is_some());
        assert!(tb.get("skills").is_some());
        assert!(tb.get("builtin_tools").is_some());
        assert!(tb.get("mcp_tools").is_some());
    }
}
