//! Rayu (RayuCode) account authentication for rayu.
//!
//! Replaces the legacy subscription machinery. Two alternative credentials
//! unlock the hosted gateway:
//! - an account session (`~/.rayu/rayu-auth.json`, shared byte-for-byte with
//!   rayu-cli) obtained through the loopback browser login and renewed via
//!   `POST {api}/cli/refresh`;
//! - a `RAYU_API_KEY` (`rayu_sk_live_…`) for key-only users.
//!
//! The account JWT wins whenever both exist. Chat traffic rides
//! `POST {gateway}/anthropic/v1/messages` (the provider runtime owns that
//! wire); this module owns credentials, account reads, and entitlements.

pub const RAYU_PROVIDER_DISPLAY_NAME: &str = "Rayu";
pub const RAYU_ROUTE_API_METHOD: &str = "rayu";
pub const RAYU_API_KEY_ENV: &str = "RAYU_API_KEY";
pub const RAYU_CACHE_NAMESPACE: &str = "rayu";

mod api;
mod apikey;
mod login;
mod onboarding;
mod refresh;
mod session;
mod urls;

pub use api::{
    RayuApiKeyLimits, RayuCredits, RayuEntitlements, RayuMe, RayuModelEntry, fetch_credits,
    fetch_entitlements, fetch_me, gateway_credential, has_credentials,
};
pub use apikey::{
    ApiKeyVerdict, api_key_verdict_message, clear_apikey_state, clear_saved_api_key,
    configured_api_key, ensure_api_key_validated_once, has_api_key, has_validated_api_key,
    relaunch_api_key_issue, save_api_key, validate_api_key,
};
pub use login::{PreparedRayuLogin, RayuLoginOptions, exchange_callback_url, login};
pub use onboarding::{has_completed_first_run_onboarding, mark_first_run_onboarding_completed};
pub(crate) use refresh::telegram_access_token;
pub use refresh::{access_token, refresh_access_token};
pub use session::{
    RayuSession, RayuSessionUser, clear_session, has_usable_session, logout, read_session,
    write_session,
};
pub use urls::{account_url, api_base, config_dir, gateway_base, pricing_url, web_base};

/// Whether first-install / pre-provider Rayu authentication enforcement is active.
///
/// Honors `USE_RAYU_OAUTH`: `0`/`false`/`off`/`no` disables; `1`/`true`/`yes`/`on`
/// enables. Defaults to `true` in production binaries and integration tests, and
/// is never silently bypassed merely because `RAYU_HOME` or `RAYU_CONFIG_DIR` is
/// set. Under `#[cfg(test)]` unit tests default to `false` unless `USE_RAYU_OAUTH`
/// is explicitly enabled.
pub fn auth_gate_enabled() -> bool {
    if let Some(raw) = std::env::var_os("USE_RAYU_OAUTH") {
        let value = raw.to_string_lossy().trim().to_ascii_lowercase();
        match value.as_str() {
            "0" | "false" | "no" | "off" => return false,
            "1" | "true" | "yes" | "on" => return true,
            _ => {}
        }
    }
    !crate::auth::running_in_test_harness()
}

/// Whether the Rayu auth gate currently blocks third-party providers and turns.
pub fn auth_gate_active() -> bool {
    auth_gate_enabled() && !has_credentials()
}

/// Clear guidance shown whenever a command, provider choice, or turn is gated
/// on Rayu authentication.
pub fn auth_gate_error_message() -> &'static str {
    "Rayu authentication required before using Rayu or third-party providers. Run 'rayu login --provider rayu' (or '/login rayu' in TUI), or set RAYU_API_KEY."
}

/// Returns `Err` with actionable sign-in instructions when [`auth_gate_active`]
/// is true.
pub fn require_auth_gate() -> anyhow::Result<()> {
    if auth_gate_active() {
        anyhow::bail!("{}", auth_gate_error_message());
    }
    Ok(())
}

/// Shared HTTP client for every Rayu call: bounded, and never follows a
/// redirect — a bearer credential must not be forwarded to another origin.
pub(super) fn http_client() -> reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let builder =
                reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(10));
            // Test mocks live on loopback; never route them through an
            // ambient proxy another test may have configured.
            #[cfg(test)]
            let builder = builder.no_proxy();
            builder
                .timeout(std::time::Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("Rayu HTTP client")
        })
        .clone()
}

#[cfg(test)]
mod tests;

/// Env-sandboxed fixture for Rayu tests: serializes against every other
/// env-mutating test in the crate and points the Rayu config dir at a temp
/// directory, restoring all touched variables on drop.
#[cfg(test)]
pub(super) mod test_support {
    use std::path::Path;

    const KEYS: &[&str] = &[
        "RAYU_AUTH_CONFIG_DIR",
        "RAYU_HOME",
        "RAYU_CONFIG_DIR",
        "RAYU_API_URL",
        "RAYU_WEB_URL",
        "RAYU_GATEWAY_URL",
        "RAYU_API_KEY",
        "USE_RAYU_OAUTH",
    ];

    pub struct RayuTestEnv {
        _lock: std::sync::MutexGuard<'static, ()>,
        dir: tempfile::TempDir,
        saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl RayuTestEnv {
        pub fn new() -> Self {
            let lock = crate::storage::lock_test_env();
            let dir = tempfile::tempdir().expect("temp dir");
            let saved = KEYS
                .iter()
                .map(|key| (*key, std::env::var_os(key)))
                .collect();
            for key in KEYS {
                crate::env::remove_var(key);
            }
            crate::env::set_var("RAYU_AUTH_CONFIG_DIR", dir.path());
            crate::env::set_var("RAYU_HOME", dir.path());
            Self {
                _lock: lock,
                dir,
                saved,
            }
        }

        pub fn path(&self) -> &Path {
            self.dir.path()
        }
    }

    impl Drop for RayuTestEnv {
        fn drop(&mut self) {
            for (key, value) in self.saved.drain(..) {
                match value {
                    Some(value) => crate::env::set_var(key, value),
                    None => crate::env::remove_var(key),
                }
            }
        }
    }
}
