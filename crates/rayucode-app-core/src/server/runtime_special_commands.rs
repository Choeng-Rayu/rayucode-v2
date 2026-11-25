//! Specialist runtime workflows for non-terminal clients.
//! Never mutate a client's filesystem or replace a workflow with a model prompt.
use crate::agent::Agent;
use anyhow::{Context, Result, bail};
use rayucode_harness_api::RuntimeCommand;
use serde_json::{Value, json};

fn status_args(args: &[String]) -> Result<()> {
    match args {
        [] => Ok(()),
        [arg] if matches!(arg.as_str(), "status" | "show") => Ok(()),
        _ => bail!("This command accepts only status or show"),
    }
}

fn premium_arg(
    args: &[String],
    current: crate::provider::copilot::PremiumMode,
) -> Result<Option<crate::provider::copilot::PremiumMode>> {
    use crate::provider::copilot::PremiumMode;
    match args {
        [] => Ok(None),
        [arg] => match arg.as_str() {
            "status" | "show" => Ok(None),
            "normal" => Ok(Some(PremiumMode::Normal)),
            "one" => Ok(Some(PremiumMode::OnePerSession)),
            "zero" => Ok(Some(PremiumMode::Zero)),
            "toggle-one" => Ok(Some(if current == PremiumMode::OnePerSession {
                PremiumMode::Normal
            } else {
                PremiumMode::OnePerSession
            })),
            "toggle-zero" => Ok(Some(if current == PremiumMode::Zero {
                PremiumMode::Normal
            } else {
                PremiumMode::Zero
            })),
            _ => bail!("Usage: premium [normal|one|zero|status]"),
        },
        _ => bail!("Usage: premium [normal|one|zero|status]"),
    }
}

/// Find the attached session's latest run, rather than the host's latest run.
fn session_manifest(session_id: &str) -> Result<Option<crate::overnight::OvernightManifest>> {
    let root = crate::overnight::runs_dir()?;
    if !root.exists() {
        return Ok(None);
    }
    let mut latest = None;
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let path = entry.path().join("manifest.json");
        let Ok(manifest) = crate::storage::read_json::<crate::overnight::OvernightManifest>(&path)
        else {
            continue;
        };
        if manifest.parent_session_id != session_id && manifest.coordinator_session_id != session_id
        {
            continue;
        }
        if latest
            .as_ref()
            .is_none_or(|old: &crate::overnight::OvernightManifest| {
                old.started_at < manifest.started_at
            })
        {
            latest = Some(manifest);
        }
    }
    Ok(latest)
}

/// Context required to run lock-free specialist runtime commands without
/// acquiring the `Agent` mutex during an active turn.
pub(super) struct LockFreeCommandContext {
    pub session_id: String,
    pub working_dir: Option<std::path::PathBuf>,
    pub registry: Option<crate::tool::Registry>,
    pub provider_name: String,
    pub provider_model: String,
    pub provider_context_window: usize,
    pub provider_transport: Option<String>,
    pub route_counts: Option<(usize, usize)>,
}

impl LockFreeCommandContext {
    pub(super) fn from_agent(agent: &Agent) -> Self {
        let routes = agent.model_routes();
        let available_routes = routes.iter().filter(|r| r.available).count();
        Self {
            session_id: agent.session_id().to_string(),
            working_dir: agent.working_dir().map(std::path::PathBuf::from),
            registry: Some(agent.registry()),
            provider_name: agent.provider_name(),
            provider_model: agent.provider_model(),
            provider_context_window: agent.provider_context_window(),
            provider_transport: agent.provider_handle().transport(),
            route_counts: Some((available_routes, routes.len())),
        }
    }
}

/// Whether `command` with `args` can be executed without holding the `Agent` mutex.
pub(super) fn is_lock_free(command: RuntimeCommand, args: &[String]) -> bool {
    match command {
        RuntimeCommand::Auth
        | RuntimeCommand::Logout
        | RuntimeCommand::Remote
        | RuntimeCommand::Productivity
        | RuntimeCommand::Initiatives
        | RuntimeCommand::Background
        | RuntimeCommand::Telegram
        | RuntimeCommand::Features
        | RuntimeCommand::Doctor
        | RuntimeCommand::SessionSearch
        | RuntimeCommand::Schedules
        | RuntimeCommand::Ambient
        | RuntimeCommand::Mcp => true,
        RuntimeCommand::Overnight => {
            // Only launching a new overnight run needs `&mut Agent` (`session_for_split`
            // and `provider_fork`). `list`, `status`, `log`, `review`, `cancel`, and `help`
            // operate strictly on persisted run manifests and are completely lock-free.
            let sub = args.first().map(|s| s.to_ascii_lowercase());
            matches!(
                sub.as_deref(),
                None | Some("list" | "status" | "log" | "review" | "cancel" | "help")
            )
        }
        _ => false,
    }
}

/// Execute a specialist command without locking `&mut Agent`. Returns `None` if the
/// command requires mutable `Agent` access (e.g. `overnight start`, `premium`).
pub(super) async fn try_execute_lock_free(
    ctx: &LockFreeCommandContext,
    command: RuntimeCommand,
    args: &[String],
) -> Option<Result<(Value, String)>> {
    if !is_lock_free(command, args) {
        return None;
    }
    Some(match command {
        RuntimeCommand::Auth => auth(args).await,
        RuntimeCommand::Logout => {
            let owned = args.to_vec();
            tokio::task::spawn_blocking(move || logout(&owned))
                .await
                .map_err(anyhow::Error::from)
                .and_then(|res| res)
        }
        RuntimeCommand::Remote => {
            let owned = args.to_vec();
            tokio::task::spawn_blocking(move || remote(&owned))
                .await
                .map_err(anyhow::Error::from)
                .and_then(|res| res)
        }
        RuntimeCommand::Overnight => overnight_lock_free(&ctx.session_id, args).await,
        RuntimeCommand::Background => background(&ctx.session_id, args).await,
        RuntimeCommand::Mcp => mcp(ctx, args).await,
        RuntimeCommand::Telegram => telegram(args).await,
        RuntimeCommand::Features => features(args).await,
        RuntimeCommand::Doctor => doctor(ctx, args).await,
        RuntimeCommand::SessionSearch => session_search(ctx, args).await,
        RuntimeCommand::Schedules => schedules(ctx, args).await,
        RuntimeCommand::Ambient => ambient(args).await,
        RuntimeCommand::Productivity => productivity(args).await,
        RuntimeCommand::Initiatives => initiatives(args),
        _ => return None,
    })
}

async fn auth(args: &[String]) -> Result<(Value, String)> {
    status_args(args)?;
    let status = tokio::task::spawn_blocking(crate::auth::AuthStatus::check_fast).await?;
    let providers: Vec<_> = crate::provider_catalog::auth_status_login_providers()
        .into_iter()
        .map(|provider| {
            let assessment = status.assessment_for_provider(provider);
            json!({"id": provider.id, "display_name": provider.display_name,
            "state": assessment.state, "readiness": assessment.readiness,
            "credential_source": assessment.credential_source,
            "refresh_support": assessment.refresh_support})
        })
        .collect();
    let data = json!({"scope": "runtime host", "providers": providers,
        "note": "Credential readiness is not a live provider request. Secrets and raw credential files are never returned."});
    Ok((
        data.clone(),
        format!(
            "# Runtime authentication\n\n```json\n{}\n```",
            serde_json::to_string_pretty(&data)?
        ),
    ))
}

async fn productivity(args: &[String]) -> Result<(Value, String)> {
    status_args(args)?;
    let output = tokio::task::spawn_blocking(rayucode_productivity_core::generate).await??;
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD.encode(&output.png);
    Ok((
        json!({"report": output.report, "png_path": output.png_path,
        "image": {"media_type": "image/png", "base64": png}, "scope": "runtime host"}),
        output.markdown,
    ))
}

fn initiatives(args: &[String]) -> Result<(Value, String)> {
    status_args(args)?;
    // The obsolete initiative tool was intentionally unregistered upstream.
    // Do not silently re-enable it, or pretend /goals starts tracking again.
    Ok((
        json!({"retired": true, "replacement": "session todo goals"}),
        "Legacy initiatives are retired. The initiative tool is not registered, and this command does not re-enable it. Use the session todo list and its goal assessments for current tracked work. Existing initiative records are preserved.".into(),
    ))
}

pub(super) async fn execute(
    agent: &mut Agent,
    command: RuntimeCommand,
    args: &[String],
) -> Result<(Value, String)> {
    if is_lock_free(command, args) {
        let ctx = LockFreeCommandContext::from_agent(agent);
        if let Some(res) = try_execute_lock_free(&ctx, command, args).await {
            return res;
        }
    }
    match command {
        RuntimeCommand::Overnight => overnight(agent, args).await,
        RuntimeCommand::Premium => {
            let requested = premium_arg(args, agent.premium_mode())?;
            let provider = agent.provider_name();
            if !provider.to_ascii_lowercase().contains("copilot") {
                bail!(
                    "Premium modes apply only to GitHub Copilot sessions. The current provider is {provider}; nothing was changed."
                );
            }
            if let Some(mode) = requested {
                let config = match mode {
                    crate::provider::copilot::PremiumMode::Normal => None,
                    crate::provider::copilot::PremiumMode::OnePerSession => Some("one"),
                    crate::provider::copilot::PremiumMode::Zero => Some("zero"),
                };
                let config_owned = config.map(str::to_string);
                tokio::task::spawn_blocking(move || {
                    crate::config::Config::set_copilot_premium(config_owned.as_deref())
                })
                .await??;
                agent.set_premium_mode(mode);
            }
            let mode = match agent.premium_mode() {
                crate::provider::copilot::PremiumMode::Normal => "normal",
                crate::provider::copilot::PremiumMode::OnePerSession => "one",
                crate::provider::copilot::PremiumMode::Zero => "zero",
            };
            Ok((
                json!({"provider": provider, "mode": mode}),
                format!("Copilot premium mode: `{mode}`."),
            ))
        }
        _ => bail!("Not a specialist runtime command"),
    }
}

fn logout(args: &[String]) -> Result<(Value, String)> {
    use crate::provider_catalog::{LoginProviderTarget, resolve_login_provider};
    let (name, confirmed) = match args {
        [] => return Ok((json!({"confirmation_required": true, "scope": "runtime host"}),
            "Logout requires an explicit provider and confirmation. Use `/auth` to inspect runtime-host credentials, then `/logout <provider> confirm`. For `claude` and `openai`, this removes all Rayu-managed OAuth accounts plus the saved API key for that provider. API-specific ids remove only that saved API key. No credential was removed.".into())),
        [name] => (name.as_str(), false),
        [name, confirmation] if confirmation == "confirm" => (name.as_str(), true),
        _ => bail!("Usage: `/logout <provider> confirm`. Nothing was removed."),
    };
    let provider = resolve_login_provider(name)
        .with_context(|| format!("Unknown provider `{name}`. Nothing was removed."))?;
    let supported = matches!(
        provider.target,
        LoginProviderTarget::Rayu
            | LoginProviderTarget::Claude
            | LoginProviderTarget::ClaudeApiKey
            | LoginProviderTarget::OpenAi
            | LoginProviderTarget::OpenAiApiKey
            | LoginProviderTarget::OpenRouter
            | LoginProviderTarget::Bedrock
            | LoginProviderTarget::Azure
            | LoginProviderTarget::OpenAiCompatible(_)
            | LoginProviderTarget::Cursor
    );
    if !supported {
        bail!(
            "Logout for {} is not supported by the shared runtime credential-removal API. Use that provider's owning account/login application. No credential was removed.",
            provider.display_name
        );
    }
    if !confirmed {
        return Ok((
            json!({"confirmation_required": true, "provider": provider.id, "scope": "runtime host"}),
            format!(
                "To remove {} credentials stored by Rayu on the attached runtime host, run `/logout {} confirm`. For Rayu/Claude/OpenAI this removes every Rayu-managed OAuth account and the saved API key for that provider. Other apps' credentials and externally supplied environment keys are not revoked. No credential was removed.",
                provider.display_name, provider.id
            ),
        ));
    }
    let mut removed_oauth_accounts = 0;
    let mut cleared_api_key = false;
    let mut errors = Vec::new();
    let mut clear_key =
        |env_key: &str, env_file: &str| match crate::provider_catalog::save_env_value_to_env_file(
            env_key, env_file, None,
        ) {
            Ok(()) => cleared_api_key = true,
            Err(error) => errors.push(format!("Saved API-key removal failed: {error}")),
        };
    let has_saved_rayu_api_key = || {
        let prefix = format!("{}=", crate::rayu::RAYU_API_KEY_ENV);
        crate::storage::app_config_dir()
            .ok()
            .and_then(|dir| std::fs::read_to_string(dir.join("rayu.env")).ok())
            .is_some_and(|content| {
                content.lines().any(|line| {
                    line.trim_start()
                        .strip_prefix(&prefix)
                        .is_some_and(|value| !value.trim().is_empty())
                })
            })
    };
    match provider.target {
        LoginProviderTarget::Rayu => {
            let had_session = crate::rayu::config_dir().join("rayu-auth.json").exists();
            let had_saved_api_key = has_saved_rayu_api_key();
            match crate::rayu::logout() {
                Ok(()) => {
                    removed_oauth_accounts = usize::from(had_session);
                    if had_saved_api_key {
                        if has_saved_rayu_api_key() {
                            errors.push(
                                "Saved API-key removal failed: RAYU_API_KEY is still present in rayu.env".into(),
                            );
                        } else {
                            cleared_api_key = true;
                        }
                    }
                }
                Err(error) => errors.push(format!("Rayu credential removal failed: {error}")),
            }
        }
        LoginProviderTarget::Claude => {
            clear_key("ANTHROPIC_API_KEY", "anthropic.env");
            match crate::auth::claude::clear_accounts() {
                Ok(count) => removed_oauth_accounts = count,
                Err(error) => errors.push(format!("OAuth account removal failed: {error}")),
            }
        }
        LoginProviderTarget::OpenAi => {
            clear_key("OPENAI_API_KEY", "openai.env");
            match crate::auth::codex::clear_accounts() {
                Ok(count) => removed_oauth_accounts = count,
                Err(error) => errors.push(format!("OAuth account removal failed: {error}")),
            }
        }
        LoginProviderTarget::ClaudeApiKey => clear_key("ANTHROPIC_API_KEY", "anthropic.env"),
        LoginProviderTarget::OpenAiApiKey => clear_key("OPENAI_API_KEY", "openai.env"),
        LoginProviderTarget::OpenRouter => clear_key("OPENROUTER_API_KEY", "openrouter.env"),
        LoginProviderTarget::Bedrock => clear_key(
            crate::provider::bedrock::API_KEY_ENV,
            crate::provider::bedrock::ENV_FILE,
        ),
        LoginProviderTarget::Azure => clear_key(
            crate::auth::azure::API_KEY_ENV,
            crate::auth::azure::ENV_FILE,
        ),
        LoginProviderTarget::OpenAiCompatible(profile) if profile.id == "muse-subscription" => {
            let had_login = crate::auth::muse::credentials_path()
                .map(|path| path.exists())
                .unwrap_or(false);
            match crate::auth::muse::clear_credentials() {
                Ok(()) => {
                    cleared_api_key = had_login;
                    removed_oauth_accounts = usize::from(had_login);
                }
                Err(error) => errors.push(format!("Muse device-login removal failed: {error}")),
            }
        }
        LoginProviderTarget::OpenAiCompatible(profile) => {
            let profile = crate::provider_catalog::resolve_openai_compatible_profile(profile);
            clear_key(&profile.api_key_env, &profile.env_file);
        }
        LoginProviderTarget::Cursor => match crate::auth::cursor::clear_api_key() {
            Ok(()) => cleared_api_key = true,
            Err(error) => errors.push(format!("Cursor API-key removal failed: {error}")),
        },
        _ => unreachable!("unsupported provider rejected before confirmation"),
    }
    crate::auth::AuthStatus::invalidate_cached_status();
    let data = json!({"provider": provider.id, "scope": "runtime host", "removed_oauth_accounts": removed_oauth_accounts,
        "saved_api_key_cleared": cleared_api_key, "cleared": errors.is_empty(), "errors": errors, "live_provider_reloaded": false,
        "external_credentials_revoked": false});
    let mut message = format!(
        "{} stored credential cleanup: removed {removed_oauth_accounts} Rayu-managed OAuth account(s); saved API key cleared: {cleared_api_key}. Existing provider instances may still hold in-memory credentials until reconnect/reinitialization. External credentials and upstream tokens were not revoked.",
        provider.display_name
    );
    if !errors.is_empty() {
        message.push_str(&format!(
            "\n\nCleanup was only partially successful:\n{}",
            errors.join("\n")
        ));
    }
    Ok((data, message))
}

fn remote(args: &[String]) -> Result<(Value, String)> {
    use crate::gateway::control::{self, RemoteCommand, RemoteStatus, ToggleOutcome};
    let input = format!("/remote {}", args.join(" "));
    let command = control::parse_remote_command(&input)
        .context("Invalid remote command")?
        .map_err(anyhow::Error::msg)?;
    match command {
        RemoteCommand::Cloud => bail!("Rayu Cloud activation belongs to the client's native account/cloud dialog. No local gateway setting was changed. Use Desktop's cloud setup UI."),
        RemoteCommand::Help => Ok((json!({"scope": "runtime host"}),
            "Usage: `/remote status`, `/remote on`, `/remote off`, `/remote pair`, `/remote revoke <device-id-or-name>`. These commands manage the attached runtime host's gateway. Gateway enable/disable settings take effect after a coordinated server restart; no server is restarted automatically. `/remote cloud` uses the client's Cloud setup dialog.".into())),
        RemoteCommand::Status => {
            let status = RemoteStatus::load();
            let devices: Vec<_> = status.devices.iter().map(|device| json!({"id": device.id, "name": device.name, "paired_at": device.paired_at, "last_seen": device.last_seen})).collect();
            Ok((json!({"enabled": status.enabled, "bind_addr": status.bind_addr, "port": status.port, "dial_address": status.dial_address(), "devices": devices, "scope": "runtime host", "listener_health_checked": false}),
                format!("{}\nThis is the runtime host's gateway configuration snapshot, not a live listener health check. Changed settings require a coordinated server restart.", status.to_markdown())))
        }
        RemoteCommand::On | RemoteCommand::Off => {
            let enabled = command == RemoteCommand::On;
            let outcome = control::set_gateway_enabled(enabled)?;
            let changed = matches!(outcome, ToggleOutcome::Changed { .. });
            Ok((json!({"enabled": enabled, "changed": changed, "restart_required": changed, "scope": "runtime host"}),
                if changed { format!("Gateway {} saved on the runtime host. A coordinated server restart is required before this change takes effect. No server was restarted.", if enabled { "enabled" } else { "disabled" }) }
                else { format!("Gateway is already configured {}. No setting was changed or server restarted.", if enabled { "on" } else { "off" }) }))
        }
        RemoteCommand::Pair => {
            let invite = control::create_pairing_invite()?;
            let message = format!("Pairing code: `{}`\n\nDial: `{}`\n\nPairing URI: `{}`\n\nThis code expires in five minutes. Share it only with the device you intend to authorize.{}",
                invite.spaced_code(), invite.dial_address, invite.uri,
                if invite.gateway_enabled { "" } else { " The gateway is not enabled. Run `/remote on` and coordinate a server restart before pairing." });
            Ok((json!({"code": invite.code, "dial_address": invite.dial_address, "uri": invite.uri, "gateway_enabled": invite.gateway_enabled, "expires_in_seconds": 300, "scope": "runtime host"}), message))
        }
        RemoteCommand::Revoke(target) => {
            let removed = control::revoke_device(&target)?;
            let message = if removed.is_empty() { format!("No paired device matched `{target}`. Nothing was revoked.") }
                else { format!("Revoked paired device(s): {}.", removed.join(", ")) };
            Ok((json!({"target": target, "removed": removed, "scope": "runtime host"}), message))
        }
    }
}

async fn overnight_lock_free(session_id: &str, args: &[String]) -> Result<(Value, String)> {
    use crate::overnight::{self, OvernightCommand, OvernightRunStatus};
    if matches!(args.first().map(String::as_str), Some("list")) {
        if args.len() > 1 {
            bail!("Usage: /overnight list");
        }
        return tokio::task::spawn_blocking(|| {
            let root = overnight::runs_dir()?;
            let mut manifests = Vec::new();
            if root.exists() {
                for entry in std::fs::read_dir(&root)? {
                    let entry = entry?;
                    if !entry.file_type()?.is_dir() {
                        continue;
                    }
                    let path = entry.path().join("manifest.json");
                    if let Ok(manifest) =
                        crate::storage::read_json::<overnight::OvernightManifest>(&path)
                    {
                        manifests.push(manifest);
                    }
                }
            }
            manifests.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            let runs: Vec<Value> = manifests
                .iter()
                .map(|manifest| {
                    let summary = overnight::summarize_task_cards(manifest);
                    let mut val = serde_json::to_value(manifest).unwrap_or(Value::Null);
                    if let Some(obj) = val.as_object_mut() {
                        obj.insert(
                            "task_summary".into(),
                            serde_json::to_value(&summary).unwrap_or(Value::Null),
                        );
                    }
                    val
                })
                .collect();
            let data = json!({
                "runs": runs,
                "count": manifests.len(),
            });
            let message = if manifests.is_empty() {
                "No overnight runs recorded.".into()
            } else {
                format!("{} overnight run(s) found.", manifests.len())
            };
            Ok((data, message))
        })
        .await?;
    }

    let input = format!("/overnight {}", args.join(" "));
    let command = overnight::parse_overnight_command(&input)
        .context("Invalid overnight command")?
        .map_err(anyhow::Error::msg)?;
    if command == OvernightCommand::Help {
        return Ok((
            json!({"usage": overnight::overnight_usage()}),
            overnight::overnight_usage().into(),
        ));
    }

    let session_id_owned = session_id.to_owned();
    tokio::task::spawn_blocking(move || {
        let Some(mut manifest) = session_manifest(&session_id_owned)? else {
            return Ok((
                json!({"run": null}),
                "No overnight runs belong to this session.".into(),
            ));
        };
        match command {
            OvernightCommand::Status => {
                let message = overnight::format_status_markdown(&manifest);
                Ok((serde_json::to_value(manifest)?, message))
            }
            OvernightCommand::Log => {
                let message = overnight::format_log_markdown(&manifest, 100);
                Ok((
                    json!({"run_id": manifest.run_id, "events": overnight::read_events(&manifest)?}),
                    message,
                ))
            }
            OvernightCommand::Review => {
                // Return the actual review document, not an opener on the remote host.
                overnight::render_review_html(&manifest)?;
                let html = std::fs::read_to_string(&manifest.review_path)?;
                let cards = overnight::read_task_cards(&manifest)?;
                let mut message = format!(
                    "# Overnight review: {}\n\n{}\n\n## Task outcomes\n",
                    manifest.run_id,
                    overnight::format_status_markdown(&manifest)
                );
                if cards.is_empty() {
                    message.push_str("\nNo task cards have been recorded yet.\n");
                }
                for card in &cards {
                    message.push_str(&format!(
                        "\n### {}\n\nStatus: {}\n",
                        card.title, card.status
                    ));
                    if let Some(outcome) = &card.outcome {
                        message.push_str(&format!("\n{outcome}\n"));
                    }
                    if let Some(result) = &card.validation.result {
                        message.push_str(&format!("\nValidation: {result}\n"));
                    }
                    for evidence in &card.validation.evidence {
                        message.push_str(&format!("- Evidence: {evidence}\n"));
                    }
                    for followup in &card.followups {
                        message.push_str(&format!("- Follow-up: {followup}\n"));
                    }
                }
                Ok((
                    json!({"run_id": manifest.run_id, "html": html, "path": manifest.review_path, "tasks": cards}),
                    message,
                ))
            }
            OvernightCommand::Cancel => {
                if !matches!(
                    manifest.status,
                    OvernightRunStatus::Completed | OvernightRunStatus::Failed
                ) {
                    manifest.status = OvernightRunStatus::CancelRequested;
                    manifest.cancel_requested_at = Some(chrono::Utc::now());
                    overnight::save_manifest(&manifest)?;
                    overnight::record_event(
                        &manifest,
                        "cancel_requested",
                        "User requested overnight cancellation".into(),
                        json!({}),
                        true,
                    )?;
                    overnight::render_review_html(&manifest)?;
                }
                let message = overnight::format_status_markdown(&manifest);
                Ok((serde_json::to_value(manifest)?, message))
            }
            OvernightCommand::Start { .. } | OvernightCommand::Help => {
                bail!("Overnight start requires an idle session")
            }
        }
    })
    .await?
}

async fn overnight(agent: &mut Agent, args: &[String]) -> Result<(Value, String)> {
    use crate::overnight::{self, OvernightCommand, OvernightRunStatus};
    let input = format!("/overnight {}", args.join(" "));
    let command = overnight::parse_overnight_command(&input)
        .context("Invalid overnight command")?
        .map_err(anyhow::Error::msg)?;
    let OvernightCommand::Start { duration, mission } = command else {
        return overnight_lock_free(agent.session_id(), args).await;
    };
    let session_id = agent.session_id().to_owned();
    let existing = {
        let sid = session_id.clone();
        tokio::task::spawn_blocking(move || session_manifest(&sid)).await??
    };
    if let Some(existing) = existing
        && matches!(
            existing.status,
            OvernightRunStatus::Running | OvernightRunStatus::CancelRequested
        )
    {
        bail!(
            "This session already has an active overnight run {}. Inspect status or cancel it before starting another.",
            existing.run_id
        );
    }
    let launch = overnight::start_overnight_run(overnight::OvernightStartOptions {
        duration,
        mission,
        parent_session: agent.session_for_split().clone(),
        provider: agent.provider_fork(),
        registry: agent.registry(),
        working_dir: agent.working_dir().map(std::path::PathBuf::from),
        use_current_session: false,
    })?;
    let message = format!(
        "Started supervised overnight coordinator `{}` in session `{}`. Target wake: {}. Use `/overnight status`, `/overnight log`, `/overnight review`, or `/overnight cancel`.",
        launch.manifest.run_id,
        launch.manifest.coordinator_session_id,
        launch.manifest.target_wake_at.to_rfc3339()
    );
    Ok((serde_json::to_value(launch.manifest)?, message))
}

fn direct_tool_ctx_from_lock_free(ctx: &LockFreeCommandContext) -> crate::tool::ToolContext {
    crate::tool::ToolContext {
        session_id: ctx.session_id.clone(),
        message_id: crate::id::new_id("msg"),
        tool_call_id: crate::id::new_id("call"),
        working_dir: ctx.working_dir.clone(),
        stdin_request_tx: None,
        graceful_shutdown_signal: None,
        execution_mode: crate::tool::ToolExecutionMode::Direct,
    }
}

fn background_task_json(
    manager: &crate::background::BackgroundTaskManager,
    task: &crate::background::TaskStatusFile,
) -> Value {
    json!({
        "task_id": task.task_id,
        "session_id": task.session_id,
        "tool_name": task.tool_name,
        "display_name": task.display_name,
        "status": task.status,
        "exit_code": task.exit_code,
        "error": task.error,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
        "duration_secs": task.duration_secs,
        "detached": task.detached,
        "pid": task.pid,
        "notify": task.notify,
        "wake": task.wake,
        "stall_wake_seconds": task.stall_wake_seconds,
        "progress": task.progress,
        "output_file": manager.output_path_for(&task.task_id).display().to_string(),
        "live": manager.is_live_task(&task.task_id),
    })
}

async fn background(session_id: &str, args: &[String]) -> Result<(Value, String)> {
    use crate::bus::BackgroundTaskStatus;
    let manager = crate::background::global();
    let sub = args.first().map(String::as_str).unwrap_or("list");
    match sub {
        "list" => {
            let filter = args.get(1).map(|s| s.to_ascii_lowercase());
            let mut tasks = manager.list().await;
            if let Some(ref f) = filter {
                match f.as_str() {
                    "all" => {}
                    "session" => tasks.retain(|t| t.session_id == session_id),
                    "running" => tasks.retain(|t| t.status == BackgroundTaskStatus::Running),
                    "completed" | "done" => {
                        tasks.retain(|t| t.status == BackgroundTaskStatus::Completed)
                    }
                    "failed" => tasks.retain(|t| t.status == BackgroundTaskStatus::Failed),
                    "superseded" => {
                        tasks.retain(|t| t.status == BackgroundTaskStatus::Superseded)
                    }
                    other => bail!(
                        "Unknown background list filter `{other}`. Expected all, session, running, completed, failed, or superseded."
                    ),
                }
            }
            let running_count = tasks
                .iter()
                .filter(|t| t.status == BackgroundTaskStatus::Running)
                .count();
            let completed_count = tasks
                .iter()
                .filter(|t| t.status == BackgroundTaskStatus::Completed)
                .count();
            let failed_count = tasks
                .iter()
                .filter(|t| t.status == BackgroundTaskStatus::Failed)
                .count();
            let items: Vec<Value> = tasks
                .iter()
                .map(|t| background_task_json(manager, t))
                .collect();
            let data = json!({
                "tasks": items,
                "total_count": tasks.len(),
                "running_count": running_count,
                "completed_count": completed_count,
                "failed_count": failed_count,
            });
            let message = format!(
                "Background tasks: {} total ({} running, {} completed, {} failed).",
                tasks.len(),
                running_count,
                completed_count,
                failed_count
            );
            Ok((data, message))
        }
        "status" => {
            let id = args
                .get(1)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("Usage: background status <task_id>"))?;
            let Some(task) = manager.status(id).await else {
                bail!("Background task `{id}` not found");
            };
            let task_json = background_task_json(manager, &task);
            let data = json!({
                "task": task_json,
                "live": manager.is_live_task(id),
            });
            let message = format!("Background task `{id}`: {:?}", task.status);
            Ok((data, message))
        }
        "output" => {
            let id = args
                .get(1)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("Usage: background output <task_id> [max_bytes]"))?;
            let max_bytes: usize = match args.get(2) {
                Some(raw) => raw
                    .parse::<usize>()
                    .with_context(|| format!("Invalid max_bytes `{raw}`"))?
                    .clamp(1, 1_048_576),
                None => 131_072,
            };
            let output_path = manager.output_path_for(id);
            let Some(full) = manager.output(id).await else {
                bail!("No output file found for background task `{id}`");
            };
            let total_bytes = full.len();
            let truncated = total_bytes > max_bytes;
            let tail = if truncated {
                let start = full.ceil_char_boundary(total_bytes - max_bytes);
                full[start..].to_string()
            } else {
                full
            };
            let data = json!({
                "task_id": id,
                "output": tail,
                "total_bytes": total_bytes,
                "truncated": truncated,
                "output_file": output_path.display().to_string(),
            });
            let message = format!(
                "Read {} byte(s) from background task `{id}`{}.",
                data["output"].as_str().map(str::len).unwrap_or(0),
                if truncated { " (truncated tail)" } else { "" }
            );
            Ok((data, message))
        }
        "cancel" => {
            let id = args
                .get(1)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("Usage: background cancel <task_id>"))?;
            let cancelled = manager.cancel(id).await?;
            let data = json!({
                "task_id": id,
                "cancelled": cancelled,
            });
            let message = if cancelled {
                format!("Cancelled background task `{id}`.")
            } else {
                format!("Background task `{id}` was not running or was not found.")
            };
            Ok((data, message))
        }
        "cleanup" => {
            let max_age_hours: u64 = match args.get(1) {
                Some(raw) => raw
                    .parse::<u64>()
                    .with_context(|| format!("Invalid max_age_hours `{raw}`"))?,
                None => 0,
            };
            let result = manager
                .cleanup_filtered(max_age_hours, &std::collections::HashSet::new(), false)
                .await?;
            let data = json!({
                "matched_files": result.matched_files,
                "removed_files": result.removed_files,
                "skipped_running_files": result.skipped_running_files,
                "max_age_hours": max_age_hours,
            });
            let message = format!(
                "Cleaned up {} background task file(s) ({} running skipped).",
                result.removed_files, result.skipped_running_files
            );
            Ok((data, message))
        }
        other => bail!(
            "Unknown background subcommand `{other}`. Usage: background [list|status <id>|output <id> [max_bytes]|cancel <id>|cleanup [max_age_hours]]"
        ),
    }
}

async fn mcp(ctx: &LockFreeCommandContext, args: &[String]) -> Result<(Value, String)> {
    let sub = args.first().map(String::as_str).unwrap_or("list");
    let working_dir_owned = ctx.working_dir.clone();
    match sub {
        "list" | "status" => {
            let filter_id = args.get(1).cloned();
            let registry = ctx.registry.clone();
            tokio::task::spawn_blocking(move || {
                let config = crate::mcp::McpConfig::load_for_dir(working_dir_owned.as_deref());
                let schema_cache = crate::mcp::McpSchemaCache::load();
                let mut names: Vec<String> = config.servers.keys().cloned().collect();
                names.sort();
                if let Some(ref id) = filter_id {
                    names.retain(|n| n == id);
                    if names.is_empty() {
                        bail!("MCP server `{id}` is not configured.");
                    }
                }
                let mut servers = Vec::with_capacity(names.len());
                let mut enabled_count = 0usize;
                let mut connected_count = 0usize;
                for name in &names {
                    let cfg = &config.servers[name];
                    let enabled = cfg.is_enabled();
                    if enabled {
                        enabled_count += 1;
                    }
                    let connected = registry
                        .as_ref()
                        .is_some_and(|reg| reg.has_mcp_tools_for_server(name));
                    if connected {
                        connected_count += 1;
                    }
                    let status = if !enabled {
                        "disabled"
                    } else if connected {
                        "connected"
                    } else {
                        "disconnected"
                    };
                    let transport = cfg
                        .remote_transport()
                        .map(|kind| kind.label())
                        .unwrap_or("stdio");
                    let cached_tools: Vec<String> = schema_cache
                        .tools_for(name, cfg)
                        .map(|defs| defs.iter().map(|d| d.name.clone()).collect())
                        .unwrap_or_default();
                    let oauth_logged_in = if cfg.is_remote() {
                        cfg.url
                            .as_deref()
                            .and_then(|url| crate::mcp::oauth::status(url).ok())
                            .map(|s| s.logged_in)
                    } else {
                        None
                    };
                    servers.push(json!({
                        "id": name,
                        "status": status,
                        "enabled": enabled,
                        "connected": connected,
                        "transport": transport,
                        "shared": cfg.shared,
                        "command": if cfg.command.is_empty() { Value::Null } else { json!(cfg.command) },
                        "args": cfg.args,
                        "url": cfg.url,
                        "timeout_secs": cfg.timeout_secs,
                        "display_target": cfg.display_target(),
                        "cached_tool_count": cached_tools.len(),
                        "cached_tools": cached_tools,
                        "oauth_logged_in": oauth_logged_in,
                    }));
                }
                let data = json!({
                    "servers": servers,
                    "total": names.len(),
                    "enabled_count": enabled_count,
                    "connected_count": connected_count,
                });
                let message = format!(
                    "MCP servers: {} configured ({} enabled, {} active in session).",
                    names.len(),
                    enabled_count,
                    connected_count
                );
                Ok((data, message))
            })
            .await?
        }
        "test" => {
            let id = args
                .get(1)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("Usage: mcp test <server_id>"))?
                .clone();
            let id_for_load = id.clone();
            let server_cfg = tokio::task::spawn_blocking(move || {
                let config = crate::mcp::McpConfig::load_for_dir(working_dir_owned.as_deref());
                config
                    .servers
                    .get(&id_for_load)
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("MCP server `{id_for_load}` is not configured."))
            })
            .await??;
            let mut single = crate::mcp::McpConfig::default();
            single.servers.insert(id.clone(), server_cfg.clone());
            let manager = crate::mcp::McpManager::with_config(single);
            match manager.connect(&id, &server_cfg).await {
                Ok(()) => {
                    let defs = manager.server_tools(&id).await.unwrap_or_default();
                    let tool_names: Vec<String> = defs.iter().map(|d| d.name.clone()).collect();
                    let _ = manager.disconnect(&id).await;
                    let data = json!({
                        "id": id,
                        "ok": true,
                        "tool_count": tool_names.len(),
                        "tools": tool_names,
                        "error": null,
                    });
                    let message = format!(
                        "MCP server `{id}` connected successfully ({} tool(s)).",
                        tool_names.len()
                    );
                    Ok((data, message))
                }
                Err(error) => {
                    let err_msg = format!("{error:#}");
                    let data = json!({
                        "id": id,
                        "ok": false,
                        "tool_count": 0,
                        "tools": [],
                        "error": err_msg,
                    });
                    let message = format!("MCP server `{id}` test failed: {err_msg}");
                    Ok((data, message))
                }
            }
        }
        "toggle" => {
            let (Some(id), Some(state_raw)) = (args.get(1), args.get(2)) else {
                bail!("Usage: mcp toggle <server_id> <on|off>");
            };
            let enable = match state_raw.to_ascii_lowercase().as_str() {
                "on" | "enable" | "enabled" | "true" | "1" => true,
                "off" | "disable" | "disabled" | "false" | "0" => false,
                _ => bail!("Expected `on` or `off` for mcp toggle"),
            };
            let id = id.clone();
            tokio::task::spawn_blocking(move || {
                let mut candidate_paths = Vec::new();
                if let Some(ref dir) = working_dir_owned {
                    candidate_paths.push(dir.join(".rayu").join("mcp.json"));
                    candidate_paths.push(dir.join(".mcp.json"));
                }
                let global_path = crate::storage::rayu_dir()?.join("mcp.json");
                candidate_paths.push(global_path.clone());

                let target_path = candidate_paths
                    .iter()
                    .find(|path| {
                        path.is_file()
                            && crate::mcp::McpConfig::load_from_file(path)
                                .is_ok_and(|cfg| cfg.servers.contains_key(&id))
                    })
                    .cloned()
                    .unwrap_or(global_path);

                let mut file_cfg = if target_path.is_file() {
                    crate::mcp::McpConfig::load_from_file(&target_path)?
                } else {
                    crate::mcp::McpConfig::default()
                };
                if let Some(entry) = file_cfg.servers.get_mut(&id) {
                    entry.enabled = Some(enable);
                    entry.disabled = Some(!enable);
                } else {
                    let merged = crate::mcp::McpConfig::load_for_dir(working_dir_owned.as_deref());
                    let Some(mut cloned) = merged.servers.get(&id).cloned() else {
                        bail!("MCP server `{id}` is not configured.");
                    };
                    cloned.enabled = Some(enable);
                    cloned.disabled = Some(!enable);
                    file_cfg.servers.insert(id.clone(), cloned);
                }
                file_cfg.save_to_file(&target_path)?;
                let data = json!({
                    "id": id,
                    "enabled": enable,
                    "status": if enable { "disconnected" } else { "disabled" },
                    "config_path": target_path.display().to_string(),
                    "reload_required": true,
                });
                let message = format!(
                    "MCP server `{id}` {} in `{}`.",
                    if enable { "enabled" } else { "disabled" },
                    target_path.display()
                );
                Ok((data, message))
            })
            .await?
        }
        "reload" => {
            if let Some(ref registry) = ctx.registry
                && registry.tool_names().await.iter().any(|n| n == "mcp")
            {
                let output = registry
                    .execute(
                        "mcp",
                        json!({"action": "reload", "intent": "Reload MCP servers"}),
                        direct_tool_ctx_from_lock_free(ctx),
                    )
                    .await?;
                let configured_count = tokio::task::spawn_blocking(move || {
                    crate::mcp::McpConfig::load_for_dir(working_dir_owned.as_deref())
                        .servers
                        .len()
                })
                .await?;
                let data = json!({
                    "reloaded": true,
                    "configured_count": configured_count,
                    "detail": output.output,
                });
                Ok((data, output.output))
            } else {
                let configured_count = tokio::task::spawn_blocking(move || {
                    crate::mcp::McpConfig::load_for_dir(working_dir_owned.as_deref())
                        .servers
                        .len()
                })
                .await?;
                let data = json!({
                    "reloaded": false,
                    "configured_count": configured_count,
                    "detail": "MCP management tool is not registered in this session.",
                });
                Ok((
                    data,
                    "MCP configuration inspected; no live MCP manager attached to this session."
                        .into(),
                ))
            }
        }
        other => bail!(
            "Unknown mcp subcommand `{other}`. Usage: mcp [list|status [id]|test <id>|toggle <id> <on|off>|reload]"
        ),
    }
}

async fn telegram(args: &[String]) -> Result<(Value, String)> {
    let sub = args.first().map(String::as_str).unwrap_or("status");
    match sub {
        "status" => {
            tokio::task::spawn_blocking(|| {
                let link = crate::telegram_remote::load()?;
                let uninstall_enabled = crate::telegram_remote::uninstall::enabled();
                let pending_count = crate::safety::telegram::pending().len();
                let data = match link {
                    Some(link) => {
                        let mode = match link.mode {
                            rayucode_base::telegram::remote::Mode::Hosted { .. } => "hosted",
                            rayucode_base::telegram::remote::Mode::BotFather { .. } => "botfather",
                        };
                        json!({
                            "linked": link.owner.is_some(),
                            "configured": true,
                            "status": link.status(),
                            "username": link.username,
                            "mode": mode,
                            "owner_chat_id": link.owner,
                            "selected_session": link.selected,
                            "pending_until": link.pending_until,
                            "uninstall_enabled": uninstall_enabled,
                            "pending_approvals_count": pending_count,
                        })
                    }
                    None => json!({
                        "linked": false,
                        "configured": false,
                        "status": "Disconnected",
                        "username": null,
                        "mode": null,
                        "owner_chat_id": null,
                        "selected_session": null,
                        "pending_until": null,
                        "uninstall_enabled": uninstall_enabled,
                        "pending_approvals_count": pending_count,
                    }),
                };
                let message = format!(
                    "Telegram status: {} (pending approvals: {}, remote uninstall: {}).",
                    data["status"].as_str().unwrap_or("Disconnected"),
                    pending_count,
                    if uninstall_enabled { "enabled" } else { "disabled" }
                );
                Ok((data, message))
            })
            .await?
        }
        "approvals" => {
            tokio::task::spawn_blocking(|| {
                let approvals: Vec<Value> = crate::safety::telegram::pending()
                    .into_iter()
                    .map(|approval| {
                        json!({
                            "id": approval.request.id,
                            "action": approval.request.action,
                            "description": approval.request.description,
                            "rationale": approval.request.rationale,
                            "urgency": approval.request.urgency,
                            "created_at": approval.request.created_at,
                            "context": approval.request.context,
                        })
                    })
                    .collect();
                let count = approvals.len();
                let data = json!({
                    "approvals": approvals,
                    "count": count,
                });
                let message = if count == 0 {
                    "No pending Telegram approval requests.".into()
                } else {
                    format!("{count} pending Telegram approval request(s).")
                };
                Ok((data, message))
            })
            .await?
        }
        "decide" => {
            let (Some(id), Some(verdict)) = (args.get(1), args.get(2)) else {
                bail!("Usage: telegram decide <request_id> <allow|deny>");
            };
            let approved = match verdict.to_ascii_lowercase().as_str() {
                "allow" | "approve" | "approved" | "yes" => true,
                "deny" | "reject" | "denied" | "no" => false,
                _ => bail!("Expected `allow` or `deny` for telegram decide"),
            };
            let id = id.clone();
            tokio::task::spawn_blocking(move || {
                crate::safety::telegram::decide(&id, approved, "harness_api", None, None)?;
                let data = json!({
                    "id": id,
                    "approved": approved,
                    "decided_via": "harness_api",
                });
                let message = format!(
                    "Telegram approval `{id}` {}.",
                    if approved { "approved" } else { "denied" }
                );
                Ok((data, message))
            })
            .await?
        }
        "uninstall" => {
            let action = args.get(1).cloned().unwrap_or_else(|| "status".into());
            tokio::task::spawn_blocking(move || {
                match action.as_str() {
                    "status" | "show" => {}
                    "enable" | "on" => crate::telegram_remote::uninstall::set_enabled(true)?,
                    "disable" | "off" => crate::telegram_remote::uninstall::set_enabled(false)?,
                    other => {
                        bail!("Usage: telegram uninstall <status|enable|disable> (got `{other}`)")
                    }
                }
                let enabled = crate::telegram_remote::uninstall::enabled();
                let data = json!({ "enabled": enabled });
                let message = format!(
                    "Telegram remote uninstall is {}.",
                    if enabled { "enabled" } else { "disabled" }
                );
                Ok((data, message))
            })
            .await?
        }
        "disconnect" => {
            let Some(link) = tokio::task::spawn_blocking(crate::telegram_remote::load).await??
            else {
                return Ok((
                    json!({ "disconnected": false, "was_linked": false }),
                    "Telegram is not currently linked.".into(),
                ));
            };
            let username = link.username.clone();
            crate::telegram_remote::disconnect(&link).await?;
            let data = json!({
                "disconnected": true,
                "was_linked": true,
                "username": username,
            });
            Ok((data, format!("Disconnected Telegram bot @{username}.")))
        }
        "link_hosted" => {
            let replace_existing = args
                .get(1)
                .is_some_and(|arg| matches!(arg.as_str(), "replace" | "--replace-existing"));
            let (link, pairing_url) =
                crate::telegram_remote::hosted_pairing(replace_existing).await?;
            let data = json!({
                "username": link.username,
                "status": link.status(),
                "pairing_url": pairing_url,
                "pending_until": link.pending_until,
            });
            let message = format!("Pairing link generated for @{}: {pairing_url}", link.username);
            Ok((data, message))
        }
        other => bail!(
            "Unknown telegram subcommand `{other}`. Usage: telegram [status|approvals|decide <id> <allow|deny>|uninstall <status|enable|disable>|disconnect|link_hosted [replace]]"
        ),
    }
}

fn parse_bool_flag(raw: &str) -> Result<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "true" | "on" | "yes" | "1" | "enable" | "enabled" => Ok(true),
        "false" | "off" | "no" | "0" | "disable" | "disabled" => Ok(false),
        other => bail!("Expected a boolean value (true/false/on/off), got `{other}`"),
    }
}

fn update_channel_str(channel: crate::config::UpdateChannel) -> &'static str {
    match channel {
        crate::config::UpdateChannel::Stable => "stable",
        crate::config::UpdateChannel::Preview => "preview",
        crate::config::UpdateChannel::Main => "main",
    }
}

fn features_snapshot(cfg: &crate::config::Config) -> Value {
    json!({
        "features": {
            "check_updates": cfg.features.check_updates,
            "memory": cfg.features.memory,
            "swarm": cfg.features.swarm,
            "mermaid": cfg.features.mermaid,
            "auto_poke": cfg.features.auto_poke,
            "todo_gate_digest": cfg.features.todo_gate_digest,
            "todo_gate_diagnostics": cfg.features.todo_gate_diagnostics,
            "message_timestamps": cfg.features.message_timestamps,
            "persist_memory_injections": cfg.features.persist_memory_injections,
            "kv_cache_miss_notices": cfg.features.kv_cache_miss_notices,
            "update_channel": update_channel_str(cfg.features.update_channel),
        },
        "tools": {
            "codemode": cfg.tools.codemode,
            "integration_tools": cfg.sponsors.enabled,
        },
        "config_path": crate::config::Config::path().map(|p| p.display().to_string()),
    })
}

/// Update or insert a single scalar key inside `[section]` of a TOML document
/// without disturbing user comments, formatting, inline comments, or unknown keys/tables.
fn patch_toml_key_preserving_comments(
    existing: &str,
    section: &str,
    key: &str,
    value_literal: &str,
) -> String {
    let lines: Vec<&str> = existing.lines().collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 3);
    let mut in_target_section = false;
    let mut section_found = false;
    let mut key_updated = false;
    let mut insert_at: Option<usize> = None;

    for line in &lines {
        let trimmed = line.trim();
        let header = trimmed
            .split('#')
            .next()
            .unwrap_or("")
            .trim();
        let is_table_header = header.starts_with('[') && header.ends_with(']');
        if is_table_header {
            if in_target_section && !key_updated {
                insert_at = Some(out.len());
            }
            let table_name = header
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim();
            in_target_section = !header.starts_with("[[") && table_name == section;
            if in_target_section {
                section_found = true;
            }
            out.push((*line).to_string());
            continue;
        }

        if in_target_section && !key_updated && !trimmed.starts_with('#') {
            if let Some((lhs, rhs)) = line.split_once('=')
                && lhs.trim() == key
            {
                let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                let inline_comment = extract_toml_inline_comment(rhs);
                if let Some(comment) = inline_comment {
                    out.push(format!("{indent}{key} = {value_literal} {comment}"));
                } else {
                    out.push(format!("{indent}{key} = {value_literal}"));
                }
                key_updated = true;
                continue;
            }
        }
        out.push((*line).to_string());
    }

    if !key_updated {
        if section_found {
            let mut idx = insert_at.unwrap_or(out.len());
            while idx > 0 && out[idx - 1].trim().is_empty() {
                idx -= 1;
            }
            out.insert(idx, format!("{key} = {value_literal}"));
        } else {
            if !out.is_empty() && !out.last().is_some_and(|l| l.trim().is_empty()) {
                out.push(String::new());
            }
            out.push(format!("[{section}]"));
            out.push(format!("{key} = {value_literal}"));
        }
    }

    let mut result = out.join("\n");
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

fn extract_toml_inline_comment(rhs: &str) -> Option<&str> {
    let mut in_double = false;
    let mut in_single = false;
    let mut escaped = false;
    for (idx, ch) in rhs.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_double => escaped = true,
            '"' if !in_single => in_double = !in_double,
            '\'' if !in_double => in_single = !in_single,
            '#' if !in_double && !in_single => return Some(rhs[idx..].trim_end()),
            _ => {}
        }
    }
    None
}

async fn features(args: &[String]) -> Result<(Value, String)> {
    let sub = args.first().map(String::as_str).unwrap_or("status");
    match sub {
        "status" | "show" => {
            if args.len() > 1 {
                bail!("Usage: features [status|set <key> <val>]");
            }
            tokio::task::spawn_blocking(|| {
                let cfg = crate::config::Config::load();
                let data = features_snapshot(&cfg);
                let message = serde_json::to_string_pretty(&data)?;
                Ok((data, message))
            })
            .await?
        }
        "set" => {
            let (Some(key), Some(val)) = (args.get(1), args.get(2)) else {
                bail!("Usage: features set <key> <val>");
            };
            if args.len() > 3 {
                bail!("Usage: features set <key> <val>");
            }
            let (section, toml_key, applied_val, toml_literal): (&'static str, &'static str, Value, String) =
                match key.as_str() {
                    "check_updates" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "check_updates", json!(v), v.to_string())
                    }
                    "memory" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "memory", json!(v), v.to_string())
                    }
                    "swarm" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "swarm", json!(v), v.to_string())
                    }
                    "mermaid" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "mermaid", json!(v), v.to_string())
                    }
                    "auto_poke" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "auto_poke", json!(v), v.to_string())
                    }
                    "todo_gate_digest" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "todo_gate_digest", json!(v), v.to_string())
                    }
                    "todo_gate_diagnostics" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "todo_gate_diagnostics", json!(v), v.to_string())
                    }
                    "message_timestamps" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "message_timestamps", json!(v), v.to_string())
                    }
                    "persist_memory_injections" => {
                        let v = parse_bool_flag(val)?;
                        (
                            "features",
                            "persist_memory_injections",
                            json!(v),
                            v.to_string(),
                        )
                    }
                    "kv_cache_miss_notices" => {
                        let v = parse_bool_flag(val)?;
                        ("features", "kv_cache_miss_notices", json!(v), v.to_string())
                    }
                    "update_channel" => {
                        let Some(channel) = crate::config::UpdateChannel::parse(val) else {
                            bail!("Invalid update_channel `{val}`. Expected stable, preview, or main.");
                        };
                        let s = update_channel_str(channel);
                        ("features", "update_channel", json!(s), format!("\"{s}\""))
                    }
                    "codemode" => {
                        let v = parse_bool_flag(val)?;
                        ("tools", "codemode", json!(v), v.to_string())
                    }
                    "integration_tools" => {
                        let v = parse_bool_flag(val)?;
                        ("sponsors", "enabled", json!(v), v.to_string())
                    }
                    other => bail!(
                        "Unknown feature key `{other}`. Supported: check_updates, memory, swarm, mermaid, auto_poke, todo_gate_digest, todo_gate_diagnostics, message_timestamps, persist_memory_injections, kv_cache_miss_notices, update_channel, codemode, integration_tools"
                    ),
                };
            let key_owned = key.clone();
            tokio::task::spawn_blocking(move || {
                let path = crate::config::Config::path()
                    .ok_or_else(|| anyhow::anyhow!("No config path"))?;
                let existing = if path.exists() {
                    std::fs::read_to_string(&path)
                        .with_context(|| format!("Failed to read config file {}", path.display()))?
                } else {
                    String::new()
                };
                if !existing.trim().is_empty() {
                    toml::from_str::<crate::config::Config>(&existing).with_context(|| {
                        format!("Failed to parse existing config file {}", path.display())
                    })?;
                }
                let updated = patch_toml_key_preserving_comments(
                    &existing,
                    section,
                    toml_key,
                    &toml_literal,
                );
                toml::from_str::<crate::config::Config>(&updated)
                    .context("Updated config.toml failed validation")?;
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let tmp = path.with_extension("toml.tmp");
                std::fs::write(&tmp, &updated)?;
                std::fs::rename(&tmp, &path)?;
                crate::config::Config::invalidate_cache();

                let effective = crate::config::Config::load();
                let mut snapshot = features_snapshot(&effective);
                if let Some(obj) = snapshot.as_object_mut() {
                    obj.insert("key".into(), json!(key_owned));
                    obj.insert("value".into(), applied_val.clone());
                }
                let message = format!("Updated feature `{key_owned}` = {applied_val}.");
                Ok((snapshot, message))
            })
            .await?
        }
        other => bail!("Unknown features subcommand `{other}`. Usage: features [status|set <key> <val>]"),
    }
}

const LIFECYCLE_HOOKS: [&str; 7] = [
    "pre_tool",
    "post_tool",
    "post_tool_feedback",
    "turn_start",
    "turn_end",
    "session_start",
    "session_end",
];

async fn doctor(ctx: &LockFreeCommandContext, args: &[String]) -> Result<(Value, String)> {
    let scope = args.first().map(String::as_str).unwrap_or("all");
    if !matches!(scope, "all" | "providers" | "auth" | "status") || args.len() > 1 {
        bail!("Usage: doctor [all|providers|auth]");
    }
    let mut checks: Vec<Value> = Vec::new();
    let mut pass = 0usize;
    let mut warn = 0usize;
    let mut fail = 0usize;

    let mut push_check = |category: &str, id: &str, name: &str, status: &str, detail: String| {
        match status {
            "pass" => pass += 1,
            "warn" => warn += 1,
            _ => fail += 1,
        }
        checks.push(json!({
            "category": category,
            "id": id,
            "name": name,
            "label": name,
            "status": status,
            "detail": detail,
        }));
    };

    if matches!(scope, "all" | "auth" | "status") {
        let auth_status =
            tokio::task::spawn_blocking(crate::auth::AuthStatus::check_fast).await?;
        for provider in crate::provider_catalog::auth_status_login_providers() {
            let assessment = auth_status.assessment_for_provider(provider);
            let status = match assessment.state {
                crate::auth::AuthState::Available => "pass",
                crate::auth::AuthState::Expired => "warn",
                crate::auth::AuthState::NotConfigured => "warn",
            };
            push_check(
                "auth",
                provider.id,
                provider.display_name,
                status,
                format!(
                    "state={:?}, readiness={:?}, source={:?}",
                    assessment.state, assessment.readiness, assessment.credential_source
                ),
            );
        }
    }

    let check_providers = matches!(scope, "all" | "providers" | "status");
    let working_dir_owned = ctx.working_dir.clone();
    let (config_result, mcp_summary, hooks) = tokio::task::spawn_blocking(move || {
        let cfg_res = if check_providers {
            Some(crate::config::Config::load_strict().map(|_| ()).map_err(|e| e.to_string()))
        } else {
            None
        };
        let mcp_counts = if check_providers {
            let mcp_cfg = crate::mcp::McpConfig::load_for_dir(working_dir_owned.as_deref());
            let enabled_mcp = mcp_cfg.servers.values().filter(|s| s.is_enabled()).count();
            Some((mcp_cfg.servers.len(), enabled_mcp))
        } else {
            None
        };
        let hooks: Vec<Value> = LIFECYCLE_HOOKS
            .into_iter()
            .map(|name| {
                json!({
                    "name": name,
                    "configured": crate::hooks::hook_configured(name),
                })
            })
            .collect();
        (cfg_res, mcp_counts, hooks)
    })
    .await?;

    if check_providers {
        match config_result {
            Some(Ok(())) => push_check(
                "config",
                "config_toml",
                "config.toml",
                "pass",
                "Configuration parsed cleanly.".into(),
            ),
            Some(Err(err)) => push_check(
                "config",
                "config_toml",
                "config.toml",
                "fail",
                format!("Config parse error: {err}"),
            ),
            None => {}
        }

        let routes_summary = match ctx.route_counts {
            Some((available, total)) => format!("{available}/{total} available"),
            None => "active turn".to_string(),
        };
        push_check(
            "providers",
            "active_provider",
            &ctx.provider_name,
            "pass",
            format!(
                "model={}, transport={}, context_window={}, routes={routes_summary}",
                ctx.provider_model,
                ctx.provider_transport.as_deref().unwrap_or("default"),
                ctx.provider_context_window,
            ),
        );

        if let Some((total_mcp, enabled_mcp)) = mcp_summary {
            push_check(
                "providers",
                "mcp_config",
                "MCP Configuration",
                "pass",
                format!("{total_mcp} server(s) configured ({enabled_mcp} enabled)"),
            );
        }

        let configured_hooks = hooks
            .iter()
            .filter(|h| h["configured"] == true)
            .count();
        push_check(
            "providers",
            "lifecycle_hooks",
            "Lifecycle Hooks",
            "pass",
            format!("{configured_hooks}/{} hooks configured", LIFECYCLE_HOOKS.len()),
        );
    }

    let data = json!({
        "scope": scope,
        "checks": checks,
        "summary": {
            "pass": pass,
            "warn": warn,
            "fail": fail,
        },
        "active_provider": ctx.provider_name,
        "active_model": ctx.provider_model,
        "hooks": hooks,
    });
    let message = format!(
        "Doctor ({scope}): {pass} pass, {warn} warn, {fail} fail."
    );
    Ok((data, message))
}

async fn session_search(ctx: &LockFreeCommandContext, args: &[String]) -> Result<(Value, String)> {
    use crate::tool::Tool;
    if args.is_empty() {
        bail!("Usage: session_search <query> [--scope <rayu|claude|codex|cursor|pi|opencode|all>] [--limit <n>]");
    }
    let mut scope: Option<String> = None;
    let mut limit: Option<i64> = None;
    let mut query_parts = Vec::new();
    let mut idx = 0;
    while idx < args.len() {
        match args[idx].as_str() {
            "--scope" | "--source" => {
                let val = args
                    .get(idx + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for {}", args[idx]))?;
                scope = Some(val.clone());
                idx += 2;
            }
            "--limit" => {
                let val = args
                    .get(idx + 1)
                    .ok_or_else(|| anyhow::anyhow!("Missing value for --limit"))?;
                limit = Some(
                    val.parse::<i64>()
                        .with_context(|| format!("Invalid --limit `{val}`"))?
                        .clamp(1, 50),
                );
                idx += 2;
            }
            other => {
                query_parts.push(other.to_string());
                idx += 1;
            }
        }
    }
    let query = query_parts.join(" ").trim().to_string();
    if query.is_empty() {
        bail!("session_search requires a non-empty query");
    }
    let mut payload = json!({
        "query": query,
        "intent": "Search sessions via runtime command",
        "include_external": true,
    });
    if let Some(ref src) = scope
        && src != "all"
    {
        payload["source"] = json!(src);
    }
    if let Some(lim) = limit {
        payload["limit"] = json!(lim);
    }
    let tool = crate::tool::SessionSearchTool::new();
    let output = tool
        .execute(payload, direct_tool_ctx_from_lock_free(ctx))
        .await?;
    let matches: Vec<Value> = output
        .metadata
        .as_ref()
        .and_then(|meta| meta.get("matches"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let count = matches.len();
    let data = json!({
        "query": query,
        "scope": scope.as_deref().unwrap_or("all"),
        "limit": limit,
        "matches": matches,
        "results": matches,
        "count": count,
        "text": output.output,
    });
    Ok((data, output.output))
}

fn schedule_item_json(item: &crate::ambient::ScheduledItem) -> Value {
    let title = item
        .task_description
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&item.context);
    let next_run = item.scheduled_for.to_rfc3339();
    json!({
        "id": item.id,
        "title": title,
        "prompt": item.context,
        "task_description": item.task_description,
        "context": item.context,
        "cron_summary": format!("One-shot at {}", item.scheduled_for.format("%Y-%m-%d %H:%M UTC")),
        "next_run": next_run,
        "scheduled_for": item.scheduled_for,
        "permission_mode": "default",
        "enabled": true,
        "priority": item.priority,
        "target": item.target,
        "created_by_session": item.created_by_session,
        "created_at": item.created_at,
        "working_dir": item.working_dir,
    })
}

async fn schedules(ctx: &LockFreeCommandContext, args: &[String]) -> Result<(Value, String)> {
    use crate::ambient::{AmbientManager, Priority, ScheduleRequest, ScheduleTarget};
    let sub = args.first().map(String::as_str).unwrap_or("list");
    match sub {
        "list" | "status" => {
            tokio::task::spawn_blocking(|| {
                let manager = AmbientManager::new()?;
                let mut items = manager.queue().items().to_vec();
                items.sort_by_key(|item| item.scheduled_for);
                let formatted: Vec<Value> = items.iter().map(schedule_item_json).collect();
                let count = formatted.len();
                let data = json!({
                    "schedules": formatted,
                    "count": count,
                });
                let message = if count == 0 {
                    "No scheduled tasks.".into()
                } else {
                    format!("{count} scheduled task(s).")
                };
                Ok((data, message))
            })
            .await?
        }
        "create" => {
            let rest = &args[1..];
            if rest.is_empty() {
                bail!(
                    "Usage: schedules create <minutes|rfc3339> <task...> OR schedules create '<json>'"
                );
            }
            let (task, title, wake_in_minutes, wake_at, priority, target_str) =
                if rest.len() == 1 && rest[0].trim_start().starts_with('{') {
                    let parsed: Value = serde_json::from_str(&rest[0])
                        .context("Invalid JSON payload for schedules create")?;
                    let task = parsed["task"]
                        .as_str()
                        .or_else(|| parsed["prompt"].as_str())
                        .or_else(|| parsed["title"].as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .ok_or_else(|| anyhow::anyhow!("`task` (or `prompt`) is required"))?
                        .to_string();
                    let title = parsed["title"]
                        .as_str()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| task.clone());
                    let mut wake_in_minutes = match parsed.get("wake_in_minutes") {
                        Some(Value::Null) | None => None,
                        Some(v) => {
                            let raw = v.as_u64().ok_or_else(|| {
                                anyhow::anyhow!("`wake_in_minutes` must be a non-negative integer")
                            })?;
                            Some(u32::try_from(raw).map_err(|_| {
                                anyhow::anyhow!(
                                    "`wake_in_minutes` out of range (max {})",
                                    u32::MAX
                                )
                            })?)
                        }
                    };
                    let mut wake_at = parsed["wake_at"]
                        .as_str()
                        .map(|ts| {
                            ts.parse::<chrono::DateTime<chrono::Utc>>()
                                .with_context(|| format!("Invalid wake_at timestamp `{ts}`"))
                        })
                        .transpose()?;
                    if wake_in_minutes.is_none()
                        && wake_at.is_none()
                        && let Some(sched) = parsed.get("schedule")
                    {
                        if let Some(m) = sched.as_u64() {
                            wake_in_minutes = Some(u32::try_from(m).map_err(|_| {
                                anyhow::anyhow!("`schedule` minutes out of range (max {})", u32::MAX)
                            })?);
                        } else if let Some(s) = sched.as_str().map(str::trim) {
                            if let Ok(mins) = s.parse::<u32>() {
                                wake_in_minutes = Some(mins);
                            } else if let Ok(ts) = s.parse::<chrono::DateTime<chrono::Utc>>() {
                                wake_at = Some(ts);
                            } else {
                                bail!(
                                    "Unsupported `schedule` value `{s}`. Provide `wake_in_minutes` (u32) or an RFC3339 `wake_at` timestamp."
                                );
                            }
                        }
                    }
                    let priority = match parsed["priority"].as_str() {
                        Some("low") => Priority::Low,
                        Some("high") => Priority::High,
                        _ => Priority::Normal,
                    };
                    let target_str = parsed["target"].as_str().map(str::to_string);
                    (task, title, wake_in_minutes, wake_at, priority, target_str)
                } else {
                    if rest.len() < 2 {
                        bail!("Usage: schedules create <minutes|rfc3339> <task...>");
                    }
                    let when = &rest[0];
                    let (wake_in_minutes, wake_at) = if let Ok(mins) = when.parse::<u32>() {
                        (Some(mins), None)
                    } else if let Ok(ts) = when.parse::<chrono::DateTime<chrono::Utc>>() {
                        (None, Some(ts))
                    } else {
                        bail!("Expected wake delay in minutes or RFC3339 timestamp, got `{when}`");
                    };
                    let task = rest[1..].join(" ").trim().to_string();
                    if task.is_empty() {
                        bail!("Scheduled task description must not be empty");
                    }
                    let title = task.clone();
                    (task, title, wake_in_minutes, wake_at, Priority::Normal, None)
                };
            if wake_in_minutes.is_none() && wake_at.is_none() {
                bail!("Either wake_in_minutes or wake_at is required");
            }
            let session_id = ctx.session_id.clone();
            let working_dir = ctx.working_dir.as_ref().map(|p| p.display().to_string());
            let target = match target_str.as_deref() {
                Some("ambient") => ScheduleTarget::Ambient,
                Some("spawn") => ScheduleTarget::Spawn {
                    parent_session_id: session_id.clone(),
                },
                Some("resume") | None => ScheduleTarget::Session {
                    session_id: session_id.clone(),
                },
                Some(other) => {
                    bail!("Invalid schedule target `{other}`. Expected resume, spawn, or ambient.")
                }
            };
            let request = ScheduleRequest {
                wake_in_minutes,
                wake_at,
                context: task.clone(),
                priority,
                target,
                created_by_session: session_id,
                working_dir,
                task_description: Some(title),
                relevant_files: Vec::new(),
                git_branch: None,
                additional_context: None,
            };
            tokio::task::spawn_blocking(move || {
                let mut manager = AmbientManager::new()?;
                let id = manager.schedule(request)?;
                let created = manager
                    .queue()
                    .items()
                    .iter()
                    .find(|item| item.id == id)
                    .map(schedule_item_json);
                let data = json!({
                    "created": true,
                    "id": id,
                    "schedule": created,
                });
                Ok((data, format!("Scheduled task `{task}` (id: {id}).")))
            })
            .await?
        }
        "cancel" => {
            let id = args
                .get(1)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("Usage: schedules cancel <schedule_id>"))?
                .clone();
            tokio::task::spawn_blocking(move || {
                let mut manager = AmbientManager::new()?;
                let Some(item) = manager.cancel_schedule(&id)? else {
                    bail!("No scheduled task found with id `{id}`");
                };
                let formatted = schedule_item_json(&item);
                let data = json!({
                    "cancelled": true,
                    "id": item.id,
                    "schedule": formatted,
                });
                Ok((data, format!("Cancelled scheduled task `{id}`.")))
            })
            .await?
        }
        other => bail!(
            "Unknown schedules subcommand `{other}`. Usage: schedules [list|create <...>|cancel <id>]"
        ),
    }
}

async fn ambient(args: &[String]) -> Result<(Value, String)> {
    let sub = args.first().map(String::as_str).unwrap_or("status");
    match sub {
        "status" | "show" => {
            tokio::task::spawn_blocking(|| {
                let config = crate::config::Config::load();
                let manager = crate::ambient::AmbientManager::new()?;
                let safety = crate::safety::SafetySystem::new();
                let pending = safety.pending_requests();
                let data = json!({
                    "enabled": config.ambient.enabled,
                    "state": manager.state(),
                    "scheduled_count": manager.queue().items().len(),
                    "pending_approvals_count": pending.len(),
                    "pending_approvals": pending,
                });
                let message = format!(
                    "Ambient mode: {} (scheduled: {}, pending approvals: {}).",
                    if config.ambient.enabled { "enabled" } else { "disabled" },
                    manager.queue().items().len(),
                    pending.len()
                );
                Ok((data, message))
            })
            .await?
        }
        "approvals" => {
            tokio::task::spawn_blocking(|| {
                let safety = crate::safety::SafetySystem::new();
                let pending = safety.pending_requests();
                let count = pending.len();
                let data = json!({
                    "approvals": pending,
                    "count": count,
                });
                let message = if count == 0 {
                    "No pending ambient approval requests.".into()
                } else {
                    format!("{count} pending ambient approval request(s).")
                };
                Ok((data, message))
            })
            .await?
        }
        "decide" => {
            let (Some(id), Some(verdict)) = (args.get(1), args.get(2)) else {
                bail!("Usage: ambient decide <request_id> <allow|deny>");
            };
            let approved = match verdict.to_ascii_lowercase().as_str() {
                "allow" | "approve" | "approved" | "yes" => true,
                "deny" | "reject" | "denied" | "no" => false,
                _ => bail!("Expected `allow` or `deny` for ambient decide"),
            };
            let id = id.clone();
            tokio::task::spawn_blocking(move || {
                let safety = crate::safety::SafetySystem::new();
                if !safety.pending_requests().iter().any(|r| r.id == id) {
                    bail!("Ambient permission request `{id}` was not found in pending queue");
                }
                crate::safety::record_permission_via_file(&id, approved, "harness_api", None)?;
                let data = json!({
                    "id": id,
                    "approved": approved,
                    "decided_via": "harness_api",
                });
                let message = format!(
                    "Ambient approval `{id}` {}.",
                    if approved { "approved" } else { "denied" }
                );
                Ok((data, message))
            })
            .await?
        }
        other => bail!(
            "Unknown ambient subcommand `{other}`. Usage: ambient [status|approvals|decide <id> <allow|deny>]"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn premium_modes_are_exact_and_invalid_input_never_defaults() {
        use crate::provider::copilot::PremiumMode;
        let parse = |args: &[String]| premium_arg(args, PremiumMode::Normal);
        assert_eq!(parse(&[]).unwrap(), None);
        assert_eq!(parse(&["status".into()]).unwrap(), None);
        assert_eq!(
            parse(&["normal".into()]).unwrap(),
            Some(PremiumMode::Normal)
        );
        assert_eq!(
            parse(&["one".into()]).unwrap(),
            Some(PremiumMode::OnePerSession)
        );
        assert_eq!(parse(&["zero".into()]).unwrap(), Some(PremiumMode::Zero));
        assert_eq!(
            premium_arg(&["toggle-one".into()], PremiumMode::OnePerSession).unwrap(),
            Some(PremiumMode::Normal)
        );
        assert_eq!(
            premium_arg(&["toggle-zero".into()], PremiumMode::Normal).unwrap(),
            Some(PremiumMode::Zero)
        );
        assert_eq!(
            premium_arg(&["toggle-zero".into()], PremiumMode::Zero).unwrap(),
            Some(PremiumMode::Normal)
        );
        assert!(parse(&["invalid".into()]).is_err());
        assert!(parse(&["zero".into(), "extra".into()]).is_err());
    }
    #[test]
    fn logout_requires_explicit_supported_provider_and_confirmation() {
        let (data, _) = logout(&[]).unwrap();
        assert_eq!(data["confirmation_required"], true);
        let (data, message) = logout(&["openai".into()]).unwrap();
        assert_eq!(data["confirmation_required"], true);
        assert!(message.contains("No credential was removed"));
        assert!(logout(&["openai".into(), "yes".into()]).is_err());
        assert!(logout(&["invalid-provider".into(), "confirm".into()]).is_err());
        assert!(logout(&["copilot".into(), "confirm".into()]).is_err());
    }

    #[test]
    fn remote_help_and_cloud_are_side_effect_free() {
        let (data, message) = remote(&["help".into()]).unwrap();
        assert_eq!(data["scope"], "runtime host");
        assert!(message.contains("No") || message.contains("no server"));
        assert!(remote(&["cloud".into()]).is_err());
        assert!(remote(&["on".into(), "extra".into()]).is_err());
        assert!(remote(&["revoke".into()]).is_err());
    }

    #[test]
    fn read_only_commands_reject_mutation_arguments() {
        assert!(status_args(&[]).is_ok());
        assert!(status_args(&["status".into()]).is_ok());
        assert!(status_args(&["resume".into()]).is_err());
        assert!(status_args(&["delete".into()]).is_err());
    }

    #[test]
    fn patch_toml_preserves_comments_and_unknown_keys() {
        let original = "\
# User header comment
custom_top_key = \"preserve-me\"

[features]
# Keep this comment
mermaid = true # inline note
memory = true

[custom_plugin]
endpoint = \"https://example.invalid\"
";
        let updated = patch_toml_key_preserving_comments(original, "features", "mermaid", "false");
        assert!(updated.contains("# User header comment"));
        assert!(updated.contains("custom_top_key = \"preserve-me\""));
        assert!(updated.contains("# Keep this comment"));
        assert!(updated.contains("mermaid = false # inline note"));
        assert!(updated.contains("[custom_plugin]\nendpoint = \"https://example.invalid\""));

        let added = patch_toml_key_preserving_comments(&updated, "tools", "codemode", "true");
        assert!(added.contains("[tools]\ncodemode = true"));
        assert!(added.contains("custom_top_key = \"preserve-me\""));
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn schedules_mcp_and_session_search_contracts_are_structured_and_safe() {
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

        let ctx = LockFreeCommandContext {
            session_id: "sess-contract-test".into(),
            working_dir: Some(home.path().to_path_buf()),
            registry: None,
            provider_name: "test".into(),
            provider_model: "test-model".into(),
            provider_context_window: 128_000,
            provider_transport: None,
            route_counts: Some((1, 1)),
        };

        // 1. schedules create rejects u32 overflow instead of silently truncating.
        let overflow_payload = json!({
            "task": "overflow check",
            "wake_in_minutes": (u32::MAX as u64) + 10,
        })
        .to_string();
        assert!(
            schedules(&ctx, &["create".into(), overflow_payload])
                .await
                .is_err()
        );

        // 2. schedules create accepts UI JSON fields (title/prompt/schedule) and returns normalized fields.
        let ui_payload = json!({
            "title": "Nightly audit",
            "prompt": "Run cargo check",
            "schedule": "15",
        })
        .to_string();
        let (created, _) = schedules(&ctx, &["create".into(), ui_payload])
            .await
            .unwrap();
        assert_eq!(created["created"], true);
        let sched = &created["schedule"];
        assert_eq!(sched["title"], "Nightly audit");
        assert_eq!(sched["prompt"], "Run cargo check");
        assert!(sched["cron_summary"].as_str().is_some());
        assert!(sched["next_run"].as_str().is_some());
        assert!(sched["scheduled_for"].as_str().is_some());
        assert_eq!(sched["permission_mode"], "default");
        assert_eq!(sched["enabled"], true);

        // 3. mcp list includes explicit `status` ("disabled" vs "disconnected").
        let mcp_path = home.path().join("mcp.json");
        std::fs::write(
            &mcp_path,
            serde_json::to_string_pretty(&json!({
                "mcpServers": {
                    "disabled_srv": { "command": "echo", "args": ["a"], "disabled": true },
                    "idle_srv": { "command": "echo", "args": ["b"] }
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let (mcp_data, _) = mcp(&ctx, &["list".into()]).await.unwrap();
        let servers = mcp_data["servers"].as_array().unwrap();
        let disabled_srv = servers.iter().find(|s| s["id"] == "disabled_srv").unwrap();
        let idle_srv = servers.iter().find(|s| s["id"] == "idle_srv").unwrap();
        assert_eq!(disabled_srv["status"], "disabled");
        assert_eq!(idle_srv["status"], "disconnected");

        // 4. session_search returns structured `matches` and `results` arrays (not null).
        let (search_data, _) = session_search(
            &ctx,
            &["distinctive_token_999".into(), "--scope".into(), "rayu".into()],
        )
        .await
        .unwrap();
        assert!(search_data["matches"].is_array());
        assert!(search_data["results"].is_array());
        assert_eq!(search_data["count"], 0);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn logout_rayu_confirm_removes_session_env_key_and_caches() {
        let _lock = crate::storage::lock_test_env();
        let temp = tempfile::TempDir::new().unwrap();
        let keys = [
            "RAYU_AUTH_CONFIG_DIR",
            "RAYU_HOME",
            "RAYU_CONFIG_DIR",
            "RAYU_API_KEY",
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

        let session = crate::rayu::RayuSession {
            access_token: "test-access-token".into(),
            refresh_token: "test-refresh-token".into(),
            expires_at: chrono::Utc::now().timestamp_millis() + 3_600_000,
            user: crate::rayu::RayuSessionUser {
                id: 7,
                email: Some("dev@example.invalid".into()),
                display_name: Some("Rayu Tester".into()),
                avatar_url: Some("https://example.invalid/avatar.png".into()),
                role: "user".into(),
            },
        };
        crate::rayu::write_session(&session).unwrap();
        let env_path = crate::rayu::save_api_key("rayu_sk_live_logout_test_key").unwrap();
        std::fs::write(temp.path().join("rayu-apikey-state.json"), "{}").unwrap();
        std::fs::write(temp.path().join("rayu-entitlements.json"), "{}").unwrap();
        std::fs::write(temp.path().join("rayu-feature-usage.json"), "{}").unwrap();
        let cache_dir = temp.path().join("cache");
        std::fs::create_dir_all(&cache_dir).unwrap();
        let rayu_cache = cache_dir.join("rayu_models_0123456789abcdef.json");
        let other_cache = cache_dir.join("openrouter_models.json");
        std::fs::write(&rayu_cache, "{}").unwrap();
        std::fs::write(&other_cache, "{}").unwrap();

        let (prompt_data, prompt_msg) = logout(&["rayu".into()]).unwrap();
        assert_eq!(prompt_data["confirmation_required"], true);
        assert_eq!(prompt_data["provider"], "rayu");
        assert!(prompt_msg.contains("No credential was removed"));
        assert!(temp.path().join("rayu-auth.json").exists());

        let ctx = LockFreeCommandContext {
            session_id: "sess-rayu-logout".into(),
            working_dir: Some(temp.path().to_path_buf()),
            registry: None,
            provider_name: "rayu".into(),
            provider_model: "test-model".into(),
            provider_context_window: 128_000,
            provider_transport: None,
            route_counts: None,
        };
        let (data, _) = try_execute_lock_free(
            &ctx,
            RuntimeCommand::Logout,
            &["rayu".into(), "confirm".into()],
        )
        .await
        .expect("logout is lock-free")
        .unwrap();

        assert_eq!(data["provider"], "rayu");
        assert_eq!(data["cleared"], true);
        assert_eq!(data["removed_oauth_accounts"], 1);
        assert_eq!(data["saved_api_key_cleared"], true);
        assert_eq!(data["errors"].as_array().map(Vec::len), Some(0));
        assert!(!temp.path().join("rayu-auth.json").exists());
        assert!(!temp.path().join("rayu-apikey-state.json").exists());
        assert!(!temp.path().join("rayu-entitlements.json").exists());
        assert!(!temp.path().join("rayu-feature-usage.json").exists());
        assert!(!rayu_cache.exists());
        assert!(other_cache.exists());
        assert!(
            !env_path.exists()
                || !std::fs::read_to_string(&env_path)
                    .unwrap()
                    .contains("RAYU_API_KEY=")
        );
        assert!(crate::rayu::read_session().is_none());
        assert!(!crate::rayu::has_api_key());

        // Second logout when already signed out succeeds cleanly without errors.
        let (second_data, _) = logout(&["rayu".into(), "confirm".into()]).unwrap();
        assert_eq!(second_data["provider"], "rayu");
        assert_eq!(second_data["cleared"], true);
        assert_eq!(second_data["removed_oauth_accounts"], 0);
        assert_eq!(second_data["saved_api_key_cleared"], false);
        assert_eq!(second_data["errors"].as_array().map(Vec::len), Some(0));
    }
}
