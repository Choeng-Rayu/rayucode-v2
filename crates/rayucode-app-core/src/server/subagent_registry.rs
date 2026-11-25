//! Registry for active and recently finished in-process subagents.
//!
//! Tracks `subagent`/`task` tool executions (both manual `/subagent` requests
//! and model-invoked tool calls) plus `BusEvent::SubagentStatus` updates for
//! `/review`, `/judge`, and explore subagents. Completed/failed entries are
//! retained for 60 seconds so fast subagent runs remain visible in the Project
//! Activity Dashboard.

use crate::bus::{SubagentStatus, ToolEvent, ToolStatus};
use crate::protocol::{SubagentActivityItem, SwarmLiveStatus};
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, RwLock as StdRwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub(crate) const TERMINAL_RETENTION: Duration = Duration::from_secs(60);
/// Bus-only child session entries (not owned by a `SubagentGuard` or `ToolEvent`)
/// expire out of `"running"` if no `SubagentStatus` update arrives for this long.
pub(crate) const BUS_ONLY_STALE_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
struct SubagentEntry {
    item: SubagentActivityItem,
    started_at: Instant,
    last_seen_at: Instant,
    finished_at: Option<Instant>,
    bus_only: bool,
}

static REGISTRY: LazyLock<StdRwLock<HashMap<String, SubagentEntry>>> =
    LazyLock::new(|| StdRwLock::new(HashMap::new()));
static CHANGED: LazyLock<tokio::sync::watch::Sender<u64>> =
    LazyLock::new(|| tokio::sync::watch::channel(0).0);

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn notify_changed() {
    CHANGED.send_modify(|generation| *generation = generation.wrapping_add(1));
}

pub(crate) fn subscribe_changes() -> tokio::sync::watch::Receiver<u64> {
    CHANGED.subscribe()
}

/// RAII handle for an active subagent run. Call [`Self::finish`] on normal
/// completion or failure; dropping without calling `finish` marks the entry as
/// `"stopped"` and starts the 60s retention window.
#[derive(Debug)]
pub(crate) struct SubagentGuard {
    subagent_id: String,
    finished: bool,
}

impl SubagentGuard {
    pub(crate) fn finish(mut self, status: &str) {
        self.finished = true;
        finish_at(&self.subagent_id, status, Instant::now());
    }
}

impl Drop for SubagentGuard {
    fn drop(&mut self) {
        if !self.finished {
            self.finished = true;
            finish_at(&self.subagent_id, "stopped", Instant::now());
        }
    }
}

/// Register an active subagent and return an RAII cleanup guard.
pub(crate) fn register(
    subagent_id: impl Into<String>,
    parent_session_id: impl Into<String>,
    kind: impl Into<String>,
    label: impl Into<String>,
    role: impl Into<String>,
) -> SubagentGuard {
    let subagent_id = subagent_id.into();
    register_entry_at(
        subagent_id.clone(),
        parent_session_id.into(),
        kind.into(),
        label.into(),
        role.into(),
        Instant::now(),
    );
    SubagentGuard {
        subagent_id,
        finished: false,
    }
}

fn prune_locked(map: &mut HashMap<String, SubagentEntry>, now: Instant) -> bool {
    let mut changed = false;
    for entry in map.values_mut() {
        if entry.bus_only
            && entry.finished_at.is_none()
            && now.saturating_duration_since(entry.last_seen_at) > BUS_ONLY_STALE_TTL
        {
            let done_at = entry.last_seen_at + BUS_ONLY_STALE_TTL;
            entry.finished_at = Some(done_at);
            entry.item.status = "completed".to_string();
            if let Some(live) = entry.item.live_status.as_mut() {
                live.phase = "completed".to_string();
                live.tool_name = None;
                live.tool_intent = None;
                live.elapsed_ms = done_at
                    .saturating_duration_since(entry.started_at)
                    .as_millis()
                    .min(u64::MAX as u128) as u64;
            }
            changed = true;
        }
    }
    let before = map.len();
    map.retain(|_, entry| {
        entry
            .finished_at
            .is_none_or(|done| now.saturating_duration_since(done) <= TERMINAL_RETENTION)
    });
    changed || map.len() != before
}

fn register_entry_at(
    subagent_id: String,
    parent_session_id: String,
    kind: String,
    label: String,
    role: String,
    now: Instant,
) {
    let item = SubagentActivityItem {
        subagent_id: subagent_id.clone(),
        parent_session_id,
        kind,
        label,
        role,
        status: "running".to_string(),
        live_status: Some(SwarmLiveStatus {
            phase: "sending".to_string(),
            ..Default::default()
        }),
        started_at_ms: now_epoch_ms(),
    };
    {
        let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
        prune_locked(&mut map, now);
        map.insert(
            subagent_id,
            SubagentEntry {
                item,
                started_at: now,
                last_seen_at: now,
                finished_at: None,
                bus_only: false,
            },
        );
    }
    notify_changed();
}

/// Mark a subagent entry terminal (`completed` / `failed` / `stopped`) and begin
/// its 60-second visibility retention window.
pub(crate) fn finish(subagent_id: &str, status: &str) {
    finish_at(subagent_id, status, Instant::now());
}

/// Mark any bus-only subagent entries owned by `parent_session_id` as terminal
/// when the parent turn finishes so they do not stay `"running"` until TTL.
pub(crate) fn finish_bus_only_for_parent(parent_session_id: &str, status: &str) {
    finish_bus_only_for_parent_at(parent_session_id, status, Instant::now());
}

fn finish_bus_only_for_parent_at(parent_session_id: &str, status: &str, now: Instant) {
    let terminal_status = match status {
        "failed" | "crashed" => "failed",
        "stopped" | "cancelled" => "stopped",
        _ => "completed",
    };
    let changed = {
        let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
        let mut updated = prune_locked(&mut map, now);
        for entry in map.values_mut() {
            if entry.bus_only
                && entry.finished_at.is_none()
                && entry.item.parent_session_id == parent_session_id
            {
                entry.finished_at = Some(now);
                entry.item.status = terminal_status.to_string();
                if let Some(live) = entry.item.live_status.as_mut() {
                    live.phase = terminal_status.to_string();
                    live.tool_name = None;
                    live.tool_intent = None;
                    live.elapsed_ms = now
                        .saturating_duration_since(entry.started_at)
                        .as_millis()
                        .min(u64::MAX as u128) as u64;
                }
                updated = true;
            }
        }
        updated
    };
    if changed {
        notify_changed();
    }
}

fn finish_at(subagent_id: &str, status: &str, now: Instant) {
    let changed = {
        let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
        let pruned = prune_locked(&mut map, now);
        if let Some(entry) = map.get_mut(subagent_id) {
            entry.item.status = status.to_string();
            entry.finished_at.get_or_insert(now);
            if let Some(live) = entry.item.live_status.as_mut() {
                live.phase = status.to_string();
                live.tool_name = None;
                live.tool_intent = None;
                live.elapsed_ms = now
                    .saturating_duration_since(entry.started_at)
                    .as_millis()
                    .min(u64::MAX as u128) as u64;
            }
            true
        } else {
            pruned
        }
    };
    if changed {
        notify_changed();
    }
}

fn subagent_kind_for_tool(tool_name: &str) -> Option<&'static str> {
    let lower = tool_name.to_ascii_lowercase();
    match lower.as_str() {
        "subagent" | "task" | "task_runner" => Some("subagent"),
        "review" | "autoreview" => Some("review"),
        "judge" | "autojudge" => Some("judge"),
        _ => None,
    }
}

/// Track model-invoked `subagent`/`task`/`review`/`judge` tool calls observed on
/// the server bus so they surface even outside `handle_run_subagent`.
pub(crate) fn observe_tool_event(event: &ToolEvent) {
    let Some(kind) = subagent_kind_for_tool(&event.tool_name) else {
        return;
    };
    match event.status {
        ToolStatus::Running => {
            let label = event
                .intent
                .as_deref()
                .or(event.title.as_deref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(&event.tool_name)
                .to_string();
            let now = Instant::now();
            let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
            prune_locked(&mut map, now);
            if let Some(existing) = map.get_mut(&event.tool_call_id) {
                if !label.is_empty() && existing.item.label.is_empty() {
                    existing.item.label = label;
                }
                existing.item.status = "running".to_string();
                existing.last_seen_at = now;
                existing.finished_at = None;
                existing.bus_only = false;
            } else {
                map.insert(
                    event.tool_call_id.clone(),
                    SubagentEntry {
                        item: SubagentActivityItem {
                            subagent_id: event.tool_call_id.clone(),
                            parent_session_id: event.session_id.clone(),
                            kind: kind.to_string(),
                            label,
                            role: kind.to_string(),
                            status: "running".to_string(),
                            live_status: Some(SwarmLiveStatus {
                                phase: "running_tool".to_string(),
                                ..Default::default()
                            }),
                            started_at_ms: now_epoch_ms(),
                        },
                        started_at: now,
                        last_seen_at: now,
                        finished_at: None,
                        bus_only: false,
                    },
                );
            }
            drop(map);
            notify_changed();
        }
        ToolStatus::Completed => finish(&event.tool_call_id, "completed"),
        ToolStatus::Error => finish(&event.tool_call_id, "failed"),
    }
}

fn parse_live_status(status_text: &str, started_at: Instant, now: Instant) -> SwarmLiveStatus {
    let trimmed = status_text.trim();
    let (phase, tool_name) = if let Some(tool) = trimmed.strip_prefix("running ") {
        ("running_tool".to_string(), Some(tool.trim().to_string()))
    } else if trimmed.eq_ignore_ascii_case("streaming") {
        ("streaming".to_string(), None)
    } else if trimmed.eq_ignore_ascii_case("calling api") {
        ("sending".to_string(), None)
    } else if trimmed.eq_ignore_ascii_case("thinking") {
        ("thinking".to_string(), None)
    } else {
        ("running".to_string(), None)
    };
    SwarmLiveStatus {
        phase,
        tool_name,
        status_detail: (!trimmed.is_empty()).then(|| trimmed.to_string()),
        elapsed_ms: now
            .saturating_duration_since(started_at)
            .as_millis()
            .min(u64::MAX as u128) as u64,
        ..Default::default()
    }
}

/// Apply a `BusEvent::SubagentStatus` update.
///
/// Updates a registered subagent matching `event.session_id`, or if the session
/// is an ephemeral in-process child session (not in `known_member_sessions`)
/// whose startup stub carries a `parent_id`, updates or records its entry under
/// that parent session.
pub(crate) fn observe_bus_subagent_status(
    event: &SubagentStatus,
    known_member_sessions: &HashSet<String>,
) {
    observe_bus_subagent_status_at(event, known_member_sessions, Instant::now());
}

fn observe_bus_subagent_status_at(
    event: &SubagentStatus,
    known_member_sessions: &HashSet<String>,
    now: Instant,
) {
    {
        let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
        prune_locked(&mut map, now);
        if let Some(entry) = map.get_mut(&event.session_id) {
            entry.last_seen_at = now;
            if entry.bus_only {
                entry.finished_at = None;
                entry.item.status = "running".to_string();
            } else if entry.finished_at.is_none() {
                entry.item.status = "running".to_string();
            }
            entry.item.live_status = Some(parse_live_status(&event.status, entry.started_at, now));
            drop(map);
            notify_changed();
            return;
        }
    }

    // Do not misclassify normal top-level swarm sessions as ephemeral subagents.
    if known_member_sessions.contains(&event.session_id) {
        return;
    }

    let sid_for_io = event.session_id.clone();
    let Ok(stub) =
        super::run_blocking_io(move || crate::session::Session::load_startup_stub(&sid_for_io))
    else {
        return;
    };
    let Some(parent_id) = stub.parent_id.filter(|id| !id.trim().is_empty()) else {
        return;
    };

    let title = stub
        .title
        .clone()
        .filter(|t| !t.trim().is_empty())
        .or_else(|| stub.short_name.clone())
        .unwrap_or_else(|| event.session_id[..8.min(event.session_id.len())].to_string());
    let lower_title = title.to_ascii_lowercase();
    let kind = if lower_title.contains("review") {
        "review"
    } else if lower_title.contains("judge") {
        "judge"
    } else {
        "subagent"
    };

    record_bus_only_subagent_at(
        &event.session_id,
        parent_id,
        kind,
        title,
        &event.status,
        now,
    );
}

fn record_bus_only_subagent_at(
    session_id: &str,
    parent_id: String,
    kind: &str,
    title: String,
    status_text: &str,
    now: Instant,
) {
    {
        let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
        prune_locked(&mut map, now);
        // If the parent already has a single active registered subagent whose id
        // is a tool-call id, keep its live_status fresh rather than duplicating.
        let active_for_parent: Vec<String> = map
            .iter()
            .filter(|(_, entry)| {
                entry.item.parent_session_id == parent_id
                    && entry.finished_at.is_none()
                    && !entry.bus_only
                    && entry.item.subagent_id != session_id
            })
            .map(|(id, _)| id.clone())
            .collect();
        if active_for_parent.len() == 1
            && let Some(entry) = map.get_mut(&active_for_parent[0])
        {
            entry.last_seen_at = now;
            entry.item.live_status = Some(parse_live_status(status_text, entry.started_at, now));
            drop(map);
            notify_changed();
            return;
        }

        let entry = map
            .entry(session_id.to_string())
            .or_insert_with(|| SubagentEntry {
                item: SubagentActivityItem {
                    subagent_id: session_id.to_string(),
                    parent_session_id: parent_id,
                    kind: kind.to_string(),
                    label: title,
                    role: kind.to_string(),
                    status: "running".to_string(),
                    live_status: None,
                    started_at_ms: now_epoch_ms(),
                },
                started_at: now,
                last_seen_at: now,
                finished_at: None,
                bus_only: true,
            });
        entry.last_seen_at = now;
        entry.finished_at = None;
        entry.item.status = "running".to_string();
        entry.item.live_status = Some(parse_live_status(status_text, entry.started_at, now));
    }
    notify_changed();
}

/// Return active and retained-terminal subagents whose parent belongs to
/// `parent_session_ids`, pruning entries past the 60s retention window.
pub(crate) fn list_for_parents(parent_session_ids: &HashSet<String>) -> Vec<SubagentActivityItem> {
    list_for_parents_at(parent_session_ids, Instant::now())
}

fn list_for_parents_at(
    parent_session_ids: &HashSet<String>,
    now: Instant,
) -> Vec<SubagentActivityItem> {
    let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
    let _ = prune_locked(&mut map, now);

    let mut items: Vec<SubagentActivityItem> = map
        .values()
        .filter(|entry| parent_session_ids.contains(&entry.item.parent_session_id))
        .map(|entry| {
            let mut item = entry.item.clone();
            if let Some(live) = item.live_status.as_mut() {
                let end = entry.finished_at.unwrap_or(now);
                live.elapsed_ms = end
                    .saturating_duration_since(entry.started_at)
                    .as_millis()
                    .min(u64::MAX as u128) as u64;
            }
            item
        })
        .collect();
    items.sort_by(|a, b| {
        let a_active = a.status == "running";
        let b_active = b.status == "running";
        b_active
            .cmp(&a_active)
            .then_with(|| b.started_at_ms.cmp(&a.started_at_ms))
            .then_with(|| a.subagent_id.cmp(&b.subagent_id))
    });
    items
}

#[cfg(test)]
pub(crate) fn clear_for_tests(subagent_id: &str) {
    let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
    if map.remove(subagent_id).is_some() {
        drop(map);
        notify_changed();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subagent_registration_retains_terminal_entries_for_60s_then_prunes() {
        let parent = "subagent-parent-test".to_string();
        let id = "subagent-retention-test".to_string();
        clear_for_tests(&id);

        let t0 = Instant::now();
        register_entry_at(
            id.clone(),
            parent.clone(),
            "subagent".into(),
            "grep oauth".into(),
            "explore".into(),
            t0,
        );

        let parents = HashSet::from([parent.clone()]);
        let active = list_for_parents_at(&parents, t0 + Duration::from_secs(2));
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].status, "running");
        assert_eq!(active[0].role, "explore");
        assert_eq!(active[0].live_status.as_ref().unwrap().elapsed_ms, 2000);

        let t_done = t0 + Duration::from_secs(5);
        finish_at(&id, "completed", t_done);

        // Still visible 30s after completion.
        let retained = list_for_parents_at(&parents, t_done + Duration::from_secs(30));
        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].status, "completed");
        assert_eq!(retained[0].live_status.as_ref().unwrap().elapsed_ms, 5000);

        // Pruned once strictly past 60s retention.
        let expired = list_for_parents_at(&parents, t_done + Duration::from_secs(61));
        assert!(expired.is_empty());
    }

    #[test]
    fn subagent_guard_drop_marks_stopped_and_retains() {
        let parent = "subagent-drop-parent".to_string();
        let id = "subagent-drop-id".to_string();
        clear_for_tests(&id);

        let guard = register(
            id.clone(),
            parent.clone(),
            "review",
            "review diff",
            "reviewer",
        );
        let parents = HashSet::from([parent]);
        assert_eq!(list_for_parents(&parents)[0].status, "running");

        drop(guard);
        let after = list_for_parents(&parents);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].status, "stopped");
        clear_for_tests(&id);
    }

    #[test]
    fn bus_only_subagent_entries_expire_after_staleness_ttl_and_finish_on_parent_done() {
        let parent = "subagent-bus-only-parent".to_string();
        let child_ttl = "subagent-bus-only-ttl".to_string();
        let child_parent_done = "subagent-bus-only-parent-done".to_string();
        clear_for_tests(&child_ttl);
        clear_for_tests(&child_parent_done);

        let t0 = Instant::now();
        record_bus_only_subagent_at(
            &child_ttl,
            parent.clone(),
            "subagent",
            "explore child".into(),
            "calling API",
            t0,
        );
        let parents = HashSet::from([parent.clone()]);

        // Active right after update.
        let active = list_for_parents_at(&parents, t0 + Duration::from_secs(10));
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].status, "running");

        // Heartbeat extends last_seen_at so it stays running at t0 + 70s.
        let t_hb = t0 + Duration::from_secs(40);
        record_bus_only_subagent_at(
            &child_ttl,
            parent.clone(),
            "subagent",
            "explore child".into(),
            "running grep",
            t_hb,
        );
        let still_active = list_for_parents_at(&parents, t_hb + Duration::from_secs(30));
        assert_eq!(still_active.len(), 1);
        assert_eq!(still_active[0].status, "running");

        // Strictly past BUS_ONLY_STALE_TTL after last heartbeat -> transitions out
        // of "running" (no longer inflates active_agents) and enters retention.
        let stale = list_for_parents_at(
            &parents,
            t_hb + BUS_ONLY_STALE_TTL + Duration::from_secs(5),
        );
        assert_eq!(stale.len(), 1);
        assert_eq!(stale[0].status, "completed");

        // Past BUS_ONLY_STALE_TTL + TERMINAL_RETENTION -> pruned completely.
        let pruned = list_for_parents_at(
            &parents,
            t_hb + BUS_ONLY_STALE_TTL + TERMINAL_RETENTION + Duration::from_secs(1),
        );
        assert!(pruned.is_empty());

        // Parent turn completion immediately finishes active bus-only children.
        let t2 = t_hb + BUS_ONLY_STALE_TTL + TERMINAL_RETENTION + Duration::from_secs(2);
        record_bus_only_subagent_at(
            &child_parent_done,
            parent.clone(),
            "review",
            "review child".into(),
            "streaming",
            t2,
        );
        assert_eq!(list_for_parents_at(&parents, t2)[0].status, "running");
        finish_bus_only_for_parent_at(&parent, "ready", t2 + Duration::from_secs(2));
        let finished = list_for_parents_at(&parents, t2 + Duration::from_secs(3));
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].status, "completed");

        clear_for_tests(&child_ttl);
        clear_for_tests(&child_parent_done);
    }

    #[test]
    fn write_path_pruning_caps_expired_terminal_and_stale_bus_only_entries() {
        let parent = "subagent-write-prune-parent".to_string();
        let old_term = "subagent-write-prune-old-term".to_string();
        let old_bus = "subagent-write-prune-old-bus".to_string();
        let fresh_id = "subagent-write-prune-fresh".to_string();
        clear_for_tests(&old_term);
        clear_for_tests(&old_bus);
        clear_for_tests(&fresh_id);

        let t0 = Instant::now();
        register_entry_at(
            old_term.clone(),
            parent.clone(),
            "subagent".into(),
            "old terminal".into(),
            "explore".into(),
            t0,
        );
        finish_at(&old_term, "completed", t0 + Duration::from_secs(1));
        record_bus_only_subagent_at(
            &old_bus,
            parent.clone(),
            "subagent",
            "old bus".into(),
            "calling API",
            t0,
        );

        // Perform a write well after both entries have expired, WITHOUT ever
        // calling `list_for_parents` (headless daemon scenario).
        let t_later = t0 + BUS_ONLY_STALE_TTL + TERMINAL_RETENTION + Duration::from_secs(10);
        register_entry_at(
            fresh_id.clone(),
            parent.clone(),
            "subagent".into(),
            "fresh".into(),
            "explore".into(),
            t_later,
        );

        let map = REGISTRY.read().unwrap_or_else(|e| e.into_inner());
        assert!(
            !map.contains_key(&old_term),
            "write path must prune expired terminal entries"
        );
        assert!(
            !map.contains_key(&old_bus),
            "write path must prune expired stale bus-only entries"
        );
        assert!(map.contains_key(&fresh_id));
        drop(map);

        clear_for_tests(&fresh_id);
    }
}
