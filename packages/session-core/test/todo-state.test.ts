import { describe, expect, it } from "vitest";

import {
  extractTodosFromHarnessFrame,
  isTodoToolEvent,
  isTodoToolName,
  normalizeTodoItem,
  normalizeTodoItems,
  normalizeTodoStatus,
  reconcileChatTurns,
  summarizeTodoProgress,
  type ReconcilableTurnLike,
} from "../src/client/index.js";

interface TestTurn extends ReconcilableTurnLike {
  id: string;
  userPrompt: string;
  answerMarkdown: string;
  workedDuration?: string;
  isLive: boolean;
}

describe("todo-state helpers", () => {
  it("normalizes all canonical and alias todo statuses matching Rust canonical_todo_status", () => {
    expect(normalizeTodoStatus("completed")).toBe("completed");
    expect(normalizeTodoStatus("complete")).toBe("completed");
    expect(normalizeTodoStatus("DONE")).toBe("completed");
    expect(normalizeTodoStatus(" finished ")).toBe("completed");

    expect(normalizeTodoStatus("in_progress")).toBe("in_progress");
    expect(normalizeTodoStatus("in progress")).toBe("in_progress");
    expect(normalizeTodoStatus("in-progress")).toBe("in_progress");
    expect(normalizeTodoStatus("Running")).toBe("in_progress");

    expect(normalizeTodoStatus("cancelled")).toBe("cancelled");
    expect(normalizeTodoStatus("CANCELED")).toBe("cancelled");

    expect(normalizeTodoStatus("pending")).toBe("pending");
    expect(normalizeTodoStatus("unknown")).toBe("pending");
    expect(normalizeTodoStatus(null)).toBe("pending");
    expect(normalizeTodoStatus(undefined)).toBe("pending");
  });

  it("normalizes single items and Rust field aliases (content/name/title, active_form, lane, phase/wave, blockers)", () => {
    expect(normalizeTodoItem(null)).toBeNull();
    expect(normalizeTodoItem({ content: "   " })).toBeNull();

    expect(
      normalizeTodoItem({
        id: "t-1",
        content: "Implement shared todo normalizer",
        status: "running",
        active_form: "Implementing shared todo normalizer",
        lane: "core",
        phase: 2,
        completely_blocked: { reason: "Waiting on daemon release" },
      })
    ).toEqual({
      id: "t-1",
      content: "Implement shared todo normalizer",
      status: "in_progress",
      activeForm: "Implementing shared todo normalizer",
      group: "core",
      stage: 2,
      blockedReason: "Waiting on daemon release",
    });

    expect(
      normalizeTodoItem({
        name: "Verify desktop build",
        status: "done",
        wave: 3,
        external_blocker: { reason: "CI runner queued" },
      })
    ).toEqual({
      content: "Verify desktop build",
      status: "completed",
      stage: 3,
      blockedReason: "CI runner queued",
    });

    expect(
      normalizeTodoItem({
        title: "Fallback title",
        status: "canceled",
        stage: 0,
        blockedReason: "Superseded",
      })
    ).toEqual({
      content: "Fallback title",
      status: "cancelled",
      blockedReason: "Superseded",
    });
  });

  it("normalizes both raw arrays and TodoSnapshot objects", () => {
    const rawArray = [
      { content: "Step 1", status: "done" },
      { content: "   ", status: "pending" },
      { title: "Step 2", status: "in-progress" },
    ];
    expect(normalizeTodoItems(rawArray)).toEqual([
      { content: "Step 1", status: "completed" },
      { content: "Step 2", status: "in_progress" },
    ]);

    expect(
      normalizeTodoItems({
        todos: [{ name: "From snapshot", status: "pending" }],
        plan: {},
      })
    ).toEqual([{ content: "From snapshot", status: "pending" }]);

    expect(normalizeTodoItems(undefined)).toEqual([]);
  });

  it("identifies todo tool names and direct/batch tool_done frames while ignoring errors", () => {
    for (const name of [
      "todo",
      "TodoWrite",
      "todo_write",
      "todoread",
      "TODO_READ",
      "todos",
    ]) {
      expect(isTodoToolName(name)).toBe(true);
    }
    expect(isTodoToolName("read")).toBe(false);
    expect(isTodoToolName(null)).toBe(false);

    expect(isTodoToolEvent({ ev: "tool_done", name: "todo" })).toBe(true);
    expect(isTodoToolEvent({ ev: "tool_done", name: "TodoWrite" })).toBe(true);
    expect(
      isTodoToolEvent({ ev: "tool_done", name: "todo", error: true })
    ).toBe(false);
    expect(
      isTodoToolEvent({ ev: "tool_done", name: "todo", error: "failed" })
    ).toBe(false);
    expect(isTodoToolEvent({ ev: "tool_start", name: "todo" })).toBe(false);
    expect(isTodoToolEvent({ ev: "tool_done", name: "bash" })).toBe(false);

    // Batch with parsed object tool_input
    expect(
      isTodoToolEvent({
        ev: "tool_done",
        name: "batch",
        tool_input: {
          tool_calls: [{ tool: "read" }, { tool: "todo", args: {} }],
        },
      })
    ).toBe(true);

    // Batch with JSON-string input and tool_name/name aliases
    expect(
      isTodoToolEvent({
        ev: "tool_done",
        name: "BATCH",
        input: JSON.stringify({
          tool_calls: [{ name: "todo_write" }],
        }),
      })
    ).toBe(true);

    // Batch with section marker in output
    expect(
      isTodoToolEvent({
        ev: "tool_done",
        name: "batch",
        tool_output: "--- [0] read ---\nok\n--- [1] todo_write ---\nupdated",
      })
    ).toBe(true);

    // Batch without todo sub-calls or with error
    expect(
      isTodoToolEvent({
        ev: "tool_done",
        name: "batch",
        tool_input: { tool_calls: [{ tool: "read" }, { tool: "grep" }] },
        output: "--- [0] read ---\nhello",
      })
    ).toBe(false);

    expect(
      isTodoToolEvent({
        ev: "tool_done",
        name: "batch",
        error: true,
        tool_input: { tool_calls: [{ tool: "todo" }] },
      })
    ).toBe(false);
  });

  it("extracts normalized todos from todo_state harness frames with session fallback", () => {
    expect(
      extractTodosFromHarnessFrame({ ev: "tool_done", name: "todo" })
    ).toBeNull();
    expect(
      extractTodosFromHarnessFrame({ ev: "todo_state", todos: [] })
    ).toBeNull();

    expect(
      extractTodosFromHarnessFrame({
        ev: "todo_state",
        session_id: "sess-1",
        state: {
          todos: [
            { id: "1", content: "Plan", status: "done" },
            { id: "2", content: "Build", status: "in progress" },
          ],
        },
      })
    ).toEqual({
      sessionId: "sess-1",
      todos: [
        { id: "1", content: "Plan", status: "completed" },
        { id: "2", content: "Build", status: "in_progress" },
      ],
    });

    expect(
      extractTodosFromHarnessFrame(
        {
          ev: "todo_state",
          todos: [{ content: "Direct todos field", status: "pending" }],
        },
        "fallback-sess"
      )
    ).toEqual({
      sessionId: "fallback-sess",
      todos: [{ content: "Direct todos field", status: "pending" }],
    });
  });

  it("summarizes todo progress accurately and excludes cancelled items from denominator", () => {
    expect(summarizeTodoProgress([])).toEqual({
      total: 0,
      activeTotal: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      cancelled: 0,
      percent: 0,
      activeItem: null,
      allCompleted: false,
    });

    const inFlight = summarizeTodoProgress([
      { content: "A", status: "completed" },
      { content: "B", status: "in_progress", activeForm: "Working on B" },
      { content: "C", status: "pending" },
      { content: "D", status: "cancelled" },
    ]);
    expect(inFlight).toEqual({
      total: 4,
      activeTotal: 3,
      completed: 1,
      inProgress: 1,
      pending: 1,
      cancelled: 1,
      percent: 33,
      activeItem: {
        content: "B",
        status: "in_progress",
        activeForm: "Working on B",
      },
      allCompleted: false,
    });

    const finishedWithCancelled = summarizeTodoProgress([
      { content: "A", status: "completed" },
      { content: "B", status: "completed" },
      { content: "C", status: "cancelled" },
    ]);
    expect(finishedWithCancelled).toEqual({
      total: 3,
      activeTotal: 2,
      completed: 2,
      inProgress: 0,
      pending: 0,
      cancelled: 1,
      percent: 100,
      activeItem: null,
      allCompleted: true,
    });

    const onlyCancelled = summarizeTodoProgress([
      { content: "Only cancelled", status: "cancelled" },
    ]);
    expect(onlyCancelled).toEqual({
      total: 1,
      activeTotal: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      cancelled: 1,
      percent: 100,
      activeItem: null,
      allCompleted: false,
    });
  });
});

describe("reconcileChatTurns workedDuration preservation", () => {
  it("preserves completedLiveTurns workedDuration when durable history lacks duration metadata", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_1",
        userPrompt: "hi",
        answerMarkdown: "Hello! Ready to help.",
        workedDuration: "",
        isLive: false,
      },
    ];
    const completedLiveTurns: TestTurn[] = [
      {
        id: "live_1",
        userPrompt: "hi",
        answerMarkdown: "Hello! Ready to help.",
        workedDuration: "4s",
        isLive: false,
      },
    ];

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn: null,
      completedLiveTurns,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist_1");
    expect(result[0].workedDuration).toBe("4s");
    // Does not mutate original history entry
    expect(historyTurns[0].workedDuration).toBe("");
  });

  it("prefers durable history workedDuration when already present", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_1",
        userPrompt: "hi",
        answerMarkdown: "Hello! Ready to help.",
        workedDuration: "6s",
        isLive: false,
      },
    ];
    const completedLiveTurns: TestTurn[] = [
      {
        id: "live_1",
        userPrompt: "hi",
        answerMarkdown: "Hello! Ready to help.",
        workedDuration: "4s",
        isLive: false,
      },
    ];

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn: null,
      completedLiveTurns,
    });

    expect(result).toHaveLength(1);
    expect(result[0].workedDuration).toBe("6s");
  });

  it("preserves settled liveTurn workedDuration when retiring against durable history", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_2",
        userPrompt: "Explain architecture",
        answerMarkdown: "Here is the durable explanation from history.",
        isLive: false,
      },
    ];
    const liveTurn: TestTurn = {
      id: "live_2",
      userPrompt: "Explain architecture",
      answerMarkdown: "Here is the durable explanation from history.",
      workedDuration: "9s",
      isLive: false,
    };

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn,
      baseHistoryTurnCount: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist_2");
    expect(result[0].workedDuration).toBe("9s");
  });
});
