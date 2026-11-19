//! Mapping from parsed CLI arguments to an initial process title.
//!
//! This logic depends on the clap `Args`/`Command` types defined in `cli`, so
//! it lives in the CLI layer. The low-level title-setting primitives it uses
//! (`compact_process_title`, `session_name`, `set_title`) live in the
//! `process_title` core module.

use crate::cli::args::{AmbientCommand, Args, Command};
use crate::process_title::{compact_process_title, session_name, set_title};

pub(crate) fn initial_title(args: &Args) -> String {
    match &args.command {
        Some(Command::Serve { .. }) => "rayu:server".to_string(),
        Some(Command::Acp) => "rayu acp".to_string(),
        Some(Command::Server { .. }) => "rayu server".to_string(),
        Some(Command::Connect) => "rayu:client".to_string(),
        #[cfg(unix)]
        Some(Command::ApiBridge { .. }) => "rayu api-bridge".to_string(),
        Some(Command::Run { .. }) => "rayu run".to_string(),
        Some(Command::Login { .. }) => "rayu login".to_string(),
        Some(Command::Account { .. }) => "rayu account".to_string(),
        Some(Command::Telegram { .. }) => "rayu telegram".to_string(),
        Some(Command::Mcp { .. }) => "rayu mcp".to_string(),
        Some(Command::Repl) => "rayu repl".to_string(),
        Some(Command::Update { .. }) => "rayu update".to_string(),
        Some(Command::Version { .. }) => "rayu version".to_string(),
        Some(Command::Usage { .. }) => "rayu usage".to_string(),
        Some(Command::Telemetry(_)) => "rayu telemetry".to_string(),
        Some(Command::SelfDev { .. }) => "rayu:selfdev".to_string(),
        Some(Command::Debug { .. }) => "rayu debug".to_string(),
        Some(Command::Auth(_)) => "rayu auth".to_string(),
        Some(Command::Provider(_)) => "rayu provider".to_string(),
        Some(Command::Memory(_)) => "rayu memory".to_string(),
        Some(Command::Session(_)) => "rayu session".to_string(),
        Some(Command::Ambient(subcommand)) => match subcommand {
            AmbientCommand::RunVisible => "rayu ambient visible".to_string(),
            _ => "rayu ambient".to_string(),
        },
        Some(Command::Cloud(_)) => "rayu cloud".to_string(),
        Some(Command::Pair { .. }) => "rayu pair".to_string(),
        Some(Command::Permissions) => "rayu permissions".to_string(),
        Some(Command::Transcript { .. }) => "rayu transcript".to_string(),
        Some(Command::Companion { .. }) => "rayu companion".to_string(),
        Some(Command::Dictate { .. }) => "rayu dictate".to_string(),
        Some(Command::SetupHotkey {
            listen_macos_hotkey,
            notify_cli_launch,
            listen_windows_hotkey,
            uninstall,
        }) => {
            if *listen_macos_hotkey || *listen_windows_hotkey {
                "rayu hotkey listener".to_string()
            } else if notify_cli_launch.is_some() {
                "rayu shortcut reminder".to_string()
            } else if *uninstall {
                "rayu hotkey uninstall".to_string()
            } else {
                "rayu hotkey setup".to_string()
            }
        }
        Some(Command::Browser { .. }) => "rayu browser".to_string(),
        Some(Command::Replay { .. }) => "rayu replay".to_string(),
        Some(Command::Model(_)) => "rayu model".to_string(),
        Some(Command::ProviderTestCoverage { .. }) => "rayu provider-test-coverage".to_string(),
        Some(Command::ProviderDoctor { .. }) => "rayu provider-doctor".to_string(),
        Some(Command::AuthTest { .. }) => "rayu auth-test".to_string(),
        Some(Command::Restart { .. }) => "rayu restart".to_string(),
        Some(Command::Menubar { .. }) => "rayu menubar".to_string(),
        Some(Command::SetupLauncher) => "rayu setup-launcher".to_string(),
        None => {
            if let Some(resume) = args.resume.as_deref().filter(|resume| !resume.is_empty()) {
                let prefix = if crate::cli::selfdev::client_selfdev_requested() {
                    "rayu:d:"
                } else {
                    "rayu:c:"
                };
                compact_process_title(prefix, Some(&session_name(resume)))
            } else if crate::cli::selfdev::client_selfdev_requested() {
                "rayu:selfdev".to_string()
            } else {
                "rayu:client".to_string()
            }
        }
    }
}

pub(crate) fn set_initial_title(args: &Args) {
    set_title(initial_title(args));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::lock_test_env;
    use clap::Parser;

    const SELFDEV_ENV: &str = rayucode_selfdev_types::CLIENT_SELFDEV_ENV;

    fn with_selfdev_env_removed<T>(f: impl FnOnce() -> T) -> T {
        let _guard = lock_test_env();
        let previous = std::env::var_os(SELFDEV_ENV);
        crate::env::remove_var(SELFDEV_ENV);
        let result = f();
        if let Some(value) = previous {
            crate::env::set_var(SELFDEV_ENV, value);
        }
        result
    }

    #[test]
    fn initial_title_labels_server() {
        with_selfdev_env_removed(|| {
            let args = Args::parse_from(["rayu", "serve"]);
            assert_eq!(initial_title(&args), "rayu:server");
        });
    }

    #[test]
    fn initial_title_labels_resume_client_with_short_name() {
        with_selfdev_env_removed(|| {
            let args = Args::parse_from(["rayu", "--resume", "session_fox_123"]);
            assert_eq!(initial_title(&args), "rayu:c:fox");
        });
    }

    #[test]
    fn initial_title_labels_selfdev_command() {
        with_selfdev_env_removed(|| {
            let args = Args::parse_from(["rayu", "self-dev"]);
            assert_eq!(initial_title(&args), "rayu:selfdev");
        });
    }

    #[test]
    fn initial_title_labels_windows_hotkey_listener() {
        let args = Args::parse_from(["rayu", "setup-hotkey", "--listen-windows-hotkey"]);
        assert_eq!(initial_title(&args), "rayu hotkey listener");
    }

    #[test]
    fn initial_title_labels_hotkey_uninstall() {
        let args = Args::parse_from(["rayu", "setup-hotkey", "--uninstall"]);
        assert_eq!(initial_title(&args), "rayu hotkey uninstall");
    }
}
