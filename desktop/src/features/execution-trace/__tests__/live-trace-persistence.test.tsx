import "@testing-library/jest-dom/vitest"
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
import { AppProviders } from "@/components/providers/app-providers"
import { IconRail } from "@/components/shell/LeftSidebar"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"

import { resetAllLiveTraces } from "../index"

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

describe("App-lifetime live trace persistence across screens & New chat", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(ipcClient.daemon, "getStatus").mockResolvedValue({
      connected: true,
      reconnecting: false,
      socketPath: "/tmp/test.sock",
      version: "rayu-harness-v1",
      latencyMs: 1,
      mode: "live",
    })
    useAppStore.setState({
      activeRoute: "workspace",
      activeSessionId: "real_sess_1",
      activeSessionTitle: "Explain codebase",
      daemonMode: "live",
      authState: null,
      authLoaded: true,
      authBypassed: true,
      pendingPermission: null,
      pendingStreamPrompt: null,
      isStreamActive: false,
    })
  })

  afterEach(() => {
    cleanup()
    resetAllLiveTraces()
    vi.restoreAllMocks()
  })

  it("keeps streaming chat alive across route switches (Plugins/Settings) and back without interruption or 'Live daemon turn' loss", async () => {
    const bus = createHarnessBus()
    const sendSpy = vi.spyOn(ipcClient.trace, "sendPrompt").mockResolvedValue({
      id: "live_server_1",
      sessionId: "real_sess_1",
      userPrompt: "Explain this codebase",
      workedDuration: "1s",
      isLive: true,
      notes: [],
      groups: [],
      answerIntro: "",
      answerBullets: [],
      diffCard: {
        id: "diff_1",
        file: "workspace",
        additions: 0,
        deletions: 0,
        hint: "",
        lines: [],
      },
      timestamp: "Just now",
      credits: "0.00 cr",
      kvCachePct: 90,
      pinned: false,
    })
    const recordSpy = vi.spyOn(ipcClient.trace, "recordTurn")
    vi.spyOn(ipcClient.trace, "listTurns").mockResolvedValue([])

    await act(async () => {
      render(<App />)
    })

    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_1",
        prompt: "Explain this codebase",
        modelLabel: "Claude Opus 5.5",
      })
    })

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "real_sess_1",
          prompt: "Explain this codebase",
        })
      )
    })

    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_1",
        text: "Part 1 ",
      })
    })
    await new Promise((r) => setTimeout(r, 30))

    // Navigate away to Plugins while streaming
    await act(async () => {
      useAppStore.getState().setActiveRoute("plugins")
    })
    expect(await screen.findByTestId("plugins-view")).toBeInTheDocument()

    // Background stream continues emitting deltas while on another screen
    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_1",
        text: "Part 2",
      })
    })
    await new Promise((r) => setTimeout(r, 30))

    // Return to workspace: user prompt and streamed deltas are both preserved
    await act(async () => {
      useAppStore.getState().setActiveRoute("workspace")
    })
    expect(await screen.findByText("Explain this codebase")).toBeInTheDocument()
    expect(screen.getByText(/Part 1 Part 2/)).toBeInTheDocument()
    expect(screen.queryByText("Live daemon turn")).not.toBeInTheDocument()

    act(() => {
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_1",
      })
    })
    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "real_sess_1",
          userPrompt: "Explain this codebase",
          answerIntro: "Part 1 Part 2",
        })
      )
    })
  })

  it("saves previous chat when clicking New chat while it is streaming and restores it when clicking back", async () => {
    useAppStore.setState({
      activeRoute: "workspace",
      activeSessionId: "real_sess_2",
      activeSessionTitle: "First chat prompt",
    })
    const bus = createHarnessBus()
    const sendSpy = vi.spyOn(ipcClient.trace, "sendPrompt").mockResolvedValue({
      id: "live_server_2",
      sessionId: "real_sess_2",
      userPrompt: "First chat prompt",
      workedDuration: "1s",
      isLive: true,
      notes: [],
      groups: [],
      answerIntro: "",
      answerBullets: [],
      diffCard: {
        id: "diff_2",
        file: "workspace",
        additions: 0,
        deletions: 0,
        hint: "",
        lines: [],
      },
      timestamp: "Just now",
      credits: "0.00 cr",
      kvCachePct: 90,
      pinned: false,
    })
    const recordSpy = vi.spyOn(ipcClient.trace, "recordTurn")
    vi.spyOn(ipcClient.trace, "listTurns").mockResolvedValue([])

    await act(async () => {
      render(<App />)
    })

    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: "real_sess_2",
        prompt: "First chat prompt",
        modelLabel: "Claude Opus 5.5",
      })
    })

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalled()
    })

    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_2",
        text: "Partial answer ",
      })
    })
    await new Promise((r) => setTimeout(r, 30))

    // User clicks "New chat" while the first chat is still streaming
    fireEvent.click(screen.getByRole("button", { name: "New chat" }))
    expect(useAppStore.getState().activeSessionId).toBeNull()
    expect(useAppStore.getState().activeRoute).toBe("home")

    // First chat finishes streaming in the background while user is on New chat
    act(() => {
      bus.emit({
        ev: "text_delta",
        session_id: "real_sess_2",
        text: "completed in background",
      })
      bus.emit({
        ev: "turn_done",
        session_id: "real_sess_2",
      })
    })

    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "real_sess_2",
          userPrompt: "First chat prompt",
          answerIntro: "Partial answer completed in background",
        })
      )
    })

    // Clicking back to real_sess_2 restores the full saved turn immediately
    await act(async () => {
      useAppStore.getState().setActiveSession("real_sess_2", "First chat prompt")
    })
    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="msg-user"]')
      ).toHaveTextContent("First chat prompt")
    })
    expect(
      screen.getByText(/Partial answer completed in background/)
    ).toBeInTheDocument()
  })

  it("clicking Home rail icon from Plugins returns to active workspace chat instead of stranding on blank Home", () => {
    useAppStore.setState({
      activeRoute: "plugins",
      activeSessionId: "ses_retire_cache",
      activeSessionTitle: "Retire SessionCache",
    })

    render(
      <AppProviders>
        <IconRail />
      </AppProviders>
    )

    fireEvent.click(screen.getByRole("button", { name: "Home" }))
    expect(useAppStore.getState().activeRoute).toBe("workspace")
    expect(useAppStore.getState().activeSessionId).toBe("ses_retire_cache")
  })
})
