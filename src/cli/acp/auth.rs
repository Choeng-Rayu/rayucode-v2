//! ACP authentication advertisement (`authMethods`), structured `-32000`
//! (`auth_required`) error payloads, and `authenticate` method execution.

use super::{ClientCapabilities, JSONRPC_AUTH_REQUIRED, JSONRPC_INVALID_PARAMS};
use serde_json::{Value, json};

pub(super) const AUTH_METHOD_RAYU_LOGIN: &str = "rayu-login";
pub(super) const AUTH_METHOD_RAYU_API_KEY: &str = "rayu-api-key";

/// Build the ACP `authMethods` list advertised in `initialize` and echoed in
/// structured `-32000` (`auth_required`) error data.
pub(super) fn auth_methods(client_caps: &ClientCapabilities) -> Vec<Value> {
    let mut login = json!({
        "id": AUTH_METHOD_RAYU_LOGIN,
        "name": "Sign in with Rayu",
        "description": "Sign in to your RayuCode account via browser OAuth (`rayu login --provider rayu`).",
    });

    if client_caps.terminal_auth
        && let Some(object) = login.as_object_mut()
    {
        let command = std::env::current_exe()
            .ok()
            .and_then(|path| path.to_str().map(str::to_string))
            .unwrap_or_else(|| "rayu".to_string());
        object.insert(
            "_meta".to_string(),
            json!({
                "terminal-auth": {
                    "command": command,
                    "args": ["login", "--provider", "rayu"],
                    "label": "Sign in with Rayu",
                }
            }),
        );
    }

    let api_key = json!({
        "id": AUTH_METHOD_RAYU_API_KEY,
        "name": "Rayu API Key",
        "description": "Authenticate using a Rayu API key (`RAYU_API_KEY` env var or `apiKey` in authenticate params).",
    });

    vec![login, api_key]
}

/// Structured JSON-RPC `error.data` payload attached to `-32000` auth-required
/// responses so ACP clients (Zed, JetBrains, VS Code, etc.) can launch their
/// native authentication UI.
pub(super) fn auth_required_error_data(client_caps: &ClientCapabilities) -> Value {
    json!({
        "errorKind": "auth_required",
        "authMethods": auth_methods(client_caps),
    })
}

/// Extract an optional API key supplied inside `authenticate` params.
fn extract_api_key(params: &Value) -> Option<String> {
    let candidates = [
        params.get("apiKey"),
        params.get("api_key"),
        params.get("token"),
        params.get("data").and_then(|d| d.get("apiKey")),
        params.get("data").and_then(|d| d.get("api_key")),
        params.get("data").and_then(|d| d.get("token")),
        params.get("_meta").and_then(|m| m.get("apiKey")),
        params.get("_meta").and_then(|m| m.get("api_key")),
    ];
    candidates
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

/// Extract an optional manual OAuth callback URL supplied inside `authenticate`.
fn extract_callback_url(params: &Value) -> Option<String> {
    let candidates = [
        params.get("callbackUrl"),
        params.get("callback_url"),
        params.get("data").and_then(|d| d.get("callbackUrl")),
        params.get("data").and_then(|d| d.get("callback_url")),
    ];
    candidates
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

/// Execute an ACP `authenticate` request.
///
/// Returns `Ok(())` once valid credentials are available, or `Err((code, msg))`
/// using standard ACP JSON-RPC error codes.
pub(super) async fn execute_authenticate(params: &Value) -> std::result::Result<(), (i64, String)> {
    let method_id = params
        .get("methodId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            (
                JSONRPC_INVALID_PARAMS,
                "authenticate requires a non-empty string methodId".to_string(),
            )
        })?;

    match method_id {
        AUTH_METHOD_RAYU_API_KEY | "api_key" | "api-key" => {
            if let Some(key) = extract_api_key(params) {
                crate::rayu::save_api_key(&key)
                    .map_err(|err| (JSONRPC_INVALID_PARAMS, err.to_string()))?;
                crate::env::set_var(crate::rayu::RAYU_API_KEY_ENV, &key);
                let verdict = crate::rayu::validate_api_key(&key).await;
                if matches!(verdict, crate::rayu::ApiKeyVerdict::Invalid) {
                    let _ = crate::rayu::clear_saved_api_key();
                    return Err((
                        JSONRPC_AUTH_REQUIRED,
                        crate::rayu::api_key_verdict_message(verdict)
                            .unwrap_or("Rayu API key was rejected.")
                            .to_string(),
                    ));
                }
                return Ok(());
            }
            if crate::rayu::has_credentials() {
                return Ok(());
            }
            Err((
                JSONRPC_AUTH_REQUIRED,
                "No RAYU_API_KEY configured. Pass `apiKey` in authenticate params or set RAYU_API_KEY."
                    .to_string(),
            ))
        }
        AUTH_METHOD_RAYU_LOGIN | "rayu" | "oauth" | "agent-login" => {
            if !super::super::startup::cli_auth_gate_active() && crate::rayu::has_credentials() {
                return Ok(());
            }
            if let Some(callback_url) = extract_callback_url(params) {
                crate::rayu::exchange_callback_url(&callback_url)
                    .await
                    .map_err(|err| {
                        (
                            JSONRPC_AUTH_REQUIRED,
                            format!("Rayu OAuth callback failed: {err:#}"),
                        )
                    })?;
                return Ok(());
            }
            let no_browser = params
                .get("noBrowser")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || std::env::var_os("RAYU_ACP_NO_BROWSER").is_some();
            let prepared = crate::rayu::PreparedRayuLogin::prepare()
                .await
                .map_err(|err| {
                    (
                        JSONRPC_AUTH_REQUIRED,
                        format!("Could not prepare Rayu login: {err:#}"),
                    )
                })?;
            if no_browser {
                return Err((
                    JSONRPC_AUTH_REQUIRED,
                    format!(
                        "Run `rayu login --provider rayu` or open {} to complete Rayu sign-in.",
                        prepared.auth_url()
                    ),
                ));
            }
            prepared.open_browser();
            prepared.wait_and_exchange().await.map_err(|err| {
                (
                    JSONRPC_AUTH_REQUIRED,
                    format!("Rayu sign-in did not complete: {err:#}"),
                )
            })?;
            Ok(())
        }
        other => Err((
            JSONRPC_INVALID_PARAMS,
            format!("Unsupported ACP authentication methodId: {other}"),
        )),
    }
}
