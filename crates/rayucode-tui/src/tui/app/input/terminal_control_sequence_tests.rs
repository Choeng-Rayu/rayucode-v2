use super::strip_terminal_control_sequences;

/// Remnants of terminal reports must never reach the composer (#540).
#[test]
fn strips_escape_and_bare_report_remnants() {
    for (input, expected) in [
        // Full mouse report, and the bare tail left by a torn read.
        ("\x1b[<65;50;24M", ""),
        ("[<65;50;24M", ""),
        ("hi[<65;50;24Mthere", "hithere"),
        ("[<65;50;24m", ""),
        // Bracketed paste markers and cursor/focus reports.
        ("[200~", ""),
        ("[201~", ""),
        ("[12;40R", ""),
        ("[1I", ""),
        ("[1O", ""),
        // Kitty CSI-u key-release remnants (Windows Terminal / ConPTY leak).
        ("C[99;1:3ur[114;1:3ue[101;1:3u[115:83;2:3u", "Cre"),
        ("hello[104;1:3u world", "hello world"),
        // 8-bit CSI introducer.
        ("\u{9b}[<65;50;24M", ""),
        // Stray C0 controls, but tabs and newlines survive.
        ("a\x07b", "ab"),
        ("a\tb\nc", "a\tb\nc"),
        // Truncated escape with no final byte: drop the remnant.
        ("\x1b[<65;5", ""),
    ] {
        assert_eq!(
            strip_terminal_control_sequences(input),
            expected,
            "input {input:?} should sanitize to {expected:?}"
        );
    }
}

/// Character-by-character delivery of torn mouse/paste/Kitty CSI reports must
/// scrub cleanly once the final byte arrives, leaving ordinary text intact.
#[test]
fn strips_character_by_character_bare_reports_at_cursor() {
    use super::strip_trailing_bare_terminal_report;

    let type_stream = |stream: &str| -> String {
        let mut buf = String::new();
        let mut cursor = 0usize;
        for ch in stream.chars() {
            buf.insert(cursor, ch);
            cursor += ch.len_utf8();
            if let Some((cleaned, new_cursor)) = strip_trailing_bare_terminal_report(&buf, cursor) {
                buf = cleaned;
                cursor = new_cursor;
            }
        }
        assert_eq!(cursor, buf.len());
        buf
    };

    assert_eq!(
        type_stream("C[99;1:3ur[114;1:3ue[101;1:3u[115:83;2:3u"),
        "Cre"
    );
    assert_eq!(type_stream("hi[<65;50;24M[<64;50;24M there"), "hi there");
    assert_eq!(type_stream("[200~pasted[201~"), "pasted");
    assert_eq!(type_stream("let x: [u8; 4] = [1, 2, 3, 4];"), "let x: [u8; 4] = [1, 2, 3, 4];");
    assert_eq!(type_stream("foo[12;40]bar"), "foo[12;40]bar");
}

/// The guard must not eat text a user actually typed. Being too aggressive
/// here is worse than missing a remnant.
#[test]
fn preserves_ordinary_bracketed_text() {
    for input in [
        "array[0]",
        "list[1] = list[2]",
        "[TODO] fix this",
        "see docs[1] and notes[2]",
        "fn f(v: Vec<u8>) -> [u8; 4]",
        "a[b]c",
        "[]",
        "[",
        "]",
        "[abc]",
        "[1]",
        "[12;40]",
        "plain text with no brackets",
        "emoji 🎉 and accents café",
        "match x { [a, b] => a + b }",
    ] {
        assert_eq!(
            strip_terminal_control_sequences(input),
            input,
            "input {input:?} must be preserved verbatim"
        );
    }
}

/// Late OSC 11 replies typed into the composer key by key (#970).
#[test]
fn strips_late_osc_color_replies() {
    use super::strip_osc_color_replies;
    let strip = |input: &str| {
        strip_osc_color_replies(input, input.len()).map(|(text, cursor)| {
            assert_eq!(cursor, text.len(), "cursor must stay at the end");
            text
        })
    };
    assert_eq!(strip("11;rgb:3030/3434/4646").as_deref(), Some(""));
    assert_eq!(strip("hi11;rgb:3030/3434/4646").as_deref(), Some("hi"));
    assert_eq!(strip("]11;rgb:30/34/46\\hello").as_deref(), Some("hello"));
    assert_eq!(
        strip("10;rgb:cdcd/d6d6/f4f411;rgb:0000/0000/0000").as_deref(),
        Some("")
    );
    assert_eq!(strip("11;rgba:ffff/ffff/ffff/ffff").as_deref(), Some(""));

    // Half-arrived replies are left alone until the last component is
    // complete, so no tail is stranded.
    for partial in ["11;rgb:", "11;rgb:3030/34", "11;rgb:3030/3434/46"] {
        assert_eq!(strip(partial), None, "{partial:?}");
    }
    // Ordinary text survives.
    for text in ["rgb:3030/3434/4646", "111;rgb:30/34/46", "use rgb(1,2,3)"] {
        assert_eq!(strip(text), None, "{text:?}");
    }

    // A cursor in the middle of the draft is remapped across the removal.
    let input = "ab11;rgb:30/34/46cd";
    assert_eq!(
        strip_osc_color_replies(input, input.len() - 2),
        Some(("abcd".to_string(), 2))
    );
}

/// Non-suspicious text must not be reallocated.
#[test]
fn borrows_when_nothing_to_strip() {
    assert!(matches!(
        strip_terminal_control_sequences("array[0] = 1"),
        std::borrow::Cow::Borrowed(_)
    ));
}
