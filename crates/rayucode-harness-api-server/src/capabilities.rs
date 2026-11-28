//! Curated v1.16 engine capability discovery, model-route enrichment, config RPC
//! event mapping, and structured daemon error classification.

use rayucode_base::config::rpc_config::{
    ConfigSnapshot, RpcConfigApplyMode, RpcConfigFieldKind,
};
use rayucode_harness_api::{
    ApiEvent, CommandCategory, CommandDescriptor, CommandDispatch, ConfigApplyMode,
    ConfigEnumOption, ConfigFieldKind, ConfigFieldSchema, ErrorCode, FeatureFlagDescriptor,
    ModelRouteInfo, PermissionMode, PermissionModeDescriptor,
};

/// Build the `ApiEvent::Capabilities` payload from the live engine registry and config.
///
/// Explicitly excludes TUI-only terminal layout commands (`cls`, `clear-view`,
/// `alignment`, `debug-visual`, `onboarding-sim`, `update-sim`, `terminal-setup`,
/// `new-terminal`, `screenshot-mode`).
pub fn build_capabilities_event(_session_id: Option<&str>) -> ApiEvent {
    ApiEvent::Capabilities {
        commands: curated_commands(),
        permission_modes: curated_permission_modes(),
        features: live_feature_flags(),
    }
}

fn curated_commands() -> Vec<CommandDescriptor> {
    vec![
        // Core Harness API request-dispatched commands
        CommandDescriptor {
            name: "compact".into(),
            description: "Summarize earlier conversation history to free context space".into(),
            category: CommandCategory::Session,
            arg_hint: None,
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "compact".into(),
            },
        },
        CommandDescriptor {
            name: "effort".into(),
            description: "Set or inspect the model reasoning effort level".into(),
            category: CommandCategory::Model,
            arg_hint: Some("none|minimal|low|medium|high|xhigh|max".into()),
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "set_reasoning_effort".into(),
            },
        },
        CommandDescriptor {
            name: "model".into(),
            description: "Switch the active model for this session".into(),
            category: CommandCategory::Model,
            arg_hint: Some("<model-id>".into()),
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "set_model".into(),
            },
        },
        CommandDescriptor {
            name: "clear".into(),
            description: "Clear conversation history in the current session".into(),
            category: CommandCategory::Session,
            arg_hint: None,
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "clear".into(),
            },
        },
        CommandDescriptor {
            name: "fork".into(),
            description: "Fork the current session transcript into a new idle session".into(),
            category: CommandCategory::Session,
            arg_hint: None,
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "fork_session".into(),
            },
        },
        CommandDescriptor {
            name: "rewind".into(),
            description: "Rewind conversation history to an earlier message index".into(),
            category: CommandCategory::Session,
            arg_hint: Some("<message-index>".into()),
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "rewind".into(),
            },
        },
        CommandDescriptor {
            name: "rename".into(),
            description: "Rename the active session title".into(),
            category: CommandCategory::Session,
            arg_hint: Some("<title>".into()),
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "rename_session".into(),
            },
        },
        CommandDescriptor {
            name: "save".into(),
            description: "Bookmark the active session with an optional label".into(),
            category: CommandCategory::Session,
            arg_hint: Some("[label]".into()),
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "set_session_saved".into(),
            },
        },
        CommandDescriptor {
            name: "mode".into(),
            description: "Change the local tool approval permission mode".into(),
            category: CommandCategory::Tools,
            arg_hint: Some("default|accept_edits|plan|full_manage|orchestrator".into()),
            requires_session: true,
            dispatch: CommandDispatch::ApiRequest {
                req: "set_permission_mode".into(),
            },
        },
        // Curated client-safe RuntimeCommand-dispatched commands
        CommandDescriptor {
            name: "review".into(),
            description: "Run an automated code review of current workspace changes".into(),
            category: CommandCategory::Quality,
            arg_hint: Some("[focus]".into()),
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "review".into(),
            },
        },
        CommandDescriptor {
            name: "judge".into(),
            description: "Run an execution quality judge check on recent work".into(),
            category: CommandCategory::Quality,
            arg_hint: Some("[focus]".into()),
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "judge".into(),
            },
        },
        CommandDescriptor {
            name: "context".into(),
            description: "Inspect token budget and context window breakdown".into(),
            category: CommandCategory::Session,
            arg_hint: None,
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "context".into(),
            },
        },
        CommandDescriptor {
            name: "cache".into(),
            description: "Inspect prompt KV cache hit rate and invalidation diagnostics".into(),
            category: CommandCategory::Runtime,
            arg_hint: None,
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "cache".into(),
            },
        },
        CommandDescriptor {
            name: "info".into(),
            description: "Show session provider, model, and runtime metadata".into(),
            category: CommandCategory::Runtime,
            arg_hint: None,
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "info".into(),
            },
        },
        CommandDescriptor {
            name: "skills".into(),
            description: "List or toggle available skills discovered for this workspace".into(),
            category: CommandCategory::Tools,
            arg_hint: Some("[list|enable|disable|toggle <name>]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "skills".into(),
            },
        },
        CommandDescriptor {
            name: "memory".into(),
            description: "Inspect or manage semantic session memory".into(),
            category: CommandCategory::Tools,
            arg_hint: Some("[status|list|extract|on|off]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "memory".into(),
            },
        },
        CommandDescriptor {
            name: "mcp".into(),
            description: "Inspect connected MCP servers and exposed tools".into(),
            category: CommandCategory::Tools,
            arg_hint: Some("[list|status|test|toggle|reload]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "mcp".into(),
            },
        },
        CommandDescriptor {
            name: "swarm".into(),
            description: "Inspect and orchestrate multi-agent swarm workers".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[status|spawn|stop|resume|dm|broadcast]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "swarm".into(),
            },
        },
        CommandDescriptor {
            name: "agents".into(),
            description: "Inspect or configure agent profiles and worker defaults".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[global] [role|profile ...]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "agents".into(),
            },
        },
        CommandDescriptor {
            name: "subagent".into(),
            description: "Spawn a focused subagent worker for a delegated task".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[--model <model>] <prompt>".into()),
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "subagent".into(),
            },
        },
        CommandDescriptor {
            name: "subagent-model".into(),
            description: "Inspect or set the default subagent/swarm model".into(),
            category: CommandCategory::Model,
            arg_hint: Some("[global] [show|inherit|default|<model>]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "subagent_model".into(),
            },
        },
        CommandDescriptor {
            name: "autoreview".into(),
            description: "Toggle or inspect automatic end-of-turn code review".into(),
            category: CommandCategory::Quality,
            arg_hint: Some("[on|off]".into()),
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "autoreview".into(),
            },
        },
        CommandDescriptor {
            name: "autojudge".into(),
            description: "Toggle or inspect automatic end-of-turn execution judging".into(),
            category: CommandCategory::Quality,
            arg_hint: Some("[on|off]".into()),
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "autojudge".into(),
            },
        },
        CommandDescriptor {
            name: "background".into(),
            description: "Inspect running or recently finished background tasks".into(),
            category: CommandCategory::Runtime,
            arg_hint: None,
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "background".into(),
            },
        },
        CommandDescriptor {
            name: "doctor".into(),
            description: "Run runtime health and provider connectivity diagnostics".into(),
            category: CommandCategory::Runtime,
            arg_hint: None,
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "doctor".into(),
            },
        },
        CommandDescriptor {
            name: "features".into(),
            description: "Inspect or toggle runtime feature flags".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[name on|off]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "features".into(),
            },
        },
        CommandDescriptor {
            name: "refresh-models".into(),
            description: "Refresh live model catalogs from configured providers".into(),
            category: CommandCategory::Model,
            arg_hint: None,
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "refresh_model_list".into(),
            },
        },
        CommandDescriptor {
            name: "fast".into(),
            description: "Toggle or inspect fast/priority OpenAI service tier".into(),
            category: CommandCategory::Model,
            arg_hint: Some("[on|off|ultrafast]".into()),
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "fast".into(),
            },
        },
        CommandDescriptor {
            name: "transport".into(),
            description: "Inspect or switch OpenAI transport mode".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[auto|websocket|https]".into()),
            requires_session: true,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "transport".into(),
            },
        },
        CommandDescriptor {
            name: "overnight".into(),
            description: "Launch, inspect, review, or cancel supervised overnight runs".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[list|status|log|review|cancel|start|<duration> <mission>]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "overnight".into(),
            },
        },
        CommandDescriptor {
            name: "schedules".into(),
            description: "List, create, toggle, trigger, or cancel one-shot and recurring tasks".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[list|create|toggle|run|update|cancel]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "schedules".into(),
            },
        },
        CommandDescriptor {
            name: "ambient".into(),
            description: "Inspect ambient status and resolve pending ambient approvals".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[status|approvals|decide]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "ambient".into(),
            },
        },
        CommandDescriptor {
            name: "telegram".into(),
            description: "Pair, inspect, and control Telegram remote bridge and approvals".into(),
            category: CommandCategory::Runtime,
            arg_hint: Some("[status|approvals|decide|link_hosted|link_botfather|disconnect|ping]".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "telegram".into(),
            },
        },
        CommandDescriptor {
            name: "search".into(),
            description: "Search across past session transcripts".into(),
            category: CommandCategory::Session,
            arg_hint: Some("<query>".into()),
            requires_session: false,
            dispatch: CommandDispatch::RuntimeCommand {
                command: "session_search".into(),
            },
        },
    ]
}

fn curated_permission_modes() -> Vec<PermissionModeDescriptor> {
    PermissionMode::ALL
        .iter()
        .map(|mode| {
            let (label, description, is_default) = match mode {
                PermissionMode::Default => (
                    "Default",
                    "Ask before running shell commands or editing files outside safe bounds.",
                    true,
                ),
                PermissionMode::AcceptEdits => (
                    "Accept Edits",
                    "Automatically approve file edits while still prompting for risky commands.",
                    false,
                ),
                PermissionMode::Plan => (
                    "Plan",
                    "Read-only exploration and planning mode without mutating workspace files.",
                    false,
                ),
                PermissionMode::FullManage => (
                    "Full Manage",
                    "Allow workspace edits and commands automatically without interactive prompts.",
                    false,
                ),
                PermissionMode::Orchestrator => (
                    "Orchestrator",
                    "Coordinate multi-agent tasks and subagent delegation with elevated privileges.",
                    false,
                ),
            };
            PermissionModeDescriptor {
                id: mode.as_str().to_string(),
                label: label.to_string(),
                description: description.to_string(),
                is_default,
            }
        })
        .collect()
}

fn live_feature_flags() -> Vec<FeatureFlagDescriptor> {
    let features = &rayucode_base::config::config().features;
    vec![
        FeatureFlagDescriptor {
            key: "features.memory".into(),
            enabled: features.memory,
            description: "Enable automatic memory retrieval and extraction across sessions.".into(),
            requires_restart: false,
        },
        FeatureFlagDescriptor {
            key: "features.swarm".into(),
            enabled: features.swarm,
            description: "Enable multi-agent swarm spawning and coordination tools.".into(),
            requires_restart: false,
        },
        FeatureFlagDescriptor {
            key: "features.mermaid".into(),
            enabled: features.mermaid,
            description: "Enable Mermaid diagram rendering and diagram guidance.".into(),
            requires_restart: false,
        },
        FeatureFlagDescriptor {
            key: "features.auto_poke".into(),
            enabled: features.auto_poke,
            description: "Automatically follow up when the agent stops with incomplete todos."
                .into(),
            requires_restart: false,
        },
        FeatureFlagDescriptor {
            key: "features.kv_cache_miss_notices".into(),
            enabled: features.kv_cache_miss_notices,
            description: "Surface in-chat notices when prompt KV cache misses occur.".into(),
            requires_restart: false,
        },
        FeatureFlagDescriptor {
            key: "features.check_updates".into(),
            enabled: features.check_updates,
            description: "Check for and install RayuCode updates on startup.".into(),
            requires_restart: true,
        },
        FeatureFlagDescriptor {
            key: "features.message_timestamps".into(),
            enabled: features.message_timestamps,
            description: "Include timestamps in user messages and tool results sent to models."
                .into(),
            requires_restart: false,
        },
    ]
}

/// Populate `supported_efforts` (minus TUI-only `swarm*` sentinels), `default_effort`,
/// and `context_window` on a `ModelRouteInfo` using the shared Rust provider metadata.
pub fn enrich_model_route(route: &mut ModelRouteInfo) {
    let provider_hint = if route.provider.trim().is_empty()
        || route.provider.trim().eq_ignore_ascii_case("auto")
    {
        if route.api_method.trim().is_empty() {
            route.provider.as_str()
        } else {
            route.api_method.as_str()
        }
    } else {
        route.provider.as_str()
    };

    let efforts: Vec<String> = rayucode_provider_core::inferred_reasoning_efforts(
        Some(provider_hint),
        Some(route.model.as_str()),
    )
    .into_iter()
    .filter(|effort| !effort.starts_with("swarm"))
    .map(str::to_string)
    .collect();

    let default_effort = if efforts.is_empty() {
        None
    } else {
        let cfg = rayucode_base::config::config();
        let lower_provider = provider_hint.trim().to_ascii_lowercase();
        let lower_model = route.model.trim().to_ascii_lowercase();

        let is_rayu = lower_provider.contains("rayu");
        let is_openrouter_or_compat = lower_provider.contains("openrouter")
            || lower_provider.contains("deepseek")
            || lower_provider.contains("copilot")
            || lower_provider.contains("openai-compatible")
            || lower_provider.contains("z.ai")
            || lower_provider == "zai";
        let is_anthropic = !is_rayu
            && !is_openrouter_or_compat
            && (lower_provider.contains("anthropic")
                || lower_provider.contains("claude")
                || (lower_provider.is_empty() && lower_model.starts_with("claude-")));
        let is_openai = !is_rayu
            && !is_openrouter_or_compat
            && (lower_provider.contains("openai")
                || lower_provider.contains("codex")
                || (lower_provider.is_empty()
                    && (lower_model.starts_with("gpt-")
                        || lower_model.starts_with("o1")
                        || lower_model.starts_with("o3")
                        || lower_model.starts_with("o4")
                        || lower_model.starts_with("o5"))));

        let configured = if is_anthropic {
            cfg.provider.anthropic_reasoning_effort.as_deref()
        } else if is_openai {
            cfg.provider.openai_reasoning_effort.as_deref()
        } else {
            None
        };

        let prefer_low_default = is_rayu || is_anthropic || is_openai;

        configured
            .and_then(|value| {
                efforts
                    .iter()
                    .find(|candidate| candidate.eq_ignore_ascii_case(value))
                    .cloned()
            })
            .or_else(|| {
                let order: &[&str] = if prefer_low_default {
                    &["low", "medium"]
                } else {
                    &["medium", "low"]
                };
                order.iter().find_map(|target| {
                    efforts
                        .iter()
                        .find(|candidate| candidate.as_str() == *target)
                        .cloned()
                })
            })
            .or_else(|| efforts.first().cloned())
    };

    route.supported_efforts = efforts;
    route.default_effort = default_effort;
    if route.context_window.is_none() {
        route.context_window = rayucode_base::provider::context_limit_for_model_with_provider(
            &route.model,
            Some(&route.provider),
        )
        .map(|limit| limit as u64);
    }
}

/// Convert a `rayucode-base` `ConfigSnapshot` into the wire `ApiEvent::ConfigState`.
pub fn rpc_snapshot_to_api_event(snapshot: ConfigSnapshot) -> ApiEvent {
    let schema = snapshot
        .schema
        .into_iter()
        .map(|field| ConfigFieldSchema {
            key: field.key,
            section: field.section,
            label: field.label,
            description: field.description,
            kind: match field.kind {
                RpcConfigFieldKind::Boolean => ConfigFieldKind::Boolean,
                RpcConfigFieldKind::String => ConfigFieldKind::String,
                RpcConfigFieldKind::Integer => ConfigFieldKind::Integer,
                RpcConfigFieldKind::Number => ConfigFieldKind::Number,
                RpcConfigFieldKind::Enum => ConfigFieldKind::Enum,
                RpcConfigFieldKind::StringArray => ConfigFieldKind::StringArray,
            },
            options: field.options.map(|opts| {
                opts.into_iter()
                    .map(|opt| ConfigEnumOption {
                        value: opt.value,
                        label: opt.label,
                    })
                    .collect()
            }),
            default_value: field.default_value,
            apply_mode: match field.apply_mode {
                RpcConfigApplyMode::Immediate => ConfigApplyMode::Immediate,
                RpcConfigApplyMode::NextTurn => ConfigApplyMode::NextTurn,
                RpcConfigApplyMode::RestartRequired => ConfigApplyMode::RestartRequired,
            },
        })
        .collect();

    ApiEvent::ConfigState {
        path: snapshot.path,
        sections: snapshot.sections,
        values: snapshot.values,
        schema,
    }
}

/// Map daemon error prose into structured `ErrorCode::Busy` / `ErrorCode::Unsupported`
/// so thin clients do not need regex error scraping.
pub fn classify_daemon_error(message: &str, default: ErrorCode) -> ErrorCode {
    let lower = message.to_ascii_lowercase();
    if lower.contains("authentication required")
        || lower.contains("no configured ai provider is ready")
        || lower.contains("rayu login")
    {
        return ErrorCode::AuthRequired;
    }
    if lower.contains("busy")
        || lower.contains("turn in progress")
        || lower.contains("already processing")
        || lower.contains("while generating")
        || lower.contains("while streaming")
        || lower.contains("active turn")
        || lower.contains("cannot switch while")
        || lower.contains("wait for the current turn")
    {
        return ErrorCode::Busy;
    }
    if lower.contains("does not support")
        || lower.contains("not supported")
        || lower.contains("unsupported")
        || lower.contains("no reasoning effort")
        || lower.contains("reasoning effort is not")
        || lower.contains("unavailable for this model")
    {
        return ErrorCode::Unsupported;
    }
    default
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

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

    fn route(provider: &str, model: &str, api_method: &str) -> ModelRouteInfo {
        ModelRouteInfo {
            model: model.to_string(),
            provider: provider.to_string(),
            api_method: api_method.to_string(),
            available: true,
            detail: String::new(),
            usage: None,
            supported_efforts: Vec::new(),
            default_effort: None,
            context_window: None,
        }
    }

    #[test]
    fn enrich_model_route_resolves_supported_efforts_and_defaults_across_providers() {
        let _lock = crate::translate::rayu_home_test_lock();
        let home = tempfile::tempdir().unwrap();
        let _guard = RayuHomeGuard(std::env::var_os("RAYU_HOME"));
        unsafe { std::env::set_var("RAYU_HOME", home.path()) };
        rayucode_base::config::Config::invalidate_cache();

        // Anthropic Opus 4.7: full ladder minus swarm, default "low"
        let mut opus = route("Anthropic", "claude-opus-4-7", "claude-oauth");
        enrich_model_route(&mut opus);
        assert_eq!(
            opus.supported_efforts,
            vec!["none", "low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(opus.default_effort.as_deref(), Some("low"));

        // Anthropic Haiku 4.5: no reasoning effort
        let mut haiku = route("Anthropic", "claude-haiku-4-5", "claude-oauth");
        enrich_model_route(&mut haiku);
        assert!(haiku.supported_efforts.is_empty());
        assert_eq!(haiku.default_effort, None);

        // OpenAI standard + Pro models
        let mut gpt54 = route("OpenAI", "gpt-5.4", "openai-oauth");
        enrich_model_route(&mut gpt54);
        assert_eq!(
            gpt54.supported_efforts,
            vec!["none", "minimal", "low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(gpt54.default_effort.as_deref(), Some("low"));

        let mut gpt5_pro = route("OpenAI", "gpt-5-pro", "openai-api-key");
        enrich_model_route(&mut gpt5_pro);
        assert_eq!(gpt5_pro.supported_efforts, vec!["high"]);
        assert_eq!(gpt5_pro.default_effort.as_deref(), Some("high"));

        let mut gpt54_pro = route("OpenAI", "gpt-5.4-pro", "openai-api-key");
        enrich_model_route(&mut gpt54_pro);
        assert_eq!(gpt54_pro.supported_efforts, vec!["medium", "high", "xhigh"]);
        assert_eq!(gpt54_pro.default_effort.as_deref(), Some("medium"));

        // Rayu hosted routes default to "low" regardless of upstream model family
        for model in ["claude-opus-4-7", "gpt-5.4"] {
            let mut rayu = route("Rayu", model, "rayu");
            enrich_model_route(&mut rayu);
            assert_eq!(
                rayu.supported_efforts,
                vec!["none", "minimal", "low", "medium", "high", "xhigh", "max"]
            );
            assert_eq!(rayu.default_effort.as_deref(), Some("low"));
        }

        // OpenRouter, DeepSeek, Copilot resolve medium / low / first
        let mut openrouter = route("OpenRouter", "anthropic/claude-opus-4-7", "openrouter");
        enrich_model_route(&mut openrouter);
        assert_eq!(
            openrouter.supported_efforts,
            vec!["none", "minimal", "low", "medium", "high", "xhigh"]
        );
        assert_eq!(openrouter.default_effort.as_deref(), Some("medium"));

        let mut openrouter_auto = route("auto", "anthropic/claude-opus-4-7", "openrouter");
        enrich_model_route(&mut openrouter_auto);
        assert_eq!(
            openrouter_auto.supported_efforts,
            vec!["none", "minimal", "low", "medium", "high", "xhigh"]
        );
        assert_eq!(openrouter_auto.default_effort.as_deref(), Some("medium"));

        let mut deepseek = route("DeepSeek", "deepseek-reasoner", "openai-compatible:deepseek");
        enrich_model_route(&mut deepseek);
        assert_eq!(
            deepseek.supported_efforts,
            vec!["none", "low", "medium", "high", "max"]
        );
        assert_eq!(deepseek.default_effort.as_deref(), Some("medium"));

        let mut copilot_claude = route("Copilot", "claude-opus-4-7", "copilot");
        enrich_model_route(&mut copilot_claude);
        assert_eq!(
            copilot_claude.supported_efforts,
            vec!["none", "low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(copilot_claude.default_effort.as_deref(), Some("medium"));

        // Non-effort providers never advertise supported_efforts or default_effort
        for (provider, model, api_method) in [
            ("Cursor", "claude-opus-4-7", "cursor"),
            ("Antigravity", "gpt-5.4", "antigravity"),
            ("AWS Bedrock", "claude-opus-4-7", "bedrock"),
            ("Gemini", "gemini-2.5-pro", "code-assist-oauth"),
            ("Grok Build", "grok-4", "grok-build"),
        ] {
            let mut non_effort = route(provider, model, api_method);
            enrich_model_route(&mut non_effort);
            assert!(
                non_effort.supported_efforts.is_empty(),
                "non-effort provider `{provider}` must not advertise efforts"
            );
            assert_eq!(non_effort.default_effort, None);
        }
    }
}
