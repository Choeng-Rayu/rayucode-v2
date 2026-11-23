//! Live model catalog for the Rayu provider.
//!
//! Two credential routes, two endpoints, one catalog shape:
//!
//! * JWT session → `GET {api_base()}/me/entitlements` (via
//!   [`rayucode_base::rayu::fetch_entitlements`]). `allowedModels` are USABLE;
//!   `hostedModels` (when present) are VISIBLE to every signed-in user.
//! * API key → `GET {gateway_base()}/v1/models` with the `rayu_sk_live_…` key
//!   as a Bearer credential. OpenAI-style `{"object":"list","data":[…]}`.
//!
//! Discovery rules (AGENTS.md): the arrays below are OFFLINE FALLBACKS, never
//! release allowlists. A model added in the Rayu admin dashboard must appear in
//! the picker on the next prefetch/refresh with no rayu release. Cached
//! prefetch honors a TTL; explicit refresh bypasses fresh caches; network,
//! auth, and malformed-response failures preserve the last good catalog; the
//! persistent cache is scoped to the endpoint (and credential route) that
//! produced it, under the shared `rayu` namespace.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

/// Freshness window for the in-memory and on-disk catalog (5 minutes).
/// Explicit refresh ([`CatalogCache::force_refresh`]) bypasses it entirely.
pub(crate) const CATALOG_TTL_SECS: u64 = 5 * 60;

/// Matches the 15s budget the other provider catalog fetches use.
const CATALOG_TIMEOUT: Duration = Duration::from_secs(15);

/// Which credential produced a catalog. The two routes fetch different
/// endpoints with different usability semantics, so a cache entry is only
/// valid for the route that wrote it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CatalogRoute {
    Jwt,
    ApiKey,
}

/// One catalog row. `usable` is false for a hosted model the signed-in plan
/// can SEE but not USE (JWT route only); API-key rows are always usable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RayuCatalogModel {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_multiplier: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_reasoning: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_image: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_tools: Option<bool>,
    pub usable: bool,
}

/// Rayu's catalog is 100% live and server-managed: never fabricate hardcoded
/// model IDs that may not exist on the user's gateway. When no live or disk-
/// cached catalog exists yet, return an empty list until prefetch completes.
pub(crate) fn fallback_models() -> Vec<RayuCatalogModel> {
    Vec::new()
}

/// Mirror of rayu-cli `sanitizeRemoteModelId`: a catalog response is untrusted
/// input, and an id carrying control characters (notably `\u0000`, which other
/// runtimes use as a provider-routing separator) could spoof routing. Unusable
/// ids are dropped, never repaired.
pub(crate) fn sanitize_model_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 512 {
        return None;
    }
    if trimmed.chars().any(char::is_control) {
        return None;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "._:/@+-".contains(c))
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn optional_trimmed(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn optional_bool(value: Option<&serde_json::Value>) -> Option<bool> {
    value.and_then(|v| v.as_bool())
}

/// Only a positive, finite window is recorded (mirrors rayu-cli
/// `hostedContextWindows`): a missing/zero/negative value must leave the model
/// on rayu's own default instead of budgeting against a bogus window.
fn optional_window(value: Option<&serde_json::Value>) -> Option<u64> {
    let raw = value.and_then(|v| v.as_f64())?;
    (raw.is_finite() && raw > 0.0).then_some(raw.floor() as u64)
}

fn optional_positive_u32(value: Option<&serde_json::Value>) -> Option<u32> {
    let raw = value.and_then(|v| v.as_f64())?;
    (raw.is_finite() && raw > 0.0 && raw <= f64::from(u32::MAX)).then_some(raw.floor() as u32)
}

fn optional_positive_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    let raw = value.and_then(|v| v.as_f64())?;
    (raw.is_finite() && raw > 0.0).then_some(raw)
}

fn model_from_entry(
    entry: &rayucode_base::rayu::RayuModelEntry,
    id: String,
    usable: bool,
) -> RayuCatalogModel {
    let label = entry
        .label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty() && *label != id)
        .map(str::to_string);
    let description = entry
        .description
        .as_deref()
        .map(str::trim)
        .filter(|description| !description.is_empty())
        .map(str::to_string);
    let context_window = entry.context_window.filter(|window| *window > 0);
    let max_input_tokens = entry.max_input_tokens.filter(|tokens| *tokens > 0);
    let max_output_tokens = entry.max_output_tokens.filter(|tokens| *tokens > 0);
    let credit_multiplier = entry
        .credit_multiplier
        .filter(|mult| mult.is_finite() && *mult > 0.0);
    RayuCatalogModel {
        id,
        label,
        description,
        context_window,
        max_input_tokens,
        max_output_tokens,
        credit_multiplier,
        supports_reasoning: entry.supports_reasoning,
        supports_image: entry.supports_image,
        supports_tools: entry.supports_tools,
        usable,
    }
}

/// Map a `/me/entitlements` payload onto catalog rows.
///
/// Visibility mirrors rayu-cli `syncRayuHostedProvider`: `hostedModels` when
/// present, else `allowedModels`. Usability is membership in `allowedModels`.
/// Order is preserved (admin dashboard order) and ids are deduplicated.
pub(crate) fn catalog_from_entitlements(
    entitlements: &rayucode_base::rayu::RayuEntitlements,
) -> Vec<RayuCatalogModel> {
    let allowed: HashSet<String> = entitlements
        .allowed_models
        .iter()
        .filter_map(|entry| sanitize_model_id(&entry.code))
        .collect();
    let visible = entitlements
        .hosted_models
        .as_deref()
        .unwrap_or(&entitlements.allowed_models);
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for entry in visible {
        let Some(id) = sanitize_model_id(&entry.code) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let usable = allowed.contains(&id);
        out.push(model_from_entry(entry, id, usable));
    }
    out
}

/// Parse the gateway's OpenAI-style `/v1/models` body (API-key route).
///
/// Real schema: `{"object":"list","data":[{"id","object","owned_by","label",
/// "description","contextWindow","supportsReasoning","supportsImage",
/// "supportsTools"}],"subagentTiers":{"fast","balanced","capable"}}`.
/// A malformed body is an ERROR (not an empty catalog) so the caller preserves
/// the last good catalog instead of persisting garbage.
pub(crate) fn parse_gateway_models(
    body: &str,
) -> Result<(Vec<RayuCatalogModel>, Option<serde_json::Value>)> {
    let value: serde_json::Value =
        serde_json::from_str(body).context("Rayu /v1/models response is not valid JSON")?;
    let data = value
        .get("data")
        .and_then(|data| data.as_array())
        .context("Rayu /v1/models response has no `data` array")?;
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in data {
        let Some(raw_id) = item.get("id").and_then(|id| id.as_str()) else {
            continue;
        };
        let Some(id) = sanitize_model_id(raw_id) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let label = optional_trimmed(item.get("label")).filter(|label| *label != id);
        out.push(RayuCatalogModel {
            id,
            label,
            description: optional_trimmed(item.get("description")),
            context_window: optional_window(item.get("contextWindow")),
            max_input_tokens: optional_window(item.get("maxInputTokens")),
            max_output_tokens: optional_positive_u32(item.get("maxOutputTokens")),
            credit_multiplier: optional_positive_f64(item.get("creditMultiplier")),
            supports_reasoning: optional_bool(item.get("supportsReasoning")),
            supports_image: optional_bool(item.get("supportsImage")),
            supports_tools: optional_bool(item.get("supportsTools")),
            usable: true,
        });
    }
    let tiers = value
        .get("subagentTiers")
        .filter(|tiers| tiers.is_object())
        .cloned();
    Ok((out, tiers))
}

/// Mirror of rayu-cli `parseSubagentTiers`: only the three known tier names,
/// only string values, and only codes present in the catalog.
pub(crate) fn parse_subagent_tiers(
    raw: Option<&serde_json::Value>,
    catalog: &[String],
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(object) = raw.and_then(|value| value.as_object()) else {
        return out;
    };
    for tier in ["fast", "balanced", "capable"] {
        if let Some(code) = object.get(tier).and_then(|value| value.as_str())
            && catalog.iter().any(|id| id == code)
        {
            out.insert(tier.to_string(), code.to_string());
        }
    }
    out
}

/// Model ids that read as a cheap/fast tier (rayu-cli `SMALL_FAST_PATTERN`).
const SMALL_FAST_MARKERS: &[&str] = &["flash", "mini", "lite", "small", "haiku", "air", "nano"];

pub(crate) fn is_small_fast(id: &str) -> bool {
    let lower = id.to_ascii_lowercase();
    SMALL_FAST_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}

/// JWT (hosted) default: first USABLE model (`allowedModels[0]`), else the
/// first visible catalog entry (`hostedModels[0]`). Mirrors rayu-cli
/// `syncRayuHostedProvider`'s `preferredCode`.
pub(crate) fn hosted_default_model(models: &[RayuCatalogModel]) -> Option<String> {
    models
        .iter()
        .find(|model| model.usable)
        .or_else(|| models.first())
        .map(|model| model.id.clone())
}

/// API-key default: first id NOT matching the cheap-tier pattern, else the
/// first id. Mirrors rayu-cli `pickRayuDefaultModels`.
pub(crate) fn api_key_default_model(models: &[RayuCatalogModel]) -> Option<String> {
    models
        .iter()
        .find(|model| !is_small_fast(&model.id))
        .or_else(|| models.first())
        .map(|model| model.id.clone())
}

pub(crate) fn default_model_for(
    route: CatalogRoute,
    models: &[RayuCatalogModel],
) -> Option<String> {
    match route {
        CatalogRoute::Jwt => hosted_default_model(models),
        CatalogRoute::ApiKey => api_key_default_model(models),
    }
}

/// Small-fast companion default: first cheap-tier id, else the primary default
/// (rayu-cli `pickRayuDefaultModels` reuses the primary when nothing matches).
/// Exposed for side-query/subagent routing surfaces; the chat default itself
/// is [`default_model_for`].
pub fn small_fast_model_for(route: CatalogRoute, models: &[RayuCatalogModel]) -> Option<String> {
    models
        .iter()
        .find(|model| is_small_fast(&model.id))
        .map(|model| model.id.clone())
        .or_else(|| default_model_for(route, models))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn cache_dir() -> PathBuf {
    if let Ok(path) = std::env::var("RAYU_HOME") {
        return PathBuf::from(path).join("cache");
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".rayu")
        .join("cache")
}

/// Endpoint- and credential-scoped cache path under the shared `rayu`
/// namespace. The endpoint, credential route, AND credential scope (user ID for
/// JWT or key fingerprint for API key) are hashed into the file name and
/// re-validated from the file body on load, so switching endpoints, accounts,
/// or restricted API keys never serves a foreign catalog.
pub(crate) fn cache_path(endpoint: &str, route: CatalogRoute, credential_scope: &str) -> PathBuf {
    let scope = format!(
        "{}|{}|{}",
        route_tag(route),
        endpoint.trim_end_matches('/'),
        credential_scope
    );
    cache_dir().join(format!(
        "{}_models_{:016x}.json",
        rayucode_base::rayu::RAYU_CACHE_NAMESPACE,
        rayucode_provider_core::stable_hash_str(&scope)
    ))
}

fn route_tag(route: CatalogRoute) -> &'static str {
    match route {
        CatalogRoute::Jwt => "jwt",
        CatalogRoute::ApiKey => "apikey",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DiskCatalog {
    cached_at: u64,
    source_endpoint: String,
    route: CatalogRoute,
    #[serde(default)]
    credential_scope: String,
    models: Vec<RayuCatalogModel>,
    #[serde(default)]
    subagent_tiers: HashMap<String, String>,
}

impl DiskCatalog {
    fn into_cached(self) -> CachedCatalog {
        CachedCatalog {
            models: self.models,
            route: self.route,
            endpoint: self.source_endpoint,
            credential_scope: self.credential_scope,
            fetched_at: self.cached_at,
        }
    }
}

type DiskMemo = Mutex<HashMap<PathBuf, (Option<SystemTime>, Option<DiskCatalog>)>>;

fn disk_memo() -> &'static DiskMemo {
    static MEMO: OnceLock<DiskMemo> = OnceLock::new();
    MEMO.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Load the persistent catalog for EXACTLY this endpoint + route + credential
/// scope, regardless of age (freshness is decided by the caller; stale entries
/// are still the last-good catalog on failure).
pub(crate) fn load_disk(
    endpoint: &str,
    route: CatalogRoute,
    credential_scope: &str,
) -> Option<DiskCatalog> {
    let path = cache_path(endpoint, route, credential_scope);
    let endpoint = endpoint.trim_end_matches('/');
    let modified_at = std::fs::metadata(&path).ok()?.modified().ok();
    if let Ok(memo) = disk_memo().lock()
        && let Some((memo_modified, cache)) = memo.get(&path)
        && *memo_modified == modified_at
    {
        return cache.clone();
    }
    let loaded = std::fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<DiskCatalog>(&content).ok())
        .filter(|cache| {
            cache.source_endpoint == endpoint
                && cache.route == route
                && cache.credential_scope == credential_scope
                && !cache.models.is_empty()
        });
    if let Ok(mut memo) = disk_memo().lock() {
        memo.insert(path, (modified_at, loaded.clone()));
    }
    loaded
}

pub(crate) fn save_disk(
    endpoint: &str,
    route: CatalogRoute,
    credential_scope: &str,
    models: &[RayuCatalogModel],
    subagent_tiers: &HashMap<String, String>,
) {
    let path = cache_path(endpoint, route, credential_scope);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let cache = DiskCatalog {
        cached_at: now_secs(),
        source_endpoint: endpoint.trim_end_matches('/').to_string(),
        route,
        credential_scope: credential_scope.to_string(),
        models: models.to_vec(),
        subagent_tiers: subagent_tiers.clone(),
    };
    if let Ok(content) = serde_json::to_string(&cache)
        && std::fs::write(&path, content).is_ok()
    {
        // Owner-only even though the cache holds no credentials.
        let _ = rayucode_base::platform::set_permissions_owner_only(&path);
    }
    if let Ok(mut memo) = disk_memo().lock() {
        let modified_at = std::fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok());
        memo.insert(path, (modified_at, Some(cache)));
    }
}

/// The in-memory catalog snapshot, tagged with the endpoint/route/credential
/// scope that produced it so a credential or endpoint switch never serves a
/// foreign cache.
#[derive(Debug, Clone)]
pub(crate) struct CachedCatalog {
    pub models: Vec<RayuCatalogModel>,
    pub route: CatalogRoute,
    pub endpoint: String,
    pub credential_scope: String,
    pub fetched_at: u64,
}

impl CachedCatalog {
    fn is_fresh(&self) -> bool {
        now_secs().saturating_sub(self.fetched_at) < CATALOG_TTL_SECS
    }

    fn matches(&self, route: CatalogRoute, endpoint: &str, credential_scope: &str) -> bool {
        self.route == route
            && self.endpoint == endpoint.trim_end_matches('/')
            && self.credential_scope == credential_scope
    }
}

/// Which catalog route applies right now, the endpoint it fetches from, and
/// the non-reversible credential scope for cache isolation.
/// JWT wins over the API key, exactly like the chat credential.
pub(crate) fn current_route() -> Option<(CatalogRoute, String, String)> {
    if rayucode_base::rayu::has_usable_session() {
        let user_id = rayucode_base::rayu::read_session()
            .map(|session| session.user.id)
            .unwrap_or(0);
        return Some((
            CatalogRoute::Jwt,
            rayucode_base::rayu::api_base(),
            format!("user:{user_id}"),
        ));
    }
    if let Some(key) = rayucode_base::rayu::configured_api_key() {
        let key_hash = rayucode_provider_core::stable_hash_str(&key);
        return Some((
            CatalogRoute::ApiKey,
            rayucode_base::rayu::gateway_base(),
            format!("key:{key_hash:016x}"),
        ));
    }
    None
}

/// Memory → disk → API catalog cache with TTL, endpoint+credential scoping,
/// forced refresh, and last-good preservation on failure.
#[derive(Default)]
pub(crate) struct CatalogCache {
    memory: Mutex<Option<CachedCatalog>>,
    /// Serializes live fetches so concurrent prefetches don't storm the API.
    fetch_gate: tokio::sync::Mutex<()>,
}

impl CatalogCache {
    fn store_memory(&self, catalog: CachedCatalog) {
        *self
            .memory
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(catalog);
    }

    pub(crate) fn memory_snapshot(&self) -> Option<CachedCatalog> {
        self.memory
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(crate) fn clear_memory(&self) {
        *self
            .memory
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    /// Synchronous best-known catalog for display surfaces: matching memory
    /// (any age) → disk for the current endpoint+credential (any age) → empty
    /// list (never hardcoded fake models). Never performs a network fetch.
    pub(crate) fn best_known(&self) -> CachedCatalog {
        if let Some((route, endpoint, scope)) = current_route() {
            if let Some(memory) = self.memory_snapshot()
                && memory.matches(route, &endpoint, &scope)
            {
                return memory;
            }
            if let Some(disk) = load_disk(&endpoint, route, &scope) {
                let cached = disk.into_cached();
                self.store_memory(cached.clone());
                return cached;
            }
            return CachedCatalog {
                models: fallback_models(),
                route,
                endpoint: endpoint.trim_end_matches('/').to_string(),
                credential_scope: scope,
                fetched_at: 0,
            };
        }
        CachedCatalog {
            models: fallback_models(),
            route: CatalogRoute::ApiKey,
            endpoint: String::new(),
            credential_scope: String::new(),
            fetched_at: 0,
        }
    }

    /// Cached prefetch: fresh memory → fresh disk → live fetch. Without
    /// credentials there is nothing to fetch.
    pub(crate) async fn prefetch(&self) -> Result<()> {
        let Some((route, endpoint, scope)) = current_route() else {
            let _ = self.best_known();
            return Ok(());
        };
        if self
            .memory_snapshot()
            .is_some_and(|cache| cache.matches(route, &endpoint, &scope) && cache.is_fresh())
        {
            return Ok(());
        }
        if let Some(disk) = load_disk(&endpoint, route, &scope)
            && now_secs().saturating_sub(disk.cached_at) < CATALOG_TTL_SECS
        {
            self.store_memory(disk.into_cached());
            return Ok(());
        }
        self.fetch_and_store(route, &endpoint, &scope).await
    }

    /// Explicit refresh: ALWAYS fetches live, bypassing fresh memory and disk
    /// caches. On failure the last good catalog is preserved and the error is
    /// surfaced to the caller.
    pub(crate) async fn force_refresh(&self) -> Result<()> {
        let (route, endpoint, scope) = current_route()
            .context("No Rayu credentials: sign in with /login or set RAYU_API_KEY")?;
        self.fetch_and_store(route, &endpoint, &scope).await
    }

    async fn fetch_and_store(
        &self,
        route: CatalogRoute,
        endpoint: &str,
        credential_scope: &str,
    ) -> Result<()> {
        let _gate = self.fetch_gate.lock().await;
        match fetch_live(route, endpoint).await {
            Ok((models, subagent_tiers)) => {
                save_disk(endpoint, route, credential_scope, &models, &subagent_tiers);
                self.store_memory(CachedCatalog {
                    models,
                    route,
                    endpoint: endpoint.trim_end_matches('/').to_string(),
                    credential_scope: credential_scope.to_string(),
                    fetched_at: now_secs(),
                });
                Ok(())
            }
            Err(error) => {
                // Last-good on network/auth/malformed failure: keep whatever
                // memory/disk already provides for display.
                let _ = self.best_known();
                Err(error)
            }
        }
    }
}

async fn fetch_gateway_models_with_bearer(
    gateway_base: &str,
    bearer: &str,
) -> Result<(Vec<RayuCatalogModel>, Option<serde_json::Value>)> {
    let url = format!("{}/v1/models", gateway_base.trim_end_matches('/'));
    crate::ensure_safe_bearer_endpoint(&url)?;
    let auth_kind = rayucode_base::rayu::RayuAuthKind::from_credential(bearer);
    let product = rayucode_base::rayu::client_product();
    let mut response = crate::http_client()
        .get(&url)
        .bearer_auth(bearer)
        .header("x-rayu-client", product)
        .timeout(CATALOG_TIMEOUT)
        .send()
        .await
        .with_context(|| format!("Failed to send Rayu model catalog request\n  endpoint: {url}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        && auth_kind == rayucode_base::rayu::RayuAuthKind::AccountJwt
        && rayucode_base::rayu::has_usable_session()
        && let Some(fresh) = rayucode_base::rayu::refresh_access_token(Some(bearer)).await
    {
        response = crate::http_client()
            .get(&url)
            .bearer_auth(&fresh)
            .header("x-rayu-client", product)
            .timeout(CATALOG_TIMEOUT)
            .send()
            .await
            .with_context(|| {
                format!("Failed to send Rayu model catalog request\n  endpoint: {url}")
            })?;
    }
    let status = response.status();
    if !status.is_success() {
        let limit_header = rayucode_base::rayu::extract_rayu_limit_header(response.headers());
        let retry_after_secs = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<i64>().ok())
            .filter(|&s| s > 0);
        let body = rayucode_provider_core::http_error_body(response, "Rayu catalog").await;
        rayucode_base::logging::warn(&format!(
            "Rayu model catalog request failed (HTTP {status}, endpoint={url}): {}",
            rayucode_base::util::truncate_str(body.trim(), 400)
        ));
        return Err(rayucode_base::rayu::RayuGatewayError::from_http_response(
            status.as_u16(),
            &body,
            limit_header.as_deref(),
            retry_after_secs,
            rayucode_base::rayu::RayuErrorContext {
                auth: auth_kind,
                model: None,
                request_id: None,
            },
        )
        .into());
    }
    let body = response
        .text()
        .await
        .context("Failed to read Rayu model catalog response body")?;
    parse_gateway_models(&body)
}

async fn fetch_live(
    route: CatalogRoute,
    endpoint: &str,
) -> Result<(Vec<RayuCatalogModel>, HashMap<String, String>)> {
    let (models, tiers_raw) = match route {
        CatalogRoute::Jwt => match rayucode_base::rayu::fetch_entitlements().await {
            Ok(entitlements) => {
                let models = catalog_from_entitlements(&entitlements);
                (models, entitlements.subagent_tiers.clone())
            }
            Err(entitlements_err) => {
                // Fallback to the gateway's own /v1/models endpoint (which also
                // accepts account JWTs and returns the exact plan/team/PAYG
                // usable catalog) when the backend entitlements endpoint is
                // unavailable and the gateway is distinct.
                let gateway = rayucode_base::rayu::gateway_base();
                let same_origin = gateway.trim_end_matches('/') == endpoint.trim_end_matches('/');
                if !same_origin
                    && let Some(token) = rayucode_base::rayu::access_token().await
                    && let Ok(parsed) = fetch_gateway_models_with_bearer(&gateway, &token).await
                {
                    parsed
                } else {
                    return Err(entitlements_err.context("Rayu entitlements request failed"));
                }
            }
        },
        CatalogRoute::ApiKey => {
            let key = rayucode_base::rayu::configured_api_key()
                .context("RAYU_API_KEY is not configured")?;
            fetch_gateway_models_with_bearer(endpoint, &key).await?
        }
    };
    let ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
    let tiers = parse_subagent_tiers(tiers_raw.as_ref(), &ids);
    Ok((models, tiers))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(code: &str) -> rayucode_base::rayu::RayuModelEntry {
        rayucode_base::rayu::RayuModelEntry {
            code: code.to_string(),
            label: None,
            description: None,
            context_window: None,
            max_input_tokens: None,
            max_output_tokens: None,
            supports_reasoning: None,
            supports_image: None,
            supports_tools: None,
            credit_multiplier: None,
        }
    }

    #[test]
    fn sanitizes_untrusted_model_ids() {
        assert_eq!(
            sanitize_model_id(" deepseek-v3 "),
            Some("deepseek-v3".into())
        );
        assert_eq!(
            sanitize_model_id("vendor/model:tag@pin+ext"),
            Some("vendor/model:tag@pin+ext".into())
        );
        assert_eq!(sanitize_model_id(""), None);
        assert_eq!(sanitize_model_id("   "), None);
        assert_eq!(sanitize_model_id("evil\u{0}id"), None);
        assert_eq!(sanitize_model_id("evil\nid"), None);
        assert_eq!(sanitize_model_id("bad id with spaces"), None);
        assert_eq!(sanitize_model_id(&"x".repeat(513)), None);
    }

    #[test]
    fn entitlements_separate_usable_from_visible() {
        let mut allowed = entry("rayu-usable");
        allowed.label = Some("Usable Model".into());
        allowed.context_window = Some(200_000);
        allowed.max_input_tokens = Some(180_000);
        allowed.max_output_tokens = Some(64_000);
        allowed.supports_image = Some(true);
        let mut preview = entry("rayu-preview");
        preview.label = Some("rayu-preview".into()); // label == id is dropped
        preview.context_window = Some(0); // bogus window is dropped
        let entitlements = rayucode_base::rayu::RayuEntitlements {
            allowed_models: vec![allowed.clone()],
            hosted_models: Some(vec![allowed, preview]),
            subagent_tiers: Some(
                json!({"fast": "rayu-preview", "balanced": "rayu-usable", "capable": "not-in-catalog"}),
            ),
        };
        let models = catalog_from_entitlements(&entitlements);
        assert_eq!(models.len(), 2);
        assert!(models[0].usable);
        assert_eq!(models[0].label.as_deref(), Some("Usable Model"));
        assert_eq!(models[0].context_window, Some(200_000));
        assert_eq!(models[0].max_input_tokens, Some(180_000));
        assert_eq!(models[0].max_output_tokens, Some(64_000));
        assert_eq!(models[0].supports_image, Some(true));
        assert!(!models[1].usable);
        assert_eq!(models[1].label, None);
        assert_eq!(models[1].context_window, None);
        assert_eq!(
            hosted_default_model(&models).as_deref(),
            Some("rayu-usable")
        );

        let ids: Vec<String> = models.iter().map(|m| m.id.clone()).collect();
        let tiers = parse_subagent_tiers(entitlements.subagent_tiers.as_ref(), &ids);
        assert_eq!(tiers.get("fast").map(String::as_str), Some("rayu-preview"));
        assert_eq!(
            tiers.get("balanced").map(String::as_str),
            Some("rayu-usable")
        );
        assert!(!tiers.contains_key("capable"));
    }

    #[test]
    fn entitlements_without_hosted_models_fall_back_to_allowed() {
        let entitlements = rayucode_base::rayu::RayuEntitlements {
            allowed_models: vec![entry("rayu-only-allowed")],
            hosted_models: None,
            subagent_tiers: None,
        };
        let models = catalog_from_entitlements(&entitlements);
        assert_eq!(models.len(), 1);
        assert!(models[0].usable);
        assert_eq!(
            hosted_default_model(&models).as_deref(),
            Some("rayu-only-allowed")
        );
    }

    #[test]
    fn hosted_default_prefers_usable_then_first_visible() {
        let row = |id: &str, usable: bool| RayuCatalogModel {
            id: id.to_string(),
            label: None,
            description: None,
            context_window: None,
            max_input_tokens: None,
            max_output_tokens: None,
            credit_multiplier: None,
            supports_reasoning: None,
            supports_image: None,
            supports_tools: None,
            usable,
        };
        let preview = row("rayu-preview", false);
        let usable = row("rayu-usable", true);
        // Visible order puts the preview first; the default must still be usable.
        let models = vec![preview.clone(), usable];
        assert_eq!(
            hosted_default_model(&models).as_deref(),
            Some("rayu-usable")
        );
        let visible_only = vec![preview];
        assert_eq!(
            hosted_default_model(&visible_only).as_deref(),
            Some("rayu-preview")
        );
    }

    #[test]
    fn parses_real_gateway_models_schema() {
        let body = r#"{
            "object": "list",
            "data": [
                {"id": "rayu-future-model-9", "object": "model", "owned_by": "rayu",
                 "label": "Future Model 9", "description": "Released after this binary",
                 "contextWindow": 400000, "maxInputTokens": 272000, "maxOutputTokens": 128000, "supportsReasoning": true,
                 "supportsImage": false, "supportsTools": true},
                {"id": "rayu-flash-mini", "object": "model", "owned_by": "rayu",
                 "contextWindow": 131072},
                {"id": "rayu-future-model-9", "object": "model", "owned_by": "rayu"},
                {"id": "bad\u0000id"},
                {"object": "model"}
            ],
            "subagentTiers": {"fast": "rayu-flash-mini", "balanced": "rayu-future-model-9", "capable": "rayu-future-model-9"}
        }"#;
        let (models, tiers) = parse_gateway_models(body).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "rayu-future-model-9");
        assert_eq!(models[0].label.as_deref(), Some("Future Model 9"));
        assert_eq!(models[0].context_window, Some(400_000));
        assert_eq!(models[0].max_input_tokens, Some(272_000));
        assert_eq!(models[0].max_output_tokens, Some(128_000));
        assert_eq!(models[0].supports_reasoning, Some(true));
        assert_eq!(models[0].supports_image, Some(false));
        assert_eq!(models[0].supports_tools, Some(true));
        assert!(models.iter().all(|model| model.usable));
        // API-key default skips the cheap tier; small-fast picks it.
        assert_eq!(
            api_key_default_model(&models).as_deref(),
            Some("rayu-future-model-9")
        );
        assert_eq!(
            small_fast_model_for(CatalogRoute::ApiKey, &models).as_deref(),
            Some("rayu-flash-mini")
        );
        let ids: Vec<String> = models.iter().map(|m| m.id.clone()).collect();
        let tiers = parse_subagent_tiers(tiers.as_ref(), &ids);
        assert_eq!(tiers.len(), 3);
    }

    #[test]
    fn malformed_gateway_bodies_are_errors_not_empty_catalogs() {
        assert!(parse_gateway_models("not json").is_err());
        assert!(parse_gateway_models(r#"{"object":"list"}"#).is_err());
        assert!(parse_gateway_models(r#"{"data":{"id":"x"}}"#).is_err());
        assert!(parse_gateway_models("[]").is_err());
        // A valid but empty list is a legitimate (if unusual) response.
        let (models, _) = parse_gateway_models(r#"{"object":"list","data":[]}"#).unwrap();
        assert!(models.is_empty());
    }

    #[test]
    fn api_key_defaults_follow_the_cheap_tier_pattern() {
        let models: Vec<RayuCatalogModel> = ["glm-4.5-air", "kimi-k2", "deepseek-v3"]
            .iter()
            .map(|id| RayuCatalogModel {
                id: (*id).to_string(),
                label: None,
                description: None,
                context_window: None,
                max_input_tokens: None,
                max_output_tokens: None,
                credit_multiplier: None,
                supports_reasoning: None,
                supports_image: None,
                supports_tools: None,
                usable: true,
            })
            .collect();
        assert_eq!(api_key_default_model(&models).as_deref(), Some("kimi-k2"));
        assert_eq!(
            small_fast_model_for(CatalogRoute::ApiKey, &models).as_deref(),
            Some("glm-4.5-air")
        );
        let all_cheap: Vec<RayuCatalogModel> = models
            .iter()
            .filter(|m| is_small_fast(&m.id))
            .cloned()
            .collect();
        assert_eq!(
            api_key_default_model(&all_cheap).as_deref(),
            Some("glm-4.5-air")
        );
        assert_eq!(
            small_fast_model_for(CatalogRoute::ApiKey, &all_cheap).as_deref(),
            Some("glm-4.5-air")
        );
        assert_eq!(api_key_default_model(&[]), None);
    }

    #[test]
    fn no_hardcoded_fallback_models_are_fabricated() {
        assert!(fallback_models().is_empty());
    }
}
