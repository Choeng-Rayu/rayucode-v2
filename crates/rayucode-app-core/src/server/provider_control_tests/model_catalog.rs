use super::*;

#[tokio::test]
async fn failed_refresh_still_publishes_successful_partial_catalog() {
    struct PartialCatalogProvider(std::sync::atomic::AtomicBool);
    #[async_trait]
    impl Provider for PartialCatalogProvider {
        async fn complete(
            &self,
            _: &[Message],
            _: &[ToolDefinition],
            _: &str,
            _: Option<&str>,
        ) -> anyhow::Result<EventStream> {
            unreachable!()
        }
        fn name(&self) -> &str {
            "partial-catalog"
        }
        fn model(&self) -> String {
            "fallback".into()
        }
        fn fork(&self) -> Arc<dyn Provider> {
            Arc::new(Self(std::sync::atomic::AtomicBool::new(
                self.0.load(Ordering::SeqCst),
            )))
        }
        fn available_models_display(&self) -> Vec<String> {
            if self.0.load(Ordering::SeqCst) {
                vec!["fallback".into(), "new-from-successful-provider".into()]
            } else {
                vec!["fallback".into()]
            }
        }
        async fn refresh_model_catalog(&self) -> anyhow::Result<ModelCatalogRefreshSummary> {
            self.0.store(true, Ordering::SeqCst);
            anyhow::bail!("another provider failed")
        }
    }
    let provider: Arc<dyn Provider> = Arc::new(PartialCatalogProvider(
        std::sync::atomic::AtomicBool::new(false),
    ));
    let agent = Arc::new(Mutex::new(Agent::new(provider.clone(), Registry::empty())));
    let (tx, mut rx) = mpsc::unbounded_channel();
    handle_refresh_models(81, &provider, &agent, &tx).await;
    let mut saw_catalog = false;
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while let Some(event) = rx.recv().await {
            match event {
                ServerEvent::AvailableModelsUpdated {
                    available_models, ..
                } => {
                    assert!(
                        available_models
                            .iter()
                            .any(|model| model == "new-from-successful-provider")
                    );
                    saw_catalog = true;
                }
                ServerEvent::Error {
                    id: 81, message, ..
                } => {
                    assert!(message.contains("another provider failed"));
                    return;
                }
                _ => {}
            }
        }
        panic!("refresh must report the provider error");
    })
    .await
    .expect("partial refresh must finish");
    assert!(
        saw_catalog,
        "partial successes must reach the picker even on error"
    );
}

#[tokio::test]
async fn refresh_models_emits_available_models_updated_after_prefetch() {
    crate::bus::reset_models_updated_publish_state_for_tests();
    let provider: Arc<dyn Provider> = Arc::new(AuthChangeMockProvider::new());
    let registry = Registry::empty();
    let agent = Arc::new(Mutex::new(Agent::new(provider.clone(), registry)));
    let (client_event_tx, mut client_event_rx) = mpsc::unbounded_channel();

    handle_refresh_models(7, &provider, &agent, &client_event_tx).await;

    let mut saw_done = false;
    let mut saw_models = None;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let event = tokio::time::timeout(remaining, client_event_rx.recv())
            .await
            .expect("receive server event before timeout");
        match event.expect("channel open") {
            ServerEvent::Done { id } => {
                assert_eq!(id, 7);
                saw_done = true;
            }
            ServerEvent::AvailableModelsUpdated {
                provider_name,
                provider_model,
                available_models,
                available_model_routes,
            } => {
                saw_models = Some((
                    provider_name,
                    provider_model,
                    available_models,
                    available_model_routes,
                ));
                break;
            }
            _ => {}
        }
    }

    assert!(saw_done, "expected immediate Done ack");
    let (provider_name, provider_model, available_models, available_model_routes) =
        saw_models.expect("expected AvailableModelsUpdated event");
    assert_eq!(provider_name.as_deref(), Some("mock-auth"));
    assert_eq!(provider_model.as_deref(), Some("logged-out-model"));
    assert_eq!(available_models, vec!["logged-out-model".to_string()]);
    assert!(available_model_routes.iter().any(|route| {
        route.model == "logged-out-model"
            && route.provider == "MockAuth"
            && route.api_method == "mock-auth"
    }));
}

#[tokio::test]
async fn notify_auth_changed_does_not_pin_other_busy_session_past_disconnect() {
    let _guard = EnvGuard::save(&[]);
    crate::bus::reset_models_updated_publish_state_for_tests();
    let provider: Arc<dyn Provider> = Arc::new(AuthChangeMockProvider::new());
    let session_a =
        crate::session::Session::create_with_id("session_auth_requester".into(), None, None);
    let session_b = crate::session::Session::create_with_id("session_busy_peer".into(), None, None);
    let agent_a = Arc::new(Mutex::new(Agent::new_with_session(
        provider.clone(),
        Registry::empty(),
        session_a,
        None,
    )));
    let agent_b = Arc::new(Mutex::new(Agent::new_with_session(
        provider.clone(),
        Registry::empty(),
        session_b,
        None,
    )));
    let sessions: SessionAgents = Arc::new(crate::server::session_manager::SessionManager::new());
    sessions
        .register_new("session_auth_requester".into(), Arc::clone(&agent_a))
        .await
        .unwrap();
    sessions
        .register_new("session_busy_peer".into(), Arc::clone(&agent_b))
        .await
        .unwrap();

    // Hold BOTH agent locks: requester is busy (blocking handle_notify_auth_changed's
    // spawned task on agent_a.lock()) and peer is busy (pushed into deferred_agents).
    let _busy_a = agent_a.lock().await;
    let busy_b = agent_b.lock().await;
    let (tx, _rx) = mpsc::unbounded_channel();

    handle_notify_auth_changed(
        701,
        None,
        None,
        false,
        &provider,
        &provider,
        &sessions,
        "session_auth_requester",
        &agent_a,
        &tx,
    )
    .await;

    // Simulate peer session disconnecting and retiring while requester stays busy.
    drop(busy_b);
    let removed_b = sessions.remove("session_busy_peer").await;
    drop(removed_b);
    drop(agent_b);

    for _ in 0..20 {
        if sessions
            .reserve("session_busy_peer")
            .await
            .ensure_vacant()
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    assert!(
        sessions
            .reserve("session_busy_peer")
            .await
            .ensure_vacant()
            .is_ok(),
        "retired peer session must not remain pinned by another session's notify_auth_changed task"
    );
}

#[tokio::test]
async fn refresh_models_does_not_pin_retired_agent_while_catalog_pending() {
    struct HangingRefreshProvider {
        entered: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
    }
    #[async_trait]
    impl Provider for HangingRefreshProvider {
        async fn complete(
            &self,
            _: &[Message],
            _: &[ToolDefinition],
            _: &str,
            _: Option<&str>,
        ) -> anyhow::Result<EventStream> {
            unreachable!()
        }
        fn name(&self) -> &str {
            "hanging-refresh"
        }
        fn model(&self) -> String {
            "fallback".into()
        }
        fn fork(&self) -> Arc<dyn Provider> {
            Arc::new(Self {
                entered: Arc::clone(&self.entered),
                release: Arc::clone(&self.release),
            })
        }
        async fn refresh_model_catalog(&self) -> anyhow::Result<ModelCatalogRefreshSummary> {
            self.entered.notify_waiters();
            self.release.notified().await;
            Ok(ModelCatalogRefreshSummary::default())
        }
    }

    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let provider: Arc<dyn Provider> = Arc::new(HangingRefreshProvider {
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
    });
    let session =
        crate::session::Session::create_with_id("session_refresh_drop".into(), None, None);
    let agent = Arc::new(Mutex::new(Agent::new_with_session(
        provider.clone(),
        Registry::empty(),
        session,
        None,
    )));
    let sessions: SessionAgents = Arc::new(crate::server::session_manager::SessionManager::new());
    sessions
        .register_new("session_refresh_drop".into(), Arc::clone(&agent))
        .await
        .unwrap();

    let (tx, _rx) = mpsc::unbounded_channel();
    let entered_wait = entered.notified();
    handle_refresh_models(702, &provider, &agent, &tx).await;
    tokio::time::timeout(std::time::Duration::from_secs(2), entered_wait)
        .await
        .expect("refresh task entered refresh_model_catalog");

    let removed = sessions.remove("session_refresh_drop").await;
    drop(removed);
    drop(agent);

    assert!(
        sessions
            .reserve("session_refresh_drop")
            .await
            .ensure_vacant()
            .is_ok(),
        "slow refresh_model_catalog must not pin a retired Agent in SessionManager::owners"
    );
    release.notify_waiters();
}
