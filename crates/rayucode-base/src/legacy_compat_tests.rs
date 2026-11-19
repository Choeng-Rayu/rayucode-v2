use super::*;
use std::collections::HashSet;
use std::io::Write;
use std::time::{Duration, SystemTime};

struct EnvVarGuard {
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl EnvVarGuard {
    fn new(keys: &[&'static str]) -> Self {
        let saved = keys
            .iter()
            .map(|&key| (key, std::env::var_os(key)))
            .collect();
        Self { saved }
    }

    fn set_path(&self, key: &str, value: &Path) {
        unsafe {
            std::env::set_var(key, value);
        }
    }

    fn remove(&self, key: &str) {
        unsafe {
            std::env::remove_var(key);
        }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        for (key, value) in &self.saved {
            unsafe {
                match value {
                    Some(v) => std::env::set_var(key, v),
                    None => std::env::remove_var(key),
                }
            }
        }
    }
}

fn mtime_of(path: &Path) -> SystemTime {
    std::fs::metadata(path)
        .expect("stat file")
        .modified()
        .expect("modified time")
}

fn backdate_file(path: &Path, secs_ago: u64) -> SystemTime {
    let past = SystemTime::now() - Duration::from_secs(secs_ago);
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("open file for mtime");
    file.set_modified(past).expect("set mtime");
    drop(file);
    mtime_of(path)
}

#[test]
fn providers_config_loads_read_only_and_enforces_rayu_auth_gate() {
    let _lock = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().expect("tempdir");
    let rayu_home = temp.path().join(".rayu");
    std::fs::create_dir_all(&rayu_home).expect("mkdir");

    let env = EnvVarGuard::new(&["RAYU_HOME", "RAYU_CONFIG_DIR", "RAYU_AUTH_CONFIG_DIR"]);
    env.remove("RAYU_AUTH_CONFIG_DIR");
    env.remove("RAYU_CONFIG_DIR");
    env.set_path("RAYU_HOME", &rayu_home);

    let providers_path = rayu_home.join("providers.json");
    let payload = r#"{
  "activeProvider": "openrouter",
  "providers": [
    {
      "id": "rayu",
      "kind": "rayu",
      "apiKey": "rayu_sk_live_test_secret_1234",
      "defaultModel": "claude-sonnet-4-6"
    },
    {
      "id": "openrouter",
      "kind": "openai-compatible",
      "wireFormat": "openai-chat",
      "apiKeys": ["sk-or-v1-primary-secret", "sk-or-v1-backup-secret"],
      "baseURL": "https://openrouter.ai/api/v1",
      "defaultModel": "text-embedding-3-large",
      "fetchedModels": ["text-embedding-3-large", "anthropic/claude-3.7-sonnet"],
      "models": ["openai/gpt-4o"],
      "supportsThinking": true,
      "contextWindow": 200000
    },
    {
      "id": "custom-anthropic",
      "kind": "anthropic-compatible",
      "wireFormat": "anthropic-messages",
      "apiKey": "sk-ant-custom-secret",
      "baseUrl": "https://proxy.example.com/v1",
      "defaultModel": "claude-opus-4-6"
    }
  ],
  "subagent": {
    "providerId": "openrouter",
    "model": "openai/gpt-4o"
  }
}"#;
    std::fs::write(&providers_path, payload).expect("write providers.json");
    let expected_mtime = backdate_file(&providers_path, 3600);

    let loaded = LegacyProvidersConfig::load().expect("should load providers.json");
    assert_eq!(loaded.rayu_api_key(), Some("rayu_sk_live_test_secret_1234"));

    // Debug output must never leak secret API keys.
    let debug_str = format!("{loaded:?}");
    assert!(!debug_str.contains("rayu_sk_live_test_secret_1234"));
    assert!(!debug_str.contains("sk-or-v1-primary-secret"));
    assert!(!debug_str.contains("sk-ant-custom-secret"));

    // Before Rayu Auth succeeds, third-party `/connect` providers stay gated off.
    assert!(loaded.third_party_providers_if_authorized(false).is_empty());
    assert!(loaded.active_fallback_if_authorized(false).is_none());

    // Once Rayu Auth is satisfied, third-party `/connect` entries become available.
    let third_party = loaded.third_party_providers_if_authorized(true);
    assert_eq!(third_party.len(), 2);
    let active = loaded
        .active_fallback_if_authorized(true)
        .expect("active provider");
    assert_eq!(active.id, "openrouter");
    assert_eq!(active.primary_api_key(), Some("sk-or-v1-primary-secret"));
    assert_eq!(
        active.all_api_keys(),
        vec![
            "sk-or-v1-primary-secret".to_string(),
            "sk-or-v1-backup-secret".to_string(),
        ]
    );
    // `text-embedding-3-large` exists in `fetchedModels`, so configured model stays valid;
    // test invalid/absent configured model skipping non-chat embedding model too.
    assert_eq!(
        active.effective_default_model(),
        Some("text-embedding-3-large")
    );
    let (_, named_or) = active
        .to_named_provider_config()
        .expect("named openrouter config");
    assert_eq!(named_or.provider_type, NamedProviderType::OpenRouter);
    assert_eq!(named_or.auth, NamedProviderAuth::Bearer);
    assert_eq!(named_or.api_key.as_deref(), Some("sk-or-v1-primary-secret"));
    assert_eq!(named_or.models.len(), 3);

    let custom_ant = loaded.find("custom-anthropic").expect("custom anthropic");
    let (_, named_ant) = custom_ant
        .to_named_provider_config()
        .expect("named anthropic config");
    assert_eq!(
        named_ant.provider_type,
        NamedProviderType::AnthropicCompatible
    );
    assert_eq!(named_ant.base_url, "https://proxy.example.com/v1");

    // Verify file contents and mtime remain completely untouched.
    assert_eq!(
        std::fs::read_to_string(&providers_path).expect("re-read"),
        payload
    );
    assert_eq!(mtime_of(&providers_path), expected_mtime);
}

#[test]
fn effective_default_model_skips_stale_or_non_chat_fetched_models() {
    let mut entry = LegacyProviderEntry {
        id: "nvidia".to_string(),
        kind: "openai-compatible".to_string(),
        default_model: Some("stale/removed-model".to_string()),
        fetched_models: vec![
            "nvidia/nv-embedqa-e5-v5".to_string(),
            "meta/llama-3.3-70b-instruct".to_string(),
        ],
        ..Default::default()
    };
    assert_eq!(
        entry.effective_default_model(),
        Some("meta/llama-3.3-70b-instruct")
    );

    entry.default_model = Some("   ".to_string());
    entry.fetched_models.clear();
    entry.models = vec!["custom-chat".to_string()];
    assert_eq!(entry.effective_default_model(), Some("custom-chat"));
}

#[test]
fn active_fallback_unauthenticated_allows_only_rayu_live_key() {
    let cfg = LegacyProvidersConfig {
        active_provider: Some("rayu".to_string()),
        providers: vec![LegacyProviderEntry {
            id: "rayu".to_string(),
            kind: "rayu".to_string(),
            api_key: Some("rayu_sk_live_only_rayu".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };
    assert_eq!(
        cfg.active_fallback_if_authorized(false)
            .map(|p| p.id.as_str()),
        Some("rayu")
    );
}

#[test]
fn legacy_settings_precedence_display_fallback_and_read_only_mtime() {
    let _lock = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().expect("tempdir");
    let rayu_home = temp.path().join(".rayu");
    let project_dir = temp.path().join("project");
    std::fs::create_dir_all(&rayu_home).expect("mkdir rayu_home");
    std::fs::create_dir_all(project_dir.join(".rayu")).expect("mkdir project .rayu");

    let env = EnvVarGuard::new(&["RAYU_HOME", "RAYU_CONFIG_DIR", "RAYU_AUTH_CONFIG_DIR"]);
    env.remove("RAYU_AUTH_CONFIG_DIR");
    env.remove("RAYU_CONFIG_DIR");
    env.set_path("RAYU_HOME", &rayu_home);

    let g_settings = rayu_home.join("settings.json");
    let g_local = rayu_home.join("settings.local.json");
    let p_settings = project_dir.join(".rayu/settings.json");
    let p_local = project_dir.join(".rayu/settings.local.json");

    let g_raw = r#"{
  "model": "global-model",
  "prefersReducedMotion": false,
  "language": "en",
  "alwaysThinkingEnabled": false,
  "claudeMcpEnabled": true
}"#;
    let g_local_raw = r#"{
  "model": "global-local-model",
  "prefersReducedMotion": true,
  "spinnerTipsEnabled": false
}"#;
    let p_raw = r#"{
  "model": "project-model",
  "outputStyle": "concise"
}"#;
    let p_local_raw = r#"{
  "model": "project-local-model",
  "fastMode": true
}"#;

    std::fs::write(&g_settings, g_raw).expect("write g_settings");
    std::fs::write(&g_local, g_local_raw).expect("write g_local");
    std::fs::write(&p_settings, p_raw).expect("write p_settings");
    std::fs::write(&p_local, p_local_raw).expect("write p_local");

    let m1 = backdate_file(&g_settings, 3600);
    let m2 = backdate_file(&g_local, 3600);
    let m3 = backdate_file(&p_settings, 3600);
    let m4 = backdate_file(&p_local, 3600);

    let merged = LegacySettings::load_for_dir(Some(&project_dir));
    assert_eq!(merged.model.as_deref(), Some("project-local-model"));
    assert_eq!(merged.prefers_reduced_motion, Some(true));
    assert_eq!(merged.language.as_deref(), Some("en"));
    assert_eq!(merged.output_style.as_deref(), Some("concise"));
    assert_eq!(merged.always_thinking_enabled, Some(false));
    assert_eq!(merged.spinner_tips_enabled, Some(false));
    assert_eq!(merged.fast_mode, Some(true));
    assert_eq!(merged.claude_mcp_enabled, Some(true));

    // Model fallback stays blocked unless Rayu Auth is satisfied AND explicit model is unset.
    assert_eq!(merged.fallback_model_if_authorized(None, false), None);
    assert_eq!(
        merged.fallback_model_if_authorized(Some("explicit-v2-model"), true),
        None
    );
    assert_eq!(
        merged.fallback_model_if_authorized(None, true),
        Some("project-local-model")
    );

    // Safe non-secret display fallback applies only when v2 performance preset is unset.
    let mut display_default = DisplayConfig::default();
    display_default.performance.clear();
    merged.apply_display_fallback(&mut display_default);
    assert!(!display_default.idle_animation);
    assert!(!display_default.prompt_entry_animation);

    let mut display_explicit = DisplayConfig::default();
    display_explicit.performance = "balanced".to_string();
    display_explicit.idle_animation = true;
    display_explicit.prompt_entry_animation = true;
    merged.apply_display_fallback(&mut display_explicit);
    assert!(display_explicit.idle_animation);
    assert!(display_explicit.prompt_entry_animation);

    for (path, raw, mtime) in [
        (&g_settings, g_raw, m1),
        (&g_local, g_local_raw, m2),
        (&p_settings, p_raw, m3),
        (&p_local, p_local_raw, m4),
    ] {
        assert_eq!(std::fs::read_to_string(path).expect("read"), raw);
        assert_eq!(mtime_of(path), mtime);
    }
}

#[test]
fn rayu_cli_transcript_peek_reads_head_tail_skips_subagents_and_preserves_files() {
    let _lock = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().expect("tempdir");
    let env = EnvVarGuard::new(&["RAYU_HOME", "RAYU_CONFIG_DIR"]);
    env.remove("RAYU_CONFIG_DIR");
    env.set_path("RAYU_HOME", temp.path());
    let project_dir = temp.path().join("projects/-home-user-repo");
    let subagents_dir = project_dir.join("sess-1/subagents");
    std::fs::create_dir_all(&subagents_dir).expect("mkdir subagents");

    let main_file = project_dir.join("sess-1.jsonl");
    let subagent_file = subagents_dir.join("agent-sub.jsonl");

    // Write > 96 KiB JSONL so `read_head_tail_slices` exercises both head and tail seeks.
    let mut buf = Vec::new();
    writeln!(
        buf,
        r#"{{"type":"user","cwd":"/home/user/repo","sessionId":"sess-1","timestamp":"2026-01-01T00:00:00Z","message":{{"role":"user","content":"Initial legacy prompt"}}}}"#
    )
    .expect("write head");
    let filler = "x".repeat(4096);
    for idx in 0..30 {
        writeln!(buf, r#"{{"type":"progress","seq":{idx},"pad":"{filler}"}}"#)
            .expect("write filler");
    }
    writeln!(
        buf,
        r#"{{"type":"custom-title","customTitle":"Legacy Renamed Title"}}"#
    )
    .expect("write tail title");

    std::fs::write(&main_file, &buf).expect("write main jsonl");
    std::fs::write(
        &subagent_file,
        r#"{"type":"user","sessionId":"agent-sub","message":{"role":"user","content":"Subagent prompt"}}"#,
    )
    .expect("write subagent jsonl");

    let expected_mtime = backdate_file(&main_file, 3600);

    assert!(is_rayu_cli_project_transcript_path(&main_file));
    // Direct collection must ignore `<uuid>/subagents/*.jsonl`.
    let files = collect_direct_jsonl_files(&project_dir);
    assert_eq!(files, vec![main_file.clone()]);

    let peeked =
        peek_claude_compatible_session_metadata(&main_file, &project_dir, "Rayu CLI session");
    assert_eq!(peeked.session_id, "sess-1");
    assert_eq!(peeked.first_prompt, "Initial legacy prompt");
    assert_eq!(peeked.summary.as_deref(), Some("Legacy Renamed Title"));
    assert_eq!(peeked.project_path.as_deref(), Some("/home/user/repo"));
    assert_eq!(peeked.full_path, main_file.to_string_lossy());

    // Confirm no mutation of transcript file.
    assert_eq!(std::fs::read(&main_file).expect("re-read"), buf);
    assert_eq!(mtime_of(&main_file), expected_mtime);

    // Also test `peek_unindexed_claude_compatible_sessions` honors scan_limit and dedup.
    let mut seen = HashSet::new();
    let batch =
        peek_unindexed_claude_compatible_sessions(std::slice::from_ref(&project_dir), &mut seen, 5);
    assert_eq!(batch.len(), 1);
    assert!(seen.contains("sess-1"));
}
