import "@testing-library/jest-dom/vitest"
import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import {
  EFFORT_STOPS,
  FALLBACK_MODELS,
  FALLBACK_PERMISSION_MODES,
  HomeView,
  ModelEffortPopover,
  PermissionPopover,
  SessionComposer,
  type ModelOption,
  type PermissionModeId,
  type ReasoningEffort,
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

function renderWithProviders(ui: React.ReactElement) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </QueryClientProvider>
  )
}

function ControlledModelEffortHarness({
  initialModel = FALLBACK_MODELS[1],
  initialEffort = "Medium",
  models = FALLBACK_MODELS,
}: {
  initialModel?: ModelOption
  initialEffort?: ReasoningEffort
  models?: readonly ModelOption[]
}) {
  const [model, setModel] = React.useState<ModelOption>(initialModel)
  const [effort, setEffort] = React.useState<ReasoningEffort>(initialEffort)

  return (
    <ModelEffortPopover
      modelId={model.id}
      modelLabel={model.label}
      effort={effort}
      models={models}
      onSelectModel={setModel}
      onSelectEffort={setEffort}
    />
  )
}

function ControlledPermissionHarness({
  initialMode = "default",
}: {
  initialMode?: PermissionModeId
}) {
  const [mode, setMode] = React.useState<PermissionModeId>(initialMode)
  return (
    <PermissionPopover
      value={mode}
      onChange={setMode}
      modes={FALLBACK_PERMISSION_MODES}
    />
  )
}

describe("ModelEffortPopover (2-Stage Model & 5-Stop Reasoning Effort)", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("selects all 5 reasoning effort stops (Auto, Low, Medium, High, Max) via click and keyboard", () => {
    renderWithProviders(<ControlledModelEffortHarness />)

    const trigger = screen.getByTestId("model-effort-trigger")
    expect(trigger).toHaveTextContent("Claude Opus 5.5")
    expect(trigger).toHaveTextContent("Medium")

    fireEvent.click(trigger)
    expect(screen.getByTestId("effort-stage-card")).toBeInTheDocument()

    // Click each of the 5 stops and verify value, aria-valuenow, and description
    for (const stop of EFFORT_STOPS) {
      const stopBtn = screen.getByRole("button", { name: stop.level })
      fireEvent.click(stopBtn)
      expect(screen.getByTestId("effort-level-value")).toHaveTextContent(
        stop.level
      )
      expect(screen.getByTestId("effort-description")).toHaveTextContent(
        stop.description
      )
      expect(screen.getByTestId("effort-slider")).toHaveAttribute(
        "aria-valuenow",
        String(stop.index)
      )
      expect(trigger).toHaveTextContent(stop.level)
    }

    // Keyboard navigation: Home -> Auto (0), ArrowRight -> Low (1), End -> Max (4)
    const slider = screen.getByTestId("effort-slider")
    fireEvent.keyDown(slider, { key: "Home" })
    expect(screen.getByTestId("effort-level-value")).toHaveTextContent("Auto")

    fireEvent.keyDown(slider, { key: "ArrowRight" })
    expect(screen.getByTestId("effort-level-value")).toHaveTextContent("Low")

    fireEvent.keyDown(slider, { key: "End" })
    expect(screen.getByTestId("effort-level-value")).toHaveTextContent("Max")
  })

  it("supports Fast mode toggle (Low) and Reset button (Claude Opus 5.5 + Medium)", () => {
    const customModel = FALLBACK_MODELS.find((m) => m.id === "gpt-6.1-sol")!
    renderWithProviders(
      <ControlledModelEffortHarness
        initialModel={customModel}
        initialEffort="High"
      />
    )

    fireEvent.click(screen.getByTestId("model-effort-trigger"))

    // Fast toggle switches to Low effort
    fireEvent.click(screen.getByTestId("effort-fast-btn"))
    expect(screen.getByTestId("effort-level-value")).toHaveTextContent("Low")
    expect(screen.getByTestId("effort-fast-btn")).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    // Reset button restores Claude Opus 5.5 + Medium
    fireEvent.click(screen.getByTestId("effort-reset-btn"))
    expect(screen.getByTestId("effort-level-value")).toHaveTextContent("Medium")
    expect(screen.getByTestId("model-effort-trigger")).toHaveTextContent(
      "Claude Opus 5.5"
    )
    expect(screen.getByTestId("model-effort-trigger")).toHaveTextContent(
      "Medium"
    )
  })

  it("transitions Stage 1 -> Stage 2 (Select model), lists Default + all 19 real RayuCode models, and switches models", () => {
    renderWithProviders(<ControlledModelEffortHarness />)

    fireEvent.click(screen.getByTestId("model-effort-trigger"))
    fireEvent.click(screen.getByTestId("open-model-list-btn"))

    const listCard = screen.getByTestId("model-list-card")
    expect(listCard).toBeInTheDocument()

    const listbox = within(listCard).getByRole("listbox", {
      name: "Select model",
    })
    const options = within(listbox).getAllByRole("option")
    // Default + 19 real RayuCode models = 20 options
    expect(options).toHaveLength(20)
    expect(options[0]).toHaveTextContent("Default")
    expect(options[0]).toHaveTextContent("Recommended set of models")

    // Verify all 19 real models are present
    const expectedModels = [
      "Claude Opus 5.5",
      "GPT-6.1 Sol",
      "GPT-6 Astra",
      "Claude Opus 5",
      "Claude Fable 5.1",
      "Claude Sonnet 5",
      "Claude Sonnet 4.6",
      "Claude Haiku 4.5",
      "GPT-5.6 Sol",
      "GPT-5.6 Pro",
      "GPT-5.6 Terra",
      "GPT-5.6 Luna",
      "Gemini 3.1 Pro",
      "Gemini 3 Flash",
      "DeepSeek V4 Flash",
      "Kimi K2.5",
      "GPT-OSS 120B",
      "MiniMax M2.7",
      "GLM-5.1",
    ]
    for (const label of expectedModels) {
      expect(
        within(listbox).getByRole("option", { name: label })
      ).toBeInTheDocument()
    }

    // Back header returns to Stage 1
    fireEvent.click(screen.getByTestId("model-list-back-btn"))
    expect(screen.getByTestId("effort-stage-card")).toBeInTheDocument()

    // Re-enter Stage 2 and switch to Gemini 3.1 Pro
    fireEvent.click(screen.getByTestId("open-model-list-btn"))
    fireEvent.click(screen.getByRole("option", { name: "Gemini 3.1 Pro" }))

    expect(screen.getByTestId("model-effort-trigger")).toHaveTextContent(
      "Gemini 3.1 Pro"
    )
    // Popover closes after selection
    expect(screen.queryByTestId("model-list-card")).not.toBeInTheDocument()
  })
})

describe("PermissionPopover (5 Local Permission Modes & Shift+Tab Cycling)", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders all 5 Local Permission modes with Default badge and selects modes", () => {
    renderWithProviders(<ControlledPermissionHarness />)

    const trigger = screen.getByTestId("permission-mode-trigger")
    expect(trigger).toHaveTextContent("Ask")

    fireEvent.click(trigger)
    const listbox = screen.getByRole("listbox", { name: "Local Permissions" })
    const options = within(listbox).getAllByRole("option")
    expect(options).toHaveLength(5)

    expect(options[0]).toHaveTextContent("Ask")
    expect(options[0]).toHaveTextContent("Default")
    expect(options[0]).toHaveTextContent(
      "Ask before running tools that change anything."
    )
    expect(options[1]).toHaveTextContent("Auto-edit")
    expect(options[2]).toHaveTextContent("Plan")
    expect(options[3]).toHaveTextContent("Full Manage")
    expect(options[4]).toHaveTextContent("Orchestrator")

    fireEvent.click(options[3])
    expect(trigger).toHaveTextContent("Full Manage")
  })

  it("cycles through all 5 permission modes on Shift+Tab and wraps back to Ask", () => {
    renderWithProviders(<ControlledPermissionHarness />)

    const trigger = screen.getByTestId("permission-mode-trigger")
    const cycleLabels = [
      "Auto-edit",
      "Plan",
      "Full Manage",
      "Orchestrator",
      "Ask",
    ]

    for (const expectedLabel of cycleLabels) {
      fireEvent.keyDown(window, { key: "Tab", shiftKey: true })
      expect(trigger).toHaveTextContent(expectedLabel)
    }
  })
})

describe("SessionComposer & HomeView", () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.setState({
      activeRoute: "home",
      activeSessionId: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows Project & Checkout top tray only in home mode and hides it in workspace mode", () => {
    const { rerender } = renderWithProviders(<SessionComposer mode="home" />)
    expect(screen.getByTestId("composer-top-tray")).toBeInTheDocument()
    expect(screen.getByTestId("composer-project-trigger")).toHaveTextContent(
      "rayucode-v2"
    )
    expect(screen.getByTestId("composer-checkout-trigger")).toHaveTextContent(
      "Local Checkout"
    )
    expect(screen.getByTestId("composer-shell")).toHaveClass("max-w-[732px]")

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <TooltipProvider delayDuration={0}>
          <SessionComposer mode="workspace" />
        </TooltipProvider>
      </QueryClientProvider>
    )
    expect(screen.queryByTestId("composer-top-tray")).not.toBeInTheDocument()
  })

  it("discovers live future models from ipcClient.models.list() absent from fallback arrays and inserts slash commands", async () => {
    const futureModel: ModelOption = {
      id: "rayu-future-9-ultra",
      label: "Rayu Future 9 Ultra",
      provider: "rayu",
    }
    vi.spyOn(ipcClient.models, "list").mockResolvedValueOnce([
      ...FALLBACK_MODELS,
      futureModel,
    ])

    renderWithProviders(<SessionComposer mode="home" />)

    // Open model popover -> Stage 2 -> verify live-discovered model renders and is selectable
    fireEvent.click(screen.getByTestId("model-effort-trigger"))
    fireEvent.click(screen.getByTestId("open-model-list-btn"))

    const futureOption = await screen.findByRole("option", {
      name: "Rayu Future 9 Ultra",
    })
    fireEvent.click(futureOption)
    expect(screen.getByTestId("model-effort-trigger")).toHaveTextContent(
      "Rayu Future 9 Ultra"
    )

    // Typing "/" opens built-in skills menu and clicking "swarm" renders an inline skill token (no raw "/")
    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    input.focus()
    fireEvent.change(input, { target: { value: "/" } })
    const swarmCmd = screen.getByRole("button", { name: /swarm/i })
    fireEvent.click(swarmCmd)
    expect(screen.getByTestId("composer-skill-token-swarm")).toHaveTextContent(
      "swarm"
    )
    expect(input).toHaveValue("")
  })

  it("renders serene prototype HomeView greeting with rayu-fox hero and creates a new session with the user prompt", async () => {
    const createSpy = vi.spyOn(ipcClient.sessions, "createSession")
    renderWithProviders(<HomeView />)

    // Editorial greeting + real rayu-fox hero matching prototype/index.html
    expect(screen.getByAltText("Rayu Code")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { level: 1 })
    ).toHaveTextContent("Good to see you, Khai. What's next?")

    // Reset route and submit a new prompt via composer
    useAppStore.setState({ activeRoute: "home", activeSessionId: null })

    const input = screen.getByRole("textbox", { name: "Message RayuCode" })
    fireEvent.change(input, {
      target: { value: "Verify ShardStore lookup latency" },
    })
    fireEvent.click(screen.getByTestId("composer-send-btn"))

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Verify ShardStore lookup latency",
          project: "rayucode-v2",
          checkout: "Local Checkout",
          modelId: "claude-opus-5-5",
          modelLabel: "Claude Opus 5.5",
          effort: "Medium",
          permissionMode: "default",
        })
      )
    })

    await waitFor(() => {
      expect(useAppStore.getState().activeRoute).toBe("workspace")
      expect(useAppStore.getState().activeSessionId).toMatch(/^ses_/)
      expect(useAppStore.getState().pendingStreamPrompt).toMatchObject({
        prompt: "Verify ShardStore lookup latency",
      })
    })
  })

  it("opens Presentations Templates carousel from + menu, shows Clarifying Question card, and submits structured prompt", async () => {
    const onSubmit = vi.fn()
    renderWithProviders(<SessionComposer mode="home" onSubmit={onSubmit} />)

    // Open + menu -> click Presentations
    fireEvent.click(screen.getByTestId("composer-plus-trigger"))
    expect(screen.getByTestId("composer-add-menu")).toBeInTheDocument()
    expect(screen.getByText("RayuCode conversations")).toBeInTheDocument()
    expect(screen.getByTestId("files-and-chats-search")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("plugin-presentations-btn"))

    // Inline Presentations token + Presentations Templates carousel appear
    expect(
      screen.getByTestId("composer-skill-token-presentations")
    ).toHaveTextContent("Presentations")
    expect(
      screen.getByTestId("template-carousel-presentation")
    ).toBeInTheDocument()

    // Click Operating Review -> Clarifying Question Card opens
    fireEvent.click(screen.getByTestId("template-card-tpl_operating_review"))
    const card = screen.getByTestId("clarifying-question-card")
    expect(card).toHaveTextContent(
      "What should the Business Review deck be based on?"
    )
    expect(screen.getByTestId("clarifying-option-1")).toHaveTextContent(
      "I'll provide data"
    )
    expect(screen.getByTestId("clarifying-option-2")).toHaveTextContent(
      "Repository overview"
    )

    // Pick option 2 -> submits structured prompt with /presentations + Operating Review spec
    fireEvent.click(screen.getByTestId("clarifying-option-2"))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("[Template: Operating Review"),
        })
      )
    })
  })

  it("opens Spreadsheets Templates carousel and switches composer placeholder in Plan mode", () => {
    renderWithProviders(<SessionComposer mode="home" permissionMode="plan" />)
    expect(
      screen.getByPlaceholderText("Describe your task to generate a plan...")
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("composer-plus-trigger"))
    fireEvent.click(screen.getByTestId("plugin-spreadsheets-btn"))

    expect(
      screen.getByTestId("composer-skill-token-spreadsheets")
    ).toHaveTextContent("Spreadsheets")
    expect(
      screen.getByTestId("template-carousel-spreadsheet")
    ).toBeInTheDocument()
    expect(screen.getByText("Analytics Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Financial Budget")).toBeInTheDocument()
    expect(screen.getByText("Operating Calendar")).toBeInTheDocument()
  })
})
