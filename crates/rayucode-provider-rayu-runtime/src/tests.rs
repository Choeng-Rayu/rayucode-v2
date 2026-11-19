use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};

static ENV_LOCK: Mutex<()> = Mutex::new(());

const RAYU_ENV_KEYS: &[&str] = &[
    "RAYU_API_KEY",
    "RAYU_API_URL",
    "RAYU_GATEWAY_URL",
    "RAYU_AUTH_CONFIG_DIR",
    "RAYU_CONFIG_DIR",
    "RAYU_HOME",
];

struct EnvGuard {
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl EnvGuard {
    fn new(keys: &[&'static str]) -> Self {
        Self {
            saved: keys
                .iter()
                .map(|key| (*key, std::env::var_os(key)))
                .collect(),
        }
    }

    fn set(&self, key: &str, value: impl AsRef<std::ffi::OsStr>) {
        // SAFETY: test-only env mutation, serialized by ENV_LOCK.
        unsafe { std::env::set_var(key, value) }
    }

    fn remove(&self, key: &str) {
        // SAFETY: test-only env mutation, serialized by ENV_LOCK.
        unsafe { std::env::remove_var(key) }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in &self.saved {
            // SAFETY: test-only env mutation, serialized by ENV_LOCK.
            unsafe {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }
}

/// Hermetic test environment: isolated Rayu config dir + rayu cache home,
/// no credentials or endpoint overrides leaked in from the host. The lock
/// guard is declared LAST so it drops AFTER env restoration.
struct TestEnv {
    env: EnvGuard,
    _config: tempfile::TempDir,
    _home: tempfile::TempDir,
    _lock: std::sync::MutexGuard<'static, ()>,
}

fn test_env() -> TestEnv {
    let lock = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let env = EnvGuard::new(RAYU_ENV_KEYS);
    let config = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    env.set("RAYU_AUTH_CONFIG_DIR", config.path());
    env.set("RAYU_CONFIG_DIR", config.path());
    env.set("RAYU_HOME", home.path());
    env.remove("RAYU_API_KEY");
    env.remove("RAYU_API_URL");
    env.remove("RAYU_GATEWAY_URL");
    TestEnv {
        env,
        _config: config,
        _home: home,
        _lock: lock,
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn write_test_session() {
    let session = rayucode_base::rayu::RayuSession {
        access_token: "jwt-test-token".to_string(),
        refresh_token: "refresh-test-token".to_string(),
        expires_at: now_ms() + 3_600_000,
        user: rayucode_base::rayu::RayuSessionUser {
            id: 42,
            email: Some("dev@example.com".to_string()),
            display_name: None,
            avatar_url: None,
            role: "user".to_string(),
        },
    };
    rayucode_base::rayu::write_session(&session).unwrap();
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
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Grok-build-style mock: a loopback TCP server answering a fixed sequence
/// of responses and capturing every request it receives.
fn spawn_mock(
    responses: Vec<(&'static str, String)>,
) -> (
    std::net::SocketAddr,
    std::thread::JoinHandle<Vec<CapturedRequest>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        let mut captured = Vec::new();
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 4096];
            let header_end = loop {
                let count = stream.read(&mut tmp).unwrap();
                assert!(count > 0, "mock client closed before sending a request");
                buf.extend_from_slice(&tmp[..count]);
                if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
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
                let count = stream.read(&mut tmp).unwrap();
                assert!(count > 0, "mock client closed mid-body");
                body_bytes.extend_from_slice(&tmp[..count]);
            }
            let request_body = String::from_utf8_lossy(&body_bytes[..content_length]).to_string();
            let content_type = if body.contains("event: ") {
                "text/event-stream"
            } else {
                "application/json"
            };
            let body_len = body.len();
            captured.push(CapturedRequest {
                line,
                headers,
                body: request_body,
            });
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {body_len}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            stream.write_all(body.as_bytes()).unwrap();
        }
        captured
    });
    (address, handle)
}

fn user_message(text: &str) -> Vec<Message> {
    vec![Message {
        role: rayucode_message_types::Role::User,
        content: vec![rayucode_message_types::ContentBlock::Text {
            text: text.to_string(),
            cache_control: None,
        }],
        timestamp: None,
        tool_duration_ms: None,
    }]
}

#[tokio::test]
async fn api_key_catalog_discovers_future_models_and_force_refresh_bypasses_fresh_cache() {
    let test = test_env();
    test.env.set("RAYU_API_KEY", "rayu_sk_live_test_key_123");

    // REAL /v1/models schema. "rayu-future-model-9" exists in no fallback
    // array: discovering it proves live discovery, not a static allowlist.
    let first = r#"{"object":"list","data":[
        {"id":"rayu-future-model-9","object":"model","owned_by":"rayu","label":"Future Model 9","description":"A model released after this binary","contextWindow":400000,"supportsReasoning":true,"supportsImage":false,"supportsTools":true},
        {"id":"rayu-flash-mini","object":"model","owned_by":"rayu","label":"Flash Mini","contextWindow":131072,"supportsReasoning":false,"supportsImage":false,"supportsTools":true}
    ],"subagentTiers":{"fast":"rayu-flash-mini","balanced":"rayu-future-model-9","capable":"rayu-future-model-9"}}"#
        .to_string();
    let second = r#"{"object":"list","data":[
        {"id":"rayu-even-newer-10","object":"model","owned_by":"rayu","contextWindow":500000,"supportsTools":true}
    ]}"#
        .to_string();
    let (address, server) = spawn_mock(vec![
        ("200 OK", first),
        ("200 OK", second),
        (
            "503 Service Unavailable",
            r#"{"error":"temporary outage"}"#.to_string(),
        ),
    ]);
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));

    let provider = RayuProvider::new();
    assert!(RayuProvider::has_credentials());
    provider.prefetch_models().await.unwrap();

    let switching = provider.available_models_for_switching();
    assert!(switching.contains(&"rayu-future-model-9".to_string()));
    assert!(switching.contains(&"rayu-flash-mini".to_string()));
    // API-key default: first id NOT matching the cheap-tier pattern.
    assert_eq!(provider.model(), "rayu-future-model-9");

    let routes = provider.model_routes();
    let route = routes
        .iter()
        .find(|route| route.model == "rayu-future-model-9")
        .expect("future model must reach the picker routes");
    assert_eq!(route.api_method, "rayu");
    assert_eq!(route.provider, "Rayu");
    assert!(route.available);
    assert_eq!(
        rayucode_provider_core::ModelRouteApiMethod::parse(&route.api_method),
        rayucode_provider_core::ModelRouteApiMethod::Rayu
    );

    provider.set_model("rayu:rayu-future-model-9").unwrap();
    assert_eq!(provider.model(), "rayu-future-model-9");
    assert_eq!(provider.context_window(), 400_000);

    // Forced refresh must bypass the FRESH memory + disk cache and find a
    // model released after the first fetch.
    let summary = provider.refresh_model_catalog().await.unwrap();
    assert!(
        summary
            .models_added_names
            .contains(&"rayu-even-newer-10".to_string())
    );
    let switching = provider.available_models_for_switching();
    assert!(switching.contains(&"rayu-even-newer-10".to_string()));
    assert!(!switching.contains(&"rayu-future-model-9".to_string()));

    // Failure preserves the last good catalog.
    assert!(provider.refresh_model_catalog().await.is_err());
    assert!(
        provider
            .available_models_for_switching()
            .contains(&"rayu-even-newer-10".to_string())
    );

    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 3);
    for request in &captured {
        assert!(request.line.starts_with("GET /v1/models "));
        assert_eq!(
            request.header("authorization"),
            Some("Bearer rayu_sk_live_test_key_123")
        );
        assert_eq!(request.header("x-rayu-client"), Some("cli"));
        assert!(request.header("x-api-key").is_none());
    }
}

#[tokio::test]
async fn jwt_entitlements_catalog_separates_usable_from_visible() {
    let test = test_env();
    write_test_session();

    // REAL /me/entitlements schema (camelCase). "rayu-future-jwt" exists in
    // no fallback array.
    let first = r#"{
        "plan":{"code":"pro","name":"Pro","priceCents":2000,"availability":"active"},
        "features":{},
        "allowedModels":[
            {"code":"rayu-future-jwt","label":"Future JWT","description":"Released after this binary","contextWindow":300000,"supportsReasoning":true,"supportsImage":true,"supportsTools":true,"creditMultiplier":1.5}
        ],
        "hostedModels":[
            {"code":"rayu-future-jwt","label":"Future JWT","description":"Released after this binary","contextWindow":300000,"supportsReasoning":true,"supportsImage":true,"supportsTools":true,"creditMultiplier":1.5},
            {"code":"rayu-preview-only","label":"Preview Only","contextWindow":128000,"creditMultiplier":1.0}
        ],
        "subagentTiers":{"fast":"rayu-preview-only","balanced":"rayu-future-jwt","capable":"rayu-future-jwt"}
    }"#
        .to_string();
    let second = r#"{
        "plan":{"code":"pro","name":"Pro","priceCents":2000,"availability":"active"},
        "features":{},
        "allowedModels":[
            {"code":"rayu-future-jwt","contextWindow":300000,"creditMultiplier":1.5},
            {"code":"rayu-newer-jwt","label":"Newer JWT","contextWindow":350000,"creditMultiplier":1.0}
        ],
        "hostedModels":[
            {"code":"rayu-future-jwt","contextWindow":300000,"creditMultiplier":1.5},
            {"code":"rayu-newer-jwt","contextWindow":350000,"creditMultiplier":1.0},
            {"code":"rayu-preview-only","contextWindow":128000,"creditMultiplier":1.0}
        ]
    }"#
        .to_string();
    let (address, server) = spawn_mock(vec![
        ("200 OK", first),
        ("200 OK", second),
        (
            "503 Service Unavailable",
            r#"{"error":"temporary outage"}"#.to_string(),
        ),
    ]);
    test.env.set("RAYU_API_URL", format!("http://{address}"));

    let provider = RayuProvider::new();
    provider.prefetch_models().await.unwrap();

    // Default: allowedModels[0] (usable), not merely hostedModels[0].
    assert_eq!(provider.model(), "rayu-future-jwt");
    assert_eq!(provider.context_window(), 300_000);
    assert!(provider.supports_image_input());

    let routes = provider.model_routes();
    let usable = routes
        .iter()
        .find(|route| route.model == "rayu-future-jwt")
        .expect("entitled model must reach the picker");
    assert!(usable.available);
    assert_eq!(usable.api_method, "rayu");
    let preview = routes
        .iter()
        .find(|route| route.model == "rayu-preview-only")
        .expect("hosted-only model must still be VISIBLE");
    assert!(!preview.available);

    let switching = provider.available_models_for_switching();
    assert!(switching.contains(&"rayu-future-jwt".to_string()));
    assert!(!switching.contains(&"rayu-preview-only".to_string()));

    // Forced refresh bypasses the fresh cache and discovers a newer model.
    provider.refresh_model_catalog().await.unwrap();
    assert!(
        provider
            .available_models_for_switching()
            .contains(&"rayu-newer-jwt".to_string())
    );
    // Failure preserves the last good catalog.
    assert!(provider.refresh_model_catalog().await.is_err());
    assert!(
        provider
            .available_models_for_switching()
            .contains(&"rayu-newer-jwt".to_string())
    );

    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 3);
    for request in &captured {
        assert!(request.line.starts_with("GET /me/entitlements "));
        assert_eq!(
            request.header("authorization"),
            Some("Bearer jwt-test-token")
        );
        assert!(request.header("x-api-key").is_none());
    }
}

#[tokio::test]
async fn chat_streams_sse_with_bare_model_and_replays_once_after_401_refresh() {
    let test = test_env();
    write_test_session();

    let sse_body = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"model\":\"rayu-future-model-9\",\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" 世界\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    )
    .to_string();
    let refresh_body = format!(
        r#"{{"accessToken":"jwt-refreshed","refreshToken":"refresh-2","expiresAt":{}}}"#,
        now_ms() + 3_600_000
    );
    let (address, server) = spawn_mock(vec![
        (
            "401 Unauthorized",
            r#"{"error":{"type":"authentication_error","message":"expired"}}"#.to_string(),
        ),
        ("200 OK", refresh_body),
        ("200 OK", sse_body),
    ]);
    // Chat goes to the gateway; refresh goes to the api. One mock serves both.
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));
    test.env.set("RAYU_API_URL", format!("http://{address}"));

    let provider = RayuProvider::new();
    provider.set_model("rayu:rayu-future-model-9").unwrap();
    let stream = provider
        .complete(&user_message("hi"), &[], "system prompt", None)
        .await
        .unwrap();
    let items: Vec<_> = stream.collect().await;
    let events: Vec<StreamEvent> = items.into_iter().map(|item| item.unwrap()).collect();
    let text: String = events
        .iter()
        .filter_map(|event| match event {
            StreamEvent::TextDelta(text) => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "Hello 世界");
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::MessageEnd {
            stop_reason: Some(reason)
        } if reason == "end_turn"
    )));

    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 3);
    // First attempt: original JWT, bare model id, correct headers.
    assert!(captured[0].line.starts_with("POST /anthropic/v1/messages "));
    assert_eq!(
        captured[0].header("authorization"),
        Some("Bearer jwt-test-token")
    );
    assert_eq!(captured[0].header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(captured[0].header("x-rayu-client"), Some("cli"));
    assert!(captured[0].header("x-api-key").is_none());
    let sent: serde_json::Value = serde_json::from_str(&captured[0].body).unwrap();
    assert_eq!(sent["model"], "rayu-future-model-9");
    assert_eq!(sent["stream"], true);
    // Refresh used the session's refresh token.
    assert!(captured[1].line.starts_with("POST /cli/refresh "));
    let refresh: serde_json::Value = serde_json::from_str(&captured[1].body).unwrap();
    assert_eq!(refresh["refreshToken"], "refresh-test-token");
    // Replay carried the REFRESHED JWT.
    assert!(captured[2].line.starts_with("POST /anthropic/v1/messages "));
    assert_eq!(
        captured[2].header("authorization"),
        Some("Bearer jwt-refreshed")
    );
}

#[tokio::test]
async fn api_key_401_is_not_retried() {
    let test = test_env();
    test.env.set("RAYU_API_KEY", "rayu_sk_live_test_key_123");
    let (address, server) = spawn_mock(vec![(
        "401 Unauthorized",
        r#"{"error":{"type":"authentication_error","message":"invalid key"}}"#.to_string(),
    )]);
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));

    let provider = RayuProvider::new();
    let error = match provider.complete(&user_message("hi"), &[], "", None).await {
        Err(error) => error,
        Ok(_) => panic!("401 without a session must surface"),
    };
    assert!(is_unauthorized_text(&format!("{error:#}")));
    // Exactly one request: no refresh/replay is possible for an API key.
    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 1);
}

#[tokio::test]
async fn disk_cache_is_scoped_to_its_endpoint() {
    let test = test_env();
    test.env.set("RAYU_API_KEY", "rayu_sk_live_test_key_123");
    let (address_a, server_a) = spawn_mock(vec![(
        "200 OK",
        r#"{"object":"list","data":[{"id":"rayu-endpoint-a","object":"model","owned_by":"rayu"}]}"#
            .to_string(),
    )]);
    let (address_b, server_b) = spawn_mock(vec![(
        "200 OK",
        r#"{"object":"list","data":[{"id":"rayu-endpoint-b","object":"model","owned_by":"rayu"}]}"#
            .to_string(),
    )]);

    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address_a}"));
    let provider_a = RayuProvider::new();
    provider_a.prefetch_models().await.unwrap();
    assert!(
        provider_a
            .available_models_for_switching()
            .contains(&"rayu-endpoint-a".to_string())
    );

    // Same cache home, DIFFERENT endpoint: the fresh cache from endpoint A
    // must not be served; endpoint B must be fetched live.
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address_b}"));
    let provider_b = RayuProvider::new();
    provider_b.prefetch_models().await.unwrap();
    let switching = provider_b.available_models_for_switching();
    assert!(switching.contains(&"rayu-endpoint-b".to_string()));
    assert!(!switching.contains(&"rayu-endpoint-a".to_string()));

    assert_eq!(server_a.join().unwrap().len(), 1);
    assert_eq!(server_b.join().unwrap().len(), 1);
}

#[tokio::test]
async fn disk_cache_is_scoped_to_api_key() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![
        (
            "200 OK",
            r#"{"object":"list","data":[{"id":"rayu-key-a-model","object":"model","owned_by":"rayu"}]}"#
                .to_string(),
        ),
        (
            "200 OK",
            r#"{"object":"list","data":[{"id":"rayu-key-b-model","object":"model","owned_by":"rayu"}]}"#
                .to_string(),
        ),
    ]);
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));

    test.env.set("RAYU_API_KEY", "rayu_sk_live_key_alpha");
    let provider_a = RayuProvider::new();
    provider_a.prefetch_models().await.unwrap();
    assert_eq!(
        provider_a.available_models_for_switching(),
        vec!["rayu-key-a-model".to_string()]
    );

    // Same endpoint, different API key: key A's cached catalog must not leak.
    test.env.set("RAYU_API_KEY", "rayu_sk_live_key_beta");
    let provider_b = RayuProvider::new();
    assert!(provider_b.available_models_for_switching().is_empty());
    provider_b.prefetch_models().await.unwrap();
    assert_eq!(
        provider_b.available_models_for_switching(),
        vec!["rayu-key-b-model".to_string()]
    );

    assert_eq!(server.join().unwrap().len(), 2);
}

#[tokio::test]
async fn cold_start_complete_prefetches_live_model_and_preserves_error_detail_on_line_one() {
    let test = test_env();
    test.env.set("RAYU_API_KEY", "rayu_sk_live_cold_start_test");
    let (address, server) = spawn_mock(vec![
        (
            "200 OK",
            r#"{"object":"list","data":[{"id":"deepseek-v4.1-flash-1017-cloud","object":"model","owned_by":"rayu","label":"DeepSeek-V4.1-flash","description":"Credits x0.5","contextWindow":1000000}]}"#
                .to_string(),
        ),
        (
            "400 Bad Request",
            r#"{"error":{"type":"invalid_request_error","message":"model not enabled for this key"}}"#
                .to_string(),
        ),
    ]);
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));

    let provider = RayuProvider::new();
    assert_eq!(provider.model(), "");
    let err = match provider.complete(&user_message("hi"), &[], "", None).await {
        Err(err) => err,
        Ok(_) => panic!("expected HTTP 400 gateway error"),
    };
    assert_eq!(provider.model(), "deepseek-v4.1-flash-1017-cloud");
    let first_line = err
        .to_string()
        .lines()
        .next()
        .unwrap_or_default()
        .to_string();
    assert!(
        first_line.contains("HTTP 400") && first_line.contains("model not enabled for this key"),
        "first error line must preserve status and gateway message, got: {first_line}"
    );

    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 2);
    assert!(captured[0].line.starts_with("GET /v1/models "));
    assert!(captured[1].line.starts_with("POST /anthropic/v1/messages "));
    let sent: serde_json::Value = serde_json::from_str(&captured[1].body).unwrap();
    assert_eq!(sent["model"], "deepseek-v4.1-flash-1017-cloud");
}

#[test]
fn model_selection_strips_route_prefix_and_rejects_empty() {
    let _test = test_env();
    let provider = RayuProvider::new();
    // No credentials and no cached live catalog: never fabricate dead fallback IDs.
    assert_eq!(provider.model(), "");
    provider.set_model("rayu:rayu-future-model-9").unwrap();
    assert_eq!(provider.model(), "rayu-future-model-9");
    provider
        .set_model("deepseek-v4.1-flash-1017-cloud")
        .unwrap();
    assert_eq!(provider.model(), "deepseek-v4.1-flash-1017-cloud");
    assert!(provider.set_model("rayu:").is_err());
    assert!(provider.set_model("  ").is_err());
}

#[test]
fn routes_keep_stable_ids_and_rayu_owns_tools() {
    let _test = test_env();
    let provider = RayuProvider::new();
    // Without a live or cached catalog, routes are empty rather than dead hardcoded IDs.
    assert!(provider.model_routes().is_empty());
    assert!(!provider.handles_tools_internally());
    assert!(provider.supports_compaction());
    assert_eq!(provider.name(), "rayu");
    assert_eq!(provider.display_name(), "Rayu");
    assert_eq!(provider.transport().as_deref(), Some("HTTPS (SSE)"));
    let fork = provider.fork();
    assert_eq!(fork.model(), provider.model());
    assert!(!RayuProvider::has_credentials());
}

#[test]
fn classifies_401_messages() {
    assert!(is_unauthorized_text(
        "Rayu gateway request failed\n  status: 401 Unauthorized\n  response: {}"
    ));
    assert!(is_unauthorized_text(
        "Rayu gateway stream error: authentication_error"
    ));
    assert!(!is_unauthorized_text("status: 429 Too Many Requests"));
    assert!(!is_unauthorized_text("processed 401 tokens"));
}

#[test]
fn bearer_endpoints_are_validated_before_send() {
    assert!(
        ensure_safe_bearer_endpoint("https://gateway.rayucode.com/anthropic/v1/messages").is_ok()
    );
    assert!(ensure_safe_bearer_endpoint("http://127.0.0.1:8080/v1/models").is_ok());
    assert!(ensure_safe_bearer_endpoint("http://localhost:8080/v1/models").is_ok());
    assert!(ensure_safe_bearer_endpoint("http://[::1]:8080/v1/models").is_ok());
    assert!(ensure_safe_bearer_endpoint("http://evil.example.com/v1/models").is_err());
    assert!(ensure_safe_bearer_endpoint("https://user:pass@gateway.rayucode.com/v1").is_err());
    assert!(ensure_safe_bearer_endpoint("ftp://gateway.rayucode.com/v1").is_err());
}

fn stream_of(items: Vec<Result<StreamEvent>>) -> EventStream {
    Box::pin(futures::stream::iter(items))
}

#[tokio::test]
async fn retries_once_on_401_before_output() {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let stream = AuthRetryStream {
        inner: stream_of(vec![Err(anyhow::anyhow!("status: 401 Unauthorized"))]),
        retry: Some(Box::new(move || -> RetryFuture {
            counter.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(stream_of(vec![Ok(StreamEvent::TextDelta("hi".into()))])) })
        })),
        pending: None,
        saw_output: false,
    };
    let items: Vec<_> = stream.collect().await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(items.len(), 1);
    assert!(matches!(&items[0], Ok(StreamEvent::TextDelta(text)) if text == "hi"));
}

#[tokio::test]
async fn does_not_retry_after_output_or_twice() {
    let stream = AuthRetryStream {
        inner: stream_of(vec![
            Ok(StreamEvent::TextDelta("partial".into())),
            Err(anyhow::anyhow!("status: 401 Unauthorized")),
        ]),
        retry: Some(Box::new(|| -> RetryFuture { panic!("must not retry") })),
        pending: None,
        saw_output: false,
    };
    let items: Vec<_> = stream.collect().await;
    assert_eq!(items.len(), 2);
    assert!(items[1].is_err());

    let stream = AuthRetryStream {
        inner: stream_of(vec![Err(anyhow::anyhow!("status: 401 Unauthorized"))]),
        retry: Some(Box::new(|| -> RetryFuture {
            Box::pin(async { Ok(stream_of(vec![Err(anyhow::anyhow!("status: 401 again"))])) })
        })),
        pending: None,
        saw_output: false,
    };
    let items: Vec<_> = stream.collect().await;
    assert_eq!(items.len(), 1);
    assert!(items[0].is_err());
}
