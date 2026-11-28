//! Pending control reply contracts and terminal error correlation.

use super::{ApiEvent, BridgeState, ErrorCode, ServerFrame, Value};

#[derive(Debug, Clone, PartialEq)]
pub(super) enum SimpleKind {
    RuntimeCommand,
    GlobalRuntimeCommand,
    Detach,
    Tools,
    ToolControl,
    Ping,
    History,
    /// Receipt-only controls: cancel, soft interrupts, auth/usage invalidation,
    /// and the legacy background-tool fallback. Their handlers do not reject
    /// the control after ack (an idle interrupt can separately fail its turn).
    Ok,
    /// Fallible controls acknowledge receipt first, then finish with done/error.
    OkOnDone,
    /// `clear` rotates the session id on the daemon before replying `done`.
    Clear,
    /// Rewind controls finish with a replacement history rather than done.
    OkOnHistory,
    /// Awaiting `model_changed`, which carries its own error field.
    Model,
    ContextCap,
    /// Awaiting `reasoning_effort_changed`.
    ReasoningEffort,
    /// Awaiting `compacted_history`.
    Compact,
    /// Awaiting the catalog reply that answers `list_models`.
    Models,
    RuntimeInfo,
    /// Awaiting `background_tool_result`.
    BackgroundTool,
    /// Awaiting `soft_interrupts_cancelled`.
    SoftInterruptCancel,
    /// Awaiting `ack` for `set_permission_mode`, then emits `PermissionModeChanged`.
    SetPermissionMode {
        session_id: String,
        mode: rayucode_harness_api::PermissionMode,
    },
    /// Awaiting `file_changes_state` reply for `get_file_changes`.
    FileChanges,
    /// Awaiting `file_change_diff` reply for `get_file_change_diff`.
    FileChangeDiff,
    /// Awaiting `file_change_action_result` reply for `file_change_action`.
    FileChangeAction,
    Credential {
        provider: String,
        configured: bool,
    },
}

impl BridgeState {
    /// A rejected control is not a failed model turn. Preserve streaming state
    /// and correlate only its request, retiring its completion bookkeeping.
    pub(super) fn control_error_reply(&mut self, id: u64, event: &Value) -> Option<ServerFrame> {
        let index = self
            .pending_simple
            .iter()
            .position(|(pending_id, _, _)| *pending_id == id)?;
        let (_, api_id, _) = self.pending_simple.remove(index);
        self.pending_control_done_ids.remove(&id);
        self.pending_activity_snapshots.remove(&id);
        let message = event["message"].as_str().unwrap_or("").to_string();
        let code = crate::capabilities::classify_daemon_error(&message, ErrorCode::Internal);
        Some(ServerFrame::reply(
            api_id,
            ApiEvent::Error { code, message },
        ))
    }
}
