//! User-enabled uninstall of a managed Unix CLI payload and its launcher links.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};

fn setting() -> Result<PathBuf> {
    Ok(crate::storage::rayu_dir()?.join("telegram-uninstall-enabled.json"))
}

pub fn enabled() -> bool {
    setting()
        .and_then(|path| crate::storage::read_json::<bool>(&path))
        .unwrap_or(false)
}

pub fn set_enabled(enable: bool) -> Result<()> {
    if enable {
        ensure!(
            cfg!(unix),
            "Remote uninstall supports managed Unix CLI installs."
        );
    }
    crate::storage::write_json_secret(&setting()?, &enable)
}

pub struct Plan {
    payload: PathBuf,
    launchers: Vec<PathBuf>,
    signature: FileSignature,
}

#[derive(PartialEq, Eq)]
struct FileSignature {
    length: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    inode: (u64, u64),
}

impl FileSignature {
    fn read(path: &Path) -> Result<Self> {
        let metadata = std::fs::metadata(path)?;
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            length: metadata.len(),
            modified: metadata.modified()?,
            #[cfg(unix)]
            inode: (metadata.dev(), metadata.ino()),
        })
    }
}

impl Plan {
    pub fn current() -> Result<Self> {
        ensure!(
            enabled(),
            "Remote uninstall is disabled. Enable it locally with rayu telegram uninstall enable."
        );
        let root = crate::storage::rayu_dir()?.canonicalize()?;
        let home = dirs::home_dir().context("No home directory")?;
        let launcher_dir = std::env::var_os("RAYU_INSTALL_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/bin"));
        let binary = std::env::current_exe()?.canonicalize()?;
        Self::detect(&root, &launcher_dir, &binary)
    }

    fn detect(root: &Path, launcher_dir: &Path, binary: &Path) -> Result<Self> {
        let builds = root.join("builds");
        let versions = builds.join("versions");
        let relative = binary
            .strip_prefix(&versions)
            .context("Remote uninstall requires a managed Rayu CLI installation")?;
        ensure!(
            builds.canonicalize()? == builds
                && versions.canonicalize()? == versions
                && relative.components().count() == 2
                && binary.file_name().and_then(|name| name.to_str()) == Some("rayu")
                && binary.is_file(),
            "The running Rayu CLI is outside the managed payload layout"
        );

        let launcher_dir = if launcher_dir.is_dir() {
            launcher_dir.canonicalize()?
        } else {
            launcher_dir.to_path_buf()
        };
        let mut launchers = Vec::new();
        for base in [launcher_dir, builds.join("current"), builds.join("stable")] {
            // A symlinked parent could otherwise make a path in the managed
            // tree name a symlink owned by another installation.
            if base.canonicalize().ok().as_deref() != Some(&base) {
                continue;
            }
            for name in ["rayu", "rayucode"] {
                let candidate = base.join(name);
                if candidate.is_symlink()
                    && candidate.canonicalize().ok().as_deref() == Some(binary)
                {
                    launchers.push(candidate);
                }
            }
        }
        ensure!(
            launchers.iter().any(|path| !path.starts_with(&builds)),
            "No managed launcher points to the running Rayu CLI"
        );
        Ok(Self {
            payload: binary.to_owned(),
            launchers,
            signature: FileSignature::read(binary)?,
        })
    }

    pub fn label(&self) -> String {
        format!(
            "Rayu CLI payload and {} managed launcher link(s).",
            self.launchers.len()
        )
    }

    pub fn execute(&self) -> Result<()> {
        let current = Self::current()?;
        ensure!(
            self.payload == current.payload
                && self.launchers == current.launchers
                && self.signature == current.signature,
            "The managed install changed. Start a new confirmation."
        );

        // Preserve alternate versions and all data. The only regular file
        // removed is the daemon's managed executable.
        for path in &self.launchers {
            ensure!(
                path.is_symlink() && path.canonicalize().ok().as_deref() == Some(&self.payload),
                "A managed launcher changed during uninstall"
            );
        }
        let mut failed = 0;
        // Verify every link before removing any: the alias may resolve via the
        // primary launcher and become dangling after the first unlink.
        for path in &self.launchers {
            if let Err(error) = std::fs::remove_file(path) {
                failed += 1;
                crate::logging::warn(&format!(
                    "Could not remove a managed Rayu launcher: {error}"
                ));
            }
        }
        if failed > 0 {
            bail!("Could not remove {failed} launcher link(s). The payload was retained.");
        }
        std::fs::remove_file(&self.payload).context("Could not remove the managed Rayu payload")
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn managed_plan_never_selects_legacy_launchers_or_project_files() -> Result<()> {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir()?;
        let root = dir.path().canonicalize()?;
        let project = root.join("project");
        let payload = root.join("builds/versions/version/rayu");
        let stable = root.join("builds/stable");
        let bin = root.join("bin");
        for path in [&project, payload.parent().unwrap(), &stable, &bin] {
            std::fs::create_dir_all(path)?;
        }
        let legacy = project.join("legacy-rayu");
        std::fs::write(&legacy, "legacy")?;
        std::fs::write(&payload, "package")?;
        symlink(&payload, stable.join("rayu"))?;
        symlink(stable.join("rayu"), bin.join("rayu"))?;
        symlink(legacy, bin.join("rayucode"))?;
        let plan = Plan::detect(&root, &bin, &payload)?;
        assert_eq!(plan.launchers, vec![bin.join("rayu"), stable.join("rayu")]);
        assert!(Plan::detect(&root, &bin, &project).is_err());
        Ok(())
    }
}
