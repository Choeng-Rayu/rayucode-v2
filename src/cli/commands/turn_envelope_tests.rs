use super::*;
use crate::protocol::{ServerEvent, TurnIdentity};

fn envelope(event: ServerEvent) -> ServerEvent {
    ServerEvent::TurnEvent {
        identity: TurnIdentity {
            runtime_generation: "runtime-test".into(),
            turn_id: 7,
        },
        event: Box::new(event),
    }
}

#[test]
fn ndjson_preserves_wrapped_text_tool_and_error_payloads() {
    for event in [
        ServerEvent::TextDelta {
            text: "hello".into(),
        },
        ServerEvent::ToolStart {
            id: "tool-1".into(),
            name: "read".into(),
        },
        ServerEvent::Interrupted,
        ServerEvent::Error {
            id: 9,
            message: "failure".into(),
            retry_after_secs: None,
        },
    ] {
        let mut plain = Vec::new();
        let mut wrapped = Vec::new();
        let mut plain_state = NdjsonRunState::default();
        let mut wrapped_state = NdjsonRunState::default();
        emit_ndjson_event(&mut plain, &mut plain_state, event.clone()).unwrap();
        emit_ndjson_event(&mut wrapped, &mut wrapped_state, envelope(envelope(event))).unwrap();
        assert!(!plain.is_empty());
        assert_eq!(wrapped, plain);
        assert_eq!(wrapped_state.text, plain_state.text);
    }
}

#[test]
fn unwrap_preserves_terminal_request_id_and_legacy_events() {
    assert!(matches!(
        unwrap_turn_event(envelope(envelope(ServerEvent::Done { id: 42 }))),
        ServerEvent::Done { id: 42 }
    ));
    assert!(matches!(
        unwrap_turn_event(ServerEvent::Done { id: 43 }),
        ServerEvent::Done { id: 43 }
    ));
}

#[test]
fn ndjson_rayu_credits_line_reports_charge_and_updates_done_payload() {
    let mut out = Vec::new();
    let mut state = NdjsonRunState::default();
    emit_ndjson_event(
        &mut out,
        &mut state,
        envelope(ServerEvent::RayuCredits {
            credits: 1.25,
            turn_credits: 3.75,
            billable_tokens: Some(1250),
            tokens_per_credit: Some(1000),
        }),
    )
    .unwrap();
    let line: serde_json::Value =
        serde_json::from_slice(out.strip_suffix(b"\n").unwrap_or(&out)).unwrap();
    assert_eq!(line["type"], "rayu_credits");
    assert_eq!(line["credits"], serde_json::json!(1.25));
    assert_eq!(line["turn_credits"], serde_json::json!(3.75));
    assert_eq!(line["billable_tokens"], 1250);
    assert_eq!(line["tokens_per_credit"], 1000);
    assert_eq!(state.rayu_credits, Some(3.75));

    let done = ndjson_done_payload(&state, "sess", "rayu", "model-x");
    assert_eq!(done["type"], "done");
    assert_eq!(done["rayu_credits"], serde_json::json!(3.75));
}

#[test]
fn ndjson_done_payload_omits_rayu_credits_until_a_charge_arrives() {
    let state = NdjsonRunState::default();
    let done = ndjson_done_payload(&state, "sess", "anthropic", "claude");
    assert!(
        !done.as_object().unwrap().contains_key("rayu_credits"),
        "credits must be absent when unreported: {done}"
    );

    // A genuine zero charge is reported, unlike "not reported".
    let mut free = NdjsonRunState::default();
    emit_ndjson_event(
        &mut Vec::new(),
        &mut free,
        ServerEvent::RayuCredits {
            credits: 0.0,
            turn_credits: 0.0,
            billable_tokens: None,
            tokens_per_credit: None,
        },
    )
    .unwrap();
    let done = ndjson_done_payload(&free, "sess", "rayu", "model-x");
    assert_eq!(done["rayu_credits"], serde_json::json!(0.0));
}

#[test]
fn ndjson_done_payload_keeps_last_turn_credits_across_multiple_requests() {
    let mut out = Vec::new();
    let mut state = NdjsonRunState::default();
    for (credits, turn_credits) in [(1.25, 1.25), (2.50, 3.75)] {
        emit_ndjson_event(
            &mut out,
            &mut state,
            ServerEvent::RayuCredits {
                credits,
                turn_credits,
                billable_tokens: None,
                tokens_per_credit: None,
            },
        )
        .unwrap();
    }
    let lines: Vec<serde_json::Value> = String::from_utf8(out)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["credits"], serde_json::json!(2.50));
    assert_eq!(lines[1]["turn_credits"], serde_json::json!(3.75));
    assert_eq!(
        ndjson_done_payload(&state, "sess", "rayu", "model-x")["rayu_credits"],
        serde_json::json!(3.75)
    );
}

#[test]
fn json_run_report_includes_rayu_credits_only_when_reported() {
    let usage = crate::agent::TokenUsage {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: None,
        cache_creation_input_tokens: None,
    };
    let report = |rayu_credits| RunCommandReport {
        session_id: "sess".into(),
        provider: "rayu".into(),
        model: "model-x".into(),
        text: "answer".into(),
        usage: usage.clone(),
        rayu_credits,
    };
    let unreported = serde_json::to_value(report(None)).unwrap();
    assert!(
        !unreported.as_object().unwrap().contains_key("rayu_credits"),
        "unreported credits must be omitted: {unreported}"
    );
    assert_eq!(unreported["text"], "answer");
    assert_eq!(unreported["usage"]["input_tokens"], 10);

    let reported = serde_json::to_value(report(Some(3.75))).unwrap();
    assert_eq!(reported["rayu_credits"], serde_json::json!(3.75));
    let zero = serde_json::to_value(report(Some(0.0))).unwrap();
    assert_eq!(zero["rayu_credits"], serde_json::json!(0.0));
}
