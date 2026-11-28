import * as React from "react";
import type {
  BackgroundProcessGroup,
  BackgroundProcessOutputView,
  BackgroundProcessStatus,
  BackgroundProcessView,
  SwarmAgentView,
  SwarmStatusView,
} from "@shared/vscodeProtocol";

import {
  callRpc,
  createStreamBatcher,
  isVsCodeWebview,
  onHarnessFrame,
  onHostMessage,
  postToHost,
  useAppStore,
} from "@/lib";

export type ProcessScopeMode = "session" | "all";

export type ProcessFilterTab =
  | "all"
  | "running"
  | "stalled"
  | "completed"
  | "failed";

export const STALL_THRESHOLD_SECS = 45;
export const DEFAULT_OUTPUT_MAX_BYTES = 131_072; // 128 KB bounded tail
export const DEFAULT_FOLLOW_POLL_MS = 1_500;

export interface ProcessGroupSection {
  group: BackgroundProcessGroup;
  label: string;
  tasks: BackgroundProcessView[];
}

const GROUP_PRIORITY_ORDER: ReadonlyArray<{
  group: BackgroundProcessGroup;
  label: string;
}> = [
  { group: "shells", label: "Shells & Builds" },
  { group: "agents", label: "Agents & Swarm" },
  { group: "runtime", label: "Overnight & Runtime Jobs" },
];

export function isProcessActive(status: BackgroundProcessStatus): boolean {
  return status === "running" || status === "stalled";
}

export function isProcessStalled(
  task: BackgroundProcessView,
  thresholdSecs: number = STALL_THRESHOLD_SECS,
): boolean {
  if (task.status === "stalled") return true;
  if (
    task.status === "running" &&
    typeof task.stallQuietSecs === "number" &&
    task.stallQuietSecs >= thresholdSecs
  ) {
    return true;
  }
  return false;
}

export function getStallQuietSeconds(
  task: BackgroundProcessView,
  nowMs: number = Date.now(),
): number {
  if (typeof task.stallQuietSecs === "number" && task.stallQuietSecs > 0) {
    return Math.round(task.stallQuietSecs);
  }
  const elapsedQuiet = Math.round(Math.max(0, nowMs - task.updatedAtMs) / 1000);
  return elapsedQuiet > 0 ? elapsedQuiet : 60;
}

export function getProcessElapsedSeconds(
  task: BackgroundProcessView,
  nowMs: number = Date.now(),
): number {
  if (!isProcessActive(task.status) && typeof task.durationSecs === "number") {
    return Math.max(1, Math.round(task.durationSecs));
  }
  const endMs = isProcessActive(task.status) ? nowMs : task.updatedAtMs;
  const computed = Math.round(Math.max(0, endMs - task.startedAtMs) / 1000);
  if (computed > 0) return computed;
  if (typeof task.durationSecs === "number" && task.durationSecs > 0) {
    return Math.round(task.durationSecs);
  }
  return 1;
}

export function matchesProcessFilter(
  task: BackgroundProcessView,
  filter: ProcessFilterTab,
  thresholdSecs: number = STALL_THRESHOLD_SECS,
): boolean {
  const stalled = isProcessStalled(task, thresholdSecs);
  switch (filter) {
    case "all":
      return true;
    case "running":
      return task.status === "running" && !stalled;
    case "stalled":
      return stalled;
    case "completed":
      return task.status === "completed" || task.status === "superseded";
    case "failed":
      return task.status === "failed";
    default:
      return true;
  }
}

export function matchesProcessSearch(
  task: BackgroundProcessView,
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    task.displayName.toLowerCase().includes(trimmed) ||
    task.toolName.toLowerCase().includes(trimmed) ||
    task.taskId.toLowerCase().includes(trimmed) ||
    task.summary.toLowerCase().includes(trimmed) ||
    task.group.toLowerCase().includes(trimmed)
  );
}

export function groupProcesses(
  tasks: BackgroundProcessView[],
): ProcessGroupSection[] {
  const sections: ProcessGroupSection[] = [];
  for (const spec of GROUP_PRIORITY_ORDER) {
    const items = tasks.filter((t) => t.group === spec.group);
    if (items.length > 0) {
      sections.push({
        group: spec.group,
        label: spec.label,
        tasks: items,
      });
    }
  }
  return sections;
}

/**
 * Shared 1-second tick hook so all visible running/stalled process durations
 * advance in lockstep and zero timers run when all tasks are idle.
 */
export function useProcessSecondTick(active: boolean): number {
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => clearInterval(timer);
  }, [active]);

  return nowMs;
}

// Module-level shared state for selected task / swarm agent so DockBar and Drawer stay synchronized
let sharedSelectedTaskId: string | null = null;
let sharedSelectedSwarmAgentId: string | null = null;
const selectedTaskListeners = new Set<(taskId: string | null) => void>();
const selectedSwarmListeners = new Set<(agentId: string | null) => void>();

function setSharedSelectedTaskId(next: string | null): void {
  sharedSelectedTaskId = next;
  if (next !== null) {
    sharedSelectedSwarmAgentId = null;
    for (const listener of selectedSwarmListeners) {
      listener(null);
    }
  }
  for (const listener of selectedTaskListeners) {
    listener(next);
  }
}

function setSharedSelectedSwarmAgentId(next: string | null): void {
  sharedSelectedSwarmAgentId = next;
  if (next !== null) {
    sharedSelectedTaskId = null;
    for (const listener of selectedTaskListeners) {
      listener(null);
    }
  }
  for (const listener of selectedSwarmListeners) {
    listener(next);
  }
}

export function __resetProcessesStateForTest(): void {
  sharedSelectedTaskId = null;
  sharedSelectedSwarmAgentId = null;
  lastAltBHandledAtMs = 0;
}

export function isSwarmAgentRunning(agent: SwarmAgentView): boolean {
  return (
    agent.status === "running" ||
    agent.status === "spawned" ||
    agent.status === "blocked"
  );
}

export function matchesSwarmAgentFilter(
  agent: SwarmAgentView,
  filter: ProcessFilterTab,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return agent.status === "running" || agent.status === "spawned" || agent.status === "ready";
    case "stalled":
      return agent.status === "blocked";
    case "completed":
      return agent.status === "completed" || agent.status === "stopped";
    case "failed":
      return agent.status === "failed" || agent.status === "crashed";
    default:
      return true;
  }
}

export function matchesSwarmAgentSearch(
  agent: SwarmAgentView,
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    agent.label.toLowerCase().includes(trimmed) ||
    agent.agentId.toLowerCase().includes(trimmed) ||
    (agent.currentIntent?.toLowerCase().includes(trimmed) ?? false) ||
    (agent.taskLabel?.toLowerCase().includes(trimmed) ?? false) ||
    (agent.model?.toLowerCase().includes(trimmed) ?? false) ||
    (agent.liveStatus?.toLowerCase().includes(trimmed) ?? false)
  );
}

let lastAltBHandledAtMs = 0;

function extractProgressPatchFromFrame(
  frame: Record<string, unknown>,
): Partial<BackgroundProcessView> & { taskId: string } | null {
  const frameType = String(frame.ev ?? frame.type ?? frame.event ?? "");
  if (
    frameType !== "background_progress" &&
    frameType !== "BackgroundProgress" &&
    frameType !== "rayucode.processes.progress"
  ) {
    return null;
  }
  const taskId =
    typeof frame.taskId === "string"
      ? frame.taskId
      : typeof frame.task_id === "string"
        ? frame.task_id
        : null;
  if (!taskId) return null;

  const patch: Partial<BackgroundProcessView> & { taskId: string } = {
    taskId,
    updatedAtMs:
      typeof frame.updatedAtMs === "number"
        ? frame.updatedAtMs
        : typeof frame.updated_at_ms === "number"
          ? frame.updated_at_ms
          : Date.now(),
  };

  if (
    frame.status === "running" ||
    frame.status === "stalled" ||
    frame.status === "completed" ||
    frame.status === "failed" ||
    frame.status === "superseded"
  ) {
    patch.status = frame.status;
  } else if (frame.done === true) {
    patch.status = "completed";
  }
  if (typeof frame.percent === "number") {
    patch.percent = frame.percent;
    patch.progressKind = "determinate";
  }
  if (typeof frame.current === "number") patch.current = frame.current;
  if (typeof frame.total === "number") patch.total = frame.total;
  if (typeof frame.unit === "string") patch.unit = frame.unit;
  if (typeof frame.summary === "string") patch.summary = frame.summary;
  if (typeof frame.etaSeconds === "number") {
    patch.etaSeconds = frame.etaSeconds;
  } else if (typeof frame.eta_seconds === "number") {
    patch.etaSeconds = frame.eta_seconds;
  }
  if (typeof frame.exitCode === "number") {
    patch.exitCode = frame.exitCode;
  } else if (typeof frame.exit_code === "number") {
    patch.exitCode = frame.exit_code;
  }
  if (typeof frame.outputFile === "string") {
    patch.outputFile = frame.outputFile;
  } else if (typeof frame.output_file === "string") {
    patch.outputFile = frame.output_file;
  }
  if (typeof frame.displayName === "string" && frame.displayName.trim()) {
    patch.displayName = frame.displayName.trim();
  } else if (typeof frame.display_name === "string" && frame.display_name.trim()) {
    patch.displayName = frame.display_name.trim();
  } else if (typeof frame.command === "string" && frame.command.trim()) {
    patch.displayName = frame.command.trim();
  }
  if (typeof frame.toolName === "string" && frame.toolName.trim()) {
    patch.toolName = frame.toolName.trim();
  } else if (typeof frame.tool_name === "string" && frame.tool_name.trim()) {
    patch.toolName = frame.tool_name.trim();
  }
  if (
    frame.group === "shells" ||
    frame.group === "agents" ||
    frame.group === "runtime"
  ) {
    patch.group = frame.group;
  }
  if (typeof frame.stallQuietSecs === "number") {
    patch.stallQuietSecs = frame.stallQuietSecs;
  } else if (typeof frame.stall_quiet_secs === "number") {
    patch.stallQuietSecs = frame.stall_quiet_secs;
  }

  return patch;
}

export interface UseProcessesOptions {
  /** Override drawer open state when rendered standalone in tests. */
  drawerOpen?: boolean;
  /** Initial selected task ID. */
  initialSelectedTaskId?: string | null;
  /** Polling interval in ms when drawer is open and Follow is active. */
  followPollIntervalMs?: number;
  /** Stall threshold in seconds for running tasks without output. */
  stallThresholdSecs?: number;
  /** Enable global Alt+B shortcut listener (default true). */
  enableAltBShortcut?: boolean;
}

export function useProcesses(options: UseProcessesOptions = {}) {
  const {
    drawerOpen: drawerOpenProp,
    initialSelectedTaskId,
    followPollIntervalMs = DEFAULT_FOLLOW_POLL_MS,
    stallThresholdSecs = STALL_THRESHOLD_SECS,
    enableAltBShortcut = true,
  } = options;

  const rawTasks = useAppStore((s) => s.backgroundTasks);
  const activeSwarm = useAppStore((s) => s.activeSwarm);
  const storeDrawerOpen = useAppStore((s) => s.backgroundDrawerOpen);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setBackgroundTasks = useAppStore((s) => s.setBackgroundTasks);
  const setActiveSwarm = useAppStore((s) => s.setActiveSwarm);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);
  const toggleBackgroundDrawer = useAppStore((s) => s.toggleBackgroundDrawer);
  const openSettingsSection = useAppStore((s) => s.openSettingsSection);
  const setActiveSession = useAppStore((s) => s.setActiveSession);

  const [scope, setScope] = React.useState<ProcessScopeMode>("session");
  const [allScopeTasks, setAllScopeTasks] = React.useState<BackgroundProcessView[]>([]);
  const [isRefreshingSwarm, setIsRefreshingSwarm] = React.useState(false);

  const tasks = React.useMemo(() => {
    if (scope === "all") {
      return allScopeTasks.length > 0 ? allScopeTasks : rawTasks;
    }
    return !activeSessionId
      ? []
      : rawTasks.filter((t) => t.sessionId === activeSessionId);
  }, [activeSessionId, allScopeTasks, rawTasks, scope]);

  const swarmAgents = React.useMemo<SwarmAgentView[]>(() => {
    const agents = activeSwarm?.agents ?? [];
    if (agents.length === 0) return [];
    // Sort workers with active/blocked first, coordinator last so real background work stands out
    return [...agents].sort((a, b) => {
      const aWorker = a.role === "worker" ? 1 : 0;
      const bWorker = b.role === "worker" ? 1 : 0;
      if (aWorker !== bWorker) return bWorker - aWorker;
      const aBlocked = a.status === "blocked" ? 1 : 0;
      const bBlocked = b.status === "blocked" ? 1 : 0;
      if (aBlocked !== bBlocked) return bBlocked - aBlocked;
      const aActive = isSwarmAgentRunning(a) ? 1 : 0;
      const bActive = isSwarmAgentRunning(b) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
    });
  }, [activeSwarm]);

  const isDrawerOpen =
    drawerOpenProp !== undefined ? drawerOpenProp : storeDrawerOpen;

  const [selectedSwarmAgentId, setSelectedSwarmAgentIdState] = React.useState<
    string | null
  >(() => sharedSelectedSwarmAgentId);

  const [selectedTaskId, setSelectedTaskIdState] = React.useState<string | null>(
    () => {
      if (initialSelectedTaskId) return initialSelectedTaskId;
      if (sharedSelectedTaskId) return sharedSelectedTaskId;
      const preferred =
        tasks.find((t) => isProcessStalled(t, stallThresholdSecs)) ??
        tasks.find((t) => t.status === "running") ??
        tasks[0];
      return preferred?.taskId ?? null;
    },
  );
  const [filter, setFilter] = React.useState<ProcessFilterTab>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [followOutput, setFollowOutput] = React.useState<boolean>(true);
  const [outputsByTaskId, setOutputsByTaskId] = React.useState<
    Record<string, BackgroundProcessOutputView>
  >({});
  const [isLoadingList, setIsLoadingList] = React.useState<boolean>(false);
  const [isLoadingOutput, setIsLoadingOutput] = React.useState<boolean>(false);

  const selectTask = React.useCallback((taskId: string | null) => {
    setSharedSelectedTaskId(taskId);
    setSelectedTaskIdState(taskId);
    if (taskId !== null) {
      setSelectedSwarmAgentIdState(null);
    }
  }, []);

  const selectSwarmAgent = React.useCallback((agentId: string | null) => {
    setSharedSelectedSwarmAgentId(agentId);
    setSelectedSwarmAgentIdState(agentId);
    if (agentId !== null) {
      setSelectedTaskIdState(null);
    }
  }, []);

  React.useEffect(() => {
    const taskListener = (nextId: string | null) => {
      setSelectedTaskIdState(nextId);
    };
    const swarmListener = (nextId: string | null) => {
      setSelectedSwarmAgentIdState(nextId);
    };
    selectedTaskListeners.add(taskListener);
    selectedSwarmListeners.add(swarmListener);
    return () => {
      selectedTaskListeners.delete(taskListener);
      selectedSwarmListeners.delete(swarmListener);
    };
  }, []);

  // Subscribe to host push snapshots and 16ms batched harness BackgroundProgress frames
  React.useEffect(() => {
    const batcher = createStreamBatcher<
      Partial<BackgroundProcessView> & { taskId: string }
    >((patches) => {
      const state = useAppStore.getState();
      const current = state.backgroundTasks;
      const currentSessionId = state.activeSessionId;
      if (!currentSessionId) return;
      const patchMap = new Map<
        string,
        Partial<BackgroundProcessView> & { taskId: string }
      >();
      for (const p of patches) {
        const prev = patchMap.get(p.taskId);
        patchMap.set(p.taskId, prev ? { ...prev, ...p } : p);
      }
      let changed = false;
      const seen = new Set<string>();
      const next = current.map((task) => {
        if (task.sessionId !== currentSessionId) return task;
        const patch = patchMap.get(task.taskId);
        if (!patch) return task;
        seen.add(task.taskId);
        changed = true;
        return { ...task, ...patch };
      });
      // Upsert newly started tasks from live BackgroundProgress frames so they never get dropped!
      let insertedNew = false;
      for (const [taskId, patch] of patchMap.entries()) {
        if (seen.has(taskId)) continue;
        const now = patch.updatedAtMs ?? Date.now();
        next.unshift({
          taskId,
          sessionId: currentSessionId,
          group: patch.group ?? "shells",
          toolName: patch.toolName ?? "run_command",
          displayName: patch.displayName ?? patch.summary ?? taskId,
          status: patch.status ?? "running",
          progressKind:
            patch.progressKind ??
            (typeof patch.percent === "number" ? "determinate" : "indeterminate"),
          percent: patch.percent,
          current: patch.current,
          total: patch.total,
          unit: patch.unit,
          summary: patch.summary ?? "Running in background",
          etaSeconds: patch.etaSeconds,
          exitCode: patch.exitCode,
          outputFile: patch.outputFile,
          startedAtMs: now,
          updatedAtMs: now,
          stallQuietSecs: patch.stallQuietSecs,
        });
        changed = true;
        insertedNew = true;
      }
      if (changed) {
        useAppStore.getState().setBackgroundTasks(next);
      }
      if (insertedNew && isVsCodeWebview()) {
        void callRpc("background.list", { sessionId: currentSessionId })
          .then((res) => {
            if (useAppStore.getState().activeSessionId === currentSessionId) {
              useAppStore
                .getState()
                .setBackgroundTasks(
                  res.tasks.filter((t) => t.sessionId === currentSessionId),
                );
            }
          })
          .catch(() => {});
      }
    }, 16);

    const unsubHost = onHostMessage((msg) => {
      if (msg.type === "rayucode.processes.snapshot") {
        const currentSessionId = useAppStore.getState().activeSessionId;
        if (
          msg.sessionId &&
          currentSessionId &&
          msg.sessionId !== currentSessionId
        ) {
          return;
        }
        useAppStore
          .getState()
          .setBackgroundTasks(
            currentSessionId
              ? msg.tasks.filter((t) => t.sessionId === currentSessionId)
              : [],
          );
      } else if (msg.type === "rayucode.swarm.snapshot") {
        useAppStore.getState().setActiveSwarm(msg.swarm);
      } else if (
        msg.type === "rayucode.host.init" &&
        Array.isArray(msg.backgroundTasks)
      ) {
        const currentSessionId =
          msg.sessionId ?? useAppStore.getState().activeSessionId;
        useAppStore
          .getState()
          .setBackgroundTasks(
            currentSessionId
              ? msg.backgroundTasks.filter(
                  (t) => t.sessionId === currentSessionId,
                )
              : [],
          );
        if (msg.activeSwarm !== undefined) {
          useAppStore.getState().setActiveSwarm(msg.activeSwarm);
        }
      } else if (
        msg.type === "rayucode.ui.navigate" &&
        msg.openProcessesDrawer !== undefined
      ) {
        useAppStore
          .getState()
          .setBackgroundDrawerOpen(msg.openProcessesDrawer);
      }
    });

    const unsubHarness = onHarnessFrame((frame) => {
      const frameSessionId =
        typeof frame.session_id === "string"
          ? frame.session_id
          : typeof frame.sessionId === "string"
            ? frame.sessionId
            : null;
      const currentSessionId = useAppStore.getState().activeSessionId;
      if (frameSessionId && frameSessionId !== currentSessionId) {
        return;
      }
      const patch = extractProgressPatchFromFrame(frame);
      if (patch) {
        batcher.push(patch);
      }
    });

    return () => {
      unsubHost();
      unsubHarness();
      batcher.dispose();
    };
  }, []);

  // Keep selectedTaskId & selectedSwarmAgentId valid when lists change
  React.useEffect(() => {
    if (selectedSwarmAgentId !== null) {
      const stillExists = swarmAgents.some(
        (a) => a.agentId === selectedSwarmAgentId || a.sessionId === selectedSwarmAgentId,
      );
      if (!stillExists) {
        setSelectedSwarmAgentIdState(swarmAgents[0]?.agentId ?? null);
      }
      return;
    }
    if (tasks.length === 0) {
      if (selectedTaskId !== null) {
        setSelectedTaskIdState(null);
      }
      return;
    }
    const exists =
      selectedTaskId !== null &&
      tasks.some((task) => task.taskId === selectedTaskId);
    if (!exists) {
      const preferred =
        tasks.find((t) => isProcessStalled(t, stallThresholdSecs)) ??
        tasks.find((t) => t.status === "running") ??
        tasks[0];
      if (preferred) {
        setSelectedTaskIdState(preferred.taskId);
      }
    }
  }, [selectedSwarmAgentId, selectedTaskId, stallThresholdSecs, swarmAgents, tasks]);

  // Derived swarm counts & aggregate progress
  const swarmSummary = React.useMemo(() => {
    const workers = swarmAgents.filter((a) => a.role === "worker");
    const pool = workers.length > 0 ? workers : swarmAgents;
    let running = 0;
    let blocked = 0;
    let completed = 0;
    let failed = 0;
    let todoDone = 0;
    let todoTotal = 0;
    for (const agent of pool) {
      if (agent.status === "blocked") blocked += 1;
      else if (agent.status === "running" || agent.status === "spawned") running += 1;
      else if (agent.status === "completed") completed += 1;
      else if (agent.status === "failed" || agent.status === "crashed") failed += 1;

      if (typeof agent.todoTotal === "number" && agent.todoTotal > 0) {
        todoTotal += agent.todoTotal;
        todoDone += Math.min(agent.todoTotal, agent.todoCompleted ?? 0);
      }
    }
    const total = pool.length;
    const active = running + blocked;
    const percent =
      todoTotal > 0
        ? Math.max(0, Math.min(100, Math.round((todoDone / todoTotal) * 100)))
        : total > 0 && completed > 0
          ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
          : null;
    const primaryAgent =
      pool.find((a) => a.status === "blocked") ??
      pool.find((a) => a.status === "running" || a.status === "spawned") ??
      pool[0] ??
      swarmAgents[0] ??
      null;

    return {
      total,
      running,
      blocked,
      completed,
      failed,
      active,
      todoDone,
      todoTotal,
      percent,
      primaryAgent,
    };
  }, [swarmAgents]);

  // Derived counts (unified across background shell tasks and live swarm agents)
  const counts = React.useMemo(() => {
    let running = 0;
    let stalled = 0;
    let completed = 0;
    let failed = 0;

    for (const task of tasks) {
      if (isProcessStalled(task, stallThresholdSecs)) {
        stalled += 1;
      } else if (task.status === "running") {
        running += 1;
      } else if (task.status === "completed" || task.status === "superseded") {
        completed += 1;
      } else if (task.status === "failed") {
        failed += 1;
      }
    }

    let swarmRunning = 0;
    let swarmBlocked = 0;
    let swarmCompleted = 0;
    let swarmFailed = 0;
    for (const agent of swarmAgents) {
      if (agent.status === "blocked") swarmBlocked += 1;
      else if (
        agent.status === "running" ||
        agent.status === "spawned" ||
        agent.status === "ready"
      ) {
        swarmRunning += 1;
      } else if (agent.status === "completed" || agent.status === "stopped") {
        swarmCompleted += 1;
      } else if (agent.status === "failed" || agent.status === "crashed") {
        swarmFailed += 1;
      }
    }

    return {
      all: tasks.length + swarmAgents.length,
      running: running + swarmRunning,
      stalled: stalled + swarmBlocked,
      completed: completed + swarmCompleted,
      failed: failed + swarmFailed,
      active: running + stalled,
      finished: completed + failed,
      taskRunning: running,
      taskStalled: stalled,
      taskCompleted: completed,
      taskFailed: failed,
    };
  }, [stallThresholdSecs, swarmAgents, tasks]);

  const hasActiveTasks = counts.active > 0 || swarmSummary.active > 0;
  const nowMs = useProcessSecondTick(hasActiveTasks);

  // Sorted and filtered tasks
  const sortedTasks = React.useMemo(() => {
    return [...tasks].sort((a, b) => {
      const aActive = isProcessActive(a.status) ? 1 : 0;
      const bActive = isProcessActive(b.status) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aStalled = isProcessStalled(a, stallThresholdSecs) ? 1 : 0;
      const bStalled = isProcessStalled(b, stallThresholdSecs) ? 1 : 0;
      if (aStalled !== bStalled) return bStalled - aStalled;
      return b.updatedAtMs - a.updatedAtMs;
    });
  }, [stallThresholdSecs, tasks]);

  const filteredTasks = React.useMemo(() => {
    return sortedTasks.filter(
      (task) =>
        matchesProcessFilter(task, filter, stallThresholdSecs) &&
        matchesProcessSearch(task, searchQuery),
    );
  }, [filter, searchQuery, sortedTasks, stallThresholdSecs]);

  const filteredSwarmAgents = React.useMemo(() => {
    return swarmAgents.filter(
      (agent) =>
        matchesSwarmAgentFilter(agent, filter) &&
        matchesSwarmAgentSearch(agent, searchQuery),
    );
  }, [filter, searchQuery, swarmAgents]);

  const groupedTasks = React.useMemo(
    () => groupProcesses(filteredTasks),
    [filteredTasks],
  );

  const selectedSwarmAgent = React.useMemo(() => {
    if (selectedSwarmAgentId) {
      const exact = swarmAgents.find(
        (a) =>
          a.agentId === selectedSwarmAgentId ||
          a.sessionId === selectedSwarmAgentId,
      );
      if (exact) return exact;
    }
    if (tasks.length === 0 && filteredSwarmAgents.length > 0) {
      return filteredSwarmAgents[0] ?? null;
    }
    return null;
  }, [filteredSwarmAgents, selectedSwarmAgentId, swarmAgents, tasks.length]);

  const selectedTask = React.useMemo(() => {
    if (selectedSwarmAgent) return null;
    if (selectedTaskId) {
      const exact = tasks.find((t) => t.taskId === selectedTaskId);
      if (exact) return exact;
    }
    return filteredTasks[0] ?? sortedTasks[0] ?? null;
  }, [filteredTasks, selectedSwarmAgent, selectedTaskId, sortedTasks, tasks]);

  const primaryTask = React.useMemo(() => {
    return (
      sortedTasks.find((t) => isProcessStalled(t, stallThresholdSecs)) ??
      sortedTasks.find((t) => t.status === "running") ??
      sortedTasks[0] ??
      null
    );
  }, [sortedTasks, stallThresholdSecs]);

  // RPC Actions
  const refreshSwarm = React.useCallback(async (): Promise<SwarmStatusView | null> => {
    setIsRefreshingSwarm(true);
    try {
      const res = await callRpc("swarm.status", undefined);
      setActiveSwarm(res.swarm ?? null);
      return res.swarm ?? null;
    } catch {
      return useAppStore.getState().activeSwarm;
    } finally {
      setIsRefreshingSwarm(false);
    }
  }, [setActiveSwarm]);

  const refreshProcesses = React.useCallback(
    async (sessionId?: string, nextScope?: ProcessScopeMode) => {
      const effectiveScope = nextScope ?? scope;
      const targetSessionId =
        sessionId ?? useAppStore.getState().activeSessionId ?? undefined;
      if (effectiveScope === "session" && !targetSessionId) {
        setBackgroundTasks([]);
        return [];
      }
      setIsLoadingList(true);
      try {
        const res = await callRpc("background.list", {
          ...(targetSessionId ? { sessionId: targetSessionId } : {}),
          ...(effectiveScope === "all" ? { scope: "all" as const } : {}),
        });
        if (effectiveScope === "all") {
          setAllScopeTasks(res.tasks);
          return res.tasks;
        }
        const scoped = res.tasks.filter((t) => t.sessionId === targetSessionId);
        if (useAppStore.getState().activeSessionId === targetSessionId) {
          setBackgroundTasks(scoped);
        }
        return scoped;
      } finally {
        setIsLoadingList(false);
      }
    },
    [scope, setBackgroundTasks],
  );

  const toggleScope = React.useCallback(() => {
    const nextScope: ProcessScopeMode = scope === "session" ? "all" : "session";
    setScope(nextScope);
    void refreshProcesses(undefined, nextScope).catch(() => {});
  }, [refreshProcesses, scope]);

  // Re-fetch scoped background processes when activeSessionId changes inside VS Code webview
  React.useEffect(() => {
    if (!isVsCodeWebview()) return;
    if (!activeSessionId) {
      setBackgroundTasks([]);
      return;
    }
    void refreshProcesses(activeSessionId, "session").catch(() => {});
  }, [activeSessionId, refreshProcesses, setBackgroundTasks]);

  // Refresh live swarm status when drawer opens inside VS Code webview
  React.useEffect(() => {
    if (!isDrawerOpen || !isVsCodeWebview()) return;
    void refreshSwarm();
  }, [isDrawerOpen, refreshSwarm]);

  // Poll swarm status while drawer is open and swarm agents are actively running
  React.useEffect(() => {
    if (!isDrawerOpen || !isVsCodeWebview() || swarmSummary.active === 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      void refreshSwarm();
    }, 3_000);
    return () => clearInterval(timer);
  }, [isDrawerOpen, refreshSwarm, swarmSummary.active]);

  const stopSwarmAgent = React.useCallback(
    async (agentId: string) => {
      await callRpc("swarm.kill", { agentId });
      await refreshSwarm();
    },
    [refreshSwarm],
  );

  const resumeSwarmAgent = React.useCallback(
    async (agentId: string) => {
      await callRpc("swarm.kill", { agentId, resume: true });
      await refreshSwarm();
    },
    [refreshSwarm],
  );

  const sendSwarmAgentDm = React.useCallback(
    async (agentId: string, message: string) => {
      await callRpc("swarm.dm", { agentId, message });
      await refreshSwarm();
    },
    [refreshSwarm],
  );

  const openSwarmView = React.useCallback(() => {
    setBackgroundDrawerOpen(false);
    openSettingsSection("swarm");
  }, [openSettingsSection, setBackgroundDrawerOpen]);

  const openSwarmAgentChat = React.useCallback(
    (sessionId: string, label: string) => {
      if (!sessionId) return;
      setBackgroundDrawerOpen(false);
      setActiveSession(sessionId, label);
    },
    [setActiveSession, setBackgroundDrawerOpen],
  );

  const fetchProcessStatus = React.useCallback(async (taskId: string) => {
    const res = await callRpc("background.status", { taskId });
    if (res.task) {
      const state = useAppStore.getState();
      if (state.activeSessionId && res.task.sessionId !== state.activeSessionId) {
        return res.task;
      }
      const current = state.backgroundTasks;
      const exists = current.some((t) => t.taskId === taskId);
      const next = exists
        ? current.map((t) => (t.taskId === taskId && res.task ? res.task : t))
        : [res.task, ...current];
      state.setBackgroundTasks(next);
    }
    return res.task;
  }, []);

  const fetchProcessOutput = React.useCallback(
    async (taskId: string, maxBytes: number = DEFAULT_OUTPUT_MAX_BYTES) => {
      setIsLoadingOutput(true);
      try {
        const res = await callRpc("background.output", { taskId, maxBytes });
        setOutputsByTaskId((prev) => ({
          ...prev,
          [taskId]: res,
        }));
        return res;
      } finally {
        setIsLoadingOutput(false);
      }
    },
    [],
  );

  const cancelProcess = React.useCallback(async (taskId: string) => {
    const res = await callRpc("background.cancel", { taskId });
    if (res.ok) {
      const current = useAppStore.getState().backgroundTasks;
      useAppStore.getState().setBackgroundTasks(
        current.map((task) =>
          task.taskId === taskId
            ? {
                ...task,
                status: "completed",
                exitCode: task.exitCode ?? 130,
                summary:
                  task.summary && !task.summary.toLowerCase().includes("stop")
                    ? `${task.summary} · Stopped`
                    : "Stopped by user",
                updatedAtMs: Date.now(),
              }
            : task,
        ),
      );
    }
    return res;
  }, []);

  const cleanupProcesses = React.useCallback(
    async (sessionId?: string) => {
      const targetSessionId =
        sessionId ?? useAppStore.getState().activeSessionId ?? undefined;
      const res = await callRpc(
        "background.cleanup",
        targetSessionId ? { sessionId: targetSessionId } : undefined,
      );
      if (res.ok) {
        const current = useAppStore.getState().backgroundTasks;
        useAppStore
          .getState()
          .setBackgroundTasks(
            current.filter(
              (t) =>
                (targetSessionId !== undefined &&
                  t.sessionId !== targetSessionId) ||
                isProcessActive(t.status),
            ),
          );
      }
      return res;
    },
    [],
  );

  const handoffForegroundToBackground = React.useCallback(
    async (sessionId?: string) => {
      const resolvedSessionId =
        sessionId ??
        useAppStore.getState().activeSessionId ??
        "ses_vscode_shell";
      const res = await callRpc("background.backgroundTool", {
        sessionId: resolvedSessionId,
      });
      return res;
    },
    [],
  );

  const openOutputFileInEditor = React.useCallback((filePath?: string) => {
    if (!filePath) return;
    postToHost({
      type: "rayucode.editor.openFile",
      path: filePath,
      preview: false,
    });
  }, []);

  const copyProcessOutput = React.useCallback((text: string) => {
    postToHost({
      type: "rayucode.editor.copy",
      text,
    });
  }, []);

  // Global Alt+B shortcut to background active foreground tool
  React.useEffect(() => {
    if (!enableAltBShortcut || typeof window === "undefined") return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key.toLowerCase() === "b" || event.code === "KeyB")
      ) {
        const now = Date.now();
        if (now - lastAltBHandledAtMs < 50) return;
        lastAltBHandledAtMs = now;

        const state = useAppStore.getState();
        if (state.activeSessionId && state.isStreamActive) {
          event.preventDefault();
          void handoffForegroundToBackground(state.activeSessionId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enableAltBShortcut, handoffForegroundToBackground]);

  // On-demand output tail fetch when drawer is open and selectedTask changes
  const selectedTaskIdForOutput = selectedTask?.taskId ?? null;
  const selectedTaskIsActive = selectedTask
    ? isProcessActive(selectedTask.status)
    : false;

  React.useEffect(() => {
    if (!isDrawerOpen || !selectedTaskIdForOutput) return undefined;
    void fetchProcessOutput(selectedTaskIdForOutput);
    return undefined;
  }, [fetchProcessOutput, isDrawerOpen, selectedTaskIdForOutput]);

  // Live output tail polling ONLY when drawer is open, Follow is active, and selected task is running/stalled
  React.useEffect(() => {
    if (
      !isDrawerOpen ||
      !followOutput ||
      !selectedTaskIdForOutput ||
      !selectedTaskIsActive
    ) {
      return undefined;
    }

    const timer = setInterval(() => {
      void fetchProcessOutput(selectedTaskIdForOutput);
    }, followPollIntervalMs);

    return () => clearInterval(timer);
  }, [
    fetchProcessOutput,
    followOutput,
    followPollIntervalMs,
    isDrawerOpen,
    selectedTaskIdForOutput,
    selectedTaskIsActive,
  ]);

  const selectedOutput = selectedTaskIdForOutput
    ? outputsByTaskId[selectedTaskIdForOutput] ?? null
    : null;

  return {
    tasks,
    sortedTasks,
    filteredTasks,
    groupedTasks,
    activeSwarm,
    swarmAgents,
    filteredSwarmAgents,
    swarmSummary,
    counts,
    runningCount: counts.taskRunning,
    stalledCount: counts.taskStalled,
    completedCount: counts.taskCompleted,
    failedCount: counts.taskFailed,
    activeCount: counts.active,
    finishedCount: counts.finished,
    hasTasks: tasks.length > 0 || swarmAgents.length > 0,
    hasActiveTasks,
    primaryTask,
    selectedTask,
    selectedTaskId: selectedTask?.taskId ?? null,
    selectedSwarmAgent,
    selectedSwarmAgentId: selectedSwarmAgent?.agentId ?? null,
    selectedOutput,
    outputsByTaskId,
    scope,
    filter,
    searchQuery,
    followOutput,
    isDrawerOpen,
    isLoadingList,
    isLoadingOutput,
    isRefreshingSwarm,
    nowMs,
    activeSessionId,
    selectTask,
    selectSwarmAgent,
    setScope,
    toggleScope,
    setFilter,
    setSearchQuery,
    setFollowOutput,
    setDrawerOpen: setBackgroundDrawerOpen,
    toggleDrawer: toggleBackgroundDrawer,
    refreshProcesses,
    refreshSwarm,
    fetchProcessStatus,
    fetchProcessOutput,
    cancelProcess,
    stopProcess: cancelProcess,
    cleanupProcesses,
    cleanFinished: cleanupProcesses,
    handoffForegroundToBackground,
    backgroundActiveTool: handoffForegroundToBackground,
    openOutputFileInEditor,
    copyProcessOutput,
    stopSwarmAgent,
    resumeSwarmAgent,
    sendSwarmAgentDm,
    openSwarmView,
    openSwarmAgentChat,
  };
}
