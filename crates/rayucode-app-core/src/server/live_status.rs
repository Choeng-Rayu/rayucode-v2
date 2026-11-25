//! Lock-independent projection of the events consumed by an opened worker.
//! This does not read Agent while its turn mutex is held, or invent transport
//! information from a provider name.
use crate::message::ToolCall;
use crate::protocol::{ActiveToolSnapshot, ServerEvent, SwarmLiveStatus};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const MAX_OUTPUT_TAIL_LINES: usize = 40;
const MAX_OUTPUT_LINE_CHARS: usize = 400;

#[derive(Default)]
struct OutputTailBuffer {
    lines: VecDeque<String>,
    partial: String,
    /// True once `observe()` has directly received stream events (`TurnStarted`,
    /// `TextDelta`, or `ToolExec`) for the active turn. While direct observation
    /// is active, `merge_output_tail` snapshots from `SwarmOutputTail` are
    /// ignored so they never clear `partial` mid-line or duplicate lines.
    has_direct_stream: bool,
    /// True when the final line in `lines` came from a `merge_snapshot` call so
    /// a subsequent direct stream line that extends it replaces it in place.
    last_line_from_merge: bool,
}

impl OutputTailBuffer {
    fn push_line(&mut self, line: String) {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.trim().is_empty() {
            return;
        }
        let capped = cap_line(trimmed);
        if self.last_line_from_merge {
            self.last_line_from_merge = false;
            if let Some(last) = self.lines.back_mut()
                && (*last == capped || capped.starts_with(last.as_str()))
            {
                *last = capped;
                return;
            }
        }
        if self.lines.back().is_some_and(|last| last == &capped) {
            return;
        }
        self.lines.push_back(capped);
        while self.lines.len() > MAX_OUTPUT_TAIL_LINES {
            self.lines.pop_front();
        }
    }

    fn commit_partial(&mut self) {
        if !self.partial.is_empty() {
            let line = std::mem::take(&mut self.partial);
            self.push_line(line);
        }
    }

    fn push_stream_text(&mut self, text: &str) {
        self.has_direct_stream = true;
        for ch in text.chars() {
            if ch == '\n' {
                let line = std::mem::take(&mut self.partial);
                self.push_line(line);
            } else if ch != '\r' && self.partial.len() < MAX_OUTPUT_LINE_CHARS * 4 {
                self.partial.push(ch);
            }
        }
    }

    fn merge_snapshot(&mut self, tail: &str) -> bool {
        if self.has_direct_stream {
            return false;
        }
        let incoming: Vec<String> = tail
            .lines()
            .map(|l| l.trim_end_matches('\r'))
            .filter(|l| !l.trim().is_empty())
            .map(cap_line)
            .collect();
        if incoming.is_empty() {
            return false;
        }
        self.partial.clear();
        if self.lines.is_empty() {
            for line in incoming {
                self.push_line(line);
            }
            self.last_line_from_merge = !self.lines.is_empty();
            return true;
        }

        // Find the longest overlap between the existing tail and the incoming
        // rolling window, allowing the final overlapped line to match when the
        // incoming line extends it in-place (e.g. tool duration suffix or live
        // text delta on the final line).
        let existing_len = self.lines.len();
        let max_overlap = existing_len.min(incoming.len());
        let mut best_overlap = 0usize;
        let mut replace_last = false;

        for overlap in (1..=max_overlap).rev() {
            let start = existing_len - overlap;
            let prefix_matches = (0..overlap.saturating_sub(1))
                .all(|i| self.lines[start + i] == incoming[i]);
            if !prefix_matches {
                continue;
            }
            let last_existing = &self.lines[existing_len - 1];
            let last_incoming = &incoming[overlap - 1];
            if last_existing == last_incoming {
                best_overlap = overlap;
                replace_last = false;
                break;
            }
            if last_incoming.starts_with(last_existing.as_str()) {
                best_overlap = overlap;
                replace_last = true;
                break;
            }
        }

        if best_overlap > 0 {
            if replace_last && let Some(back) = self.lines.back_mut() {
                *back = incoming[best_overlap - 1].clone();
            }
            for line in incoming.into_iter().skip(best_overlap) {
                self.push_line(line);
            }
        } else {
            for line in incoming {
                self.push_line(line);
            }
        }
        self.last_line_from_merge = !self.lines.is_empty();
        true
    }

    fn snapshot_lines(&self) -> Vec<String> {
        let mut out: Vec<String> = self.lines.iter().cloned().collect();
        if !self.partial.trim().is_empty() {
            let partial = cap_line(&self.partial);
            if out.last().is_none_or(|last| last != &partial) {
                out.push(partial);
            }
        }
        if out.len() > MAX_OUTPUT_TAIL_LINES {
            out.drain(..out.len() - MAX_OUTPUT_TAIL_LINES);
        }
        out
    }
}

fn cap_line(line: &str) -> String {
    if line.chars().count() <= MAX_OUTPUT_LINE_CHARS {
        return line.to_string();
    }
    let mut out: String = line.chars().take(MAX_OUTPUT_LINE_CHARS - 1).collect();
    out.push('…');
    out
}

static LIVE: LazyLock<Mutex<HashMap<String, Projection>>> = LazyLock::new(Mutex::default);
static OUTPUT_TAIL: LazyLock<Mutex<HashMap<String, OutputTailBuffer>>> =
    LazyLock::new(Mutex::default);
/// Sessions currently running background compaction, tracked lock-free so
/// `project_activity::active_runtime_note` can observe compaction even while
/// an active turn holds `Agent`'s mutex.
static COMPACTING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);
static CHANGED: LazyLock<tokio::sync::watch::Sender<u64>> =
    LazyLock::new(|| tokio::sync::watch::channel(0).0);
static OUTPUT_CHANGED: LazyLock<tokio::sync::watch::Sender<u64>> =
    LazyLock::new(|| tokio::sync::watch::channel(0).0);

pub(super) fn subscribe_changes() -> tokio::sync::watch::Receiver<u64> {
    CHANGED.subscribe()
}

pub(super) fn subscribe_output_changes() -> tokio::sync::watch::Receiver<u64> {
    OUTPUT_CHANGED.subscribe()
}

fn notify_changed() {
    CHANGED.send_modify(|generation| *generation = generation.wrapping_add(1));
}

fn notify_output_changed() {
    OUTPUT_CHANGED.send_modify(|generation| *generation = generation.wrapping_add(1));
}

struct Projection {
    value: SwarmLiveStatus,
    started: Instant,
    ended: Option<Instant>,
    streaming_started: Option<Instant>,
    streaming_elapsed: Duration,
    total_output: u64,
    call_output: u64,
    new_call: bool,
    tool_inputs: HashMap<String, String>,
    last_tool_id: Option<String>,
    active_tool: Option<(Instant, ActiveToolSnapshot)>,
    interruption_reason: Option<String>,
}

impl Projection {
    fn new(now: Instant) -> Self {
        Self {
            value: SwarmLiveStatus {
                phase: "sending".into(),
                ..Default::default()
            },
            started: now,
            ended: None,
            streaming_started: None,
            streaming_elapsed: Duration::ZERO,
            total_output: 0,
            call_output: 0,
            new_call: true,
            tool_inputs: HashMap::new(),
            last_tool_id: None,
            active_tool: None,
            interruption_reason: None,
        }
    }

    fn pause(&mut self, now: Instant) {
        if let Some(start) = self.streaming_started.take() {
            self.streaming_elapsed += now.saturating_duration_since(start);
        }
    }

    fn observe(&mut self, event: &ServerEvent, now: Instant) {
        let (event, identity) = match event {
            ServerEvent::TurnEvent { event, identity } => (event.as_ref(), Some(identity)),
            event => (event, None),
        };
        match event {
            ServerEvent::ConnectionType { connection } => {
                self.value.connection_type = Some(connection.clone())
            }
            ServerEvent::StatusDetail { detail } => self.value.status_detail = Some(detail.clone()),
            ServerEvent::ConnectionPhase { phase } => {
                if phase == "streaming" {
                    self.streaming_started.get_or_insert(now);
                    self.value.phase = "streaming".into();
                } else {
                    self.pause(now);
                    self.value.phase = "connecting".into();
                }
                self.value.connection_phase = Some(phase.clone());
                self.value.stream_message_ended = false;
            }
            ServerEvent::ToolStart { id, .. } => {
                self.tool_inputs.insert(id.clone(), String::new());
                self.last_tool_id = Some(id.clone());
                self.value.phase = "streaming".into();
                self.streaming_started.get_or_insert(now);
            }
            ServerEvent::ToolInput { id, delta } => {
                if let Some(id) = id.as_ref().or(self.last_tool_id.as_ref()) {
                    let input = self.tool_inputs.entry(id.clone()).or_default();
                    // Only retain a small bounded input for the display intent.
                    if input.len().saturating_add(delta.len()) <= 65536 {
                        input.push_str(delta);
                    }
                }
            }
            ServerEvent::TextDelta { .. } | ServerEvent::ReasoningDelta { .. } => {
                self.value.phase = if matches!(event, ServerEvent::ReasoningDelta { .. }) {
                    "thinking"
                } else {
                    "streaming"
                }
                .into();
                self.value.stream_message_ended = false;
                self.streaming_started.get_or_insert(now);
            }
            ServerEvent::TokenUsage { input, output, .. } => {
                if self.new_call {
                    self.call_output = 0;
                    self.new_call = false;
                }
                self.total_output = self
                    .total_output
                    .saturating_add(output.saturating_sub(self.call_output));
                self.call_output = self.call_output.max(*output);
                self.value.input_tokens = Some(*input);
                self.value.output_tokens = Some(*output);
                let elapsed = self.streaming_elapsed
                    + self
                        .streaming_started
                        .map(|s| now.saturating_duration_since(s))
                        .unwrap_or(Duration::ZERO);
                self.value.output_tps_milli = (elapsed.as_secs_f64() > 0.1
                    && self.total_output > 0)
                    .then(|| (self.total_output as f64 * 1000.0 / elapsed.as_secs_f64()) as u64);
            }
            ServerEvent::ToolCall { name, input, .. } => {
                self.value.tool_name = Some(name.clone());
                self.value.tool_intent = input
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned);
            }
            ServerEvent::ToolExec { id, name } => {
                self.pause(now);
                self.value.phase = "running_tool".into();
                self.value.tool_name = Some(name.clone());
                let input = self
                    .tool_inputs
                    .remove(id)
                    .and_then(|s| match serde_json::from_str::<serde_json::Value>(&s) {
                        Ok(value) => Some(value),
                        Err(error) => {
                            crate::logging::debug(&format!(
                                "Live tool intent unavailable for {id}: {error}"
                            ));
                            None
                        }
                    })
                    .unwrap_or_default();
                let intent = ToolCall::intent_from_input(&input);
                self.value.tool_intent = intent.clone();
                self.active_tool = identity.map(|identity| {
                    (
                        now,
                        ActiveToolSnapshot {
                            identity: identity.clone(),
                            tool: ToolCall {
                                id: id.clone(),
                                name: name.clone(),
                                input,
                                intent,
                                thought_signature: None,
                            },
                            elapsed_ms: 0,
                            batch: None,
                        },
                    )
                });
            }
            ServerEvent::BatchProgress { progress } => {
                self.value.batch_progress = (progress.total > 0)
                    .then_some((progress.completed as u32, progress.total as u32));
                if let Some((_, tool)) = &mut self.active_tool
                    && identity == Some(&tool.identity)
                    && progress.tool_call_id == tool.tool.id
                {
                    tool.batch = Some(progress.clone());
                }
            }
            ServerEvent::ToolDone { id, .. } => {
                if self
                    .active_tool
                    .as_ref()
                    .is_some_and(|(_, tool)| tool.tool.id == *id)
                {
                    self.active_tool = None;
                }
                self.value.tool_name = None;
                self.value.tool_intent = None;
                self.value.batch_progress = None;
                self.value.phase = "sending".into();
            }
            ServerEvent::MessageEnd { .. } => {
                self.pause(now);
                self.value.stream_message_ended = true;
                // Provider stop tokens describe one response, not why the
                // worker is idle/stopped. Only lifecycle/interrupt reasons
                // belong in the user-facing stop explanation.
            }
            ServerEvent::KvCacheRequest { .. } => self.new_call = true,
            ServerEvent::RetryRollback { .. } => {
                self.pause(now);
                self.value.phase = "connecting".into();
                self.value.input_tokens = None;
                self.value.output_tokens = None;
                self.new_call = true;
                self.active_tool = None;
            }
            ServerEvent::TurnStopped { message, .. } => {
                self.interruption_reason = Some(message.clone());
                self.value.stop_reason = Some(message.clone());
            }
            ServerEvent::Interrupted => {
                self.active_tool = None;
                self.interruption_reason = Some("Interrupted by user".into());
                self.value.stop_reason = self.interruption_reason.clone();
            }
            ServerEvent::TurnStarted { .. }
            | ServerEvent::Done { .. }
            | ServerEvent::Error { .. } => {
                self.active_tool = None;
            }
            _ => {}
        }
    }

    fn snapshot(&self, now: Instant) -> SwarmLiveStatus {
        let mut value = self.value.clone();
        value.elapsed_ms = self
            .ended
            .unwrap_or(now)
            .saturating_duration_since(self.started)
            .as_millis()
            .min(u64::MAX as u128) as u64;
        value
    }
}

pub(super) fn begin(session_id: &str) {
    LIVE.lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(session_id.into(), Projection::new(Instant::now()));
    let mut tails = OUTPUT_TAIL.lock().unwrap_or_else(|e| e.into_inner());
    let buf = tails.entry(session_id.into()).or_default();
    buf.commit_partial();
    buf.has_direct_stream = false;
    buf.last_line_from_merge = false;
}

pub(super) fn observe(session_id: &str, event: &ServerEvent) {
    let mut tool_exec_marker: Option<String> = None;
    if let Some(p) = LIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_mut(session_id)
    {
        let previous = p.value.clone();
        let final_phase = p.ended.map(|ended| (ended, p.value.phase.clone()));
        p.observe(event, Instant::now());
        // The forwarding task can drain trailing usage after the lifecycle
        // completed. Keep those counts without reviving a stopped spinner.
        if let Some((ended, phase)) = final_phase {
            p.pause(ended);
            p.value.phase = phase;
            p.active_tool = None;
        }
        let inner = match event {
            ServerEvent::TurnEvent { event, .. } => event.as_ref(),
            event => event,
        };
        if let ServerEvent::ToolExec { name, .. } = inner {
            tool_exec_marker = Some(
                match p
                    .value
                    .tool_intent
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    Some(intent) => format!("⚙ {name} · {intent}"),
                    None => format!("⚙ {name}"),
                },
            );
        }
        if previous != p.value {
            notify_changed();
        }
    }

    let inner = match event {
        ServerEvent::TurnEvent { event, .. } => event.as_ref(),
        event => event,
    };
    let mut output_updated = false;
    match inner {
        ServerEvent::TurnStarted { .. } => {
            OUTPUT_TAIL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(session_id.into())
                .or_default()
                .has_direct_stream = true;
        }
        ServerEvent::TextDelta { text } if !text.is_empty() => {
            OUTPUT_TAIL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(session_id.into())
                .or_default()
                .push_stream_text(text);
            output_updated = true;
        }
        ServerEvent::ToolExec { name, .. } => {
            let mut tails = OUTPUT_TAIL.lock().unwrap_or_else(|e| e.into_inner());
            let buf = tails.entry(session_id.into()).or_default();
            buf.has_direct_stream = true;
            buf.commit_partial();
            buf.push_line(tool_exec_marker.unwrap_or_else(|| format!("⚙ {name}")));
            output_updated = true;
        }
        ServerEvent::RetryRollback { .. } => {
            if let Some(buf) = OUTPUT_TAIL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get_mut(session_id)
            {
                buf.partial.clear();
            }
        }
        ServerEvent::MessageEnd { .. }
        | ServerEvent::Done { .. }
        | ServerEvent::Error { .. }
        | ServerEvent::Interrupted => {
            let mut tails = OUTPUT_TAIL.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(buf) = tails.get_mut(session_id) {
                buf.commit_partial();
            }
            if let ServerEvent::Error { message, .. } = inner {
                tails
                    .entry(session_id.into())
                    .or_default()
                    .push_line(format!("✗ {message}"));
                output_updated = true;
            }
        }
        _ => {}
    }
    if output_updated {
        notify_output_changed();
    }
}

pub(super) fn set_batch_progress(session_id: &str, progress: Option<(u32, u32)>) -> bool {
    let mut live = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let changed = if let Some(p) = live.get_mut(session_id) {
        if p.value.batch_progress == progress {
            false
        } else {
            p.value.batch_progress = progress;
            true
        }
    } else if let Some(progress) = progress {
        let mut p = Projection::new(Instant::now());
        p.value.phase = "running_tool".into();
        p.value.tool_name = Some("batch".into());
        p.value.batch_progress = Some(progress);
        live.insert(session_id.into(), p);
        true
    } else {
        false
    };
    drop(live);
    if changed {
        notify_changed();
    }
    changed
}

#[cfg(test)]
pub(super) fn append_output_tail(session_id: &str, line: impl Into<String>) {
    let line = line.into();
    {
        let mut tails = OUTPUT_TAIL.lock().unwrap_or_else(|e| e.into_inner());
        let buf = tails.entry(session_id.into()).or_default();
        buf.commit_partial();
        buf.push_line(line);
    }
    notify_output_changed();
}

pub(super) fn merge_output_tail(session_id: &str, snapshot: &str) {
    if snapshot.trim().is_empty() {
        return;
    }
    let changed = {
        let mut tails = OUTPUT_TAIL.lock().unwrap_or_else(|e| e.into_inner());
        tails
            .entry(session_id.into())
            .or_default()
            .merge_snapshot(snapshot)
    };
    if changed {
        notify_output_changed();
    }
}

pub(crate) fn set_compacting(session_id: &str, compacting: bool) {
    let changed = {
        let mut set = COMPACTING.lock().unwrap_or_else(|e| e.into_inner());
        if compacting {
            set.insert(session_id.to_string())
        } else {
            set.remove(session_id)
        }
    };
    if changed {
        notify_changed();
    }
}

pub(crate) fn is_compacting(session_id: &str) -> bool {
    COMPACTING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(session_id)
}

pub(super) fn output_tail(session_id: &str) -> Vec<String> {
    OUTPUT_TAIL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(session_id)
        .map(OutputTailBuffer::snapshot_lines)
        .unwrap_or_default()
}

pub(super) fn finish(session_id: &str, status: &str, reason: Option<&str>) {
    {
        let mut tails = OUTPUT_TAIL.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(buf) = tails.get_mut(session_id) {
            buf.commit_partial();
        }
    }
    if matches!(
        status,
        "ready" | "idle" | "done" | "completed" | "stopped" | "failed" | "crashed" | "cancelled"
    ) {
        super::subagent_registry::finish_bus_only_for_parent(session_id, status);
    }
    if let Some(p) = LIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_mut(session_id)
    {
        let now = Instant::now();
        p.pause(now);
        p.ended.get_or_insert(now);
        p.value.phase = status.into();
        p.value.tool_name = None;
        p.value.tool_intent = None;
        p.value.batch_progress = None;
        p.active_tool = None;
        if let Some(reason) = reason.filter(|reason| !reason.trim().is_empty()) {
            p.value.stop_reason = Some(reason.into());
        } else {
            p.value.stop_reason = Some(p.interruption_reason.clone().unwrap_or_else(|| {
                match status {
                    "ready" | "idle" => "Waiting for work",
                    "done" | "completed" => "Completed",
                    "stopped" => "Stopped",
                    "failed" | "crashed" => "Failed",
                    "cancelled" => "Cancelled",
                    "blocked" | "waiting" => "Waiting",
                    _ => status,
                }
                .into()
            }));
        }
        notify_changed();
    }
}

pub(super) fn snapshot(session_id: &str) -> Option<SwarmLiveStatus> {
    LIVE.lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(session_id)
        .map(|p| p.snapshot(Instant::now()))
}

pub(super) fn active_tool(session_id: &str) -> Option<ActiveToolSnapshot> {
    let live = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (started, tool) = live.get(session_id)?.active_tool.as_ref()?;
    let mut tool = tool.clone();
    tool.elapsed_ms = started.elapsed().as_millis() as u64;
    Some(tool)
}

pub(super) fn forget(session_id: &str) {
    LIVE.lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(session_id);
    OUTPUT_TAIL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(session_id);
    COMPACTING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_tool_snapshot_retains_arguments_for_a_live_turn_and_clears_on_retry() {
        let now = Instant::now();
        let mut projection = Projection::new(now);
        let identity = crate::protocol::TurnIdentity {
            runtime_generation: "fixture-generation".into(),
            turn_id: 2,
        };
        let scoped = |event| ServerEvent::TurnEvent {
            identity: identity.clone(),
            event: Box::new(event),
        };
        projection.observe(
            &scoped(ServerEvent::ToolStart {
                id: "call".into(),
                name: "bash".into(),
            }),
            now,
        );
        projection.observe(
            &scoped(ServerEvent::ToolInput {
                id: Some("call".into()),
                delta: r#"{"intent":"Show status","command":"true"}"#.into(),
            }),
            now,
        );
        projection.observe(
            &scoped(ServerEvent::ToolExec {
                id: "call".into(),
                name: "bash".into(),
            }),
            now,
        );
        let (_, tool) = projection.active_tool.as_ref().unwrap();
        assert_eq!(tool.identity, identity);
        assert_eq!(tool.tool.intent.as_deref(), Some("Show status"));
        assert_eq!(tool.tool.input["command"], "true");
        projection.observe(
            &scoped(ServerEvent::RetryRollback { attempt: 1, max: 2 }),
            now,
        );
        assert!(projection.active_tool.is_none());
    }

    fn request() -> ServerEvent {
        serde_json::from_value(serde_json::json!({
            "type":"kv_cache_request", "system_static_hash":0, "tools_hash":0,
            "messages_hash":0, "message_count":0, "tool_count":0
        }))
        .unwrap()
    }

    #[test]
    fn live_status_lifecycle_reasons_do_not_leak_provider_stop_tokens() {
        let id = "lifecycle-reason-regression";
        for token in ["tool_use", "end_turn"] {
            begin(id);
            observe(
                id,
                &ServerEvent::MessageEnd {
                    stop_reason: Some(token.into()),
                },
            );
            finish(id, "ready", None);
            assert_eq!(
                snapshot(id).unwrap().stop_reason.as_deref(),
                Some("Waiting for work")
            );
            finish(id, "stopped", None);
            assert_eq!(
                snapshot(id).unwrap().stop_reason.as_deref(),
                Some("Stopped")
            );
        }
        begin(id);
        observe(id, &ServerEvent::Interrupted);
        finish(id, "stopped", None);
        assert_eq!(
            snapshot(id).unwrap().stop_reason.as_deref(),
            Some("Interrupted by user")
        );
        finish(id, "stopped", Some("Owner cancelled the deployment"));
        assert_eq!(
            snapshot(id).unwrap().stop_reason.as_deref(),
            Some("Owner cancelled the deployment")
        );
        forget(id);
    }

    #[test]
    fn live_status_usage_resets_only_on_request_or_retry() {
        let now = Instant::now();
        let mut p = Projection::new(now);
        let usage = |output| ServerEvent::TokenUsage {
            input: 100,
            output,
            cache_read_input: None,
            cache_creation_input: None,
            effective_budget: None,
        };
        p.observe(&request(), now);
        p.observe(&usage(20), now);
        p.observe(&usage(10), now); // Stale report must not lower the watermark.
        p.observe(
            &ServerEvent::ConnectionPhase {
                phase: "connecting".into(),
            },
            now,
        );
        p.observe(
            &ServerEvent::ToolDone {
                tool_duration_ms: None,
                id: "native".into(),
                name: "search".into(),
                output: String::new(),
                error: None,
            },
            now,
        );
        p.observe(&usage(20), now);
        assert_eq!(p.total_output, 20);
        p.observe(&request(), now);
        p.observe(&usage(5), now);
        assert_eq!(p.total_output, 25);
        p.observe(&ServerEvent::RetryRollback { attempt: 1, max: 2 }, now);
        p.observe(&usage(5), now);
        assert_eq!(p.total_output, 30);
    }

    #[test]
    fn live_status_projects_counts_and_excludes_tool_time_from_tps() {
        let start = Instant::now();
        let mut p = Projection::new(start);
        p.observe(
            &ServerEvent::ConnectionType {
                connection: "websocket".into(),
            },
            start,
        );
        p.observe(
            &ServerEvent::ConnectionPhase {
                phase: "streaming".into(),
            },
            start,
        );
        p.observe(
            &ServerEvent::TokenUsage {
                input: 1200,
                output: 20,
                cache_read_input: Some(900),
                cache_creation_input: None,
                effective_budget: None,
            },
            start + Duration::from_secs(2),
        );
        assert_eq!(p.value.output_tps_milli, Some(10000));
        assert_eq!(p.value.input_tokens, Some(1200)); // Not input + cache + output.
        p.observe(
            &ServerEvent::TokenUsage {
                input: 1200,
                output: 20,
                cache_read_input: None,
                cache_creation_input: None,
                effective_budget: None,
            },
            start + Duration::from_secs(2),
        );
        assert_eq!(p.total_output, 20); // Duplicate final usage isn't counted twice.
        p.observe(
            &ServerEvent::MessageEnd {
                stop_reason: Some("tool_use".into()),
            },
            start + Duration::from_secs(2),
        );
        p.observe(
            &ServerEvent::TokenUsage {
                input: 1200,
                output: 20,
                cache_read_input: None,
                cache_creation_input: None,
                effective_budget: None,
            },
            start + Duration::from_secs(2),
        );
        assert_eq!(p.total_output, 20); // MessageEnd precedes the final usage event.
        p.observe(
            &ServerEvent::ToolStart {
                id: "t".into(),
                name: "bash".into(),
            },
            start + Duration::from_secs(2),
        );
        p.observe(
            &ServerEvent::ToolInput {
                id: Some("t".into()),
                delta: r#"{"intent":"Run tests"}"#.into(),
            },
            start + Duration::from_secs(2),
        );
        p.observe(
            &ServerEvent::ToolExec {
                id: "t".into(),
                name: "bash".into(),
            },
            start + Duration::from_secs(2),
        );
        assert_eq!(p.value.tool_intent.as_deref(), Some("Run tests"));
        p.observe(
            &ServerEvent::ToolDone {
                tool_duration_ms: None,
                id: "t".into(),
                name: "bash".into(),
                output: "ok".into(),
                error: None,
            },
            start + Duration::from_secs(102),
        );
        p.observe(&request(), start + Duration::from_secs(102));
        p.observe(
            &ServerEvent::ConnectionPhase {
                phase: "streaming".into(),
            },
            start + Duration::from_secs(102),
        );
        p.observe(
            &ServerEvent::TokenUsage {
                input: 1300,
                output: 10,
                cache_read_input: None,
                cache_creation_input: None,
                effective_budget: None,
            },
            start + Duration::from_secs(103),
        );
        assert_eq!(p.value.output_tps_milli, Some(10000));
        assert_eq!(
            p.snapshot(start + Duration::from_secs(103)).elapsed_ms,
            103000
        );
        assert_eq!(p.value.connection_type.as_deref(), Some("websocket"));
    }

    #[test]
    fn live_status_new_turn_has_no_invented_or_stale_telemetry() {
        let p = Projection::new(Instant::now());
        assert_eq!(p.value.input_tokens, None);
        assert_eq!(p.value.output_tokens, None);
        assert_eq!(p.value.connection_type, None);
        assert_eq!(p.value.output_tps_milli, None);
        assert_eq!(p.value.tool_intent, None);
    }

    #[test]
    fn batch_progress_and_bounded_output_tail_ring_buffer() {
        let sid = "live-status-batch-and-tail-test";
        forget(sid);

        assert!(set_batch_progress(sid, Some((3, 8))));
        assert_eq!(snapshot(sid).unwrap().batch_progress, Some((3, 8)));
        assert!(!set_batch_progress(sid, Some((3, 8))));
        assert!(set_batch_progress(sid, None));
        assert_eq!(snapshot(sid).unwrap().batch_progress, None);

        for idx in 1..=55 {
            append_output_tail(sid, format!("line-{idx}"));
        }
        let lines = output_tail(sid);
        assert_eq!(lines.len(), MAX_OUTPUT_TAIL_LINES);
        assert_eq!(lines.first().map(String::as_str), Some("line-16"));
        assert_eq!(lines.last().map(String::as_str), Some("line-55"));

        // Merging an overlapping snapshot deduplicates existing suffix lines and
        // updates an extended final line in place.
        merge_output_tail(sid, "line-54\nline-55 (1.2s)\nline-56");
        let merged = output_tail(sid);
        assert_eq!(merged.len(), MAX_OUTPUT_TAIL_LINES);
        assert_eq!(merged[merged.len() - 3], "line-54");
        assert_eq!(merged[merged.len() - 2], "line-55 (1.2s)");
        assert_eq!(merged[merged.len() - 1], "line-56");

        forget(sid);
        assert!(output_tail(sid).is_empty());
    }

    #[test]
    fn interleaved_text_delta_and_merge_output_tail_never_splits_or_duplicates() {
        let sid = "live-status-interleaved-tail-regression";
        forget(sid);
        begin(sid);

        // Stream a partial sentence via direct TextDelta, then interleave a
        // SwarmOutputTail rolling snapshot mid-line, then finish the line.
        observe(
            sid,
            &ServerEvent::TextDelta {
                text: "Hello ".to_string(),
            },
        );
        merge_output_tail(sid, "Hello ");
        observe(
            sid,
            &ServerEvent::TextDelta {
                text: "world!\nSecond ".to_string(),
            },
        );
        merge_output_tail(sid, "Hello world!\nSecond ");
        observe(
            sid,
            &ServerEvent::TextDelta {
                text: "line\n".to_string(),
            },
        );
        merge_output_tail(sid, "Hello world!\nSecond line");

        assert_eq!(
            output_tail(sid),
            vec!["Hello world!".to_string(), "Second line".to_string()],
            "interleaved merge_output_tail must never split or duplicate streaming lines"
        );

        // Reversed race: SwarmOutputTail arrives slightly before the first
        // TextDelta of a new turn; subsequent TextDelta completing that line
        // must replace the provisional prefix in place instead of duplicating.
        begin(sid);
        forget(sid);
        begin(sid);
        merge_output_tail(sid, "Draft ");
        observe(
            sid,
            &ServerEvent::TextDelta {
                text: "Draft complete\nNext\n".to_string(),
            },
        );
        merge_output_tail(sid, "Draft complete\nNext");
        assert_eq!(
            output_tail(sid),
            vec!["Draft complete".to_string(), "Next".to_string()],
            "early merge_output_tail followed by TextDelta must reconcile without duplicates"
        );

        forget(sid);
    }
}
