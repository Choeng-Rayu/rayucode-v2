import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Network,
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
    swarmAgents,
    swarmSummary,
    runningCount,
    stalledCount,
    failedCount,
    completedCount,
    primaryTask,
    isDrawerOpen,
    nowMs,
    toggleDrawer,
    setDrawerOpen,
    selectTask,
    selectSwarmAgent,
    cancelProcess,
    openSwarmView,
  } = useProcesses({ stallThresholdSecs });

  // Zero noise when idle: render null (0px height) when 0 background processes & 0 swarm agents exist
  if (tasks.length === 0 && swarmAgents.length === 0) {
    return null;
  }

  const hasShellTasks = tasks.length > 0;
  const hasSwarm = swarmAgents.length > 0;
  const primarySwarm = swarmSummary.primaryAgent;

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
    } else if (primarySwarm) {
      selectSwarmAgent(primarySwarm.agentId);
    }
    toggleDrawer();
    onInspect?.();
  };

  const handleInspectSwarm = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (primarySwarm) {
      selectSwarmAgent(primarySwarm.agentId);
    }
    setDrawerOpen(true);
    onInspect?.();
  };

  const countSummaryLabel = () => {
    if (hasShellTasks) {
      if (runningCount > 0) return `${runningCount} running`;
      if (stalledCount > 0) return `${stalledCount} stalled`;
      if (failedCount > 0) return `${failedCount} failed`;
      return `${completedCount} done`;
    }
    if (swarmSummary.running > 0) {
      return `${swarmSummary.running}/${swarmSummary.total} ${
        swarmSummary.total === 1 ? "agent" : "agents"
      }`;
    }
    if (swarmSummary.blocked > 0) {
      return `${swarmSummary.blocked} blocked`;
    }
    if (swarmSummary.failed > 0) {
      return `${swarmSummary.failed} failed`;
    }
    return `${swarmSummary.completed}/${swarmSummary.total} done`;
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

  const swarmHeadline = () => {
    if (!primarySwarm) return "";
    const detail = primarySwarm.liveStatus || primarySwarm.currentIntent || primarySwarm.taskLabel;
    return detail ? `${primarySwarm.label}: ${detail}` : primarySwarm.label;
  };

  const renderLeadIndicator = () => {
    if (runningCount > 0 || swarmSummary.running > 0) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <RayuProcessingMark animated className="size-3.5" />
          <RunStatusPulse
            status="running"
            label={
              swarmSummary.running > 0
                ? "Background swarm running"
                : "Background tasks running"
            }
          />
        </span>
      );
    }
    if (stalledCount > 0 || swarmSummary.blocked > 0) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1">
          <AlertTriangle className="size-3.5 text-warn" />
          <RunStatusPulse status="warn" label="Background activity needs attention" />
        </span>
      );
    }
    if (failedCount > 0 || swarmSummary.failed > 0) {
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
      data-swarm-active-count={swarmSummary.active}
      className={cn(
        "@container/dock w-full border-t border-hairline bg-pane px-2.5",
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
        className="mx-auto flex h-[32px] w-full max-w-[732px] cursor-pointer items-center gap-2 text-xs text-body transition-colors select-none hover:text-ink"
      >
        {renderLeadIndicator()}

        {/* Active count */}
        <span
          data-testid="dock-active-count"
          className="shrink-0 font-medium text-ink tabular-nums"
        >
          {countSummaryLabel()}
        </span>

        {/* Primary process or swarm summary */}
        {primaryTask ? (
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
        ) : primarySwarm ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 truncate tabular-nums">
            <span className="text-faint">·</span>
            <span
              data-testid="dock-latest-process"
              className="truncate text-xs text-ink"
            >
              {swarmHeadline()}
            </span>
            {swarmSummary.percent !== null && (
              <div className="hidden shrink-0 items-center gap-1.5 @min-[420px]/dock:inline-flex">
                <div
                  role="progressbar"
                  aria-label="Swarm progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={swarmSummary.percent}
                  className="h-1.5 w-14 overflow-hidden rounded-full bg-inset"
                >
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-300"
                    style={{ width: `${swarmSummary.percent}%` }}
                  />
                </div>
                <span className="font-mono text-[10.5px] text-muted-ink">
                  {swarmSummary.percent}%
                </span>
              </div>
            )}
          </div>
        ) : null}

        {/* Companion Swarm Progress Pill when BOTH shell processes and swarm agents are present */}
        {hasShellTasks && hasSwarm && (
          <button
            type="button"
            data-testid="dock-swarm-progress"
            onClick={handleInspectSwarm}
            title="Inspect background swarm agents"
            className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-info/30 bg-info-soft px-2 text-[10.5px] font-medium text-info tabular-nums transition-colors hover:border-info/50"
          >
            <Network className="size-2.5 shrink-0" />
            <span>
              Swarm {swarmSummary.active > 0 ? `${swarmSummary.active}/${swarmSummary.total}` : `${swarmSummary.completed}/${swarmSummary.total}`}
              {swarmSummary.percent !== null ? ` · ${swarmSummary.percent}%` : ""}
            </span>
          </button>
        )}

        {/* Quick Mission Control link when only swarm is showing */}
        {!hasShellTasks && hasSwarm && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="dock-open-swarm-button"
            onClick={(event) => {
              event.stopPropagation();
              openSwarmView();
            }}
            className="h-5 shrink-0 gap-1 rounded-sm px-1.5 text-[11px] text-info hover:bg-info-soft"
          >
            <Network className="size-3" />
            <span className="hidden @min-[340px]/dock:inline">Swarm</span>
          </Button>
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
            <span className="hidden @min-[300px]/dock:inline">Stop</span>
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
          <span className="hidden @min-[280px]/dock:inline">Inspect</span>
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
