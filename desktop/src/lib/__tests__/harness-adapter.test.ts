import { describe, expect, it } from "vitest"

import {
  createHarnessStreamTracker,
  mapHarnessFrameToLiveEvents,
  mapHistoryMessagesToTurns,
  mapModelRoutesToOptions,
  mapSessionInfoToSummary,
} from "../harness-adapter"

describe("harness-adapter", () => {
  it("maps SessionInfo to desktop SessionSummary", () => {
    const summary = mapSessionInfoToSummary({
      session_id: "h_abc12345",
      working_dir: "/Users/dev/rayucode-v2",
      title: "Wire live daemon",
      status: "running",
    })
    expect(summary.id).toBe("h_abc12345")
    expect(summary.project).toBe("rayucode-v2")
    expect(summary.title).toBe("Wire live daemon")
    expect(summary.updatedAt).toBe("Live")
  })

  it("maps ModelRouteInfo list into deduplicated ModelOption entries", () => {
    const options = mapModelRoutesToOptions([
      { model: "claude-opus-5-5", provider: "Anthropic", available: true, detail: "OAuth" },
      { model: "claude-opus-5-5", provider: "Anthropic", available: true },
      { model: "gpt-6.1-sol", provider: "OpenAI", available: true, detail: "API key" },
    ])
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({ id: "claude-opus-5-5", provider: "Anthropic", recommended: true })
    expect(options[1]).toMatchObject({ id: "gpt-6.1-sol", provider: "OpenAI" })
  })

  it("maps history messages into ExecutionTurn objects with stats", () => {
    const turns = mapHistoryMessagesToTurns("s_1", [
      { role: "user", content: "Run session tests" },
      { role: "tool", content: "14 passed; 0 failed" },
      {
        role: "assistant",
        content: "All 14 session tests passed.",
        response_stats: {
          duration_secs: 12,
          input_tokens: 1000,
          cache_read_tokens: 9000,
          rayu_credits: 0.12,
        },
      },
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toBe("Run session tests")
    expect(turns[0].answerIntro).toBe("All 14 session tests passed.")
    expect(turns[0].workedDuration).toBe("12s")
    expect(turns[0].credits).toBe("0.12 cr")
    expect(turns[0].kvCachePct).toBe(90)
    expect(turns[0].groups[0].steps).toHaveLength(1)
  })

  it("folds imported tool results and skill instruction injections into tool steps instead of giant user bubbles", () => {
    const turns = mapHistoryMessagesToTurns("s_skill", [
      { role: "user", content: "Build an Excel budget model" },
      {
        role: "user",
        content:
          "[Imported tool result: toolu_123] Launching skill: anthropic-skills:xlsx",
      },
      {
        role: "user",
        content:
          "Base directory for this skill: /Users/dev/skills/xlsx\n\n## XLSX creation, editing, and analysis",
      },
      {
        role: "assistant",
        content: "Created Q4-Budget.xlsx with verified formulas.",
      },
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toBe("Build an Excel budget model")
    expect(turns[0].groups[0].steps).toHaveLength(2)
    expect(turns[0].answerIntro).toBe(
      "Created Q4-Budget.xlsx with verified formulas."
    )
  })

  it("streams live harness frames into Codex-style LiveTraceEvent sequence", () => {
    const tracker = createHarnessStreamTracker()

    // Reasoning delta stays quiet (no noisy "Reasoning via Rayu Cloud..." placeholder)
    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "reasoning_delta", text: "checking files" },
        tracker
      )
    ).toEqual([])

    // read_file maps cleanly into "Read files" with clickable FileReadStep
    expect(
      mapHarnessFrameToLiveEvents(
        {
          ev: "tool_start",
          call_id: "c_read",
          name: "read_file",
          tool_input: { path: "README.md" },
        },
        tracker
      )
    ).toEqual([{ type: "tool-status", label: "Reading README.md..." }])

    const readDone = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_done",
        call_id: "c_read",
        name: "read_file",
        tool_input: { path: "README.md" },
        tool_output: "# RayuCode",
      },
      tracker
    )
    expect(readDone[1]).toMatchObject({
      type: "step",
      groupTitle: "Read files",
      step: { kind: "read", label: "Read" },
    })

    // Shell command maps cleanly into "Ran a command"
    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "tool_start", call_id: "c1", name: "bash" },
        tracker
      )
    ).toEqual([{ type: "tool-status", label: "Running command..." }])

    mapHarnessFrameToLiveEvents(
      { ev: "tool_input_delta", call_id: "c1", delta: '{"command":"cargo test"}' },
      tracker
    )

    const doneEvents = mapHarnessFrameToLiveEvents(
      { ev: "tool_done", call_id: "c1", name: "bash", output: "ok" },
      tracker
    )
    expect(doneEvents[1]).toMatchObject({
      type: "step",
      groupTitle: "Ran a command",
      step: { kind: "command", command: "cargo test", output: "ok", exitCode: 0 },
    })

    expect(
      mapHarnessFrameToLiveEvents({ ev: "text_delta", text: "Hello world" }, tracker)
    ).toEqual([{ type: "answer-delta", delta: "Hello world" }])

    expect(
      mapHarnessFrameToLiveEvents({ ev: "promote_answer_to_note" }, tracker)
    ).toEqual([{ type: "promote-note" }])

    mapHarnessFrameToLiveEvents({ ev: "rayu_credits", turn_credits: 0.05 }, tracker)
    const completed = mapHarnessFrameToLiveEvents({ ev: "turn_done" }, tracker)
    expect(completed.find((e) => e.type === "complete")).toMatchObject({
      type: "complete",
      credits: "0.05 cr",
    })
  })
})
