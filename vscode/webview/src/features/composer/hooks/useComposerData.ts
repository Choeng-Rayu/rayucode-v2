import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CacheTtl,
  EffortLevel,
  ModelRouteOptionView,
  PermissionModeId,
  ServiceTier,
} from "@shared/vscodeProtocol";

import { callRpc, isVsCodeWebview } from "@/lib";

import {
  BUILTIN_SLASH_COMMANDS,
  DEFAULT_CACHE_TTL,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LABEL,
  DEFAULT_SERVICE_TIER,
  FALLBACK_MODELS,
  normalizeEffortLevel,
} from "../constants";
import type { ModelOption, SlashCommandItem } from "../types";

export function modelSettingsQueryOptions(sessionId?: string | null) {
  return queryOptions({
    queryKey: ["composer", "model-settings", sessionId ?? "global"] as const,
    queryFn: () =>
      callRpc("settings.models.get", {
        sessionId: sessionId ?? undefined,
      }),
    staleTime: 30_000,
  });
}

export function providersQueryOptions() {
  return queryOptions({
    queryKey: ["composer", "providers"] as const,
    queryFn: () => callRpc("settings.providers.list"),
    staleTime: 30_000,
  });
}

export function workspaceFoldersQueryOptions() {
  return queryOptions({
    queryKey: ["composer", "workspace-folders"] as const,
    queryFn: () => callRpc("workspace.listFolders"),
    staleTime: 30_000,
  });
}

export function workspaceBranchesQueryOptions(workspacePath?: string | null) {
  return queryOptions({
    queryKey: [
      "composer",
      "workspace-branches",
      workspacePath ?? "default",
    ] as const,
    queryFn: () =>
      callRpc("workspace.listBranches", {
        workspacePath: workspacePath ?? undefined,
      }),
    staleTime: 20_000,
  });
}

export function workspaceFilesQueryOptions(
  query: string,
  sessionId?: string | null,
) {
  return queryOptions({
    queryKey: [
      "composer",
      "workspace-files",
      sessionId ?? "default",
      query,
    ] as const,
    queryFn: () =>
      callRpc("workspace.findFiles", {
        sessionId: sessionId ?? undefined,
        query,
        limit: 30,
      }),
    staleTime: 15_000,
  });
}

export function skillsListQueryOptions() {
  return queryOptions({
    queryKey: ["composer", "skills"] as const,
    queryFn: () => callRpc("plugins.skills.list"),
    staleTime: 30_000,
  });
}

export function voiceFeaturesQueryOptions() {
  return queryOptions({
    queryKey: ["composer", "voice-features"] as const,
    queryFn: () => callRpc("settings.features.get"),
    staleTime: 30_000,
  });
}

export function recentSessionsQueryOptions() {
  return queryOptions({
    queryKey: ["sessions", "list", { includeArchived: false }] as const,
    queryFn: () => callRpc("sessions.list", { includeArchived: false }),
    staleTime: 15_000,
  });
}

export function contextSnapshotQueryOptions(sessionId?: string | null) {
  const targetSessionId =
    sessionId ?? (!isVsCodeWebview() ? "ses_vscode_shell" : null);
  return queryOptions({
    queryKey: [
      "composer",
      "context-snapshot",
      targetSessionId ?? "none",
    ] as const,
    queryFn: () =>
      callRpc("workspace.contextSnapshot", {
        sessionId: targetSessionId!,
      }),
    enabled: Boolean(targetSessionId),
    staleTime: 15_000,
  });
}

function mapRouteToModelOption(route: ModelRouteOptionView): ModelOption {
  const id = route.model || route.id;
  return {
    id,
    label: route.label || id,
    provider: route.provider || "rayu-cloud",
    subtitle:
      route.detail ||
      (route.pricingLabel ? route.pricingLabel : undefined) ||
      (route.available === false ? "Unavailable" : undefined),
    available: route.available !== false,
    supportedEfforts: route.supportsEffort === false ? [] : undefined,
  };
}

export function useComposerModelCatalog(sessionId?: string | null) {
  const queryClient = useQueryClient();
  const modelSettingsQuery = useQuery(modelSettingsQueryOptions(sessionId));
  const providersQuery = useQuery(providersQueryOptions());

  const refreshMutation = useMutation({
    mutationFn: () =>
      callRpc("settings.models.refresh", {
        sessionId: sessionId ?? undefined,
      }),
    onSuccess: (res) => {
      if (res.routes && res.routes.length > 0) {
        queryClient.setQueryData(
          ["composer", "model-settings", sessionId ?? "global"] as const,
          (prev: Record<string, unknown> | undefined) =>
            prev ? { ...prev, routes: res.routes } : prev,
        );
      } else {
        void queryClient.invalidateQueries({
          queryKey: ["composer", "model-settings"],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["composer", "providers"],
      });
    },
  });

  const setFastMutation = useMutation({
    mutationFn: (tier: ServiceTier) =>
      callRpc("settings.models.setFast", {
        tier,
        sessionId: sessionId ?? undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["composer", "model-settings"],
      });
    },
  });

  const setCacheTtlMutation = useMutation({
    mutationFn: (ttl: CacheTtl) =>
      callRpc("settings.models.setCacheTtl", {
        ttl,
        sessionId: sessionId ?? undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["composer", "model-settings"],
      });
    },
  });

  // Preserve exact backend order from live discovered routes (fallback to FALLBACK_MODELS only when empty/offline),
  // enriched with live provider auth metadata.
  const models: readonly ModelOption[] = (() => {
    const providers = providersQuery.data?.providers ?? [];
    const providerMap = new Map(providers.map((p) => [p.id, p]));
    const liveRoutes = modelSettingsQuery.data?.routes;
    const baseList: ModelOption[] =
      liveRoutes && liveRoutes.length > 0
        ? liveRoutes.map(mapRouteToModelOption)
        : [...FALLBACK_MODELS];

    const configuredDefault = modelSettingsQuery.data?.defaultModel;
    if (
      configuredDefault &&
      !baseList.some((m) => m.id === configuredDefault)
    ) {
      baseList.unshift({
        id: configuredDefault,
        label: configuredDefault,
        provider: "rayu-cloud",
        subtitle: "Configured runtime model",
        available: true,
      });
    }

    return baseList.map((m) => {
      const p = providerMap.get(m.provider);
      if (!p) return m;
      return {
        ...m,
        authMethod: p.authMethod ?? m.authMethod,
        accountLabel: p.accountLabel ?? p.name ?? m.accountLabel,
        available: m.available !== false && p.status !== "expired",
        unavailableReason:
          p.status === "needs_key"
            ? `Requires ${p.name} API key`
            : p.status === "expired"
              ? `${p.name} session expired`
              : undefined,
      };
    });
  })();

  const defaultModelId =
    modelSettingsQuery.data?.defaultModel ?? DEFAULT_MODEL_ID;
  const matchedDefault = models.find((m) => m.id === defaultModelId);
  const defaultModelLabel = matchedDefault?.label ?? DEFAULT_MODEL_LABEL;
  const defaultEffort: EffortLevel = normalizeEffortLevel(
    modelSettingsQuery.data?.defaultEffort ?? DEFAULT_EFFORT,
  );
  const serviceTier: ServiceTier =
    modelSettingsQuery.data?.serviceTier ?? DEFAULT_SERVICE_TIER;
  const cacheTtl: CacheTtl =
    modelSettingsQuery.data?.cacheTtl ?? DEFAULT_CACHE_TTL;

  return {
    models,
    defaultModelId,
    defaultModelLabel,
    defaultEffort,
    serviceTier,
    cacheTtl,
    isRefreshing: refreshMutation.isPending,
    refreshModels: () => refreshMutation.mutateAsync(),
    setServiceTier: (tier: ServiceTier) => setFastMutation.mutateAsync(tier),
    setCacheTtl: (ttl: CacheTtl) => setCacheTtlMutation.mutateAsync(ttl),
  };
}

export function useWorkspaceFilesSearch(
  query: string,
  enabled: boolean,
  sessionId?: string | null,
) {
  return useQuery({
    ...workspaceFilesQueryOptions(query, sessionId),
    enabled,
  });
}

export function useSlashCommandsCatalog(
  query: string,
  enabled: boolean,
): {
  commands: SlashCommandItem[];
  isLoading: boolean;
} {
  const skillsQuery = useQuery({
    ...skillsListQueryOptions(),
    enabled,
  });

  const allCommands: SlashCommandItem[] = [
    ...BUILTIN_SLASH_COMMANDS,
    ...(skillsQuery.data?.skills ?? []).map((skill) => ({
      command: `/${skill.name.replace(/^\/+/, "")}`,
      insertText: `/${skill.name.replace(/^\/+/, "")} `,
      description: skill.description,
      kind: "skill" as const,
      category: skill.category ?? "Skill",
    })),
  ];

  const cleanQuery = query.trim().replace(/^\/+/, "").toLowerCase();
  const filtered = cleanQuery
    ? allCommands.filter(
        (item) =>
          item.command.toLowerCase().includes(cleanQuery) ||
          item.description.toLowerCase().includes(cleanQuery) ||
          (item.category ?? "").toLowerCase().includes(cleanQuery),
      )
    : allCommands;

  return {
    commands: filtered,
    isLoading: skillsQuery.isLoading,
  };
}

export function useCreateSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      workingDir?: string;
      permissionMode?: PermissionModeId;
      model?: string;
    }) => callRpc("sessions.create", params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
