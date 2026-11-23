//! Account and billing reads: `/me`, gateway `/v1/credits`, `/me/entitlements`.
//!
//! The gateway is the billing source of truth; these calls only display.
//! Bearer credentials never follow a redirect to another origin.

use super::error::{RayuAuthKind, RayuErrorContext, RayuGatewayError, read_http_error_parts};
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
///
/// Mirrors `rayu-gateway-rust/crates/gateway/src/routes/credits.rs` (both
/// personal and team views). All fields added after the initial contract carry
/// `#[serde(default)]` so older gateways still deserialize cleanly.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    /// Per-day turn cap (`None` = unlimited).
    pub max_daily_turns: Option<i64>,
    pub turns_used_today: i64,
    pub turns_remaining: Option<i64>,
    pub turns_reset_seconds: i64,
    /// Weekly pacing window (`None` = uncapped).
    pub credits_per_week: Option<f64>,
    pub week_used_credits: f64,
    pub week_remaining_credits: Option<f64>,
    pub week_reset_seconds: i64,
    /// Rolling session pacing window (`None` = uncapped).
    pub credits_per_5h: Option<f64>,
    pub window_used_credits: f64,
    pub window_remaining_credits: Option<f64>,
    pub window_reset_seconds: i64,
    pub session_window_minutes: Option<i64>,
    /// `"gated"` (pacing windows enforced) or `"full_credits"` (disabled).
    pub limit_mode: Option<String>,
    /// `"team"` when these figures represent an organization pool rather than a personal plan.
    pub scope: Option<String>,
    pub team: Option<RayuTeamCredits>,
    pub api_key: Option<RayuApiKeyLimits>,
}

/// Team pool and per-seat quota breakdown reported on `GET /v1/credits` when
/// the caller is billed to an active team.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RayuTeamCredits {
    pub organization_id: i64,
    pub role: String,
    pub pool_credits: f64,
    pub pool_used_credits: f64,
    pub bucket_quota: f64,
    pub bucket_remaining: f64,
    pub purchased_credits: f64,
    pub purchased_remaining: f64,
}

impl RayuCredits {
    /// Human-readable plan label (`planName` when non-empty, otherwise `plan`).
    pub fn display_plan_name(&self) -> &str {
        if self.plan_name.trim().is_empty() {
            self.plan.as_str()
        } else {
            self.plan_name.as_str()
        }
    }

    /// Whether pacing windows (`creditsPer5h` / `creditsPerWeek`) are enforced.
    /// Absent `limitMode` defaults to enforced (`true`), matching the gateway
    /// and legacy `rayu-cli` (`isPacingEnforced`).
    pub fn is_pacing_enforced(&self) -> bool {
        !self
            .limit_mode
            .as_deref()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("full_credits"))
    }

    /// True when this credits snapshot belongs to a team pool rather than a personal plan.
    pub fn is_team_scope(&self) -> bool {
        self.scope
            .as_deref()
            .is_some_and(|scope| scope.eq_ignore_ascii_case("team"))
            || self.team.is_some()
    }

    /// Whether the account/team has spendable credits left.
    /// `remainingCredits: null` means uncapped/unlimited (not zero), and a
    /// positive personal top-up or team purchased pool keeps the caller usable.
    pub fn has_spendable_credits(&self) -> bool {
        match self.remaining_credits {
            None => true,
            Some(remaining) if remaining.is_finite() && remaining > 0.0 => true,
            Some(_) => {
                (self.topup_balance.is_finite() && self.topup_balance > 0.0)
                    || self.team.as_ref().is_some_and(|team| {
                        team.purchased_remaining.is_finite() && team.purchased_remaining > 0.0
                    })
            }
        }
    }
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
    #[serde(default)]
    pub max_input_tokens: Option<u64>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
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

async fn http_response_error(
    response: reqwest::Response,
    auth: RayuAuthKind,
    endpoint_label: &str,
) -> anyhow::Error {
    let (status, limit_header, retry_after_secs, body) = read_http_error_parts(response).await;
    crate::logging::warn(&format!(
        "Rayu {endpoint_label} failed (HTTP {status}, x_rayu_limit={:?}, retry_after={:?}): {}",
        limit_header,
        retry_after_secs,
        crate::util::truncate_str(body.trim(), 400)
    ));
    RayuGatewayError::from_http_response(
        status,
        &body,
        limit_header.as_deref(),
        retry_after_secs,
        RayuErrorContext {
            auth,
            model: None,
            request_id: None,
        },
    )
    .into()
}

async fn get_json_with_jwt_refresh<T: serde::de::DeserializeOwned>(
    url: &str,
    credential: &str,
    include_client_header: bool,
    reach_error: &'static str,
    endpoint_label: &'static str,
    parse_error: &'static str,
) -> anyhow::Result<T> {
    let auth = RayuAuthKind::from_credential(credential);
    let send_once = |bearer: &str| {
        let mut req = super::http_client().get(url).bearer_auth(bearer);
        if include_client_header {
            req = req.header("x-rayu-client", super::client_product());
        }
        req.send()
    };
    let mut response = send_once(credential)
        .await
        .map_err(|_| anyhow::anyhow!(reach_error))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        && auth == RayuAuthKind::AccountJwt
        && super::has_usable_session()
        && let Some(fresh) = super::refresh_access_token(Some(credential)).await
    {
        response = send_once(&fresh)
            .await
            .map_err(|_| anyhow::anyhow!(reach_error))?;
    }
    if !response.status().is_success() {
        return Err(http_response_error(response, auth, endpoint_label).await);
    }
    response
        .json::<T>()
        .await
        .map_err(|_| anyhow::anyhow!(parse_error))
}

/// Fetch the live account record with the session JWT.
/// Retries once after refreshing the JWT when the backend responds 401.
pub async fn fetch_me() -> anyhow::Result<RayuMe> {
    let token = bearer_jwt().await?;
    let url = format!("{}/me", api_base());
    get_json_with_jwt_refresh(
        &url,
        &token,
        false,
        "Could not reach the Rayu account service",
        "account /me",
        "Rayu account service returned an invalid profile",
    )
    .await
}

/// Fetch live usage from the gateway with an explicit credential
/// (account JWT or API key — both are accepted on this endpoint).
/// For account JWT sessions, retries once after refreshing on HTTP 401.
pub async fn fetch_credits(credential: &str) -> anyhow::Result<RayuCredits> {
    let url = format!("{}/v1/credits", gateway_base());
    get_json_with_jwt_refresh(
        &url,
        credential,
        true,
        "Could not reach the Rayu gateway",
        "gateway /v1/credits",
        "Rayu gateway returned an invalid credits response",
    )
    .await
}

/// Fetch the signed-in user's plan entitlements with the session JWT.
/// Retries once after refreshing the JWT when the backend responds 401.
pub async fn fetch_entitlements() -> anyhow::Result<RayuEntitlements> {
    let token = bearer_jwt().await?;
    let url = format!("{}/me/entitlements", api_base());
    get_json_with_jwt_refresh(
        &url,
        &token,
        false,
        "Could not reach the Rayu account service",
        "account /me/entitlements",
        "Rayu account service returned invalid entitlements",
    )
    .await
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
