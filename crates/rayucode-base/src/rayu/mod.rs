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
pub const RAYU_FALLBACK_MODEL_ENV: &str = "RAYU_FALLBACK_MODEL";
pub const RAYU_CLIENT_PRODUCT_ENV: &str = "RAYU_CLIENT_PRODUCT";
pub const RAYU_CACHE_NAMESPACE: &str = "rayu";

/// Resolve the `X-Rayu-Client` product header sent to the Rayu gateway.
///
/// Mirrors `rayu-gateway-rust`'s `auth::request_attribution` (`cli`, `rayucode`,
/// `studio`, `api`) and legacy `rayu-cli`'s `resolveRayuClientProduct`: defaults
/// to `"cli"` for terminal usage and honors `RAYU_CLIENT_PRODUCT` when spawned
/// by VS Code (`rayucode`) or Desktop (`studio`).
pub fn client_product() -> &'static str {
    let Ok(raw) = std::env::var(RAYU_CLIENT_PRODUCT_ENV) else {
        return "cli";
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "rayucode" => "rayucode",
        "studio" => "studio",
        "api" => "api",
        _ => "cli",
    }
}

mod api;
mod apikey;
mod error;
mod login;
mod onboarding;
mod refresh;
mod session;
mod urls;

pub use api::{
    RayuApiKeyLimits, RayuCredits, RayuEntitlements, RayuMe, RayuModelEntry, RayuTeamCredits,
    fetch_credits, fetch_entitlements, fetch_me, gateway_credential, has_credentials,
};
pub use apikey::{
    ApiKeyVerdict, api_key_verdict_message, clear_apikey_state, clear_saved_api_key,
    configured_api_key, ensure_api_key_validated_once, has_api_key, has_validated_api_key,
    relaunch_api_key_issue, save_api_key, validate_api_key,
};
pub use error::{
    ParsedRayuError, RAYU_LIMIT_HEADER, RayuAuthKind, RayuErrorContext, RayuErrorKind,
    RayuGatewayError, extract_rayu_limit_header, format_reset_eta, is_rayu_account_wide_failure,
    is_self_contained_rayu_guidance, sanitize_custom_error_message,
};
pub use login::{PreparedRayuLogin, RayuLoginOptions, exchange_callback_url, login};
pub use onboarding::{has_completed_first_run_onboarding, mark_first_run_onboarding_completed};
pub use rayucode_build_meta::{
    DEFAULT_FALLBACK_MODEL, ENABLE_OTHER_PROVIDER, default_fallback_model, other_providers_enabled,
};
#[cfg(any(test, feature = "test-support"))]
pub use rayucode_build_meta::{
    ScopedDefaultFallbackModelGuard, ScopedOtherProvidersGuard,
    scoped_default_fallback_model_for_tests, scoped_other_providers_enabled_for_tests,
};
pub(crate) use refresh::telegram_access_token;
pub use refresh::{access_token, refresh_access_token};
pub use session::{
    RayuSession, RayuSessionUser, clear_session, has_usable_session, logout, read_session,
    write_session,
};
pub use urls::{
    account_url, api_base, api_keys_url, config_dir, gateway_base, pricing_url, web_base,
};

/// Error guidance shown whenever a non-Rayu provider is requested in a build
/// compiled with `ENABLE_OTHER_PROVIDER=false`.
pub fn other_providers_disabled_message() -> &'static str {
    "Other providers are disabled in this build (ENABLE_OTHER_PROVIDER=false). Use Rayu authentication ('rayu login --provider rayu' / '/login rayu') or RAYU_API_KEY, or recompile with ENABLE_OTHER_PROVIDER=true."
}

/// Returns `Err` when third-party / non-Rayu providers are disabled at compile time.
pub fn require_other_providers_enabled() -> anyhow::Result<()> {
    if !other_providers_enabled() {
        anyhow::bail!("{}", other_providers_disabled_message());
    }
    Ok(())
}

fn normalize_fallback_model_setting(raw: &str) -> Option<Option<String>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if matches!(
        trimmed.to_ascii_lowercase().as_str(),
        "none" | "off" | "auto" | "default"
    ) {
        return Some(None);
    }
    Some(Some(trimmed.to_string()))
}

/// Preferred model offered first when a turn fails and the user presses Ctrl+Y
/// to switch and resend (or during server-side failover when eligible).
///
/// Resolution precedence:
/// 1. Process environment variable `RAYU_FALLBACK_MODEL`
/// 2. User config env file `~/.config/rayucode/rayu.env` (`RAYU_FALLBACK_MODEL=...`)
/// 3. Compile-time default read from repository `.env` (`RAYU_FALLBACK_MODEL=...`)
///
/// Setting any tier to `none`, `off`, `auto`, or `default` disables the override
/// and restores default generation/pool fallback ranking.
pub fn preferred_fallback_model() -> Option<String> {
    if let Ok(raw) = std::env::var(RAYU_FALLBACK_MODEL_ENV)
        && let Some(resolved) = normalize_fallback_model_setting(&raw)
    {
        return resolved;
    }
    if let Some(raw) =
        rayucode_provider_env::load_env_value_from_config_file(RAYU_FALLBACK_MODEL_ENV, "rayu.env")
        && let Some(resolved) = normalize_fallback_model_setting(&raw)
    {
        return resolved;
    }
    default_fallback_model()
        .as_deref()
        .and_then(normalize_fallback_model_setting)
        .flatten()
}

/// Whether first-install / pre-provider Rayu authentication enforcement is active.
///
/// When compiled with `ENABLE_OTHER_PROVIDER=false`, Rayu authentication is always
/// required because no other provider is available in the build.
///
/// Otherwise honors `USE_RAYU_OAUTH`: `0`/`false`/`off`/`no` disables;
/// `1`/`true`/`yes`/`on` enables. Defaults to `true` in production binaries and
/// integration tests, and is never silently bypassed merely because `RAYU_HOME`
/// or `RAYU_CONFIG_DIR` is set. Under `#[cfg(test)]` unit tests default to
/// `false` unless `USE_RAYU_OAUTH` is explicitly enabled.
pub fn auth_gate_enabled() -> bool {
    if !other_providers_enabled() {
        return true;
    }
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
    if !other_providers_enabled() {
        "Rayu authentication required. Run 'rayu login --provider rayu' (or '/login rayu' in TUI), or set RAYU_API_KEY."
    } else {
        "Rayu authentication required before using Rayu or third-party providers. Run 'rayu login --provider rayu' (or '/login rayu' in TUI), or set RAYU_API_KEY."
    }
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
        "RAYU_FALLBACK_MODEL",
        "RAYU_CLIENT_PRODUCT",
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
