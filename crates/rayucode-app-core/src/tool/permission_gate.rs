use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, anyhow, bail};
use rayucode_message_types::ToolDefinition;
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};

use crate::protocol::{PermissionDecision, PermissionMode, ServerEvent};

tokio::task_local! {
    static TURN_PERMISSION_CLIENT: Option<(String, Arc<PermissionConnection>)>;
}

/// Coarse capability class used to enforce session `PermissionMode` policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ToolPermissionClass {
    ReadOnly,
    Edit,
    Coordinate,
    Command,
}

/// Classify a built-in, custom SDK, or MCP tool into its permission class.
pub(crate) fn classify_tool(name: &str) -> ToolPermissionClass {
    let unqualified = name.strip_prefix("functions.").unwrap_or(name);
    if let Some(class) = classify_exact(unqualified) {
        return class;
    }
    let resolved = super::Registry::resolve_tool_name(unqualified);
    classify_exact(resolved).unwrap_or(ToolPermissionClass::Command)
}

fn classify_exact(name: &str) -> Option<ToolPermissionClass> {
    if name.starts_with("todo") {
        return Some(ToolPermissionClass::ReadOnly);
    }
    if name.starts_with("plan") {
        return Some(ToolPermissionClass::Coordinate);
    }
    match name {
        // Read-only / inspection / display tools
        "read"
        | "read_file"
        | "glob"
        | "grep"
        | "agentgrep"
        | "search_files"
        | "ls"
        | "list_files"
        | "read_excel"
        | "browser_snapshot"
        | "list_templates"
        | "memory"
        | "codesearch"
        | "session_search"
        | "conversation_search"
        | "rayu_docs"
        | "webfetch"
        | "websearch"
        | "user_response"
        | "side_panel"
        | "panel" => Some(ToolPermissionClass::ReadOnly),

        // File & document edit tools
        "edit"
        | "multiedit"
        | "write"
        | "patch"
        | "apply_patch"
        | "write_excel"
        | "create_powerpoint"
        | "save_template" => Some(ToolPermissionClass::Edit),

        // Delegation & coordination tools
        "subagent"
        | "swarm"
        | "task"
        | "ask_user_question"
        | "ask_user"
        | "propose_plan" => Some(ToolPermissionClass::Coordinate),

        // Explicit command / external side-effect tools
        "bash"
        | "shell"
        | "run_command"
        | "browser"
        | "browser_navigate"
        | "browser_click"
        | "browser_type" => Some(ToolPermissionClass::Command),

        _ => None,
    }
}

fn canonical_tool_key(session_id: &str, name: &str) -> String {
    super::Registry::resolve_tool_name_for_session(session_id, name).to_string()
}

/// Whether `name` should be hidden from the model's tool definitions under `mode`.
pub(crate) fn is_tool_hidden_for_mode(mode: PermissionMode, name: &str) -> bool {
    match mode {
        PermissionMode::Plan | PermissionMode::Orchestrator => matches!(
            classify_tool(name),
            ToolPermissionClass::Edit | ToolPermissionClass::Command
        ),
        PermissionMode::Default | PermissionMode::AcceptEdits | PermissionMode::FullManage => false,
    }
}

/// Bind a connection-scoped `PermissionConnection` to a turn or tool-listing future.
pub(crate) fn scope<T>(
    session_id: &str,
    connection: Option<Arc<PermissionConnection>>,
    turn: impl Future<Output = T>,
) -> impl Future<Output = T> {
    TURN_PERMISSION_CLIENT.scope(
        connection.map(|connection| (session_id.into(), connection)),
        turn,
    )
}

fn client(session_id: &str) -> Option<Arc<PermissionConnection>> {
    TURN_PERMISSION_CLIENT
        .try_with(|owner| {
            owner.as_ref().and_then(|(owner_session, connection)| {
                (owner_session == session_id).then(|| connection.clone())
            })
        })
        .ok()
        .flatten()
}

/// Active `PermissionMode` for the current task-local session scope, if any.
pub(crate) fn current_mode(session_id: &str) -> Option<PermissionMode> {
    client(session_id).map(|connection| connection.mode())
}

/// Remove tools hidden by the session's active `PermissionMode`.
pub(crate) fn filter_tool_definitions(session_id: &str, tools: &mut Vec<ToolDefinition>) {
    let Some(mode) = current_mode(session_id) else {
        return;
    };
    tools.retain(|tool| !is_tool_hidden_for_mode(mode, &tool.name));
}

/// Synchronous policy check for non-interactive modes (`Plan` and `Orchestrator`).
pub(crate) fn validate_mode_allows(session_id: &str, tool_name: &str) -> Result<()> {
    let Some(connection) = client(session_id) else {
        return Ok(());
    };
    connection.check_mode_policy(tool_name)
}

/// Authorize a tool call against the active `PermissionMode`, prompting the client
/// when interactive approval is required.
pub(crate) async fn authorize(session_id: &str, tool_name: &str, input: &Value) -> Result<()> {
    let Some(connection) = client(session_id) else {
        return Ok(());
    };
    connection.authorize_tool(session_id, tool_name, input).await
}

struct PendingPermission {
    session_id: String,
    answer: oneshot::Sender<PermissionDecision>,
}

struct PermissionState {
    closed: bool,
    interactive_prompts: bool,
    mode: PermissionMode,
    mode_explicitly_set: bool,
    session_allowed_tools: HashSet<(String, String)>,
    pending: HashMap<String, PendingPermission>,
}

/// Per-connection permission gate supporting all 5 local permission modes and
/// non-blocking interactive `PermissionRequest` / `PermissionResponse` exchanges.
pub(crate) struct PermissionConnection {
    events: mpsc::UnboundedSender<ServerEvent>,
    state: Mutex<PermissionState>,
}

impl PermissionConnection {
    /// Create a permission gate for a client that opted into interactive prompts
    /// (`supports_permissions: true`), defaulting to `PermissionMode::Default` (Ask).
    #[allow(dead_code)]
    pub(crate) fn new(events: mpsc::UnboundedSender<ServerEvent>) -> Self {
        Self::new_with_options(events, PermissionMode::Default, true)
    }

    /// Create a backward-compatible non-blocking gate for clients that have not
    /// negotiated `supports_permissions`. Defaults to `FullManage` until explicitly
    /// changed via `set_mode`, and never blocks awaiting interactive prompts.
    pub(crate) fn new_non_interactive(events: mpsc::UnboundedSender<ServerEvent>) -> Self {
        Self::new_with_options(events, PermissionMode::FullManage, false)
    }

    fn new_with_options(
        events: mpsc::UnboundedSender<ServerEvent>,
        mode: PermissionMode,
        interactive_prompts: bool,
    ) -> Self {
        Self {
            events,
            state: Mutex::new(PermissionState {
                closed: false,
                interactive_prompts,
                mode,
                mode_explicitly_set: false,
                session_allowed_tools: HashSet::new(),
                pending: HashMap::new(),
            }),
        }
    }

    /// Update whether this connection can answer interactive permission prompts
    /// (called on `Subscribe`). If the user has not explicitly chosen a mode yet,
    /// interactive clients default to `Default` (Ask) and non-interactive clients
    /// default to `FullManage`.
    pub(crate) fn configure_interactive(&self, enabled: bool) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.interactive_prompts = enabled;
        if !state.mode_explicitly_set {
            state.mode = if enabled {
                PermissionMode::Default
            } else {
                PermissionMode::FullManage
            };
        }
    }

    pub(crate) fn mode(&self) -> PermissionMode {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).mode
    }

    pub(crate) fn set_mode(&self, mode: PermissionMode) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.mode = mode;
        state.mode_explicitly_set = true;
    }

    /// Deny and release every pending permission prompt immediately on disconnect.
    pub(crate) fn close(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.closed = true;
        for (_, pending) in state.pending.drain() {
            let _ = pending.answer.send(PermissionDecision::Deny);
        }
    }

    /// Resolve a pending `PermissionRequest` from the client fast path without
    /// acquiring the `Agent` mutex.
    pub(crate) fn respond(
        &self,
        session_id: &str,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<()> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let matches = state
            .pending
            .get(request_id)
            .is_some_and(|pending| pending.session_id == session_id);
        if !matches {
            bail!("Unknown or closed permission request");
        }
        let pending = state
            .pending
            .remove(request_id)
            .context("Unknown or closed permission request")?;
        pending
            .answer
            .send(decision)
            .map_err(|_| anyhow!("Permission request was cancelled"))
    }

    pub(crate) fn check_mode_policy(&self, tool_name: &str) -> Result<()> {
        let mode = self.mode();
        let class = classify_tool(tool_name);
        match (mode, class) {
            (PermissionMode::Plan, ToolPermissionClass::Edit | ToolPermissionClass::Command) => {
                bail!("Blocked by Plan mode (read-only): tool '{tool_name}' is not allowed")
            }
            (
                PermissionMode::Orchestrator,
                ToolPermissionClass::Edit | ToolPermissionClass::Command,
            ) => {
                bail!(
                    "Blocked by Orchestrator mode: delegate workspace changes to a worker (tool '{tool_name}' is blocked)"
                )
            }
            _ => Ok(()),
        }
    }

    pub(crate) async fn authorize_tool(
        &self,
        session_id: &str,
        tool_name: &str,
        input: &Value,
    ) -> Result<()> {
        self.check_mode_policy(tool_name)?;
        let class = classify_tool(tool_name);
        let tool_key = (session_id.to_string(), canonical_tool_key(session_id, tool_name));

        let (request_id, receiver) = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let requires_prompt = match state.mode {
                PermissionMode::FullManage => false,
                PermissionMode::Plan | PermissionMode::Orchestrator => false,
                PermissionMode::AcceptEdits => matches!(class, ToolPermissionClass::Command),
                PermissionMode::Default => {
                    matches!(class, ToolPermissionClass::Edit | ToolPermissionClass::Command)
                }
            };
            if !requires_prompt {
                return Ok(());
            }
            if !state.interactive_prompts {
                return Ok(());
            }
            if state.session_allowed_tools.contains(&tool_key) {
                return Ok(());
            }
            if state.closed || self.events.is_closed() {
                bail!("Denied by user: permission client disconnected");
            }
            let request_id = crate::id::new_id("perm");
            let description = describe_tool_call(tool_name, input);
            let (tx, rx) = oneshot::channel();
            self.events
                .send(ServerEvent::PermissionRequest {
                    session_id: session_id.to_string(),
                    request_id: request_id.clone(),
                    tool_name: tool_name.to_string(),
                    description,
                    input: input.clone(),
                })
                .map_err(|_| anyhow!("Denied by user: permission client disconnected"))?;
            state.pending.insert(
                request_id.clone(),
                PendingPermission {
                    session_id: session_id.to_string(),
                    answer: tx,
                },
            );
            (request_id, rx)
        };

        let _guard = PendingPermissionGuard {
            connection: self,
            request_id,
        };
        let decision = receiver.await.unwrap_or(PermissionDecision::Deny);
        match decision {
            PermissionDecision::Allow => Ok(()),
            PermissionDecision::AllowAlways => {
                let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                state.session_allowed_tools.insert(tool_key);
                Ok(())
            }
            PermissionDecision::Deny => bail!("Denied by user"),
        }
    }
}

struct PendingPermissionGuard<'a> {
    connection: &'a PermissionConnection,
    request_id: String,
}

impl Drop for PendingPermissionGuard<'_> {
    fn drop(&mut self) {
        let mut state = self
            .connection
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state.pending.remove(&self.request_id);
    }
}

fn describe_tool_call(tool_name: &str, input: &Value) -> String {
    if let Some(cmd) = input.get("command").and_then(Value::as_str) {
        return format!("Run `{}`", truncate_chars(cmd.trim(), 140));
    }
    for key in ["file_path", "path", "target_path", "url"] {
        if let Some(val) = input.get(key).and_then(Value::as_str)
            && !val.trim().is_empty()
        {
            return format!("{tool_name} {}", truncate_chars(val.trim(), 140));
        }
    }
    if let Some(title) = input.get("title").and_then(Value::as_str)
        && !title.trim().is_empty()
    {
        return format!("{tool_name}: {}", truncate_chars(title.trim(), 140));
    }
    format!("Allow `{tool_name}`")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let collected: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{collected}...")
    } else {
        collected
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tool_classification_covers_all_four_classes() {
        for name in [
            "read",
            "read_file",
            "glob",
            "grep",
            "search_files",
            "ls",
            "list_files",
            "read_excel",
            "browser_snapshot",
            "list_templates",
            "memory",
            "todo",
            "todo_write",
            "codesearch",
            "session_search",
            "conversation_search",
        ] {
            assert_eq!(
                classify_tool(name),
                ToolPermissionClass::ReadOnly,
                "expected ReadOnly for {name}"
            );
        }

        for name in [
            "edit",
            "write",
            "patch",
            "apply_patch",
            "write_excel",
            "create_powerpoint",
            "save_template",
        ] {
            assert_eq!(
                classify_tool(name),
                ToolPermissionClass::Edit,
                "expected Edit for {name}"
            );
        }

        for name in ["subagent", "swarm", "task", "plan", "plan_status", "ask_user_question"] {
            assert_eq!(
                classify_tool(name),
                ToolPermissionClass::Coordinate,
                "expected Coordinate for {name}"
            );
        }

        for name in [
            "bash",
            "shell",
            "run_command",
            "browser_navigate",
            "browser_click",
            "browser_type",
            "mcp__github__create_issue",
        ] {
            assert_eq!(
                classify_tool(name),
                ToolPermissionClass::Command,
                "expected Command for {name}"
            );
        }
    }

    #[tokio::test]
    async fn plan_mode_hides_and_blocks_edit_and_command_tools() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let conn = Arc::new(PermissionConnection::new(tx));
        conn.set_mode(PermissionMode::Plan);

        assert!(!is_tool_hidden_for_mode(PermissionMode::Plan, "read"));
        assert!(!is_tool_hidden_for_mode(PermissionMode::Plan, "read_excel"));
        assert!(!is_tool_hidden_for_mode(PermissionMode::Plan, "swarm"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Plan, "edit"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Plan, "write"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Plan, "write_excel"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Plan, "create_powerpoint"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Plan, "bash"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Plan, "browser_navigate"));

        scope("s1", Some(conn.clone()), async {
            assert!(authorize("s1", "read", &json!({"path": "a.rs"})).await.is_ok());
            assert!(authorize("s1", "read_excel", &json!({"file_path": "a.xlsx"})).await.is_ok());
            for blocked in ["edit", "write", "bash", "write_excel", "create_powerpoint"] {
                let err = authorize("s1", blocked, &json!({})).await.unwrap_err();
                assert!(
                    err.to_string().contains("Blocked by Plan mode (read-only)"),
                    "unexpected error for {blocked}: {err}"
                );
            }
        })
        .await;
    }

    #[tokio::test]
    async fn orchestrator_mode_hides_direct_edits_and_allows_coordination() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let conn = Arc::new(PermissionConnection::new(tx));
        conn.set_mode(PermissionMode::Orchestrator);

        assert!(!is_tool_hidden_for_mode(PermissionMode::Orchestrator, "read"));
        assert!(!is_tool_hidden_for_mode(PermissionMode::Orchestrator, "swarm"));
        assert!(!is_tool_hidden_for_mode(PermissionMode::Orchestrator, "subagent"));
        assert!(!is_tool_hidden_for_mode(PermissionMode::Orchestrator, "task"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Orchestrator, "edit"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Orchestrator, "write"));
        assert!(is_tool_hidden_for_mode(PermissionMode::Orchestrator, "bash"));

        scope("s1", Some(conn.clone()), async {
            assert!(authorize("s1", "read", &json!({})).await.is_ok());
            assert!(authorize("s1", "swarm", &json!({})).await.is_ok());
            assert!(authorize("s1", "subagent", &json!({})).await.is_ok());
            for blocked in ["edit", "write", "bash", "browser_click"] {
                let err = authorize("s1", blocked, &json!({})).await.unwrap_err();
                assert!(
                    err.to_string().contains("Blocked by Orchestrator mode"),
                    "unexpected error for {blocked}: {err}"
                );
            }
        })
        .await;
    }

    #[tokio::test]
    async fn ask_mode_emits_permission_request_and_remembers_allow_always() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = Arc::new(PermissionConnection::new(tx));
        assert_eq!(conn.mode(), PermissionMode::Default);

        // ReadOnly & Coordinate run immediately without prompting.
        scope("s1", Some(conn.clone()), async {
            authorize("s1", "read", &json!({"path": "Cargo.toml"})).await.unwrap();
            authorize("s1", "swarm", &json!({})).await.unwrap();
        })
        .await;
        assert!(rx.try_recv().is_err());

        // Edit prompts and succeeds on Allow (does not cache).
        let worker = {
            let conn = conn.clone();
            tokio::spawn(async move {
                scope("s1", Some(conn), async {
                    authorize("s1", "edit", &json!({"file_path": "src/lib.rs"})).await
                })
                .await
            })
        };
        let Some(ServerEvent::PermissionRequest {
            session_id,
            request_id,
            tool_name,
            ..
        }) = rx.recv().await
        else {
            panic!("expected PermissionRequest for edit");
        };
        assert_eq!(session_id, "s1");
        assert_eq!(tool_name, "edit");
        conn.respond("s1", &request_id, PermissionDecision::Allow)
            .unwrap();
        worker.await.unwrap().unwrap();

        // Second Edit prompts again, AllowAlways caches it for the session.
        let worker2 = {
            let conn = conn.clone();
            tokio::spawn(async move {
                scope("s1", Some(conn), async {
                    authorize("s1", "edit", &json!({"file_path": "src/main.rs"})).await
                })
                .await
            })
        };
        let Some(ServerEvent::PermissionRequest { request_id, .. }) = rx.recv().await else {
            panic!("expected second PermissionRequest for edit");
        };
        conn.respond("s1", &request_id, PermissionDecision::AllowAlways)
            .unwrap();
        worker2.await.unwrap().unwrap();

        // Third Edit succeeds immediately with zero prompts on s1.
        scope("s1", Some(conn.clone()), async {
            authorize("s1", "edit", &json!({"file_path": "src/other.rs"})).await
        })
        .await
        .unwrap();
        assert!(rx.try_recv().is_err());

        // AllowAlways on s1 does not leak to a different session s2.
        let other_session_worker = {
            let conn = conn.clone();
            tokio::spawn(async move {
                scope("s2", Some(conn), async {
                    authorize("s2", "edit", &json!({"file_path": "src/s2.rs"})).await
                })
                .await
            })
        };
        let Some(ServerEvent::PermissionRequest {
            session_id: s2_id,
            request_id: s2_req_id,
            ..
        }) = rx.recv().await
        else {
            panic!("expected PermissionRequest for edit on session s2");
        };
        assert_eq!(s2_id, "s2");
        conn.respond("s2", &s2_req_id, PermissionDecision::Allow)
            .unwrap();
        other_session_worker.await.unwrap().unwrap();

        // Deny returns an error and does not cache.
        let worker3 = {
            let conn = conn.clone();
            tokio::spawn(async move {
                scope("s1", Some(conn), async {
                    authorize("s1", "bash", &json!({"command": "rm -rf /tmp/foo"})).await
                })
                .await
            })
        };
        let Some(ServerEvent::PermissionRequest { request_id, .. }) = rx.recv().await else {
            panic!("expected PermissionRequest for bash");
        };
        conn.respond("s1", &request_id, PermissionDecision::Deny)
            .unwrap();
        let err = worker3.await.unwrap().unwrap_err();
        assert!(err.to_string().contains("Denied by user"));
    }

    #[tokio::test]
    async fn accept_edits_auto_allows_writes_but_prompts_for_bash() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = Arc::new(PermissionConnection::new(tx));
        conn.set_mode(PermissionMode::AcceptEdits);

        // Edit tools run without prompting.
        scope("s1", Some(conn.clone()), async {
            authorize("s1", "write", &json!({"file_path": "a.txt"})).await.unwrap();
            authorize("s1", "edit", &json!({"file_path": "a.txt"})).await.unwrap();
            authorize("s1", "write_excel", &json!({"file_path": "a.xlsx"})).await.unwrap();
            authorize("s1", "create_powerpoint", &json!({"title": "Deck"})).await.unwrap();
        })
        .await;
        assert!(rx.try_recv().is_err());

        // Bash prompts for approval.
        let worker = {
            let conn = conn.clone();
            tokio::spawn(async move {
                scope("s1", Some(conn), async {
                    authorize("s1", "bash", &json!({"command": "cargo test"})).await
                })
                .await
            })
        };
        let Some(ServerEvent::PermissionRequest {
            request_id,
            tool_name,
            description,
            ..
        }) = rx.recv().await
        else {
            panic!("expected PermissionRequest for bash in accept_edits mode");
        };
        assert_eq!(tool_name, "bash");
        assert!(description.contains("cargo test"));
        conn.respond("s1", &request_id, PermissionDecision::Allow)
            .unwrap();
        worker.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn full_manage_auto_allows_all_non_interactive_tools() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = Arc::new(PermissionConnection::new(tx));
        conn.set_mode(PermissionMode::FullManage);

        scope("s1", Some(conn.clone()), async {
            for tool in [
                "read",
                "edit",
                "write",
                "bash",
                "write_excel",
                "create_powerpoint",
                "browser_navigate",
                "swarm",
            ] {
                authorize("s1", tool, &json!({})).await.unwrap();
            }
        })
        .await;
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn disconnect_denies_pending_permission_without_hang() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = Arc::new(PermissionConnection::new(tx));

        let worker = {
            let conn = conn.clone();
            tokio::spawn(async move {
                scope("s1", Some(conn), async {
                    authorize("s1", "bash", &json!({"command": "echo hi"})).await
                })
                .await
            })
        };

        let Some(ServerEvent::PermissionRequest { request_id, .. }) = rx.recv().await else {
            panic!("expected PermissionRequest");
        };
        conn.close();

        let result = tokio::time::timeout(std::time::Duration::from_secs(2), worker)
            .await
            .expect("disconnect must unblock pending permission without hanging")
            .unwrap();
        assert!(result.unwrap_err().to_string().contains("Denied by user"));
        assert!(
            conn.respond("s1", &request_id, PermissionDecision::Allow)
                .is_err()
        );
    }

    #[tokio::test]
    async fn non_interactive_client_stays_non_blocking_while_enforcing_plan_mode() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = Arc::new(PermissionConnection::new_non_interactive(tx));

        // Legacy client never blocks by default.
        scope("s1", Some(conn.clone()), async {
            authorize("s1", "edit", &json!({})).await.unwrap();
            authorize("s1", "bash", &json!({})).await.unwrap();
        })
        .await;
        assert!(rx.try_recv().is_err());

        // Switching to Plan still blocks Edit & Command without hanging.
        conn.set_mode(PermissionMode::Plan);
        scope("s1", Some(conn.clone()), async {
            assert!(authorize("s1", "read", &json!({})).await.is_ok());
            assert!(authorize("s1", "edit", &json!({})).await.is_err());
            assert!(authorize("s1", "bash", &json!({})).await.is_err());
        })
        .await;
        assert!(rx.try_recv().is_err());
    }
}
