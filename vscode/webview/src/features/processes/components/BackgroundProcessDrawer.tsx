import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

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
import { cn } from "@/lib";

import {
  STALL_THRESHOLD_SECS,
  useProcesses,
  type ProcessFilterTab,
} from "../hooks/useProcesses";
import { ProcessOutputTail } from "./ProcessOutputTail";
import { ProcessRow } from "./ProcessRow";

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
    groupedTasks,
    filteredTasks,
    counts,
    runningCount,
    stalledCount,
    finishedCount,
    selectedTask,
    selectedOutput,
    filter,
    searchQuery,
    followOutput,
    isLoadingList,
    isLoadingOutput,
    nowMs,
    selectTask,
    setFilter,
    setSearchQuery,
    setFollowOutput,
    setDrawerOpen,
    refreshProcesses,
    fetchProcessOutput,
    cancelProcess,
    cleanupProcesses,
    openOutputFileInEditor,
    openProcessTerminal,
    copyProcessOutput,
  } = useProcesses({
    drawerOpen: isVisible,
    initialSelectedTaskId,
    stallThresholdSecs,
  });

  const [drawerHeightPx, setDrawerHeightPx] = React.useState<number>(340);
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

  return (
    <aside
      ref={containerRef}
      aria-label="Background Processes"
      data-slot="background-process-drawer"
      data-testid="background-process-drawer"
      data-form-factor={formFactor}
      style={!isCompact ? { height: `${drawerHeightPx}px` } : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden border-t border-hairline bg-pane text-ink",
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
        <div className="flex min-w-0 items-center gap-2">
          {runningCount > 0 ? (
            <RayuProcessingMark animated className="size-3.5" />
          ) : stalledCount > 0 ? (
            <AlertTriangle className="size-3.5 text-warn" />
          ) : null}
          <h2 className="truncate text-xs font-semibold tracking-tight text-ink">
            Background Processes
          </h2>

          <Badge
            variant="outline"
            data-testid="drawer-session-scope-badge"
            className="h-5 shrink-0 px-1.5 text-[10px] font-normal text-muted-ink"
          >
            Current session
          </Badge>

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
        </div>

        <div className="flex items-center gap-1.5">
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
            disabled={isLoadingList}
            onClick={() => {
              void refreshProcesses();
            }}
            title="Refresh background processes"
          >
            <RefreshCw
              className={cn("size-3", isLoadingList && "animate-spin")}
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
        <div className="w-full max-w-full overflow-x-auto sm:w-auto">
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

        <div className="relative min-w-0 flex-1 sm:min-w-[180px] sm:max-w-[260px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-ink" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter processes..."
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

      {/* Main Split Body: Grouped Process List + Live Output Tail */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* Left Column: Grouped Process List */}
        {(!isCompact || compactViewMode === "list" || !selectedTask) && (
          <div
            data-testid="process-list-pane"
            className={cn(
              "flex min-h-0 flex-col overflow-y-auto border-b border-hairline p-2 md:w-[44%] md:max-w-[440px] md:border-r md:border-b-0",
              isCompact ? "flex-1" : "h-full",
            )}
          >
            {filteredTasks.length === 0 ? (
              <div
                data-testid="process-list-empty"
                className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-muted-ink"
              >
                {counts.all === 0
                  ? "No background processes in this session."
                  : "No background processes match this filter."}
              </div>
            ) : (
              <div
                role="listbox"
                aria-label="Background process list"
                className="flex flex-col gap-3"
              >
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

        {/* Right Column: Live Output Tail */}
        {(!isCompact || compactViewMode === "tail") && (
          <div
            data-testid="process-output-pane"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2.5"
          >
            {isCompact && compactViewMode === "tail" && selectedTask && (
              <div className="mb-1.5 flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  data-testid="compact-back-to-list"
                  onClick={() => setCompactViewMode("list")}
                >
                  <ArrowLeft className="size-3" />
                  <span>Back to process list</span>
                </Button>
              </div>
            )}

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
              onOpenTerminal={openProcessTerminal}
              onStop={(taskId) => {
                void cancelProcess(taskId);
              }}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
