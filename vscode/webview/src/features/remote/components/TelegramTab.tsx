import * as React from "react";
import {
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
} from "lucide-react";
import type { TelegramStatusView } from "@shared/vscodeProtocol";

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
  activeSessionId: string;
  setupMode: TelegramSetupMode;
  onSetupModeChange: (mode: TelegramSetupMode) => void;
  onLinkHosted: () => Promise<unknown>;
  isLinkingHosted: boolean;
  onLinkBotfather: (input: {
    botToken: string;
    allowedChatId?: string;
  }) => Promise<unknown>;
  isLinkingBotfather: boolean;
  onDisconnect: () => Promise<unknown>;
  isDisconnecting: boolean;
  onSendTestPing: () => Promise<unknown>;
  isPinging: boolean;
  onDriveActiveSession: () => Promise<unknown>;
  onDecideApproval: (id: string, decision: "allow" | "deny") => Promise<unknown>;
  isDecidingApproval: boolean;
  onSetRemoteUninstall: (enabled: boolean) => Promise<unknown>;
  isTogglingUninstall: boolean;
  onCopy: (text: string, label: string) => void;
}

export function TelegramTab({
  telegram,
  activeSessionId,
  setupMode,
  onSetupModeChange,
  onLinkHosted,
  isLinkingHosted,
  onLinkBotfather,
  isLinkingBotfather,
  onDisconnect,
  isDisconnecting,
  onSendTestPing,
  isPinging,
  onDriveActiveSession,
  onDecideApproval,
  isDecidingApproval,
  onSetRemoteUninstall,
  isTogglingUninstall,
  onCopy,
}: TelegramTabProps) {
  const [botToken, setBotToken] = React.useState("");
  const [allowedChatId, setAllowedChatId] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = React.useState(false);

  const pendingApprovals = telegram.approvals.filter(
    (item) => item.status === "pending",
  );
  const botHandle = telegram.botHandle ?? "@RayuCodeOfficialBot";
  const pairingCode = telegram.pairingCode ?? "RAYU-784-219";
  const pairingUrl =
    telegram.pairingUrl ??
    "https://t.me/RayuCodeOfficialBot?start=pair_RAYU_784_219";

  const handleBotfatherSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const trimmedToken = botToken.trim();
    if (!trimmedToken || !trimmedToken.includes(":")) {
      setTokenError(
        "Enter a valid @BotFather token (for example 123456789:AAF...).",
      );
      return;
    }
    setTokenError(null);
    await onLinkBotfather({
      botToken: trimmedToken,
      allowedChatId: allowedChatId.trim() || undefined,
    });
    setBotToken("");
    setAllowedChatId("");
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
      {/* Connected Bot Status Banner */}
      <div
        data-testid="tg-status-banner"
        className="rayu-card-bevel flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-hairline bg-pane p-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink">
            <RunStatusPulse
              status={
                telegram.linked && telegram.daemonOnline ? "running" : "idle"
              }
              label={telegram.linked ? "Telegram Linked" : "Disconnected"}
            />
            <span data-testid="tg-status-headline">
              {telegram.linked
                ? `Linked · ${botHandle} · ${telegram.mode === "botfather" ? "BotFather" : "Rayu Shared Bot"}`
                : `Not linked · Ready to pair with ${botHandle}`}
            </span>
            <span
              data-testid="tg-status-pill"
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                telegram.linked
                  ? "bg-brand-soft text-brand-text"
                  : "bg-raised text-muted-ink",
              )}
            >
              {telegram.linked ? "Connected" : "Disconnected"}
            </span>
            <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink">
              Daemon {telegram.daemonOnline ? "online" : "offline"}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-ink">
            Bound session:{" "}
            <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
              {telegram.boundSessionId ?? activeSessionId}
            </code>{" "}
            · Chat ID:{" "}
            <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body tabular-nums">
              {telegram.chatId ?? "842910443"}
            </code>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isPinging}
            onClick={() => void onSendTestPing()}
            data-testid="tg-send-ping-btn"
          >
            <Send className="size-3.5" aria-hidden="true" />
            <span>Send Test Ping</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void onDriveActiveSession()}
            data-testid="tg-drive-session-btn"
          >
            <span>Drive Active Session</span>
          </Button>

          {telegram.linked && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDisconnecting}
              onClick={() => void onDisconnect()}
              data-testid="tg-disconnect-btn"
            >
              <Unplug className="size-3.5" aria-hidden="true" />
              <span>Disconnect</span>
            </Button>
          )}
        </div>
      </div>

      {/* 3 Setup & Connection Modes */}
      <section className="flex flex-col gap-3">
        <Tabs
          value={setupMode}
          onValueChange={(v) => onSetupModeChange(v as TelegramSetupMode)}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
              Bot Connection &amp; Setup
            </h2>

            <TabsList aria-label="Telegram setup mode">
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
                Hosted Pairing (QR)
              </TabsTrigger>
              <TabsTrigger
                value="botfather"
                onClick={() => onSetupModeChange("botfather")}
                data-testid="tg-mode-botfather"
              >
                BYO @BotFather Token
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Mode 1: Connected Overview */}
          <TabsContent value="connected" data-testid="tg-panel-connected">
            <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane text-xs">
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                <div>
                  <div className="font-medium text-ink">Active bot handle</div>
                  <div className="mt-0.5 text-muted-ink">
                    Relays prompts, tool approvals, and session updates to
                    Telegram
                  </div>
                </div>
                <code className="rounded bg-inset px-2 py-0.5 font-mono text-xs text-brand-text">
                  {botHandle}
                </code>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                <div>
                  <div className="font-medium text-ink">Driving session</div>
                  <div className="mt-0.5 text-muted-ink">
                    Incoming Telegram messages and image attachments route here
                  </div>
                </div>
                <code className="rounded bg-inset px-2 py-0.5 font-mono text-xs text-body">
                  {telegram.boundSessionId ?? activeSessionId}
                </code>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                <div>
                  <div className="font-medium text-ink">Host CLI parity</div>
                  <div className="mt-0.5 text-muted-ink">
                    Manage or replace link from CLI with{" "}
                    <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                      rayu telegram link --replace-existing
                    </code>
                  </div>
                </div>
                <span className="font-mono text-xs text-muted-ink">
                  ~/.rayu/telegram.json
                </span>
              </div>
            </div>
          </TabsContent>

          {/* Mode 2: Hosted Pairing with Deterministic SVG QR Matrix */}
          <TabsContent value="hosted" data-testid="tg-panel-hosted">
            <div className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane p-5">
              <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
                <PairingQrMatrix
                  value={pairingUrl}
                  label="Telegram hosted pairing QR matrix"
                  testId="tg-qr-matrix"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    <span>Rayu Shared Bot — Hosted Pairing</span>
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
                      @RayuCodeOfficialBot
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-ink">
                    Scan this offline SVG QR matrix with your phone camera, or
                    send the pairing code below directly to{" "}
                    <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                      {botHandle}
                    </code>{" "}
                    in Telegram. Valid for 10 minutes.
                  </p>

                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="rounded-[10px] border border-hairline bg-inset px-3 py-2">
                      <div className="text-[10.5px] text-muted-ink">
                        Pairing code
                      </div>
                      <div
                        data-testid="tg-pairing-code"
                        className="mt-0.5 font-mono text-sm font-semibold tracking-wider text-ink tabular-nums"
                      >
                        /pair {pairingCode}
                      </div>
                    </div>

                    <div className="rounded-[10px] border border-hairline bg-inset px-3 py-2">
                      <div className="text-[10.5px] text-muted-ink">
                        Deep link
                      </div>
                      <div
                        data-testid="tg-pairing-link"
                        className="mt-0.5 truncate font-mono text-xs text-brand-text"
                      >
                        {pairingUrl}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      data-testid="tg-copy-code-btn"
                      onClick={() =>
                        onCopy(`/pair ${pairingCode}`, "pairing code")
                      }
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                      <span>Copy Pairing Code</span>
                    </Button>

                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      data-testid="tg-copy-deeplink-btn"
                      onClick={() => onCopy(pairingUrl, "Telegram deep link")}
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                      <span>Copy Deep Link</span>
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLinkingHosted}
                      data-testid="tg-regenerate-qr-btn"
                      onClick={() => void onLinkHosted()}
                    >
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                      <span>Regenerate QR</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Mode 3: BYO @BotFather Token */}
          <TabsContent value="botfather" data-testid="tg-panel-botfather">
            <div className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane p-5">
              <div className="font-medium text-ink">
                Connect Your Own @BotFather Bot
              </div>
              <p className="mt-1 text-xs text-muted-ink">
                Create a private bot via{" "}
                <strong className="font-medium text-body">@BotFather</strong>{" "}
                with{" "}
                <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                  /newbot
                </code>
                . Your token is transmitted directly to the Rust daemon and is
                never stored in VS Code settings or webview storage.
              </p>

              <form
                onSubmit={(e) => void handleBotfatherSubmit(e)}
                className="mt-4 flex max-w-[460px] flex-col gap-3"
                noValidate
              >
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="tg-byo-token-input"
                    className="text-xs font-medium text-body"
                  >
                    Bot token (write-only to Rust daemon)
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id="tg-byo-token-input"
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
                      className="h-8 w-full rounded-md border border-control-border bg-inset pr-9 pl-2.5 font-mono text-xs text-ink placeholder:text-faint focus-visible:border-ring focus-visible:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((prev) => !prev)}
                      aria-label={showToken ? "Hide bot token" : "Show bot token"}
                      className="absolute right-1.5 grid size-6 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
                    >
                      {showToken ? (
                        <EyeOff className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Eye className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {tokenError && (
                    <span
                      data-testid="tg-byo-token-error"
                      role="alert"
                      className="text-xs text-danger"
                    >
                      {tokenError}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="tg-byo-chat-id-input"
                    className="text-xs font-medium text-body"
                  >
                    Allowed Telegram chat ID (optional)
                  </label>
                  <input
                    id="tg-byo-chat-id-input"
                    data-testid="tg-byo-chat-id-input"
                    type="text"
                    value={allowedChatId}
                    onChange={(e) => setAllowedChatId(e.target.value)}
                    placeholder="e.g. 842910443"
                    className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink placeholder:text-faint focus-visible:border-ring focus-visible:outline-none"
                  />
                </div>

                <div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={isLinkingBotfather}
                    data-testid="tg-byo-submit-btn"
                  >
                    {isLinkingBotfather
                      ? "Connecting..."
                      : "Save & Connect Bot"}
                  </Button>
                </div>
              </form>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* Remote Approval Queue */}
      <section className="flex flex-col gap-3 border-t border-hairline pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
              Remote Approval Queue
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
            Synced with host permission gate &amp; Telegram inline buttons
          </span>
        </div>

        <div
          data-testid="tg-approvals-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
        >
          {telegram.approvals.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-ink">
              No pending remote approvals.
            </div>
          ) : (
            telegram.approvals.map((item) => (
              <ApprovalRow
                key={item.id}
                item={item}
                isResolving={isDecidingApproval}
                onDecide={(id, decision) => {
                  void onDecideApproval(id, decision);
                }}
              />
            ))
          )}
        </div>
      </section>

      {/* Telegram Chat Commands Reference */}
      <section className="flex flex-col gap-3 border-t border-hairline pt-5">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-muted-ink" aria-hidden="true" />
          <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
            Telegram Chat Commands
          </h2>
        </div>

        <div
          data-testid="tg-commands-grid"
          className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2"
        >
          {TELEGRAM_COMMANDS.map((cmd) => (
            <div
              key={cmd.command}
              className="flex items-baseline gap-3 border-b border-hairline-soft py-1.5 text-xs"
            >
              <code className="min-w-[110px] font-mono font-semibold text-brand-text">
                {cmd.command}
              </code>
              <span className="text-body">{cmd.description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Remote Uninstall Safety Guardrail Switch */}
      <section className="flex flex-col gap-3 border-t border-hairline pt-5">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-ink" aria-hidden="true" />
          <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
            Safety Guardrails
          </h2>
        </div>

        <div
          data-testid="tg-safety-card"
          className="rounded-[14px] border border-danger/30 bg-danger-soft/30 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink">
                <ShieldAlert className="size-4 text-danger" aria-hidden="true" />
                <span>Remote Uninstall Safety Guardrail</span>
                <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                  /uninstall-remote
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
              <p className="mt-1 text-xs text-muted-ink">
                Explicit opt-in guardrail (OFF by default). When blocked, the
                linked Telegram chat cannot trigger remote CLI teardown on this
                machine.
              </p>
            </div>

            <Switch
              checked={telegram.remoteUninstallEnabled}
              disabled={isTogglingUninstall}
              onCheckedChange={handleUninstallSwitchChange}
              aria-label="Allow remote uninstall"
              data-testid="tg-remote-uninstall-switch"
            />
          </div>
        </div>
      </section>

      {/* Explicit Confirmation Dialog for Enabling Remote Uninstall */}
      <Dialog
        open={uninstallConfirmOpen}
        onOpenChange={setUninstallConfirmOpen}
      >
        <DialogContent data-testid="tg-uninstall-confirm-dialog">
          <DialogHeader>
            <div className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-0.5 text-[11px] font-medium text-danger">
              <ShieldAlert className="size-3" aria-hidden="true" />
              <span>Security Guardrail Confirmation</span>
            </div>
            <DialogTitle>Allow Remote CLI Uninstall via Telegram?</DialogTitle>
            <DialogDescription>
              Enabling this switch allows your verified Telegram chat to run
              /uninstall-remote to remove the managed RayuCode CLI binary on
              this host. Workspace files and session transcripts are preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setUninstallConfirmOpen(false)}
              data-testid="tg-uninstall-cancel-btn"
            >
              Keep Blocked
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setUninstallConfirmOpen(false);
                void onSetRemoteUninstall(true);
              }}
              data-testid="tg-uninstall-confirm-btn"
            >
              Confirm &amp; Allow Remote Uninstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
