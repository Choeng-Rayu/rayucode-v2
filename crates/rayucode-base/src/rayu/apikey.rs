//! Rayu API-key credential (`RAYU_API_KEY`, `rayu_sk_live_…` prefix).
//!
//! The key is an alternative to the account session for gateway inference.
//! Validation is fail-open: a gateway outage, an offline laptop or a timeout
//! must never look like a bad key, so only a definitive 401 records an
//! `invalid` verdict; `unavailable` leaves any previous verdict alone.
//!
//! The verdict cache stores a truncated SHA-256 fingerprint, never the key.

use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use super::RAYU_API_KEY_ENV;
use super::urls::{config_dir, gateway_base};

const STATE_FILE: &str = "rayu-apikey-state.json";
const ENV_FILE: &str = "rayu.env";
pub(super) const KEY_PREFIX: &str = "rayu_sk_live_";

static VALIDATED_FINGERPRINT: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn reset_validated_cache() {
    let lock = VALIDATED_FINGERPRINT.get_or_init(|| Mutex::new(None));
    let mut guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = None;
}

fn sanitize_env_value(raw: &str) -> &str {
    raw.trim().trim_matches('"').trim_matches('\'').trim()
}

fn read_api_key_from_env_file() -> Option<String> {
    let config_dir = match crate::storage::app_config_dir() {
        Ok(dir) => dir,
        Err(_) => return None,
    };
    let path = config_dir.join(ENV_FILE);
    crate::storage::harden_secret_file_permissions(&path);
    let content = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(_) => return None,
    };
    let prefix = format!("{RAYU_API_KEY_ENV}=");
    for line in content.lines() {
        if let Some(raw) = line.strip_prefix(&prefix) {
            let candidate = sanitize_env_value(raw);
            if candidate.starts_with(KEY_PREFIX) {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn read_api_key_from_providers_json() -> Option<String> {
    crate::legacy_compat::LegacyProvidersConfig::load()
        .and_then(|cfg| cfg.rayu_api_key().map(ToString::to_string))
}

/// Resolve the configured Rayu API key (`rayu_sk_live_…` prefix only):
/// 1. `RAYU_API_KEY` process env var (non-empty)
/// 2. `~/.config/rayucode/rayu.env` (via `app_config_dir()`)
/// 3. Read-only fallback from `config_dir()/providers.json` (`id == "rayu"`)
pub fn configured_api_key() -> Option<String> {
    if let Ok(raw) = std::env::var(RAYU_API_KEY_ENV) {
        let value = sanitize_env_value(&raw);
        if !value.is_empty() {
            return value.starts_with(KEY_PREFIX).then(|| value.to_string());
        }
    }
    if let Some(key) = read_api_key_from_env_file() {
        return Some(key);
    }
    read_api_key_from_providers_json()
}

/// Whether any syntactically valid `RAYU_API_KEY` is configured on disk or env.
pub fn has_api_key() -> bool {
    configured_api_key().is_some()
}

/// Persist `RAYU_API_KEY` to `app_config_dir()/rayu.env` with `0600` permissions.
/// Never writes to `providers.json`.
pub fn save_api_key(key: &str) -> anyhow::Result<PathBuf> {
    let trimmed = sanitize_env_value(key);
    if !trimmed.starts_with(KEY_PREFIX) {
        anyhow::bail!("Rayu API keys start with '{}'.", KEY_PREFIX);
    }
    let path = crate::storage::app_config_dir()?.join(ENV_FILE);
    crate::storage::upsert_env_file_value(&path, RAYU_API_KEY_ENV, Some(trimmed))?;
    reset_validated_cache();
    Ok(path)
}

/// Remove a persisted `RAYU_API_KEY` from `app_config_dir()/rayu.env` and forget
/// any cached verdict. Never modifies `providers.json`.
pub fn clear_saved_api_key() -> anyhow::Result<()> {
    reset_validated_cache();
    clear_apikey_state();
    if let Ok(config_dir) = crate::storage::app_config_dir() {
        let path = config_dir.join(ENV_FILE);
        if path.exists() {
            crate::storage::upsert_env_file_value(&path, RAYU_API_KEY_ENV, None)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiKeyVerdict {
    Valid,
    Invalid,
    /// Key authenticated, but period and top-up credit balances are exhausted.
    NoCredit,
    /// The gateway could not be reached or did not give a definitive answer.
    /// Fail open: carry on, and keep any previously recorded verdict.
    Unavailable,
}

/// Validate a key against `GET {gateway}/v1/credits` and record the verdict.
/// 200 (spendable) → Valid, 200 (0 remaining & 0 topup) → NoCredit, 401 → Invalid,
/// anything else (offline, 403, 5xx, …) → Unavailable (fail open).
pub async fn validate_api_key(key: &str) -> ApiKeyVerdict {
    let key = key.trim();
    if key.is_empty() {
        return ApiKeyVerdict::Invalid;
    }
    let response = super::http_client()
        .get(format!("{}/v1/credits", gateway_base()))
        .bearer_auth(key)
        .header("x-rayu-client", super::client_product())
        .send()
        .await;
    let Ok(response) = response else {
        // Offline/timeout: fail open, keep any previous verdict.
        return ApiKeyVerdict::Unavailable;
    };
    let status = response.status();
    if status.is_success() {
        match response.json::<super::api::RayuCredits>().await {
            Ok(credits) => {
                let plan_name =
                    (!credits.plan_name.is_empty()).then_some(credits.plan_name.clone());
                if credits.has_spendable_credits() {
                    record_verdict(key, "valid", plan_name);
                    ApiKeyVerdict::Valid
                } else {
                    record_verdict(key, "no-credit", plan_name);
                    ApiKeyVerdict::NoCredit
                }
            }
            Err(_) => {
                record_verdict(key, "valid", None);
                ApiKeyVerdict::Valid
            }
        }
    } else if status.as_u16() == 401 {
        let (_, _, _, body) = super::error::read_http_error_parts(response).await;
        crate::logging::warn(&format!(
            "Rayu API key validation rejected (HTTP 401): {}",
            crate::util::truncate_str(body.trim(), 200)
        ));
        record_verdict(key, "invalid", None);
        ApiKeyVerdict::Invalid
    } else {
        // 403/429/5xx / proxy errors are not a verdict on the key. Fail open.
        let (code, _, _, body) = super::error::read_http_error_parts(response).await;
        crate::logging::warn(&format!(
            "Rayu API key validation unavailable (HTTP {code}): {}",
            crate::util::truncate_str(body.trim(), 200)
        ));
        ApiKeyVerdict::Unavailable
    }
}

/// User-facing guidance for a non-Valid verdict, or `None` when usable.
pub fn api_key_verdict_message(verdict: ApiKeyVerdict) -> Option<&'static str> {
    match verdict {
        ApiKeyVerdict::Valid => None,
        ApiKeyVerdict::Invalid => Some(
            "That Rayu API key was rejected (revoked, expired, or mistyped). Create a new key at https://rayucode.com/dashboard/api-keys.",
        ),
        ApiKeyVerdict::NoCredit => Some(
            "No credits remain on this Rayu API key. Top up or check key limits at https://rayucode.com/dashboard/api-keys, or enter a different key.",
        ),
        ApiKeyVerdict::Unavailable => Some(
            "Could not reach the Rayu gateway to verify this key. Check your connection and try again.",
        ),
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ApiKeyState {
    fingerprint: String,
    verdict: String,
    #[serde(rename = "checkedAt")]
    checked_at: i64,
    #[serde(rename = "planName", default, skip_serializing_if = "Option::is_none")]
    plan_name: Option<String>,
}

fn state_path() -> PathBuf {
    config_dir().join(STATE_FILE)
}

/// Non-reversible, change-detecting fingerprint: sha256(key)[0:16] hex.
/// Truncated deliberately — the full digest is the gateway's lookup key.
fn fingerprint(key: &str) -> String {
    let digest = Sha256::digest(key.trim().as_bytes());
    hex::encode(digest)[..16].to_string()
}

fn record_verdict(key: &str, verdict: &str, plan_name: Option<String>) {
    let state = ApiKeyState {
        fingerprint: fingerprint(key),
        verdict: verdict.to_string(),
        checked_at: chrono::Utc::now().timestamp_millis(),
        plan_name,
    };
    let Ok(text) = serde_json::to_string_pretty(&state) else {
        return;
    };
    let path = state_path();
    if let Some(parent) = path.parent()
        && let Err(err) = std::fs::create_dir_all(parent)
    {
        crate::logging::warn(&format!("Could not create {}: {err}", parent.display()));
        return;
    }
    if let Err(err) = super::session::write_owner_only(&path, text.as_bytes()) {
        crate::logging::warn(&format!("Could not write {}: {err}", path.display()));
    }
}

fn read_state_for_key(key: &str) -> Option<ApiKeyState> {
    let text = match std::fs::read_to_string(state_path()) {
        Ok(text) => text,
        Err(_) => return None,
    };
    let state: ApiKeyState = match serde_json::from_str(&text) {
        Ok(state) => state,
        Err(_) => return None,
    };
    (state.fingerprint == fingerprint(key)).then_some(state)
}

/// Whether the configured `RAYU_API_KEY` is usable (absent cached verdict or
/// `valid`; cached `invalid` / `no-credit` for the active key returns `false`).
pub fn has_validated_api_key() -> bool {
    let Some(key) = configured_api_key() else {
        return false;
    };
    let Some(state) = read_state_for_key(&key) else {
        return true;
    };
    !matches!(state.verdict.as_str(), "invalid" | "no-credit")
}

/// Returns `Some(Invalid | NoCredit)` when an API-key-only user has a cached
/// failed verdict for their currently active `RAYU_API_KEY`.
pub fn relaunch_api_key_issue() -> Option<ApiKeyVerdict> {
    if super::has_usable_session() {
        return None;
    }
    let key = configured_api_key()?;
    let state = read_state_for_key(&key)?;
    match state.verdict.as_str() {
        "invalid" => Some(ApiKeyVerdict::Invalid),
        "no-credit" => Some(ApiKeyVerdict::NoCredit),
        _ => None,
    }
}

/// Re-validate a configured `RAYU_API_KEY` once per key per process at launch
/// (for API-key-only users, since an account JWT takes precedence when present).
pub async fn ensure_api_key_validated_once() -> Option<ApiKeyVerdict> {
    if super::has_usable_session() {
        return None;
    }
    let key = configured_api_key()?;
    let fp = fingerprint(&key);
    {
        let lock = VALIDATED_FINGERPRINT.get_or_init(|| Mutex::new(None));
        let guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.as_deref() == Some(fp.as_str()) {
            return relaunch_api_key_issue();
        }
    }
    let verdict = validate_api_key(&key).await;
    {
        let lock = VALIDATED_FINGERPRINT.get_or_init(|| Mutex::new(None));
        let mut guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = Some(fp);
    }
    matches!(verdict, ApiKeyVerdict::Invalid | ApiKeyVerdict::NoCredit).then_some(verdict)
}

/// The recorded verdict for any key, if present.
#[cfg(test)]
fn read_state() -> Option<ApiKeyState> {
    let text = std::fs::read_to_string(state_path()).ok()?;
    serde_json::from_str(&text).ok()
}

/// Forget any recorded verdict (logout, or a credential change).
pub fn clear_apikey_state() {
    reset_validated_cache();
    let path = state_path();
    if let Err(err) = std::fs::remove_file(&path)
        && err.kind() != std::io::ErrorKind::NotFound
    {
        crate::logging::warn(&format!("Could not remove {}: {err}", path.display()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_prefixed_env_keys_are_configured() {
        let env = super::super::test_support::RayuTestEnv::new();
        assert!(!has_api_key());

        crate::env::set_var(RAYU_API_KEY_ENV, "rayu_sk_live_test_key");
        assert_eq!(
            configured_api_key().as_deref(),
            Some("rayu_sk_live_test_key")
        );
        assert!(has_api_key());

        crate::env::set_var(RAYU_API_KEY_ENV, "  rayu_sk_live_padded  ");
        assert_eq!(configured_api_key().as_deref(), Some("rayu_sk_live_padded"));

        crate::env::set_var(RAYU_API_KEY_ENV, "sk-some-other-provider");
        assert!(!has_api_key());
        crate::env::set_var(RAYU_API_KEY_ENV, "");
        assert!(!has_api_key());
        drop(env);
    }

    #[test]
    fn fingerprint_is_truncated_sha256_and_never_the_key() {
        let fp = fingerprint("rayu_sk_live_secret");
        assert_eq!(fp.len(), 16);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
        let expected = hex::encode(Sha256::digest(b"rayu_sk_live_secret"));
        assert_eq!(fp, &expected[..16]);
        assert_ne!(fingerprint("rayu_sk_live_a"), fingerprint("rayu_sk_live_b"));
    }

    #[test]
    fn verdict_record_round_trips_and_clears() {
        let env = super::super::test_support::RayuTestEnv::new();
        record_verdict("rayu_sk_live_x", "valid", Some("Pro".into()));
        let state = read_state().unwrap();
        assert_eq!(state.fingerprint, fingerprint("rayu_sk_live_x"));
        assert_eq!(state.verdict, "valid");
        assert_eq!(state.plan_name.as_deref(), Some("Pro"));
        assert!(state.checked_at > 0);

        let text = std::fs::read_to_string(env.path().join(STATE_FILE)).unwrap();
        assert!(text.contains("\"checkedAt\""));
        assert!(text.contains("\"planName\""));
        assert!(!text.contains("rayu_sk_live_x"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(env.path().join(STATE_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        clear_apikey_state();
        assert!(read_state().is_none());
    }
}
