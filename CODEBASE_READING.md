# RayuCode Codebase Reading — `rayucode-v2`

Notes from a read of the tree at `v0.99.1-dev`, commit `1654be9` (2026-11-20),
plus verification of the in-flight working-tree change set. This is a reader's
map, not a specification. Where it disagrees with
[`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md), that doc is the maintained one;
this file adds the parts I checked by hand.

## 1. What the thing is

RayuCode (`rayu`) is a Rust coding-agent platform. One long-lived daemon owns
every session; clients attach over a Unix socket and can disconnect, reattach,
or reload the binary without losing work.

It is one engine with four surfaces:

| Surface | UI | Language | Talks to the core via |
| --- | --- | --- | --- |
| CLI / TUI | Ratatui | Rust | direct, plus the daemon socket |
| Desktop | Slint | Rust | `crates/rayucode-sdk` over the harness API bridge |
| VS Code | React webview | TypeScript | `@rayu-dev/rayucode-sdk` + `@rayu-dev/rayucode-ui` |
| Web | Next.js | TypeScript | same TS SDK + UI packages |

The TypeScript side lives in this same repo (`sdk/typescript`, `packages/ui`,
`vscode/`) and is ~48k lines against ~974k lines of Rust.

## 2. Number check

| Measure | Value |
| --- | ---: |
| Workspace crates | 90 |
| Rust files | ~2,079 |
| Rust lines (incl. tests) | ~974,000 |
| TypeScript/TSX lines | ~47,700 |
| Root `src/` files | 95 |
| Files in `rayucode-tui` | 550 |
| Registered base tools | 24 + conditional |
| `Request` variants in the protocol | 93 |

Roughly 68% of the Rust sits in three crates: `rayucode-tui` (292k lines),
`rayucode-app-core` (193k), `rayucode-base` (169k). Everything else is a leaf.

## 3. The layer stack

Each layer re-exports the one underneath, which is why `crate::config` resolves
even though `config` is defined in `rayucode-base`.

```
rayucode                 src/{main.rs, lib.rs, cli/}    entrypoint + CLI dispatch
  └── rayucode-tui       presentation: tui app, render, panels, markdown, mermaid
        └── rayucode-app-core   server, agent turn loop, tool registry + 97 tool files
              └── rayucode-base auth, provider, config, session, memory, storage
                    └── ~80 leaf crates   types, protocol, provider/*-runtime
```

Wired in `src/lib.rs` as `pub use rayucode_tui::*;`, and in
`crates/rayucode-app-core/src/lib.rs` as `pub use rayucode_base::*;`.

Practical consequence: **a symbol found by grepping `rayucode-app-core` or the
root crate may be defined in `rayucode-base`.** Follow the re-exports before
concluding a module lives where the path suggests.

## 4. Crate families

- **Contract crates** (`*-types`: session, message, protocol, config, usage,
  memory, selfdev, auth, gateway, ambient, applet, tool, task, background,
  batch, side-panel). Serde shapes and pure helpers only: no tokio, no
  filesystem, no network, no globals. Split out so a contract edit does not
  recompile the heavy graph.
- **Provider crates**: `provider-<name>` holds the wire schema,
  `provider-<name>-runtime` holds the client. Present for anthropic, openai,
  openrouter, gemini, copilot, bedrock, antigravity, cursor, grok-build, rayu.
  Shared abstractions live in `provider-core`; static catalogs in
  `provider-metadata`; diagnostics in `provider-doctor`.
- **Tool infrastructure**: `tool-core` (`Tool` trait, `intent` /
  `accept_large_output` schema injection), `tool-types` (`ToolOutput`),
  `command-risk` (destructive-command classification), `codemode` (sandboxed JS
  that chains tool calls).
- **Presentation leaves**: `tui-core`, `tui-render`, `tui-style`,
  `tui-markdown`, `tui-mermaid`, `tui-messages`, `tui-tool-display`,
  `tui-permissions`, `tui-session-picker`, `tui-account-picker`,
  `tui-usage-overlay`, `tui-visual-debug`, `tui-workspace`.
- **Rendering fork**: `vendor/ratatui-rayucode/{ratatui-core,ratatui-widgets}`,
  patched in via `[patch.crates-io]` in the root `Cargo.toml`.

## 5. Runtime model

```
rayu (client) ──socket──▶ rayu serve (daemon)
  /run/user/$UID/rayu.sock            ├── sessions (many, concurrent)
  /run/user/$UID/rayu-debug.sock      ├── provider state + auth
                                      ├── shared MCP pool
                                      └── registry: ~/.rayu/servers.json
```

`/reload` execs the daemon into a new binary in the same PID. Clients reconnect
and resume. This is the whole reason the self-dev workflow repoints
`~/.rayu/builds/shared-server/rayu` and restarts: a freshly built binary that is
not on that path is never executed, and every runtime check silently measures
the old code.

Naming: the daemon gets an adjective ("blazing"), each session an animal noun
("fox"), displayed as "blazing fox".

`crates/rayucode-protocol/src/wire.rs` defines the client/server request set:
turn control, history paging, model catalog, auth switching, session admin, and
a large `Comm*` block for swarm coordination (spawn, plan, assign, await,
channels).

The SDK/harness bridge is separate from that socket:
`rayucode-harness-api` + `rayucode-harness-api-server` serve the Desktop and
TypeScript clients over NDJSON, and that bridge is restarted with
`selfdev reload-bridge`, never by hand.

## 6. The agent turn

Entry point: `crates/rayucode-app-core/src/agent/turn_streaming_mpsc.rs`,
`Agent::run_turn_streaming_mpsc(&mut self, event_tx)` in `impl Agent`.
Supporting modules sit beside it: `turn_loops`, `turn_execution`, `tools`,
`tool_handoff`, `streaming`, `response_recovery`, `compaction`, `prompting`,
`provider`, `interrupts`, `turn_usage`.

Design decisions that are easy to mistake for accidents:

- **Cancellation is global, not handle-local.** Each turn registers in
  `turn_cancel_registry`, so a cancel arriving through *any* control handle for
  that session aborts the stream, including a stale handle rebuilt after a
  reattach or reload. Scoping the registry to the current agent object would
  look tidier and would be a regression.
- **Tools run under a foreground budget.** `agent/tool_handoff.rs` runs the tool
  on a session-scoped task; past `tools.auto_background_timeout_ms` the call is
  adopted as a background task and the turn keeps streaming.
- **Two tools are excluded from that handoff by name**: `ask_user` and
  `bg(action=wait)`. A human decision, or a deliberate wait, must stay on the
  live turn that owns the response channel.
- **Retry budgets are per failure mode**, not one counter: context-limit,
  incomplete continuation, empty-post-tool, consecutive malformed tool calls,
  and guardrail reconsideration each get their own budget because each has a
  different correct response.
- **Streaming rows are named after `intent`**, so an in-flight row reads
  "Waiting for Run parser tests", not "Waiting for bash".

## 7. Tools

`Registry` lives in `crates/rayucode-app-core/src/tool/mod.rs` (1,947 lines)
with 97 sibling tool files. The 24 provider-independent tools are constructed
once in a `OnceLock` and shared across sessions by `Arc` clone; `base_tools`
then clones that map and adds the two it must build per session. `Registry::new`
layers the remaining per-session tools on top.

Verified cached base set (`base_tools`, `OnceLock`): `read`, `write`,
`agentgrep`, `side_panel`, `panel`, `edit`, `apply_patch`, `bash`, `browser`,
`open`, `webfetch`, `websearch`, `maintainer_feedback`, `rayu_docs`, `todo`,
`bg`, `session_search`, `memory`, `gmail`, `calendar`, `schedule`, `selfdev`,
`desktop_selfdev`, plus `macos_computer_use` on macOS only.

Added on every call after the cached map: `skill_manage` and `swarm`. Both need
references the cached map cannot hold: `skill_manage` takes the shared skill
registry, and `swarm` builds its description from the user-editable swarm prompt
once per session (so existing sessions keep a stable tool definition and KV
cache while new ones pick up prompt edits).

Added by `Registry::new` per session or conditionally: `batch`,
`conversation_search`, `codemode` (only when `[tools] codemode = true`), and
`integration_tools` (only when `[sponsors] enabled = true`).

Two aliases survive for compatibility: `multiedit` → `edit`, `patch` →
`apply_patch`, resolved in `resolve_tool_name`.

Rules enforced centrally instead of per tool:

- `intent` is injected into every object schema and marked required, including
  proxied MCP tools, in `rayucode-tool-core`.
- `accept_large_output` is the escape hatch for oversized results. Its
  description is one line on purpose, because it rides on every schema on every
  request.
- Product separation is by tool name: `selfdev` / `debug_socket` are rejected in
  Desktop checkouts and `desktop_selfdev` in non-Desktop ones, because subcalls
  reach the registry without passing `validate_tool_allowed`.

Notable absence, confirmed by grep: **there is no `ask_user` tool in this
build.** The string appears only in Telegram approvals, the `tool_handoff`
exclusion list, and permission plumbing. There is no constructor and no
registration. `user_response.rs` is the nearest relative.

Second finding: tool registration is stringly typed. Names are literals in
`base_tools`, so nothing catches a typo or a missing tool at compile time. That
is how the `ask_user` gap stays invisible.

## 8. Providers and auth

`crates/rayucode-base/src/provider/` is the largest subsystem in base: routing,
selection, failover, pricing, per-provider adapters, and catalog refresh across
~38 files.

Model catalogs are **live, not allowlists**. Offline arrays are fallbacks. The
contract is: cached prefetch plus explicit refresh that bypasses fresh caches,
last-good preserved on network/auth/malformed failures, and caches keyed by
endpoint. The provider-discovery rules in `AGENTS.md` exist because regressing
this is one bad refactor away.

Auth lives in `crates/rayucode-base/src/auth/` (status, credential sources,
account failover), with OAuth details per provider and in `external_auth.rs`.
Two credential paths unlock the hosted gateway: the account session at
`~/.rayu/rayu-auth.json` (shared byte-for-byte with the Rayu CLI, refreshed via
`POST {api}/cli/refresh`) and a `RAYU_API_KEY` (`rayu_sk_live_…`). The account
JWT wins when both exist. Authorities: [`docs/AUTH_CREDENTIAL_SOURCES.md`](docs/AUTH_CREDENTIAL_SOURCES.md)
and [`OAUTH.md`](OAUTH.md).

## 9. Build identity and the working tree

`rayucode-build-meta` computes every `RAYU_*` compile-time value in one build
script: version, git hash/date/tag, semver, changelog. Its own package version is
deliberately unrelated to rayu's, so it parses the root `Cargo.toml` for the base
semver. It uses no `rerun-if-changed`, so git state cannot loop the build.

The uncommitted work in this tree is one coherent feature plus its fallout:
**an `ENABLE_OTHER_PROVIDER` compile-time switch.** 53 files, ~2,084 insertions.

- The flag resolves from process env, falling back to the workspace `.env`, and
  is exposed as `other_providers_enabled()` from `rayucode-build-meta`.
- When false, the binary is Rayu-only: `login_providers()` returns one entry,
  `openai_compatible_profiles()` is empty, the catalog scheduler no-ops, SSH
  account import is gated, and user-facing guidance rewrites to Rayu-only text.
- `is_known_other_provider_id` lets an explicit `--provider claude` fail with a
  real explanation instead of "unknown provider".
- `ScopedOtherProvidersGuard` makes both modes testable from a single build.
- The auth status cache key now includes the flag, so flipping it in tests
  cannot serve a stale snapshot from the other mode. This is the same bug class
  as the `RAYU_HOME` cache-key issue (#361).
- Alongside it: a `ServerEvent::RayuCredits` event (credits, turn_credits,
  optional `billable_tokens` / `tokens_per_credit`, omitted from the wire when
  absent, tested in `crates/rayucode-protocol/src/protocol_tests/rayu_credits.rs`),
  a browser-safe TypeScript SDK entrypoint at `sdk/typescript/src/browser.ts`
  with zero Node builtins, and an untracked `vscode/` extension tree.

## 10. Compile-time layout, and why it looks this way

`docs/CRATE_OWNERSHIP_BOUNDARIES.md` is the rulebook for where code belongs.
The short version:

- Move *stable* contracts into `*-types` crates so behavior churn does not
  recompile them.
- Keep runtime behavior (storage, process, tokio, provider clients, TUI state)
  where its dependencies already are. Do not move only a struct if its inherent
  methods need root-only APIs.
- Do not dump high-churn domain DTOs into `rayucode-core`: it has high fan-out
  and touched it once measured ~65s downstream, versus ~6s for a root-only
  behavior edit.
- During a move, keep the old path as a `pub use` re-export and remove it only
  after downstream crates depend on the new one directly.
- Run `python3 scripts/check_dependency_boundaries.py` after changing any type
  crate's dependencies.

The root `Cargo.toml` also pins opt-level 3 for specific dependencies in
dev/selfdev/test profiles, each with a comment explaining a measured problem:
ratatui and the unicode stack (frame cost), image decode crates (inline image
latency), `serde_json` (multi-MB session parses), `rayucode-fuzzy` (keystroke
lag in pickers), `rayucode-tui-anim` (idle CPU), and the tract/ndarray/tokenizers
embedding stack (~666ms per embed unoptimized). Read those comments before
"simplifying" the profiles.

## 11. Tests as specifications

Tests here carry design intent, so read the test before assuming a behavior is
incidental.

- `onboarding_eval` scores onboarding screens against cognitive-load heuristics
  in ~2,400 lines.
- `todo_quality_tests` and `todo_lane_dependency_tests` encode todo-lane rules.
- `auth_tests` and the new `turn_envelope_tests` grow alongside auth behavior.
- `tui-viewport`/`ui_*_tests` and the `TUI_TEST_FLAKINESS.md` note explain which
  broad test filters select unrelated stateful or timing-sensitive tests. The
  ownership doc lists the known hazards (`side_panel`, `usage`, `session::`,
  `ambient`) and prefers exact filters.

## 12. Where to look next

| Question | File |
| --- | --- |
| How does a turn work? | `crates/rayucode-app-core/src/agent/turn_streaming_mpsc.rs` |
| How do tools register and dispatch? | `crates/rayucode-app-core/src/tool/mod.rs` |
| What tools exist? | `crates/rayucode-app-core/src/tool/*.rs` (97 files) |
| What can a client request? | `crates/rayucode-protocol/src/wire.rs` |
| Where does auth come from? | `crates/rayucode-base/src/auth/`, `external_auth.rs` |
| Why does model discovery behave this way? | `crates/rayucode-base/src/provider/catalog_*` |
| Where does a UI row get rendered? | `crates/rayucode-tui/src/tui/`, leaves in `tui-render` / `tui-style` |
| How is the binary versioned? | `crates/rayucode-build-meta/build.rs` |
| Why is this code in this crate? | `docs/CRATE_OWNERSHIP_BOUNDARIES.md` |
| How does the daemon work? | `docs/SERVER_ARCHITECTURE.md` |
| How do the four products share code? | `docs/MULTI_PRODUCT_ARCHITECTURE.md` |

## 13. The three things most likely to cost you an afternoon

1. **You edited the wrong binary.** Builds are inert until
   `~/.rayu/builds/shared-server/rayu` is repointed and the daemon restarted.
   Verify with `readlink -f`; `strings` on the symlink reads a path, not a
   program.
2. **You instrumented with the wrong printer.** `crate::logging::info` writes to
   a log file, so it produces nothing under `--trace`. Use `eprintln!` for
   throwaway diagnostics, and delete it before committing.
3. **You looked for the code in the wrong crate.** The re-export chain means
   the path you are reading is not always the path that defines the symbol, and
   `src/` holds only the entrypoint and CLI dispatch, no agent or tool behavior.
