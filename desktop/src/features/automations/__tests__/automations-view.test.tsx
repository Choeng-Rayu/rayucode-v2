import "@testing-library/jest-dom/vitest"
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
import { ipcClient, type AutomationsState } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { AutomationsView } from "../index"

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

function createInitialMockState(): AutomationsState {
  return {
    running: [
      {
        id: "ovn_8f2a",
        title: "Overnight: Gateway soak & retry dedup",
        status: "Running",
        host: "choeng-rayu-1",
        maxAgents: "max 4 agents",
        duration: "8h overnight",
        wakeTime: "07:00",
        handoffTime: "06:45",
        taskCardsCount: 3,
        validationsGreen: 1,
        eventLog: [
          "01:14:02  preflight   repo clean on feat/retire-session-cache · 214 MB RAM budget",
          "01:16:40  task_card   spawned worker-1 (e7b3) → stress retry_budget streaming dedup",
          "01:28:11  validation  cargo test -p rayu-gateway retry_budget → 5 ok, 1 patch queued",
          "01:31:05  handoff     drafting review_notes.md for 06:45 morning report",
        ],
      },
    ],
    schedules: [
      {
        id: "sch_1",
        title: "Daily PR & CI triage",
        modeBadge: "Plan",
        cronSummary: "08:30 Mon–Fri",
        repo: "rayucode-v2",
        description:
          "summarizes failing checks & open review comments to Telegram",
        enabled: true,
      },
      {
        id: "sch_2",
        title: "Nightly Rust clippy + cargo test",
        modeBadge: "Auto-edit",
        cronSummary: "02:00 Daily",
        repo: "rayucode-v2",
        description: "fixes lint warnings on an isolated worktree branch",
        enabled: true,
      },
      {
        id: "sch_3",
        title: "Weekly token & KV cache digest",
        modeBadge: "Plan",
        cronSummary: "Sun 18:00",
        repo: "rayu-web",
        description: "exports Excel cost breakdown & cache hit trend",
        enabled: false,
      },
    ],
    reports: [
      {
        id: "rep_1",
        title: "SessionCache audit & ShardStore port",
        status: "Completed",
        timestamp: "Yesterday · 06:52",
        testsSummary: "14 unit tests passing · 2 issue drafts staged",
        credits: "1.84 credits",
        kvWarmPct: 93,
        actionLabel: "Review diffs",
        targetRoute: "changes",
      },
      {
        id: "rep_2",
        title: "VS Code model picker parity check",
        status: "Completed",
        timestamp: "Nov 20 · 06:48",
        testsSummary: "0 regressions",
        credits: "0.62 credits",
        kvWarmPct: 91,
        actionLabel: "Open session",
        targetRoute: "workspace",
      },
    ],
  }
}

function renderAutomationsView() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <AutomationsView />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("AutomationsView", () => {
  let stateRef: AutomationsState

  beforeEach(() => {
    stateRef = createInitialMockState()
    useAppStore.getState().setActiveRoute("automations")

    vi.spyOn(ipcClient.automations, "getState").mockImplementation(async () =>
      structuredClone(stateRef)
    )

    vi.spyOn(ipcClient.automations, "launchOvernight").mockImplementation(
      async (input) => {
        stateRef = {
          ...stateRef,
          running: [
            {
              id: "ovn_91bc",
              title: input.mission,
              status: "Running",
              host: "choeng-rayu-1",
              maxAgents: input.maxAgents,
              duration: input.duration,
              wakeTime: "07:00",
              handoffTime: "06:45",
              taskCardsCount: 2,
              validationsGreen: 0,
              eventLog: [
                `Just now  preflight   launched ${input.duration} (${input.permissionMode})`,
              ],
            },
            ...stateRef.running,
          ],
        }
        return structuredClone(stateRef)
      }
    )

    vi.spyOn(ipcClient.automations, "toggleSchedule").mockImplementation(
      async (scheduleId) => {
        stateRef = {
          ...stateRef,
          schedules: stateRef.schedules.map((s) =>
            s.id === scheduleId ? { ...s, enabled: !s.enabled } : s
          ),
        }
        return structuredClone(stateRef)
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("validates with Zod and launches a new overnight mission via OvernightLauncher", async () => {
    renderAutomationsView()

    await screen.findByTestId("automations-view")

    const toggleBtn = screen.getByTestId("new-overnight-run-btn")
    fireEvent.click(toggleBtn)

    expect(screen.getByTestId("overnight-launcher")).toBeInTheDocument()

    // Empty submit triggers Zod validation error without calling IPC
    fireEvent.click(screen.getByTestId("launch-overnight-btn"))
    expect(screen.getByTestId("overnight-launcher-error")).toHaveTextContent(
      "Describe the overnight mission (at least 3 characters)"
    )
    expect(ipcClient.automations.launchOvernight).not.toHaveBeenCalled()

    // Valid submit invokes ipcClient.automations.launchOvernight and prepends run
    const input = screen.getByTestId("overnight-mission-input")
    fireEvent.change(input, {
      target: { value: "Harden retry_budget edge cases and stage report" },
    })
    fireEvent.click(screen.getByTestId("launch-overnight-btn"))

    await waitFor(() => {
      expect(ipcClient.automations.launchOvernight).toHaveBeenCalledWith({
        mission: "Harden retry_budget edge cases and stage report",
        duration: "8h",
        maxAgents: "4 agents",
        permissionMode: "Auto-edit",
      })
    })

    const runningList = screen.getByTestId("ovn-running-list")
    expect(
      within(runningList).getByText(
        "Harden retry_budget edge cases and stage report"
      )
    ).toBeInTheDocument()
    expect(within(runningList).getByText(/07:30 AM/)).toBeInTheDocument()
    expect(screen.queryByTestId("overnight-launcher")).not.toBeInTheDocument()
  })

  it("expands and collapses the running manifest event log and supports Pause/Resume and Run now", async () => {
    renderAutomationsView()

    await screen.findByTestId("overnight-run-ovn_8f2a")

    const eventLogBtn = screen.getByTestId("toggle-event-log-ovn_8f2a")
    expect(eventLogBtn).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByTestId("event-log-drawer-ovn_8f2a")
    ).not.toBeInTheDocument()

    // Expand event log
    fireEvent.click(eventLogBtn)
    expect(eventLogBtn).toHaveAttribute("aria-expanded", "true")
    const drawer = screen.getByTestId("event-log-drawer-ovn_8f2a")
    expect(drawer).toHaveTextContent(
      /01:14:02\s+preflight\s+repo clean on feat\/retire-session-cache/
    )

    // Collapse event log
    fireEvent.click(eventLogBtn)
    expect(eventLogBtn).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByTestId("event-log-drawer-ovn_8f2a")
    ).not.toBeInTheDocument()

    // Pause then Resume
    const pauseBtn = screen.getByTestId("toggle-pause-ovn_8f2a")
    fireEvent.click(pauseBtn)
    await waitFor(() => {
      expect(screen.getByTestId("overnight-run-ovn_8f2a")).toHaveTextContent(
        "Paused"
      )
      expect(pauseBtn).toHaveTextContent("Resume")
    })

    fireEvent.click(pauseBtn)
    await waitFor(() => {
      expect(screen.getByTestId("overnight-run-ovn_8f2a")).toHaveTextContent(
        "Running"
      )
      expect(pauseBtn).toHaveTextContent("Pause")
    })

    // Trigger Run now
    fireEvent.click(screen.getByTestId("run-now-ovn_8f2a"))
    await waitFor(() => {
      expect(screen.getByTestId("overnight-run-ovn_8f2a")).toHaveTextContent(
        "2 validations green"
      )
      expect(
        screen.getByTestId("event-log-drawer-ovn_8f2a")
      ).toHaveTextContent("verifier-1 passed immediate validation check")
    })
  })

  it("toggles recurring schedule switch and triggers Run now", async () => {
    renderAutomationsView()

    await screen.findByTestId("schedule-row-sch_1")

    const schSwitch = screen.getByTestId("schedule-switch-sch_1")
    expect(schSwitch).toHaveAttribute("aria-checked", "true")

    fireEvent.click(schSwitch)

    await waitFor(() => {
      expect(ipcClient.automations.toggleSchedule).toHaveBeenCalledWith("sch_1")
    })
    await waitFor(() => {
      expect(screen.getByTestId("schedule-switch-sch_1")).toHaveAttribute(
        "aria-checked",
        "false"
      )
    })

    const schRow = screen.getByTestId("schedule-row-sch_2")
    fireEvent.click(screen.getByTestId("trigger-schedule-sch_2"))
    expect(within(schRow).getByText("Queued now")).toBeInTheDocument()
  })

  it("navigates to target route when clicking Morning Handoff Report action buttons", async () => {
    renderAutomationsView()

    await screen.findByTestId("morning-report-rep_1")

    fireEvent.click(screen.getByTestId("report-action-rep_1"))
    expect(useAppStore.getState().activeRoute).toBe("changes")

    fireEvent.click(screen.getByTestId("report-action-rep_2"))
    expect(useAppStore.getState().activeRoute).toBe("workspace")
  })
})
