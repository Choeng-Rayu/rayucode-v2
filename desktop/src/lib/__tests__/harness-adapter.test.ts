import { describe, expect, it } from "vitest"

import {
  createHarnessStreamTracker,
  formatDaemonVersionLabel,
  formatDurationSeconds,
  formatHarnessModelSpec,
  isTempDirectoryPath,
  mapHarnessFrameToLiveEvents,
  mapHistoryMessagesToTurns,
  mapModelRoutesToOptions,
  mapSessionInfoToSummary,
} from "../harness-adapter"

describe("harness-adapter", () => {
  it("maps SessionInfo to desktop SessionSummary with workingDir, real relative timestamp, and flags", () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    const summary = mapSessionInfoToSummary({
      session_id: "h_abc12345",
      working_dir: "/Users/dev/rayucode-v2",
      title: "Wire live daemon",
      status: "idle",
      updated_at_ms: twoHoursAgo,
      saved: true,
      archived: false,
    })
    expect(summary.id).toBe("h_abc12345")
    expect(summary.project).toBe("rayucode-v2")
    expect(summary.workingDir).toBe("/Users/dev/rayucode-v2")
    expect(summary.title).toBe("Wire live daemon")
    expect(summary.updatedAtMs).toBe(twoHoursAgo)
    expect(summary.updatedAt).toBe("2h")
    expect(summary.saved).toBe(true)
    expect(summary.archived).toBe(false)
    expect(summary.connection).toBe("local")

    const running = mapSessionInfoToSummary({
      session_id: "h_live",
      working_dir: "/Users/dev/rayucode-v2",
      title: "Live turn",
      status: "running",
    })
    expect(running.updatedAt).toBe("Live")
  })

  it("maps ModelRouteInfo list into deduplicated ModelOption entries preferring available and effort-capable routes", () => {
    const options = mapModelRoutesToOptions([
      {
        model: "claude-opus-5-5",
        provider: "Anthropic",
        available: true,
        detail: "OAuth",
        supported_efforts: ["low", "medium", "high", "max"],
        default_effort: "medium",
        context_window: 200_000,
      },
      { model: "claude-opus-5-5", provider: "Anthropic", available: true },
      {
        model: "gpt-6.1-sol",
        provider: "OpenAI",
        available: false,
        detail: "Configure key",
      },
      {
        model: "gpt-6.1-sol",
        provider: "Rayu",
        api_method: "rayu",
        available: true,
        detail: "Rayu Cloud",
        supported_efforts: ["none", "low", "medium", "high", "xhigh"],
        default_effort: "low",
      },
      {
        model: "claude-sonnet-4-6",
        provider: "Cursor",
        available: true,
        detail: "Cursor",
        supported_efforts: [],
      },
      {
        model: "claude-sonnet-4-6",
        provider: "Anthropic",
        available: true,
        detail: "OAuth",
        supported_efforts: ["low", "medium", "high", "max"],
        default_effort: "medium",
      },
    ])
    expect(options).toHaveLength(3)
    expect(options[0]).toMatchObject({
      id: "claude-opus-5-5",
      provider: "Anthropic",
      recommended: true,
      supportedEfforts: ["low", "medium", "high", "max"],
      defaultEffort: "medium",
      contextWindow: 200_000,
    })
    expect(options[1]).toMatchObject({
      id: "gpt-6.1-sol",
      provider: "Rayu",
      apiMethod: "rayu",
      subtitle: "Rayu Cloud",
      recommended: true,
      supportedEfforts: ["none", "low", "medium", "high", "xhigh"],
      defaultEffort: "low",
    })
    expect(options[1].available).toBeUndefined()
    expect(options[2]).toMatchObject({
      id: "claude-sonnet-4-6",
      provider: "Anthropic",
      supportedEfforts: ["low", "medium", "high", "max"],
      defaultEffort: "medium",
    })
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

    // Synthetic cloud placeholder is suppressed, while real reasoning streams into the trace
    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "reasoning_delta", text: "Reasoning via Rayu Cloud..." },
        tracker
      )
    ).toEqual([])
    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "reasoning_delta", text: "Checking repository layout before editing." },
        tracker
      )
    ).toEqual([
      {
        type: "reasoning-delta",
        delta: "Checking repository layout before editing.",
      },
    ])

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
      groupTitle: "Read files, ran commands",
      step: {
        kind: "command",
        command: "Ran tests",
        displayCommand: "Ran tests",
        isMono: false,
        output: "ok",
        exitCode: 0,
      },
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

  it("formats elapsed seconds into minutes and hours without 60s or 1m 60s glitches", () => {
    expect(formatDurationSeconds(0)).toBe("1s")
    expect(formatDurationSeconds(21)).toBe("21s")
    expect(formatDurationSeconds(59.4)).toBe("59s")
    expect(formatDurationSeconds(59.6)).toBe("1m")
    expect(formatDurationSeconds(60)).toBe("1m")
    expect(formatDurationSeconds(61)).toBe("1m 1s")
    expect(formatDurationSeconds(119.6)).toBe("2m")
    expect(formatDurationSeconds(125)).toBe("2m 5s")
    expect(formatDurationSeconds(3661)).toBe("1h 1m 1s")
  })

  it("auto-promotes pre-tool text to a work note and unpacks Rust daemon batch calls into clean Codex steps", () => {
    const tracker = createHarnessStreamTracker()

    // Model streams a short preamble before calling tools
    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "text_delta", text: "I'll inspect the repository structure." },
        tracker
      )
    ).toEqual([
      { type: "answer-delta", delta: "I'll inspect the repository structure." },
    ])

    // When tool_start arrives, the preamble is automatically promoted into the work trace
    const startEvents = mapHarnessFrameToLiveEvents(
      { ev: "tool_start", call_id: "c_batch", name: "batch" },
      tracker
    )
    expect(startEvents[0]).toEqual({ type: "promote-note" })
    expect(startEvents[1]).toEqual({
      type: "tool-status",
      label: "Inspecting workspace...",
    })

    // Streamed JSON input for batch tool_calls
    mapHarnessFrameToLiveEvents(
      {
        ev: "tool_input_delta",
        call_id: "c_batch",
        delta: JSON.stringify({
          tool_calls: [
            { tool: "read", file_path: "README.md", intent: "Read README" },
            { tool: "ls", directory: "desktop", intent: "List desktop" },
            { tool: "bash", command: "git status --short", intent: "Check git" },
          ],
        }),
      },
      tracker
    )

    const doneEvents = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_done",
        call_id: "c_batch",
        name: "batch",
        output:
          "[batch timing: duration_ms=15 output_bytes=200] --- [1] read ---\n# RayuCode\n--- [2] ls ---\npackage.json\n--- [3] bash ---\nM desktop/src/App.tsx",
      },
      tracker
    )

    const steps = doneEvents.filter((e) => e.type === "step")
    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatchObject({
      type: "step",
      groupTitle: "Read files",
      step: { kind: "read", label: "Read", files: [{ file: "README.md" }] },
    })
    expect(steps[1]).toMatchObject({
      type: "step",
      groupTitle: "Read files",
      step: { kind: "list", text: "Listed files in", highlight: "desktop" },
    })
    expect(steps[2]).toMatchObject({
      type: "step",
      groupTitle: "Read files, ran commands",
      step: {
        kind: "command",
        command: "Check git",
        displayCommand: "Check git",
        isMono: false,
        output: "M desktop/src/App.tsx",
      },
    })
  })

  it("filters legacy unmarked Fable guardrail reconsideration and continuation prompts from user turns", () => {
    const turns = mapHistoryMessagesToTurns("s_fable", [
      { role: "user", content: "do this ordinary coding task" },
      {
        role: "user",
        content:
          "Reassess the user's request using its full context and likely intent rather than isolated keywords. Determine whether answering would enable a concrete harmful action.",
      },
      {
        role: "user",
        content:
          "Review the request again and distinguish legitimate coding, debugging, defensive, educational, or analytical work from instructions that facilitate harm.",
      },
      {
        role: "user",
        content:
          "Perform one final, independent policy check. Prefer a safe and useful constrained response when possible.",
      },
      {
        role: "user",
        content:
          "[System reminder: your previous response ended before completion (stop_reason: max_tokens). Continue.]",
      },
      { role: "assistant", content: "Reconsidered and completed safely" },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toBe("do this ordinary coding task")
    expect(turns[0].answerIntro).toBe("Reconsidered and completed safely")
  })

  it("maps HistoryMessage.tool metadata into concise human-readable tool rows without raw parameters", () => {
    const turns = mapHistoryMessagesToTurns("s_tool_meta", [
      { role: "user", content: "Run tests" },
      {
        role: "tool",
        content: "all tests passed",
        tool: { id: "t1", name: "bash", input: { command: "pnpm test" } },
      },
      { role: "assistant", content: "Done" },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].groups[0].steps[0]).toMatchObject({
      kind: "command",
      command: "Ran tests",
      displayCommand: "Ran tests",
      isMono: false,
      output: "all tests passed",
    })
  })

  it("deduplicates turn_done arriving right after turn_stopped so only one complete event emits", () => {
    const tracker = createHarnessStreamTracker()
    mapHarnessFrameToLiveEvents({ ev: "text_delta", text: "Answer" }, tracker)

    const stopped = mapHarnessFrameToLiveEvents(
      { ev: "turn_stopped", reason: "completed" },
      tracker
    )
    expect(stopped.filter((e) => e.type === "complete")).toHaveLength(1)

    const doneAfterStopped = mapHarnessFrameToLiveEvents(
      { ev: "turn_done" },
      tracker
    )
    expect(doneAfterStopped).toEqual([])
  })

  it("surfaces provider_guardrail frames as an honest decline notice", () => {
    const tracker = createHarnessStreamTracker()
    const events = mapHarnessFrameToLiveEvents(
      {
        ev: "provider_guardrail",
        stop_reason: "refusal",
        message: "Provider guardrail stopped the response (stop_reason: refusal).",
      },
      tracker
    )
    expect(events).toEqual([
      {
        type: "answer-delta",
        delta: "\n\nProvider guardrail stopped the response (stop_reason: refusal).",
      },
    ])
  })

  it("formats rayu: model specs once and preserves apiMethod on mapped routes", () => {
    expect(formatHarnessModelSpec("qwen4-max-preview", "rayu", "rayu")).toBe(
      "rayu:qwen4-max-preview"
    )
    expect(
      formatHarnessModelSpec("rayu:qwen4-max-preview", "Rayu", "rayu")
    ).toBe("rayu:qwen4-max-preview")
    expect(
      formatHarnessModelSpec("claude-sonnet-5", "Anthropic", "claude-oauth")
    ).toBe("claude-sonnet-5")

    const options = mapModelRoutesToOptions([
      {
        model: "rayu:qwen4-max-preview",
        provider: "Rayu",
        api_method: "rayu",
        available: true,
        detail: "Rayu Cloud",
      },
    ])
    expect(options).toEqual([
      {
        id: "rayu:qwen4-max-preview",
        label: "qwen4-max-preview",
        subtitle: "Rayu Cloud",
        provider: "Rayu",
        apiMethod: "rayu",
        recommended: true,
      },
    ])
  })

  it("identifies OS temp directory paths while keeping real project folders", () => {
    expect(isTempDirectoryPath("/tmp")).toBe(true)
    expect(isTempDirectoryPath("/tmp/rayu-split-test")).toBe(true)
    expect(isTempDirectoryPath("/private/tmp")).toBe(true)
    expect(isTempDirectoryPath("/private/tmp/foo")).toBe(true)
    expect(isTempDirectoryPath("/var/tmp/x")).toBe(true)
    expect(isTempDirectoryPath("/var/folders/ab/cd/T/foo")).toBe(true)
    expect(isTempDirectoryPath("/private/var/folders/ab/cd/T")).toBe(true)
    expect(isTempDirectoryPath("C:\\Temp\\proj")).toBe(true)
    expect(isTempDirectoryPath("C:\\Users\\me\\AppData\\Local\\Temp\\x")).toBe(
      true
    )

    expect(isTempDirectoryPath("/Users/alice/workspace/rayucode-v2")).toBe(
      false
    )
    expect(isTempDirectoryPath("~/workspace/rayu/rayucode-v2")).toBe(false)
    expect(isTempDirectoryPath("/Users/alice/projects/tmp-notes")).toBe(false)
    expect(isTempDirectoryPath("")).toBe(false)
    expect(isTempDirectoryPath(null)).toBe(false)
    expect(isTempDirectoryPath(undefined)).toBe(false)
  })

  it("preserves Rust sentinel-wrapped reasoning lines as reasoning timeline items in chronological order", () => {
    const turns = mapHistoryMessagesToTurns("s_reasoning", [
      { role: "user", content: "Fix the TTS pipeline" },
      {
        role: "assistant",
        content:
          "*\u{2063}Let me write a \\*smaller\\* debug script using \\`kok\\_test.py\\`.\u{2063}*  \n\nI will inspect the logs first.",
      },
      { role: "tool", content: "ok" },
      {
        role: "assistant",
        content:
          "*\u{2063}Actually, earlier run with \\`2>&1\\` printed nothing.\u{2063}*  \n\nLet me run the real pipeline.",
      },
      { role: "tool", content: "done" },
      {
        role: "assistant",
        content: "The TTS pipeline completed cleanly and generated output.wav.",
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].answerIntro).toBe(
      "The TTS pipeline completed cleanly and generated output.wav."
    )
    expect(turns[0].answerIntro).not.toContain("\u{2063}")
    expect(turns[0].answerIntro).not.toContain("I will inspect the logs first.")
    expect(turns[0].notes).toEqual([
      "I will inspect the logs first.",
      "Let me run the real pipeline.",
    ])
    expect(turns[0].groups[0].steps).toHaveLength(2)
    expect(turns[0].timeline).toEqual([
      expect.objectContaining({
        type: "reasoning",
        text: "Let me write a *smaller* debug script using `kok_test.py`.",
      }),
      expect.objectContaining({
        type: "note",
        text: "I will inspect the logs first.",
      }),
      expect.objectContaining({
        type: "group",
        group: expect.objectContaining({
          steps: [expect.objectContaining({ output: "ok" })],
        }),
      }),
      expect.objectContaining({
        type: "reasoning",
        text: "Actually, earlier run with `2>&1` printed nothing.",
      }),
      expect.objectContaining({
        type: "note",
        text: "Let me run the real pipeline.",
      }),
      expect.objectContaining({
        type: "group",
        group: expect.objectContaining({
          steps: [expect.objectContaining({ output: "done" })],
        }),
      }),
    ])
  })

  it("preserves historical reasoning-only and reasoning-plus-answer turns in timeline without dumping into notes", () => {
    const turns = mapHistoryMessagesToTurns("s_reasoning_only", [
      { role: "user", content: "Explain the cache invariant" },
      {
        role: "assistant",
        content:
          "*\u{2063}First, check LRU eviction.\u{2063}*  \n\n*\u{2063}Second, verify shard routing.\u{2063}*  \n\nThe cache invariant holds across all shards.",
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].notes).toEqual([])
    expect(turns[0].groups).toEqual([])
    expect(turns[0].answerIntro).toBe(
      "The cache invariant holds across all shards."
    )
    expect(turns[0].timeline).toEqual([
      expect.objectContaining({
        type: "reasoning",
        text: "First, check LRU eviction.\n\nSecond, verify shard routing.",
      }),
    ])
  })

  it("folds Background task stalled/progress/completed notifications, Swarm wakes, and auto-poke messages out of user bubbles", () => {
    const turns = mapHistoryMessagesToTurns("s_bg", [
      { role: "user", content: "Build the TTS pipeline" },
      { role: "assistant", content: "Starting background pipeline." },
      { role: "tool", content: "Started task 605588f8i8" },
      {
        role: "user",
        content:
          "**Background task stalled** `605588f8i8` · `Run full TTS + ASR pipeline` (`bash`) · no output or progress for 180s (running 180s total)\n\n_No output captured yet._",
      },
      {
        role: "user",
        content:
          "**Background task** `605588f8i8` · `bash` · ✓ completed · 12.0s · exit 0",
      },
      {
        role: "user",
        content:
          "You have 1 incomplete todo. Continue working, or update the todo tool.",
      },
      {
        role: "assistant",
        content: "Pipeline finished successfully.",
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toBe("Build the TTS pipeline")
    expect(turns[0].answerIntro).toBe("Pipeline finished successfully.")
    expect(turns[0].groups[0].steps.length).toBeGreaterThanOrEqual(3)
    expect(turns[0].hiddenInternalMessages).toEqual([
      expect.objectContaining({
        origin: "engine_internal",
        visibility: "hidden",
        content:
          "You have 1 incomplete todo. Continue working, or update the todo tool.",
      }),
    ])
  })

  it("settles ev: 'error' frames cleanly via settleHarnessErrorFrame and ignores duplicate terminal frames", () => {
    const tracker = createHarnessStreamTracker()
    tracker.turnActive = true
    tracker.turnCompleted = false
    tracker.lastCredits = "0.02 cr"
    tracker.lastKvCachePct = 88

    const events = mapHarnessFrameToLiveEvents(
      { ev: "error", message: "Upstream provider rate limited (429)" },
      tracker
    )

    expect(events).toEqual([
      { type: "tool-status", label: null },
      {
        type: "answer-delta",
        delta: "\n\n**Error:** Upstream provider rate limited (429)",
      },
      expect.objectContaining({
        type: "complete",
        credits: "0.02 cr",
        kvCachePct: 88,
        timestamp: "Just now",
      }),
    ])
    expect(tracker.turnActive).toBe(false)
    expect(tracker.turnCompleted).toBe(true)

    // Subsequent duplicate error or turn_done must not emit duplicate complete events
    expect(
      mapHarnessFrameToLiveEvents({ ev: "error", message: "duplicate" }, tracker)
    ).toEqual([])
    expect(mapHarnessFrameToLiveEvents({ ev: "turn_done" }, tracker)).toEqual([])
  })

  it("formats daemon version labels cleanly without double-prefixing or vrayu-* glitches", () => {
    expect(formatDaemonVersionLabel("2.0.0")).toBe("v2.0.0")
    expect(formatDaemonVersionLabel("v1.4.2")).toBe("v1.4.2")
    expect(formatDaemonVersionLabel("rayu-harness-api-bridge/0.1.0")).toBe(
      "v0.1.0"
    )
    expect(formatDaemonVersionLabel("")).toBe("")
  })

  it("handles v1.16 model_info, permission_mode_changed, config_changed, ToolDone.duration_ms, and TextDone.stop_reason", () => {
    const tracker = createHarnessStreamTracker()

    expect(
      mapHarnessFrameToLiveEvents(
        {
          ev: "model_info",
          session_id: "s1",
          model: "claude-opus-4-6",
          provider: "anthropic",
          reasoning_effort: "xhigh",
        },
        tracker
      )
    ).toEqual([
      {
        type: "model-info",
        sessionId: "s1",
        model: "claude-opus-4-6",
        provider: "anthropic",
        reasoningEffort: "xhigh",
      },
    ])

    expect(
      mapHarnessFrameToLiveEvents(
        {
          ev: "permission_mode_changed",
          session_id: "s1",
          mode: "plan",
        },
        tracker
      )
    ).toEqual([{ type: "permission-mode-changed", sessionId: "s1", mode: "plan" }])

    expect(
      mapHarnessFrameToLiveEvents(
        {
          ev: "config_changed",
          changed_keys: ["compaction.mode"],
          requires_restart: true,
          values: { "compaction.mode": "proactive" },
        },
        tracker
      )
    ).toEqual([
      {
        type: "config-changed",
        changedKeys: ["compaction.mode"],
        requiresRestart: true,
        values: { "compaction.mode": "proactive" },
      },
    ])

    const toolEvents = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_done",
        call_id: "c1",
        name: "bash",
        tool_input: { command: "echo hi" },
        tool_output: "hi",
        duration_ms: 142,
      },
      tracker
    )
    const stepEvent = toolEvents.find((e) => e.type === "step")
    expect(stepEvent && stepEvent.type === "step" && stepEvent.step.kind === "command" ? stepEvent.step.durationMs : undefined).toBe(142)

    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "text_done", session_id: "s1", stop_reason: "end_turn" },
        tracker
      )
    ).toEqual([{ type: "text-done", stopReason: "end_turn" }])
  })

  it("handles text_replace frames for partial rollback and full retraction", () => {
    const tracker = createHarnessStreamTracker()
    const replaceEvents = mapHarnessFrameToLiveEvents(
      { ev: "text_replace", session_id: "s1", text: "Corrected text" },
      tracker
    )
    expect(replaceEvents).toEqual([
      { type: "answer-replace", text: "Corrected text" },
    ])
    expect(tracker.turnActive).toBe(true)
    expect(tracker.hasStreamedTextInPhase).toBe(true)

    const retractEvents = mapHarnessFrameToLiveEvents(
      { ev: "text_replace", session_id: "s1", text: "" },
      tracker
    )
    expect(retractEvents).toEqual([{ type: "answer-replace", text: "" }])
    expect(tracker.hasStreamedTextInPhase).toBe(false)
  })

  it("surfaces TurnStopReason variants accurately (crash as Error, limit_reached/provider_guardrail plain, interrupted silent) and clears toolInputs", () => {
    const crashTracker = createHarnessStreamTracker()
    crashTracker.turnActive = true
    crashTracker.toolInputs.set("c1", '{"command":"echo hi"}')
    const crashEvents = mapHarnessFrameToLiveEvents(
      {
        ev: "turn_stopped",
        session_id: "s1",
        reason: "crash",
        message: "Worker panicked cleanly",
      },
      crashTracker
    )
    expect(crashEvents).toEqual([
      { type: "tool-status", label: null },
      { type: "answer-delta", delta: "\n\n**Error:** Worker panicked cleanly" },
      expect.objectContaining({ type: "complete" }),
    ])
    expect(crashTracker.toolInputs.size).toBe(0)

    const guardrailTracker = createHarnessStreamTracker()
    guardrailTracker.turnActive = true
    expect(
      mapHarnessFrameToLiveEvents(
        {
          ev: "turn_stopped",
          session_id: "s1",
          reason: "limit_reached",
          message: "Max turn limit reached.",
        },
        guardrailTracker
      )
    ).toEqual([
      { type: "tool-status", label: null },
      { type: "answer-delta", delta: "\n\nMax turn limit reached." },
      expect.objectContaining({ type: "complete" }),
    ])

    const interruptTracker = createHarnessStreamTracker()
    interruptTracker.turnActive = true
    expect(
      mapHarnessFrameToLiveEvents(
        {
          ev: "turn_stopped",
          session_id: "s1",
          reason: "interrupted",
          message: "The turn was interrupted by a cancellation request.",
        },
        interruptTracker
      )
    ).toEqual([
      { type: "tool-status", label: null },
      expect.objectContaining({ type: "complete" }),
    ])
  })
})
