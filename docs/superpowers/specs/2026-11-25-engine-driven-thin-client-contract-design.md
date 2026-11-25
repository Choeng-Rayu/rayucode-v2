# Engine-Driven Thin-Client Contract (`v1.16`) & Composer/Settings PoC Design

- **Date:** 2026-11-25
- **Branch Target:** Stacked PRs targeting `dev`
- **Status:** Approved Design — Pending Spec Review
- **Context & Audits:** `desktop/docs/root-cause.md`, `desktop/docs/audit-1.md`, `desktop/docs/audit-2.md`, `desktop/docs/audit-5.md`

---

## 1. Problem Statement & Goals

The Rust runtime (`crates/`) is the single coding engine shared across CLI/TUI, RayuCode Desktop (`desktop/`), and RayuCode VS Code (`vscode/`). However, audits (`audit-1.md`, `audit-2.md`, `audit-5.md`) established four structural defects in the UI-to-engine boundary:

1. **Two Sources of Truth (`H1`):** Desktop persists engine preferences (`defaultModel`, `defaultPermissionMode`, `autoCompactContext`, `kvCacheTtl`) in `<appConfigDir>/desktop-settings.json` and `localStorage` (`rayu-effort-idx` vs `rayu-effort`) rather than `~/.rayu/config.toml`, leaving Desktop, VS Code, and CLI silently out of sync.
2. **Lossy Event & Provenance Contract (`H2`):** `rayucode-harness-api-server` drops `TurnIdentity` (`seq`, `turn_id`), `ToolDone.tool_duration_ms`, `MessageEnd.stop_reason`, and structured message provenance (`origin` / `visibility`), forcing clients to scrape text prefixes and regex-match error prose.
3. **Hardcoded UI Assumptions (`H4`):** Desktop hardcodes a 20-model catalog, a 5-stop effort ladder (`["Auto","Low","Medium","High","Max"]`, which sends invalid `"auto"` to `RayuProvider` and omits `"xhigh"`/`"minimal"`/`"none"`), and 10 slash commands concatenated into raw user prompt text instead of dispatched to the engine.
4. **Hand-Built Feature Lag (`H6`):** Without live capability and schema discovery from Rust, every new engine command, model effort stop, or config field requires bespoke UI edits across both Desktop and VS Code.

### Goals (Phase 1 — This Spec)
- Extend `rayucode-harness-api` additively from **`v1.15` → `v1.16`** with live capability/registry discovery, canonical `~/.rayu/config.toml` get/patch RPCs, and frame/message/error fidelity.
- Expose typed client helpers in `@rayu-dev/rayucode-sdk` (`sdk/typescript/`) and shared normalization/dispatch logic in `packages/session-core/`.
- Cut over **Composer** (models, per-model effort ladders, permission modes, slash commands) and **Settings** (`~/.rayu/config.toml` sync) in **both Desktop and VS Code** as a vertical proof-of-concept with zero hardcoded engine catalogs.
- Enforce a dedicated **UI/UX Designer review gate** (against `DESIGN.md`, `globals.css`, and `prototype/`) plus **live runtime prompt E2E testing** on every stacked PR targeting `dev`.

### Explicitly Deferred to Phase 2 (Out of Scope Here)
- Full Swarm `Comm*` control plane (27 internal protocol requests / 16 events).
- Voice dictation (`rayucode-voice`), Companion/Menubar, Replay/Video export, and Cloud session migration (`rayu cloud`).
- MCP OAuth 2.1 login/logout, Workspace Tools (Gmail/Calendar/Browser), and Memory semantic CRUD `RuntimeCommand` endpoints.
- Deleting Electron's fallback cloud loop (`desktop/electron/auth-bridge.ts`) and full Desktop adoption of all remaining unbridged `ApiRequest`s (`rewind`, `soft_interrupt`, `applet_action`, `side_panel_state`).

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Rust Daemon (`crates/`)                        │
│  Single source of truth: models, efforts, slash/runtime commands,       │
│  permission modes, ~/.rayu/config.toml (via Config::path + toml_edit),  │
│  TurnIdentity, message provenance                                       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ internal `rayucode-protocol`
┌───────────────────────────────▼─────────────────────────────────────────┐
│         Harness API Server (`crates/rayucode-harness-api-server`)       │
│  Translates & serves NDJSON Harness API v1.16 (`rayucode-harness-api`)  │
│  • get_capabilities → capabilities                                      │
│  • get_config / patch_config → config_state / config_changed            │
│  • Additive frame fidelity (seq, turn_id, duration_ms, stop_reason,     │
│    HistoryMessage.origin/visibility, ErrorCode::Busy|Unsupported)       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ NDJSON over Unix socket / stdio
┌───────────────────────────────▼─────────────────────────────────────────┐
│                `@rayu-dev/rayucode-sdk` (`sdk/typescript/`)             │
│  Typed v1.16 RPCs + graceful downgrade when daemon minor_version < 16   │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│               `packages/session-core` (Shared TS Contract)              │
│  • parseSlashInvocation(input, commands, skills)                        │
│  • resolveEffortLadder(modelRoute)                                      │
│  • filterVisibleHistory(messages)                                       │
│  • normalizeConfigSchema / patch helpers                                │
└───────────────────┬───────────────────────────────┬─────────────────────┘
                    │                               │
       ┌────────────▼────────────┐     ┌────────────▼────────────┐
       │   RayuCode Desktop      │     │   RayuCode VS Code      │
       │   Composer + Settings   │     │   Composer + Settings   │
       │   (DESIGN.md + UX Gate) │     │   (Host + Webview)      │
       └─────────────────────────┘     └─────────────────────────┘
```

---

## 3. Section 1: Rust Harness API `v1.16` Wire Contract & Bridge

**Owned Crates:** `crates/rayucode-harness-api`, `crates/rayucode-harness-api-server`, `crates/rayucode-base`, `crates/rayucode-app-core`.

### 3.1 Protocol Version & Backwards Compatibility
- Bump `API_VERSION_MINOR` in `crates/rayucode-harness-api/src/lib.rs` from `15` to `16` (`API_VERSION_MAJOR` remains `1`).
- Every new field uses `#[serde(default, skip_serializing_if = "...")]` so existing `v1.0`–`v1.15` clients deserialize `v1.16` frames without errors, and `v1.16` clients connect cleanly to `v1.15` daemons.

### 3.2 Live Capability & Registry Discovery
- **Request:** `ApiRequest::GetCapabilities { session_id: Option<String> }`
- **Reply:** `ApiEvent::Capabilities { commands, permission_modes, features }`
  - `CommandDescriptor`:
    - `name: String` (canonical slash name without leading `/`, e.g. `"compact"`, `"effort"`, `"model"`, `"review"`, `"context"`, `"cache"`, `"clear"`)
    - `description: String`
    - `category: CommandCategory` (`session | model | quality | tools | runtime`)
    - `arg_hint: Option<String>`
    - `requires_session: bool`
    - `dispatch: CommandDispatch` (`ApiRequest { req: String }` | `RuntimeCommand { command: String }` | `Skill { name: String }`)
  - **Curation rule:** Explicitly exclude TUI-only terminal layout commands (`/cls`, `/clear-view`, `/alignment`, `/debug-visual`, `/onboarding-sim`, `/update-sim`, `/terminal-setup`, `/new-terminal`, `/screenshot-mode`).
  - `PermissionModeDescriptor`: `id: String`, `label: String`, `description: String`, `is_default: bool`.
  - `FeatureFlagDescriptor`: `key: String`, `enabled: bool`, `description: String`, `requires_restart: bool`.
- **`ModelRouteInfo` extensions** (`crates/rayucode-harness-api/src/events.rs`):
  - `supported_efforts: Vec<String>` — resolved via `inferred_reasoning_efforts(provider, model)` with TUI-only `swarm*` sentinels filtered out (matching `src/cli/acp/session_configuration.rs`).
  - `default_effort: Option<String>`
  - `context_window: Option<u64>`

### 3.3 Canonical `~/.rayu/config.toml` RPC (`get_config` / `patch_config`)
- **Requests:**
  - `ApiRequest::GetConfig { sections: Option<Vec<String>> }` → `ApiEvent::ConfigState { path, sections, values, schema }`
  - `ApiRequest::PatchConfig { patch: serde_json::Map<String, serde_json::Value> }` → `ApiEvent::ConfigState { ... }` on success, or `ApiEvent::Error { code: InvalidRequest, message }` on validation failure; broadcasts `ApiEvent::ConfigChanged { changed_keys, requires_restart, values }` to all connected Harness API clients.
- **Curated `v1.16` Sections (9 sections):** `provider`, `compaction`, `display`, `features`, `safety`, `agents`, `autoreview`, `autojudge`, `notifications`.
- **Schema Descriptor (`ConfigFieldSchema`):** `key` (dotted path e.g. `"compaction.mode"`), `section`, `label`, `description`, `kind` (`boolean | string | integer | number | enum | string_array`), `options: Option<Vec<ConfigEnumOption>>`, `default_value: Value`, `apply_mode` (`immediate | next_turn | restart_required`, derived using the same rules as `crates/rayucode-base/src/config/change_report.rs`).
- **Production Safety Guarantees:**
  1. **Secret Redaction:** `get_config` never exposes API keys, OAuth tokens, or credential secrets (credentials stay exclusively in auth flows).
  2. **Validate-Before-Write:** `patch_config` rejects unknown keys, wrong types, or out-of-range values before touching disk.
  3. **Comment-Preserving Atomic Write:** Uses existing `toml_edit` (`crates/rayucode-base/Cargo.toml`) to update only patched keys inside `Config::path()` (`~/.rayu/config.toml`), verifies the resulting TOML parses into `Config`, writes to a sibling temp file, and atomically renames into place.

### 3.4 Frame, Error & Message Provenance Fidelity
- **`ServerFrame` (`crates/rayucode-harness-api/src/lib.rs`):** Add optional `seq: Option<u64>` (monotonic per-session stream counter) and `turn_id: Option<String>` (forwarded from `TurnIdentity` in `translate.rs`).
- **`ApiEvent::ToolDone`:** Add optional `duration_ms: Option<u64>` (forwarded from `ServerEvent::ToolDone.tool_duration_ms`).
- **`ApiEvent::TextDone`:** Add optional `stop_reason: Option<String>` (forwarded from `ServerEvent::MessageEnd.stop_reason`).
- **`HistoryMessage` (`crates/rayucode-harness-api/src/events.rs`):**
  - Add optional `origin: Option<MessageOrigin>` (`user_typed | engine_internal | legacy_unknown`) and `visibility: Option<MessageVisibility>` (`visible | hidden`).
  - Mark synthetic engine prompts in `crates/rayucode-app-core/src/agent/response_recovery.rs` (`maybe_reconsider_fable_guardrail`, `maybe_continue_incomplete_response`, `maybe_continue_stranded_tool_use`) with `display_role: Some(StoredDisplayRole::System)` / internal provenance so they never leak as user bubbles on reload (resolving Audit-5).
- **`ErrorCode` (`crates/rayucode-harness-api/src/events.rs`):** Add `Busy` and `Unsupported` variants and map daemon busy/unsupported errors cleanly in `translate.rs`, removing the need for regex error scraping in clients.

### 3.5 Rust Contract Tests
- Update `crates/rayucode-harness-api/src/harness_api_tests/schema_snapshot.rs` and `capability_coverage.rs`.
- Unit tests in `rayucode-base` for `toml_edit` atomic patch + comment preservation + validation rejection + secret redaction.
- Integration tests in `rayucode-harness-api-server` verifying `get_capabilities`, `get_config`, `patch_config`, `config_changed` fanout, `seq`/`turn_id`, `duration_ms`, `stop_reason`, `origin`/`visibility`, and `ErrorCode::Busy|Unsupported`.

---

## 4. Section 2: Shared TypeScript Layer & Composer / Settings PoC

### 4.1 `@rayu-dev/rayucode-sdk` (`sdk/typescript/`)
- Add typed methods: `getCapabilities(sessionId?)`, `getConfig(sections?)`, `patchConfig(patch)`.
- Extend TypeScript frame/event types with `seq`, `turnId`, `durationMs`, `stopReason`, `origin`, `visibility`, `supportedEfforts`, `defaultEffort`, `contextWindow`, `ErrorCode` (`busy` | `unsupported`).
- **Graceful `v1.15` Downgrade:** Inspect `hello_ok.minor_version` (or catch `ErrorCode::Unsupported`) so calling `v1.16` methods against an older daemon degrades safely with an explicit capability flag rather than throwing unhandled errors.

### 4.2 `packages/session-core` (Single Client Logic Layer)
Add three pure, thoroughly tested modules shared by both Desktop and VS Code:
1. `slash-dispatch.ts` — `parseSlashInvocation(input, commands, skills)`:
   - Parses `/command [args]` against the engine's live `CommandDescriptor[]` + active `skills`.
   - Returns a typed discriminated action (`{ kind: "api_request", req, params }` | `{ kind: "runtime_command", command, args }` | `{ kind: "skill_prompt", skill, prompt }` | `{ kind: "plain_prompt", text }`).
   - Unknown `/paths` or escaped text remain plain prompts (matching `src/cli/acp.rs` boundary rules).
2. `model-capabilities.ts` — `resolveEffortLadder(route)`:
   - Reads `route.supportedEfforts` and `route.defaultEffort` directly from `ModelRouteInfo`.
   - Returns `{ supported: boolean, stops: string[], defaultStop: string | null }` with zero hardcoded model or effort tables.
3. `history-provenance.ts` — `filterVisibleHistory(messages)`:
   - Drops `visibility === "hidden"` or `origin === "engine_internal"` rows while preserving fallback compatibility for legacy sessions (`origin === undefined`).

### 4.3 Desktop & VS Code PoC Cutover (Composer + Settings)
- **Composer (Desktop + VS Code):**
  - Replace hardcoded model arrays, 5-stop effort arrays, permission mode literals, and hardcoded 10-item `SLASH_COMMANDS` with live data from `getCapabilities()` + `getRuntimeInfo()`.
  - Fix Desktop's broken `setEffort` / `setModel` path (`use-sessions.ts` / `ipc-client.ts`) so switching model or effort pushes immediately to the active daemon session and reflects `model_info` / `permission_mode_changed` events on the return path.
  - Show truthful mid-turn state (`"Applies on next turn"` when `ErrorCode::Busy` or mid-turn deferment occurs) instead of faking immediate application.
  - Dispatch slash commands through `parseSlashInvocation` so `/compact`, `/effort`, `/model`, `/review`, `/context`, `/cache`, `/clear` execute real engine actions and render crisp inline feedback.
- **Settings (Desktop + VS Code):**
  - Wire engine settings tabs (`provider`, `compaction`, `display`, `features`, `autoreview`, `autojudge`, `notifications`) to `getConfig` / `patchConfig` against real `~/.rayu/config.toml`.
  - Keep strictly UI-only preferences (`theme`, `accent`, `showMiniPet`, window state) local.
  - **One-Time Safe Migration (Desktop):** On first run after upgrade, if legacy engine keys exist in `desktop-settings.json` (`defaultModel`, `defaultPermissionMode`, `autoCompactContext`, `kvCacheTtl`) and `~/.rayu/config.toml` has not explicitly overridden them, offer/apply a non-destructive sync once and mark migration complete so users never lose existing preferences.
  - Subscribe to `config_changed` so edits in CLI, VS Code, or Desktop stay live-synced across all open clients.

---

## 5. Section 3: UI/UX Design Gate, Stacked PRs to `dev` & Live Verification

### 5.1 Dedicated UI/UX Design Gate (PR 3 & PR 4)
Because Composer and Settings UX directly change for end users, PR 3 (Desktop) and PR 4 (VS Code) MUST pass a dedicated **UI/UX Design Review Gate** before opening/merging:
- Strict compliance with `DESIGN.md`, `desktop/src/styles/globals.css` semantic tokens, `node desktop/scripts/check-shadcn.mjs`, and `pnpm lint:design` (0 raw hex, 0 `bg-[#...]`, 0 emojis, no composer focus glow rings or file chips).
- **Crafted Settings Information Architecture:** Never dump raw 300-field auto-generated forms; group curated engine settings cleanly under clear headings with a visible badge indicating **Synced with `~/.rayu/config.toml` (CLI + Desktop + VS Code)** vs **Local UI Preferences**, plus inline validation errors and `"Reload required"` indicators where `apply_mode === "restart_required"`.
- **Adaptive Composer Controls:** Cleanly hide or disable the effort selector when a model has `supportedEfforts.length === 0`; group slash popover cleanly (`Engine Commands` vs `Skills`) with argument hints and keyboard navigation.
- **Visual Verification (Desktop):** Render affected views at `1440×934` in **Dark (Rayu Green)**, **Dark (Ocean Blue)**, and **Light** modes into `.swarm-logs/verify/` and compare against `prototype/`.

### 5.2 Stacked PR Delivery Plan (All Targeting `dev`)

| PR | Branch | Base | Scope |
|---|---|---|---|
| **PR 1** | `stack/1-harness-v1-16-contract` | `dev` | Rust `v1.16` Harness API types, `get_capabilities`, `get_config`/`patch_config` (`toml_edit` atomic writes + secret redaction), `seq`/`turn_id`/`duration_ms`/`stop_reason`/`origin`/`visibility`, `ErrorCode::Busy|Unsupported`, Audit-5 provenance fix, Rust tests. |
| **PR 2** | `stack/2-sdk-and-session-core` | PR 1 | `@rayu-dev/rayucode-sdk` `v1.16` methods + `v1.15` downgrade, `packages/session-core` (`slash-dispatch`, `model-capabilities`, `history-provenance`), SDK & `session-core` tests. |
| **PR 3** | `stack/3-ux-ui-composer-settings-desktop` | PR 2 | Dedicated UI/UX review + Desktop Composer & Settings cutover, `desktop-settings.json` one-time migration, `pnpm verify`, `1440×934` 3-theme screenshots. |
| **PR 4** | `stack/4-ux-ui-composer-settings-vscode` | PR 2 | Dedicated UI/UX review + VS Code Composer & Settings cutover onto `packages/session-core`, host + webview tests + build. |

*(Each PR is opened against its parent branch in the stack, or retargeted cleanly onto `dev` as prior PRs merge into `dev`.)*

### 5.3 Mandatory Automated & Live Prompt E2E Verification Gate (Every PR)
Every PR must report fresh command output (exit code `0`) across all applicable layers:

1. **Automated Unit / Contract / Build Gates:**
   - Rust: `cargo test -p rayucode-harness-api -p rayucode-harness-api-server -p rayucode-base -p rayucode-app-core`
   - SDK: `cd sdk/typescript && npm run check`
   - Shared Core: `cd packages/session-core && npm test`
   - Desktop: `cd desktop && pnpm verify` (`typecheck`, `lint`, `lint:design`, `test`, `build`)
   - VS Code: `cd vscode && npm run typecheck && npm run lint:design && npm test && npm run test:host && npm run build`
2. **Mandatory Live Runtime & Live Prompt E2E Verification:**
   - Build an isolated binary (`cargo build --profile selfdev`) and launch against a dedicated isolated socket & `RAYU_HOME` (never disturbing the user's running daemon).
   - Exercise live `get_capabilities`, `get_config`, and `patch_config` (verifying real `config.toml` update + comment preservation + `config_changed` broadcast + invalid-patch rejection).
   - **Send real live prompts and real slash commands** (`/model`, `/effort`, `/compact`, plus a real coding prompt) over the live socket and verify streaming `seq`/`turn_id`, `duration_ms`, `stop_reason`, and clean reloaded history with zero leaked internal prompts.
   - Verify Desktop (PR 3) and VS Code (PR 4) end-to-end against the live daemon: switch model & effort, execute a slash command, modify a Settings value, reload, and send a live prompt to confirm real end-user usability.
