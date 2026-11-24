//! Persistent per-session file-change tracking, diff generation, and safe
//! undo/redo/keep engine.
//!
//! State is stored per session under:
//! `<rayu_dir>/sessions/file-changes/<session_id>/manifest.json`
//! with content-addressed pre/post blobs under `blobs/<sha256>`.

mod diff;
mod store;
mod undo;

#[cfg(test)]
mod tests;

pub use rayucode_session_types::{
    FileChangeActionKind, FileChangeActionResponse, FileChangeConflict, FileChangeDiffPayload,
    FileChangeEntrySummary, FileChangeHunk, FileChangeKind, FileChangeStatus, FileChangesSnapshot,
};
pub use store::{
    FileMutationRecord, MAX_BLOB_BYTES, PREVIEW_MAX_LINES, affected_paths_for_action, apply_action,
    begin_turn, delete_session_file_changes, evict_session_cache, get_diff, normalize_path,
    record_mutation, session_revision, snapshot_for_session,
};
