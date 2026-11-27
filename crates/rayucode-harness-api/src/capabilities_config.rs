use serde::{Deserialize, Serialize};

pub const CAPABILITIES_CAPABILITY: &str = "capabilities_v1";
pub const CONFIG_CAPABILITY: &str = "config_v1";
pub const FRAME_FIDELITY_CAPABILITY: &str = "frame_fidelity_v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandCategory {
    Session,
    Model,
    Quality,
    Tools,
    Runtime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandDispatch {
    ApiRequest { req: String },
    RuntimeCommand { command: String },
    Skill { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandDescriptor {
    pub name: String,
    pub description: String,
    pub category: CommandCategory,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arg_hint: Option<String>,
    #[serde(default)]
    pub requires_session: bool,
    pub dispatch: CommandDispatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionModeDescriptor {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FeatureFlagDescriptor {
    pub key: String,
    pub enabled: bool,
    pub description: String,
    #[serde(default)]
    pub requires_restart: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFieldKind {
    Boolean,
    String,
    Integer,
    Number,
    Enum,
    StringArray,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigApplyMode {
    Immediate,
    NextTurn,
    RestartRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigEnumOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigFieldSchema {
    pub key: String,
    pub section: String,
    pub label: String,
    pub description: String,
    pub kind: ConfigFieldKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<ConfigEnumOption>>,
    pub default_value: serde_json::Value,
    pub apply_mode: ConfigApplyMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageOrigin {
    UserTyped,
    EngineInternal,
    LegacyUnknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageVisibility {
    Visible,
    Hidden,
}
