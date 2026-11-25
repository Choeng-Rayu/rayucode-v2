import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Bot,
  Check,
  ChevronDown,
  Cpu,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentProfileView,
  AgentRoleId,
  ModelRouteOptionView,
} from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSkeleton } from "@/components/ui/page-skeletons";
import { NavGlyph } from "@/components/ui/rayu-symbols";
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatHarnessModelSpec,
  formatProviderBadgeLabel,
} from "@/features/composer";
import { useAppStore } from "@/lib/app-store";
import { callRpc } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

export interface AgentsPersonasViewProps {
  className?: string;
}

type AgentScope = "global" | "session";
type EffortOption = "auto" | "low" | "medium" | "high" | "xhigh" | "max";

interface RoleMeta {
  id: AgentRoleId;
  label: string;
  configKey: string;
  description: string;
}

interface PersonaPreset {
  name: string;
  label: string;
  effort: EffortOption;
  description: string;
  hint: string;
}

const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const RESERVED_NAMES = new Set(["inherit", "coordinator", "default"]);

const ROLE_DEFS: ReadonlyArray<RoleMeta> = [
  {
    id: "swarm",
    label: "Swarm Workers",
    configKey: "agents.swarm_model",
    description:
      "Default model or persona assigned to delegated swarm & subagent workers.",
  },
  {
    id: "review",
    label: "Code Review",
    configKey: "autoreview.model",
    description:
      "Reviews patches, catches regressions, and runs /review and autoreview passes.",
  },
  {
    id: "judge",
    label: "Acceptance Judge",
    configKey: "autojudge.model",
    description:
      "Verifies acceptance criteria, test coverage, and completion gates (/judge).",
  },
  {
    id: "memory",
    label: "Memory Extraction",
    configKey: "agents.memory_model",
    description:
      "Extracts durable facts, project rules, and semantic context across sessions.",
  },
  {
    id: "ambient",
    label: "Ambient Cycles",
    configKey: "ambient.model",
    description:
      "Runs background wake cycles, health checks, and overnight maintenance.",
  },
];

const EFFORT_OPTIONS: ReadonlyArray<{ value: EffortOption; label: string }> = [
  { value: "auto", label: "Auto (model default)" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

const PERSONA_PRESETS: ReadonlyArray<PersonaPreset> = [
  {
    name: "coder",
    label: "Implementation Coder",
    effort: "medium",
    description:
      "Focused feature implementation, surgical edits, refactoring, and targeted unit tests.",
    hint: "sonnet",
  },
  {
    name: "architect",
    label: "Systems Architect",
    effort: "high",
    description:
      "Deep design tradeoffs, cross-crate API boundaries, concurrency review, and root-cause debugging.",
    hint: "opus",
  },
  {
    name: "research",
    label: "Codebase Researcher",
    effort: "medium",
    description:
      "Read-only codebase exploration, long-document analysis, dependency audits, and API discovery.",
    hint: "gemini",
  },
  {
    name: "reviewer",
    label: "Security & Quality Reviewer",
    effort: "high",
    description:
      "Strict diff review for regressions, edge cases, access-control checks, and test completeness.",
    hint: "opus",
  },
  {
    name: "fast-triage",
    label: "Fast Triage & Fixes",
    effort: "low",
    description:
      "High-throughput log triage, formatting checks, quick grep lookups, and mechanical updates.",
    hint: "mini",
  },
];

const FALLBACK_MODELS = [
  "rayu:claude-sonnet-4-5",
  "rayu:claude-opus-4-5",
  "openai:gpt-5",
  "gemini:gemini-2.5-pro",
] as const;

interface PersonaDraft {
  editingExisting: boolean;
  name: string;
  model: string;
  customModel: string;
  useCustomModel: boolean;
  effort: EffortOption;
  description: string;
  scope: AgentScope;
}

function buildConfigPreview(
  roleOverrides: ReadonlyArray<{ role: AgentRoleId; model: string; scope: string }>,
  profiles: ReadonlyArray<AgentProfileView>,
): string {
  const lines: string[] = ["[agents]"];
  const findGlobal = (role: AgentRoleId) => {
    const row = roleOverrides.find((r) => r.role === role);
    if (!row || row.model === "inherit" || row.model === "default") return null;
    return row.model;
  };
  const swarm = findGlobal("swarm");
  const memory = findGlobal("memory");
  const review = findGlobal("review");
  const judge = findGlobal("judge");
  const ambient = findGlobal("ambient");
  if (swarm) lines.push(`swarm_model = "${swarm}"`);
  if (memory) lines.push(`memory_model = "${memory}"`);
  if (review) lines.push("", "[autoreview]", `model = "${review}"`);
  if (judge) lines.push("", "[autojudge]", `model = "${judge}"`);
  if (ambient) lines.push("", "[ambient]", `model = "${ambient}"`);
  for (const profile of profiles) {
    lines.push(
      "",
      `# ${profile.scope === "global" ? "Global (~/.rayu/config.toml)" : "Session override"}`,
      "[[agents.profiles]]",
      `name = "${profile.name}"`,
      `model = "${profile.model}"`,
    );
    if (profile.effort) lines.push(`effort = "${profile.effort}"`);
    if (profile.description) {
      lines.push(
        `description = "${profile.description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
      );
    }
  }
  if (lines.length === 1) {
    lines.push("# Workers inherit the active session model by default.");
  }
  return lines.join("\n");
}

function toModelSpec(r: ModelRouteOptionView): string {
  const rawModel = r.model || r.id;
  return (
    r.modelSpec ||
    formatHarnessModelSpec(rawModel, r.provider, r.apiMethod) ||
    rawModel
  );
}

export function AgentsPersonasView({ className }: AgentsPersonasViewProps) {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const daemonStatus = useAppStore((s) => s.daemonStatus);

  const [scope, setScope] = React.useState<AgentScope>("global");
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<PersonaDraft>({
    editingExisting: false,
    name: "",
    model: FALLBACK_MODELS[0],
    customModel: "",
    useCustomModel: false,
    effort: "medium",
    description: "",
    scope: "global",
  });
  const [formErrors, setFormErrors] = React.useState<{
    name?: string;
    model?: string;
  }>({});

  const modelsQuery = useQuery({
    queryKey: ["settings", "models", activeSessionId ?? "global"],
    queryFn: () =>
      callRpc("settings.models.get", {
        sessionId: activeSessionId ?? undefined,
      }),
    staleTime: 10_000,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
    void queryClient.invalidateQueries({
      queryKey: ["composer", "model-settings"],
    });
  };

  const setRoleMutation = useMutation({
    mutationFn: (input: {
      role: AgentRoleId;
      model: string;
      scope: AgentScope;
    }) =>
      callRpc("settings.models.setRoleOverride", {
        ...input,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (_res, input) => {
      invalidateAll();
      const label =
        ROLE_DEFS.find((r) => r.id === input.role)?.label ?? input.role;
      const msg = `Updated ${label} [${input.scope}] to ${input.model}.`;
      setStatusMessage(msg);
      toast.success(msg);
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to update role override.";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const setSubagentMutation = useMutation({
    mutationFn: (input: { model: string; scope: AgentScope }) =>
      callRpc("settings.agents.setSubagentModel", {
        ...input,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (_res, input) => {
      invalidateAll();
      const msg = `Default subagent model [${input.scope}] set to ${input.model}.`;
      setStatusMessage(msg);
      toast.success(msg);
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to update subagent default model.";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const upsertProfileMutation = useMutation({
    mutationFn: (input: {
      name: string;
      model: string;
      effort: string | null;
      description: string;
      scope: AgentScope;
    }) =>
      callRpc("settings.agents.upsertProfile", {
        ...input,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (_res, input) => {
      invalidateAll();
      setDialogOpen(false);
      const msg = `Saved ${input.scope} persona "${input.name}" (${input.model}).`;
      setStatusMessage(msg);
      toast.success(msg);
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to save agent persona.";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (input: { name: string; scope: AgentScope }) =>
      callRpc("settings.agents.deleteProfile", {
        ...input,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (_res, input) => {
      invalidateAll();
      const msg = `Removed ${input.scope} persona "${input.name}".`;
      setStatusMessage(msg);
      toast.info(msg);
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to delete agent persona.";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const refreshModelsMutation = useMutation({
    mutationFn: () =>
      callRpc("settings.models.refresh", {
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: () => {
      invalidateAll();
      void modelsQuery.refetch();
      toast.success("Refreshed live model catalog.");
    },
  });

  const data = modelsQuery.data;
  const profiles: AgentProfileView[] = React.useMemo(
    () => data?.profiles ?? [],
    [data],
  );
  const roleOverrides = React.useMemo(
    () => data?.roleOverrides ?? [],
    [data],
  );

  const modelChoices = React.useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const routes = data?.routes ?? [];
    if (routes.length > 0) {
      const ordered = [
        ...routes.filter((r) => r.available !== false),
        ...routes.filter((r) => r.available === false),
      ];
      for (const r of ordered) {
        const value = toModelSpec(r);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        const badge = formatProviderBadgeLabel(r.provider);
        out.push({ value, label: `${r.label || r.model} (${badge})` });
      }
    } else {
      for (const m of FALLBACK_MODELS) {
        seen.add(m);
        out.push({ value: m, label: m });
      }
    }
    if (data?.defaultModel && !seen.has(data.defaultModel)) {
      seen.add(data.defaultModel);
      out.unshift({ value: data.defaultModel, label: data.defaultModel });
    }
    return out;
  }, [data]);

  const roleSelectChoices = React.useMemo(() => {
    const out: Array<{ value: string; label: string }> = [
      { value: "inherit", label: "Inherit active session model" },
      { value: "default", label: "Use global default" },
    ];
    const seen = new Set<string>(["inherit", "default"]);

    for (const p of profiles) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      out.push({
        value: p.name,
        label: `Persona: ${p.name} (${p.model})`,
      });
    }
    for (const choice of modelChoices) {
      if (seen.has(choice.value)) continue;
      seen.add(choice.value);
      out.push(choice);
    }
    for (const row of roleOverrides) {
      if (row.model && !seen.has(row.model)) {
        seen.add(row.model);
        out.push({ value: row.model, label: row.model });
      }
    }
    if (data?.subagentModel && !seen.has(data.subagentModel)) {
      seen.add(data.subagentModel);
      out.push({ value: data.subagentModel, label: data.subagentModel });
    }
    return out;
  }, [data, modelChoices, profiles, roleOverrides]);

  const openCreateDialog = (preset?: PersonaPreset) => {
    const defaultModel = (() => {
      if (!preset) return modelChoices[0]?.value ?? FALLBACK_MODELS[0];
      const hint = preset.hint.toLowerCase();
      const hit = modelChoices.find(
        (c) =>
          c.value.toLowerCase().includes(hint) ||
          c.label.toLowerCase().includes(hint),
      );
      return hit?.value ?? modelChoices[0]?.value ?? FALLBACK_MODELS[0];
    })();
    setFormErrors({});
    setDraft({
      editingExisting: false,
      name: preset?.name ?? "",
      model: defaultModel,
      customModel: "",
      useCustomModel: false,
      effort: preset?.effort ?? "medium",
      description: preset?.description ?? "",
      scope,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (profile: AgentProfileView) => {
    const known = modelChoices.some((c) => c.value === profile.model);
    const effortVal = (profile.effort ?? "auto") as EffortOption;
    setFormErrors({});
    setDraft({
      editingExisting: true,
      name: profile.name,
      model: known ? profile.model : (modelChoices[0]?.value ?? FALLBACK_MODELS[0]),
      customModel: known ? "" : profile.model,
      useCustomModel: !known,
      effort: EFFORT_OPTIONS.some((o) => o.value === effortVal)
        ? effortVal
        : "auto",
      description: profile.description,
      scope: profile.scope,
    });
    setDialogOpen(true);
  };

  const handleSavePersona = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = draft.name.trim().toLowerCase();
    const cleanModel = draft.useCustomModel
      ? draft.customModel.trim()
      : draft.model.trim();
    const errs: { name?: string; model?: string } = {};
    if (!cleanName || !PROFILE_NAME_PATTERN.test(cleanName)) {
      errs.name = "Use 1–32 lowercase letters, digits, '-' or '_'.";
    } else if (RESERVED_NAMES.has(cleanName)) {
      errs.name = "Name cannot be 'inherit', 'coordinator', or 'default'.";
    }
    if (!cleanModel) {
      errs.model = "Select or enter a model route.";
    }
    if (errs.name || errs.model) {
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    upsertProfileMutation.mutate({
      name: cleanName,
      model: cleanModel,
      effort: draft.effort === "auto" ? null : draft.effort,
      description: draft.description.trim(),
      scope: draft.scope,
    });
  };

  if (modelsQuery.isPending && !data) {
    return <SettingsSkeleton />;
  }

  if (modelsQuery.isError || !data) {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-10">
        <ErrorState
          title="Unable to load Agents & Personas"
          description={
            modelsQuery.error instanceof Error
              ? modelsQuery.error.message
              : "Failed to query subagent models and agent profiles from the Rust daemon."
          }
          onRetry={() => void modelsQuery.refetch()}
        />
      </div>
    );
  }

  const swarmRow = roleOverrides.find((r) => r.role === "swarm");
  const currentSubagentValue =
    scope === "global"
      ? (swarmRow?.model ?? "inherit")
      : (data.subagentModel ?? swarmRow?.model ?? "inherit");
  const isDaemonConnected = daemonStatus.state === "connected";
  const configPreview = buildConfigPreview(roleOverrides, profiles);

  return (
    <SectionErrorBoundary title="Agents & Personas Error">
      <div
        data-slot="agents-view"
        data-testid="agents-view"
        className={cn(
          "h-full w-full flex-1 overflow-y-auto bg-canvas",
          className,
        )}
      >
        <div className="mx-auto flex w-full max-w-[940px] flex-col gap-6 px-4 pt-6 pb-20 sm:px-6 md:px-10">
          {/* Header */}
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <NavGlyph icon="agents" className="text-brand-text" />
                <h1 className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink">
                  Agents &amp; Personas
                </h1>
                <span
                  data-testid="agents-sync-badge"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                    isDaemonConnected
                      ? "bg-brand-soft text-brand-text"
                      : "bg-warn-soft text-warn",
                  )}
                >
                  {isDaemonConnected ? "Live Rust sync" : "Daemon offline"}
                </span>
              </div>
              <p className="mt-1 max-w-[66ch] text-xs text-muted-ink">
                Configure default subagent models, assign specialized models or
                personas to each agent role, and design reusable{" "}
                <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                  [[agents.profiles]]
                </code>{" "}
                personas shared with CLI and Desktop.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Configuration scope"
                className="inline-flex items-center rounded-lg border border-hairline bg-pane p-[2px]"
              >
                {(
                  [
                    { id: "global", label: "Global" },
                    { id: "session", label: "This Session" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`agents-scope-${opt.id}`}
                    aria-pressed={scope === opt.id}
                    onClick={() => setScope(opt.id)}
                    className={cn(
                      "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium",
                      scope === opt.id
                        ? "border border-premium bg-active text-ink"
                        : "text-muted-ink hover:text-ink",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={refreshModelsMutation.isPending}
                onClick={() => refreshModelsMutation.mutate()}
                data-testid="agents-refresh-btn"
              >
                <RefreshCw
                  className={cn(
                    "size-3.5",
                    refreshModelsMutation.isPending && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                <span>Refresh</span>
              </Button>

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => openCreateDialog()}
                data-testid="agents-new-persona-btn"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                <span>New Persona</span>
              </Button>
            </div>
          </header>

          {statusMessage && (
            <div
              data-testid="agents-status-banner"
              className="rounded-xl border border-brand/30 bg-brand-soft px-4 py-2 text-xs text-ink"
            >
              {statusMessage}
            </div>
          )}

          {/* Section 1: Default Subagent Model + 5 Per-Role Routing Targets */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-ink" aria-hidden="true" />
                <h2 className="m-0 text-sm font-semibold text-ink">
                  Subagent &amp; Per-Role Model Routing
                </h2>
              </div>
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-muted-ink">
                {scope === "global"
                  ? (data.configPath ?? "~/.rayu/config.toml")
                  : `session ${activeSessionId ?? "active"}`}
              </code>
            </div>

            <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane">
              {/* Default Subagent Model */}
              <div
                data-testid="agents-subagent-model-row"
                className="flex flex-wrap items-center justify-between gap-3 bg-raised/40 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    <span>Default Subagent Model</span>
                    <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-brand-text">
                      /subagent-model
                    </code>
                  </div>
                  <div className="mt-0.5 text-muted-ink">
                    Used when spawning subagents without a role or persona
                    override.
                    {data.inheritModel && (
                      <>
                        {" "}
                        Inherits{" "}
                        <code className="rounded bg-inset px-1 py-0.5 font-mono text-[10.5px] text-body">
                          {data.inheritModel}
                        </code>
                        .
                      </>
                    )}
                  </div>
                </div>
                <Select
                  value={currentSubagentValue}
                  disabled={setSubagentMutation.isPending}
                  onValueChange={(value) =>
                    setSubagentMutation.mutate({ model: value, scope })
                  }
                >
                  <SelectTrigger
                    aria-label="Default Subagent Model"
                    data-testid="agents-subagent-model-select"
                    className="w-full sm:w-[250px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {roleSelectChoices.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 5 Per-Role Overrides */}
              {ROLE_DEFS.map((roleDef) => {
                const row = roleOverrides.find((r) => r.role === roleDef.id);
                const effective = data.effectiveRoleModels?.[roleDef.id];
                const currentVal = row?.model ?? "inherit";
                const resolvedFromPersona =
                  effective &&
                  currentVal !== "inherit" &&
                  currentVal !== "default" &&
                  effective !== currentVal;

                return (
                  <div
                    key={roleDef.id}
                    data-testid={`agents-role-row-${roleDef.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        <span>{roleDef.label}</span>
                        <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-muted-ink">
                          {roleDef.configKey}
                        </code>
                        {row?.scope === "session" && (
                          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand-text">
                            Session override
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-muted-ink">
                        {roleDef.description}
                        {resolvedFromPersona && (
                          <span className="ml-1.5 font-mono text-[10.5px] text-brand-text">
                            Resolves to {effective}
                          </span>
                        )}
                      </div>
                    </div>

                    <Select
                      value={currentVal}
                      disabled={setRoleMutation.isPending}
                      onValueChange={(nextModel) =>
                        setRoleMutation.mutate({
                          role: roleDef.id,
                          model: nextModel,
                          scope,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`${roleDef.label} model`}
                        data-testid={`agents-role-select-${roleDef.id}`}
                        className="w-full sm:w-[250px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {roleSelectChoices.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section 2: Agent Personas & Profiles Studio */}
          <section className="border-t border-hairline pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-brand-text" aria-hidden="true" />
                  <h2 className="m-0 text-sm font-semibold text-ink">
                    Agent Personas &amp; Profiles
                  </h2>
                  <span
                    data-testid="agents-profile-count"
                    className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-muted-ink tabular-nums"
                  >
                    {profiles.length} configured
                  </span>
                </div>
                <p className="mt-1 max-w-[66ch] text-xs text-muted-ink">
                  Design named specialist personas with a model route, reasoning
                  effort, and delegation brief. The coordinator assigns matching
                  personas to workers automatically, or you can bind any persona
                  to a role above.
                </p>
              </div>
            </div>

            {/* Quick-Start Blueprints */}
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-ink">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Quick blueprints:
              </span>
              {PERSONA_PRESETS.map((preset) => {
                const exists = profiles.some(
                  (p) => p.name.toLowerCase() === preset.name.toLowerCase(),
                );
                return (
                  <button
                    key={preset.name}
                    type="button"
                    data-testid={`agents-preset-${preset.name}`}
                    onClick={() => openCreateDialog(preset)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      exists
                        ? "border-hairline bg-inset text-muted-ink hover:border-premium hover:text-ink"
                        : "border-hairline bg-pane text-body hover:border-brand hover:bg-brand-soft hover:text-brand-text",
                    )}
                  >
                    {exists ? (
                      <Check className="size-3" aria-hidden="true" />
                    ) : (
                      <Plus className="size-3" aria-hidden="true" />
                    )}
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>

            {profiles.length === 0 ? (
              <div
                data-testid="agents-empty-profiles"
                className="rayu-card-bevel flex flex-col items-center justify-center rounded-xl border border-dashed border-premium bg-pane px-6 py-8 text-center"
              >
                <Bot className="size-6 text-muted-ink" aria-hidden="true" />
                <div className="mt-2 text-xs font-medium text-ink">
                  No agent personas configured yet
                </div>
                <p className="mt-1 max-w-[46ch] text-xs text-muted-ink">
                  Pick a quick blueprint above or design a custom persona to
                  assign models and roles to subagents.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  onClick={() => openCreateDialog()}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>Create Persona</span>
                </Button>
              </div>
            ) : (
              <div
                data-testid="agents-profiles-grid"
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                {profiles.map((profile) => (
                  <div
                    key={`${profile.scope}:${profile.name}`}
                    data-testid={`agents-profile-card-${profile.name}`}
                    className="rayu-card-bevel flex flex-col justify-between gap-3 rounded-xl border border-premium bg-pane p-4"
                  >
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold text-ink">
                            {profile.name}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              profile.scope === "global"
                                ? "bg-raised text-body"
                                : "bg-brand-soft text-brand-text",
                            )}
                          >
                            {profile.scope === "global" ? "Global" : "Session"}
                          </span>
                          {profile.effort && (
                            <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10px] text-muted-ink">
                              effort: {profile.effort}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Edit persona ${profile.name}`}
                            data-testid={`agents-edit-profile-${profile.name}`}
                            onClick={() => openEditDialog(profile)}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete persona ${profile.name}`}
                            data-testid={`agents-delete-profile-${profile.name}`}
                            disabled={deleteProfileMutation.isPending}
                            onClick={() =>
                              deleteProfileMutation.mutate({
                                name: profile.name,
                                scope: profile.scope,
                              })
                            }
                          >
                            <Trash2
                              className="size-3.5 text-danger"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2">
                        <code className="inline-block rounded border border-hairline bg-inset px-2 py-0.5 font-mono text-[11px] text-brand-text">
                          {profile.model}
                        </code>
                      </div>

                      <p className="mt-2 text-xs leading-relaxed text-body">
                        {profile.description ||
                          "No delegation brief set — edit to describe when the coordinator should use this persona."}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-hairline-soft pt-2.5">
                      <span className="text-[11px] text-muted-ink">
                        Assign to role ({scope})
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="default"
                            size="xs"
                            data-testid={`agents-assign-profile-${profile.name}`}
                          >
                            <span>Assign</span>
                            <ChevronDown className="size-3" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              setSubagentMutation.mutate({
                                model: profile.name,
                                scope,
                              })
                            }
                          >
                            Default Subagent (/subagent-model)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {ROLE_DEFS.map((roleDef) => (
                            <DropdownMenuItem
                              key={roleDef.id}
                              onSelect={() =>
                                setRoleMutation.mutate({
                                  role: roleDef.id,
                                  model: profile.name,
                                  scope,
                                })
                              }
                            >
                              {roleDef.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Section 3: Swarm Allowlist & Live Config Preview */}
          <section className="border-t border-hairline pt-5">
            {data.swarmAllowlist && data.swarmAllowlist.length > 0 && (
              <div
                data-testid="agents-swarm-allowlist"
                className="mb-4 rounded-xl border border-hairline bg-pane p-3.5 text-xs"
              >
                <div className="flex items-center gap-1.5 font-medium text-ink">
                  <Shield className="size-3.5 text-brand-text" aria-hidden="true" />
                  <span>Swarm Model Allowlist (agents.swarm_model_allowlist)</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.swarmAllowlist.map((id) => (
                    <code
                      key={id}
                      className="rounded-full border border-hairline bg-inset px-2.5 py-0.5 font-mono text-[11px] text-brand-text"
                    >
                      {id}
                    </code>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-2 flex items-center justify-between text-xs text-muted-ink">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <SlidersHorizontal
                  className="size-3.5 text-muted-ink"
                  aria-hidden="true"
                />
                <span>Live Rust config preview</span>
              </span>
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                {data.configPath ?? "~/.rayu/config.toml"}
              </code>
            </div>
            <pre
              data-testid="agents-config-preview"
              className="overflow-x-auto rounded-xl border border-hairline bg-inset px-3.5 py-3 font-mono text-[11px] leading-[1.6] text-body"
            >
              {configPreview}
            </pre>
          </section>
        </div>

        {/* Create / Edit Persona Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent
            data-testid="agents-persona-dialog"
            className="max-w-[500px]"
          >
            <DialogHeader>
              <DialogTitle>
                {draft.editingExisting
                  ? `Edit Persona "${draft.name}"`
                  : "Design Agent Persona"}
              </DialogTitle>
              <DialogDescription>
                Define a named worker persona synced with the Rust daemon.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={handleSavePersona}
              noValidate
              className="mt-2 flex flex-col gap-3.5"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="vs-persona-name"
                    className="text-xs font-medium text-body"
                  >
                    Persona slug
                  </label>
                  <input
                    id="vs-persona-name"
                    data-testid="persona-name-input"
                    type="text"
                    value={draft.name}
                    disabled={draft.editingExisting}
                    onChange={(e) => {
                      setDraft((prev) => ({ ...prev, name: e.target.value }));
                      if (formErrors.name) {
                        setFormErrors((prev) => ({ ...prev, name: undefined }));
                      }
                    }}
                    placeholder="e.g. coder, architect"
                    className={cn(
                      "h-8 rounded-lg border bg-inset px-3 font-mono text-xs text-ink outline-none focus:border-brand disabled:opacity-60",
                      formErrors.name ? "border-danger" : "border-premium",
                    )}
                  />
                  {formErrors.name && (
                    <span
                      data-testid="persona-name-error"
                      role="alert"
                      className="text-[11px] text-danger"
                    >
                      {formErrors.name}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="vs-persona-scope"
                    className="text-xs font-medium text-body"
                  >
                    Scope
                  </label>
                  <Select
                    value={draft.scope}
                    onValueChange={(v) =>
                      setDraft((prev) => ({ ...prev, scope: v as AgentScope }))
                    }
                  >
                    <SelectTrigger
                      id="vs-persona-scope"
                      data-testid="persona-scope-select"
                      aria-label="Persona scope"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">
                        Global (~/.rayu/config.toml)
                      </SelectItem>
                      <SelectItem value="session">This Session only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="vs-persona-model"
                    className="text-xs font-medium text-body"
                  >
                    Model route
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        useCustomModel: !prev.useCustomModel,
                        customModel: prev.customModel || prev.model,
                      }))
                    }
                    className="cursor-pointer text-[11px] font-medium text-brand-text hover:underline"
                  >
                    {draft.useCustomModel
                      ? "Pick from live catalog"
                      : "Enter custom route"}
                  </button>
                </div>

                {draft.useCustomModel ? (
                  <input
                    id="vs-persona-model"
                    data-testid="persona-custom-model-input"
                    type="text"
                    value={draft.customModel}
                    onChange={(e) => {
                      setDraft((prev) => ({
                        ...prev,
                        customModel: e.target.value,
                      }));
                      if (formErrors.model) {
                        setFormErrors((prev) => ({
                          ...prev,
                          model: undefined,
                        }));
                      }
                    }}
                    placeholder="provider:model (e.g. rayu:claude-opus-4-5)"
                    className={cn(
                      "h-8 rounded-lg border bg-inset px-3 font-mono text-xs text-ink outline-none focus:border-brand",
                      formErrors.model ? "border-danger" : "border-premium",
                    )}
                  />
                ) : (
                  <Select
                    value={draft.model}
                    onValueChange={(v) =>
                      setDraft((prev) => ({ ...prev, model: v }))
                    }
                  >
                    <SelectTrigger
                      id="vs-persona-model"
                      data-testid="persona-model-select"
                      aria-label="Persona model route"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelChoices.map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {formErrors.model && (
                  <span role="alert" className="text-[11px] text-danger">
                    {formErrors.model}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="vs-persona-effort"
                  className="text-xs font-medium text-body"
                >
                  Reasoning effort
                </label>
                <Select
                  value={draft.effort}
                  onValueChange={(v) =>
                    setDraft((prev) => ({
                      ...prev,
                      effort: v as EffortOption,
                    }))
                  }
                >
                  <SelectTrigger
                    id="vs-persona-effort"
                    data-testid="persona-effort-select"
                    aria-label="Persona reasoning effort"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EFFORT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="vs-persona-description"
                  className="text-xs font-medium text-body"
                >
                  Persona brief &amp; when to use
                </label>
                <textarea
                  id="vs-persona-description"
                  data-testid="persona-description-input"
                  rows={3}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Describe this persona's specialty and when the coordinator should delegate to it..."
                  className="rounded-lg border border-premium bg-inset px-3 py-2 text-xs leading-relaxed text-ink outline-none focus:border-brand"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={upsertProfileMutation.isPending}
                  data-testid="persona-save-btn"
                >
                  {upsertProfileMutation.isPending
                    ? "Saving..."
                    : draft.editingExisting
                      ? "Save changes"
                      : "Create persona"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </SectionErrorBoundary>
  );
}
