import * as React from "react"
import {
  AlertCircle,
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
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ErrorState } from "@/components/ui/error-state"
import { AgentsSkeleton } from "@/components/ui/page-skeletons"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import {
  useAgentsState,
  useDeleteAgentProfile,
  useSetAgentRoleModel,
  useSetDefaultSubagentModel,
  useUpsertAgentProfile,
} from "../hooks/use-agents"
import {
  AGENT_EFFORT_OPTIONS,
  AGENT_PERSONA_PRESETS,
  AGENT_ROLE_DEFINITIONS,
  upsertAgentProfileInputSchema,
} from "../schemas"
import type {
  AgentEffortChoice,
  AgentPersonaPreset,
  AgentProfileItem,
  AgentRoleId,
  AgentScope,
  AgentsRouteOption,
} from "../types"

export interface AgentsViewProps {
  className?: string
}

const FALLBACK_MODEL_CHOICES: readonly string[] = [
  "rayu:claude-sonnet-4-5",
  "rayu:claude-opus-4-5",
  "openai:gpt-5",
  "gemini:gemini-2.5-pro",
]

interface PersonaDraft {
  editingExisting: boolean
  name: string
  model: string
  customModel: string
  useCustomModel: boolean
  effort: AgentEffortChoice
  description: string
  scope: AgentScope
}

function pickPresetModel(
  hint: string,
  routes: ReadonlyArray<AgentsRouteOption>,
  fallback: string
): string {
  const lowerHint = hint.toLowerCase()
  const available = routes.filter((r) => r.available)
  const match =
    available.find(
      (r) =>
        r.modelSpec.toLowerCase().includes(lowerHint) ||
        r.label.toLowerCase().includes(lowerHint)
    ) ?? available[0]
  return match?.modelSpec ?? fallback
}

function buildConfigPreview(
  defaults: Record<AgentRoleId, string | null>,
  profiles: ReadonlyArray<AgentProfileItem>
): string {
  const lines: string[] = ["[agents]"]
  if (defaults.swarm) lines.push(`swarm_model = "${defaults.swarm}"`)
  if (defaults.memory) lines.push(`memory_model = "${defaults.memory}"`)
  if (defaults.review) {
    lines.push("", "[autoreview]", `model = "${defaults.review}"`)
  }
  if (defaults.judge) {
    lines.push("", "[autojudge]", `model = "${defaults.judge}"`)
  }
  if (defaults.ambient) {
    lines.push("", "[ambient]", `model = "${defaults.ambient}"`)
  }
  for (const profile of profiles) {
    lines.push(
      "",
      `# ${profile.scope === "global" ? "Global (~/.rayu/config.toml)" : "Session override"}`,
      "[[agents.profiles]]",
      `name = "${profile.name}"`,
      `model = "${profile.model}"`
    )
    if (profile.effort) {
      lines.push(`effort = "${profile.effort}"`)
    }
    if (profile.description) {
      lines.push(
        `description = "${profile.description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
      )
    }
  }
  if (lines.length === 1) {
    lines.push(
      "# No overrides yet — workers inherit the active session model."
    )
  }
  return lines.join("\n")
}

export function AgentsView({ className }: AgentsViewProps) {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const { data, isPending, isError, error, refetch, isFetching } =
    useAgentsState(activeSessionId)

  const setRoleModelMutation = useSetAgentRoleModel(activeSessionId)
  const setSubagentModelMutation = useSetDefaultSubagentModel(activeSessionId)
  const upsertProfileMutation = useUpsertAgentProfile(activeSessionId)
  const deleteProfileMutation = useDeleteAgentProfile(activeSessionId)

  const [scope, setScope] = React.useState<AgentScope>("global")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<PersonaDraft>({
    editingExisting: false,
    name: "",
    model: FALLBACK_MODEL_CHOICES[0],
    customModel: "",
    useCustomModel: false,
    effort: "medium",
    description: "",
    scope: "global",
  })
  const [formErrors, setFormErrors] = React.useState<{
    name?: string
    model?: string
    description?: string
  }>({})

  const modelChoices = React.useMemo(() => {
    const out: Array<{ value: string; label: string }> = []
    const seen = new Set<string>()
    const routes = data?.routes ?? []
    const ordered = [
      ...routes.filter((r) => r.available),
      ...routes.filter((r) => !r.available),
    ]
    for (const r of ordered) {
      if (seen.has(r.modelSpec)) continue
      seen.add(r.modelSpec)
      const badge = r.provider && r.provider !== "default" ? ` (${r.provider})` : ""
      out.push({ value: r.modelSpec, label: `${r.label}${badge}` })
    }
    if (out.length === 0) {
      for (const fallback of FALLBACK_MODEL_CHOICES) {
        seen.add(fallback)
        out.push({ value: fallback, label: fallback })
      }
    }
    if (data?.inheritModel && !seen.has(data.inheritModel)) {
      seen.add(data.inheritModel)
      out.unshift({
        value: data.inheritModel,
        label: `${data.inheritModel} (active session)`,
      })
    }
    return out
  }, [data])

  const roleSelectOptions = React.useMemo(() => {
    const out: Array<{ value: string; label: string }> = [
      { value: "inherit", label: "Inherit active session model" },
      { value: "default", label: "Use global default" },
    ]
    const seen = new Set<string>(["inherit", "default"])

    for (const profile of data?.profiles ?? []) {
      if (seen.has(profile.name)) continue
      seen.add(profile.name)
      out.push({
        value: profile.name,
        label: `Persona: ${profile.name} (${profile.model})`,
      })
    }
    for (const choice of modelChoices) {
      if (seen.has(choice.value)) continue
      seen.add(choice.value)
      out.push(choice)
    }
    for (const roleDef of AGENT_ROLE_DEFINITIONS) {
      const current =
        scope === "global"
          ? data?.defaults[roleDef.id]
          : (data?.overrides[roleDef.id] ?? data?.defaults[roleDef.id])
      if (current && !seen.has(current)) {
        seen.add(current)
        out.push({ value: current, label: current })
      }
    }
    if (data?.subagentModel && !seen.has(data.subagentModel)) {
      seen.add(data.subagentModel)
      out.push({ value: data.subagentModel, label: data.subagentModel })
    }
    return out
  }, [data, modelChoices, scope])

  const openCreateDialog = (preset?: AgentPersonaPreset) => {
    const defaultModel = preset
      ? pickPresetModel(
          preset.preferredModelHint,
          data?.routes ?? [],
          modelChoices[0]?.value ?? FALLBACK_MODEL_CHOICES[0]
        )
      : (modelChoices[0]?.value ?? FALLBACK_MODEL_CHOICES[0])

    setFormErrors({})
    setDraft({
      editingExisting: false,
      name: preset?.name ?? "",
      model: defaultModel,
      customModel: "",
      useCustomModel: false,
      effort: preset?.effort ?? "medium",
      description: preset?.description ?? "",
      scope,
    })
    setDialogOpen(true)
  }

  const openEditDialog = (profile: AgentProfileItem) => {
    const knownInList = modelChoices.some((c) => c.value === profile.model)
    const effortVal = (profile.effort ?? "auto") as AgentEffortChoice
    setFormErrors({})
    setDraft({
      editingExisting: true,
      name: profile.name,
      model: knownInList
        ? profile.model
        : (modelChoices[0]?.value ?? FALLBACK_MODEL_CHOICES[0]),
      customModel: knownInList ? "" : profile.model,
      useCustomModel: !knownInList,
      effort: AGENT_EFFORT_OPTIONS.some((o) => o.value === effortVal)
        ? effortVal
        : "auto",
      description: profile.description,
      scope: profile.scope,
    })
    setDialogOpen(true)
  }

  const handleSavePersona = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const resolvedModel = draft.useCustomModel
      ? draft.customModel.trim()
      : draft.model.trim()
    const parsed = upsertAgentProfileInputSchema.safeParse({
      name: draft.name,
      model: resolvedModel,
      effort: draft.effort,
      description: draft.description,
      scope: draft.scope,
    })

    if (!parsed.success) {
      const nextErrors: { name?: string; model?: string; description?: string } =
        {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (key === "name" && !nextErrors.name) nextErrors.name = issue.message
        if (key === "model" && !nextErrors.model)
          nextErrors.model = issue.message
        if (key === "description" && !nextErrors.description)
          nextErrors.description = issue.message
      }
      setFormErrors(nextErrors)
      return
    }

    setFormErrors({})
    const result = await upsertProfileMutation.mutateAsync({
      name: parsed.data.name,
      model: parsed.data.model,
      effort: parsed.data.effort,
      description: parsed.data.description,
      scope: parsed.data.scope,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setDialogOpen(false)
    toast.success(
      `Saved ${parsed.data.scope} persona "${parsed.data.name}" (${parsed.data.model})`
    )
  }

  const handleDeletePersona = async (profile: AgentProfileItem) => {
    const result = await deleteProfileMutation.mutateAsync({
      name: profile.name,
      scope: profile.scope,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.info(`Removed ${profile.scope} persona "${profile.name}"`)
  }

  const handleSetRole = async (role: AgentRoleId, model: string) => {
    const result = await setRoleModelMutation.mutateAsync({
      role,
      model,
      scope,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    const roleLabel =
      AGENT_ROLE_DEFINITIONS.find((r) => r.id === role)?.label ?? role
    toast.success(`Updated ${roleLabel} [${scope}] to ${model}`)
  }

  const handleSetSubagentDefault = async (model: string) => {
    const result = await setSubagentModelMutation.mutateAsync({
      model,
      scope,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`Default subagent model [${scope}] set to ${model}`)
  }

  if (isPending) {
    return <AgentsSkeleton />
  }

  if (isError || !data) {
    return (
      <div className={cn("mx-auto max-w-[940px] px-6 py-10", className)}>
        <ErrorState
          title="Unable to load Agents & Personas"
          description={
            error instanceof Error
              ? error.message
              : "Could not read agent profiles and subagent routing from the Rust daemon."
          }
          onRetry={() => {
            void refetch()
          }}
        />
      </div>
    )
  }

  const isDaemonOffline = data.daemonConnected === false
  const currentSubagentValue =
    scope === "global"
      ? (data.defaults.swarm ?? "inherit")
      : (data.subagentModel ?? data.defaults.swarm ?? "inherit")
  const configPreview = buildConfigPreview(data.defaults, data.profiles)

  return (
    <div
      data-testid="agents-view"
      className={cn(
        "h-full w-full flex-1 overflow-y-auto bg-canvas",
        className
      )}
    >
      <div className="mx-auto w-full max-w-[940px] px-6 pt-7 pb-20 md:px-11">
        {/* Page Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="m-0 text-2xl font-medium tracking-[-0.025em] text-ink">
                Agents &amp; Personas
              </h1>
              <span
                data-testid="agents-daemon-badge"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  isDaemonOffline
                    ? "bg-danger-soft text-danger"
                    : "bg-brand-soft text-brand-text"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    isDaemonOffline ? "bg-danger" : "bg-brand-bright"
                  )}
                />
                {isDaemonOffline ? "Daemon offline" : "Live Rust sync"}
              </span>
            </div>
            <p className="mt-1.5 max-w-[66ch] text-[13px] leading-[1.45] text-muted-ink">
              Design reusable subagent personas, assign models and reasoning
              effort per worker specialization, and configure role routing for
              Swarm, Code Review, Acceptance Judge, Memory, and Ambient cycles.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Configuration scope"
              className="inline-flex items-center rounded-[10px] border border-hairline bg-pane p-0.5"
            >
              {(
                [
                  { id: "global", label: "Global Default" },
                  { id: "session", label: "This Session" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-testid={`agents-scope-${option.id}`}
                  aria-pressed={scope === option.id}
                  onClick={() => setScope(option.id)}
                  className={cn(
                    "cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    scope === option.id
                      ? "bg-active text-ink shadow-bevel-surface"
                      : "text-muted-ink hover:text-ink"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isFetching}
              data-testid="agents-refresh-btn"
              onClick={() => {
                void refetch()
              }}
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
                aria-hidden="true"
              />
              Refresh
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isDaemonOffline}
              data-testid="agents-new-persona-btn"
              onClick={() => openCreateDialog()}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New Persona
            </Button>
          </div>
        </header>

        {isDaemonOffline ? (
          <div
            data-testid="agents-daemon-offline-banner"
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-[12px] border border-premium bg-warn-soft px-4 py-3 text-xs text-warn"
          >
            <AlertCircle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Local Rust rayu daemon is not connected
              </div>
              <div className="mt-0.5 text-body">
                {data.daemonError ??
                  "Start the shared Rayu daemon to edit subagent models and agent personas."}
              </div>
            </div>
          </div>
        ) : null}

        {/* Section 1: Default Subagent Model + Per-Role Routing */}
        <section className="mt-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Cpu className="size-4 text-muted-ink" aria-hidden="true" />
              <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
                Subagent &amp; Per-Role Model Routing
              </h2>
            </div>
            <span className="text-xs text-muted-ink">
              Editing{" "}
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
                {scope === "global"
                  ? data.configPath
                  : `session ${data.sessionId ?? "active"}`}
              </code>
            </span>
          </div>

          <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane">
            {/* Default Subagent Model (/subagent-model) */}
            <div
              data-testid="agents-subagent-model-row"
              className="flex flex-wrap items-center justify-between gap-4 bg-raised/40 px-4 py-3.5 text-[13px]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <span>Default Subagent Model</span>
                  <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-brand-text">
                    /subagent-model
                  </code>
                </div>
                <div className="mt-0.5 text-xs text-muted-ink">
                  Model or persona used when spawning subagents without an
                  explicit override.
                  {data.inheritModel ? (
                    <>
                      {" "}
                      Inherits{" "}
                      <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                        {data.inheritModel}
                      </code>{" "}
                      when set to inherit.
                    </>
                  ) : null}
                </div>
              </div>

              <Select
                value={currentSubagentValue}
                disabled={isDaemonOffline || setSubagentModelMutation.isPending}
                onValueChange={(value) => {
                  void handleSetSubagentDefault(value)
                }}
              >
                <SelectTrigger
                  aria-label="Default Subagent Model"
                  data-testid="agents-subagent-model-select"
                  className="w-full sm:w-[270px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {roleSelectOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 5 Per-Role Targets */}
            {AGENT_ROLE_DEFINITIONS.map((roleDef) => {
              const sessionVal = data.overrides[roleDef.id]
              const globalVal = data.defaults[roleDef.id]
              const effectiveVal = data.effective[roleDef.id]
              const currentValue =
                scope === "global"
                  ? (globalVal ?? "inherit")
                  : (sessionVal ?? "default")
              const resolvedViaPersona =
                effectiveVal &&
                currentValue !== "default" &&
                currentValue !== "inherit" &&
                effectiveVal !== currentValue

              return (
                <div
                  key={roleDef.id}
                  data-testid={`agents-role-row-${roleDef.id}`}
                  className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-[13px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      <span>{roleDef.label}</span>
                      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-muted-ink">
                        {roleDef.configKey}
                      </code>
                      {sessionVal ? (
                        <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                          Session override
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      {roleDef.description}
                      {resolvedViaPersona ? (
                        <span className="ml-1.5 font-mono text-[11px] text-brand-text">
                          Resolves to {effectiveVal}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <Select
                    value={currentValue}
                    disabled={isDaemonOffline || setRoleModelMutation.isPending}
                    onValueChange={(value) => {
                      void handleSetRole(roleDef.id, value)
                    }}
                  >
                    <SelectTrigger
                      aria-label={`${roleDef.label} model`}
                      data-testid={`agents-role-select-${roleDef.id}`}
                      className="w-full sm:w-[270px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {roleSelectOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
          </div>
        </section>

        {/* Section 2: Agent Personas & Profiles Studio */}
        <section className="mt-8 border-t border-hairline pt-6">
          <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-brand-text" aria-hidden="true" />
                <h2 className="m-0 text-sm font-semibold tracking-[-0.015em] text-ink">
                  Agent Personas &amp; Profiles
                </h2>
                <span
                  data-testid="agents-profile-count"
                  className="inline-flex items-center rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-muted-ink tabular-nums"
                >
                  {data.profiles.length} configured
                </span>
              </div>
              <p className="mt-1 max-w-[66ch] text-xs text-muted-ink">
                Define named specialist personas (
                <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                  [[agents.profiles]]
                </code>
                ). The coordinator reads each persona&apos;s model, reasoning
                effort, and specialization brief when spawning workers — and any
                role above can reference a persona by name.
              </p>
            </div>
          </div>

          {/* Quick-Start Persona Blueprints */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-ink">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Quick blueprints:
            </span>
            {AGENT_PERSONA_PRESETS.map((preset) => {
              const exists = data.profiles.some(
                (p) => p.name.toLowerCase() === preset.name.toLowerCase()
              )
              return (
                <button
                  key={preset.name}
                  type="button"
                  disabled={isDaemonOffline}
                  data-testid={`agents-preset-${preset.name}`}
                  onClick={() => openCreateDialog(preset)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    exists
                      ? "border-hairline bg-inset text-muted-ink hover:border-premium hover:text-ink"
                      : "border-hairline bg-pane text-body hover:border-brand hover:bg-brand-soft hover:text-brand-text"
                  )}
                >
                  {exists ? (
                    <Check className="size-3" aria-hidden="true" />
                  ) : (
                    <Plus className="size-3" aria-hidden="true" />
                  )}
                  <span>{preset.label}</span>
                </button>
              )
            })}
          </div>

          {/* Saved Personas List */}
          {data.profiles.length === 0 ? (
            <div
              data-testid="agents-empty-profiles"
              className="rayu-card-bevel flex flex-col items-center justify-center rounded-[14px] border border-dashed border-premium bg-pane px-6 py-10 text-center"
            >
              <Bot
                className="size-7 text-muted-ink"
                aria-hidden="true"
              />
              <div className="mt-2.5 text-sm font-medium text-ink">
                No agent personas configured yet
              </div>
              <p className="mt-1 max-w-[46ch] text-xs text-muted-ink">
                Without named personas, the coordinator picks models from your
                live catalog automatically. Add a persona from a quick blueprint
                above or design your own specialist.
              </p>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="mt-4"
                disabled={isDaemonOffline}
                onClick={() => openCreateDialog()}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Create your first persona
              </Button>
            </div>
          ) : (
            <div
              data-testid="agents-profiles-grid"
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
            >
              {data.profiles.map((profile) => (
                <div
                  key={`${profile.scope}:${profile.name}`}
                  data-testid={`agents-profile-card-${profile.name}`}
                  className="rayu-card-bevel flex flex-col justify-between gap-3 rounded-[14px] border border-premium bg-pane p-4"
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-ink">
                          {profile.name}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                            profile.scope === "global"
                              ? "bg-raised text-body"
                              : "bg-brand-soft text-brand-text"
                          )}
                        >
                          {profile.scope === "global" ? "Global" : "Session"}
                        </span>
                        {profile.effort ? (
                          <span className="inline-flex items-center rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink">
                            effort: {profile.effort}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit persona ${profile.name}`}
                          data-testid={`agents-edit-profile-${profile.name}`}
                          onClick={() => openEditDialog(profile)}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete persona ${profile.name}`}
                          data-testid={`agents-delete-profile-${profile.name}`}
                          disabled={deleteProfileMutation.isPending}
                          onClick={() => {
                            void handleDeletePersona(profile)
                          }}
                        >
                          <Trash2
                            className="size-3.5 text-danger"
                            aria-hidden="true"
                          />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2">
                      <code className="inline-block rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-[11.5px] text-brand-text">
                        {profile.model}
                      </code>
                    </div>

                    <p className="mt-2.5 text-xs leading-relaxed text-body">
                      {profile.description ||
                        "No delegation brief set — edit to guide when the coordinator chooses this persona."}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-hairline-soft pt-3">
                    <span className="text-[11px] text-muted-ink">
                      Assign to role ({scope})
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={isDaemonOffline}
                          data-testid={`agents-assign-profile-${profile.name}`}
                        >
                          Assign
                          <ChevronDown className="size-3" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            void handleSetSubagentDefault(profile.name)
                          }}
                        >
                          Default Subagent (/subagent-model)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {AGENT_ROLE_DEFINITIONS.map((roleDef) => (
                          <DropdownMenuItem
                            key={roleDef.id}
                            onSelect={() => {
                              void handleSetRole(roleDef.id, profile.name)
                            }}
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
        <section className="mt-8 border-t border-hairline pt-6">
          {data.swarmAllowlist.length > 0 ? (
            <div
              data-testid="agents-swarm-allowlist"
              className="mb-5 rounded-[14px] border border-hairline bg-pane p-4"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-ink">
                <Shield className="size-3.5 text-brand-text" aria-hidden="true" />
                <span>Swarm Model Allowlist (agents.swarm_model_allowlist)</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.swarmAllowlist.map((modelId) => (
                  <code
                    key={modelId}
                    className="rounded-full border border-hairline bg-inset px-2.5 py-0.5 font-mono text-[11px] text-brand-text"
                  >
                    {modelId}
                  </code>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mb-2 flex items-center justify-between text-xs text-muted-ink">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <SlidersHorizontal className="size-3.5 text-muted-ink" aria-hidden="true" />
              Live Rust config preview
            </span>
            <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
              {data.configPath}
            </code>
          </div>
          <pre
            data-testid="agents-config-preview"
            className="overflow-x-auto rounded-[12px] border border-hairline bg-inset px-4 py-3 font-mono text-[11.5px] leading-[1.6] text-body"
          >
            {configPreview}
          </pre>
        </section>
      </div>

      {/* Create / Edit Persona Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          data-testid="agents-persona-dialog"
          className="max-w-[520px]"
        >
          <DialogHeader>
            <DialogTitle>
              {draft.editingExisting
                ? `Edit Persona "${draft.name}"`
                : "Design Agent Persona"}
            </DialogTitle>
            <DialogDescription>
              Create a named worker profile synced with the Rust daemon. The
              coordinator uses the persona&apos;s model, effort, and brief when
              delegating subagent tasks.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              void handleSavePersona(event)
            }}
            noValidate
            className="mt-2 flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="persona-name"
                  className="text-xs font-medium text-body"
                >
                  Persona slug
                </label>
                <input
                  id="persona-name"
                  data-testid="persona-name-input"
                  type="text"
                  value={draft.name}
                  disabled={draft.editingExisting}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, name: e.target.value }))
                    if (formErrors.name) {
                      setFormErrors((prev) => ({ ...prev, name: undefined }))
                    }
                  }}
                  placeholder="e.g. coder, architect, reviewer"
                  className={cn(
                    "h-9 rounded-[10px] border bg-inset px-3 font-mono text-xs text-ink outline-none placeholder:text-faint focus:border-brand disabled:opacity-60",
                    formErrors.name ? "border-danger" : "border-premium"
                  )}
                />
                {formErrors.name ? (
                  <span
                    data-testid="persona-name-error"
                    role="alert"
                    className="text-[11px] text-danger"
                  >
                    {formErrors.name}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-ink">
                    1–32 chars: lowercase letters, digits, - or _
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="persona-scope"
                  className="text-xs font-medium text-body"
                >
                  Scope
                </label>
                <Select
                  value={draft.scope}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      scope: value as AgentScope,
                    }))
                  }
                >
                  <SelectTrigger
                    id="persona-scope"
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
                  htmlFor="persona-model"
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
                  id="persona-model"
                  data-testid="persona-custom-model-input"
                  type="text"
                  value={draft.customModel}
                  onChange={(e) => {
                    setDraft((prev) => ({
                      ...prev,
                      customModel: e.target.value,
                    }))
                    if (formErrors.model) {
                      setFormErrors((prev) => ({ ...prev, model: undefined }))
                    }
                  }}
                  placeholder="provider:model (e.g. rayu:claude-opus-4-5)"
                  className={cn(
                    "h-9 rounded-[10px] border bg-inset px-3 font-mono text-xs text-ink outline-none placeholder:text-faint focus:border-brand",
                    formErrors.model ? "border-danger" : "border-premium"
                  )}
                />
              ) : (
                <Select
                  value={draft.model}
                  onValueChange={(value) =>
                    setDraft((prev) => ({ ...prev, model: value }))
                  }
                >
                  <SelectTrigger
                    id="persona-model"
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
              {formErrors.model ? (
                <span
                  data-testid="persona-model-error"
                  role="alert"
                  className="text-[11px] text-danger"
                >
                  {formErrors.model}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="persona-effort"
                className="text-xs font-medium text-body"
              >
                Reasoning effort
              </label>
              <Select
                value={draft.effort}
                onValueChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    effort: value as AgentEffortChoice,
                  }))
                }
              >
                <SelectTrigger
                  id="persona-effort"
                  data-testid="persona-effort-select"
                  aria-label="Persona reasoning effort"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_EFFORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="persona-description"
                className="text-xs font-medium text-body"
              >
                Persona brief &amp; when to use
              </label>
              <textarea
                id="persona-description"
                data-testid="persona-description-input"
                rows={3}
                value={draft.description}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, description: e.target.value }))
                  if (formErrors.description) {
                    setFormErrors((prev) => ({
                      ...prev,
                      description: undefined,
                    }))
                  }
                }}
                placeholder="Describe this agent's specialty, style, and when the coordinator should delegate to it..."
                className={cn(
                  "rounded-[10px] border bg-inset px-3 py-2 text-xs leading-relaxed text-ink outline-none placeholder:text-faint focus:border-brand",
                  formErrors.description ? "border-danger" : "border-premium"
                )}
              />
              {formErrors.description ? (
                <span role="alert" className="text-[11px] text-danger">
                  {formErrors.description}
                </span>
              ) : null}
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
  )
}
