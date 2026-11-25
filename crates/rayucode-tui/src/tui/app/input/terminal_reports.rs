/// Strip terminal escape-sequence remnants from text headed for the composer.
///
/// Mouse reporting, bracketed paste, and focus events all arrive as CSI
/// sequences. When a read is torn mid-sequence (a fast wheel flick split across
/// two reads, a loaded machine, a slow SSH link), the terminal-event parser can
/// resynchronize partway through and hand the tail of the sequence back as
/// ordinary text, which then lands in the draft as noise like `[<65;50;24M`
/// (issue #540). Whether that happens depends on the terminal and on timing, so
/// rather than rely on the parser never mis-syncing, drop the remnants at the
/// single insertion boundary every input path shares.
///
/// Deliberately conservative: only ESC-introduced sequences and bare CSI-shaped
/// runs are removed, plus C0 control characters other than tab and newline.
///
/// A *bare* run (one whose ESC introducer was consumed by the torn read) is only
/// stripped when it looks unmistakably like a terminal report: `[`, at least one
/// parameter byte, and a final byte that terminals actually emit for the
/// sequences we enable (`M`/`m` mouse, `~` bracketed paste and special keys,
/// `R` cursor position, `I`/`O` focus). This is what keeps ordinary typed text
/// such as `array[0]`, `list[1]`, or `[TODO]` intact, since `]` and letters like
/// `O` only qualify with a preceding numeric parameter for the specific finals
/// listed. Anything else is left alone: a missed remnant is cosmetic, whereas
/// eating a user's real characters is not.
pub(in crate::tui::app) fn strip_terminal_control_sequences(
    text: &str,
) -> std::borrow::Cow<'_, str> {
    let looks_suspicious = text
        .chars()
        .any(|ch| ch == '\x1b' || ch == '\u{9b}' || (ch.is_control() && ch != '\t' && ch != '\n'));
    let has_csi_run = text.contains("\x1b[") || text.contains('\u{9b}') || {
        let bytes = text.as_bytes();
        bytes.iter().enumerate().any(|(index, byte)| {
            *byte == b'[' && bare_terminal_report_length(&bytes[index..]).is_some()
        })
    };
    if !looks_suspicious && !has_csi_run {
        return std::borrow::Cow::Borrowed(text);
    }

    let bytes = text.as_bytes();
    let mut cleaned = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        // ESC-introduced sequence: skip the introducer, then the body.
        if byte == 0x1b {
            index += 1;
            if index < bytes.len() && bytes[index] == b'[' {
                match csi_run_length(&bytes[index..]) {
                    Some(len) => index += len,
                    // Unterminated: the rest is a truncated sequence, drop it.
                    None => index = bytes.len(),
                }
            } else if index < bytes.len() {
                // Two-character escape such as ESC O or ESC ].
                index += 1;
            }
            continue;
        }
        // 8-bit CSI introducer (UTF-8 encoded U+009B).
        if byte == 0xc2 && bytes.get(index + 1) == Some(&0x9b) {
            index += 2;
            if bytes.get(index) == Some(&b'[') {
                match csi_run_length(&bytes[index..]) {
                    Some(len) => index += len,
                    None => index = bytes.len(),
                }
            }
            continue;
        }
        // A bare report-shaped run left behind by a torn read.
        if byte == b'['
            && let Some(len) = bare_terminal_report_length(&bytes[index..])
        {
            index += len;
            continue;
        }
        // Drop stray C0 controls; keep tab and newline, which are meaningful.
        if byte < 0x20 && byte != b'\t' && byte != b'\n' {
            index += 1;
            continue;
        }
        // Copy one whole UTF-8 character.
        let char_len = text[index..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
        cleaned.push_str(&text[index..index + char_len]);
        index += char_len;
    }

    std::borrow::Cow::Owned(cleaned)
}

/// Length of a CSI run starting at `bytes[0]` (the `[`), including its final
/// byte, or `None` when the run is unterminated.
///
/// A CSI body is parameter bytes `0x30..=0x3f`, then intermediate bytes
/// `0x20..=0x2f`, then one final byte `0x40..=0x7e`.
fn csi_run_length(bytes: &[u8]) -> Option<usize> {
    debug_assert_eq!(bytes.first(), Some(&b'['));
    let mut index = 1usize;
    while index < bytes.len() && (0x30..=0x3f).contains(&bytes[index]) {
        index += 1;
    }
    while index < bytes.len() && (0x20..=0x2f).contains(&bytes[index]) {
        index += 1;
    }
    let final_byte = *bytes.get(index)?;
    if (0x40..=0x7e).contains(&final_byte) {
        Some(index + 1)
    } else {
        None
    }
}

/// Length of a bare (ESC-less) run that is unmistakably a terminal report, or
/// `None` when the run could plausibly be text the user typed.
///
/// Requires at least one parameter byte and one of the final bytes emitted by
/// the reporting modes rayu enables, so `array[0]` and `[TODO]` are left alone
/// while `[<65;50;24M`, `[200~`, and Kitty CSI-u event reports such as
/// `[99;1:3u` / `[115:83;2:3u` are recognized.
fn bare_terminal_report_length(bytes: &[u8]) -> Option<usize> {
    debug_assert_eq!(bytes.first(), Some(&b'['));
    let len = csi_run_length(bytes)?;
    let params = &bytes[1..len - 1];
    if params.is_empty() {
        return None;
    }
    let final_byte = bytes[len - 1];
    if final_byte == b'u' {
        return is_kitty_csi_u_event_params(params).then_some(len);
    }
    // Mouse/paste/cursor/focus reports carry digits, `;`, and an optional
    // leading `<`. Reject anything with other parameter bytes.
    if !params
        .iter()
        .all(|byte| byte.is_ascii_digit() || *byte == b';' || *byte == b'<')
    {
        return None;
    }
    const REPORT_FINALS: [u8; 6] = *b"Mm~RIO";
    REPORT_FINALS.contains(&final_byte).then_some(len)
}

/// Strictly match Kitty keyboard protocol CSI-u event-type parameters such as
/// `99;1:3` (release of `'c'`) or `115:83;2:3` (shifted alternate `'S'` release).
///
/// Requiring the `;` modifier separator AND a `:1`/`:2`/`:3` event-type
/// sub-parameter keeps false positives at zero for ordinary text like
/// `array[0]`, `[u8; 4]`, or `[12;40]`.
fn is_kitty_csi_u_event_params(params: &[u8]) -> bool {
    let Some(semi) = params.iter().position(|&b| b == b';') else {
        return false;
    };
    let key_part = &params[..semi];
    let rest = &params[semi + 1..];
    if key_part.is_empty() || rest.is_empty() {
        return false;
    }
    // Key part: `<codepoint>` with optional `:<shifted>` / `:<base>` numeric sub-params.
    if !key_part
        .split(|&b| b == b':')
        .all(|sub| !sub.is_empty() && sub.iter().all(u8::is_ascii_digit))
    {
        return false;
    }
    // Modifier + event-type part (ignore optional third `;text` field if present):
    let mod_field = rest.split(|&b| b == b';').next().unwrap_or(rest);
    let mut sub = mod_field.split(|&b| b == b':');
    let Some(mods) = sub.next() else {
        return false;
    };
    let Some(event_type) = sub.next() else {
        return false;
    };
    if sub.next().is_some() {
        return false;
    }
    !mods.is_empty()
        && mods.iter().all(u8::is_ascii_digit)
        && matches!(event_type, b"1" | b"2" | b"3")
}

/// Remove a complete bare terminal report that was assembled character by
/// character immediately before `cursor` (for example when ConPTY/crossterm
/// drops the leading ESC and delivers `[<65;50;24M`, `[200~`, or `[99;1:3u`
/// one keystroke at a time).
pub(in crate::tui::app) fn strip_trailing_bare_terminal_report(
    input: &str,
    cursor: usize,
) -> Option<(String, usize)> {
    if cursor == 0 || cursor > input.len() || !input.is_char_boundary(cursor) {
        return None;
    }
    let prefix = &input[..cursor];
    let last_byte = *prefix.as_bytes().last()?;
    if !matches!(last_byte, b'M' | b'm' | b'~' | b'R' | b'I' | b'O' | b'u') {
        return None;
    }
    // Terminal reports are short (typically <= 32 bytes); bound the backward scan.
    let scan_start = prefix
        .rfind('[')
        .filter(|&start| cursor - start <= 48)?;
    let candidate = &prefix.as_bytes()[scan_start..];
    let len = bare_terminal_report_length(candidate)?;
    if len != candidate.len() {
        return None;
    }
    let mut cleaned = String::with_capacity(input.len() - len);
    cleaned.push_str(&input[..scan_start]);
    cleaned.push_str(&input[cursor..]);
    Some((cleaned, scan_start))
}
