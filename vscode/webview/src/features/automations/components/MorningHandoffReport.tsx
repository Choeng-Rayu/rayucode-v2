import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  FileDiff,
  FileText,
  GitBranch,
} from "lucide-react";
import type {
  OvernightRunView,
  OvernightTaskOutcomeView,
} from "@shared/vscodeProtocol";

import { Badge, Button, TechFileBadge } from "@/components/ui";
import { cn, formatRelativeTime, postToHost, useAppStore } from "@/lib";

import { useOvernightReport } from "../hooks/useAutomations";
import { RunStatusBadge } from "./OvernightRunRow";

export interface MorningHandoffReportProps {
  run: OvernightRunView;
  defaultExpanded?: boolean;
}

function TaskOutcomeCard({ task }: { task: OvernightTaskOutcomeView }) {
  const isCompleted =
    task.status.toLowerCase() === "completed" ||
    task.status.toLowerCase() === "passed";

  const handleOpenEvidenceFile = (filePath: string) => {
    postToHost({
      type: "rayucode.editor.openFile",
      path: filePath,
      preview: true,
    });
  };

  const handleOpenEvidenceDiff = (filePath: string) => {
    postToHost({
      type: "rayucode.editor.openDiff",
      path: filePath,
      scope: "git",
    });
  };

  return (
    <div
      data-testid={`handoff-task-${task.id}`}
      className="rounded-xl border border-hairline bg-pane p-3.5 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-ink">
          <CheckCircle2
            className={cn(
              "size-3.5 shrink-0",
              isCompleted ? "text-brand-text" : "text-warn",
            )}
            aria-hidden="true"
          />
          <span>{task.title}</span>
        </div>
        <Badge variant={isCompleted ? "brand" : "warn"}>{task.status}</Badge>
      </div>

      {(task.outcome || task.validationResult) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-ink">
          {task.outcome ? (
            <span>
              Outcome: <strong className="text-body">{task.outcome}</strong>
            </span>
          ) : null}
          {task.validationResult ? (
            <span className="font-mono text-[11px] text-brand-text">
              {task.validationResult}
            </span>
          ) : null}
        </div>
      )}

      {task.evidence.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-ink">Commits / Files:</span>
          {task.evidence.map((ev) => (
            <div key={ev} className="inline-flex items-center gap-1">
              <button
                type="button"
                data-testid={`handoff-evidence-file-${ev}`}
                onClick={() => handleOpenEvidenceFile(ev)}
                className="cite-link inline-flex items-center gap-1.5"
              >
                <TechFileBadge path={ev} />
                <span>{ev}</span>
              </button>
              <button
                type="button"
                data-testid={`handoff-evidence-diff-${ev}`}
                onClick={() => handleOpenEvidenceDiff(ev)}
                title={`Open diff for ${ev} in VS Code`}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted-ink transition-colors hover:border-premium-hi hover:text-ink"
              >
                <FileDiff className="size-2.5" aria-hidden="true" />
                <span>Diff</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {task.followups.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-warn/30 bg-warn-soft/50 px-2.5 py-2 text-[11px] text-warn">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3" aria-hidden="true" />
            <span>Open Blockers / Follow-ups</span>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-body">
            {task.followups.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MorningHandoffReport({
  run,
  defaultExpanded = false,
}: MorningHandoffReportProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const { data: reportData } = useOvernightReport(run.runId, expanded);

  const reviewPath =
    run.reviewPath ??
    (activeProjectPath
      ? `${activeProjectPath}/OVERNIGHT_REVIEW.md`
      : "OVERNIGHT_REVIEW.md");
  const tasks =
    run.tasks && run.tasks.length > 0
      ? run.tasks
      : (reportData?.run.tasks ?? []);

  const totalBlockers = tasks.reduce(
    (sum, t) => sum + (t.followups?.length ?? 0),
    0,
  );

  const handleOpenMarkdownPreview = () => {
    postToHost({
      type: "rayucode.editor.openMarkdownPreview",
      path: reviewPath,
    });
  };

  return (
    <div
      data-testid={`morning-handoff-${run.runId}`}
      className="border-t border-hairline first:border-t-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-[13px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
            <span>{run.mission}</span>
            <RunStatusBadge status={run.status} />
            {run.branch ? (
              <span className="inline-flex items-center gap-1 rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                <GitBranch className="size-3 text-brand-text" aria-hidden="true" />
                {run.branch}
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-ink tabular-nums">
            <span>{formatRelativeTime(run.updatedAtMs ?? run.startedAtMs)}</span>
            <span>·</span>
            <span>Duration {run.durationLabel}</span>
            <span>·</span>
            <span className="text-brand-text">
              {run.validationsGreen}/{Math.max(run.taskCardCount, run.validationsGreen)} validations passed
            </span>
            <span>·</span>
            <span>
              {totalBlockers === 0
                ? "0 open blockers"
                : `${totalBlockers} open blocker(s)`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="default"
            size="sm"
            data-testid={`open-markdown-preview-${run.runId}`}
            onClick={handleOpenMarkdownPreview}
          >
            <FileText className="size-3.5" aria-hidden="true" />
            <span>Open Review in Markdown Preview</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`handoff-open-changes-${run.runId}`}
            onClick={() => setActiveRoute("changes")}
          >
            <FileCode2 className="size-3.5" aria-hidden="true" />
            <span>Review Diffs</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            data-testid={`toggle-handoff-${run.runId}`}
            onClick={() => setExpanded((prev) => !prev)}
          >
            <span>{expanded ? "Hide Details" : "Handoff Details"}</span>
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-ink transition-transform duration-150",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      {expanded && (
        <div
          data-testid={`handoff-details-${run.runId}`}
          className="space-y-3 border-t border-hairline bg-inset/70 px-4 py-3.5"
        >
          {reportData?.markdown ? (
            <div className="rounded-lg border border-hairline bg-pane px-3 py-2 font-mono text-xs text-body">
              {reportData.markdown}
            </div>
          ) : null}

          {tasks.length === 0 ? (
            <div className="text-xs text-muted-ink">
              All {run.validationsGreen} validation suites completed with zero
              regressions. Click &ldquo;Open Review in Markdown Preview&rdquo; to
              inspect full report at{" "}
              <code className="font-mono text-body">{reviewPath}</code>.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {tasks.map((task) => (
                <TaskOutcomeCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
