use super::state_ui_history_marker::parse_compacted_history_marker;
use super::state_ui_storage::compact_display_messages_for_storage;
use super::*;
use crate::overnight::OvernightRunStatus;
use crate::tui::core::{PENDING_TOOL_ROLE, ToolActivity};
use std::time::{Duration, Instant};

const COMPACTED_HISTORY_CHUNK_MESSAGES: usize = 64;
const COMPACTED_HISTORY_LOAD_SCROLL_THRESHOLD: usize = 2;
const OVERNIGHT_CARD_REFRESH_INTERVAL: Duration = Duration::from_secs(5);

#[cfg(test)]
#[path = "state_ui_reminder_tests.rs"]
mod reminder_tests;

fn display_message_from_stored_message(
    message: &crate::session::StoredMessage,
) -> Option<DisplayMessage> {
    let text = stored_message_visible_text(message);
    if text.trim().is_empty() {
        return None;
    }
    if is_background_task_lifecycle_message(&text) {
        return None;
    }
    if !matches!(message.role, Role::Assistant)
        && let Some(swarm) = super::remote_notifications::swarm_delivery_display_message(&text)
    {
        return Some(swarm);
    }
    match message.display_role {
        Some(crate::session::StoredDisplayRole::System) => Some(DisplayMessage::system(text)),
        Some(crate::session::StoredDisplayRole::BackgroundTask) => None,
        None => match message.role {
            Role::User => {
                if crate::session::is_scheduled_task_message(message) {
                    return Some(DisplayMessage::system(text));
                }
                // Synthetic auto-poke continuations are persisted as user
                // turns for the model but must not display as user prompts.
                if crate::todo::is_auto_poke_message(&text) {
                    // Gate continuations are written for the model; the user
                    // only needs to know the check happened.
                    match crate::todo::auto_poke_display_summary(&text) {
                        Some(summary) => Some(DisplayMessage::system(summary.to_string())),
                        None => Some(DisplayMessage::system(text)),
                    }
                } else {
                    Some(DisplayMessage::user(text))
                }
            }
            Role::Assistant => Some(DisplayMessage::assistant(text)),
        },
    }
}

fn is_background_task_lifecycle_message(content: &str) -> bool {
    let content = content.trim_start();
    content.starts_with("**Background task**")
        || content.starts_with("**Background task started**")
        || content.starts_with("**Background task progress**")
        || content.starts_with("**Background task stalled**")
}

/// Transcript output belonging to the current provider attempt. Provider-native
/// tools such as hosted web search also stream as part of the response.
pub(super) fn is_streaming_attempt_output(message: &DisplayMessage) -> bool {
    matches!(message.role.as_str(), "assistant" | "reasoning")
        || (message.role == "tool"
            && message.tool_data.as_ref().is_some_and(|tool| {
                crate::message::provider_native::is_provider_native_tool_id(&tool.id)
            }))
}

fn stored_message_visible_text(message: &crate::session::StoredMessage) -> String {
    let mut parts = Vec::new();
    for block in &message.content {
        match block {
            ContentBlock::Text { text, .. }
            | ContentBlock::Reasoning { text }
            | ContentBlock::ReasoningTrace { text } => {
                if !text.trim().is_empty() {
                    parts.push(text.trim().to_string());
                }
            }
            ContentBlock::AnthropicThinking { .. } | ContentBlock::OpenAIReasoning { .. } => {}
            ContentBlock::ToolUse { name, input, .. } => {
                parts.push(format!("[tool:{} {}]", name, input));
            }
            ContentBlock::ToolResult { content, .. } => {
                if !content.trim().is_empty() {
                    parts.push(content.trim().to_string());
                }
            }
            ContentBlock::Image { media_type, .. } => {
                parts.push(format!("[image:{}]", media_type));
            }
            ContentBlock::OpenAICompaction { .. }
            | ContentBlock::ToolReference { .. }
            | ContentBlock::ProviderNative { .. } => {}
        }
    }
    parts.join("\n\n")
}

impl App {
    /// Keep explicit provider overload notices in chat, while transport details
    /// remain transient. Check the current turn to deduplicate replayed notices
    /// even after another detail has replaced the status label.
    pub(super) fn apply_status_detail(&mut self, detail: String) {
        const OVERLOAD_PREFIX: &str = "OpenAI reported server overload";
        if detail.starts_with(OVERLOAD_PREFIX)
            && !self
                .display_messages
                .iter()
                .rev()
                .take_while(|message| message.role != "user")
                .any(|message| {
                    message.role == "system" && message.content.starts_with(OVERLOAD_PREFIX)
                })
        {
            self.push_display_message(DisplayMessage::system(detail.clone()));
        }
        self.status_detail = Some(detail);
    }

    fn pending_tool_row(&self, id: &str) -> Option<usize> {
        self.display_messages.iter().rposition(|message| {
            message.role == PENDING_TOOL_ROLE
                && message.tool_data.as_ref().is_some_and(|tool| tool.id == id)
        })
    }

    pub(super) fn show_tool_activity(&mut self, tool: &ToolCall, activity: ToolActivity) {
        if matches!(activity, ToolActivity::Running) {
            self.tool_execution_starts
                .entry(tool.id.clone())
                .or_insert_with(std::time::Instant::now);
        }
        let label = activity.label();
        if let Some(index) = self.pending_tool_row(&tool.id) {
            let row = &mut self.display_messages[index];
            if row.content == label && row.tool_data.as_ref() == Some(tool) {
                return;
            }
            row.content = label.into();
            row.tool_data = Some(tool.clone());
        } else {
            let mut row = DisplayMessage::tool(label, tool.clone());
            row.role = PENDING_TOOL_ROLE.into();
            self.display_messages.push(row);
        }
        self.bump_display_messages_version_no_stats();
    }

    pub(super) fn refresh_tool_activity_input(&mut self, tool: &ToolCall) -> bool {
        let Some(index) = self.pending_tool_row(&tool.id) else {
            return false;
        };
        let row = &mut self.display_messages[index];
        if row.tool_data.as_ref() == Some(tool) {
            return false;
        }
        row.tool_data = Some(tool.clone());
        self.bump_display_messages_version_no_stats();
        true
    }

    pub(super) fn restore_remote_tool_activity(
        &mut self,
        snapshot: crate::protocol::ActiveToolSnapshot,
    ) {
        let crate::protocol::ActiveToolSnapshot {
            tool,
            elapsed_ms,
            batch,
            ..
        } = snapshot;
        if self.display_messages.iter().rev().any(|row| {
            row.role == "tool"
                && row
                    .tool_data
                    .as_ref()
                    .is_some_and(|result| result.id == tool.id)
        }) {
            return;
        }
        if !self
            .streaming_tool_calls
            .iter()
            .any(|call| call.id == tool.id)
        {
            self.streaming_tool_calls.push(tool.clone());
        }
        self.show_tool_activity(&tool, ToolActivity::Running);
        let batch = batch.filter(|batch| {
            self.batch_progress.as_ref().is_none_or(|current| {
                current.tool_call_id != batch.tool_call_id || current.completed <= batch.completed
            })
        });
        let now = Instant::now();
        if let Some(start) = now.checked_sub(Duration::from_millis(elapsed_ms)) {
            self.tool_execution_starts
                .entry(tool.id.clone())
                .and_modify(|observed| *observed = (*observed).min(start));
            if let Some(batch) = &batch {
                for child in &batch.subcalls {
                    if matches!(child.state, crate::bus::BatchSubcallState::Running) {
                        let id = crate::tui::core::batch_child_call_id(
                            &batch.tool_call_id,
                            &child.tool_call.id,
                        );
                        self.tool_execution_starts
                            .entry(id)
                            .and_modify(|observed| *observed = (*observed).min(start))
                            .or_insert(start);
                    }
                }
            }
        }
        if let Some(batch) = batch {
            self.update_batch_tool_activity(batch);
        }
    }

    pub(super) fn update_batch_tool_activity(
        &mut self,
        progress: crate::bus::BatchProgress,
    ) -> bool {
        if self.batch_progress.as_ref().is_some_and(|current| {
            current.tool_call_id == progress.tool_call_id && current.completed > progress.completed
        }) {
            return false;
        }
        if self.pending_tool_row(&progress.tool_call_id).is_none()
            && (!matches!(&self.status, ProcessingStatus::RunningTool(name) if name == "batch")
                || self.display_messages.iter().rev().any(|row| {
                    row.tool_data
                        .as_ref()
                        .is_some_and(|tool| tool.id == progress.tool_call_id)
                }))
        {
            return false;
        }
        for child in &progress.subcalls {
            let id =
                crate::tui::core::batch_child_call_id(&progress.tool_call_id, &child.tool_call.id);
            if matches!(child.state, crate::bus::BatchSubcallState::Running) {
                self.tool_execution_starts
                    .entry(id)
                    .or_insert_with(std::time::Instant::now);
            } else {
                self.tool_execution_starts.remove(&id);
                self.bash_progress.remove(&id);
            }
        }
        self.batch_progress = Some(progress);
        true
    }

    pub(super) fn apply_bash_progress(&mut self, progress: crate::protocol::BashProgress) -> bool {
        if !self.tool_execution_starts.contains_key(&progress.call_id)
            && self.is_processing
            && self
                .remote_resume_activity
                .as_ref()
                .is_some_and(|activity| activity.current_tool_name.as_deref() == Some("bash"))
            && self.streaming_tool_calls.is_empty()
            && !self.display_messages.iter().rev().any(|row| {
                row.tool_data
                    .as_ref()
                    .is_some_and(|tool| tool.id == progress.call_id)
            })
        {
            let tool = ToolCall {
                id: progress.call_id.clone(),
                name: "bash".into(),
                ..Default::default()
            };
            self.show_tool_activity(&tool, ToolActivity::Running);
            let now = std::time::Instant::now();
            let started = now
                .checked_sub(std::time::Duration::from_millis(progress.elapsed_ms))
                .unwrap_or(now);
            self.tool_execution_starts.insert(tool.id.clone(), started);
            self.streaming_tool_calls.push(tool);
        }
        if !self.tool_execution_starts.contains_key(&progress.call_id)
            || self
                .bash_progress
                .get(&progress.call_id)
                .is_some_and(|last| {
                    progress.elapsed_ms < last.elapsed_ms
                        || progress.output_bytes <= last.output_bytes
                })
        {
            return false;
        }
        if self.transcript_view.is_some()
            && let Some(index) = self.pending_tool_row(&progress.call_id)
            && !progress.tail.is_empty()
        {
            // The pending row's shape and content change on output only. The
            // viewport layers the elapsed clock over these prepared rows.
            self.display_messages[index].title = Some(progress.output_bytes.to_string());
            self.bump_display_messages_version_no_stats();
        }
        self.bash_progress
            .insert(progress.call_id.clone(), progress);
        true
    }

    pub(super) fn clear_pending_tool_calls(&mut self) {
        self.streaming_tool_calls.clear();
        self.tool_execution_starts.clear();
        self.bash_progress.clear();
        self.batch_progress = None;
        let len = self.display_messages.len();
        self.display_messages
            .retain(|message| message.role != PENDING_TOOL_ROLE);
        if self.display_messages.len() != len {
            self.bump_display_messages_version_no_stats();
        }
    }

    pub(super) fn interrupt_pending_tools(&mut self) {
        let pending: Vec<_> = self
            .display_messages
            .iter()
            .filter(|message| message.role == PENDING_TOOL_ROLE)
            .filter_map(|message| message.tool_data.clone())
            .collect();
        for tool in pending {
            let result = self
                .interrupted_batch_result(&tool.id, "Interrupted by user", None)
                .unwrap_or_else(|| "Error: Interrupted by user".into());
            self.push_display_message(DisplayMessage::tool(result, tool));
        }
        self.clear_pending_tool_calls();
    }

    pub(super) fn interrupted_batch_result(
        &self,
        id: &str,
        diagnostic: &str,
        tool_duration_ms: Option<u64>,
    ) -> Option<String> {
        use std::fmt::Write as _;
        let batch = self
            .batch_progress
            .as_ref()
            .filter(|batch| batch.tool_call_id == id && !batch.subcalls.is_empty())?;
        let mut result = String::from(crate::tui::core::INTERRUPTED_BATCH_RESULT);
        let _ = write!(result, "{}\n\n", diagnostic.trim_end());
        let mut succeeded = 0;
        for child in &batch.subcalls {
            let key = crate::tui::core::batch_child_call_id(id, &child.tool_call.id);
            let metrics = child.metrics.or_else(|| {
                let elapsed = self.tool_execution_starts.get(&key)?.elapsed();
                let measured_ms = elapsed.as_millis() as u64;
                Some(crate::bus::BatchSubcallMetrics {
                    duration_ms: tool_duration_ms
                        .map_or(measured_ms, |bound| measured_ms.min(bound)),
                    output_bytes: self
                        .bash_progress
                        .get(&key)
                        .map(|sample| sample.output_bytes),
                })
            });
            if let Some(metrics) = metrics {
                result.push_str(&metrics.section_prefix());
            }
            let status = match child.state {
                crate::bus::BatchSubcallState::Succeeded => {
                    succeeded += 1;
                    "Completed"
                }
                crate::bus::BatchSubcallState::Failed => "Error: Tool call failed",
                crate::bus::BatchSubcallState::Running => "Error: Cancelled",
            };
            let _ = write!(
                result,
                "--- [{}] {} ---\n{status}\n\n",
                child.index, child.tool_call.name,
            );
        }
        let _ = write!(
            result,
            "Completed: {succeeded} succeeded, {} failed",
            batch.subcalls.len() - succeeded,
        );
        Some(result)
    }

    pub fn push_display_message(&mut self, mut message: DisplayMessage) {
        let pending = if message.role == "tool" {
            message
                .tool_data
                .as_ref()
                .and_then(|tool| self.pending_tool_row(&tool.id))
        } else {
            None
        };
        if message.role == "tool"
            && let Some(tool) = message.tool_data.as_ref()
        {
            let observed = self.tool_execution_starts.remove(&tool.id);
            self.bash_progress.remove(&tool.id);
            if tool.name == "batch" {
                let prefix = crate::tui::core::batch_child_call_id(&tool.id, "");
                self.tool_execution_starts
                    .retain(|id, _| !id.starts_with(&prefix));
                self.bash_progress.retain(|id, _| !id.starts_with(&prefix));
            }
            if message.duration_secs.is_none() {
                message.duration_secs = DisplayMessage::tool_duration_from_output(&message.content)
                    .or_else(|| observed.map(|start| start.elapsed().as_secs_f32()));
            }
        }
        if is_background_task_lifecycle_message(&message.content) {
            if let Some(index) = pending {
                self.display_messages.remove(index);
                self.bump_display_messages_version_no_stats();
            }
            return;
        }
        // Keep Ctrl+L's spacer as a clear boundary when new content arrives.
        // The renderer packs only the content after it while following the tail,
        // so sending a prompt does not restore the pre-clear conversation.
        if pending.is_none() && self.try_coalesce_repeated_display_message(&message) {
            return;
        }
        let is_tool = message.role == "tool";
        // User messages and completed local tool results fence off prior work.
        if is_streaming_attempt_output(&message) {
            self.attempt_committed_rows += 1;
        } else {
            self.attempt_committed_rows = 0;
        }
        // Maintain the cached display-message counters incrementally for this
        // single append, then bump the version without a full O(M) rescan.
        // Appending is the hot path; rescanning every append was O(M^2) over a
        // long session.
        self.adjust_display_message_stats(&message, true);
        if self.auto_scroll_paused
            && message.role != "spacer"
            && (!message.content.trim().is_empty()
                || message.title.is_some()
                || message.tool_data.is_some())
        {
            self.unseen_chat_messages = self.unseen_chat_messages.saturating_add(1);
        }
        if let Some(index) = pending {
            self.display_messages[index] = message;
        } else {
            self.display_messages.push(message);
        }
        self.bump_display_messages_version_no_stats();
        if is_tool && self.diff_mode.has_side_pane() && self.diff_pane_auto_scroll {
            self.diff_pane_scroll = usize::MAX;
        }
    }

    pub(super) fn replace_display_messages(&mut self, mut messages: Vec<DisplayMessage>) {
        messages.retain(|message| {
            message.role != PENDING_TOOL_ROLE
                && !is_background_task_lifecycle_message(&message.content)
        });
        for message in &mut messages {
            if message.role == "tool" && message.duration_secs.is_none() {
                message.duration_secs = DisplayMessage::tool_duration_from_output(&message.content);
            }
        }
        compact_display_messages_for_storage(&mut messages);
        self.restore_turn_footer(&messages);
        self.display_messages = messages;
        self.unseen_chat_messages = 0;
        self.transcript_view = None;
        self.attempt_committed_rows = 0;
        self.sync_compacted_history_lazy_from_display_messages();
        self.bump_display_messages_version();
        self.note_runtime_memory_event_force("display_messages_replaced", "display_history_reset");
    }

    pub(super) fn replace_display_message_content(&mut self, idx: usize, content: String) -> bool {
        if let Some(message) = self.display_messages.get_mut(idx) {
            if message.content != content {
                message.content = content;
                self.bump_display_messages_version();
            }
            true
        } else {
            false
        }
    }

    pub(super) fn replace_display_message_title_and_content(
        &mut self,
        idx: usize,
        title: Option<String>,
        content: String,
    ) -> bool {
        if let Some(message) = self.display_messages.get_mut(idx) {
            if message.title != title || message.content != content {
                message.title = title;
                message.content = content;
                self.bump_display_messages_version();
            }
            true
        } else {
            false
        }
    }

    pub(super) fn set_latest_tool_duration(&mut self, tool_call_id: &str, seconds: f32) {
        if let Some(message) = self.display_messages.iter_mut().rev().find(|message| {
            message
                .tool_data
                .as_ref()
                .is_some_and(|tool| tool.id == tool_call_id)
        }) {
            message.duration_secs = Some(seconds);
            self.bump_display_messages_version();
        }
    }

    pub(super) fn replace_latest_tool_display_message(
        &mut self,
        tool_call_id: &str,
        title: Option<String>,
        content: String,
    ) -> bool {
        let Some(idx) = self.display_messages.iter().rposition(|message| {
            message.tool_data.as_ref().map(|tool| tool.id.as_str()) == Some(tool_call_id)
        }) else {
            return false;
        };

        // A tool moved to the background finishes its foreground card with the
        // background lifecycle notification returned by the tool. The same
        // notification also drives the retained row in the pinned status band,
        // so remove the transient tool card instead of turning it into a second
        // transcript representation.
        if is_background_task_lifecycle_message(&content) {
            self.tool_execution_starts.remove(tool_call_id);
            self.bash_progress.remove(tool_call_id);
            self.remove_display_message(idx);
            return true;
        }

        if self.display_messages[idx].role == PENDING_TOOL_ROLE
            && let Some(tool) = self.display_messages[idx].tool_data.clone()
        {
            let mut result = DisplayMessage::tool(content, tool);
            result.title = title;
            result.duration_secs = self.display_messages[idx].duration_secs;
            self.push_display_message(result);
            return true;
        }
        self.replace_display_message_title_and_content(idx, title, content)
    }

    pub(super) fn background_task_rows_ref(&self) -> &[crate::tui::BackgroundTaskRow] {
        &self.background_task_rows
    }

    /// User-only blockers and live waits suppress all automatic continuations.
    /// Disk state survives a TUI reload and overrides stale retained UI rows.
    pub(super) fn todo_is_paused_for_auto_followup(&self, todo: &crate::todo::TodoItem) -> bool {
        crate::todo::todo_completely_blocked(todo)
            || crate::todo::todo_has_external_blocker(todo)
            || crate::todo::todo_waits_on_running_task(todo, |task_id| {
                self.running_todo_await_dependency(task_id)
                    || self.running_todo_background_dependency(task_id).is_some()
            })
    }

    pub(super) fn running_todo_await_dependency(&self, task_id: &str) -> bool {
        let session_id = self
            .remote_session_id
            .as_deref()
            .unwrap_or(&self.session.id);
        crate::todo::await_dependency::running(&crate::storage::runtime_dir(), task_id, session_id)
    }

    pub(super) fn running_todo_background_dependency(
        &self,
        task_id: &str,
    ) -> Option<crate::background::TaskStatusFile> {
        let session_id = self
            .remote_session_id
            .as_deref()
            .unwrap_or(&self.session.id);
        if std::path::Path::new(task_id)
            .file_name()
            .and_then(|s| s.to_str())
            != Some(task_id)
        {
            return None;
        }
        if self.background_task_rows.iter().any(|row| {
            row.task_id == task_id && row.status != crate::tui::BackgroundTaskRowStatus::Running
        }) {
            return None;
        }
        let bytes = match std::fs::read(crate::background::global().status_path_for(task_id)) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            Err(error) => {
                crate::logging::warn(&format!(
                    "Cannot read background dependency status: {error}"
                ));
                return None;
            }
        };
        let status: crate::background::TaskStatusFile = match serde_json::from_slice(&bytes) {
            Ok(status) => status,
            Err(error) => {
                crate::logging::warn(&format!("Invalid background dependency status: {error}"));
                return None;
            }
        };
        // UI rows are history, not proof that an owner survived a crash.
        let owner = if status.detached {
            status.pid
        } else {
            status.owner_pid.or(status.pid)
        };
        if owner.is_none_or(|pid| {
            pid == 0 || pid > i32::MAX as u32 || !crate::platform::is_process_running(pid)
        }) {
            return None;
        }
        (status.task_id == task_id
            && status.session_id == session_id
            && status.status == crate::bus::BackgroundTaskStatus::Running)
            .then_some(status)
    }

    pub(super) fn all_open_todos_are_paused(&self) -> bool {
        let open = super::commands::incomplete_poke_todos(self);
        !open.is_empty()
            && open
                .iter()
                .all(|todo| self.todo_is_paused_for_auto_followup(todo))
    }

    fn retain_latest_background_tasks(&mut self) {
        const MAX_TRACKED_BACKGROUND_TASKS: usize = 8;
        if self.background_task_rows.len() > MAX_TRACKED_BACKGROUND_TASKS {
            let stale = self.background_task_rows.len() - MAX_TRACKED_BACKGROUND_TASKS;
            self.background_task_rows.drain(..stale);
        }
    }

    pub(super) fn upsert_running_background_task(
        &mut self,
        task_id: String,
        label: String,
        percent: Option<f32>,
    ) {
        if let Some(index) = self
            .background_task_rows
            .iter()
            .position(|task| task.task_id == task_id)
        {
            let mut task = self.background_task_rows.remove(index);
            task.label = label;
            // Output parsers can alternate between determinate updates (for
            // example `42%`) and phase-only updates (`Compiling foo`).  A
            // phase-only update must not erase the last useful percentage,
            // otherwise the pinned progress bar jumps back to zero until the
            // task completes at 100%.
            if percent.is_some() || task.percent.is_none() {
                task.percent = percent;
            }
            task.status = crate::tui::BackgroundTaskRowStatus::Running;
            task.completed_at = None;
            self.background_task_rows.push(task);
            return;
        }
        self.background_task_rows
            .push(crate::tui::BackgroundTaskRow {
                task_id,
                label,
                percent,
                status: crate::tui::BackgroundTaskRowStatus::Running,
                completed_at: None,
            });
        self.retain_latest_background_tasks();
    }

    pub(super) fn upsert_running_background_task_progress(&mut self, content: &str) -> bool {
        let Some(progress) =
            crate::message::parse_background_task_progress_notification_markdown(content)
        else {
            return false;
        };
        let label = crate::message::background_task_display_label(
            &progress.tool_name,
            progress.display_name.as_deref(),
        );
        self.upsert_running_background_task(progress.task_id, label, progress.percent);
        true
    }

    pub(super) fn upsert_running_background_task_started(&mut self, content: &str) -> bool {
        let Some(started) =
            crate::message::parse_background_task_started_notification_markdown(content)
        else {
            return false;
        };
        self.upsert_running_background_task(started.task_id, started.label, None);
        true
    }

    pub(super) fn finish_background_task(
        &mut self,
        task_id: String,
        label: String,
        status: crate::tui::BackgroundTaskRowStatus,
    ) {
        if let Some(index) = self
            .background_task_rows
            .iter()
            .position(|task| task.task_id == task_id)
        {
            let mut task = self.background_task_rows.remove(index);
            task.label = label;
            task.status = status;
            task.completed_at = (status == crate::tui::BackgroundTaskRowStatus::Completed)
                .then(std::time::Instant::now);
            if status == crate::tui::BackgroundTaskRowStatus::Completed {
                task.percent = Some(100.0);
            }
            self.background_task_rows.push(task);
            return;
        }
        self.background_task_rows
            .push(crate::tui::BackgroundTaskRow {
                task_id,
                label,
                percent: (status == crate::tui::BackgroundTaskRowStatus::Completed)
                    .then_some(100.0),
                status,
                completed_at: (status == crate::tui::BackgroundTaskRowStatus::Completed)
                    .then(std::time::Instant::now),
            });
        self.retain_latest_background_tasks();
    }

    /// Successful tasks are useful as short-lived confirmation, but should not
    /// permanently consume the background widget's limited space. Failures stay
    /// until acted on, and running tasks always stay visible.
    pub(super) fn prune_irrelevant_background_tasks(&mut self) -> bool {
        const COMPLETED_TASK_VISIBILITY: std::time::Duration = std::time::Duration::from_secs(12);
        let now = std::time::Instant::now();
        let previous_len = self.background_task_rows.len();
        self.background_task_rows.retain(|task| {
            task.completed_at.is_none_or(|completed_at| {
                now.saturating_duration_since(completed_at) < COMPLETED_TASK_VISIBILITY
            })
        });
        self.background_task_rows.len() != previous_len
    }

    pub(super) fn upsert_overnight_display_card(
        &mut self,
        manifest: &crate::overnight::OvernightManifest,
    ) -> bool {
        let Ok(content) = crate::overnight::format_progress_card_content(manifest) else {
            return false;
        };
        let title = Some("Overnight".to_string());
        let idx = self.display_messages.iter().rposition(|message| {
            message.role == "overnight"
                && serde_json::from_str::<crate::overnight::OvernightProgressCard>(&message.content)
                    .is_ok_and(|card| card.run_id == manifest.run_id)
        });
        if let Some(idx) = idx {
            self.replace_display_message_title_and_content(idx, title, content)
        } else {
            self.push_display_message(DisplayMessage::overnight(content));
            true
        }
    }

    pub(super) fn maybe_refresh_overnight_display_card(&mut self) -> bool {
        if crate::tui::is_ssh_remote() {
            return false;
        }
        let now = Instant::now();
        if self
            .last_overnight_card_refresh
            .is_some_and(|last| now.duration_since(last) < OVERNIGHT_CARD_REFRESH_INTERVAL)
        {
            return false;
        }
        self.last_overnight_card_refresh = Some(now);

        let has_card = self
            .display_messages
            .iter()
            .any(|message| message.role == "overnight");
        let Ok(Some(manifest)) = crate::overnight::latest_manifest() else {
            return false;
        };
        let active = matches!(
            manifest.status,
            OvernightRunStatus::Running | OvernightRunStatus::CancelRequested
        );
        if !has_card && !active {
            return false;
        }
        let card_changed = self.upsert_overnight_display_card(&manifest);
        let transcript_changed = self.maybe_tail_overnight_current_session_transcript(&manifest);
        card_changed || transcript_changed
    }

    fn maybe_tail_overnight_current_session_transcript(
        &mut self,
        manifest: &crate::overnight::OvernightManifest,
    ) -> bool {
        if manifest.coordinator_session_id != self.session.id {
            return false;
        }
        let Ok(latest_session) = crate::session::Session::load(&self.session.id) else {
            return false;
        };
        if latest_session.messages.len() <= self.session.messages.len() {
            return false;
        }

        let appended: Vec<DisplayMessage> = latest_session.messages[self.session.messages.len()..]
            .iter()
            .filter_map(display_message_from_stored_message)
            .collect();
        self.session = latest_session;
        if appended.is_empty() {
            return false;
        }
        for message in appended {
            self.push_display_message(message);
        }
        true
    }

    pub(super) fn remove_display_message(&mut self, idx: usize) -> Option<DisplayMessage> {
        if idx < self.display_messages.len() {
            let removed = self.display_messages.remove(idx);
            self.turn_reasoning_traces.retain_mut(|trace| {
                if *trace == idx {
                    return false;
                }
                *trace -= usize::from(*trace > idx);
                true
            });
            self.bump_display_messages_version();
            Some(removed)
        } else {
            None
        }
    }

    pub(super) fn append_reload_message(&mut self, line: &str) {
        if let Some(idx) = self
            .display_messages
            .iter()
            .rposition(Self::is_reload_message)
        {
            let msg = &mut self.display_messages[idx];
            if !msg.content.is_empty() {
                msg.content.push('\n');
            }
            msg.content.push_str(line);
            msg.title = Some("Reload".to_string());
            self.bump_display_messages_version();
        } else {
            self.push_display_message(
                DisplayMessage::system(line.to_string()).with_title("Reload"),
            );
        }
    }

    pub(super) fn is_client_maintenance_message(message: &DisplayMessage, title: &str) -> bool {
        message.role == "system" && message.title.as_deref() == Some(title)
    }

    pub(super) fn is_reload_message(message: &DisplayMessage) -> bool {
        message.role == "system"
            && message
                .title
                .as_deref()
                .is_some_and(|title| title == "Reload" || title.starts_with("Reload: "))
    }

    fn try_coalesce_repeated_display_message(&mut self, message: &DisplayMessage) -> bool {
        if !Self::is_repeat_compactable_display_message(message) {
            return false;
        }

        let Some(last) = self.display_messages.last_mut() else {
            return false;
        };
        if !Self::is_repeat_compactable_display_message(last) {
            return false;
        }

        let (last_base, last_count) = Self::split_repeat_suffix(&last.content);
        if last.role != message.role
            || last.title != message.title
            || last.tool_calls != message.tool_calls
            || last.duration_secs != message.duration_secs
            || last_base != message.content
        {
            return false;
        }

        let next_count = last_count.saturating_add(1);
        last.content = Self::format_repeated_display_content(message.content.as_str(), next_count);
        self.bump_display_messages_version();
        true
    }

    fn is_repeat_compactable_display_message(message: &DisplayMessage) -> bool {
        matches!(message.role.as_str(), "system" | "error")
            && message.title.is_none()
            && message.tool_calls.is_empty()
            && message.tool_data.is_none()
            && message.duration_secs.is_none()
            && !message.content.contains(['\n', '\r'])
    }

    fn split_repeat_suffix(content: &str) -> (&str, u32) {
        const REPEAT_PREFIX: &str = " [×";

        let Some(prefix_idx) = content.rfind(REPEAT_PREFIX) else {
            return (content, 1);
        };
        if !content.ends_with(']') {
            return (content, 1);
        }

        let digits = &content[prefix_idx + REPEAT_PREFIX.len()..content.len() - 1];
        if digits.is_empty() || !digits.chars().all(|ch| ch.is_ascii_digit()) {
            return (content, 1);
        }

        match digits.parse::<u32>() {
            Ok(count) if count >= 2 => (&content[..prefix_idx], count),
            _ => (content, 1),
        }
    }

    fn format_repeated_display_content(content: &str, repeat_count: u32) -> String {
        if repeat_count <= 1 {
            content.to_string()
        } else {
            format!("{content} [×{repeat_count}]")
        }
    }

    pub(super) fn clear_display_messages(&mut self) {
        self.raw_tool_results.clear();
        self.turn_footer = Default::default();
        self.unseen_chat_messages = 0;
        self.transcript_view = None;
        self.compacted_history_lazy = CompactedHistoryLazyState::default();
        // The transcript is about to be discarded; forget where the live reasoning
        // block started so a stale offset can't slice the new stream.
        self.reasoning_block_start = None;
        self.turn_reasoning_traces.clear();
        if !self.display_messages.is_empty() {
            self.display_messages.clear();
            self.bump_display_messages_version();
        }
    }

    /// Terminal-style clear (Ctrl+L): append a viewport-height blank spacer
    /// and snap to the bottom, so the screen shows a clean prompt while the
    /// whole transcript stays one scroll-up away, exactly like a terminal's
    /// clear-with-scrollback. Nothing is deleted; context, queue, and draft
    /// are untouched. Contrast with `/cls` (`clear_view_keep_context`), which
    /// actually wipes the rendered transcript.
    pub(super) fn clear_view_terminal_style(&mut self) {
        let rows = super::super::ui::last_chat_viewport_height();
        // Pressing Ctrl+L repeatedly (or on an already-empty screen) should
        // not stack blank pages: with a trailing spacer and nothing after it,
        // the viewport is already visually clear, so just re-snap.
        let already_clear = self
            .display_messages
            .last()
            .is_some_and(|message| message.role == "spacer");
        if rows > 0 && !already_clear && !self.display_messages.is_empty() {
            self.push_display_message(DisplayMessage::spacer(rows));
        }
        self.follow_chat_bottom();
    }

    /// Whether the view is in the terminal-style cleared state: the transcript
    /// ends in a Ctrl+L spacer, the viewport is pinned to the bottom, and no
    /// new output has arrived since. In that state every visible transcript row
    /// is blank, so the renderer collapses the messages area and the numbered
    /// prompt sits at the top of the screen like a terminal after `clear`.
    /// Any new message, stream, or scroll-up immediately ends it.
    pub(crate) fn terminal_clear_collapsed(&self) -> bool {
        !self.auto_scroll_paused
            && self.pending_history_anchor.is_none()
            && !self.is_processing
            && self.streaming.streaming_text.is_empty()
            && self
                .display_messages
                .last()
                .is_some_and(|message| message.role == "spacer")
    }

    /// View-only clear (`/cls`): wipe the rendered transcript while
    /// keeping provider context, queued messages, and the input draft intact,
    /// so the model still remembers everything. Contrast with `/clear`
    /// (`reset_current_session`), which discards context too, and Ctrl+L,
    /// which merely snaps to the bottom of the chat.
    pub(super) fn clear_view_keep_context(&mut self) {
        self.clear_display_messages();
        // The rendered transcript is gone, so every entry in the
        // process-global ACTIVE_DIAGRAMS registry is orphaned (same rationale
        // as reset_current_session; partial-retention paths like /rewind must
        // NOT do this).
        crate::tui::mermaid::clear_active_diagrams();
        self.scroll_offset = 0;
        self.auto_scroll_paused = false;
        self.set_status_notice("View cleared (context kept)");
    }

    pub(super) fn apply_compacted_history_window(
        &mut self,
        mut messages: Vec<DisplayMessage>,
        images: Vec<crate::session::RenderedImage>,
        total_messages: usize,
        visible_messages: usize,
        remaining_messages: usize,
        hidden_user_prompts: usize,
    ) {
        let recent_history = self.recent_history_window_active();
        compact_display_messages_for_storage(&mut messages);
        carry_over_tool_durations(&self.display_messages, &mut messages);
        if let Some(view) = self.transcript_view.as_mut() {
            let prepended = messages.len().saturating_sub(self.display_messages.len());
            view.prepend_history(&messages[..prepended]);
        }
        self.display_messages = messages;
        self.remote_side_pane_images = images;
        self.invalidate_side_pane_images_signature();
        self.compacted_history_lazy = CompactedHistoryLazyState {
            total_messages,
            visible_messages,
            remaining_messages,
            hidden_user_prompts,
            pending_request_visible: None,
        };
        if recent_history {
            // Once the current transcript is fully visible, its original
            // compaction marker (if any) becomes the next lazy history source.
            self.sync_compacted_history_lazy_from_display_messages();
        }
        self.auto_scroll_paused = true;
        // Older messages are prepended above the current view. If the reader had
        // an anchor captured (they scrolled up to trigger this load), leave the
        // scroll position for the next render to resolve so the content under
        // them stays put instead of teleporting to the new absolute top. Only
        // fall back to the top when there is no anchor to honor.
        if self.pending_history_anchor.is_none() {
            self.scroll_offset = 0;
        }
        self.bump_display_messages_version();
        self.note_runtime_memory_event_force(
            "compacted_history_loaded",
            "display_history_lazy_window",
        );
        if remaining_messages > 0 {
            self.set_status_notice(format!(
                "Loaded {} compacted messages · {} older hidden",
                visible_messages, remaining_messages
            ));
        } else if total_messages > 0 {
            self.set_status_notice(format!("Loaded all {} compacted messages", total_messages));
        }
    }

    /// Number of wrapped lines from the top of the chat viewport that should be
    /// treated as the "near the top" zone that proactively loads older history.
    /// Prefetching roughly one viewport ahead means scrolling up keeps flowing
    /// instead of stalling at a hard wall and then jumping.
    fn compacted_history_prefetch_threshold(&self) -> usize {
        let viewport = crate::tui::ui::last_layout_snapshot()
            .map(|layout| layout.messages_area.height as usize)
            .unwrap_or(0);
        // Trigger when within ~one viewport of the top, with a small floor so the
        // behavior is sensible even before the first layout snapshot exists.
        viewport.max(COMPACTED_HISTORY_LOAD_SCROLL_THRESHOLD)
    }

    /// Capture a viewport anchor describing the reader's current distance from
    /// the bottom of the transcript, plus any leftover upward scroll intent that
    /// could not be satisfied because the view was already at the top of the
    /// currently-loaded content. The next render that includes the newly loaded
    /// (prepended) history resolves this back into an absolute `scroll_offset`,
    /// keeping the content under the reader stable across the load.
    pub(super) fn capture_history_anchor(&mut self, overshoot: usize) {
        // Don't clobber an anchor that is still waiting to be resolved; the
        // original distance-from-bottom remains correct across further prepends.
        if self.pending_history_anchor.is_some() {
            return;
        }
        let total = crate::tui::ui::last_total_wrapped_lines();
        if total == 0 {
            return;
        }
        // The top of the viewport currently sits at absolute line `scroll_offset`
        // within the pre-prepend transcript (length `total`). Its distance from
        // the bottom is invariant when older lines are prepended, so capture it
        // (plus any unsatisfied upward intent as `overshoot`) and let the next
        // render map it back to an absolute offset against the larger total.
        let scroll = self.scroll_offset.min(total);
        let lines_from_bottom = total.saturating_sub(scroll).saturating_add(overshoot);
        // A prepend shifts content ordinals, so a resize anchor captured against
        // the pre-prepend frame can no longer be trusted to name the same
        // message. Drop it; this prepend anchor is authoritative.
        self.pending_resize_anchor = None;
        self.pending_history_anchor = Some(super::HistoryScrollAnchor {
            lines_from_bottom,
            base_total: total,
        });
    }

    /// Adopt a resolved history anchor once a frame containing the newly loaded
    /// content has rendered. Returns true when the scroll position changed.
    pub(super) fn reconcile_history_anchor(&mut self) -> bool {
        let Some(anchor) = self.pending_history_anchor else {
            return false;
        };
        let total = crate::tui::ui::last_total_wrapped_lines();
        // Wait until a frame with the prepended content has actually rendered
        // (its total wrapped-line count differs from the captured base).
        if total == 0 || total == anchor.base_total {
            return false;
        }
        let resolved = crate::tui::ui::last_resolved_chat_scroll();
        self.pending_history_anchor = None;
        let changed = self.scroll_offset != resolved || !self.auto_scroll_paused;
        self.scroll_offset = resolved;
        self.auto_scroll_paused = true;
        changed
    }

    /// Capture the reader's position in content coordinates before a resize
    /// rewraps the transcript. Only meaningful while parked in history; while
    /// following the tail the resize snaps to the new bottom instead.
    pub(super) fn capture_resize_anchor(&mut self) {
        if !self.auto_scroll_paused {
            return;
        }
        // A prepend anchor may be pending here, and this capture is still the
        // right one: a content position is width-independent, while the prepend
        // anchor's row distance is only meaningful at the width it was captured
        // at. So this anchor takes precedence while it exists, and the prepend
        // anchor adopts the resolved row afterwards. The prepend anchor still
        // wins when it is captured *after* this one (see
        // `capture_history_anchor`), which is what stops a prepended duplicate
        // from being misnamed.
        //
        // ponytail: if the prepended history is still in flight (a remote load)
        // and contains a message identical to the anchored one, this ordinal can
        // name the older copy until messages get a stable identity.
        let Some(frame) = crate::tui::ui::last_chat_frame() else {
            return;
        };
        // The row actually on screen, not the stored index (which may exceed
        // the scrollable range after an earlier widen).
        let row = crate::tui::ui::last_resolved_chat_scroll();
        let Some(target) = rayucode_tui_messages::content_pos_at_row(&frame, row) else {
            return;
        };
        let captured_width = crate::tui::ui::last_layout_snapshot()
            .map(|layout| layout.messages_area.width)
            .unwrap_or(0);
        self.pending_resize_anchor = Some(super::PendingResizeAnchor {
            target,
            captured_width,
            captured_scroll: row,
        });
    }

    /// Adopt the row the renderer resolved from a pending resize anchor, once a
    /// frame laid out against the new geometry has rendered. Returns true when
    /// the scroll position changed.
    pub(super) fn reconcile_resize_anchor(&mut self) -> bool {
        let Some(pending) = self.pending_resize_anchor else {
            return false;
        };
        let width = crate::tui::ui::last_layout_snapshot()
            .map(|layout| layout.messages_area.width)
            .unwrap_or(0);
        let resolved = crate::tui::ui::last_resolved_chat_scroll();
        // Wait until a frame has been laid out against the new geometry: either
        // the viewport width moved off the captured one, or the resolved row
        // already differs from the row captured. Both readings are stale until
        // that frame exists, so resolving early would adopt the old position.
        if width == pending.captured_width && resolved == pending.captured_scroll {
            return false;
        }
        self.pending_resize_anchor = None;
        let changed = self.scroll_offset != resolved;
        self.scroll_offset = resolved;
        self.auto_scroll_paused = true;
        changed
    }

    pub(super) fn maybe_queue_compacted_history_load(&mut self) {
        self.maybe_queue_compacted_history_load_with_overshoot(0);
    }

    pub(super) fn maybe_queue_compacted_history_load_with_overshoot(&mut self, overshoot: usize) {
        if self.recent_history_paging.request.is_some() {
            return;
        }
        if !self.auto_scroll_paused {
            return;
        }
        if self.scroll_offset > self.compacted_history_prefetch_threshold() {
            return;
        }
        if self.compacted_history_lazy.remaining_messages == 0 {
            return;
        }
        if self
            .compacted_history_lazy
            .pending_request_visible
            .is_some()
        {
            return;
        }
        // Throttle to one chunk per settled frame: while an anchor is still
        // waiting to resolve on screen, hold off so prepends never compound into
        // a visible jump.
        if self.pending_history_anchor.is_some() {
            return;
        }

        let next_visible = self
            .compacted_history_lazy
            .visible_messages
            .saturating_add(COMPACTED_HISTORY_CHUNK_MESSAGES)
            .min(self.compacted_history_lazy.total_messages);
        if next_visible <= self.compacted_history_lazy.visible_messages {
            return;
        }

        // Anchor the viewport before mutating so the prepend stays seamless.
        self.capture_history_anchor(overshoot);

        if self.is_remote {
            self.compacted_history_lazy.pending_request_visible = Some(next_visible);
            self.set_status_notice(format!(
                "Loading older history… {} of {}",
                next_visible, self.compacted_history_lazy.total_messages
            ));
        } else {
            self.apply_local_compacted_history_window(next_visible);
        }
    }

    pub(super) fn take_pending_compacted_history_load(&mut self) -> Option<usize> {
        if self
            .recent_history_paging
            .retry_at
            .is_some_and(|deadline| Instant::now() < deadline)
        {
            return None;
        }
        self.recent_history_paging.retry_at = None;
        self.compacted_history_lazy.pending_request_visible.take()
    }

    pub(super) fn recent_history_window_active(&self) -> bool {
        self.display_messages.first().is_some_and(|message| {
            message.role == "system"
                && message
                    .content
                    .starts_with(crate::protocol::RECENT_HISTORY_MARKER_PREFIX)
        })
    }

    /// A response computed before a live append or rewind must not discard it.
    /// Retry against the new generation while retaining the viewport anchor.
    pub(super) fn accept_recent_history_response(&mut self, id: u64) -> bool {
        let Some((expected, version, visible)) = self.recent_history_paging.request else {
            return !self.recent_history_window_active();
        };
        if id != expected {
            return false;
        }
        self.recent_history_paging.request = None;
        if version != self.display_messages_version {
            if self.recent_history_window_active() {
                self.restore_pending_compacted_history_load(visible);
                self.recent_history_paging.retry_at =
                    Some(Instant::now() + Duration::from_millis(250));
            }
            return false;
        }
        true
    }

    pub(super) fn recent_history_page_contains_visible_tail(
        &mut self,
        messages: &mut [DisplayMessage],
        visible: usize,
    ) -> bool {
        if !self.recent_history_window_active() {
            return true;
        }
        compact_display_messages_for_storage(messages);
        // A busy agent may supply a persisted snapshot. Generation fencing
        // alone cannot detect a snapshot already stale when we sent the request.
        // Require its real transcript tail to include the rows on screen, while
        // ignoring local status notices which are never part of server history.
        let meaningful = |role: &str| matches!(role, "user" | "assistant" | "tool");
        let current: Vec<_> = self
            .display_messages
            .iter()
            .filter(|m| meaningful(&m.role))
            .collect();
        let incoming: Vec<_> = messages.iter().filter(|m| meaningful(&m.role)).collect();
        let matches = current.is_empty()
            || incoming.windows(current.len()).any(|window| {
                window
                    .iter()
                    .zip(&current)
                    .all(|(new, old)| new.role == old.role && new.content == old.content)
            });
        if !matches {
            self.restore_pending_compacted_history_load(visible);
            self.recent_history_paging.retry_at = Some(Instant::now() + Duration::from_millis(250));
        }
        matches
    }

    /// Whether there are older compacted-history messages not yet loaded into the
    /// display transcript.
    pub(super) fn compacted_history_has_remaining(&self) -> bool {
        self.compacted_history_lazy.remaining_messages > 0
    }

    pub(super) fn restore_pending_compacted_history_load(&mut self, visible_messages: usize) {
        self.compacted_history_lazy.pending_request_visible = Some(visible_messages);
    }

    #[cfg(test)]
    pub(super) fn compacted_history_lazy_state(&self) -> &CompactedHistoryLazyState {
        &self.compacted_history_lazy
    }

    fn sync_compacted_history_lazy_from_display_messages(&mut self) {
        let mut lazy = self
            .display_messages
            .first()
            .and_then(parse_compacted_history_marker)
            .unwrap_or_default();
        let marker_hidden_prompts = self
            .display_messages
            .first()
            .filter(|message| parse_compacted_history_marker(message).is_some())
            .and_then(|message| {
                message
                    .content
                    .rsplit_once(" Hidden user prompts: ")
                    .and_then(|(_, count)| count.strip_suffix('.'))
                    .and_then(|count| count.parse::<usize>().ok())
            });
        // New servers include the authoritative offset. A remote startup stub
        // has no transcript, and a retained local snapshot may be stale.
        // Derive it locally only for legacy markers without that metadata.
        if let Some(hidden) = marker_hidden_prompts {
            lazy.hidden_user_prompts = hidden;
        } else if lazy.remaining_messages > 0 || lazy.total_messages > 0 {
            let visible = if lazy.remaining_messages == 0 {
                usize::MAX
            } else {
                lazy.visible_messages
            };
            let (_, _, compacted_info) =
                crate::session::render_messages_and_images_with_compacted_history(
                    &self.session,
                    visible,
                );
            if let Some(info) = compacted_info {
                lazy.hidden_user_prompts = info.hidden_user_prompts;
            }
        }
        self.compacted_history_lazy = lazy;
    }

    fn apply_local_compacted_history_window(&mut self, visible_messages: usize) {
        let (rendered_messages, images, compacted_info) =
            crate::session::render_messages_and_images_with_compacted_history(
                &self.session,
                visible_messages,
            );
        let Some(compacted_info) = compacted_info else {
            return;
        };
        let display_messages = rendered_messages
            .into_iter()
            .map(DisplayMessage::from_rendered_message)
            .collect();
        self.apply_compacted_history_window(
            display_messages,
            images,
            compacted_info.total_messages,
            compacted_info.visible_messages,
            compacted_info.remaining_messages,
            compacted_info.hidden_user_prompts,
        );
    }
}

/// Older history pages can omit tool durations that the loaded tail observed
/// live. Retain those values by call ID so the badges and prepared rows survive
/// a prepend.
fn carry_over_tool_durations(previous: &[DisplayMessage], incoming: &mut [DisplayMessage]) {
    let known: std::collections::HashMap<&str, f32> = previous
        .iter()
        .filter(|message| message.role == "tool")
        .filter_map(|message| {
            let tool = message.tool_data.as_ref()?;
            let seconds = message.duration_secs?;
            (!tool.id.is_empty()).then_some((tool.id.as_str(), seconds))
        })
        .collect();
    if known.is_empty() {
        return;
    }
    for message in incoming.iter_mut() {
        if message.role != "tool" || message.duration_secs.is_some() {
            continue;
        }
        if let Some(seconds) = message
            .tool_data
            .as_ref()
            .and_then(|tool| known.get(tool.id.as_str()))
        {
            message.duration_secs = Some(*seconds);
        }
    }
}

#[cfg(test)]
mod tool_activity_tests {
    use super::*;
    use crate::protocol::ServerEvent;

    #[test]
    fn reattached_batch_keeps_finished_and_cancelled_child_metrics() {
        let mut app = crate::tui::app::tests::create_test_app();
        let snapshot = serde_json::from_value(serde_json::json!({
            "identity": {"runtime_generation": "fixture", "turn_id": 7},
            "tool": {"id": "parent", "name": "batch", "input": {"tool_calls": [
                {"tool": "bash", "intent": "Long child"},
                {"tool": "read", "intent": "Finished child"}
            ]}},
            "elapsed_ms": 1250,
            "batch": {
                "session_id": "session", "tool_call_id": "parent", "total": 2, "completed": 1,
                "subcalls": [
                    {"index": 1, "tool_call": {"id": "batch-1-bash", "name": "bash"}, "state": "running"},
                    {"index": 2, "tool_call": {"id": "batch-2-read", "name": "read"}, "state": "succeeded",
                     "metrics": {"duration_ms": 414, "output_bytes": 80}}
                ]
            }
        })).unwrap();
        app.restore_remote_tool_activity(snapshot);
        let child_id = crate::tui::core::batch_child_call_id("parent", "batch-1-bash");
        assert!(app.tool_execution_starts[&child_id].elapsed() >= Duration::from_millis(1250));
        assert!(app.apply_bash_progress(crate::protocol::BashProgress {
            call_id: child_id,
            elapsed_ms: 1280,
            output_bytes: 36,
            tail: "before interruption".into(),
        }));
        app.interrupt_pending_tools();
        let result = app.display_messages.last().unwrap();
        assert_eq!(result.role, "tool");
        assert!(
            result
                .content
                .contains("output_bytes=36] --- [1] bash ---\nError: Cancelled")
        );
        assert!(
            result
                .content
                .contains("duration_ms=414 output_bytes=80] --- [2] read ---\nCompleted")
        );
        assert!(result.duration_secs.unwrap() >= 1.25);
        assert!(app.bash_progress.is_empty());
        assert!(app.batch_progress.is_none());
    }

    #[test]
    fn sibling_tool_results_replace_live_rows_in_start_order() {
        let mut app = crate::tui::app::tests::create_test_app();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut remote = crate::tui::backend::RemoteConnection::dummy();
            remote.mark_history_loaded();
            app.is_processing = true;
            for id in ["first", "second"] {
                app.handle_server_event(
                    ServerEvent::ToolStart {
                        id: id.into(),
                        name: "bash".into(),
                    },
                    &mut remote,
                );
            }
            app.handle_server_event(
                ServerEvent::ToolInput {
                    id: Some("second".into()),
                    delta: r#"{"command":"printf fixture"}"#.into(),
                },
                &mut remote,
            );
            app.handle_server_event(
                ServerEvent::ToolExec {
                    id: "second".into(),
                    name: "bash".into(),
                },
                &mut remote,
            );
            assert_eq!(app.display_messages[1].content, "Running…");
            assert_eq!(
                app.display_messages[1].tool_data.as_ref().unwrap().input["command"],
                "printf fixture"
            );
            app.handle_server_event(
                ServerEvent::ToolDone {
                    tool_duration_ms: None,
                    id: "second".into(),
                    name: "bash".into(),
                    output: "completed second".into(),
                    error: None,
                },
                &mut remote,
            );
            assert_eq!(app.display_messages[0].role, PENDING_TOOL_ROLE);
            assert_eq!(app.display_messages[1].content, "[bash] completed second");
            app.handle_server_event(ServerEvent::Interrupted, &mut remote);
            assert_eq!(
                app.display_messages[0].content,
                "Error: Interrupted by user"
            );
            assert!(
                app.display_messages
                    .iter()
                    .all(|row| row.role != PENDING_TOOL_ROLE)
            );

            app.handle_server_event(
                ServerEvent::ToolExec {
                    id: "reconnected".into(),
                    name: "read".into(),
                },
                &mut remote,
            );
            assert!(app.pending_tool_row("reconnected").is_some());
            app.rollback_streaming_attempt();
            assert!(app.pending_tool_row("reconnected").is_none());
        });
    }
}
