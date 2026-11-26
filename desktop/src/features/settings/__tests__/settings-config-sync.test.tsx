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

import { TooltipProvider } from "@/components/ui/tooltip"
import { ipcClient, type ConfigStatePayload } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { SettingsView } from "../index"

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

const MOCK_CONFIG: ConfigStatePayload = {
  path: "/Users/test/.rayu/config.toml",
  sections: ["provider", "compaction", "features", "notifications"],
  values: {
    "provider.anthropic_cache_ttl_1h": true,
    "compaction.mode": "reactive",
    "features.swarm": true,
    "notifications.turn_complete": false,
  },
  schema: [
    {
      key: "provider.anthropic_cache_ttl_1h",
      section: "provider",
      label: "1-Hour Prompt Cache TTL",
      description: "Request one-hour Anthropic prompt caching.",
      kind: "boolean",
      default_value: true,
      apply_mode: "next_turn",
    },
    {
      key: "compaction.mode",
      section: "compaction",
      label: "Compaction Mode",
      description: "Strategy used to automatically compact transcripts.",
      kind: "enum",
      options: [
        { value: "reactive", label: "Reactive" },
        { value: "proactive", label: "Proactive" },
      ],
      default_value: "reactive",
      apply_mode: "immediate",
    },
    {
      key: "features.swarm",
      section: "features",
      label: "Swarm Mode",
      description: "Enable multi-agent swarm orchestration.",
      kind: "boolean",
      default_value: true,
      apply_mode: "restart_required",
    },
    {
      key: "notifications.turn_complete",
      section: "notifications",
      label: "Turn Complete Notifications",
      description: "Notify when a long turn completes.",
      kind: "boolean",
      default_value: false,
      apply_mode: "immediate",
    },
  ],
}

function renderSettings(initialSection: "models" | "appearance" = "models") {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <SettingsView initialSection={initialSection} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("SettingsView v1.16 ~/.rayu/config.toml sync & local preference separation", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders Synced with ~/.rayu/config.toml badge, patches real config, shows Reload required banner, and reacts to config_changed", async () => {
    let harnessListener: ((frame: Record<string, unknown>) => void) | null = null
    vi.spyOn(ipcClient.harness, "onEvent").mockImplementation((cb) => {
      harnessListener = cb
      return () => {
        harnessListener = null
      }
    })
    vi.spyOn(ipcClient.harness, "getConfig").mockResolvedValue(MOCK_CONFIG)
    const patchSpy = vi
      .spyOn(ipcClient.harness, "patchConfig")
      .mockResolvedValue({
        ok: true,
        state: {
          ...MOCK_CONFIG,
          values: {
            ...MOCK_CONFIG.values,
            "features.swarm": false,
          },
        },
      })

    renderSettings("models")

    expect(
      await screen.findByTestId("settings-synced-badge")
    ).toHaveTextContent("Synced with ~/.rayu/config.toml")
    expect(
      await screen.findByTestId("reload-badge-features.swarm")
    ).toHaveTextContent("Reload required")

    const swarmSwitch = screen.getByTestId("config-field-features.swarm")
    expect(swarmSwitch).toHaveAttribute("aria-checked", "true")
    fireEvent.click(swarmSwitch)

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith({ "features.swarm": false })
    })
    expect(
      await screen.findByTestId("settings-restart-banner")
    ).toHaveTextContent("Reload the Rayu daemon to apply updated settings.")

    // Live external config_changed broadcast updates UI reactively
    act(() => {
      harnessListener?.({
        ev: "config_changed",
        changed_keys: ["notifications.turn_complete"],
        values: { "notifications.turn_complete": true },
      })
    })

    await waitFor(() => {
      expect(
        screen.getByTestId("config-field-notifications.turn_complete")
      ).toHaveAttribute("aria-checked", "true")
    })
    expect(
      screen.getByTestId("settings-external-sync-notice")
    ).toHaveTextContent("Synced update from ~/.rayu/config.toml")
  })

  it("shows inline validation error and never fakes success when patchConfig rejects", async () => {
    vi.spyOn(ipcClient.harness, "getConfig").mockResolvedValue(MOCK_CONFIG)
    vi.spyOn(ipcClient.harness, "patchConfig").mockResolvedValue({
      ok: false,
      code: "invalid_request",
      error: "Value violates schema constraint",
    })

    renderSettings("models")

    const ttlSwitch = await screen.findByTestId(
      "config-field-provider.anthropic_cache_ttl_1h"
    )
    expect(ttlSwitch).toHaveAttribute("aria-checked", "true")
    fireEvent.click(ttlSwitch)

    const inlineErr = await screen.findByTestId(
      "config-error-provider.anthropic_cache_ttl_1h"
    )
    expect(inlineErr).toHaveTextContent("Value violates schema constraint")
    // Control remains at last accepted server value
    expect(ttlSwitch).toHaveAttribute("aria-checked", "true")
  })

  it("renders graceful v1.15 read-only info banner when getConfig returns null while keeping Appearance local", async () => {
    vi.spyOn(ipcClient.harness, "getConfig").mockResolvedValue(null)

    renderSettings("models")

    expect(
      await screen.findByTestId("settings-v115-fallback-banner")
    ).toHaveTextContent("Connected to an older Rayu daemon (v1.15)")

    // Switch to Appearance -> Local to Desktop badge + MiniPet live locally
    fireEvent.click(screen.getByTestId("settings-nav-appearance"))
    expect(
      await screen.findByTestId("settings-local-badge")
    ).toHaveTextContent("Local to Desktop")
    expect(screen.getByTestId("mini-pet-switch")).toBeInTheDocument()
  })
})
