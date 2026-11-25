//! Project Activity Dashboard state, tree construction, live-peek debouncing,
//! key handling, and slash-command entry points.

use std::cell::Cell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyModifiers, MouseEvent, MouseEventKind};
use crate::protocol::{
    AgentAttentionKind, AutonomousRunnerItem, AutonomousRunnerKind, BackgroundTaskActivityItem,
    PeekTarget, ProjectActivitySnapshot, ProjectActivitySummary, SessionPeekPayload,
    SubagentActivityItem, SwarmMemberStatus, SwarmPlanSummary,
};
use rayucode_tui_render::activity_dashboard::{
    ActivityDashboardLayoutMetrics, ActivityDashboardRow, ActivityRowKind, ActivitySection,
    ActivityTab, DashboardInlinePrompt, count_peek_wrapped_lines,
};
use rayucode_tui_render::agent_activity::format_agent_live_activity;

use super::{App, DisplayMessage, ProcessingStatus};

/// Debounce interval for `PeekSession` requests while navigating the tree.
pub(crate) const PEEK_DEBOUNCE_DURATION: Duration = Duration::from_millis(120);

/// Target of a destructive stop/cancel confirmation prompt (`x`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DashboardStopTarget {
    SwarmWorker { session_id: String },
    BackgroundTask { task_id: String },
}

/// Active inline 1-line prompt in the dashboard's bottom action bar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DashboardInlineAction {
    Filter,
    DmInput {
        target_session_id: String,
        target_swarm: Option<String>,
        target_label: String,
        buffer: String,
    },
    ConfirmStop {
        target: DashboardStopTarget,
        label: String,
    },
}

/// Outbound remote control actions queued synchronously by UI key handlers and
/// drained asynchronously by the remote event loop (`app/remote.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DashboardRemoteAction {
    Subscribe(bool),
    GetSnapshot {
        session_id: Option<String>,
    },
    Peek(Option<PeekTarget>),
    SwitchSession {
        target_session_id: String,
        allow_takeover: bool,
    },
    CommMessage {
        from_session: String,
        to_session: String,
        to_swarm: Option<String>,
        message: String,
    },
    CommStop {
        session_id: String,
        target_session_id: String,
        label: String,
    },
    CommTaskControlRetry {
        session_id: String,
        task_id: String,
    },
    CancelBackgroundTask {
        task_id: String,
    },
}

/// Owned snapshot passed across `TuiState` to `ui.rs` so rendering borrows
/// cleanly without mutating `App`.
#[derive(Debug, Clone)]
pub struct ActivityDashboardRenderData {
    pub project_name: String,
    pub branch: Option<String>,
    pub summary: ProjectActivitySummary,
    pub plan_summary: Option<SwarmPlanSummary>,
    pub active_tab: ActivityTab,
    pub tab_counts: [usize; 5],
    pub filter_query: String,
    pub rows: Vec<ActivityDashboardRow>,
    pub selected_index: usize,
    pub tree_scroll: usize,
    pub peek: Option<SessionPeekPayload>,
    pub peek_follow: bool,
    pub peek_scroll: usize,
    pub has_return_session: bool,
    pub inline_prompt: Option<DashboardInlinePrompt>,
    pub status_banner: Option<String>,
}

/// Encapsulated state for the full-screen Project Activity Dashboard on `App`.
#[derive(Debug, Clone)]
pub(crate) struct ActivityDashboardState {
    pub open: bool,
    pub active_tab: ActivityTab,
    pub filter_query: String,
    pub filter_editing: bool,
    pub selected_index: usize,
    pub tree_scroll: usize,
    pub collapsed_sections: HashSet<ActivitySection>,
    pub summary: ProjectActivitySummary,
    pub snapshot: Option<ProjectActivitySnapshot>,
    pub peek: Option<SessionPeekPayload>,
    pub peek_follow: bool,
    pub peek_scroll: usize,
    pub peek_target_sent: Option<PeekTarget>,
    pub peek_pending_target: Option<PeekTarget>,
    pub peek_debounce_until: Option<Instant>,
    pub inline_action: Option<DashboardInlineAction>,
    pub status_banner: Option<String>,
    pub pending_actions: VecDeque<DashboardRemoteAction>,
    pub pending_control_ids: HashSet<u64>,
    pub pending_control_done_notices: HashMap<u64, String>,
    pub retired_control_done_ids: VecDeque<u64>,
    pub layout_metrics: Cell<ActivityDashboardLayoutMetrics>,
}

impl Default for ActivityDashboardState {
    fn default() -> Self {
        Self {
            open: false,
            active_tab: ActivityTab::All,
            filter_query: String::new(),
            filter_editing: false,
            selected_index: 0,
            tree_scroll: 0,
            collapsed_sections: HashSet::new(),
            summary: ProjectActivitySummary::default(),
            snapshot: None,
            peek: None,
            peek_follow: true,
            peek_scroll: 0,
            peek_target_sent: None,
            peek_pending_target: None,
            peek_debounce_until: None,
            inline_action: None,
            status_banner: None,
            pending_actions: VecDeque::new(),
            pending_control_ids: HashSet::new(),
            pending_control_done_notices: HashMap::new(),
            retired_control_done_ids: VecDeque::new(),
            layout_metrics: Cell::new(ActivityDashboardLayoutMetrics::default()),
        }
    }
}

impl ActivityDashboardState {
    pub(crate) fn consume_retired_control_done_id(&mut self, id: u64) -> bool {
        if let Some(pos) = self.retired_control_done_ids.iter().position(|&v| v == id) {
            self.retired_control_done_ids.remove(pos);
            return true;
        }
        false
    }

    /// Update the lightweight footer badge summary from a server push.
    /// Returns `true` when the summary changed and warrants a redraw.
    pub(crate) fn apply_summary(&mut self, summary: ProjectActivitySummary) -> bool {
        if self.summary == summary {
            return false;
        }
        self.summary = summary;
        true
    }

    /// Update the full project snapshot from a server push.
    pub(crate) fn apply_snapshot(&mut self, snapshot: ProjectActivitySnapshot) {
        self.summary = snapshot.summary.clone();
        self.snapshot = Some(snapshot);
    }

    /// Apply a live peek payload from the server, dropping stale responses for
    /// targets that are no longer selected.
    pub(crate) fn apply_peek(&mut self, payload: SessionPeekPayload) -> bool {
        if let Some(expected) = self.peek_target_sent.as_ref()
            && expected != &payload.target
        {
            return false;
        }
        if self.peek_follow {
            let metrics = self.layout_metrics.get();
            let visual_lines = if metrics.peek_area.width > 0 {
                count_peek_wrapped_lines(&payload.output_lines, usize::from(metrics.peek_area.width))
            } else {
                payload.output_lines.len()
            };
            self.peek_scroll = visual_lines.saturating_sub(metrics.peek_tail_height);
        }
        self.peek = Some(payload);
        true
    }

    /// Flush any debounced `PeekSession` request whose deadline has elapsed.
    pub(crate) fn flush_debounced_peek(&mut self, now: Instant) -> bool {
        let Some(deadline) = self.peek_debounce_until else {
            return false;
        };
        if now < deadline {
            return false;
        }
        self.peek_debounce_until = None;
        let next = self.peek_pending_target.take();
        if next != self.peek_target_sent {
            self.peek_target_sent = next.clone();
            if self.peek.as_ref().map(|p| &p.target) != next.as_ref() {
                self.peek = None;
            }
            self.pending_actions
                .push_back(DashboardRemoteAction::Peek(next));
            return true;
        }
        false
    }

    fn inline_prompt(&self) -> Option<DashboardInlinePrompt> {
        match self.inline_action.as_ref()? {
            DashboardInlineAction::Filter => Some(DashboardInlinePrompt::Filter {
                query: self.filter_query.clone(),
            }),
            DashboardInlineAction::DmInput {
                target_label,
                buffer,
                ..
            } => Some(DashboardInlinePrompt::Dm {
                target_label: target_label.clone(),
                buffer: buffer.clone(),
            }),
            DashboardInlineAction::ConfirmStop { label, .. } => {
                Some(DashboardInlinePrompt::ConfirmStop {
                    label: label.clone(),
                })
            }
        }
    }
}

/// Source collections normalized from either the live server snapshot or local
/// fallback state when offline / pre-snapshot.
struct NormalizedDashboardData {
    project_name: String,
    branch: Option<String>,
    summary: ProjectActivitySummary,
    plan_summary: Option<SwarmPlanSummary>,
    my_swarm_members: Vec<SwarmMemberStatus>,
    subagents: Vec<SubagentActivityItem>,
    peer_sessions: Vec<SwarmMemberStatus>,
    background_tasks: Vec<BackgroundTaskActivityItem>,
    runners: Vec<AutonomousRunnerItem>,
}

fn project_display_name(root: Option<&str>, working_dir: Option<&str>) -> String {
    let raw = root.or(working_dir).unwrap_or("project");
    std::path::Path::new(raw)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(raw)
        .to_string()
}

fn member_display_label(member: &SwarmMemberStatus) -> String {
    member
        .friendly_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| member.session_id.chars().take(8).collect())
}

fn member_needs_attention(member: &SwarmMemberStatus) -> bool {
    if member.runtime.pending_attention.is_some()
        || member.runtime.stalled_secs.is_some_and(|secs| secs > 0)
    {
        return true;
    }
    matches!(
        member.status.to_ascii_lowercase().as_str(),
        "failed" | "crashed" | "blocked" | "waiting_network"
    )
}

fn member_is_retryable(member: &SwarmMemberStatus) -> bool {
    if member.runtime.stalled_secs.is_some_and(|secs| secs > 0) {
        return true;
    }
    if member.runtime.pending_attention.as_ref().is_some_and(|a| {
        matches!(
            a.kind,
            AgentAttentionKind::Failed | AgentAttentionKind::Stalled
        )
    }) {
        return true;
    }
    if member.runtime.live_status.as_ref().is_some_and(|ls| {
        matches!(
            ls.phase.to_ascii_lowercase().as_str(),
            "failed" | "error" | "crashed" | "blocked" | "stalled"
        )
    }) {
        return true;
    }
    matches!(
        member.status.to_ascii_lowercase().as_str(),
        "failed" | "error" | "crashed" | "blocked" | "stalled"
    )
}

fn member_is_terminal_status(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "completed"
            | "done"
            | "stopped"
            | "closed"
            | "exited"
            | "cancelled"
            | "canceled"
            | "failed"
            | "crashed"
    )
}

fn point_in_rect(col: u16, row: u16, rect: ratatui::layout::Rect) -> bool {
    !rect.is_empty()
        && col >= rect.x
        && col < rect.right()
        && row >= rect.y
        && row < rect.bottom()
}

fn sanitize_pasted_single_line(text: &str) -> String {
    text.replace("\r\n", "\n")
        .chars()
        .map(|c| {
            if matches!(c, '\r' | '\n' | '\t') {
                ' '
            } else {
                c
            }
        })
        .filter(|c| !c.is_control())
        .collect()
}

fn subagent_needs_attention(sub: &SubagentActivityItem) -> bool {
    matches!(
        sub.status.to_ascii_lowercase().as_str(),
        "failed" | "error" | "crashed"
    )
}

fn bg_task_needs_attention(task: &BackgroundTaskActivityItem) -> bool {
    task.stalled
        || matches!(
            task.status.to_ascii_lowercase().as_str(),
            "failed" | "error"
        )
}

fn runner_needs_attention(runner: &AutonomousRunnerItem) -> bool {
    matches!(
        runner.status.to_ascii_lowercase().as_str(),
        "failed" | "error" | "blocked"
    )
}

fn member_searchable_text(member: &SwarmMemberStatus) -> String {
    let formatted = format_agent_live_activity(member);
    let mut parts = vec![
        member.session_id.as_str(),
        member.status.as_str(),
        formatted.summary.as_str(),
    ];
    if let Some(name) = member.friendly_name.as_deref() {
        parts.push(name);
    }
    if let Some(task) = member.task_label.as_deref() {
        parts.push(task);
    }
    if let Some(role) = member.role.as_deref() {
        parts.push(role);
    }
    if let Some(detail) = member.detail.as_deref() {
        parts.push(detail);
    }
    if let Some(swarm) = member.runtime.swarm_label.as_deref() {
        parts.push(swarm);
    }
    if let Some(model) = member.runtime.model.as_deref() {
        parts.push(model);
    }
    if let Some(attn) = member.runtime.pending_attention.as_ref() {
        parts.push(attn.summary.as_str());
    }
    for file in &member.runtime.files_touched {
        parts.push(file.as_str());
    }
    parts.join(" ").to_ascii_lowercase()
}

fn subagent_searchable_text(sub: &SubagentActivityItem) -> String {
    let mut parts = vec![
        sub.subagent_id.as_str(),
        sub.parent_session_id.as_str(),
        sub.kind.as_str(),
        sub.label.as_str(),
        sub.role.as_str(),
        sub.status.as_str(),
    ];
    if let Some(ls) = sub.live_status.as_ref() {
        if let Some(tool) = ls.tool_name.as_deref() {
            parts.push(tool);
        }
        if let Some(intent) = ls.tool_intent.as_deref() {
            parts.push(intent);
        }
    }
    parts.join(" ").to_ascii_lowercase()
}

fn bg_task_searchable_text(task: &BackgroundTaskActivityItem) -> String {
    let mut parts = vec![
        task.task_id.as_str(),
        task.tool_name.as_str(),
        task.session_id.as_str(),
        task.status.as_str(),
    ];
    if let Some(name) = task.display_name.as_deref() {
        parts.push(name);
    }
    if let Some(owner) = task.owner_label.as_deref() {
        parts.push(owner);
    }
    if let Some(label) = task.progress_label.as_deref() {
        parts.push(label);
    }
    parts.join(" ").to_ascii_lowercase()
}

fn runner_searchable_text(runner: &AutonomousRunnerItem) -> String {
    let kind_str = match runner.kind {
        AutonomousRunnerKind::Overnight => "overnight",
        AutonomousRunnerKind::Ambient => "ambient",
        AutonomousRunnerKind::Reminder => "reminder",
    };
    let mut parts = vec![
        runner.id.as_str(),
        kind_str,
        runner.title.as_str(),
        runner.status.as_str(),
    ];
    if let Some(detail) = runner.detail.as_deref() {
        parts.push(detail);
    }
    parts.join(" ").to_ascii_lowercase()
}

fn member_sort_rank<'a>(member: &'a SwarmMemberStatus, current_session_id: &str) -> (u8, u8, &'a str) {
    let is_self_or_coord = if member.session_id == current_session_id {
        0
    } else if member.role.as_deref() == Some("coordinator") {
        1
    } else {
        2
    };
    let status_rank = if member_needs_attention(member) {
        0
    } else if rayucode_tui_render::swarm_gallery::is_active_status(&member.status) {
        1
    } else if matches!(
        member.status.to_ascii_lowercase().as_str(),
        "waiting" | "ready" | "spawned" | "idle"
    ) {
        2
    } else {
        3
    };
    (is_self_or_coord, status_rank, member.session_id.as_str())
}

/// Emit members in ownership-tree order with nested subagents directly beneath
/// their parent session.
fn build_member_tree_rows(
    members: &[SwarmMemberStatus],
    subagents: &[SubagentActivityItem],
    current_session_id: &str,
    filter_needle: &str,
) -> Vec<ActivityDashboardRow> {
    let member_ids: HashSet<&str> = members.iter().map(|m| m.session_id.as_str()).collect();
    let mut children: HashMap<&str, Vec<&SwarmMemberStatus>> = HashMap::new();
    let mut roots: Vec<&SwarmMemberStatus> = Vec::new();
    for member in members {
        if let Some(parent) = member.report_back_to_session_id.as_deref()
            && parent != member.session_id
            && member_ids.contains(parent)
        {
            children.entry(parent).or_default().push(member);
        } else {
            roots.push(member);
        }
    }
    roots.sort_by(|a, b| {
        member_sort_rank(a, current_session_id).cmp(&member_sort_rank(b, current_session_id))
    });
    for list in children.values_mut() {
        list.sort_by(|a, b| {
            member_sort_rank(a, current_session_id).cmp(&member_sort_rank(b, current_session_id))
        });
    }

    let mut subagents_by_parent: HashMap<&str, Vec<&SubagentActivityItem>> = HashMap::new();
    let mut orphan_subagents: Vec<&SubagentActivityItem> = Vec::new();
    for sub in subagents {
        if member_ids.contains(sub.parent_session_id.as_str()) {
            subagents_by_parent
                .entry(sub.parent_session_id.as_str())
                .or_default()
                .push(sub);
        } else {
            orphan_subagents.push(sub);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn visit<'a>(
        member: &'a SwarmMemberStatus,
        depth: usize,
        current_session_id: &str,
        children: &HashMap<&'a str, Vec<&'a SwarmMemberStatus>>,
        subagents_by_parent: &HashMap<&'a str, Vec<&'a SubagentActivityItem>>,
        visited: &mut HashSet<&'a str>,
        filter_needle: &str,
        out: &mut Vec<ActivityDashboardRow>,
    ) {
        if !visited.insert(member.session_id.as_str()) {
            return;
        }
        let m_search = member_searchable_text(member);
        let member_matches = filter_needle.is_empty() || m_search.contains(filter_needle);

        let mut descendant_rows = Vec::new();
        if let Some(subs) = subagents_by_parent.get(member.session_id.as_str()) {
            for sub in subs {
                let s_search = subagent_searchable_text(sub);
                if member_matches || s_search.contains(filter_needle) {
                    descendant_rows.push(ActivityDashboardRow {
                        kind: ActivityRowKind::Subagent {
                            item: (*sub).clone(),
                            depth: depth + 1,
                        },
                        target_session_id: (!sub.parent_session_id.is_empty())
                            .then(|| sub.parent_session_id.clone()),
                        peek_target: (!sub.parent_session_id.is_empty()).then(|| {
                            PeekTarget::Session {
                                session_id: sub.parent_session_id.clone(),
                            }
                        }),
                        needs_attention: subagent_needs_attention(sub),
                        searchable_text: s_search,
                    });
                }
            }
        }
        if let Some(kids) = children.get(member.session_id.as_str()) {
            for kid in kids {
                visit(
                    kid,
                    depth + 1,
                    current_session_id,
                    children,
                    subagents_by_parent,
                    visited,
                    filter_needle,
                    &mut descendant_rows,
                );
            }
        }

        if member_matches || !descendant_rows.is_empty() {
            out.push(ActivityDashboardRow {
                kind: ActivityRowKind::SwarmMember {
                    member: member.clone(),
                    depth,
                    is_self: member.session_id == current_session_id,
                },
                target_session_id: Some(member.session_id.clone()),
                peek_target: Some(PeekTarget::Session {
                    session_id: member.session_id.clone(),
                }),
                needs_attention: member_needs_attention(member),
                searchable_text: m_search,
            });
            out.extend(descendant_rows);
        }
    }

    let mut rows = Vec::new();
    let mut visited = HashSet::new();
    for root in roots {
        visit(
            root,
            0,
            current_session_id,
            &children,
            &subagents_by_parent,
            &mut visited,
            filter_needle,
            &mut rows,
        );
    }
    // Guard against cyclic parent edges so no member ever disappears.
    for member in members {
        if !visited.contains(member.session_id.as_str()) {
            visit(
                member,
                0,
                current_session_id,
                &children,
                &subagents_by_parent,
                &mut visited,
                filter_needle,
                &mut rows,
            );
        }
    }
    for sub in orphan_subagents {
        let s_search = subagent_searchable_text(sub);
        if filter_needle.is_empty() || s_search.contains(filter_needle) {
            rows.push(ActivityDashboardRow {
                kind: ActivityRowKind::Subagent {
                    item: sub.clone(),
                    depth: 0,
                },
                target_session_id: (!sub.parent_session_id.is_empty())
                    .then(|| sub.parent_session_id.clone()),
                peek_target: (!sub.parent_session_id.is_empty()).then(|| PeekTarget::Session {
                    session_id: sub.parent_session_id.clone(),
                }),
                needs_attention: subagent_needs_attention(sub),
                searchable_text: s_search,
            });
        }
    }
    rows
}

/// Synthesize a fallback `SessionPeekPayload` from the selected tree row when
/// the server has not yet delivered a live `ServerEvent::SessionPeek` (or in
/// local/offline tests).
fn synthesize_fallback_peek(row: &ActivityDashboardRow) -> Option<SessionPeekPayload> {
    match &row.kind {
        ActivityRowKind::SectionHeader { .. } => None,
        ActivityRowKind::SwarmMember { member, .. } => {
            let title = member_display_label(member);
            let mut subtitle_parts = Vec::new();
            if let Some(role) = member.role.as_deref().filter(|r| !r.is_empty()) {
                subtitle_parts.push(role.to_string());
            }
            if let Some(swarm) = member.runtime.swarm_label.as_deref().filter(|s| !s.is_empty()) {
                subtitle_parts.push(swarm.to_string());
            }
            let subtitle = (!subtitle_parts.is_empty()).then(|| subtitle_parts.join(" · "));
            let output_lines = member
                .output_tail
                .as_deref()
                .map(|tail| tail.lines().map(str::to_string).collect())
                .unwrap_or_default();
            Some(SessionPeekPayload {
                target: PeekTarget::Session {
                    session_id: member.session_id.clone(),
                },
                title,
                subtitle,
                live_status: member.runtime.live_status.clone(),
                model: member.runtime.model.clone(),
                provider: member.runtime.provider.clone(),
                context_used: member.runtime.context_tokens,
                context_limit: member.runtime.context_limit,
                tokens_per_sec: member.runtime.tokens_per_sec(),
                attention: member.runtime.pending_attention.clone(),
                todos: member.todo_items.clone(),
                files_touched: member.runtime.files_touched.clone(),
                output_lines,
                updated_at_ms: 0,
            })
        }
        ActivityRowKind::Subagent { item, .. } => Some(SessionPeekPayload {
            target: PeekTarget::Session {
                session_id: item.parent_session_id.clone(),
            },
            title: format!("{}:{}", item.kind, item.label),
            subtitle: (!item.role.is_empty()).then(|| item.role.clone()),
            live_status: item.live_status.clone(),
            model: None,
            provider: None,
            context_used: None,
            context_limit: None,
            tokens_per_sec: item
                .live_status
                .as_ref()
                .and_then(|ls| ls.tokens_per_sec()),
            attention: None,
            todos: Vec::new(),
            files_touched: Vec::new(),
            output_lines: Vec::new(),
            updated_at_ms: item.started_at_ms,
        }),
        ActivityRowKind::BackgroundTask { item } => {
            let title = item
                .display_name
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&item.tool_name)
                .to_string();
            let mut subtitle_parts = vec![item.status.clone()];
            if let Some(owner) = item.owner_label.as_deref().filter(|s| !s.is_empty()) {
                subtitle_parts.push(format!("owner: {owner}"));
            }
            if let Some(pct) = item.progress_percent {
                subtitle_parts.push(format!("{pct}%"));
            }
            Some(SessionPeekPayload {
                target: PeekTarget::BackgroundTask {
                    task_id: item.task_id.clone(),
                },
                title,
                subtitle: Some(subtitle_parts.join(" · ")),
                live_status: None,
                model: None,
                provider: None,
                context_used: None,
                context_limit: None,
                tokens_per_sec: None,
                attention: None,
                todos: Vec::new(),
                files_touched: Vec::new(),
                output_lines: item
                    .progress_label
                    .as_ref()
                    .map(|l| vec![l.clone()])
                    .unwrap_or_default(),
                updated_at_ms: 0,
            })
        }
        ActivityRowKind::Runner { item } => {
            let target = match item.kind {
                AutonomousRunnerKind::Overnight => PeekTarget::Overnight {
                    run_id: item.id.clone(),
                },
                AutonomousRunnerKind::Ambient | AutonomousRunnerKind::Reminder => {
                    PeekTarget::Ambient
                }
            };
            Some(SessionPeekPayload {
                target,
                title: item.title.clone(),
                subtitle: Some(item.status.clone()),
                live_status: None,
                model: None,
                provider: None,
                context_used: None,
                context_limit: None,
                tokens_per_sec: None,
                attention: None,
                todos: Vec::new(),
                files_touched: Vec::new(),
                output_lines: item
                    .detail
                    .as_ref()
                    .map(|d| vec![d.clone()])
                    .unwrap_or_default(),
                updated_at_ms: 0,
            })
        }
    }
}

fn build_rows_and_counts(
    data: &NormalizedDashboardData,
    current_session_id: &str,
    active_tab: ActivityTab,
    collapsed_sections: &HashSet<ActivitySection>,
    filter_query: &str,
) -> (Vec<ActivityDashboardRow>, [usize; 5]) {
    let my_member_ids: HashSet<&str> = data
        .my_swarm_members
        .iter()
        .map(|m| m.session_id.as_str())
        .collect();
    let peer_member_ids: HashSet<&str> = data
        .peer_sessions
        .iter()
        .map(|m| m.session_id.as_str())
        .collect();

    let mut my_subagents = Vec::new();
    let mut peer_subagents = Vec::new();
    for sub in &data.subagents {
        if peer_member_ids.contains(sub.parent_session_id.as_str())
            && !my_member_ids.contains(sub.parent_session_id.as_str())
        {
            peer_subagents.push(sub.clone());
        } else {
            my_subagents.push(sub.clone());
        }
    }

    let my_swarm_count = data.my_swarm_members.len() + my_subagents.len();
    let peers_count = data.peer_sessions.len() + peer_subagents.len();
    let bg_count = data.background_tasks.len();
    let runners_count = data.runners.len();
    let all_count = my_swarm_count + peers_count + bg_count + runners_count;
    let tab_counts = [all_count, my_swarm_count, peers_count, bg_count, runners_count];

    let needle = filter_query.trim().to_ascii_lowercase();
    let mut rows = Vec::new();

    let include_section = |section: ActivitySection| match active_tab {
        ActivityTab::All => true,
        ActivityTab::MySwarm => section == ActivitySection::MySwarm,
        ActivityTab::Peers => section == ActivitySection::Peers,
        ActivityTab::BgTasks => section == ActivitySection::BgTasks,
        ActivityTab::Runners => section == ActivitySection::Runners,
    };

    if include_section(ActivitySection::MySwarm) {
        let items = build_member_tree_rows(
            &data.my_swarm_members,
            &my_subagents,
            current_session_id,
            &needle,
        );
        if !items.is_empty() {
            let collapsed = collapsed_sections.contains(&ActivitySection::MySwarm);
            rows.push(ActivityDashboardRow {
                kind: ActivityRowKind::SectionHeader {
                    section: ActivitySection::MySwarm,
                    count: items.len(),
                    collapsed,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: String::new(),
            });
            if !collapsed {
                rows.extend(items);
            }
        }
    }

    if include_section(ActivitySection::Peers) {
        let items = build_member_tree_rows(
            &data.peer_sessions,
            &peer_subagents,
            current_session_id,
            &needle,
        );
        if !items.is_empty() {
            let collapsed = collapsed_sections.contains(&ActivitySection::Peers);
            rows.push(ActivityDashboardRow {
                kind: ActivityRowKind::SectionHeader {
                    section: ActivitySection::Peers,
                    count: items.len(),
                    collapsed,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: String::new(),
            });
            if !collapsed {
                rows.extend(items);
            }
        }
    }

    if include_section(ActivitySection::BgTasks) {
        let items: Vec<ActivityDashboardRow> = data
            .background_tasks
            .iter()
            .filter_map(|task| {
                let search = bg_task_searchable_text(task);
                if !needle.is_empty() && !search.contains(&needle) {
                    return None;
                }
                Some(ActivityDashboardRow {
                    kind: ActivityRowKind::BackgroundTask { item: task.clone() },
                    target_session_id: (!task.session_id.is_empty())
                        .then(|| task.session_id.clone()),
                    peek_target: Some(PeekTarget::BackgroundTask {
                        task_id: task.task_id.clone(),
                    }),
                    needs_attention: bg_task_needs_attention(task),
                    searchable_text: search,
                })
            })
            .collect();
        if !items.is_empty() {
            let collapsed = collapsed_sections.contains(&ActivitySection::BgTasks);
            rows.push(ActivityDashboardRow {
                kind: ActivityRowKind::SectionHeader {
                    section: ActivitySection::BgTasks,
                    count: items.len(),
                    collapsed,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: String::new(),
            });
            if !collapsed {
                rows.extend(items);
            }
        }
    }

    if include_section(ActivitySection::Runners) {
        let items: Vec<ActivityDashboardRow> = data
            .runners
            .iter()
            .filter_map(|runner| {
                let search = runner_searchable_text(runner);
                if !needle.is_empty() && !search.contains(&needle) {
                    return None;
                }
                let peek_target = match runner.kind {
                    AutonomousRunnerKind::Overnight => PeekTarget::Overnight {
                        run_id: runner.id.clone(),
                    },
                    AutonomousRunnerKind::Ambient | AutonomousRunnerKind::Reminder => {
                        PeekTarget::Ambient
                    }
                };
                Some(ActivityDashboardRow {
                    kind: ActivityRowKind::Runner {
                        item: runner.clone(),
                    },
                    target_session_id: runner.session_id.clone(),
                    peek_target: Some(peek_target),
                    needs_attention: runner_needs_attention(runner),
                    searchable_text: search,
                })
            })
            .collect();
        if !items.is_empty() {
            let collapsed = collapsed_sections.contains(&ActivitySection::Runners);
            rows.push(ActivityDashboardRow {
                kind: ActivityRowKind::SectionHeader {
                    section: ActivitySection::Runners,
                    count: items.len(),
                    collapsed,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: String::new(),
            });
            if !collapsed {
                rows.extend(items);
            }
        }
    }

    (rows, tab_counts)
}

impl App {
    pub(crate) fn current_activity_session_id(&self) -> String {
        if self.is_remote {
            self.remote_session_id
                .clone()
                .unwrap_or_else(|| self.session.id.clone())
        } else {
            self.session.id.clone()
        }
    }

    /// Return the best-known project activity summary for the overscroll footer
    /// badge: prefers server-pushed summary, falling back to local swarm and
    /// background task rows when the server has not pushed one yet.
    pub(crate) fn effective_project_activity_summary(&self) -> ProjectActivitySummary {
        let s = &self.activity_dashboard.summary;
        let has_server_summary = s.active_agents > 0
            || s.total_agents > 0
            || s.running_bg_tasks > 0
            || s.active_watchers > 0
            || s.active_runners > 0
            || s.attention_count > 0
            || s.primary_attention.is_some()
            || s.active_runtime_note.is_some();
        if has_server_summary {
            return s.clone();
        }

        // Offline / pre-push fallback from local state.
        let mut fallback = ProjectActivitySummary::default();
        if !self.remote_swarm_members.is_empty() {
            fallback.total_agents = self.remote_swarm_members.len();
            fallback.active_agents = self
                .remote_swarm_members
                .iter()
                .filter(|m| rayucode_tui_render::swarm_gallery::is_active_status(&m.status))
                .count();
            for m in &self.remote_swarm_members {
                if member_needs_attention(m) {
                    fallback.attention_count += 1;
                    if fallback.primary_attention.is_none() {
                        fallback.primary_attention = m.runtime.pending_attention.clone();
                    }
                }
            }
        }
        fallback.running_bg_tasks = self
            .background_task_rows
            .iter()
            .filter(|t| t.status == crate::tui::BackgroundTaskRowStatus::Running)
            .count();
        if let Some(build) = crate::build::read_build_progress() {
            fallback.active_runtime_note = Some(format!("⚙ {build}"));
        }
        fallback
    }

    fn normalized_dashboard_data(&self) -> NormalizedDashboardData {
        let current_id = self.current_activity_session_id();
        if let Some(snap) = self.activity_dashboard.snapshot.as_ref() {
            return NormalizedDashboardData {
                project_name: project_display_name(
                    snap.project_root.as_deref(),
                    self.session.working_dir.as_deref(),
                ),
                branch: snap.branch.clone().or_else(|| {
                    crate::tui::TuiState::git_branch(self)
                }),
                summary: self.activity_dashboard.summary.clone(),
                plan_summary: snap
                    .swarm_plans
                    .first()
                    .cloned()
                    .or_else(|| self.fallback_plan_summary()),
                my_swarm_members: snap.my_swarm_members.clone(),
                subagents: snap.subagents.clone(),
                peer_sessions: snap.peer_sessions.clone(),
                background_tasks: snap.background_tasks.clone(),
                runners: snap.runners.clone(),
            };
        }

        // Local / pre-snapshot fallback from existing App state.
        let my_swarm =
            super::tui_state::filter_inline_swarm_subtree(&self.remote_swarm_members, &current_id);
        let my_ids: HashSet<&str> = my_swarm.iter().map(|m| m.session_id.as_str()).collect();
        let peers: Vec<SwarmMemberStatus> = self
            .remote_swarm_members
            .iter()
            .filter(|m| !my_ids.contains(m.session_id.as_str()))
            .cloned()
            .collect();
        let bg_tasks: Vec<BackgroundTaskActivityItem> = self
            .background_task_rows
            .iter()
            .map(|row| {
                let status = match row.status {
                    crate::tui::BackgroundTaskRowStatus::Running => "running",
                    crate::tui::BackgroundTaskRowStatus::Completed => "completed",
                    crate::tui::BackgroundTaskRowStatus::Failed => "failed",
                };
                BackgroundTaskActivityItem {
                    task_id: row.task_id.clone(),
                    tool_name: "bash".to_string(),
                    display_name: Some(row.label.clone()),
                    session_id: current_id.clone(),
                    owner_label: None,
                    status: status.to_string(),
                    elapsed_secs: 0,
                    progress_percent: row.percent.map(|p| p.clamp(0.0, 100.0).round() as u8),
                    progress_label: None,
                    stalled: false,
                    exit_code: None,
                    is_watcher: false,
                }
            })
            .collect();

        NormalizedDashboardData {
            project_name: project_display_name(None, self.session.working_dir.as_deref()),
            branch: crate::tui::TuiState::git_branch(self),
            summary: self.effective_project_activity_summary(),
            plan_summary: self.fallback_plan_summary(),
            my_swarm_members: my_swarm,
            subagents: Vec::new(),
            peer_sessions: peers,
            background_tasks: bg_tasks,
            runners: Vec::new(),
        }
    }

    fn fallback_plan_summary(&self) -> Option<SwarmPlanSummary> {
        if self.swarm_plan_items.is_empty() {
            return None;
        }
        let mut summary = SwarmPlanSummary {
            swarm_id: self
                .swarm_plan_swarm_id
                .clone()
                .unwrap_or_else(|| "swarm".to_string()),
            swarm_label: None,
            total: self.swarm_plan_items.len(),
            ..Default::default()
        };
        for item in &self.swarm_plan_items {
            match item.status.to_ascii_lowercase().as_str() {
                "done" | "completed" => summary.done += 1,
                "running" | "in_progress" => summary.running += 1,
                "blocked" => summary.blocked += 1,
                "failed" | "error" => summary.failed += 1,
                _ => {}
            }
        }
        Some(summary)
    }

    pub(crate) fn activity_dashboard_rows(&self) -> (Vec<ActivityDashboardRow>, [usize; 5]) {
        let data = self.normalized_dashboard_data();
        let current_id = self.current_activity_session_id();
        build_rows_and_counts(
            &data,
            &current_id,
            self.activity_dashboard.active_tab,
            &self.activity_dashboard.collapsed_sections,
            &self.activity_dashboard.filter_query,
        )
    }

    fn resolve_selected_peek(
        &self,
        selected_row: Option<&ActivityDashboardRow>,
    ) -> Option<SessionPeekPayload> {
        match (
            self.activity_dashboard.peek.as_ref(),
            selected_row.and_then(|r| r.peek_target.as_ref()),
        ) {
            (Some(live), Some(target)) if &live.target == target => Some(live.clone()),
            (_, Some(_)) => selected_row.and_then(synthesize_fallback_peek),
            (_, None) => None,
        }
    }

    pub(crate) fn activity_dashboard_peek_debounce_deadline(&self) -> Option<Instant> {
        self.activity_dashboard
            .open
            .then_some(self.activity_dashboard.peek_debounce_until)
            .flatten()
    }

    pub(crate) fn reset_activity_dashboard_for_session_change(&mut self) {
        let was_open = self.activity_dashboard.open;
        for id in self.activity_dashboard.pending_control_ids.drain() {
            if self.activity_dashboard.retired_control_done_ids.len() >= 64 {
                self.activity_dashboard.retired_control_done_ids.pop_front();
            }
            self.activity_dashboard
                .retired_control_done_ids
                .push_back(id);
        }
        self.activity_dashboard.pending_control_done_notices.clear();
        self.activity_dashboard.summary = ProjectActivitySummary::default();
        self.activity_dashboard.snapshot = None;
        self.activity_dashboard.peek = None;
        self.activity_dashboard.peek_target_sent = None;
        self.activity_dashboard.peek_pending_target = None;
        self.activity_dashboard.peek_debounce_until = None;
        self.activity_dashboard.peek_follow = true;
        self.activity_dashboard.peek_scroll = 0;
        self.activity_dashboard.selected_index = 0;
        self.activity_dashboard.tree_scroll = 0;
        self.activity_dashboard.status_banner = None;
        if was_open && self.is_remote {
            self.activity_dashboard
                .pending_actions
                .push_back(DashboardRemoteAction::Subscribe(true));
            self.activity_dashboard
                .pending_actions
                .push_back(DashboardRemoteAction::GetSnapshot {
                    session_id: Some(self.current_activity_session_id()),
                });
        }
    }

    pub(crate) fn reset_activity_dashboard_on_disconnect(&mut self) {
        self.activity_dashboard.open = false;
        self.activity_dashboard.inline_action = None;
        self.activity_dashboard.filter_editing = false;
        self.activity_dashboard.status_banner = None;
        self.activity_dashboard.summary = ProjectActivitySummary::default();
        self.activity_dashboard.snapshot = None;
        self.activity_dashboard.peek = None;
        self.activity_dashboard.peek_target_sent = None;
        self.activity_dashboard.peek_pending_target = None;
        self.activity_dashboard.peek_debounce_until = None;
        self.activity_dashboard.peek_follow = true;
        self.activity_dashboard.peek_scroll = 0;
        self.activity_dashboard.selected_index = 0;
        self.activity_dashboard.tree_scroll = 0;
        self.activity_dashboard.pending_actions.clear();
        self.activity_dashboard.pending_control_ids.clear();
        self.activity_dashboard.pending_control_done_notices.clear();
        self.activity_dashboard.retired_control_done_ids.clear();
        self.activity_dashboard
            .layout_metrics
            .set(ActivityDashboardLayoutMetrics::default());
    }

    pub(crate) fn resubscribe_activity_dashboard_after_reconnect(&mut self) {
        if !self.activity_dashboard.open || !self.is_remote {
            return;
        }
        self.activity_dashboard.peek = None;
        self.activity_dashboard.peek_target_sent = None;
        self.activity_dashboard.peek_pending_target = None;
        self.activity_dashboard.peek_debounce_until = None;
        self.activity_dashboard.pending_control_ids.clear();
        self.activity_dashboard.pending_control_done_notices.clear();
        self.activity_dashboard
            .pending_actions
            .push_back(DashboardRemoteAction::Subscribe(true));
        self.activity_dashboard
            .pending_actions
            .push_back(DashboardRemoteAction::GetSnapshot {
                session_id: Some(self.current_activity_session_id()),
            });
        self.sync_activity_dashboard_after_snapshot();
    }

    pub(crate) fn build_activity_dashboard_render_data(&self) -> ActivityDashboardRenderData {
        let data = self.normalized_dashboard_data();
        let current_id = self.current_activity_session_id();
        let (rows, tab_counts) = build_rows_and_counts(
            &data,
            &current_id,
            self.activity_dashboard.active_tab,
            &self.activity_dashboard.collapsed_sections,
            &self.activity_dashboard.filter_query,
        );
        let selected_index = if rows.is_empty() {
            0
        } else {
            self.activity_dashboard
                .selected_index
                .min(rows.len().saturating_sub(1))
        };
        let selected_row = rows.get(selected_index);
        let peek = self.resolve_selected_peek(selected_row);

        ActivityDashboardRenderData {
            project_name: data.project_name,
            branch: data.branch,
            summary: data.summary,
            plan_summary: data.plan_summary,
            active_tab: self.activity_dashboard.active_tab,
            tab_counts,
            filter_query: self.activity_dashboard.filter_query.clone(),
            rows,
            selected_index,
            tree_scroll: self.activity_dashboard.tree_scroll,
            peek,
            peek_follow: self.activity_dashboard.peek_follow,
            peek_scroll: self.activity_dashboard.peek_scroll,
            has_return_session: self.has_session_return_target(),
            inline_prompt: self.activity_dashboard.inline_prompt(),
            status_banner: self.activity_dashboard.status_banner.clone(),
        }
    }

    /// Open the Project Activity Dashboard on the requested tab and enqueue
    /// subscription + snapshot + initial peek requests.
    pub(crate) fn open_activity_dashboard(&mut self, tab: ActivityTab) {
        let was_open = self.activity_dashboard.open;
        self.activity_dashboard.open = true;
        self.activity_dashboard.active_tab = tab;
        self.activity_dashboard.inline_action = None;
        self.activity_dashboard.filter_editing = false;
        self.activity_dashboard.status_banner = None;
        self.activity_dashboard.tree_scroll = 0;

        // Close legacy inline swarm focus so the dashboard owns the viewport cleanly.
        self.swarm_panel_focused = false;
        self.swarm_panel_full_page = false;

        if !was_open && self.is_remote {
            self.activity_dashboard
                .pending_actions
                .push_back(DashboardRemoteAction::Subscribe(true));
            self.activity_dashboard
                .pending_actions
                .push_back(DashboardRemoteAction::GetSnapshot {
                    session_id: Some(self.current_activity_session_id()),
                });
        }

        self.select_first_dashboard_item_and_peek(false);
    }

    /// Close the Project Activity Dashboard, unsubscribe from live snapshots,
    /// and clear any active peek stream.
    pub(crate) fn close_activity_dashboard(&mut self) {
        if !self.activity_dashboard.open {
            return;
        }
        self.activity_dashboard.open = false;
        self.activity_dashboard.inline_action = None;
        self.activity_dashboard.filter_editing = false;
        self.activity_dashboard.peek_debounce_until = None;
        self.activity_dashboard.peek_pending_target = None;
        self.activity_dashboard.peek_target_sent = None;
        self.activity_dashboard.peek = None;
        if self.is_remote {
            self.activity_dashboard
                .pending_actions
                .push_back(DashboardRemoteAction::Subscribe(false));
            self.activity_dashboard
                .pending_actions
                .push_back(DashboardRemoteAction::Peek(None));
        }
    }

    /// Toggle the Project Activity Dashboard globally (`Alt+N`).
    pub(crate) fn toggle_activity_dashboard(&mut self, tab: ActivityTab) {
        if self.activity_dashboard.open {
            self.close_activity_dashboard();
        } else {
            self.open_activity_dashboard(tab);
        }
    }

    fn sync_tree_scroll_for_selection(&mut self, row_count: usize) {
        if row_count == 0 {
            self.activity_dashboard.selected_index = 0;
            self.activity_dashboard.tree_scroll = 0;
            return;
        }
        self.activity_dashboard.selected_index = self
            .activity_dashboard
            .selected_index
            .min(row_count - 1);
        let selected = self.activity_dashboard.selected_index;
        let visible_rows = self.activity_dashboard.layout_metrics.get().tree_visible_rows;
        if selected < self.activity_dashboard.tree_scroll {
            self.activity_dashboard.tree_scroll = selected;
        } else if visible_rows > 0 && selected >= self.activity_dashboard.tree_scroll + visible_rows {
            self.activity_dashboard.tree_scroll = selected + 1 - visible_rows;
        }
        if visible_rows > 0 {
            let max_scroll = row_count.saturating_sub(visible_rows);
            if self.activity_dashboard.tree_scroll > max_scroll {
                self.activity_dashboard.tree_scroll = max_scroll;
            }
        } else if self.activity_dashboard.tree_scroll >= row_count {
            self.activity_dashboard.tree_scroll = row_count - 1;
        }
    }

    /// Called after a fresh `ProjectActivitySnapshot` arrives while the
    /// dashboard is open so selection stays clamped, stale peek state is
    /// cleared on shrink/reorder/empty, and the currently selected target is
    /// peeked cleanly.
    pub(crate) fn sync_activity_dashboard_after_snapshot(&mut self) {
        if !self.activity_dashboard.open {
            return;
        }
        let (rows, _) = self.activity_dashboard_rows();
        if rows.is_empty() {
            self.activity_dashboard.selected_index = 0;
            self.activity_dashboard.tree_scroll = 0;
            self.schedule_peek_for_selected_row(&rows, false);
            return;
        }
        self.sync_tree_scroll_for_selection(rows.len());
        // If we are parked on a section header with no peek yet, advance to first item.
        if self.activity_dashboard.peek_target_sent.is_none()
            && matches!(
                rows[self.activity_dashboard.selected_index].kind,
                ActivityRowKind::SectionHeader { .. }
            )
            && let Some(first_item) = rows
                .iter()
                .position(|r| !matches!(r.kind, ActivityRowKind::SectionHeader { .. }))
        {
            self.activity_dashboard.selected_index = first_item;
            self.sync_tree_scroll_for_selection(rows.len());
        }
        let target = rows
            .get(self.activity_dashboard.selected_index)
            .and_then(|r| r.peek_target.clone());
        if self.activity_dashboard.peek_debounce_until.is_some() {
            self.activity_dashboard.peek_pending_target = target;
        } else {
            self.schedule_peek_for_selected_row(&rows, false);
        }
    }

    fn select_first_dashboard_item_and_peek(&mut self, debounced: bool) {
        let (rows, _) = self.activity_dashboard_rows();
        if rows.is_empty() {
            self.activity_dashboard.selected_index = 0;
            self.activity_dashboard.tree_scroll = 0;
            self.schedule_peek_for_selected_row(&rows, debounced);
            return;
        }
        let idx = rows
            .iter()
            .position(|r| !matches!(r.kind, ActivityRowKind::SectionHeader { .. }))
            .unwrap_or(0);
        self.activity_dashboard.selected_index = idx;
        self.activity_dashboard.tree_scroll = 0;
        self.sync_tree_scroll_for_selection(rows.len());
        self.schedule_peek_for_selected_row(&rows, debounced);
    }

    fn clamp_dashboard_selection_and_peek(&mut self, debounced: bool) {
        let (rows, _) = self.activity_dashboard_rows();
        self.sync_tree_scroll_for_selection(rows.len());
        self.schedule_peek_for_selected_row(&rows, debounced);
    }

    fn schedule_peek_for_selected_row(&mut self, rows: &[ActivityDashboardRow], debounced: bool) {
        let target = rows
            .get(self.activity_dashboard.selected_index)
            .and_then(|r| r.peek_target.clone());
        if target.is_none() {
            self.activity_dashboard.peek = None;
        }
        if target == self.activity_dashboard.peek_target_sent
            && self.activity_dashboard.peek_debounce_until.is_none()
        {
            return;
        }
        self.activity_dashboard.peek_follow = true;
        self.activity_dashboard.peek_scroll = 0;

        if !self.is_remote {
            self.activity_dashboard.peek_debounce_until = None;
            self.activity_dashboard.peek_pending_target = None;
            if self.activity_dashboard.peek.as_ref().map(|p| &p.target) != target.as_ref() {
                self.activity_dashboard.peek = None;
            }
            self.activity_dashboard.peek_target_sent = target;
            return;
        }

        if debounced {
            self.activity_dashboard.peek_pending_target = target;
            self.activity_dashboard.peek_debounce_until =
                Some(Instant::now() + PEEK_DEBOUNCE_DURATION);
        } else {
            self.activity_dashboard.peek_debounce_until = None;
            self.activity_dashboard.peek_pending_target = None;
            if target != self.activity_dashboard.peek_target_sent {
                self.activity_dashboard.peek_target_sent = target.clone();
                if self.activity_dashboard.peek.as_ref().map(|p| &p.target) != target.as_ref() {
                    self.activity_dashboard.peek = None;
                }
                self.activity_dashboard
                    .pending_actions
                    .push_back(DashboardRemoteAction::Peek(target));
            }
        }
    }

    fn effective_peek_max_scroll(&self, rows: &[ActivityDashboardRow]) -> usize {
        let selected_row = rows.get(self.activity_dashboard.selected_index);
        let Some(peek) = self.resolve_selected_peek(selected_row) else {
            return 0;
        };
        let metrics = self.activity_dashboard.layout_metrics.get();
        let visual_lines = if metrics.peek_area.width > 0 {
            count_peek_wrapped_lines(&peek.output_lines, usize::from(metrics.peek_area.width))
        } else {
            peek.output_lines.len()
        };
        visual_lines.saturating_sub(metrics.peek_tail_height)
    }

    fn scroll_peek_down(&mut self, rows: &[ActivityDashboardRow], step: usize) {
        let max_scroll = self.effective_peek_max_scroll(rows);
        self.activity_dashboard.peek_follow = false;
        self.activity_dashboard.peek_scroll = self
            .activity_dashboard
            .peek_scroll
            .min(max_scroll)
            .saturating_add(step)
            .min(max_scroll);
    }

    fn scroll_peek_up(&mut self, rows: &[ActivityDashboardRow], step: usize) {
        let max_scroll = self.effective_peek_max_scroll(rows);
        if self.activity_dashboard.peek_follow {
            self.activity_dashboard.peek_follow = false;
            self.activity_dashboard.peek_scroll = max_scroll.saturating_sub(step);
        } else {
            self.activity_dashboard.peek_scroll = self
                .activity_dashboard
                .peek_scroll
                .min(max_scroll)
                .saturating_sub(step);
        }
    }

    /// Trigger returning to the previous session on `session_return_stack`
    /// (shared by `/back` and `Alt+B`, allowed even while `is_processing`).
    pub(crate) fn trigger_session_return(&mut self) -> bool {
        if !self.is_remote {
            self.set_status_notice("Session switching requires a connected daemon session.");
            return false;
        }
        let Some(target) = self.pop_session_return_target() else {
            self.set_status_notice("No previous session to return to.");
            return false;
        };
        let label = crate::id::extract_session_name(&target)
            .map(str::to_string)
            .unwrap_or_else(|| target.clone());
        self.activity_dashboard
            .pending_actions
            .push_back(DashboardRemoteAction::SwitchSession {
                target_session_id: target,
                allow_takeover: false,
            });
        self.set_status_notice(format!("Back → {label}"));
        true
    }

    /// Reset local streaming/turn presentation state cleanly when switching
    /// sessions while the detached session's turn continues on the server.
    pub(crate) fn clear_local_streaming_state_for_session_switch(&mut self) {
        self.is_processing = false;
        self.status = ProcessingStatus::Idle;
        self.processing_started = None;
        self.visible_turn_started = None;
        self.last_stream_activity = None;
        self.current_message_id = None;
        self.deferred_stream_done_id = None;
        self.deferred_stream_done_identity = None;
        self.remote_resume_activity = None;
        self.stream_message_ended = false;
        self.stream_buffer.clear();
        self.streaming.streaming_text.clear();
        self.streaming_tool_calls.clear();
        self.bash_progress.clear();
        self.batch_progress = None;
        self.subagent_status = None;
        self.thinking_start = None;
        self.thinking_buffer.clear();
        self.reasoning_streaming = false;
        self.reasoning_pending_line.clear();
        self.reasoning_partial_len = 0;
        self.cancel_requested = false;
        self.pending_queued_dispatch = false;
        self.remote_interrupt_ack_deadline = None;
        // Keep the turn fence scoped until the newly attached session's
        // TurnState arrives, but clear its active turn so late deltas from the
        // detached session are dropped cleanly.
        self.remote_turn_fence.active = None;
    }

    /// Handle bracketed paste while the full-screen Activity Dashboard is open.
    /// Routes sanitized single-line text into active `Filter` or `DmInput`
    /// prompts and consumes all other pastes so nothing leaks into the hidden
    /// composer.
    pub(crate) fn handle_activity_dashboard_paste(&mut self, text: &str) -> bool {
        if !self.activity_dashboard.open || self.question_dialog.is_some() {
            return false;
        }
        let cleaned = sanitize_pasted_single_line(text);
        match self.activity_dashboard.inline_action.as_mut() {
            Some(DashboardInlineAction::Filter) => {
                if !cleaned.is_empty() {
                    self.activity_dashboard.filter_query.push_str(&cleaned);
                    self.clamp_dashboard_selection_and_peek(true);
                }
            }
            Some(DashboardInlineAction::DmInput { buffer, .. }) => {
                if !cleaned.is_empty() {
                    buffer.push_str(&cleaned);
                }
            }
            Some(DashboardInlineAction::ConfirmStop { .. }) | None => {}
        }
        true
    }

    /// Handle mouse events while the full-screen Activity Dashboard is open.
    /// Scrolls the hovered pane (tree or peek) and consumes clicks so hidden
    /// transcript/composer controls underneath are never activated.
    pub(crate) fn handle_activity_dashboard_mouse(&mut self, mouse: MouseEvent) -> bool {
        if !self.activity_dashboard.open || self.question_dialog.is_some() {
            return false;
        }
        let layout = self.activity_dashboard.layout_metrics.get();
        let in_peek = point_in_rect(mouse.column, mouse.row, layout.peek_area);
        match mouse.kind {
            MouseEventKind::ScrollUp => {
                let (rows, _) = self.activity_dashboard_rows();
                if in_peek {
                    self.scroll_peek_up(&rows, 3);
                } else if self.activity_dashboard.inline_action.is_none()
                    && !rows.is_empty()
                    && self.activity_dashboard.selected_index > 0
                {
                    self.activity_dashboard.selected_index -= 1;
                    self.clamp_dashboard_selection_and_peek(true);
                }
            }
            MouseEventKind::ScrollDown => {
                let (rows, _) = self.activity_dashboard_rows();
                if in_peek {
                    self.scroll_peek_down(&rows, 3);
                } else if self.activity_dashboard.inline_action.is_none()
                    && !rows.is_empty()
                    && self.activity_dashboard.selected_index + 1 < rows.len()
                {
                    self.activity_dashboard.selected_index += 1;
                    self.clamp_dashboard_selection_and_peek(true);
                }
            }
            _ => {}
        }
        false
    }

    /// Handle a key event while the full-screen Activity Dashboard is open.
    /// Returns `true` when the key was consumed.
    pub(crate) fn handle_activity_dashboard_key(
        &mut self,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> bool {
        if !self.activity_dashboard.open || self.question_dialog.is_some() {
            return false;
        }

        // Global toggle closes immediately from any dashboard sub-mode.
        if self.toggle_keys.swarm_panel_focus.matches(code, modifiers) {
            self.close_activity_dashboard();
            return true;
        }

        let macos_alt = crate::tui::keybind::shortcut_char_for_macos_option_key(code, modifiers);
        let alt_char = if modifiers.contains(KeyModifiers::ALT) {
            match code {
                KeyCode::Char(c) => Some(c.to_ascii_lowercase()),
                _ => None,
            }
        } else {
            macos_alt.map(|c| c.to_ascii_lowercase())
        };

        // Alt+B returns to previous session directly from the dashboard.
        if alt_char == Some('b') {
            if self.has_session_return_target() {
                self.close_activity_dashboard();
                self.trigger_session_return();
            } else {
                self.activity_dashboard.status_banner =
                    Some("No previous session to return to.".to_string());
            }
            return true;
        }

        // Alt+O opens the selected session in a separate OS terminal window (local only).
        if alt_char == Some('o') {
            let (rows, _) = self.activity_dashboard_rows();
            if let Some(session_id) = rows
                .get(self.activity_dashboard.selected_index)
                .and_then(|r| r.target_session_id.clone())
            {
                self.pop_out_session_by_id(&session_id);
            } else {
                self.activity_dashboard.status_banner =
                    Some("No session selected to open in terminal".to_string());
            }
            return true;
        }

        // Route active inline prompts (filter, DM input, stop confirmation).
        if self.activity_dashboard.inline_action.is_some() {
            return self.handle_dashboard_inline_action_key(code, modifiers);
        }

        let (rows, _) = self.activity_dashboard_rows();

        match code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.close_activity_dashboard();
                true
            }
            KeyCode::Up | KeyCode::Char('k') if !modifiers.contains(KeyModifiers::SHIFT) => {
                if !rows.is_empty() && self.activity_dashboard.selected_index > 0 {
                    self.activity_dashboard.selected_index -= 1;
                    self.clamp_dashboard_selection_and_peek(true);
                }
                true
            }
            KeyCode::Down | KeyCode::Char('j') if !modifiers.contains(KeyModifiers::SHIFT) => {
                if !rows.is_empty()
                    && self.activity_dashboard.selected_index + 1 < rows.len()
                {
                    self.activity_dashboard.selected_index += 1;
                    self.clamp_dashboard_selection_and_peek(true);
                }
                true
            }
            KeyCode::Home | KeyCode::Char('g') => {
                if !rows.is_empty() {
                    self.activity_dashboard.selected_index = 0;
                    self.activity_dashboard.tree_scroll = 0;
                    self.schedule_peek_for_selected_row(&rows, true);
                }
                true
            }
            KeyCode::End | KeyCode::Char('G') => {
                if !rows.is_empty() {
                    self.activity_dashboard.selected_index = rows.len() - 1;
                    self.sync_tree_scroll_for_selection(rows.len());
                    self.schedule_peek_for_selected_row(&rows, true);
                }
                true
            }
            KeyCode::Tab => {
                self.activity_dashboard.active_tab = self.activity_dashboard.active_tab.next();
                self.activity_dashboard.status_banner = None;
                self.select_first_dashboard_item_and_peek(false);
                true
            }
            KeyCode::BackTab => {
                self.activity_dashboard.active_tab = self.activity_dashboard.active_tab.prev();
                self.activity_dashboard.status_banner = None;
                self.select_first_dashboard_item_and_peek(false);
                true
            }
            KeyCode::Char(c @ '1'..='5')
                if !modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                if let Some(tab) = ActivityTab::from_digit(c) {
                    self.activity_dashboard.active_tab = tab;
                    self.activity_dashboard.status_banner = None;
                    self.select_first_dashboard_item_and_peek(false);
                }
                true
            }
            KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right => {
                self.handle_dashboard_section_collapse_key(code, &rows);
                true
            }
            KeyCode::Char('/') => {
                self.activity_dashboard.filter_editing = true;
                self.activity_dashboard.inline_action = Some(DashboardInlineAction::Filter);
                self.activity_dashboard.status_banner = None;
                true
            }
            KeyCode::Enter => {
                self.handle_dashboard_enter(&rows);
                true
            }
            KeyCode::Char('a') => {
                self.handle_dashboard_jump_attention(&rows);
                true
            }
            KeyCode::Char('m') => {
                self.handle_dashboard_open_dm(&rows);
                true
            }
            KeyCode::Char('x') => {
                self.handle_dashboard_open_stop_confirm(&rows);
                true
            }
            KeyCode::Char('r') => {
                self.handle_dashboard_retry(&rows);
                true
            }
            KeyCode::Char('f') => {
                self.activity_dashboard.peek_follow = !self.activity_dashboard.peek_follow;
                if self.activity_dashboard.peek_follow {
                    self.activity_dashboard.peek_scroll = self.effective_peek_max_scroll(&rows);
                    self.activity_dashboard.status_banner = Some("Peek follow: ON".to_string());
                } else {
                    self.activity_dashboard.status_banner = Some("Peek follow: PAUSED".to_string());
                }
                true
            }
            KeyCode::Char('J') | KeyCode::PageDown => {
                let step = if code == KeyCode::PageDown { 10 } else { 3 };
                self.scroll_peek_down(&rows, step);
                true
            }
            KeyCode::Char('K') | KeyCode::PageUp => {
                let step = if code == KeyCode::PageUp { 10 } else { 3 };
                self.scroll_peek_up(&rows, step);
                true
            }
            _ => true,
        }
    }

    fn handle_dashboard_inline_action_key(
        &mut self,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> bool {
        let Some(action) = self.activity_dashboard.inline_action.clone() else {
            return false;
        };
        match action {
            DashboardInlineAction::Filter => match code {
                KeyCode::Esc => {
                    self.activity_dashboard.filter_query.clear();
                    self.activity_dashboard.filter_editing = false;
                    self.activity_dashboard.inline_action = None;
                    self.clamp_dashboard_selection_and_peek(false);
                }
                KeyCode::Enter => {
                    self.activity_dashboard.filter_editing = false;
                    self.activity_dashboard.inline_action = None;
                    self.clamp_dashboard_selection_and_peek(false);
                }
                KeyCode::Backspace => {
                    self.activity_dashboard.filter_query.pop();
                    self.clamp_dashboard_selection_and_peek(true);
                }
                KeyCode::Up => {
                    let (rows, _) = self.activity_dashboard_rows();
                    if !rows.is_empty() && self.activity_dashboard.selected_index > 0 {
                        self.activity_dashboard.selected_index -= 1;
                        self.sync_tree_scroll_for_selection(rows.len());
                        self.schedule_peek_for_selected_row(&rows, true);
                    }
                }
                KeyCode::Down => {
                    let (rows, _) = self.activity_dashboard_rows();
                    if !rows.is_empty()
                        && self.activity_dashboard.selected_index + 1 < rows.len()
                    {
                        self.activity_dashboard.selected_index += 1;
                        self.sync_tree_scroll_for_selection(rows.len());
                        self.schedule_peek_for_selected_row(&rows, true);
                    }
                }
                KeyCode::Char(c)
                    if !modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    self.activity_dashboard.filter_query.push(c);
                    self.clamp_dashboard_selection_and_peek(true);
                }
                _ => {}
            },
            DashboardInlineAction::DmInput {
                target_session_id,
                target_swarm,
                target_label,
                mut buffer,
            } => match code {
                KeyCode::Esc => {
                    self.activity_dashboard.inline_action = None;
                    self.activity_dashboard.status_banner = Some("DM cancelled".to_string());
                }
                KeyCode::Enter => {
                    let trimmed = buffer.trim().to_string();
                    self.activity_dashboard.inline_action = None;
                    if !trimmed.is_empty() {
                        if !self.is_remote {
                            self.activity_dashboard.status_banner = Some(
                                "Direct messaging requires a connected daemon session".to_string(),
                            );
                        } else {
                            let from_session = self.current_activity_session_id();
                            self.activity_dashboard.pending_actions.push_back(
                                DashboardRemoteAction::CommMessage {
                                    from_session,
                                    to_session: target_session_id,
                                    to_swarm: target_swarm,
                                    message: trimmed,
                                },
                            );
                            self.activity_dashboard.status_banner =
                                Some(format!("Sent DM to {target_label}"));
                        }
                    }
                }
                KeyCode::Backspace => {
                    buffer.pop();
                    self.activity_dashboard.inline_action = Some(DashboardInlineAction::DmInput {
                        target_session_id,
                        target_swarm,
                        target_label,
                        buffer,
                    });
                }
                KeyCode::Char(c)
                    if !modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    buffer.push(c);
                    self.activity_dashboard.inline_action = Some(DashboardInlineAction::DmInput {
                        target_session_id,
                        target_swarm,
                        target_label,
                        buffer,
                    });
                }
                _ => {}
            },
            DashboardInlineAction::ConfirmStop { target, label } => match code {
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    self.activity_dashboard.inline_action = None;
                    match target {
                        DashboardStopTarget::SwarmWorker { session_id } => {
                            if !self.is_remote {
                                self.activity_dashboard.status_banner = Some(
                                    "Stopping swarm workers requires a connected daemon session"
                                        .to_string(),
                                );
                            } else {
                                let from = self.current_activity_session_id();
                                self.activity_dashboard.pending_actions.push_back(
                                    DashboardRemoteAction::CommStop {
                                        session_id: from,
                                        target_session_id: session_id,
                                        label: label.clone(),
                                    },
                                );
                                self.activity_dashboard.status_banner =
                                    Some(format!("Stopping {label}…"));
                            }
                        }
                        DashboardStopTarget::BackgroundTask { task_id } => {
                            if self.is_remote {
                                self.activity_dashboard.pending_actions.push_back(
                                    DashboardRemoteAction::CancelBackgroundTask { task_id },
                                );
                            } else if let Ok(handle) = tokio::runtime::Handle::try_current() {
                                handle.spawn(async move {
                                    let _ = crate::background::global().cancel(&task_id).await;
                                });
                            }
                            self.activity_dashboard.status_banner =
                                Some(format!("Cancelling task {label}…"));
                        }
                    }
                }
                KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                    self.activity_dashboard.inline_action = None;
                    self.activity_dashboard.status_banner = Some("Stop cancelled".to_string());
                }
                _ => {}
            },
        }
        true
    }

    fn handle_dashboard_section_collapse_key(
        &mut self,
        code: KeyCode,
        rows: &[ActivityDashboardRow],
    ) {
        let Some(row) = rows.get(self.activity_dashboard.selected_index) else {
            return;
        };
        if let ActivityRowKind::SectionHeader { section, .. } = row.kind {
            match code {
                KeyCode::Char(' ') => {
                    if !self.activity_dashboard.collapsed_sections.remove(&section) {
                        self.activity_dashboard.collapsed_sections.insert(section);
                    }
                }
                KeyCode::Left => {
                    self.activity_dashboard.collapsed_sections.insert(section);
                }
                KeyCode::Right => {
                    self.activity_dashboard.collapsed_sections.remove(&section);
                }
                _ => {}
            }
            self.clamp_dashboard_selection_and_peek(false);
        } else if code == KeyCode::Left {
            // Jump to parent section header.
            if let Some(header_idx) = rows[..self.activity_dashboard.selected_index]
                .iter()
                .rposition(|r| matches!(r.kind, ActivityRowKind::SectionHeader { .. }))
            {
                self.activity_dashboard.selected_index = header_idx;
                self.clamp_dashboard_selection_and_peek(false);
            }
        }
    }

    fn handle_dashboard_enter(&mut self, rows: &[ActivityDashboardRow]) {
        let Some(row) = rows.get(self.activity_dashboard.selected_index) else {
            return;
        };
        if let ActivityRowKind::SectionHeader { section, .. } = row.kind {
            if !self.activity_dashboard.collapsed_sections.remove(&section) {
                self.activity_dashboard.collapsed_sections.insert(section);
            }
            self.clamp_dashboard_selection_and_peek(false);
            return;
        }
        let Some(target) = row.target_session_id.clone() else {
            self.activity_dashboard.status_banner =
                Some("Selected item has no interactive session".to_string());
            return;
        };
        let current = self.current_activity_session_id();
        if target == current {
            self.close_activity_dashboard();
            self.set_status_notice("Already in this session");
            return;
        }
        if !self.is_remote {
            self.activity_dashboard.status_banner =
                Some("Session switching requires a connected daemon session".to_string());
            return;
        }
        self.push_session_return_target(current);
        self.close_activity_dashboard();
        self.activity_dashboard
            .pending_actions
            .push_back(DashboardRemoteAction::SwitchSession {
                target_session_id: target,
                allow_takeover: false,
            });
    }

    fn swarm_id_for_session_target(&self, session_id: &str) -> Option<String> {
        let data = self.normalized_dashboard_data();
        data.my_swarm_members
            .iter()
            .chain(data.peer_sessions.iter())
            .find(|m| m.session_id == session_id)
            .and_then(|m| {
                m.runtime
                    .swarm_id
                    .clone()
                    .or_else(|| m.runtime.swarm_label.clone())
            })
    }

    fn is_peer_session_id(&self, session_id: &str) -> bool {
        if let Some(snap) = self.activity_dashboard.snapshot.as_ref() {
            return snap
                .peer_sessions
                .iter()
                .any(|p| p.session_id == session_id)
                && !snap
                    .my_swarm_members
                    .iter()
                    .any(|m| m.session_id == session_id);
        }
        let current = self.current_activity_session_id();
        let my_swarm =
            super::tui_state::filter_inline_swarm_subtree(&self.remote_swarm_members, &current);
        self.remote_swarm_members
            .iter()
            .any(|m| m.session_id == session_id)
            && !my_swarm.iter().any(|m| m.session_id == session_id)
    }

    fn focus_dashboard_row_in_tab(
        &mut self,
        tab: ActivityTab,
        section: ActivitySection,
        predicate: impl Fn(&ActivityDashboardRow) -> bool,
        banner: String,
    ) -> bool {
        self.activity_dashboard.active_tab = tab;
        self.activity_dashboard.collapsed_sections.remove(&section);
        let (mut rows, _) = self.activity_dashboard_rows();
        let mut idx = rows.iter().position(&predicate);
        if idx.is_none() && !self.activity_dashboard.filter_query.is_empty() {
            self.activity_dashboard.filter_query.clear();
            let (unfiltered, _) = self.activity_dashboard_rows();
            rows = unfiltered;
            idx = rows.iter().position(&predicate);
        }
        if let Some(pos) = idx {
            self.activity_dashboard.selected_index = pos;
            self.sync_tree_scroll_for_selection(rows.len());
            self.schedule_peek_for_selected_row(&rows, false);
            self.activity_dashboard.status_banner = Some(banner);
            true
        } else {
            false
        }
    }

    fn handle_dashboard_jump_attention(&mut self, rows: &[ActivityDashboardRow]) {
        enum AttentionTarget {
            Session {
                session_id: String,
                fallback_tab: ActivityTab,
                fallback_section: ActivitySection,
                label: String,
            },
            BgTask {
                task_id: String,
                label: String,
            },
            Runner {
                runner_id: String,
                label: String,
            },
            Subagent {
                subagent_id: String,
                label: String,
            },
        }

        let attention_from_row = |row: &ActivityDashboardRow| -> Option<AttentionTarget> {
            if !row.needs_attention {
                return None;
            }
            match &row.kind {
                ActivityRowKind::SwarmMember { member, .. } => Some(AttentionTarget::Session {
                    session_id: member.session_id.clone(),
                    fallback_tab: if self.is_peer_session_id(&member.session_id) {
                        ActivityTab::Peers
                    } else {
                        ActivityTab::MySwarm
                    },
                    fallback_section: if self.is_peer_session_id(&member.session_id) {
                        ActivitySection::Peers
                    } else {
                        ActivitySection::MySwarm
                    },
                    label: member_display_label(member),
                }),
                ActivityRowKind::Subagent { item, .. } => {
                    if !item.parent_session_id.is_empty() {
                        Some(AttentionTarget::Session {
                            session_id: item.parent_session_id.clone(),
                            fallback_tab: ActivityTab::MySwarm,
                            fallback_section: ActivitySection::MySwarm,
                            label: item.label.clone(),
                        })
                    } else {
                        Some(AttentionTarget::Subagent {
                            subagent_id: item.subagent_id.clone(),
                            label: item.label.clone(),
                        })
                    }
                }
                ActivityRowKind::BackgroundTask { item } => {
                    let label = item
                        .display_name
                        .clone()
                        .unwrap_or_else(|| item.task_id.clone());
                    if !item.session_id.is_empty() {
                        Some(AttentionTarget::Session {
                            session_id: item.session_id.clone(),
                            fallback_tab: ActivityTab::BgTasks,
                            fallback_section: ActivitySection::BgTasks,
                            label,
                        })
                    } else {
                        Some(AttentionTarget::BgTask {
                            task_id: item.task_id.clone(),
                            label,
                        })
                    }
                }
                ActivityRowKind::Runner { item } => {
                    if let Some(sid) = item.session_id.as_deref().filter(|s| !s.is_empty()) {
                        Some(AttentionTarget::Session {
                            session_id: sid.to_string(),
                            fallback_tab: ActivityTab::Runners,
                            fallback_section: ActivitySection::Runners,
                            label: item.title.clone(),
                        })
                    } else {
                        Some(AttentionTarget::Runner {
                            runner_id: item.id.clone(),
                            label: item.title.clone(),
                        })
                    }
                }
                ActivityRowKind::SectionHeader { .. } => None,
            }
        };

        // 1. Selected row if it currently needs attention.
        let selected_target = rows
            .get(self.activity_dashboard.selected_index)
            .and_then(&attention_from_row);

        // 2. Otherwise first visible row needing attention.
        let target = selected_target
            .or_else(|| rows.iter().find_map(&attention_from_row))
            // 3. Fallback: scan ALL normalized categories across tabs/collapsed
            //    sections (including live snapshot AND offline fallback state).
            .or_else(|| {
                let data = self.normalized_dashboard_data();
                if let Some(m) = data
                    .my_swarm_members
                    .iter()
                    .find(|m| member_needs_attention(m))
                {
                    return Some(AttentionTarget::Session {
                        session_id: m.session_id.clone(),
                        fallback_tab: ActivityTab::MySwarm,
                        fallback_section: ActivitySection::MySwarm,
                        label: member_display_label(m),
                    });
                }
                if let Some(m) = data
                    .peer_sessions
                    .iter()
                    .find(|m| member_needs_attention(m))
                {
                    return Some(AttentionTarget::Session {
                        session_id: m.session_id.clone(),
                        fallback_tab: ActivityTab::Peers,
                        fallback_section: ActivitySection::Peers,
                        label: member_display_label(m),
                    });
                }
                if let Some(sub) = data.subagents.iter().find(|s| subagent_needs_attention(s)) {
                    if !sub.parent_session_id.is_empty() {
                        return Some(AttentionTarget::Session {
                            session_id: sub.parent_session_id.clone(),
                            fallback_tab: ActivityTab::MySwarm,
                            fallback_section: ActivitySection::MySwarm,
                            label: sub.label.clone(),
                        });
                    }
                    return Some(AttentionTarget::Subagent {
                        subagent_id: sub.subagent_id.clone(),
                        label: sub.label.clone(),
                    });
                }
                if let Some(task) = data
                    .background_tasks
                    .iter()
                    .find(|t| bg_task_needs_attention(t))
                {
                    let label = task
                        .display_name
                        .clone()
                        .unwrap_or_else(|| task.task_id.clone());
                    if !task.session_id.is_empty() {
                        return Some(AttentionTarget::Session {
                            session_id: task.session_id.clone(),
                            fallback_tab: ActivityTab::BgTasks,
                            fallback_section: ActivitySection::BgTasks,
                            label,
                        });
                    }
                    return Some(AttentionTarget::BgTask {
                        task_id: task.task_id.clone(),
                        label,
                    });
                }
                if let Some(runner) = data.runners.iter().find(|r| runner_needs_attention(r)) {
                    if let Some(sid) = runner.session_id.as_deref().filter(|s| !s.is_empty()) {
                        return Some(AttentionTarget::Session {
                            session_id: sid.to_string(),
                            fallback_tab: ActivityTab::Runners,
                            fallback_section: ActivitySection::Runners,
                            label: runner.title.clone(),
                        });
                    }
                    return Some(AttentionTarget::Runner {
                        runner_id: runner.id.clone(),
                        label: runner.title.clone(),
                    });
                }
                None
            });

        let Some(target) = target else {
            self.activity_dashboard.status_banner =
                Some("No agents currently need attention".to_string());
            return;
        };

        match target {
            AttentionTarget::Session {
                session_id,
                fallback_tab,
                fallback_section,
                label,
            } => {
                let current = self.current_activity_session_id();
                if session_id == current {
                    self.close_activity_dashboard();
                    self.set_status_notice("Attention item is in this session");
                    return;
                }
                if !self.is_remote {
                    let target_id = session_id.clone();
                    let _ = self.focus_dashboard_row_in_tab(
                        fallback_tab,
                        fallback_section,
                        |r| r.target_session_id.as_deref() == Some(target_id.as_str()),
                        format!(
                            "Attention on {label} (session switching requires a connected daemon)"
                        ),
                    );
                    return;
                }
                let allow_takeover = self.is_peer_session_id(&session_id);
                self.push_session_return_target(current);
                self.close_activity_dashboard();
                self.activity_dashboard
                    .pending_actions
                    .push_back(DashboardRemoteAction::SwitchSession {
                        target_session_id: session_id,
                        allow_takeover,
                    });
            }
            AttentionTarget::BgTask { task_id, label } => {
                self.focus_dashboard_row_in_tab(
                    ActivityTab::BgTasks,
                    ActivitySection::BgTasks,
                    |r| {
                        matches!(
                            &r.kind,
                            ActivityRowKind::BackgroundTask { item } if item.task_id == task_id
                        )
                    },
                    format!("Focused attention task: {label}"),
                );
            }
            AttentionTarget::Runner { runner_id, label } => {
                self.focus_dashboard_row_in_tab(
                    ActivityTab::Runners,
                    ActivitySection::Runners,
                    |r| {
                        matches!(
                            &r.kind,
                            ActivityRowKind::Runner { item } if item.id == runner_id
                        )
                    },
                    format!("Focused failed runner: {label}"),
                );
            }
            AttentionTarget::Subagent { subagent_id, label } => {
                self.focus_dashboard_row_in_tab(
                    ActivityTab::MySwarm,
                    ActivitySection::MySwarm,
                    |r| {
                        matches!(
                            &r.kind,
                            ActivityRowKind::Subagent { item, .. } if item.subagent_id == subagent_id
                        )
                    },
                    format!("Focused failed subagent: {label}"),
                );
            }
        }
    }

    fn handle_dashboard_open_dm(&mut self, rows: &[ActivityDashboardRow]) {
        let Some(row) = rows.get(self.activity_dashboard.selected_index) else {
            return;
        };
        if !self.is_remote {
            self.activity_dashboard.status_banner =
                Some("Direct messaging requires a connected daemon session".to_string());
            return;
        }
        let Some(target_session_id) = row.target_session_id.clone() else {
            self.activity_dashboard.status_banner =
                Some("Select an agent session to send a DM".to_string());
            return;
        };
        let current = self.current_activity_session_id();
        let is_self = target_session_id == current
            || matches!(
                row.kind,
                ActivityRowKind::SwarmMember { is_self: true, .. }
            );
        if is_self {
            self.activity_dashboard.status_banner =
                Some("Cannot send a DM to the active session".to_string());
            return;
        }
        let (target_label, target_swarm) = match &row.kind {
            ActivityRowKind::SwarmMember { member, .. } => (
                member_display_label(member),
                member
                    .runtime
                    .swarm_id
                    .clone()
                    .or_else(|| member.runtime.swarm_label.clone()),
            ),
            ActivityRowKind::Subagent { item, .. } => (
                item.label.clone(),
                self.swarm_id_for_session_target(&target_session_id),
            ),
            ActivityRowKind::BackgroundTask { item } => (
                item.owner_label
                    .clone()
                    .unwrap_or_else(|| target_session_id.chars().take(8).collect()),
                self.swarm_id_for_session_target(&target_session_id),
            ),
            ActivityRowKind::Runner { item } => (
                item.title.clone(),
                self.swarm_id_for_session_target(&target_session_id),
            ),
            ActivityRowKind::SectionHeader { .. } => return,
        };
        self.activity_dashboard.inline_action = Some(DashboardInlineAction::DmInput {
            target_session_id,
            target_swarm,
            target_label,
            buffer: String::new(),
        });
        self.activity_dashboard.status_banner = None;
    }

    fn handle_dashboard_open_stop_confirm(&mut self, rows: &[ActivityDashboardRow]) {
        let Some(row) = rows.get(self.activity_dashboard.selected_index) else {
            return;
        };
        match &row.kind {
            ActivityRowKind::SwarmMember {
                member, is_self, ..
            } => {
                if *is_self {
                    self.activity_dashboard.status_banner =
                        Some("Cannot stop the active session from the dashboard".to_string());
                    return;
                }
                if !self.is_remote {
                    self.activity_dashboard.status_banner = Some(
                        "Stopping swarm workers requires a connected daemon session".to_string(),
                    );
                    return;
                }
                if self.is_peer_session_id(&member.session_id) {
                    self.activity_dashboard.status_banner =
                        Some("Cannot stop a peer session outside your swarm".to_string());
                    return;
                }
                if member_is_terminal_status(&member.status) {
                    self.activity_dashboard.status_banner = Some(format!(
                        "{} is already {} and cannot be stopped",
                        member_display_label(member),
                        member.status
                    ));
                    return;
                }
                let label = member_display_label(member);
                self.activity_dashboard.inline_action = Some(DashboardInlineAction::ConfirmStop {
                    target: DashboardStopTarget::SwarmWorker {
                        session_id: member.session_id.clone(),
                    },
                    label,
                });
                self.activity_dashboard.status_banner = None;
            }
            ActivityRowKind::BackgroundTask { item } => {
                if item.is_watcher || item.task_id.starts_with("await:") {
                    self.activity_dashboard.status_banner =
                        Some("Watchers cannot be cancelled from the dashboard".to_string());
                    return;
                }
                if !item.status.eq_ignore_ascii_case("running") {
                    self.activity_dashboard.status_banner = Some(format!(
                        "Task is already {} and cannot be cancelled",
                        item.status
                    ));
                    return;
                }
                let label = item
                    .display_name
                    .clone()
                    .unwrap_or_else(|| item.task_id.clone());
                self.activity_dashboard.inline_action = Some(DashboardInlineAction::ConfirmStop {
                    target: DashboardStopTarget::BackgroundTask {
                        task_id: item.task_id.clone(),
                    },
                    label,
                });
                self.activity_dashboard.status_banner = None;
            }
            ActivityRowKind::Runner { .. } => {
                self.activity_dashboard.status_banner =
                    Some("Autonomous runners cannot be stopped from the dashboard".to_string());
            }
            _ => {
                self.activity_dashboard.status_banner =
                    Some("Select a running worker or background task to stop/cancel".to_string());
            }
        }
    }

    fn handle_dashboard_retry(&mut self, rows: &[ActivityDashboardRow]) {
        let Some(row) = rows.get(self.activity_dashboard.selected_index) else {
            return;
        };
        if !self.is_remote {
            self.activity_dashboard.status_banner =
                Some("Retrying swarm tasks requires a connected daemon session".to_string());
            return;
        }
        let ActivityRowKind::SwarmMember {
            member, is_self, ..
        } = &row.kind
        else {
            self.activity_dashboard.status_banner =
                Some("Select a worker to retry its failed task".to_string());
            return;
        };
        let current = self.current_activity_session_id();
        // Prefer structured `CommTaskControl { action: "retry" }` if we know a
        // failed/blocked plan task assigned to this worker.
        if let Some(plan_task) = self.swarm_plan_items.iter().find(|item| {
            item.assigned_to.as_deref() == Some(member.session_id.as_str())
                && matches!(
                    item.status.to_ascii_lowercase().as_str(),
                    "failed" | "blocked" | "error"
                )
        }) {
            let task_id = plan_task.id.clone();
            self.activity_dashboard.pending_actions.push_back(
                DashboardRemoteAction::CommTaskControlRetry {
                    session_id: current,
                    task_id: task_id.clone(),
                },
            );
            self.activity_dashboard.status_banner = Some(format!("Retrying task {task_id}…"));
            return;
        }
        if *is_self {
            self.activity_dashboard.status_banner =
                Some("Select a worker with a failed task to retry".to_string());
            return;
        }
        if !member_is_retryable(member) {
            self.activity_dashboard.status_banner =
                Some("Selected agent is not failed or blocked".to_string());
            return;
        }
        let label = member_display_label(member);
        self.activity_dashboard.pending_actions.push_back(
            DashboardRemoteAction::CommMessage {
                from_session: current,
                to_session: member.session_id.clone(),
                to_swarm: member
                    .runtime
                    .swarm_id
                    .clone()
                    .or_else(|| member.runtime.swarm_label.clone()),
                message: "Please retry the failed step and report back with status.".to_string(),
            },
        );
        self.activity_dashboard.status_banner = Some(format!("Sent retry nudge to {label}"));
    }
}

/// Handle `/activity`, `/bg`, and bare `/swarm` slash commands in both local
/// and remote TUI paths. `/swarm on`, `/swarm off`, and `/swarm status` are
/// deliberately left untouched so existing handlers keep exact compatibility.
pub(super) fn handle_activity_dashboard_command(app: &mut App, trimmed: &str) -> bool {
    match trimmed {
        "/activity" => {
            app.open_activity_dashboard(ActivityTab::All);
            true
        }
        "/bg" => {
            app.open_activity_dashboard(ActivityTab::BgTasks);
            true
        }
        "/swarm" => {
            app.open_activity_dashboard(ActivityTab::MySwarm);
            true
        }
        _ if trimmed.starts_with("/activity ") => {
            app.push_display_message(DisplayMessage::error("Usage: /activity".to_string()));
            true
        }
        _ if trimmed.starts_with("/bg ") => {
            app.push_display_message(DisplayMessage::error("Usage: /bg".to_string()));
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tui::app::tests::create_test_app;
    use crate::protocol::{AgentAttention, AgentAttentionKind, SwarmLiveStatus};

    fn sample_member(
        id: &str,
        name: &str,
        status: &str,
        parent: Option<&str>,
    ) -> SwarmMemberStatus {
        SwarmMemberStatus {
            session_id: id.to_string(),
            friendly_name: Some(name.to_string()),
            status: status.to_string(),
            report_back_to_session_id: parent.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn slash_commands_open_expected_tabs_and_preserve_swarm_subcommands() {
        let mut app = create_test_app();

        assert!(handle_activity_dashboard_command(&mut app, "/activity"));
        assert!(app.activity_dashboard.open);
        assert_eq!(app.activity_dashboard.active_tab, ActivityTab::All);

        app.close_activity_dashboard();
        assert!(handle_activity_dashboard_command(&mut app, "/bg"));
        assert!(app.activity_dashboard.open);
        assert_eq!(app.activity_dashboard.active_tab, ActivityTab::BgTasks);

        app.close_activity_dashboard();
        assert!(handle_activity_dashboard_command(&mut app, "/swarm"));
        assert!(app.activity_dashboard.open);
        assert_eq!(app.activity_dashboard.active_tab, ActivityTab::MySwarm);

        // /swarm on|off|status must NOT be claimed by dashboard launcher.
        app.close_activity_dashboard();
        assert!(!handle_activity_dashboard_command(&mut app, "/swarm on"));
        assert!(!handle_activity_dashboard_command(&mut app, "/swarm off"));
        assert!(!handle_activity_dashboard_command(&mut app, "/swarm status"));
        assert!(!app.activity_dashboard.open);
    }

    #[test]
    fn alt_n_toggles_dashboard_regardless_of_spawn_mode_or_pin_todos_and_esc_unsubscribes() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.swarm_enabled = false;
        app.pinned_todos_payload = Some(r#"{"todos":[{"id":"1","content":"x","status":"in_progress"}]}"#.into());
        assert!(!app.activity_dashboard.open);

        app.toggle_activity_dashboard(ActivityTab::All);
        assert!(app.activity_dashboard.open);
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::Subscribe(true))));
        app.activity_dashboard.pending_actions.clear();

        // Esc closes and enqueues unsubscribe + peek clear.
        assert!(app.handle_activity_dashboard_key(KeyCode::Esc, KeyModifiers::NONE));
        assert!(!app.activity_dashboard.open);
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::Subscribe(false))));
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::Peek(None))));
    }

    #[test]
    fn enter_and_attention_jump_push_return_stack_and_set_peer_takeover() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_coord".to_string());

        let mut peer_attn = sample_member("ses_peer_fox", "fox", "running", None);
        peer_attn.runtime.pending_attention = Some(AgentAttention {
            kind: AgentAttentionKind::Permission,
            summary: "bash: cargo test".to_string(),
            request_id: Some("req_1".to_string()),
            since_epoch_ms: None,
        });
        let worker = sample_member("ses_worker_1", "worker-1", "running", Some("ses_coord"));

        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![
                sample_member("ses_coord", "coord", "running", None),
                worker,
            ],
            peer_sessions: vec![peer_attn],
            ..Default::default()
        });

        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_actions.clear();

        // Move down to worker-1 (index 0 = SectionHeader, 1 = coord, 2 = worker-1)
        assert!(app.handle_activity_dashboard_key(KeyCode::Down, KeyModifiers::NONE));
        assert!(app.handle_activity_dashboard_key(KeyCode::Enter, KeyModifiers::NONE));
        assert!(!app.activity_dashboard.open);
        assert_eq!(app.session_return_stack, vec!["ses_coord".to_string()]);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::SwitchSession {
                target_session_id,
                allow_takeover: false
            } if target_session_id == "ses_worker_1"
        )));

        // Returning via trigger_session_return pops cleanly.
        app.activity_dashboard.pending_actions.clear();
        assert!(app.trigger_session_return());
        assert!(app.session_return_stack.is_empty());
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::SwitchSession {
                target_session_id,
                allow_takeover: false
            } if target_session_id == "ses_coord"
        )));

        // Reopen and press `a` to jump to peer attention session -> allow_takeover: true.
        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_actions.clear();
        assert!(app.handle_activity_dashboard_key(KeyCode::Char('a'), KeyModifiers::NONE));
        assert!(!app.activity_dashboard.open);
        assert_eq!(app.session_return_stack, vec!["ses_coord".to_string()]);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::SwitchSession {
                target_session_id,
                allow_takeover: true
            } if target_session_id == "ses_peer_fox"
        )));
    }

    #[test]
    fn quick_actions_dm_stop_retry_and_follow_toggle() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_coord".to_string());

        let mut worker = sample_member("ses_worker_a", "worker-a", "failed", Some("ses_coord"));
        worker.runtime.live_status = Some(SwarmLiveStatus {
            phase: "failed".to_string(),
            ..Default::default()
        });
        let running_worker = sample_member("ses_worker_b", "worker-b", "running", Some("ses_coord"));
        let bg = BackgroundTaskActivityItem {
            task_id: "bg_42".to_string(),
            tool_name: "bash".to_string(),
            display_name: Some("cargo test".to_string()),
            session_id: "ses_coord".to_string(),
            status: "running".to_string(),
            ..Default::default()
        };
        app.swarm_plan_items = vec![crate::plan::PlanItem {
            id: "task-7".to_string(),
            content: "Run tests".to_string(),
            status: "failed".to_string(),
            priority: "high".to_string(),
            subsystem: None,
            file_scope: Vec::new(),
            blocked_by: Vec::new(),
            assigned_to: Some("ses_worker_a".to_string()),
        }];

        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![worker, running_worker],
            background_tasks: vec![bg],
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_actions.clear();

        // Toggle follow (`f`)
        assert!(app.activity_dashboard.peek_follow);
        app.handle_activity_dashboard_key(KeyCode::Char('f'), KeyModifiers::NONE);
        assert!(!app.activity_dashboard.peek_follow);
        app.handle_activity_dashboard_key(KeyCode::Char('f'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.peek_follow);

        // Retry (`r`) dispatches CommTaskControlRetry for assigned failed plan item
        app.handle_activity_dashboard_key(KeyCode::Char('r'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::CommTaskControlRetry { session_id, task_id }
                if session_id == "ses_coord" && task_id == "task-7"
        )));
        app.activity_dashboard.pending_actions.clear();

        // DM (`m`) opens prompt, types text, Enter sends CommMessage
        app.handle_activity_dashboard_key(KeyCode::Char('m'), KeyModifiers::NONE);
        assert!(matches!(
            app.activity_dashboard.inline_action,
            Some(DashboardInlineAction::DmInput { .. })
        ));
        for ch in "check auth".chars() {
            app.handle_activity_dashboard_key(KeyCode::Char(ch), KeyModifiers::NONE);
        }
        app.handle_activity_dashboard_key(KeyCode::Enter, KeyModifiers::NONE);
        assert!(app.activity_dashboard.inline_action.is_none());
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::CommMessage { from_session, to_session, message, .. }
                if from_session == "ses_coord" && to_session == "ses_worker_a" && message == "check auth"
        )));
        app.activity_dashboard.pending_actions.clear();

        // Move to running worker-b, Stop (`x`) opens confirmation, `y` sends CommStop
        app.handle_activity_dashboard_key(KeyCode::Down, KeyModifiers::NONE);
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        assert!(matches!(
            app.activity_dashboard.inline_action,
            Some(DashboardInlineAction::ConfirmStop { .. })
        ));
        app.handle_activity_dashboard_key(KeyCode::Char('y'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.inline_action.is_none());
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::CommStop { session_id, target_session_id, label }
                if session_id == "ses_coord"
                    && target_session_id == "ses_worker_b"
                    && label == "worker-b"
        )));
        app.activity_dashboard.pending_actions.clear();

        // Switch to BgTasks tab (`4`), press `x` then `y` -> CancelBackgroundTask
        app.handle_activity_dashboard_key(KeyCode::Char('4'), KeyModifiers::NONE);
        assert_eq!(app.activity_dashboard.active_tab, ActivityTab::BgTasks);
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        app.handle_activity_dashboard_key(KeyCode::Char('y'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::CancelBackgroundTask { task_id } if task_id == "bg_42"
        )));
    }

    #[test]
    fn remote_keys_and_events_wire_alt_n_alt_b_back_and_passive_telemetry() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let _guard = rt.enter();

        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_coord".to_string());
        let mut remote = crate::tui::backend::RemoteConnection::dummy();
        let peer = remote.take_dummy_peer().unwrap();
        let (reader, _writer) = peer.into_split();
        let mut reader = tokio::io::BufReader::new(reader);

        // 1. Alt+N opens dashboard even while not in inline mode and with pin_todos active.
        rt.block_on(async {
            crate::tui::app::remote::handle_remote_key_event(
                &mut app,
                crossterm::event::KeyEvent::new(KeyCode::Char('n'), KeyModifiers::ALT),
                &mut remote,
            )
            .await
            .unwrap();
            assert!(app.activity_dashboard.open);
            crate::tui::app::remote::flush_pending_activity_dashboard_actions(&mut app, &mut remote)
                .await;

            use tokio::io::AsyncBufReadExt;
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let req: crate::protocol::Request = serde_json::from_str(&line).unwrap();
            assert!(matches!(
                req,
                crate::protocol::Request::SubscribeProjectActivity { enabled: true, .. }
            ));

            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let req: crate::protocol::Request = serde_json::from_str(&line).unwrap();
            assert!(matches!(
                req,
                crate::protocol::Request::GetProjectActivity { .. }
            ));

            // 2. Esc closes and sends Subscribe(false) + PeekSession(None).
            crate::tui::app::remote::handle_remote_key_event(
                &mut app,
                crossterm::event::KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE),
                &mut remote,
            )
            .await
            .unwrap();
            assert!(!app.activity_dashboard.open);
            crate::tui::app::remote::flush_pending_activity_dashboard_actions(&mut app, &mut remote)
                .await;

            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let req: crate::protocol::Request = serde_json::from_str(&line).unwrap();
            assert!(matches!(
                req,
                crate::protocol::Request::SubscribeProjectActivity { enabled: false, .. }
            ));
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let req: crate::protocol::Request = serde_json::from_str(&line).unwrap();
            assert!(matches!(
                req,
                crate::protocol::Request::PeekSession { target: None, .. }
            ));

            // 3. Alt+B returns to previous session even while is_processing == true.
            app.session_return_stack.push("ses_prev".to_string());
            app.is_processing = true;
            crate::tui::app::remote::handle_remote_key_event(
                &mut app,
                crossterm::event::KeyEvent::new(KeyCode::Char('b'), KeyModifiers::ALT),
                &mut remote,
            )
            .await
            .unwrap();
            assert!(app.session_return_stack.is_empty());
            crate::tui::app::remote::flush_pending_activity_dashboard_actions(&mut app, &mut remote)
                .await;
            assert!(!app.is_processing, "local streaming flags cleared on switch");
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let req: crate::protocol::Request = serde_json::from_str(&line).unwrap();
            assert!(matches!(
                req,
                crate::protocol::Request::ResumeSession {
                    session_id,
                    allow_session_takeover: false,
                    ..
                } if session_id == "ses_prev"
            ));
        });

        // 4. Server events update dashboard state cleanly & passive telemetry preserves hibernation.
        let summary = ProjectActivitySummary {
            active_agents: 2,
            total_agents: 3,
            running_bg_tasks: 1,
            attention_count: 1,
            ..Default::default()
        };
        app.idle_hibernation.frame = Some(ratatui::buffer::Buffer::empty(
            ratatui::layout::Rect::new(0, 0, 10, 2),
        ));
        assert!(app.handle_server_event(
            crate::protocol::ServerEvent::ProjectActivitySummary(summary.clone()),
            &mut remote,
        ));
        assert_eq!(app.activity_dashboard.summary, summary);
        assert!(
            app.idle_hibernation.frame.is_some(),
            "ProjectActivitySummary must not wake idle hibernation"
        );

        let peek_payload = SessionPeekPayload {
            target: PeekTarget::Session {
                session_id: "ses_coord".to_string(),
            },
            title: "coord".to_string(),
            subtitle: Some("coordinator".to_string()),
            live_status: None,
            model: Some("claude-sonnet-4-6".to_string()),
            provider: Some("anthropic".to_string()),
            context_used: Some(64_000),
            context_limit: Some(200_000),
            tokens_per_sec: Some(48.2),
            attention: None,
            todos: Vec::new(),
            files_touched: vec!["src/main.rs".to_string()],
            output_lines: vec!["line 1".to_string(), "line 2".to_string()],
            updated_at_ms: 100,
        };
        assert!(app.handle_server_event(
            crate::protocol::ServerEvent::SessionPeek {
                payload: peek_payload.clone()
            },
            &mut remote,
        ));
        assert_eq!(app.activity_dashboard.peek, Some(peek_payload));
        assert!(
            app.idle_hibernation.frame.is_some(),
            "SessionPeek must not wake idle hibernation"
        );
        assert!(app.handle_server_event(
            crate::protocol::ServerEvent::ProjectActivitySnapshot {
                id: None,
                snapshot: ProjectActivitySnapshot::default(),
            },
            &mut remote,
        ));
        assert!(
            app.idle_hibernation.frame.is_some(),
            "ProjectActivitySnapshot must not wake idle hibernation"
        );

        assert!(app.handle_server_event(
            crate::protocol::ServerEvent::BackgroundTaskCancelled {
                id: 99,
                task_id: "bg_42".to_string(),
                cancelled: true,
                message: Some("Cancelled bg_42".to_string()),
            },
            &mut remote,
        ));
        assert_eq!(
            app.activity_dashboard.status_banner.as_deref(),
            Some("Cancelled bg_42")
        );

        // 5. Full-screen dashboard renders cleanly with unified render_inline_limit_bar context bar.
        app.open_activity_dashboard(ActivityTab::All);
        let backend = ratatui::backend::TestBackend::new(120, 32);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::tui::ui::draw(frame, &app))
            .expect("full-screen Activity Dashboard draw should succeed");
    }

    #[test]
    fn disconnect_closes_dashboard_and_disconnected_keys_never_leak_into_composer() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_coord".to_string());
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![sample_member("ses_coord", "coord", "running", None)],
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_control_ids.insert(77);
        assert!(app.activity_dashboard.open);

        let mut run_state = crate::tui::app::remote::RemoteRunState::default();
        crate::tui::app::remote::handle_disconnect(&mut app, &mut run_state, None);
        assert!(!app.activity_dashboard.open);
        assert!(app.activity_dashboard.snapshot.is_none());
        assert!(app.activity_dashboard.peek.is_none());
        assert!(app.activity_dashboard.pending_actions.is_empty());
        assert!(app.activity_dashboard.pending_control_ids.is_empty());

        // Even if reopened while disconnected (e.g. `/activity`), keys must NOT leak into composer.
        app.open_activity_dashboard(ActivityTab::All);
        for key in [
            crossterm::event::KeyEvent::new(KeyCode::Char('j'), KeyModifiers::NONE),
            crossterm::event::KeyEvent::new(KeyCode::Char('k'), KeyModifiers::NONE),
            crossterm::event::KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE),
            crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
        ] {
            crate::tui::app::remote::handle_disconnected_key_event(&mut app, key).unwrap();
        }
        assert!(app.input.is_empty(), "keys leaked into composer: {:?}", app.input);
        assert!(app.queued_messages.is_empty());
        assert!(app.activity_dashboard.open);

        // Esc closes cleanly while disconnected.
        crate::tui::app::remote::handle_disconnected_key_event(
            &mut app,
            crossterm::event::KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE),
        )
        .unwrap();
        assert!(!app.activity_dashboard.open);
    }

    #[test]
    fn paste_and_mouse_do_not_leak_through_open_dashboard() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_coord".to_string());
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![
                sample_member("ses_coord", "coord", "running", None),
                sample_member("ses_worker_1", "worker-1", "running", Some("ses_coord")),
            ],
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        assert!(app.presentation_modal_blocked());

        // Browsing paste is consumed cleanly without touching hidden composer.
        app.handle_paste("should not leak".to_string());
        assert!(app.input.is_empty());

        // Filter paste inserts sanitized single-line query.
        app.handle_activity_dashboard_key(KeyCode::Char('/'), KeyModifiers::NONE);
        app.handle_paste("worker\r\n-1".to_string());
        assert_eq!(app.activity_dashboard.filter_query, "worker -1");
        assert!(app.input.is_empty());
        app.handle_activity_dashboard_key(KeyCode::Esc, KeyModifiers::NONE);

        // DmInput paste inserts sanitized single-line message on non-self worker.
        let (rows, _) = app.activity_dashboard_rows();
        app.activity_dashboard.selected_index = rows
            .iter()
            .position(|r| r.target_session_id.as_deref() == Some("ses_worker_1"))
            .expect("worker-1 row present");
        app.handle_activity_dashboard_key(KeyCode::Char('m'), KeyModifiers::NONE);
        app.handle_paste("check\nlogs".to_string());
        assert!(matches!(
            app.activity_dashboard.inline_action,
            Some(DashboardInlineAction::DmInput { ref buffer, .. }) if buffer == "check logs"
        ));
        assert!(app.input.is_empty());
        app.handle_activity_dashboard_key(KeyCode::Esc, KeyModifiers::NONE);

        // Mouse scroll and clicks must not scroll hidden transcript or hit hidden UI.
        app.scroll_offset = 5;
        app.auto_scroll_paused = false;
        let scroll_ev = MouseEvent {
            kind: MouseEventKind::ScrollUp,
            column: 5,
            row: 5,
            modifiers: KeyModifiers::NONE,
        };
        app.handle_mouse_event(scroll_ev);
        assert_eq!(app.scroll_offset, 5);
        assert!(!app.auto_scroll_paused);

        let click_ev = MouseEvent {
            kind: MouseEventKind::Down(crossterm::event::MouseButton::Left),
            column: 10,
            row: 10,
            modifiers: KeyModifiers::NONE,
        };
        app.handle_mouse_event(click_ev);
        assert!(app.input.is_empty());
    }

    #[test]
    fn peek_debounce_schedules_fast_redraw_even_when_unfocused_or_deep_idle() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_coord".to_string());
        app.set_client_focused(false);
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![
                sample_member("ses_coord", "coord", "running", None),
                sample_member("ses_worker_1", "worker-1", "running", Some("ses_coord")),
            ],
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        assert!(app.activity_dashboard_peek_debounce_deadline().is_none());

        // Arrow navigation schedules a 120ms debounced peek.
        app.handle_activity_dashboard_key(KeyCode::Down, KeyModifiers::NONE);
        assert!(app.activity_dashboard_peek_debounce_deadline().is_some());
        assert!(crate::tui::TuiState::activity_dashboard_peek_debounce_pending(&app));

        let policy = crate::perf::tui_policy();
        let interval = crate::tui::redraw_interval_with_policy(&app, &policy);
        assert!(
            interval <= Duration::from_millis(30),
            "debounced peek must wake promptly even when unfocused, got {interval:?}"
        );

        // Flushing past deadline clears the debounce and emits PeekSession.
        let flushed = app
            .activity_dashboard
            .flush_debounced_peek(Instant::now() + PEEK_DEBOUNCE_DURATION + Duration::from_millis(5));
        assert!(flushed);
        assert!(app.activity_dashboard_peek_debounce_deadline().is_none());
        assert!(!crate::tui::TuiState::activity_dashboard_peek_debounce_pending(&app));
    }

    #[test]
    fn session_changed_resets_stale_activity_state_and_reconnect_resubscribes_open_dashboard() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let _guard = rt.enter();

        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_old".to_string());
        let mut remote = crate::tui::backend::RemoteConnection::dummy();

        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            summary: ProjectActivitySummary {
                active_agents: 2,
                total_agents: 2,
                attention_count: 1,
                ..Default::default()
            },
            my_swarm_members: vec![sample_member("ses_old", "old", "running", None)],
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_control_ids.insert(55);
        app.activity_dashboard.pending_actions.clear();

        // History for a different session resets all stale dashboard data.
        let history: crate::protocol::ServerEvent = serde_json::from_value(serde_json::json!({
            "type": "history",
            "id": 10,
            "session_id": "ses_new",
            "messages": [],
            "mcp_servers": [],
            "skills": []
        }))
        .unwrap();
        app.handle_server_event(history, &mut remote);

        assert_eq!(app.activity_dashboard.summary, ProjectActivitySummary::default());
        assert!(app.activity_dashboard.snapshot.is_none());
        assert!(app.activity_dashboard.peek.is_none());
        assert!(app.activity_dashboard.peek_target_sent.is_none());
        assert!(app.activity_dashboard.pending_control_ids.is_empty());
        // Because dashboard stayed open, re-subscribe + snapshot refresh were queued.
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::Subscribe(true))));
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::GetSnapshot { .. })));

        // Reconnect while open re-subscribes, fetches snapshot, and re-peeks selected row.
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![sample_member("ses_new", "new", "running", None)],
            ..Default::default()
        });
        app.activity_dashboard.pending_actions.clear();
        app.resubscribe_activity_dashboard_after_reconnect();
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::Subscribe(true))));
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::GetSnapshot { .. })));
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::Peek(Some(_)))));
    }

    #[test]
    fn quick_actions_6a_6b_6c_6d_wiring_and_guards() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let _guard = rt.enter();

        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_coord".to_string());

        let self_member = sample_member("ses_coord", "coord", "running", None);
        let healthy_worker = sample_member("ses_healthy", "healthy", "running", Some("ses_coord"));
        let completed_worker = sample_member("ses_done", "done-w", "completed", Some("ses_coord"));
        let mut failed_worker = sample_member("ses_failed", "fail-w", "failed", Some("ses_coord"));
        failed_worker.runtime.swarm_id = Some("swarm_alpha".into());
        let mut peer_beta = sample_member("ses_peer_beta", "beta-1", "running", None);
        peer_beta.runtime.swarm_id = Some("swarm_beta".into());

        let watcher_task = BackgroundTaskActivityItem {
            task_id: "await:watch_1".into(),
            tool_name: "await_members".into(),
            display_name: Some("watch workers".into()),
            session_id: "ses_coord".into(),
            status: "running".into(),
            is_watcher: true,
            ..Default::default()
        };
        let done_task = BackgroundTaskActivityItem {
            task_id: "bg_done".into(),
            tool_name: "bash".into(),
            display_name: Some("finished build".into()),
            session_id: "ses_coord".into(),
            status: "completed".into(),
            ..Default::default()
        };
        let failed_ownerless_task = BackgroundTaskActivityItem {
            task_id: "bg_orphan_fail".into(),
            tool_name: "bash".into(),
            display_name: Some("orphan test".into()),
            session_id: String::new(),
            status: "failed".into(),
            ..Default::default()
        };
        let failed_runner = AutonomousRunnerItem {
            id: "overnight_1".into(),
            kind: AutonomousRunnerKind::Overnight,
            title: "nightly".into(),
            status: "failed".into(),
            detail: Some("test failed".into()),
            step_current: None,
            step_total: None,
            elapsed_secs: Some(10),
            next_run_secs: None,
            session_id: None,
        };

        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![self_member, healthy_worker, completed_worker, failed_worker],
            peer_sessions: vec![peer_beta],
            background_tasks: vec![watcher_task, done_task, failed_ownerless_task],
            runners: vec![failed_runner],
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_actions.clear();

        // 6a: Self-DM is blocked cleanly.
        app.handle_activity_dashboard_key(KeyCode::Char('m'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.inline_action.is_none());
        assert!(app
            .activity_dashboard
            .status_banner
            .as_deref()
            .is_some_and(|b| b.contains("Cannot send a DM")));

        // 6a: Peer DM in another swarm passes `to_swarm: Some("swarm_beta")` over the wire.
        app.handle_activity_dashboard_key(KeyCode::Char('3'), KeyModifiers::NONE); // Peers tab
        app.activity_dashboard.pending_actions.clear();
        app.handle_activity_dashboard_key(KeyCode::Char('m'), KeyModifiers::NONE);
        assert!(matches!(
            app.activity_dashboard.inline_action,
            Some(DashboardInlineAction::DmInput { ref target_swarm, .. })
                if target_swarm.as_deref() == Some("swarm_beta")
        ));
        for ch in "hi beta".chars() {
            app.handle_activity_dashboard_key(KeyCode::Char(ch), KeyModifiers::NONE);
        }
        app.handle_activity_dashboard_key(KeyCode::Enter, KeyModifiers::NONE);
        let mut remote = crate::tui::backend::RemoteConnection::dummy();
        let peer = remote.take_dummy_peer().unwrap();
        let (reader, mut writer) = peer.into_split();
        let mut reader = tokio::io::BufReader::new(reader);
        rt.block_on(async {
            crate::tui::app::remote::flush_pending_activity_dashboard_actions(&mut app, &mut remote)
                .await;
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let req: crate::protocol::Request = serde_json::from_str(&line).unwrap();
            let dm_wire_id = match req {
                crate::protocol::Request::CommMessage {
                    id,
                    to_session: Some(ref to),
                    to_swarm: Some(ref swarm),
                    ..
                } if to == "ses_peer_beta" && swarm == "swarm_beta" => id,
                other => panic!("expected cross-swarm CommMessage, got {other:?}"),
            };
            // Verify RemoteConnection does NOT swallow Done for CommMessage.
            let done_json =
                crate::protocol::encode_event(&crate::protocol::ServerEvent::Done { id: dm_wire_id });
            writer.write_all(done_json.as_bytes()).await.unwrap();
            match remote.next_event().await {
                crate::tui::backend::RemoteRead::Event(ev) => {
                    assert!(matches!(ev, crate::protocol::ServerEvent::Done { id } if id == dm_wire_id));
                    app.handle_server_event(ev, &mut remote);
                }
                other => panic!("expected Done event for CommMessage, got {other:?}"),
            }
        });
        assert!(app.activity_dashboard.pending_control_ids.is_empty());

        // 6c: Stopping a peer-swarm worker is blocked pre-confirm.
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.inline_action.is_none());
        assert!(app
            .activity_dashboard
            .status_banner
            .as_deref()
            .is_some_and(|b| b.contains("peer session")));

        // 6b & 6c on MySwarm tab: healthy/completed workers refuse retry; completed/failed refuse stop;
        // running worker stop completes cleanly on `ServerEvent::Done`.
        app.handle_activity_dashboard_key(KeyCode::Char('2'), KeyModifiers::NONE); // MySwarm
        let (rows, _) = app.activity_dashboard_rows();
        let healthy_idx = rows
            .iter()
            .position(|r| r.target_session_id.as_deref() == Some("ses_healthy"))
            .unwrap();
        let done_idx = rows
            .iter()
            .position(|r| r.target_session_id.as_deref() == Some("ses_done"))
            .unwrap();
        let failed_idx = rows
            .iter()
            .position(|r| r.target_session_id.as_deref() == Some("ses_failed"))
            .unwrap();

        // Healthy running worker: `r` does NOT send bogus retry DM.
        app.activity_dashboard.selected_index = healthy_idx;
        app.activity_dashboard.pending_actions.clear();
        app.handle_activity_dashboard_key(KeyCode::Char('r'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.is_empty());
        assert_eq!(
            app.activity_dashboard.status_banner.as_deref(),
            Some("Selected agent is not failed or blocked")
        );

        // Completed worker: `r` refuses retry AND `x` refuses stop.
        app.activity_dashboard.selected_index = done_idx;
        app.handle_activity_dashboard_key(KeyCode::Char('r'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.is_empty());
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.inline_action.is_none());

        // Failed worker (no plan item): `r` sends retry DM with swarm_id populated.
        app.activity_dashboard.selected_index = failed_idx;
        app.activity_dashboard.pending_actions.clear();
        app.handle_activity_dashboard_key(KeyCode::Char('r'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::CommMessage { to_session, to_swarm, .. }
                if to_session == "ses_failed" && to_swarm.as_deref() == Some("swarm_alpha")
        )));
        app.activity_dashboard.pending_actions.clear();

        // Running worker stop -> `ServerEvent::Done` transitions banner from "Stopping…" to "Stopped".
        app.activity_dashboard.selected_index = healthy_idx;
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        app.handle_activity_dashboard_key(KeyCode::Char('y'), KeyModifiers::NONE);
        assert_eq!(
            app.activity_dashboard.status_banner.as_deref(),
            Some("Stopping healthy…")
        );
        rt.block_on(async {
            crate::tui::app::remote::flush_pending_activity_dashboard_actions(&mut app, &mut remote)
                .await;
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let req: crate::protocol::Request = serde_json::from_str(&line).unwrap();
            let stop_wire_id = match req {
                crate::protocol::Request::CommStop { id, .. } => id,
                other => panic!("expected CommStop, got {other:?}"),
            };
            // Verify RemoteConnection does NOT swallow Done for CommStop.
            let done_json = crate::protocol::encode_event(&crate::protocol::ServerEvent::Done {
                id: stop_wire_id,
            });
            writer.write_all(done_json.as_bytes()).await.unwrap();
            match remote.next_event().await {
                crate::tui::backend::RemoteRead::Event(ev) => {
                    assert!(matches!(ev, crate::protocol::ServerEvent::Done { id } if id == stop_wire_id));
                    app.handle_server_event(ev, &mut remote);
                }
                other => panic!("expected Done event for CommStop, got {other:?}"),
            }
        });
        assert!(app.activity_dashboard.pending_control_ids.is_empty());
        assert_eq!(
            app.activity_dashboard.status_banner.as_deref(),
            Some("Stopped healthy")
        );

        // 6c: BgTasks watcher and completed task refuse `x`; Runner refuses `x`.
        app.handle_activity_dashboard_key(KeyCode::Char('4'), KeyModifiers::NONE); // BgTasks
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE); // watcher
        assert!(app.activity_dashboard.inline_action.is_none());
        assert!(app
            .activity_dashboard
            .status_banner
            .as_deref()
            .is_some_and(|b| b.contains("Watchers")));
        app.handle_activity_dashboard_key(KeyCode::Down, KeyModifiers::NONE); // completed task
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.inline_action.is_none());
        app.handle_activity_dashboard_key(KeyCode::Char('5'), KeyModifiers::NONE); // Runners
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.inline_action.is_none());

        // 6d: Attention jump (`a`) scans subagents, background tasks, runners, and offline members!
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![sample_member("ses_coord", "coord", "running", None)],
            subagents: vec![SubagentActivityItem {
                subagent_id: "sub_1".into(),
                parent_session_id: "ses_parent_sub".into(),
                kind: "review".into(),
                label: "reviewer".into(),
                role: "reviewer".into(),
                status: "failed".into(),
                live_status: None,
                started_at_ms: 0,
            }],
            ..Default::default()
        });
        app.activity_dashboard.active_tab = ActivityTab::Runners; // different tab!
        app.activity_dashboard.pending_actions.clear();
        app.handle_activity_dashboard_key(KeyCode::Char('a'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::SwitchSession { target_session_id, .. }
                if target_session_id == "ses_parent_sub"
        )));

        // 6d: Ownerless failed background task focuses that row in BgTasks tab.
        app.open_activity_dashboard(ActivityTab::MySwarm);
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![sample_member("ses_coord", "coord", "running", None)],
            background_tasks: vec![BackgroundTaskActivityItem {
                task_id: "bg_orphan_fail".into(),
                tool_name: "bash".into(),
                display_name: Some("orphan test".into()),
                session_id: String::new(),
                status: "failed".into(),
                ..Default::default()
            }],
            ..Default::default()
        });
        app.handle_activity_dashboard_key(KeyCode::Char('a'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.open);
        assert_eq!(app.activity_dashboard.active_tab, ActivityTab::BgTasks);
        let (rows, _) = app.activity_dashboard_rows();
        assert!(matches!(
            rows.get(app.activity_dashboard.selected_index).map(|r| &r.kind),
            Some(ActivityRowKind::BackgroundTask { item }) if item.task_id == "bg_orphan_fail"
        ));

        // 6d: Failed runner without session_id focuses that row in Runners tab.
        app.activity_dashboard.active_tab = ActivityTab::MySwarm;
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![sample_member("ses_coord", "coord", "running", None)],
            runners: vec![AutonomousRunnerItem {
                id: "overnight_9".into(),
                kind: AutonomousRunnerKind::Overnight,
                title: "nightly-9".into(),
                status: "failed".into(),
                detail: None,
                step_current: None,
                step_total: None,
                elapsed_secs: Some(5),
                next_run_secs: None,
                session_id: None,
            }],
            ..Default::default()
        });
        app.handle_activity_dashboard_key(KeyCode::Char('a'), KeyModifiers::NONE);
        assert_eq!(app.activity_dashboard.active_tab, ActivityTab::Runners);
        let (rows, _) = app.activity_dashboard_rows();
        assert!(matches!(
            rows.get(app.activity_dashboard.selected_index).map(|r| &r.kind),
            Some(ActivityRowKind::Runner { item }) if item.id == "overnight_9"
        ));

        // 6d: Offline/fallback `remote_swarm_members` with attention works when snapshot is None.
        app.activity_dashboard.snapshot = None;
        app.activity_dashboard.active_tab = ActivityTab::Runners;
        app.activity_dashboard.pending_actions.clear();
        let mut offline_attn = sample_member("ses_offline_attn", "offline-w", "failed", Some("ses_coord"));
        offline_attn.runtime.pending_attention = Some(AgentAttention {
            kind: AgentAttentionKind::Failed,
            summary: "build crashed".into(),
            request_id: None,
            since_epoch_ms: None,
        });
        app.remote_swarm_members = vec![
            sample_member("ses_coord", "coord", "running", None),
            offline_attn,
        ];
        app.handle_activity_dashboard_key(KeyCode::Char('a'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::SwitchSession { target_session_id, .. }
                if target_session_id == "ses_offline_attn"
        )));
    }

    #[test]
    fn selection_tree_scroll_peek_scroll_and_snapshot_shrink_7a_7b_7c() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.remote_session_id = Some("ses_0".to_string());

        // 7a: Wrapped fallback peek lines are scrollable with exact wrapped visual line bounds.
        let mut w0 = sample_member("ses_0", "w0", "running", None);
        // 8 raw lines that each wrap into ~3 visual lines in a ~60-col peek pane.
        w0.output_tail = Some(
            (0..8)
                .map(|i| format!("line-{i}: {}", "abcdefghij ".repeat(14)))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let mut members = vec![w0];
        for i in 1..15 {
            members.push(sample_member(
                &format!("ses_{i}"),
                &format!("worker-{i:02}"),
                "running",
                Some("ses_0"),
            ));
        }
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: members,
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        assert!(app.activity_dashboard.peek.is_none(), "using fallback peek");

        // Render into a 120x12 viewport (small tree height so tree scrolling activates).
        let backend = ratatui::backend::TestBackend::new(120, 12);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| crate::tui::ui::draw(frame, &app))
            .unwrap();
        let metrics = app.activity_dashboard.layout_metrics.get();
        assert!(metrics.tree_visible_rows > 0 && metrics.tree_visible_rows < 15);
        assert!(
            metrics.peek_wrapped_lines > 8,
            "expected long fallback lines to wrap into more than 8 visual lines, got {}",
            metrics.peek_wrapped_lines
        );

        let expected_max = metrics
            .peek_wrapped_lines
            .saturating_sub(metrics.peek_tail_height);
        app.handle_activity_dashboard_key(KeyCode::Char('K'), KeyModifiers::NONE);
        assert!(!app.activity_dashboard.peek_follow);
        assert_eq!(
            app.activity_dashboard.peek_scroll,
            expected_max.saturating_sub(3)
        );
        app.handle_activity_dashboard_key(KeyCode::Char('J'), KeyModifiers::NONE);
        assert_eq!(app.activity_dashboard.peek_scroll, expected_max);

        // 7c: Downward navigation persists tree_scroll, and upward navigation keeps scroll stable.
        for _ in 0..10 {
            app.handle_activity_dashboard_key(KeyCode::Down, KeyModifiers::NONE);
        }
        let scroll_after_down = app.activity_dashboard.tree_scroll;
        assert!(
            scroll_after_down > 0,
            "tree_scroll must persist downward past viewport"
        );
        app.handle_activity_dashboard_key(KeyCode::Up, KeyModifiers::NONE);
        assert_eq!(
            app.activity_dashboard.tree_scroll, scroll_after_down,
            "moving up one row inside viewport must not shift tree_scroll"
        );
        app.handle_activity_dashboard_key(KeyCode::Char('G'), KeyModifiers::NONE);
        let (rows, _) = app.activity_dashboard_rows();
        assert_eq!(app.activity_dashboard.selected_index, rows.len() - 1);
        assert_eq!(
            app.activity_dashboard.tree_scroll,
            rows.len().saturating_sub(metrics.tree_visible_rows)
        );

        // 7b: SectionHeader never renders an old live peek; snapshot shrink/empty clears stale peek.
        app.activity_dashboard.peek = Some(SessionPeekPayload {
            target: PeekTarget::Session {
                session_id: "ses_14".into(),
            },
            title: "stale".into(),
            subtitle: None,
            live_status: None,
            model: None,
            provider: None,
            context_used: None,
            context_limit: None,
            tokens_per_sec: None,
            attention: None,
            todos: Vec::new(),
            files_touched: Vec::new(),
            output_lines: vec!["old".into()],
            updated_at_ms: 1,
        });
        app.activity_dashboard.peek_target_sent = Some(PeekTarget::Session {
            session_id: "ses_14".into(),
        });
        app.activity_dashboard.peek_debounce_until = None;
        app.activity_dashboard.selected_index = 0; // SectionHeader
        assert!(
            app.build_activity_dashboard_render_data().peek.is_none(),
            "SectionHeader must not render a stale live peek"
        );

        // Snapshot shrink changes selected row's target from ses_14 -> ses_1 -> re-peeks immediately.
        app.activity_dashboard.selected_index = 14;
        app.activity_dashboard.pending_actions.clear();
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![
                sample_member("ses_0", "w0", "running", None),
                sample_member("ses_1", "w1", "running", Some("ses_0")),
            ],
            ..Default::default()
        });
        app.sync_activity_dashboard_after_snapshot();
        assert!(app.activity_dashboard.peek.is_none());
        assert_eq!(
            app.activity_dashboard.peek_target_sent,
            Some(PeekTarget::Session {
                session_id: "ses_1".into()
            })
        );
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            DashboardRemoteAction::Peek(Some(PeekTarget::Session { session_id }))
                if session_id == "ses_1"
        )));

        // Snapshot shrinking to empty clears peek and sends Peek(None).
        app.activity_dashboard.pending_actions.clear();
        app.activity_dashboard
            .apply_snapshot(ProjectActivitySnapshot::default());
        app.sync_activity_dashboard_after_snapshot();
        assert!(app.activity_dashboard.peek.is_none());
        assert!(app.activity_dashboard.peek_target_sent.is_none());
        assert!(app
            .activity_dashboard
            .pending_actions
            .iter()
            .any(|a| matches!(a, DashboardRemoteAction::Peek(None))));
    }

    #[test]
    fn local_mode_never_enqueues_daemon_actions_and_guards_enter_and_bg_cancel() {
        let mut app = create_test_app();
        app.is_remote = false;
        app.remote_swarm_members = vec![
            sample_member(&app.session.id, "self", "running", None),
            sample_member("ses_other", "other", "running", Some(&app.session.id)),
        ];
        app.upsert_running_background_task("bg_local_1".into(), "cargo check".into(), None);

        app.open_activity_dashboard(ActivityTab::All);
        assert!(app.activity_dashboard.pending_actions.is_empty());

        // Enter on another member in local mode must NOT push return stack or SwitchSession.
        let (rows, _) = app.activity_dashboard_rows();
        app.activity_dashboard.selected_index = rows
            .iter()
            .position(|r| r.target_session_id.as_deref() == Some("ses_other"))
            .expect("ses_other row present");
        app.handle_activity_dashboard_key(KeyCode::Enter, KeyModifiers::NONE);
        assert!(app.session_return_stack.is_empty());
        assert!(app.activity_dashboard.pending_actions.is_empty());
        assert!(app.activity_dashboard.open);
        assert!(app
            .activity_dashboard
            .status_banner
            .as_deref()
            .is_some_and(|b| b.contains("connected daemon")));

        // Local background task cancel (`x` -> `y`) does NOT queue remote action.
        app.handle_activity_dashboard_key(KeyCode::Char('4'), KeyModifiers::NONE);
        app.handle_activity_dashboard_key(KeyCode::Char('x'), KeyModifiers::NONE);
        app.handle_activity_dashboard_key(KeyCode::Char('y'), KeyModifiers::NONE);
        assert!(app.activity_dashboard.pending_actions.is_empty());
        assert!(app
            .activity_dashboard
            .status_banner
            .as_deref()
            .is_some_and(|b| b.contains("Cancelling task")));

        app.close_activity_dashboard();
        assert!(app.activity_dashboard.pending_actions.is_empty());
    }

    #[test]
    fn question_dialog_hides_dashboard_and_does_not_swallow_ctrl_c() {
        let mut app = create_test_app();
        app.is_remote = true;
        app.open_activity_dashboard(ActivityTab::All);
        app.question_dialog = Some(crate::tui::app::question::QuestionDialog::new(
            "ses_1".into(),
            "req_1".into(),
            vec![rayucode_tool_types::questions::Question {
                header: "Confirm".into(),
                question: "Proceed?".into(),
                options: vec![],
                multi_select: false,
            }],
        ));
        assert!(
            !app.handle_activity_dashboard_key(KeyCode::Char('c'), KeyModifiers::CONTROL),
            "dashboard must not swallow Ctrl+C while question_dialog hides it"
        );
    }
}
