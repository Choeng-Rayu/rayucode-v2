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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ipcClient } from "@/lib/ipc-client"
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

function renderComposer(
  props?: Partial<React.ComponentProps<typeof SessionComposer>>
) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <SessionComposer mode="home" {...props} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("SessionComposer mid-sentence slash skills", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it("does not open slash menu when '/' is attached to a word or inside a URL/path", () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "This is the/" } })
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: "https://example.com" } })
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: "src/app/index.ts" } })
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()
  })

  it("opens slash menu after 1 space before '/' and shows built-in commands and local skills", async () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "This is the /" } })

    const menu = await screen.findByTestId("composer-slash-menu")
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /plan/i })).toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: /systematic-debugging/i })
    ).toBeInTheDocument()
  })

  it("filters mid-sentence queries using only text after the active '/' and shows empty state when unmatched", async () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "This is the /sys" } })

    const menu = await screen.findByTestId("composer-slash-menu")
    expect(menu).toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: /systematic-debugging/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^plan\b/i })
    ).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: "This is the /dsd" } })
    expect(screen.getByTestId("composer-slash-menu")).toBeInTheDocument()
    expect(
      screen.getByText("No matching skills or commands")
    ).toBeInTheDocument()
  })

  it("closes slash menu when a second '/' is typed for a file path", async () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "Check /Users" } })
    expect(await screen.findByTestId("composer-slash-menu")).toBeInTheDocument()

    fireEvent.change(input, { target: { value: "Check /Users/alice" } })
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()
  })

  it("preserves sentence text when clicking a built-in command mid-sentence and submits combined prompt", async () => {
    const onSubmit = vi.fn()
    renderComposer({ onSubmit })
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "This is the /pl" } })
    const planBtn = await screen.findByRole("button", { name: /plan/i })
    fireEvent.click(planBtn)

    expect(screen.getByTestId("composer-skill-token-plan")).toBeInTheDocument()
    expect(input).toHaveValue("This is the ")
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("composer-send-btn"))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "/plan This is the",
        })
      )
    })
  })

  it("preserves sentence text when clicking a local skill mid-sentence and submits combined prompt", async () => {
    const onSubmit = vi.fn()
    renderComposer({ onSubmit })
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "This is the /sys" } })
    const skillBtn = await screen.findByRole("button", {
      name: /systematic-debugging/i,
    })
    fireEvent.click(skillBtn)

    expect(
      screen.getByTestId("composer-skill-token-sk_debug")
    ).toHaveTextContent("systematic-debugging")
    expect(input).toHaveValue("This is the ")

    fireEvent.click(screen.getByTestId("composer-send-btn"))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "/systematic-debugging This is the",
        })
      )
    })
  })

  it("auto-converts a typed slash command on trailing space both mid-sentence and at start", () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "This is the /swarm " } })
    expect(screen.getByTestId("composer-skill-token-swarm")).toBeInTheDocument()
    expect(input).toHaveValue("This is the ")

    fireEvent.change(input, { target: { value: "/goal " } })
    expect(screen.getByTestId("composer-skill-token-goal")).toBeInTheDocument()
    expect(input).toHaveValue("")
  })

  it("supports ArrowDown, ArrowUp, Enter, Tab, and Escape keyboard navigation without submitting the prompt", async () => {
    const onSubmit = vi.fn()
    vi.spyOn(ipcClient.plugins, "getState").mockResolvedValue({
      featuredId: "sk_debug",
      plugins: [],
      skills: [],
      memories: [],
    })

    renderComposer({ onSubmit })
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "This is the /" } })
    await screen.findByTestId("composer-slash-menu")

    const goalBtn = screen.getByRole("button", { name: /\bgoal\b/i })
    const planBtn = screen.getByRole("button", { name: /\bplan\b/i })
    expect(goalBtn).toHaveAttribute("data-active", "true")
    expect(planBtn).toHaveAttribute("data-active", "false")

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(goalBtn).toHaveAttribute("data-active", "false")
    expect(planBtn).toHaveAttribute("data-active", "true")

    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId("composer-skill-token-plan")).toBeInTheDocument()
    expect(input).toHaveValue("This is the ")
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()

    // Re-open and test Tab selection + Escape
    fireEvent.change(input, { target: { value: "This is the /sw" } })
    await screen.findByTestId("composer-slash-menu")
    fireEvent.keyDown(input, { key: "Tab" })
    expect(screen.getByTestId("composer-skill-token-swarm")).toBeInTheDocument()
    expect(input).toHaveValue("This is the ")

    fireEvent.change(input, { target: { value: "This is the /re" } })
    await screen.findByTestId("composer-slash-menu")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByTestId("composer-slash-menu")).not.toBeInTheDocument()
  })

  it("preserves leading '/' behavior by clearing textarea after selection", async () => {
    renderComposer()
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()

    fireEvent.change(input, { target: { value: "/" } })
    const swarmCmd = await screen.findByRole("button", { name: /swarm/i })
    fireEvent.click(swarmCmd)

    expect(screen.getByTestId("composer-skill-token-swarm")).toHaveTextContent(
      "swarm"
    )
    expect(input).toHaveValue("")
  })
})
