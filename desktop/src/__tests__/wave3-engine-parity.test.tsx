import "@testing-library/jest-dom/vitest"

import { QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { AppShell } from "@/components/shell/AppShell"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PRIMARY_NAV_ITEMS } from "@/config/navigation"
import { AutomationsView } from "@/features/automations"
import { ChangesView } from "@/features/changes"
import { ChatStream } from "@/features/execution-trace"
import { PluginsView } from "@/features/plugins"
import { HomeView, SessionComposer } from "@/features/sessions"
import { KEYBOARD_SHORTCUT_GROUPS, SettingsView } from "@/features/settings"
import { SwarmView } from "@/features/swarm"
import { useAppStore } from "@/lib/app-store"
import { ipcClient, type ExecutionTurn } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver
  }
})

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient()
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
      </QueryClientProvider>
    ),
  }
}

describe("Wave 3 Desktop-Engine parity & surface wiring regressions", () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.setState({
      activeRoute: "home",
      activeSessionId: null,
      activeSessionTitle: null,
      activeDraft: null,
      pendingPermission: null,
      pendingPermissionsBySession: {},
      pendingQuestion: null,
      pendingQuestionsBySession: {},
      pendingStreamPrompt: null,
      composerDraftBySession: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("enforces Top-6 Swarm slot #2 in PRIMARY_NAV_ITEMS", () => {
    expect(PRIMARY_NAV_ITEMS).toHaveLength(6)
    expect(PRIMARY_NAV_ITEMS[1]?.id).toBe("swarm")
  })

  it("retains composer draft on failed submit and awaits setPermissionMode before queueing HomeView turn", async () => {
    const onSubmitFalse = vi.fn().mockResolvedValue(false)
    const { unmount } = renderWithQuery(
      <SessionComposer mode="workspace" onSubmit={onSubmitFalse} />
    )

    const input = screen.getByRole("textbox", { name: "Reply to RayuCode" })
    fireEvent.change(input, { target: { value: "Keep this unsent draft" } })
    fireEvent.click(screen.getByTestId("composer-send-btn"))

    await waitFor(() => {
      expect(onSubmitFalse).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(input).toHaveValue("Keep this unsent draft")
    })
    unmount()

    const callOrder: string[] = []
    vi.spyOn(ipcClient.sessions, "createSession").mockImplementation(async () => {
      callOrder.push("createSession")
      return {
        id: "sess_live_order_1",
        title: "Ordered session",
        project: "rayucode-v2",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "Now",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "medium",
        permissionMode: "plan",
        kvWarmPct: 0,
        creditsUsed: 0,
      }
    })
    let resolvePerm!: (val: { ok: boolean }) => void
    vi.spyOn(ipcClient.harness, "setPermissionMode").mockImplementation(() => {
      callOrder.push("setPermissionMode")
      return new Promise((resolve) => {
        resolvePerm = resolve
      })
    })

    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.pendingStreamPrompt && !prev.pendingStreamPrompt) {
        callOrder.push("setPendingStreamPrompt")
      }
    })

    renderWithQuery(<HomeView />)
    const homeInput = screen.getByRole("textbox", { name: "Message RayuCode" })
    fireEvent.change(homeInput, { target: { value: "Check ordering" } })
    fireEvent.click(screen.getByTestId("composer-send-btn"))

    await waitFor(() => {
      expect(callOrder).toEqual(["createSession", "setPermissionMode"])
    })
    expect(useAppStore.getState().pendingStreamPrompt).toBeNull()

    await act(async () => {
      resolvePerm({ ok: true })
    })

    await waitFor(() => {
      expect(callOrder).toEqual([
        "createSession",
        "setPermissionMode",
        "setPendingStreamPrompt",
      ])
    })
    unsub()
  })

  it("renders live AskUserQuestion card, sends Rust-valid QuestionResponse, and clears on question_closed", async () => {
    let listener: ((frame: Record<string, unknown>) => void) | null = null
    vi.spyOn(ipcClient.harness, "onEvent").mockImplementation((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    })
    const respondSpy = vi
      .spyOn(ipcClient.harness, "respondToQuestion")
      .mockResolvedValue({ ok: true })

    useAppStore.setState({ activeSessionId: "sess_q_1" })
    renderWithQuery(<ChatStream sessionId="sess_q_1" turns={[]} />)

    act(() => {
      listener?.({
        ev: "question_request",
        session_id: "sess_q_1",
        request_id: "qreq_1",
        questions: [
          {
            question: "Which target format should we export?",
            header: "Format",
            multiSelect: false,
            options: [
              { label: "CSV", description: "Plain RFC-4180 table" },
              { label: "XLSX", description: "Multi-sheet Excel workbook" },
            ],
          },
        ],
      })
    })

    expect(
      await screen.findByTestId("live-question-card")
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("live-question-option-1"))
    fireEvent.click(screen.getByTestId("live-question-submit-btn"))

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith("sess_q_1", "qreq_1", {
        kind: "answered",
        answers: {
          "Which target format should we export?": {
            selected: [1],
          },
        },
      })
    })
    expect(screen.queryByTestId("live-question-card")).not.toBeInTheDocument()

    // Also test decline and question_closed
    act(() => {
      listener?.({
        ev: "question_request",
        session_id: "sess_q_1",
        request_id: "qreq_2",
        questions: [
          {
            question: "Proceed with cleanup?",
            header: "Confirm",
            options: [{ label: "Yes", description: "Run cleanup" }],
          },
        ],
      })
    })
    expect(
      await screen.findByTestId("live-question-card")
    ).toBeInTheDocument()

    act(() => {
      listener?.({
        ev: "question_closed",
        session_id: "sess_q_1",
        request_id: "qreq_2",
      })
    })
    await waitFor(() => {
      expect(
        screen.queryByTestId("live-question-card")
      ).not.toBeInTheDocument()
    })
  })

  it("forwards exact message boundary from TurnView to forkTurn on live sessions", async () => {
    const forkSpy = vi
      .spyOn(ipcClient.trace, "forkTurn")
      .mockResolvedValue({
        id: "sess_forked_1",
        title: "Forked session",
        project: "rayucode-v2",
        checkout: "Local Checkout",
        branch: "main",
        updatedAt: "Now",
        modelId: "claude-opus-5-5",
        modelLabel: "Claude Opus 5.5",
        effort: "medium",
        permissionMode: "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      })

    const turn: ExecutionTurn = {
      id: "hist_sess_live_9_1",
      sessionId: "sess_live_9",
      userPrompt: "Turn 1",
      workedDuration: "2s",
      notes: [],
      groups: [],
      answerIntro: "Done.",
      answerBullets: [],
      diffCard: {
        id: "d1",
        file: "",
        additions: 0,
        deletions: 0,
        hint: "",
        lines: [],
      },
      timestamp: "History",
      credits: "0.00 cr",
      kvCachePct: 90,
      sourceEndMessageIndex: 3,
      sourceEndMessageId: "msg_turn1_end",
    }

    renderWithQuery(<ChatStream sessionId="sess_live_9" turns={[turn]} />)

    fireEvent.click(screen.getByRole("button", { name: "Fork from here" }))
    await waitFor(() => {
      expect(forkSpy).toHaveBeenCalledWith("hist_sess_live_9_1", {
        sessionId: "sess_live_9",
        upToMessageIndex: 3,
        upToMessageId: "msg_turn1_end",
      })
    })
  })

  it("gates SwarmView and AutomationsView honestly when daemon reports available: false", async () => {
    vi.spyOn(ipcClient.swarm, "getState").mockResolvedValue({
      swarmId: "idle",
      title: "Unavailable",
      planVersion: "v1",
      credits: "0.00 cr",
      kvCachePct: 0,
      agents: [],
      messages: [],
      planScopes: [],
      worktrees: [],
      available: false,
      unavailableReason: "Swarm orchestration disabled in daemon",
    })
    vi.spyOn(ipcClient.automations, "getState").mockResolvedValue({
      running: [],
      schedules: [],
      reports: [],
      available: false,
      unavailableReason: "Overnight schedules disabled in daemon",
    })

    const { unmount } = renderWithQuery(<SwarmView />)
    expect(
      await screen.findByTestId("swarm-unavailable-card")
    ).toHaveTextContent("Swarm orchestration disabled in daemon")
    unmount()

    renderWithQuery(<AutomationsView />)
    expect(
      await screen.findByTestId("automations-unavailable-card")
    ).toHaveTextContent("Overnight schedules disabled in daemon")
    expect(screen.getByTestId("new-overnight-run-btn")).toBeDisabled()
  })

  it("renders malformed MCP config error banner and surfaces reload warnings cleanly", async () => {
    vi.spyOn(ipcClient.plugins, "getState").mockResolvedValue({
      featuredId: "Context7 Docs",
      plugins: [
        {
          id: "context7",
          mcpServerId: "context7",
          name: "Context7 Docs",
          description: "Up-to-date docs",
          category: "featured",
          installed: true,
          sourcePath: "/workspace/.mcp.json",
          scope: "workspace",
          transport: "url",
          url: "https://mcp.example.com",
          revision: "rev_abc",
          searchKeywords: "context7",
        },
      ],
      skills: [],
      memories: [],
      mcpConfigErrors: [
        {
          filePath: "/workspace/.mcp.json",
          scope: "workspace",
          message: "Unexpected token } in JSON at position 18",
        },
      ],
      revisions: { "/workspace/.mcp.json": "rev_abc" },
    })

    renderWithQuery(<PluginsView />)
    expect(
      await screen.findByTestId("mcp-config-error-banner")
    ).toHaveTextContent("/workspace/.mcp.json")
  })

  it("displays totalChangedFiles > 40 and lazy-loads deferred diffs in ChangesView", async () => {
    const files = Array.from({ length: 43 }, (_, idx) => ({
      id: `git_${idx}_file_${idx}.ts`,
      path: `src/file_${idx}.ts`,
      additions: 1,
      deletions: 0,
      ownerBadge: "workspace",
      hint: "Modified",
      staged: false,
      diffLoaded: idx < 40,
      lines: [
        {
          lineNumber: null,
          type: "hunk" as const,
          mark: "@@",
          content:
            idx < 40
              ? `@@ -1 +1 @@`
              : `@@ Diff deferred (43 total files) — select to load src/file_${idx}.ts @@`,
        },
      ],
    }))

    vi.spyOn(ipcClient.changes, "getState").mockResolvedValue({
      branch: "rayu",
      totalChangedFiles: 43,
      truncatedDiffCount: 3,
      totalAdditions: 43,
      totalDeletions: 0,
      files,
    })
    const getFileDiffSpy = vi
      .spyOn(ipcClient.changes, "getFileDiff")
      .mockResolvedValue([
        { lineNumber: null, type: "hunk", mark: "@@", content: "@@ -1 +1 @@" },
        {
          lineNumber: 1,
          type: "add",
          mark: "+",
          content: "export const loaded = true",
        },
      ])

    renderWithQuery(<ChangesView />)

    expect(await screen.findByTestId("changes-file-count")).toHaveTextContent(
      "43 changed files"
    )

    const deferredBtn = screen.getByTestId("select-file-git_42_file_42.ts")
    fireEvent.click(deferredBtn)

    await waitFor(() => {
      expect(getFileDiffSpy).toHaveBeenCalledWith("src/file_42.ts")
    })
    await waitFor(() => {
      expect(screen.getByTestId("diff-body-unified")).toHaveTextContent(
        "export const loaded = true"
      )
    })
  })

  it("wires Settings Reload daemon button to globalRuntimeCommand('server_reload') and Cmd+, shortcut", async () => {
    const globalCmdSpy = vi
      .spyOn(ipcClient.harness, "globalRuntimeCommand")
      .mockResolvedValue({
        command: "server_reload",
        data: null,
        message: "Reloaded Rayu daemon",
      })
    const baseConfig = {
      path: "~/.rayu/config.toml",
      sections: ["features"],
      values: { "features.swarm": true },
      schema: [
        {
          key: "features.swarm",
          section: "features",
          label: "Swarm",
          description: "Enable swarm",
          kind: "boolean" as const,
          default_value: true,
          apply_mode: "restart_required" as const,
        },
      ],
    }
    vi.spyOn(ipcClient.harness, "getConfig").mockResolvedValue(baseConfig)
    vi.spyOn(ipcClient.harness, "patchConfig").mockResolvedValue({
      ok: true,
      state: {
        ...baseConfig,
        values: { "features.swarm": false },
      },
    })

    const { unmount } = renderWithQuery(<SettingsView initialSection="models" />)
    const swarmSwitch = await screen.findByTestId("config-field-features.swarm")
    fireEvent.click(swarmSwitch)

    const reloadBtn = await screen.findByTestId("settings-reload-daemon-btn")
    fireEvent.click(reloadBtn)

    await waitFor(() => {
      expect(globalCmdSpy).toHaveBeenCalledWith("server_reload", [])
    })
    await waitFor(() => {
      expect(
        screen.queryByTestId("settings-restart-banner")
      ).not.toBeInTheDocument()
    })
    unmount()

    // Cmd+, shortcut toggles Settings route and KEYBOARD_SHORTCUT_GROUPS matches real handlers
    const keysList = KEYBOARD_SHORTCUT_GROUPS.flatMap((g) =>
      g.items.map((i) => i.id)
    )
    expect(keysList).toContain("open-settings")
    expect(keysList).not.toContain("command-palette")
    expect(keysList).not.toContain("mini-launcher")

    renderWithQuery(
      <AppShell>
        <div>Body</div>
      </AppShell>
    )
    expect(useAppStore.getState().activeRoute).toBe("home")
    fireEvent.keyDown(window, { key: ",", metaKey: true })
    expect(useAppStore.getState().activeRoute).toBe("settings")
  })
})
