import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Network,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { SwarmAgentView } from "@shared/vscodeProtocol";

import {
  Badge,
  Button,
  Input,
  RayuProcessingMark,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useShellFormFactor } from "@/features/shell";
import { cn, formatDurationSeconds, operationAvailable } from "@/lib";

import {
  STALL_THRESHOLD_SECS,
  useProcesses,
  type ProcessFilterTab,
} from "../hooks/useProcesses";
import { ProcessOutputTail } from "./ProcessOutputTail";
import { ProcessRow } from "./ProcessRow";
import {
  SwarmAgentProgressPane,
  computeSwarmAgentPercent,
  isSwarmAgentActive,
} from "./SwarmAgentProgressPane";

export interface BackgroundProcessDrawerProps {
  /** Optional controlled open state. Defaults to rendering open when mounted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  initialSelectedTaskId?: string | null;
  stallThresholdSecs?: number;
  className?: string;
}

const FILTER_TABS: ReadonlyArray<{
  id: ProcessFilterTab;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "stalled", label: "Stalled" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

function SwarmAgentRow({
  agent,
  selected,
  onSelect,
  onStop,
  onResume,
}: {
  agent: SwarmAgentView;
  selected: boolean;
  onSelect: (agentId: string) => void;
  onStop: (agentId: string) => void;
  onResume: (agentId: string) => void;
}) {
  const active = isSwarmAgentActive(agent.status);
  const percent = computeSwarmAgentPercent(agent);
  const canControl = operationAvailable("swarm.kill") && agent.role !== "coordinator";
  const canResume =
    agent.status === "stopped" ||
    agent.status === "blocked" ||
    agent.status === "ready";

  const renderIcon = () => {
    if (agent.status === "running" || agent.status === "spawned") {
      return <RayuProcessingMark animated className="size-3.5 shrink-0" />;
    }
    if (agent.status === "blocked") {
      return <AlertTriangle className="size-3.5 shrink-0 text-warn" />;
    }
    if (agent.status === "completed") {
      return <Check className="size-3.5 shrink-0 text-brand-text" />;
    }
    if (agent.status === "failed" || agent.status === "crashed") {
      return <XCircle className="size-3.5 shrink-0 text-danger" />;
    }
    if (agent.status === "stopped") {
      return <Pause className="size-3.5 shrink-0 text-muted-ink" />;
    }
    return <Clock className="size-3.5 shrink-0 text-muted-ink" />;
  };

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      data-slot="swarm-agent-row"
      data-testid={`swarm-agent-row-${agent.agentId}`}
      data-status={agent.status}
      onClick={() => onSelect(agent.agentId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(agent.agentId);
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col gap-1.5 rounded-[9px] border px-2.5 py-2 text-left transition-colors outline-none",
        selected
          ? "border-premium bg-active text-ink shadow-bevel-surface"
          : "border-transparent bg-transparent text-body hover:border-hairline hover:bg-hover hover:text-ink",
      )}
    >
      {/* Line 1 */}
      <div className="flex min-w-0 items-center gap-1.5">
        {renderIcon()}
        <span className="grid size-4 shrink-0 place-items-center rounded-[3.5px] bg-info-soft text-info">
          <Network className="size-2.5" />
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-ink">
          {agent.label}
        </span>

        <Badge
          variant={
            agent.status === "blocked"
              ? "warn"
              : agent.status === "running" || agent.status === "spawned"
                ? "brand"
                : agent.status === "failed" || agent.status === "crashed"
                  ? "danger"
                  : agent.status === "completed"
                    ? "secondary"
                    : "outline"
          }
          className="h-4 shrink-0 px-1.5 text-[10px] font-medium capitalize"
        >
          {agent.status}
        </Badge>

        {typeof agent.elapsedSecs === "number" && (
          <span className="shrink-0 font-mono text-[10.5px] text-muted-ink tabular-nums">
            {formatDurationSeconds(agent.elapsedSecs)}
          </span>
        )}

        {canControl && (active || canResume) && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid={`swarm-agent-toggle-${agent.agentId}`}
            aria-label={active ? `Stop ${agent.label}` : `Resume ${agent.label}`}
            title={active ? "Stop worker" : "Resume worker"}
            onClick={(event) => {
              event.stopPropagation();
              const target = agent.sessionId || agent.agentId;
              if (active) onStop(target);
              else onResume(target);
            }}
            className={cn(
              "size-5 shrink-0 text-muted-ink",
              active
                ? "hover:bg-danger-soft hover:text-danger"
                : "hover:bg-brand-soft hover:text-brand-text",
            )}
          >
            {active ? (
              <Square className="size-2.5 fill-current" />
            ) : (
              <Play className="size-2.5 fill-current" />
            )}
          </Button>
        )}
      </div>

      {/* Line 2: Live intent & todo ratio */}
      <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-ink">
        <span className="min-w-0 flex-1 truncate">
          {agent.liveStatus ||
            agent.currentIntent ||
            agent.taskLabel ||
            (agent.role === "coordinator" ? "Coordinating swarm" : "Background worker")}
        </span>
        {typeof agent.todoCompleted === "number" &&
          typeof agent.todoTotal === "number" &&
          agent.todoTotal > 0 && (
            <span className="shrink-0 font-mono text-[10px] tabular-nums">
              {agent.todoCompleted}/{agent.todoTotal}
            </span>
          )}
      </div>

      {/* Line 3: Hairline progress bar */}
      {percent !== null ? (
        <div
          role="progressbar"
          aria-label={`${agent.label} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 w-full overflow-hidden rounded-full bg-inset"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              agent.status === "blocked"
                ? "bg-warn"
                : agent.status === "failed" || agent.status === "crashed"
                  ? "bg-danger"
                  : "bg-brand",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : active ? (
        <div
          role="progressbar"
          aria-label={`${agent.label} active`}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 w-full overflow-hidden rounded-full bg-inset"
        >
          <div className="h-full w-1/3 rounded-full bg-brand/70 motion-safe:animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}

export function BackgroundProcessDrawer({
  open,
  onOpenChange,
  onClose,
  initialSelectedTaskId,
  stallThresholdSecs = STALL_THRESHOLD_SECS,
  className,
}: BackgroundProcessDrawerProps) {
  const containerRef = React.useRef<HTMLElement | null>(null);
  const { formFactor } = useShellFormFactor(containerRef);

  const isVisible = open !== undefined ? open : true;

  const {
    activeSwarm,
    swarmAgents,
    filteredSwarmAgents,
    swarmSummary,
    groupedTasks,
    filteredTasks,
    counts,
    runningCount,
    stalledCount,
    finishedCount,
    selectedTask,
    selectedSwarmAgent,
    selectedOutput,
    scope,
    filter,
    searchQuery,
    followOutput,
    isLoadingList,
    isLoadingOutput,
    isRefreshingSwarm,
    nowMs,
    selectTask,
    selectSwarmAgent,
    toggleScope,
    setFilter,
    setSearchQuery,
    setFollowOutput,
    setDrawerOpen,
    refreshProcesses,
    refreshSwarm,
    fetchProcessOutput,
    cancelProcess,
    cleanupProcesses,
    openOutputFileInEditor,
    copyProcessOutput,
    stopSwarmAgent,
    resumeSwarmAgent,
    sendSwarmAgentDm,
    openSwarmView,
    openSwarmAgentChat,
  } = useProcesses({
    drawerOpen: isVisible,
    initialSelectedTaskId,
    stallThresholdSecs,
  });

  const [drawerHeightPx, setDrawerHeightPx] = React.useState<number>(360);
  const [compactViewMode, setCompactViewMode] = React.useState<"list" | "tail">(
    "list",
  );

  const handleClose = () => {
    setDrawerOpen(false);
    onOpenChange?.(false);
    onClose?.();
  };

  const handleResizeMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = drawerHeightPx;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const nextHeight = Math.max(220, Math.min(580, startHeight + deltaY));
      setDrawerHeightPx(nextHeight);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  if (!isVisible) {
    return null;
  }

  const isCompact = formFactor === "compact";
  const hasAnySelection = Boolean(selectedTask || selectedSwarmAgent);
  const totalFilteredCount = filteredTasks.length + filteredSwarmAgents.length;

  return (
    <aside
      ref={containerRef}
      aria-label="Background Processes"
      data-slot="background-process-drawer"
      data-testid="background-process-drawer"
      data-form-factor={formFactor}
      style={!isCompact ? { height: `${drawerHeightPx}px` } : undefined}
      className={cn(
        "@container/drawer flex w-full min-w-0 flex-col overflow-hidden border-t border-hairline bg-pane text-ink",
        isCompact ? "h-full min-h-[260px]" : "min-h-[220px]",
        className,
      )}
    >
      {/* Top drag-resize handle for Wide & Medium viewports */}
      {!isCompact && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize background process drawer"
          onMouseDown={handleResizeMouseDown}
          className="group flex h-1.5 w-full cursor-row-resize items-center justify-center hover:bg-hover"
        >
          <span className="h-0.5 w-8 rounded-full bg-hairline-strong transition-colors group-hover:bg-brand" />
        </div>
      )}

      {/* Drawer Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {runningCount > 0 || swarmSummary.running > 0 ? (
            <RayuProcessingMark animated className="size-3.5" />
          ) : stalledCount > 0 || swarmSummary.blocked > 0 ? (
            <AlertTriangle className="size-3.5 text-warn" />
          ) : null}
          <h2 className="truncate text-xs font-semibold tracking-tight text-ink">
            Background Processes
          </h2>

          <button
            type="button"
            onClick={toggleScope}
            title="Switch between current session and all background sessions"
            className="cursor-pointer rounded-full"
          >
            <Badge
              variant="outline"
              data-testid="drawer-session-scope-badge"
              className="h-5 shrink-0 px-1.5 text-[10px] font-normal text-muted-ink hover:border-premium hover:text-ink"
            >
              {scope === "all" ? "All sessions" : "Current session"}
            </Badge>
          </button>

          {runningCount > 0 && (
            <Badge
              variant="brand"
              data-testid="drawer-running-badge"
              className="h-5 px-2 text-[10px] tabular-nums"
            >
              {runningCount} running
            </Badge>
          )}

          {stalledCount > 0 && (
            <Badge
              variant="warn"
              data-testid="drawer-stalled-badge"
              className="h-5 gap-1 px-2 text-[10px] tabular-nums"
            >
              <AlertTriangle className="size-2.5 text-warn" />
              <span>{stalledCount} stalled</span>
            </Badge>
          )}

          {swarmAgents.length > 0 && (
            <Badge
              variant="info"
              data-testid="drawer-swarm-badge"
              className="h-5 gap-1 px-2 text-[10px] tabular-nums"
            >
              <Network className="size-2.5" />
              <span>
                {swarmSummary.active > 0
                  ? `${swarmSummary.active}/${swarmSummary.total} agents`
                  : `${swarmSummary.total} ${swarmSummary.total === 1 ? "agent" : "agents"}`}
                {swarmSummary.percent !== null ? ` · ${swarmSummary.percent}%` : ""}
              </span>
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {swarmAgents.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="drawer-open-swarm-button"
              onClick={openSwarmView}
              title="Open Swarm Mission Control"
            >
              <ExternalLink className="size-3" />
              <span className="hidden @min-[480px]/drawer:inline">Swarm</span>
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="drawer-cleanup-button"
            disabled={finishedCount === 0}
            onClick={() => {
              void cleanupProcesses();
            }}
            title="Dismiss completed and failed processes from list"
          >
            <Trash2 className="size-3" />
            <span>Clean Finished</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="drawer-refresh-button"
            disabled={isLoadingList || isRefreshingSwarm}
            onClick={() => {
              void refreshProcesses();
              void refreshSwarm();
            }}
            title="Refresh background processes and swarm agents"
          >
            <RefreshCw
              className={cn(
                "size-3",
                (isLoadingList || isRefreshingSwarm) && "motion-safe:animate-spin",
              )}
            />
            <span>Refresh</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid="drawer-close-button"
            aria-label="Close Background Processes"
            onClick={handleClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      {/* Filter Tabs + Search Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft bg-chrome/40 px-3 py-1.5">
        <div className="w-full max-w-full overflow-x-auto @min-[560px]/drawer:w-auto">
          <Tabs
            value={filter}
            onValueChange={(val) => setFilter(val as ProcessFilterTab)}
            className="w-max"
          >
            <TabsList className="h-7 bg-inset p-0.5">
              {FILTER_TABS.map((tab) => {
                const count = counts[tab.id];
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    data-testid={`process-filter-${tab.id}`}
                    className="h-6 shrink-0 gap-1 px-2 text-[11px] tabular-nums"
                  >
                    <span>{tab.label}</span>
                    <span className="rounded-full bg-pane px-1.5 py-0 text-[10px] text-muted-ink tabular-nums">
                      {count}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        <div className="relative min-w-0 flex-1 @min-[560px]/drawer:min-w-[180px] @min-[560px]/drawer:max-w-[260px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-ink" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter processes & agents..."
            data-testid="process-search-input"
            className="h-7 pl-7 pr-7 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear process search"
              onClick={() => setSearchQuery("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-ink hover:text-ink"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Main Split Body: Grouped Process & Swarm List + Live Inspector */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden @min-[680px]/drawer:flex-row">
        {/* Left Column: Live Swarm Agents + Grouped Background Processes */}
        {(!isCompact || compactViewMode === "list" || !hasAnySelection) && (
          <div
            data-testid="process-list-pane"
            className={cn(
              "flex min-h-0 flex-col overflow-y-auto border-b border-hairline p-2 @min-[680px]/drawer:w-[44%] @min-[680px]/drawer:max-w-[440px] @min-[680px]/drawer:border-r @min-[680px]/drawer:border-b-0",
              isCompact ? "flex-1" : "h-full",
            )}
          >
            {totalFilteredCount === 0 ? (
              <div
                data-testid="process-list-empty"
                className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-muted-ink"
              >
                {counts.all === 0
                  ? scope === "all"
                    ? "No background processes or swarm agents running."
                    : "No background processes in this session."
                  : "No background processes or agents match this filter."}
              </div>
            ) : (
              <div
                role="listbox"
                aria-label="Background process and agent list"
                className="flex flex-col gap-3"
              >
                {/* Live Background Swarm Agents Section */}
                {filteredSwarmAgents.length > 0 && (
                  <section
                    data-testid="process-group-swarm"
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between px-2 py-0.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-info uppercase">
                        <Network className="size-3" />
                        <span>
                          Swarm Agents
                          {activeSwarm?.label ? ` · ${activeSwarm.label}` : ""}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-faint tabular-nums">
                        {filteredSwarmAgents.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {filteredSwarmAgents.map((agent) => (
                        <SwarmAgentRow
                          key={agent.agentId}
                          agent={agent}
                          selected={selectedSwarmAgent?.agentId === agent.agentId}
                          onSelect={(agentId) => {
                            selectSwarmAgent(agentId);
                            if (isCompact) {
                              setCompactViewMode("tail");
                            }
                          }}
                          onStop={(agentId) => {
                            void stopSwarmAgent(agentId);
                          }}
                          onResume={(agentId) => {
                            void resumeSwarmAgent(agentId);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Grouped Background Shell / Tool / Runtime Processes */}
                {groupedTasks.map((section) => (
                  <section
                    key={section.group}
                    data-testid={`process-group-${section.group}`}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between px-2 py-0.5">
                      <span className="text-[10px] font-semibold tracking-wider text-muted-ink uppercase">
                        {section.label}
                      </span>
                      <span className="font-mono text-[10px] text-faint tabular-nums">
                        {section.tasks.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {section.tasks.map((task) => (
                        <ProcessRow
                          key={task.taskId}
                          task={task}
                          selected={selectedTask?.taskId === task.taskId}
                          nowMs={nowMs}
                          stallThresholdSecs={stallThresholdSecs}
                          onSelect={(taskId) => {
                            selectTask(taskId);
                            if (isCompact) {
                              setCompactViewMode("tail");
                            }
                          }}
                          onInspect={(taskId) => {
                            selectTask(taskId);
                            if (isCompact) {
                              setCompactViewMode("tail");
                            }
                          }}
                          onStop={(taskId) => {
                            void cancelProcess(taskId);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Right Column: Live Swarm Agent Inspector OR Live Process Output Tail */}
        {(!isCompact || compactViewMode === "tail") && (
          <div
            data-testid="process-output-pane"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2.5"
          >
            {isCompact && compactViewMode === "tail" && hasAnySelection && (
              <div className="mb-1.5 flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  data-testid="compact-back-to-list"
                  onClick={() => setCompactViewMode("list")}
                >
                  <ArrowLeft className="size-3" />
                  <span>Back to list</span>
                </Button>
              </div>
            )}

            {selectedSwarmAgent ? (
              <SwarmAgentProgressPane
                agent={selectedSwarmAgent}
                swarmLabel={activeSwarm?.label}
                isRefreshing={isRefreshingSwarm}
                onRefresh={() => {
                  void refreshSwarm();
                }}
                onOpenChat={openSwarmAgentChat}
                onOpenSwarmView={openSwarmView}
                onOpenFile={openOutputFileInEditor}
                onStopAgent={stopSwarmAgent}
                onResumeAgent={resumeSwarmAgent}
                onSendDm={sendSwarmAgentDm}
              />
            ) : (
              <ProcessOutputTail
                task={selectedTask}
                output={selectedOutput}
                follow={followOutput}
                isLoading={isLoadingOutput}
                nowMs={nowMs}
                stallThresholdSecs={stallThresholdSecs}
                onFollowChange={setFollowOutput}
                onRefresh={() => {
                  if (selectedTask) {
                    void fetchProcessOutput(selectedTask.taskId);
                  }
                }}
                onCopy={copyProcessOutput}
                onOpenFile={openOutputFileInEditor}
                onStop={(taskId) => {
                  void cancelProcess(taskId);
                }}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
