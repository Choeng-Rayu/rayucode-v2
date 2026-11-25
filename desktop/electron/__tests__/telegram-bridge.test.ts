import { describe, expect, it, vi } from "vitest"

import {
  RayuTelegramManager,
  type TelegramDaemonAdapter,
} from "../telegram-bridge"

function createMockAdapter(
  handler: (
    command: string,
    args?: string[]
  ) => Promise<{ command: "telegram"; data: unknown; message: string }>
): TelegramDaemonAdapter {
  return {
    runRuntimeCommandOnAnySession: vi.fn((command, args) =>
      handler(command, args)
    ),
    getOrProbeStatus: vi.fn().mockResolvedValue({
      connected: true,
      reconnecting: false,
      socketPath: "/tmp/rayu.sock",
      version: "rayu-test",
      latencyMs: 5,
      mode: "live",
    }),
    getStatus: vi.fn().mockReturnValue({
      connected: true,
      reconnecting: false,
      socketPath: "/tmp/rayu.sock",
      version: "rayu-test",
      latencyMs: 5,
      mode: "live",
    }),
  }
}

describe("RayuTelegramManager", () => {
  it("maps live status and approvals when linked", async () => {
    const adapter = createMockAdapter(async (_cmd, args) => {
      const sub = args?.[0]
      if (sub === "status") {
        return {
          command: "telegram",
          message: "Linked",
          data: {
            generation: "gen-1",
            linked: true,
            configured: true,
            status: "Linked",
            expired: false,
            active_account: true,
            username: "RayuCodeOfficialBot",
            mode: "hosted",
            owner_chat_id: 842910443,
            selected_session: "ses_123",
            pending_until: null,
            auth_path: "~/.rayu/telegram-remote.json",
            uninstall_enabled: false,
          },
        }
      }
      return {
        command: "telegram",
        message: "1 pending",
        data: {
          approvals: [
            {
              id: "telegram-1",
              action: "bash",
              description: "cargo test -p rayucode-app-core",
              rationale: "Run tests",
              urgency: "high",
              created_at: new Date().toISOString(),
            },
          ],
          count: 1,
        },
      }
    })

    const manager = new RayuTelegramManager(adapter, () => "/tmp/repo")
    const state = await manager.getState()

    expect(state.mode).toBe("connected")
    expect(state.linked).toBe(true)
    expect(state.daemonConnected).toBe(true)
    expect(state.connectedBotHandle).toBe("@RayuCodeOfficialBot")
    expect(state.chatId).toBe("842910443")
    expect(state.drivingSession).toBe("ses_123")
    expect(state.mediaDelivery).toBe("Text notice")
    expect(state.authPath).toBe("~/.rayu/telegram-remote.json")
    expect(state.approvals).toHaveLength(1)
    expect(state.approvals[0]).toMatchObject({
      id: "telegram-1",
      toolBadge: "bash",
      commandOrSummary: "cargo test -p rayucode-app-core",
      status: "pending",
    })
  })

  it("caches hosted QR data during pairing and clears it once linked", async () => {
    let linked = false
    const adapter = createMockAdapter(async (_cmd, args) => {
      const sub = args?.[0]
      if (sub === "link_hosted") {
        return {
          command: "telegram",
          message: "Pairing link generated",
          data: {
            generation: "gen-qr",
            username: "RayuCodeOfficialBot",
            status: "Waiting for pairing",
            pairing_url: "https://t.me/RayuCodeOfficialBot?start=abc123",
            pairing_code: "abc123",
            qr_size: 33,
            qr_path: "M4 4h7v1h-7z",
            pending_until: 1999999999,
          },
        }
      }
      if (sub === "status") {
        return {
          command: "telegram",
          message: linked ? "Linked" : "Waiting",
          data: {
            generation: "gen-qr",
            linked,
            configured: true,
            status: linked ? "Linked" : "Waiting for pairing",
            expired: false,
            active_account: true,
            username: "RayuCodeOfficialBot",
            mode: "hosted",
            owner_chat_id: linked ? 5551234 : null,
            selected_session: null,
            pending_until: 1999999999,
            auth_path: "~/.rayu/telegram-remote.json",
            uninstall_enabled: false,
          },
        }
      }
      return {
        command: "telegram",
        message: "None",
        data: { approvals: [], count: 0 },
      }
    })

    const manager = new RayuTelegramManager(adapter, () => "/tmp/repo")
    const pairingState = await manager.startHosted(false)

    expect(pairingState.mode).toBe("hosted")
    expect(pairingState.linked).toBe(false)
    expect(pairingState.qrSize).toBe(33)
    expect(pairingState.qrPath).toBe("M4 4h7v1h-7z")
    expect(pairingState.pairingLink).toBe(
      "https://t.me/RayuCodeOfficialBot?start=abc123"
    )
    expect(pairingState.pairingCommand).toBe("/start abc123")

    // Once Telegram finishes linking, getState() switches to connected and drops QR cache
    linked = true
    const linkedState = await manager.getState()
    expect(linkedState.mode).toBe("connected")
    expect(linkedState.linked).toBe(true)
    expect(linkedState.chatId).toBe("5551234")
    expect(linkedState.qrPath).toBeNull()
    expect(linkedState.pairingLink).toBe("")
  })

  it("forwards connectBotToken, disconnect, resolveApproval, setRemoteUninstall, selectSession, and sendTestPing without leaking token", async () => {
    let uninstallEnabled = false
    let selectedSession: string | null = null
    let isLinked = false
    const calls: Array<string[]> = []

    const adapter = createMockAdapter(async (_cmd, args) => {
      calls.push(args ?? [])
      const sub = args?.[0]
      if (sub === "link_botfather") {
        isLinked = true
        return {
          command: "telegram",
          message: "Connected",
          data: {
            generation: "gen-byo",
            linked: true,
            username: "my_custom_bot",
            owner_chat_id: 718492031,
            status: "Linked",
          },
        }
      }
      if (sub === "disconnect") {
        isLinked = false
        return {
          command: "telegram",
          message: "Disconnected",
          data: { disconnected: true, was_linked: true },
        }
      }
      if (sub === "uninstall") {
        uninstallEnabled = args?.[1] === "enable"
        return {
          command: "telegram",
          message: "Updated",
          data: { enabled: uninstallEnabled },
        }
      }
      if (sub === "select_session") {
        selectedSession = args?.[1] ?? null
        return {
          command: "telegram",
          message: "Selected",
          data: { selected_session: selectedSession },
        }
      }
      if (sub === "ping") {
        return {
          command: "telegram",
          message: "Sent ping",
          data: { ok: true, username: "my_custom_bot", chat_id: 718492031 },
        }
      }
      if (sub === "decide") {
        return {
          command: "telegram",
          message: "Approved",
          data: { id: args?.[1], approved: args?.[2] === "allow" },
        }
      }
      if (sub === "status") {
        return {
          command: "telegram",
          message: "Status",
          data: {
            generation: isLinked ? "gen-byo" : null,
            linked: isLinked,
            configured: isLinked,
            status: isLinked ? "Linked" : "Disconnected",
            expired: false,
            active_account: true,
            username: isLinked ? "my_custom_bot" : null,
            mode: isLinked ? "botfather" : null,
            owner_chat_id: isLinked ? 718492031 : null,
            selected_session: selectedSession,
            uninstall_enabled: uninstallEnabled,
          },
        }
      }
      return {
        command: "telegram",
        message: "Approvals",
        data: { approvals: [], count: 0 },
      }
    })

    const manager = new RayuTelegramManager(adapter, () => "/tmp/repo")
    const token = "123456789:AAF_SecretBotTokenValue1234567"

    const connected = await manager.connectBotToken({
      botToken: token,
      allowedChatId: "718492031",
    })
    expect(connected.linked).toBe(true)
    expect(connected.mediaDelivery).toBe("Inline images & MP4")
    expect(JSON.stringify(connected)).not.toContain(token)

    await manager.selectSession("ses_active_99")
    expect(calls).toContainEqual(["select_session", "ses_active_99"])

    await manager.resolveApproval("telegram-1", "approved")
    expect(calls).toContainEqual(["decide", "telegram-1", "allow"])

    await manager.setRemoteUninstall(true)
    expect(calls).toContainEqual(["uninstall", "enable"])

    const ping = await manager.sendTestPing()
    expect(ping).toEqual({
      ok: true,
      target: "@my_custom_bot",
      chatId: "718492031",
    })

    const afterDisconnect = await manager.disconnect(false)
    expect(afterDisconnect.linked).toBe(false)
  })

  it("returns graceful daemonConnected: false state when daemon is offline", async () => {
    const adapter = createMockAdapter(async () => {
      throw new Error("Start the local Rust daemon first")
    })
    const manager = new RayuTelegramManager(adapter, () => "/tmp/repo")
    const state = await manager.getState()

    expect(state.daemonConnected).toBe(false)
    expect(state.linked).toBe(false)
    expect(state.statusLabel).toBe("Daemon offline")
    expect(state.daemonError).toContain("Start the local Rust daemon")
    expect(state.qrPath).toBeNull()
  })
})
