//! Shared reasoning-effort ladders.
//!
//! Keep these in provider-core so provider runtimes and UI clients expose the
//! same ordered values. `swarm` is a RayuCode UI sentinel rather than a
//! wire-level provider value, but it belongs in the selectable ladder.

/// OpenAI Responses API effort levels, followed by RayuCode's swarm mode.
pub const OPENAI_SELECTABLE_EFFORTS: &[&str] = &[
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "swarm",
];

/// OpenRouter's unified reasoning effort levels.
///
/// OpenRouter currently treats `max` as an alias for `xhigh`, so it is not a
/// separate rung in this ladder.
pub const OPENROUTER_SELECTABLE_EFFORTS: &[&str] =
    &["none", "minimal", "low", "medium", "high", "xhigh", "swarm"];

/// Direct DeepSeek effort levels, followed by RayuCode's swarm mode.
pub const DEEPSEEK_SELECTABLE_EFFORTS: &[&str] = &["none", "low", "medium", "high", "max", "swarm"];

/// Rayu hosted gateway effort levels (translated per upstream model family by the gateway).
pub const RAYU_SELECTABLE_EFFORTS: &[&str] = &[
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "swarm",
];

/// Convert a provider-advertised OpenAI/OpenRouter effort into the canonical
/// static value used by the provider trait.
pub fn canonical_reasoning_effort(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "none" => Some("none"),
        "minimal" => Some("minimal"),
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "xhigh" => Some("xhigh"),
        "max" => Some("max"),
        _ => None,
    }
}

fn is_non_effort_provider(provider: &str) -> bool {
    provider.contains("cursor")
        || provider.contains("antigravity")
        || provider.contains("gemini")
        || provider.contains("grok")
        || provider.contains("bedrock")
}

fn openai_inferred_efforts(model: &str) -> Vec<&'static str> {
    let canonical = crate::model_id::canonical(model);
    // Platform-API-only GPT Pro models match OpenAIProvider::available_efforts:
    // gpt-5-pro accepts only `high`; newer pro generations accept medium/high/xhigh.
    if crate::is_openai_api_only_pro_model(&canonical) {
        return if canonical.starts_with("gpt-5-pro") {
            vec!["high", "swarm"]
        } else {
            vec!["medium", "high", "xhigh", "swarm"]
        };
    }
    OPENAI_SELECTABLE_EFFORTS.to_vec()
}

/// Infer the selectable effort ladder when only provider/model identity is
/// available, such as in a remote TUI session.
pub fn inferred_reasoning_efforts(
    provider_name: Option<&str>,
    model_name: Option<&str>,
) -> Vec<&'static str> {
    let provider = provider_name.unwrap_or_default().trim().to_ascii_lowercase();
    let model = model_name.unwrap_or_default().trim().to_ascii_lowercase();

    // Providers that do not dispatch `set_reasoning_effort` in `MultiProvider`
    // must never fall through to model-name heuristics (`claude-*`, `gpt-*`, etc.).
    if is_non_effort_provider(&provider) {
        return Vec::new();
    }

    if provider.contains("rayu") {
        return RAYU_SELECTABLE_EFFORTS.to_vec();
    }

    if provider.contains("openrouter") {
        return OPENROUTER_SELECTABLE_EFFORTS.to_vec();
    }

    if provider.contains("deepseek") || model.contains("deepseek") {
        return DEEPSEEK_SELECTABLE_EFFORTS.to_vec();
    }

    if provider.contains("z.ai") || provider == "zai" || model.starts_with("glm-") {
        return OPENAI_SELECTABLE_EFFORTS.to_vec();
    }

    let is_openai_model = model.starts_with("gpt-")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.starts_with("o5");
    if provider.contains("openai-compatible") {
        return if is_openai_model {
            openai_inferred_efforts(&model)
        } else {
            Vec::new()
        };
    }

    let is_anthropic = provider.contains("anthropic")
        || provider.contains("claude")
        || model.starts_with("claude-");
    if is_anthropic {
        let caps = crate::anthropic_reasoning_caps(&model);
        if !caps.supports_reasoning_effort() {
            return Vec::new();
        }
        let mut efforts = vec!["none", "low", "medium", "high"];
        if caps.xhigh_effort {
            efforts.push("xhigh");
        }
        if caps.max_effort {
            efforts.push("max");
        }
        efforts.push("swarm");
        return efforts;
    }

    let is_openai = provider.contains("openai") || provider.contains("codex") || is_openai_model;
    if is_openai {
        return openai_inferred_efforts(&model);
    }

    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ladders_preserve_distinct_max_semantics() {
        assert_eq!(
            inferred_reasoning_efforts(Some("openai"), Some("gpt-5.4")),
            OPENAI_SELECTABLE_EFFORTS
        );
        assert!(OPENAI_SELECTABLE_EFFORTS.contains(&"max"));
        assert!(OPENAI_SELECTABLE_EFFORTS.contains(&"minimal"));
        assert!(OPENROUTER_SELECTABLE_EFFORTS.contains(&"minimal"));
        assert!(!OPENROUTER_SELECTABLE_EFFORTS.contains(&"max"));
        assert!(DEEPSEEK_SELECTABLE_EFFORTS.contains(&"max"));
        assert_eq!(
            inferred_reasoning_efforts(Some("openai-compatible:custom"), Some("gpt-5.6")),
            OPENAI_SELECTABLE_EFFORTS,
            "direct OpenAI-compatible runtimes use the OpenAI reasoning_effort vocabulary"
        );
    }

    #[test]
    fn zai_and_glm_identities_expose_openai_efforts() {
        assert_eq!(
            inferred_reasoning_efforts(Some("Z.AI"), Some("glm-5.3")),
            OPENAI_SELECTABLE_EFFORTS
        );
        assert_eq!(
            inferred_reasoning_efforts(Some("openai-compatible:zai"), Some("glm-5.3-flash")),
            OPENAI_SELECTABLE_EFFORTS
        );
    }

    #[test]
    fn anthropic_ladder_comes_from_model_capabilities() {
        assert_eq!(
            inferred_reasoning_efforts(Some("anthropic"), Some("claude-sonnet-4-6")),
            vec!["none", "low", "medium", "high", "max", "swarm"]
        );
        assert_eq!(
            inferred_reasoning_efforts(Some("anthropic"), Some("claude-opus-4-7")),
            vec!["none", "low", "medium", "high", "xhigh", "max", "swarm"]
        );
        assert!(
            inferred_reasoning_efforts(Some("anthropic"), Some("claude-haiku-4-5")).is_empty(),
            "Haiku 4.5 does not support reasoning effort"
        );
    }

    #[test]
    fn non_effort_providers_never_fall_through_to_model_heuristics() {
        for provider in [
            "cursor",
            "Cursor",
            "antigravity",
            "Antigravity",
            "bedrock",
            "AWS Bedrock",
            "gemini",
            "Gemini",
            "grok",
            "Grok Build",
        ] {
            for model in [
                "claude-opus-4-7",
                "gpt-5.4",
                "gpt-5-pro",
                "deepseek-r1",
                "glm-5.3",
                "gemini-2.5-pro",
            ] {
                assert!(
                    inferred_reasoning_efforts(Some(provider), Some(model)).is_empty(),
                    "provider `{provider}` with model `{model}` must not advertise reasoning efforts"
                );
            }
        }
    }

    #[test]
    fn openai_pro_models_match_runtime_validation_ladders() {
        assert_eq!(
            inferred_reasoning_efforts(Some("openai"), Some("gpt-5-pro")),
            vec!["high", "swarm"]
        );
        assert_eq!(
            inferred_reasoning_efforts(Some("OpenAI"), Some("gpt-5-pro-2025-10-06")),
            vec!["high", "swarm"]
        );
        for pro_model in [
            "gpt-5.2-pro",
            "gpt-5.4-pro",
            "gpt-5.5-pro",
            "gpt-5.5-pro-2026-04-23",
            "gpt-5.6-pro",
        ] {
            assert_eq!(
                inferred_reasoning_efforts(Some("openai"), Some(pro_model)),
                vec!["medium", "high", "xhigh", "swarm"],
                "newer pro model `{pro_model}` should match OpenAIProvider::available_efforts"
            );
        }
        assert_eq!(
            inferred_reasoning_efforts(Some("openai-compatible:custom"), Some("gpt-5-pro")),
            vec!["high", "swarm"]
        );
        assert_eq!(
            inferred_reasoning_efforts(Some("openai"), Some("gpt-6.1-sol")),
            OPENAI_SELECTABLE_EFFORTS
        );
    }

    #[test]
    fn rayu_and_openrouter_hosted_routes_keep_expected_ladders() {
        assert_eq!(
            inferred_reasoning_efforts(Some("Rayu"), Some("claude-opus-4-7")),
            RAYU_SELECTABLE_EFFORTS
        );
        assert_eq!(
            inferred_reasoning_efforts(Some("rayu"), Some("gpt-5.4")),
            RAYU_SELECTABLE_EFFORTS
        );
        assert_eq!(
            inferred_reasoning_efforts(Some("OpenRouter"), Some("x-ai/grok-4")),
            OPENROUTER_SELECTABLE_EFFORTS
        );
        assert_eq!(
            inferred_reasoning_efforts(Some("openrouter"), Some("google/gemini-2.5-pro")),
            OPENROUTER_SELECTABLE_EFFORTS
        );
    }
}
