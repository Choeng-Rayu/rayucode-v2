//! Project-scoped activity aggregation for the Unified TUI Dashboard.
//!
//! Collects all live sessions, swarms, subagents, background tasks, swarm-await
//! watchers, Overnight runs, Ambient cycles, scheduled reminders, and active
//! runtime internals scoped to a canonical git repository root (so git
//! worktrees created by swarms or Overnight runs group with the main checkout).

use super::attention_registry::{self, now_epoch_ms};
use super::await_members_state::{self, PersistedAwaitMembersState};
use super::swarm::{self, NonBlockingSessionMeta};
use super::{AwaitMembersRuntime, FileTouchService, SessionAgents, SwarmMember, VersionedPlan};
use crate::ambient::{AmbientManager, AmbientState, AmbientStatus, ScheduleTarget};
use crate::ambient_runner::AmbientRunnerHandle;
use crate::background::TaskStatusFile;
use crate::bus::BackgroundTaskStatus;
use crate::overnight::{self, OvernightManifest, OvernightRunStatus};
use crate::protocol::{
    AutonomousRunnerItem, AutonomousRunnerKind, BackgroundTaskActivityItem,
    ProjectActivitySnapshot, ProjectActivitySummary, SwarmMemberRuntime, SwarmMemberStatus,
    SwarmPlanSummary,
};
use chrono::{DateTime, Utc};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const PROJECT_ROOT_CACHE_TTL: Duration = Duration::from_secs(10);
const SESSION_STUB_WDIR_CACHE_TTL: Duration = Duration::from_secs(30);
const BG_TERMINAL_RETENTION_SECS: i64 = 10 * 60;
const BG_TERMINAL_CAP: usize = 15;
const OVERNIGHT_TERMINAL_RETENTION_SECS: i64 = 24 * 60 * 60;
const OVERNIGHT_TERMINAL_CAP: usize = 3;
const FILES_TOUCHED_CAP: usize = 12;

static GLOBAL_AMBIENT_RUNNER: LazyLock<StdRwLock<Option<AmbientRunnerHandle>>> =
    LazyLock::new(|| StdRwLock::new(None));

#[derive(Clone)]
struct CachedProjectRoot {
    cached_at: Instant,
    root: PathBuf,
    branch: Option<String>,
}

static PROJECT_ROOT_CACHE: LazyLock<StdMutex<HashMap<PathBuf, CachedProjectRoot>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

#[derive(Clone)]
struct CachedSessionStub {
    cached_at: Instant,
    working_dir: Option<PathBuf>,
    short_name: Option<String>,
}

static SESSION_STUB_WDIR_CACHE: LazyLock<StdMutex<HashMap<String, CachedSessionStub>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// Register the daemon's [`AmbientRunnerHandle`] so project activity snapshots
/// and live peek can inspect live ambient status without extra wiring across
/// every client handler signature.
pub(super) fn register_ambient_runner(handle: AmbientRunnerHandle) {
    if let Ok(mut slot) = GLOBAL_AMBIENT_RUNNER.write() {
        *slot = Some(handle);
    }
}

pub(super) fn current_ambient_runner() -> Option<AmbientRunnerHandle> {
    GLOBAL_AMBIENT_RUNNER
        .read()
        .ok()
        .and_then(|slot| slot.clone())
}

/// Shared handle bundle needed to assemble project-scoped activity snapshots
/// and live peek payloads without blocking on any `Agent` mutex.
#[derive(Clone)]
pub(super) struct ProjectActivityContext {
    pub sessions: SessionAgents,
    pub swarm_members: Arc<RwLock<HashMap<String, SwarmMember>>>,
    pub swarm_plans: Arc<RwLock<HashMap<String, VersionedPlan>>>,
    pub file_touch: FileTouchService,
    pub await_members_runtime: AwaitMembersRuntime,
    pub ambient_runner: Option<AmbientRunnerHandle>,
}

/// Resolve the canonical project root and current git branch for `path`.
///
/// Uses git common-dir resolution so linked git worktrees map to the exact same
/// project root as the main repository checkout. Cached in memory to avoid
/// repeated filesystem walks on every debounced refresh.
pub(crate) fn canonical_project_root_and_branch(path: &Path) -> (PathBuf, Option<String>) {
    if let Ok(cache) = PROJECT_ROOT_CACHE.lock()
        && let Some(entry) = cache.get(path)
        && entry.cached_at.elapsed() < PROJECT_ROOT_CACHE_TTL
    {
        return (entry.root.clone(), entry.branch.clone());
    }

    let path_owned = path.to_path_buf();
    let (root, branch) = super::run_blocking_io(move || {
        let root = resolve_project_root_uncached(&path_owned);
        let branch = resolve_git_branch_uncached(&path_owned);
        (root, branch)
    });

    if let Ok(mut cache) = PROJECT_ROOT_CACHE.lock() {
        if cache.len() > 512 {
            cache.retain(|_, entry| entry.cached_at.elapsed() < PROJECT_ROOT_CACHE_TTL);
        }
        cache.insert(
            path.to_path_buf(),
            CachedProjectRoot {
                cached_at: Instant::now(),
                root: root.clone(),
                branch: branch.clone(),
            },
        );
    }

    (root, branch)
}

pub(crate) fn canonical_project_root(path: &Path) -> PathBuf {
    canonical_project_root_and_branch(path).0
}

fn canonicalize_or(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).unwrap_or(path)
}

fn resolve_project_root_uncached(path: &Path) -> PathBuf {
    if let Some(common_dir) = super::util::git_common_dir_for(path) {
        if common_dir.file_name().and_then(|s| s.to_str()) == Some(".git")
            && let Some(parent) = common_dir.parent()
        {
            return canonicalize_or(parent.to_path_buf());
        }
        return canonicalize_or(common_dir);
    }
    canonicalize_or(path.to_path_buf())
}

fn resolve_git_branch_uncached(path: &Path) -> Option<String> {
    let mut current = Some(path);
    while let Some(dir) = current {
        let dotgit = dir.join(".git");
        let head_path = if dotgit.is_dir() {
            Some(dotgit.join("HEAD"))
        } else if dotgit.is_file() {
            std::fs::read_to_string(&dotgit).ok().and_then(|content| {
                let raw = content
                    .lines()
                    .find(|line| line.trim_start().starts_with("gitdir:"))?
                    .trim_start()
                    .trim_start_matches("gitdir:")
                    .trim();
                if raw.is_empty() {
                    return None;
                }
                let gitdir = if Path::new(raw).is_absolute() {
                    PathBuf::from(raw)
                } else {
                    dir.join(raw)
                };
                Some(gitdir.join("HEAD"))
            })
        } else {
            None
        };

        if let Some(head_path) = head_path {
            let head = std::fs::read_to_string(&head_path).ok()?;
            let trimmed = head.trim();
            if let Some(branch) = trimmed.strip_prefix("ref: refs/heads/") {
                let branch = branch.trim();
                return (!branch.is_empty()).then(|| branch.to_string());
            }
            if let Some(rest) = trimmed.strip_prefix("ref: ") {
                let rest = rest.trim();
                return (!rest.is_empty()).then(|| rest.to_string());
            }
            if trimmed.len() >= 7 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(trimmed.chars().take(7).collect());
            }
            return None;
        }

        current = dir.parent();
    }
    None
}

fn cached_session_stub(session_id: &str) -> (Option<PathBuf>, Option<String>) {
    if let Ok(cache) = SESSION_STUB_WDIR_CACHE.lock()
        && let Some(entry) = cache.get(session_id)
        && entry.cached_at.elapsed() < SESSION_STUB_WDIR_CACHE_TTL
    {
        return (entry.working_dir.clone(), entry.short_name.clone());
    }
    let sid = session_id.to_string();
    let (working_dir, short_name) = super::run_blocking_io(move || {
        crate::session::Session::load_startup_stub(&sid)
            .ok()
            .map(|stub| (stub.working_dir.map(PathBuf::from), stub.short_name))
            .unwrap_or((None, None))
    });
    if let Ok(mut cache) = SESSION_STUB_WDIR_CACHE.lock() {
        if cache.len() > 1024 {
            cache.retain(|_, entry| entry.cached_at.elapsed() < SESSION_STUB_WDIR_CACHE_TTL);
        }
        cache.insert(
            session_id.to_string(),
            CachedSessionStub {
                cached_at: Instant::now(),
                working_dir: working_dir.clone(),
                short_name: short_name.clone(),
            },
        );
    }
    (working_dir, short_name)
}

fn cached_stub_working_dir(session_id: &str) -> Option<PathBuf> {
    cached_session_stub(session_id).0
}

fn cached_stub_short_name(session_id: &str) -> Option<String> {
    cached_session_stub(session_id).1
}

fn resolve_session_working_dir(
    session_id: &str,
    members: &HashMap<String, SwarmMember>,
    sessions: &SessionAgents,
) -> Option<PathBuf> {
    if let Some(dir) = members
        .get(session_id)
        .and_then(|member| member.working_dir.clone())
    {
        return Some(dir);
    }
    if let Ok(agents) = sessions.try_read()
        && let Some(agent) = agents.get(session_id)
        && let Ok(guard) = agent.try_lock()
        && let Some(dir) = guard.working_dir()
    {
        return Some(PathBuf::from(dir));
    }
    cached_stub_working_dir(session_id)
}

fn member_is_active(member: &SwarmMemberStatus) -> bool {
    if matches!(
        member.status.as_str(),
        "running" | "streaming" | "thinking"
    ) {
        return true;
    }
    member.runtime.live_status.as_ref().is_some_and(|live| {
        matches!(
            live.phase.as_str(),
            "sending" | "connecting" | "streaming" | "thinking" | "running_tool" | "compacting"
        )
    })
}

fn synthesize_non_member_status(
    session_id: &str,
    mut files_touched: Vec<String>,
    meta: &NonBlockingSessionMeta,
) -> SwarmMemberStatus {
    files_touched.truncate(FILES_TOUCHED_CAP);
    let live_status = super::live_status::snapshot(session_id);
    let is_running = crate::turn_cancel_registry::has_active_turn(session_id)
        || live_status.as_ref().is_some_and(|ls| {
            matches!(
                ls.phase.as_str(),
                "sending" | "connecting" | "streaming" | "thinking" | "running_tool" | "compacting"
            )
        });
    let status = if is_running { "running" } else { "ready" }.to_string();
    let stalled_secs = super::swarm_watchdog::stalled_for_secs(session_id);
    let pending_attention =
        attention_registry::effective_attention_for_member(session_id, &status, None, stalled_secs);
    let tokens = crate::session_metrics::token_totals(session_id);
    let wait = crate::wait_registry::current(session_id);
    let context_limit = meta.context_limit.or_else(|| {
        meta.model
            .as_deref()
            .and_then(crate::provider::models::context_limit_for_model)
            .map(|limit| limit as u64)
    });
    let context_tokens = tokens
        .map(|(context, _)| context)
        .filter(|t| *t > 0)
        .or_else(|| {
            live_status
                .as_ref()
                .and_then(|ls| ls.input_tokens)
                .filter(|t| *t > 0)
        });
    let output_tokens = tokens
        .map(|(_, output)| output)
        .filter(|t| *t > 0)
        .or_else(|| {
            live_status
                .as_ref()
                .and_then(|ls| ls.output_tokens)
                .filter(|t| *t > 0)
        });

    let friendly_name = cached_stub_short_name(session_id);

    SwarmMemberStatus {
        session_id: session_id.to_string(),
        friendly_name,
        status,
        detail: None,
        task_label: None,
        role: Some("agent".to_string()),
        is_headless: Some(false),
        live_attachments: None,
        status_age_secs: None,
        output_tail: None,
        report_back_to_session_id: None,
        todo_progress: None,
        todo_items: Vec::new(),
        runtime: SwarmMemberRuntime {
            live_status,
            wait_reason: wait.as_ref().map(|(reason, _)| reason.clone()),
            wait_age_secs: wait.map(|(_, age)| age),
            model: meta.model.clone(),
            provider: meta.provider.clone(),
            activity_age_secs: crate::session_metrics::last_activity_age_secs(session_id),
            context_tokens,
            context_limit,
            output_tokens,
            stalled_secs,
            files_touched,
            pending_attention,
            ..Default::default()
        },
    }
}

fn summarize_plan(swarm_id: &str, plan: &VersionedPlan) -> SwarmPlanSummary {
    let mut done_ids: HashSet<&str> = HashSet::new();
    let mut done = 0usize;
    let mut running = 0usize;
    let mut failed = 0usize;
    let mut blocked = 0usize;

    for item in &plan.items {
        if matches!(item.status.as_str(), "completed" | "done") {
            done += 1;
            done_ids.insert(item.id.as_str());
        }
    }

    for item in &plan.items {
        match item.status.as_str() {
            "completed" | "done" => {}
            "in_progress" | "running" => running += 1,
            "failed" | "cancelled" | "error" => failed += 1,
            "blocked" => blocked += 1,
            _ => {
                if !item.blocked_by.is_empty()
                    && item
                        .blocked_by
                        .iter()
                        .any(|dep| !done_ids.contains(dep.as_str()))
                {
                    blocked += 1;
                }
            }
        }
    }

    SwarmPlanSummary {
        swarm_id: swarm_id.to_string(),
        swarm_label: super::swarm_labels::swarm_label(swarm_id),
        total: plan.items.len(),
        done,
        running,
        blocked,
        failed,
    }
}

fn parse_rfc3339(ts: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn task_status_label(task: &TaskStatusFile) -> &'static str {
    match task.status {
        BackgroundTaskStatus::Running => "running",
        BackgroundTaskStatus::Completed => "completed",
        BackgroundTaskStatus::Superseded => "superseded",
        BackgroundTaskStatus::Failed => {
            if task.error.as_deref() == Some("Cancelled by user") {
                "cancelled"
            } else {
                "failed"
            }
        }
    }
}

async fn task_is_stalled(task: &TaskStatusFile, now: DateTime<Utc>) -> bool {
    if task.status != BackgroundTaskStatus::Running {
        return false;
    }
    let Some(stall_secs) = task.stall_wake_seconds.filter(|s| *s > 0) else {
        return false;
    };
    let last_activity = task
        .progress
        .as_ref()
        .and_then(|p| parse_rfc3339(&p.updated_at))
        .or_else(|| {
            task.event_history
                .last()
                .and_then(|ev| parse_rfc3339(&ev.timestamp))
        })
        .or_else(|| parse_rfc3339(&task.started_at));
    let Some(last_activity) = last_activity else {
        return false;
    };
    let output_path = crate::background::global().output_path_for(&task.task_id);
    let file_mtime = tokio::fs::metadata(&output_path)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .map(DateTime::<Utc>::from);
    let freshest = match file_mtime {
        Some(mt) if mt > last_activity => mt,
        _ => last_activity,
    };
    (now - freshest).num_seconds() >= stall_secs as i64
}

async fn project_bg_task(
    task: &TaskStatusFile,
    owner_labels: &HashMap<String, String>,
    now: DateTime<Utc>,
) -> BackgroundTaskActivityItem {
    let elapsed_secs = if task.status == BackgroundTaskStatus::Running {
        parse_rfc3339(&task.started_at)
            .map(|started| (now - started).num_seconds().max(0) as u64)
            .unwrap_or(0)
    } else if let Some(duration) = task.duration_secs {
        duration.max(0.0).round() as u64
    } else {
        match (
            parse_rfc3339(&task.started_at),
            task.completed_at.as_deref().and_then(parse_rfc3339),
        ) {
            (Some(started), Some(completed)) => (completed - started).num_seconds().max(0) as u64,
            _ => 0,
        }
    };

    let progress_percent = task
        .progress
        .as_ref()
        .and_then(|p| p.percent)
        .map(|pct| pct.clamp(0.0, 100.0).round() as u8);
    let progress_label = task
        .progress
        .as_ref()
        .map(crate::background::format_progress_summary)
        .filter(|s| !s.trim().is_empty());

    let owner_label = owner_labels.get(&task.session_id).cloned().or_else(|| {
        (!task.session_id.is_empty())
            .then(|| task.session_id[..8.min(task.session_id.len())].to_string())
    });

    BackgroundTaskActivityItem {
        task_id: task.task_id.clone(),
        tool_name: task.tool_name.clone(),
        display_name: task.display_name.clone(),
        session_id: task.session_id.clone(),
        owner_label,
        status: task_status_label(task).to_string(),
        elapsed_secs,
        progress_percent,
        progress_label,
        stalled: task_is_stalled(task, now).await,
        exit_code: task.exit_code,
        is_watcher: false,
    }
}

fn project_await_watcher(
    state: &PersistedAwaitMembersState,
    owner_labels: &HashMap<String, String>,
    now_ms: u64,
) -> BackgroundTaskActivityItem {
    let elapsed_secs = now_ms.saturating_sub(state.created_at_unix_ms) / 1000;
    let remaining_secs = state.deadline_unix_ms.saturating_sub(now_ms) / 1000;
    let target_count = state.requested_ids.len();
    let subject = if target_count == 1 {
        "waiting on 1 worker".to_string()
    } else if target_count > 1 {
        format!("waiting on {target_count} workers")
    } else {
        "waiting on swarm members".to_string()
    };
    let display_name = if state.target_status.is_empty() {
        subject
    } else {
        format!("{subject} ({})", state.target_status.join("/"))
    };
    let progress_label = Some(format!("timeout in {}", format_compact_duration(remaining_secs)));
    let owner_label = owner_labels.get(&state.session_id).cloned().or_else(|| {
        (!state.session_id.is_empty())
            .then(|| state.session_id[..8.min(state.session_id.len())].to_string())
    });

    BackgroundTaskActivityItem {
        task_id: format!("await:{}", state.key),
        tool_name: "swarm_await".to_string(),
        display_name: Some(display_name),
        session_id: state.session_id.clone(),
        owner_label,
        status: "running".to_string(),
        elapsed_secs,
        progress_percent: None,
        progress_label,
        stalled: false,
        exit_code: None,
        is_watcher: true,
    }
}

fn format_compact_duration(secs: u64) -> String {
    if secs >= 3600 {
        format!("{}h{}m", secs / 3600, (secs % 3600) / 60)
    } else if secs >= 60 {
        format!("{}m", secs / 60)
    } else {
        format!("{secs}s")
    }
}

fn cap_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn load_overnight_runners(
    project_root: Option<&Path>,
    project_session_ids: &HashSet<String>,
    now: DateTime<Utc>,
) -> Vec<AutonomousRunnerItem> {
    let Ok(root) = overnight::runs_dir() else {
        return Vec::new();
    };
    if !root.exists() {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };

    let mut manifests: Vec<OvernightManifest> = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        let Ok(manifest) = crate::storage::read_json::<OvernightManifest>(&manifest_path) else {
            continue;
        };
        let matches_project = project_session_ids.contains(&manifest.parent_session_id)
            || project_session_ids.contains(&manifest.coordinator_session_id)
            || match (project_root, manifest.working_dir.as_deref()) {
                (Some(expected), Some(dir)) => canonical_project_root(Path::new(dir)) == expected,
                (None, _) => true,
                (Some(_), None) => false,
            };
        if !matches_project {
            continue;
        }
        manifests.push(manifest);
    }

    manifests.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    let mut items = Vec::new();
    let mut terminal_count = 0usize;
    for manifest in manifests {
        let is_active = matches!(
            manifest.status,
            OvernightRunStatus::Running | OvernightRunStatus::CancelRequested
        );
        if !is_active {
            let ended_at = manifest.completed_at.unwrap_or(manifest.last_activity_at);
            if (now - ended_at).num_seconds() > OVERNIGHT_TERMINAL_RETENTION_SECS
                || terminal_count >= OVERNIGHT_TERMINAL_CAP
            {
                continue;
            }
            terminal_count += 1;
        }

        let summary = overnight::summarize_task_cards(&manifest);
        let title = manifest
            .mission
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| cap_chars(s, 72))
            .unwrap_or_else(|| manifest.run_id.clone());
        let elapsed_secs = (manifest.completed_at.unwrap_or(now) - manifest.started_at)
            .num_seconds()
            .max(0) as u64;
        let detail = summary
            .latest_title
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| Some(format!("{} · {}", manifest.provider_name, manifest.model)));

        items.push(AutonomousRunnerItem {
            id: manifest.run_id.clone(),
            kind: AutonomousRunnerKind::Overnight,
            title,
            status: manifest.status.label().to_string(),
            step_current: (summary.total > 0).then_some(summary.counts.completed as u32),
            step_total: (summary.total > 0).then_some(summary.total as u32),
            detail,
            next_run_secs: None,
            session_id: Some(manifest.coordinator_session_id.clone()),
            elapsed_secs: Some(elapsed_secs),
        });
    }
    items
}

async fn load_ambient_and_reminder_runners(
    ambient_runner: Option<&AmbientRunnerHandle>,
    project_root: Option<&Path>,
    project_session_ids: &HashSet<String>,
    now: DateTime<Utc>,
) -> Vec<AutonomousRunnerItem> {
    let mut items = Vec::new();
    let ambient_enabled = crate::config::config().ambient.enabled;
    let state = match ambient_runner {
        Some(runner) => runner.state().await,
        None => super::run_blocking_io(|| AmbientState::load().unwrap_or_default()),
    };

    let queue_items = super::run_blocking_io(|| {
        AmbientManager::new()
            .ok()
            .map(|mgr| mgr.queue().items().to_vec())
            .unwrap_or_default()
    });

    let show_ambient = ambient_enabled || matches!(state.status, AmbientStatus::Running { .. });
    if show_ambient {
        let (status, detail, next_run_secs) = match &state.status {
            AmbientStatus::Running { detail } => ("running".to_string(), Some(detail.clone()), None),
            AmbientStatus::Scheduled { next_wake } => {
                let secs = (*next_wake - now).num_seconds().max(0) as u64;
                (
                    "scheduled".to_string(),
                    state.last_summary.clone(),
                    Some(secs),
                )
            }
            AmbientStatus::Paused { reason } => ("paused".to_string(), Some(reason.clone()), None),
            AmbientStatus::Idle => ("idle".to_string(), state.last_summary.clone(), None),
            AmbientStatus::Disabled => ("disabled".to_string(), state.last_summary.clone(), None),
        };
        items.push(AutonomousRunnerItem {
            id: "ambient".to_string(),
            kind: AutonomousRunnerKind::Ambient,
            title: "Ambient runner".to_string(),
            status,
            step_current: None,
            step_total: None,
            detail: detail.map(|d| cap_chars(&d, 80)),
            next_run_secs,
            session_id: None,
            elapsed_secs: None,
        });
    }

    let mut reminder_items: Vec<_> = queue_items
        .into_iter()
        .filter(|item| {
            if !item.target.is_direct_delivery() && !ambient_enabled {
                return false;
            }
            let target_session = match &item.target {
                ScheduleTarget::Session { session_id }
                | ScheduleTarget::TodoReview { session_id, .. } => Some(session_id.as_str()),
                ScheduleTarget::Spawn { parent_session_id } => Some(parent_session_id.as_str()),
                ScheduleTarget::Ambient => None,
            };
            if target_session.is_some_and(|sid| project_session_ids.contains(sid))
                || project_session_ids.contains(&item.created_by_session)
            {
                return true;
            }
            match (project_root, item.working_dir.as_deref()) {
                (Some(expected), Some(dir)) => canonical_project_root(Path::new(dir)) == expected,
                (None, _) => true,
                (Some(_), None) => item.target.is_direct_delivery() && project_session_ids.is_empty(),
            }
        })
        .collect();
    reminder_items.sort_by_key(|item| item.scheduled_for);

    for item in reminder_items.into_iter().take(10) {
        let secs_until = (item.scheduled_for - now).num_seconds();
        let overdue = secs_until <= 0;
        let title = item
            .task_description
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&item.context);
        let session_id = match &item.target {
            ScheduleTarget::Session { session_id }
            | ScheduleTarget::TodoReview { session_id, .. } => Some(session_id.clone()),
            ScheduleTarget::Spawn { parent_session_id } => Some(parent_session_id.clone()),
            ScheduleTarget::Ambient => None,
        };
        items.push(AutonomousRunnerItem {
            id: item.id,
            kind: AutonomousRunnerKind::Reminder,
            title: cap_chars(title.trim(), 72),
            status: if overdue { "overdue" } else { "scheduled" }.to_string(),
            step_current: None,
            step_total: None,
            detail: item
                .git_branch
                .clone()
                .or_else(|| Some(format!("{:?}", item.priority).to_ascii_lowercase())),
            next_run_secs: Some(secs_until.max(0) as u64),
            session_id,
            elapsed_secs: None,
        });
    }

    items
}

fn active_runtime_note(
    sessions: &SessionAgents,
    project_session_ids: &HashSet<String>,
    members: &[SwarmMemberStatus],
) -> Option<String> {
    if let Some(build_progress) = super::run_blocking_io(crate::build::read_build_progress) {
        let trimmed = build_progress.trim();
        if !trimmed.is_empty() {
            return Some(format!("build: {}", cap_chars(trimmed, 48)));
        }
    }

    let live_compacting = project_session_ids
        .iter()
        .any(|sid| super::live_status::is_compacting(sid))
        || members.iter().any(|m| {
            m.runtime
                .live_status
                .as_ref()
                .is_some_and(|ls| ls.phase == "compacting")
        });
    if live_compacting {
        return Some("compacting".to_string());
    }

    if let Ok(agents) = sessions.try_read() {
        for sid in project_session_ids {
            if let Some(agent) = agents.get(sid)
                && let Ok(guard) = agent.try_lock()
                && guard
                    .registry()
                    .compaction()
                    .try_read()
                    .is_ok_and(|manager| manager.is_compacting())
            {
                return Some("compacting".to_string());
            }
        }
    }

    None
}

/// Build the full project-scoped [`ProjectActivitySnapshot`] without acquiring
/// any blocking `Agent` mutex.
pub(super) async fn build_snapshot(
    ctx: &ProjectActivityContext,
    caller_session_id: Option<&str>,
    fallback_working_dir: Option<&Path>,
) -> ProjectActivitySnapshot {
    let now = Utc::now();
    let now_ms = now_epoch_ms();

    let members_map = ctx.swarm_members.read().await.clone();
    let live_session_ids: Vec<String> = ctx.sessions.read().await.keys().cloned().collect();
    let plans_map = ctx.swarm_plans.read().await.clone();

    let caller_working_dir = caller_session_id
        .and_then(|sid| resolve_session_working_dir(sid, &members_map, &ctx.sessions))
        .or_else(|| fallback_working_dir.map(Path::to_path_buf));

    let (project_root_path, branch) = match caller_working_dir.as_deref() {
        Some(dir) => {
            let (root, branch) = canonical_project_root_and_branch(dir);
            (Some(root), branch)
        }
        None => (None, None),
    };

    let caller_swarm_id = caller_session_id
        .and_then(|sid| members_map.get(sid))
        .and_then(|m| m.swarm_id.clone());

    let mut candidate_ids: HashSet<String> = members_map.keys().cloned().collect();
    candidate_ids.extend(live_session_ids);

    let mut matching_ids: Vec<String> = Vec::new();
    for sid in candidate_ids {
        let is_caller = caller_session_id == Some(sid.as_str());
        let same_swarm = caller_swarm_id.is_some()
            && members_map
                .get(&sid)
                .and_then(|m| m.swarm_id.as_ref())
                == caller_swarm_id.as_ref();
        let matches = if is_caller || same_swarm {
            true
        } else if let Some(ref expected_root) = project_root_path {
            resolve_session_working_dir(&sid, &members_map, &ctx.sessions)
                .is_some_and(|dir| canonical_project_root(&dir) == *expected_root)
        } else {
            caller_session_id.is_none()
        };
        if matches {
            matching_ids.push(sid);
        }
    }

    let mut my_swarm_members = Vec::new();
    let mut peer_sessions = Vec::new();
    let mut project_session_ids: HashSet<String> = HashSet::new();
    let mut project_swarm_ids: HashSet<String> = HashSet::new();
    let mut owner_labels: HashMap<String, String> = HashMap::new();

    for sid in &matching_ids {
        let files_touched = ctx.file_touch.sorted_file_strings_for_session(sid).await;
        let meta = swarm::try_session_meta(Some(&ctx.sessions), sid);
        let status = if let Some(member) = members_map.get(sid) {
            swarm::build_member_status(member, files_touched, &meta)
        } else {
            synthesize_non_member_status(sid, files_touched, &meta)
        };

        project_session_ids.insert(sid.clone());
        if let Some(ref swarm_id) = status.runtime.swarm_id {
            project_swarm_ids.insert(swarm_id.clone());
        }
        let label = status
            .friendly_name
            .clone()
            .unwrap_or_else(|| sid[..8.min(sid.len())].to_string());
        owner_labels.insert(sid.clone(), label);

        let belongs_to_my_swarm = caller_session_id == Some(sid.as_str())
            || (caller_swarm_id.is_some() && status.runtime.swarm_id == caller_swarm_id)
            || caller_session_id.is_some_and(|caller| {
                swarm::swarm_is_self_or_ancestor(&members_map, caller, sid)
                    || swarm::swarm_is_self_or_ancestor(&members_map, sid, caller)
            });

        if belongs_to_my_swarm {
            my_swarm_members.push(status);
        } else {
            peer_sessions.push(status);
        }
    }

    let sort_members = |list: &mut Vec<SwarmMemberStatus>| {
        list.sort_by(|a, b| {
            let a_caller = caller_session_id == Some(a.session_id.as_str());
            let b_caller = caller_session_id == Some(b.session_id.as_str());
            let a_coord = a.role.as_deref() == Some("coordinator");
            let b_coord = b.role.as_deref() == Some("coordinator");
            let a_active = member_is_active(a);
            let b_active = member_is_active(b);
            b_caller
                .cmp(&a_caller)
                .then_with(|| b_coord.cmp(&a_coord))
                .then_with(|| b_active.cmp(&a_active))
                .then_with(|| a.friendly_name.cmp(&b.friendly_name))
                .then_with(|| a.session_id.cmp(&b.session_id))
        });
    };
    sort_members(&mut my_swarm_members);
    sort_members(&mut peer_sessions);

    let subagents = super::subagent_registry::list_for_parents(&project_session_ids);

    let mut swarm_plans: Vec<SwarmPlanSummary> = project_swarm_ids
        .iter()
        .filter_map(|swarm_id| {
            plans_map
                .get(swarm_id)
                .filter(|plan| !plan.items.is_empty())
                .map(|plan| summarize_plan(swarm_id, plan))
        })
        .collect();
    swarm_plans.sort_by(|a, b| {
        let a_own = caller_swarm_id.as_deref() == Some(a.swarm_id.as_str());
        let b_own = caller_swarm_id.as_deref() == Some(b.swarm_id.as_str());
        b_own
            .cmp(&a_own)
            .then_with(|| a.swarm_id.cmp(&b.swarm_id))
    });

    // Hydrate background tasks from disk/in-memory manager + project await watchers.
    let all_bg_tasks = crate::background::global().list().await;
    let mut running_tasks = Vec::new();
    let mut terminal_tasks: Vec<(DateTime<Utc>, BackgroundTaskActivityItem)> = Vec::new();
    for task in &all_bg_tasks {
        let matches_project = project_session_ids.contains(&task.session_id)
            || match project_root_path.as_deref() {
                Some(expected_root) => {
                    let task_dir = task
                        .working_dir
                        .as_deref()
                        .map(PathBuf::from)
                        .or_else(|| cached_stub_working_dir(&task.session_id));
                    task_dir.is_some_and(|dir| canonical_project_root(&dir) == expected_root)
                }
                None => caller_session_id.is_none(),
            };
        if !matches_project {
            continue;
        }
        if task.status == BackgroundTaskStatus::Running {
            running_tasks.push(project_bg_task(task, &owner_labels, now).await);
        } else {
            let ended_at = task
                .completed_at
                .as_deref()
                .and_then(parse_rfc3339)
                .or_else(|| parse_rfc3339(&task.started_at))
                .unwrap_or(now);
            if (now - ended_at).num_seconds() <= BG_TERMINAL_RETENTION_SECS {
                terminal_tasks.push((ended_at, project_bg_task(task, &owner_labels, now).await));
            }
        }
    }
    terminal_tasks.sort_by(|a, b| b.0.cmp(&a.0));
    terminal_tasks.truncate(BG_TERMINAL_CAP);

    let mut background_tasks = running_tasks;

    // Project active `swarm await_members` waits as watcher rows.
    let pending_awaits = super::run_blocking_io(await_members_state::all_pending_await_members);
    let _active_await_runtime = &ctx.await_members_runtime;
    for state in pending_awaits {
        if project_session_ids.contains(&state.session_id)
            || project_swarm_ids.contains(&state.swarm_id)
        {
            background_tasks.push(project_await_watcher(&state, &owner_labels, now_ms));
        }
    }

    background_tasks.extend(terminal_tasks.into_iter().map(|(_, item)| item));

    // Autonomous runners: Overnight + Ambient + scheduled reminders.
    let project_root_for_overnight = project_root_path.clone();
    let sessions_for_overnight = project_session_ids.clone();
    let mut runners = super::run_blocking_io(move || {
        load_overnight_runners(
            project_root_for_overnight.as_deref(),
            &sessions_for_overnight,
            now,
        )
    });
    let ambient_handle = ctx.ambient_runner.clone().or_else(current_ambient_runner);
    runners.extend(
        load_ambient_and_reminder_runners(
            ambient_handle.as_ref(),
            project_root_path.as_deref(),
            &project_session_ids,
            now,
        )
        .await,
    );

    let all_members_iter = my_swarm_members.iter().chain(peer_sessions.iter());
    let active_member_count = all_members_iter.clone().filter(|m| member_is_active(m)).count();
    let active_subagent_count = subagents.iter().filter(|s| s.status == "running").count();
    let active_agents = active_member_count + active_subagent_count;
    let total_agents = my_swarm_members.len() + peer_sessions.len() + subagents.len();

    let running_bg_tasks = background_tasks
        .iter()
        .filter(|t| !t.is_watcher && t.status == "running")
        .count();
    let active_watchers = background_tasks
        .iter()
        .filter(|t| t.is_watcher && t.status == "running")
        .count();
    let active_runners = runners
        .iter()
        .filter(|r| matches!(r.status.as_str(), "running" | "cancel requested" | "overdue"))
        .count();

    let attentions: Vec<_> = all_members_iter
        .filter_map(|m| m.runtime.pending_attention.clone())
        .collect();
    let attention_count = attentions.len();
    let primary_attention = attention_registry::highest_priority(attentions);

    let mut combined_members_for_runtime: Vec<SwarmMemberStatus> = Vec::new();
    combined_members_for_runtime.extend(my_swarm_members.iter().cloned());
    combined_members_for_runtime.extend(peer_sessions.iter().cloned());
    let active_runtime_note = active_runtime_note(
        &ctx.sessions,
        &project_session_ids,
        &combined_members_for_runtime,
    );

    let summary = ProjectActivitySummary {
        active_agents,
        total_agents,
        running_bg_tasks,
        active_watchers,
        active_runners,
        attention_count,
        primary_attention,
        active_runtime_note,
    };

    ProjectActivitySnapshot {
        project_root: project_root_path.map(|p| p.display().to_string()),
        branch,
        summary,
        my_swarm_members,
        subagents,
        peer_sessions,
        swarm_plans,
        background_tasks,
        runners,
        generated_at_ms: now_ms,
    }
}

#[cfg(test)]
pub(crate) fn clear_caches_for_tests() {
    if let Ok(mut cache) = PROJECT_ROOT_CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = SESSION_STUB_WDIR_CACHE.lock() {
        cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ServerEvent;
    use tokio::sync::mpsc;

    fn make_member(
        session_id: &str,
        working_dir: PathBuf,
        swarm_id: Option<&str>,
        status: &str,
    ) -> SwarmMember {
        let (event_tx, _rx) = mpsc::unbounded_channel::<ServerEvent>();
        let now = Instant::now();
        SwarmMember {
            session_id: session_id.to_string(),
            event_tx,
            event_txs: HashMap::new(),
            working_dir: Some(working_dir),
            swarm_id: swarm_id.map(str::to_string),
            swarm_enabled: swarm_id.is_some(),
            status: status.to_string(),
            detail: None,
            task_label: None,
            friendly_name: Some(session_id.to_string()),
            report_back_to_session_id: None,
            latest_completion_report: None,
            role: "agent".to_string(),
            joined_at: now,
            last_status_change: now,
            is_headless: false,
            output_tail: None,
            todo_progress: None,
            todo_items: Vec::new(),
            runtime: SwarmMemberRuntime::default(),
        }
    }

    #[tokio::test]
    async fn worktree_and_main_repo_share_project_root_while_unrelated_repo_is_excluded() {
        clear_caches_for_tests();
        let temp = tempfile::tempdir().expect("tempdir");
        let main_repo = temp.path().join("repo-a");
        let worktree = temp.path().join("repo-a-wt");
        let other_repo = temp.path().join("repo-b");

        std::fs::create_dir_all(main_repo.join(".git/worktrees/wt1")).unwrap();
        std::fs::write(main_repo.join(".git/HEAD"), "ref: refs/heads/dev\n").unwrap();
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::write(
            worktree.join(".git"),
            format!(
                "gitdir: {}\n",
                main_repo.join(".git/worktrees/wt1").display()
            ),
        )
        .unwrap();
        std::fs::write(
            main_repo.join(".git/worktrees/wt1/HEAD"),
            "ref: refs/heads/feature-wt\n",
        )
        .unwrap();

        std::fs::create_dir_all(other_repo.join(".git")).unwrap();
        std::fs::write(other_repo.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();

        let (root_main, branch_main) = canonical_project_root_and_branch(&main_repo);
        let (root_wt, branch_wt) = canonical_project_root_and_branch(&worktree);
        let (root_other, branch_other) = canonical_project_root_and_branch(&other_repo);

        assert_eq!(root_main, root_wt);
        assert_ne!(root_main, root_other);
        assert_eq!(branch_main.as_deref(), Some("dev"));
        assert_eq!(branch_wt.as_deref(), Some("feature-wt"));
        assert_eq!(branch_other.as_deref(), Some("main"));

        let members = Arc::new(RwLock::new(HashMap::from([
            (
                "caller".into(),
                make_member("caller", main_repo.clone(), Some("swarm-1"), "running"),
            ),
            (
                "worker-wt".into(),
                make_member("worker-wt", worktree.clone(), Some("swarm-1"), "running"),
            ),
            (
                "peer-same-repo".into(),
                make_member("peer-same-repo", worktree.clone(), Some("swarm-2"), "ready"),
            ),
            (
                "other-repo-agent".into(),
                make_member(
                    "other-repo-agent",
                    other_repo.clone(),
                    Some("swarm-other"),
                    "running",
                ),
            ),
        ])));

        let ctx = ProjectActivityContext {
            sessions: Arc::new(super::super::SessionManager::new()),
            swarm_members: members,
            swarm_plans: Arc::new(RwLock::new(HashMap::new())),
            file_touch: FileTouchService::new(),
            await_members_runtime: AwaitMembersRuntime::default(),
            ambient_runner: None,
        };

        let snapshot = build_snapshot(&ctx, Some("caller"), None).await;
        assert_eq!(snapshot.branch.as_deref(), Some("dev"));
        let my_ids: HashSet<_> = snapshot
            .my_swarm_members
            .iter()
            .map(|m| m.session_id.as_str())
            .collect();
        let peer_ids: HashSet<_> = snapshot
            .peer_sessions
            .iter()
            .map(|m| m.session_id.as_str())
            .collect();

        assert_eq!(my_ids, HashSet::from(["caller", "worker-wt"]));
        assert_eq!(peer_ids, HashSet::from(["peer-same-repo"]));
        assert!(!peer_ids.contains("other-repo-agent"));
        assert_eq!(snapshot.summary.active_agents, 2);
        assert_eq!(snapshot.summary.total_agents, 3);
    }

    #[tokio::test]
    async fn hydrates_disk_background_tasks_and_await_watchers_for_project() {
        let _env_lock = crate::storage::lock_test_env();
        let temp_runtime = tempfile::tempdir().expect("runtime dir");
        let prev_runtime = std::env::var_os("RAYU_RUNTIME_DIR");
        crate::env::set_var("RAYU_RUNTIME_DIR", temp_runtime.path());

        clear_caches_for_tests();
        let temp_repo = tempfile::tempdir().expect("repo dir");
        let repo_a = temp_repo.path().join("alpha");
        let repo_b = temp_repo.path().join("beta");
        std::fs::create_dir_all(repo_a.join(".git")).unwrap();
        std::fs::create_dir_all(repo_b.join(".git")).unwrap();

        let task_a = format!("test-bg-hydrate-a-{}", uuid::Uuid::new_v4().simple());
        let task_b = format!("test-bg-hydrate-b-{}", uuid::Uuid::new_v4().simple());
        let status_a_path = crate::background::global().status_path_for(&task_a);
        let status_b_path = crate::background::global().status_path_for(&task_b);
        if let Some(parent) = status_a_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let make_status_file = |task_id: &str, session_id: &str, dir: &Path| TaskStatusFile {
            task_id: task_id.to_string(),
            tool_name: "bash".to_string(),
            display_name: Some("cargo test".to_string()),
            session_id: session_id.to_string(),
            status: BackgroundTaskStatus::Completed,
            exit_code: Some(0),
            error: None,
            started_at: Utc::now().to_rfc3339(),
            completed_at: Some(Utc::now().to_rfc3339()),
            duration_secs: Some(3.0),
            pid: None,
            owner_pid: None,
            owner_instance: None,
            detached: false,
            notify: true,
            wake: false,
            progress: None,
            event_history: Vec::new(),
            stall_wake_seconds: None,
            working_dir: Some(dir.display().to_string()),
        };

        std::fs::write(
            &status_a_path,
            serde_json::to_string(&make_status_file(&task_a, "sess-unknown-a", &repo_a)).unwrap(),
        )
        .unwrap();
        std::fs::write(
            &status_b_path,
            serde_json::to_string(&make_status_file(&task_b, "sess-unknown-b", &repo_b)).unwrap(),
        )
        .unwrap();

        let now_ms = now_epoch_ms();
        let await_state = PersistedAwaitMembersState {
            key: "test-await-key".into(),
            session_id: "caller-a".into(),
            swarm_id: "swarm-a".into(),
            target_status: vec!["ready".into(), "completed".into()],
            requested_ids: vec!["w1".into(), "w2".into()],
            mode: Some("all".into()),
            created_at_unix_ms: now_ms.saturating_sub(5000),
            deadline_unix_ms: now_ms + 120_000,
            background: true,
            notify: true,
            wake: true,
            final_response: None,
        };
        await_members_state::save_state(&await_state);

        let members = Arc::new(RwLock::new(HashMap::from([(
            "caller-a".into(),
            make_member("caller-a", repo_a.clone(), Some("swarm-a"), "ready"),
        )])));
        let ctx = ProjectActivityContext {
            sessions: Arc::new(super::super::SessionManager::new()),
            swarm_members: members,
            swarm_plans: Arc::new(RwLock::new(HashMap::new())),
            file_touch: FileTouchService::new(),
            await_members_runtime: AwaitMembersRuntime::default(),
            ambient_runner: None,
        };

        let snapshot = build_snapshot(&ctx, Some("caller-a"), None).await;
        assert!(
            snapshot
                .background_tasks
                .iter()
                .any(|t| t.task_id == task_a && !t.is_watcher),
            "disk task for repo A should be hydrated even without live notifications"
        );
        assert!(
            !snapshot
                .background_tasks
                .iter()
                .any(|t| t.task_id == task_b),
            "disk task for unrelated repo B must be excluded"
        );
        assert!(
            snapshot
                .background_tasks
                .iter()
                .any(|t| t.is_watcher && t.task_id == "await:test-await-key"),
            "active await_members watcher must be projected with is_watcher=true"
        );
        assert_eq!(snapshot.summary.active_watchers, 1);

        let _ = std::fs::remove_file(&status_a_path);
        let _ = std::fs::remove_file(&status_b_path);
        match prev_runtime {
            Some(prev) => crate::env::set_var("RAYU_RUNTIME_DIR", prev),
            None => crate::env::remove_var("RAYU_RUNTIME_DIR"),
        }
    }

    #[tokio::test]
    async fn task_without_working_dir_falls_back_to_session_stub_and_repo_q_does_not_leak_into_repo_r() {
        let _env_lock = crate::storage::lock_test_env();
        let temp_home = tempfile::tempdir().expect("home dir");
        let prev_home = std::env::var_os("RAYU_HOME");
        let prev_runtime = std::env::var_os("RAYU_RUNTIME_DIR");
        crate::env::set_var("RAYU_HOME", temp_home.path());
        crate::env::set_var("RAYU_RUNTIME_DIR", temp_home.path());

        clear_caches_for_tests();
        let temp_repos = tempfile::tempdir().expect("repos dir");
        let repo_r = temp_repos.path().join("repo-r");
        let repo_q = temp_repos.path().join("repo-q");
        std::fs::create_dir_all(repo_r.join(".git")).unwrap();
        std::fs::create_dir_all(repo_q.join(".git")).unwrap();

        // Persist a session stub in repo R (not currently live in `members` or `sessions`).
        let stub_r_sid = format!("sess-stub-r-{}", uuid::Uuid::new_v4().simple());
        let mut stub_r = crate::session::Session::create_with_id(
            stub_r_sid.clone(),
            None,
            Some("Repo R Session".to_string()),
        );
        stub_r.working_dir = Some(repo_r.display().to_string());
        stub_r.save_prepared().expect("save repo R session stub");

        // Task 1: spawned without explicit working_dir (`None`) from repo R's session ->
        // must fall back to `cached_stub_working_dir` and appear in repo R's snapshot.
        let task_r = format!("test-bg-fallback-r-{}", uuid::Uuid::new_v4().simple());
        // Task 2: spawned from repo Q with explicit working_dir = Some(repo_q) ->
        // must NOT leak into repo R's snapshot.
        let task_q = format!("test-bg-repo-q-{}", uuid::Uuid::new_v4().simple());
        let status_r_path = crate::background::global().status_path_for(&task_r);
        let status_q_path = crate::background::global().status_path_for(&task_q);
        if let Some(parent) = status_r_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let make_status = |task_id: &str, session_id: &str, working_dir: Option<String>| {
            TaskStatusFile {
                task_id: task_id.to_string(),
                tool_name: "bash".to_string(),
                display_name: Some("cargo test".to_string()),
                session_id: session_id.to_string(),
                status: BackgroundTaskStatus::Running,
                exit_code: None,
                error: None,
                started_at: Utc::now().to_rfc3339(),
                completed_at: None,
                duration_secs: None,
                pid: None,
                owner_pid: None,
                owner_instance: None,
                detached: false,
                notify: false,
                wake: false,
                progress: None,
                event_history: Vec::new(),
                stall_wake_seconds: None,
                working_dir,
            }
        };

        std::fs::write(
            &status_r_path,
            serde_json::to_string(&make_status(&task_r, &stub_r_sid, None)).unwrap(),
        )
        .unwrap();
        std::fs::write(
            &status_q_path,
            serde_json::to_string(&make_status(
                &task_q,
                "sess-from-repo-q",
                Some(repo_q.display().to_string()),
            ))
            .unwrap(),
        )
        .unwrap();

        let members = Arc::new(RwLock::new(HashMap::from([(
            "caller-r".into(),
            make_member("caller-r", repo_r.clone(), Some("swarm-r"), "ready"),
        )])));
        let ctx = ProjectActivityContext {
            sessions: Arc::new(super::super::SessionManager::new()),
            swarm_members: members,
            swarm_plans: Arc::new(RwLock::new(HashMap::new())),
            file_touch: FileTouchService::new(),
            await_members_runtime: AwaitMembersRuntime::default(),
            ambient_runner: None,
        };

        let snapshot = build_snapshot(&ctx, Some("caller-r"), None).await;
        assert!(
            snapshot.background_tasks.iter().any(|t| t.task_id == task_r),
            "task with working_dir=None must fall back to session stub working_dir for repo R"
        );
        assert!(
            !snapshot.background_tasks.iter().any(|t| t.task_id == task_q),
            "task from repo Q must never leak into repo R's ProjectActivitySnapshot"
        );

        let _ = std::fs::remove_file(&status_r_path);
        let _ = std::fs::remove_file(&status_q_path);
        match prev_home {
            Some(prev) => crate::env::set_var("RAYU_HOME", prev),
            None => crate::env::remove_var("RAYU_HOME"),
        }
        match prev_runtime {
            Some(prev) => crate::env::set_var("RAYU_RUNTIME_DIR", prev),
            None => crate::env::remove_var("RAYU_RUNTIME_DIR"),
        }
    }

    #[tokio::test]
    async fn active_runtime_note_reports_compacting_lock_free_while_agent_mutex_is_held() {
        clear_caches_for_tests();
        let temp_repo = tempfile::tempdir().expect("repo dir");
        let repo = temp_repo.path().join("compact-repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();

        let sid = "sess-lockfree-compacting";
        super::super::live_status::forget(sid);
        super::super::live_status::set_compacting(sid, true);

        let members = Arc::new(RwLock::new(HashMap::from([(
            sid.into(),
            make_member(sid, repo.clone(), None, "running"),
        )])));
        let ctx = ProjectActivityContext {
            sessions: Arc::new(super::super::SessionManager::new()),
            swarm_members: members,
            swarm_plans: Arc::new(RwLock::new(HashMap::new())),
            file_touch: FileTouchService::new(),
            await_members_runtime: AwaitMembersRuntime::default(),
            ambient_runner: None,
        };

        let snapshot = build_snapshot(&ctx, Some(sid), None).await;
        assert_eq!(
            snapshot.summary.active_runtime_note.as_deref(),
            Some("compacting"),
            "active_runtime_note must observe lock-free compaction state during active turns"
        );

        super::super::live_status::set_compacting(sid, false);
        let after = build_snapshot(&ctx, Some(sid), None).await;
        assert_ne!(after.summary.active_runtime_note.as_deref(), Some("compacting"));
        super::super::live_status::forget(sid);
    }
}
