import * as React from "react"
import { Check, ChevronRight, Copy, Terminal, X } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

import type { ShellCommandStep } from "../types"

export interface ShellCardProps {
  step: ShellCommandStep
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  standalone?: boolean
  className?: string
}

export function ShellCard({
  step,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  standalone = false,
  className,
}: ShellCardProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = React.useState(
    standalone || defaultExpanded
  )
  const [copied, setCopied] = React.useState(false)
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const isControlled = controlledExpanded !== undefined
  const isExpanded = standalone
    ? true
    : isControlled
      ? controlledExpanded
      : uncontrolledExpanded

  const isFailed = Boolean(step.isFailed) || step.exitCode !== 0
  const cardId = `shell-card-${step.id}`

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const handleToggle = () => {
    const next = !isExpanded
    if (!isControlled) {
      setUncontrolledExpanded(next)
    }
    onExpandedChange?.(next)
  }

  const handleCopy = async () => {
    const payload = step.output
      ? `$ ${step.command}\n${step.output}`
      : step.command
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload)
      }
    } catch {
      // ignore clipboard permission errors in restricted contexts
    }
    setCopied(true)
    toast("Copied command output")
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false)
      copyTimerRef.current = null
    }, 1500)
  }

  const cardBody = (
    <div
      id={cardId}
      data-slot="shell-card"
      className={cn(
        "my-0.5 overflow-hidden rounded-[11px] border border-hairline bg-inset shadow-bevel-surface",
        standalone && className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline-soft px-3.5 py-2 text-[11.5px] font-medium text-muted-ink">
        <span>Shell</span>
        <div className="flex items-center gap-2.5">
          <span
            data-slot="shell-status"
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
              isFailed ? "text-danger" : "text-brand-text"
            )}
          >
            {isFailed ? (
              <X className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span>{step.statusLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy command"
            title="Copy command"
            className={cn(
              "grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              copied && "text-brand-text"
            )}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div className="break-words px-3.5 pt-2 pb-1.5 font-mono text-[12.2px] leading-relaxed text-ink">
        $ {step.command}
      </div>

      {step.output && (
        <pre className="m-0 max-h-[210px] overflow-auto px-3.5 pt-0.5 pb-2.5 font-mono text-xs leading-[1.55] whitespace-pre text-body tabular-nums">
          {step.output}
        </pre>
      )}
    </div>
  )

  if (standalone) {
    return cardBody
  }

  const useMonoRow = !isFailed && step.isMono !== false

  return (
    <div data-slot="shell-command-row" className={cn("flex flex-col", className)}>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={cardId}
        onClick={handleToggle}
        className={cn(
          "-ml-2 flex w-full cursor-pointer items-center gap-2 rounded-[9px] border border-transparent px-2 py-1 text-left text-[13px] leading-[1.4] text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isExpanded && "border-brand/45 bg-brand-softer text-ink"
        )}
      >
        <Terminal
          className="size-3.5 shrink-0 text-muted-ink"
          aria-hidden="true"
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            useMonoRow ? "font-mono text-[12.2px]" : "font-sans",
            isFailed && !isExpanded && "text-muted-ink"
          )}
        >
          {useMonoRow ? `$ ${step.displayCommand}` : step.displayCommand}
        </span>
        <ChevronRight
          className={cn(
            "ml-1 size-3 shrink-0 text-muted-ink transition-transform duration-150",
            isExpanded && "rotate-90 text-ink"
          )}
          aria-hidden="true"
        />
      </button>

      {isExpanded && cardBody}
    </div>
  )
}
