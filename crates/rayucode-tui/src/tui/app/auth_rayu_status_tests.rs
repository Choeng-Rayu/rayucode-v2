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
