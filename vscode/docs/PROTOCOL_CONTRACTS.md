# RayuCode for VS Code — Protocol & Wire Contracts (`PROTOCOL_CONTRACTS.md`)

> **Frozen Contracts for Parallel Swarm Execution:**
> - **Layer 1 (Rust <-> Extension Host):** Harness API `v1.14` (strictly additive bump from `v1.13`) over NDJSON (`rayu-api.sock`).
> - **Layer 2 (Extension Host <-> Webview):** `vscode/shared/vscodeProtocol.ts` Zod-validated `postMessage` envelope and typed RPC methods.
>
> All Wave 1–4 workers MUST treat these field names, enum tags, and capability strings as canonical.

---

## 1. Layer 1 — Rust Harness API `v1.14` Additive Extensions

### 1.1 Version & Handshake Capabilities (`crates/rayucode-harness-api`, `crates/rayucode-harness-api-server`)

```rust
// crates/rayucode-harness-api/src/lib.rs
pub const API_VERSION_MAJOR: u32 = 1;
pub const API_VERSION_MINOR: u32 = 14; // bumped from 13 (strictly additive)
```

**`HelloOk` Negotiated Capabilities:**
Alongside existing capabilities (`session_tools`, `user_questions`, `runtime_commands`, etc.), `rayucode-harness-api-server` advertises:

| Capability String | Meaning & Graceful Degradation on v1.13 Bridges |
| :--- | :--- |
| `"permissions"` | Server enforces `SetPermissionMode` and emits interactive `PermissionRequest` with `risk_tier`. On v1.13 without this capability, `PermissionPopover` shows a quiet 1-line read-only fallback notice. |
| `"background_tasks"` | Server supports `RuntimeCommand::Background` alongside `BackgroundTool` (`Alt+B`) and `BackgroundProgress`. |
| `"swarm_control"` | Structured `RuntimeCommand::Swarm` (`status` / `list` / `board` / plan proposals / DM). |
| `"mcp_control"` | Structured `RuntimeCommand::Mcp` (`list` / `status` / `test` / `toggle` / `reload` / `login` / `logout`). |
| `"telegram_control"` | Structured `RuntimeCommand::Telegram` (`status` / `approvals` / `decide` / `uninstall` / `disconnect` / linking). |
| `"config_features"` | Structured `RuntimeCommand::Features` (`status` / `set <key> <val>` for all 11 `[features]` + opt-in tool gates). |
| `"doctor"` | Structured `RuntimeCommand::Doctor` (`providers` / `auth`). |

### 1.2 Permission Mode & Risk-Tier Extensions

```rust
// crates/rayucode-harness-api/src/requests.rs
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    Default,      // UI label: "Ask"         (vscode/shared/permissionModes.ts id: "default")
    AcceptEdits,  // UI label: "Auto-edit"   (id: "acceptEdits")
    Plan,         // UI label: "Plan"        (id: "plan")
    FullManage,   // UI label: "Full Manage" (id: "fullManage")
    Orchestrator, // UI label: "Orchestrator"(id: "orchestrator")
}

// Added to ApiRequest (snake_case serde tag matching existing variants):
SetPermissionMode {
    session_id: String,
    mode: PermissionMode,
}

// Added to ApiEvent (crates/rayucode-harness-api/src/events.rs):
PermissionModeChanged {
    session_id: String,
    mode: PermissionMode,
}

// Enriched on ApiEvent::PermissionRequest:
#[serde(default, skip_serializing_if = "Option::is_none")]
pub risk_tier: Option<String>, // "safe" | "bounded" | "confirm"
```

**Canonical Mode ID Mapping (Host <-> Rust Wire):**

| UI Label (`Shift+Tab` order) | `vscode/shared/permissionModes.ts` ID | Rust `PermissionMode` JSON (`snake_case`) | Engine Enforcement (`tool/mod.rs`) |
| :--- | :--- | :--- | :--- |
| `Ask` | `default` | `"default"` | Prompts before mutating tools or risky commands |
| `Auto-edit` | `acceptEdits` | `"accept_edits"` | Auto-approves file edits; gates risky bash commands |
| `Plan` | `plan` | `"plan"` | Read-only investigation; blocks mutating tools |
| `Full Manage` | `fullManage` | `"full_manage"` | Runs all non-interactive tools without asking |
| `Orchestrator` | `orchestrator` | `"orchestrator"` | Limits main agent to read & coordination tools; delegates mutations to workers |

### 1.3 New `RuntimeCommand` Variants (`crates/rayucode-harness-api/src/runtime_commands.rs`)

All variants serialize as `snake_case` and return `RuntimeCommandOutput { session_id, command, data: serde_json::Value, message: String }`. Clients MUST ignore unknown fields inside `data`.

| Variant | Wire String | Subcommands / Arguments | Structured `data` Contract |
| :--- | :--- | :--- | :--- |
| `Background` | `"background"` | `list`, `status <id>`, `output <id> [max_bytes]`, `cancel <id>`, `cleanup` | `{ tasks: [...], task?: {...}, output?: { text, truncated, output_file, bytes }, cancelled?: bool, cleaned?: number }` |
| `Mcp` | `"mcp"` | `list`, `status`, `test <id>`, `toggle <id> <on\|off>`, `reload`, `login <id>`, `logout <id>` | `{ servers: [{ id, layer, transport, shared, status, tool_count, cached, auth_required, tools? }], test_result? }` |
| `Telegram` | `"telegram"` | `status`, `approvals`, `decide <id> <allow\|deny>`, `uninstall <status\|enable\|disable>`, `disconnect`, `link_hosted`, `link_botfather <token> [chat_id]` | `{ connected, mode, bot_handle, chat_id, pairing_url?, pairing_code?, ttl_secs?, uninstall_enabled, approvals: [...] }` |
| `Features` | `"features"` | `status`, `set <key> <val>` | `{ features: { memory, swarm, mermaid, auto_poke, todo_gate_digest, todo_gate_diagnostics, message_timestamps, persist_memory_injections, kv_cache_miss_notices, check_updates, update_channel }, tools: { codemode, integration_tools } }` |
| `Doctor` | `"doctor"` | `providers`, `auth` | `{ scope, checks: [{ id, label, status: "pass"\|"warn"\|"fail", detail, remediation? }] }` |
| `SessionSearch` | `"session_search"` | `<query> [scope]` | `{ query, matches: [{ source: "rayu"\|"claude"\|"codex"\|"cursor"\|"pi"\|"opencode", session_id, title, snippet, updated_at, working_dir? }] }` |
| `Schedules` | `"schedules"` | `list`, `create <spec>`, `cancel <id>` | `{ schedules: [{ id, title, cron_summary, next_run, permission_mode, enabled, repo?, description? }] }` |
| `Ambient` | `"ambient"` | `status`, `approvals`, `decide <id> <allow\|deny>` | `{ enabled, next_wakeup?, active_cycle?, recent_cycles: [...], pending_approvals: [{ id, action, urgency, why_permission_needed, created_at }] }` |

**Enriched Existing Commands:**
- `Context`: `runtime_context_snapshot()` includes category token estimates (`system`, `tools`, `memory`, `files`, `messages`, `buffer`, `free`) while preserving all existing fields.
- `Swarm`: Enriched with structured `status`, `list`, and `board` payloads.
- `Overnight`: Enriched with structured `list`, `log`, and `review` payloads.

### 1.4 TypeScript SDK & UI State Parity (Wave 1B)
- `sdk/typescript/src/protocol.ts` and `sdk/typescript/src/browser.ts` mirror `API_VERSION_MINOR = 14`, `PermissionMode`, `set_permission_mode`, `permission_mode_changed`, `PermissionRequest.risk_tier`, and all 8 new `RuntimeCommand` literals.
- `sdk/typescript/test/schema-parity.test.ts` (run via `npm run check:ts`) verifies 1:1 parity with Rust schema snapshots and guarantees `browser.ts` imports zero Node built-ins.
- `packages/ui/src/state/sessionReducer.ts` tracks `permissionMode`, `riskTier` on pending approvals, and incremental `BackgroundProgress` updates without dropping unknown frames.

---

## 2. Layer 2 — Frozen Host <-> Webview RPC Contract (`vscode/shared/vscodeProtocol.ts`)

### 2.1 Core Shared Types

```ts
export type AppRoute =
  | "home"
  | "workspace"
  | "swarm"
  | "automations"
  | "plugins"
  | "changes"
  | "remote"
  | "settings";

export type SurfaceKind = "sidebar" | "editorPanel";
export type ThemePreference = "auto" | "dark" | "light" | "vscode";
export type AccentPreference = "green" | "blue";

export interface DaemonStatusView {
  state: "connected" | "starting" | "reconnecting" | "disconnected" | "error";
  version?: string;
  protocolMinor?: number;
  latencyMs?: number;
  socketPath?: string;
  message?: string;
}

export interface WorkspaceFolderView {
  name: string;
  path: string;
  branch?: string;
}

export interface EditorSelectionView {
  relativePath: string;
  absolutePath: string;
  languageId: string;
  startLine: number;
  endLine: number;
  selectedText?: string;
}

export interface BackgroundProcessView {
  taskId: string;
  sessionId: string;
  group: "shells" | "agents" | "runtime";
  toolName: string;
  displayName: string;
  status: "running" | "stalled" | "completed" | "failed" | "superseded";
  progressKind: "determinate" | "indeterminate";
  percent?: number;
  current?: number;
  total?: number;
  unit?: string;
  summary: string;
  etaSeconds?: number;
  exitCode?: number;
  outputFile?: string;
  startedAtMs: number;
  updatedAtMs: number;
  durationSecs?: number;
  stallQuietSecs?: number;
  unread?: boolean;
}
```

### 2.2 Message Envelopes

```ts
export type WebviewToHostMessage =
  | { type: "rayucode.webview.ready"; surface: SurfaceKind }
  | { type: "rayucode.rpc.call"; id: number; method: RpcMethod; params: unknown }
  | { type: "rayucode.harness.request"; frame: Record<string, unknown> }
  | { type: "rayucode.ui.openEditorPanel"; route?: AppRoute; sessionId?: string }
  | { type: "rayucode.ui.setAppearance"; theme?: ThemePreference; accent?: AccentPreference }
  | { type: "rayucode.editor.openFile"; path: string; line?: number; column?: number }
  | { type: "rayucode.editor.openDiff"; path: string; sessionId?: string }
  | { type: "rayucode.editor.insertCode"; code: string; mode: "cursor" | "diff" }
  | { type: "rayucode.editor.openTerminal"; cwd?: string }
  | { type: "rayucode.editor.openWorktreeWindow"; path: string }
  | { type: "rayucode.editor.openMarkdownPreview"; path: string }
  | { type: "rayucode.editor.openExternal"; url: string }
  | { type: "rayucode.editor.copy"; text: string };

export type HostToWebviewMessage =
  | {
      type: "rayucode.host.init";
      surface: SurfaceKind;
      mediaBaseUri: string;
      theme: ThemePreference;
      accent: AccentPreference;
      route: AppRoute;
      capabilities: string[];
      daemonStatus: DaemonStatusView;
      workspaces: WorkspaceFolderView[];
    }
  | { type: "rayucode.rpc.result"; id: number; ok: true; data: unknown }
  | { type: "rayucode.rpc.result"; id: number; ok: false; code: string; error: string }
  | { type: "rayucode.harness.frame"; frame: Record<string, unknown> }
  | { type: "rayucode.editor.selectionChanged"; selection: EditorSelectionView | null }
  | { type: "rayucode.processes.snapshot"; tasks: BackgroundProcessView[] }
  | { type: "rayucode.ui.navigate"; route: AppRoute; sessionId?: string }
  | { type: "rayucode.ui.appearanceSync"; theme: ThemePreference; accent: AccentPreference };
```

### 2.3 Typed `RpcMethod` Namespaces

Every `rayucode.rpc.call` uses a stable dot-namespaced method validated via Zod in both `vscode/shared/vscodeProtocol.ts` and `vscode/host/runtime/rpcRouter.ts`:

| Namespace | Methods |
| :--- | :--- |
| **`runtime.*`** | `runtime.ping`, `runtime.status`, `runtime.reconnect`, `runtime.reloadDaemon`, `runtime.info`, `runtime.refreshModels`, `runtime.openOutputLog` |
| **`session.*`** | `session.list`, `session.create`, `session.attach`, `session.send`, `session.cancel`, `session.softInterrupt`, `session.cancelSoftInterrupts`, `session.setModel`, `session.setReasoningEffort`, `session.setPermissionMode`, `session.respondPermission`, `session.respondQuestion`, `session.appletAction`, `session.closeApplet`, `session.backgroundTool`, `session.fork`, `session.transfer`, `session.rename`, `session.setSaved`, `session.archive`, `session.rewind`, `session.rewindUndo`, `session.compact`, `session.setContextCap`, `session.search`, `session.getTodos`, `session.getContext`, `session.command` |
| **`workspace.*`** | `workspace.findFiles`, `workspace.readFile`, `workspace.projectIcons.get`, `workspace.projectIcons.set`, `workspace.openKeybindings` |
| **`processes.*`** | `processes.list`, `processes.status`, `processes.output`, `processes.cancel`, `processes.cleanup` |
| **`swarm.*`** | `swarm.list`, `swarm.status`, `swarm.setLabel`, `swarm.spawn`, `swarm.dm`, `swarm.pause`, `swarm.stop`, `swarm.salvage`, `swarm.board`, `swarm.planDecision`, `swarm.peekWorker` |
| **`automations.*`** | `automations.overnight.list`, `automations.overnight.start`, `automations.overnight.log`, `automations.overnight.review`, `automations.overnight.control`, `automations.schedules.list`, `automations.schedules.create`, `automations.schedules.cancel`, `automations.schedules.toggle`, `automations.schedules.runNow`, `automations.ambient.status`, `automations.ambient.decide`, `automations.quality.status`, `automations.quality.toggle`, `automations.quality.run`, `automations.productivity.report` |
| **`plugins.*`** | `plugins.mcp.list`, `plugins.mcp.test`, `plugins.mcp.toggle`, `plugins.mcp.save`, `plugins.mcp.remove`, `plugins.mcp.reload`, `plugins.mcp.oauthLogin`, `plugins.mcp.oauthLogout`, `plugins.skills.list`, `plugins.skills.create`, `plugins.skills.install`, `plugins.memory.status`, `plugins.memory.search`, `plugins.memory.toggle`, `plugins.memory.extract`, `plugins.memory.remember`, `plugins.memory.forget`, `plugins.memory.related`, `plugins.workspace.status` |
| **`changes.*`** | `changes.status`, `changes.diff`, `changes.stage`, `changes.unstage`, `changes.keep`, `changes.undo`, `changes.commit`, `changes.createPr` |
| **`remote.*`** | `remote.telegram.status`, `remote.telegram.linkHosted`, `remote.telegram.linkBotFather`, `remote.telegram.disconnect`, `remote.telegram.ping`, `remote.telegram.approvals`, `remote.telegram.decide`, `remote.telegram.setUninstall`, `remote.gateway.status`, `remote.gateway.pair`, `remote.gateway.revoke`, `remote.cloud.list`, `remote.cloud.handoff` |
| **`settings.*`** | `settings.account.status`, `settings.account.usage`, `settings.account.signIn`, `settings.account.signOut`, `settings.providers.list`, `settings.providers.setApiKey`, `settings.providers.clearApiKey`, `settings.providers.logout`, `settings.agents.status`, `settings.agents.setOverride`, `settings.features.status`, `settings.features.set`, `settings.hooks.list`, `settings.doctor.run`, `settings.telemetry.status`, `settings.telemetry.set`, `settings.transport.set`, `settings.fast.set`, `settings.cache.set`, `settings.feedback.send` |

### 2.4 Error Codes & Backpressure Invariants

- **Standard RPC Error Codes:** `BRIDGE_OFFLINE`, `CAPABILITY_UNSUPPORTED`, `VALIDATION_ERROR`, `SESSION_NOT_FOUND`, `PERMISSION_DENIED`, `STALE_EDIT_CONFLICT`, `TIMEOUT`, `INTERNAL_ERROR`.
- **Streaming Coalescing:** High-frequency `rayucode.harness.frame` chunks (token deltas, tool progress, `BackgroundProgress`) are batched in the webview via `createStreamBatcher(16ms)` before mutating Zustand state.
- **On-Demand Process Output:** `processes.output` is strictly bounded (default `128 KB`) and only polled when the `BackgroundProcessDrawer` is open with `Follow: On` for a running task. Full multi-megabyte logs open natively in VS Code via `rayucode.editor.openFile`.
