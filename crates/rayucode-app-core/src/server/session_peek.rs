//! Per-connection Live Peek service for the Project Activity Dashboard.
//!
//! Maintains at most ONE active peek task per client connection. Switching the
//! target via `Request::PeekSession` or disconnecting cancels the previous tap
//! cleanly. Session peeks coalesce updates at 80ms; background task peeks watch
//! output file growth every 500ms without loading full logs.

use super::attention_registry::{self, now_epoch_ms};
use super::await_members_state;
use super::background_tasks::compact_todo_items;
use super::project_activity::{self, ProjectActivityContext};
use super::swarm;
use crate::ambient::{AmbientManager, AmbientState, AmbientStatus};
use crate::bus::{BackgroundTaskStatus, Bus, BusEvent};
use crate::message::ContentBlock;
use crate::overnight::{self, OvernightRunStatus};
use crate::protocol::{PeekTarget, ServerEvent, SessionPeekPayload, SwarmLiveStatus, SwarmTodoItem};
use chrono::Utc;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc;

const SESSION_PEEK_COALESCE_MS: u64 = 80;
const BG_PEEK_POLL_MS: u64 = 500;
const OVERNIGHT_PEEK_POLL_MS: u64 = 1_000;
const AMBIENT_PEEK_POLL_MS: u64 = 2_000;
const PEEK_MAX_LINES: usize = 60;
const PEEK_MAX_BYTES: usize = 16_384;
const PEEK_FILES_CAP: usize = 12;

/// Owns at most one live peek watcher task for a single client connection.
#[derive(Default)]
pub(super) struct ClientPeekHandle {
    task: Option<tokio::task::JoinHandle<()>>,
    target: Option<PeekTarget>,
}

impl ClientPeekHandle {
    pub(super) fn stop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        self.target = None;
    }

    pub(super) fn set_target(
        &mut self,
        target: Option<PeekTarget>,
        ctx: ProjectActivityContext,
        client_event_tx: mpsc::UnboundedSender<ServerEvent>,
    ) {
        self.stop();
        let Some(target) = target else {
            return;
        };
        self.target = Some(target.clone());
        self.task = Some(tokio::spawn(async move {
            run_peek_loop(target, ctx, client_event_tx).await;
        }));
    }
}

impl Drop for ClientPeekHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn payloads_semantically_equal(a: &SessionPeekPayload, b: &SessionPeekPayload) -> bool {
    a.target == b.target
        && a.title == b.title
        && a.subtitle == b.subtitle
        && a.live_status == b.live_status
        && a.model == b.model
        && a.provider == b.provider
        && a.context_used == b.context_used
        && a.context_limit == b.context_limit
        && a.tokens_per_sec == b.tokens_per_sec
        && a.attention == b.attention
        && a.todos == b.todos
        && a.files_touched == b.files_touched
        && a.output_lines == b.output_lines
}

#[derive(Default)]
struct SessionPeekDiskCache {
    cached_todos: Option<Vec<SwarmTodoItem>>,
    cached_transcript: Option<Vec<String>>,
}

async fn run_peek_loop(
    target: PeekTarget,
    ctx: ProjectActivityContext,
    client_event_tx: mpsc::UnboundedSender<ServerEvent>,
) {
    match target {
        PeekTarget::Session { session_id } => {
            let mut disk_cache = SessionPeekDiskCache::default();
            let initial = build_session_peek_with_cache(&session_id, &ctx, &mut disk_cache).await;
            if client_event_tx
                .send(ServerEvent::SessionPeek {
                    payload: initial.clone(),
                })
                .is_err()
            {
                return;
            }
            stream_session_peek(session_id, initial, disk_cache, ctx, client_event_tx).await;
        }
        other => {
            let initial = build_peek_payload(&other, &ctx).await;
            if client_event_tx
                .send(ServerEvent::SessionPeek {
                    payload: initial.clone(),
                })
                .is_err()
            {
                return;
            }
            match other {
                PeekTarget::Session { .. } => unreachable!(),
                PeekTarget::BackgroundTask { task_id } => {
                    stream_bg_task_peek(task_id, initial, ctx, client_event_tx).await;
                }
                PeekTarget::Overnight { run_id } => {
                    stream_overnight_peek(run_id, initial, ctx, client_event_tx).await;
                }
                PeekTarget::Ambient => {
                    stream_ambient_peek(initial, ctx, client_event_tx).await;
                }
            }
        }
    }
}

async fn stream_session_peek(
    session_id: String,
    mut last_payload: SessionPeekPayload,
    mut disk_cache: SessionPeekDiskCache,
    ctx: ProjectActivityContext,
    client_event_tx: mpsc::UnboundedSender<ServerEvent>,
) {
    let mut live_rx = super::live_status::subscribe_changes();
    let mut output_rx = super::live_status::subscribe_output_changes();
    let mut attention_rx = attention_registry::subscribe_changes();
    let mut bus_rx = Bus::global().subscribe();
    let mut fallback_tick = tokio::time::interval(Duration::from_secs(2));
    fallback_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    fallback_tick.tick().await;

    let mut dirty = false;
    let coalesce = tokio::time::sleep(Duration::from_millis(SESSION_PEEK_COALESCE_MS));
    tokio::pin!(coalesce);

    loop {
        if client_event_tx.is_closed() {
            return;
        }
        tokio::select! {
            res = live_rx.changed() => {
                if res.is_err() { return; }
                if !dirty {
                    dirty = true;
                    coalesce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(SESSION_PEEK_COALESCE_MS));
                }
            }
            res = output_rx.changed() => {
                if res.is_err() { return; }
                if !dirty {
                    dirty = true;
                    coalesce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(SESSION_PEEK_COALESCE_MS));
                }
            }
            res = attention_rx.changed() => {
                if res.is_err() { return; }
                if !dirty {
                    dirty = true;
                    coalesce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(SESSION_PEEK_COALESCE_MS));
                }
            }
            bus_event = bus_rx.recv() => {
                let relevant = match bus_event {
                    Ok(BusEvent::SwarmOutputTail(ev)) => ev.session_id == session_id,
                    Ok(BusEvent::ToolUpdated(ev)) => ev.session_id == session_id,
                    Ok(BusEvent::TodoUpdated(ev)) => {
                        if ev.session_id == session_id {
                            disk_cache.cached_todos = None;
                            true
                        } else {
                            false
                        }
                    }
                    Ok(BusEvent::BatchProgress(ev)) => ev.session_id == session_id,
                    Ok(BusEvent::SubagentStatus(ev)) => ev.session_id == session_id,
                    Ok(BusEvent::FileTouch(ev)) => ev.session_id == session_id,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        disk_cache.cached_todos = None;
                        true
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                    _ => false,
                };
                if relevant && !dirty {
                    dirty = true;
                    coalesce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(SESSION_PEEK_COALESCE_MS));
                }
            }
            _ = fallback_tick.tick() => {
                if !dirty {
                    dirty = true;
                    coalesce.as_mut().reset(tokio::time::Instant::now());
                }
            }
            _ = &mut coalesce, if dirty => {
                dirty = false;
                let payload = build_session_peek_with_cache(&session_id, &ctx, &mut disk_cache).await;
                if !payloads_semantically_equal(&last_payload, &payload) {
                    if client_event_tx.send(ServerEvent::SessionPeek { payload: payload.clone() }).is_err() {
                        return;
                    }
                    last_payload = payload;
                }
            }
        }
    }
}

async fn stream_bg_task_peek(
    task_id: String,
    mut last_payload: SessionPeekPayload,
    ctx: ProjectActivityContext,
    client_event_tx: mpsc::UnboundedSender<ServerEvent>,
) {
    let target = PeekTarget::BackgroundTask {
        task_id: task_id.clone(),
    };
    let output_path = (!task_id.starts_with("await:"))
        .then(|| crate::background::global().output_path_for(&task_id));
    let mut last_size = match output_path.as_deref() {
        Some(path) => tokio::fs::metadata(path)
            .await
            .map(|m| m.len())
            .unwrap_or(0),
        None => 0,
    };

    let mut interval = tokio::time::interval(Duration::from_millis(BG_PEEK_POLL_MS));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await;

    loop {
        interval.tick().await;
        if client_event_tx.is_closed() {
            return;
        }
        let current_size = match output_path.as_deref() {
            Some(path) => tokio::fs::metadata(path)
                .await
                .map(|m| m.len())
                .unwrap_or(0),
            None => 0,
        };
        let is_terminal = if task_id.starts_with("await:") {
            let key = task_id.trim_start_matches("await:").to_string();
            super::run_blocking_io(move || {
                await_members_state::load_state(&key).is_none_or(|s| !s.is_pending())
            })
        } else {
            crate::background::global()
                .status(&task_id)
                .await
                .is_none_or(|s| s.status != BackgroundTaskStatus::Running)
        };

        if current_size != last_size || is_terminal {
            last_size = current_size;
            let payload = build_peek_payload(&target, &ctx).await;
            if !payloads_semantically_equal(&last_payload, &payload) {
                if client_event_tx
                    .send(ServerEvent::SessionPeek {
                        payload: payload.clone(),
                    })
                    .is_err()
                {
                    return;
                }
                last_payload = payload;
            }
        }
        if is_terminal {
            return;
        }
    }
}

async fn stream_overnight_peek(
    run_id: String,
    mut last_payload: SessionPeekPayload,
    ctx: ProjectActivityContext,
    client_event_tx: mpsc::UnboundedSender<ServerEvent>,
) {
    let target = PeekTarget::Overnight {
        run_id: run_id.clone(),
    };
    let mut interval = tokio::time::interval(Duration::from_millis(OVERNIGHT_PEEK_POLL_MS));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await;

    loop {
        interval.tick().await;
        if client_event_tx.is_closed() {
            return;
        }
        let payload = build_peek_payload(&target, &ctx).await;
        if !payloads_semantically_equal(&last_payload, &payload) {
            if client_event_tx
                .send(ServerEvent::SessionPeek {
                    payload: payload.clone(),
                })
                .is_err()
            {
                return;
            }
            last_payload = payload;
        }
        let active = super::run_blocking_io({
            let run_id = run_id.clone();
            move || {
                overnight::load_manifest(&run_id).is_ok_and(|m| {
                    matches!(
                        m.status,
                        OvernightRunStatus::Running | OvernightRunStatus::CancelRequested
                    )
                })
            }
        });
        if !active {
            return;
        }
    }
}

async fn stream_ambient_peek(
    mut last_payload: SessionPeekPayload,
    ctx: ProjectActivityContext,
    client_event_tx: mpsc::UnboundedSender<ServerEvent>,
) {
    let target = PeekTarget::Ambient;
    let mut interval = tokio::time::interval(Duration::from_millis(AMBIENT_PEEK_POLL_MS));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await;

    loop {
        interval.tick().await;
        if client_event_tx.is_closed() {
            return;
        }
        let payload = build_peek_payload(&target, &ctx).await;
        if !payloads_semantically_equal(&last_payload, &payload) {
            if client_event_tx
                .send(ServerEvent::SessionPeek {
                    payload: payload.clone(),
                })
                .is_err()
            {
                return;
            }
            last_payload = payload;
        }
    }
}

/// Build an immediate [`SessionPeekPayload`] for any [`PeekTarget`] without
/// blocking on any `Agent` mutex.
pub(super) async fn build_peek_payload(
    target: &PeekTarget,
    ctx: &ProjectActivityContext,
) -> SessionPeekPayload {
    match target {
        PeekTarget::Session { session_id } => build_session_peek(session_id, ctx).await,
        PeekTarget::BackgroundTask { task_id } => build_bg_task_peek(task_id).await,
        PeekTarget::Overnight { run_id } => build_overnight_peek(run_id).await,
        PeekTarget::Ambient => build_ambient_peek(ctx).await,
    }
}

fn read_file_tail_lines(path: &Path, max_lines: usize, max_bytes: usize) -> Vec<String> {
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(meta) = file.metadata() else {
        return Vec::new();
    };
    let len = meta.len();
    if len == 0 || max_lines == 0 || max_bytes == 0 {
        return Vec::new();
    }
    let cap = max_bytes.min(i64::MAX as usize);
    let truncated = len > cap as u64;
    if truncated && file.seek(SeekFrom::End(-(cap as i64))).is_err() {
        return Vec::new();
    }
    let mut buf = Vec::with_capacity(len.min(cap as u64) as usize);
    if file.take(cap as u64).read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    let mut start = 0;
    if truncated {
        while start < buf.len() && (buf[start] & 0xC0) == 0x80 {
            start += 1;
        }
    }
    let text = String::from_utf8_lossy(&buf[start..]);
    let mut lines: Vec<String> = text.lines().map(ToString::to_string).collect();
    if lines.len() > max_lines {
        lines.drain(..lines.len() - max_lines);
    }
    lines
}

fn transcript_tail_from_messages(messages: &[crate::session::StoredMessage]) -> Vec<String> {
    let mut lines = Vec::new();
    for message in messages.iter().rev().take(8).rev() {
        for block in &message.content {
            match block {
                ContentBlock::Text { text, .. } => {
                    for line in text.lines().filter(|l| !l.trim().is_empty()) {
                        lines.push(line.to_string());
                    }
                }
                ContentBlock::ToolUse { name, input, .. } => {
                    let intent = input
                        .get("intent")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty());
                    match intent {
                        Some(intent) => lines.push(format!("⚙ {name} · {intent}")),
                        None => lines.push(format!("⚙ {name}")),
                    }
                }
                _ => {}
            }
        }
    }
    if lines.len() > 40 {
        lines.drain(..lines.len() - 40);
    }
    lines
}

async fn build_session_peek(
    session_id: &str,
    ctx: &ProjectActivityContext,
) -> SessionPeekPayload {
    let mut disk_cache = SessionPeekDiskCache::default();
    build_session_peek_with_cache(session_id, ctx, &mut disk_cache).await
}

async fn build_session_peek_with_cache(
    session_id: &str,
    ctx: &ProjectActivityContext,
    disk_cache: &mut SessionPeekDiskCache,
) -> SessionPeekPayload {
    let member = ctx.swarm_members.read().await.get(session_id).cloned();
    let mut files_touched = ctx
        .file_touch
        .sorted_file_strings_for_session(session_id)
        .await;
    files_touched.truncate(PEEK_FILES_CAP);

    let meta = swarm::try_session_meta(Some(&ctx.sessions), session_id);
    let live_status = super::live_status::snapshot(session_id);
    let stalled_secs = super::swarm_watchdog::stalled_for_secs(session_id);

    let status_str = member
        .as_ref()
        .map(|m| m.status.as_str())
        .unwrap_or(if crate::turn_cancel_registry::has_active_turn(session_id) {
            "running"
        } else {
            "ready"
        });
    let attention = attention_registry::effective_attention_for_member(
        session_id,
        status_str,
        member.as_ref().and_then(|m| m.detail.as_deref()),
        stalled_secs,
    );

    let model = member
        .as_ref()
        .and_then(|m| m.runtime.model.clone())
        .or_else(|| meta.model.clone());
    let provider = member
        .as_ref()
        .and_then(|m| m.runtime.provider.clone())
        .or_else(|| meta.provider.clone());
    let context_limit = meta
        .context_limit
        .or_else(|| member.as_ref().and_then(|m| m.runtime.context_limit))
        .or_else(|| {
            model
                .as_deref()
                .and_then(crate::provider::models::context_limit_for_model)
                .map(|l| l as u64)
        });
    let tokens = crate::session_metrics::token_totals(session_id);
    let context_used = tokens
        .map(|(context, _)| context)
        .filter(|t| *t > 0)
        .or_else(|| {
            live_status
                .as_ref()
                .and_then(|ls| ls.input_tokens)
                .filter(|t| *t > 0)
        });
    let tokens_per_sec = live_status.as_ref().and_then(SwarmLiveStatus::tokens_per_sec);

    let mut todos: Vec<SwarmTodoItem> = member
        .as_ref()
        .map(|m| m.todo_items.clone())
        .unwrap_or_default();
    if todos.is_empty() {
        if let Some(cached) = disk_cache.cached_todos.as_ref() {
            todos = cached.clone();
        } else {
            let sid = session_id.to_string();
            todos = super::run_blocking_io(move || {
                crate::todo::load_todos(&sid)
                    .map(|items| compact_todo_items(&items))
                    .unwrap_or_default()
            });
            disk_cache.cached_todos = Some(todos.clone());
        }
    }

    // Prefer live ring-buffer tail; fall back to cached member tail, non-blocking
    // in-memory transcript, or persisted session transcript on disk (loaded at
    // most once per peek loop to avoid 12.5 Hz full-transcript disk reads).
    let mut output_lines = super::live_status::output_tail(session_id);
    if output_lines.is_empty()
        && let Some(tail) = member
            .as_ref()
            .and_then(|m| m.output_tail.as_deref().or(m.latest_completion_report.as_deref()))
    {
        output_lines = tail
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(ToString::to_string)
            .collect();
    }
    if output_lines.is_empty()
        && let Ok(agents) = ctx.sessions.try_read()
        && let Some(agent) = agents.get(session_id)
        && let Ok(guard) = agent.try_lock()
    {
        output_lines = transcript_tail_from_messages(guard.messages());
    }
    if output_lines.is_empty() {
        if let Some(cached) = disk_cache.cached_transcript.as_ref() {
            output_lines = cached.clone();
        } else {
            let sid = session_id.to_string();
            output_lines = super::run_blocking_io(move || {
                crate::session::Session::load(&sid)
                    .map(|session| transcript_tail_from_messages(&session.messages))
                    .unwrap_or_default()
            });
            disk_cache.cached_transcript = Some(output_lines.clone());
        }
    }
    if output_lines.len() > PEEK_MAX_LINES {
        output_lines.drain(..output_lines.len() - PEEK_MAX_LINES);
    }

    let title = member
        .as_ref()
        .and_then(|m| m.friendly_name.clone())
        .unwrap_or_else(|| session_id[..8.min(session_id.len())].to_string());
    let subtitle = member.as_ref().map(|m| {
        let swarm_part = m
            .swarm_id
            .as_deref()
            .map(|id| super::swarm_labels::swarm_label(id).unwrap_or_else(|| id.to_string()));
        match swarm_part {
            Some(swarm_name) => format!("{} · {}", m.role, swarm_name),
            None => m.role.clone(),
        }
    });

    SessionPeekPayload {
        target: PeekTarget::Session {
            session_id: session_id.to_string(),
        },
        title,
        subtitle,
        live_status,
        model,
        provider,
        context_used,
        context_limit,
        tokens_per_sec,
        attention,
        todos,
        files_touched,
        output_lines,
        updated_at_ms: now_epoch_ms(),
    }
}

async fn build_bg_task_peek(task_id: &str) -> SessionPeekPayload {
    if let Some(key) = task_id.strip_prefix("await:") {
        let key_owned = key.to_string();
        let state = super::run_blocking_io(move || await_members_state::load_state(&key_owned));
        let (subtitle, output_lines) = match state {
            Some(state) => {
                let mut lines = vec![
                    format!("Swarm: {}", state.swarm_id),
                    format!("Owner session: {}", state.session_id),
                    format!("Target statuses: {}", state.target_status.join(", ")),
                    format!("Mode: {}", state.mode.as_deref().unwrap_or("all")),
                    format!("Remaining timeout: {}s", state.remaining_timeout().as_secs()),
                ];
                if !state.requested_ids.is_empty() {
                    lines.push(format!("Awaited members: {}", state.requested_ids.join(", ")));
                }
                if let Some(final_res) = &state.final_response {
                    lines.push(format!("Resolved: {}", final_res.summary));
                }
                let sub = if state.is_pending() {
                    "running · swarm await watcher"
                } else {
                    "completed · swarm await watcher"
                };
                (Some(sub.to_string()), lines)
            }
            None => (
                Some("swarm await watcher not found".to_string()),
                vec!["No active watcher found for this key.".to_string()],
            ),
        };
        return SessionPeekPayload {
            target: PeekTarget::BackgroundTask {
                task_id: task_id.to_string(),
            },
            title: "swarm_await".to_string(),
            subtitle,
            live_status: None,
            model: None,
            provider: None,
            context_used: None,
            context_limit: None,
            tokens_per_sec: None,
            attention: None,
            todos: Vec::new(),
            files_touched: Vec::new(),
            output_lines,
            updated_at_ms: now_epoch_ms(),
        };
    }

    let mgr = crate::background::global();
    let status = mgr.status(task_id).await;
    let output_lines = mgr
        .output_tail(task_id, PEEK_MAX_LINES, PEEK_MAX_BYTES)
        .await
        .unwrap_or_default();

    let (title, subtitle) = match status {
        Some(ref task) => {
            let title = task
                .display_name
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("{} ({})", task.tool_name, task.task_id));
            let mut parts = vec![format!("{:?}", task.status).to_ascii_lowercase()];
            if let Some(code) = task.exit_code {
                parts.push(format!("exit {code}"));
            }
            if let Some(ref prog) = task.progress {
                let summary = crate::background::format_progress_summary(prog);
                if !summary.trim().is_empty() {
                    parts.push(summary);
                }
            }
            if let Some(ref err) = task.error {
                parts.push(err.clone());
            }
            (title, Some(parts.join(" · ")))
        }
        None => (
            task_id.to_string(),
            Some("background task not found".to_string()),
        ),
    };

    SessionPeekPayload {
        target: PeekTarget::BackgroundTask {
            task_id: task_id.to_string(),
        },
        title,
        subtitle,
        live_status: None,
        model: None,
        provider: None,
        context_used: None,
        context_limit: None,
        tokens_per_sec: None,
        attention: None,
        todos: Vec::new(),
        files_touched: Vec::new(),
        output_lines,
        updated_at_ms: now_epoch_ms(),
    }
}

async fn build_overnight_peek(run_id: &str) -> SessionPeekPayload {
    let run_id_owned = run_id.to_string();
    let (title, subtitle, model, provider, output_lines) = super::run_blocking_io(move || {
        match overnight::load_manifest(&run_id_owned) {
            Ok(manifest) => {
                let card = overnight::build_progress_card(&manifest);
                let title = manifest
                    .mission
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| manifest.run_id.clone());
                let subtitle = Some(format!(
                    "{} · {} · {} ({:.0}%)",
                    card.status, card.phase, card.elapsed_label, card.progress_percent
                ));
                let mut lines = vec![
                    format!(
                        "Tasks: {}/{} done · {} active · {} blocked · {} failed",
                        card.task_summary.counts.completed,
                        card.task_summary.total,
                        card.task_summary.counts.active,
                        card.task_summary.counts.blocked,
                        card.task_summary.counts.failed,
                    ),
                    format!(
                        "Wake: {} ({}) · Last activity: {}",
                        card.target_wake_at, card.time_relation, card.last_activity_label
                    ),
                    format!("Resources: {}", card.resources_summary),
                ];
                if let Some(active) = card.active_task_title {
                    lines.push(format!("Active task: {active}"));
                }
                let log_tail = read_file_tail_lines(
                    &manifest.human_log_path,
                    PEEK_MAX_LINES.saturating_sub(lines.len()),
                    PEEK_MAX_BYTES,
                );
                if !log_tail.is_empty() {
                    lines.push("─── Recent log ───".to_string());
                    lines.extend(log_tail);
                } else if let Ok(events) = overnight::read_events(&manifest) {
                    let start = events.len().saturating_sub(20);
                    for ev in &events[start..] {
                        lines.push(format!(
                            "[{}] {}: {}",
                            ev.timestamp.format("%H:%M:%S"),
                            ev.kind,
                            ev.summary
                        ));
                    }
                }
                (
                    title,
                    subtitle,
                    Some(manifest.model),
                    Some(manifest.provider_name),
                    lines,
                )
            }
            Err(_) => (
                run_id_owned,
                Some("overnight run not found".to_string()),
                None,
                None,
                vec!["Could not load overnight manifest.".to_string()],
            ),
        }
    });

    SessionPeekPayload {
        target: PeekTarget::Overnight {
            run_id: run_id.to_string(),
        },
        title,
        subtitle,
        live_status: None,
        model,
        provider,
        context_used: None,
        context_limit: None,
        tokens_per_sec: None,
        attention: None,
        todos: Vec::new(),
        files_touched: Vec::new(),
        output_lines,
        updated_at_ms: now_epoch_ms(),
    }
}

async fn build_ambient_peek(ctx: &ProjectActivityContext) -> SessionPeekPayload {
    let runner = ctx
        .ambient_runner
        .clone()
        .or_else(project_activity::current_ambient_runner);
    let state = match runner.as_ref() {
        Some(runner) => runner.state().await,
        None => super::run_blocking_io(|| AmbientState::load().unwrap_or_default()),
    };
    let loop_running = match runner.as_ref() {
        Some(runner) => runner.is_running().await,
        None => false,
    };

    let status_text = match &state.status {
        AmbientStatus::Idle => "idle".to_string(),
        AmbientStatus::Running { detail } => format!("running: {detail}"),
        AmbientStatus::Scheduled { next_wake } => {
            let secs = (*next_wake - Utc::now()).num_seconds().max(0);
            format!("scheduled (in {}m)", secs / 60)
        }
        AmbientStatus::Paused { reason } => format!("paused: {reason}"),
        AmbientStatus::Disabled => "disabled".to_string(),
    };

    let mut lines = vec![
        format!(
            "Status: {status_text} · loop={} · total cycles={}",
            if loop_running { "active" } else { "stopped" },
            state.total_cycles
        ),
    ];
    if let Some(last_run) = state.last_run {
        lines.push(format!("Last run: {}", last_run.to_rfc3339()));
    }
    if let Some(summary) = state.last_summary {
        lines.push(format!("Last summary: {summary}"));
    }

    let queue_lines = super::run_blocking_io(|| {
        let mut out = Vec::new();
        if let Ok(mgr) = AmbientManager::new() {
            let items = mgr.queue().items();
            if !items.is_empty() {
                out.push(format!("─── Scheduled reminders ({}) ───", items.len()));
                let now = Utc::now();
                for item in items.iter().take(12) {
                    let secs = (item.scheduled_for - now).num_seconds();
                    let due = if secs <= 0 {
                        "overdue".to_string()
                    } else if secs < 60 {
                        format!("in {secs}s")
                    } else {
                        format!("in {}m", secs / 60)
                    };
                    let desc = item
                        .task_description
                        .as_deref()
                        .unwrap_or(&item.context)
                        .trim();
                    out.push(format!("• [{due}] {desc}"));
                }
            }
        }
        if let Ok(rayu_dir) = crate::storage::rayu_dir() {
            let dir = rayu_dir.join("ambient").join("transcripts");
            if let Ok(entries) = std::fs::read_dir(&dir) {
                let mut files: Vec<_> = entries.flatten().collect();
                files.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
                files.truncate(8);
                if !files.is_empty() {
                    out.push("─── Recent cycles ───".to_string());
                    for entry in files {
                        if let Ok(raw) = std::fs::read_to_string(entry.path())
                            && let Ok(t) =
                                serde_json::from_str::<crate::safety::AmbientTranscript>(&raw)
                        {
                            out.push(format!(
                                "[{}] {:?}: {}",
                                t.started_at.format("%m-%d %H:%M"),
                                t.status,
                                t.summary.as_deref().unwrap_or("")
                            ));
                        }
                    }
                }
            }
        }
        out
    });
    lines.extend(queue_lines);

    SessionPeekPayload {
        target: PeekTarget::Ambient,
        title: "Ambient runner".to_string(),
        subtitle: Some(status_text),
        live_status: None,
        model: None,
        provider: None,
        context_used: None,
        context_limit: None,
        tokens_per_sec: None,
        attention: None,
        todos: Vec::new(),
        files_touched: Vec::new(),
        output_lines: lines,
        updated_at_ms: now_epoch_ms(),
    }
}
