# Spec 04 — Swarm Mission Control

> **Desktop Reference:** `desktop/src/features/swarm/components/swarm-view.tsx`, `desktop/src/features/swarm/components/swarm-launchpad.tsx`, `desktop/src/features/swarm/components/spawn-worker-bar.tsx`, `desktop/src/features/swarm/components/agent-roster.tsx`, `desktop/src/features/swarm/components/agent-inspector.tsx`, `desktop/src/features/swarm/components/coordination-ledger.tsx`.
> **Rust Engine Backing:** `docs/SWARM_ARCHITECTURE.md`, `crates/rayucode-swarm-core`, `crates/rayucode-app-core/src/server/swarm.rs`, `swarm` tool (~25 actions), Harness API v1.14 `"swarm_control"`.
> **Owned Files (Wave 3D):** `vscode/webview/src/features/swarm/**`.

---

## 1. Idle State (`SwarmLaunchpad.tsx`) & Active State (`SwarmView.tsx`)

### Idle State (0 Active Agents)
Direct port of Desktop's `SwarmLaunchpad`:
- Centered calm card (`max-w-[640px]`) with custom 3-node Swarm symbol, concise 1-line explanation of root-only fan-out coordination, inline **Launch First Worker** form (Role/Label, Model dropdown honoring `agents.swarm_model_allowlist` / `inherit`, optional Git Worktree switch, initial task prompt), and a quick `[Start Swarm Mode]` CTA.

### Active State — Wide (`>= 960px`, `max-w-[1120px] px-[26px] pt-5 pb-8`) vs. Compact (`< 560px`)

```text
Wide (>= 960px)
┌─────────────────────────────────────────────────────────────────────────┐
│ [Network] vscode-extension [▾ Switch swarm]  swm_4a1 · Plan v3         │
│                                     [+ Spawn worker]  [Pause All]      │
├─────────────────────────────────────────────────────────────────────────┤
│ ● 5 agents · 3 running, 2 completed · 2 worktrees · 0 file conflicts   │
│                                                  12.4 cr · 94% KV warm │
├─────────────────────────────────────────────────────────────────────────┤
│ (Collapsible SpawnWorkerBar: label | model ▾ | worktree □ | prompt [→])│
├──────────────────────────────┬──────────────────────────────────────────┤
│ ROSTER (300–370px)           │ INSPECTOR: worker-2 (running)            │
│ ● coordinator (depth 0)      │ [Open in Chat]  [Pause/Stop]  [Salvage] │
│  ├─ ● worker-1 · rust-api    │                                          │
│  ├─ ● worker-2 · ui-shell ◄  │ ASSIGNED TODO LANE (3/5)                 │
│  ├─ ▲ worker-3 · blocked     │  ✓ Port globals.css tokens               │
│  └─ ✓ worker-4 · sdk-parity  │  ● Build Dual-Mode TopBar                │
│                              │  ○ Wire Compact Sidebar Drawer           │
│                              │                                          │
│                              │ LIVE TRACE (Reused WorkTrace+ShellCard)  │
│                              │  ▸ Worked for 38s · 5 files · 1 cmd      │
│                              │                                          │
│                              │ [Send DM to worker-2...           [Send]]│
├──────────────────────────────┴──────────────────────────────────────────┤
│ [Message Board (14)]  [Shared Plan (v3) · 1 pending]  [Worktrees (2)]  │
│  (Chronological DMs, broadcasts, channels / Plan proposals / Worktrees) │
└─────────────────────────────────────────────────────────────────────────┘
```

### Compact Sidebar Adaptation (`< 560px`)
- Header condenses to 2 clean lines: Swarm title + `[Swarm ▾]` + `[+]` Spawn toggle + `[Pause]`.
- Telemetry strip wraps cleanly into 2 compact chips (`3 running · 2 done`, `0 conflicts · 12.4 cr`).
- **Master-Detail Stack:** Shows **Roster** + top-level tabs (`Roster | Board | Plan | Worktrees`). Tapping any worker row slides smoothly into **Worker Inspector** with a `← Back to Roster` header bar so the user gets full width for reading the worker's todo lane, `WorkTrace`, `ShellCard`, and `Send DM` bar!

---

## 2. Exact Desktop Component Contracts & VS Code Enhancements

1. **Multi-Swarm Switcher & Label (`list_swarms`, `set_swarm_label`):**
   - Dropdown on the Swarm header title lists all live swarms (`id`, `label`, `coordinator`, `member_count`) with inline rename (`set_swarm_label`) and cross-swarm DM indicator.
2. **Single-Line `swarm-telemetry-strip` (`rounded-[12px] border border-hairline bg-pane px-3.5 py-2`):**
   - Exact Desktop styling: pulsing `size-2 bg-brand shadow-[0_0_0_3px_var(--accent-soft)]` dot + `<strong tabular-nums>N agents</strong> · R running, C completed` + `W worktrees · K file conflicts` (clicking `K > 0` jumps directly to the conflict notice with conflicting file `<TechFileBadge />` links opening in VS Code!) + `planLabel` + right-aligned `credits · KV warm %`.
3. **Inline `SpawnWorkerBar`:**
   - Fields: `label` (validated unique against `existingAgentNames`), `model` selector (populated from Rust `agents.swarm_model_allowlist` when strict, or full live route catalog + `inherit` otherwise), `useWorktree` switch, `prompt` input, `[Spawn]` (`variant="primary"`) + `[Cancel]`.
4. **`AgentRoster` (`300px–370px`):**
   - Root `coordinator` (depth 0) pinned at top; parallel workers indented cleanly beneath with hairline tree connector.
   - Each row displays: lifecycle dot (`spawned`, `ready`, `running` with `RayuProcessingMark`, `blocked` warn, `completed` brand, `failed`/`crashed` danger, `stopped` faint), `agent_label`, 1-line current tool intent, and `+A -R` edit stats (`tabular-nums`).
5. **`AgentInspector` (Zero Duplicate Trace UI):**
   - Header: worker label, model/provider badge, lifecycle pill, `[Open Full Chat]` (switches Chat page to that worker's session!), `[Pause / Stop]` (subtree-safe stop), and `[Salvage]` / `[Retry]` action when `failed` or `blocked`.
   - **Assigned Todo Lane:** Displays the worker's prepopulated lane from `get_todo_state(workerSessionId)` with completion fraction.
   - **Execution Trace:** Reuses `WorkTrace` + `ShellCard` from `features/chat` (read-only barrel import!) hydrated from `peek_session` / live stream.
   - **Direct `Send DM` Steering Bar:** Bottom input sending an explicit DM soft-interrupt (`swarm_action: dm`) without disrupting other workers; automatically appends to Message Board on ack.
6. **`CoordinationLedger` (3 Tabs):**
   - **`Message Board`:** Filterable (`All | DMs | Broadcasts | Channels | Lifecycle`) chronological stream showing sender -> recipient pills, channel tag, timestamp, and automatic worker completion summaries (quiet 2-line preview, click to expand).
   - **`Shared Plan (vN)`:** Renders `VersionedPlan` items grouped by phase/scope with assignee pill and status badge. **Pending Plan Proposals** render at top with diff summary and coordinator **`[Approve Plan Update]`** / **`[Reject]`** buttons!
   - **`Worktrees`:** Lists each worktree group (`branch`, `path`, Worktree Manager badge, assigned agents, dirty file count) with VS Code-native **`[Open Worktree in New Window]`** (`vscode.openFolder(uri, true)`) and **`[View Diff]`** actions!
