# Product 1: CLI & TUI Developer Guide (Rust + Ratatui)

The terminal product (`rayu`) is the reference runtime and owns the multi-session daemon, tool platform, provider routing, and Ratatui terminal interface inside [`rayucode-v2`](../README.md).

---

## Tech Stack & Workspace Structure

- **Language**: Rust (Edition 2024)
- **TUI Framework**: Ratatui (in-tree tuned fork under `vendor/ratatui-rayucode/`)
- **Crate Layer Stack** (top depends on bottom; lower crates never import upper crates):
  1. **Binary & CLI Dispatch** (`src/main.rs`, `src/cli/`) — argument parsing, pre-UI auth/login flows, headless `rayu run`, `rayu api-bridge`, `rayu serve`.
  2. **TUI Presentation** (`crates/rayucode-tui/`) — Ratatui rendering, input handling, `/model` picker, remote daemon client, markdown/mermaid rendering, per-turn `Credits:` footers.
  3. **Application & Agent Core** (`crates/rayucode-app-core/`) — Daemon server (`rayu serve`), streaming turn loop (`agent/turn_streaming_mpsc.rs`), tool execution, swarm coordination.
  4. **Foundation** (`crates/rayucode-base/`) — Providers (`provider/`), Rayu Auth (`rayu/`), session persistence (`session/`), config, usage/credits.
  5. **Leaf & Harness Crates** — `rayucode-message-types` (including canonical `rayu_credits`), `rayucode-provider-rayu-runtime`, `rayucode-harness-api` (`v1.12`), `rayucode-harness-api-server` (`rayucode-harness-api-bridge`), `rayucode-sdk`.

See [`CODEBASE_MAP.md`](./CODEBASE_MAP.md) for the detailed internal map.

---

## Local Build, Install & Live Reload Workflow

### Build and install both `rayu` and `rayucode-harness-api-bridge`

```bash
cd /home/rayu/rayu/rayucode-v2

# Fast release build (recommended during active development)
umask 022 && CARGO_NET_OFFLINE=true bash scripts/install_release.sh --fast

# Full LTO release build (for final release benchmarking)
umask 022 && CARGO_NET_OFFLINE=true bash scripts/install_release.sh
```

This installs both `~/.local/bin/rayu` (plus `rayucode` alias) and `~/.local/bin/rayucode-harness-api-bridge` into `~/.rayu/builds/current/` and reloads any active background `rayu` daemon.

See also [`how-to-run.md`](../how-to-run.md).

---

## Testing Guide (Fast Scoped Loops)

Always test the smallest crate first so you don't recompile unrelated binaries:

```bash
# Pure message & credits math (< 1s)
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-message-types

# Rayu SSE stream & live catalog client
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-provider-rayu-runtime

# Harness wire contract & TS parity
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-harness-api
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-harness-api-server

# Provider routing, auth & session rendering
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-base catalog_rayu
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-base response_stats

# TUI tests (pass specific test filters to keep runs fast)
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-tui --lib rayu_credits

# Formatting check before committing
cargo fmt --all --check
```

### TUI Test Runtime Gotcha
In `crates/rayucode-tui`, `create_test_app()` constructs its own Tokio runtime internally. For any test calling `RemoteConnection::dummy()`:
- Keep the test function **synchronous** (`#[test]`, not `#[tokio::test]`),
- Call `create_test_app()` **before** entering a `tokio::runtime::Runtime` if a runtime is needed afterwards.

---

## Self-Contained Live CLI Smoke Test (Safe / Isolated)

Never mutate your real `~/.rayu/` directory when testing: run with a temporary `HOME` and `XDG_RUNTIME_DIR`:

```bash
SANDBOX="$(mktemp -d)"
HOME="$SANDBOX/home" XDG_RUNTIME_DIR="$SANDBOX/run" \
  rayu --no-selfdev --provider rayu run --json "Reply with exactly: OK"
rm -rf "$SANDBOX"
```
