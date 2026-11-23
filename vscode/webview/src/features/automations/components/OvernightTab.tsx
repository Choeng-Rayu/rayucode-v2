import * as React from "react";
import type { OvernightRunView } from "@shared/vscodeProtocol";

import { ErrorState } from "@/components/ui";

import {
  useOvernightRunActions,
  useOvernightRuns,
} from "../hooks/useAutomations";
import { MorningHandoffReport } from "./MorningHandoffReport";
import { OvernightLauncher } from "./OvernightLauncher";
import { OvernightRunRow } from "./OvernightRunRow";

export interface OvernightTabProps {
  launcherOpen?: boolean;
  onCloseLauncher?: () => void;
}

export function OvernightTab({
  launcherOpen = true,
  onCloseLauncher,
}: OvernightTabProps) {
  const { data: runs = [], isError, error, refetch } = useOvernightRuns();
  const { pauseMutation, runNowMutation, cancelMutation } =
    useOvernightRunActions();

  const [expandedLogs, setExpandedLogs] = React.useState<
    Record<string, boolean>
  >({});

  const handleToggleLog = (runId: string) => {
    setExpandedLogs((prev) => ({ ...prev, [runId]: !prev[runId] }));
  };

  const handleTogglePause = (run: OvernightRunView) => {
    pauseMutation.mutate({
      runId: run.runId,
      resume: run.status === "paused",
    });
  };

  const handleRunNow = (run: OvernightRunView) => {
    runNowMutation.mutate(run.runId);
    setExpandedLogs((prev) => ({ ...prev, [run.runId]: true }));
  };

  const handleCancel = (run: OvernightRunView) => {
    cancelMutation.mutate(run.runId);
  };

  if (isError) {
    return (
      <ErrorState
        title="Unable to load overnight runs"
        description={
          error instanceof Error
            ? error.message
            : "Failed to load overnight manifests from Rayu daemon."
        }
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const completedRuns = runs.filter((r) => r.status === "completed");

  return (
    <div data-testid="overnight-tab" className="flex flex-col gap-6">
      <OvernightLauncher open={launcherOpen} onClose={onCloseLauncher} />

      {/* Running & Recent Manifests */}
      <section aria-label="Running and recent overnight manifests">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
            Running &amp; Recent Manifests
          </h2>
          <span className="font-mono text-[11px] text-muted-ink tabular-nums">
            {runs.filter((r) => r.status === "running").length} active ·{" "}
            {runs.length} total
          </span>
        </div>

        <div
          data-testid="ovn-running-list"
          className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane"
        >
          {runs.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-ink">
              No overnight runs recorded yet. Launch an unattended mission
              above.
            </div>
          ) : (
            runs.map((run) => (
              <OvernightRunRow
                key={run.runId}
                run={run}
                expanded={Boolean(expandedLogs[run.runId])}
                onToggleExpand={() => handleToggleLog(run.runId)}
                onTogglePause={() => handleTogglePause(run)}
                onRunNow={() => handleRunNow(run)}
                onCancel={() => handleCancel(run)}
              />
            ))
          )}
        </div>
      </section>

      {/* Morning Handoff Reports */}
      <section aria-label="Morning handoff reports">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
            Morning Handoff Reports
          </h2>
          <span className="font-mono text-[11px] text-muted-ink tabular-nums">
            {completedRuns.length} ready
          </span>
        </div>

        <div
          data-testid="ovn-reports-list"
          className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane"
        >
          {completedRuns.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-ink">
              Completed overnight handoff reports will appear here with native
              VS Code Markdown Preview and diff links.
            </div>
          ) : (
            completedRuns.map((run, idx) => (
              <MorningHandoffReport
                key={run.runId}
                run={run}
                defaultExpanded={idx === 0}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
