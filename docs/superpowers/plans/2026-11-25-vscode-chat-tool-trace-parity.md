# VS Code Chat, Live Tool Trace & Composer Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Desktop's Codex-style live tool-call trace, 1-second elapsed timer, `batch` unpacking, root-level stream persistence, clean history hydration, and mid-sentence `/skill` composer to `vscode/` while keeping VS Code's native `openFile` and `Background Alt+B` actions.

**Architecture:** Approach A (direct modular port into `vscode/`). Extend `vscodeProtocol.ts` and `SessionHub.getHistory` so full history metadata (`tool`, `responseStats`, `origin`, `visibility`, attempt provenance, `images`) survives the Extension Host boundary; upgrade `vscode/webview/src/lib/harness-adapter.ts` for `batch` unpacking, `tool_exec`, `promote-note`, `provider_guardrail`, and clean history reconstruction; mount a root Zustand `useLiveTraceStore` + `<LiveTraceController />` in `App.tsx`; align `WorkTrace`, `ChatStream`, and `EditorialMarkdown` with Desktop's calm monochrome trace; and add cursor-aware mid-sentence `/skill` autocomplete in `SessionComposer.tsx`.

**Tech Stack:** TypeScript 5.7, React 19, Zustand 5, TanStack Query v5, Zod 4, Tailwind CSS v4, Vitest 3, Node `node:test`, Vite 6, esbuild.

## Global Constraints

- Zero raw `#hex`, zero arbitrary Tailwind color utilities (`bg-[#...]`), zero Tailwind default gray classes (`zinc`/`slate`/`gray`/`neutral`/`stone`), zero raw UI emojis (`\p{Extended_Pictographic}`), and zero `node:*` imports inside `vscode/webview/src/**/*.{ts,tsx}`.
- Cross-feature imports inside `vscode/webview/src/features/` must go strictly through `@/features/<name>` barrels.
- Never stage or modify unrelated dirty files in the working tree (`Cargo.lock`, `crates/*`, `.agents/*`, `desktop/docs/`, `skills-lock.json`).
- Keep VS Code's native `postToHost({ type: "rayucode.editor.openFile" })` jumps, `ApprovalCard` `riskTier` badges, `TurnFileSummaryCard`, and `Background Alt+B` button intact.
- Mandatory verification commands from repo root:
  - `npm run typecheck --workspace @rayu-dev/rayucode-vscode`
  - `npm run lint:design --workspace @rayu-dev/rayucode-vscode`
  - `npm test --workspace @rayu-dev/rayucode-vscode`
  - `npm run build:vscode`
  - `npm run package:vscode`

---

## File Structure

- **Modify:** `vscode/shared/vscodeProtocol.ts`: Add `HistoryResponseStatsViewSchema` and optional provenance/stats/toolId fields on `HistoryMessageViewSchema`.
- **Modify:** `vscode/host/runtime/featureRouters.ts`: Export pure `mapRawHistoryMessage` helper mapping raw SDK history messages and images into `HistoryMessageView`.
- **Modify:** `vscode/host/runtime/sessionHub.ts`: Use `mapRawHistoryMessage` inside `SessionHub.getHistory`.
- **Modify:** `vscode/test/featureRouters.test.ts`: Unit tests for `HistoryMessageViewSchema` and `mapRawHistoryMessage`.
- **Modify:** `vscode/webview/src/lib/harness-adapter.ts`: Add `TraceTimelineItem`, `TurnOutcome`, `TurnAttempt`, `HiddenInternalMessage`, `batch` unpacking, `tool_exec` + `promote-note`, phase group titles, `provider_guardrail`, `turnCompleted` dedupe, and upgraded `mapHistoryMessagesToTurns`.
- **Create:** `vscode/webview/src/lib/__tests__/harness-adapter.test.ts`: Unit tests for live frame mapping and history turn reconstruction.
- **Create:** `vscode/webview/src/features/chat/hooks/liveTraceStore.ts`: Root Zustand `useLiveTraceStore`, 1-second shared elapsed timer, 16ms `createStreamBatcher` dispatch, pure `applyTraceEvents`, `chatHistoryQueryKey`, and `<LiveTraceController />`.
- **Modify:** `vscode/webview/src/features/chat/index.ts`: Re-export `liveTraceStore` public symbols.
- **Modify:** `vscode/webview/src/App.tsx`: Mount `<LiveTraceController />` once at app root and call `startSessionLiveTurn` when submitting from workspace.
- **Modify:** `vscode/webview/src/features/composer/components/HomePage.tsx`: Start root live turn when submitting from HomePage.
- **Modify:** `vscode/webview/src/features/chat/hooks/useChatStream.ts`: Refactor into a thin consumer over `useLiveTraceStore` + TanStack Query `sessions.history`.
- **Create:** `vscode/webview/src/features/chat/__tests__/liveTracePersistence.test.tsx`: Component/store tests for 1s timer, route/session persistence, and `turn_done` commit.
- **Modify:** `vscode/webview/src/features/chat/components/WorkTrace.tsx`: Live auto-expand + finished auto-collapse, calm `Working · Xs` / `Worked for Xs` header, `timeline` rendering, monochrome underlined file links, preserved `Background Alt+B`.
- **Modify:** `vscode/webview/src/features/chat/components/ChatStream.tsx`: Pass `timeline={turn.timeline}` to `<WorkTrace />`, auto-expand answerless finished traces, gate `TurnFileSummaryCard` on `!turn.isLive`.
- **Modify:** `vscode/webview/src/features/chat/components/EditorialMarkdown.tsx`: Single theme accent (`text-brand-text hover:bg-brand-soft/60`) for inline file/folder code spans and neutral language badge (`text-muted-ink bg-active/70`).
- **Modify:** `vscode/webview/src/features/chat/__tests__/chat.test.tsx`: Update header summary assertion (`Worked for 14s`) and add tests for live auto-expand, timeline interleaving, and monochrome file links.
- **Modify:** `vscode/webview/src/features/composer/components/SessionComposer.tsx`: Add cursor-aware `getActiveSlashTrigger` and `applySlashSelection` for mid-sentence `/skill` completion.
- **Create:** `vscode/webview/src/features/composer/__tests__/composerSlashSkills.test.tsx`: Tests for mid-sentence `/skill` trigger, caret preservation, and `@` mention precedence.

---

### Task 1: Extend History Protocol & Extension Host Mapping

**Files:**
- Modify: `vscode/shared/vscodeProtocol.ts:226-248`
- Modify: `vscode/host/runtime/featureRouters.ts:290-335`
- Modify: `vscode/host/runtime/sessionHub.ts:39-55,735-755`
- Test: `vscode/test/featureRouters.test.ts:1675-1689`

**Interfaces:**
- Consumes: `HistoryMessage` from `@rayu-dev/rayucode-sdk` (`role`, `content`, `tool`, `response_stats`, plus optional provenance fields).
- Produces: `HistoryResponseStatsViewSchema`, `HistoryResponseStatsView`, extended `HistoryMessageViewSchema`, and pure `mapRawHistoryMessage(raw: Record<string, unknown>, opts: { id: string; model?: string; images?: HistoryImageView[] }): HistoryMessageView` exported from `vscode/host/runtime/featureRouters.ts`.

- [ ] **Step 1: Write the failing host test**

Append to `vscode/test/featureRouters.test.ts` (and add `HistoryMessageViewSchema` to its `../shared/vscodeProtocol.js` import and `mapRawHistoryMessage` to its `../host/runtime/featureRouters.js` import):

```ts
// Add to imports at top of vscode/test/featureRouters.test.ts:
// HistoryMessageViewSchema,
// mapRawHistoryMessage,

test("HistoryMessageViewSchema and mapRawHistoryMessage forward tool, responseStats, and provenance fields", () => {
  const legacyParsed = HistoryMessageViewSchema.parse({
    id: "hist_1",
    role: "user",
    content: "hello",
  });
  assert.equal(legacyParsed.role, "user");
  assert.equal(legacyParsed.responseStats, undefined);

  const mapped = mapRawHistoryMessage(
    {
      role: "assistant",
      content: "Done",
      origin: "engine_internal",
      visibility: "hidden",
      attempt_id: "att_2",
      attempt_reason: "reassess_refusal",
      attempt_status: "answered",
      stop_reason: "end_turn",
      tool: { id: "call_1", name: "bash", input: { command: "pwd" } },
      response_stats: {
        duration_secs: 4.2,
        input_tokens: 100,
        output_tokens: 40,
        cache_read_tokens: 90,
        cache_creation_tokens: 10,
        rayu_credits: 0.15,
      },
    },
    { id: "hist_2", model: "claude-opus-4-6" },
  );

  const parsed = HistoryMessageViewSchema.parse(mapped);
  assert.equal(parsed.toolId, "call_1");
  assert.equal(parsed.toolName, "bash");
  assert.deepEqual(parsed.toolInput, { command: "pwd" });
  assert.equal(parsed.origin, "engine_internal");
  assert.equal(parsed.visibility, "hidden");
  assert.equal(parsed.attemptId, "att_2");
  assert.equal(parsed.attemptReason, "reassess_refusal");
  assert.equal(parsed.attemptStatus, "answered");
  assert.equal(parsed.stopReason, "end_turn");
  assert.equal(parsed.responseStats?.durationSecs, 4.2);
  assert.equal(parsed.responseStats?.cacheReadTokens, 90);
  assert.equal(parsed.responseStats?.rayuCredits, 0.15);
});
```

- [ ] **Step 2: Run host test to verify it fails**

Run: `npm run test:host --workspace @rayu-dev/rayucode-vscode`
Expected: FAIL because `mapRawHistoryMessage` is not exported and `HistoryMessageViewSchema` strips `toolId`, `origin`, `visibility`, `attempt*`, and `responseStats`.

- [ ] **Step 3: Extend `HistoryMessageViewSchema` in `vscode/shared/vscodeProtocol.ts`**

Replace lines 232-242 of `vscode/shared/vscodeProtocol.ts`:

```ts
export const HistoryResponseStatsViewSchema = z.object({
  durationSecs: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
  rayuCredits: z.number().optional(),
});
export type HistoryResponseStatsView = z.infer<typeof HistoryResponseStatsViewSchema>;

export const HistoryMessageViewSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  createdAtMs: z.number().optional(),
  model: z.string().optional(),
  toolId: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.unknown().optional(),
  origin: z.string().optional(),
  visibility: z.string().optional(),
  attemptId: z.string().nullable().optional(),
  attemptReason: z.string().optional(),
  attemptStatus: z.string().optional(),
  stopReason: z.string().nullable().optional(),
  responseStats: HistoryResponseStatsViewSchema.optional(),
  images: z.array(HistoryImageViewSchema).optional(),
});
export type HistoryMessageView = z.infer<typeof HistoryMessageViewSchema>;
```

- [ ] **Step 4: Implement `mapRawHistoryMessage` in `vscode/host/runtime/featureRouters.ts` and wire `SessionHub.getHistory`**

Import `type HistoryImageView`, `type HistoryMessageView`, `type HistoryResponseStatsView` in `vscode/host/runtime/featureRouters.ts`, and export `mapRawHistoryMessage`:

```ts
function mapRawResponseStats(raw: unknown): HistoryResponseStatsView | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const durationSecs = typeof r.duration_secs === "number" ? r.duration_secs : undefined;
  const inputTokens = typeof r.input_tokens === "number" ? r.input_tokens : undefined;
  const outputTokens = typeof r.output_tokens === "number" ? r.output_tokens : undefined;
  const cacheReadTokens = typeof r.cache_read_tokens === "number" ? r.cache_read_tokens : undefined;
  const cacheCreationTokens =
    typeof r.cache_creation_tokens === "number" ? r.cache_creation_tokens : undefined;
  const rayuCredits = typeof r.rayu_credits === "number" ? r.rayu_credits : undefined;
  if (
    durationSecs === undefined &&
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheCreationTokens === undefined &&
    rayuCredits === undefined
  ) {
    return undefined;
  }
  return {
    ...(durationSecs !== undefined ? { durationSecs } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    ...(rayuCredits !== undefined ? { rayuCredits } : {}),
  };
}

export function mapRawHistoryMessage(
  raw: Record<string, unknown>,
  opts: { id: string; model?: string; images?: HistoryImageView[] },
): HistoryMessageView {
  const toolObj =
    raw.tool && typeof raw.tool === "object" && !Array.isArray(raw.tool)
      ? (raw.tool as Record<string, unknown>)
      : null;
  const responseStats = mapRawResponseStats(raw.response_stats);
  return {
    id: opts.id,
    role: typeof raw.role === "string" ? raw.role : "assistant",
    content: typeof raw.content === "string" ? raw.content : "",
    ...(opts.model ? { model: opts.model } : {}),
    ...(typeof toolObj?.id === "string" ? { toolId: toolObj.id } : {}),
    ...(typeof toolObj?.name === "string" ? { toolName: toolObj.name } : {}),
    ...(toolObj && toolObj.input !== undefined ? { toolInput: toolObj.input } : {}),
    ...(typeof raw.origin === "string" ? { origin: raw.origin } : {}),
    ...(typeof raw.visibility === "string" ? { visibility: raw.visibility } : {}),
    ...(raw.attempt_id === null || typeof raw.attempt_id === "string"
      ? { attemptId: raw.attempt_id }
      : {}),
    ...(typeof raw.attempt_reason === "string" ? { attemptReason: raw.attempt_reason } : {}),
    ...(typeof raw.attempt_status === "string" ? { attemptStatus: raw.attempt_status } : {}),
    ...(raw.stop_reason === null || typeof raw.stop_reason === "string"
      ? { stopReason: raw.stop_reason }
      : {}),
    ...(responseStats ? { responseStats } : {}),
    ...(opts.images && opts.images.length > 0 ? { images: opts.images } : {}),
  };
}
```

In `vscode/host/runtime/sessionHub.ts`, import `mapRawHistoryMessage` from `./featureRouters.js` and update lines 738-752:

```ts
    const messages: HistoryMessageView[] = rawMessages.map((msg, idx) =>
      mapRawHistoryMessage(msg as unknown as Record<string, unknown>, {
        id: `hist_${sessionId}_${idx}`,
        model:
          msg.role === "assistant" && sessionId === this.activeSessionId
            ? this.activeModel
            : undefined,
        images: imagesByMessageIndex.get(idx),
      }),
    );
```

- [ ] **Step 5: Run host tests and typecheck to verify pass**

Run: `npm run test:host --workspace @rayu-dev/rayucode-vscode && npm run typecheck --workspace @rayu-dev/rayucode-vscode`
Expected: PASS (0 failures, 0 TS errors).

- [ ] **Step 6: Commit Task 1**

```bash
git add vscode/shared/vscodeProtocol.ts vscode/host/runtime/featureRouters.ts vscode/host/runtime/sessionHub.ts vscode/test/featureRouters.test.ts
git commit -m "feat(vscode): forward full history tool, stats, and provenance metadata"
```

---

### Task 2: Upgrade `harness-adapter.ts` for Batch Unpacking, Timeline, Guardrails & Clean History

**Files:**
- Modify: `vscode/webview/src/lib/harness-adapter.ts`
- Create: `vscode/webview/src/lib/__tests__/harness-adapter.test.ts`

**Interfaces:**
- Consumes: `HistoryMessageView`, `PermissionModeId`, `RiskTier` from `@shared/vscodeProtocol`; `basenameOf`, `formatDurationSeconds` from `./utils`.
- Produces: `TraceTimelineItem`, `TurnOutcome`, `TurnAttemptReason`, `TurnAttempt`, `HiddenInternalMessage`, `ExecutionTurn` (extended with `timeline?`, `outcome?`, `attempts?`, `finalAttemptId?`, `hiddenInternalMessages?`, `userImages?`), `HarnessHistoryMessageLike` (accepting both camelCase `HistoryMessageView` and snake_case daemon payloads), `HarnessStreamTracker`, `mapHarnessFrameToLiveEvents`, and `mapHistoryMessagesToTurns`.

- [ ] **Step 1: Write failing tests in `vscode/webview/src/lib/__tests__/harness-adapter.test.ts`**

```ts
import { describe, expect, it } from "vitest";

import {
  createHarnessStreamTracker,
  mapHarnessFrameToLiveEvents,
  mapHistoryMessagesToTurns,
} from "../harness-adapter";

describe("vscode harness-adapter", () => {
  it("unpacks batch tool calls, promotes prose on tool_exec, and deduplicates turn completion", () => {
    const tracker = createHarnessStreamTracker();

    expect(
      mapHarnessFrameToLiveEvents({ ev: "turn_start" }, tracker),
    ).toEqual([]);

    const deltaEvents = mapHarnessFrameToLiveEvents(
      { ev: "text_delta", text: "Let me inspect the workspace first." },
      tracker,
    );
    expect(deltaEvents).toEqual([
      { type: "answer-delta", delta: "Let me inspect the workspace first." },
    ]);

    const execEvents = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_exec",
        call_id: "call_batch_1",
        name: "batch",
        input: {
          tool_calls: [
            { tool: "read_file", path: "src/app.ts", start_line: 10, end_line: 20 },
            { tool: "grep", pattern: "ShardStore" },
            { tool: "run_command", command: "cargo test" },
          ],
        },
      },
      tracker,
    );
    expect(execEvents[0]).toEqual({ type: "promote-note" });
    expect(execEvents[1]).toEqual({
      type: "tool-status",
      label: "Running 3 parallel checks...",
    });

    const batchDone = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_done",
        call_id: "call_batch_1",
        name: "batch",
        input: {
          tool_calls: [
            { tool: "read_file", path: "src/app.ts", start_line: 10, end_line: 20 },
            { tool: "grep", pattern: "ShardStore" },
            { tool: "run_command", command: "cargo test" },
          ],
        },
        output: [
          "--- [0] read_file ---",
          "fn main() {}",
          "--- [1] grep ---",
          "src/lookup.rs:42",
          "--- [2] run_command ---",
          "test result: ok.",
        ].join("\n"),
      },
      tracker,
    );

    const stepEvents = batchDone.filter((e) => e.type === "step");
    expect(stepEvents).toHaveLength(3);
    expect(stepEvents[0]).toMatchObject({
      type: "step",
      groupId: "codex_work_2",
      step: { kind: "read", label: "Read" },
    });
    expect(stepEvents[1]).toMatchObject({
      type: "step",
      groupId: "codex_work_2",
      step: { kind: "search", text: "Searched for", highlight: "ShardStore" },
    });
    expect(stepEvents[2]).toMatchObject({
      type: "step",
      groupId: "codex_work_2",
      groupTitle: "Read files, ran commands",
      step: { kind: "command", command: "cargo test", output: "test result: ok." },
    });

    const permEvents = mapHarnessFrameToLiveEvents(
      {
        ev: "permission_request",
        session_id: "ses_1",
        request_id: "perm_1",
        tool_name: "bash",
        description: "Run cargo test?",
        risk_tier: "confirm",
      },
      tracker,
    );
    expect(permEvents).toEqual([
      {
        type: "permission-request",
        sessionId: "ses_1",
        requestId: "perm_1",
        toolName: "bash",
        description: "Run cargo test?",
        riskTier: "confirm",
      },
    ]);

    const guardrailEvents = mapHarnessFrameToLiveEvents(
      { ev: "provider_guardrail", message: "Request declined by policy." },
      tracker,
    );
    expect(guardrailEvents).toEqual([
      { type: "answer-delta", delta: "\n\nRequest declined by policy." },
    ]);

    const done1 = mapHarnessFrameToLiveEvents({ ev: "turn_done" }, tracker);
    const done2 = mapHarnessFrameToLiveEvents({ ev: "turn_done" }, tracker);
    expect(done1.some((e) => e.type === "complete")).toBe(true);
    expect(done2).toEqual([]);
  });

  it("cleans hidden recovery prompts, splits reasoning sentinels, and maps tool/stats/images in history", () => {
    const turns = mapHistoryMessagesToTurns("ses_hist", [
      {
        role: "user",
        content: "Inspect lookup.rs",
        images: [{ mediaType: "image/png", data: "YWJj" }],
      },
      {
        role: "user",
        origin: "engine_internal",
        visibility: "hidden",
        content: "Reassess the user's request using its full context.",
      },
      {
        role: "assistant",
        content: "*\u2063Checking lookup.rs first.\u2063*\n\nStarting check.",
      },
      {
        role: "tool",
        toolName: "bash",
        toolInput: { command: "cargo test lookup" },
        content: "6 passed",
      },
      {
        role: "user",
        content: "Base directory for this skill: /repo/.agents/skills/brainstorming\n...",
      },
      {
        role: "assistant",
        content: "All 6 lookup tests pass.",
        responseStats: {
          durationSecs: 12,
          inputTokens: 100,
          cacheReadTokens: 900,
          rayuCredits: 0.35,
        },
      },
    ]);

    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.userPrompt).toBe("Inspect lookup.rs");
    expect(turn.userImages).toEqual([
      { name: "Attachment", dataUrl: "data:image/png;base64,YWJj" },
    ]);
    expect(turn.hiddenInternalMessages).toHaveLength(1);
    expect(turn.notes).toEqual(["Checking lookup.rs first.", "Starting check."]);
    expect(turn.groups[0]?.steps).toHaveLength(2);
    expect(turn.groups[0]?.steps[0]).toMatchObject({
      kind: "command",
      command: "cargo test lookup",
      displayCommand: "bash cargo test lookup",
      output: "6 passed",
    });
    expect(turn.groups[0]?.steps[1]).toMatchObject({
      kind: "command",
      statusLabel: "Loaded",
    });
    expect(turn.answerIntro).toBe("All 6 lookup tests pass.");
    expect(turn.workedDuration).toBe("12s");
    expect(turn.credits).toBe("0.35 cr");
    expect(turn.kvCachePct).toBe(90);
  });
});
```

- [ ] **Step 2: Run unit test to verify it fails**

Run: `cd vscode && npx vitest run webview/src/lib/__tests__/harness-adapter.test.ts`
Expected: FAIL (`batch` not unpacked, `tool_exec` ignored, `responseStats` and `origin` ignored).

- [ ] **Step 3: Update `vscode/webview/src/lib/harness-adapter.ts`**

Keep every existing exported symbol (`ModelOption`, `FileReadTarget`, `FileReadStep`, `PreviewStepItem`, `ListStep`, `ShellCommandStep`, `TraceStepItem`, `WorkStepGroup`, `InlineDiffLine`, `InlineDiffCardData`, `TurnOutputArtifact`, `ExecutionTurn`, `HarnessModelRouteLike`, `HarnessHistoryMessageLike`, `PendingPermissionRequest`, `MappedLiveTraceEvent`, `describeActiveTool`, `mapModelRoutesToOptions`, `mapHistoryMessagesToTurns`, `HarnessStreamTracker`, `createHarnessStreamTracker`, `mapHarnessFrameToLiveEvents`, `formatDurationSeconds`) and add the new Desktop parity exports and behaviors:

1. Add types:
```ts
export type TraceTimelineItem =
  | { type: "note"; id: string; text: string }
  | { type: "group"; group: WorkStepGroup };

export type TurnOutcome = "answered" | "answered_partial" | "declined" | "failed";
export type TurnAttemptReason = "initial" | "reassess_refusal" | "reassess_incomplete" | "recovery";

export interface TurnAttempt {
  id: string;
  reason: TurnAttemptReason;
  status: TurnOutcome;
  answerText: string;
  stopReason?: string | null;
}

export interface HiddenInternalMessage {
  origin: string;
  visibility: string;
  content: string;
}
```
2. Extend `ExecutionTurn` with optional `timeline?: TraceTimelineItem[]`, `userImages?: Array<{ name: string; dataUrl: string }>`, `outcome?: TurnOutcome`, `attempts?: TurnAttempt[]`, `finalAttemptId?: string | null`, and `hiddenInternalMessages?: HiddenInternalMessage[]`.
3. Extend `HarnessHistoryMessageLike` with optional camelCase + snake_case fields (`toolId`, `toolName`, `toolInput`, `tool`, `origin`, `visibility`, `attemptId`, `attempt_id`, `attemptReason`, `attempt_reason`, `attemptStatus`, `attempt_status`, `stopReason`, `stop_reason`, `responseStats`, `response_stats`, `images`).
4. Update `describeActiveTool(name, args, intent)` to support `batch`, `edit`/`write`/`apply_patch`, `glob`/`find_files`, `webfetch`/`websearch`, `todo`/`todowrite`, `create_powerpoint`, `write_excel`/`read_excel`, and `browser_*` while preserving explicit `intent`.
5. Port `splitReasoningFromAssistantContent`, `classifySyntheticUserMessage`, `isEngineInternalRecoveryPrompt`, `summarizeHistoryToolCall` (reading both `msg.tool` and `msg.toolName`/`msg.toolInput`), `resolveAttemptStatus`, and `mapHistoryMessagesToTurns` (handling `responseStats ?? response_stats`, `images`, and `attemptId ?? attempt_id`).
6. Port `splitBatchOutputSections`, `extractBatchSubcallArgs`, `mapSingleWorkStep`, `resetTrackerPhase`, `computePhaseGroupTitle`, and update `mapHarnessFrameToLiveEvents` to handle `tool_exec`, `batch` unpacking, `create_powerpoint`, `write_excel`/`read_excel`, `browser_*`, `provider_guardrail`, `hasStreamedTextInPhase` auto-`promote-note`, `turnCompleted` dedupe, and VS Code `riskTier` on `permission_request`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vscode && npx vitest run webview/src/lib/__tests__/harness-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add vscode/webview/src/lib/harness-adapter.ts vscode/webview/src/lib/__tests__/harness-adapter.test.ts
git commit -m "feat(vscode): upgrade harness-adapter with batch unpacking, timeline, and clean history"
```

---

### Task 3: Root `liveTraceStore.ts`, `<LiveTraceController />` & Thin `useChatStream.ts`

**Files:**
- Create: `vscode/webview/src/features/chat/hooks/liveTraceStore.ts`
- Modify: `vscode/webview/src/features/chat/index.ts`
- Modify: `vscode/webview/src/App.tsx:15-21,213-273,411-432`
- Modify: `vscode/webview/src/features/composer/components/HomePage.tsx:188-212`
- Modify: `vscode/webview/src/features/chat/hooks/useChatStream.ts`
- Create: `vscode/webview/src/features/chat/__tests__/liveTracePersistence.test.tsx`

**Interfaces:**
- Consumes: `createHarnessStreamTracker`, `formatDurationSeconds`, `mapHarnessFrameToLiveEvents`, `mapHistoryMessagesToTurns`, `createStreamBatcher`, `onHarnessFrame`, `useAppStore`, `callRpc`, `sendHarnessRequest`, `isVsCodeWebview` from `@/lib`; `ChatTurnView` from `./useChatStream`.
- Produces: `chatHistoryQueryKey(sessionId)`, `applyTraceEvents(current, events)`, `useLiveTraceStore`, `startSessionLiveTurn`, `clearSessionLiveTurn`, `resetAllLiveTraces`, `processHarnessFrame`, `LiveTraceController` (exported via `vscode/webview/src/features/chat/index.ts`), plus refactored `useChatStream`.

- [ ] **Step 1: Write the failing persistence & timer test**

Create `vscode/webview/src/features/chat/__tests__/liveTracePersistence.test.tsx`:

```tsx
import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __dispatchHostMessageForTest,
  createQueryClient,
  useAppStore,
} from "@/lib";

import {
  ChatWorkspaceView,
  LiveTraceController,
  resetAllLiveTraces,
  startSessionLiveTurn,
} from "../index";

describe("VS Code live trace persistence and shared 1s timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllLiveTraces();
    useAppStore.setState({
      activeSessionId: "ses_live_1",
      pendingPermission: null,
      isStreamActive: false,
      pendingUserTurn: null,
      fileChangesBySession: {},
    });
  });

  afterEach(() => {
    resetAllLiveTraces();
    vi.useRealTimers();
  });

  it("ticks Working duration every 1s, survives route/view unmount, and commits on turn_done", () => {
    const client = createQueryClient();

    const Harness = ({ showChat, sessionId }: { showChat: boolean; sessionId: string }) => (
      <QueryClientProvider client={client}>
        <LiveTraceController />
        {showChat ? <ChatWorkspaceView sessionId={sessionId} /> : <div data-testid="other-route" />}
      </QueryClientProvider>
    );

    const { rerender } = render(<Harness showChat sessionId="ses_live_1" />);

    act(() => {
      startSessionLiveTurn({
        sessionId: "ses_live_1",
        userPrompt: "Run tests and explain",
      });
    });

    expect(screen.getByTestId("work-trace-summary").textContent).toBe("Working · 1s");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("work-trace-summary").textContent).toBe("Working · 4s");

    // Navigate away from chat to another route (unmounts ChatWorkspaceView, keeps LiveTraceController)
    rerender(<Harness showChat={false} sessionId="ses_live_1" />);
    expect(screen.getByTestId("other-route")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "tool_done",
          session_id: "ses_live_1",
          call_id: "c_1",
          name: "bash",
          input: { command: "cargo test" },
          output: "ok",
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "text_delta",
          session_id: "ses_live_1",
          text: "Streamed while on another route.",
        },
      });
      vi.advanceTimersByTime(20);
    });

    // Switch to another session and back
    rerender(<Harness showChat sessionId="ses_other" />);
    rerender(<Harness showChat sessionId="ses_live_1" />);

    expect(screen.getByText("Streamed while on another route.")).toBeTruthy();
    expect(screen.getByTestId("work-trace-live-bg-btn")).toBeTruthy();

    // Finish turn while mounted (and verify second turn_done does not duplicate)
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_done", session_id: "ses_live_1" },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_done", session_id: "ses_live_1" },
      });
      vi.advanceTimersByTime(20);
    });

    expect(screen.getAllByText("Streamed while on another route.")).toHaveLength(1);
    expect(screen.getByTestId("work-trace").getAttribute("data-live")).toBe("false");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vscode && npx vitest run webview/src/features/chat/__tests__/liveTracePersistence.test.tsx`
Expected: FAIL (`LiveTraceController`, `resetAllLiveTraces`, `startSessionLiveTurn` do not exist).

- [ ] **Step 3: Create `vscode/webview/src/features/chat/hooks/liveTraceStore.ts`**

```tsx
import * as React from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import {
  createHarnessStreamTracker,
  createStreamBatcher,
  formatDurationSeconds,
  mapHarnessFrameToLiveEvents,
  onHarnessFrame,
  useAppStore,
  type HarnessStreamTracker,
  type InlineDiffCardData,
  type MappedLiveTraceEvent,
  type OptimisticUserTurn,
  type StreamBatcher,
} from "@/lib";

import type { ClarifyingQuestionRequest } from "../components/ClarifyingQuestionCard";
import type { ChatTurnView } from "./useChatStream";

const FRAME_BATCH_WINDOW_MS = 16;

const EMPTY_DIFF: InlineDiffCardData = {
  id: "diff_live_empty",
  file: "",
  additions: 0,
  deletions: 0,
  hint: "",
  lines: [],
};

export function chatHistoryQueryKey(sessionId: string) {
  return ["chat", "history", sessionId] as const;
}

export interface StartSessionLiveTurnInput {
  sessionId: string;
  userPrompt: string;
  userRefFiles?: string;
  userImages?: Array<{ name: string; dataUrl: string }>;
  startedAtMs?: number;
}

interface LiveTraceStoreState {
  liveTurnsBySession: Record<string, ChatTurnView>;
  completedTurnsBySession: Record<string, ChatTurnView[]>;
  pendingQuestionsBySession: Record<string, ClarifyingQuestionRequest | null>;
}

export const useLiveTraceStore = create<LiveTraceStoreState>(() => ({
  liveTurnsBySession: {},
  completedTurnsBySession: {},
  pendingQuestionsBySession: {},
}));

const trackersBySession = new Map<string, HarnessStreamTracker>();
const batchersBySession = new Map<string, StreamBatcher<MappedLiveTraceEvent>>();
const startedAtBySession = new Map<string, number>();
const completedTurnIds = new Set<string>();
let turnSequence = 1;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let controllerMountCount = 0;

function stopElapsedTimerIfIdle(): void {
  if (!elapsedTimer) return;
  const hasLive = Object.values(
    useLiveTraceStore.getState().liveTurnsBySession,
  ).some((turn) => turn.isLive);
  if (!hasLive) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function ensureElapsedTimer(): void {
  if (elapsedTimer) return;
  elapsedTimer = setInterval(() => {
    const state = useLiveTraceStore.getState();
    const entries = Object.entries(state.liveTurnsBySession);
    if (entries.length === 0) {
      stopElapsedTimerIfIdle();
      return;
    }
    let changed = false;
    const nextMap: Record<string, ChatTurnView> = { ...state.liveTurnsBySession };
    for (const [sid, turn] of entries) {
      if (!turn.isLive) continue;
      const startedAt = startedAtBySession.get(sid) ?? Date.now();
      const nextSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      const formatted = formatDurationSeconds(nextSec);
      if (turn.workedDuration !== formatted) {
        nextMap[sid] = { ...turn, workedDuration: formatted };
        changed = true;
      }
    }
    if (changed) {
      useLiveTraceStore.setState({ liveTurnsBySession: nextMap });
    }
    stopElapsedTimerIfIdle();
  }, 1000);
}

function getOrCreateTracker(sessionId: string): HarnessStreamTracker {
  let tracker = trackersBySession.get(sessionId);
  if (!tracker) {
    tracker = createHarnessStreamTracker();
    trackersBySession.set(sessionId, tracker);
  }
  return tracker;
}

export function applyTraceEvents(
  current: ChatTurnView | null,
  events: MappedLiveTraceEvent[],
): ChatTurnView | null {
  if (!current || events.length === 0) return current;

  let next: ChatTurnView = {
    ...current,
    notes: [...current.notes],
    groups: current.groups.map((g) => ({ ...g, steps: [...g.steps] })),
    timeline: current.timeline
      ? current.timeline.map((entry) =>
          entry.type === "group"
            ? { type: "group", group: { ...entry.group, steps: [...entry.group.steps] } }
            : { ...entry },
        )
      : [],
    artifacts: current.artifacts ? [...current.artifacts] : undefined,
  };

  for (const ev of events) {
    switch (ev.type) {
      case "note":
        next.notes.push(ev.text);
        next.timeline?.push({
          type: "note",
          id: `note_${next.timeline.length + 1}`,
          text: ev.text,
        });
        break;
      case "promote-note": {
        const pendingText = next.answerIntro.trim();
        if (pendingText) {
          next.notes.push(pendingText);
          next.timeline?.push({
            type: "note",
            id: `note_${next.timeline.length + 1}`,
            text: pendingText,
          });
          next.answerIntro = "";
        }
        break;
      }
      case "tool-status":
        next.activeToolStatus = ev.label;
        next.showLiveBackgroundPill = Boolean(
          ev.label &&
            /running command|cargo|npm|pnpm|pytest|bash|shell/i.test(ev.label),
        );
        break;
      case "step": {
        const gId = ev.groupId ?? next.groups[next.groups.length - 1]?.id ?? "wg_live";
        const gTitle = ev.groupTitle ?? "Read files, ran commands";
        const idx = next.groups.findIndex((g) => g.id === gId);
        if (idx === -1) {
          const created = { id: gId, title: gTitle, steps: [ev.step] };
          next.groups.push(created);
          next.timeline?.push({
            type: "group",
            group: { ...created, steps: [...created.steps] },
          });
        } else {
          const existing = next.groups[idx]!;
          const updated = {
            ...existing,
            title: ev.groupTitle ?? existing.title,
            steps: [...existing.steps, ev.step],
          };
          next.groups[idx] = updated;
          if (next.timeline) {
            const tlIdx = next.timeline.findIndex(
              (entry) => entry.type === "group" && entry.group.id === gId,
            );
            if (tlIdx !== -1) {
              next.timeline[tlIdx] = {
                type: "group",
                group: { ...updated, steps: [...updated.steps] },
              };
            }
          }
        }
        break;
      }
      case "artifact":
        next.artifacts = [...(next.artifacts ?? []), ev.artifact];
        break;
      case "answer-delta":
        next.answerIntro = `${next.answerIntro}${ev.delta}`;
        break;
      case "duration":
        next.workedDuration = ev.workedDuration;
        break;
      case "complete":
        next = {
          ...next,
          isLive: false,
          activeToolStatus: null,
          showLiveBackgroundPill: false,
          workedDuration: ev.workedDuration || next.workedDuration,
          credits: ev.credits ?? next.credits,
          kvCachePct: ev.kvCachePct ?? next.kvCachePct,
          timestamp: ev.timestamp ?? "Just now",
        };
        break;
      default:
        break;
    }
  }

  return next;
}

export function startSessionLiveTurn(input: StartSessionLiveTurnInput): ChatTurnView {
  const startedAt =
    typeof input.startedAtMs === "number" && input.startedAtMs > 0
      ? input.startedAtMs
      : Date.now();
  startedAtBySession.set(input.sessionId, startedAt);
  const tracker = getOrCreateTracker(input.sessionId);
  tracker.startedAtMs = startedAt;
  tracker.turnActive = true;
  tracker.turnCompleted = false;
  tracker.batchEpoch = 1;
  tracker.hasStreamedTextInPhase = false;
  tracker.phaseHasReads = false;
  tracker.phaseHasCommands = false;
  tracker.phaseHasSearches = false;
  tracker.phaseCommandCount = 0;
  tracker.toolInputs.clear();

  const turn: ChatTurnView = {
    id: `live_turn_${Date.now()}_${turnSequence++}`,
    sessionId: input.sessionId,
    userPrompt: input.userPrompt,
    userRefFiles: input.userRefFiles,
    userImages: input.userImages,
    workedDuration: formatDurationSeconds(
      Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
    ),
    isLive: true,
    notes: [],
    groups: [],
    timeline: [],
    activeToolStatus: null,
    answerIntro: "",
    answerBullets: [],
    diffCard: EMPTY_DIFF,
    timestamp: "Just now",
    credits: "0.00 cr",
    kvCachePct: 94,
    pinned: false,
  };

  useLiveTraceStore.setState((state) => ({
    liveTurnsBySession: {
      ...state.liveTurnsBySession,
      [input.sessionId]: turn,
    },
  }));
  ensureElapsedTimer();
  return turn;
}

export function startLiveTurnFromOptimistic(turn: OptimisticUserTurn): ChatTurnView {
  return startSessionLiveTurn({
    sessionId: turn.sessionId,
    userPrompt: turn.prompt,
    userRefFiles: turn.refFiles,
    userImages: turn.images,
    startedAtMs: turn.createdAtMs,
  });
}

export function setSessionPendingQuestion(
  sessionId: string,
  question: ClarifyingQuestionRequest | null,
): void {
  if (!sessionId) return;
  useLiveTraceStore.setState((state) => ({
    pendingQuestionsBySession: {
      ...state.pendingQuestionsBySession,
      [sessionId]: question,
    },
  }));
}

export function clearSessionLiveTurn(sessionId: string): void {
  if (!sessionId) return;
  const batcher = batchersBySession.get(sessionId);
  if (batcher) {
    batcher.dispose();
    batchersBySession.delete(sessionId);
  }
  startedAtBySession.delete(sessionId);
  trackersBySession.delete(sessionId);
  useLiveTraceStore.setState((state) => {
    if (!(sessionId in state.liveTurnsBySession)) return state;
    const nextMap = { ...state.liveTurnsBySession };
    delete nextMap[sessionId];
    return { liveTurnsBySession: nextMap };
  });
  stopElapsedTimerIfIdle();
}

export function resetAllLiveTraces(): void {
  for (const batcher of batchersBySession.values()) {
    batcher.dispose();
  }
  batchersBySession.clear();
  trackersBySession.clear();
  startedAtBySession.clear();
  completedTurnIds.clear();
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  useLiveTraceStore.setState({
    liveTurnsBySession: {},
    completedTurnsBySession: {},
    pendingQuestionsBySession: {},
  });
}

function getOrCreateBatcher(
  sessionId: string,
  queryClient: QueryClient,
): StreamBatcher<MappedLiveTraceEvent> {
  const existing = batchersBySession.get(sessionId);
  if (existing) return existing;

  const batcher = createStreamBatcher<MappedLiveTraceEvent>((events) => {
    const current =
      useLiveTraceStore.getState().liveTurnsBySession[sessionId] ?? null;
    const updated = applyTraceEvents(current, events);
    if (!updated) return;

    const hasComplete = events.some((ev) => ev.type === "complete");
    if (hasComplete) {
      if (!completedTurnIds.has(updated.id)) {
        completedTurnIds.add(updated.id);
        useLiveTraceStore.setState((state) => {
          const prevCompleted = state.completedTurnsBySession[sessionId] ?? [];
          return {
            completedTurnsBySession: {
              ...state.completedTurnsBySession,
              [sessionId]: prevCompleted.some((t) => t.id === updated.id)
                ? prevCompleted
                : [...prevCompleted, updated],
            },
          };
        });
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
      const perm = useAppStore.getState().pendingPermission;
      if (perm && (!perm.sessionId || perm.sessionId === sessionId)) {
        useAppStore.getState().setPendingPermission(null);
      }
      clearSessionLiveTurn(sessionId);
      return;
    }

    useLiveTraceStore.setState((state) => ({
      liveTurnsBySession: {
        ...state.liveTurnsBySession,
        [sessionId]: updated,
      },
    }));
  }, FRAME_BATCH_WINDOW_MS);

  batchersBySession.set(sessionId, batcher);
  return batcher;
}

export function processHarnessFrame(
  frame: Record<string, unknown>,
  queryClient: QueryClient,
  fallbackSessionId?: string,
): void {
  const frameSession =
    typeof frame.session_id === "string" ? frame.session_id : "";
  const targetSessionId = frameSession || fallbackSessionId || "";
  if (!targetSessionId) return;

  if (frame.ev === "question_request" || frame.ev === "ask_user_question") {
    const reqId = String(frame.request_id ?? `q_${Date.now()}`);
    const prompt = String(
      frame.prompt ?? frame.question ?? "How would you like to proceed?",
    );
    const rawOpts = Array.isArray(frame.options) ? frame.options : [];
    setSessionPendingQuestion(targetSessionId, {
      requestId: reqId,
      sessionId: targetSessionId,
      prompt,
      multiSelect: Boolean(frame.multi_select),
      options:
        rawOpts.length > 0
          ? rawOpts.map((o, idx) => {
              const obj =
                o && typeof o === "object"
                  ? (o as Record<string, unknown>)
                  : { title: String(o) };
              return {
                id: String(obj.id ?? `opt_${idx + 1}`),
                key: String(obj.key ?? idx + 1),
                title: String(obj.title ?? obj.label ?? `Option ${idx + 1}`),
                subtitle:
                  typeof obj.subtitle === "string"
                    ? obj.subtitle
                    : typeof obj.description === "string"
                      ? obj.description
                      : undefined,
                recommended: Boolean(obj.recommended),
              };
            })
          : [
              {
                id: "opt_1",
                key: "1",
                title: "Proceed with recommended defaults",
                recommended: true,
              },
              {
                id: "opt_2",
                key: "2",
                title: "Review changes step-by-step first",
              },
            ],
    });
    return;
  }

  const tracker = getOrCreateTracker(targetSessionId);
  const mapped = mapHarnessFrameToLiveEvents(frame, tracker);
  if (mapped.length === 0) return;

  const traceEvents: MappedLiveTraceEvent[] = [];
  for (const ev of mapped) {
    if (ev.type === "permission-request") {
      useAppStore.getState().setPendingPermission({
        sessionId: ev.sessionId || targetSessionId,
        requestId: ev.requestId,
        toolName: ev.toolName,
        description: ev.description,
        riskTier: ev.riskTier,
      });
    } else {
      traceEvents.push(ev);
    }
  }

  if (traceEvents.length === 0) return;

  if (!useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]) {
    startSessionLiveTurn({
      sessionId: targetSessionId,
      userPrompt: "",
    });
  }

  const batcher = getOrCreateBatcher(targetSessionId, queryClient);
  for (const ev of traceEvents) {
    batcher.push(ev);
  }
  if (traceEvents.some((e) => e.type === "complete")) {
    batcher.flushNow();
  }
}

export function LiveTraceController(): null {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const pendingUserTurn = useAppStore((s) => s.pendingUserTurn);
  const isCurrentSessionStreaming = useLiveTraceStore((s) =>
    Boolean(activeSessionId && s.liveTurnsBySession[activeSessionId]?.isLive),
  );

  React.useEffect(() => {
    controllerMountCount += 1;
    const unsub = onHarnessFrame((frame) => {
      processHarnessFrame(
        frame,
        queryClient,
        useAppStore.getState().activeSessionId ?? undefined,
      );
    });
    return () => {
      unsub();
      controllerMountCount = Math.max(0, controllerMountCount - 1);
      if (controllerMountCount === 0) {
        resetAllLiveTraces();
      }
    };
  }, [queryClient]);

  React.useEffect(() => {
    if (!pendingUserTurn) return;
    startLiveTurnFromOptimistic(pendingUserTurn);
    useAppStore.getState().consumeOptimisticTurn(pendingUserTurn.id);
  }, [pendingUserTurn]);

  React.useEffect(() => {
    useAppStore.getState().setIsStreamActive(isCurrentSessionStreaming);
  }, [isCurrentSessionStreaming]);

  return null;
}
```

- [ ] **Step 4: Wire `features/chat/index.ts`, `App.tsx`, `HomePage.tsx`, and `useChatStream.ts`**

1. Export `* from "./hooks/liveTraceStore"` in `vscode/webview/src/features/chat/index.ts`.
2. Mount `<LiveTraceController />` inside `App()` in `vscode/webview/src/App.tsx` (alongside `<AppShell>`), and in `handleWorkspaceSubmit` keep `enqueueOptimisticTurn` (or call `startSessionLiveTurn` directly via `@/features/chat` barrel).
3. In `HomePage.tsx`, `enqueueOptimisticTurn` already hands the optimistic turn to `<LiveTraceController />` immediately; ensure `refFiles` and `images` are preserved.
4. Refactor `vscode/webview/src/features/chat/hooks/useChatStream.ts`:
   - Subscribe to `useLiveTraceStore((s) => sessionId ? (s.liveTurnsBySession[sessionId] ?? null) : null)` for `liveTurn` and `useLiveTraceStore((s) => sessionId ? (s.pendingQuestionsBySession[sessionId] ?? null) : null)` for `pendingQuestion`.
   - Use `useQuery` with `chatHistoryQueryKey(sessionId)` calling `callRpc("sessions.history", { sessionId })`, passing full `HistoryMessageView` objects (without stripping `toolId`, `toolName`, `toolInput`, `responseStats`, `origin`, `visibility`, `attempt*`, `images`) into `mapHistoryMessagesToTurns`.
   - Merge any locally completed turns in `completedTurnsBySession[sessionId]` not yet returned by `sessions.history`, and keep `DEFAULT_SAMPLE_TURNS` for `!isVsCodeWebview() && sessionId === "ses_vscode_shell"`.
   - Keep `sendPrompt` calling `startSessionLiveTurn` + `sendHarnessRequest`, plus `respondPermission`, `respondQuestion`, `dismissQuestion`, `backgroundActiveTool`, `rewindToTurn`, `undoRewind`, `queueSoftInterrupt`, `cancelSoftInterrupt`, `forkFromTurn`, `togglePinTurn`, `retryTurn`.

- [ ] **Step 5: Run tests to verify pass**

Run: `cd vscode && npx vitest run webview/src/features/chat/__tests__/liveTracePersistence.test.tsx webview/src/features/chat/__tests__/chat.test.tsx`
Expected: `liveTracePersistence.test.tsx` passes.

- [ ] **Step 6: Commit Task 3**

```bash
git add vscode/webview/src/features/chat/hooks/liveTraceStore.ts vscode/webview/src/features/chat/index.ts vscode/webview/src/App.tsx vscode/webview/src/features/composer/components/HomePage.tsx vscode/webview/src/features/chat/hooks/useChatStream.ts vscode/webview/src/features/chat/__tests__/liveTracePersistence.test.tsx
git commit -m "feat(vscode): persist live execution trace and 1s timer in root liveTraceStore"
```

---

### Task 4: Calm Codex `WorkTrace`, `ChatStream` & Single-Accent `EditorialMarkdown`

**Files:**
- Modify: `vscode/webview/src/features/chat/components/WorkTrace.tsx`
- Modify: `vscode/webview/src/features/chat/components/ChatStream.tsx:188-205,348-355`
- Modify: `vscode/webview/src/features/chat/components/EditorialMarkdown.tsx:45-86`
- Modify Test: `vscode/webview/src/features/chat/__tests__/chat.test.tsx:104-134,265-315`

**Interfaces:**
- Consumes: `TraceTimelineItem`, `postToHost` from `@/lib`; `ChatTurnView` from `../hooks/useChatStream`.
- Produces: `WorkTrace` with `timeline?: TraceTimelineItem[]`, live auto-expand (`userExpanded ?? defaultExpanded ?? Boolean(isLive)`), calm header (`Working · Xs` / `Worked for Xs`), monochrome underlined `FileReadStep` links, preserved `Background Alt+B` button; `ChatStream` passing `timeline={turn.timeline}` and gating `TurnFileSummaryCard` on `!turn.isLive`; `EditorialMarkdown` using single theme accent (`text-brand-text hover:bg-brand-soft/60`) for inline file/folder code spans and neutral language badges (`text-muted-ink bg-active/70`).

- [ ] **Step 1: Update `vscode/webview/src/features/chat/__tests__/chat.test.tsx` for calm Codex assertions**

In `vscode/webview/src/features/chat/__tests__/chat.test.tsx`, update line 116 to assert `"Worked for 14s"` and add this test inside the `describe(...)` block:

```tsx
  it("auto-expands WorkTrace while live, renders chronological timeline, and opens monochrome file links in VS Code", () => {
    const postSpy = vi.fn();
    window.acquireVsCodeApi = () => ({
      postMessage: postSpy,
      getState: () => undefined,
      setState: () => undefined,
    });

    const { rerender } = renderWithQuery(
      <WorkTrace
        workedDuration="3s"
        isLive
        showLiveBackgroundPill
        notes={["Checking lookup hot path."]}
        groups={[]}
        timeline={[
          { type: "note", id: "n1", text: "Checking lookup hot path." },
          {
            type: "group",
            group: {
              id: "g_tl",
              title: "Read files",
              steps: [
                {
                  id: "r_tl",
                  kind: "read",
                  label: "Read",
                  files: [
                    {
                      file: "lookup.rs",
                      path: "crates/rayu-harness/src/lookup.rs",
                      line: 42,
                      rangeLabel: "lookup.rs:42-80",
                    },
                  ],
                },
              ],
            },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("work-trace").getAttribute("data-depth")).toBe("1");
    expect(screen.getByTestId("work-trace-summary").textContent).toBe("Working · 3s");
    expect(screen.getByTestId("work-trace-live-bg-btn")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trace-file-link-crates/rayu-harness/src/lookup.rs"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openFile",
      path: "crates/rayu-harness/src/lookup.rs",
      line: 42,
    });

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <WorkTrace
          workedDuration="3s"
          isLive={false}
          notes={["Checking lookup hot path."]}
          groups={[]}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("work-trace").getAttribute("data-depth")).toBe("0");
    expect(screen.getByTestId("work-trace-summary").textContent).toBe("Worked for 3s");

    delete window.acquireVsCodeApi;
  });
```

- [ ] **Step 2: Run `chat.test.tsx` to verify the new/updated assertions fail**

Run: `cd vscode && npx vitest run webview/src/features/chat/__tests__/chat.test.tsx`
Expected: FAIL on `"Worked for 14s"` and live auto-expand assertions.

- [ ] **Step 3: Update `WorkTrace.tsx`, `ChatStream.tsx`, and `EditorialMarkdown.tsx`**

1. In `vscode/webview/src/features/chat/components/WorkTrace.tsx`:
   - Add `timeline?: TraceTimelineItem[]` to `WorkTraceProps` and change `defaultExpanded = false` to `defaultExpanded?: boolean`.
   - Set `const expanded = userExpanded ?? defaultExpanded ?? Boolean(isLive);` and `const hasTimeline = Boolean(timeline && timeline.length > 0);`.
   - Remove `TechFileBadge` pill styling inside `renderFileReadStep`; render comma-separated monochrome underlined buttons:
     `className="cursor-pointer text-body underline decoration-hairline-strong underline-offset-[3px] transition-colors hover:text-ink hover:decoration-current focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"`
     keeping the exact `postToHost({ type: "rayucode.editor.openFile", path: target.path, line: target.line })` + preview dispatch on click.
   - Simplify header label: `isLive ? (connectionPhaseLabel ? \`Working · ${workedDuration} · ${connectionPhaseLabel}\` : \`Working · ${workedDuration}\`) : \`Worked for ${workedDuration}\``.
   - Render `timeline` chronologically when `hasTimeline && timeline` (coalescing `entry.group.steps` with `coalesceTraceSteps` inside `TraceGroupSection`), otherwise interleave `notes` and `coalescedGroups`.
   - Render `"Thinking..."` when `isLive && !activeToolStatus && notes.length === 0 && coalescedGroups.length === 0 && !hasTimeline`.
   - Keep `showLiveBackgroundPill` `Background Alt+B` button, `ShellCard`, `ToolStepCard`, `InlineDiffCard`, `coalesceTraceGroups`, and `summarizeWorkTraceMetrics`.
2. In `vscode/webview/src/features/chat/components/ChatStream.tsx`:
   - Pass `timeline={turn.timeline}` to `<WorkTrace />`, include `(turn.timeline && turn.timeline.length > 0)` in the visibility check, and set `defaultExpanded={!turn.isLive && !hasAnswer && (turn.notes.length > 0 || turn.groups.length > 0 || Boolean(turn.timeline?.length)) ? true : undefined}`.
   - Change `hasFileSummary` to `!turn.isLive && Boolean(fileChangesSnapshot && fileChangesSnapshot.files.length > 0)` and gate `<TurnFileSummaryCard />` on `!turn.isLive && fileChangesSnapshot && fileChangesSnapshot.files.length > 0`.
3. In `vscode/webview/src/features/chat/components/EditorialMarkdown.tsx`:
   - Update `getInlineCodeClasses`: `"folder" | "file-ts" | "file-rust" | "file-doc" | "file-data"` -> `"text-brand-text hover:bg-brand-soft/60"`, all other cases -> `"bg-hover/55 text-ink"`.
   - Update `getLanguageBadgeClass` -> `"text-muted-ink bg-active/70"`.

- [ ] **Step 4: Run chat tests and `lint:design` to verify pass**

Run: `cd vscode && npx vitest run webview/src/features/chat/__tests__/chat.test.tsx webview/src/features/chat/__tests__/liveTracePersistence.test.tsx && node scripts/lint-design.mjs`
Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add vscode/webview/src/features/chat/components/WorkTrace.tsx vscode/webview/src/features/chat/components/ChatStream.tsx vscode/webview/src/features/chat/components/EditorialMarkdown.tsx vscode/webview/src/features/chat/__tests__/chat.test.tsx
git commit -m "feat(vscode): align WorkTrace, ChatStream, and inline citations with calm Codex UX"
```

---

### Task 5: Mid-Sentence `/skill` Autocomplete in `SessionComposer.tsx`

**Files:**
- Modify: `vscode/webview/src/features/composer/components/SessionComposer.tsx:338-446,887-901`
- Create: `vscode/webview/src/features/composer/__tests__/composerSlashSkills.test.tsx`

**Interfaces:**
- Consumes: `SlashCommandMenu`, `useSlashCommandsCatalog`, `SlashCommandItem`.
- Produces: Exported pure helpers `ActiveSlashTrigger`, `getActiveSlashTrigger(value: string, cursor?: number): ActiveSlashTrigger | null`, and `applySlashSelection(value: string, trigger: ActiveSlashTrigger, insertText: string): { nextValue: string; nextCursor: number }` from `SessionComposer.tsx`.

- [ ] **Step 1: Write failing mid-sentence `/skill` tests**

Create `vscode/webview/src/features/composer/__tests__/composerSlashSkills.test.tsx`:

```tsx
import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "@/lib";

import { SessionComposer } from "../components/SessionComposer";

function renderComposer(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>,
  );
}

describe("SessionComposer mid-sentence /skill autocomplete", () => {
  it("opens SlashCommandMenu mid-sentence and splices only the active /token", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;

    const text = "Please /rev";
    fireEvent.change(textarea, {
      target: { value: text, selectionStart: text.length, selectionEnd: text.length },
    });

    const menu = screen.getByTestId("slash-command-menu");
    expect(menu).toBeTruthy();

    const reviewItem = screen
      .getAllByTestId("slash-command-item")
      .find((el) => el.getAttribute("data-command") === "/review");
    expect(reviewItem).toBeTruthy();

    fireEvent.click(reviewItem!);
    expect(textarea.value).toBe("Please /review ");
  });

  it("preserves trailing text when editing mid-sentence at caret", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("Check /rev before merging");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;

    textarea.setSelectionRange(10, 10);
    fireEvent.select(textarea, { target: { selectionStart: 10, selectionEnd: 10 } });

    const reviewItem = screen
      .getAllByTestId("slash-command-item")
      .find((el) => el.getAttribute("data-command") === "/review");
    expect(reviewItem).toBeTruthy();

    fireEvent.click(reviewItem!);
    expect(textarea.value).toBe("Check /review before merging");
  });

  it("gives @file mention precedence over / when typing a path with slashes", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    const text = "Inspect @src/app";
    fireEvent.change(textarea, {
      target: { value: text, selectionStart: text.length, selectionEnd: text.length },
    });

    expect(screen.getByTestId("mention-menu")).toBeTruthy();
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vscode && npx vitest run webview/src/features/composer/__tests__/composerSlashSkills.test.tsx`
Expected: FAIL (`slash-command-menu` does not open on `"Please /rev"`).

- [ ] **Step 3: Implement cursor-aware `/skill` trigger & splice in `SessionComposer.tsx`**

In `vscode/webview/src/features/composer/components/SessionComposer.tsx`:
1. Export `ActiveSlashTrigger`, `getActiveSlashTrigger(value, cursor)`, and `applySlashSelection(value, trigger, insertText)`:
```ts
export interface ActiveSlashTrigger {
  slashIndex: number;
  endIndex: number;
  query: string;
}

function clampCursor(value: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, value.length));
}

export function getActiveSlashTrigger(
  value: string,
  cursor: number = value.length,
): ActiveSlashTrigger | null {
  const safeCursor = clampCursor(value, cursor);
  const beforeCursor = value.slice(0, safeCursor);
  const match = /(?:^|\s)(\/([^\s/]*))$/.exec(beforeCursor);
  if (!match) return null;
  return {
    slashIndex: safeCursor - match[1]!.length,
    endIndex: safeCursor,
    query: match[2] ?? "",
  };
}

export function applySlashSelection(
  value: string,
  trigger: ActiveSlashTrigger,
  insertText: string,
): { nextValue: string; nextCursor: number } {
  const token = insertText.trim();
  const before = value.slice(0, trigger.slashIndex);
  const after = value.slice(trigger.endIndex);
  const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = needsTrailingSpace ? `${token} ` : token;
  return {
    nextValue: `${before}${inserted}${after}`,
    nextCursor: before.length + inserted.length,
  };
}
```
2. Track `cursorPos` and `pendingCaret` (`useLayoutEffect` restoring `setSelectionRange(pendingCaret.pos, pendingCaret.pos)` when `pendingCaret` changes).
3. Update `slashTrigger` to use `getActiveSlashTrigger(textValue, effectiveCursor)` when `!mentionTrigger` and `popupDismissedForText !== textValue`.
4. Update `handleSelectSlashCommand`: for non-instant commands when `slashTrigger` is active, call `applySlashSelection(textValue, slashTrigger, item.insertText)` and schedule `pendingCaret`; for instant commands (`/compact`, `/plan`, `/bg`, `/clear`, `/mcp`, `/skills`), strip only the matched slash token if there is surrounding text, otherwise clear the input.
5. Sync `cursorPos` in textarea `onChange`, `onClick`, `onKeyUp`, and `onSelect`.

- [ ] **Step 4: Run composer tests to verify pass**

Run: `cd vscode && npx vitest run webview/src/features/composer/__tests__/composerSlashSkills.test.tsx webview/src/features/composer/__tests__/composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add vscode/webview/src/features/composer/components/SessionComposer.tsx vscode/webview/src/features/composer/__tests__/composerSlashSkills.test.tsx
git commit -m "feat(vscode): support mid-sentence slash command and skill autocomplete in composer"
```

---

### Task 6: Full VS Code Verification & VSIX Packaging Gate

**Files:**
- Verify only (no source edits unless a check surfaces an issue to fix).

- [ ] **Step 1: Run all 5 mandatory VS Code verification commands from repo root**

```bash
npm run typecheck --workspace @rayu-dev/rayucode-vscode && \
npm run lint:design --workspace @rayu-dev/rayucode-vscode && \
npm test --workspace @rayu-dev/rayucode-vscode && \
npm run build:vscode && \
npm run package:vscode
```
Expected: All 5 commands exit 0 with zero errors.

- [ ] **Step 2: Verify git status**

Run: `git status -s && git log -n 6 --oneline`
Expected: Only the scoped `vscode/` commits plus the unrelated pre-existing dirty files remain untouched.
