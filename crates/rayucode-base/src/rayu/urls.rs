//! Rayu service endpoints and the shared config directory.
//!
//! Every base URL is validated before a bearer credential can ride on it:
//! https to any host, plain http only to loopback, and no embedded userinfo.
//! An invalid override falls back to the production default with a warning —
//! a misconfigured or hostile `RAYU_GATEWAY_URL=http://attacker.example` must
//! never receive the account JWT.

use std::path::PathBuf;

const DEFAULT_API_BASE: &str = "https://api.rayucode.com/api";
const DEFAULT_WEB_BASE: &str = "https://rayucode.com";
const DEFAULT_GATEWAY_BASE: &str = "https://gateway.rayucode.com";

/// Directory holding the Rayu session shared with rayu-cli.
///
/// Precedence: `RAYU_AUTH_CONFIG_DIR` > `RAYU_CONFIG_DIR` > `~/.rayu`.
/// The auth override lets a second entrypoint keep an independent credential
/// profile without moving the shared config home.
pub fn config_dir() -> PathBuf {
    for key in ["RAYU_AUTH_CONFIG_DIR", "RAYU_HOME", "RAYU_CONFIG_DIR"] {
        if let Some(value) = std::env::var_os(key) {
            let value = value.to_string_lossy().trim().to_string();
            if !value.is_empty() {
                return PathBuf::from(value);
            }
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".rayu")
}

/// Base URL of the rayu-backend API (no trailing slash).
pub fn api_base() -> String {
    validated_base("RAYU_API_URL", DEFAULT_API_BASE)
}

/// Base URL of the rayu-web site (no trailing slash).
pub fn web_base() -> String {
    validated_base("RAYU_WEB_URL", DEFAULT_WEB_BASE)
}

/// Base URL of the rayu-gateway (no trailing slash, no /v1 suffix).
pub fn gateway_base() -> String {
    validated_base("RAYU_GATEWAY_URL", DEFAULT_GATEWAY_BASE)
}

/// The signed-in account dashboard on rayu-web.
pub fn account_url() -> String {
    format!("{}/dashboard", web_base())
}

/// The API key management page on rayu-web.
pub fn api_keys_url() -> String {
    format!("{}/dashboard/api-keys", web_base())
}

/// The plans/pricing page, offered wherever a limit is hit.
pub fn pricing_url() -> String {
    format!("{}/plans", web_base())
}

fn validated_base(env_key: &str, default: &str) -> String {
    let Ok(raw) = std::env::var(env_key) else {
        return default.to_string();
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return default.to_string();
    }
    // Strip ALL trailing slashes: consumers append `/v1/...` or `/cli/...`,
    // and a leftover slash becomes a double slash the router will not match.
    let candidate = trimmed.trim_end_matches('/');
    if is_safe_base(candidate) {
        return candidate.to_string();
    }
    // Never echo the override value: it may embed credentials.
    crate::logging::warn(&format!(
        "Ignoring invalid {env_key} override (need https, or http only to loopback, without embedded credentials); using the production default"
    ));
    default.to_string()
}

fn is_safe_base(base: &str) -> bool {
    let Ok(url) = url::Url::parse(base) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match url.scheme() {
        "https" => url.host_str().is_some(),
        "http" => url.host_str().is_some_and(is_loopback_host),
        _ => false,
    }
}

fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_bases_accept_https_anywhere_and_http_only_on_loopback() {
        for base in [
            "https://api.rayucode.com/api",
            "https://custom.example/v1",
            "http://127.0.0.1:4000/api",
            "http://localhost:3000",
            "http://[::1]:8080",
        ] {
            assert!(is_safe_base(base), "{base}");
        }
        for base in [
            "http://attacker.example",
            "http://rayucode.com/api",
            "https://user:secret@rayucode.com",
            "https://user@rayucode.com",
            "ftp://rayucode.com",
            "file:///etc/passwd",
            "not-a-url",
            "",
        ] {
            assert!(!is_safe_base(base), "{base}");
        }
    }

    #[test]
    fn env_overrides_are_validated_and_default_on_invalid() {
        let _guard = crate::storage::lock_test_env();
        let prev = std::env::var_os("RAYU_GATEWAY_URL");

        crate::env::set_var("RAYU_GATEWAY_URL", "http://127.0.0.1:8080///");
        assert_eq!(gateway_base(), "http://127.0.0.1:8080");

        crate::env::set_var("RAYU_GATEWAY_URL", "http://evil.example");
        assert_eq!(gateway_base(), DEFAULT_GATEWAY_BASE);

        crate::env::set_var("RAYU_GATEWAY_URL", "https://user:pw@gateway.example");
        assert_eq!(gateway_base(), DEFAULT_GATEWAY_BASE);

        crate::env::set_var("RAYU_GATEWAY_URL", "https://gw.example/v1/");
        assert_eq!(gateway_base(), "https://gw.example/v1");

        match prev {
            Some(value) => crate::env::set_var("RAYU_GATEWAY_URL", value),
            None => crate::env::remove_var("RAYU_GATEWAY_URL"),
        }
    }

    #[test]
    fn config_dir_precedence_auth_over_config_over_home() {
        let _guard = crate::storage::lock_test_env();
        let prev_auth = std::env::var_os("RAYU_AUTH_CONFIG_DIR");
        let prev_home = std::env::var_os("RAYU_HOME");
        let prev_config = std::env::var_os("RAYU_CONFIG_DIR");

        crate::env::remove_var("RAYU_HOME");
        crate::env::set_var("RAYU_AUTH_CONFIG_DIR", "/tmp/rayu-auth-profile");
        crate::env::set_var("RAYU_CONFIG_DIR", "/tmp/rayu-config");
        assert_eq!(config_dir(), PathBuf::from("/tmp/rayu-auth-profile"));

        crate::env::remove_var("RAYU_AUTH_CONFIG_DIR");
        assert_eq!(config_dir(), PathBuf::from("/tmp/rayu-config"));

        crate::env::remove_var("RAYU_CONFIG_DIR");
        assert!(config_dir().ends_with(".rayu"));

        match prev_auth {
            Some(value) => crate::env::set_var("RAYU_AUTH_CONFIG_DIR", value),
            None => crate::env::remove_var("RAYU_AUTH_CONFIG_DIR"),
        }
        match prev_home {
            Some(value) => crate::env::set_var("RAYU_HOME", value),
            None => crate::env::remove_var("RAYU_HOME"),
        }
        match prev_config {
            Some(value) => crate::env::set_var("RAYU_CONFIG_DIR", value),
            None => crate::env::remove_var("RAYU_CONFIG_DIR"),
        }
    }

    #[test]
    fn account_pages_hang_off_the_web_base() {
        let _guard = crate::storage::lock_test_env();
        let prev = std::env::var_os("RAYU_WEB_URL");
        crate::env::set_var("RAYU_WEB_URL", "http://localhost:3000/");
        assert_eq!(account_url(), "http://localhost:3000/dashboard");
        assert_eq!(api_keys_url(), "http://localhost:3000/dashboard/api-keys");
        assert_eq!(pricing_url(), "http://localhost:3000/plans");
        match prev {
            Some(value) => crate::env::set_var("RAYU_WEB_URL", value),
            None => crate::env::remove_var("RAYU_WEB_URL"),
        }
    }
}
