//! ACP model, reasoning effort, and permission mode configuration presentation.

use super::*;
use crate::protocol::PermissionMode;

pub(super) const CONFIG_ID_MODEL: &str = "model";
pub(super) const CONFIG_ID_EFFORT: &str = "reasoning_effort";
pub(super) const CONFIG_ID_MODE: &str = "mode";

struct AcpModeSpec {
    mode: PermissionMode,
    id: &'static str,
    name: &'static str,
    description: &'static str,
}

const ACP_MODES: &[AcpModeSpec] = &[
    AcpModeSpec {
        mode: PermissionMode::Default,
        id: "default",
        name: "Default",
        description: "Ask permission before editing files or running shell commands",
    },
    AcpModeSpec {
        mode: PermissionMode::AcceptEdits,
        id: "accept_edits",
        name: "Accept Edits",
        description: "Auto-approve file edits; ask before running shell commands",
    },
    AcpModeSpec {
        mode: PermissionMode::Plan,
        id: "plan",
        name: "Plan",
        description: "Read-only planning mode without editing files or running commands",
    },
    AcpModeSpec {
        mode: PermissionMode::FullManage,
        id: "full_manage",
        name: "Full Access",
        description: "Auto-approve all file edits and shell commands",
    },
    AcpModeSpec {
        mode: PermissionMode::Orchestrator,
        id: "orchestrator",
        name: "Orchestrator",
        description: "Coordinate and plan without direct file edits or shell commands",
    },
];

pub(super) fn acp_mode_id(mode: PermissionMode) -> &'static str {
    ACP_MODES
        .iter()
        .find(|spec| spec.mode == mode)
        .map(|spec| spec.id)
        .unwrap_or("default")
}

/// Parse an ACP mode identifier into a daemon [`PermissionMode`].
///
/// Accepts canonical Rayu mode IDs as well as common IDE / ACP host aliases
/// (`acceptEdits`, `ask`, `code`, `architect`, `bypassPermissions`, `fullManage`).
pub(super) fn parse_acp_mode(value: &str) -> Option<PermissionMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "default" | "ask" => Some(PermissionMode::Default),
        "accept_edits" | "acceptedits" | "accept-edits" | "code" => {
            Some(PermissionMode::AcceptEdits)
        }
        "plan" | "architect" | "readonly" | "read_only" | "read-only" => Some(PermissionMode::Plan),
        "full_manage" | "fullmanage" | "full-manage" | "full_access" | "full-access"
        | "bypasspermissions" | "bypass_permissions" | "bypass-permissions" | "auto" => {
            Some(PermissionMode::FullManage)
        }
        "orchestrator" => Some(PermissionMode::Orchestrator),
        _ => None,
    }
}

pub(super) fn acp_available_commands() -> Vec<Value> {
    vec![
        json!({
            "name": "model",
            "description": "Switch the model for this session, or show the current model",
            "input": { "hint": "model id (optional)" },
        }),
        json!({
            "name": "models",
            "description": "List models available from the active provider",
        }),
        json!({
            "name": "effort",
            "description": "Set reasoning effort, or show the current effort",
            "input": { "hint": "none|minimal|low|medium|high|xhigh|max (optional)" },
        }),
        json!({
            "name": "mode",
            "description": "Switch the permission mode for this session, or show the current mode",
            "input": { "hint": "default|accept_edits|plan|full_manage|orchestrator (optional)" },
        }),
    ]
}

pub(super) fn insert_session_configuration(result: &mut Value, state: &SessionUiState) {
    let Some(object) = result.as_object_mut() else {
        return;
    };
    let config_options = session_config_options(state);
    if !config_options.is_empty() {
        object.insert("configOptions".to_string(), Value::Array(config_options));
    }
    if let Some(models) = session_models(state) {
        object.insert("models".to_string(), models);
    }
    if let Some(modes) = session_modes(state) {
        object.insert("modes".to_string(), modes);
    }
}

pub(super) fn session_modes(state: &SessionUiState) -> Option<Value> {
    let current = state.permission_mode?;
    let available_modes: Vec<Value> = ACP_MODES
        .iter()
        .map(|spec| {
            json!({
                "id": spec.id,
                "name": spec.name,
                "description": spec.description,
            })
        })
        .collect();
    Some(json!({
        "currentModeId": acp_mode_id(current),
        "availableModes": available_modes,
    }))
}

pub(super) fn session_models(state: &SessionUiState) -> Option<Value> {
    let current = state.model.as_deref()?;
    let mut models = state.available_models.clone();
    if !models.iter().any(|candidate| candidate == current) {
        models.insert(0, current.to_string());
    }
    Some(json!({
        "availableModels": models
            .into_iter()
            .map(|model| json!({ "modelId": model, "name": model }))
            .collect::<Vec<_>>(),
        "currentModelId": current,
    }))
}

pub(super) fn available_efforts(state: &SessionUiState) -> Vec<&'static str> {
    crate::provider::inferred_reasoning_efforts(
        state.provider_name.as_deref(),
        state.model.as_deref(),
    )
    .into_iter()
    // `swarm` is a TUI sentinel, not provider effort levels.
    .filter(|effort| !effort.starts_with("swarm"))
    .collect()
}

/// Build the ACP `configOptions` array (model selector, reasoning effort, and
/// permission mode) from the current session state. Empty when the session has
/// no model or mode state configured.
pub(super) fn session_config_options(state: &SessionUiState) -> Vec<Value> {
    let mut options = Vec::new();

    if let Some(model) = state.model.as_deref() {
        let mut models = state.available_models.clone();
        if !models.iter().any(|candidate| candidate == model) {
            models.insert(0, model.to_string());
        }
        let select_options: Vec<Value> = models
            .iter()
            .map(|name| json!({ "value": name, "name": name }))
            .collect();
        options.push(json!({
            "type": "select",
            "id": CONFIG_ID_MODEL,
            "name": "Model",
            "category": "model",
            "currentValue": model,
            "options": select_options,
        }));
    }

    let efforts = available_efforts(state);
    if !efforts.is_empty() {
        let current = state
            .reasoning_effort
            .as_deref()
            .filter(|effort| efforts.contains(effort))
            .unwrap_or_else(|| {
                if efforts.contains(&"medium") {
                    "medium"
                } else {
                    efforts[0]
                }
            });
        let select_options: Vec<Value> = efforts
            .iter()
            .map(|name| json!({ "value": name, "name": name }))
            .collect();
        options.push(json!({
            "type": "select",
            "id": CONFIG_ID_EFFORT,
            "name": "Reasoning effort",
            "category": "thought_level",
            "currentValue": current,
            "options": select_options,
        }));
    }

    if let Some(mode) = state.permission_mode {
        let select_options: Vec<Value> = ACP_MODES
            .iter()
            .map(|spec| {
                json!({
                    "value": spec.id,
                    "name": spec.name,
                    "description": spec.description,
                })
            })
            .collect();
        options.push(json!({
            "type": "select",
            "id": CONFIG_ID_MODE,
            "name": "Mode",
            "category": "mode",
            "currentValue": acp_mode_id(mode),
            "options": select_options,
        }));
    }

    options
}
