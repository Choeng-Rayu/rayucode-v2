use super::*;

struct RestoreEnv(Vec<(&'static str, Option<std::ffi::OsString>)>);

impl RestoreEnv {
    fn save(names: &[&'static str]) -> Self {
        Self(
            names
                .iter()
                .map(|&name| (name, std::env::var_os(name)))
                .collect(),
        )
    }
}

impl Drop for RestoreEnv {
    fn drop(&mut self) {
        for (name, value) in &self.0 {
            match value {
                Some(value) => crate::env::set_var(name, value),
                None => crate::env::remove_var(name),
            }
        }
    }
}

#[test]
fn preflight_cache_identity_tracks_host_release_and_binary() -> Result<()> {
    let _lock = crate::storage::lock_test_env();
    let _restore = RestoreEnv::save(&["RAYU_CLOUD_RELEASE", "RAYU_CLOUD_REMOTE_BINARY"]);
    crate::env::remove_var("RAYU_CLOUD_RELEASE");
    crate::env::remove_var("RAYU_CLOUD_REMOTE_BINARY");
    let target = Target::default();
    let initial = target.preflight_key("cloud-host")?;
    assert!(initial.starts_with("cloud-host\n"));
    assert_ne!(initial, target.preflight_key("other-host")?);
    crate::env::set_var("RAYU_CLOUD_RELEASE", "v99.0.0");
    assert_ne!(initial, target.preflight_key("cloud-host")?);
    crate::env::remove_var("RAYU_CLOUD_RELEASE");
    crate::env::set_var("RAYU_CLOUD_REMOTE_BINARY", "/other/rayu");
    assert_ne!(initial, target.preflight_key("cloud-host")?);
    Ok(())
}

#[test]
fn preflight_probes_every_required_command_once_and_reprobes_custom_binary() -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let _lock = crate::storage::lock_test_env();
    let _restore = RestoreEnv::save(&[
        "RAYU_HOME",
        "PATH",
        "RAYU_CLOUD_REMOTE_BINARY",
        "RAYU_CLOUD_FORCE_UPGRADE",
        "RAYU_CLOUD_RELEASE",
    ]);
    let dir = tempfile::tempdir()?;
    crate::env::set_var("RAYU_HOME", dir.path());
    crate::env::remove_var("RAYU_CLOUD_REMOTE_BINARY");
    crate::env::remove_var("RAYU_CLOUD_FORCE_UPGRADE");
    crate::env::remove_var("RAYU_CLOUD_RELEASE");
    let ssh = dir.path().join("ssh");
    std::fs::write(
        &ssh,
        "#!/bin/sh\nprintf 'invocation\\n' >> \"$RAYU_HOME/calls\"\nlast=\"\"\nfor arg in \"$@\"; do last=\"$arg\"; done\nprintf '%s\\n' \"$last\" > \"$RAYU_HOME/sent-script\"\n",
    )?;
    std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755))?;
    crate::env::set_var("PATH", format!("{}:/usr/bin:/bin", dir.path().display()));
    let host = "offline-fixture";
    Target::default().preflight(host)?;
    let probe = std::fs::read_to_string(dir.path().join("sent-script"))?;
    for command in REQUIRED_REMOTE_COMMANDS {
        assert!(probe.contains(&format!("cloud {command} --help")));
    }
    Target::default().preflight(host)?;
    assert_eq!(
        std::fs::read_to_string(dir.path().join("calls"))?
            .lines()
            .count(),
        1
    );
    let custom = Target {
        remote_binary: Some("/custom/rayu".into()),
        ..Target::default()
    };
    custom.preflight(host)?;
    let probe = std::fs::read_to_string(dir.path().join("sent-script"))?;
    assert!(probe.contains("/custom/rayu"));
    assert_eq!(
        std::fs::read_to_string(dir.path().join("calls"))?
            .lines()
            .count(),
        2
    );
    Ok(())
}

#[test]
fn concurrent_preflights_share_success_and_failed_checks_clear_marker() -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let _lock = crate::storage::lock_test_env();
    let _restore = RestoreEnv::save(&[
        "RAYU_HOME",
        "PATH",
        "RAYU_CLOUD_REMOTE_BINARY",
        "RAYU_CLOUD_FORCE_UPGRADE",
    ]);
    let dir = tempfile::tempdir()?;
    crate::env::set_var("RAYU_HOME", dir.path());
    crate::env::remove_var("RAYU_CLOUD_REMOTE_BINARY");
    crate::env::remove_var("RAYU_CLOUD_FORCE_UPGRADE");
    let ssh = dir.path().join("ssh");
    std::fs::write(
        &ssh,
        "#!/bin/sh\nprintf 'probe\\n' >> \"$RAYU_HOME/calls\"\nsleep 0.1\n[ ! -f \"$RAYU_HOME/fail\" ]\n",
    )?;
    std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755))?;
    crate::env::set_var("PATH", format!("{}:/usr/bin:/bin", dir.path().display()));
    std::thread::scope(|scope| {
        let first = scope.spawn(|| Target::default().preflight("offline-fixture"));
        let second = scope.spawn(|| Target::default().preflight("offline-fixture"));
        first.join().unwrap().unwrap();
        second.join().unwrap().unwrap();
    });
    assert_eq!(
        std::fs::read_to_string(dir.path().join("calls"))?
            .lines()
            .count(),
        1
    );
    crate::env::set_var("RAYU_CLOUD_FORCE_UPGRADE", "1");
    Target::default().preflight("offline-fixture")?;
    std::fs::write(dir.path().join("fail"), "")?;
    assert!(Target::default().preflight("offline-fixture").is_err());
    assert!(!super::super::preflight_marker().unwrap().exists());
    crate::env::remove_var("RAYU_CLOUD_FORCE_UPGRADE");
    let changed = Target {
        remote_binary: Some("different-rayu".into()),
        ..Target::default()
    };
    assert!(changed.preflight("offline-fixture").is_err());
    assert!(!super::super::preflight_marker().unwrap().exists());
    Ok(())
}

fn scripted_target(script: &str) -> Result<(tempfile::TempDir, Target)> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("transport.sh");
    std::fs::write(&path, script)?;
    let target = Target {
        transport: Some(format!("/bin/sh {}", path.display())),
        ..Target::default()
    };
    Ok((dir, target))
}

#[test]
fn ssh_retry_reports_the_underlying_failure() {
    let message = ssh_retry_message("cloud-host", 1, b"ssh: authentication failed\n");
    assert!(message.contains("retrying (1/3)"));
    assert!(message.ends_with("ssh: authentication failed"));
    assert!(!message.contains("dropped"));
    assert_eq!(
        ssh_retry_message("host", 2, b" \n"),
        "connection to `host` failed, retrying (2/3)"
    );
}

fn account() -> CloudAccount {
    CloudAccount {
        provider: transfer::TransferProvider::OpenAi,
        label: "test-account".to_string(),
    }
}

#[test]
fn custom_transport_preserves_remote_argument_quoting() -> Result<()> {
    let target = Target {
        transport: Some("/bin/sh -c".to_string()),
        remote_binary: Some("/a directory/rayu".to_string()),
        ..Target::default()
    };
    let command = target.remote_command("unused", &["cloud", "a'b", "two words"])?;
    let args: Vec<_> = command.get_args().collect();
    assert_eq!(args.len(), 2);
    let script = args[1].to_string_lossy();
    assert!(script.contains(&shell_quote("/a directory/rayu")));
    assert!(script.ends_with(&format!(
        "{} {} {}",
        shell_quote("cloud"),
        shell_quote("a'b"),
        shell_quote("two words")
    )));
    Ok(())
}

#[test]
fn empty_custom_transport_is_an_error() {
    let target = Target {
        transport: Some("  ".to_string()),
        ..Target::default()
    };
    assert!(target.remote_command("unused", &["cloud"]).is_err());
}

#[test]
fn ssh_drop_is_distinct_from_remote_command_failure() -> Result<()> {
    let (_drop_dir, dropped) = scripted_target("exit 255\n")?;
    let drop_error = dropped
        .run_remote("unused", &["cloud", "receive"], None)
        .expect_err("SSH drop must fail");
    assert!(drop_error.downcast_ref::<SshDropped>().is_some());
    let (_fail_dir, failed) = scripted_target("printf 'remote failure' >&2\nexit 42\n")?;
    let mut attempts = 0;
    let result = retry_ssh("unused", "test", || {
        attempts += 1;
        failed.run_remote("unused", &["cloud", "receive"], None)
    });
    let error = result.expect_err("remote command failure must fail");
    assert!(error.downcast_ref::<SshDropped>().is_none());
    assert!(error.to_string().contains("remote failure"));
    assert_eq!(attempts, 1);
    Ok(())
}

#[test]
fn credential_import_rejects_unexpected_output_without_disclosing_it() -> Result<()> {
    let (_dir, target) = scripted_target("cat >/dev/null\nprintf 'private response'\n")?;
    let error = target
        .exchange_credentials("unused", &account(), Some(b"credential"))
        .expect_err("imports must not produce output");
    assert!(
        error
            .to_string()
            .contains("unexpected cloud credential import response")
    );
    assert!(!format!("{error:#}").contains("private response"));
    Ok(())
}

#[test]
fn credential_export_returns_private_bytes() -> Result<()> {
    let (_dir, target) = scripted_target("printf 'private response'\n")?;
    let bytes = target.exchange_credentials("unused", &account(), None)?;
    assert_eq!(bytes, b"private response");
    Ok(())
}

#[test]
fn credential_failures_do_not_echo_remote_secrets() -> Result<()> {
    let (_dir, target) =
        scripted_target("cat >/dev/null\nprintf 'private failure' >&2\nexit 42\n")?;
    let credential_error = target
        .exchange_credentials("unused", &account(), Some(b"credential"))
        .expect_err("failed credential import must fail");
    let router_error = target
        .send_router_credentials("unused", b"credential")
        .expect_err("failed router import must fail");
    assert!(!format!("{credential_error:#}").contains("private failure"));
    assert!(!format!("{router_error:#}").contains("private failure"));
    Ok(())
}
