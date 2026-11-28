import type { RuntimeCommand } from "@rayu-dev/rayucode-sdk"

import type { DaemonConnectionStatus } from "./daemon-client.js"

export interface TelegramApprovalItem {
  id: string
  toolBadge: string
  commandOrSummary: string
  requestedBy: string
  timeAgo: string
  status: "pending" | "approved" | "denied"
}

export interface TelegramCommandItem {
  command: string
  description: string
}

export interface TelegramState {
  mode: "connected" | "hosted" | "byo"
  connectedBotHandle: string
  chatId: string
  drivingSession: string
  mediaDelivery: string
  authPath: string
  pairingCommand: string
  pairingLink: string
  remoteUninstallEnabled: boolean
  approvals: TelegramApprovalItem[]
  commands: TelegramCommandItem[]
  linked?: boolean
  configured?: boolean
  statusLabel?: string
  bridgeMode?: "hosted" | "botfather" | null
  daemonConnected?: boolean
  qrSize?: number | null
  qrPath?: string | null
  pendingUntil?: number | null
  daemonError?: string | null
}

export interface TelegramDaemonAdapter {
  runGlobalRuntimeCommand?(
    command: RuntimeCommand,
    args?: string[],
    workingDir?: string
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }>
  runRuntimeCommandOnAnySession(
    command: RuntimeCommand,
    args?: string[],
    workingDir?: string
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }>
  getOrProbeStatus(workingDir?: string): Promise<DaemonConnectionStatus>
  getStatus(): DaemonConnectionStatus
}

interface PendingPairingCache {
  generation: string | null
  username: string
  pairingUrl: string
  pairingCode: string
  qrSize: number | null
  qrPath: string | null
  pendingUntil: number | null
}

interface RustTelegramStatusData {
  generation?: string | null
  linked?: boolean
  configured?: boolean
  status?: string
  expired?: boolean
  active_account?: boolean
  username?: string | null
  mode?: "hosted" | "botfather" | null
  owner_chat_id?: number | string | null
  selected_session?: string | null
  pending_until?: number | null
  auth_path?: string | null
  uninstall_enabled?: boolean
}

interface RustTelegramApprovalRaw {
  id: string
  action?: string
  description?: string
  rationale?: string
  urgency?: string
  created_at?: string
}

export const TELEGRAM_CHAT_COMMANDS: readonly TelegramCommandItem[] = [
  {
    command: "/sessions",
    description: "Pick which local RayuCode session to drive",
  },
  {
    command: "/switch",
    description: "Switch directly to another local RayuCode session",
  },
  {
    command: "/status",
    description: "Inspect active session, model route, and turn state",
  },
  {
    command: "/model",
    description: "Choose a configured model for the selected session",
  },
  {
    command: "/provider",
    description: "Browse configured providers on this host",
  },
  {
    command: "/connect",
    description: "Show local host sign-in instructions for a provider",
  },
  {
    command: "/interrupt",
    description: "Cancel the currently running Telegram turn",
  },
  {
    command: "/answer",
    description: "Reply to a pending interactive question from the agent",
  },
  {
    command: "/stop",
    description: "Disconnect Telegram remote control from this host",
  },
  {
    command: "/uninstall",
    description: "Remove managed CLI (guarded by Safety toggle + code)",
  },
]

function formatRelativeTime(isoTimestamp?: string): string {
  if (!isoTimestamp) return "just now"
  const parsed = Date.parse(isoTimestamp)
  if (!Number.isFinite(parsed)) return "just now"
  const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}h ago`
}

function asBotHandle(username: string | null | undefined): string {
  const clean = (username ?? "").trim().replace(/^@+/, "")
  return clean ? `@${clean}` : "@RayuCodeBot"
}

export class RayuTelegramManager {
  private pendingPairing: PendingPairingCache | null = null

  constructor(
    private readonly daemonClient: TelegramDaemonAdapter,
    private readonly getWorkingDir: () => string
  ) {}

  private runGlobalTelegramCommand(
    args: string[],
    workingDir = this.getWorkingDir()
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }> {
    if (typeof this.daemonClient.runGlobalRuntimeCommand === "function") {
      return this.daemonClient.runGlobalRuntimeCommand(
        "telegram",
        args,
        workingDir
      )
    }
    return this.daemonClient.runRuntimeCommandOnAnySession(
      "telegram",
      args,
      workingDir
    )
  }

  async getState(): Promise<TelegramState> {
    const workingDir = this.getWorkingDir()
    try {
      const [statusRes, approvalsRes] = await Promise.all([
        this.runGlobalTelegramCommand(["status"], workingDir),
        this.runGlobalTelegramCommand(["approvals"], workingDir),
      ])

      const status = (statusRes.data ?? {}) as RustTelegramStatusData
      const approvalsPayload = (approvalsRes.data ?? {}) as {
        approvals?: RustTelegramApprovalRaw[]
      }

      const linked = Boolean(status.linked)
      const configured = Boolean(status.configured)
      const expired = Boolean(status.expired)

      if (
        linked ||
        !configured ||
        expired ||
        (this.pendingPairing?.generation &&
          status.generation &&
          this.pendingPairing.generation !== status.generation)
      ) {
        this.pendingPairing = null
      }

      const activePairing = this.pendingPairing
      const mode: TelegramState["mode"] = linked
        ? "connected"
        : status.mode === "botfather"
          ? "byo"
          : "hosted"

      const handle = asBotHandle(
        status.username ?? activePairing?.username ?? null
      )
      const chatId =
        status.owner_chat_id !== null && status.owner_chat_id !== undefined
          ? String(status.owner_chat_id)
          : "Not paired"
      const mediaDelivery =
        status.mode === "botfather"
          ? "Inline images & MP4"
          : linked
            ? "Text notice"
            : "Disabled until paired"

      const approvals: TelegramApprovalItem[] = Array.isArray(
        approvalsPayload.approvals
      )
        ? approvalsPayload.approvals.map((raw) => {
            const badge = raw.action?.trim() || "Tool"
            return {
              id: raw.id,
              toolBadge: badge,
              commandOrSummary:
                raw.description?.trim() || raw.rationale?.trim() || badge,
              requestedBy: "Telegram remote",
              timeAgo: formatRelativeTime(raw.created_at),
              status: "pending" as const,
            }
          })
        : []

      return {
        mode,
        linked,
        configured,
        statusLabel: status.status ?? (linked ? "Linked" : "Disconnected"),
        bridgeMode: status.mode ?? null,
        daemonConnected: true,
        connectedBotHandle: handle,
        chatId,
        drivingSession: status.selected_session?.trim() || "None",
        mediaDelivery,
        authPath: status.auth_path?.trim() || "~/.rayu/telegram-remote.json",
        pairingCommand: activePairing?.pairingCode
          ? `/start ${activePairing.pairingCode}`
          : "rayu telegram link",
        pairingLink: activePairing?.pairingUrl ?? "",
        qrSize: activePairing?.qrSize ?? null,
        qrPath: activePairing?.qrPath ?? null,
        pendingUntil: activePairing?.pendingUntil ?? status.pending_until ?? null,
        remoteUninstallEnabled: Boolean(status.uninstall_enabled),
        approvals,
        commands: [...TELEGRAM_CHAT_COMMANDS],
        daemonError: null,
      }
    } catch (error) {
      this.pendingPairing = null
      const message =
        error instanceof Error ? error.message : "Rust daemon is offline"
      return {
        mode: "hosted",
        linked: false,
        configured: false,
        statusLabel: "Daemon offline",
        bridgeMode: null,
        daemonConnected: false,
        connectedBotHandle: "@RayuCodeBot",
        chatId: "Not paired",
        drivingSession: "None",
        mediaDelivery: "Disabled until paired",
        authPath: "~/.rayu/telegram-remote.json",
        pairingCommand: "rayu telegram link",
        pairingLink: "",
        qrSize: null,
        qrPath: null,
        pendingUntil: null,
        remoteUninstallEnabled: false,
        approvals: [],
        commands: [...TELEGRAM_CHAT_COMMANDS],
        daemonError: message,
      }
    }
  }

  async startHosted(replaceExisting = false): Promise<TelegramState> {
    const args = replaceExisting ? ["link_hosted", "replace"] : ["link_hosted"]
    const res = await this.runGlobalTelegramCommand(args)
    const data = (res.data ?? {}) as {
      generation?: string | null
      username?: string | null
      pairing_url?: string | null
      pairing_code?: string | null
      qr_size?: number | null
      qr_path?: string | null
      pending_until?: number | null
    }
    this.pendingPairing = {
      generation: data.generation ?? null,
      username: data.username ?? "RayuCodeBot",
      pairingUrl: data.pairing_url ?? "",
      pairingCode: data.pairing_code ?? "",
      qrSize: typeof data.qr_size === "number" ? data.qr_size : null,
      qrPath: typeof data.qr_path === "string" ? data.qr_path : null,
      pendingUntil:
        typeof data.pending_until === "number" ? data.pending_until : null,
    }
    const state = await this.getState()
    return {
      ...state,
      mode: "hosted",
    }
  }

  async connectBotToken(input: {
    botToken: string
    allowedChatId?: string
    replaceExisting?: boolean
  }): Promise<TelegramState> {
    const args = ["link_botfather", input.botToken.trim()]
    if (input.allowedChatId?.trim()) {
      args.push(input.allowedChatId.trim())
    }
    if (input.replaceExisting) {
      args.push("replace")
    }
    const res = await this.runGlobalTelegramCommand(args)
    const data = (res.data ?? {}) as {
      generation?: string | null
      linked?: boolean
      username?: string | null
      pairing_url?: string | null
      pairing_code?: string | null
      qr_size?: number | null
      qr_path?: string | null
      pending_until?: number | null
    }
    if (!data.linked && data.pairing_url) {
      this.pendingPairing = {
        generation: data.generation ?? null,
        username: data.username ?? "RayuCodeBot",
        pairingUrl: data.pairing_url,
        pairingCode: data.pairing_code ?? "",
        qrSize: typeof data.qr_size === "number" ? data.qr_size : null,
        qrPath: typeof data.qr_path === "string" ? data.qr_path : null,
        pendingUntil:
          typeof data.pending_until === "number" ? data.pending_until : null,
      }
    } else {
      this.pendingPairing = null
    }
    return this.getState()
  }

  async disconnect(localOnly = false): Promise<TelegramState> {
    const args = localOnly ? ["disconnect", "local_only"] : ["disconnect"]
    await this.runGlobalTelegramCommand(args)
    this.pendingPairing = null
    return this.getState()
  }

  async resolveApproval(
    approvalId: string,
    decision: "approved" | "denied"
  ): Promise<TelegramState> {
    await this.runGlobalTelegramCommand([
      "decide",
      approvalId,
      decision === "approved" ? "allow" : "deny",
    ])
    return this.getState()
  }

  async setRemoteUninstall(enabled: boolean): Promise<TelegramState> {
    await this.runGlobalTelegramCommand([
      "uninstall",
      enabled ? "enable" : "disable",
    ])
    return this.getState()
  }

  async selectSession(sessionId: string): Promise<TelegramState> {
    await this.runGlobalTelegramCommand(["select_session", sessionId])
    return this.getState()
  }

  async sendTestPing(): Promise<{
    ok: boolean
    target?: string
    chatId?: string
  }> {
    const res = await this.runGlobalTelegramCommand(["ping"])
    const data = (res.data ?? {}) as {
      ok?: boolean
      username?: string | null
      chat_id?: number | string | null
    }
    return {
      ok: data.ok !== false,
      target: data.username ? asBotHandle(data.username) : undefined,
      chatId:
        data.chat_id !== null && data.chat_id !== undefined
          ? String(data.chat_id)
          : undefined,
    }
  }
}
