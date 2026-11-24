# VS Code Chat, Live Tool Trace & Composer Parity Design

- **Date:** 2026-11-25
- **Status:** Approved Design (Pending Spec Review)
- **Branch:** `feature/improve-chat-experience`
- **Architecture:** Approach A (Direct modular port into `vscode/`)

## Context & Scope

The VS Code extension (`vscode/`) renders a React 19 + Tailwind CSS v4 + Radix UI webview (`vscode/webview/src/`), originally forked from Desktop (`desktop/`). Recent Desktop commits (`dde4491`, `0d11cb0`) introduced a calmer Codex-style execution trace, `batch` tool unpacking, a shared 1-second elapsed timer, root-level live stream persistence across route and session switches, clean history hydration, and mid-sentence `/skill` autocomplete.

### In Scope
1. Protocol and extension host history fidelity (`vscode/shared/vscodeProtocol.ts`, `vscode/host/runtime/sessionHub.ts`).
2. Upgraded harness frame and history adapter (`vscode/webview/src/lib/harness-adapter.ts`).
3. Root-level live trace store and controller (`vscode/webview/src/features/chat/hooks/liveTraceStore.ts`, `vscode/webview/src/App.tsx`, `vscode/webview/src/features/chat/hooks/useChatStream.ts`).
4. Calm Codex chat UI, monochrome `WorkTrace`, and single-accent inline file links (`WorkTrace.tsx`, `ChatStream.tsx`, `EditorialMarkdown.tsx`).
5. Mid-sentence `/skill` trigger in `SessionComposer.tsx`.
6. Updated and new unit/component tests plus full VS Code build, lint, typecheck, and VSIX verification.

### Out of Scope
- Sidebar project grouping overhaul or temp-directory filtering in `SidebarProjectsPane.tsx`.
- Telegram Remote UI updates.
- Deleting unused legacy files under `vscode/webview/` outside `vscode/webview/src/`.
- Extracting a shared `packages/trace-core` workspace package across `desktop/` and `vscode/`.

---

## 1. Protocol & Extension Host History Fidelity

### 1.1 `vscode/shared/vscodeProtocol.ts`
Extend `HistoryMessageViewSchema` with optional provenance, tool, and response telemetry fields while keeping existing `toolName`, `toolInput`, and `images` intact for backward compatibility:

- `toolId?: string`
- `origin?: string`
- `visibility?: string`
- `attemptId?: string | null`
- `attemptReason?: string`
- `attemptStatus?: string`
- `stopReason?: string | null`
- `responseStats?: { durationSecs?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; rayuCredits?: number }`

### 1.2 `vscode/host/runtime/sessionHub.ts`
Update `SessionHub.getHistory(sessionId)` to map optional fields from `rawMessages` returned by `client.getHistoryWithImages(sessionId)`:

- Map `msg.tool?.id` to `toolId` alongside `toolName` and `toolInput`.
- Map snake_case `response_stats` (`duration_secs`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `rayu_credits`) into camelCase `responseStats`.
- Forward `origin`, `visibility`, `attempt_id` (`attemptId`), `attempt_reason` (`attemptReason`), `attempt_status` (`attemptStatus`), and `stop_reason` (`stopReason`) when present.
- Keep all new fields optional so older `rayu` daemon binaries continue to validate cleanly against `HistoryMessageViewSchema`.

---

## 2. Upgraded Harness Adapter (`vscode/webview/src/lib/harness-adapter.ts`)

### 2.1 Execution Turn & Timeline Types
Extend `ExecutionTurn` with optional fields matching Desktop's trace model:

- `TraceTimelineItem`:
  - `{ type: "note"; id: string; text: string }`
  - `{ type: "group"; group: WorkStepGroup }`
- Optional fields on `ExecutionTurn`:
  - `timeline?: TraceTimelineItem[]`
  - `outcome?: "answered" | "answered_partial" | "declined" | "failed"`
  - `attempts?: TurnAttempt[]`
  - `finalAttemptId?: string | null`
  - `hiddenInternalMessages?: HiddenInternalMessage[]`

### 2.2 Live Frame Tracking (`HarnessStreamTracker` & `mapHarnessFrameToLiveEvents`)
Upgrade live frame mapping while retaining VS Code's `riskTier` parsing on `permission_request` and `intent` support in `describeActiveTool`:

- **Phase & Promotion Tracking:** Track `hasStreamedTextInPhase`, `phaseHasReads`, `phaseHasCommands`, `phaseHasSearches`, `phaseCommandCount`, and `turnCompleted`.
- **Execution Events:** Handle `tool_exec` alongside `tool_start` and `tool_call`. Whenever a tool starts or executes after `hasStreamedTextInPhase` is true, emit `{ type: "promote-note" }`, increment `batchEpoch`, and reset phase counters so interleaved prose becomes chronological trace notes.
- **Phase Group Titles:** Compute calm group titles (`Read files`, `Searched files`, `Ran a command`, `Ran commands`, `Read files, ran commands`).
- **Rust `batch` Tool Unpacking:** Unpack `batch` tool calls using `args.tool_calls` and `--- [N] tool ---` output sections into individual `read`, `edit`/`write`, `list`, `search`, `webfetch`/`websearch`, `todo`, and `command` steps inside `codex_work_${epoch}`. When `batch` fails before executing subcalls, emit a single compact retry step instead of dumping raw JSON.
- **Guardrails & Deduplication:** Handle `provider_guardrail` frames by emitting `answer-delta` with the decline notice, and guard `turn_done`/`turn_stopped` with `tracker.turnCompleted` so duplicate completion frames never commit duplicate turns.

### 2.3 History Reconstruction (`mapHistoryMessagesToTurns`)
Accept both protocol camelCase (`toolName`, `toolInput`, `responseStats`, `attemptId`, ...) and snake_case (`tool.name`, `tool.input`, `response_stats`, `attempt_id`, ...) inputs cleanly:

- **Hidden Recovery Filtering:** Move `origin === "engine_internal"`, `visibility === "hidden"`, incomplete-todo nudges, and known engine recovery prefixes into `hiddenInternalMessages` instead of rendering fake user turns.
- **Reasoning Sentinels:** Split `\u2063` sentinel lines from assistant messages into `notes`.
- **Synthetic User Message Folding:** Classify `[Imported tool result: ...]`, `Base directory for this skill: ...`, `**Background task...**`, `**Swarm...**`, `[Scheduled task]`, and `<system-reminder>` / `<command-message>` / `<local-command-*>` blocks into compact tool steps rather than user bubbles.
- **Tool Summaries & Stats:** Format `tool` rows using `tool.name` + `tool.input` (command, file path, pattern, or query), map `responseStats` to real `workedDuration`, `credits`, and `kvCachePct`, attach user `images` as `data:${mediaType};base64,${data}`, and reconcile multi-attempt provenance (`finalAttempt` / `latestAnsweredAttempt`).

---

## 3. Root Live Trace Store & Persistence

### 3.1 `vscode/webview/src/features/chat/hooks/liveTraceStore.ts`
Create a root Zustand store (`useLiveTraceStore`) and pure event reducer (`applyTraceEvents`) modeled after Desktop's `live-trace-store.ts`:

- **Store State:** `liveTurnsBySession: Record<string, ChatTurnView>` holds every active in-flight turn keyed by `sessionId`.
- **Module-Scoped Runtime Maps:** Maintain `trackersBySession`, `batchersBySession` (16ms `createStreamBatcher`), `startedAtBySession`, and `completedTurnIds` across component unmounts.
- **Shared 1s Elapsed Timer:** Run a single `setInterval(..., 1000)` whenever any entry in `liveTurnsBySession` has `isLive: true`, updating `workedDuration` via `formatDurationSeconds` and clearing the interval as soon as no turns are live.
- **Pure `applyTraceEvents(current, events)`:** Apply `note`, `promote-note`, `tool-status` (including `showLiveBackgroundPill` for long-running shell tools), `step` (updating both `groups` and `timeline`), `artifact`, `answer-delta`, `duration`, and `complete`.
- **Completion Commit:** On `complete`, append the finalized turn to the TanStack Query history cache (`["chat", "history", sessionId]`) exactly once (`completedTurnIds` dedupe), clear matching `pendingPermission`, invalidate `["sessions"]`, and clear `liveTurnsBySession[sessionId]`.

### 3.2 `<LiveTraceController />` in `vscode/webview/src/App.tsx`
Mount `<LiveTraceController />` once at the top of `App` so streaming stays alive across route switches (`changes`, `swarm`, `settings`) and session switches:

- Subscribe to `onHarnessFrame` once at root, routing frames by `frame.session_id || useAppStore.getState().activeSessionId`.
- Dispatch `permission_request`, `question_request` / `ask_user_question` (stored in `useAppStore` or `useLiveTraceStore`), `file_changes_state` (updating `fileChangesBySession` and invalidating `["changes"]`), and mapped `LiveTraceEvent`s into `batchersBySession`.
- Consume `pendingUserTurn` from `useAppStore` immediately via `startSessionLiveTurn`, eliminating the HomePage-to-Workspace mount race.
- Sync `isStreamActive` in `useAppStore` from `liveTurnsBySession[activeSessionId]?.isLive`.

### 3.3 `vscode/webview/src/features/chat/hooks/useChatStream.ts`
Refactor `useChatStream` into a thin consumer over `useLiveTraceStore` and TanStack Query (`["chat", "history", sessionId]`):

- Fetch `callRpc("sessions.history", { sessionId })` via TanStack Query and map full `HistoryMessageView` items (including `toolId`, `toolName`, `toolInput`, `responseStats`, `origin`, `visibility`, `attempt*`, and `images`) through `mapHistoryMessagesToTurns`.
- Keep `DEFAULT_SAMPLE_TURNS` for standalone non-VS Code demo preview (`!isVsCodeWebview() && sessionId === "ses_vscode_shell"`).
- Retain `sendPrompt`, `respondPermission`, `respondQuestion`, `backgroundActiveTool`, `rewindToTurn`, `undoRewind`, `softInterrupts`, `forkFromTurn`, `togglePinTurn`, and `retryTurn`.
- Ensure `sessions.history` hydration never overwrites or clears an active `liveTurn` for `sessionId`.

---

## 4. Calm Codex Chat UI & Mid-Sentence `/skill` Composer

### 4.1 `WorkTrace.tsx`
Update `vscode/webview/src/features/chat/components/WorkTrace.tsx` to match Desktop's calm Codex trace while preserving VS Code's IDE actions:

- **Auto-Expand Live, Auto-Collapse Finished:** Resolve expansion as `userExpanded ?? defaultExpanded ?? Boolean(isLive)`.
- **Calm Depth-0 Header:** Display `Working · ${workedDuration}` (with animated `RayuProcessingMark`) while `isLive` is true, and `Worked for ${workedDuration}` when complete (omitting the `· N files · M cmds` counter from the header). Keep VS Code's `Background Alt+B` button beside the toggle when `isLive && showLiveBackgroundPill`.
- **Chronological `timeline` Rendering:** Accept `timeline?: TraceTimelineItem[]`. Render interleaved notes and groups in timeline order (applying `coalesceTraceSteps` inside each group), falling back to `notes` + `coalesceTraceGroups(groups)` when `timeline` is absent.
- **Live Indicators:** Render pulsing `activeToolStatus` when a tool is running, or `"Thinking..."` while live before notes or groups arrive.
- **Monochrome File Links:** Replace `TechFileBadge` pills inside `FileReadStep` with calm underlined links (`text-body underline decoration-hairline-strong underline-offset-[3px] hover:text-ink`), while keeping click behavior (`postToHost({ type: "rayucode.editor.openFile", path, line })` plus right-inspector preview).
- **Compatibility:** Keep `ShellCard` (`Move to Background`, `Open Terminal`), `ToolStepCard`, `InlineDiffCard`, `coalesceTraceGroups`, and `summarizeWorkTraceMetrics` exported.

### 4.2 `ChatStream.tsx` & `EditorialMarkdown.tsx`
- In `ChatStream.tsx`: pass `timeline={turn.timeline}` to `<WorkTrace />`, auto-expand completed turns that have trace steps/notes without a final answer, and render `TurnFileSummaryCard` only when `!turn.isLive && fileChangesSnapshot.files.length > 0`. Keep `ApprovalCard` (`riskTier`), `ClarifyingQuestionCard`, `SoftInterrupt`, and `Rewind` banners.
- In `EditorialMarkdown.tsx`: align inline code path categories (`folder`, `file-ts`, `file-rust`, `file-doc`, `file-data`) to Desktop's single theme accent (`text-brand-text hover:bg-brand-soft/60`) and neutral code-block language badges (`text-muted-ink bg-active/70`), preserving Shiki highlighting and VS Code editor navigation.

### 4.3 Mid-Sentence `/skill` Composer (`SessionComposer.tsx`)
Port Desktop's cursor-aware slash trigger to `vscode/webview/src/features/composer/components/SessionComposer.tsx`:

- Track textarea caret position (`selectionStart`) across `onChange`, `onClick`, `onKeyUp`, and `onSelect`.
- Replace start-of-string `/^\/([a-zA-Z0-9_-]*)$/` with `getActiveSlashTrigger(value, cursor)` matching `/(?:^|\s)(\/([^\s/]*))$/` on the slice before the caret.
- Keep `@` file mention precedence whenever a `@query` token is active at the caret.
- On selecting an item from `SlashCommandMenu`, splice only `[slashIndex, endIndex]` with `/${command.name} `, preserving all text before and after the slash token, and restore caret position right after the inserted space.

---

## 5. Error Handling, Multi-Surface Sync & Design Guardrails

- **Route & Session Switch Resilience:** `<LiveTraceController />` remains mounted in `App.tsx`, so navigating away from `workspace` or switching active sessions preserves live timers and streamed output.
- **HomePage Handoff:** Starting a prompt from `HomePage` populates `liveTurnsBySession[sessionId]` before `ChatWorkspaceView` mounts, avoiding dropped `turn_start` or early `text_delta` frames.
- **Failure & Guardrail Handling:** `turn_stopped` (`reason === "failure"`) appends `**Error:** <message>`, `provider_guardrail` appends the refusal message cleanly, and `tracker.turnCompleted` prevents duplicate completion commits.
- **Dual-Surface Consistency:** Both Compact Sidebar (`rayucode.chat`) and Wide Editor Panel (`rayucode.workspace`) receive `rayucode.harness.frame` broadcasts from `SessionHub`, keeping both surfaces synchronized through the root controller.
- **Design & Isolation Gates:** All changes under `vscode/webview/src/` must obey `vscode/VSCODE_DESIGN.md` and pass `lint:design` (zero raw `#hex` literals, zero Tailwind gray/zinc/slate/neutral/stone classes, zero raw UI emojis, zero `node:*` imports, and barrel-only cross-feature imports).

---

## 6. Testing & Verification Plan

### 6.1 Automated Tests
1. **Update existing chat test:** Update `vscode/webview/src/features/chat/__tests__/chat.test.tsx` for the calm `Worked for 14s` header and live auto-expand behavior.
2. **Add `vscode/webview/src/lib/__tests__/harness-adapter.test.ts`:** Cover `batch` unpacking, `tool_exec` + `promote-note`, phase group titles, `provider_guardrail`, `turnCompleted` dedupe, and `mapHistoryMessagesToTurns` (hidden recovery filtering, `\u2063` reasoning split, synthetic message folding, tool call summaries, `responseStats`, and user `images`).
3. **Add `vscode/webview/src/features/chat/__tests__/liveTracePersistence.test.tsx`:** Cover the 1s elapsed timer, live stream survival across route and session switches, `turn_done` auto-collapse, and `Background Alt+B` visibility.
4. **Add `vscode/webview/src/features/composer/__tests__/composerSlashSkills.test.tsx`:** Cover mid-sentence `/skill` triggering, preserving surrounding text on selection, caret restoration, and `@` mention precedence.
5. **Host protocol test coverage:** Verify `HistoryMessageViewSchema` accepts both minimal legacy payloads and enriched history fields in `test:host`.

### 6.2 Mandatory Verification Commands
Run all gates from repository root after implementation:

```bash
npm run typecheck --workspace @rayu-dev/rayucode-vscode
npm run lint:design --workspace @rayu-dev/rayucode-vscode
npm test --workspace @rayu-dev/rayucode-vscode
npm run build:vscode
npm run package:vscode
```
