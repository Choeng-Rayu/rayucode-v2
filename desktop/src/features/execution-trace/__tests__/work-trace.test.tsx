import { QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import {
  ChatStream,
  CiteLink,
  InlineDiffCard,
  ShellCard,
  TurnActions,
  useLiveTrace,
  WorkTrace,
  type ExecutionTurn,
  type ShellCommandStep,
} from "../index"

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const SAMPLE_SHELL_OK: ShellCommandStep = {
  id: "sh_cmd_2",
  kind: "command",
  command: "cargo test -p rayucode session:: -- --nocapture",
  displayCommand: "cargo test -p rayucode session:: -- --nocapture",
  output:
    "running 14 tests\ntest session::lookup::routes_via_shard_store ... ok\ntest result: ok. 14 passed; 0 failed",
  exitCode: 0,
  statusLabel: "Success",
  isMono: true,
}

const SAMPLE_SHELL_FAIL: ShellCommandStep = {
  id: "sh_cmd_0",
  kind: "command",
  command: "git status --short && rg --files -g 'cache.rs'",
  displayCommand:
    "Command failed (git status --short && rg --files -g 'cache.rs')",
  output: "rg: No files were searched.",
  exitCode: 1,
  statusLabel: "Exit 1 · retried with fd/grep",
  isFailed: true,
}

const SAMPLE_TURN: ExecutionTurn = {
  id: "turn_test_1",
  sessionId: "ses_retire_cache",
  compactedNotice: "Context automatically compacted",
  userRefFiles: "src/session/cache.rs · src/shard/store.rs",
  userPrompt:
    "Retire `SessionCache` in `src/session/cache.rs` and route reads through `ShardStore::lookup`.",
  workedDuration: "1m 25s",
  notes: [
    "I'll audit all `SessionCache` callers across `rayucode-v2` before editing.",
    "Routing through `ShardStore::lookup` passes all 14 unit tests.",
  ],
  groups: [
    {
      id: "wg_1",
      title: "Read files, ran commands",
      steps: [
        SAMPLE_SHELL_FAIL,
        {
          id: "rd_1",
          kind: "read",
          label: "Read",
          files: [
            {
              file: "cache.rs",
              path: "src/session/cache.rs",
              line: 1,
              rangeLabel: "src/session/cache.rs:1-6",
            },
            {
              file: "store.rs",
              path: "src/shard/store.rs",
              line: 15,
              rangeLabel: "src/shard/store.rs:14-23",
            },
          ],
        },
        SAMPLE_SHELL_OK,
      ],
    },
    {
      id: "wg_2",
      title: "Read files, ran commands",
      steps: [
        {
          id: "pv_1",
          kind: "previews",
          text: "Viewed 3 previews",
          previews: [
            {
              id: "thumb_browser",
              kind: "browser",
              badge: ":3000",
              label: "Dashboard UI",
              pillLabel: "localhost:3000",
            },
            {
              id: "thumb_excel",
              kind: "excel",
              badge: ".xlsx",
              label: "Token-Cost-Model",
              pillLabel: "Q4-Token-Cost-Model.xlsx",
            },
            {
              id: "thumb_md",
              kind: "markdown",
              badge: ".md",
              label: "MIGRATION_PLAN",
              pillLabel: "MIGRATION_PLAN.md",
            },
          ],
        },
      ],
    },
  ],
  answerIntro:
    "**Done — safe to ship without data migration.** All session reads now route through `ShardStore::lookup`.",
  answerSummaryTitle: "Summary of changes",
  answerBullets: [
    {
      id: "b1",
      title: "Routed reads through ShardStore.",
      body: "Replaced `self.cache.read().get(key)` with `self.shards.lookup(key)?`.",
      citations: [
        {
          label: "lookup.rs (line 21)",
          kind: "code",
          file: "lookup.rs",
          line: 21,
        },
      ],
    },
    {
      id: "b2",
      title: "Synced previews & cost model.",
      body: "Refreshed workbook and dashboard preview.",
      citations: [
        {
          label: "Token-Cost-Model.xlsx",
          kind: "excel",
          file: "Q4-Token-Cost-Model.xlsx",
        },
      ],
    },
  ],
  diffCard: {
    id: "diff_lookup_rs",
    file: "src/session/lookup.rs",
    additions: 19,
    deletions: 12,
    ownerBadge: "worker-1",
    hint: "1 of 3 changed files · 14/14 tests passed",
    lines: [
      {
        lineNumber: null,
        type: "hunk",
        mark: "",
        content: "@@ -18,14 +18,19 @@ impl SessionLookup {",
      },
      {
        lineNumber: 19,
        type: "del",
        mark: "−",
        content: "         self.cache.read().get(key).cloned()",
      },
      {
        lineNumber: 19,
        type: "add",
        mark: "+",
        content: "         let hit = self.shards.lookup(key)?;",
      },
    ],
  },
  timestamp: "2m ago",
  credits: "0.42 cr",
  kvCachePct: 94,
  pinned: false,
}

describe("execution-trace feature", () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    useAppStore.setState({
      theme: "dark",
      accent: "green",
      activeRoute: "workspace",
      activeSessionId: "ses_retire_cache",
      leftCollapsed: false,
      rightCollapsed: false,
      rightMode: "context",
      activeRightTab: "overview",
      activeDocPill: null,
      activeCodeFile: "lookup.rs",
      activeCodeLine: 21,
      fullView: false,
    })

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    })
    writeTextMock.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("expands WorkTrace to reveal notes, tool rail groups, file links, and preview thumbnails", () => {
    render(
      <WorkTrace
        workedDuration={SAMPLE_TURN.workedDuration}
        notes={SAMPLE_TURN.notes}
        groups={SAMPLE_TURN.groups}
      />
    )

    const toggle = screen.getByRole("button", { name: /Worked for 1m 25s/i })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText(/Read files, ran commands/i)).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(
      screen.getAllByText(/Read files, ran commands/i).length
    ).toBeGreaterThanOrEqual(2)

    const cacheLink = screen.getByRole("button", {
      name: "src/session/cache.rs:1-6",
    })
    fireEvent.click(cacheLink)
    expect(useAppStore.getState().activeRightTab).toBe("code")
    expect(useAppStore.getState().activeCodeFile).toBe("cache.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(1)

    const excelThumb = screen.getByRole("button", {
      name: /\.xlsx.*Token-Cost-Model/i,
    })
    fireEvent.click(excelThumb)
    expect(useAppStore.getState().activeRightTab).toBe("excel")
    expect(useAppStore.getState().activeDocPill).toBe(
      "Q4-Token-Cost-Model.xlsx"
    )
  })

  it("renders pulsing live Working indicator when isLive is true", () => {
    render(
      <WorkTrace
        workedDuration="4s"
        isLive
        notes={["Inspecting files..."]}
        groups={[]}
      />
    )

    const liveToggle = screen.getByRole("button", { name: /Working · 4s/i })
    expect(liveToggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText(/Inspecting files/i)).toBeTruthy()
  })

  it("expands ShellCard inline, displays success/failure status, and copies command output", async () => {
    render(
      <div>
        <ShellCard step={SAMPLE_SHELL_OK} />
        <ShellCard step={SAMPLE_SHELL_FAIL} />
      </div>
    )

    const okToggle = screen.getByRole("button", {
      name: /\$ cargo test -p rayucode session:: -- --nocapture/i,
    })
    expect(okToggle.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(okToggle)
    expect(okToggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Shell")).toBeTruthy()
    expect(screen.getByText("Success")).toBeTruthy()
    expect(screen.getByText(/14 passed; 0 failed/)).toBeTruthy()

    const copyButton = screen.getByRole("button", { name: "Copy command" })
    fireEvent.click(copyButton)
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining("cargo test -p rayucode session::")
      )
    })

    const failToggle = screen.getByRole("button", {
      name: /Command failed/i,
    })
    fireEvent.click(failToggle)
    expect(screen.getByText("Exit 1 · retried with fd/grep")).toBeTruthy()
  })

  it("navigates code and document previews from CiteLink clicks", () => {
    render(
      <div>
        <CiteLink
          citation={{
            label: "lookup.rs (line 21)",
            kind: "code",
            file: "lookup.rs",
            line: 21,
          }}
        />
        <CiteLink
          citation={{
            label: "MIGRATION_PLAN.md",
            kind: "markdown",
            file: "MIGRATION_PLAN.md",
          }}
        />
      </div>
    )

    fireEvent.click(
      screen.getByRole("button", { name: /lookup\.rs \(line 21\)/i })
    )
    expect(useAppStore.getState().activeRightTab).toBe("code")
    expect(useAppStore.getState().activeCodeFile).toBe("lookup.rs")
    expect(useAppStore.getState().activeCodeLine).toBe(21)

    fireEvent.click(
      screen.getByRole("button", { name: /MIGRATION_PLAN\.md/i })
    )
    expect(useAppStore.getState().activeRightTab).toBe("markdown")
    expect(useAppStore.getState().activeDocPill).toBe("MIGRATION_PLAN.md")
  })

  it("handles Accept, Reject, Undo, and VS Code handoff in InlineDiffCard", async () => {
    const openVsCodeSpy = vi
      .spyOn(ipcClient.native, "openInVSCode")
      .mockResolvedValue({ ok: true })

    render(<InlineDiffCard diff={SAMPLE_TURN.diffCard} />)

    expect(screen.getByText("src/session/lookup.rs")).toBeTruthy()
    expect(screen.getByText("+19")).toBeTruthy()
    expect(screen.getByText("−12")).toBeTruthy()
    expect(screen.getByText("worker-1")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "VS Code" }))
    await waitFor(() => {
      expect(openVsCodeSpy).toHaveBeenCalledWith("src/session/lookup.rs", 19)
    })

    fireEvent.click(screen.getByRole("button", { name: /Accept/i }))
    expect(screen.getByText("Accepted · staged for commit")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    expect(
      screen.getByText("1 of 3 changed files · 14/14 tests passed")
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Reject" }))
    expect(screen.getByText("Rejected · rayu will revise")).toBeTruthy()
  })

  it("supports Copy, Fork from here, and Pin actions in TurnActions", async () => {
    const forkSpy = vi.spyOn(ipcClient.trace, "forkTurn")
    const pinSpy = vi.spyOn(ipcClient.trace, "togglePin")
    const onForked = vi.fn()

    render(
      <TurnActions
        sessionId="ses_retire_cache"
        turnId="turn_retire_cache_1"
        responseMarkdown="Done — safe to ship."
        timestamp="2m ago"
        credits="0.42 cr"
        kvCachePct={94}
        onForked={onForked}
      />
    )

    expect(screen.getByText("2m ago")).toBeTruthy()
    expect(screen.getByText("0.42 cr")).toBeTruthy()
    expect(screen.getByText("94% KV cache")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Copy response" }))
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("Done — safe to ship.")
    })

    fireEvent.click(screen.getByRole("button", { name: "Fork from here" }))
    await waitFor(() => {
      expect(forkSpy).toHaveBeenCalledWith("turn_retire_cache_1")
      expect(onForked).toHaveBeenCalled()
    })

    const pinButton = screen.getByRole("button", { name: "Pin response" })
    expect(pinButton.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(pinButton)
    await waitFor(() => {
      expect(pinSpy).toHaveBeenCalledWith("turn_retire_cache_1")
      expect(pinButton.getAttribute("aria-pressed")).toBe("true")
    })
  })

  it("batches streaming trace events at 16ms cadence in useLiveTrace", () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()

    const { result } = renderHook(() =>
      useLiveTrace({ batchWindowMs: 16, onComplete })
    )

    act(() => {
      result.current.startLiveTurn({
        sessionId: "ses_retire_cache",
        userPrompt: "Run tests",
      })
    })

    expect(result.current.isStreaming).toBe(true)

    act(() => {
      result.current.pushEvent({ type: "note", text: "Checking session tests" })
      result.current.pushEvent({ type: "answer-delta", delta: "Done. " })
      result.current.pushEvent({ type: "answer-delta", delta: "All green." })
    })

    // Still queued until 16ms frame window fires
    expect(result.current.liveTurn?.answerIntro).toBe("")

    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(result.current.liveTurn?.notes).toEqual(["Checking session tests"])
    expect(result.current.liveTurn?.answerIntro).toBe("Done. All green.")

    act(() => {
      result.current.pushEvent({
        type: "complete",
        workedDuration: "3s",
        credits: "0.09 cr",
      })
      vi.advanceTimersByTime(16)
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.liveTurn?.workedDuration).toBe("3s")
  })

  it("renders ChatStream with turn content and bottom composerSlot", () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <ChatStream
          turns={[SAMPLE_TURN]}
          composerSlot={<div data-testid="mock-composer">Composer Dock</div>}
        />
      </QueryClientProvider>
    )

    expect(screen.getByText("Context automatically compacted")).toBeTruthy()
    expect(
      screen.getByText("src/session/cache.rs · src/shard/store.rs")
    ).toBeTruthy()
    expect(screen.getByText("Summary of changes")).toBeTruthy()
    expect(screen.getByText("Routed reads through ShardStore.")).toBeTruthy()
    expect(screen.getByTestId("mock-composer")).toBeTruthy()
  })
})
