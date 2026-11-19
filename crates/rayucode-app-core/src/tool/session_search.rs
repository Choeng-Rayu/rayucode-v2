//! Cross-session search tool - RAG across all past sessions
//!
//! The tool is optimized for agent recall rather than raw grep output:
//! - current session, system reminders, and tool-only messages are hidden by default
//! - session metadata is searchable and returned as first-class results
//! - snapshot + journal persistence is searched so recent messages are visible
//! - results are grouped by session by default to avoid duplicate floods

use super::session_search_index::{self, IndexFileSpec};
use super::{Tool, ToolContext, ToolOutput};
use crate::message::ContentBlock;
use crate::session::{Session, StoredMessage, session_journal_path_from_snapshot};
use crate::storage;
use anyhow::Result;
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use rayucode_import_core::{
    ExternalMessageRecord, ExternalSessionRecord, ImportCoreResult, collect_recent_files_recursive,
    load_claude_external_messages, load_codex_external_session, load_cursor_external_session,
    load_opencode_external_session, load_pi_external_session,
};
use rayucode_session_types::{
    SessionSearchContextLine as ResultContextLine, SessionSearchQueryProfile as QueryProfile,
    SessionSearchRenderOptions, SessionSearchReport as SearchReport,
    SessionSearchResult as SearchResult, SessionSearchResultKind as SearchResultKind,
    format_session_search_no_results, format_session_search_results,
    score_session_search_text_match as score_message_match,
    session_search_datetime_matches as session_datetime_matches,
    session_search_field_filter_matches as field_filter_matches,
    session_search_format_datetime as format_datetime,
    session_search_path_matches_query as path_matches_query,
    session_search_raw_matches_query as raw_matches_query,
    session_search_truncate_title_text as truncate_title_text,
    session_search_working_dir_matches as working_dir_matches,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Max session snapshots/journals to deserialize after raw pre-filtering.
const MAX_DESERIALIZE: usize = 500;

/// Number of parallel threads for file scanning/loading.
const SCAN_THREADS: usize = 8;

const DEFAULT_LIMIT: usize = 10;
const MAX_LIMIT: usize = 50;
const DEFAULT_MAX_PER_SESSION: usize = 1;
const MAX_MAX_PER_SESSION: usize = 20;
const DEFAULT_MAX_SCAN_SESSIONS: usize = 1000;
const MAX_MAX_SCAN_SESSIONS: usize = 10_000;
const MAX_CONTEXT_MESSAGES: usize = 5;
const INDEX_SCORE_CANDIDATE_MULTIPLIER: usize = 2;
/// Legacy JSON index file superseded by the binary token-hash indexes.
const LEGACY_INDEX_FILE_NAME: &str = "session_search_recent_index_v1.json";

#[derive(Debug, Deserialize)]
struct SearchInput {
    query: String,
    working_dir: Option<String>,
    limit: Option<i64>,
    include_current: Option<bool>,
    include_tools: Option<bool>,
    include_system: Option<bool>,
    max_per_session: Option<i64>,
    role: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    after: Option<String>,
    before: Option<String>,
    saved: Option<bool>,
    debug: Option<bool>,
    canary: Option<bool>,
    source: Option<String>,
    include_external: Option<bool>,
    context_before: Option<i64>,
    context_after: Option<i64>,
    max_scan_sessions: Option<i64>,
    exhaustive: Option<bool>,
}

pub struct SessionSearchTool;

impl SessionSearchTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SessionSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

/// Warm the recent-session search indexes in the background so the first
/// interactive `session_search` call does not pay the cold indexing cost.
/// Covers the rayu store plus the external stores (claude/codex/pi/cursor).
pub fn spawn_recent_index_warmup() {
    tokio::task::spawn_blocking(|| {
        let start = std::time::Instant::now();
        remove_legacy_index();
        let empty_query = QueryProfile::new("__rayu_index_warmup__");

        let rayu_count = (|| -> Result<usize> {
            let sessions_dir = storage::rayu_dir()?.join("sessions");
            let collection = collect_session_files(&sessions_dir, DEFAULT_MAX_SCAN_SESSIONS)?;
            if collection.files.is_empty() {
                return Ok(0);
            }
            let _ = rayu_index_candidates(&collection.files, &empty_query)?;
            Ok(collection.files.len())
        })()
        .unwrap_or_else(|err| {
            crate::logging::info(&format!("rayu session index warmup skipped: {err}"));
            0
        });

        let mut external_count = 0usize;
        for (source, root_relative) in [
            ("codex", ".codex/sessions"),
            ("pi", ".pi/agent/sessions"),
            ("cursor", ".cursor/projects"),
        ] {
            let Ok(root) = crate::storage::user_home_path(root_relative) else {
                continue;
            };
            if !root.exists() {
                continue;
            }
            let paths = collect_recent_files_recursive(&root, "jsonl", DEFAULT_MAX_SCAN_SESSIONS);
            external_count += paths.len();
            let _ = external_index_candidate_paths(source, &paths, &empty_query);
        }
        if let Ok(sessions) =
            crate::import::list_claude_code_sessions_lazy(DEFAULT_MAX_SCAN_SESSIONS)
        {
            let claude: Vec<_> = sessions
                .into_iter()
                .filter(|s| {
                    !crate::legacy_compat::is_rayu_cli_project_transcript_path(Path::new(
                        &s.full_path,
                    ))
                })
                .collect();
            external_count += claude.len();
            if !claude.is_empty() {
                drop(claude_index_candidates("claude", &claude, &empty_query));
            }
        }
        let rayu_cli = discover_rayu_cli_sessions(DEFAULT_MAX_SCAN_SESSIONS);
        external_count += rayu_cli.len();
        if !rayu_cli.is_empty() {
            drop(claude_index_candidates("rayu-cli", &rayu_cli, &empty_query));
        }

        crate::logging::info(&format!(
            "Session search index warmup completed for {rayu_count} rayu + {external_count} external session(s) in {}ms",
            start.elapsed().as_millis()
        ));
    });
}

#[derive(Debug, Clone)]
struct SearchOptions {
    current_session_id: String,
    working_dir_filter: Option<String>,
    limit: usize,
    max_per_session: usize,
    include_current: bool,
    include_tools: bool,
    include_system: bool,
    include_external: bool,
    role_filter: Option<RoleFilter>,
    provider_filter: Option<String>,
    model_filter: Option<String>,
    source_filter: Option<String>,
    saved_filter: Option<bool>,
    debug_filter: Option<bool>,
    canary_filter: Option<bool>,
    after: Option<DateTime<Utc>>,
    before: Option<DateTime<Utc>>,
    context_before: usize,
    context_after: usize,
    max_scan_sessions: usize,
    exhaustive: bool,
}

impl SearchOptions {
    #[cfg(test)]
    fn for_test(current_session_id: impl Into<String>) -> Self {
        Self {
            current_session_id: current_session_id.into(),
            working_dir_filter: None,
            limit: DEFAULT_LIMIT,
            max_per_session: DEFAULT_MAX_PER_SESSION,
            include_current: false,
            include_tools: false,
            include_system: false,
            include_external: true,
            role_filter: None,
            provider_filter: None,
            model_filter: None,
            source_filter: None,
            saved_filter: None,
            debug_filter: None,
            canary_filter: None,
            after: None,
            before: None,
            context_before: 0,
            context_after: 0,
            max_scan_sessions: DEFAULT_MAX_SCAN_SESSIONS,
            exhaustive: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RoleFilter {
    User,
    Assistant,
    Metadata,
}

impl RoleFilter {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            "metadata" | "session" => Some(Self::Metadata),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
struct SessionFileCandidate {
    snapshot_path: PathBuf,
    journal_path: PathBuf,
    session_id_hint: String,
    mtime: SystemTime,
}

#[derive(Default)]
struct RawFilterOutcome {
    candidates: Vec<SessionFileCandidate>,
    read_errors: usize,
}

#[derive(Default)]
struct SearchWorkerOutcome {
    results: Vec<SearchResult>,
    parse_errors: usize,
}

#[derive(Default)]
struct SessionFileCollection {
    files: Vec<SessionFileCandidate>,
    truncated: bool,
}

#[async_trait]
impl Tool for SessionSearchTool {
    fn name(&self) -> &str {
        "session_search"
    }

    fn description(&self) -> &str {
        "Search past chat sessions. Current session and tool noise hidden by default."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "intent": super::intent_schema_property(),
                "query": {
                    "type": "string",
                    "description": "Search query. Use distinctive keywords; stop-word-only queries are rejected."
                },
                "working_dir": {
                    "type": "string",
                    "description": "Only sessions whose working directory matches this path prefix (case-insensitive)."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_LIMIT,
                    "description": "Max results."
                },
                "include_current": {
                    "type": "boolean",
                    "description": "Include the current active session. Defaults to false."
                },
                "include_tools": {
                    "type": "boolean",
                    "description": "Include raw tool calls and results (default false). Tool intents and todo names stay searchable."
                },
                "include_system": {
                    "type": "boolean",
                    "description": "Include system reminders and display/system messages. Defaults to false."
                },
                "max_per_session": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_MAX_PER_SESSION,
                    "description": "Maximum hits to return from one session. Defaults to 1 for result diversity."
                },
                "role": {
                    "type": "string",
                    "enum": ["all", "user", "assistant", "metadata"],
                    "description": "Restrict results to a role or to metadata-only hits. Defaults to all transcript roles plus metadata."
                },
                "provider": {
                    "type": "string",
                    "description": "Restrict by provider/source substring, e.g. openai, claude, codex, pi, opencode, cursor."
                },
                "model": {
                    "type": "string",
                    "description": "Restrict by model substring."
                },
                "after": {
                    "type": "string",
                    "description": "Only include sessions/messages at or after this RFC3339 timestamp or YYYY-MM-DD date."
                },
                "before": {
                    "type": "string",
                    "description": "Only include sessions/messages at or before this RFC3339 timestamp or YYYY-MM-DD date."
                },
                "saved": {
                    "type": "boolean",
                    "description": "Restrict RayuCode sessions by saved/bookmarked flag."
                },
                "debug": {
                    "type": "boolean",
                    "description": "Restrict RayuCode sessions by debug/test flag."
                },
                "canary": {
                    "type": "boolean",
                    "description": "Restrict RayuCode sessions by canary flag."
                },
                "source": {
                    "type": "string",
                    "enum": ["all", "rayu", "rayu-cli", "claude", "codex", "pi", "opencode", "cursor"],
                    "description": "Restrict session source. Defaults to all available sources."
                },
                "include_external": {
                    "type": "boolean",
                    "description": "Include external session sources discovered by the session picker. Defaults to true."
                },
                "context_before": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": MAX_CONTEXT_MESSAGES,
                    "description": "Number of preceding messages to include around each hit."
                },
                "context_after": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": MAX_CONTEXT_MESSAGES,
                    "description": "Number of following messages to include around each hit."
                },
                "max_scan_sessions": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_MAX_SCAN_SESSIONS,
                    "description": "Bound the number of recent sessions scanned per source."
                },
                "exhaustive": {
                    "type": "boolean",
                    "description": "Search every session instead of the recent indexed subset. Slower; for deep recall."
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let params: SearchInput = serde_json::from_value(input)?;
        let exhaustive = params.exhaustive.unwrap_or(false);
        let parsed = (|| -> std::result::Result<SearchOptions, String> {
            let limit = validate_bounded_usize(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, "limit")?;
            let max_per_session = validate_bounded_usize(
                params.max_per_session,
                DEFAULT_MAX_PER_SESSION,
                1,
                MAX_MAX_PER_SESSION,
                "max_per_session",
            )?
            .min(limit);
            let max_scan_sessions = if exhaustive {
                usize::MAX
            } else {
                validate_bounded_usize(
                    params.max_scan_sessions,
                    DEFAULT_MAX_SCAN_SESSIONS,
                    1,
                    MAX_MAX_SCAN_SESSIONS,
                    "max_scan_sessions",
                )?
            };
            Ok(SearchOptions {
                current_session_id: ctx.session_id.clone(),
                working_dir_filter: params.working_dir.clone(),
                limit,
                max_per_session,
                include_current: params.include_current.unwrap_or(false),
                include_tools: params.include_tools.unwrap_or(false),
                include_system: params.include_system.unwrap_or(false),
                include_external: params.include_external.unwrap_or(true),
                role_filter: parse_role_filter(params.role.as_deref())?,
                provider_filter: normalize_optional_filter(params.provider),
                model_filter: normalize_optional_filter(params.model),
                source_filter: normalize_source_filter(params.source.as_deref())?,
                saved_filter: params.saved,
                debug_filter: params.debug,
                canary_filter: params.canary,
                after: parse_datetime_filter(params.after.as_deref(), "after")?,
                before: parse_datetime_filter(params.before.as_deref(), "before")?,
                context_before: validate_bounded_usize(
                    params.context_before,
                    0,
                    0,
                    MAX_CONTEXT_MESSAGES,
                    "context_before",
                )?,
                context_after: validate_bounded_usize(
                    params.context_after,
                    0,
                    0,
                    MAX_CONTEXT_MESSAGES,
                    "context_after",
                )?,
                max_scan_sessions,
                exhaustive,
            })
        })();
        let options = match parsed {
            Ok(options) => options,
            Err(message) => return Ok(ToolOutput::new(message).with_title("session_search")),
        };

        let query = QueryProfile::new(&params.query);
        if query.is_empty() {
            return Ok(ToolOutput::new("Query cannot be empty.").with_title("session_search"));
        }
        if !query.is_actionable() {
            return Ok(ToolOutput::new(format!(
                "Query '{}' is too generic after removing common stop words. Add at least one distinctive keyword.",
                params.query.trim()
            ))
            .with_title("session_search"));
        }

        let sessions_dir = storage::rayu_dir()?.join("sessions");

        let report = tokio::task::spawn_blocking({
            let session_id = ctx.session_id.clone();
            let query = query.clone();
            let options = options.clone();
            move || search_sessions_blocking(&sessions_dir, &query, &options, &session_id)
        })
        .await??;

        if report.results.is_empty() {
            return Ok(ToolOutput::new(no_results_message(&params.query, &options))
                .with_title("session_search"));
        }

        Ok(
            ToolOutput::new(format_results(&params.query, &report, &options))
                .with_title("session_search"),
        )
    }
}

fn validate_bounded_usize(
    value: Option<i64>,
    default: usize,
    min: usize,
    max: usize,
    name: &str,
) -> std::result::Result<usize, String> {
    let Some(value) = value else {
        return Ok(default);
    };
    if value < min as i64 || value > max as i64 {
        return Err(format!(
            "{name} must be between {min} and {max}; received {value}."
        ));
    }
    Ok(value as usize)
}

fn parse_role_filter(raw: Option<&str>) -> std::result::Result<Option<RoleFilter>, String> {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };
    if raw.eq_ignore_ascii_case("all") {
        return Ok(None);
    }
    RoleFilter::parse(raw).map(Some).ok_or_else(|| {
        format!("role must be one of all, user, assistant, or metadata; received {raw}.")
    })
}

fn normalize_optional_filter(raw: Option<String>) -> Option<String> {
    raw.map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn normalize_source_filter(raw: Option<&str>) -> std::result::Result<Option<String>, String> {
    let Some(source) = raw.map(str::trim).filter(|source| !source.is_empty()) else {
        return Ok(None);
    };
    let normalized = source.to_ascii_lowercase();
    match normalized.as_str() {
        "all" => Ok(None),
        "rayu" => Ok(Some("rayu".to_string())),
        "rayu-cli" | "rayu_cli" => Ok(Some("rayu-cli".to_string())),
        "claude" | "claude-code" => Ok(Some("claude".to_string())),
        "codex" | "pi" | "opencode" | "cursor" => Ok(Some(normalized)),
        _ => Err(format!(
            "source must be one of all, rayu, rayu-cli, claude, codex, pi, opencode, or cursor; received {source}."
        )),
    }
}

fn parse_datetime_filter(
    raw: Option<&str>,
    name: &str,
) -> std::result::Result<Option<DateTime<Utc>>, String> {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Ok(Some(dt.with_timezone(&Utc)));
    }
    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        let Some(naive) = date.and_hms_opt(0, 0, 0) else {
            return Err(format!("{name} has an invalid date: {raw}."));
        };
        return Ok(Some(DateTime::from_naive_utc_and_offset(naive, Utc)));
    }
    Err(format!(
        "{name} must be an RFC3339 timestamp or YYYY-MM-DD date; received {raw}."
    ))
}

/// Synchronous search across session files with parallel raw pre-filtering and
/// journal-aware session loading.
fn search_sessions_blocking(
    sessions_dir: &Path,
    query: &QueryProfile,
    options: &SearchOptions,
    log_session_id: &str,
) -> Result<SearchReport> {
    let mut report = SearchReport::default();
    if !query.is_actionable() {
        return Ok(report);
    }

    if source_matches_filter("rayu", options) {
        let collection = collect_session_files(sessions_dir, options.max_scan_sessions)?;
        report.truncated |= collection.truncated;
        let mut files = collection.files;
        if !files.is_empty() {
            files.sort_unstable_by(|a, b| b.mtime.cmp(&a.mtime));
            report.scanned_rayu_sessions = files.len();

            if !options.include_current {
                files.retain(|candidate| candidate.session_id_hint != options.current_session_id);
            }

            if !files.is_empty() {
                let using_index = !options.exhaustive;
                let indexed_candidates = if options.exhaustive {
                    None
                } else {
                    match rayu_index_candidates(&files, query) {
                        Ok(candidates) => Some(candidates),
                        Err(err) => {
                            crate::logging::warn(&format!(
                                "session_search index unavailable; falling back to raw scan: {err}"
                            ));
                            None
                        }
                    }
                };
                let mut candidates = indexed_candidates.unwrap_or_else(|| {
                    let raw_filter_outcomes = filter_candidates_parallel(&files, query);
                    report.read_errors += raw_filter_outcomes
                        .iter()
                        .map(|outcome| outcome.read_errors)
                        .sum::<usize>();
                    raw_filter_outcomes
                        .into_iter()
                        .flat_map(|outcome| outcome.candidates)
                        .collect()
                });
                candidates.sort_unstable_by(|a, b| b.mtime.cmp(&a.mtime));
                report.candidate_rayu_sessions = candidates.len();
                if using_index {
                    let indexed_budget = indexed_candidate_budget(options);
                    if candidates.len() > indexed_budget {
                        candidates.truncate(indexed_budget);
                        report.truncated = true;
                    }
                }
                if candidates.len() > MAX_DESERIALIZE {
                    candidates.truncate(MAX_DESERIALIZE);
                    report.truncated = true;
                }

                let search_outcomes = score_candidates_parallel(&candidates, query, options);
                report.parse_errors += search_outcomes
                    .iter()
                    .map(|outcome| outcome.parse_errors)
                    .sum::<usize>();
                report.results.extend(
                    search_outcomes
                        .into_iter()
                        .flat_map(|outcome| outcome.results),
                );
            }
        }
    }

    if options.include_external {
        let external_report = search_external_sessions(query, options);
        report.scanned_external_sessions += external_report.scanned_external_sessions;
        report
            .external_sources
            .extend(external_report.external_sources);
        report.read_errors += external_report.read_errors;
        report.parse_errors += external_report.parse_errors;
        report.truncated |= external_report.truncated;
        report.results.extend(external_report.results);
    }

    if report.read_errors > 0 || report.parse_errors > 0 {
        crate::logging::warn(&format!(
            "[tool:session_search] skipped unreadable or invalid session files in session {} (read_errors={} parse_errors={})",
            log_session_id, report.read_errors, report.parse_errors
        ));
    }

    report.results.sort_unstable_by(compare_results);
    report.results = group_and_limit_results(report.results, options);
    Ok(report)
}

fn collect_session_files(
    sessions_dir: &Path,
    max_scan_sessions: usize,
) -> Result<SessionFileCollection> {
    let mut timestamped: BinaryHeap<Reverse<(u64, PathBuf, String)>> = BinaryHeap::new();
    let mut untimestamped = Vec::new();
    let mut truncated = false;
    if !sessions_dir.exists() {
        return Ok(SessionFileCollection::default());
    }
    for entry in std::fs::read_dir(sessions_dir)?.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let Some(stem) = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
        else {
            continue;
        };
        if let Some(timestamp_ms) = session_id_timestamp_ms(&stem) {
            timestamped.push(Reverse((timestamp_ms, path, stem)));
            if timestamped.len() > max_scan_sessions {
                timestamped.pop();
                truncated = true;
            }
        } else {
            untimestamped.push((path, stem));
        }
    }

    let mut files =
        Vec::with_capacity(timestamped.len() + untimestamped.len().min(max_scan_sessions));
    for Reverse((timestamp_ms, path, stem)) in timestamped.into_sorted_vec() {
        let journal_path = session_journal_path_from_snapshot(&path);
        files.push(SessionFileCandidate {
            snapshot_path: path,
            journal_path,
            session_id_hint: stem,
            mtime: system_time_from_unix_millis(timestamp_ms),
        });
    }

    // Legacy or imported snapshot names may not contain a timestamp. They are
    // uncommon, so only stat these fallback paths instead of every session file.
    for (path, stem) in untimestamped {
        let journal_path = session_journal_path_from_snapshot(&path);
        let snapshot_mtime = modified_time_or_epoch(&path);
        let journal_mtime = modified_time_or_epoch(&journal_path);
        files.push(SessionFileCandidate {
            snapshot_path: path,
            journal_path,
            session_id_hint: stem,
            mtime: snapshot_mtime.max(journal_mtime),
        });
    }

    if files.len() > max_scan_sessions {
        files.sort_unstable_by(|a, b| b.mtime.cmp(&a.mtime));
        files.truncate(max_scan_sessions);
        truncated = true;
    }

    Ok(SessionFileCollection { files, truncated })
}

fn session_id_timestamp_ms(session_id: &str) -> Option<u64> {
    session_id.split('_').find_map(|part| {
        (part.len() == 13)
            .then(|| part.parse::<u64>().ok())
            .flatten()
    })
}

fn system_time_from_unix_millis(timestamp_ms: u64) -> SystemTime {
    SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(timestamp_ms)
}

fn index_dir() -> Result<PathBuf> {
    Ok(storage::rayu_dir()?.join("cache"))
}

/// How many index candidates are worth fully parsing/scoring for one search.
fn indexed_candidate_budget(options: &SearchOptions) -> usize {
    options
        .limit
        .saturating_mul(options.max_per_session)
        .saturating_mul(INDEX_SCORE_CANDIDATE_MULTIPLIER)
        .max(options.limit)
        .max(1)
}

/// Remove the superseded JSON index once so it stops taking up space.
fn remove_legacy_index() {
    if let Ok(dir) = index_dir() {
        let _ = std::fs::remove_file(dir.join(LEGACY_INDEX_FILE_NAME));
    }
}

/// Build/update the incremental rayu session index and return the candidate
/// subset of `files` that plausibly match `query`.
fn rayu_index_candidates(
    files: &[SessionFileCandidate],
    query: &QueryProfile,
) -> Result<Vec<SessionFileCandidate>> {
    let index_path = index_dir()?.join("session_search_rayu_index_v2.bin");
    let specs: Vec<IndexFileSpec> = files
        .iter()
        .map(|file| {
            // Journals grow after the snapshot is written, so identity covers
            // both files.
            let (snap_mtime, snap_size) = session_search_index::stat_ms_size(&file.snapshot_path);
            let (journal_mtime, journal_size) =
                session_search_index::stat_ms_size(&file.journal_path);
            IndexFileSpec {
                key: file.session_id_hint.clone(),
                mtime_ms: snap_mtime.max(journal_mtime),
                size: snap_size.wrapping_add(journal_size),
            }
        })
        .collect();

    let index = session_search_index::build_or_update(&index_path, &specs, &|slot| {
        let file = &files[slot];
        let mut read_errors = 0;
        read_candidate_raw(file, &mut read_errors).map(|raw| {
            let mut text = String::with_capacity(file.session_id_hint.len() + 1 + raw.len());
            text.push_str(&file.session_id_hint);
            text.push(' ');
            text.push_str(&String::from_utf8_lossy(&raw));
            text
        })
    })?;

    Ok(index
        .candidate_slots(&query.terms, query.min_term_matches)
        .into_iter()
        .filter_map(|slot| files.get(slot).cloned())
        .collect())
}

fn modified_time_or_epoch(path: &Path) -> SystemTime {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn run_parallel_chunks<T: Sync, R: Send + Default>(
    items: &[T],
    label: &str,
    worker: impl Fn(&[T]) -> R + Sync,
) -> Vec<R> {
    if items.is_empty() {
        return Vec::new();
    }
    let chunk_size = items.len().div_ceil(SCAN_THREADS.min(items.len()));
    std::thread::scope(|scope| {
        let handles: Vec<_> = items
            .chunks(chunk_size)
            .map(|chunk| scope.spawn(|| worker(chunk)))
            .collect();
        handles
            .into_iter()
            .map(|handle| {
                handle.join().unwrap_or_else(|_| {
                    crate::logging::warn(&format!(
                        "session_search {label} worker panicked; skipping that worker's batch"
                    ));
                    R::default()
                })
            })
            .collect()
    })
}

fn filter_candidates_parallel(
    files: &[SessionFileCandidate],
    query: &QueryProfile,
) -> Vec<RawFilterOutcome> {
    run_parallel_chunks(files, "raw pre-filter", |chunk| {
        let mut outcome = RawFilterOutcome::default();
        for candidate in chunk {
            if path_matches_query(&candidate.session_id_hint, query) {
                outcome.candidates.push(candidate.clone());
                continue;
            }
            let Some(raw) = read_candidate_raw(candidate, &mut outcome.read_errors) else {
                continue;
            };
            if raw_matches_query(&raw, query) {
                outcome.candidates.push(candidate.clone());
            }
        }
        outcome
    })
}

fn read_candidate_raw(
    candidate: &SessionFileCandidate,
    read_errors: &mut usize,
) -> Option<Vec<u8>> {
    let mut raw = match std::fs::read(&candidate.snapshot_path) {
        Ok(data) => data,
        Err(_) => {
            *read_errors += 1;
            return None;
        }
    };

    if candidate.journal_path.exists() {
        match std::fs::read(&candidate.journal_path) {
            Ok(journal) => {
                raw.push(b'\n');
                raw.extend_from_slice(&journal);
            }
            Err(_) => *read_errors += 1,
        }
    }

    Some(raw)
}

fn score_candidates_parallel(
    candidates: &[SessionFileCandidate],
    query: &QueryProfile,
    options: &SearchOptions,
) -> Vec<SearchWorkerOutcome> {
    run_parallel_chunks(candidates, "scoring", |chunk| {
        let mut outcome = SearchWorkerOutcome::default();
        for candidate in chunk {
            match Session::load_from_path(&candidate.snapshot_path) {
                Ok(session) => {
                    append_session_results(&mut outcome.results, &session, query, options)
                }
                Err(_) => outcome.parse_errors += 1,
            }
        }
        outcome
    })
}

fn discover_rayu_cli_sessions(
    max_scan_sessions: usize,
) -> Vec<rayucode_import_core::ClaudeCodeSessionInfo> {
    let dirs = crate::legacy_compat::discover_rayu_cli_project_dirs();
    if dirs.is_empty() {
        return Vec::new();
    }
    let mut seen = HashSet::new();
    crate::legacy_compat::peek_unindexed_claude_compatible_sessions(
        &dirs,
        &mut seen,
        max_scan_sessions,
    )
}

fn search_external_sessions(query: &QueryProfile, options: &SearchOptions) -> SearchReport {
    let mut report = SearchReport::default();
    let mut records = Vec::new();

    if source_matches_filter("claude", options)
        && let Ok(sessions) =
            crate::import::list_claude_code_sessions_lazy(options.max_scan_sessions)
    {
        let claude_only: Vec<_> = sessions
            .into_iter()
            .filter(|s| {
                !crate::legacy_compat::is_rayu_cli_project_transcript_path(Path::new(&s.full_path))
            })
            .collect();
        collect_claude_compatible_source(
            &mut records,
            &mut report,
            "claude",
            "claude-code",
            claude_only,
            query,
            options,
        );
    }

    if source_matches_filter("rayu-cli", options) {
        let sessions = discover_rayu_cli_sessions(options.max_scan_sessions);
        collect_claude_compatible_source(
            &mut records,
            &mut report,
            "rayu-cli",
            "rayu-cli",
            sessions,
            query,
            options,
        );
    }

    type ExternalJsonlLoader = fn(&Path, bool) -> ImportCoreResult<Option<ExternalSessionRecord>>;
    for (source, root_relative, loader) in [
        (
            "codex",
            ".codex/sessions",
            load_codex_external_session as ExternalJsonlLoader,
        ),
        (
            "pi",
            ".pi/agent/sessions",
            load_pi_external_session as ExternalJsonlLoader,
        ),
        (
            "cursor",
            ".cursor/projects",
            load_cursor_external_session as ExternalJsonlLoader,
        ),
    ] {
        collect_external_jsonl_source(
            &mut records,
            &mut report,
            source,
            root_relative,
            query,
            options,
            loader,
        );
    }
    collect_opencode_external_sessions(&mut records, &mut report, options);

    if records.len() > options.max_scan_sessions.saturating_mul(6) {
        records.truncate(options.max_scan_sessions.saturating_mul(6));
        report.truncated = true;
    }

    report.scanned_external_sessions = records.len();
    for record in records {
        append_external_session_results(&mut report.results, &record, query, options);
    }
    report.external_sources.sort_unstable();
    report.external_sources.dedup();
    report
}

fn collect_external_jsonl_source(
    records: &mut Vec<ExternalSessionRecord>,
    report: &mut SearchReport,
    source: &'static str,
    root_relative: &str,
    query: &QueryProfile,
    options: &SearchOptions,
    loader: fn(&Path, bool) -> ImportCoreResult<Option<ExternalSessionRecord>>,
) {
    if !source_matches_filter(source, options) {
        return;
    }
    let Ok(root) = crate::storage::user_home_path(root_relative) else {
        return;
    };
    if !root.exists() {
        return;
    }
    report.external_sources.push(source);
    let paths = collect_recent_files_recursive(&root, "jsonl", options.max_scan_sessions);
    let mut candidates = external_index_candidate_paths(source, &paths, query);
    // Like the rayu path, cap how many candidate files get fully parsed.
    // Candidates arrive most-recent-first; exhaustive mode skips the cap.
    if !options.exhaustive {
        let budget = indexed_candidate_budget(options);
        if candidates.len() > budget {
            candidates.truncate(budget);
            report.truncated = true;
        }
    }
    let outcomes = load_external_candidates_parallel(&candidates, query, options, loader);
    for outcome in outcomes {
        report.parse_errors += outcome.parse_errors;
        records.extend(outcome.records);
    }
}

/// Narrow `paths` to plausible matches using the per-source incremental
/// index. Falls back to scanning everything if the index cannot be built.
/// Candidates are still re-verified against the real file contents, so index
/// hash collisions cannot produce wrong results.
fn external_index_candidate_paths(
    source: &'static str,
    paths: &[PathBuf],
    query: &QueryProfile,
) -> Vec<PathBuf> {
    let index = index_dir()
        .map(|dir| dir.join(format!("session_search_{source}_index_v2.bin")))
        .and_then(|index_path| {
            let specs: Vec<IndexFileSpec> = paths
                .iter()
                .map(|path| {
                    let (mtime_ms, size) = session_search_index::stat_ms_size(path);
                    IndexFileSpec {
                        key: path.to_string_lossy().into_owned(),
                        mtime_ms,
                        size,
                    }
                })
                .collect();
            session_search_index::build_or_update(&index_path, &specs, &|slot| {
                let path = &paths[slot];
                std::fs::read(path).ok().map(|raw| {
                    let path_text = path.to_string_lossy();
                    let mut text = String::with_capacity(path_text.len() + 1 + raw.len());
                    text.push_str(&path_text);
                    text.push(' ');
                    text.push_str(&String::from_utf8_lossy(&raw));
                    text
                })
            })
        });

    match index {
        Ok(index) => index
            .candidate_slots(&query.terms, query.min_term_matches)
            .into_iter()
            .filter_map(|slot| paths.get(slot).cloned())
            .collect(),
        Err(err) => {
            crate::logging::warn(&format!(
                "session_search {source} index unavailable; scanning all files: {err}"
            ));
            paths.to_vec()
        }
    }
}

#[derive(Default)]
struct ExternalLoadOutcome {
    records: Vec<ExternalSessionRecord>,
    parse_errors: usize,
}

/// Pre-filter and load external session files in parallel. External stores
/// like `~/.codex/sessions` can hold gigabytes of JSONL, so scanning them on a
/// single thread dominates search latency.
fn load_external_candidates_parallel(
    paths: &[PathBuf],
    query: &QueryProfile,
    options: &SearchOptions,
    loader: fn(&Path, bool) -> ImportCoreResult<Option<ExternalSessionRecord>>,
) -> Vec<ExternalLoadOutcome> {
    run_parallel_chunks(paths, "external scan", |chunk| {
        let mut outcome = ExternalLoadOutcome::default();
        for path in chunk {
            if !external_path_or_raw_matches_query(path, query) {
                continue;
            }
            match loader(path, options.include_tools) {
                Ok(Some(record)) => outcome.records.push(record),
                Ok(None) => {}
                Err(_) => outcome.parse_errors += 1,
            }
        }
        outcome
    })
}

fn collect_claude_compatible_source(
    records: &mut Vec<ExternalSessionRecord>,
    report: &mut SearchReport,
    source: &'static str,
    provider_key: &'static str,
    sessions: Vec<rayucode_import_core::ClaudeCodeSessionInfo>,
    query: &QueryProfile,
    options: &SearchOptions,
) {
    if sessions.is_empty() {
        return;
    }
    report.external_sources.push(source);
    let sessions: Vec<_> = sessions
        .into_iter()
        .take(options.max_scan_sessions)
        .collect();
    let mut candidates = claude_index_candidates(source, &sessions, query);
    if !options.exhaustive {
        let budget = indexed_candidate_budget(options);
        if candidates.len() > budget {
            candidates.truncate(budget);
            report.truncated = true;
        }
    }
    records.extend(load_claude_candidates_parallel(
        &candidates,
        source,
        provider_key,
        query,
        options,
    ));
}

/// Narrow claude-compatible sessions (`claude` or legacy `rayu-cli`) to
/// plausible matches with a per-source incremental index.
fn claude_index_candidates(
    source: &'static str,
    sessions: &[rayucode_import_core::ClaudeCodeSessionInfo],
    query: &QueryProfile,
) -> Vec<rayucode_import_core::ClaudeCodeSessionInfo> {
    let index = index_dir()
        .map(|dir| dir.join(format!("session_search_{source}_index_v2.bin")))
        .and_then(|index_path| {
            let specs: Vec<IndexFileSpec> = sessions
                .iter()
                .map(|session| {
                    let (mtime_ms, size) =
                        session_search_index::stat_ms_size(Path::new(&session.full_path));
                    IndexFileSpec {
                        key: session.full_path.clone(),
                        mtime_ms,
                        size,
                    }
                })
                .collect();
            session_search_index::build_or_update(&index_path, &specs, &|slot| {
                let session = &sessions[slot];
                let raw = std::fs::read(&session.full_path).unwrap_or_default();
                let mut text = String::with_capacity(raw.len() + 256);
                text.push_str(&session.full_path);
                text.push(' ');
                text.push_str(&session.session_id);
                text.push(' ');
                text.push_str(&session.first_prompt);
                if let Some(summary) = &session.summary {
                    text.push(' ');
                    text.push_str(summary);
                }
                if let Some(project) = &session.project_path {
                    text.push(' ');
                    text.push_str(project);
                }
                text.push(' ');
                text.push_str(&String::from_utf8_lossy(&raw));
                Some(text)
            })
        });

    match index {
        Ok(index) => index
            .candidate_slots(&query.terms, query.min_term_matches)
            .into_iter()
            .filter_map(|slot| sessions.get(slot).cloned())
            .collect(),
        Err(err) => {
            crate::logging::warn(&format!(
                "session_search {source} index unavailable; scanning all files: {err}"
            ));
            sessions.to_vec()
        }
    }
}

/// Pre-filter and load Claude Code session files in parallel, mirroring the
/// JSONL source scan above.
fn load_claude_candidates_parallel(
    sessions: &[rayucode_import_core::ClaudeCodeSessionInfo],
    source: &'static str,
    provider_key: &'static str,
    query: &QueryProfile,
    options: &SearchOptions,
) -> Vec<ExternalSessionRecord> {
    run_parallel_chunks(sessions, source, |chunk| {
        let mut records = Vec::new();
        for session in chunk {
            let path = PathBuf::from(&session.full_path);
            if !external_path_or_raw_matches_query(&path, query)
                && !external_text_matches_query(&session.session_id, query)
                && !external_text_matches_query(&session.first_prompt, query)
                && !session
                    .summary
                    .as_deref()
                    .is_some_and(|summary| external_text_matches_query(summary, query))
                && !session
                    .project_path
                    .as_deref()
                    .is_some_and(|project| external_text_matches_query(project, query))
            {
                continue;
            }
            let messages = load_claude_external_messages(&path, options.include_tools);
            let created_at = session.created.unwrap_or_else(Utc::now);
            let updated_at = session.modified.or(session.created).unwrap_or(created_at);
            let title = session
                .summary
                .clone()
                .filter(|summary| !summary.trim().is_empty())
                .unwrap_or_else(|| truncate_title_text(&session.first_prompt, 72));
            records.push(ExternalSessionRecord {
                source,
                session_id: session.session_id.clone(),
                short_name: Some(format!(
                    "{source} {}",
                    rayucode_core::util::truncate_str(&session.session_id, 8)
                )),
                title: Some(title),
                working_dir: session.project_path.clone(),
                provider_key: Some(provider_key.to_string()),
                model: None,
                created_at,
                updated_at,
                path,
                messages,
            });
        }
        records
    })
    .into_iter()
    .flatten()
    .collect()
}

fn external_path_or_raw_matches_query(path: &Path, query: &QueryProfile) -> bool {
    if path_matches_query(&path.to_string_lossy(), query) {
        return true;
    }
    std::fs::read(path)
        .map(|raw| raw_matches_query(&raw, query))
        .unwrap_or(false)
}

fn external_text_matches_query(text: &str, query: &QueryProfile) -> bool {
    rayucode_session_types::normalized_session_search_text_matches(&text.to_lowercase(), query)
}

fn collect_opencode_external_sessions(
    records: &mut Vec<ExternalSessionRecord>,
    report: &mut SearchReport,
    options: &SearchOptions,
) {
    if !source_matches_filter("opencode", options) {
        return;
    }
    let Ok(root) = crate::storage::user_home_path(".local/share/opencode/storage/session") else {
        return;
    };
    if !root.exists() {
        return;
    }
    report.external_sources.push("opencode");
    let Ok(messages_base) = crate::storage::user_home_path(".local/share/opencode/storage/message")
    else {
        return;
    };
    let Ok(parts_base) = crate::storage::user_home_path(".local/share/opencode/storage/part")
    else {
        return;
    };
    for path in collect_recent_files_recursive(&root, "json", options.max_scan_sessions) {
        match load_opencode_external_session(
            &path,
            &messages_base,
            &parts_base,
            options.include_tools,
            options.max_scan_sessions,
        ) {
            Ok(Some(record)) => records.push(record),
            Ok(None) => {}
            Err(_) => report.parse_errors += 1,
        }
    }
}

fn append_external_session_results(
    results: &mut Vec<SearchResult>,
    session: &ExternalSessionRecord,
    query: &QueryProfile,
    options: &SearchOptions,
) {
    if !external_session_matches_filters(session, options) {
        return;
    }
    if let Some(filter) = options.working_dir_filter.as_deref()
        && !session
            .working_dir
            .as_deref()
            .is_some_and(|working_dir| working_dir_matches(working_dir, filter))
    {
        return;
    }

    if role_filter_allows_metadata(options)
        && session_datetime_matches(session.updated_at, options.after, options.before)
        && let Some(match_score) = score_message_match(&external_metadata_text(session), query)
    {
        results.push(SearchResult {
            source: session.source.to_string(),
            session_id: format!("{}:{}", session.source, session.session_id),
            short_name: session.short_name.clone(),
            title: session.title.clone(),
            working_dir: session.working_dir.clone(),
            provider_key: session.provider_key.clone(),
            model: session.model.clone(),
            updated_at: session.updated_at,
            kind: SearchResultKind::Metadata,
            role: "metadata".to_string(),
            message_index: None,
            message_id: None,
            message_timestamp: None,
            snippet: match_score.snippet,
            score: match_score.score + 1.5,
            matched_terms: match_score.matched_terms,
            exact_match: match_score.exact_match,
            context: Vec::new(),
        });
    }

    for (message_index, msg) in session.messages.iter().enumerate() {
        if !role_filter_allows_external_message(&msg.role, options) {
            continue;
        }
        if !session_datetime_matches(
            msg.timestamp.unwrap_or(session.updated_at),
            options.after,
            options.before,
        ) {
            continue;
        }
        let Some(match_score) = score_message_match(&msg.text, query) else {
            continue;
        };
        results.push(SearchResult {
            source: session.source.to_string(),
            session_id: format!("{}:{}", session.source, session.session_id),
            short_name: session.short_name.clone(),
            title: session.title.clone(),
            working_dir: session.working_dir.clone(),
            provider_key: session.provider_key.clone(),
            model: session.model.clone(),
            updated_at: session.updated_at,
            kind: SearchResultKind::Message,
            role: msg.role.clone(),
            message_index: Some(message_index),
            message_id: msg.id.clone(),
            message_timestamp: msg.timestamp,
            snippet: match_score.snippet,
            score: match_score.score,
            matched_terms: match_score.matched_terms,
            exact_match: match_score.exact_match,
            context: build_external_context(&session.messages, message_index, options),
        });
    }
}

fn external_metadata_text(session: &ExternalSessionRecord) -> String {
    let mut fields = vec![
        format!("Source: {}", session.source),
        format!("Session ID: {}:{}", session.source, session.session_id),
        format!("Created: {}", format_datetime(session.created_at)),
        format!("Updated: {}", format_datetime(session.updated_at)),
        format!("Path: {}", session.path.display()),
    ];
    for (label, value) in [
        ("Title", session.title.as_deref()),
        ("Working directory", session.working_dir.as_deref()),
        ("Provider", session.provider_key.as_deref()),
        ("Model", session.model.as_deref()),
    ] {
        if let Some(value) = value {
            fields.push(format!("{label}: {value}"));
        }
    }
    fields.join("\n")
}

fn build_external_context(
    messages: &[ExternalMessageRecord],
    hit_index: usize,
    options: &SearchOptions,
) -> Vec<ResultContextLine> {
    if options.context_before == 0 && options.context_after == 0 {
        return Vec::new();
    }
    let start = hit_index.saturating_sub(options.context_before);
    let end = (hit_index + options.context_after + 1).min(messages.len());
    (start..end)
        .filter(|&idx| idx != hit_index)
        .filter_map(|idx| {
            let msg = &messages[idx];
            (!msg.text.trim().is_empty()).then(|| ResultContextLine {
                message_index: idx,
                role: msg.role.clone(),
                timestamp: msg.timestamp,
                text: truncate_context_text(&msg.text),
            })
        })
        .collect()
}

fn append_session_results(
    results: &mut Vec<SearchResult>,
    session: &Session,
    query: &QueryProfile,
    options: &SearchOptions,
) {
    if !options.include_current && session.id == options.current_session_id {
        return;
    }
    if !rayu_session_matches_filters(session, options) {
        return;
    }

    if let Some(filter) = options.working_dir_filter.as_deref()
        && !session
            .working_dir
            .as_deref()
            .is_some_and(|working_dir| working_dir_matches(working_dir, filter))
    {
        return;
    }

    if role_filter_allows_metadata(options)
        && session_datetime_matches(session.updated_at, options.after, options.before)
        && let Some(match_score) = score_message_match(&metadata_text(session), query)
    {
        results.push(SearchResult {
            source: "rayu".to_string(),
            session_id: session.id.clone(),
            short_name: session.short_name.clone(),
            title: session.display_title().map(ToOwned::to_owned),
            working_dir: session.working_dir.clone(),
            provider_key: session.provider_key.clone(),
            model: session.model.clone(),
            updated_at: session.updated_at,
            kind: SearchResultKind::Metadata,
            role: "metadata".to_string(),
            message_index: None,
            message_id: None,
            message_timestamp: None,
            snippet: match_score.snippet,
            score: match_score.score + 2.0,
            matched_terms: match_score.matched_terms,
            exact_match: match_score.exact_match,
            context: Vec::new(),
        });
    }

    for (message_index, msg) in session.messages.iter().enumerate() {
        if !options.include_system && is_system_like_message(msg) {
            continue;
        }
        if !role_filter_allows_message(msg, options) {
            continue;
        }
        if !session_datetime_matches(
            msg.timestamp.unwrap_or(session.updated_at),
            options.after,
            options.before,
        ) {
            continue;
        }

        let text = searchable_message_text(msg, options.include_tools);
        if text.is_empty() {
            continue;
        }

        let Some(match_score) = score_message_match(&text, query) else {
            continue;
        };

        let mut score = match_score.score;
        if is_tool_only_message(msg) {
            score *= 0.4;
        }

        results.push(SearchResult {
            source: "rayu".to_string(),
            session_id: session.id.clone(),
            short_name: session.short_name.clone(),
            title: session.display_title().map(ToOwned::to_owned),
            working_dir: session.working_dir.clone(),
            provider_key: session.provider_key.clone(),
            model: session.model.clone(),
            updated_at: session.updated_at,
            kind: SearchResultKind::Message,
            role: role_label(msg).to_string(),
            message_index: Some(message_index),
            message_id: Some(msg.id.clone()),
            message_timestamp: msg.timestamp,
            snippet: match_score.snippet,
            score,
            matched_terms: match_score.matched_terms,
            exact_match: match_score.exact_match,
            context: build_rayu_context(&session.messages, message_index, options),
        });
    }
}

fn metadata_text(session: &Session) -> String {
    let mut fields = vec![
        format!("Session ID: {}", session.id),
        format!("Updated: {}", format_datetime(session.updated_at)),
        format!("Created: {}", format_datetime(session.created_at)),
    ];
    let generated_title = session
        .title
        .as_deref()
        .filter(|t| session.custom_title.is_some() && Some(*t) != session.display_title());
    for (label, value) in [
        ("Short name", session.short_name.as_deref()),
        ("Title", session.display_title()),
        ("Generated title", generated_title),
        ("Working directory", session.working_dir.as_deref()),
        ("Save label", session.save_label.as_deref()),
        ("Provider", session.provider_key.as_deref()),
        ("Model", session.model.as_deref()),
    ] {
        if let Some(value) = value {
            fields.push(format!("{label}: {value}"));
        }
    }
    fields.join("\n")
}

fn source_matches_filter(source: &str, options: &SearchOptions) -> bool {
    options
        .source_filter
        .as_deref()
        .is_none_or(|filter| source.eq_ignore_ascii_case(filter))
}

fn rayu_session_matches_filters(session: &Session, options: &SearchOptions) -> bool {
    source_matches_filter("rayu", options)
        && provider_matches(session.provider_key.as_deref(), "rayu", options)
        && field_filter_matches(session.model.as_deref(), options.model_filter.as_deref())
        && options
            .saved_filter
            .is_none_or(|expected| session.saved == expected)
        && options
            .debug_filter
            .is_none_or(|expected| session.is_debug == expected)
        && options
            .canary_filter
            .is_none_or(|expected| session.is_canary == expected)
}

fn external_session_matches_filters(
    session: &ExternalSessionRecord,
    options: &SearchOptions,
) -> bool {
    source_matches_filter(session.source, options)
        && provider_matches(session.provider_key.as_deref(), session.source, options)
        && field_filter_matches(session.model.as_deref(), options.model_filter.as_deref())
        && options.saved_filter != Some(true)
        && options.debug_filter != Some(true)
        && options.canary_filter != Some(true)
}

fn provider_matches(provider_key: Option<&str>, source: &str, options: &SearchOptions) -> bool {
    let Some(filter) = options.provider_filter.as_deref() else {
        return true;
    };
    field_filter_matches(provider_key, Some(filter)) || source.to_ascii_lowercase().contains(filter)
}

fn role_filter_allows_metadata(options: &SearchOptions) -> bool {
    options
        .role_filter
        .is_none_or(|role| role == RoleFilter::Metadata)
}

fn role_filter_allows_message(msg: &StoredMessage, options: &SearchOptions) -> bool {
    let Some(role_filter) = options.role_filter else {
        return true;
    };
    match role_filter {
        RoleFilter::User => msg.role == crate::message::Role::User,
        RoleFilter::Assistant => msg.role == crate::message::Role::Assistant,
        RoleFilter::Metadata => false,
    }
}

fn role_filter_allows_external_message(role: &str, options: &SearchOptions) -> bool {
    let Some(role_filter) = options.role_filter else {
        return true;
    };
    match role_filter {
        RoleFilter::User => role.eq_ignore_ascii_case("user"),
        RoleFilter::Assistant => role.eq_ignore_ascii_case("assistant"),
        RoleFilter::Metadata => false,
    }
}

fn build_rayu_context(
    messages: &[StoredMessage],
    hit_index: usize,
    options: &SearchOptions,
) -> Vec<ResultContextLine> {
    if options.context_before == 0 && options.context_after == 0 {
        return Vec::new();
    }
    let start = hit_index.saturating_sub(options.context_before);
    let end = (hit_index + options.context_after + 1).min(messages.len());
    (start..end)
        .filter(|&idx| idx != hit_index)
        .filter_map(|idx| {
            let msg = &messages[idx];
            if !options.include_system && is_system_like_message(msg) {
                return None;
            }
            let text = searchable_message_text(msg, options.include_tools);
            if text.trim().is_empty() {
                return None;
            }
            Some(ResultContextLine {
                message_index: idx,
                role: role_label(msg).to_string(),
                timestamp: msg.timestamp,
                text: truncate_context_text(&text),
            })
        })
        .collect()
}

fn truncate_context_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 320 {
        trimmed.to_string()
    } else {
        format!("{}...", trimmed.chars().take(320).collect::<String>())
    }
}

mod searchable_text;
use searchable_text::searchable_message_text;

fn is_system_like_message(msg: &StoredMessage) -> bool {
    msg.display_role.is_some()
        || msg
            .content
            .iter()
            .find_map(|block| match block {
                ContentBlock::Text { text, .. } => Some(text.trim_start()),
                _ => None,
            })
            .is_some_and(|text| text.starts_with("<system-reminder>"))
}

fn is_tool_only_message(msg: &StoredMessage) -> bool {
    let mut has_text = false;
    let mut has_tool = false;

    for block in &msg.content {
        match block {
            ContentBlock::Text { text, .. } if !text.trim().is_empty() => has_text = true,
            ContentBlock::ToolUse { .. } | ContentBlock::ToolResult { .. } => has_tool = true,
            _ => {}
        }
    }

    has_tool && !has_text
}

fn role_label(msg: &StoredMessage) -> &'static str {
    if let Some(display_role) = msg.display_role {
        return match display_role {
            crate::session::StoredDisplayRole::System => "system",
            crate::session::StoredDisplayRole::BackgroundTask => "background",
        };
    }

    match msg.role {
        crate::message::Role::User => "user",
        crate::message::Role::Assistant => "assistant",
    }
}

fn compare_results(a: &SearchResult, b: &SearchResult) -> std::cmp::Ordering {
    b.score
        .partial_cmp(&a.score)
        .unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| b.updated_at.cmp(&a.updated_at))
        .then_with(|| a.session_id.cmp(&b.session_id))
        .then_with(|| a.message_index.cmp(&b.message_index))
}

fn group_and_limit_results(
    results: Vec<SearchResult>,
    options: &SearchOptions,
) -> Vec<SearchResult> {
    let mut grouped = Vec::new();
    let mut per_session: HashMap<String, usize> = HashMap::new();

    for result in results {
        let count = per_session.entry(result.session_id.clone()).or_default();
        if *count >= options.max_per_session {
            continue;
        }
        *count += 1;
        grouped.push(result);
        if grouped.len() >= options.limit {
            break;
        }
    }

    grouped
}

fn render_options(options: &SearchOptions) -> SessionSearchRenderOptions {
    SessionSearchRenderOptions {
        include_current: options.include_current,
        include_external: options.include_external,
        include_tools: options.include_tools,
        include_system: options.include_system,
        max_per_session: options.max_per_session,
        has_working_dir_filter: options.working_dir_filter.is_some(),
    }
}

fn format_results(query: &str, report: &SearchReport, options: &SearchOptions) -> String {
    format_session_search_results(query, report, &render_options(options))
}

fn no_results_message(query: &str, options: &SearchOptions) -> String {
    format_session_search_no_results(query, &render_options(options))
}

#[cfg(test)]
#[path = "session_search_tests.rs"]
mod session_search_tests;

#[cfg(test)]
mod rayu_cli_tests {
    use super::*;

    #[test]
    fn rayu_cli_source_filter_and_legacy_projects_search() {
        for raw in ["rayu-cli", "rayu_cli", "RAYU-CLI"] {
            assert_eq!(
                normalize_source_filter(Some(raw)).unwrap().as_deref(),
                Some("rayu-cli")
            );
        }
        assert!(
            normalize_source_filter(Some("nope"))
                .unwrap_err()
                .contains("rayu-cli")
        );
        let schema = SessionSearchTool::new().parameters_schema();
        let sources = schema["properties"]["source"]["enum"].as_array().unwrap();
        assert!(sources.iter().any(|v| v == "rayu-cli"));

        let _lock = crate::storage::lock_test_env();
        let temp = tempfile::TempDir::new().expect("tempdir");
        let prev = ["RAYU_HOME", "RAYU_CONFIG_DIR"].map(|k| (k, std::env::var_os(k)));
        crate::env::set_var("RAYU_HOME", temp.path());
        crate::env::remove_var("RAYU_CONFIG_DIR");
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let proj = temp.path().join("projects/-tmp-legacy-repo");
            let sub = proj.join("legacy-sess/subagents");
            std::fs::create_dir_all(&sub).expect("mkdir subagents");
            let transcript = proj.join("legacy-sess.jsonl");
            let body = concat!(
                "{\"type\":\"user\",\"cwd\":\"/tmp/legacy-repo\",\"sessionId\":\"legacy-sess\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"message\":{\"role\":\"user\",\"content\":\"legacy-user-prompt\"}}\n",
                "{\"type\":\"assistant\",\"sessionId\":\"legacy-sess\",\"timestamp\":\"2026-01-01T00:00:05Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"legacy-rayu-cli-needle resolved\"}]}}\n",
                "{\"type\":\"custom-title\",\"customTitle\":\"Legacy Title\"}\n"
            );
            std::fs::write(&transcript, body).expect("write transcript");
            std::fs::write(
                sub.join("a1.jsonl"),
                "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"subagent-hidden-needle\"}}\n",
            )
            .expect("write subagent");
            let mtime_before = std::fs::metadata(&transcript).unwrap().modified().unwrap();
            let sessions = temp.path().join("sessions");
            let run = |q: &str, src: Option<&str>| {
                let mut opts = SearchOptions::for_test("cur");
                opts.source_filter = src.map(str::to_string);
                search_sessions_blocking(&sessions, &QueryProfile::new(q), &opts, "t").unwrap()
            };

            let rep = run("legacy-rayu-cli-needle", None);
            assert_eq!(rep.external_sources, vec!["rayu-cli"]);
            assert_eq!(rep.results.len(), 1);
            assert_eq!(rep.results[0].source, "rayu-cli");
            assert_eq!(rep.results[0].session_id, "rayu-cli:legacy-sess");
            assert_eq!(rep.results[0].title.as_deref(), Some("Legacy Title"));
            assert_eq!(
                rep.results[0].working_dir.as_deref(),
                Some("/tmp/legacy-repo")
            );
            assert_eq!(
                run("legacy-rayu-cli-needle", Some("rayu-cli"))
                    .results
                    .len(),
                1
            );
            assert!(
                run("subagent-hidden-needle", Some("rayu-cli"))
                    .results
                    .is_empty()
            );
            assert!(
                run("legacy-rayu-cli-needle", Some("claude"))
                    .results
                    .is_empty()
            );
            assert!(
                run("legacy-rayu-cli-needle", Some("rayu"))
                    .results
                    .is_empty()
            );
            assert_eq!(std::fs::read_to_string(&transcript).unwrap(), body);
            assert_eq!(
                std::fs::metadata(&transcript).unwrap().modified().unwrap(),
                mtime_before
            );
        }));
        for (k, val) in prev {
            match val {
                Some(v) => crate::env::set_var(k, v),
                None => crate::env::remove_var(k),
            }
        }
        if let Err(payload) = outcome {
            std::panic::resume_unwind(payload);
        }
    }
}
