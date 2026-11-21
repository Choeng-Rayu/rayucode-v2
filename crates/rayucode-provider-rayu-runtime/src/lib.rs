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
    ApiRequest, build_system_param, format_messages, format_messages_with_identity, format_tools,
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

fn new_request_id() -> String {
    format!("rv2_{}", uuid::Uuid::new_v4().simple())
}

/// Rayu hosted-model runtime. Rides a registry profile like grok-build; there
/// is no dedicated `ActiveProvider` variant.
#[derive(Clone)]
pub struct RayuProvider {
    model: Arc<Mutex<String>>,
    catalog: Arc<catalog::CatalogCache>,
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
        system: &str,
        logical_request_id: &str,
    ) -> Result<EventStream> {
        let model = self.model();
        let url = format!(
            "{}/anthropic/v1/messages",
            rayucode_base::rayu::gateway_base()
        );
        ensure_safe_bearer_endpoint(&url)?;
        let request = ApiRequest {
            model: model.clone(),
            max_tokens: rayucode_provider_core::anthropic::anthropic_max_output_tokens(&model),
            system: build_system_param(system, false, false),
            messages: format_messages_with_identity(format_messages(messages, false), false, false),
            tools: request_tools(format_tools(tools, false, false), Vec::new()),
            metadata: None,
            thinking: None,
            output_config: None,
            temperature: None,
            service_tier: None,
            stream: true,
        };
        // A fresh id per physical attempt; the logical id stays fixed across
        // 401 refreshes and transport replays so gateway logs group them.
        let request_id = new_request_id();
        let response = http_client()
            .post(&url)
            .bearer_auth(credential)
            .header(
                "anthropic-version",
                rayucode_base::provider_catalog::ANTHROPIC_VERSION_HEADER_VALUE,
            )
            .header("x-rayu-client", "cli")
            .header(REQUEST_ID_HEADER, &request_id)
            .header(LOGICAL_REQUEST_ID_HEADER, logical_request_id)
            .header(QUERY_SOURCE_HEADER, QUERY_SOURCE)
            .json(&request)
            .send()
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
            // the wait it expects in `Retry-After`.
            let retry_after = rayucode_provider_core::retry_after::retry_after(response.headers());
            let should_retry = response
                .headers()
                .get("x-should-retry")
                .and_then(|v| v.to_str().ok())
                .is_none_or(|v| !v.eq_ignore_ascii_case("false"));
            let body = rayucode_provider_core::http_error_body(response, "Rayu gateway").await;
            let brief = extract_gateway_error_summary(&body);
            let message = format!(
                "Rayu gateway request failed (HTTP {status}): {brief}\n  endpoint: {url}\n  request_id: {request_id}\n  status: {status}\n  response: {}",
                rayucode_base::util::truncate_str(body.trim(), 600)
            );
            if should_retry && retry::is_capacity_status(status.as_u16()) {
                return Err(retry::CapacityError::new(message, retry_after).into());
            }
            bail!(message);
        }
        let trace = sse::ResponseTrace::from_response(&response, request_id);
        rayucode_base::logging::debug(&format!("Rayu gateway stream opened: {}", trace.describe()));
        Ok(sse::stream_events(response, trace))
    }

    /// One full attempt: send, and on a 401 before output refresh the JWT and
    /// replay once.
    async fn open_attempt(
        &self,
        messages: Arc<Vec<Message>>,
        tools: Arc<Vec<ToolDefinition>>,
        system: Arc<String>,
        logical_request_id: Arc<String>,
    ) -> Result<EventStream> {
        let credential = rayucode_base::rayu::gateway_credential()
            .await
            .context("No Rayu credentials available: sign in with /login or set RAYU_API_KEY")?;
        let first = self
            .complete_once(&credential, &messages, &tools, &system, &logical_request_id)
            .await;
        // Only a JWT session can be refreshed; an API-key 401 surfaces as-is.
        if !rayucode_base::rayu::has_usable_session() {
            return first;
        }
        let provider = self.clone();
        let retry = move || -> RetryFuture {
            Box::pin(async move {
                if rayucode_base::rayu::refresh_access_token(Some(&credential))
                    .await
                    .is_none()
                {
                    bail!(
                        "Rayu session expired and could not be refreshed; sign in again with /login"
                    );
                }
                let fresh = rayucode_base::rayu::gateway_credential()
                    .await
                    .context("No Rayu credentials available after refresh")?;
                provider
                    .complete_once(&fresh, &messages, &tools, &system, &logical_request_id)
                    .await
            })
        };
        let inner = match first {
            Ok(stream) => stream,
            // Already retried once: return the replayed stream as-is.
            Err(error) if is_unauthorized_text(&format!("{error:#}")) => return retry().await,
            Err(error) => return Err(error),
        };
        Ok(Box::pin(AuthRetryStream {
            inner,
            retry: Some(Box::new(retry)),
            pending: None,
            saw_output: false,
        }))
    }
}

fn extract_gateway_error_summary(body: &str) -> String {
    let trimmed = body.trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(msg) = value
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .or_else(|| value.get("error").and_then(|v| v.as_str()))
            .or_else(|| value.get("message").and_then(|v| v.as_str()))
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return rayucode_base::util::truncate_str(msg, 180).to_string();
        }
    }
    if trimmed.is_empty() {
        return "empty error response".to_string();
    }
    rayucode_base::util::truncate_str(trimmed.lines().next().unwrap_or(trimmed), 180).to_string()
}

fn format_rayu_route_detail(model: &catalog::RayuCatalogModel) -> String {
    let mut parts = Vec::new();
    if let Some(label) = model.label.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(label.trim().to_string());
    }
    if let Some(desc) = model
        .description
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        parts.push(desc.trim().to_string());
    }
    if let Some(ctx) = model.context_window.filter(|w| *w > 0) {
        let formatted = if ctx >= 1_000_000 && ctx % 1_000_000 == 0 {
            format!("{}M ctx", ctx / 1_000_000)
        } else if ctx >= 1_000 {
            format!("{}K ctx", ctx / 1_000)
        } else {
            format!("{ctx} ctx")
        };
        parts.push(formatted);
    }
    let mut detail = if parts.is_empty() {
        "Rayu hosted model".to_string()
    } else {
        parts.join(" · ")
    };
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
        || text.contains("authentication_error")
        || (text.contains("401")
            && (text.contains("unauthorized")
                || text.contains("unauthenticated")
                || text.contains("invalid or expired credentials")))
}

fn is_unauthorized_item(item: &Result<StreamEvent>) -> bool {
    match item {
        Err(error) => is_unauthorized_text(&format!("{error:#}")),
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
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        system: &str,
        _resume_session_id: Option<&str>,
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
        let system = Arc::new(system.to_string());
        let logical_request_id = Arc::new(new_request_id());
        let open: retry::OpenFn = Arc::new(move || -> RetryFuture {
            let provider = provider.clone();
            let (messages, tools, system, logical_request_id) = (
                Arc::clone(&messages),
                Arc::clone(&tools),
                Arc::clone(&system),
                Arc::clone(&logical_request_id),
            );
            Box::pin(async move {
                provider
                    .open_attempt(messages, tools, system, logical_request_id)
                    .await
            })
        });
        let (inner, attempt) = retry::open_with_retry(&open).await?;
        Ok(retry::transport_retry_stream(inner, open, attempt))
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
        Ok(())
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
            .and_then(|row| row.context_window)
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
        })
    }
}

#[cfg(test)]
mod tests;
