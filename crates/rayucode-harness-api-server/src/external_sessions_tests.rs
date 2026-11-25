use super::*;
use rayucode_base::message::{ContentBlock, Role};
use rayucode_base::session::{Session, StoredMessage};
use serde_json::json;
use std::ffi::OsString;
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UnixListener;

struct EnvGuard {
    key: &'static str,
    prev: Option<OsString>,
}

impl EnvGuard {
    fn set_path(key: &'static str, path: &Path) -> Self {
        let prev = std::env::var_os(key);
        unsafe { std::env::set_var(key, path) };
        Self { key, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.prev.take() {
            Some(val) => unsafe { std::env::set_var(self.key, val) },
            None => unsafe { std::env::remove_var(self.key) },
        }
    }
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn external_sessions_rpc_discovery_dedup_projects_and_conflict_import() {
    let _lock = translate::rayu_home_test_lock();
    let root = std::env::temp_dir().join(format!(
        "rayu-ext-server-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let _home = EnvGuard::set_path("RAYU_HOME", &root);

    let claude_desktop_dir = root.join("claude-desktop-sessions");
    let _claude_desk = EnvGuard::set_path("RAYU_CLAUDE_DESKTOP_SESSIONS_DIR", &claude_desktop_dir);

    // 1. Seed a native saved Rayu session.
    let mut native = Session::create_with_id("session_saved_1".to_string(), None, Some("Saved native".into()));
    native.saved = true;
    native.working_dir = Some("/repo/app".to_string());
    native.append_stored_message(StoredMessage {
        id: "m1".to_string(),
        role: Role::User,
        content: vec![ContentBlock::Text {
            text: "Hello native".to_string(),
            cache_control: None,
        }],
        display_role: None,
        timestamp: None,
        tool_duration_ms: None,
        token_usage: None,
    });
    native.save().unwrap();

    // 2. Seed external Codex Desktop session + global state.
    let codex_transcript = root.join("external/.codex/sessions/2026/11/25/rollout-1.jsonl");
    write_file(
        &codex_transcript,
        concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-desk-42\",\"timestamp\":\"2026-11-25T10:00:00Z\",\"cwd\":\"/repo/app\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Ship desktop sync\"}]}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"On it\"}]}}\n"
        ),
    );
    write_file(
        &root.join("external/.codex/.codex-global-state.json"),
        &json!({
            "electron-saved-workspace-roots": ["/repo/app"],
            "thread-titles": {
                "titles": { "codex-desk-42": "Desktop Sync Plan" }
            }
        })
        .to_string(),
    );

    // 3. Seed external Claude Desktop session.
    let claude_transcript = root.join("external/.claude/projects/-repo-web/cc-desk-7.jsonl");
    write_file(
        &claude_transcript,
        concat!(
            "{\"type\":\"user\",\"uuid\":\"u1\",\"sessionId\":\"cc-desk-7\",\"cwd\":\"/repo/web\",\"message\":{\"role\":\"user\",\"content\":\"Polish sidebar\"},\"timestamp\":\"2026-11-25T11:00:00Z\"}\n",
            "{\"type\":\"assistant\",\"uuid\":\"a1\",\"parentUuid\":\"u1\",\"sessionId\":\"cc-desk-7\",\"cwd\":\"/repo/web\",\"message\":{\"role\":\"assistant\",\"content\":\"Done\"},\"timestamp\":\"2026-11-25T11:00:05Z\"}\n"
        ),
    );
    write_file(
        &root.join("external/.claude/projects/-repo-web/sessions-index.json"),
        &json!({
            "version": 1,
            "entries": [{
                "sessionId": "cc-desk-7",
                "fullPath": claude_transcript.to_string_lossy(),
                "firstPrompt": "Polish sidebar",
                "messageCount": 2,
                "created": "2026-11-25T11:00:00Z",
                "modified": "2026-11-25T11:00:05Z",
                "projectPath": "/repo/web"
            }]
        })
        .to_string(),
    );
    write_file(
        &claude_desktop_dir.join("org/local_cc-desk-7.json"),
        &json!({
            "cliSessionId": "cc-desk-7",
            "cwd": "/repo/web",
            "projectName": "Web Portal",
            "title": "Sidebar Polish"
        })
        .to_string(),
    );

    // 4. Spin up live bridge over duplex stream + fake daemon socket.
    let daemon_sock = root.join("daemon.sock");
    let listener = UnixListener::bind(&daemon_sock).unwrap();
    let (client, bridge) = tokio::io::duplex(256 * 1024);
    let (bridge_read, bridge_write) = tokio::io::split(bridge);
    let bridge_task = tokio::spawn(run_bridge_stream(bridge_read, bridge_write, daemon_sock.clone()));
    let (client_read, mut client_write) = tokio::io::split(client);
    let mut replies = BufReader::new(client_read).lines();

    // Handshake advertises external_sessions.
    write_json_line(
        &mut client_write,
        &json!({"v":1,"id":1,"req":"hello","min_version":1,"max_version":1,"client":"ext-test"}),
    )
    .await
    .unwrap();
    let (_daemon_stream, _) = listener.accept().await.unwrap();
    let hello: Value = serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(hello["ev"], "hello_ok");
    assert!(
        hello["capabilities"]
            .as_array()
            .is_some_and(|caps| caps.iter().any(|cap| cap == "external_sessions")),
        "hello_ok must advertise external_sessions capability"
    );

    // ListSessions with include_external=false returns only native sessions.
    write_json_line(
        &mut client_write,
        &json!({"v":1,"id":2,"req":"list_sessions"}),
    )
    .await
    .unwrap();
    let list_native: Value =
        serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(list_native["ev"], "sessions");
    assert_eq!(list_native["sessions"].as_array().unwrap().len(), 1);

    // ListSessions with include_external=true returns saved native first + external Codex & Claude Desktop.
    write_json_line(
        &mut client_write,
        &json!({"v":1,"id":3,"req":"list_sessions","include_external":true}),
    )
    .await
    .unwrap();
    let list_all: Value =
        serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    let sessions = list_all["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 3);
    assert_eq!(sessions[0]["session_id"], "session_saved_1");
    assert!(sessions.iter().any(|s| {
        s["source"] == "codex_desktop"
            && s["external_session_id"] == "codex-desk-42"
            && s["external_project_name"] == "app"
            && s["title"] == "Desktop Sync Plan"
            && s.get("imported").is_none()
    }));
    assert!(sessions.iter().any(|s| {
        s["source"] == "claude_desktop"
            && s["external_session_id"] == "cc-desk-7"
            && s["external_project_name"] == "Web Portal"
            && s["title"] == "Sidebar Polish"
    }));

    // ListExternalProjects filters cleanly by source group alias "codex".
    write_json_line(
        &mut client_write,
        &json!({"v":1,"id":4,"req":"list_external_projects","source":"codex"}),
    )
    .await
    .unwrap();
    let projects_ev: Value =
        serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(projects_ev["ev"], "external_projects");
    let projects = projects_ev["projects"].as_array().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0]["source"], "codex_desktop");
    assert_eq!(projects[0]["name"], "app");
    assert_eq!(projects[0]["session_count"], 1);

    // ImportExternalSessions materializes codex-desk-42 into imported_codex_codex-desk-42.
    write_json_line(
        &mut client_write,
        &json!({
            "v": 1,
            "id": 5,
            "req": "import_external_sessions",
            "items": [{
                "source": "codex_desktop",
                "external_session_id": "codex-desk-42",
                "external_path": codex_transcript.to_string_lossy()
            }]
        }),
    )
    .await
    .unwrap();
    let imported_ev: Value =
        serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(imported_ev["ev"], "external_sessions_imported");
    assert_eq!(imported_ev["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(imported_ev["skipped"].as_array().unwrap().len(), 0);
    assert_eq!(
        imported_ev["sessions"][0]["session_id"],
        "imported_codex_codex-desk-42"
    );
    assert_eq!(imported_ev["sessions"][0]["imported"], true);
    assert_eq!(imported_ev["sessions"][0]["source"], "codex_desktop");

    // ListSessions with include_external=false enriches already-imported session with source & imported=true.
    write_json_line(
        &mut client_write,
        &json!({"v":1,"id":6,"req":"list_sessions"}),
    )
    .await
    .unwrap();
    let list_after_import_native: Value =
        serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    let imported_row = list_after_import_native["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["session_id"] == "imported_codex_codex-desk-42")
        .expect("imported session visible in native list");
    assert_eq!(imported_row["source"], "codex");
    assert_eq!(imported_row["imported"], true);

    // ListSessions with include_external=true deduplicates (still 3 rows total, not 4!).
    write_json_line(
        &mut client_write,
        &json!({"v":1,"id":7,"req":"list_sessions","include_external":true}),
    )
    .await
    .unwrap();
    let list_after_import_ext: Value =
        serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    let dedup_sessions = list_after_import_ext["sessions"].as_array().unwrap();
    assert_eq!(dedup_sessions.len(), 3, "no duplicate row after import");
    let merged_codex = dedup_sessions
        .iter()
        .find(|s| s["session_id"] == "imported_codex_codex-desk-42")
        .expect("merged codex row");
    assert_eq!(merged_codex["source"], "codex_desktop");
    assert_eq!(merged_codex["imported"], true);
    assert_eq!(merged_codex["external_project_name"], "app");

    // Add a local Rayu user turn and attempt re-sync without force/fork -> conflict!
    let mut local = Session::load("imported_codex_codex-desk-42").unwrap();
    local.append_stored_message(StoredMessage {
        id: "local-turn-2".to_string(),
        role: Role::User,
        content: vec![ContentBlock::Text {
            text: "Local follow-up in Rayu".to_string(),
            cache_control: None,
        }],
        display_role: None,
        timestamp: None,
        tool_duration_ms: None,
        token_usage: None,
    });
    local.save().unwrap();

    write_json_line(
        &mut client_write,
        &json!({
            "v": 1,
            "id": 8,
            "req": "import_external_sessions",
            "items": [{
                "source": "codex_desktop",
                "external_session_id": "codex-desk-42",
                "external_path": codex_transcript.to_string_lossy()
            }]
        }),
    )
    .await
    .unwrap();
    let conflict_ev: Value =
        serde_json::from_str(&replies.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(conflict_ev["ev"], "external_sessions_imported");
    assert_eq!(conflict_ev["sessions"].as_array().unwrap().len(), 0);
    assert_eq!(conflict_ev["skipped"].as_array().unwrap().len(), 1);
    assert_eq!(conflict_ev["skipped"][0]["reason"], "conflict");
    assert_eq!(
        conflict_ev["skipped"][0]["existing_session_id"],
        "imported_codex_codex-desk-42"
    );

    drop(client_write);
    drop(replies);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), bridge_task).await;
    drop(listener);
    let _ = std::fs::remove_dir_all(&root);
}
