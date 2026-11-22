# How to Compile and Run `rayucode-v2`

```bash
cd /home/rayu/rayu/rayucode-v2
```

## 1. Build & Install (Recommended)

Fast release build (updates `~/.local/bin/rayu`, `rayucode`, and `rayucode-harness-api-bridge`, and reloads any running `rayu` daemon):

```bash
umask 022 && bash scripts/install_release.sh --fast
```

Full LTO release build (slower, maximum optimization):

```bash
umask 022 && bash scripts/install_release.sh
```

> Add `CARGO_NET_OFFLINE=true` if building offline.

## 2. Changing `.env`

The Rust `rayu` binary does **not** load `./.env` at runtime. It reads process
environment variables plus `~/.config/rayucode/*.env`. Cargo is the only reader
of `./.env`, through `crates/rayucode-build-meta/build.rs`, and only for two
keys. Everything else in the file is inert unless you export it yourself.

| Key | Read when | How a change takes effect |
| --- | --- | --- |
| `ENABLE_OTHER_PROVIDER` | compile time, baked into the binary | rebuild, install, restart the daemon |
| `RAYU_FALLBACK_MODEL` | compile-time default | rebuild; or export it / put it in `~/.config/rayucode/rayu.env` (no rebuild) |
| `RAYU_API_URL`, `RAYU_GATEWAY_URL`, `RAYU_WEB_URL`, `USE_RAYU_OAUTH` | process env only | source it before launching, then restart the daemon |
| `RAYU_TELEMETRY`, `RAYU_NO_TELEMETRY`, `RAYU_NO_AUTO_UPDATE`, `RAYU_API_KEY` | process env only | same: export before launching |
| `RAYU_COMMIT_EMAIL`, `RAYU_STUDIO_URL`, `RAYU_GITHUB_*` | nothing in this repo reads them | editing them changes nothing |

The current file also sets `RAYU_API_URL`, `RAYU_GATEWAY_URL`, and
`RAYU_WEB_URL` to `http://localhost:...`, which is a local-backend override.
`http` is only accepted for loopback hosts; anything else silently falls back
to the production `https://` default rather than sending a token to an
untrusted origin.

### 2.1 Compile-time keys (`ENABLE_OTHER_PROVIDER`, `RAYU_FALLBACK_MODEL`)

```bash
cd /home/rayu/rayu/rayucode-v2

# 1. Rebuild, install, and reload the daemon on the new binary in one step.
umask 022 && bash scripts/install_release.sh --fast

# 2. Confirm the values the build script actually baked in.
grep -h -oE 'rustc-env=RAYU_(ENABLE_OTHER_PROVIDER|FALLBACK_MODEL)=.*' \
  target/release/build/rayucode-build-meta-*/output
```

`.env` is a declared Cargo build input, so **any** edit (even whitespace) reruns
the build script and re-checks its dependents on the next `cargo` call. You do
not need `cargo clean`. No other file in the repository reads `./.env`.

A normal compile always picks up the current `.env`, with two exceptions:

1. **An exported process variable wins over the file.**
   `ENABLE_OTHER_PROVIDER=true cargo build ...` beats the `false` in `.env`.
   Cargo treats that as a separate build configuration, so it rebuilds and bakes
   the exported value instead of the file value. Unset the variable and rebuild
   to get the file back.
2. **Content replaced behind an old mtime can be skipped.** Cargo decides whether
   `.env` changed by comparing mtimes. Overwriting the contents while forcing the
   timestamp backwards leaves the previous value baked in. Normal editing never
   does this, and a plain `touch .env` is the fix if it ever happens.

Editing `.env` does not rebuild anything by itself; the next `cargo` command
does. That is why a rebuild only ever reflects the file as it stood when the
compile started.

`ENABLE_OTHER_PROVIDER=false` hides every non-Rayu provider. That is a
compile-time gate: exporting a different value at runtime cannot re-enable them.

### 2.2 Runtime keys (endpoints, auth gate, telemetry)

Export the file into the shell that launches `rayu`:

```bash
cd /home/rayu/rayu/rayucode-v2
set -a && source .env && set +a
rayu
```

The daemon inherits the environment of whichever process started it. A running
`rayu serve` keeps the values it started with, so editing `.env` while the daemon
is up has no effect on it. A full stop/start is what picks up new runtime values:

```bash
rayu server stop --force          # drops any live headless/swarm sessions
set -a && source .env && set +a
rayu                              # respawns the daemon with the new environment
```

`rayu server reload` re-execs the daemon onto the newest binary but keeps the
daemon's **existing** environment, so it applies a rebuild without applying new
runtime variables. Use it after a compile-time change, or after `install.sh`,
when only the binary moved.

Sandbox run that never touches your real `~/.rayu`:

```bash
set -a && source .env && set +a
RAYU_HOME=$(mktemp -d) ./target/release/rayu run --no-update 'Say hello'
```

### 2.3 Verifying which values a process actually has

```bash
# What the live daemon really sees (authoritative, no guessing):
pid=$(pgrep -f 'rayu serve' | head -1)
tr '\0' '\n' < /proc/$pid/environ | grep -E \
  '^(RAYU_(API_URL|GATEWAY_URL|WEB_URL|TELEMETRY|NO_TELEMETRY|NO_AUTO_UPDATE|FALLBACK_MODEL)|USE_RAYU_OAUTH)='

# Client-side spot checks:
rayu login --provider rayu --print-auth-url   # URL reflects RAYU_WEB_URL
rayu provider list                            # one "rayu" row = ENABLE_OTHER_PROVIDER=false
```

If `rayu login --print-auth-url` prints `https://rayucode.com/...` while your
`.env` says `RAYU_WEB_URL=http://localhost:3000`, the file was not sourced in
that shell; that command is the fastest way to see it. The same is true when the
`environ` grep above prints nothing at all: the running daemon was started
without those variables, so it is using the built-in production defaults.

## 3. Build Only (Without Installing)

```bash
# Debug build
cargo build --locked --bin rayu

# Release build
cargo build --release --locked --bin rayu
```

## 4. Compile Just One Part (Do Not Rebuild Everything)

You almost never need `cargo build` on the whole workspace. Cargo caches every
crate that did not change, so pick the smallest target that covers your edit.

### 4.1 Which crate do I need?

| You changed | Command | Notes |
| --- | --- | --- |
| TUI rendering/panels/markdown | `cargo check -p rayucode-tui --lib` | Skips the `rayu` binary and linking |
| One TUI leaf crate | `cargo check -p rayucode-tui-render` | Swap in `-style`, `-markdown`, `-messages`, `-core`, `-anim`, `-workspace`, `-mermaid`, `-permissions`, `-usage-overlay`, `-session-picker`, `-account-picker`, `-tool-display`, `-visual-debug` |
| Server, agent loop, tools | `cargo check -p rayucode-app-core` | Rebuilds `rayucode-base` only if it changed |
| Providers, auth, config, sessions | `cargo check -p rayucode-base` | Everything above it is then stale, so check again after |
| CLI args / dispatch (`src/cli/`) | `cargo check -p rayucode --bin rayu` | Root crate only |
| One provider | `cargo check -p rayucode-provider-anthropic-runtime` | Same for `-openai-runtime`, `-gemini-runtime`, `-rayu-runtime`, ... |
| Shared React UI / TS SDK | `npm run typecheck:ts` | No Rust build at all |
| Docs only | nothing | Skip the build |

`cargo check` runs the compiler front-end and skips codegen plus linking, so it
is the fastest way to prove an edit compiles. Use it in the inner loop, then do
one real build at the end.

### 4.2 Common flags that cut time

```bash
# Typecheck only, no binary, no link
cargo check -p rayucode-tui --lib

# Skip pdf + bedrock (drops a large dependency stack) during iteration
cargo check -p rayucode-tui --lib --no-default-features

# Lint a single crate without re-linting its dependencies
cargo clippy -p rayucode-tui --lib --no-deps

# Tests for one crate, one filter
cargo test -p rayucode-tui --lib info_widget

# Only the library, never the auxiliary binaries
cargo build -p rayucode-tui --lib
```

Do not pass `--all-targets` or `--bins` while iterating: `rayu`, `test_api`,
`rayu-harness`, and the four `dev-bins` benchmarks each link a separate copy of
the full dependency graph.

### 4.3 Producing a runnable binary for just one part

A `cargo check` or `--lib` build produces no executable. To actually run a TUI
change you still need the `rayu` binary, but you can build only that target in
the fast `selfdev` profile instead of a full release build:

```bash
scripts/dev_cargo.sh build --profile selfdev -p rayucode --bin rayu
```

`scripts/dev_cargo.sh` is worth using over bare `cargo` here: it sizes jobs from
available memory, enables the parallel front-end, picks a fast linker, and uses
`sccache` when present. `scripts/cargo_exec.sh` forwards to it for consistency.

Then run that binary against its own socket so you do not disturb the shared
daemon or your current session:

```bash
./target/selfdev/rayu run --no-update --socket /run/user/1000/rayu-mytest.sock 'Say hello'
```

The release profile directories are `target/release` (fast) and
`target/release-lto` (LTO), so `scripts/install_release.sh --fast` and the
`selfdev` profile never invalidate each other's cache.

### 4.4 Feature profiles for scoped work

`scripts/dev_cargo.sh` and `scripts/test_fast.sh` read
`RAYU_DEV_FEATURE_PROFILE`:

```bash
RAYU_DEV_FEATURE_PROFILE=minimal scripts/test_fast.sh   # no pdf/embeddings/bedrock
RAYU_DEV_FEATURE_PROFILE=pdf       scripts/dev_cargo.sh check -p rayucode-tui
RAYU_DEV_FEATURE_PROFILE=full      scripts/dev_cargo.sh build --profile selfdev -p rayucode --bin rayu
```

Keep the same value between runs. Switching feature sets invalidates the
incremental cache for every crate whose features changed.

### 4.5 Front end only (Web / VS Code)

```bash
npm install              # once
npm run typecheck:ts     # typecheck SDK + shared UI, no output emitted
npm run build:sdk        # @rayu-dev/rayucode-sdk -> sdk/typescript/dist
npm run build:ui         # @rayu-dev/rayucode-ui  -> packages/ui/dist
npm run check:ts         # typecheck + unit tests for both
```

## 5. Run

```bash
# Interactive TUI (installed binary)
rayu

# Interactive TUI (direct from build output)
./target/release/rayu

# One-shot prompt (plain, JSON, or streaming NDJSON)
rayu run "Say hello"
rayu run --json "Say hello"
rayu run --ndjson "Say hello"

# Authenticate with Rayu account or API key
rayu login --provider rayu
# Or via env var:
RAYU_API_KEY=rayu_sk_live_... rayu
```

## 6. Useful Commands

```bash
# Check installed version
rayu --version

# Reload running shared server onto the newest installed build
rayu server reload

# Run quick offline unit tests
cargo test --offline -p rayucode-message-types -- rayu_credits
cargo test --offline -p rayucode-provider-rayu-runtime
cargo test --offline -p rayucode-harness-api

# Build & test shared TypeScript SDK + shared React UI
npm install
npm run check:ts
```

## 7. Multi-Product Developer Docs

- Overview & Architecture: [docs/MULTI_PRODUCT_ARCHITECTURE.md](docs/MULTI_PRODUCT_ARCHITECTURE.md)
- Shared Packages (`rayucode-sdk`, `@rayu-dev/rayucode-sdk`, `@rayu-dev/rayucode-ui`): [docs/SHARED_PACKAGES_DEV.md](docs/SHARED_PACKAGES_DEV.md)
- CLI & TUI (Ratatui): [docs/PRODUCT_CLI_DEV.md](docs/PRODUCT_CLI_DEV.md)
- Desktop App (Slint + Rust): [docs/PRODUCT_DESKTOP_DEV.md](docs/PRODUCT_DESKTOP_DEV.md)
- VS Code Extension: [docs/PRODUCT_VSCODE_DEV.md](docs/PRODUCT_VSCODE_DEV.md)
- RayuCode Web (Next.js): [docs/PRODUCT_WEB_DEV.md](docs/PRODUCT_WEB_DEV.md)
