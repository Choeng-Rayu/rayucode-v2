use anyhow::{Context, Result};
use chrono::Utc;
use rayucode_session_types::{
    FileChangeActionKind, FileChangeActionResponse, FileChangeConflict, FileChangeDiffPayload,
    FileChangeEntrySummary, FileChangeHunk, FileChangeKind, FileChangeStatus, FileChangesSnapshot,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use super::diff::{
    build_unified_diff, compute_text_diff, has_trailing_newline, is_binary_bytes, uses_crlf,
};
use super::undo::reverse_apply_steps;

/// Maximum single-blob size captured for undo/redo snapshots (10 MiB).
pub const MAX_BLOB_BYTES: usize = 10 * 1024 * 1024;
/// Maximum total diff lines embedded in a summary entry's `preview_hunks`.
pub const PREVIEW_MAX_LINES: usize = 80;

/// Single filesystem mutation event captured by a coding tool.
#[derive(Debug, Clone, Copy)]
pub struct FileMutationRecord<'a> {
    pub session_id: &'a str,
    pub working_dir: Option<&'a Path>,
    pub path: &'a Path,
    pub old_path: Option<&'a Path>,
    pub before_existed: bool,
    pub before_bytes: Option<&'a [u8]>,
    pub before_exceeded_cap: bool,
    pub before_mode: Option<u32>,
    pub after_existed: bool,
    pub after_bytes: Option<&'a [u8]>,
    pub after_exceeded_cap: bool,
    pub after_mode: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct EditStep {
    pub turn_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_sha256: Option<String>,
    #[serde(default)]
    pub hunks: Vec<FileChangeHunk>,
    #[serde(default)]
    pub before_trailing_newline: bool,
    #[serde(default)]
    pub after_trailing_newline: bool,
    #[serde(default)]
    pub before_crlf: bool,
    pub recorded_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TrackedFileEntry {
    path: String,
    display_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    old_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    old_display_path: Option<String>,
    kind: FileChangeKind,
    status: FileChangeStatus,
    turn_id: u64,
    edit_count: u32,
    is_binary: bool,
    undoable: bool,
    baseline_existed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    baseline_blob_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    baseline_mode: Option<u32>,
    post_existed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    post_blob_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    post_mode: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expected_post_sha256: Option<String>,
    #[serde(default)]
    has_interleaved_manual_edits: bool,
    #[serde(default)]
    edit_steps: Vec<EditStep>,
    additions: usize,
    deletions: usize,
    #[serde(default)]
    preview_hunks: Vec<FileChangeHunk>,
    #[serde(default)]
    preview_truncated: bool,
    updated_at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SessionFileChangeManifest {
    session_id: String,
    turn_seq: u64,
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    entries: Vec<TrackedFileEntry>,
}

type StoreCache = Mutex<HashMap<(PathBuf, String), SessionFileChangeManifest>>;

fn registry() -> &'static StoreCache {
    static REGISTRY: OnceLock<StoreCache> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn validate_session_id(session_id: &str) -> Result<()> {
    let trimmed = session_id.trim();
    anyhow::ensure!(!trimmed.is_empty(), "session_id cannot be empty");
    anyhow::ensure!(
        !trimmed.contains("..") && !trimmed.contains('/') && !trimmed.contains('\\'),
        "invalid session_id for file changes store: {session_id}"
    );
    let mut components = Path::new(trimmed).components();
    anyhow::ensure!(
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none(),
        "invalid session_id path component: {session_id}"
    );
    Ok(())
}

fn resolve_session_paths(session_id: &str) -> Result<(PathBuf, PathBuf)> {
    validate_session_id(session_id)?;
    let rayu_dir = crate::storage::rayu_dir()?;
    let session_dir = rayu_dir
        .join("sessions")
        .join("file-changes")
        .join(session_id);
    Ok((rayu_dir, session_dir))
}

fn manifest_path(session_dir: &Path) -> PathBuf {
    session_dir.join("manifest.json")
}

fn blobs_dir(session_dir: &Path) -> PathBuf {
    session_dir.join("blobs")
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn store_blob(session_dir: &Path, bytes: &[u8]) -> Result<String> {
    let hash = sha256_hex(bytes);
    let dir = blobs_dir(session_dir);
    let target = dir.join(&hash);
    if target.exists() {
        return Ok(hash);
    }
    crate::storage::ensure_dir(&dir)?;
    let nonce: u64 = rand::random();
    let tmp = dir.join(format!("{hash}.tmp.{}.{}", std::process::id(), nonce));
    std::fs::write(&tmp, bytes)
        .with_context(|| format!("failed to write file-change blob {}", tmp.display()))?;
    if let Err(err) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp);
        if !target.exists() {
            return Err(err)
                .with_context(|| format!("failed to persist file-change blob {}", target.display()));
        }
    }
    Ok(hash)
}

fn load_blob(session_dir: &Path, hash: &str) -> Result<Vec<u8>> {
    let path = blobs_dir(session_dir).join(hash);
    std::fs::read(&path)
        .with_context(|| format!("failed to read file-change blob {}", path.display()))
}

fn load_manifest_from_disk(session_dir: &Path, session_id: &str) -> SessionFileChangeManifest {
    let path = manifest_path(session_dir);
    if !path.exists() {
        return SessionFileChangeManifest {
            session_id: session_id.to_string(),
            turn_seq: 0,
            revision: 0,
            entries: Vec::new(),
        };
    }
    match crate::storage::read_json::<SessionFileChangeManifest>(&path) {
        Ok(mut manifest) => {
            if manifest.session_id.is_empty() {
                manifest.session_id = session_id.to_string();
            }
            manifest
        }
        Err(error) => {
            crate::logging::warn(&format!(
                "Failed to load file-changes manifest for {}: {error}",
                session_id
            ));
            SessionFileChangeManifest {
                session_id: session_id.to_string(),
                turn_seq: 0,
                revision: 0,
                entries: Vec::new(),
            }
        }
    }
}

fn persist_manifest(session_dir: &Path, manifest: &SessionFileChangeManifest) -> Result<()> {
    let path = manifest_path(session_dir);
    crate::storage::write_json_fast(&path, manifest)
}

fn with_session_manifest<T>(
    session_id: &str,
    f: impl FnOnce(&Path, &mut SessionFileChangeManifest) -> Result<T>,
) -> Result<T> {
    let (rayu_dir, session_dir) = resolve_session_paths(session_id)?;
    let key = (rayu_dir, session_id.to_string());
    let mut cache = registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let manifest = cache
        .entry(key)
        .or_insert_with(|| load_manifest_from_disk(&session_dir, session_id));
    f(&session_dir, manifest)
}

/// Normalize a path canonically even if the file itself does not currently
/// exist (e.g., deleted or newly created paths inside a symlinked workspace).
pub fn normalize_path(path: &Path) -> PathBuf {
    if let Ok(canon) = std::fs::canonicalize(path) {
        return canon;
    }

    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join(path)
    } else {
        path.to_path_buf()
    };

    let mut existing = abs.as_path();
    let mut tail = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            break;
        };
        tail.push(name.to_os_string());
        let Some(parent) = existing.parent() else {
            break;
        };
        existing = parent;
    }

    let mut base = std::fs::canonicalize(existing).unwrap_or_else(|_| existing.to_path_buf());
    for part in tail.into_iter().rev() {
        base.push(part);
    }
    clean_lexical_path(&base)
}

fn clean_lexical_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push(comp.as_os_str());
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn compute_display_path(canonical_path: &Path, working_dir: Option<&Path>) -> String {
    if let Some(wd) = working_dir {
        let canon_wd = normalize_path(wd);
        if let Ok(rel) = canonical_path.strip_prefix(&canon_wd) {
            let rendered = rel.to_string_lossy().replace('\\', "/");
            if !rendered.is_empty() {
                return rendered;
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        let canon_home = normalize_path(&home);
        if let Ok(rel) = canonical_path.strip_prefix(&canon_home) {
            let rendered = rel.to_string_lossy().replace('\\', "/");
            if !rendered.is_empty() {
                return format!("~/{rendered}");
            }
        }
    }
    canonical_path.to_string_lossy().replace('\\', "/")
}

#[cfg(unix)]
fn apply_unix_mode(path: &Path, mode: Option<u32>) {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
    }
}

#[cfg(not(unix))]
fn apply_unix_mode(_path: &Path, _mode: Option<u32>) {}

#[cfg(unix)]
fn read_unix_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .ok()
        .map(|meta| meta.permissions().mode())
}

#[cfg(not(unix))]
fn read_unix_mode(_path: &Path) -> Option<u32> {
    None
}

fn entry_can_redo(entry: &TrackedFileEntry) -> bool {
    entry.status == FileChangeStatus::Undone
        && (!entry.post_existed || entry.post_blob_sha256.is_some())
}

fn entry_to_summary(entry: &TrackedFileEntry, latest_turn_id: u64) -> FileChangeEntrySummary {
    FileChangeEntrySummary {
        path: entry.path.clone(),
        display_path: entry.display_path.clone(),
        old_path: entry.old_path.clone(),
        kind: entry.kind,
        status: entry.status,
        additions: entry.additions,
        deletions: entry.deletions,
        changed_in_latest_turn: latest_turn_id > 0 && entry.turn_id == latest_turn_id,
        turn_id: entry.turn_id,
        edit_count: entry.edit_count,
        is_binary: entry.is_binary,
        undoable: entry.undoable,
        can_redo: entry_can_redo(entry),
        preview_hunks: entry.preview_hunks.clone(),
        preview_truncated: entry.preview_truncated,
        updated_at_ms: entry.updated_at_ms,
    }
}

fn build_snapshot(manifest: &SessionFileChangeManifest) -> FileChangesSnapshot {
    let mut files: Vec<FileChangeEntrySummary> = manifest
        .entries
        .iter()
        .map(|entry| entry_to_summary(entry, manifest.turn_seq))
        .collect();

    files.sort_by(|a, b| {
        let status_rank = |s: FileChangeStatus| match s {
            FileChangeStatus::Pending => 0u8,
            FileChangeStatus::Kept => 1u8,
            FileChangeStatus::Undone => 2u8,
        };
        status_rank(a.status)
            .cmp(&status_rank(b.status))
            .then_with(|| b.changed_in_latest_turn.cmp(&a.changed_in_latest_turn))
            .then_with(|| b.updated_at_ms.cmp(&a.updated_at_ms))
            .then_with(|| a.display_path.cmp(&b.display_path))
    });

    let mut total_pending_files = 0usize;
    let mut total_additions = 0usize;
    let mut total_deletions = 0usize;
    for file in &files {
        if file.status == FileChangeStatus::Pending {
            total_pending_files += 1;
            total_additions += file.additions;
            total_deletions += file.deletions;
        }
    }

    FileChangesSnapshot {
        session_id: manifest.session_id.clone(),
        latest_turn_id: manifest.turn_seq,
        total_pending_files,
        total_additions,
        total_deletions,
        files,
    }
}

fn find_entry_index(entries: &[TrackedFileEntry], query: &str) -> Option<usize> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized_display = trimmed.replace('\\', "/");
    let stripped_display = normalized_display
        .strip_prefix("./")
        .unwrap_or(&normalized_display);

    // 1. Exact canonical path match.
    if let Some(idx) = entries.iter().position(|e| e.path == trimmed) {
        return Some(idx);
    }
    // 2. Exact display_path match.
    if let Some(idx) = entries
        .iter()
        .position(|e| e.display_path == normalized_display || e.display_path == stripped_display)
    {
        return Some(idx);
    }
    // 3. Canonicalized query path match.
    let canon_query = normalize_path(Path::new(trimmed))
        .to_string_lossy()
        .to_string();
    if let Some(idx) = entries.iter().position(|e| e.path == canon_query) {
        return Some(idx);
    }
    // 4. Fallback: renamed old_path / old_display_path match.
    entries.iter().position(|e| {
        e.old_path.as_deref() == Some(trimmed)
            || e.old_path.as_deref() == Some(canon_query.as_str())
            || e.old_display_path.as_deref() == Some(stripped_display)
    })
}

fn classify_kind(
    baseline_existed: bool,
    post_existed: bool,
    old_path: Option<&str>,
) -> FileChangeKind {
    if old_path.is_some() {
        if post_existed {
            FileChangeKind::Renamed
        } else {
            FileChangeKind::Deleted
        }
    } else if !baseline_existed && post_existed {
        FileChangeKind::Created
    } else if !post_existed {
        FileChangeKind::Deleted
    } else {
        FileChangeKind::Modified
    }
}

fn build_edit_step(
    turn_id: u64,
    before_bytes: Option<&[u8]>,
    after_bytes: Option<&[u8]>,
    exceeds_cap: bool,
    now: i64,
) -> EditStep {
    let before_sha256 = before_bytes.map(sha256_hex);
    let after_sha256 = after_bytes.map(sha256_hex);

    let (hunks, before_trailing_newline, after_trailing_newline, before_crlf) = if !exceeds_cap {
        let old_slice = before_bytes.unwrap_or(&[]);
        let new_slice = after_bytes.unwrap_or(&[]);
        if !is_binary_bytes(old_slice) && !is_binary_bytes(new_slice) {
            let old_text = std::str::from_utf8(old_slice).unwrap_or_default();
            let new_text = std::str::from_utf8(new_slice).unwrap_or_default();
            let computed = compute_text_diff(old_text, new_text);
            (
                computed.hunks,
                has_trailing_newline(old_text),
                has_trailing_newline(new_text),
                uses_crlf(old_text),
            )
        } else {
            (Vec::new(), false, false, false)
        }
    } else {
        (Vec::new(), false, false, false)
    };

    EditStep {
        turn_id,
        before_sha256,
        after_sha256,
        hunks,
        before_trailing_newline,
        after_trailing_newline,
        before_crlf,
        recorded_at_ms: now,
    }
}

fn recompute_entry_diff(session_dir: &Path, entry: &mut TrackedFileEntry, after_bytes: Option<&[u8]>) {
    if entry.is_binary || !entry.undoable {
        entry.additions = 0;
        entry.deletions = 0;
        entry.preview_hunks.clear();
        entry.preview_truncated = false;
        return;
    }

    let baseline_bytes = if entry.baseline_existed {
        match entry
            .baseline_blob_sha256
            .as_deref()
            .and_then(|hash| load_blob(session_dir, hash).ok())
        {
            Some(bytes) => bytes,
            None => {
                entry.additions = 0;
                entry.deletions = 0;
                entry.preview_hunks.clear();
                entry.preview_truncated = false;
                return;
            }
        }
    } else {
        Vec::new()
    };

    let post_owned;
    let post_slice: &[u8] = if let Some(bytes) = after_bytes {
        bytes
    } else if entry.post_existed {
        match entry
            .post_blob_sha256
            .as_deref()
            .and_then(|hash| load_blob(session_dir, hash).ok())
        {
            Some(bytes) => {
                post_owned = bytes;
                &post_owned
            }
            None => &[],
        }
    } else {
        &[]
    };

    if is_binary_bytes(&baseline_bytes) || is_binary_bytes(post_slice) {
        entry.is_binary = true;
        entry.additions = 0;
        entry.deletions = 0;
        entry.preview_hunks.clear();
        entry.preview_truncated = false;
        return;
    }

    let old_text = std::str::from_utf8(&baseline_bytes).unwrap_or_default();
    let new_text = std::str::from_utf8(post_slice).unwrap_or_default();
    let computed = compute_text_diff(old_text, new_text);
    entry.additions = computed.additions;
    entry.deletions = computed.deletions;
    entry.preview_hunks = computed.preview_hunks;
    entry.preview_truncated = computed.preview_truncated;
}

/// Increment and return the session's monotonic turn counter.
pub fn begin_turn(session_id: &str) -> u64 {
    with_session_manifest(session_id, |session_dir, manifest| {
        manifest.turn_seq = manifest.turn_seq.saturating_add(1);
        if !manifest.entries.is_empty() {
            let _ = persist_manifest(session_dir, manifest);
        }
        Ok(manifest.turn_seq)
    })
    .unwrap_or(0)
}

/// Current monotonic mutation revision for a session (0 if untouched).
pub fn session_revision(session_id: &str) -> u64 {
    with_session_manifest(session_id, |_session_dir, manifest| Ok(manifest.revision)).unwrap_or(0)
}

/// Read the current session snapshot without mutating state.
pub fn snapshot_for_session(session_id: &str) -> FileChangesSnapshot {
    with_session_manifest(session_id, |_session_dir, manifest| {
        Ok(build_snapshot(manifest))
    })
    .unwrap_or_else(|_| FileChangesSnapshot::empty(session_id))
}

/// Evict the in-memory cached manifest for `session_id` (next access reloads
/// lazily from disk). Useful for tests and cleanup.
pub fn evict_session_cache(session_id: &str) {
    if let Ok((rayu_dir, _)) = resolve_session_paths(session_id) {
        let mut cache = registry()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.remove(&(rayu_dir, session_id.to_string()));
    }
}

/// Remove persisted file-change state and blobs for a deleted session.
pub fn delete_session_file_changes(session_id: &str) -> Result<()> {
    let (rayu_dir, session_dir) = resolve_session_paths(session_id)?;
    {
        let mut cache = registry()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.remove(&(rayu_dir, session_id.to_string()));
    }
    if session_dir.exists() {
        std::fs::remove_dir_all(&session_dir).with_context(|| {
            format!(
                "failed to remove file-changes directory {}",
                session_dir.display()
            )
        })?;
    }
    Ok(())
}

/// Record an atomic filesystem mutation produced by a tool.
pub fn record_mutation(record: FileMutationRecord<'_>) -> Result<FileChangesSnapshot> {
    // Skip pure no-op writes (identical bytes, same existence, not a rename).
    if record.old_path.is_none()
        && record.before_existed == record.after_existed
        && !record.before_exceeded_cap
        && !record.after_exceeded_cap
        && record.before_bytes == record.after_bytes
    {
        return Ok(snapshot_for_session(record.session_id));
    }

    with_session_manifest(record.session_id, |session_dir, manifest| {
        if manifest.turn_seq == 0 {
            manifest.turn_seq = 1;
        }
        let turn_id = manifest.turn_seq;
        let now = now_ms();

        let canon_path = normalize_path(record.path);
        let canon_path_str = canon_path.to_string_lossy().to_string();
        let display_path = compute_display_path(&canon_path, record.working_dir);

        let canon_old = record.old_path.map(normalize_path);
        let canon_old_str = canon_old
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());
        let old_display_path = canon_old
            .as_ref()
            .map(|p| compute_display_path(p, record.working_dir));

        let before_over_cap = record.before_exceeded_cap
            || record
                .before_bytes
                .is_some_and(|b| b.len() > MAX_BLOB_BYTES);
        let after_over_cap = record.after_exceeded_cap
            || record.after_bytes.is_some_and(|b| b.len() > MAX_BLOB_BYTES);
        let step_over_cap = before_over_cap || after_over_cap;

        let before_binary = record.before_bytes.is_some_and(is_binary_bytes);
        let after_binary = record.after_bytes.is_some_and(is_binary_bytes);

        let post_blob_sha256 = if record.after_existed && !after_over_cap {
            if let Some(bytes) = record.after_bytes {
                Some(store_blob(session_dir, bytes)?)
            } else {
                None
            }
        } else {
            None
        };
        let expected_post_sha256 = if record.after_existed {
            post_blob_sha256
                .clone()
                .or_else(|| record.after_bytes.map(sha256_hex))
        } else {
            None
        };
        let after_mode = record
            .after_mode
            .or_else(|| record.after_existed.then(|| read_unix_mode(&canon_path)).flatten());

        let step = build_edit_step(
            turn_id,
            record.before_bytes,
            record.after_bytes,
            step_over_cap,
            now,
        );

        // Handle rename carrying forward an existing Pending entry from `old_path`.
        if let Some(ref old_str) = canon_old_str
            && let Some(prev_idx) = manifest
                .entries
                .iter()
                .position(|e| e.path == *old_str && e.status == FileChangeStatus::Pending)
        {
            let mut prev = manifest.entries.remove(prev_idx);
            let before_sha = record.before_bytes.map(sha256_hex);
            if prev.expected_post_sha256 != before_sha || !prev.post_existed {
                prev.has_interleaved_manual_edits = true;
            }
            if prev.baseline_existed {
                let origin_path = prev.old_path.clone().unwrap_or_else(|| prev.path.clone());
                let origin_display = prev
                    .old_display_path
                    .clone()
                    .unwrap_or_else(|| prev.display_path.clone());
                if origin_path == canon_path_str {
                    prev.old_path = None;
                    prev.old_display_path = None;
                } else {
                    prev.old_path = Some(origin_path);
                    prev.old_display_path = Some(origin_display);
                }
            } else {
                // File was created by AI earlier in this session and now moved:
                // undoing simply deletes the new path.
                prev.old_path = None;
                prev.old_display_path = None;
            }
            prev.path = canon_path_str.clone();
            prev.display_path = display_path;
            prev.post_existed = record.after_existed;
            prev.post_blob_sha256 = post_blob_sha256;
            prev.post_mode = after_mode;
            prev.expected_post_sha256 = expected_post_sha256;
            prev.is_binary = prev.is_binary || before_binary || after_binary;
            if step_over_cap {
                prev.undoable = false;
            }
            prev.kind = classify_kind(
                prev.baseline_existed,
                prev.post_existed,
                prev.old_path.as_deref(),
            );
            prev.turn_id = turn_id;
            prev.edit_count = prev.edit_count.saturating_add(1);
            prev.edit_steps.push(step);
            prev.updated_at_ms = now;
            recompute_entry_diff(session_dir, &mut prev, record.after_bytes);

            // Replace any resolved entry already occupying `canon_path_str`.
            manifest.entries.retain(|e| e.path != canon_path_str);
            manifest.entries.push(prev);
            manifest.revision = manifest.revision.saturating_add(1);
            persist_manifest(session_dir, manifest)?;
            return Ok(build_snapshot(manifest));
        }

        // Check whether an existing entry exists for `canon_path_str`.
        if let Some(idx) = manifest
            .entries
            .iter()
            .position(|e| e.path == canon_path_str)
        {
            if manifest.entries[idx].status == FileChangeStatus::Pending {
                let entry = &mut manifest.entries[idx];
                let before_sha = record.before_bytes.map(sha256_hex);
                if entry.expected_post_sha256 != before_sha
                    || entry.post_existed != record.before_existed
                {
                    entry.has_interleaved_manual_edits = true;
                }
                entry.display_path = display_path;
                entry.post_existed = record.after_existed;
                entry.post_blob_sha256 = post_blob_sha256;
                entry.post_mode = after_mode;
                entry.expected_post_sha256 = expected_post_sha256;
                entry.is_binary = entry.is_binary || before_binary || after_binary;
                if step_over_cap {
                    entry.undoable = false;
                }
                entry.kind = classify_kind(
                    entry.baseline_existed,
                    entry.post_existed,
                    entry.old_path.as_deref(),
                );
                entry.turn_id = turn_id;
                entry.edit_count = entry.edit_count.saturating_add(1);
                entry.edit_steps.push(step);
                entry.updated_at_ms = now;
                recompute_entry_diff(session_dir, entry, record.after_bytes);

                manifest.revision = manifest.revision.saturating_add(1);
                persist_manifest(session_dir, manifest)?;
                return Ok(build_snapshot(manifest));
            }
            // Previously Kept or Undone — re-entering Pending captures a fresh baseline.
            manifest.entries.remove(idx);
        }

        let baseline_blob_sha256 = if record.before_existed && !before_over_cap {
            if let Some(bytes) = record.before_bytes {
                Some(store_blob(session_dir, bytes)?)
            } else {
                None
            }
        } else {
            None
        };

        let undoable = !step_over_cap
            && (!record.before_existed || baseline_blob_sha256.is_some());
        let kind = classify_kind(
            record.before_existed,
            record.after_existed,
            canon_old_str.as_deref(),
        );

        let mut entry = TrackedFileEntry {
            path: canon_path_str,
            display_path,
            old_path: canon_old_str,
            old_display_path,
            kind,
            status: FileChangeStatus::Pending,
            turn_id,
            edit_count: 1,
            is_binary: before_binary || after_binary,
            undoable,
            baseline_existed: record.before_existed,
            baseline_blob_sha256,
            baseline_mode: record.before_mode,
            post_existed: record.after_existed,
            post_blob_sha256,
            post_mode: after_mode,
            expected_post_sha256,
            has_interleaved_manual_edits: false,
            edit_steps: vec![step],
            additions: 0,
            deletions: 0,
            preview_hunks: Vec::new(),
            preview_truncated: false,
            updated_at_ms: now,
        };
        recompute_entry_diff(session_dir, &mut entry, record.after_bytes);

        manifest.entries.push(entry);
        manifest.revision = manifest.revision.saturating_add(1);
        persist_manifest(session_dir, manifest)?;
        Ok(build_snapshot(manifest))
    })
}

/// Return full uncapped diff payload for one tracked file.
pub fn get_diff(session_id: &str, path: &str) -> Result<FileChangeDiffPayload> {
    with_session_manifest(session_id, |session_dir, manifest| {
        let idx = find_entry_index(&manifest.entries, path)
            .ok_or_else(|| anyhow::anyhow!("Tracked file change not found: {path}"))?;
        let entry = &manifest.entries[idx];

        if !entry.undoable {
            return Ok(FileChangeDiffPayload {
                path: entry.path.clone(),
                display_path: entry.display_path.clone(),
                old_path: entry.old_path.clone(),
                kind: entry.kind,
                status: entry.status,
                additions: 0,
                deletions: 0,
                is_binary: entry.is_binary,
                original_content: String::new(),
                modified_content: String::new(),
                unified_diff: format!(
                    "File {} exceeds the 10 MiB snapshot limit — full diff and snapshot undo unavailable",
                    entry.display_path
                ),
                hunks: Vec::new(),
            });
        }

        if entry.is_binary {
            return Ok(FileChangeDiffPayload {
                path: entry.path.clone(),
                display_path: entry.display_path.clone(),
                old_path: entry.old_path.clone(),
                kind: entry.kind,
                status: entry.status,
                additions: 0,
                deletions: 0,
                is_binary: true,
                original_content: String::new(),
                modified_content: String::new(),
                unified_diff: format!("Binary file {} changed", entry.display_path),
                hunks: Vec::new(),
            });
        }

        let original_bytes = if entry.baseline_existed {
            match entry.baseline_blob_sha256.as_deref() {
                Some(hash) => load_blob(session_dir, hash)?,
                None => Vec::new(),
            }
        } else {
            Vec::new()
        };

        let modified_bytes = if entry.post_existed {
            match entry.post_blob_sha256.as_deref() {
                Some(hash) => load_blob(session_dir, hash)?,
                None => std::fs::read(&entry.path).unwrap_or_default(),
            }
        } else {
            Vec::new()
        };

        if is_binary_bytes(&original_bytes) || is_binary_bytes(&modified_bytes) {
            return Ok(FileChangeDiffPayload {
                path: entry.path.clone(),
                display_path: entry.display_path.clone(),
                old_path: entry.old_path.clone(),
                kind: entry.kind,
                status: entry.status,
                additions: 0,
                deletions: 0,
                is_binary: true,
                original_content: String::new(),
                modified_content: String::new(),
                unified_diff: format!("Binary file {} changed", entry.display_path),
                hunks: Vec::new(),
            });
        }

        let original_content = String::from_utf8(original_bytes).unwrap_or_default();
        let modified_content = String::from_utf8(modified_bytes).unwrap_or_default();
        let computed = compute_text_diff(&original_content, &modified_content);
        let unified_diff = build_unified_diff(
            entry.kind,
            &entry.display_path,
            entry.old_display_path.as_deref(),
            &original_content,
            &modified_content,
        );

        Ok(FileChangeDiffPayload {
            path: entry.path.clone(),
            display_path: entry.display_path.clone(),
            old_path: entry.old_path.clone(),
            kind: entry.kind,
            status: entry.status,
            additions: computed.additions,
            deletions: computed.deletions,
            is_binary: false,
            original_content,
            modified_content,
            unified_diff,
            hunks: computed.hunks,
        })
    })
}

/// Return all filesystem paths that will be touched by a mutating file-change
/// action so callers can acquire per-path locks cleanly before invoking
/// [`apply_action`].
pub fn affected_paths_for_action(
    session_id: &str,
    action: FileChangeActionKind,
    path: Option<&str>,
) -> Vec<PathBuf> {
    if matches!(
        action,
        FileChangeActionKind::Keep | FileChangeActionKind::KeepAll
    ) {
        return Vec::new();
    }
    with_session_manifest(session_id, |_session_dir, manifest| {
        let mut paths = Vec::new();
        let collect_entry = |entry: &TrackedFileEntry, out: &mut Vec<PathBuf>| {
            out.push(PathBuf::from(&entry.path));
            if let Some(old) = &entry.old_path {
                out.push(PathBuf::from(old));
            }
        };
        match action {
            FileChangeActionKind::Undo | FileChangeActionKind::Redo => {
                if let Some(p) = path
                    && let Some(idx) = find_entry_index(&manifest.entries, p)
                {
                    collect_entry(&manifest.entries[idx], &mut paths);
                }
            }
            FileChangeActionKind::UndoAll => {
                for entry in &manifest.entries {
                    if entry.status == FileChangeStatus::Pending {
                        collect_entry(entry, &mut paths);
                    }
                }
            }
            FileChangeActionKind::RedoAll => {
                for entry in &manifest.entries {
                    if entry.status == FileChangeStatus::Undone {
                        collect_entry(entry, &mut paths);
                    }
                }
            }
            FileChangeActionKind::Keep | FileChangeActionKind::KeepAll => {}
        }
        Ok(paths)
    })
    .unwrap_or_default()
}

fn disk_sha256(path: &Path) -> Result<Option<String>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(sha256_hex(&bytes))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("failed to read {}", path.display())),
    }
}

fn write_restored_bytes(path: &Path, bytes: &[u8], mode: Option<u32>) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent dir {}", parent.display()))?;
    }
    std::fs::write(path, bytes)
        .with_context(|| format!("failed to write {}", path.display()))?;
    apply_unix_mode(path, mode);
    Ok(())
}

fn make_conflict(entry: &TrackedFileEntry, reason: impl Into<String>) -> FileChangeConflict {
    FileChangeConflict {
        path: entry.path.clone(),
        display_path: entry.display_path.clone(),
        reason: reason.into(),
    }
}

fn undo_single_entry(
    session_dir: &Path,
    entry: &mut TrackedFileEntry,
    force: bool,
) -> std::result::Result<(), FileChangeConflict> {
    if !entry.undoable {
        return Err(make_conflict(
            entry,
            "Change exceeds the 10 MiB snapshot limit or has no baseline snapshot",
        ));
    }

    let current_path = Path::new(&entry.path);

    // 1. Created file (did not exist before baseline).
    if !entry.baseline_existed {
        if !current_path.exists() {
            entry.status = FileChangeStatus::Undone;
            entry.updated_at_ms = now_ms();
            return Ok(());
        }
        let disk_hash = disk_sha256(current_path)
            .map_err(|e| make_conflict(entry, e.to_string()))?;
        if !force
            && (disk_hash != entry.expected_post_sha256 || entry.has_interleaved_manual_edits)
        {
            return Err(make_conflict(
                entry,
                "File was modified manually after the AI created it",
            ));
        }
        std::fs::remove_file(current_path)
            .map_err(|e| make_conflict(entry, format!("Failed to remove created file: {e}")))?;
        entry.status = FileChangeStatus::Undone;
        entry.updated_at_ms = now_ms();
        return Ok(());
    }

    // Baseline existed — load baseline bytes.
    let baseline_hash = entry.baseline_blob_sha256.as_deref().ok_or_else(|| {
        make_conflict(entry, "Baseline snapshot blob is missing for this file")
    })?;
    let baseline_bytes = load_blob(session_dir, baseline_hash)
        .map_err(|e| make_conflict(entry, format!("Failed to load baseline snapshot: {e}")))?;

    // 2. Renamed file (`old_path -> path`).
    if let Some(ref old_path_str) = entry.old_path {
        let old_path = Path::new(old_path_str);
        if !force && old_path != current_path && old_path.exists() {
            return Err(make_conflict(
                entry,
                format!(
                    "Cannot reverse rename: an unrelated file already exists at {}",
                    entry
                        .old_display_path
                        .as_deref()
                        .unwrap_or(old_path_str.as_str())
                ),
            ));
        }

        let disk_bytes = match std::fs::read(current_path) {
            Ok(bytes) => Some(bytes),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
            Err(err) => {
                return Err(make_conflict(
                    entry,
                    format!("Failed to read renamed file: {err}"),
                ));
            }
        };
        let disk_hash = disk_bytes.as_deref().map(sha256_hex);

        if force
            || (disk_hash == entry.expected_post_sha256 && !entry.has_interleaved_manual_edits)
        {
            write_restored_bytes(old_path, &baseline_bytes, entry.baseline_mode)
                .map_err(|e| make_conflict(entry, e.to_string()))?;
            if old_path != current_path && current_path.exists() {
                std::fs::remove_file(current_path).map_err(|e| {
                    make_conflict(entry, format!("Failed to remove renamed destination: {e}"))
                })?;
            }
            entry.status = FileChangeStatus::Undone;
            entry.updated_at_ms = now_ms();
            return Ok(());
        }

        let Some(disk_bytes) = disk_bytes else {
            return Err(make_conflict(
                entry,
                "Renamed file is missing on disk; use force undo to restore original path",
            ));
        };
        if entry.is_binary || is_binary_bytes(&disk_bytes) {
            return Err(make_conflict(
                entry,
                "Renamed binary file was modified manually after the AI edit",
            ));
        }
        let current_text = String::from_utf8(disk_bytes)
            .map_err(|_| make_conflict(entry, "File is not valid UTF-8"))?;
        let merged = reverse_apply_steps(&current_text, &entry.edit_steps)
            .map_err(|reason| make_conflict(entry, reason))?;
        write_restored_bytes(old_path, merged.as_bytes(), entry.baseline_mode)
            .map_err(|e| make_conflict(entry, e.to_string()))?;
        if old_path != current_path && current_path.exists() {
            std::fs::remove_file(current_path).map_err(|e| {
                make_conflict(entry, format!("Failed to remove renamed destination: {e}"))
            })?;
        }
        entry.status = FileChangeStatus::Undone;
        entry.updated_at_ms = now_ms();
        return Ok(());
    }

    // 3. Deleted file (baseline existed, post does not exist).
    if !entry.post_existed {
        if !force && current_path.exists() {
            return Err(make_conflict(
                entry,
                "A new file now exists at the deleted path; use force undo to overwrite",
            ));
        }
        write_restored_bytes(current_path, &baseline_bytes, entry.baseline_mode)
            .map_err(|e| make_conflict(entry, e.to_string()))?;
        entry.status = FileChangeStatus::Undone;
        entry.updated_at_ms = now_ms();
        return Ok(());
    }

    // 4. Modified file (baseline existed, post existed).
    let disk_bytes = match std::fs::read(current_path) {
        Ok(bytes) => Some(bytes),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => {
            return Err(make_conflict(entry, format!("Failed to read file: {err}")));
        }
    };
    let disk_hash = disk_bytes.as_deref().map(sha256_hex);

    if force || (disk_hash == entry.expected_post_sha256 && !entry.has_interleaved_manual_edits) {
        write_restored_bytes(current_path, &baseline_bytes, entry.baseline_mode)
            .map_err(|e| make_conflict(entry, e.to_string()))?;
        entry.status = FileChangeStatus::Undone;
        entry.updated_at_ms = now_ms();
        return Ok(());
    }

    let Some(disk_bytes) = disk_bytes else {
        return Err(make_conflict(
            entry,
            "File was deleted on disk after the AI edit; use force undo to restore",
        ));
    };

    if entry.is_binary || is_binary_bytes(&disk_bytes) {
        return Err(make_conflict(
            entry,
            "Binary file was modified manually after the AI edit",
        ));
    }

    let current_text = String::from_utf8(disk_bytes)
        .map_err(|_| make_conflict(entry, "File is not valid UTF-8"))?;
    let merged = reverse_apply_steps(&current_text, &entry.edit_steps)
        .map_err(|reason| make_conflict(entry, reason))?;
    write_restored_bytes(current_path, merged.as_bytes(), entry.baseline_mode)
        .map_err(|e| make_conflict(entry, e.to_string()))?;
    entry.status = FileChangeStatus::Undone;
    entry.updated_at_ms = now_ms();
    Ok(())
}

fn redo_single_entry(
    session_dir: &Path,
    entry: &mut TrackedFileEntry,
    force: bool,
) -> std::result::Result<(), FileChangeConflict> {
    if entry.status != FileChangeStatus::Undone {
        return Err(make_conflict(entry, "File is not in undone state"));
    }
    if !entry_can_redo(entry) {
        return Err(make_conflict(
            entry,
            "Post-edit snapshot is unavailable; cannot redo",
        ));
    }

    let current_path = Path::new(&entry.path);

    // Verify disk matches baseline unless `force == true`.
    if !force {
        if let Some(ref old_path_str) = entry.old_path {
            let old_path = Path::new(old_path_str);
            let old_hash =
                disk_sha256(old_path).map_err(|e| make_conflict(entry, e.to_string()))?;
            if old_hash != entry.baseline_blob_sha256 {
                return Err(make_conflict(
                    entry,
                    "Original path was modified after undo; use force redo to overwrite",
                ));
            }
            if old_path != current_path && current_path.exists() {
                return Err(make_conflict(
                    entry,
                    "Destination path already exists; use force redo to overwrite",
                ));
            }
        } else if !entry.baseline_existed {
            if current_path.exists() {
                return Err(make_conflict(
                    entry,
                    "A file already exists at the target path; use force redo to overwrite",
                ));
            }
        } else {
            let disk_hash =
                disk_sha256(current_path).map_err(|e| make_conflict(entry, e.to_string()))?;
            if disk_hash != entry.baseline_blob_sha256 {
                return Err(make_conflict(
                    entry,
                    "File on disk differs from pre-edit baseline; use force redo to overwrite",
                ));
            }
        }
    }

    // Re-apply post-edit state.
    if entry.post_existed {
        let post_hash = entry
            .post_blob_sha256
            .as_deref()
            .ok_or_else(|| make_conflict(entry, "Post-edit snapshot blob is missing"))?;
        let post_bytes = load_blob(session_dir, post_hash)
            .map_err(|e| make_conflict(entry, format!("Failed to load post-edit snapshot: {e}")))?;
        write_restored_bytes(current_path, &post_bytes, entry.post_mode)
            .map_err(|e| make_conflict(entry, e.to_string()))?;
        if let Some(ref old_path_str) = entry.old_path {
            let old_path = Path::new(old_path_str);
            if old_path != current_path && old_path.exists() {
                std::fs::remove_file(old_path).map_err(|e| {
                    make_conflict(entry, format!("Failed to remove original path on redo: {e}"))
                })?;
            }
        }
    } else if current_path.exists() {
        std::fs::remove_file(current_path)
            .map_err(|e| make_conflict(entry, format!("Failed to delete file on redo: {e}")))?;
    }

    entry.status = FileChangeStatus::Pending;
    entry.updated_at_ms = now_ms();
    Ok(())
}

/// Apply a Keep, Undo, Redo, KeepAll, UndoAll, or RedoAll review action.
pub fn apply_action(
    session_id: &str,
    action: FileChangeActionKind,
    path: Option<&str>,
    force: bool,
) -> Result<FileChangeActionResponse> {
    with_session_manifest(session_id, |session_dir, manifest| {
        let mut conflicts = Vec::new();
        let mut changed_count = 0usize;

        match action {
            FileChangeActionKind::Keep => {
                let target = path.ok_or_else(|| anyhow::anyhow!("path is required for keep"))?;
                let idx = find_entry_index(&manifest.entries, target)
                    .ok_or_else(|| anyhow::anyhow!("Tracked file change not found: {target}"))?;
                let entry = &mut manifest.entries[idx];
                match entry.status {
                    FileChangeStatus::Pending => {
                        entry.status = FileChangeStatus::Kept;
                        entry.updated_at_ms = now_ms();
                        changed_count = 1;
                    }
                    FileChangeStatus::Kept => {}
                    FileChangeStatus::Undone => {
                        let display_path = entry.display_path.clone();
                        let snapshot = build_snapshot(manifest);
                        return Ok(FileChangeActionResponse {
                            ok: false,
                            message: format!(
                                "Cannot keep {display_path} because it is currently undone; redo it first."
                            ),
                            conflicts,
                            snapshot,
                        });
                    }
                }
            }
            FileChangeActionKind::KeepAll => {
                let now = now_ms();
                for entry in &mut manifest.entries {
                    if entry.status == FileChangeStatus::Pending {
                        entry.status = FileChangeStatus::Kept;
                        entry.updated_at_ms = now;
                        changed_count += 1;
                    }
                }
            }
            FileChangeActionKind::Undo => {
                let target = path.ok_or_else(|| anyhow::anyhow!("path is required for undo"))?;
                let idx = find_entry_index(&manifest.entries, target)
                    .ok_or_else(|| anyhow::anyhow!("Tracked file change not found: {target}"))?;
                let entry = &mut manifest.entries[idx];
                if entry.status == FileChangeStatus::Undone {
                    let display_path = entry.display_path.clone();
                    let snapshot = build_snapshot(manifest);
                    return Ok(FileChangeActionResponse {
                        ok: true,
                        message: format!("{display_path} is already undone"),
                        conflicts,
                        snapshot,
                    });
                }
                match undo_single_entry(session_dir, entry, force) {
                    Ok(()) => changed_count = 1,
                    Err(conflict) => conflicts.push(conflict),
                }
            }
            FileChangeActionKind::UndoAll => {
                for entry in &mut manifest.entries {
                    if entry.status != FileChangeStatus::Pending {
                        continue;
                    }
                    match undo_single_entry(session_dir, entry, force) {
                        Ok(()) => changed_count += 1,
                        Err(conflict) => conflicts.push(conflict),
                    }
                }
            }
            FileChangeActionKind::Redo => {
                let target = path.ok_or_else(|| anyhow::anyhow!("path is required for redo"))?;
                let idx = find_entry_index(&manifest.entries, target)
                    .ok_or_else(|| anyhow::anyhow!("Tracked file change not found: {target}"))?;
                let entry = &mut manifest.entries[idx];
                if entry.status != FileChangeStatus::Undone {
                    let display_path = entry.display_path.clone();
                    let snapshot = build_snapshot(manifest);
                    return Ok(FileChangeActionResponse {
                        ok: false,
                        message: format!(
                            "Cannot redo {display_path} because it is not currently undone"
                        ),
                        conflicts,
                        snapshot,
                    });
                }
                match redo_single_entry(session_dir, entry, force) {
                    Ok(()) => changed_count = 1,
                    Err(conflict) => conflicts.push(conflict),
                }
            }
            FileChangeActionKind::RedoAll => {
                for entry in &mut manifest.entries {
                    if entry.status != FileChangeStatus::Undone {
                        continue;
                    }
                    match redo_single_entry(session_dir, entry, force) {
                        Ok(()) => changed_count += 1,
                        Err(conflict) => conflicts.push(conflict),
                    }
                }
            }
        }

        if changed_count > 0 {
            manifest.revision = manifest.revision.saturating_add(1);
            persist_manifest(session_dir, manifest)?;
        }

        let snapshot = build_snapshot(manifest);
        let ok = conflicts.is_empty();
        let plural = |n: usize| if n == 1 { "file" } else { "files" };
        let message = match action {
            FileChangeActionKind::Keep | FileChangeActionKind::KeepAll => {
                if changed_count == 0 {
                    "No pending file changes to keep".to_string()
                } else {
                    format!("Kept {changed_count} {}", plural(changed_count))
                }
            }
            FileChangeActionKind::Undo | FileChangeActionKind::UndoAll => {
                if !conflicts.is_empty() && changed_count == 0 {
                    format!(
                        "Could not undo {} {} due to manual edit conflicts",
                        conflicts.len(),
                        plural(conflicts.len())
                    )
                } else if !conflicts.is_empty() {
                    format!(
                        "Undid {changed_count} {} ({} conflict{})",
                        plural(changed_count),
                        conflicts.len(),
                        if conflicts.len() == 1 { "" } else { "s" }
                    )
                } else if changed_count == 0 {
                    "No pending file changes to undo".to_string()
                } else {
                    format!("Undid {changed_count} {}", plural(changed_count))
                }
            }
            FileChangeActionKind::Redo | FileChangeActionKind::RedoAll => {
                if !conflicts.is_empty() && changed_count == 0 {
                    format!(
                        "Could not redo {} {} due to conflicts",
                        conflicts.len(),
                        plural(conflicts.len())
                    )
                } else if !conflicts.is_empty() {
                    format!(
                        "Redid {changed_count} {} ({} conflict{})",
                        plural(changed_count),
                        conflicts.len(),
                        if conflicts.len() == 1 { "" } else { "s" }
                    )
                } else if changed_count == 0 {
                    "No undone file changes to redo".to_string()
                } else {
                    format!("Redid {changed_count} {}", plural(changed_count))
                }
            }
        };

        Ok(FileChangeActionResponse {
            ok,
            message,
            conflicts,
            snapshot,
        })
    })
}
