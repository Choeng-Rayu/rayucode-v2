//! App-level File Changes Review state, local/remote dispatch, overlay
//! interaction, card click handling, and `/changes`, `/keep`, `/undo`, `/redo`
//! slash commands.

use super::*;
use crate::file_changes::{
    FileChangeActionKind, FileChangeActionResponse, FileChangeDiffPayload, FileChangeStatus,
    FileChangesSnapshot, affected_paths_for_action, apply_action, get_diff, snapshot_for_session,
};
use crate::tui::file_review_overlay::{
    FileReviewOverlayState, OverlayHitTarget, overlay_hit_target_at, overlay_max_diff_scroll,
    overlay_point_in_file_list,
};
use crate::tui::ui::file_changes_card::FileChangeHitTarget;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Outbound remote file-change request queued from synchronous UI handlers
/// (mouse clicks, overlay keys, local command fallback) and flushed by the
/// async remote event loop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum PendingRemoteFileChangeRequest {
    GetFileChanges,
    GetFileChangeDiff {
        path: String,
    },
    FileChangeAction {
        action: FileChangeActionKind,
        path: Option<String>,
        force: bool,
    },
}

/// Parsed slash command for `/changes`, `/keep`, `/undo`, `/redo`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ParsedFileChangeCommand {
    OpenOverlay {
        path: Option<String>,
    },
    Action {
        action: FileChangeActionKind,
        path: Option<String>,
        force: bool,
    },
    UndoMostRecent {
        force: bool,
    },
}

/// Per-path mutex registry for local mode mutations so concurrent file-change
/// actions on the same paths serialize in deterministic sorted order.
type LocalPathLockMap = Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>;

fn local_file_locks() -> &'static LocalPathLockMap {
    static LOCKS: OnceLock<LocalPathLockMap> = OnceLock::new();
    LOCKS.get_or_init(Default::default)
}

fn lock_local_paths(paths: Vec<PathBuf>) -> Vec<Arc<Mutex<()>>> {
    let mut keys: Vec<PathBuf> = paths
        .into_iter()
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
        .collect();
    keys.sort();
    keys.dedup();
    let mut map = local_file_locks()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    map.retain(|_, m| Arc::strong_count(m) > 1);
    keys.into_iter()
        .map(|k| map.entry(k).or_default().clone())
        .collect()
}

fn strip_surrounding_quotes(s: &str) -> &str {
    let s = s.trim();
    if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')))
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Parse `/changes`, `/keep`, `/undo`, or `/redo` slash commands.
/// Returns `None` if `trimmed` is not one of those commands.
pub(crate) fn parse_file_change_command(
    trimmed: &str,
) -> Option<std::result::Result<ParsedFileChangeCommand, String>> {
    let mut words = trimmed.split_whitespace();
    let cmd = words.next()?;
    let rest = trimmed[cmd.len()..].trim();

    match cmd {
        "/changes" => {
            let path = if rest.is_empty() {
                None
            } else {
                Some(strip_surrounding_quotes(rest).to_string())
            };
            Some(Ok(ParsedFileChangeCommand::OpenOverlay { path }))
        }
        "/keep" => {
            if rest.is_empty() || rest.eq_ignore_ascii_case("all") {
                Some(Ok(ParsedFileChangeCommand::Action {
                    action: FileChangeActionKind::KeepAll,
                    path: None,
                    force: false,
                }))
            } else {
                Some(Ok(ParsedFileChangeCommand::Action {
                    action: FileChangeActionKind::Keep,
                    path: Some(strip_surrounding_quotes(rest).to_string()),
                    force: false,
                }))
            }
        }
        "/undo" => {
            let (force, arg) = extract_force_flag(rest);
            if arg.is_empty() {
                Some(Ok(ParsedFileChangeCommand::UndoMostRecent { force }))
            } else if arg.eq_ignore_ascii_case("all") {
                Some(Ok(ParsedFileChangeCommand::Action {
                    action: FileChangeActionKind::UndoAll,
                    path: None,
                    force,
                }))
            } else {
                Some(Ok(ParsedFileChangeCommand::Action {
                    action: FileChangeActionKind::Undo,
                    path: Some(strip_surrounding_quotes(arg).to_string()),
                    force,
                }))
            }
        }
        "/redo" => {
            let (force, arg) = extract_force_flag(rest);
            if arg.is_empty() || arg.eq_ignore_ascii_case("all") {
                Some(Ok(ParsedFileChangeCommand::Action {
                    action: FileChangeActionKind::RedoAll,
                    path: None,
                    force,
                }))
            } else {
                Some(Ok(ParsedFileChangeCommand::Action {
                    action: FileChangeActionKind::Redo,
                    path: Some(strip_surrounding_quotes(arg).to_string()),
                    force,
                }))
            }
        }
        _ => None,
    }
}

fn extract_force_flag(rest: &str) -> (bool, &str) {
    let trimmed = rest.trim();
    if trimmed == "--force" || trimmed == "-f" {
        return (true, "");
    }
    if let Some(after) = trimmed.strip_prefix("--force ") {
        return (true, after.trim());
    }
    if let Some(after) = trimmed.strip_prefix("-f ") {
        return (true, after.trim());
    }
    if let Some(before) = trimmed.strip_suffix(" --force") {
        return (true, before.trim());
    }
    if let Some(before) = trimmed.strip_suffix(" -f") {
        return (true, before.trim());
    }
    (false, trimmed)
}

/// Whether `(code, modifiers)` is the `Alt+R` review overlay shortcut (including
/// macOS Option+R `®`).
pub(super) fn is_file_review_hotkey(code: KeyCode, modifiers: KeyModifiers) -> bool {
    if modifiers == KeyModifiers::ALT && matches!(code, KeyCode::Char('r' | 'R')) {
        return true;
    }
    crate::tui::keybind::shortcut_char_for_macos_option_key(code, modifiers)
        .is_some_and(|ch| ch.eq_ignore_ascii_case(&'r'))
}

impl App {
    pub(super) fn bump_file_changes_version(&mut self) {
        self.file_changes_version = self.file_changes_version.wrapping_add(1);
    }

    pub(super) fn has_file_changes(&self) -> bool {
        self.file_changes.as_ref().is_some_and(|s| !s.is_empty())
    }

    pub(super) fn file_changes_card_expanded_state(&self) -> bool {
        let Some(snapshot) = self.file_changes.as_ref().filter(|s| !s.is_empty()) else {
            return false;
        };
        if snapshot.total_pending_files == 0 {
            return self.file_changes_receipt_expanded;
        }
        match self.file_changes_card_override {
            Some((for_processing, expanded)) if for_processing == self.is_processing => expanded,
            _ => !self.is_processing,
        }
    }

    pub(super) fn clear_file_changes_state(&mut self) {
        self.file_changes = None;
        self.expanded_file_change_paths.clear();
        self.file_changes_receipt_expanded = false;
        self.file_changes_card_override = None;
        self.file_review_overlay = None;
        self.pending_remote_file_change_requests.clear();
        self.pending_remote_file_change_request_ids.clear();
        self.bump_file_changes_version();
    }

    pub(super) fn apply_file_changes_snapshot(&mut self, snapshot: FileChangesSnapshot) {
        let had_pending = self
            .file_changes
            .as_ref()
            .is_some_and(|s| s.total_pending_files > 0);
        if snapshot.is_empty() {
            self.file_changes = None;
            self.expanded_file_change_paths.clear();
            self.file_changes_receipt_expanded = false;
            self.file_changes_card_override = None;
        } else {
            // Prune expanded paths that no longer exist in the snapshot.
            let valid_paths: HashSet<&str> =
                snapshot.files.iter().map(|f| f.path.as_str()).collect();
            self.expanded_file_change_paths
                .retain(|p| valid_paths.contains(p.as_str()));
            if had_pending && snapshot.total_pending_files == 0 {
                // Auto-collapse into the quiet 1-line receipt once all pending files resolve.
                self.file_changes_receipt_expanded = false;
                self.file_changes_card_override = None;
            } else if !had_pending && snapshot.total_pending_files > 0 {
                // Reset any stale override when pending changes newly appear (or after Redo).
                self.file_changes_card_override = None;
            }
            self.file_changes = Some(snapshot);
        }
        if let Some(overlay) = self.file_review_overlay.as_mut() {
            overlay.sync_with_snapshot(self.file_changes.as_ref());
            // Invalidate cached loaded_diff if the selected file changed status/content.
            if let Some(selected_path) = overlay.selected_path.clone() {
                if overlay
                    .loaded_diff
                    .as_ref()
                    .is_some_and(|d| d.path != selected_path)
                {
                    overlay.loaded_diff = None;
                }
            }
        }
        self.bump_file_changes_version();
    }

    pub(super) fn apply_file_change_diff(&mut self, diff: FileChangeDiffPayload) {
        let path = diff.path.clone();
        if let Some(overlay) = self.file_review_overlay.as_mut() {
            if overlay.selected_path.as_deref() == Some(path.as_str())
                || overlay.loading_path.as_deref() == Some(path.as_str())
            {
                overlay.selected_path = Some(path);
                overlay.loaded_diff = Some(diff);
                overlay.loading_path = None;
                overlay.error_message = None;
            }
        }
    }

    pub(super) fn handle_remote_file_change_error(&mut self, message: &str) {
        self.set_status_notice(format!("File change error: {message}"));
        if let Some(overlay) = self.file_review_overlay.as_mut() {
            overlay.loading_path = None;
            overlay.error_message = Some(message.to_string());
        } else {
            self.push_display_message(DisplayMessage::error(format!(
                "File change error: {message}"
            )));
        }
    }

    pub(super) fn file_change_suggestion_candidates(
        &self,
        input: &str,
    ) -> Option<Vec<(String, &'static str)>> {
        let lower = input.to_lowercase();
        let (base, want_all, filter_kind) = if lower.starts_with("/keep ") {
            ("/keep", true, 0u8)
        } else if lower.starts_with("/undo --force ") {
            ("/undo --force", true, 1u8)
        } else if lower.starts_with("/undo -f ") {
            ("/undo -f", true, 1u8)
        } else if lower.starts_with("/undo ") {
            ("/undo", true, 1u8)
        } else if lower.starts_with("/redo ") {
            ("/redo", true, 2u8)
        } else if lower.starts_with("/changes ") {
            ("/changes", false, 3u8)
        } else {
            return None;
        };

        let mut suggestions: Vec<(String, &'static str)> = Vec::new();
        if want_all {
            let desc = match filter_kind {
                0 => "Keep all pending file changes",
                1 => "Undo all pending file changes",
                _ => "Redo all undone file changes",
            };
            suggestions.push((format!("{base} all"), desc));
        }
        if base == "/undo" {
            suggestions.push((
                "/undo --force ".to_string(),
                "Force undo even if modified externally",
            ));
        }
        if let Some(snapshot) = self.file_changes.as_ref() {
            for entry in &snapshot.files {
                let include = match filter_kind {
                    0 | 1 => entry.status == FileChangeStatus::Pending,
                    2 => entry.status == FileChangeStatus::Undone && entry.can_redo,
                    _ => true,
                };
                if include {
                    let arg = if entry.display_path.contains(' ') {
                        format!("\"{}\"", entry.display_path)
                    } else {
                        entry.display_path.clone()
                    };
                    let desc = match filter_kind {
                        0 => "Keep this file change",
                        1 => "Undo this file change",
                        2 => "Redo this file change",
                        _ => "Inspect diff in file review overlay",
                    };
                    suggestions.push((format!("{base} {arg}"), desc));
                }
            }
        }
        Some(suggestions)
    }

    pub(super) fn apply_file_change_action_response(
        &mut self,
        response: FileChangeActionResponse,
        attempted_action: Option<(FileChangeActionKind, Option<String>)>,
    ) {
        self.apply_file_changes_snapshot(response.snapshot);
        if !response.conflicts.is_empty() {
            let first = &response.conflicts[0];
            let conflict_notice = format!(
                "Conflict on {}: {} (use /undo --force or press f in Alt+R overlay)",
                first.display_path, first.reason
            );
            self.set_status_notice(conflict_notice.clone());
            if let Some(overlay) = self.file_review_overlay.as_mut() {
                overlay.conflicts = response.conflicts.clone();
                overlay.conflict_action = attempted_action.or_else(|| {
                    Some((FileChangeActionKind::Undo, Some(first.path.clone())))
                });
                overlay.status_message = None;
                overlay.error_message = None;
            } else {
                self.push_display_message(DisplayMessage::system(format!(
                    "⚠ {conflict_notice}"
                )));
            }
        } else {
            if let Some(overlay) = self.file_review_overlay.as_mut() {
                overlay.conflicts.clear();
                overlay.conflict_action = None;
                overlay.error_message = None;
                overlay.status_message = Some(response.message.clone());
            }
            if !response.message.is_empty() {
                self.set_status_notice(response.message);
            }
        }
    }

    /// Local mode: refresh `self.file_changes` from the persistent store.
    pub(super) fn refresh_local_file_changes(&mut self) {
        if self.is_remote {
            return;
        }
        let snapshot = snapshot_for_session(&self.session.id);
        if !snapshot.is_empty() || self.file_changes.is_some() {
            self.apply_file_changes_snapshot(snapshot);
        }
    }

    pub(super) fn request_file_changes_refresh(&mut self) {
        if self.is_remote {
            self.pending_remote_file_change_requests
                .push_back(PendingRemoteFileChangeRequest::GetFileChanges);
        } else {
            self.refresh_local_file_changes();
        }
    }

    pub(super) fn request_file_change_diff(&mut self, path: String) {
        if let Some(overlay) = self.file_review_overlay.as_mut() {
            overlay.loading_path = Some(path.clone());
            overlay.error_message = None;
        }
        if self.is_remote {
            self.pending_remote_file_change_requests
                .push_back(PendingRemoteFileChangeRequest::GetFileChangeDiff { path });
        } else {
            match get_diff(&self.session.id, &path) {
                Ok(diff) => self.apply_file_change_diff(diff),
                Err(error) => {
                    if let Some(overlay) = self.file_review_overlay.as_mut() {
                        overlay.loading_path = None;
                        overlay.error_message = Some(error.to_string());
                    }
                    self.set_status_notice(format!("Diff unavailable: {error}"));
                }
            }
        }
    }

    pub(super) fn trigger_file_change_action(
        &mut self,
        action: FileChangeActionKind,
        path: Option<String>,
        force: bool,
    ) {
        if self.is_processing {
            let msg = "Cannot modify file changes while a turn is processing.";
            self.set_status_notice(msg);
            if let Some(overlay) = self.file_review_overlay.as_mut() {
                overlay.error_message = Some(msg.to_string());
            }
            return;
        }

        if let Some(overlay) = self.file_review_overlay.as_mut() {
            overlay.conflict_action = Some((action, path.clone()));
            overlay.error_message = None;
        }

        if self.is_remote {
            self.pending_remote_file_change_requests.push_back(
                PendingRemoteFileChangeRequest::FileChangeAction {
                    action,
                    path,
                    force,
                },
            );
            return;
        }

        let affected = affected_paths_for_action(&self.session.id, action, path.as_deref());
        let mutexes = lock_local_paths(affected);
        let _guards: Vec<_> = mutexes
            .iter()
            .map(|m| m.lock().unwrap_or_else(|p| p.into_inner()))
            .collect();

        match apply_action(&self.session.id, action, path.as_deref(), force) {
            Ok(response) => {
                self.apply_file_change_action_response(response, Some((action, path.clone())));
                if let Some(selected_path) = self
                    .file_review_overlay
                    .as_ref()
                    .and_then(|o| o.selected_path.clone())
                {
                    self.request_file_change_diff(selected_path);
                }
            }
            Err(error) => {
                let msg = error.to_string();
                self.set_status_notice(format!("File change action failed: {msg}"));
                if let Some(overlay) = self.file_review_overlay.as_mut() {
                    overlay.error_message = Some(msg);
                }
            }
        }
    }

    pub(super) fn open_file_review_overlay(&mut self, initial_path: Option<&str>) {
        if !self.is_remote {
            self.refresh_local_file_changes();
        } else {
            self.request_file_changes_refresh();
        }
        let state = FileReviewOverlayState::new(self.file_changes.as_ref(), initial_path);
        let load_target = state.selected_path.clone();
        self.file_review_overlay = Some(state);
        if let Some(path) = load_target {
            self.request_file_change_diff(path);
        }
        self.request_full_repaint();
    }

    pub(super) fn toggle_file_review_overlay(&mut self) {
        if self.file_review_overlay.is_some() {
            self.file_review_overlay = None;
            self.request_full_repaint();
        } else {
            self.open_file_review_overlay(None);
        }
    }

    pub(super) fn handle_file_change_card_click(&mut self, target: FileChangeHitTarget) {
        match target {
            FileChangeHitTarget::ExpandRow(path) => {
                if !self.expanded_file_change_paths.remove(&path) {
                    self.expanded_file_change_paths.insert(path);
                }
                self.bump_file_changes_version();
                self.request_full_repaint();
            }
            FileChangeHitTarget::OpenDiff(path) => {
                self.open_file_review_overlay(Some(&path));
            }
            FileChangeHitTarget::KeepFile(path) => {
                self.trigger_file_change_action(FileChangeActionKind::Keep, Some(path), false);
            }
            FileChangeHitTarget::UndoFile(path) => {
                self.trigger_file_change_action(FileChangeActionKind::Undo, Some(path), false);
            }
            FileChangeHitTarget::RedoFile(path) => {
                self.trigger_file_change_action(FileChangeActionKind::Redo, Some(path), false);
            }
            FileChangeHitTarget::KeepAll => {
                self.trigger_file_change_action(FileChangeActionKind::KeepAll, None, false);
            }
            FileChangeHitTarget::UndoAll => {
                self.trigger_file_change_action(FileChangeActionKind::UndoAll, None, false);
            }
            FileChangeHitTarget::RedoAll => {
                self.trigger_file_change_action(FileChangeActionKind::RedoAll, None, false);
            }
            FileChangeHitTarget::ToggleCollapse => {
                let is_resolved = self
                    .file_changes
                    .as_ref()
                    .is_some_and(|s| !s.is_empty() && s.total_pending_files == 0);
                if is_resolved {
                    self.file_changes_receipt_expanded = !self.file_changes_receipt_expanded;
                } else {
                    let next = !self.file_changes_card_expanded_state();
                    self.file_changes_card_override = Some((self.is_processing, next));
                }
                self.bump_file_changes_version();
                self.request_full_repaint();
            }
        }
    }

    pub(super) fn scroll_file_review_overlay(&mut self, direction: i16) -> bool {
        let Some(overlay) = self.file_review_overlay.as_mut() else {
            return false;
        };
        let max_scroll = overlay_max_diff_scroll();
        if direction < 0 {
            overlay.diff_scroll = overlay.diff_scroll.saturating_sub(3);
        } else {
            overlay.diff_scroll = overlay.diff_scroll.saturating_add(3).min(max_scroll);
        }
        true
    }

    pub(super) fn handle_file_review_overlay_mouse(&mut self, mouse: MouseEvent) -> bool {
        if self.file_review_overlay.is_none() {
            return false;
        }
        match mouse.kind {
            MouseEventKind::ScrollUp => {
                if overlay_point_in_file_list(mouse.column, mouse.row) {
                    let next_path = self
                        .file_review_overlay
                        .as_mut()
                        .and_then(|o| o.step_selection(self.file_changes.as_ref(), -1));
                    if let Some(path) = next_path {
                        self.request_file_change_diff(path);
                    }
                } else {
                    self.enqueue_mouse_scroll(MouseScrollTarget::FileReviewOverlay, -1);
                }
                true
            }
            MouseEventKind::ScrollDown => {
                if overlay_point_in_file_list(mouse.column, mouse.row) {
                    let next_path = self
                        .file_review_overlay
                        .as_mut()
                        .and_then(|o| o.step_selection(self.file_changes.as_ref(), 1));
                    if let Some(path) = next_path {
                        self.request_file_change_diff(path);
                    }
                } else {
                    self.enqueue_mouse_scroll(MouseScrollTarget::FileReviewOverlay, 1);
                }
                true
            }
            MouseEventKind::Up(MouseButton::Left) => {
                if let Some(target) = overlay_hit_target_at(mouse.column, mouse.row) {
                    self.apply_overlay_hit_target(target);
                }
                true
            }
            _ => true,
        }
    }

    fn apply_overlay_hit_target(&mut self, target: OverlayHitTarget) {
        let selected_path = self
            .file_review_overlay
            .as_ref()
            .and_then(|o| o.selected_entry(self.file_changes.as_ref()))
            .map(|e| e.path.clone());
        match target {
            OverlayHitTarget::SelectFile(idx) => {
                let path = self
                    .file_review_overlay
                    .as_mut()
                    .and_then(|o| o.select_index(self.file_changes.as_ref(), idx));
                if let Some(path) = path {
                    self.request_file_change_diff(path);
                }
            }
            OverlayHitTarget::KeepSelected => {
                if let Some(path) = selected_path {
                    self.trigger_file_change_action(FileChangeActionKind::Keep, Some(path), false);
                }
            }
            OverlayHitTarget::UndoSelected => {
                if let Some(path) = selected_path {
                    self.trigger_file_change_action(FileChangeActionKind::Undo, Some(path), false);
                }
            }
            OverlayHitTarget::RedoSelected => {
                if let Some(path) = selected_path {
                    self.trigger_file_change_action(FileChangeActionKind::Redo, Some(path), false);
                }
            }
            OverlayHitTarget::KeepAll => {
                self.trigger_file_change_action(FileChangeActionKind::KeepAll, None, false);
            }
            OverlayHitTarget::UndoAll => {
                self.trigger_file_change_action(FileChangeActionKind::UndoAll, None, false);
            }
            OverlayHitTarget::RedoAll => {
                self.trigger_file_change_action(FileChangeActionKind::RedoAll, None, false);
            }
            OverlayHitTarget::ForceConflict => {
                self.force_apply_overlay_conflict();
            }
            OverlayHitTarget::OpenInEditor => {
                self.open_selected_file_in_editor();
            }
            OverlayHitTarget::Close => {
                self.file_review_overlay = None;
                self.request_full_repaint();
            }
        }
    }

    fn force_apply_overlay_conflict(&mut self) {
        let pending = self.file_review_overlay.as_ref().and_then(|o| {
            if o.conflicts.is_empty() {
                None
            } else {
                o.conflict_action.clone().or_else(|| {
                    o.conflicts
                        .first()
                        .map(|c| (FileChangeActionKind::Undo, Some(c.path.clone())))
                })
            }
        });
        if let Some((action, path)) = pending {
            self.trigger_file_change_action(action, path, true);
        }
    }

    fn open_selected_file_in_editor(&mut self) {
        if crate::tui::is_ssh_remote() {
            if let Some(overlay) = self.file_review_overlay.as_mut() {
                overlay.error_message =
                    Some("Opening remote files in a local editor is unavailable in SSH mode.".into());
            }
            return;
        }
        let Some(path) = self
            .file_review_overlay
            .as_ref()
            .and_then(|o| o.selected_entry(self.file_changes.as_ref()))
            .map(|e| e.path.clone())
        else {
            return;
        };
        if !Path::new(&path).exists() {
            if let Some(overlay) = self.file_review_overlay.as_mut() {
                overlay.error_message = Some(format!("File does not exist on disk: {path}"));
            }
            return;
        }
        let editor = std::env::var("VISUAL")
            .or_else(|_| std::env::var("EDITOR"))
            .unwrap_or_else(|_| "nano".to_string());
        let mut parts = editor.split_whitespace();
        let Some(bin) = parts.next() else {
            if let Some(overlay) = self.file_review_overlay.as_mut() {
                overlay.error_message = Some("$VISUAL/$EDITOR is empty".into());
            }
            return;
        };
        let extra: Vec<&str> = parts.collect();
        let mut command = std::process::Command::new(bin);
        command.args(&extra).arg(&path);
        match super::commands::run_interactive_editor(&mut command) {
            Ok(status) if status.success() => {
                self.force_full_redraw = true;
                self.set_status_notice(format!("Closed editor for {path}"));
                self.request_file_change_diff(path);
            }
            Ok(status) => {
                self.force_full_redraw = true;
                if let Some(overlay) = self.file_review_overlay.as_mut() {
                    overlay.error_message =
                        Some(format!("Editor '{editor}' exited with status {status}"));
                }
            }
            Err(error) => {
                self.force_full_redraw = true;
                if let Some(overlay) = self.file_review_overlay.as_mut() {
                    overlay.error_message = Some(format!("Failed to launch '{editor}': {error}"));
                }
            }
        }
    }

    pub(super) fn handle_file_review_overlay_key(
        &mut self,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> Result<bool> {
        if self.file_review_overlay.is_none() {
            return Ok(false);
        }

        // Alt+R toggles the overlay closed cleanly.
        if is_file_review_hotkey(code, modifiers) {
            self.file_review_overlay = None;
            self.request_full_repaint();
            return Ok(true);
        }

        let ctrl = modifiers.contains(KeyModifiers::CONTROL);
        let shift = modifiers.contains(KeyModifiers::SHIFT);

        match code {
            KeyCode::Esc | KeyCode::Char('q') if !ctrl => {
                self.file_review_overlay = None;
                self.request_full_repaint();
            }
            KeyCode::Down | KeyCode::Tab | KeyCode::Char('j') if !ctrl => {
                let next_path = self
                    .file_review_overlay
                    .as_mut()
                    .and_then(|o| o.step_selection(self.file_changes.as_ref(), 1));
                if let Some(path) = next_path {
                    self.request_file_change_diff(path);
                }
            }
            KeyCode::Up | KeyCode::BackTab if !ctrl => {
                let prev_path = self
                    .file_review_overlay
                    .as_mut()
                    .and_then(|o| o.step_selection(self.file_changes.as_ref(), -1));
                if let Some(path) = prev_path {
                    self.request_file_change_diff(path);
                }
            }
            KeyCode::Char('j') if ctrl => {
                let next_path = self
                    .file_review_overlay
                    .as_mut()
                    .and_then(|o| o.step_selection(self.file_changes.as_ref(), 1));
                if let Some(path) = next_path {
                    self.request_file_change_diff(path);
                }
            }
            KeyCode::Char('k') if ctrl => {
                let prev_path = self
                    .file_review_overlay
                    .as_mut()
                    .and_then(|o| o.step_selection(self.file_changes.as_ref(), -1));
                if let Some(path) = prev_path {
                    self.request_file_change_diff(path);
                }
            }
            KeyCode::PageDown | KeyCode::Char(' ') => {
                let max_scroll = overlay_max_diff_scroll();
                if let Some(o) = self.file_review_overlay.as_mut() {
                    o.scroll_diff(12);
                    if max_scroll > 0 {
                        o.diff_scroll = o.diff_scroll.min(max_scroll);
                    }
                }
            }
            KeyCode::PageUp => {
                if let Some(o) = self.file_review_overlay.as_mut() {
                    o.scroll_diff(-12);
                }
            }
            KeyCode::Char('d') if ctrl => {
                let max_scroll = overlay_max_diff_scroll();
                if let Some(o) = self.file_review_overlay.as_mut() {
                    o.scroll_diff(12);
                    if max_scroll > 0 {
                        o.diff_scroll = o.diff_scroll.min(max_scroll);
                    }
                }
            }
            KeyCode::Char('u') if ctrl => {
                if let Some(o) = self.file_review_overlay.as_mut() {
                    o.scroll_diff(-12);
                }
            }
            KeyCode::Home | KeyCode::Char('g') if !ctrl => {
                if let Some(o) = self.file_review_overlay.as_mut() {
                    o.diff_scroll = 0;
                }
            }
            KeyCode::End | KeyCode::Char('G') if !ctrl => {
                let max_scroll = overlay_max_diff_scroll();
                if let Some(o) = self.file_review_overlay.as_mut() {
                    o.diff_scroll = max_scroll;
                }
            }
            KeyCode::Char('K') | KeyCode::Char('k') if shift && !ctrl => {
                self.trigger_file_change_action(FileChangeActionKind::KeepAll, None, false);
            }
            KeyCode::Char('K') if !ctrl => {
                self.trigger_file_change_action(FileChangeActionKind::KeepAll, None, false);
            }
            KeyCode::Char('k') if !ctrl => {
                if let Some(path) = self
                    .file_review_overlay
                    .as_ref()
                    .and_then(|o| o.selected_entry(self.file_changes.as_ref()))
                    .map(|e| e.path.clone())
                {
                    self.trigger_file_change_action(FileChangeActionKind::Keep, Some(path), false);
                }
            }
            KeyCode::Char('U') | KeyCode::Char('u') if shift && !ctrl => {
                self.trigger_file_change_action(FileChangeActionKind::UndoAll, None, false);
            }
            KeyCode::Char('U') if !ctrl => {
                self.trigger_file_change_action(FileChangeActionKind::UndoAll, None, false);
            }
            KeyCode::Char('u') if !ctrl => {
                if let Some(path) = self
                    .file_review_overlay
                    .as_ref()
                    .and_then(|o| o.selected_entry(self.file_changes.as_ref()))
                    .map(|e| e.path.clone())
                {
                    self.trigger_file_change_action(FileChangeActionKind::Undo, Some(path), false);
                }
            }
            KeyCode::Char('R') | KeyCode::Char('r') if shift && !ctrl => {
                self.trigger_file_change_action(FileChangeActionKind::RedoAll, None, false);
            }
            KeyCode::Char('R') if !ctrl => {
                self.trigger_file_change_action(FileChangeActionKind::RedoAll, None, false);
            }
            KeyCode::Char('r') if !ctrl => {
                if let Some(path) = self
                    .file_review_overlay
                    .as_ref()
                    .and_then(|o| o.selected_entry(self.file_changes.as_ref()))
                    .map(|e| e.path.clone())
                {
                    self.trigger_file_change_action(FileChangeActionKind::Redo, Some(path), false);
                }
            }
            KeyCode::Char('f') if !ctrl => {
                self.force_apply_overlay_conflict();
            }
            KeyCode::Char('o') if !ctrl => {
                self.open_selected_file_in_editor();
            }
            _ => {}
        }

        Ok(true)
    }

    pub(super) fn execute_parsed_file_change_command(&mut self, cmd: ParsedFileChangeCommand) {
        match cmd {
            ParsedFileChangeCommand::OpenOverlay { path } => {
                self.open_file_review_overlay(path.as_deref());
            }
            ParsedFileChangeCommand::Action {
                action,
                path,
                force,
            } => {
                self.trigger_file_change_action(action, path, force);
            }
            ParsedFileChangeCommand::UndoMostRecent { force } => {
                if !self.is_remote {
                    self.refresh_local_file_changes();
                }
                let most_recent = self.file_changes.as_ref().and_then(|snap| {
                    snap.files
                        .iter()
                        .filter(|f| f.status == FileChangeStatus::Pending)
                        .max_by_key(|f| (f.updated_at_ms, f.turn_id))
                        .map(|f| f.path.clone())
                });
                if let Some(path) = most_recent {
                    self.trigger_file_change_action(FileChangeActionKind::Undo, Some(path), force);
                } else {
                    self.set_status_notice("No pending file changes to undo");
                }
            }
        }
    }
}

/// Shared slash-command entry point for `/changes`, `/keep`, `/undo`, `/redo`.
pub(super) fn handle_file_change_command(app: &mut App, trimmed: &str) -> bool {
    let Some(parsed) = parse_file_change_command(trimmed) else {
        return false;
    };
    match parsed {
        Ok(cmd) => app.execute_parsed_file_change_command(cmd),
        Err(error) => app.push_display_message(DisplayMessage::error(error)),
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_changes::{FileChangeEntrySummary, FileChangeKind};
    use crate::tui::app::tests::create_test_app;

    #[test]
    fn file_change_slash_command_parsing() {
        assert_eq!(
            parse_file_change_command("/changes"),
            Some(Ok(ParsedFileChangeCommand::OpenOverlay { path: None }))
        );
        assert_eq!(
            parse_file_change_command("/changes src/lib.rs"),
            Some(Ok(ParsedFileChangeCommand::OpenOverlay {
                path: Some("src/lib.rs".into())
            }))
        );
        assert_eq!(
            parse_file_change_command("/keep"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::KeepAll,
                path: None,
                force: false,
            }))
        );
        assert_eq!(
            parse_file_change_command("/keep all"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::KeepAll,
                path: None,
                force: false,
            }))
        );
        assert_eq!(
            parse_file_change_command("/keep src/foo.rs"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::Keep,
                path: Some("src/foo.rs".into()),
                force: false,
            }))
        );
        assert_eq!(
            parse_file_change_command("/undo"),
            Some(Ok(ParsedFileChangeCommand::UndoMostRecent { force: false }))
        );
        assert_eq!(
            parse_file_change_command("/undo all"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::UndoAll,
                path: None,
                force: false,
            }))
        );
        assert_eq!(
            parse_file_change_command("/undo --force foo.rs"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::Undo,
                path: Some("foo.rs".into()),
                force: true,
            }))
        );
        assert_eq!(
            parse_file_change_command("/undo --force all"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::UndoAll,
                path: None,
                force: true,
            }))
        );
        assert_eq!(
            parse_file_change_command("/redo"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::RedoAll,
                path: None,
                force: false,
            }))
        );
        assert_eq!(
            parse_file_change_command("/redo src/foo.rs"),
            Some(Ok(ParsedFileChangeCommand::Action {
                action: FileChangeActionKind::Redo,
                path: Some("src/foo.rs".into()),
                force: false,
            }))
        );
        // Must not match prefix collisions.
        assert_eq!(parse_file_change_command("/changes-custom"), None);
        assert_eq!(parse_file_change_command("/keep-alive"), None);
        assert_eq!(parse_file_change_command("/undo-something"), None);
        assert_eq!(parse_file_change_command("/redo-something"), None);
    }

    #[test]
    fn file_change_overlay_keys_and_conflict_force_flow() {
        let mut app = create_test_app();
        app.is_remote = true;
        let snap = FileChangesSnapshot {
            session_id: "ses_1".into(),
            latest_turn_id: 1,
            total_pending_files: 2,
            total_additions: 4,
            total_deletions: 1,
            files: vec![
                FileChangeEntrySummary {
                    path: "/repo/a.rs".into(),
                    display_path: "a.rs".into(),
                    old_path: None,
                    kind: FileChangeKind::Modified,
                    status: FileChangeStatus::Pending,
                    additions: 2,
                    deletions: 1,
                    changed_in_latest_turn: true,
                    turn_id: 1,
                    edit_count: 1,
                    is_binary: false,
                    undoable: true,
                    can_redo: false,
                    preview_hunks: Vec::new(),
                    preview_truncated: false,
                    updated_at_ms: 20,
                },
                FileChangeEntrySummary {
                    path: "/repo/b.rs".into(),
                    display_path: "b.rs".into(),
                    old_path: None,
                    kind: FileChangeKind::Created,
                    status: FileChangeStatus::Pending,
                    additions: 2,
                    deletions: 0,
                    changed_in_latest_turn: true,
                    turn_id: 1,
                    edit_count: 1,
                    is_binary: false,
                    undoable: true,
                    can_redo: false,
                    preview_hunks: Vec::new(),
                    preview_truncated: false,
                    updated_at_ms: 10,
                },
            ],
        };
        app.apply_file_changes_snapshot(snap.clone());
        app.open_file_review_overlay(None);
        assert!(app.file_review_overlay.is_some());
        app.pending_remote_file_change_requests.clear();

        // Down selects second file and requests its diff.
        app.handle_file_review_overlay_key(KeyCode::Down, KeyModifiers::NONE)
            .unwrap();
        assert_eq!(
            app.file_review_overlay.as_ref().unwrap().selected_index,
            1
        );
        assert_eq!(
            app.pending_remote_file_change_requests.pop_back(),
            Some(PendingRemoteFileChangeRequest::GetFileChangeDiff {
                path: "/repo/b.rs".into()
            })
        );

        // `u` queues Undo on selected file.
        app.handle_file_review_overlay_key(KeyCode::Char('u'), KeyModifiers::NONE)
            .unwrap();
        assert_eq!(
            app.pending_remote_file_change_requests.pop_back(),
            Some(PendingRemoteFileChangeRequest::FileChangeAction {
                action: FileChangeActionKind::Undo,
                path: Some("/repo/b.rs".into()),
                force: false,
            })
        );

        // Simulate conflict response from server.
        app.apply_file_change_action_response(
            FileChangeActionResponse {
                ok: false,
                message: "Conflict".into(),
                conflicts: vec![crate::file_changes::FileChangeConflict {
                    path: "/repo/b.rs".into(),
                    display_path: "b.rs".into(),
                    reason: "Modified manually".into(),
                }],
                snapshot: snap,
            },
            Some((FileChangeActionKind::Undo, Some("/repo/b.rs".into()))),
        );
        assert_eq!(app.file_review_overlay.as_ref().unwrap().conflicts.len(), 1);

        // `f` retries the conflicted action with `force: true`.
        app.handle_file_review_overlay_key(KeyCode::Char('f'), KeyModifiers::NONE)
            .unwrap();
        assert_eq!(
            app.pending_remote_file_change_requests.pop_back(),
            Some(PendingRemoteFileChangeRequest::FileChangeAction {
                action: FileChangeActionKind::Undo,
                path: Some("/repo/b.rs".into()),
                force: true,
            })
        );

        // `Esc` closes overlay.
        app.handle_file_review_overlay_key(KeyCode::Esc, KeyModifiers::NONE)
            .unwrap();
        assert!(app.file_review_overlay.is_none());
    }

    #[test]
    fn file_change_card_auto_collapses_while_processing_and_expands_when_finished() {
        let mut app = create_test_app();
        let snap = FileChangesSnapshot {
            session_id: "ses_collapse".into(),
            latest_turn_id: 1,
            total_pending_files: 1,
            total_additions: 5,
            total_deletions: 2,
            files: vec![FileChangeEntrySummary {
                path: "/repo/src/lib.rs".into(),
                display_path: "src/lib.rs".into(),
                old_path: None,
                kind: FileChangeKind::Modified,
                status: FileChangeStatus::Pending,
                additions: 5,
                deletions: 2,
                changed_in_latest_turn: true,
                turn_id: 1,
                edit_count: 1,
                is_binary: false,
                undoable: true,
                can_redo: false,
                preview_hunks: Vec::new(),
                preview_truncated: false,
                updated_at_ms: 100,
            }],
        };

        // 1. While AI is still responding, card defaults to collapsed.
        app.is_processing = true;
        app.apply_file_changes_snapshot(snap);
        assert!(!app.file_changes_card_expanded_state());

        // 2. User can manually expand and collapse while AI is still responding.
        app.handle_file_change_card_click(FileChangeHitTarget::ToggleCollapse);
        assert!(app.file_changes_card_expanded_state());
        app.handle_file_change_card_click(FileChangeHitTarget::ToggleCollapse);
        assert!(!app.file_changes_card_expanded_state());

        // 3. When AI finishes responding, card expands automatically by default.
        app.is_processing = false;
        assert!(app.file_changes_card_expanded_state());

        // 4. User can collapse and re-expand the finished card.
        app.handle_file_change_card_click(FileChangeHitTarget::ToggleCollapse);
        assert!(!app.file_changes_card_expanded_state());
        app.handle_file_change_card_click(FileChangeHitTarget::ToggleCollapse);
        assert!(app.file_changes_card_expanded_state());

        // 5. Starting a subsequent AI response automatically collapses again.
        app.is_processing = true;
        assert!(!app.file_changes_card_expanded_state());
    }
}
