use super::dispatch;
use super::provider_init::ProviderChoice;
use crate::protocol::{PermissionDecision, PermissionMode, Request, ServerEvent};
use crate::transport::{ReadHalf, WriteHalf};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, oneshot, watch};

const ACP_PROTOCOL_VERSION: u64 = 1;

const JSONRPC_PARSE_ERROR: i64 = -32700;
const JSONRPC_INVALID_REQUEST: i64 = -32600;
const JSONRPC_METHOD_NOT_FOUND: i64 = -32601;
const JSONRPC_INVALID_PARAMS: i64 = -32602;
const JSONRPC_INTERNAL_ERROR: i64 = -32603;
const JSONRPC_SERVER_ERROR: i64 = -32000;
const JSONRPC_AUTH_REQUIRED: i64 = -32000;

mod auth;
mod mcp_bridge;
mod session_configuration;
mod sessions;

use session_configuration::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AcpProfile {
    Standard,
    Extended,
    Full,
}

impl AcpProfile {
    fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "extended" => Self::Extended,
            "full" => Self::Full,
            _ => Self::Standard,
        }
    }

    fn parse_strict(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "standard" => Some(Self::Standard),
            "extended" => Some(Self::Extended),
            "full" => Some(Self::Full),
            _ => None,
        }
    }

    fn is_extended(self) -> bool {
        matches!(self, Self::Extended | Self::Full)
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Extended => "extended",
            Self::Full => "full",
        }
    }
}

/// Capabilities reported by the ACP client during `initialize`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ClientCapabilities {
    pub(super) fs_read_text_file: bool,
    pub(super) fs_write_text_file: bool,
    pub(super) terminal: bool,
    pub(super) terminal_auth: bool,
}

impl ClientCapabilities {
    fn from_initialize_params(params: &Value) -> Self {
        let caps = params.get("clientCapabilities");
        let fs = caps.and_then(|c| c.get("fs"));
        let fs_read_text_file = fs
            .and_then(|f| f.get("readTextFile"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let fs_write_text_file = fs
            .and_then(|f| f.get("writeTextFile"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let terminal = caps
            .and_then(|c| c.get("terminal"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let terminal_auth = caps
            .and_then(|c| c.get("auth"))
            .and_then(|a| a.get("terminal"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || caps
                .and_then(|c| c.get("_meta"))
                .and_then(|m| m.get("terminal-auth"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
        Self {
            fs_read_text_file,
            fs_write_text_file,
            terminal,
            terminal_auth,
        }
    }
}

/// Client identity reported in `initialize.params.clientInfo`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ClientInfo {
    name: Option<String>,
    version: Option<String>,
}

impl ClientInfo {
    fn from_initialize_params(params: &Value) -> Self {
        let info = params.get("clientInfo");
        let name = info
            .and_then(|i| i.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let version = info
            .and_then(|i| i.get("version"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        Self { name, version }
    }

    fn daemon_client_name(&self) -> Option<String> {
        match (self.name.as_deref(), self.version.as_deref()) {
            (Some(name), Some(version)) => Some(format!("acp:{name}/{version}")),
            (Some(name), None) => Some(format!("acp:{name}")),
            _ => Some("acp".to_string()),
        }
    }
}

#[derive(Debug)]
struct JsonRpcMessage {
    id: Option<Value>,
    method: Option<String>,
    params: Value,
    result: Option<Value>,
    error: Option<Value>,
}

impl JsonRpcMessage {
    fn parse(line: &str) -> std::result::Result<Self, (i64, String)> {
        let value: Value =
            serde_json::from_str(line).map_err(|err| (JSONRPC_PARSE_ERROR, err.to_string()))?;
        let object = value.as_object().ok_or_else(|| {
            (
                JSONRPC_INVALID_REQUEST,
                "JSON-RPC message must be an object".to_string(),
            )
        })?;
        if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
            return Err((
                JSONRPC_INVALID_REQUEST,
                "JSON-RPC message must include jsonrpc=\"2.0\"".to_string(),
            ));
        }
        Ok(Self {
            id: object.get("id").cloned(),
            method: object
                .get("method")
                .and_then(Value::as_str)
                .map(str::to_string),
            params: object.get("params").cloned().unwrap_or(Value::Null),
            result: object.get("result").cloned(),
            error: object.get("error").cloned(),
        })
    }

    fn is_response(&self) -> bool {
        self.method.is_none()
            && self.id.is_some()
            && (self.result.is_some() || self.error.is_some())
    }
}

fn canonical_rpc_id_key(id: &Value) -> String {
    serde_json::to_string(id).unwrap_or_else(|_| id.to_string())
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

type PendingClientMap =
    Arc<Mutex<HashMap<String, oneshot::Sender<std::result::Result<Value, Value>>>>>;
type AcpWriter = Arc<Mutex<Box<dyn AsyncWrite + Unpin + Send>>>;

struct PendingRequestGuard {
    pending: PendingClientMap,
    key: String,
    armed: bool,
}

impl Drop for PendingRequestGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if let Ok(mut map) = self.pending.try_lock() {
            map.remove(&self.key);
        } else {
            let pending = Arc::clone(&self.pending);
            let key = self.key.clone();
            tokio::spawn(async move {
                pending.lock().await.remove(&key);
            });
        }
    }
}

struct DaemonSession {
    session_id: String,
    reader: Mutex<BufReader<ReadHalf>>,
    writer: Mutex<WriteHalf>,
    next_request_id: AtomicU64,
    active_prompt_id: Mutex<Option<u64>>,
    prompt_running: AtomicBool,
    /// Set by `session/cancel` while a prompt is running; scoped to that prompt.
    cancel_requested: AtomicBool,
    /// Level-triggered cancel signal (`true` = cancelled) so spawned tasks
    /// (such as pending permission requests) never miss a cancel that raced
    /// ahead of their `select!`.
    cancel_tx: watch::Sender<bool>,
    ui_state: Mutex<SessionUiState>,
    /// Workspace root reported by the ACP client, used to compose the
    /// project-local skill overlay for slash-skill resolution and tool locations.
    working_dir: Option<PathBuf>,
    /// Sticky skill selection, resent with every prompt. The daemon treats a
    /// missing `active_skill` as "clear the selection", mirroring the TUI.
    active_skill: Mutex<Option<String>>,
    /// Session-scoped MCP servers passed via ACP `mcpServers`.
    mcp_bridge: Mutex<Option<Arc<mcp_bridge::SessionMcpBridge>>>,
    /// Latest known display title for `session/list` responses.
    title: Mutex<Option<String>>,
    /// Last activity timestamp (epoch ms) for `session/list` ordering.
    updated_at_ms: AtomicI64,
}

/// Session-scoped provider/model/mode state used to surface ACP `configOptions`
/// (model selector, reasoning effort, mode), `modes`, and `usage_update` notifications.
#[derive(Clone, Debug, Default)]
struct SessionUiState {
    provider_name: Option<String>,
    model: Option<String>,
    available_models: Vec<String>,
    reasoning_effort: Option<String>,
    permission_mode: Option<PermissionMode>,
}

#[derive(Debug, Default)]
struct TurnUsage {
    reported: bool,
    input_tokens: u64,
    output_tokens: u64,
    cached_read_tokens: Option<u64>,
    cached_write_tokens: Option<u64>,
    call_snapshot: (u64, u64, Option<u64>, Option<u64>),
}

impl TurnUsage {
    fn begin_call(&mut self) {
        self.call_snapshot = (0, 0, None, None);
    }

    fn observe_snapshot(
        &mut self,
        input: u64,
        output: u64,
        cache_read: Option<u64>,
        cache_write: Option<u64>,
    ) {
        let previous = self.call_snapshot;
        self.add(
            input.saturating_sub(previous.0),
            output.saturating_sub(previous.1),
            cache_read.map(|value| value.saturating_sub(previous.2.unwrap_or(0))),
            cache_write.map(|value| value.saturating_sub(previous.3.unwrap_or(0))),
        );
        self.call_snapshot = (
            input.max(previous.0),
            output.max(previous.1),
            cache_read
                .map(|value| value.max(previous.2.unwrap_or(0)))
                .or(previous.2),
            cache_write
                .map(|value| value.max(previous.3.unwrap_or(0)))
                .or(previous.3),
        );
    }
    fn add(
        &mut self,
        input_tokens: u64,
        output_tokens: u64,
        cached_read_tokens: Option<u64>,
        cached_write_tokens: Option<u64>,
    ) {
        self.reported = true;
        self.input_tokens = self.input_tokens.saturating_add(input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(output_tokens);
        add_optional_tokens(&mut self.cached_read_tokens, cached_read_tokens);
        add_optional_tokens(&mut self.cached_write_tokens, cached_write_tokens);
    }

    fn to_acp(&self) -> Option<Value> {
        if !self.reported {
            return None;
        }

        let total_tokens = self
            .input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cached_read_tokens.unwrap_or(0))
            .saturating_add(self.cached_write_tokens.unwrap_or(0));
        let mut usage = json!({
            "totalTokens": total_tokens,
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
        });
        let object = usage.as_object_mut().expect("usage is an object");
        if let Some(tokens) = self.cached_read_tokens {
            object.insert("cachedReadTokens".to_string(), json!(tokens));
        }
        if let Some(tokens) = self.cached_write_tokens {
            object.insert("cachedWriteTokens".to_string(), json!(tokens));
        }
        Some(usage)
    }
}

fn add_optional_tokens(total: &mut Option<u64>, tokens: Option<u64>) {
    if let Some(tokens) = tokens {
        *total = Some(total.unwrap_or(0).saturating_add(tokens));
    }
}

/// Tracks daemon events for one ACP prompt and derives its ACP stop reason.
///
/// Only the terminal outcome of the whole turn counts: a limit or refusal
/// followed by another model request (a successful continuation) is reset.
#[derive(Debug, Default)]
struct TurnOutcome {
    acked: bool,
    interrupted: bool,
    terminal: Option<&'static str>,
}

impl TurnOutcome {
    fn observe(&mut self, event: &ServerEvent, prompt_id: u64) {
        match event {
            ServerEvent::Ack { id } if *id == prompt_id => self.acked = true,
            // Interrupts read before our prompt was acknowledged are stale
            // leftovers from an earlier turn, not this prompt's outcome.
            ServerEvent::Interrupted if self.acked => self.interrupted = true,
            ServerEvent::KvCacheRequest { .. } | ServerEvent::RetryRollback { .. } => {
                self.terminal = None;
            }
            ServerEvent::TurnStopped {
                reason,
                message,
                provider_stop_reason,
            } => match reason {
                crate::protocol::TurnStopReason::LimitReached => {
                    let raw = provider_stop_reason.as_deref().unwrap_or_default();
                    let lower = message.to_ascii_lowercase();
                    self.terminal = Some(
                        if raw.contains("turn_requests")
                            || lower.contains("request limit")
                            || lower.contains("max turn")
                        {
                            "max_turn_requests"
                        } else {
                            "max_tokens"
                        },
                    );
                }
                crate::protocol::TurnStopReason::ProviderGuardrail => {
                    self.terminal = Some("refusal");
                }
                crate::protocol::TurnStopReason::Interrupted if self.acked => {
                    self.interrupted = true;
                }
                _ => {}
            },
            ServerEvent::ProviderGuardrail { stop_reason, .. } => {
                if stop_reason.as_deref().is_some_and(is_refusal_stop_reason) {
                    self.terminal = Some("refusal");
                }
            }
            _ => {}
        }
    }

    fn stop_reason(&self, cancel_requested: bool) -> &'static str {
        if cancel_requested || self.interrupted {
            "cancelled"
        } else {
            self.terminal.unwrap_or("end_turn")
        }
    }
}

fn is_refusal_stop_reason(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    [
        "refusal",
        "content_filter",
        "safety",
        "blocked",
        "prohibited",
        "guardrail",
    ]
    .iter()
    .any(|needle| reason.contains(needle))
}

fn prompt_response(stop_reason: &str, usage: &TurnUsage) -> Value {
    let mut response = json!({ "stopReason": stop_reason });
    if let Some(usage) = usage.to_acp() {
        response
            .as_object_mut()
            .expect("prompt response is an object")
            .insert("usage".to_string(), usage);
    }
    response
}

impl SessionUiState {
    fn from_history_fields(
        provider_name: Option<String>,
        provider_model: Option<String>,
        available_models: Vec<String>,
        reasoning_effort: Option<String>,
    ) -> Self {
        Self {
            provider_name,
            model: provider_model,
            available_models,
            reasoning_effort,
            permission_mode: Some(PermissionMode::Default),
        }
    }

    fn context_limit(&self) -> u64 {
        self.model
            .as_deref()
            .and_then(|model| {
                crate::provider::context_limit_for_model_with_provider(
                    model,
                    self.provider_name.as_deref(),
                )
            })
            .unwrap_or(crate::provider::DEFAULT_CONTEXT_LIMIT) as u64
    }
}

impl DaemonSession {
    fn new(session_id: String, reader: ReadHalf, writer: WriteHalf, next_request_id: u64) -> Self {
        let (cancel_tx, _) = watch::channel(false);
        Self {
            session_id,
            reader: Mutex::new(BufReader::new(reader)),
            writer: Mutex::new(writer),
            next_request_id: AtomicU64::new(next_request_id),
            active_prompt_id: Mutex::new(None),
            prompt_running: AtomicBool::new(false),
            cancel_requested: AtomicBool::new(false),
            cancel_tx,
            ui_state: Mutex::new(SessionUiState::default()),
            working_dir: None,
            active_skill: Mutex::new(None),
            mcp_bridge: Mutex::new(None),
            title: Mutex::new(None),
            updated_at_ms: AtomicI64::new(now_epoch_ms()),
        }
    }

    fn signal_cancel(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
        let _ = self.cancel_tx.send(true);
    }

    fn reset_cancel(&self) {
        self.cancel_requested.store(false, Ordering::SeqCst);
        let _ = self.cancel_tx.send(false);
    }

    fn subscribe_cancel(&self) -> watch::Receiver<bool> {
        self.cancel_tx.subscribe()
    }

    fn with_working_dir(self, working_dir: PathBuf) -> Self {
        Self {
            working_dir: Some(working_dir),
            ..self
        }
    }

    /// Effective skills for this session: global skills plus the workspace's
    /// project-local overlay, loaded fresh so newly installed skills resolve.
    fn skills(&self) -> crate::skill::SkillRegistry {
        crate::skill::SkillRegistry::load_for_working_dir(self.working_dir.as_deref())
            .unwrap_or_default()
    }

    fn with_ui_state(self, state: SessionUiState) -> Self {
        Self {
            ui_state: Mutex::new(state),
            ..self
        }
    }

    fn touch_activity(&self) {
        self.updated_at_ms.store(now_epoch_ms(), Ordering::Relaxed);
    }

    fn next_id(&self) -> u64 {
        self.next_request_id.fetch_add(1, Ordering::Relaxed)
    }

    async fn send(&self, request: &Request) -> Result<()> {
        let mut json = serde_json::to_string(request)?;
        json.push('\n');
        let mut writer = self.writer.lock().await;
        writer.write_all(json.as_bytes()).await?;
        writer.flush().await?;
        Ok(())
    }

    async fn read_event(&self) -> Result<ServerEvent> {
        let mut line = String::new();
        let mut reader = self.reader.lock().await;
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            anyhow::bail!("Rayu daemon disconnected");
        }
        let event = serde_json::from_str(&line)
            .with_context(|| format!("failed to decode Rayu daemon event: {}", line.trim_end()))?;
        Ok(super::commands::unwrap_turn_event(event))
    }

    async fn configure_mcp_servers(&self, servers: Vec<mcp_bridge::ParsedAcpMcpServer>) {
        if servers.is_empty() {
            return;
        }
        let Some(bridge) = mcp_bridge::SessionMcpBridge::connect(servers).await else {
            return;
        };
        let tool_config = bridge.session_tool_config();
        let req_id = self.next_id();
        if let Err(err) = self
            .send(&Request::ConfigureTools {
                id: req_id,
                tools: tool_config,
            })
            .await
        {
            crate::logging::warn(&format!("Failed to register ACP session MCP tools: {err:#}"));
            bridge.shutdown().await;
            return;
        }
        if let Err(err) = wait_for_ack_or_error(self, req_id).await {
            crate::logging::warn(&format!(
                "Daemon rejected ACP session MCP tool registration: {err:#}"
            ));
            bridge.shutdown().await;
            return;
        }
        *self.mcp_bridge.lock().await = Some(Arc::new(bridge));
    }

    async fn shutdown_mcp_bridge(&self) {
        if let Some(bridge) = self.mcp_bridge.lock().await.take() {
            bridge.shutdown().await;
        }
    }
}

#[derive(Clone)]
pub(crate) struct AcpRuntime {
    writer: AcpWriter,
    sessions: Arc<Mutex<HashMap<String, Arc<DaemonSession>>>>,
    profile: Arc<Mutex<AcpProfile>>,
    client_caps: Arc<Mutex<ClientCapabilities>>,
    client_info: Arc<Mutex<ClientInfo>>,
    next_outbound_id: Arc<AtomicU64>,
    pending_client_requests: PendingClientMap,
    provider_choice: ProviderChoice,
    model: Option<String>,
    provider_profile: Option<String>,
}

impl AcpRuntime {
    pub(crate) fn new(
        profile: AcpProfile,
        provider_choice: ProviderChoice,
        model: Option<String>,
        provider_profile: Option<String>,
    ) -> Self {
        Self::with_writer(
            Box::new(tokio::io::stdout()),
            profile,
            provider_choice,
            model,
            provider_profile,
        )
    }

    pub(crate) fn with_writer<W>(
        writer: W,
        profile: AcpProfile,
        provider_choice: ProviderChoice,
        model: Option<String>,
        provider_profile: Option<String>,
    ) -> Self
    where
        W: AsyncWrite + Unpin + Send + 'static,
    {
        Self {
            writer: Arc::new(Mutex::new(Box::new(writer))),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            profile: Arc::new(Mutex::new(profile)),
            client_caps: Arc::new(Mutex::new(ClientCapabilities::default())),
            client_info: Arc::new(Mutex::new(ClientInfo::default())),
            next_outbound_id: Arc::new(AtomicU64::new(1)),
            pending_client_requests: Arc::new(Mutex::new(HashMap::new())),
            provider_choice,
            model,
            provider_profile,
        }
    }

    pub(crate) async fn run(self) -> Result<()> {
        let stdin = tokio::io::stdin();
        self.run_on_io(BufReader::new(stdin)).await
    }

    /// Run the bidirectional ACP JSON-RPC 2.0 loop over any async buffered
    /// reader paired with this runtime's writer (stdio, Unix socket, pipe, or
    /// in-memory duplex stream).
    pub(crate) async fn run_on_io<R>(self, mut reader: R) -> Result<()>
    where
        R: AsyncBufRead + Unpin,
    {
        let mut line = String::new();

        loop {
            line.clear();
            let n = reader.read_line(&mut line).await?;
            if n == 0 {
                // Release any pending Agent -> Client requests (e.g. permission prompts)
                // and tear down session-scoped MCP bridges cleanly on EOF.
                self.pending_client_requests.lock().await.clear();
                let open_sessions: Vec<Arc<DaemonSession>> =
                    self.sessions.lock().await.drain().map(|(_, s)| s).collect();
                for session in open_sessions {
                    session.signal_cancel();
                    session.shutdown_mcp_bridge().await;
                }
                return Ok(());
            }
            if line.trim().is_empty() {
                continue;
            }

            let message = match JsonRpcMessage::parse(&line) {
                Ok(message) => message,
                Err((code, message)) => {
                    self.write_error_value(
                        Value::Null,
                        code,
                        format!("Invalid JSON-RPC request: {message}"),
                    )
                    .await?;
                    continue;
                }
            };

            self.handle_message(message).await?;
        }
    }

    async fn current_profile(&self) -> AcpProfile {
        *self.profile.lock().await
    }

    async fn current_client_caps(&self) -> ClientCapabilities {
        self.client_caps.lock().await.clone()
    }

    async fn daemon_client_name(&self) -> Option<String> {
        self.client_info.lock().await.daemon_client_name()
    }

    /// Send an Agent -> Client JSON-RPC 2.0 request (such as
    /// `session/request_permission`) and await the client's response.
    async fn send_client_request(
        &self,
        method: &str,
        params: Value,
    ) -> std::result::Result<Value, Value> {
        let req_id = self.next_outbound_id.fetch_add(1, Ordering::Relaxed);
        let id_value = json!(req_id);
        let key = canonical_rpc_id_key(&id_value);
        let (tx, rx) = oneshot::channel();
        {
            self.pending_client_requests
                .lock()
                .await
                .insert(key.clone(), tx);
        }
        let mut guard = PendingRequestGuard {
            pending: Arc::clone(&self.pending_client_requests),
            key,
            armed: true,
        };

        if let Err(err) = self
            .write_value(json!({
                "jsonrpc": "2.0",
                "id": id_value,
                "method": method,
                "params": params,
            }))
            .await
        {
            return Err(json!({
                "code": JSONRPC_INTERNAL_ERROR,
                "message": format!("Failed to write ACP client request '{method}': {err:#}"),
            }));
        }

        match rx.await {
            Ok(outcome) => {
                guard.armed = false;
                outcome
            }
            Err(_) => {
                guard.armed = false;
                Err(json!({
                    "code": JSONRPC_INTERNAL_ERROR,
                    "message": format!("ACP client disconnected before responding to '{method}'"),
                }))
            }
        }
    }

    async fn handle_message(&self, message: JsonRpcMessage) -> Result<()> {
        // Bidirectional JSON-RPC 2.0: route responses to pending Agent -> Client requests.
        if message.is_response() {
            if let Some(id) = message.id {
                let key = canonical_rpc_id_key(&id);
                let waiter = self.pending_client_requests.lock().await.remove(&key);
                if let Some(tx) = waiter {
                    let payload = if let Some(error) = message.error {
                        Err(error)
                    } else {
                        Ok(message.result.unwrap_or(Value::Null))
                    };
                    let _ = tx.send(payload);
                }
            }
            return Ok(());
        }

        let Some(method) = message.method.as_deref() else {
            if let Some(id) = message.id {
                self.write_error_value(
                    id,
                    JSONRPC_INVALID_REQUEST,
                    "JSON-RPC request missing method".to_string(),
                )
                .await?;
            }
            return Ok(());
        };

        match method {
            "initialize" => self.handle_initialize(message).await?,
            "authenticate" => self.handle_authenticate(message).await?,
            "session/new" => self.handle_session_new(message).await?,
            "session/load" => self.handle_session_load(message, true).await?,
            "session/resume" => self.handle_session_load(message, false).await?,
            "session/fork" => self.handle_session_fork(message).await?,
            "session/list" => self.handle_session_list(message).await?,
            "session/prompt" => self.handle_session_prompt(message).await?,
            "session/cancel" => self.handle_session_cancel(message).await?,
            "session/close" => self.handle_session_close(message).await?,
            "session/delete" => self.handle_session_delete(message).await?,
            "session/set_mode" => self.handle_session_set_mode(message).await?,
            "session/set_config_option" => self.handle_set_config_option(message).await?,
            "session/set_model" => {
                self.handle_compat_config_option(
                    message,
                    CONFIG_ID_MODEL,
                    &["modelId", "model"],
                    "session/set_model",
                )
                .await?
            }
            "session/set_reasoning_effort" => {
                self.handle_compat_config_option(
                    message,
                    CONFIG_ID_EFFORT,
                    &["effort", "reasoningEffort"],
                    "session/set_reasoning_effort",
                )
                .await?
            }
            _ if method.starts_with('_') => {
                if let Some(id) = message.id {
                    self.write_error_value(
                        id,
                        JSONRPC_METHOD_NOT_FOUND,
                        format!("Unsupported Rayu ACP extension method: {method}"),
                    )
                    .await?;
                }
            }
            _ => {
                if let Some(id) = message.id {
                    self.write_error_value(
                        id,
                        JSONRPC_METHOD_NOT_FOUND,
                        format!("Unsupported ACP method: {method}"),
                    )
                    .await?;
                }
            }
        }

        Ok(())
    }

    async fn handle_initialize(&self, message: JsonRpcMessage) -> Result<()> {
        let caps = ClientCapabilities::from_initialize_params(&message.params);
        let info = ClientInfo::from_initialize_params(&message.params);
        *self.client_caps.lock().await = caps.clone();
        *self.client_info.lock().await = info;

        // First-party Rayu products (Desktop, VS Code extension) may request an
        // extended profile per connection via `_meta.rayu.profile` without
        // mutating global user config.
        if let Some(requested_profile) = message
            .params
            .get("_meta")
            .and_then(|m| m.get("rayu"))
            .and_then(|r| r.get("profile"))
            .and_then(Value::as_str)
            .and_then(AcpProfile::parse_strict)
        {
            *self.profile.lock().await = requested_profile;
        }
        if let Some(product) = message
            .params
            .get("_meta")
            .and_then(|m| m.get("rayu"))
            .and_then(|r| r.get("product"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            crate::env::set_var(crate::rayu::RAYU_CLIENT_PRODUCT_ENV, product);
        }

        let profile = self.current_profile().await;
        if let Some(id) = message.id {
            self.write_result(id, initialize_result_with_caps(&message.params, profile, &caps))
                .await?;
        }
        Ok(())
    }

    async fn handle_authenticate(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        // Spawn authenticate asynchronously so interactive browser OAuth never
        // stalls the JSON-RPC stdin loop or EOF detection.
        let runtime = self.clone();
        let params = message.params;
        tokio::spawn(async move {
            match auth::execute_authenticate(&params).await {
                Ok(()) => {
                    runtime.notify_running_daemon_auth_changed().await;
                    let _ = runtime.write_result(id, json!({})).await;
                }
                Err((code, err_msg)) => {
                    let data = if code == JSONRPC_AUTH_REQUIRED {
                        Some(auth::auth_required_error_data(
                            &runtime.current_client_caps().await,
                        ))
                    } else {
                        None
                    };
                    let _ = runtime.write_error_with_data(id, code, err_msg, data).await;
                }
            }
        });
        Ok(())
    }

    async fn notify_running_daemon_auth_changed(&self) {
        if !dispatch::server_is_running().await {
            return;
        }
        let Ok(stream) = crate::server::connect_socket(&crate::server::socket_path()).await else {
            return;
        };
        let (reader, writer) = stream.into_split();
        let session = DaemonSession::new(String::new(), reader, writer, 1);
        let id = session.next_id();
        if session
            .send(&Request::NotifyAuthChanged {
                id,
                provider: Some("rayu".to_string()),
                auth: None,
                prefer_strongest: false,
            })
            .await
            .is_ok()
        {
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                wait_for_done(&session, id),
            )
            .await;
        }
    }

    async fn check_auth_gate(&self, rpc_id: &Value) -> Result<bool> {
        if let Err(err) = super::startup::require_cli_auth_gate() {
            let caps = self.current_client_caps().await;
            self.write_error_with_data(
                rpc_id.clone(),
                JSONRPC_AUTH_REQUIRED,
                err.to_string(),
                Some(auth::auth_required_error_data(&caps)),
            )
            .await?;
            return Ok(false);
        }
        Ok(true)
    }

    async fn handle_session_new(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let cwd = match cwd_from_params(&message.params) {
            Ok(cwd) => cwd,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let mcp_servers = match mcp_bridge::parse_acp_mcp_servers(&message.params) {
            Ok(servers) => servers,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        if !self.check_auth_gate(&id).await? {
            return Ok(());
        }

        match self.create_new_session(cwd).await {
            Ok(session) => {
                session.configure_mcp_servers(mcp_servers).await;
                let session_id = session.session_id.clone();
                let state = session.ui_state.lock().await.clone();
                self.sessions
                    .lock()
                    .await
                    .insert(session_id.clone(), Arc::new(session));
                let mut result = json!({ "sessionId": session_id });
                insert_session_configuration(&mut result, &state);
                self.write_result(id, result).await?;
                self.write_available_commands(&session_id).await?;
            }
            Err(err) => {
                self.write_error_value(
                    id,
                    JSONRPC_INTERNAL_ERROR,
                    format!("Failed to create Rayu session: {err:#}"),
                )
                .await?;
            }
        }
        Ok(())
    }

    async fn handle_session_load(
        &self,
        message: JsonRpcMessage,
        replay_history: bool,
    ) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let cwd = match cwd_from_params(&message.params) {
            Ok(cwd) => cwd,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let mcp_servers = match mcp_bridge::parse_acp_mcp_servers(&message.params) {
            Ok(servers) => servers,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        if !self.check_auth_gate(&id).await? {
            return Ok(());
        }

        match self
            .attach_existing_session(session_id.clone(), cwd, replay_history)
            .await
        {
            Ok(session) => {
                session.configure_mcp_servers(mcp_servers).await;
                let attached_id = session.session_id.clone();
                let state = session.ui_state.lock().await.clone();
                self.sessions
                    .lock()
                    .await
                    .insert(attached_id.clone(), Arc::new(session));
                let mut result = json!({});
                insert_session_configuration(&mut result, &state);
                self.write_result(id, result).await?;
                self.write_available_commands(&attached_id).await?;
            }
            Err(err) => {
                self.write_error_value(
                    id,
                    JSONRPC_INTERNAL_ERROR,
                    format!("Failed to attach Rayu session '{session_id}': {err:#}"),
                )
                .await?;
            }
        }
        Ok(())
    }

    async fn handle_session_fork(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let source_session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let source_session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&source_session_id).cloned()
        };
        let cwd = match optional_cwd_from_params(&message.params) {
            Ok(Some(cwd)) => cwd,
            Ok(None) => source_session
                .as_ref()
                .and_then(|s| s.working_dir.clone())
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"))),
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let mcp_servers = match mcp_bridge::parse_acp_mcp_servers(&message.params) {
            Ok(servers) => servers,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        if !self.check_auth_gate(&id).await? {
            return Ok(());
        }

        let inherited_mode = match &source_session {
            Some(s) => s.ui_state.lock().await.permission_mode,
            None => None,
        };

        // Split through the open idle session when available, or via a short-lived
        // attachment if the source session is busy or not yet attached on this connection.
        let split_result = match source_session {
            Some(ref open) if !open.prompt_running.load(Ordering::SeqCst) => {
                request_split(open).await
            }
            _ => match self
                .attach_existing_session(source_session_id.clone(), cwd.clone(), false)
                .await
            {
                Ok(temp) => request_split(&temp).await,
                Err(err) => Err(err),
            },
        };

        let new_session_id = match split_result {
            Ok(new_id) => new_id,
            Err(err) => {
                self.write_error_value(
                    id,
                    JSONRPC_INTERNAL_ERROR,
                    format!("Failed to fork Rayu session '{source_session_id}': {err:#}"),
                )
                .await?;
                return Ok(());
            }
        };

        match self
            .attach_existing_session(new_session_id.clone(), cwd, false)
            .await
        {
            Ok(session) => {
                if let Some(mode) = inherited_mode
                    && mode != PermissionMode::Default
                    && apply_permission_mode_idle(&session, mode).await.is_ok()
                {
                    session.ui_state.lock().await.permission_mode = Some(mode);
                }
                session.configure_mcp_servers(mcp_servers).await;
                let attached_id = session.session_id.clone();
                let state = session.ui_state.lock().await.clone();
                self.sessions
                    .lock()
                    .await
                    .insert(attached_id.clone(), Arc::new(session));
                let mut result = json!({ "sessionId": attached_id });
                insert_session_configuration(&mut result, &state);
                self.write_result(id, result).await?;
                self.write_available_commands(&attached_id).await?;
            }
            Err(err) => {
                self.write_error_value(
                    id,
                    JSONRPC_INTERNAL_ERROR,
                    format!("Forked session '{new_session_id}' but failed to attach: {err:#}"),
                )
                .await?;
            }
        }
        Ok(())
    }

    async fn handle_session_list(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let cwd_filter = match optional_cwd_from_params(&message.params) {
            Ok(cwd) => cwd,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let cursor = message
            .params
            .get("cursor")
            .and_then(Value::as_str)
            .map(str::to_string);

        let active_sessions = self.snapshot_active_sessions().await;
        match sessions::list_sessions(
            cwd_filter.as_deref(),
            cursor.as_deref(),
            &active_sessions,
            sessions::DEFAULT_LIST_PAGE_SIZE,
        ) {
            Ok(result) => self.write_result(id, result).await?,
            Err((code, err)) => self.write_error_value(id, code, err).await?,
        }
        Ok(())
    }

    async fn snapshot_active_sessions(&self) -> Vec<sessions::ListedSession> {
        let open: Vec<Arc<DaemonSession>> = self.sessions.lock().await.values().cloned().collect();
        let fallback_cwd = std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "/".to_string());
        let mut out = Vec::with_capacity(open.len());
        for session in open {
            let title = session.title.lock().await.clone();
            let cwd = session
                .working_dir
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| fallback_cwd.clone());
            out.push(sessions::ListedSession {
                session_id: session.session_id.clone(),
                cwd,
                title,
                updated_at_ms: session.updated_at_ms.load(Ordering::Relaxed),
            });
        }
        out
    }

    async fn handle_session_prompt(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let explicit_skill = explicit_skill_from_params(&message.params);
        let (text, images) = match prompt_from_params(&message.params) {
            Ok(prompt) => prompt,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&session_id).cloned()
        };
        let Some(session) = session else {
            self.write_error_value(
                id,
                JSONRPC_INVALID_PARAMS,
                format!("Unknown ACP session id: {session_id}"),
            )
            .await?;
            return Ok(());
        };

        if session
            .prompt_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            self.write_error_value(
                id,
                JSONRPC_SERVER_ERROR,
                format!("Session {session_id} is already processing a prompt"),
            )
            .await?;
            return Ok(());
        }

        session.touch_activity();
        let runtime = self.clone();
        tokio::spawn(async move {
            let result = runtime
                .run_prompt(id.clone(), session, text, images, explicit_skill)
                .await;
            if let Err(err) = result {
                let msg = format!("Prompt failed: {err:#}");
                if let Err(error) = runtime
                    .write_error_value(id, JSONRPC_INTERNAL_ERROR, msg)
                    .await
                {
                    crate::logging::warn(&format!("Failed to report ACP prompt error: {error:#}"));
                }
            }
        });
        Ok(())
    }

    async fn handle_session_cancel(&self, message: JsonRpcMessage) -> Result<()> {
        let session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                if let Some(id) = message.id {
                    self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                        .await?;
                }
                return Ok(());
            }
        };
        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&session_id).cloned()
        };
        if let Some(session) = session {
            // Only forward a cancel when an ACP prompt is in flight. An idle
            // daemon cancel can emit a stray interrupt that the next prompt
            // would otherwise misattribute to itself.
            if session.prompt_running.load(Ordering::SeqCst) {
                session.signal_cancel();
                let cancel_id = session.next_id();
                let _ = session.send(&Request::Cancel { id: cancel_id }).await;
            }
        }
        if let Some(id) = message.id {
            self.write_result(id, json!({})).await?;
        }
        Ok(())
    }

    async fn handle_session_close(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        if let Some(session) = self.sessions.lock().await.remove(&session_id) {
            session.signal_cancel();
            let cancel_id = session.next_id();
            let _ = session.send(&Request::Cancel { id: cancel_id }).await;
            session.shutdown_mcp_bridge().await;
        }
        self.write_result(id, json!({})).await?;
        Ok(())
    }

    async fn handle_session_delete(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        if let Err(err) = sessions::validate_session_id_for_fs(&session_id) {
            self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                .await?;
            return Ok(());
        }
        if let Some(session) = self.sessions.lock().await.remove(&session_id) {
            session.signal_cancel();
            let cancel_id = session.next_id();
            let _ = session.send(&Request::Cancel { id: cancel_id }).await;
            session.shutdown_mcp_bridge().await;
        }
        match sessions::delete_persisted_session(&session_id) {
            Ok(()) => self.write_result(id, json!({})).await?,
            Err(err) => {
                self.write_error_value(
                    id,
                    JSONRPC_INTERNAL_ERROR,
                    format!("Failed to delete Rayu session '{session_id}': {err:#}"),
                )
                .await?;
            }
        }
        Ok(())
    }

    async fn handle_session_set_mode(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let raw_mode = message
            .params
            .get("modeId")
            .or_else(|| message.params.get("mode"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(raw_mode) = raw_mode else {
            self.write_error_value(
                id,
                JSONRPC_INVALID_PARAMS,
                "session/set_mode requires a non-empty string modeId".to_string(),
            )
            .await?;
            return Ok(());
        };
        let Some(mode) = parse_acp_mode(raw_mode) else {
            self.write_error_value(
                id,
                JSONRPC_INVALID_PARAMS,
                format!(
                    "Unknown ACP modeId '{raw_mode}'. Valid modes: default, accept_edits, plan, full_manage, orchestrator"
                ),
            )
            .await?;
            return Ok(());
        };

        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&session_id).cloned()
        };
        let Some(session) = session else {
            self.write_error_value(
                id,
                JSONRPC_INVALID_PARAMS,
                format!("Unknown ACP session id: {session_id}"),
            )
            .await?;
            return Ok(());
        };

        if let Err(err) = self.apply_session_mode(&session, mode).await {
            self.write_error_value(
                id,
                JSONRPC_SERVER_ERROR,
                format!("Failed to set mode: {err:#}"),
            )
            .await?;
            return Ok(());
        }

        // Strict ACP v1 `SetSessionModeResponse` is `{}`; the mode update is
        // emitted via `current_mode_update` + `config_option_update` notifications.
        self.write_result(id, json!({})).await?;
        self.write_mode_and_config_updates(&session, mode).await?;
        Ok(())
    }

    async fn apply_session_mode(&self, session: &DaemonSession, mode: PermissionMode) -> Result<()> {
        if session.prompt_running.load(Ordering::SeqCst) {
            // The daemon handles `SetPermissionMode` on its lock-free fast path
            // mid-turn and replies with `Ack`, which `run_prompt` skips cleanly.
            let request_id = session.next_id();
            session
                .send(&Request::SetPermissionMode {
                    id: request_id,
                    mode,
                })
                .await?;
        } else {
            apply_permission_mode_idle(session, mode).await?;
        }
        session.ui_state.lock().await.permission_mode = Some(mode);
        Ok(())
    }

    async fn write_mode_and_config_updates(
        &self,
        session: &DaemonSession,
        mode: PermissionMode,
    ) -> Result<()> {
        self.write_notification(
            "session/update",
            json!({
                "sessionId": session.session_id,
                "update": {
                    "sessionUpdate": "current_mode_update",
                    "currentModeId": acp_mode_id(mode),
                }
            }),
        )
        .await?;
        self.write_config_option_update(session).await
    }

    async fn handle_set_config_option(&self, message: JsonRpcMessage) -> Result<()> {
        let Some(id) = message.id else {
            return Ok(());
        };
        let session_id = match required_session_id(&message.params) {
            Ok(session_id) => session_id,
            Err(err) => {
                self.write_error_value(id, JSONRPC_INVALID_PARAMS, err)
                    .await?;
                return Ok(());
            }
        };
        let config_id = message
            .params
            .get("configId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let value = message
            .params
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_string);
        let (Some(config_id), Some(value)) = (config_id, value) else {
            self.write_error_value(
                id,
                JSONRPC_INVALID_PARAMS,
                "session/set_config_option requires string configId and value".to_string(),
            )
            .await?;
            return Ok(());
        };

        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&session_id).cloned()
        };
        let Some(session) = session else {
            self.write_error_value(
                id,
                JSONRPC_INVALID_PARAMS,
                format!("Unknown ACP session id: {session_id}"),
            )
            .await?;
            return Ok(());
        };

        if config_id == CONFIG_ID_MODE {
            let Some(mode) = parse_acp_mode(&value) else {
                self.write_error_value(
                    id,
                    JSONRPC_INVALID_PARAMS,
                    format!(
                        "Unknown mode '{value}'. Valid modes: default, accept_edits, plan, full_manage, orchestrator"
                    ),
                )
                .await?;
                return Ok(());
            };
            match self.apply_session_mode(&session, mode).await {
                Ok(()) => {
                    let config_options = session_config_options(&*session.ui_state.lock().await);
                    self.write_result(id, json!({ "configOptions": config_options }))
                        .await?;
                    self.write_mode_and_config_updates(&session, mode).await?;
                }
                Err(err) => {
                    self.write_error_value(
                        id,
                        JSONRPC_SERVER_ERROR,
                        format!("Failed to set mode: {err:#}"),
                    )
                    .await?;
                }
            }
            return Ok(());
        }

        if session.prompt_running.load(Ordering::SeqCst) {
            self.write_error_value(
                id,
                JSONRPC_SERVER_ERROR,
                format!("Session {session_id} is processing a prompt; retry when it finishes"),
            )
            .await?;
            return Ok(());
        }

        let request_id = session.next_id();
        let apply_result = match config_id.as_str() {
            CONFIG_ID_MODEL => {
                session
                    .send(&Request::SetModel {
                        id: request_id,
                        model: value.clone(),
                    })
                    .await?;
                wait_for_model_changed(&session, request_id).await
            }
            CONFIG_ID_EFFORT => {
                session
                    .send(&Request::SetReasoningEffort {
                        id: request_id,
                        effort: value.clone(),
                        target_session_id: None,
                    })
                    .await?;
                wait_for_effort_changed(&session, request_id).await
            }
            other => Err(anyhow::anyhow!("Unknown config option id: {other}")),
        };

        match apply_result {
            Ok(()) => {
                let config_options = session_config_options(&*session.ui_state.lock().await);
                // The spec requires the full option set in the response itself.
                self.write_result(id, json!({ "configOptions": config_options }))
                    .await?;
                self.write_notification(
                    "session/update",
                    json!({
                        "sessionId": session.session_id,
                        "update": {
                            "sessionUpdate": "config_option_update",
                            "configOptions": config_options,
                        }
                    }),
                )
                .await?;
            }
            Err(err) => {
                self.write_error_value(
                    id,
                    JSONRPC_SERVER_ERROR,
                    format!("Failed to set {config_id}: {err:#}"),
                )
                .await?;
            }
        }
        Ok(())
    }

    /// Compatibility entry points used by ACP hosts that implemented the
    /// pre-configOptions model and reasoning controls. Normalize them through
    /// the standard config option path so both interfaces stay in sync.
    async fn handle_compat_config_option(
        &self,
        mut message: JsonRpcMessage,
        config_id: &str,
        value_fields: &[&str],
        method: &str,
    ) -> Result<()> {
        let value = match compatibility_option_value(&message.params, value_fields, method) {
            Ok(value) => value,
            Err(error) => {
                if let Some(id) = message.id {
                    self.write_error_value(id, JSONRPC_INVALID_PARAMS, error)
                        .await?;
                }
                return Ok(());
            }
        };
        let Some(params) = message.params.as_object_mut() else {
            if let Some(id) = message.id {
                self.write_error_value(
                    id,
                    JSONRPC_INVALID_PARAMS,
                    format!("{method} params must be an object"),
                )
                .await?;
            }
            return Ok(());
        };
        params.insert("configId".to_string(), Value::String(config_id.to_string()));
        params.insert("value".to_string(), Value::String(value));
        self.handle_set_config_option(message).await
    }

    async fn write_available_commands(&self, session_id: &str) -> Result<()> {
        let skills = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_id).map(|session| session.skills())
        }
        .unwrap_or_default();
        let mut commands = acp_available_commands();
        commands.extend(acp_skill_commands(&skills));
        let update = json!({
            "sessionId": session_id,
            "update": { "sessionUpdate": "available_commands_update", "availableCommands": commands }
        });
        self.write_notification("session/update", update).await
    }

    async fn ensure_daemon(&self) -> Result<()> {
        super::startup::require_cli_auth_gate()?;
        if dispatch::server_is_running().await {
            return Ok(());
        }
        let (choice, model, profile) = (
            &self.provider_choice,
            self.model.as_deref(),
            self.provider_profile.as_deref(),
        );
        dispatch::spawn_server(choice, model, profile).await
    }

    async fn connect_daemon(&self) -> Result<(ReadHalf, WriteHalf)> {
        self.ensure_daemon().await?;
        let stream = crate::server::connect_socket(&crate::server::socket_path()).await?;
        Ok(stream.into_split())
    }

    async fn create_new_session(&self, cwd: PathBuf) -> Result<DaemonSession> {
        let (reader, writer) = self.connect_daemon().await?;
        self.create_new_session_connected(cwd, reader, writer).await
    }

    async fn create_new_session_connected(
        &self,
        cwd: PathBuf,
        reader: ReadHalf,
        writer: WriteHalf,
    ) -> Result<DaemonSession> {
        let session = DaemonSession::new(String::new(), reader, writer, 2);
        let subscribe_id = 1;
        let client_name = self.daemon_client_name().await;
        session
            .send(&Request::Subscribe {
                system_prompt: None,
                supports_pdf_panels: false,
                supports_user_response: false,
                supports_user_questions: false,
                supports_permissions: true,
                supports_server_failover: true,
                supports_turn_identity: false,
                supports_bash_progress: true,
                crash_on_disconnect: false,
                continue_on_disconnect: false,
                id: subscribe_id,
                working_dir: Some(cwd.display().to_string()),
                selfdev: None,
                target_session_id: None,
                client_instance_id: Some("acp".to_string()),
                client_has_local_history: false,
                history_base: None,
                allow_session_takeover: false,
                terminal_env: crate::terminal_launch::snapshot_client_terminal_env(),
                client_name,
            })
            .await?;
        wait_for_done(&session, subscribe_id).await?;
        let history = request_history(&session).await?;
        let (session_id, ui_state) = match history {
            ServerEvent::History {
                session_id,
                provider_name,
                provider_model,
                available_models,
                reasoning_effort,
                ..
            } => (
                session_id,
                SessionUiState::from_history_fields(
                    provider_name,
                    provider_model,
                    available_models,
                    reasoning_effort,
                ),
            ),
            other => anyhow::bail!("expected history after session creation, got {other:?}"),
        };
        Ok(DaemonSession::new(
            session_id,
            session.reader.into_inner().into_inner(),
            session.writer.into_inner(),
            session.next_request_id.load(Ordering::Relaxed),
        )
        .with_ui_state(ui_state)
        .with_working_dir(cwd))
    }

    async fn attach_existing_session(
        &self,
        target_session_id: String,
        cwd: PathBuf,
        replay_history: bool,
    ) -> Result<DaemonSession> {
        let (reader, writer) = self.connect_daemon().await?;
        self.attach_existing_session_connected(
            target_session_id,
            cwd,
            replay_history,
            reader,
            writer,
        )
        .await
    }

    async fn attach_existing_session_connected(
        &self,
        target_session_id: String,
        cwd: PathBuf,
        replay_history: bool,
        reader: ReadHalf,
        writer: WriteHalf,
    ) -> Result<DaemonSession> {
        let session = DaemonSession::new(String::new(), reader, writer, 2);
        let resume_id = 1;
        let client_name = self.daemon_client_name().await;
        let profile = self.current_profile().await;
        session
            .send(&Request::Subscribe {
                system_prompt: None,
                supports_pdf_panels: false,
                supports_user_response: false,
                supports_user_questions: false,
                supports_permissions: true,
                supports_server_failover: true,
                supports_turn_identity: false,
                supports_bash_progress: true,
                crash_on_disconnect: false,
                continue_on_disconnect: false,
                id: resume_id,
                working_dir: Some(cwd.display().to_string()),
                selfdev: None,
                target_session_id: Some(target_session_id.clone()),
                client_instance_id: Some("acp".to_string()),
                client_has_local_history: false,
                history_base: None,
                allow_session_takeover: false,
                terminal_env: crate::terminal_launch::snapshot_client_terminal_env(),
                client_name,
            })
            .await?;

        let mut attached_id = target_session_id.clone();
        let mut saw_matching_history = false;
        let mut ui_state = SessionUiState::default();
        loop {
            let event = session.read_event().await?;
            match event {
                ServerEvent::Ack { .. } => {}
                ServerEvent::History {
                    session_id,
                    messages,
                    provider_name,
                    provider_model,
                    available_models,
                    reasoning_effort,
                    ..
                } => {
                    if session_id != target_session_id {
                        anyhow::bail!(
                            "Session '{target_session_id}' not found (daemon attached '{session_id}')"
                        );
                    }
                    saw_matching_history = true;
                    attached_id = session_id.clone();
                    ui_state = SessionUiState::from_history_fields(
                        provider_name,
                        provider_model,
                        available_models,
                        reasoning_effort,
                    );
                    if replay_history {
                        self.replay_history(&session_id, messages).await?;
                    }
                }
                ServerEvent::Done { id } if id == resume_id => break,
                ServerEvent::Error { id, message, .. } if id == resume_id => {
                    anyhow::bail!(message);
                }
                other => {
                    if profile.is_extended() {
                        self.write_rayu_extension_event(&attached_id, &other)
                            .await?;
                    }
                }
            }
        }
        if !saw_matching_history {
            anyhow::bail!("Session '{target_session_id}' not found");
        }

        Ok(DaemonSession::new(
            attached_id,
            session.reader.into_inner().into_inner(),
            session.writer.into_inner(),
            session.next_request_id.load(Ordering::Relaxed),
        )
        .with_ui_state(ui_state)
        .with_working_dir(cwd))
    }

    async fn replay_history(
        &self,
        session_id: &str,
        messages: Vec<crate::protocol::HistoryMessage>,
    ) -> Result<()> {
        for message in messages {
            if let Some(tool) = message.tool_data
                && message.role == "tool"
            {
                let mut call = json!({
                    "sessionUpdate": "tool_call",
                    "toolCallId": tool.id,
                    "title": tool_title(&tool.name),
                    "kind": tool_kind(&tool.name),
                    "status": "completed",
                    "rawInput": tool.input,
                });
                if !message.content.is_empty()
                    && let Some(obj) = call.as_object_mut()
                {
                    obj.insert(
                        "content".to_string(),
                        json!([{
                            "type": "content",
                            "content": { "type": "text", "text": message.content }
                        }]),
                    );
                }
                self.write_notification(
                    "session/update",
                    json!({ "sessionId": session_id, "update": call }),
                )
                .await?;
                continue;
            }
            if message.content.is_empty() {
                continue;
            }
            let update_name = match message.role.as_str() {
                "user" => "user_message_chunk",
                "thought" | "reasoning" => "agent_thought_chunk",
                _ => "agent_message_chunk",
            };
            self.write_notification(
                "session/update",
                json!({
                    "sessionId": session_id,
                    "update": {
                        "sessionUpdate": update_name,
                        "content": {
                            "type": "text",
                            "text": message.content,
                        }
                    }
                }),
            )
            .await?;
        }
        Ok(())
    }

    async fn run_prompt(
        &self,
        rpc_id: Value,
        session: Arc<DaemonSession>,
        text: String,
        images: Vec<(String, String)>,
        explicit_skill: Option<String>,
    ) -> Result<()> {
        let (turn_ended_tx, _) = watch::channel(false);
        let result = self
            .run_prompt_inner(
                rpc_id,
                Arc::clone(&session),
                text,
                images,
                explicit_skill,
                &turn_ended_tx,
            )
            .await;
        // Guarantee pending permission tasks unblock and `prompt_running` is
        // always reset even if stdout breaks or any `?` exits early.
        let _ = turn_ended_tx.send(true);
        cleanup_prompt_state(&session).await;
        result
    }

    async fn run_prompt_inner(
        &self,
        rpc_id: Value,
        session: Arc<DaemonSession>,
        text: String,
        images: Vec<(String, String)>,
        explicit_skill: Option<String>,
        turn_ended_tx: &watch::Sender<bool>,
    ) -> Result<()> {
        if let Some(command) = parse_acp_slash_command(&text) {
            let response = match command {
                Ok(command) => self.run_session_command(&session, command).await,
                Err(err) => Err(err),
            }?;
            self.write_notification(
                "session/update",
                json!({
                    "sessionId": session.session_id,
                    "update": agent_message_chunk(response),
                }),
            )
            .await?;
            self.write_result(rpc_id, prompt_response("end_turn", &TurnUsage::default()))
                .await?;
            return Ok(());
        }
        if let Err(err) = super::startup::require_cli_auth_gate() {
            let caps = self.current_client_caps().await;
            self.write_error_with_data(
                rpc_id,
                JSONRPC_AUTH_REQUIRED,
                err.to_string(),
                Some(auth::auth_required_error_data(&caps)),
            )
            .await?;
            return Ok(());
        }

        // Explicit client metadata wins. Otherwise resolve `/skill [prompt]`
        // (or `$skill [prompt]`, as some ACP hosts serialize command names)
        // against the session's registry. Unknown or path-like slash text is
        // passed through to the model unchanged.
        let mut text = text;
        let skills = session.skills();
        let selected_skill = match explicit_skill {
            Some(name) => Some(name),
            None => match resolve_acp_skill_invocation(&skills, &text) {
                Some((name, prompt)) => {
                    text = prompt.unwrap_or_default();
                    Some(name)
                }
                None => None,
            },
        };
        if let Some(name) = selected_skill {
            let Some(skill) = skills.get(&name) else {
                self.write_error_value(
                    rpc_id,
                    JSONRPC_INVALID_PARAMS,
                    format!("Unknown skill: {name}"),
                )
                .await?;
                return Ok(());
            };
            let notice = format!("Activated skill: {} - {}", skill.name, skill.description);
            *session.active_skill.lock().await = Some(name);
            self.write_notification(
                "session/update",
                json!({
                    "sessionId": session.session_id,
                    "update": agent_message_chunk(format!("{notice}\n\n")),
                }),
            )
            .await?;
            if text.trim().is_empty() && images.is_empty() {
                // Bare `/skill`: select it for the following prompts, like the TUI.
                self.write_result(rpc_id, prompt_response("end_turn", &TurnUsage::default()))
                    .await?;
                return Ok(());
            }
        }
        let active_skill = session.active_skill.lock().await.clone();

        let prompt_id = session.next_id();
        session.reset_cancel();
        {
            let mut active = session.active_prompt_id.lock().await;
            *active = Some(prompt_id);
        }

        session
            .send(&Request::Message {
                id: prompt_id,
                content: text,
                images,
                system_reminder: None,
                active_skill,
                no_reply: false,
            })
            .await?;

        let profile = self.current_profile().await;
        let mut mapper = EventMapper::new(session.session_id.clone(), profile)
            .with_working_dir(session.working_dir.clone());
        let mut outcome = TurnOutcome::default();
        let mut turn_usage = TurnUsage::default();

        loop {
            let event = session.read_event().await?;
            if profile.is_extended() {
                self.write_rayu_extension_event(&session.session_id, &event)
                    .await?;
            }
            outcome.observe(&event, prompt_id);
            match event {
                ServerEvent::Ack { .. } => {}
                ServerEvent::Done { id } if id == prompt_id => break,
                ServerEvent::Interrupted
                | ServerEvent::TurnStopped { .. }
                | ServerEvent::ProviderGuardrail { .. } => {}
                ServerEvent::Error { id, message, .. } if id == prompt_id => {
                    if session.cancel_requested.load(Ordering::SeqCst) {
                        // Cancellation-induced failures still complete as cancelled.
                        self.write_result(rpc_id, prompt_response("cancelled", &turn_usage))
                            .await?;
                        return Ok(());
                    }
                    self.write_error_value(rpc_id, JSONRPC_SERVER_ERROR, message)
                        .await?;
                    return Ok(());
                }
                ServerEvent::PermissionRequest {
                    session_id,
                    request_id,
                    tool_name,
                    description,
                    input,
                    risk_tier,
                } => {
                    let tool_call_id = mapper
                        .active_tool_id(&tool_name)
                        .unwrap_or_else(|| request_id.clone());
                    let perm_params = build_permission_request_params(
                        &session_id,
                        &tool_call_id,
                        &tool_name,
                        &description,
                        &input,
                        risk_tier.as_deref(),
                        session.working_dir.as_deref(),
                    );
                    let runtime = self.clone();
                    let session_clone = Arc::clone(&session);
                    let mut cancel_rx = session.subscribe_cancel();
                    let mut turn_ended_rx = turn_ended_tx.subscribe();
                    tokio::spawn(async move {
                        let decision = tokio::select! {
                            biased;
                            _ = turn_ended_rx.wait_for(|&ended| ended) => return,
                            _ = cancel_rx.wait_for(|&cancelled| cancelled) => PermissionDecision::Deny,
                            resp = runtime.send_client_request("session/request_permission", perm_params) => {
                                match resp {
                                    Ok(value) => parse_permission_decision(&value),
                                    Err(_) => PermissionDecision::Deny,
                                }
                            }
                        };
                        if *turn_ended_rx.borrow() {
                            return;
                        }
                        let resp_id = session_clone.next_id();
                        let _ = session_clone
                            .send(&Request::PermissionResponse {
                                id: resp_id,
                                session_id,
                                request_id,
                                decision,
                            })
                            .await;
                    });
                }
                ServerEvent::ToolCall {
                    call_id,
                    name,
                    input,
                    ..
                } => {
                    let session_clone = Arc::clone(&session);
                    tokio::spawn(async move {
                        let bridge = session_clone.mcp_bridge.lock().await.clone();
                        let (output, error) = match bridge {
                            Some(bridge) => bridge.execute(&name, input).await,
                            None => (
                                String::new(),
                                Some(format!(
                                    "ACP session has no MCP bridge registered for tool '{name}'"
                                )),
                            ),
                        };
                        let resp_id = session_clone.next_id();
                        let _ = session_clone
                            .send(&Request::ToolResult {
                                id: resp_id,
                                call_id,
                                output,
                                error,
                            })
                            .await;
                    });
                }
                ServerEvent::KvCacheRequest { .. } | ServerEvent::RetryRollback { .. } => {
                    turn_usage.begin_call();
                }
                ServerEvent::TokenUsage {
                    input,
                    output,
                    cache_read_input,
                    cache_creation_input,
                    ..
                } => {
                    turn_usage.observe_snapshot(
                        input,
                        output,
                        cache_read_input,
                        cache_creation_input,
                    );
                    let (provider_name, context_limit) = {
                        let state = session.ui_state.lock().await;
                        (
                            state.provider_name.clone().unwrap_or_default(),
                            state.context_limit(),
                        )
                    };
                    let used = crate::compaction::effective_context_tokens_from_usage(
                        &provider_name,
                        input,
                        cache_read_input,
                        cache_creation_input,
                    );
                    self.write_notification(
                        "session/update",
                        json!({
                            "sessionId": session.session_id,
                            "update": {
                                "sessionUpdate": "usage_update",
                                "used": used,
                                "size": context_limit,
                            }
                        }),
                    )
                    .await?;
                }
                ServerEvent::ModelChanged {
                    model,
                    provider_name,
                    error,
                    ..
                } => {
                    // Mid-prompt model changes happen on provider failover;
                    // keep the selector in sync.
                    if error.is_none() {
                        let config_options = {
                            let mut state = session.ui_state.lock().await;
                            state.model = Some(model);
                            if provider_name.is_some() {
                                state.provider_name = provider_name;
                            }
                            session_config_options(&state)
                        };
                        if !config_options.is_empty() {
                            self.write_notification(
                                "session/update",
                                json!({
                                    "sessionId": session.session_id,
                                    "update": {
                                        "sessionUpdate": "config_option_update",
                                        "configOptions": config_options,
                                    }
                                }),
                            )
                            .await?;
                        }
                    }
                }
                ServerEvent::SessionRenamed { display_title, .. } => {
                    *session.title.lock().await = Some(display_title.clone());
                    self.write_notification(
                        "session/update",
                        json!({
                            "sessionId": session.session_id,
                            "update": {
                                "sessionUpdate": "session_info_update",
                                "title": display_title,
                            }
                        }),
                    )
                    .await?;
                }
                other => {
                    let is_todo_done = matches!(
                        &other,
                        ServerEvent::ToolDone { name, error: None, .. }
                            if matches!(name.as_str(), "todo" | "todo_write")
                    );
                    for update in mapper.map_event(other) {
                        self.write_notification(
                            "session/update",
                            json!({
                                "sessionId": session.session_id,
                                "update": update,
                            }),
                        )
                        .await?;
                    }
                    if is_todo_done
                        && let Ok(todos) = crate::todo::load_todos(&session.session_id)
                    {
                        let entries = todos_to_plan_entries(&todos);
                        self.write_notification(
                            "session/update",
                            json!({
                                "sessionId": session.session_id,
                                "update": {
                                    "sessionUpdate": "plan",
                                    "entries": entries,
                                }
                            }),
                        )
                        .await?;
                    }
                }
            }
        }

        session.touch_activity();
        let stop_reason = outcome.stop_reason(session.cancel_requested.load(Ordering::SeqCst));
        self.write_result(rpc_id, prompt_response(stop_reason, &turn_usage))
            .await?;
        Ok(())
    }

    async fn run_session_command(
        &self,
        session: &DaemonSession,
        command: AcpSlashCommand,
    ) -> Result<String> {
        match command {
            AcpSlashCommand::Model(None) => {
                let state = session.ui_state.lock().await;
                Ok(match state.model.as_deref() {
                    Some(model) => format!("Current model: `{model}`"),
                    None => "The daemon did not report a current model.".to_string(),
                })
            }
            AcpSlashCommand::Model(Some(model)) => {
                let id = session.next_id();
                session
                    .send(&Request::SetModel {
                        id,
                        model: model.clone(),
                    })
                    .await?;
                wait_for_model_changed(session, id).await?;
                self.write_config_option_update(session).await?;
                let selected = session.ui_state.lock().await.model.clone().unwrap_or(model);
                Ok(format!("Switched model to `{selected}`."))
            }
            AcpSlashCommand::Models => {
                let event = request_model_catalog(session).await?;
                let ServerEvent::History {
                    provider_name,
                    provider_model,
                    available_models,
                    ..
                } = event
                else {
                    unreachable!("request_model_catalog only returns history")
                };
                let (current, models) = {
                    let mut state = session.ui_state.lock().await;
                    if provider_name.is_some() {
                        state.provider_name = provider_name;
                    }
                    if provider_model.is_some() {
                        state.model = provider_model;
                    }
                    state.available_models = available_models;
                    (state.model.clone(), state.available_models.clone())
                };
                self.write_config_option_update(session).await?;
                Ok(format_model_catalog(current.as_deref(), &models))
            }
            AcpSlashCommand::Effort(None) => {
                let state = session.ui_state.lock().await;
                let current = state
                    .reasoning_effort
                    .as_deref()
                    .unwrap_or("provider default");
                let available = available_efforts(&state);
                if available.is_empty() {
                    Ok(format!("Current reasoning effort: `{current}`."))
                } else {
                    Ok(format!(
                        "Current reasoning effort: `{current}`. Available: {}.",
                        available
                            .iter()
                            .map(|effort| format!("`{effort}`"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                }
            }
            AcpSlashCommand::Effort(Some(effort)) => {
                let id = session.next_id();
                session
                    .send(&Request::SetReasoningEffort {
                        id,
                        effort: effort.clone(),
                        target_session_id: None,
                    })
                    .await?;
                wait_for_effort_changed(session, id).await?;
                self.write_config_option_update(session).await?;
                let selected = session
                    .ui_state
                    .lock()
                    .await
                    .reasoning_effort
                    .clone()
                    .unwrap_or(effort);
                Ok(format!("Set reasoning effort to `{selected}`."))
            }
            AcpSlashCommand::Mode(None) => {
                let current = session
                    .ui_state
                    .lock()
                    .await
                    .permission_mode
                    .map(acp_mode_id)
                    .unwrap_or("default");
                Ok(format!(
                    "Current mode: `{current}`. Available: `default`, `accept_edits`, `plan`, `full_manage`, `orchestrator`."
                ))
            }
            AcpSlashCommand::Mode(Some(raw)) => {
                let Some(mode) = parse_acp_mode(&raw) else {
                    anyhow::bail!(
                        "Unknown mode `{raw}`. Valid modes: default, accept_edits, plan, full_manage, orchestrator."
                    );
                };
                apply_permission_mode_idle(session, mode).await?;
                session.ui_state.lock().await.permission_mode = Some(mode);
                self.write_mode_and_config_updates(session, mode).await?;
                Ok(format!("Switched mode to `{}`.", acp_mode_id(mode)))
            }
        }
    }

    async fn write_config_option_update(&self, session: &DaemonSession) -> Result<()> {
        let config_options = session_config_options(&*session.ui_state.lock().await);
        self.write_notification(
            "session/update",
            json!({
                "sessionId": session.session_id,
                "update": {
                    "sessionUpdate": "config_option_update",
                    "configOptions": config_options,
                }
            }),
        )
        .await
    }

    async fn write_result(&self, id: Value, result: Value) -> Result<()> {
        self.write_value(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
        .await
    }

    async fn write_error_value(&self, id: Value, code: i64, message: String) -> Result<()> {
        self.write_error_with_data(id, code, message, None).await
    }

    async fn write_error_with_data(
        &self,
        id: Value,
        code: i64,
        message: String,
        data: Option<Value>,
    ) -> Result<()> {
        let mut error = json!({
            "code": code,
            "message": message,
        });
        if let Some(data) = data
            && let Some(obj) = error.as_object_mut()
        {
            obj.insert("data".to_string(), data);
        }
        self.write_value(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": error,
        }))
        .await
    }

    async fn write_notification(&self, method: &str, params: Value) -> Result<()> {
        self.write_value(json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .await
    }

    async fn write_rayu_extension_event(
        &self,
        session_id: &str,
        event: &ServerEvent,
    ) -> Result<()> {
        self.write_notification(
            "_rayu/server_event",
            json!({
                "sessionId": session_id,
                "event": serde_json::to_value(event).unwrap_or(Value::Null),
            }),
        )
        .await
    }

    async fn write_value(&self, value: Value) -> Result<()> {
        let mut writer = self.writer.lock().await;
        let mut line = serde_json::to_string(&value)?;
        line.push('\n');
        writer.write_all(line.as_bytes()).await?;
        writer.flush().await?;
        Ok(())
    }
}

async fn cleanup_prompt_state(session: &DaemonSession) {
    {
        let mut active = session.active_prompt_id.lock().await;
        *active = None;
    }
    session.reset_cancel();
    session.prompt_running.store(false, Ordering::SeqCst);
}

async fn wait_for_done(session: &DaemonSession, request_id: u64) -> Result<()> {
    loop {
        match session.read_event().await? {
            ServerEvent::Ack { .. } => {}
            ServerEvent::Done { id } if id == request_id => return Ok(()),
            ServerEvent::Error { id, message, .. } if id == request_id => anyhow::bail!(message),
            _ => {}
        }
    }
}

async fn wait_for_ack_or_error(session: &DaemonSession, request_id: u64) -> Result<()> {
    loop {
        match session.read_event().await? {
            ServerEvent::Ack { id } | ServerEvent::Done { id } if id == request_id => {
                return Ok(());
            }
            ServerEvent::Error { id, message, .. } if id == request_id => anyhow::bail!(message),
            _ => {}
        }
    }
}

async fn apply_permission_mode_idle(session: &DaemonSession, mode: PermissionMode) -> Result<()> {
    let request_id = session.next_id();
    session
        .send(&Request::SetPermissionMode {
            id: request_id,
            mode,
        })
        .await?;
    wait_for_ack_or_error(session, request_id).await
}

async fn request_split(session: &DaemonSession) -> Result<String> {
    let id = session.next_id();
    session.send(&Request::Split { id }).await?;
    loop {
        match session.read_event().await? {
            ServerEvent::Ack { .. } => {}
            ServerEvent::SplitResponse {
                id: event_id,
                new_session_id,
                ..
            } if event_id == id => return Ok(new_session_id),
            ServerEvent::Error {
                id: event_id,
                message,
                ..
            } if event_id == id => anyhow::bail!(message),
            _ => {}
        }
    }
}

async fn request_history(session: &DaemonSession) -> Result<ServerEvent> {
    let id = session.next_id();
    session.send(&Request::GetHistory { id }).await?;
    loop {
        match session.read_event().await? {
            ServerEvent::Ack { .. } => {}
            event @ ServerEvent::History { id: event_id, .. } if event_id == id => {
                return Ok(event);
            }
            ServerEvent::Error {
                id: event_id,
                message,
                ..
            } if event_id == id => anyhow::bail!(message),
            _ => {}
        }
    }
}

async fn request_model_catalog(session: &DaemonSession) -> Result<ServerEvent> {
    let id = session.next_id();
    session
        .send(&Request::GetModelCatalog {
            id,
            subscribe_usage_updates: false,
        })
        .await?;
    loop {
        match session.read_event().await? {
            ServerEvent::Ack { .. } => {}
            event @ ServerEvent::History { id: event_id, .. } if event_id == id => {
                return Ok(event);
            }
            ServerEvent::Error {
                id: event_id,
                message,
                ..
            } if event_id == id => anyhow::bail!(message),
            _ => {}
        }
    }
}

async fn wait_for_model_changed(session: &DaemonSession, request_id: u64) -> Result<()> {
    loop {
        match session.read_event().await? {
            ServerEvent::Ack { .. } => {}
            ServerEvent::ModelChanged {
                id,
                model,
                provider_name,
                error,
                ..
            } if id == request_id => {
                if let Some(error) = error {
                    anyhow::bail!(error);
                }
                let mut state = session.ui_state.lock().await;
                state.model = Some(model);
                if provider_name.is_some() {
                    state.provider_name = provider_name;
                }
                return Ok(());
            }
            ServerEvent::Error { id, message, .. } if id == request_id => {
                anyhow::bail!(message)
            }
            _ => {}
        }
    }
}

async fn wait_for_effort_changed(session: &DaemonSession, request_id: u64) -> Result<()> {
    loop {
        match session.read_event().await? {
            ServerEvent::Ack { .. } => {}
            ServerEvent::ReasoningEffortChanged { id, effort, error } if id == request_id => {
                if let Some(error) = error {
                    anyhow::bail!(error);
                }
                let mut state = session.ui_state.lock().await;
                state.reasoning_effort = effort;
                return Ok(());
            }
            ServerEvent::Error { id, message, .. } if id == request_id => {
                anyhow::bail!(message)
            }
            _ => {}
        }
    }
}

/// Build standard ACP `session/request_permission` params for a daemon permission gate event.
fn build_permission_request_params(
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    description: &str,
    input: &Value,
    risk_tier: Option<&str>,
    working_dir: Option<&Path>,
) -> Value {
    let title = if description.trim().is_empty() {
        tool_title(tool_name)
    } else {
        description.to_string()
    };
    let mut tool_call = json!({
        "toolCallId": tool_call_id,
        "title": title,
        "kind": tool_kind(tool_name),
        "status": "pending",
        "rawInput": input,
    });
    let locations = extract_tool_locations(input, working_dir);
    if !locations.is_empty()
        && let Some(obj) = tool_call.as_object_mut()
    {
        obj.insert("locations".to_string(), Value::Array(locations));
    }
    if let Some(tier) = risk_tier
        && let Some(obj) = tool_call.as_object_mut()
    {
        obj.insert("_meta".to_string(), json!({ "riskTier": tier }));
    }

    json!({
        "sessionId": session_id,
        "toolCall": tool_call,
        "options": [
            {
                "optionId": "allow_once",
                "name": "Allow once",
                "kind": "allow_once",
            },
            {
                "optionId": "allow_always",
                "name": "Always allow",
                "kind": "allow_always",
            },
            {
                "optionId": "reject_once",
                "name": "Reject",
                "kind": "reject_once",
            },
        ],
    })
}

/// Parse an ACP `RequestPermissionResponse` payload into a daemon [`PermissionDecision`].
fn parse_permission_decision(response: &Value) -> PermissionDecision {
    let outcome_obj = response.get("outcome").unwrap_or(response);
    let outcome_kind = outcome_obj
        .get("outcome")
        .and_then(Value::as_str)
        .or_else(|| response.get("outcome").and_then(Value::as_str));
    if matches!(outcome_kind, Some("cancelled" | "canceled")) {
        return PermissionDecision::Deny;
    }
    let option_id = outcome_obj
        .get("optionId")
        .or_else(|| response.get("optionId"))
        .and_then(Value::as_str)
        .map(|s| s.trim().to_ascii_lowercase());
    match option_id.as_deref() {
        Some("allow_once" | "allow") => PermissionDecision::Allow,
        Some("allow_always" | "always" | "always_allow") => PermissionDecision::AllowAlways,
        _ => PermissionDecision::Deny,
    }
}

struct EventMapper {
    session_id: String,
    profile: AcpProfile,
    working_dir: Option<PathBuf>,
    current_tool_id: Option<String>,
    tool_inputs: HashMap<String, String>,
    active_tools_by_name: HashMap<String, String>,
}

impl EventMapper {
    fn new(session_id: String, profile: AcpProfile) -> Self {
        Self {
            session_id,
            profile,
            working_dir: None,
            current_tool_id: None,
            tool_inputs: HashMap::new(),
            active_tools_by_name: HashMap::new(),
        }
    }

    fn with_working_dir(mut self, working_dir: Option<PathBuf>) -> Self {
        self.working_dir = working_dir;
        self
    }

    fn active_tool_id(&self, tool_name: &str) -> Option<String> {
        self.active_tools_by_name.get(tool_name).cloned()
    }

    fn map_event(&mut self, event: ServerEvent) -> Vec<Value> {
        match super::commands::unwrap_turn_event(event) {
            ServerEvent::TextDelta { text } => vec![agent_message_chunk(text)],
            ServerEvent::TextReplace { text } => vec![agent_message_chunk(text)],
            // ACP chunks cannot retract prior output. Surface the corrected
            // source links rather than silently discarding provider metadata.
            ServerEvent::TextSuffixReplace { new_text, .. } => {
                vec![agent_message_chunk(format!("\n{new_text}"))]
            }
            ServerEvent::ReasoningDelta { text } => vec![agent_thought_chunk(text)],
            ServerEvent::ToolStart { id, name } => {
                self.current_tool_id = Some(id.clone());
                self.active_tools_by_name.insert(name.clone(), id.clone());
                self.tool_inputs.entry(id.clone()).or_default();
                vec![json!({
                    "sessionUpdate": "tool_call",
                    "toolCallId": id,
                    "title": tool_title(&name),
                    "kind": tool_kind(&name),
                    "status": "pending",
                })]
            }
            ServerEvent::ToolInput { id, delta } => {
                // Older daemons omit the ID. Only those events should use the
                // most recently started tool, since keyed streams can overlap.
                let Some(tool_id) = id.or_else(|| self.current_tool_id.clone()) else {
                    return Vec::new();
                };
                let buffer = self.tool_inputs.entry(tool_id.clone()).or_default();
                buffer.push_str(&delta);
                let Some(raw_input) = parse_json_object(buffer) else {
                    return Vec::new();
                };
                let mut update = json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": tool_id,
                    "rawInput": raw_input,
                });
                let locations =
                    extract_tool_locations(&update["rawInput"], self.working_dir.as_deref());
                if !locations.is_empty()
                    && let Some(object) = update.as_object_mut()
                {
                    object.insert("locations".to_string(), Value::Array(locations));
                }
                vec![update]
            }
            ServerEvent::ToolExec { id, name } => {
                self.current_tool_id = Some(id.clone());
                self.active_tools_by_name.insert(name.clone(), id.clone());
                let mut update = json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": id,
                    "title": tool_title(&name),
                    "kind": tool_kind(&name),
                    "status": "in_progress",
                });
                if let Some(input) = self
                    .tool_inputs
                    .get(update["toolCallId"].as_str().unwrap_or_default())
                    && let Some(raw_input) = parse_json_object(input)
                    && let Some(object) = update.as_object_mut()
                {
                    let locations =
                        extract_tool_locations(&raw_input, self.working_dir.as_deref());
                    if !locations.is_empty() {
                        object.insert("locations".to_string(), Value::Array(locations));
                    }
                    object.insert("rawInput".to_string(), raw_input);
                }
                vec![update]
            }
            ServerEvent::BashProgress { update } => {
                let snapshot = update.snapshot();
                if snapshot.tail.is_empty() {
                    return Vec::new();
                }
                vec![json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": snapshot.call_id,
                    "status": "in_progress",
                    "content": [{
                        "type": "content",
                        "content": {
                            "type": "text",
                            "text": snapshot.tail,
                        }
                    }]
                })]
            }
            ServerEvent::ToolDone {
                id,
                name,
                output,
                error,
                ..
            } => {
                let raw_input = self
                    .tool_inputs
                    .remove(&id)
                    .and_then(|input| parse_json_object(&input));
                if self.active_tools_by_name.get(&name).map(String::as_str) == Some(id.as_str()) {
                    self.active_tools_by_name.remove(&name);
                }
                if self.current_tool_id.as_deref() == Some(id.as_str()) {
                    self.current_tool_id = None;
                }
                let mut content = Vec::new();
                if error.is_none()
                    && let Some(ref input) = raw_input
                    && let Some(diff) =
                        extract_tool_diff(&name, input, self.working_dir.as_deref())
                {
                    content.push(diff);
                }
                content.push(json!({
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": output,
                    }
                }));
                let mut update = json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": id,
                    "title": tool_title(&name),
                    "kind": tool_kind(&name),
                    "status": if error.is_some() { "failed" } else { "completed" },
                    "content": content,
                    "rawOutput": {
                        "output": output,
                        "error": error,
                    }
                });
                if let Some(ref input) = raw_input {
                    let locations = extract_tool_locations(input, self.working_dir.as_deref());
                    if !locations.is_empty()
                        && let Some(object) = update.as_object_mut()
                    {
                        object.insert("locations".to_string(), Value::Array(locations));
                    }
                }
                vec![update]
            }
            ServerEvent::Todos { payload, .. } => {
                let entries = parse_todos_payload_to_plan_entries(&payload);
                vec![json!({
                    "sessionUpdate": "plan",
                    "entries": entries,
                })]
            }
            ServerEvent::SwarmPlan { items, .. } => {
                let entries: Vec<Value> = items
                    .into_iter()
                    .map(|item| {
                        json!({
                            "content": item.content,
                            "priority": normalize_plan_priority(&item.priority),
                            "status": normalize_plan_status(&item.status),
                        })
                    })
                    .collect();
                vec![json!({
                    "sessionUpdate": "plan",
                    "entries": entries,
                })]
            }
            ServerEvent::GeneratedImage {
                id,
                path,
                output_format,
                revised_prompt,
                ..
            } => vec![json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": id,
                "status": "completed",
                "content": [{
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": format!("Generated image: {path} ({output_format}){}", revised_prompt.map(|prompt| format!("\nRevised prompt: {prompt}")).unwrap_or_default()),
                    }
                }]
            })],
            ServerEvent::Compaction { trigger, .. } if self.profile.is_extended() => vec![json!({
                "sessionUpdate": "agent_message_chunk",
                "content": {
                    "type": "text",
                    "text": format!("\n[Rayu compacted context: {trigger}]\n"),
                }
            })],
            ServerEvent::SessionRenamed { display_title, .. } => vec![json!({
                "sessionUpdate": "session_info_update",
                "title": display_title,
            })],
            ServerEvent::McpStatus { servers } if self.profile.is_extended() => vec![json!({
                "sessionUpdate": "agent_message_chunk",
                "content": {
                    "type": "text",
                    "text": format!("\n[Rayu MCP status: {}]\n", servers.join(", ")),
                }
            })],
            _ => {
                let _ = &self.session_id;
                Vec::new()
            }
        }
    }
}

fn normalize_plan_priority(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "high" | "urgent" | "critical" | "p0" | "p1" => "high",
        "low" | "minor" | "p3" => "low",
        _ => "medium",
    }
}

fn normalize_plan_status(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "completed" | "complete" | "done" => "completed",
        "in_progress" | "in-progress" | "running" | "active" => "in_progress",
        _ => "pending",
    }
}

fn todos_to_plan_entries(todos: &[crate::todo::TodoItem]) -> Vec<Value> {
    todos
        .iter()
        .map(|todo| {
            json!({
                "content": todo.content,
                "priority": normalize_plan_priority(&todo.priority),
                "status": normalize_plan_status(&todo.status),
            })
        })
        .collect()
}

fn parse_todos_payload_to_plan_entries(payload: &str) -> Vec<Value> {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return Vec::new();
    };
    let items = value
        .get("todos")
        .and_then(Value::as_array)
        .or_else(|| value.as_array());
    let Some(items) = items else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let content = item.get("content").and_then(Value::as_str)?;
            let priority = item
                .get("priority")
                .and_then(Value::as_str)
                .unwrap_or("medium");
            let status = item
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            Some(json!({
                "content": content,
                "priority": normalize_plan_priority(priority),
                "status": normalize_plan_status(status),
            }))
        })
        .collect()
}

fn resolve_tool_path(raw: &str, working_dir: Option<&Path>) -> String {
    let path = Path::new(raw);
    if path.is_absolute() {
        raw.to_string()
    } else if let Some(base) = working_dir {
        base.join(path).display().to_string()
    } else {
        raw.to_string()
    }
}

fn extract_tool_locations(raw_input: &Value, working_dir: Option<&Path>) -> Vec<Value> {
    let Some(obj) = raw_input.as_object() else {
        return Vec::new();
    };
    let path_str = ["file_path", "path", "target_path"]
        .iter()
        .find_map(|key| obj.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(path_str) = path_str else {
        return Vec::new();
    };
    let resolved = resolve_tool_path(path_str, working_dir);
    let line = ["line", "start_line", "offset"]
        .iter()
        .find_map(|key| obj.get(*key).and_then(Value::as_u64))
        .filter(|n| *n >= 1);
    let mut loc = json!({ "path": resolved });
    if let Some(line) = line
        && let Some(map) = loc.as_object_mut()
    {
        map.insert("line".to_string(), json!(line));
    }
    vec![loc]
}

fn extract_tool_diff(tool_name: &str, raw_input: &Value, working_dir: Option<&Path>) -> Option<Value> {
    let obj = raw_input.as_object()?;
    let path_str = ["file_path", "path", "target_path"]
        .iter()
        .find_map(|key| obj.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let resolved = resolve_tool_path(path_str, working_dir);

    match tool_name {
        "edit" | "replace" => {
            let old_text = ["old_string", "old_text", "oldString", "oldText"]
                .iter()
                .find_map(|key| obj.get(*key).and_then(Value::as_str))?;
            let new_text = ["new_string", "new_text", "newString", "newText"]
                .iter()
                .find_map(|key| obj.get(*key).and_then(Value::as_str))?;
            Some(json!({
                "type": "diff",
                "path": resolved,
                "oldText": old_text,
                "newText": new_text,
            }))
        }
        "write" => {
            let new_text = obj.get("content").and_then(Value::as_str)?;
            Some(json!({
                "type": "diff",
                "path": resolved,
                "oldText": Value::Null,
                "newText": new_text,
            }))
        }
        _ => None,
    }
}

fn parse_json_object(input: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(input).ok()?;
    value.as_object()?;
    Some(value)
}

fn compatibility_option_value(
    params: &Value,
    value_fields: &[&str],
    method: &str,
) -> std::result::Result<String, String> {
    if !params.is_object() {
        return Err(format!("{method} params must be an object"));
    }
    value_fields
        .iter()
        .find_map(|field| {
            params
                .get(*field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .ok_or_else(|| {
            format!(
                "{method} requires a non-empty string {}",
                value_fields.join(" or ")
            )
        })
}

#[cfg(test)]
fn initialize_result(params: &Value, profile: AcpProfile) -> Value {
    let caps = ClientCapabilities::from_initialize_params(params);
    initialize_result_with_caps(params, profile, &caps)
}

fn initialize_result_with_caps(
    params: &Value,
    profile: AcpProfile,
    client_caps: &ClientCapabilities,
) -> Value {
    // We speak ACP_PROTOCOL_VERSION (v1); pin the negotiated version to our
    // highest supported version per the ACP initialization spec.
    let _ = params;
    let protocol_version = ACP_PROTOCOL_VERSION;
    let mut agent_capabilities = json!({
        "loadSession": true,
        "promptCapabilities": {
            "image": true,
            "audio": false,
            "embeddedContext": true,
        },
        "mcpCapabilities": {
            "http": true,
            "sse": true,
        },
        "sessionCapabilities": {
            "list": {},
            "fork": {},
            "resume": {},
            "close": {},
            "delete": {},
        }
    });

    if profile.is_extended()
        && let Some(object) = agent_capabilities.as_object_mut()
    {
        object.insert(
            "_meta".to_string(),
            json!({
                "rayu": {
                    "profile": profile.as_str(),
                    "extensions": ["raw_server_event"]
                }
            }),
        );
    }

    json!({
        "protocolVersion": protocol_version,
        "agentCapabilities": agent_capabilities,
        "agentInfo": {
            "name": "rayu",
            "title": "RayuCode",
            "version": rayucode_build_meta::pkg_version(),
        },
        "authMethods": auth::auth_methods(client_caps),
    })
}

fn cwd_from_params(params: &Value) -> std::result::Result<PathBuf, String> {
    let cwd = match params.get("cwd").and_then(Value::as_str) {
        Some(cwd) if !cwd.trim().is_empty() => PathBuf::from(cwd),
        _ => std::env::current_dir().map_err(|err| err.to_string())?,
    };
    if !cwd.is_absolute() {
        return Err(format!("ACP cwd must be absolute: {}", cwd.display()));
    }
    Ok(cwd)
}

fn optional_cwd_from_params(params: &Value) -> std::result::Result<Option<PathBuf>, String> {
    let Some(raw) = params
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return Ok(None);
    };
    let cwd = PathBuf::from(raw);
    if !cwd.is_absolute() {
        return Err(format!("ACP cwd must be absolute: {}", cwd.display()));
    }
    Ok(Some(cwd))
}

fn required_session_id(params: &Value) -> std::result::Result<String, String> {
    params
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Missing required sessionId".to_string())
}

#[cfg(test)]
fn validate_acp_mcp_servers(params: &Value) -> std::result::Result<(), String> {
    mcp_bridge::parse_acp_mcp_servers(params).map(|_| ())
}

/// Read an explicit skill selection from ACP prompt metadata. Accepts
/// `_meta.rayu.skill`, `_meta.rayu.activeSkill`, `_meta.skill`, and
/// `_meta.activeSkill`.
fn explicit_skill_from_params(params: &Value) -> Option<String> {
    let meta = params.get("_meta")?;
    [meta.get("rayu"), Some(meta)]
        .into_iter()
        .flatten()
        .flat_map(|object| ["skill", "activeSkill", "active_skill"].map(|key| object.get(key)))
        .flatten()
        .filter_map(Value::as_str)
        .map(|name| name.trim().trim_start_matches(['/', '$']).trim())
        .find(|name| !name.is_empty())
        .map(str::to_string)
}

/// Resolve `/name [prompt]` or `$name [prompt]` to a registered skill. Returns
/// `None` for unknown names and path-like text so it reaches the model as-is.
fn resolve_acp_skill_invocation(
    skills: &crate::skill::SkillRegistry,
    text: &str,
) -> Option<(String, Option<String>)> {
    let trimmed = text.trim_end();
    // Like built-in commands, a leading space escapes skill interpretation.
    let normalized = if let Some(rest) = trimmed.strip_prefix('$') {
        format!("/{rest}")
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        return None;
    };
    let invocation = skills.resolve_invocation(&normalized)?;
    skills.get(invocation.name)?;
    Some((
        invocation.name.to_string(),
        invocation.prompt.map(str::to_string),
    ))
}

/// ACP `availableCommands` entries for installed skills. Skills whose names
/// contain whitespace or shadow built-in commands are not advertised (they can
/// still be invoked by typing the slash command).
fn acp_skill_commands(skills: &crate::skill::SkillRegistry) -> Vec<Value> {
    const BUILTIN: [&str; 4] = ["model", "models", "effort", "mode"];
    skills
        .list()
        .into_iter()
        .filter(|skill| {
            !skill.name.is_empty()
                && !skill.name.contains(char::is_whitespace)
                && !BUILTIN.contains(&skill.name.as_str())
        })
        .map(|skill| {
            json!({
                "name": skill.name,
                "description": skill.description,
                "input": { "hint": "request for this skill (optional)" },
            })
        })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
enum AcpSlashCommand {
    Model(Option<String>),
    Models,
    Effort(Option<String>),
    Mode(Option<String>),
}

fn parse_acp_slash_command(text: &str) -> Option<Result<AcpSlashCommand>> {
    // A leading space is the ACP client convention for escaping slash command
    // interpretation and sending the text to the model literally.
    let trimmed = text.trim_end();
    let body = trimmed.strip_prefix('/')?;
    let mut parts = body.splitn(2, char::is_whitespace);
    let name = parts.next().unwrap_or_default();
    let argument = parts
        .next()
        .map(str::trim)
        .filter(|argument| !argument.is_empty())
        .map(str::to_string);
    match name {
        "model" => Some(Ok(AcpSlashCommand::Model(argument))),
        "models" if argument.is_none() => Some(Ok(AcpSlashCommand::Models)),
        "models" => Some(Err(anyhow::anyhow!("/models does not accept an argument"))),
        "effort" => Some(Ok(AcpSlashCommand::Effort(argument))),
        "mode" => Some(Ok(AcpSlashCommand::Mode(argument))),
        _ => None,
    }
}

fn format_model_catalog(current: Option<&str>, models: &[String]) -> String {
    if models.is_empty() {
        return match current {
            Some(current) => format!("Current model: `{current}`. No model catalog was reported."),
            None => "The active provider did not report a model catalog.".to_string(),
        };
    }
    let mut output = String::from("Available models:\n");
    for model in models {
        let selected = if Some(model.as_str()) == current {
            " (current)"
        } else {
            ""
        };
        output.push_str(&format!("- `{model}`{selected}\n"));
    }
    output.pop();
    output
}

fn prompt_from_params(
    params: &Value,
) -> std::result::Result<(String, Vec<(String, String)>), String> {
    let prompt = params
        .get("prompt")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing required prompt array".to_string())?;
    let mut text_parts = Vec::new();
    let mut images = Vec::new();

    for block in prompt {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    text_parts.push(text.to_string());
                }
            }
            Some("image") => {
                let mime_type = block
                    .get("mimeType")
                    .or_else(|| block.get("mime_type"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Image content block missing mimeType".to_string())?;
                let data = block
                    .get("data")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Image content block missing data".to_string())?;
                images.push((mime_type.to_string(), data.to_string()));
            }
            Some("resource") => {
                if let Some(resource) = block.get("resource") {
                    text_parts.push(format_resource_block(resource));
                }
            }
            Some("resource_link") => {
                let uri = block.get("uri").and_then(Value::as_str).unwrap_or("");
                let name = block.get("name").and_then(Value::as_str).unwrap_or(uri);
                text_parts.push(format!("[Resource link: {name} <{uri}>]"));
            }
            Some(other) => {
                return Err(format!(
                    "Unsupported ACP prompt content block type: {other}"
                ));
            }
            None => return Err("Prompt content block missing type".to_string()),
        }
    }

    Ok((text_parts.join("\n\n"), images))
}

fn format_resource_block(resource: &Value) -> String {
    let uri = resource
        .get("uri")
        .and_then(Value::as_str)
        .unwrap_or("resource");
    if let Some(text) = resource.get("text").and_then(Value::as_str) {
        format!("[Embedded resource: {uri}]\n{text}")
    } else if let Some(blob) = resource.get("blob").and_then(Value::as_str) {
        let mime = resource
            .get("mimeType")
            .or_else(|| resource.get("mime_type"))
            .and_then(Value::as_str)
            .unwrap_or("application/octet-stream");
        format!(
            "[Embedded binary resource: {uri} ({mime}, {} base64 bytes)]",
            blob.len()
        )
    } else {
        format!("[Embedded resource: {uri}]")
    }
}

fn agent_message_chunk(text: String) -> Value {
    json!({
        "sessionUpdate": "agent_message_chunk",
        "content": {
            "type": "text",
            "text": text,
        }
    })
}

fn agent_thought_chunk(text: String) -> Value {
    json!({
        "sessionUpdate": "agent_thought_chunk",
        "content": {
            "type": "text",
            "text": text,
        }
    })
}

fn tool_title(name: &str) -> String {
    if let Some(rest) = name.strip_prefix("mcp__")
        && let Some((server, tool)) = rest.split_once("__")
    {
        return format!("MCP: {server}/{tool}");
    }
    match name {
        "bash" => "Running shell command".to_string(),
        "read" => "Reading file".to_string(),
        "write" => "Writing file".to_string(),
        "edit" | "multiedit" | "patch" | "apply_patch" | "replace" => "Editing files".to_string(),
        "agentgrep" | "grep" | "glob" | "ls" => "Searching workspace".to_string(),
        "webfetch" | "websearch" => "Fetching web content".to_string(),
        "todo" | "todo_write" => "Updating plan".to_string(),
        other => other.replace('_', " "),
    }
}

pub(crate) fn tool_kind(name: &str) -> &'static str {
    match name {
        "read" => "read",
        "write" | "edit" | "multiedit" | "patch" | "apply_patch" | "replace" => "edit",
        "rm" | "delete" | "remove" => "delete",
        "mv" | "move" | "rename" => "move",
        "bash" | "bg" | "selfdev" => "execute",
        "agentgrep" | "grep" | "glob" | "ls" | "session_search" | "conversation_search" => "search",
        "webfetch" | "websearch" | "codesearch" => "fetch",
        "todo" | "todo_write" => "think",
        _ => "other",
    }
}

pub(crate) async fn run_acp_command(
    provider_choice: ProviderChoice,
    model: Option<String>,
    provider_profile: Option<String>,
    explicit_tool_profile: bool,
    profile_override: Option<String>,
    product_override: Option<String>,
) -> Result<()> {
    crate::env::set_var("RAYU_NON_INTERACTIVE", "1");
    if let Some(product) = product_override
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        crate::env::set_var(crate::rayu::RAYU_CLIENT_PRODUCT_ENV, product);
    }
    let acp_config = crate::config::config().acp.clone();
    if !explicit_tool_profile {
        crate::env::set_var("RAYU_TOOL_PROFILE", acp_config.tool_profile.trim());
        crate::config::invalidate_config_cache();
    }
    let resolved_profile = profile_override
        .or_else(|| std::env::var("RAYU_ACP_PROFILE").ok())
        .unwrap_or(acp_config.profile);
    let profile = AcpProfile::parse(&resolved_profile);
    AcpRuntime::new(profile, provider_choice, model, provider_profile)
        .run()
        .await
}

#[cfg(test)]
mod turn_envelope_tests {
    use super::*;
    use crate::protocol::TurnIdentity;

    fn envelope(event: ServerEvent) -> ServerEvent {
        ServerEvent::TurnEvent {
            identity: TurnIdentity {
                runtime_generation: "runtime-test".into(),
                turn_id: 7,
            },
            event: Box::new(event),
        }
    }

    #[test]
    fn mapper_preserves_explicit_wrapped_text_and_tool_events() {
        for event in [
            ServerEvent::TextDelta {
                text: "hello".into(),
            },
            ServerEvent::ToolStart {
                id: "tool-1".into(),
                name: "read".into(),
            },
        ] {
            let plain =
                EventMapper::new("session".into(), AcpProfile::Standard).map_event(event.clone());
            let wrapped = EventMapper::new("session".into(), AcpProfile::Standard)
                .map_event(envelope(envelope(event)));
            assert!(!plain.is_empty());
            assert_eq!(wrapped, plain);
        }
    }

    #[tokio::test]
    async fn reader_unwraps_terminal_events_before_request_waiters() {
        let (client, peer) = crate::transport::stream_pair().unwrap();
        let (reader, writer) = client.into_split();
        let session = DaemonSession::new("session".into(), reader, writer, 1);
        let (_, mut peer_writer) = peer.into_split();
        let event = envelope(envelope(ServerEvent::Done { id: 42 }));
        let mut json = serde_json::to_string(&event).unwrap();
        json.push('\n');
        peer_writer.write_all(json.as_bytes()).await.unwrap();
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            wait_for_done(&session, 42),
        )
        .await
        .expect("wrapped Done must terminate request waiter")
        .unwrap();
    }
}

#[cfg(test)]
mod tests;
