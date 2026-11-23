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
import { ipcClient, type TelegramState } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { TelegramView } from "../index"

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

function createInitialMockTelegramState(): TelegramState {
  return {
    mode: "connected",
    connectedBotHandle: "@RayuCodeBot",
    chatId: "842910443",
    drivingSession: "a41f · rayucode-v2",
    mediaDelivery: "Text notice",
    authPath: "~/.rayu/rayu-auth.json",
    pairingCommand: "/start rayu_9k4m2p",
    pairingLink: "https://t.me/RayuCodeBot?start=rayu_9k4m2p",
    remoteUninstallEnabled: false,
    approvals: [
      {
        id: "appr_1",
        toolBadge: "Bash",
        commandOrSummary: "cargo test -p rayu-gateway retry_budget",
        requestedBy: "worker-1 (e7b3)",
        timeAgo: "12s ago",
        status: "pending",
      },
      {
        id: "appr_2",
        toolBadge: "ExitPlanMode",
        commandOrSummary:
          "Delete legacy src/session/cache.rs after ShardStore migration",
        requestedBy: "coordinator (a41f)",
        timeAgo: "2m ago",
        status: "pending",
      },
    ],
    commands: [
      {
        command: "/sessions",
        description: "Pick which local RayuCode session to drive",
      },
      {
        command: "/model",
        description: "Switch model route in Rayu-first gateway order",
      },
      {
        command: "/provider",
        description: "Switch configured provider on the host",
      },
      {
        command: "/interrupt",
        description: "Soft-cancel the active Telegram turn",
      },
      {
        command: "/connect",
        description: "Prompt host login when auth is missing",
      },
      {
        command: "/stop",
        description: "Disconnect the Telegram remote link",
      },
    ],
  }
}

function activateTab(element: HTMLElement) {
  fireEvent.mouseDown(element, { button: 0, ctrlKey: false })
  fireEvent.click(element)
}

function renderTelegramView() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <TelegramView />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("TelegramView", () => {
  let stateRef: TelegramState

  beforeEach(() => {
    stateRef = createInitialMockTelegramState()
    useAppStore.getState().setActiveRoute("telegram")

    vi.spyOn(ipcClient.telegram, "getState").mockImplementation(async () =>
      structuredClone(stateRef)
    )

    vi.spyOn(ipcClient.telegram, "setMode").mockImplementation(async (mode) => {
      stateRef = { ...stateRef, mode }
      return structuredClone(stateRef)
    })

    vi.spyOn(ipcClient.telegram, "resolveApproval").mockImplementation(
      async (approvalId, decision) => {
        stateRef = {
          ...stateRef,
          approvals: stateRef.approvals.map((a) =>
            a.id === approvalId ? { ...a, status: decision } : a
          ),
        }
        return structuredClone(stateRef)
      }
    )

    vi.spyOn(ipcClient.telegram, "setRemoteUninstall").mockImplementation(
      async (enabled) => {
        stateRef = { ...stateRef, remoteUninstallEnabled: enabled }
        return structuredClone(stateRef)
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("switches between Connected, Rayu Shared Bot QR, and @BotFather Token modes", async () => {
    renderTelegramView()

    await screen.findByTestId("telegram-view")

    // Initially renders Connected mode details
    const connectedPanel = screen.getByTestId("tg-panel-connected")
    expect(connectedPanel).toHaveTextContent("Telegram is connected")
    expect(connectedPanel).toHaveTextContent("@RayuCodeBot")
    expect(connectedPanel).toHaveTextContent("842910443")
    expect(connectedPanel).toHaveTextContent("~/.rayu/rayu-auth.json")

    // Switch to Rayu Shared Bot QR (hosted) mode
    activateTab(screen.getByTestId("tg-mode-hosted"))

    await waitFor(() => {
      expect(ipcClient.telegram.setMode).toHaveBeenCalledWith("hosted")
    })
    const hostedPanel = await screen.findByTestId("tg-panel-hosted")
    expect(within(hostedPanel).getByTestId("tg-qr-matrix")).toBeInTheDocument()
    expect(
      within(hostedPanel).getByTestId("tg-pairing-command-input")
    ).toHaveValue("/start rayu_9k4m2p")
    expect(
      within(hostedPanel).getByTestId("tg-pairing-link")
    ).toHaveTextContent("https://t.me/RayuCodeBot?start=rayu_9k4m2p")

    // Regenerating QR produces a fresh pairing command and deep link
    fireEvent.click(within(hostedPanel).getByTestId("tg-regenerate-qr-btn"))
    await waitFor(() => {
      expect(
        (
          within(hostedPanel).getByTestId(
            "tg-pairing-command-input"
          ) as HTMLInputElement
        ).value
      ).toMatch(/^\/pair rayu_/)
    })

    // Switch to @BotFather Token (byo) mode
    activateTab(screen.getByTestId("tg-mode-byo"))

    await waitFor(() => {
      expect(ipcClient.telegram.setMode).toHaveBeenCalledWith("byo")
    })
    expect(await screen.findByTestId("tg-panel-byo")).toBeInTheDocument()
    expect(screen.getByTestId("tg-byo-token-input")).toBeInTheDocument()
    expect(screen.getByTestId("tg-byo-chat-id-input")).toBeInTheDocument()
  })

  it("validates @BotFather token and allowed chat ID with Zod before connecting", async () => {
    const connectSpy = vi.fn(
      async (input: { botToken: string; allowedChatId: string }) => {
        stateRef = {
          ...stateRef,
          mode: "connected",
          connectedBotHandle: "@my_custom_rayu_bot",
          chatId: input.allowedChatId,
          mediaDelivery: "Inline images & MP4",
        }
        return structuredClone(stateRef)
      }
    )

    Object.assign(ipcClient.telegram, { connectBotToken: connectSpy })

    try {
      renderTelegramView()
      await screen.findByTestId("telegram-view")

      activateTab(screen.getByTestId("tg-mode-byo"))
      await screen.findByTestId("tg-panel-byo")

      // Invalid token & missing chat ID trigger Zod errors without calling IPC
      fireEvent.change(screen.getByTestId("tg-byo-token-input"), {
        target: { value: "invalid-token" },
      })
      fireEvent.click(screen.getByTestId("tg-byo-submit-btn"))

      expect(screen.getByTestId("tg-byo-token-error")).toHaveTextContent(
        "Enter a valid @BotFather token"
      )
      expect(screen.getByTestId("tg-byo-chat-id-error")).toHaveTextContent(
        "Enter an allowed Telegram chat ID"
      )
      expect(connectSpy).not.toHaveBeenCalled()

      // Non-numeric chat ID fails Zod check
      fireEvent.change(screen.getByTestId("tg-byo-token-input"), {
        target: { value: "123456789:AAF_ValidTelegramBotToken1234567" },
      })
      fireEvent.change(screen.getByTestId("tg-byo-chat-id-input"), {
        target: { value: "not-a-number" },
      })
      fireEvent.click(screen.getByTestId("tg-byo-submit-btn"))

      expect(
        screen.queryByTestId("tg-byo-token-error")
      ).not.toBeInTheDocument()
      expect(screen.getByTestId("tg-byo-chat-id-error")).toHaveTextContent(
        "Allowed chat ID must be a numeric Telegram ID"
      )
      expect(connectSpy).not.toHaveBeenCalled()

      // Valid submission connects via connectBotToken and switches to Connected mode
      fireEvent.change(screen.getByTestId("tg-byo-chat-id-input"), {
        target: { value: "718492031" },
      })
      fireEvent.click(screen.getByTestId("tg-byo-submit-btn"))

      await waitFor(() => {
        expect(connectSpy).toHaveBeenCalledWith({
          botToken: "123456789:AAF_ValidTelegramBotToken1234567",
          allowedChatId: "718492031",
        })
      })

      const connectedPanel = await screen.findByTestId("tg-panel-connected")
      expect(connectedPanel).toHaveTextContent("@my_custom_rayu_bot")
      expect(connectedPanel).toHaveTextContent("718492031")
      expect(connectedPanel).toHaveTextContent("Inline images & MP4")
    } finally {
      delete (ipcClient.telegram as Record<string, unknown>).connectBotToken
    }
  })

  it("updates Pending Approvals immediately when Approve or Deny is clicked", async () => {
    renderTelegramView()

    await screen.findByTestId("tg-approvals-list")
    expect(screen.getByTestId("tg-pending-count-badge")).toHaveTextContent(
      "2 pending"
    )

    // Approve first request
    fireEvent.click(screen.getByTestId("tg-approval-approve-appr_1"))

    await waitFor(() => {
      expect(ipcClient.telegram.resolveApproval).toHaveBeenCalledWith(
        "appr_1",
        "approved"
      )
    })
    expect(screen.getByTestId("tg-approval-status-appr_1")).toHaveTextContent(
      "Approved via host"
    )
    expect(screen.getByTestId("tg-pending-count-badge")).toHaveTextContent(
      "1 pending"
    )

    // Deny second request
    fireEvent.click(screen.getByTestId("tg-approval-deny-appr_2"))

    await waitFor(() => {
      expect(ipcClient.telegram.resolveApproval).toHaveBeenCalledWith(
        "appr_2",
        "denied"
      )
    })
    expect(screen.getByTestId("tg-approval-status-appr_2")).toHaveTextContent(
      "Denied"
    )
    expect(screen.getByTestId("tg-pending-count-badge")).toHaveTextContent(
      "0 pending"
    )
  })

  it("toggles the Remote Uninstall safety switch and renders slash commands reference", async () => {
    renderTelegramView()

    await screen.findByTestId("tg-safety-row")

    const commandsGrid = screen.getByTestId("tg-commands-grid")
    for (const cmd of [
      "/sessions",
      "/status",
      "/approve",
      "/deny",
      "/swarm",
      "/diff",
      "/cancel",
      "/uninstall-remote",
    ]) {
      expect(within(commandsGrid).getByText(cmd)).toBeInTheDocument()
    }

    const uninstallSwitch = screen.getByTestId("tg-remote-uninstall-switch")
    expect(uninstallSwitch).toHaveAttribute("aria-checked", "false")
    expect(screen.getByTestId("tg-remote-uninstall-badge")).toHaveTextContent(
      "Blocked"
    )

    fireEvent.click(uninstallSwitch)

    await waitFor(() => {
      expect(ipcClient.telegram.setRemoteUninstall).toHaveBeenCalledWith(true)
    })
    await waitFor(() => {
      expect(
        screen.getByTestId("tg-remote-uninstall-switch")
      ).toHaveAttribute("aria-checked", "true")
      expect(
        screen.getByTestId("tg-remote-uninstall-badge")
      ).toHaveTextContent("Allowed")
    })
  })

  it("supports Send test ping and Disconnect / Reconnect in Connected mode", async () => {
    renderTelegramView()

    await screen.findByTestId("tg-panel-connected")

    fireEvent.click(screen.getByTestId("tg-connected-ping-btn"))
    await waitFor(() => {
      expect(screen.getByTestId("tg-panel-connected")).toHaveTextContent(
        "Sent test ping to @RayuCodeBot (Chat ID 842910443)"
      )
    })

    fireEvent.click(screen.getByTestId("tg-disconnect-btn"))
    await waitFor(() => {
      expect(
        screen.getByTestId("tg-connection-status-badge")
      ).toHaveTextContent("Disconnected")
      expect(screen.getByTestId("tg-reconnect-btn")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId("tg-reconnect-btn"))
    await waitFor(() => {
      expect(
        screen.getByTestId("tg-connection-status-badge")
      ).toHaveTextContent("Listening")
      expect(screen.getByTestId("tg-disconnect-btn")).toBeInTheDocument()
    })
  })
})
