import * as React from "react";
import { GitBranch, RefreshCw, Square } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  RayuProcessingMark,
  RunStatusPulse,
   type RunStatusTone,
  ScrollArea,
} from "@/components/ui";
import { cn } from "@/lib";

import {
  DEFAULT_SWARM_MODELS,
  type SwarmAgentStatus,
  type SwarmAgentView,
} from "../hooks/useSwarm";

export interface AgentRosterProps {
  agents: SwarmAgentView[];
  selectedAgentId: string;
  availableModels?: string[];
  onSelectAgent: (agentId: string) => void;
  onKillAgent?: (agentId: string, pauseOnly?: boolean) => void;
  onSwitchModel?: (agentId: string, model: string) => void;
  className?: string;
}

export function mapAgentStatusToTone(status: SwarmAgentStatus): RunStatusTone {
  switch (status) {
    case "running":
    case "spawned":
    case "ready":
      return "running";
    case "completed":
      return "success";
    case "blocked":
      return "warn";
    case "failed":
    case "crashed":
      return "danger";
    case "stopped":
      return "idle";
  }
}

export function getStatusLabelClass(status: SwarmAgentStatus): string {
  switch (status) {
    case "running":
    case "spawned":
    case "ready":
      return "text-brand-text";
    case "completed":
      return "text-brand-text";
    case "blocked":
      return "text-warn";
    case "failed":
    case "crashed":
      return "text-danger";
    case "stopped":
      return "text-muted-ink";
  }
}

export function AgentRoster({
  agents,
  selectedAgentId,
  availableModels = [...DEFAULT_SWARM_MODELS],
  onSelectAgent,
  onKillAgent,
  onSwitchModel,
  className,
}: AgentRosterProps) {
  const sortedAgents = React.useMemo(() => {
    const coordinators = agents.filter(
      (a) => a.role === "coordinator" || a.depth === 0,
    );
    const workers = agents.filter(
      (a) => a.role !== "coordinator" && a.depth !== 0,
    );
    return [...coordinators, ...workers];
  }, [agents]);

  return (
    <section
      data-slot="agent-roster"
      data-testid="agent-roster"
      aria-label="Swarm roster"
      className={cn(
        "rayu-card-bevel overflow-hidden rounded-[14px] bg-pane",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3.5 py-2.5 text-xs font-medium text-muted-ink">
        <span>Agent Roster</span>
        <span className="font-mono text-[11px] text-faint tabular-nums">
          {agents.length}
        </span>
      </div>

      <ScrollArea className="max-h-[540px]">
        {sortedAgents.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-ink">
            No active swarm workers. Click{" "}
            <span className="font-medium text-ink">Spawn worker</span> above to
            launch a parallel agent.
          </div>
        ) : (
          <div role="list" className="divide-y divide-hairline">
            {sortedAgents.map((agent) => {
              const isSelected = agent.agentId === selectedAgentId;
              const isCoordinator =
                agent.role === "coordinator" || agent.depth === 0;
              const isRunning = agent.status === "running";
              const todoSummary =
                typeof agent.todoCompleted === "number" &&
                typeof agent.todoTotal === "number"
                  ? `${agent.todoCompleted}/${agent.todoTotal} todos`
                  : isCoordinator
                    ? "root depth 0"
                    : "assigned lane";

              return (
                <div
                  key={agent.agentId}
                  role="listitem"
                  data-slot="agent-roster-row"
                  data-testid={`agent-roster-row-${agent.agentId}`}
                  data-agent-id={agent.agentId}
                  data-selected={isSelected ? "true" : "false"}
                  className={cn(
                    "group relative flex w-full flex-col gap-1.5 border-l-2 px-3.5 py-3 transition-colors",
                    !isCoordinator && "pl-6",
                    isSelected
                      ? "border-l-brand bg-active"
                      : "border-l-transparent hover:bg-hover",
                  )}
                >
                  {!isCoordinator && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-0 bottom-0 left-3.5 w-2 border-l border-hairline-strong"
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`select-agent-${agent.agentId}`}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => onSelectAgent(agent.agentId)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-none"
                    >
                      {isRunning ? (
                        <RayuProcessingMark className="size-3.5 shrink-0" />
                      ) : (
                        <RunStatusPulse
                          status={mapAgentStatusToTone(agent.status)}
                          label={agent.status}
                        />
                      )}

                      <span className="truncate font-mono text-[13px] font-semibold text-ink">
                        {agent.label}
                      </span>

                      <span className="shrink-0 rounded-full border border-hairline bg-inset px-[7px] py-px text-[10.5px] text-muted-ink">
                        {isCoordinator ? "coordinator" : agent.role}
                      </span>

                      {agent.branch && (
                        <span className="hidden max-w-[110px] items-center gap-1 truncate rounded-full border border-hairline bg-inset px-[7px] py-px font-mono text-[10px] text-muted-ink sm:inline-flex">
                          <GitBranch className="size-2.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{agent.branch}</span>
                        </span>
                      )}
                    </button>

                    <span
                      className={cn(
                        "shrink-0 font-mono text-[11px]",
                        getStatusLabelClass(agent.status),
                      )}
                    >
                      {agent.status}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectAgent(agent.agentId)}
                    className="w-full cursor-pointer truncate text-left text-[12px] leading-[1.4] text-body focus-visible:outline-none"
                  >
                    {agent.currentIntent ?? "Awaiting coordinator assignment"}
                  </button>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 font-mono text-[11px] text-muted-ink tabular-nums">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-sm bg-inset px-1.5 py-px text-[10.5px] text-body">
                        {agent.model ?? "inherit"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{todoSummary}</span>

                      {(typeof agent.diffAdditions === "number" ||
                        typeof agent.diffDeletions === "number") && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-brand-text">
                            +{agent.diffAdditions ?? 0}
                          </span>
                          <span className="text-danger">
                            -{agent.diffDeletions ?? 0}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {onSwitchModel && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              data-testid={`agent-switch-model-${agent.agentId}`}
                              aria-label={`Switch model for ${agent.label}`}
                              className="inline-flex h-5 cursor-pointer items-center gap-1 rounded border border-hairline bg-inset px-1.5 text-[10px] text-muted-ink transition-colors hover:border-premium hover:text-ink"
                            >
                              <RefreshCw className="size-2.5" aria-hidden="true" />
                              <span>Model</span>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>
                              Switch @{agent.label} model
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {availableModels.map((m) => (
                              <DropdownMenuItem
                                key={m}
                                data-testid={`agent-model-option-${agent.agentId}-${m}`}
                                onSelect={() => onSwitchModel(agent.agentId, m)}
                              >
                                <span className="font-mono text-xs">{m}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {!isCoordinator && onKillAgent && (
                        <button
                          type="button"
                          data-testid={`agent-kill-btn-${agent.agentId}`}
                          aria-label={
                            agent.status === "stopped"
                              ? `Resume ${agent.label}`
                              : `Kill ${agent.label}`
                          }
                          onClick={() => onKillAgent(agent.agentId)}
                          className={cn(
                            "inline-flex h-5 cursor-pointer items-center gap-1 rounded border px-1.5 text-[10px] transition-colors",
                            agent.status === "stopped"
                              ? "border-hairline bg-inset text-muted-ink hover:text-ink"
                              : "border-danger/35 bg-danger-soft text-danger hover:border-danger",
                          )}
                        >
                          <Square className="size-2.5" aria-hidden="true" />
                          <span>
                            {agent.status === "stopped" ? "Resume" : "Kill"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
