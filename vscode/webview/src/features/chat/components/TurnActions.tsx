import * as React from "react";
import {
  Check,
  Clock,
  Copy,
  Download,
  GitFork,
  Pin,
  RotateCcw,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { callRpc, cn, postToHost } from "@/lib";
import type { SessionSummaryView } from "@shared/vscodeProtocol";

export interface TurnActionsProps {
  sessionId: string;
  turnId: string;
  responseMarkdown: string;
  timestamp: string;
  workedDuration?: string;
  credits?: string;
  kvCachePct?: number;
  kvCacheMissReason?: string;
  pinned?: boolean;
  onForked?: (session: SessionSummaryView) => void;
  onPinToggled?: (turnId: string, pinned: boolean) => void;
  onRetry?: (turnId: string) => void;
  onExport?: (sessionId: string) => void;
  className?: string;
}

export function TurnActions({
  sessionId,
  turnId,
  responseMarkdown,
  timestamp,
  workedDuration,
  credits,
  kvCachePct,
  kvCacheMissReason,
  pinned: initialPinned = false,
  onForked,
  onPinToggled,
  onRetry,
  onExport,
  className,
}: TurnActionsProps) {
  const [copied, setCopied] = React.useState(false);
  const [pinned, setPinned] = React.useState(initialPinned);
  const [isForking, setIsForking] = React.useState(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setPinned(initialPinned);
  }, [initialPinned]);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const text = responseMarkdown.trim();
    postToHost({ type: "rayucode.editor.copy", text });
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // ignore clipboard errors
    }
    setCopied(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 1500);
  };

  const handleFork = async () => {
    if (isForking) return;
    setIsForking(true);
    try {
      const result = await callRpc("sessions.fork", {
        sessionId,
        atTurnId: turnId,
      });
      onForked?.(result.session);
    } catch {
      // ignore offline error
    } finally {
      setIsForking(false);
    }
  };

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    onPinToggled?.(turnId, next);
  };

  const handleExport = async () => {
    onExport?.(sessionId);
    try {
      const exported = await callRpc("sessions.export", {
        sessionId,
        format: "markdown",
      });
      if (exported.content) {
        postToHost({ type: "rayucode.editor.copy", text: exported.content });
      }
    } catch {
      // ignore offline error
    }
  };

  return (
    <div
      data-slot="turn-actions"
        data-testid={`turn-actions-${turnId}`}
        className={cn("flex flex-wrap items-center gap-0.5 pt-1", className)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`turn-copy-${turnId}`}
              onClick={() => void handleCopy()}
              aria-label="Copy response"
              className={cn(
                "grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                copied && "text-brand-text",
              )}
            >
              {copied ? (
                <Check className="size-[15px]" aria-hidden="true" />
              ) : (
                <Copy className="size-[15px]" aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            {copied ? "Copied" : "Copy markdown"}
          </TooltipContent>
        </Tooltip>

        {onRetry && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid={`turn-retry-${turnId}`}
                onClick={() => onRetry(turnId)}
                aria-label="Retry turn"
                className="grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw className="size-[14px]" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              Retry / Regenerate
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`turn-fork-${turnId}`}
              onClick={() => void handleFork()}
              disabled={isForking}
              aria-label="Fork from here"
              className="grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <GitFork className="size-[15px]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="flex w-[240px] flex-col items-start gap-1 p-2.5"
          >
            <div className="text-xs font-semibold text-ink">Fork from here</div>
            <div className="text-[11.5px] leading-snug text-muted-ink">
              Starts a new session from this point. This one stays as it is.
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`turn-pin-${turnId}`}
              onClick={() => void handleTogglePin()}
              aria-pressed={pinned}
              aria-label="Pin response"
              className={cn(
                "grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                pinned && "bg-brand-soft text-brand-text",
              )}
            >
              <Pin className="size-[15px]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            {pinned ? "Pinned response" : "Pin response"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`turn-export-${turnId}`}
              onClick={() => void handleExport()}
              aria-label="Export session markdown"
              className="grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="size-[14px]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            Export session
          </TooltipContent>
        </Tooltip>

        <span className="ml-2 text-xs text-muted-ink">{timestamp}</span>

        {workedDuration && (
          <span
            data-slot="turn-duration"
            data-testid={`turn-duration-${turnId}`}
            className="ml-2 inline-flex items-center gap-1 font-mono text-[11px] text-muted-ink tabular-nums"
          >
            <Clock className="size-3 shrink-0 text-faint" aria-hidden="true" />
            <span>Worked for {workedDuration}</span>
          </span>
        )}

        {credits && (
          <span className="ml-2 font-mono text-[11px] text-faint tabular-nums">
            · {credits}
          </span>
        )}

        {kvCachePct !== undefined && kvCachePct > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-1.5 cursor-default font-mono text-[11px] text-faint tabular-nums">
                · {kvCachePct}% KV
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {kvCacheMissReason
                ? `KV cache notice: ${kvCacheMissReason}`
                : `${kvCachePct}% warm KV cache hit rate`}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
  );
}
