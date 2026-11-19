use super::*;

impl App {
    /// `/account rayu status`: local credential snapshot plus a live credits
    /// card fetched from the gateway in the background. No tier or billing
    /// copy — Rayu accounts are plan + credits.
    pub(in crate::tui::app) fn show_rayu_status(&mut self) {
        let session = crate::rayu::read_session();
        let has_api_key = crate::rayu::has_api_key();

        let mut message = String::from("Rayu Account Status\n\n");
        message.push_str(&format!(
            "  - {}\n",
            rayu_identity_line(session.as_ref(), has_api_key)
        ));
        message.push_str(&format!("  - Gateway: {}\n", crate::rayu::gateway_base()));
        message.push_str(&format!("  - Account: {}\n", crate::rayu::account_url()));

        // The picker's Rayu rows come from the runtime's live catalog cache;
        // counting them reports what this client can actually route to.
        let catalog_count = self
            .provider
            .model_routes()
            .iter()
            .filter(|route| {
                route
                    .api_method
                    .eq_ignore_ascii_case(crate::rayu::RAYU_ROUTE_API_METHOD)
            })
            .count();
        message.push_str(&format!(
            "  - Catalog: {} hosted model(s) in the live catalog\n",
            catalog_count
        ));

        if session.is_some() || has_api_key {
            message.push_str("\nFetching live credits...");
        } else {
            message.push_str("\nLog in with /login rayu to connect Rayu hosted models.");
        }

        self.push_display_message(DisplayMessage::system(message));

        if session.is_none() && !has_api_key {
            return;
        }
        let session_id = self.session.id.clone();
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            return;
        };
        handle.spawn(async move {
            let publish = |message: String, status: &'static str| {
                crate::bus::Bus::global().publish(crate::bus::BusEvent::UiActivity(
                    crate::bus::UiActivity::background(Some(session_id.clone()), message, Some(status)),
                ));
            };
            let Some(credential) = crate::rayu::gateway_credential().await else {
                publish(
                    "Rayu Account Status\n\nNo usable credential. Use /login rayu to sign in."
                        .to_string(),
                    "Rayu account status unavailable",
                );
                return;
            };
            match crate::rayu::fetch_credits(&credential).await {
                Ok(credits) => {
                    let mut body = String::from("Rayu Credits\n\n");
                    for line in rayu_credits_status_lines(&credits) {
                        body.push_str(&format!("  - {line}\n"));
                    }
                    publish(body, "Rayu credits loaded");
                }
                Err(error) => publish(
                    format!(
                        "Rayu Account Status\n\nCould not load live credits: {error}\n\nThe local credential was retained. Retry /account rayu status, open /account rayu manage, or use /account rayu logout."
                    ),
                    "Rayu account status unavailable",
                ),
            }
        });
    }
}

/// One-line identity for the status header: the signed-in user when a session
/// exists, otherwise the configured API key, otherwise a login hint.
pub(super) fn rayu_identity_line(
    session: Option<&crate::rayu::RayuSession>,
    has_api_key: bool,
) -> String {
    if let Some(session) = session {
        let user = &session.user;
        let name = user
            .display_name
            .as_deref()
            .filter(|name| !name.trim().is_empty());
        let email = user
            .email
            .as_deref()
            .filter(|email| !email.trim().is_empty());
        return match (name, email) {
            (Some(name), Some(email)) => format!("Signed in: {name} <{email}>"),
            (Some(name), None) => format!("Signed in: {name}"),
            (None, Some(email)) => format!("Signed in: {email}"),
            (None, None) => format!("Signed in: user {}", user.id),
        };
    }
    if has_api_key {
        return format!("Credential: {} API key", crate::rayu::RAYU_API_KEY_ENV);
    }
    "Credentials: not configured (/login rayu)".to_string()
}

/// Pure render of the gateway credits payload so the wording is unit-testable
/// without a network or an App.
pub(super) fn rayu_credits_status_lines(credits: &crate::rayu::RayuCredits) -> Vec<String> {
    let mut lines = Vec::new();
    let plan = if credits.plan_name.trim().is_empty() {
        credits.plan.as_str()
    } else {
        credits.plan_name.as_str()
    };
    lines.push(format!("Plan: {plan}"));
    match (credits.used_credits, credits.credits_per_period) {
        (used, Some(per_period)) => {
            lines.push(format!(
                "Credits: {used:.2} of {per_period:.2} used this period"
            ));
        }
        (used, None) => lines.push(format!("Credits used this period: {used:.2}")),
    }
    if let Some(remaining) = credits.remaining_credits {
        lines.push(format!("Remaining: {remaining:.2} credits"));
    }
    if credits.topup_balance > 0.0 {
        lines.push(format!(
            "Top-up balance: {:.2} credits",
            credits.topup_balance
        ));
    }
    if credits.reset_seconds > 0 {
        lines.push(format!(
            "Resets in: {}",
            format_reset_countdown(credits.reset_seconds)
        ));
    } else if let Some(end) = credits.period_end.as_deref() {
        lines.push(format!("Period ends: {end}"));
    }
    if let Some(mode) = credits
        .limit_mode
        .as_deref()
        .filter(|mode| !mode.is_empty())
    {
        lines.push(format!("Limit mode: {mode}"));
    }
    if let Some(key) = &credits.api_key {
        match key.credit_limit {
            Some(limit) => lines.push(format!("API key limit: {limit:.2} credits per period")),
            None => lines.push("API key limit: uncapped".to_string()),
        }
        if !key.allowed_models.is_empty() {
            lines.push(format!("API key models: {}", key.allowed_models.join(", ")));
        }
        if let Some(rpm) = key.rate_limit_rpm.filter(|rpm| *rpm > 0) {
            lines.push(format!("API key rate limit: {rpm} requests/min"));
        }
    }
    lines
}

fn format_reset_countdown(seconds: i64) -> String {
    let days = seconds / 86_400;
    let hours = (seconds % 86_400) / 3_600;
    let minutes = (seconds % 3_600) / 60;
    if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

#[cfg(test)]
#[path = "auth_rayu_status_tests.rs"]
mod tests;
