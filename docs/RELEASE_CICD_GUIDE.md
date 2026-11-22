# RayuCode Public Release & CI/CD Guide

RayuCode is published directly from the **public** repository `Choeng-Rayu/rayucode-v2`, using free unlimited GitHub-hosted public runners to natively compile and verify cross-platform binaries for **Linux, macOS, and Windows**, fronted by `https://rayucode.com/install` (`rayu-web`).

## Architecture Overview

| Component | Visibility | Purpose |
|---|---|---|
| `Choeng-Rayu/rayucode-v2` | **Public** | Rust source code, GitHub Actions release pipeline (`.github/workflows/release.yml`), official GitHub Releases (`.tar.gz`, `.exe`, `SHA256SUMS`), `release-metadata` branch (`releases/` fallback metadata), and canonical `scripts/install.{sh,ps1}` |
| `Choeng-Rayu/rayu-web` (`rayucode.com`) | **Private** (site public) | Serves `/install`, `/install.sh`, `/install.ps1` (Rust v3) and `/install-rayu-legacy.{sh,ps1}` (Node v2) |
| `Choeng-Rayu/rayu-cli` | **Public** | Legacy Node v2 repo — hosts the one-time `rayu-v3-migrator` release & `@rayu-dev/rayu-cli@2.6.0` npm bridge so existing Node users upgrade on `rayu update` |

## Zero-Secret Setup

Because `Choeng-Rayu/rayucode-v2` is **public**, no external Personal Access Token (`PUBLIC_RELEASE_TOKEN`) or GitHub Actions billing plan is required:

- Standard GitHub-hosted runners (`ubuntu-22.04`, `ubuntu-24.04-arm`, `macos-latest`, `macos-15-intel`, `windows-latest`, `windows-11-arm`) are **free and unlimited** on public repositories.
- `.github/workflows/release.yml` grants `permissions: contents: write` only on the `publish-public-release` job and uses the built-in `${{ github.token }}` to publish releases and update the dedicated `release-metadata` orphan branch (so `main` history is never polluted with bot commits).

### Optional Build Variables in `Choeng-Rayu/rayucode-v2`
Under **Settings → Secrets and variables → Actions → Variables**:
- `RAYU_FALLBACK_MODEL` — defaults to `deepseek-v4.1-flash-1017-cloud`
- `ENABLE_OTHER_PROVIDER` — defaults to `false`

## Supported Release Matrix (6 Native Targets)

| Target | Asset(s) | GitHub Runner | Verification |
|---|---|---|---|
| `x86_64-unknown-linux-gnu` | `rayu-linux-x86_64.tar.gz` | `ubuntu-22.04` (manylinux2014 Docker, glibc 2.17+) | `objdump` glibc <= 2.17 gate + native `--version` & `cloud` checks |
| `aarch64-unknown-linux-gnu` | `rayu-linux-aarch64.tar.gz` | `ubuntu-24.04-arm` | Native ARM64 compile + native `--version` smoke test |
| `aarch64-apple-darwin` | `rayu-macos-aarch64.tar.gz` | `macos-latest` | Native Apple Silicon compile + ad-hoc `codesign` + native `--version` |
| `x86_64-apple-darwin` | `rayu-macos-x86_64.tar.gz` | `macos-15-intel` | Native Intel Mac compile + ad-hoc `codesign` + native `--version` |
| `x86_64-pc-windows-msvc` | `rayu-windows-x86_64.exe` + `.tar.gz` | `windows-latest` | Native x64 MSVC compile + PowerShell parser check + native `--version` |
| `aarch64-pc-windows-msvc` | `rayu-windows-aarch64.exe` + `.tar.gz` | `windows-11-arm` | Native ARM64 MSVC compile (`--no-default-features --features pdf`) + native `--version` |

## How to Cut a New Release (Automatic on Push / Merge to `main`)

Develop on `dev` (or a feature branch), then push or merge into `main`:

```bash
git checkout main
git merge dev
git push origin main
```

GitHub Actions (`.github/workflows/release.yml`) automatically:
1. **Resolves the next version** via `scripts/resolve_release_version.py`:
   - Auto-bumps the patch version from the latest stable tag (e.g. `v3.0.0` → `v3.0.1` → `v3.0.2`).
   - If you manually bump `version` in `Cargo.toml` higher than the latest tag (e.g. `3.1.0` or `4.0.0`), it releases that exact minor/major version instead.
   - To push a non-release commit (like a quick README fix) to `main` without building, include `[skip release]` in the commit message.
2. Validates `Cargo.lock`, `install.sh` syntax, conversion tests, legacy migration tests, and setup friction tests, and auto-generates release notes (using `changelog/v<VERSION>.json` if present, or commit history since the previous tag).
3. Compiles and natively smoke-tests all 6 Linux, macOS, and Windows targets in parallel (with `RAYU_BUILD_SEMVER` pinned to the new version, so `rayu --version` and `rayu update` report the exact new release without bot commits back to `main`).
4. **Only after all 6 builds succeed**: creates tag `v<VERSION>` on the validated commit, generates unified `SHA256SUMS`, updates the `release-metadata` branch (`releases/latest/version`, `releases/v<VERSION>/{SHA256SUMS,download-bases}`), and publishes the public GitHub Release on `Choeng-Rayu/rayucode-v2`.
5. Runs an anonymous (`GITHUB_TOKEN` & `GH_TOKEN` unset) verification job downloading every asset, verifying `sha256sum -c SHA256SUMS`, and smoke-testing `scripts/install.sh` in a sandboxed `$HOME`.

> You can also rebuild any existing tag or trigger a release manually via **Actions → Release → Run workflow** (leave `tag` blank to auto-release `main`, or enter a tag like `v3.0.1` to rebuild it). Manual `git tag vX.Y.Z && git push origin vX.Y.Z` still works too.

## Verifying `rayu-web` and `rayu-cli` Installer Sync

Whenever `scripts/install.sh` or `scripts/install.ps1` changes in `rayucode-v2`, sync them to `rayu-web` and `rayu-cli` and verify:
```bash
cp ../rayucode-v2/scripts/install.sh ../rayu-web/public/install.sh
cp ../rayucode-v2/scripts/install.ps1 ../rayu-web/public/install.ps1
cp ../rayucode-v2/scripts/install.sh ../rayu-cli/rayu/install.sh
cp ../rayucode-v2/scripts/install.ps1 ../rayu-cli/rayu/install.ps1
bash ../rayu-web/scripts/check-installer-sync.sh
```

## Rollback

If a bad release is published:
1. Mark the broken release as a pre-release or delete it in `Choeng-Rayu/rayucode-v2` (**Releases**).
2. Update `releases/latest/version` on the `release-metadata` branch back to the previous known-good tag (e.g. `v3.0.0`), or re-run the `Release` workflow for the previous tag.
3. New installs and `rayu update` immediately revert to the known-good release.

## Release Ordering: v3 Binaries Before the Legacy Bridge

Publish the `Choeng-Rayu/rayucode-v2` v3 binaries **before** the legacy migration bridge (`rayu-cli` → `Actions → Publish v3 Migration Bridge Release`) and before publishing `@rayu-dev/rayu-cli@2.6.0`:

1. Tag `v3.0.0` in `Choeng-Rayu/rayucode-v2` → `Release` workflow builds all 6 platforms and passes `Verify anonymous public downloads & installer smoke test`.
2. Verify `https://raw.githubusercontent.com/Choeng-Rayu/rayucode-v2/release-metadata/releases/latest/version` returns `v3.0.0` and `https://github.com/Choeng-Rayu/rayucode-v2/releases/latest` points to `v3.0.0`.
3. Only then run the migration bridge workflow in `rayu-cli` and `npm publish --access public` for `@rayu-dev/rayu-cli@2.6.0`.
