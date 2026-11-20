# RayuCode Closed-Source Release & CI/CD Guide

RayuCode keeps its Rust source code **private** (`Choeng-Rayu/rayucode-v2`) while automatically compiling and publishing verified cross-platform binaries to a **public** distribution repository (`Choeng-Rayu/rayucode-v2-releases`), fronted by `https://rayucode.com/install` (`rayu-web`).

## Architecture Overview

| Component | Visibility | Purpose |
|---|---|---|
| `Choeng-Rayu/rayucode-v2` | **Private** | Rust source code & GitHub Actions release builder (`.github/workflows/release.yml`) |
| `Choeng-Rayu/rayucode-v2-releases` | **Public** | Prebuilt binaries (`.tar.gz`, `.exe`), `SHA256SUMS`, `releases/` metadata, and install/uninstall scripts — **zero Rust source code** |
| `Choeng-Rayu/rayu-web` (`rayucode.com`) | **Private** (site public) | Serves `/install`, `/install.sh`, `/install.ps1` (Rust v3) and `/install-rayu-legacy.{sh,ps1}` (Node v2) |
| `Choeng-Rayu/rayu-cli` | **Public** | Legacy Node v2 repo — hosts the one-time `rayu-v3-migrator` release & `@rayu-dev/rayu-cli@2.6.0` npm bridge so existing Node users upgrade on `rayu update` |

## One-Time Setup Checklist

### 1. Create a least-privilege Fine-Grained PAT (`PUBLIC_RELEASE_TOKEN`)
1. Open **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Set **Repository access → Only select repositories → `Choeng-Rayu/rayucode-v2-releases`**.
3. Under **Repository permissions**, grant:
   - **Contents**: `Read and write`
   - All other permissions: `No access`
4. Add the token as a repository secret in **private `Choeng-Rayu/rayucode-v2`**:
   - **Settings → Secrets and variables → Actions → Secrets → New repository secret**
   - Name: `PUBLIC_RELEASE_TOKEN`

### 2. (Optional) Configure Build Variables in `Choeng-Rayu/rayucode-v2`
Under **Settings → Secrets and variables → Actions → Variables**:
- `RAYU_FALLBACK_MODEL` — defaults to `deepseek-v4.1-flash-1017-cloud`
- `ENABLE_OTHER_PROVIDER` — defaults to `false`
- `PUBLIC_RELEASE_REPO` — defaults to `Choeng-Rayu/rayucode-v2-releases`

## How to Cut a New Release (e.g. `v3.0.0`, `v3.0.1`)

1. Bump `version` in `Cargo.toml` (and run `cargo check` so `Cargo.lock` stays synchronized).
2. Commit and push to `main` in `Choeng-Rayu/rayucode-v2`:
   ```bash
   git add Cargo.toml Cargo.lock
   git commit -m "chore(release): v3.0.0"
   git push origin main
   ```
3. Create and push the matching annotated tag:
   ```bash
   git tag -a v3.0.0 -m "RayuCode v3.0.0"
   git push origin v3.0.0
   ```
4. GitHub Actions (`.github/workflows/release.yml`) automatically:
   - Validates `Cargo.toml`, `Cargo.lock`, `install.sh` syntax, conversion tests, and legacy migration tests.
   - Compiles all 6 platform targets on private-repo-safe runners (`linux-x86_64`, `linux-aarch64`, `macos-aarch64`, `macos-x86_64`, `windows-x86_64`, `windows-aarch64`).
   - Generates unified `SHA256SUMS`, updates `Choeng-Rayu/rayucode-v2-releases` (`releases/latest/version`, `releases/v3.0.0/*`, `install.{sh,ps1}`, `uninstall.{sh,ps1}`), and publishes the public GitHub Release.
   - Runs an anonymous (`GH_TOKEN` unset) verification job downloading every asset, checking `SHA256SUMS`, and smoke-testing `install.sh`.

> You can also re-run any existing tag manually via **Actions → Release (Closed-Source Public Binaries) → Run workflow** with the `tag` input.

## Verifying `rayu-web` Installer Sync

Whenever `scripts/install.sh` or `scripts/install.ps1` changes in `rayucode-v2`, copy them to `rayu-web/public/` and verify:
```bash
cp ../rayucode-v2/scripts/install.sh ../rayu-web/public/install.sh
cp ../rayucode-v2/scripts/install.ps1 ../rayu-web/public/install.ps1
bash ../rayu-web/scripts/check-installer-sync.sh
```

## Rollback

If a bad release is published:
1. Mark the broken release as a pre-release or delete it in `Choeng-Rayu/rayucode-v2-releases`.
2. Update `releases/latest/version` in `Choeng-Rayu/rayucode-v2-releases` back to the previous known-good tag (e.g. `v3.0.0`).
3. New installs and `rayu update` immediately revert to the known-good release.
