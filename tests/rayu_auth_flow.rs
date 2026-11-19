//! End-to-end Rayu auth flow against a scripted loopback mock backend.
//!
//! One continuous story, driven through the REAL public surfaces (no stubs):
//!   1. loopback login via the documented headless callback-paste flow (the
//!      same path `rayu login --provider rayu --callback-url` uses): the
//!      127.0.0.1 callback URL's code/state binding and the
//!      `POST {api}/cli/token` exchange. The interactive redirect server
//!      itself (probe ignoring, state verification, CSRF rejection) is
//!      covered by the `rayu::` unit suite in rayucode-base, which drives
//!      `wait_for_callback` directly; libtest's process-wide stdout capture
//!      makes the printed-URL path unobservable from an integration test;
//!   2. the persisted session file: rayu-cli byte shape (camelCase, epoch-ms
//!      `expiresAt`, numeric `user.id`) and 0600 permissions;
//!   3. live catalog discovery of an arbitrary future model through the real
//!      `/me/entitlements` schema, reaching the model-picker routes with the
//!      `rayu:` prefix via the composition-root registry;
//!   4. explicit refresh bypassing a fresh cache (and cached prefetch NOT
//!      re-fetching);
//!   5. a gateway 401 -> `POST {api}/cli/refresh` -> replay with the refreshed
//!      JWT (and JWT-over-API-key credential precedence);
//!   6. logout cleanup: session, API-key verdict record, and every
//!      endpoint-scoped catalog cache file.
//!
//! Every endpoint override points at the mock; `RAYU_AUTH_CONFIG_DIR` and
//! `RAYU_HOME` point at temp dirs, so the real `~/.rayu` / `~/.rayu` are
//! never touched.

use anyhow::Result;
use futures::StreamExt;
use rayucode::message::{ContentBlock, Message, Role, StreamEvent};
use rayucode::provider::Provider;
use rayucode_provider_rayu_runtime::RayuProvider;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock_env() -> MutexGuard<'static, ()> {
    ENV_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const TRACKED_ENV_KEYS: &[&str] = &[
    "RAYU_API_KEY",
    "RAYU_API_URL",
    "RAYU_WEB_URL",
    "RAYU_GATEWAY_URL",
    "RAYU_AUTH_CONFIG_DIR",
    "RAYU_CONFIG_DIR",
    "RAYU_HOME",
    "RAYU_RUNTIME_PROVIDER",
    "RAYU_ACTIVE_PROVIDER",
    "RAYU_INITIAL_PROVIDER_EXPLICIT",
    "RAYU_NON_INTERACTIVE",
    "OPENROUTER_API_KEY",
    "NO_PROXY",
    "no_proxy",
];

/// Hermetic environment: isolated Rayu config dir + rayu cache home, mock
/// endpoints, no ambient proxy (the shared HTTP clients honor system proxy
/// settings outside `cfg(test)`), and no leaked host credentials.
struct TestEnv {
    _lock: MutexGuard<'static, ()>,
    saved: Vec<(&'static str, Option<String>)>,
    temp: tempfile::TempDir,
}

impl TestEnv {
    fn new() -> Result<Self> {
        let lock = lock_env();
        let temp = tempfile::Builder::new().prefix("rayu-e2e-").tempdir()?;
        // Owner-only regardless of the ambient umask (tempfile inherits it).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o700))?;
        }
        let saved = TRACKED_ENV_KEYS
            .iter()
            .map(|key| (*key, std::env::var(key).ok()))
            .collect::<Vec<_>>();
        for (key, _) in &saved {
            rayucode::env::remove_var(key);
        }
        rayucode::env::set_var("RAYU_AUTH_CONFIG_DIR", temp.path().join("rayu-config"));
        rayucode::env::set_var("RAYU_HOME", temp.path().join("rayu-home"));
        rayucode::env::set_var("NO_PROXY", "127.0.0.1,localhost");
        rayucode::env::set_var("no_proxy", "127.0.0.1,localhost");
        rayucode::env::set_var("RAYU_NON_INTERACTIVE", "1");
        rayucode::auth::AuthStatus::invalidate_cache();
        Ok(Self {
            _lock: lock,
            saved,
            temp,
        })
    }

    fn config_dir(&self) -> std::path::PathBuf {
        self.temp.path().join("rayu-config")
    }

    fn cache_dir(&self) -> std::path::PathBuf {
        self.temp.path().join("rayu-home").join("cache")
    }
}

impl Drop for TestEnv {
    fn drop(&mut self) {
        for (key, value) in &self.saved {
            match value {
                Some(value) => rayucode::env::set_var(key, value),
                None => rayucode::env::remove_var(key),
            }
        }
        rayucode::auth::AuthStatus::invalidate_cache();
    }
}

struct CapturedRequest {
    line: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl CapturedRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    fn json_body(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).expect("request body must be JSON")
    }
}

/// Scripted loopback mock: one `(status, body)` response per connection, in
/// order, capturing every request. Serves BOTH the api and gateway roles (the
/// test points `RAYU_API_URL` and `RAYU_GATEWAY_URL` at it), exactly like the
/// runtime crate's own mock. `Connection: close` forces a fresh connection per
/// request so the scripted order is deterministic.
fn spawn_mock(
    responses: Vec<(&'static str, String)>,
) -> (
    std::net::SocketAddr,
    std::thread::JoinHandle<Vec<CapturedRequest>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock backend");
    let address = listener.local_addr().expect("mock addr");
    let handle = std::thread::spawn(move || {
        let mut captured = Vec::new();
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().expect("mock accept");
            stream
                .set_read_timeout(Some(Duration::from_secs(15)))
                .expect("read timeout");
            let mut buf = Vec::new();
            let mut tmp = [0u8; 4096];
            let header_end = loop {
                let count = stream.read(&mut tmp).expect("mock read");
                assert!(count > 0, "mock client closed before sending a request");
                buf.extend_from_slice(&tmp[..count]);
                if let Some(pos) = buf.windows(4).position(|window| window == b"\r\n\r\n") {
                    break pos;
                }
            };
            let header_text = String::from_utf8_lossy(&buf[..header_end]).to_string();
            let mut lines = header_text.lines();
            let line = lines.next().unwrap_or_default().to_string();
            let headers: Vec<(String, String)> = lines
                .filter_map(|header| header.split_once(':'))
                .map(|(key, value)| (key.trim().to_ascii_lowercase(), value.trim().to_string()))
                .collect();
            let content_length: usize = headers
                .iter()
                .find(|(key, _)| key == "content-length")
                .and_then(|(_, value)| value.parse().ok())
                .unwrap_or(0);
            let mut body_bytes = buf[header_end + 4..].to_vec();
            while body_bytes.len() < content_length {
                let count = stream.read(&mut tmp).expect("mock read body");
                assert!(count > 0, "mock client closed mid-body");
                body_bytes.extend_from_slice(&tmp[..count]);
            }
            captured.push(CapturedRequest {
                line,
                headers,
                body: String::from_utf8_lossy(&body_bytes[..content_length]).to_string(),
            });
            let content_type = if body.contains("event: ") {
                "text/event-stream"
            } else {
                "application/json"
            };
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .expect("mock write head");
            stream.write_all(body.as_bytes()).expect("mock write body");
        }
        captured
    });
    (address, handle)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// A model id no offline fallback array knows about: discovering it proves
/// live discovery, not a static allowlist.
const FUTURE_MODEL: &str = "rayu-e2e-future-9";
/// A second future release, published only after the first fetch.
const NEWER_MODEL: &str = "rayu-e2e-newer-12";
const PREVIEW_MODEL: &str = "rayu-e2e-preview";

const LOGIN_CODE: &str = "e2e-one-time-code";
const INITIAL_JWT: &str = "jwt-e2e-initial";
const REFRESHED_JWT: &str = "jwt-e2e-refreshed";
const API_KEY: &str = "rayu_sk_live_e2e_fallback";

fn session_body(expires_at: i64) -> String {
    serde_json::json!({
        "accessToken": INITIAL_JWT,
        "refreshToken": "refresh-e2e-1",
        "expiresAt": expires_at,
        "user": {
            "id": 7,
            "email": "seven@example.invalid",
            "displayName": "Seven",
            "avatarUrl": null,
            "role": "user"
        }
    })
    .to_string()
}

/// REAL `/me/entitlements` schema (camelCase `RayuModelEntry` rows).
fn entitlements_body(codes: &[&str]) -> String {
    let entry = |code: &str| {
        serde_json::json!({
            "code": code,
            "label": format!("{code} label"),
            "description": "Released after this binary was built",
            "contextWindow": 400_000,
            "supportsReasoning": true,
            "supportsImage": false,
            "supportsTools": true,
            "creditMultiplier": 1.5
        })
    };
    let allowed: Vec<_> = codes.iter().map(|code| entry(code)).collect();
    let mut hosted = allowed.clone();
    hosted.push(serde_json::json!({"code": PREVIEW_MODEL, "contextWindow": 128_000}));
    serde_json::json!({
        "allowedModels": allowed,
        "hostedModels": hosted,
        "subagentTiers": {"fast": PREVIEW_MODEL, "balanced": codes[0], "capable": codes[0]}
    })
    .to_string()
}

fn sse_body() -> String {
    concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_e2e\",\"model\":\"rayu-e2e-future-9\",\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello from Rayu\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":4}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    )
    .to_string()
}

fn user_message(text: &str) -> Vec<Message> {
    vec![Message {
        role: Role::User,
        content: vec![ContentBlock::Text {
            text: text.to_string(),
            cache_control: None,
        }],
        timestamp: None,
        tool_duration_ms: None,
    }]
}

#[cfg(unix)]
fn assert_owner_only(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(path)
        .expect("file metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600, "{} must be owner-only", path.display());
}

#[tokio::test]
async fn rayu_login_catalog_refresh_replay_logout_end_to_end() -> Result<()> {
    let env = TestEnv::new()?;

    // One scripted backend serves the whole story, in request order.
    let refresh_body = serde_json::json!({
        "accessToken": REFRESHED_JWT,
        "refreshToken": "refresh-e2e-2",
        "expiresAt": now_ms() + 3_600_000,
    })
    .to_string();
    let credits_body = serde_json::json!({
        "plan": "pro", "planName": "Pro", "creditsPerPeriod": 100.0,
        "usedCredits": 1.0, "remainingCredits": 99.0, "resetSeconds": 3600,
        "periodEnd": "2026-12-01T00:00:00Z", "topupBalance": 0.0, "topUpEnabled": true
    })
    .to_string();
    let (address, server) = spawn_mock(vec![
        ("200 OK", session_body(now_ms() + 3_600_000)), // 1: POST /cli/token
        ("200 OK", entitlements_body(&[FUTURE_MODEL])), // 2: prefetch
        ("200 OK", entitlements_body(&[FUTURE_MODEL, NEWER_MODEL])), // 3: forced refresh
        (
            "401 Unauthorized",
            r#"{"error":{"type":"authentication_error","message":"expired"}}"#.to_string(),
        ), // 4: chat attempt
        ("200 OK", refresh_body),                       // 5: POST /cli/refresh
        ("200 OK", sse_body()),                         // 6: chat replay
        ("200 OK", credits_body),                       // 7: GET /v1/credits
    ]);
    let base = format!("http://{address}");
    rayucode::env::set_var("RAYU_API_URL", &base);
    rayucode::env::set_var("RAYU_GATEWAY_URL", &base);

    // --- 1. Loopback login (headless callback-paste flow) -------------------
    // The browser redirected to the loopback callback server and the user
    // pasted the full URL back — the documented headless completion path.
    // The code/state binding is verified at the exchange boundary below.
    let exchanged_state = "e2e-loopback-state".to_string();
    let user = rayucode::rayu::login(rayucode::rayu::RayuLoginOptions {
        no_browser: true,
        print_auth_url: false,
        callback_url: Some(format!(
            "http://127.0.0.1:43210/callback?code={LOGIN_CODE}&state={exchanged_state}"
        )),
    })
    .await?;
    assert_eq!(user.id, 7);
    assert_eq!(user.email.as_deref(), Some("seven@example.invalid"));
    assert_eq!(user.display_name.as_deref(), Some("Seven"));

    // --- 2. Session file: rayu-cli byte shape + owner-only perms -----------
    let session_path = env.config_dir().join("rayu-auth.json");
    let text = std::fs::read_to_string(&session_path)?;
    assert!(
        text.starts_with("{\n  \"accessToken\": \""),
        "pretty-printed camelCase shape, got: {text}"
    );
    assert!(
        !text.ends_with('\n'),
        "no trailing newline (JSON.stringify parity)"
    );
    assert!(text.contains("\"displayName\""));
    assert!(text.contains("\"avatarUrl\": null"));
    assert!(text.contains("\"id\": 7"));
    assert!(
        !text.contains("access_token"),
        "snake_case must not leak to disk"
    );
    #[cfg(unix)]
    assert_owner_only(&session_path);
    let stored: serde_json::Value = serde_json::from_str(&text)?;
    let mut keys: Vec<&str> = stored
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["accessToken", "expiresAt", "refreshToken", "user"]);
    assert_eq!(stored["accessToken"], INITIAL_JWT);
    let expires_at = stored["expiresAt"]
        .as_i64()
        .expect("expiresAt must be numeric");
    assert!(expires_at > now_ms(), "expiresAt is epoch-ms in the future");
    assert!(stored["user"]["id"].is_number());
    let session = rayucode::rayu::read_session().expect("session readable");
    assert_eq!(session.access_token, INITIAL_JWT);
    assert!(rayucode::rayu::has_usable_session());

    // --- 3. Live catalog discovery + picker routes --------------------------
    let provider = RayuProvider::new();
    assert!(RayuProvider::has_credentials());
    provider.prefetch_models().await?;
    let switching = provider.available_models_for_switching();
    assert!(
        switching.contains(&FUTURE_MODEL.to_string()),
        "live discovery must surface an arbitrary future model; got {switching:?}"
    );
    assert!(
        !switching.contains(&PREVIEW_MODEL.to_string()),
        "hosted-only is visible, not usable"
    );
    assert_eq!(
        provider.model(),
        FUTURE_MODEL,
        "JWT default is the first usable model"
    );
    assert_eq!(provider.context_window(), 400_000);
    let routes = provider.model_routes();
    let route = routes
        .iter()
        .find(|route| route.model == FUTURE_MODEL)
        .expect("future model must reach the picker routes");
    assert_eq!(route.api_method, "rayu");
    assert_eq!(route.provider, "Rayu");
    assert!(route.available);
    assert_eq!(
        rayucode::provider::ModelRouteApiMethod::parse(&route.api_method),
        rayucode::provider::ModelRouteApiMethod::Rayu
    );
    provider.set_model(&format!("rayu:{FUTURE_MODEL}"))?;
    assert_eq!(provider.model(), FUTURE_MODEL, "wire ids are bare");

    // The composition root routes a picker selection back through the rayu:
    // profile, exactly like the binary.
    rayucode::cli::startup::register_external_provider_runtimes();
    let multi = rayucode::provider::MultiProvider::with_preference_fast(true);
    multi.set_model(&format!("rayu:{FUTURE_MODEL}"))?;
    assert!(
        multi.model_routes().iter().any(|route| {
            route.model == format!("rayu:{FUTURE_MODEL}") && route.api_method == "rayu"
        }),
        "picker must offer the discovered model via a rayu: route"
    );

    // --- 4. Forced refresh bypasses the fresh cache; prefetch does not ------
    let summary = provider.refresh_model_catalog().await?;
    assert!(
        summary
            .models_added_names
            .contains(&NEWER_MODEL.to_string()),
        "explicit refresh must bypass a fresh cache; summary: {summary:?}"
    );
    assert!(
        provider
            .available_models_for_switching()
            .contains(&NEWER_MODEL.to_string())
    );
    // A cached prefetch right after must NOT hit the network: the mock has no
    // response scripted for it, so any extra request would fail the audit below.
    provider.prefetch_models().await?;
    let scoped_caches: Vec<_> = std::fs::read_dir(env.cache_dir())?
        .flatten()
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("rayu_models_") && name.ends_with(".json")
        })
        .collect();
    assert!(
        !scoped_caches.is_empty(),
        "catalog must persist an endpoint-scoped cache"
    );

    // --- 5. Gateway 401 -> refresh -> replay with the refreshed JWT ---------
    rayucode::env::set_var("RAYU_API_KEY", API_KEY);
    assert_eq!(
        rayucode::rayu::gateway_credential().await.as_deref(),
        Some(INITIAL_JWT),
        "the account JWT wins over the API key"
    );
    let stream = provider
        .complete(&user_message("hi"), &[], "e2e system prompt", None)
        .await?;
    let events: Vec<StreamEvent> = stream
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let text: String = events
        .iter()
        .filter_map(|event| match event {
            StreamEvent::TextDelta(text) => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "Hello from Rayu");
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::MessageEnd { stop_reason: Some(reason) } if reason == "end_turn"
    )));
    let renewed = rayucode::rayu::read_session().expect("refreshed session persisted");
    assert_eq!(renewed.access_token, REFRESHED_JWT);
    assert_eq!(renewed.refresh_token, "refresh-e2e-2");
    assert_eq!(
        renewed.user.id, 7,
        "refresh must preserve the account identity"
    );
    #[cfg(unix)]
    assert_owner_only(&session_path);

    // --- 6. API-key verdict record, then logout cleanup ---------------------
    assert_eq!(
        rayucode::rayu::validate_api_key(API_KEY).await,
        rayucode::rayu::ApiKeyVerdict::Valid
    );
    let apikey_state_path = env.config_dir().join("rayu-apikey-state.json");
    let state_text = std::fs::read_to_string(&apikey_state_path)?;
    assert!(state_text.contains("\"verdict\": \"valid\""));
    assert!(
        !state_text.contains(API_KEY),
        "the key itself must never be stored"
    );
    #[cfg(unix)]
    assert_owner_only(&apikey_state_path);

    rayucode::rayu::logout()?;
    assert!(!session_path.exists(), "logout must remove the session");
    assert!(
        !apikey_state_path.exists(),
        "logout must remove the API-key verdict"
    );
    assert!(rayucode::rayu::read_session().is_none());
    assert!(!rayucode::rayu::has_usable_session());
    let leftover: Vec<_> = std::fs::read_dir(env.cache_dir())?
        .flatten()
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("rayu_models_") && name.ends_with(".json")
        })
        .collect();
    assert!(
        leftover.is_empty(),
        "logout must remove every scoped catalog cache"
    );
    rayucode::env::remove_var("RAYU_API_KEY");
    assert!(!rayucode::rayu::has_credentials());
    provider.on_auth_changed();
    let after_logout = provider.available_models_for_switching();
    assert!(
        !after_logout.contains(&FUTURE_MODEL.to_string()),
        "the signed-out account's catalog must not stay visible"
    );
    assert!(
        after_logout.is_empty(),
        "logout must leave no stale or fabricated fallback models; got {:?}",
        after_logout
    );

    // --- 7. Wire audit: every request, in order, with the right credential --
    let captured = server.join().expect("mock backend thread");
    assert_eq!(
        captured.len(),
        7,
        "exactly the scripted requests; got {:?}",
        captured.iter().map(|r| &r.line).collect::<Vec<_>>()
    );

    assert!(captured[0].line.starts_with("POST /cli/token "));
    assert_eq!(
        captured[0].json_body(),
        serde_json::json!({"code": LOGIN_CODE, "state": exchanged_state})
    );

    for index in [1, 2] {
        assert!(captured[index].line.starts_with("GET /me/entitlements "));
        assert_eq!(
            captured[index].header("authorization"),
            Some(&format!("Bearer {INITIAL_JWT}")[..])
        );
        assert!(captured[index].header("x-api-key").is_none());
    }

    assert!(captured[3].line.starts_with("POST /anthropic/v1/messages "));
    assert_eq!(
        captured[3].header("authorization"),
        Some(&format!("Bearer {INITIAL_JWT}")[..])
    );
    assert_eq!(captured[3].header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(captured[3].header("x-rayu-client"), Some("cli"));
    assert!(captured[3].header("x-api-key").is_none());
    let sent = captured[3].json_body();
    assert_eq!(sent["model"], FUTURE_MODEL, "wire model id must be bare");
    assert_eq!(sent["stream"], true);

    assert!(captured[4].line.starts_with("POST /cli/refresh "));
    assert_eq!(
        captured[4].json_body(),
        serde_json::json!({"refreshToken": "refresh-e2e-1"})
    );

    assert!(captured[5].line.starts_with("POST /anthropic/v1/messages "));
    assert_eq!(
        captured[5].header("authorization"),
        Some(&format!("Bearer {REFRESHED_JWT}")[..]),
        "the replay must carry the refreshed JWT"
    );

    assert!(captured[6].line.starts_with("GET /v1/credits "));
    assert_eq!(
        captured[6].header("authorization"),
        Some(&format!("Bearer {API_KEY}")[..])
    );

    Ok(())
}

#[test]
fn cli_binary_enforces_rayu_auth_gate_with_sandboxed_rayu_home_and_allows_opt_out() -> Result<()> {
    use std::process::Command;

    let temp = tempfile::tempdir()?;
    let bin = env!("CARGO_BIN_EXE_rayu");
    let run_cli = |args: &[&str], extra_env: &[(&str, &str)]| -> std::process::Output {
        let mut cmd = Command::new(bin);
        cmd.current_dir(temp.path())
            .env_clear()
            .env("HOME", temp.path())
            .env("RAYU_HOME", temp.path().join("rayu-home"))
            .env("RAYU_AUTH_CONFIG_DIR", temp.path().join("rayu-auth"))
            .env("RAYU_NO_TELEMETRY", "1")
            .env("NO_COLOR", "1")
            .env("PATH", "/usr/bin:/bin")
            .args(args);
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
        cmd.output().expect("execute rayu CLI")
    };

    // 1. Utility commands stay unblocked without Rayu credentials even when gate is active.
    for utility in [
        &["--help"][..],
        &["--version"][..],
        &["version", "--json"][..],
        &["mcp", "list"][..],
        &["telemetry", "status"][..],
    ] {
        let out = run_cli(utility, &[]);
        assert!(
            out.status.success(),
            "utility command {:?} failed: stderr={}",
            utility,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    // 2. RAYU_HOME alone does NOT bypass the production auth gate; 3P keys in env don't bypass either.
    for blocked in [
        &["run", "hello"][..],
        &["--provider", "anthropic-api", "run", "hello"][..],
        &["serve"][..],
        &["server", "start", "--json"][..],
        &["api", "--stdio"][..],
        &["--provider", "rayu", "repl"][..],
    ] {
        let out = run_cli(
            blocked,
            &[
                ("ANTHROPIC_API_KEY", "sk-ant-3p-only"),
                ("OPENROUTER_API_KEY", "sk-or-3p-only"),
            ],
        );
        assert!(
            !out.status.success(),
            "command {:?} must be gated without Rayu credentials",
            blocked
        );
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            stderr.contains("Rayu authentication required"),
            "missing Rayu gate error on {:?}: {stderr}",
            blocked
        );
    }

    // 3. Explicit USE_RAYU_OAUTH=false disables the Rayu Auth gate cleanly.
    let opted_out = run_cli(
        &["--provider", "anthropic-api", "run", "hello"],
        &[("USE_RAYU_OAUTH", "false")],
    );
    let opted_out_stderr = String::from_utf8_lossy(&opted_out.stderr);
    assert!(
        !opted_out_stderr.contains("Rayu authentication required"),
        "USE_RAYU_OAUTH=false should bypass the Rayu gate: {opted_out_stderr}"
    );

    // 4. `rayu login --provider rayu --api-key ... --no-validate --json` persists key into rayu.env (0600).
    let login_out = run_cli(
        &[
            "login",
            "--provider",
            "rayu",
            "--api-key",
            "rayu_sk_live_cli_gate_unlock",
            "--no-validate",
            "--json",
        ],
        &[],
    );
    assert!(
        login_out.status.success(),
        "API-key login failed: stderr={}",
        String::from_utf8_lossy(&login_out.stderr)
    );
    let env_file = temp
        .path()
        .join("rayu-home")
        .join("config")
        .join("rayucode")
        .join("rayu.env");
    assert!(
        env_file.exists(),
        "expected saved key at {}",
        env_file.display()
    );
    let contents = std::fs::read_to_string(&env_file)?;
    assert!(contents.contains("RAYU_API_KEY=rayu_sk_live_cli_gate_unlock"));

    // 5. `rayu auth status --json` reports `credential_source: "app config file"` for `rayu.env`.
    let status_out = run_cli(&["auth", "status", "--json"], &[]);
    assert!(
        status_out.status.success(),
        "auth status failed: stderr={}",
        String::from_utf8_lossy(&status_out.stderr)
    );
    let status_json: serde_json::Value = serde_json::from_slice(&status_out.stdout)?;
    let rayu_provider = status_json["providers"]
        .as_array()
        .and_then(|arr| arr.iter().find(|p| p["id"] == "rayu"))
        .expect("rayu provider entry in auth status --json");
    assert_eq!(rayu_provider["status"], "available");
    assert_eq!(rayu_provider["credential_source"], "app config file");

    Ok(())
}

#[test]
fn bare_non_tty_launch_without_credentials_fails_before_spawning_server() -> Result<()> {
    let temp = tempfile::Builder::new()
        .prefix("rayu-preui-gate-")
        .tempdir()?;
    let socket = temp.path().join("rayu.sock");
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_rayu"))
        .current_dir(temp.path())
        .env_clear()
        .env("HOME", temp.path())
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("XDG_CONFIG_HOME", temp.path().join("xdg-config"))
        .env("XDG_RUNTIME_DIR", temp.path().join("xdg-runtime"))
        .env("RAYU_HOME", temp.path().join("rayu-home"))
        .env("RAYU_AUTH_CONFIG_DIR", temp.path().join("rayu-auth"))
        .env("RAYU_NO_TELEMETRY", "1")
        .env("NO_COLOR", "1")
        .args(["--no-selfdev", "--socket", socket.to_str().unwrap()])
        .output()?;

    assert!(
        !output.status.success(),
        "expected unauthenticated bare launch to fail before opening UI"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Rayu authentication required"),
        "expected Rayu auth gate error, got stderr={stderr}"
    );
    assert!(
        !socket.exists(),
        "pre-UI gate must abort BEFORE spawning a server socket at {}",
        socket.display()
    );
    Ok(())
}
