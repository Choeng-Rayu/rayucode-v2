# Codebase Map

A single-file orientation to the rayucode repository: what each layer owns, how a
turn flows, where the tools and providers live, and which parts are easy to
misread. Written from a read-only pass over the tree at `v0.99.1-dev` (commit
`b5d6b14`, 2026-11-20).

Read this before `CRATE_OWNERSHIP_BOUNDARIES.md`. That document states the rules
for *where new code belongs*; this one states what is *already there*.

## Size

| Measure | Value |
| --- | --- |
| Rust files | 1,986 |
| Rust lines | ~962,000 |
| Workspace crates | 90 |
| Tools registered in the base map | 32 |

Three crates hold 68% of the Rust: `rayucode-tui` (291k), `rayucode-app-core`
(192k), `rayucode-base` (168k). Everything else is leaves.

## Layer stack

Each layer re-exports the one below it, so `crate::<module>` paths keep resolving
after a module moves. A path that "should" live in `rayucode-base` still compiles
at the root crate.

```
rayucode              src/{main.rs,lib.rs,cli/}      95 files: entrypoint + CLI dispatch
  └─ rayucode-tui            presentation: TUI app, render, panels, mermaid, markdown
       └─ rayucode-app-core  server, agent turn loop, tool registry + 108 tool files
            └─ rayucode-base provider, auth, config, session, message, memory, storage
                 └─ ~85 leaf crates: types, protocol, storage, provider/*-runtime
```

Consequences worth internalizing:

- `src/` is *only* the binary entrypoint and CLI. If you are looking for server,
  agent, or tool behavior, it is not there.
- `rayucode-app-core/src/lib.rs` does `pub use rayucode_base::*`. A symbol found
  by grepping app-core may be defined in base.
- Leaf `*-types` crates contain serde contracts and pure helpers only. No tokio,
  no filesystem, no network, no globals.

## Crate groups

**Type/contract crates** (`*-types`): `session-types`, `message-types`,
`protocol`, `side-panel-types`, `background-types`, `batch-types`,
`config-types`, `task-types`, `usage-types`, `memory-types`, `selfdev-types`,
`auth-types`, `gateway-types`, `ambient-types`, `applet-types`, `tool-types`.
Serde shapes and small pure helpers. Splitting these out keeps contract edits
from recompiling the heavy graph.

**Provider crates**: a `provider-<name>` crate for the request/response schema
and a `provider-<name>-runtime` crate where the client lives. Present for
anthropic, openai, openrouter, gemini, copilot, bedrock, antigravity, cursor,
grok-build, rayu. `provider-core` holds the shared transport abstractions,
`provider-metadata` the static catalogs (login providers, OpenAI-compatible
profiles, pricing), `provider-doctor` the diagnostics command.

**Tool infrastructure**: `tool-core` (the `Tool` trait, `intent` and
`accept_large_output` schema injection), `tool-types` (`ToolOutput`),
`command-risk` (destructive-command classification), `codemode` (sandboxed JS
that chains tool calls).

**Presentation leaves**: `tui-core`, `tui-render`, `tui-style`, `tui-markdown`,
`tui-mermaid`, `tui-messages`, `tui-tool-display`, `tui-permissions`,
`tui-visual-debug`, `tui-session-picker`, `tui-account-picker`,
`tui-usage-overlay`, `tui-workspace`.

## Runtime model

One daemon process owns every session. Clients attach over a Unix socket and can
disconnect and reconnect without losing the turn.

```
rayu (client) ──socket──▶ rayu serve (daemon)
  /run/user/$UID/rayu.sock        ├── sessions (many, concurrent)
  /run/user/$UID/rayu-debug.sock  ├── provider state + auth
                                  ├── shared MCP pool
                                  └── registry: ~/.rayu/servers.json
```

`/reload` execs the daemon into a new binary in the same PID; clients reconnect
and resume. This is why the self-dev workflow repoints
`~/.rayu/builds/shared-server/rayu` and restarts, rather than starting a second
server: a rebuilt binary that is not in that path is never executed.

Naming: the daemon gets an adjective ("blazing"), each session an animal noun
("fox"), displayed as "blazing fox".

`rayucode-protocol/src/wire.rs` defines 93 `Request` variants: turn control,
history paging, model catalog, auth switching, session admin, and a large
`Comm*` block for swarm coordination (spawn, plan, assign_task, await_members,
channels).

## The agent turn

Entry point: `crates/rayucode-app-core/src/agent/turn_streaming_mpsc.rs`
(`run_turn_streaming_mpsc`). Supporting modules sit beside it in `agent/`.

Design choices that are easy to misread as incidental:

- **Cancellation is global, not handle-local.** Each turn registers in
  `turn_cancel_registry`, so a cancel arriving through *any* control handle for
  that session aborts the stream, including a stale handle rebuilt after a
  reattach or reload. Do not "fix" this by scoping the registry to the current
  agent object.
- **Tools run under a foreground budget.** `agent/tool_handoff.rs` runs the tool
  on a session-scoped task; past `tools.auto_background_timeout_ms` the call is
  adopted as a background task and the turn continues streaming.
- **`ask_user` is excluded from that handoff by name.** A human decision must
  stay on the live turn that owns the response channel. `bg` with `action=wait`
  is excluded for the same reason.
- **Retry budgets are per failure mode, not one counter.** Context-limit,
  incomplete-continuation, empty-post-tool, consecutive-malformed-tool, and
  guardrail-reconsideration each get their own budget, because they have
  different correct responses.
- **Tool call summaries are named after `intent`,** so an in-flight row reads
  "Waiting for Run parser tests" instead of "Waiting for bash".

## Tools

`Registry` lives in `crates/rayucode-app-core/src/tool/mod.rs` (~1,950 lines).
Base tools are built once in a `OnceLock` and shared across sessions by `Arc`
clone; per-session additions layer on top.

Registered base set: `read`, `write`, `edit`, `apply_patch`, `bash`,
`agentgrep`, `side_panel`, `panel`, `browser`, `open`, `macos`,
`macos_computer_use`, `webfetch`, `websearch`, `maintainer_feedback`,
`rayu_docs`, `todo`, `bg`, `session_search`, `memory`, `gmail`, `calendar`,
`schedule`, `selfdev`, `desktop_selfdev`, `skill_manage`, `swarm`, `batch`,
`conversation_search`, `codemode`, `mcp`, plus conditional and ambient tools.

Rules enforced centrally rather than per tool:

- `intent` is injected into every object schema and marked required
  (`ensure_intent_in_schema` in `rayucode-tool-core`), including MCP proxy tools.
- `accept_large_output` is injected as the escape hatch when a result is too
  large for remaining context. The description is deliberately one line because
  it rides on every schema on every request.
- Desktop-only UI tools (`user_response`, `applet`) register only when the client
  advertises an inline-response capability. They never enter terminal or headless
  registries, including through `batch` and `codemode`.

Tool dispatch also enforces product separation: `selfdev`/`debug_socket` are
rejected in Desktop checkouts and `desktop_selfdev` in non-Desktop ones, because
subcalls reach the registry without passing `validate_tool_allowed`.

## Providers and auth

`crates/rayucode-base/src/provider/` is the largest single subsystem in base:
routing, selection, failover, pricing, catalog refresh, per-provider adapters.
Model catalogs are *live*, not allowlists: cached prefetch plus explicit refresh,
last-good preserved on failure, cache keyed by endpoint. The
`AGENTS.md` provider-discovery rules exist because regressing this is easy.

Auth lives in `crates/rayucode-base/src/auth/` (status, credential sources,
account failover) with OAuth specifics per provider and in `external_auth.rs`.
`docs/AUTH_CREDENTIAL_SOURCES.md` and `docs/OAUTH.md` are the authorities.

## Build identity

`rayucode-build-meta` computes every `RAYU_*` compile-time value in one build
script: version, git hash/date/tag, semver, changelog. Its own package version is
unrelated to rayu's, so it parses the root `Cargo.toml` for the base semver. It
intentionally uses no `rerun-if-changed`, so git state cannot loop the build.

This crate is also where `ENABLE_OTHER_PROVIDER` resolves.

## Current uncommitted work (as of this pass)

The working tree is mid-change, 56 modified files plus new untracked ones:

- **`ENABLE_OTHER_PROVIDER` compile-time switch.** Build-time flag (process env,
  falling back to workspace `.env`) exposed as `rayu::other_providers_enabled()`.
  When false the binary is Rayu-only: `login_providers()` returns one entry,
  `openai_compatible_profiles()` is empty, the catalog scheduler no-ops, SSH
  account import is gated, and user-facing guidance rewrites to Rayu-only text.
  `is_known_other_provider_id` lets an explicit `--provider claude` fail with a
  real explanation instead of "unknown provider". `ScopedOtherProvidersGuard`
  makes both modes testable from one build.
- **`RayuCredits` server event**: credits, turn_credits, and optional
  billable_tokens / tokens_per_credit, omitted from the wire when absent.
- **Browser-safe TypeScript SDK entrypoint** (`sdk/typescript/src/browser.ts`):
  pure protocol types and error classes, zero Node builtins, for Next.js client
  components and VS Code webviews.
- **`vscode/`** extension tree, untracked.

## Findings from this pass

1. **There is no `ask_user` tool in this build.** The string appears only in
   Telegram remote approvals, `tool_handoff`'s exclusion list, and permission
   plumbing. No constructor, no registration in `base_tools`, no schema. The
   `vscode/` tree references an `AskUserQuestion` tool from a different codebase.
   Anything planning against `ask_user` should know it does not exist here yet.
2. **Tool registration is stringly typed.** Names are literals in `base_tools`,
   so nothing catches a typo'd or missing tool at compile time. This is how (1)
   stays invisible.
3. **`src/` remains the largest extraction target.** ~95 files of CLI dispatch,
   cloud group, SSH, and cloud-move logic still sit in the root crate, which by
   the ownership doc's own criterion is the biggest remaining compile-fanout win.
4. **Tests function as specifications.** Examples: `todo_quality_tests`,
   `todo_lane_dependency_tests`, `onboarding_eval` (~2,400 lines scoring
   onboarding screens against cognitive-load heuristics), and
   `auth_tests`/`turn_envelope_tests` growing alongside behavior. Read the test
   before assuming a behavior is incidental.

## Where to look

| Question | File |
| --- | --- |
| How does a turn work? | `app-core/src/agent/turn_streaming_mpsc.rs` |
| How do tools register and dispatch? | `app-core/src/tool/mod.rs` |
| What tools exist? | `app-core/src/tool/*.rs` (108 files) |
| What can a client request? | `protocol/src/wire.rs` |
| Where does auth come from? | `base/src/auth/`, `base/src/external_auth.rs` |
| Why does model discovery behave this way? | `base/src/provider/catalog_*` |
| Where does a UI row get rendered? | `tui/src/tui/`, leaves in `tui-render`/`tui-style` |
| How is the binary versioned? | `build-meta/build.rs` |
| Why is this code in this crate? | `docs/CRATE_OWNERSHIP_BOUNDARIES.md` |
| How does the daemon work? | `docs/SERVER_ARCHITECTURE.md` |
