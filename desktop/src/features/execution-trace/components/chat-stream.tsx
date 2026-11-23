import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, List } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatSkeleton } from "@/components/ui/page-skeletons"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { traceKeys, traceTurnsQueryOptions } from "../api/trace-api"
import { useLiveTrace } from "../hooks/use-live-trace"
import type { ExecutionTurn, SessionSummary } from "../types"
import { CiteLink, EditorialMarkdown } from "./cite-link"
import { InlineDiffCard } from "./inline-diff-card"
import { TurnActions } from "./turn-actions"
import { WorkTrace } from "./work-trace"

function formatTurnResponseMarkdown(turn: ExecutionTurn): string {
  const parts: string[] = []
  if (turn.answerIntro.trim()) {
    parts.push(turn.answerIntro.trim())
  }
  if (turn.answerSummaryTitle) {
    parts.push(`### ${turn.answerSummaryTitle}`)
  }
  if (turn.answerBullets.length > 0) {
    const bulletLines = turn.answerBullets.map((bullet, idx) => {
      const cites =
        bullet.citations.length > 0
          ? ` (${bullet.citations.map((c) => c.label).join(", ")})`
          : ""
      return `${idx + 1}. **${bullet.title}** ${bullet.body}${cites}`
    })
    parts.push(bulletLines.join("\n"))
  }
  return parts.join("\n\n")
}

interface TurnViewProps {
  turn: ExecutionTurn
  onForked?: (session: SessionSummary) => void
  onPinToggled?: (turnId: string, pinned: boolean) => void
  onReplayTrace?: () => void
}

function TurnView({
  turn,
  onForked,
  onPinToggled,
  onReplayTrace,
}: TurnViewProps) {
  const responseMarkdown = React.useMemo(
    () => formatTurnResponseMarkdown(turn),
    [turn]
  )

  const hasAnswer =
    turn.answerIntro.trim().length > 0 || turn.answerBullets.length > 0
  const hasDiffLines = turn.diffCard.lines.length > 0

  return (
    <article
      data-slot="execution-turn"
      data-turn-id={turn.id}
      className="flex flex-col gap-5"
    >
      {turn.compactedNotice && (
        <div
          data-slot="ctx-note"
          className="inline-flex items-center gap-[7px] py-0.5 text-[12.5px] text-muted-ink"
        >
          <List className="size-3.5 shrink-0 text-muted-ink" aria-hidden="true" />
          <span>{turn.compactedNotice}</span>
        </div>
      )}

      <div className="flex max-w-[82%] flex-col items-end gap-1.5 self-end">
        {turn.userRefFiles && (
          <div
            data-slot="user-ref-pill"
            className="inline-flex max-w-[320px] items-center gap-1.5 rounded-[9px] border border-hairline bg-pane px-[11px] py-[5px] text-xs text-body"
          >
            <FileText
              className="size-[13px] shrink-0 text-muted-ink"
              aria-hidden="true"
            />
            <span className="truncate">{turn.userRefFiles}</span>
          </div>
        )}

        <div
          data-slot="msg-user"
          className="rayu-surface-bevel max-w-full rounded-2xl bg-raised px-[15px] py-[11px] text-sm leading-relaxed text-ink"
        >
          <EditorialMarkdown content={turn.userPrompt} inline />
          {turn.userMeta && (
            <div className="mt-1.5 font-mono text-[10px] text-muted-ink">
              {turn.userMeta}
            </div>
          )}
        </div>
      </div>

      <div data-slot="msg-agent" className="flex flex-col gap-3">
        <WorkTrace
          workedDuration={turn.workedDuration}
          isLive={turn.isLive}
          notes={turn.notes}
          groups={turn.groups}
        />

        {hasAnswer && (
          <div
            data-slot="agent-answer"
            className="flex flex-col gap-3.5 text-[14.5px] leading-[1.64] text-body"
          >
            {turn.answerIntro.trim().length > 0 && (
              <EditorialMarkdown content={turn.answerIntro} />
            )}

            {turn.answerSummaryTitle && (
              <h3 className="mt-1 -mb-1 text-[15px] font-semibold tracking-tight text-ink">
                {turn.answerSummaryTitle}
              </h3>
            )}

            {turn.answerBullets.length > 0 && (
              <ol className="m-0 flex max-w-[72ch] list-decimal flex-col gap-3 pl-5 text-body marker:font-medium marker:text-muted-ink">
                {turn.answerBullets.map((bullet) => (
                  <li key={bullet.id} className="pl-0.5 text-body">
                    <strong className="font-semibold text-ink">
                      {bullet.title}
                    </strong>{" "}
                    <EditorialMarkdown content={bullet.body} inline />
                    {bullet.citations.length > 0 && (
                      <>
                        {" "}
                        {bullet.citations.map((citation, citeIdx) => (
                          <React.Fragment
                            key={`${bullet.id}-${citation.file}-${citation.line ?? citeIdx}`}
                          >
                            {citeIdx > 0 && (
                              <span
                                className="mx-[3px] text-muted-ink"
                                aria-hidden="true"
                              >
                                ·
                              </span>
                            )}
                            <CiteLink citation={citation} />
                          </React.Fragment>
                        ))}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {hasDiffLines && <InlineDiffCard diff={turn.diffCard} />}

        {!turn.isLive && (
          <TurnActions
            sessionId={turn.sessionId}
            turnId={turn.id}
            responseMarkdown={responseMarkdown}
            timestamp={turn.timestamp}
            credits={turn.credits}
            kvCachePct={turn.kvCachePct}
            pinned={turn.pinned}
            onForked={onForked}
            onPinToggled={onPinToggled}
            onReplayTrace={onReplayTrace}
          />
        )}
      </div>
    </article>
  )
}

export interface ChatStreamProps {
  sessionId?: string | null
  turns?: ExecutionTurn[]
  composerSlot?: React.ReactNode
  children?: React.ReactNode
  onForked?: (session: SessionSummary) => void
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

export function ChatStream({
  sessionId: sessionIdProp,
  turns: controlledTurns,
  composerSlot,
  children,
  onForked,
  className,
  ref,
}: ChatStreamProps) {
  const storeSessionId = useAppStore((s) => s.activeSessionId)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const effectiveSessionId = sessionIdProp ?? storeSessionId ?? "ses_retire_cache"

  const queryClient = useQueryClient()
  const { data: fetchedTurns, isLoading } = useQuery({
    ...traceTurnsQueryOptions(effectiveSessionId),
    enabled: controlledTurns === undefined,
  })

  const [completedSimulatedTurns, setCompletedSimulatedTurns] = React.useState<
    ExecutionTurn[]
  >([])

  const { liveTurn, isStreaming, simulateLiveRun, resetLiveTurn } =
    useLiveTrace({
      onComplete: (completedTurn) => {
        setCompletedSimulatedTurns((prev) => [...prev, completedTurn])
        resetLiveTurn()
      },
    })

  const allTurns = React.useMemo(() => {
    const baseTurns = controlledTurns ?? fetchedTurns ?? []
    const merged = [...baseTurns, ...completedSimulatedTurns]
    if (liveTurn) {
      merged.push(liveTurn)
    }
    return merged
  }, [controlledTurns, fetchedTurns, completedSimulatedTurns, liveTurn])

  const handleForked = React.useCallback(
    (forkedSession: SessionSummary) => {
      if (onForked) {
        onForked(forkedSession)
      } else {
        setActiveSession(forkedSession.id)
      }
    },
    [onForked, setActiveSession]
  )

  const handlePinToggled = React.useCallback(
    (turnId: string, pinned: boolean) => {
      queryClient.setQueryData<ExecutionTurn[]>(
        traceKeys.turns(effectiveSessionId),
        (prev) =>
          prev?.map((t) => (t.id === turnId ? { ...t, pinned } : t)) ?? prev
      )
      setCompletedSimulatedTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, pinned } : t))
      )
    },
    [effectiveSessionId, queryClient]
  )

  const handleReplayTrace = React.useCallback(() => {
    if (isStreaming) return
    simulateLiveRun({ sessionId: effectiveSessionId })
  }, [effectiveSessionId, isStreaming, simulateLiveRun])

  const bottomComposer = composerSlot ?? children

  return (
    <div
      ref={ref}
      data-slot="chat-stream"
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      {isStreaming && (
        <div
          role="presentation"
          aria-hidden="true"
          className="h-[1.5px] shrink-0 animate-pulse bg-brand"
        />
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div
          data-slot="stream-container"
          className="mx-auto flex w-full max-w-[780px] flex-col gap-6 px-6 pt-5 pb-4"
        >
          {controlledTurns === undefined && isLoading ? (
            <ChatSkeleton />
          ) : (
            allTurns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                onForked={handleForked}
                onPinToggled={handlePinToggled}
                onReplayTrace={handleReplayTrace}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {bottomComposer && (
        <div
          data-slot="chat-stream-composer-slot"
          className="shrink-0"
        >
          {bottomComposer}
        </div>
      )}
    </div>
  )
}
