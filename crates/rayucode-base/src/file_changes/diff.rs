use rayucode_session_types::{FileChangeHunk, FileChangeKind};
use similar::{ChangeTag, TextDiff};

use super::PREVIEW_MAX_LINES;

#[derive(Debug, Clone, Default)]
pub(crate) struct ComputedDiff {
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<FileChangeHunk>,
    pub preview_hunks: Vec<FileChangeHunk>,
    pub preview_truncated: bool,
}

pub(crate) fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes.contains(&0) || std::str::from_utf8(bytes).is_err()
}

pub(crate) fn has_trailing_newline(text: &str) -> bool {
    text.ends_with('\n')
}

pub(crate) fn uses_crlf(text: &str) -> bool {
    text.split_once('\n')
        .is_some_and(|(line, _)| line.ends_with('\r'))
}

pub(crate) fn compute_text_diff(old: &str, new: &str) -> ComputedDiff {
    if old == new {
        return ComputedDiff::default();
    }

    let diff = TextDiff::from_lines(old, new);
    let mut additions = 0usize;
    let mut deletions = 0usize;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => additions += 1,
            ChangeTag::Delete => deletions += 1,
            ChangeTag::Equal => {}
        }
    }

    let mut hunks = Vec::new();
    for group in diff.grouped_ops(3) {
        let Some(first) = group.first() else {
            continue;
        };
        let Some(last) = group.last() else {
            continue;
        };
        let old_range = first.old_range().start..last.old_range().end;
        let new_range = first.new_range().start..last.new_range().end;
        let old_lines = old_range.len();
        let new_lines = new_range.len();
        let old_start = if old_lines == 0 {
            old_range.start
        } else {
            old_range.start + 1
        };
        let new_start = if new_lines == 0 {
            new_range.start
        } else {
            new_range.start + 1
        };
        let header = format!("@@ -{},{} +{},{} @@", old_start, old_lines, new_start, new_lines);

        let mut lines = Vec::new();
        for op in &group {
            for change in diff.iter_changes(op) {
                let prefix = match change.tag() {
                    ChangeTag::Delete => '-',
                    ChangeTag::Insert => '+',
                    ChangeTag::Equal => ' ',
                };
                let value = change
                    .value()
                    .strip_suffix('\n')
                    .unwrap_or(change.value());
                let value = value.strip_suffix('\r').unwrap_or(value);
                lines.push(format!("{prefix}{value}"));
            }
        }

        hunks.push(FileChangeHunk {
            old_start,
            old_lines,
            new_start,
            new_lines,
            header,
            lines,
        });
    }

    let (preview_hunks, preview_truncated) = truncate_preview_hunks(&hunks, PREVIEW_MAX_LINES);

    ComputedDiff {
        additions,
        deletions,
        hunks,
        preview_hunks,
        preview_truncated,
    }
}

pub(crate) fn truncate_preview_hunks(
    hunks: &[FileChangeHunk],
    max_lines: usize,
) -> (Vec<FileChangeHunk>, bool) {
    let mut preview = Vec::new();
    let mut remaining = max_lines;
    let mut truncated = false;

    for hunk in hunks {
        if remaining == 0 {
            truncated = true;
            break;
        }
        if hunk.lines.len() <= remaining {
            remaining -= hunk.lines.len();
            preview.push(hunk.clone());
        } else {
            let mut partial = hunk.clone();
            partial.lines.truncate(remaining);
            preview.push(partial);
            remaining = 0;
            truncated = true;
        }
    }

    (preview, truncated)
}

pub(crate) fn build_unified_diff(
    kind: FileChangeKind,
    display_path: &str,
    old_display_path: Option<&str>,
    old: &str,
    new: &str,
) -> String {
    let (old_header, new_header) = match kind {
        FileChangeKind::Created => ("/dev/null".to_string(), format!("b/{display_path}")),
        FileChangeKind::Deleted => (format!("a/{display_path}"), "/dev/null".to_string()),
        FileChangeKind::Renamed => (
            format!("a/{}", old_display_path.unwrap_or(display_path)),
            format!("b/{display_path}"),
        ),
        FileChangeKind::Modified => (format!("a/{display_path}"), format!("b/{display_path}")),
    };

    if old == new {
        return format!("--- {old_header}\n+++ {new_header}\n");
    }

    TextDiff::from_lines(old, new)
        .unified_diff()
        .context_radius(3)
        .header(&old_header, &new_header)
        .to_string()
}
