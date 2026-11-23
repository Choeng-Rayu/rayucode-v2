import * as React from "react"
import { ArrowRight, Mic, Pencil, X } from "lucide-react"

import type {
  ClarifyingOption,
  ComposerTemplateItem,
} from "@/lib/composer-templates"
import { cn } from "@/lib/utils"

interface ClarifyingQuestionCardProps {
  template: ComposerTemplateItem
  onSelectOption: (option: ClarifyingOption) => void
  onSubmitCustom: (instruction: string) => void
  onSkip: () => void
  onClose: () => void
  voiceActive?: boolean
  onVoiceToggle?: () => void
}

export function ClarifyingQuestionCard({
  template,
  onSelectOption,
  onSubmitCustom,
  onSkip,
  onClose,
  voiceActive = false,
  onVoiceToggle,
}: ClarifyingQuestionCardProps) {
  const { clarifyingQuestion } = template
  const [hoveredKey, setHoveredKey] = React.useState<string>("2")
  const [customText, setCustomText] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return
      }
      const matched = clarifyingQuestion.options.find(
        (opt) => opt.key === event.key
      )
      if (matched) {
        event.preventDefault()
        onSelectOption(matched)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [clarifyingQuestion.options, onClose, onSelectOption])

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = customText.trim()
    if (!trimmed) return
    onSubmitCustom(trimmed)
  }

  return (
    <div
      data-testid="clarifying-question-card"
      className="rayu-card-bevel mb-2.5 w-full max-w-[732px] rounded-[20px] border border-premium-hi bg-popover-solid p-5 shadow-rayu-2"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h3 className="text-[15px] leading-snug font-medium text-ink">
          {clarifyingQuestion.prompt}
        </h3>
        <button
          type="button"
          aria-label="Dismiss clarifying question"
          onClick={onClose}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-1">
        {clarifyingQuestion.options.map((opt) => {
          const isHighlighted = hoveredKey === opt.key
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`clarifying-option-${opt.key}`}
              onMouseEnter={() => setHoveredKey(opt.key)}
              onFocus={() => setHoveredKey(opt.key)}
              onClick={() => onSelectOption(opt)}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-3 rounded-[12px] border border-transparent px-3 py-2.5 text-left transition-colors outline-none",
                isHighlighted
                  ? "border-hairline bg-hover/90"
                  : "hover:border-hairline hover:bg-hover/70"
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] border border-hairline-hi bg-inset font-mono text-[11px] font-medium text-muted-ink">
                  {opt.key}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-ink">
                      {opt.title}
                    </span>
                    {opt.recommended ? (
                      <span className="rounded-md bg-active px-2 py-0.5 text-[11px] font-medium text-body">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-muted-ink">
                    {opt.subtitle}
                  </p>
                </div>
              </div>

              <ArrowRight
                className={cn(
                  "size-4 shrink-0 text-muted-ink transition-opacity",
                  isHighlighted ? "opacity-100" : "opacity-0"
                )}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>

      <form
        onSubmit={handleCustomSubmit}
        className="mt-3.5 flex items-center gap-2.5 rounded-[14px] border border-info/75 bg-inset/80 px-3.5 py-2 focus-within:border-info"
      >
        <Pencil
          className="size-4 shrink-0 text-muted-ink"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          data-testid="clarifying-custom-input"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder={clarifyingQuestion.placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-muted-ink focus:outline-none"
        />
        {onVoiceToggle ? (
          <button
            type="button"
            aria-label="Voice input for clarification"
            onClick={onVoiceToggle}
            className={cn(
              "grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink",
              voiceActive && "text-brand-text"
            )}
          >
            <Mic className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          data-testid="clarifying-skip-btn"
          onClick={() => {
            if (customText.trim()) {
              onSubmitCustom(customText.trim())
            } else {
              onSkip()
            }
          }}
          className="shrink-0 cursor-pointer rounded-full border border-hairline-hi bg-raised px-3.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-hover"
        >
          {customText.trim() ? "Send" : "Skip"}
        </button>
      </form>
    </div>
  )
}
