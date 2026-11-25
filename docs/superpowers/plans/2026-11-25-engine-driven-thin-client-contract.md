# Engine-Driven Thin-Client Contract (`v1.16`) & Composer/Settings PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an additive `v1.16` Rust Harness API contract (live capabilities/commands/efforts, atomic `~/.rayu/config.toml` RPCs, frame/provenance fidelity), shared TypeScript helpers in `@rayu-dev/rayucode-sdk` + `packages/session-core`, and zero-hardcoding Composer & Settings vertical cutovers in Desktop and VS Code via 4 stacked PRs targeting `dev`.

**Architecture:** Extend `crates/rayucode-harness-api` (`API_VERSION_MINOR: 15 → 16`) with strictly optional additive fields and three new RPC pairs (`get_capabilities`, `get_config`, `patch_config`), back config persistence with `toml_edit` atomic writes and secret redaction in `rayucode-base`, centralize slash-command parsing, effort ladder resolution, and history provenance filtering inside `packages/session-core`, and rewire Desktop and VS Code Composer/Settings to consume live engine state with a dedicated UI/UX design review gate and mandatory live-prompt E2E verification.

**Tech Stack:** Rust (`rayucode-harness-api`, `rayucode-harness-api-server`, `rayucode-base`, `rayucode-app-core`, `toml_edit`, `tokio`), TypeScript (`@rayu-dev/rayucode-sdk`, `packages/session-core`, Vitest, Node test runner), React 19 + Tailwind v4 + Electron (`desktop/`), VS Code Extension Host + Webview (`vscode/`), GitHub CLI (`gh`) for stacked PRs targeting `dev`.

## Global Constraints

- **Protocol compatibility:** `API_VERSION_MAJOR` stays `1`; `API_VERSION_MINOR` bumps `15 → 16` in Rust (`crates/rayucode-harness-api/src/lib.rs`) and `14 → 16` in TS SDK (`sdk/typescript/src/protocol.ts`). Every new field MUST have `#[serde(default, skip_serializing_if = "...")]`.
- **Canonical config path:** Always resolve `~/.rayu/config.toml` via `Config::path()` (`crates/rayucode-base/src/config/config_file.rs`). Never expose API keys or OAuth tokens via `get_config`. Always validate before writing and persist atomically via `toml_edit` temp-file + rename.
- **Desktop UI rules (`AGENTS.md` / `DESIGN.md`):** Read `DESIGN.md`, `desktop/src/styles/globals.css`, and matching `prototype/*.html` before touching any UI file. Run `node desktop/scripts/check-shadcn.mjs check <names...> --json` before coding. Zero raw hex literals, zero `bg-[#...]`, zero UI emojis, zero composer focus glow rings or file chips. Mandatory `1440×934` screenshots in Dark (Rayu Green), Dark (Ocean Blue), and Light modes.
- **Stacked PR delivery:** Use a clean 4-branch git stack targeting `dev` (`stack/1-harness-v1-16-contract` → `dev`, `stack/2-sdk-and-session-core` → PR 1, `stack/3-ux-ui-composer-settings-desktop` → PR 2, `stack/4-ux-ui-composer-settings-vscode` → PR 2). Preserve the user's Git identity and never touch unrelated untracked files (`.agents/skills/`, `.claude/`, `skills-lock.json`).
- **Live runtime & prompt verification:** Every PR MUST run both automated gates (`cargo test`, SDK check, `session-core` tests, `desktop` `pnpm verify`, `vscode` tests/build) AND an isolated-socket live test (`cargo build --profile selfdev` + isolated `--socket` + isolated `RAYU_HOME`) that actually sends live prompts and real slash/config RPCs.

---

## File Structure Map

### PR 1 (`stack/1-harness-v1-16-contract` → `dev`)
- Modify: `crates/rayucode-harness-api/src/lib.rs` — bump `API_VERSION_MINOR = 16`, add optional `seq`/`turn_id` on `ServerFrame`, export `capabilities_config` types.
- Create: `crates/rayucode-harness-api/src/capabilities_config.rs` — `CommandCategory`, `CommandDispatch`, `CommandDescriptor`, `PermissionModeDescriptor`, `FeatureFlagDescriptor`, `ConfigFieldKind`, `ConfigApplyMode`, `ConfigEnumOption`, `ConfigFieldSchema`, `MessageOrigin`, `MessageVisibility`, capability name constants.
- Modify: `crates/rayucode-harness-api/src/requests.rs` — add `ApiRequest::GetCapabilities`, `GetConfig`, `PatchConfig`.
- Modify: `crates/rayucode-harness-api/src/events.rs` — add `ApiEvent::Capabilities`, `ConfigState`, `ConfigChanged`; extend `ModelRouteInfo`, `ToolDone`, `TextDone`, `HistoryMessage`, `ErrorCode`.
- Modify: `crates/rayucode-harness-api/src/harness_api_tests/schema_snapshot.rs` & `capability_coverage.rs` — snapshot and coverage tests for `v1.16`.
- Create: `crates/rayucode-base/src/config/rpc_config.rs` — curated 9-section schema descriptors, secret-safe reader, validate-before-write `toml_edit` atomic patcher + unit tests.
- Modify: `crates/rayucode-base/src/config.rs` — expose `pub mod rpc_config`.
- Modify: `crates/rayucode-app-core/src/agent/response_recovery.rs` & `crates/rayucode-base/src/session/render.rs` — tag synthetic recovery/reconsideration prompts with `StoredDisplayRole::System` and carry provenance metadata.
- Create: `crates/rayucode-harness-api-server/src/capabilities.rs` — build curated `CommandDescriptor`, `PermissionModeDescriptor`, `FeatureFlagDescriptor`, and `ModelRouteInfo` enrichment (`supported_efforts`, `default_effort`, `context_window`).
- Modify: `crates/rayucode-harness-api-server/src/lib.rs` & `crates/rayucode-harness-api-server/src/translate.rs` — handle `GetCapabilities`, `GetConfig`, `PatchConfig`, broadcast `ConfigChanged`, populate `seq`/`turn_id`/`duration_ms`/`stop_reason`/`origin`/`visibility`/`ErrorCode::Busy|Unsupported`.
- Create: `crates/rayucode-harness-api-server/src/v1_16_contract_tests.rs` — end-to-end server contract tests.

### PR 2 (`stack/2-sdk-and-session-core` → PR 1)
- Modify: `sdk/typescript/src/protocol.ts` — bump `API_VERSION_MINOR = 16`, mirror all `v1.16` types & frames.
- Modify: `sdk/typescript/src/client.ts` & `sdk/typescript/src/index.ts` — add `getCapabilities`, `getConfig`, `patchConfig`, `hasCapability`, and graceful `v1.15` downgrade.
- Create: `sdk/typescript/test/v1-16-contract.test.ts` — SDK round-trip & downgrade tests.
- Create: `packages/session-core/src/client/slash-dispatch.ts` — `parseSlashInvocation`.
- Create: `packages/session-core/src/client/model-capabilities.ts` — `resolveEffortLadder`.
- Create: `packages/session-core/src/client/history-provenance.ts` — `filterVisibleHistory`.
- Modify: `packages/session-core/src/client/index.ts` — re-export the 3 new modules.
- Create: `packages/session-core/test/client/slash-dispatch.test.ts`, `model-capabilities.test.ts`, `history-provenance.test.ts`.

### PR 3 (`stack/3-ux-ui-composer-settings-desktop` → PR 2)
- Modify: `desktop/electron/daemon-client.ts`, `desktop/electron/ipc-schemas.ts`, `desktop/electron/main.ts`, `desktop/electron/preload.cjs`, `desktop/electron/storage-bridge.ts` — bridge `getCapabilities`, `getConfig`, `patchConfig`, `config_changed`, `model_info`, `permission_mode_changed`, one-time `desktop-settings.json` migration, structured `ErrorCode` handling.
- Modify: `desktop/src/lib/ipc-client.ts`, `desktop/src/lib/harness-adapter.ts` — consume `packages/session-core`, remove regex error scraping and hardcoded model/effort/slash lists, consume `model_info`/`permission_mode_changed`/`config_changed`.
- Modify: `desktop/src/features/sessions/hooks/use-sessions.ts`, `desktop/src/features/sessions/constants/models.ts`, `desktop/src/features/sessions/components/composer.tsx` — adaptive effort selector, active-session `setModel`/`setEffort` wiring, live grouped slash command popover & real dispatch.
- Modify: `desktop/src/features/settings/components/settings-view.tsx`, `desktop/src/features/settings/hooks/use-settings.ts` — wire engine settings to `~/.rayu/config.toml` with Sync/Reload badges and validation errors while keeping appearance preferences local.
- Test: `desktop/src/features/sessions/__tests__/composer-slash-skills.test.tsx`, `desktop/src/features/sessions/__tests__/model-effort-popover.test.tsx`, `desktop/src/features/settings/__tests__/settings-config-sync.test.tsx`, plus `1440×934` screenshots in `.swarm-logs/verify/`.

### PR 4 (`stack/4-ux-ui-composer-settings-vscode` → PR 2)
- Modify: `vscode/host/runtime/featureRouters.ts`, `vscode/host/harnessSession.ts`, `vscode/shared/protocol.ts` — expose `capabilities.get`, `config.get`, `config.patch`, `config.changed` broadcast.
- Modify: `vscode/webview/src/features/composer/components/SessionComposer.tsx`, `vscode/webview/src/features/composer/hooks/useComposerData.ts`, `vscode/webview/src/features/settings/hooks/useSettings.ts`, `vscode/webview/src/features/settings/components/*` — consume `packages/session-core` (`parseSlashInvocation`, `resolveEffortLadder`, `filterVisibleHistory`) and `config.toml` RPCs.
- Test: `vscode/test/featureRouters.test.ts`, `vscode/webview/src/features/composer/__tests__/composerSlashSkills.test.tsx`, `vscode/webview/src/features/settings/__tests__/settingsConfigSync.test.tsx`.

---

## PR 1 — `stack/1-harness-v1-16-contract` (Base: `dev`)

### Task 1: Harness API `v1.16` Wire Types & Schema Snapshots

**Files:**
- Create: `crates/rayucode-harness-api/src/capabilities_config.rs`
- Modify: `crates/rayucode-harness-api/src/lib.rs:50-119`
- Modify: `crates/rayucode-harness-api/src/requests.rs:40-430`
- Modify: `crates/rayucode-harness-api/src/events.rs:8-150,535-720`
- Test: `crates/rayucode-harness-api/src/harness_api_tests/schema_snapshot.rs`

**Interfaces:**
- Produces:
  - `API_VERSION_MINOR = 16`
  - Constants: `CAPABILITIES_CAPABILITY = "capabilities_v1"`, `CONFIG_CAPABILITY = "config_v1"`, `FRAME_FIDELITY_CAPABILITY = "frame_fidelity_v1"`
  - `ServerFrame { v, reply_to, seq: Option<u64>, turn_id: Option<String>, event }`
  - `ApiRequest::{GetCapabilities { session_id }, GetConfig { sections }, PatchConfig { patch }}`
  - `ApiEvent::{Capabilities { commands, permission_modes, features }, ConfigState { path, sections, values, schema }, ConfigChanged { changed_keys, requires_restart, values }}`
  - `ModelRouteInfo::{supported_efforts, default_effort, context_window}`, `ToolDone::duration_ms`, `TextDone::stop_reason`, `HistoryMessage::{origin, visibility}`, `ErrorCode::{Busy, Unsupported}`

- [ ] **Step 1: Create stacked branch from `dev`**

```bash
git checkout dev
git checkout -b stack/1-harness-v1-16-contract
```

- [ ] **Step 2: Write failing schema round-trip tests in `crates/rayucode-harness-api/src/harness_api_tests/schema_snapshot.rs`**

Append a new test module block verifying serialization/deserialization of `GetCapabilities`, `Capabilities`, `GetConfig`, `PatchConfig`, `ConfigState`, `ConfigChanged`, `ServerFrame` with `seq` + `turn_id`, `ToolDone.duration_ms`, `TextDone.stop_reason`, `HistoryMessage.origin` + `visibility`, `ModelRouteInfo.supported_efforts`, and `ErrorCode::Busy` / `ErrorCode::Unsupported`:

```rust
#[test]
fn v1_16_capabilities_config_and_frame_fidelity_round_trip() {
    assert_eq!(API_VERSION_MINOR, 16);

    let req = ClientFrame::new(
        1,
        ApiRequest::GetCapabilities {
            session_id: Some("sess_1".into()),
        },
    );
    let raw = serde_json::to_string(&req).unwrap();
    assert!(raw.contains(r#""req":"get_capabilities""#));
    assert_eq!(serde_json::from_str::<ClientFrame>(&raw).unwrap(), req);

    let mut frame = ServerFrame::event(ApiEvent::TextDone {
        session_id: "sess_1".into(),
        message_id: Some("m1".into()),
        stop_reason: Some("end_turn".into()),
    });
    frame.seq = Some(42);
    frame.turn_id = Some("turn_7".into());
    let raw_frame = serde_json::to_string(&frame).unwrap();
    assert!(raw_frame.contains(r#""seq":42"#));
    assert!(raw_frame.contains(r#""turn_id":"turn_7""#));
    assert!(raw_frame.contains(r#""stop_reason":"end_turn""#));
    assert_eq!(serde_json::from_str::<ServerFrame>(&raw_frame).unwrap(), frame);

    let msg = HistoryMessage {
        response_stats: None,
        role: "user".into(),
        content: "Reassess request".into(),
        tool: None,
        origin: Some(MessageOrigin::EngineInternal),
        visibility: Some(MessageVisibility::Hidden),
    };
    let raw_msg = serde_json::to_string(&msg).unwrap();
    assert!(raw_msg.contains(r#""origin":"engine_internal""#));
    assert!(raw_msg.contains(r#""visibility":"hidden""#));
    assert_eq!(serde_json::from_str::<HistoryMessage>(&raw_msg).unwrap(), msg);

    let busy = ApiEvent::Error {
        code: ErrorCode::Busy,
        message: "turn in progress".into(),
    };
    assert!(serde_json::to_string(&busy).unwrap().contains(r#""code":"busy""#));
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p rayucode-harness-api v1_16_capabilities_config_and_frame_fidelity_round_trip`
Expected: FAIL to compile (`GetCapabilities`, `MessageOrigin`, `ErrorCode::Busy`, `frame.seq` not defined).

- [ ] **Step 4: Create `crates/rayucode-harness-api/src/capabilities_config.rs` and update `lib.rs`, `requests.rs`, `events.rs`**

Create `crates/rayucode-harness-api/src/capabilities_config.rs`:

```rust
use serde::{Deserialize, Serialize};

pub const CAPABILITIES_CAPABILITY: &str = "capabilities_v1";
pub const CONFIG_CAPABILITY: &str = "config_v1";
pub const FRAME_FIDELITY_CAPABILITY: &str = "frame_fidelity_v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandCategory {
    Session,
    Model,
    Quality,
    Tools,
    Runtime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandDispatch {
    ApiRequest { req: String },
    RuntimeCommand { command: String },
    Skill { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandDescriptor {
    pub name: String,
    pub description: String,
    pub category: CommandCategory,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arg_hint: Option<String>,
    #[serde(default)]
    pub requires_session: bool,
    pub dispatch: CommandDispatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionModeDescriptor {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FeatureFlagDescriptor {
    pub key: String,
    pub enabled: bool,
    pub description: String,
    #[serde(default)]
    pub requires_restart: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFieldKind {
    Boolean,
    String,
    Integer,
    Number,
    Enum,
    StringArray,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigApplyMode {
    Immediate,
    NextTurn,
    RestartRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigEnumOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigFieldSchema {
    pub key: String,
    pub section: String,
    pub label: String,
    pub description: String,
    pub kind: ConfigFieldKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<ConfigEnumOption>>,
    pub default_value: serde_json::Value,
    pub apply_mode: ConfigApplyMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageOrigin {
    UserTyped,
    EngineInternal,
    LegacyUnknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageVisibility {
    Visible,
    Hidden,
}
```

Update `crates/rayucode-harness-api/src/lib.rs`:
- Declare `mod capabilities_config; pub use capabilities_config::*;`
- Set `pub const API_VERSION_MINOR: u32 = 16;`
- Add `#[serde(default, skip_serializing_if = "Option::is_none")] pub seq: Option<u64>,` and `#[serde(default, skip_serializing_if = "Option::is_none")] pub turn_id: Option<String>,` to `ServerFrame` (defaulting to `None` in `ServerFrame::event` and `ServerFrame::reply`, plus builder method `with_turn_meta(mut self, seq: Option<u64>, turn_id: Option<String>) -> Self`).

Update `crates/rayucode-harness-api/src/requests.rs` (`ApiRequest`):
- `GetCapabilities { #[serde(default, skip_serializing_if = "Option::is_none")] session_id: Option<String> }`
- `GetConfig { #[serde(default, skip_serializing_if = "Option::is_none")] sections: Option<Vec<String>> }`
- `PatchConfig { patch: serde_json::Map<String, serde_json::Value> }`

Update `crates/rayucode-harness-api/src/events.rs`:
- Add `ApiEvent::Capabilities { commands, permission_modes, features }`, `ApiEvent::ConfigState { path, sections, values, schema }`, `ApiEvent::ConfigChanged { changed_keys, requires_restart, values }`.
- Add `#[serde(default, skip_serializing_if = "Option::is_none")] stop_reason: Option<String>` to `ApiEvent::TextDone`.
- Add `#[serde(default, skip_serializing_if = "Option::is_none")] duration_ms: Option<u64>` to `ApiEvent::ToolDone`.
- Add `supported_efforts: Vec<String>`, `default_effort: Option<String>`, `context_window: Option<u64>` to `ModelRouteInfo` (all `#[serde(default, skip_serializing_if = "...")]`).
- Add `origin: Option<MessageOrigin>`, `visibility: Option<MessageVisibility>` to `HistoryMessage`.
- Add `Busy` and `Unsupported` to `ErrorCode`.
- Fix struct literal constructions across workspace crates (`rayucode-harness-api-server`, `rayucode-sdk`) to supply `None` / default for the newly added fields.

- [ ] **Step 5: Run Rust harness-api tests to verify pass**

Run: `cargo test -p rayucode-harness-api`
Expected: PASS (0 failures, including `schema_snapshot` and `capability_coverage`).

- [ ] **Step 6: Commit**

```bash
git add crates/rayucode-harness-api crates/rayucode-harness-api-server crates/rayucode-sdk
git commit -m "feat(harness-api): add v1.16 capabilities, config RPC, and frame fidelity types"
```

---

### Task 2: Canonical `~/.rayu/config.toml` Curated Schema & Atomic `toml_edit` Patcher

**Files:**
- Create: `crates/rayucode-base/src/config/rpc_config.rs`
- Modify: `crates/rayucode-base/src/config.rs` (expose `pub mod rpc_config;`)

**Interfaces:**
- Consumes: `Config::path()`, `Config::load()`, `toml_edit::Document`, `change_report::diff_toml`
- Produces:
  - `pub const CURATED_CONFIG_SECTIONS: &[&str] = &["provider", "compaction", "display", "features", "safety", "agents", "autoreview", "autojudge", "notifications"];`
  - `pub struct ConfigSnapshot { pub path: String, pub sections: Vec<String>, pub values: serde_json::Map<String, serde_json::Value>, pub schema: Vec<ConfigFieldDescriptor> }`
  - `pub struct ConfigPatchOutcome { pub snapshot: ConfigSnapshot, pub changed_keys: Vec<String>, pub requires_restart: bool }`
  - `pub fn read_curated_config(sections: Option<&[String]>) -> anyhow::Result<ConfigSnapshot>`
  - `pub fn patch_curated_config(patch: &serde_json::Map<String, serde_json::Value>) -> anyhow::Result<ConfigPatchOutcome>`

- [ ] **Step 1: Write failing unit tests in `crates/rayucode-base/src/config/rpc_config.rs`**

Test all 4 production invariants using an isolated `tempdir` `RAYU_HOME`:
1. `read_curated_config` never leaks secrets (even if `api_key` exists in `[provider]` or `[providers.*]`).
2. `patch_curated_config` preserves user comments and untouched sections in `config.toml` via `toml_edit`.
3. `patch_curated_config` rejects unknown keys and wrong value types *before* modifying disk.
4. `patch_curated_config` writes atomically and computes `changed_keys` + `requires_restart` accurately.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::lock_test_env;
    use tempfile::tempdir;

    #[test]
    fn patch_preserves_comments_and_rejects_invalid_keys_without_touching_disk() {
        let _guard = lock_test_env();
        let home = tempdir().unwrap();
        let prev = std::env::var_os("RAYU_HOME");
        unsafe { std::env::set_var("RAYU_HOME", home.path()); }

        let config_path = home.path().join("config.toml");
        let initial = "# User custom header\n[display]\nemoji = true # keep comment\n\n[provider]\napi_key = \"sk-secret-must-not-leak\"\n";
        std::fs::write(&config_path, initial).unwrap();

        let snap = read_curated_config(None).unwrap();
        let serialized = serde_json::to_string(&snap.values).unwrap();
        assert!(!serialized.contains("sk-secret-must-not-leak"));

        // Invalid key must fail without editing disk
        let mut bad = serde_json::Map::new();
        bad.insert("provider.api_key".into(), serde_json::json!("hacked"));
        assert!(patch_curated_config(&bad).is_err());
        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), initial);

        // Valid patch preserves comments and updates only target field
        let mut good = serde_json::Map::new();
        good.insert("display.emoji".into(), serde_json::json!(false));
        let outcome = patch_curated_config(&good).unwrap();
        assert_eq!(outcome.changed_keys, vec!["display.emoji".to_string()]);
        let updated = std::fs::read_to_string(&config_path).unwrap();
        assert!(updated.contains("# User custom header"));
        assert!(updated.contains("emoji = false"));

        match prev {
            Some(v) => unsafe { std::env::set_var("RAYU_HOME", v) },
            None => unsafe { std::env::remove_var("RAYU_HOME") },
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rayucode-base --lib rpc_config`
Expected: FAIL (`rpc_config` module not defined).

- [ ] **Step 3: Implement `crates/rayucode-base/src/config/rpc_config.rs`**

Implement:
- Curated field registry covering safe, user-facing non-secret fields across the 9 curated sections (`provider.default_model`, `provider.default_provider`, `provider.default_permission_mode`, `provider.kv_cache_ttl`, `provider.service_tier`, `compaction.mode`, `compaction.auto_compact`, `display.emoji`, `display.centered`, `display.reasoning_display`, `features.memory`, `features.swarm`, `features.mermaid`, `features.auto_poke`, `features.kv_cache_miss_notices`, `features.check_updates`, `safety.confirm_destructive_bash`, `agents.default_subagent_model`, `autoreview.enabled`, `autojudge.enabled`, `notifications.enabled`).
- Strict allow-list validation: any key not in the curated descriptor table (including any `*key*`, `*token*`, `*secret*`) returns an `anyhow::Error` describing the rejected key before disk access.
- Type & enum validation against each field's `ConfigFieldKind` and `options`.
- `toml_edit::Document` mutation of existing `config.toml` (creating parent dirs if absent), parse-verification via `toml::from_str::<Config>(&rendered)`, atomic write to `config.toml.tmp.<pid>` + `std::fs::rename` onto `config.toml`.
- Reload in-process config cache so subsequent `Config::load()` / daemon reads see the update immediately.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p rayucode-base --lib rpc_config`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add crates/rayucode-base/src/config.rs crates/rayucode-base/src/config/rpc_config.rs
git commit -m "feat(base): add curated config.toml schema reader and atomic toml_edit patcher"
```

---

### Task 3: Message Provenance Fix (Audit-5) in Rust Engine & Renderer

**Files:**
- Modify: `crates/rayucode-app-core/src/agent/response_recovery.rs:60-100,215-330`
- Modify: `crates/rayucode-base/src/session/render.rs:470-530`
- Test: `crates/rayucode-app-core/src/agent_tests.rs` & `crates/rayucode-base/src/session/render.rs` (tests)

**Interfaces:**
- Produces: Synthetic recovery/reconsideration prompts persisted with `StoredDisplayRole::System`; `RenderedMessage` carries `is_engine_internal: bool` so `translate.rs` sets `HistoryMessage.origin = Some(MessageOrigin::EngineInternal)` and `visibility = Some(MessageVisibility::Hidden)`.

- [ ] **Step 1: Write failing test in `crates/rayucode-base/src/session/render.rs`**

Add a unit test verifying that a `StoredMessage` with `role: Role::User` and `display_role: Some(StoredDisplayRole::System)` (as written by `maybe_reconsider_fable_guardrail` or `[System reminder: ...]`) renders with `is_engine_internal == true` and does NOT render as `role == "user"`.

```rust
#[test]
fn synthetic_system_display_role_marks_rendered_message_engine_internal() {
    let mut session = Session::create_with_id("prov_test".into(), None, None);
    session.add_message_ext_with_display_role(
        Role::User,
        vec![ContentBlock::Text {
            text: "Reassess the user's request using its full context".into(),
            cache_control: None,
        }],
        None,
        None,
        Some(StoredDisplayRole::System),
    );
    let rendered = render_messages(&session);
    assert!(rendered.iter().all(|m| m.role != "user"));
    assert!(rendered.iter().any(|m| m.is_engine_internal));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rayucode-base --lib synthetic_system_display_role_marks_rendered_message_engine_internal`
Expected: FAIL (`is_engine_internal` field missing).

- [ ] **Step 3: Implement provenance tagging in `response_recovery.rs` and `render.rs`**

- In `crates/rayucode-app-core/src/agent/response_recovery.rs`: switch `maybe_reconsider_fable_guardrail`, `maybe_continue_incomplete_response`, and `maybe_continue_stranded_tool_use` from `self.add_message(Role::User, ...)` to `self.session.add_message_ext_with_display_role(Role::User, blocks, None, None, Some(StoredDisplayRole::System))`.
- In `crates/rayucode-base/src/session/render.rs`: add `pub is_engine_internal: bool` to `RenderedMessage`, setting it `true` when `msg.display_role == Some(StoredDisplayRole::System)` or `is_auto_poke_user_message(msg)` or `is_scheduled_task_message(msg)` or text starts with `[System reminder:`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p rayucode-base --lib render && cargo test -p rayucode-app-core --lib fable_guardrail`
Expected: PASS (0 failures). *(Ensure `fable_guardrail_reconsideration_recovers_the_streaming_turn` also redirects `RAYU_HOME` to a `tempdir` so tests never leak sessions into `~/.rayu/sessions/`.)*

- [ ] **Step 5: Commit**

```bash
git add crates/rayucode-app-core/src/agent/response_recovery.rs crates/rayucode-app-core/src/agent_tests.rs crates/rayucode-base/src/session/render.rs
git commit -m "fix(runtime): tag synthetic recovery prompts as engine_internal provenance"
```

---

### Task 4: Harness API Server `v1.16` Bridge, Live Prompt E2E & Open PR 1 → `dev`

**Files:**
- Create: `crates/rayucode-harness-api-server/src/capabilities.rs`
- Modify: `crates/rayucode-harness-api-server/src/lib.rs`
- Modify: `crates/rayucode-harness-api-server/src/translate.rs`
- Create: `crates/rayucode-harness-api-server/src/v1_16_contract_tests.rs`

**Interfaces:**
- Consumes: `rayucode_harness_api::*`, `rayucode_base::config::rpc_config::*`, `rayucode_provider_core::inferred_reasoning_efforts`
- Produces: Full `v1.16` NDJSON wire server advertising `capabilities_v1`, `config_v1`, `frame_fidelity_v1` in `HelloOk.capabilities`.

- [ ] **Step 1: Write failing server contract tests in `crates/rayucode-harness-api-server/src/v1_16_contract_tests.rs`**

Test:
1. `Hello` reply includes `"capabilities_v1"`, `"config_v1"`, `"frame_fidelity_v1"` in `HelloOk.capabilities`.
2. `GetCapabilities` returns curated commands (includes `"compact"`, `"effort"`, `"model"`, `"review"`, `"context"`, `"cache"`, `"clear"`; excludes `"cls"`, `"clear-view"`, `"debug-visual"`, `"onboarding-sim"`), permission modes, and feature flags.
3. `GetConfig` & `PatchConfig` read/write isolated `RAYU_HOME/config.toml` and emit `ConfigChanged` to peer connections.
4. `translate.rs` attaches monotonic `seq` + `turn_id` on streaming `ServerFrame`s, `duration_ms` on `ToolDone`, `stop_reason` on `TextDone`, `origin`/`visibility` on `HistoryMessage`, and maps busy/unsupported errors to `ErrorCode::Busy` / `ErrorCode::Unsupported`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rayucode-harness-api-server v1_16_contract_tests`
Expected: FAIL.

- [ ] **Step 3: Implement `capabilities.rs` and wire `lib.rs` + `translate.rs`**

- `capabilities.rs`: build `build_capabilities_event(session_id)` and `enrich_model_route(route)` (attaching `supported_efforts` via `inferred_reasoning_efforts` minus `swarm*`, `default_effort`, and `context_window`).
- `lib.rs`: handle `ApiRequest::GetCapabilities`, `ApiRequest::GetConfig`, `ApiRequest::PatchConfig` (broadcasting `ApiEvent::ConfigChanged` across connected clients on successful patch), and advertise `CAPABILITIES_CAPABILITY`, `CONFIG_CAPABILITY`, `FRAME_FIDELITY_CAPABILITY` in `HelloOk`.
- `translate.rs`: maintain per-session monotonic `AtomicU64` sequence counter, attach `seq` and active `turn_id` to translated `ServerFrame`s, forward `tool_duration_ms` → `ToolDone.duration_ms`, `MessageEnd.stop_reason` → `TextDone.stop_reason`, `RenderedMessage.is_engine_internal` → `HistoryMessage.origin`/`visibility`, and map busy/unsupported daemon errors to `ErrorCode::Busy`/`ErrorCode::Unsupported`.

- [ ] **Step 4: Run full Rust verification suite**

Run: `cargo test -p rayucode-harness-api -p rayucode-harness-api-server -p rayucode-base -p rayucode-app-core`
Expected: PASS (0 failures).

- [ ] **Step 5: Mandatory Live Isolated-Socket & Live Prompt E2E Verification**

Build isolated binary and verify live over an isolated socket + temp `RAYU_HOME` (never touching `~/.rayu/builds/shared-server/rayu`):

```bash
cargo build --profile selfdev
TMP_HOME=$(mktemp -d)
SOCK="/tmp/rayu-v116-e2e-$$.sock"
RAYU_HOME="$TMP_HOME" ./target/selfdev/rayu run --no-update --socket "$SOCK" "Reply with exactly: LIVE_E2E_OK"
```

And send live NDJSON `hello`, `get_capabilities`, `get_config`, `patch_config`, `create_session`, and `send_message` frames over `./target/selfdev/rayu api-bridge --stdio` (with `RAYU_HOME="$TMP_HOME"`) asserting real `hello_ok` (`capabilities_v1`, `config_v1`, `frame_fidelity_v1`), real `capabilities`, real `config_state`, updated `$TMP_HOME/config.toml`, and streaming `seq`/`turn_id`/`stop_reason` frames.

- [ ] **Step 6: Commit, push & open stacked PR 1 → `dev`**

```bash
git add crates/rayucode-harness-api-server
git commit -m "feat(harness-server): wire v1.16 capabilities, config.toml RPC, and frame fidelity"
git push -u origin stack/1-harness-v1-16-contract
gh pr create --base dev --head stack/1-harness-v1-16-contract --title "feat(harness): v1.16 capabilities, canonical config.toml RPC, and frame fidelity" --body "Part 1/4 of Engine-Driven Thin-Client Contract (docs/superpowers/specs/2026-11-25-engine-driven-thin-client-contract-design.md)."
```

---

## PR 2 — `stack/2-sdk-and-session-core` (Base: `stack/1-harness-v1-16-contract`)

### Task 5: `@rayu-dev/rayucode-sdk` `v1.16` Methods & `v1.15` Graceful Downgrade

**Files:**
- Modify: `sdk/typescript/src/protocol.ts:1-120` (and request/event unions)
- Modify: `sdk/typescript/src/client.ts` & `sdk/typescript/src/index.ts`
- Create: `sdk/typescript/test/v1-16-contract.test.ts`

**Interfaces:**
- Consumes: Rust `v1.16` NDJSON wire format from PR 1
- Produces:
  - `client.hasCapability(cap: string): boolean`
  - `client.getCapabilities(sessionId?: string): Promise<CapabilitiesPayload | null>` (returns `null` gracefully on `v1.15` daemons)
  - `client.getConfig(sections?: string[]): Promise<ConfigStatePayload | null>`
  - `client.patchConfig(patch: Record<string, unknown>): Promise<ConfigStatePayload>`
  - Exported TS interfaces: `CommandDescriptor`, `PermissionModeDescriptor`, `FeatureFlagDescriptor`, `ConfigFieldSchema`, `ConfigStatePayload`, `CapabilitiesPayload`, `MessageOrigin`, `MessageVisibility`.

- [ ] **Step 1: Create stacked branch from PR 1**

```bash
git checkout -b stack/2-sdk-and-session-core stack/1-harness-v1-16-contract
```

- [ ] **Step 2: Write failing SDK tests in `sdk/typescript/test/v1-16-contract.test.ts`**

Test:
1. `v1.16` mock server: `getCapabilities()`, `getConfig()`, `patchConfig()` round-trip typed payloads and expose `seq`/`turn_id`/`duration_ms`/`stop_reason`/`origin`/`visibility`.
2. `v1.15` legacy mock server (empty `capabilities: []`): `hasCapability("capabilities_v1") === false`, `getCapabilities()` resolves to `null` without throwing, `getConfig()` resolves to `null` without throwing.

- [ ] **Step 3: Run SDK test to verify it fails**

Run: `cd sdk/typescript && npm run check`
Expected: FAIL (both `schema-parity.test.ts` for new Rust tags and `v1-16-contract.test.ts`).

- [ ] **Step 4: Implement `protocol.ts`, `client.ts`, and `index.ts`**

- Update `API_VERSION_MINOR = 16` and mirror all `v1.16` request/event/model/frame/error types in `sdk/typescript/src/protocol.ts`.
- Add `hasCapability`, `getCapabilities`, `getConfig`, `patchConfig` in `sdk/typescript/src/client.ts` with `v1.15` downgrade checks.
- Export all new types from `sdk/typescript/src/index.ts`.

- [ ] **Step 5: Run SDK checks to verify pass**

Run: `cd sdk/typescript && npm run check`
Expected: PASS (`typecheck` + `schema-parity.test.ts` + `v1-16-contract.test.ts` all pass, exit 0).

- [ ] **Step 6: Commit**

```bash
git add sdk/typescript
git commit -m "feat(sdk): add v1.16 capabilities, config RPCs, and v1.15 graceful downgrade"
```

---

### Task 6: Shared `packages/session-core` Contract Helpers & Open PR 2 → PR 1

**Files:**
- Create: `packages/session-core/src/client/slash-dispatch.ts`
- Create: `packages/session-core/src/client/model-capabilities.ts`
- Create: `packages/session-core/src/client/history-provenance.ts`
- Modify: `packages/session-core/src/client/index.ts`
- Create: `packages/session-core/test/client/slash-dispatch.test.ts`
- Create: `packages/session-core/test/client/model-capabilities.test.ts`
- Create: `packages/session-core/test/client/history-provenance.test.ts`

**Interfaces:**
- Produces:
  - `parseSlashInvocation(input: string, commands: readonly CommandDescriptor[], skills: readonly SkillDescriptor[]): SlashInvocation`
  - `resolveEffortLadder(route: Pick<ModelRouteInfo, "supported_efforts" | "default_effort"> | null | undefined): EffortLadder`
  - `filterVisibleHistory<T extends ProvenanceTaggedMessage>(messages: readonly T[]): T[]`

- [ ] **Step 1: Write failing Vitest suites for all 3 modules**

- `slash-dispatch.test.ts`: verifies `/compact`, `/effort high`, `/model claude-sonnet-4-6`, `/review`, `/my-skill fix bug` dispatch to exact typed actions; verifies `/usr/local/bin` and `" /model literal"` stay `{ kind: "plain_prompt" }`.
- `model-capabilities.test.ts`: verifies `resolveEffortLadder` returns `{ supported: false, stops: [], defaultStop: null }` when empty, filters any `swarm*` sentinel defensively, and selects engine `default_effort` without ever fabricating `"auto"`.
- `history-provenance.test.ts`: verifies `origin: "engine_internal"` and `visibility: "hidden"` are filtered out while `user_typed` and legacy (`origin: undefined`) user messages remain visible.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/session-core && npm test`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement the 3 modules and export them from `packages/session-core/src/client/index.ts`**

- Implement clean, pure TypeScript functions with zero React/DOM/Electron/VS Code imports.

- [ ] **Step 4: Run tests and live SDK-to-daemon E2E verification**

Run: `cd packages/session-core && npm test && cd ../../sdk/typescript && npm run check`
Expected: PASS (0 failures).

Run a live Node smoke script using the compiled `@rayu-dev/rayucode-sdk` + `packages/session-core` against `./target/selfdev/rayu api-bridge` (isolated `RAYU_HOME` + socket) calling `getCapabilities`, `getConfig`, `patchConfig`, `resolveEffortLadder`, `parseSlashInvocation("/compact", ...)`, and sending a live prompt.

- [ ] **Step 5: Commit, push & open stacked PR 2 → PR 1**

```bash
git add packages/session-core
git commit -m "feat(session-core): add shared slash dispatch, effort ladder, and provenance helpers"
git push -u origin stack/2-sdk-and-session-core
gh pr create --base stack/1-harness-v1-16-contract --head stack/2-sdk-and-session-core --title "feat(sdk,session-core): v1.16 SDK client and shared slash/effort/provenance helpers" --body "Part 2/4 of Engine-Driven Thin-Client Contract."
```

---

## PR 3 — `stack/3-ux-ui-composer-settings-desktop` (Base: `stack/2-sdk-and-session-core`)

### Task 7: Desktop Electron Bridge, Event Handling & One-Time `desktop-settings.json` Migration

**Files:**
- Modify: `desktop/electron/daemon-client.ts`
- Modify: `desktop/electron/ipc-schemas.ts`
- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/preload.cjs`
- Modify: `desktop/electron/storage-bridge.ts`
- Modify: `desktop/src/lib/ipc-client.ts`
- Modify: `desktop/src/lib/harness-adapter.ts`
- Test: `desktop/electron/__tests__/daemon-client.test.ts`, `desktop/electron/__tests__/storage-bridge.test.ts`, `desktop/src/lib/__tests__/harness-adapter.test.ts`

**Interfaces:**
- Consumes: `@rayu-dev/rayucode-sdk` `v1.16` & `packages/session-core`
- Produces:
  - Electron IPC channels: `rayu:harness:get-capabilities`, `rayu:harness:get-config`, `rayu:harness:patch-config`
  - Event forwarding & reducer handling for `model_info`, `permission_mode_changed`, `config_changed`, `duration_ms`, `stop_reason`
  - `migrateLegacyEngineSettingsOnce()` in `storage-bridge.ts` (one-time idempotent flag `engineConfigMigratedV1: true`)

- [ ] **Step 1: Create stacked branch from PR 2**

```bash
git checkout -b stack/3-ux-ui-composer-settings-desktop stack/2-sdk-and-session-core
```

- [ ] **Step 2: Write failing tests for Desktop IPC bridge, `harness-adapter` provenance/events, and one-time migration**

- In `desktop/electron/__tests__/daemon-client.test.ts`: assert `getCapabilities`, `getConfig`, `patchConfig`, and structured `ErrorCode::Busy`/`Unsupported` handling without regex matching.
- In `desktop/electron/__tests__/storage-bridge.test.ts`: assert `migrateLegacyEngineSettingsOnce` copies legacy `defaultModel`/`defaultPermissionMode`/`autoCompactContext`/`kvCacheTtl` into `patchConfig` once without overwriting keys already set in `config.toml`, then sets `engineConfigMigratedV1: true`.
- In `desktop/src/lib/__tests__/harness-adapter.test.ts`: assert `mapHistoryMessagesToTurns` filters `origin: "engine_internal"` via `filterVisibleHistory` and applies `model_info` / `permission_mode_changed` / `ToolDone.duration_ms` / `TextDone.stop_reason`.

- [ ] **Step 3: Run tests to verify failure**

Run: `cd desktop && npx vitest run electron/__tests__/daemon-client.test.ts electron/__tests__/storage-bridge.test.ts src/lib/__tests__/harness-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement Electron bridge, migration, and `harness-adapter` updates**

- Expose `getCapabilities`, `getConfig`, `patchConfig` across `daemon-client.ts` → `main.ts` → `preload.cjs` → `ipc-client.ts` with Zod validation in `ipc-schemas.ts`.
- Replace regex error scraping in `daemon-client.ts` with `err.code === "busy"` / `err.code === "unsupported"`.
- Update `harness-adapter.ts` to use `filterVisibleHistory` from `packages/session-core`, consume `model_info`, `permission_mode_changed`, `ToolDone.duration_ms`, and `TextDone.stop_reason`.
- Implement `migrateLegacyEngineSettingsOnce` in `storage-bridge.ts`.

- [ ] **Step 5: Run tests to verify pass**

Run: `cd desktop && npx vitest run electron/__tests__/daemon-client.test.ts electron/__tests__/storage-bridge.test.ts src/lib/__tests__/harness-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron desktop/src/lib
git commit -m "feat(desktop): wire v1.16 capabilities, config.toml IPC, provenance, and legacy migration"
```

---

### Task 8: Desktop Composer & Settings UX/UI Cutover, UI/UX Designer Gate, Live E2E & Open PR 3 → PR 2

**Files:**
- Modify: `desktop/src/features/sessions/hooks/use-sessions.ts`
- Modify: `desktop/src/features/sessions/constants/models.ts`
- Modify: `desktop/src/features/sessions/components/composer.tsx`
- Modify: `desktop/src/features/settings/components/settings-view.tsx`
- Modify: `desktop/src/features/settings/hooks/use-settings.ts`
- Test: `desktop/src/features/sessions/__tests__/composer-slash-skills.test.tsx`, `desktop/src/features/sessions/__tests__/model-effort-popover.test.tsx`, `desktop/src/features/settings/__tests__/settings-config-sync.test.tsx`

**Interfaces:**
- Consumes: `ipcClient.harness.{getCapabilities, getConfig, patchConfig, setModel, setReasoningEffort}`, `packages/session-core` (`parseSlashInvocation`, `resolveEffortLadder`)

- [ ] **Step 1: Pre-flight Design & shadcn/ui Check (Mandatory per `AGENTS.md`)**

Read `DESIGN.md`, `desktop/src/styles/globals.css`, and matching `prototype/*.html`, then run:

```bash
node desktop/scripts/check-shadcn.mjs check popover select switch badge separator tooltip --json
```

- [ ] **Step 2: Write failing component tests for Composer & Settings**

- `model-effort-popover.test.tsx`: assert effort stops come strictly from `resolveEffortLadder(activeModel)` (hiding selector when empty, rendering `"xhigh"` when engine reports it, never sending `"auto"`), and clicking model/effort calls active-session `setModel` / `setReasoningEffort` immediately (showing `"Applies on next turn"` notice if `code === "busy"`).
- `composer-slash-skills.test.tsx`: assert popover groups live `Engine Commands` and `Skills`, and submitting `/compact` or `/effort high` invokes the real RPC dispatcher rather than sending raw prompt text.
- `settings-config-sync.test.tsx`: assert Settings renders **Synced with `~/.rayu/config.toml`** badge for engine fields, patches real `config.toml` via `patchConfig`, displays inline validation errors on failure, updates reactively on `config_changed`, and keeps Theme/Accent/MiniPet local.

- [ ] **Step 3: Run tests to verify failure**

Run: `cd desktop && npx vitest run src/features/sessions/__tests__/model-effort-popover.test.tsx src/features/sessions/__tests__/composer-slash-skills.test.tsx src/features/settings/__tests__/settings-config-sync.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement Composer & Settings UX/UI cutover (strict `DESIGN.md` semantic tokens)**

- Remove hardcoded 20-model catalog, hardcoded 5-stop `["Auto","Low","Medium","High","Max"]` effort ladder, and hardcoded 10-item `SLASH_COMMANDS` from `models.ts` / `ipc-client.ts`.
- Fix `use-sessions.ts` (`rayu-effort-idx` dead code) so active-session model & effort changes call `ipcClient.harness.setModel` / `setReasoningEffort` and stay synced via `model_info`.
- Wire `composer.tsx` to `parseSlashInvocation` + grouped popover (`Engine Commands` / `Skills` with `arg_hint`).
- Wire `settings-view.tsx` to curated `config.toml` sections using `globals.css` tokens (`bg-pane`, `bg-raised`, `text-ink`, `text-muted`, `border-hairline`), with clean `Synced with config.toml` / `Reload required` badges and inline validation errors.

- [ ] **Step 5: Dedicated UI/UX Design Review Gate & `1440×934` Visual Verification**

- Dispatch a dedicated UI/UX Designer review subagent (reading `DESIGN.md`, `globals.css`, and `prototype/`) to audit Composer & Settings interaction states (empty, loading, mid-turn busy notice, validation error, `v1.15` daemon fallback).
- Render Composer & Settings at `1440×934` in **Dark (Rayu Green)**, **Dark (Ocean Blue)**, and **Light** modes into `.swarm-logs/verify/pr3-desktop-*.png` and compare visually against `prototype/`, fixing any discrepancy.

- [ ] **Step 6: Full Desktop Verify Gate & Live Daemon Prompt E2E**

Run: `cd desktop && pnpm verify` (0 type errors, 0 lint errors, 0 design violations, all Vitest tests passing, renderer + electron builds exit 0).
Launch Desktop against the isolated live daemon (`./target/selfdev/rayu`), verify live model/effort switching, live `/compact` & `/effort` slash command execution, live Settings edit persisted to `config.toml`, reload persistence, and live prompt round-trip.

- [ ] **Step 7: Commit, push & open stacked PR 3 → PR 2**

```bash
git add desktop
git commit -m "feat(desktop): cut over Composer and Settings to v1.16 live registries and config.toml"
git push -u origin stack/3-ux-ui-composer-settings-desktop
gh pr create --base stack/2-sdk-and-session-core --head stack/3-ux-ui-composer-settings-desktop --title "feat(desktop): engine-driven Composer & Settings UX over v1.16 contract" --body "Part 3/4 of Engine-Driven Thin-Client Contract. Includes UI/UX review, pnpm verify, 1440x934 3-theme screenshots, and live daemon prompt E2E."
```

---

## PR 4 — `stack/4-ux-ui-composer-settings-vscode` (Base: `stack/2-sdk-and-session-core`)

### Task 9: VS Code Extension Host `v1.16` Routers (`capabilities.get`, `config.get`, `config.patch`)

**Files:**
- Modify: `vscode/shared/protocol.ts`
- Modify: `vscode/host/harnessSession.ts`
- Modify: `vscode/host/runtime/featureRouters.ts`
- Test: `vscode/test/featureRouters.test.ts`

**Interfaces:**
- Consumes: `@rayu-dev/rayucode-sdk` `v1.16`
- Produces: Host RPCs `capabilities.get`, `config.get`, `config.patch` + push notification `config.changed` to webview.

- [ ] **Step 1: Create stacked branch from PR 2**

```bash
git checkout -b stack/4-ux-ui-composer-settings-vscode stack/2-sdk-and-session-core
```

- [ ] **Step 2: Write failing host router tests in `vscode/test/featureRouters.test.ts`**

Assert `capabilities.get` returns engine commands/permission modes/features, `config.get` returns curated `config.toml` snapshot, `config.patch` validates & updates config and returns `{ ok: true, config }` (or `{ ok: false, message }` on invalid patch without faking success).

- [ ] **Step 3: Run host test to verify failure**

Run: `cd vscode && npm run test:host`
Expected: FAIL.

- [ ] **Step 4: Implement `capabilities.get`, `config.get`, `config.patch` and `config.changed` push**

- Add typed RPC definitions in `vscode/shared/protocol.ts`.
- Expose `getCapabilities`, `getConfig`, `patchConfig` on `harnessSession.ts` and route them in `featureRouters.ts`.
- Forward `config_changed` events to webview so CLI/Desktop edits live-update VS Code Settings.

- [ ] **Step 5: Run host tests to verify pass**

Run: `cd vscode && npm run test:host`
Expected: PASS (0 failures).

- [ ] **Step 6: Commit**

```bash
git add vscode/shared vscode/host vscode/test
git commit -m "feat(vscode): wire v1.16 capabilities and config.toml RPCs in extension host"
```

---

### Task 10: VS Code Webview Composer & Settings Cutover, UI/UX Review, Live E2E & Open PR 4 → PR 2

**Files:**
- Modify: `vscode/webview/src/features/composer/components/SessionComposer.tsx`
- Modify: `vscode/webview/src/features/composer/hooks/useComposerData.ts`
- Modify: `vscode/webview/src/features/settings/hooks/useSettings.ts`
- Modify: `vscode/webview/src/features/settings/components/*` (engine config sections)
- Modify: `vscode/webview/src/lib/harness-adapter.ts`
- Modify: `vscode/webview/src/lib/mock-vscode-bridge.ts`
- Test: `vscode/webview/src/features/composer/__tests__/composerSlashSkills.test.tsx`, `vscode/webview/src/features/settings/__tests__/settingsConfigSync.test.tsx`

**Interfaces:**
- Consumes: Host RPCs `capabilities.get`, `config.get`, `config.patch` + `packages/session-core` (`parseSlashInvocation`, `resolveEffortLadder`, `filterVisibleHistory`)

- [ ] **Step 1: Write failing webview tests for Composer & Settings**

- `composerSlashSkills.test.tsx`: assert Composer uses `parseSlashInvocation` + `resolveEffortLadder` from `packages/session-core`, adapts effort stops dynamically per model, and dispatches live slash commands.
- `settingsConfigSync.test.tsx`: assert Settings reads/writes `~/.rayu/config.toml` via `config.get`/`config.patch`, shows inline errors on rejected patches (never faking success), and refreshes on `config.changed`.

- [ ] **Step 2: Run webview tests to verify failure**

Run: `cd vscode && npm test`
Expected: FAIL.

- [ ] **Step 3: Implement VS Code Composer, Settings & `harness-adapter` cutover**

- Replace hardcoded effort/slash helpers in `SessionComposer.tsx` / `useComposerData.ts` with `packages/session-core` helpers backed by `capabilities.get`.
- Wire `useSettings.ts` and Settings UI components to `config.get` / `config.patch` with clear `Synced with config.toml` vs VS Code local preference grouping and honest error banners.
- Update `vscode/webview/src/lib/harness-adapter.ts` to filter `engine_internal` history messages via `filterVisibleHistory`.

- [ ] **Step 4: Dedicated UI/UX Design Review Gate & Full VS Code Verification**

- Run dedicated UI/UX Designer review across VS Code Composer & Settings states (adaptive effort selector, grouped slash command menu, synced config badge, error banners, `v1.15` daemon fallback).
- Run full VS Code gate:

```bash
cd vscode && npm run typecheck && npm run lint:design && npm test && npm run test:host && npm run build
```
Expected: exit 0 (0 type errors, 0 design lint violations, all webview & host tests passing, build succeeded).

- [ ] **Step 5: Live Daemon + VS Code Host Prompt E2E Verification**

Verify VS Code host (`featureRouters` + `harnessSession`) connected to the isolated live `./target/selfdev/rayu` daemon: `capabilities.get`, `config.get`, `config.patch` persisted to `config.toml`, live slash command execution, and live prompt round-trip confirming clean streamed response and reload persistence.

- [ ] **Step 6: Commit, push & open stacked PR 4 → PR 2**

```bash
git add vscode
git commit -m "feat(vscode): cut over Composer and Settings to v1.16 shared session-core contract"
git push -u origin stack/4-ux-ui-composer-settings-vscode
gh pr create --base stack/2-sdk-and-session-core --head stack/4-ux-ui-composer-settings-vscode --title "feat(vscode): engine-driven Composer & Settings UX over v1.16 contract" --body "Part 4/4 of Engine-Driven Thin-Client Contract. Includes UI/UX review, full webview/host verification, and live daemon prompt E2E."
```
