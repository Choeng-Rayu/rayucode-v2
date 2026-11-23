# Spec 03 — Background Process Viewer (Rust `BackgroundTaskManager`)

> **Rust Engine Backing:** `crates/rayucode-base/src/background.rs` (`list`, `status`, `output`, `cancel`, `running_snapshot`), `crates/rayucode-background-types/src/lib.rs` (`BackgroundTaskStatus`, `BackgroundTaskProgress`, `BackgroundTaskStalled`), `crates/rayucode-harness-api/src/requests.rs` (`ApiRequest::BackgroundTool`), `crates/rayucode-harness-api/src/events.rs` (`ApiEvent::BackgroundProgress`), plus Harness API v1.14 `RuntimeCommand::Background`.
> **Owned Files (Wave 3C):** `vscode/webview/src/features/processes/**`.

---

## 1. Quiet-Signal UX Philosophy for Background Processes

- **Zero Noise When Idle:** When 0 background processes exist for the workspace/session, `BackgroundDockBar` renders `null` (0px height) and the VS Code Status Bar omits the background pill.
- **Instant Visibility When Active:** As soon as a command auto-backgrounds (`auto_background_timeout_ms`), is moved to background via **`Alt+B`** / inline `[Background]` button, or a background build/test/swarm/overnight job starts, the user sees it immediately in 3 coordinated places without cluttering chat messages:
  1. **`BackgroundDockBar` (30px hairline bar directly above Floating Composer)**
  2. **Compact Top Bar `[Bg·N]` badge / Right Inspector `Processes` summary / More Menu `Background tasks`**
  3. **VS Code Status Bar item (`Rayu · 2 bg`)** — clicking focuses RayuCode and opens `BackgroundProcessDrawer`.
- **Zero Chat Spam on Completion:** Background completions update the dock bar + drawer status cleanly and emit at most a single quiet 1-line hairline divider in chat (`Background task cargo test finished · Exit 0 · View output ›`) — never dumping raw logs into the conversation transcript.

---

## 2. Visual Blueprint

### A. `BackgroundDockBar` (30px Hairline Strip Above Composer)
```text
┌──────────────────────────────────────────────────────────────────────┐
│ [OrbitMark] 2 running · cargo test (64% · 12/19) · 1 stalled     ⌃  │
└──────────────────────────────────────────────────────────────────────┘
```
- Classes: `mx-auto mb-1.5 flex h-[30px] w-full max-w-[732px] cursor-pointer items-center gap-2 rounded-[10px] border border-hairline bg-pane px-2.5 text-xs text-body transition-colors hover:border-premium hover:bg-raised`
- Uses `<RayuProcessingMark animated className="size-3.5" />` when running; amber `AlertTriangle` (`text-warn`) when any task is stalled; `Check` (`text-brand-text`) briefly when recently completed tasks remain unread.
- Single-line truncation (`truncate`), `tabular-nums`, zero emojis.

### B. `BackgroundProcessDrawer` (Slide-Over Sheet in Compact `< 560px` / Docked Split Drawer in Wide `>= 960px`)
```text
┌──────────────────────────────────────────────────────────────────────┐
│ Background Processes     [2 running]     [Cleanup] [Refresh]   [×]  │
├──────────────────────────────────────────────────────────────────────┤
│ [All 5]  [Running 2]  [Stalled 1]  [Done 2]  [Failed 0]             │
├──────────────────────────────────┬───────────────────────────────────┤
│ PROCESS LIST (grouped)           │ OUTPUT · cargo test (bg_8f2a)     │
│                                  │ Status: Running · 64% · ETA 38s   │
│ SHELLS & BUILDS (3)              │ [Follow: On] [Copy] [Open] [Stop] │
│ ┌──────────────────────────────┐ │ ┌───────────────────────────────┐ │
│ │ ● cargo test -p app-core     │ │ │ running 19 tests              │ │
│ │   ▓▓▓▓▓▓▓▓▓░░░░  64%  1m 12s │ │ │ test tool::gate_ask ... ok    │ │
│ │   12/19 tests · ETA 38s  [■] │ │ │ test tool::gate_plan ... ok   │ │
│ └──────────────────────────────┘ │ │ test bg::cancel ... (running) │ │
│   ▲ npm run package:vscode       │ └───────────────────────────────┘ │
│     Stalled (60s quiet)   2m 04s │                                   │
│   ✓ cargo check --workspace      │ (If Stalled — quiet warn banner:) │
│     Exit 0                18.4s  │ ┌───────────────────────────────┐ │
│                                  │ │ ▲ No output for 60s — process │ │
│ AGENTS & OVERNIGHT (2)           │ │   is still alive. [Stop]      │ │
│   ● worker-2 · auth fix   3m 40s │ └───────────────────────────────┘ │
│   ✓ overnight-0412        2h 00m │                                   │
└──────────────────────────────────┴───────────────────────────────────┘
(In Compact < 560px: Process List stacks above Selected Output Tail with a Back toggle)
```

---

## 3. Component & Interaction Specifications

1. **Filter Tabs (Radix `Tabs`):** `All`, `Running`, `Stalled`, `Done`, `Failed` (each with subtle `tabular-nums` count pill).
2. **Process Groups (Fixed Priority Order):**
   - `Shells & Builds` (`bash`, `selfdev`, `desktop_selfdev`, `bg`)
   - `Agents & Swarm` (running swarm worker sessions / subagents)
   - `Overnight & Runtime Jobs` (overnight coordinators, model catalog refresh, memory extraction)
3. **`ProcessRow.tsx`:**
   - Strictly crisp 2-line density max:
     - Line 1: Semantic status icon (`RayuProcessingMark` / `AlertTriangle text-warn` / `Check text-brand-text` / `X text-danger`) + truncated `displayName || toolName` + live ticking elapsed duration (`tabular-nums`, single shared 1s interval hook!) + hover `[Stop]` (`Square`) button if running.
     - Line 2: If determinate progress (`percent` or `current/total`), renders a `h-[3px] rounded-full bg-active` hairline bar with `bg-brand` fill + concise `64% · 12/19 tests · ETA 38s`. If indeterminate, renders concise `summary` or `Exit 0` / `Exit N`.
4. **`ProcessOutputTail.tsx` (Zero-Waste Bandwidth Policy):**
   - Styled identically to Desktop's `ShellCard` dark well (`rounded-[12px] border border-hairline bg-inset shadow-bevel-surface font-mono text-xs leading-[1.55] tabular-nums`).
   - **Never polls in the background when drawer is closed!**
   - Loads bounded tail (`output(taskId, 128KB)`) immediately on row selection.
   - Provides:
     - **`Follow` Switch** (default `Off` for completed, `On` ONLY while drawer is open and selected process is `Running`, polling every `1500ms` via TanStack Query `refetchInterval` and auto-scrolling only when pinned to bottom).
     - **`Refresh`** manual tail reload button.
     - **`Copy`** clipboard button with `sonner` toast confirmation.
     - **`Open File`** (`ExternalLink` / `FileText`): invokes `editorBridge.openFile(task.outputFile)` so the user can open the full multi-megabyte log natively in a VS Code editor tab with full `Ctrl+F` search!
     - **`Stop Process`** (`destructive` button): invokes `RuntimeCommand::Background ["cancel", taskId]` (Rust `BackgroundTaskManager::cancel` with graceful `SIGTERM -> SIGKILL`).
   - **`Cleanup`** header action calls `RuntimeCommand::Background ["cleanup"]` to dismiss finished/superseded rows from the drawer while keeping output files intact on disk.

---

## 4. State & Rust Wire Contract

```ts
export interface BackgroundProcessView {
  taskId: string
  sessionId: string
  group: "shells" | "agents" | "runtime"
  toolName: string
  displayName: string
  status: "running" | "stalled" | "completed" | "failed" | "superseded"
  progressKind: "determinate" | "indeterminate"
  percent?: number
  current?: number
  total?: number
  unit?: string
  summary: string
  etaSeconds?: number
  exitCode?: number
  outputFile?: string
  startedAtMs: number
  updatedAtMs: number
  durationSecs?: number
  stallQuietSecs?: number
  unread?: boolean
}
```
- Real-time `ApiEvent::BackgroundProgress` frames patch the Zustand store via `createStreamBatcher(16ms)` with zero full-list refetch storms.
- Pressing **`Alt+B`** anywhere inside an active session with a running foreground tool dispatches `ApiRequest::BackgroundTool { session_id }`, immediately transitioning that tool into `BackgroundDockBar` and unblocking the agent turn!
