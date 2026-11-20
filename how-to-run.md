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

## 2. Build Only (Without Installing)

```bash
# Debug build
cargo build --locked --bin rayu

# Release build
cargo build --release --locked --bin rayu
```

## 3. Compile Just One Part (Do Not Rebuild Everything)

You almost never need `cargo build` on the whole workspace. Cargo caches every
crate that did not change, so pick the smallest target that covers your edit.

### 3.1 Which crate do I need?

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

### 3.2 Common flags that cut time

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

### 3.3 Producing a runnable binary for just one part

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

### 3.4 Feature profiles for scoped work

`scripts/dev_cargo.sh` and `scripts/test_fast.sh` read
`RAYU_DEV_FEATURE_PROFILE`:

```bash
RAYU_DEV_FEATURE_PROFILE=minimal scripts/test_fast.sh   # no pdf/embeddings/bedrock
RAYU_DEV_FEATURE_PROFILE=pdf       scripts/dev_cargo.sh check -p rayucode-tui
RAYU_DEV_FEATURE_PROFILE=full      scripts/dev_cargo.sh build --profile selfdev -p rayucode --bin rayu
```

Keep the same value between runs. Switching feature sets invalidates the
incremental cache for every crate whose features changed.

### 3.5 Front end only (Web / VS Code)

```bash
npm install              # once
npm run typecheck:ts     # typecheck SDK + shared UI, no output emitted
npm run build:sdk        # @rayu-dev/rayucode-sdk -> sdk/typescript/dist
npm run build:ui         # @rayu-dev/rayucode-ui  -> packages/ui/dist
npm run check:ts         # typecheck + unit tests for both
```

## 4. Run

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

## 5. Useful Commands

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

## 6. Multi-Product Developer Docs

- Overview & Architecture: [docs/MULTI_PRODUCT_ARCHITECTURE.md](docs/MULTI_PRODUCT_ARCHITECTURE.md)
- Shared Packages (`rayucode-sdk`, `@rayu-dev/rayucode-sdk`, `@rayu-dev/rayucode-ui`): [docs/SHARED_PACKAGES_DEV.md](docs/SHARED_PACKAGES_DEV.md)
- CLI & TUI (Ratatui): [docs/PRODUCT_CLI_DEV.md](docs/PRODUCT_CLI_DEV.md)
- Desktop App (Slint + Rust): [docs/PRODUCT_DESKTOP_DEV.md](docs/PRODUCT_DESKTOP_DEV.md)
- VS Code Extension: [docs/PRODUCT_VSCODE_DEV.md](docs/PRODUCT_VSCODE_DEV.md)
- RayuCode Web (Next.js): [docs/PRODUCT_WEB_DEV.md](docs/PRODUCT_WEB_DEV.md)
