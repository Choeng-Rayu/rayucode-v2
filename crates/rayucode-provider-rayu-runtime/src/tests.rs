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
    "RAYU_CLIENT_PRODUCT",
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
    env.remove("RAYU_CLIENT_PRODUCT");
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
    let with_default_headers = responses
        .into_iter()
        .map(|(status, body)| {
            // Capacity answers carry a short Retry-After, as the gateway sends.
            let extra = if status.starts_with("429") || status.starts_with("503") {
                "Retry-After: 1\r\n"
            } else {
                ""
            };
            (status, extra, body)
        })
        .collect();
    spawn_mock_with_headers(with_default_headers)
}

/// Variant of [`spawn_mock`] allowing custom response headers (e.g.
/// `X-Rayu-Limit`, `x-should-retry`, `Retry-After`) per response.
fn spawn_mock_with_headers(
    responses: Vec<(&'static str, &'static str, String)>,
) -> (
    std::net::SocketAddr,
    std::thread::JoinHandle<Vec<CapturedRequest>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        let mut captured = Vec::new();
        for (status, extra_headers, body) in responses {
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
            if status == TRUNCATED_CHUNKED {
                // One chunk, then close WITHOUT the terminating `0\r\n\r\n`:
                // the shape of a connection cut mid-stream by an
                // intermediary or a restarting gateway.
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n",
                    body.len()
                )
                .unwrap();
                stream.flush().unwrap();
                continue;
            }
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {body_len}\r\n{extra_headers}Connection: close\r\n\r\n"
            )
            .unwrap();
            stream.write_all(body.as_bytes()).unwrap();
        }
        captured
    });
    (address, handle)
}

/// Pseudo-status for [`spawn_mock`]: answer 200 with a chunked SSE body that is
/// cut off before its final chunk.
const TRUNCATED_CHUNKED: &str = "truncated-chunked";

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

fn complete_sse(text: &str) -> String {
    format!(
        concat!(
            "event: message_start\n",
            "data: {{\"type\":\"message_start\",\"message\":{{\"usage\":{{\"input_tokens\":10,\"output_tokens\":1}}}}}}\n\n",
            "event: content_block_start\n",
            "data: {{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{{\"type\":\"text\",\"text\":\"\"}}}}\n\n",
            "event: content_block_delta\n",
            "data: {{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{{\"type\":\"text_delta\",\"text\":\"{}\"}}}}\n\n",
            "event: content_block_stop\n",
            "data: {{\"type\":\"content_block_stop\",\"index\":0}}\n\n",
            "event: message_delta\n",
            "data: {{\"type\":\"message_delta\",\"delta\":{{\"stop_reason\":\"end_turn\"}},\"usage\":{{\"output_tokens\":7}}}}\n\n",
            "event: message_stop\n",
            "data: {{\"type\":\"message_stop\"}}\n\n",
        ),
        text
    )
}

/// The start of a response, cut before any model output.
const PREFIX_NO_OUTPUT: &str = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\n\n";

/// The start of a response, cut after partial text.
const PREFIX_PARTIAL_TEXT: &str = concat!(
    "event: content_block_start\n",
    "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
    "event: content_block_delta\n",
    "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"partial \"}}\n\n",
);

fn joined_text(events: &[StreamEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            StreamEvent::TextDelta(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

/// Mirrors how the turn handler consumes `RetryRollback`: drop everything
/// accumulated so far.
fn text_after_rollback(events: &[StreamEvent]) -> String {
    let start = events
        .iter()
        .rposition(|event| matches!(event, StreamEvent::RetryRollback { .. }))
        .map_or(0, |index| index + 1);
    joined_text(&events[start..])
}

fn api_key_provider(test: &TestEnv, address: std::net::SocketAddr) -> RayuProvider {
    test.env.set("RAYU_API_KEY", "rayu_sk_live_test_key_123");
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));
    let provider = RayuProvider::new();
    provider.set_model("rayu:deepseek-test").unwrap();
    provider
}

#[tokio::test]
async fn truncated_body_before_output_is_replayed_with_correlation_headers() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![
        (TRUNCATED_CHUNKED, PREFIX_NO_OUTPUT.to_string()),
        ("200 OK", complete_sse("recovered")),
    ]);
    let provider = api_key_provider(&test, address);
    let stream = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .unwrap();
    let items: Vec<_> = stream.collect().await;
    let events: Vec<StreamEvent> = items.into_iter().map(|item| item.unwrap()).collect();
    assert_eq!(text_after_rollback(&events), "recovered");
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, StreamEvent::RetryRollback { .. })),
        "a pre-output replay needs no rollback"
    );
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::ConnectionPhase {
            phase: rayucode_message_types::ConnectionPhase::Retrying { attempt: 2, max: 3 }
        }
    )));

    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 2);
    let first_id = captured[0].header("x-rayu-request-id").unwrap();
    let second_id = captured[1].header("x-rayu-request-id").unwrap();
    assert!(first_id.starts_with("rv2_"));
    assert_ne!(first_id, second_id, "each physical attempt gets its own id");
    let logical = captured[0].header("x-rayu-logical-request-id").unwrap();
    assert_eq!(
        captured[1].header("x-rayu-logical-request-id"),
        Some(logical),
        "the logical id is stable across replays"
    );
    assert_eq!(
        captured[0].header("x-rayu-query-source"),
        Some("rayucode_v2_agent")
    );
}

#[tokio::test]
async fn truncated_body_after_output_rolls_back_then_replays() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![
        (TRUNCATED_CHUNKED, PREFIX_PARTIAL_TEXT.to_string()),
        ("200 OK", complete_sse("full answer")),
    ]);
    let provider = api_key_provider(&test, address);
    let stream = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .unwrap();
    let items: Vec<_> = stream.collect().await;
    let events: Vec<StreamEvent> = items.into_iter().map(|item| item.unwrap()).collect();
    let rollback = events
        .iter()
        .position(|event| matches!(event, StreamEvent::RetryRollback { attempt: 2, max: 3 }))
        .expect("partial output must be rolled back before the replay");
    assert_eq!(joined_text(&events[..rollback]), "partial ");
    assert_eq!(text_after_rollback(&events), "full answer");
    assert_eq!(server.join().unwrap().len(), 2);
}

#[tokio::test]
async fn persistent_truncation_surfaces_the_full_error_chain_after_bounded_attempts() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![
        (TRUNCATED_CHUNKED, PREFIX_NO_OUTPUT.to_string()),
        (TRUNCATED_CHUNKED, PREFIX_NO_OUTPUT.to_string()),
        (TRUNCATED_CHUNKED, PREFIX_NO_OUTPUT.to_string()),
    ]);
    let provider = api_key_provider(&test, address);
    let stream = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .unwrap();
    let items: Vec<_> = stream.collect().await;
    let error = items
        .iter()
        .find_map(|item| item.as_ref().err())
        .expect("the last failure must surface");
    // `to_string()` is what the turn handler logs: it must carry the cause.
    let shown = error.to_string();
    eprintln!("surfaced error: {shown}");
    assert!(
        shown.to_ascii_lowercase().contains("eof")
            || shown.to_ascii_lowercase().contains("incomplete")
            || shown.to_ascii_lowercase().contains("closed"),
        "the underlying cause must be visible: {shown}"
    );
    assert!(shown.contains("error decoding response body"), "{shown}");
    assert!(shown.contains("request_id=rv2_"), "{shown}");
    assert!(shown.contains("bytes_read="), "{shown}");
    assert_eq!(server.join().unwrap().len(), retry::MAX_ATTEMPTS as usize);
}

#[tokio::test]
async fn gateway_upstream_ended_event_is_replayed() {
    let test = test_env();
    let broken = format!(
        "{PREFIX_NO_OUTPUT}event: error\ndata: {{\"type\":\"error\",\"error\":{{\"type\":\"api_error\",\"message\":\"The model provider ended the response unexpectedly.\"}}}}\n\n"
    );
    let (address, server) = spawn_mock(vec![
        ("200 OK", broken),
        ("200 OK", complete_sse("second try")),
    ]);
    let provider = api_key_provider(&test, address);
    let stream = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .unwrap();
    let items: Vec<_> = stream.collect().await;
    let events: Vec<StreamEvent> = items.into_iter().map(|item| item.unwrap()).collect();
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, StreamEvent::Error { .. })),
        "a replayed gateway error must not reach the turn"
    );
    assert_eq!(text_after_rollback(&events), "second try");
    assert_eq!(server.join().unwrap().len(), 2);
}

/// A 503 "model temporarily unavailable" (all of a provider's keys busy) before
/// any output is waited out using the gateway's Retry-After, and the same turn
/// completes on the next attempt instead of failing the swarm worker.
#[tokio::test]
async fn a_capacity_503_before_output_is_waited_out_and_the_turn_completes() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![
        (
            "503 Service Unavailable",
            r#"{"error":{"message":"model temporarily unavailable: deepseek-test"}}"#.to_string(),
        ),
        ("200 OK", complete_sse("after the wait")),
    ]);
    let provider = api_key_provider(&test, address);
    let started = std::time::Instant::now();
    let stream = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .unwrap();
    let items: Vec<_> = stream.collect().await;
    let events: Vec<StreamEvent> = items.into_iter().map(|item| item.unwrap()).collect();
    assert_eq!(text_after_rollback(&events), "after the wait");
    assert!(
        started.elapsed() >= Duration::from_millis(900),
        "the gateway's Retry-After is honoured"
    );
    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 2);
    assert_eq!(
        captured[0].header("x-rayu-logical-request-id"),
        captured[1].header("x-rayu-logical-request-id"),
        "the retry is the same logical request"
    );
}

#[tokio::test]
async fn a_429_before_output_is_retried() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![
        (
            "429 Too Many Requests",
            r#"{"error":{"message":"rate limited"}}"#.to_string(),
        ),
        ("200 OK", complete_sse("ok")),
    ]);
    let provider = api_key_provider(&test, address);
    let stream = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .unwrap();
    let items: Vec<_> = stream.collect().await;
    assert!(items.iter().all(|i| i.is_ok()));
    assert_eq!(server.join().unwrap().len(), 2);
}

#[tokio::test]
async fn http_status_errors_are_not_transport_retried() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![(
        "504 Gateway Timeout",
        r#"{"error":{"message":"upstream timeout"}}"#.to_string(),
    )]);
    let provider = api_key_provider(&test, address);
    let error = match provider.complete(&user_message("hi"), &[], "", None).await {
        Err(error) => error,
        Ok(_) => panic!("a 504 must surface"),
    };
    let shown = format!("{error:#}");
    assert!(shown.contains("HTTP 504"), "{shown}");
    assert!(shown.contains("request_id: rv2_"), "{shown}");
    assert_eq!(server.join().unwrap().len(), 1);
}

#[tokio::test]
async fn transport_error_after_message_end_does_not_replay() {
    let open: retry::OpenFn =
        Arc::new(|| -> RetryFuture { panic!("a finished message must not be replayed") });
    let stream = retry::transport_retry_stream(
        stream_of(vec![
            Ok(StreamEvent::TextDelta("done".into())),
            Ok(StreamEvent::MessageEnd {
                stop_reason: Some("end_turn".into()),
            }),
            Err(anyhow::anyhow!(
                "Rayu gateway stream transport error: error decoding response body: unexpected EOF"
            )),
        ]),
        open,
        1,
    );
    let items: Vec<_> = stream.collect().await;
    assert_eq!(items.len(), 2);
    assert!(items.iter().all(|item| item.is_ok()));
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

#[test]
fn only_short_capacity_denials_are_waited_out() {
    use retry::is_transient_capacity as t;
    let short = Some(Duration::from_secs(3));
    // The gateway's "every slot busy" answers and a 503 with no usable route.
    assert!(t(429, r#"{"error":{"type":"rate_limit_exceeded"}}"#, short));
    assert!(t(
        503,
        r#"{"error":{"message":"model temporarily unavailable: x"}}"#,
        Some(Duration::from_secs(30))
    ));
    assert!(t(
        429,
        r#"{"reason":"concurrency","transient":true}"#,
        short
    ));
    assert!(t(429, r#"{"reason":"account_rate_limit"}"#, short));
    // Balance and quota states a short wait cannot clear.
    assert!(!t(
        429,
        r#"{"reason":"daily_turn_limit","resetSeconds":40000}"#,
        Some(Duration::from_secs(60))
    ));
    assert!(!t(429, r#"{"reason":"daily_turn_limit"}"#, None));
    assert!(!t(
        429,
        r#"{"reason":"weekly_limit","transient":false}"#,
        short
    ));
    assert!(!t(429, r#"{"reason":"api_key_credit_limit"}"#, None));
    assert!(!t(
        429,
        r#"{"reason":"api_key_rpm_limit"}"#,
        Some(Duration::from_secs(60))
    ));
    // Admin-authored custom model notices (`rayu_custom: true`) surface immediately.
    assert!(!t(
        503,
        r#"{"type":"error","error":{"type":"provider_unavailable","message":"Maintenance until 15:00 UTC","rayu_custom":true}}"#,
        short
    ));
    assert!(!t(
        429,
        r#"{"error":{"type":"provider_unavailable","message":"Model paused by admin","rayu_custom":true}}"#,
        None
    ));
    // A long Retry-After is a quota window even without a reason.
    assert!(!t(429, "{}", Some(Duration::from_secs(45))));
    // Never for other statuses.
    assert!(!t(500, "{}", short));
    assert!(!t(400, "{}", short));
}

#[tokio::test]
async fn a_daily_turn_limit_429_is_surfaced_immediately() {
    let test = test_env();
    let (address, server) = spawn_mock(vec![(
        "429 Too Many Requests",
        r#"{"error":{"message":"daily turn limit reached","type":"rate_limit_exceeded"},"reason":"daily_turn_limit","resetSeconds":40000}"#.to_string(),
    )]);
    let provider = api_key_provider(&test, address);
    let started = std::time::Instant::now();
    let error = match provider.complete(&user_message("hi"), &[], "", None).await {
        Err(error) => error,
        Ok(_) => panic!("a daily-turn limit must surface"),
    };
    assert!(
        format!("{error:#}").contains("daily turn limit"),
        "{error:#}"
    );
    assert!(
        started.elapsed() < Duration::from_millis(900),
        "no wait for a quota state"
    );
    assert_eq!(server.join().unwrap().len(), 1);
}

#[tokio::test]
async fn rayu_reasoning_effort_session_id_split_system_and_model_detail_end_to_end() {
    let test = test_env();
    test.env.set("RAYU_API_KEY", "rayu_sk_live_effort_test");
    let models_body = r#"{"object":"list","data":[
        {"id":"deepseek-v4.1-flash-1017-cloud","object":"model","owned_by":"rayu","label":"DeepSeek-V4.1-flash:lastest","description":"Credits x0.5(discount 30%)","contextWindow":1000000,"maxOutputTokens":64000,"creditMultiplier":0.5,"supportsReasoning":true,"supportsImage":false,"supportsTools":true},
        {"id":"deepseek-non-reason","object":"model","owned_by":"rayu","label":"Fast Plain","contextWindow":128000,"supportsReasoning":false,"supportsImage":false,"supportsTools":false}
    ]}"#
        .to_string();
    let (address, server) = spawn_mock(vec![
        ("200 OK", models_body),
        ("200 OK", complete_sse("reasoned answer")),
    ]);
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));

    let provider = RayuProvider::new();
    provider.prefetch_models().await.unwrap();
    provider
        .set_model("rayu:deepseek-v4.1-flash-1017-cloud")
        .unwrap();

    // Model picker route detail matches rayu-cli metadata format.
    let routes = provider.model_routes();
    let ds = routes
        .iter()
        .find(|r| r.model == "deepseek-v4.1-flash-1017-cloud")
        .unwrap();
    assert_eq!(
        ds.detail,
        "Credits x0.5(discount 30%) · rayu-hosted · DeepSeek-V4.1-flash:lastest · 1M ctx"
    );

    // Reasoning effort works end-to-end on reasoning-capable models.
    assert!(provider.available_efforts().contains(&"high"));
    provider.set_reasoning_effort("high").unwrap();
    assert_eq!(provider.reasoning_effort().as_deref(), Some("high"));

    // Session id and split system prompts are sent on the wire.
    provider.set_session_id("sess_rayu_sticky_42");
    let messages = vec![
        Message {
            role: rayucode_message_types::Role::User,
            content: vec![rayucode_message_types::ContentBlock::Text {
                text: "check file".into(),
                cache_control: None,
            }],
            timestamp: None,
            tool_duration_ms: None,
        },
        Message {
            role: rayucode_message_types::Role::Assistant,
            content: vec![rayucode_message_types::ContentBlock::ToolUse {
                id: "toolu_g3".into(),
                name: "read".into(),
                input: serde_json::json!({"path": "a.rs"}),
                thought_signature: Some("SIG_GEMINI_3".into()),
            }],
            timestamp: None,
            tool_duration_ms: None,
        },
        Message {
            role: rayucode_message_types::Role::User,
            content: vec![rayucode_message_types::ContentBlock::ToolResult {
                tool_use_id: "toolu_g3".into(),
                content: "fn main() {}".into(),
                is_error: None,
            }],
            timestamp: None,
            tool_duration_ms: None,
        },
    ];
    let stream = provider
        .complete_split(&messages, &[], "STATIC_SYS", "DYNAMIC_SYS", None)
        .await
        .unwrap();
    let events: Vec<_> = stream.collect().await;
    assert!(events.iter().all(|item| item.is_ok()));

    // Non-reasoning model rejects effort and clears stored effort on switch.
    provider.set_model("deepseek-non-reason").unwrap();
    assert!(provider.available_efforts().is_empty());
    assert_eq!(provider.reasoning_effort(), None);
    assert!(provider.set_reasoning_effort("high").is_err());

    let captured = server.join().unwrap();
    assert_eq!(captured.len(), 2);
    assert_eq!(
        captured[1].header("x-rayu-session-id"),
        Some("sess_rayu_sticky_42")
    );
    assert_eq!(
        captured[1].header("x-rayu-intended-model"),
        Some("deepseek-v4.1-flash-1017-cloud")
    );
    let sent: serde_json::Value = serde_json::from_str(&captured[1].body).unwrap();
    assert_eq!(sent["max_tokens"], 64000);
    assert_eq!(sent["thinking"]["type"], "enabled");
    assert_eq!(sent["thinking"]["budget_tokens"], 16384);
    assert_eq!(sent["output_config"]["effort"], "high");
    // Static system block carries cache_control; dynamic block stays uncached.
    assert_eq!(sent["system"][0]["text"], "STATIC_SYS");
    assert_eq!(sent["system"][0]["cache_control"]["type"], "ephemeral");
    assert_eq!(sent["system"][1]["text"], "DYNAMIC_SYS");
    assert!(sent["system"][1].get("cache_control").is_none());
    // Gemini-3 thought_signature survives replay on ToolUse.
    assert_eq!(
        sent["messages"][1]["content"][0]["thought_signature"],
        "SIG_GEMINI_3"
    );
}

#[tokio::test]
async fn rayu_provider_uses_admin_max_input_tokens_for_context_budget_while_keeping_context_label() {
    let test = test_env();
    test.env.set("RAYU_API_KEY", "rayu_sk_live_limits_test");
    let models_body = r#"{"object":"list","data":[
        {"id":"gpt-5-hosted","object":"model","owned_by":"rayu","label":"GPT-5 Hosted","contextWindow":400000,"maxInputTokens":272000,"maxOutputTokens":96000,"supportsReasoning":true,"supportsImage":true,"supportsTools":true}
    ]}"#
        .to_string();
    let (address, server) = spawn_mock(vec![
        ("200 OK", models_body),
        ("200 OK", complete_sse("ok")),
    ]);
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address}"));

    let provider = RayuProvider::new();
    provider.prefetch_models().await.unwrap();
    provider.set_model("gpt-5-hosted").unwrap();

    // Auto-compaction window follows admin maxInputTokens (272k), not 400k total.
    assert_eq!(provider.context_window(), 272_000);
    // Model picker keeps the advertised contextWindow label (400K ctx).
    let route = provider
        .model_routes()
        .into_iter()
        .find(|r| r.model == "gpt-5-hosted")
        .unwrap();
    assert!(route.detail.contains("400K ctx"), "detail={}", route.detail);

    // Request max_tokens uses admin maxOutputTokens (96k).
    let stream = provider
        .complete(&[Message::user("hi")], &[], "sys", None)
        .await
        .unwrap();
    let events: Vec<_> = stream.collect().await;
    assert!(events.iter().all(|item| item.is_ok()));

    let captured = server.join().unwrap();
    let sent: serde_json::Value = serde_json::from_str(&captured[1].body).unwrap();
    assert_eq!(sent["max_tokens"], 96_000);
}

#[tokio::test]
async fn gateway_errors_surface_exact_structured_messages_for_rayu_auth_and_api_key() {
    let test = test_env();
    // 1. API key 403 scope restriction vs 429 credit cap vs 503 custom notice (x-should-retry: false)
    let (address, server) = spawn_mock_with_headers(vec![
        (
            "403 Forbidden",
            "",
            r#"{"error":{"message":"model not allowed for this API key: claude-opus-4-6","type":"permission_error"}}"#
                .to_string(),
        ),
        (
            "429 Too Many Requests",
            "Retry-After: 3600\r\n",
            r#"{"error":{"message":"API key credit limit reached for this billing period","type":"rate_limit_exceeded"},"reason":"api_key_credit_limit","creditLimit":25}"#
                .to_string(),
        ),
        (
            "503 Service Unavailable",
            "x-should-retry: false\r\n",
            r#"{"type":"error","error":{"type":"provider_unavailable","message":"Maintenance window active.","rayu_custom":true}}"#
                .to_string(),
        ),
        (
            "400 Bad Request",
            "",
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"Model \"deepseek-test\" cannot read images.","rayu_code":"model_no_image_support"}}"#
                .to_string(),
        ),
    ]);
    let provider = api_key_provider(&test, address);

    let err_scope = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_scope.contains("claude-opus-4-6") && err_scope.contains("/dashboard/api-keys"),
        "{err_scope}"
    );
    assert!(!err_scope.contains("/plans"), "{err_scope}");

    let err_cap = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_cap.contains("25 credits") && err_cap.contains("/dashboard/api-keys"),
        "{err_cap}"
    );

    let err_custom = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_custom.contains("Maintenance window active.") && err_custom.contains("/model"),
        "{err_custom}"
    );

    let err_img = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_img.contains("cannot read images") && err_img.contains("/model"),
        "{err_img}"
    );
    assert_eq!(server.join().unwrap().len(), 4);

    // 2. Rayu Auth (JWT): 402 team_plan_required, 403 plan gate, 429 personal weekly_limit,
    //    429 team weekly_limit, 429 period_limit with X-Rayu-Limit header (no retry).
    test.env.remove("RAYU_API_KEY");
    write_test_session();
    let (address2, server2) = spawn_mock_with_headers(vec![
        (
            "402 Payment Required",
            "",
            r#"{"error":{"message":"This team has no credit until you buy a team plan.","type":"team_plan_required"}}"#
                .to_string(),
        ),
        (
            "403 Forbidden",
            "",
            r#"{"error":{"message":"model not available on your plan: deepseek-test","type":"permission_error"}}"#
                .to_string(),
        ),
        (
            "429 Too Many Requests",
            "X-Rayu-Limit: weekly_limit\r\nRetry-After: 86400\r\n",
            r#"{"error":{"message":"you've used this week's credit allowance","type":"rate_limit_exceeded"},"reason":"weekly_limit","transient":false,"resetSeconds":86400}"#
                .to_string(),
        ),
        (
            "429 Too Many Requests",
            "X-Rayu-Limit: weekly_limit\r\nRetry-After: 86400\r\n",
            r#"{"error":{"message":"you've used your share","type":"rate_limit_exceeded"},"reason":"weekly_limit","transient":false,"resetSeconds":86400,"scope":"team"}"#
                .to_string(),
        ),
        (
            "429 Too Many Requests",
            "X-Rayu-Limit: period_limit\r\nRetry-After: 2\r\n",
            r#"{"error":{"message":"credit limit reached: period_limit","type":"rate_limit_exceeded"}}"#
                .to_string(),
        ),
    ]);
    test.env
        .set("RAYU_GATEWAY_URL", format!("http://{address2}"));
    let jwt_provider = RayuProvider::new();
    jwt_provider.set_model("deepseek-test").unwrap();

    let err_402 = jwt_provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_402.contains("HTTP 402") && err_402.contains("/plans"),
        "{err_402}"
    );

    let err_plan = jwt_provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_plan.contains("not available on your current Rayu plan")
            && err_plan.contains("/plans"),
        "{err_plan}"
    );

    let err_weekly = jwt_provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_weekly.contains("use all credits")
            && err_weekly.contains("one-way until weekly reset"),
        "{err_weekly}"
    );

    let err_team_weekly = jwt_provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_team_weekly.contains("team admin") && !err_team_weekly.contains("use all credits"),
        "{err_team_weekly}"
    );

    // Even with a short Retry-After: 2, X-Rayu-Limit: period_limit must NOT retry.
    let err_period = jwt_provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err_period.contains("credit limit for this billing period")
            && err_period.contains("/plans"),
        "{err_period}"
    );
    assert_eq!(server2.join().unwrap().len(), 5);
}

#[tokio::test]
async fn gateway_ingress_and_auth_unavailable_503_are_retried_cleanly() {
    let test = test_env();
    let (address, server) = spawn_mock_with_headers(vec![
        (
            "503 Service Unavailable",
            "Retry-After: 1\r\n",
            r#"{"error":{"type":"provider_unavailable","message":"Too many requests. Please retry shortly."},"reason":"authentication_unavailable"}"#
                .to_string(),
        ),
        (
            "429 Too Many Requests",
            "Retry-After: 1\r\n",
            r#"{"error":{"type":"rate_limit_exceeded","message":"Too many requests. Please retry shortly."},"reason":"ingress_rate_limit"}"#
                .to_string(),
        ),
        ("200 OK", "", complete_sse("recovered after ingress")),
    ]);
    let provider = api_key_provider(&test, address);
    let stream = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .unwrap();
    let events: Vec<StreamEvent> = stream
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .map(|item| item.unwrap())
        .collect();
    assert_eq!(text_after_rollback(&events), "recovered after ingress");
    assert_eq!(server.join().unwrap().len(), 3);
}

#[tokio::test]
async fn gateway_headers_honor_client_product_and_401_refresh_distinguishes_outage_from_expiry() {
    let test = test_env();
    write_test_session();
    test.env.set("RAYU_CLIENT_PRODUCT", "rayucode");

    // Case 1: gateway 401 -> backend /cli/refresh 503 (transient outage) keeps session
    // intact and must NOT tell the user their session expired.
    let (addr1, server1) = spawn_mock_with_headers(vec![
        (
            "401 Unauthorized",
            "",
            r#"{"error":{"type":"authentication_error","message":"invalid token"}}"#.to_string(),
        ),
        (
            "503 Service Unavailable",
            "",
            r#"{"error":{"message":"backend restarting"}}"#.to_string(),
        ),
    ]);
    test.env.set("RAYU_GATEWAY_URL", format!("http://{addr1}"));
    test.env.set("RAYU_API_URL", format!("http://{addr1}"));
    let provider = RayuProvider::new();
    provider.set_model("deepseek-test").unwrap();

    let err = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err.contains("Could not renew your Rayu session"),
        "transient refresh outage must not blame expired session: {err}"
    );
    assert!(
        rayucode_base::rayu::has_usable_session(),
        "transient refresh outage must preserve session file"
    );
    let captured1 = server1.join().unwrap();
    assert_eq!(captured1[0].header("x-rayu-client"), Some("rayucode"));
    assert_eq!(
        captured1[0].header("x-rayu-resolved-model"),
        Some("deepseek-test")
    );
    assert!(captured1[0].header("x-rayu-client-app-version").is_some());

    // Case 2: gateway 401 -> backend /cli/refresh 200 -> gateway still 401
    // must report "gateway rejected your renewed session" and keep the fresh session.
    let refreshed = format!(
        r#"{{"accessToken":"jwt-fresh-2","refreshToken":"refresh-2","expiresAt":{}}}"#,
        now_ms() + 3_600_000
    );
    let (addr2, server2) = spawn_mock_with_headers(vec![
        (
            "401 Unauthorized",
            "",
            r#"{"error":{"type":"authentication_error","message":"invalid token"}}"#.to_string(),
        ),
        ("200 OK", "", refreshed),
        (
            "401 Unauthorized",
            "",
            r#"{"error":{"type":"authentication_error","message":"invalid token"}}"#.to_string(),
        ),
    ]);
    test.env.set("RAYU_GATEWAY_URL", format!("http://{addr2}"));
    test.env.set("RAYU_API_URL", format!("http://{addr2}"));
    let err2 = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err2.contains("gateway rejected your renewed session"),
        "{err2}"
    );
    assert!(rayucode_base::rayu::has_usable_session());
    assert_eq!(server2.join().unwrap().len(), 3);

    // Case 3: gateway 401 -> backend /cli/refresh 401 clears session and reports expired.
    let (addr3, server3) = spawn_mock_with_headers(vec![
        (
            "401 Unauthorized",
            "",
            r#"{"error":{"type":"authentication_error","message":"invalid token"}}"#.to_string(),
        ),
        (
            "401 Unauthorized",
            "",
            r#"{"statusCode":401,"message":"Invalid refresh token"}"#.to_string(),
        ),
    ]);
    test.env.set("RAYU_GATEWAY_URL", format!("http://{addr3}"));
    test.env.set("RAYU_API_URL", format!("http://{addr3}"));
    let err3 = provider
        .complete(&user_message("hi"), &[], "", None)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(
        err3.contains("session has expired") && err3.contains("/login rayu"),
        "{err3}"
    );
    assert!(!rayucode_base::rayu::has_usable_session());
    assert_eq!(server3.join().unwrap().len(), 2);
}
