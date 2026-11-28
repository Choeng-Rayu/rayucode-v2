import { useOperationAvailable } from "@/lib/operation-result";
import * as React from "react";
import {
  ChevronDown,
  Maximize2,
  Network,
  Pause,
  Play,
  Plus,
  Square,
} from "lucide-react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  SwarmSkeleton,
} from "@/components/ui";
import { useShellFormFactor, useShellNavigation } from "@/features/shell";
import { cn, useAppStore } from "@/lib";

import {
  useSwarm,
  type SwarmCompactPanel,
  type SwarmLedgerTab,
  type SwarmStatusView,
  type SwarmSummaryView,
} from "../hooks/useSwarm";
import { AgentInspector } from "./AgentInspector";
import { AgentRoster } from "./AgentRoster";
import { CoordinationLedger } from "./CoordinationLedger";
import { SpawnWorkerBar } from "./SpawnWorkerBar";
import { SwarmLaunchpad } from "./SwarmLaunchpad";
import { SwarmTelemetryStrip } from "./SwarmTelemetryStrip";

export interface SwarmViewProps {
  initialSwarm?: SwarmStatusView | null;
  initialSwarms?: SwarmSummaryView[];
  startInLaunchpad?: boolean;
  className?: string;
}

export function SwarmView({
  initialSwarm,
  initialSwarms,
  startInLaunchpad = false,
  className,
}: SwarmViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const surface = useAppStore((s) => s.surface);
  const { width } = useShellFormFactor(containerRef);
  const { openInEditorPanel } = useShellNavigation();

  const isCompactSurface = surface === "sidebar" || width < 640;

  const canSpawn = useOperationAvailable("swarm.spawn");
  const canPauseAll = useOperationAvailable("swarm.pauseAll");
  const canKill = useOperationAvailable("swarm.kill");
  const canSalvage = useOperationAvailable("swarm.salvage");
  const canDm = useOperationAvailable("swarm.dm");
  const canBroadcast = useOperationAvailable("swarm.broadcast");
  const canDecidePlan = useOperationAvailable("swarm.planDecide");

  const {
    swarm,
    swarms,
    selectSwarm,
    showLaunchpad,
    setShowLaunchpad,
    isLoading,
    isError,
    error,
    refetch,
    telemetry,
    selectedAgentId,
    selectedAgent,
    selectAgent,
    selectedAgentTodos,
    selectedAgentEntries,
    boardFilter,
    setBoardFilter,
    workerFilter,
    setWorkerFilter,
    filteredBoardMessages,
    availableModels,
    spawnWorker,
    launchPreset,
    isSpawning,
    killAgent,
    salvageAgent,
    switchAgentModel,
    isMutatingAgent,
    pauseAll,
    stopSwarm,
    isPausingAll,
    sendDm,
    isSendingDm,
    sendBroadcast,
    isSendingBroadcast,
    decidePlan,
    isDecidingPlan,
    openWorktreeWindow,
    openFileInEditor,
    openDiffInEditor,
    openAgentSessionInChat,
  } = useSwarm({
    initialSwarm,
    initialSwarms,
    startInLaunchpad,
  });

  const [spawnBarOpen, setSpawnBarOpen] = React.useState(false);
  const [ledgerTab, setLedgerTab] = React.useState<SwarmLedgerTab>("board");
  const [compactPanel, setCompactPanel] =
    React.useState<SwarmCompactPanel>("roster");

  const handleSelectAgent = React.useCallback(
    (agentId: string) => {
      selectAgent(agentId);
      if (isCompactSurface) {
        setCompactPanel("inspector");
      }
    },
    [selectAgent, isCompactSurface],
  );

  const handleSendDm = React.useCallback(
    async (agentId: string, message: string) => {
      const result = await sendDm(agentId, message);
      if (result.ok) {
        setLedgerTab("board");
      }
      return result;
    },
    [sendDm],
  );

  const handleJumpToPlanProposals = React.useCallback(() => {
    setLedgerTab("plan");
    if (isCompactSurface) {
      setCompactPanel("plan");
    }
  }, [isCompactSurface]);

  if (isLoading) {
    return <SwarmSkeleton />;
  }

  if (isError) {
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
    );
  }

  const existingAgentNames = (swarm?.agents ?? []).map((a) => a.label);
  const isIdle = !swarm || swarm.agents.length === 0 || showLaunchpad;

  if (isIdle) {
    return (
      <div
        ref={containerRef}
        data-slot="swarm-view"
        data-testid="swarm-view"
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto @container/swarm",
          className,
        )}
      >
        {isCompactSurface && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-chrome px-3 py-2">
            <span className="text-xs font-medium text-muted-ink">
              Swarm Mission Control
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="swarm-expand-editor-btn"
              onClick={() => openInEditorPanel("swarm")}
            >
              <Maximize2 className="size-3" aria-hidden="true" />
              <span>Expand to Full Editor Panel</span>
            </Button>
          </div>
        )}

        {!canSpawn ? (
          <p className="p-4 text-sm text-muted-ink">Start a swarm from a Rayu session. This view displays the engine’s workers and coordination state.</p>
        ) : <SwarmLaunchpad
          existingAgentNames={existingAgentNames}
          availableModels={availableModels}
          isSubmitting={isSpawning}
          onSpawnWorker={spawnWorker}
          onLaunchPreset={launchPreset}
        />}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-slot="swarm-view"
      data-testid="swarm-view"
      data-surface={isCompactSurface ? "compact" : "wide"}
      className={cn(
        "h-full min-h-0 w-full overflow-x-hidden overflow-y-auto @container/swarm",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1120px] flex-col gap-4",
          isCompactSurface ? "px-3 py-3" : "px-[26px] pt-5 pb-8",
        )}
      >
        {/* Top Header with Multi-Swarm Switcher, Compact Expand CTA, Spawn & Pause/Stop */}
        <div
          data-slot="swarm-header"
          data-testid="swarm-header"
          className="flex flex-wrap items-center justify-between gap-2.5"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-ink">
              <Network
                className="size-4 shrink-0 text-brand-text"
                aria-hidden="true"
              />
              <h1 className="m-0 truncate text-[15px] font-semibold tracking-tight text-ink">
                {swarm.label}
              </h1>
            </div>

            {/* Multi-Swarm Switcher Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="swarm-switcher-trigger"
                  className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-hairline bg-pane px-2 font-mono text-[11px] text-muted-ink transition-colors hover:border-premium hover:text-ink"
                >
                  <span>Switch swarm</span>
                  {swarms.length > 1 && (
                    <span className="rounded-full bg-brand-softer px-1.5 text-[10px] text-brand-text">
                      {swarms.length}
                    </span>
                  )}
                  <ChevronDown className="size-3" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Active Swarms</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {swarms.map((item) => (
                  <DropdownMenuItem
                    key={item.swarmId}
                    data-testid={`switch-swarm-${item.swarmId}`}
                    onSelect={() => selectSwarm(item.swarmId)}
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="font-medium text-ink">{item.label}</span>
                      <span className="font-mono text-[11px] text-muted-ink">
                        {item.memberCount} agents
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="open-launchpad-menu-item"
                  onSelect={() => setShowLaunchpad(true)}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>New Swarm Launchpad...</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="font-mono text-xs text-muted-ink">
              {swarm.swarmId} · Plan {telemetry.planVersionShort}
            </span>
          </div>

          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            {isCompactSurface && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="swarm-expand-editor-btn"
                onClick={() => openInEditorPanel("swarm")}
              >
                <Maximize2 className="size-3.5" aria-hidden="true" />
                <span>Expand to Full Editor Panel</span>
              </Button>
            )}

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!canSpawn}
              aria-expanded={spawnBarOpen}
              onClick={() => setSpawnBarOpen((prev) => !prev)}
              data-slot="toggle-spawn-worker-btn"
              data-testid="swarm-toggle-spawn-btn"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Spawn worker</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPausingAll || !canPauseAll}
              onClick={() => void pauseAll()}
              data-slot="toggle-pause-all-btn"
              data-testid="swarm-pause-all-btn"
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

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPausingAll || !canPauseAll}
              onClick={() => void stopSwarm()}
              data-testid="swarm-stop-btn"
            >
              <Square className="size-3.5" aria-hidden="true" />
              <span>Stop Swarm</span>
            </Button>
          </div>
        </div>

        {/* Single-Line SwarmTelemetryStrip */}
        <SwarmTelemetryStrip
          telemetry={telemetry}
          conflicts={swarm.conflicts}
          compact={isCompactSurface}
          onJumpToPlanProposals={handleJumpToPlanProposals}
          onOpenFile={openFileInEditor}
        />

        {/* Inline Spawn Worker Bar */}
        {spawnBarOpen && (
          <SpawnWorkerBar
            existingAgentNames={existingAgentNames}
            availableModels={availableModels}
            isSubmitting={isSpawning}
            onSpawn={spawnWorker}
            onCancel={() => setSpawnBarOpen(false)}
          />
        )}

        {/* Responsive Layout: Compact Sidebar Master-Detail Tabs vs Wide Two-Column Split */}
        {isCompactSurface ? (
          <div className="flex flex-col gap-3">
            <div
              role="tablist"
              aria-label="Compact swarm panels"
              className="flex items-center gap-1 overflow-x-auto rounded-[10px] border border-hairline bg-pane p-1"
            >
              {(
                [
                  { id: "roster", label: `Roster (${swarm.agents.length})` },
                  {
                    id: "inspector",
                    label: `Inspector (${selectedAgent?.label ?? "none"})`,
                  },
                  { id: "board", label: `Board (${swarm.board.length})` },
                  {
                    id: "plan",
                    label: `Plan (${telemetry.planVersionShort})`,
                  },
                  {
                    id: "worktrees",
                    label: `Worktrees (${swarm.worktrees.length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={compactPanel === tab.id}
                  data-testid={`compact-swarm-tab-${tab.id}`}
                  onClick={() => {
                    setCompactPanel(tab.id);
                    if (
                      tab.id === "board" ||
                      tab.id === "plan" ||
                      tab.id === "worktrees"
                    ) {
                      setLedgerTab(tab.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer rounded-[7px] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    compactPanel === tab.id
                      ? "bg-active text-ink"
                      : "text-muted-ink hover:text-ink",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {compactPanel === "roster" && (
              <AgentRoster
                agents={swarm.agents}
                selectedAgentId={selectedAgentId}
                availableModels={availableModels}
                onSelectAgent={handleSelectAgent}
                onKillAgent={canKill ? (id) => void killAgent(id) : undefined}
                onSwitchModel={canDm ? (id, m) => void switchAgentModel(id, m) : undefined}
              />
            )}

            {compactPanel === "inspector" && (
              <AgentInspector
                agent={selectedAgent}
                todos={selectedAgentTodos}
                traceEntries={selectedAgentEntries}
                availableModels={availableModels}
                isMutatingAgent={isMutatingAgent}
                isSendingDm={isSendingDm}
                showBackButton
                onBackToRoster={() => setCompactPanel("roster")}
                onOpenChat={openAgentSessionInChat}
                onKillAgent={canKill ? killAgent : undefined}
                onSalvageAgent={canSalvage ? salvageAgent : undefined}
                onSwitchModel={canDm ? switchAgentModel : undefined}
                onSendDm={canDm ? handleSendDm : undefined}
                onOpenFile={openFileInEditor}
                onOpenWorktreeWindow={(path) => void openWorktreeWindow(path)}
              />
            )}

            {(compactPanel === "board" ||
              compactPanel === "plan" ||
              compactPanel === "worktrees") && (
              <CoordinationLedger
                messages={filteredBoardMessages}
                agents={swarm.agents}
                planItems={swarm.planItems}
                pendingProposals={swarm.pendingProposals}
                worktrees={swarm.worktrees}
                planVersionShort={telemetry.planVersionShort}
                activeTab={compactPanel}
                onTabChange={(next) => {
                  setLedgerTab(next);
                  setCompactPanel(next);
                }}
                boardFilter={boardFilter}
                onBoardFilterChange={setBoardFilter}
                workerFilter={workerFilter}
                onWorkerFilterChange={setWorkerFilter}
                onDecidePlan={canDecidePlan ? decidePlan : undefined}
                isDecidingPlan={isDecidingPlan}
                onSendBroadcast={canBroadcast ? sendBroadcast : undefined}
                isSendingBroadcast={isSendingBroadcast}
                onOpenWorktreeWindow={(path) => void openWorktreeWindow(path)}
                onViewWorktreeDiff={openDiffInEditor}
              />
            )}
          </div>
        ) : (
          <>
            {/* Wide Two-Column Agent Roster + Live Worker Inspector */}
            <div className="grid grid-cols-1 items-start gap-4 @min-[780px]/swarm:grid-cols-[minmax(280px,350px)_minmax(0,1fr)]">
              <AgentRoster
                agents={swarm.agents}
                selectedAgentId={selectedAgentId}
                availableModels={availableModels}
                onSelectAgent={handleSelectAgent}
                onKillAgent={canKill ? (id) => void killAgent(id) : undefined}
                onSwitchModel={canDm ? (id, m) => void switchAgentModel(id, m) : undefined}
              />

              <AgentInspector
                agent={selectedAgent}
                todos={selectedAgentTodos}
                traceEntries={selectedAgentEntries}
                availableModels={availableModels}
                isMutatingAgent={isMutatingAgent}
                isSendingDm={isSendingDm}
                onOpenChat={openAgentSessionInChat}
                onKillAgent={canKill ? killAgent : undefined}
                onSalvageAgent={canSalvage ? salvageAgent : undefined}
                onSwitchModel={canDm ? switchAgentModel : undefined}
                onSendDm={canDm ? handleSendDm : undefined}
                onOpenFile={openFileInEditor}
                onOpenWorktreeWindow={(path) => void openWorktreeWindow(path)}
              />
            </div>

            {/* Bottom Tabbed Coordination Ledger */}
            <CoordinationLedger
              messages={filteredBoardMessages}
              agents={swarm.agents}
              planItems={swarm.planItems}
              pendingProposals={swarm.pendingProposals}
              worktrees={swarm.worktrees}
              planVersionShort={telemetry.planVersionShort}
              activeTab={ledgerTab}
              onTabChange={setLedgerTab}
              boardFilter={boardFilter}
              onBoardFilterChange={setBoardFilter}
              workerFilter={workerFilter}
              onWorkerFilterChange={setWorkerFilter}
              onDecidePlan={canDecidePlan ? decidePlan : undefined}
              isDecidingPlan={isDecidingPlan}
              onSendBroadcast={canBroadcast ? sendBroadcast : undefined}
              isSendingBroadcast={isSendingBroadcast}
              onOpenWorktreeWindow={(path) => void openWorktreeWindow(path)}
              onViewWorktreeDiff={openDiffInEditor}
            />
          </>
        )}
      </div>
    </div>
  );
}
