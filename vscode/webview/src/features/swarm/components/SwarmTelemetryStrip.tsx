import * as React from "react";
import { AlertTriangle, GitBranch } from "lucide-react";
import type { SwarmConflictView } from "@shared/vscodeProtocol";

import { RunStatusPulse, TechFileBadge } from "@/components/ui";
import { cn } from "@/lib";

import type { SwarmTelemetrySummary } from "../hooks/useSwarm";

export interface SwarmTelemetryStripProps {
  telemetry: SwarmTelemetrySummary;
  conflicts?: SwarmConflictView[];
  compact?: boolean;
  onJumpToConflicts?: () => void;
  onJumpToPlanProposals?: () => void;
  onOpenFile?: (path: string) => void;
  className?: string;
}

export function SwarmTelemetryStrip({
  telemetry,
  conflicts = [],
  compact = false,
  onJumpToConflicts,
  onJumpToPlanProposals,
  onOpenFile,
  className,
}: SwarmTelemetryStripProps) {
  const [conflictsOpen, setConflictsOpen] = React.useState(false);

  const handleConflictClick = () => {
    setConflictsOpen((prev) => !prev);
    onJumpToConflicts?.();
  };

  if (compact) {
    return (
      <div
        data-slot="swarm-telemetry-strip"
        data-testid="swarm-telemetry-strip"
        className={cn(
          "flex flex-col gap-2 rounded-[10px] border border-hairline bg-pane px-3 py-2 text-[11.5px] text-body",
          className,
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-inset px-2 py-0.5 tabular-nums">
            <RunStatusPulse
              status={telemetry.runningCount > 0 ? "running" : "idle"}
              label={telemetry.runningCount > 0 ? "Active swarm" : "Idle swarm"}
            />
            <strong className="font-semibold text-ink">
              {telemetry.runningCount} running
            </strong>
            <span className="text-muted-ink">·</span>
            <span>{telemetry.completedCount} done</span>
          </span>

          <span className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-[11px] tabular-nums">
            <span
              className={cn(
                telemetry.conflictCount > 0 ? "text-warn" : "text-muted-ink",
              )}
            >
              {telemetry.conflictCount} conflicts
            </span>
            <span className="text-muted-ink">·</span>
            <span className="text-brand-text">{telemetry.creditsLabel}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-ink">
          <span className="inline-flex items-center gap-1 font-mono">
            <GitBranch className="size-3 shrink-0" aria-hidden="true" />
            <span>{telemetry.worktreeCount} worktrees</span>
          </span>
          <span className="font-mono">{telemetry.planLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        data-slot="swarm-telemetry-strip"
        data-testid="swarm-telemetry-strip"
        className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[12px] border border-hairline bg-pane px-3.5 py-2 text-[12.5px] text-body"
      >
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <RunStatusPulse
            status={telemetry.runningCount > 0 ? "running" : "idle"}
            label={telemetry.runningCount > 0 ? "Swarm running" : "Swarm idle"}
          />
          <span>
            <strong
              data-testid="telemetry-total-agents"
              className="font-semibold text-ink tabular-nums"
            >
              {telemetry.totalAgents} agents
            </strong>{" "}
            · {telemetry.runningCount} running, {telemetry.completedCount} completed
            {telemetry.blockedCount > 0 ? `, ${telemetry.blockedCount} blocked` : ""}
            {telemetry.stoppedCount > 0 ? `, ${telemetry.stoppedCount} stopped` : ""}
          </span>
        </span>

        <span aria-hidden="true" className="text-hairline-strong">
          ·
        </span>

        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <strong
            data-testid="telemetry-worktree-count"
            className="font-semibold text-ink tabular-nums"
          >
            {telemetry.worktreeCount} worktrees
          </strong>
          <span>·</span>
          {telemetry.conflictCount > 0 ? (
            <button
              type="button"
              data-testid="swarm-conflict-jump-btn"
              onClick={handleConflictClick}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 font-mono text-[11px] font-medium text-warn transition-colors hover:border-warn"
            >
              <AlertTriangle className="size-3" aria-hidden="true" />
              <span>{telemetry.conflictCount} file conflicts</span>
            </button>
          ) : (
            <span className="tabular-nums">0 file conflicts</span>
          )}
        </span>

        <span aria-hidden="true" className="text-hairline-strong">
          ·
        </span>

        <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-muted-ink">
          <span data-testid="telemetry-plan-label">{telemetry.planLabel}</span>
          {telemetry.pendingProposalCount > 0 && (
            <button
              type="button"
              data-testid="telemetry-pending-proposals-btn"
              onClick={onJumpToPlanProposals}
              className="cursor-pointer rounded-full border border-brand/40 bg-brand-softer px-2 py-px font-mono text-[10.5px] text-brand-text transition-colors hover:border-brand"
            >
              {telemetry.pendingProposalCount} pending
            </button>
          )}
        </span>

        <span className="flex-1" />

        <span
          data-testid="telemetry-cost-kv"
          className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-brand-text tabular-nums"
        >
          <span>{telemetry.creditsLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{telemetry.kvWarmPercent}% KV warm</span>
        </span>
      </div>

      {conflictsOpen && conflicts.length > 0 && (
        <div
          data-slot="swarm-conflict-notice"
          data-testid="swarm-conflict-notice"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-warn/40 bg-warn-soft px-3.5 py-2 text-xs text-body"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-hidden="true" />
            <span className="font-medium text-ink">
              Overlapping edits detected across worktrees:
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {conflicts.map((conflict) => (
              <button
                key={conflict.path}
                type="button"
                onClick={() => onOpenFile?.(conflict.path)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-[11px] text-ink transition-colors hover:border-brand/50"
              >
                <TechFileBadge path={conflict.path} />
                <span>{conflict.path}</span>
                <span className="text-muted-ink">
                  ({conflict.agents.join(", ")})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
