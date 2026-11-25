import "@testing-library/jest-dom/vitest"
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
  EditorialMarkdown,
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

  it("renders animated 8-dot orbital RayuProcessingMark alongside live Working seconds when isLive is true", () => {
    const { container } = render(
      <WorkTrace
        workedDuration="4s"
        isLive
        notes={["Inspecting files..."]}
        groups={[]}
      />
    )

    const liveToggle = screen.getByRole("button", { name: /Working · 4s/i })
    expect(liveToggle.getAttribute("aria-expanded")).toBe("true")
    const mark = container.querySelector('[data-slot="rayu-processing-mark"]')
    expect(mark).toBeTruthy()
    expect(mark?.getAttribute("data-animated")).toBe("true")
    expect(mark?.querySelectorAll("circle").length).toBe(8)
    expect(screen.getByText(/Inspecting files/i)).toBeTruthy()
  })

  it("collapses completed timeline process to Worked for Xs until clicked", () => {
    render(
      <WorkTrace
        workedDuration="4s"
        isLive={false}
        notes={[]}
        groups={[]}
        timeline={[
          { id: "tl_note_1", type: "note", text: "Checked workspace files." },
        ]}
      />
    )

    const toggle = screen.getByRole("button", { name: /Worked for 4s/i })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText(/Checked workspace files/i)).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText(/Checked workspace files/i)).toBeTruthy()
  })

  it("shows live Thinking micro-interaction while streaming before first tool or note", () => {
    render(
      <WorkTrace
        workedDuration="1s"
        isLive
        notes={[]}
        groups={[]}
        timeline={[]}
      />
    )

    expect(screen.getByTestId("work-thinking-indicator")).toHaveTextContent(
      /Thinking\.\.\./i
    )
  })

  it("renders model reasoning timeline items cleanly inside WorkTrace", () => {
    render(
      <WorkTrace
        workedDuration="3s"
        isLive
        notes={[]}
        groups={[]}
        timeline={[
          {
            type: "reasoning",
            id: "r_desktop_1",
            text: "Checking the session dedup logic before touching the composer.",
          },
        ]}
      />
    )

    expect(screen.getByTestId("work-reasoning").textContent).toContain(
      "Checking the session dedup logic before touching the composer."
    )
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
    expect(screen.queryByText("0.42 cr")).toBeNull()
    expect(screen.queryByText("94% KV cache")).toBeNull()
    expect(screen.queryByText("Simulate live run")).toBeNull()

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

  it("renders Computer Use permission approval card for Microsoft PowerPoint and opens Slide Studio on approval", async () => {
    const queryClient = createQueryClient()
    useAppStore.getState().setPendingPermission({
      sessionId: "ses_retire_cache",
      requestId: "req_ppt_1",
      toolName: "Computer Use",
      description: "Allow RayuCode to use Microsoft PowerPoint?",
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ChatStream turns={[SAMPLE_TURN]} />
      </QueryClientProvider>
    )

    const banner = screen.getByTestId("live-permission-banner")
    expect(banner).toHaveTextContent("Computer Use")
    expect(banner).toHaveTextContent(
      "Allow RayuCode to use Microsoft PowerPoint?"
    )
    expect(
      screen.getByTestId("permission-always-allow-btn")
    ).toHaveTextContent("Always allow")
    expect(screen.getByTestId("permission-deny-btn")).toHaveTextContent("Deny")

    fireEvent.click(screen.getByTestId("permission-allow-conversation-btn"))

    await waitFor(() => {
      expect(useAppStore.getState().pendingPermission).toBeNull()
      expect(useAppStore.getState().activeRightTab).toBe("slide")
      expect(useAppStore.getState().activeDocPill).toBe("Slide")
    })
  })

  it("renders EditorialMarkdown with semantic chromatic code pills, syntax-highlighted code blocks, and GFM tables", () => {
    const md = [
      "## Architecture",
      "",
      "Inspect `desktop/src/` and `desktop/electron/main.ts` with `RayuDaemonClient` via `pnpm verify`.",
      "",
      "| Layer | File |",
      "| --- | --- |",
      "| Main | `main.ts` |",
      "",
      "```ts",
      'const status = "ready"',
      "```",
    ].join("\n")

    const { container } = render(<EditorialMarkdown content={md} />)
    expect(container.querySelector('[data-code-kind="folder"]')).toHaveTextContent(
      "desktop/src/"
    )
    expect(container.querySelector('[data-code-kind="file-ts"]')).toHaveTextContent(
      "desktop/electron/main.ts"
    )
    expect(
      container.querySelector('[data-code-kind="component"]')
    ).toHaveTextContent("RayuDaemonClient")
    expect(
      container.querySelector('[data-code-kind="command"]')
    ).toHaveTextContent("pnpm verify")
    expect(container.querySelector('[data-slot="markdown-table"]')).toBeTruthy()
    expect(
      container.querySelector('[data-slot="markdown-code-block"]')
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument()
  })

  it("renders Mermaid flowchart LR visually in EditorialMarkdown, toggles Preview/Code, opens in right sidebar, and makes file/folder/diagram pills clickable", () => {
    const md = [
      "See `desktop/electron/main.ts`, folder `desktop/src/`, and the `flowchart` below:",
      "",
      "```mermaid",
      "flowchart LR",
      '  subgraph Renderer["Renderer: React 19 + Vite"]',
      "    UI[Feature views] --> IPC[ipc-client facade]",
      "    IPC --> Store[Zustand app-store]",
      "    IPC --> Batch[16ms stream batcher]",
      "  end",
      '  subgraph Preload["preload.cjs (sandboxed)"]',
      '    Bridge["contextBridge: window.rayu"]',
      "  end",
      '  subgraph Main["Electron main"]',
      "    H[56 IPC handlers + Zod]",
      "    DC[RayuDaemonClient]",
      "  end",
      "  UI --> Bridge --> H",
      "  H --> DC",
      "  Batch --> UI",
      "```",
    ].join("\n")

    const { container } = render(<EditorialMarkdown content={md} />)

    // Mermaid visual SVG renders immediately in Preview mode with subgraphs and nodes
    const mermaidCard = container.querySelector(
      '[data-slot="markdown-mermaid-block"]'
    )
    expect(mermaidCard).toBeTruthy()
    expect(mermaidCard?.querySelector('svg[role="img"]')).toBeTruthy()
    expect(
      mermaidCard?.querySelector('[data-subgraph-id="Renderer"]')
    ).toBeTruthy()
    expect(
      mermaidCard?.querySelector('[data-subgraph-id="Preload"]')
    ).toBeTruthy()
    expect(mermaidCard?.querySelector('[data-subgraph-id="Main"]')).toBeTruthy()
    expect(mermaidCard?.querySelector('[data-node-id="Bridge"]')).toBeTruthy()

    // Toggle to Code view and back to Preview
    fireEvent.click(screen.getByTestId("inline-mermaid-code-btn"))
    expect(mermaidCard).toHaveAttribute("data-view-mode", "code")
    fireEvent.click(screen.getByTestId("inline-mermaid-preview-btn"))
    expect(mermaidCard).toHaveAttribute("data-view-mode", "preview")

    // Open diagram in right sidebar
    fireEvent.click(screen.getByTestId("mermaid-open-sidebar-btn"))
    expect(useAppStore.getState().activeRightTab).toBe("diagram")
    expect(useAppStore.getState().rightMode).toBe("document")
    expect(useAppStore.getState().activeDiagram.source).toContain("flowchart LR")

    // Clicking a highlighted file pill opens that file in Code viewer
    const filePill = container.querySelector('[data-code-kind="file-ts"]')
    expect(filePill).toBeTruthy()
    fireEvent.click(filePill!)
    expect(useAppStore.getState().activeRightTab).toBe("code")
    expect(useAppStore.getState().activeCodeFile).toBe(
      "desktop/electron/main.ts"
    )

    // Clicking a highlighted folder pill opens the Files sidebar tab
    const folderPill = container.querySelector('[data-code-kind="folder"]')
    expect(folderPill).toBeTruthy()
    fireEvent.click(folderPill!)
    expect(useAppStore.getState().activeRightTab).toBe("files")

    // Clicking the highlighted diagram pill reopens the Diagram preview with the Mermaid source
    const diagramPill = container.querySelector('[data-code-kind="diagram"]')
    expect(diagramPill).toBeTruthy()
    fireEvent.click(diagramPill!)
    expect(useAppStore.getState().activeRightTab).toBe("diagram")
    expect(useAppStore.getState().activeDiagram.source).toContain("Renderer")
  })

  it("uses a single theme accent color (text-brand-text) for all file and folder links in chat and does not turn plain diagram words into diagram cards", () => {
    const md =
      "Check `desktop/src/`, `main.ts`, `Cargo.toml`, `README.md`, `package.json`, and the word `diagram`."
    const { container } = render(<EditorialMarkdown content={md} />)

    const fileButtons = container.querySelectorAll(
      '[data-code-kind="folder"], [data-code-kind="file-ts"], [data-code-kind="file-rust"], [data-code-kind="file-doc"], [data-code-kind="file-data"]'
    )
    expect(fileButtons.length).toBe(5)
    for (const btn of fileButtons) {
      expect(btn.className).toContain("text-brand-text")
      expect(btn.className).not.toContain("text-folder")
      expect(btn.className).not.toContain("text-code-fn")
      expect(btn.className).not.toContain("text-code-num")
      expect(btn.className).not.toContain("text-code-type")
      expect(btn.className).not.toContain("text-office-excel")
    }

    // Without a Mermaid block in the message, `diagram` stays plain inline code
    expect(container.querySelector('[data-code-kind="diagram"]')).toBeNull()
  })
})
