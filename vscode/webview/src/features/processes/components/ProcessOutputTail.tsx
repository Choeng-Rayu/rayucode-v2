import * as React from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Search,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  BackgroundProcessOutputView,
  BackgroundProcessView,
} from "@shared/vscodeProtocol";

import { Badge, Button, Input, Switch } from "@/components/ui";
import { cn, formatDurationSeconds } from "@/lib";

import {
  getStallQuietSeconds,
  isProcessActive,
  isProcessStalled,
  STALL_THRESHOLD_SECS,
} from "../hooks/useProcesses";

export interface AnsiSegment {
  text: string;
  tone?: "default" | "brand" | "danger" | "warn" | "info" | "muted";
}

const ANSI_TOKEN_REGEX = /\u001b\[([0-9;]*)m/g;
const ANSI_OTHER_CONTROL_REGEX = /\u001b\[[0-9;?]*[A-Za-ln-z]/g;

/**
 * Parses ANSI SGR color sequences into semantic RayuCode design-token spans
 * and strips non-color terminal control sequences.
 */
export function parseAnsiSegments(line: string): AnsiSegment[] {
  const cleaned = line.replace(ANSI_OTHER_CONTROL_REGEX, "");
  const segments: AnsiSegment[] = [];
  let currentTone: AnsiSegment["tone"] = "default";
  let lastIndex = 0;

  ANSI_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_TOKEN_REGEX.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: cleaned.slice(lastIndex, match.index),
        tone: currentTone,
      });
    }
    const codes = (match[1] ?? "0")
      .split(";")
      .map((c) => Number.parseInt(c || "0", 10));
    for (const code of codes) {
      if (code === 0 || code === 39) {
        currentTone = "default";
      } else if (code === 2 || code === 90) {
        currentTone = "muted";
      } else if (code === 31 || code === 91) {
        currentTone = "danger";
      } else if (code === 32 || code === 92) {
        currentTone = "brand";
      } else if (code === 33 || code === 93) {
        currentTone = "warn";
      } else if (code === 34 || code === 36 || code === 94 || code === 96) {
        currentTone = "info";
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleaned.length) {
    segments.push({
      text: cleaned.slice(lastIndex),
      tone: currentTone,
    });
  }

  return segments.length > 0 ? segments : [{ text: cleaned, tone: "default" }];
}

export function stripAnsiCodes(raw: string): string {
  return raw
    .replace(ANSI_TOKEN_REGEX, "")
    .replace(ANSI_OTHER_CONTROL_REGEX, "");
}

function toneClassName(tone: AnsiSegment["tone"]): string {
  switch (tone) {
    case "brand":
      return "text-brand-text";
    case "danger":
      return "text-danger";
    case "warn":
      return "text-warn";
    case "info":
      return "text-info";
    case "muted":
      return "text-muted-ink";
    default:
      return "text-body";
  }
}

export interface ProcessOutputTailProps {
  task: BackgroundProcessView | null;
  output: BackgroundProcessOutputView | null;
  follow: boolean;
  isLoading?: boolean;
  nowMs?: number;
  stallThresholdSecs?: number;
  onFollowChange: (follow: boolean) => void;
  onRefresh: () => void;
  onCopy: (text: string) => void;
  onOpenFile: (filePath: string) => void;
  onStop: (taskId: string) => void;
}

export function ProcessOutputTail({
  task,
  output,
  follow,
  isLoading = false,
  nowMs = Date.now(),
  stallThresholdSecs = STALL_THRESHOLD_SECS,
  onFollowChange,
  onRefresh,
  onCopy,
  onOpenFile,
  onStop,
}: ProcessOutputTailProps) {
  const [searchTerm, setSearchTerm] = React.useState<string>("");
  const [copied, setCopied] = React.useState<boolean>(false);
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  const rawContent = output?.content ?? "";
  const resolvedOutputFile = output?.outputFile ?? task?.outputFile;
  const active = task ? isProcessActive(task.status) : false;
  const stalled = task ? isProcessStalled(task, stallThresholdSecs) : false;
  const quietSecs =
    task && stalled ? getStallQuietSeconds(task, nowMs) : 0;

  const lines = React.useMemo(() => {
    if (!rawContent) return [];
    const split = rawContent.replace(/\r\n/g, "\n").split("\n");
    if (split.length > 1 && split[split.length - 1] === "") {
      split.pop();
    }
    return split;
  }, [rawContent]);

  const filteredLines = React.useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return lines.map((line, index) => ({ lineNumber: index + 1, line }));
    }
    return lines
      .map((line, index) => ({ lineNumber: index + 1, line }))
      .filter(({ line }) => stripAnsiCodes(line).toLowerCase().includes(query));
  }, [lines, searchTerm]);

  // Auto-scroll to bottom when Follow is active and new output arrives
  React.useEffect(() => {
    if (!follow) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [follow, rawContent]);

  const handleCopy = () => {
    const cleanText = stripAnsiCodes(rawContent);
    onCopy(cleanText);
    setCopied(true);
    try {
      toast.success("Process output copied to clipboard");
    } catch {
      // ignore if toast container is not mounted
    }
    setTimeout(() => setCopied(false), 1_500);
  };

  if (!task) {
    return (
      <div
        data-slot="process-output-tail-empty"
        data-testid="process-output-tail-empty"
        className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-[12px] border border-hairline bg-inset p-6 text-center text-xs text-muted-ink"
      >
        Select a background process to inspect its live output tail.
      </div>
    );
  }

  return (
    <div
      data-slot="process-output-tail"
      data-testid="process-output-tail"
      data-task-id={task.taskId}
      className="flex h-full min-h-0 flex-col gap-2"
    >
      {/* Top metadata & action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft pb-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs font-semibold text-ink">
              OUTPUT · {task.displayName || task.toolName}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-ink">
              ({task.taskId})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-ink tabular-nums">
            <span>
              Status:{" "}
              <strong
                className={cn(
                  "font-medium",
                  stalled
                    ? "text-warn"
                    : task.status === "running"
                      ? "text-brand-text"
                      : task.status === "failed"
                        ? "text-danger"
                        : "text-ink",
                )}
              >
                {stalled
                  ? "Stalled"
                  : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
              </strong>
            </span>
            {typeof task.percent === "number" && (
              <span>· {Math.round(task.percent)}%</span>
            )}
            {typeof task.etaSeconds === "number" &&
              task.etaSeconds > 0 &&
              active && (
                <span>· ETA {formatDurationSeconds(task.etaSeconds)}</span>
              )}
            {typeof task.exitCode === "number" && (
              <span>· Exit {task.exitCode}</span>
            )}
          </div>
        </div>

        {/* Action controls: Follow toggle, Refresh, Copy, Open Output File, Open Terminal, Stop Process */}
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-hairline bg-control px-2 py-1 text-[11px] text-body select-none">
            <span>Follow</span>
            <Switch
              size="sm"
              checked={follow}
              onCheckedChange={onFollowChange}
              data-testid="output-follow-toggle"
              aria-label="Follow output tail"
            />
          </label>

          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="output-refresh-button"
            onClick={onRefresh}
            disabled={isLoading}
            title="Reload 128 KB output tail"
          >
            <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
            <span>Refresh</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="output-copy-button"
            onClick={handleCopy}
            disabled={!rawContent}
            title="Copy output to clipboard"
          >
            {copied ? (
              <Check className="size-3 text-brand-text" />
            ) : (
              <Copy className="size-3" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="output-open-file-button"
            disabled={!resolvedOutputFile}
            onClick={() => {
              if (resolvedOutputFile) {
                onOpenFile(resolvedOutputFile);
              }
            }}
            title={
              resolvedOutputFile
                ? `Open ${resolvedOutputFile} in VS Code Editor`
                : "No output log file path available"
            }
          >
            <ExternalLink className="size-3" />
            <span>Open Output File in VS Code</span>
          </Button>

          {active && (
            <Button
              type="button"
              variant="destructive"
              size="xs"
              data-testid="output-stop-button"
              onClick={() => onStop(task.taskId)}
              title="Stop process (SIGTERM -> SIGKILL)"
            >
              <Square className="size-2.5 fill-current" />
              <span>Stop Process</span>
            </Button>
          )}
        </div>
      </div>

      {/* Stall Watchdog Amber Banner (Spec 03 Section 2B) */}
      {stalled && (
        <div
          role="status"
          data-testid="output-stall-watchdog-banner"
          className="flex items-center justify-between gap-2 rounded-[9px] border border-warn/30 bg-warn-soft px-3 py-1.5 text-xs text-warn"
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0 text-warn" />
            <span className="truncate font-medium">
              No output for {quietSecs}s — process is still alive.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="stall-banner-stop-button"
            onClick={() => onStop(task.taskId)}
            className="h-5 border-warn/40 bg-pane px-2 text-[11px] text-warn hover:bg-active"
          >
            Stop
          </Button>
        </div>
      )}

      {/* Output search filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-ink" />
          <Input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Filter output lines..."
            data-testid="output-search-input"
            className="h-7 pl-7 pr-7 font-mono text-xs"
          />
          {searchTerm && (
            <button
              type="button"
              aria-label="Clear output search"
              onClick={() => setSearchTerm("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-ink hover:text-ink"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        {searchTerm && (
          <Badge variant="outline" className="font-mono text-[10px] tabular-nums">
            {filteredLines.length}/{lines.length} lines
          </Badge>
        )}
      </div>

      {/* Terminal-grade dark well (ShellCard inset parity) */}
      <div
        ref={scrollContainerRef}
        data-testid="output-tail-well"
        className="rayu-prose min-h-[140px] flex-1 overflow-y-auto rounded-[12px] border border-hairline bg-inset p-3 font-mono text-xs leading-[1.55] shadow-bevel-surface tabular-nums"
      >
        {output?.truncated && (
          <div
            data-testid="output-truncated-banner"
            className="mb-2 flex items-center justify-between gap-2 rounded-sm border border-hairline-soft bg-pane px-2.5 py-1 font-sans text-[11px] text-muted-ink"
          >
            <span>
              Showing tail of output ({Math.round(output.byteLength / 1024)} KB) — earlier lines omitted.
            </span>
            {resolvedOutputFile && (
              <button
                type="button"
                onClick={() => onOpenFile(resolvedOutputFile)}
                className="cursor-pointer font-medium text-brand-text hover:underline"
              >
                Open full file ›
              </button>
            )}
          </div>
        )}

        {isLoading && !rawContent ? (
          <div className="py-6 text-center font-sans text-xs text-muted-ink">
            Reading output tail...
          </div>
        ) : filteredLines.length === 0 ? (
          <div className="py-6 text-center font-sans text-xs text-muted-ink">
            {searchTerm
              ? "No output lines match this filter."
              : active
                ? "Waiting for process output..."
                : "Process recorded no output."}
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredLines.map(({ lineNumber, line }) => {
              const segments = parseAnsiSegments(line);
              return (
                <div
                  key={lineNumber}
                  className="flex min-w-0 items-baseline gap-2.5 hover:bg-hover/50"
                >
                  <span className="w-7 shrink-0 select-none text-right text-[10px] text-faint tabular-nums">
                    {lineNumber}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                    {segments.map((seg, idx) => (
                      <span key={idx} className={toneClassName(seg.tone)}>
                        {seg.text}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
