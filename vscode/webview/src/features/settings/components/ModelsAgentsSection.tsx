import * as React from "react";
import { ArrowUpRight, Bot, RefreshCw } from "lucide-react";
import type {
  AgentProfileView,
  AgentRoleId,
  AgentRoleOverrideView,
  CacheTtl,
  ConfigFieldSchemaView,
  EffortChoice,
  ModelRouteOptionView,
  ServiceTier,
} from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

import {
  ConfigRestartBanner,
  ConfigScopeBadge,
  FieldApplyModeBadge,
  FieldValidationError,
  LegacyDaemonBanner,
  SectionErrorBanner,
} from "./ConfigSyncChrome";

export interface ModelsAgentsSectionProps {
  defaultModel: string;
  defaultEffort: EffortChoice;
  serviceTier: ServiceTier;
  cacheTtl: CacheTtl;
  routes?: ReadonlyArray<ModelRouteOptionView>;
  roleOverrides: ReadonlyArray<AgentRoleOverrideView>;
  profiles?: ReadonlyArray<AgentProfileView>;
  subagentModel?: string | null;
  swarmAllowlist?: ReadonlyArray<string>;
  configSupported?: boolean;
  configPath?: string;
  configSchema?: ReadonlyArray<ConfigFieldSchemaView>;
  configRequiresRestart?: boolean;
  configFieldErrors?: Readonly<Record<string, string>>;
  configSectionError?: string | null;
  onClearFieldError?: (key: string) => void;
  onClearSectionError?: () => void;
  onReloadDaemon?: () => Promise<unknown>;
  isReloadingDaemon?: boolean;
  onSelectDefaultModel: (model: string) => void;
  onSelectDefaultEffort: (effort: EffortChoice) => void;
  onSelectServiceTier: (tier: ServiceTier) => Promise<unknown>;
  onSelectCacheTtl: (ttl: CacheTtl) => Promise<unknown>;
  onSetRoleOverride: (input: {
    role: AgentRoleId;
    model: string;
    scope: "session" | "global";
  }) => Promise<unknown>;
  onOpenAgentsStudio?: () => void;
  onRefreshModels: () => Promise<unknown>;
  isRefreshingModels: boolean;
}

const DISCOVERED_MODEL_ROUTES = [
  "rayu:claude-sonnet-4-5",
  "rayu:claude-opus-4-5",
  "gpt-5.2",
  "gemini-2.5-pro",
  "deepseek-r1",
  "grok-3",
] as const;

export function ModelsAgentsSection({
  defaultModel,
  defaultEffort,
  serviceTier,
  cacheTtl,
  routes,
  roleOverrides,
  profiles,
  subagentModel,
  swarmAllowlist,
  configSupported = true,
  configPath = "~/.rayu/config.toml",
  configSchema = [],
  configRequiresRestart = false,
  configFieldErrors = {},
  configSectionError = null,
  onClearFieldError,
  onClearSectionError,
  onReloadDaemon,
  isReloadingDaemon = false,
  onSelectDefaultModel,
  onSelectDefaultEffort,
  onSelectServiceTier,
  onSelectCacheTtl,
  onSetRoleOverride,
  onOpenAgentsStudio,
  onRefreshModels,
  isRefreshingModels,
}: ModelsAgentsSectionProps) {
  const [overrideScope, setOverrideScope] = React.useState<
    "session" | "global"
  >("global");

  const schemaByKey = React.useMemo(
    () => new Map(configSchema.map((f) => [f.key, f])),
    [configSchema],
  );

  const { modelChoices, resolvedDefaultModel } = React.useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const rawIdToValue = new Map<string, string>();

    if (routes && routes.length > 0) {
      // Prefer available routes first while preserving backend order within each group
      const ordered = [
        ...routes.filter((r) => r.available !== false),
        ...routes.filter((r) => r.available === false),
      ];
      for (const r of ordered) {
        const rawModel = r.model || r.id;
        if (!rawModel) continue;
        const value =
          r.modelSpec ||
          formatHarnessModelSpec(rawModel, r.provider, r.apiMethod) ||
          rawModel;
        if (!rawIdToValue.has(rawModel)) {
          rawIdToValue.set(rawModel, value);
        }
        if (r.id && !rawIdToValue.has(r.id)) {
          rawIdToValue.set(r.id, value);
        }
        if (seen.has(value)) continue;
        seen.add(value);
        const providerBadge = formatProviderBadgeLabel(r.provider);
        const baseLabel = r.label || rawModel;
        out.push({
          value,
          label: `${baseLabel} (${providerBadge})`,
        });
      }
    } else {
      for (const m of DISCOVERED_MODEL_ROUTES) {
        if (seen.has(m)) continue;
        seen.add(m);
        out.push({ value: m, label: m });
      }
    }

    const matchedValue = defaultModel
      ? seen.has(defaultModel)
        ? defaultModel
        : (rawIdToValue.get(defaultModel) ?? defaultModel)
      : "";

    if (matchedValue && !seen.has(matchedValue)) {
      seen.add(matchedValue);
      out.unshift({ value: matchedValue, label: matchedValue });
    }

    return { modelChoices: out, resolvedDefaultModel: matchedValue };
  }, [defaultModel, routes]);

  const roleModelChoices = React.useMemo(() => {
    const out: Array<{ value: string; label: string }> = [
      { value: "inherit", label: "inherit" },
      { value: "default", label: "default" },
    ];
    const seen = new Set<string>(["inherit", "default"]);

    for (const p of profiles ?? []) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      out.push({ value: p.name, label: `Persona: ${p.name} (${p.model})` });
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

    return out;
  }, [modelChoices, profiles, roleOverrides]);

  const engineReadOnly = !configSupported;

  return (
    <section
      data-testid="settings-section-models"
      aria-labelledby="settings-h-models"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1
              id="settings-h-models"
              className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink"
            >
              Models &amp; Agents
            </h1>
            <ConfigScopeBadge scope="synced" configPath={configPath} />
          </div>
          <p className="mt-1 text-xs text-muted-ink">
            Configure default model route, reasoning effort, service tier,
            Anthropic KV-Cache TTL, and per-role subagent &amp; swarm defaults.
          </p>
        </div>

        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={isRefreshingModels}
          onClick={() => void onRefreshModels()}
          data-testid="models-refresh-btn"
        >
          <RefreshCw
            className={cn("size-3.5", isRefreshingModels && "animate-spin")}
            aria-hidden="true"
          />
          <span>Refresh Models</span>
        </Button>
      </div>

      <LegacyDaemonBanner visible={engineReadOnly} />
      <ConfigRestartBanner
        visible={configRequiresRestart}
        onReload={() => onReloadDaemon?.()}
        isReloading={isReloadingDaemon}
      />
      <SectionErrorBanner
        message={configSectionError}
        onDismiss={onClearSectionError}
      />

      {/* Defaults & Performance */}
      <div
        className={cn(
          "rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane",
          engineReadOnly && "opacity-60",
        )}
      >
        {/* Default Session Model */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
              <span>Default model route</span>
              <FieldApplyModeBadge
                applyMode={schemaByKey.get("provider.default_model")?.apply_mode}
              />
            </div>
            <div className="mt-0.5 text-muted-ink">
              Primary model route used for new sessions without an override
            </div>
            <FieldValidationError
              fieldKey="provider.default_model"
              message={configFieldErrors["provider.default_model"]}
              onDismiss={() => onClearFieldError?.("provider.default_model")}
            />
          </div>
          <Select
            value={resolvedDefaultModel}
            disabled={engineReadOnly}
            onValueChange={onSelectDefaultModel}
          >
            <SelectTrigger
              aria-label="Default model route"
              data-testid="default-model-select"
              className={cn(
                "w-full sm:w-[250px]",
                configFieldErrors["provider.default_model"] &&
                  "border-danger/40",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {modelChoices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Default Reasoning Effort */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
              <span>Default reasoning effort</span>
              <FieldApplyModeBadge
                applyMode={schemaByKey.get("provider.default_effort")?.apply_mode}
              />
            </div>
            <div className="mt-0.5 text-muted-ink">
              Capability-filtered thinking budget across supported reasoning
              models
            </div>
            <FieldValidationError
              fieldKey="provider.default_effort"
              message={configFieldErrors["provider.default_effort"]}
              onDismiss={() => onClearFieldError?.("provider.default_effort")}
            />
          </div>
          <Select
            value={defaultEffort ?? "medium"}
            disabled={engineReadOnly}
            onValueChange={(v) =>
              onSelectDefaultEffort(v as Exclude<EffortChoice, null>)
            }
          >
            <SelectTrigger
              aria-label="Default reasoning effort"
              data-testid="default-effort-select"
              className={cn(
                "w-[170px]",
                configFieldErrors["provider.default_effort"] &&
                  "border-danger/40",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="xhigh">Extra High</SelectItem>
              <SelectItem value="max">Max</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Fast / Service Tier */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-xs">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
              <span>Fast / Service Tier (RuntimeCommand::Fast)</span>
              <FieldApplyModeBadge
                applyMode={schemaByKey.get("provider.service_tier")?.apply_mode}
              />
            </div>
            <div className="mt-0.5 text-muted-ink">
              Throughput and latency routing tier for supported providers
            </div>
          </div>
          <Select
            value={serviceTier}
            disabled={engineReadOnly}
            onValueChange={(v) => void onSelectServiceTier(v as ServiceTier)}
          >
            <SelectTrigger
              aria-label="Service tier"
              data-testid="service-tier-select"
              className="w-[170px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="auto">auto</SelectItem>
              <SelectItem value="priority">priority</SelectItem>
              <SelectItem value="ultrafast">ultrafast</SelectItem>
              <SelectItem value="flex">flex</SelectItem>
              <SelectItem value="off">off</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Anthropic KV-Cache TTL */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-xs">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
              <span>Prompt KV-Cache TTL (RuntimeCommand::Cache)</span>
              <FieldApplyModeBadge
                applyMode={schemaByKey.get("provider.cache_ttl")?.apply_mode}
              />
            </div>
            <div className="mt-0.5 text-muted-ink">
              Keep warm prefix cache alive for 5 minutes or 1 hour across turns
            </div>
          </div>
          <div
            role="group"
            aria-label="Prompt KV-Cache TTL"
            className="inline-flex items-center rounded-md border border-hairline bg-inset p-[2px]"
          >
            {(["5m", "1h"] as const).map((ttl) => (
              <button
                key={ttl}
                type="button"
                disabled={engineReadOnly}
                data-testid={`cache-ttl-btn-${ttl}`}
                aria-pressed={cacheTtl === ttl}
                onClick={() => void onSelectCacheTtl(ttl)}
                className={cn(
                  "cursor-pointer rounded-xs px-3 py-1 font-mono text-xs font-medium disabled:pointer-events-none",
                  cacheTtl === ttl
                    ? "border border-premium bg-active text-ink shadow-bevel-surface"
                    : "text-muted-ink hover:text-ink",
                )}
              >
                {ttl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Subagent Models & Agent Personas Studio Entry */}
      <div
        data-testid="models-agents-studio-card"
        className="rayu-card-bevel flex flex-wrap items-center justify-between gap-3 rounded-xl border border-premium bg-pane px-4 py-3.5 text-xs"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
            <Bot className="size-4 text-brand-text" aria-hidden="true" />
            <span>Subagent Models &amp; Agent Personas</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-[10.5px] text-muted-ink tabular-nums">
              {(profiles ?? []).length} persona
              {(profiles ?? []).length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-1 text-muted-ink">
            Design custom worker personas (
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[10.5px] text-body">
              [[agents.profiles]]
            </code>
            ), set{" "}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[10.5px] text-body">
              /subagent-model
            </code>{" "}
            ({subagentModel ?? "inherit"}), and bind personas to roles.
          </div>
        </div>
        {onOpenAgentsStudio && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onOpenAgentsStudio}
            data-testid="settings-open-agents-studio-btn"
          >
            <span>Open Agents &amp; Personas</span>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Per-Role Subagent & Swarm Model Overrides */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-sm font-semibold text-ink">
              Per-Role Subagent &amp; Swarm Model Overrides
            </h2>
            <p className="mt-0.5 text-xs text-muted-ink">
              Assign specialized model routes to Swarm workers, Code Review,
              Acceptance Judge, Memory Extraction, and Ambient Cycles
            </p>
          </div>

          <div
            role="group"
            aria-label="Override scope"
            className="inline-flex items-center rounded-md border border-hairline bg-pane p-[2px]"
          >
            {(
              [
                { id: "session", label: "This Session" },
                { id: "global", label: "Global Default" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid={`role-scope-${s.id}`}
                aria-pressed={overrideScope === s.id}
                onClick={() => setOverrideScope(s.id)}
                className={cn(
                  "cursor-pointer rounded-xs px-2.5 py-1 text-xs font-medium",
                  overrideScope === s.id
                    ? "border border-premium bg-active text-ink"
                    : "text-muted-ink hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div
          data-testid="role-overrides-list"
          className={cn(
            "rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane",
            engineReadOnly && "opacity-60",
          )}
        >
          {roleOverrides.map((row) => (
            <div
              key={row.role}
              data-testid={`role-override-row-${row.role}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
            >
              <div>
                <div className="font-medium text-ink">{row.label}</div>
                <div className="font-mono text-[11px] text-muted-ink">
                  agents.{row.role}_model · Scope: {overrideScope}
                </div>
              </div>

              <Select
                value={row.model}
                disabled={engineReadOnly}
                onValueChange={(nextModel) =>
                  void onSetRoleOverride({
                    role: row.role,
                    model: nextModel,
                    scope: overrideScope,
                  })
                }
              >
                <SelectTrigger
                  aria-label={`${row.label} model`}
                  data-testid={`role-override-select-${row.role}`}
                  className="w-full sm:w-[250px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {roleModelChoices.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      {/* Swarm Strict Allowlist Indicator */}
      {swarmAllowlist && swarmAllowlist.length > 0 && (
        <div
          data-testid="swarm-allowlist-card"
          className="rounded-xl border border-hairline bg-inset p-3.5 text-xs"
        >
          <div className="font-medium text-ink">
            Swarm Model Allowlist (agents.swarm_model_allowlist)
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {swarmAllowlist.map((modelId) => (
              <span
                key={modelId}
                className="rounded-full border border-hairline bg-pane px-2.5 py-0.5 font-mono text-[11px] text-brand-text"
              >
                {modelId}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
