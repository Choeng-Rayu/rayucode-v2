import * as React from "react"
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Unplug,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { TelegramSkeleton } from "@/components/ui/page-skeletons"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import {
  useConnectBotToken,
  useResolveTelegramApproval,
  useSelectTelegramSession,
  useSetRemoteUninstall,
  useSetTelegramMode,
  useStartHostedPairing,
  useTelegramBridgeActions,
  useTelegramState,
} from "../hooks/use-telegram"
import {
  connectBotTokenInputSchema,
  SUPPLEMENTAL_TELEGRAM_COMMANDS,
} from "../schemas"
import type {
  TelegramApprovalDecision,
  TelegramApprovalItem,
  TelegramCommandItem,
  TelegramConnectionMode,
} from "../types"

export interface TelegramViewProps {
  className?: string
}

function mergeCommands(
  serverCommands: TelegramCommandItem[]
): TelegramCommandItem[] {
  const seen = new Set<string>()
  const merged: TelegramCommandItem[] = []

  for (const item of serverCommands) {
    if (!seen.has(item.command)) {
      seen.add(item.command)
      merged.push(item)
    }
  }

  for (const item of SUPPLEMENTAL_TELEGRAM_COMMANDS) {
    if (!seen.has(item.command)) {
      seen.add(item.command)
      merged.push(item)
    }
  }

  return merged
}

async function copyTextWithFeedback(
  value: string,
  successMessage: string
): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    }
    toast.success(successMessage)
  } catch {
    toast.success(successMessage)
  }
}

async function openExternalTelegramUrl(url: string): Promise<void> {
  if (!url) return
  try {
    if (typeof window !== "undefined" && window.rayu?.native?.openExternal) {
      await window.rayu.native.openExternal(url)
      return
    }
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  } catch {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }
}

interface PairingQrMatrixProps {
  qrSize?: number | null
  qrPath?: string | null
  isGenerating: boolean
  isExpired: boolean
}

function PairingQrMatrix({
  qrSize,
  qrPath,
  isGenerating,
  isExpired,
}: PairingQrMatrixProps) {
  if (isGenerating) {
    return (
      <div
        aria-label="Generating Telegram pairing QR code"
        data-testid="tg-qr-loading"
        className="flex size-[184px] shrink-0 flex-col items-center justify-center gap-2 rounded-[14px] border border-premium bg-inset p-4 text-center"
      >
        <Loader2
          className="size-6 animate-spin text-brand-text"
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-body">Generating QR…</span>
      </div>
    )
  }

  if (qrPath && qrSize && !isExpired) {
    return (
      <div
        aria-label="Telegram pairing QR code"
        data-testid="tg-qr-matrix"
        className="flex size-[184px] shrink-0 items-center justify-center rounded-[14px] border border-premium bg-white p-3 shadow-bevel-surface"
      >
        <svg
          viewBox={`0 0 ${qrSize} ${qrSize}`}
          width="156"
          height="156"
          shapeRendering="crispEdges"
          role="img"
          aria-label="RayuCode Telegram pairing QR matrix"
        >
          <rect width={qrSize} height={qrSize} className="fill-white" />
          <path className="fill-black" d={qrPath} />
        </svg>
      </div>
    )
  }

  return (
    <div
      aria-label="Telegram pairing QR code placeholder"
      data-testid="tg-qr-placeholder"
      className="flex size-[184px] shrink-0 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-premium bg-inset p-4 text-center"
    >
      <QrCode className="size-8 text-muted-ink" aria-hidden="true" />
      <span className="text-xs font-medium text-body">
        {isExpired ? "Pairing code expired" : "No active QR"}
      </span>
      <span className="text-[11px] text-muted-ink">
        {isExpired
          ? "Click Regenerate QR to create a new code"
          : "Click Generate QR to start pairing"}
      </span>
    </div>
  )
}

interface ApprovalRowProps {
  item: TelegramApprovalItem
  isResolving: boolean
  onResolve: (id: string, decision: TelegramApprovalDecision) => void
}

function ApprovalRow({ item, isResolving, onResolve }: ApprovalRowProps) {
  const isBash = item.toolBadge.toLowerCase() === "bash"

  return (
    <div
      data-testid={`tg-approval-row-${item.id}`}
      className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
              isBash
                ? "border-transparent bg-warn-soft text-warn"
                : "border-hairline bg-raised text-body"
            )}
          >
            {item.toolBadge}
          </span>
          {isBash ? (
            <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-ink">
              {item.commandOrSummary}
            </code>
          ) : (
            <span className="text-ink">{item.commandOrSummary}</span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-ink">
          Requested by {item.requestedBy} ·{" "}
          <span className="tabular-nums">{item.timeAgo}</span> ·{" "}
          {item.status === "pending"
            ? "waiting on host or Telegram"
            : item.status === "approved"
              ? "resolved via desktop host"
              : "rejected via desktop host"}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {item.status === "pending" ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isResolving}
              data-testid={`tg-approval-deny-${item.id}`}
              onClick={() => onResolve(item.id, "denied")}
            >
              <X className="size-3" aria-hidden="true" />
              Deny
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isResolving}
              data-testid={`tg-approval-approve-${item.id}`}
              onClick={() => onResolve(item.id, "approved")}
            >
              <Check className="size-3" aria-hidden="true" />
              Approve
            </Button>
          </>
        ) : item.status === "approved" ? (
          <span
            data-testid={`tg-approval-status-${item.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-medium text-brand-text"
          >
            <Check className="size-3" aria-hidden="true" />
            Approved via host
          </span>
        ) : (
          <span
            data-testid={`tg-approval-status-${item.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 text-[11px] font-medium text-danger"
          >
            <X className="size-3" aria-hidden="true" />
            Denied
          </span>
        )}
      </div>
    </div>
  )
}

export function TelegramView({ className }: TelegramViewProps) {
  const { data, isPending, isError, error, refetch } = useTelegramState()
  const setModeMutation = useSetTelegramMode()
  const startHostedMutation = useStartHostedPairing()
  const connectBotMutation = useConnectBotToken()
  const resolveApprovalMutation = useResolveTelegramApproval()
  const setRemoteUninstallMutation = useSetRemoteUninstall()
  const selectSessionMutation = useSelectTelegramSession()

  const { isDisconnected, setIsDisconnected, disconnect, reconnect, ping } =
    useTelegramBridgeActions()

  const activeSessionId = useAppStore((s) => s.activeSessionId)

  const [selectedTab, setSelectedTab] =
    React.useState<TelegramConnectionMode | null>(null)
  const [hostedError, setHostedError] = React.useState<string | null>(null)
  const [botToken, setBotToken] = React.useState("")
  const [allowedChatId, setAllowedChatId] = React.useState("")
  const [showToken, setShowToken] = React.useState(false)
  const [formErrors, setFormErrors] = React.useState<{
    botToken?: string
    allowedChatId?: string
  }>({})
  const [lastPingNote, setLastPingNote] = React.useState<string | null>(null)
  const [nowSec, setNowSec] = React.useState(() =>
    Math.floor(Date.now() / 1000)
  )

  const prevLinkedRef = React.useRef<boolean | undefined>(undefined)

  React.useEffect(() => {
    const prevLinked = prevLinkedRef.current
    const currentLinked = data?.linked
    if (prevLinked === false && currentLinked === true && data) {
      setSelectedTab("connected")
      setHostedError(null)
      setIsDisconnected(false)
      toast.success(
        `Telegram connected (${data.connectedBotHandle} · Chat ID ${data.chatId})`
      )
    }
    prevLinkedRef.current = currentLinked
  }, [data, setIsDisconnected])

  React.useEffect(() => {
    if (!data?.pendingUntil || data.linked) return
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000))
    }, 15_000)
    return () => clearInterval(timer)
  }, [data?.pendingUntil, data?.linked])

  const handleModeChange = async (nextMode: string) => {
    if (
      nextMode !== "connected" &&
      nextMode !== "hosted" &&
      nextMode !== "byo"
    ) {
      return
    }
    const mode = nextMode as TelegramConnectionMode
    setSelectedTab(mode)
    setHostedError(null)
    const result = await setModeMutation.mutateAsync(mode)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    if (mode === "connected") {
      setIsDisconnected(false)
    }
  }

  const handleStartHosted = async (replaceExisting: boolean) => {
    setHostedError(null)
    setSelectedTab("hosted")
    const result = await startHostedMutation.mutateAsync(replaceExisting)
    if (!result.ok) {
      setHostedError(result.error)
      toast.error(result.error)
      return
    }
    setNowSec(Math.floor(Date.now() / 1000))
    setIsDisconnected(false)
    toast.success("Generated fresh 10-minute Telegram pairing QR")
  }

  const handleSendTestPing = async () => {
    if (!data) return
    const result = await ping()
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    const targetHandle = result.data.target ?? data.connectedBotHandle
    const targetChatId = result.data.chatId ?? data.chatId
    const message = `Sent test ping to ${targetHandle} (Chat ID ${targetChatId})`
    setLastPingNote(message)
    toast.success(message)
  }

  const handleDriveActiveSession = async () => {
    if (!activeSessionId) {
      toast.info("Open or select a session first to drive it from Telegram.")
      return
    }
    const result = await selectSessionMutation.mutateAsync(activeSessionId)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`Attached ${activeSessionId} to Telegram bridge`)
  }

  const handleDisconnect = async () => {
    if (!data) return
    setSelectedTab("connected")
    const result = await disconnect()
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setLastPingNote(null)
    toast.info(`Disconnected ${data.connectedBotHandle} from this host`)
  }

  const handleReconnect = async () => {
    if (!data) return
    const result = await reconnect()
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`Reconnected ${data.connectedBotHandle}`)
  }

  const handleByoSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = connectBotTokenInputSchema.safeParse({
      botToken,
      allowedChatId,
    })

    if (!parsed.success) {
      const nextErrors: { botToken?: string; allowedChatId?: string } = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (key === "botToken" && !nextErrors.botToken) {
          nextErrors.botToken = issue.message
        }
        if (key === "allowedChatId" && !nextErrors.allowedChatId) {
          nextErrors.allowedChatId = issue.message
        }
      }
      setFormErrors(nextErrors)
      return
    }

    setFormErrors({})
    const result = await connectBotMutation.mutateAsync(parsed.data)
    if (!result.ok) {
      if (result.fieldErrors) {
        setFormErrors({
          botToken: result.fieldErrors.botToken?.[0],
          allowedChatId: result.fieldErrors.allowedChatId?.[0],
        })
      }
      toast.error(result.error)
      return
    }

    setBotToken("")
    setAllowedChatId("")
    setIsDisconnected(false)
    setSelectedTab(result.data.linked === false ? "hosted" : "connected")
    toast.success(
      `Verified and connected ${result.data.connectedBotHandle} (Chat ID ${result.data.chatId})`
    )
  }

  const handleResolveApproval = async (
    approvalId: string,
    decision: TelegramApprovalDecision
  ) => {
    const result = await resolveApprovalMutation.mutateAsync({
      approvalId,
      decision,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(
      decision === "approved"
        ? "Tool approval sent to session"
        : "Tool request denied"
    )
  }

  const handleToggleRemoteUninstall = async (checked: boolean) => {
    const result = await setRemoteUninstallMutation.mutateAsync(checked)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.info(
      checked
        ? "Remote /uninstall-remote command enabled on this host"
        : "Remote /uninstall-remote command blocked (default safe mode)"
    )
  }

  if (isPending && !data) {
    return <TelegramSkeleton />
  }

  if (isError && !data) {
    return (
      <div className="mx-auto w-full max-w-[940px] px-6 py-10">
        <ErrorState
          title="Unable to load Telegram Remote"
          description={
            error instanceof Error
              ? error.message
              : "Failed to fetch Telegram bridge status and pending approvals."
          }
          onRetry={() => {
            void refetch()
          }}
        />
      </div>
    )
  }

  if (!data) return null

  const activeTab = selectedTab ?? data.mode
  const isDaemonOffline = data.daemonConnected === false
  const isLinked = (data.linked ?? !isDisconnected) && !isDisconnected
  const isListening = isLinked && !isDaemonOffline
  const isQrExpired = Boolean(
    !isLinked && data.pendingUntil && data.pendingUntil <= nowSec
  )
  const hasActiveQr = Boolean(data.qrPath && data.qrSize && !isQrExpired)
  const remainingMinutes = data.pendingUntil
    ? Math.max(1, Math.ceil((data.pendingUntil - nowSec) / 60))
    : 10
  const showReplaceAction = Boolean(
    hostedError &&
      /already has a Telegram link|replace-existing/i.test(hostedError)
  )

  const pendingApprovalsCount = data.approvals.filter(
    (item) => item.status === "pending"
  ).length
  const commands = mergeCommands(data.commands)

  return (
    <div
      data-testid="telegram-view"
      className={cn("h-full w-full overflow-y-auto", className)}
    >
      <div className="mx-auto w-full max-w-[940px] px-5 pt-7 pb-16 md:px-11 md:pt-10.5">
        {/* Page Header */}
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.025em] text-ink">
              Telegram Remote
            </h1>
            <p className="mt-1.5 max-w-[62ch] text-[13px] text-muted-ink">
              Drive RayuCode sessions, send prompts or images, and approve tool
              calls or plans from a private Telegram chat (
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-body">
                /telegram-bot
              </code>
              ).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={!isListening}
                  data-testid="tg-header-ping-btn"
                  onClick={() => {
                    void handleSendTestPing()
                  }}
                >
                  <Send className="size-3.5" aria-hidden="true" />
                  Send test ping
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isListening
                  ? `Send a round-trip ping to ${data.connectedBotHandle}`
                  : "Pair Telegram to send a test ping"}
              </TooltipContent>
            </Tooltip>

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!isListening || selectSessionMutation.isPending}
              data-testid="tg-drive-session-btn"
              onClick={() => {
                void handleDriveActiveSession()
              }}
            >
              Drive active session
            </Button>
          </div>
        </header>

        {isDaemonOffline ? (
          <div
            data-testid="tg-daemon-offline-banner"
            role="status"
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-premium bg-warn-soft px-4 py-3 text-xs text-warn"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {data.daemonError ??
                  "Local Rust daemon is offline. Sign in to Rayu Cloud or start the daemon to pair Telegram."}
              </span>
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                void refetch()
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {/* Section 1: Bot Connection & 3-Mode Switcher */}
        <section id="tg-connection" className="mt-7.5 border-t border-hairline pt-5.5">
          <Tabs value={activeTab} onValueChange={handleModeChange} className="gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
                Bot Connection
              </h2>

              <TabsList aria-label="Telegram connection mode">
                <TabsTrigger value="connected" data-testid="tg-mode-connected">
                  Connected
                </TabsTrigger>
                <TabsTrigger value="hosted" data-testid="tg-mode-hosted">
                  Rayu Shared Bot QR
                </TabsTrigger>
                <TabsTrigger value="byo" data-testid="tg-mode-byo">
                  @BotFather Token
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Panel A: Connected State */}
            <TabsContent value="connected" data-testid="tg-panel-connected">
              <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane">
                <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {!isListening ? (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-danger"
                          aria-hidden="true"
                        />
                      ) : (
                        <span
                          className="relative inline-flex size-1.5 shrink-0 items-center justify-center"
                          aria-hidden="true"
                        >
                          <span className="absolute -inset-[3px] animate-ping rounded-full border border-brand-bright opacity-60" />
                          <span className="size-1.5 rounded-full bg-brand-bright" />
                        </span>
                      )}
                      <span>
                        {isDaemonOffline
                          ? "Rust daemon offline"
                          : !isLinked
                            ? "Telegram bridge disconnected"
                            : "Telegram is connected"}
                      </span>
                      <span
                        data-testid="tg-connection-status-badge"
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                          !isListening
                            ? "bg-danger-soft text-danger"
                            : "bg-brand-soft text-brand-text"
                        )}
                      >
                        {isDaemonOffline
                          ? "Offline"
                          : isDisconnected
                            ? "Disconnected"
                            : !isLinked
                              ? data.statusLabel || "Not paired"
                              : "Listening"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-ink">
                      {isLinked ? (
                        <>
                          Linked through{" "}
                          <strong className="font-medium text-body">
                            {data.connectedBotHandle}
                          </strong>
                          . Verified Chat ID{" "}
                          <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body tabular-nums">
                            {data.chatId}
                          </code>
                          {lastPingNote ? (
                            <span className="ml-2 text-brand-text">
                              · {lastPingNote}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span>
                          Pair with the shared Rayu bot QR or connect your own
                          @BotFather token to drive sessions from Telegram.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={!isListening}
                      data-testid="tg-connected-ping-btn"
                      onClick={() => {
                        void handleSendTestPing()
                      }}
                    >
                      <Send className="size-3" aria-hidden="true" />
                      Send test ping
                    </Button>
                    {isDisconnected ? (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        data-testid="tg-reconnect-btn"
                        onClick={() => {
                          void handleReconnect()
                        }}
                      >
                        Reconnect
                      </Button>
                    ) : !isLinked ? (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        data-testid="tg-pair-qr-btn"
                        onClick={() => {
                          void handleModeChange("hosted")
                        }}
                      >
                        Pair via QR
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        data-testid="tg-disconnect-btn"
                        onClick={() => {
                          void handleDisconnect()
                        }}
                      >
                        <Unplug className="size-3" aria-hidden="true" />
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">Driving session</div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Incoming Telegram messages and image attachments route
                      here.
                    </div>
                  </div>
                  <span
                    data-testid="tg-driving-session"
                    className="font-mono text-xs text-body tabular-nums"
                  >
                    {data.drivingSession}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">
                      Generated media delivery
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Shared bot sends text notices; switch to a @BotFather bot
                      for inline images &amp; MP4.
                    </div>
                  </div>
                  <span className="font-mono text-xs text-body tabular-nums">
                    {data.mediaDelivery}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">Host CLI parity</div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Move an existing hosted link with{" "}
                      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                        rayu telegram link --replace-existing
                      </code>
                      .
                    </div>
                  </div>
                  <span
                    data-testid="tg-auth-path"
                    className="font-mono text-xs text-body"
                  >
                    {data.authPath}
                  </span>
                </div>
              </div>
            </TabsContent>

            {/* Panel B: Rayu Shared Bot QR */}
            <TabsContent value="hosted" data-testid="tg-panel-hosted">
              <div className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane">
                <div className="grid grid-cols-1 items-center gap-6 p-5 md:grid-cols-[184px_minmax(0,1fr)]">
                  <PairingQrMatrix
                    qrSize={data.qrSize}
                    qrPath={data.qrPath}
                    isGenerating={startHostedMutation.isPending}
                    isExpired={isQrExpired}
                  />

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      <span>Rayu shared bot — recommended</span>
                      <span
                        data-testid="tg-hosted-bot-badge"
                        className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text"
                      >
                        {data.connectedBotHandle}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-muted-ink">
                      Sign in with Rayu and scan this QR code, or open{" "}
                      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-body">
                        {data.connectedBotHandle}
                      </code>{" "}
                      in Telegram and send:
                    </p>

                    {hostedError ? (
                      <div
                        data-testid="tg-hosted-error"
                        role="alert"
                        className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-premium bg-danger-soft px-3 py-2 text-xs text-danger"
                      >
                        <span>{hostedError}</span>
                        {showReplaceAction ? (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={startHostedMutation.isPending}
                            data-testid="tg-replace-existing-btn"
                            onClick={() => {
                              void handleStartHosted(true)
                            }}
                          >
                            Move link to this host
                          </Button>
                        ) : null}
                      </div>
                    ) : null}

                    {hasActiveQr ? (
                      <>
                        <div className="my-3 flex flex-col gap-1.5">
                          <label
                            htmlFor="tg-pairing-command"
                            className="text-xs font-medium text-body"
                          >
                            One-click pairing command
                          </label>
                          <input
                            id="tg-pairing-command"
                            data-testid="tg-pairing-command-input"
                            type="text"
                            readOnly
                            value={data.pairingCommand}
                            aria-label="Pairing command"
                            className="w-full max-w-[440px] rounded-[10px] border border-premium bg-inset px-3 py-2 font-mono text-xs text-ink outline-none focus:border-brand"
                          />
                        </div>

                        {data.pairingLink ? (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-ink">
                            <span>Deep link:</span>
                            <code
                              data-testid="tg-pairing-link"
                              className="rounded bg-inset px-2 py-1 font-mono text-[11.5px] text-brand-text"
                            >
                              {data.pairingLink}
                            </code>
                          </div>
                        ) : null}

                        <div className="mt-3.5 flex flex-wrap items-center gap-2">
                          {data.pairingLink ? (
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              data-testid="tg-open-link-btn"
                              onClick={() => {
                                void openExternalTelegramUrl(data.pairingLink)
                              }}
                            >
                              <ExternalLink
                                className="size-3.5"
                                aria-hidden="true"
                              />
                              Open in Telegram
                            </Button>
                          ) : null}

                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            data-testid="tg-copy-command-btn"
                            onClick={() => {
                              void copyTextWithFeedback(
                                data.pairingCommand,
                                `Copied ${data.pairingCommand}`
                              )
                            }}
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                            Copy command
                          </Button>

                          {data.pairingLink ? (
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              data-testid="tg-copy-link-btn"
                              onClick={() => {
                                void copyTextWithFeedback(
                                  data.pairingLink,
                                  `Copied ${data.pairingLink}`
                                )
                              }}
                            >
                              Copy pairing link
                            </Button>
                          ) : null}

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={startHostedMutation.isPending}
                            data-testid="tg-regenerate-qr-btn"
                            onClick={() => {
                              void handleStartHosted(true)
                            }}
                          >
                            <RefreshCw
                              className={cn(
                                "size-3.5",
                                startHostedMutation.isPending && "animate-spin"
                              )}
                              aria-hidden="true"
                            />
                            Regenerate QR
                          </Button>
                        </div>

                        <p className="mt-2.5 text-xs text-muted-ink tabular-nums">
                          Waiting for link in Telegram… pairing code valid for{" "}
                          {remainingMinutes} minute
                          {remainingMinutes === 1 ? "" : "s"}.
                        </p>
                      </>
                    ) : (
                      <div className="mt-4 flex flex-col items-start gap-2.5">
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={
                            startHostedMutation.isPending || isDaemonOffline
                          }
                          data-testid="tg-generate-qr-btn"
                          onClick={() => {
                            void handleStartHosted(isQrExpired)
                          }}
                        >
                          <QrCode className="size-3.5" aria-hidden="true" />
                          {startHostedMutation.isPending
                            ? "Generating QR…"
                            : isQrExpired
                              ? "Regenerate QR"
                              : "Generate QR"}
                        </Button>
                        <p className="text-xs text-muted-ink">
                          Creates a single-use 10-minute pairing QR bound to
                          your signed-in Rayu account.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Panel C: Own @BotFather Token */}
            <TabsContent value="byo" data-testid="tg-panel-byo">
              <div className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane p-5">
                <div className="font-medium text-ink">
                  Connect your own @BotFather bot
                </div>
                <p className="mt-1.5 max-w-[64ch] text-[13px] text-muted-ink">
                  Create a bot via{" "}
                  <strong className="font-medium text-body">@BotFather</strong>{" "}
                  with{" "}
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-body">
                    /newbot
                  </code>
                  , paste the bot token (e.g.{" "}
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-body">
                    123456789:AAF...
                  </code>
                  ) and your allowed chat ID below. Supports inline generated
                  images and MP4 delivery.
                </p>

                <form
                  onSubmit={(event) => {
                    void handleByoSubmit(event)
                  }}
                  noValidate
                  className="mt-4 flex max-w-[460px] flex-col gap-3.5"
                >
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="tg-byo-token"
                      className="text-xs font-medium text-body"
                    >
                      Bot token (write-only)
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id="tg-byo-token"
                        data-testid="tg-byo-token-input"
                        type={showToken ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        value={botToken}
                        onChange={(event) => {
                          setBotToken(event.target.value)
                          if (formErrors.botToken) {
                            setFormErrors((prev) => ({
                              ...prev,
                              botToken: undefined,
                            }))
                          }
                        }}
                        placeholder="123456789:AAF..."
                        aria-invalid={Boolean(formErrors.botToken)}
                        className={cn(
                          "w-full rounded-[10px] border bg-inset py-2 pr-10 pl-3 font-mono text-xs text-ink outline-none placeholder:text-faint focus:border-brand",
                          formErrors.botToken
                            ? "border-danger"
                            : "border-premium"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken((prev) => !prev)}
                        aria-label={
                          showToken ? "Hide bot token" : "Show bot token"
                        }
                        className="absolute right-2 grid size-7 place-items-center rounded-md text-muted-ink hover:bg-hover hover:text-ink"
                      >
                        {showToken ? (
                          <EyeOff className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="size-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {formErrors.botToken ? (
                      <span
                        data-testid="tg-byo-token-error"
                        role="alert"
                        className="text-xs text-danger"
                      >
                        {formErrors.botToken}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-ink">
                        Checked with Telegram before saving. Never read back
                        into view state or transcript.
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="tg-byo-chat-id"
                      className="text-xs font-medium text-body"
                    >
                      Allowed Telegram chat ID
                    </label>
                    <input
                      id="tg-byo-chat-id"
                      data-testid="tg-byo-chat-id-input"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={allowedChatId}
                      onChange={(event) => {
                        setAllowedChatId(event.target.value)
                        if (formErrors.allowedChatId) {
                          setFormErrors((prev) => ({
                            ...prev,
                            allowedChatId: undefined,
                          }))
                        }
                      }}
                      placeholder="e.g. 842910443"
                      aria-invalid={Boolean(formErrors.allowedChatId)}
                      className={cn(
                        "w-full rounded-[10px] border bg-inset px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-faint focus:border-brand",
                        formErrors.allowedChatId
                          ? "border-danger"
                          : "border-premium"
                      )}
                    />
                    {formErrors.allowedChatId ? (
                      <span
                        data-testid="tg-byo-chat-id-error"
                        role="alert"
                        className="text-xs text-danger"
                      >
                        {formErrors.allowedChatId}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={connectBotMutation.isPending || isDaemonOffline}
                      data-testid="tg-byo-submit-btn"
                    >
                      {connectBotMutation.isPending
                        ? "Connecting..."
                        : "Save & Connect Bot"}
                    </Button>
                  </div>
                </form>
              </div>
            </TabsContent>
          </Tabs>
        </section>

        {/* Section 2: Live Pending Tool & Plan Approvals */}
        <section id="tg-approvals" className="mt-7.5 border-t border-hairline pt-5.5">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
                Pending Approvals
              </h2>
              <span
                data-testid="tg-pending-count-badge"
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                  pendingApprovalsCount > 0
                    ? "bg-brand-soft text-brand-text"
                    : "bg-raised text-muted-ink"
                )}
              >
                {pendingApprovalsCount} pending
              </span>
            </div>

            <span className="text-xs text-muted-ink">
              Synced with{" "}
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                rayu permissions
              </code>{" "}
              &amp; Telegram inline buttons
            </span>
          </div>

          <div
            data-testid="tg-approvals-list"
            className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {data.approvals.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No pending remote approvals.
              </div>
            ) : (
              data.approvals.map((item) => (
                <ApprovalRow
                  key={item.id}
                  item={item}
                  isResolving={resolveApprovalMutation.isPending}
                  onResolve={(id, decision) => {
                    void handleResolveApproval(id, decision)
                  }}
                />
              ))
            )}
          </div>
        </section>

        {/* Section 3: Supported Telegram Slash Commands */}
        <section id="tg-commands" className="mt-7.5 border-t border-hairline pt-5.5">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal
                className="size-4 text-muted-ink"
                aria-hidden="true"
              />
              <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
                Telegram Chat Commands
              </h2>
            </div>
            <span className="text-xs text-muted-ink">
              Send directly inside your paired Telegram chat
            </span>
          </div>

          <div
            data-testid="tg-commands-grid"
            className="grid grid-cols-1 gap-x-7 gap-y-2.5 md:grid-cols-2"
          >
            {commands.map((cmd) => (
              <div
                key={cmd.command}
                className="flex items-baseline gap-3 border-b border-hairline-soft py-1.5 text-xs"
              >
                <code className="min-w-[132px] font-mono font-semibold text-brand-text">
                  {cmd.command}
                </code>
                <span className="text-body">{cmd.description}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Section 4: Safety Guardrails & Remote Uninstall Toggle */}
        <section id="tg-safety" className="mt-7.5 border-t border-hairline pt-5.5">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Lock className="size-4 text-muted-ink" aria-hidden="true" />
              <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
                Safety Guardrails
              </h2>
            </div>
          </div>

          <div className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane">
            <div
              data-testid="tg-safety-row"
              className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <span>Remote uninstall</span>
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-body">
                    /uninstall-remote
                  </code>
                  <span
                    data-testid="tg-remote-uninstall-badge"
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      data.remoteUninstallEnabled
                        ? "bg-warn-soft text-warn"
                        : "bg-brand-soft text-brand-text"
                    )}
                  >
                    {data.remoteUninstallEnabled ? (
                      <>
                        <ShieldAlert className="size-3" aria-hidden="true" />
                        Allowed
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="size-3" aria-hidden="true" />
                        Blocked
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-ink">
                  Disabled by default. Allows or blocks remote{" "}
                  <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                    /uninstall-remote
                  </code>{" "}
                  teardown from Telegram; preserves projects and session data.
                  Enable locally via{" "}
                  <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                    rayu telegram uninstall enable
                  </code>
                  .
                </div>
              </div>

              <Switch
                checked={data.remoteUninstallEnabled}
                disabled={setRemoteUninstallMutation.isPending}
                onCheckedChange={(checked) => {
                  void handleToggleRemoteUninstall(checked)
                }}
                aria-label="Allow remote uninstall"
                data-testid="tg-remote-uninstall-switch"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
