#[test]
fn test_fast_default_on_saves_config_and_updates_session() {
    let _guard = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().expect("tempdir");
    let prev_home = std::env::var_os("RAYU_HOME");
    crate::env::set_var("RAYU_HOME", temp.path());

    let mut app = create_fast_test_app();
    app.input = "/fast default on".to_string();

    app.submit_input();

    let cfg = crate::config::Config::load();
    assert_eq!(
        cfg.provider.openai_service_tier.as_deref(),
        Some("priority")
    );
    assert_eq!(app.provider.service_tier().as_deref(), Some("priority"));
    assert_eq!(app.status_notice(), Some("Fast mode: on".to_string()));
    let last = app.display_messages().last().expect("missing response");
    assert_eq!(last.content, "Saved OpenAI fast mode: on.");

    if let Some(prev_home) = prev_home {
        crate::env::set_var("RAYU_HOME", prev_home);
    } else {
        crate::env::remove_var("RAYU_HOME");
    }
}

#[test]
fn test_fast_default_off_persists_explicit_off() {
    let _guard = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().expect("tempdir");
    let prev_home = std::env::var_os("RAYU_HOME");
    crate::env::set_var("RAYU_HOME", temp.path());
    crate::config::Config::set_openai_service_tier(Some("priority")).expect("save fast default");

    let mut app = create_fast_test_app();
    app.input = "/fast default off".to_string();

    app.submit_input();

    // Issue #506: "off" must persist as an explicit value; clearing the key
    // made the save invisible in config.toml.
    let cfg = crate::config::Config::load();
    assert_eq!(cfg.provider.openai_service_tier.as_deref(), Some("off"));
    assert_eq!(app.status_notice(), Some("Fast mode: off".to_string()));
    let last = app.display_messages().last().expect("missing response");
    assert_eq!(last.content, "Saved OpenAI fast mode: off.");

    if let Some(prev_home) = prev_home {
        crate::env::set_var("RAYU_HOME", prev_home);
    } else {
        crate::env::remove_var("RAYU_HOME");
    }
}

#[test]
fn test_fast_status_shows_saved_default() {
    let _guard = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().expect("tempdir");
    let prev_home = std::env::var_os("RAYU_HOME");
    crate::env::set_var("RAYU_HOME", temp.path());
    crate::config::Config::set_openai_service_tier(Some("priority")).expect("save fast default");

    let mut app = create_fast_test_app();
    app.input = "/fast status".to_string();

    app.submit_input();

    let last = app.display_messages().last().expect("missing response");
    assert_eq!(
        last.content,
        "Fast mode is off.\nCurrent tier: Standard\nSaved default: on (Fast)\nUse /fast on, /fast off, or /fast default on|off."
    );

    if let Some(prev_home) = prev_home {
        crate::env::set_var("RAYU_HOME", prev_home);
    } else {
        crate::env::remove_var("RAYU_HOME");
    }
}

#[test]
fn test_alignment_command_persists_and_applies_immediately() {
    with_temp_rayu_home(|| {
        let mut app = create_test_app();
        app.set_centered(false);
        app.input = "/alignment centered".to_string();

        app.submit_input();

        let cfg = crate::config::Config::load();
        assert!(cfg.display.centered);
        assert!(app.centered_mode());
        assert_eq!(app.status_notice(), Some("Layout: Centered".to_string()));

        let last = app.display_messages().last().expect("missing response");
        assert_eq!(last.role, "system");
        assert!(
            last.content
                .contains("Saved default alignment: centered")
        );
    });
}

#[test]
fn test_alignment_status_shows_current_and_saved_defaults() {
    with_temp_rayu_home(|| {
        crate::config::Config::set_display_centered(false).expect("save alignment default");

        let mut app = create_test_app();
        app.set_centered(true);
        app.input = "/alignment".to_string();

        app.submit_input();

        let last = app.display_messages().last().expect("missing response");
        assert_eq!(last.role, "system");
        assert!(
            last.content
                .contains("Alignment is currently centered.")
        );
        assert!(last.content.contains("Saved default: left-aligned."));
        assert!(last.content.contains("/alignment centered"));
        // The keycap hint is platform-dependent: the message renders the
        // platform chord via alt_chord (Option symbol on macOS, Alt elsewhere),
        // so assert exactly that instead of a hardcoded "Alt+C" that fails on
        // macOS builds while passing on the upstream Linux CI.
        assert!(last
            .content
            .contains(&rayucode_tui_core::keybind::alt_chord("C")));
    });
}

#[test]
fn test_alignment_invalid_usage_shows_error() {
    let mut app = create_test_app();
    app.input = "/alignment diagonal".to_string();

    app.submit_input();

    let last = app.display_messages().last().expect("missing response");
    assert_eq!(last.role, "error");
    assert!(last.content.contains("Usage: /alignment"));
}

#[test]
fn test_compact_notifications_command_persists_and_applies_immediately() {
    with_temp_rayu_home(|| {
        crate::config::Config::set_compact_notifications(false).expect("save default");

        let mut app = create_test_app();
        app.input = "/compact-notifications on".to_string();

        app.submit_input();

        let cfg = crate::config::Config::load();
        assert!(cfg.display.compact_notifications);
        assert_eq!(
            app.status_notice(),
            Some("Compact notifications: on".to_string())
        );

        let last = app.display_messages().last().expect("missing response");
        assert_eq!(last.role, "system");
        assert!(last.content.contains("Saved compact notifications: on"));
    });
}

#[test]
fn test_compact_notifications_status_reports_current_value() {
    with_temp_rayu_home(|| {
        crate::config::Config::set_compact_notifications(true).expect("save default");

        let mut app = create_test_app();
        app.input = "/compact-notifications".to_string();

        app.submit_input();

        let last = app.display_messages().last().expect("missing response");
        assert_eq!(last.role, "system");
        assert!(
            last.content
                .contains("Compact notifications are currently on.")
        );
    });
}

#[test]
fn test_compact_notifications_invalid_usage_shows_error() {
    let mut app = create_test_app();
    app.input = "/compact-notifications maybe".to_string();

    app.submit_input();

    let last = app.display_messages().last().expect("missing response");
    assert_eq!(last.role, "error");
    assert!(last.content.contains("Usage: /compact-notifications"));
}

#[test]
fn test_help_topic_shows_fix_command_details() {
    let mut app = create_test_app();
    app.input = "/help fix".to_string();
    app.submit_input();

    let msg = app
        .display_messages()
        .last()
        .expect("missing help response");
    assert_eq!(msg.role, "system");
    assert!(msg.content.contains("/fix"));
}

#[test]
fn test_mask_email_censors_local_part() {
    assert_eq!(mask_email("jeremyh1@uw.edu"), "j***1@uw.edu");
}

#[test]
fn test_account_rayu_status_shows_scaffold_without_credentials() {
    let _guard = crate::storage::lock_test_env();
    let temp = tempfile::tempdir().expect("tempdir");
    let prev_rayu_dir = std::env::var_os("RAYU_AUTH_CONFIG_DIR");
    let prev_rayu_key = std::env::var_os("RAYU_API_KEY");
    crate::env::set_var("RAYU_AUTH_CONFIG_DIR", temp.path());
    crate::env::remove_var("RAYU_API_KEY");

    let mut app = create_test_app();
    app.input = "/account rayu status".to_string();
    app.submit_input();

    let msg = app
        .display_messages()
        .last()
        .expect("missing /account rayu status response");
    assert_eq!(msg.role, "system");
    assert!(msg.content.contains("Rayu Account Status"));
    assert!(msg.content.contains("not configured (/login rayu)"));
    assert!(msg.content.contains("Gateway:"));
    assert!(msg.content.contains("Catalog:"));
    assert!(!msg.content.contains("monthly spending limit"));
    assert!(!msg.content.contains("subscription fee"));

    match prev_rayu_dir {
        Some(value) => crate::env::set_var("RAYU_AUTH_CONFIG_DIR", value),
        None => crate::env::remove_var("RAYU_AUTH_CONFIG_DIR"),
    }
    match prev_rayu_key {
        Some(value) => crate::env::set_var("RAYU_API_KEY", value),
        None => crate::env::remove_var("RAYU_API_KEY"),
    }
}

#[test]
fn test_account_rayu_manage_prints_dashboard_url() {
    let _guard = crate::storage::lock_test_env();
    let mut app = create_test_app();
    app.input = "/account rayu manage".to_string();
    app.submit_input();

    let msg = app
        .display_messages()
        .last()
        .expect("missing /account rayu manage response");
    assert_eq!(msg.role, "system");
    assert!(msg.content.contains("Rayu Account Management"));
    assert!(msg.content.contains(&crate::rayu::account_url()));
}

#[test]
fn test_usage_report_shows_no_connected_providers_when_results_empty() {
    let mut app = create_test_app();
    app.handle_usage_report(Vec::new());

    let msg = app.display_messages().last().expect("missing usage card");
    assert_eq!(msg.role, "usage");
    assert!(msg.content.starts_with("*none\tnot connected"));
    assert!(msg.content.contains("No providers are connected yet"));
    assert!(msg.content.contains("/login claude"));
    assert!(msg.content.contains("/login openai"));
}

#[test]
fn test_usage_provider_command_shows_only_that_provider() {
    let mut app = create_test_app();
    assert!(super::commands::handle_usage_command(&mut app, "/usage claude"));
    let report = |name: &str| crate::usage::ProviderUsage {
        provider_name: name.to_string(),
        ..Default::default()
    };
    app.handle_usage_report(vec![report("Anthropic (Claude)"), report("OpenAI (ChatGPT)")]);
    let cards: Vec<_> = app
        .display_messages()
        .iter()
        .filter(|m| m.role == "usage")
        .collect();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].title.as_deref(), Some("Anthropic (Claude)"));

    assert!(super::commands::handle_usage_command(&mut app, "/usage nope"));
    app.handle_usage_report(vec![report("Anthropic (Claude)")]);
    let msg = app.display_messages().last().unwrap();
    assert_eq!(msg.title.as_deref(), Some("Usage · nope"));
    assert!(msg.content.contains("No connected provider matches \"nope\""));

    // Plain /usage shows one card per provider, refreshed in place.
    assert!(super::commands::handle_usage_command(&mut app, "/usage"));
    for _ in 0..2 {
        app.handle_usage_report(vec![report("Anthropic (Claude)"), report("OpenAI (ChatGPT)")]);
    }
    let titles: Vec<_> = app
        .display_messages()
        .iter()
        .rev()
        .take_while(|m| m.role == "usage")
        .filter_map(|m| m.title.clone())
        .collect();
    assert_eq!(titles, ["OpenAI (ChatGPT)", "Anthropic (Claude)"]);
}

#[test]
fn test_usage_command_requests_usage_report_with_inline_view() {
    let mut app = create_test_app();

    assert!(super::commands::handle_usage_command(&mut app, "/usage"));

    assert!(app.inline_interactive_state.is_none());
    assert!(app.usage_overlay.is_none());
    assert!(app.inline_view_state.is_none());
    assert_eq!(
        app.display_messages().last().map(|m| m.role.as_str()),
        Some("usage")
    );
    assert!(app.usage_report_refreshing);
}

#[test]
fn test_usage_submit_input_requests_usage_report_with_inline_view() {
    let mut app = create_test_app();
    app.input = "/usage".to_string();

    app.submit_input();

    assert!(app.inline_interactive_state.is_none());
    assert!(app.usage_overlay.is_none());
    assert!(app.inline_view_state.is_none());
    assert_eq!(
        app.display_messages().last().map(|m| m.role.as_str()),
        Some("usage")
    );
    assert!(app.usage_report_refreshing);
}

#[test]
fn test_usage_typing_does_not_open_picker_preview() {
    let mut app = create_test_app();

    for c in "/usage".chars() {
        app.handle_key(KeyCode::Char(c), KeyModifiers::empty())
            .expect("type /usage");
    }

    assert!(app.inline_interactive_state.is_none());
    assert_eq!(app.input(), "/usage");
    assert!(!app.usage_report_refreshing);
}

#[test]
fn test_usage_enter_requests_report_with_inline_view() {
    let mut app = create_test_app();

    for c in "/usage".chars() {
        app.handle_key(KeyCode::Char(c), KeyModifiers::empty())
            .expect("type /usage");
    }

    app.handle_key(KeyCode::Enter, KeyModifiers::empty())
        .expect("submit /usage");

    assert!(app.inline_interactive_state.is_none());
    assert!(app.usage_overlay.is_none());
    assert!(app.inline_view_state.is_none());
    assert_eq!(app.input(), "");
    assert_eq!(
        app.display_messages().last().map(|m| m.role.as_str()),
        Some("usage")
    );
    assert!(app.usage_report_refreshing);
}
