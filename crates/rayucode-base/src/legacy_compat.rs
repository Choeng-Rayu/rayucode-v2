//! Read-only backward-compatibility adapters for legacy `rayu-cli/rayu` files.
//!
//! Reads legacy configuration, credential, settings, and session metadata files
//! under `~/.rayu/` without ever mutating, truncating, re-saving, or changing
//! permissions on those legacy files.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rayucode_config_types::{
    DisplayConfig, NamedProviderAuth, NamedProviderConfig, NamedProviderModelConfig,
    NamedProviderType,
};
use rayucode_import_core::{
    ClaudeCodeEntry, ClaudeCodeSessionInfo, claude_text_from_content, claude_title_candidate,
    clean_optional_text, collect_recent_files_recursive, parse_rfc3339_string,
};
use serde::Deserialize;
use std::collections::{BTreeSet, HashSet};
use std::fmt;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const RAYU_API_KEY_PREFIX: &str = "rayu_sk_live_";
const LAZY_HEAD_PEEK_BYTES: u64 = 64 * 1024;
const LAZY_TAIL_PEEK_BYTES: u64 = 32 * 1024;
const NON_CHAT_MODEL_TOKENS: &[&str] = &[
    "embed",
    "bge-",
    "rerank",
    "reward",
    "guard",
    "safety",
    "moderation",
    "topic-control",
    "ocr",
    "parse",
    "deplot",
    "nvclip",
    "clip",
    "whisper",
    "tts",
    "stt",
    "video",
    "detector",
    "nemoretriever",
    "content-safety",
];

fn deserialize_default_vec<'de, D>(deserializer: D) -> std::result::Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Option::<Vec<String>>::deserialize(deserializer)? {
        Some(items) => Ok(items),
        None => Ok(Vec::new()),
    }
}

fn deserialize_default_providers<'de, D>(
    deserializer: D,
) -> std::result::Result<Vec<LegacyProviderEntry>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Option::<Vec<LegacyProviderEntry>>::deserialize(deserializer)? {
        Some(items) => Ok(items),
        None => Ok(Vec::new()),
    }
}

fn non_empty_trimmed(value: Option<&str>) -> Option<&str> {
    let raw = value?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn non_empty_owned(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Legacy subagent provider/model selection stored in `~/.rayu/providers.json`.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LegacySubagentSelection {
    pub provider_id: String,
    pub model: String,
}

impl Default for LegacySubagentSelection {
    fn default() -> Self {
        Self {
            provider_id: String::new(),
            model: String::new(),
        }
    }
}

impl fmt::Debug for LegacySubagentSelection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LegacySubagentSelection")
            .field("provider_id", &self.provider_id)
            .field("model", &self.model)
            .finish()
    }
}

/// One provider entry read from legacy `rayu-cli` `~/.rayu/providers.json`.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LegacyProviderEntry {
    pub id: String,
    pub kind: String,
    pub label: Option<String>,
    pub wire_format: Option<String>,
    pub api_key: Option<String>,
    #[serde(deserialize_with = "deserialize_default_vec")]
    pub api_keys: Vec<String>,
    #[serde(rename = "baseURL", alias = "baseUrl", alias = "base_url")]
    pub base_url: Option<String>,
    pub default_model: Option<String>,
    pub small_fast_model: Option<String>,
    #[serde(deserialize_with = "deserialize_default_vec")]
    pub models: Vec<String>,
    #[serde(deserialize_with = "deserialize_default_vec")]
    pub fetched_models: Vec<String>,
    pub context_window: Option<usize>,
    pub supports_thinking: Option<bool>,
    pub supports_image: Option<bool>,
    pub anthropic_auth_type: Option<String>,
    pub kiro_auth_type: Option<String>,
    pub aws_access_key_id: Option<String>,
    pub aws_secret_access_key: Option<String>,
    pub aws_region: Option<String>,
    pub azure_resource: Option<String>,
    pub azure_api_version: Option<String>,
    pub gcp_project: Option<String>,
    pub gcp_region: Option<String>,
}

impl Default for LegacyProviderEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: String::new(),
            label: None,
            wire_format: None,
            api_key: None,
            api_keys: Vec::new(),
            base_url: None,
            default_model: None,
            small_fast_model: None,
            models: Vec::new(),
            fetched_models: Vec::new(),
            context_window: None,
            supports_thinking: None,
            supports_image: None,
            anthropic_auth_type: None,
            kiro_auth_type: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
            aws_region: None,
            azure_resource: None,
            azure_api_version: None,
            gcp_project: None,
            gcp_region: None,
        }
    }
}

impl fmt::Debug for LegacyProviderEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LegacyProviderEntry")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("label", &self.label)
            .field("wire_format", &self.wire_format)
            .field("has_api_key", &self.primary_api_key().is_some())
            .field("api_keys_count", &self.all_api_keys().len())
            .field("base_url", &self.base_url)
            .field("default_model", &self.default_model)
            .field("small_fast_model", &self.small_fast_model)
            .field("models_count", &self.models.len())
            .field("fetched_models_count", &self.fetched_models.len())
            .field("has_aws_secret", &self.aws_secret_access_key.is_some())
            .finish()
    }
}

impl LegacyProviderEntry {
    /// Return the primary configured API key (`apiKey`, or first non-empty `apiKeys` entry).
    pub fn primary_api_key(&self) -> Option<&str> {
        if let Some(key) = non_empty_trimmed(self.api_key.as_deref()) {
            return Some(key);
        }
        self.api_keys
            .iter()
            .find_map(|raw| non_empty_trimmed(Some(raw.as_str())))
    }

    /// Return all deduplicated non-empty API keys in priority order (`apiKeys` + `apiKey`).
    pub fn all_api_keys(&self) -> Vec<String> {
        let mut keys = Vec::new();
        let mut seen = BTreeSet::new();
        for raw in self.api_keys.iter().chain(self.api_key.iter()) {
            if let Some(trimmed) = non_empty_trimmed(Some(raw.as_str()))
                && seen.insert(trimmed.to_string())
            {
                keys.push(trimmed.to_string());
            }
        }
        keys
    }

    /// Resolve a valid default model, mirroring `rayuConfig.ts::getValidDefaultModel`.
    pub fn effective_default_model(&self) -> Option<&str> {
        let configured = non_empty_trimmed(self.default_model.as_deref());
        if let Some(model) = configured
            && (self.fetched_models.is_empty()
                || self.fetched_models.iter().any(|item| item.trim() == model))
        {
            return Some(model);
        }
        if let Some(chat_model) = self.fetched_models.iter().find_map(|raw| {
            let trimmed = non_empty_trimmed(Some(raw.as_str()))?;
            is_likely_chat_model(trimmed).then_some(trimmed)
        }) {
            return Some(chat_model);
        }
        if let Some(first_fetched) = self
            .fetched_models
            .iter()
            .find_map(|raw| non_empty_trimmed(Some(raw.as_str())))
        {
            return Some(first_fetched);
        }
        configured.or_else(|| {
            self.models
                .iter()
                .find_map(|raw| non_empty_trimmed(Some(raw.as_str())))
        })
    }

    /// Convert an OpenAI-compatible or Anthropic-compatible legacy `/connect`
    /// entry into a lowest-precedence [`NamedProviderConfig`], if representable.
    pub fn to_named_provider_config(&self) -> Option<(String, NamedProviderConfig)> {
        let id = non_empty_trimmed(Some(self.id.as_str()))?.to_string();
        let kind = self.kind.trim().to_ascii_lowercase();
        let wire = self
            .wire_format
            .as_deref()
            .map(|w| w.trim().to_ascii_lowercase());

        let provider_type = if id == "openrouter" {
            NamedProviderType::OpenRouter
        } else if matches!(wire.as_deref(), Some("anthropic-messages"))
            || kind == "anthropic-compatible"
        {
            NamedProviderType::AnthropicCompatible
        } else if matches!(wire.as_deref(), Some("openai-chat" | "openai-responses"))
            || matches!(kind.as_str(), "openai-compatible" | "custom")
        {
            NamedProviderType::OpenAiCompatible
        } else {
            return None;
        };

        let base_url = non_empty_trimmed(self.base_url.as_deref()).or_else(|| {
            if provider_type == NamedProviderType::OpenRouter {
                Some("https://openrouter.ai/api/v1")
            } else {
                None
            }
        })?;

        let api_key = self.primary_api_key().map(str::to_string);
        let auth = if api_key.is_some() {
            NamedProviderAuth::Bearer
        } else {
            NamedProviderAuth::None
        };

        let mut models = Vec::new();
        let mut seen_models = BTreeSet::new();
        for raw in self
            .default_model
            .iter()
            .chain(self.models.iter())
            .chain(self.fetched_models.iter())
        {
            if let Some(model_id) = non_empty_trimmed(Some(raw.as_str()))
                && seen_models.insert(model_id.to_string())
            {
                models.push(NamedProviderModelConfig {
                    id: model_id.to_string(),
                    reasoning: self.supports_thinking,
                    reasoning_effort: None,
                    context_window: self.context_window,
                    input: Vec::new(),
                });
            }
        }

        let mut config = NamedProviderConfig::default();
        config.provider_type = provider_type;
        config.base_url = base_url.to_string();
        config.auth = auth;
        config.requires_api_key = Some(api_key.is_some());
        config.api_key = api_key;
        config.default_model = self.effective_default_model().map(str::to_string);
        config.models = models;
        Some((id, config))
    }
}

fn is_likely_chat_model(model_id: &str) -> bool {
    let lower = model_id.to_ascii_lowercase();
    !NON_CHAT_MODEL_TOKENS
        .iter()
        .any(|token| lower.contains(token))
}

/// Top-level `~/.rayu/providers.json` layout from legacy `rayu-cli`.
#[derive(Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LegacyProvidersConfig {
    pub active_provider: Option<String>,
    #[serde(deserialize_with = "deserialize_default_providers")]
    pub providers: Vec<LegacyProviderEntry>,
    pub subagent: Option<LegacySubagentSelection>,
    pub image_model: Option<String>,
    pub video_model: Option<String>,
    pub web_fetch_model: Option<String>,
}

impl fmt::Debug for LegacyProvidersConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LegacyProvidersConfig")
            .field("active_provider", &self.active_provider)
            .field("providers", &self.providers)
            .field("subagent", &self.subagent)
            .field("image_model", &self.image_model)
            .field("video_model", &self.video_model)
            .field("web_fetch_model", &self.web_fetch_model)
            .finish()
    }
}

impl LegacyProvidersConfig {
    /// Read legacy `~/.rayu/providers.json` (respecting `RAYU_AUTH_CONFIG_DIR` /
    /// `RAYU_HOME` / `RAYU_CONFIG_DIR`) strictly read-only.
    pub fn load() -> Option<Self> {
        let path = legacy_providers_path();
        match Self::load_from_path(&path) {
            Ok(config) => config,
            Err(err) => {
                crate::logging::warn(&format!(
                    "Legacy providers.json could not be parsed at {}: {}",
                    path.display(),
                    err
                ));
                None
            }
        }
    }

    /// Read a legacy `providers.json` file from an explicit path strictly read-only.
    pub fn load_from_path(path: &Path) -> Result<Option<Self>> {
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read legacy providers file {}", path.display()))?;
        if raw.trim().is_empty() {
            return Ok(Some(Self::default()));
        }
        let parsed: Self = serde_json::from_str(&raw)
            .with_context(|| format!("Failed to parse legacy providers JSON {}", path.display()))?;
        Ok(Some(parsed))
    }

    /// Find a provider entry by id.
    pub fn find(&self, id: &str) -> Option<&LegacyProviderEntry> {
        let target = id.trim();
        if target.is_empty() {
            return None;
        }
        self.providers
            .iter()
            .find(|entry| entry.id.trim() == target)
    }

    /// Return the active provider entry (`activeProvider`), falling back to the
    /// first configured provider entry.
    pub fn active(&self) -> Option<&LegacyProviderEntry> {
        if let Some(active_id) = non_empty_trimmed(self.active_provider.as_deref())
            && let Some(entry) = self.find(active_id)
        {
            return Some(entry);
        }
        self.providers.first()
    }

    /// Return a stored `rayu_sk_live_...` API key from the legacy `"rayu"`
    /// provider entry, if present.
    pub fn rayu_api_key(&self) -> Option<&str> {
        let entry = self.find("rayu")?;
        let key = entry.primary_api_key()?;
        key.starts_with(RAYU_API_KEY_PREFIX).then_some(key)
    }

    /// Return non-Rayu `/connect` providers ONLY when the Rayu-Auth-first gate
    /// is satisfied so third-party legacy providers never bypass Rayu login.
    pub fn third_party_providers_if_authorized(
        &self,
        rayu_auth_satisfied: bool,
    ) -> Vec<&LegacyProviderEntry> {
        if !rayu_auth_satisfied {
            return Vec::new();
        }
        self.providers
            .iter()
            .filter(|entry| {
                let id = entry.id.trim();
                !id.is_empty() && id != "rayu" && id != "rayu-hosted"
            })
            .collect()
    }

    /// Return the active legacy provider entry subject to the Rayu-Auth-first gate.
    ///
    /// When `rayu_auth_satisfied` is `false`, only a legacy `"rayu"` entry with
    /// a `rayu_sk_live_` key may surface; third-party providers remain gated off.
    pub fn active_fallback_if_authorized(
        &self,
        rayu_auth_satisfied: bool,
    ) -> Option<&LegacyProviderEntry> {
        if rayu_auth_satisfied {
            return self.active();
        }
        let active = self.active()?;
        if active.id.trim() == "rayu"
            && active
                .primary_api_key()
                .is_some_and(|key| key.starts_with(RAYU_API_KEY_PREFIX))
        {
            return Some(active);
        }
        None
    }
}

/// Safe non-secret legacy settings read from `~/.rayu/settings.json` and
/// `settings.local.json` (user and optional project scope).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LegacySettings {
    pub model: Option<String>,
    pub prefers_reduced_motion: Option<bool>,
    pub language: Option<String>,
    pub output_style: Option<String>,
    pub always_thinking_enabled: Option<bool>,
    pub effort_level: Option<String>,
    pub fast_mode: Option<bool>,
    pub syntax_highlighting_disabled: Option<bool>,
    pub spinner_tips_enabled: Option<bool>,
    pub terminal_title_from_rename: Option<bool>,
    pub auto_memory_enabled: Option<bool>,
    pub plans_directory: Option<String>,
    pub claude_mcp_enabled: Option<bool>,
    pub agent_skills_enabled: Option<bool>,
    pub extra_skill_dirs: Option<Vec<String>>,
}

impl LegacySettings {
    /// Load and merge legacy settings read-only from global and optional project
    /// locations in precedence order:
    /// `~/.rayu/settings.json` < `~/.rayu/settings.local.json` <
    /// `<project>/.rayu/settings.json` < `<project>/.rayu/settings.local.json`.
    pub fn load_for_dir(project_dir: Option<&Path>) -> Self {
        let mut paths = Vec::new();
        if let Ok(rayu_dir) = crate::storage::rayu_dir() {
            paths.push(rayu_dir.join("settings.json"));
            paths.push(rayu_dir.join("settings.local.json"));
        }
        if let Some(project) = project_dir {
            paths.push(project.join(".rayu").join("settings.json"));
            paths.push(project.join(".rayu").join("settings.local.json"));
        }
        let refs: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
        Self::load_from_paths(&refs)
    }

    /// Merge an ordered slice of settings files (lowest precedence first).
    pub fn load_from_paths(paths: &[&Path]) -> Self {
        let mut merged = Self::default();
        for path in paths {
            match Self::load_from_path(path) {
                Ok(Some(layer)) => merged.merge_overlay(layer),
                Ok(None) => {}
                Err(err) => {
                    crate::logging::warn(&format!(
                        "Legacy settings file could not be parsed at {}: {}",
                        path.display(),
                        err
                    ));
                }
            }
        }
        merged
    }

    /// Read a single legacy `settings*.json` file strictly read-only.
    pub fn load_from_path(path: &Path) -> Result<Option<Self>> {
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read legacy settings file {}", path.display()))?;
        if raw.trim().is_empty() {
            return Ok(Some(Self::default()));
        }
        let mut parsed: Self = serde_json::from_str(&raw)
            .with_context(|| format!("Failed to parse legacy settings JSON {}", path.display()))?;
        parsed.model = non_empty_owned(parsed.model);
        parsed.language = non_empty_owned(parsed.language);
        parsed.output_style = non_empty_owned(parsed.output_style);
        parsed.effort_level = non_empty_owned(parsed.effort_level);
        parsed.plans_directory = non_empty_owned(parsed.plans_directory);
        Ok(Some(parsed))
    }

    /// Apply `higher` on top of `self`, keeping lower-precedence fields when `None`.
    pub fn merge_overlay(&mut self, higher: Self) {
        if let Some(model) = non_empty_owned(higher.model) {
            self.model = Some(model);
        }
        if higher.prefers_reduced_motion.is_some() {
            self.prefers_reduced_motion = higher.prefers_reduced_motion;
        }
        if let Some(language) = non_empty_owned(higher.language) {
            self.language = Some(language);
        }
        if let Some(output_style) = non_empty_owned(higher.output_style) {
            self.output_style = Some(output_style);
        }
        if higher.always_thinking_enabled.is_some() {
            self.always_thinking_enabled = higher.always_thinking_enabled;
        }
        if let Some(effort_level) = non_empty_owned(higher.effort_level) {
            self.effort_level = Some(effort_level);
        }
        if higher.fast_mode.is_some() {
            self.fast_mode = higher.fast_mode;
        }
        if higher.syntax_highlighting_disabled.is_some() {
            self.syntax_highlighting_disabled = higher.syntax_highlighting_disabled;
        }
        if higher.spinner_tips_enabled.is_some() {
            self.spinner_tips_enabled = higher.spinner_tips_enabled;
        }
        if higher.terminal_title_from_rename.is_some() {
            self.terminal_title_from_rename = higher.terminal_title_from_rename;
        }
        if higher.auto_memory_enabled.is_some() {
            self.auto_memory_enabled = higher.auto_memory_enabled;
        }
        if let Some(plans_directory) = non_empty_owned(higher.plans_directory) {
            self.plans_directory = Some(plans_directory);
        }
        if higher.claude_mcp_enabled.is_some() {
            self.claude_mcp_enabled = higher.claude_mcp_enabled;
        }
        if higher.agent_skills_enabled.is_some() {
            self.agent_skills_enabled = higher.agent_skills_enabled;
        }
        if higher.extra_skill_dirs.is_some() {
            self.extra_skill_dirs = higher.extra_skill_dirs;
        }
    }

    /// Apply safe non-secret display preferences as lowest-precedence fallback
    /// when rayu-v2's own `DisplayConfig` has not explicitly overridden them.
    pub fn apply_display_fallback(&self, display: &mut DisplayConfig) {
        if self.prefers_reduced_motion == Some(true) && display.performance.trim().is_empty() {
            display.idle_animation = false;
            display.prompt_entry_animation = false;
        }
    }

    /// Return the legacy `model` fallback ONLY when `explicit_model` is unset
    /// and the Rayu-Auth-first gate is satisfied.
    pub fn fallback_model_if_authorized(
        &self,
        explicit_model: Option<&str>,
        rayu_auth_satisfied: bool,
    ) -> Option<&str> {
        if !rayu_auth_satisfied {
            return None;
        }
        if non_empty_trimmed(explicit_model).is_some() {
            return None;
        }
        non_empty_trimmed(self.model.as_deref())
    }
}

/// Resolve the legacy `~/.rayu/providers.json` path (honoring `RAYU_AUTH_CONFIG_DIR`,
/// `RAYU_HOME`, `RAYU_CONFIG_DIR`).
pub fn legacy_providers_path() -> PathBuf {
    crate::rayu::config_dir().join("providers.json")
}

/// Resolve `rayu_dir()/projects` where legacy `rayu-cli` stores per-project JSONL sessions.
pub fn rayu_cli_projects_dir() -> Result<PathBuf> {
    Ok(crate::storage::rayu_dir()?.join("projects"))
}

/// True when `path` resides under `rayu_dir()/projects`.
pub fn is_rayu_cli_project_transcript_path(path: &Path) -> bool {
    match rayu_cli_projects_dir() {
        Ok(projects_dir) => path.starts_with(projects_dir),
        Err(_) => false,
    }
}

/// Discover all `<sanitized-cwd>` project directories under `rayu_dir()/projects`.
pub fn discover_rayu_cli_project_dirs() -> Vec<PathBuf> {
    let projects_dir = match rayu_cli_projects_dir() {
        Ok(dir) if dir.is_dir() => dir,
        _ => return Vec::new(),
    };
    let entries = match std::fs::read_dir(&projects_dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
        }
    }
    dirs.sort();
    dirs
}

/// Collect direct `*.jsonl` transcript files in `dir` (ignoring nested `subagents/`).
pub fn collect_direct_jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"))
        {
            files.push(path);
        }
    }
    files.sort();
    files
}

fn read_head_tail_slices(path: &Path) -> (String, String) {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return (String::new(), String::new()),
    };
    let file_len = match file.metadata() {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    };
    let mut head_bytes = Vec::new();
    let mut head_reader = (&file).take(LAZY_HEAD_PEEK_BYTES);
    if head_reader.read_to_end(&mut head_bytes).is_err() {
        return (String::new(), String::new());
    }
    let head_truncated = file_len > LAZY_HEAD_PEEK_BYTES;
    let mut head = String::from_utf8_lossy(&head_bytes).into_owned();
    if head_truncated && let Some(last_nl) = head.rfind('\n') {
        head.truncate(last_nl);
    }

    if file_len <= LAZY_HEAD_PEEK_BYTES {
        return (head, String::new());
    }

    let tail_start = file_len.saturating_sub(LAZY_TAIL_PEEK_BYTES);
    if file.seek(SeekFrom::Start(tail_start)).is_err() {
        return (head, String::new());
    }
    let mut tail_bytes = Vec::new();
    if file.read_to_end(&mut tail_bytes).is_err() {
        return (head, String::new());
    }
    let mut tail = String::from_utf8_lossy(&tail_bytes).into_owned();
    if tail_start > 0
        && let Some(first_nl) = tail.find('\n')
    {
        tail = tail[first_nl + 1..].to_string();
    }
    (head, tail)
}

fn update_title_fields(
    value: &serde_json::Value,
    custom_title: &mut Option<String>,
    ai_title: &mut Option<String>,
    summary: &mut Option<String>,
) {
    if let Some(title) = value
        .get("customTitle")
        .and_then(|v| v.as_str())
        .and_then(|s| non_empty_trimmed(Some(s)))
    {
        *custom_title = Some(title.to_string());
    }
    if let Some(title) = value
        .get("aiTitle")
        .and_then(|v| v.as_str())
        .and_then(|s| non_empty_trimmed(Some(s)))
    {
        *ai_title = Some(title.to_string());
    }
    if let Some(title) = value
        .get("summary")
        .and_then(|v| v.as_str())
        .and_then(|s| non_empty_trimmed(Some(s)))
    {
        *summary = Some(title.to_string());
    }
}

/// Lazily peek head/tail metadata from a Claude-compatible JSONL transcript
/// without parsing the whole file or mutating it on disk.
pub fn peek_claude_compatible_session_metadata(
    path: &Path,
    project_dir: &Path,
    fallback_label_prefix: &str,
) -> ClaudeCodeSessionInfo {
    let stem_id = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let file_mtime = path
        .metadata()
        .and_then(|meta| meta.modified())
        .map(DateTime::<Utc>::from);
    let file_modified = match file_mtime {
        Ok(ts) => Some(ts),
        Err(_) => None,
    };

    let (head, tail) = read_head_tail_slices(path);
    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut created: Option<DateTime<Utc>> = None;
    let mut first_prompt: Option<String> = None;
    let mut custom_title: Option<String> = None;
    let mut ai_title: Option<String> = None;
    let mut summary: Option<String> = None;

    for line in head.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value = match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(val) => val,
            Err(_) => continue,
        };
        if session_id.is_none() {
            session_id = value
                .get("sessionId")
                .and_then(|v| v.as_str())
                .and_then(|s| non_empty_trimmed(Some(s)))
                .map(str::to_string);
        }
        if cwd.is_none() {
            cwd = value
                .get("cwd")
                .and_then(|v| v.as_str())
                .and_then(|s| non_empty_trimmed(Some(s)))
                .map(str::to_string);
        }
        if created.is_none() {
            created = parse_rfc3339_string(value.get("timestamp").and_then(|v| v.as_str()));
        }
        update_title_fields(&value, &mut custom_title, &mut ai_title, &mut summary);
        if first_prompt.is_none() {
            let is_meta = value
                .get("isMeta")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let is_compact = value
                .get("isCompactSummary")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !is_meta
                && !is_compact
                && value.get("type").and_then(|v| v.as_str()) == Some("user")
                && let Ok(entry) = serde_json::from_value::<ClaudeCodeEntry>(value)
                && !entry.is_sidechain
                && let Some(msg) = entry.message.as_ref()
                && let Some(text) = claude_text_from_content(&msg.content)
            {
                first_prompt = claude_title_candidate(&text);
            }
        }
    }

    for line in tail.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            update_title_fields(&value, &mut custom_title, &mut ai_title, &mut summary);
        }
    }

    let resolved_id = session_id.unwrap_or(stem_id);
    let fallback_label = format!(
        "{fallback_label_prefix} {}",
        rayucode_core::util::truncate_str(&resolved_id, 8)
    );
    let title = clean_optional_text(custom_title)
        .or_else(|| clean_optional_text(ai_title))
        .or_else(|| clean_optional_text(summary));
    let resolved_prompt = clean_optional_text(first_prompt)
        .or_else(|| title.clone())
        .unwrap_or_else(|| fallback_label.clone());
    let resolved_summary = title.or_else(|| Some(resolved_prompt.clone()));
    let project_path = cwd.or_else(|| {
        project_dir
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.replace('-', "/"))
    });

    ClaudeCodeSessionInfo {
        session_id: resolved_id,
        first_prompt: resolved_prompt,
        summary: resolved_summary,
        message_count: 0,
        created: created.or(file_modified),
        modified: file_modified,
        project_path,
        full_path: path.to_string_lossy().to_string(),
    }
}

/// Collect, sort by mtime descending, truncate to `scan_limit`, and lazily peek
/// metadata for unindexed Claude Code and legacy `rayu-cli` session transcripts.
pub fn peek_unindexed_claude_compatible_sessions(
    project_dirs: &[PathBuf],
    seen_session_ids: &mut HashSet<String>,
    scan_limit: usize,
) -> Vec<ClaudeCodeSessionInfo> {
    let mut unindexed_candidates: Vec<(u128, bool, &PathBuf, PathBuf)> = Vec::new();
    for project_dir in project_dirs {
        let is_rayu_cli = is_rayu_cli_project_transcript_path(project_dir);
        let paths = if is_rayu_cli {
            collect_direct_jsonl_files(project_dir)
        } else {
            collect_recent_files_recursive(project_dir, "jsonl", scan_limit)
        };
        for path in paths {
            let Some(session_id) = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
            else {
                continue;
            };
            if seen_session_ids.contains(&session_id) {
                continue;
            }
            let modified_nanos =
                match path
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .and_then(|time| {
                        time.duration_since(std::time::UNIX_EPOCH)
                            .map_err(|_| std::io::Error::other("before epoch"))
                    }) {
                    Ok(dur) => dur.as_nanos(),
                    Err(_) => 0,
                };
            seen_session_ids.insert(session_id);
            unindexed_candidates.push((modified_nanos, is_rayu_cli, project_dir, path));
        }
    }

    unindexed_candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.3.cmp(&a.3)));
    unindexed_candidates.truncate(scan_limit);
    unindexed_candidates
        .into_iter()
        .map(|(_, is_rayu_cli, project_dir, path)| {
            let prefix = if is_rayu_cli {
                "Rayu CLI session"
            } else {
                "Claude Code session"
            };
            peek_claude_compatible_session_metadata(&path, project_dir, prefix)
        })
        .collect()
}

#[cfg(test)]
#[path = "legacy_compat_tests.rs"]
mod tests;
