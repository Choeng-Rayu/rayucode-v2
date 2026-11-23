import * as React from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Clock,
  Cpu,
  Eye,
  Square,
  Terminal,
  X,
} from "lucide-react";
import type { BackgroundProcessView } from "@shared/vscodeProtocol";

import {
  Badge,
  Button,
  RayuProcessingMark,
  TechFileBadge,
} from "@/components/ui";
import { cn, formatDurationSeconds } from "@/lib";

import {
  getProcessElapsedSeconds,
  getStallQuietSeconds,
  isProcessActive,
  isProcessStalled,
  STALL_THRESHOLD_SECS,
} from "../hooks/useProcesses";

export interface ProcessRowProps {
  task: BackgroundProcessView;
  selected?: boolean;
  nowMs?: number;
  stallThresholdSecs?: number;
  onSelect: (taskId: string) => void;
  onStop: (taskId: string) => void;
  onInspect?: (taskId: string) => void;
}

/**
 * Extracts a file or script token from the command/displayName so `TechFileBadge`
 * renders the matching language badge (`RS`, `TS`, `TX`, `PY`, `GO`, `$`, etc.).
 */
export function resolveProcessFileBadgePath(
  task: BackgroundProcessView,
): string | null {
  const text = `${task.displayName} ${task.toolName}`.trim();
  const fileMatch = text.match(
    /\b([A-Za-z0-9_./-]+\.(?:rs|tsx|ts|jsx|js|py|go|json|md|css|html|sh|zsh|bash|sql|yml|yaml|toml))\b/i,
  );
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }
  const lower = text.toLowerCase();
  if (/\bcargo\b|\brustc\b|\bclippy\b/.test(lower)) {
    return "Cargo.toml";
  }
  if (/\btsc\b|\bvitest\b|\bvite\b/.test(lower)) {
    return "index.ts";
  }
  if (/\bpytest\b|\bpython3?\b|\buv\b/.test(lower)) {
    return "main.py";
  }
  if (/\bgo\s+(?:test|build|run)\b/.test(lower)) {
    return "main.go";
  }
  if (task.group === "shells") {
    return "command.sh";
  }
  return null;
}

export function ProcessRow({
  task,
  selected = false,
  nowMs = Date.now(),
  stallThresholdSecs = STALL_THRESHOLD_SECS,
  onSelect,
  onStop,
  onInspect,
}: ProcessRowProps) {
  const stalled = isProcessStalled(task, stallThresholdSecs);
  const active = isProcessActive(task.status);
  const elapsedSecs = getProcessElapsedSeconds(task, nowMs);
  const quietSecs = stalled ? getStallQuietSeconds(task, nowMs) : 0;
  const badgePath = resolveProcessFileBadgePath(task);

  const percent = React.useMemo(() => {
    if (typeof task.percent === "number") {
      return Math.max(0, Math.min(100, Math.round(task.percent)));
    }
    if (
      typeof task.current === "number" &&
      typeof task.total === "number" &&
      task.total > 0
    ) {
      return Math.max(
        0,
        Math.min(100, Math.round((task.current / task.total) * 100)),
      );
    }
    return undefined;
  }, [task.current, task.percent, task.total]);

  const hasDeterminateProgress =
    task.progressKind === "determinate" || percent !== undefined;

  const progressSummary = React.useMemo(() => {
    const parts: string[] = [];
    if (percent !== undefined) {
      parts.push(`${percent}%`);
    }
    if (typeof task.current === "number" && typeof task.total === "number") {
      parts.push(
        `${task.current}/${task.total}${task.unit ? ` ${task.unit}` : ""}`,
      );
    }
    if (typeof task.etaSeconds === "number" && task.etaSeconds > 0 && active) {
      parts.push(`ETA ${formatDurationSeconds(task.etaSeconds)}`);
    }
    if (stalled) {
      parts.push(`Stalled (${quietSecs}s quiet)`);
    }
    if (task.summary && !parts.includes(task.summary)) {
      parts.push(task.summary);
    }
    if (!active && typeof task.exitCode === "number") {
      parts.push(`Exit ${task.exitCode}`);
    }
    return parts.join(" · ") || "Running in background";
  }, [
    active,
    percent,
    quietSecs,
    stalled,
    task.current,
    task.etaSeconds,
    task.exitCode,
    task.summary,
    task.total,
    task.unit,
  ]);

  const statusBadge = () => {
    if (stalled) {
      return (
        <Badge
          variant="warn"
          data-testid={`process-stall-badge-${task.taskId}`}
          className="h-4 px-1.5 text-[10px] font-medium tabular-nums"
        >
          Stalled · {quietSecs}s
        </Badge>
      );
    }
    if (task.status === "running") {
      return (
        <Badge
          variant="brand"
          className="h-4 px-1.5 text-[10px] font-medium tabular-nums"
        >
          Running
        </Badge>
      );
    }
    if (task.status === "failed") {
      return (
        <Badge
          variant="danger"
          className="h-4 px-1.5 text-[10px] font-medium tabular-nums"
        >
          {typeof task.exitCode === "number"
            ? `Exit ${task.exitCode}`
            : "Failed"}
        </Badge>
      );
    }
    if (task.status === "superseded") {
      return (
        <Badge
          variant="outline"
          className="h-4 px-1.5 text-[10px] font-medium tabular-nums"
        >
          Superseded
        </Badge>
      );
    }
    return (
      <Badge
        variant="secondary"
        className="h-4 px-1.5 text-[10px] font-medium tabular-nums"
      >
        {typeof task.exitCode === "number" ? `Exit ${task.exitCode}` : "Done"}
      </Badge>
    );
  };

  const renderStatusIcon = () => {
    if (stalled) {
      return (
        <AlertTriangle
          data-testid={`process-icon-stalled-${task.taskId}`}
          className="size-3.5 shrink-0 text-warn"
        />
      );
    }
    if (task.status === "running") {
      return <RayuProcessingMark animated className="size-3.5 shrink-0" />;
    }
    if (task.status === "failed") {
      return <X className="size-3.5 shrink-0 text-danger" />;
    }
    if (task.status === "superseded") {
      return <Clock className="size-3.5 shrink-0 text-muted-ink" />;
    }
    return <Check className="size-3.5 shrink-0 text-brand-text" />;
  };

  const renderGroupBadge = () => {
    if (badgePath) {
      return <TechFileBadge path={badgePath} />;
    }
    if (task.group === "agents") {
      return (
        <span className="grid size-4 shrink-0 place-items-center rounded-[3.5px] bg-info-soft text-info">
          <Bot className="size-2.5" />
        </span>
      );
    }
    if (task.group === "runtime") {
      return (
        <span className="grid size-4 shrink-0 place-items-center rounded-[3.5px] bg-active text-muted-ink">
          <Cpu className="size-2.5" />
        </span>
      );
    }
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-[3.5px] bg-active text-muted-ink">
        <Terminal className="size-2.5" />
      </span>
    );
  };

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      data-slot="process-row"
      data-testid={`process-row-${task.taskId}`}
      data-status={stalled ? "stalled" : task.status}
      onClick={() => onSelect(task.taskId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(task.taskId);
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col gap-1 rounded-[9px] border px-2.5 py-2 text-left transition-colors outline-none",
        selected
          ? "border-premium bg-active text-ink shadow-bevel-surface"
          : "border-transparent bg-transparent text-body hover:border-hairline hover:bg-hover hover:text-ink",
      )}
    >
      {/* Line 1: Status icon + Tech/Group badge + Command label + ID + Status pill + Elapsed + Actions */}
      <div className="flex min-w-0 items-center gap-1.5">
        {renderStatusIcon()}
        {renderGroupBadge()}

        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-ink">
          {task.displayName || task.toolName}
        </span>

        <span className="hidden shrink-0 font-mono text-[10px] text-faint tabular-nums sm:inline">
          {task.taskId}
        </span>

        {statusBadge()}

        <span
          data-testid={`process-elapsed-${task.taskId}`}
          className="shrink-0 font-mono text-[11px] text-muted-ink tabular-nums"
        >
          {formatDurationSeconds(elapsedSecs)}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          {onInspect && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-testid={`process-inspect-${task.taskId}`}
              aria-label={`Inspect ${task.displayName}`}
              title="Inspect output"
              onClick={(event) => {
                event.stopPropagation();
                onInspect(task.taskId);
              }}
              className="size-5 text-muted-ink hover:text-ink"
            >
              <Eye className="size-3" />
            </Button>
          )}

          {active && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-testid={`process-stop-${task.taskId}`}
              aria-label={`Stop ${task.displayName}`}
              title="Stop process"
              onClick={(event) => {
                event.stopPropagation();
                onStop(task.taskId);
              }}
              className="size-5 text-muted-ink hover:bg-danger-soft hover:text-danger"
            >
              <Square className="size-2.5 fill-current" />
            </Button>
          )}
        </div>
      </div>

      {/* Line 2: Determinate progress bar OR concise summary */}
      <div className="flex min-w-0 flex-col gap-1 pl-5">
        {hasDeterminateProgress && percent !== undefined && (
          <div
            data-testid={`process-progress-bar-${task.taskId}`}
            className="h-[3px] w-full overflow-hidden rounded-full bg-inset"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all",
                stalled
                  ? "bg-warn"
                  : task.status === "failed"
                    ? "bg-danger"
                    : "bg-brand",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}

        <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-ink tabular-nums">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              stalled && "font-medium text-warn",
              task.status === "failed" && "text-danger",
            )}
          >
            {progressSummary}
          </span>
          {task.unread && (
            <span
              aria-label="Unread completion"
              className="size-1.5 shrink-0 rounded-full bg-brand-bright"
            />
          )}
        </div>
      </div>
    </div>
  );
}
