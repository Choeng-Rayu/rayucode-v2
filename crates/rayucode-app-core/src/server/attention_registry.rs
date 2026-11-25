//! Lock-light process-global registry of active attention prompts per session.
//!
//! Tracks pending permission approvals, `ask_user_question` prompts, and stdin
//! prompts with RAII guards so cancellation, error, or disconnect can never leak
//! stale attention state.

use crate::protocol::{AgentAttention, AgentAttentionKind};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, RwLock as StdRwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
struct AttentionEntry {
    token: u64,
    attention: AgentAttention,
}

static REGISTRY: LazyLock<StdRwLock<HashMap<String, Vec<AttentionEntry>>>> =
    LazyLock::new(|| StdRwLock::new(HashMap::new()));
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
static CHANGED: LazyLock<tokio::sync::watch::Sender<u64>> =
    LazyLock::new(|| tokio::sync::watch::channel(0).0);

/// Current Unix timestamp in milliseconds.
pub(crate) fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

/// Priority rank for attention kinds (lower number = higher priority):
/// Permission > Question > Stdin > Stalled > Failed.
pub(crate) fn attention_priority(kind: AgentAttentionKind) -> u8 {
    match kind {
        AgentAttentionKind::Permission => 0,
        AgentAttentionKind::Question => 1,
        AgentAttentionKind::Stdin => 2,
        AgentAttentionKind::Stalled => 3,
        AgentAttentionKind::Failed => 4,
    }
}

fn notify_changed() {
    CHANGED.send_modify(|generation| *generation = generation.wrapping_add(1));
}

/// Subscribe to attention registry changes.
pub(crate) fn subscribe_changes() -> tokio::sync::watch::Receiver<u64> {
    CHANGED.subscribe()
}

/// RAII handle that removes a registered attention entry when dropped.
#[derive(Debug)]
pub(crate) struct AttentionGuard {
    session_id: String,
    token: u64,
    active: bool,
}

impl AttentionGuard {
    fn remove_now(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        let removed = {
            let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
            if let Some(entries) = map.get_mut(&self.session_id) {
                let before = entries.len();
                entries.retain(|entry| entry.token != self.token);
                let changed = entries.len() != before;
                if entries.is_empty() {
                    map.remove(&self.session_id);
                }
                changed
            } else {
                false
            }
        };
        if removed {
            notify_changed();
        }
    }
}

impl Drop for AttentionGuard {
    fn drop(&mut self) {
        self.remove_now();
    }
}

/// Register an active attention prompt for `session_id`.
///
/// The returned [`AttentionGuard`] removes the entry automatically on `Drop`.
pub(crate) fn register_attention(
    session_id: impl Into<String>,
    mut attention: AgentAttention,
) -> AttentionGuard {
    let session_id = session_id.into();
    if attention.since_epoch_ms.is_none() {
        attention.since_epoch_ms = Some(now_epoch_ms());
    }
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    {
        let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
        map.entry(session_id.clone())
            .or_default()
            .push(AttentionEntry { token, attention });
    }
    notify_changed();
    AttentionGuard {
        session_id,
        token,
        active: true,
    }
}

fn compare_attention(a: &AgentAttention, b: &AgentAttention) -> std::cmp::Ordering {
    attention_priority(a.kind)
        .cmp(&attention_priority(b.kind))
        .then_with(|| {
            a.since_epoch_ms
                .unwrap_or(u64::MAX)
                .cmp(&b.since_epoch_ms.unwrap_or(u64::MAX))
        })
        .then_with(|| a.summary.cmp(&b.summary))
}

/// Return the highest-priority registered attention prompt for `session_id`.
pub(crate) fn primary_for_session(session_id: &str) -> Option<AgentAttention> {
    let map = REGISTRY.read().unwrap_or_else(|e| e.into_inner());
    let entries = map.get(session_id)?;
    entries
        .iter()
        .map(|entry| &entry.attention)
        .min_by(|a, b| compare_attention(a, b))
        .cloned()
}

/// Return all registered attention entries for `session_id`, sorted by priority.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn all_for_session(session_id: &str) -> Vec<AgentAttention> {
    let map = REGISTRY.read().unwrap_or_else(|e| e.into_inner());
    let mut items: Vec<AgentAttention> = map
        .get(session_id)
        .into_iter()
        .flat_map(|entries| entries.iter().map(|entry| entry.attention.clone()))
        .collect();
    items.sort_by(compare_attention);
    items
}

/// Pick the highest-priority attention item from an iterator.
pub(crate) fn highest_priority(
    items: impl IntoIterator<Item = AgentAttention>,
) -> Option<AgentAttention> {
    items.into_iter().min_by(compare_attention)
}

fn format_short_duration(secs: u64) -> String {
    if secs >= 3600 {
        format!("{}h{}m", secs / 3600, (secs % 3600) / 60)
    } else if secs >= 60 {
        format!("{}m{}s", secs / 60, secs % 60)
    } else {
        format!("{secs}s")
    }
}

/// Compute effective attention for a swarm member by combining registered prompts
/// with synthesized watchdog `Stalled` and terminal `Failed` conditions.
pub(crate) fn effective_attention_for_member(
    session_id: &str,
    status: &str,
    detail: Option<&str>,
    stalled_secs: Option<u64>,
) -> Option<AgentAttention> {
    let mut candidates = Vec::with_capacity(2);
    if let Some(registered) = primary_for_session(session_id) {
        candidates.push(registered);
    }
    if let Some(secs) = stalled_secs.filter(|secs| *secs > 0) {
        candidates.push(AgentAttention {
            kind: AgentAttentionKind::Stalled,
            summary: format!("Stalled for {}", format_short_duration(secs)),
            request_id: None,
            since_epoch_ms: Some(now_epoch_ms().saturating_sub(secs.saturating_mul(1000))),
        });
    }
    if matches!(status, "failed" | "crashed") {
        let summary = detail
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| status.to_string());
        candidates.push(AgentAttention {
            kind: AgentAttentionKind::Failed,
            summary,
            request_id: None,
            since_epoch_ms: None,
        });
    }
    highest_priority(candidates)
}

#[cfg(test)]
pub(crate) fn clear_for_tests(session_id: &str) {
    let mut map = REGISTRY.write().unwrap_or_else(|e| e.into_inner());
    if map.remove(session_id).is_some() {
        drop(map);
        notify_changed();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attention_raii_drop_clears_and_orders_by_priority() {
        let sid = "attention-registry-priority-test";
        clear_for_tests(sid);

        let changes = subscribe_changes();
        let initial_gen = *changes.borrow();

        let failed_guard = register_attention(
            sid,
            AgentAttention {
                kind: AgentAttentionKind::Failed,
                summary: "exit 1".into(),
                request_id: None,
                since_epoch_ms: Some(100),
            },
        );
        assert!(*changes.borrow() > initial_gen);
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Failed)
        );

        let stalled_guard = register_attention(
            sid,
            AgentAttention {
                kind: AgentAttentionKind::Stalled,
                summary: "stalled 2m".into(),
                request_id: None,
                since_epoch_ms: Some(110),
            },
        );
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Stalled)
        );

        let stdin_guard = register_attention(
            sid,
            AgentAttention {
                kind: AgentAttentionKind::Stdin,
                summary: "Password:".into(),
                request_id: Some("stdin-1".into()),
                since_epoch_ms: Some(120),
            },
        );
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Stdin)
        );

        let question_guard = register_attention(
            sid,
            AgentAttention {
                kind: AgentAttentionKind::Question,
                summary: "Pick an option".into(),
                request_id: Some("q-1".into()),
                since_epoch_ms: Some(130),
            },
        );
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Question)
        );

        let perm_guard = register_attention(
            sid,
            AgentAttention {
                kind: AgentAttentionKind::Permission,
                summary: "bash: cargo test".into(),
                request_id: Some("perm-1".into()),
                since_epoch_ms: Some(140),
            },
        );
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Permission)
        );
        assert_eq!(all_for_session(sid).len(), 5);

        drop(perm_guard);
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Question)
        );

        drop(question_guard);
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Stdin)
        );

        drop(stdin_guard);
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Stalled)
        );

        drop(stalled_guard);
        assert_eq!(
            primary_for_session(sid).map(|a| a.kind),
            Some(AgentAttentionKind::Failed)
        );

        drop(failed_guard);
        assert_eq!(primary_for_session(sid), None);
        assert!(all_for_session(sid).is_empty());
    }

    #[test]
    fn effective_attention_synthesizes_stalled_and_failed_below_prompts() {
        let sid = "attention-registry-effective-test";
        clear_for_tests(sid);

        let stalled = effective_attention_for_member(sid, "running", None, Some(125)).unwrap();
        assert_eq!(stalled.kind, AgentAttentionKind::Stalled);
        assert!(stalled.summary.contains("2m5s"));

        let failed =
            effective_attention_for_member(sid, "failed", Some("provider timeout"), None).unwrap();
        assert_eq!(failed.kind, AgentAttentionKind::Failed);
        assert_eq!(failed.summary, "provider timeout");

        let _perm = register_attention(
            sid,
            AgentAttention {
                kind: AgentAttentionKind::Permission,
                summary: "bash: rm -rf".into(),
                request_id: Some("p-1".into()),
                since_epoch_ms: None,
            },
        );
        let effective =
            effective_attention_for_member(sid, "running", None, Some(125)).unwrap();
        assert_eq!(effective.kind, AgentAttentionKind::Permission);
    }
}
