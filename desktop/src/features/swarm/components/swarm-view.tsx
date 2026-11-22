import * as React from "react"
import { Network, Pause, Play, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { SwarmSkeleton } from "@/components/ui/page-skeletons"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { useSwarm } from "../hooks/use-swarm"
import type { SwarmLedgerTab } from "../types"
import { AgentInspector } from "./agent-inspector"
import { AgentRoster } from "./agent-roster"
import { CoordinationLedger } from "./coordination-ledger"
import { SpawnWorkerBar } from "./spawn-worker-bar"

export interface SwarmViewProps {
  className?: string
}

export function SwarmView({ className }: SwarmViewProps) {
  const {
    swarm,
    isLoading,
    isError,
    error,
    refetch,
    telemetry,
    selectedAgentId,
    selectedAgent,
    selectAgent,
    prefetchSwarm,
    spawnWorker,
    isSpawning,
    toggleAgentState,
    isTogglingAgent,
    sendDm,
    isSendingDm,
    togglePauseAll,
    isTogglingAll,
  } = useSwarm()

  const [spawnBarOpen, setSpawnBarOpen] = React.useState(false)
  const [ledgerTab, setLedgerTab] = React.useState<SwarmLedgerTab>("board")

  const handleSendDm = React.useCallback(
    async (agentId: string, message: string) => {
      const result = await sendDm(agentId, message)
      if (result.ok) {
        setLedgerTab("board")
      }
      return result
    },
    [sendDm]
  )

  if (isLoading) {
    return <SwarmSkeleton />
  }

  if (isError || !swarm) {
    return (
      <div className="mx-auto w-full max-w-[1120px] px-[26px] py-5">
        <ErrorState
          title="Unable to load Swarm orchestration state"
          description={
            error?.message ??
            "The local RayuCode daemon did not return an active swarm snapshot."
          }
          onRetry={refetch}
        />
      </div>
    )
  }

  const existingAgentNames = swarm.agents.map((a) => a.name)

  return (
    <TooltipProvider delayDuration={120}>
      <div
        data-slot="swarm-view"
        className={cn(
          "mx-auto flex w-full max-w-[1120px] flex-col gap-[18px] px-[26px] pt-5 pb-8",
          className
        )}
      >
        {/* Swarm Header */}
        <div
          data-slot="swarm-header"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 text-ink">
              <Network
                className="size-4 shrink-0 text-brand-text"
                aria-hidden="true"
              />
              <h1 className="m-0 truncate text-[15px] font-semibold tracking-tight text-ink">
                {swarm.title}
              </h1>
            </div>

            <span className="rounded-full border border-hairline bg-pane px-2.5 py-0.5 font-mono text-[11px] text-muted-ink">
              rayucode-swarm-core
            </span>

            <span className="font-mono text-xs text-muted-ink">
              {swarm.swarmId} · {telemetry.planLabel}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              aria-expanded={spawnBarOpen}
              onClick={() => setSpawnBarOpen((prev) => !prev)}
              data-slot="toggle-spawn-worker-btn"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Spawn worker</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isTogglingAll}
              onClick={() => void togglePauseAll()}
              data-slot="toggle-pause-all-btn"
            >
              {telemetry.allWorkersPaused ? (
                <>
                  <Play className="size-3.5" aria-hidden="true" />
                  <span>Resume All</span>
                </>
              ) : (
                <>
                  <Pause className="size-3.5" aria-hidden="true" />
                  <span>Pause All</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Single-Line Telemetry Strip */}
        <div
          data-slot="swarm-telemetry-strip"
          className="flex flex-wrap items-center gap-x-[18px] gap-y-2 rounded-[12px] border border-hairline bg-pane px-3.5 py-2.5 text-[12.5px] text-body"
        >
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                telemetry.runningCount > 0
                  ? "bg-brand shadow-[0_0_0_3px_var(--accent-soft)]"
                  : "bg-muted-ink"
              )}
            />
            <span>
              <strong className="font-semibold text-ink tabular-nums">
                {telemetry.totalAgents} agents
              </strong>{" "}
              · {telemetry.runningCount} running, {telemetry.completedCount}{" "}
              completed, {telemetry.rootCount} root
              {telemetry.stoppedCount > 0
                ? `, ${telemetry.stoppedCount} stopped`
                : ""}
            </span>
          </span>

          <span aria-hidden="true" className="text-hairline-strong">
            ·
          </span>

          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <strong className="font-semibold text-ink tabular-nums">
              {telemetry.worktreeCount} worktrees
            </strong>
            <span>· {telemetry.conflictCount} file conflicts</span>
          </span>

          <span aria-hidden="true" className="text-hairline-strong">
            ·
          </span>

          <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-muted-ink">
            <span>{telemetry.planLabel}</span>
            <span aria-hidden="true">·</span>
            <code className="rounded-sm bg-inset px-1.5 py-px text-body">
              /effort swarm
            </code>
          </span>

          <span className="flex-1" />

          <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-brand-text tabular-nums">
            <span>{swarm.credits}</span>
            <span aria-hidden="true">·</span>
            <span>{swarm.kvCachePct}% KV warm</span>
          </span>
        </div>

        {/* Inline Spawn Worker Bar */}
        {spawnBarOpen && (
          <SpawnWorkerBar
            existingAgentNames={existingAgentNames}
            isSubmitting={isSpawning}
            onSpawn={spawnWorker}
            onCancel={() => setSpawnBarOpen(false)}
          />
        )}

        {/* Two-Column Agent Roster + Live Worker Inspector */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(300px,370px)_minmax(0,1fr)]">
          <AgentRoster
            agents={swarm.agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={selectAgent}
            onHoverAgent={() => prefetchSwarm()}
          />

          <AgentInspector
            agent={selectedAgent}
            planVersion={swarm.planVersion}
            isTogglingAgent={isTogglingAgent}
            isSendingDm={isSendingDm}
            onToggleAgentState={toggleAgentState}
            onSendDm={handleSendDm}
          />
        </div>

        {/* Bottom Tabbed Coordination Ledger */}
        <CoordinationLedger
          messages={swarm.messages}
          planScopes={swarm.planScopes}
          worktrees={swarm.worktrees}
          planVersionShort={telemetry.planVersionShort}
          activeTab={ledgerTab}
          onTabChange={setLedgerTab}
        />
      </div>
    </TooltipProvider>
  )
}
