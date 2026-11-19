//! Read-only backward-compatibility tests for legacy `~/.rayu/projects/` sessions in `/resume`.
use super::*;
use std::time::{Duration, SystemTime};

/// Invalidates config + session-list caches on drop so env overrides used by
/// these tests never leak into later tests sharing the process.
struct CacheReset;

impl Drop for CacheReset {
    fn drop(&mut self) {
        crate::config::Config::invalidate_cache();
        invalidate_session_list_cache();
    }
}

fn write_and_backdate(path: &Path, content: &str) -> SystemTime {
    std::fs::write(path, content).expect("write legacy transcript");
    let past = SystemTime::now() - Duration::from_secs(3600);
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("open for mtime");
    file.set_modified(past).expect("set mtime");
    drop(file);
    std::fs::metadata(path)
        .expect("stat")
        .modified()
        .expect("mtime")
}

#[test]
fn load_sessions_discovers_rayu_cli_projects_read_only_and_creates_snapshot_on_resume() {
    let _env_lock = crate::storage::lock_test_env();
    let _reset = CacheReset;
    let temp = tempfile::tempdir().expect("temp dir");
    let _home = EnvVarGuard::set_path("RAYU_HOME", temp.path());
    crate::config::Config::invalidate_cache();
    invalidate_session_list_cache();

    let project_dir = temp.path().join("projects/-tmp-legacy-app");
    let subagents_dir = project_dir.join("rayu-cli-123/subagents");
    std::fs::create_dir_all(&subagents_dir).expect("create dirs");

    let transcript_path = project_dir.join("rayu-cli-123.jsonl");
    let transcript_body = concat!(
        "{\"type\":\"user\",\"uuid\":\"u1\",\"cwd\":\"/tmp/legacy-app\",\"sessionId\":\"rayu-cli-123\",\"timestamp\":\"2026-04-04T12:00:00Z\",\"message\":{\"role\":\"user\",\"content\":\"Port old endpoints\"}}\n",
        "{\"type\":\"assistant\",\"uuid\":\"a1\",\"parentUuid\":\"u1\",\"timestamp\":\"2026-04-04T12:00:10Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Working on it\"}]}}\n"
    );
    let original_mtime = write_and_backdate(&transcript_path, transcript_body);

    // Subagent transcripts must not appear as top-level /resume entries.
    std::fs::write(
        subagents_dir.join("agent-helper.jsonl"),
        "{\"type\":\"user\",\"uuid\":\"s1\",\"sessionId\":\"agent-helper\",\"message\":{\"role\":\"user\",\"content\":\"Subagent prompt\"}}\n",
    )
    .expect("write subagent");

    let sessions = load_sessions().expect("load sessions");
    assert!(
        !sessions.iter().any(|s| s.id.contains("agent-helper")),
        "subagent transcripts must not appear in top-level picker list"
    );

    let session = sessions
        .iter()
        .find(|s| s.source == SessionSource::RayuCli)
        .expect("rayu-cli session present");
    assert_eq!(session.id, "rayu-cli:rayu-cli-123");
    assert_eq!(session.icon, "◈");
    assert_eq!(session.source.badge(), Some("◈ rayu-cli"));
    assert_eq!(session.provider_key.as_deref(), Some("rayu-cli"));
    assert_eq!(session.short_name, "legacy-app");
    assert_eq!(session.title, "Port old endpoints");

    // Resuming must create an isolated snapshot in sessions/ without mutating projects/.
    let resumed = crate::import::resolve_resume_target_to_rayu(&session.resume_target)
        .expect("resolve resume target");
    assert_eq!(
        resumed,
        ResumeTarget::RayuSession {
            session_id: crate::import::imported_claude_code_session_id("rayu-cli-123"),
        }
    );
    assert!(
        temp.path()
            .join("sessions")
            .join(format!(
                "{}.json",
                crate::import::imported_claude_code_session_id("rayu-cli-123")
            ))
            .exists()
    );
    assert_eq!(
        std::fs::read_to_string(&transcript_path).expect("re-read transcript"),
        transcript_body
    );
    assert_eq!(
        std::fs::metadata(&transcript_path)
            .expect("stat")
            .modified()
            .expect("mtime"),
        original_mtime
    );
}

#[test]
fn load_sessions_hides_rayu_cli_projects_when_external_sessions_disabled() {
    let _env_lock = crate::storage::lock_test_env();
    // Declared before the env guards so it drops after them: later tests must
    // not observe a config cached while RAYU_EXTERNAL_SESSIONS=0 was set.
    let _reset = CacheReset;
    let temp = tempfile::tempdir().expect("temp dir");
    let _home = EnvVarGuard::set_path("RAYU_HOME", temp.path());
    let _opt_out = EnvVarGuard::set_str("RAYU_EXTERNAL_SESSIONS", "0");
    crate::config::Config::invalidate_cache();
    invalidate_session_list_cache();

    let project_dir = temp.path().join("projects/-tmp-hidden-legacy");
    std::fs::create_dir_all(&project_dir).expect("create dir");
    std::fs::write(
        project_dir.join("rayu-cli-hidden.jsonl"),
        "{\"type\":\"user\",\"uuid\":\"h1\",\"cwd\":\"/tmp/hidden-legacy\",\"sessionId\":\"rayu-cli-hidden\",\"message\":{\"role\":\"user\",\"content\":\"Secret prompt\"}}\n",
    )
    .expect("write transcript");

    let sessions = load_sessions().expect("load sessions");
    assert!(!sessions.iter().any(|s| s.source == SessionSource::RayuCli));
}
