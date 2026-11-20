// Rayu live-catalog discovery regression (AGENTS.md "Provider model discovery").
//
// Drives the REAL Rayu runtime (`rayucode-provider-rayu-runtime`, a test-only
// dev-dependency cycle exactly like the OpenRouter runtime) against a local
// mock gateway serving the ACTUAL Rayu response schema, and proves the
// orchestrator wiring end to end:
//
// * (a) an arbitrary future model absent from every offline fallback array is
//   discovered and reaches the model-picker routes with the `rayu:` prefix;
// * (b) explicit refresh bypasses a fresh cache;
// * (c) the last good catalog survives network, 401, and malformed failures;
// * (d) the persistent cache is scoped to the endpoint that produced it.
//
// The API-key route is exercised (`GET {gateway}/v1/models`, OpenAI-style
// `{"object":"list","data":[…]}`); the JWT route's `/me/entitlements` schema is
// covered by the runtime crate's own catalog tests.
mod catalog_rayu {
    use super::*;
    use rayucode_provider_rayu_runtime::RayuProvider;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// A model id no static fallback array knows about. Discovery must surface it
    /// without a rayu release; never turn this into a static-allowlist assertion.
    const FUTURE_MODEL: &str = "rayu-nebula-future-9";
    /// A second future release used to prove forced refresh bypasses a fresh cache.
    const FUTURE_MODEL_2: &str = "rayu-quasar-future-12";
    /// A model served only by a different endpoint, for the cache-scoping proof.
    const OTHER_ENDPOINT_MODEL: &str = "rayu-pulsar-other-7";

    /// Build a gateway `/v1/models` body using the real schema: `id`, `object`,
    /// `owned_by`, `label`, `description`, `contextWindow`, `supportsReasoning`,
    /// `supportsImage`, `supportsTools`, plus a `subagentTiers` object.
    fn gateway_models_body(ids: &[(&str, u64)]) -> String {
        let data: Vec<serde_json::Value> = ids
            .iter()
            .map(|(id, window)| {
                serde_json::json!({
                    "id": id,
                    "object": "model",
                    "owned_by": "rayu",
                    "label": format!("{id} label"),
                    "description": "Released after this binary was built",
                    "contextWindow": window,
                    "supportsReasoning": true,
                    "supportsImage": false,
                    "supportsTools": true,
                })
            })
            .collect();
        serde_json::json!({
            "object": "list",
            "data": data,
            "subagentTiers": {"fast": ids[0].0, "balanced": ids[0].0, "capable": ids[0].0},
        })
        .to_string()
    }

    /// A scripted mock gateway: serves one `(status, body)` response per accepted
    /// connection, in order, recording each request line so the test can assert the
    /// runtime hit the real discovery endpoint. `Connection: close` forces a fresh
    /// connection per request (the runtime shares a pooled HTTP client).
    fn spawn_mock_gateway(
        responses: Vec<(&'static str, String)>,
    ) -> (
        std::net::SocketAddr,
        Arc<Mutex<Vec<String>>>,
        std::thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock gateway");
        let addr = listener.local_addr().expect("mock gateway addr");
        let paths = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&paths);
        let handle = std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(_) => return,
                };
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .ok();
                let mut request = [0u8; 8192];
                let count = stream.read(&mut request).unwrap_or(0);
                let head = String::from_utf8_lossy(&request[..count]).to_string();
                let request_line = head.lines().next().unwrap_or_default().to_string();
                recorded
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push(request_line);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.flush();
            }
        });
        (addr, paths, handle)
    }

    /// Point the Rayu runtime at a mock gateway with an API-key credential and no
    /// account session, so discovery uses the gateway `/v1/models` route.
    fn configure_rayu_api_key_route(gateway: std::net::SocketAddr) {
        crate::env::set_var("RAYU_API_KEY", "rayu_sk_live_catalog_regression_key");
        crate::env::set_var("RAYU_GATEWAY_URL", format!("http://{gateway}"));
        // No session file exists in the per-test RAYU_AUTH_CONFIG_DIR, so the JWT
        // route is inactive and the API key wins.
    }

    fn register_rayu_runtime() {
        external::register_external_provider(external::RAYU_RUNTIME, || {
            Arc::new(RayuProvider::new()) as Arc<dyn Provider>
        });
    }

    #[test]
    fn rayu_live_catalog_discovery_picker_routes_force_refresh_and_last_good() {
        with_clean_provider_test_env(|| {
            let runtime = enter_test_runtime();
            let _enter = runtime.enter();
            register_rayu_runtime();

            let (addr, paths, server) = spawn_mock_gateway(vec![
                // 1: cached prefetch discovers the first future model.
                (
                    "200 OK",
                    gateway_models_body(&[(FUTURE_MODEL, 400_000), ("rayu-flash-mini", 131_072)]),
                ),
                // 2: explicit refresh bypasses the fresh cache and finds a newer one.
                ("200 OK", gateway_models_body(&[(FUTURE_MODEL_2, 900_000)])),
                // 3: network/server failure must preserve the last good catalog.
                (
                    "503 Service Unavailable",
                    r#"{"error":"temporary outage"}"#.into(),
                ),
                // 4: authentication failure must preserve the last good catalog.
                (
                    "401 Unauthorized",
                    r#"{"error":"invalid or expired credentials"}"#.into(),
                ),
                // 5: malformed response must preserve the last good catalog.
                ("200 OK", "this is not json".into()),
            ]);
            configure_rayu_api_key_route(addr);

            let rayu = external::instantiate_external_provider(external::RAYU_RUNTIME)
                .expect("Rayu runtime registered");

            // (a) Discovery: a model absent from every fallback array is fetched
            // from the live gateway and becomes switchable.
            runtime.block_on(rayu.prefetch_models()).expect("prefetch");
            assert!(
                rayu.available_models_for_switching()
                    .contains(&FUTURE_MODEL.to_string()),
                "live discovery must surface an arbitrary future model"
            );

            // (a) Picker routes: the orchestrator prefixes the live catalog so a
            // picker selection dispatches back through the `rayu:` profile path.
            let provider = test_multi_provider_with_cursor();
            provider
                .set_model(&format!("rayu:{FUTURE_MODEL}"))
                .expect("rayu: route installs the registry profile");
            assert_eq!(provider.active_provider(), ActiveProvider::OpenRouter);
            let routes = provider.model_routes();
            assert!(
                routes.iter().any(|route| {
                    route.model == format!("rayu:{FUTURE_MODEL}")
                        && route.api_method == crate::rayu::RAYU_ROUTE_API_METHOD
                        && route.provider == crate::rayu::RAYU_PROVIDER_DISPLAY_NAME
                }),
                "picker must offer the discovered model via a rayu: route; routes: {routes:?}"
            );

            // (b) Forced refresh bypasses the fresh cache and discovers a newer
            // future release without a rayu release.
            runtime
                .block_on(rayu.refresh_model_catalog())
                .expect("forced refresh");
            assert!(
                rayu.available_models_for_switching()
                    .contains(&FUTURE_MODEL_2.to_string()),
                "explicit refresh must bypass a fresh cache"
            );

            // (c) Last-good preservation on network, auth, and malformed failures.
            for (label, _) in [("network", "503"), ("auth", "401"), ("malformed", "200")] {
                assert!(
                    runtime.block_on(rayu.refresh_model_catalog()).is_err(),
                    "{label} failure must surface an error"
                );
                assert!(
                    rayu.available_models_for_switching()
                        .contains(&FUTURE_MODEL_2.to_string()),
                    "{label} failure must preserve the last good catalog"
                );
            }

            // Every discovery request hit the real gateway endpoint.
            let recorded = paths
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            assert_eq!(recorded.len(), 5, "one request per prefetch/refresh");
            assert!(
                recorded
                    .iter()
                    .all(|line| line.starts_with("GET /v1/models ")),
                "discovery must use GET /v1/models; got {recorded:?}"
            );
            drop(recorded);
            server.join().expect("mock gateway thread");
        });
    }

    #[test]
    fn rayu_persistent_catalog_cache_is_endpoint_scoped() {
        with_clean_provider_test_env(|| {
            let runtime = enter_test_runtime();
            let _enter = runtime.enter();
            register_rayu_runtime();

            // Endpoint A publishes FUTURE_MODEL; its catalog is persisted to disk.
            let (addr_a, _paths_a, server_a) = spawn_mock_gateway(vec![(
                "200 OK",
                gateway_models_body(&[(FUTURE_MODEL, 400_000)]),
            )]);
            configure_rayu_api_key_route(addr_a);
            let rayu_a = RayuProvider::new();
            runtime
                .block_on(rayu_a.prefetch_models())
                .expect("prefetch A");
            assert!(
                rayu_a
                    .available_models_display()
                    .contains(&FUTURE_MODEL.to_string())
            );
            server_a.join().expect("mock gateway A");

            // Endpoint B is a different gateway. A fresh provider must NOT serve
            // endpoint A's cached catalog: the persistent cache is endpoint-scoped.
            let (addr_b, _paths_b, server_b) = spawn_mock_gateway(vec![(
                "200 OK",
                gateway_models_body(&[(OTHER_ENDPOINT_MODEL, 200_000)]),
            )]);
            crate::env::set_var("RAYU_GATEWAY_URL", format!("http://{addr_b}"));
            let rayu_b = RayuProvider::new();
            assert!(
                !rayu_b
                    .available_models_display()
                    .contains(&FUTURE_MODEL.to_string()),
                "a cache minted for endpoint A must not be served for endpoint B"
            );
            runtime
                .block_on(rayu_b.prefetch_models())
                .expect("prefetch B");
            let models_b = rayu_b.available_models_display();
            assert!(
                models_b.contains(&OTHER_ENDPOINT_MODEL.to_string()),
                "endpoint B's live catalog must be discovered"
            );
            assert!(
                !models_b.contains(&FUTURE_MODEL.to_string()),
                "endpoint B must not inherit endpoint A's models"
            );
            server_b.join().expect("mock gateway B");
        });
    }

    #[test]
    fn multiprovider_defaults_to_rayu_over_openrouter_and_keeps_bare_model_on_rayu() {
        with_clean_provider_test_env(|| {
            let runtime = enter_test_runtime();
            let _enter = runtime.enter();
            register_rayu_runtime();
            external::register_openrouter_factory(|spec| {
                use external::OpenRouterRuntimeSpec;
                use rayucode_provider_openrouter_runtime::OpenRouterProvider;
                let provider: Arc<dyn Provider> = match spec {
                    OpenRouterRuntimeSpec::OpenRouterApiKey | OpenRouterRuntimeSpec::Default => {
                        Arc::new(OpenRouterProvider::new()?)
                    }
                    OpenRouterRuntimeSpec::CompatibleProfile(profile) => Arc::new(
                        OpenRouterProvider::new_openai_compatible_profile_runtime(profile)?,
                    ),
                    OpenRouterRuntimeSpec::NamedProfile { name, config } => Arc::new(
                        OpenRouterProvider::new_named_openai_compatible(&name, &config)?,
                    ),
                };
                Ok(provider)
            });

            let (addr, _paths, server) = spawn_mock_gateway(vec![(
                "200 OK",
                gateway_models_body(&[
                    ("deepseek-v4.1-flash-1017-cloud", 1_000_000),
                    ("qwen4-max-preview", 256_000),
                ]),
            )]);
            configure_rayu_api_key_route(addr);
            crate::env::set_var("OPENROUTER_API_KEY", "sk-or-v1-test-openrouter-key");

            let auth = crate::auth::AuthStatus {
                openrouter: crate::auth::AuthState::Available,
                ..crate::auth::AuthStatus::default()
            };
            let provider = MultiProvider::from_auth_status(auth);

            assert_eq!(
                provider.display_name(),
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME
            );
            assert_eq!(
                provider.runtime_provider_label(ActiveProvider::OpenRouter),
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME
            );

            // Prefetch hits the mock Rayu gateway and populates live routes at the front.
            runtime
                .block_on(provider.prefetch_models())
                .expect("prefetch");
            assert!(
                matches!(
                    provider.model().as_str(),
                    "deepseek-v4.1-flash-1017-cloud" | "qwen4-max-preview"
                ),
                "expected a live gateway model after prefetch, got {}",
                provider.model()
            );

            let routes = provider.model_routes();
            assert_eq!(
                routes
                    .first()
                    .map(|r| (r.model.as_str(), r.api_method.as_str())),
                Some((
                    "rayu:deepseek-v4.1-flash-1017-cloud",
                    crate::rayu::RAYU_ROUTE_API_METHOD
                )),
                "Rayu gateway routes must lead MultiProvider::model_routes(); got {:?}",
                routes.iter().take(5).collect::<Vec<_>>()
            );
            assert!(
                !routes.iter().any(|r| {
                    matches!(
                        r.api_method.as_str(),
                        "claude-oauth" | "claude-api" | "openai-oauth" | "openai-api"
                    ) && !r.available
                }),
                "unconfigured Claude/OpenAI placeholder routes must be omitted when Rayu is configured"
            );

            // Bare Rayu model switch stays on Rayu even with OpenRouter configured.
            provider
                .set_model("deepseek-v4.1-flash-1017-cloud")
                .expect("bare Rayu switch");
            assert_eq!(
                provider.display_name(),
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME
            );
            assert_eq!(provider.model(), "deepseek-v4.1-flash-1017-cloud");

            // Explicit OpenRouter prefix cleanly leaves Rayu for OpenRouter.
            provider
                .set_model("openrouter:deepseek/deepseek-v4.1-flash")
                .expect("explicit openrouter switch");
            assert_eq!(provider.display_name(), "OpenRouter");

            server.join().expect("mock gateway thread");
        });
    }

    #[test]
    fn multiprovider_stays_on_rayu_after_login_activation_and_fork_with_openrouter_configured() {
        with_clean_provider_test_env(|| {
            let runtime = enter_test_runtime();
            let _enter = runtime.enter();
            register_rayu_runtime();
            external::register_openrouter_factory(|spec| {
                use external::OpenRouterRuntimeSpec;
                use rayucode_provider_openrouter_runtime::OpenRouterProvider;
                let provider: Arc<dyn Provider> = match spec {
                    OpenRouterRuntimeSpec::OpenRouterApiKey | OpenRouterRuntimeSpec::Default => {
                        Arc::new(OpenRouterProvider::new()?)
                    }
                    OpenRouterRuntimeSpec::CompatibleProfile(profile) => Arc::new(
                        OpenRouterProvider::new_openai_compatible_profile_runtime(profile)?,
                    ),
                    OpenRouterRuntimeSpec::NamedProfile { name, config } => Arc::new(
                        OpenRouterProvider::new_named_openai_compatible(&name, &config)?,
                    ),
                };
                Ok(provider)
            });

            // Serve 3 requests: initial prefetch + fork_for_new_session prefetch +
            // auth-session prefetch.
            let (addr, _paths, server) = spawn_mock_gateway(vec![(
                "200 OK",
                gateway_models_body(&[
                    ("deepseek-v4.1-flash-1017-cloud", 1_000_000),
                    ("qwen4-max-preview", 256_000),
                ]),
            )]);
            configure_rayu_api_key_route(addr);
            crate::env::set_var("OPENROUTER_API_KEY", "sk-or-v1-test-openrouter-key");

            // Simulate `/login rayu` activating process env (`RAYU_RUNTIME_PROVIDER=rayu`,
            // `RAYU_ACTIVE_PROVIDER=openrouter`, `RAYU_INITIAL_PROVIDER_EXPLICIT=1`).
            let activation = crate::auth::lifecycle::activate_auth_change(
                &crate::auth::lifecycle::AuthActivationRequest::new(Some("rayu".to_string()), None),
            );
            assert_eq!(activation.provider_id.as_deref(), Some("rayu"));

            let auth = crate::auth::AuthStatus {
                openrouter: crate::auth::AuthState::Available,
                ..crate::auth::AuthStatus::default()
            };
            let provider = MultiProvider::from_auth_status(auth);
            assert_eq!(
                provider.display_name(),
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME,
                "RAYU_RUNTIME_PROVIDER=rayu + RAYU_ACTIVE_PROVIDER=openrouter must activate Rayu, not OpenRouter"
            );

            runtime
                .block_on(provider.prefetch_models())
                .expect("prefetch");
            provider
                .set_model("rayu:qwen4-max-preview")
                .expect("select Rayu model");

            // Ordinary fork() (resumed sessions, subagents) must preserve Rayu
            // and keep Rayu routes at the front of model_routes().
            let forked = provider.fork();
            assert_eq!(
                forked.display_name(),
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME,
                "MultiProvider::fork() must preserve Rayu instead of reverting to OpenRouter"
            );
            assert_eq!(forked.model(), "qwen4-max-preview");
            let forked_routes = forked.model_routes();
            assert_eq!(
                forked_routes
                    .first()
                    .map(|r| (r.model.as_str(), r.api_method.as_str())),
                Some((
                    "rayu:deepseek-v4.1-flash-1017-cloud",
                    crate::rayu::RAYU_ROUTE_API_METHOD
                )),
                "forked provider must keep Rayu routes first in model_routes()"
            );

            // fork_for_new_session() (new TUI windows connecting to a shared daemon
            // after `/login rayu`) must also stay on Rayu.
            let new_session = provider.fork_for_new_session();
            assert_eq!(
                new_session.display_name(),
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME,
                "fork_for_new_session() after /login rayu must default to Rayu"
            );

            // Rayu account-session auth (without RAYU_API_KEY) also defaults to Rayu
            // over OpenRouter even after `/login rayu` env activation.
            crate::env::remove_var("RAYU_API_KEY");
            let session = crate::rayu::RayuSession {
                access_token:
                    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEiLCJleHAiOjQxMDI0NDQ4MDB9.sig"
                        .to_string(),
                refresh_token: "rt_test_token".to_string(),
                expires_at: 4_102_444_800_000,
                user: crate::rayu::RayuSessionUser {
                    id: 1,
                    email: Some("test@rayu.local".to_string()),
                    display_name: Some("Test User".to_string()),
                    avatar_url: None,
                    role: "user".to_string(),
                },
            };
            crate::rayu::write_session(&session).expect("write test Rayu session");
            let auth_session_provider = MultiProvider::from_auth_status(crate::auth::AuthStatus {
                openrouter: crate::auth::AuthState::Available,
                ..crate::auth::AuthStatus::default()
            });
            assert_eq!(
                auth_session_provider.display_name(),
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME,
                "Rayu account auth must default to Rayu over OpenRouter"
            );

            // Simplified and lightweight fallback route builders must keep `rayu:`
            // routes tagged as Rayu even when the ambient provider label is OpenRouter,
            // and never mislabel OpenRouter slash-IDs as Rayu.
            let simplified = crate::provider::simplified_model_routes_for_picker(
                "OpenRouter",
                "deepseek/deepseek-v4.1-flash",
                vec![
                    "rayu:qwen4-max-preview".to_string(),
                    "deepseek/deepseek-v4.1-flash".to_string(),
                ],
            );
            assert_eq!(simplified[0].model, "rayu:qwen4-max-preview");
            assert_eq!(
                simplified[0].provider,
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME
            );
            assert_eq!(simplified[0].api_method, crate::rayu::RAYU_ROUTE_API_METHOD);
            assert_eq!(simplified[1].api_method, "openrouter");

            let lightweight_or = crate::provider::remote_model_routes_lightweight_fallback(
                Some("OpenRouter"),
                &[
                    "rayu:qwen4-max-preview".to_string(),
                    "deepseek/deepseek-v4.1-flash".to_string(),
                ],
                "deepseek/deepseek-v4.1-flash",
            );
            assert_eq!(
                lightweight_or[0].provider,
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME
            );
            assert_eq!(
                lightweight_or[0].api_method,
                crate::rayu::RAYU_ROUTE_API_METHOD
            );
            assert_eq!(lightweight_or[1].api_method, "remote-catalog");

            let lightweight_rayu = crate::provider::remote_model_routes_lightweight_fallback(
                Some("Rayu"),
                &[
                    "rayu:qwen4-max-preview".to_string(),
                    "deepseek/deepseek-v4.1-flash".to_string(),
                ],
                "qwen4-max-preview",
            );
            assert_eq!(
                lightweight_rayu[0].api_method,
                crate::rayu::RAYU_ROUTE_API_METHOD
            );
            assert_eq!(lightweight_rayu[1].api_method, "remote-catalog");

            // Ctrl+O default selection must never double-prefix `rayu:rayu:...`.
            let default_sel = MultiProvider::default_model_selection_from_route(
                "rayu:qwen4-max-preview",
                crate::rayu::RAYU_ROUTE_API_METHOD,
                crate::rayu::RAYU_PROVIDER_DISPLAY_NAME,
            );
            assert_eq!(default_sel.model_spec, "rayu:qwen4-max-preview");
            assert_eq!(default_sel.provider_key.as_deref(), Some("rayu"));

            // Onboarding global route selection must prefer Rayu ahead of OpenRouter.
            let mixed_routes = vec![
                ModelRoute {
                    model: "openai/gpt-6.1-sol".to_string(),
                    provider: "auto".to_string(),
                    api_method: "openrouter".to_string(),
                    available: true,
                    detail: String::new(),
                    usage: None,
                    cheapness: None,
                },
                ModelRoute {
                    model: "rayu:deepseek-v4.1-flash-1017-cloud".to_string(),
                    provider: crate::rayu::RAYU_PROVIDER_DISPLAY_NAME.to_string(),
                    api_method: crate::rayu::RAYU_ROUTE_API_METHOD.to_string(),
                    available: true,
                    detail: String::new(),
                    usage: None,
                    cheapness: None,
                },
                ModelRoute {
                    model: "rayu:qwen4-max-preview".to_string(),
                    provider: crate::rayu::RAYU_PROVIDER_DISPLAY_NAME.to_string(),
                    api_method: crate::rayu::RAYU_ROUTE_API_METHOD.to_string(),
                    available: true,
                    detail: String::new(),
                    usage: None,
                    cheapness: None,
                },
            ];
            let preferred = crate::auth::lifecycle::globally_preferred_default_route(&mixed_routes)
                .expect("preferred route");
            assert_eq!(preferred.model, "rayu:deepseek-v4.1-flash-1017-cloud");
            assert_eq!(preferred.api_method, crate::rayu::RAYU_ROUTE_API_METHOD);

            // Lifecycle invariants & post-auth selection must match bare Rayu ids
            // against `rayu:`-prefixed routes.
            let report = crate::auth::lifecycle::validate_catalog_invariants(
                &activation,
                Some("qwen4-max-preview"),
                &mixed_routes,
            );
            assert!(report.selected_model_matches_provider_route);
            assert_eq!(
                crate::auth::lifecycle::provider_model_to_select_after_auth(
                    &activation,
                    Some("qwen4-max-preview"),
                    &mixed_routes,
                ),
                None,
                "already-selected Rayu bare model matches prefixed route"
            );
            assert_eq!(
                crate::auth::lifecycle::provider_model_to_select_after_auth_with_configured_default(
                    &activation,
                    Some("rayu:qwen4-max-preview"),
                    Some("deepseek-v4.1-flash-1017-cloud"),
                    &mixed_routes,
                )
                .as_deref(),
                Some("rayu:qwen4-max-preview")
            );

            server.join().expect("mock gateway thread");
        });
    }
}
