import * as React from "react"
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Lock,
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
  useSetRemoteUninstall,
  useSetTelegramMode,
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

function PairingQrMatrix() {
  return (
    <div
      aria-label="Telegram pairing QR code"
      data-testid="tg-qr-matrix"
      className="flex size-[184px] shrink-0 items-center justify-center rounded-[14px] border border-premium bg-white p-3 shadow-bevel-surface"
    >
      <svg
        viewBox="0 0 21 21"
        width="156"
        height="156"
        shapeRendering="crispEdges"
        role="img"
        aria-label="RayuCode Telegram pairing QR matrix"
      >
        <rect width="21" height="21" className="fill-white" />
        <path
          className="fill-black"
          d="M0 0h7v7H0V0Zm1 1v5h5V1H1Zm1 1h3v3H2V2ZM14 0h7v7h-7V0Zm1 1v5h5V1h-5Zm1 1h3v3h-3V2ZM0 14h7v7H0v-7Zm1 1v5h5v-5H1Zm1 1h3v3H2v-3ZM9 1h2v2H9V1Zm3 0h1v3h-1V1ZM8 4h2v2H8V4Zm3 2h2v2h-2V6ZM1 9h3v1H1V9Zm4 0h2v2H5V9Zm3-1h2v3H8V8Zm3 1h3v2h-3V9Zm4-1h2v2h-2V8Zm3 1h3v2h-3V9ZM1 11h2v2H1v-2Zm3 1h3v1H4v-1Zm5 0h2v3H9v-3Zm3 1h2v2h-2v-2Zm3-1h2v3h-2v-3Zm3 1h3v2h-3v-2ZM9 16h2v2H9v-2Zm3-1h3v2h-3v-2Zm4 1h2v2h-2v-2Zm3 0h2v4h-2v-4ZM8 19h4v2H8v-2Zm5 0h3v2h-3v-2Zm4 0h1v2h-1v-2Z"
        />
      </svg>
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
  const connectBotMutation = useConnectBotToken()
  const resolveApprovalMutation = useResolveTelegramApproval()
  const setRemoteUninstallMutation = useSetRemoteUninstall()

  const {
    isDisconnected,
    setIsDisconnected,
    disconnect,
    reconnect,
    regeneratePairing,
    attachSession,
    ping,
  } = useTelegramBridgeActions()

  const activeSessionId = useAppStore((s) => s.activeSessionId)

  const [botToken, setBotToken] = React.useState("")
  const [allowedChatId, setAllowedChatId] = React.useState("")
  const [showToken, setShowToken] = React.useState(false)
  const [formErrors, setFormErrors] = React.useState<{
    botToken?: string
    allowedChatId?: string
  }>({})
  const [lastPingNote, setLastPingNote] = React.useState<string | null>(null)

  const handleModeChange = async (nextMode: string) => {
    if (
      nextMode !== "connected" &&
      nextMode !== "hosted" &&
      nextMode !== "byo"
    ) {
      return
    }
    const result = await setModeMutation.mutateAsync(
      nextMode as TelegramConnectionMode
    )
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    if (nextMode === "connected") {
      setIsDisconnected(false)
    }
  }

  const handleSendTestPing = async () => {
    if (!data) return
    const result = await ping()
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    const message = `Sent test ping to ${data.connectedBotHandle} (Chat ID ${data.chatId})`
    setLastPingNote(message)
    toast.success(message)
  }

  const handleDriveActiveSession = () => {
    const label = activeSessionId
      ? `${activeSessionId} · rayucode-v2`
      : "ses_retire_cache · Retire legacy session cache"
    attachSession(label)
    toast.success(`Attached ${label} to Telegram bridge`)
  }

  const handleDisconnect = async () => {
    if (!data) return
    const result = await disconnect()
    if (!result.ok) {
      toast.error(result.error)
      return
    }
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

  const handleRegenerateQr = () => {
    const code = regeneratePairing()
    toast.success(`Generated fresh 10-minute pairing code (${code})`)
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
                Send a round-trip ping to {data.connectedBotHandle}
              </TooltipContent>
            </Tooltip>

            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="tg-drive-session-btn"
              onClick={handleDriveActiveSession}
            >
              Drive active session
            </Button>
          </div>
        </header>

        {/* Section 1: Bot Connection & 3-Mode Switcher */}
        <section id="tg-connection" className="mt-7.5 border-t border-hairline pt-5.5">
          <Tabs value={data.mode} onValueChange={handleModeChange} className="gap-3.5">
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
                      {isDisconnected ? (
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
                        {isDisconnected
                          ? "Telegram bridge disconnected"
                          : "Telegram is connected"}
                      </span>
                      <span
                        data-testid="tg-connection-status-badge"
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                          isDisconnected
                            ? "bg-danger-soft text-danger"
                            : "bg-brand-soft text-brand-text"
                        )}
                      >
                        {isDisconnected ? "Disconnected" : "Listening"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-ink">
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
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={isDisconnected}
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
                  <span className="font-mono text-xs text-body tabular-nums">
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
                  <PairingQrMatrix />

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      <span>Rayu shared bot — recommended</span>
                      <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
                        @RayuCodeOfficialBot
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-muted-ink">
                      Sign in with Rayu and scan this QR code, or open{" "}
                      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-body">
                        {data.connectedBotHandle}
                      </code>{" "}
                      in Telegram and send:
                    </p>

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

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-ink">
                      <span>Deep link:</span>
                      <code
                        data-testid="tg-pairing-link"
                        className="rounded bg-inset px-2 py-1 font-mono text-[11.5px] text-brand-text"
                      >
                        {data.pairingLink}
                      </code>
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="primary"
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

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-testid="tg-regenerate-qr-btn"
                        onClick={handleRegenerateQr}
                      >
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        Regenerate QR
                      </Button>
                    </div>

                    <p className="mt-2.5 text-xs text-muted-ink">
                      Waiting for link in Telegram… pairing code valid for 10
                      minutes.
                    </p>
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
                      disabled={connectBotMutation.isPending}
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
