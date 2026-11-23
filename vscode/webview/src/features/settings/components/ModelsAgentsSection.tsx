import * as React from "react";
import { RefreshCw } from "lucide-react";
import type {
  AgentRoleId,
  AgentRoleOverrideView,
  CacheTtl,
  EffortChoice,
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
import { cn } from "@/lib/utils";

export interface ModelsAgentsSectionProps {
  defaultModel: string;
  defaultEffort: EffortChoice;
  serviceTier: ServiceTier;
  cacheTtl: CacheTtl;
  roleOverrides: ReadonlyArray<AgentRoleOverrideView>;
  swarmAllowlist?: ReadonlyArray<string>;
  onSelectDefaultModel: (model: string) => void;
  onSelectDefaultEffort: (effort: EffortChoice) => void;
  onSelectServiceTier: (tier: ServiceTier) => Promise<unknown>;
  onSelectCacheTtl: (ttl: CacheTtl) => Promise<unknown>;
  onSetRoleOverride: (input: {
    role: AgentRoleId;
    model: string;
    scope: "session" | "global";
  }) => Promise<unknown>;
  onRefreshModels: () => Promise<unknown>;
  isRefreshingModels: boolean;
}

const DISCOVERED_MODEL_ROUTES = [
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "gpt-5.2",
  "gemini-2.5-pro",
  "deepseek-r1",
  "grok-3",
] as const;

const ROLE_MODEL_CHOICES = [
  "inherit",
  "default",
  ...DISCOVERED_MODEL_ROUTES,
] as const;

export function ModelsAgentsSection({
  defaultModel,
  defaultEffort,
  serviceTier,
  cacheTtl,
  roleOverrides,
  swarmAllowlist,
  onSelectDefaultModel,
  onSelectDefaultEffort,
  onSelectServiceTier,
  onSelectCacheTtl,
  onSetRoleOverride,
  onRefreshModels,
  isRefreshingModels,
}: ModelsAgentsSectionProps) {
  const [overrideScope, setOverrideScope] = React.useState<
    "session" | "global"
  >("global");

  return (
    <section
      data-testid="settings-section-models"
      aria-labelledby="settings-h-models"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            id="settings-h-models"
            className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink"
          >
            Models &amp; Agents
          </h1>
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

      {/* Defaults & Performance */}
      <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane">
        {/* Default Session Model */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-xs">
          <div>
            <div className="font-medium text-ink">Default model route</div>
            <div className="mt-0.5 text-muted-ink">
              Primary model route used for new sessions without an override
            </div>
          </div>
          <Select value={defaultModel} onValueChange={onSelectDefaultModel}>
            <SelectTrigger
              aria-label="Default model route"
              data-testid="default-model-select"
              className="w-full sm:w-[210px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {DISCOVERED_MODEL_ROUTES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Default Reasoning Effort */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 text-xs">
          <div>
            <div className="font-medium text-ink">Default reasoning effort</div>
            <div className="mt-0.5 text-muted-ink">
              Capability-filtered thinking budget across supported reasoning
              models
            </div>
          </div>
          <Select
            value={defaultEffort ?? "auto"}
            onValueChange={(v) =>
              onSelectDefaultEffort(
                v === "auto" ? null : (v as Exclude<EffortChoice, null>),
              )
            }
          >
            <SelectTrigger
              aria-label="Default reasoning effort"
              data-testid="default-effort-select"
              className="w-[170px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="auto">Auto</SelectItem>
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
            <div className="font-medium text-ink">
              Fast / Service Tier (RuntimeCommand::Fast)
            </div>
            <div className="mt-0.5 text-muted-ink">
              Throughput and latency routing tier for supported providers
            </div>
          </div>
          <Select
            value={serviceTier}
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
            <div className="font-medium text-ink">
              Prompt KV-Cache TTL (RuntimeCommand::Cache)
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
                data-testid={`cache-ttl-btn-${ttl}`}
                aria-pressed={cacheTtl === ttl}
                onClick={() => void onSelectCacheTtl(ttl)}
                className={cn(
                  "cursor-pointer rounded-xs px-3 py-1 font-mono text-xs font-medium",
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
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
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
                  className="w-full sm:w-[210px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {ROLE_MODEL_CHOICES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
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
