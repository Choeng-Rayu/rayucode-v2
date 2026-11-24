use super::*;
use std::ffi::OsString;
use std::path::Path;

struct HomeSandbox {
    _dir: tempfile::TempDir,
    prev: Option<OsString>,
}

impl HomeSandbox {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let prev = std::env::var_os("RAYU_HOME");
        crate::env::set_var("RAYU_HOME", dir.path());
        Self { _dir: dir, prev }
    }
}

impl Drop for HomeSandbox {
    fn drop(&mut self) {
        if let Some(prev) = self.prev.take() {
            crate::env::set_var("RAYU_HOME", prev);
        } else {
            crate::env::remove_var("RAYU_HOME");
        }
    }
}

fn mod_record<'a>(
    session_id: &'a str,
    wd: &'a Path,
    path: &'a Path,
    before: &'a [u8],
    after: &'a [u8],
    before_mode: Option<u32>,
) -> FileMutationRecord<'a> {
    FileMutationRecord {
        session_id,
        working_dir: Some(wd),
        path,
        old_path: None,
        before_existed: true,
        before_bytes: Some(before),
        before_exceeded_cap: false,
        before_mode,
        after_existed: true,
        after_bytes: Some(after),
        after_exceeded_cap: false,
        after_mode: before_mode,
    }
}

#[test]
fn multi_edit_accumulation_preserves_original_baseline_and_exact_net_stats() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    let ws = tempfile::tempdir().unwrap();
    let file = ws.path().join("src/app.rs");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();

    let v0 = "line 1\nline 2\nline 3\nline 4\n";
    let v1 = "line 1\nline TWO\nline 3\nline 4\n";
    let v2 = "line 1\nline TWO\nline 3\nline 4\nline 5\nline 6\n";

    std::fs::write(&file, v1).unwrap();
    assert_eq!(begin_turn("ses_accum"), 1);
    let snap1 = record_mutation(mod_record(
        "ses_accum",
        ws.path(),
        &file,
        v0.as_bytes(),
        v1.as_bytes(),
        None,
    ))
    .unwrap();
    assert_eq!(snap1.latest_turn_id, 1);
    assert_eq!(snap1.total_pending_files, 1);
    assert_eq!(snap1.total_additions, 1);
    assert_eq!(snap1.total_deletions, 1);
    assert_eq!(snap1.files[0].edit_count, 1);
    assert_eq!(snap1.files[0].display_path, "src/app.rs");

    // Second AI edit in Turn 2 on the same file: baseline must stay v0!
    std::fs::write(&file, v2).unwrap();
    assert_eq!(begin_turn("ses_accum"), 2);
    let snap2 = record_mutation(mod_record(
        "ses_accum",
        ws.path(),
        &file,
        v1.as_bytes(),
        v2.as_bytes(),
        None,
    ))
    .unwrap();
    assert_eq!(snap2.latest_turn_id, 2);
    assert_eq!(snap2.total_pending_files, 1);
    assert_eq!(snap2.total_additions, 3);
    assert_eq!(snap2.total_deletions, 1);
    assert_eq!(snap2.files[0].edit_count, 2);
    assert!(snap2.files[0].changed_in_latest_turn);

    // Full diff is v0 -> v2.
    let diff = get_diff("ses_accum", "src/app.rs").unwrap();
    assert_eq!(diff.original_content, v0);
    assert_eq!(diff.modified_content, v2);
    assert_eq!(diff.additions, 3);
    assert_eq!(diff.deletions, 1);

    // Undo restores v0 verbatim!
    let undone = apply_action("ses_accum", FileChangeActionKind::Undo, Some("src/app.rs"), false).unwrap();
    assert!(undone.ok);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), v0);
    assert_eq!(undone.snapshot.total_pending_files, 0);
    assert_eq!(undone.snapshot.files[0].status, FileChangeStatus::Undone);
    assert!(undone.snapshot.files[0].can_redo);
}

#[test]
fn created_modified_deleted_and_renamed_undo_and_collision_detection() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    let ws = tempfile::tempdir().unwrap();
    let sid = "ses_kinds";
    begin_turn(sid);

    // 1. Created file -> undo removes it.
    let created = ws.path().join("new.txt");
    std::fs::write(&created, "hello\n").unwrap();
    record_mutation(FileMutationRecord {
        session_id: sid,
        working_dir: Some(ws.path()),
        path: &created,
        old_path: None,
        before_existed: false,
        before_bytes: None,
        before_exceeded_cap: false,
        before_mode: None,
        after_existed: true,
        after_bytes: Some(b"hello\n"),
        after_exceeded_cap: false,
        after_mode: None,
    })
    .unwrap();
    assert_eq!(
        apply_action(sid, FileChangeActionKind::Undo, Some("new.txt"), false)
            .unwrap()
            .ok,
        true
    );
    assert!(!created.exists());

    // 2. Modified file preserves Unix executable mode on restore.
    let script = ws.path().join("run.sh");
    let orig_script = b"#!/bin/sh\necho old\n";
    let new_script = b"#!/bin/sh\necho new\n";
    std::fs::write(&script, orig_script).unwrap();
    #[cfg(unix)]
    let orig_mode = {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        Some(0o100755u32)
    };
    #[cfg(not(unix))]
    let orig_mode = None;
    std::fs::write(&script, new_script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    record_mutation(mod_record(sid, ws.path(), &script, orig_script, new_script, orig_mode))
        .unwrap();
    let res = apply_action(sid, FileChangeActionKind::Undo, Some("run.sh"), false).unwrap();
    assert!(res.ok);
    assert_eq!(std::fs::read(&script).unwrap(), orig_script);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let restored_mode = std::fs::metadata(&script).unwrap().permissions().mode() & 0o777;
        assert_eq!(restored_mode, 0o755);
    }

    // 3. Deleted file -> undo recreates it.
    let deleted = ws.path().join("gone.txt");
    record_mutation(FileMutationRecord {
        session_id: sid,
        working_dir: Some(ws.path()),
        path: &deleted,
        old_path: None,
        before_existed: true,
        before_bytes: Some(b"precious\n"),
        before_exceeded_cap: false,
        before_mode: None,
        after_existed: false,
        after_bytes: None,
        after_exceeded_cap: false,
        after_mode: None,
    })
    .unwrap();
    assert!(!deleted.exists());
    let res = apply_action(sid, FileChangeActionKind::Undo, Some("gone.txt"), false).unwrap();
    assert!(res.ok);
    assert_eq!(std::fs::read_to_string(&deleted).unwrap(), "precious\n");

    // 4. Renamed file -> detects collision at old_path, reverses cleanly once clear.
    let old_p = ws.path().join("old_name.rs");
    let new_p = ws.path().join("new_name.rs");
    std::fs::write(&new_p, "fn moved() {}\n").unwrap();
    record_mutation(FileMutationRecord {
        session_id: sid,
        working_dir: Some(ws.path()),
        path: &new_p,
        old_path: Some(&old_p),
        before_existed: true,
        before_bytes: Some(b"fn orig() {}\n"),
        before_exceeded_cap: false,
        before_mode: None,
        after_existed: true,
        after_bytes: Some(b"fn moved() {}\n"),
        after_exceeded_cap: false,
        after_mode: None,
    })
    .unwrap();

    // Place an unrelated file at old_p -> non-forced undo MUST conflict and not overwrite!
    std::fs::write(&old_p, "unrelated user file\n").unwrap();
    let conflict = apply_action(sid, FileChangeActionKind::Undo, Some("new_name.rs"), false).unwrap();
    assert!(!conflict.ok);
    assert_eq!(conflict.conflicts.len(), 1);
    assert_eq!(
        std::fs::read_to_string(&old_p).unwrap(),
        "unrelated user file\n"
    );
    assert!(new_p.exists());

    // Remove the blocker -> non-forced undo now succeeds and reverses the rename!
    std::fs::remove_file(&old_p).unwrap();
    let ok = apply_action(sid, FileChangeActionKind::Undo, Some("new_name.rs"), false).unwrap();
    assert!(ok.ok);
    assert!(!new_p.exists());
    assert_eq!(std::fs::read_to_string(&old_p).unwrap(), "fn orig() {}\n");
}

#[test]
fn binary_roundtrip_and_ten_mib_cap() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    let ws = tempfile::tempdir().unwrap();
    let sid = "ses_bin";
    begin_turn(sid);

    let bin_file = ws.path().join("img.bin");
    let orig_bin: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x00, 0x01, 0x02];
    let new_bin: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xFE];
    std::fs::write(&bin_file, &new_bin).unwrap();
    let snap = record_mutation(mod_record(sid, ws.path(), &bin_file, &orig_bin, &new_bin, None)).unwrap();
    assert!(snap.files[0].is_binary);
    assert!(snap.files[0].undoable);
    assert_eq!(snap.files[0].additions, 0);
    assert_eq!(snap.files[0].deletions, 0);

    let diff = get_diff(sid, "img.bin").unwrap();
    assert!(diff.is_binary);
    assert!(diff.unified_diff.contains("Binary file"));

    // Undo and Redo binary round-trip
    assert!(
        apply_action(sid, FileChangeActionKind::Undo, Some("img.bin"), false)
            .unwrap()
            .ok
    );
    assert_eq!(std::fs::read(&bin_file).unwrap(), orig_bin);
    assert!(
        apply_action(sid, FileChangeActionKind::Redo, Some("img.bin"), false)
            .unwrap()
            .ok
    );
    assert_eq!(std::fs::read(&bin_file).unwrap(), new_bin);

    // >10 MiB file is recorded with undoable = false and never fails.
    let huge = ws.path().join("huge.dat");
    let huge_bytes = vec![b'a'; MAX_BLOB_BYTES + 1];
    std::fs::write(&huge, &huge_bytes).unwrap();
    let snap = record_mutation(FileMutationRecord {
        session_id: sid,
        working_dir: Some(ws.path()),
        path: &huge,
        old_path: None,
        before_existed: false,
        before_bytes: None,
        before_exceeded_cap: false,
        before_mode: None,
        after_existed: true,
        after_bytes: Some(&huge_bytes),
        after_exceeded_cap: false,
        after_mode: None,
    })
    .unwrap();
    let huge_entry = snap.files.iter().find(|f| f.display_path == "huge.dat").unwrap();
    assert!(!huge_entry.undoable);
    assert!(!huge_entry.can_redo);
    let huge_diff = get_diff(sid, "huge.dat").unwrap();
    assert!(huge_diff.original_content.is_empty());
    assert!(huge_diff.modified_content.is_empty());
    assert!(huge_diff.hunks.is_empty());
    assert!(huge_diff.unified_diff.contains("10 MiB snapshot limit"));
    let undo_huge = apply_action(sid, FileChangeActionKind::Undo, Some("huge.dat"), false).unwrap();
    assert!(!undo_huge.ok);
    assert_eq!(undo_huge.conflicts.len(), 1);

    // Redo on a Pending entry returns ok=false without a misleading manual-edit conflict.
    let redo_pending =
        apply_action(sid, FileChangeActionKind::Redo, Some("img.bin"), false).unwrap();
    assert!(!redo_pending.ok);
    assert!(redo_pending.conflicts.is_empty());
}

#[test]
fn non_git_and_dirty_working_tree_preserved_on_undo() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    // Plain non-git temp dir with pre-existing dirty user edits before AI touched the file.
    let ws = tempfile::tempdir().unwrap();
    let file = ws.path().join("notes.md");
    let pre_existing_dirty = "user uncommitted edit 1\nkeep me\nuser uncommitted edit 2\n";
    let ai_edited = "user uncommitted edit 1\nai changed this\nuser uncommitted edit 2\n";
    std::fs::write(&file, ai_edited).unwrap();

    record_mutation(mod_record(
        "ses_nongit",
        ws.path(),
        &file,
        pre_existing_dirty.as_bytes(),
        ai_edited.as_bytes(),
        None,
    ))
    .unwrap();

    let undone = apply_action("ses_nongit", FileChangeActionKind::Undo, Some("notes.md"), false).unwrap();
    assert!(undone.ok);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), pre_existing_dirty);
}

#[test]
fn manual_post_turn_edit_clean_reverse_hunk_vs_conflict_vs_force() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    let ws = tempfile::tempdir().unwrap();
    let sid = "ses_manual";
    let file = ws.path().join("doc.txt");

    let base: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    let ai_post = base.replace("line 15\n", "ai edited 15\n");
    std::fs::write(&file, &ai_post).unwrap();

    begin_turn(sid);
    record_mutation(mod_record(
        sid,
        ws.path(),
        &file,
        base.as_bytes(),
        ai_post.as_bytes(),
        None,
    ))
    .unwrap();

    // Non-overlapping manual edit at top of file (shifts line numbers!).
    let manual_non_overlapping = format!("manual header A\nmanual header B\n{ai_post}");
    std::fs::write(&file, &manual_non_overlapping).unwrap();

    let clean_undo = apply_action(sid, FileChangeActionKind::Undo, Some("doc.txt"), false).unwrap();
    assert!(clean_undo.ok, "expected clean reverse-hunk undo: {clean_undo:?}");
    let after_undo = std::fs::read_to_string(&file).unwrap();
    assert!(after_undo.starts_with("manual header A\nmanual header B\n"));
    assert!(after_undo.contains("line 15\n"));
    assert!(!after_undo.contains("ai edited 15\n"));

    // Now test overlapping manual edit conflict + force override.
    let sid2 = "ses_conflict";
    let file2 = ws.path().join("conflict.txt");
    std::fs::write(&file2, &ai_post).unwrap();
    begin_turn(sid2);
    record_mutation(mod_record(
        sid2,
        ws.path(),
        &file2,
        base.as_bytes(),
        ai_post.as_bytes(),
        None,
    ))
    .unwrap();

    let manual_overlapping = ai_post.replace("ai edited 15\n", "user rewrote 15\n");
    std::fs::write(&file2, &manual_overlapping).unwrap();

    let conflict = apply_action(sid2, FileChangeActionKind::Undo, Some("conflict.txt"), false).unwrap();
    assert!(!conflict.ok);
    assert_eq!(conflict.conflicts.len(), 1);
    // Disk MUST remain untouched on conflict!
    assert_eq!(std::fs::read_to_string(&file2).unwrap(), manual_overlapping);

    // With force = true, baseline is restored verbatim.
    let forced = apply_action(sid2, FileChangeActionKind::Undo, Some("conflict.txt"), true).unwrap();
    assert!(forced.ok);
    assert_eq!(std::fs::read_to_string(&file2).unwrap(), base);
}

#[test]
fn interleaved_manual_edit_between_turn_1_and_turn_2_is_preserved_on_undo() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    let ws = tempfile::tempdir().unwrap();
    let sid = "ses_interleaved";
    let file = ws.path().join("code.rs");

    let base: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    // Turn 1: AI edits line 3.
    let turn1 = base.replace("line 3\n", "ai turn1 line 3\n");
    std::fs::write(&file, &turn1).unwrap();
    begin_turn(sid);
    record_mutation(mod_record(
        sid,
        ws.path(),
        &file,
        base.as_bytes(),
        turn1.as_bytes(),
        None,
    ))
    .unwrap();

    // User manually edits line 18 between Turn 1 and Turn 2!
    let manual_interleaved = turn1.replace("line 18\n", "user manual line 18\n");
    std::fs::write(&file, &manual_interleaved).unwrap();

    // Turn 2: AI edits line 10 (seeing user's manual line 18 on disk).
    let turn2 = manual_interleaved.replace("line 10\n", "ai turn2 line 10\n");
    std::fs::write(&file, &turn2).unwrap();
    begin_turn(sid);
    record_mutation(mod_record(
        sid,
        ws.path(),
        &file,
        manual_interleaved.as_bytes(),
        turn2.as_bytes(),
        None,
    ))
    .unwrap();

    // Undo (non-forced) MUST reverse Turn 2 and Turn 1 while PRESERVING user manual line 18!
    let res = apply_action(sid, FileChangeActionKind::Undo, Some("code.rs"), false).unwrap();
    assert!(res.ok, "interleaved undo should reverse both AI steps cleanly: {res:?}");
    let disk = std::fs::read_to_string(&file).unwrap();
    assert!(disk.contains("line 3\n"));
    assert!(disk.contains("line 10\n"));
    assert!(disk.contains("user manual line 18\n"));
    assert!(!disk.contains("ai turn1 line 3\n"));
    assert!(!disk.contains("ai turn2 line 10\n"));
}

#[test]
fn undo_redo_keep_roundtrip_and_persistence_across_cache_eviction() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    let ws = tempfile::tempdir().unwrap();
    let sid = "ses_persist";
    let file = ws.path().join("README.md");

    let old = "# Title\nold body\n";
    let new = "# Title\nnew body\nextra\n";
    std::fs::write(&file, new).unwrap();
    begin_turn(sid);
    record_mutation(mod_record(sid, ws.path(), &file, old.as_bytes(), new.as_bytes(), None))
        .unwrap();

    // Evict in-memory cache to prove full disk persistence & reload.
    evict_session_cache(sid);
    let reloaded = snapshot_for_session(sid);
    assert_eq!(reloaded.session_id, sid);
    assert_eq!(reloaded.latest_turn_id, 1);
    assert_eq!(reloaded.total_pending_files, 1);
    assert_eq!(reloaded.total_additions, 2);
    assert_eq!(reloaded.total_deletions, 1);

    // Undo -> Redo -> Keep round-trip across reloads.
    let undo_resp = apply_action(sid, FileChangeActionKind::UndoAll, None, false).unwrap();
    assert!(undo_resp.ok);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
    assert_eq!(undo_resp.snapshot.files[0].status, FileChangeStatus::Undone);
    assert!(undo_resp.snapshot.files[0].can_redo);

    evict_session_cache(sid);
    let redo_resp = apply_action(sid, FileChangeActionKind::RedoAll, None, false).unwrap();
    assert!(redo_resp.ok);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), new);
    assert_eq!(redo_resp.snapshot.files[0].status, FileChangeStatus::Pending);
    assert_eq!(redo_resp.snapshot.total_pending_files, 1);

    let keep_resp = apply_action(sid, FileChangeActionKind::KeepAll, None, false).unwrap();
    assert!(keep_resp.ok);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), new);
    assert_eq!(keep_resp.snapshot.total_pending_files, 0);
    assert_eq!(keep_resp.snapshot.files[0].status, FileChangeStatus::Kept);

    // Cleanup removes session directory cleanly.
    delete_session_file_changes(sid).unwrap();
    assert!(snapshot_for_session(sid).is_empty());
}

#[test]
fn preview_hunks_truncate_at_80_lines_while_get_diff_is_uncapped() {
    let _lock = crate::storage::lock_test_env();
    let _home = HomeSandbox::new();
    let ws = tempfile::tempdir().unwrap();
    let sid = "ses_preview";
    let file = ws.path().join("big.txt");

    let new_text: String = (1..=150).map(|i| format!("line {i}\n")).collect();
    std::fs::write(&file, &new_text).unwrap();
    begin_turn(sid);
    let snap = record_mutation(FileMutationRecord {
        session_id: sid,
        working_dir: Some(ws.path()),
        path: &file,
        old_path: None,
        before_existed: false,
        before_bytes: None,
        before_exceeded_cap: false,
        before_mode: None,
        after_existed: true,
        after_bytes: Some(new_text.as_bytes()),
        after_exceeded_cap: false,
        after_mode: None,
    })
    .unwrap();

    let summary = &snap.files[0];
    assert!(summary.preview_truncated);
    let preview_line_count: usize = summary.preview_hunks.iter().map(|h| h.lines.len()).sum();
    assert_eq!(preview_line_count, PREVIEW_MAX_LINES);
    assert_eq!(summary.additions, 150);

    let full = get_diff(sid, "big.txt").unwrap();
    let full_line_count: usize = full.hunks.iter().map(|h| h.lines.len()).sum();
    assert_eq!(full_line_count, 150);
    assert_eq!(full.modified_content, new_text);
}
