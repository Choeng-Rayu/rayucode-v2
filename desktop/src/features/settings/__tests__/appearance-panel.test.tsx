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
import {
  ipcClient,
  type DaemonStatus,
  type SettingsState,
} from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { AppearancePanel, SettingsView } from "../index"

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
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

function createMockSettingsState(): SettingsState {
  return {
    account: {
      name: "Khai Ly",
      username: "@khai",
      email: "khai@rayucode.com",
      plan: "Pro Max Plan",
      ageRange: "18 or older",
      builderProfile: "Khai Ly",
      streakDays: 14,
      sessionsCompleted: 128,
      kvSavingsPct: "94.2%",
    },
    usage: {
      planName: "RayuCode Pro Max",
      monthlyCreditsAllowance: 115000,
      monthlyCreditsRemaining: 104200,
      fiveHourCap: 1437,
      fiveHourLeft: 1437,
      weeklyCap: 28750,
      weeklyLeft: 28750,
      useAllCredits: false,
      paygCredits: 0,
    },
    preferences: {
      notificationsEnabled: true,
      voiceModel: "Rayu Natural Voice",
      autoCompactContext: true,
      showMiniPet: false,
      defaultPermissionMode: "default",
    },
  }
}

function createMockDaemonStatus(): DaemonStatus {
  return {
    connected: true,
    reconnecting: false,
    socketPath: "~/.rayu/builds/shared-server/rayu",
    version: "2.0.0",
    latencyMs: 2,
  }
}

function renderSettingsView() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <SettingsView />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("AppearancePanel & SettingsView", () => {
  let settingsRef: SettingsState
  let daemonRef: DaemonStatus

  beforeEach(() => {
    settingsRef = createMockSettingsState()
    daemonRef = createMockDaemonStatus()

    window.localStorage.clear()
    useAppStore.getState().setTheme("dark")
    useAppStore.getState().setAccent("green")
    useAppStore.getState().setActiveRoute("settings")

    vi.spyOn(ipcClient.settings, "getState").mockImplementation(async () =>
      structuredClone(settingsRef)
    )
    vi.spyOn(ipcClient.settings, "updatePreferences").mockImplementation(
      async (patch) => {
        settingsRef = {
          ...settingsRef,
          preferences: { ...settingsRef.preferences, ...patch },
        }
        return structuredClone(settingsRef)
      }
    )
    vi.spyOn(ipcClient.settings, "setUseAllCredits").mockImplementation(
      async (useAllCredits) => {
        settingsRef = {
          ...settingsRef,
          usage: { ...settingsRef.usage, useAllCredits },
        }
        return structuredClone(settingsRef)
      }
    )
    vi.spyOn(ipcClient.daemon, "getStatus").mockImplementation(async () =>
      structuredClone(daemonRef)
    )
    vi.spyOn(ipcClient.daemon, "onStatusChange").mockImplementation(
      () => () => {}
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("toggles Warm Graphite Dark <-> Warm Paper Light and updates store, data-theme, and localStorage", () => {
    render(<AppearancePanel />)

    const darkCard = screen.getByTestId("theme-card-dark")
    const lightCard = screen.getByTestId("theme-card-light")

    expect(darkCard).toHaveAttribute("aria-pressed", "true")
    expect(lightCard).toHaveAttribute("aria-pressed", "false")
    expect(useAppStore.getState().theme).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(window.localStorage.getItem("rayu-theme")).toBe("dark")

    fireEvent.click(lightCard)

    expect(useAppStore.getState().theme).toBe("light")
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
    expect(window.localStorage.getItem("rayu-theme")).toBe("light")
    expect(lightCard).toHaveAttribute("aria-pressed", "true")
    expect(darkCard).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(darkCard)

    expect(useAppStore.getState().theme).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(window.localStorage.getItem("rayu-theme")).toBe("dark")
    expect(darkCard).toHaveAttribute("aria-pressed", "true")
    expect(lightCard).toHaveAttribute("aria-pressed", "false")
  })

  it("toggles Rayu Green <-> Ocean Blue and updates store, data-accent, and localStorage", () => {
    render(<AppearancePanel />)

    const greenCard = screen.getByTestId("accent-card-green")
    const blueCard = screen.getByTestId("accent-card-blue")

    expect(greenCard).toHaveAttribute("aria-pressed", "true")
    expect(blueCard).toHaveAttribute("aria-pressed", "false")
    expect(useAppStore.getState().accent).toBe("green")
    expect(document.documentElement.getAttribute("data-accent")).toBe("green")
    expect(window.localStorage.getItem("rayu-accent")).toBe("green")

    fireEvent.click(blueCard)

    expect(useAppStore.getState().accent).toBe("blue")
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue")
    expect(window.localStorage.getItem("rayu-accent")).toBe("blue")
    expect(blueCard).toHaveAttribute("aria-pressed", "true")
    expect(greenCard).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(greenCard)

    expect(useAppStore.getState().accent).toBe("green")
    expect(document.documentElement.getAttribute("data-accent")).toBe("green")
    expect(window.localStorage.getItem("rayu-accent")).toBe("green")
    expect(greenCard).toHaveAttribute("aria-pressed", "true")
    expect(blueCard).toHaveAttribute("aria-pressed", "false")
  })

  it("switches Settings sections, renders Account & Usage, and updates preferences & daemon diagnostics", async () => {
    renderSettingsView()

    // 1. Account & Usage section (default)
    const accountPanel = await screen.findByTestId("settings-panel-account")
    expect(
      within(accountPanel).getByRole("heading", { name: "Khai Ly" })
    ).toBeInTheDocument()
    expect(
      within(accountPanel).getByText(/94\.2% KV savings/)
    ).toBeInTheDocument()
    expect(
      within(accountPanel).getByText("5-hour session window")
    ).toBeInTheDocument()
    expect(
      within(accountPanel).getByText("Weekly pacing budget")
    ).toBeInTheDocument()
    expect(
      within(accountPanel).getByText("Monthly plan allowance")
    ).toBeInTheDocument()

    // Toggle "Use all available credits"
    const useAllSwitch = screen.getByTestId("use-all-credits-switch")
    expect(useAllSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(useAllSwitch)
    await waitFor(() => {
      expect(ipcClient.settings.setUseAllCredits).toHaveBeenCalledWith(true)
    })
    await waitFor(() => {
      expect(screen.getByTestId("use-all-credits-switch")).toHaveAttribute(
        "aria-checked",
        "true"
      )
    })

    // 2. Appearance section
    fireEvent.click(screen.getByTestId("settings-nav-appearance"))
    expect(screen.getByTestId("appearance-panel")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("theme-card-light"))
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
    fireEvent.click(screen.getByTestId("accent-card-blue"))
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue")

    // 3. Models & Inference section
    fireEvent.click(screen.getByTestId("settings-nav-models"))
    expect(screen.getByTestId("settings-panel-models")).toBeInTheDocument()

    // Toggle Auto-compact context
    const autoCompactSwitch = screen.getByTestId("auto-compact-switch")
    expect(autoCompactSwitch).toHaveAttribute("aria-checked", "true")
    fireEvent.click(autoCompactSwitch)
    await waitFor(() => {
      expect(ipcClient.settings.updatePreferences).toHaveBeenCalledWith({
        autoCompactContext: false,
      })
    })

    // Toggle Desktop notifications
    const notifSwitch = screen.getByTestId("notifications-switch")
    expect(notifSwitch).toHaveAttribute("aria-checked", "true")
    fireEvent.click(notifSwitch)
    await waitFor(() => {
      expect(ipcClient.settings.updatePreferences).toHaveBeenCalledWith({
        notificationsEnabled: false,
      })
    })

    // Update Default permission mode via Select
    const permSelect = screen.getByTestId("permission-mode-select")
    fireEvent.click(permSelect)
    const autoEditOption = await screen.findByRole("option", {
      name: "Auto-edit",
    })
    fireEvent.click(autoEditOption)
    await waitFor(() => {
      expect(ipcClient.settings.updatePreferences).toHaveBeenCalledWith({
        defaultPermissionMode: "acceptEdits",
      })
    })

    // 4. Voice & Audio section
    fireEvent.click(screen.getByTestId("settings-nav-voice"))
    expect(screen.getByTestId("settings-panel-voice")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("voice-model-select"))
    const emberVoiceOption = await screen.findByRole("option", {
      name: "Ember · Warm",
    })
    fireEvent.click(emberVoiceOption)
    await waitFor(() => {
      expect(ipcClient.settings.updatePreferences).toHaveBeenCalledWith({
        voiceModel: "Ember · Warm",
      })
    })

    // 5. Connections & Daemon section
    fireEvent.click(screen.getByTestId("settings-nav-connections"))
    const daemonCard = screen.getByTestId("daemon-diagnostics-card")
    expect(
      within(daemonCard).getByText("~/.rayu/builds/shared-server/rayu")
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("ping-daemon-btn"))
    await waitFor(() => {
      expect(ipcClient.daemon.getStatus).toHaveBeenCalled()
    })

    // 6. Keyboard Shortcuts section
    fireEvent.click(screen.getByTestId("settings-nav-shortcuts"))
    const shortcutsPanel = screen.getByTestId("settings-panel-shortcuts")
    expect(
      within(shortcutsPanel).getByText("Toggle sidebar")
    ).toBeInTheDocument()
    expect(
      within(shortcutsPanel).getByText("Cycle permission mode")
    ).toBeInTheDocument()
    expect(
      within(shortcutsPanel).getByText("Command palette")
    ).toBeInTheDocument()
    expect(
      within(shortcutsPanel).getByText("Send prompt")
    ).toBeInTheDocument()

    // 7. Back to workspace navigates to "home"
    fireEvent.click(screen.getByTestId("settings-back-btn"))
    expect(useAppStore.getState().activeRoute).toBe("home")
  })
})
