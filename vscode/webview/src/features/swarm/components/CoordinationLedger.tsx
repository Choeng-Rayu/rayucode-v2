import * as React from "react";
import {
  Check,
  ExternalLink,
  FileDiff,
  GitBranch,
  X,
} from "lucide-react";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn, formatRelativeTime } from "@/lib";

import type {
  SwarmAgentView,
  SwarmBoardFilter,
  SwarmBoardMessageView,
  SwarmLedgerTab,
  SwarmPlanItemView,
  SwarmPlanProposalView,
  SwarmWorktreeView,
} from "../hooks/useSwarm";

const BOARD_KIND_FILTERS: ReadonlyArray<{
  id: SwarmBoardFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "dm", label: "DMs" },
  { id: "broadcast", label: "Broadcasts" },
  { id: "channel", label: "Channels" },
  { id: "lifecycle", label: "Lifecycle" },
];

export interface CoordinationLedgerProps {
  messages: SwarmBoardMessageView[];
  agents?: SwarmAgentView[];
  planItems: SwarmPlanItemView[];
  pendingProposals: SwarmPlanProposalView[];
  worktrees: SwarmWorktreeView[];
  planVersionShort: string;
  activeTab: SwarmLedgerTab;
  onTabChange: (tab: SwarmLedgerTab) => void;
  boardFilter: SwarmBoardFilter;
  onBoardFilterChange: (filter: SwarmBoardFilter) => void;
  workerFilter: string;
  onWorkerFilterChange: (worker: string) => void;
  onDecidePlan?: (
    proposalId: string,
    decision: "approve" | "reject",
  ) => Promise<{ ok: boolean; error?: string }>;
  isDecidingPlan?: boolean;
  onOpenWorktreeWindow: (path: string) => void;
  onViewWorktreeDiff: (path: string) => void;
  className?: string;
}

function formatHandle(handle: string | undefined): string {
  if (!handle) return "@all";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function renderMessageTextWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
  return parts.map((part, idx) => {
    if (/^@[a-zA-Z0-9_-]+$/.test(part)) {
      return (
        <span
          key={idx}
          data-slot="board-mention-pill"
          className="rounded bg-brand-softer px-1 py-px font-mono text-[11.5px] font-medium text-brand-text"
        >
          {part}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function CoordinationLedger({
  messages,
  agents = [],
  planItems,
  pendingProposals,
  worktrees,
  planVersionShort,
  activeTab,
  onTabChange,
  boardFilter,
  onBoardFilterChange,
  workerFilter,
  onWorkerFilterChange,
  onDecidePlan,
  isDecidingPlan = false,
  onOpenWorktreeWindow,
  onViewWorktreeDiff,
  className,
}: CoordinationLedgerProps) {
  const [expandedMsgSeqs, setExpandedMsgSeqs] = React.useState<
    Record<number, boolean>
  >({});

  const activePendingProposals = pendingProposals.filter(
    (p) => p.status === "pending",
  );

  return (
    <section
      data-slot="coordination-ledger"
      data-testid="coordination-ledger"
      aria-label="Swarm coordination ledger"
      className={cn("flex flex-col gap-2.5", className)}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as SwarmLedgerTab)}
        className="gap-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-full overflow-x-auto pb-0.5">
            <TabsList
              className="w-fit min-w-max"
              aria-label="Swarm coordination views"
            >
              <TabsTrigger value="board" data-testid="ledger-tab-board">
                Message Board ({messages.length})
              </TabsTrigger>
              <TabsTrigger value="plan" data-testid="ledger-tab-plan">
                Shared Plan ({planVersionShort})
                {activePendingProposals.length > 0
                  ? ` · ${activePendingProposals.length} pending`
                  : ""}
              </TabsTrigger>
              <TabsTrigger value="worktrees" data-testid="ledger-tab-worktrees">
                Worktrees ({worktrees.length})
              </TabsTrigger>
            </TabsList>
          </div>

          {activeTab === "board" && (
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Filter board messages by kind"
                className="flex flex-wrap items-center gap-1 rounded-[9px] border border-hairline bg-pane p-0.5"
              >
                {BOARD_KIND_FILTERS.map((f) => {
                  const active = boardFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      data-testid={`board-kind-filter-${f.id}`}
                      onClick={() => onBoardFilterChange(f.id)}
                      className={cn(
                        "cursor-pointer rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors",
                        active
                          ? "bg-active text-ink"
                          : "text-muted-ink hover:text-ink",
                      )}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>

              <Select value={workerFilter} onValueChange={onWorkerFilterChange}>
                <SelectTrigger
                  aria-label="Filter by worker"
                  data-testid="board-worker-filter"
                  className="h-7 min-w-0 max-w-full rounded-[8px] font-mono text-xs @min-[360px]/swarm:min-w-[136px]"
                >
                  <SelectValue placeholder="All workers" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all">All workers</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.agentId} value={a.agentId}>
                      @{a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Tab 1: Message Board */}
        <TabsContent value="board">
          <div
            data-slot="ledger-board"
            data-testid="ledger-board"
            className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {messages.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No swarm board messages match the current filter.
              </div>
            ) : (
              messages.map((msg) => {
                const isLong = msg.text.length > 160;
                const isExpanded = Boolean(expandedMsgSeqs[msg.seq]);
                return (
                  <div
                    key={msg.seq}
                    data-slot="ledger-board-row"
                    data-testid={`ledger-board-row-${msg.seq}`}
                    className="grid grid-cols-1 items-baseline gap-2 px-4 py-2.5 text-[12.5px] text-body @min-[660px]/swarm:grid-cols-[72px_188px_minmax(0,1fr)_auto] @min-[660px]/swarm:gap-3"
                  >
                    <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                      #{msg.seq} · {formatRelativeTime(msg.timestampMs)}
                    </span>

                    <span className="truncate font-mono text-[11.5px] text-ink">
                      {formatHandle(msg.from)}{" "}
                      <span className="text-muted-ink">→</span>{" "}
                      {formatHandle(msg.to)}
                    </span>

                    <div className="min-w-0 break-words text-body">
                      <div
                        className={cn(
                          isLong && !isExpanded && "line-clamp-2",
                        )}
                      >
                        {renderMessageTextWithMentions(msg.text)}
                      </div>
                      {isLong && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMsgSeqs((prev) => ({
                              ...prev,
                              [msg.seq]: !isExpanded,
                            }))
                          }
                          className="mt-0.5 cursor-pointer text-[11px] font-medium text-brand-text hover:underline"
                        >
                          {isExpanded ? "Show less" : "Expand summary"}
                        </button>
                      )}
                    </div>

                    <span
                      className={cn(
                        "w-fit rounded-full border px-[7px] py-px font-mono text-[10.5px]",
                        msg.kind === "dm" || msg.kind === "completion"
                          ? "border-brand/45 bg-brand-softer text-brand-text"
                          : "border-hairline text-muted-ink",
                      )}
                    >
                      {msg.channel ? msg.channel : msg.kind}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* Tab 2: Shared Plan (vN) & Proposals */}
        <TabsContent value="plan">
          <div className="flex flex-col gap-3">
            {/* Pending Plan Proposals */}
            {pendingProposals.length > 0 && (
              <div
                data-slot="ledger-plan-proposals"
                data-testid="ledger-plan-proposals"
                className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
              >
                {pendingProposals.map((proposal) => {
                  const isPending = proposal.status === "pending";
                  return (
                    <div
                      key={proposal.proposalId}
                      data-slot="ledger-proposal-row"
                      data-testid={`plan-proposal-${proposal.proposalId}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12.5px]"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-brand/45 bg-brand-softer px-2 py-px font-mono text-[10.5px] font-semibold text-brand-text">
                            Proposal v{proposal.version}
                          </span>
                          <span className="font-mono text-xs text-ink">
                            from {formatHandle(proposal.author)}
                          </span>
                          <span
                            data-testid={`proposal-status-${proposal.proposalId}`}
                            className={cn(
                              "rounded-full border px-2 py-px font-mono text-[10px]",
                              proposal.status === "approved"
                                ? "border-brand/40 bg-brand-softer text-brand-text"
                                : proposal.status === "rejected"
                                  ? "border-danger/40 bg-danger-soft text-danger"
                                  : "border-warn/40 bg-warn-soft text-warn",
                            )}
                          >
                            {proposal.status}
                          </span>
                        </div>
                        <div className="font-medium text-ink">
                          {proposal.summary}
                        </div>
                        {proposal.diffSummary && (
                          <div className="font-mono text-[11.5px] text-muted-ink">
                            {proposal.diffSummary}
                          </div>
                        )}
                      </div>

                      {isPending && (
                        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={isDecidingPlan || !onDecidePlan}
                            data-testid={`approve-proposal-${proposal.proposalId}`}
                            onClick={() =>
                              void onDecidePlan?.(proposal.proposalId, "approve")
                            }
                          >
                            <Check className="size-3.5" aria-hidden="true" />
                            <span>Approve Plan Update</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isDecidingPlan || !onDecidePlan}
                            data-testid={`reject-proposal-${proposal.proposalId}`}
                            onClick={() =>
                              void onDecidePlan?.(proposal.proposalId, "reject")
                            }
                          >
                            <X className="size-3.5" aria-hidden="true" />
                            <span>Reject</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Versioned Plan Items */}
            <div
              data-slot="ledger-plan"
              data-testid="ledger-plan"
              className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
            >
              {planItems.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-ink">
                  No shared plan items registered in this version.
                </div>
              ) : (
                planItems.map((item) => (
                  <div
                    key={item.id}
                    data-slot="ledger-plan-row"
                    data-testid={`ledger-plan-row-${item.id}`}
                    className="grid grid-cols-1 items-baseline gap-2 px-4 py-2.5 text-[12.5px] text-body @min-[660px]/swarm:grid-cols-[84px_150px_minmax(0,1fr)_auto] @min-[660px]/swarm:gap-3"
                  >
                    <span className="font-mono text-[11px] text-muted-ink">
                      {item.phase ?? planVersionShort}
                    </span>
                    <span className="truncate font-mono text-[11.5px] text-ink">
                      {formatHandle(item.assignee)}
                    </span>
                    <span className="min-w-0 break-words text-body">
                      {item.title}
                    </span>
                    <span
                      className={cn(
                        "w-fit rounded-full border px-[7px] py-px font-mono text-[10.5px]",
                        item.status === "completed"
                          ? "border-brand/45 bg-brand-softer text-brand-text"
                          : item.status === "blocked"
                            ? "border-warn/45 bg-warn-soft text-warn"
                            : "border-hairline text-muted-ink",
                      )}
                    >
                      {item.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        {/* Tab 3: Worktrees */}
        <TabsContent value="worktrees">
          <div
            data-slot="ledger-worktrees"
            data-testid="ledger-worktrees"
            className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {worktrees.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No isolated git worktrees active.
              </div>
            ) : (
              worktrees.map((wt) => (
                <div
                  key={wt.id}
                  data-slot="ledger-worktree-row"
                  data-testid={`worktree-row-${wt.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12.5px] text-body"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-xs font-semibold text-ink">
                      <GitBranch
                        className="size-3.5 text-brand-text"
                        aria-hidden="true"
                      />
                      <span>{wt.branch}</span>
                    </span>

                    <code className="max-w-full truncate rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-muted-ink">
                      {wt.path}
                    </code>

                    {wt.manager && (
                      <span className="rounded-full border border-hairline bg-inset px-2 py-px font-mono text-[10.5px] text-muted-ink">
                        {wt.manager}
                      </span>
                    )}

                    <span className="font-mono text-xs text-body">
                      {wt.agents.map((a) => formatHandle(a)).join(", ")}
                    </span>

                    <span className="rounded-full border border-hairline bg-inset px-2 py-px font-mono text-[11px] text-muted-ink tabular-nums">
                      {wt.dirtyFiles} dirty {wt.dirtyFiles === 1 ? "file" : "files"}
                    </span>
                  </div>

                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`view-worktree-diff-${wt.id}`}
                      onClick={() => onViewWorktreeDiff(wt.path)}
                    >
                      <FileDiff className="size-3.5" aria-hidden="true" />
                      <span>View Diff</span>
                    </Button>

                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      data-testid={`open-worktree-window-${wt.id}`}
                      onClick={() => onOpenWorktreeWindow(wt.path)}
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      <span>Open in New VS Code Window</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
