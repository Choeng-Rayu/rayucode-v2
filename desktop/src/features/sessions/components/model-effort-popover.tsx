import * as React from "react"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LABEL,
  EFFORT_LEVELS,
  EFFORT_STOPS,
  FALLBACK_MODELS,
  effortToIndex,
  getEffortStop,
  indexToEffort,
} from "../constants/models"
import type { ModelOption, ReasoningEffort } from "../types"

export interface ModelEffortPopoverProps {
  modelId: string
  modelLabel: string
  effort: ReasoningEffort
  models?: readonly ModelOption[]
  onSelectModel: (model: ModelOption) => void
  onSelectEffort: (effort: ReasoningEffort) => void
  onRefreshModels?: () => void | Promise<unknown>
  isRefreshing?: boolean
  defaultOpen?: boolean
  initialStage?: "effort" | "list"
  disabled?: boolean
  className?: string
}

const STOP_LEFT_POSITIONS = [
  "17px",
  "calc(17px + (100% - 34px) * 0.25)",
  "calc(17px + (100% - 34px) * 0.5)",
  "calc(17px + (100% - 34px) * 0.75)",
  "calc(100% - 17px)",
] as const

export function ModelEffortPopover({
  modelId,
  modelLabel,
  effort,
  models = FALLBACK_MODELS,
  onSelectModel,
  onSelectEffort,
  onRefreshModels,
  isRefreshing = false,
  defaultOpen = false,
  initialStage = "effort",
  disabled = false,
  className,
}: ModelEffortPopoverProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const [triggerTipOpen, setTriggerTipOpen] = React.useState(false)
  const [stage, setStage] = React.useState<"effort" | "list">(initialStage)
  const [isDragging, setIsDragging] = React.useState(false)
  const sliderRef = React.useRef<HTMLDivElement>(null)

  const currentStop = getEffortStop(effort)
  const effortIndex = effortToIndex(effort)
  const isFastMode = effort === "Low"
  const catalog = models.length > 0 ? models : FALLBACK_MODELS

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setStage(initialStage)
    } else {
      setIsDragging(false)
    }
  }

  const applyEffortByIndex = React.useCallback(
    (nextIndex: number, announce = false) => {
      const nextEffort = indexToEffort(nextIndex)
      if (nextEffort !== effort) {
        onSelectEffort(nextEffort)
      }
      if (announce) {
        toast(`Reasoning effort: ${nextEffort}`)
      }
    },
    [effort, onSelectEffort]
  )

  const updateFromClientX = React.useCallback(
    (clientX: number) => {
      const slider = sliderRef.current
      if (!slider) return
      const rect = slider.getBoundingClientRect()
      if (rect.width <= 0) return
      const usable = Math.max(1, rect.width - 34)
      const rel = Math.max(0, Math.min(1, (clientX - rect.left - 17) / usable))
      const idx = Math.round(rel * (EFFORT_LEVELS.length - 1))
      applyEffortByIndex(idx, false)
    },
    [applyEffortByIndex]
  )

  const handleSliderPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if ((event.target as HTMLElement).closest("[data-effort-stop]")) {
      return
    }
    setIsDragging(true)
    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // ignore in environments without pointer capture support
      }
    }
    updateFromClientX(event.clientX)
  }

  const handleSliderPointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isDragging) return
    updateFromClientX(event.clientX)
  }

  const handleSliderPointerUp = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isDragging) return
    setIsDragging(false)
    if (typeof event.currentTarget.releasePointerCapture === "function") {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }
    toast(`Reasoning effort: ${effort}`)
  }

  const handleSliderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault()
        applyEffortByIndex(effortIndex + 1, true)
        break
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault()
        applyEffortByIndex(effortIndex - 1, true)
        break
      case "Home":
        event.preventDefault()
        applyEffortByIndex(0, true)
        break
      case "End":
        event.preventDefault()
        applyEffortByIndex(EFFORT_LEVELS.length - 1, true)
        break
      default:
        break
    }
  }

  const handleFastToggle = () => {
    const nextEffort: ReasoningEffort = isFastMode ? "Medium" : "Low"
    onSelectEffort(nextEffort)
    toast(
      nextEffort === "Low"
        ? "Fast mode enabled (Low effort)"
        : "Reasoning effort: Medium"
    )
  }

  const handleReset = () => {
    const defaultModel =
      catalog.find((m) => m.id === DEFAULT_MODEL_ID) ?? {
        id: DEFAULT_MODEL_ID,
        label: DEFAULT_MODEL_LABEL,
        provider: "anthropic",
      }
    onSelectModel(defaultModel)
    onSelectEffort(DEFAULT_EFFORT)
    toast(`Reset to ${defaultModel.label} · ${DEFAULT_EFFORT}`)
  }

  const handleSelectModel = (model: ModelOption) => {
    onSelectModel(model)
    setStage("effort")
    setOpen(false)
    toast(`Model: ${model.label} · ${effort}`)
  }

  return (
    <TooltipProvider delayDuration={120}>
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
                  className
                )}
              >
                <span className="min-w-0 truncate font-medium text-ink">
                  {modelLabel}
                </span>
                <span className="shrink-0 font-normal text-muted-ink @max-[460px]/composer:hidden">
                  {effort}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 text-muted-ink transition-transform duration-150",
                    open && "rotate-180 text-body"
                  )}
                  aria-hidden="true"
                />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            {modelLabel} · {effort}
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={12}
          className="rayu-card-bevel w-auto rounded-[18px] border border-premium-hi bg-popover-solid p-0 shadow-rayu-2"
        >
          {stage === "effort" ? (
            <div
              role="dialog"
              aria-label="Reasoning effort"
              data-testid="effort-stage-card"
              className="w-[318px] px-[18px] pt-4 pb-[18px]"
            >
              <div className="mb-2.5 grid grid-cols-[32px_1fr_32px] items-start gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleFastToggle}
                      aria-label="Fast mode (Low effort)"
                      aria-pressed={isFastMode}
                      data-testid="effort-fast-btn"
                      className={cn(
                        "grid size-[30px] cursor-pointer place-items-center rounded-[9px] border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink",
                        isFastMode &&
                          "border-brand/40 bg-brand-soft text-brand-text"
                      )}
                    >
                      <Zap className="size-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Fast mode (Low effort)
                  </TooltipContent>
                </Tooltip>

                <div className="flex flex-col items-center gap-0.5 pt-0.5 text-center">
                  <div
                    data-testid="effort-level-value"
                    className="text-[19px] leading-[1.15] font-semibold tracking-[-0.02em] text-brand-text"
                  >
                    {effort}
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
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleReset}
                      aria-label="Reset to Claude Opus 5.5 Medium"
                      data-testid="effort-reset-btn"
                      className="grid size-[30px] cursor-pointer place-items-center rounded-[9px] border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Reset to Claude Opus 5.5 · Medium
                  </TooltipContent>
                </Tooltip>
              </div>

              <p
                data-testid="effort-description"
                className="mb-4 min-h-8 text-center text-xs leading-snug text-muted-ink"
              >
                {currentStop.description}
              </p>

              <div
                ref={sliderRef}
                role="slider"
                tabIndex={0}
                aria-label="Reasoning effort"
                aria-valuemin={0}
                aria-valuemax={EFFORT_LEVELS.length - 1}
                aria-valuenow={effortIndex}
                aria-valuetext={effort}
                data-testid="effort-slider"
                onPointerDown={handleSliderPointerDown}
                onPointerMove={handleSliderPointerMove}
                onPointerUp={handleSliderPointerUp}
                onKeyDown={handleSliderKeyDown}
                className="relative h-9 cursor-pointer touch-none rounded-full border border-hairline bg-hover select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  aria-hidden="true"
                  className="rayu-effort-bar pointer-events-none absolute inset-y-0 left-0 rounded-full transition-[width] duration-150"
                  style={{
                    width: `calc(34px + (100% - 34px) * ${currentStop.progress})`,
                  }}
                />

                {EFFORT_STOPS.map((stop) => {
                  const isFilled = stop.index < effortIndex
                  const isCurrent = stop.index === effortIndex
                  return (
                    <button
                      key={stop.level}
                      type="button"
                      data-effort-stop={stop.index}
                      aria-label={stop.level}
                      aria-pressed={isCurrent}
                      onClick={(event) => {
                        event.stopPropagation()
                        applyEffortByIndex(stop.index, true)
                      }}
                      style={{ left: STOP_LEFT_POSITIONS[stop.index] }}
                      className="group absolute top-1/2 z-[2] grid size-[34px] -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full focus:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-[5px] rounded-full transition-transform duration-150 group-hover:scale-125",
                          isFilled
                            ? "bg-white/60"
                            : "bg-muted-ink/45 group-hover:bg-ink/70"
                        )}
                      />
                    </button>
                  )
                })}

                <div
                  aria-hidden="true"
                  data-testid="effort-slider-thumb"
                  className={cn(
                    "pointer-events-none absolute top-0 z-[3] size-[34px] rounded-full border border-hairline/40 bg-white shadow-rayu-1 transition-[left,transform] duration-150",
                    isDragging && "scale-[1.04]"
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
                      stop.level === effort && "text-brand-text"
                    )}
                  >
                    {stop.level}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div
              data-testid="model-list-card"
              className="w-[286px] p-1.5"
            >
              <div className="flex items-center justify-between px-1.5 pt-1 pb-2">
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
                {onRefreshModels ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => void onRefreshModels()}
                        disabled={isRefreshing}
                        aria-label="Refresh model catalog"
                        className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
                      >
                        <RefreshCw
                          className={cn(
                            "size-3.5",
                            isRefreshing && "animate-spin"
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Refresh models</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              <ScrollArea className="h-[326px]">
                <div
                  role="listbox"
                  aria-label="Select model"
                  className="flex flex-col gap-0.5 pr-2 pl-0.5"
                >
                  {catalog.map((model) => {
                    const isSelected = model.id === modelId
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-model-id={model.id}
                        onClick={() => handleSelectModel(model)}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-[10px] border border-transparent px-3 py-2 text-left transition-colors hover:bg-hover",
                          isSelected && "border-hairline bg-active"
                        )}
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm leading-snug font-medium text-ink">
                            {model.label}
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
                            isSelected ? "opacity-100" : "opacity-0"
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  )
}
