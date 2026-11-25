use serde::{Deserialize, Serialize};

/// Type of filesystem mutation tracked for a file in a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeKind {
    Created,
    Modified,
    Deleted,
    Renamed,
}

/// Review status of a tracked file change entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeStatus {
    Pending,
    Kept,
    Undone,
}

/// Review action requested by a client on one or all tracked file changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeActionKind {
    Keep,
    Undo,
    Redo,
    KeepAll,
    UndoAll,
    RedoAll,
}

/// Structured unified-diff hunk shared across summary previews and full diffs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChangeHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub header: String,
    #[serde(default)]
    pub lines: Vec<String>,
}

/// Compact per-file summary sent inside [`FileChangesSnapshot`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChangeEntrySummary {
    pub path: String,
    pub display_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub kind: FileChangeKind,
    pub status: FileChangeStatus,
    pub additions: usize,
    pub deletions: usize,
    pub changed_in_latest_turn: bool,
    pub turn_id: u64,
    pub edit_count: u32,
    pub is_binary: bool,
    pub undoable: bool,
    pub can_redo: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preview_hunks: Vec<FileChangeHunk>,
    #[serde(default)]
    pub preview_truncated: bool,
    pub updated_at_ms: i64,
}

/// Authoritative session-scoped snapshot of tracked file changes for review UIs.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChangesSnapshot {
    pub session_id: String,
    pub latest_turn_id: u64,
    pub total_pending_files: usize,
    pub total_additions: usize,
    pub total_deletions: usize,
    #[serde(default)]
    pub files: Vec<FileChangeEntrySummary>,
}

impl FileChangesSnapshot {
    pub fn empty(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            ..Self::default()
        }
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

/// Full uncapped diff payload returned on demand for a single tracked file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChangeDiffPayload {
    pub path: String,
    pub display_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub kind: FileChangeKind,
    pub status: FileChangeStatus,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    pub original_content: String,
    pub modified_content: String,
    pub unified_diff: String,
    #[serde(default)]
    pub hunks: Vec<FileChangeHunk>,
}

/// Conflict encountered while safely undoing or redoing a file change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChangeConflict {
    pub path: String,
    pub display_path: String,
    pub reason: String,
}

/// Structured response to a [`FileChangeActionKind`] request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChangeActionResponse {
    pub ok: bool,
    pub message: String,
    #[serde(default)]
    pub conflicts: Vec<FileChangeConflict>,
    pub snapshot: FileChangesSnapshot,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_default_and_empty_helpers() {
        let default_snap = FileChangesSnapshot::default();
        assert!(default_snap.is_empty());
        assert_eq!(default_snap.latest_turn_id, 0);
        assert_eq!(default_snap.total_pending_files, 0);

        let empty = FileChangesSnapshot::empty("ses_1");
        assert!(empty.is_empty());
        assert_eq!(empty.session_id, "ses_1");

        let hunk = FileChangeHunk {
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 2,
            header: "@@ -1,1 +1,2 @@".into(),
            lines: vec!["-old".into(), "+new".into(), "+added".into()],
        };
        let entry = FileChangeEntrySummary {
            path: "/repo/src/lib.rs".into(),
            display_path: "src/lib.rs".into(),
            old_path: None,
            kind: FileChangeKind::Modified,
            status: FileChangeStatus::Pending,
            additions: 2,
            deletions: 1,
            changed_in_latest_turn: true,
            turn_id: 3,
            edit_count: 2,
            is_binary: false,
            undoable: true,
            can_redo: false,
            preview_hunks: vec![hunk],
            preview_truncated: false,
            updated_at_ms: 1_700_000_000_000,
        };
        let populated = FileChangesSnapshot {
            session_id: "ses_1".into(),
            latest_turn_id: 3,
            total_pending_files: 1,
            total_additions: 2,
            total_deletions: 1,
            files: vec![entry],
        };
        assert!(!populated.is_empty());
        assert_eq!(populated.clone(), populated);
    }
}
