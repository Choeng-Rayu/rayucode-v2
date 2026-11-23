use super::*;

fn session_user() -> crate::rayu::RayuSessionUser {
    crate::rayu::RayuSessionUser {
        id: 42,
        email: Some("user@example.com".to_string()),
        display_name: Some("Rayu User".to_string()),
        avatar_url: None,
        role: "user".to_string(),
    }
}

fn session() -> crate::rayu::RayuSession {
    crate::rayu::RayuSession {
        access_token: "access".to_string(),
        refresh_token: "refresh".to_string(),
        expires_at: 4_102_444_800_000,
        user: session_user(),
    }
}

#[test]
fn identity_prefers_session_name_and_email() {
    let line = rayu_identity_line(Some(&session()), true);
    assert!(line.contains("Rayu User"));
    assert!(line.contains("user@example.com"));
    assert!(!line.contains("RAYU_API_KEY"));
}

#[test]
fn identity_falls_back_to_email_then_user_id() {
    let mut without_name = session();
    without_name.user.display_name = None;
    assert!(rayu_identity_line(Some(&without_name), false).contains("user@example.com"));
    without_name.user.email = None;
    assert!(rayu_identity_line(Some(&without_name), false).contains("user 42"));
}

#[test]
fn identity_reports_api_key_then_missing_credentials() {
    assert!(rayu_identity_line(None, true).contains("RAYU_API_KEY"));
    let missing = rayu_identity_line(None, false);
    assert!(missing.contains("not configured"));
    assert!(missing.contains("/login rayu"));
}

#[test]
fn credits_lines_report_plan_usage_and_remaining_without_billing_copy() {
    let credits = crate::rayu::RayuCredits {
        plan: "pro".to_string(),
        plan_name: "Pro".to_string(),
        credits_per_period: Some(100.0),
        used_credits: 12.5,
        remaining_credits: Some(87.5),
        reset_seconds: 90_000,
        period_end: None,
        topup_balance: 5.0,
        top_up_enabled: true,
        limit_mode: Some("soft".to_string()),
        api_key: None,
        ..Default::default()
    };
    let lines = rayu_credits_status_lines(&credits);
    let joined = lines.join("\n");
    assert!(joined.contains("Plan: Pro"));
    assert!(joined.contains("12.50 of 100.00 used"));
    assert!(joined.contains("Remaining: 87.50 credits"));
    assert!(joined.contains("Top-up balance: 5.00 credits"));
    assert!(joined.contains("Resets in: 1d 1h"));
    assert!(joined.contains("Limit mode: soft"));
    assert!(!joined.to_ascii_lowercase().contains("billing"));
    assert!(!joined.to_ascii_lowercase().contains("subscription"));
    assert!(!joined.contains('$'));
}

#[test]
fn credits_lines_render_api_key_limits() {
    let credits = crate::rayu::RayuCredits {
        plan: "payg".to_string(),
        plan_name: String::new(),
        api_key: Some(crate::rayu::RayuApiKeyLimits {
            key_id: 7,
            credit_limit: Some(50.0),
            allowed_models: vec!["glm-4.6".to_string(), "kimi-k2".to_string()],
            rate_limit_rpm: Some(60),
        }),
        ..Default::default()
    };
    let joined = rayu_credits_status_lines(&credits).join("\n");
    assert!(joined.contains("Plan: payg"));
    assert!(joined.contains("API key limit: 50.00 credits per period"));
    assert!(joined.contains("glm-4.6, kimi-k2"));
    assert!(joined.contains("60 requests/min"));
}

#[test]
fn credits_lines_handle_uncapped_key_and_zero_reset() {
    let credits = crate::rayu::RayuCredits {
        reset_seconds: 0,
        period_end: Some("2026-12-01".to_string()),
        api_key: Some(crate::rayu::RayuApiKeyLimits {
            key_id: 1,
            credit_limit: None,
            allowed_models: Vec::new(),
            rate_limit_rpm: None,
        }),
        ..Default::default()
    };
    let joined = rayu_credits_status_lines(&credits).join("\n");
    assert!(joined.contains("API key limit: uncapped"));
    assert!(joined.contains("Period ends: 2026-12-01"));
    assert!(!joined.contains("Resets in"));
}

#[test]
fn credits_lines_render_team_pacing_windows_and_daily_turns() {
    let credits = crate::rayu::RayuCredits {
        plan: "team".to_string(),
        plan_name: "Team".to_string(),
        credits_per_period: Some(1000.0),
        used_credits: 200.0,
        remaining_credits: Some(800.0),
        max_daily_turns: Some(100),
        turns_used_today: 25,
        turns_reset_seconds: 7_200,
        credits_per_5h: Some(100.0),
        window_used_credits: 40.0,
        window_reset_seconds: 3_600,
        credits_per_week: Some(300.0),
        week_used_credits: 120.0,
        week_reset_seconds: 172_800,
        limit_mode: Some("gated".to_string()),
        scope: Some("team".to_string()),
        team: Some(crate::rayu::RayuTeamCredits {
            organization_id: 9,
            role: "member".to_string(),
            pool_credits: 1000.0,
            pool_used_credits: 200.0,
            bucket_quota: 250.0,
            bucket_remaining: 190.0,
            purchased_credits: 500.0,
            purchased_remaining: 450.0,
        }),
        ..Default::default()
    };
    let joined = rayu_credits_status_lines(&credits).join("\n");
    assert!(joined.contains("Scope: team (member)"), "{joined}");
    assert!(
        joined.contains("Team seat remaining: 190.00 of 250.00 credits"),
        "{joined}"
    );
    assert!(
        joined.contains("Team extra credits: 450.00 remaining"),
        "{joined}"
    );
    assert!(joined.contains("Session window: 40.00 / 100.00 used"), "{joined}");
    assert!(joined.contains("Weekly window: 120.00 / 300.00 used"), "{joined}");
    assert!(joined.contains("Daily turns: 25 / 100 used"), "{joined}");
    assert!(!joined.to_ascii_lowercase().contains("billing"));
}
