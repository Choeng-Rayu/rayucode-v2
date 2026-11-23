//! Canonical parser and user-facing formatter for Rayu gateway & backend errors.
//!
//! Single source of truth shared across:
//! - account/billing reads (`fetch_me`, `fetch_credits`, `fetch_entitlements`)
//! - CLI login code exchange (`/cli/token`)
//! - gateway model catalog (`GET /v1/models`)
//! - hosted inference (`POST /anthropic/v1/messages`) and mid-stream SSE `event: error`
//!
//! Mirrors every structured error contract emitted by `rayu-gateway-rust`
//! (`httpx.rs`, `auth.rs`, `hosted.rs`, `reservedenial.rs`, `routes/anthropic.rs`,
//! `protection.rs`, `admission.rs`, `state.rs`, `upstream.rs`, `sse.rs`) and
//! `rayu-backend` (`auth.controller.ts`, `auth.service.ts`), distinguishing
//! **Rayu Auth (account JWT)** from **Rayu API Key (`rayu_sk_live_…`)**.

use std::fmt;

use super::urls::{account_url, api_keys_url, pricing_url};

/// Gateway API-key prefix family (`rayu-gateway-rust/crates/gateway/src/auth.rs`).
/// Matches `rayu_sk_live_…` as well as any future `rayu_sk_test_…` keys.
const GATEWAY_API_KEY_PREFIX: &str = "rayu_sk_";

/// Canonical machine-readable gateway limit reason header (`X-Rayu-Limit`).
pub const RAYU_LIMIT_HEADER: &str = "x-rayu-limit";

/// Maximum length of an admin-authored custom model error message (`rayu_custom: true`).
/// Mirrors `rayu-gateway-rust` / `rayu-backend` (`hosted_models.error_message`).
const MAX_CUSTOM_ERROR_CHARS: usize = 300;

/// Maximum bytes read from an HTTP error response body when parsing diagnostics.
const MAX_ERROR_BODY_BYTES: usize = 16 * 1024;

/// Which Rayu credential was sent on the failed request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RayuAuthKind {
    /// Account JWT session (`~/.rayu/rayu-auth.json`, `/login rayu`).
    AccountJwt,
    /// User API key (`RAYU_API_KEY`, `rayu_sk_live_…`, `/login rayu-api`).
    ApiKey,
    /// Caller does not distinguish (or no credential was sent).
    #[default]
    Unknown,
}

impl RayuAuthKind {
    /// Infer credential kind from the raw Bearer token, matching the gateway's
    /// `auth::looks_like_api_key` prefix check (`rayu_sk_`).
    pub fn from_credential(credential: &str) -> Self {
        let trimmed = credential.trim();
        if trimmed.starts_with(GATEWAY_API_KEY_PREFIX) {
            Self::ApiKey
        } else if !trimmed.is_empty() {
            Self::AccountJwt
        } else {
            Self::Unknown
        }
    }
}

/// Machine-readable classification of a Rayu gateway or backend error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RayuErrorKind {
    /// 401 — missing/invalid/expired JWT or invalid/revoked/expired API key.
    Unauthorized,
    /// 403 — account suspended or otherwise inactive (`account is <status>`).
    AccountInactive,
    /// 403 — API key allowlist excludes the model (`model not allowed for this API key: …`).
    ApiKeyModelNotAllowed,
    /// 403 — model not included in the account/team plan (`model not available on your plan: …`).
    PlanModelNotAvailable,
    /// 402 — team-funded team has no active credit plan (`team_plan_required`).
    TeamPlanRequired,
    /// 400 — model lacks required capability (`model_no_image_support` / `model_no_thinking_support`).
    ModelCapabilityUnsupported,
    /// 400/413/422 — client-fixable request error (body too large, max_tokens, relayed upstream 4xx).
    InvalidRequest,
    /// 429 — personal billing-period credit limit reached (`period_limit`).
    CreditLimitReached,
    /// 429 — team credit pool exhausted (`pool_limit` / `bucket_limit`).
    TeamPoolExhausted,
    /// 429 — daily turn cap (`daily_turn_limit`).
    DailyTurnLimit,
    /// 429 — pacing window (`weekly_limit` / `session_window_limit`), personal or team.
    PacingWindowLimit,
    /// 429 — per-API-key billing-period credit cap (`api_key_credit_limit`).
    ApiKeyCreditLimit,
    /// 429 — per-API-key requests/minute cap (`api_key_rpm_limit` / `api_key_rate_limit`).
    ApiKeyRpmLimit,
    /// 429/503 — transient concurrency, short-window, ingress, admission, or auth lookup blip.
    TransientCapacity,
    /// 429 — upstream model provider rate limit (`rate_limit_response`).
    ProviderRateLimited,
    /// 429/5xx/SSE with `rayu_custom: true` — admin-authored per-model customer notice.
    CustomModelNotice,
    /// 5xx / Cloudflare / SSE `provider_unavailable` / `overloaded_error` / upstream drop.
    ProviderUnavailable,
    /// 503 — gateway internal temporary refusal (`Billing configuration is unavailable`, `gateway busy`, `model temporarily unavailable`, `authentication temporarily unavailable`).
    GatewayTemporaryUnavailable,
    /// 500 — gateway misconfiguration or backend lookup failure (`provider key not configured`, `rate limiter unavailable`, `entitlement lookup failed`, `status lookup failed`).
    GatewayInternalError,
    /// Any other HTTP status or unrecognised error.
    Other,
}

/// Structured fields extracted from a Rayu gateway, backend, or Cloudflare error response.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedRayuError {
    pub status: Option<u16>,
    pub error_type: Option<String>,
    pub message: Option<String>,
    pub rayu_code: Option<String>,
    pub rayu_custom: bool,
    pub reason: Option<String>,
    pub scope: Option<String>,
    pub reset_seconds: Option<i64>,
    pub credit_limit: Option<f64>,
    pub transient: Option<bool>,
    pub cloudflare_error: bool,
}

impl ParsedRayuError {
    /// Parse a gateway/backend error body together with `X-Rayu-Limit` and `Retry-After` headers.
    ///
    /// Supports every envelope shape produced by `rayu-gateway-rust` and `rayu-backend`:
    /// - Anthropic: `{"type":"error","error":{"type":...,"message":...,"rayu_code":...,"rayu_custom":true}}`
    /// - OpenAI / gateway: `{"error":{"message":...,"type":...},"reason":...,"scope":...,"resetSeconds":...,"creditLimit":...,"transient":...}`
    /// - NestJS backend: `{"statusCode":401,"message":"..." | ["..."],"error":"Unauthorized"}`
    /// - Cloudflare JSON (`{"cloudflare_error":true}`) or HTML 5xx pages.
    pub fn parse(
        status: Option<u16>,
        body: &str,
        limit_header: Option<&str>,
        retry_after_secs: Option<i64>,
    ) -> Self {
        let mut parsed = Self {
            status,
            ..Default::default()
        };
        let trimmed = body.trim();

        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if value
                .get("cloudflare_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                parsed.cloudflare_error = true;
            }
            parsed.reason = non_empty_str(value.get("reason"));
            parsed.scope = non_empty_str(value.get("scope"));
            parsed.transient = value.get("transient").and_then(|v| v.as_bool());
            parsed.reset_seconds = value
                .get("resetSeconds")
                .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64)))
                .filter(|&s| s > 0);
            parsed.credit_limit = value
                .get("creditLimit")
                .and_then(|v| v.as_f64())
                .filter(|v| v.is_finite() && *v > 0.0);

            // Inspect nested `error` object (and one level deeper if wrapped) as well
            // as top-level fields for NestJS / OpenAI / Anthropic compatibility.
            let nested = value.get("error").filter(|v| v.is_object());
            let doubly_nested = nested
                .and_then(|v| v.get("error"))
                .filter(|v| v.is_object());

            let candidates = [doubly_nested, nested, Some(&value)];
            for cand in candidates.into_iter().flatten() {
                if !parsed.rayu_custom
                    && cand
                        .get("rayu_custom")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                {
                    parsed.rayu_custom = true;
                }
                if parsed.rayu_code.is_none() {
                    parsed.rayu_code = non_empty_str(cand.get("rayu_code"));
                }
                if parsed.error_type.is_none() {
                    // Ignore Anthropic's outer `"type": "error"` envelope discriminator
                    // so the inner `error.type` wins.
                    if let Some(ty) = non_empty_str(cand.get("type")).filter(|t| t != "error") {
                        parsed.error_type = Some(ty);
                    }
                }
                if parsed.message.is_none() {
                    parsed.message = extract_message_field(cand.get("message"));
                }
            }
            // String `"error": "..."` fallback (e.g. NestJS `{"error":"Unauthorized"}` when
            // `message` is absent, or simple JSON `{"error":"temporary outage"}`).
            if parsed.message.is_none() {
                parsed.message = non_empty_str(value.get("error"));
            }
        } else if !trimmed.is_empty() {
            if looks_like_html_error_page(trimmed) {
                parsed.cloudflare_error = true;
            } else {
                let first_line = trimmed.lines().next().unwrap_or(trimmed).trim();
                if !first_line.is_empty() {
                    parsed.message =
                        Some(crate::util::truncate_str(first_line, 240).to_string());
                }
            }
        }

        // `X-Rayu-Limit` is the gateway's canonical machine-readable limit header and
        // takes precedence over body heuristics (matching `rayu-cli`'s `rayuLimitReason`).
        if let Some(header) = limit_header.map(str::trim).filter(|s| !s.is_empty()) {
            parsed.reason = Some(header.to_string());
        } else if parsed.reason.is_none()
            && let Some(msg) = parsed.message.as_deref()
            && let Some(reason) = extract_legacy_credit_limit_reason(msg)
        {
            parsed.reason = Some(reason);
        }

        // Fall back to `Retry-After` when body omitted `resetSeconds` (or for transient waits).
        if parsed.reset_seconds.is_none() {
            parsed.reset_seconds = retry_after_secs.filter(|&s| s > 0);
        }

        parsed
    }

    pub fn is_team_scope(&self) -> bool {
        self.scope
            .as_deref()
            .is_some_and(|s| s.eq_ignore_ascii_case("team"))
    }
}

/// Context passed when rendering a [`RayuGatewayError`] for a specific caller surface.
#[derive(Debug, Clone, Copy, Default)]
pub struct RayuErrorContext<'a> {
    pub auth: RayuAuthKind,
    pub model: Option<&'a str>,
    pub request_id: Option<&'a str>,
}

/// Typed, user-facing Rayu gateway/backend error.
///
/// Carrying a dedicated error type lets downstream retry loops distinguish an
/// authoritative HTTP status reply from a transient socket/body transport fault
/// without fragile string-prefix matching.
#[derive(Debug, Clone)]
pub struct RayuGatewayError {
    pub status: Option<u16>,
    pub kind: RayuErrorKind,
    pub parsed: ParsedRayuError,
    pub message: String,
    pub request_id: Option<String>,
}

impl RayuGatewayError {
    /// Parse and format an HTTP error response from the Rayu gateway or backend.
    pub fn from_http_response(
        status: u16,
        body: &str,
        limit_header: Option<&str>,
        retry_after_secs: Option<i64>,
        ctx: RayuErrorContext<'_>,
    ) -> Self {
        let parsed = ParsedRayuError::parse(Some(status), body, limit_header, retry_after_secs);
        let (kind, message) = classify_and_format_http(status, &parsed, ctx);
        Self {
            status: Some(status),
            kind,
            parsed,
            message,
            request_id: ctx
                .request_id
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToString::to_string),
        }
    }

    /// Construct a session-expired 401 error (e.g. after JWT refresh fails).
    pub fn session_expired(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            status: Some(401),
            kind: RayuErrorKind::Unauthorized,
            parsed: ParsedRayuError {
                status: Some(401),
                error_type: Some("authentication_error".to_string()),
                message: Some(message.clone()),
                ..Default::default()
            },
            message,
            request_id: None,
        }
    }

    /// Parse and format a mid-stream SSE `event: error` payload from the Rayu gateway.
    pub fn from_sse_error_data(data: &str, model: Option<&str>) -> Self {
        let parsed = ParsedRayuError::parse(None, data, None, None);
        let (kind, message) = classify_and_format_sse(&parsed, data, model);
        Self {
            status: None,
            kind,
            parsed,
            message,
            request_id: None,
        }
    }

    /// Whether this error indicates rejected/expired authentication credentials (HTTP 401).
    pub fn is_unauthorized(&self) -> bool {
        self.status == Some(401) || self.kind == RayuErrorKind::Unauthorized
    }
}

impl fmt::Display for RayuGatewayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)?;
        if let Some(request_id) = self.request_id.as_deref() {
            write!(f, "\n  request_id: {request_id}")?;
        }
        Ok(())
    }
}

impl std::error::Error for RayuGatewayError {}

/// Human-friendly reset ETA matching `rayu-cli`'s `formatCreditResetHint`
/// (e.g. `"in about 28 days"`, `"in about 5 hours"`, `"in about 3 minutes"`).
pub fn format_reset_eta(seconds: i64) -> String {
    if seconds <= 0 {
        return "shortly".to_string();
    }
    let days = ((seconds as f64) / 86_400.0).round() as i64;
    if days >= 1 {
        return format!("in about {days} day{}", if days == 1 { "" } else { "s" });
    }
    let hours = ((seconds as f64) / 3_600.0).round() as i64;
    if hours >= 1 {
        return format!("in about {hours} hour{}", if hours == 1 { "" } else { "s" });
    }
    if seconds < 60 {
        return format!(
            "in about {seconds} second{}",
            if seconds == 1 { "" } else { "s" }
        );
    }
    let mins = (((seconds as f64) / 60.0).round() as i64).max(1);
    format!(
        "in about {mins} minute{}",
        if mins == 1 { "" } else { "s" }
    )
}

/// Sanitize an untrusted admin-authored error message (`rayu_custom: true`) before
/// rendering in a terminal or panel: strip ANSI/ESC sequences, drop C0/C1 control
/// characters, collapse whitespace runs to a single space, trim, and cap length at
/// [`MAX_CUSTOM_ERROR_CHARS`] characters.
pub fn sanitize_custom_error_message(raw: &str) -> String {
    let cleaned = sanitize_text_clean(raw);
    if cleaned.chars().count() <= MAX_CUSTOM_ERROR_CHARS {
        return cleaned;
    }
    cleaned
        .chars()
        .take(MAX_CUSTOM_ERROR_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Whether a Rayu gateway error breaks EVERY Rayu model for this credential
/// (account-wide auth failure, suspended account, empty plan/team balance,
/// pacing window, daily turn cap, or API-key credit cap) as opposed to a
/// per-model refusal (plan/key model gate, capability mismatch, upstream 429,
/// or transient 5xx) where switching to another Rayu model can still succeed.
pub fn is_rayu_account_wide_failure(error: &str) -> bool {
    // Strip trailing `request_id:` diagnostic lines so hex UUIDs containing
    // substrings like `-403a-` or `e401f` cannot false-positive as HTTP codes.
    let body_only: String = error
        .lines()
        .filter(|line| !line.trim_start().to_ascii_lowercase().starts_with("request_id:"))
        .collect::<Vec<_>>()
        .join("\n");
    let lower = body_only.to_ascii_lowercase();

    // Explicit per-model / transient exceptions MUST NOT hide sibling Rayu models:
    if lower.contains("not allowed for this api key")
        || lower.contains("api key does not have access to")
        || lower.contains("not available on your plan")
        || lower.contains("not available on your current rayu plan")
        || lower.contains("billing configuration is unavailable")
        || lower.contains("not your credit balance")
        || lower.contains("model_no_image_support")
        || lower.contains("model_no_thinking_support")
        || lower.contains("cannot read images")
        || lower.contains("does not support extended thinking")
    {
        return false;
    }

    if crate::provider::error_looks_like_credential_failure(&body_only)
        || rayucode_provider_core::is_definitive_usage_exhaustion(&body_only)
    {
        return true;
    }

    has_http_status_token(&lower, "401")
        || has_http_status_token(&lower, "402")
        || has_http_status_token(&lower, "403")
        || lower.contains("payment required")
        || lower.contains("team has no active credit plan")
        || lower.contains("team's credit pool is exhausted")
        || lower.contains("credit limit for this billing period")
        || lower.contains("api key credit limit")
        || lower.contains("daily turn limit")
        || lower.contains("weekly credit allowance")
        || lower.contains("session credit allowance")
        || lower.contains("your rayu account is ")
        || lower.contains("account is suspended")
        || lower.contains("account is banned")
        || lower.contains("account is disabled")
        || lower.contains("account is not active")
}

/// Match an HTTP status code ONLY in HTTP-status contexts (`http 401`, `status 401`,
/// `(401)`, `(401 `, `401 unauthorized`, etc.) so model IDs like `glm-403` or random
/// numbers never false-positive.
fn has_http_status_token(lower: &str, code: &str) -> bool {
    let prefixes = [
        format!("http {code}"),
        format!("http/{code}"),
        format!("status {code}"),
        format!("status: {code}"),
        format!("status={code}"),
        format!("({code})"),
        format!("({code} "),
        format!("{code} unauthorized"),
        format!("{code} payment"),
        format!("{code} forbidden"),
    ];
    let bytes = lower.as_bytes();
    prefixes.iter().any(|needle| {
        lower.match_indices(needle).any(|(start, _)| {
            let end = start + needle.len();
            end == bytes.len() || !bytes[end].is_ascii_digit()
        })
    })
}

/// Whether `error` already carries actionable Rayu guidance (login, dashboard,
/// plans, `/model`, team admin, or no-charge reassurance), so the TUI should
/// NOT tack an unrelated `"Run /fix to attempt recovery."` suffix onto it.
pub fn is_self_contained_rayu_guidance(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    let plans = pricing_url().to_ascii_lowercase();
    let dashboard = account_url().to_ascii_lowercase();
    let api_keys = api_keys_url().to_ascii_lowercase();
    lower.contains("/login rayu")
        || lower.contains("/dashboard/api-keys")
        || lower.contains(&plans)
        || lower.contains(&dashboard)
        || lower.contains(&api_keys)
        || lower.contains("with /model")
        || lower.contains("run /model")
        || lower.contains("request body too large (http 413")
        || lower.contains("not your credit balance")
        || lower.contains("no credits were charged")
        || lower.contains("ask your team admin")
        || lower.contains("could not renew your rayu session")
        || lower.contains("your rayu account is ")
        || lower.contains("rayu authentication is temporarily unavailable")
        || lower.contains("the rayu gateway is temporarily at capacity")
        || lower.contains("the rayu gateway is busy")
        || lower.contains("too many requests to the rayu gateway")
        || lower.contains("rayu gateway error (http 500)")
        || lower.contains("rayu rate limit exceeded")
}

/// Extract a non-empty `X-Rayu-Limit` header value from a gateway HTTP response.
pub fn extract_rayu_limit_header(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get(RAYU_LIMIT_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Read `X-Rayu-Limit`, integer `Retry-After`, and a bounded error body from a
/// non-2xx `reqwest::Response` (used by `rayucode-base::rayu::api` and `login`).
pub(super) async fn read_http_error_parts(
    response: reqwest::Response,
) -> (u16, Option<String>, Option<i64>, String) {
    let status = response.status().as_u16();
    let limit_header = extract_rayu_limit_header(response.headers());
    let retry_after_secs = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<i64>().ok())
        .filter(|&s| s > 0);
    let bytes = response.bytes().await.unwrap_or_default();
    let slice = if bytes.len() > MAX_ERROR_BODY_BYTES {
        &bytes[..MAX_ERROR_BODY_BYTES]
    } else {
        &bytes[..]
    };
    let body = String::from_utf8_lossy(slice).into_owned();
    (status, limit_header, retry_after_secs, body)
}

fn format_custom_or_capability_notice(
    parsed: &ParsedRayuError,
    raw_msg: &str,
    model: Option<&str>,
    status: Option<u16>,
) -> Option<(RayuErrorKind, String)> {
    // 1. Admin-authored per-model customer notice (`rayu_custom: true`).
    // Always wins over generic 5xx / 429 text so the admin's wording reaches the user.
    if parsed.rayu_custom {
        let custom = sanitize_custom_error_message(raw_msg);
        if !custom.is_empty() {
            let suffix = status
                .map(|code| format!(" (HTTP {code})"))
                .unwrap_or_default();
            return Some((
                RayuErrorKind::CustomModelNotice,
                format!(
                    "{custom} Please wait a moment or switch to a different model with /model.{suffix}"
                ),
            ));
        }
    }

    // 2. Per-model capability refusals (`rayu_code`).
    let code = parsed.rayu_code.as_deref()?;
    let clean_cap_msg = sanitize_inline(raw_msg, 240);
    let inline_tag = match status {
        Some(http) => format!("HTTP {http}; switch models with /model"),
        None => "switch models with /model".to_string(),
    };
    let status_paren = status
        .map(|http| format!(" (HTTP {http})"))
        .unwrap_or_default();
    match code {
        "model_no_image_support" => {
            let text = if !clean_cap_msg.is_empty() {
                format!("{clean_cap_msg} ({inline_tag})")
            } else {
                let target = model_label(model);
                format!(
                    "Model {target} cannot read images{status_paren}. Switch to an image-capable model with /model, or remove the image."
                )
            };
            Some((RayuErrorKind::ModelCapabilityUnsupported, text))
        }
        "model_no_thinking_support" => {
            let text = if !clean_cap_msg.is_empty() {
                format!("{clean_cap_msg} ({inline_tag})")
            } else {
                let target = model_label(model);
                format!(
                    "Model {target} does not support extended thinking{status_paren}. Switch models with /model or disable reasoning effort."
                )
            };
            Some((RayuErrorKind::ModelCapabilityUnsupported, text))
        }
        _ => None,
    }
}

fn high_volume_provider_unavailable(status: Option<u16>) -> (RayuErrorKind, String) {
    let tag = status
        .map(|code| format!(" (HTTP {code})"))
        .unwrap_or_default();
    (
        RayuErrorKind::ProviderUnavailable,
        format!(
            "The model is under high volume right now{tag}. Please wait a moment or switch to a different model with /model."
        ),
    )
}

fn resolve_target_model(raw_msg: &str, ctx_model: Option<&str>, fallback: &str) -> String {
    extract_colon_suffix(raw_msg)
        .or(ctx_model)
        .filter(|s| !s.trim().is_empty())
        .map(|m| format!("\"{}\"", sanitize_inline(m, 80)))
        .unwrap_or_else(|| fallback.to_string())
}

fn classify_and_format_http(
    status: u16,
    parsed: &ParsedRayuError,
    ctx: RayuErrorContext<'_>,
) -> (RayuErrorKind, String) {
    let raw_msg = parsed.message.as_deref().map(str::trim).unwrap_or("");
    let lower_msg = raw_msg.to_ascii_lowercase();
    let reason = parsed.reason.as_deref().map(str::trim).unwrap_or("");
    let err_type = parsed.error_type.as_deref().map(str::trim).unwrap_or("");

    if let Some(classified) =
        format_custom_or_capability_notice(parsed, raw_msg, ctx.model, Some(status))
    {
        return classified;
    }

    match status {
        // --- 401 Unauthorized (auth.rs + rayu-backend) ---------------------
        401 => {
            if ctx.auth == RayuAuthKind::ApiKey || lower_msg.contains("invalid api key") {
                return (
                    RayuErrorKind::Unauthorized,
                    format!(
                        "Rayu API key rejected (HTTP 401): invalid, revoked, or expired key. Check RAYU_API_KEY or create a new key at {}, then run /login rayu-api.",
                        api_keys_url()
                    ),
                );
            }
            if lower_msg.contains("missing bearer token") {
                return (
                    RayuErrorKind::Unauthorized,
                    "Not signed in to Rayu (HTTP 401: missing bearer token). Sign in with /login rayu or set RAYU_API_KEY."
                        .to_string(),
                );
            }
            if lower_msg.contains("account is ") {
                let clean = sanitize_inline(raw_msg, 120);
                return (
                    RayuErrorKind::Unauthorized,
                    format!(
                        "Rayu authentication failed (HTTP 401): {clean}. Check your account at {}.",
                        account_url()
                    ),
                );
            }
            if lower_msg.contains("invalid or expired code") {
                return (
                    RayuErrorKind::Unauthorized,
                    "Rayu sign-in code is invalid or expired (HTTP 401). Please run /login rayu again."
                        .to_string(),
                );
            }
            let detail = sanitize_inline(raw_msg, 120);
            if !detail.is_empty()
                && !detail.eq_ignore_ascii_case("invalid token")
                && !detail.eq_ignore_ascii_case("invalid access token")
                && !detail.eq_ignore_ascii_case("unauthorized")
            {
                (
                    RayuErrorKind::Unauthorized,
                    format!(
                        "Rayu session expired or invalid (HTTP 401: {detail}). Sign in again with /login rayu."
                    ),
                )
            } else {
                (
                    RayuErrorKind::Unauthorized,
                    "Rayu session expired or invalid (HTTP 401). Sign in again with /login rayu."
                        .to_string(),
                )
            }
        }

        // --- 402 Payment Required (hosted.rs: team_plan_required) ----------
        402 => {
            if err_type == "team_plan_required"
                || lower_msg.contains("team_plan_required")
                || lower_msg.contains("team has no credit")
            {
                return (
                    RayuErrorKind::TeamPlanRequired,
                    format!(
                        "Your team has no active credit plan (HTTP 402). Purchase a team plan to continue: {}",
                        pricing_url()
                    ),
                );
            }
            let detail = fallback_detail(raw_msg, "payment required");
            (
                RayuErrorKind::TeamPlanRequired,
                format!("Rayu payment required (HTTP 402): {detail}"),
            )
        }

        // --- 403 Forbidden (hosted.rs, admission.rs, routes/models.rs) -----
        403 => {
            if let Some(account_status) = strip_prefix_ci(raw_msg, "account is ") {
                let status_label = sanitize_inline(account_status, 40);
                let status_label = if status_label.is_empty() {
                    "inactive".to_string()
                } else {
                    status_label
                };
                return (
                    RayuErrorKind::AccountInactive,
                    format!(
                        "Your Rayu account is {status_label} (HTTP 403). Visit {} or contact support.",
                        account_url()
                    ),
                );
            }
            // Checked BEFORE plan gating: both are 403 on the hosted path, but
            // an API-key allowlist restriction is fixed in dashboard/api-keys,
            // not by upgrading the account plan.
            if lower_msg.contains("not allowed for this api key") {
                let target = resolve_target_model(raw_msg, ctx.model, "this model");
                return (
                    RayuErrorKind::ApiKeyModelNotAllowed,
                    format!(
                        "Your Rayu API key does not have access to {target} (HTTP 403). Update key model scope at {}, or run /model.",
                        api_keys_url()
                    ),
                );
            }
            if lower_msg.contains("model not available on your plan")
                || lower_msg.contains("paid feature")
                || lower_msg.contains("plan_upgrade_required")
            {
                let target = resolve_target_model(raw_msg, ctx.model, "This model");
                return (
                    RayuErrorKind::PlanModelNotAvailable,
                    format!(
                        "{target} is not available on your current Rayu plan (HTTP 403). Upgrade at {}, or run /model.",
                        pricing_url()
                    ),
                );
            }
            let detail = fallback_detail(raw_msg, "permission denied");
            (
                RayuErrorKind::Other,
                format!("Rayu request forbidden (HTTP 403): {detail}"),
            )
        }

        // --- 413 Payload Too Large (hosted.rs, admission.rs, upstream) -----
        413 => {
            let detail = fallback_detail(raw_msg, "request body too large");
            (
                RayuErrorKind::InvalidRequest,
                format!(
                    "Request body too large (HTTP 413: {detail}). Run /compact or remove large attachments and retry."
                ),
            )
        }

        // --- 400 / 422 Client-Fixable Request Errors -----------------------
        400 | 422 => {
            if lower_msg.contains("max_tokens exceeds") {
                return (
                    RayuErrorKind::InvalidRequest,
                    format!(
                        "Rayu request rejected (HTTP {status}): max_tokens exceeds the gateway per-request limit."
                    ),
                );
            }
            let detail = fallback_detail(raw_msg, "invalid request");
            (
                RayuErrorKind::InvalidRequest,
                format!("Rayu request rejected (HTTP {status}): {detail}"),
            )
        }

        // --- 429 Too Many Requests (limits, pacing, caps, transient) -------
        429 => classify_and_format_429(parsed, raw_msg, &lower_msg, reason),

        // --- 503 Service Unavailable (capacity, config, auth, model) -------
        503 => {
            if reason == "authentication_unavailable"
                || lower_msg.contains("authentication temporarily unavailable")
            {
                return (
                    RayuErrorKind::TransientCapacity,
                    "Rayu authentication is temporarily unavailable (HTTP 503). Please retry shortly."
                        .to_string(),
                );
            }
            if matches!(
                reason,
                "ingress_capacity"
                    | "control_capacity"
                    | "priority_capacity"
                    | "body_capacity"
                    | "limiter_unavailable"
                    | "audio_capacity"
            ) {
                return (
                    RayuErrorKind::TransientCapacity,
                    "The Rayu gateway is temporarily at capacity (HTTP 503). Please retry shortly."
                        .to_string(),
                );
            }
            if lower_msg.contains("billing configuration is unavailable") {
                return (
                    RayuErrorKind::GatewayTemporaryUnavailable,
                    "Billing configuration is unavailable. No credits were charged. Please retry shortly. (HTTP 503)"
                        .to_string(),
                );
            }
            if lower_msg.contains("gateway busy") {
                return (
                    RayuErrorKind::GatewayTemporaryUnavailable,
                    "The Rayu gateway is busy (HTTP 503). Please retry shortly.".to_string(),
                );
            }
            if let Some(model_name) = strip_prefix_ci(raw_msg, "model temporarily unavailable:") {
                let clean_model = sanitize_inline(model_name, 80);
                let target = if clean_model.is_empty() {
                    model_label(ctx.model)
                } else {
                    format!("\"{clean_model}\"")
                };
                return (
                    RayuErrorKind::GatewayTemporaryUnavailable,
                    format!(
                        "Model {target} is temporarily unavailable (HTTP 503). Please wait a moment or switch models with /model."
                    ),
                );
            }
            if parsed.cloudflare_error || err_type == "provider_unavailable" {
                return high_volume_provider_unavailable(Some(503));
            }
            let detail = fallback_detail(raw_msg, "service temporarily unavailable");
            (
                RayuErrorKind::GatewayTemporaryUnavailable,
                format!("Rayu gateway temporarily unavailable (HTTP 503): {detail}"),
            )
        }

        // --- 502 / 520..526 Upstream or Cloudflare 5xx ---------------------
        502 | 520..=526 => {
            if parsed.cloudflare_error || err_type == "provider_unavailable" || raw_msg.is_empty() {
                return high_volume_provider_unavailable(Some(status));
            }
            let detail = sanitize_inline(raw_msg, 180);
            (
                RayuErrorKind::ProviderUnavailable,
                format!("Rayu gateway upstream error (HTTP {status}): {detail}"),
            )
        }

        // --- 500 Internal Server Error -------------------------------------
        500 => {
            if lower_msg.contains("provider key not configured") {
                let target = model_label(ctx.model);
                return (
                    RayuErrorKind::GatewayInternalError,
                    format!(
                        "Model {target} is temporarily unavailable on the Rayu gateway (HTTP 500: provider key not configured). Switch models with /model."
                    ),
                );
            }
            if parsed.cloudflare_error || err_type == "provider_unavailable" {
                return high_volume_provider_unavailable(Some(500));
            }
            let detail = fallback_detail(raw_msg, "internal gateway error");
            let detail = detail.trim_end_matches('.');
            (
                RayuErrorKind::GatewayInternalError,
                format!("Rayu gateway error (HTTP 500): {detail}. Please retry shortly."),
            )
        }

        // --- Other status codes (e.g. 404, 408, 504) -----------------------
        _ => {
            if parsed.cloudflare_error || err_type == "provider_unavailable" {
                return high_volume_provider_unavailable(Some(status));
            }
            let detail = fallback_detail(raw_msg, "unexpected error");
            (
                RayuErrorKind::Other,
                format!("Rayu gateway request failed (HTTP {status}): {detail}"),
            )
        }
    }
}

fn classify_and_format_429(
    parsed: &ParsedRayuError,
    raw_msg: &str,
    lower_msg: &str,
    reason: &str,
) -> (RayuErrorKind, String) {
    let reset_eta = parsed.reset_seconds.map(format_reset_eta);
    // Normalize message-inferred reasons when `X-Rayu-Limit` / `reason` is absent
    // or unrecognised so each limit kind is formatted in a single match arm.
    let effective_reason = if !reason.is_empty() {
        reason
    } else if !parsed.is_team_scope()
        && parsed.transient != Some(true)
        && (lower_msg.contains("credit limit reached") || lower_msg.contains("period_limit"))
    {
        "period_limit"
    } else if lower_msg.contains("daily turn limit") || lower_msg.contains("daily_turn_limit") {
        "daily_turn_limit"
    } else {
        ""
    };

    match effective_reason {
        // Transient reserve denial: concurrency slot full (NOT a credit limit!).
        "concurrency" => (
            RayuErrorKind::TransientCapacity,
            "Too many concurrent requests for this account (HTTP 429) — this is a concurrency limit, not your credit balance. Retry shortly or reduce parallel requests."
                .to_string(),
        ),
        // Transient short-window abuse cap (NOT a credit limit!).
        "requests" => {
            let wait = reset_eta
                .as_deref()
                .map(|eta| format!(" Retry {eta}."))
                .unwrap_or_else(|| " Please retry shortly.".to_string());
            (
                RayuErrorKind::TransientCapacity,
                format!(
                    "Too many requests in a short window (HTTP 429) — this is a rate limit, not your credit balance.{wait}"
                ),
            )
        }
        // Per-API-key requests/minute cap (hosted.rs: api_key_rpm_limit, admission.rs: api_key_rate_limit).
        "api_key_rpm_limit" | "api_key_rate_limit" => {
            let wait = reset_eta
                .as_deref()
                .map(|eta| format!(" Retry {eta}"))
                .unwrap_or_else(|| " Retry shortly".to_string());
            (
                RayuErrorKind::ApiKeyRpmLimit,
                format!(
                    "Rayu API key rate limit exceeded (HTTP 429).{wait}, or adjust key limits at {}.",
                    api_keys_url()
                ),
            )
        }
        // Per-API-key billing-period spend cap (hosted.rs: api_key_credit_limit).
        "api_key_credit_limit" => {
            let cap = parsed
                .credit_limit
                .map(|limit| format!(" ({} credits)", format_compact_number(limit)))
                .unwrap_or_default();
            (
                RayuErrorKind::ApiKeyCreditLimit,
                format!(
                    "Rayu API key credit limit{cap} reached for this billing period (HTTP 429). Update key limits at {} or use another key.",
                    api_keys_url()
                ),
            )
        }
        // Hard daily turn cap (hosted.rs: daily_turn_limit).
        "daily_turn_limit" => {
            let reset = reset_eta
                .as_deref()
                .map(|eta| format!("It resets {eta}."))
                .unwrap_or_else(|| "It resets at 00:00 UTC.".to_string());
            (
                RayuErrorKind::DailyTurnLimit,
                format!(
                    "You've reached your plan's daily turn limit (HTTP 429). {reset} Upgrade at {}",
                    pricing_url()
                ),
            )
        }
        // Pacing windows: credits remain, only the pacing release window is full.
        "weekly_limit" | "session_window_limit" => {
            let window = if effective_reason == "weekly_limit" {
                "weekly"
            } else {
                "session"
            };
            let reset = reset_eta
                .as_deref()
                .map(|eta| format!(" Resets {eta}."))
                .unwrap_or_default();
            if parsed.is_team_scope() {
                (
                    RayuErrorKind::PacingWindowLimit,
                    format!(
                        "You've used your share of the team's {window} credit allowance (HTTP 429).{reset} Ask your team admin to turn off credit pacing, or wait for it to reset."
                    ),
                )
            } else {
                (
                    RayuErrorKind::PacingWindowLimit,
                    format!(
                        "You've used this {window} credit allowance (HTTP 429).{reset} Turn on \"use all credits\" at {} (one-way until weekly reset), or wait.",
                        account_url()
                    ),
                )
            }
        }
        // Team pool / bucket exhaustion (hosted.rs: pool_limit, bucket_limit).
        "pool_limit" | "bucket_limit" => {
            let reset = reset_eta
                .as_deref()
                .map(|eta| format!(" Resets {eta}."))
                .unwrap_or_default();
            (
                RayuErrorKind::TeamPoolExhausted,
                format!(
                    "Your team's credit pool is exhausted (HTTP 429).{reset} Ask your team admin to buy more credits or upgrade the team plan."
                ),
            )
        }
        // Personal billing-period credit limit (reservedenial.rs: period_limit).
        "period_limit" => {
            let reset = reset_eta
                .as_deref()
                .map(|eta| format!(" Renews {eta}."))
                .unwrap_or_default();
            (
                RayuErrorKind::CreditLimitReached,
                format!(
                    "You've reached your plan's credit limit for this billing period (HTTP 429).{reset} Renew or add credits at {}, or run /model.",
                    pricing_url()
                ),
            )
        }
        // Transient ingress / admission rate limits (protection.rs, admission.rs).
        "ingress_rate_limit" | "account_rate_limit" | "metadata_rate_limit" => {
            let wait = reset_eta
                .as_deref()
                .map(|eta| format!(" Retry {eta}."))
                .unwrap_or_else(|| " Please retry shortly.".to_string());
            (
                RayuErrorKind::TransientCapacity,
                format!("Too many requests to the Rayu gateway (HTTP 429).{wait}"),
            )
        }
        // Unrecognised explicit reason or no reason: check team scope or upstream
        // provider rate limit (`rate_limit_response`).
        _ => {
            if parsed.is_team_scope() && parsed.transient != Some(true) {
                let reset = reset_eta
                    .as_deref()
                    .map(|eta| format!(" Resets {eta}."))
                    .unwrap_or_default();
                let detail = fallback_detail(raw_msg, "your team's credit pool is exhausted");
                let detail = detail.trim_end_matches('.');
                return (
                    RayuErrorKind::TeamPoolExhausted,
                    format!("{detail} (HTTP 429).{reset}"),
                );
            }
            let wait = reset_eta
                .as_deref()
                .map(|eta| format!(" Retry {eta}"))
                .unwrap_or_else(|| " Please wait a moment and retry".to_string());
            if lower_msg.contains("model provider is rate limiting") || raw_msg.is_empty() {
                (
                    RayuErrorKind::ProviderRateLimited,
                    format!(
                        "The model provider is rate limiting requests right now (HTTP 429).{wait}, or switch models with /model."
                    ),
                )
            } else {
                let detail = sanitize_inline(raw_msg, 180);
                let detail = detail.trim_end_matches('.');
                (
                    RayuErrorKind::ProviderRateLimited,
                    format!("Rayu rate limit exceeded (HTTP 429): {detail}.{wait}."),
                )
            }
        }
    }
}

fn classify_and_format_sse(
    parsed: &ParsedRayuError,
    raw_data: &str,
    model: Option<&str>,
) -> (RayuErrorKind, String) {
    let raw_msg = parsed.message.as_deref().map(str::trim).unwrap_or("");
    let err_type = parsed.error_type.as_deref().map(str::trim).unwrap_or("");

    if let Some(classified) = format_custom_or_capability_notice(parsed, raw_msg, model, None) {
        return classified;
    }

    if err_type == "provider_unavailable" {
        return high_volume_provider_unavailable(None);
    }

    if err_type == "overloaded_error" {
        let detail = fallback_detail(raw_msg, "Overloaded");
        return (
            RayuErrorKind::ProviderUnavailable,
            format!(
                "Rayu gateway stream error (overloaded): {detail}. Please wait a moment or switch to a different model with /model."
            ),
        );
    }

    // Preserve `UPSTREAM_ENDED_UNEXPECTEDLY` phrasing verbatim so the mid-stream
    // replay layer (`retry.rs`) detects and replays it cleanly.
    let detail = if !raw_msg.is_empty() {
        sanitize_inline(raw_msg, 220)
    } else {
        sanitize_inline(raw_data, 220)
    };
    let kind = if err_type == "invalid_request_error" {
        RayuErrorKind::InvalidRequest
    } else if err_type == "authentication_error" {
        RayuErrorKind::Unauthorized
    } else {
        RayuErrorKind::ProviderUnavailable
    };
    (kind, format!("Rayu gateway stream error: {detail}"))
}

fn non_empty_str(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn extract_message_field(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    // NestJS validation pipes return `{"message": ["field must be ..."]}`.
    if let Some(items) = value.as_array() {
        let parts: Vec<&str> = items
            .iter()
            .filter_map(|item| item.as_str().map(str::trim).filter(|s| !s.is_empty()))
            .collect();
        if !parts.is_empty() {
            return Some(parts.join("; "));
        }
    }
    None
}

fn extract_legacy_credit_limit_reason(message: &str) -> Option<String> {
    let lower = message.to_ascii_lowercase();
    let idx = lower.find("credit limit reached:")?;
    let rest = message[idx + "credit limit reached:".len()..].trim();
    let token: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    (!token.is_empty()).then(|| token.to_ascii_lowercase())
}

fn looks_like_html_error_page(trimmed: &str) -> bool {
    let head: String = trimmed.chars().take(512).collect();
    let lower = head.to_ascii_lowercase();
    lower.starts_with("<!doctype html")
        || lower.starts_with("<html")
        || (lower.contains("<title>") && lower.contains("cloudflare"))
}

fn strip_prefix_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    if text.len() < prefix.len() {
        return None;
    }
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| text[prefix.len()..].trim())
}

fn extract_colon_suffix(text: &str) -> Option<&str> {
    text.split_once(':')
        .map(|(_, suffix)| suffix.trim())
        .filter(|s| !s.is_empty())
}

fn model_label(model: Option<&str>) -> String {
    model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|m| format!("\"{}\"", sanitize_inline(m, 80)))
        .unwrap_or_else(|| "this model".to_string())
}

fn fallback_detail(raw_msg: &str, default: &str) -> String {
    let clean = sanitize_inline(raw_msg, 180);
    if clean.is_empty() {
        default.to_string()
    } else {
        clean
    }
}

fn sanitize_text_clean(raw: &str) -> String {
    let stripped = strip_ansi_sequences(raw);
    let mut out = String::with_capacity(stripped.len());
    let mut prev_space = true;
    for ch in stripped.chars() {
        let code = ch as u32;
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
            continue;
        }
        // Drop C0 (0x00..=0x1F) and DEL + C1 (0x7F..=0x9F).
        if code <= 0x1F || (0x7F..=0x9F).contains(&code) {
            continue;
        }
        out.push(ch);
        prev_space = false;
    }
    out.trim().to_string()
}

fn sanitize_inline(raw: &str, max_chars: usize) -> String {
    let cleaned = sanitize_text_clean(raw);
    if cleaned.chars().count() <= max_chars {
        return cleaned;
    }
    crate::util::truncate_str(&cleaned, max_chars).to_string()
}

/// Strip ANSI CSI (`\x1b[...X`), OSC (`\x1b]...(\x07|\x1b\\)`), and 2-byte ESC sequences.
fn strip_ansi_sequences(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    // CSI parameters (0x30..=0x3F), intermediates (0x20..=0x2F), final (0x40..=0x7E).
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC terminated by BEL (\x07) or ST (\x1b\\).
                    while let Some(c) = chars.next() {
                        if c == '\x07' {
                            break;
                        }
                        if c == '\x1b' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn format_compact_number(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if (rounded - rounded.round()).abs() < 1e-6 {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{rounded:.2}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(auth: RayuAuthKind) -> RayuErrorContext<'static> {
        RayuErrorContext {
            auth,
            model: Some("deepseek-v4.1"),
            request_id: Some("rv2_test123"),
        }
    }

    #[test]
    fn auth_kind_distinguishes_api_key_from_jwt() {
        let live_key = format!("{GATEWAY_API_KEY_PREFIX}live_placeholder");
        let test_key = format!("{GATEWAY_API_KEY_PREFIX}test_placeholder");
        assert_eq!(
            RayuAuthKind::from_credential(&live_key), // ggignore
            RayuAuthKind::ApiKey
        );
        assert_eq!(
            RayuAuthKind::from_credential(&test_key), // ggignore
            RayuAuthKind::ApiKey
        );
        assert_eq!(
            RayuAuthKind::from_credential("session-jwt-placeholder"), // ggignore
            RayuAuthKind::AccountJwt
        );
        assert_eq!(RayuAuthKind::from_credential("   "), RayuAuthKind::Unknown);
    }

    #[test]
    fn account_wide_and_self_contained_predicates_match_gateway_semantics() {
        // Per-model 403 and temporary billing-config 503 must NOT block sibling Rayu models.
        assert!(!is_rayu_account_wide_failure(
            "Your Rayu API key does not have access to \"claude-opus-4-6\" (HTTP 403). Update key model scope at https://rayucode.com/dashboard/api-keys, or run /model."
        ));
        assert!(!is_rayu_account_wide_failure(
            "\"claude-opus-4-6\" is not available on your current Rayu plan (HTTP 403). Upgrade at https://rayucode.com/plans, or run /model."
        ));
        assert!(!is_rayu_account_wide_failure(
            "Billing configuration is unavailable. No credits were charged. Please retry shortly. (HTTP 503)"
        ));
        assert!(!is_rayu_account_wide_failure(
            "Too many concurrent requests for this account (HTTP 429) — this is a concurrency limit, not your credit balance."
        ));
        assert!(!is_rayu_account_wide_failure(
            "Model \"deepseek-v4.1\" cannot read images (HTTP 400; switch models with /model)"
        ));

        // Account-wide failures MUST exclude sibling Rayu models on the same broken credential/quota.
        assert!(is_rayu_account_wide_failure(
            "Rayu API key rejected (HTTP 401): invalid, revoked, or expired key."
        ));
        assert!(is_rayu_account_wide_failure(
            "Your team has no active credit plan (HTTP 402). Purchase a team plan to continue: https://rayucode.com/plans"
        ));
        assert!(is_rayu_account_wide_failure(
            "Your Rayu account is suspended (HTTP 403). Visit https://rayucode.com/dashboard or contact support."
        ));
        assert!(is_rayu_account_wide_failure(
            "You've reached your plan's credit limit for this billing period (HTTP 429)."
        ));
        assert!(is_rayu_account_wide_failure(
            "You've reached your plan's daily turn limit (HTTP 429). It resets in about 5 hours."
        ));
        assert!(is_rayu_account_wide_failure(
            "You've used this weekly credit allowance (HTTP 429)."
        ));
        assert!(is_rayu_account_wide_failure(
            "Rayu API key credit limit (50 credits) reached for this billing period (HTTP 429)."
        ));

        // Self-contained Rayu guidance must suppress bogus "Run /fix to attempt recovery."
        assert!(is_self_contained_rayu_guidance(
            "Your Rayu account is suspended (HTTP 403). Visit https://rayucode.com/dashboard or contact support."
        ));
        assert!(is_self_contained_rayu_guidance(
            "Rayu API key rejected (HTTP 401): check https://rayucode.com/dashboard/api-keys, then run /login rayu-api."
        ));
        assert!(is_self_contained_rayu_guidance(
            "Maintenance active. Please wait a moment or switch to a different model with /model. (HTTP 503)"
        ));
        assert!(is_self_contained_rayu_guidance(
            "Rayu authentication is temporarily unavailable (HTTP 503). Please retry shortly."
        ));
        assert!(!is_self_contained_rayu_guidance(
            "unexpected malformed tool_use block in conversation history"
        ));
        // Arbitrary prose containing "account is " must not falsely trigger account-wide lockout.
        assert!(!is_rayu_account_wide_failure(
            "The upstream provider account is temporarily overloaded."
        ));

        // Custom RAYU_WEB_URL must still classify generated guidance as self-contained.
        let _env = super::super::test_support::RayuTestEnv::new();
        crate::env::set_var("RAYU_WEB_URL", "https://staging.rayu.example");
        let custom_web_err = RayuGatewayError::from_http_response(
            402,
            r#"{"error":{"message":"This team has no credit until you buy a team plan.","type":"team_plan_required"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert!(
            custom_web_err.message.contains("https://staging.rayu.example/plans"),
            "{}",
            custom_web_err.message
        );
        assert!(is_self_contained_rayu_guidance(&custom_web_err.message));

        // Capability messages sanitize ANSI sequences and fallback 429/500 avoid double periods.
        let cap_ansi = RayuGatewayError::from_http_response(
            400,
            "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"\\u001b[31mNo images\\u001b[0m\",\"rayu_code\":\"model_no_image_support\"}}",
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert!(!cap_ansi.message.contains('\x1b'));
        assert!(cap_ansi.message.contains("No images"));

        let err_500 = RayuGatewayError::from_http_response(
            500,
            r#"{"error":{"message":"rate limiter unavailable."}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert!(!err_500.message.contains(".."), "{}", err_500.message);
    }

    #[test]
    fn maps_every_gateway_401_402_403_auth_and_plan_contract() {
        let _env = super::super::test_support::RayuTestEnv::new();

        // API key 401
        let err = RayuGatewayError::from_http_response(
            401,
            r#"{"error":{"message":"invalid API key","type":"authentication_error"}}"#,
            None,
            None,
            ctx(RayuAuthKind::ApiKey),
        );
        assert_eq!(err.kind, RayuErrorKind::Unauthorized);
        assert!(err.is_unauthorized());
        assert!(err.message.contains("API key rejected"));
        assert!(err.message.contains("/login rayu-api"));
        assert!(err.message.contains("/dashboard/api-keys"));

        // JWT missing bearer token
        let err = RayuGatewayError::from_http_response(
            401,
            r#"{"error":{"message":"missing bearer token","type":"authentication_error"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::Unauthorized);
        assert!(err.message.contains("missing bearer token"));
        assert!(err.message.contains("/login rayu"));

        // JWT expired/invalid token
        let err = RayuGatewayError::from_http_response(
            401,
            r#"{"error":{"message":"invalid token","type":"authentication_error"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::Unauthorized);
        assert!(err.message.contains("session expired"));
        assert!(err.message.contains("/login rayu"));

        // 402 team_plan_required
        let err = RayuGatewayError::from_http_response(
            402,
            r#"{"error":{"message":"This team has no credit until you buy a team plan.","type":"team_plan_required"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::TeamPlanRequired);
        assert!(err.message.contains("HTTP 402"));
        assert!(err.message.contains("/plans"));

        // 403 account suspended
        let err = RayuGatewayError::from_http_response(
            403,
            r#"{"error":{"message":"account is suspended","type":"permission_error"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::AccountInactive);
        assert!(err.message.contains("suspended"));
        assert!(err.message.contains("/dashboard"));

        // 403 API key model scope restriction (must point to api-keys, NOT /plans)
        let err = RayuGatewayError::from_http_response(
            403,
            r#"{"error":{"message":"model not allowed for this API key: claude-opus-4-6","type":"permission_error"}}"#,
            None,
            None,
            ctx(RayuAuthKind::ApiKey),
        );
        assert_eq!(err.kind, RayuErrorKind::ApiKeyModelNotAllowed);
        assert!(err.message.contains("claude-opus-4-6"));
        assert!(err.message.contains("/dashboard/api-keys"));
        assert!(!err.message.contains("/plans"));

        // 403 plan gate (must point to /plans, NOT api-keys)
        let err = RayuGatewayError::from_http_response(
            403,
            r#"{"error":{"message":"model not available on your plan: claude-opus-4-6","type":"permission_error"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::PlanModelNotAvailable);
        assert!(err.message.contains("claude-opus-4-6"));
        assert!(err.message.contains("/plans"));
    }

    #[test]
    fn maps_every_gateway_429_limit_pacing_and_api_key_cap_contract() {
        let _env = super::super::test_support::RayuTestEnv::new();

        // Concurrency denial must NOT read as a credit limit
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"too many concurrent requests","type":"rate_limit_exceeded"},"reason":"concurrency","transient":true}"#,
            Some("concurrency"),
            Some(2),
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::TransientCapacity);
        assert!(err.message.contains("concurrency limit"));
        assert!(err.message.contains("not your credit balance"));

        // Personal period_limit
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"credit limit reached: period_limit","type":"rate_limit_exceeded"},"reason":"period_limit","transient":false,"resetSeconds":259200}"#,
            Some("period_limit"),
            Some(259200),
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::CreditLimitReached);
        assert!(err.message.contains("in about 3 days"));
        assert!(err.message.contains("/plans"));

        // Team pool_limit
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"your team's credit pool is exhausted","type":"rate_limit_exceeded"},"reason":"pool_limit","transient":false,"resetSeconds":7200,"scope":"team"}"#,
            Some("pool_limit"),
            Some(7200),
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::TeamPoolExhausted);
        assert!(err.message.contains("team admin"));
        assert!(err.message.contains("in about 2 hours"));

        // Daily turn limit
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"daily turn limit reached","type":"rate_limit_exceeded"},"reason":"daily_turn_limit","resetSeconds":18000}"#,
            Some("daily_turn_limit"),
            Some(18000),
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::DailyTurnLimit);
        assert!(err.message.contains("daily turn limit"));
        assert!(err.message.contains("in about 5 hours"));

        // Personal weekly_limit names the switch AND its one-way caveat
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"you've used this week's credit allowance","type":"rate_limit_exceeded"},"reason":"weekly_limit","transient":false,"resetSeconds":172800}"#,
            Some("weekly_limit"),
            Some(172800),
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::PacingWindowLimit);
        assert!(err.message.contains("use all credits"));
        assert!(err.message.contains("one-way until weekly reset"));
        assert!(err.message.contains("in about 2 days"));

        // Team session_window_limit points at the team admin, NOT the personal switch
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"you've used your share","type":"rate_limit_exceeded"},"reason":"session_window_limit","transient":false,"resetSeconds":7200,"scope":"team"}"#,
            Some("session_window_limit"),
            Some(7200),
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::PacingWindowLimit);
        assert!(err.message.contains("team admin"));
        assert!(!err.message.contains("use all credits"));

        // API key RPM limit
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"API key rate limit exceeded","type":"rate_limit_exceeded"},"reason":"api_key_rpm_limit","resetSeconds":60}"#,
            None,
            Some(60),
            ctx(RayuAuthKind::ApiKey),
        );
        assert_eq!(err.kind, RayuErrorKind::ApiKeyRpmLimit);
        assert!(err.message.contains("API key rate limit"));
        assert!(err.message.contains("in about 1 minute"));
        assert!(err.message.contains("/dashboard/api-keys"));

        // API key billing-period credit cap
        let err = RayuGatewayError::from_http_response(
            429,
            r#"{"error":{"message":"API key credit limit reached for this billing period","type":"rate_limit_exceeded"},"reason":"api_key_credit_limit","creditLimit":50}"#,
            None,
            Some(3600),
            ctx(RayuAuthKind::ApiKey),
        );
        assert_eq!(err.kind, RayuErrorKind::ApiKeyCreditLimit);
        assert!(err.message.contains("50 credits"));
        assert!(err.message.contains("/dashboard/api-keys"));
    }

    #[test]
    fn maps_custom_messages_capability_codes_cloudflare_and_sse_errors() {
        let _env = super::super::test_support::RayuTestEnv::new();

        // Admin custom model notice with ANSI escapes must be sanitized
        let err = RayuGatewayError::from_http_response(
            503,
            "{\"type\":\"error\",\"error\":{\"type\":\"provider_unavailable\",\"message\":\"\\u001b[31mScheduled   maintenance\\u0007 until 18:00 UTC.\\u001b[0m\",\"rayu_custom\":true}}",
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(err.kind, RayuErrorKind::CustomModelNotice);
        assert!(err.message.contains("Scheduled maintenance until 18:00 UTC."));
        assert!(!err.message.contains('\x1b'));
        assert!(!err.message.contains('\x07'));
        assert!(err.message.contains("/model"));

        // Capability codes
        let img = RayuGatewayError::from_http_response(
            400,
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"Model \"deepseek-v4.1\" cannot read images.","rayu_code":"model_no_image_support"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(img.kind, RayuErrorKind::ModelCapabilityUnsupported);
        assert!(img.message.contains("cannot read images"));
        assert!(img.message.contains("/model"));

        let think = RayuGatewayError::from_http_response(
            400,
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"Model \"fast-mini\" does not support extended thinking.","rayu_code":"model_no_thinking_support"}}"#,
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(think.kind, RayuErrorKind::ModelCapabilityUnsupported);
        assert!(think.message.contains("extended thinking"));

        // Cloudflare HTML 502 must never leak raw HTML
        let cf = RayuGatewayError::from_http_response(
            502,
            "<!DOCTYPE html><html><head><title>502 Bad Gateway | Cloudflare</title></head><body><h1>Bad gateway</h1></body></html>",
            None,
            None,
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(cf.kind, RayuErrorKind::ProviderUnavailable);
        assert!(!cf.message.contains("<html"));
        assert!(cf.message.contains("high volume"));

        // Auth DB outage 503 must not read like an invalid key
        let auth_outage = RayuGatewayError::from_http_response(
            503,
            r#"{"error":{"type":"provider_unavailable","message":"Too many requests. Please retry shortly."},"reason":"authentication_unavailable"}"#,
            None,
            Some(1),
            ctx(RayuAuthKind::ApiKey),
        );
        assert_eq!(auth_outage.kind, RayuErrorKind::TransientCapacity);
        assert!(auth_outage.message.contains("authentication is temporarily unavailable"));

        // Billing configuration unavailable 503 keeps exact reassurance
        let billing = RayuGatewayError::from_http_response(
            503,
            r#"{"error":{"message":"Billing configuration is unavailable. No credits were charged. Please retry shortly.","type":"api_error"}}"#,
            None,
            Some(5),
            ctx(RayuAuthKind::AccountJwt),
        );
        assert_eq!(billing.kind, RayuErrorKind::GatewayTemporaryUnavailable);
        assert!(billing.message.contains("No credits were charged"));

        // SSE mid-stream custom error & upstream drop
        let sse_custom = RayuGatewayError::from_sse_error_data(
            r#"{"type":"error","error":{"type":"provider_unavailable","message":"Upstream rebooting","rayu_custom":true}}"#,
            Some("deepseek-v4.1"),
        );
        assert_eq!(sse_custom.kind, RayuErrorKind::CustomModelNotice);
        assert!(sse_custom.message.contains("Upstream rebooting"));

        let sse_drop = RayuGatewayError::from_sse_error_data(
            r#"{"type":"error","error":{"type":"api_error","message":"The model provider ended the response unexpectedly."}}"#,
            Some("deepseek-v4.1"),
        );
        assert!(sse_drop.message.contains("ended the response unexpectedly"));

        // UUID request_id or model ID containing 401/402/403 must NOT falsely mark
        // a transient 503/429 as an account-wide failure.
        assert!(!is_rayu_account_wide_failure(
            "Model \"glm-403\" is temporarily unavailable (HTTP 503). Please wait a moment or switch models with /model.\n  request_id: rc-123e4567-e89b-403a-401f-402000000000"
        ));
        assert!(!is_rayu_account_wide_failure(
            "The model provider is rate limiting requests right now (HTTP 429).\n  request_id: rc-401-402-403"
        ));
        assert!(is_rayu_account_wide_failure(
            "Rayu request failed (HTTP 401): invalid token"
        ));
        assert!(is_self_contained_rayu_guidance(
            "Request body too large (HTTP 413: request body too large). Run /compact or remove large attachments and retry."
        ));
    }
}
