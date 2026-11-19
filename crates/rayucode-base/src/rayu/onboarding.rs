//! Persistent completion state for the pre-UI first-run onboarding wizard.
//!
//! Stored in `config_dir()/rayu-onboarding.json` so `rayucode-v2` never writes
//! to or mutates legacy `rayu-cli` `~/.rayu/config.json`.

use std::path::PathBuf;

use super::urls::config_dir;

const ONBOARDING_FILE: &str = "rayu-onboarding.json";
const LEGACY_CONFIG_FILE: &str = "config.json";
const ONBOARDING_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct OnboardingState {
    completed: bool,
    version: u32,
    #[serde(rename = "completedAt")]
    completed_at: i64,
}

#[derive(Debug, serde::Deserialize)]
struct LegacyOnboardingHint {
    #[serde(rename = "hasCompletedOnboarding", default)]
    has_completed_onboarding: bool,
}

fn onboarding_path() -> PathBuf {
    config_dir().join(ONBOARDING_FILE)
}

fn legacy_config_has_completed_onboarding() -> bool {
    let path = config_dir().join(LEGACY_CONFIG_FILE);
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    serde_json::from_str::<LegacyOnboardingHint>(&text)
        .map(|hint| hint.has_completed_onboarding)
        .unwrap_or(false)
}

/// Whether the user has already completed pre-UI first-run onboarding.
///
/// Returns `true` if `rayu-onboarding.json` records completion, OR (read-only
/// migration convenience) if legacy `config.json` already has
/// `"hasCompletedOnboarding": true` AND a usable Rayu credential exists.
pub fn has_completed_first_run_onboarding() -> bool {
    if let Ok(text) = std::fs::read_to_string(onboarding_path())
        && let Ok(state) = serde_json::from_str::<OnboardingState>(&text)
        && state.completed
    {
        return true;
    }
    legacy_config_has_completed_onboarding() && super::has_credentials()
}

/// Mark pre-UI first-run onboarding completed in `rayu-onboarding.json`.
pub fn mark_first_run_onboarding_completed() -> anyhow::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let state = OnboardingState {
        completed: true,
        version: ONBOARDING_SCHEMA_VERSION,
        completed_at: chrono::Utc::now().timestamp_millis(),
    };
    let text = serde_json::to_string_pretty(&state)?;
    let path = onboarding_path();
    let tmp_path = dir.join(format!(".{ONBOARDING_FILE}.tmp.{}", std::process::id()));
    std::fs::write(&tmp_path, text.as_bytes())?;
    if let Err(rename_err) = std::fs::rename(&tmp_path, &path) {
        if let Err(remove_err) = std::fs::remove_file(&tmp_path) {
            crate::logging::warn(&format!(
                "Could not remove temp onboarding file {}: {remove_err}",
                tmp_path.display()
            ));
        }
        return Err(rename_err.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rayu::test_support::RayuTestEnv;

    #[test]
    fn fresh_install_is_not_completed_until_marked() {
        let _env = RayuTestEnv::new();
        assert!(!has_completed_first_run_onboarding());
        mark_first_run_onboarding_completed().unwrap();
        assert!(has_completed_first_run_onboarding());
    }

    #[test]
    fn legacy_config_read_only_compat_requires_credentials_and_never_mutates_file() {
        let env = RayuTestEnv::new();
        let legacy_path = env.path().join(LEGACY_CONFIG_FILE);
        let original = r#"{"hasCompletedOnboarding": true, "theme": "dark"}"#;
        std::fs::write(&legacy_path, original).unwrap();

        // Without Rayu credentials, first-run is still required.
        assert!(!has_completed_first_run_onboarding());

        // With a valid Rayu API key present, legacy onboarded users skip Theme/Security.
        crate::env::set_var("RAYU_API_KEY", "rayu_sk_live_test_migration_key");
        assert!(has_completed_first_run_onboarding());
        assert_eq!(std::fs::read_to_string(&legacy_path).unwrap(), original);
        assert!(!env.path().join(ONBOARDING_FILE).exists());
    }
}
