import * as React from "react";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  QrCode,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Unplug,
} from "lucide-react";
import type {
  SessionSummaryView,
  TelegramStatusView,
} from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RunStatusPulse } from "@/components/ui/rayu-symbols";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  TELEGRAM_COMMANDS,
  type TelegramSetupMode,
} from "../hooks/useRemote";
import { ApprovalRow } from "./ApprovalRow";
import { PairingQrMatrix } from "./PairingQrMatrix";

export interface TelegramTabProps {
  telegram: TelegramStatusView;
  sessions: ReadonlyArray<SessionSummaryView>;
  activeSessionId: string;
  setupMode: TelegramSetupMode;
  onSetupModeChange: (mode: TelegramSetupMode) => void;
  onLinkHosted: (replaceExisting?: boolean) => Promise<unknown>;
  isLinkingHosted: boolean;
  hostedError?: string | null;
  onLinkBotfather: (input: {
    botToken: string;
    allowedChatId?: string;
    replaceExisting?: boolean;
  }) => Promise<unknown>;
  isLinkingBotfather: boolean;
  botfatherError?: string | null;
  onDisconnect: (localOnly?: boolean) => Promise<unknown>;
  isDisconnecting: boolean;
  onSendTestPing: () => Promise<unknown>;
  isPinging: boolean;
  onDriveActiveSession: (sessionId?: string) => Promise<unknown>;
  isDrivingSession?: boolean;
  onDecideApproval: (id: string, decision: "allow" | "deny") => Promise<unknown>;
  isDecidingApproval: boolean;
  onSetRemoteUninstall: (enabled: boolean) => Promise<unknown>;
  isTogglingUninstall: boolean;
  onCopy: (text: string, label: string) => void;
  onOpenExternal: (url: string) => void;
}

const BOT_TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;
const CHAT_ID_PATTERN = /^\d{5,20}$/;

export function TelegramTab({
  telegram,
  sessions,
  activeSessionId,
  setupMode,
  onSetupModeChange,
  onLinkHosted,
  isLinkingHosted,
  hostedError,
  onLinkBotfather,
  isLinkingBotfather,
  botfatherError,
  onDisconnect,
  isDisconnecting,
  onSendTestPing,
  isPinging,
  onDriveActiveSession,
  isDrivingSession = false,
  onDecideApproval,
  isDecidingApproval,
  onSetRemoteUninstall,
  isTogglingUninstall,
  onCopy,
  onOpenExternal,
}: TelegramTabProps) {
  const [botToken, setBotToken] = React.useState("");
  const [allowedChatId, setAllowedChatId] = React.useState("");
  const [replaceExistingByo, setReplaceExistingByo] = React.useState(false);
  const [showToken, setShowToken] = React.useState(false);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [chatIdError, setChatIdError] = React.useState<string | null>(null);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = React.useState(false);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!telegram.pairingExpiresAtMs || telegram.linked) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [telegram.linked, telegram.pairingExpiresAtMs]);

  const pendingApprovals = telegram.approvals.filter(
    (item) => item.status === "pending",
  );
  const isDaemonOffline = !telegram.daemonOnline;
  const isLinked = telegram.linked && telegram.daemonOnline;
  const botHandle = telegram.botHandle
    ? `@${telegram.botHandle.replace(/^@+/, "")}`
    : null;
  const pairingUrl = telegram.pairingUrl ?? "";
  const pairingCode = telegram.pairingCode ?? "";
  const pairingCommand = pairingCode
    ? `/start ${pairingCode}`
    : pairingUrl.includes("?start=")
      ? `/start ${pairingUrl.split("?start=")[1]}`
      : "";
  const isQrExpired = Boolean(
    telegram.expired ||
      (telegram.pairingExpiresAtMs && telegram.pairingExpiresAtMs <= nowMs),
  );
  const hasActiveQr = Boolean(
    !telegram.linked && !isQrExpired && (telegram.qrPath || pairingUrl),
  );
  const remainingMinutes = telegram.pairingExpiresAtMs
    ? Math.max(1, Math.ceil((telegram.pairingExpiresAtMs - nowMs) / 60_000))
    : 10;
  const authPath = telegram.authPath ?? "~/.rayu/telegram-remote.json";
  const showHostedReplaceAction = Boolean(
    hostedError &&
      /already has a Telegram link|replace-existing|disconnect before pairing/i.test(
        hostedError,
      ),
  );
  const showByoReplaceAction = Boolean(
    botfatherError &&
      /already configured|disconnect|replace/i.test(botfatherError),
  );

  const handleBotfatherSubmit = async (
    event?: React.FormEvent<HTMLFormElement>,
    forceReplace?: boolean,
  ) => {
    event?.preventDefault();
    const trimmedToken = botToken.trim();
    const trimmedChatId = allowedChatId.trim();
    if (!trimmedToken || !BOT_TOKEN_PATTERN.test(trimmedToken)) {
      setTokenError(
        "Enter a valid @BotFather token (format: 123456789:AAF...).",
      );
      return;
    }
    if (trimmedChatId && !CHAT_ID_PATTERN.test(trimmedChatId)) {
      setTokenError(null);
      setChatIdError(
        "Allowed chat ID must be a positive numeric Telegram ID (or leave blank to pair via QR).",
      );
      return;
    }
    setTokenError(null);
    setChatIdError(null);
    const shouldReplace = Boolean(
      forceReplace ?? (replaceExistingByo || Boolean(telegram.configured)),
    );
    try {
      await onLinkBotfather({
        botToken: trimmedToken,
        ...(trimmedChatId ? { allowedChatId: trimmedChatId } : {}),
        ...(shouldReplace ? { replaceExisting: true } : {}),
      });
      setBotToken("");
      setAllowedChatId("");
    } catch {
      // Error surfaced via feedback banner & botfatherError
    }
  };

  const handleUninstallSwitchChange = (nextChecked: boolean) => {
    if (nextChecked) {
      setUninstallConfirmOpen(true);
    } else {
      void onSetRemoteUninstall(false);
    }
  };

  return (
    <div data-testid="telegram-tab" className="flex flex-col gap-6">
      {isDaemonOffline && (
        <div
          data-testid="tg-daemon-offline-banner"
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-premium bg-warn-soft px-4 py-3 text-xs text-warn"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Local Rust daemon is offline</div>
            <div className="mt-0.5 text-body">
              {telegram.daemonError ??
                "Start or reconnect the shared Rayu daemon to pair Telegram and approve remote tool requests."}
            </div>
          </div>
        </div>
      )}

      {/* Bridge Status Banner */}
      <div
        data-testid="tg-status-banner"
        className="rayu-card-bevel flex flex-wrap items-center justify-between gap-3 rounded-xl border border-premium bg-pane px-4 py-3.5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <RunStatusPulse
            status={
              isLinked
                ? "running"
                : hasActiveQr || isDaemonOffline
                  ? "warn"
                  : "idle"
            }
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink">
              <span>
                {isDaemonOffline
                  ? "Rust daemon offline"
                  : isLinked
                    ? `Connected via ${botHandle ?? "Telegram"}`
                    : hasActiveQr
                      ? `Waiting for pairing (${botHandle ?? "Telegram"})`
                      : "Telegram Remote Disconnected"}
              </span>
              <span
                data-testid="tg-status-pill"
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                  isLinked
                    ? "bg-brand-soft text-brand-text"
                    : hasActiveQr
                      ? "bg-warn-soft text-warn"
                      : "bg-danger-soft text-danger",
                )}
              >
                {isDaemonOffline
                  ? "Offline"
                  : isLinked
                    ? "Connected"
                    : telegram.statusLabel || "Disconnected"}
              </span>
              {telegram.mode && (
                <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink">
                  {telegram.mode === "botfather" ? "BotFather" : "Hosted"}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-ink">
              {isLinked ? (
                <>
                  Chat ID{" "}
                  <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body tabular-nums">
                    {telegram.chatId ?? "Pending"}
                  </code>{" "}
                  · Driving{" "}
                  <code
                    data-testid="tg-bound-session-id"
                    className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body"
                  >
                    {telegram.boundSessionId ?? "None (pick below or /sessions)"}
                  </code>
                </>
              ) : (
                <span>
                  Pair with the shared Rayu bot QR or connect your own
                  @BotFather token to drive local sessions from Telegram.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!isLinked || isPinging}
            onClick={() => void onSendTestPing()}
            data-testid="tg-test-ping-btn"
          >
            <Send className="size-3.5" aria-hidden="true" />
            <span>{isPinging ? "Pinging..." : "Send Test Ping"}</span>
          </Button>
          {isLinked ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDisconnecting}
              onClick={() => void onDisconnect(false)}
              data-testid="tg-disconnect-btn"
            >
              <Unplug className="size-3.5" aria-hidden="true" />
              <span>{isDisconnecting ? "Disconnecting..." : "Disconnect"}</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isDaemonOffline}
              onClick={() => onSetupModeChange("hosted")}
              data-testid="tg-start-pairing-btn"
            >
              <QrCode className="size-3.5" aria-hidden="true" />
              <span>Pair via QR</span>
            </Button>
          )}
        </div>
      </div>

      {/* 3-Mode Setup Switcher */}
      <Tabs
        value={setupMode}
        onValueChange={(v) => onSetupModeChange(v as TelegramSetupMode)}
        className="gap-4"
      >
        <div className="max-w-full overflow-x-auto pb-0.5">
          <TabsList
            className="w-fit min-w-max"
            aria-label="Telegram connection setup mode"
          >
            <TabsTrigger
              value="connected"
              onClick={() => onSetupModeChange("connected")}
              data-testid="tg-mode-connected"
            >
              Connected
            </TabsTrigger>
            <TabsTrigger
              value="hosted"
              onClick={() => onSetupModeChange("hosted")}
              data-testid="tg-mode-hosted"
            >
              Hosted QR Pairing
            </TabsTrigger>
            <TabsTrigger
              value="botfather"
              onClick={() => onSetupModeChange("botfather")}
              data-testid="tg-mode-botfather"
            >
              @BotFather Token
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Mode 1: Connected State */}
        <TabsContent value="connected" data-testid="tg-panel-connected">
          <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">Driving session</div>
                <div className="mt-0.5 text-muted-ink">
                  Incoming Telegram prompts, inline images, and approval cards
                  route to this local Rayu session.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {sessions.length > 0 && isLinked && (
                  <Select
                    value={
                      sessions.some((s) => s.sessionId === telegram.boundSessionId)
                        ? telegram.boundSessionId
                        : undefined
                    }
                    disabled={isDrivingSession}
                    onValueChange={(nextId) => void onDriveActiveSession(nextId)}
                  >
                    <SelectTrigger
                      aria-label="Choose Telegram driving session"
                      data-testid="tg-session-picker"
                      className="h-7 w-full max-w-full text-xs @min-[480px]/remote:w-[210px]"
                    >
                      <SelectValue placeholder="Choose a session..." />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {sessions.map((sess) => (
                        <SelectItem key={sess.sessionId} value={sess.sessionId}>
                          {sess.title || sess.sessionId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {activeSessionId && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={!isLinked || isDrivingSession}
                    onClick={() => void onDriveActiveSession(activeSessionId)}
                    data-testid="tg-drive-active-session-btn"
                  >
                    Drive active session
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">
                  Generated media delivery
                </div>
                <div className="mt-0.5 text-muted-ink">
                  Hosted bot delivers text notifications; switch to a @BotFather
                  token for inline PNG &amp; MP4 uploads.
                </div>
              </div>
              <span className="font-mono text-body">
                {telegram.mode === "botfather"
                  ? "Inline images & MP4"
                  : isLinked
                    ? "Text notice"
                    : "Disabled until paired"}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">
                  Bridge configuration path
                </div>
                <div className="mt-0.5 text-muted-ink">
                  Shared with RayuCode CLI &amp; Desktop (chmod 0600). Use
                  local-only disconnect if the hosted account is unavailable.
                </div>
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-2">
                <code
                  data-testid="tg-auth-path"
                  className="max-w-full break-all rounded bg-inset px-2 py-0.5 font-mono text-[11px] text-body"
                >
                  {authPath}
                </code>
                {telegram.configured && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isDisconnecting}
                    onClick={() => void onDisconnect(true)}
                    data-testid="tg-disconnect-local-btn"
                  >
                    Clear local link
                  </Button>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Mode 2: Hosted QR Pairing */}
        <TabsContent value="hosted" data-testid="tg-panel-hosted">
          <div className="rayu-card-bevel grid grid-cols-1 items-center gap-6 rounded-xl border border-premium bg-pane p-5 @min-[600px]/remote:grid-cols-[184px_minmax(0,1fr)]">
            <PairingQrMatrix
              qrSize={telegram.qrSize}
              qrPath={telegram.qrPath}
              value={hasActiveQr ? pairingUrl : undefined}
              isGenerating={isLinkingHosted}
              isExpired={isQrExpired}
              label="Hosted Telegram bot pairing QR"
              testId="tg-qr-matrix"
            />

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                <span>Rayu shared bot — recommended</span>
                {botHandle && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[11px] text-brand-text">
                    {botHandle}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-ink">
                Requires an active Rayu Cloud sign-in on this host. Generates a
                single-use 10-minute pairing QR &amp; Start link and polls the
                Rust daemon automatically until linked.
              </p>

              {hostedError && (
                <div
                  data-testid="tg-hosted-error"
                  role="alert"
                  className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-premium bg-danger-soft px-3 py-2 text-xs text-danger"
                >
                  <span>{hostedError}</span>
                  {showHostedReplaceAction && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={isLinkingHosted}
                      data-testid="tg-replace-existing-btn"
                      onClick={() => void onLinkHosted(true)}
                    >
                      Move link to this host
                    </Button>
                  )}
                </div>
              )}

              {hasActiveQr ? (
                <>
                  {pairingCommand && (
                    <div className="mt-3 flex flex-col gap-1.5">
                      <label
                        htmlFor="tg-pairing-code"
                        className="text-[11px] font-medium text-body"
                      >
                        One-click pairing command
                      </label>
                      <input
                        id="tg-pairing-code"
                        data-testid="tg-pairing-code"
                        type="text"
                        readOnly
                        value={pairingCommand}
                        className="w-full max-w-[380px] rounded-lg border border-premium bg-inset px-3 py-1.5 font-mono text-xs text-ink"
                      />
                    </div>
                  )}

                  {pairingUrl && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-ink">
                      <span>Deep link:</span>
                      <code
                        data-testid="tg-pairing-url"
                        className="rounded bg-inset px-2 py-0.5 font-mono text-[11px] break-all text-brand-text"
                      >
                        {pairingUrl}
                      </code>
                    </div>
                  )}

                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {pairingUrl && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        data-testid="tg-open-link-btn"
                        onClick={() => onOpenExternal(pairingUrl)}
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        <span>Open in Telegram</span>
                      </Button>
                    )}
                    {pairingCommand && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => onCopy(pairingCommand, "pairing command")}
                        data-testid="tg-copy-command-btn"
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                        <span>Copy Command</span>
                      </Button>
                    )}
                    {pairingUrl && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => onCopy(pairingUrl, "deep link")}
                        data-testid="tg-copy-url-btn"
                      >
                        <span>Copy Deep Link</span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLinkingHosted || isDaemonOffline}
                      onClick={() => void onLinkHosted(true)}
                      data-testid="tg-regenerate-qr-btn"
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5",
                          isLinkingHosted && "animate-spin",
                        )}
                        aria-hidden="true"
                      />
                      <span>Regenerate QR</span>
                    </Button>
                  </div>

                  <p className="mt-2.5 text-[11px] text-muted-ink tabular-nums">
                    Waiting for confirmation in Telegram… code valid for{" "}
                    {remainingMinutes} minute
                    {remainingMinutes === 1 ? "" : "s"}.
                  </p>
                </>
              ) : (
                <div className="mt-4 flex flex-col items-start gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isLinkingHosted || isDaemonOffline}
                    onClick={() =>
                      void onLinkHosted(Boolean(isQrExpired || telegram.configured))
                    }
                    data-testid="tg-generate-qr-btn"
                  >
                    <QrCode className="size-3.5" aria-hidden="true" />
                    <span>
                      {isLinkingHosted
                        ? "Generating QR..."
                        : isQrExpired
                          ? "Regenerate QR"
                          : "Generate Hosted QR"}
                    </span>
                  </Button>
                  <p className="text-[11px] text-muted-ink">
                    Creates a live pairing code through your signed-in Rayu
                    account.
                  </p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Mode 3: Own @BotFather Token */}
        <TabsContent value="botfather" data-testid="tg-panel-botfather">
          <div className="rayu-card-bevel rounded-xl border border-premium bg-pane p-5">
            <div className="text-sm font-medium text-ink">
              Connect your own @BotFather bot
            </div>
            <p className="mt-1 max-w-[64ch] text-xs text-muted-ink">
              Create a dedicated bot via{" "}
              <strong className="text-body">@BotFather</strong> with{" "}
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                /newbot
              </code>
              . Paste the bot token below — enter your numeric chat ID to link
              immediately, or leave it blank to generate a scannable QR and{" "}
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                /start
              </code>{" "}
              deep link. Supports inline PNG &amp; MP4 media delivery.
            </p>

            {botfatherError && (
              <div
                data-testid="tg-byo-error"
                role="alert"
                className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-premium bg-danger-soft px-3 py-2 text-xs text-danger"
              >
                <span>{botfatherError}</span>
                {showByoReplaceAction && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isLinkingBotfather}
                    onClick={() => void handleBotfatherSubmit(undefined, true)}
                  >
                    Replace existing link
                  </Button>
                )}
              </div>
            )}

            {telegram.mode === "botfather" && !telegram.linked && hasActiveQr && (
              <div
                data-testid="tg-byo-pending-qr"
                className="mt-4 grid grid-cols-1 items-center gap-5 rounded-xl border border-brand/30 bg-inset p-4 @min-[600px]/remote:grid-cols-[184px_minmax(0,1fr)]"
              >
                <PairingQrMatrix
                  qrSize={telegram.qrSize}
                  qrPath={telegram.qrPath}
                  value={pairingUrl}
                  isGenerating={isLinkingBotfather}
                  isExpired={isQrExpired}
                  label="BotFather pairing QR"
                  testId="tg-byo-qr-matrix"
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink">
                    Complete pairing with {botHandle ?? "your BotFather bot"}
                  </div>
                  <p className="mt-1 text-xs text-muted-ink">
                    Scan this QR code or open Telegram and tap Start. Valid for{" "}
                    {remainingMinutes} minute
                    {remainingMinutes === 1 ? "" : "s"}.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {pairingUrl && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => onOpenExternal(pairingUrl)}
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        <span>Open in Telegram</span>
                      </Button>
                    )}
                    {pairingCommand && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => onCopy(pairingCommand, "/start command")}
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                        <span>Copy /start</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => void handleBotfatherSubmit(e)}
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
                    onChange={(e) => {
                      setBotToken(e.target.value);
                      if (tokenError) setTokenError(null);
                    }}
                    placeholder="123456789:AAF..."
                    className={cn(
                      "w-full rounded-lg border bg-inset py-2 pr-10 pl-3 font-mono text-xs text-ink outline-none focus:border-brand",
                      tokenError ? "border-danger" : "border-premium",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    aria-label={showToken ? "Hide bot token" : "Show bot token"}
                    className="absolute right-2 grid size-7 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
                  >
                    {showToken ? (
                      <EyeOff className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {tokenError ? (
                  <span
                    data-testid="tg-byo-token-error"
                    role="alert"
                    className="text-xs text-danger"
                  >
                    {tokenError}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-ink">
                    Validated live via Telegram getMe inside the Rust daemon.
                    Never echoed back into webview state or logs.
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="tg-byo-chat-id"
                  className="text-xs font-medium text-body"
                >
                  Allowed Telegram chat ID (optional)
                </label>
                <input
                  id="tg-byo-chat-id"
                  data-testid="tg-byo-chat-id-input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={allowedChatId}
                  onChange={(e) => {
                    setAllowedChatId(e.target.value);
                    if (chatIdError) setChatIdError(null);
                  }}
                  placeholder="Leave blank to pair via QR, or enter e.g. 842910443"
                  className={cn(
                    "w-full rounded-lg border bg-inset px-3 py-2 font-mono text-xs text-ink outline-none focus:border-brand",
                    chatIdError ? "border-danger" : "border-premium",
                  )}
                />
                {chatIdError && (
                  <span
                    data-testid="tg-byo-chat-id-error"
                    role="alert"
                    className="text-xs text-danger"
                  >
                    {chatIdError}
                  </span>
                )}
              </div>

              {telegram.configured && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-body">
                  <input
                    type="checkbox"
                    checked={replaceExistingByo}
                    onChange={(e) => setReplaceExistingByo(e.target.checked)}
                    className="size-3.5 accent-current"
                  />
                  <span>Replace existing Telegram link on this host</span>
                </label>
              )}

              <div>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isLinkingBotfather || isDaemonOffline}
                  data-testid="tg-byo-submit-btn"
                >
                  {isLinkingBotfather
                    ? "Verifying..."
                    : allowedChatId.trim()
                      ? "Save & Link BotFather Token"
                      : "Verify & Generate Pairing QR"}
                </Button>
              </div>
            </form>
          </div>
        </TabsContent>
      </Tabs>

      {/* Pending Approvals Queue */}
      <section className="border-t border-hairline pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-sm font-semibold text-ink">
              Pending Approvals
            </h2>
            <span
              data-testid="tg-pending-count-badge"
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                pendingApprovals.length > 0
                  ? "bg-brand-soft text-brand-text"
                  : "bg-raised text-muted-ink",
              )}
            >
              {pendingApprovals.length} pending
            </span>
          </div>
          <span className="text-xs text-muted-ink">
            Synced live with Rust daemon &amp; Telegram inline buttons
          </span>
        </div>

        <div
          data-testid="tg-approvals-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
        >
          {telegram.approvals.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-ink">
              No pending remote approvals. Tool approval cards will appear here
              automatically when a Telegram-driven turn requests permission.
            </div>
          ) : (
            telegram.approvals.map((item) => (
              <ApprovalRow
                key={item.id}
                item={item}
                isResolving={isDecidingApproval}
                onDecide={(id, decision) => void onDecideApproval(id, decision)}
              />
            ))
          )}
        </div>
      </section>

      {/* Telegram Slash Commands Reference */}
      <section className="border-t border-hairline pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-ink" aria-hidden="true" />
            <h2 className="m-0 text-sm font-semibold text-ink">
              Telegram Slash Commands
            </h2>
          </div>
          <span className="text-xs text-muted-ink">
            Handled directly by the Rust daemon Telegram bridge
          </span>
        </div>

        <div
          data-testid="tg-commands-grid"
          className="grid grid-cols-1 gap-x-6 gap-y-2 @min-[600px]/remote:grid-cols-2"
        >
          {TELEGRAM_COMMANDS.map((cmd) => (
            <div
              key={cmd.command}
              className="flex items-baseline gap-3 border-b border-hairline-soft py-1.5 text-xs"
            >
              <code className="min-w-[104px] font-mono font-semibold text-brand-text">
                {cmd.command}
              </code>
              <span className="text-body">{cmd.description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Safety Guardrail: Remote Uninstall */}
      <section className="border-t border-hairline pt-5">
        <div className="mb-3 flex items-center gap-2">
          <Lock className="size-4 text-muted-ink" aria-hidden="true" />
          <h2 className="m-0 text-sm font-semibold text-ink">
            Safety Guardrails
          </h2>
        </div>

        <div className="rayu-card-bevel overflow-hidden rounded-xl border border-premium bg-pane">
          <div
            data-testid="tg-safety-row"
            className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                <span>Remote uninstall</span>
                <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                  /uninstall
                </code>
                <span
                  data-testid="tg-remote-uninstall-badge"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    telegram.remoteUninstallEnabled
                      ? "bg-warn-soft text-warn"
                      : "bg-brand-soft text-brand-text",
                  )}
                >
                  {telegram.remoteUninstallEnabled ? (
                    <>
                      <ShieldAlert className="size-3" aria-hidden="true" />
                      <span>Allowed</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="size-3" aria-hidden="true" />
                      <span>Blocked</span>
                    </>
                  )}
                </span>
              </div>
              <div className="mt-1 text-muted-ink">
                Disabled by default. Controls whether your linked Telegram chat
                may trigger a 2-step confirmed CLI teardown while keeping
                project and session files intact.
              </div>
            </div>

            <Switch
              checked={telegram.remoteUninstallEnabled}
              disabled={isTogglingUninstall || isDaemonOffline}
              onCheckedChange={handleUninstallSwitchChange}
              aria-label="Allow remote uninstall"
              data-testid="tg-remote-uninstall-switch"
            />
          </div>
        </div>
      </section>

      {/* Guardrail Confirmation Dialog */}
      <Dialog
        open={uninstallConfirmOpen}
        onOpenChange={setUninstallConfirmOpen}
      >
        <DialogContent data-testid="tg-uninstall-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Allow Remote /uninstall?</DialogTitle>
            <DialogDescription>
              Enabling this guardrail allows your paired Telegram chat to
              request a confirmed teardown of the managed Rayu CLI installation
              (projects and session data remain untouched). Keep disabled unless
              actively required.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setUninstallConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid="tg-uninstall-confirm-btn"
              onClick={() => {
                setUninstallConfirmOpen(false);
                void onSetRemoteUninstall(true);
              }}
            >
              Enable Remote Uninstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
