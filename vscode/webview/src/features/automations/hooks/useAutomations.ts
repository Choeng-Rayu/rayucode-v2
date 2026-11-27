import { requireOperation } from "@/lib/operation-result";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AmbientApprovalView,
  AmbientStatusView,
  OvernightRunView,
  PermissionModeId,
  ProductivityReportView,
  QualityStatusView,
  ScheduleItemView,
} from "@shared/vscodeProtocol";

import { callRpc } from "@/lib";

export const AUTOMATIONS_KEYS = {
  all: ["automations"] as const,
  overnight: () => [...AUTOMATIONS_KEYS.all, "overnight"] as const,
  overnightLog: (runId: string) =>
    [...AUTOMATIONS_KEYS.all, "overnight-log", runId] as const,
  overnightReport: (runId: string) =>
    [...AUTOMATIONS_KEYS.all, "overnight-report", runId] as const,
  schedules: () => [...AUTOMATIONS_KEYS.all, "schedules"] as const,
  ambient: () => [...AUTOMATIONS_KEYS.all, "ambient"] as const,
  quality: () => [...AUTOMATIONS_KEYS.all, "quality"] as const,
};

export function overnightRunsQueryOptions() {
  return queryOptions({
    queryKey: AUTOMATIONS_KEYS.overnight(),
    queryFn: async () => {
      const res = await callRpc("automations.overnight.list");
      return res.runs;
    },
  });
}

export function schedulesQueryOptions() {
  return queryOptions({
    queryKey: AUTOMATIONS_KEYS.schedules(),
    queryFn: async () => {
      const res = await callRpc("automations.schedules.list");
      return res.schedules;
    },
  });
}

export function ambientStatusQueryOptions() {
  return queryOptions({
    queryKey: AUTOMATIONS_KEYS.ambient(),
    queryFn: (): Promise<AmbientStatusView> => callRpc("automations.ambient.status"),
  });
}

export function qualityStatusQueryOptions() {
  return queryOptions({
    queryKey: AUTOMATIONS_KEYS.quality(),
    queryFn: async (): Promise<QualityStatusView> => {
      return callRpc("automations.quality.status");
    },
  });
}

export function useOvernightRuns() {
  return useQuery(overnightRunsQueryOptions());
}

export interface StartOvernightInput {
  mission: string;
  duration: string;
  maxAgents: number;
  permissionMode: PermissionModeId;
  workingDir?: string;
  mode?: string;
  repo?: string;
  branch?: string;
  handoffAt?: string;
}

export function useStartOvernightRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartOvernightInput) => {
      const res = await callRpc("automations.overnight.start", {
        mission: input.mission,
        duration: input.duration,
        maxAgents: input.maxAgents,
        permissionMode: input.permissionMode,
        workingDir: input.workingDir,
      });
      const enriched: OvernightRunView = {
        ...res.run,
        mode: input.mode ?? res.run.mode ?? "worktree",
        repo: input.repo ?? res.run.repo ?? "rayucode-v2",
        branch: input.branch ?? res.run.branch ?? "overnight/auto",
        wakesAt: res.run.wakesAt ?? "06:00",
        handoffAt: input.handoffAt ?? res.run.handoffAt ?? "07:30",
      };
      return enriched;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<OvernightRunView[]>(
        AUTOMATIONS_KEYS.overnight(),
        (prev = []) => [
          created,
          ...prev.filter((r) => r.runId !== created.runId),
        ],
      );
    },
  });
}

export function useOvernightRunActions() {
  const queryClient = useQueryClient();

  const pauseMutation = useMutation({
    mutationFn: async (params: { runId: string; resume?: boolean }) => {
      await requireOperation(callRpc("automations.overnight.pause", params));
      return params;
    },
    onSuccess: ({ runId, resume }) => {
      queryClient.setQueryData<OvernightRunView[]>(
        AUTOMATIONS_KEYS.overnight(),
        (prev = []) =>
          prev.map((run) =>
            run.runId === runId
              ? {
                  ...run,
                  status: resume
                    ? "running"
                    : run.status === "paused"
                      ? "running"
                      : "paused",
                }
              : run,
          ),
      );
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async (runId: string) => {
      await requireOperation(callRpc("automations.overnight.runNow", { runId }));
      return runId;
    },
    onSuccess: (runId) => {
      queryClient.setQueryData<OvernightRunView[]>(
        AUTOMATIONS_KEYS.overnight(),
        (prev = []) =>
          prev.map((run) =>
            run.runId === runId
              ? {
                  ...run,
                  validationsGreen: run.validationsGreen + 1,
                  updatedAtMs: Date.now(),
                }
              : run,
          ),
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (runId: string) => {
      await requireOperation(callRpc("automations.overnight.cancel", { runId }));
      return runId;
    },
    onSuccess: (runId) => {
      queryClient.setQueryData<OvernightRunView[]>(
        AUTOMATIONS_KEYS.overnight(),
        (prev = []) =>
          prev.map((run) =>
            run.runId === runId ? { ...run, status: "cancelled" } : run,
          ),
      );
    },
  });

  return {
    pauseMutation,
    runNowMutation,
    cancelMutation,
  };
}

export function useOvernightEventLog(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: AUTOMATIONS_KEYS.overnightLog(runId),
    enabled,
    queryFn: async () => {
      const res = await callRpc("automations.overnight.log", {
        runId,
        maxLines: 200,
      });
      return res.lines;
    },
  });
}

export function useOvernightReport(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: AUTOMATIONS_KEYS.overnightReport(runId),
    enabled,
    queryFn: async () => {
      return callRpc("automations.overnight.report", { runId });
    },
  });
}

export function useSchedules() {
  return useQuery(schedulesQueryOptions());
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      title?: string;
      prompt: string;
      schedule: string;
      permissionMode?: PermissionModeId;
      repo?: string;
    }) => {
      const res = await callRpc("automations.schedules.create", {
        title: params.title,
        prompt: params.prompt,
        schedule: params.schedule,
        permissionMode: params.permissionMode,
      });
      const enriched: ScheduleItemView = {
        ...res.schedule,
        permissionMode: params.permissionMode ?? res.schedule.permissionMode,
        repo: params.repo ?? res.schedule.repo ?? "rayucode-v2",
        description: res.schedule.description ?? params.prompt,
        nextRunAt: res.schedule.nextRunAt ?? "Scheduled",
      };
      return enriched;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<ScheduleItemView[]>(
        AUTOMATIONS_KEYS.schedules(),
        (prev = []) => [
          created,
          ...prev.filter((s) => s.id !== created.id),
        ],
      );
    },
  });
}

export function useScheduleActions() {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: async (params: { id: string; enabled: boolean }) => {
      await requireOperation(callRpc("automations.schedules.toggle", params));
      return params;
    },
    onSuccess: ({ id, enabled }) => {
      queryClient.setQueryData<ScheduleItemView[]>(
        AUTOMATIONS_KEYS.schedules(),
        (prev = []) =>
          prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
      );
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async (id: string) => {
      await requireOperation(callRpc("automations.schedules.runNow", { id }));
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ScheduleItemView[]>(
        AUTOMATIONS_KEYS.schedules(),
        (prev = []) =>
          prev.map((s) =>
            s.id === id ? { ...s, queuedNow: true, lastRunAt: "Just now" } : s,
          ),
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await requireOperation(callRpc("automations.schedules.cancel", { id }));
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ScheduleItemView[]>(
        AUTOMATIONS_KEYS.schedules(),
        (prev = []) => prev.filter((s) => s.id !== id),
      );
    },
  });

  return {
    toggleMutation,
    runNowMutation,
    cancelMutation,
  };
}

export function useAmbientStatus() {
  return useQuery(ambientStatusQueryOptions());
}

export function useDecideAmbientApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; decision: "allow" | "deny" }) => {
      await requireOperation(callRpc("automations.ambient.decide", params));
      return params;
    },
    onSuccess: ({ id, decision }) => {
      queryClient.setQueryData<AmbientStatusView>(
        AUTOMATIONS_KEYS.ambient(),
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            approvals: prev.approvals.map((appr) =>
              appr.id === id
                ? {
                    ...appr,
                    status: decision === "allow" ? "approved" : "denied",
                  }
                : appr,
            ),
          };
        },
      );
    },
  });
}

export function useQualityStatus() {
  return useQuery(qualityStatusQueryOptions());
}

export function useQualityActions() {
  const queryClient = useQueryClient();

  const setAutoReviewMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await requireOperation(callRpc("automations.quality.setAutoReview", {
        enabled,
      }));
      return res.enabled;
    },
    onSuccess: (enabled) => {
      queryClient.setQueryData<QualityStatusView>(
        AUTOMATIONS_KEYS.quality(),
        (prev) => (prev ? { ...prev, autoReviewEnabled: enabled } : prev),
      );
    },
  });

  const setAutoJudgeMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await requireOperation(callRpc("automations.quality.setAutoJudge", {
        enabled,
      }));
      return res.enabled;
    },
    onSuccess: (enabled) => {
      queryClient.setQueryData<QualityStatusView>(
        AUTOMATIONS_KEYS.quality(),
        (prev) => (prev ? { ...prev, autoJudgeEnabled: enabled } : prev),
      );
    },
  });

  const runReviewMutation = useMutation({
    mutationFn: async (sessionId?: string) => {
      return callRpc(
        "automations.quality.runReview",
        sessionId ? { sessionId } : undefined,
      );
    },
  });

  const runJudgeMutation = useMutation({
    mutationFn: async (sessionId?: string) => {
      return callRpc(
        "automations.quality.runJudge",
        sessionId ? { sessionId } : undefined,
      );
    },
  });

  const productivityMutation = useMutation({
    mutationFn: async (
      range: "7d" | "30d" = "7d",
    ): Promise<ProductivityReportView> => {
      return callRpc("automations.quality.productivity", { range });
    },
    onSuccess: (report) => {
      queryClient.setQueryData<QualityStatusView>(
        AUTOMATIONS_KEYS.quality(),
        (prev) => (prev ? { ...prev, latestProductivity: report } : prev),
      );
    },
  });

  return {
    setAutoReviewMutation,
    setAutoJudgeMutation,
    runReviewMutation,
    runJudgeMutation,
    productivityMutation,
  };
}
