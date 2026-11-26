import { describe, expect, it } from "vitest";
import {
  filterVisibleHistory,
  isVisibleHistoryMessage,
} from "../../src/client/index.js";

interface TestHistoryMessage {
  id: string;
  role: string;
  content: string;
  origin?: "user_typed" | "engine_internal" | "legacy_unknown";
  visibility?: "visible" | "hidden";
}

describe("filterVisibleHistory", () => {
  it("drops engine_internal and hidden rows while preserving user_typed and legacy messages", () => {
    const messages: TestHistoryMessage[] = [
      {
        id: "1",
        role: "user",
        content: "Build the feature",
        origin: "user_typed",
        visibility: "visible",
      },
      {
        id: "2",
        role: "user",
        content: "Reassess the user's request using its full context",
        origin: "engine_internal",
        visibility: "hidden",
      },
      {
        id: "3",
        role: "user",
        content: "Engine internal without explicit visibility",
        origin: "engine_internal",
      },
      {
        id: "4",
        role: "system",
        content: "Explicitly hidden row",
        origin: "legacy_unknown",
        visibility: "hidden",
      },
      {
        id: "5",
        role: "user",
        content: "Legacy v1.15 user message without origin or visibility",
      },
      {
        id: "6",
        role: "assistant",
        content: "Done!",
        origin: "legacy_unknown",
        visibility: "visible",
      },
    ];

    const visible = filterVisibleHistory(messages);
    expect(visible.map((m) => m.id)).toEqual(["1", "5", "6"]);
  });

  it("preserves input message references and order without mutating the source array", () => {
    const source: TestHistoryMessage[] = [
      { id: "a", role: "user", content: "hello" },
      { id: "b", role: "user", content: "internal", origin: "engine_internal" },
      { id: "c", role: "assistant", content: "world" },
    ];
    const result = filterVisibleHistory(source);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(source[0]);
    expect(result[1]).toBe(source[2]);
    expect(source).toHaveLength(3);
  });

  it("exposes isVisibleHistoryMessage predicate", () => {
    expect(isVisibleHistoryMessage({ origin: "user_typed", visibility: "visible" })).toBe(true);
    expect(isVisibleHistoryMessage({})).toBe(true);
    expect(isVisibleHistoryMessage({ origin: "legacy_unknown" })).toBe(true);
    expect(isVisibleHistoryMessage({ origin: "engine_internal" })).toBe(false);
    expect(isVisibleHistoryMessage({ visibility: "hidden" })).toBe(false);
    expect(isVisibleHistoryMessage({ origin: "user_typed", visibility: "hidden" })).toBe(false);
  });
});
