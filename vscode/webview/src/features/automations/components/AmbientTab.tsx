import { Check, Clock, Radar, ShieldAlert, X } from "lucide-react";
import type { AmbientApprovalView } from "@shared/vscodeProtocol";

import { Badge, Button, RunStatusPulse } from "@/components/ui";
import { formatRelativeTime } from "@/lib";

import {
  useAmbientStatus,
  useDecideAmbientApproval,
} from "../hooks/useAutomations";

const AMBIENT_TRIGGER_RULES = [
  {
    id: "rule-drift",
    label: "Workspace Drift & Test Sweep",
    detail:
      "Triggers after 20m of editor inactivity when dirty files lack test coverage verification.",
    mode: "Bounded Auto",
  },
  {
    id: "rule-memory",
    label: "Jev Memory Consolidation",
    detail:
      "Extracts durable session facts into the project semantic graph during idle windows.",
    mode: "Safe Read",
  },
  {
    id: "rule-permission",
    label: "Command-Risk Permission Queue",
    detail:
      "Queues any non-trivial shell or git command into Pending Ambient Approvals instead of stalling.",
    mode: "Confirm Gate",
  },
] as const;

function UrgencyBadge({
  urgency,
}: {
  urgency: AmbientApprovalView["urgency"];
}) {
  if (urgency === "high") {
    return <Badge variant="danger">High urgency</Badge>;
  }
  if (urgency === "normal") {
    return <Badge variant="warn">Normal</Badge>;
  }
  return <Badge variant="info">Low</Badge>;
}

export function AmbientTab() {
  const { data: ambient } = useAmbientStatus();
  const decideMutation = useDecideAmbientApproval();

  const approvals = ambient?.approvals ?? [];
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const recentCycles = ambient?.recentCycles ?? [];

  return (
    <div data-testid="ambient-tab" className="flex flex-col gap-6">
      {/* Ambient Watcher Status Banner */}
      <section
        data-testid="ambient-watcher-status"
        className="rayu-card-bevel flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-premium bg-pane p-4"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-hairline bg-inset text-brand-text">
            <Radar className="size-4" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold text-ink">
                Ambient Autonomous Cycles
              </span>
              <RunStatusPulse
                status={
                  ambient?.currentCycleStatus === "running"
                    ? "running"
                    : ambient?.enabled
                      ? "success"
                      : "idle"
                }
              />
              <Badge variant={ambient?.enabled ? "brand" : "secondary"}>
                {ambient?.enabled ? "Watcher Active" : "Standby"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-ink">
              Background daemon watcher (
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                crates/rayucode-app-core/src/ambient.rs
              </code>
              ) · Next wakeup:{" "}
              <span className="font-mono text-body tabular-nums">
                {ambient?.nextWakeupAt ?? "On idle window"}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs text-muted-ink tabular-nums">
          <span>Cycle: {ambient?.currentCycleStatus ?? "idle"}</span>
          <span>·</span>
          <span className="text-ink">
            {pendingApprovals.length} pending approval(s)
          </span>
        </div>
      </section>

      {/* Pending Ambient Permissions Queue */}
      <section aria-label="Pending ambient permissions queue">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-warn" aria-hidden="true" />
            <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
              Pending Ambient Approvals Queue
            </h2>
          </div>
          <span className="font-mono text-[11px] text-muted-ink tabular-nums">
            {pendingApprovals.length} awaiting decision
          </span>
        </div>

        <div
          data-testid="ambient-approvals-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
        >
          {approvals.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-ink">
              No queued ambient permission requests. Unattended cycles are
              operating within safe bounds.
            </div>
          ) : (
            approvals.map((item) => {
              const isPending = item.status === "pending";
              return (
                <div
                  key={item.id}
                  data-testid={`ambient-approval-${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-inset px-2 py-0.5 font-mono text-xs font-medium text-ink">
                        {item.action}
                      </code>
                      <UrgencyBadge urgency={item.urgency} />
                      {!isPending && (
                        <Badge
                          variant={
                            item.status === "approved" ? "brand" : "danger"
                          }
                        >
                          {item.status === "approved" ? "Allowed" : "Denied"}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-ink">
                      {item.reason} ·{" "}
                      <span className="tabular-nums">
                        {formatRelativeTime(item.createdAtMs)}
                      </span>
                    </p>
                  </div>

                  {isPending ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={decideMutation.isPending}
                        data-testid={`ambient-allow-${item.id}`}
                        onClick={() =>
                          decideMutation.mutate({
                            id: item.id,
                            decision: "allow",
                          })
                        }
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                        <span>Allow</span>
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={decideMutation.isPending}
                        data-testid={`ambient-deny-${item.id}`}
                        onClick={() =>
                          decideMutation.mutate({
                            id: item.id,
                            decision: "deny",
                          })
                        }
                      >
                        <X className="size-3.5" aria-hidden="true" />
                        <span>Deny</span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Trigger Rules & Recent Cycles */}
      <div className="grid grid-cols-1 gap-4 @min-[720px]/app:grid-cols-2">
        <section className="rayu-card-bevel rounded-[14px] border border-premium bg-pane p-4">
          <h3 className="m-0 text-xs font-semibold tracking-tight text-ink uppercase">
            Trigger Rules
          </h3>
          <div className="mt-3 divide-y divide-hairline">
            {AMBIENT_TRIGGER_RULES.map((rule) => (
              <div key={rule.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">
                    {rule.label}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {rule.mode}
                  </Badge>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-ink">
                  {rule.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rayu-card-bevel rounded-[14px] border border-premium bg-pane p-4">
          <h3 className="m-0 text-xs font-semibold tracking-tight text-ink uppercase">
            Recent Autonomous Cycles
          </h3>
          <div className="mt-3 divide-y divide-hairline">
            {recentCycles.length === 0 ? (
              <div className="py-4 text-xs text-muted-ink">
                No recent ambient cycles recorded in this workspace.
              </div>
            ) : (
              recentCycles.map((cycle) => (
                <div key={cycle.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink">
                      <Clock
                        className="size-3 text-brand-text"
                        aria-hidden="true"
                      />
                      {cycle.id}
                    </span>
                    <Badge variant="brand">{cycle.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-ink">{cycle.summary}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
