import { FileDiff } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import type {
  SwarmBoardMessage,
  SwarmLedgerTab,
  SwarmPlanScope,
  SwarmWorktree,
} from "../types"

export interface CoordinationLedgerProps {
  messages: SwarmBoardMessage[]
  planScopes: SwarmPlanScope[]
  worktrees: SwarmWorktree[]
  planVersionShort: string
  activeTab: SwarmLedgerTab
  onTabChange: (tab: SwarmLedgerTab) => void
  className?: string
}

function formatHandle(handle: string): string {
  return handle.startsWith("@") ? handle : `@${handle}`
}

export function CoordinationLedger({
  messages,
  planScopes,
  worktrees,
  planVersionShort,
  activeTab,
  onTabChange,
  className,
}: CoordinationLedgerProps) {
  const handleInspectDiff = (wt: SwarmWorktree) => {
    useAppStore.getState().openCodeFile(wt.file, 1)
    toast(`Inspecting ${wt.file} (${wt.branch})`)
  }

  return (
    <section
      data-slot="coordination-ledger"
      aria-label="Swarm coordination ledger"
      className={cn("flex flex-col gap-2.5", className)}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as SwarmLedgerTab)}
        className="gap-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="Swarm coordination views">
            <TabsTrigger value="board">Message Board</TabsTrigger>
            <TabsTrigger value="plan">
              Shared Plan ({planVersionShort})
            </TabsTrigger>
            <TabsTrigger value="worktrees">
              Worktrees ({worktrees.length})
            </TabsTrigger>
          </TabsList>

          <span className="text-[11.5px] text-muted-ink">
            Daemon snapshot persisted · survives reload
          </span>
        </div>

        {/* Tab 1: Message Board */}
        <TabsContent value="board">
          <div
            data-slot="ledger-board"
            className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {messages.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No swarm board messages yet.
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  data-slot="ledger-board-row"
                  className="grid grid-cols-1 items-baseline gap-2 px-4 py-2.5 text-[12.5px] text-body md:grid-cols-[64px_196px_minmax(0,1fr)_auto] md:gap-3"
                >
                  <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                    {msg.time}
                  </span>
                  <span className="truncate font-mono text-[11.5px] text-ink">
                    {formatHandle(msg.from)}{" "}
                    <span className="text-muted-ink">→</span>{" "}
                    {formatHandle(msg.to)}
                  </span>
                  <span className="min-w-0 break-words text-body">
                    {msg.text}
                  </span>
                  <span
                    className={cn(
                      "w-fit rounded-full border px-[7px] py-px font-mono text-[10.5px]",
                      msg.isOk
                        ? "border-brand/45 bg-brand-softer text-brand-text"
                        : "border-hairline text-muted-ink"
                    )}
                  >
                    {msg.tag}
                  </span>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* Tab 2: Shared Plan (v3) */}
        <TabsContent value="plan">
          <div
            data-slot="ledger-plan"
            className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
          >
            {planScopes.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-ink">
                No file ownership scopes registered in this plan.
              </div>
            ) : (
              planScopes.map((scope) => (
                <div
                  key={scope.id}
                  data-slot="ledger-plan-row"
                  className="grid grid-cols-1 items-baseline gap-2 px-4 py-2.5 text-[12.5px] text-body md:grid-cols-[64px_196px_minmax(0,1fr)_auto] md:gap-3"
                >
                  <span className="font-mono text-[11px] text-muted-ink">
                    {scope.scopeLabel}
                  </span>
                  <span className="truncate font-mono text-[11.5px] text-ink">
                    {scope.ownerRoute}
                  </span>
                  <span className="min-w-0 break-words text-body">
                    {scope.description}
                  </span>
                  <span
                    className={cn(
                      "w-fit rounded-full border px-[7px] py-px font-mono text-[10.5px]",
                      scope.isOk
                        ? "border-brand/45 bg-brand-softer text-brand-text"
                        : "border-hairline text-muted-ink"
                    )}
                  >
                    {scope.statusTag}
                  </span>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* Tab 3: Worktrees */}
        <TabsContent value="worktrees">
          <div
            data-slot="ledger-worktrees"
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
                  className="grid grid-cols-1 items-center gap-2 px-4 py-2.5 text-[12.5px] text-body md:grid-cols-[64px_196px_minmax(0,1fr)_auto] md:gap-3"
                >
                  <span className="font-mono text-[11px] text-muted-ink">
                    {wt.label}
                  </span>
                  <span className="truncate font-mono text-[11.5px] text-ink">
                    {wt.branch}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-body">
                    <span>Owner:</span>
                    <code className="rounded-sm bg-inset px-1.5 py-px font-mono text-[11.5px] text-ink">
                      {wt.owner}
                    </code>
                    <span aria-hidden="true" className="text-muted-ink">
                      ·
                    </span>
                    <code className="rounded-sm bg-inset px-1.5 py-px font-mono text-[11.5px] text-ink">
                      {wt.file}
                    </code>
                    <span aria-hidden="true" className="text-muted-ink">
                      ·
                    </span>
                    <span className="font-mono text-xs text-brand-text tabular-nums">
                      +{wt.additions}
                    </span>
                    <span className="font-mono text-xs text-danger tabular-nums">
                      −{wt.deletions}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleInspectDiff(wt)}
                  >
                    <FileDiff className="size-3.5" aria-hidden="true" />
                    <span>Inspect diff</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
