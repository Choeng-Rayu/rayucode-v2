//! Socket integration tests for Project Activity, Live Peek, CancelBackgroundTask,
//! and Non-Blocking ResumeSession during an active turn.

#![allow(clippy::await_holding_lock)]

use super::*;
use crate::background::TaskResult;
use crate::message::{Message, StreamEvent, ToolDefinition};
use crate::provider::EventStream;
use async_trait::async_trait;
use futures::stream;
use serde_json::json;
use std::sync::atomic::AtomicBool;
use tokio::sync::Notify;

#[derive(Clone)]
struct BlockingTurnProvider {
    started: Arc<Notify>,
    release: Arc<Notify>,
    completed: Arc<AtomicBool>,
}

impl BlockingTurnProvider {
    fn new() -> Self {
        Self {
            started: Arc::new(Notify::new()),
            release: Arc::new(Notify::new()),
            completed: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[async_trait]
impl Provider for BlockingTurnProvider {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
        _system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        self.started.notify_waiters();
        self.release.notified().await;
        self.completed.store(true, Ordering::SeqCst);
        Ok(Box::pin(stream::iter(vec![
            Ok(StreamEvent::TextDelta("blocking turn finished".into())),
            Ok(StreamEvent::MessageEnd {
                stop_reason: Some("end_turn".into()),
            }),
        ])))
    }

    fn name(&self) -> &str {
        "blocking-turn-provider"
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(self.clone())
    }
}

struct IsolatedHomeGuard {
    _dir: tempfile::TempDir,
    prev_home: Option<std::ffi::OsString>,
    prev_runtime: Option<std::ffi::OsString>,
}

impl IsolatedHomeGuard {
    fn new() -> Self {
        let dir = tempfile::TempDir::new().unwrap();
        let prev_home = std::env::var_os("RAYU_HOME");
        let prev_runtime = std::env::var_os("RAYU_RUNTIME_DIR");
        crate::env::set_var("RAYU_HOME", dir.path());
        crate::env::set_var("RAYU_RUNTIME_DIR", dir.path());
        Self {
            _dir: dir,
            prev_home,
            prev_runtime,
        }
    }
}

impl Drop for IsolatedHomeGuard {
    fn drop(&mut self) {
        match &self.prev_home {
            Some(v) => crate::env::set_var("RAYU_HOME", v),
            None => crate::env::remove_var("RAYU_HOME"),
        }
        match &self.prev_runtime {
            Some(v) => crate::env::set_var("RAYU_RUNTIME_DIR", v),
            None => crate::env::remove_var("RAYU_RUNTIME_DIR"),
        }
    }
}

async fn send_json(writer: &mut crate::transport::WriteHalf, value: serde_json::Value) {
    writer
        .write_all(format!("{value}\n").as_bytes())
        .await
        .unwrap();
}

async fn recv_until(
    reader: &mut BufReader<crate::transport::ReadHalf>,
    timeout_ms: u64,
    predicate: impl Fn(&ServerEvent) -> bool,
) -> ServerEvent {
    tokio::time::timeout(Duration::from_millis(timeout_ms), async {
        loop {
            let mut line = String::new();
            let n = reader.read_line(&mut line).await.unwrap();
            assert!(n > 0, "socket closed before expected event");
            let event: ServerEvent = serde_json::from_str(&line).unwrap();
            if predicate(&event) {
                return event;
            }
        }
    })
    .await
    .expect("timed out waiting for server event")
}

#[tokio::test]
async fn get_project_activity_peek_and_cancel_bg_respond_while_agent_mutex_is_locked() {
    let _lock = crate::storage::lock_test_env();
    let home = IsolatedHomeGuard::new();
    let repo_dir = home._dir.path().join("project-lock-test");
    std::fs::create_dir_all(repo_dir.join(".git")).unwrap();
    std::fs::write(repo_dir.join(".git/HEAD"), "ref: refs/heads/test-branch\n").unwrap();
    super::super::project_activity::clear_caches_for_tests();

    let blocking_provider = BlockingTurnProvider::new();
    let provider_template: Arc<dyn Provider> = Arc::new(blocking_provider.clone());
    let sessions: SessionAgents =
        Arc::new(crate::server::SessionManager::from_agents(HashMap::new()));
    let swarm_members = Arc::new(RwLock::new(HashMap::new()));
    let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");

    let server_task = tokio::spawn(handle_client(
        server_stream,
        Arc::clone(&sessions),
        broadcast::channel(8).0,
        provider_template,
        Arc::new(RwLock::new(false)),
        Arc::new(RwLock::new(String::new())),
        Arc::new(RwLock::new(0usize)),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::clone(&swarm_members),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        FileTouchService::new(),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(ClientDebugState::default())),
        broadcast::channel(8).0,
        Arc::new(RwLock::new(std::collections::VecDeque::new())),
        Arc::new(std::sync::atomic::AtomicU64::new(0)),
        broadcast::channel(8).0,
        "rayu-test".to_string(),
        "T".to_string(),
        Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        AwaitMembersRuntime::default(),
        SwarmMutationRuntime::default(),
    ));

    let (client_reader, mut client_writer) = client_stream.into_split();
    let mut client_reader = BufReader::new(client_reader);

    send_json(
        &mut client_writer,
        json!({
            "type": "subscribe",
            "id": 1,
            "working_dir": repo_dir,
            "supports_permissions": true,
            "supports_user_questions": true,
        }),
    )
    .await;
    let ServerEvent::SessionId {
        session_id: coord_sid,
    } = recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::SessionId { .. })
    })
    .await
    else {
        unreachable!();
    };
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 1 })
    })
    .await;

    // Seed an active background task for this session so we can inspect and cancel it mid-turn.
    let bg_info = crate::background::global()
        .spawn_with_notify(
            "bash",
            Some("long bash job".into()),
            &coord_sid,
            false,
            false,
            |output_path| async move {
            let _ = tokio::fs::write(&output_path, "step 1\nstep 2\n").await;
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok(TaskResult::completed(Some(0)))
        })
        .await;
    let _ = crate::background::global()
        .set_working_dir(&bg_info.task_id, repo_dir.display().to_string())
        .await;

    // Start a blocking turn that holds the `Agent` mutex continuously until released.
    let turn_started = blocking_provider.started.notified();
    send_json(
        &mut client_writer,
        json!({"type": "message", "id": 2, "content": "hold agent lock"}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), turn_started)
        .await
        .expect("blocking provider should enter complete()");

    // Verify the Agent mutex is genuinely locked right now.
    let agent_arc = sessions
        .read()
        .await
        .get(&coord_sid)
        .cloned()
        .expect("coord agent exists");
    assert!(
        agent_arc.try_lock().is_err(),
        "Agent mutex must be locked by the active turn"
    );

    // 1. GetProjectActivity responds promptly while Agent mutex is locked.
    send_json(
        &mut client_writer,
        json!({"type": "get_project_activity", "id": 10}),
    )
    .await;
    let ServerEvent::ProjectActivitySnapshot { id: Some(10), snapshot } =
        recv_until(&mut client_reader, 1_500, |e| {
            matches!(e, ServerEvent::ProjectActivitySnapshot { id: Some(10), .. })
        })
        .await
    else {
        unreachable!();
    };
    assert_eq!(snapshot.branch.as_deref(), Some("test-branch"));
    assert!(
        snapshot
            .my_swarm_members
            .iter()
            .any(|m| m.session_id == coord_sid),
        "caller session must be included"
    );
    assert!(
        snapshot
            .background_tasks
            .iter()
            .any(|t| t.task_id == bg_info.task_id && t.status == "running"),
        "running background task must appear in snapshot"
    );

    // 2. PeekSession responds promptly while Agent mutex is locked.
    super::super::live_status::append_output_tail(&coord_sid, "live peek line 1");
    send_json(
        &mut client_writer,
        json!({
            "type": "peek_session",
            "id": 11,
            "target": {"kind": "session", "session_id": coord_sid},
        }),
    )
    .await;
    let ServerEvent::SessionPeek { payload } = recv_until(&mut client_reader, 1_500, |e| {
        matches!(e, ServerEvent::SessionPeek { .. })
    })
    .await
    else {
        unreachable!();
    };
    assert!(
        payload.output_lines.iter().any(|l| l == "live peek line 1"),
        "peek payload should contain live ring-buffer tail: {:?}",
        payload.output_lines
    );

    // Stop peek cleanly.
    send_json(
        &mut client_writer,
        json!({"type": "peek_session", "id": 12, "target": null}),
    )
    .await;
    recv_until(&mut client_reader, 1_500, |e| {
        matches!(e, ServerEvent::Done { id: 12 })
    })
    .await;

    // 3. CancelBackgroundTask cancels the running bg task while Agent mutex is locked.
    send_json(
        &mut client_writer,
        json!({"type": "cancel_background_task", "id": 13, "task_id": bg_info.task_id}),
    )
    .await;
    let ServerEvent::BackgroundTaskCancelled {
        id: 13,
        task_id,
        cancelled,
        ..
    } = recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::BackgroundTaskCancelled { id: 13, .. })
    })
    .await
    else {
        unreachable!();
    };
    assert_eq!(task_id, bg_info.task_id);
    assert!(cancelled, "running background task should cancel cleanly");

    // Release the turn and shut down cleanly.
    blocking_provider.release.notify_waiters();
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 2 })
    })
    .await;

    drop(client_writer);
    drop(client_reader);
    tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server shutdown")
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn resume_session_switches_away_from_running_turn_without_cancelling_it() {
    let _lock = crate::storage::lock_test_env();
    let home = IsolatedHomeGuard::new();
    let repo_dir = home._dir.path().join("project-resume-test");
    std::fs::create_dir_all(repo_dir.join(".git")).unwrap();

    let blocking_provider = BlockingTurnProvider::new();
    let provider_template: Arc<dyn Provider> = Arc::new(blocking_provider.clone());

    // Pre-create a live target worker session on the same server.
    let worker_sid = "worker-live-target-session".to_string();
    let mut worker_session = crate::session::Session::create_with_id(
        worker_sid.clone(),
        None,
        Some("Worker Target".to_string()),
    );
    worker_session.working_dir = Some(repo_dir.display().to_string());
    let worker_registry = Registry::new(provider_template.clone()).await;
    let worker_agent = Arc::new(Mutex::new(Agent::new_with_session(
        provider_template.clone(),
        worker_registry,
        worker_session,
        None,
    )));
    let sessions: SessionAgents = Arc::new(crate::server::SessionManager::from_agents(
        HashMap::from([(worker_sid.clone(), worker_agent)]),
    ));

    let (worker_tx, mut worker_rx) = mpsc::unbounded_channel();
    tokio::spawn(async move { while worker_rx.recv().await.is_some() {} });
    let now = Instant::now();
    let swarm_members = Arc::new(RwLock::new(HashMap::from([(
        worker_sid.clone(),
        SwarmMember {
            session_id: worker_sid.clone(),
            event_tx: worker_tx,
            event_txs: HashMap::new(),
            working_dir: Some(repo_dir.clone()),
            swarm_id: None,
            swarm_enabled: true,
            status: "ready".into(),
            detail: None,
            task_label: None,
            friendly_name: Some("worker-target".into()),
            report_back_to_session_id: None,
            latest_completion_report: None,
            role: "agent".into(),
            joined_at: now,
            last_status_change: now,
            is_headless: true,
            output_tail: None,
            todo_progress: None,
            todo_items: Vec::new(),
            runtime: Default::default(),
        },
    )])));

    let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
    let server_task = tokio::spawn(handle_client(
        server_stream,
        Arc::clone(&sessions),
        broadcast::channel(8).0,
        provider_template,
        Arc::new(RwLock::new(false)),
        Arc::new(RwLock::new(String::new())),
        Arc::new(RwLock::new(0usize)),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::clone(&swarm_members),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        FileTouchService::new(),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(ClientDebugState::default())),
        broadcast::channel(8).0,
        Arc::new(RwLock::new(std::collections::VecDeque::new())),
        Arc::new(std::sync::atomic::AtomicU64::new(0)),
        broadcast::channel(8).0,
        "rayu-test".to_string(),
        "T".to_string(),
        Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        AwaitMembersRuntime::default(),
        SwarmMutationRuntime::default(),
    ));

    let (client_reader, mut client_writer) = client_stream.into_split();
    let mut client_reader = BufReader::new(client_reader);

    send_json(
        &mut client_writer,
        json!({
            "type": "subscribe",
            "id": 1,
            "working_dir": repo_dir,
            "supports_permissions": true,
            "supports_user_questions": true,
        }),
    )
    .await;
    let ServerEvent::SessionId {
        session_id: coord_sid,
    } = recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::SessionId { .. })
    })
    .await
    else {
        unreachable!();
    };
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 1 })
    })
    .await;

    // Start an in-flight turn on the coordinator session.
    let turn_started = blocking_provider.started.notified();
    send_json(
        &mut client_writer,
        json!({"type": "message", "id": 2, "content": "long running coordinator work"}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), turn_started)
        .await
        .expect("coordinator turn should start");
    assert!(!blocking_provider.completed.load(Ordering::SeqCst));

    // Switch to the worker session via ResumeSession WHILE coordinator turn is running!
    send_json(
        &mut client_writer,
        json!({
            "type": "resume_session",
            "id": 3,
            "session_id": worker_sid,
        }),
    )
    .await;
    let ServerEvent::History {
        id: 3,
        session_id: resumed_sid,
        ..
    } = recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::History { id: 3, .. })
    })
    .await
    else {
        unreachable!();
    };
    assert_eq!(resumed_sid, worker_sid);
    recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::Done { id: 3 })
    })
    .await;

    // Coordinator session MUST still be live and running (NOT cancelled or evicted!).
    assert!(
        sessions.read().await.contains_key(&coord_sid),
        "original running session must stay live on server after switch"
    );
    assert!(
        !blocking_provider.completed.load(Ordering::SeqCst),
        "original turn must still be running (not aborted)"
    );
    assert_eq!(
        swarm_members
            .read()
            .await
            .get(&coord_sid)
            .map(|m| m.status.as_str()),
        Some("running")
    );

    // Release the detached coordinator turn and verify it completes cleanly in the background.
    blocking_provider.release.notify_waiters();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if blocking_provider.completed.load(Ordering::SeqCst)
                && swarm_members
                    .read()
                    .await
                    .get(&coord_sid)
                    .is_some_and(|m| m.status == "ready")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("detached coordinator turn should finish and transition to ready");

    drop(client_writer);
    drop(client_reader);
    tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server shutdown")
        .unwrap()
        .unwrap();
}

#[derive(Clone)]
struct CrossSessionIsolationProvider {
    session_a: Arc<std::sync::Mutex<String>>,
    session_b: Arc<std::sync::Mutex<String>>,
    turn_a_started: Arc<Notify>,
    turn_a_release: Arc<Notify>,
    turn_a_finished: Arc<AtomicBool>,
    turn_a_perm_denied: Arc<AtomicBool>,
    turn_a_question_denied: Arc<AtomicBool>,
    turn_b_question_answered: Arc<AtomicBool>,
}

#[async_trait]
impl Provider for CrossSessionIsolationProvider {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
        _system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let last_text: String = messages
            .last()
            .map(|m| {
                m.content
                    .iter()
                    .filter_map(|block| match block {
                        crate::message::ContentBlock::Text { text, .. } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        if last_text.contains("TURN_A") {
            self.turn_a_started.notify_waiters();
            self.turn_a_release.notified().await;
            let sid_a = self.session_a.lock().unwrap().clone();

            // Attempt permission prompt from detached Session A: must fail
            // cleanly without emitting PermissionRequest onto B's socket.
            let perm_res = crate::tool::permission_gate::authorize_with_working_dir(
                &sid_a,
                "bash",
                &json!({"command": "echo detached"}),
                None,
            )
            .await;
            self.turn_a_perm_denied
                .store(perm_res.is_err(), Ordering::SeqCst);

            // Attempt question prompt from detached Session A: must fail
            // cleanly without emitting QuestionRequest or blocking B's slot.
            let q_input = json!({
                "questions": [{
                    "question": "Detached A question?",
                    "header": "Detached",
                    "options": [
                        {"label": "Yes", "description": "Proceed"},
                        {"label": "No", "description": "Abort"}
                    ]
                }]
            });
            let q_ctx = crate::tool::ToolContext {
                session_id: sid_a.clone(),
                message_id: "msg-a".into(),
                tool_call_id: "call-a".into(),
                working_dir: None,
                stdin_request_tx: None,
                graceful_shutdown_signal: None,
                execution_mode: crate::tool::ToolExecutionMode::AgentTurn,
            };
            let q_res = crate::tool::ask_user_question::execute_for_tests(q_input, q_ctx).await;
            self.turn_a_question_denied
                .store(q_res.is_err(), Ordering::SeqCst);

            self.turn_a_finished.store(true, Ordering::SeqCst);
            Ok(Box::pin(stream::iter(vec![
                Ok(StreamEvent::TextDelta("LEAKED_TEXT_FROM_A".into())),
                Ok(StreamEvent::MessageEnd {
                    stop_reason: Some("end_turn".into()),
                }),
            ])))
        } else {
            let sid_b = self.session_b.lock().unwrap().clone();
            let q_input = json!({
                "questions": [{
                    "question": "Choose B mode?",
                    "header": "Mode",
                    "options": [
                        {"label": "Fast", "description": "Quick mode"},
                        {"label": "Safe", "description": "Careful mode"}
                    ]
                }]
            });
            let q_ctx = crate::tool::ToolContext {
                session_id: sid_b,
                message_id: "msg-b".into(),
                tool_call_id: "call-b".into(),
                working_dir: None,
                stdin_request_tx: None,
                graceful_shutdown_signal: None,
                execution_mode: crate::tool::ToolExecutionMode::AgentTurn,
            };
            let q_out = crate::tool::ask_user_question::execute_for_tests(q_input, q_ctx).await?;
            if q_out.output.contains("Fast") {
                self.turn_b_question_answered.store(true, Ordering::SeqCst);
            }
            Ok(Box::pin(stream::iter(vec![
                Ok(StreamEvent::TextDelta("CLEAN_FROM_B".into())),
                Ok(StreamEvent::MessageEnd {
                    stop_reason: Some("end_turn".into()),
                }),
            ])))
        }
    }

    fn name(&self) -> &str {
        "cross-session-isolation-provider"
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(self.clone())
    }
}

#[tokio::test]
async fn cross_session_resume_isolates_non_member_stream_permission_question_and_stdin_prompts() {
    let _lock = crate::storage::lock_test_env();
    let home = IsolatedHomeGuard::new();
    let repo_dir = home._dir.path().join("project-isolation-test");
    std::fs::create_dir_all(repo_dir.join(".git")).unwrap();

    let session_a_slot = Arc::new(std::sync::Mutex::new(String::new()));
    let worker_sid = "session-b-isolation-target".to_string();
    let provider = CrossSessionIsolationProvider {
        session_a: Arc::clone(&session_a_slot),
        session_b: Arc::new(std::sync::Mutex::new(worker_sid.clone())),
        turn_a_started: Arc::new(Notify::new()),
        turn_a_release: Arc::new(Notify::new()),
        turn_a_finished: Arc::new(AtomicBool::new(false)),
        turn_a_perm_denied: Arc::new(AtomicBool::new(false)),
        turn_a_question_denied: Arc::new(AtomicBool::new(false)),
        turn_b_question_answered: Arc::new(AtomicBool::new(false)),
    };
    let provider_template: Arc<dyn Provider> = Arc::new(provider.clone());

    let mut worker_session = crate::session::Session::create_with_id(
        worker_sid.clone(),
        None,
        Some("Session B".to_string()),
    );
    worker_session.working_dir = Some(repo_dir.display().to_string());
    let worker_registry = Registry::new(provider_template.clone()).await;
    let worker_agent = Arc::new(Mutex::new(Agent::new_with_session(
        provider_template.clone(),
        worker_registry,
        worker_session,
        None,
    )));
    let sessions: SessionAgents = Arc::new(crate::server::SessionManager::from_agents(
        HashMap::from([(worker_sid.clone(), worker_agent)]),
    ));
    let (worker_tx, mut worker_rx) = mpsc::unbounded_channel();
    tokio::spawn(async move { while worker_rx.recv().await.is_some() {} });
    let now = Instant::now();
    let swarm_members = Arc::new(RwLock::new(HashMap::from([(
        worker_sid.clone(),
        SwarmMember {
            session_id: worker_sid.clone(),
            event_tx: worker_tx,
            event_txs: HashMap::new(),
            working_dir: Some(repo_dir.clone()),
            swarm_id: None,
            swarm_enabled: true,
            status: "ready".into(),
            detail: None,
            task_label: None,
            friendly_name: Some("session-b".into()),
            report_back_to_session_id: None,
            latest_completion_report: None,
            role: "agent".into(),
            joined_at: now,
            last_status_change: now,
            is_headless: true,
            output_tail: None,
            todo_progress: None,
            todo_items: Vec::new(),
            runtime: Default::default(),
        },
    )])));

    let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
    let server_task = tokio::spawn(handle_client(
        server_stream,
        Arc::clone(&sessions),
        broadcast::channel(8).0,
        provider_template,
        Arc::new(RwLock::new(false)),
        Arc::new(RwLock::new(String::new())),
        Arc::new(RwLock::new(0usize)),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::clone(&swarm_members),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        FileTouchService::new(),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(ClientDebugState::default())),
        broadcast::channel(8).0,
        Arc::new(RwLock::new(std::collections::VecDeque::new())),
        Arc::new(std::sync::atomic::AtomicU64::new(0)),
        broadcast::channel(8).0,
        "rayu-test".to_string(),
        "T".to_string(),
        Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        AwaitMembersRuntime::default(),
        SwarmMutationRuntime::default(),
    ));

    let (client_reader, mut client_writer) = client_stream.into_split();
    let mut client_reader = BufReader::new(client_reader);

    send_json(
        &mut client_writer,
        json!({
            "type": "subscribe",
            "id": 1,
            "working_dir": repo_dir,
            "supports_permissions": true,
            "supports_user_questions": true,
        }),
    )
    .await;
    let ServerEvent::SessionId {
        session_id: session_a,
    } = recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::SessionId { .. })
    })
    .await
    else {
        unreachable!();
    };
    *session_a_slot.lock().unwrap() = session_a.clone();
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 1 })
    })
    .await;

    // Capture Session A's stdin_request_tx before starting Turn A, and remove
    // Session A from `swarm_members` so Turn A is a NON-MEMBER turn relying on
    // `TurnEventChannel`'s fallback sink!
    let old_stdin_tx = {
        let agent_a = sessions.read().await.get(&session_a).cloned().unwrap();
        let guard = agent_a.lock().await;
        guard
            .stdin_request_tx_for_tests()
            .expect("agent A should have stdin_request_tx")
    };
    swarm_members.write().await.remove(&session_a);

    // Start Session A's turn.
    let turn_a_started = provider.turn_a_started.notified();
    send_json(
        &mut client_writer,
        json!({"type": "message", "id": 2, "content": "TURN_A"}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), turn_a_started)
        .await
        .expect("Turn A should enter complete()");

    // Switch to Session B while Turn A is running.
    send_json(
        &mut client_writer,
        json!({"type": "resume_session", "id": 3, "session_id": worker_sid}),
    )
    .await;
    recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::Done { id: 3 })
    })
    .await;

    // Fire a StdinInputRequest from Session A's old channel AND release Turn A
    // so it triggers PermissionRequest, QuestionRequest, TextDelta, and Done.
    let (stale_resp_tx, _stale_resp_rx) = tokio::sync::oneshot::channel();
    let _ = old_stdin_tx.send(crate::tool::StdinInputRequest {
        request_id: "stale-stdin-a".into(),
        prompt: "Password for A:".into(),
        is_password: true,
        response_tx: stale_resp_tx,
    });
    provider.turn_a_release.notify_waiters();

    // Wait for Turn A to finish in the background.
    tokio::time::timeout(Duration::from_secs(5), async {
        while !provider.turn_a_finished.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Turn A should finish after release");
    tokio::time::sleep(Duration::from_millis(60)).await;

    assert!(
        provider.turn_a_perm_denied.load(Ordering::SeqCst),
        "detached Turn A's permission prompt must be rejected without writing to B"
    );
    assert!(
        provider.turn_a_question_denied.load(Ordering::SeqCst),
        "detached Turn A's question prompt must be rejected without writing to B"
    );
    assert!(
        super::super::attention_registry::primary_for_session(&worker_sid).is_none(),
        "Session A's stdin/permission/question prompts must never register attention under Session B"
    );

    // Now run a real turn on Session B that asks a question and streams text!
    // While reading B's events, assert ZERO leaked events from A appear.
    send_json(
        &mut client_writer,
        json!({"type": "message", "id": 4, "content": "TURN_B"}),
    )
    .await;
    let mut saw_b_text = false;
    let mut saw_b_done = false;
    let mut saw_b_question = false;
    tokio::time::timeout(Duration::from_secs(5), async {
        while !saw_b_done {
            let mut line = String::new();
            let n = client_reader.read_line(&mut line).await.unwrap();
            assert!(n > 0, "socket closed before Turn B finished");
            let event: ServerEvent = serde_json::from_str(&line).unwrap();
            match &event {
                ServerEvent::TextDelta { text } => {
                    assert!(
                        !text.contains("LEAKED_TEXT_FROM_A"),
                        "detached non-member Turn A leaked TextDelta onto Session B's socket!"
                    );
                    if text.contains("CLEAN_FROM_B") {
                        saw_b_text = true;
                    }
                }
                ServerEvent::PermissionRequest { session_id, .. } => {
                    panic!(
                        "unexpected PermissionRequest leaked onto B's socket for session {session_id}"
                    );
                }
                ServerEvent::StdinRequest { request_id, .. } => {
                    panic!(
                        "unexpected StdinRequest ({request_id}) leaked onto B's socket from Session A"
                    );
                }
                ServerEvent::QuestionClosed { session_id, .. } if session_id == &session_a => {
                    panic!("detached Session A leaked QuestionClosed onto Session B's socket");
                }
                ServerEvent::QuestionRequest {
                    session_id,
                    request_id,
                    questions,
                    ..
                } => {
                    assert_eq!(
                        session_id, &worker_sid,
                        "QuestionRequest on B's socket must belong to Session B, not Session A"
                    );
                    saw_b_question = true;
                    let q_text = questions[0].question.clone();
                    send_json(
                        &mut client_writer,
                        json!({
                            "type": "question_response",
                            "id": 5,
                            "session_id": worker_sid,
                            "request_id": request_id,
                            "response": {
                                "kind": "answered",
                                "answers": {
                                    q_text: { "selected": [0], "custom": [] }
                                }
                            }
                        }),
                    )
                    .await;
                }
                ServerEvent::Done { id: 2 } => {
                    panic!("detached Turn A leaked Done {{ id: 2 }} onto Session B's socket!");
                }
                ServerEvent::Done { id: 4 } => {
                    saw_b_done = true;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("Turn B should complete cleanly");

    assert!(saw_b_question, "Session B must be able to ask questions cleanly");
    assert!(
        provider.turn_b_question_answered.load(Ordering::SeqCst),
        "Session B must receive its answered question"
    );
    assert!(saw_b_text, "Session B must receive its own streamed text");

    drop(client_writer);
    drop(client_reader);
    tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server shutdown")
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn rejected_cross_session_resume_keeps_running_session_attached_and_streaming() {
    let _lock = crate::storage::lock_test_env();
    let home = IsolatedHomeGuard::new();
    let repo_dir = home._dir.path().join("project-rejected-resume");
    std::fs::create_dir_all(repo_dir.join(".git")).unwrap();

    // Persist target Session B on disk (NOT in `sessions`), and register a
    // conflicting live connection claiming it so `allow_session_takeover: false`
    // rejects the resume.
    let target_b_sid = "session-b-conflicting-disk".to_string();
    let mut target_b = crate::session::Session::create_with_id(
        target_b_sid.clone(),
        None,
        Some("Conflicting B".to_string()),
    );
    target_b.working_dir = Some(repo_dir.display().to_string());
    target_b.save_prepared().expect("save target B session");

    let (other_disconnect_tx, _other_disconnect_rx) = mpsc::unbounded_channel();
    let now = Instant::now();
    let client_connections = Arc::new(RwLock::new(HashMap::from([(
        "conn-other-owner".to_string(),
        ClientConnectionInfo {
            client_id: "conn-other-owner".to_string(),
            session_id: target_b_sid.clone(),
            client_instance_id: Some("other-instance".to_string()),
            debug_client_id: None,
            connected_at: now,
            last_seen: now,
            is_processing: false,
            current_tool_name: None,
            terminal_env: Vec::new(),
            disconnect_tx: other_disconnect_tx,
        },
    )])));

    let blocking_provider = BlockingTurnProvider::new();
    let provider_template: Arc<dyn Provider> = Arc::new(blocking_provider.clone());
    let sessions: SessionAgents =
        Arc::new(crate::server::SessionManager::from_agents(HashMap::new()));
    let swarm_members = Arc::new(RwLock::new(HashMap::new()));
    let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
    let server_task = tokio::spawn(handle_client(
        server_stream,
        Arc::clone(&sessions),
        broadcast::channel(8).0,
        provider_template,
        Arc::new(RwLock::new(false)),
        Arc::new(RwLock::new(String::new())),
        Arc::new(RwLock::new(0usize)),
        Arc::clone(&client_connections),
        Arc::clone(&swarm_members),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        FileTouchService::new(),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(ClientDebugState::default())),
        broadcast::channel(8).0,
        Arc::new(RwLock::new(std::collections::VecDeque::new())),
        Arc::new(std::sync::atomic::AtomicU64::new(0)),
        broadcast::channel(8).0,
        "rayu-test".to_string(),
        "T".to_string(),
        Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        AwaitMembersRuntime::default(),
        SwarmMutationRuntime::default(),
    ));

    let (client_reader, mut client_writer) = client_stream.into_split();
    let mut client_reader = BufReader::new(client_reader);

    send_json(
        &mut client_writer,
        json!({
            "type": "subscribe",
            "id": 1,
            "working_dir": repo_dir,
            "client_instance_id": "my-instance",
        }),
    )
    .await;
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 1 })
    })
    .await;

    // Start a running turn on Session A.
    let turn_started = blocking_provider.started.notified();
    send_json(
        &mut client_writer,
        json!({"type": "message", "id": 2, "content": "stay attached on reject"}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), turn_started)
        .await
        .expect("Turn A should start");

    // Attempt ResumeSession to conflicting target B with allow_session_takeover=false.
    send_json(
        &mut client_writer,
        json!({
            "type": "resume_session",
            "id": 3,
            "session_id": target_b_sid,
            "client_instance_id": "my-instance",
            "allow_session_takeover": false,
        }),
    )
    .await;
    recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::Error { id: 3, .. })
    })
    .await;

    // Release Session A's running turn -> this client MUST still be attached to
    // Session A and receive its live TextDelta and Done events!
    blocking_provider.release.notify_waiters();
    let mut saw_text = false;
    let mut saw_done = false;
    tokio::time::timeout(Duration::from_secs(5), async {
        while !saw_done {
            let mut line = String::new();
            let n = client_reader.read_line(&mut line).await.unwrap();
            assert!(n > 0, "socket closed before Turn A finished");
            let event: ServerEvent = serde_json::from_str(&line).unwrap();
            match event {
                ServerEvent::TextDelta { text } if text.contains("blocking turn finished") => {
                    saw_text = true;
                }
                ServerEvent::Done { id: 2 } => {
                    saw_done = true;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("rejected ResumeSession must leave Session A attached and streaming");
    assert!(saw_text, "client must still receive Session A's TextDelta");

    drop(client_writer);
    drop(client_reader);
    tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server shutdown")
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn switch_back_to_running_session_then_disconnect_preserves_turn_and_retires_after_completion() {
    let _lock = crate::storage::lock_test_env();
    let _grace = super::super::client_disconnect_cleanup::DetachedRetireGraceGuard::set(
        Duration::from_millis(80),
    );
    let home = IsolatedHomeGuard::new();
    let repo_dir = home._dir.path().join("project-back-disconnect");
    std::fs::create_dir_all(repo_dir.join(".git")).unwrap();

    let blocking_provider = BlockingTurnProvider::new();
    let provider_template: Arc<dyn Provider> = Arc::new(blocking_provider.clone());

    let worker_sid = "worker-back-disconnect-b".to_string();
    let mut worker_session = crate::session::Session::create_with_id(
        worker_sid.clone(),
        None,
        Some("Worker B".to_string()),
    );
    worker_session.working_dir = Some(repo_dir.display().to_string());
    let worker_registry = Registry::new(provider_template.clone()).await;
    let worker_agent = Arc::new(Mutex::new(Agent::new_with_session(
        provider_template.clone(),
        worker_registry,
        worker_session,
        None,
    )));
    let sessions: SessionAgents = Arc::new(crate::server::SessionManager::from_agents(
        HashMap::from([(worker_sid.clone(), worker_agent)]),
    ));
    let (worker_tx, mut worker_rx) = mpsc::unbounded_channel();
    tokio::spawn(async move { while worker_rx.recv().await.is_some() {} });
    let now = Instant::now();
    let swarm_members = Arc::new(RwLock::new(HashMap::from([(
        worker_sid.clone(),
        SwarmMember {
            session_id: worker_sid.clone(),
            event_tx: worker_tx,
            event_txs: HashMap::new(),
            working_dir: Some(repo_dir.clone()),
            swarm_id: None,
            swarm_enabled: true,
            status: "ready".into(),
            detail: None,
            task_label: None,
            friendly_name: Some("worker-b".into()),
            report_back_to_session_id: None,
            latest_completion_report: None,
            role: "agent".into(),
            joined_at: now,
            last_status_change: now,
            is_headless: true,
            output_tail: None,
            todo_progress: None,
            todo_items: Vec::new(),
            runtime: Default::default(),
        },
    )])));
    let shutdown_signals = Arc::new(RwLock::new(HashMap::new()));
    let soft_interrupt_queues = Arc::new(RwLock::new(HashMap::new()));

    let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
    let server_task = tokio::spawn(handle_client(
        server_stream,
        Arc::clone(&sessions),
        broadcast::channel(8).0,
        provider_template,
        Arc::new(RwLock::new(false)),
        Arc::new(RwLock::new(String::new())),
        Arc::new(RwLock::new(0usize)),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::clone(&swarm_members),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        FileTouchService::new(),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(ClientDebugState::default())),
        broadcast::channel(8).0,
        Arc::new(RwLock::new(std::collections::VecDeque::new())),
        Arc::new(std::sync::atomic::AtomicU64::new(0)),
        broadcast::channel(8).0,
        "rayu-test".to_string(),
        "T".to_string(),
        Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
        Arc::clone(&shutdown_signals),
        Arc::clone(&soft_interrupt_queues),
        AwaitMembersRuntime::default(),
        SwarmMutationRuntime::default(),
    ));

    let (client_reader, mut client_writer) = client_stream.into_split();
    let mut client_reader = BufReader::new(client_reader);

    send_json(
        &mut client_writer,
        json!({
            "type": "subscribe",
            "id": 1,
            "working_dir": repo_dir,
            "continue_on_disconnect": false,
        }),
    )
    .await;
    let ServerEvent::SessionId {
        session_id: session_a,
    } = recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::SessionId { .. })
    })
    .await
    else {
        unreachable!();
    };
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 1 })
    })
    .await;

    // 1. Start running turn on Session A.
    let turn_started = blocking_provider.started.notified();
    send_json(
        &mut client_writer,
        json!({"type": "message", "id": 2, "content": "long running A"}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), turn_started)
        .await
        .expect("Turn A should start");

    // 2. Switch A -> B, then switch BACK B -> A while A is still running.
    send_json(
        &mut client_writer,
        json!({"type": "resume_session", "id": 3, "session_id": worker_sid}),
    )
    .await;
    recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::Done { id: 3 })
    })
    .await;

    send_json(
        &mut client_writer,
        json!({"type": "resume_session", "id": 4, "session_id": session_a}),
    )
    .await;
    recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::Done { id: 4 })
    })
    .await;

    // 3. Disconnect from A while A's detached turn is still running.
    drop(client_writer);
    drop(client_reader);
    tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server disconnect cleanup should finish promptly without 2s lock hang")
        .unwrap()
        .unwrap();

    // Session A MUST NOT be evicted mid-turn!
    assert!(
        sessions.read().await.contains_key(&session_a),
        "disconnecting after /back to running A must NOT evict A mid-turn"
    );
    assert!(
        swarm_members.read().await.contains_key(&session_a),
        "swarm_members[A] must remain live while A's turn is still executing"
    );
    assert!(
        super::super::live_status::snapshot(&session_a).is_some(),
        "live_status(A) must not be forgotten mid-turn"
    );

    // 4. Release A's turn -> A finishes and then retires cleanly after the
    // reconnect grace instead of leaking forever!
    blocking_provider.release.notify_waiters();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let done = blocking_provider.completed.load(Ordering::SeqCst);
            let session_gone = !sessions.read().await.contains_key(&session_a);
            let member_gone = !swarm_members.read().await.contains_key(&session_a);
            let signal_gone = !shutdown_signals.read().await.contains_key(&session_a);
            let queue_gone = !soft_interrupt_queues.read().await.contains_key(&session_a);
            let status_gone = super::super::live_status::snapshot(&session_a).is_none();
            if done && session_gone && member_gone && signal_gone && queue_gone && status_gone {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("unclaimed detached Session A must retire cleanly after turn completion + grace");
}

#[tokio::test]
async fn detached_session_retires_cleanly_after_turn_completion_when_client_disconnects_from_b() {
    let _lock = crate::storage::lock_test_env();
    let _grace = super::super::client_disconnect_cleanup::DetachedRetireGraceGuard::set(
        Duration::from_millis(80),
    );
    let home = IsolatedHomeGuard::new();
    let repo_dir = home._dir.path().join("project-detached-retire");
    std::fs::create_dir_all(repo_dir.join(".git")).unwrap();

    let blocking_provider = BlockingTurnProvider::new();
    let provider_template: Arc<dyn Provider> = Arc::new(blocking_provider.clone());

    let worker_sid = "worker-detached-retire-b".to_string();
    let mut worker_session = crate::session::Session::create_with_id(
        worker_sid.clone(),
        None,
        Some("Worker B".to_string()),
    );
    worker_session.working_dir = Some(repo_dir.display().to_string());
    let worker_registry = Registry::new(provider_template.clone()).await;
    let worker_agent = Arc::new(Mutex::new(Agent::new_with_session(
        provider_template.clone(),
        worker_registry,
        worker_session,
        None,
    )));
    let sessions: SessionAgents = Arc::new(crate::server::SessionManager::from_agents(
        HashMap::from([(worker_sid.clone(), worker_agent)]),
    ));
    let (worker_tx, mut worker_rx) = mpsc::unbounded_channel();
    tokio::spawn(async move { while worker_rx.recv().await.is_some() {} });
    let now = Instant::now();
    let swarm_members = Arc::new(RwLock::new(HashMap::from([(
        worker_sid.clone(),
        SwarmMember {
            session_id: worker_sid.clone(),
            event_tx: worker_tx,
            event_txs: HashMap::new(),
            working_dir: Some(repo_dir.clone()),
            swarm_id: None,
            swarm_enabled: true,
            status: "ready".into(),
            detail: None,
            task_label: None,
            friendly_name: Some("worker-b".into()),
            report_back_to_session_id: None,
            latest_completion_report: None,
            role: "agent".into(),
            joined_at: now,
            last_status_change: now,
            is_headless: true,
            output_tail: None,
            todo_progress: None,
            todo_items: Vec::new(),
            runtime: Default::default(),
        },
    )])));
    let shutdown_signals = Arc::new(RwLock::new(HashMap::new()));
    let soft_interrupt_queues = Arc::new(RwLock::new(HashMap::new()));

    let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
    let server_task = tokio::spawn(handle_client(
        server_stream,
        Arc::clone(&sessions),
        broadcast::channel(8).0,
        provider_template,
        Arc::new(RwLock::new(false)),
        Arc::new(RwLock::new(String::new())),
        Arc::new(RwLock::new(0usize)),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::clone(&swarm_members),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        FileTouchService::new(),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(ClientDebugState::default())),
        broadcast::channel(8).0,
        Arc::new(RwLock::new(std::collections::VecDeque::new())),
        Arc::new(std::sync::atomic::AtomicU64::new(0)),
        broadcast::channel(8).0,
        "rayu-test".to_string(),
        "T".to_string(),
        Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
        Arc::clone(&shutdown_signals),
        Arc::clone(&soft_interrupt_queues),
        AwaitMembersRuntime::default(),
        SwarmMutationRuntime::default(),
    ));

    let (client_reader, mut client_writer) = client_stream.into_split();
    let mut client_reader = BufReader::new(client_reader);

    send_json(
        &mut client_writer,
        json!({"type": "subscribe", "id": 1, "working_dir": repo_dir}),
    )
    .await;
    let ServerEvent::SessionId {
        session_id: session_a,
    } = recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::SessionId { .. })
    })
    .await
    else {
        unreachable!();
    };
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 1 })
    })
    .await;

    let turn_started = blocking_provider.started.notified();
    send_json(
        &mut client_writer,
        json!({"type": "message", "id": 2, "content": "detach then disconnect"}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), turn_started)
        .await
        .expect("Turn A should start");

    send_json(
        &mut client_writer,
        json!({"type": "resume_session", "id": 3, "session_id": worker_sid}),
    )
    .await;
    recv_until(&mut client_reader, 2_000, |e| {
        matches!(e, ServerEvent::Done { id: 3 })
    })
    .await;

    // Disconnect while attached to B; release A and verify A retires cleanly.
    drop(client_writer);
    drop(client_reader);
    tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server shutdown")
        .unwrap()
        .unwrap();

    blocking_provider.release.notify_waiters();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let done = blocking_provider.completed.load(Ordering::SeqCst);
            let session_gone = !sessions.read().await.contains_key(&session_a);
            let member_gone = !swarm_members.read().await.contains_key(&session_a);
            let signal_gone = !shutdown_signals.read().await.contains_key(&session_a);
            let queue_gone = !soft_interrupt_queues.read().await.contains_key(&session_a);
            if done && session_gone && member_gone && signal_gone && queue_gone {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("detached Session A must retire after turn completion + grace");
}

#[tokio::test]
async fn dropping_stdin_receiver_releases_attention_guard_immediately() {
    let sid = "sess-stdin-drop-attention-test".to_string();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ServerEvent>();
    let stdin_responses = Arc::new(Mutex::new(HashMap::new()));
    let stdin_attention_guards = Arc::new(Mutex::new(HashMap::new()));
    let (stdin_req_tx, stdin_active, stdin_forwarder) = spawn_stdin_forwarder(
        sid.clone(),
        event_tx,
        Arc::clone(&stdin_responses),
        Arc::clone(&stdin_attention_guards),
    );

    let (response_tx, response_rx) = tokio::sync::oneshot::channel();
    stdin_req_tx
        .send(crate::tool::StdinInputRequest {
            request_id: "stdin-drop-1".into(),
            prompt: "Enter passphrase:".into(),
            is_password: true,
            response_tx,
        })
        .expect("send stdin request");

    let ev = tokio::time::timeout(Duration::from_secs(2), event_rx.recv())
        .await
        .expect("StdinRequest should arrive")
        .expect("channel open");
    assert!(matches!(ev, ServerEvent::StdinRequest { ref request_id, .. } if request_id == "stdin-drop-1"));

    let active = super::super::attention_registry::primary_for_session(&sid);
    assert!(
        active.as_ref().is_some_and(|a| a.kind == crate::protocol::AgentAttentionKind::Stdin),
        "stdin attention must be active while receiver is alive"
    );

    // Simulate tool timeout or cancellation by dropping the oneshot::Receiver.
    drop(response_rx);

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let attn = super::super::attention_registry::primary_for_session(&sid);
            let resp_empty = stdin_responses.lock().await.is_empty();
            let guards_empty = stdin_attention_guards.lock().await.is_empty();
            if attn.is_none() && resp_empty && guards_empty {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("dropping stdin oneshot::Receiver must immediately release AttentionGuard");

    stdin_active.store(false, Ordering::Release);
    stdin_forwarder.abort();
    let _ = stdin_forwarder.await;
}

#[tokio::test]
async fn subscribe_project_activity_sends_exactly_one_initial_snapshot() {
    let _lock = crate::storage::lock_test_env();
    let home = IsolatedHomeGuard::new();
    let repo_dir = home._dir.path().join("project-single-sub-snap");
    std::fs::create_dir_all(repo_dir.join(".git")).unwrap();
    super::super::project_activity::clear_caches_for_tests();

    let blocking_provider = BlockingTurnProvider::new();
    let provider_template: Arc<dyn Provider> = Arc::new(blocking_provider);
    let sessions: SessionAgents =
        Arc::new(crate::server::SessionManager::from_agents(HashMap::new()));
    let swarm_members = Arc::new(RwLock::new(HashMap::new()));
    let (server_stream, client_stream) = crate::transport::Stream::pair().expect("socket pair");
    let server_task = tokio::spawn(handle_client(
        server_stream,
        Arc::clone(&sessions),
        broadcast::channel(8).0,
        provider_template,
        Arc::new(RwLock::new(false)),
        Arc::new(RwLock::new(String::new())),
        Arc::new(RwLock::new(0usize)),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::clone(&swarm_members),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        FileTouchService::new(),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(ClientDebugState::default())),
        broadcast::channel(8).0,
        Arc::new(RwLock::new(std::collections::VecDeque::new())),
        Arc::new(std::sync::atomic::AtomicU64::new(0)),
        broadcast::channel(8).0,
        "rayu-test".to_string(),
        "T".to_string(),
        Arc::new(crate::mcp::SharedMcpPool::from_default_config()),
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(RwLock::new(HashMap::new())),
        AwaitMembersRuntime::default(),
        SwarmMutationRuntime::default(),
    ));

    let (client_reader, mut client_writer) = client_stream.into_split();
    let mut client_reader = BufReader::new(client_reader);

    send_json(
        &mut client_writer,
        json!({"type": "subscribe", "id": 1, "working_dir": repo_dir}),
    )
    .await;
    let ServerEvent::SessionId { session_id: sid } = recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::SessionId { .. })
    })
    .await
    else {
        unreachable!();
    };
    recv_until(&mut client_reader, 5_000, |e| {
        matches!(e, ServerEvent::Done { id: 1 })
    })
    .await;
    // Persist the session stub so disconnect does not wait 30s in empty-session reconnect grace.
    let mut persisted = crate::session::Session::create_with_id(sid, None, None);
    persisted.working_dir = Some(repo_dir.display().to_string());
    persisted.save_prepared().expect("save prepared session");

    send_json(
        &mut client_writer,
        json!({"type": "subscribe_project_activity", "id": 20, "enabled": true}),
    )
    .await;

    // Collect events over a 350ms window after SubscribeProjectActivity and
    // verify Done { id: 20 } arrives and EXACTLY 1 ProjectActivitySnapshot is emitted.
    let mut saw_done = false;
    let mut snapshot_count = 0usize;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(350);
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        let mut line = String::new();
        match tokio::time::timeout(deadline - now, client_reader.read_line(&mut line)).await {
            Ok(Ok(n)) if n > 0 => {
                let event: ServerEvent = serde_json::from_str(&line).unwrap();
                match event {
                    ServerEvent::Done { id: 20 } => saw_done = true,
                    ServerEvent::ProjectActivitySnapshot { id: None, .. } => snapshot_count += 1,
                    _ => {}
                }
            }
            _ => break,
        }
    }
    assert!(saw_done, "SubscribeProjectActivity must reply Done");
    assert_eq!(
        snapshot_count, 1,
        "SubscribeProjectActivity {{ enabled: true }} must send exactly 1 initial snapshot, not duplicates"
    );

    drop(client_writer);
    drop(client_reader);
    tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server shutdown")
        .unwrap()
        .unwrap();
}
