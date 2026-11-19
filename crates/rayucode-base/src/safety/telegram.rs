//! Single-use decisions shared by the permissions TUI and the Telegram bridge.

use std::path::PathBuf;

use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};

use super::{Decision, PermissionRequest};

const PREFIX: &str = "telegram-";

#[derive(Deserialize, Serialize)]
pub struct Approval {
    pub request: PermissionRequest,
    pub generation: uuid::Uuid,
    pub decision: Option<Decision>,
}

pub fn manages(id: &str) -> bool {
    id.strip_prefix(PREFIX)
        .is_some_and(|suffix| uuid::Uuid::parse_str(suffix).is_ok())
}

pub fn new_id() -> String {
    format!("{PREFIX}{}", uuid::Uuid::new_v4())
}

fn dir() -> Result<PathBuf> {
    Ok(crate::storage::rayu_dir()?.join("telegram-approvals"))
}

fn path(id: &str) -> Result<PathBuf> {
    ensure!(manages(id), "Invalid Telegram permission ID");
    Ok(dir()?.join(format!("{id}.json")))
}

pub fn publish(approval: &Approval) -> Result<()> {
    crate::storage::ensure_dir(&dir()?)?;
    crate::storage::write_json_secret(&path(&approval.request.id)?, approval)
}

pub fn read(id: &str) -> Result<Approval> {
    crate::storage::read_json(&path(id)?)
}

fn live(approval: &Approval) -> bool {
    approval.request.created_at + chrono::Duration::minutes(2) > chrono::Utc::now()
}

pub fn pending() -> Vec<Approval> {
    let Ok(dir) = dir() else { return Vec::new() };
    let Ok(entries) = dir.read_dir() else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()?.to_str()? != "json" {
                return None;
            }
            let id = path.file_stem()?.to_str()?;
            let approval = read(id).ok()?;
            (live(&approval) && approval.decision.is_none()).then_some(approval)
        })
        .collect()
}

pub fn decide(
    id: &str,
    approved: bool,
    via: &str,
    message: Option<String>,
    generation: Option<uuid::Uuid>,
) -> Result<()> {
    let guard = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir()?.join("decisions.lock"))?;
    guard.lock()?;
    let mut approval = read(id)?;
    ensure!(
        live(&approval) && approval.decision.is_none(),
        "This permission request has closed"
    );
    ensure!(
        generation.is_none_or(|generation| generation == approval.generation),
        "This request belongs to a different Telegram link"
    );
    approval.decision = Some(Decision {
        request_id: id.into(),
        approved,
        decided_at: chrono::Utc::now(),
        decided_via: via.into(),
        message,
    });
    publish(&approval)
}

pub fn remove(id: &str) {
    let (Ok(dir), Ok(path)) = (dir(), path(id)) else {
        return;
    };
    if let Ok(guard) = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("decisions.lock"))
        && guard.lock().is_ok()
    {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_and_telegram_cannot_both_resolve_the_same_request() -> Result<()> {
        let _sandbox = crate::auth::test_sandbox::AuthTestSandbox::new()?;
        let id = new_id();
        let generation = uuid::Uuid::new_v4();
        let mut request = PermissionRequest {
            id: id.clone(),
            action: "write".into(),
            description: "fixture".into(),
            rationale: "fixture".into(),
            urgency: super::super::Urgency::Normal,
            wait: true,
            created_at: chrono::Utc::now(),
            context: None,
        };
        publish(&Approval {
            request: request.clone(),
            generation,
            decision: None,
        })?;
        assert!(decide(&id, true, "telegram", None, Some(uuid::Uuid::new_v4())).is_err());
        let (terminal, remote) = std::thread::scope(|scope| {
            let terminal = scope.spawn(|| {
                super::super::record_permission_via_file(&id, false, "permissions_tui", None)
            });
            let remote = scope.spawn(|| decide(&id, true, "telegram", None, Some(generation)));
            (terminal.join().unwrap(), remote.join().unwrap())
        });
        assert_ne!(terminal.is_ok(), remote.is_ok());
        assert_eq!(read(&id)?.decision.unwrap().approved, remote.is_ok());
        remove(&id);

        request.created_at -= chrono::Duration::minutes(3);
        publish(&Approval {
            request,
            generation,
            decision: None,
        })?;
        assert!(decide(&id, true, "telegram", None, Some(generation)).is_err());
        assert!(pending().is_empty());
        Ok(())
    }
}
