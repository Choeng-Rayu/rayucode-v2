# Spec 05 — Automations (Overnight, Schedules, Ambient & Quality Gates)

> **Desktop Reference:** `desktop/src/features/automations/components/automations-view.tsx`, `desktop/src/features/automations/components/overnight-launcher.tsx`.
> **Rust Engine Backing:** `crates/rayucode-overnight-core`, `crates/rayucode-app-core/src/ambient.rs`, `schedule` tool (`create`/`list`/`cancel`), `RuntimeCommand::{Overnight, Schedules, Ambient, Autoreview, Autojudge, Review, Judge, Productivity}`.
> **Owned Files (Wave 3E — Part 1):** `vscode/webview/src/features/automations/**`.

---

## 1. Visual Structure — Desktop Fidelity + Complete Rust Automation Surface

Page container: `mx-auto flex w-full max-w-[1040px] flex-col gap-5 px-4 @min-[640px]/app:px-[26px] pt-5 pb-8`.

### Sub-Tab Bar (Radix `Tabs`)
Clean 4-tab strip keeping each automation discipline uncluttered:
1. **`Overnight`** *(Default — 1:1 with Desktop `AutomationsView`)*
2. **`Schedules`** *(Rust `schedule` tool + recurring cron tasks)*
3. **`Ambient`** *(Autonomous ambient cycles + queued `request_permission` approvals)*
4. **`Quality & Reports`** *(Auto-Review, Auto-Judge, one-click `/review` & `/judge`, Productivity report)*

---

## 2. Tab 1 — Overnight Runs (Exact Desktop Parity)

### Inline `OvernightLauncher` Card (`rayu-card-bevel rounded-[14px] border border-hairline bg-pane p-4`)
- Mission input (`What should Rayu work on overnight?`), duration preset pills (`2h`, `4h`, `8h`, `Custom`), max parallel agents selector, permission mode selector (`Auto-edit` / `Full Manage` / `Ask`), active workspace repo/branch badge, and `[Start Overnight Run]` primary button (`RuntimeCommand::Overnight ["start", duration, mission]`).

### Running & Recent Manifests (`OvernightRunRow` — exact Desktop markup)
```text
┌─────────────────────────────────────────────────────────────────────────┐
│ ● Sweep compiler warnings & add harness tests  [Running]                │
│ run_id: ovn_0412 · local · rayucode-v2 · 4 agents · 4h · wakes 06:00    │
│ (handoff 05:45) · 6 task cards · 5 validations green                    │
│                       [Event log ▾]  [Pause]  [Run now]  [× Cancel]     │
├─────────────────────────────────────────────────────────────────────────┤
│ (Expanded bg-inset Event Log Drawer:)                                   │
│ 02:14:03  spawned worker-1 (crates/rayucode-harness-api)                │
│ 02:18:41  validation green: cargo test -p rayucode-harness-api          │
└─────────────────────────────────────────────────────────────────────────┘
```
- Uses Desktop's exact **`RunStatusPulse`** (`animate-ping` ring on `Running`, solid `bg-warn` on `Paused`, `bg-danger` on `Cancelled`, `bg-brand` on `Completed`) and **`RunStatusBadge`** pill.
- Actions:
  - `Event log ▾`: fetches `RuntimeCommand::Overnight ["log"]`, renders `bg-inset font-mono text-[11.5px] tabular-nums`.
  - `Pause / Resume`, `Run now`, `Cancel` (`destructive`), plus `[Inspect Coordinator Session]` jumping directly to the coordinator session in Chat or Swarm!

### Morning Handoff Reports (`MorningHandoffReport`)
- Renders completed runs from `RuntimeCommand::Overnight ["list"]` & `["review"]`.
- Expanding a report shows structured task outcome cards (`title`, `status` badge, `outcome`, `validation.result`, `evidence[]`, `followups[]`) PLUS a VS Code-native **`[Open Review in Markdown Preview]`** button (`markdown.showPreview` on `manifest.review_path`)!

---

## 3. Tab 2 — Schedules (`ScheduleRow` — Desktop Parity + Rust `schedule` Tool)

- Inline `[+ New Schedule]` collapsible bar (Prompt/Action, Cron or relative delay e.g. `"in 2 hours"` / `"0 8 * * 1-5"`, Permission Mode badge).
- List of active & recurring schedules matching Desktop's `ScheduleRow`:
  - Title + `PermissionModeBadge` (`Auto-edit` brand / `Full Manage` warn / `Ask` hairline) + `Queued now` badge when triggered
  - Monospace metadata: `cronSummary · repo · description`
  - Right controls: `[Run now]` ghost button + Radix `Switch` (`enabled`) + `[Delete]` (`schedule cancel`).

---

## 4. Tab 3 — Ambient Autonomous Cycles

- Displays Rust `ambient` daemon state (`enabled`, next scheduled wakeup, current cycle status, recent cycles).
- **Pending Ambient Permissions Queue:** Surfaces any queued `request_permission` actions (`action`, `urgency`, `why_permission_needed`) with instant `[Approve]` / `[Deny]` controls so unattended ambient agents never stall silently!

---

## 5. Tab 4 — Quality Gates & Productivity

- **Auto-Review & Auto-Judge Cards (`rayu-card-bevel bg-pane rounded-xl p-4`):**
  - Live Radix `Switch` toggles wired to `RuntimeCommand::Autoreview` (`on`/`off`) and `RuntimeCommand::Autojudge` (`on`/`off`), showing each gate's configured model override (linking to `Settings → Models & Agents`).
  - One-click **`[Run Independent Review]`** (`RuntimeCommand::Review`) and **`[Run Acceptance Judge]`** (`RuntimeCommand::Judge`) buttons that spawn an independent non-editing reviewer worker and link straight to its output!
- **Productivity Report (`RuntimeCommand::Productivity`):**
  - `[Generate Productivity Report]` action rendering the Rust-generated Markdown summary + embedded PNG chart (`image.base64` with CSP `img-src data:`) + `[Open PNG in VS Code]`.

---

## 6. Compact Sidebar Adaptation (`< 560px`)

- Sub-tabs render as a horizontal scrollable pill strip (`overflow-x-auto no-scrollbar`).
- `OvernightRunRow` and `ScheduleRow` stack their action buttons cleanly on row 2 (`flex-wrap gap-1.5`) with zero horizontal overflow.
