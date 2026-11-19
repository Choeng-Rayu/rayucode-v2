//! Session-specific worker routing. A separate atomic metadata file permits
//! updates while a turn owns the agent mutex, without rewriting its transcript.
use super::Session;
use crate::config::AgentProfile;
use anyhow::{Result, bail};
use std::collections::BTreeMap;

pub type AgentModelOverrides = BTreeMap<String, String>;

// Serialize read-modify-write updates from multiple attached clients. This is
// metadata only and never waits for the agent's long-running turn lock.
static UPDATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn path(id: &str) -> Result<std::path::PathBuf> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id == ".." {
        bail!("Invalid session id");
    }
    // A distinct stem keeps this file's `.bak` (written by `write_json`) from
    // replacing the transcript snapshot backup at `<id>.bak`.
    Ok(super::storage_paths::session_path(id)?.with_file_name(format!("{id}.agent-models.meta")))
}

/// Read saved overrides. Unreadable metadata degrades to "no override" with a
/// warning, so a damaged preference never blocks transcript load or save.
fn read_saved(path: &std::path::Path) -> Option<AgentModelOverrides> {
    if !path.exists() {
        return None;
    }
    match crate::storage::read_json(path) {
        Ok(saved) => Some(saved),
        Err(err) => {
            crate::logging::warn(&format!(
                "Ignoring unreadable session agent-model overrides at {}: {err}",
                path.display()
            ));
            Some(AgentModelOverrides::new())
        }
    }
}

impl Session {
    /// Read a session's saved overrides from the sidecar file only, without
    /// parsing the (possibly huge) transcript snapshot.
    pub fn read_agent_model_overrides(id: &str) -> AgentModelOverrides {
        path(id)
            .ok()
            .and_then(|path| read_saved(&path))
            .unwrap_or_default()
    }

    /// Reload lock-independent routing metadata, including explicit clears.
    pub fn refresh_agent_model_overrides(&mut self) -> Result<()> {
        if let Some(saved) = read_saved(&path(&self.id)?) {
            self.agent_model_overrides = saved;
        }
        Ok(())
    }

    /// Persist a single preference without taking the live Agent lock.
    /// None uses the global default, while "inherit" bypasses that default.
    pub fn set_agent_model_override(&mut self, target: &str, model: Option<String>) -> Result<()> {
        let _guard = UPDATE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !matches!(target, "swarm" | "review" | "judge" | "memory" | "ambient") {
            bail!("Unknown agent model target: {target}");
        }
        self.refresh_agent_model_overrides()?;
        let mut overrides = self.agent_model_overrides.clone();
        match model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            Some(model) => {
                overrides.insert(target.to_string(), model);
            }
            None => {
                overrides.remove(target);
            }
        }
        crate::storage::write_json(&path(&self.id)?, &overrides)?;
        self.agent_model_overrides = overrides;
        Ok(())
    }

    /// Resolve session > global. "inherit" remains explicit for downstream
    /// routing, rather than becoming indistinguishable from use-global.
    /// A value naming an agent profile (`name` or `profile:name`) resolves to
    /// that profile's model, so every role target accepts profile names.
    pub fn effective_agent_model(&self, target: &str, global: Option<String>) -> Option<String> {
        let current = path(&self.id)
            .ok()
            .and_then(|path| read_saved(&path))
            .unwrap_or_else(|| self.agent_model_overrides.clone());
        let raw = current.get(target).cloned().or(global)?;
        Some(resolve_profile_reference(
            &self.effective_agent_profiles(),
            &raw,
        ))
    }

    /// Session profiles only (sidecar file), without global ones.
    pub fn session_agent_profiles(&self) -> Vec<AgentProfile> {
        Self::read_session_agent_profiles(&self.id)
    }

    pub fn read_session_agent_profiles(id: &str) -> Vec<AgentProfile> {
        let Ok(path) = profiles_path(id) else {
            return Vec::new();
        };
        if !path.exists() {
            return Vec::new();
        }
        match crate::storage::read_json::<Vec<AgentProfile>>(&path) {
            Ok(profiles) => profiles,
            Err(err) => {
                crate::logging::warn(&format!(
                    "Ignoring unreadable session agent profiles at {}: {err}",
                    path.display()
                ));
                Vec::new()
            }
        }
    }

    /// Global config profiles overlaid with this session's profiles.
    pub fn effective_agent_profiles(&self) -> Vec<AgentProfile> {
        effective_agent_profiles_for(&self.id)
    }

    /// Add or replace a session profile. Returns the normalized profile.
    pub fn upsert_session_agent_profile(&self, profile: AgentProfile) -> Result<AgentProfile> {
        let profile = normalize_profile(profile)?;
        let _guard = UPDATE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut profiles = self.session_agent_profiles();
        match profiles.iter_mut().find(|p| p.name == profile.name) {
            Some(existing) => *existing = profile.clone(),
            None => profiles.push(profile.clone()),
        }
        crate::storage::write_json(&profiles_path(&self.id)?, &profiles)?;
        Ok(profile)
    }

    /// Remove a session profile. Returns whether one was removed.
    pub fn remove_session_agent_profile(&self, name: &str) -> Result<bool> {
        let name = AgentProfile::normalize_name(name).map_err(anyhow::Error::msg)?;
        let _guard = UPDATE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut profiles = self.session_agent_profiles();
        let before = profiles.len();
        profiles.retain(|p| p.name != name);
        if profiles.len() == before {
            return Ok(false);
        }
        crate::storage::write_json(&profiles_path(&self.id)?, &profiles)?;
        Ok(true)
    }
}

fn profiles_path(id: &str) -> Result<std::path::PathBuf> {
    Ok(path(id)?.with_file_name(format!("{id}.agent-profiles.meta")))
}

/// Validate and normalize a user-supplied profile.
pub fn normalize_profile(profile: AgentProfile) -> Result<AgentProfile> {
    let name = AgentProfile::normalize_name(&profile.name).map_err(anyhow::Error::msg)?;
    let model = profile.model.trim().to_string();
    if model.is_empty() {
        bail!("Profile {name} needs a model");
    }
    let self_ref = model.strip_prefix("profile:").unwrap_or(&model).trim();
    if self_ref.eq_ignore_ascii_case(&name) {
        bail!("Profile {name} cannot point at itself");
    }
    Ok(AgentProfile {
        name,
        model,
        description: profile.description.trim().to_string(),
        effort: profile
            .effort
            .map(|e| e.trim().to_string())
            .filter(|e| !e.is_empty()),
    })
}

/// Global config profiles overlaid with a session's profiles, by session id.
/// Works without loading the transcript.
pub fn effective_agent_profiles_for(session_id: &str) -> Vec<AgentProfile> {
    let config = crate::config::config();
    crate::config::merge_agent_profiles([
        config.agents.profiles.as_slice(),
        Session::read_session_agent_profiles(session_id).as_slice(),
    ])
}

/// Map a profile reference to its model. Non-profile values pass through.
/// Explicit `profile:` prefixes that match nothing also pass through so the
/// caller reports the unknown model instead of silently inheriting.
pub fn resolve_profile_reference(profiles: &[AgentProfile], value: &str) -> String {
    crate::config::find_agent_profile(profiles, value)
        .map(|profile| profile.model.clone())
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_temp_home(f: impl FnOnce(&std::path::Path)) {
        let _lock = crate::storage::lock_test_env();
        let temp = tempfile::TempDir::new().unwrap();
        let previous = std::env::var_os("RAYU_HOME");
        crate::env::set_var("RAYU_HOME", temp.path());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(temp.path())));
        if let Some(previous) = previous {
            crate::env::set_var("RAYU_HOME", previous);
        } else {
            crate::env::remove_var("RAYU_HOME");
        }
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }

    #[test]
    fn override_writes_keep_transcript_backup_intact() {
        with_temp_home(|_| {
            let mut session = Session::create_with_id("bak_owner".into(), None, None);
            session.save_prepared().unwrap();
            let transcript_backup = super::super::storage_paths::session_path("bak_owner")
                .unwrap()
                .with_extension("bak");
            // Stand-in for the snapshot backup written by transcript saves.
            std::fs::write(&transcript_backup, b"transcript backup").unwrap();
            let before = std::fs::read(&transcript_backup).unwrap();
            for model in ["a", "b", "c"] {
                session
                    .set_agent_model_override("swarm", Some(model.into()))
                    .unwrap();
            }
            assert_eq!(
                std::fs::read(&transcript_backup).unwrap(),
                before,
                "override writes must not replace the transcript backup"
            );
            assert!(
                path("bak_owner").unwrap().with_extension("bak").exists(),
                "override file keeps its own backup"
            );
        });
    }

    #[test]
    fn session_profiles_override_global_and_resolve_role_targets() {
        with_temp_home(|home| {
            std::fs::write(
                home.join("config.toml"),
                "[agents]\nswarm_model = \"coder\"\n[[agents.profiles]]\nname = \"coder\"\nmodel = \"claude:global-sonnet\"\n\n[autoreview]\nmodel = \"profile:reviewer\"\n",
            )
            .unwrap();
            crate::config::Config::invalidate_cache();
            let mut session = Session::create_with_id("prof".into(), None, None);
            session.save_prepared().unwrap();
            let global = crate::config::Config::load();
            // Global default naming a profile resolves to its model.
            assert_eq!(
                session
                    .effective_agent_model("swarm", global.agents.swarm_model.clone())
                    .as_deref(),
                Some("claude:global-sonnet")
            );
            // Session profile overrides the global one with the same name.
            session
                .upsert_session_agent_profile(AgentProfile {
                    name: "Coder".into(),
                    model: "openai:gpt-session-future".into(),
                    ..Default::default()
                })
                .unwrap();
            assert_eq!(
                session
                    .effective_agent_model("swarm", global.agents.swarm_model.clone())
                    .as_deref(),
                Some("openai:gpt-session-future")
            );
            // Unknown `profile:` reference passes through for callers to report.
            assert_eq!(
                session
                    .effective_agent_model("review", global.autoreview.model.clone())
                    .as_deref(),
                Some("profile:reviewer")
            );
            session
                .upsert_session_agent_profile(AgentProfile {
                    name: "reviewer".into(),
                    model: "gemini:review-model".into(),
                    ..Default::default()
                })
                .unwrap();
            session
                .set_agent_model_override("judge", Some("reviewer".into()))
                .unwrap();
            assert_eq!(
                session.effective_agent_model("judge", None).as_deref(),
                Some("gemini:review-model")
            );
            // Profiles survive reload, and removal restores the global layer.
            let reloaded = Session::load("prof").unwrap();
            assert_eq!(reloaded.session_agent_profiles().len(), 2);
            assert!(reloaded.remove_session_agent_profile("coder").unwrap());
            assert!(!reloaded.remove_session_agent_profile("coder").unwrap());
            assert_eq!(
                reloaded
                    .effective_agent_model("swarm", global.agents.swarm_model)
                    .as_deref(),
                Some("claude:global-sonnet")
            );
            assert!(
                reloaded
                    .upsert_session_agent_profile(AgentProfile {
                        name: "loop".into(),
                        model: "profile:loop".into(),
                        ..Default::default()
                    })
                    .is_err()
            );
            crate::config::Config::invalidate_cache();
        });
    }

    #[test]
    fn corrupt_override_file_without_backup_does_not_block_session() {
        with_temp_home(|_| {
            let mut session = Session::create_with_id("corrupt_meta".into(), None, None);
            session.save_prepared().unwrap();
            let meta = path("corrupt_meta").unwrap();
            std::fs::write(&meta, b"{ not json").unwrap();
            let _ = std::fs::remove_file(meta.with_extension("bak"));

            let mut loaded = Session::load("corrupt_meta").expect("load must not fail");
            assert!(loaded.agent_model_overrides.is_empty());
            assert!(Session::load_startup_stub("corrupt_meta").is_ok());
            assert!(Session::load_for_remote_startup("corrupt_meta").is_ok());
            loaded.save_prepared().expect("save must not fail");
            assert_eq!(
                loaded.effective_agent_model("swarm", Some("global".into())),
                Some("global".into())
            );
            // An explicit write replaces the damaged file.
            loaded
                .set_agent_model_override("swarm", Some("fresh".into()))
                .unwrap();
            assert_eq!(
                Session::load("corrupt_meta")
                    .unwrap()
                    .agent_model_overrides
                    .get("swarm")
                    .map(String::as_str),
                Some("fresh")
            );
        });
    }

    #[test]
    fn session_agent_models_isolate_clear_inherit_and_resume() {
        let _lock = crate::storage::lock_test_env();
        let temp = tempfile::TempDir::new().unwrap();
        let previous = std::env::var_os("RAYU_HOME");
        crate::env::set_var("RAYU_HOME", temp.path());
        let mut first = Session::create_with_id("first".into(), None, None);
        let mut second = Session::create_with_id("second".into(), None, None);
        first.save_prepared().unwrap();
        second.save_prepared().unwrap();
        let stale = Session::load_startup_stub("first").unwrap();
        let config_path = temp.path().join("config.toml");
        std::fs::write(&config_path, "[agents]\nswarm_model = \"global-model\"\n").unwrap();
        let before = std::fs::read(&config_path).unwrap();
        first
            .set_agent_model_override("swarm", Some("session-model".into()))
            .unwrap();
        assert_eq!(
            first
                .effective_agent_model("swarm", Some("global-model".into()))
                .as_deref(),
            Some("session-model")
        );
        assert_eq!(
            second
                .effective_agent_model("swarm", Some("global-model".into()))
                .as_deref(),
            Some("global-model")
        );
        assert_eq!(
            stale.effective_agent_model("swarm", None).as_deref(),
            Some("session-model")
        );
        for restored in [
            Session::load("first").unwrap(),
            Session::load_startup_stub("first").unwrap(),
            Session::load_for_remote_startup("first").unwrap(),
        ] {
            assert_eq!(
                restored
                    .agent_model_overrides
                    .get("swarm")
                    .map(String::as_str),
                Some("session-model")
            );
        }
        first
            .set_agent_model_override("swarm", Some("inherit".into()))
            .unwrap();
        assert_eq!(
            first
                .effective_agent_model("swarm", Some("global-model".into()))
                .as_deref(),
            Some("inherit")
        );
        first.set_agent_model_override("swarm", None).unwrap();
        assert_eq!(
            first
                .effective_agent_model("swarm", Some("new-global".into()))
                .as_deref(),
            Some("new-global")
        );
        // A stale turn saving after an out-of-band clear cannot revive its pin.
        let mut stale = stale;
        stale
            .agent_model_overrides
            .insert("swarm".into(), "old-pin".into());
        stale.save_prepared().unwrap();
        assert!(
            Session::load_startup_stub("first")
                .unwrap()
                .agent_model_overrides
                .is_empty()
        );
        assert_eq!(std::fs::read(&config_path).unwrap(), before);
        assert!(
            first
                .set_agent_model_override("invalid", Some("model".into()))
                .is_err()
        );
        if let Some(previous) = previous {
            crate::env::set_var("RAYU_HOME", previous);
        } else {
            crate::env::remove_var("RAYU_HOME");
        }
    }
}
