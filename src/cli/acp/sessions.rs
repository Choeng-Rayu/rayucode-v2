//! ACP session listing (`session/list`) and deletion (`session/delete`) backed
//! by Rayu's SQLite recent-session index and on-disk session store.

use super::JSONRPC_INVALID_PARAMS;
use anyhow::Result;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub(super) const DEFAULT_LIST_PAGE_SIZE: usize = 50;
const INDEX_FETCH_LIMIT: usize = 2000;
const DISK_FALLBACK_SCAN_CAP: usize = 500;
const METADATA_WINDOW_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub(super) struct ListedSession {
    pub(super) session_id: String,
    pub(super) cwd: String,
    pub(super) title: Option<String>,
    pub(super) updated_at_ms: i64,
}

/// Validate a session ID before using it to construct local file paths.
pub(super) fn validate_session_id_for_fs(session_id: &str) -> std::result::Result<(), String> {
    let trimmed = session_id.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.contains("..")
    {
        return Err(format!("Invalid ACP sessionId: {session_id}"));
    }
    Ok(())
}

/// Normalize a filesystem path for equality matching in `session/list` `cwd` filtering.
fn normalize_path_key(raw: &str) -> String {
    let path = Path::new(raw);
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(raw));
    let mut text = canonical.to_string_lossy().to_string();
    while text.len() > 1 && (text.ends_with('/') || text.ends_with('\\')) {
        text.pop();
    }
    if cfg!(windows) {
        text.to_ascii_lowercase()
    } else {
        text
    }
}

fn parse_cursor(cursor: Option<&str>) -> std::result::Result<usize, (i64, String)> {
    let Some(raw) = cursor.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(0);
    };
    raw.parse::<usize>()
        .map_err(|_| (JSONRPC_INVALID_PARAMS, format!("Invalid ACP cursor: {raw}")))
}

fn format_rfc3339_ms(ms: i64) -> Option<String> {
    if ms <= 0 {
        return None;
    }
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.to_rfc3339_opts(SecondsFormat::Secs, true))
}

struct DiskSessionMeta {
    working_dir: Option<String>,
    title: Option<String>,
    is_debug: bool,
    updated_at_ms: i64,
}

fn read_disk_session_meta(path: &Path) -> Option<DiskSessionMeta> {
    let mut file = std::fs::File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    let len = meta.len();
    let head_len = usize::try_from(len.min(METADATA_WINDOW_BYTES as u64)).ok()?;
    let mut head = vec![0u8; head_len];
    file.read_exact(&mut head).ok()?;
    let tail = if len > METADATA_WINDOW_BYTES as u64 {
        file.seek(SeekFrom::End(-(METADATA_WINDOW_BYTES as i64)))
            .ok()?;
        let mut tail = vec![0u8; METADATA_WINDOW_BYTES];
        file.read_exact(&mut tail).ok()?;
        tail
    } else {
        Vec::new()
    };

    let custom_title = extract_json_string(&tail, "custom_title", true)
        .or_else(|| extract_json_string(&head, "custom_title", true));
    let generated_title = extract_json_string(&head, "title", false);
    let title = custom_title
        .filter(|s| !s.trim().is_empty())
        .or_else(|| generated_title.filter(|s| !s.trim().is_empty()));
    let working_dir = extract_json_string(&tail, "working_dir", true)
        .or_else(|| extract_json_string(&head, "working_dir", true));
    let is_debug = extract_json_bool(&tail, "is_debug", true)
        .or_else(|| extract_json_bool(&head, "is_debug", false))
        .unwrap_or(false);
    let updated_at_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Some(DiskSessionMeta {
        working_dir,
        title,
        is_debug,
        updated_at_ms,
    })
}

fn extract_json_string(bytes: &[u8], field: &str, last: bool) -> Option<String> {
    let needle = format!("\"{field}\":");
    let mut starts = bytes
        .windows(needle.len())
        .enumerate()
        .filter_map(|(at, window)| (window == needle.as_bytes()).then_some(at + needle.len()));
    let start = if last { starts.next_back()? } else { starts.next()? };
    Option::<String>::deserialize(&mut serde_json::Deserializer::from_slice(&bytes[start..]))
        .ok()
        .flatten()
}

fn extract_json_bool(bytes: &[u8], field: &str, last: bool) -> Option<bool> {
    let needle = format!("\"{field}\":");
    let mut starts = bytes
        .windows(needle.len())
        .enumerate()
        .filter_map(|(at, window)| (window == needle.as_bytes()).then_some(at + needle.len()));
    let start = if last { starts.next_back()? } else { starts.next()? };
    bool::deserialize(&mut serde_json::Deserializer::from_slice(&bytes[start..])).ok()
}

/// Build an ACP `session/list` response combining active ACP sessions, the
/// SQLite recent-session index, and any unindexed `.json` transcripts in
/// `RAYU_HOME/sessions`.
pub(super) fn list_sessions(
    cwd_filter: Option<&Path>,
    cursor: Option<&str>,
    active_sessions: &[ListedSession],
    page_size: usize,
) -> std::result::Result<Value, (i64, String)> {
    let offset = parse_cursor(cursor)?;
    let fallback_cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "/".to_string());

    let mut by_id: HashMap<String, ListedSession> = HashMap::new();

    // 1. Fast path: SQLite recent-session metadata index.
    if let Ok(indexed) = crate::recent_session_index::recent(INDEX_FETCH_LIMIT) {
        for entry in indexed {
            let cwd = entry
                .working_dir
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty() && Path::new(s).is_absolute())
                .map(str::to_string)
                .unwrap_or_else(|| fallback_cwd.clone());
            let title = entry.display_title().map(str::to_string);
            let updated_at_ms = entry
                .last_active_at_ms
                .unwrap_or(entry.updated_at_ms)
                .max(entry.updated_at_ms);
            by_id.insert(
                entry.session_id.clone(),
                ListedSession {
                    session_id: entry.session_id,
                    cwd,
                    title,
                    updated_at_ms,
                },
            );
        }
    }

    // 2. Bounded disk fallback for sessions not yet present in the SQLite index.
    // Skip directory walking when the index already filled its recency window,
    // and cap unindexed reads so large installs (100k+ sessions) stay fast.
    if by_id.len() < INDEX_FETCH_LIMIT
        && let Ok(rayu_dir) = crate::storage::rayu_dir()
    {
        let sessions_dir = rayu_dir.join("sessions");
        if let Ok(entries) = std::fs::read_dir(sessions_dir) {
            let mut scanned = 0usize;
            for entry in entries.flatten() {
                if scanned >= DISK_FALLBACK_SCAN_CAP {
                    break;
                }
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                if by_id.contains_key(stem) {
                    continue;
                }
                scanned += 1;
                if let Some(meta) = read_disk_session_meta(&path) {
                    if meta.is_debug {
                        continue;
                    }
                    let cwd = meta
                        .working_dir
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty() && Path::new(s).is_absolute())
                        .map(str::to_string)
                        .unwrap_or_else(|| fallback_cwd.clone());
                    by_id.insert(
                        stem.to_string(),
                        ListedSession {
                            session_id: stem.to_string(),
                            cwd,
                            title: meta.title,
                            updated_at_ms: meta.updated_at_ms,
                        },
                    );
                }
            }
        }
    }

    // 3. Merge live ACP-owned sessions (including brand-new sessions not yet flushed to disk).
    for active in active_sessions {
        by_id
            .entry(active.session_id.clone())
            .and_modify(|existing| {
                if !active.cwd.is_empty() {
                    existing.cwd = active.cwd.clone();
                }
                if active.title.is_some() {
                    existing.title = active.title.clone();
                }
                if active.updated_at_ms > existing.updated_at_ms {
                    existing.updated_at_ms = active.updated_at_ms;
                }
            })
            .or_insert_with(|| active.clone());
    }

    let filter_key = cwd_filter.map(|p| normalize_path_key(&p.display().to_string()));
    let mut items: Vec<ListedSession> = by_id
        .into_values()
        .filter(|item| match &filter_key {
            Some(expected) => normalize_path_key(&item.cwd) == *expected,
            None => true,
        })
        .collect();

    items.sort_by(|a, b| {
        b.updated_at_ms
            .cmp(&a.updated_at_ms)
            .then_with(|| b.session_id.cmp(&a.session_id))
    });

    let total = items.len();
    let page_size = page_size.max(1);
    let start = offset.min(total);
    let end = start.saturating_add(page_size).min(total);
    let next_cursor = (end < total).then(|| end.to_string());

    let sessions: Vec<Value> = items[start..end]
        .iter()
        .map(|item| {
            let mut obj = json!({
                "sessionId": item.session_id,
                "cwd": item.cwd,
            });
            if let Some(map) = obj.as_object_mut() {
                if let Some(title) = item.title.as_deref().filter(|t| !t.trim().is_empty()) {
                    map.insert("title".to_string(), Value::String(title.to_string()));
                }
                if let Some(updated_at) = format_rfc3339_ms(item.updated_at_ms) {
                    map.insert("updatedAt".to_string(), Value::String(updated_at));
                }
            }
            obj
        })
        .collect();

    let mut result = json!({ "sessions": sessions });
    if let Some(next) = next_cursor
        && let Some(map) = result.as_object_mut()
    {
        map.insert("nextCursor".to_string(), Value::String(next));
    }
    Ok(result)
}

/// Remove persisted artifacts for a deleted session. Missing files are ignored.
pub(super) fn delete_persisted_session(session_id: &str) -> Result<()> {
    validate_session_id_for_fs(session_id).map_err(|msg| anyhow::anyhow!(msg))?;

    if let Ok(path) = crate::session::session_path(session_id) {
        let _ = std::fs::remove_file(&path);
        let bak = path.with_extension("bak");
        let _ = std::fs::remove_file(bak);
    }
    if let Ok(journal) = crate::session::session_journal_path(session_id) {
        let _ = std::fs::remove_file(journal);
    }
    if let Ok(rayu_dir) = crate::storage::rayu_dir() {
        let todos_dir = rayu_dir.join("todos");
        for suffix in [
            "",
            "-goals",
            "-plan",
            "-gate-observations",
            "-review-state",
            "-lane-links",
        ] {
            let _ = std::fs::remove_file(todos_dir.join(format!("{session_id}{suffix}.json")));
        }
    }
    let _ = crate::file_changes::delete_session_file_changes(session_id);
    let _ = crate::recent_session_index::remove(session_id);
    Ok(())
}
