import { operationAvailable } from "@/lib/operation-result";
import * as React from "react";
import { Clock, Play, Plus, Trash2 } from "lucide-react";
import type { PermissionModeId, ScheduleItemView } from "@shared/vscodeProtocol";

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@/components/ui";
import { cn, useAppStore } from "@/lib";

import {
  useCreateSchedule,
  useScheduleActions,
  useSchedules,
} from "../hooks/useAutomations";

const CRON_PRESETS = [
  { label: "Weekdays 08:30", value: "30 8 * * 1-5" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "In 2 hours", value: "in 2 hours" },
  { label: "Nightly 02:00", value: "0 2 * * *" },
] as const;

function PermissionModeBadge({ mode }: { mode: PermissionModeId }) {
  const config: Record<
    PermissionModeId,
    { label: string; variant: "brand" | "warn" | "info" | "default" }
  > = {
    acceptEdits: { label: "Auto-edit", variant: "brand" },
    fullManage: { label: "Full Manage", variant: "warn" },
    plan: { label: "Plan", variant: "info" },
    default: { label: "Ask", variant: "default" },
    orchestrator: { label: "Orchestrator", variant: "brand" },
  };
  const resolved = config[mode] ?? config.default;
  return <Badge variant={resolved.variant}>{resolved.label}</Badge>;
}

interface ScheduleRowProps {
  schedule: ScheduleItemView;
  onRunNow: () => void;
  onToggle: (enabled: boolean) => void;
  onCancel: () => void;
  isToggling?: boolean;
}

function ScheduleRow({
  schedule,
  onRunNow,
  onToggle,
  onCancel,
  isToggling = false,
}: ScheduleRowProps) {
  return (
    <div
      data-testid={`schedule-row-${schedule.id}`}
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-[13px]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span>{schedule.title}</span>
          <PermissionModeBadge mode={schedule.permissionMode} />
          {schedule.queuedNow ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
              <Clock className="size-2.5" aria-hidden="true" />
              Queued now
            </span>
          ) : null}
          {schedule.nextRunAt ? (
            <span
              data-testid={`schedule-next-run-${schedule.id}`}
              className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-muted-ink tabular-nums"
            >
              Next: {schedule.nextRunAt}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-ink">
          <span className="font-mono text-body tabular-nums">
            {schedule.cronSummary}
          </span>
          {schedule.cronExpression ? (
            <>
              <span>·</span>
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-muted-ink">
                {schedule.cronExpression}
              </code>
            </>
          ) : null}
          {schedule.repo ? (
            <>
              <span>·</span>
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                {schedule.repo}
              </code>
            </>
          ) : null}
          <span>·</span>
          <span className="truncate">
            {schedule.description ?? schedule.prompt}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={`run-schedule-now-${schedule.id}`}
          disabled={!operationAvailable("automations.schedules.runNow")}
          title="Run now requires runtime support"
          onClick={onRunNow}
        >
          <Play className="size-3" aria-hidden="true" />
          <span>Run now</span>
        </Button>

        <Switch
          checked={schedule.enabled}
          disabled={isToggling || !operationAvailable("automations.schedules.toggle")}
          onCheckedChange={onToggle}
          aria-label={`Enable ${schedule.title}`}
          data-testid={`schedule-switch-${schedule.id}`}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Cancel schedule ${schedule.title}`}
          data-testid={`cancel-schedule-${schedule.id}`}
          onClick={onCancel}
          className="text-muted-ink hover:text-danger"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function SchedulesTab() {
  const { data: schedules = [] } = useSchedules();
  const createMutation = useCreateSchedule();
  const { toggleMutation, runNowMutation, cancelMutation } =
    useScheduleActions();
  const workspaces = useAppStore((s) => s.workspaces);
  const primaryRepo = workspaces[0]?.name ?? "rayucode-v2";

  const [formOpen, setFormOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [scheduleExpr, setScheduleExpr] = React.useState("30 8 * * 1-5");
  const [permissionMode, setPermissionMode] =
    React.useState<PermissionModeId>("plan");
  const [formError, setFormError] = React.useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!prompt.trim() || !scheduleExpr.trim()) {
      setFormError("Provide both a prompt action and cron or relative schedule.");
      return;
    }
    setFormError(null);
    try {
      await createMutation.mutateAsync({
        title: title.trim() || prompt.trim().slice(0, 48),
        prompt: prompt.trim(),
        schedule: scheduleExpr.trim(),
        permissionMode,
        repo: primaryRepo,
      });
      setTitle("");
      setPrompt("");
      setFormOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create schedule.",
      );
    }
  };

  return (
    <div data-testid="schedules-tab" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
            Recurring &amp; One-Shot Schedules
          </h2>
          <p className="mt-0.5 text-xs text-muted-ink">
            Backed by the Rust{" "}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
              schedule
            </code>{" "}
            tool and{" "}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
              RuntimeCommand::Schedules
            </code>
            .
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          size="sm"
          aria-expanded={formOpen}
          data-testid="toggle-new-schedule-btn"
          onClick={() => setFormOpen((prev) => !prev)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span>New Schedule</span>
        </Button>
      </div>

      {formOpen && (
        <form
          data-testid="create-schedule-form"
          onSubmit={(e) => {
            void handleCreate(e);
          }}
          className="rayu-card-bevel flex flex-col gap-3.5 rounded-[14px] border border-premium-hi bg-pane p-4"
        >
          <div className="grid grid-cols-1 gap-3 @min-[520px]/automations:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="sched-title"
                className="text-xs font-medium text-muted-ink"
              >
                Title (optional)
              </label>
              <input
                id="sched-title"
                data-testid="schedule-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Morning dependency & clippy audit"
                className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="sched-cron"
                className="text-xs font-medium text-muted-ink"
              >
                Cron or relative delay
              </label>
              <input
                id="sched-cron"
                data-testid="schedule-cron-input"
                type="text"
                value={scheduleExpr}
                onChange={(e) => setScheduleExpr(e.target.value)}
                placeholder="30 8 * * 1-5 or in 2 hours"
                className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-ink">Presets:</span>
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setScheduleExpr(preset.value)}
                className={cn(
                  "cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10.5px] transition-colors",
                  scheduleExpr === preset.value
                    ? "border-brand/50 bg-brand-soft text-brand-text"
                    : "border-hairline bg-inset text-muted-ink hover:text-ink",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="sched-prompt"
              className="text-xs font-medium text-muted-ink"
            >
              Prompt / Action
            </label>
            <input
              id="sched-prompt"
              data-testid="schedule-prompt-input"
              type="text"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="Check Cargo.lock and package.json for advisories and run unit tests"
              className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
            />
          </div>

          {formError ? (
            <p
              role="alert"
              data-testid="schedule-form-error"
              className="text-xs text-danger"
            >
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select
              value={permissionMode}
              onValueChange={(v) => setPermissionMode(v as PermissionModeId)}
            >
              <SelectTrigger
                size="sm"
                aria-label="Schedule permission mode"
                data-testid="schedule-permission-select"
              >
                <SelectValue placeholder="Permission mode" />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="plan">Plan Only</SelectItem>
                <SelectItem value="acceptEdits">Auto-edit</SelectItem>
                <SelectItem value="fullManage">Full Manage</SelectItem>
                <SelectItem value="default">Ask</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={createMutation.isPending}
                data-testid="submit-create-schedule-btn"
              >
                {createMutation.isPending ? "Creating..." : "Create Schedule"}
              </Button>
            </div>
          </div>
        </form>
      )}

      <div
        data-testid="ovn-schedules-list"
        className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
      >
        {schedules.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-ink">
            No recurring schedules configured yet. Click &ldquo;New
            Schedule&rdquo; above to create one.
          </div>
        ) : (
          schedules.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              isToggling={toggleMutation.isPending}
              onRunNow={() => runNowMutation.mutate(schedule.id)}
              onToggle={(enabled) =>
                toggleMutation.mutate({ id: schedule.id, enabled })
              }
              onCancel={() => cancelMutation.mutate(schedule.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
