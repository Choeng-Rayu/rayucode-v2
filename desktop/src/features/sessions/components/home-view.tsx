import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Clock,
  Code2,
  GitBranch,
  Globe,
  Network,
  Table2,
} from "lucide-react"
import { toast } from "sonner"

import { useAppStore } from "@/lib/app-store"
import { getAuthSession } from "@/lib/auth-placeholder"
import { cn } from "@/lib/utils"

import { QUICK_START_SUGGESTIONS } from "../constants/models"
import { useCreateSession, useSessions } from "../hooks/use-sessions"
import type {
  ComposerSubmitPayload,
  QuickStartSuggestion,
  SessionSummary,
} from "../types"
import { SessionComposer } from "./composer"

export interface HomeViewProps {
  userName?: string
  onSelectSession?: (sessionId: string) => void
  onSessionCreated?: (session: SessionSummary) => void
  className?: string
}

function resolveDisplayName(explicitName?: string): string {
  if (explicitName && explicitName.trim().length > 0) {
    return explicitName.trim()
  }
  const auth = getAuthSession()
  const parts = auth.name.trim().split(/\s+/).filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last) return "Khai"
  return last.charAt(0).toUpperCase() + last.slice(1)
}

function SuggestionIcon({ kind }: { kind: QuickStartSuggestion["kind"] }) {
  switch (kind) {
    case "code":
      return <Code2 className="size-[13px] text-brand-text" aria-hidden="true" />
    case "swarm":
      return (
        <Network className="size-[13px] text-brand-text" aria-hidden="true" />
      )
    case "sheet":
      return (
        <Table2 className="size-[13px] text-brand-text" aria-hidden="true" />
      )
    case "preview":
      return <Globe className="size-[13px] text-brand-text" aria-hidden="true" />
  }
}

interface VirtualizedRecentSessionsProps {
  sessions: readonly SessionSummary[]
  onSelect: (sessionId: string) => void
}

function VirtualizedRecentSessions({
  sessions,
  onSelect,
}: VirtualizedRecentSessionsProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 46,
    overscan: 4,
    initialRect: { width: 732, height: 150 },
  })

  if (sessions.length === 0) return null

  const virtualItems = rowVirtualizer.getVirtualItems()
  const renderedRows =
    virtualItems.length > 0
      ? virtualItems.map((virtualRow) => ({
          index: virtualRow.index,
          size: virtualRow.size,
          start: virtualRow.start,
        }))
      : sessions.slice(0, 6).map((_, index) => ({
          index,
          size: 46,
          start: index * 46,
        }))
  const totalHeight = Math.max(
    rowVirtualizer.getTotalSize(),
    renderedRows.length * 46
  )

  return (
    <section
      aria-label="Recent sessions"
      data-testid="home-recent-sessions"
      className="mx-auto mt-2 w-full max-w-[732px]"
    >
      <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-medium tracking-[0.04em] text-muted-ink uppercase">
        <span>Recent sessions</span>
        <span className="font-mono tabular-nums">{sessions.length}</span>
      </div>
      <div
        ref={scrollRef}
        className="rayu-card-bevel max-h-[146px] overflow-y-auto rounded-[14px] bg-pane/75 p-1"
      >
        <div
          style={{
            height: `${totalHeight}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {renderedRows.map((virtualRow) => {
            const session = sessions[virtualRow.index]
            if (!session) return null
            return (
              <div
                key={session.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="py-0.5"
              >
                <button
                  type="button"
                  data-testid={`recent-session-row-${session.id}`}
                  onClick={() => onSelect(session.id)}
                  className="flex h-full w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-transparent px-3 text-left transition-colors hover:border-hairline hover:bg-hover"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="truncate text-[13px] font-medium text-ink">
                      {session.title}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink sm:inline-flex">
                      <GitBranch className="size-2.5" aria-hidden="true" />
                      <span>{session.project}</span>
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5 text-[11.5px] text-muted-ink">
                    <span className="hidden sm:inline">{session.modelLabel}</span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Clock className="size-3" aria-hidden="true" />
                      <span>{session.updatedAt}</span>
                    </span>
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function HomeView({
  userName,
  onSelectSession,
  onSessionCreated,
  className,
}: HomeViewProps) {
  const displayName = resolveDisplayName(userName)
  const [composerValue, setComposerValue] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const { data: sessions = [] } = useSessions()
  const createSessionMutation = useCreateSession()

  const handleOpenSession = React.useCallback(
    (sessionId: string) => {
      useAppStore.getState().setActiveSession(sessionId)
      onSelectSession?.(sessionId)
    },
    [onSelectSession]
  )

  const handleSubmit = React.useCallback(
    async (payload: ComposerSubmitPayload) => {
      const result = await createSessionMutation.mutateAsync({
        prompt: payload.prompt,
        project: payload.project,
        checkout: payload.checkout,
        modelId: payload.modelId,
        modelLabel: payload.modelLabel,
        effort: payload.effort,
        permissionMode: payload.permissionMode,
      })

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      useAppStore.getState().setActiveSession(result.data.id)
      onSessionCreated?.(result.data)
    },
    [createSessionMutation, onSessionCreated]
  )

  const handlePickSuggestion = (suggestion: QuickStartSuggestion) => {
    setComposerValue(suggestion.prompt)
    textareaRef.current?.focus()
  }

  return (
    <div
      data-testid="home-view"
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-8 text-center">
        {/* Quiet Rayu Geometric Emblem */}
        <div
          aria-hidden="true"
          className="grid size-[60px] place-items-center text-muted-ink/75 transition-colors hover:text-brand-text"
        >
          <svg
            className="size-[52px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" />
            <path d="m9 9.5-2.5 2.5L9 14.5M15 9.5l2.5 2.5-2.5 2.5" />
          </svg>
        </div>

        {/* Editorial Welcome Greeting (Instrument Serif italic accent word) */}
        <h1 className="m-0 text-2xl font-medium tracking-[-0.025em] text-ink">
          Good to see you, {displayName}. What&apos;s{" "}
          <em className="font-serif text-[1.08em] font-normal tracking-[-0.005em] text-brand-text italic">
            next?
          </em>
        </h1>

        {/* Quick-start suggestion pills */}
        <div className="mt-0.5 flex max-w-[732px] flex-wrap items-center justify-center gap-2">
          {QUICK_START_SUGGESTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handlePickSuggestion(item)}
              className="rayu-surface-bevel inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-pane px-3 py-1.5 text-xs text-body transition-colors hover:border-brand/45 hover:bg-brand-softer hover:text-ink"
            >
              <SuggestionIcon kind={item.kind} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Virtualized Recent Sessions */}
        <VirtualizedRecentSessions
          sessions={sessions}
          onSelect={handleOpenSession}
        />
      </div>

      {/* Floating 732px Composer in Home Mode (shows Project & Checkout top tray) */}
      <SessionComposer
        mode="home"
        value={composerValue}
        onValueChange={setComposerValue}
        inputRef={textareaRef}
        onSubmit={handleSubmit}
        isSubmitting={createSessionMutation.isPending}
      />
    </div>
  )
}
