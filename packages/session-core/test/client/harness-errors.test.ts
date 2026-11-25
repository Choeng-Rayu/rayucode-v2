import { describe, expect, it } from "vitest";

import {
  extractHarnessErrorMessage,
  settleHarnessErrorFrame,
} from "../../src/client/harness-errors.js";
import { createStreamBatcher } from "../../src/client/stream-batcher.js";

describe("settleHarnessErrorFrame", () => {
  it("settles active turn immediately on ev: error instead of leaving spinner stuck", () => {
    let phaseReset = false;
    const tracker = {
      startedAtMs: Date.now() - 4_000,
      turnActive: true,
      turnCompleted: false,
      batchEpoch: 2,
      hasStreamedTextInPhase: true,
      lastCredits: "0.02 cr",
      lastKvCachePct: 88,
    };

    const settled = settleHarnessErrorFrame(
      { ev: "error", message: "Provider timeout" },
      tracker,
      () => {
        phaseReset = true;
      }
    );

    expect(settled).not.toBeNull();
    expect(settled?.message).toBe("Provider timeout");
    expect(settled?.credits).toBe("0.02 cr");
    expect(settled?.kvCachePct).toBe(88);
    expect(tracker.turnActive).toBe(false);
    expect(tracker.turnCompleted).toBe(true);
    expect(tracker.batchEpoch).toBe(1);
    expect(phaseReset).toBe(true);

    // Duplicate error frame after settlement is a no-op
    expect(
      settleHarnessErrorFrame({ ev: "error", message: "Again" }, tracker)
    ).toBeNull();
  });

  it("extracts fallback error fields cleanly", () => {
    expect(extractHarnessErrorMessage({ error: "Auth expired" })).toBe(
      "Auth expired"
    );
    expect(extractHarnessErrorMessage({})).toBe("The request failed.");
  });
});

describe("createStreamBatcher", () => {
  it("batches multiple pushed events into one flush", () => {
    const batches: string[][] = [];
    const batcher = createStreamBatcher<string>((items) => {
      batches.push(items);
    }, 16);

    batcher.push("a");
    batcher.pushMany(["b", "c"]);
    expect(batcher.pendingCount()).toBe(3);

    batcher.flush();
    expect(batches).toEqual([["a", "b", "c"]]);
    expect(batcher.pendingCount()).toBe(0);
    batcher.dispose();
  });
});
