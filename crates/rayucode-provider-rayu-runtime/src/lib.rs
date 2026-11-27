//! Rayu (RayuCode) hosted-model provider over direct HTTPS.
//!
//! Chat goes to the Rayu gateway's Anthropic Messages surface
//! (`{gateway_base()}/anthropic/v1/messages`) with a Bearer credential from
//! [`rayucode_base::rayu::gateway_credential`] — the signed-in JWT wins over
//! `RAYU_API_KEY`. Requests carry `anthropic-version` and `x-rayu-client: cli`
//! and NEVER `x-api-key`; redirects are rejected so a credential can never be
//! moved off the vetted gateway URL. Model ids on the wire are BARE (the
//! `rayu:` routing prefix is stripped before sending).
//!
//! Request shaping reuses [`rayucode_provider_anthropic`] (format_messages /
//! format_tools / build_system_param); the SSE parser is this crate's own
//! compact implementation ([`sse`]). A 401 before any model output triggers a
//! single token refresh and replay (the grok-build `AuthRetryStream` pattern).
//!
//! The model catalog is LIVE ([`catalog`]): JWT sessions fetch
//! `/me/entitlements`, API keys fetch the gateway's `/v1/models`. The small
//! static array in `catalog` is an offline fallback only, never an allowlist.

mod catalog;
mod retry;
mod sse;

pub use catalog::{CatalogRoute, RayuCatalogModel, small_fast_model_for};

use anyhow::{Context, Result, bail};
use async_trait::async_trait;
use futures::{Stream, StreamExt};
use rayucode_message_types::{Message, StreamEvent, ToolDefinition};
use rayucode_provider_anthropic::{
    ApiOutputConfig, ApiRequest, ApiThinking, attach_tool_thought_signatures,
    build_system_param_split, format_messages, format_messages_with_identity, format_tools,
    request_tools,
};
use rayucode_provider_core::{
    EventStream, ModelCatalogRefreshSummary, ModelRoute, Provider, summarize_model_catalog_refresh,
};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::task::{Context as TaskContext, Poll};
use std::time::Duration;

/// Routing prefix for Rayu model specs (`rayu:<model>`). Wire ids are bare.
pub const RAYU_ROUTE_PREFIX: &str = "rayu";

const ROUTE_PREFIX_COLON: &str = "rayu:";

/// Per-attempt id for one physical HTTP request (Node client parity).
const REQUEST_ID_HEADER: &str = "x-rayu-request-id";
/// Stable id shared by every attempt of one logical request.
const LOGICAL_REQUEST_ID_HEADER: &str = "x-rayu-logical-request-id";
/// Logical origin of the request, logged by the gateway as `source=`.
const QUERY_SOURCE_HEADER: &str = "x-rayu-query-source";
const QUERY_SOURCE: &str = "rayucode_v2_agent";
/// Stable session id for gateway cache-sticky provider key selection and `prompt_cache_key`.
const SESSION_ID_HEADER: &str = "x-rayu-session-id";
/// Intended Rayu model code, logged by the gateway for routing observability.
const INTENDED_MODEL_HEADER: &str = "x-rayu-intended-model";
/// Model code placed on the wire, matched by the gateway against `intended`.
const RESOLVED_MODEL_HEADER: &str = "x-rayu-resolved-model";
/// Client app version hint read by gateway middleware (`CLIENT_CONTEXT.md`).
const CLIENT_APP_VERSION_HEADER: &str = "x-rayu-client-app-version";

fn new_request_id() -> String {
    format!("rv2_{}", uuid::Uuid::new_v4().simple())
}

/// Rayu hosted-model runtime. Rides a registry profile like grok-build; there
/// is no dedicated `ActiveProvider` variant.
#[derive(Clone)]
pub struct RayuProvider {
    model: Arc<Mutex<String>>,
    catalog: Arc<catalog::CatalogCache>,
    reasoning_effort: Arc<Mutex<Option<String>>>,
    session_id: Arc<Mutex<Option<String>>>,
}

impl RayuProvider {
    pub fn new() -> Self {
        let catalog = Arc::new(catalog::CatalogCache::default());
        // Synchronous cold start: best-known disk catalog for the current
        // endpoint, else the documented offline fallback. Prefetch replaces
        // this with the live catalog.
        let initial = catalog.best_known();
        let model =
            catalog::default_model_for(initial.route, &initial.models).unwrap_or_else(String::new);
        Self {
            model: Arc::new(Mutex::new(model)),
            catalog,
            reasoning_effort: Arc::new(Mutex::new(None)),
            session_id: Arc::new(Mutex::new(None)),
        }
    }

    /// Whether any Rayu credential (usable session or API key) is configured.
    pub fn has_credentials() -> bool {
        rayucode_base::rayu::has_credentials()
    }

    fn lock_model(&self) -> std::sync::MutexGuard<'_, String> {
        self.model
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_effort(&self) -> std::sync::MutexGuard<'_, Option<String>> {
        self.reasoning_effort
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_session_id(&self) -> std::sync::MutexGuard<'_, Option<String>> {
        self.session_id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn catalog_entry_for(&self, model: &str) -> Option<catalog::RayuCatalogModel> {
        self.catalog
            .best_known()
            .models
            .into_iter()
            .find(|row| row.id == model)
    }

    /// Keep the user's selected model while it still exists in the catalog;
    /// otherwise apply the route's default-model rule (TS parity).
    fn apply_default_model(&self) {
        let catalog = self.catalog.best_known();
        let mut model = self.lock_model();
        let in_catalog = catalog.models.iter().any(|row| row.id == *model);
        if !in_catalog
            && let Some(default) = catalog::default_model_for(catalog.route, &catalog.models)
        {
            *model = default;
        }
    }

    async fn complete_once(
        &self,
        credential: &str,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_static: &str,
        system_dynamic: &str,
        logical_request_id: &str,
    ) -> Result<EventStream> {
        let model = self.model();
        let url = format!(
            "{}/anthropic/v1/messages",
            rayucode_base::rayu::gateway_base()
        );
        ensure_safe_bearer_endpoint(&url)?;

        let catalog_entry = self.catalog_entry_for(&model);
        let supports_reasoning = catalog_entry.as_ref().and_then(|e| e.supports_reasoning);
        let supports_tools = catalog_entry.as_ref().and_then(|e| e.supports_tools);
        let max_tokens = rayu_max_output_tokens(
            &model,
            catalog_entry.as_ref().and_then(|e| e.max_output_tokens),
        );
        let stored_effort = self.lock_effort().clone();
        let (thinking, output_config) = build_thinking_and_effort(
            &model,
            stored_effort.as_deref(),
            supports_reasoning,
            max_tokens,
        );

        let cache_ttl_1h = rayucode_base::provider::anthropic::is_cache_ttl_1h()
            && model.to_ascii_lowercase().contains("claude");
        let mut api_messages = format_messages(messages, false);
        attach_tool_thought_signatures(&mut api_messages, messages);
        let api_messages = format_messages_with_identity(api_messages, false, cache_ttl_1h);
        let api_tools = if supports_tools == Some(false) {
            None
        } else {
            request_tools(format_tools(tools, false, cache_ttl_1h), Vec::new())
        };

        let request = ApiRequest {
            model: model.clone(),
            max_tokens,
            system: build_system_param_split(system_static, system_dynamic, false, cache_ttl_1h),
            messages: api_messages,
            tools: api_tools,
            metadata: None,
            thinking,
            output_config,
            temperature: None,
            service_tier: None,
            stream: true,
        };
        // A fresh id per physical attempt; the logical id stays fixed across
        // 401 refreshes and transport replays so gateway logs group them.
        let request_id = new_request_id();
        let idle_timeout =
            rayucode_base::provider::stream_idle_timeout_for_effort(stored_effort.as_deref());
        let mut req_builder = http_client()
            .post(&url)
            .bearer_auth(credential)
            .header(
                "anthropic-version",
                rayucode_base::provider_catalog::ANTHROPIC_VERSION_HEADER_VALUE,
            )
            .header("x-rayu-client", rayucode_base::rayu::client_product())
            .header(CLIENT_APP_VERSION_HEADER, env!("CARGO_PKG_VERSION"))
            .header(REQUEST_ID_HEADER, &request_id)
            .header(LOGICAL_REQUEST_ID_HEADER, logical_request_id)
            .header(QUERY_SOURCE_HEADER, QUERY_SOURCE)
            .header(INTENDED_MODEL_HEADER, &model)
            .header(RESOLVED_MODEL_HEADER, &model);
        if let Some(session_id) = self.lock_session_id().clone().filter(|s| !s.is_empty()) {
            req_builder = req_builder.header(SESSION_ID_HEADER, session_id);
        }
        let response = rayucode_provider_core::transport::send_with_initial_response_timeout(
            req_builder.json(&request),
            idle_timeout,
        )
        .await
        .with_context(|| {
            format!(
                "Failed to send Rayu gateway request\n  endpoint: {url}\n  request_id: {request_id}"
            )
        })?;
        let status = response.status();
        if !status.is_success() {
            // Captured before the body is consumed: the gateway queues a burst
            // and only answers 429/503 once capacity did not free in time, with
            // the wait it expects in `Retry-After` and the machine-readable
            // denial tag in `X-Rayu-Limit`.
            let retry_after = rayucode_provider_core::retry_after::retry_after(response.headers());
            let retry_after_secs = retry_after
                .map(|r| {
                    let d = r.remaining();
                    let secs = d.as_secs().saturating_add(u64::from(d.subsec_nanos() > 0));
                    secs.min(i64::MAX as u64) as i64
                })
                .filter(|&s| s > 0);
            let limit_header = rayucode_base::rayu::extract_rayu_limit_header(response.headers());
            let should_retry = response
                .headers()
                .get("x-should-retry")
                .and_then(|v| v.to_str().ok())
                .is_none_or(|v| !v.eq_ignore_ascii_case("false"));
            let body = rayucode_provider_core::http_error_body(response, "Rayu gateway").await;
            rayucode_base::logging::warn(&format!(
                "Rayu gateway request failed (HTTP {status}, endpoint={url}, request_id={request_id}, x_rayu_limit={limit_header:?}, retry_after={retry_after_secs:?}, should_retry={should_retry}): {}",
                rayucode_base::util::truncate_str(body.trim(), 600)
            ));
            let gateway_error = rayucode_base::rayu::RayuGatewayError::from_http_response(
                status.as_u16(),
                &body,
                limit_header.as_deref(),
                retry_after_secs,
                rayucode_base::rayu::RayuErrorContext {
                    auth: rayucode_base::rayu::RayuAuthKind::from_credential(credential),
                    model: Some(&model),
                    request_id: Some(&request_id),
                },
            );
            if should_retry
                && retry::is_transient_capacity_for_parsed(
                    status.as_u16(),
                    &gateway_error.parsed,
                    retry_after.map(|r| r.remaining()),
                )
            {
                return Err(retry::CapacityError::new(gateway_error.to_string(), retry_after).into());
            }
            return Err(gateway_error.into());
        }
        let trace = sse::ResponseTrace::from_response(&response, request_id);
        rayucode_base::logging::debug(&format!("Rayu gateway stream opened: {}", trace.describe()));
        Ok(sse::stream_events(response, trace, idle_timeout, Some(model)))
    }

    /// One full attempt: send, and on a 401 before output refresh the JWT and
    /// replay once.
    async fn open_attempt(
        &self,
        messages: Arc<Vec<Message>>,
        tools: Arc<Vec<ToolDefinition>>,
        system_static: Arc<String>,
        system_dynamic: Arc<String>,
        logical_request_id: Arc<String>,
    ) -> Result<EventStream> {
        let credential = rayucode_base::rayu::gateway_credential()
            .await
            .context("No Rayu credentials available: sign in with /login rayu or set RAYU_API_KEY")?;
        let auth_kind = rayucode_base::rayu::RayuAuthKind::from_credential(&credential);
        let first = self
            .complete_once(
                &credential,
                &messages,
                &tools,
                &system_static,
                &system_dynamic,
                &logical_request_id,
            )
            .await;
        // Only a JWT session can be refreshed; an API-key 401 surfaces as-is.
        if auth_kind != rayucode_base::rayu::RayuAuthKind::AccountJwt
            || !rayucode_base::rayu::has_usable_session()
        {
            return first;
        }
        let provider = self.clone();
        let retry = move || -> RetryFuture {
            Box::pin(async move {
                let Some(fresh) =
                    rayucode_base::rayu::refresh_access_token(Some(&credential)).await
                else {
                    if !rayucode_base::rayu::has_usable_session() {
                        // Refresh token was definitively rejected (400/401) and cleared.
                        return Err(rayucode_base::rayu::RayuGatewayError::session_expired(
                            "Your Rayu session has expired (HTTP 401). Sign in again with /login rayu.",
                        )
                        .into());
                    }
                    // Session file survived -> renewal failed due to a transient backend
                    // or network error. Do not misreport it as an expired session.
                    bail!(
                        "Could not renew your Rayu session (account service temporarily unreachable). Check your connection and try again."
                    );
                };
                match provider
                    .complete_once(
                        &fresh,
                        &messages,
                        &tools,
                        &system_static,
                        &system_dynamic,
                        &logical_request_id,
                    )
                    .await
                {
                    Ok(stream) => Ok(stream),
                    Err(err)
                        if is_unauthorized_error(&err)
                            && rayucode_base::rayu::has_usable_session() =>
                    {
                        Err(rayucode_base::rayu::RayuGatewayError::session_expired(
                            "Rayu gateway rejected your renewed session (HTTP 401). Run /login rayu to sign in again; if this persists, the gateway may be misconfigured.",
                        )
                        .into())
                    }
                    Err(err) => Err(err),
                }
            })
        };
        let inner = match first {
            Ok(stream) => stream,
            // Already retried once: return the replayed stream as-is.
            Err(error) if is_unauthorized_error(&error) => return retry().await,
            Err(error) => return Err(error),
        };
        Ok(Box::pin(AuthRetryStream {
            inner,
            retry: Some(Box::new(retry)),
            pending: None,
            saw_output: false,
        }))
    }

    async fn complete_with_system(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_static: &str,
        system_dynamic: &str,
    ) -> Result<EventStream> {
        if self.model().trim().is_empty() {
            self.prefetch_models().await?;
            if self.model().trim().is_empty() {
                bail!(
                    "No Rayu models are available for your account or API key. Check your Rayu plan or API key model permissions."
                );
            }
        }
        let provider = self.clone();
        let messages = Arc::new(messages.to_vec());
        let tools = Arc::new(tools.to_vec());
        let system_static = Arc::new(system_static.to_string());
        let system_dynamic = Arc::new(system_dynamic.to_string());
        let logical_request_id = Arc::new(new_request_id());
        let open: retry::OpenFn = Arc::new(move || -> RetryFuture {
            let provider = provider.clone();
            let (messages, tools, system_static, system_dynamic, logical_request_id) = (
                Arc::clone(&messages),
                Arc::clone(&tools),
                Arc::clone(&system_static),
                Arc::clone(&system_dynamic),
                Arc::clone(&logical_request_id),
            );
            Box::pin(async move {
                provider
                    .open_attempt(
                        messages,
                        tools,
                        system_static,
                        system_dynamic,
                        logical_request_id,
                    )
                    .await
            })
        });
        let (inner, attempt) = retry::open_with_retry(&open).await?;
        Ok(retry::transport_retry_stream(inner, open, attempt))
    }
}

fn rayu_max_output_tokens(model: &str, catalog_max: Option<u32>) -> u32 {
    if let Some(tokens) = catalog_max.filter(|t| *t > 0) {
        return tokens;
    }
    let m = model.to_ascii_lowercase();
    if m.contains("deepseek-chat") && !m.contains("reason") {
        8_192
    } else if m.contains("claude-3-5-") || m.contains("claude-3.5-") {
        8_192
    } else if m.contains("claude-3-haiku")
        || m.contains("claude-3-sonnet")
        || m.contains("claude-3-opus")
    {
        4_096
    } else if m.contains("gpt-4o") || m.contains("gpt-4-turbo") {
        16_384
    } else if m.contains("claude-")
        || m.contains("gpt-5")
        || m.contains("gemini-2.5")
        || m.contains("gemini-3")
        || m.contains("deepseek-reason")
        || m.contains("deepseek-r1")
        || m.contains("deepseek-v4")
    {
        64_000
    } else {
        32_768
    }
}

fn normalize_rayu_effort(effort: &str) -> Option<&'static str> {
    match effort.trim().to_ascii_lowercase().as_str() {
        "none" | "off" | "disabled" => Some("none"),
        "minimal" => Some("minimal"),
        "low" => Some("low"),
        "medium" | "med" => Some("medium"),
        "high" => Some("high"),
        "xhigh" => Some("xhigh"),
        "max" => Some("max"),
        "swarm" => Some("swarm"),
        _ => None,
    }
}

fn build_thinking_and_effort(
    model: &str,
    stored_effort: Option<&str>,
    supports_reasoning: Option<bool>,
    max_tokens: u32,
) -> (Option<ApiThinking>, Option<ApiOutputConfig>) {
    if supports_reasoning == Some(false) {
        return (None, None);
    }
    let Some(raw) = stored_effort else {
        return (None, None);
    };
    let resolved = if raw.eq_ignore_ascii_case("swarm") {
        rayucode_base::prompt::swarm_root_reasoning_effort("swarm").unwrap_or("high")
    } else {
        raw
    };
    let Some(effort) = normalize_rayu_effort(resolved) else {
        return (None, None);
    };
    if effort == "none" {
        // Send only `thinking: {type: "disabled"}` (never `output_config.effort: "none"`,
        // which first-party Anthropic and Bedrock reject with HTTP 400). Every gateway
        // adapter recognizes `thinking.type == "disabled"` as explicit reasoning-off.
        return (Some(ApiThinking::Disabled), None);
    }

    let is_claude = model.to_ascii_lowercase().contains("claude-");
    if is_claude {
        let caps = rayucode_provider_core::anthropic_reasoning_caps(model);
        if caps.adaptive_thinking {
            let wire_effort = match effort {
                "minimal" => "low",
                "xhigh" if !caps.xhigh_effort => "high",
                "max" if !caps.max_effort => "high",
                other => other,
            };
            return (
                Some(ApiThinking::Adaptive {
                    display: Some("summarized"),
                    block_binding: None,
                }),
                Some(ApiOutputConfig {
                    effort: wire_effort.to_string(),
                }),
            );
        }
        let raw_budget: u32 = match effort {
            "minimal" => 1_024,
            "low" => 2_048,
            "medium" => 8_192,
            "high" => 16_384,
            "xhigh" => 24_576,
            "max" => 32_768,
            _ => 8_192,
        };
        let ceiling = max_tokens.saturating_sub(1_024).max(1_024);
        let budget_tokens = raw_budget.min(ceiling);
        let output_config = if caps.output_effort {
            let wire_effort = match effort {
                "minimal" => "low",
                "xhigh" if !caps.xhigh_effort => "high",
                "max" if !caps.max_effort => "high",
                other => other,
            };
            Some(ApiOutputConfig {
                effort: wire_effort.to_string(),
            })
        } else {
            None
        };
        return (Some(ApiThinking::Enabled { budget_tokens }), output_config);
    }

    let raw_budget: u32 = match effort {
        "minimal" => 1_024,
        "low" => 2_048,
        "medium" => 8_192,
        "high" => 16_384,
        "xhigh" => 24_576,
        "max" => 32_768,
        _ => 8_192,
    };
    // Anthropic/Bedrock/DeepSeek require `max_tokens > thinking.budget_tokens`.
    let ceiling = max_tokens.saturating_sub(1_024).max(1_024);
    let budget_tokens = raw_budget.min(ceiling);
    (
        Some(ApiThinking::Enabled { budget_tokens }),
        Some(ApiOutputConfig {
            effort: effort.to_string(),
        }),
    )
}

fn format_credit_multiplier(mult: f64) -> String {
    let rounded = (mult * 100.0).round() / 100.0;
    if (rounded - rounded.round()).abs() < 1e-6 {
        format!("{}", rounded.round() as i64)
    } else {
        let s = format!("{rounded:.2}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn format_context_tokens(ctx: u64) -> String {
    if ctx >= 1_000_000 {
        if ctx % 1_000_000 == 0 || (1_000_000..=1_060_000).contains(&ctx) {
            format!("{}M ctx", (ctx as f64 / 1_000_000.0).round() as u64)
        } else {
            let m = ctx as f64 / 1_000_000.0;
            let s = format!("{m:.1}");
            format!("{}M ctx", s.trim_end_matches(".0"))
        }
    } else if ctx >= 1_000 {
        format!("{}K ctx", ctx / 1_000)
    } else {
        format!("{ctx} ctx")
    }
}

/// Formats Rayu hosted model metadata to match `rayu-cli`
/// (e.g. `Credits x0.5(discount 30%) · rayu-hosted · DeepSeek-V4.1-flash:lastest · 1M ctx`).
fn format_rayu_route_detail(model: &catalog::RayuCatalogModel) -> String {
    let mut parts = Vec::new();
    if let Some(desc) = model
        .description
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        parts.push(desc.trim().to_string());
    } else if let Some(mult) = model.credit_multiplier.filter(|m| m.is_finite() && *m > 0.0) {
        parts.push(format!("Credits x{}", format_credit_multiplier(mult)));
    }
    parts.push("rayu-hosted".to_string());
    if let Some(label) = model.label.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(label.trim().to_string());
    }
    if let Some(ctx) = model
        .context_window
        .or(model.max_input_tokens)
        .filter(|w| *w > 0)
    {
        parts.push(format_context_tokens(ctx));
    }
    if model.supports_tools == Some(false) {
        parts.push("no tools".to_string());
    }
    let mut detail = parts.join(" · ");
    if !model.usable {
        detail.push_str(" (visible, not included in your plan)");
    }
    detail
}

impl Default for RayuProvider {
    fn default() -> Self {
        Self::new()
    }
}

fn normalize_model(model: &str) -> Option<&str> {
    let model = model.trim();
    let model = model
        .strip_prefix(ROUTE_PREFIX_COLON)
        .unwrap_or(model)
        .trim();
    (!model.is_empty()).then_some(model)
}

/// Shared HTTPS client for every Rayu request. Redirects are never followed
/// (`Policy::none()` returns the 3xx response, which the status check turns
/// into an error): following one could move the Bearer credential off the
/// vetted gateway/api host.
pub(crate) fn http_client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(rayucode_provider_core::RAYU_USER_AGENT)
                .connect_timeout(Duration::from_secs(15))
                .tcp_keepalive(Some(Duration::from_secs(30)))
                .http2_keep_alive_interval(Some(Duration::from_secs(30)))
                .http2_keep_alive_timeout(Duration::from_secs(15))
                .http2_keep_alive_while_idle(true)
                .pool_idle_timeout(Duration::from_secs(90))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
}

/// Defense in depth at the send boundary: `rayucode_base::rayu` already validates
/// endpoint overrides, but this crate re-checks before attaching any Bearer
/// credential — https anywhere, http only on loopback, never userinfo,
/// http(s) only.
pub(crate) fn ensure_safe_bearer_endpoint(url: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(url).context("Invalid Rayu endpoint URL")?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        // Never echo the URL here: it may embed a credential.
        bail!("Refusing to send Rayu credentials to an endpoint with embedded userinfo");
    }
    match parsed.scheme() {
        "https" => Ok(()),
        "http" => {
            let host = parsed.host_str().unwrap_or_default();
            // Url::host_str keeps the brackets on IPv6 literals.
            let host = host.trim_start_matches('[').trim_end_matches(']');
            let loopback = host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback());
            if loopback {
                Ok(())
            } else {
                bail!("Refusing to send Rayu credentials over plain http to a non-loopback host")
            }
        }
        _ => bail!("Refusing to send Rayu credentials over an unsupported URL scheme"),
    }
}

/// Whether an error means the Bearer credential was rejected.
fn is_unauthorized_text(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    text.contains("status: 401")
        || text.contains("http 401")
        || text.contains("authentication_error")
        || (text.contains("401")
            && (text.contains("unauthorized")
                || text.contains("unauthenticated")
                || text.contains("invalid or expired credentials")
                || text.contains("api key rejected")
                || text.contains("session expired")
                || text.contains("invalid token")
                || text.contains("invalid api key")
                || text.contains("missing bearer token")))
}

fn is_unauthorized_error(error: &anyhow::Error) -> bool {
    error
        .chain()
        .any(|e| {
            e.downcast_ref::<rayucode_base::rayu::RayuGatewayError>()
                .is_some_and(rayucode_base::rayu::RayuGatewayError::is_unauthorized)
        })
        || is_unauthorized_text(&format!("{error:#}"))
}

fn is_unauthorized_item(item: &Result<StreamEvent>) -> bool {
    match item {
        Err(error) => is_unauthorized_error(error),
        Ok(StreamEvent::Error { message, .. }) => is_unauthorized_text(message),
        _ => false,
    }
}

/// Emits the inner stream, but if the first error is a 401 before any model
/// output, forces a token refresh and replays the request once.
struct AuthRetryStream {
    inner: EventStream,
    retry: Option<Box<dyn FnOnce() -> RetryFuture + Send>>,
    pending: Option<RetryFuture>,
    saw_output: bool,
}

type RetryFuture = Pin<Box<dyn Future<Output = Result<EventStream>> + Send>>;

fn produces_output(event: &StreamEvent) -> bool {
    matches!(
        event,
        StreamEvent::TextDelta(_)
            | StreamEvent::TextSuffixReplace { .. }
            | StreamEvent::ThinkingDelta(_)
            | StreamEvent::ToolUseStart { .. }
            | StreamEvent::ToolInputDelta(_)
    )
}

impl Stream for AuthRetryStream {
    type Item = Result<StreamEvent>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        loop {
            if let Some(pending) = this.pending.as_mut() {
                match pending.as_mut().poll(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Ok(stream)) => {
                        this.pending = None;
                        this.inner = stream;
                    }
                    Poll::Ready(Err(error)) => {
                        this.pending = None;
                        return Poll::Ready(Some(Err(error)));
                    }
                }
            }
            match this.inner.poll_next_unpin(cx) {
                Poll::Ready(Some(item)) => {
                    if !this.saw_output
                        && is_unauthorized_item(&item)
                        && let Some(retry) = this.retry.take()
                    {
                        this.pending = Some(retry());
                        continue;
                    }
                    if let Ok(event) = &item
                        && produces_output(event)
                    {
                        this.saw_output = true;
                    }
                    return Poll::Ready(Some(item));
                }
                other => return other,
            }
        }
    }
}

#[async_trait]
impl Provider for RayuProvider {
    fn set_session_id(&self, session_id: &str) {
        let trimmed = session_id.trim();
        *self.lock_session_id() = (!trimmed.is_empty()).then(|| trimmed.to_string());
    }

    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        self.complete_with_system(messages, tools, system, "").await
    }

    async fn complete_split(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system_static: &str,
        system_dynamic: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        self.complete_with_system(messages, tools, system_static, system_dynamic)
            .await
    }

    fn name(&self) -> &str {
        "rayu"
    }

    fn display_name(&self) -> String {
        rayucode_base::rayu::RAYU_PROVIDER_DISPLAY_NAME.to_string()
    }

    fn model(&self) -> String {
        self.lock_model().clone()
    }

    fn set_model(&self, model: &str) -> Result<()> {
        let Some(model) = normalize_model(model) else {
            bail!("Rayu model cannot be empty");
        };
        *self.lock_model() = model.to_string();
        if self
            .catalog_entry_for(model)
            .and_then(|e| e.supports_reasoning)
            == Some(false)
        {
            *self.lock_effort() = None;
        }
        Ok(())
    }

    fn reasoning_effort(&self) -> Option<String> {
        self.lock_effort().clone()
    }

    fn set_reasoning_effort(&self, effort: &str) -> Result<()> {
        let model = self.model();
        if self
            .catalog_entry_for(&model)
            .and_then(|e| e.supports_reasoning)
            == Some(false)
        {
            bail!("Model '{model}' does not support reasoning effort");
        }
        let Some(canonical) = normalize_rayu_effort(effort) else {
            bail!(
                "Invalid reasoning effort '{}'. Supported values: {}",
                effort,
                self.available_efforts().join(", ")
            );
        };
        *self.lock_effort() = Some(canonical.to_string());
        Ok(())
    }

    fn available_efforts(&self) -> Vec<&'static str> {
        let model = self.model();
        if self
            .catalog_entry_for(&model)
            .and_then(|e| e.supports_reasoning)
            == Some(false)
        {
            return Vec::new();
        }
        rayucode_provider_core::reasoning::RAYU_SELECTABLE_EFFORTS.to_vec()
    }

    fn available_models_display(&self) -> Vec<String> {
        self.catalog
            .best_known()
            .models
            .into_iter()
            .map(|model| model.id)
            .collect()
    }

    fn available_models_for_switching(&self) -> Vec<String> {
        let models = self.catalog.best_known().models;
        let usable: Vec<String> = models
            .iter()
            .filter(|model| model.usable)
            .map(|model| model.id.clone())
            .collect();
        if usable.is_empty() {
            // Fail open like the TS client: the gateway is the authoritative
            // per-model gate, so visible-but-not-entitled ids stay switchable.
            return models.into_iter().map(|model| model.id).collect();
        }
        usable
    }

    fn model_routes(&self) -> Vec<ModelRoute> {
        self.catalog
            .best_known()
            .models
            .into_iter()
            .map(|model| ModelRoute {
                detail: format_rayu_route_detail(&model),
                model: model.id,
                provider: rayucode_base::rayu::RAYU_PROVIDER_DISPLAY_NAME.to_string(),
                api_method: rayucode_base::rayu::RAYU_ROUTE_API_METHOD.to_string(),
                available: model.usable,
                usage: None,
                cheapness: None,
            })
            .collect()
    }

    async fn prefetch_models(&self) -> Result<()> {
        self.catalog.prefetch().await?;
        self.apply_default_model();
        Ok(())
    }

    async fn refresh_model_catalog(&self) -> Result<ModelCatalogRefreshSummary> {
        let before_models = self.available_models_display();
        let before_routes = self.model_routes();
        // Explicit refresh always bypasses fresh memory and disk caches.
        self.catalog.force_refresh().await?;
        self.apply_default_model();
        let after_models = self.available_models_display();
        let after_routes = self.model_routes();
        Ok(summarize_model_catalog_refresh(
            before_models,
            after_models,
            before_routes,
            after_routes,
        ))
    }

    fn on_auth_changed(&self) {
        // Drop the memory catalog so the next prefetch re-fetches with the new
        // credential/endpoint. Disk stays as last-good until then.
        self.catalog.clear_memory();
    }

    async fn invalidate_credentials(&self) {
        self.catalog.clear_memory();
    }

    fn active_auth_method_label(&self) -> Option<&'static str> {
        if rayucode_base::rayu::has_usable_session() {
            Some("Rayu account login")
        } else if rayucode_base::rayu::has_api_key() {
            Some("Rayu API key")
        } else {
            None
        }
    }

    fn handles_tools_internally(&self) -> bool {
        false
    }

    fn supports_compaction(&self) -> bool {
        true
    }

    fn supports_image_input(&self) -> bool {
        let model = self.model();
        self.catalog
            .best_known()
            .models
            .iter()
            .find(|row| row.id == model)
            .and_then(|row| row.supports_image)
            .unwrap_or(false)
    }

    fn context_window(&self) -> usize {
        let model = self.model();
        if let Some(window) = self
            .catalog
            .best_known()
            .models
            .iter()
            .find(|row| row.id == model)
            .and_then(|row| row.max_input_tokens.or(row.context_window))
        {
            return window as usize;
        }
        rayucode_provider_core::context_limit_for_model_with_provider(&model, Some(self.name()))
            .unwrap_or(rayucode_provider_core::DEFAULT_CONTEXT_LIMIT)
    }

    fn transport(&self) -> Option<String> {
        Some("HTTPS (SSE)".to_string())
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(Self {
            model: Arc::new(Mutex::new(self.model())),
            catalog: Arc::clone(&self.catalog),
            reasoning_effort: Arc::new(Mutex::new(self.lock_effort().clone())),
            session_id: Arc::new(Mutex::new(self.lock_session_id().clone())),
        })
    }
}

#[cfg(test)]
mod tests;
