import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

import type { SwarmAgent, SwarmAgentState } from "../types"

export interface AgentRosterProps {
  agents: SwarmAgent[]
  selectedAgentId: string
  onSelectAgent: (agentId: string) => void
  onHoverAgent?: (agentId: string) => void
  className?: string
}

function getStateDotClass(state: SwarmAgentState): string {
  switch (state) {
    case "running":
      return "bg-brand shadow-[0_0_0_3px_var(--accent-soft)]"
    case "coordinating":
    case "completed":
      return "bg-brand/70"
    case "paused":
      return "bg-warn"
    case "stopped":
      return "bg-danger"
  }
}

function getStateTextClass(state: SwarmAgentState): string {
  switch (state) {
    case "running":
      return "text-brand-text"
    case "paused":
      return "text-warn"
    case "stopped":
      return "text-danger"
    case "coordinating":
    case "completed":
      return "text-muted-ink"
  }
}

function formatLaneSummary(agent: SwarmAgent): string {
  if (agent.todoLane.length > 0 && agent.id !== "coordinator") {
    const done = agent.todoLane.filter((item) => item.status === "done").length
    return `${done}/${agent.todoLane.length} todos`
  }
  return agent.laneProgressLabel
}

export function AgentRoster({
  agents,
  selectedAgentId,
  onSelectAgent,
  onHoverAgent,
  className,
}: AgentRosterProps) {
  return (
    <section
      data-slot="agent-roster"
      aria-label="Swarm roster"
      className={cn(
        "rayu-card-bevel overflow-hidden rounded-[14px] bg-pane",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3.5 py-2.5 text-xs font-medium text-muted-ink">
        <span>Agents</span>
        <span className="font-mono text-[11px] text-faint tabular-nums">
          {agents.length}
        </span>
      </div>

      <ScrollArea className="max-h-[540px]">
        {agents.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-ink">
            No active swarm workers. Click{" "}
            <span className="font-medium text-ink">Spawn worker</span> above to
            launch a parallel agent.
          </div>
        ) : (
        <div role="list" className="divide-y divide-hairline">
          {agents.map((agent) => {
            const isSelected = agent.id === selectedAgentId
            const showDistinctWorktree =
              agent.worktree &&
              agent.worktree !== "root" &&
              agent.worktree !== agent.role

            return (
              <button
                key={agent.id}
                type="button"
                role="listitem"
                data-slot="agent-roster-row"
                data-agent-id={agent.id}
                data-selected={isSelected ? "true" : "false"}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelectAgent(agent.id)}
                onMouseEnter={() => onHoverAgent?.(agent.id)}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-1.5 border-l-2 px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isSelected
                    ? "border-l-brand bg-active"
                    : "border-l-transparent hover:bg-hover"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      getStateDotClass(agent.state)
                    )}
                  />
                  <span className="font-mono text-[13px] font-semibold text-ink">
                    {agent.name}
                  </span>

                  <span className="max-w-[130px] truncate rounded-full border border-hairline bg-inset px-[7px] py-px text-[11px] text-muted-ink">
                    {agent.role}
                  </span>

                  {showDistinctWorktree && (
                    <span className="max-w-[120px] truncate rounded-full border border-hairline bg-inset px-[7px] py-px font-mono text-[10.5px] text-muted-ink">
                      {agent.worktree}
                    </span>
                  )}

                  <span
                    className={cn(
                      "ml-auto shrink-0 font-mono text-[11px]",
                      getStateTextClass(agent.state)
                    )}
                  >
                    {agent.state}
                  </span>
                </div>

                <div className="truncate text-[12.5px] leading-[1.4] text-body">
                  {agent.task}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-ink tabular-nums">
                  <span className="rounded-sm bg-inset px-1.5 py-px text-[10.5px] text-body">
                    {agent.model}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatLaneSummary(agent)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{agent.duration}</span>
                </div>
              </button>
            )
          })}
        </div>
        )}
      </ScrollArea>
    </section>
  )
}
