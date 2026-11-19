//! The Rayu account session, shared byte-for-byte with rayu-cli.
//!
//! Persisted to `config_dir()/rayu-auth.json` with 0600 permissions and never
//! logged. The on-disk shape is the TS CLI's `RayuSessionStore`: camelCase
//! keys, `expiresAt` as epoch milliseconds, numeric `user.id`, pretty-printed
//! with two-space indentation and no trailing newline. Both CLIs read and
//! write the same file, so a login in one is a login in the other.

use std::path::PathBuf;

use super::urls::config_dir;

const SESSION_FILE: &str = "rayu-auth.json";
/// Refresh this many milliseconds before the access token actually expires.
pub(super) const REFRESH_SKEW_MS: i64 = 60 * 1000;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RayuSessionUser {
    pub id: i64,
    pub email: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    pub role: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RayuSession {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    /// Absolute expiry of `access_token` (epoch ms).
    #[serde(rename = "expiresAt")]
    pub expires_at: i64,
    pub user: RayuSessionUser,
}

pub(super) fn session_path() -> PathBuf {
    config_dir().join(SESSION_FILE)
}

pub(super) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// True when the access token is expired or within the proactive refresh skew.
pub(super) fn is_access_token_expired(session: &RayuSession, now: i64) -> bool {
    now >= session.expires_at - REFRESH_SKEW_MS
}

pub fn read_session() -> Option<RayuSession> {
    let text = std::fs::read_to_string(session_path()).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_session(session: &RayuSession) -> anyhow::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let path = session_path();
    // Match rayu-cli's JSON.stringify(store, null, 2): two-space indent, no
    // trailing newline, nulls kept so both writers produce identical bytes.
    let text = serde_json::to_string_pretty(session)?;
    write_owner_only(&path, text.as_bytes())?;
    Ok(())
}

/// Write a secret file owner-only (0600), creating or truncating it.
pub(super) fn write_owner_only(path: &std::path::Path, bytes: &[u8]) -> anyhow::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all().ok();
    drop(file);
    // Re-harden even when the file pre-existed with looser permissions.
    crate::storage::harden_secret_file_permissions(path);
    Ok(())
}

pub fn clear_session() {
    let _ = std::fs::remove_file(session_path());
}

/// True when the stored session can authenticate now, or can renew itself.
///
/// An expired access token WITH a refresh token is usable: the next call
/// renews it. A dead file (expired, no refresh token) is not, so the login
/// gate never traps the user in an auth error only /logout could escape.
pub fn has_usable_session() -> bool {
    let Some(session) = read_session() else {
        return false;
    };
    if session.access_token.is_empty() {
        return false;
    }
    if !is_access_token_expired(&session, now_ms()) {
        return true;
    }
    !session.refresh_token.is_empty()
}

/// Sign out: remove the session, the API-key verdict record, and every cached
/// artifact that belongs to the signed-in account, so nothing leaks into the
/// next account's view. Best-effort per artifact; the session removal is the
/// one hard guarantee.
pub fn logout() -> anyhow::Result<()> {
    clear_session();
    if let Err(err) = super::apikey::clear_saved_api_key() {
        crate::logging::warn(&format!(
            "Could not clear saved Rayu API key during logout: {err}"
        ));
    }
    // Account-scoped caches in the shared Rayu config dir.
    let dir = config_dir();
    for name in ["rayu-entitlements.json", "rayu-feature-usage.json"] {
        let _ = std::fs::remove_file(dir.join(name));
    }
    // The endpoint-scoped hosted model catalog caches (namespace "rayu").
    // The runtime persists one `rayu_models_<endpoint-hash>.json` per
    // endpoint/route; every one of them belongs to the signed-in account and
    // must not survive into the next account's session.
    if let Ok(rayu_dir) = crate::storage::rayu_dir() {
        let prefix = format!("{}_models_", super::RAYU_CACHE_NAMESPACE);
        if let Ok(entries) = std::fs::read_dir(rayu_dir.join("cache")) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with(&prefix) && name.ends_with(".json") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    crate::auth::AuthStatus::invalidate_cache();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> RayuSession {
        RayuSession {
            access_token: "access-token-value".into(),
            refresh_token: "refresh-token-value".into(),
            expires_at: now_ms() + 3_600_000,
            user: RayuSessionUser {
                id: 42,
                email: Some("user@example.invalid".into()),
                display_name: Some("Test User".into()),
                avatar_url: None,
                role: "user".into(),
            },
        }
    }

    fn sandbox() -> crate::rayu::test_support::RayuTestEnv {
        crate::rayu::test_support::RayuTestEnv::new()
    }

    #[test]
    fn session_file_matches_rayu_cli_shape_and_permissions() {
        let env = sandbox();
        let store = session();
        write_session(&store).unwrap();

        let path = env.path().join("rayu-auth.json");
        let text = std::fs::read_to_string(&path).unwrap();
        // Byte-compatible with JSON.stringify(store, null, 2): camelCase keys,
        // epoch-ms expiresAt, numeric id, nulls kept, no trailing newline.
        let expected = format!(
            "{{\n  \"accessToken\": \"access-token-value\",\n  \"refreshToken\": \"refresh-token-value\",\n  \"expiresAt\": {},\n  \"user\": {{\n    \"id\": 42,\n    \"email\": \"user@example.invalid\",\n    \"displayName\": \"Test User\",\n    \"avatarUrl\": null,\n    \"role\": \"user\"\n  }}\n}}",
            store.expires_at
        );
        assert_eq!(text, expected);
        assert!(!text.ends_with('\n'));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "session file must be owner-only");
        }

        let read = read_session().unwrap();
        assert_eq!(read.access_token, store.access_token);
        assert_eq!(read.expires_at, store.expires_at);
        assert_eq!(read.user.id, 42);
        assert_eq!(read.user.display_name.as_deref(), Some("Test User"));
        assert!(read.user.avatar_url.is_none());
    }

    #[test]
    fn write_rehardens_a_preexisting_loose_file() {
        let env = sandbox();
        let path = env.path().join("rayu-auth.json");
        std::fs::write(&path, "{}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        write_session(&session()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn usable_session_covers_fresh_expired_with_refresh_and_dead_states() {
        let _env = sandbox();
        assert!(!has_usable_session());

        let mut store = session();
        write_session(&store).unwrap();
        assert!(has_usable_session());

        // Expired but renewable.
        store.expires_at = now_ms() - 1_000;
        write_session(&store).unwrap();
        assert!(has_usable_session());

        // Inside the proactive skew still counts as needing refresh, but the
        // refresh token keeps it usable.
        store.expires_at = now_ms() + REFRESH_SKEW_MS - 1;
        write_session(&store).unwrap();
        assert!(has_usable_session());

        // Dead: expired and no refresh token.
        store.refresh_token = String::new();
        write_session(&store).unwrap();
        assert!(!has_usable_session());

        // Empty access token is never usable.
        store.access_token = String::new();
        store.refresh_token = "present".into();
        store.expires_at = now_ms() + 3_600_000;
        write_session(&store).unwrap();
        assert!(!has_usable_session());
    }

    #[test]
    fn malformed_session_file_reads_as_absent() {
        let env = sandbox();
        std::fs::write(env.path().join("rayu-auth.json"), "not json").unwrap();
        assert!(read_session().is_none());
        assert!(!has_usable_session());
    }

    #[test]
    fn logout_removes_session_apikey_state_and_account_caches() {
        let env = sandbox();
        write_session(&session()).unwrap();
        let dir = env.path();
        std::fs::write(dir.join("rayu-apikey-state.json"), "{}").unwrap();
        std::fs::write(dir.join("rayu-entitlements.json"), "{}").unwrap();
        let rayu_home = dir.join("rayu-home");
        std::fs::create_dir_all(rayu_home.join("cache")).unwrap();
        // The runtime's real endpoint-scoped cache file names.
        std::fs::write(
            rayu_home.join("cache/rayu_models_0123456789abcdef.json"),
            "{}",
        )
        .unwrap();
        std::fs::write(
            rayu_home.join("cache/rayu_models_fedcba9876543210.json"),
            "{}",
        )
        .unwrap();
        // An unrelated provider's cache must survive logout.
        std::fs::write(rayu_home.join("cache/openrouter_models.json"), "{}").unwrap();
        let prev_home = std::env::var_os("RAYU_HOME");
        crate::env::set_var("RAYU_HOME", &rayu_home);

        logout().unwrap();

        assert!(!dir.join("rayu-auth.json").exists());
        assert!(!dir.join("rayu-apikey-state.json").exists());
        assert!(!dir.join("rayu-entitlements.json").exists());
        assert!(
            !rayu_home
                .join("cache/rayu_models_0123456789abcdef.json")
                .exists()
        );
        assert!(
            !rayu_home
                .join("cache/rayu_models_fedcba9876543210.json")
                .exists()
        );
        assert!(rayu_home.join("cache/openrouter_models.json").exists());
        assert!(read_session().is_none());

        match prev_home {
            Some(value) => crate::env::set_var("RAYU_HOME", value),
            None => crate::env::remove_var("RAYU_HOME"),
        }
    }
}
