use super::client_actions::{
    AgentTaskContext, NotifySessionContext, handle_agent_task, handle_compact, handle_input_shell,
    handle_notify_session, handle_rename_session, handle_run_subagent, handle_set_feature,
    handle_set_session_saved, handle_set_subagent_model,
    handle_split_with_boundary, handle_stdin_response,
    handle_transfer, handle_trigger_memory_extraction,
};
use super::client_comm::{
    handle_comm_channel_members, handle_comm_list, handle_comm_list_channels, handle_comm_message,
    handle_comm_read, handle_comm_share, handle_comm_subscribe_channel,
    handle_comm_unsubscribe_channel,
};
use super::client_comm_swarms::{handle_comm_list_swarms, handle_comm_set_swarm_label};
use super::client_disconnect_cleanup::{
    cleanup_client_connection, detach_client_attachment, detached_session_retire_grace,
    retire_unclaimed_detached_session,
};
use super::client_lifecycle_logging::{
    ServerRequestLifecycleFields, interrupt_request_log_fields, request_payload_summary,
    request_type_from_line, request_type_is_read_only, server_request_lifecycle_fields,
};
use super::client_lightweight_control::{
    LightweightControlContext, handle_cancel_background_task, handle_lightweight_control_request,
    parse_swarm_spawn_mode,
};
use super::client_session::{
    handle_clear_session, handle_reload, handle_resume_session,
    handle_resume_session_with_switch_hook, handle_subscribe,
};
use super::client_state::{
    handle_get_compacted_history, handle_get_history, handle_get_model_catalog, handle_get_state,
};
use super::client_writer::write_direct_event;
use super::comm_await::{CommAwaitMembersContext, handle_comm_await_members};
use super::comm_control::{
    handle_client_debug_command, handle_client_debug_response, handle_comm_assign_next,
    handle_comm_assign_role, handle_comm_assign_task, handle_comm_task_control,
};
use super::comm_plan::{
    handle_comm_approve_plan, handle_comm_propose_plan, handle_comm_reject_plan,
};
use super::comm_session::{handle_comm_spawn, handle_comm_stop};
use super::comm_sync::{
    CommResyncPlanContext, handle_comm_plan_status, handle_comm_read_context,
    handle_comm_resync_plan, handle_comm_status, handle_comm_summary,
};
use super::provider_control::{
    handle_cycle_model, handle_invalidate_anthropic_usage, handle_invalidate_openai_usage,
    handle_notify_auth_changed, handle_refresh_models, handle_set_compaction_mode,
    handle_set_context_cap, handle_set_model, handle_set_premium_mode, handle_set_reasoning_effort,
    handle_set_route, handle_set_service_tier, handle_set_transport,
    handle_switch_anthropic_account, handle_switch_openai_account,
    try_available_models_catalog_offloaded,
};
use super::{
    AwaitMembersRuntime, ClientConnectionInfo, ClientDebugState, FileTouchService,
    SessionControlHandle, SessionInterruptQueues, SharedContext, SwarmEvent, SwarmMember,
    SwarmMutationRuntime, VersionedPlan, format_structured_completion_report,
    register_session_interrupt_queue, send_swarm_plan_to_session, truncate_detail,
    update_member_status, update_member_status_with_report, update_member_status_with_report_tldr,
};
use crate::agent::Agent;
use crate::bus::{Bus, BusEvent};
use crate::id;
use crate::protocol::{Request, ServerEvent, decode_request, encode_event};
use crate::provider::Provider;
use crate::tool::Registry;
use crate::transport::Stream;
use anyhow::Result;
use futures::FutureExt;
use rayucode_agent_runtime::{InterruptSignal, SoftInterruptSource, StreamError};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, RwLock, broadcast, mpsc};

use super::SessionAgents;
type ChannelSubscriptions = Arc<RwLock<HashMap<String, HashMap<String, HashSet<String>>>>>;
const RELOAD_STARTING_GUARD_MAX_AGE: Duration = Duration::from_secs(30);
const REQUEST_HANDLER_STALL_THRESHOLDS_MS: [u64; 3] = [2_000, 10_000, 60_000];

#[path = "client_subscribe_context.rs"]
mod subscribe_context;
use subscribe_context::*;

fn event_for_transport(
    mut event: ServerEvent,
    supports_turn_identity: bool,
    supports_bash_progress: bool,
) -> Option<ServerEvent> {
    let mut payload = &event;
    while let ServerEvent::TurnEvent { event, .. } = payload {
        payload = event;
    }
    if matches!(payload, ServerEvent::BashProgress { .. }) && !supports_bash_progress {
        return None;
    }
    // The bus remains the compatibility path for clients without turn identity.
    if matches!(payload, ServerEvent::BatchProgress { .. })
        && matches!(event, ServerEvent::TurnEvent { .. }) != supports_turn_identity
    {
        return None;
    }
    if supports_turn_identity {
        return Some(event);
    }
    loop {
        event = match event {
            ServerEvent::TurnEvent { event, .. } => *event,
            ServerEvent::TurnStarted { .. } | ServerEvent::TurnState { .. } => return None,
            event => return Some(event),
        };
    }
}

struct ProcessingMessage {
    id: u64,
    content: String,
    images: Vec<(String, String)>,
    system_reminder: Option<String>,
    active_skill: Option<String>,
    /// Retry on the next pool account after a usage limit (API clients).
    server_failover: bool,
    question_client: Option<Arc<crate::tool::ask_user_question::QuestionConnection>>,
    permission_client: Option<Arc<crate::tool::permission_gate::PermissionConnection>>,
}

// A client request ID is not a turn identity: clients can reuse it after cancel.
type ProcessingCompletion = (
    u64,
    Result<()>,
    Option<String>,
    tokio::task::Id,
    Option<crate::agent::TurnPublicationPin>,
);

struct ProcessingState<'a> {
    client_is_processing: &'a mut bool,
    message_id: &'a mut Option<u64>,
    session_id: &'a mut Option<String>,
    task: &'a mut Option<tokio::task::JoinHandle<()>>,
}

struct SwarmStatusRefs<'a> {
    members: &'a Arc<RwLock<HashMap<String, SwarmMember>>>,
    swarms_by_id: &'a Arc<RwLock<HashMap<String, HashSet<String>>>>,
    event_history: &'a Arc<RwLock<std::collections::VecDeque<SwarmEvent>>>,
    event_counter: &'a Arc<std::sync::atomic::AtomicU64>,
    event_tx: &'a broadcast::Sender<SwarmEvent>,
}

#[path = "request_watchdog.rs"]
mod request_watchdog;
use request_watchdog::{
    RequestHandlerWatchdog, RequestHandlerWatchdogContext, log_request_lifecycle_handled,
    reject_if_agent_busy_for_request, send_agent_busy_error, should_start_idle_soft_interrupt,
};
fn server_reload_starting() -> bool {
    matches!(
        crate::server::recent_reload_state(RELOAD_STARTING_GUARD_MAX_AGE),
        Some(state) if state.phase == crate::server::ReloadPhase::Starting
    )
}

fn compaction_server_event(event: crate::compaction::CompactionEvent) -> ServerEvent {
    ServerEvent::Compaction {
        trigger: event.trigger,
        pre_tokens: event.pre_tokens,
        post_tokens: event.post_tokens,
        tokens_saved: event.tokens_saved,
        duration_ms: event.duration_ms,
        messages_dropped: event.messages_dropped,
        messages_compacted: event.messages_compacted,
        summary_chars: event.summary_chars,
        active_messages: event.active_messages,
    }
}

async fn poll_agent_compaction_completion(
    agent: std::sync::Weak<Mutex<Agent>>,
) -> Option<ServerEvent> {
    let agent = agent.upgrade()?;
    let mut agent_guard = agent.lock().await;
    agent_guard
        .poll_compaction_completion_event()
        .map(compaction_server_event)
}

const ACTIVITY_DEBOUNCE_MS: u64 = 500;
const ACTIVITY_FALLBACK_TICK_SECS: u64 = 2;

fn summary_has_noteworthy_activity(summary: &crate::protocol::ProjectActivitySummary) -> bool {
    summary.active_agents > 0
        || summary.total_agents > 1
        || summary.running_bg_tasks > 0
        || summary.active_watchers > 0
        || summary.active_runners > 0
        || summary.attention_count > 0
        || summary.active_runtime_note.is_some()
}

fn snapshots_semantically_equal(
    a: &crate::protocol::ProjectActivitySnapshot,
    b: &crate::protocol::ProjectActivitySnapshot,
) -> bool {
    a.project_root == b.project_root
        && a.branch == b.branch
        && a.summary == b.summary
        && a.my_swarm_members == b.my_swarm_members
        && a.subagents == b.subagents
        && a.peer_sessions == b.peer_sessions
        && a.swarm_plans == b.swarm_plans
        && a.background_tasks == b.background_tasks
        && a.runners == b.runners
}

#[expect(
    clippy::too_many_arguments,
    reason = "connection activity publisher observes live registries and client subscription state"
)]
async fn run_connection_activity_publisher(
    ctx: super::project_activity::ProjectActivityContext,
    client_event_tx: mpsc::UnboundedSender<ServerEvent>,
    connection_ready: Arc<AtomicBool>,
    subscribed: Arc<AtomicBool>,
    session_id_slot: Arc<std::sync::RwLock<String>>,
    fallback_wdir_slot: Arc<std::sync::RwLock<Option<std::path::PathBuf>>>,
    mut trigger_rx: mpsc::UnboundedReceiver<bool>,
) {
    let mut live_rx = super::live_status::subscribe_changes();
    let mut attention_rx = super::attention_registry::subscribe_changes();
    let mut subagent_rx = super::subagent_registry::subscribe_changes();
    let mut bus_rx = Bus::global().subscribe();
    let mut fallback_tick = tokio::time::interval(Duration::from_secs(ACTIVITY_FALLBACK_TICK_SECS));
    fallback_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    fallback_tick.tick().await;

    let mut last_summary: Option<crate::protocol::ProjectActivitySummary> = None;
    let mut last_snapshot: Option<crate::protocol::ProjectActivitySnapshot> = None;
    let mut dirty = false;
    let mut force_snapshot = false;
    let debounce = tokio::time::sleep(Duration::from_millis(ACTIVITY_DEBOUNCE_MS));
    tokio::pin!(debounce);

    loop {
        if client_event_tx.is_closed() {
            return;
        }
        tokio::select! {
            trigger = trigger_rx.recv() => {
                let Some(want_snapshot) = trigger else {
                    return;
                };
                dirty = true;
                force_snapshot |= want_snapshot;
                debounce.as_mut().reset(tokio::time::Instant::now());
            }
            res = live_rx.changed() => {
                if res.is_err() { return; }
                if connection_ready.load(Ordering::Relaxed) && !dirty {
                    dirty = true;
                    debounce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(ACTIVITY_DEBOUNCE_MS));
                }
            }
            res = attention_rx.changed() => {
                if res.is_err() { return; }
                if connection_ready.load(Ordering::Relaxed) && !dirty {
                    dirty = true;
                    debounce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(ACTIVITY_DEBOUNCE_MS));
                }
            }
            res = subagent_rx.changed() => {
                if res.is_err() { return; }
                if connection_ready.load(Ordering::Relaxed) && !dirty {
                    dirty = true;
                    debounce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(ACTIVITY_DEBOUNCE_MS));
                }
            }
            bus_ev = bus_rx.recv() => {
                let relevant = matches!(
                    bus_ev,
                    Ok(BusEvent::BackgroundTaskCompleted(_)
                        | BusEvent::BackgroundTaskProgress(_)
                        | BusEvent::BackgroundTaskStalled(_)
                        | BusEvent::SwarmAwaitCompleted(_)
                        | BusEvent::TodoUpdated(_)
                        | BusEvent::ToolUpdated(_)
                        | BusEvent::FileTouch(_)
                        | BusEvent::CompactionFinished)
                        | Err(tokio::sync::broadcast::error::RecvError::Lagged(_))
                );
                if matches!(bus_ev, Err(tokio::sync::broadcast::error::RecvError::Closed)) {
                    return;
                }
                if relevant && connection_ready.load(Ordering::Relaxed) && !dirty {
                    dirty = true;
                    debounce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(ACTIVITY_DEBOUNCE_MS));
                }
            }
            _ = fallback_tick.tick() => {
                if connection_ready.load(Ordering::Relaxed) && !dirty {
                    dirty = true;
                    debounce.as_mut().reset(tokio::time::Instant::now());
                }
            }
            _ = &mut debounce, if dirty => {
                dirty = false;
                let send_forced_snapshot = std::mem::take(&mut force_snapshot);
                if !connection_ready.load(Ordering::Relaxed) {
                    continue;
                }
                let sid = session_id_slot
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let fallback_dir = fallback_wdir_slot
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let snapshot = super::project_activity::build_snapshot(
                    &ctx,
                    (!sid.is_empty()).then_some(sid.as_str()),
                    fallback_dir.as_deref(),
                )
                .await;

                let is_subscribed = subscribed.load(Ordering::Relaxed);
                let summary_changed = last_summary.as_ref() != Some(&snapshot.summary);
                if summary_changed
                    && (last_summary.is_some()
                        || is_subscribed
                        || send_forced_snapshot
                        || summary_has_noteworthy_activity(&snapshot.summary))
                {
                    if client_event_tx
                        .send(ServerEvent::ProjectActivitySummary(snapshot.summary.clone()))
                        .is_err()
                    {
                        return;
                    }
                    last_summary = Some(snapshot.summary.clone());
                }

                if is_subscribed {
                    let snapshot_changed = send_forced_snapshot
                        || last_snapshot
                            .as_ref()
                            .is_none_or(|prev| !snapshots_semantically_equal(prev, &snapshot));
                    if snapshot_changed {
                        if client_event_tx
                            .send(ServerEvent::ProjectActivitySnapshot {
                                id: None,
                                snapshot: snapshot.clone(),
                            })
                            .is_err()
                        {
                            return;
                        }
                        last_snapshot = Some(snapshot);
                    }
                } else {
                    last_snapshot = None;
                }
            }
        }
    }
}

/// Format an attention summary for a tool stdin input prompt.
fn format_stdin_attention_summary(is_password: bool, prompt: &str) -> String {
    if is_password {
        "Waiting for password input".to_string()
    } else {
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            "Waiting for stdin input".to_string()
        } else if trimmed.chars().count() > 120 {
            let mut s: String = trimmed.chars().take(119).collect();
            s.push('…');
            s
        } else {
            trimmed.to_string()
        }
    }
}

/// Spawn a session-bound stdin request forwarder.
///
/// Binding the forwarder to `owning_session_id` (and gating it with an
/// `AtomicBool` deactivated synchronously on session switch or disconnect)
/// guarantees a detached session can never emit `StdinRequest` onto another
/// session's socket or register stdin attention under another session ID.
/// Watching `tool_response_tx.closed()` guarantees the `AttentionGuard` is
/// released immediately if the waiting tool times out or is cancelled.
fn spawn_stdin_forwarder(
    owning_session_id: String,
    client_event_tx: mpsc::UnboundedSender<ServerEvent>,
    stdin_responses: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>>,
    stdin_attention_guards: Arc<Mutex<HashMap<String, super::attention_registry::AttentionGuard>>>,
) -> (
    mpsc::UnboundedSender<crate::tool::StdinInputRequest>,
    Arc<AtomicBool>,
    tokio::task::JoinHandle<()>,
) {
    let (stdin_req_tx, mut stdin_req_rx) =
        mpsc::unbounded_channel::<crate::tool::StdinInputRequest>();
    let active = Arc::new(AtomicBool::new(true));
    let active_for_task = Arc::clone(&active);
    let handle = tokio::spawn(async move {
        let tool_call_id = String::new();
        while let Some(req) = stdin_req_rx.recv().await {
            if !active_for_task.load(Ordering::Acquire) {
                break;
            }
            let request_id = req.request_id.clone();
            let summary = format_stdin_attention_summary(req.is_password, &req.prompt);
            let guard = super::attention_registry::register_attention(
                owning_session_id.clone(),
                crate::protocol::AgentAttention {
                    kind: crate::protocol::AgentAttentionKind::Stdin,
                    summary,
                    request_id: Some(request_id.clone()),
                    since_epoch_ms: None,
                },
            );
            stdin_attention_guards
                .lock()
                .await
                .insert(request_id.clone(), guard);
            let (bridge_tx, mut bridge_rx) = tokio::sync::oneshot::channel::<String>();
            stdin_responses
                .lock()
                .await
                .insert(request_id.clone(), bridge_tx);
            let responses_for_watch = Arc::clone(&stdin_responses);
            let guards_for_watch = Arc::clone(&stdin_attention_guards);
            let req_id_for_watch = request_id.clone();
            let mut tool_response_tx = req.response_tx;
            tokio::spawn(async move {
                tokio::select! {
                    biased;
                    _ = tool_response_tx.closed() => {
                        responses_for_watch.lock().await.remove(&req_id_for_watch);
                        guards_for_watch.lock().await.remove(&req_id_for_watch);
                    }
                    answer = &mut bridge_rx => {
                        guards_for_watch.lock().await.remove(&req_id_for_watch);
                        if let Ok(input) = answer {
                            let _ = tool_response_tx.send(input);
                        }
                    }
                }
            });
            if !active_for_task.load(Ordering::Acquire) {
                stdin_responses.lock().await.remove(&request_id);
                stdin_attention_guards.lock().await.remove(&request_id);
                break;
            }
            let _ = client_event_tx.send(ServerEvent::StdinRequest {
                request_id,
                prompt: req.prompt,
                is_password: req.is_password,
                tool_call_id: tool_call_id.clone(),
            });
        }
        stdin_attention_guards.lock().await.clear();
    });
    (stdin_req_tx, active, handle)
}

/// Temporarily silence a running session's event delivery onto `client_event_tx`
/// while `handle_resume_session` validates and switches to a target session.
/// Reversible via [`rollback_session_switch_silence`] if the switch fails or is
/// rejected.
async fn silence_session_for_switch(
    old_session_id: &str,
    client_connection_id: &str,
    client_event_tx: &mpsc::UnboundedSender<ServerEvent>,
    processing_fallback: Option<&super::state::TurnFallbackHandle>,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) {
    if let Some(fallback) = processing_fallback {
        fallback.set_paused(true);
    }
    let mut members = swarm_members.write().await;
    if let Some(member) = members.get_mut(old_session_id) {
        member.event_txs.remove(client_connection_id);
        if let Some((_, tx)) = member.event_txs.iter().next() {
            member.event_tx = tx.clone();
        } else if member.event_tx.same_channel(client_event_tx) {
            let (drain_tx, mut drain_rx) = mpsc::unbounded_channel::<ServerEvent>();
            tokio::spawn(async move {
                while drain_rx.recv().await.is_some() {}
            });
            member.event_tx = drain_tx;
        }
    }
}

/// Restore event delivery onto `client_event_tx` when a cross-session
/// `ResumeSession` attempt failed or was rejected so the client stays attached
/// to its still-running session.
async fn rollback_session_switch_silence(
    session_id: &str,
    client_connection_id: &str,
    client_event_tx: &mpsc::UnboundedSender<ServerEvent>,
    processing_fallback: Option<&super::state::TurnFallbackHandle>,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) {
    super::state::register_session_event_sender(
        swarm_members,
        session_id,
        client_connection_id,
        client_event_tx.clone(),
    )
    .await;
    if let Some(fallback) = processing_fallback {
        fallback.set_paused(false);
    }
}

/// Finalize detaching a connection's in-flight turn after a cross-session
/// `ResumeSession` has committed so the original turn continues running
/// headless on the server, finishes status bookkeeping cleanly, and retires if
/// non-headless and unclaimed after the reconnect grace window.
#[expect(
    clippy::too_many_arguments,
    reason = "detaching a live turn migrates swarm event channels, completion bookkeeping, and retirement state"
)]
async fn detach_live_turn_for_session_switch(
    old_session_id: &str,
    client_connection_id: &str,
    continue_on_disconnect: bool,
    client_is_processing: &mut bool,
    processing_done_tx: &mut mpsc::UnboundedSender<ProcessingCompletion>,
    processing_done_rx: &mut mpsc::UnboundedReceiver<ProcessingCompletion>,
    processing_task: &mut Option<tokio::task::JoinHandle<()>>,
    processing_message_id: &mut Option<u64>,
    processing_session_id: &mut Option<String>,
    processing_fallback: &mut Option<super::state::TurnFallbackHandle>,
    sessions: &SessionAgents,
    client_connections: &Arc<RwLock<HashMap<String, ClientConnectionInfo>>>,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
    swarms_by_id: &Arc<RwLock<HashMap<String, HashSet<String>>>>,
    swarm_coordinators: &Arc<RwLock<HashMap<String, String>>>,
    swarm_plans: &Arc<RwLock<HashMap<String, VersionedPlan>>>,
    file_touch: &FileTouchService,
    channel_subscriptions: &ChannelSubscriptions,
    channel_subscriptions_by_session: &ChannelSubscriptions,
    shutdown_signals: &Arc<RwLock<HashMap<String, InterruptSignal>>>,
    soft_interrupt_queues: &SessionInterruptQueues,
    event_history: &Arc<RwLock<std::collections::VecDeque<SwarmEvent>>>,
    event_counter: &Arc<std::sync::atomic::AtomicU64>,
    swarm_event_tx: &broadcast::Sender<SwarmEvent>,
) {
    if let Some(fallback) = processing_fallback.take() {
        fallback.detach();
    }

    if !*client_is_processing && processing_task.is_none() {
        return;
    }

    let (next_done_tx, next_done_rx) = mpsc::unbounded_channel::<ProcessingCompletion>();
    let _old_done_tx = std::mem::replace(processing_done_tx, next_done_tx);
    let mut old_done_rx = std::mem::replace(processing_done_rx, next_done_rx);
    let old_task = processing_task.take();
    let old_message_id = processing_message_id.take();
    let old_session = processing_session_id
        .take()
        .unwrap_or_else(|| old_session_id.to_string());
    *client_is_processing = false;

    {
        let mut connections = client_connections.write().await;
        if let Some(info) = connections.get_mut(client_connection_id) {
            info.is_processing = false;
            info.current_tool_name = None;
        }
    }

    let sessions = Arc::clone(sessions);
    let client_connections = Arc::clone(client_connections);
    let members = Arc::clone(swarm_members);
    let swarms_by_id = Arc::clone(swarms_by_id);
    let swarm_coordinators = Arc::clone(swarm_coordinators);
    let swarm_plans = Arc::clone(swarm_plans);
    let file_touch = file_touch.clone();
    let channel_subscriptions = Arc::clone(channel_subscriptions);
    let channel_subscriptions_by_session = Arc::clone(channel_subscriptions_by_session);
    let shutdown_signals = Arc::clone(shutdown_signals);
    let soft_interrupt_queues = Arc::clone(soft_interrupt_queues);
    let event_history = Arc::clone(event_history);
    let event_counter = Arc::clone(event_counter);
    let swarm_event_tx = swarm_event_tx.clone();
    tokio::spawn(async move {
        let owner_id = old_task.as_ref().map(|handle| handle.id());
        if let Some(handle) = old_task
            && let Err(error) = handle.await
        {
            crate::logging::warn(&format!(
                "Detached turn task for session {old_session} failed: {error}"
            ));
        }
        while let Ok((done_id, result, report, owner, _finalization)) = old_done_rx.try_recv() {
            let matches_msg = old_message_id.is_none_or(|expected| expected == done_id);
            let matches_owner = owner_id.is_none_or(|expected| expected == owner);
            if matches_msg && matches_owner {
                record_processing_completion(
                    Some(&old_session),
                    result,
                    report,
                    &SwarmStatusRefs {
                        members: &members,
                        swarms_by_id: &swarms_by_id,
                        event_history: &event_history,
                        event_counter: &event_counter,
                        event_tx: &swarm_event_tx,
                    },
                )
                .await;
                break;
            }
        }
        if !continue_on_disconnect {
            retire_unclaimed_detached_session(
                &old_session,
                &sessions,
                &members,
                &swarms_by_id,
                &swarm_coordinators,
                &swarm_plans,
                &file_touch,
                &channel_subscriptions,
                &channel_subscriptions_by_session,
                &client_connections,
                &shutdown_signals,
                &soft_interrupt_queues,
                &event_history,
                &event_counter,
                &swarm_event_tx,
                detached_session_retire_grace(),
            )
            .await;
        }
    });
}

async fn refresh_session_control_handle(
    session_id: &str,
    agent: &Arc<Mutex<Agent>>,
    shutdown_signals: &Arc<RwLock<HashMap<String, InterruptSignal>>>,
    soft_interrupt_queues: &SessionInterruptQueues,
) -> SessionControlHandle {
    let started = Instant::now();
    let agent_guard = match agent.try_lock() {
        Ok(agent_guard) => agent_guard,
        Err(_) => {
            crate::logging::warn(&format!(
                "refresh_session_control_handle: waiting for busy agent lock for session {}; cancel/control requests on this connection may be delayed",
                session_id
            ));
            let fallback_stop_signal = shutdown_signals.read().await.get(session_id).cloned();
            let fallback_soft_interrupt_queue =
                soft_interrupt_queues.read().await.get(session_id).cloned();
            if let Some(soft_interrupt_queue) = fallback_soft_interrupt_queue {
                // A missing shutdown-signal registration (e.g. a session created
                // through the headless spawn path) must not force this connection
                // to block on the busy agent mutex: cancels fired through the
                // handle fan out to the running turn's own signal via the
                // turn-cancel registry (issue #428), so a detached signal is a
                // safe stand-in.
                let stop_signal = fallback_stop_signal.unwrap_or_else(|| {
                    crate::logging::warn(&format!(
                        "refresh_session_control_handle: no registered shutdown signal for busy session {}; using detached signal (cancels reach the running turn via the turn cancel registry)",
                        session_id
                    ));
                    InterruptSignal::new()
                });
                crate::logging::warn(&format!(
                    "refresh_session_control_handle: using lock-free cancel-only control handle for busy session {} after {}ms",
                    session_id,
                    started.elapsed().as_millis()
                ));
                return SessionControlHandle::cancel_only(
                    session_id,
                    soft_interrupt_queue,
                    stop_signal,
                );
            }
            let agent_guard = agent.lock().await;
            crate::logging::warn(&format!(
                "refresh_session_control_handle: acquired agent lock for session {} after {}ms",
                session_id,
                started.elapsed().as_millis()
            ));
            agent_guard
        }
    };
    SessionControlHandle::new(
        session_id,
        agent_guard.soft_interrupt_queue(),
        agent_guard.background_tool_signal(),
        agent_guard.graceful_shutdown_signal(),
    )
    .with_provider(agent_guard.provider_handle())
}

#[expect(
    clippy::too_many_arguments,
    reason = "client lifecycle wiring spans sessions, swarm state, file state, channels, debug, and runtime coordination"
)]
pub(super) async fn handle_client(
    stream: Stream,
    sessions: SessionAgents,
    _global_event_tx: broadcast::Sender<ServerEvent>,
    provider_template: Arc<dyn Provider>,
    _global_is_processing: Arc<RwLock<bool>>,
    global_session_id: Arc<RwLock<String>>,
    client_count: Arc<RwLock<usize>>,
    client_connections: Arc<RwLock<HashMap<String, ClientConnectionInfo>>>,
    swarm_members: Arc<RwLock<HashMap<String, SwarmMember>>>,
    swarms_by_id: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    shared_context: Arc<RwLock<HashMap<String, HashMap<String, SharedContext>>>>,
    swarm_plans: Arc<RwLock<HashMap<String, VersionedPlan>>>,
    swarm_coordinators: Arc<RwLock<HashMap<String, String>>>,
    file_touch: FileTouchService,
    channel_subscriptions: ChannelSubscriptions,
    channel_subscriptions_by_session: ChannelSubscriptions,
    client_debug_state: Arc<RwLock<ClientDebugState>>,
    client_debug_response_tx: broadcast::Sender<(u64, String)>,
    event_history: Arc<RwLock<std::collections::VecDeque<SwarmEvent>>>,
    event_counter: Arc<std::sync::atomic::AtomicU64>,
    swarm_event_tx: broadcast::Sender<SwarmEvent>,
    server_name: String,
    server_icon: String,
    mcp_pool: Arc<crate::mcp::SharedMcpPool>,
    shutdown_signals: Arc<RwLock<HashMap<String, InterruptSignal>>>,
    soft_interrupt_queues: SessionInterruptQueues,
    await_members_runtime: AwaitMembersRuntime,
    swarm_mutation_runtime: SwarmMutationRuntime,
) -> Result<()> {
    let handler_start = Instant::now();
    let (reader, writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let writer = Arc::new(Mutex::new(writer));
    let mut line = String::new();

    let mut initial_request = loop {
        line.clear();
        let n = match reader.read_line(&mut line).await {
            Ok(n) => n,
            Err(error) => {
                crate::logging::error(&format!(
                    "Client read error before initialization: {}",
                    error
                ));
                return Ok(());
            }
        };
        if n == 0 {
            return Ok(());
        }
        if line.trim().is_empty() {
            continue;
        }

        match decode_request(&line) {
            Ok(request) => {
                if !request.is_lightweight_control_request() {
                    crate::logging::info(&format!(
                        "[TIMING] handle_client initial request read: bytes={}, handler_to_read={}ms",
                        line.len(),
                        handler_start.elapsed().as_millis()
                    ));
                }
                if request.is_lightweight_control_request() {
                    let keep_connection_open = matches!(request, Request::Ping { .. });
                    handle_lightweight_control_request(
                        request,
                        Arc::clone(&writer),
                        LightweightControlContext {
                            sessions: &sessions,
                            global_session_id: &global_session_id,
                            provider_template: &provider_template,
                            swarm_members: &swarm_members,
                            swarms_by_id: &swarms_by_id,
                            shared_context: &shared_context,
                            swarm_plans: &swarm_plans,
                            swarm_coordinators: &swarm_coordinators,
                            file_touch: &file_touch,
                            channel_subscriptions: &channel_subscriptions,
                            channel_subscriptions_by_session: &channel_subscriptions_by_session,
                            client_connections: &client_connections,
                            event_history: &event_history,
                            event_counter: &event_counter,
                            swarm_event_tx: &swarm_event_tx,
                            mcp_pool: &mcp_pool,
                            soft_interrupt_queues: &soft_interrupt_queues,
                            await_members_runtime: &await_members_runtime,
                            swarm_mutation_runtime: &swarm_mutation_runtime,
                        },
                    )
                    .await?;
                    // Native SSH probes daemon capability before sending its
                    // Subscribe on this same stream. Ping must not consume the
                    // connection, unlike the other one-shot control requests.
                    if keep_connection_open {
                        continue;
                    }
                    return Ok(());
                }
                break request;
            }
            Err(error) => {
                write_direct_event(
                    &writer,
                    &ServerEvent::Error {
                        id: 0,
                        message: format!("Invalid request: {}", error),
                        retry_after_secs: None,
                    },
                )
                .await?;
            }
        }
    };

    let supports_bash_progress = matches!(
        &initial_request,
        Request::Subscribe {
            supports_bash_progress: true,
            ..
        }
    );
    let supports_turn_identity = matches!(
        &initial_request,
        Request::Subscribe {
            supports_turn_identity: true,
            ..
        }
    );
    let mut initialization_activity = Some(crate::runtime_activity::global().try_enter()?);
    let initial_working_dir =
        match resolve_target_subscribe_working_dir(&mut initial_request, &sessions, &swarm_members)
            .await
            .and_then(|()| initial_subscribe_working_dir(&initial_request))
        {
            Ok(working_dir) => working_dir,
            Err(message) => {
                write_direct_event(
                    &writer,
                    &ServerEvent::Error {
                        id: initial_request.id(),
                        message,
                        retry_after_secs: None,
                    },
                )
                .await?;
                return Ok(());
            }
        };
    let mut active_terminal_env = initial_subscribe_terminal_env(&initial_request);

    // Per-client state
    let mut client_is_processing = false;
    let (mut processing_done_tx, mut processing_done_rx) =
        mpsc::unbounded_channel::<ProcessingCompletion>();
    let mut processing_task: Option<tokio::task::JoinHandle<()>> = None;
    let mut processing_message_id: Option<u64> = None;
    let mut processing_session_id: Option<String> = None;
    let mut processing_fallback: Option<super::state::TurnFallbackHandle> = None;
    let mut current_client_instance_id: Option<String> = None;
    let mut continue_on_disconnect = false;
    let mut model_usage_updates_enabled = false;
    let mut supports_pdf_panels = false;
    // Keep only the window preference, never a session-specific prefix fingerprint.
    let mut recent_history_messages = None;
    let mut supports_user_response = false;
    let mut supports_user_questions = false;
    let mut supports_permissions = false;
    let mut supports_server_failover = false;
    // Client selfdev status is determined by Subscribe request, not server's env
    let mut client_selfdev = false;

    let client_start = std::time::Instant::now();

    // A target-aware Subscribe for an existing session restores that
    // session's own model onto this placeholder. Choosing a fresh pool route
    // for it is wasted work, and in a reload storm the forks serialize on that
    // choice (seconds when an account's quota state changes mid-storm).
    let resumes_persisted_session = match &initial_request {
        Request::Subscribe {
            target_session_id: Some(target),
            ..
        } => crate::session::session_exists(target),
        _ => false,
    };
    let provider = if resumes_persisted_session {
        provider_template.fork()
    } else {
        provider_template.fork_for_new_session()
    };
    let provider_fork_ms = client_start.elapsed().as_millis();
    let t0 = std::time::Instant::now();
    let registry = Registry::new(provider.clone()).await;
    let registry_ms = t0.elapsed().as_millis();

    let mut swarm_enabled = crate::config::config().features.swarm;
    let mut last_available_models_snapshot: Option<Arc<str>> = None;

    // Create a new session for this client
    let t0 = std::time::Instant::now();
    let mut new_agent =
        crate::hooks::with_client_terminal_env(active_terminal_env.clone(), async {
            super::run_blocking_io(|| {
                Agent::new_provisional_with_initial_working_dir(
                    Arc::clone(&provider),
                    registry.clone(),
                    Some(&initial_working_dir),
                )
            })
        })
        .await;
    let agent_new_ms = t0.elapsed().as_millis();

    new_agent.set_memory_enabled(crate::config::config().features.memory);
    let prewarm_start = std::time::Instant::now();
    // A target-aware Subscribe replaces this placeholder with the restored
    // session right away, so warming its provider is wasted work on the
    // resume critical path (p50 ~200ms per reconnect in a reload storm).
    let resuming_existing_session = matches!(
        &initial_request,
        Request::Subscribe {
            target_session_id: Some(_),
            ..
        }
    );
    if !resuming_existing_session {
        new_agent.prewarm_provider_idle().await;
    }
    let prewarm_ms = prewarm_start.elapsed().as_millis();

    crate::logging::info(&format!(
        "[TIMING] handle_client setup: provider_fork={provider_fork_ms}ms, registry={registry_ms}ms, agent_new={agent_new_ms}ms, prewarm={prewarm_ms}ms, total={}ms",
        client_start.elapsed().as_millis()
    ));
    let mut client_session_id = new_agent.session_id().to_string();
    let friendly_name = new_agent.session_short_name().map(|s| s.to_string());
    let client_connection_id = id::new_id("conn");
    let connected_at = Instant::now();
    let (disconnect_tx, mut disconnect_rx) = mpsc::unbounded_channel::<()>();

    {
        let mut connections = client_connections.write().await;
        connections.insert(
            client_connection_id.clone(),
            ClientConnectionInfo {
                client_id: client_connection_id.clone(),
                session_id: client_session_id.clone(),
                client_instance_id: None,
                debug_client_id: None,
                connected_at,
                last_seen: connected_at,
                is_processing: false,
                current_tool_name: None,
                terminal_env: active_terminal_env.clone(),
                disconnect_tx: disconnect_tx.clone(),
            },
        );
    }

    {
        let mut current = global_session_id.write().await;
        if current.is_empty() || *current != client_session_id {
            *current = client_session_id.clone();
        }
    }

    // Get lock-free control-plane handles BEFORE wrapping in Mutex.
    // This allows cancel/soft-interrupt/background-tool requests while the agent is processing.
    let mut session_control = SessionControlHandle::new(
        client_session_id.clone(),
        new_agent.soft_interrupt_queue(),
        new_agent.background_tool_signal(),
        new_agent.graceful_shutdown_signal(),
    )
    .with_provider(new_agent.provider_handle());

    // Register the shutdown signal in the server-level map so
    // graceful_shutdown_sessions can signal it without locking the agent mutex
    {
        let mut signals = shutdown_signals.write().await;
        signals.insert(
            client_session_id.clone(),
            session_control.stop_current_turn_signal(),
        );
    }
    register_session_interrupt_queue(
        &soft_interrupt_queues,
        &client_session_id,
        new_agent.soft_interrupt_queue(),
    )
    .await;

    let mut agent = Arc::new(Mutex::new(new_agent));
    sessions
        .register_new(client_session_id.clone(), Arc::clone(&agent))
        .await?;
    crate::runtime_memory_log::emit_event(
        crate::runtime_memory_log::RuntimeMemoryLogEvent::new(
            "session_created",
            "new_live_session_attached",
        )
        .with_session_id(client_session_id.clone())
        .force_attribution(),
    );

    // Per-client event channel (not shared with other clients)
    let _sdk_connection_guard = crate::tool::sdk::ConnectionGuard(client_connection_id.clone());
    let (client_event_tx, mut client_event_rx) =
        tokio::sync::mpsc::unbounded_channel::<ServerEvent>();

    // Spawn event forwarder for this client only
    let writer_clone = Arc::clone(&writer);
    let client_connection_id_for_events = client_connection_id.clone();
    let client_connections_for_events = Arc::clone(&client_connections);
    let event_handle = tokio::spawn(async move {
        while let Some(event) = client_event_rx.recv().await {
            {
                let mut connections = client_connections_for_events.write().await;
                if let Some(info) = connections.get_mut(&client_connection_id_for_events) {
                    let observed = match &event {
                        ServerEvent::TurnEvent { event, .. } => event.as_ref(),
                        event => event,
                    };
                    match observed {
                        ServerEvent::TurnStarted { .. } => {
                            info.is_processing = true;
                            info.current_tool_name = None;
                        }
                        ServerEvent::ToolStart { name, .. } => {
                            info.is_processing = true;
                            info.current_tool_name = Some(name.clone());
                        }
                        ServerEvent::ToolDone { .. } => {
                            info.current_tool_name = None;
                        }
                        ServerEvent::Done { .. }
                        | ServerEvent::Error { .. }
                        | ServerEvent::Interrupted => {
                            info.is_processing = false;
                            info.current_tool_name = None;
                        }
                        _ => {}
                    }
                }
            }
            let Some(event) =
                event_for_transport(event, supports_turn_identity, supports_bash_progress)
            else {
                continue;
            };
            let json = encode_event(&event);
            let mut w = writer_clone.lock().await;
            if let Err(error) = w.write_all(json.as_bytes()).await {
                // A broken pipe here is routine (client reload/disconnect mid
                // broadcast), so keep the line short: a full Debug dump of e.g.
                // a SwarmStatus event prints every member and floods the log.
                let event_desc = crate::logging::truncate_for_log(&format!("{:?}", event), 200);
                crate::logging::warn(&format!(
                    "event_forwarder write failed for connection {} while sending {}: {}",
                    client_connection_id_for_events, event_desc, error
                ));
                break;
            }
        }
    });

    // Note: Don't send initial SessionId here - it's sent by the Subscribe handler
    // Sending it via the channel causes race conditions where it can arrive after
    // other events (like History) that are written directly to the socket.

    // Set up client debug command channel
    // This client becomes the "active" debug client that receives client: commands
    let (debug_cmd_tx, mut debug_cmd_rx) = mpsc::unbounded_channel::<(u64, String)>();
    let client_debug_id = id::new_id("client");
    {
        let mut debug_state = client_debug_state.write().await;
        debug_state.register(client_debug_id.clone(), debug_cmd_tx);
    }
    {
        let mut connections = client_connections.write().await;
        if let Some(info) = connections.get_mut(&client_connection_id) {
            info.debug_client_id = Some(client_debug_id.clone());
        }
    }

    let mut question_client = Arc::new(crate::tool::ask_user_question::QuestionConnection::new(client_event_tx.clone()));
    let mut permission_client = Arc::new(
        crate::tool::permission_gate::PermissionConnection::new_non_interactive(
            client_event_tx.clone(),
        ),
    );
    let stdin_responses: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let stdin_attention_guards: Arc<
        Mutex<HashMap<String, super::attention_registry::AttentionGuard>>,
    > = Arc::new(Mutex::new(HashMap::new()));
    let connection_session_id_slot = Arc::new(std::sync::RwLock::new(client_session_id.clone()));
    let activity_fallback_wdir_slot = Arc::new(std::sync::RwLock::new(Some(
        std::path::PathBuf::from(&initial_working_dir),
    )));
    let activity_connection_ready = Arc::new(AtomicBool::new(false));
    let activity_subscribed = Arc::new(AtomicBool::new(false));
    let (activity_trigger_tx, activity_trigger_rx) = mpsc::unbounded_channel::<bool>();
    let activity_ctx = super::project_activity::ProjectActivityContext {
        sessions: Arc::clone(&sessions),
        swarm_members: Arc::clone(&swarm_members),
        swarm_plans: Arc::clone(&swarm_plans),
        file_touch: file_touch.clone(),
        await_members_runtime: await_members_runtime.clone(),
        ambient_runner: super::project_activity::current_ambient_runner(),
    };
    let activity_publisher_handle = tokio::spawn(run_connection_activity_publisher(
        activity_ctx.clone(),
        client_event_tx.clone(),
        Arc::clone(&activity_connection_ready),
        Arc::clone(&activity_subscribed),
        Arc::clone(&connection_session_id_slot),
        Arc::clone(&activity_fallback_wdir_slot),
        activity_trigger_rx,
    ));
    let mut peek_handle = super::session_peek::ClientPeekHandle::default();

    // Subscribe to bus events so we can forward ModelsUpdated to this client
    // (e.g. when Copilot finishes async init after the initial History was sent)
    let mut bus_rx = Bus::global().subscribe();

    // Set up stdin request forwarding bound strictly to the owning session.
    let (mut stdin_req_tx, mut stdin_active, mut stdin_forwarder) = spawn_stdin_forwarder(
        client_session_id.clone(),
        client_event_tx.clone(),
        Arc::clone(&stdin_responses),
        Arc::clone(&stdin_attention_guards),
    );
    {
        let mut agent_guard = agent.lock().await;
        agent_guard.set_stdin_request_tx(stdin_req_tx.clone());
    }

    // Do not drain global bus traffic until the client has completed its first
    // subscribe. Under heavy swarm file-activity load, ignored bus frames can
    // otherwise monopolize the select loop before the initial subscribe/read.
    let mut client_subscribed = false;
    let mut provisional_session = true;
    let mut skip_idle_reconnect_grace = false;
    let mut pending_request = Some(initial_request);

    let connection_result: Result<()> = async {
    loop {
        let mut request = if let Some(request) = pending_request.take() {
            request
        } else {
            line.clear();
            tokio::select! {
            biased;
            // Prioritize direct client I/O so subscribe/ping/message requests do not get
            // starved behind noisy background bus traffic.
            n = reader.read_line(&mut line) => {
                let n = match n {
                    Ok(n) => n,
                    Err(e) => {
                        crate::logging::error(&format!("Client read error: {}", e));
                        break;
                    }
                };
                if n == 0 {
                    break; // Client disconnected
                }
                let mut connections = client_connections.write().await;
                if let Some(info) = connections.get_mut(&client_connection_id) {
                    info.last_seen = Instant::now();
                }
            }
            done = processing_done_rx.recv() => {
                if let Some(done) = done {
                    reconcile_processing_completions(
                        Some(done), &mut processing_done_rx,
                        &mut ProcessingState {
                            client_is_processing: &mut client_is_processing,
                            message_id: &mut processing_message_id,
                            session_id: &mut processing_session_id,
                            task: &mut processing_task,
                        },
                        &client_connection_id, &client_connections,
                        &SwarmStatusRefs {
                            members: &swarm_members,
                            swarms_by_id: &swarms_by_id,
                            event_history: &event_history,
                            event_counter: &event_counter,
                            event_tx: &swarm_event_tx,
                        },
                    ).await;
                } else {
                    break;
                }
                continue;
            }
            disconnect_signal = disconnect_rx.recv() => {
                if disconnect_signal.is_some() {
                    crate::logging::info(&format!(
                        "Client connection {} was superseded; disconnecting old owner of session {}",
                        client_connection_id, client_session_id
                    ));
                    break;
                }
                continue;
            }
            // Forward bus events to this client
            bus_event = bus_rx.recv(), if client_subscribed => {
                match bus_event {
                    Ok(BusEvent::ModelUsageUpdated(route)) => {
                        if model_usage_updates_enabled {
                            let _ = client_event_tx.send(ServerEvent::ModelUsageUpdated { route });
                        }
                    }
                    Ok(BusEvent::ModelsUpdated) => {
                        let Some(catalog) = try_available_models_catalog_offloaded(&agent).await else {
                            continue;
                        };
                        // Equivalent clients share the snapshot, normalized key,
                        // and size/downgrade decision. Pointer equality makes an
                        // unchanged shared catalog a constant-time fast path.
                        if last_available_models_snapshot.as_ref().is_some_and(|previous| {
                            Arc::ptr_eq(previous, &catalog.dedup_key)
                                || previous.as_ref() == catalog.dedup_key.as_ref()
                        }) {
                            continue;
                        }
                        if let Some(event) = catalog.live_event() {
                            let _ = client_event_tx.send(event.clone());
                        } else {
                            crate::logging::warn(&format!(
                                "Skipping oversized catalog for connection {} ({} bytes)",
                                client_connection_id, catalog.encoded_len
                            ));
                        }
                        last_available_models_snapshot = Some(Arc::clone(&catalog.dedup_key));
                    }
                    Ok(BusEvent::BatchProgress(progress)) => {
                        if progress.session_id == client_session_id {
                            let _ = client_event_tx.send(ServerEvent::BatchProgress { progress });
                        }
                    }
                    Ok(BusEvent::SidePanelUpdated(update)) => {
                        if update.session_id == client_session_id {
                            let _ = client_event_tx.send(ServerEvent::SidePanelState {
                                snapshot: super::client_writer::side_panel_for_client(
                                    update.snapshot, supports_pdf_panels,
                                ),
                            });
                        }
                    }
                    Ok(BusEvent::AppletsUpdated(update)) => {
                        if update.session_id == client_session_id {
                            let _ = client_event_tx.send(ServerEvent::AppletState {
                                session_id: update.session_id,
                                snapshot: update.snapshot,
                            });
                        }
                    }
                    Ok(BusEvent::CompactionFinished) => {
                        let agent = Arc::downgrade(&agent);
                        let tx = client_event_tx.clone();
                        tokio::spawn(async move {
                            if let Some(event) = poll_agent_compaction_completion(agent).await {
                                let _ = tx.send(event);
                            }
                        });
                    }
                    _ => {}
                }
                continue;
            }
            // Handle client debug commands from debug socket
            debug_cmd = debug_cmd_rx.recv() => {
                if let Some((request_id, command)) = debug_cmd
                    && client_event_tx
                        .send(ServerEvent::ClientDebugRequest {
                            id: request_id,
                            command,
                        })
                        .is_err()
                {
                    let _ = client_debug_response_tx.send((
                        request_id,
                        "No TUI client connected".to_string(),
                    ));
                }
                continue;
            }
            }

            match decode_request(&line) {
                Ok(r) => r,
                Err(e) => {
                    let event = ServerEvent::Error {
                        id: 0,
                        message: format!("Invalid request: {}", e),
                        retry_after_secs: None,
                    };
                    let json = encode_event(&event);
                    let mut w = writer.lock().await;
                    if w.write_all(json.as_bytes()).await.is_err() {
                        break;
                    }
                    continue;
                }
            }
        };
        let request_decoded_at = Instant::now();
        // Direct input wins the biased select above. A client may already have
        // observed Done/Error while this actor still holds the finished turn's
        // state. Completion is enqueued before the terminal event, so drain it
        // before any request (especially Message/SoftInterrupt) inspects that
        // state. Keep streaming terminal events on their ordered fanout channel.
        reconcile_processing_completions(
            None, &mut processing_done_rx,
            &mut ProcessingState {
                client_is_processing: &mut client_is_processing,
                message_id: &mut processing_message_id,
                session_id: &mut processing_session_id,
                task: &mut processing_task,
            },
            &client_connection_id, &client_connections,
            &SwarmStatusRefs {
                members: &swarm_members,
                swarms_by_id: &swarms_by_id,
                event_history: &event_history,
                event_counter: &event_counter,
                event_tx: &swarm_event_tx,
            },
        ).await;
        // Reserve before Ack or any session mutation, not just when the turn
        // eventually polls. Upgrade requests themselves must not reserve work.
        let _request_activity = if matches!(&request, Request::UpgradeRuntime { .. }) {
            None
        } else {
            // Requests that keep this connection's session identity are owned
            // by that session, so they never block transfers of unrelated
            // sessions. Identity-changing requests stay globally owned.
            let identity_change = !client_subscribed
                || matches!(
                    &request,
                    Request::Subscribe { .. }
                        | Request::ResumeSession { .. }
                        | Request::ResumeAllSessions { .. }
                        | Request::Clear { .. }
                );
            let gate = crate::runtime_activity::global();
            let activity = if identity_change || client_session_id.trim().is_empty() {
                gate.try_enter()
            } else {
                gate.try_enter_session(&client_session_id)
            };
            match activity {
                Ok(activity) => Some(activity),
                Err(error) => {
                    let _ = client_event_tx.send(ServerEvent::Error {
                        id: request.id(), message: error.to_string(), retry_after_secs: None,
                    });
                    continue;
                }
            }
        };
        // The first request now owns its admission reservation. Setup can stop
        // holding its own without leaving a registration-to-dispatch gap.
        drop(initialization_activity.take());
        let request_id = request.id();
        let request_kind = request_type_from_line(&line);
        let request_lifecycle_logged = !request_type_is_read_only(&request_kind);
        let request_lifecycle_start = Instant::now();
        let _request_watchdog = RequestHandlerWatchdog::spawn(RequestHandlerWatchdogContext {
            request_id,
            request_kind: request_kind.clone(),
            client_session_id: client_session_id.clone(),
            client_connection_id: client_connection_id.clone(),
            client_instance_id: current_client_instance_id.clone(),
            client_is_processing,
            message_id: processing_message_id,
            processing_session_id: processing_session_id.clone(),
            line_bytes: line.len(),
            lifecycle_logged: request_lifecycle_logged,
        });
        if request_lifecycle_logged {
            let mut fields = server_request_lifecycle_fields(ServerRequestLifecycleFields {
                phase: "received",
                request_id,
                request_kind: &request_kind,
                client_session_id: &client_session_id,
                client_connection_id: &client_connection_id,
                client_instance_id: current_client_instance_id.as_deref(),
                client_is_processing,
                message_id: processing_message_id,
                processing_session_id: processing_session_id.as_deref(),
                line_bytes: line.len(),
            });
            fields.extend(request_payload_summary(&request_kind, &line));
            crate::logging::event_info("SERVER_REQUEST_LIFECYCLE", fields);
        }
        if let Some(fields) = interrupt_request_log_fields(
            &request,
            &client_session_id,
            client_is_processing,
            processing_message_id,
            processing_task.is_some(),
            line.len(),
        ) {
            crate::logging::info(&format!("SERVER_INTERRUPT_REQUEST_DECODED {}", fields));
        }

        // A cancellation request must never be gated on writing an Ack to the client.
        // The normal Ack path takes the shared outbound writer before dispatching the
        // request. During heavy streaming, history replay, or client-side backpressure,
        // that writer can be busy long enough that an already-decoded cancel would sit
        // behind outbound bytes instead of signalling the agent's lock-free cancel
        // handle. Queue the Ack through the event channel and signal cancellation first.
        if let Request::Cancel { id } = request {
            let ack_queued = client_event_tx.send(ServerEvent::Ack { id }).is_ok();
            crate::logging::info(&format!(
                "SERVER_INTERRUPT_CANCEL_PRE_ACK_DISPATCH id={} session={} ack_queued={} decoded_to_dispatch_ms={}",
                id,
                client_session_id,
                ack_queued,
                request_decoded_at.elapsed().as_millis()
            ));
            let cancel_dispatch_start = Instant::now();
            cancel_processing_message(
                &mut ProcessingState {
                    client_is_processing: &mut client_is_processing,
                    message_id: &mut processing_message_id,
                    session_id: &mut processing_session_id,
                    task: &mut processing_task,
                },
                &session_control,
                &client_event_tx,
                &SwarmStatusRefs {
                    members: &swarm_members,
                    swarms_by_id: &swarms_by_id,
                    event_history: &event_history,
                    event_counter: &event_counter,
                    event_tx: &swarm_event_tx,
                },
                Some(id),
                Some(request_decoded_at),
                Some(&sessions),
            )
            .await;
            crate::logging::info(&format!(
                "SERVER_INTERRUPT_CANCEL_PRE_ACK_DONE id={} session={} dispatch_ms={} total_since_decode_ms={}",
                id,
                client_session_id,
                cancel_dispatch_start.elapsed().as_millis(),
                request_decoded_at.elapsed().as_millis()
            ));
            if !client_is_processing {
                let mut connections = client_connections.write().await;
                if let Some(info) = connections.get_mut(&client_connection_id) {
                    info.is_processing = false;
                    info.current_tool_name = None;
                }
            }
            if request_lifecycle_logged {
                log_request_lifecycle_handled(
                    ServerRequestLifecycleFields {
                        phase: "handled",
                        request_id,
                        request_kind: &request_kind,
                        client_session_id: &client_session_id,
                        client_connection_id: &client_connection_id,
                        client_instance_id: current_client_instance_id.as_deref(),
                        client_is_processing,
                        message_id: processing_message_id,
                        processing_session_id: processing_session_id.as_deref(),
                        line_bytes: line.len(),
                    },
                    request_lifecycle_start,
                    request_decoded_at,
                );
            }
            continue;
        }

        // SDK controls reply only after validation. Callback results must never
        // wait for the Agent mutex held by the turn awaiting that callback.
        if matches!(
            &request,
            Request::ConfigureTools { .. }
                | Request::ListTools { .. }
                | Request::ToolResult { .. }
                | Request::QuestionResponse { .. }
                | Request::PermissionResponse { .. }
                | Request::SetPermissionMode { .. }
        ) {
            let id = request.id();
            let response: anyhow::Result<ServerEvent> = match request {
                Request::QuestionResponse { session_id, request_id, response, .. } => {
                    if session_id != client_session_id {
                        Err(anyhow::anyhow!("Question belongs to another session"))
                    } else {
                        question_client.respond(&session_id, &request_id, response)
                            .map(|()| ServerEvent::Ack { id })
                    }
                }
                Request::PermissionResponse { session_id, request_id, decision, .. } => {
                    if session_id != client_session_id {
                        Err(anyhow::anyhow!("Permission request belongs to another session"))
                    } else {
                        permission_client
                            .respond(&session_id, &request_id, decision)
                            .map(|()| ServerEvent::Ack { id })
                    }
                }
                Request::SetPermissionMode { mode, .. } => {
                    permission_client.set_mode(mode);
                    if let Ok(mut locked) = agent.try_lock() {
                        locked.invalidate_sdk_tools();
                        permission_client.clear_tools_invalidated();
                    }
                    Ok(ServerEvent::Ack { id })
                }
                Request::ToolResult { call_id, output, error, .. } => {
                    crate::tool::sdk::complete(&client_connection_id, &client_session_id, &call_id, output, error)
                        .map(|()| ServerEvent::Ack { id })
                }
                Request::ConfigureTools { tools, .. } => {
                    if client_is_processing || crate::turn_cancel_registry::has_active_turn(&client_session_id) { Err(anyhow::anyhow!("Session is busy")) }
                    else if let Ok(mut locked) = agent.try_lock() {
                        let result = crate::tool::sdk::configure(locked.session_id(), &client_connection_id, tools, client_event_tx.clone());
                        if result.is_ok() {
                            locked.invalidate_sdk_tools();
                            // Queue the acknowledgment before releasing the session lock,
                            // so a second client cannot start a new-policy call first.
                            let _ = client_event_tx.send(ServerEvent::Ack { id });
                            continue;
                        }
                        result.map(|()| ServerEvent::Ack { id })
                    } else { Err(anyhow::anyhow!("Session is busy")) }
                }
                Request::ListTools { .. } => {
                    if let Ok(locked) = agent.try_lock() {
                        Ok(ServerEvent::Tools { id, tools: crate::tool::sdk::wire_definitions(
                            crate::tool::permission_gate::scope(
                                &client_session_id,
                                Some(permission_client.clone()),
                                crate::tool::ask_user_question::scope(
                                    &client_session_id,
                                    supports_user_questions.then(|| question_client.clone()),
                                    locked.tool_definitions_for_debug(),
                                ),
                            ).await
                        ) })
                    } else { Err(anyhow::anyhow!("Session is busy")) }
                }
                _ => unreachable!(),
            };
            let event = response.unwrap_or_else(|error| ServerEvent::Error { id, message: error.to_string(), retry_after_secs: None });
            if let Err(error) = client_event_tx.send(event) {
                crate::logging::debug(&format!("Client disconnected before event delivery: {error}"));
            }
            continue;
        }

        // Keep the owning connection attached on re-subscribe or same-session
        // resume while an interactive turn is running. Cross-session
        // ResumeSession is allowed and detaches the running turn headless.
        if client_is_processing
            && (supports_user_questions || supports_permissions)
            && match &request {
                Request::Subscribe { .. } => true,
                Request::ResumeSession { session_id, .. } => session_id == &client_session_id,
                _ => false,
            }
        {
            let _ = client_event_tx.send(ServerEvent::Error {
                id: request_id,
                message: "Session is busy. Retry after the current turn.".into(),
                retry_after_secs: None,
            });
            continue;
        }

        // Reject unauthenticated or unready interactive turns BEFORE sending Ack
        // so clients never observe a bogus MessageAccepted when no provider can
        // run the turn (D5).
        if let Request::Message { id, no_reply: false, .. } = &request {
            if server_reload_starting() {
                let _ = client_event_tx.send(ServerEvent::Reloading { new_socket: None });
                continue;
            }
            if crate::rayu::auth_gate_active() {
                let _ = client_event_tx.send(ServerEvent::Error {
                    id: *id,
                    message: crate::rayu::auth_gate_error_message().to_string(),
                    retry_after_secs: None,
                });
                continue;
            }
            let readiness_err = session_control
                .provider_handle()
                .and_then(|handle| handle.turn_readiness_error())
                .or_else(|| provider.turn_readiness_error());
            if let Some(message) = readiness_err {
                let _ = client_event_tx.send(ServerEvent::Error {
                    id: *id,
                    message,
                    retry_after_secs: None,
                });
                continue;
            }
        }

        // Send ack
        let ack = ServerEvent::Ack { id: request.id() };
        let json = encode_event(&ack);
        {
            let ack_start = Instant::now();
            let mut w = writer.lock().await;
            if w.write_all(json.as_bytes()).await.is_err() {
                if request_lifecycle_logged {
                    let mut fields =
                        server_request_lifecycle_fields(ServerRequestLifecycleFields {
                            phase: "ack_write_failed",
                            request_id,
                            request_kind: &request_kind,
                            client_session_id: &client_session_id,
                            client_connection_id: &client_connection_id,
                            client_instance_id: current_client_instance_id.as_deref(),
                            client_is_processing,
                            message_id: processing_message_id,
                            processing_session_id: processing_session_id.as_deref(),
                            line_bytes: line.len(),
                        });
                    fields.push((
                        "ack_write_ms".to_string(),
                        ack_start.elapsed().as_millis().to_string(),
                    ));
                    crate::logging::event_warn("SERVER_REQUEST_LIFECYCLE", fields);
                }
                break;
            }
            if request_lifecycle_logged {
                let mut fields = server_request_lifecycle_fields(ServerRequestLifecycleFields {
                    phase: "acked",
                    request_id,
                    request_kind: &request_kind,
                    client_session_id: &client_session_id,
                    client_connection_id: &client_connection_id,
                    client_instance_id: current_client_instance_id.as_deref(),
                    client_is_processing,
                    message_id: processing_message_id,
                    processing_session_id: processing_session_id.as_deref(),
                    line_bytes: line.len(),
                });
                fields.push((
                    "ack_write_ms".to_string(),
                    ack_start.elapsed().as_millis().to_string(),
                ));
                fields.push((
                    "since_decode_ms".to_string(),
                    request_decoded_at.elapsed().as_millis().to_string(),
                ));
                crate::logging::event_info("SERVER_REQUEST_LIFECYCLE", fields);
            }
        }

        // Legacy/direct clients can send a prompt without Subscribe. Their
        // first session action commits ownership, but inspection/attach does not.
        if provisional_session
            && matches!(
                &request,
                Request::Message { .. }
                    | Request::SoftInterrupt { .. }
                    | Request::RunSubagent { .. }
            )
        {
            agent.lock().await.activate_concurrency_tracking();
            provisional_session = false;
        }

        if let Err(message) = resolve_target_subscribe_working_dir(
            &mut request, &sessions, &swarm_members,
        ).await {
            let _ = client_event_tx.send(ServerEvent::Error {
                id: request.id(), message, retry_after_secs: None,
            });
            continue;
        }
        let sdk_session_before_request = client_session_id.clone();
        match request {
            Request::ConfigureTools { .. }
            | Request::ListTools { .. }
            | Request::ToolResult { .. }
            | Request::QuestionResponse { .. }
            | Request::PermissionResponse { .. }
            | Request::SetPermissionMode { .. } => unreachable!("SDK controls dispatched before acknowledgment"),
            Request::Message {
                id,
                content,
                images,
                system_reminder,
                active_skill,
                no_reply,
            } => {
                if no_reply {
                    append_context_message(
                        id,
                        &content,
                        images,
                        &client_session_id,
                        client_is_processing,
                        &agent,
                        &client_event_tx,
                    )
                    .await;
                    continue;
                }
                if !client_is_processing {
                    // A live resume cannot replace stdin routing while the old
                    // turn owns the agent. Restore it when this client starts a
                    // later turn, without reviving any disconnected prompt.
                    let terminal_input = if crate::telegram_remote::is_ticket(&system_reminder) {
                        tokio::time::timeout(Duration::from_millis(250), agent.lock()).await.ok()
                    } else {
                        agent.try_lock().ok()
                    };
                    if let Some(mut agent) = terminal_input {
                        agent.set_stdin_request_tx(stdin_req_tx.clone());
                    }
                    let mut connections = client_connections.write().await;
                    if let Some(info) = connections.get_mut(&client_connection_id) {
                        info.is_processing = true;
                        info.current_tool_name = None;
                    }
                }
                let peer_content = content.clone();
                if let Some(fallback) = start_processing_message(
                    ProcessingMessage {
                        id,
                        content,
                        images,
                        system_reminder,
                        active_skill,
                        server_failover: supports_server_failover,
                        question_client: supports_user_questions.then(|| question_client.clone()),
                        permission_client: Some(permission_client.clone()),
                    },
                    &client_session_id,
                    &mut ProcessingState {
                        client_is_processing: &mut client_is_processing,
                        message_id: &mut processing_message_id,
                        session_id: &mut processing_session_id,
                        task: &mut processing_task,
                    },
                    &agent,
                    &client_event_tx,
                    &processing_done_tx,
                    active_terminal_env.clone(),
                    &SwarmStatusRefs {
                        members: &swarm_members,
                        swarms_by_id: &swarms_by_id,
                        event_history: &event_history,
                        event_counter: &event_counter,
                        event_tx: &swarm_event_tx,
                    },
                )
                .await
                {
                    processing_fallback = Some(fallback);
                }
                // Other windows attached to this session only see the turn's
                // stream events, never the message that started it. Tell them
                // so the prompt (or auto-poke notice) shows up everywhere.
                if processing_message_id == Some(id) && !peer_content.trim().is_empty() {
                    super::state::fanout_peer_client_event(
                        &swarm_members,
                        &client_session_id,
                        &client_connection_id,
                        ServerEvent::PeerUserMessage {
                            content: peer_content,
                        },
                    )
                    .await;
                }
            }

            Request::Cancel { id } => {
                cancel_processing_message(
                    &mut ProcessingState {
                        client_is_processing: &mut client_is_processing,
                        message_id: &mut processing_message_id,
                        session_id: &mut processing_session_id,
                        task: &mut processing_task,
                    },
                    &session_control,
                    &client_event_tx,
                    &SwarmStatusRefs {
                        members: &swarm_members,
                        swarms_by_id: &swarms_by_id,
                        event_history: &event_history,
                        event_counter: &event_counter,
                        event_tx: &swarm_event_tx,
                    },
                    Some(id),
                    Some(request_decoded_at),
                    Some(&sessions),
                )
                .await;
                if !client_is_processing {
                    let mut connections = client_connections.write().await;
                    if let Some(info) = connections.get_mut(&client_connection_id) {
                        info.is_processing = false;
                        info.current_tool_name = None;
                    }
                }
            }

            Request::SoftInterrupt {
                id,
                content,
                images,
                urgent,
                client_id,
            } => {
                // A soft interrupt has somewhere to go only while a turn is
                // active. When the session is idle, queueing it would strand
                // the user's prompt until an unrelated future message starts
                // a turn. Claim the idle session and process it as the next
                // user message instead. The connection-map claim is atomic
                // with the cross-client busy check, so two attachments cannot
                // both decide that the same session is idle.
                let start_idle_turn = {
                    let mut connections = client_connections.write().await;
                    let active_turn_registered =
                        !crate::turn_cancel_registry::active_turn_signals(&client_session_id)
                            .is_empty();
                    let session_connection_busy = connections
                        .values()
                        .any(|info| info.session_id == client_session_id && info.is_processing);
                    let start = should_start_idle_soft_interrupt(
                        client_is_processing,
                        active_turn_registered,
                        session_connection_busy,
                    );
                    if start && let Some(info) = connections.get_mut(&client_connection_id) {
                        info.is_processing = true;
                    }
                    start
                };
                if start_idle_turn {
                    let accepted_content = content.clone();
                    if let Some(fallback) = start_processing_message(
                        ProcessingMessage {
                            id,
                            content,
                            images,
                            system_reminder: None,
                            active_skill: None,
                            server_failover: supports_server_failover,
                            question_client: supports_user_questions.then(|| question_client.clone()),
                            permission_client: Some(permission_client.clone()),
                        },
                        &client_session_id,
                        &mut ProcessingState {
                            client_is_processing: &mut client_is_processing,
                            message_id: &mut processing_message_id,
                            session_id: &mut processing_session_id,
                            task: &mut processing_task,
                        },
                        &agent,
                        &client_event_tx,
                        &processing_done_tx,
                        active_terminal_env.clone(),
                        &SwarmStatusRefs {
                            members: &swarm_members,
                            swarms_by_id: &swarms_by_id,
                            event_history: &event_history,
                            event_counter: &event_counter,
                            event_tx: &swarm_event_tx,
                        },
                    )
                    .await
                    {
                        processing_fallback = Some(fallback);
                    }
                    // Ack only confirms receipt, not injection. TUI callers
                    // have no SDK client_id, but still retain a queued preview
                    // until this pickup event. Publish only after acceptance:
                    // a rejected prompt must remain recoverable by its caller.
                    if processing_message_id == Some(id) {
                        let _ = client_event_tx.send(ServerEvent::SoftInterruptInjected {
                            content: accepted_content,
                            display_role: None,
                            point: "turn_start".to_string(),
                            tools_skipped: None,
                            client_ids: client_id.into_iter().collect(),
                        });
                    }
                    if !client_is_processing {
                        let mut connections = client_connections.write().await;
                        if let Some(info) = connections.get_mut(&client_connection_id) {
                            info.is_processing = false;
                        }
                    }
                } else {
                    queue_soft_interrupt(
                        id,
                        content,
                        images,
                        urgent,
                        client_id,
                        &session_control,
                        &client_event_tx,
                    );
                }
            }

            Request::CancelSoftInterrupts { id, client_ids } => match client_ids {
                Some(client_ids) => cancel_soft_interrupts_by_id(
                    id,
                    &client_session_id,
                    &client_ids,
                    &session_control,
                    &client_event_tx,
                ),
                None => {
                    clear_soft_interrupts(id, &client_session_id, &session_control, &client_event_tx)
                }
            },

            Request::BackgroundTool { id } => {
                move_tool_to_background(id, &session_control, &client_event_tx);
            }

            Request::Clear { id } => {
                if reject_if_agent_busy_for_request(
                    id,
                    "clear",
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &client_event_tx,
                ) {
                    continue;
                }
                agent = crate::hooks::with_client_terminal_env(
                    active_terminal_env.clone(),
                    handle_clear_session(
                        id,
                        client_selfdev,
                        &mut client_session_id,
                        &client_connection_id,
                        &agent,
                        &provider,
                        &registry,
                        &sessions,
                        &shutdown_signals,
                        &soft_interrupt_queues,
                        &client_connections,
                        &swarm_members,
                        &swarms_by_id,
                        &file_touch,
                        &channel_subscriptions,
                        &channel_subscriptions_by_session,
                        &swarm_plans,
                        &event_history,
                        &event_counter,
                        &swarm_event_tx,
                        &client_event_tx,
                    ),
                )
                .await;
                session_control = refresh_session_control_handle(
                    &client_session_id,
                    &agent,
                    &shutdown_signals,
                    &soft_interrupt_queues,
                )
                .await;
                *connection_session_id_slot
                    .write()
                    .unwrap_or_else(|e| e.into_inner()) = client_session_id.clone();
                stdin_active.store(false, Ordering::Release);
                stdin_forwarder.abort();
                stdin_responses.lock().await.clear();
                stdin_attention_guards.lock().await.clear();
                (stdin_req_tx, stdin_active, stdin_forwarder) = spawn_stdin_forwarder(
                    client_session_id.clone(),
                    client_event_tx.clone(),
                    Arc::clone(&stdin_responses),
                    Arc::clone(&stdin_attention_guards),
                );
                if let Ok(mut guard) = agent.try_lock() {
                    guard.set_stdin_request_tx(stdin_req_tx.clone());
                }
                provisional_session = true;
            }

            Request::Rewind { id, message_index } => {
                if client_is_processing {
                    let _ = client_event_tx.send(ServerEvent::Error {
                        id,
                        message: "Cannot rewind while a turn is processing.".to_string(),
                        retry_after_secs: None,
                    });
                    continue;
                }

                let rewind_result = {
                    let mut agent_guard = agent.lock().await;
                    agent_guard.rewind_to_message(message_index)
                };

                match rewind_result {
                    Ok(removed) => {
                        crate::logging::info(&format!(
                            "Rewound session {} to message {} (removed {})",
                            client_session_id, message_index, removed
                        ));
                        if handle_get_history(
                            id,
                            &client_session_id,
                            client_is_processing,
                            &agent,
                            &provider,
                            &sessions,
                            &client_connections,
                            &client_count,
                            &writer,
                            &server_name,
                            &server_icon,
                            None,
                            supports_pdf_panels,
                            supports_turn_identity,
                            None,
                    )
                        .await
                        .is_err()
                        {
                            break;
                        }
                        // The truncated History replaces the client transcript
                        // (dropping the inline plan graph); re-send the plan so
                        // the diagram comes back.
                        send_swarm_plan_to_session(
                            &client_session_id,
                            &swarm_members,
                            &swarm_plans,
                        )
                        .await;
                    }
                    Err(message) => {
                        let _ = client_event_tx.send(ServerEvent::Error {
                            id,
                            message,
                            retry_after_secs: None,
                        });
                    }
                }
            }

            Request::RewindUndo { id } => {
                if client_is_processing {
                    let _ = client_event_tx.send(ServerEvent::Error {
                        id,
                        message: "Cannot undo rewind while a turn is processing.".to_string(),
                        retry_after_secs: None,
                    });
                    continue;
                }

                let undo_result = {
                    let mut agent_guard = agent.lock().await;
                    agent_guard.undo_rewind()
                };

                match undo_result {
                    Ok(restored) => {
                        crate::logging::info(&format!(
                            "Undid rewind for session {} (restored {})",
                            client_session_id, restored
                        ));
                        if handle_get_history(
                            id,
                            &client_session_id,
                            client_is_processing,
                            &agent,
                            &provider,
                            &sessions,
                            &client_connections,
                            &client_count,
                            &writer,
                            &server_name,
                            &server_icon,
                            None,
                            supports_pdf_panels,
                            supports_turn_identity,
                            None,
                    )
                        .await
                        .is_err()
                        {
                            break;
                        }
                        // Same as rewind: restore the inline plan graph after
                        // the transcript replacement.
                        send_swarm_plan_to_session(
                            &client_session_id,
                            &swarm_members,
                            &swarm_plans,
                        )
                        .await;
                    }
                    Err(message) => {
                        let _ = client_event_tx.send(ServerEvent::Error {
                            id,
                            message,
                            retry_after_secs: None,
                        });
                    }
                }
            }

            Request::Ping { id } => {
                let event = super::session_connections::connection_presence_pong(id, &client_connections, &swarm_members).await;
                let json = encode_event(&event);
                let mut w = writer.lock().await;
                if w.write_all(json.as_bytes()).await.is_err() {
                    break;
                }
            }

            Request::PrepareDisconnect { id } => {
                peek_handle.stop();
                activity_subscribed.store(false, Ordering::Relaxed);
                stdin_responses.lock().await.clear();
                stdin_attention_guards.lock().await.clear();
                question_client.close();
                permission_client.close();
                // The SDK can attach again on this socket. Rebind only future turns.
                supports_user_questions = false;
                supports_permissions = false;
                question_client = Arc::new(crate::tool::ask_user_question::QuestionConnection::new(client_event_tx.clone()));
                permission_client = Arc::new(
                    crate::tool::permission_gate::PermissionConnection::new_non_interactive(
                        client_event_tx.clone(),
                    ),
                );
                drop(crate::tool::sdk::ConnectionGuard(client_connection_id.clone()));
                let json = encode_event(&ServerEvent::Done { id });
                let mut w = writer.lock().await;
                if w.write_all(json.as_bytes()).await.is_err() {
                    break;
                }
            }

            Request::GetTodos { .. } => {
                let payload = serde_json::json!({
                    "todos": crate::todo::load_todos(&client_session_id).unwrap_or_else(|error| {
                        crate::logging::warn(&format!("Failed to load todos for {client_session_id}: {error}"));
                        Vec::new()
                    }),
                    "plan": crate::todo::load_plan(&client_session_id).unwrap_or_default(),
                    "goals": crate::todo::load_goals(&client_session_id).unwrap_or_default(),
                });
                let _ = client_event_tx.send(ServerEvent::Todos {
                    session_id: client_session_id.clone(),
                    payload: payload.to_string(),
                });
            }

            Request::GetFileChanges { .. } => {
                let sid = client_session_id.clone();
                let snapshot = tokio::task::spawn_blocking(move || {
                    crate::file_changes::snapshot_for_session(&sid)
                })
                .await
                .unwrap_or_else(|_| {
                    crate::file_changes::FileChangesSnapshot::empty(&client_session_id)
                });
                let _ = client_event_tx.send(ServerEvent::FileChangesState { snapshot });
            }

            Request::GetFileChangeDiff { id, path } => {
                let sid = client_session_id.clone();
                let result = tokio::task::spawn_blocking(move || {
                    crate::file_changes::get_diff(&sid, &path)
                })
                .await;
                let event = match result {
                    Ok(Ok(diff)) => ServerEvent::FileChangeDiff { id, diff },
                    Ok(Err(error)) => ServerEvent::Error {
                        id,
                        message: error.to_string(),
                        retry_after_secs: None,
                    },
                    Err(error) => ServerEvent::Error {
                        id,
                        message: format!("Failed to load file change diff: {error}"),
                        retry_after_secs: None,
                    },
                };
                let _ = client_event_tx.send(event);
            }

            Request::FileChangeAction {
                id,
                action,
                path,
                force,
            } => {
                let mutation_lease = if client_is_processing
                    || crate::turn_cancel_registry::has_active_turn(&client_session_id)
                {
                    None
                } else if let Ok(agent_guard) = agent.try_lock() {
                    agent_guard.claim_runtime_mutation().ok()
                } else {
                    None
                };
                let Some(_mutation_lease) = mutation_lease else {
                    let _ = client_event_tx.send(ServerEvent::Error {
                        id,
                        message: "Cannot modify file changes while a turn is processing."
                            .to_string(),
                        retry_after_secs: Some(1),
                    });
                    continue;
                };

                let sid_paths = client_session_id.clone();
                let path_for_lock = path.clone();
                let paths = tokio::task::spawn_blocking(move || {
                    crate::file_changes::affected_paths_for_action(
                        &sid_paths,
                        action,
                        path_for_lock.as_deref(),
                    )
                })
                .await
                .unwrap_or_default();
                let _file_locks = crate::tool::file_lock::lock_all(paths).await;

                let sid = client_session_id.clone();
                let result = tokio::task::spawn_blocking(move || {
                    crate::file_changes::apply_action(&sid, action, path.as_deref(), force)
                })
                .await;

                match result {
                    Ok(Ok(response)) => {
                        let broadcast_snapshot = response.snapshot.clone();
                        let _ = client_event_tx
                            .send(ServerEvent::FileChangeActionResult { id, response });
                        let delivered = super::fanout_live_client_event(
                            &swarm_members,
                            &client_session_id,
                            ServerEvent::FileChangesState {
                                snapshot: broadcast_snapshot.clone(),
                            },
                        )
                        .await;
                        if delivered == 0 {
                            let _ = client_event_tx.send(ServerEvent::FileChangesState {
                                snapshot: broadcast_snapshot,
                            });
                        }
                    }
                    Ok(Err(error)) => {
                        let _ = client_event_tx.send(ServerEvent::Error {
                            id,
                            message: error.to_string(),
                            retry_after_secs: None,
                        });
                    }
                    Err(error) => {
                        let _ = client_event_tx.send(ServerEvent::Error {
                            id,
                            message: format!("Failed to execute file change action: {error}"),
                            retry_after_secs: None,
                        });
                    }
                }
            }

            Request::GetState { id } => {
                if handle_get_state(
                    id,
                    &client_session_id,
                    client_is_processing,
                    session_control.pending_soft_interrupt_count(),
                    &sessions,
                    &writer,
                )
                .await
                .is_err()
                {
                    break;
                }
            }

            Request::Subscribe {
                id,
                system_prompt,
                supports_pdf_panels: requested_pdf_panels,
                supports_user_response: requested_user_response,
                supports_user_questions: requested_user_questions,
                supports_permissions: requested_permissions,
                supports_server_failover: requested_server_failover,
                supports_turn_identity: _,
                supports_bash_progress: _,
                working_dir: subscribe_working_dir,
                selfdev,
                target_session_id,
                client_instance_id,
                client_has_local_history,
                history_base,
                allow_session_takeover,
                crash_on_disconnect: _,
                continue_on_disconnect: requested_continuation,
                terminal_env,
                client_name: _,
            } => {
                if let Err(message) =
                    validated_subscribe_working_dir(
                        subscribe_working_dir.as_deref(), requested_continuation,
                    )
                {
                    let _ = client_event_tx.send(ServerEvent::Error {
                        id,
                        message,
                        retry_after_secs: None,
                    });
                    continue;
                }
                // Overrides are creation-only. In particular, never apply one to
                // a target attachment or a repeated Subscribe on this connection.
                if let Some(prompt) = new_session_system_prompt(
                    provisional_session,
                    target_session_id.as_deref(),
                    system_prompt.as_deref(),
                ) {
                    agent.lock().await.set_system_prompt(prompt);
                }
                // Every Subscribe carries an authoritative snapshot. An empty
                // snapshot must clear terminal vars inherited by the daemon
                // rather than retaining a prior pane's values.
                continue_on_disconnect = requested_continuation;
                supports_pdf_panels = requested_pdf_panels;
                recent_history_messages = history_base.and_then(|base| base.recent_messages);
                supports_user_response = requested_user_response;
                supports_user_questions = requested_user_questions;
                supports_permissions = requested_permissions;
                permission_client.configure_interactive(supports_permissions);
                supports_server_failover = requested_server_failover;
                active_terminal_env = terminal_env;
                current_client_instance_id = client_instance_id.clone();
                {
                    let mut connections = client_connections.write().await;
                    if let Some(info) = connections.get_mut(&client_connection_id) {
                        info.client_instance_id = client_instance_id.clone();
                        info.terminal_env = active_terminal_env.clone();
                    }
                }
                if let Some(target_session_id) = target_session_id {
                    // A brand-new desktop panel has no transcript on disk until
                    // its first prompt. Its creator connection can detach before
                    // the panel connection arrives, while the live agent is
                    // already registered in memory. Treat that as an existing
                    // session or the target-aware subscribe silently creates a
                    // different session and every subsequent command reports a
                    // wrong-session attachment.
                    if crate::session::session_exists(&target_session_id)
                        || sessions.read().await.contains_key(&target_session_id)
                    {
                        let pre_resume_session_id = client_session_id.clone();
                        agent = crate::hooks::with_client_terminal_env(
                            active_terminal_env.clone(),
                            handle_resume_session(
                                id,
                                target_session_id.clone(),
                                subscribe_working_dir.as_deref(),
                                client_instance_id.as_deref(),
                                client_has_local_history,
                                history_base,
                                allow_session_takeover,
                                &mut client_selfdev,
                                &mut client_session_id,
                                &client_connection_id,
                                &agent,
                                &provider,
                                &registry,
                                &sessions,
                                &shutdown_signals,
                                &soft_interrupt_queues,
                                &client_connections,
                                &client_debug_state,
                                &swarm_members,
                                &swarms_by_id,
                                &file_touch,
                                &channel_subscriptions,
                                &channel_subscriptions_by_session,
                                &swarm_plans,
                                &swarm_coordinators,
                                &client_count,
                                &writer,
                                &server_name,
                                &server_icon,
                                &client_event_tx,
                                &mcp_pool,
                                &event_history,
                                &event_counter,
                                &swarm_event_tx,
                                supports_pdf_panels,
                                supports_turn_identity,
                            ),
                        )
                        .await?;
                        session_control = refresh_session_control_handle(
                            &client_session_id,
                            &agent,
                            &shutdown_signals,
                            &soft_interrupt_queues,
                        )
                        .await;
                        if client_session_id == target_session_id {
                            if client_session_id != pre_resume_session_id {
                                stdin_active.store(false, Ordering::Release);
                                stdin_forwarder.abort();
                                stdin_responses.lock().await.clear();
                                stdin_attention_guards.lock().await.clear();
                                (stdin_req_tx, stdin_active, stdin_forwarder) =
                                    spawn_stdin_forwarder(
                                        client_session_id.clone(),
                                        client_event_tx.clone(),
                                        Arc::clone(&stdin_responses),
                                        Arc::clone(&stdin_attention_guards),
                                    );
                                if let Ok(mut guard) = agent.try_lock() {
                                    guard.set_stdin_request_tx(stdin_req_tx.clone());
                                }
                            }
                            handle_subscribe(
                                id,
                                subscribe_working_dir,
                                selfdev,
                                false,
                                &mut client_selfdev,
                                &client_session_id,
                                &client_connection_id,
                                &friendly_name,
                                &agent,
                                &registry,
                                swarm_enabled,
                                &swarm_members,
                                &swarms_by_id,
                                &channel_subscriptions,
                                &channel_subscriptions_by_session,
                                &swarm_plans,
                                &swarm_coordinators,
                                &client_event_tx,
                                &mcp_pool,
                                &event_history,
                                &event_counter,
                                &swarm_event_tx,
                                &sessions,
                                &soft_interrupt_queues,
                            )
                            .await;
                            if let Some(snapshot) = try_available_models_snapshot(&agent).await {
                                last_available_models_snapshot = Some(snapshot);
                            }
                        } else {
                            crate::logging::warn(&format!(
                                "Target-aware subscribe failed to bind {} from temporary {}; closing temporary client connection {}",
                                target_session_id, pre_resume_session_id, client_connection_id
                            ));
                            // Tear down the rejected temporary placeholder
                            // immediately instead of holding the socket open
                            // for IDLE_RECONNECT_GRACE (30s) and emitting a
                            // delayed disconnect error later.
                            skip_idle_reconnect_grace = true;
                            break;
                        }
                    } else {
                        if provisional_session {
                            agent.lock().await.activate_concurrency_tracking();
                        }
                        handle_subscribe(
                            id,
                            subscribe_working_dir,
                            selfdev,
                            true,
                            &mut client_selfdev,
                            &client_session_id,
                            &client_connection_id,
                            &friendly_name,
                            &agent,
                            &registry,
                            swarm_enabled,
                            &swarm_members,
                            &swarms_by_id,
                            &channel_subscriptions,
                            &channel_subscriptions_by_session,
                            &swarm_plans,
                            &swarm_coordinators,
                            &client_event_tx,
                            &mcp_pool,
                            &event_history,
                            &event_counter,
                            &swarm_event_tx,
                            &sessions,
                            &soft_interrupt_queues,
                        )
                        .await;
                    }
                } else {
                    if provisional_session {
                        agent.lock().await.activate_concurrency_tracking();
                    }
                    handle_subscribe(
                        id,
                        subscribe_working_dir,
                        selfdev,
                        true,
                        &mut client_selfdev,
                        &client_session_id,
                        &client_connection_id,
                        &friendly_name,
                        &agent,
                        &registry,
                        swarm_enabled,
                        &swarm_members,
                        &swarms_by_id,
                        &channel_subscriptions,
                        &channel_subscriptions_by_session,
                        &swarm_plans,
                        &swarm_coordinators,
                        &client_event_tx,
                        &mcp_pool,
                        &event_history,
                        &event_counter,
                        &swarm_event_tx,
                        &sessions,
                        &soft_interrupt_queues,
                    )
                    .await;
                    // No catalog dedup baseline here. A fresh subscribe sends
                    // no catalog to the client (History does, and GetHistory
                    // records the baseline right after). Building the snapshot
                    // here cost ~200ms on a cold server and sat directly in
                    // front of the client's GetHistory, delaying first paint.
                    last_available_models_snapshot = None;
                }
                super::client_session::apply_or_defer_desktop_response_capability(
                    &agent,
                    supports_user_response,
                )
                .await;
                if requested_continuation {
                    super::runtime_ssh_loops::initialize_remote_session(
                        &client_session_id,
                        crate::config::config().features.auto_poke,
                    )?;
                }
                client_subscribed = true;
                provisional_session = false;
                *connection_session_id_slot
                    .write()
                    .unwrap_or_else(|e| e.into_inner()) = client_session_id.clone();
                if let Some(ref dir) = swarm_members
                    .read()
                    .await
                    .get(&client_session_id)
                    .and_then(|m| m.working_dir.clone())
                {
                    *activity_fallback_wdir_slot
                        .write()
                        .unwrap_or_else(|e| e.into_inner()) = Some(dir.clone());
                }
                activity_connection_ready.store(true, Ordering::Relaxed);
                let _ = activity_trigger_tx.send(false);
            }

            Request::GetHistory { id } => {
                if handle_get_history(
                    id,
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &provider,
                    &sessions,
                    &client_connections,
                    &client_count,
                    &writer,
                    &server_name,
                    &server_icon,
                    None,
                    supports_pdf_panels,
                    supports_turn_identity,
                    recent_history_messages.map(crate::protocol::HistoryBase::recent),
            )
                .await
                .is_err()
                {
                    break;
                }
                // Follow the History payload with the current swarm plan: a
                // session-changing History clears the client's plan snapshot
                // (and the inline plan graph), so re-send it afterwards
                // instead of leaving the graph blank until the next plan
                // mutation broadcast.
                send_swarm_plan_to_session(&client_session_id, &swarm_members, &swarm_plans).await;
                if let Some(snapshot) = try_available_models_snapshot(&agent).await {
                    last_available_models_snapshot = Some(snapshot);
                }
            }

            Request::GetModelCatalog { id, subscribe_usage_updates } => {
                model_usage_updates_enabled = subscribe_usage_updates;
                if handle_get_model_catalog(id, &client_session_id, &agent, &provider, &writer)
                    .await
                    .is_err()
                {
                    break;
                }
                if let Some(snapshot) = try_available_models_snapshot(&agent).await {
                    last_available_models_snapshot = Some(snapshot);
                }
            }

            Request::GetCompactedHistory {
                id,
                visible_messages,
                recent_history,
            } => {
                if handle_get_compacted_history(
                    id,
                    &client_session_id,
                    &agent,
                    &writer,
                    visible_messages,
                    recent_history,
                )
                .await
                .is_err()
                {
                    break;
                }
            }

            Request::DebugCommand { id, .. } => {
                let _ = client_event_tx.send(ServerEvent::Error {
                    id,
                    message: "debug_command is only supported on the debug socket".to_string(),
                    retry_after_secs: None,
                });
            }

            Request::UpgradeRuntime { id, candidate } => {
                super::runtime_upgrade::handle(id, &candidate, &writer, &sessions).await?;
            }

            Request::Reload { id, force } => {
                handle_reload(
                    id,
                    force,
                    &client_session_id,
                    &agent,
                    &swarm_members,
                    &client_event_tx,
                )
                .await;
            }

            Request::ResumeSession {
                id,
                session_id,
                client_instance_id,
                client_has_local_history,
                allow_session_takeover,
                client_name: _,
            } => {
                let pre_resume_session_id = client_session_id.clone();
                let resume_working_dir = match agent.try_lock() {
                    Ok(agent_guard) => agent_guard.working_dir().map(str::to_string),
                    Err(_) => swarm_members
                        .read()
                        .await
                        .get(&client_session_id)
                        .and_then(|member| member.working_dir.as_ref())
                        .map(|path| path.to_string_lossy().to_string()),
                };

                let switching_away_from_running = session_id != pre_resume_session_id
                    && (client_is_processing
                        || processing_task.is_some()
                        || crate::turn_cancel_registry::has_active_turn(&pre_resume_session_id));

                let mut detached_claim_id: Option<String> = None;
                if switching_away_from_running {
                    let target_available = sessions.read().await.contains_key(&session_id)
                        || crate::session::session_exists(&session_id);
                    if !target_available {
                        let _ = client_event_tx.send(ServerEvent::Error {
                            id,
                            message: format!(
                                "Failed to restore session: Session '{}' not found",
                                session_id
                            ),
                            retry_after_secs: None,
                        });
                        continue;
                    }

                    // Silence Session A's event fanout and fallback reversibly so
                    // A cannot interleave events after B's History while keeping
                    // A's task/prompts intact in case `handle_resume_session`
                    // rejects or fails.
                    silence_session_for_switch(
                        &pre_resume_session_id,
                        &client_connection_id,
                        &client_event_tx,
                        processing_fallback.as_ref(),
                        &swarm_members,
                    )
                    .await;

                    // Keep the running source session live and unlocked during
                    // `handle_resume_session`: without an active claim entry,
                    // `remove_detached_source_if_unclaimed` would remove the
                    // session and block on `source_agent.lock().await`.
                    let claim_id = format!("detached_turn:{client_connection_id}:{id}");
                    let (claim_disconnect_tx, _claim_disconnect_rx) = mpsc::unbounded_channel();
                    let now = Instant::now();
                    client_connections.write().await.insert(
                        claim_id.clone(),
                        ClientConnectionInfo {
                            client_id: claim_id.clone(),
                            session_id: pre_resume_session_id.clone(),
                            client_instance_id: None,
                            debug_client_id: None,
                            connected_at: now,
                            last_seen: now,
                            is_processing: true,
                            current_tool_name: None,
                            terminal_env: Vec::new(),
                            disconnect_tx: claim_disconnect_tx,
                        },
                    );
                    detached_claim_id = Some(claim_id);
                }

                // Synchronously sever Session A's permission/question/stdin/fallback
                // channels at the exact commit point inside `handle_resume_session`
                // BEFORE B's `History` and `Done` are emitted, so a detached turn A
                // can never leak prompts or stream events onto B's socket.
                let on_switch_commit: Option<Box<dyn FnOnce(&str) + Send>> =
                    (session_id != pre_resume_session_id).then(|| {
                        let old_permission_client = Arc::clone(&permission_client);
                        let old_question_client = Arc::clone(&question_client);
                        let old_fallback = processing_fallback.clone();
                        let old_stdin_active = Arc::clone(&stdin_active);
                        let old_stdin_abort = stdin_forwarder.abort_handle();
                        let slot = Arc::clone(&connection_session_id_slot);
                        Box::new(move |new_session_id: &str| {
                            old_permission_client.close();
                            old_question_client.detach();
                            if let Some(fallback) = old_fallback {
                                fallback.detach();
                            }
                            old_stdin_active.store(false, Ordering::Release);
                            old_stdin_abort.abort();
                            *slot.write().unwrap_or_else(|e| e.into_inner()) =
                                new_session_id.to_string();
                        }) as Box<dyn FnOnce(&str) + Send>
                    });

                current_client_instance_id = client_instance_id.clone();
                {
                    let mut connections = client_connections.write().await;
                    if let Some(info) = connections.get_mut(&client_connection_id) {
                        info.client_instance_id = client_instance_id.clone();
                    }
                }
                let resume_result = crate::hooks::with_client_terminal_env(
                    active_terminal_env.clone(),
                    handle_resume_session_with_switch_hook(
                        id,
                        session_id,
                        resume_working_dir.as_deref(),
                        client_instance_id.as_deref(),
                        client_has_local_history,
                        recent_history_messages.map(crate::protocol::HistoryBase::recent),
                        allow_session_takeover,
                        &mut client_selfdev,
                        &mut client_session_id,
                        &client_connection_id,
                        &agent,
                        &provider,
                        &registry,
                        &sessions,
                        &shutdown_signals,
                        &soft_interrupt_queues,
                        &client_connections,
                        &client_debug_state,
                        &swarm_members,
                        &swarms_by_id,
                        &file_touch,
                        &channel_subscriptions,
                        &channel_subscriptions_by_session,
                        &swarm_plans,
                        &swarm_coordinators,
                        &client_count,
                        &writer,
                        &server_name,
                        &server_icon,
                        &client_event_tx,
                        &mcp_pool,
                        &event_history,
                        &event_counter,
                        &swarm_event_tx,
                        supports_pdf_panels,
                        supports_turn_identity,
                        on_switch_commit,
                    ),
                )
                .await;
                if let Some(claim_id) = detached_claim_id {
                    client_connections.write().await.remove(&claim_id);
                }
                agent = resume_result?;
                if client_session_id == pre_resume_session_id {
                    // Resume was rejected or failed: restore Session A's live
                    // attachment so the user is never stranded without stream events.
                    if switching_away_from_running {
                        rollback_session_switch_silence(
                            &pre_resume_session_id,
                            &client_connection_id,
                            &client_event_tx,
                            processing_fallback.as_ref(),
                            &swarm_members,
                        )
                        .await;
                    }
                } else {
                    provisional_session = false;
                    // Install fresh connection-scoped permission, question, and
                    // stdin channels bound strictly to Session B so detached
                    // Session A cannot hijack prompts or deadlock B's single
                    // question slot.
                    let next_permission_client = Arc::new(
                        permission_client.fork_for_new_session(client_event_tx.clone()),
                    );
                    permission_client.close();
                    permission_client = next_permission_client;

                    question_client.detach();
                    question_client = Arc::new(
                        crate::tool::ask_user_question::QuestionConnection::new(
                            client_event_tx.clone(),
                        ),
                    );

                    stdin_active.store(false, Ordering::Release);
                    stdin_forwarder.abort();
                    stdin_responses.lock().await.clear();
                    stdin_attention_guards.lock().await.clear();
                    (stdin_req_tx, stdin_active, stdin_forwarder) = spawn_stdin_forwarder(
                        client_session_id.clone(),
                        client_event_tx.clone(),
                        Arc::clone(&stdin_responses),
                        Arc::clone(&stdin_attention_guards),
                    );
                    if let Ok(mut guard) = agent.try_lock() {
                        guard.set_stdin_request_tx(stdin_req_tx.clone());
                    }

                    if switching_away_from_running {
                        detach_live_turn_for_session_switch(
                            &pre_resume_session_id,
                            &client_connection_id,
                            continue_on_disconnect,
                            &mut client_is_processing,
                            &mut processing_done_tx,
                            &mut processing_done_rx,
                            &mut processing_task,
                            &mut processing_message_id,
                            &mut processing_session_id,
                            &mut processing_fallback,
                            &sessions,
                            &client_connections,
                            &swarm_members,
                            &swarms_by_id,
                            &swarm_coordinators,
                            &swarm_plans,
                            &file_touch,
                            &channel_subscriptions,
                            &channel_subscriptions_by_session,
                            &shutdown_signals,
                            &soft_interrupt_queues,
                            &event_history,
                            &event_counter,
                            &swarm_event_tx,
                        )
                        .await;
                    } else if let Some(fallback) = processing_fallback.take() {
                        fallback.detach();
                    }
                }
                *connection_session_id_slot
                    .write()
                    .unwrap_or_else(|e| e.into_inner()) = client_session_id.clone();
                if let Some(dir) = swarm_members
                    .read()
                    .await
                    .get(&client_session_id)
                    .and_then(|m| m.working_dir.clone())
                    .or_else(|| resume_working_dir.as_deref().map(std::path::PathBuf::from))
                {
                    *activity_fallback_wdir_slot
                        .write()
                        .unwrap_or_else(|e| e.into_inner()) = Some(dir);
                }
                super::client_session::apply_or_defer_desktop_response_capability(
                    &agent,
                    supports_user_response,
                )
                .await;
                session_control = refresh_session_control_handle(
                    &client_session_id,
                    &agent,
                    &shutdown_signals,
                    &soft_interrupt_queues,
                )
                .await;
                if let Some(snapshot) = try_available_models_snapshot(&agent).await {
                    last_available_models_snapshot = Some(snapshot);
                }
                if client_subscribed {
                    let _ = activity_trigger_tx.send(false);
                }
            }

            Request::ResumeAllSessions { id } => {
                super::client_actions::handle_resume_all_sessions(
                    id,
                    &sessions,
                    &swarm_members,
                    &swarms_by_id,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &client_event_tx,
                )
                .await;
            }

            Request::CycleModel { id, direction } => {
                handle_cycle_model(id, direction, &agent, &client_event_tx).await;
            }

            Request::RefreshModels { id } => {
                handle_refresh_models(id, &provider, &agent, &client_event_tx).await;
            }

            Request::SetPremiumMode { id, mode } => {
                handle_set_premium_mode(id, mode, &agent, &client_event_tx).await;
            }

            Request::SetModel { id, model } => {
                handle_set_model(id, model, &agent, &client_event_tx).await;
            }

            Request::SetRoute { id, selection, automatic_failover } => {
                handle_set_route(id, selection, automatic_failover, &agent, &client_event_tx).await;
            }

            Request::SetAgentModel { id, target, model, global } => {
                let result = if global {
                    super::client_actions::set_global_agent_model(
                        &agent, &client_session_id, &target, model,
                    ).await
                } else {
                    super::client_actions::set_session_agent_model(
                        &agent, &client_session_id, &target, model,
                    ).await
                };
                let event = match result {
                    Ok(overrides) => ServerEvent::AgentModelsChanged { id, session_id: client_session_id.clone(), overrides },
                    Err(error) => ServerEvent::Error { id, message: error.to_string(), retry_after_secs: None },
                };
                if let Err(error) = client_event_tx.send(event) {
                crate::logging::debug(&format!("Client disconnected before event delivery: {error}"));
            }
            }

            Request::SetSubagentModel { id, model } => {
                if reject_if_agent_busy_for_request(
                    id,
                    "set_subagent_model",
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &client_event_tx,
                ) {
                    continue;
                }
                handle_set_subagent_model(id, model, &agent, &client_event_tx).await;
            }

            Request::RunSubagent {
                id,
                prompt,
                subagent_type,
                model,
                session_id,
            } => {
                handle_run_subagent(
                    id,
                    prompt,
                    subagent_type,
                    model,
                    session_id,
                    &agent,
                    &client_event_tx,
                );
            }

            Request::SetContextCap {
                id,
                max_context_tokens,
                session_id,
            } => {
                let target_agent = sessions.read().await.get(&session_id).cloned();
                if let Some(target_agent) = target_agent {
                    handle_set_context_cap(id, session_id, max_context_tokens, &target_agent, &client_event_tx).await;
                } else {
                    let _ = client_event_tx.send(ServerEvent::Error {
                        id,
                        message: "target session not found".to_string(),
                        retry_after_secs: None,
                    });
                }
            }

            Request::SetReasoningEffort {
                id,
                effort,
                target_session_id,
            } => {
                if let Some(target_session_id) = target_session_id {
                    let target_agent = { sessions.read().await.get(&target_session_id).cloned() };
                    if let Some(target_agent) = target_agent {
                        handle_set_reasoning_effort(id, effort, &target_agent, &client_event_tx)
                            .await;
                    } else {
                        let _ = client_event_tx.send(ServerEvent::ReasoningEffortChanged {
                            id,
                            effort: None,
                            error: Some(format!("target session not found: {target_session_id}")),
                        });
                    }
                } else {
                    handle_set_reasoning_effort(id, effort, &agent, &client_event_tx).await;
                }
            }

            Request::SetServiceTier { id, service_tier } => {
                handle_set_service_tier(id, service_tier, &agent, session_control.provider_handle(), &client_event_tx).await;
            }

            Request::SetTransport { id, transport } => {
                handle_set_transport(id, transport, &agent, &client_event_tx).await;
            }

            Request::SetCompactionMode { id, mode } => {
                handle_set_compaction_mode(id, mode, &agent, &client_event_tx).await;
            }

            Request::SetSessionEnv { id, env } => {
                let result = super::set_live_session_env(&sessions, &client_session_id, env).await;
                let _ = client_event_tx.send(match result {
                    Ok(()) => ServerEvent::Done { id },
                    Err(_) => ServerEvent::Error {
                        id,
                        message: "Invalid session environment".to_string(),
                        retry_after_secs: None,
                    },
                });
            }

            Request::SetSessionSaved { id, saved, label } => {
                if reject_if_agent_busy_for_request(
                    id,
                    "set_session_saved",
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &client_event_tx,
                ) {
                    continue;
                }
                handle_set_session_saved(
                    id,
                    saved,
                    label,
                    &agent,
                    &client_session_id,
                    &swarm_members,
                    &client_event_tx,
                )
                .await;
            }

            Request::PersistSession { id } => {
                let persist = {
                    let agent_weak = Arc::downgrade(&agent);
                    let response_tx = client_event_tx.clone();
                    let session_id = client_session_id.clone();
                    async move {
                        let Some(agent) = agent_weak.upgrade() else {
                            return;
                        };
                        let mut guard = agent.lock().await;
                        if Arc::strong_count(&agent) == 1 {
                            return;
                        }
                        let result = if guard.session_id() == session_id {
                            guard.persist_session_now()
                        } else {
                            Err(anyhow::anyhow!("Session changed before it could be saved"))
                        };
                        let _ = response_tx.send(match result {
                            Ok(()) => ServerEvent::Done { id },
                            Err(error) => ServerEvent::Error {
                                id,
                                message: crate::util::format_error_chain(&error),
                                retry_after_secs: None,
                            },
                        });
                    }
                };
                // A save still waits for the turn boundary, but the owning
                // connection must keep reading replies while the model waits.
                if client_is_processing && (supports_user_questions || supports_permissions) {
                    if crate::runtime_activity::spawn_session(&client_session_id, persist).is_none() {
                        let _ = client_event_tx.send(ServerEvent::Error {
                            id,
                            message: "Session transfer in progress. Retry saving after it finishes.".into(),
                            retry_after_secs: None,
                        });
                    }
                } else {
                    persist.await;
                }
            }

            Request::RenameSession { id, title } => {
                if reject_if_agent_busy_for_request(
                    id,
                    "rename_session",
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &client_event_tx,
                ) {
                    continue;
                }
                handle_rename_session(
                    id,
                    title,
                    &agent,
                    &client_session_id,
                    &swarm_members,
                    &client_event_tx,
                )
                .await;
            }

            Request::NotifyAuthChanged {
                id,
                provider: provider_hint,
                auth,
                prefer_strongest,
            } => {
                handle_notify_auth_changed(
                    id,
                    provider_hint,
                    auth,
                    prefer_strongest,
                    &provider,
                    &provider_template,
                    &sessions,
                    &client_session_id,
                    &agent,
                    &client_event_tx,
                )
                .await;
            }

            Request::SwitchAnthropicAccount { id, label } => {
                handle_switch_anthropic_account(id, label, &agent, &client_event_tx).await;
            }

            Request::SwitchOpenAiAccount { id, label } => {
                handle_switch_openai_account(id, label, &agent, &client_event_tx).await;
            }

            Request::AccountUsage { id } => {
                super::account_usage::request(id, client_event_tx.clone());
            }

            Request::InvalidateOpenAiUsage { id, account_label } => {
                handle_invalidate_openai_usage(id, account_label, &client_event_tx).await;
            }

            Request::InvalidateAnthropicUsage { id, account_label } => {
                handle_invalidate_anthropic_usage(id, account_label, &client_event_tx).await;
            }

            Request::SetFeature {
                id,
                feature,
                enabled,
            } => {
                if reject_if_agent_busy_for_request(
                    id,
                    "set_feature",
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &client_event_tx,
                ) {
                    continue;
                }
                handle_set_feature(
                    id,
                    feature,
                    enabled,
                    &agent,
                    &client_session_id,
                    &friendly_name,
                    &mut swarm_enabled,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_coordinators,
                    &channel_subscriptions,
                    &channel_subscriptions_by_session,
                    &swarm_plans,
                    &client_event_tx,
                )
                .await;
            }

            Request::Split {
                id,
                up_to_message_index,
                up_to_message_id,
            } => {
                handle_split_with_boundary(
                    id,
                    &client_session_id,
                    up_to_message_index,
                    up_to_message_id,
                    &agent,
                    &client_event_tx,
                )
                .await;
            }

            Request::Transfer { id } => {
                if reject_if_agent_busy_for_request(
                    id,
                    "transfer",
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &client_event_tx,
                ) {
                    continue;
                }
                handle_transfer(id, &client_session_id, &agent, &client_event_tx).await;
            }

            Request::Compact { id } => {
                handle_compact(id, &agent, &client_event_tx);
            }

            Request::TriggerMemoryExtraction { id } => {
                if reject_if_agent_busy_for_request(
                    id,
                    "trigger_memory_extraction",
                    &client_session_id,
                    client_is_processing,
                    &agent,
                    &client_event_tx,
                ) {
                    continue;
                }
                handle_trigger_memory_extraction(id, &agent, &client_event_tx).await;
            }

            // Agent-to-agent communication
            Request::AgentRegister { id, .. } => {
                let _ = client_event_tx.send(ServerEvent::Done { id });
            }

            Request::StdinResponse {
                id,
                request_id,
                input,
            } => {
                stdin_attention_guards.lock().await.remove(&request_id);
                handle_stdin_response(id, request_id, input, &stdin_responses, &client_event_tx)
                    .await;
            }

            Request::AgentTask { id, task, .. } => {
                handle_agent_task(
                    id,
                    task,
                    &client_session_id,
                    &agent,
                    &AgentTaskContext {
                        client_event_tx: &client_event_tx,
                        swarm_members: &swarm_members,
                        swarms_by_id: &swarms_by_id,
                        event_history: &event_history,
                        event_counter: &event_counter,
                        swarm_event_tx: &swarm_event_tx,
                    },
                )
                .await;
            }

            Request::AgentCapabilities { id } => {
                let _ = client_event_tx.send(ServerEvent::Done { id });
            }

            Request::GlobalRuntimeCommand { id, command, args } => {
                super::runtime_commands::handle_global_runtime_command(
                    id,
                    &command,
                    &args,
                    &provider_template,
                    Some(&mcp_pool),
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_coordinators,
                    &swarm_plans,
                    &event_history,
                    &client_event_tx,
                )
                .await;
            }

            Request::RuntimeCommand { id, command, args } => {
                let result: anyhow::Result<(serde_json::Value, String)> = async {
                    // Stop/status must remain available while a loop's model or
                    // tool turn owns the Agent mutex.
                    if let Some(result) = super::runtime_ssh_loops::control(&client_session_id, &command, &args)? {
                        return Ok(result);
                    }
                    // Supplemental SSH/cloud commands intentionally precede the shared
                    // enum parser so new host workflows do not require a wire-enum release.
                    if super::runtime_ssh_sessions::handles(&command)
                        || super::runtime_ssh_loops::handles(&command)
                        || super::runtime_ssh_accounts::handles(&command)
                        || super::runtime_ssh_host::handles(&command)
                    {
                        if super::runtime_ssh_loops::handles(&command)
                            && (client_is_processing || crate::turn_cancel_registry::has_active_turn(&client_session_id)) {
                            anyhow::bail!("Session is busy. Stop/status are available now. Start or resume after the current turn.");
                        }
                        let mut guard = agent.try_lock().map_err(|_| anyhow::anyhow!("Session is busy. Retry this command after the current turn."))?;
                        if super::runtime_ssh_sessions::handles(&command) {
                            return super::runtime_ssh_sessions::execute(&mut guard, &command, &args).await;
                        }
                        if super::runtime_ssh_loops::handles(&command) {
                            return super::runtime_ssh_loops::execute(&mut guard, &command, &args).await;
                        }
                        if super::runtime_ssh_accounts::handles(&command) {
                            return super::runtime_ssh_accounts::execute(&mut guard, &command, &args).await;
                        }
                        return super::runtime_ssh_host::execute(&mut guard, &command, &args).await;
                    }
                    let parsed: rayucode_harness_api::RuntimeCommand = serde_json::from_value(serde_json::json!(command))?;
                    if parsed == rayucode_harness_api::RuntimeCommand::ServerReload {
                        if !args.is_empty() { anyhow::bail!("Server reload accepts no arguments. Forced reload is intentionally not exposed."); }
                        let _ = client_event_tx.send(ServerEvent::RuntimeCommandResult { id, command: command.clone(),
                            data: serde_json::json!({"requested": true, "force": false}),
                            message: "Requested a state-preserving server upgrade if a newer binary is available. Watch reload progress for completion.".into() });
                        handle_reload(id, false, &client_session_id, &agent, &swarm_members, &client_event_tx).await;
                        return Ok((serde_json::Value::Null, String::new()));
                    }
                    if matches!(parsed, rayucode_harness_api::RuntimeCommand::Continue | rayucode_harness_api::RuntimeCommand::ResumeAll) {
                        if !args.is_empty() { anyhow::bail!("This command accepts no arguments"); }
                        let (tx, mut rx) = mpsc::unbounded_channel();
                        super::client_actions::handle_resume_all_sessions(id, &sessions, &swarm_members, &swarms_by_id,
                            &event_history, &event_counter, &swarm_event_tx, &tx).await;
                        while let Ok(event) = rx.try_recv() {
                            if let ServerEvent::ResumeAllResult { resumed, skipped, message, resumed_sessions, .. } = event {
                                return Ok((serde_json::json!({"resumed": resumed, "skipped": skipped, "resumed_sessions": resumed_sessions}), message));
                            }
                        }
                        anyhow::bail!("Runtime did not report continuation outcome");
                    }
                    if parsed == rayucode_harness_api::RuntimeCommand::RefreshModelList {
                        if !args.is_empty() { anyhow::bail!("This command accepts no arguments"); }
                        tokio::time::timeout(
                            Duration::from_secs(25),
                            provider.refresh_model_catalog(),
                        )
                        .await
                        .map_err(|_| anyhow::anyhow!("Timed out refreshing provider model catalog after 25s"))??;
                        crate::bus::Bus::global().publish_models_updated();
                        let guard = agent.try_lock().map_err(|_| anyhow::anyhow!("Catalog refreshed, but session is busy. Open the model picker after the turn."))?;
                        let data = serde_json::json!({"refreshed": true, "models": guard.available_models_for_switching(), "routes": guard.model_routes()});
                        return Ok((data, "Provider model catalog refreshed.".into()));
                    }
                    if parsed == rayucode_harness_api::RuntimeCommand::Swarm {
                        let first_arg = args.first().map(|a| a.to_ascii_lowercase());
                        let is_toggle_mutation = args.len() == 1
                            && matches!(
                                first_arg.as_deref(),
                                Some("on" | "enable" | "enabled" | "off" | "disable" | "disabled" | "toggle")
                            );
                        let view = if is_toggle_mutation {
                            let Some(enabled) = super::runtime_commands::boolean_action(&args, swarm_enabled, false)? else {
                                unreachable!("toggle mutation always yields Some(bool)");
                            };
                            if reject_if_agent_busy_for_request(id, "runtime_command", &client_session_id, client_is_processing, &agent, &client_event_tx) {
                                return Ok((serde_json::Value::Null, String::new()));
                            }
                            let (tx, mut rx) = mpsc::unbounded_channel();
                            handle_set_feature(id, crate::protocol::FeatureToggle::Swarm, enabled, &agent, &client_session_id, &friendly_name,
                                &mut swarm_enabled, &swarm_members, &swarms_by_id, &swarm_coordinators,
                                &channel_subscriptions, &channel_subscriptions_by_session, &swarm_plans, &tx).await;
                            while let Ok(event) = rx.try_recv() {
                                if let ServerEvent::Error { message, .. } = event { anyhow::bail!("{message}"); }
                            }
                            first_arg.as_deref().unwrap_or("status")
                        } else {
                            let sub = first_arg.as_deref().unwrap_or("status");
                            if !matches!(sub, "status" | "show" | "stats" | "list" | "board") || args.len() > 1 {
                                anyhow::bail!("Usage: /swarm [status|show|list|board|on|off|toggle]");
                            }
                            sub
                        };
                        let data = build_live_swarm_snapshot(
                            view,
                            &client_session_id,
                            swarm_enabled,
                            &swarm_members,
                            &swarms_by_id,
                            &swarm_coordinators,
                            &swarm_plans,
                            &event_history,
                        )
                        .await;
                        return Ok((data.clone(), serde_json::to_string_pretty(&data)?));
                    }
                    if parsed == rayucode_harness_api::RuntimeCommand::Subscription {
                        if !args.is_empty() && args != ["status".to_string()] { anyhow::bail!("Usage: subscription [status]"); }
                        let data = super::runtime_commands::rayu_credits_data().await?;
                        return Ok((data.clone(), serde_json::to_string_pretty(&data)?));
                    }
                    // Dispatch lock-free runtime commands BEFORE `agent.try_lock()` so
                    // background polling, approvals, schedules, MCP, features, doctor,
                    // session search, and overnight inspection never fail with
                    // `"Session is busy"` while an active turn holds the Agent mutex.
                    if super::runtime_special_commands::is_lock_free(parsed, &args) {
                        let lock_free_ctx = if let Ok(guard) = agent.try_lock() {
                            super::runtime_special_commands::LockFreeCommandContext::from_agent(&guard)
                        } else {
                            let cached_dir = swarm_members
                                .read()
                                .await
                                .get(&client_session_id)
                                .and_then(|m| m.working_dir.clone())
                                .or_else(|| Some(std::path::PathBuf::from(&initial_working_dir)));
                            let active_provider = session_control
                                .provider_handle()
                                .unwrap_or_else(|| Arc::clone(&provider));
                            super::runtime_special_commands::LockFreeCommandContext {
                                session_id: client_session_id.clone(),
                                working_dir: cached_dir,
                                registry: Some(registry.clone()),
                                provider_name: active_provider.name().to_string(),
                                provider_model: active_provider.model(),
                                provider_context_window: active_provider.context_window(),
                                provider_transport: active_provider.transport(),
                                route_counts: None,
                            }
                        };
                        if let Some(res) = super::runtime_special_commands::try_execute_lock_free(
                            &lock_free_ctx,
                            parsed,
                            &args,
                        )
                        .await
                        {
                            return res;
                        }
                    }
                    let mut guard = agent.try_lock().map_err(|_| anyhow::anyhow!("Session is busy. Retry this runtime command after the current turn."))?;
                    super::runtime_commands::execute(&mut guard, parsed, &args, swarm_enabled, serde_json::Value::Null).await
                }.await;
                match result {
                    Ok((mut data, message)) if !data.is_null() => {
                        // Only the server loop implementation can supply a
                        // launch item. Never dispatch arbitrary response data
                        // from an unrelated runtime command as a model prompt.
                        let next_prompt = if super::runtime_ssh_loops::handles(&command) {
                            data.as_object_mut().and_then(|object| object.remove("next_prompt"))
                                .and_then(|value| value.as_str().map(str::to_owned))
                        } else { None };
                        if next_prompt.is_some() { data["started"] = serde_json::json!(true); }
                        let _ = client_event_tx.send(ServerEvent::RuntimeCommandResult { id, command, data, message });
                        if let Some(content) = next_prompt {
                            // The execute closure has returned and dropped its
                            // Agent guard. Reuse the actual message lifecycle:
                            // processing state, task ownership, fanout, cancel,
                            // failover, completion and disconnected continuation.
                            if provisional_session {
                                agent.lock().await.activate_concurrency_tracking();
                                provisional_session = false;
                            }
                            if !client_is_processing {
                                if let Ok(mut guard) = agent.try_lock() {
                                    guard.set_stdin_request_tx(stdin_req_tx.clone());
                                }
                                let mut connections = client_connections.write().await;
                                if let Some(info) = connections.get_mut(&client_connection_id) {
                                    info.is_processing = true;
                                    info.current_tool_name = None;
                                }
                            }
                            if let Some(fallback) = start_processing_message(
                                ProcessingMessage {
                                    id, content, images: Vec::new(), system_reminder: None,
                                    active_skill: None, server_failover: true,
                                    question_client: supports_user_questions.then(|| question_client.clone()),
                                    permission_client: Some(permission_client.clone()),
                                },
                                &client_session_id,
                                &mut ProcessingState {
                                    client_is_processing: &mut client_is_processing,
                                    message_id: &mut processing_message_id,
                                    session_id: &mut processing_session_id,
                                    task: &mut processing_task,
                                },
                                &agent, &client_event_tx, &processing_done_tx,
                                active_terminal_env.clone(),
                                &SwarmStatusRefs {
                                    members: &swarm_members, swarms_by_id: &swarms_by_id,
                                    event_history: &event_history, event_counter: &event_counter,
                                    event_tx: &swarm_event_tx,
                                },
                            ).await {
                                processing_fallback = Some(fallback);
                            }
                        }
                    },
                    Ok(_) => {},
                    Err(error) => { let _ = client_event_tx.send(ServerEvent::Error { id, message: error.to_string(), retry_after_secs: None }); },
                }
            }
            Request::AgentContext { id } => {
                let _ = client_event_tx.send(ServerEvent::Done { id });
            }

            Request::NotifySession {
                id,
                session_id,
                message,
            } => {
                handle_notify_session(
                    id,
                    session_id,
                    message,
                    NotifySessionContext {
                        sessions: &sessions,
                        soft_interrupt_queues: &soft_interrupt_queues,
                        client_connections: &client_connections,
                        swarm_members: &swarm_members,
                        swarms_by_id: &swarms_by_id,
                        event_history: &event_history,
                        event_counter: &event_counter,
                        swarm_event_tx: &swarm_event_tx,
                        client_event_tx: &client_event_tx,
                    },
                )
                .await;
            }

            Request::AppletAction {
                id,
                session_id,
                instance,
                action,
                state,
                source_key,
            } => {
                super::client_actions::handle_applet_action(
                    id,
                    session_id,
                    instance,
                    action,
                    state,
                    source_key,
                    NotifySessionContext {
                        sessions: &sessions,
                        soft_interrupt_queues: &soft_interrupt_queues,
                        client_connections: &client_connections,
                        swarm_members: &swarm_members,
                        swarms_by_id: &swarms_by_id,
                        event_history: &event_history,
                        event_counter: &event_counter,
                        swarm_event_tx: &swarm_event_tx,
                        client_event_tx: &client_event_tx,
                    },
                )
                .await;
            }

            Request::CloseApplet {
                id,
                session_id,
                instance,
            } => {
                super::client_actions::handle_close_applet(
                    id,
                    session_id,
                    instance,
                    &client_event_tx,
                );
            }

            Request::Transcript {
                id,
                text,
                mode,
                session_id,
            } => {
                match super::debug::inject_transcript(
                    id,
                    text,
                    mode,
                    session_id,
                    &client_connections,
                    &client_debug_state,
                    &swarm_members,
                )
                .await
                {
                    Ok(event) => {
                        if let Err(error) = client_event_tx.send(event) {
                crate::logging::debug(&format!("Client disconnected before event delivery: {error}"));
            }
                    }
                    Err(error) => {
                        let _ = client_event_tx.send(ServerEvent::Error {
                            id,
                            message: error.to_string(),
                            retry_after_secs: None,
                        });
                    }
                }
            }

            Request::VoiceActivity {
                id,
                session_id,
                activity,
            } => {
                let event = super::debug::forward_voice_activity(
                    id,
                    &session_id,
                    activity,
                    &swarm_members,
                )
                .await;
                if let Err(error) = client_event_tx.send(event) {
                    crate::logging::debug(&format!("client disconnected before voice activity reply: {error}"));
                }
            }

            Request::InputShell { id, command } => {
                handle_input_shell(id, command, &agent, &client_event_tx);
            }

            // === Agent communication ===
            Request::CommShare {
                id,
                session_id: req_session_id,
                key,
                value,
                append,
            } => {
                handle_comm_share(
                    id,
                    req_session_id,
                    key,
                    value,
                    append,
                    &client_event_tx,
                    &swarm_members,
                    &swarms_by_id,
                    &shared_context,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                )
                .await;
            }

            Request::CommRead {
                id,
                session_id: req_session_id,
                key,
            } => {
                handle_comm_read(
                    id,
                    req_session_id,
                    key,
                    &client_event_tx,
                    &swarm_members,
                    &shared_context,
                )
                .await;
            }

            Request::CommMessage {
                id,
                from_session,
                message,
                to_session,
                channel,
                delivery,
                wake,
                tldr,
                to_swarm,
                require_target,
            } => {
                handle_comm_message(
                    id,
                    from_session,
                    message,
                    to_session,
                    channel,
                    delivery,
                    wake,
                    tldr,
                    to_swarm,
                    require_target,
                    &client_event_tx,
                    &sessions,
                    &soft_interrupt_queues,
                    &swarm_members,
                    &swarms_by_id,
                    &channel_subscriptions,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &client_connections,
                )
                .await;
            }

            Request::CommList {
                id,
                session_id: req_session_id,
            } => {
                handle_comm_list(
                    id,
                    req_session_id,
                    &client_event_tx,
                    &swarm_members,
                    &swarms_by_id,
                    &file_touch,
                    &sessions,
                    &client_connections,
                )
                .await;
            }

            Request::CommListSwarms {
                id,
                session_id: req_session_id,
            } => {
                handle_comm_list_swarms(
                    id,
                    req_session_id,
                    &client_event_tx,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_coordinators,
                )
                .await;
            }

            Request::CommSetSwarmLabel {
                id,
                session_id: req_session_id,
                label,
            } => {
                handle_comm_set_swarm_label(
                    id,
                    req_session_id,
                    label,
                    &client_event_tx,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_coordinators,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                )
                .await;
            }

            Request::CommListChannels {
                id,
                session_id: req_session_id,
            } => {
                handle_comm_list_channels(
                    id,
                    req_session_id,
                    &client_event_tx,
                    &swarm_members,
                    &channel_subscriptions,
                )
                .await;
            }

            Request::CommChannelMembers {
                id,
                session_id: req_session_id,
                channel,
            } => {
                handle_comm_channel_members(
                    id,
                    req_session_id,
                    channel,
                    &client_event_tx,
                    &swarm_members,
                    &channel_subscriptions,
                )
                .await;
            }

            Request::CommProposePlan {
                id,
                session_id: req_session_id,
                items,
            } => {
                handle_comm_propose_plan(
                    id,
                    req_session_id,
                    items,
                    &client_event_tx,
                    &swarm_members,
                    &swarms_by_id,
                    &shared_context,
                    &swarm_plans,
                    &swarm_coordinators,
                    &sessions,
                    &soft_interrupt_queues,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommApprovePlan {
                id,
                session_id: req_session_id,
                proposer_session,
            } => {
                handle_comm_approve_plan(
                    id,
                    req_session_id,
                    proposer_session,
                    &client_event_tx,
                    &swarm_members,
                    &swarms_by_id,
                    &shared_context,
                    &swarm_plans,
                    &swarm_coordinators,
                    &sessions,
                    &soft_interrupt_queues,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommRejectPlan {
                id,
                session_id: req_session_id,
                proposer_session,
                reason,
            } => {
                handle_comm_reject_plan(
                    id,
                    req_session_id,
                    proposer_session,
                    reason,
                    &client_event_tx,
                    &swarm_members,
                    &shared_context,
                    &swarm_coordinators,
                    &sessions,
                    &soft_interrupt_queues,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommSpawn {
                id,
                session_id: req_session_id,
                lane_id,
                working_dir,
                initial_message,
                request_nonce,
                spawn_mode,
                model,
                effort,
                label,
            } => {
                let spawn_mode = match parse_swarm_spawn_mode(id, spawn_mode, &client_event_tx) {
                    Some(spawn_mode) => spawn_mode,
                    None => return Ok(()),
                };
                handle_comm_spawn(
                    id,
                    req_session_id,
                    lane_id,
                    working_dir,
                    initial_message,
                    request_nonce,
                    spawn_mode,
                    model,
                    effort,
                    label,
                    &client_event_tx,
                    &sessions,
                    &global_session_id,
                    &provider_template,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_coordinators,
                    &swarm_plans,
                    &channel_subscriptions,
                    &channel_subscriptions_by_session,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &mcp_pool,
                    &soft_interrupt_queues,
                    &swarm_mutation_runtime,
                    &client_connections,
                )
                .await;
            }

            Request::CommListModels {
                id,
                session_id: req_session_id,
            } => {
                super::comm_session::handle_comm_list_models(
                    id,
                    &req_session_id,
                    &sessions,
                    &provider_template,
                    |event| {
                        if let Err(error) = client_event_tx.send(event) {
                crate::logging::debug(&format!("Client disconnected before event delivery: {error}"));
            }
                    },
                )
                .await;
            }

            Request::CommStop {
                id,
                session_id: req_session_id,
                target_session,
                force,
            } => {
                handle_comm_stop(
                    id,
                    req_session_id,
                    target_session,
                    force.unwrap_or(false),
                    &client_event_tx,
                    &sessions,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_coordinators,
                    &swarm_plans,
                    &channel_subscriptions,
                    &channel_subscriptions_by_session,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &soft_interrupt_queues,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommAssignRole {
                id,
                session_id: req_session_id,
                target_session,
                role,
            } => {
                handle_comm_assign_role(
                    id,
                    req_session_id,
                    target_session,
                    role,
                    &client_event_tx,
                    &sessions,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_coordinators,
                    &swarm_plans,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommSummary {
                id,
                session_id: req_session_id,
                target_session,
                limit,
            } => {
                handle_comm_summary(
                    id,
                    req_session_id,
                    target_session,
                    limit,
                    &sessions,
                    &swarm_members,
                    &client_event_tx,
                )
                .await;
            }

            Request::CommStatus {
                id,
                session_id: req_session_id,
                target_session,
            } => {
                handle_comm_status(
                    id,
                    req_session_id,
                    target_session,
                    &sessions,
                    &swarm_members,
                    &client_connections,
                    &file_touch,
                    &client_event_tx,
                )
                .await;
            }

            Request::CommReport {
                id,
                session_id: req_session_id,
                status,
                message,
                validation,
                follow_up,
                tldr,
            } => {
                let status = status.unwrap_or_else(|| "ready".to_string());
                let report = format_structured_completion_report(
                    &message,
                    validation.as_deref(),
                    follow_up.as_deref(),
                );
                let detail = Some(truncate_detail(&message, 160));
                update_member_status_with_report_tldr(
                    &req_session_id,
                    &status,
                    detail,
                    Some(report),
                    tldr,
                    &swarm_members,
                    &swarms_by_id,
                    Some(&event_history),
                    Some(&event_counter),
                    Some(&swarm_event_tx),
                )
                .await;
                super::comm_control::close_reporter_task_on_terminal_report(
                    &req_session_id,
                    &status,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_plans,
                    &swarm_coordinators,
                )
                .await;
                let _ = client_event_tx.send(ServerEvent::CommReportResponse {
                    id,
                    status,
                    message: "Report recorded and delivered to the coordinator when applicable."
                        .to_string(),
                });
            }

            Request::CommPlanStatus {
                id,
                session_id: req_session_id,
            } => {
                handle_comm_plan_status(
                    id,
                    req_session_id,
                    &swarm_members,
                    &swarm_plans,
                    &client_event_tx,
                )
                .await;
            }

            Request::CommReadContext {
                id,
                session_id: req_session_id,
                target_session,
            } => {
                handle_comm_read_context(
                    id,
                    req_session_id,
                    target_session,
                    &sessions,
                    &swarm_members,
                    &client_event_tx,
                )
                .await;
            }

            Request::CommResyncPlan {
                id,
                session_id: req_session_id,
            } => {
                handle_comm_resync_plan(
                    id,
                    req_session_id,
                    &CommResyncPlanContext {
                        client_event_tx: &client_event_tx,
                        swarm_members: &swarm_members,
                        swarms_by_id: &swarms_by_id,
                        swarm_plans: &swarm_plans,
                        swarm_coordinators: &swarm_coordinators,
                        event_history: &event_history,
                        event_counter: &event_counter,
                        swarm_event_tx: &swarm_event_tx,
                    },
                )
                .await;
            }

            Request::CommAssignTask {
                id,
                session_id: req_session_id,
                target_session,
                task_id,
                message,
            } => {
                handle_comm_assign_task(
                    id,
                    req_session_id,
                    target_session,
                    task_id,
                    message,
                    &client_event_tx,
                    &sessions,
                    &soft_interrupt_queues,
                    &client_connections,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_plans,
                    &swarm_coordinators,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommAssignNext {
                id,
                session_id: req_session_id,
                target_session,
                working_dir,
                prefer_spawn,
                spawn_if_needed,
                message,
                model,
                effort,
            } => {
                handle_comm_assign_next(
                    id,
                    req_session_id,
                    target_session,
                    working_dir,
                    prefer_spawn,
                    spawn_if_needed,
                    message,
                    model,
                    effort,
                    &client_event_tx,
                    &sessions,
                    &global_session_id,
                    &provider_template,
                    &soft_interrupt_queues,
                    &client_connections,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_plans,
                    &swarm_coordinators,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &mcp_pool,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommTaskControl {
                id,
                session_id: req_session_id,
                action,
                task_id,
                target_session,
                message,
            } => {
                handle_comm_task_control(
                    id,
                    req_session_id,
                    action,
                    task_id,
                    target_session,
                    message,
                    &client_event_tx,
                    &sessions,
                    &soft_interrupt_queues,
                    &client_connections,
                    &swarm_members,
                    &swarms_by_id,
                    &swarm_plans,
                    &swarm_coordinators,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                    &swarm_mutation_runtime,
                )
                .await;
            }

            Request::CommSubscribeChannel {
                id,
                session_id: req_session_id,
                channel,
            } => {
                handle_comm_subscribe_channel(
                    id,
                    req_session_id,
                    channel,
                    &client_event_tx,
                    &swarm_members,
                    &channel_subscriptions,
                    &channel_subscriptions_by_session,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                )
                .await;
            }

            Request::CommUnsubscribeChannel {
                id,
                session_id: req_session_id,
                channel,
            } => {
                handle_comm_unsubscribe_channel(
                    id,
                    req_session_id,
                    channel,
                    &client_event_tx,
                    &swarm_members,
                    &channel_subscriptions,
                    &channel_subscriptions_by_session,
                    &event_history,
                    &event_counter,
                    &swarm_event_tx,
                )
                .await;
            }

            Request::CommAwaitMembers {
                id,
                session_id: req_session_id,
                target_status,
                session_ids: requested_ids,
                mode,
                timeout_secs,
                background,
                notify,
                wake,
            } => {
                handle_comm_await_members(
                    id,
                    req_session_id,
                    target_status,
                    requested_ids,
                    mode,
                    timeout_secs,
                    background,
                    notify,
                    wake,
                    CommAwaitMembersContext {
                        client_event_tx: &client_event_tx,
                        swarm_members: &swarm_members,
                        swarms_by_id: &swarms_by_id,
                        swarm_event_tx: &swarm_event_tx,
                        await_members_runtime: &await_members_runtime,
                    },
                )
                .await;
            }

            Request::GetProjectActivity { id, session_id } => {
                let caller_sid = session_id.as_deref().unwrap_or(&client_session_id);
                let fallback_dir = activity_fallback_wdir_slot
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let snapshot = super::project_activity::build_snapshot(
                    &activity_ctx,
                    Some(caller_sid),
                    fallback_dir.as_deref(),
                )
                .await;
                let _ = client_event_tx.send(ServerEvent::ProjectActivitySnapshot {
                    id: Some(id),
                    snapshot,
                });
            }

            Request::SubscribeProjectActivity { id, enabled } => {
                activity_subscribed.store(enabled, Ordering::Relaxed);
                if enabled {
                    // Let `run_connection_activity_publisher` emit the single
                    // authoritative initial snapshot so `last_summary` and
                    // `last_snapshot` stay synchronized without double-sending.
                    let _ = activity_trigger_tx.send(true);
                }
                let _ = client_event_tx.send(ServerEvent::Done { id });
            }

            Request::PeekSession { id, target } => {
                peek_handle.set_target(target, activity_ctx.clone(), client_event_tx.clone());
                let _ = client_event_tx.send(ServerEvent::Done { id });
            }

            Request::CancelBackgroundTask { id, task_id } => {
                handle_cancel_background_task(id, task_id, &client_event_tx).await;
                let _ = activity_trigger_tx.send(false);
            }

            // These are handled via channels, not direct requests from TUI
            Request::ClientDebugCommand { id, .. } => {
                handle_client_debug_command(id, &client_event_tx).await;
            }
            Request::ClientDebugResponse { id, output } => {
                handle_client_debug_response(id, output, &client_debug_response_tx);
            }
        }
        if sdk_session_before_request != client_session_id {
            drop(crate::tool::sdk::ConnectionGuard(client_connection_id.clone()));
        }
        if request_lifecycle_logged {
            log_request_lifecycle_handled(
                ServerRequestLifecycleFields {
                    phase: "handled",
                    request_id,
                    request_kind: &request_kind,
                    client_session_id: &client_session_id,
                    client_connection_id: &client_connection_id,
                    client_instance_id: current_client_instance_id.as_deref(),
                    client_is_processing,
                    message_id: processing_message_id,
                    processing_session_id: processing_session_id.as_deref(),
                    line_bytes: line.len(),
                },
                request_lifecycle_start,
                request_decoded_at,
            );
        }
    }

    Ok(())
    }.await;

    drop(_sdk_connection_guard);
    peek_handle.stop();
    activity_publisher_handle.abort();
    // Input prompts belong to this transport and cannot safely be replayed to
    // another client. Unconditionally tear down the stdin forwarder and pending
    // response/attention state on ALL disconnect paths so surviving agents
    // cannot leak the forwarder task or keep stale attention guards alive.
    stdin_active.store(false, Ordering::Release);
    stdin_forwarder.abort();
    if let Err(error) = stdin_forwarder.await
        && !error.is_cancelled()
    {
        crate::logging::warn(&format!("Client stdin forwarder failed: {error}"));
    }
    stdin_responses.lock().await.clear();
    stdin_attention_guards.lock().await.clear();
    question_client.close();
    permission_client.close();

    super::client_disconnect_cleanup::record_transport_closed(
        &client_session_id,
        &client_connection_id,
        &client_connections,
    )
    .await;

    // Release this lifecycle's local strong Arc<Mutex<Agent>> BEFORE
    // cleanup_client_connection acquires and later drops `client_connections`.
    // Otherwise a fast reconnect waking when cleanup releases `connections`
    // observes `Weak::upgrade().is_some()` in `SessionManager::ensure_vacant()`
    // and fails with "Session <id> still has a runtime owner".
    drop(agent);

    // Cleanup serializes the successor decision against live attachment claims.
    // A successor must inherit the active owner, including its completion receiver,
    // rather than just an Agent whose processing task was already aborted.
    let event_handle = if !continue_on_disconnect {
        let retained = crate::hooks::with_client_terminal_env(
            active_terminal_env.clone(),
            cleanup_client_connection(
                &sessions,
                &client_session_id,
                client_is_processing,
                continue_on_disconnect,
                &mut processing_task,
                event_handle,
                &swarm_members,
                &swarms_by_id,
                &swarm_coordinators,
                &swarm_plans,
                &file_touch,
                &channel_subscriptions,
                &channel_subscriptions_by_session,
                &client_debug_state,
                &client_debug_id,
                &client_connections,
                &client_connection_id,
                &shutdown_signals,
                &soft_interrupt_queues,
                &event_history,
                &event_counter,
                &swarm_event_tx,
                &client_event_tx,
                if skip_idle_reconnect_grace {
                    Duration::ZERO
                } else {
                    super::client_disconnect_cleanup::IDLE_RECONNECT_GRACE
                },
            ),
        )
        .await?;
        match retained {
            Some(handle) => handle,
            None => return connection_result,
        }
    } else {
        event_handle
    };

    {
        // Retain the existing turn owner, not the socket. Its JoinHandle and
        // completion receiver stay alive so normal finalization still runs and
        // the daemon cannot idle-shutdown midway through remote work. New
        // attachments receive future events through the existing session fanout.
        detach_client_attachment(
            &client_session_id,
            &client_connection_id,
            &client_debug_id,
            &client_connections,
            &client_debug_state,
            &swarm_members,
        )
        .await;
        event_handle.abort();
        drop(reader);
        drop(writer);
        if let Some(handle) = processing_task.take() {
            crate::logging::info(&format!(
                "Retaining disconnected turn for session {}",
                client_session_id
            ));
            let owner_id = handle.id();
            if let Err(error) = handle.await {
                crate::logging::warn(&format!("Disconnected turn task failed: {error}"));
            }
            while let Ok((done_id, result, report, owner, _finalization)) =
                processing_done_rx.try_recv()
            {
                if Some(done_id) == processing_message_id && owner == owner_id {
                    record_processing_completion(
                        processing_session_id.as_deref(),
                        result,
                        report,
                        &SwarmStatusRefs {
                            members: &swarm_members,
                            swarms_by_id: &swarms_by_id,
                            event_history: &event_history,
                            event_counter: &event_counter,
                            event_tx: &swarm_event_tx,
                        },
                    )
                    .await;
                }
            }
            client_is_processing = false;
        } else {
            // A reattached remote connection may disconnect again while the
            // original lifecycle owns the task. Wait for its active-turn lease
            // before attempting cleanup. Returning early here would leak the
            // session if the original owner had just skipped cleanup for this
            // successor. All finishers serialize cleanup against live attach.
            while crate::turn_cancel_registry::has_active_turn(&client_session_id) {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            client_is_processing = false;
        }
    }

    crate::hooks::with_client_terminal_env(
        active_terminal_env,
        cleanup_client_connection(
            &sessions,
            &client_session_id,
            client_is_processing,
            continue_on_disconnect,
            &mut processing_task,
            event_handle,
            &swarm_members,
            &swarms_by_id,
            &swarm_coordinators,
            &swarm_plans,
            &file_touch,
            &channel_subscriptions,
            &channel_subscriptions_by_session,
            &client_debug_state,
            &client_debug_id,
            &client_connections,
            &client_connection_id,
            &shutdown_signals,
            &soft_interrupt_queues,
            &event_history,
            &event_counter,
            &swarm_event_tx,
            &client_event_tx,
            super::client_disconnect_cleanup::IDLE_RECONNECT_GRACE,
        ),
    )
    .await?;
    connection_result
}

#[path = "client_processing.rs"]
mod client_processing;
use client_processing::{
    append_context_message, cancel_processing_message, cancel_soft_interrupts_by_id,
    clear_soft_interrupts, move_tool_to_background, queue_soft_interrupt,
    reconcile_processing_completions, record_processing_completion, start_processing_message,
    try_available_models_snapshot,
};

/// Process a message and stream events (mpsc channel - per-client)
#[cfg(test)]
pub(super) async fn process_message_streaming_mpsc(
    agent: Arc<Mutex<Agent>>,
    content: &str,
    images: Vec<(String, String)>,
    system_reminder: Option<String>,
    event_tx: tokio::sync::mpsc::UnboundedSender<ServerEvent>,
) -> Result<()> {
    let mut agent = agent.lock().await;
    process_locked_message_streaming_mpsc(&mut agent, content, images, system_reminder, event_tx)
        .await
}

/// Same as [`process_message_streaming_mpsc`] for a caller that already holds
/// the agent lock (e.g. a wake turn that reserved the idle agent up front, see
/// #1152).
#[cfg(test)]
pub(super) async fn process_locked_message_streaming_mpsc(
    agent: &mut Agent,
    content: &str,
    images: Vec<(String, String)>,
    system_reminder: Option<String>,
    event_tx: tokio::sync::mpsc::UnboundedSender<ServerEvent>,
) -> Result<()> {
    let lease = agent.claim_server_turn()?;
    process_reserved_message_streaming_mpsc(
        agent,
        &lease,
        content,
        images,
        system_reminder,
        event_tx,
    )
    .await
}

/// Execute only with this runtime's non-cloneable turn reservation.
pub(super) async fn process_reserved_message_streaming_mpsc(
    agent: &mut Agent,
    lease: &crate::agent::TurnLease,
    content: &str,
    images: Vec<(String, String)>,
    system_reminder: Option<String>,
    event_tx: mpsc::UnboundedSender<ServerEvent>,
) -> Result<()> {
    agent.validate_server_turn(lease)?;
    let session_id = agent.session_id().to_string();
    let result = agent
        .run_reserved_streaming_mpsc(lease, content, images, system_reminder, event_tx, None)
        .await;
    if result.is_ok() {
        crate::runtime_memory_log::emit_event(
            crate::runtime_memory_log::RuntimeMemoryLogEvent::new(
                "turn_completed",
                "message_turn_finished",
            )
            .with_session_id(session_id)
            .force_attribution(),
        );
        crate::process_memory::release_retained_heap_debounced(
            "server_turn_completed",
            std::time::Duration::from_secs(30),
        );
    }
    result
}

#[expect(
    clippy::too_many_arguments,
    reason = "live swarm snapshot merges in-memory swarm maps with durable snapshots"
)]
pub(super) async fn build_live_swarm_snapshot(
    view: &str,
    client_session_id: &str,
    swarm_enabled: bool,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
    swarms_by_id: &Arc<RwLock<HashMap<String, HashSet<String>>>>,
    swarm_coordinators: &Arc<RwLock<HashMap<String, String>>>,
    swarm_plans: &Arc<RwLock<HashMap<String, VersionedPlan>>>,
    event_history: &Arc<RwLock<std::collections::VecDeque<SwarmEvent>>>,
) -> serde_json::Value {
    let snapshots = super::runtime_commands::load_durable_swarm_snapshots_async().await;
    let config_default = crate::config::config().features.swarm;

    let (current_swarm_id, current_role, live_members_by_swarm, all_live_members) = {
        let members = swarm_members.read().await;
        let current = members.get(client_session_id);
        let current_swarm_id = current.and_then(|m| m.swarm_id.clone());
        let current_role = current.map(|m| m.role.clone());

        let mut by_swarm: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        let mut all_members: Vec<serde_json::Value> = Vec::with_capacity(members.len());
        let mut sorted: Vec<&SwarmMember> = members.values().collect();
        sorted.sort_by(|a, b| a.session_id.cmp(&b.session_id));

        for m in sorted {
            let member_json = serde_json::json!({
                "session_id": m.session_id,
                "swarm_id": m.swarm_id,
                "friendly_name": m.friendly_name,
                "role": m.role,
                "status": m.status,
                "detail": m.detail,
                "task_label": m.task_label,
                "working_dir": m.working_dir.as_ref().map(|p| p.display().to_string()),
                "swarm_enabled": m.swarm_enabled,
                "is_headless": m.is_headless,
                "report_back_to_session_id": m.report_back_to_session_id,
                "latest_completion_report": m.latest_completion_report,
                "output_tail": m.output_tail,
                "todo_progress": m.todo_progress,
            });
            if let Some(ref sid) = m.swarm_id {
                by_swarm.entry(sid.clone()).or_default().push(member_json.clone());
            }
            all_members.push(member_json);
        }
        (current_swarm_id, current_role, by_swarm, all_members)
    };

    let coordinators = swarm_coordinators.read().await.clone();
    let live_plans_map: HashMap<String, serde_json::Value> = {
        let plans = swarm_plans.read().await;
        plans
            .iter()
            .map(|(swarm_id, plan)| {
                let mut participants: Vec<&String> = plan.participants.iter().collect();
                participants.sort();
                (
                    swarm_id.clone(),
                    serde_json::json!({
                        "swarm_id": swarm_id,
                        "version": plan.version,
                        "items": plan.items,
                        "participants": participants,
                        "task_progress": plan.task_progress,
                    }),
                )
            })
            .collect()
    };

    // Merge live swarms with durable snapshots keyed by swarm_id.
    let mut swarm_ids: Vec<String> = {
        let mut ids: HashSet<String> = swarms_by_id.read().await.keys().cloned().collect();
        ids.extend(live_members_by_swarm.keys().cloned());
        ids.extend(live_plans_map.keys().cloned());
        for snap in &snapshots {
            if let Some(sid) = snap.get("swarm_id").and_then(serde_json::Value::as_str) {
                ids.insert(sid.to_string());
            }
        }
        ids.into_iter().collect()
    };
    swarm_ids.sort();

    let mut snap_by_id: HashMap<String, serde_json::Value> = HashMap::new();
    for snap in snapshots {
        if let Some(sid) = snap.get("swarm_id").and_then(serde_json::Value::as_str) {
            snap_by_id.insert(sid.to_string(), snap);
        }
    }

    let mut merged_swarms = Vec::with_capacity(swarm_ids.len());
    let mut plans_list: Vec<serde_json::Value> = Vec::new();
    let mut board_events: Vec<serde_json::Value> = Vec::new();

    for sid in &swarm_ids {
        let snap = snap_by_id.get(sid);
        let live_members = live_members_by_swarm.get(sid).cloned();
        let is_live = live_members.as_ref().is_some_and(|v| !v.is_empty());
        let members_val = live_members.unwrap_or_else(|| {
            snap.and_then(|s| s.get("members").and_then(serde_json::Value::as_array))
                .cloned()
                .unwrap_or_default()
        });
        let plan_val = live_plans_map
            .get(sid)
            .cloned()
            .or_else(|| snap.and_then(|s| s.get("plan").cloned()).filter(|v| !v.is_null()));
        if let Some(ref p) = plan_val {
            plans_list.push(p.clone());
        }
        if let Some(snap_board) = snap
            .and_then(|s| s.get("messages").or_else(|| s.get("board")))
            .and_then(serde_json::Value::as_array)
        {
            board_events.extend(snap_board.iter().cloned());
        }
        let coordinator_session_id = coordinators.get(sid).cloned().or_else(|| {
            snap.and_then(|s| {
                s.get("coordinator_session_id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
        });
        let updated_at_unix_ms = snap
            .and_then(|s| s.get("updated_at_unix_ms").and_then(serde_json::Value::as_u64));
        merged_swarms.push(serde_json::json!({
            "swarm_id": sid,
            "coordinator_session_id": coordinator_session_id,
            "members": members_val,
            "plan": plan_val,
            "updated_at_unix_ms": updated_at_unix_ms,
            "live": is_live,
        }));
    }

    // Append live in-memory board events from `event_history` (most recent 200).
    {
        let history = event_history.read().await;
        let filtered: Vec<&SwarmEvent> = history
            .iter()
            .filter(|ev| match (&current_swarm_id, &ev.swarm_id) {
                (Some(cur), Some(ev_sid)) => cur == ev_sid,
                _ => true,
            })
            .collect();
        let start = filtered.len().saturating_sub(200);
        for ev in &filtered[start..] {
            let timestamp_ms = ev
                .absolute_time
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            board_events.push(serde_json::json!({
                "id": ev.id,
                "seq": ev.id,
                "session_id": ev.session_id,
                "session_name": ev.session_name,
                "swarm_id": ev.swarm_id,
                "event": ev.event,
                "timestamp_ms": timestamp_ms,
            }));
        }
    }

    // Active members list: prefer current swarm's members if attached to a swarm,
    // else all live members, else durable snapshot members.
    let members_payload: Vec<serde_json::Value> = if let Some(ref sid) = current_swarm_id
        && let Some(swarm_m) = live_members_by_swarm.get(sid)
    {
        swarm_m.clone()
    } else if !all_live_members.is_empty() {
        all_live_members
    } else {
        merged_swarms
            .iter()
            .flat_map(|s| {
                s.get("members")
                    .and_then(serde_json::Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            })
            .collect()
    };

    serde_json::json!({
        "view": view,
        "enabled": swarm_enabled,
        "config_default": config_default,
        "default_enabled": config_default,
        "swarm_id": current_swarm_id,
        "role": current_role,
        "members": members_payload,
        "swarms": merged_swarms,
        "board": board_events,
        "plans": plans_list,
    })
}

#[cfg(test)]
#[path = "client_lifecycle_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "client_target_attach_tests.rs"]
mod target_attach_tests;

#[cfg(test)]
#[path = "project_activity_socket_tests.rs"]
mod project_activity_socket_tests;

#[cfg(test)]
mod v1_14_socket_tests {
    use super::*;
    use crate::message::{ContentBlock, Message, StreamEvent, ToolDefinition};
    use crate::provider::EventStream;
    use async_trait::async_trait;
    use futures::stream;
    use std::sync::atomic::AtomicUsize;

    #[derive(Clone, Default)]
    struct MidTurnAndSubcallProvider {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl Provider for MidTurnAndSubcallProvider {
        async fn complete(
            &self,
            messages: &[Message],
            tools: &[ToolDefinition],
            _: &str,
            _: Option<&str>,
        ) -> Result<EventStream> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            let events = match call {
                // Round 0: emit a `batch` tool call with a `bash` subcall while the turn holds
                // the Agent mutex. While waiting on the permission response, the test will poll
                // lock-free runtime commands AND switch PermissionMode to Plan mid-turn!
                0 => {
                    assert!(
                        tools.iter().any(|t| t.name == "bash"),
                        "Round 0 in AcceptEdits mode must expose bash"
                    );
                    vec![
                        StreamEvent::ToolUseStart {
                            id: "call:colon:parent".into(),
                            name: "batch".into(),
                        },
                        StreamEvent::ToolInputDelta(
                            r#"{"intent":"subcall check","tool_calls":[{"tool":"bash","intent":"danger","parameters":{"command":"rm -rf ~","intent":"danger"}}]}"#
                                .into(),
                        ),
                        StreamEvent::ToolUseEnd,
                        StreamEvent::MessageEnd {
                            stop_reason: Some("tool_use".into()),
                        },
                    ]
                }
                // Round 1: after mid-turn `SetPermissionMode(Plan)`, `locked_tools` must have been
                // invalidated so `bash`/`edit`/`write` are hidden on the very next model round!
                1 => {
                    assert!(
                        !tools
                            .iter()
                            .any(|t| matches!(t.name.as_str(), "bash" | "edit" | "write")),
                        "Mid-turn SetPermissionMode(Plan) must invalidate locked_tools before next round"
                    );
                    assert!(
                        messages.iter().flat_map(|m| &m.content).any(|block| {
                            matches!(
                                block,
                                ContentBlock::ToolResult { tool_use_id, content, .. }
                                    if tool_use_id == "call:colon:parent"
                                        && content.contains("Denied by user")
                            )
                        }),
                        "batch subcall denial must be returned in tool result"
                    );
                    vec![
                        StreamEvent::TextDelta("subcall gated and mode updated".into()),
                        StreamEvent::MessageEnd {
                            stop_reason: Some("end_turn".into()),
                        },
                    ]
                }
                _ => vec![
                    StreamEvent::TextDelta("done".into()),
                    StreamEvent::MessageEnd {
                        stop_reason: Some("end_turn".into()),
                    },
                ],
            };
            Ok(Box::pin(stream::iter(events.into_iter().map(Ok))))
        }

        fn name(&self) -> &str {
            "v1-14-socket-test"
        }

        fn fork(&self) -> Arc<dyn Provider> {
            Arc::new(self.clone())
        }
    }

    struct TempHomeGuard {
        _dir: tempfile::TempDir,
        prev_home: Option<std::ffi::OsString>,
    }

    impl TempHomeGuard {
        fn new() -> Self {
            let dir = tempfile::TempDir::new().unwrap();
            let prev_home = std::env::var_os("RAYU_HOME");
            crate::env::set_var("RAYU_HOME", dir.path());
            Self {
                _dir: dir,
                prev_home,
            }
        }
    }

    impl Drop for TempHomeGuard {
        fn drop(&mut self) {
            if let Some(val) = &self.prev_home {
                crate::env::set_var("RAYU_HOME", val);
            } else {
                crate::env::remove_var("RAYU_HOME");
            }
        }
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn live_turn_enforces_batch_subcall_risk_tier_allows_lock_free_runtime_commands_and_invalidates_tools_mid_turn()
    {
        use serde_json::json;

        let _lock = crate::storage::lock_test_env();
        let home = TempHomeGuard::new();
        let provider_template: Arc<dyn Provider> = Arc::new(MidTurnAndSubcallProvider::default());
        let sessions: SessionAgents =
            Arc::new(crate::server::SessionManager::from_agents(HashMap::new()));
        let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
        let server_task = tokio::spawn(handle_client(
            server_stream,
            Arc::clone(&sessions),
            broadcast::channel(8).0,
            provider_template,
            Arc::new(RwLock::new(false)),
            Arc::new(RwLock::new(String::new())),
            Arc::new(RwLock::new(0usize)),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            FileTouchService::new(),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(ClientDebugState::default())),
            broadcast::channel(8).0,
            Arc::new(RwLock::new(std::collections::VecDeque::new())),
            Arc::new(std::sync::atomic::AtomicU64::new(0)),
            broadcast::channel(8).0,
            "rayu-test".to_string(),
            "T".to_string(),
            Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            AwaitMembersRuntime::default(),
            SwarmMutationRuntime::default(),
        ));

        let (client_reader, mut client_writer) = client_stream.into_split();
        let mut client_reader = BufReader::new(client_reader);

        async fn send(writer: &mut crate::transport::WriteHalf, value: serde_json::Value) {
            writer
                .write_all(format!("{value}\n").as_bytes())
                .await
                .unwrap();
        }
        async fn until(
            reader: &mut BufReader<crate::transport::ReadHalf>,
            predicate: impl Fn(&ServerEvent) -> bool,
        ) -> ServerEvent {
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let mut line = String::new();
                    assert!(reader.read_line(&mut line).await.unwrap() > 0);
                    let event: ServerEvent = serde_json::from_str(&line).unwrap();
                    if predicate(&event) {
                        return event;
                    }
                }
            })
            .await
            .expect("daemon event timeout")
        }

        // Subscribe with supports_permissions=true and switch to AcceptEdits.
        send(
            &mut client_writer,
            json!({
                "type": "subscribe",
                "id": 1,
                "working_dir": home._dir.path(),
                "supports_permissions": true,
            }),
        )
        .await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Done { id: 1 })).await;

        send(
            &mut client_writer,
            json!({"type": "set_permission_mode", "id": 2, "mode": "accept_edits"}),
        )
        .await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Ack { id: 2 })).await;

        // Start a live turn that executes `batch` -> `bash(rm -rf ~)`.
        send(
            &mut client_writer,
            json!({"type": "message", "id": 3, "content": "run batch"}),
        )
        .await;

        // First prompt is for top-level `batch` (AllowAlways).
        let ServerEvent::PermissionRequest {
            session_id,
            request_id: batch_req_id,
            tool_name: batch_tool_name,
            ..
        } = until(&mut client_reader, |e| {
            matches!(e, ServerEvent::PermissionRequest { .. })
        })
        .await
        else {
            unreachable!();
        };
        assert_eq!(batch_tool_name, "batch");
        send(
            &mut client_writer,
            json!({
                "type": "permission_response",
                "id": 4,
                "session_id": session_id,
                "request_id": batch_req_id,
                "decision": "allow_always",
            }),
        )
        .await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Ack { id: 4 })).await;

        // Even after AllowAlways on `batch` AND across `spawn_session`, the nested `bash`
        // subcall MUST still emit a PermissionRequest with daemon-populated `risk_tier`.
        let ServerEvent::PermissionRequest {
            session_id: sub_sid,
            request_id: bash_req_id,
            tool_name: bash_tool_name,
            risk_tier,
            ..
        } = until(&mut client_reader, |e| {
            matches!(e, ServerEvent::PermissionRequest { .. })
        })
        .await
        else {
            unreachable!();
        };
        assert_eq!(bash_tool_name, "bash");
        assert_eq!(risk_tier.as_deref(), Some("catastrophic"));

        // While the turn STILL holds the Agent mutex waiting for `bash_req_id`:
        // 1. Poll lock-free runtime commands — NONE may fail with "Session is busy"!
        for (req_id, cmd, args) in [
            (10u64, "background", json!(["list"])),
            (11, "swarm", json!(["status"])),
            (12, "swarm", json!(["list"])),
            (13, "swarm", json!(["board"])),
            (14, "features", json!(["status"])),
            (15, "telegram", json!(["status"])),
            (16, "ambient", json!(["status"])),
            (17, "schedules", json!(["list"])),
            (18, "mcp", json!(["list"])),
            (19, "doctor", json!(["auth"])),
            (20, "overnight", json!(["list"])),
            (21, "session_search", json!(["nonexistent_token_xyz"])),
        ] {
            send(
                &mut client_writer,
                json!({
                    "type": "runtime_command",
                    "id": req_id,
                    "command": cmd,
                    "args": args,
                }),
            )
            .await;
            let ev = until(&mut client_reader, |e| {
                matches!(
                    e,
                    ServerEvent::RuntimeCommandResult { id, .. }
                        | ServerEvent::Error { id, .. }
                        if *id == req_id
                )
            })
            .await;
            match ev {
                ServerEvent::RuntimeCommandResult { data, .. } => {
                    assert!(data.is_object(), "{cmd} should return JSON object mid-turn");
                    if cmd == "swarm" {
                        assert!(data.get("members").is_some(), "swarm must expose members");
                        assert!(data.get("swarms").is_some(), "swarm must expose swarms");
                        assert!(data.get("board").is_some(), "swarm must expose board");
                        assert!(data.get("plans").is_some(), "swarm must expose plans");
                    }
                    if cmd == "session_search" {
                        assert!(data.get("matches").is_some(), "session_search must expose matches");
                        assert!(data.get("results").is_some(), "session_search must expose results");
                    }
                }
                ServerEvent::Error { message, .. } => {
                    panic!("lock-free runtime_command `{cmd}` failed mid-turn: {message}");
                }
                _ => unreachable!(),
            }
        }

        // 2. Switch permission mode mid-turn to `plan` (while Agent mutex is held).
        //    Round 1 in `MidTurnAndSubcallProvider` asserts that `locked_tools` was invalidated!
        send(
            &mut client_writer,
            json!({"type": "set_permission_mode", "id": 30, "mode": "plan"}),
        )
        .await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Ack { id: 30 })).await;

        // 3. Deny the pending bash subcall and verify the turn finishes cleanly through Round 1.
        send(
            &mut client_writer,
            json!({
                "type": "permission_response",
                "id": 31,
                "session_id": sub_sid,
                "request_id": bash_req_id,
                "decision": "deny",
            }),
        )
        .await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Ack { id: 31 })).await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Done { id: 3 })).await;

        drop(client_writer);
        drop(client_reader);
        tokio::time::timeout(Duration::from_secs(5), server_task)
            .await
            .expect("server task shutdown")
            .unwrap()
            .unwrap();
    }

    #[derive(Clone, Default)]
    struct FileEditTurnProvider {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl Provider for FileEditTurnProvider {
        async fn complete(
            &self,
            _messages: &[Message],
            _tools: &[ToolDefinition],
            _: &str,
            _: Option<&str>,
        ) -> Result<EventStream> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            let events = match call {
                0 => vec![
                    StreamEvent::ToolUseStart {
                        id: "call_write_1".into(),
                        name: "write".into(),
                    },
                    StreamEvent::ToolInputDelta(
                        r#"{"file_path":"demo.txt","content":"line 1\nline 2\n"}"#.into(),
                    ),
                    StreamEvent::ToolUseEnd,
                    StreamEvent::MessageEnd {
                        stop_reason: Some("tool_use".into()),
                    },
                ],
                _ => vec![
                    StreamEvent::TextDelta("Wrote demo.txt".into()),
                    StreamEvent::MessageEnd {
                        stop_reason: Some("end_turn".into()),
                    },
                ],
            };
            Ok(Box::pin(stream::iter(events.into_iter().map(Ok))))
        }

        fn name(&self) -> &str {
            "file-edit-turn-test"
        }

        fn fork(&self) -> Arc<dyn Provider> {
            Arc::new(self.clone())
        }
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn file_changes_end_to_end_turn_history_diff_action_and_clear() {
        use serde_json::json;

        let _lock = crate::storage::lock_test_env();
        let home = TempHomeGuard::new();
        let ws = tempfile::tempdir().unwrap();
        let provider_template: Arc<dyn Provider> = Arc::new(FileEditTurnProvider::default());
        let sessions: SessionAgents =
            Arc::new(crate::server::SessionManager::from_agents(HashMap::new()));
        let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
        let server_task = tokio::spawn(handle_client(
            server_stream,
            Arc::clone(&sessions),
            broadcast::channel(8).0,
            provider_template,
            Arc::new(RwLock::new(false)),
            Arc::new(RwLock::new(String::new())),
            Arc::new(RwLock::new(0usize)),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            FileTouchService::new(),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(ClientDebugState::default())),
            broadcast::channel(8).0,
            Arc::new(RwLock::new(std::collections::VecDeque::new())),
            Arc::new(std::sync::atomic::AtomicU64::new(0)),
            broadcast::channel(8).0,
            "rayu-test".to_string(),
            "T".to_string(),
            Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            AwaitMembersRuntime::default(),
            SwarmMutationRuntime::default(),
        ));

        let (client_reader, mut client_writer) = client_stream.into_split();
        let mut client_reader = BufReader::new(client_reader);

        async fn send(writer: &mut crate::transport::WriteHalf, value: serde_json::Value) {
            writer
                .write_all(format!("{value}\n").as_bytes())
                .await
                .unwrap();
        }
        async fn until(
            reader: &mut BufReader<crate::transport::ReadHalf>,
            predicate: impl Fn(&ServerEvent) -> bool,
        ) -> ServerEvent {
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let mut line = String::new();
                    assert!(reader.read_line(&mut line).await.unwrap() > 0);
                    let event: ServerEvent = serde_json::from_str(&line).unwrap();
                    if predicate(&event) {
                        return event;
                    }
                }
            })
            .await
            .expect("daemon event timeout")
        }

        // Subscribe in the workspace.
        send(
            &mut client_writer,
            json!({
                "type": "subscribe",
                "id": 1,
                "working_dir": ws.path(),
            }),
        )
        .await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Done { id: 1 })).await;

        // Run a turn that writes demo.txt; expect FileChangesState before Done.
        send(
            &mut client_writer,
            json!({"type": "message", "id": 2, "content": "create demo"}),
        )
        .await;
        let mut saw_file_changes_state = None;
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let mut line = String::new();
                assert!(client_reader.read_line(&mut line).await.unwrap() > 0);
                let event: ServerEvent = serde_json::from_str(&line).unwrap();
                if let ServerEvent::FileChangesState { snapshot } = &event {
                    saw_file_changes_state = Some(snapshot.clone());
                }
                if matches!(event, ServerEvent::Done { id: 2 }) {
                    break;
                }
            }
        })
        .await
        .expect("turn completion timeout");
        let snap = saw_file_changes_state.expect("turn must emit FileChangesState");
        assert_eq!(snap.total_pending_files, 1);
        assert_eq!(snap.total_additions, 2);
        assert_eq!(snap.files[0].display_path, "demo.txt");
        assert!(ws.path().join("demo.txt").exists());

        // GetHistory must hydrate `file_changes`.
        send(&mut client_writer, json!({"type": "get_history", "id": 3})).await;
        let ServerEvent::History { file_changes, .. } = until(&mut client_reader, |e| {
            matches!(e, ServerEvent::History { id: 3, .. })
        })
        .await
        else {
            unreachable!();
        };
        let hydrated = file_changes.expect("History must hydrate non-empty file_changes");
        assert_eq!(hydrated.total_pending_files, 1);
        assert_eq!(hydrated.files[0].display_path, "demo.txt");

        // GetFileChangeDiff returns full content & hunks.
        send(
            &mut client_writer,
            json!({"type": "get_file_change_diff", "id": 4, "path": "demo.txt"}),
        )
        .await;
        let ServerEvent::FileChangeDiff { diff, .. } = until(&mut client_reader, |e| {
            matches!(e, ServerEvent::FileChangeDiff { id: 4, .. })
        })
        .await
        else {
            unreachable!();
        };
        assert_eq!(diff.modified_content, "line 1\nline 2\n");
        assert_eq!(diff.additions, 2);

        // FileChangeAction undo removes the created file and broadcasts updated FileChangesState.
        send(
            &mut client_writer,
            json!({"type": "file_change_action", "id": 5, "action": "undo", "path": "demo.txt"}),
        )
        .await;
        let ServerEvent::FileChangeActionResult { response, .. } = until(&mut client_reader, |e| {
            matches!(e, ServerEvent::FileChangeActionResult { id: 5, .. })
        })
        .await
        else {
            unreachable!();
        };
        assert!(response.ok);
        assert!(!ws.path().join("demo.txt").exists());
        assert_eq!(response.snapshot.total_pending_files, 0);

        // FileChangeAction redo restores the file and returns it to pending.
        send(
            &mut client_writer,
            json!({"type": "file_change_action", "id": 6, "action": "redo", "path": "demo.txt"}),
        )
        .await;
        let ServerEvent::FileChangeActionResult { response, .. } = until(&mut client_reader, |e| {
            matches!(e, ServerEvent::FileChangeActionResult { id: 6, .. })
        })
        .await
        else {
            unreachable!();
        };
        assert!(response.ok);
        assert_eq!(
            std::fs::read_to_string(ws.path().join("demo.txt")).unwrap(),
            "line 1\nline 2\n"
        );
        assert_eq!(response.snapshot.total_pending_files, 1);

        // GetFileChanges returns current snapshot.
        send(&mut client_writer, json!({"type": "get_file_changes", "id": 7})).await;
        let ServerEvent::FileChangesState { snapshot } = until(&mut client_reader, |e| {
            matches!(e, ServerEvent::FileChangesState { .. })
        })
        .await
        else {
            unreachable!();
        };
        assert_eq!(snapshot.total_pending_files, 1);

        // Clear session emits an empty FileChangesState for the fresh session before Done.
        send(&mut client_writer, json!({"type": "clear", "id": 8})).await;
        let mut cleared_snap = None;
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let mut line = String::new();
                assert!(client_reader.read_line(&mut line).await.unwrap() > 0);
                let event: ServerEvent = serde_json::from_str(&line).unwrap();
                if let ServerEvent::FileChangesState { snapshot } = &event
                    && snapshot.is_empty()
                {
                    cleared_snap = Some(snapshot.clone());
                }
                if matches!(event, ServerEvent::Done { id: 8 }) {
                    break;
                }
            }
        })
        .await
        .expect("clear completion timeout");
        let cleared = cleared_snap.expect("clear must emit empty FileChangesState");
        assert!(cleared.is_empty());

        // Persist the cleared session so disconnect cleanup doesn't enter the
        // 30-second unsaved-empty-root reconnect grace period.
        send(&mut client_writer, json!({"type": "persist_session", "id": 9})).await;
        until(&mut client_reader, |e| matches!(e, ServerEvent::Done { id: 9 })).await;

        let _ = home;
        drop(client_writer);
        drop(client_reader);
        tokio::time::timeout(Duration::from_secs(5), server_task)
            .await
            .expect("server task shutdown")
            .unwrap()
            .unwrap();
    }
}
