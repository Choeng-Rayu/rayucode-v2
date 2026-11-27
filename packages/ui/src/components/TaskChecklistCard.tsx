import { useEffect, useMemo, useRef, useState } from "react";
import {
  summarizeTodoProgress,
  type SessionTodoItem,
} from "@rayu-dev/rayucode-session-core/client";

export interface TaskChecklistCardProps {
  sessionId?: string | null;
  todos: readonly SessionTodoItem[];
  defaultExpanded?: boolean;
  className?: string;
}

function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

function SpinnerRingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

function PendingCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="8.5" />
    </svg>
  );
}

function CancelledCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 15.5 15.5 8.5" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function TaskChecklistCard({
  sessionId,
  todos,
  defaultExpanded,
  className,
}: TaskChecklistCardProps) {
  const summary = useMemo(() => summarizeTodoProgress(todos), [todos]);
  const incompleteCount = summary.inProgress + summary.pending;

  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const prevSessionIdRef = useRef(sessionId);
  const prevAllCompletedRef = useRef(summary.allCompleted);
  const prevIncompleteCountRef = useRef(incompleteCount);

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      prevAllCompletedRef.current = summary.allCompleted;
      prevIncompleteCountRef.current = incompleteCount;
      setUserExpanded(null);
      setDismissed(false);
    }
  }, [sessionId, summary.allCompleted, incompleteCount]);

  useEffect(() => {
    if (!summary.allCompleted) {
      setDismissed(false);
      if (
        prevAllCompletedRef.current ||
        (prevIncompleteCountRef.current === 0 && incompleteCount > 0)
      ) {
        setUserExpanded(null);
      }
    } else if (!prevAllCompletedRef.current && summary.allCompleted) {
      setUserExpanded(false);
    }
    prevAllCompletedRef.current = summary.allCompleted;
    prevIncompleteCountRef.current = incompleteCount;
  }, [summary.allCompleted, incompleteCount]);

  const stageLabel = useMemo(() => {
    if (summary.activeItem?.stage !== undefined) {
      return `Stage ${summary.activeItem.stage}`;
    }
    const stages = new Set<number>();
    for (const item of todos) {
      if (item.stage !== undefined) {
        stages.add(item.stage);
      }
    }
    if (stages.size === 1) {
      const [only] = stages;
      return `Stage ${only}`;
    }
    if (stages.size > 1) {
      return `${stages.size} stages`;
    }
    return null;
  }, [summary.activeItem, todos]);

  if (todos.length === 0 || (dismissed && summary.allCompleted)) {
    return null;
  }

  const expanded = userExpanded ?? defaultExpanded ?? !summary.allCompleted;
  const taskWord = summary.completed === 1 ? "task" : "tasks";
  const progressCounter = `${summary.completed}/${summary.activeTotal}`;

  return (
    <section
      data-slot="task-checklist-card"
      data-testid="task-checklist-card"
      data-expanded={expanded ? "true" : "false"}
      data-all-completed={summary.allCompleted ? "true" : "false"}
      aria-label="Task checklist"
      className={[
        "@container/tasks rayu-card-bevel overflow-hidden rounded-xl border border-hairline bg-pane shadow-bevel-surface",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-1 px-2.5 py-2">
        <button
          type="button"
          data-testid="task-checklist-toggle"
          aria-expanded={expanded}
          onClick={() => setUserExpanded(!expanded)}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {summary.allCompleted ? (
              <CheckCircleIcon className="size-3.5 shrink-0 text-brand-text" />
            ) : (
              <ChecklistIcon className="size-3.5 shrink-0 text-brand-text" />
            )}

            {summary.allCompleted ? (
              <span className="truncate text-xs font-medium text-ink">
                Completed {summary.completed} {taskWord}
              </span>
            ) : !expanded && summary.activeItem ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink">
                <span
                  className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {summary.activeItem.activeForm || summary.activeItem.content}
                </span>
              </span>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium text-ink">
                  Tasks
                </span>
                {stageLabel && (
                  <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
                    {stageLabel}
                  </span>
                )}
              </span>
            )}
          </span>

          <span className="flex shrink-0 items-center gap-2">
            {!expanded && (
              <span
                className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-active @min-[280px]/tasks:block"
                aria-hidden="true"
              >
                <span
                  className="rayu-effort-bar block h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${summary.percent}%` }}
                />
              </span>
            )}

            <span
              data-testid="task-checklist-progress"
              className="font-mono text-[11px] tabular-nums text-muted-ink"
            >
              {progressCounter}
            </span>

            <ChevronIcon
              className={[
                "size-3.5 shrink-0 text-muted-ink transition-transform duration-150",
                expanded ? "rotate-180" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          </span>
        </button>

        {summary.allCompleted && (
          <button
            type="button"
            data-testid="task-checklist-dismiss"
            aria-label="Dismiss completed tasks"
            onClick={() => setDismissed(true)}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloseIcon className="size-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <>
          <div
            className="h-[2.5px] w-full overflow-hidden bg-active"
            role="progressbar"
            aria-valuenow={summary.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Task completion progress"
          >
            <div
              className="rayu-effort-bar h-full transition-[width] duration-300"
              style={{ width: `${summary.percent}%` }}
            />
          </div>

          <ol
            data-testid="task-checklist-list"
            className="max-h-[216px] space-y-1 overflow-y-auto border-t border-hairline-soft px-2.5 py-2"
          >
            {todos.map((item, idx) => {
              const key = item.id ? `${item.id}-${idx}` : `${idx}-${item.content}`;
              const isInProgress = item.status === "in_progress";
              const isCompleted = item.status === "completed";
              const isCancelled = item.status === "cancelled";
              const showActiveForm =
                isInProgress &&
                Boolean(item.activeForm) &&
                item.activeForm !== item.content;

              const rowClass = isInProgress
                ? "flex items-start gap-2 rounded-lg border border-brand/25 bg-brand-softer px-2.5 py-1.5"
                : "flex items-start gap-2 rounded-lg px-2 py-1";

              const textClass = isInProgress
                ? "text-xs font-medium leading-snug text-ink"
                : isCompleted
                  ? "text-xs leading-snug text-muted-ink line-through"
                  : isCancelled
                    ? "text-xs leading-snug text-faint line-through"
                    : "text-xs leading-snug text-body";

              return (
                <li
                  key={key}
                  data-todo-status={item.status}
                  className={rowClass}
                >
                  {isCompleted ? (
                    <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
                  ) : isInProgress ? (
                    <SpinnerRingIcon className="mt-0.5 size-3.5 shrink-0 animate-spin text-brand-text" />
                  ) : isCancelled ? (
                    <CancelledCircleIcon className="mt-0.5 size-3.5 shrink-0 text-faint" />
                  ) : (
                    <PendingCircleIcon className="mt-0.5 size-3.5 shrink-0 text-faint" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className={textClass}>{item.content}</div>
                    {showActiveForm && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-ink">
                        {item.activeForm}
                      </div>
                    )}
                    {item.blockedReason && (
                      <div
                        data-testid="task-checklist-blocker"
                        className="mt-0.5 text-[11px] leading-snug text-warn"
                      >
                        {item.blockedReason}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
