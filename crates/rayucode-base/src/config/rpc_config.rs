//! Curated, secret-safe `~/.rayu/config.toml` schema reader and atomic `toml_edit` patcher
//! backing the Harness API v1.16 `get_config` and `patch_config` RPCs.

use super::{Config, change_report};
use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicU64, Ordering},
};

/// The 10 curated user-facing configuration sections exposed over Harness API v1.16+.
pub const CURATED_CONFIG_SECTIONS: &[&str] = &[
    "provider",
    "compaction",
    "display",
    "features",
    "safety",
    "agents",
    "autoreview",
    "autojudge",
    "notifications",
    "ambient",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RpcConfigFieldKind {
    Boolean,
    String,
    Integer,
    Number,
    Enum,
    StringArray,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RpcConfigApplyMode {
    Immediate,
    NextTurn,
    RestartRequired,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcConfigEnumOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigFieldDescriptor {
    pub key: String,
    pub section: String,
    pub label: String,
    pub description: String,
    pub kind: RpcConfigFieldKind,
    pub options: Option<Vec<RpcConfigEnumOption>>,
    pub default_value: Value,
    pub apply_mode: RpcConfigApplyMode,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigSnapshot {
    pub path: String,
    pub sections: Vec<String>,
    pub values: Map<String, Value>,
    pub schema: Vec<ConfigFieldDescriptor>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigPatchOutcome {
    pub snapshot: ConfigSnapshot,
    pub changed_keys: Vec<String>,
    pub requires_restart: bool,
}

struct FieldSpec {
    key: &'static str,
    section: &'static str,
    field: &'static str,
    label: &'static str,
    description: &'static str,
    kind: RpcConfigFieldKind,
    options: Option<&'static [(&'static str, &'static str)]>,
    nullable: bool,
    int_bounds: Option<(i64, i64)>,
    float_bounds: Option<(f64, f64)>,
    apply_mode: RpcConfigApplyMode,
    default_fn: fn() -> Value,
    read_fn: fn(&Config) -> Value,
}

const EFFORT_OPTIONS_OPENAI: &[(&str, &str)] = &[
    ("none", "Off"),
    ("minimal", "Minimal"),
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("xhigh", "Extra High"),
    ("max", "Max"),
];

const EFFORT_OPTIONS_ANTHROPIC: &[(&str, &str)] = &[
    ("none", "Off"),
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("xhigh", "Extra High"),
    ("max", "Max"),
];

const SERVICE_TIER_OPTIONS: &[(&str, &str)] = &[
    ("priority", "Priority"),
    ("ultrafast", "Ultrafast"),
    ("flex", "Flex"),
    ("off", "Standard (Off)"),
];

const TRANSPORT_OPTIONS: &[(&str, &str)] = &[
    ("auto", "Auto"),
    ("websocket", "WebSocket"),
    ("https", "HTTPS"),
];

const COMPRESSION_OPTIONS: &[(&str, &str)] = &[
    ("auto", "Auto"),
    ("always", "Always"),
    ("off", "Off"),
];

const COMPACTION_MODE_OPTIONS: &[(&str, &str)] = &[
    ("reactive", "Reactive"),
    ("proactive", "Proactive"),
    ("semantic", "Semantic"),
];

const REASONING_DISPLAY_OPTIONS: &[(&str, &str)] = &[
    ("off", "Off"),
    ("compact", "Compact"),
    ("full", "Full"),
    ("current", "Current"),
];

const DIFF_MODE_OPTIONS: &[(&str, &str)] = &[
    ("off", "Off"),
    ("inline", "Inline"),
    ("full-inline", "Full Inline"),
    ("file", "File"),
];

const UPDATE_CHANNEL_OPTIONS: &[(&str, &str)] = &[
    ("stable", "Stable"),
    ("preview", "Preview"),
    ("main", "Main"),
];

const SWARM_SPAWN_MODE_OPTIONS: &[(&str, &str)] = &[
    ("inline", "Inline"),
    ("visible", "Visible Window"),
    ("headless", "Headless"),
    ("auto", "Auto"),
];

fn field_specs() -> &'static [FieldSpec] {
    static SPECS: OnceLock<Vec<FieldSpec>> = OnceLock::new();
    SPECS.get_or_init(|| {
        vec![
            // --- provider ---
            FieldSpec {
                key: "provider.default_model",
                section: "provider",
                field: "default_model",
                label: "Default Model",
                description: "Default model identifier used for new sessions.",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.provider
                        .default_model
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "provider.default_provider",
                section: "provider",
                field: "default_provider",
                label: "Default Provider",
                description: "Default provider route used when starting sessions.",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.provider
                        .default_provider
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "provider.openai_reasoning_effort",
                section: "provider",
                field: "openai_reasoning_effort",
                label: "OpenAI Reasoning Effort",
                description: "Default reasoning effort for OpenAI models.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(EFFORT_OPTIONS_OPENAI),
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!("low"),
                read_fn: |c| {
                    c.provider
                        .openai_reasoning_effort
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "provider.anthropic_reasoning_effort",
                section: "provider",
                field: "anthropic_reasoning_effort",
                label: "Anthropic Reasoning Effort",
                description: "Default reasoning effort for Claude models.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(EFFORT_OPTIONS_ANTHROPIC),
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!("low"),
                read_fn: |c| {
                    c.provider
                        .anthropic_reasoning_effort
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "provider.anthropic_cache_ttl_1h",
                section: "provider",
                field: "anthropic_cache_ttl_1h",
                label: "1-Hour Prompt Cache TTL",
                description: "Request one-hour Anthropic prompt caching instead of five minutes.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!(true),
                read_fn: |c| json!(c.provider.anthropic_cache_ttl_1h),
            },
            FieldSpec {
                key: "provider.openai_service_tier",
                section: "provider",
                field: "openai_service_tier",
                label: "OpenAI Service Tier",
                description: "Preferred OpenAI latency/cost tier (priority, ultrafast, flex, off).",
                kind: RpcConfigFieldKind::Enum,
                options: Some(SERVICE_TIER_OPTIONS),
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!("priority"),
                read_fn: |c| {
                    c.provider
                        .openai_service_tier
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "provider.openai_transport",
                section: "provider",
                field: "openai_transport",
                label: "OpenAI Transport",
                description: "Transport protocol for OpenAI Responses API (auto, websocket, https).",
                kind: RpcConfigFieldKind::Enum,
                options: Some(TRANSPORT_OPTIONS),
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.provider
                        .openai_transport
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "provider.preserve_reasoning_context",
                section: "provider",
                field: "preserve_reasoning_context",
                label: "Preserve Reasoning Context",
                description: "Keep provider-native reasoning/thinking items across turns when supported.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!(true),
                read_fn: |c| json!(c.provider.preserve_reasoning_context),
            },
            FieldSpec {
                key: "provider.same_provider_account_failover",
                section: "provider",
                field: "same_provider_account_failover",
                label: "Same-Provider Account Failover",
                description: "Try another pooled account on the same provider before failing over.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.provider.same_provider_account_failover),
            },
            FieldSpec {
                key: "provider.request_compression",
                section: "provider",
                field: "request_compression",
                label: "Request Compression",
                description: "Request-body compression policy for supported endpoints.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(COMPRESSION_OPTIONS),
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!("auto"),
                read_fn: |c| json!(c.provider.request_compression),
            },
            FieldSpec {
                key: "provider.stream_idle_timeout_secs",
                section: "provider",
                field: "stream_idle_timeout_secs",
                label: "Stream Idle Timeout (s)",
                description: "Base seconds to wait without streamed data before timing out.",
                kind: RpcConfigFieldKind::Integer,
                options: None,
                nullable: false,
                int_bounds: Some((10, 3600)),
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!(180),
                read_fn: |c| json!(c.provider.stream_idle_timeout_secs),
            },
            FieldSpec {
                key: "provider.max_retries",
                section: "provider",
                field: "max_retries",
                label: "Max Provider Retries",
                description: "Maximum attempts for transient provider errors including the initial attempt.",
                kind: RpcConfigFieldKind::Integer,
                options: None,
                nullable: false,
                int_bounds: Some((0, 50)),
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!(8),
                read_fn: |c| json!(c.provider.max_retries),
            },
            // --- compaction ---
            FieldSpec {
                key: "compaction.mode",
                section: "compaction",
                field: "mode",
                label: "Compaction Mode",
                description: "Strategy used to automatically compact long conversation transcripts.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(COMPACTION_MODE_OPTIONS),
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!("reactive"),
                read_fn: |c| json!(c.compaction.mode.as_str()),
            },
            FieldSpec {
                key: "compaction.reactive_threshold",
                section: "compaction",
                field: "reactive_threshold",
                label: "Reactive Fill Threshold",
                description: "Context fraction (0.10-0.99) that triggers background compaction.",
                kind: RpcConfigFieldKind::Number,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: Some((0.1, 0.99)),
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(0.8),
                read_fn: |c| {
                    // Round f32 to 4 decimals to avoid binary float artifacts like 0.80000001192.
                    let rounded = ((c.compaction.reactive_threshold as f64) * 10_000.0).round()
                        / 10_000.0;
                    json!(rounded)
                },
            },
            FieldSpec {
                key: "compaction.reactive_threshold_tokens",
                section: "compaction",
                field: "reactive_threshold_tokens",
                label: "Reactive Token Threshold",
                description: "Alternative token count trigger for compaction (0 disables).",
                kind: RpcConfigFieldKind::Integer,
                options: None,
                nullable: false,
                int_bounds: Some((0, 10_000_000)),
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(400_000),
                read_fn: |c| json!(c.compaction.reactive_threshold_tokens),
            },
            FieldSpec {
                key: "compaction.max_context_tokens",
                section: "compaction",
                field: "max_context_tokens",
                label: "Max Context Cap (Tokens)",
                description: "Optional hard cap on context window used for compaction triggers (0 = model default).",
                kind: RpcConfigFieldKind::Integer,
                options: None,
                nullable: false,
                int_bounds: Some((0, 10_000_000)),
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(0),
                read_fn: |c| json!(c.compaction.max_context_tokens),
            },
            // --- display ---
            FieldSpec {
                key: "display.emoji",
                section: "display",
                field: "emoji",
                label: "Terminal Emoji",
                description: "Render emoji in terminal-facing CLI and TUI output.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.display.emoji),
            },
            FieldSpec {
                key: "display.centered",
                section: "display",
                field: "centered",
                label: "Centered Layout",
                description: "Center transcript content in wide terminal viewports.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.display.centered),
            },
            FieldSpec {
                key: "display.reasoning_display",
                section: "display",
                field: "reasoning_display",
                label: "Reasoning Display",
                description: "How model thinking/reasoning traces appear in transcripts.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(REASONING_DISPLAY_OPTIONS),
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!("compact"),
                read_fn: |c| {
                    let val = match c.display.reasoning_display() {
                        super::ReasoningDisplayMode::Off => "off",
                        super::ReasoningDisplayMode::Compact => "compact",
                        super::ReasoningDisplayMode::Full => "full",
                        super::ReasoningDisplayMode::Current => "current",
                    };
                    json!(val)
                },
            },
            FieldSpec {
                key: "display.diff_mode",
                section: "display",
                field: "diff_mode",
                label: "Diff Display Mode",
                description: "How file edits are presented in chat transcripts.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(DIFF_MODE_OPTIONS),
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!("inline"),
                read_fn: |c| {
                    let val = match c.display.diff_mode {
                        super::DiffDisplayMode::Off => "off",
                        super::DiffDisplayMode::Inline => "inline",
                        super::DiffDisplayMode::FullInline => "full-inline",
                        super::DiffDisplayMode::File => "file",
                    };
                    json!(val)
                },
            },
            FieldSpec {
                key: "display.show_bash_output",
                section: "display",
                field: "show_bash_output",
                label: "Show Bash Output",
                description: "Show preview rows of Bash output beneath tool calls.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.display.show_bash_output),
            },
            FieldSpec {
                key: "display.tool_call_details",
                section: "display",
                field: "tool_call_details",
                label: "Tool Call Details",
                description: "Show technical command/path arguments alongside tool intents.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.display.tool_call_details),
            },
            FieldSpec {
                key: "display.compact_notifications",
                section: "display",
                field: "compact_notifications",
                label: "Compact Notifications",
                description: "Render swarm and file activity updates as single-line notices.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.display.compact_notifications),
            },
            FieldSpec {
                key: "display.pin_todos",
                section: "display",
                field: "pin_todos",
                label: "Pin Session Todos",
                description: "Pin active session todos at the top of the transcript while scrolling.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.display.pin_todos),
            },
            FieldSpec {
                key: "display.external_sessions",
                section: "display",
                field: "external_sessions",
                label: "Discover External Sessions",
                description: "Include sessions discovered from other coding agents in pickers.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.display.external_sessions),
            },
            // --- features ---
            FieldSpec {
                key: "features.memory",
                section: "features",
                field: "memory",
                label: "Memory Retrieval",
                description: "Enable automatic memory retrieval and extraction across sessions.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.features.memory),
            },
            FieldSpec {
                key: "features.swarm",
                section: "features",
                field: "swarm",
                label: "Swarm Coordination",
                description: "Enable multi-agent swarm spawning and coordination tools.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.features.swarm),
            },
            FieldSpec {
                key: "features.mermaid",
                section: "features",
                field: "mermaid",
                label: "Mermaid Diagrams",
                description: "Enable Mermaid diagram rendering and diagram guidance.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.features.mermaid),
            },
            FieldSpec {
                key: "features.auto_poke",
                section: "features",
                field: "auto_poke",
                label: "Auto-Poke Incomplete Todos",
                description: "Automatically follow up when the agent stops with unfinished todos.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.features.auto_poke),
            },
            FieldSpec {
                key: "features.kv_cache_miss_notices",
                section: "features",
                field: "kv_cache_miss_notices",
                label: "KV Cache Miss Notices",
                description: "Surface in-chat notices when prompt KV cache misses occur.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.features.kv_cache_miss_notices),
            },
            FieldSpec {
                key: "features.check_updates",
                section: "features",
                field: "check_updates",
                label: "Check for Updates",
                description: "Check for and install RayuCode updates during startup.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::RestartRequired,
                default_fn: || json!(true),
                read_fn: |c| json!(c.features.check_updates),
            },
            FieldSpec {
                key: "features.message_timestamps",
                section: "features",
                field: "message_timestamps",
                label: "Message Timestamps",
                description: "Include timestamps in user messages and tool results sent to models.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!(true),
                read_fn: |c| json!(c.features.message_timestamps),
            },
            FieldSpec {
                key: "features.update_channel",
                section: "features",
                field: "update_channel",
                label: "Update Channel",
                description: "Release channel for RayuCode CLI and daemon updates.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(UPDATE_CHANNEL_OPTIONS),
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::RestartRequired,
                default_fn: || json!("stable"),
                read_fn: |c| {
                    let val = match c.features.update_channel {
                        super::UpdateChannel::Stable => "stable",
                        super::UpdateChannel::Preview => "preview",
                        super::UpdateChannel::Main => "main",
                    };
                    json!(val)
                },
            },
            // --- safety (strictly non-secret fields only) ---
            FieldSpec {
                key: "safety.desktop_notifications",
                section: "safety",
                field: "desktop_notifications",
                label: "Safety Desktop Alerts",
                description: "Send desktop notifications for background safety/ambient alerts.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.safety.desktop_notifications),
            },
            FieldSpec {
                key: "safety.ntfy_server",
                section: "safety",
                field: "ntfy_server",
                label: "ntfy Server URL",
                description: "Server URL used for ntfy push alerts.",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!("https://ntfy.sh"),
                read_fn: |c| json!(c.safety.ntfy_server),
            },
            FieldSpec {
                key: "safety.email_enabled",
                section: "safety",
                field: "email_enabled",
                label: "Email Alerts",
                description: "Enable email delivery for ambient/safety notifications.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.safety.email_enabled),
            },
            FieldSpec {
                key: "safety.telegram_enabled",
                section: "safety",
                field: "telegram_enabled",
                label: "Telegram Alerts",
                description: "Enable Telegram bot notifications for ambient/safety alerts.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.safety.telegram_enabled),
            },
            FieldSpec {
                key: "safety.discord_enabled",
                section: "safety",
                field: "discord_enabled",
                label: "Discord Alerts",
                description: "Enable Discord bot notifications for ambient/safety alerts.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.safety.discord_enabled),
            },
            // --- agents ---
            FieldSpec {
                key: "agents.swarm_model",
                section: "agents",
                field: "swarm_model",
                label: "Default Worker Model",
                description: "Optional model override for spawned swarm workers (empty inherits coordinator).",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.agents
                        .swarm_model
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "agents.swarm_effort",
                section: "agents",
                field: "swarm_effort",
                label: "Worker Reasoning Effort",
                description: "Default reasoning effort for spawned swarm workers.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(EFFORT_OPTIONS_OPENAI),
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.agents
                        .swarm_effort
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            FieldSpec {
                key: "agents.swarm_model_autoselect",
                section: "agents",
                field: "swarm_model_autoselect",
                label: "Swarm Model Auto-Select",
                description: "Allow the coordinator to select worker models from the live catalog.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!(true),
                read_fn: |c| json!(c.agents.swarm_model_autoselect),
            },
            FieldSpec {
                key: "agents.swarm_max_concurrent_agents",
                section: "agents",
                field: "swarm_max_concurrent_agents",
                label: "Max Concurrent Swarm Agents",
                description: "Maximum simultaneous live worker agents per swarm (0 disables cap).",
                kind: RpcConfigFieldKind::Integer,
                options: None,
                nullable: false,
                int_bounds: Some((0, 256)),
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(32),
                read_fn: |c| json!(c.agents.swarm_max_concurrent_agents),
            },
            FieldSpec {
                key: "agents.swarm_spawn_mode",
                section: "agents",
                field: "swarm_spawn_mode",
                label: "Swarm Spawn Mode",
                description: "Default presentation mode for spawned swarm workers.",
                kind: RpcConfigFieldKind::Enum,
                options: Some(SWARM_SPAWN_MODE_OPTIONS),
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || json!("inline"),
                read_fn: |c| json!(c.agents.swarm_spawn_mode.as_str()),
            },
            FieldSpec {
                key: "agents.memory_model",
                section: "agents",
                field: "memory_model",
                label: "Memory Extraction Model",
                description: "Optional model override used for background memory extraction.",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.agents
                        .memory_model
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            // --- autoreview ---
            FieldSpec {
                key: "autoreview.enabled",
                section: "autoreview",
                field: "enabled",
                label: "Auto-Review Enabled",
                description: "Enable automatic end-of-turn code review for sessions by default.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.autoreview.enabled),
            },
            FieldSpec {
                key: "autoreview.model",
                section: "autoreview",
                field: "model",
                label: "Auto-Review Model",
                description: "Optional model override for auto-review sessions.",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.autoreview
                        .model
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            // --- autojudge ---
            FieldSpec {
                key: "autojudge.enabled",
                section: "autojudge",
                field: "enabled",
                label: "Auto-Judge Enabled",
                description: "Enable automatic end-of-turn execution judging by default.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.autojudge.enabled),
            },
            FieldSpec {
                key: "autojudge.model",
                section: "autojudge",
                field: "model",
                label: "Auto-Judge Model",
                description: "Optional model override for auto-judge sessions.",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: true,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::NextTurn,
                default_fn: || Value::Null,
                read_fn: |c| {
                    c.autojudge
                        .model
                        .as_deref()
                        .map(|v| Value::String(v.to_string()))
                        .unwrap_or(Value::Null)
                },
            },
            // --- notifications ---
            FieldSpec {
                key: "notifications.turn_complete",
                section: "notifications",
                field: "turn_complete",
                label: "Turn Completion Notifications",
                description: "Send a desktop notification when a long agent turn finishes.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.notifications.turn_complete),
            },
            FieldSpec {
                key: "notifications.turn_complete_min_secs",
                section: "notifications",
                field: "turn_complete_min_secs",
                label: "Min Turn Duration (s)",
                description: "Minimum turn duration in seconds before notifying.",
                kind: RpcConfigFieldKind::Integer,
                options: None,
                nullable: false,
                int_bounds: Some((0, 86_400)),
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(120),
                read_fn: |c| json!(c.notifications.turn_complete_min_secs),
            },
            FieldSpec {
                key: "notifications.turn_complete_todo_min_secs",
                section: "notifications",
                field: "turn_complete_todo_min_secs",
                label: "Min Todo Turn Duration (s)",
                description: "Minimum turn duration in seconds before notifying when todos exist.",
                kind: RpcConfigFieldKind::Integer,
                options: None,
                nullable: false,
                int_bounds: Some((0, 86_400)),
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(30),
                read_fn: |c| json!(c.notifications.turn_complete_todo_min_secs),
            },
            FieldSpec {
                key: "notifications.turn_complete_only_when_unfocused",
                section: "notifications",
                field: "turn_complete_only_when_unfocused",
                label: "Notify Only When Unfocused",
                description: "Suppress turn completion alerts while the client window is focused.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(true),
                read_fn: |c| json!(c.notifications.turn_complete_only_when_unfocused),
            },
            FieldSpec {
                key: "notifications.turn_complete_sound",
                section: "notifications",
                field: "turn_complete_sound",
                label: "Notification Sound",
                description: "macOS Notification Center sound name (empty string mutes sound).",
                kind: RpcConfigFieldKind::String,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!("Glass"),
                read_fn: |c| json!(c.notifications.turn_complete_sound),
            },
            // --- ambient ---
            FieldSpec {
                key: "ambient.enabled",
                section: "ambient",
                field: "enabled",
                label: "Ambient Mode Enabled",
                description: "Run background ambient cycles and scheduled tasks automatically.",
                kind: RpcConfigFieldKind::Boolean,
                options: None,
                nullable: false,
                int_bounds: None,
                float_bounds: None,
                apply_mode: RpcConfigApplyMode::Immediate,
                default_fn: || json!(false),
                read_fn: |c| json!(c.ambient.enabled),
            },
        ]
    })
}

fn spec_for_key(key: &str) -> Option<&'static FieldSpec> {
    field_specs().iter().find(|spec| spec.key == key)
}

fn is_secret_key_name(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.contains("api_key")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
}

fn config_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn resolve_sections(sections: Option<&[String]>) -> Result<Vec<String>> {
    match sections {
        None => Ok(CURATED_CONFIG_SECTIONS
            .iter()
            .map(|s| (*s).to_string())
            .collect()),
        Some(requested) => {
            if requested.is_empty() {
                return Ok(CURATED_CONFIG_SECTIONS
                    .iter()
                    .map(|s| (*s).to_string())
                    .collect());
            }
            let mut out = Vec::new();
            let mut seen = BTreeSet::new();
            for raw in requested {
                let sec = raw.trim();
                if !CURATED_CONFIG_SECTIONS.contains(&sec) {
                    bail!(
                        "unsupported config section `{sec}`; allowed sections: {}",
                        CURATED_CONFIG_SECTIONS.join(", ")
                    );
                }
                if seen.insert(sec.to_string()) {
                    out.push(sec.to_string());
                }
            }
            Ok(out)
        }
    }
}

fn build_snapshot(cfg: &Config, path: String, sections: Vec<String>) -> ConfigSnapshot {
    let mut values = Map::new();
    let mut schema = Vec::new();
    for spec in field_specs() {
        if !sections.iter().any(|s| s == spec.section) {
            continue;
        }
        values.insert(spec.key.to_string(), (spec.read_fn)(cfg));
        let apply_mode = if change_report::liveness_for_key(spec.key)
            == change_report::Liveness::NeedsRestart
        {
            RpcConfigApplyMode::RestartRequired
        } else {
            spec.apply_mode
        };
        schema.push(ConfigFieldDescriptor {
            key: spec.key.to_string(),
            section: spec.section.to_string(),
            label: spec.label.to_string(),
            description: spec.description.to_string(),
            kind: spec.kind,
            options: spec.options.map(|opts| {
                opts.iter()
                    .map(|(value, label)| RpcConfigEnumOption {
                        value: (*value).to_string(),
                        label: (*label).to_string(),
                    })
                    .collect()
            }),
            default_value: (spec.default_fn)(),
            apply_mode,
        });
    }
    ConfigSnapshot {
        path,
        sections,
        values,
        schema,
    }
}

/// Read the curated, strictly non-secret configuration snapshot from `Config::path()`.
pub fn read_curated_config(sections: Option<&[String]>) -> Result<ConfigSnapshot> {
    let sections = resolve_sections(sections)?;
    let path = Config::path()
        .ok_or_else(|| anyhow::anyhow!("could not resolve Rayu config path"))?
        .display()
        .to_string();
    let cfg = Config::load();
    Ok(build_snapshot(&cfg, path, sections))
}

enum ValidatedTomlPatch {
    Remove,
    Set(toml_edit::Value),
}

fn validate_field_value(spec: &FieldSpec, value: &Value) -> Result<ValidatedTomlPatch> {
    if value.is_null() {
        if spec.nullable {
            return Ok(ValidatedTomlPatch::Remove);
        }
        bail!("config key `{}` cannot be null", spec.key);
    }

    match spec.kind {
        RpcConfigFieldKind::Boolean => {
            let Some(b) = value.as_bool() else {
                bail!("config key `{}` expects a boolean", spec.key);
            };
            Ok(ValidatedTomlPatch::Set(toml_edit::Value::from(b)))
        }
        RpcConfigFieldKind::String => {
            let Some(s) = value.as_str() else {
                bail!("config key `{}` expects a string", spec.key);
            };
            if spec.nullable && s.trim().is_empty() {
                return Ok(ValidatedTomlPatch::Remove);
            }
            Ok(ValidatedTomlPatch::Set(toml_edit::Value::from(s)))
        }
        RpcConfigFieldKind::Integer => {
            let Some(i) = value.as_i64() else {
                bail!("config key `{}` expects an integer", spec.key);
            };
            if let Some((min, max)) = spec.int_bounds
                && (i < min || i > max)
            {
                bail!(
                    "config key `{}` value {i} is out of allowed range {min}..={max}",
                    spec.key
                );
            }
            Ok(ValidatedTomlPatch::Set(toml_edit::Value::from(i)))
        }
        RpcConfigFieldKind::Number => {
            let Some(f) = value.as_f64().filter(|n| n.is_finite()) else {
                bail!("config key `{}` expects a finite number", spec.key);
            };
            if let Some((min, max)) = spec.float_bounds
                && (f < min || f > max)
            {
                bail!(
                    "config key `{}` value {f} is out of allowed range {min}..={max}",
                    spec.key
                );
            }
            Ok(ValidatedTomlPatch::Set(toml_edit::Value::from(f)))
        }
        RpcConfigFieldKind::Enum => {
            let Some(s) = value.as_str() else {
                bail!("config key `{}` expects an enum string", spec.key);
            };
            let trimmed = s.trim();
            if spec.nullable && trimmed.is_empty() {
                return Ok(ValidatedTomlPatch::Remove);
            }
            let allowed = spec.options.unwrap_or(&[]);
            if !allowed.iter().any(|(val, _)| *val == trimmed) {
                let choices: Vec<&str> = allowed.iter().map(|(v, _)| *v).collect();
                bail!(
                    "config key `{}` received invalid value `{trimmed}`; expected one of: {}",
                    spec.key,
                    choices.join(", ")
                );
            }
            Ok(ValidatedTomlPatch::Set(toml_edit::Value::from(trimmed)))
        }
        RpcConfigFieldKind::StringArray => {
            let Some(arr) = value.as_array() else {
                bail!("config key `{}` expects an array of strings", spec.key);
            };
            let mut toml_arr = toml_edit::Array::new();
            for item in arr {
                let Some(s) = item.as_str() else {
                    bail!("config key `{}` array elements must be strings", spec.key);
                };
                toml_arr.push(s);
            }
            Ok(ValidatedTomlPatch::Set(toml_edit::Value::Array(toml_arr)))
        }
    }
}

/// Validate and atomically patch curated fields in `Config::path()` (`~/.rayu/config.toml`),
/// preserving user comments and untouched tables via `toml_edit`.
pub fn patch_curated_config(patch: &Map<String, Value>) -> Result<ConfigPatchOutcome> {
    if patch.is_empty() {
        bail!("patch must contain at least one config key");
    }

    // Phase 1: Validate every key & value strictly BEFORE touching disk.
    let mut validated: Vec<(&'static FieldSpec, ValidatedTomlPatch)> =
        Vec::with_capacity(patch.len());
    for (key, value) in patch {
        if is_secret_key_name(key) {
            bail!(
                "config key `{key}` is restricted and cannot be read or modified via config RPC"
            );
        }
        let Some(spec) = spec_for_key(key) else {
            bail!("unknown or unsupported config key `{key}`");
        };
        let toml_patch = validate_field_value(spec, value)?;
        validated.push((spec, toml_patch));
    }

    let _lock = config_write_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let path =
        Config::path().ok_or_else(|| anyhow::anyhow!("could not resolve Rayu config path"))?;
    let existing = if path.exists() {
        std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?
    } else {
        String::new()
    };

    let before_cfg = Config::load();
    let mut doc = existing
        .parse::<toml_edit::Document>()
        .with_context(|| format!("failed to parse existing {} with toml_edit", path.display()))?;

    // Phase 2: Mutate only the patched keys while preserving comments & formatting.
    for (spec, toml_patch) in &validated {
        match toml_patch {
            ValidatedTomlPatch::Remove => {
                if let Some(table) = doc.get_mut(spec.section).and_then(|item| item.as_table_mut())
                {
                    table.remove(spec.field);
                }
            }
            ValidatedTomlPatch::Set(new_val) => {
                if !doc.contains_key(spec.section) {
                    let mut table = toml_edit::Table::new();
                    table.set_implicit(false);
                    doc[spec.section] = toml_edit::Item::Table(table);
                }
                let table = doc[spec.section].as_table_mut().ok_or_else(|| {
                    anyhow::anyhow!(
                        "config section `[{}]` is not a TOML table",
                        spec.section
                    )
                })?;
                if let Some(existing_val) =
                    table.get_mut(spec.field).and_then(|item| item.as_value_mut())
                {
                    let decor = existing_val.decor().clone();
                    let mut replacement = new_val.clone();
                    *replacement.decor_mut() = decor;
                    *existing_val = replacement;
                } else {
                    table[spec.field] = toml_edit::Item::Value(new_val.clone());
                }
                // Keep `display.show_thinking` in sync when `display.reasoning_display` changes,
                // mirroring `DisplayConfig::set_reasoning_display`.
                if spec.key == "display.reasoning_display"
                    && let Some(mode_str) = new_val.as_str()
                {
                    let show_thinking = mode_str != "off";
                    if let Some(existing_st) = table
                        .get_mut("show_thinking")
                        .and_then(|item| item.as_value_mut())
                    {
                        let decor = existing_st.decor().clone();
                        let mut replacement = toml_edit::Value::from(show_thinking);
                        *replacement.decor_mut() = decor;
                        *existing_st = replacement;
                    }
                }
            }
        }
    }

    let rendered = doc.to_string();

    // Phase 3: Verify the resulting TOML parses cleanly into `Config` before writing.
    let parsed_after: Config = toml::from_str(&rendered)
        .with_context(|| "patched config.toml failed Config deserialization check")?;

    // Phase 4: Atomic write (sibling temp file + rename).
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config directory {}", parent.display()))?;
    }
    static TMP_SEQ: AtomicU64 = AtomicU64::new(1);
    let tmp_name = format!(
        ".config.toml.tmp.{}.{}",
        std::process::id(),
        TMP_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let tmp_path = path
        .parent()
        .map(|p| p.join(&tmp_name))
        .unwrap_or_else(|| std::path::PathBuf::from(&tmp_name));

    if let Err(err) = std::fs::write(&tmp_path, &rendered) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err)
            .with_context(|| format!("failed to write temp config {}", tmp_path.display()));
    }
    if let Err(err) = std::fs::rename(&tmp_path, &path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err).with_context(|| {
            format!(
                "failed to atomically replace {} with {}",
                path.display(),
                tmp_path.display()
            )
        });
    }

    // Phase 5: Reload in-process config cache immediately.
    Config::invalidate_cache();
    let reloaded = super::config();

    // Compute exact changed keys and restart requirement across patched keys.
    let mut changed_keys = Vec::new();
    let mut requires_restart = false;
    for (spec, _) in &validated {
        let old_val = (spec.read_fn)(&before_cfg);
        let new_val = (spec.read_fn)(&parsed_after);
        if old_val != new_val {
            changed_keys.push(spec.key.to_string());
            if spec.apply_mode == RpcConfigApplyMode::RestartRequired
                || change_report::liveness_for_key(spec.key)
                    == change_report::Liveness::NeedsRestart
            {
                requires_restart = true;
            }
        }
    }

    let all_sections: Vec<String> = CURATED_CONFIG_SECTIONS
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    let snapshot = build_snapshot(reloaded, path.display().to_string(), all_sections);

    Ok(ConfigPatchOutcome {
        snapshot,
        changed_keys,
        requires_restart,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::lock_test_env;
    use tempfile::tempdir;

    struct RayuHomeReset(Option<std::ffi::OsString>);
    impl Drop for RayuHomeReset {
        fn drop(&mut self) {
            match self.0.take() {
                Some(v) => unsafe { std::env::set_var("RAYU_HOME", v) },
                None => unsafe { std::env::remove_var("RAYU_HOME") },
            }
            Config::invalidate_cache();
        }
    }

    #[test]
    fn patch_preserves_comments_and_rejects_invalid_keys_without_touching_disk() {
        let _guard = lock_test_env();
        let home = tempdir().unwrap();
        let _reset = RayuHomeReset(std::env::var_os("RAYU_HOME"));
        unsafe {
            std::env::set_var("RAYU_HOME", home.path());
        }
        Config::invalidate_cache();

        let config_path = home.path().join("config.toml");
        let initial = "# User custom header\n[display]\nemoji = true # keep comment\n\n[providers.my-gw]\ntype = \"openai-compatible\"\nbase_url = \"https://example.test/v1\"\napi_key = \"sk-secret-must-not-leak\"\n\n[safety]\ntelegram_bot_token = \"tg-secret-token\"\nemail_password = \"smtp-secret-pass\"\n";
        std::fs::write(&config_path, initial).unwrap();
        Config::invalidate_cache();

        let snap = read_curated_config(None).unwrap();
        assert_eq!(snap.sections.len(), CURATED_CONFIG_SECTIONS.len());
        assert!(snap.values.contains_key("ambient.enabled"));
        let serialized = serde_json::to_string(&snap.values).unwrap();
        assert!(!serialized.contains("sk-secret-must-not-leak"));
        assert!(!serialized.contains("tg-secret-token"));
        assert!(!serialized.contains("smtp-secret-pass"));
        assert_eq!(snap.values.get("display.emoji"), Some(&json!(true)));

        // Secret/unknown keys must fail without editing disk
        let mut bad_secret = Map::new();
        bad_secret.insert("provider.api_key".into(), json!("hacked"));
        assert!(patch_curated_config(&bad_secret).is_err());
        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), initial);

        let mut bad_type = Map::new();
        bad_type.insert("display.emoji".into(), json!("not-a-bool"));
        assert!(patch_curated_config(&bad_type).is_err());
        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), initial);

        let mut bad_enum = Map::new();
        bad_enum.insert("compaction.mode".into(), json!("bogus_mode"));
        assert!(patch_curated_config(&bad_enum).is_err());
        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), initial);

        // Valid patch preserves comments and untouched sections while updating only target field
        let mut good = Map::new();
        good.insert("display.emoji".into(), json!(false));
        good.insert("compaction.mode".into(), json!("proactive"));
        let outcome = patch_curated_config(&good).unwrap();
        assert_eq!(
            outcome.changed_keys,
            vec!["compaction.mode".to_string(), "display.emoji".to_string()]
        );
        assert!(!outcome.requires_restart);
        assert_eq!(
            outcome.snapshot.values.get("display.emoji"),
            Some(&json!(false))
        );
        assert_eq!(
            outcome.snapshot.values.get("compaction.mode"),
            Some(&json!("proactive"))
        );

        let updated = std::fs::read_to_string(&config_path).unwrap();
        assert!(updated.contains("# User custom header"));
        assert!(updated.contains("emoji = false # keep comment"));
        assert!(updated.contains("[providers.my-gw]"));
        assert!(updated.contains("sk-secret-must-not-leak"));

        // Verify in-process config cache sees the update immediately
        assert!(!crate::config::config().display.emoji);
        assert_eq!(
            crate::config::config().compaction.mode,
            super::super::CompactionMode::Proactive
        );
    }

    #[test]
    fn patch_tracks_restart_required_and_supports_creating_missing_file() {
        let _guard = lock_test_env();
        let home = tempdir().unwrap();
        let _reset = RayuHomeReset(std::env::var_os("RAYU_HOME"));
        unsafe {
            std::env::set_var("RAYU_HOME", home.path());
        }
        Config::invalidate_cache();

        let config_path = home.path().join("config.toml");
        assert!(!config_path.exists());

        let mut patch = Map::new();
        patch.insert("features.check_updates".into(), json!(false));
        patch.insert("provider.default_model".into(), json!("claude-sonnet-4-6"));
        let outcome = patch_curated_config(&patch).unwrap();
        assert!(config_path.exists());
        assert!(outcome.requires_restart);
        assert!(outcome.changed_keys.contains(&"features.check_updates".to_string()));
        assert!(outcome.changed_keys.contains(&"provider.default_model".to_string()));
        assert_eq!(
            outcome.snapshot.values.get("provider.default_model"),
            Some(&json!("claude-sonnet-4-6"))
        );

        // Clearing nullable string field removes it cleanly
        let mut clear = Map::new();
        clear.insert("provider.default_model".into(), Value::Null);
        let cleared = patch_curated_config(&clear).unwrap();
        assert_eq!(
            cleared.snapshot.values.get("provider.default_model"),
            Some(&Value::Null)
        );
        assert_eq!(cleared.changed_keys, vec!["provider.default_model".to_string()]);
        assert!(!cleared.requires_restart);
    }

    #[test]
    fn read_curated_config_filters_sections_and_rejects_unknown_sections() {
        let _guard = lock_test_env();
        let home = tempdir().unwrap();
        let _reset = RayuHomeReset(std::env::var_os("RAYU_HOME"));
        unsafe {
            std::env::set_var("RAYU_HOME", home.path());
        }
        Config::invalidate_cache();

        let snap = read_curated_config(Some(&["display".into(), "compaction".into()])).unwrap();
        assert_eq!(snap.sections, vec!["display", "compaction"]);
        assert!(snap.schema.iter().all(|f| f.section == "display" || f.section == "compaction"));
        assert!(snap.values.keys().all(|k| k.starts_with("display.") || k.starts_with("compaction.")));

        assert!(read_curated_config(Some(&["providers".into()])).is_err());
        assert!(read_curated_config(Some(&["auth".into()])).is_err());
    }
}
