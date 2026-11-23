use super::{
    ClientConnectionInfo, FileTouchService, SwarmEvent, SwarmEventType, SwarmMember, SwarmState,
    VersionedPlan, broadcast_swarm_plan, persist_swarm_state_for, record_swarm_event,
};
use crate::protocol::{
    AgentStatusSnapshot, NotificationType, PlanGraphStatus, ServerEvent, SessionActivitySnapshot,
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast, mpsc};

use super::SessionAgents;

pub(super) struct CommResyncPlanContext<'a> {
    pub(super) client_event_tx: &'a mpsc::UnboundedSender<ServerEvent>,
    pub(super) swarm_members: &'a Arc<RwLock<HashMap<String, SwarmMember>>>,
    pub(super) swarms_by_id: &'a Arc<RwLock<HashMap<String, HashSet<String>>>>,
    pub(super) swarm_plans: &'a Arc<RwLock<HashMap<String, VersionedPlan>>>,
    pub(super) swarm_coordinators: &'a Arc<RwLock<HashMap<String, String>>>,
    pub(super) event_history: &'a Arc<RwLock<std::collections::VecDeque<SwarmEvent>>>,
    pub(super) event_counter: &'a Arc<std::sync::atomic::AtomicU64>,
    pub(super) swarm_event_tx: &'a broadcast::Sender<SwarmEvent>,
}

fn live_activity_snapshot(
    connections: &HashMap<String, ClientConnectionInfo>,
    session_id: &str,
    fallback_processing: bool,
) -> Option<SessionActivitySnapshot> {
    let mut processing_without_tool = false;
    let mut tool_name = None;
    for info in connections.values() {
        if info.session_id != session_id || !info.is_processing {
            continue;
        }
        if let Some(current_tool_name) = info.current_tool_name.clone() {
            tool_name = Some(current_tool_name);
            break;
        }
        processing_without_tool = true;
    }

    tool_name
        .map(|current_tool_name| SessionActivitySnapshot {
            is_processing: true,
            current_tool_name: Some(current_tool_name),
            active_tool: None,
        })
        .or_else(|| {
            processing_without_tool.then_some(SessionActivitySnapshot {
                is_processing: true,
                current_tool_name: None,
                active_tool: None,
            })
        })
        .or_else(|| {
            fallback_processing.then_some(SessionActivitySnapshot {
                is_processing: true,
                current_tool_name: None,
                active_tool: None,
            })
        })
}

/// Recent-token lookback window used when reporting per-agent churn in
/// `swarm list`. Short enough to reflect "what is this agent doing right now".
pub(super) const SWARM_LIST_TOKEN_WINDOW_SECS: u64 = 10;

/// Runtime extras for a swarm member, gathered without holding the agent lock
/// for long. Used to enrich the `swarm list` roster with live activity,
/// provider/model, token churn, turn count, and todo progress.
#[derive(Default)]
pub(super) struct MemberRuntimeExtras {
    pub(super) activity: Option<SessionActivitySnapshot>,
    pub(super) provider_name: Option<String>,
    pub(super) provider_model: Option<String>,
    pub(super) provider_effort: Option<String>,
    pub(super) turn_count: Option<u64>,
    pub(super) recent_total_tokens: Option<u64>,
    pub(super) recent_output_tokens: Option<u64>,
    pub(super) recent_window_secs: Option<u64>,
    pub(super) cumulative_total_tokens: Option<u64>,
    pub(super) last_activity_age_secs: Option<u64>,
    pub(super) todos_completed: Option<usize>,
    pub(super) todos_total: Option<usize>,
}

/// Gather live runtime extras for a single member session.
///
/// `member_is_running` is used as a fallback "processing" hint when no live
/// client connection is reporting activity (e.g. headless sessions).
pub(super) async fn member_runtime_extras(
    session_id: &str,
    member_is_running: bool,
    sessions: &SessionAgents,
    client_connections: &Arc<RwLock<HashMap<String, ClientConnectionInfo>>>,
) -> MemberRuntimeExtras {
    let activity = {
        let connections = client_connections.read().await;
        live_activity_snapshot(&connections, session_id, member_is_running)
    };

    let (provider_name, provider_model, provider_effort) = {
        let agent_sessions = sessions.read().await;
        if let Some(agent) = agent_sessions.get(session_id) {
            // Never block on a busy agent: token churn and turns come from the
            // lock-free metrics registry, so a missing provider name here just
            // means the agent is mid-turn.
            if let Ok(agent) = agent.try_lock() {
                (
                    Some(agent.provider_name()),
                    Some(agent.provider_model()),
                    agent.provider_reasoning_effort(),
                )
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        }
    };

    let metrics = crate::session_metrics::snapshot(
        session_id,
        std::time::Duration::from_secs(SWARM_LIST_TOKEN_WINDOW_SECS),
    );

    let (todos_completed, todos_total) = match crate::todo::load_todos(session_id) {
        Ok(todos) if !todos.is_empty() => {
            let completed = todos.iter().filter(|t| t.status == "completed").count();
            (Some(completed), Some(todos.len()))
        }
        _ => (None, None),
    };

    MemberRuntimeExtras {
        activity,
        provider_name,
        provider_model,
        provider_effort,
        turn_count: metrics.map(|m| m.turns),
        recent_total_tokens: metrics.map(|m| m.recent_total_tokens),
        recent_output_tokens: metrics.map(|m| m.recent_output_tokens),
        recent_window_secs: metrics.map(|_| SWARM_LIST_TOKEN_WINDOW_SECS),
        cumulative_total_tokens: metrics.map(|m| m.cumulative_total_tokens),
        last_activity_age_secs: metrics.and_then(|m| m.last_activity_age_secs),
        todos_completed,
        todos_total,
    }
}

/// Resolve a target identifier (`session_id` or unique friendly name like `"wolf"`)
/// against a slice of candidate session IDs in the same swarm. Single source of
/// truth shared by DM delivery (`client_comm_message`) and inspection handlers
/// (`handle_comm_summary`, `handle_comm_status`, `handle_comm_read_context`).
pub(super) async fn resolve_swarm_target_session(
    target: &str,
    swarm_session_ids: &[String],
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) -> anyhow::Result<String> {
    if swarm_session_ids
        .iter()
        .any(|session_id| session_id == target)
    {
        return Ok(target.to_string());
    }

    let members = swarm_members.read().await;
    let mut matches: Vec<(String, String)> = swarm_session_ids
        .iter()
        .filter_map(|session_id| {
            let member = members.get(session_id)?;
            member
                .friendly_name
                .as_deref()
                .filter(|friendly_name| *friendly_name == target)
                .map(|friendly_name| (session_id.clone(), friendly_name.to_string()))
        })
        .collect();
    matches.sort_by(|(left_session, _), (right_session, _)| left_session.cmp(right_session));
    matches.dedup_by(|(left_session, _), (right_session, _)| left_session == right_session);
    match matches.len() {
        1 => Ok(matches.remove(0).0),
        0 => Err(anyhow::anyhow!(
            "Unknown target '{}' - use an exact session_id or a unique friendly name within the swarm.",
            target
        )),
        _ => {
            let match_list = matches
                .iter()
                .map(|(session_id, friendly_name)| format!("{} [{}]", friendly_name, session_id))
                .collect::<Vec<_>>()
                .join(", ");
            Err(anyhow::anyhow!(
                "Friendly name '{}' is ambiguous in swarm. Use an exact session id instead. Matches: {}",
                target,
                match_list
            ))
        }
    }
}

async fn resolve_same_swarm_target(
    id: u64,
    req_session_id: &str,
    target_session: &str,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
    client_event_tx: &mpsc::UnboundedSender<ServerEvent>,
) -> Option<String> {
    let (req_swarm, swarm_session_ids) = {
        let members = swarm_members.read().await;
        let req_swarm = members
            .get(req_session_id)
            .and_then(|member| member.swarm_id.clone());
        let ids = match req_swarm.as_deref() {
            Some(swarm_id) => members
                .iter()
                .filter(|(_, member)| member.swarm_id.as_deref() == Some(swarm_id))
                .map(|(session_id, _)| session_id.clone())
                .collect::<Vec<_>>(),
            None => Vec::new(),
        };
        (req_swarm, ids)
    };

    if req_swarm.is_none() {
        let _ = client_event_tx.send(ServerEvent::Error {
            id,
            message: format!(
                "Session '{}' is not in the same swarm as requester '{}'",
                target_session, req_session_id
            ),
            retry_after_secs: None,
        });
        return None;
    }

    match resolve_swarm_target_session(target_session, &swarm_session_ids, swarm_members).await {
        Ok(resolved) => Some(resolved),
        Err(err) => {
            let err_msg = err.to_string();
            let message = if err_msg.contains("ambiguous") {
                err_msg
            } else {
                format!(
                    "Session '{}' is not in the same swarm as requester '{}'",
                    target_session, req_session_id
                )
            };
            let _ = client_event_tx.send(ServerEvent::Error {
                id,
                message,
                retry_after_secs: None,
            });
            None
        }
    }
}

async fn can_read_full_context(
    req_session_id: &str,
    target_session: &str,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) -> bool {
    if req_session_id == target_session {
        return true;
    }

    let members = swarm_members.read().await;
    members
        .get(req_session_id)
        .map(|member| member.role == "coordinator")
        .unwrap_or(false)
}

pub(super) async fn handle_comm_summary(
    id: u64,
    req_session_id: String,
    target_session: String,
    limit: Option<usize>,
    sessions: &SessionAgents,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
    client_event_tx: &mpsc::UnboundedSender<ServerEvent>,
) {
    let Some(target_session) = resolve_same_swarm_target(
        id,
        &req_session_id,
        &target_session,
        swarm_members,
        client_event_tx,
    )
    .await
    else {
        return;
    };

    let limit = limit.unwrap_or(10);
    let agent_sessions = sessions.read().await;
    if let Some(agent) = agent_sessions.get(&target_session) {
        let tool_calls = if let Ok(agent) = agent.try_lock() {
            agent.get_tool_call_summaries(limit)
        } else if let Ok(session) = crate::session::Session::load(&target_session) {
            // Self-summary and in-flight worker summaries always observe the
            // Agent mutex as locked during an active turn; fall back to the
            // persisted session history rather than failing with "busy".
            crate::session::summarize_tool_calls(&session, limit)
        } else if target_session == req_session_id {
            // Fresh session not yet persisted to disk still has no prior tool
            // calls; return empty rather than deadlocking on self.
            Vec::new()
        } else {
            let _ = client_event_tx.send(ServerEvent::Error {
                id,
                message: format!(
                    "Session '{}' is busy; try summary again shortly",
                    target_session
                ),
                retry_after_secs: Some(1),
            });
            return;
        };
        let _ = client_event_tx.send(ServerEvent::CommSummaryResponse {
            id,
            session_id: target_session,
            tool_calls,
        });
    } else if let Ok(session) = crate::session::Session::load(&target_session) {
        let tool_calls = crate::session::summarize_tool_calls(&session, limit);
        let _ = client_event_tx.send(ServerEvent::CommSummaryResponse {
            id,
            session_id: target_session,
            tool_calls,
        });
    } else {
        let _ = client_event_tx.send(ServerEvent::CommSummaryResponse {
            id,
            session_id: target_session,
            tool_calls: Vec::new(),
        });
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "status snapshots combine live connection state, session metadata, files touched, and optional provider/model hints"
)]
pub(super) async fn handle_comm_status(
    id: u64,
    req_session_id: String,
    target_session: String,
    sessions: &SessionAgents,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
    client_connections: &Arc<RwLock<HashMap<String, ClientConnectionInfo>>>,
    file_touch: &FileTouchService,
    client_event_tx: &mpsc::UnboundedSender<ServerEvent>,
) {
    let Some(target_session) = resolve_same_swarm_target(
        id,
        &req_session_id,
        &target_session,
        swarm_members,
        client_event_tx,
    )
    .await
    else {
        return;
    };

    // Release the member guard before taking client_connections: disconnect
    // cleanup holds client_connections.write while waiting on swarm_members.write,
    // so nesting them here wedged every resume and swarm call on the server.
    let member = swarm_members.read().await.get(&target_session).cloned();
    let snapshot = {
        let Some(member) = member else {
            let _ = client_event_tx.send(ServerEvent::Error {
                id,
                message: format!("Unknown session '{target_session}'"),
                retry_after_secs: None,
            });
            return;
        };

        let files_touched = file_touch
            .sorted_file_strings_for_session(&target_session)
            .await;

        let activity = {
            let connections = client_connections.read().await;
            live_activity_snapshot(&connections, &target_session, member.status == "running")
        };

        let (provider_name, provider_model) = {
            let agent_sessions = sessions.read().await;
            if let Some(agent) = agent_sessions.get(&target_session) {
                if let Ok(agent) = agent.try_lock() {
                    (Some(agent.provider_name()), Some(agent.provider_model()))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        };

        AgentStatusSnapshot {
            session_id: member.session_id.clone(),
            friendly_name: member.friendly_name.clone(),
            swarm_id: member.swarm_id.clone(),
            status: Some(member.status.clone()),
            detail: member.detail.clone(),
            role: Some(member.role.clone()),
            is_headless: Some(member.is_headless),
            live_attachments: Some(member.event_txs.len()),
            status_age_secs: Some(member.last_status_change.elapsed().as_secs()),
            last_activity_age_secs: crate::session_metrics::last_activity_age_secs(&target_session),
            stalled_secs: super::swarm_watchdog::stalled_for_secs(&target_session),
            joined_age_secs: Some(member.joined_at.elapsed().as_secs()),
            files_touched,
            activity,
            provider_name,
            provider_model,
        }
    };

    let _ = client_event_tx.send(ServerEvent::CommStatusResponse { id, snapshot });
}

pub(super) async fn handle_comm_read_context(
    id: u64,
    req_session_id: String,
    target_session: String,
    sessions: &SessionAgents,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
    client_event_tx: &mpsc::UnboundedSender<ServerEvent>,
) {
    let Some(target_session) = resolve_same_swarm_target(
        id,
        &req_session_id,
        &target_session,
        swarm_members,
        client_event_tx,
    )
    .await
    else {
        return;
    };

    if !can_read_full_context(&req_session_id, &target_session, swarm_members).await {
        let _ = client_event_tx.send(ServerEvent::Error {
            id,
            message: "Only the coordinator, worktree manager, or the target session may read full context. Use summary for lightweight access.".to_string(),
            retry_after_secs: None,
        });
        return;
    }

    let agent_sessions = sessions.read().await;
    if let Some(agent) = agent_sessions.get(&target_session) {
        let messages = if let Ok(agent) = agent.try_lock() {
            agent.get_history()
        } else if let Ok(session) = crate::session::Session::load(&target_session) {
            crate::agent::Agent::history_messages_from_session(&session)
        } else if target_session == req_session_id {
            Vec::new()
        } else {
            let _ = client_event_tx.send(ServerEvent::Error {
                id,
                message: format!(
                    "Session '{}' is busy; try read_context again shortly",
                    target_session
                ),
                retry_after_secs: Some(1),
            });
            return;
        };
        let _ = client_event_tx.send(ServerEvent::CommContextHistory {
            id,
            session_id: target_session,
            messages,
        });
    } else if let Ok(session) = crate::session::Session::load(&target_session) {
        let messages = crate::agent::Agent::history_messages_from_session(&session);
        let _ = client_event_tx.send(ServerEvent::CommContextHistory {
            id,
            session_id: target_session,
            messages,
        });
    } else {
        let _ = client_event_tx.send(ServerEvent::Error {
            id,
            message: format!("Unknown session '{target_session}'"),
            retry_after_secs: None,
        });
    }
}

pub(super) async fn handle_comm_plan_status(
    id: u64,
    req_session_id: String,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
    swarm_plans: &Arc<RwLock<HashMap<String, VersionedPlan>>>,
    client_event_tx: &mpsc::UnboundedSender<ServerEvent>,
) {
    let swarm_id = {
        let members = swarm_members.read().await;
        members
            .get(&req_session_id)
            .and_then(|member| member.swarm_id.clone())
    };

    let Some(swarm_id) = swarm_id else {
        let _ = client_event_tx.send(ServerEvent::Error {
            id,
            message: "Not in a swarm.".to_string(),
            retry_after_secs: None,
        });
        return;
    };

    let summary = {
        let plans = swarm_plans.read().await;
        let plan = plans.get(&swarm_id);
        if let Some(plan) = plan {
            PlanGraphStatus::from_versioned_plan(swarm_id.clone(), plan, Some(8), Vec::new())
        } else {
            PlanGraphStatus::empty_for_swarm(swarm_id.clone())
        }
    };

    let _ = client_event_tx.send(ServerEvent::CommPlanStatusResponse { id, summary });
}

pub(super) async fn handle_comm_resync_plan(
    id: u64,
    req_session_id: String,
    ctx: &CommResyncPlanContext<'_>,
) {
    let swarm_id = {
        let members = ctx.swarm_members.read().await;
        members
            .get(&req_session_id)
            .and_then(|member| member.swarm_id.clone())
    };

    if let Some(swarm_id) = swarm_id {
        let plan_state = {
            let mut plans = ctx.swarm_plans.write().await;
            plans.get_mut(&swarm_id).map(|plan| {
                plan.participants.insert(req_session_id.clone());
                (plan.version, plan.items.len())
            })
        };
        if let Some((version, item_count)) = plan_state {
            let swarm_state = SwarmState {
                members: Arc::clone(ctx.swarm_members),
                swarms_by_id: Arc::clone(ctx.swarms_by_id),
                plans: Arc::clone(ctx.swarm_plans),
                coordinators: Arc::clone(ctx.swarm_coordinators),
            };
            persist_swarm_state_for(&swarm_id, &swarm_state).await;
            if let Some(member) = ctx.swarm_members.read().await.get(&req_session_id) {
                let _ = member.event_tx.send(ServerEvent::Notification {
                    from_session: req_session_id.clone(),
                    from_name: member.friendly_name.clone(),
                    notification_type: NotificationType::Message {
                        scope: Some("plan".to_string()),
                        channel: None,
                        tldr: None,
                    },
                    message: format!(
                        "Plan attached to this session (v{}, {} items).",
                        version, item_count
                    ),
                });
            }
            broadcast_swarm_plan(
                &swarm_id,
                Some("resync".to_string()),
                ctx.swarm_plans,
                ctx.swarm_members,
                ctx.swarms_by_id,
            )
            .await;
            record_swarm_event(
                ctx.event_history,
                ctx.event_counter,
                ctx.swarm_event_tx,
                req_session_id.clone(),
                None,
                Some(swarm_id.clone()),
                SwarmEventType::PlanUpdate {
                    swarm_id: swarm_id.clone(),
                    item_count,
                },
            )
            .await;
            let _ = ctx.client_event_tx.send(ServerEvent::Done { id });
        } else {
            let _ = ctx.client_event_tx.send(ServerEvent::Error {
                id,
                message: "No swarm plan exists for this swarm.".to_string(),
                retry_after_secs: None,
            });
        }
    } else {
        let _ = ctx.client_event_tx.send(ServerEvent::Error {
            id,
            message: "Not in a swarm.".to_string(),
            retry_after_secs: None,
        });
    }
}
