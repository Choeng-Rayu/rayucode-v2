import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { App } from "@/App"
import { SidebarProjectsPane } from "@/components/shell/sidebar-projects-pane"
import { useAppStore } from "@/lib/app-store"
import {
  ipcClient,
  isPhantomLiveDaemonTurn,
  type ExecutionTurn,
  type SessionSummary,
} from "@/lib/ipc-client"
import { queryClient as sharedQueryClient } from "@/lib/query-client"

import {
  dispatchPendingStreamPrompt,
  resetAllLiveTraces,
  stopActiveSessionTurn,
  useLiveTraceStore,
} from "../index"

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

type HarnessListener = (frame: Record<string, unknown>) => void

function createHarnessBus() {
  const listeners = new Set<HarnessListener>()
  vi.spyOn(ipcClient.harness, "onEvent").mockImplementation((cb) => {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  })
  return {
    emit(frame: Record<string, unknown>) {
      for (const listener of listeners) {
        listener(frame)
      }
    },
  }
}

function makeTurn(overrides: Partial<ExecutionTurn> = {}): ExecutionTurn {
  return {
    id: overrides.id ?? "turn_1",
    sessionId: overrides.sessionId ?? "real_sess_a",
    userPrompt: overrides.userPrompt ?? "Run task",
    workedDuration: overrides.workedDuration ?? "2s",
    notes: overrides.notes ?? [],
    groups: overrides.groups ?? [],
    answerIntro: overrides.answerIntro ?? "",
    answerBullets: overrides.answerBullets ?? [],
    diffCard: overrides.diffCard ?? {
      id: "diff_1",
      file: "",
      additions: 0,
      deletions: 0,
      hint: "",
      lines: [],
    },
    timestamp: overrides.timestamp ?? "Just now",
    credits: overrides.credits ?? "0.00 cr",
    kvCachePct: overrides.kvCachePct ?? 90,
    pinned: overrides.pinned ?? false,
    ...overrides,
  }
}

const BASE_SESSIONS: SessionSummary[] = [
  {
    id: "real_sess_a",
    title: "Session Alpha",
    project: "rayucode-v2",
    workingDir: "/workspace/rayucode-v2",
    checkout: "Local Checkout",
    branch: "main",
    updatedAt: "1m",
    updatedAtMs: Date.now() - 60_000,
    status: "idle",
    connection: "local",
    modelId: "claude-sonnet-4-6",
    modelLabel: "Claude Sonnet 4.6",
    effort: "Medium",
    permissionMode: "default",
    kvWarmPct: 90,
    creditsUsed: 0,
  },
  {
    id: "real_sess_b",
    title: "Session Beta",
    project: "rayucode-v2",
    workingDir: "/workspace/rayucode-v2",
    checkout: "Local Checkout",
    branch: "main",
    updatedAt: "5m",
    updatedAtMs: Date.now() - 300_000,
    status: "idle",
    connection: "local",
    modelId: "claude-sonnet-4-6",
    modelLabel: "Claude Sonnet 4.6",
    effort: "Medium",
    permissionMode: "default",
    kvWarmPct: 90,
    creditsUsed: 0,
  },
]

describe("Multi-session background persistence, mid-turn Steer/Queue, and phantom turn guard", () => {
  beforeEach(() => {
    window.localStorage.clear()
    sharedQueryClient.clear()
    vi.spyOn(ipcClient.daemon, "getStatus").mockResolvedValue({
      connected: true,
      reconnecting: false,
      socketPath: "/tmp/test.sock",
      version: "rayu-harness-v1",
      latencyMs: 1,
      mode: "live",
    })
    vi.spyOn(ipcClient.sessions, "list").mockResolvedValue(
      structuredClone(BASE_SESSIONS)
    )
    vi.spyOn(ipcClient.sessions, "listProjects").mockResolvedValue([
      {
        id: "proj_1",
        name: "rayucode-v2",
        path: "/workspace/rayucode-v2",
        expanded: true,
        sessions: BASE_SESSIONS.map((s) => ({
          id: s.id,
          title: s.title,
          workingDir: s.workingDir,
          updatedAtMs: s.updatedAtMs,
          updatedAt: s.updatedAt,
          connection: s.connection,
        })),
      },
    ])
    vi.spyOn(ipcClient.sessions, "listRecents").mockResolvedValue([])
    vi.spyOn(ipcClient.trace, "listTurns").mockResolvedValue([])
    useAppStore.setState({
      activeRoute: "workspace",
      activeSessionId: "real_sess_a",
      activeSessionTitle: "Session Alpha",
      daemonMode: "live",
      authState: null,
      authLoaded: true,
      authBypassed: true,
      pendingPermission: null,
      pendingPermissionsBySession: {},
      pendingStreamPrompt: null,
      isStreamActive: false,
      midTurnSendMode: "steer",
      midTurnMessagesBySession: {},
      pausedQueueSessions: {},
      composerDraftBySession: {},
    })
  })

  afterEach(() => {
    cleanup()
    sharedQueryClient.clear()
    resetAllLiveTraces()
    vi.restoreAllMocks()
  })

  it("keeps Session A working across switching to Session B, isolates permissions, shows sidebar indicator, and resumes cleanly", async () => {
    const bus = createHarnessBus()
    vi.spyOn(ipcClient.trace, "sendPrompt").mockImplementation(
      async (input) =>
        makeTurn({
          id: `live_${input.sessionId}`,
          sessionId: input.sessionId,
          userPrompt: input.prompt,
          isLive: true,
        })
    )
    const recordSpy = vi.spyOn(ipcClient.trace, "recordTurn")

    await act(async () => {
      render(<App />)
    })

    // Start streaming on Session A (note: cached sessionsQuery initially says status: "idle")
    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_a",
        prompt: "Refactor worker pool",
        modelLabel: "Claude Sonnet 4.6",
      })
    })

    await waitFor(() => {
      expect(
        useLiveTraceStore.getState().liveTurnsBySession["real_sess_a"]?.isLive
      ).toBe(true)
    })

    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "Step 1 complete. ",
      })
    })
    await new Promise((r) => setTimeout(r, 30))

    // Backdate lastEventAtMs past the stale-turn grace window to verify stale cached "idle" NEVER kills Session A
    act(() => {
      useLiveTraceStore.setState((state) => ({
        lastEventAtMsBySession: {
          ...state.lastEventAtMsBySession,
          real_sess_a: Date.now() - 5_000,
        },
      }))
    })

    // Switch to Session B while Session A continues running in background
    act(() => {
      useAppStore.getState().setActiveSession("real_sess_b", "Session Beta")
    })

    await waitFor(() => {
      expect(
        screen.getByTestId("sidebar-chat-running-real_sess_a")
      ).toBeInTheDocument()
    })
    expect(
      useLiveTraceStore.getState().liveTurnsBySession["real_sess_a"]?.isLive
    ).toBe(true)

    // Session A emits a permission request AND more deltas in background; Session B emits turn_done
    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "Still working in background. ",
      })
      bus.emit({
        ev: "permission_request",
        session_id: "real_sess_a",
        request_id: "perm_a_1",
        tool_name: "Bash",
        description: "Run cargo test?",
      })
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_b",
      })
    })

    await new Promise((r) => setTimeout(r, 30))

    // Session B's turn_done must NOT wipe Session A's pending permission or live turn
    expect(
      useAppStore.getState().pendingPermissionsBySession["real_sess_a"]
    ).toHaveLength(1)
    expect(
      screen.queryByTestId("live-permission-banner")
    ).not.toBeInTheDocument()

    // Switch back to Session A -> still live, shows background deltas & permission banner
    act(() => {
      useAppStore.getState().setActiveSession("real_sess_a", "Session Alpha")
    })

    await waitFor(() => {
      expect(screen.getByTestId("live-permission-banner")).toBeInTheDocument()
    })
    expect(screen.getByText(/Run cargo test\?/)).toBeInTheDocument()
    expect(screen.getByText(/Still working in background/)).toBeInTheDocument()

    // Complete Session A
    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "All done.",
      })
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_a",
      })
    })

    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "real_sess_a",
          userPrompt: "Refactor worker pool",
          answerIntro: "Step 1 complete. Still working in background. All done.",
        })
      )
    })
    expect(screen.queryByText("Live daemon turn")).not.toBeInTheDocument()
  })

  it("supports mid-turn Steer and Queue in workspace composer, Edit, Promote, auto-drain, and Pause on Stop", async () => {
    const bus = createHarnessBus()
    const sendSpy = vi
      .spyOn(ipcClient.trace, "sendPrompt")
      .mockImplementation(async (input) =>
        makeTurn({
          id: `live_${input.sessionId}`,
          sessionId: input.sessionId,
          userPrompt: input.prompt,
          isLive: true,
        })
      )
    const softInterruptSpy = vi
      .spyOn(ipcClient.trace, "softInterrupt")
      .mockResolvedValue({ ok: true })
    const cancelSoftSpy = vi
      .spyOn(ipcClient.trace, "cancelSoftInterrupts")
      .mockResolvedValue({ ok: true, cancelled: true })
    const cancelSpy = vi
      .spyOn(ipcClient.trace, "cancel")
      .mockResolvedValue({ ok: true })

    await act(async () => {
      render(<App />)
    })

    // Start first turn
    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_a",
        prompt: "Initial prompt",
        modelLabel: "Claude Sonnet 4.6",
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId("composer-midturn-bar")).toBeInTheDocument()
    })

    const textarea = screen.getByLabelText("Reply to RayuCode") as HTMLTextAreaElement
    expect(textarea).not.toBeDisabled()
    expect(screen.getByTestId("composer-stop-btn")).toBeInTheDocument()
    expect(screen.getByTestId("composer-steer-btn")).toBeInTheDocument()

    // 1. Submit Steer via Enter
    fireEvent.change(textarea, { target: { value: "Focus on unit tests first" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => {
      expect(softInterruptSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "real_sess_a",
          prompt: "Focus on unit tests first",
          urgent: false,
        })
      )
    })
    expect(screen.getByTestId("soft-interrupt-queue-strip")).toHaveTextContent(
      "Focus on unit tests first"
    )

    // Daemon confirms soft_interrupt_injected -> clears steer item and records Steered note
    const steerClientId = softInterruptSpy.mock.calls[0]![0].clientId!
    act(() => {
      bus.emit({
        ev: "soft_interrupt_injected",
        session_id: "real_sess_a",
        client_ids: [steerClientId],
      })
    })
    await waitFor(() => {
      expect(
        screen.queryByTestId(`midturn-item-${steerClientId}`)
      ).not.toBeInTheDocument()
    })

    // 2. Submit Queued message via Alt+Enter while in Steer mode
    fireEvent.change(textarea, { target: { value: "Queued via Alt+Enter" } })
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true })

    await waitFor(() => {
      expect(screen.getByText("Queued #1")).toBeInTheDocument()
    })
    expect(softInterruptSpy).toHaveBeenCalledTimes(1)

    // 3. Switch mode pill to Queue and add a second queued item via Queue button
    fireEvent.click(screen.getByTestId("midturn-mode-queue"))
    expect(screen.getByTestId("composer-queue-btn")).toBeInTheDocument()
    fireEvent.change(textarea, { target: { value: "Second queued follow-up" } })
    fireEvent.click(screen.getByTestId("composer-queue-btn"))

    await waitFor(() => {
      expect(screen.getByText("Queued #2")).toBeInTheDocument()
    })

    // 4. Edit second queued item back into composer
    const secondItem = useAppStore
      .getState()
      .midTurnMessagesBySession["real_sess_a"]!.find(
        (m) => m.text === "Second queued follow-up"
      )!
    fireEvent.click(screen.getByTestId(`edit-midturn-${secondItem.id}`))
    expect(textarea.value).toBe("Second queued follow-up")
    expect(
      screen.queryByTestId(`midturn-item-${secondItem.id}`)
    ).not.toBeInTheDocument()

    // Clear composer draft, complete turn -> auto-drains Queued #1!
    fireEvent.change(textarea, { target: { value: "" } })
    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "First turn output.",
      })
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_a",
      })
    })

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "real_sess_a",
          prompt: "Queued via Alt+Enter",
        })
      )
    })

    // 5. While auto-drained turn runs, add a Steer item then press Stop -> demotes & pauses queue
    await waitFor(() => {
      expect(screen.getByTestId("composer-midturn-bar")).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId("midturn-mode-steer"))
    fireEvent.change(textarea, { target: { value: "Pending steer before stop" } })
    fireEvent.keyDown(textarea, { key: "Enter" })
    await waitFor(() => {
      expect(screen.getByText("Pending steer before stop")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId("composer-stop-btn"))
    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith("real_sess_a")
      expect(cancelSoftSpy).toHaveBeenCalledWith("real_sess_a")
      expect(
        screen.getByText(/Queue paused after stop/i)
      ).toBeInTheDocument()
    })
    expect(screen.getByText("Queued #1")).toBeInTheDocument()
    expect(screen.getByText("Send")).toBeInTheDocument()
  })

  it("never renders or persists phantom 'Live daemon turn' bubbles for background sessions or unsolicited turn_done", async () => {
    const bus = createHarnessBus()
    const recordSpy = vi.spyOn(ipcClient.trace, "recordTurn")

    // Filter check for legacy cached phantom turns
    expect(
      isPhantomLiveDaemonTurn(
        makeTurn({ userPrompt: "Live daemon turn", answerIntro: "" })
      )
    ).toBe(true)
    expect(
      isPhantomLiveDaemonTurn(
        makeTurn({ userPrompt: "Real prompt", answerIntro: "" })
      )
    ).toBe(false)

    await act(async () => {
      render(<App />)
    })

    // 1. Unsolicited turn_done / turn_stopped when idle must NOT fabricate a turn
    act(() => {
      bus.emit({ ev: "turn_done", session_id: "real_sess_a" })
      bus.emit({ ev: "turn_stopped", session_id: "real_sess_a" })
    })
    await new Promise((r) => setTimeout(r, 40))

    expect(recordSpy).not.toHaveBeenCalled()
    expect(screen.queryByText("Live daemon turn")).not.toBeInTheDocument()

    // 2. Attaching an already-running background session streams agent text without fake user bubble
    act(() => {
      bus.emit({
        ev: "session_status",
        session_id: "real_sess_a",
        status: "running",
      })
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "Real background stream reply.",
      })
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_a",
      })
    })

    await waitFor(() => {
      expect(
        screen.getByText("Real background stream reply.")
      ).toBeInTheDocument()
    })
    expect(screen.queryByText("Live daemon turn")).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="msg-user"]')).toHaveLength(0)
  })

  it("renders background running dot in SidebarProjectsPane even outside App root", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    useLiveTraceStore.setState((state) => ({
      liveTurnsBySession: {
        ...state.liveTurnsBySession,
        real_sess_a: makeTurn({
          sessionId: "real_sess_a",
          isLive: true,
        }),
      },
    }))
    useAppStore.setState({
      activeSessionId: "real_sess_b",
      midTurnMessagesBySession: {
        real_sess_a: [
          {
            id: "mid_sidebar_1",
            sessionId: "real_sess_a",
            mode: "queue",
            text: "Next task",
            createdAtMs: Date.now(),
          },
        ],
      },
    })

    render(
      <QueryClientProvider client={qc}>
        <SidebarProjectsPane onOpenSession={vi.fn()} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(
        screen.getByTestId("sidebar-chat-running-real_sess_a")
      ).toBeInTheDocument()
    })
    expect(
      screen.getByTestId("sidebar-chat-queued-real_sess_a")
    ).toHaveTextContent("1")
  })

  it("recovers undelivered steers when turn_done reports pending_soft_interrupts > 0 by cancelling server queue and auto-dispatching next turn", async () => {
    const bus = createHarnessBus()
    const sendSpy = vi
      .spyOn(ipcClient.trace, "sendPrompt")
      .mockImplementation(async (input) =>
        makeTurn({
          id: `live_${input.sessionId}`,
          sessionId: input.sessionId,
          userPrompt: input.prompt,
          isLive: true,
        })
      )
    const softInterruptSpy = vi
      .spyOn(ipcClient.trace, "softInterrupt")
      .mockResolvedValue({ ok: true })
    const cancelSoftSpy = vi
      .spyOn(ipcClient.trace, "cancelSoftInterrupts")
      .mockResolvedValue({ ok: true, cancelled: true })

    await act(async () => {
      render(<App />)
    })

    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_a",
        prompt: "First turn",
        modelLabel: "Claude Sonnet 4.6",
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId("composer-midturn-bar")).toBeInTheDocument()
    })

    const textarea = screen.getByLabelText("Reply to RayuCode") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Missed steer prompt" } })
    fireEvent.keyDown(textarea, { key: "Enter" })
    await waitFor(() => {
      expect(softInterruptSpy).toHaveBeenCalledTimes(1)
    })

    // Turn finishes BEFORE seeing the steer (Rust TurnDone { pending_soft_interrupts: 1 })
    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "First answer.",
      })
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_a",
        pending_soft_interrupts: 1,
      })
    })

    await waitFor(() => {
      expect(cancelSoftSpy).toHaveBeenCalledWith("real_sess_a")
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "real_sess_a",
          prompt: "Missed steer prompt",
        })
      )
    })
  })

  it("ignores background_task/system soft_interrupt_injected events so user steers remain intact, and starts a real user turn on point: 'turn_start'", async () => {
    const bus = createHarnessBus()
    vi.spyOn(ipcClient.trace, "sendPrompt").mockImplementation(async (input) =>
      makeTurn({
        id: `live_${input.sessionId}`,
        sessionId: input.sessionId,
        userPrompt: input.prompt,
        isLive: true,
      })
    )
    const softInterruptSpy = vi
      .spyOn(ipcClient.trace, "softInterrupt")
      .mockResolvedValue({ ok: true })

    await act(async () => {
      render(<App />)
    })

    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_a",
        prompt: "Run build",
        modelLabel: "Claude Sonnet 4.6",
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId("composer-midturn-bar")).toBeInTheDocument()
    })

    const textarea = screen.getByLabelText("Reply to RayuCode") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Check lint too" } })
    fireEvent.keyDown(textarea, { key: "Enter" })
    await waitFor(() => {
      expect(softInterruptSpy).toHaveBeenCalledTimes(1)
    })
    const clientId = softInterruptSpy.mock.calls[0]![0].clientId!

    // Daemon injects a background task completion with empty client_ids -> MUST NOT delete user steer
    act(() => {
      bus.emit({
        ev: "soft_interrupt_injected",
        session_id: "real_sess_a",
        client_ids: [],
        point: "D",
        display_role: "background_task",
      })
    })
    expect(
      screen.getByTestId(`midturn-item-${clientId}`)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Steered:/)).not.toBeInTheDocument()

    // Previous turn finishes right before daemon promotes steer to a new turn at point: "turn_start"
    act(() => {
      bus.emit({ ev: "text_delta", session_id: "real_sess_a", text: "Done." })
      bus.emit({ ev: "turn_done", session_id: "real_sess_a" })
      bus.emit({
        ev: "soft_interrupt_injected",
        session_id: "real_sess_a",
        client_ids: [clientId],
        point: "turn_start",
      })
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "Lint is clean.",
      })
    })

    await waitFor(() => {
      const liveTurn =
        useLiveTraceStore.getState().liveTurnsBySession["real_sess_a"]
      expect(liveTurn?.userPrompt).toBe("Check lint too")
      expect(liveTurn?.notes).not.toContain("Steered: Check lint too")
      expect(screen.getByText("Lint is clean.")).toBeInTheDocument()
    })
  })

  it("handles session_status: 'cancelled' by transitioning daemon status to idle and clearing empty placeholder turns", async () => {
    const bus = createHarnessBus()

    await act(async () => {
      render(<App />)
    })

    act(() => {
      bus.emit({
        ev: "session_status",
        session_id: "real_sess_a",
        status: "running",
      })
    })
    await waitFor(() => {
      expect(
        useLiveTraceStore.getState().liveTurnsBySession["real_sess_a"]
      ).toBeDefined()
    })

    act(() => {
      bus.emit({
        ev: "session_status",
        session_id: "real_sess_a",
        status: "cancelled",
      })
    })
    await waitFor(() => {
      expect(
        useLiveTraceStore.getState().daemonSessionStatusBySession["real_sess_a"]
          ?.status
      ).toBe("idle")
      expect(
        useLiveTraceStore.getState().liveTurnsBySession["real_sess_a"]
      ).toBeUndefined()
    })
  })

  it("reconciles background-attached running session with an unanswered trailing history turn and short reply without duplication in both load orders", async () => {
    const bus = createHarnessBus()

    // Order A: history loaded first, then session_status: running
    vi.spyOn(ipcClient.trace, "listTurns").mockResolvedValue([
      makeTurn({
        id: "hist_unanswered_1",
        sessionId: "real_sess_a",
        userPrompt: "Say hi",
        answerIntro: "",
      }),
    ])

    await act(async () => {
      render(<App />)
    })
    await waitFor(() => {
      expect(screen.getByText("Say hi")).toBeInTheDocument()
    })

    act(() => {
      bus.emit({
        ev: "session_status",
        session_id: "real_sess_a",
        status: "running",
      })
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "Ok",
      })
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_a",
      })
    })

    await waitFor(() => {
      expect(screen.getByText("Ok")).toBeInTheDocument()
    })
    expect(screen.getAllByText("Say hi")).toHaveLength(1)
    expect(screen.getAllByText("Ok")).toHaveLength(1)
    cleanup()
    sharedQueryClient.clear()
    resetAllLiveTraces()

    // Order B: session_status: running arrives BEFORE getHistory resolves
    let resolveHistory!: (turns: ExecutionTurn[]) => void
    vi.spyOn(ipcClient.trace, "listTurns").mockImplementation(
      () =>
        new Promise<ExecutionTurn[]>((resolve) => {
          resolveHistory = resolve
        })
    )
    useAppStore.setState({
      activeRoute: "workspace",
      activeSessionId: "real_sess_a",
      activeSessionTitle: "Session Alpha",
    })

    await act(async () => {
      render(<App />)
    })

    act(() => {
      bus.emit({
        ev: "session_status",
        session_id: "real_sess_a",
        status: "running",
      })
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "Ok",
      })
    })

    await act(async () => {
      resolveHistory([
        makeTurn({
          id: "hist_unanswered_2",
          sessionId: "real_sess_a",
          userPrompt: "Say hi",
          answerIntro: "",
        }),
      ])
    })

    await waitFor(() => {
      expect(screen.getByText("Say hi")).toBeInTheDocument()
      expect(screen.getByText("Ok")).toBeInTheDocument()
    })
    // No premature completed TurnActions below hist_unanswered_2 while live
    expect(document.querySelectorAll('[data-slot="turn-actions"]')).toHaveLength(0)

    act(() => {
      bus.emit({ ev: "turn_done", session_id: "real_sess_a" })
    })

    await waitFor(() => {
      expect(screen.getAllByText("Say hi")).toHaveLength(1)
      expect(screen.getAllByText("Ok")).toHaveLength(1)
    })
  })

  it("preserves partial streamed content when stopping an active turn and resets running status when sendPrompt rejects", async () => {
    const bus = createHarnessBus()
    const cancelSpy = vi
      .spyOn(ipcClient.trace, "cancel")
      .mockResolvedValue({ ok: true })
    const sendSpy = vi
      .spyOn(ipcClient.trace, "sendPrompt")
      .mockImplementationOnce(async (input) =>
        makeTurn({
          id: `live_${input.sessionId}`,
          sessionId: input.sessionId,
          userPrompt: input.prompt,
          isLive: true,
        })
      )
      .mockRejectedValueOnce(new Error("Daemon offline"))

    await act(async () => {
      render(<App />)
    })

    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_a",
        prompt: "Write a long guide",
        modelLabel: "Claude Sonnet 4.6",
      })
    })
    await waitFor(() => {
      expect(
        useLiveTraceStore.getState().liveTurnsBySession["real_sess_a"]?.isLive
      ).toBe(true)
    })

    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_a",
        text: "Partial streamed paragraph kept on stop.",
      })
    })
    await waitFor(() => {
      expect(
        screen.getByText("Partial streamed paragraph kept on stop.")
      ).toBeInTheDocument()
    })

    act(() => {
      stopActiveSessionTurn("real_sess_a")
    })
    expect(cancelSpy).toHaveBeenCalledWith("real_sess_a")
    expect(
      screen.getByText("Partial streamed paragraph kept on stop.")
    ).toBeInTheDocument()

    // Rejection in dispatchPendingStreamPrompt must reset daemonSessionStatusBySession to idle
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    act(() => {
      dispatchPendingStreamPrompt(
        {
          sessionId: "real_sess_b",
          prompt: "Fail send",
          modelLabel: "Claude Sonnet 4.6",
        },
        qc
      )
    })
    expect(sendSpy).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(
        useLiveTraceStore.getState().daemonSessionStatusBySession["real_sess_b"]
          ?.status
      ).toBe("idle")
      expect(
        useLiveTraceStore.getState().liveTurnsBySession["real_sess_b"]
      ).toBeUndefined()
    })
  })

  it("executes engine slash commands like /compact during active turns instead of sending them as Steer text", async () => {
    createHarnessBus()
    vi.spyOn(ipcClient.trace, "sendPrompt").mockImplementation(async (input) =>
      makeTurn({
        id: `live_${input.sessionId}`,
        sessionId: input.sessionId,
        userPrompt: input.prompt,
        isLive: true,
      })
    )
    vi.spyOn(ipcClient.harness, "getCapabilities").mockResolvedValue({
      commands: [
        {
          name: "compact",
          description: "Compact session history",
          category: "session",
          requires_session: true,
          dispatch: { kind: "api_request", req: "compact" },
        },
      ],
      permission_modes: [],
      features: [],
    })
    const compactSpy = vi
      .spyOn(ipcClient.harness, "compact")
      .mockResolvedValue({ ok: false, code: "busy" })
    const softInterruptSpy = vi
      .spyOn(ipcClient.trace, "softInterrupt")
      .mockResolvedValue({ ok: true })

    await act(async () => {
      render(<App />)
    })

    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_a",
        prompt: "Long task",
        modelLabel: "Claude Sonnet 4.6",
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId("composer-midturn-bar")).toBeInTheDocument()
    })

    const textarea = screen.getByLabelText("Reply to RayuCode") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "/compact" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => {
      expect(compactSpy).toHaveBeenCalledWith("real_sess_a")
    })
    expect(softInterruptSpy).not.toHaveBeenCalled()
    expect(
      screen.getByText(/\/compact is queued until the active turn finishes/i)
    ).toBeInTheDocument()
  })
})
