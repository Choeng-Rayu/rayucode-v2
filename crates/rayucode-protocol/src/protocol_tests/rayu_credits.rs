#[test]
fn rayu_credits_event_tags_omits_absent_optionals_and_roundtrips() -> Result<()> {
    let event = ServerEvent::RayuCredits {
        credits: 1.25,
        turn_credits: 3.75,
        billable_tokens: None,
        tokens_per_credit: None,
    };
    let encoded: serde_json::Value = serde_json::from_str(encode_event(&event).trim())?;
    assert_eq!(encoded["type"], "rayu_credits");
    assert_eq!(encoded["credits"], serde_json::json!(1.25));
    assert_eq!(encoded["turn_credits"], serde_json::json!(3.75));
    assert!(
        encoded.get("billable_tokens").is_none(),
        "absent billable_tokens must be omitted: {encoded}"
    );
    assert!(
        encoded.get("tokens_per_credit").is_none(),
        "absent tokens_per_credit must be omitted: {encoded}"
    );
    let decoded = parse_event_json(&encoded.to_string())?;
    assert!(matches!(
        decoded,
        ServerEvent::RayuCredits {
            credits,
            turn_credits,
            billable_tokens: None,
            tokens_per_credit: None,
        } if (credits - 1.25).abs() < 1e-9 && (turn_credits - 3.75).abs() < 1e-9
    ));

    let full = ServerEvent::RayuCredits {
        credits: 0.5,
        turn_credits: 4.25,
        billable_tokens: Some(1250),
        tokens_per_credit: Some(1000),
    };
    let encoded: serde_json::Value = serde_json::from_str(encode_event(&full).trim())?;
    assert_eq!(encoded["billable_tokens"], 1250);
    assert_eq!(encoded["tokens_per_credit"], 1000);
    assert!(matches!(
        parse_event_json(&encoded.to_string())?,
        ServerEvent::RayuCredits {
            billable_tokens: Some(1250),
            tokens_per_credit: Some(1000),
            ..
        }
    ));
    Ok(())
}

#[test]
fn rayu_credits_event_accepts_payloads_without_optional_metadata() -> Result<()> {
    // Older gateways publish only the two required credit figures.
    let legacy = r#"{"type":"rayu_credits","credits":0.004,"turn_credits":0.004}"#;
    let decoded = parse_event_json(legacy)?;
    assert!(matches!(
        decoded,
        ServerEvent::RayuCredits {
            credits,
            turn_credits,
            billable_tokens: None,
            tokens_per_credit: None,
        } if (credits - 0.004).abs() < 1e-12 && (turn_credits - 0.004).abs() < 1e-12
    ));
    let reencoded: serde_json::Value = serde_json::from_str(encode_event(&decoded).trim())?;
    assert_eq!(reencoded["type"], "rayu_credits");
    assert_eq!(reencoded["credits"], serde_json::json!(0.004));
    assert!(
        !reencoded
            .as_object()
            .unwrap()
            .contains_key("billable_tokens")
    );
    Ok(())
}

#[test]
fn history_response_stats_rayu_credits_roundtrips_and_stays_backward_compatible() -> Result<()> {
    let legacy = serde_json::json!({"type":"history","id":3,"session_id":"s",
        "messages":[{"role":"assistant","content":"answer",
            "response_stats":{"input_tokens":10,"output_tokens":12}}]});
    let decoded = parse_event_json(&legacy.to_string())?;
    let ServerEvent::History { messages, .. } = &decoded else {
        return Err(anyhow!("expected history event"));
    };
    assert_eq!(
        messages[0].response_stats.as_ref().unwrap().rayu_credits,
        None
    );
    assert_eq!(
        serde_json::to_value(messages[0].response_stats.clone())?,
        serde_json::json!({"input_tokens":10,"output_tokens":12}),
        "an older payload without rayu_credits must round-trip unchanged"
    );

    let with_credits = serde_json::json!({"type":"history","id":4,"session_id":"s",
        "messages":[{"role":"assistant","content":"answer",
            "response_stats":{"input_tokens":10,"output_tokens":12,"rayu_credits":443.76}}]});
    let decoded = parse_event_json(&with_credits.to_string())?;
    let ServerEvent::History { messages, .. } = &decoded else {
        return Err(anyhow!("expected history event"));
    };
    assert_eq!(
        messages[0].response_stats.as_ref().unwrap().rayu_credits,
        Some(443.76)
    );
    assert_eq!(
        serde_json::to_value(messages[0].response_stats.clone())?,
        serde_json::json!({"input_tokens":10,"output_tokens":12,"rayu_credits":443.76})
    );
    Ok(())
}
