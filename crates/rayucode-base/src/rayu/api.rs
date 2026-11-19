//! Account and billing reads: `/me`, gateway `/v1/credits`, `/me/entitlements`.
//!
//! The gateway is the billing source of truth; these calls only display.
//! Bearer credentials never follow a redirect to another origin.

use super::session::RayuSessionUser;
use super::urls::{api_base, gateway_base};

/// The live account record (`GET {api}/me`).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RayuMe {
    pub user: RayuSessionUser,
    /// `active` for a usable account; anything else (e.g. `suspended`) is not.
    pub status: String,
}

/// Live credit/usage status from the gateway (`GET {gateway}/v1/credits`).
/// Accepts either an account JWT or a `rayu_sk_live_…` API key.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RayuCredits {
    pub plan: String,
    pub plan_name: String,
    pub credits_per_period: Option<f64>,
    pub used_credits: f64,
    pub remaining_credits: Option<f64>,
    pub reset_seconds: i64,
    pub period_end: Option<String>,
    pub topup_balance: f64,
    pub top_up_enabled: bool,
    pub limit_mode: Option<String>,
    pub api_key: Option<RayuApiKeyLimits>,
}

/// The calling API key's own limits, present only for API-key callers.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RayuApiKeyLimits {
    pub key_id: i64,
    /// Whole credits this key may spend per period; None = uncapped.
    pub credit_limit: Option<f64>,
    /// EMPTY = every model the plan allows.
    pub allowed_models: Vec<String>,
    /// Requests/minute ceiling; None or 0 = uncapped.
    pub rate_limit_rpm: Option<i64>,
}

/// One hosted model entry from the entitlements catalog.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RayuModelEntry {
    pub code: String,
    pub label: Option<String>,
    pub description: Option<String>,
    pub context_window: Option<u64>,
    pub supports_reasoning: Option<bool>,
    pub supports_image: Option<bool>,
    pub supports_tools: Option<bool>,
    pub credit_multiplier: Option<f64>,
}

/// What the signed-in user's plan allows (`GET {api}/me/entitlements`).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RayuEntitlements {
    /// Hosted models the plan can USE (drives entitlement/gating).
    #[serde(default)]
    pub allowed_models: Vec<RayuModelEntry>,
    /// Full enabled hosted catalog; falls back to allowed_models when absent.
    pub hosted_models: Option<Vec<RayuModelEntry>>,
    pub subagent_tiers: Option<serde_json::Value>,
}

async fn bearer_jwt() -> anyhow::Result<String> {
    super::access_token()
        .await
        .ok_or_else(|| anyhow::anyhow!("Not signed in to Rayu. Run /login to sign in."))
}

/// Fetch the live account record with the session JWT.
pub async fn fetch_me() -> anyhow::Result<RayuMe> {
    let token = bearer_jwt().await?;
    let response = super::http_client()
        .get(format!("{}/me", api_base()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Could not reach the Rayu account service"))?;
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!("Rayu account service returned HTTP {}", status.as_u16());
    }
    response
        .json::<RayuMe>()
        .await
        .map_err(|_| anyhow::anyhow!("Rayu account service returned an invalid profile"))
}

/// Fetch live usage from the gateway with an explicit credential
/// (account JWT or API key — both are accepted on this endpoint).
pub async fn fetch_credits(credential: &str) -> anyhow::Result<RayuCredits> {
    let response = super::http_client()
        .get(format!("{}/v1/credits", gateway_base()))
        .bearer_auth(credential)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Could not reach the Rayu gateway"))?;
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!("Rayu gateway returned HTTP {}", status.as_u16());
    }
    response
        .json::<RayuCredits>()
        .await
        .map_err(|_| anyhow::anyhow!("Rayu gateway returned an invalid credits response"))
}

/// Fetch the signed-in user's plan entitlements with the session JWT.
/// Retries once after refreshing the JWT when the backend responds 401.
pub async fn fetch_entitlements() -> anyhow::Result<RayuEntitlements> {
    let token = bearer_jwt().await?;
    let url = format!("{}/me/entitlements", api_base());
    let mut response = super::http_client()
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Could not reach the Rayu account service"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        && let Some(fresh) = super::refresh_access_token(Some(&token)).await
    {
        response = super::http_client()
            .get(&url)
            .bearer_auth(&fresh)
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Could not reach the Rayu account service"))?;
    }
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!("Rayu account service returned HTTP {}", status.as_u16());
    }
    response
        .json::<RayuEntitlements>()
        .await
        .map_err(|_| anyhow::anyhow!("Rayu account service returned invalid entitlements"))
}

/// The Bearer value for a gateway request: the account JWT (refreshed as
/// needed) wins over the configured API key, keeping account billing and
/// attribution unchanged for anyone who is signed in.
pub async fn gateway_credential() -> Option<String> {
    if let Some(token) = super::access_token().await {
        return Some(token);
    }
    super::configured_api_key()
}

/// Whether any usable Rayu credential exists (usable account session or
/// configured `RAYU_API_KEY` not known to be invalid or out of credits).
pub fn has_credentials() -> bool {
    super::has_usable_session() || super::has_validated_api_key()
}
