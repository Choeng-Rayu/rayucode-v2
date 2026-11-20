use super::{
    App, antigravity_input_requires_state_validation, save_tui_openai_compatible_api_base,
    save_tui_openai_compatible_key,
};

fn with_temp_rayu_home<T>(f: impl FnOnce() -> T) -> T {
    let _env_guard = crate::storage::lock_test_env();
    let _provider_env = super::super::tests::ProviderEnvGuard::clear();
    let temp = tempfile::tempdir().expect("tempdir");
    // The account-store safety check rejects group/other-writable homes.
    // tempfile inherits the process umask (002 on some hosts -> 0775), so
    // harden the fixture to owner-only regardless of the ambient umask.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o700))
            .expect("harden temp rayu home");
    }
    let saved_env = ["RAYU_HOME"].map(|key| (key, std::env::var_os(key)));

    crate::env::set_var("RAYU_HOME", temp.path());

    let result = f();

    for (key, value) in saved_env {
        if let Some(value) = value {
            crate::env::set_var(key, value);
        } else {
            crate::env::remove_var(key);
        }
    }
    result
}

#[test]
fn antigravity_auto_callback_code_skips_manual_callback_parser() {
    assert!(!antigravity_input_requires_state_validation(
        "raw_authorization_code",
        Some("expected_state")
    ));
}

#[test]
fn antigravity_manual_callback_url_keeps_state_validation() {
    assert!(antigravity_input_requires_state_validation(
        "http://127.0.0.1:51121/oauth-callback?code=abc&state=expected_state",
        Some("expected_state")
    ));
}

#[test]
fn oauth_preflight_mentions_browser_fallback_and_doctor() {
    let message = App::record_oauth_preflight("openai", false, Some("localhost:1455"), Some(true));
    assert!(message.contains("could not open a browser"));
    assert!(message.contains("auth doctor openai"));
}

#[test]
fn oauth_preflight_mentions_manual_safe_callback_mode() {
    let message = App::record_oauth_preflight(
        "gemini",
        true,
        Some("http://127.0.0.1:0/oauth2callback"),
        Some(false),
    );
    assert!(message.contains("manual-safe paste completion"));
    assert!(message.contains("oauth2callback"));
}

#[test]
fn tui_openai_compatible_api_base_accepts_localhost_override() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let resolved = save_tui_openai_compatible_api_base("http://localhost:11434/v1")?;
        assert_eq!(resolved.api_base, "http://localhost:11434/v1");
        assert!(!resolved.requires_api_key);
        Ok(())
    })
}

#[test]
fn tui_openai_compatible_api_base_keeps_rayu_docs_and_remote_endpoint() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let resolved = save_tui_openai_compatible_api_base("https://api.deepseek.com/")?;
        assert_eq!(resolved.api_base, "https://api.deepseek.com");
        assert!(resolved.requires_api_key);
        assert!(
            resolved
                .setup_url
                .contains("github.com/Choeng-Rayu/rayucode")
        );
        assert!(!resolved.setup_url.contains("opencode.ai"));
        Ok(())
    })
}

#[test]
fn tui_openai_compatible_key_save_persists_key_for_current_session() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let resolved = save_tui_openai_compatible_api_base("https://api.example.com/v1")?;
        let resolved = save_tui_openai_compatible_key(
            crate::provider_catalog::OPENAI_COMPAT_PROFILE,
            " sk-test-tui-login ",
        )
        .map(|_| resolved)?;

        assert!(
            crate::provider_catalog::openai_compatible_profile_is_configured(
                crate::provider_catalog::OPENAI_COMPAT_PROFILE,
            )
        );
        assert_eq!(
            crate::provider_catalog::load_api_key_from_env_or_config(
                &resolved.api_key_env,
                &resolved.env_file,
            )
            .as_deref(),
            Some("sk-test-tui-login")
        );
        assert!(
            std::env::var_os(&resolved.api_key_env).is_none(),
            "saving must not poison the process env (issue #1386)"
        );
        Ok(())
    })
}

#[test]
fn tui_api_key_logout_clears_saved_key_and_process_env() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let resolved = save_tui_openai_compatible_api_base("https://api.example.com/v1")?;
        let resolved = save_tui_openai_compatible_key(
            crate::provider_catalog::OPENAI_COMPAT_PROFILE,
            " sk-test-tui-login ",
        )
        .map(|_| resolved)?;

        // Saving is file-only (#1386), so the key is readable from the env file
        // and never copied into the process environment.
        assert_eq!(
            crate::provider_catalog::load_api_key_from_env_or_config(
                &resolved.api_key_env,
                &resolved.env_file,
            )
            .as_deref(),
            Some("sk-test-tui-login")
        );
        assert!(std::env::var_os(&resolved.api_key_env).is_none());

        App::clear_api_key_login(&resolved.api_key_env, &resolved.env_file)?;

        assert!(std::env::var_os(&resolved.api_key_env).is_none());
        assert!(
            crate::provider_catalog::load_api_key_from_env_or_config(
                &resolved.api_key_env,
                &resolved.env_file,
            )
            .is_none()
        );
        Ok(())
    })
}

/// Point the shared Rayu config dir at a temp directory for one test and
/// restore the previous value on drop. The caller must already hold the
/// global test-env lock (with_temp_rayu_home does).
struct RayuConfigDirGuard {
    saved: Option<std::ffi::OsString>,
    _dir: tempfile::TempDir,
}

impl RayuConfigDirGuard {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let saved = std::env::var_os("RAYU_AUTH_CONFIG_DIR");
        crate::env::set_var("RAYU_AUTH_CONFIG_DIR", dir.path());
        Self { saved, _dir: dir }
    }
}

impl Drop for RayuConfigDirGuard {
    fn drop(&mut self) {
        match self.saved.take() {
            Some(value) => crate::env::set_var("RAYU_AUTH_CONFIG_DIR", value),
            None => crate::env::remove_var("RAYU_AUTH_CONFIG_DIR"),
        }
    }
}

fn rayu_test_session() -> crate::rayu::RayuSession {
    crate::rayu::RayuSession {
        access_token: "test-access-token".to_string(),
        refresh_token: "test-refresh-token".to_string(),
        expires_at: 4_102_444_800_000,
        user: crate::rayu::RayuSessionUser {
            id: 42,
            email: Some("user@example.com".to_string()),
            display_name: Some("Rayu User".to_string()),
            avatar_url: None,
            role: "user".to_string(),
        },
    }
}

#[test]
fn tui_rayu_logout_clears_session_and_credentials() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let _rayu_dir = RayuConfigDirGuard::new();
        crate::rayu::write_session(&rayu_test_session())?;
        assert!(crate::rayu::has_usable_session());
        assert!(crate::rayu::has_credentials());

        crate::rayu::logout()?;

        assert!(crate::rayu::read_session().is_none());
        assert!(!crate::rayu::has_usable_session());
        assert!(!crate::rayu::has_credentials());
        Ok(())
    })
}

#[test]
fn tui_rayu_session_file_is_owner_only_and_camel_case() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let rayu_dir = RayuConfigDirGuard::new();
        crate::rayu::write_session(&rayu_test_session())?;
        let path = rayu_dir._dir.path().join("rayu-auth.json");
        let raw = std::fs::read_to_string(&path)?;
        assert!(raw.contains("\"accessToken\""));
        assert!(raw.contains("\"refreshToken\""));
        assert!(raw.contains("\"expiresAt\""));
        assert!(raw.contains("\"displayName\""));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)?.permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "session file must be owner-only");
        }
        Ok(())
    })
}

#[test]
fn rayu_pending_login_telemetry_attributes_loopback_method() {
    use super::auth_types::PendingLogin;

    assert_eq!(
        PendingLogin::Rayu.telemetry_context(),
        Some(("rayu".to_string(), "oauth_loopback".to_string()))
    );
    assert_eq!(
        PendingLogin::RayuCallback.telemetry_context(),
        Some(("rayu".to_string(), "oauth_loopback".to_string()))
    );
}

#[test]
fn tui_openai_compatible_local_key_save_allows_empty_key() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let resolved = save_tui_openai_compatible_key(crate::provider_catalog::OLLAMA_PROFILE, "")?;
        assert_eq!(resolved.api_base, "http://localhost:11434/v1");
        assert!(
            crate::provider_catalog::openai_compatible_profile_is_configured(
                crate::provider_catalog::OLLAMA_PROFILE
            )
        );
        assert!(
            crate::provider_catalog::load_api_key_from_env_or_config(
                &resolved.api_key_env,
                &resolved.env_file,
            )
            .is_none()
        );
        Ok(())
    })
}

#[test]
fn muse_subscription_pending_holds_attempt_cancel_slot() {
    use super::auth_types::PendingLogin;

    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let approved = std::sync::Arc::new(std::sync::Mutex::new(None));
    let pending = PendingLogin::MuseSubscription {
        attempt: "muse-subscription#abc123".to_string(),
        cancelled: std::sync::Arc::clone(&cancelled),
        approved: std::sync::Arc::clone(&approved),
    };
    // Telemetry still attributes the device-code method.
    assert_eq!(
        pending.telemetry_context(),
        Some(("muse-subscription".to_string(), "device_code".to_string()))
    );
    // /cancel flips the shared flag and drops the slot: the background task
    // observes the flag before every poll and before handoff, and the handler
    // takes credentials from the slot only for a matching attempt.
    if let PendingLogin::MuseSubscription {
        cancelled,
        approved,
        ..
    } = &pending
    {
        cancelled.store(true, std::sync::atomic::Ordering::Release);
        if let Ok(mut slot) = approved.lock() {
            *slot = None;
        }
    }
    assert!(cancelled.load(std::sync::atomic::Ordering::Acquire));
    assert!(approved.lock().map(|slot| slot.is_none()).unwrap_or(false));
}

#[test]
fn muse_subscription_code_progress_renders_without_success_side_effects() {
    let _env_guard = crate::storage::lock_test_env();
    let mut app = App::new_for_remote(None);
    app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
        attempt: "muse-subscription#abc123".to_string(),
        cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        approved: std::sync::Arc::new(std::sync::Mutex::new(None)),
    });
    assert!(app.recent_authenticated_provider.is_none());

    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse_subscription_code#abc123".to_string(),
        success: true,
        message: "Muse Subscription Login\n\nYour code: ABCD-1234\n\nWaiting...".to_string(),
    });

    // Pending approval must not mark a completed login, trigger catalog
    // refresh, or record auth success.
    assert!(app.recent_authenticated_provider.is_none());
    assert!(!app.auth_catalog_refresh_pending);
    assert_eq!(
        app.status_notice
            .as_ref()
            .map(|(notice, _)| notice.as_str()),
        Some("Login: enter ABCD-1234 at Meta")
    );
}

#[test]
fn muse_subscription_stale_events_after_cancel_are_ignored() {
    let _env_guard = crate::storage::lock_test_env();
    let mut app = App::new_for_remote(None);

    // A stale progress event for a superseded attempt renders nothing.
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse_subscription_code#old999".to_string(),
        success: true,
        message: "Muse Subscription Login\n\nYour code: STALE-0000\n\nWaiting...".to_string(),
    });
    assert!(app.recent_authenticated_provider.is_none());
    assert!(app.status_notice.is_none());

    // A stale approval event with no matching pending attempt saves nothing
    // and switches no provider.
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse-subscription#old999".to_string(),
        success: true,
        message: "Muse subscription approved in the browser; finalizing...".to_string(),
    });
    assert!(app.recent_authenticated_provider.is_none());
    assert!(!app.auth_catalog_refresh_pending);

    // A cancelled pending attempt rejects even its own approval event.
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
        attempt: "muse-subscription#cancelled1".to_string(),
        cancelled,
        approved: std::sync::Arc::new(std::sync::Mutex::new(None)),
    });
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse-subscription#cancelled1".to_string(),
        success: true,
        message: "Muse subscription approved in the browser; finalizing...".to_string(),
    });
    assert!(app.recent_authenticated_provider.is_none());
    assert!(!app.auth_catalog_refresh_pending);
}

#[test]
fn muse_subscription_canonical_success_publishes_untagged_event_and_updates_local_state()
-> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let prev_opt_in = std::env::var(crate::auth::muse::EXPERIMENTAL_ENV_VAR).ok();
        crate::env::set_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR, "1");
        struct RestoreOptIn(Option<String>);
        impl Drop for RestoreOptIn {
            fn drop(&mut self) {
                if let Some(val) = &self.0 {
                    crate::env::set_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR, val);
                } else {
                    crate::env::remove_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR);
                }
            }
        }
        let _restore = RestoreOptIn(prev_opt_in);

        // This test exercises returning-user login state. A fresh install
        // intentionally replaces the ready notice with onboarding guidance.
        let mut hints = crate::setup_hints::SetupHintsState::load();
        hints.onboarding_start_choice_shown = true;
        hints.save()?;
        let mut app = App::new_for_remote(None);
        let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let approved = std::sync::Arc::new(std::sync::Mutex::new(None));
        let attempt = "attempt_succ_123";

        // Subscribe to Bus before the approval is processed
        let mut bus_rx = crate::bus::Bus::global().subscribe();

        app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
            attempt: attempt.to_string(),
            cancelled: std::sync::Arc::clone(&cancelled),
            approved: std::sync::Arc::clone(&approved),
        });

        // Place approved credentials in the slot
        *approved.lock().unwrap() = Some(crate::auth::muse::MuseCredentials {
            api_key: "test_key_123".to_string(),
            access_token: "test_token_123".to_string(),
            base_url: crate::auth::muse::EXPECTED_API_BASE_URL.to_string(),
            user_email: Some("user@example.com".to_string()),
            user_full_name: Some("Test User".to_string()),
            is_subs_active: true,
            minted_at_ms: 1000,
            subs_usage: None,
        });

        // Handle the attempt-scoped approval event
        app.handle_login_completed(crate::bus::LoginCompleted {
            provider: format!("muse-subscription#{attempt}"),
            success: true,
            message: "Muse subscription approved in the browser; finalizing...".to_string(),
        });

        // Credentials must be saved to disk
        assert!(crate::auth::muse::load_credentials().is_ok());

        // Exactly one canonical untagged event must be published
        let mut canonical_event = None;
        while let Ok(event) = bus_rx.try_recv() {
            if let crate::bus::BusEvent::LoginCompleted(login) = event
                && login.provider == "muse-subscription"
            {
                canonical_event = Some(login);
                break;
            }
        }
        let canonical = canonical_event.expect("canonical untagged event must be published");
        assert!(canonical.success);
        assert_eq!(canonical.provider, "muse-subscription");

        // Verify remote classification helper:
        // is_completed_login is true for canonical event, false for attempt-scoped event
        assert!(super::auth_muse_helpers::is_completed_login(&canonical));
        assert!(!super::auth_muse_helpers::is_completed_login(
            &crate::bus::LoginCompleted {
                provider: format!("muse-subscription#{attempt}"),
                success: true,
                message: "tagged".to_string(),
            }
        ));

        // Now dispatch the canonical event into handle_login_completed
        app.handle_login_completed(canonical);

        // Local state must now be fully updated
        assert_eq!(
            app.recent_authenticated_provider
                .as_ref()
                .map(|(p, _)| p.as_str()),
            Some("muse-subscription")
        );
        assert!(app.auth_catalog_refresh_pending);
        assert_eq!(
            app.status_notice.as_ref().map(|(n, _)| n.as_str()),
            Some("Login: muse-subscription ready")
        );
        assert!(app.pending_login.is_none());
        Ok(())
    })
}

#[test]
fn muse_subscription_failed_attempt_surfaces_message_and_clears_pending() {
    let _env_guard = crate::storage::lock_test_env();
    let mut app = App::new_for_remote(None);
    let attempt = "attempt_fail_456";
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let approved = std::sync::Arc::new(std::sync::Mutex::new(None));

    app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
        attempt: attempt.to_string(),
        cancelled,
        approved,
    });

    // Handle a failed attempt event (denial, expiry, or network failure)
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: format!("muse-subscription#{attempt}"),
        success: false,
        message: "Muse subscription login was denied or cancelled in the browser.".to_string(),
    });

    // The failure message must be surfaced to the user
    let error_displayed = app.display_messages().iter().any(|m| {
        m.content
            .contains("Muse subscription login was denied or cancelled in the browser.")
    });
    assert!(error_displayed, "error message must be displayed to user");

    // Status notice must indicate failure rather than remaining stuck waiting
    assert_eq!(
        app.status_notice.as_ref().map(|(n, _)| n.as_str()),
        Some("Login: muse-subscription failed")
    );

    // Pending login must be cleared
    assert!(app.pending_login.is_none());
    assert!(app.recent_authenticated_provider.is_none());
}

#[test]
fn muse_subscription_stale_and_cancelled_progress_and_failure_are_ignored() {
    let _env_guard = crate::storage::lock_test_env();
    let mut app = App::new_for_remote(None);
    let active_attempt = "active_attempt_789";
    let cancelled_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let approved = std::sync::Arc::new(std::sync::Mutex::new(None));

    app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
        attempt: active_attempt.to_string(),
        cancelled: std::sync::Arc::clone(&cancelled_flag),
        approved: std::sync::Arc::clone(&approved),
    });
    app.set_status_notice("Login: active waiting");

    // 1. Stale progress from an old attempt is ignored
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse_subscription_code#old_stale_attempt".to_string(),
        success: true,
        message: "Muse Subscription Login\n\nYour code: OLD-CODE\n\nWaiting...".to_string(),
    });
    assert_eq!(
        app.status_notice.as_ref().map(|(n, _)| n.as_str()),
        Some("Login: active waiting")
    );
    assert!(
        !app.display_messages()
            .iter()
            .any(|m| m.content.contains("OLD-CODE"))
    );

    // 2. Stale failure from an old attempt is ignored
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse-subscription#old_stale_attempt".to_string(),
        success: false,
        message: "Old attempt failed".to_string(),
    });
    assert!(app.pending_login.is_some());
    assert_eq!(
        app.status_notice.as_ref().map(|(n, _)| n.as_str()),
        Some("Login: active waiting")
    );

    // 3. Mark the active attempt cancelled
    cancelled_flag.store(true, std::sync::atomic::Ordering::Release);

    // Queued progress for the cancelled attempt must be ignored
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: format!("muse_subscription_code#{active_attempt}"),
        success: true,
        message: "Muse Subscription Login\n\nYour code: CANCELLED-CODE\n\nWaiting...".to_string(),
    });
    assert_eq!(
        app.status_notice.as_ref().map(|(n, _)| n.as_str()),
        Some("Login: active waiting")
    );
    assert!(
        !app.display_messages()
            .iter()
            .any(|m| m.content.contains("CANCELLED-CODE"))
    );

    // Queued failure for the cancelled attempt must be ignored
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: format!("muse-subscription#{active_attempt}"),
        success: false,
        message: "Cancelled attempt failure".to_string(),
    });
    assert_eq!(
        app.status_notice.as_ref().map(|(n, _)| n.as_str()),
        Some("Login: active waiting")
    );
}

#[test]
fn muse_subscription_accumulating_backoff_increases_interval() {
    use super::auth_muse_helpers::{next_slow_down_interval, pending_attempt_matches};

    // Test attempt matching helper with and without prefix
    assert!(pending_attempt_matches("muse-subscription#abc", "abc"));
    assert!(pending_attempt_matches("abc", "muse-subscription#abc"));
    assert!(pending_attempt_matches(
        "muse-subscription#abc",
        "muse-subscription#abc"
    ));
    assert!(pending_attempt_matches("abc", "abc"));
    assert!(!pending_attempt_matches("abc", "def"));
    assert!(!pending_attempt_matches(
        "muse-subscription#abc",
        "muse-subscription#def"
    ));

    let initial_interval = 5u64;

    // First slow_down response with retry_after = 10
    let interval_1 = next_slow_down_interval(initial_interval, 10);
    assert_eq!(interval_1, 10);

    // Second consecutive slow_down: carrying forward interval_1 (10), next retry_after = 15
    let interval_2 = next_slow_down_interval(interval_1, 15);
    assert_eq!(interval_2, 15);

    // Third slow_down: server returns a non-increasing retry_after (e.g. 5)
    // RFC 8628 requires that each slow_down increases the interval by at least 5 seconds.
    let interval_3 = next_slow_down_interval(interval_2, 5);
    assert!(interval_3 >= 20);
    assert_eq!(interval_3, 20);

    // Fourth slow_down: server returns retry_after = 0
    let interval_4 = next_slow_down_interval(interval_3, 0);
    assert!(interval_4 >= 25);
    assert_eq!(interval_4, 25);
}

#[test]
fn muse_subscription_old_success_arriving_after_new_attempt_leaves_new_pending_intact()
-> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let prev_opt_in = std::env::var(crate::auth::muse::EXPERIMENTAL_ENV_VAR).ok();
        crate::env::set_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR, "1");
        struct RestoreOptIn(Option<String>);
        impl Drop for RestoreOptIn {
            fn drop(&mut self) {
                if let Some(val) = &self.0 {
                    crate::env::set_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR, val);
                } else {
                    crate::env::remove_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR);
                }
            }
        }
        let _restore = RestoreOptIn(prev_opt_in);

        let mut app = App::new_for_remote(None);
        let attempt_1 = "attempt_old_111";
        let cancelled_1 = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let approved_1 = std::sync::Arc::new(std::sync::Mutex::new(None));

        let mut bus_rx = crate::bus::Bus::global().subscribe();

        app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
            attempt: attempt_1.to_string(),
            cancelled: std::sync::Arc::clone(&cancelled_1),
            approved: std::sync::Arc::clone(&approved_1),
        });

        // Place approved credentials in the slot for attempt 1
        *approved_1.lock().unwrap() = Some(crate::auth::muse::MuseCredentials {
            api_key: "old_key_111".to_string(),
            access_token: "old_token_111".to_string(),
            base_url: crate::auth::muse::EXPECTED_API_BASE_URL.to_string(),
            user_email: Some("old_user@example.com".to_string()),
            user_full_name: Some("Old User".to_string()),
            is_subs_active: true,
            minted_at_ms: 1000,
            subs_usage: None,
        });

        // Process attempt 1 approval: saves credentials, clears attempt 1, publishes canonical event
        app.handle_login_completed(crate::bus::LoginCompleted {
            provider: format!("muse-subscription#{attempt_1}"),
            success: true,
            message: "Muse subscription approved in the browser; finalizing...".to_string(),
        });

        // Credentials must be saved
        assert!(crate::auth::muse::load_credentials().is_ok());

        // Canonical untagged event must be published for the daemon
        let mut canonical_event = None;
        while let Ok(event) = bus_rx.try_recv() {
            if let crate::bus::BusEvent::LoginCompleted(login) = event
                && login.provider == "muse-subscription"
            {
                canonical_event = Some(login);
                break;
            }
        }
        let canonical = canonical_event.expect("canonical untagged event must be published");
        assert!(canonical.success);
        assert_eq!(canonical.provider, "muse-subscription");

        // Now user starts a new attempt 2 while canonical event is queued
        let attempt_2 = "attempt_new_222";
        let cancelled_2 = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let approved_2 = std::sync::Arc::new(std::sync::Mutex::new(None));
        app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
            attempt: attempt_2.to_string(),
            cancelled: std::sync::Arc::clone(&cancelled_2),
            approved: std::sync::Arc::clone(&approved_2),
        });

        // Stale attempt-scoped approval from an old attempt arriving while attempt 2 is pending
        // must also be ignored and leave attempt 2 intact
        app.handle_login_completed(crate::bus::LoginCompleted {
            provider: "muse-subscription#attempt_stale_999".to_string(),
            success: true,
            message: "Stale attempt approval".to_string(),
        });
        match &app.pending_login {
            Some(super::auth_types::PendingLogin::MuseSubscription { attempt, .. }) => {
                assert_eq!(attempt, attempt_2);
            }
            _ => panic!("attempt 2 pending login must remain intact"),
        }

        // Canonical event from attempt 1 arrives and is handled
        app.handle_login_completed(canonical);

        // Attempt 2's pending login must remain intact
        match &app.pending_login {
            Some(super::auth_types::PendingLogin::MuseSubscription { attempt, .. }) => {
                assert_eq!(attempt, attempt_2);
            }
            _ => panic!("attempt 2 pending login must remain intact"),
        }

        Ok(())
    })
}

#[test]
fn muse_subscription_old_failure_does_not_clear_newer_pending_attempt() {
    let _env_guard = crate::storage::lock_test_env();
    let mut app = App::new_for_remote(None);

    let active_attempt = "attempt_active_333";
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let approved = std::sync::Arc::new(std::sync::Mutex::new(None));
    app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
        attempt: active_attempt.to_string(),
        cancelled,
        approved,
    });
    app.set_status_notice("Login: active waiting");

    // 1. Old attempt's attempt-scoped failure event arrives
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse-subscription#attempt_old_000".to_string(),
        success: false,
        message: "Old attempt failed".to_string(),
    });

    // Active attempt pending login must remain intact
    match &app.pending_login {
        Some(super::auth_types::PendingLogin::MuseSubscription { attempt, .. }) => {
            assert_eq!(attempt, active_attempt);
        }
        _ => panic!("active attempt pending login must remain intact"),
    }
    assert_eq!(
        app.status_notice.as_ref().map(|(n, _)| n.as_str()),
        Some("Login: active waiting")
    );

    // 2. An untagged failure event must also not clear the active attempt
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse-subscription".to_string(),
        success: false,
        message: "Generic failure".to_string(),
    });

    match &app.pending_login {
        Some(super::auth_types::PendingLogin::MuseSubscription { attempt, .. }) => {
            assert_eq!(attempt, active_attempt);
        }
        _ => panic!("active attempt pending login must remain intact"),
    }
}

/// An approval that lands while the user is still typing or pasting the device
/// code must not leave that text armed as the next model prompt. The generic
/// same-provider cleanup in `handle_login_completed` is skipped for Muse
/// because Muse pending state is attempt-owned, so the equivalent has to run
/// when the matching attempt finishes.
#[test]
fn muse_subscription_approval_clears_leftover_login_input_for_the_finished_attempt()
-> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let prev_opt_in = std::env::var(crate::auth::muse::EXPERIMENTAL_ENV_VAR).ok();
        crate::env::set_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR, "1");
        struct RestoreOptIn(Option<String>);
        impl Drop for RestoreOptIn {
            fn drop(&mut self) {
                if let Some(val) = &self.0 {
                    crate::env::set_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR, val);
                } else {
                    crate::env::remove_var(crate::auth::muse::EXPERIMENTAL_ENV_VAR);
                }
            }
        }
        let _restore = RestoreOptIn(prev_opt_in);

        let mut app = App::new_for_remote(None);
        let attempt = "attempt_input_clear_1";
        let approved = std::sync::Arc::new(std::sync::Mutex::new(Some(
            crate::auth::muse::MuseCredentials {
                api_key: "input_clear_key".to_string(),
                access_token: "input_clear_token".to_string(),
                base_url: crate::auth::muse::EXPECTED_API_BASE_URL.to_string(),
                user_email: None,
                user_full_name: None,
                is_subs_active: true,
                minted_at_ms: 1000,
                subs_usage: None,
            },
        )));
        app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
            attempt: attempt.to_string(),
            cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            approved,
        });
        // Text the user typed or pasted while the browser step was pending.
        app.input = "ABCD-1234".to_string();
        app.cursor_pos = app.input.len();
        app.pasted_contents = vec!["pasted device code blob".to_string()];

        app.handle_login_completed(crate::bus::LoginCompleted {
            provider: format!("muse-subscription#{attempt}"),
            success: true,
            message: "Muse subscription approved in the browser; finalizing...".to_string(),
        });

        assert!(
            app.input.is_empty(),
            "leftover login text must not stay armed, got {:?}",
            app.input
        );
        assert_eq!(app.cursor_pos, 0);
        assert!(
            app.pasted_contents.is_empty(),
            "pasted login contents must be released"
        );
        assert!(app.pending_login.is_none());
        Ok(())
    })
}

/// The complement of the test above: finishing an old attempt must not disturb
/// text the user is typing for a newer login.
#[test]
fn muse_subscription_old_attempt_event_does_not_clear_newer_login_input() {
    let _env_guard = crate::storage::lock_test_env();
    let mut app = App::new_for_remote(None);
    let newer_attempt = "attempt_newer_input_2";
    app.pending_login = Some(super::auth_types::PendingLogin::MuseSubscription {
        attempt: newer_attempt.to_string(),
        cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        approved: std::sync::Arc::new(std::sync::Mutex::new(None)),
    });
    app.input = "code for the new attempt".to_string();
    app.cursor_pos = app.input.len();
    app.pasted_contents = vec!["new attempt paste".to_string()];

    // Canonical (untagged) success from the previous attempt.
    app.handle_login_completed(crate::bus::LoginCompleted {
        provider: "muse-subscription".to_string(),
        success: true,
        message: "previous attempt finished".to_string(),
    });

    assert_eq!(app.input, "code for the new attempt");
    assert_eq!(app.pasted_contents.len(), 1);
    match &app.pending_login {
        Some(super::auth_types::PendingLogin::MuseSubscription { attempt, .. }) => {
            assert_eq!(attempt, newer_attempt);
        }
        _ => panic!("newer attempt's pending login must remain intact"),
    }
}

struct GateEnvGuard(Vec<(&'static str, Option<std::ffi::OsString>)>);
impl GateEnvGuard {
    fn set(pairs: &[(&'static str, Option<&str>)]) -> Self {
        let saved = pairs
            .iter()
            .map(|(k, _)| (*k, std::env::var_os(k)))
            .collect();
        for (k, v) in pairs {
            match v {
                Some(val) => crate::env::set_var(k, val),
                None => crate::env::remove_var(k),
            }
        }
        Self(saved)
    }
}
impl Drop for GateEnvGuard {
    fn drop(&mut self) {
        for (k, v) in self.0.drain(..) {
            match v {
                Some(val) => crate::env::set_var(k, val),
                None => crate::env::remove_var(k),
            }
        }
    }
}

#[test]
fn rayu_auth_gate_forces_rayu_onboarding_and_blocks_esc_3p_and_turns() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let _rayu_dir = RayuConfigDirGuard::new();
        let _gate = super::onboarding_flow::ScopedTuiRayuAuthGate::enable();
        let _vars = GateEnvGuard::set(&[
            ("RAYU_API_KEY", None),
            ("OPENAI_API_KEY", Some("sk-openai-ambient-3p")),
            ("ANTHROPIC_API_KEY", Some("sk-ant-ambient-3p")),
        ]);
        crate::auth::AuthStatus::invalidate_cache();
        assert!(super::onboarding_flow::rayu_auth_gate_active_in_tui());

        let mut app = crate::tui::app::tests::create_test_app();
        // 3P keys in env must NOT bypass Rayu first-run onboarding.
        assert!(app.onboarding_tick());
        assert!(app.onboarding_flow_active());
        assert!(matches!(
            app.onboarding_phase(),
            Some(super::onboarding_flow::OnboardingPhase::LoginOpenAi {
                yes_highlighted: true
            })
        ));
        assert!(matches!(
            app.onboarding_welcome_kind(),
            crate::tui::OnboardingWelcomeKind::LoginOpenAi {
                yes_highlighted: true
            }
        ));

        // Esc and 'n' must not escape first-run Rayu gate.
        use crossterm::event::KeyCode;
        assert!(app.handle_onboarding_continue_prompt_key(KeyCode::Esc));
        assert!(app.onboarding_flow_active());
        assert!(app.handle_onboarding_continue_prompt_key(KeyCode::Char('n')));
        assert!(app.onboarding_flow_active());

        // Attempting 3P login (including `/account add claude|openai`) is blocked before Rayu Auth.
        app.start_login_provider(crate::provider_catalog::OPENAI_LOGIN_PROVIDER);
        assert!(app.pending_login.is_none());
        assert!(
            app.display_messages
                .last()
                .is_some_and(|m| m.role == "error" && m.content.contains("Rayu"))
        );
        super::execute_account_command_local(
            &mut app,
            super::AccountCommand::Add {
                provider_id: "claude".to_string(),
                label: None,
            },
        );
        assert!(app.pending_login.is_none());
        super::execute_account_command_local(
            &mut app,
            super::AccountCommand::Add {
                provider_id: "openai".to_string(),
                label: Some("work".to_string()),
            },
        );
        assert!(app.pending_login.is_none());

        // Returning users (`launch_count > 5`) without Rayu credentials still enter Rayu onboarding.
        let mut hints = crate::setup_hints::SetupHintsState::load();
        hints.launch_count = 42;
        hints.onboarding_start_choice_shown = true;
        let _ = hints.save();
        let mut returning_app = crate::tui::app::tests::create_test_app();
        assert!(returning_app.onboarding_tick());
        assert!(returning_app.onboarding_flow_active());

        // Local and remote turn submissions are blocked while slash commands stay functional.
        app.input = "hello before rayu auth".to_string();
        app.submit_input();
        assert!(app.display_messages.last().is_some_and(
            |m| m.role == "error" && m.content.contains("Rayu authentication required")
        ));
        assert!(
            !app.display_messages
                .iter()
                .any(|m| m.role == "user" && m.content == "hello before rayu auth")
        );
        let rt_remote = tokio::runtime::Runtime::new()?;
        let remote_send_res = rt_remote.block_on(async {
            let mut dummy_remote = crate::tui::backend::RemoteConnection::dummy();
            crate::tui::app::remote::begin_remote_send(
                &mut app,
                &mut dummy_remote,
                "remote turn before rayu auth".to_string(),
                vec![],
                false,
                None,
                false,
                0,
            )
            .await
        });
        assert!(remote_send_res.is_err());
        assert!(!app.is_processing);
        let blocked_msg_count = app.display_messages.len();
        app.input = "/help".to_string();
        app.submit_input();
        assert_eq!(app.display_messages.len(), blocked_msg_count);

        // Option 2 opens Rayu API key entry and rejects malformed prefix without saving.
        assert!(app.handle_onboarding_continue_prompt_key(KeyCode::Char('2')));
        assert!(matches!(
            &app.pending_login,
            Some(super::auth_types::PendingLogin::ApiKeyProfile {
                provider_id,
                key_name,
                ..
            }) if provider_id == "rayu" && key_name == "RAYU_API_KEY"
        ));
        let pending = app.pending_login.take().unwrap();
        app.handle_login_input(pending, "not-a-rayu-key".to_string());
        assert!(crate::rayu::configured_api_key().is_none());
        assert!(app.pending_login.is_some());

        // Saving a valid Rayu key unlocks turns, 3P login, and onboarding completion.
        crate::rayu::save_api_key("rayu_sk_live_unlocked_test")?;
        assert!(!super::onboarding_flow::rayu_auth_gate_active_in_tui());
        app.pending_login = None;
        app.onboarding_after_login();
        assert!(!matches!(
            app.onboarding_phase(),
            Some(super::onboarding_flow::OnboardingPhase::LoginOpenAi { .. })
        ));
        assert!(!app.block_turn_until_rayu_auth());

        // Gateway 401 verdict triggers relaunch recovery copy and allows Esc dismissal.
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        let base = format!("http://{}", listener.local_addr()?);
        let server = std::thread::spawn(move || {
            use std::io::{Read, Write};
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = write!(
                    stream,
                    "HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
                );
            }
        });
        let _gw = GateEnvGuard::set(&[("RAYU_GATEWAY_URL", Some(&base))]);
        let rt = tokio::runtime::Runtime::new()?;
        assert_eq!(
            rt.block_on(crate::rayu::validate_api_key("rayu_sk_live_unlocked_test")),
            crate::rayu::ApiKeyVerdict::Invalid
        );
        let _ = server.join();
        assert_eq!(
            crate::rayu::relaunch_api_key_issue(),
            Some(crate::rayu::ApiKeyVerdict::Invalid)
        );
        assert!(app.handle_rayu_gate_login_failed(Some("Saved Rayu key invalid")));
        assert!(app.onboarding_flow_active());
        assert!(app.handle_onboarding_continue_prompt_key(KeyCode::Esc));
        assert!(!app.onboarding_flow_active());
        Ok(())
    })
}

#[test]
fn enable_other_provider_false_hides_third_party_providers_across_tui() -> anyhow::Result<()> {
    with_temp_rayu_home(|| {
        let _rayu_dir = RayuConfigDirGuard::new();
        let _rayu_only = crate::rayu::scoped_other_providers_enabled_for_tests(false);
        crate::rayu::save_api_key("rayu_sk_live_tui_rayu_only_test")?;
        crate::auth::AuthStatus::invalidate_cache();

        let mut app = crate::tui::app::tests::create_test_app();

        // /login inline picker shows ONLY Rayu Account (OAuth) + Rayu API Key.
        app.open_login_picker_inline();
        let login_picker = app
            .inline_interactive_state
            .as_ref()
            .expect("login picker should open");
        assert_eq!(login_picker.entries.len(), 2);
        assert!(matches!(
            login_picker.entries[0].action,
            crate::tui::PickerAction::Login(provider) if provider.id == "rayu"
        ));
        assert!(matches!(
            login_picker.entries[1].action,
            crate::tui::PickerAction::LoginRayuApiKey
        ));

        // /logout inline picker shows ONLY Rayu (no "All providers" or 3P providers).
        app.open_logout_picker_inline();
        let logout_picker = app
            .inline_interactive_state
            .as_ref()
            .expect("logout picker should open");
        assert_eq!(logout_picker.entries.len(), 1);
        assert!(matches!(
            logout_picker.entries[0].action,
            crate::tui::PickerAction::Logout(provider) if provider.id == "rayu"
        ));

        // /login openai is blocked with ENABLE_OTHER_PROVIDER=false message.
        app.input = "/login openai".to_string();
        app.submit_input();
        assert!(
            app.display_messages
                .last()
                .is_some_and(|m| m.role == "error" && m.content.contains("ENABLE_OTHER_PROVIDER=false"))
        );

        // /login rayu-api opens Rayu API key entry directly.
        app.input = "/login rayu-api".to_string();
        app.submit_input();
        assert!(matches!(
            &app.pending_login,
            Some(super::auth_types::PendingLogin::ApiKeyProfile {
                provider_id,
                key_name,
                ..
            }) if provider_id == "rayu" && key_name == "RAYU_API_KEY"
        ));
        app.pending_login = None;

        // /account inline picker shows ONLY Rayu actions (zero Claude/OpenAI rows).
        app.open_account_picker(None);
        let account_picker = app
            .inline_interactive_state
            .as_ref()
            .expect("account picker should open");
        assert!(!account_picker.entries.is_empty());
        for entry in &account_picker.entries {
            let lower = entry.name.to_ascii_lowercase();
            assert!(
                !lower.contains("claude") && !lower.contains("openai"),
                "unexpected 3P entry in /account picker: {}",
                entry.name
            );
        }

        // Slash suggestions for /login and /account contain ONLY Rayu items, and /reset is hidden.
        app.set_input_for_test("/login ");
        let login_suggestions = app.command_suggestions();
        assert!(login_suggestions.iter().any(|(cmd, _)| cmd == "/login rayu"));
        assert!(
            login_suggestions
                .iter()
                .any(|(cmd, _)| cmd == "/login rayu-api")
        );
        assert!(
            !login_suggestions
                .iter()
                .any(|(cmd, _)| cmd.contains("openai") || cmd.contains("claude"))
        );

        app.set_input_for_test("/account ");
        let account_suggestions = app.command_suggestions();
        assert!(
            account_suggestions
                .iter()
                .any(|(cmd, _)| cmd == "/account rayu status")
        );
        assert!(
            account_suggestions
                .iter()
                .any(|(cmd, _)| cmd == "/account rayu api-key")
        );
        assert!(
            !account_suggestions
                .iter()
                .any(|(cmd, _)| cmd.contains("openai") || cmd.contains("claude"))
        );

        assert!(
            !super::state_ui_input_helpers::registered_command_entries()
                .any(|(name, _)| name == "/reset")
        );

        // /reset command itself is rejected in Rayu-only mode.
        app.input = "/reset".to_string();
        app.submit_input();
        assert!(
            app.display_messages
                .last()
                .is_some_and(|m| m.role == "error" && m.content.contains("ENABLE_OTHER_PROVIDER=false"))
        );

        Ok(())
    })
}
