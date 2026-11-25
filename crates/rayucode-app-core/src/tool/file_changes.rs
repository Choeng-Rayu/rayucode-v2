//! Engine tool boundary hooks that record exact pre/post file mutations into
//! [`crate::file_changes`]. Never fails a tool write if persistence encounters
//! an error.

use super::ToolContext;
use crate::file_changes::{FileMutationRecord, MAX_BLOB_BYTES};
use std::path::Path;

#[cfg(unix)]
pub(super) fn read_unix_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .ok()
        .map(|meta| meta.permissions().mode())
}

#[cfg(not(unix))]
pub(super) fn read_unix_mode(_path: &Path) -> Option<u32> {
    None
}

/// Read raw file bytes without loading files larger than [`MAX_BLOB_BYTES`] into
/// memory. Returns `(Some(bytes), false)` on success, `(None, true)` when the
/// file exceeds the snapshot cap, or `(None, false)` when missing/unreadable.
pub(super) async fn read_bytes_capped(path: &Path) -> (Option<Vec<u8>>, bool) {
    let Ok(meta) = tokio::fs::metadata(path).await else {
        return (None, false);
    };
    if meta.len() as usize > MAX_BLOB_BYTES {
        return (None, true);
    }
    match tokio::fs::read(path).await {
        Ok(bytes) if bytes.len() > MAX_BLOB_BYTES => (None, true),
        Ok(bytes) => (Some(bytes), false),
        Err(_) => (None, false),
    }
}

struct OwnedMutation {
    session_id: String,
    working_dir: Option<std::path::PathBuf>,
    path: std::path::PathBuf,
    old_path: Option<std::path::PathBuf>,
    before_existed: bool,
    before_bytes: Option<Vec<u8>>,
    before_exceeded_cap: bool,
    before_mode: Option<u32>,
    after_existed: bool,
    after_bytes: Option<Vec<u8>>,
    after_exceeded_cap: bool,
    after_mode: Option<u32>,
}

async fn persist(mutation: OwnedMutation) {
    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let after_mode = mutation
            .after_mode
            .or_else(|| mutation.after_existed.then(|| read_unix_mode(&mutation.path)).flatten());
        crate::file_changes::record_mutation(FileMutationRecord {
            session_id: &mutation.session_id,
            working_dir: mutation.working_dir.as_deref(),
            path: &mutation.path,
            old_path: mutation.old_path.as_deref(),
            before_existed: mutation.before_existed,
            before_bytes: mutation.before_bytes.as_deref(),
            before_exceeded_cap: mutation.before_exceeded_cap,
            before_mode: mutation.before_mode,
            after_existed: mutation.after_existed,
            after_bytes: mutation.after_bytes.as_deref(),
            after_exceeded_cap: mutation.after_exceeded_cap,
            after_mode,
        })?;
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => (),
        other => crate::logging::warn(&format!("Could not persist file change entry: {other:?}")),
    }
}

pub(super) async fn record_created(ctx: &ToolContext, path: &Path, after: &[u8]) {
    let after_exceeded = after.len() > MAX_BLOB_BYTES;
    persist(OwnedMutation {
        session_id: ctx.session_id.clone(),
        working_dir: ctx.working_dir.clone(),
        path: path.to_path_buf(),
        old_path: None,
        before_existed: false,
        before_bytes: None,
        before_exceeded_cap: false,
        before_mode: None,
        after_existed: true,
        after_bytes: (!after_exceeded).then(|| after.to_vec()),
        after_exceeded_cap: after_exceeded,
        after_mode: None,
    })
    .await;
}

pub(super) async fn record_modified(
    ctx: &ToolContext,
    path: &Path,
    before: &[u8],
    before_mode: Option<u32>,
    after: &[u8],
) {
    let before_exceeded = before.len() > MAX_BLOB_BYTES;
    let after_exceeded = after.len() > MAX_BLOB_BYTES;
    persist(OwnedMutation {
        session_id: ctx.session_id.clone(),
        working_dir: ctx.working_dir.clone(),
        path: path.to_path_buf(),
        old_path: None,
        before_existed: true,
        before_bytes: (!before_exceeded).then(|| before.to_vec()),
        before_exceeded_cap: before_exceeded,
        before_mode,
        after_existed: true,
        after_bytes: (!after_exceeded).then(|| after.to_vec()),
        after_exceeded_cap: after_exceeded,
        after_mode: None,
    })
    .await;
}

pub(super) async fn record_write(
    ctx: &ToolContext,
    path: &Path,
    before_existed: bool,
    before: Option<&[u8]>,
    before_exceeded_cap: bool,
    before_mode: Option<u32>,
    after: &[u8],
) {
    let before_exceeded =
        before_exceeded_cap || before.is_some_and(|bytes| bytes.len() > MAX_BLOB_BYTES);
    let after_exceeded = after.len() > MAX_BLOB_BYTES;
    persist(OwnedMutation {
        session_id: ctx.session_id.clone(),
        working_dir: ctx.working_dir.clone(),
        path: path.to_path_buf(),
        old_path: None,
        before_existed,
        before_bytes: (!before_exceeded)
            .then(|| before.map(|bytes| bytes.to_vec()))
            .flatten(),
        before_exceeded_cap: before_exceeded,
        before_mode,
        after_existed: true,
        after_bytes: (!after_exceeded).then(|| after.to_vec()),
        after_exceeded_cap: after_exceeded,
        after_mode: None,
    })
    .await;
}

pub(super) async fn record_deleted(
    ctx: &ToolContext,
    path: &Path,
    before: &[u8],
    before_mode: Option<u32>,
) {
    record_deleted_raw(ctx, path, Some(before), false, before_mode).await;
}

pub(super) async fn record_deleted_raw(
    ctx: &ToolContext,
    path: &Path,
    before: Option<&[u8]>,
    before_exceeded_cap: bool,
    before_mode: Option<u32>,
) {
    let before_exceeded =
        before_exceeded_cap || before.is_some_and(|bytes| bytes.len() > MAX_BLOB_BYTES);
    persist(OwnedMutation {
        session_id: ctx.session_id.clone(),
        working_dir: ctx.working_dir.clone(),
        path: path.to_path_buf(),
        old_path: None,
        before_existed: true,
        before_bytes: (!before_exceeded)
            .then(|| before.map(|bytes| bytes.to_vec()))
            .flatten(),
        before_exceeded_cap: before_exceeded,
        before_mode,
        after_existed: false,
        after_bytes: None,
        after_exceeded_cap: false,
        after_mode: None,
    })
    .await;
}

pub(super) async fn record_renamed(
    ctx: &ToolContext,
    old_path: &Path,
    new_path: &Path,
    before: &[u8],
    before_mode: Option<u32>,
    after: &[u8],
) {
    let before_exceeded = before.len() > MAX_BLOB_BYTES;
    let after_exceeded = after.len() > MAX_BLOB_BYTES;
    persist(OwnedMutation {
        session_id: ctx.session_id.clone(),
        working_dir: ctx.working_dir.clone(),
        path: new_path.to_path_buf(),
        old_path: Some(old_path.to_path_buf()),
        before_existed: true,
        before_bytes: (!before_exceeded).then(|| before.to_vec()),
        before_exceeded_cap: before_exceeded,
        before_mode,
        after_existed: true,
        after_bytes: (!after_exceeded).then(|| after.to_vec()),
        after_exceeded_cap: after_exceeded,
        after_mode: None,
    })
    .await;
}

#[cfg(test)]
mod tests {
    use crate::file_changes::{
        FileChangeActionKind, FileChangeKind, FileChangeStatus, apply_action, begin_turn, get_diff,
        snapshot_for_session,
    };
    use crate::tool::{Tool, ToolContext, ToolExecutionMode};
    use serde_json::json;

    struct HomeGuard(Option<std::ffi::OsString>);
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            if let Some(prev) = self.0.take() {
                crate::env::set_var("RAYU_HOME", prev);
            } else {
                crate::env::remove_var("RAYU_HOME");
            }
        }
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn edit_write_patch_and_apply_patch_record_into_file_changes_store() {
        let _lock = crate::storage::lock_test_env();
        let home = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let _home = HomeGuard(std::env::var_os("RAYU_HOME"));
        crate::env::set_var("RAYU_HOME", home.path());

        let sid = "tool_file_changes_integration";
        begin_turn(sid);
        let ctx = ToolContext {
            session_id: sid.into(),
            message_id: "m1".into(),
            tool_call_id: "tc1".into(),
            working_dir: Some(ws.path().to_path_buf()),
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: ToolExecutionMode::Direct,
        };

        // 1. WriteTool creates a file.
        crate::tool::write::WriteTool::new()
            .execute(
                json!({"file_path": "alpha.rs", "content": "fn alpha() -> i32 {\n    1\n}\n"}),
                ctx.clone(),
            )
            .await
            .unwrap();

        // 2. EditTool modifies that same file -> baseline remains Created (didn't exist).
        crate::tool::edit::EditTool::new()
            .execute(
                json!({"file_path": "alpha.rs", "old_string": "1", "new_string": "2"}),
                ctx.clone(),
            )
            .await
            .unwrap();

        let snap = snapshot_for_session(sid);
        let alpha = snap
            .files
            .iter()
            .find(|f| f.display_path == "alpha.rs")
            .unwrap();
        assert_eq!(alpha.kind, FileChangeKind::Created);
        assert_eq!(alpha.edit_count, 2);
        assert_eq!(alpha.additions, 3);
        assert_eq!(alpha.deletions, 0);

        // 3. PatchTool modifies an existing file and deletes another.
        std::fs::write(ws.path().join("beta.txt"), "one\ntwo\n").unwrap();
        std::fs::write(ws.path().join("remove_me.txt"), "bye\n").unwrap();
        crate::tool::patch::PatchTool::new()
            .execute(
                json!({
                    "patch_text": "--- a/beta.txt\n+++ b/beta.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n--- a/remove_me.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n"
                }),
                ctx.clone(),
            )
            .await
            .unwrap();

        // 4. ApplyPatchTool moves & updates an existing file and adds a new one.
        std::fs::write(ws.path().join("orig.rs"), "pub fn x() {}\n").unwrap();
        crate::tool::apply_patch::ApplyPatchTool::new()
            .execute(
                json!({
                    "patch_text": "*** Begin Patch\n*** Update File: orig.rs\n*** Move to: moved.rs\n@@\n-pub fn x() {}\n+pub fn y() {}\n*** Add File: added.rs\n+pub const Z: u8 = 7;\n*** End Patch"
                }),
                ctx.clone(),
            )
            .await
            .unwrap();

        let snap = snapshot_for_session(sid);
        assert_eq!(snap.total_pending_files, 5);
        assert_eq!(
            snap.files
                .iter()
                .find(|f| f.display_path == "beta.txt")
                .unwrap()
                .kind,
            FileChangeKind::Modified
        );
        assert_eq!(
            snap.files
                .iter()
                .find(|f| f.display_path == "remove_me.txt")
                .unwrap()
                .kind,
            FileChangeKind::Deleted
        );
        let moved = snap
            .files
            .iter()
            .find(|f| f.display_path == "moved.rs")
            .unwrap();
        assert_eq!(moved.kind, FileChangeKind::Renamed);
        assert!(moved.old_path.as_deref().is_some_and(|p| p.ends_with("orig.rs")));

        let moved_diff = get_diff(sid, "moved.rs").unwrap();
        assert_eq!(moved_diff.original_content, "pub fn x() {}\n");
        assert_eq!(moved_diff.modified_content, "pub fn y() {}\n");

        // UndoAll cleanly reverses all 5 files!
        let undone = apply_action(sid, FileChangeActionKind::UndoAll, None, false).unwrap();
        assert!(undone.ok, "unexpected conflicts: {:?}", undone.conflicts);
        assert!(!ws.path().join("alpha.rs").exists());
        assert_eq!(
            std::fs::read_to_string(ws.path().join("beta.txt")).unwrap(),
            "one\ntwo\n"
        );
        assert_eq!(
            std::fs::read_to_string(ws.path().join("remove_me.txt")).unwrap(),
            "bye\n"
        );
        assert!(!ws.path().join("moved.rs").exists());
        assert_eq!(
            std::fs::read_to_string(ws.path().join("orig.rs")).unwrap(),
            "pub fn x() {}\n"
        );
        assert!(!ws.path().join("added.rs").exists());
        assert_eq!(undone.snapshot.total_pending_files, 0);
        assert!(
            undone
                .snapshot
                .files
                .iter()
                .all(|f| f.status == FileChangeStatus::Undone && f.can_redo)
        );

        // RedoAll re-applies all 5 files cleanly!
        let redone = apply_action(sid, FileChangeActionKind::RedoAll, None, false).unwrap();
        assert!(redone.ok, "unexpected redo conflicts: {:?}", redone.conflicts);
        assert_eq!(
            std::fs::read_to_string(ws.path().join("alpha.rs")).unwrap(),
            "fn alpha() -> i32 {\n    2\n}\n"
        );
        assert_eq!(
            std::fs::read_to_string(ws.path().join("beta.txt")).unwrap(),
            "one\nTWO\n"
        );
        assert!(!ws.path().join("remove_me.txt").exists());
        assert!(!ws.path().join("orig.rs").exists());
        assert_eq!(
            std::fs::read_to_string(ws.path().join("moved.rs")).unwrap(),
            "pub fn y() {}\n"
        );
        assert_eq!(
            std::fs::read_to_string(ws.path().join("added.rs")).unwrap(),
            "pub const Z: u8 = 7;\n"
        );
        assert_eq!(redone.snapshot.total_pending_files, 5);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn apply_patch_move_overwriting_existing_file_restores_both_on_undo() {
        let _lock = crate::storage::lock_test_env();
        let home = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let _home = HomeGuard(std::env::var_os("RAYU_HOME"));
        crate::env::set_var("RAYU_HOME", home.path());

        let sid = "tool_file_changes_move_overwrite";
        begin_turn(sid);
        let ctx = ToolContext {
            session_id: sid.into(),
            message_id: "m1".into(),
            tool_call_id: "tc1".into(),
            working_dir: Some(ws.path().to_path_buf()),
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: ToolExecutionMode::Direct,
        };

        std::fs::write(ws.path().join("src_a.rs"), "pub fn a() {}\n").unwrap();
        std::fs::write(ws.path().join("existing_b.rs"), "pub fn precious_b() {}\n").unwrap();

        crate::tool::apply_patch::ApplyPatchTool::new()
            .execute(
                json!({
                    "patch_text": "*** Begin Patch\n*** Update File: src_a.rs\n*** Move to: existing_b.rs\n@@\n-pub fn a() {}\n+pub fn a_moved() {}\n*** End Patch"
                }),
                ctx,
            )
            .await
            .unwrap();

        assert!(!ws.path().join("src_a.rs").exists());
        assert_eq!(
            std::fs::read_to_string(ws.path().join("existing_b.rs")).unwrap(),
            "pub fn a_moved() {}\n"
        );

        let undone = apply_action(sid, FileChangeActionKind::UndoAll, None, false).unwrap();
        assert!(undone.ok, "unexpected conflicts: {:?}", undone.conflicts);
        assert_eq!(
            std::fs::read_to_string(ws.path().join("src_a.rs")).unwrap(),
            "pub fn a() {}\n"
        );
        assert_eq!(
            std::fs::read_to_string(ws.path().join("existing_b.rs")).unwrap(),
            "pub fn precious_b() {}\n"
        );
    }
}
