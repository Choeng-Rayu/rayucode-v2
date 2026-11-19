use anyhow::{Context, Result};

use crate::rayu;

pub(crate) async fn run_login(
    no_browser: bool,
    print_auth_url: bool,
    callback_url: Option<String>,
) -> Result<()> {
    super::login::run_rayu_login(no_browser, print_auth_url, callback_url).await
}

pub(crate) async fn run_status(json: bool) -> Result<()> {
    let has_session = rayu::has_usable_session();
    let has_api_key = rayu::has_api_key();
    if !has_session && !has_api_key {
        anyhow::bail!(
            "No Rayu credential is configured. Run `rayu account login` to sign in, or set RAYU_API_KEY."
        );
    }

    // The account profile needs the session JWT; an API key alone still gets
    // live credit status from the gateway.
    let me = if has_session {
        Some(rayu::fetch_me().await.context(
            "Could not fetch the Rayu account profile. Run `rayu account login` to sign in again.",
        )?)
    } else {
        None
    };
    let credential = rayu::gateway_credential().await.ok_or_else(|| {
        anyhow::anyhow!(
            "The Rayu session expired and no RAYU_API_KEY is configured. Run `rayu account login` to sign in again."
        )
    })?;
    let credits = rayu::fetch_credits(&credential)
        .await
        .context("Could not fetch Rayu credits from the gateway")?;

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&status_json(me.as_ref(), &credits, has_api_key))?
        );
        return Ok(());
    }

    println!("Rayu Account");
    if let Some(me) = &me {
        if let Some(email) = me.user.email.as_deref() {
            println!("  Email:   {email}");
        }
        if let Some(name) = me.user.display_name.as_deref() {
            println!("  Name:    {name}");
        }
        println!("  Status:  {}", me.status);
    } else {
        println!("  Auth:    RAYU_API_KEY configured");
    }
    let plan = if credits.plan_name.is_empty() {
        &credits.plan
    } else {
        &credits.plan_name
    };
    println!("  Plan:    {plan}");
    match credits.remaining_credits {
        Some(remaining) => println!(
            "  Credits: {remaining:.2} remaining ({:.2} used this period)",
            credits.used_credits
        ),
        None => println!("  Credits: {:.2} used this period", credits.used_credits),
    }
    if credits.topup_balance > 0.0 {
        println!("  Top-up:  {:.2} credits", credits.topup_balance);
    }
    if let Some(period_end) = credits.period_end.as_deref() {
        println!("  Resets:  {period_end}");
    }
    println!("\nManage: {}", rayu::account_url());
    Ok(())
}

/// Machine-readable status. Mirrors the gateway's camelCase field names so
/// scripts see the same shape as `GET /v1/credits`.
fn status_json(
    me: Option<&rayu::RayuMe>,
    credits: &rayu::RayuCredits,
    has_api_key: bool,
) -> serde_json::Value {
    let account = me.map(|me| {
        serde_json::json!({
            "user": {
                "id": me.user.id,
                "email": me.user.email,
                "displayName": me.user.display_name,
                "avatarUrl": me.user.avatar_url,
                "role": me.user.role,
            },
            "status": me.status,
        })
    });
    let api_key_limits = credits.api_key.as_ref().map(|limits| {
        serde_json::json!({
            "keyId": limits.key_id,
            "creditLimit": limits.credit_limit,
            "allowedModels": limits.allowed_models,
            "rateLimitRpm": limits.rate_limit_rpm,
        })
    });
    serde_json::json!({
        "account": account,
        "apiKeyConfigured": has_api_key,
        "credits": {
            "plan": credits.plan,
            "planName": credits.plan_name,
            "creditsPerPeriod": credits.credits_per_period,
            "usedCredits": credits.used_credits,
            "remainingCredits": credits.remaining_credits,
            "resetSeconds": credits.reset_seconds,
            "periodEnd": credits.period_end,
            "topupBalance": credits.topup_balance,
            "topUpEnabled": credits.top_up_enabled,
            "limitMode": credits.limit_mode,
            "apiKey": api_key_limits,
        },
    })
}

pub(crate) fn run_manage() -> Result<()> {
    let url = rayu::account_url();
    println!("Opening Rayu account management: {url}");
    if crate::auth::browser_suppressed(false) {
        println!("Browser launch is disabled. Open the URL above manually.");
        return Ok(());
    }
    open::that_detached(&url)
        .with_context(|| format!("Could not open the browser. Open {url} manually instead."))?;
    Ok(())
}

pub(crate) async fn run_logout() -> Result<()> {
    let had_credential = rayu::has_credentials();
    // Local cleanup is unconditional, including offline and already-expired
    // cases. This is the security boundary the CLI can always enforce.
    rayu::logout().context("Failed to securely clear local Rayu credentials")?;
    crate::auth::AuthStatus::invalidate_cache();

    if had_credential {
        println!("Rayu session, API-key state, and cached catalogs were securely cleared.");
    } else {
        println!("No local Rayu credential was present. Local account cache is clear.");
    }
    if rayu::has_api_key() {
        println!("Note: RAYU_API_KEY is still set in the environment; unset it to stop using it.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credits() -> rayu::RayuCredits {
        rayu::RayuCredits {
            plan: "pro".into(),
            plan_name: "Pro".into(),
            credits_per_period: Some(100.0),
            used_credits: 12.5,
            remaining_credits: Some(87.5),
            reset_seconds: 3600,
            period_end: Some("2026-12-01T00:00:00Z".into()),
            topup_balance: 5.0,
            top_up_enabled: true,
            limit_mode: None,
            api_key: None,
        }
    }

    #[test]
    fn status_json_mirrors_gateway_camel_case_and_omits_missing_account() {
        let value = status_json(None, &credits(), true);
        assert!(value["account"].is_null());
        assert_eq!(value["apiKeyConfigured"], true);
        assert_eq!(value["credits"]["planName"], "Pro");
        assert_eq!(value["credits"]["remainingCredits"], 87.5);
        assert_eq!(value["credits"]["topupBalance"], 5.0);
        assert!(value["credits"]["apiKey"].is_null());
    }

    #[test]
    fn status_json_includes_session_identity_when_signed_in() {
        let me = rayu::RayuMe {
            user: rayu::RayuSessionUser {
                id: 42,
                email: Some("dev@example.com".into()),
                display_name: Some("Dev".into()),
                avatar_url: None,
                role: "user".into(),
            },
            status: "active".into(),
        };
        let value = status_json(Some(&me), &credits(), false);
        assert_eq!(value["account"]["user"]["id"], 42);
        assert_eq!(value["account"]["user"]["displayName"], "Dev");
        assert_eq!(value["account"]["status"], "active");
        assert_eq!(value["apiKeyConfigured"], false);
    }

    #[test]
    fn manage_url_is_the_rayu_dashboard() {
        let url = rayu::account_url();
        assert!(url.ends_with("/dashboard"), "{url}");
        assert!(url.starts_with("https://") || url.starts_with("http://127.0.0.1"));
    }
}
