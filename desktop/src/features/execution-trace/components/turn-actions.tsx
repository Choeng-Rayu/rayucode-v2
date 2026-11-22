import * as React from "react"
import { Check, Copy, GitFork, Pin, Play } from "lucide-react"
import { toast } from "sonner"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { forkTurnFromHere, toggleTurnPin } from "../api/trace-api"
import type { SessionSummary } from "../types"

export interface TurnActionsProps {
  sessionId: string
  turnId: string
  responseMarkdown: string
  timestamp: string
  credits: string
  kvCachePct: number
  pinned?: boolean
  onForked?: (session: SessionSummary) => void
  onPinToggled?: (turnId: string, pinned: boolean) => void
  onReplayTrace?: () => void
  className?: string
}

export function TurnActions({
  sessionId,
  turnId,
  responseMarkdown,
  timestamp,
  credits,
  kvCachePct,
  pinned: initialPinned = false,
  onForked,
  onPinToggled,
  onReplayTrace,
  className,
}: TurnActionsProps) {
  const [copied, setCopied] = React.useState(false)
  const [pinnedOverride, setPinnedOverride] = React.useState<{
    base: boolean
    value: boolean
  } | null>(null)
  const [isForking, setIsForking] = React.useState(false)
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const pinned =
    pinnedOverride !== null && pinnedOverride.base === initialPinned
      ? pinnedOverride.value
      : initialPinned

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(responseMarkdown.trim())
      }
    } catch {
      // ignore clipboard errors in restricted environments
    }
    setCopied(true)
    toast("Copied response to clipboard")
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false)
      copyTimerRef.current = null
    }, 1500)
  }

  const handleFork = async () => {
    if (isForking) return
    setIsForking(true)
    try {
      const result = await forkTurnFromHere(sessionId, turnId)
      if (result.ok) {
        onForked?.(result.data)
        toast("Forked new session from this point · original kept as is")
      } else {
        toast.error(result.error)
      }
    } finally {
      setIsForking(false)
    }
  }

  const handleTogglePin = async () => {
    const optimistic = !pinned
    setPinnedOverride({ base: initialPinned, value: optimistic })
    const result = await toggleTurnPin(turnId)
    if (result.ok) {
      const resolvedPinned = Boolean(result.data.pinned)
      setPinnedOverride({ base: initialPinned, value: resolvedPinned })
      onPinToggled?.(turnId, resolvedPinned)
      toast(
        resolvedPinned ? "Pinned response to session" : "Unpinned response"
      )
    } else {
      onPinToggled?.(turnId, optimistic)
      toast(optimistic ? "Pinned response to session" : "Unpinned response")
    }
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div
        data-slot="turn-actions"
        className={cn("flex flex-wrap items-center gap-0.5 pt-1", className)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label="Copy response"
              className={cn(
                "grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                copied && "text-brand-text"
              )}
            >
              {copied ? (
                <Check className="size-[15px]" aria-hidden="true" />
              ) : (
                <Copy className="size-[15px]" aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={10}
            className="w-auto rounded-xl border border-premium-hi bg-popover px-3 py-2 text-left shadow-bevel-card shadow-rayu-2"
          >
            <div className="text-[13px] font-medium tracking-tight text-ink">
              {copied ? "Copied" : "Copy response"}
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void handleFork()}
              disabled={isForking}
              aria-label="Fork from here"
              className="grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <GitFork className="size-[15px]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={10}
            className="flex w-[248px] flex-col items-start gap-1 rounded-xl border border-premium-hi bg-popover px-3.5 py-2.5 text-left shadow-bevel-card shadow-rayu-2"
          >
            <div className="text-[13.5px] leading-tight font-medium tracking-tight text-ink">
              Fork from here
            </div>
            <div className="text-[12.2px] leading-[1.42] font-normal text-muted-ink">
              Starts a new session from this point. This one stays as it is.
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void handleTogglePin()}
              aria-pressed={pinned}
              aria-label="Pin response"
              className={cn(
                "grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                pinned && "bg-brand-soft text-brand-text"
              )}
            >
              <Pin className="size-[15px]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={10}
            className="flex w-[248px] flex-col items-start gap-1 rounded-xl border border-premium-hi bg-popover px-3.5 py-2.5 text-left shadow-bevel-card shadow-rayu-2"
          >
            <div className="text-[13.5px] leading-tight font-medium tracking-tight text-ink">
              {pinned ? "Pinned response" : "Pin response"}
            </div>
            <div className="text-[12.2px] leading-[1.42] font-normal text-muted-ink">
              Keeps this reply pinned so you can jump back to it anytime.
            </div>
          </TooltipContent>
        </Tooltip>

        <span className="ml-2 text-[12.5px] text-muted-ink">{timestamp}</span>

        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] text-muted-ink tabular-nums">
          <span className="text-brand-text">{credits}</span>
          <span aria-hidden="true">·</span>
          <span>{kvCachePct}% KV cache</span>
          {onReplayTrace && (
            <button
              type="button"
              onClick={onReplayTrace}
              title="Watch live step-by-step execution trace"
              className="ml-1 inline-flex cursor-pointer items-center gap-1 rounded-full border border-hairline bg-pane px-2.5 py-0.5 font-sans text-[11px] font-medium text-body transition-colors hover:border-premium hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Play className="size-2.5 text-brand-text" aria-hidden="true" />
              <span>Simulate live run</span>
            </button>
          )}
        </span>
      </div>
    </TooltipProvider>
  )
}
