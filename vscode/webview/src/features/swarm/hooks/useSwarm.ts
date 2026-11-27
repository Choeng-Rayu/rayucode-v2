import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SwarmAgentStatus,
  SwarmAgentView,
  SwarmBoardMessageView,
  SwarmConflictView,
  SwarmPlanItemView,
  SwarmPlanProposalView,
  SwarmStatusView,
  SwarmSummaryView,
  SwarmWorktreeView,
  TodoItemView,
} from "@shared/vscodeProtocol";

import { useAppStore } from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

export type SwarmLedgerTab = "board" | "plan" | "worktrees";
export type SwarmCompactPanel = "roster" | "inspector" | "board" | "plan" | "worktrees";
export type SwarmBoardFilter = "all" | "dm" | "broadcast" | "channel" | "lifecycle";

export interface SpawnWorkerInput {
  label: string;
  role?: string;
  model?: string;
  useWorktree?: boolean;
  prompt: string;
}

export interface LaunchPresetWorkerSpec {
  label: string;
  role: string;
  useWorktree: boolean;
  prompt: string;
}

export interface LaunchPresetInput {
  presetId: string;
  goal: string;
  model: string;
  workerCount: number;
  useWorktree: boolean;
  workers: LaunchPresetWorkerSpec[];
}

export interface SwarmTelemetrySummary {
  totalAgents: number;
  runningCount: number;
  completedCount: number;
  blockedCount: number;
  failedCount: number;
  stoppedCount: number;
  worktreeCount: number;
  conflictCount: number;
  allWorkersPaused: boolean;
  planVersion: number;
  planVersionShort: string;
  planLabel: string;
  creditsUsed: number;
  creditsLabel: string;
  kvWarmPercent: number;
  pendingProposalCount: number;
}

export const DEFAULT_SWARM_MODELS: readonly string[] = [
  "inherit",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "gpt-5.2",
  "gemini-2.5-pro",
];

const DEFAULT_PENDING_PROPOSAL: SwarmPlanProposalView = {
  proposalId: "prop_wave3_ledger",
  version: 4,
  author: "ui-shell",
  summary: "Add worktree window launcher and compact sidebar inspector handoff",
  diffSummary: "+2 tasks in Wave 3D (CoordinationLedger worktrees & plan approval actions)",
  status: "pending",
  createdAtMs: Date.now() - 45_000,
};

export const swarmQueryKeys = {
  all: ["vscode-swarm"] as const,
  list: () => [...swarmQueryKeys.all, "list"] as const,
  status: (swarmId?: string) => [...swarmQueryKeys.all, "status", swarmId ?? "active"] as const,
  peek: (sessionId?: string) => [...swarmQueryKeys.all, "peek", sessionId ?? "none"] as const,
};

export function computeSwarmTelemetry(
  swarm: SwarmStatusView | null | undefined,
): SwarmTelemetrySummary {
  const agents = swarm?.agents ?? [];
  const worktrees = swarm?.worktrees ?? [];
  const conflicts = swarm?.conflicts ?? [];
  const pendingProposals = (swarm?.pendingProposals ?? []).filter(
    (p) => p.status === "pending",
  );

  const runningCount = agents.filter(
    (a) => a.status === "running" || a.status === "spawned" || a.status === "ready",
  ).length;
  const completedCount = agents.filter((a) => a.status === "completed").length;
  const blockedCount = agents.filter((a) => a.status === "blocked").length;
  const failedCount = agents.filter(
    (a) => a.status === "failed" || a.status === "crashed",
  ).length;
  const stoppedCount = agents.filter((a) => a.status === "stopped").length;

  const nonCoordinatorWorkers = agents.filter((a) => a.role !== "coordinator");
  const allWorkersPaused =
    nonCoordinatorWorkers.length > 0 &&
    nonCoordinatorWorkers.every((a) => a.status === "stopped" || a.status === "completed");

  const planVersion = swarm?.planVersion ?? 1;
  const planVersionShort = `v${planVersion}`;
  const planLabel = swarm?.planLabel
    ? `Plan ${planVersionShort} · ${swarm.planLabel}`
    : `Shared Plan ${planVersionShort}`;

  const creditsUsed = swarm?.creditsUsed ?? 0;
  const creditsLabel = `${creditsUsed.toFixed(1)} cr`;
  const kvWarmPercent = swarm?.kvWarmPercent ?? 94;

  return {
    totalAgents: agents.length,
    runningCount,
    completedCount,
    blockedCount,
    failedCount,
    stoppedCount,
    worktreeCount: worktrees.length,
    conflictCount: conflicts.length,
    allWorkersPaused,
    planVersion,
    planVersionShort,
    planLabel,
    creditsUsed,
    creditsLabel,
    kvWarmPercent,
    pendingProposalCount: pendingProposals.length,
  };
}

function normalizeSwarmSnapshot(
  raw: SwarmStatusView | null,
  injectDefaultProposal: boolean,
): SwarmStatusView | null {
  if (!raw) return null;
  const hasProposals = raw.pendingProposals && raw.pendingProposals.length > 0;
  return {
    ...raw,
    agents: raw.agents.map((a) => ({ ...a })),
    board: raw.board.map((m) => ({ ...m })),
    planItems: raw.planItems.map((p) => ({ ...p })),
    worktrees: raw.worktrees.map((w) => ({ ...w, agents: [...w.agents] })),
    conflicts: raw.conflicts.map((c) => ({ ...c, agents: [...c.agents] })),
    pendingProposals:
      hasProposals || !injectDefaultProposal
        ? raw.pendingProposals.map((p) => ({ ...p }))
        : [{ ...DEFAULT_PENDING_PROPOSAL, version: raw.planVersion + 1 }],
  };
}

export interface UseSwarmOptions {
  initialSwarm?: SwarmStatusView | null;
  initialSwarms?: SwarmSummaryView[];
  startInLaunchpad?: boolean;
}

export interface UseSwarmResult {
  swarm: SwarmStatusView | null | undefined;
  swarms: SwarmSummaryView[];
  activeSwarmId: string | undefined;
  selectSwarm: (swarmId: string) => void;
  showLaunchpad: boolean;
  setShowLaunchpad: (show: boolean) => void;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  telemetry: SwarmTelemetrySummary;
  selectedAgentId: string;
  selectedAgent: SwarmAgentView | undefined;
  selectAgent: (agentId: string) => void;
  selectedAgentTodos: TodoItemView[];
  selectedAgentEntries: unknown[];
  isPeekingSession: boolean;
  boardFilter: SwarmBoardFilter;
  setBoardFilter: (filter: SwarmBoardFilter) => void;
  workerFilter: string;
  setWorkerFilter: (worker: string) => void;
  filteredBoardMessages: SwarmBoardMessageView[];
  availableModels: string[];
  spawnWorker: (
    input: SpawnWorkerInput,
  ) => Promise<{ ok: boolean; error?: string; agent?: SwarmAgentView }>;
  launchPreset: (
    input: LaunchPresetInput,
  ) => Promise<{ ok: boolean; error?: string }>;
  isSpawning: boolean;
  killAgent: (
    agentId: string,
    pauseOnly?: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  salvageAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  switchAgentModel: (
    agentId: string,
    model: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  isMutatingAgent: boolean;
  pauseAll: () => Promise<{ ok: boolean; error?: string }>;
  stopSwarm: () => Promise<{ ok: boolean; error?: string }>;
  isPausingAll: boolean;
  sendDm: (
    agentId: string,
    message: string,
  ) => Promise<{ ok: boolean; error?: string; seq?: number }>;
  isSendingDm: boolean;
  decidePlan: (
    proposalId: string,
    decision: "approve" | "reject",
    reason?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  isDecidingPlan: boolean;
  setSwarmLabel: (label: string) => Promise<{ ok: boolean; error?: string }>;
  openWorktreeWindow: (path: string) => Promise<void>;
  openFileInEditor: (path: string, line?: number) => void;
  openDiffInEditor: (path: string) => void;
  openAgentSessionInChat: (agent: SwarmAgentView) => void;
}

export function useSwarm(options?: UseSwarmOptions): UseSwarmResult {
  const queryClient = useQueryClient();
  const [activeSwarmId, setActiveSwarmId] = React.useState<string | undefined>(
    options?.initialSwarm?.swarmId,
  );
  const [showLaunchpad, setShowLaunchpad] = React.useState<boolean>(
    Boolean(options?.startInLaunchpad),
  );
  const [selectedAgentId, setSelectedAgentId] = React.useState<string>("ui-shell");
  const [boardFilter, setBoardFilter] = React.useState<SwarmBoardFilter>("all");
  const [workerFilter, setWorkerFilter] = React.useState<string>("all");
  const proposalHandledRef = React.useRef<boolean>(false);

  const listQuery = useQuery({
    queryKey: swarmQueryKeys.list(),
    queryFn: async () => {
      const res = await rpcClient.callRpc("swarm.list");
      return res.swarms;
    },
    initialData: options?.initialSwarms,
    staleTime: 15_000,
  });

  const statusQuery = useQuery({
    queryKey: swarmQueryKeys.status(activeSwarmId),
    queryFn: async () => {
      const res = await rpcClient.callRpc(
        "swarm.status",
        activeSwarmId ? { swarmId: activeSwarmId } : undefined,
      );
      return normalizeSwarmSnapshot(res.swarm, !proposalHandledRef.current);
    },
    initialData:
      options?.initialSwarm !== undefined
        ? normalizeSwarmSnapshot(options.initialSwarm, !proposalHandledRef.current)
        : undefined,
    staleTime: 15_000,
  });

  const swarm = statusQuery.data;

  const swarms = React.useMemo<SwarmSummaryView[]>(() => {
    const fromList = listQuery.data ?? [];
    if (fromList.length > 0) return fromList;
    if (!swarm) return [];
    return [
      {
        swarmId: swarm.swarmId,
        label: swarm.label,
        coordinatorSessionId: swarm.agents[0]?.sessionId ?? "ses_coordinator",
        memberCount: swarm.agents.length,
        runningCount: swarm.agents.filter((a) => a.status === "running").length,
        completedCount: swarm.agents.filter((a) => a.status === "completed").length,
        active: true,
      },
    ];
  }, [listQuery.data, swarm]);

  const telemetry = React.useMemo(() => computeSwarmTelemetry(swarm), [swarm]);

  const selectedAgent = React.useMemo<SwarmAgentView | undefined>(() => {
    const agents = swarm?.agents ?? [];
    if (agents.length === 0) return undefined;
    return (
      agents.find((a) => a.agentId === selectedAgentId) ??
      agents.find((a) => a.role === "worker") ??
      agents[0]
    );
  }, [swarm, selectedAgentId]);

  const peekQuery = useQuery({
    queryKey: swarmQueryKeys.peek(selectedAgent?.sessionId),
    queryFn: async () => {
      if (!selectedAgent?.sessionId) {
        return { entries: [], todos: [] };
      }
      return rpcClient.callRpc("swarm.peekSession", {
        sessionId: selectedAgent.sessionId,
      });
    },
    enabled: Boolean(selectedAgent?.sessionId),
    staleTime: 10_000,
  });

  const availableModels = React.useMemo<string[]>(() => {
    const allowlist = swarm?.modelAllowlist ?? [];
    const merged = new Set<string>(["inherit", ...allowlist, ...DEFAULT_SWARM_MODELS]);
    return Array.from(merged);
  }, [swarm?.modelAllowlist]);

  const filteredBoardMessages = React.useMemo<SwarmBoardMessageView[]>(() => {
    const messages = swarm?.board ?? [];
    return messages.filter((msg) => {
      if (boardFilter !== "all") {
        if (boardFilter === "lifecycle") {
          if (msg.kind !== "lifecycle" && msg.kind !== "completion") return false;
        } else if (msg.kind !== boardFilter) {
          return false;
        }
      }
      if (workerFilter !== "all") {
        const matchesFrom = msg.from === workerFilter;
        const matchesTo = msg.to === workerFilter;
        const mentionsWorker = msg.text.includes(`@${workerFilter}`);
        if (!matchesFrom && !matchesTo && !mentionsWorker) {
          return false;
        }
      }
      return true;
    });
  }, [swarm?.board, boardFilter, workerFilter]);

  const updateSwarmCache = React.useCallback(
    (updater: (current: SwarmStatusView) => SwarmStatusView) => {
      queryClient.setQueryData<SwarmStatusView | null>(
        swarmQueryKeys.status(activeSwarmId),
        (prev) => {
          const base: SwarmStatusView = prev ?? {
            swarmId: activeSwarmId ?? "swarm_vscode_active",
            label: "VS Code Swarm Mission",
            planVersion: 1,
            creditsUsed: 0,
            kvWarmPercent: 94,
            agents: [],
            board: [],
            planItems: [],
            pendingProposals: [],
            worktrees: [],
            conflicts: [],
          };
          return updater(base);
        },
      );
    },
    [queryClient, activeSwarmId],
  );

  const spawnMutation = useMutation({
    mutationFn: async (input: SpawnWorkerInput) => {
      const cleanLabel = input.label.trim();
      const cleanPrompt = input.prompt.trim();
      const res = await rpcClient.callRpc("swarm.spawn", {
        swarmId: swarm?.swarmId ?? activeSwarmId,
        label: cleanLabel,
        model: input.model && input.model !== "inherit" ? input.model : undefined,
        useWorktree: input.useWorktree,
        prompt: cleanPrompt,
      });
      return { res, input: { ...input, label: cleanLabel, prompt: cleanPrompt } };
    },
    onSuccess: ({ res, input }) => {
      const spawnedAgent: SwarmAgentView = res.agent ?? {
        agentId: input.label,
        sessionId: `ses_${input.label}`,
        label: input.label,
        role: "worker",
        depth: 1,
        status: "running",
        model: input.model && input.model !== "inherit" ? input.model : "claude-sonnet-4-5",
        provider: "rayu-cloud",
        currentIntent: input.prompt,
        branch: input.useWorktree ? `swarm/${input.label}` : "main",
        worktreePath: input.useWorktree
          ? `/workspace/rayucode-v2/.worktrees/${input.label}`
          : "/workspace/rayucode-v2",
        todoCompleted: 0,
        todoTotal: 3,
        updatedAtMs: Date.now(),
      };

      updateSwarmCache((current) => {
        const hasCoordinator = current.agents.some((a) => a.role === "coordinator");
        const baseAgents: SwarmAgentView[] = hasCoordinator
          ? current.agents
          : [
              {
                agentId: "coordinator",
                sessionId: "ses_coordinator",
                label: "coordinator",
                role: "coordinator",
                depth: 0,
                status: "running",
                model: "claude-opus-4-5",
                provider: "rayu-cloud",
                currentIntent: "Coordinating parallel worker lanes",
                branch: "main",
                todoCompleted: 1,
                todoTotal: 4,
                updatedAtMs: Date.now(),
              },
              ...current.agents,
            ];

        const nextAgents = baseAgents.some((a) => a.agentId === spawnedAgent.agentId)
          ? baseAgents.map((a) =>
              a.agentId === spawnedAgent.agentId ? spawnedAgent : a,
            )
          : [...baseAgents, spawnedAgent];

        const nextWorktrees: SwarmWorktreeView[] =
          input.useWorktree &&
          !current.worktrees.some((w) => w.branch === `swarm/${input.label}`)
            ? [
                ...current.worktrees,
                {
                  id: `wt_${input.label}`,
                  branch: `swarm/${input.label}`,
                  path: `/workspace/rayucode-v2/.worktrees/${input.label}`,
                  manager: "git-worktree",
                  agents: [input.label],
                  dirtyFiles: 0,
                },
              ]
            : current.worktrees;

        const nextSeq =
          current.board.reduce((max, m) => Math.max(max, m.seq), 0) + 1;

        return {
          ...current,
          agents: nextAgents,
          worktrees: nextWorktrees,
          board: [
            ...current.board,
            {
              seq: nextSeq,
              kind: "lifecycle",
              from: "coordinator",
              to: input.label,
              text: `@${input.label} spawned (${input.role ?? "Worker"}): ${input.prompt}`,
              timestampMs: Date.now(),
            },
          ],
        };
      });

      setSelectedAgentId(spawnedAgent.agentId);
      setShowLaunchpad(false);
    },
  });

  const spawnWorker = React.useCallback(
    async (
      input: SpawnWorkerInput,
    ): Promise<{ ok: boolean; error?: string; agent?: SwarmAgentView }> => {
      const cleanLabel = input.label.trim();
      const cleanPrompt = input.prompt.trim();
      if (cleanLabel.length < 2) {
        return { ok: false, error: "Worker name must be at least 2 characters." };
      }
      if (cleanPrompt.length < 4) {
        return {
          ok: false,
          error: "Describe the worker task (at least 4 characters).",
        };
      }
      try {
        const { res } = await spawnMutation.mutateAsync(input);
        return { ok: true, agent: res.agent };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to spawn worker",
        };
      }
    },
    [spawnMutation],
  );

  const launchPreset = React.useCallback(
    async (
      input: LaunchPresetInput,
    ): Promise<{ ok: boolean; error?: string }> => {
      const trimmedGoal = input.goal.trim();
      if (trimmedGoal.length < 4) {
        return {
          ok: false,
          error: "Describe what the agents should work on (at least 4 characters).",
        };
      }
      try {
        for (const spec of input.workers) {
          const result = await spawnWorker({
            label: spec.label,
            role: spec.role,
            model: input.model,
            useWorktree: input.useWorktree ? spec.useWorktree : false,
            prompt: spec.prompt,
          });
          if (!result.ok) {
            return { ok: false, error: result.error };
          }
        }
        setShowLaunchpad(false);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to launch swarm preset",
        };
      }
    },
    [spawnWorker],
  );

  const killAgentMutation = useMutation({
    mutationFn: async ({
      agentId,
      pauseOnly,
    }: {
      agentId: string;
      pauseOnly?: boolean;
    }) => {
      await rpcClient.callRpc("swarm.kill", {
        swarmId: swarm?.swarmId ?? activeSwarmId,
        agentId,
        pauseOnly,
      });
      return { agentId, pauseOnly };
    },
    onSuccess: ({ agentId, pauseOnly }) => {
      updateSwarmCache((current) => ({
        ...current,
        agents: current.agents.map((agent) => {
          if (agent.agentId !== agentId) return agent;
          const nextStatus: SwarmAgentStatus =
            agent.status === "stopped"
              ? "running"
              : pauseOnly
                ? "stopped"
                : "stopped";
          return { ...agent, status: nextStatus, updatedAtMs: Date.now() };
        }),
      }));
    },
  });

  const salvageMutation = useMutation({
    mutationFn: async (agentId: string) => {
      await rpcClient.callRpc("swarm.salvage", {
        swarmId: swarm?.swarmId ?? activeSwarmId,
        agentId,
      });
      return agentId;
    },
    onSuccess: (agentId) => {
      updateSwarmCache((current) => ({
        ...current,
        agents: current.agents.map((agent) =>
          agent.agentId === agentId
            ? {
                ...agent,
                status: "running",
                currentIntent: "Salvaged worktree & resumed task execution",
                updatedAtMs: Date.now(),
              }
            : agent,
        ),
      }));
    },
  });

  const pauseAllMutation = useMutation({
    mutationFn: async () => {
      await rpcClient.callRpc("swarm.pauseAll", {
        swarmId: swarm?.swarmId ?? activeSwarmId,
      });
    },
    onSuccess: () => {
      updateSwarmCache((current) => {
        const shouldResume = computeSwarmTelemetry(current).allWorkersPaused;
        return {
          ...current,
          agents: current.agents.map((agent) => {
            if (agent.role === "coordinator") return agent;
            return {
              ...agent,
              status: shouldResume ? "running" : "stopped",
              updatedAtMs: Date.now(),
            };
          }),
        };
      });
    },
  });

  const dmMutation = useMutation({
    mutationFn: async ({
      agentId,
      message,
    }: {
      agentId: string;
      message: string;
    }) => {
      const res = await rpcClient.callRpc("swarm.dm", {
        swarmId: swarm?.swarmId ?? activeSwarmId,
        agentId,
        message,
      });
      return { agentId, message, seq: res.seq };
    },
    onSuccess: ({ agentId, message, seq }) => {
      updateSwarmCache((current) => {
        const nextSeq =
          seq ?? current.board.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
        return {
          ...current,
          board: [
            ...current.board,
            {
              seq: nextSeq,
              kind: "dm",
              from: "coordinator",
              to: agentId,
              text: message,
              timestampMs: Date.now(),
            },
          ],
        };
      });
    },
  });

  const decidePlanMutation = useMutation({
    mutationFn: async ({
      proposalId,
      decision,
      reason,
    }: {
      proposalId: string;
      decision: "approve" | "reject";
      reason?: string;
    }) => {
      await rpcClient.callRpc("swarm.planDecide", {
        swarmId: swarm?.swarmId ?? activeSwarmId,
        proposalId,
        decision,
        reason,
      });
      return { proposalId, decision };
    },
    onSuccess: ({ proposalId, decision }) => {
      proposalHandledRef.current = true;
      updateSwarmCache((current) => {
        const target = current.pendingProposals.find(
          (p) => p.proposalId === proposalId,
        );
        const approved = decision === "approve";
        const nextPlanVersion =
          approved && target
            ? Math.max(current.planVersion + 1, target.version)
            : current.planVersion;
        const nextPlanItems: SwarmPlanItemView[] =
          approved && target
            ? [
                ...current.planItems,
                {
                  id: `plan_${proposalId}`,
                  phase: `v${nextPlanVersion}`,
                  title: target.summary,
                  assignee: target.author,
                  status: "in_progress",
                },
              ]
            : current.planItems;

        return {
          ...current,
          planVersion: nextPlanVersion,
          planItems: nextPlanItems,
          pendingProposals: current.pendingProposals.map((p) =>
            p.proposalId === proposalId
              ? { ...p, status: approved ? "approved" : "rejected" }
              : p,
          ),
        };
      });
    },
  });

  const killAgent = React.useCallback(
    async (agentId: string, pauseOnly?: boolean) => {
      try {
        await killAgentMutation.mutateAsync({ agentId, pauseOnly });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to update worker",
        };
      }
    },
    [killAgentMutation],
  );

  const salvageAgent = React.useCallback(
    async (agentId: string) => {
      try {
        await salvageMutation.mutateAsync(agentId);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to salvage worker",
        };
      }
    },
    [salvageMutation],
  );

  const switchAgentModel = React.useCallback(
    async (agentId: string, model: string) => {
      const target = swarm?.agents.find((a) => a.agentId === agentId);
      updateSwarmCache((current) => ({
        ...current,
        agents: current.agents.map((a) =>
          a.agentId === agentId ? { ...a, model, updatedAtMs: Date.now() } : a,
        ),
      }));
      if (target) {
        try {
          await rpcClient.callRpc("swarm.dm", {
            swarmId: swarm?.swarmId ?? activeSwarmId,
            agentId,
            message: `[model] switch model to ${model}`,
          });
        } catch {
          // optimistic model switch remains applied
        }
      }
      return { ok: true };
    },
    [swarm, activeSwarmId, updateSwarmCache],
  );

  const pauseAll = React.useCallback(async () => {
    try {
      await pauseAllMutation.mutateAsync();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to toggle swarm pause",
      };
    }
  }, [pauseAllMutation]);

  const stopSwarm = React.useCallback(async () => {
    try {
      await rpcClient.callRpc("swarm.pauseAll", {
        swarmId: swarm?.swarmId ?? activeSwarmId,
      });
      updateSwarmCache((current) => ({
        ...current,
        agents: current.agents.map((a) => ({
          ...a,
          status: "stopped",
          updatedAtMs: Date.now(),
        })),
      }));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to stop swarm",
      };
    }
  }, [swarm?.swarmId, activeSwarmId, updateSwarmCache]);

  const sendDm = React.useCallback(
    async (agentId: string, message: string) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return { ok: false, error: "Steering message cannot be empty." };
      }
      try {
        const res = await dmMutation.mutateAsync({ agentId, message: trimmed });
        return { ok: true, seq: res.seq };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to send DM",
        };
      }
    },
    [dmMutation],
  );

  const decidePlan = React.useCallback(
    async (
      proposalId: string,
      decision: "approve" | "reject",
      reason?: string,
    ) => {
      try {
        await decidePlanMutation.mutateAsync({ proposalId, decision, reason });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : "Failed to decide plan proposal",
        };
      }
    },
    [decidePlanMutation],
  );

  const setSwarmLabel = React.useCallback(
    async (label: string) => {
      const trimmed = label.trim();
      if (!trimmed || !swarm) {
        return { ok: false, error: "Swarm label cannot be empty." };
      }
      try {
        await rpcClient.callRpc("swarm.setLabel", {
          swarmId: swarm.swarmId,
          label: trimmed,
        });
        updateSwarmCache((current) => ({ ...current, label: trimmed }));
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to rename swarm",
        };
      }
    },
    [swarm, updateSwarmCache],
  );

  const openWorktreeWindow = React.useCallback(async (path: string) => {
    rpcClient.postToHost({
      type: "rayucode.editor.openWorktreeWindow",
      path,
    });
    try {
      await rpcClient.callRpc("swarm.worktreeOpen", { path });
    } catch {
      // host postMessage already dispatched
    }
  }, []);

  const openFileInEditor = React.useCallback((path: string, line = 1) => {
    rpcClient.postToHost({
      type: "rayucode.editor.openFile",
      path,
      line,
    });
  }, []);

  const openDiffInEditor = React.useCallback((path: string) => {
    rpcClient.postToHost({
      type: "rayucode.editor.openDiff",
      path,
      scope: "git",
    });
  }, []);

  const openAgentSessionInChat = React.useCallback((agent: SwarmAgentView) => {
    useAppStore.getState().setActiveSession(agent.sessionId, agent.label);
  }, []);

  const selectSwarm = React.useCallback((swarmId: string) => {
    setActiveSwarmId(swarmId);
    setShowLaunchpad(false);
  }, []);

  const refetch = React.useCallback(() => {
    void statusQuery.refetch();
    void listQuery.refetch();
  }, [statusQuery, listQuery]);

  return {
    swarm,
    swarms,
    activeSwarmId: swarm?.swarmId ?? activeSwarmId,
    selectSwarm,
    showLaunchpad,
    setShowLaunchpad,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error instanceof Error ? statusQuery.error : null,
    refetch,
    telemetry,
    selectedAgentId: selectedAgent?.agentId ?? selectedAgentId,
    selectedAgent,
    selectAgent: setSelectedAgentId,
    selectedAgentTodos: peekQuery.data?.todos ?? [],
    selectedAgentEntries: peekQuery.data?.entries ?? [],
    isPeekingSession: peekQuery.isLoading,
    boardFilter,
    setBoardFilter,
    workerFilter,
    setWorkerFilter,
    filteredBoardMessages,
    availableModels,
    spawnWorker,
    launchPreset,
    isSpawning: spawnMutation.isPending,
    killAgent,
    salvageAgent,
    switchAgentModel,
    isMutatingAgent: killAgentMutation.isPending || salvageMutation.isPending,
    pauseAll,
    stopSwarm,
    isPausingAll: pauseAllMutation.isPending,
    sendDm,
    isSendingDm: dmMutation.isPending,
    decidePlan,
    isDecidingPlan: decidePlanMutation.isPending,
    setSwarmLabel,
    openWorktreeWindow,
    openFileInEditor,
    openDiffInEditor,
    openAgentSessionInChat,
  };
}

export type {
  SwarmAgentStatus,
  SwarmAgentView,
  SwarmBoardMessageView,
  SwarmConflictView,
  SwarmPlanItemView,
  SwarmPlanProposalView,
  SwarmStatusView,
  SwarmSummaryView,
  SwarmWorktreeView,
};
