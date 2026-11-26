import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import type { CacheTtl, EffortLevel, ServiceTier } from "@shared/vscodeProtocol";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { callRpc, cn, sendHarnessRequest } from "@/lib";

import {
  CACHE_TTL_OPTIONS,
  DEFAULT_CACHE_TTL,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LABEL,
  DEFAULT_SERVICE_TIER,
  EFFORT_LEVELS,
  EFFORT_STOPS,
  FALLBACK_MODELS,
  SERVICE_TIER_OPTIONS,
  effortToIndex,
  formatEffortLabel,
  formatHarnessModelSpec,
  formatProviderBadgeLabel,
  getEffortStop,
  indexToEffort,
  normalizeEffortLevel,
} from "../constants";
import type { ModelOption } from "../types";

export interface ModelEffortPopoverProps {
  modelId: string;
  modelLabel: string;
  effort: EffortLevel | string;
  serviceTier?: ServiceTier;
  cacheTtl?: CacheTtl;
  sessionId?: string | null;
  models?: readonly ModelOption[];
  onSelectModel: (model: ModelOption) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  onSelectServiceTier?: (tier: ServiceTier) => void;
  onSelectCacheTtl?: (ttl: CacheTtl) => void;
  onRefreshModels?: () => void | Promise<unknown>;
  isRefreshing?: boolean;
  isStreaming?: boolean;
  defaultOpen?: boolean;
  initialStage?: "effort" | "list";
  disabled?: boolean;
  className?: string;
}

const STOP_LEFT_POSITIONS = [
  "17px",
  "calc(17px + (100% - 34px) * 0.25)",
  "calc(17px + (100% - 34px) * 0.5)",
  "calc(17px + (100% - 34px) * 0.75)",
  "calc(100% - 17px)",
] as const;

export function ModelEffortPopover({
  modelId,
  modelLabel,
  effort: rawEffort,
  serviceTier = DEFAULT_SERVICE_TIER,
  cacheTtl = DEFAULT_CACHE_TTL,
  sessionId,
  models = FALLBACK_MODELS,
  onSelectModel,
  onSelectEffort,
  onSelectServiceTier,
  onSelectCacheTtl,
  onRefreshModels,
  isRefreshing = false,
  isStreaming = false,
  defaultOpen = false,
  initialStage = "effort",
  disabled = false,
  className,
}: ModelEffortPopoverProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [triggerTipOpen, setTriggerTipOpen] = React.useState(false);
  const [stage, setStage] = React.useState<"effort" | "list">(initialStage);
  const [isDragging, setIsDragging] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const sliderRef = React.useRef<HTMLDivElement>(null);

  const effort = normalizeEffortLevel(rawEffort);
  const effortLabel = formatEffortLabel(effort);
  const currentStop = getEffortStop(effort);
  const effortIndex = effortToIndex(effort);
  const isFastTier = serviceTier === "priority" || serviceTier === "ultrafast";
  const catalog = models;

  const getOptionKey = React.useCallback((model: ModelOption): string => {
    if (model.modelSpec && model.modelSpec.includes(":")) {
      return model.modelSpec;
    }
    return `${model.provider}:${model.modelSpec ?? model.id}`;
  }, []);

  const matchedActiveModel = React.useMemo(() => {
    const exactSpec = catalog.filter((m) => m.modelSpec === modelId);
    if (exactSpec.length > 0) {
      return exactSpec.find((m) => m.available !== false) ?? exactSpec[0];
    }
    const byId = catalog.filter((m) => m.id === modelId);
    if (byId.length > 0) {
      return byId.find((m) => m.available !== false) ?? byId[0];
    }
    return undefined;
  }, [catalog, modelId]);

  const activeModel =
    matchedActiveModel ??
    catalog.find((m) => m.available !== false) ??
    catalog[0];

  // Filter models while strictly preserving exact backend route order
  const filteredCatalog = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.modelSpec ?? "").toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        formatProviderBadgeLabel(m.provider).toLowerCase().includes(q) ||
        (m.subtitle ?? "").toLowerCase().includes(q),
    );
  }, [catalog, searchQuery]);

  const readyModels = React.useMemo(
    () => filteredCatalog.filter((m) => m.available !== false),
    [filteredCatalog],
  );
  const unavailableModels = React.useMemo(
    () => filteredCatalog.filter((m) => m.available === false),
    [filteredCatalog],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setStage(initialStage);
    } else {
      setIsDragging(false);
      setSearchQuery("");
    }
  };

  const applyEffortByIndex = React.useCallback(
    (nextIndex: number) => {
      const nextEffort = indexToEffort(nextIndex);
      if (nextEffort !== effort) {
        onSelectEffort(nextEffort);
        sendHarnessRequest({
          req: "set_reasoning_effort",
          session_id: sessionId ?? undefined,
          effort: nextEffort,
          ...(isStreaming ? { apply_next_turn: true } : {}),
        });
      }
    },
    [effort, isStreaming, onSelectEffort, sessionId],
  );

  const updateFromClientX = React.useCallback(
    (clientX: number) => {
      const slider = sliderRef.current;
      if (!slider) return;
      const rect = slider.getBoundingClientRect();
      if (rect.width <= 0) return;
      const usable = Math.max(1, rect.width - 34);
      const rel = Math.max(0, Math.min(1, (clientX - rect.left - 17) / usable));
      const idx = Math.round(rel * (EFFORT_LEVELS.length - 1));
      applyEffortByIndex(idx);
    },
    [applyEffortByIndex],
  );

  const handleSliderPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if ((event.target as HTMLElement).closest("[data-effort-stop]")) {
      return;
    }
    setIsDragging(true);
    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore in test DOM environments
      }
    }
    updateFromClientX(event.clientX);
  };

  const handleSliderPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!isDragging) return;
    updateFromClientX(event.clientX);
  };

  const handleSliderPointerUp = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (typeof event.currentTarget.releasePointerCapture === "function") {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleSliderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        applyEffortByIndex(effortIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        applyEffortByIndex(effortIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        applyEffortByIndex(0);
        break;
      case "End":
        event.preventDefault();
        applyEffortByIndex(EFFORT_LEVELS.length - 1);
        break;
      default:
        break;
    }
  };

  const handleServiceTierSelect = (nextTier: ServiceTier) => {
    onSelectServiceTier?.(nextTier);
    void callRpc("settings.models.setFast", {
      tier: nextTier,
      sessionId: sessionId ?? undefined,
    }).catch(() => {});
  };

  const handleFastToggle = () => {
    const nextTier: ServiceTier = isFastTier ? "auto" : "priority";
    handleServiceTierSelect(nextTier);
  };

  const handleCacheTtlSelect = (nextTtl: CacheTtl) => {
    onSelectCacheTtl?.(nextTtl);
    void callRpc("settings.models.setCacheTtl", {
      ttl: nextTtl,
      sessionId: sessionId ?? undefined,
    }).catch(() => {});
  };

  const handleReset = () => {
    const defaultModel =
      catalog.find(
        (m) =>
          (m.modelSpec === DEFAULT_MODEL_ID || m.id === DEFAULT_MODEL_ID) &&
          m.available !== false,
      ) ??
      catalog.find((m) => m.available !== false) ??
      catalog[0] ?? {
        id: DEFAULT_MODEL_ID,
        modelSpec: formatHarnessModelSpec(DEFAULT_MODEL_ID, "rayu", "rayu"),
        label: DEFAULT_MODEL_LABEL,
        provider: "rayu",
        apiMethod: "rayu",
      };
    const defaultSpec =
      defaultModel.modelSpec ||
      formatHarnessModelSpec(
        defaultModel.id,
        defaultModel.provider,
        defaultModel.apiMethod,
      ) ||
      defaultModel.id;
    onSelectModel(defaultModel);
    onSelectEffort(DEFAULT_EFFORT);
    sendHarnessRequest({
      req: "set_model",
      session_id: sessionId ?? undefined,
      model: defaultSpec,
      ...(isStreaming ? { apply_next_turn: true } : {}),
    });
    sendHarnessRequest({
      req: "set_reasoning_effort",
      session_id: sessionId ?? undefined,
      effort: DEFAULT_EFFORT,
      ...(isStreaming ? { apply_next_turn: true } : {}),
    });
    handleServiceTierSelect(DEFAULT_SERVICE_TIER);
  };

  const handleSelectModel = (model: ModelOption) => {
    onSelectModel(model);
    const spec =
      model.modelSpec ||
      formatHarnessModelSpec(model.id, model.provider, model.apiMethod) ||
      model.id;
    sendHarnessRequest({
      req: "set_model",
      session_id: sessionId ?? undefined,
      model: spec,
      ...(isStreaming ? { apply_next_turn: true } : {}),
    });
    setStage("effort");
    setOpen(false);
  };

  const handleRefresh = () => {
    if (onRefreshModels) {
      void onRefreshModels();
    } else {
      void callRpc("settings.models.refresh", {
        sessionId: sessionId ?? undefined,
      }).catch(() => {});
    }
  };

  const authTag = React.useMemo(() => {
    if (!activeModel) return null;
    const providerLabel = formatProviderBadgeLabel(activeModel.provider);
    if (activeModel.authMethod === "oauth") {
      return `OAuth · ${activeModel.accountLabel ?? providerLabel}`;
    }
    if (activeModel.authMethod === "api_key") {
      return `API Key · ${providerLabel}`;
    }
    if (activeModel.authMethod === "env") {
      return `Env Key · ${providerLabel}`;
    }
    return providerLabel;
  }, [activeModel]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
        <Tooltip
          open={!open && triggerTipOpen}
          onOpenChange={setTriggerTipOpen}
        >
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                data-testid="model-effort-trigger"
                aria-haspopup="dialog"
                aria-expanded={open}
                className={cn(
                  "inline-flex min-w-0 max-w-full shrink cursor-pointer items-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2 py-[5px] text-xs font-medium whitespace-nowrap text-ink transition-all outline-none select-none hover:border-premium hover:bg-active hover:shadow-bevel-surface focus:outline-none focus-visible:outline-none data-[state=open]:border-premium data-[state=open]:bg-active data-[state=open]:shadow-bevel-surface disabled:pointer-events-none disabled:opacity-50 @min-[420px]/composer:px-[11px]",
                  className,
                )}
              >
                {isFastTier ? (
                  <Zap
                    className="size-3 shrink-0 text-brand-text"
                    aria-hidden="true"
                  />
                ) : null}
                <span className="min-w-0 truncate font-medium text-ink">
                  {modelLabel}
                </span>
                <span className="shrink-0 font-normal text-muted-ink @max-[460px]/composer:hidden">
                  {effortLabel}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 text-muted-ink transition-transform duration-150 @max-[340px]/composer:hidden",
                    open && "rotate-180 text-body",
                  )}
                  aria-hidden="true"
                />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            {modelLabel} · {effortLabel}
            {isFastTier ? ` · ${serviceTier}` : ""}
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className="rayu-card-bevel w-[min(318px,calc(100vw-24px))] rounded-[18px] border border-premium-hi bg-popover-solid p-0 shadow-rayu-2"
        >
          {stage === "effort" ? (
            <div
              role="dialog"
              aria-label="Reasoning effort"
              data-testid="effort-stage-card"
              className="w-full px-[18px] pt-4 pb-4"
            >
              <div className="mb-2.5 grid grid-cols-[32px_1fr_32px] items-start gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleFastToggle}
                      aria-label="Priority fast service tier"
                      aria-pressed={isFastTier}
                      data-testid="effort-fast-btn"
                      className={cn(
                        "grid size-[30px] cursor-pointer place-items-center rounded-[9px] border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink",
                        isFastTier &&
                          "border-brand/40 bg-brand-soft text-brand-text",
                      )}
                    >
                      <Zap className="size-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Fast / Priority service tier ({serviceTier})
                  </TooltipContent>
                </Tooltip>

                <div className="flex flex-col items-center gap-0.5 pt-0.5 text-center">
                  <div
                    data-testid="effort-level-value"
                    data-effort={effort}
                    className="text-[19px] leading-[1.15] font-semibold tracking-[-0.02em] text-brand-text"
                  >
                    {effortLabel}
                  </div>
                  <button
                    type="button"
                    onClick={() => setStage("list")}
                    data-testid="open-model-list-btn"
                    className="group inline-flex cursor-pointer items-center gap-0.5 rounded-full py-0.5 pr-2 pl-2.5 text-[13.5px] font-normal text-body transition-colors hover:bg-hover hover:text-ink"
                  >
                    <span>{modelLabel}</span>
                    <ChevronRight
                      className="size-3.5 text-muted-ink transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                      aria-hidden="true"
                    />
                  </button>
                  {authTag ? (
                    <span className="text-[10.5px] text-muted-ink">
                      {authTag}
                    </span>
                  ) : null}
                  {isStreaming ? (
                    <span
                      data-testid="model-effort-next-turn-hint"
                      className="mt-0.5 rounded-full border border-brand/25 bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand-text"
                    >
                      Changes apply to next message
                    </span>
                  ) : null}
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleReset}
                      aria-label="Reset to default model and effort"
                      data-testid="effort-reset-btn"
                      className="grid size-[30px] cursor-pointer place-items-center rounded-[9px] border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Reset to {DEFAULT_MODEL_LABEL} · Medium
                  </TooltipContent>
                </Tooltip>
              </div>

              <p
                data-testid="effort-description"
                className="mb-3.5 min-h-8 text-center text-xs leading-snug text-muted-ink"
              >
                {currentStop.description}
              </p>

              {/* 5-Stop Interactive Pill Slider (low | medium | high | xhigh | max) */}
              <div
                ref={sliderRef}
                role="slider"
                tabIndex={0}
                aria-label="Reasoning effort"
                aria-valuemin={0}
                aria-valuemax={EFFORT_LEVELS.length - 1}
                aria-valuenow={effortIndex}
                aria-valuetext={effortLabel}
                data-testid="effort-slider"
                onPointerDown={handleSliderPointerDown}
                onPointerMove={handleSliderPointerMove}
                onPointerUp={handleSliderPointerUp}
                onKeyDown={handleSliderKeyDown}
                className="relative h-9 cursor-pointer touch-none rounded-full border border-hairline bg-hover select-none focus:outline-none"
              >
                <div
                  aria-hidden="true"
                  className="rayu-effort-bar pointer-events-none absolute inset-y-0 left-0 rounded-full transition-[width] duration-150"
                  style={{
                    width: `calc(34px + (100% - 34px) * ${currentStop.progress})`,
                  }}
                />

                {EFFORT_STOPS.map((stop) => {
                  const isFilled = stop.index < effortIndex;
                  const isCurrent = stop.index === effortIndex;
                  return (
                    <button
                      key={stop.level}
                      type="button"
                      data-effort-stop={stop.index}
                      data-effort-level={stop.level}
                      aria-label={stop.label}
                      aria-pressed={isCurrent}
                      onClick={(event) => {
                        event.stopPropagation();
                        applyEffortByIndex(stop.index);
                      }}
                      style={{ left: STOP_LEFT_POSITIONS[stop.index] }}
                      className="group absolute top-1/2 z-[2] grid size-[34px] -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full focus:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-[5px] rounded-full transition-transform duration-150 group-hover:scale-125",
                          isFilled
                            ? "bg-ink/70"
                            : "bg-muted-ink/45 group-hover:bg-ink/70",
                        )}
                      />
                    </button>
                  );
                })}

                <div
                  aria-hidden="true"
                  data-testid="effort-slider-thumb"
                  className={cn(
                    "pointer-events-none absolute top-0 z-[3] size-[34px] rounded-full border border-hairline/40 bg-ink shadow-rayu-1 transition-[left,transform] duration-150",
                    isDragging && "scale-[1.04]",
                  )}
                  style={{
                    left: `calc((100% - 34px) * ${currentStop.progress})`,
                  }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between px-1.5 text-[10.5px] font-medium text-muted-ink">
                {EFFORT_STOPS.map((stop) => (
                  <span
                    key={stop.level}
                    className={cn(
                      "transition-colors",
                      stop.level === effort && "text-brand-text",
                    )}
                  >
                    {stop.label}
                  </span>
                ))}
              </div>

              {/* Service Tier & Cache TTL Selector Footer */}
              <div className="mt-3.5 flex flex-col gap-2 border-t border-hairline-soft pt-3">
                <div
                  data-testid="service-tier-selector"
                  className="flex items-center justify-between gap-1.5"
                >
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-ink">
                    <Zap className="size-3 text-brand-text" aria-hidden="true" />
                    <span>Tier</span>
                  </span>
                  <div className="flex items-center gap-0.5 rounded-lg border border-hairline-soft bg-inset p-0.5">
                    {SERVICE_TIER_OPTIONS.map((opt) => {
                      const active = serviceTier === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          data-testid={`service-tier-${opt.id}`}
                          aria-pressed={active}
                          onClick={() => handleServiceTierSelect(opt.id)}
                          className={cn(
                            "cursor-pointer rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
                            active
                              ? "bg-active text-ink shadow-bevel-surface"
                              : "text-muted-ink hover:text-ink",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  data-testid="cache-ttl-selector"
                  className="flex items-center justify-between gap-1.5"
                >
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-ink">
                    <Clock className="size-3 text-muted-ink" aria-hidden="true" />
                    <span>KV Cache</span>
                  </span>
                  <div className="flex items-center gap-0.5 rounded-lg border border-hairline-soft bg-inset p-0.5">
                    {CACHE_TTL_OPTIONS.map((opt) => {
                      const active = cacheTtl === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          data-testid={`cache-ttl-${opt.id}`}
                          aria-pressed={active}
                          onClick={() => handleCacheTtlSelect(opt.id)}
                          className={cn(
                            "cursor-pointer rounded-md px-2 py-0.5 font-mono text-[10.5px] font-medium tabular-nums transition-colors",
                            active
                              ? "bg-active text-ink shadow-bevel-surface"
                              : "text-muted-ink hover:text-ink",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div data-testid="model-list-card" className="w-full p-2">
              <div className="flex items-center justify-between px-1 pt-0.5 pb-1.5">
                <button
                  type="button"
                  onClick={() => setStage("effort")}
                  data-testid="model-list-back-btn"
                  aria-label="Back to reasoning effort"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] font-medium tracking-[-0.01em] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                  <span>Select model</span>
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-testid="model-refresh-btn"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      aria-label="Refresh model catalog"
                      className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5",
                          isRefreshing && "animate-spin",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Refresh models</TooltipContent>
                </Tooltip>
              </div>

              <div className="relative mb-2 px-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-ink"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter models & providers..."
                  data-testid="model-search-input"
                  className="h-7 w-full rounded-lg border border-hairline bg-inset pr-2.5 pl-7 text-xs text-ink placeholder:text-muted-ink focus:border-premium-hi focus:outline-none"
                />
              </div>

              <ScrollArea className="h-[280px]">
                <div
                  role="listbox"
                  aria-label="Select model"
                  className="flex flex-col gap-0.5 pr-1.5 pl-0.5"
                >
                  {filteredCatalog.length === 0 ? (
                    <div
                      data-testid="model-list-empty"
                      className="flex flex-col items-center justify-center gap-2.5 px-3 py-10 text-center"
                    >
                      <span className="text-xs text-muted-ink">
                        {searchQuery.trim()
                          ? "No models match your filter."
                          : "No models available yet."}
                      </span>
                      <button
                        type="button"
                        data-testid="model-empty-refresh-btn"
                        disabled={isRefreshing}
                        onClick={handleRefresh}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline bg-raised px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-premium-hi hover:bg-hover disabled:opacity-50"
                      >
                        <RefreshCw
                          className={cn(
                            "size-3",
                            isRefreshing && "animate-spin",
                          )}
                          aria-hidden="true"
                        />
                        <span>Refresh models</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      {readyModels.length > 0 && unavailableModels.length > 0 ? (
                        <div
                          data-testid="model-group-authenticated"
                          className="px-2.5 pt-1 pb-0.5 text-[10.5px] font-medium text-muted-ink"
                        >
                          Authenticated models
                        </div>
                      ) : null}
                      {readyModels.map((model) => {
                        const key = getOptionKey(model);
                        const isSelected = matchedActiveModel
                          ? getOptionKey(matchedActiveModel) === key
                          : model.modelSpec === modelId || model.id === modelId;
                        const providerLabel = formatProviderBadgeLabel(
                          model.provider,
                        );
                        return (
                          <button
                            key={key}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-model-id={model.id}
                            data-model-spec={model.modelSpec ?? model.id}
                            data-provider={model.provider}
                            onClick={() => handleSelectModel(model)}
                            className={cn(
                              "flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-[10px] border border-transparent px-3 py-2 text-left transition-colors hover:bg-hover",
                              isSelected && "border-hairline bg-active",
                            )}
                          >
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-sm leading-snug font-medium text-ink">
                                  {model.label}
                                </span>
                                <span className="shrink-0 rounded border border-hairline-soft bg-inset px-1.5 py-px text-[10px] font-normal text-muted-ink">
                                  {providerLabel}
                                </span>
                              </span>
                              {model.subtitle ? (
                                <span className="truncate text-xs leading-tight text-muted-ink">
                                  {model.subtitle}
                                </span>
                              ) : null}
                            </span>
                            <Check
                              className={cn(
                                "size-[15px] shrink-0 text-ink transition-opacity duration-150",
                                isSelected ? "opacity-100" : "opacity-0",
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        );
                      })}

                      {unavailableModels.length > 0 ? (
                        <>
                          <div
                            data-testid="model-group-unavailable"
                            className={cn(
                              "px-2.5 pt-1.5 pb-0.5 text-[10.5px] font-medium text-muted-ink",
                              readyModels.length > 0 &&
                                "mt-1 border-t border-hairline-soft pt-2",
                            )}
                          >
                            Other providers (configure key)
                          </div>
                          {unavailableModels.map((model) => {
                            const key = getOptionKey(model);
                            const isSelected = matchedActiveModel
                              ? getOptionKey(matchedActiveModel) === key
                              : false;
                            const providerLabel = formatProviderBadgeLabel(
                              model.provider,
                            );
                            return (
                              <button
                                key={key}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                disabled
                                data-model-id={model.id}
                                data-model-spec={model.modelSpec ?? model.id}
                                data-provider={model.provider}
                                className="flex w-full cursor-not-allowed items-center justify-between gap-2.5 rounded-[10px] border border-transparent px-3 py-2 text-left opacity-55 transition-colors"
                              >
                                <span className="flex min-w-0 flex-col gap-0.5">
                                  <span className="flex items-center gap-1.5">
                                    <span className="truncate text-sm leading-snug font-medium text-ink">
                                      {model.label}
                                    </span>
                                    <span className="shrink-0 rounded border border-hairline-soft bg-inset px-1.5 py-px text-[10px] font-normal text-muted-ink">
                                      {providerLabel}
                                    </span>
                                  </span>
                                  <span className="truncate text-xs leading-tight text-warn">
                                    {model.unavailableReason ??
                                      model.subtitle ??
                                      `Requires ${providerLabel} API key`}
                                  </span>
                                </span>
                                <Check
                                  className="size-[15px] shrink-0 text-ink opacity-0"
                                  aria-hidden="true"
                                />
                              </button>
                            );
                          })}
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </PopoverContent>
      </Popover>
  );
}
