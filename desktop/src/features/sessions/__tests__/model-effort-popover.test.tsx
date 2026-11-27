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
import { ipcClient } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import {
  FALLBACK_PERMISSION_MODES,
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

const TEST_MODELS: readonly ModelOption[] = [
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    recommended: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
    contextWindow: 200_000,
    subtitle: "Anthropic",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    supportedEfforts: [],
    contextWindow: 128_000,
    subtitle: "Fixed reasoning",
  },
  {
    id: "future-reasoner-1",
    label: "Future Reasoner 1",
    provider: "rayu",
    supportedEfforts: ["none", "minimal", "high", "swarm_auto"],
    defaultEffort: "minimal",
    contextWindow: 1_000_000,
  },
]

function renderWithProviders(ui: React.ReactElement) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </QueryClientProvider>
  )
}

function ControlledModelEffortHarness({
  initialModel = TEST_MODELS[0],
  initialEffort = "medium",
  models = TEST_MODELS,
  deferredNotice = null,
  onEffortChange,
}: {
  initialModel?: ModelOption
  initialEffort?: ReasoningEffort
  models?: readonly ModelOption[]
  deferredNotice?: string | null
  onEffortChange?: (effort: ReasoningEffort) => void
}) {
  const [model, setModel] = React.useState<ModelOption>(initialModel)
  const [effort, setEffort] = React.useState<ReasoningEffort>(initialEffort)

  return (
    <ModelEffortPopover
      modelId={model.id}
      modelLabel={model.label}
      effort={effort}
      models={models}
      deferredNotice={deferredNotice}
      onSelectModel={setModel}
      onSelectEffort={(next) => {
        setEffort(next)
        onEffortChange?.(next)
      }}
    />
  )
}

describe("ModelEffortPopover (v1.16 engine-driven adaptive effort ladder)", () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.setState({ activeSessionId: null, sessionModelInfoBySession: {} })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders dynamic N-stop ladder from resolveEffortLadder including xhigh and never fabricates Auto", () => {
    const onEffortChange = vi.fn()
    renderWithProviders(
      <ControlledModelEffortHarness onEffortChange={onEffortChange} />
    )

    const trigger = screen.getByTestId("model-effort-trigger")
    expect(trigger).toHaveTextContent("Claude Opus 4.6")
    expect(trigger).toHaveTextContent("Medium")

    fireEvent.click(trigger)
    expect(screen.getByTestId("effort-stage-card")).toBeInTheDocument()

    // Never fabricates "Auto"
    expect(screen.queryByRole("button", { name: "Auto" })).not.toBeInTheDocument()
    // Renders "Extra High" stop (with compact "X-High" tick)
    const xhighBtn = screen.getByRole("button", { name: "Extra High" })
    fireEvent.click(xhighBtn)
    expect(onEffortChange).toHaveBeenCalledWith("xhigh")
    expect(screen.getByTestId("effort-level-value")).toHaveTextContent(
      "Extra High"
    )
    expect(screen.getByText("X-High")).toBeInTheDocument()

    // Keyboard End moves to Max
    const slider = screen.getByTestId("effort-slider")
    fireEvent.keyDown(slider, { key: "End" })
    expect(onEffortChange).toHaveBeenLastCalledWith("max")
  })

  it("hides effort label and opens directly to Stage 2 Select model for 0-stop models", () => {
    renderWithProviders(
      <ControlledModelEffortHarness
        initialModel={TEST_MODELS[1]}
        initialEffort=""
      />
    )

    const trigger = screen.getByTestId("model-effort-trigger")
    expect(trigger).toHaveTextContent("GPT-4o Mini")
    expect(
      screen.queryByTestId("model-effort-trigger-effort")
    ).not.toBeInTheDocument()

    // Opens straight into Stage 2 model list without a back button
    fireEvent.click(trigger)
    expect(screen.getByTestId("model-list-card")).toBeInTheDocument()
    expect(screen.queryByTestId("effort-stage-card")).not.toBeInTheDocument()
    expect(
      screen.queryByTestId("model-list-back-btn")
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("model-list-heading")).toHaveTextContent(
      "Select model"
    )
    // Context window formatting in Stage 2 rows
    expect(screen.getByText("200k ctx")).toBeInTheDocument()
    expect(screen.getByText("1M ctx")).toBeInTheDocument()
  })

  it("defensively filters swarm* sentinels and formats none as Off", () => {
    renderWithProviders(
      <ControlledModelEffortHarness
        initialModel={TEST_MODELS[2]}
        initialEffort="minimal"
      />
    )
    fireEvent.click(screen.getByTestId("model-effort-trigger"))
    expect(screen.getByRole("button", { name: "Off" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Minimal" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "High" })).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /swarm/i })
    ).not.toBeInTheDocument()
  })

  it("dispatches active-session setReasoningEffort immediately and shows 'Applies on next turn' badge on ErrorCode::Busy", async () => {
    useAppStore.setState({ activeSessionId: "live_sess_1" })
    vi.spyOn(ipcClient.models, "list").mockResolvedValue([...TEST_MODELS])
    const setEffortSpy = vi
      .spyOn(ipcClient.harness, "setReasoningEffort")
      .mockResolvedValue({
        ok: false,
        code: "busy",
        error: "Session is busy",
      })

    renderWithProviders(<SessionComposer mode="workspace" />)

    const trigger = await screen.findByTestId("model-effort-trigger")
    await waitFor(() => {
      expect(trigger).toHaveTextContent("Claude Opus 4.6")
    })

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("button", { name: "Extra High" }))

    await waitFor(() => {
      expect(setEffortSpy).toHaveBeenCalledWith("live_sess_1", "xhigh")
    })

    expect(
      await screen.findByTestId("effort-deferred-badge")
    ).toHaveTextContent("Applies on next turn")
    expect(screen.getByTestId("composer-deferred-badge")).toHaveTextContent(
      "Applies on next turn"
    )
  })

  it("cycles local permission modes cleanly", () => {
    function PermissionHarness() {
      const [mode, setMode] = React.useState<PermissionModeId>("default")
      return (
        <PermissionPopover
          value={mode}
          onChange={setMode}
          modes={FALLBACK_PERMISSION_MODES}
        />
      )
    }
    renderWithProviders(<PermissionHarness />)
    expect(screen.getByTestId("permission-mode-trigger")).toHaveTextContent(
      "Ask"
    )
  })

  it("never renders duplicate 'Approve for me' button even while submitting with pendingPermission, keeping Local Permissions intact", async () => {
    useAppStore.setState({
      activeSessionId: "live_sess_perm",
      pendingPermission: {
        sessionId: "live_sess_perm",
        requestId: "req_42",
        toolName: "bash",
        description: "Run git status",
      },
    })
    vi.spyOn(ipcClient.models, "list").mockResolvedValue([...TEST_MODELS])

    renderWithProviders(<SessionComposer mode="workspace" isSubmitting />)

    expect(
      screen.queryByTestId("composer-approve-for-me-btn")
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/approve for me/i)).not.toBeInTheDocument()

    const permTrigger = screen.getByTestId("permission-mode-trigger")
    expect(permTrigger).toBeInTheDocument()
    fireEvent.click(permTrigger)
    expect(await screen.findByText("Local Permissions")).toBeInTheDocument()

    useAppStore.setState({ pendingPermission: null })
  })

  it("exposes engine-accurate effort ladder on Home fallback catalog without fabricating Auto and hides effort for unsupported models", async () => {
    renderWithProviders(<SessionComposer mode="home" />)

    const trigger = await screen.findByTestId("model-effort-trigger")
    const effortBadge = await screen.findByTestId("model-effort-trigger-effort")
    expect(effortBadge).toHaveTextContent("Low")
    expect(effortBadge.className).toContain("@max-[360px]/composer:hidden")

    fireEvent.click(trigger)
    expect(screen.getByTestId("effort-stage-card")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Auto" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Off" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Extra High" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Max" })).toBeInTheDocument()

    // Switch to Haiku (no engine effort support) via Stage 2
    fireEvent.click(screen.getByTestId("open-model-list-btn"))
    expect(screen.getByTestId("model-list-card")).toBeInTheDocument()
    expect(screen.getByTestId("model-list-back-btn")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("option", { name: /Claude Haiku 4\.5/i }))

    await waitFor(() => {
      expect(trigger).toHaveTextContent("Claude Haiku 4.5")
    })
    expect(
      screen.queryByTestId("model-effort-trigger-effort")
    ).not.toBeInTheDocument()

    // Reopening on Haiku goes straight to Stage 2 Select model
    fireEvent.click(trigger)
    expect(screen.getByTestId("model-list-card")).toBeInTheDocument()
    expect(screen.queryByTestId("effort-stage-card")).not.toBeInTheDocument()
  })

  it("matches rayu:-prefixed catalog models cleanly and navigates between Stage 1 Effort and Stage 2 Select model", () => {
    const rayuCatalog: readonly ModelOption[] = [
      {
        id: "rayu:claude-opus-4-6",
        label: "Claude Opus 4.6",
        provider: "rayu",
        supportedEfforts: ["none", "low", "medium", "high", "max"],
        defaultEffort: "low",
      },
    ]

    renderWithProviders(
      <ModelEffortPopover
        modelId="claude-opus-4-6"
        modelLabel="Claude Opus 4.6"
        effort="high"
        models={rayuCatalog}
        onSelectModel={vi.fn()}
        onSelectEffort={vi.fn()}
      />
    )

    const trigger = screen.getByTestId("model-effort-trigger")
    expect(screen.getByTestId("model-effort-trigger-effort")).toHaveTextContent(
      "High"
    )

    fireEvent.click(trigger)
    expect(screen.getByTestId("effort-stage-card")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("open-model-list-btn"))
    expect(screen.getByTestId("model-list-card")).toBeInTheDocument()
    const option = screen.getByRole("option", { name: /Claude Opus 4\.6/i })
    expect(option).toHaveAttribute("aria-selected", "true")

    fireEvent.click(screen.getByTestId("model-list-back-btn"))
    expect(screen.getByTestId("effort-stage-card")).toBeInTheDocument()
  })
})
