import { describe, expect, it } from "vitest"

import {
  mapHistoryMessagesToTurns,
  type HarnessHistoryMessageLike,
} from "../harness-adapter"
import type { ExecutionTurn } from "../ipc-client"

/**
 * Target provenance/attempt shape from desktop/docs/session-load-bug.md §5.
 * Passed through mapHistoryMessagesToTurns to test real behavior before production types exist.
 */
interface ProvenanceHistoryMessage extends HarnessHistoryMessageLike {
  origin?:
    | "user_typed"
    | "user_attachment"
    | "assistant_model"
    | "engine_internal"
    | "tool_output"
    | "legacy_unknown"
  visibility?: "shown" | "collapsed" | "hidden"
  attempt_id?: string | null
  attempt_reason?: "initial" | "retry_error" | "reassess_refusal" | "user_regenerate"
  attempt_status?: "answered" | "answered_partial" | "declined" | "failed" | "cancelled" | "timed_out"
  stop_reason?: string | null
}

interface TurnAttempt {
  id: string
  reason: "initial" | "retry_error" | "reassess_refusal" | "user_regenerate"
  status: "answered" | "answered_partial" | "declined" | "failed" | "cancelled" | "timed_out"
  answerText: string
}

type TurnWithProvenance = ExecutionTurn & {
  outcome?: "answered" | "answered_partial" | "declined" | "failed" | "cancelled" | "timed_out"
  attempts?: TurnAttempt[]
  finalAttemptId?: string | null
  hiddenInternalMessages?: Array<{ origin: string; visibility: string; content: string }>
}

const VALID_OUTCOMES = new Set([
  "answered",
  "answered_partial",
  "declined",
  "failed",
  "cancelled",
  "timed_out",
])

describe("provenance, append-only attempts, and truthful turn outcomes (audit-5 / session-load-bug §9)", () => {
  it("never renders engine_internal messages as user bubbles regardless of text content", () => {
    const messages: ProvenanceHistoryMessage[] = [
      {
        role: "user",
        origin: "user_typed",
        visibility: "shown",
        content: "Refactor the parser to stream line by line",
      },
      {
        role: "user",
        origin: "engine_internal",
        visibility: "hidden",
        attempt_id: "att_2",
        attempt_reason: "reassess_refusal",
        content: "Arbitrary internal recovery instruction without any hardcoded prefix",
      },
      {
        role: "assistant",
        origin: "assistant_model",
        visibility: "shown",
        attempt_id: "att_2",
        content: "Updated the parser to stream line by line.",
      },
    ]

    const turns = mapHistoryMessagesToTurns(
      "s_provenance",
      messages as HarnessHistoryMessageLike[]
    ) as TurnWithProvenance[]

    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toBe("Refactor the parser to stream line by line")
    expect(turns[0].answerIntro).toBe("Updated the parser to stream line by line.")
    expect(turns[0].hiddenInternalMessages).toEqual([
      {
        origin: "engine_internal",
        visibility: "hidden",
        content: "Arbitrary internal recovery instruction without any hardcoded prefix",
      },
    ])
  })

  it("preserves append-only attempts and keeps attempt 1 answer when attempt 2 is refused", () => {
    const messages: ProvenanceHistoryMessage[] = [
      {
        role: "user",
        origin: "user_typed",
        visibility: "shown",
        content: "Explain the auth middleware flow",
      },
      {
        role: "assistant",
        origin: "assistant_model",
        visibility: "shown",
        attempt_id: "att_1",
        attempt_reason: "initial",
        attempt_status: "answered",
        content: "Auth middleware verifies the session cookie before forwarding.",
      },
      {
        role: "user",
        origin: "engine_internal",
        visibility: "hidden",
        attempt_id: "att_2",
        attempt_reason: "reassess_refusal",
        content: "Internal reassessment prompt",
      },
      {
        role: "assistant",
        origin: "assistant_model",
        visibility: "shown",
        attempt_id: "att_2",
        attempt_reason: "reassess_refusal",
        attempt_status: "declined",
        stop_reason: "refusal",
        content: "",
      },
    ]

    const turns = mapHistoryMessagesToTurns(
      "s_attempts",
      messages as HarnessHistoryMessageLike[]
    ) as TurnWithProvenance[]

    expect(turns).toHaveLength(1)
    expect(turns[0].attempts).toHaveLength(2)
    expect(turns[0].attempts?.[0]).toMatchObject({
      id: "att_1",
      reason: "initial",
      status: "answered",
      answerText: "Auth middleware verifies the session cookie before forwarding.",
    })
    expect(turns[0].attempts?.[1]).toMatchObject({
      id: "att_2",
      reason: "reassess_refusal",
      status: "declined",
      answerText: "",
    })
    expect(turns[0].finalAttemptId).toBe("att_2")
    expect(turns[0].answerIntro).toContain(
      "Auth middleware verifies the session cookie before forwarding."
    )
  })

  it("never reports an empty refused turn as answered and uses the outcome enum", () => {
    const messages: ProvenanceHistoryMessage[] = [
      {
        role: "user",
        origin: "user_typed",
        visibility: "shown",
        content: "do this ordinary coding task",
      },
      {
        role: "assistant",
        origin: "assistant_model",
        visibility: "shown",
        attempt_id: "att_1",
        attempt_reason: "initial",
        attempt_status: "declined",
        stop_reason: "refusal",
        content: "",
      },
      {
        role: "user",
        origin: "engine_internal",
        visibility: "hidden",
        attempt_id: "att_2",
        attempt_reason: "reassess_refusal",
        content: "Internal reassessment prompt",
      },
      {
        role: "assistant",
        origin: "assistant_model",
        visibility: "shown",
        attempt_id: "att_2",
        attempt_reason: "reassess_refusal",
        attempt_status: "declined",
        stop_reason: "refusal",
        content: "",
      },
    ]

    const turns = mapHistoryMessagesToTurns(
      "s_declined",
      messages as HarnessHistoryMessageLike[]
    ) as TurnWithProvenance[]

    expect(turns).toHaveLength(1)
    expect(turns[0].outcome).toBe("declined")
    expect(VALID_OUTCOMES.has(turns[0].outcome ?? "")).toBe(true)
    expect(turns[0].outcome).not.toBe("answered")
    expect(turns[0].answerIntro).not.toMatch(/completed safely/i)
  })

  it("sets outcome to answered only when the final attempt has non-empty assistant content", () => {
    const messages: ProvenanceHistoryMessage[] = [
      {
        role: "user",
        origin: "user_typed",
        visibility: "shown",
        content: "Add a unit test for the date formatter",
      },
      {
        role: "assistant",
        origin: "assistant_model",
        visibility: "shown",
        attempt_id: "att_1",
        attempt_reason: "initial",
        attempt_status: "answered",
        content: "Added date formatter unit tests in format-date.test.ts.",
      },
    ]

    const turns = mapHistoryMessagesToTurns(
      "s_answered",
      messages as HarnessHistoryMessageLike[]
    ) as TurnWithProvenance[]

    expect(turns).toHaveLength(1)
    expect(turns[0].outcome).toBe("answered")
    expect(turns[0].attempts).toHaveLength(1)
  })
})
