use super::diff::{has_trailing_newline, uses_crlf};
use super::store::EditStep;

/// Reverse-apply AI edit steps in reverse chronological order against a file
/// that has received manual edits (either post-turn or interleaved between AI
/// turns).
///
/// Uses strict exact context matching. Never silently overwrites overlapping
/// manual edits; returns `Err(reason)` if any hunk cannot be cleanly and
/// unambiguously anchored.
pub(crate) fn reverse_apply_steps(
    current_text: &str,
    steps: &[EditStep],
) -> Result<String, String> {
    if steps.is_empty() {
        return Err("No structured edit steps available to reverse-patch".to_string());
    }

    let mut trailing_newline = has_trailing_newline(current_text);
    let crlf = uses_crlf(current_text);
    let mut lines: Vec<String> = if current_text.is_empty() {
        Vec::new()
    } else {
        current_text
            .split_terminator('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line).to_string())
            .collect()
    };

    for step in steps.iter().rev() {
        if step.hunks.is_empty() {
            if step.before_sha256 == step.after_sha256 {
                continue;
            }
            return Err(
                "Cannot safely reverse-patch change without structured diff hunks".to_string(),
            );
        }

        let mut planned: Vec<(usize, usize, Vec<String>)> = Vec::with_capacity(step.hunks.len());
        let mut touches_eof = false;

        for hunk in &step.hunks {
            let mut expected_after: Vec<&str> = Vec::new();
            let mut restore_before: Vec<String> = Vec::new();

            for raw_line in &hunk.lines {
                let mut chars = raw_line.chars();
                let Some(prefix) = chars.next() else {
                    return Err("Malformed hunk line during reverse-patch".to_string());
                };
                let rest = chars.as_str();
                match prefix {
                    ' ' => {
                        expected_after.push(rest);
                        restore_before.push(rest.to_string());
                    }
                    '+' => {
                        expected_after.push(rest);
                    }
                    '-' => {
                        restore_before.push(rest.to_string());
                    }
                    _ => {
                        return Err("Unexpected hunk line prefix during reverse-patch".to_string());
                    }
                }
            }

            if expected_after.is_empty() {
                if lines.is_empty() {
                    touches_eof = true;
                    planned.push((0, 0, restore_before));
                    continue;
                }
                return Err(
                    "File was modified manually after a context-free deletion; cannot reverse-patch safely"
                        .to_string(),
                );
            }

            if expected_after.len() > lines.len() {
                return Err(
                    "File was modified manually in an overlapping region after the AI edit"
                        .to_string(),
                );
            }

            let hint = hunk.new_start.saturating_sub(1);
            let mut matches = Vec::new();
            for start in 0..=lines.len() - expected_after.len() {
                if lines[start..start + expected_after.len()]
                    .iter()
                    .map(String::as_str)
                    .eq(expected_after.iter().copied())
                {
                    matches.push(start);
                }
            }

            let matched_idx = match matches.len() {
                0 => {
                    return Err(
                        "File was modified manually in an overlapping region after the AI edit"
                            .to_string(),
                    );
                }
                1 => matches[0],
                _ => {
                    if matches.contains(&hint) {
                        hint
                    } else {
                        return Err(
                            "Ambiguous context while reverse-patching around manual edits"
                                .to_string(),
                        );
                    }
                }
            };

            if matched_idx + expected_after.len() == lines.len() {
                touches_eof = true;
            }
            planned.push((matched_idx, expected_after.len(), restore_before));
        }

        planned.sort_by_key(|(start, _, _)| *start);
        for window in planned.windows(2) {
            let (s0, l0, _) = &window[0];
            let (s1, _, _) = &window[1];
            if s0 + l0 > *s1 {
                return Err(
                    "Overlapping hunks detected while reverse-patching manual edits".to_string(),
                );
            }
        }

        for (start, len, restore_before) in planned.into_iter().rev() {
            lines.splice(start..start + len, restore_before);
        }

        if touches_eof {
            trailing_newline = step.before_trailing_newline;
        }
    }

    if lines.is_empty() {
        return Ok(String::new());
    }

    let eol = if crlf { "\r\n" } else { "\n" };
    let mut output = lines.join(eol);
    if trailing_newline {
        output.push_str(eol);
    }
    Ok(output)
}
