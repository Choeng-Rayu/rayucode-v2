//! Mock-server coverage for the Rayu auth wire contracts: login exchange,
//! refresh semantics (definitive refusal vs transient failure, newer-file-
//! wins, single-flight), API-key verdicts, and account/entitlement reads.
//! No real network, credentials, or user config is touched.

use super::test_support::RayuTestEnv;
use super::*;
use std::io::{Read, Write};
use std::time::Duration;

/// Sequential mock HTTP server. Returns its base URL and a channel of the
/// exact requests received. Each reply is (status, body, delay-before-reply).
fn mock_server(
    replies: Vec<(u16, String, Duration)>,
) -> (String, std::sync::mpsc::Receiver<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for (status, body, delay) in replies {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut buf = [0; 4096];
                let n = stream.read(&mut buf).unwrap();
                assert_ne!(n, 0);
                request.extend_from_slice(&buf[..n]);
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&request[..end]);
                    let len = head
                        .lines()
                        .find_map(|line| {
                            let (k, v) = line.split_once(':')?;
                            k.eq_ignore_ascii_case("content-length")
                                .then(|| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            tx.send(String::from_utf8(request).unwrap()).unwrap();
            if !delay.is_zero() {
                std::thread::sleep(delay);
            }
            let _ = write!(
                stream,
                "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    (base, rx)
}

fn request_body(request: &str) -> serde_json::Value {
    serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap()
}

fn session_json(expires_at: i64) -> String {
    serde_json::json!({
        "accessToken": "access-fresh",
        "refreshToken": "refresh-1",
        "expiresAt": expires_at,
        "user": {"id": 7, "email": "seven@example.invalid", "displayName": "Seven", "avatarUrl": null, "role": "user"}
    })
    .to_string()
}

fn write_stored_session(env: &RayuTestEnv, expires_at: i64) {
    std::fs::write(env.path().join("rayu-auth.json"), session_json(expires_at)).unwrap();
}

fn future_ms() -> i64 {
    chrono::Utc::now().timestamp_millis() + 3_600_000
}

fn past_ms() -> i64 {
    chrono::Utc::now().timestamp_millis() - 3_600_000
}

// --- login ---------------------------------------------------------------

#[tokio::test]
async fn login_via_callback_url_exchanges_code_and_persists_session() {
    let env = RayuTestEnv::new();
    let (base, requests) = mock_server(vec![(200, session_json(future_ms()), Duration::ZERO)]);
    crate::env::set_var("RAYU_API_URL", &base);

    let user = login(RayuLoginOptions {
        no_browser: true,
        print_auth_url: false,
        callback_url: Some(
            "http://127.0.0.1:43210/callback?code=one-time-code&state=the-state".into(),
        ),
    })
    .await
    .unwrap();

    assert_eq!(user.id, 7);
    assert_eq!(user.display_name.as_deref(), Some("Seven"));
    let request = requests.recv().unwrap();
    assert!(request.starts_with("POST /cli/token "));
    assert_eq!(
        request_body(&request),
        serde_json::json!({"code": "one-time-code", "state": "the-state"})
    );
    // Exactly one request; the session is on disk with owner-only perms.
    assert!(requests.recv().is_err());
    let stored = read_session().unwrap();
    assert_eq!(stored.access_token, "access-fresh");
    assert_eq!(stored.refresh_token, "refresh-1");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(env.path().join("rayu-auth.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[tokio::test]
async fn login_exchange_failure_is_reported_without_persisting() {
    let _env = RayuTestEnv::new();
    let (base, _requests) = mock_server(vec![(
        400,
        r#"{"error":"invalid code"}"#.into(),
        Duration::ZERO,
    )]);
    crate::env::set_var("RAYU_API_URL", &base);
    let error = login(RayuLoginOptions {
        no_browser: true,
        print_auth_url: false,
        callback_url: Some("http://127.0.0.1:1/callback?code=bad&state=s".into()),
    })
    .await
    .unwrap_err();
    assert!(error.to_string().contains("400"));
    assert!(read_session().is_none());
}

#[tokio::test]
async fn loopback_callback_verifies_state_and_ignores_probes() {
    let env = RayuTestEnv::new();
    let (base, requests) = mock_server(vec![(200, session_json(future_ms()), Duration::ZERO)]);
    crate::env::set_var("RAYU_API_URL", &base);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = "expected-state-value";
    let waiter =
        tokio::spawn(async move { super::login::wait_for_callback(&listener, state).await });

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    // A probe without a code is ignored (204) and does not settle the flow.
    let probe = client
        .get(format!("http://127.0.0.1:{port}/favicon.ico"))
        .send()
        .await
        .unwrap();
    assert_eq!(probe.status().as_u16(), 204);
    // The real redirect carries code + state.
    let callback = client
        .get(format!(
            "http://127.0.0.1:{port}/callback?code=loop-code&state={state}"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(callback.status().as_u16(), 200);
    assert!(callback.text().await.unwrap().contains("Signed in to Rayu"));

    let code = waiter.await.unwrap().unwrap();
    assert_eq!(code, "loop-code");
    let user = super::login::exchange_code(&code, state).await.unwrap();
    assert_eq!(user.id, 7);
    let request = requests.recv().unwrap();
    assert_eq!(
        request_body(&request),
        serde_json::json!({"code": "loop-code", "state": state})
    );
    assert!(env.path().join("rayu-auth.json").exists());
}

#[tokio::test]
async fn loopback_callback_rejects_state_mismatch() {
    let _env = RayuTestEnv::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let waiter =
        tokio::spawn(async move { super::login::wait_for_callback(&listener, "expected").await });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .get(format!(
            "http://127.0.0.1:{port}/callback?code=c&state=attacker-state"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 400);
    let error = waiter.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("state mismatch"));
}

// --- refresh -------------------------------------------------------------

#[tokio::test]
async fn fresh_session_returns_token_without_network() {
    let env = RayuTestEnv::new();
    write_stored_session(&env, future_ms());
    // No RAYU_API_URL override: any network attempt would hit production and
    // fail the test; a fresh token must not make one.
    assert_eq!(access_token().await.as_deref(), Some("access-fresh"));
}

#[tokio::test]
async fn expired_session_refreshes_and_preserves_user() {
    let env = RayuTestEnv::new();
    write_stored_session(&env, past_ms());
    let renewed = serde_json::json!({
        "accessToken": "access-renewed",
        "refreshToken": "refresh-2",
        "expiresAt": future_ms(),
    });
    let (base, requests) = mock_server(vec![(200, renewed.to_string(), Duration::ZERO)]);
    crate::env::set_var("RAYU_API_URL", &base);

    assert_eq!(access_token().await.as_deref(), Some("access-renewed"));
    let request = requests.recv().unwrap();
    assert!(request.starts_with("POST /cli/refresh "));
    assert_eq!(
        request_body(&request),
        serde_json::json!({"refreshToken": "refresh-1"})
    );
    let stored = read_session().unwrap();
    assert_eq!(stored.access_token, "access-renewed");
    assert_eq!(stored.refresh_token, "refresh-2");
    assert_eq!(
        stored.user.id, 7,
        "refresh must preserve the account identity"
    );
    assert!(requests.recv().is_err());
}

#[tokio::test]
async fn telegram_hosted_retries_the_same_relay_after_token_rejection() {
    use crate::telegram::remote::{Mode, Transport};

    let env = RayuTestEnv::new();
    write_stored_session(&env, future_ms());
    let refreshed = serde_json::json!({
        "accessToken": "access-renewed",
        "refreshToken": "refresh-2",
        "expiresAt": future_ms(),
    });
    let (base, requests) = mock_server(vec![
        (401, "{}".into(), Duration::ZERO),
        (200, refreshed.to_string(), Duration::ZERO),
        (
            200,
            r#"{"ok":true,"result":{"message_id":17}}"#.into(),
            Duration::ZERO,
        ),
    ]);
    crate::env::set_var("RAYU_API_URL", &base);

    let transport = Transport::new(Mode::Hosted { account: 7 }).unwrap();
    assert_eq!(transport.send(42, "fixture", None).await.unwrap(), 17);
    let [first, refresh, retry] = std::array::from_fn(|_| requests.recv().unwrap());
    assert!(first.starts_with("POST /telegram/send "));
    assert!(first.contains("authorization: Bearer access-fresh\r\n"));
    assert!(refresh.starts_with("POST /cli/refresh "));
    assert_eq!(
        request_body(&refresh),
        serde_json::json!({"refreshToken": "refresh-1"})
    );
    assert!(retry.starts_with("POST /telegram/send "));
    assert!(retry.contains("authorization: Bearer access-renewed\r\n"));
    assert_eq!(request_body(&retry), request_body(&first));
    assert!(requests.recv().is_err());
}

#[tokio::test]
async fn telegram_hosted_rejects_credentials_from_another_account() {
    use crate::telegram::remote::{Mode, Transport};

    let env = RayuTestEnv::new();
    write_stored_session(&env, future_ms());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    crate::env::set_var(
        "RAYU_API_URL",
        format!("http://{}", listener.local_addr().unwrap()),
    );

    let transport = Transport::new(Mode::Hosted { account: 8 }).unwrap();
    assert!(transport.link().await.is_err());
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert!(
        telegram_access_token(8, Some("prior-token"))
            .await
            .is_none()
    );
    assert_eq!(read_session().unwrap().user.id, 7);
}

#[tokio::test]
async fn definitive_refusals_clear_the_session() {
    for status in [400u16, 401] {
        let env = RayuTestEnv::new();
        write_stored_session(&env, past_ms());
        let (base, _requests) = mock_server(vec![(
            status,
            r#"{"error":"Unauthorized"}"#.into(),
            Duration::ZERO,
        )]);
        crate::env::set_var("RAYU_API_URL", &base);
        assert_eq!(access_token().await, None, "status {status}");
        assert!(read_session().is_none(), "status {status} must clear");
        assert!(!has_usable_session());
    }
}

#[tokio::test]
async fn transient_failures_keep_the_session() {
    // 5xx and proxy 403 are not verdicts on the refresh token.
    for status in [500u16, 502, 503, 403] {
        let env = RayuTestEnv::new();
        write_stored_session(&env, past_ms());
        let (base, _requests) = mock_server(vec![(status, "gateway error".into(), Duration::ZERO)]);
        crate::env::set_var("RAYU_API_URL", &base);
        assert_eq!(access_token().await, None, "status {status}");
        assert!(read_session().is_some(), "status {status} must keep");
    }
    // Network failure (nothing listening) keeps the session too.
    let env = RayuTestEnv::new();
    write_stored_session(&env, past_ms());
    let dead_port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    crate::env::set_var("RAYU_API_URL", format!("http://127.0.0.1:{dead_port}"));
    assert_eq!(access_token().await, None);
    assert!(read_session().is_some());
}

#[tokio::test]
async fn malformed_refresh_body_keeps_the_session() {
    let env = RayuTestEnv::new();
    write_stored_session(&env, past_ms());
    let (base, _requests) = mock_server(vec![(200, "not json".into(), Duration::ZERO)]);
    crate::env::set_var("RAYU_API_URL", &base);
    assert_eq!(access_token().await, None);
    assert!(read_session().is_some());
}

#[tokio::test]
async fn newer_file_wins_over_an_in_flight_refresh() {
    let env = RayuTestEnv::new();
    write_stored_session(&env, past_ms());
    let renewed = serde_json::json!({
        "accessToken": "access-minted",
        "refreshToken": "refresh-minted",
        "expiresAt": future_ms(),
    });
    // The refresh reply is delayed so another sign-in can land mid-flight.
    let (base, requests) =
        mock_server(vec![(200, renewed.to_string(), Duration::from_millis(300))]);
    crate::env::set_var("RAYU_API_URL", &base);

    let refresh = tokio::spawn(async { refresh_access_token(Some("access-fresh")).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    // Another terminal signs in while the request is in flight.
    let newer = serde_json::json!({
        "accessToken": "access-newer-signin",
        "refreshToken": "refresh-newer-signin",
        "expiresAt": future_ms(),
        "user": {"id": 9, "email": null, "displayName": null, "avatarUrl": null, "role": "user"}
    });
    std::fs::write(env.path().join("rayu-auth.json"), newer.to_string()).unwrap();

    assert_eq!(
        refresh.await.unwrap().as_deref(),
        Some("access-newer-signin")
    );
    let stored = read_session().unwrap();
    assert_eq!(stored.access_token, "access-newer-signin");
    assert_eq!(stored.refresh_token, "refresh-newer-signin");
    assert_eq!(stored.user.id, 9);
    assert_eq!(requests.iter().count(), 1);
}

#[tokio::test]
async fn stale_token_short_circuits_when_the_file_already_renewed() {
    let env = RayuTestEnv::new();
    write_stored_session(&env, future_ms());
    // No server configured: returning the file token must not touch network.
    let token = refresh_access_token(Some("an-older-token")).await;
    assert_eq!(token.as_deref(), Some("access-fresh"));
}

#[tokio::test]
async fn concurrent_refreshes_share_one_in_flight_request() {
    let env = RayuTestEnv::new();
    write_stored_session(&env, past_ms());
    let renewed = serde_json::json!({
        "accessToken": "access-shared",
        "refreshToken": "refresh-shared",
        "expiresAt": future_ms(),
    });
    let (base, requests) =
        mock_server(vec![(200, renewed.to_string(), Duration::from_millis(200))]);
    crate::env::set_var("RAYU_API_URL", &base);

    let mut tasks = Vec::new();
    for _ in 0..4 {
        tasks.push(tokio::spawn(async { access_token().await }));
    }
    for task in tasks {
        assert_eq!(task.await.unwrap().as_deref(), Some("access-shared"));
    }
    // Exactly one refresh request served all four callers.
    assert_eq!(requests.iter().count(), 1);
    assert!(
        requests.recv_timeout(Duration::from_millis(200)).is_err(),
        "no second refresh may be issued"
    );
}

#[tokio::test]
async fn expired_session_without_refresh_token_is_cleared() {
    let _env = RayuTestEnv::new();
    let mut session: RayuSession = serde_json::from_str(&session_json(past_ms())).unwrap();
    session.refresh_token = String::new();
    write_session(&session).unwrap();
    assert_eq!(access_token().await, None);
    assert!(read_session().is_none());
}

// --- api key -------------------------------------------------------------

#[tokio::test]
async fn api_key_verdicts_follow_gateway_status_and_fail_open() {
    let env = RayuTestEnv::new();
    let credits = serde_json::json!({
        "plan": "pro", "planName": "Pro", "creditsPerPeriod": 100.0,
        "usedCredits": 12.5, "remainingCredits": 87.5, "resetSeconds": 3600,
        "periodEnd": "2026-12-01T00:00:00Z", "topupBalance": 0.0,
        "topUpEnabled": true
    });
    let (base, requests) = mock_server(vec![
        (200, credits.to_string(), Duration::ZERO),
        (401, r#"{"error":"invalid key"}"#.into(), Duration::ZERO),
        (503, "database down".into(), Duration::ZERO),
    ]);
    crate::env::set_var("RAYU_GATEWAY_URL", &base);
    let key = "rayu_sk_live_verdict_test";

    assert_eq!(validate_api_key(key).await, ApiKeyVerdict::Valid);
    let request = requests.recv().unwrap();
    assert!(request.starts_with("GET /v1/credits "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains(&format!("authorization: bearer {key}\r\n").to_ascii_lowercase())
    );
    let state_text = std::fs::read_to_string(env.path().join("rayu-apikey-state.json")).unwrap();
    let state: serde_json::Value = serde_json::from_str(&state_text).unwrap();
    assert_eq!(state["verdict"], "valid");
    assert_eq!(state["planName"], "Pro");
    assert_eq!(state["fingerprint"].as_str().unwrap().len(), 16);
    assert!(!state_text.contains(key));

    assert_eq!(validate_api_key(key).await, ApiKeyVerdict::Invalid);
    let state: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(env.path().join("rayu-apikey-state.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(state["verdict"], "invalid");

    // 503 is not a verdict: the previous record survives untouched.
    assert_eq!(validate_api_key(key).await, ApiKeyVerdict::Unavailable);
    let state: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(env.path().join("rayu-apikey-state.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(state["verdict"], "invalid");
    // Three requests total; the first was already consumed by recv() above.
    assert_eq!(requests.iter().count(), 2);
}

#[tokio::test]
async fn offline_validation_is_unavailable_and_records_nothing() {
    let env = RayuTestEnv::new();
    let dead_port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    crate::env::set_var("RAYU_GATEWAY_URL", format!("http://127.0.0.1:{dead_port}"));
    assert_eq!(
        validate_api_key("rayu_sk_live_offline").await,
        ApiKeyVerdict::Unavailable
    );
    assert!(!env.path().join("rayu-apikey-state.json").exists());
}

#[tokio::test]
async fn gateway_credential_prefers_jwt_over_api_key() {
    let env = RayuTestEnv::new();
    crate::env::set_var("RAYU_API_KEY", "rayu_sk_live_fallback");
    assert!(has_api_key());
    assert!(has_credentials());
    assert_eq!(
        gateway_credential().await.as_deref(),
        Some("rayu_sk_live_fallback")
    );

    write_stored_session(&env, future_ms());
    assert_eq!(gateway_credential().await.as_deref(), Some("access-fresh"));

    clear_session();
    assert_eq!(
        gateway_credential().await.as_deref(),
        Some("rayu_sk_live_fallback")
    );
}

// --- account reads ---------------------------------------------------------

#[tokio::test]
async fn fetch_me_and_entitlements_use_the_session_jwt() {
    let env = RayuTestEnv::new();
    write_stored_session(&env, future_ms());
    let me = serde_json::json!({
        "user": {"id": 7, "email": "seven@example.invalid", "displayName": "Seven", "avatarUrl": null, "role": "user"},
        "status": "active"
    });
    // An arbitrary future model absent from any fallback array must parse
    // through the real entitlements schema.
    let entitlements = serde_json::json!({
        "allowedModels": [
            {"code": "rayu-future-model-9", "label": "Future 9", "contextWindow": 500000,
             "supportsReasoning": true, "supportsImage": false, "supportsTools": true,
             "creditMultiplier": 2.5}
        ],
        "hostedModels": [
            {"code": "rayu-future-model-9"},
            {"code": "rayu-basic-1", "creditMultiplier": 1.0}
        ],
        "subagentTiers": {"fast": "rayu-basic-1"}
    });
    let (base, requests) = mock_server(vec![
        (200, me.to_string(), Duration::ZERO),
        (200, entitlements.to_string(), Duration::ZERO),
    ]);
    crate::env::set_var("RAYU_API_URL", &base);

    let profile = fetch_me().await.unwrap();
    assert_eq!(profile.user.id, 7);
    assert_eq!(profile.status, "active");
    let request = requests.recv().unwrap();
    assert!(request.starts_with("GET /me "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer access-fresh\r\n")
    );

    let entitlements = fetch_entitlements().await.unwrap();
    assert_eq!(entitlements.allowed_models.len(), 1);
    let model = &entitlements.allowed_models[0];
    assert_eq!(model.code, "rayu-future-model-9");
    assert_eq!(model.context_window, Some(500_000));
    assert_eq!(model.supports_reasoning, Some(true));
    assert_eq!(model.credit_multiplier, Some(2.5));
    assert_eq!(entitlements.hosted_models.as_ref().unwrap().len(), 2);
    assert!(entitlements.subagent_tiers.is_some());
    let request = requests.recv().unwrap();
    assert!(request.starts_with("GET /me/entitlements "));
}

#[tokio::test]
async fn fetch_credits_parses_the_gateway_schema_including_api_key_limits() {
    let _env = RayuTestEnv::new();
    let credits = serde_json::json!({
        "plan": "pro", "planName": "Pro", "priceCents": 2000,
        "creditsPerPeriod": 100.0, "usedCredits": 12.5, "remainingCredits": 87.5,
        "resetSeconds": 3600, "periodEnd": "2026-12-01T00:00:00Z",
        "topupBalance": 3.5, "topUpEnabled": true, "limitMode": "gated",
        "apiKey": {"keyId": 11, "creditLimit": 50.0, "allowedModels": ["rayu-basic-1"], "rateLimitRpm": 60}
    });
    let (base, requests) = mock_server(vec![(200, credits.to_string(), Duration::ZERO)]);
    crate::env::set_var("RAYU_GATEWAY_URL", &base);

    let report = fetch_credits("rayu_sk_live_credits_test").await.unwrap();
    assert_eq!(report.plan, "pro");
    assert_eq!(report.plan_name, "Pro");
    assert_eq!(report.credits_per_period, Some(100.0));
    assert_eq!(report.used_credits, 12.5);
    assert_eq!(report.remaining_credits, Some(87.5));
    assert_eq!(report.reset_seconds, 3600);
    assert_eq!(report.topup_balance, 3.5);
    assert!(report.top_up_enabled);
    assert_eq!(report.limit_mode.as_deref(), Some("gated"));
    let key_limits = report.api_key.unwrap();
    assert_eq!(key_limits.key_id, 11);
    assert_eq!(key_limits.credit_limit, Some(50.0));
    assert_eq!(key_limits.allowed_models, vec!["rayu-basic-1"]);
    assert_eq!(key_limits.rate_limit_rpm, Some(60));
    let request = requests.recv().unwrap();
    assert!(request.starts_with("GET /v1/credits "));
}

#[tokio::test]
async fn account_reads_require_a_session_and_surface_http_errors() {
    let env = RayuTestEnv::new();
    assert!(fetch_me().await.is_err());
    assert!(fetch_entitlements().await.is_err());
    drop(env);

    let env = RayuTestEnv::new();
    write_stored_session(&env, future_ms());
    let (base, _requests) = mock_server(vec![(401, "expired".into(), Duration::ZERO)]);
    crate::env::set_var("RAYU_API_URL", &base);
    let error = fetch_me().await.unwrap_err();
    assert!(error.to_string().contains("401"));
}

#[test]
fn auth_gate_enabled_honors_use_rayu_oauth_and_ignores_rayu_home() {
    let env = RayuTestEnv::new();
    // Test suite builds with cfg!(test) -> false unless opted in.
    assert!(!auth_gate_enabled());

    for truthy in ["1", "true", "TRUE", "yes", "on"] {
        crate::env::set_var("USE_RAYU_OAUTH", truthy);
        assert!(auth_gate_enabled(), "{truthy} should enable gate");
        assert!(
            auth_gate_active(),
            "{truthy} should be active without creds"
        );
    }

    for falsy in ["0", "false", "FALSE", "off", "no"] {
        crate::env::set_var("USE_RAYU_OAUTH", falsy);
        assert!(!auth_gate_enabled(), "{falsy} should disable gate");
        assert!(!auth_gate_active(), "{falsy} should deactivate gate");
    }

    // Storing a usable session satisfies the gate even with USE_RAYU_OAUTH=true.
    crate::env::set_var("USE_RAYU_OAUTH", "true");
    write_stored_session(&env, future_ms());
    assert!(!auth_gate_active());
}

#[test]
fn api_key_persistence_precedence_and_providers_json_fallback() {
    let env = RayuTestEnv::new();
    assert!(!has_api_key());

    // Read-only fallback from providers.json (array form).
    let providers_path = env.path().join("providers.json");
    let original_providers = serde_json::json!({
        "activeProvider": "rayu",
        "providers": [
            { "id": "other", "apiKey": "sk-other-123" },
            { "id": "rayu", "apiKeys": ["rayu_sk_live_from_providers_arr"] }
        ]
    })
    .to_string();
    std::fs::write(&providers_path, &original_providers).unwrap();
    assert_eq!(
        configured_api_key().as_deref(),
        Some("rayu_sk_live_from_providers_arr")
    );

    // save_api_key writes rayu.env (0600), overrides providers.json, never edits providers.json.
    let env_path = save_api_key("rayu_sk_live_from_env_file").unwrap();
    assert!(env_path.ends_with("rayu.env"));
    assert_eq!(
        configured_api_key().as_deref(),
        Some("rayu_sk_live_from_env_file")
    );
    assert_eq!(
        std::fs::read_to_string(&providers_path).unwrap(),
        original_providers
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&env_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    // Env RAYU_API_KEY takes highest precedence.
    crate::env::set_var(RAYU_API_KEY_ENV, "rayu_sk_live_from_env_var");
    assert_eq!(
        configured_api_key().as_deref(),
        Some("rayu_sk_live_from_env_var")
    );
    crate::env::remove_var(RAYU_API_KEY_ENV);

    // logout removes rayu.env + state while leaving providers.json untouched.
    logout().unwrap();
    assert!(
        !env_path.exists()
            || !std::fs::read_to_string(&env_path)
                .unwrap()
                .contains("RAYU_API_KEY=")
    );
    assert_eq!(
        std::fs::read_to_string(&providers_path).unwrap(),
        original_providers
    );
}

#[tokio::test]
async fn api_key_no_credit_and_invalid_verdicts_gate_has_credentials() {
    let env = RayuTestEnv::new();
    let zero_credits = serde_json::json!({
        "plan": "free", "planName": "Free", "creditsPerPeriod": 10.0,
        "usedCredits": 10.0, "remainingCredits": 0.0, "resetSeconds": 3600,
        "topupBalance": 0.0, "topUpEnabled": false
    });
    let topup_credits = serde_json::json!({
        "plan": "free", "planName": "Free", "creditsPerPeriod": 10.0,
        "usedCredits": 10.0, "remainingCredits": 0.0, "resetSeconds": 3600,
        "topupBalance": 2.5, "topUpEnabled": true
    });
    let unlimited_credits = serde_json::json!({
        "plan": "max", "planName": "Max", "creditsPerPeriod": null,
        "usedCredits": 500.0, "remainingCredits": null, "resetSeconds": 3600,
        "topupBalance": 0.0, "topUpEnabled": false
    });
    let (base, _requests) = mock_server(vec![
        (200, zero_credits.to_string(), Duration::ZERO),
        (200, topup_credits.to_string(), Duration::ZERO),
        (200, unlimited_credits.to_string(), Duration::ZERO),
        (401, r#"{"error":"revoked"}"#.into(), Duration::ZERO),
    ]);
    crate::env::set_var("RAYU_GATEWAY_URL", &base);
    crate::env::set_var("USE_RAYU_OAUTH", "true");

    let key = "rayu_sk_live_credit_gate";
    save_api_key(key).unwrap();
    assert!(has_validated_api_key());
    assert!(has_credentials());
    assert!(!auth_gate_active());

    // Exhausted credits + 0 topup => NoCredit, disables has_validated_api_key/has_credentials.
    assert_eq!(validate_api_key(key).await, ApiKeyVerdict::NoCredit);
    assert!(!has_validated_api_key());
    assert!(!has_credentials());
    assert!(auth_gate_active());
    assert_eq!(relaunch_api_key_issue(), Some(ApiKeyVerdict::NoCredit));

    // Top-up balance rescues 0 period remainingCredits => Valid.
    assert_eq!(validate_api_key(key).await, ApiKeyVerdict::Valid);
    assert!(has_validated_api_key());
    assert!(has_credentials());
    assert_eq!(relaunch_api_key_issue(), None);

    // Null remainingCredits (unlimited plan) => Valid.
    assert_eq!(validate_api_key(key).await, ApiKeyVerdict::Valid);
    assert!(has_validated_api_key());

    // 401 => Invalid => cached failure blocks until key changes or session exists.
    clear_apikey_state();
    assert_eq!(
        ensure_api_key_validated_once().await,
        Some(ApiKeyVerdict::Invalid)
    );
    assert!(!has_validated_api_key());
    assert!(!has_credentials());
    assert_eq!(relaunch_api_key_issue(), Some(ApiKeyVerdict::Invalid));

    // Rotating to a different key does not inherit previous key's invalid verdict.
    save_api_key("rayu_sk_live_brand_new").unwrap();
    assert!(has_validated_api_key());
    assert!(has_credentials());
    assert_eq!(relaunch_api_key_issue(), None);
    drop(env);
}

#[test]
fn deferred_multiprovider_and_auth_status_respect_rayu_gate_and_config_sources() {
    use crate::provider::Provider;
    let env = RayuTestEnv::new();
    let prev_or = std::env::var_os("OPENROUTER_API_KEY");
    let prev_ant = std::env::var_os("ANTHROPIC_API_KEY");
    let prev_prov = std::env::var_os("RAYU_PROVIDER");
    crate::env::set_var("USE_RAYU_OAUTH", "true");
    crate::env::set_var("OPENROUTER_API_KEY", "sk-or-fake-3p");
    crate::env::set_var("ANTHROPIC_API_KEY", "sk-ant-fake-3p");
    crate::env::set_var("RAYU_PROVIDER", "openrouter");
    crate::auth::AuthStatus::invalidate_cache();

    assert!(auth_gate_active());
    let multi =
        crate::provider::MultiProvider::from_auth_status(crate::auth::AuthStatus::default());
    assert!(
        !multi.has_any_initialized_provider(),
        "deferred-auth MultiProvider must not load 3P credentials while Rayu auth gate is active"
    );
    multi.on_auth_changed();
    assert!(
        !multi.has_any_initialized_provider(),
        "handle_auth_changed must not hot-initialize 3P providers while Rayu auth gate is active"
    );

    let before = crate::auth::AuthStatus::check_fast()
        .assessment_for_provider(crate::provider_catalog::RAYU_LOGIN_PROVIDER);
    assert_eq!(before.state, crate::auth::AuthState::NotConfigured);
    assert_eq!(
        before.credential_source,
        crate::auth::AuthCredentialSource::None
    );

    // 1. Saved key in rayu.env reports AppConfigFile source (~/.config/rayucode/rayu.env).
    save_api_key("rayu_sk_live_status_source_test").unwrap();
    crate::auth::AuthStatus::invalidate_cache();
    let after_env_file = crate::auth::AuthStatus::check_fast()
        .assessment_for_provider(crate::provider_catalog::RAYU_LOGIN_PROVIDER);
    assert_eq!(after_env_file.state, crate::auth::AuthState::Available);
    assert_eq!(
        after_env_file.credential_source,
        crate::auth::AuthCredentialSource::AppConfigFile
    );
    assert!(
        after_env_file.credential_source_detail.contains("rayu.env"),
        "unexpected source detail: {}",
        after_env_file.credential_source_detail
    );

    // 2. Read-only fallback from providers.json also reports AppConfigFile source.
    clear_saved_api_key().unwrap();
    std::fs::write(
        env.path().join("providers.json"),
        r#"{"providers":[{"id":"rayu","apiKey":"rayu_sk_live_legacy_providers_source"}]}"#,
    )
    .unwrap();
    crate::auth::AuthStatus::invalidate_cache();
    let after_legacy = crate::auth::AuthStatus::check_fast()
        .assessment_for_provider(crate::provider_catalog::RAYU_LOGIN_PROVIDER);
    assert_eq!(after_legacy.state, crate::auth::AuthState::Available);
    assert_eq!(
        after_legacy.credential_source,
        crate::auth::AuthCredentialSource::AppConfigFile
    );
    assert!(
        after_legacy
            .credential_source_detail
            .contains("providers.json"),
        "unexpected legacy source detail: {}",
        after_legacy.credential_source_detail
    );

    match prev_or {
        Some(v) => crate::env::set_var("OPENROUTER_API_KEY", v),
        None => crate::env::remove_var("OPENROUTER_API_KEY"),
    }
    match prev_ant {
        Some(v) => crate::env::set_var("ANTHROPIC_API_KEY", v),
        None => crate::env::remove_var("ANTHROPIC_API_KEY"),
    }
    match prev_prov {
        Some(v) => crate::env::set_var("RAYU_PROVIDER", v),
        None => crate::env::remove_var("RAYU_PROVIDER"),
    }
    drop(env);
}

#[test]
fn enable_other_provider_false_locks_auth_and_multiprovider_to_rayu_only() {
    use crate::provider::Provider;

    let env = RayuTestEnv::new();
    let prev_or = std::env::var_os("OPENROUTER_API_KEY");
    let prev_ant = std::env::var_os("ANTHROPIC_API_KEY");
    let prev_oai = std::env::var_os("OPENAI_API_KEY");
    let prev_prov = std::env::var_os("RAYU_PROVIDER");

    // Register Rayu runtime so MultiProvider can hot-init Rayu when credentials exist.
    crate::provider::external::register_external_provider(
        crate::provider::external::RAYU_RUNTIME,
        || std::sync::Arc::new(rayucode_provider_rayu_runtime::RayuProvider::new()),
    );

    crate::env::set_var("USE_RAYU_OAUTH", "false");
    crate::env::set_var("OPENROUTER_API_KEY", "sk-or-fake-3p");
    crate::env::set_var("ANTHROPIC_API_KEY", "sk-ant-fake-3p");
    crate::env::set_var("OPENAI_API_KEY", "sk-oai-fake-3p");
    crate::env::set_var("RAYU_PROVIDER", "openai");

    {
        let _rayu_only = scoped_other_providers_enabled_for_tests(false);
        assert!(!other_providers_enabled());

        // Even with USE_RAYU_OAUTH=false, Rayu auth gate stays enforced when no other provider exists.
        assert!(auth_gate_enabled());
        assert!(auth_gate_active());
        assert!(!auth_gate_error_message().contains("third-party"));

        // AuthStatus probes ONLY Rayu, ignoring 3P keys in env.
        crate::auth::AuthStatus::invalidate_cache();
        let status = crate::auth::AuthStatus::check_fast();
        assert_eq!(status.rayu, crate::auth::AuthState::NotConfigured);
        assert_eq!(status.anthropic.state, crate::auth::AuthState::NotConfigured);
        assert_eq!(status.openai, crate::auth::AuthState::NotConfigured);
        assert_eq!(status.openrouter, crate::auth::AuthState::NotConfigured);
        assert!(!status.has_any_available());
        assert!(!crate::auth::AuthStatus::has_any_untrusted_external_auth());
        assert!(
            crate::external_auth::detected_external_auth_review_candidates()
                .unwrap()
                .is_empty()
        );

        // Unauthenticated MultiProvider reports "Rayu" (never "Claude").
        let multi = crate::provider::MultiProvider::from_auth_status(status);
        assert_eq!(multi.name(), RAYU_PROVIDER_DISPLAY_NAME);
        assert_eq!(multi.display_name(), RAYU_PROVIDER_DISPLAY_NAME);
        assert_eq!(multi.model(), "rayu");
        assert!(multi.available_models().is_empty());
        assert!(multi.model_routes().is_empty());

        // Saving a Rayu API key activates Rayu only; 3P runtimes stay unloaded even after auth change.
        save_api_key("rayu_sk_live_rayu_only_test").unwrap();
        crate::auth::AuthStatus::invalidate_cache();
        let authed_status = crate::auth::AuthStatus::check_fast();
        assert_eq!(authed_status.rayu, crate::auth::AuthState::Available);
        assert_eq!(
            authed_status.anthropic.state,
            crate::auth::AuthState::NotConfigured
        );
        assert_eq!(authed_status.openai, crate::auth::AuthState::NotConfigured);
        assert!(authed_status.has_any_available());

        multi.on_auth_changed();
        assert_eq!(multi.name(), RAYU_PROVIDER_DISPLAY_NAME);
        assert_eq!(multi.display_name(), RAYU_PROVIDER_DISPLAY_NAME);
        assert!(
            multi
                .model_routes()
                .iter()
                .all(|route| route.api_method == RAYU_ROUTE_API_METHOD)
        );

        // Explicit non-Rayu prefixes are rejected cleanly; rayu: and bare models stay on Rayu.
        for blocked in [
            "openai:gpt-5",
            "claude:claude-sonnet-4-5",
            "claude-oauth@work:claude-sonnet-4-5",
            "openrouter:anthropic/claude-sonnet-4",
            "deepseek:deepseek-chat",
            "grok-build:grok-4",
        ] {
            let err = multi
                .set_model(blocked)
                .expect_err(&format!("{blocked} must be rejected in Rayu-only mode"));
            assert!(
                err.to_string().contains("ENABLE_OTHER_PROVIDER=false"),
                "unexpected error for {blocked}: {err}"
            );
        }
        multi
            .set_model("rayu:rayu-test-model-1")
            .expect("rayu: prefix should work");
        assert_eq!(multi.model(), "rayu-test-model-1");
        multi
            .set_model("rayu-test-model-2")
            .expect("bare model should route to Rayu");
        assert_eq!(multi.model(), "rayu-test-model-2");

        // Forking preserves Rayu provider identity and model cleanly.
        let forked = multi.fork();
        assert_eq!(forked.name(), RAYU_PROVIDER_DISPLAY_NAME);
        assert_eq!(forked.model(), "rayu-test-model-2");
    }

    match prev_or {
        Some(v) => crate::env::set_var("OPENROUTER_API_KEY", v),
        None => crate::env::remove_var("OPENROUTER_API_KEY"),
    }
    match prev_ant {
        Some(v) => crate::env::set_var("ANTHROPIC_API_KEY", v),
        None => crate::env::remove_var("ANTHROPIC_API_KEY"),
    }
    match prev_oai {
        Some(v) => crate::env::set_var("OPENAI_API_KEY", v),
        None => crate::env::remove_var("OPENAI_API_KEY"),
    }
    match prev_prov {
        Some(v) => crate::env::set_var("RAYU_PROVIDER", v),
        None => crate::env::remove_var("RAYU_PROVIDER"),
    }
    drop(env);
}

#[tokio::test]
async fn enable_other_provider_false_unauthenticated_completion_and_fork_never_mention_openrouter() {
    use crate::provider::Provider;

    let env = RayuTestEnv::new();
    let _rayu_only = scoped_other_providers_enabled_for_tests(false);
    crate::auth::AuthStatus::invalidate_cache();
    let multi = crate::provider::MultiProvider::from_auth_status(crate::auth::AuthStatus::default());

    let forked = multi.fork();
    assert_eq!(forked.name(), RAYU_PROVIDER_DISPLAY_NAME);
    assert_eq!(forked.model(), "rayu");

    let err = match multi.complete(&[], &[], "sys", None).await {
        Ok(_) => panic!("unauthenticated Rayu-only completion must fail"),
        Err(err) => err,
    };
    let msg = err.to_string();
    assert!(
        msg.contains("Rayu"),
        "expected Rayu auth error, got: {msg}"
    );
    assert!(
        !msg.to_ascii_lowercase().contains("openrouter")
            && !msg.to_ascii_lowercase().contains("claude")
            && !msg.to_ascii_lowercase().contains("openai"),
        "unauthenticated Rayu-only completion leaked 3P provider: {msg}"
    );

    let split_err = match multi.complete_split(&[], &[], "static", "dyn", None).await {
        Ok(_) => panic!("unauthenticated Rayu-only split completion must fail"),
        Err(err) => err,
    };
    let split_msg = split_err.to_string();
    assert!(
        split_msg.contains("Rayu") && !split_msg.to_ascii_lowercase().contains("openrouter"),
        "unexpected split completion error: {split_msg}"
    );

    let anthropic_usage = crate::usage::get().await;
    assert!(anthropic_usage.last_error.is_none());
    let openai_usage = crate::usage::get_openai_usage().await;
    assert!(openai_usage.last_error.is_none());
    assert!(crate::usage::get_openai_usage_sync().last_error.is_none());

    drop(env);
}

#[test]
fn preferred_fallback_model_precedence_and_disable_sentinel() {
    let env = RayuTestEnv::new();
    let _compiled = scoped_default_fallback_model_for_tests(Some("deepseek-v4.1-flash-1017-cloud"));

    // 1. Falls back to compile-time `.env` default when neither process env nor rayu.env sets it.
    assert_eq!(
        preferred_fallback_model().as_deref(),
        Some("deepseek-v4.1-flash-1017-cloud")
    );

    // 2. `~/.config/rayucode/rayu.env` overrides compile-time `.env` default without recompile.
    let config_dir = crate::storage::app_config_dir().expect("config dir");
    std::fs::create_dir_all(&config_dir).expect("mkdir");
    std::fs::write(
        config_dir.join("rayu.env"),
        "RAYU_FALLBACK_MODEL=qwen4-max-preview\n",
    )
    .expect("write rayu.env");
    assert_eq!(
        preferred_fallback_model().as_deref(),
        Some("qwen4-max-preview")
    );

    // 3. Process environment variable wins over both rayu.env and compile-time default.
    crate::env::set_var(RAYU_FALLBACK_MODEL_ENV, "deepseek-v4.1-flash-1017-cloud");
    assert_eq!(
        preferred_fallback_model().as_deref(),
        Some("deepseek-v4.1-flash-1017-cloud")
    );

    // 4. Explicit disable sentinel restores default ranking without falling through.
    crate::env::set_var(RAYU_FALLBACK_MODEL_ENV, "none");
    assert_eq!(preferred_fallback_model(), None);

    drop(env);
}
