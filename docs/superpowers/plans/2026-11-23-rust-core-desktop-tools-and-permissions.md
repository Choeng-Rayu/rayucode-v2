# Rust Core Engine Tool Bridge, Live Office/Browser Studios & Real Local Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect RayuCode Desktop's real Microsoft Office (`.xlsx`/`.pptx`), Template Creator, Browser CDP, and 5-mode Local Permissions directly to the Rust core engine, eliminate all hardcoded presentation/spreadsheet demo flows, and hydrate the live Slide Studio and Excel Pane from real tool outputs while preserving the existing visual design.

**Architecture:** Extract Desktop's Office, Browser CDP, and Template handlers into one `desktop/electron/desktop-tools.ts` registry registered onto every Rust daemon session via `RayucodeClient.configureTools()` (and reused by the offline Cloud fallback). Add `PermissionMode`, `SetPermissionMode`, and a non-blocking `PermissionRequest` / `PermissionResponse` gate directly into the Rust core engine (`rayucode-protocol`, `rayucode-harness-api`, `rayucode-harness-api-server`, `rayucode-app-core`), and wire structured `rayu:desktop:artifact` and `rayu:browser:ensure-open` push events to hydrate Desktop's right-side preview panels live.

**Tech Stack:** Rust (`tokio`, `serde`, `anyhow`), TypeScript 6, Electron 45, `@rayu-dev/rayucode-sdk`, React 19, Zustand, TanStack Query, Zod, `exceljs`, `pptxgenjs`, Vitest, Cargo test.

## Global Constraints

- **Design Tokens (`desktop/scripts/lint-design.mjs`):** Zero raw hex colors (`#RGB`/`#RRGGBB`), zero Tailwind default grays (`zinc`, `slate`, `neutral`, `stone`, `gray`), and zero Unicode emoji characters (even in comments) anywhere in `desktop/src/**/*.{ts,tsx}`.
- **ESLint Architecture:** No deep cross-feature imports (`@/features/<name>/components/...`); import only from `@/features/<name>` barrel. Respect React 19 strict hooks rules.
- **Visual Preservation:** Keep the existing visual design of tool-call trace cards (`Read files`, `Loaded a tool`, preview thumbnail cards, Slide Studio, Excel Pane, Local Permissions popover) unchanged; replace only fake/hardcoded data and execution paths.
- **Backward Compatibility:** Rust core enforces interactive `PermissionRequest` prompts only when the client opts in via `supports_permissions: true` in `Hello` (so existing CLI/headless SDK callers and tests remain non-blocking).
- **Local Verification Commands:** In sandboxed environments where `pnpm` cannot read global config, invoke `./node_modules/.bin/tsc`, `./node_modules/.bin/eslint`, `node scripts/lint-design.mjs`, `./node_modules/.bin/vitest run`, and `./node_modules/.bin/vite build` directly inside `desktop/`.

---

## File Structure Map

| File | Responsibility |
|---|---|
| `desktop/electron/office-bridge.ts` | Fix `PptxGenJS` constructor typing (`TS2351`); return structured `slides` from `createRealPowerPointDeck` and full `workbook` payload from `writeRealExcelWorkbook`. |
| `desktop/electron/browser-cdp.ts` | Accept `ensureBrowserOpen` callback; auto-mount right-side `<webview>` and poll up to 2.5s before CDP commands fail. |
| `desktop/electron/desktop-tools.ts` *(new)* | Single source of truth defining Desktop `SdkTool[]` (`read_excel`, `write_excel`, `create_powerpoint`, `list_templates`, `save_template`, `browser_*`) and emitting structured `DesktopArtifactEvent` payloads. |
| `crates/rayucode-protocol/src/wire.rs` & `lib.rs` | Add `PermissionMode`, `PermissionDecision`, `Request::SetPermissionMode`, `Request::PermissionResponse`, and `ServerEvent::PermissionRequest`. |
| `crates/rayucode-harness-api/src/requests.rs` & `events.rs` | Add `supports_permissions` to `Hello`, `ApiRequest::SetPermissionMode`, and `ApiEvent::PermissionRequest`. |
| `crates/rayucode-harness-api-server/src/translate.rs` | Advertise `"permissions"` + `"permission_modes"` capabilities; translate `set_permission_mode`, `permission_request`, and `permission_response`. |
| `crates/rayucode-app-core/src/tool/permission_gate.rs` *(new)* | Non-blocking per-connection `PermissionConnection` + `tokio::task_local!` scope + 5-mode tool classifier (`ReadOnly`, `Edit`, `Coordinate`, `Command`). |
| `crates/rayucode-app-core/src/server/client_lifecycle.rs`, `agent/turn_execution.rs`, `agent/turn_streaming_mpsc.rs` | Handle `SetPermissionMode` & `PermissionResponse` in fast path; filter tools in `plan`/`orchestrator`; gate mutating tools in `default`/`accept_edits`. |
| `desktop/electron/daemon-client.ts` & `auth-bridge.ts` | Register `desktop-tools.ts` via `configureTools` on `createSession` + `attachSession`; sync `permissionMode`; reuse `desktop-tools.ts` in Cloud fallback. |
| `desktop/electron/main.ts`, `ipc-schemas.ts`, `preload.cjs`, `desktop/src/lib/ipc-client.ts` | Add `rayu:harness:set-permission-mode`, `rayu:desktop:artifact`, and `rayu:browser:ensure-open` IPC channels with Zod validation. |
| `desktop/src/features/execution-trace/components/chat-stream.tsx` & `desktop/src/lib/harness-adapter.ts` | Delete hardcoded `runPresentationAgentFlow` hijack; render real `create_powerpoint`/`write_excel` preview cards and handle live `permission_request` events. |
| `desktop/src/lib/app-store.ts`, `AppShell.tsx`, `slide-pane.tsx`, `excel-pane.tsx` | Hydrate `SlidePane` and `ExcelPane` live from `rayu:desktop:artifact`; remove hardcoded QBR/Q4 runtime defaults; make Slide `Request edits` dispatch real follow-up turns. |
| `desktop/src/features/sessions/hooks/use-sessions.ts` & `composer.tsx` | Sync `PermissionPopover` / `⇧Tab` mode changes to `ipcClient.harness.setPermissionMode()` on active sessions. |

---

### Task 1: Fix `office-bridge.ts` Electron Typecheck & Return Structured Payloads

**Files:**
- Modify: `desktop/electron/office-bridge.ts:300-370`
- Test: `desktop/electron/__tests__/office-bridge.test.ts`

**Interfaces:**
- Produces:
  - `writeRealExcelWorkbook(workspaceDir, input)` -> `Promise<{ ok: boolean; filePath: string; sheetCount: number; rowCount: number; workbook: OfficeExcelWorkbookPayload }>`
  - `createRealPowerPointDeck(workspaceDir, input)` -> `Promise<{ ok: boolean; filePath: string; slideCount: number; title: string; slides: OfficePowerPointSlideSpec[] }>`

- [ ] **Step 1: Add failing test asserting structured `workbook` and `slides` return fields**

In `desktop/electron/__tests__/office-bridge.test.ts`, extend the `.xlsx` and `.pptx` assertions to check `writeRes.workbook.sheets.length` and `pptxRes.title` / `pptxRes.slides.length`:

```ts
expect(writeRes.workbook.filePath).toBe(writeRes.filePath)
expect(writeRes.workbook.sheets).toHaveLength(1)
expect(pptxRes.title).toBe("RayuCode Test Deck")
expect(pptxRes.slides).toHaveLength(2)
```

- [ ] **Step 2: Run Electron typecheck & test to verify failure**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit
```
Expected: FAIL with `TS2351: This expression is not constructable` at `electron/office-bridge.ts:357`.

- [ ] **Step 3: Fix `PptxGenJS` constructor typing and return structured payloads**

In `desktop/electron/office-bridge.ts`:
1. At the end of `writeRealExcelWorkbook`:
```ts
  await workbook.xlsx.writeFile(finalPath)
  const hydrated = await readRealExcelWorkbook(workspaceDir, finalPath)
  return {
    ok: true,
    filePath: finalPath,
    sheetCount: input.sheets.length,
    rowCount: totalRows,
    workbook: hydrated,
  }
```
2. Replace lines 354-358 in `createRealPowerPointDeck` with a properly typed runtime constructor resolver:
```ts
  type PptxInstance = InstanceType<typeof PptxGenJS.default>
  type PptxConstructor = new () => PptxInstance
  const mod = PptxGenJS as unknown as { default?: PptxConstructor } | PptxConstructor
  const PptxCtor: PptxConstructor =
    typeof mod === "function" ? mod : (mod.default as PptxConstructor)
  const pptx = new PptxCtor()
```
3. Return `title: input.title` and `slides: input.slides` alongside `ok`, `filePath`, `slideCount`.

- [ ] **Step 4: Run Electron typecheck and office-bridge unit tests**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit && ./node_modules/.bin/vitest run electron/__tests__/office-bridge.test.ts
```
Expected: Exit code `0`, all `office-bridge.test.ts` cases PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 add desktop/electron/office-bridge.ts desktop/electron/__tests__/office-bridge.test.ts
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 commit -m "fix(electron): resolve PptxGenJS TS2351 build error and return structured Office payloads"
```

---

### Task 2: Unified `desktop-tools.ts` Registry & Auto-Open `<webview>` in `browser-cdp.ts`

**Files:**
- Create: `desktop/electron/desktop-tools.ts`
- Modify: `desktop/electron/browser-cdp.ts:38-125`
- Test: `desktop/electron/__tests__/desktop-tools.test.ts` *(new)*

**Interfaces:**
- Consumes: `readRealExcelWorkbook`, `writeRealExcelWorkbook`, `createRealPowerPointDeck` from `./office-bridge.js`; `BrowserCdpController` from `./browser-cdp.js`; `readCustomTemplates`, `saveCustomTemplate` from `./storage-bridge.js`.
- Produces:
  - `DesktopArtifactEvent` (`{ kind: "slide"; sessionId?: string; title: string; filePath: string; slides: OfficePowerPointSlideSpec[] } | { kind: "excel"; sessionId?: string; workbook: OfficeExcelWorkbookPayload }`)
  - `buildDesktopSdkTools(deps: DesktopToolDeps): SdkTool[]`
  - `executeDesktopTool(deps: DesktopToolDeps, name: string, args: Record<string, unknown>, sessionId?: string): Promise<{ output: string; error?: string } | null>`
  - `BrowserCdpController.setEnsureBrowserOpen(fn: () => Promise<void>)`

- [ ] **Step 1: Write failing unit tests in `desktop/electron/__tests__/desktop-tools.test.ts`**

```ts
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildDesktopSdkTools, type DesktopArtifactEvent } from "../desktop-tools"

describe("desktop-tools unified SdkTool registry", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("executes create_powerpoint, writes real .pptx, and emits slide artifact event", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-tools-"))
    tempDirs.push(dir)
    const artifacts: DesktopArtifactEvent[] = []
    const tools = buildDesktopSdkTools({
      getWorkspaceDir: () => dir,
      onArtifact: (ev) => artifacts.push(ev),
    })

    const pptxTool = tools.find((t) => t.name === "create_powerpoint")
    expect(pptxTool).toBeDefined()

    const result = await pptxTool!.execute(
      {
        title: "Architecture Overview",
        file_path: "arch.pptx",
        slides: [{ title: "Cover", body: "Real slides from workspace" }],
      },
      { sessionId: "sess_1", callId: "c1", signal: new AbortController().signal }
    )

    expect(typeof result === "object" && !result.error).toBe(true)
    expect(fs.existsSync(path.join(dir, "arch.pptx"))).toBe(true)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      kind: "slide",
      sessionId: "sess_1",
      title: "Architecture Overview",
    })
  })

  it("executes write_excel, writes real .xlsx, and emits excel artifact event", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-tools-"))
    tempDirs.push(dir)
    const artifacts: DesktopArtifactEvent[] = []
    const tools = buildDesktopSdkTools({
      getWorkspaceDir: () => dir,
      onArtifact: (ev) => artifacts.push(ev),
    })

    const excelTool = tools.find((t) => t.name === "write_excel")
    expect(excelTool).toBeDefined()

    const result = await excelTool!.execute(
      {
        file_path: "metrics.xlsx",
        sheets: [
          {
            name: "Summary",
            headers: ["Metric", "Value"],
            rows: [["Latency", 144]],
          },
        ],
      },
      { sessionId: "sess_2", callId: "c2", signal: new AbortController().signal }
    )

    expect(typeof result === "object" && !result.error).toBe(true)
    expect(fs.existsSync(path.join(dir, "metrics.xlsx"))).toBe(true)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.kind).toBe("excel")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/vitest run electron/__tests__/desktop-tools.test.ts
```
Expected: FAIL (`Cannot find module '../desktop-tools'`).

- [ ] **Step 3: Implement `desktop/electron/browser-cdp.ts` auto-open wait & create `desktop/electron/desktop-tools.ts`**

1. In `desktop/electron/browser-cdp.ts`, add `private ensureBrowserOpen?: () => Promise<void>`, `setEnsureBrowserOpen(cb)`, and `private async requireBrowserWebContents(timeoutMs = 2500): Promise<WebContents | null>` that checks `findBrowserWebContents()`, invokes `await this.ensureBrowserOpen?.()` if `null`, and polls every 100ms until found or `timeoutMs` expires. Use `await this.requireBrowserWebContents()` in `navigate`, `snapshot`, `click`, `type`, and `screenshot`.
2. Create `desktop/electron/desktop-tools.ts` exporting `DesktopArtifactEvent`, `DesktopToolDeps`, `DESKTOP_TOOL_DEFINITIONS`, `executeDesktopTool`, and `buildDesktopSdkTools` covering:
   - `read_excel`, `write_excel`, `create_powerpoint`
   - `list_templates`, `save_template`
   - `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`
   Each `write_excel` and `create_powerpoint` success invokes `deps.onArtifact(...)` with the structured payload.

- [ ] **Step 4: Run tests & Electron typecheck**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit && ./node_modules/.bin/vitest run electron/__tests__/desktop-tools.test.ts electron/__tests__/office-bridge.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 add desktop/electron/desktop-tools.ts desktop/electron/browser-cdp.ts desktop/electron/__tests__/desktop-tools.test.ts
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 commit -m "feat(electron): add unified desktop-tools SdkTool registry and auto-open browser CDP"
```

---

### Task 3: Rust Core Protocol & Harness API (`PermissionMode`, `SetPermissionMode`, `PermissionRequest`, `PermissionResponse`)

**Files:**
- Modify: `crates/rayucode-protocol/src/wire.rs` & `crates/rayucode-protocol/src/lib.rs`
- Modify: `crates/rayucode-harness-api/src/requests.rs` & `crates/rayucode-harness-api/src/events.rs`
- Modify: `crates/rayucode-harness-api-server/src/translate.rs`
- Test: `crates/rayucode-harness-api-server/src/translate_tests.rs` & `crates/rayucode-harness-api/src/harness_api_tests/schema_snapshot.rs`

**Interfaces:**
- Produces:
  - `PermissionMode` (`Default`, `AcceptEdits`, `Plan`, `FullManage`, `Orchestrator`) accepting both `snake_case` and Desktop's `camelCase` aliases (`acceptEdits`, `fullManage`).
  - `ApiRequest::SetPermissionMode { session_id, mode }` and `Request::SetPermissionMode { id, mode }`.
  - `Request::PermissionResponse { id, session_id, request_id, decision }`.
  - `ServerEvent::PermissionRequest { session_id, request_id, tool_name, description, input }` -> `ApiEvent::PermissionRequest`.
  - `Hello { supports_permissions: bool }` and `HelloOk { capabilities }` advertising `"permissions"` and `"permission_modes"`.

- [ ] **Step 1: Write failing protocol & translation tests**

In `crates/rayucode-harness-api-server/src/translate_tests.rs`, add tests:
1. `set_permission_mode_translates_and_acks`: verifies `ApiRequest::SetPermissionMode { session_id, mode: PermissionMode::AcceptEdits }` produces daemon `{"type": "set_permission_mode", "mode": "accept_edits", ...}` and translates `Ack` back to `ApiEvent::Ok`.
2. `permission_request_and_response_roundtrip`: verifies daemon `permission_request` event translates to `ApiEvent::PermissionRequest` and `ApiRequest::PermissionResponse` forwards `{"type": "permission_response", ...}` when `supports_permissions` was negotiated.

- [ ] **Step 2: Run Cargo tests to verify failure**

Run:
```bash
cargo test --manifest-path /Users/lyyeakkhai/workspace/rayu/rayucode-v2/Cargo.toml -p rayucode-harness-api-server permission
```
Expected: FAIL (compile error: `SetPermissionMode` / `PermissionMode` not defined).

- [ ] **Step 3: Implement protocol & harness-api types and translation**

1. Add `PermissionMode` and `PermissionDecision` in `crates/rayucode-protocol/src/wire.rs` (re-exported from `crates/rayucode-protocol/src/lib.rs`) with `#[serde(alias = "acceptEdits")]` on `AcceptEdits` and `#[serde(alias = "fullManage")]` on `FullManage`.
2. Add `Request::SetPermissionMode { id: u64, mode: PermissionMode }`, `Request::PermissionResponse { id: u64, session_id: String, request_id: String, decision: PermissionDecision }`, and `ServerEvent::PermissionRequest { session_id: String, request_id: String, tool_name: String, description: String, input: serde_json::Value }`.
3. Add `supports_permissions: bool` (`#[serde(default)]`) to `ApiRequest::Hello`, add `ApiRequest::SetPermissionMode { session_id: String, mode: PermissionMode }`, and verify `ApiEvent::PermissionRequest` exists in `crates/rayucode-harness-api/src/events.rs`.
4. Update `crates/rayucode-harness-api-server/src/translate.rs`:
   - Track `supports_permissions: bool` on `BridgeState`.
   - Include `"permissions"` and `"permission_modes"` in `HelloOk.capabilities`.
   - Translate `"set_permission_mode"` and `"permission_response"` to daemon JSON requests instead of returning `InvalidRequest` (keeping the clear error only if `supports_permissions == false`).
   - Translate daemon `"permission_request"` event to `ServerFrame::event(ApiEvent::PermissionRequest { ... })`.

- [ ] **Step 4: Run Rust protocol & harness-api tests**

Run:
```bash
cargo test --manifest-path /Users/lyyeakkhai/workspace/rayu/rayucode-v2/Cargo.toml -p rayucode-protocol -p rayucode-harness-api -p rayucode-harness-api-server
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 add crates/rayucode-protocol crates/rayucode-harness-api crates/rayucode-harness-api-server
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 commit -m "feat(harness-api): add PermissionMode, SetPermissionMode, and interactive PermissionRequest bridge"
```

---

### Task 4: Rust Core 5-Mode Permission Enforcement (`rayucode-app-core`)

**Files:**
- Create: `crates/rayucode-app-core/src/tool/permission_gate.rs`
- Modify: `crates/rayucode-app-core/src/tool/mod.rs`
- Modify: `crates/rayucode-app-core/src/server/client_lifecycle.rs:1010-1060`
- Modify: `crates/rayucode-app-core/src/server/client_processing.rs`
- Modify: `crates/rayucode-app-core/src/agent/turn_execution.rs:700-750,1148-1205`
- Modify: `crates/rayucode-app-core/src/agent/turn_streaming_mpsc.rs:1590-1658`
- Test: `crates/rayucode-app-core/src/tool/permission_gate.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `PermissionMode`, `PermissionDecision`, `ServerEvent::PermissionRequest` from `rayucode-protocol`.
- Produces:
  - `PermissionConnection` (`new`, `close`, `set_mode`, `mode`, `respond`, `authorize_tool`)
  - `permission_gate::scope(session_id, connection, future)`
  - `permission_gate::classify_tool(name) -> ToolPermissionClass` (`ReadOnly | Edit | Coordinate | Command`)
  - `permission_gate::is_tool_hidden_for_mode(mode, name) -> bool`

- [ ] **Step 1: Write failing unit tests in `crates/rayucode-app-core/src/tool/permission_gate.rs`**

Write `#[cfg(test)] mod tests` covering:
1. `plan_mode_hides_and_blocks_edit_and_command_tools`
2. `orchestrator_mode_hides_direct_edits_and_allows_coordination`
3. `ask_mode_emits_permission_request_and_remembers_allow_always`
4. `accept_edits_auto_allows_writes_but_prompts_for_bash`
5. `full_manage_auto_allows_all_non_interactive_tools`
6. `disconnect_denies_pending_permission_without_hang`

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
cargo test --manifest-path /Users/lyyeakkhai/workspace/rayu/rayucode-v2/Cargo.toml -p rayucode-app-core permission_gate
```
Expected: FAIL (module not yet wired).

- [ ] **Step 3: Implement `permission_gate.rs` and wire into `client_lifecycle.rs`, `client_processing.rs`, `turn_execution.rs`, and `turn_streaming_mpsc.rs`**

1. Create `crates/rayucode-app-core/src/tool/permission_gate.rs` modeled directly on `ask_user_question.rs`:
   - `PermissionConnection` holds `Mutex<PermissionState>` (`closed`, `mode: PermissionMode`, `session_allowed_tools: HashSet<String>`, `pending: HashMap<String, oneshot::Sender<PermissionDecision>>`).
   - `authorize_tool(session_id, tool_name, input)` checks `mode`:
     - `Plan`: returns `Err("Blocked by Plan mode (read-only)")` for `Edit`/`Command`.
     - `Orchestrator`: returns `Err("Blocked by Orchestrator mode: delegate workspace changes to a worker")` for `Edit`/`Command`.
     - `FullManage`: returns `Ok(())`.
     - `AcceptEdits`: returns `Ok(())` for `ReadOnly`/`Coordinate`/`Edit`; prompts for `Command` unless in `session_allowed_tools`.
     - `Default`: returns `Ok(())` for `ReadOnly`/`Coordinate`; prompts for `Edit`/`Command` unless in `session_allowed_tools`.
   - `close()` drops/sends `PermissionDecision::Deny` to all pending oneshots so active turns never hang on client disconnect.
2. In `client_lifecycle.rs:1012`:
   - Add `Request::PermissionResponse` and `Request::SetPermissionMode` to the fast-path match (never blocking on the `Agent` mutex for `PermissionResponse`).
   - On `SetPermissionMode`, update `permission_client.set_mode(mode)` and call `locked.invalidate_sdk_tools()` if idle.
   - On client disconnect, call `permission_client.close()`.
3. In `client_processing.rs`, wrap turn execution in `crate::tool::permission_gate::scope(&session_id, supports_permissions.then(|| permission_client.clone()), ...)`.
4. In `turn_execution.rs`:
   - Filter out hidden tools in `tool_definitions` when `permission_gate::is_tool_hidden_for_mode(...)` is true.
   - Enforce `validate_tool_allowed` against active `PermissionMode`.
5. In `turn_streaming_mpsc.rs` right before `registry_clone.execute_with_start(...)`:
   - Await `crate::tool::permission_gate::authorize(&self.session.id, &tc.name, &tc.input).await`; if denied, return tool error without executing the tool (and treat interactive permission wait as foreground, never auto-backgrounded).

- [ ] **Step 4: Run Rust tests and build the local `rayu` binary**

Run:
```bash
cargo test --manifest-path /Users/lyyeakkhai/workspace/rayu/rayucode-v2/Cargo.toml -p rayucode-app-core permission_gate && cargo build --manifest-path /Users/lyyeakkhai/workspace/rayu/rayucode-v2/Cargo.toml --bin rayu
```
Expected: All tests PASS and `target/debug/rayu` builds cleanly.

- [ ] **Step 5: Commit**

```bash
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 add crates/rayucode-app-core
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 commit -m "feat(app-core): enforce 5-mode Local Permissions and non-blocking PermissionRequest gate"
```

---

### Task 5: Electron Daemon Bridge, IPC Channels & Shared Cloud Fallback

**Files:**
- Modify: `desktop/electron/daemon-client.ts:230-650`
- Modify: `desktop/electron/auth-bridge.ts:280-390,1540-1565`
- Modify: `desktop/electron/ipc-schemas.ts`
- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/preload.cjs`
- Modify: `desktop/src/lib/ipc-client.ts` & `desktop/src/vite-env.d.ts`
- Test: `desktop/electron/__tests__/daemon-client.test.ts` *(new)*

**Interfaces:**
- Consumes: `buildDesktopSdkTools`, `executeDesktopTool`, `DesktopArtifactEvent` from `./desktop-tools.js`; `BrowserCdpController.setEnsureBrowserOpen`.
- Produces:
  - IPC invoke: `rayu:harness:set-permission-mode` (`{ sessionId, mode }`)
  - IPC push events: `rayu:desktop:artifact` (`DesktopArtifactEvent`), `rayu:browser:ensure-open` (`{ url?: string }`)
  - Renderer client: `ipcClient.harness.setPermissionMode(sessionId, mode)`, `ipcClient.desktop.onArtifact(cb)`, `ipcClient.browser.onEnsureOpen(cb)`

- [ ] **Step 1: Write failing test in `desktop/electron/__tests__/daemon-client.test.ts`**

Test that `RayuDaemonClient` calls `client.configureTools(sessionId, { custom: ... })` containing `create_powerpoint`, `write_excel`, `read_excel`, `browser_navigate`, `list_templates`, `save_template` on BOTH `createSession()` and `attachSession()`, and sends `set_permission_mode` when `setPermissionMode(sessionId, "plan")` is called.

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/vitest run electron/__tests__/daemon-client.test.ts
```
Expected: FAIL (`setPermissionMode is not a function` / `configureTools` not called).

- [ ] **Step 3: Wire `daemon-client.ts`, `auth-bridge.ts`, `main.ts`, `preload.cjs`, `ipc-schemas.ts`, and `ipc-client.ts`**

1. In `daemon-client.ts`:
   - Accept desktop tool builder + `onArtifact` + `browserCdp` via `configureDesktopRuntime(...)`.
   - Call `await this.syncSessionTools(client, info.session_id)` inside BOTH `createSession()` and `ensureAttached()`/`attachSession()`.
   - Add `setPermissionMode(sessionId: string, mode: string)` sending `{ req: "set_permission_mode", session_id: sessionId, mode }` (with automatic retry after `turn_done` if `"Session is busy"`).
   - Store `desiredPermissionMode` and re-sync it on attach/reconnect.
2. In `auth-bridge.ts`:
   - Replace duplicate `read_excel`, `write_excel`, `create_powerpoint`, `browser_*` branches in `runWorkspaceAgentTool` with a direct delegation to `executeDesktopTool(...)` from `./desktop-tools.js` so Cloud fallback shares the exact same executor and emits `rayu:desktop:artifact`.
3. In `main.ts`, `ipc-schemas.ts`, `preload.cjs`, `vite-env.d.ts`, `ipc-client.ts`:
   - Add `HarnessSetPermissionModeSchema` (`default | acceptEdits | plan | fullManage | orchestrator`).
   - Register `rayu:harness:set-permission-mode` handler.
   - Forward `rayu:desktop:artifact` and `rayu:browser:ensure-open` from Main -> `mainWindow.webContents.send(...)`.
   - Wire `browserCdp.setEnsureBrowserOpen(() => ...)` in `main.ts`.

- [ ] **Step 4: Run Electron typecheck & tests**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run electron/__tests__/daemon-client.test.ts electron/__tests__/desktop-tools.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 add desktop/electron desktop/src/lib/ipc-client.ts desktop/src/vite-env.d.ts
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 commit -m "feat(electron): register Desktop SdkTools and permission mode sync on Rust daemon sessions"
```

---

### Task 6: Remove Hardcoded Presentation Demo & Wire Live Slide/Excel/Permission Hydration

**Files:**
- Modify: `desktop/src/features/execution-trace/components/chat-stream.tsx:370-790`
- Modify: `desktop/src/lib/harness-adapter.ts:380-585`
- Modify: `desktop/src/lib/app-store.ts:165-270,560-640`
- Modify: `desktop/src/components/shell/AppShell.tsx`
- Modify: `desktop/src/features/previews/components/slide-pane.tsx:38-145`
- Modify: `desktop/src/features/previews/components/excel-pane.tsx:80-135`
- Test: `desktop/src/features/previews/__tests__/excel-pane.test.tsx` & `desktop/src/features/execution-trace/__tests__/chat-stream-live.test.tsx` *(new)*

**Interfaces:**
- Consumes: `ipcClient.desktop.onArtifact`, `ipcClient.browser.onEnsureOpen`, `ApiEvent::PermissionRequest` frames.
- Produces:
  - `useAppStore.setSlideDeck(deck: SlideDeckState | null)` (stores `filePath?: string` on `SlideDeckState`)
  - `useAppStore.setLiveExcelWorkbook(workbook: OfficeExcelWorkbookPayload | null)`
  - Preserved visual preview thumbnail cards in `harness-adapter.ts` populated from real `create_powerpoint` / `write_excel` tool outputs.

- [ ] **Step 1: Write failing tests in `desktop/src/features/execution-trace/__tests__/chat-stream-live.test.tsx`**

Test:
1. Sending `/presentations Build a 3-slide roadmap` does **NOT** render `"Enterprise Quarterly Business Review"` and instead calls `ipcClient.trace.sendPrompt`.
2. Receiving `tool_done` for `create_powerpoint` maps to the visual `previews` thumbnail step with the real deck title (preserving the visual card design).
3. Receiving `ev: "permission_request"` opens the live permission approval UI and clicking `Allow` calls `ipcClient.trace.respondToPermission(sessionId, requestId, "allow")`.

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/vitest run src/features/execution-trace/__tests__/chat-stream-live.test.tsx
```
Expected: FAIL (hardcoded `runPresentationAgentFlow` still hijacks `/presentations`).

- [ ] **Step 3: Remove hardcoded demo flow and wire live hydration**

1. In `chat-stream.tsx`:
   - Delete `runPresentationAgentFlow`, `pendingSlideContinuationRef`, and the `if (isPresentationRequest)` intercept block (`lines 651-658`).
   - Simplify `handlePermissionDecision` to always call `ipcClient.trace.respondToPermission(...)`.
2. In `harness-adapter.ts`:
   - On `ev === "permission_request"`, emit `{ type: "permission-request", requestId, toolName, description }` (and wire `chat-stream.tsx` to call `setPendingPermission(...)`).
   - On `ev === "tool_done"` for `create_powerpoint`, emit a `previews` step (`kind: "slide"`, `badge: ".pptx"`, `label: args.title`, `pillLabel: "Slide"`) under `"Built presentation"` so the exact visual card layout is preserved with real data.
   - On `ev === "tool_done"` for `write_excel` / `read_excel`, emit an Excel step card with the real filename.
   - On `ev === "tool_done"` for `browser_*`, group under `"Used the browser"`.
3. In `app-store.ts` & `AppShell.tsx`:
   - Add `filePath?: string` to `SlideDeckState`. Initialize `slideDeck` to `null` outside `MODE === "test"` (keep test fixture compatibility for existing `excel-pane.test.tsx` or pass explicit state in tests).
   - Subscribe to `ipcClient.desktop.onArtifact(...)` and `ipcClient.browser.onEnsureOpen(...)` inside `AppShell.tsx` to hydrate `slideDeck`, hydrate `ExcelPane` query cache, and auto-open the `slide`, `excel`, or `browser` right tab.
4. In `slide-pane.tsx`:
   - When `slideDeck` is `null` or empty, render a clean empty state (*"No presentation open yet"*).
   - In `handleRequestEditSubmit`, remove the local bullet string-append hack (`activeSlide.body + "\n\n• " + trimmed`); dispatch a real edit prompt referencing `slideDeck.filePath`, active slide index/title, and the user's request to the active session so the Rust core engine updates and re-runs `create_powerpoint`.
5. In `excel-pane.tsx`:
   - Remove the hardcoded `https://rayucode.com/demo/Q4-Token-Cost-Model.xlsx` default embed URL (default to empty string `""` with placeholder).
   - React cleanly when `serverWorkbook` updates from `rayu:desktop:artifact` so newly generated `.xlsx` sheets immediately render in the grid.

- [ ] **Step 4: Run tests, ESLint, and design token lint**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/vitest run src/features/execution-trace/__tests__/chat-stream-live.test.tsx src/features/previews/__tests__/excel-pane.test.tsx && ./node_modules/.bin/eslint src electron && node scripts/lint-design.mjs
```
Expected: PASS, 0 violations.

- [ ] **Step 5: Commit**

```bash
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 add desktop/src/features/execution-trace desktop/src/lib/harness-adapter.ts desktop/src/lib/app-store.ts desktop/src/components/shell/AppShell.tsx desktop/src/features/previews
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 commit -m "feat(desktop): remove hardcoded presentation flow and hydrate Slide/Excel/Permission UI live"
```

---

### Task 7: Wire Local Permissions Popover to Rust Core & Full End-to-End Verification

**Files:**
- Modify: `desktop/src/features/sessions/hooks/use-sessions.ts:160-184`
- Modify: `desktop/src/features/sessions/components/composer.tsx:630-640`
- Test: `desktop/src/features/sessions/__tests__/model-effort-popover.test.tsx`

**Interfaces:**
- Consumes: `ipcClient.harness.setPermissionMode(sessionId, mode)` from Task 5.
- Produces: Live synchronization of `Ask` / `Auto-edit` / `Plan` / `Full Manage` / `Orchestrator` from Desktop UI (`PermissionPopover` click and `⇧Tab`) to the active Rust daemon session.

- [ ] **Step 1: Add failing test in `desktop/src/features/sessions/__tests__/model-effort-popover.test.tsx`**

Verify that selecting `"plan"` or `"orchestrator"` in `PermissionPopover` (or pressing `⇧Tab`) invokes `ipcClient.harness.setPermissionMode(activeSessionId, mode)` and reverts with an error toast if the daemon rejects the change.

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && ./node_modules/.bin/vitest run src/features/sessions/__tests__/model-effort-popover.test.tsx
```
Expected: FAIL (`ipcClient.harness.setPermissionMode` not called).

- [ ] **Step 3: Wire `setPermissionMode` in `use-sessions.ts` & `composer.tsx`**

In `use-sessions.ts`:
- Read `activeSessionId` from `useAppStore` and, when `setPermissionMode(nextMode)` is called, update local state + `localStorage` and invoke `ipcClient.harness.setPermissionMode(activeSessionId, nextMode)` whenever a live session is active (reversing state + showing `toast.error` if the daemon rejects it).
- Also sync `permissionMode` when a new session is created in `home-view.tsx` / `workspace` before the first message is sent.

- [ ] **Step 4: Run complete Rust + Desktop verification suite**

Run:
```bash
cargo test --manifest-path /Users/lyyeakkhai/workspace/rayu/rayucode-v2/Cargo.toml -p rayucode-protocol -p rayucode-harness-api -p rayucode-harness-api-server -p rayucode-app-core permission && \
cargo build --manifest-path /Users/lyyeakkhai/workspace/rayu/rayucode-v2/Cargo.toml --bin rayu && \
cd /Users/lyyeakkhai/workspace/rayu/rayucode-v2/desktop && \
./node_modules/.bin/tsc --noEmit && \
./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit && \
./node_modules/.bin/eslint src electron && \
node scripts/lint-design.mjs && \
./node_modules/.bin/vitest run && \
./node_modules/.bin/vite build && \
./node_modules/.bin/tsc -p tsconfig.electron.json && \
node -e "require('fs').copyFileSync('electron/preload.cjs','dist-electron/preload.cjs')"
```
Expected: Every single Rust test, Rust binary build, renderer + Electron TypeScript check, ESLint check, design token check, Vitest suite, Vite production build, and Electron build exits `0`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 add desktop/src/features/sessions
git -C /Users/lyyeakkhai/workspace/rayu/rayucode-v2 commit -m "feat(sessions): sync Local Permissions popover and Shift+Tab to Rust core engine"
```
