import { describe, expect, it } from "vitest";

import {
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
});
