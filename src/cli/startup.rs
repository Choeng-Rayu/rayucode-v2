use anyhow::Result;
use clap::Parser;
use std::process::Command as ProcessCommand;

use crate::{
    build, logging, perf, server, setup_hints, startup_profile, storage, telemetry, update,
};

use super::{
    args::{Args, Command},
    dispatch, hot_exec, output, terminal,
};

fn sync_output_style_from_config() {
    crate::output_style::set_emoji_enabled(crate::config::config().display.emoji);
}

pub async fn run() -> Result<()> {
    // Parse once, before startup side effects. Invalid arguments and --help
    // must not harden credential files or create configuration/telemetry state.
    let args = Args::parse();
    if args.licenses {
        use std::io::Write;

        let installed = if cfg!(rayu_embedded_release_notices) {
            None
        } else if let Ok(exe) = std::env::current_exe()
            && let Some(dir) = exe.parent()
        {
            [
                "THIRD_PARTY_NOTICES",
                "../THIRD_PARTY_NOTICES",
                "../share/doc/rayucode/THIRD_PARTY_NOTICES",
            ]
            .into_iter()
            .find_map(|path| match std::fs::read_to_string(dir.join(path)) {
                Ok(text) => Some(text),
                Err(_) => None,
            })
        } else {
            None
        };
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(include_bytes!("../../LICENSE"))?;
        stdout.write_all(b"\n")?;
        stdout.write_all(
            installed
                .as_deref()
                .unwrap_or(include_str!(env!("RAYU_BUNDLED_NOTICES")))
                .as_bytes(),
        )?;
        return Ok(());
    }
    // Data belongs to the executable, not to the application/TUI dependency
    // chain. Every entrypoint using this startup path gets version-matched docs.
    crate::register_bundled_docs();
    // Interactive login prompts (masked secrets, QR codes) are a terminal
    // concern. The shared auth flows reach them through this presenter.
    super::login::install_terminal_login_presenter();
    // Snapshot user-supplied provider env before provider init rewrites it.
    super::provider_init::capture_user_openrouter_model_env();
    // Credential import and explicit MCP management do not need normal agent
    // startup hardening, migrations, telemetry, or provider discovery.
    if args.ssh.is_none()
        && matches!(
            args.command,
            Some(
                Command::Auth(super::args::AuthCommand::Import { .. })
                    | Command::Mcp { .. }
                    | Command::Telegram { .. }
            )
        )
    {
        if let Some(cwd) = &args.cwd {
            std::env::set_current_dir(cwd)?;
        }
        if let Some(socket) = args.socket.as_deref() {
            server::set_socket_path(socket);
        }
        return dispatch::run_main(args).await;
    }
    startup_profile::init();

    terminal::install_panic_hook();
    startup_profile::mark("panic_hook");

    logging::init();
    startup_profile::mark("logging_init");
    // Old log pruning now runs on a background thread inside logging::init(),
    // so it no longer blocks startup. Memory-event logs have a separate,
    // longer (14-day) retention, so prune them on their own background thread.
    std::thread::Builder::new()
        .name("rayu-memlog-cleanup".to_string())
        .spawn(crate::memory_log::cleanup_old_memory_logs)
        .ok();
    // Prune stale per-session `.bak` recovery copies (never the transcripts
    // themselves) so the sessions directory does not grow without bound.
    std::thread::Builder::new()
        .name("rayu-session-bak-prune".to_string())
        .spawn(crate::session::prune_old_session_backups)
        .ok();
    // Record which binary actually launched. Stale copies earlier on PATH (or a
    // shortcut pinned to an old install) otherwise look identical to the
    // updated launcher in logs, and keep re-offering the same update (#1626).
    logging::info(&format!(
        "rayu starting (version={}, exe={})",
        rayucode_build_meta::version(),
        std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| "unknown".to_string())
    ));

    // Wire config-reload reactions without making config depend on auth/bus:
    // when the config cache reloads, invalidate the auth-status cache and
    // broadcast a models-updated event.
    sync_output_style_from_config();
    crate::config::on_config_reloaded(sync_output_style_from_config);
    crate::config::on_config_reloaded(crate::auth::AuthStatus::invalidate_cache);
    crate::config::on_config_reloaded(|| crate::bus::Bus::global().publish_models_updated());

    // Invert the legacy provider_catalog -> auth dependency: provider_catalog
    // consults registered fallback resolvers, and auth (the higher layer)
    // registers its external-CLI credential scan here.
    if crate::rayu::other_providers_enabled() {
        crate::provider_catalog::register_api_key_fallback_resolver(
            crate::auth::external::load_api_key_for_env,
        );
    }

    // Register externally-implemented provider runtimes with the base
    // provider registry. These crates sit downstream of rayucode-base (so
    // provider edits do not rebuild the app spine), which means base cannot
    // name their concrete types; this composition root wires them up instead.
    register_external_provider_runtimes();

    // Invert the legacy safety -> notifications dependency: safety raises a
    // permission request and the notifications layer (which depends on safety
    // types) delivers it via the dispatcher registered here.
    crate::safety::register_permission_notifier(|action, description, request_id| {
        crate::notifications::NotificationDispatcher::new().dispatch_permission_request(
            action,
            description,
            request_id,
        );
    });

    // Invert the legacy memory -> skill dependency: memory collects synthetic
    // entries from registered providers, and skill (the higher layer that
    // depends on MemoryEntry) registers its registry->memory adapter here.
    // The shared snapshot holds global skills only; memory retrieval is
    // process-scoped, so compose the project overlay from the process cwd
    // (issue #457 keeps session overlays out of the shared registry).
    crate::memory::register_synthetic_entry_provider(|| {
        let global = crate::skill::SkillRegistry::shared_snapshot();
        crate::skill::SkillRegistry::effective_for_working_dir(&global, None)
            .list()
            .into_iter()
            .map(|skill| skill.as_memory_entry())
            .collect()
    });

    // Invert the legacy server -> tui dependency: the TUI session picker owns
    // the session-list cache and registers its invalidator here, so the server
    // can drop the cache (e.g. after a rename) without referencing tui.
    crate::session_list_cache::register_invalidator(
        crate::tui::session_picker::invalidate_session_list_cache,
    );

    // Invert the legacy tui -> cli dependency for shared-server spawning: the
    // CLI owns the provider-bootstrap spawn logic and registers it here, so the
    // TUI reconnect loop can request a replacement server via server_spawn
    // without referencing cli.
    crate::server_spawn::register_default_server_spawner(Box::new(|| {
        Box::pin(async {
            dispatch::spawn_server(&crate::cli::provider_init::ProviderChoice::Auto, None, None)
                .await
        })
    }));

    crate::tui::keybind::log_keybinding_default_warnings();
    crate::platform::raise_nofile_limit_best_effort(8_192);
    startup_profile::mark("nofile_limit");

    storage::harden_user_config_permissions();
    startup_profile::mark("perm_harden");

    perf::init_background();
    startup_profile::mark("perf_init");

    // Telemetry settings commands must run before they can cause telemetry. In
    // particular, a first-ever `rayu telemetry disable` must not emit the
    // install event that the command is trying to opt out of. Keep the normal
    // startup ordering unchanged for every other invocation.
    if !is_telemetry_subcommand_invocation(std::env::args_os()) {
        telemetry::record_install_if_first_run();
        telemetry::record_upgrade_if_needed();
    }
    startup_profile::mark("telemetry_check");

    let args = parse_and_prepare_args(args)?;
    if matches!(args.command, Some(Command::Serve { .. }))
        && std::env::var_os("RAYU_DEFERRED_AUTH_BOOTSTRAP").is_none()
    {
        require_cli_auth_gate()?;
    }
    spawn_background_update_check(&args);

    if let Err(e) = dispatch::run_main(args).await {
        report_main_error(&e);
        return Err(e);
    }

    Ok(())
}

fn is_telemetry_subcommand_invocation(
    args: impl IntoIterator<Item = impl AsRef<std::ffi::OsStr>>,
) -> bool {
    let mut args = args.into_iter().skip(1);
    while let Some(arg) = args.next() {
        let arg = arg.as_ref();
        if arg == std::ffi::OsStr::new("telemetry") {
            return true;
        }
        let text = arg.to_string_lossy();
        if !text.starts_with('-') {
            return false;
        }
        if text == "--" {
            return args
                .next()
                .is_some_and(|arg| arg.as_ref() == std::ffi::OsStr::new("telemetry"));
        }
        let option = text.split_once('=').map_or(text.as_ref(), |(name, _)| name);
        let takes_separate_value = !text.contains('=')
            && matches!(
                option,
                "-p" | "--provider"
                    | "-C"
                    | "--cwd"
                    | "--remote-working-dir"
                    | "--ssh"
                    | "--ssh-binary"
                    | "--ssh-server-socket"
                    | "--spawn-hotkey"
                    | "--socket"
                    | "-m"
                    | "--model"
                    | "--provider-profile"
                    | "--tool-profile"
                    | "--mcp-tools"
                    | "--mcp-tools-token-threshold"
                    | "--tools"
                    | "--disabled-tools"
            );
        if takes_separate_value && args.next().is_none() {
            return false;
        }
    }
    false
}

/// Register provider runtimes that live downstream of `rayucode-base` with the
/// base crate's external provider registry. Keep every downstream runtime
/// registration in this one function so the composition-root wiring stays
/// discoverable as more providers move out of the base crate.
pub fn register_external_provider_runtimes() {
    crate::provider::external::register_external_provider(
        crate::provider::external::RAYU_RUNTIME,
        || std::sync::Arc::new(rayucode_provider_rayu_runtime::RayuProvider::new()),
    );
    if !crate::rayu::other_providers_enabled() {
        return;
    }
    crate::provider::external::register_external_provider(
        crate::provider::external::GROK_BUILD_RUNTIME,
        || std::sync::Arc::new(rayucode_provider_grok_build_runtime::GrokBuildProvider::new()),
    );
    crate::provider::external::register_external_provider(
        crate::provider::external::GEMINI_RUNTIME,
        || std::sync::Arc::new(rayucode_provider_gemini_runtime::GeminiProvider::new()),
    );
    crate::provider::external::register_external_provider(
        crate::provider::external::CURSOR_RUNTIME,
        || std::sync::Arc::new(rayucode_provider_cursor_runtime::CursorCliProvider::new()),
    );
    crate::provider::external::register_external_provider(
        crate::provider::external::ANTIGRAVITY_RUNTIME,
        || std::sync::Arc::new(rayucode_provider_antigravity_runtime::AntigravityProvider::new()),
    );
    crate::provider::external::register_external_provider(
        crate::provider::external::ANTHROPIC_RUNTIME,
        || std::sync::Arc::new(rayucode_provider_anthropic_runtime::AnthropicProvider::new()),
    );
    // OpenRouter serves several identities (aggregator, pinned API-key
    // runtime, direct OpenAI-compatible profiles, named config profiles)
    // through one concrete type, so it registers a parameterized factory.
    crate::provider::external::register_openrouter_factory(|spec| {
        use crate::provider::external::OpenRouterRuntimeSpec;
        use rayucode_provider_openrouter_runtime::OpenRouterProvider;
        let provider: std::sync::Arc<dyn crate::provider::Provider> = match spec {
            OpenRouterRuntimeSpec::Default => std::sync::Arc::new(OpenRouterProvider::new()?),
            OpenRouterRuntimeSpec::OpenRouterApiKey => {
                std::sync::Arc::new(OpenRouterProvider::new_openrouter_api_key_runtime()?)
            }
            OpenRouterRuntimeSpec::CompatibleProfile(profile) => std::sync::Arc::new(
                OpenRouterProvider::new_openai_compatible_profile_runtime(profile)?,
            ),
            OpenRouterRuntimeSpec::NamedProfile { name, config } => std::sync::Arc::new(
                OpenRouterProvider::new_named_openai_compatible(&name, &config)?,
            ),
        };
        Ok(provider)
    });
    crate::provider::external::register_profile_catalog_refresh(
        rayucode_provider_openrouter_runtime::maybe_schedule_openai_compatible_profile_catalog_refresh,
    );
    crate::provider::external::register_standard_openrouter_catalog_refresh(
        rayucode_provider_openrouter_runtime::maybe_schedule_standard_openrouter_catalog_refresh,
    );
    // API-backed OpenAI routes use Codex/platform credentials. The runtime is
    // still registered without them so browser-backed ChatGPT models remain
    // usable through the logged-in Firefox session.
    crate::provider::external::register_external_provider_fallible(
        crate::provider::external::OPENAI_RUNTIME,
        || {
            let provider = match crate::auth::codex::load_credentials() {
                Ok(credentials) => {
                    rayucode_provider_openai_runtime::OpenAIProvider::new(credentials)
                }
                Err(_) => rayucode_provider_openai_runtime::OpenAIProvider::new_browser_only(),
            };
            Some(std::sync::Arc::new(provider) as std::sync::Arc<dyn crate::provider::Provider>)
        },
    );
    // Copilot's constructor is fallible (needs a GitHub token) and the runtime
    // wants tier detection scheduled right after construction, eagerly for
    // interactive sessions and deferred for non-interactive ones. That policy
    // lives here in the composition root so base stays provider-agnostic.
    crate::provider::external::register_external_provider_fallible(
        crate::provider::external::COPILOT_RUNTIME,
        || {
            let provider = std::sync::Arc::new(
                rayucode_provider_copilot_runtime::CopilotApiProvider::new().ok()?,
            );
            let eager_tier_detection = std::env::var("RAYU_NON_INTERACTIVE").is_err();
            if eager_tier_detection && tokio::runtime::Handle::try_current().is_ok() {
                let p_clone = std::sync::Arc::clone(&provider);
                tokio::spawn(async move {
                    p_clone.detect_tier_and_set_default().await;
                });
            } else {
                provider.complete_init_without_tier_detection();
            }
            Some(provider as std::sync::Arc<dyn crate::provider::Provider>)
        },
    );
}

fn parse_and_prepare_args(args: Args) -> Result<Args> {
    startup_profile::mark("args_parse");

    if let Some(chord) = args.spawn_hotkey.as_deref() {
        setup_hints::record_launch_hotkey_use(chord);
    }

    output::set_quiet_enabled(args.quiet);

    if let Some(cwd) = &args.cwd {
        std::env::set_current_dir(cwd)?;
        logging::info(&format!("Changed working directory to: {}", cwd));
    }

    validate_remote_working_dir(args.remote_working_dir.as_deref())?;

    if args.trace {
        crate::env::set_var("RAYU_TRACE", "1");
    }

    if let Some(ref socket) = args.socket {
        server::set_socket_path(socket);
    }

    crate::cli::proctitle::set_initial_title(&args);

    Ok(args)
}

fn validate_remote_working_dir(remote_working_dir: Option<&str>) -> Result<()> {
    if let Some(remote_working_dir) = remote_working_dir
        && !remote_working_dir_is_absolute(remote_working_dir)
    {
        anyhow::bail!("--remote-working-dir must be an absolute path");
    }
    Ok(())
}

fn remote_working_dir_is_absolute(path: &str) -> bool {
    if path.starts_with('/') || path.starts_with('\\') {
        return true;
    }

    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
        && bytes[0].is_ascii_alphabetic()
}

fn spawn_background_update_check(args: &Args) {
    let check_updates = should_spawn_background_update_check(args);
    let auto_update = should_auto_install_update(args);

    if !check_updates {
        return;
    }

    if update::is_release_build() {
        std::thread::spawn(move || {
            use crate::bus::{Bus, BusEvent, ClientMaintenanceAction, SessionUpdateStatus};
            match update::check_and_maybe_update(auto_update) {
                update::UpdateCheckResult::UpdateAvailable {
                    current, latest, ..
                } => {
                    logging::info(&format!("Update available: {} -> {}", current, latest));
                }
                update::UpdateCheckResult::UpdateInstalled { version, path } => {
                    // When an interactive TUI session is running, hand the switch
                    // to the app's graceful reload path (saves the input line,
                    // waits for the current turn, resumes the session) instead of
                    // exec-ing over the live UI, which visibly resets the screen.
                    if let Some(session_id) = terminal::get_current_session() {
                        logging::info(&format!(
                            "Updated to {}. Requesting graceful session reload...",
                            version
                        ));
                        Bus::global().publish(BusEvent::SessionUpdateStatus(
                            SessionUpdateStatus::ReadyToReload {
                                session_id,
                                action: ClientMaintenanceAction::Update,
                                version,
                            },
                        ));
                        return;
                    }
                    logging::info(&format!("Updated to {}. Restarting...", version));
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    let args: Vec<String> = std::env::args().skip(1).collect();
                    let exec_path = build::client_update_candidate(false)
                        .map(|(p, _)| p)
                        .unwrap_or(path);
                    let err = crate::platform::replace_process(
                        ProcessCommand::new(&exec_path)
                            .args(&args)
                            .arg("--no-update"),
                    );
                    eprintln!("Failed to exec new binary: {}", err);
                }
                update::UpdateCheckResult::Error(e) => {
                    logging::info(&format!("Update check failed: {}", e));
                }
                update::UpdateCheckResult::NoUpdate => {}
            }
        });
    } else {
        std::thread::spawn(move || {
            use crate::bus::{Bus, BusEvent, UpdateStatus};

            let start = std::time::Instant::now();
            Bus::global().publish(BusEvent::UpdateStatus(UpdateStatus::Checking));
            let status = source_update_check_status(hot_exec::check_for_updates());
            if matches!(status, UpdateStatus::Available { .. }) {
                // A checkout with local commits can never fast-forward, so the
                // pull below would always fail and surface a noisy "Update
                // diverged. Press Ctrl+Y..." card in every new session.
                // Developers with local work expect divergence; log it once
                // and stay quiet in the UI (no Available/Error cards).
                if hot_exec::local_commits_ahead_of_upstream() == Some(true) {
                    logging::info(
                        "Auto-update skipped: local commits are ahead of upstream (diverged). \
                         Merge or rebase manually when ready.",
                    );
                    Bus::global().publish(BusEvent::UpdateStatus(UpdateStatus::UpToDate));
                } else {
                    Bus::global().publish(BusEvent::UpdateStatus(status));
                    if auto_update {
                        logging::info("Update available - auto-updating...");
                        Bus::global().publish(BusEvent::UpdateStatus(UpdateStatus::Installing {
                            version: "latest source".to_string(),
                        }));
                        if let Err(e) = hot_exec::run_auto_update() {
                            Bus::global().publish(BusEvent::UpdateStatus(UpdateStatus::Error(
                                e.to_string(),
                            )));
                            logging::error(&format!(
                                "Auto-update failed: {}. Continuing with current version.",
                                e
                            ));
                        }
                    } else {
                        logging::info(
                            "Update available! Run `rayu update` or `/reload` to update.",
                        );
                    }
                }
            } else {
                match &status {
                    UpdateStatus::Error(message) => logging::info(message),
                    UpdateStatus::Skipped { reason } => {
                        logging::info(&format!("Source update check skipped: {reason}"));
                    }
                    _ => {}
                }
                Bus::global().publish(BusEvent::UpdateStatus(status));
            }
            logging::info(&format!(
                "[TIMING] background_update_check: auto_update={}, total={}ms",
                auto_update,
                start.elapsed().as_millis()
            ));
        });
    }
}

fn source_update_check_status(result: anyhow::Result<Option<bool>>) -> crate::bus::UpdateStatus {
    use crate::bus::UpdateStatus;

    match result {
        Ok(Some(true)) => UpdateStatus::Available {
            current: rayucode_build_meta::version().to_string(),
            latest: "latest source".to_string(),
        },
        Ok(Some(false)) => UpdateStatus::UpToDate,
        Ok(None) => UpdateStatus::Skipped {
            reason:
                "no upstream configured for the source checkout (local branch or detached HEAD)"
                    .to_string(),
        },
        Err(error) => UpdateStatus::Error(format!("Source update check failed: {error:#}")),
    }
}

fn should_spawn_background_update_check(args: &Args) -> bool {
    should_spawn_background_update_check_with_config(
        args,
        crate::config::config().features.check_updates,
    )
}

fn should_spawn_background_update_check_with_config(args: &Args, check_updates: bool) -> bool {
    check_updates
        && args.ssh.is_none()
        && !args.quiet
        && !args.no_update
        && !matches!(
            args.command,
            Some(Command::Update { .. })
                | Some(Command::Serve { .. })
                | Some(Command::Server { .. })
                | Some(Command::Acp)
        )
        && args.resume.is_none()
}

fn should_auto_install_update(args: &Args) -> bool {
    args.auto_update
}

fn report_main_error(error: &anyhow::Error) {
    let error_str = format!("{:?}", error);
    logging::error(&error_str);

    if let Some(session_id) = terminal::get_current_session() {
        output::stderr_blank_line();
        output::stderr_info("\x1b[33mTo restore this session, run:\x1b[0m");
        output::stderr_info(format!("  rayu --resume {}", session_id));
        output::stderr_blank_line();
    }
}

pub(super) fn cli_auth_gate_active() -> bool {
    if !crate::rayu::other_providers_enabled() {
        return !crate::rayu::has_credentials();
    }
    if cfg!(test) && std::env::var_os("USE_RAYU_OAUTH").is_none() {
        return false;
    }
    crate::rayu::auth_gate_active()
}

pub(super) fn require_cli_auth_gate() -> Result<()> {
    if cli_auth_gate_active() {
        anyhow::bail!("{}", crate::rayu::auth_gate_error_message());
    }
    Ok(())
}

/// Apply read-only legacy `providers.json` compat fallback strictly behind the
/// Rayu Auth gate as the lowest-precedence provider source (never mutates disk).
pub(super) fn maybe_enable_legacy_compat_provider_fallback() -> Result<bool> {
    if !crate::rayu::other_providers_enabled() {
        return Ok(false);
    }
    let rayu_auth_satisfied = !cli_auth_gate_active();
    if !rayu_auth_satisfied {
        return Ok(false);
    }
    let Some(legacy) = crate::legacy_compat::LegacyProvidersConfig::load() else {
        return Ok(false);
    };
    let mut candidates = Vec::new();
    if let Some(active) = legacy.active_fallback_if_authorized(true)
        && active.id.trim() != "rayu"
        && active.id.trim() != "rayu-hosted"
    {
        candidates.push(active);
    }
    for entry in legacy.third_party_providers_if_authorized(true) {
        if !candidates.iter().any(|existing| existing.id == entry.id) {
            candidates.push(entry);
        }
    }
    for entry in candidates {
        if let Some((id, named_cfg)) = entry.to_named_provider_config() {
            let mut ephemeral = crate::config::Config::default();
            ephemeral.providers.insert(id.clone(), named_cfg);
            if crate::provider_catalog::apply_named_provider_profile_env_from_config(
                &id, &ephemeral,
            )
            .is_ok()
                && crate::provider::openrouter::has_credentials()
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Resolve lowest-precedence model fallback from legacy `settings.json` strictly
/// behind the Rayu Auth gate and only when no explicit/config model is set.
pub(super) fn legacy_fallback_model_if_authorized(explicit_model: Option<&str>) -> Option<String> {
    let rayu_auth_satisfied = !cli_auth_gate_active();
    if !rayu_auth_satisfied || explicit_model.is_some() {
        return None;
    }
    if crate::config::config()
        .provider
        .default_model
        .as_deref()
        .is_some_and(|m| !m.trim().is_empty())
    {
        return None;
    }
    let cwd = match std::env::current_dir() {
        Ok(dir) => Some(dir),
        Err(_) => None,
    };
    let settings = crate::legacy_compat::LegacySettings::load_for_dir(cwd.as_deref());
    settings
        .fallback_model_if_authorized(explicit_model, rayu_auth_satisfied)
        .map(ToString::to_string)
}

/// Handle `ProviderChoice::Auto` while the Rayu Auth gate is active.
///
/// Only the client-spawned TUI/API daemon (`RAYU_DEFERRED_AUTH_BOOTSTRAP`) is
/// permitted to boot an empty deferred-auth `MultiProvider` so the user can
/// sign in inside onboarding; all 3P credentials stay unloaded until Rayu Auth
/// completes. Standalone `serve`, non-interactive `run`, and validation fail
/// cleanly with guidance. Interactive CLI bootstrap prompts Rayu Auth only.
pub(super) async fn rayu_gate_auto_provider(
    model: Option<&str>,
    show_init_messages: bool,
    allow_login_bootstrap: bool,
    strict_model: bool,
) -> Result<std::sync::Arc<dyn crate::provider::Provider>> {
    if std::env::var_os("RAYU_DEFERRED_AUTH_BOOTSTRAP").is_some() {
        logging::info(
            "No Rayu credentials configured; booting empty deferred-auth MultiProvider for Rayu onboarding",
        );
        let multi =
            crate::provider::MultiProvider::from_auth_status(crate::auth::AuthStatus::default());
        crate::env::set_var(
            "RAYU_ACTIVE_PROVIDER",
            crate::provider::Provider::name(&multi).to_lowercase(),
        );
        return Ok(std::sync::Arc::new(multi));
    }
    let non_interactive = std::env::var("RAYU_NON_INTERACTIVE").is_ok();
    if non_interactive || !allow_login_bootstrap {
        return Err(anyhow::anyhow!(
            "{}",
            crate::rayu::auth_gate_error_message()
        ));
    }
    super::login::run_rayu_login(false, false, None).await?;
    let provider = crate::provider::external::instantiate_external_provider(
        crate::provider::external::RAYU_RUNTIME,
    )
    .ok_or_else(|| anyhow::anyhow!("Rayu runtime is not registered"))?;
    crate::env::set_var("RAYU_ACTIVE_PROVIDER", "rayu");
    if show_init_messages {
        output::stderr_info("Using Rayu hosted models (use /model to switch models)");
    }
    if let Some(model_name) = model
        && let Err(e) = provider.set_model(model_name)
    {
        if strict_model {
            anyhow::bail!("Failed to select model '{model_name}': {e}");
        }
        if show_init_messages {
            output::stderr_info(format!(
                "Warning: failed to set model '{}': {}",
                model_name, e
            ));
        }
    }
    Ok(provider)
}

/// Interactive or `--api-key` CLI flow for configuring `RAYU_API_KEY` into
/// `~/.config/rayucode/rayu.env`.
pub(super) async fn login_rayu_api_key_cli(
    provided_key: Option<&str>,
    no_validate: bool,
    json: bool,
) -> Result<()> {
    let key = match provided_key {
        Some(value) => value.trim().to_string(),
        None => {
            if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
                anyhow::bail!(
                    "Missing Rayu API key. Pass --api-key rayu_sk_live_... or run interactively."
                );
            }
            eprintln!("Setting up Rayu API key...");
            eprintln!(
                "Create a key at: {}/dashboard/api-keys\n",
                crate::rayu::web_base()
            );
            eprint!("Paste your Rayu API key (rayu_sk_live_...): ");
            std::io::Write::flush(&mut std::io::stderr())?;
            rayucode_terminal_prompt::read_secret_line()?
        }
    };
    let trimmed = key.trim();
    if trimmed.is_empty() {
        anyhow::bail!("No Rayu API key provided.");
    }
    if !trimmed.starts_with("rayu_sk_live_") {
        anyhow::bail!(
            "Invalid Rayu API key format (keys start with 'rayu_sk_live_'). Get one at {}/dashboard/api-keys.",
            crate::rayu::web_base()
        );
    }
    if !no_validate {
        let verdict = crate::rayu::validate_api_key(trimmed).await;
        if let Some(msg) = crate::rayu::api_key_verdict_message(verdict) {
            if matches!(
                verdict,
                crate::rayu::ApiKeyVerdict::Invalid | crate::rayu::ApiKeyVerdict::NoCredit
            ) {
                anyhow::bail!("{msg}");
            }
            if !json {
                eprintln!("Warning: {msg} Saving key anyway (gateway offline).");
            }
        }
    }
    let env_path = crate::rayu::save_api_key(trimmed)?;
    crate::telemetry::record_auth_success("rayu", "api_key");
    if json {
        println!(
            "{}",
            serde_json::json!({
                "status": "authenticated",
                "provider": "rayu",
                "credentials_path": env_path.display().to_string(),
            })
        );
    } else {
        eprintln!("Saved Rayu API key to {}.", env_path.display());
    }
    Ok(())
}

/// Prompt interactively on a TTY between browser OAuth and Rayu API key.
/// Returns `true` when the user selected API key entry.
pub(super) fn prompt_rayu_login_prefers_api_key() -> Result<bool> {
    use std::io::IsTerminal;
    if !std::io::stdin().is_terminal() {
        return Ok(false);
    }
    eprintln!("Choose Rayu authentication method:");
    eprintln!("  [1] Sign in with Rayu account (browser OAuth, recommended)");
    eprintln!("  [2] Enter a Rayu API key (rayu_sk_live_...)");
    eprint!("Enter 1-2 [1]: ");
    std::io::Write::flush(&mut std::io::stderr())?;
    let mut buf = String::new();
    std::io::stdin().read_line(&mut buf)?;
    match buf.trim() {
        "" | "1" => Ok(false),
        "2" => Ok(true),
        other => anyhow::bail!("Invalid choice '{other}'. Enter 1 or 2."),
    }
}

/// CLI Rayu login entry point supporting both browser OAuth and API keys.
pub(super) async fn run_rayu_login_cli(options: &super::login::LoginOptions) -> Result<()> {
    use std::io::IsTerminal;
    if options.openai_compatible_api_key.is_some()
        || (!options.print_auth_url
            && options.callback_url.is_none()
            && options.auth_code.is_none()
            && prompt_rayu_login_prefers_api_key()?)
    {
        return login_rayu_api_key_cli(
            options.openai_compatible_api_key.as_deref(),
            options.no_validate,
            options.json,
        )
        .await;
    }
    if options.auth_code.is_some() {
        anyhow::bail!(
            "Rayu login completes with --callback-url: the authorization code is bound to the login state."
        );
    }
    if options.complete || options.flow_id.is_some() || options.cancel {
        anyhow::bail!(
            "Rayu login keeps no pending flow state. Use --print-auth-url to show the sign-in URL, then --callback-url to complete it."
        );
    }
    let headless = options.no_browser
        || crate::auth::browser_suppressed(false)
        || !std::io::stdin().is_terminal();
    if !options.json {
        eprintln!("Starting Rayu sign-in...");
        if headless && options.callback_url.is_none() {
            eprintln!(
                "If the browser redirect cannot reach this machine, copy the full callback URL and run:\n  rayu login --provider rayu --callback-url <url>"
            );
        }
    }
    let user = crate::rayu::login(crate::rayu::RayuLoginOptions {
        no_browser: headless,
        print_auth_url: options.print_auth_url || headless,
        callback_url: options.callback_url.clone(),
    })
    .await?;
    crate::telemetry::record_auth_success("rayu", "oauth_loopback");
    if options.json {
        println!(
            "{}",
            serde_json::json!({
                "status": "authenticated",
                "provider": "rayu",
                "account_label": Option::<String>::None,
                "credentials_path": crate::rayu::config_dir().join("rayu-auth.json").display().to_string(),
                "email": user.email,
            })
        );
    } else {
        let id = user
            .email
            .as_deref()
            .or(user.display_name.as_deref())
            .unwrap_or("your Rayu account");
        eprintln!("Signed in to Rayu as {id}.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::args::{Args, Command};
    use clap::Parser;

    fn parse_args(argv: &[&str]) -> Args {
        Args::parse_from(argv)
    }

    #[test]
    fn source_update_check_preserves_git_error() {
        let crate::bus::UpdateStatus::Error(message) =
            source_update_check_status(Err(anyhow::anyhow!("git fetch: offline")))
        else {
            panic!("an indeterminate source comparison must report an error");
        };
        assert_eq!(message, "Source update check failed: git fetch: offline");
    }

    #[test]
    fn source_update_check_false_reports_up_to_date() {
        assert!(matches!(
            source_update_check_status(Ok(Some(false))),
            crate::bus::UpdateStatus::UpToDate
        ));
    }

    #[test]
    fn source_update_check_true_reports_available() {
        let crate::bus::UpdateStatus::Available { current, latest } =
            source_update_check_status(Ok(Some(true)))
        else {
            panic!("a source update must remain available");
        };
        assert_eq!(current, rayucode_build_meta::version());
        assert_eq!(latest, "latest source");
    }

    #[test]
    fn source_update_check_real_git_upstream_states() {
        let repo = tempfile::tempdir().expect("temporary source checkout");
        let git = |args: &[&str]| {
            let output = ProcessCommand::new("git")
                .args([
                    "-c",
                    "user.name=Update Test",
                    "-c",
                    "user.email=update-test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "-c",
                    "core.hooksPath=/dev/null",
                ])
                .args(args)
                .current_dir(repo.path())
                .output()
                .expect("run git fixture command");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "-b", "source"]);
        git(&["commit", "--allow-empty", "-m", "initial"]);

        // A local branch without tracking is skipped before claiming a fetch slot.
        let result = hot_exec::check_for_updates_in(repo.path(), || {
            panic!("untracked checkouts must not fetch or claim the fetch slot")
        });
        assert_eq!(*result.as_ref().unwrap(), None);
        assert!(matches!(
            source_update_check_status(result),
            crate::bus::UpdateStatus::Skipped { .. }
        ));

        // Local branches supply tracking controls without fetching or networking.
        git(&["branch", "upstream"]);
        git(&["branch", "--set-upstream-to=upstream", "source"]);
        let result = hot_exec::check_for_updates_in(repo.path(), || false);
        assert_eq!(*result.as_ref().unwrap(), Some(false));
        assert!(matches!(
            source_update_check_status(result),
            crate::bus::UpdateStatus::UpToDate
        ));

        git(&["checkout", "upstream"]);
        git(&["commit", "--allow-empty", "-m", "upstream update"]);
        git(&["checkout", "source"]);
        let result = hot_exec::check_for_updates_in(repo.path(), || false);
        assert_eq!(*result.as_ref().unwrap(), Some(true));
        assert!(matches!(
            source_update_check_status(result),
            crate::bus::UpdateStatus::Available { .. }
        ));

        // Local commits alone are not updates.
        git(&["checkout", "upstream"]);
        git(&["branch", "--set-upstream-to=source", "upstream"]);
        let result = hot_exec::check_for_updates_in(repo.path(), || false);
        assert_eq!(result.unwrap(), Some(false));

        git(&["checkout", "--detach"]);
        let result = hot_exec::check_for_updates_in(repo.path(), || {
            panic!("detached checkouts must not fetch")
        });
        assert!(matches!(
            source_update_check_status(result),
            crate::bus::UpdateStatus::Skipped { .. }
        ));

        // A configured but missing upstream must still report an error.
        git(&["checkout", "source"]);
        git(&["branch", "-D", "upstream"]);
        let result = hot_exec::check_for_updates_in(repo.path(), || false);
        assert!(matches!(
            source_update_check_status(result),
            crate::bus::UpdateStatus::Error(_)
        ));

        // Network/fetch failures on tracked branches must not become skips.
        git(&["remote", "add", "origin", "./missing-remote"]);
        git(&["update-ref", "refs/remotes/origin/source", "HEAD"]);
        git(&["config", "branch.source.remote", "origin"]);
        git(&["config", "branch.source.merge", "refs/heads/source"]);
        let result = hot_exec::check_for_updates_in(repo.path(), || true);
        let crate::bus::UpdateStatus::Error(message) = source_update_check_status(result) else {
            panic!("failed fetch must report an error");
        };
        assert!(message.contains("git fetch -q:"));
    }

    #[test]
    fn source_update_check_invalid_checkout_reports_error() {
        let directory = tempfile::tempdir().unwrap();
        let result = hot_exec::check_for_updates_in(directory.path(), || {
            panic!("invalid checkouts must not fetch")
        });
        assert!(matches!(
            source_update_check_status(result),
            crate::bus::UpdateStatus::Error(_)
        ));
    }

    #[test]
    fn telemetry_subcommand_skips_startup_telemetry() {
        assert!(is_telemetry_subcommand_invocation([
            "rayu",
            "telemetry",
            "disable"
        ]));
        assert!(is_telemetry_subcommand_invocation([
            "rayu",
            "--no-update",
            "telemetry",
            "disable"
        ]));
        assert!(is_telemetry_subcommand_invocation([
            "rayu",
            "--provider",
            "openai",
            "telemetry",
            "disable"
        ]));
    }

    #[test]
    fn telemetry_prompt_does_not_skip_normal_startup_telemetry() {
        assert!(!is_telemetry_subcommand_invocation([
            "rayu",
            "run",
            "telemetry"
        ]));
    }

    #[test]
    fn parses_mcp_tool_exposure_flags() {
        let args = parse_args(&[
            "rayu",
            "--mcp-tools",
            "deferred",
            "--mcp-tools-token-threshold",
            "4321",
            "run",
            "hello",
        ]);
        assert_eq!(args.mcp_tools.as_deref(), Some("deferred"));
        assert_eq!(args.mcp_tools_token_threshold, Some(4_321));
    }

    #[test]
    fn auto_install_allowed_without_live_terminal() {
        let args = parse_args(&["rayu", "login"]);
        assert!(should_auto_install_update(&args));
    }

    #[test]
    fn auto_install_allowed_with_live_terminal_attached() {
        let args = parse_args(&["rayu", "login"]);
        assert!(should_auto_install_update(&args));
    }

    #[test]
    fn auto_install_respects_explicit_disable_even_without_terminal() {
        let mut args = parse_args(&["rayu", "login"]);
        args.auto_update = false;
        assert!(!should_auto_install_update(&args));
    }

    #[test]
    fn remote_working_dir_validation_requires_absolute_path() {
        assert!(validate_remote_working_dir(Some("/home/agent/project")).is_ok());
        assert!(validate_remote_working_dir(Some("C:\\Users\\agent\\project")).is_ok());
        assert!(validate_remote_working_dir(None).is_ok());

        let error = validate_remote_working_dir(Some("relative/project")).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("--remote-working-dir must be an absolute path")
        );
    }

    #[test]
    fn update_command_still_skips_background_check_before_auto_install_logic() {
        let args = parse_args(&["rayu", "update"]);
        assert!(matches!(args.command, Some(Command::Update { .. })));
        assert!(!should_spawn_background_update_check(&args));
        assert!(should_auto_install_update(&args));
    }

    #[test]
    fn config_can_permanently_disable_background_update_checks() {
        let args = parse_args(&["rayu", "login"]);
        assert!(should_spawn_background_update_check_with_config(
            &args, true
        ));
        assert!(!should_spawn_background_update_check_with_config(
            &args, false
        ));
    }

    #[test]
    fn hidden_spawn_hotkey_argument_is_global_and_preserves_canonical_text() {
        let args = parse_args(&["rayu", "--spawn-hotkey", "shift+cmd+'", "self-dev"]);
        assert_eq!(args.spawn_hotkey.as_deref(), Some("shift+cmd+'"));
        assert!(matches!(args.command, Some(Command::SelfDev { .. })));
    }
    #[test]
    fn external_provider_runtimes_register_and_instantiate() {
        register_external_provider_runtimes();
        for (key, expected_name) in [
            (crate::provider::external::GEMINI_RUNTIME, "gemini"),
            (crate::provider::external::CURSOR_RUNTIME, "cursor"),
            (
                crate::provider::external::ANTIGRAVITY_RUNTIME,
                "antigravity",
            ),
            (crate::provider::external::RAYU_RUNTIME, "rayu"),
        ] {
            assert!(
                crate::provider::external::external_provider_registered(key),
                "{key} runtime should be registered"
            );
            let provider = crate::provider::external::instantiate_external_provider(key)
                .unwrap_or_else(|| panic!("{key} runtime factory should instantiate"));
            assert_eq!(provider.name(), expected_name);
            assert!(!provider.model().is_empty());
        }

        // Copilot's factory is fallible (requires a GitHub token), so only
        // assert registration; instantiation legitimately returns None when no
        // Copilot credentials exist on the machine running the tests.
        assert!(crate::provider::external::external_provider_registered(
            crate::provider::external::COPILOT_RUNTIME
        ));
    }
}
