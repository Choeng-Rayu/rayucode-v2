use super::*;

/// Advertise the worker `profile` and `model` spawn parameters according to
/// the user's policy. `profile` is always a plain string so the schema stays
/// stable for prompt caching while profiles change. `list_models` shows the
/// live global + session profiles. `model` is an exact enum under a strict
/// allowlist, a free route string when autoselect is on (the default), and
/// hidden when both are off.
pub(super) fn apply_swarm_model_policy(schema: &mut Value, agents: &crate::config::AgentsConfig) {
    let Some(properties) = schema["properties"].as_object_mut() else {
        crate::logging::error(
            "Cannot apply swarm model policy: schema properties are not an object",
        );
        return;
    };
    properties.insert(
        "profile".to_string(),
        json!({
            "type": "string",
            "description": "User agent profile for the worker (see list_models). Preferred over model."
        }),
    );
    if agents.strict_swarm_model_allowlist() {
        properties.insert(
            "model".to_string(),
            json!({
                "type": "string",
                "enum": agents.swarm_model_allowlist,
                "description": "Exact user-allowlisted route; omit for profile or default."
            }),
        );
    } else if agents.swarm_model_autoselect {
        properties.insert(
            "model".to_string(),
            json!({
                "type": "string",
                "description": "Worker model route from list_models, chosen per task; omit for profile or default."
            }),
        );
    } else {
        properties.remove("model");
    }
}

/// Short catalog of the effective profiles, appended to `list_models`.
pub(super) fn format_profile_catalog(profiles: &[crate::config::AgentProfile]) -> String {
    if profiles.is_empty() {
        return "No agent profiles configured. Pick a model per task, or ask the user to add profiles with /agents profile add <name> <model> <when to use>.\n\n".to_string();
    }
    let mut out = String::from("Agent profiles (pass `profile`, preferred):\n");
    for profile in profiles {
        out.push_str(&format!("- {}: {}", profile.name, profile.model));
        if let Some(effort) = profile.effort.as_deref() {
            out.push_str(&format!(" effort={effort}"));
        }
        if !profile.description.is_empty() {
            out.push_str(&format!(" - {}", profile.description));
        }
        out.push('\n');
    }
    out.push('\n');
    out
}
