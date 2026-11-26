import "@testing-library/jest-dom/vitest"
import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import {
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

import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient, type CommandDescriptor } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { SessionComposer } from "../index"

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

const LIVE_COMMANDS: readonly CommandDescriptor[] = [
  {
    name: "compact",
    description: "Summarize conversation history to free context",
    category: "session",
    requires_session: true,
    dispatch: { kind: "api_request", req: "compact" },
  },
  {
    name: "effort",
    description: "Set reasoning effort for the active session",
    category: "model",
    arg_hint: "<low|medium|high|xhigh|max>",
    requires_session: true,
    dispatch: { kind: "api_request", req: "set_reasoning_effort" },
  },
  {
    name: "review",
    description: "Run an engineering review pass",
    category: "quality",
    requires_session: true,
    dispatch: { kind: "runtime_command", command: "review" },
  },
]

function renderComposer(
  props?: Partial<React.ComponentProps<typeof SessionComposer>>
) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <SessionComposer
          mode="workspace"
          commands={LIVE_COMMANDS}
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("SessionComposer v1.16 live slash commands & skills", () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.setState({ activeSessionId: "sess_live_42" })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it("does not open slash menu inside URLs or file paths", () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Reply to RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "https://example.com" } })
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: "src/app/index.ts" } })
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()
  })

  it("renders two-group slash popover (Engine Commands + Skills) with arg_hint", async () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Reply to RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "/" } })

    const menu = await screen.findByTestId("composer-slash-menu")
    expect(menu).toBeInTheDocument()
    expect(screen.getByTestId("slash-group-engine")).toHaveTextContent(
      "Engine Commands"
    )
    expect(screen.getByText("/compact")).toBeInTheDocument()
    expect(screen.getByText("/effort")).toBeInTheDocument()
    expect(screen.getByText("<low|medium|high|xhigh|max>")).toBeInTheDocument()
    expect(await screen.findByTestId("slash-group-skills")).toHaveTextContent(
      "Skills"
    )
  })

  it("dispatches /compact via real compact RPC rather than sending prompt text", async () => {
    const onSubmit = vi.fn()
    const compactSpy = vi
      .spyOn(ipcClient.harness, "compact")
      .mockResolvedValue({ ok: true, message: "Context compacted" })

    renderComposer({ onSubmit })
    const input = screen.getByRole("textbox", { name: "Reply to RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "/compact" } })
    fireEvent.keyDown(input, { key: "Escape" })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => {
      expect(compactSpy).toHaveBeenCalledWith("sess_live_42")
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      await screen.findByTestId("composer-command-feedback")
    ).toHaveTextContent("Context compacted")
  })

  it("dispatches /effort high via real setReasoningEffort RPC and preserves input on error", async () => {
    const onSubmit = vi.fn()
    const setEffortSpy = vi
      .spyOn(ipcClient.harness, "setReasoningEffort")
      .mockResolvedValue({ ok: true })

    renderComposer({ onSubmit })
    const input = screen.getByRole("textbox", { name: "Reply to RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "/effort high" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => {
      expect(setEffortSpy).toHaveBeenCalledWith("sess_live_42", "high")
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      await screen.findByTestId("composer-command-feedback")
    ).toHaveTextContent("Reasoning effort set to High")

    // Error preserves user input so they can fix typos immediately
    setEffortSpy.mockResolvedValueOnce({
      ok: false,
      code: "invalid_request",
      error: "Unsupported effort level: turbo",
    })
    fireEvent.change(input, { target: { value: "/effort turbo" } })
    fireEvent.keyDown(input, { key: "Enter" })

    const feedback = await screen.findByTestId("composer-command-feedback")
    expect(feedback).toHaveAttribute("data-feedback-status", "error")
    expect(feedback).toHaveTextContent("Unsupported effort level: turbo")
    expect(input).toHaveValue("/effort turbo")
  })
})
