import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Square,
} from "lucide-react";

import {
  Badge,
  Button,
  RayuProcessingMark,
  RunStatusPulse,
} from "@/components/ui";
import { useShellFormFactor } from "@/features/shell";
import { cn, formatDurationSeconds } from "@/lib";

import {
  getStallQuietSeconds,
  isProcessActive,
  isProcessStalled,
  STALL_THRESHOLD_SECS,
  useProcesses,
} from "../hooks/useProcesses";

export interface BackgroundDockBarProps {
  className?: string;
  stallThresholdSecs?: number;
  onInspect?: () => void;
}

export function BackgroundDockBar({
  className,
  stallThresholdSecs = STALL_THRESHOLD_SECS,
  onInspect,
}: BackgroundDockBarProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { formFactor } = useShellFormFactor(containerRef);

  const {
    tasks,
    runningCount,
    stalledCount,
    failedCount,
    completedCount,
    primaryTask,
    isDrawerOpen,
    nowMs,
    toggleDrawer,
    selectTask,
    cancelProcess,
  } = useProcesses({ stallThresholdSecs });

  // Zero noise when idle: render null (0px height) when 0 background processes exist
  if (tasks.length === 0) {
    return null;
  }

  const primaryStalled = primaryTask
    ? isProcessStalled(primaryTask, stallThresholdSecs)
    : false;
  const primaryActive = primaryTask
    ? isProcessActive(primaryTask.status)
    : false;
  const quietSecs =
    primaryTask && primaryStalled
      ? getStallQuietSeconds(primaryTask, nowMs)
      : 0;

  const handleToggleDrawer = () => {
    if (primaryTask) {
      selectTask(primaryTask.taskId);
    }
    toggleDrawer();
    onInspect?.();
  };

  const countSummaryLabel = () => {
    if (runningCount > 0) {
      return `${runningCount} running`;
    }
    if (stalledCount > 0) {
      return `${stalledCount} stalled`;
    }
    if (failedCount > 0) {
      return `${failedCount} failed`;
    }
    return `${completedCount} done`;
  };

  const primaryProgressLabel = () => {
    if (!primaryTask) return null;
    const parts: string[] = [];
    if (typeof primaryTask.percent === "number") {
      parts.push(`${Math.round(primaryTask.percent)}%`);
    }
    if (
      typeof primaryTask.current === "number" &&
      typeof primaryTask.total === "number"
    ) {
      parts.push(`${primaryTask.current}/${primaryTask.total}`);
    }
    if (
      typeof primaryTask.etaSeconds === "number" &&
      primaryTask.etaSeconds > 0 &&
      primaryActive
    ) {
      parts.push(`ETA ${formatDurationSeconds(primaryTask.etaSeconds)}`);
    }
    if (parts.length > 0) {
      return `(${parts.join(" · ")})`;
    }
    if (primaryTask.summary) {
      return `· ${primaryTask.summary}`;
    }
    return null;
  };

  const renderLeadIndicator = () => {
    if (runningCount > 0) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <RayuProcessingMark animated className="size-3.5" />
          <RunStatusPulse status="running" label="Background tasks running" />
        </span>
      );
    }
    if (stalledCount > 0) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1">
          <AlertTriangle className="size-3.5 text-warn" />
          <RunStatusPulse status="warn" label="Background task stalled" />
        </span>
      );
    }
    if (failedCount > 0) {
      return <RunStatusPulse status="danger" label="Background task failed" />;
    }
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <Check className="size-3.5 text-brand-text" />
        <RunStatusPulse status="success" label="Background tasks completed" />
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      data-slot="background-dock-bar"
      data-testid="background-dock-bar"
      data-form-factor={formFactor}
      data-running-count={runningCount}
      data-stalled-count={stalledCount}
      className={cn(
        "w-full border-t border-hairline bg-pane px-2.5",
        className,
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isDrawerOpen}
        aria-label="Toggle Background Process Viewer"
        onClick={handleToggleDrawer}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleToggleDrawer();
          }
        }}
        className="mx-auto flex h-[30px] w-full max-w-[732px] cursor-pointer items-center gap-2 text-xs text-body transition-colors select-none hover:text-ink"
      >
        {renderLeadIndicator()}

        {/* Active task count */}
        <span
          data-testid="dock-active-count"
          className="shrink-0 font-medium text-ink tabular-nums"
        >
          {countSummaryLabel()}
        </span>

        {/* Latest running/stalled process single-line summary */}
        {primaryTask && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate tabular-nums">
            <span className="text-faint">·</span>
            <span
              data-testid="dock-latest-process"
              className="truncate font-mono text-xs text-ink"
            >
              {primaryTask.displayName || primaryTask.toolName}
            </span>
            {formFactor !== "compact" && primaryProgressLabel() && (
              <span className="truncate text-[11px] text-muted-ink">
                {primaryProgressLabel()}
              </span>
            )}
          </div>
        )}

        {/* Stall Watchdog Amber Badge */}
        {stalledCount > 0 && (
          <Badge
            variant="warn"
            data-testid="dock-stall-watchdog"
            title={
              quietSecs > 0
                ? `Stall Watchdog: no output for ${quietSecs}s`
                : "Stall Watchdog: process has gone silent"
            }
            className="h-5 shrink-0 gap-1 px-1.5 text-[10px] font-medium tabular-nums"
          >
            <AlertTriangle className="size-2.5 text-warn" />
            <span>
              {stalledCount} stalled
              {formFactor !== "compact" && quietSecs > 0
                ? ` (${quietSecs}s)`
                : ""}
            </span>
          </Badge>
        )}

        {/* Quick Stop button for active primary task */}
        {primaryTask && primaryActive && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="dock-stop-button"
            aria-label={`Stop ${primaryTask.displayName}`}
            onClick={(event) => {
              event.stopPropagation();
              void cancelProcess(primaryTask.taskId);
            }}
            className="h-5 shrink-0 gap-1 rounded-sm px-1.5 text-[11px] text-muted-ink hover:bg-danger-soft hover:text-danger"
          >
            <Square className="size-2.5 fill-current" />
            <span>Stop</span>
          </Button>
        )}

        {/* Quick Inspect button to toggle BackgroundProcessDrawer */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-testid="dock-inspect-button"
          aria-label={
            isDrawerOpen
              ? "Hide Background Processes"
              : "Inspect Background Processes"
          }
          onClick={(event) => {
            event.stopPropagation();
            handleToggleDrawer();
          }}
          className="h-5 shrink-0 gap-1 rounded-sm px-1.5 text-[11px] font-medium text-body hover:bg-active hover:text-ink"
        >
          <span>Inspect</span>
          {isDrawerOpen ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronUp className="size-3" />
          )}
        </Button>
      </div>
    </div>
  );
}
