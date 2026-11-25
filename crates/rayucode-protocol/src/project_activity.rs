//! Wire types for the Unified Project Activity Dashboard and Live Session Peek.

use serde::{Deserialize, Serialize};

use crate::{SwarmLiveStatus, SwarmMemberStatus, SwarmTodoItem};

/// Kind of user or operator attention currently required by an agent.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentAttentionKind {
    Permission,
    Question,
    Stdin,
    Stalled,
    Failed,
}

/// Actionable attention signal attached to a session or surfaced in the activity summary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentAttention {
    pub kind: AgentAttentionKind,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since_epoch_ms: Option<u64>,
}

/// Lightweight project-scoped activity counts pushed to clients for footer badges.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ProjectActivitySummary {
    pub active_agents: usize,
    pub total_agents: usize,
    pub running_bg_tasks: usize,
    pub active_watchers: usize,
    pub active_runners: usize,
    pub attention_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_attention: Option<AgentAttention>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_runtime_note: Option<String>,
}

/// Active or recently finished in-process subagent run (`subagent`, `/review`, `/judge`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SubagentActivityItem {
    pub subagent_id: String,
    pub parent_session_id: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub role: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_status: Option<SwarmLiveStatus>,
    #[serde(default)]
    pub started_at_ms: u64,
}

/// Background task or swarm-await watcher belonging to the active project.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackgroundTaskActivityItem {
    pub task_id: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_label: Option<String>,
    pub status: String,
    #[serde(default)]
    pub elapsed_secs: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_label: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stalled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_watcher: bool,
}

/// Kind of autonomous background runner tracked for the project.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousRunnerKind {
    Overnight,
    Ambient,
    Reminder,
}

/// Autonomous runner or scheduled reminder item projected into the dashboard.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AutonomousRunnerItem {
    pub id: String,
    pub kind: AutonomousRunnerKind,
    pub title: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_current: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_total: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_secs: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_secs: Option<u64>,
}

/// Compact summary of one active swarm plan DAG for dashboard headers.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SwarmPlanSummary {
    pub swarm_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swarm_label: Option<String>,
    #[serde(default)]
    pub total: usize,
    #[serde(default)]
    pub done: usize,
    #[serde(default)]
    pub running: usize,
    #[serde(default)]
    pub blocked: usize,
    #[serde(default)]
    pub failed: usize,
}

/// Full project-scoped activity snapshot rendered by the Project Activity Dashboard.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectActivitySnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default)]
    pub summary: ProjectActivitySummary,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub my_swarm_members: Vec<SwarmMemberStatus>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subagents: Vec<SubagentActivityItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub peer_sessions: Vec<SwarmMemberStatus>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub swarm_plans: Vec<SwarmPlanSummary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub background_tasks: Vec<BackgroundTaskActivityItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runners: Vec<AutonomousRunnerItem>,
    #[serde(default)]
    pub generated_at_ms: u64,
}

/// Target selected for live inspection in the dashboard Peek pane.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PeekTarget {
    Session { session_id: String },
    BackgroundTask { task_id: String },
    Overnight { run_id: String },
    Ambient,
}

/// Live inspector payload streamed to a client peeking an agent, task, or runner.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionPeekPayload {
    pub target: PeekTarget,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_status: Option<SwarmLiveStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_used: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_limit: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_per_sec: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attention: Option<AgentAttention>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub todos: Vec<SwarmTodoItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_touched: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub output_lines: Vec<String>,
    #[serde(default)]
    pub updated_at_ms: u64,
}
