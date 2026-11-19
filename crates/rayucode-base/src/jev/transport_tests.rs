use super::{tests::*, *};

#[tokio::test]
async fn browser_route_posts_choice_without_preflight() {
    let answer =
        json!({"answers": {"action": {"type": "choice", "choice": "click", "confidence": 0.9}}});
    let (base, worker) = mock_server(vec![(200, answer.to_string(), vec![])]);
    let mut client = mock_client(&base, JevProvider::OpenRouter);
    client.purpose = JevPurpose::Browser;
    assert_eq!(client.provider_name(), "openrouter");
    assert_eq!(client.model_id(), "typesafe/jev-1.13");
    assert_eq!(
        client
            .evaluate(json!({"page": "private-page"}), browser_questions())
            .await
            .unwrap(),
        answer
    );
    let requests = worker.join().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("POST /v1/decisions "));
    assert!(
        !requests[0].to_ascii_lowercase().contains("jev-purpose"),
        "the retired gateway purpose header must not be sent"
    );
    let body: Value = serde_json::from_str(requests[0].split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["questions"], Value::Object(browser_questions()));
    assert!(body["state"].is_string());
}

#[tokio::test]
async fn browser_auth_billing_and_redirect_failures_never_retry_or_fallback() {
    for status in [401, 402, 403, 302, 307] {
        let (base, worker) = mock_server(vec![(
            status,
            "private-provider-error test-route-secret".into(),
            vec![("Location".into(), "http://127.0.0.1:1/never-follow".into())],
        )]);
        let mut client = mock_client(&base, JevProvider::OpenRouter);
        client.purpose = JevPurpose::Browser;
        let error = client
            .evaluate(json!("private-page"), browser_questions())
            .await
            .unwrap_err();
        let detail = format!("{error:#}");
        assert!(detail.contains(&status.to_string()));
        for secret in [
            "private-provider-error",
            "test-route-secret",
            "private-page",
        ] {
            assert!(!detail.contains(secret));
        }
        let requests = worker.join().unwrap();
        assert_eq!(requests.len(), 1);
    }
}

#[tokio::test]
async fn decisions_send_bound_bearer_without_preflight() {
    let (base, worker) = mock_server(vec![(200, response().to_string(), vec![])]);
    let client = mock_client(&base, JevProvider::OpenRouter);
    let value = client.evaluate(json!("state"), questions()).await.unwrap();
    assert_eq!(value, response());
    let requests = worker.join().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("POST /v1/decisions "));
    assert!(
        requests[0]
            .to_ascii_lowercase()
            .contains("authorization: bearer test-route-secret\r\n")
    );
    assert!(!requests[0].lines().next().unwrap().contains("secret"));
}

#[tokio::test]
async fn transient_overload_is_retried_on_same_route_then_succeeds() {
    for status in [429, 502, 503, 504, 529] {
        let (base, worker) = mock_server(vec![
            (
                status,
                "{}".into(),
                vec![("Retry-After".into(), "1".into())],
            ),
            (status, "{}".into(), vec![]),
            (200, response().to_string(), vec![]),
        ]);
        let client = mock_client(&base, JevProvider::OpenRouter);
        let value = client.evaluate(json!("state"), questions()).await.unwrap();
        assert_eq!(value, response());
        let requests = worker.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(
            requests
                .iter()
                .all(|r| r.starts_with("POST /v1/decisions "))
        );
    }
}

#[tokio::test]
async fn persistent_overload_fails_after_bounded_retries_without_echo() {
    for status in [429, 529] {
        let replies = (0..=TRANSIENT_RETRY_DELAYS.len())
            .map(|_| {
                (
                    status,
                    "private-provider-error test-route-secret".into(),
                    vec![],
                )
            })
            .collect();
        let (base, worker) = mock_server(replies);
        let client = mock_client(&base, JevProvider::OpenRouter);
        let detail = format!(
            "{:#}",
            client
                .evaluate(json!("private-state"), questions())
                .await
                .unwrap_err()
        );
        assert!(detail.contains(&status.to_string()));
        assert!(detail.contains("overloaded"));
        assert!(!detail.contains("test-route-secret"));
        assert!(!detail.contains("private-state"));
        assert_eq!(
            worker.join().unwrap().len(),
            TRANSIENT_RETRY_DELAYS.len() + 1
        );
    }
}

#[tokio::test]
async fn auth_billing_and_redirect_errors_are_redacted_and_never_retried() {
    for status in [401, 402, 403, 404, 500, 302, 307] {
        let headers = vec![("Location".into(), "http://127.0.0.1:1/never-follow".into())];
        let (base, worker) = mock_server(vec![(
            status,
            "private-provider-error test-route-secret".into(),
            headers,
        )]);
        let client = mock_client(&base, JevProvider::OpenRouter);
        let error = client
            .evaluate(json!("private-state"), questions())
            .await
            .unwrap_err();
        let detail = format!("{error:#}");
        assert!(detail.contains(&status.to_string()));
        assert!(!detail.contains("test-route-secret"));
        assert!(!detail.contains("private-provider-error"));
        assert!(!detail.contains("private-state"));
        assert_eq!(worker.join().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn oversized_and_invalid_json_responses_are_rejected_without_echo() {
    for body in [
        "x".repeat(MAX_RESPONSE_BYTES + 1),
        "private-response-invalid-json".into(),
    ] {
        let (base, worker) = mock_server(vec![(200, body, vec![])]);
        let client = mock_client(&base, JevProvider::TypeSafe);
        let error = client
            .evaluate(json!("state"), questions())
            .await
            .unwrap_err();
        assert!(!format!("{error:#}").contains("private-response"));
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn streamed_body_limit_is_enforced_without_content_length() {
    let (base, worker) = mock_server(vec![(
        200,
        "x".repeat(MAX_RESPONSE_BYTES + 1),
        vec![("Transfer-Encoding".into(), "chunked".into())],
    )]);
    let client = mock_client(&base, JevProvider::Aimlapi);
    let error = client
        .evaluate(json!("state"), questions())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("bounded response size"));
    worker.join().unwrap();
}

#[tokio::test]
async fn laya_local_and_private_requests_bypass_http_proxy_including_voice_hedges() {
    let _guard = crate::storage::lock_test_env();
    let proxy_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    proxy_listener.set_nonblocking(true).unwrap();
    let proxy_url = format!("http://{}", proxy_listener.local_addr().unwrap());

    let (base, seen) = concurrent_mock(vec![(Duration::from_secs(3), 200), (Duration::ZERO, 200)]);

    let prev_http_proxy = std::env::var_os("HTTP_PROXY");
    let prev_all_proxy = std::env::var_os("ALL_PROXY");
    let prev_no_proxy = std::env::var_os("NO_PROXY");
    let prev_voice_provider = std::env::var_os(VOICE_PROVIDER_ENV);
    let prev_laya_base = std::env::var_os(LAYA_BASE_URL_ENV);
    let prev_laya_key = std::env::var_os("LAYA_API_KEY");

    crate::env::set_var("HTTP_PROXY", &proxy_url);
    crate::env::set_var("ALL_PROXY", &proxy_url);
    crate::env::remove_var("NO_PROXY");
    crate::env::set_var(VOICE_PROVIDER_ENV, "laya");
    crate::env::set_var(LAYA_BASE_URL_ENV, &base);
    crate::env::set_var("LAYA_API_KEY", "laya-private-key");

    assert!(should_bypass_proxy(
        JevProvider::Laya,
        "http://127.0.0.1:8080/v1/systemone"
    ));
    assert!(should_bypass_proxy(
        JevProvider::Laya,
        "http://100.87.178.69:8000/v1/systemone"
    ));
    assert!(!should_bypass_proxy(
        JevProvider::TypeSafe,
        "https://api.typesafe.ai/v1/systemone"
    ));

    let client = JevClient::for_voice().unwrap();
    let value = client
        .evaluate(json!({"transcript": "private-voice-state"}), questions())
        .await;

    match prev_http_proxy {
        Some(v) => crate::env::set_var("HTTP_PROXY", v),
        None => crate::env::remove_var("HTTP_PROXY"),
    }
    match prev_all_proxy {
        Some(v) => crate::env::set_var("ALL_PROXY", v),
        None => crate::env::remove_var("ALL_PROXY"),
    }
    match prev_no_proxy {
        Some(v) => crate::env::set_var("NO_PROXY", v),
        None => crate::env::remove_var("NO_PROXY"),
    }
    match prev_voice_provider {
        Some(v) => crate::env::set_var(VOICE_PROVIDER_ENV, v),
        None => crate::env::remove_var(VOICE_PROVIDER_ENV),
    }
    match prev_laya_base {
        Some(v) => crate::env::set_var(LAYA_BASE_URL_ENV, v),
        None => crate::env::remove_var(LAYA_BASE_URL_ENV),
    }
    match prev_laya_key {
        Some(v) => crate::env::set_var("LAYA_API_KEY", v),
        None => crate::env::remove_var("LAYA_API_KEY"),
    }

    let value = value.unwrap();
    assert!(validate_answers(&value, &questions()).is_ok());
    assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 2);
    assert!(
        proxy_listener.accept().is_err(),
        "capture proxy must never receive local Laya primary or hedge requests"
    );
}
