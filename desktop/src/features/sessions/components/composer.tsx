import * as React from "react"
import {
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  Mic,
  Monitor,
  Plus,
} from "lucide-react"
import { toast } from "sonner"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  DEFAULT_CHECKOUT,
  DEFAULT_PROJECT,
  HOME_CHECKOUTS,
  HOME_PROJECTS,
  SLASH_COMMANDS,
} from "../constants/models"
import {
  useModelCatalog,
  usePermissionModes,
  usePersistedInferenceSettings,
} from "../hooks/use-sessions"
import type {
  ComposerMode,
  ComposerSubmitPayload,
  ModelOption,
  PermissionModeId,
  ReasoningEffort,
} from "../types"
import { ModelEffortPopover } from "./model-effort-popover"
import { PermissionPopover } from "./permission-popover"

export interface SessionComposerProps {
  mode?: ComposerMode
  project?: string
  checkout?: string
  onProjectChange?: (project: string) => void
  onCheckoutChange?: (checkout: string) => void
  modelId?: string
  modelLabel?: string
  effort?: ReasoningEffort
  permissionMode?: PermissionModeId
  onModelChange?: (model: ModelOption) => void
  onEffortChange?: (effort: ReasoningEffort) => void
  onPermissionModeChange?: (mode: PermissionModeId) => void
  onSubmit?: (payload: ComposerSubmitPayload) => void | Promise<void>
  placeholder?: string
  disabled?: boolean
  isSubmitting?: boolean
  value?: string
  onValueChange?: (value: string) => void
  inputRef?: React.Ref<HTMLTextAreaElement>
  className?: string
}

export function SessionComposer({
  mode = "home",
  project: controlledProject,
  checkout: controlledCheckout,
  onProjectChange,
  onCheckoutChange,
  modelId: controlledModelId,
  modelLabel: controlledModelLabel,
  effort: controlledEffort,
  permissionMode: controlledPermissionMode,
  onModelChange,
  onEffortChange,
  onPermissionModeChange,
  onSubmit,
  placeholder = "Ask anything, @ to mention, / for actions",
  disabled = false,
  isSubmitting = false,
  value: controlledValue,
  onValueChange,
  inputRef,
  className,
}: SessionComposerProps) {
  const { models, refreshModels, isRefreshing } = useModelCatalog()
  const { modes } = usePermissionModes()
  const persisted = usePersistedInferenceSettings(models)

  const [internalValue, setInternalValue] = React.useState("")
  const [internalProject, setInternalProject] = React.useState(DEFAULT_PROJECT)
  const [internalCheckout, setInternalCheckout] =
    React.useState(DEFAULT_CHECKOUT)
  const [slashOpen, setSlashOpen] = React.useState(false)
  const [slashTipOpen, setSlashTipOpen] = React.useState(false)
  const [projectOpen, setProjectOpen] = React.useState(false)
  const [checkoutOpen, setCheckoutOpen] = React.useState(false)
  const [voiceActive, setVoiceActive] = React.useState(false)

  const localTextareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useImperativeHandle(
    inputRef,
    () => localTextareaRef.current as HTMLTextAreaElement
  )

  const textValue = controlledValue ?? internalValue
  const activeProject = controlledProject ?? internalProject
  const activeCheckout = controlledCheckout ?? internalCheckout
  const activeModelId = controlledModelId ?? persisted.modelId
  const activeModelLabel = controlledModelLabel ?? persisted.modelLabel
  const activeEffort = controlledEffort ?? persisted.effort
  const activePermissionMode =
    controlledPermissionMode ?? persisted.permissionMode

  const setTextValue = React.useCallback(
    (next: string) => {
      if (onValueChange) {
        onValueChange(next)
      } else {
        setInternalValue(next)
      }
    },
    [onValueChange]
  )

  const handleModelSelect = React.useCallback(
    (model: ModelOption) => {
      persisted.setModel(model)
      onModelChange?.(model)
    },
    [onModelChange, persisted]
  )

  const handleEffortSelect = React.useCallback(
    (nextEffort: ReasoningEffort) => {
      persisted.setEffort(nextEffort)
      onEffortChange?.(nextEffort)
    },
    [onEffortChange, persisted]
  )

  const handlePermissionSelect = React.useCallback(
    (nextMode: PermissionModeId) => {
      persisted.setPermissionMode(nextMode)
      onPermissionModeChange?.(nextMode)
    },
    [onPermissionModeChange, persisted]
  )

  const handleProjectSelect = (nextProject: string) => {
    setInternalProject(nextProject)
    onProjectChange?.(nextProject)
    setProjectOpen(false)
    toast(`Project: ${nextProject}`)
  }

  const handleCheckoutSelect = (nextCheckout: string) => {
    setInternalCheckout(nextCheckout)
    onCheckoutChange?.(nextCheckout)
    setCheckoutOpen(false)
    toast(`Checkout: ${nextCheckout}`)
  }

  const adjustTextareaHeight = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      if (!node) return
      node.style.height = "auto"
      node.style.height = `${Math.min(node.scrollHeight, 180)}px`
    },
    []
  )

  React.useEffect(() => {
    adjustTextareaHeight(localTextareaRef.current)
  }, [textValue, adjustTextareaHeight])

  const handleSend = async () => {
    if (disabled || isSubmitting) return
    const trimmed = textValue.trim()
    if (!trimmed) {
      localTextareaRef.current?.focus()
      toast("Type a prompt or /command first")
      return
    }

    setSlashOpen(false)
    const payload: ComposerSubmitPayload = {
      prompt: trimmed,
      project: activeProject,
      checkout: activeCheckout,
      modelId: activeModelId,
      modelLabel: activeModelLabel,
      effort: activeEffort,
      permissionMode: activePermissionMode,
    }

    setTextValue("")
    await onSubmit?.(payload)
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value
    setTextValue(next)
    setSlashOpen(next.startsWith("/"))
  }

  const handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Escape" && slashOpen) {
      event.preventDefault()
      setSlashOpen(false)
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const handleInsertSlashCommand = (insertText: string) => {
    setTextValue(`${insertText} `)
    setSlashOpen(false)
    localTextareaRef.current?.focus()
  }

  const handleVoiceToggle = () => {
    setVoiceActive((prev) => {
      const next = !prev
      toast(next ? "Voice input listening..." : "Voice input stopped")
      return next
    })
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div
        data-testid="session-composer-dock"
        data-composer-mode={mode}
        className={cn(
          "flex w-full shrink-0 justify-center px-6",
          mode === "home" ? "pb-[22px]" : "pb-3.5",
          className
        )}
      >
        <div
          data-testid="composer-shell"
          className="rayu-card-bevel relative w-full max-w-[732px] rounded-[22px] bg-shell p-[5px] focus:shadow-none focus:outline-none"
        >
          {/* Project & Checkout Top Tray — ONLY rendered on Home (New Session) */}
          {mode === "home" ? (
            <div
              data-testid="composer-top-tray"
              className="flex items-center gap-2.5 px-[13px] pt-[5px] pb-2 text-xs text-muted-ink"
            >
              <Popover open={projectOpen} onOpenChange={setProjectOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="composer-project-trigger"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-[3px] text-xs font-normal text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-body focus:outline-none"
                  >
                    <Folder className="size-[13px] text-muted-ink" aria-hidden="true" />
                    <span>{activeProject}</span>
                    <ChevronDown
                      className="size-[11px] opacity-70"
                      aria-hidden="true"
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="rayu-card-bevel w-52 rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-rayu-2"
                >
                  <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-ink uppercase">
                    Project
                  </div>
                  {HOME_PROJECTS.map((proj) => (
                    <button
                      key={proj}
                      type="button"
                      onClick={() => handleProjectSelect(proj)}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover",
                        proj === activeProject && "bg-active"
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Folder
                          className="size-3.5 text-muted-ink"
                          aria-hidden="true"
                        />
                        <span>{proj}</span>
                      </span>
                      {proj === activeProject ? (
                        <Check className="size-3.5 text-ink" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              <Popover open={checkoutOpen} onOpenChange={setCheckoutOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="composer-checkout-trigger"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-[3px] text-xs font-normal text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-body focus:outline-none"
                  >
                    <Monitor className="size-[13px] text-muted-ink" aria-hidden="true" />
                    <span>{activeCheckout}</span>
                    <ChevronDown
                      className="size-[11px] opacity-70"
                      aria-hidden="true"
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="rayu-card-bevel w-52 rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-rayu-2"
                >
                  <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-ink uppercase">
                    Checkout
                  </div>
                  {HOME_CHECKOUTS.map((co) => (
                    <button
                      key={co}
                      type="button"
                      onClick={() => handleCheckoutSelect(co)}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover",
                        co === activeCheckout && "bg-active"
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Monitor
                          className="size-3.5 text-muted-ink"
                          aria-hidden="true"
                        />
                        <span>{co}</span>
                      </span>
                      {co === activeCheckout ? (
                        <Check className="size-3.5 text-ink" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          ) : null}

          {/* Inner Elevated Composer Surface (Zero file chips, zero focus glow ring) */}
          <div
            data-testid="composer-inner"
            className="flex flex-col rounded-[17px] border border-premium-hi bg-raised shadow-rayu-1 focus-within:ring-0 focus-within:outline-none"
          >
            <textarea
              ref={localTextareaRef}
              rows={1}
              value={textValue}
              disabled={disabled || isSubmitting}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              placeholder={placeholder}
              aria-label={
                mode === "home" ? "Message RayuCode" : "Reply to RayuCode"
              }
              className="block max-h-[180px] min-h-[52px] w-full resize-none border-none bg-transparent px-[18px] pt-3.5 pb-[9px] text-sm leading-normal text-ink placeholder:text-muted-ink focus:ring-0 focus:shadow-none focus:outline-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-60"
            />

            <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-[11px]">
              {/* Left + Attach / CLI Slash Command Trigger */}
              <Popover open={slashOpen} onOpenChange={setSlashOpen}>
                <Tooltip
                  open={!slashOpen && slashTipOpen}
                  onOpenChange={setSlashTipOpen}
                >
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label="Add context or CLI command"
                        data-testid="composer-plus-trigger"
                        className="grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none data-[state=open]:border-hairline data-[state=open]:bg-hover data-[state=open]:text-ink"
                      >
                        <Plus className="size-[15px]" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Add context or CLI command
                  </TooltipContent>
                </Tooltip>

                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={12}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onFocusOutside={(event) => {
                    if (
                      event.detail.originalEvent.target ===
                      localTextareaRef.current
                    ) {
                      event.preventDefault()
                    }
                  }}
                  onInteractOutside={(event) => {
                    if (
                      event.detail.originalEvent.target ===
                      localTextareaRef.current
                    ) {
                      event.preventDefault()
                    }
                  }}
                  className="rayu-card-bevel w-[390px] max-w-[calc(100vw-32px)] rounded-[14px] border border-premium-hi bg-popover-solid p-1.5 shadow-rayu-2"
                >
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.06em] text-muted-ink uppercase">
                    RayuCode CLI Commands (v1 Parity)
                  </div>
                  <div className="flex flex-col">
                    {SLASH_COMMANDS.map((item) => (
                      <button
                        key={item.command}
                        type="button"
                        onClick={() => handleInsertSlashCommand(item.insertText)}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hover"
                      >
                        <span className="min-w-[108px] font-mono font-semibold text-brand-text">
                          {item.command}
                        </span>
                        <span className="truncate text-muted-ink">
                          {item.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* 2-Stage Model & 5-Stop Reasoning Effort Popover */}
              <ModelEffortPopover
                modelId={activeModelId}
                modelLabel={activeModelLabel}
                effort={activeEffort}
                models={models}
                onSelectModel={handleModelSelect}
                onSelectEffort={handleEffortSelect}
                onRefreshModels={refreshModels}
                isRefreshing={isRefreshing}
                disabled={disabled}
              />

              <span className="flex-1" />

              {/* 5 Local Permission Modes Popover (Shift+Tab cycle) */}
              <PermissionPopover
                value={activePermissionMode}
                onChange={handlePermissionSelect}
                modes={modes}
                disabled={disabled}
              />

              {/* Voice Input Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label="Voice input"
                    aria-pressed={voiceActive}
                    onClick={handleVoiceToggle}
                    className={cn(
                      "grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none",
                      voiceActive &&
                        "border-brand/40 bg-brand-softer text-brand-text"
                    )}
                  >
                    <Mic className="size-[15px]" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Voice input</TooltipContent>
              </Tooltip>

              {/* Primary Send Orb Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled || isSubmitting}
                    aria-label="Send message"
                    data-testid="composer-send-btn"
                    onClick={() => void handleSend()}
                    className="rayu-primary-bevel ml-0.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-brand-ink transition-all outline-none hover:scale-[1.04] hover:bg-brand-bright focus:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <ArrowUp
                      className="size-[15px]"
                      strokeWidth={2.2}
                      aria-hidden="true"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Send message</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
