# Design Spec: Rust Core Engine Tool Bridge, Live Office/Browser Studios & Real Local Permissions

**Date:** 2026-11-23
**Branch:** `feat/desktop-ui`
**Status:** Draft for User Review
**Locked Decisions:**
- **D1 = A:** Register Desktop tools (`read_excel`, `write_excel`, `create_powerpoint`, `browser_*`, `list_templates`, `save_template`) on every Rust core engine session via `RayucodeClient.configureTools()`, sharing one `desktop/electron/desktop-tools.ts` executor if offline Cloud fallback runs.
- **D2 = A:** Implement real 5-mode Local Permissions (`default` / Ask, `acceptEdits` / Auto-edit, `plan` / Plan, `fullManage` / Full Manage, `orchestrator` / Orchestrator) directly inside the Rust core engine (`rayucode-protocol`, `rayucode-harness-api`, `rayucode-harness-api-server`, `rayucode-app-core`) and wire Desktop's `PermissionPopover` (`⇧Tab` / click) + live permission approval banner to it.
- **UI Constraint:** Preserve the existing clean visual design of the tool call trace (`Read files`, `Loaded a tool`, preview thumbnail cards, Slide Studio, Excel Pane, Local Permissions popover) while eliminating all hardcoded demo scripts and fake fallback data.

---

## 1. Problem Statement & Goals

RayuCode Desktop already contains real Microsoft Office (`exceljs` + `pptxgenjs` in `desktop/electron/office-bridge.ts`), native Electron CDP browser control (`desktop/electron/browser-cdp.ts`), and persisted custom templates (`desktop/electron/storage-bridge.ts`). However, five integration gaps make these features behave like hardcoded demos:

1. **Rust core engine has no Desktop tools:** `desktop/electron/daemon-client.ts` calls `client.createSession()` and `client.attachSession()` without `configureTools()`, so live Rust daemon sessions cannot invoke `read_excel`, `write_excel`, `create_powerpoint`, `browser_*`, or template tools.
2. **Hardcoded `/presentations` hijack:** `desktop/src/features/execution-trace/components/chat-stream.tsx:651-658` intercepts `/presentations` before it reaches the engine and replays `runPresentationAgentFlow()` with the static `Enterprise Quarterly Business Review` deck (`app-store.ts:166-235`).
3. **No tool-to-UI hydration:** Even when `create_powerpoint` or `write_excel` runs in the Cloud loop, `harness-adapter.ts` renders only a generic command string. `SlidePane` stays on static QBR slides, `ExcelPane` stays on static `Q4-Token-Cost-Model.xlsx`, and `SlidePane`'s `"Request edits"` appends bullets locally instead of invoking the agent.
4. **Browser CDP fails when closed + Electron `tsc` fails:** `browser-cdp.ts` errors immediately if the right-side `<webview>` is not already mounted, and `office-bridge.ts:357` fails `tsc -p tsconfig.electron.json` with `TS2351`.
5. **Local Permissions are UI-only:** Switching `Ask`, `Auto-edit`, `Plan`, `Full Manage`, or `Orchestrator` only writes to `localStorage` (`use-sessions.ts:163-172`). The Rust harness bridge (`translate.rs:1394-1410`) currently rejects `permission_response` and lacks `set_permission_mode`.

### Out of Scope for This Spec (Deferred to Follow-up Sub-Projects)
- **Sub-Project 2:** Autonomous `/goal` loop runner and `Record a skill` live recorder (`SKILL.md` generation).
- **Sub-Project 3:** Wiring Rust `SidePanelState` (Pages), `AppletState` (Visualize), and `/sites` dev-server preview.
- **Sub-Project 4:** macOS Accessibility `/computer` automation and animated `Pets` widget.

---

## 2. Target Architecture & Data Flow

```text
Desktop Renderer (React + Zustand)
  │
  ├─ Composer / ChatStream (NO hardcoded runPresentationAgentFlow)
  ├─ PermissionPopover (Ask | Auto-edit | Plan | Full Manage | Orchestrator)
  │    └─► ipcClient.harness.setPermissionMode(sessionId, mode)
  ├─ PermissionApprovalCard (Allow | Always Allow | Deny)
  │    └─► ipcClient.trace.respondToPermission(sessionId, requestId, decision)
  ├─ SlidePane & ExcelPane (clean empty states; live hydration on artifact event)
  └─ BrowserPane (<webview> auto-mounted on rayu:browser:ensure-open)
  │
  ▼ Electron IPC (preload.cjs + main.ts + ipc-schemas.ts)
  │
Electron Main Process
  ├─ desktop-tools.ts (SINGLE source of truth for Desktop SdkTools)
  │    ├─ read_excel / write_excel      -> office-bridge.ts (ExcelJS)
  │    ├─ create_powerpoint             -> office-bridge.ts (PptxGenJS)
  │    ├─ browser_navigate/snapshot/click/type -> browser-cdp.ts (auto-opens webview)
  │    └─ list_templates / save_template -> storage-bridge.ts
  │    └─ Emits structured `rayu:desktop:artifact` event to Renderer on create/write
  │
  ├─ daemon-client.ts (PRIMARY: Rust Core Engine over Unix socket)
  │    ├─ createSession() & ensureAttached() -> client.configureTools(sessionId, desktopTools)
  │    ├─ Syncs active permissionMode via set_permission_mode on attach/change
  │    └─ Forwards ApiEvent::ToolCall -> desktop-tools.ts -> ApiRequest::ToolResult
  │    └─ Forwards ApiEvent::PermissionRequest -> Renderer approval card
  │
  └─ auth-bridge.ts (FALLBACK ONLY when Rust daemon binary unavailable)
       └─ Reuses desktop-tools.ts (zero duplicate Office/Browser code)
  │
  ▼ Unix Socket (rayu-api.sock)
  │
Rust Core Engine
  ├─ rayucode-protocol         (PermissionMode enum, Request::SetPermissionMode,
  │                             Request::PermissionResponse, ServerEvent::PermissionRequest)
  ├─ rayucode-harness-api      (ApiRequest::SetPermissionMode, ApiEvent::PermissionRequest,
  │                             capabilities: ["permissions", "permission_modes"])
  ├─ rayucode-harness-api-server (translate.rs forwards set_permission_mode,
  │                             permission_request, permission_response)
  └─ rayucode-app-core         (server/client_lifecycle.rs + agent/turn_execution.rs:
                                non-blocking permission gate + mode-based tool filtering)
```

---

## 3. Component Design

### 3.1 Rust Core Engine: Permission Modes & Interactive Approval Gate

#### Protocol & Harness Types
- **`crates/rayucode-protocol/src/wire.rs` & `crates/rayucode-harness-api/src/requests.rs`:**
  - Define canonical `PermissionMode` enum serialized as snake_case/camelCase-compatible strings:
    - `default` (Ask)
    - `accept_edits` (alias `acceptEdits` — Auto-edit)
    - `plan` (Plan)
    - `full_manage` (alias `fullManage` — Full Manage)
    - `orchestrator` (Orchestrator)
  - Add `Request::SetPermissionMode { id: u64, mode: PermissionMode }` and `Request::PermissionResponse { id: u64, session_id: String, request_id: String, decision: PermissionDecision }` to `rayucode-protocol`.
  - Add `ApiRequest::SetPermissionMode { session_id: String, mode: PermissionMode }` to `rayucode-harness-api`.
  - Add `ServerEvent::PermissionRequest { session_id: String, request_id: String, tool_name: String, description: String, input: serde_json::Value }` and map it to `ApiEvent::PermissionRequest` in `crates/rayucode-harness-api-server/src/translate.rs`.
  - Advertise `"permissions"` and `"permission_modes"` in `HelloOk.capabilities`.

#### Enforcement in `rayucode-app-core`
- Store `permission_mode: PermissionMode` and `session_allowed_tools: HashSet<String>` per session (defaulting to `PermissionMode::Default` / Ask, or `FullManage` for headless CLI non-interactive callers that do not opt into `supports_permissions` in `Hello`).
  - **Backward compatibility guard:** Clients that do NOT declare `supports_permissions: true` (existing CLI/SDK tests) retain non-blocking behavior so zero existing Rust integration tests break. Desktop sets `supports_permissions: true` in `Hello`.
- Add a non-blocking `PermissionConnection` modeled directly after `crate::tool::ask_user_question::QuestionConnection` (`crates/rayucode-app-core/src/server/client_lifecycle.rs:1012-1025`):
  - `Request::PermissionResponse` is handled in the fast path **before** acquiring the `Agent` mutex so the suspended tool call resumes immediately without deadlock.
  - `Request::SetPermissionMode` updates the session's active `PermissionMode` and invalidates tool definitions (`locked.invalidate_sdk_tools()`).
- Enforce tool policy in `crates/rayucode-app-core/src/agent/turn_execution.rs` before EVERY tool execution (built-in, MCP, and custom `SdkTool`):
  1. **Tool classification:**
     - **Read-only (`ReadOnly`):** `read`, `read_file`, `glob`, `grep`, `search_files`, `ls`, `list_files`, `read_excel`, `browser_snapshot`, `list_templates`, `memory`, `todo*`, `codesearch`, `session_search`, `conversation_search`.
     - **File / Document Edit (`Edit`):** `edit`, `write`, `patch`, `apply_patch`, `write_excel`, `create_powerpoint`, `save_template`.
     - **Delegation / Coordination (`Coordinate`):** `subagent`, `swarm`, `task`, `plan*`, `ask_user_question`.
     - **Command / External (`Command`):** `bash`, `shell`, `run_command`, `browser_navigate`, `browser_click`, `browser_type`, and any unclassified MCP/external tool.
  2. **Mode enforcement matrix:**
     - **`plan`:** Remove `Edit` and `Command` tools from effective tool definitions AND reject any attempt to execute them with an explicit policy error (`"Blocked by Plan mode (read-only)"`).
     - **`orchestrator`:** Remove direct `Edit` and `Command` tools from the main agent's effective tool definitions while preserving `ReadOnly` + `Coordinate` tools (subagents/workers spawned by the orchestrator inherit full worker permissions).
     - **`default` (Ask):** `ReadOnly` and `Coordinate` run immediately. `Edit` and `Command` tools check `session_allowed_tools`; if not yet allowed, emit `ServerEvent::PermissionRequest` and await `PermissionResponse` (`Allow` = run once, `AllowAlways` = insert tool name into `session_allowed_tools` and run, `Deny` = return tool error `"Denied by user"`).
     - **`accept_edits` (Auto-edit):** `ReadOnly`, `Coordinate`, and `Edit` run immediately. `Command` tools require `PermissionRequest` unless in `session_allowed_tools`.
     - **`full_manage` (Full Manage):** All non-interactive tools run without prompting.
  3. **Timeout & disconnect safety:** If the owning client disconnects while a `PermissionRequest` is pending, the pending oneshot resolves to `Deny` immediately so the Rust turn never leaks or hangs.

---

### 3.2 Electron Main Process: Shared `desktop-tools.ts`, Fixed `office-bridge.ts`, and Auto-Open `browser-cdp.ts`

1. **Fix `desktop/electron/office-bridge.ts:354-358` (`TS2351`):**
   - Replace the broken `PptxGenJS.default` constructability cast with a typed ESM/CJS constructor helper so `./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit` exits `0` cleanly.
   - Return structured slide metadata (`title`, `filePath`, `slides`) from `createRealPowerPointDeck()` and structured workbook payload (`fileName`, `filePath`, `sheets`) from `writeRealExcelWorkbook()` so callers can hydrate the UI directly without re-parsing text strings.

2. **Create `desktop/electron/desktop-tools.ts` (Single Tool Registry):**
   - Exports `buildDesktopSdkTools(deps)` returning `SdkTool[]` compatible with `@rayu-dev/rayucode-sdk`'s `SessionToolsOptions.custom`:
     - `read_excel` (`office-bridge.ts`)
     - `write_excel` (`office-bridge.ts` -> emits `artifact:excel` with full `OfficeExcelWorkbookPayload`)
     - `create_powerpoint` (`office-bridge.ts` -> emits `artifact:slide` with `{ title, filePath, slides }`)
     - `list_templates`, `save_template` (`storage-bridge.ts` -> lets the AI discover and reuse user-created templates from Template Creator)
     - `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type` (`browser-cdp.ts`)
   - Exports `executeDesktopTool(...)` so `auth-bridge.ts` (Cloud fallback) calls the exact same executor and emits the exact same `rayu:desktop:artifact` events — zero duplicated Office/Browser code.

3. **Auto-mount Browser `<webview>` in `desktop/electron/browser-cdp.ts`:**
   - Add an injected callback `ensureBrowserOpen?: () => Promise<void>` to `BrowserCdpController`.
   - When `findBrowserWebContents()` returns `null`, `browser-cdp.ts` triggers `ensureBrowserOpen()` (which sends `rayu:browser:ensure-open` to `mainWindow`, opening the right-side Browser tab) and polls `findBrowserWebContents()` every 100ms up to 2,500ms before returning an actionable error.

4. **Register Tools & Sync Permission Mode in `desktop/electron/daemon-client.ts`:**
   - Pass `supportsPermissions: true` (via handshake or updated SDK client) and attach `desktop-tools.ts` handlers.
   - Call `client.configureTools(sessionId, { custom: desktopTools })` inside **both** `createSession()` and `ensureAttached()`/`attachSession()` so tools survive session switches and daemon restarts.
   - Add `setPermissionMode(sessionId: string, mode: PermissionModeId)` in `daemon-client.ts`, exposed via IPC `rayu:harness:set-permission-mode` (validated by Zod in `ipc-schemas.ts`) and `preload.cjs`.
   - When `createSession` / `attachSession` completes, immediately sync the user's current `permissionMode` to the Rust daemon.

---

### 3.3 Renderer UI: Keep the Visual Trace Design, Eliminate Hardcoded Demos

1. **Remove Hardcoded Presentation Demo (`desktop/src/features/execution-trace/components/chat-stream.tsx`):**
   - Delete `runPresentationAgentFlow` (`lines 374-610`), `pendingSlideContinuationRef`, and the `/presentations` intercept (`lines 651-658`).
   - All `/presentations`, `/spreadsheets`, and `/browser` prompts flow straight through `ipcClient.trace.sendPrompt()` to the Rust core engine (or Cloud fallback if daemon offline).
   - Keep the rich trace visual presentation in `harness-adapter.ts`:
     - When `tool_done` completes for `create_powerpoint`, emit a real clickable Slide preview thumbnail step (preserving the exact visual card design shown in the user's screenshot, populated with the **actual generated deck title, slide count, and first slide preview**).
     - When `tool_done` completes for `write_excel` / `read_excel`, emit a real clickable Excel artifact card pointing to the actual `.xlsx` file.
     - When `tool_done` completes for `browser_*`, group under `"Used the browser"` with the real URL/action output.

2. **Live Preview Hydration (`desktop/src/lib/app-store.ts`, `slide-pane.tsx`, `excel-pane.tsx`):**
   - Subscribe to `rayu:desktop:artifact` in `AppShell` (or `useDesktopArtifactSync` hook):
     - `kind === "slide"` -> updates `slideDeck` in `useAppStore` with the real generated slides + `filePath`, opens the `slide` right tab with the deck's real title.
     - `kind === "excel"` -> updates live workbook state (and TanStack Query `previewsKeys.state()`), opens the `excel` right tab with the real filename.
     - `rayu:browser:ensure-open` -> opens the `browser` right tab so `<webview>` mounts immediately for CDP.
   - **Remove fake defaults in production runtime:**
     - `SlidePane`: default `slideDeck` in non-test mode is `null` (shows a clean empty state: *"No presentation open yet — ask RayuCode to create slides or open a .pptx"* instead of `"Enterprise Quarterly Business Review"`).
     - `SlidePane` `"Request edits"`: stop string-appending `• ${trimmed}` locally; send a real follow-up prompt referencing the active `.pptx` path, slide number, and requested change to the active session so the Rust core engine edits and re-runs `create_powerpoint`, re-hydrating the slide live.
     - `ExcelPane`: remove the hardcoded `https://rayucode.com/demo/Q4-Token-Cost-Model.xlsx` default URL; show clean empty state until a workbook is opened via `Open .xlsx` or created by `write_excel`.
   - **Real Permission Popover & Approval Card:**
     - `PermissionPopover` (`composer.tsx` + `use-sessions.ts`): selecting a mode or pressing `⇧Tab` persists to `localStorage` AND immediately calls `ipcClient.harness.setPermissionMode(activeSessionId, nextMode)` when a session is active (reverts with an error toast if the Rust daemon rejects the mode).
     - `harness-adapter.ts`: handle `ev === "permission_request"` from the Rust daemon by setting `useAppStore.getState().setPendingPermission(...)`, so the existing approval UI in `chat-stream.tsx` renders live for real Rust tool calls and sends `respondToPermission` back to unblock the engine.

---

## 4. Error Handling & Edge Cases

- **Daemon busy during `configureTools` / `setPermissionMode`:** If a turn is mid-flight, `client_lifecycle.rs` returns `"Session is busy"`; Desktop queues the mode change until `turn_done`/`turn_stopped` and retries automatically, informing the user via subtle toast.
- **Daemon restart / session switch:** `daemon-client.ts` re-runs `configureTools` and `setPermissionMode` on every `createSession` and `attachSession`, so custom tools and permission modes are never silently lost.
- **Invalid AI tool arguments:** AJV schema validation in `@rayu-dev/rayucode-sdk` rejects malformed `write_excel` / `create_powerpoint` inputs and returns a structured validation error to the model so it can self-correct without crashing Electron.
- **Webview mount race:** `browser-cdp.ts` waits up to 2.5s for `<webview>` creation after signaling `rayu:browser:ensure-open`; if the window is hidden or `<webview>` fails to attach, returns a clear non-crashing tool error.
- **Client disconnect during pending `PermissionRequest`:** Rust `PermissionConnection` drops/denies all pending oneshot channels on connection close so turns terminate cleanly.
- **Template Creator integration:** Custom templates saved via `TemplateCreatorDialog` (`storage-bridge.ts`) are passed into the prompt context AND discoverable via `list_templates`, so generated `.pptx` / `.xlsx` files follow the user's real template sections and styling.

---

## 5. Testing & Verification Plan

### Rust Core Tests (`cargo test`)
1. `rayucode-protocol` & `rayucode-harness-api`: round-trip serde & schema snapshot tests for `PermissionMode`, `ApiRequest::SetPermissionMode`, `ApiEvent::PermissionRequest`, and `HelloOk` capabilities.
2. `rayucode-harness-api-server`: translate tests proving `set_permission_mode`, `permission_request`, and `permission_response` bridge cleanly between client frames and daemon events.
3. `rayucode-app-core`: unit/integration tests covering all 5 modes (`default`, `accept_edits`, `plan`, `full_manage`, `orchestrator`), verifying:
   - `plan` blocks `edit`/`write`/`bash`
   - `orchestrator` blocks direct `edit`/`write`/`bash` while allowing delegation
   - `default` suspends on `edit` and resumes on `Allow` / remembers on `AllowAlways` / errors on `Deny`
   - `accept_edits` auto-runs `edit` but suspends on `bash`
   - `full_manage` auto-runs both without prompting
   - disconnect while awaiting permission unblocks with `Deny`.

### Electron & Desktop Tests (`vitest`, `tsc`, `eslint`, `lint-design`, `vite build`)
1. `desktop/electron/__tests__/office-bridge.test.ts`: verify `.xlsx` & `.pptx` roundtrip + structured payload return + `tsc -p tsconfig.electron.json --noEmit` exits `0`.
2. `desktop/electron/__tests__/desktop-tools.test.ts`: verify `buildDesktopSdkTools()` executes `create_powerpoint` / `write_excel`, emits structured `rayu:desktop:artifact`, and `browser_navigate` triggers `ensureBrowserOpen` when no `<webview>` is mounted.
3. `desktop/electron/__tests__/daemon-client.test.ts`: verify `configureTools()` and `setPermissionMode()` are called on both `createSession` and `attachSession`.
4. `desktop/src/features/execution-trace/__tests__/`: verify `/presentations` is NOT intercepted by hardcoded demo logic, real `create_powerpoint` `tool_done` renders the visual slide preview card and hydrates `SlidePane`, and `ev === "permission_request"` opens the live permission prompt and forwards `respondToPermission`.
5. `desktop/src/features/sessions/__tests__/model-effort-popover.test.tsx`: verify selecting a Local Permission mode calls `ipcClient.harness.setPermissionMode`.
6. Full gate: `cargo test` (affected Rust crates) + `cargo build --bin rayu` + `tsc --noEmit` + `tsc -p tsconfig.electron.json --noEmit` + `eslint src electron` + `node scripts/lint-design.mjs` + `vitest run` + `vite build`.
