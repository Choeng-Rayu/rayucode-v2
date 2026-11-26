import * as React from "react";
import { formatDaemonVersionLabel } from "@rayu-dev/rayucode-session-core/client";
import { FileText, RefreshCw, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RunStatusPulse, type RunStatusTone } from "@/components/ui/rayu-symbols";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/app-store";
import { callRpc } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

function mapDaemonStateToTone(state: string): {
  tone: RunStatusTone;
  label: string;
} {
  switch (state) {
    case "connected":
      return { tone: "success", label: "Bridge online" };
    case "connecting":
    case "starting":
    case "reconnecting":
      return { tone: "warn", label: "Connecting..." };
    case "error":
    case "disconnected":
    default:
      return { tone: "danger", label: "Bridge offline" };
  }
}

export interface StatusBarPillProps {
  compact?: boolean;
  className?: string;
}

export function StatusBarPill({
  compact = false,
  className,
}: StatusBarPillProps) {
  const daemonStatus = useAppStore((s) => s.daemonStatus);
  const setDaemonStatus = useAppStore((s) => s.setDaemonStatus);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const [busy, setBusy] = React.useState(false);

  const { tone, label } = mapDaemonStateToTone(daemonStatus.state);
  const formattedVersion = formatDaemonVersionLabel(daemonStatus.version);

  const handleReconnect = async () => {
    setBusy(true);
    try {
      const next = await callRpc("daemon.reconnect");
      setDaemonStatus(next);
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setBusy(true);
    try {
      const next = await callRpc("daemon.restart");
      setDaemonStatus(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="status-bar-pill"
              data-daemon-state={daemonStatus.state}
              aria-label={`Rayu daemon status: ${label}`}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2 py-1 text-[11px] text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink",
                daemonStatus.state !== "connected" &&
                  "border-warn/30 bg-warn-soft/50 text-warn",
                compact && "px-1.5 py-0.5",
                className,
              )}
            >
              <RunStatusPulse status={tone} />
              {!compact && (
                <span className="max-w-[110px] truncate font-medium">
                  {daemonStatus.state === "connected"
                    ? formattedVersion || "Online"
                    : label}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>{label}</span>
          {daemonStatus.latencyMs !== undefined && (
            <span className="font-mono text-[10.5px] text-muted-ink tabular-nums">
              {daemonStatus.latencyMs}ms
            </span>
          )}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          Rayu Engine ({daemonStatus.state})
        </DropdownMenuLabel>
        {daemonStatus.socketPath && (
          <div className="truncate px-2.5 pb-1 font-mono text-[10.5px] text-muted-ink">
            {daemonStatus.socketPath}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onClick={() => void handleReconnect()}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          <span>Reconnect bridge</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => void handleRestart()}>
          <RotateCcw className="size-3.5" />
          <span>Restart bridge</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void callRpc("daemon.openOutputLog")}
        >
          <FileText className="size-3.5" />
          <span>Open bridge output log</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setActiveRoute("settings")}>
          <span>Runtime &amp; Doctor settings</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Slim 28px banner shown ONLY when the daemon/bridge is reconnecting, starting, or offline.
 * Completely hidden (`null`) when healthy (`state === "connected"`).
 */
export function DaemonBanner() {
  const daemonStatus = useAppStore((s) => s.daemonStatus);
  const setDaemonStatus = useAppStore((s) => s.setDaemonStatus);
  const [busy, setBusy] = React.useState(false);

  if (daemonStatus.state === "connected") {
    return null;
  }

  const isStarting =
    daemonStatus.state === "connecting" ||
    daemonStatus.state === "starting" ||
    daemonStatus.state === "reconnecting";

  const handleAction = async () => {
    setBusy(true);
    try {
      const next = await callRpc(
        daemonStatus.state === "disconnected" || daemonStatus.state === "error"
          ? "daemon.restart"
          : "daemon.reconnect",
      );
      setDaemonStatus(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="daemon-banner"
      className={cn(
        "flex h-7 shrink-0 items-center justify-between gap-2 border-b px-3 text-[11.5px]",
        isStarting
          ? "border-warn/30 bg-warn-soft text-warn"
          : "border-danger/30 bg-danger-soft text-danger",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <RunStatusPulse status={isStarting ? "warn" : "danger"} />
        <span className="truncate font-medium">
          {daemonStatus.error
            ? daemonStatus.error
            : isStarting
              ? "Connecting to Rayu daemon..."
              : "Rayu daemon bridge is offline"}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => void handleAction()}
          className="h-5 px-2 text-[11px]"
        >
          <RefreshCw className={cn("size-3", busy && "animate-spin")} />
          <span>{isStarting ? "Reconnect" : "Start Bridge"}</span>
        </Button>
      </div>
    </div>
  );
}
