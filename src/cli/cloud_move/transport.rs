//! SSH transport, host capability checks, and private credential channels.

#[cfg(all(test, unix))]
mod tests;

use super::{
    CloudAccount, REQUIRED_REMOTE_COMMANDS, preflight_is_fresh, record_preflight, shell_quote,
    step, timed_move_stage,
};
use crate::auth::transfer;
use anyhow::{Context, Result, bail};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

/// `ssh` exits 255 for connection-level failures (DNS, refused, reset, timeout
/// while the machine wakes). Those are safe to retry for idempotent calls.
const SSH_CONNECTION_FAILURE: i32 = 255;
const SSH_ATTEMPTS: u32 = 3;

fn ssh_connection_failed(status: &std::process::ExitStatus) -> bool {
    status.code() == Some(SSH_CONNECTION_FAILURE)
}

/// Marks an SSH transport drop (exit 255) so idempotent steps can retry.
#[derive(Debug)]
struct SshDropped(String);

impl std::fmt::Display for SshDropped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SshDropped {}

/// Retry an idempotent remote step when only the SSH connection dropped.
pub(super) fn retry_ssh<T>(host: &str, what: &str, mut op: impl FnMut() -> Result<T>) -> Result<T> {
    let mut attempt = 1;
    loop {
        match op() {
            Err(error)
                if error.downcast_ref::<SshDropped>().is_some() && attempt < SSH_ATTEMPTS =>
            {
                step(
                    "transfer",
                    &format!(
                        "connection to `{host}` dropped during {what}, retrying ({attempt}/{SSH_ATTEMPTS})"
                    ),
                );
                std::thread::sleep(std::time::Duration::from_secs(2 * attempt as u64));
                attempt += 1;
            }
            other => return other,
        }
    }
}

/// Preserve SSH diagnostics instead of reporting every failure as a drop.
fn ssh_retry_message(host: &str, attempt: u32, stderr: &[u8]) -> String {
    let reason = String::from_utf8_lossy(stderr);
    let reason = reason.trim();
    let message = format!("connection to `{host}` failed, retrying ({attempt}/{SSH_ATTEMPTS})");
    if reason.is_empty() {
        message
    } else {
        format!("{message}: {reason}")
    }
}

/// Run an idempotent remote command, retrying connection-level SSH failures
/// with a short backoff. Remote command failures are returned immediately.
fn output_with_ssh_retry(
    mut build: impl FnMut() -> Result<Command>,
    host: &str,
) -> Result<std::process::Output> {
    let mut attempt = 1;
    loop {
        let output = build()?
            .output()
            .with_context(|| format!("failed to reach cloud host `{host}`"))?;
        if output.status.success()
            || !ssh_connection_failed(&output.status)
            || attempt >= SSH_ATTEMPTS
        {
            return Ok(output);
        }
        step("prepare", &ssh_retry_message(host, attempt, &output.stderr));
        std::thread::sleep(std::time::Duration::from_secs(2 * attempt as u64));
        attempt += 1;
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Target {
    pub host: Option<String>,
    pub remote_binary: Option<String>,
    pub transport: Option<String>,
}

impl Target {
    pub(super) fn resolve_host(&self) -> Result<String> {
        if let Some(host) = self.host.clone().filter(|h| !h.trim().is_empty()) {
            return Ok(host);
        }
        if let Ok(host) = std::env::var("RAYU_CLOUD_HOST")
            && !host.trim().is_empty()
        {
            return Ok(host);
        }
        bail!("no cloud host: pass --host <ssh-alias> or set RAYU_CLOUD_HOST")
    }

    pub(super) fn remote_binary(&self) -> String {
        self.remote_binary
            .clone()
            .or_else(|| match std::env::var("RAYU_CLOUD_REMOTE_BINARY") {
                Ok(binary) => Some(binary),
                Err(std::env::VarError::NotPresent) => None,
                Err(std::env::VarError::NotUnicode(_)) => {
                    crate::logging::info(
                        "cloud move: ignoring non-Unicode RAYU_CLOUD_REMOTE_BINARY",
                    );
                    None
                }
            })
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "rayu".to_string())
    }

    /// Fail fast, with an actionable message, when the cloud host's rayu is
    /// too old to speak the move protocol.
    pub(super) fn preflight(&self, host: &str) -> Result<()> {
        // Lock across the cache check and preparation, including other CLI
        // processes. Waiters reuse only a fully successful preflight.
        let _guard = if self.transport.is_none() {
            Some(timed_move_stage("preflight singleflight wait", || {
                let home = crate::storage::rayu_dir()?;
                std::fs::create_dir_all(&home).context("create cloud preflight directory")?;
                let path = home.join("cloud-preflight.lock");
                let file = std::fs::OpenOptions::new()
                    .create(true)
                    .truncate(false)
                    .write(true)
                    .open(path)?;
                file.lock().context("lock cloud preflight")?;
                Ok::<_, anyhow::Error>(file)
            })?)
        } else {
            None
        };
        let key = self.preflight_key(host)?;
        if self.transport.is_none()
            && std::env::var("RAYU_CLOUD_FORCE_UPGRADE").as_deref() != Ok("1")
            && preflight_is_fresh(&key)
        {
            crate::logging::info("cloud move: host preflight skipped, prepared moments ago");
            return Ok(());
        }
        let result = self.preflight_uncached(host);
        if result.is_ok() && self.transport.is_none() {
            record_preflight(&key);
        } else if result.is_err() && self.transport.is_none() {
            // An old marker must not survive a failed verification.
            if let Some(path) = super::preflight_marker() {
                let _ = std::fs::remove_file(path);
            }
        }
        result
    }

    fn preflight_key(&self, host: &str) -> Result<String> {
        let exe = std::env::current_exe().context("locate preflight client")?;
        // A running daemon's executable can have been replaced by an update.
        // Its compiled identity still scopes evidence even when that old path
        // no longer has metadata.
        let metadata = exe.metadata().ok().map(|m| (m.len(), m.modified().ok()));
        Ok(format!(
            "{host}\n{}\n{}\n{:?}\n{:?}\n{}\n{:?}\n{}\n{}\n{}",
            self.remote_binary(),
            REQUIRED_REMOTE_COMMANDS.join(","),
            std::env::var_os("RAYU_CLOUD_RELEASE"),
            std::env::var_os("RAYU_CLOUD_FORCE_UPGRADE"),
            exe.display(),
            metadata,
            rayucode_build_meta::VERSION,
            rayucode_build_meta::GIT_HASH,
            rayucode_build_meta::semver(),
        ))
    }

    fn preflight_uncached(&self, host: &str) -> Result<()> {
        timed_move_stage("host preflight", || {
            // Preserve custom transports that only support one remote invocation.
            if self.transport.is_none() {
                let binary = shell_quote(&self.remote_binary());
                let mut script =
                    String::from("PATH=\"$HOME/.local/bin:$HOME/.cargo/bin:$PATH\"; export PATH\n");
                // Distinguish a missing or broken binary (exit 127/126, or a
                // dangling wrapper target) from an old one lacking a command.
                script.push_str(&format!(
                    "version=$({binary} --no-update --no-selfdev --version 2>&1) || {{ printf 'cloud rayu is not runnable: %s\\n' \"$version\" >&2; exit 3; }}\n"
                ));
                for command in REQUIRED_REMOTE_COMMANDS {
                    script.push_str(&format!(
                    "out=$({binary} --no-update --no-selfdev cloud {command} --help 2>&1 >/dev/null) || {{ printf '%s\\ncloud protocol probe failed: {command} (remote %s)\\n' \"$out\" \"$version\" >&2; exit 4; }}\n"
                ));
                }
                let output = timed_move_stage("host capability verification", || {
                    output_with_ssh_retry(
                        || {
                            let mut command = Self::ssh_command(host)?;
                            command
                                .arg(&script)
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::piped());
                            Ok(command)
                        },
                        host,
                    )
                })?;
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return match output.status.code() {
                    Some(0) => Ok(()),
                    Some(3) => bail!(
                        "rayu on `{host}` could not start. Reinstall it there (or pass --remote-binary / set RAYU_CLOUD_REMOTE_BINARY): {stderr}"
                    ),
                    Some(4) => bail!(
                        "rayu on `{host}` is too old for cloud handoff. Update rayu on the cloud host (or pass --remote-binary / set RAYU_CLOUD_REMOTE_BINARY to a newer build): {stderr}"
                    ),
                    Some(SSH_CONNECTION_FAILURE) => bail!(
                        "could not connect to cloud host `{host}` after {SSH_ATTEMPTS} attempts: {stderr}"
                    ),
                    _ => bail!(
                        "could not run rayu on `{host}` ({}): {stderr}",
                        output.status
                    ),
                };
            }
            for command in REQUIRED_REMOTE_COMMANDS {
                if let Err(error) = self.run_remote(host, &["cloud", command, "--help"], None) {
                    let text = format!("{error:#}");
                    if text.contains("unrecognized") {
                        bail!(
                            "rayu on `{host}` does not support the complete cloud handoff protocol (`{command}`). Update rayu on the cloud host (or pass --remote-binary / set RAYU_CLOUD_REMOTE_BINARY to a newer build)"
                        );
                    }
                    return Err(error.context(format!("could not run rayu on `{host}`")));
                }
            }
            Ok(())
        })
    }

    /// `ssh` with the options every cloud call uses.
    pub(super) fn ssh_command(host: &str) -> Result<Command> {
        let mut command = Command::new("ssh");
        command.args(["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "--"]);
        command.arg(host);
        Ok(command)
    }

    pub(super) fn remote_command(&self, host: &str, args: &[&str]) -> Result<Command> {
        let binary = shell_quote(&self.remote_binary());
        let quoted: Vec<String> = args.iter().map(|arg| shell_quote(arg)).collect();
        let remote_cmd = format!(
            "PATH=\"$HOME/.local/bin:$HOME/.cargo/bin:$PATH\"; export PATH; exec {binary} --no-update --no-selfdev {}",
            quoted.join(" ")
        );
        let command = match self.transport.as_deref() {
            Some(transport) => {
                let mut parts = transport.split_whitespace();
                let program = parts
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("empty --transport"))?;
                let mut command = Command::new(program);
                command.args(parts).arg(&remote_cmd);
                command
            }
            None => {
                let mut command = Self::ssh_command(host)?;
                command.arg(&remote_cmd);
                command
            }
        };
        Ok(command)
    }

    /// Run `rayu <args>` on the target, feeding `stdin` and returning stdout.
    pub(super) fn run_remote(
        &self,
        host: &str,
        args: &[&str],
        stdin: Option<&Path>,
    ) -> Result<Vec<u8>> {
        let mut command = self.remote_command(host, args)?;
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        command.stdin(match stdin {
            Some(path) => Stdio::from(
                std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?,
            ),
            None => Stdio::null(),
        });
        let output = command
            .output()
            .with_context(|| format!("failed to reach cloud host `{host}`"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if ssh_connection_failed(&output.status) {
                return Err(SshDropped(format!(
                    "lost the connection to cloud host `{host}`: {stderr}"
                ))
                .into());
            }
            bail!(
                "remote `rayu {}` on `{host}` failed ({}):\n{stderr}",
                args.iter().take(2).copied().collect::<Vec<_>>().join(" "),
                output.status,
            );
        }
        Ok(output.stdout)
    }

    /// Same private channel as [`Self::exchange_credentials`], for the router
    /// bundle. Remote stderr is discarded and output is not expected.
    pub(super) fn send_router_credentials(&self, host: &str, payload: &[u8]) -> Result<()> {
        let mut command = self.remote_command(host, &["cloud", "router-credentials"])?;
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command
            .spawn()
            .context("start private router credential transfer")?;
        let written = child
            .stdin
            .take()
            .context("router credential stdin")?
            .write_all(payload);
        let status = child
            .wait()
            .context("wait for router credential transfer")?;
        if written.is_ok() && ssh_connection_failed(&status) {
            return Err(SshDropped(format!(
                "lost the connection to cloud host `{host}` during provider key transfer"
            ))
            .into());
        }
        if written.is_err() || !status.success() {
            bail!("provider key transfer failed ({status}); the session was not moved");
        }
        Ok(())
    }

    /// Secrets travel only in an SSH pipe, never argv, a temporary file, or the
    /// session archive. Discard remote stderr: even a broken transport must not
    /// reflect a credential into the local transcript or logs.
    pub(super) fn exchange_credentials(
        &self,
        host: &str,
        account: &CloudAccount,
        payload: Option<&[u8]>,
    ) -> Result<Vec<u8>> {
        let mut args = vec![
            "cloud",
            "credentials",
            "--provider",
            account.provider.as_str(),
            "--account",
            account.label.as_str(),
        ];
        if payload.is_none() {
            args.push("--export");
        }
        let mut command = self.remote_command(host, &args)?;
        command.stdin(if payload.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
        command.stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = command
            .spawn()
            .context("start private cloud credential transfer")?;
        let result = std::thread::scope(|scope| -> Result<Vec<u8>> {
            let writer = if let Some(bytes) = payload {
                let mut stdin = child.stdin.take().context("piped credential stdin")?;
                Some(scope.spawn(move || stdin.write_all(bytes)))
            } else {
                None
            };
            let mut bytes = Vec::new();
            child
                .stdout
                .take()
                .context("cloud credential stdout")?
                .take((transfer::MAX_TRANSFER_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| anyhow::anyhow!("could not read cloud credential response"))?;
            if bytes.len() > transfer::MAX_TRANSFER_BYTES {
                kill_credential_child(&mut child);
                bail!("cloud credential response exceeds the size limit");
            }
            if let Some(writer) = writer {
                writer
                    .join()
                    .map_err(|_| anyhow::anyhow!("cloud credential writer failed"))?
                    .map_err(|_| anyhow::anyhow!("could not send cloud credentials"))?;
            }
            let status = child.wait().context("wait for cloud credential transfer")?;
            if ssh_connection_failed(&status) {
                return Err(SshDropped(format!(
                    "lost the connection to cloud host `{host}` during credential transfer"
                ))
                .into());
            }
            if !status.success() {
                bail!(
                    "cloud credential transfer failed ({status}); destination credentials were not accepted"
                );
            }
            if payload.is_some() && !bytes.is_empty() {
                bail!("unexpected cloud credential import response");
            }
            Ok(bytes)
        });
        if result.is_err() {
            kill_credential_child(&mut child);
            if let Err(error) = child.wait() {
                crate::logging::info(&format!(
                    "cloud move: credential child cleanup wait failed: {error}"
                ));
            }
        }
        result
    }
}

/// Cleanup is best effort after the primary credential error, but never silent.
fn kill_credential_child(child: &mut std::process::Child) {
    if let Err(error) = child.kill() {
        crate::logging::info(&format!(
            "cloud move: credential child cleanup kill failed: {error}"
        ));
    }
}
