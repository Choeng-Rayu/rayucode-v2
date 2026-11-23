//! Runtime-backed commands, shared by all non-terminal clients.
use serde::{Deserialize, Serialize};

/// Commands executed by the attached runtime, never submitted as an agent prompt.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommand {
    Skills,
    Context,
    Info,
    Cache,
    Memory,
    Swarm,
    Agents,
    SubagentModel,
    Autoreview,
    Autojudge,
    Transport,
    Fast,
    Telemetry,
    Subscription,
    Overnight,
    Productivity,
    Initiatives,
    Premium,
    ProviderTestCoverage,
    RefreshModelList,
    Continue,
    ResumeAll,
    Remote,
    ServerReload,
    Review,
    Judge,
    Subagent,
    Auth,
    Logout,
    Background,
    Mcp,
    Telegram,
    Features,
    Doctor,
    SessionSearch,
    Schedules,
    Ambient,
}

impl RuntimeCommand {
    pub const ALL: &'static [Self] = &[
        Self::Skills,
        Self::Context,
        Self::Info,
        Self::Cache,
        Self::Memory,
        Self::Swarm,
        Self::Agents,
        Self::SubagentModel,
        Self::Autoreview,
        Self::Autojudge,
        Self::Transport,
        Self::Fast,
        Self::Telemetry,
        Self::Subscription,
        Self::Overnight,
        Self::Productivity,
        Self::Initiatives,
        Self::Premium,
        Self::ProviderTestCoverage,
        Self::RefreshModelList,
        Self::Continue,
        Self::ResumeAll,
        Self::Remote,
        Self::ServerReload,
        Self::Review,
        Self::Judge,
        Self::Subagent,
        Self::Auth,
        Self::Logout,
        Self::Background,
        Self::Mcp,
        Self::Telegram,
        Self::Features,
        Self::Doctor,
        Self::SessionSearch,
        Self::Schedules,
        Self::Ambient,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Skills => "skills",
            Self::Context => "context",
            Self::Info => "info",
            Self::Cache => "cache",
            Self::Memory => "memory",
            Self::Swarm => "swarm",
            Self::Agents => "agents",
            Self::SubagentModel => "subagent_model",
            Self::Autoreview => "autoreview",
            Self::Autojudge => "autojudge",
            Self::Transport => "transport",
            Self::Fast => "fast",
            Self::Telemetry => "telemetry",
            Self::Subscription => "subscription",
            Self::Overnight => "overnight",
            Self::Productivity => "productivity",
            Self::Initiatives => "initiatives",
            Self::Premium => "premium",
            Self::ProviderTestCoverage => "provider_test_coverage",
            Self::RefreshModelList => "refresh_model_list",
            Self::Continue => "continue",
            Self::ResumeAll => "resume_all",
            Self::Remote => "remote",
            Self::ServerReload => "server_reload",
            Self::Review => "review",
            Self::Judge => "judge",
            Self::Subagent => "subagent",
            Self::Auth => "auth",
            Self::Logout => "logout",
            Self::Background => "background",
            Self::Mcp => "mcp",
            Self::Telegram => "telegram",
            Self::Features => "features",
            Self::Doctor => "doctor",
            Self::SessionSearch => "session_search",
            Self::Schedules => "schedules",
            Self::Ambient => "ambient",
        }
    }
}

impl std::fmt::Display for RuntimeCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for RuntimeCommand {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let normalized = s.trim();
        Self::ALL
            .iter()
            .copied()
            .find(|cmd| cmd.as_str() == normalized)
            .ok_or_else(|| format!("unknown runtime command: {normalized}"))
    }
}

/// Structured runtime data plus a human-readable rendering. Data is command
/// specific and additive. Clients must ignore unknown fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeCommandOutput {
    pub session_id: String,
    pub command: RuntimeCommand,
    pub data: serde_json::Value,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_command_all_matches_serde_and_from_str() {
        for &cmd in RuntimeCommand::ALL {
            let as_str = cmd.as_str();
            let serialized = serde_json::to_value(cmd).unwrap();
            assert_eq!(serialized, serde_json::Value::String(as_str.to_string()));
            let deserialized: RuntimeCommand = serde_json::from_value(serialized).unwrap();
            assert_eq!(deserialized, cmd);
            let parsed: RuntimeCommand = as_str.parse().unwrap();
            assert_eq!(parsed, cmd);
            assert_eq!(cmd.to_string(), as_str);
        }
        assert!("nonexistent_command".parse::<RuntimeCommand>().is_err());
    }
}
