import * as React from "react";
import {
  ChevronDown,
  ExternalLink,
  Pause,
  Play,
  RotateCw,
  X,
} from "lucide-react";
import type { OvernightRunView, OvernightStatus } from "@shared/vscodeProtocol";

import {
  Button,
  RunStatusPulse,
  type RunStatusTone,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { cn, formatDurationSeconds, useAppStore } from "@/lib";

import { useOvernightEventLog } from "../hooks/useAutomations";

export interface OvernightRunRowProps {
  run: OvernightRunView;
  expanded: boolean;
  onToggleExpand: () => void;
  onTogglePause: () => void;
  onRunNow: () => void;
  onCancel: () => void;
}

function mapStatusToPulseTone(status: OvernightStatus): RunStatusTone {
  switch (status) {
    case "running":
      return "running";
    case "paused":
      return "warn";
    case "completed":
      return "success";
    case "cancelled":
    case "failed":
      return "danger";
  }
}

function formatStatusLabel(status: OvernightStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
  }
}

export function RunStatusBadge({ status }: { status: OvernightStatus }) {
  const toneClass =
    status === "running" || status === "completed"
      ? "bg-brand-soft text-brand-text border-transparent"
      : status === "paused"
        ? "bg-warn-soft text-warn border-transparent"
        : "bg-danger-soft text-danger border-transparent";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass,
      )}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

export function OvernightRunRow({
  run,
  expanded,
  onToggleExpand,
  onTogglePause,
  onRunNow,
  onCancel,
}: OvernightRunRowProps) {
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const { data: logLines, isLoading: logLoading } = useOvernightEventLog(
    run.runId,
    expanded,
  );

  const isPaused = run.status === "paused";
  const isTerminal =
    run.status === "cancelled" ||
    run.status === "completed" ||
    run.status === "failed";
  const logId = `ovn-log-${run.runId}`;

  const elapsedSecs = Math.max(
    1,
    Math.floor(((run.updatedAtMs ?? Date.now()) - run.startedAtMs) / 1000),
  );
  const estimatedCredits = (
    run.agentCount * 1.4 +
    run.taskCardCount * 2.1
  ).toFixed(1);

  const handleInspectCoordinator = () => {
    if (run.coordinatorSessionId) {
      setActiveSession(run.coordinatorSessionId, run.mission);
    } else {
      setActiveRoute("swarm");
    }
  };

  return (
    <div
      data-testid={`overnight-run-${run.runId}`}
      className="border-t border-hairline first:border-t-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-[13px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
            <RunStatusPulse
              status={mapStatusToPulseTone(run.status)}
              label={formatStatusLabel(run.status)}
            />
            <span className="truncate">{run.mission}</span>
            <RunStatusBadge status={run.status} />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-ink">
            <span>run_id:</span>
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
              {run.runId}
            </code>
            <span>·</span>
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
              {run.mode ?? "local"}
            </code>
            {run.repo ? (
              <>
                <span>·</span>
                <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                  {run.repo}
                </code>
              </>
            ) : null}
            <span>·</span>
            <span className="tabular-nums">{run.agentCount} agents</span>
            <span>·</span>
            <span className="tabular-nums">{run.durationLabel}</span>
            <span>·</span>
            <span className="font-mono text-[11px] tabular-nums">
              elapsed {formatDurationSeconds(elapsedSecs)}
            </span>
            {run.wakesAt ? (
              <>
                <span>·</span>
                <span className="tabular-nums">
                  wakes {run.wakesAt}
                  {run.handoffAt ? ` (handoff ${run.handoffAt})` : ""}
                </span>
              </>
            ) : null}
            <span>·</span>
            <span className="tabular-nums">
              {run.taskCardCount} task cards
            </span>
            <span>·</span>
            <span className="tabular-nums">
              {run.validationsGreen}{" "}
              {run.validationsGreen === 1 ? "validation" : "validations"} green
            </span>
            <span>·</span>
            <span className="font-mono text-[11px] text-body tabular-nums">
              {estimatedCredits} cr
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="default"
            size="sm"
            aria-expanded={expanded}
            aria-controls={logId}
            data-testid={`toggle-event-log-${run.runId}`}
            onClick={onToggleExpand}
          >
            <span>Event log</span>
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-ink transition-transform duration-150",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isTerminal}
            data-testid={`toggle-pause-${run.runId}`}
            onClick={onTogglePause}
          >
            {isPaused ? (
              <>
                <Play className="size-3" aria-hidden="true" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="size-3" aria-hidden="true" />
                <span>Pause</span>
              </>
            )}
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isTerminal}
                data-testid={`run-now-${run.runId}`}
                onClick={onRunNow}
              >
                <RotateCw className="size-3" aria-hidden="true" />
                <span>Run now</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Trigger immediate validation pass</TooltipContent>
          </Tooltip>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`inspect-coordinator-${run.runId}`}
            onClick={handleInspectCoordinator}
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            <span>Inspect Coordinator</span>
          </Button>

          {!isTerminal ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid={`cancel-run-${run.runId}`}
              onClick={onCancel}
            >
              <X className="size-3" aria-hidden="true" />
              <span>Cancel</span>
            </Button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div
          id={logId}
          data-testid={`event-log-drawer-${run.runId}`}
          className="border-t border-hairline bg-inset px-4 py-3"
        >
          {logLoading ? (
            <div className="font-mono text-[11.5px] text-muted-ink">
              Loading overnight event stream...
            </div>
          ) : (
            <pre className="m-0 overflow-x-auto font-mono text-[11.5px] leading-[1.6] text-body tabular-nums">
              {(logLines && logLines.length > 0
                ? logLines
                : [
                    `02:14:03  spawned worker-1 (${run.repo ?? "rayucode-v2"})`,
                    `02:18:41  validation green: cargo test --workspace (${run.validationsGreen} green)`,
                  ]
              ).join("\n")}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
