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

import { callRpc, isVsCodeWebview, useAppStore } from "@/lib";

import {
  BUILTIN_SLASH_COMMANDS,
  DEFAULT_CACHE_TTL,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LABEL,
  DEFAULT_SERVICE_TIER,
  FALLBACK_MODELS,
  formatHarnessModelSpec,
  normalizeEffortLevel,
  normalizeProviderIdForLookup,
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

function stripModelSpecPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) return trimmed;
  return trimmed.slice(colonIdx + 1) || trimmed;
}

function mapRouteToModelOption(route: ModelRouteOptionView): {
  option: ModelOption;
  explicitlyAvailable: boolean;
} {
  const id = route.model || route.id;
  const provider = normalizeProviderIdForLookup(route.provider || "rayu") || "rayu";
  const modelSpec =
    route.modelSpec ||
    formatHarnessModelSpec(id, route.provider || provider, route.apiMethod) ||
    id;
  return {
    option: {
      id,
      modelSpec,
      label: route.label || id,
      provider,
      apiMethod: route.apiMethod,
      authMethod: route.authMethod,
      accountLabel: route.accountLabel,
      subtitle:
        route.detail ||
        (route.pricingLabel ? route.pricingLabel : undefined) ||
        (route.available === false ? "Unavailable" : undefined),
      available: route.available !== false,
      supportedEfforts: route.supportsEffort === false ? [] : undefined,
    },
    explicitlyAvailable: route.available === true,
  };
}

export function useComposerModelCatalog(sessionId?: string | null) {
  const queryClient = useQueryClient();
  const accountStatus = useAppStore((s) => s.accountStatus);
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
      void queryClient.invalidateQueries({
        queryKey: ["settings", "models"],
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
      void queryClient.invalidateQueries({
        queryKey: ["settings", "models"],
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
      void queryClient.invalidateQueries({
        queryKey: ["settings", "models"],
      });
    },
  });

  // Preserve exact backend order from live discovered routes.
  // Never mix hardcoded FALLBACK_MODELS over real routes; in real VS Code webview return [] while loading/empty.
  const models: readonly ModelOption[] = (() => {
    const providers = providersQuery.data?.providers ?? [];
    const providerMap = new Map<string, (typeof providers)[number]>();
    for (const p of providers) {
      const normId = normalizeProviderIdForLookup(p.id);
      const existing = providerMap.get(normId);
      if (!existing || (existing.status !== "ready" && p.status === "ready")) {
        providerMap.set(normId, p);
      }
    }

    const liveRoutes = modelSettingsQuery.data?.routes;
    const baseEntries: Array<{
      option: ModelOption;
      explicitlyAvailable: boolean;
    }> =
      liveRoutes && liveRoutes.length > 0
        ? liveRoutes.map(mapRouteToModelOption)
        : isVsCodeWebview()
          ? []
          : FALLBACK_MODELS.map((m) => ({
              option: {
                ...m,
                provider: normalizeProviderIdForLookup(m.provider) || m.provider,
                modelSpec:
                  m.modelSpec ||
                  formatHarnessModelSpec(m.id, m.provider, m.apiMethod) ||
                  m.id,
              },
              explicitlyAvailable: false,
            }));

    return baseEntries.map(({ option: m, explicitlyAvailable }) => {
      const normProvider = normalizeProviderIdForLookup(m.provider) || m.provider;
      const p = providerMap.get(normProvider);

      if (normProvider === "rayu") {
        if (accountStatus?.signedIn) {
          return {
            ...m,
            provider: "rayu",
            available: m.available !== false,
            authMethod:
              m.authMethod ??
              (accountStatus.authMethod === "apiKey" ? "api_key" : "oauth"),
            accountLabel:
              m.accountLabel ??
              accountStatus.email ??
              accountStatus.displayName ??
              "Rayu Cloud",
            unavailableReason: undefined,
          };
        }
        if (accountStatus !== null && !accountStatus.signedIn) {
          return {
            ...m,
            provider: "rayu",
            available: false,
            unavailableReason: "Sign in to Rayu Cloud",
          };
        }
        if (p) {
          const unavailableByProvider =
            p.status === "expired" ||
            (p.status === "needs_key" && !explicitlyAvailable);
          return {
            ...m,
            provider: "rayu",
            authMethod: m.authMethod ?? p.authMethod,
            accountLabel: m.accountLabel ?? p.accountLabel ?? p.name,
            available: m.available !== false && !unavailableByProvider,
            unavailableReason:
              p.status === "expired"
                ? `${p.name} session expired`
                : p.status === "needs_key" && !explicitlyAvailable
                  ? "Sign in to Rayu Cloud"
                  : m.unavailableReason,
          };
        }
        return { ...m, provider: "rayu" };
      }

      if (!p) {
        return { ...m, provider: normProvider };
      }

      if (p.status === "expired") {
        return {
          ...m,
          provider: normProvider,
          authMethod: m.authMethod ?? p.authMethod,
          accountLabel: m.accountLabel ?? p.accountLabel ?? p.name,
          available: false,
          unavailableReason: `${p.name} session expired`,
        };
      }

      if (p.status === "needs_key" && !explicitlyAvailable) {
        return {
          ...m,
          provider: normProvider,
          authMethod: m.authMethod ?? p.authMethod,
          accountLabel: m.accountLabel ?? p.accountLabel ?? p.name,
          available: false,
          unavailableReason: `Requires ${p.name} API key`,
        };
      }

      return {
        ...m,
        provider: normProvider,
        authMethod: m.authMethod ?? p.authMethod,
        accountLabel: m.accountLabel ?? p.accountLabel ?? p.name,
        available: m.available !== false,
        unavailableReason:
          m.available === false
            ? (m.unavailableReason ??
              (p.status === "needs_key"
                ? `Requires ${p.name} API key`
                : undefined))
            : undefined,
      };
    });
  })();

  const configuredDefault =
    modelSettingsQuery.data?.defaultModel?.trim() || undefined;
  const matchedDefault: ModelOption | undefined = (() => {
    if (models.length === 0) return undefined;
    if (configuredDefault) {
      const exactSpecMatches = models.filter(
        (m) => m.modelSpec === configuredDefault,
      );
      if (exactSpecMatches.length > 0) {
        const best =
          exactSpecMatches.find((m) => m.available !== false) ??
          exactSpecMatches[0];
        if (best && best.available !== false) return best;
      }
      const idMatches = models.filter((m) => m.id === configuredDefault);
      if (idMatches.length > 0) {
        const best =
          idMatches.find((m) => m.available !== false) ?? idMatches[0];
        if (best && best.available !== false) return best;
      }
    }
    return models.find((m) => m.available !== false) ?? models[0];
  })();

  const defaultModelId =
    matchedDefault?.modelSpec ||
    matchedDefault?.id ||
    configuredDefault ||
    DEFAULT_MODEL_ID;
  const defaultModelLabel =
    matchedDefault?.label ||
    (configuredDefault
      ? stripModelSpecPrefix(configuredDefault)
      : DEFAULT_MODEL_LABEL) ||
    DEFAULT_MODEL_LABEL;
  const defaultEffort: EffortLevel = normalizeEffortLevel(
    modelSettingsQuery.data?.defaultEffort ?? DEFAULT_EFFORT,
  );
  const serviceTier: ServiceTier =
    modelSettingsQuery.data?.serviceTier ?? DEFAULT_SERVICE_TIER;
  const cacheTtl: CacheTtl =
    modelSettingsQuery.data?.cacheTtl ?? DEFAULT_CACHE_TTL;

  return {
    models,
    defaultModel: matchedDefault,
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
