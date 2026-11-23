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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAppStore } from "@/lib/app-store"
import {
  createHarnessStreamTracker,
  mapHarnessFrameToLiveEvents,
} from "@/lib/harness-adapter"
import { ipcClient, type ExecutionTurn } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { ChatStream } from "../index"

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const SESSION_ID = "ses_live_stream"

function stubTurn(prompt: string): ExecutionTurn {
  return {
    id: "turn_stub_1",
    sessionId: SESSION_ID,
    userPrompt: prompt,
    workedDuration: "1s",
    notes: [],
    groups: [],
    answerIntro: "Handled by the real engine.",
    answerBullets: [],
    diffCard: {
      id: "diff_stub",
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
  }
}

type HarnessListener = (frame: Record<string, unknown>) => void

function captureHarnessListener() {
  const holder: { listener: HarnessListener | null } = { listener: null }
  vi.spyOn(ipcClient.harness, "onEvent").mockImplementation((cb) => {
    holder.listener = cb
    return () => {
      holder.listener = null
    }
  })
  return holder
}

function renderStream() {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatStream sessionId={SESSION_ID} turns={[]} />
    </QueryClientProvider>
  )
}

describe("ChatStream live engine wiring (no hardcoded demo flows)", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeRoute: "workspace",
      activeSessionId: SESSION_ID,
      pendingPermission: null,
      pendingStreamPrompt: null,
      daemonMode: "demo",
      authState: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("sends /presentations prompts straight to the engine without the hardcoded QBR flow", async () => {
    const sendSpy = vi
      .spyOn(ipcClient.trace, "sendPrompt")
      .mockResolvedValue(stubTurn("/presentations Build a 3-slide roadmap"))

    renderStream()

    act(() => {
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: SESSION_ID,
        prompt: "/presentations Build a 3-slide roadmap",
        modelLabel: "Claude Opus 5.5",
      })
    })

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: SESSION_ID,
          prompt: "/presentations Build a 3-slide roadmap",
        })
      )
    })

    expect(
      screen.queryByText(/Enterprise Quarterly Business Review/i)
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId("live-permission-banner")).not.toBeInTheDocument()
    expect(useAppStore.getState().pendingPermission).toBeNull()
  })

  it("renders a real slide preview thumbnail card when create_powerpoint tool_done arrives", async () => {
    const holder = captureHarnessListener()
    renderStream()

    expect(holder.listener).not.toBeNull()
    act(() => {
      holder.listener?.({
        ev: "tool_done",
        call_id: "call_ppt_1",
        name: "create_powerpoint",
        tool_input: {
          title: "Roadmap 2027",
          file_path: "roadmap.pptx",
          slides: [
            { title: "Cover", body: "Where we are going" },
            { title: "Milestones", body: "Q1 to Q4" },
            { title: "Risks", body: "What could slip" },
          ],
        },
        tool_output: "Created roadmap.pptx",
      })
    })

    const thumb = await screen.findByTestId("work-slide-thumb-slide_call_ppt_1")
    expect(thumb).toHaveTextContent("Roadmap 2027")
    expect(screen.getByText("Built presentation")).toBeInTheDocument()
    expect(
      await screen.findByTestId("turn-output-artifact-card")
    ).toHaveTextContent("3 slides")
    expect(
      screen.queryByText(/Enterprise Quarterly Business Review/i)
    ).not.toBeInTheDocument()
  })

  it("opens the live permission approval card on permission_request and forwards Allow to respondToPermission", async () => {
    const holder = captureHarnessListener()
    const respondSpy = vi
      .spyOn(ipcClient.trace, "respondToPermission")
      .mockResolvedValue({ ok: true })
    renderStream()

    act(() => {
      holder.listener?.({
        ev: "permission_request",
        session_id: SESSION_ID,
        request_id: "req_live_1",
        tool_name: "write_excel",
        description: "Allow RayuCode to run write_excel?",
      })
    })

    const banner = await screen.findByTestId("live-permission-banner")
    expect(banner).toHaveTextContent("Allow RayuCode to run write_excel?")
    expect(useAppStore.getState().pendingPermission).toMatchObject({
      sessionId: SESSION_ID,
      requestId: "req_live_1",
      toolName: "write_excel",
    })

    fireEvent.click(screen.getByTestId("permission-allow-conversation-btn"))

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith(SESSION_ID, "req_live_1", "allow")
    })
    expect(useAppStore.getState().pendingPermission).toBeNull()
  })

  it("forwards Always allow and Deny decisions to respondToPermission", async () => {
    const holder = captureHarnessListener()
    const respondSpy = vi
      .spyOn(ipcClient.trace, "respondToPermission")
      .mockResolvedValue({ ok: true })
    renderStream()

    act(() => {
      holder.listener?.({
        ev: "permission_request",
        session_id: SESSION_ID,
        request_id: "req_live_2",
        tool_name: "bash",
        description: "Allow RayuCode to run bash?",
      })
    })
    fireEvent.click(await screen.findByTestId("permission-always-allow-btn"))
    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith(
        SESSION_ID,
        "req_live_2",
        "allow_always"
      )
    })

    act(() => {
      holder.listener?.({
        ev: "permission_request",
        session_id: SESSION_ID,
        request_id: "req_live_3",
        tool_name: "bash",
        description: "Allow RayuCode to run bash?",
      })
    })
    fireEvent.click(await screen.findByTestId("permission-deny-btn"))
    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith(SESSION_ID, "req_live_3", "deny")
    })
  })
})

describe("mapHarnessFrameToLiveEvents tool mappings", () => {
  it("maps write_excel to an excel preview card plus excel artifact", () => {
    const events = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_done",
        call_id: "c_xl",
        name: "write_excel",
        tool_input: { file_path: "reports/metrics.xlsx", sheets: [] },
        tool_output: "ok",
      },
      createHarnessStreamTracker()
    )

    const step = events.find((e) => e.type === "step")
    expect(step).toMatchObject({
      type: "step",
      step: {
        kind: "previews",
        previews: [{ kind: "excel", badge: ".xlsx", label: "metrics.xlsx" }],
      },
    })
    expect(events.find((e) => e.type === "artifact")).toMatchObject({
      artifact: { kind: "excel", title: "metrics.xlsx" },
    })
  })

  it("groups browser_* tools under Used the browser", () => {
    const events = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_done",
        call_id: "c_br",
        name: "browser_navigate",
        tool_input: { url: "https://example.com" },
        tool_output: "Navigated",
      },
      createHarnessStreamTracker()
    )
    const step = events.find((e) => e.type === "step")
    expect(step).toMatchObject({
      type: "step",
      groupTitle: "Used the browser",
      step: { kind: "command", displayCommand: "Navigate to https://example.com" },
    })
  })

  it("maps permission_request frames into a live permission event", () => {
    const events = mapHarnessFrameToLiveEvents(
      {
        ev: "permission_request",
        session_id: "s1",
        request_id: "r1",
        tool_name: "edit",
        description: "Allow edit?",
      },
      createHarnessStreamTracker()
    )
    expect(events).toEqual([
      {
        type: "permission-request",
        sessionId: "s1",
        requestId: "r1",
        toolName: "edit",
        description: "Allow edit?",
      },
    ])
  })
})
