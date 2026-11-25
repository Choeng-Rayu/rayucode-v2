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

  it("settles ev: error frames with error text and complete event so turns never spin forever", () => {
    const tracker = createHarnessStreamTracker();
    mapHarnessFrameToLiveEvents({ ev: "turn_start" }, tracker);

    const errEvents = mapHarnessFrameToLiveEvents(
      { ev: "error", message: "Provider rate limited (429)" },
      tracker,
    );
    expect(errEvents).toContainEqual({ type: "tool-status", label: null });
    expect(errEvents).toContainEqual({
      type: "answer-delta",
      delta: "\n\n**Error:** Provider rate limited (429)",
    });
    expect(errEvents.some((e) => e.type === "complete")).toBe(true);
    expect(tracker.turnActive).toBe(false);
    expect(tracker.turnCompleted).toBe(true);

    // Duplicate error frame after settlement produces no duplicate events
    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "error", message: "Duplicate error" },
        tracker,
      ),
    ).toEqual([]);
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
