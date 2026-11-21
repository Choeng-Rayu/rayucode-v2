use super::*;

#[test]
fn user_response_capability_is_explicit_and_independent_of_pdf_support() {
    for enabled in [false, true] {
        for req in ["create_session", "attach_session"] {
            let mut state = BridgeState {
                supports_user_response: enabled,
                supports_user_questions: false,
                ..Default::default()
            };
            let output = state.api_request_to_legacy(&json!({
                "req": req, "id": 1, "session_id": "response-session"
            }));
            let subscribe = output
                .iter()
                .find_map(|out| match out {
                    Outbound::Legacy(request) if request["type"] == "subscribe" => Some(request),
                    _ => None,
                })
                .expect("attachment sends Subscribe");
            assert_eq!(subscribe["supports_pdf_panels"], true);
            assert_eq!(subscribe["supports_user_response"], enabled);
        }
    }
    assert!(!BridgeState::default().supports_user_response);
}

#[test]
fn user_response_hello_defaults_off_for_older_clients() {
    for enabled in [false, true] {
        let mut value = json!({"req":"hello", "min_version":1, "max_version":1, "client":"test"});
        if enabled {
            value["supports_user_response"] = json!(true);
        }
        let request: rayucode_harness_api::ApiRequest = serde_json::from_value(value).unwrap();
        let rayucode_harness_api::ApiRequest::Hello {
            supports_user_response,
            ..
        } = request
        else {
            panic!("hello")
        };
        assert_eq!(supports_user_response, enabled);
    }
}

#[test]
fn question_round_trip_uses_attached_session_and_explicit_capability() {
    use rayucode_harness_api::ApiEvent;
    let question = json!({
        "type":"question_request", "session_id":"s1", "request_id":"q1", "tool_call_id":"call",
        "questions":[{"question":"Which?","header":"Choice","options":[
            {"label":"A","description":"First"}, {"label":"B","description":"Second"}
        ]}]
    });
    let reply = json!({
        "req":"question_response", "id":9, "session_id":"s1", "request_id":"q1",
        "response":{"kind":"answered","answers":{"Which?":{"selected":[1]}}}
    });
    let mut state = BridgeState {
        session_id: Some("s1".into()),
        ..Default::default()
    };
    assert!(state.legacy_event_to_api(&question).is_empty());
    assert!(matches!(
        &state.api_request_to_legacy(&reply)[..],
        [Outbound::Reply(_)]
    ));

    state.supports_user_questions = true;
    let events = state.legacy_event_to_api(&question);
    assert!(
        matches!(&events[0].event, ApiEvent::QuestionRequest { request_id, .. } if request_id == "q1")
    );
    let output = state.api_request_to_legacy(&reply);
    let [Outbound::Legacy(payload)] = &output[..] else {
        panic!("expected daemon reply request")
    };
    assert_eq!(payload["session_id"], "s1");
    assert_eq!(payload["request_id"], "q1");
    assert_eq!(payload["response"], reply["response"]);
    state.observed_turn_active = true;
    let rejected = state.legacy_event_to_api(&json!({
        "type":"error", "id":payload["id"], "message":"Invalid option"
    }));
    assert!(matches!(rejected.first(), Some(frame)
        if frame.reply_to == Some(9) && matches!(frame.event, ApiEvent::Error { .. })));
    assert!(state.observed_turn_active);
    let output = state.api_request_to_legacy(&reply);
    let [Outbound::Legacy(payload)] = &output[..] else {
        panic!("expected corrected reply request")
    };
    let frames = state.legacy_event_to_api(&json!({"type":"ack","id":payload["id"]}));
    assert!(
        matches!(frames.first(), Some(frame) if frame.reply_to == Some(9) && matches!(frame.event, ApiEvent::Ok))
    );
}
