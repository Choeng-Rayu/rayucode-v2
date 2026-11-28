import * as React from "react"
import {
  ChevronDown,
  Clock,
  Network,
  Pause,
  Play,
  Plus,
  RotateCw,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { AutomationsSkeleton } from "@/components/ui/page-skeletons"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import {
  useAutomationsState,
  useOvernightRunActions,
  useToggleSchedule,
} from "../hooks/use-automations"
import type {
  AutomationPermissionMode,
  AutomationSchedule,
  MorningHandoffReport,
  OvernightRun,
  OvernightRunStatus,
} from "../types"
import { OvernightLauncher } from "./overnight-launcher"

export interface AutomationsViewProps {
  className?: string
}

function RunStatusPulse({ status }: { status: OvernightRunStatus }) {
  if (status === "Running") {
    return (
      <span
        className="relative inline-flex size-1.5 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <span className="absolute -inset-[3px] animate-ping rounded-full border border-brand-bright opacity-60" />
        <span className="size-1.5 rounded-full bg-brand-bright" />
      </span>
    )
  }
  if (status === "Paused") {
    return (
      <span
        className="size-1.5 shrink-0 rounded-full bg-warn"
        aria-hidden="true"
      />
    )
  }
  if (status === "Cancelled") {
    return (
      <span
        className="size-1.5 shrink-0 rounded-full bg-danger"
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className="size-1.5 shrink-0 rounded-full bg-brand"
      aria-hidden="true"
    />
  )
}

function RunStatusBadge({ status }: { status: OvernightRunStatus }) {
  const toneClass =
    status === "Running" || status === "Completed"
      ? "bg-brand-soft text-brand-text border-transparent"
      : status === "Paused"
        ? "bg-warn-soft text-warn border-transparent"
        : "bg-danger-soft text-danger border-transparent"

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass
      )}
    >
      {status}
    </span>
  )
}

function PermissionModeBadge({ mode }: { mode: AutomationPermissionMode }) {
  const toneClass =
    mode === "Auto-edit"
      ? "bg-brand-soft text-brand-text border-transparent"
      : mode === "Full Manage"
        ? "bg-warn-soft text-warn border-transparent"
        : "border-hairline bg-raised text-body"

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass
      )}
    >
      {mode}
    </span>
  )
}

interface OvernightRunRowProps {
  run: OvernightRun
  expanded: boolean
  onToggleExpand: () => void
  onTogglePause: () => void
  onRunNow: () => void
  onCancel: () => void
}

function OvernightRunRow({
  run,
  expanded,
  onToggleExpand,
  onTogglePause,
  onRunNow,
  onCancel,
}: OvernightRunRowProps) {
  const isPaused = run.status === "Paused"
  const isTerminal = run.status === "Cancelled" || run.status === "Completed"
  const logId = `ovn-log-${run.id}`

  return (
    <div
      data-testid={`overnight-run-${run.id}`}
      className="border-t border-hairline first:border-t-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
            <RunStatusPulse status={run.status} />
            <span>{run.title}</span>
            <RunStatusBadge status={run.status} />
          </div>
          <div className="mt-1 text-xs text-muted-ink">
            run_id:{" "}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
              {run.id}
            </code>{" "}
            ·{" "}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
              {run.host}
            </code>
            {run.repo ? (
              <>
                {" "}
                ·{" "}
                <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                  {run.repo}
                </code>
              </>
            ) : null}{" "}
            · {run.maxAgents} · {run.duration} · wakes{" "}
            <span className="tabular-nums">{run.wakeTime}</span> (handoff ready{" "}
            <span className="tabular-nums">{run.handoffTime}</span>) ·{" "}
            <span className="tabular-nums">{run.taskCardsCount}</span> task cards ·{" "}
            <span className="tabular-nums">{run.validationsGreen}</span>{" "}
            {run.validationsGreen === 1 ? "validation" : "validations"} green
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            aria-expanded={expanded}
            aria-controls={logId}
            data-testid={`toggle-event-log-${run.id}`}
            onClick={onToggleExpand}
          >
            Event log
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-ink transition-transform duration-150",
                expanded && "rotate-180"
              )}
              aria-hidden="true"
            />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isTerminal}
            data-testid={`toggle-pause-${run.id}`}
            onClick={onTogglePause}
          >
            {isPaused ? (
              <>
                <Play className="size-3" aria-hidden="true" />
                Resume
              </>
            ) : (
              <>
                <Pause className="size-3" aria-hidden="true" />
                Pause
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
                data-testid={`run-now-${run.id}`}
                onClick={onRunNow}
              >
                <RotateCw className="size-3" aria-hidden="true" />
                Run now
              </Button>
            </TooltipTrigger>
            <TooltipContent>Trigger immediate validation pass</TooltipContent>
          </Tooltip>

          {!isTerminal ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid={`cancel-run-${run.id}`}
              onClick={onCancel}
            >
              <X className="size-3" aria-hidden="true" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div
          id={logId}
          data-testid={`event-log-drawer-${run.id}`}
          className="border-t border-hairline bg-inset px-4 py-3"
        >
          <pre className="m-0 overflow-x-auto font-mono text-[11.5px] leading-[1.6] text-body tabular-nums">
            {run.eventLog.join("\n")}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

interface ScheduleRowProps {
  schedule: AutomationSchedule
  triggeredRecently: boolean
  isToggling: boolean
  onRunNow: () => void
  onToggle: () => void
}

function ScheduleRow({
  schedule,
  triggeredRecently,
  isToggling,
  onRunNow,
  onToggle,
}: ScheduleRowProps) {
  return (
    <div
      data-testid={`schedule-row-${schedule.id}`}
      className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span>{schedule.title}</span>
          <PermissionModeBadge mode={schedule.modeBadge} />
          {triggeredRecently ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
              <Clock className="size-2.5" aria-hidden="true" />
              Queued now
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-muted-ink">
          <span className="tabular-nums">{schedule.cronSummary}</span> ·{" "}
          <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
            {schedule.repo}
          </code>{" "}
          · {schedule.description}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={`trigger-schedule-${schedule.id}`}
          onClick={onRunNow}
        >
          Run now
        </Button>
        <Switch
          checked={schedule.enabled}
          disabled={isToggling}
          onCheckedChange={onToggle}
          aria-label={`Enable ${schedule.title}`}
          data-testid={`schedule-switch-${schedule.id}`}
        />
      </div>
    </div>
  )
}

function MorningReportRow({
  report,
  onNavigate,
}: {
  report: MorningHandoffReport
  onNavigate: (route: MorningHandoffReport["targetRoute"]) => void
}) {
  return (
    <div
      data-testid={`morning-report-${report.id}`}
      className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span>{report.title}</span>
          <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
            {report.status}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-ink tabular-nums">
          {report.timestamp} · {report.testsSummary} · {report.credits} ·{" "}
          {report.kvWarmPct}% KV warm
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          data-testid={`report-action-${report.id}`}
          onClick={() => onNavigate(report.targetRoute)}
        >
          {report.actionLabel}
        </Button>
      </div>
    </div>
  )
}

export function AutomationsView({ className }: AutomationsViewProps) {
  const { data, isPending, isError, error, refetch } = useAutomationsState()
  const toggleScheduleMutation = useToggleSchedule()
  const { togglePauseRun, triggerRunNow, cancelRun } = useOvernightRunActions()

  const [launcherOpen, setLauncherOpen] = React.useState(false)
  const [expandedLogs, setExpandedLogs] = React.useState<Record<string, boolean>>(
    {}
  )
  const [triggeredSchedules, setTriggeredSchedules] = React.useState<
    Record<string, boolean>
  >({})

  const setActiveRoute = useAppStore((s) => s.setActiveRoute)

  const handleToggleLog = (runId: string) => {
    setExpandedLogs((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }))
  }

  const handleTogglePause = (run: OvernightRun) => {
    const nextVerb = run.status === "Paused" ? "Resumed" : "Paused"
    togglePauseRun(run.id)
    toast.success(`${nextVerb} ${run.id}`)
  }

  const handleRunNow = (run: OvernightRun) => {
    triggerRunNow(run.id)
    setExpandedLogs((prev) => ({ ...prev, [run.id]: true }))
    toast.success(`Validation pass triggered for ${run.id}`)
  }

  const handleCancelRun = (run: OvernightRun) => {
    cancelRun(run.id)
    toast.info(`Cancelled overnight run ${run.id}`)
  }

  const handleToggleSchedule = async (schedule: AutomationSchedule) => {
    const result = await toggleScheduleMutation.mutateAsync(schedule.id)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    const nextState = result.data.schedules.find((s) => s.id === schedule.id)
    toast.success(
      `${schedule.title} ${nextState?.enabled ? "enabled" : "paused"}`
    )
  }

  const handleTriggerScheduleNow = (schedule: AutomationSchedule) => {
    setTriggeredSchedules((prev) => ({ ...prev, [schedule.id]: true }))
    toast.success(`Triggered ${schedule.title}`)
  }

  if (isPending && !data) {
    return <AutomationsSkeleton />
  }

  if (isError && !data) {
    return (
      <div className="mx-auto w-full max-w-[940px] px-6 py-10">
        <ErrorState
          title="Unable to load Automations"
          description={
            error instanceof Error
              ? error.message
              : "Failed to fetch overnight manifest and recurring schedules."
          }
          onRetry={() => {
            void refetch()
          }}
        />
      </div>
    )
  }

  const running = data?.running ?? []
  const schedules = data?.schedules ?? []
  const reports = data?.reports ?? []

  return (
    <div
      data-testid="automations-view"
      className={cn("h-full w-full overflow-y-auto", className)}
    >
      <div className="mx-auto w-full max-w-[940px] px-5 pt-7 pb-16 md:px-11 md:pt-10.5">
        {/* Page Header */}
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.025em] text-ink">
              Automations
            </h1>
            <p className="mt-1.5 max-w-[62ch] text-[13px] text-muted-ink">
              Run unattended overnight missions (
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-body">
                rayucode-overnight-core
              </code>
              ) and recurring checks with structured morning handoff reports.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setActiveRoute("swarm")}
              data-testid="automations-live-swarm-btn"
            >
              <Network className="size-3.5" aria-hidden="true" />
              Live Swarm
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={data?.available === false}
              aria-expanded={launcherOpen}
              aria-controls="overnight-launcher"
              data-testid="new-overnight-run-btn"
              onClick={() => setLauncherOpen((prev) => !prev)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New overnight run
            </Button>
          </div>
        </header>

        {data?.available === false ? (
          <div
            data-testid="automations-unavailable-card"
            role="status"
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-hairline-hi bg-pane px-4 py-3 text-xs text-muted-ink"
          >
            <span>
              {data.unavailableReason ??
                "Overnight missions and recurring schedules are not enabled in this daemon build."}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                void refetch()
              }}
            >
              Check again
            </Button>
          </div>
        ) : null}

        {/* Inline Overnight Launcher */}
        <OvernightLauncher
          open={launcherOpen}
          onClose={() => setLauncherOpen(false)}
        />

        {/* Section 1: Running Overnight Manifest */}
        <section id="ovn-running" className="mt-7.5 border-t border-hairline pt-5.5">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
              Running Now
            </h2>
            <span className="font-mono text-[11px] text-muted-ink tabular-nums">
              {running.length} active
            </span>
          </div>

          <div
            data-testid="ovn-running-list"
            className="rayu-card-bevel overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {running.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No active overnight runs. Start a new overnight mission above.
              </div>
            ) : (
              running.map((run) => (
                <OvernightRunRow
                  key={run.id}
                  run={run}
                  expanded={Boolean(expandedLogs[run.id])}
                  onToggleExpand={() => handleToggleLog(run.id)}
                  onTogglePause={() => handleTogglePause(run)}
                  onRunNow={() => handleRunNow(run)}
                  onCancel={() => handleCancelRun(run)}
                />
              ))
            )}
          </div>
        </section>

        {/* Section 2: Recurring Schedules */}
        <section
          id="ovn-schedules"
          className="mt-7.5 border-t border-hairline pt-5.5"
        >
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
              Recurring Schedules
            </h2>
          </div>

          <div
            data-testid="ovn-schedules-list"
            className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {schedules.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No recurring schedules configured yet.
              </div>
            ) : (
              schedules.map((schedule) => (
                <ScheduleRow
                  key={schedule.id}
                  schedule={schedule}
                  triggeredRecently={Boolean(triggeredSchedules[schedule.id])}
                  isToggling={toggleScheduleMutation.isPending}
                  onRunNow={() => handleTriggerScheduleNow(schedule)}
                  onToggle={() => {
                    void handleToggleSchedule(schedule)
                  }}
                />
              ))
            )}
          </div>
        </section>

        {/* Section 3: Morning Handoff Reports */}
        <section
          id="ovn-reports"
          className="mt-7.5 border-t border-hairline pt-5.5"
        >
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
              Morning Handoff Reports
            </h2>
          </div>

          <div
            data-testid="ovn-reports-list"
            className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {reports.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                Completed overnight handoff reports will appear here.
              </div>
            ) : (
              reports.map((report) => (
                <MorningReportRow
                  key={report.id}
                  report={report}
                  onNavigate={setActiveRoute}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
