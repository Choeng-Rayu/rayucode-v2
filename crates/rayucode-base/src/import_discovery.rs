//! Shared parallel discovery, project grouping, deduplication, and conflict-safe
//! import/re-sync for external coding-agent sessions (Claude Code CLI, Claude
//! Desktop, Codex CLI, Codex Desktop, Cursor, OpenCode, and Pi).

use crate::import::{
    count_visible_user_turns, import_codex_session_from_path,
    import_codex_session_from_path_with_options, import_cursor_session_from_path,
    import_cursor_session_from_path_with_options, import_opencode_session_from_path,
    import_opencode_session_from_path_with_options, import_pi_session,
    import_pi_session_with_options, import_session_from_file,
    import_session_from_file_with_options, list_claude_code_sessions_lazy,
};
use crate::session::Session;
use chrono::{DateTime, Utc};
use rayucode_import_core::{
    ClaudeCodeSessionInfo, SessionsIndex, claude_code_session_info_from_index,
    codex_title_candidate, collect_files_recursive, collect_recent_files_recursive,
    cursor_cwd_from_transcript_path, cursor_session_id_from_path, extract_external_text_from_json,
    extract_text_from_json_value, imported_claude_code_session_id, imported_codex_session_id,
    imported_cursor_session_id, imported_opencode_session_id, imported_pi_session_id,
    is_cursor_subagent_transcript, parse_rfc3339_json, resolve_claude_session_path,
    truncate_title_text,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// Default per-tool cap so cold discovery stays fast even with thousands of transcripts.
pub const DEFAULT_EXTERNAL_SCAN_LIMIT: usize = 200;

/// Maximum number of lines peeked from a JSONL transcript when inferring a title.
const TITLE_PEEK_MAX_LINES: usize = 48;

/// All canonical external coding-agent source identifiers.
pub const ALL_EXTERNAL_SOURCES: &[&str] = &[
    "claude_code",
    "claude_desktop",
    "codex",
    "codex_desktop",
    "cursor",
    "opencode",
    "pi",
];

/// Configurable roots for external tool discovery. Production code uses
/// [`DiscoveryRoots::default_from_env`]; unit tests construct explicit temp-dir roots.
#[derive(Debug, Clone, Default)]
pub struct DiscoveryRoots {
    /// Whether this root set comes from the standard environment (`user_home_path`),
    /// allowing Claude discovery to reuse `list_claude_code_sessions_lazy`.
    pub use_default_claude_lazy: bool,
    pub claude_projects_dir: Option<PathBuf>,
    pub claude_desktop_sessions_dir: Option<PathBuf>,
    pub codex_sessions_dir: Option<PathBuf>,
    pub codex_global_state_path: Option<PathBuf>,
    pub cursor_projects_dir: Option<PathBuf>,
    pub opencode_sessions_dir: Option<PathBuf>,
    pub pi_sessions_dir: Option<PathBuf>,
}

impl DiscoveryRoots {
    /// Resolve all standard external tool locations, respecting `RAYU_HOME`
    /// sandboxing and `RAYU_CLAUDE_DESKTOP_SESSIONS_DIR`.
    pub fn default_from_env() -> Self {
        Self {
            use_default_claude_lazy: true,
            claude_projects_dir: crate::storage::user_home_path(".claude/projects").ok(),
            claude_desktop_sessions_dir: default_claude_desktop_sessions_dir(),
            codex_sessions_dir: crate::storage::user_home_path(".codex/sessions").ok(),
            codex_global_state_path: crate::storage::user_home_path(".codex/.codex-global-state.json")
                .ok(),
            cursor_projects_dir: crate::storage::user_home_path(".cursor/projects").ok(),
            opencode_sessions_dir: crate::storage::user_home_path(
                ".local/share/opencode/storage/session",
            )
            .ok(),
            pi_sessions_dir: crate::storage::user_home_path(".pi/agent/sessions").ok(),
        }
    }
}

/// Platform-aware path to Claude Desktop's Code tab session metadata directory.
///
/// - Overrideable via `RAYU_CLAUDE_DESKTOP_SESSIONS_DIR` for tests or custom installs.
/// - Respects `RAYU_HOME` sandboxing via `user_home_path(...)`.
pub fn default_claude_desktop_sessions_dir() -> Option<PathBuf> {
    if let Some(raw) = std::env::var_os("RAYU_CLAUDE_DESKTOP_SESSIONS_DIR") {
        let path = PathBuf::from(raw);
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }

    #[cfg(target_os = "macos")]
    {
        crate::storage::user_home_path("Library/Application Support/Claude/claude-code-sessions")
            .ok()
    }

    #[cfg(target_os = "windows")]
    {
        if std::env::var_os("RAYU_HOME").is_some() {
            return crate::storage::user_home_path(
                "AppData/Roaming/Claude/claude-code-sessions",
            )
            .ok();
        }
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(dirs::config_dir)
            .map(|dir| dir.join("Claude").join("claude-code-sessions"))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if std::env::var_os("RAYU_HOME").is_some() {
            return crate::storage::user_home_path(".config/Claude/claude-code-sessions").ok();
        }
        dirs::config_dir()
            .map(|dir| dir.join("Claude").join("claude-code-sessions"))
            .or_else(|| crate::storage::user_home_path(".config/Claude/claude-code-sessions").ok())
    }
}

/// Metadata summary for a single external coding-agent session discovered on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalSessionSummary {
    pub source: String,
    pub external_session_id: String,
    pub external_path: String,
    pub imported_session_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_project_name: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_bytes: Option<u64>,
}

/// Group of external sessions belonging to one external project/workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalProjectSummary {
    pub source: String,
    pub project_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    pub session_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_updated_at_ms: Option<i64>,
    pub sessions: Vec<ExternalSessionSummary>,
}

/// Request item identifying one external session to import or re-sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportExternalItem {
    pub source: String,
    pub external_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_path: Option<String>,
}

/// Why an external session import item was skipped instead of materialized.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportSkipReason {
    Conflict,
    NotFound,
    UnsupportedSource,
    Error,
}

impl ImportSkipReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Conflict => "conflict",
            Self::NotFound => "not_found",
            Self::UnsupportedSource => "unsupported_source",
            Self::Error => "error",
        }
    }
}

/// Skipped item detail returned from [`import_external_sessions`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportSkippedItem {
    pub source: String,
    pub external_session_id: String,
    pub reason: ImportSkipReason,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub existing_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Materialized session returned from [`import_external_sessions`].
#[derive(Debug, Clone)]
pub struct ImportedSessionRecord {
    pub session: Session,
    pub source: String,
    pub external_session_id: String,
    pub external_path: String,
    pub external_project_name: Option<String>,
    pub forked_from_session_id: Option<String>,
}

/// Batch outcome of [`import_external_sessions`].
#[derive(Debug, Default)]
pub struct ImportExternalResult {
    pub sessions: Vec<ImportedSessionRecord>,
    pub skipped: Vec<ImportSkippedItem>,
}

/// Lightweight view of a native Rayu session for deduplication with external sessions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeSessionRecord {
    pub session_id: String,
    pub working_dir: Option<String>,
    pub title: Option<String>,
    pub saved: bool,
    pub updated_at_ms: Option<i64>,
    pub transcript_bytes: Option<u64>,
}

/// Deduplicated session row produced by [`merge_with_native_sessions`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergedSessionRecord {
    pub session_id: String,
    pub source: String,
    pub external_session_id: Option<String>,
    pub external_path: Option<String>,
    pub external_project_name: Option<String>,
    pub imported: bool,
    pub sync_stale: bool,
    pub working_dir: Option<String>,
    pub title: Option<String>,
    pub saved: bool,
    pub updated_at_ms: Option<i64>,
    pub transcript_bytes: Option<u64>,
    /// Index into the original `native` slice when backed by a native/imported Rayu session.
    pub native_index: Option<usize>,
}

/// Infer the external tool source and external session id for an already-imported
/// Rayu session id (`imported_cc_*`, `imported_codex_*`, etc.).
pub fn infer_imported_session_source(session_id: &str) -> Option<(&'static str, String)> {
    if let Some(rest) = session_id.strip_prefix("imported_cc_") {
        return Some(("claude_code", rest.to_string()));
    }
    if let Some(rest) = session_id.strip_prefix("imported_codex_") {
        return Some(("codex", rest.to_string()));
    }
    if let Some(rest) = session_id.strip_prefix("imported_cursor_") {
        return Some(("cursor", rest.to_string()));
    }
    if let Some(rest) = session_id.strip_prefix("imported_opencode_") {
        return Some(("opencode", rest.to_string()));
    }
    if let Some(rest) = session_id.strip_prefix("imported_pi_") {
        return Some(("pi", rest.to_string()));
    }
    None
}

/// Normalize a user-supplied source filter token into the set of canonical source ids it matches.
fn expand_source_token(token: &str) -> Vec<&'static str> {
    match token.trim().to_ascii_lowercase().as_str() {
        "all" => vec![
            "rayu",
            "claude_code",
            "claude_desktop",
            "codex",
            "codex_desktop",
            "cursor",
            "opencode",
            "pi",
        ],
        "rayu" => vec!["rayu"],
        "claude" => vec!["claude_code", "claude_desktop"],
        "claude_code" | "claude-code" => vec!["claude_code"],
        "claude_desktop" | "claude-desktop" => vec!["claude_desktop"],
        "codex" => vec!["codex", "codex_desktop"],
        "codex_cli" | "codex-cli" => vec!["codex"],
        "codex_desktop" | "codex-desktop" => vec!["codex_desktop"],
        "cursor" => vec!["cursor"],
        "opencode" => vec!["opencode"],
        "pi" => vec!["pi"],
        _ => Vec::new(),
    }
}

/// Check whether a canonical session `source` matches an optional filter slice.
///
/// Supports group aliases `"claude"` (`claude_code | claude_desktop`) and
/// `"codex"` (`codex | codex_desktop`). Empty or `None` matches everything.
pub fn source_matches_filter(source: &str, sources: Option<&[String]>) -> bool {
    let Some(filter) = sources else {
        return true;
    };
    if filter.is_empty() {
        return true;
    }
    let normalized = source.trim().to_ascii_lowercase();
    filter.iter().any(|token| {
        let expanded = expand_source_token(token);
        if expanded.is_empty() {
            token.trim().eq_ignore_ascii_case(&normalized)
        } else {
            expanded.iter().any(|candidate| *candidate == normalized)
        }
    })
}

fn enabled_external_sources(sources: Option<&[String]>) -> HashSet<&'static str> {
    ALL_EXTERNAL_SOURCES
        .iter()
        .copied()
        .filter(|source| source_matches_filter(source, sources))
        .collect()
}

/// Discover local external sessions in parallel across installed coding agents.
pub fn list_external_sessions(
    scan_limit: usize,
    sources: Option<&[String]>,
) -> Vec<ExternalSessionSummary> {
    let roots = DiscoveryRoots::default_from_env();
    list_external_sessions_with_roots(&roots, scan_limit, sources)
}

/// Discover local external sessions using explicit [`DiscoveryRoots`].
pub fn list_external_sessions_with_roots(
    roots: &DiscoveryRoots,
    scan_limit: usize,
    sources: Option<&[String]>,
) -> Vec<ExternalSessionSummary> {
    if scan_limit == 0 {
        return Vec::new();
    }
    let enabled = enabled_external_sources(sources);
    if enabled.is_empty() {
        return Vec::new();
    }

    let want_claude_code = enabled.contains("claude_code");
    let want_claude_desktop = enabled.contains("claude_desktop");
    let want_codex = enabled.contains("codex");
    let want_codex_desktop = enabled.contains("codex_desktop");
    let want_cursor = enabled.contains("cursor");
    let want_opencode = enabled.contains("opencode");
    let want_pi = enabled.contains("pi");

    let mut sessions = std::thread::scope(|scope| {
        let claude = (want_claude_code || want_claude_desktop).then(|| {
            scope.spawn(move || {
                discover_claude_sessions(roots, scan_limit, want_claude_code, want_claude_desktop)
            })
        });
        let codex = (want_codex || want_codex_desktop).then(|| {
            scope.spawn(move || {
                discover_codex_sessions(roots, scan_limit, want_codex, want_codex_desktop)
            })
        });
        let cursor = want_cursor.then(|| scope.spawn(move || discover_cursor_sessions(roots, scan_limit)));
        let opencode =
            want_opencode.then(|| scope.spawn(move || discover_opencode_sessions(roots, scan_limit)));
        let pi = want_pi.then(|| scope.spawn(move || discover_pi_sessions(roots, scan_limit)));

        let mut out = Vec::new();
        for handle in [claude, codex, cursor, opencode, pi].into_iter().flatten() {
            if let Ok(found) = handle.join() {
                out.extend(found);
            }
        }
        out
    });

    sessions.sort_by(|a, b| {
        b.updated_at_ms
            .cmp(&a.updated_at_ms)
            .then_with(|| a.source.cmp(&b.source))
            .then_with(|| a.external_session_id.cmp(&b.external_session_id))
    });
    sessions
}

/// Group discovered external sessions by `(source, project folder / project name)`.
pub fn list_external_projects(
    scan_limit: usize,
    source: Option<&str>,
) -> Vec<ExternalProjectSummary> {
    let roots = DiscoveryRoots::default_from_env();
    list_external_projects_with_roots(&roots, scan_limit, source)
}

/// Group discovered external sessions using explicit [`DiscoveryRoots`].
pub fn list_external_projects_with_roots(
    roots: &DiscoveryRoots,
    scan_limit: usize,
    source: Option<&str>,
) -> Vec<ExternalProjectSummary> {
    let filter_vec = source
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| vec![s.to_string()]);
    let sessions = list_external_sessions_with_roots(roots, scan_limit, filter_vec.as_deref());

    let mut groups: BTreeMap<(String, String), ExternalProjectSummary> = BTreeMap::new();
    for session in sessions {
        let project_name = session
            .external_project_name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .or_else(|| {
                session
                    .working_dir
                    .as_deref()
                    .and_then(path_basename_string)
            })
            .unwrap_or_else(|| "Ungrouped".to_string());

        let key_path = session
            .working_dir
            .as_deref()
            .map(normalize_path_key)
            .unwrap_or_else(|| project_name.to_ascii_lowercase());
        let key = (session.source.clone(), key_path);

        let entry = groups.entry(key).or_insert_with(|| ExternalProjectSummary {
            source: session.source.clone(),
            project_name: project_name.clone(),
            working_dir: session.working_dir.clone(),
            session_count: 0,
            latest_updated_at_ms: None,
            sessions: Vec::new(),
        });
        entry.session_count += 1;
        entry.latest_updated_at_ms = Some(
            entry
                .latest_updated_at_ms
                .map_or(session.updated_at_ms, |prev| prev.max(session.updated_at_ms)),
        );
        if entry.working_dir.is_none() && session.working_dir.is_some() {
            entry.working_dir = session.working_dir.clone();
        }
        entry.sessions.push(session);
    }

    let mut projects: Vec<ExternalProjectSummary> = groups.into_values().collect();
    for project in &mut projects {
        project.sessions.sort_by(|a, b| {
            b.updated_at_ms
                .cmp(&a.updated_at_ms)
                .then_with(|| a.external_session_id.cmp(&b.external_session_id))
        });
    }
    projects.sort_by(|a, b| {
        b.latest_updated_at_ms
            .unwrap_or(0)
            .cmp(&a.latest_updated_at_ms.unwrap_or(0))
            .then_with(|| a.source.cmp(&b.source))
            .then_with(|| a.project_name.cmp(&b.project_name))
    });
    projects
}

/// Deduplicate native Rayu sessions with discovered external sessions.
///
/// If a native Rayu session has id `imported_<tool>_<id>` matching a discovered
/// external session, its external metadata (`source`, `external_session_id`,
/// `external_path`, `external_project_name`, `imported: true`) and
/// `sync_stale = external_mtime_ms > local_updated_at_ms` are merged onto that
/// single row rather than emitting duplicates.
pub fn merge_with_native_sessions(
    native: &[NativeSessionRecord],
    external: &[ExternalSessionSummary],
) -> Vec<MergedSessionRecord> {
    let mut external_by_imported_id: HashMap<&str, &ExternalSessionSummary> =
        HashMap::with_capacity(external.len());
    for ext in external {
        external_by_imported_id
            .entry(ext.imported_session_id.as_str())
            .or_insert(ext);
    }

    let mut matched_imported_ids: HashSet<String> = HashSet::new();
    let mut merged: Vec<MergedSessionRecord> = Vec::with_capacity(native.len() + external.len());

    for (idx, item) in native.iter().enumerate() {
        if let Some(ext) = external_by_imported_id.get(item.session_id.as_str()) {
            matched_imported_ids.insert(ext.imported_session_id.clone());
            let sync_stale = item
                .updated_at_ms
                .is_some_and(|local_ms| ext.updated_at_ms > local_ms);
            merged.push(MergedSessionRecord {
                session_id: item.session_id.clone(),
                source: ext.source.clone(),
                external_session_id: Some(ext.external_session_id.clone()),
                external_path: Some(ext.external_path.clone()),
                external_project_name: ext.external_project_name.clone(),
                imported: true,
                sync_stale,
                working_dir: item.working_dir.clone().or_else(|| ext.working_dir.clone()),
                title: item.title.clone().or_else(|| Some(ext.title.clone())),
                saved: item.saved,
                updated_at_ms: item.updated_at_ms.or(Some(ext.updated_at_ms)),
                transcript_bytes: item.transcript_bytes.or(ext.transcript_bytes),
                native_index: Some(idx),
            });
        } else if let Some((inferred_source, inferred_ext_id)) =
            infer_imported_session_source(&item.session_id)
        {
            merged.push(MergedSessionRecord {
                session_id: item.session_id.clone(),
                source: inferred_source.to_string(),
                external_session_id: Some(inferred_ext_id),
                external_path: None,
                external_project_name: None,
                imported: true,
                sync_stale: false,
                working_dir: item.working_dir.clone(),
                title: item.title.clone(),
                saved: item.saved,
                updated_at_ms: item.updated_at_ms,
                transcript_bytes: item.transcript_bytes,
                native_index: Some(idx),
            });
        } else {
            merged.push(MergedSessionRecord {
                session_id: item.session_id.clone(),
                source: "rayu".to_string(),
                external_session_id: None,
                external_path: None,
                external_project_name: None,
                imported: false,
                sync_stale: false,
                working_dir: item.working_dir.clone(),
                title: item.title.clone(),
                saved: item.saved,
                updated_at_ms: item.updated_at_ms,
                transcript_bytes: item.transcript_bytes,
                native_index: Some(idx),
            });
        }
    }

    for ext in external {
        if matched_imported_ids.contains(&ext.imported_session_id) {
            continue;
        }
        merged.push(MergedSessionRecord {
            session_id: format!("{}:{}", ext.source, ext.external_session_id),
            source: ext.source.clone(),
            external_session_id: Some(ext.external_session_id.clone()),
            external_path: Some(ext.external_path.clone()),
            external_project_name: ext.external_project_name.clone(),
            imported: false,
            sync_stale: false,
            working_dir: ext.working_dir.clone(),
            title: Some(ext.title.clone()),
            saved: false,
            updated_at_ms: Some(ext.updated_at_ms),
            transcript_bytes: ext.transcript_bytes,
            native_index: None,
        });
    }

    merged.sort_by(|a, b| {
        b.saved
            .cmp(&a.saved)
            .then_with(|| b.updated_at_ms.unwrap_or(0).cmp(&a.updated_at_ms.unwrap_or(0)))
            .then_with(|| a.session_id.cmp(&b.session_id))
    });

    merged
}

/// Materialize one or more external sessions into `~/.rayu/sessions/`, with
/// conflict-safe re-sync when local Rayu user turns were added after import.
pub fn import_external_sessions(
    items: &[ImportExternalItem],
    force_resync: bool,
    fork_on_conflict: bool,
) -> ImportExternalResult {
    let roots = DiscoveryRoots::default_from_env();
    import_external_sessions_with_roots(&roots, items, force_resync, fork_on_conflict)
}

/// Materialize external sessions using explicit [`DiscoveryRoots`] for path resolution.
pub fn import_external_sessions_with_roots(
    roots: &DiscoveryRoots,
    items: &[ImportExternalItem],
    force_resync: bool,
    fork_on_conflict: bool,
) -> ImportExternalResult {
    let mut result = ImportExternalResult::default();
    if items.is_empty() {
        return result;
    }

    // Lazily populate discovered external index only if an item lacks an explicit
    // path or we want project-name enrichment.
    let mut discovered_cache: Option<Vec<ExternalSessionSummary>> = None;

    for item in items {
        let normalized_source = normalize_import_source(&item.source);
        let Some(canonical_source) = normalized_source else {
            result.skipped.push(ImportSkippedItem {
                source: item.source.clone(),
                external_session_id: item.external_session_id.clone(),
                reason: ImportSkipReason::UnsupportedSource,
                existing_session_id: None,
                message: Some(format!("Unsupported external source: {}", item.source)),
            });
            continue;
        };

        let resolved_summary = resolve_item_summary(
            roots,
            canonical_source,
            &item.external_session_id,
            item.external_path.as_deref(),
            &mut discovered_cache,
        );

        let path_buf = match item
            .external_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| {
                resolved_summary
                    .as_ref()
                    .map(|summary| PathBuf::from(&summary.external_path))
                    .filter(|p| p.is_file())
            }) {
            Some(path) => path,
            None => {
                result.skipped.push(ImportSkippedItem {
                    source: canonical_source.to_string(),
                    external_session_id: item.external_session_id.clone(),
                    reason: ImportSkipReason::NotFound,
                    existing_session_id: None,
                    message: Some(format!(
                        "External transcript not found for {}:{}",
                        canonical_source, item.external_session_id
                    )),
                });
                continue;
            }
        };

        let path_str = path_buf.to_string_lossy().to_string();
        let target_session_id =
            canonical_imported_session_id(canonical_source, &item.external_session_id, &path_str);
        let project_name = resolved_summary
            .as_ref()
            .and_then(|summary| summary.external_project_name.clone());
        let effective_source = resolved_summary
            .as_ref()
            .map(|summary| summary.source.clone())
            .unwrap_or_else(|| canonical_source.to_string());

        let existing = if crate::session::session_exists(&target_session_id) {
            Session::load(&target_session_id).ok()
        } else {
            None
        };

        if let Some(existing_session) = existing {
            let has_local_turns = existing_has_local_user_turns(&existing_session);
            if has_local_turns && !force_resync {
                if fork_on_conflict {
                    let forked_id = Session::create(Some(target_session_id.clone()), None).id;
                    match run_importer(
                        canonical_source,
                        &path_buf,
                        &item.external_session_id,
                        Some(forked_id),
                        Some(target_session_id.clone()),
                        true,
                    ) {
                        Ok(session) => {
                            result.sessions.push(ImportedSessionRecord {
                                session,
                                source: effective_source,
                                external_session_id: item.external_session_id.clone(),
                                external_path: path_str,
                                external_project_name: project_name,
                                forked_from_session_id: Some(target_session_id),
                            });
                        }
                        Err(err) => {
                            result.skipped.push(ImportSkippedItem {
                                source: effective_source,
                                external_session_id: item.external_session_id.clone(),
                                reason: ImportSkipReason::Error,
                                existing_session_id: Some(target_session_id),
                                message: Some(err.to_string()),
                            });
                        }
                    }
                } else {
                    result.skipped.push(ImportSkippedItem {
                        source: effective_source,
                        external_session_id: item.external_session_id.clone(),
                        reason: ImportSkipReason::Conflict,
                        existing_session_id: Some(target_session_id),
                        message: Some(
                            "Local Rayu turns were added after import; preserve local turns or fork on conflict"
                                .to_string(),
                        ),
                    });
                }
                continue;
            }

            // Either no local Rayu turns were added or `force_resync` was requested:
            // safely refresh the canonical imported session in place.
            match run_importer(
                canonical_source,
                &path_buf,
                &item.external_session_id,
                Some(target_session_id.clone()),
                None,
                true,
            ) {
                Ok(session) => {
                    result.sessions.push(ImportedSessionRecord {
                        session,
                        source: effective_source,
                        external_session_id: item.external_session_id.clone(),
                        external_path: path_str,
                        external_project_name: project_name,
                        forked_from_session_id: None,
                    });
                }
                Err(err) => {
                    result.skipped.push(ImportSkippedItem {
                        source: effective_source,
                        external_session_id: item.external_session_id.clone(),
                        reason: ImportSkipReason::Error,
                        existing_session_id: Some(target_session_id),
                        message: Some(err.to_string()),
                    });
                }
            }
            continue;
        }

        // First-time import: invoke the standard public importers directly.
        match run_importer(
            canonical_source,
            &path_buf,
            &item.external_session_id,
            None,
            None,
            false,
        ) {
            Ok(session) => {
                result.sessions.push(ImportedSessionRecord {
                    session,
                    source: effective_source,
                    external_session_id: item.external_session_id.clone(),
                    external_path: path_str,
                    external_project_name: project_name,
                    forked_from_session_id: None,
                });
            }
            Err(err) => {
                result.skipped.push(ImportSkippedItem {
                    source: effective_source,
                    external_session_id: item.external_session_id.clone(),
                    reason: ImportSkipReason::Error,
                    existing_session_id: None,
                    message: Some(err.to_string()),
                });
            }
        }
    }

    result
}

fn existing_has_local_user_turns(existing: &Session) -> bool {
    let current_user_turns = count_visible_user_turns(existing);
    match existing.imported_turn_count {
        Some(base) => current_user_turns > base,
        // Legacy imported sessions without `imported_turn_count` are conservatively
        // treated as having local turns if they contain any visible user turn,
        // so we never silently overwrite pre-existing continuations.
        None => current_user_turns > 0,
    }
}

fn normalize_import_source(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "claude" | "claude_code" | "claude-code" => Some("claude_code"),
        "claude_desktop" | "claude-desktop" => Some("claude_desktop"),
        "codex" | "codex_cli" | "codex-cli" => Some("codex"),
        "codex_desktop" | "codex-desktop" => Some("codex_desktop"),
        "cursor" => Some("cursor"),
        "opencode" => Some("opencode"),
        "pi" => Some("pi"),
        _ => None,
    }
}

fn canonical_imported_session_id(source: &str, external_session_id: &str, path: &str) -> String {
    match source {
        "claude_code" | "claude_desktop" => imported_claude_code_session_id(external_session_id),
        "codex" | "codex_desktop" => imported_codex_session_id(external_session_id),
        "cursor" => imported_cursor_session_id(external_session_id),
        "opencode" => imported_opencode_session_id(external_session_id),
        "pi" => imported_pi_session_id(path),
        _ => format!("imported_{source}_{external_session_id}"),
    }
}

fn run_importer(
    canonical_source: &str,
    path: &Path,
    external_session_id: &str,
    target_session_id: Option<String>,
    parent_id: Option<String>,
    force_overwrite: bool,
) -> anyhow::Result<Session> {
    match canonical_source {
        "claude_code" | "claude_desktop" => {
            if let Some(target_id) = target_session_id {
                import_session_from_file_with_options(
                    path,
                    external_session_id,
                    target_id,
                    parent_id,
                    false,
                    force_overwrite,
                )
            } else {
                import_session_from_file(path, external_session_id)
            }
        }
        "codex" | "codex_desktop" => {
            if target_session_id.is_some() || force_overwrite {
                import_codex_session_from_path_with_options(
                    path,
                    Some(external_session_id),
                    target_session_id,
                    parent_id,
                    force_overwrite,
                )
            } else {
                import_codex_session_from_path(path, Some(external_session_id))
            }
        }
        "cursor" => {
            if target_session_id.is_some() || force_overwrite {
                import_cursor_session_from_path_with_options(
                    path,
                    Some(external_session_id),
                    target_session_id,
                    parent_id,
                    force_overwrite,
                )
            } else {
                import_cursor_session_from_path(path, Some(external_session_id))
            }
        }
        "opencode" => {
            if target_session_id.is_some() || force_overwrite {
                import_opencode_session_from_path_with_options(
                    path,
                    Some(external_session_id),
                    target_session_id,
                    parent_id,
                    force_overwrite,
                )
            } else {
                import_opencode_session_from_path(path, Some(external_session_id))
            }
        }
        "pi" => {
            let path_str = path.to_string_lossy();
            if target_session_id.is_some() || force_overwrite {
                import_pi_session_with_options(
                    &path_str,
                    target_session_id,
                    parent_id,
                    force_overwrite,
                )
            } else {
                import_pi_session(&path_str)
            }
        }
        other => anyhow::bail!("Unsupported external source: {other}"),
    }
}

fn resolve_item_summary(
    roots: &DiscoveryRoots,
    canonical_source: &str,
    external_session_id: &str,
    explicit_path: Option<&str>,
    discovered_cache: &mut Option<Vec<ExternalSessionSummary>>,
) -> Option<ExternalSessionSummary> {
    let sessions = discovered_cache.get_or_insert_with(|| {
        list_external_sessions_with_roots(roots, DEFAULT_EXTERNAL_SCAN_LIMIT, None)
    });
    if let Some(found) = sessions.iter().find(|s| {
        s.external_session_id == external_session_id
            && sources_compatible(&s.source, canonical_source)
    }) {
        return Some(found.clone());
    }
    if let Some(path) = explicit_path {
        return sessions.iter().find(|s| s.external_path == path).cloned();
    }
    None
}

fn sources_compatible(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    matches!(
        (a, b),
        ("claude_code", "claude_desktop")
            | ("claude_desktop", "claude_code")
            | ("codex", "codex_desktop")
            | ("codex_desktop", "codex")
    )
}

// ---------------------------------------------------------------------------
// Claude Code CLI + Claude Desktop discovery
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct ClaudeDesktopMeta {
    session_ids: Vec<String>,
    transcript_path: Option<String>,
    working_dir: Option<String>,
    project_name: Option<String>,
    title: Option<String>,
    updated_at_ms: Option<i64>,
}

#[derive(Default)]
struct ClaudeDesktopIndex {
    by_session_id: HashMap<String, ClaudeDesktopMeta>,
    by_transcript_path: HashMap<String, ClaudeDesktopMeta>,
    entries: Vec<ClaudeDesktopMeta>,
}

fn load_claude_desktop_index(dir: Option<&Path>) -> ClaudeDesktopIndex {
    let mut index = ClaudeDesktopIndex::default();
    let Some(root) = dir.filter(|path| path.is_dir()) else {
        return index;
    };

    for path in collect_files_recursive(root, "json") {
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_reader::<_, serde_json::Value>(file) else {
            continue;
        };
        extract_claude_desktop_entries(&value, &path, None, None, &mut index.entries);
    }

    for meta in &index.entries {
        for id in &meta.session_ids {
            index
                .by_session_id
                .entry(id.clone())
                .or_insert_with(|| meta.clone());
        }
        if let Some(transcript_path) = &meta.transcript_path {
            index
                .by_transcript_path
                .entry(normalize_path_key(transcript_path))
                .or_insert_with(|| meta.clone());
        }
    }

    index
}

fn extract_claude_desktop_entries(
    value: &serde_json::Value,
    file_path: &Path,
    inherited_dir: Option<&str>,
    inherited_project_name: Option<&str>,
    out: &mut Vec<ClaudeDesktopMeta>,
) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                extract_claude_desktop_entries(
                    item,
                    file_path,
                    inherited_dir,
                    inherited_project_name,
                    out,
                );
            }
        }
        serde_json::Value::Object(map) => {
            let working_dir = first_non_empty_str(
                map,
                &[
                    "cwd",
                    "workingDirectory",
                    "working_dir",
                    "projectPath",
                    "project_path",
                    "workspacePath",
                    "folderPath",
                ],
            )
            .or_else(|| {
                map.get("userSelectedFolders")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.iter().find_map(|item| item.as_str()))
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            })
            .or_else(|| inherited_dir.map(str::to_string));

            let project_name = first_non_empty_str(
                map,
                &[
                    "projectName",
                    "project_name",
                    "workspaceName",
                    "workspace_name",
                ],
            )
            .or_else(|| inherited_project_name.map(str::to_string))
            .or_else(|| working_dir.as_deref().and_then(path_basename_string));

            if let Some(nested) = map.get("sessions").and_then(|v| v.as_array()) {
                for child in nested {
                    extract_claude_desktop_entries(
                        child,
                        file_path,
                        working_dir.as_deref(),
                        project_name.as_deref(),
                        out,
                    );
                }
                return;
            }

            let mut session_ids = Vec::new();
            for key in [
                "cliSessionId",
                "sessionId",
                "session_id",
                "localSessionId",
                "id",
            ] {
                if let Some(raw) = map
                    .get(key)
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    if !session_ids.iter().any(|existing| existing == raw) {
                        session_ids.push(raw.to_string());
                    }
                    if let Some(stripped) = raw.strip_prefix("local_")
                        && !stripped.is_empty()
                        && !session_ids.iter().any(|existing| existing == stripped)
                    {
                        session_ids.push(stripped.to_string());
                    }
                }
            }
            if session_ids.is_empty()
                && let Some(stem) = file_path.file_stem().and_then(|s| s.to_str())
                && !stem.is_empty()
            {
                session_ids.push(stem.to_string());
                if let Some(stripped) = stem.strip_prefix("local_")
                    && !stripped.is_empty()
                {
                    session_ids.push(stripped.to_string());
                }
            }

            let transcript_path = first_non_empty_str(
                map,
                &["transcriptPath", "transcript_path", "fullPath", "full_path"],
            );
            let title = first_non_empty_str(map, &["title", "name", "summary"]);
            let updated_at_ms = first_timestamp_ms(
                map,
                &[
                    "updatedAt",
                    "updated_at",
                    "lastActivityAt",
                    "last_activity_at",
                    "createdAt",
                    "created_at",
                ],
            );

            if !session_ids.is_empty() || transcript_path.is_some() {
                out.push(ClaudeDesktopMeta {
                    session_ids,
                    transcript_path,
                    working_dir,
                    project_name,
                    title,
                    updated_at_ms,
                });
            }
        }
        _ => {}
    }
}

fn discover_claude_sessions(
    roots: &DiscoveryRoots,
    scan_limit: usize,
    want_claude_code: bool,
    want_claude_desktop: bool,
) -> Vec<ExternalSessionSummary> {
    let desktop_index = load_claude_desktop_index(roots.claude_desktop_sessions_dir.as_deref());

    let raw_sessions = if roots.use_default_claude_lazy {
        list_claude_code_sessions_lazy(scan_limit)
            .unwrap_or_default()
            .into_iter()
            .filter(|info| {
                !crate::legacy_compat::is_rayu_cli_project_transcript_path(Path::new(
                    &info.full_path,
                ))
            })
            .collect::<Vec<_>>()
    } else if let Some(projects_dir) = roots.claude_projects_dir.as_deref() {
        list_claude_sessions_in_projects_dir(projects_dir, scan_limit)
    } else {
        Vec::new()
    };

    let mut out = Vec::new();
    let mut seen_ids = HashSet::new();

    for info in raw_sessions {
        let desktop_meta = desktop_index
            .by_session_id
            .get(&info.session_id)
            .or_else(|| {
                desktop_index
                    .by_transcript_path
                    .get(&normalize_path_key(&info.full_path))
            });

        let (source, external_project_name, working_dir, title) = if let Some(meta) = desktop_meta {
            let working_dir = meta.working_dir.clone().or(info.project_path.clone());
            let project_name = meta
                .project_name
                .clone()
                .or_else(|| working_dir.as_deref().and_then(path_basename_string));
            let title = meta
                .title
                .clone()
                .or_else(|| info.summary.clone().filter(|s| !s.trim().is_empty()))
                .unwrap_or_else(|| truncate_title_text(&info.first_prompt, 72));
            ("claude_desktop", project_name, working_dir, title)
        } else {
            let title = info
                .summary
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| truncate_title_text(&info.first_prompt, 72));
            ("claude_code", None, info.project_path.clone(), title)
        };

        if (source == "claude_code" && !want_claude_code)
            || (source == "claude_desktop" && !want_claude_desktop)
        {
            continue;
        }

        let path = Path::new(&info.full_path);
        let file_mtime_ms = file_modified_ms(path);
        let created_at_ms = info
            .created
            .map(|dt| dt.timestamp_millis())
            .or(file_mtime_ms)
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let updated_at_ms = file_mtime_ms
            .into_iter()
            .chain(info.modified.map(|dt| dt.timestamp_millis()))
            .chain(desktop_meta.and_then(|meta| meta.updated_at_ms))
            .max()
            .unwrap_or(created_at_ms);

        seen_ids.insert(info.session_id.clone());
        out.push(ExternalSessionSummary {
            source: source.to_string(),
            imported_session_id: imported_claude_code_session_id(&info.session_id),
            external_session_id: info.session_id,
            external_path: info.full_path.clone(),
            title,
            working_dir,
            external_project_name,
            created_at_ms,
            updated_at_ms,
            transcript_bytes: file_len_opt(path),
        });
    }

    // Also include any Claude Desktop metadata entries whose `transcriptPath`
    // exists on disk even if it wasn't under `~/.claude/projects`.
    if want_claude_desktop {
        for meta in &desktop_index.entries {
            let Some(transcript_path) = meta.transcript_path.as_deref() else {
                continue;
            };
            let path = Path::new(transcript_path);
            if !path.is_file() {
                continue;
            }
            let Some(session_id) = meta.session_ids.first().cloned() else {
                continue;
            };
            if !seen_ids.insert(session_id.clone()) {
                continue;
            }
            let mtime_ms = file_modified_ms(path)
                .or(meta.updated_at_ms)
                .unwrap_or_else(|| Utc::now().timestamp_millis());
            let project_name = meta
                .project_name
                .clone()
                .or_else(|| meta.working_dir.as_deref().and_then(path_basename_string));
            let title = meta
                .title
                .clone()
                .unwrap_or_else(|| format!("Claude session {}", truncate_short_id(&session_id)));
            out.push(ExternalSessionSummary {
                source: "claude_desktop".to_string(),
                imported_session_id: imported_claude_code_session_id(&session_id),
                external_session_id: session_id,
                external_path: transcript_path.to_string(),
                title,
                working_dir: meta.working_dir.clone(),
                external_project_name: project_name,
                created_at_ms: mtime_ms,
                updated_at_ms: mtime_ms,
                transcript_bytes: file_len_opt(path),
            });
        }
    }

    out.truncate(scan_limit);
    out
}

fn list_claude_sessions_in_projects_dir(
    projects_dir: &Path,
    scan_limit: usize,
) -> Vec<ClaudeCodeSessionInfo> {
    if !projects_dir.is_dir() {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(projects_dir) else {
        return Vec::new();
    };
    let mut project_dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    project_dirs.sort();

    let mut all_sessions = Vec::new();
    let mut seen_session_ids = HashSet::new();

    for project_dir in &project_dirs {
        let index_path = project_dir.join("sessions-index.json");
        if index_path.is_file()
            && let Ok(content) = std::fs::read_to_string(&index_path)
            && let Ok(index) = serde_json::from_str::<SessionsIndex>(&content)
        {
            for entry in index.entries {
                if entry.is_sidechain.unwrap_or(false) {
                    continue;
                }
                let Some(path) = resolve_claude_session_path(project_dir, &entry) else {
                    continue;
                };
                if let Some(session) = claude_code_session_info_from_index(&path, &entry) {
                    seen_session_ids.insert(session.session_id.clone());
                    all_sessions.push(session);
                }
            }
        }
    }

    all_sessions.extend(
        crate::legacy_compat::peek_unindexed_claude_compatible_sessions(
            &project_dirs,
            &mut seen_session_ids,
            scan_limit,
        ),
    );

    all_sessions.sort_by(|a, b| {
        let a_date = a.modified.or(a.created);
        let b_date = b.modified.or(b.created);
        b_date.cmp(&a_date)
    });
    all_sessions.truncate(scan_limit);
    all_sessions
}

// ---------------------------------------------------------------------------
// Codex CLI + Codex Desktop discovery
// ---------------------------------------------------------------------------

#[derive(Default)]
struct CodexDesktopState {
    workspace_roots: Vec<(String, String, Option<String>)>, // (raw, normalized, optional label)
    thread_titles: HashMap<String, String>,
}

impl CodexDesktopState {
    fn load(path: Option<&Path>) -> Self {
        let mut state = Self::default();
        let Some(path) = path.filter(|p| p.is_file()) else {
            return state;
        };
        let Ok(file) = File::open(path) else {
            return state;
        };
        let Ok(value) = serde_json::from_reader::<_, serde_json::Value>(file) else {
            return state;
        };

        let mut labels: HashMap<String, String> = HashMap::new();
        if let Some(label_map) = value
            .get("workspace-root-labels")
            .and_then(|v| v.as_object())
        {
            for (root_path, label_val) in label_map {
                if let Some(label) = label_val
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    labels.insert(normalize_path_key(root_path), label.to_string());
                }
            }
        }

        let mut seen_roots = HashSet::new();
        for key in ["electron-saved-workspace-roots", "active-workspace-roots"] {
            if let Some(items) = value.get(key).and_then(|v| v.as_array()) {
                for item in items {
                    let (raw_path, inline_label) = match item {
                        serde_json::Value::String(s) => (Some(s.as_str()), None),
                        serde_json::Value::Object(obj) => (
                            obj.get("path")
                                .or_else(|| obj.get("root"))
                                .and_then(|v| v.as_str()),
                            obj.get("name")
                                .or_else(|| obj.get("label"))
                                .and_then(|v| v.as_str())
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_string),
                        ),
                        _ => (None, None),
                    };
                    if let Some(raw) = raw_path.map(str::trim).filter(|s| !s.is_empty()) {
                        let norm = normalize_path_key(raw);
                        if seen_roots.insert(norm.clone()) {
                            let label = inline_label.or_else(|| labels.get(&norm).cloned());
                            state.workspace_roots.push((raw.to_string(), norm, label));
                        }
                    }
                }
            }
        }

        if let Some(titles_val) = value.get("thread-titles") {
            let titles_obj = titles_val
                .get("titles")
                .and_then(|v| v.as_object())
                .or_else(|| titles_val.as_object());
            if let Some(map) = titles_obj {
                for (thread_id, title_val) in map {
                    if let Some(title) = title_val
                        .as_str()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        state
                            .thread_titles
                            .insert(thread_id.clone(), title.to_string());
                    }
                }
            }
        }

        state
    }

    fn match_workspace_project(&self, working_dir: Option<&str>) -> Option<String> {
        let cwd = working_dir?;
        let cwd_norm = normalize_path_key(cwd);
        // Prefer the longest matching workspace root when nested roots exist.
        let mut best: Option<(usize, String)> = None;
        for (raw, root_norm, label) in &self.workspace_roots {
            let matches = cwd_norm == *root_norm
                || cwd_norm
                    .strip_prefix(root_norm.as_str())
                    .is_some_and(|rest| rest.starts_with('/'));
            if matches {
                let score = root_norm.len();
                let name = label
                    .clone()
                    .or_else(|| path_basename_string(raw))
                    .unwrap_or_else(|| raw.clone());
                if best.as_ref().is_none_or(|(best_len, _)| score > *best_len) {
                    best = Some((score, name));
                }
            }
        }
        best.map(|(_, name)| name)
    }
}

fn discover_codex_sessions(
    roots: &DiscoveryRoots,
    scan_limit: usize,
    want_codex: bool,
    want_codex_desktop: bool,
) -> Vec<ExternalSessionSummary> {
    let Some(sessions_root) = roots
        .codex_sessions_dir
        .as_deref()
        .filter(|path| path.is_dir())
    else {
        return Vec::new();
    };

    let desktop_state = CodexDesktopState::load(roots.codex_global_state_path.as_deref());
    let paths = collect_recent_files_recursive(sessions_root, "jsonl", scan_limit);

    let mut out = Vec::new();
    for path in paths {
        let Some(summary) = read_codex_session_summary(&path, &desktop_state) else {
            continue;
        };
        if (summary.source == "codex" && !want_codex)
            || (summary.source == "codex_desktop" && !want_codex_desktop)
        {
            continue;
        }
        out.push(summary);
    }
    out
}

fn read_codex_session_summary(
    path: &Path,
    desktop_state: &CodexDesktopState,
) -> Option<ExternalSessionSummary> {
    let file = File::open(path).ok()?;
    let mut lines = BufReader::new(file).lines();
    let first_line = lines.next()?.ok()?;
    let header: serde_json::Value = serde_json::from_str(first_line.trim()).ok()?;
    let meta = if header.get("type").and_then(|v| v.as_str()) == Some("session_meta") {
        header.get("payload").unwrap_or(&header)
    } else {
        &header
    };
    let session_id = meta
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    let created_at = parse_rfc3339_json(meta.get("timestamp"))
        .or_else(|| parse_rfc3339_json(header.get("timestamp")))
        .unwrap_or_else(Utc::now);
    let created_at_ms = created_at.timestamp_millis();
    let updated_at_ms = file_modified_ms(path).unwrap_or(created_at_ms);

    let mut working_dir = meta
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let originator_is_desktop = meta
        .get("originator")
        .or_else(|| meta.get("source"))
        .and_then(|v| v.as_str())
        .is_some_and(|raw| {
            let lower = raw.to_ascii_lowercase();
            lower.contains("desktop") || lower.contains("electron")
        });

    let thread_title = desktop_state.thread_titles.get(&session_id).cloned();

    // Peek the head of the transcript for a real user title (and fallback `<cwd>`)
    // without parsing multi-MB rollout files in full.
    let mut candidate_title: Option<String> = None;
    if thread_title.is_none() || working_dir.is_none() {
        for line in lines.take(TITLE_PEEK_MAX_LINES).map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                continue;
            };
            let line_type = value
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let (role, content_value) = if line_type == "message" {
                let Some(role) = value.get("role").and_then(|v| v.as_str()) else {
                    continue;
                };
                (
                    role,
                    value.get("content").unwrap_or(&serde_json::Value::Null),
                )
            } else if line_type == "response_item" {
                let Some(payload) = value.get("payload") else {
                    continue;
                };
                if payload.get("type").and_then(|v| v.as_str()) != Some("message") {
                    continue;
                }
                let Some(role) = payload.get("role").and_then(|v| v.as_str()) else {
                    continue;
                };
                (
                    role,
                    payload.get("content").unwrap_or(&serde_json::Value::Null),
                )
            } else {
                continue;
            };

            if role != "user" {
                continue;
            }
            let text = extract_text_from_json_value(content_value);
            if working_dir.is_none()
                && let Some(cwd_line) = text.lines().find(|line| line.contains("<cwd>"))
            {
                let cwd = cwd_line
                    .replace("<cwd>", "")
                    .replace("</cwd>", "")
                    .trim()
                    .to_string();
                if !cwd.is_empty() {
                    working_dir = Some(cwd);
                }
            }
            if candidate_title.is_none() {
                candidate_title = codex_title_candidate(&text);
            }
            if candidate_title.is_some() && working_dir.is_some() {
                break;
            }
        }
    }

    let matched_workspace_project = desktop_state.match_workspace_project(working_dir.as_deref());
    let is_desktop =
        thread_title.is_some() || matched_workspace_project.is_some() || originator_is_desktop;

    let (source, external_project_name) = if is_desktop {
        let project_name = matched_workspace_project
            .or_else(|| working_dir.as_deref().and_then(path_basename_string));
        ("codex_desktop", project_name)
    } else {
        ("codex", None)
    };

    let title = thread_title
        .or(candidate_title)
        .unwrap_or_else(|| format!("Codex session {}", truncate_short_id(&session_id)));

    Some(ExternalSessionSummary {
        source: source.to_string(),
        imported_session_id: imported_codex_session_id(&session_id),
        external_session_id: session_id,
        external_path: path.to_string_lossy().to_string(),
        title,
        working_dir,
        external_project_name,
        created_at_ms,
        updated_at_ms,
        transcript_bytes: file_len_opt(path),
    })
}

// ---------------------------------------------------------------------------
// Cursor discovery
// ---------------------------------------------------------------------------

fn discover_cursor_sessions(
    roots: &DiscoveryRoots,
    scan_limit: usize,
) -> Vec<ExternalSessionSummary> {
    let Some(root) = roots
        .cursor_projects_dir
        .as_deref()
        .filter(|path| path.is_dir())
    else {
        return Vec::new();
    };

    let paths = collect_recent_files_recursive(root, "jsonl", scan_limit);
    paths
        .into_iter()
        .filter_map(|path| read_cursor_session_summary(&path))
        .collect()
}

fn read_cursor_session_summary(path: &Path) -> Option<ExternalSessionSummary> {
    if is_cursor_subagent_transcript(path) {
        return None;
    }
    let session_id = cursor_session_id_from_path(path);
    if session_id.is_empty() {
        return None;
    }

    let file = File::open(path).ok()?;
    let mut first_user_text: Option<String> = None;
    let mut has_message = false;
    for line in BufReader::new(file)
        .lines()
        .take(TITLE_PEEK_MAX_LINES)
        .map_while(Result::ok)
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        let role = match value
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
        {
            "user" | "human" => "user",
            "assistant" | "model" => "assistant",
            _ => continue,
        };
        let content = value
            .get("message")
            .and_then(|message| message.get("content"))
            .or_else(|| value.get("content"))
            .unwrap_or(&serde_json::Value::Null);
        let text = extract_external_text_from_json(content, false);
        if text.trim().is_empty() {
            continue;
        }
        has_message = true;
        if first_user_text.is_none() && role == "user" {
            first_user_text = Some(text);
            break;
        }
    }
    if !has_message {
        return None;
    }

    let updated_at_ms = file_modified_ms(path).unwrap_or_else(|| Utc::now().timestamp_millis());
    let working_dir = cursor_cwd_from_transcript_path(path);
    let title = first_user_text
        .as_deref()
        .map(|text| truncate_title_text(text, 72))
        .unwrap_or_else(|| format!("Cursor session {}", truncate_short_id(&session_id)));

    Some(ExternalSessionSummary {
        source: "cursor".to_string(),
        imported_session_id: imported_cursor_session_id(&session_id),
        external_session_id: session_id,
        external_path: path.to_string_lossy().to_string(),
        title,
        working_dir,
        external_project_name: None,
        created_at_ms: updated_at_ms,
        updated_at_ms,
        transcript_bytes: file_len_opt(path),
    })
}

// ---------------------------------------------------------------------------
// OpenCode discovery
// ---------------------------------------------------------------------------

fn discover_opencode_sessions(
    roots: &DiscoveryRoots,
    scan_limit: usize,
) -> Vec<ExternalSessionSummary> {
    let Some(root) = roots
        .opencode_sessions_dir
        .as_deref()
        .filter(|path| path.is_dir())
    else {
        return Vec::new();
    };

    let paths = collect_recent_files_recursive(root, "json", scan_limit);
    paths
        .into_iter()
        .filter_map(|path| read_opencode_session_summary(&path))
        .collect()
}

fn read_opencode_session_summary(path: &Path) -> Option<ExternalSessionSummary> {
    let value: serde_json::Value = serde_json::from_reader(File::open(path).ok()?).ok()?;
    let session_id = value
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    let created_at_ms = value
        .get("time")
        .and_then(|time| time.get("created"))
        .and_then(|v| v.as_i64())
        .or_else(|| file_modified_ms(path))
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    let updated_at_ms = value
        .get("time")
        .and_then(|time| time.get("updated"))
        .and_then(|v| v.as_i64())
        .or_else(|| file_modified_ms(path))
        .unwrap_or(created_at_ms);
    let working_dir = value
        .get("directory")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| truncate_title_text(s, 72))
        .unwrap_or_else(|| format!("OpenCode session {}", truncate_short_id(&session_id)));

    Some(ExternalSessionSummary {
        source: "opencode".to_string(),
        imported_session_id: imported_opencode_session_id(&session_id),
        external_session_id: session_id,
        external_path: path.to_string_lossy().to_string(),
        title,
        working_dir,
        external_project_name: None,
        created_at_ms,
        updated_at_ms,
        transcript_bytes: file_len_opt(path),
    })
}

// ---------------------------------------------------------------------------
// Pi discovery
// ---------------------------------------------------------------------------

fn discover_pi_sessions(roots: &DiscoveryRoots, scan_limit: usize) -> Vec<ExternalSessionSummary> {
    let Some(root) = roots
        .pi_sessions_dir
        .as_deref()
        .filter(|path| path.is_dir())
    else {
        return Vec::new();
    };

    let paths = collect_recent_files_recursive(root, "jsonl", scan_limit);
    paths
        .into_iter()
        .filter_map(|path| read_pi_session_summary(&path))
        .collect()
}

fn read_pi_session_summary(path: &Path) -> Option<ExternalSessionSummary> {
    let file = File::open(path).ok()?;
    let mut lines = BufReader::new(file).lines();
    let first_line = lines.next()?.ok()?;
    let header: serde_json::Value = serde_json::from_str(first_line.trim()).ok()?;
    if header.get("type").and_then(|v| v.as_str()) != Some("session") {
        return None;
    }
    let session_id = header
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    let created_at_ms = parse_rfc3339_json(header.get("timestamp"))
        .map(|dt| dt.timestamp_millis())
        .or_else(|| file_modified_ms(path))
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    let updated_at_ms = file_modified_ms(path).unwrap_or(created_at_ms);
    let working_dir = header
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let mut title: Option<String> = None;
    for line in lines.take(TITLE_PEEK_MAX_LINES).map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        if message.get("role").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        let text =
            extract_text_from_json_value(message.get("content").unwrap_or(&serde_json::Value::Null));
        if !text.trim().is_empty() {
            title = Some(truncate_title_text(&text, 72));
            break;
        }
    }

    let path_str = path.to_string_lossy().to_string();
    Some(ExternalSessionSummary {
        source: "pi".to_string(),
        imported_session_id: imported_pi_session_id(&path_str),
        external_session_id: session_id.clone(),
        external_path: path_str,
        title: title.unwrap_or_else(|| format!("Pi session {}", truncate_short_id(&session_id))),
        working_dir,
        external_project_name: None,
        created_at_ms,
        updated_at_ms,
        transcript_bytes: file_len_opt(path),
    })
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

fn first_non_empty_str(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter().find_map(|key| {
        map.get(*key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

fn first_timestamp_ms(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<i64> {
    keys.iter().find_map(|key| {
        let value = map.get(*key)?;
        if let Some(ms) = value.as_i64() {
            // Heuristic: treat values < 10_000_000_000 as Unix seconds.
            return Some(if ms < 10_000_000_000 { ms * 1000 } else { ms });
        }
        if let Some(raw) = value.as_str() {
            return DateTime::parse_from_rfc3339(raw)
                .ok()
                .map(|dt| dt.with_timezone(&Utc).timestamp_millis());
        }
        None
    })
}

fn file_modified_ms(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let dt: DateTime<Utc> = modified.into();
    Some(dt.timestamp_millis())
}

fn file_len_opt(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|meta| meta.len())
}

fn path_basename_string(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return None;
    }
    Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn normalize_path_key(raw: &str) -> String {
    let trimmed = raw.trim().replace('\\', "/");
    let trimmed = trimmed.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

fn truncate_short_id(id: &str) -> &str {
    rayucode_core::util::truncate_str(id, 8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::{ContentBlock, Role};
    use crate::session::StoredMessage;
    use serde_json::json;

    struct EnvVarGuard {
        key: &'static str,
        prev: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set_path(key: &'static str, value: &Path) -> Self {
            let prev = std::env::var_os(key);
            crate::env::set_var(key, value);
            Self { key, prev }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(prev) = self.prev.take() {
                crate::env::set_var(self.key, prev);
            } else {
                crate::env::remove_var(self.key);
            }
        }
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn discovers_claude_cli_and_claude_desktop_with_project_metadata() {
        let temp = tempfile::TempDir::new().unwrap();
        let claude_projects = temp.path().join("claude_projects");
        let claude_desktop = temp.path().join("claude_desktop_sessions");

        let cli_transcript = claude_projects.join("-repo-cli/cli-sess-1.jsonl");
        write_file(
            &cli_transcript,
            concat!(
                "{\"type\":\"user\",\"uuid\":\"u1\",\"sessionId\":\"cli-sess-1\",\"cwd\":\"/repo/cli\",\"message\":{\"role\":\"user\",\"content\":\"Fix CLI build\"},\"timestamp\":\"2026-11-20T10:00:00Z\"}\n",
                "{\"type\":\"assistant\",\"uuid\":\"a1\",\"parentUuid\":\"u1\",\"sessionId\":\"cli-sess-1\",\"cwd\":\"/repo/cli\",\"message\":{\"role\":\"assistant\",\"content\":\"Done\"},\"timestamp\":\"2026-11-20T10:00:05Z\"}\n"
            ),
        );

        let desktop_transcript = claude_projects.join("-repo-web/desk-sess-1.jsonl");
        write_file(
            &desktop_transcript,
            concat!(
                "{\"type\":\"user\",\"uuid\":\"u2\",\"sessionId\":\"desk-sess-1\",\"cwd\":\"/repo/web-app\",\"message\":{\"role\":\"user\",\"content\":\"Design sidebar\"},\"timestamp\":\"2026-11-21T10:00:00Z\"}\n",
                "{\"type\":\"assistant\",\"uuid\":\"a2\",\"parentUuid\":\"u2\",\"sessionId\":\"desk-sess-1\",\"cwd\":\"/repo/web-app\",\"message\":{\"role\":\"assistant\",\"content\":\"Looks great\"},\"timestamp\":\"2026-11-21T10:00:05Z\"}\n"
            ),
        );

        write_file(
            &claude_projects.join("-repo-cli/sessions-index.json"),
            &json!({
                "version": 1,
                "entries": [{
                    "sessionId": "cli-sess-1",
                    "fullPath": cli_transcript.to_string_lossy(),
                    "firstPrompt": "Fix CLI build",
                    "messageCount": 2,
                    "created": "2026-11-20T10:00:00Z",
                    "modified": "2026-11-20T10:00:05Z",
                    "projectPath": "/repo/cli"
                }]
            })
            .to_string(),
        );
        write_file(
            &claude_projects.join("-repo-web/sessions-index.json"),
            &json!({
                "version": 1,
                "entries": [{
                    "sessionId": "desk-sess-1",
                    "fullPath": desktop_transcript.to_string_lossy(),
                    "firstPrompt": "Design sidebar",
                    "messageCount": 2,
                    "created": "2026-11-21T10:00:00Z",
                    "modified": "2026-11-21T10:00:05Z",
                    "projectPath": "/repo/web-app"
                }]
            })
            .to_string(),
        );

        // Claude Desktop metadata tagging `desk-sess-1`.
        write_file(
            &claude_desktop.join("org1/acct1/local_desk-sess-1.json"),
            &json!({
                "cliSessionId": "desk-sess-1",
                "cwd": "/repo/web-app",
                "projectName": "Web App",
                "title": "Sidebar Redesign"
            })
            .to_string(),
        );

        let roots = DiscoveryRoots {
            claude_projects_dir: Some(claude_projects),
            claude_desktop_sessions_dir: Some(claude_desktop),
            ..Default::default()
        };

        // Group alias "claude" returns both CLI and Desktop.
        let all_claude =
            list_external_sessions_with_roots(&roots, 50, Some(&["claude".to_string()]));
        assert_eq!(all_claude.len(), 2);

        let cli = all_claude
            .iter()
            .find(|s| s.external_session_id == "cli-sess-1")
            .expect("cli session");
        assert_eq!(cli.source, "claude_code");
        assert_eq!(cli.external_project_name, None);
        assert_eq!(cli.imported_session_id, "imported_cc_cli-sess-1");

        let desktop = all_claude
            .iter()
            .find(|s| s.external_session_id == "desk-sess-1")
            .expect("desktop session");
        assert_eq!(desktop.source, "claude_desktop");
        assert_eq!(desktop.external_project_name.as_deref(), Some("Web App"));
        assert_eq!(desktop.title, "Sidebar Redesign");

        // Filtering specifically to "claude_desktop" excludes CLI sessions.
        let desktop_only =
            list_external_sessions_with_roots(&roots, 50, Some(&["claude_desktop".to_string()]));
        assert_eq!(desktop_only.len(), 1);
        assert_eq!(desktop_only[0].external_session_id, "desk-sess-1");
    }

    #[test]
    fn discovers_codex_cli_and_codex_desktop_workspace_and_titles() {
        let temp = tempfile::TempDir::new().unwrap();
        let codex_sessions = temp.path().join("codex/sessions");
        let codex_state = temp.path().join("codex/.codex-global-state.json");

        write_file(
            &codex_sessions.join("2026/11/25/rollout-cli.jsonl"),
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-cli-1\",\"timestamp\":\"2026-11-24T09:00:00Z\",\"cwd\":\"/tmp/scratch\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Refactor parser\"}]}}\n",
                "not valid json line\n"
            ),
        );

        write_file(
            &codex_sessions.join("2026/11/25/rollout-desk.jsonl"),
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-desk-1\",\"timestamp\":\"2026-11-25T09:00:00Z\",\"cwd\":\"/workspaces/rayucode/desktop\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Ignored fallback prompt\"}]}}\n"
            ),
        );

        write_file(
            &codex_state,
            &json!({
                "electron-saved-workspace-roots": ["/workspaces/rayucode"],
                "active-workspace-roots": ["/workspaces/rayucode"],
                "thread-titles": {
                    "titles": {
                        "codex-desk-1": "Cross-Agent Session Sync"
                    }
                }
            })
            .to_string(),
        );

        let roots = DiscoveryRoots {
            codex_sessions_dir: Some(codex_sessions),
            codex_global_state_path: Some(codex_state),
            ..Default::default()
        };

        let all_codex = list_external_sessions_with_roots(&roots, 50, Some(&["codex".to_string()]));
        assert_eq!(all_codex.len(), 2);

        let cli = all_codex
            .iter()
            .find(|s| s.external_session_id == "codex-cli-1")
            .expect("codex cli");
        assert_eq!(cli.source, "codex");
        assert_eq!(cli.title, "Refactor parser");
        assert_eq!(cli.external_project_name, None);

        let desk = all_codex
            .iter()
            .find(|s| s.external_session_id == "codex-desk-1")
            .expect("codex desktop");
        assert_eq!(desk.source, "codex_desktop");
        assert_eq!(desk.title, "Cross-Agent Session Sync");
        assert_eq!(desk.external_project_name.as_deref(), Some("rayucode"));

        let projects = list_external_projects_with_roots(&roots, 50, Some("codex_desktop"));
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project_name, "rayucode");
        assert_eq!(projects[0].session_count, 1);
        assert_eq!(projects[0].source, "codex_desktop");
    }

    #[test]
    fn discovers_cursor_opencode_and_pi_and_ignores_missing_dirs() {
        let temp = tempfile::TempDir::new().unwrap();
        let cursor_root = temp.path().join("cursor/projects");
        let opencode_root = temp.path().join("opencode/session");
        let pi_root = temp.path().join("pi/sessions");

        let cursor_id = "11111111-2222-3333-4444-555555555555";
        write_file(
            &cursor_root.join(format!(
                "tmp-demo/agent-transcripts/{cursor_id}/{cursor_id}.jsonl"
            )),
            "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Hello Cursor\"}]}}\n",
        );
        // Subagent transcript must be ignored.
        write_file(
            &cursor_root.join(format!(
                "tmp-demo/agent-transcripts/{cursor_id}/subagents/child.jsonl"
            )),
            "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Subagent\"}]}}\n",
        );

        write_file(
            &opencode_root.join("proj/ses_oc_1.json"),
            &json!({
                "id": "ses_oc_1",
                "title": "OpenCode refactor",
                "directory": "/repo/oc",
                "time": { "created": 1_700_000_000_000i64, "updated": 1_700_000_100_000i64 }
            })
            .to_string(),
        );

        write_file(
            &pi_root.join("session-pi-1.jsonl"),
            concat!(
                "{\"type\":\"session\",\"id\":\"pi-sess-1\",\"timestamp\":\"2026-11-20T12:00:00Z\",\"cwd\":\"/repo/pi\"}\n",
                "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"Check pi logs\"}}\n"
            ),
        );

        let roots = DiscoveryRoots {
            claude_projects_dir: Some(temp.path().join("missing-claude")),
            codex_sessions_dir: Some(temp.path().join("missing-codex")),
            cursor_projects_dir: Some(cursor_root),
            opencode_sessions_dir: Some(opencode_root),
            pi_sessions_dir: Some(pi_root),
            ..Default::default()
        };

        let discovered = list_external_sessions_with_roots(&roots, 50, None);
        assert_eq!(discovered.len(), 3);
        assert!(discovered
            .iter()
            .any(|s| s.source == "cursor" && s.title == "Hello Cursor"));
        assert!(discovered
            .iter()
            .any(|s| s.source == "opencode" && s.title == "OpenCode refactor"));
        assert!(discovered
            .iter()
            .any(|s| s.source == "pi" && s.title == "Check pi logs"));
    }

    #[test]
    fn merge_deduplicates_imported_sessions_and_computes_sync_stale() {
        let native = vec![
            NativeSessionRecord {
                session_id: "imported_codex_abc".to_string(),
                working_dir: Some("/repo/app".to_string()),
                title: Some("Local title".to_string()),
                saved: false,
                updated_at_ms: Some(1_000),
                transcript_bytes: Some(500),
            },
            NativeSessionRecord {
                session_id: "session_native_1".to_string(),
                working_dir: Some("/repo/app".to_string()),
                title: Some("Rayu native".to_string()),
                saved: true,
                updated_at_ms: Some(500),
                transcript_bytes: Some(300),
            },
        ];

        let external = vec![
            ExternalSessionSummary {
                source: "codex_desktop".to_string(),
                external_session_id: "abc".to_string(),
                external_path: "/tmp/codex/abc.jsonl".to_string(),
                imported_session_id: "imported_codex_abc".to_string(),
                title: "External title".to_string(),
                working_dir: Some("/repo/app".to_string()),
                external_project_name: Some("app".to_string()),
                created_at_ms: 900,
                updated_at_ms: 2_000, // Newer than local 1_000 -> sync_stale = true
                transcript_bytes: Some(900),
            },
            ExternalSessionSummary {
                source: "claude_code".to_string(),
                external_session_id: "xyz".to_string(),
                external_path: "/tmp/claude/xyz.jsonl".to_string(),
                imported_session_id: "imported_cc_xyz".to_string(),
                title: "Unimported Claude".to_string(),
                working_dir: Some("/repo/other".to_string()),
                external_project_name: None,
                created_at_ms: 1_500,
                updated_at_ms: 1_500,
                transcript_bytes: Some(400),
            },
        ];

        let merged = merge_with_native_sessions(&native, &external);
        assert_eq!(merged.len(), 3, "imported session must not be duplicated");

        // Saved native session sorts first.
        assert_eq!(merged[0].session_id, "session_native_1");
        assert_eq!(merged[0].source, "rayu");
        assert!(!merged[0].imported);
        assert!(!merged[0].sync_stale);

        let deduped = merged
            .iter()
            .find(|s| s.session_id == "imported_codex_abc")
            .expect("merged imported codex session");
        assert_eq!(deduped.source, "codex_desktop");
        assert_eq!(deduped.external_session_id.as_deref(), Some("abc"));
        assert_eq!(
            deduped.external_path.as_deref(),
            Some("/tmp/codex/abc.jsonl")
        );
        assert_eq!(deduped.external_project_name.as_deref(), Some("app"));
        assert!(deduped.imported);
        assert!(deduped.sync_stale);

        let unimported = merged
            .iter()
            .find(|s| s.session_id == "claude_code:xyz")
            .expect("unimported claude session");
        assert!(!unimported.imported);
        assert!(!unimported.sync_stale);
    }

    #[test]
    fn import_external_sessions_handles_conflict_skip_fork_and_force_resync() {
        let _env_lock = crate::storage::lock_test_env();
        let temp = tempfile::TempDir::new().unwrap();
        let _home = EnvVarGuard::set_path("RAYU_HOME", temp.path());

        let transcript = temp.path().join("external/codex/sess-conflict.jsonl");
        write_file(
            &transcript,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sess-conflict\",\"timestamp\":\"2026-11-25T10:00:00Z\",\"cwd\":\"/repo/demo\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Initial codex prompt\"}]}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Initial codex reply\"}]}}\n"
            ),
        );

        let item = ImportExternalItem {
            source: "codex".to_string(),
            external_session_id: "sess-conflict".to_string(),
            external_path: Some(transcript.to_string_lossy().to_string()),
        };
        let roots = DiscoveryRoots::default();

        // 1. First import succeeds and stamps imported_turn_count = Some(1).
        let first = import_external_sessions_with_roots(&roots, &[item.clone()], false, false);
        assert_eq!(first.sessions.len(), 1);
        assert!(first.skipped.is_empty());
        let imported_id = first.sessions[0].session.id.clone();
        assert_eq!(imported_id, "imported_codex_sess-conflict");
        assert_eq!(first.sessions[0].session.imported_turn_count, Some(1));

        // 2. Append a local Rayu user turn to the imported session.
        let mut local = Session::load(&imported_id).unwrap();
        local.append_stored_message(StoredMessage {
            id: "local-user-turn".to_string(),
            role: Role::User,
            content: vec![ContentBlock::Text {
                text: "Local Rayu follow-up".to_string(),
                cache_control: None,
            }],
            display_role: None,
            timestamp: Some(Utc::now()),
            tool_duration_ms: None,
            token_usage: None,
        });
        local.save().unwrap();

        // External transcript also advances with a new message.
        write_file(
            &transcript,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sess-conflict\",\"timestamp\":\"2026-11-25T10:00:00Z\",\"cwd\":\"/repo/demo\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Initial codex prompt\"}]}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Initial codex reply\"}]}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Newer codex turn\"}]}}\n"
            ),
        );

        // 3. Re-import with force_resync=false, fork_on_conflict=false -> skipped with conflict.
        let conflict = import_external_sessions_with_roots(&roots, &[item.clone()], false, false);
        assert!(conflict.sessions.is_empty());
        assert_eq!(conflict.skipped.len(), 1);
        assert_eq!(conflict.skipped[0].reason, ImportSkipReason::Conflict);
        assert_eq!(
            conflict.skipped[0].existing_session_id.as_deref(),
            Some("imported_codex_sess-conflict")
        );
        // Local turn must remain intact.
        let preserved = Session::load(&imported_id).unwrap();
        assert_eq!(count_visible_user_turns(&preserved), 2);

        // 4. Re-import with fork_on_conflict=true -> saves fresh forked session & preserves original.
        let forked = import_external_sessions_with_roots(&roots, &[item.clone()], false, true);
        assert_eq!(forked.sessions.len(), 1);
        assert!(forked.skipped.is_empty());
        assert_ne!(forked.sessions[0].session.id, imported_id);
        assert_eq!(
            forked.sessions[0].forked_from_session_id.as_deref(),
            Some(imported_id.as_str())
        );
        let still_preserved = Session::load(&imported_id).unwrap();
        assert_eq!(count_visible_user_turns(&still_preserved), 2);

        // 5. Re-import with force_resync=true -> overwrites canonical session with external transcript.
        let forced = import_external_sessions_with_roots(&roots, &[item], true, false);
        assert_eq!(forced.sessions.len(), 1);
        assert_eq!(forced.sessions[0].session.id, imported_id);
        let overwritten = Session::load(&imported_id).unwrap();
        let all_text = overwritten
            .messages
            .iter()
            .flat_map(|m| m.content.iter())
            .filter_map(|b| match b {
                ContentBlock::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(all_text.contains("Newer codex turn"));
        assert!(!all_text.contains("Local Rayu follow-up"));
    }
}
