import { describe, expect, it } from "vitest";

import {
  extractActiveEditorSelectionFromPrompt,
  reconcileChatTurns,
  shouldClearStaleLiveTurn,
  type ReconcilableTurnLike,
} from "../../src/client/reconcile-turns.js";

interface TestTurn extends ReconcilableTurnLike {
  id: string;
  userPrompt: string;
  answerMarkdown: string;
  isLive: boolean;
}

describe("reconcileChatTurns", () => {
  it("prevents duplicate user prompt bubble when history loads mid-stream (Screenshot 1 regression)", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_s1_1",
        userPrompt: "Explain the active editor selection.",
        answerMarkdown: "",
        isLive: false,
      },
    ];
    const liveTurn: TestTurn = {
      id: "live_turn_1795601607_1",
      userPrompt: "Explain the active editor selection.",
      answerMarkdown: "Inspecting selection...",
      isLive: true,
    };

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn,
      baseHistoryTurnCount: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("live_turn_1795601607_1");
    expect(result[0].isLive).toBe(true);
  });

  it("preserves intentional repeated identical prompts via baseHistoryTurnCount watermark", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_s1_1",
        userPrompt: "run tests",
        answerMarkdown: "All 10 tests passed.",
        isLive: false,
      },
    ];
    const liveTurn: TestTurn = {
      id: "live_turn_2",
      userPrompt: "run tests",
      answerMarkdown: "",
      isLive: true,
    };

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn,
      baseHistoryTurnCount: 1,
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("hist_s1_1");
    expect(result[1].id).toBe("live_turn_2");
  });

  it("retires settled liveTurn once durable history contains the completed response", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_s1_1",
        userPrompt: "Explain selection",
        answerMarkdown: "Here is the durable explanation.",
        isLive: false,
      },
    ];
    const liveTurn: TestTurn = {
      id: "live_turn_1",
      userPrompt: "Explain selection",
      answerMarkdown: "Here is the durable explanation.",
      isLive: false,
    };

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn,
      baseHistoryTurnCount: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist_s1_1");
  });

  it("retires completedLiveTurns once durable history contains the same prompt and answer (no duplicate turn)", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_s1_1",
        userPrompt: "hi",
        answerMarkdown:
          "Hi! I'm here and ready in the RayuCode repo on feat/cross-agent-session-sync.",
        isLive: false,
      },
    ];
    const completedLiveTurns: TestTurn[] = [
      {
        id: "live_turn_1795612660_1",
        userPrompt: "hi",
        answerMarkdown:
          "Hi! I'm here and ready in the RayuCode repo on feat/cross-agent-session-sync.",
        isLive: false,
      },
    ];

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn: null,
      completedLiveTurns,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist_s1_1");
  });

  it("keeps a second identical prompt in completedLiveTurns when history only has the first distinct answer", () => {
    const historyTurns: TestTurn[] = [
      {
        id: "hist_s1_1",
        userPrompt: "hi",
        answerMarkdown: "First response from earlier.",
        isLive: false,
      },
    ];
    const completedLiveTurns: TestTurn[] = [
      {
        id: "live_turn_2",
        userPrompt: "hi",
        answerMarkdown: "Brand new response from second prompt.",
        isLive: false,
      },
    ];

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn: null,
      completedLiveTurns,
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("hist_s1_1");
    expect(result[1].id).toBe("live_turn_2");
  });

  it("clears stale liveTurn when daemon reports session status idle past grace window", () => {
    const liveTurn: TestTurn = {
      id: "live_stale",
      userPrompt: "Do work",
      answerMarkdown: "",
      isLive: true,
    };

    expect(
      shouldClearStaleLiveTurn({
        liveTurn,
        sessionStatus: "idle",
        lastEventAtMs: 1_000,
        nowMs: 2_000,
        gracePeriodMs: 2_500,
      })
    ).toBe(false);

    expect(
      shouldClearStaleLiveTurn({
        liveTurn,
        sessionStatus: "idle",
        lastEventAtMs: 1_000,
        nowMs: 4_000,
        gracePeriodMs: 2_500,
      })
    ).toBe(true);

    expect(
      shouldClearStaleLiveTurn({
        liveTurn,
        sessionStatus: "running",
        lastEventAtMs: 1_000,
        nowMs: 99_000,
      })
    ).toBe(false);
  });

  it("strips [Active Editor Selection: ...] suffixes and deduplicates multi-turn VS Code chats with repeated prompts without duplicating turns", () => {
    expect(
      extractActiveEditorSelectionFromPrompt(
        "hi\n\n[Active Editor Selection: /home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md#L1-L1]"
      )
    ).toEqual({
      prompt: "hi",
      refFiles: "/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md:1-1",
    });

    const historyTurns: TestTurn[] = [
      {
        id: "hist_1",
        userPrompt:
          "hi\n\n[Active Editor Selection: /home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md#L1-L1]",
        answerMarkdown: "Hey! RayuCode here. I see MIGRATION_PLAN.md open.",
        isLive: false,
        credits: "0.00 cr",
      },
      {
        id: "hist_2",
        userPrompt:
          "hll\n\n[Active Editor Selection: /home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md#L1-L1]",
        answerMarkdown: "Looks like a typo. What do you need?",
        isLive: false,
        credits: "0.00 cr",
      },
      {
        id: "hist_3",
        userPrompt:
          "hi\n\n[Active Editor Selection: rayucode-v2/how-to-run.md#L1-L1]",
        answerMarkdown: "Hi again. Happy to help, just say what you need.",
        isLive: false,
        credits: "0.00 cr",
      },
    ];

    const completedLiveTurns: TestTurn[] = [
      {
        id: "live_1",
        userPrompt: "hi",
        userRefFiles: "/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md:1-1",
        answerMarkdown: "Hey! RayuCode here. I see MIGRATION_PLAN.md open.",
        workedDuration: "6s",
        credits: "3.87 cr",
        kvCachePct: 77,
        baseHistoryTurnCount: 0,
        isLive: false,
      },
      {
        id: "live_2",
        userPrompt: "hll",
        userRefFiles: "/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md:1-1",
        answerMarkdown: "Looks like a typo. What do you need?",
        workedDuration: "2s",
        credits: "1.16 cr",
        kvCachePct: 99,
        baseHistoryTurnCount: 1,
        isLive: false,
      },
      {
        id: "live_3",
        userPrompt: "hi",
        userRefFiles: "rayucode-v2/how-to-run.md:1-1",
        answerMarkdown: "Hi again. Happy to help, just say what you need.",
        workedDuration: "2s",
        credits: "1.27 cr",
        kvCachePct: 99,
        baseHistoryTurnCount: 2,
        isLive: false,
      },
    ];

    const result = reconcileChatTurns({
      historyTurns,
      liveTurn: null,
      completedLiveTurns,
    });

    expect(result).toHaveLength(3);
    expect(result.map((t) => t.id)).toEqual(["hist_1", "hist_2", "hist_3"]);
    expect(result.map((t) => t.workedDuration)).toEqual(["6s", "2s", "2s"]);
    expect(result.map((t) => t.credits)).toEqual(["3.87 cr", "1.16 cr", "1.27 cr"]);
    expect(result[0]?.userRefFiles).toBe(
      "/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md:1-1"
    );
  });

  it("never collides a newly settled turn with an earlier identical prompt+answer turn before history refetches", () => {
    const staleHistory: TestTurn[] = [
      {
        id: "hist_1",
        userPrompt: "hi",
        answerMarkdown: "Hello! How can I help?",
        isLive: false,
      },
    ];
    const newlySettled: TestTurn[] = [
      {
        id: "live_2",
        userPrompt: "hi",
        answerMarkdown: "Hello! How can I help?",
        workedDuration: "2s",
        baseHistoryTurnCount: 1,
        isLive: false,
      },
    ];

    const beforeRefetch = reconcileChatTurns({
      historyTurns: staleHistory,
      liveTurn: null,
      completedLiveTurns: newlySettled,
    });
    expect(beforeRefetch).toHaveLength(2);
    expect(beforeRefetch.map((t) => t.id)).toEqual(["hist_1", "live_2"]);

    const afterRefetch = reconcileChatTurns({
      historyTurns: [
        ...staleHistory,
        {
          id: "hist_2",
          userPrompt: "hi\n\n[Active Editor Selection: README.md#L1-L1]",
          answerMarkdown: "Hello! How can I help?",
          isLive: false,
        },
      ],
      liveTurn: null,
      completedLiveTurns: newlySettled,
    });
    expect(afterRefetch).toHaveLength(2);
    expect(afterRefetch.map((t) => t.id)).toEqual(["hist_1", "hist_2"]);
    expect(afterRefetch[1]?.workedDuration).toBe("2s");
  });

  it("preserves kvCachePct, creditsExact, and kvCacheMissReason even when history already has credits or turn is unmetered", () => {
    const result = reconcileChatTurns({
      historyTurns: [
        {
          id: "hist_byok",
          userPrompt: "Check cache",
          answerMarkdown: "Cache looks healthy.",
          credits: "",
          kvCachePct: 0,
          isLive: false,
        },
      ],
      liveTurn: null,
      completedLiveTurns: [
        {
          id: "live_byok",
          userPrompt: "Check cache",
          answerMarkdown: "Cache looks healthy.",
          workedDuration: "4s",
          credits: "",
          kvCachePct: 87,
          kvCacheMissReason: "Prefix changed after tool schema update",
          isLive: false,
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.kvCachePct).toBe(87);
    expect(result[0]?.kvCacheMissReason).toBe(
      "Prefix changed after tool schema update"
    );
    expect(result[0]?.credits).toBe("");
  });
});
