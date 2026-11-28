use super::*;
use crate::protocol::Request;
use tokio::io::{AsyncBufReadExt, BufReader};

async fn read_request(reader: &mut BufReader<crate::transport::ReadHalf>) -> Request {
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(2), reader.read_line(&mut line))
        .await
        .expect("remote control request timeout")
        .unwrap();
    serde_json::from_str(&line).unwrap()
}

fn history(session_id: &str) -> ServerEvent {
    serde_json::from_value(serde_json::json!({"type": "history", "id": 42,
        "session_id": session_id, "messages": [], "mcp_servers": [], "skills": []}))
    .unwrap()
}

#[test]
fn ssh_session_tokens_do_not_claim_skills_or_paths() {
    for command in [
        "/resume",
        "/sessions",
        "/session",
        "/active",
        "/catchup",
        "/back",
        "/save",
        "/unsave",
        "/fork",
        "/split",
        "/btw",
        "/transfer",
        "/transcript",
    ] {
        assert_eq!(token(command), Some((command, "")));
    }
    assert_eq!(
        token(" /btw  why does this work? "),
        Some(("/btw", "why does this work?"))
    );
    for input in [
        "/resume-helper",
        "/sessions/new",
        "/home/me/session",
        "/saved",
        "ordinary text",
    ] {
        assert!(token(input).is_none(), "{input}");
    }
}

#[test]
fn ssh_session_wire_controls_and_navigation() {
    if crate::tui::app::commands_dispatch::ssh_test_runs_in_child(
        "ssh_session_wire_controls_and_navigation",
    ) {
        return;
    }
    let mut app = crate::tui::app::tests::create_test_app();
    app.is_remote = true;
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let mut remote = RemoteConnection::dummy();
        remote.set_session_id("remote-parent".into());
        remote.mark_history_loaded();
        let peer = remote.take_dummy_peer().unwrap();
        let (reader, _writer) = peer.into_split();
        let mut reader = BufReader::new(reader);

        for (input, command) in [("/resume", "sessions"), ("/sessions saved", "sessions"),
            ("/session", "session"), ("/active", "active"), ("/catchup", "catchup"),
            ("/transcript", "transcript"), ("/transcript path", "transcript")] {
            assert!(handle_command(&mut app, &mut remote, input).await.unwrap());
            assert!(matches!(read_request(&mut reader).await,
                Request::RuntimeCommand { command: actual, .. } if actual == command));
        }
        handle_command(&mut app, &mut remote, "/save useful remote work").await.unwrap();
        assert!(matches!(read_request(&mut reader).await,
            Request::SetSessionSaved { saved: true, label: Some(label), .. } if label == "useful remote work"));
        handle_command(&mut app, &mut remote, "/unsave").await.unwrap();
        assert!(matches!(read_request(&mut reader).await, Request::SetSessionSaved { saved: false, .. }));

        handle_command(&mut app, &mut remote, "/resume remote-only-child").await.unwrap();
        assert!(matches!(read_request(&mut reader).await,
            Request::ResumeSession { session_id, client_has_local_history: false, allow_session_takeover: false, .. }
            if session_id == "remote-only-child"));
        assert!(!remote.has_loaded_history());
        assert!(app.ssh_sessions.back.is_empty(), "do not commit navigation before success");
        assert!(!handle_event(&mut app, &mut remote, &history("remote-only-child")).await.unwrap());
        remote.set_session_id("remote-only-child".into());
        assert_eq!(app.ssh_sessions.back, ["remote-parent"]);

        handle_command(&mut app, &mut remote, "/back").await.unwrap();
        let back_id = match read_request(&mut reader).await {
            Request::ResumeSession { id, session_id, .. } => { assert_eq!(session_id, "remote-parent"); id },
            other => panic!("unexpected {other:?}"),
        };
        handle_event(&mut app, &mut remote, &ServerEvent::Error { id: back_id,
            message: "still attached elsewhere".into(), retry_after_secs: None }).await.unwrap();
        assert_eq!(app.ssh_sessions.back, ["remote-parent"], "failed back must be retryable");
        assert!(matches!(read_request(&mut reader).await, Request::GetHistory { .. }));
        assert!(app.ssh_sessions.navigation.is_none());

        handle_command(&mut app, &mut remote, "/back").await.unwrap();
        assert!(matches!(read_request(&mut reader).await, Request::ResumeSession { .. }));
        handle_event(&mut app, &mut remote, &history("remote-parent")).await.unwrap();
        remote.set_session_id("remote-parent".into());
        assert!(app.ssh_sessions.back.is_empty());

        handle_command(&mut app, &mut remote, "/btw a remote side question").await.unwrap();
        let split_id = match read_request(&mut reader).await { Request::Split { id, .. } => id, other => panic!("{other:?}") };
        let response = ServerEvent::SplitResponse { id: split_id, new_session_id: "remote-fork".into(), new_session_name: "fork".into() };
        assert!(handle_event(&mut app, &mut remote, &response).await.unwrap());
        assert!(matches!(read_request(&mut reader).await, Request::ResumeSession { session_id, .. } if session_id == "remote-fork"));
        assert!(app.ssh_sessions.ready_prompt.is_none(), "never send side question before child attachment");
        handle_event(&mut app, &mut remote, &history("remote-fork")).await.unwrap();
        assert_eq!(app.ssh_sessions.ready_prompt.as_deref(), Some("a remote side question"));
        assert_eq!(app.ssh_sessions.back, ["remote-parent"]);
        assert!(app.pending_split_startup_message.is_none(), "must not stage a local terminal child launch");
        app.ssh_sessions.ready_prompt = None;
        remote.set_session_id("remote-fork".into());

        handle_command(&mut app, &mut remote, "/transfer").await.unwrap();
        let transfer_id = match read_request(&mut reader).await { Request::Transfer { id } => id, other => panic!("{other:?}") };
        handle_event(&mut app, &mut remote, &ServerEvent::Error { id: transfer_id,
            message: "compaction failed".into(), retry_after_secs: None }).await.unwrap();
        assert!(app.ssh_sessions.child.is_none());
        handle_command(&mut app, &mut remote, "/catchup current").await.unwrap();
        assert!(matches!(read_request(&mut reader).await, Request::GetHistory { .. }));
        assert!(!remote.has_loaded_history());
    });
}

#[test]
fn ssh_back_and_alt_b_interleave_with_dashboard_in_unified_lifo_order() {
    if crate::tui::app::commands_dispatch::ssh_test_runs_in_child(
        "ssh_back_and_alt_b_interleave_with_dashboard_in_unified_lifo_order",
    ) {
        return;
    }
    use crate::protocol::{ProjectActivitySnapshot, SwarmMemberStatus};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use rayucode_tui_render::activity_dashboard::ActivityTab;

    let mut app = crate::tui::app::tests::create_test_app();
    app.is_remote = true;
    app.remote_session_id = Some("ses_A".to_string());
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let mut remote = RemoteConnection::dummy();
        remote.set_session_id("ses_A".into());
        remote.mark_history_loaded();
        let peer = remote.take_dummy_peer().unwrap();
        let (reader, _writer) = peer.into_split();
        let mut reader = BufReader::new(reader);

        // 1. Dashboard Enter switches A -> B (pushes A onto unified return stack).
        let member_a = SwarmMemberStatus {
            session_id: "ses_A".into(),
            friendly_name: Some("alpha".into()),
            status: "running".into(),
            ..Default::default()
        };
        let member_b = SwarmMemberStatus {
            session_id: "ses_B".into(),
            friendly_name: Some("beta".into()),
            status: "running".into(),
            report_back_to_session_id: Some("ses_A".into()),
            ..Default::default()
        };
        app.activity_dashboard.apply_snapshot(ProjectActivitySnapshot {
            my_swarm_members: vec![member_a, member_b],
            ..Default::default()
        });
        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_actions.clear();
        // Composer holding `/login` must NOT hijack Enter while dashboard is open (Bug #12).
        app.input = "/login".into();
        super::handle_remote_key_event(
            &mut app,
            KeyEvent::new(KeyCode::Down, KeyModifiers::NONE),
            &mut remote,
        )
        .await
        .unwrap();
        super::handle_remote_key_event(
            &mut app,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
            &mut remote,
        )
        .await
        .unwrap();
        assert!(!app.activity_dashboard.open);
        assert_eq!(app.input, "/login", "dashboard Enter must not trigger SSH /login");
        app.input.clear();
        super::flush_pending_activity_dashboard_actions(&mut app, &mut remote).await;
        assert!(matches!(
            read_request(&mut reader).await,
            Request::SubscribeProjectActivity { enabled: false, .. }
        ));
        assert!(matches!(
            read_request(&mut reader).await,
            Request::PeekSession { target: None, .. }
        ));
        assert!(matches!(
            read_request(&mut reader).await,
            Request::ResumeSession { session_id, .. } if session_id == "ses_B"
        ));
        remote.set_session_id("ses_B".into());
        app.remote_session_id = Some("ses_B".into());
        remote.mark_history_loaded();

        // 2. SSH `/resume ses_C` moves B -> C (pushes B on top of A).
        handle_command(&mut app, &mut remote, "/resume ses_C")
            .await
            .unwrap();
        assert!(matches!(
            read_request(&mut reader).await,
            Request::ResumeSession { session_id, .. } if session_id == "ses_C"
        ));
        handle_event(&mut app, &mut remote, &history("ses_C"))
            .await
            .unwrap();
        remote.set_session_id("ses_C".into());
        app.remote_session_id = Some("ses_C".into());
        remote.mark_history_loaded();
        assert_eq!(app.session_return_stack, vec!["ses_A", "ses_B"]);

        // 3. Outside Alt+B over SSH must return C -> B (not skip B to A!).
        super::handle_remote_key_event(
            &mut app,
            KeyEvent::new(KeyCode::Char('b'), KeyModifiers::ALT),
            &mut remote,
        )
        .await
        .unwrap();
        assert!(matches!(
            read_request(&mut reader).await,
            Request::ResumeSession { session_id, .. } if session_id == "ses_B"
        ));
        handle_event(&mut app, &mut remote, &history("ses_B"))
            .await
            .unwrap();
        remote.set_session_id("ses_B".into());
        app.remote_session_id = Some("ses_B".into());
        remote.mark_history_loaded();
        assert_eq!(app.session_return_stack, vec!["ses_A"]);

        // 4. Typing `/back` over SSH now pops A (originally pushed by dashboard Enter!).
        handle_command(&mut app, &mut remote, "/back").await.unwrap();
        assert!(matches!(
            read_request(&mut reader).await,
            Request::ResumeSession { session_id, .. } if session_id == "ses_A"
        ));
        handle_event(&mut app, &mut remote, &history("ses_A"))
            .await
            .unwrap();
        remote.set_session_id("ses_A".into());
        app.remote_session_id = Some("ses_A".into());
        assert!(!app.has_session_return_target());

        // 5. After SSH `/resume ses_D`, pressing Alt+B *inside* the dashboard pops back to ses_A!
        handle_command(&mut app, &mut remote, "/resume ses_D")
            .await
            .unwrap();
        let _ = read_request(&mut reader).await;
        handle_event(&mut app, &mut remote, &history("ses_D"))
            .await
            .unwrap();
        remote.set_session_id("ses_D".into());
        app.remote_session_id = Some("ses_D".into());

        app.open_activity_dashboard(ActivityTab::All);
        app.activity_dashboard.pending_actions.clear();
        assert!(app.handle_activity_dashboard_key(KeyCode::Char('b'), KeyModifiers::ALT));
        assert!(!app.activity_dashboard.open);
        assert!(app.activity_dashboard.pending_actions.iter().any(|a| matches!(
            a,
            crate::tui::app::activity_dashboard::DashboardRemoteAction::SwitchSession {
                target_session_id,
                ..
            } if target_session_id == "ses_A"
        )));
        assert!(!app.has_session_return_target());
    });
}
