import * as React from "react"
import {
  extractTodosFromHarnessFrame,
  reconcileChatTurns,
  shouldClearStaleLiveTurn,
  type SessionTodoItem,
} from "@rayu-dev/rayucode-session-core/client"
import { TaskChecklistCard } from "@rayu-dev/rayucode-ui/tasks"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  Check,
  ChevronDown,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Laptop,
  List,
  Pencil,
  Presentation,
  Terminal,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatSkeleton } from "@/components/ui/page-skeletons"
import { sessionsQueryOptions } from "@/features/sessions"
import {
  useAppStore,
  type MidTurnMessageItem,
  type PendingQuestion,
} from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { traceKeys, traceTurnsQueryOptions } from "../api/trace-api"
import {
  cancelMidTurnMessage,
  clearSessionLiveTurn,
  dispatchPendingStreamPrompt,
  editMidTurnMessage,
  isLiveTraceControllerMounted,
  processHarnessFrame,
  promoteQueuedMessageToSteer,
  sendQueuedMessageNow,
  toReconcilableTurn,
  useLiveTraceStore,
} from "../hooks/live-trace-store"
import type {
  ExecutionTurn,
  FileChangesSnapshot,
  SessionSummary,
} from "../types"
import { CiteLink, EditorialMarkdown } from "./cite-link"
import { InlineDiffCard } from "./inline-diff-card"
import { TurnActions } from "./turn-actions"
import { TurnFileSummaryCard } from "./turn-file-summary-card"
import { WorkTrace } from "./work-trace"

const EMPTY_SESSION_TODOS: SessionTodoItem[] = []
const EMPTY_MID_TURN_MESSAGES: MidTurnMessageItem[] = []

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
  fileChangesSnapshot?: FileChangesSnapshot | null
  onForked?: (session: SessionSummary) => void
  onPinToggled?: (turnId: string, pinned: boolean) => void
  onReplayTrace?: () => void
}

function TurnView({
  turn,
  fileChangesSnapshot,
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
  const hasFileSummary =
    !turn.isLive &&
    Boolean(fileChangesSnapshot && fileChangesSnapshot.files.length > 0)
  const hasDiffLines = !hasFileSummary && turn.diffCard.lines.length > 0
  const hasUserContent = Boolean(
    turn.compactedNotice ||
      turn.userRefFiles ||
      (turn.userImages && turn.userImages.length > 0) ||
      turn.userPrompt.trim().length > 0 ||
      turn.userMeta
  )
  const hasWorkTrace =
    turn.isLive ||
    turn.notes.length > 0 ||
    turn.groups.length > 0 ||
    Boolean(turn.timeline && turn.timeline.length > 0)

  if (
    !turn.isLive &&
    !hasUserContent &&
    !hasAnswer &&
    !hasWorkTrace &&
    !hasFileSummary &&
    !hasDiffLines &&
    !turn.outputArtifact
  ) {
    return null
  }

  return (
    <article
      data-slot="execution-turn"
      data-turn-id={turn.id}
      className="flex min-w-0 flex-col gap-5"
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

        {turn.userImages && turn.userImages.length > 0 && (
          <div
            data-slot="user-image-attachments"
            className="flex flex-wrap justify-end gap-2"
          >
            {turn.userImages.map((img, idx) => (
              <img
                key={`${img.name}_${idx}`}
                src={img.dataUrl}
                alt={img.name}
                className="h-24 max-w-[180px] rounded-xl border border-hairline bg-inset object-cover shadow-bevel-surface"
              />
            ))}
          </div>
        )}

        {(turn.userPrompt.trim().length > 0 || Boolean(turn.userMeta)) && (
          <div
            data-slot="msg-user"
            className="max-w-full rounded-2xl bg-active/85 px-4 py-2.5 text-[14.5px] leading-[1.6] text-ink whitespace-pre-wrap"
          >
            {turn.userPrompt}
            {turn.userMeta && (
              <div className="mt-1.5 font-mono text-[10px] text-muted-ink">
                {turn.userMeta}
              </div>
            )}
          </div>
        )}
      </div>

      <div data-slot="msg-agent" className="flex min-w-0 flex-col gap-3">
        {(turn.isLive ||
          turn.notes.length > 0 ||
          turn.groups.length > 0 ||
          (turn.timeline && turn.timeline.length > 0)) && (
          <WorkTrace
            workedDuration={turn.workedDuration}
            isLive={turn.isLive}
            notes={turn.notes}
            groups={turn.groups}
            timeline={turn.timeline}
            activeToolStatus={turn.activeToolStatus}
            defaultExpanded={
              !turn.isLive &&
              !hasAnswer &&
              (turn.notes.length > 0 ||
                turn.groups.length > 0 ||
                Boolean(turn.timeline && turn.timeline.length > 0))
                ? true
                : undefined
            }
          />
        )}

        {hasAnswer && (
          <div
            data-slot="agent-answer"
            className="flex min-w-0 flex-col gap-3.5 text-[14.5px] leading-[1.64] break-words text-body"
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

        {hasFileSummary && fileChangesSnapshot && (
          <TurnFileSummaryCard
            sessionId={turn.sessionId}
            snapshot={fileChangesSnapshot}
          />
        )}

        {hasDiffLines && <InlineDiffCard diff={turn.diffCard} />}

        {turn.outputArtifact ? (
          <div
            data-testid="turn-output-artifact-card"
            className="flex min-w-0 items-center justify-between gap-3 rounded-[14px] border border-hairline bg-raised px-3.5 py-2.5 shadow-bevel-surface"
          >
            <button
              type="button"
              onClick={() =>
                useAppStore
                  .getState()
                  .openDocPreview(
                    turn.outputArtifact!.kind,
                    turn.outputArtifact!.pillLabel
                  )
              }
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-hairline bg-inset"
                style={
                  turn.outputArtifact.kind === "slide"
                    ? { color: "rgb(234, 88, 12)" }
                    : turn.outputArtifact.kind === "excel"
                      ? { color: "rgb(34, 197, 94)" }
                      : { color: "rgb(96, 165, 250)" }
                }
              >
                {turn.outputArtifact.kind === "slide" ? (
                  <Presentation className="size-4" aria-hidden="true" />
                ) : turn.outputArtifact.kind === "excel" ? (
                  <FileSpreadsheet className="size-4" aria-hidden="true" />
                ) : (
                  <FileText className="size-4" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium text-ink">
                  {turn.outputArtifact.title}
                </span>
                <span className="block truncate text-xs text-muted-ink">
                  {turn.outputArtifact.subtitle}
                </span>
              </span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="artifact-open-trigger"
                  className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hairline-hi bg-inset px-3.5 text-xs font-medium text-ink transition-colors hover:bg-hover"
                >
                  <span>Open</span>
                  <ChevronDown
                    className="size-3.5 text-muted-ink"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() =>
                    useAppStore
                      .getState()
                      .openDocPreview(
                        turn.outputArtifact!.kind,
                        turn.outputArtifact!.pillLabel
                      )
                  }
                >
                  <span>Open in RayuCode split view</span>
                </DropdownMenuItem>
                {turn.outputArtifact.kind === "slide" ? (
                  <DropdownMenuItem
                    onClick={() => {
                      const deck = useAppStore.getState().slideDeck
                      if (!deck || deck.slides.length === 0) {
                        toast.error("No presentation deck loaded yet")
                        return
                      }
                      void ipcClient.native
                        .openInPowerPoint({
                          filePath: deck.filePath,
                          title: deck.title,
                          slides: deck.slides,
                        })
                        .then((res) => {
                          if (res.ok) {
                            toast(`Opened "${deck.title}" in Microsoft PowerPoint`)
                          }
                        })
                    }}
                  >
                    <ExternalLink className="mr-2 size-3.5" aria-hidden="true" />
                    <span>Open in Microsoft PowerPoint</span>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}

        {!turn.isLive && (
          <TurnActions
            sessionId={turn.sessionId}
            turnId={turn.id}
            upToMessageIndex={turn.sourceEndMessageIndex}
            upToMessageId={turn.sourceEndMessageId}
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

interface LiveQuestionDraftAnswer {
  selected: number[]
  customText: string
}

function LiveQuestionPromptCard({
  pendingQuestion,
  onSubmitAnswers,
  onDecline,
}: {
  pendingQuestion: PendingQuestion
  onSubmitAnswers: (
    answers: Record<string, { selected?: number[]; custom?: string[] }>
  ) => Promise<void>
  onDecline: () => Promise<void>
}) {
  const [drafts, setDrafts] = React.useState<
    Record<string, LiveQuestionDraftAnswer>
  >({})
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [submitting, setSubmitting] = React.useState(false)

  const questions = pendingQuestion.questions
  const clampedIdx = Math.min(activeIndex, Math.max(0, questions.length - 1))
  const current = questions[clampedIdx]
  if (!current) return null

  const draft = drafts[current.question] ?? { selected: [], customText: "" }
  const isComplete = questions.every((q) => {
    const entry = drafts[q.question]
    if (!entry) return false
    return entry.selected.length > 0 || entry.customText.trim().length > 0
  })

  const toggleOption = (optionIdx: number) => {
    setDrafts((prev) => {
      const existing = prev[current.question] ?? {
        selected: [],
        customText: "",
      }
      if (current.multiSelect) {
        const already = existing.selected.includes(optionIdx)
        return {
          ...prev,
          [current.question]: {
            ...existing,
            selected: already
              ? existing.selected.filter((i) => i !== optionIdx)
              : [...existing.selected, optionIdx].sort((a, b) => a - b),
          },
        }
      }
      return {
        ...prev,
        [current.question]: {
          ...existing,
          selected: [optionIdx],
        },
      }
    })
  }

  const updateCustomText = (val: string) => {
    setDrafts((prev) => {
      const existing = prev[current.question] ?? {
        selected: [],
        customText: "",
      }
      return {
        ...prev,
        [current.question]: {
          ...existing,
          customText: val,
        },
      }
    })
  }

  const handleConfirmSubmit = async () => {
    if (submitting || !isComplete) return
    setSubmitting(true)
    try {
      const answers: Record<
        string,
        { selected?: number[]; custom?: string[] }
      > = {}
      for (const q of questions) {
        const entry = drafts[q.question] ?? { selected: [], customText: "" }
        const customTrimmed = entry.customText.trim()
        answers[q.question] = {
          ...(entry.selected.length > 0 ? { selected: entry.selected } : {}),
          ...(customTrimmed ? { custom: [customTrimmed] } : {}),
        }
      }
      await onSubmitAnswers(answers)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeclineClick = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onDecline()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="live-question-card"
      className="mx-auto mb-3 w-full max-w-[732px] px-6"
    >
      <div className="rayu-card-bevel flex flex-col gap-3 rounded-[20px] border border-premium-hi bg-popover-solid p-5 shadow-rayu-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center rounded-md bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
              {current.header}
            </span>
            <h3 className="mt-1.5 text-[15px] leading-snug font-medium text-ink">
              {current.question}
            </h3>
          </div>
          <button
            type="button"
            aria-label="Decline question"
            disabled={submitting}
            data-testid="live-question-decline-x-btn"
            onClick={() => void handleDeclineClick()}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {questions.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {questions.map((q, idx) => {
              const answered = Boolean(
                drafts[q.question]?.selected.length ||
                  drafts[q.question]?.customText.trim()
              )
              return (
                <button
                  key={`${q.header}_${idx}`}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    idx === clampedIdx
                      ? "border-brand bg-brand-soft text-brand-text"
                      : answered
                        ? "border-hairline-hi bg-active text-ink"
                        : "border-hairline bg-inset text-muted-ink hover:text-ink"
                  )}
                >
                  {q.header}
                </button>
              )
            })}
          </div>
        )}

        {current.options.length > 0 && (
          <div className="space-y-1">
            {current.options.map((opt, optIdx) => {
              const selected = draft.selected.includes(optIdx)
              return (
                <button
                  key={`${opt.label}_${optIdx}`}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`live-question-option-${optIdx}`}
                  onClick={() => toggleOption(optIdx)}
                  className={cn(
                    "flex w-full cursor-pointer items-start justify-between gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-brand bg-brand-soft/60 text-ink"
                      : "border-transparent hover:border-hairline hover:bg-hover/70"
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] border font-mono text-[11px] font-medium",
                        selected
                          ? "border-brand bg-brand text-brand-ink"
                          : "border-hairline-hi bg-inset text-muted-ink"
                      )}
                    >
                      {selected ? (
                        <Check className="size-3" aria-hidden="true" />
                      ) : (
                        optIdx + 1
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium text-ink">
                        {opt.label}
                      </div>
                      {opt.description ? (
                        <p className="mt-0.5 text-[12px] leading-snug text-muted-ink">
                          {opt.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-inset/80 px-3 py-2">
          <Pencil
            className="size-3.5 shrink-0 text-muted-ink"
            aria-hidden="true"
          />
          <input
            type="text"
            data-testid="live-question-custom-input"
            value={draft.customText}
            onChange={(e) => updateCustomText(e.target.value)}
            placeholder="Add a custom answer or clarification..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted-ink focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            disabled={submitting}
            data-testid="live-question-decline-btn"
            onClick={() => void handleDeclineClick()}
            className="cursor-pointer rounded-full border border-hairline-hi bg-inset px-4 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-hover disabled:opacity-50"
          >
            Skip / Decline
          </button>
          <button
            type="button"
            disabled={submitting || !isComplete}
            data-testid="live-question-submit-btn"
            onClick={() => void handleConfirmSubmit()}
            className="cursor-pointer rounded-full bg-brand px-4 py-1.5 text-[12.5px] font-semibold text-brand-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Submit answer
          </button>
        </div>
      </div>
    </div>
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
  const effectiveSessionId =
    sessionIdProp ??
    storeSessionId ??
    (import.meta.env.MODE === "test" ? "ses_retire_cache" : "")

  const queryClient = useQueryClient()
  const { data: fetchedTurns, isLoading } = useQuery({
    ...traceTurnsQueryOptions(effectiveSessionId),
    enabled: controlledTurns === undefined && effectiveSessionId.length > 0,
  })

  const bottomAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const liveTurn = useLiveTraceStore((s) =>
    effectiveSessionId ? (s.liveTurnsBySession[effectiveSessionId] ?? null) : null
  )
  const completedLiveTurns = useLiveTraceStore((s) =>
    effectiveSessionId
      ? (s.completedLiveTurnsBySession[effectiveSessionId] ?? undefined)
      : undefined
  )
  const baseHistoryTurnCount = useLiveTraceStore((s) =>
    effectiveSessionId
      ? s.baseHistoryTurnCountBySession[effectiveSessionId]
      : undefined
  )
  const lastEventAtMs = useLiveTraceStore((s) =>
    effectiveSessionId ? s.lastEventAtMsBySession[effectiveSessionId] : undefined
  )
  const daemonSessionStatus = useLiveTraceStore((s) =>
    effectiveSessionId
      ? s.daemonSessionStatusBySession[effectiveSessionId]
      : undefined
  )
  const sessionsQuery = useQuery({
    ...sessionsQueryOptions(),
    enabled: effectiveSessionId.length > 0,
  })
  const activeSessionStatus = React.useMemo(
    () =>
      sessionsQuery.data?.find((s) => s.id === effectiveSessionId)?.status ??
      null,
    [effectiveSessionId, sessionsQuery.data]
  )
  const isStreaming = Boolean(liveTurn?.isLive)

  const pendingPermission = useAppStore((s) =>
    effectiveSessionId
      ? (s.pendingPermissionsBySession[effectiveSessionId]?.[0] ?? null)
      : s.pendingPermission
  )
  const clearPendingPermission = useAppStore((s) => s.clearPendingPermission)
  const pendingQuestion = useAppStore((s) =>
    effectiveSessionId
      ? (s.pendingQuestionsBySession[effectiveSessionId]?.[0] ?? null)
      : s.pendingQuestion
  )
  const clearPendingQuestion = useAppStore((s) => s.clearPendingQuestion)
  const midTurnMessages = useAppStore((s) =>
    effectiveSessionId
      ? (s.midTurnMessagesBySession[effectiveSessionId] ?? EMPTY_MID_TURN_MESSAGES)
      : EMPTY_MID_TURN_MESSAGES
  )
  const isQueuePaused = useAppStore((s) =>
    effectiveSessionId ? Boolean(s.pausedQueueSessions[effectiveSessionId]) : false
  )
  const pendingStreamPrompt = useAppStore((s) => s.pendingStreamPrompt)
  const setPendingStreamPrompt = useAppStore((s) => s.setPendingStreamPrompt)
  const setIsStreamActive = useAppStore((s) => s.setIsStreamActive)
  const sessionFileChanges = useAppStore((s) =>
    effectiveSessionId ? s.sessionFileChangesBySession[effectiveSessionId] : undefined
  )
  const setSessionFileChanges = useAppStore((s) => s.setSessionFileChanges)
  const sessionTodos = useAppStore((s) =>
    effectiveSessionId
      ? (s.sessionTodosBySession[effectiveSessionId] ?? EMPTY_SESSION_TODOS)
      : EMPTY_SESSION_TODOS
  )
  const setSessionTodos = useAppStore((s) => s.setSessionTodos)

  // Hydrate persisted/session file changes AFTER history finishes loading so
  // getFileChanges never competes ahead of getHistory on daemonClient.attachQueue.
  React.useEffect(() => {
    if (!effectiveSessionId || isLoading) return
    const pending = useAppStore.getState().pendingStreamPrompt
    if (pending && pending.sessionId === effectiveSessionId) return
    let cancelled = false
    void ipcClient.fileChanges
      .get(effectiveSessionId)
      .then((snapshot) => {
        if (cancelled || !snapshot) return
        const existing =
          useAppStore.getState().sessionFileChangesBySession[effectiveSessionId]
        if (snapshot.files.length > 0 || !existing) {
          setSessionFileChanges(effectiveSessionId, snapshot)
        }
      })
      .catch(() => {
        // Gracefully ignore when daemon does not support file_changes
      })
    return () => {
      cancelled = true
    }
  }, [effectiveSessionId, isLoading, setSessionFileChanges])

  // Hydrate persisted session todos after history settles, without overwriting fresher live updates
  React.useEffect(() => {
    if (!effectiveSessionId || isLoading) return
    const pending = useAppStore.getState().pendingStreamPrompt
    if (pending && pending.sessionId === effectiveSessionId) return
    let cancelled = false
    const todosBefore =
      useAppStore.getState().sessionTodosBySession[effectiveSessionId]
    void ipcClient.todos
      .get(effectiveSessionId)
      .then((todos) => {
        if (cancelled || !Array.isArray(todos)) return
        const currentTodos =
          useAppStore.getState().sessionTodosBySession[effectiveSessionId]
        if (currentTodos !== todosBefore) return
        if (todos.length > 0 || !currentTodos) {
          setSessionTodos(effectiveSessionId, todos)
        }
      })
      .catch(() => {
        // Gracefully ignore when daemon does not support todo_state
      })
    return () => {
      cancelled = true
    }
  }, [effectiveSessionId, isLoading, setSessionTodos])

  React.useEffect(() => {
    if (isLiveTraceControllerMounted()) return
    setIsStreamActive(isStreaming)
  }, [isStreaming, setIsStreamActive])

  // Standalone harness fallback when <ChatStream /> is mounted without <App /> / <LiveTraceController />
  React.useEffect(() => {
    if (isLiveTraceControllerMounted()) return
    const unsubscribe = ipcClient.harness.onEvent((frame) => {
      const frameSession =
        typeof frame.session_id === "string" ? frame.session_id : null
      if (frameSession && frameSession !== effectiveSessionId) return
      const todoUpdate = extractTodosFromHarnessFrame(frame, effectiveSessionId)
      if (todoUpdate) {
        setSessionTodos(todoUpdate.sessionId, todoUpdate.todos)
        return
      }
      processHarnessFrame(frame, queryClient, effectiveSessionId)
    })
    return () => {
      unsubscribe()
      if (!isLiveTraceControllerMounted() && effectiveSessionId) {
        clearSessionLiveTurn(effectiveSessionId)
      }
    }
  }, [effectiveSessionId, queryClient, setSessionTodos])

  React.useEffect(() => {
    if (isLiveTraceControllerMounted()) return
    if (!pendingStreamPrompt) return
    if (pendingStreamPrompt.sessionId !== effectiveSessionId) return
    setPendingStreamPrompt(null)
    dispatchPendingStreamPrompt(pendingStreamPrompt, queryClient)
  }, [
    effectiveSessionId,
    pendingStreamPrompt,
    queryClient,
    setPendingStreamPrompt,
  ])

  const handlePermissionDecision = React.useCallback(
    async (decision: "allow" | "allow_always" | "deny") => {
      if (!pendingPermission) return
      const req = pendingPermission
      clearPendingPermission(req.sessionId, req.requestId)

      try {
        await ipcClient.trace.respondToPermission(
          req.sessionId,
          req.requestId,
          decision
        )
        if (
          decision !== "deny" &&
          /powerpoint|presentation|slide/i.test(
            `${req.toolName} ${req.description}`
          )
        ) {
          useAppStore.getState().openDocPreview("slide", "Slide")
        }
        toast(
          decision === "deny"
            ? `Denied ${req.toolName}`
            : `Approved ${req.toolName}`
        )
      } catch {
        toast.error("Failed to send permission decision to daemon")
      }
    },
    [clearPendingPermission, pendingPermission]
  )

  const handleSubmitQuestionAnswers = React.useCallback(
    async (
      answers: Record<string, { selected?: number[]; custom?: string[] }>
    ) => {
      if (!pendingQuestion) return
      const req = pendingQuestion
      try {
        await ipcClient.harness.respondToQuestion(
          req.sessionId,
          req.requestId,
          { kind: "answered", answers }
        )
        clearPendingQuestion(req.sessionId, req.requestId)
      } catch {
        toast.error("Failed to send question response to daemon")
      }
    },
    [clearPendingQuestion, pendingQuestion]
  )

  const handleDeclineQuestion = React.useCallback(async () => {
    if (!pendingQuestion) return
    const req = pendingQuestion
    try {
      await ipcClient.harness.respondToQuestion(
        req.sessionId,
        req.requestId,
        { kind: "declined" }
      )
      clearPendingQuestion(req.sessionId, req.requestId)
    } catch {
      toast.error("Failed to dismiss question in daemon")
    }
  }, [clearPendingQuestion, pendingQuestion])

  React.useEffect(() => {
    if (!effectiveSessionId || !liveTurn?.isLive) return
    if (daemonSessionStatus?.status === "running") return
    const lastEv = lastEventAtMs ?? 0
    const hasFreshDaemonIdle =
      daemonSessionStatus?.status === "idle" &&
      daemonSessionStatus.updatedAtMs >= lastEv
    const hasFreshQueryIdle =
      !daemonSessionStatus &&
      activeSessionStatus?.trim().toLowerCase() === "idle" &&
      sessionsQuery.dataUpdatedAt > lastEv
    if (!hasFreshDaemonIdle && !hasFreshQueryIdle) return

    const observedStatus = daemonSessionStatus?.status ?? activeSessionStatus
    const checkAndClear = () => {
      if (
        shouldClearStaleLiveTurn({
          liveTurn: toReconcilableTurn(liveTurn),
          sessionStatus: observedStatus,
          lastEventAtMs,
        })
      ) {
        clearSessionLiveTurn(effectiveSessionId)
        void queryClient.invalidateQueries({
          queryKey: traceKeys.turns(effectiveSessionId),
        })
      }
    }
    const graceMs = 2_500
    const elapsed = Date.now() - lastEv
    if (elapsed >= graceMs) {
      checkAndClear()
      return
    }
    const timer = window.setTimeout(
      checkAndClear,
      Math.max(50, graceMs - elapsed)
    )
    return () => window.clearTimeout(timer)
  }, [
    activeSessionStatus,
    daemonSessionStatus,
    effectiveSessionId,
    lastEventAtMs,
    liveTurn,
    queryClient,
    sessionsQuery.dataUpdatedAt,
  ])

  const allTurns = React.useMemo(() => {
    const baseTurns = controlledTurns ?? fetchedTurns ?? []
    const activeLiveTurn: ExecutionTurn | null =
      liveTurn && liveTurn.sessionId === effectiveSessionId
        ? liveTurn
        : pendingStreamPrompt &&
            pendingStreamPrompt.sessionId === effectiveSessionId
          ? {
              id: `optimistic_turn_${effectiveSessionId}`,
              sessionId: effectiveSessionId,
              userPrompt: pendingStreamPrompt.prompt,
              userImages: pendingStreamPrompt.images,
              workedDuration: "1s",
              isLive: true,
              notes: [],
              groups: [],
              timeline: [],
              activeToolStatus: null,
              answerIntro: "",
              answerBullets: [],
              diffCard: {
                id: "diff_optimistic",
                file: "",
                additions: 0,
                deletions: 0,
                hint: "",
                lines: [],
              },
              timestamp: "Just now",
              credits: "0.00 cr",
              kvCachePct: 0,
              pinned: false,
            }
          : null

    const sessionCompletedTurns =
      controlledTurns === undefined ? (completedLiveTurns ?? []) : []

    let effectiveLiveTurn = activeLiveTurn
    let effectiveBaseCount =
      liveTurn && liveTurn.sessionId === effectiveSessionId
        ? baseHistoryTurnCount
        : baseTurns.length

    if (
      effectiveLiveTurn &&
      !effectiveLiveTurn.userPrompt.trim() &&
      baseTurns.length > 0
    ) {
      const trailing = baseTurns[baseTurns.length - 1]
      const trailingHasUserInput =
        trailing &&
        (trailing.userPrompt.trim().length > 0 ||
          (trailing.userImages?.length ?? 0) > 0)
      const trailingHasAssistantOrWork = Boolean(
        trailing &&
          (trailing.answerIntro.trim().length > 0 ||
            trailing.answerBullets.length > 0 ||
            trailing.groups.length > 0 ||
            trailing.notes.length > 0 ||
            (trailing.timeline?.length ?? 0) > 0 ||
            trailing.diffCard.lines.length > 0 ||
            trailing.outputArtifact)
      )
      if (trailing && trailingHasUserInput && !trailingHasAssistantOrWork) {
        effectiveLiveTurn = {
          ...effectiveLiveTurn,
          userPrompt: trailing.userPrompt,
          ...(effectiveLiveTurn.userImages &&
          effectiveLiveTurn.userImages.length > 0
            ? {}
            : trailing.userImages && trailing.userImages.length > 0
              ? { userImages: trailing.userImages }
              : {}),
          userRefFiles:
            effectiveLiveTurn.userRefFiles ?? trailing.userRefFiles,
        }
        effectiveBaseCount = baseTurns.length - 1
      }
    }

    return reconcileChatTurns({
      historyTurns: baseTurns.map(toReconcilableTurn),
      liveTurn: effectiveLiveTurn ? toReconcilableTurn(effectiveLiveTurn) : null,
      completedLiveTurns: sessionCompletedTurns.map(toReconcilableTurn),
      baseHistoryTurnCount: effectiveBaseCount,
    })
  }, [
    baseHistoryTurnCount,
    completedLiveTurns,
    controlledTurns,
    fetchedTurns,
    effectiveSessionId,
    liveTurn,
    pendingStreamPrompt,
  ])

  React.useEffect(() => {
    if (typeof bottomAnchorRef.current?.scrollIntoView === "function") {
      bottomAnchorRef.current.scrollIntoView({ block: "end" })
    }
  }, [allTurns.length, liveTurn?.answerIntro.length])

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
    },
    [effectiveSessionId, queryClient]
  )

  const latestFinishedTurnIdx = React.useMemo(() => {
    for (let i = allTurns.length - 1; i >= 0; i -= 1) {
      if (!allTurns[i]?.isLive) return i
    }
    return -1
  }, [allTurns])

  const bottomComposer = composerSlot ?? children

  return (
    <div
      ref={ref}
      data-slot="chat-stream"
      className={cn("@container/chat flex min-h-0 min-w-0 flex-1 flex-col", className)}
    >
      {isStreaming && (
        <div
          role="presentation"
          aria-hidden="true"
          className="h-[1.5px] shrink-0 animate-pulse bg-brand"
        />
      )}

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div
          data-slot="stream-container"
          className="mx-auto flex w-full max-w-[780px] min-w-0 flex-col gap-6 px-3.5 pt-5 pb-10 @min-[520px]/chat:px-6"
        >
          {controlledTurns === undefined &&
          isLoading &&
          allTurns.length === 0 ? (
            <ChatSkeleton />
          ) : (
            <>
              {allTurns.map((turn, idx) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  fileChangesSnapshot={
                    !isStreaming && idx === latestFinishedTurnIdx
                      ? sessionFileChanges
                      : null
                  }
                  onForked={handleForked}
                  onPinToggled={handlePinToggled}
                />
              ))}
              {!isStreaming &&
                latestFinishedTurnIdx === -1 &&
                sessionFileChanges &&
                sessionFileChanges.files.length > 0 && (
                  <TurnFileSummaryCard
                    sessionId={effectiveSessionId}
                    snapshot={sessionFileChanges}
                  />
                )}
            </>
          )}
          <div ref={bottomAnchorRef} />
        </div>
      </ScrollArea>

      {isStreaming ? (
        <div className="pointer-events-none relative -mt-8 mb-2 flex justify-center">
          <button
            type="button"
            aria-label="Scroll to latest output"
            onClick={() => {
              if (typeof bottomAnchorRef.current?.scrollIntoView === "function") {
                bottomAnchorRef.current.scrollIntoView({
                  behavior: "smooth",
                  block: "end",
                })
              }
            }}
            className="pointer-events-auto grid size-8 cursor-pointer place-items-center rounded-full border border-hairline-hi bg-popover-solid/95 text-body shadow-rayu-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {pendingQuestion &&
        (!pendingQuestion.sessionId ||
          pendingQuestion.sessionId === effectiveSessionId) && (
          <LiveQuestionPromptCard
            key={pendingQuestion.requestId}
            pendingQuestion={pendingQuestion}
            onSubmitAnswers={handleSubmitQuestionAnswers}
            onDecline={handleDeclineQuestion}
          />
        )}

      {pendingPermission &&
        (!pendingPermission.sessionId ||
          pendingPermission.sessionId === effectiveSessionId) && (
          <div
            data-testid="live-permission-banner"
            className="mx-auto mb-3 w-full max-w-[732px] px-6"
          >
            <div className="rayu-card-bevel flex flex-col gap-3.5 rounded-[18px] border border-premium-hi bg-popover-solid p-4 shadow-rayu-2">
              <div className="flex items-center gap-2.5">
                {/computer|powerpoint|excel|mac|presentation/i.test(
                  `${pendingPermission.toolName} ${pendingPermission.description}`
                ) ? (
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-[6px]"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(96, 165, 250, 0.32), rgba(192, 132, 252, 0.32))",
                      color: "rgb(191, 219, 254)",
                    }}
                  >
                    <Laptop className="size-3.5" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-inset text-muted-ink">
                    <Terminal className="size-3.5" aria-hidden="true" />
                  </span>
                )}
                <span className="text-[13px] font-medium text-muted-ink">
                  {/computer|powerpoint|excel|mac|presentation/i.test(
                    `${pendingPermission.toolName} ${pendingPermission.description}`
                  )
                    ? "Computer Use"
                    : pendingPermission.toolName}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-[15px] leading-snug font-medium text-ink">
                  {pendingPermission.description.trim().endsWith("?")
                    ? pendingPermission.description
                    : `Allow RayuCode to run ${pendingPermission.toolName}?`}
                </div>
                {!pendingPermission.description.trim().endsWith("?") && (
                  <div className="truncate font-mono text-xs text-muted-ink">
                    {pendingPermission.description}
                  </div>
                )}
              </div>

              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  data-testid="permission-always-allow-btn"
                  onClick={() => {
                    void handlePermissionDecision("allow_always")
                  }}
                  className="cursor-pointer rounded-full border border-hairline-hi bg-inset px-4 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-hover"
                >
                  Always allow
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="permission-deny-btn"
                    onClick={() => {
                      void handlePermissionDecision("deny")
                    }}
                    className="cursor-pointer rounded-full border border-hairline-hi bg-inset px-4 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-hover"
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    data-testid="permission-allow-conversation-btn"
                    onClick={() => {
                      void handlePermissionDecision("allow")
                    }}
                    className="cursor-pointer rounded-full bg-ink px-4 py-1.5 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90"
                  >
                    Allow this conversation
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {sessionTodos.length > 0 && (
        <div
          data-slot="chat-stream-tasks-slot"
          className="mx-auto w-full max-w-[780px] shrink-0 px-6 pb-2"
        >
          <TaskChecklistCard
            sessionId={effectiveSessionId}
            todos={sessionTodos}
          />
        </div>
      )}

      {midTurnMessages.length > 0 && (
        <div
          data-testid="soft-interrupt-queue-strip"
          className="mx-auto mb-1.5 flex w-full max-w-[732px] min-w-0 shrink-0 flex-col gap-1 px-3 @min-[480px]/chat:px-6"
        >
          {isQueuePaused &&
            !isStreaming &&
            midTurnMessages.some((item) => item.mode === "queue") && (
              <div className="truncate px-1 text-[11px] text-muted-ink">
                Queue paused after stop — send or edit queued items below
              </div>
            )}
          {(() => {
            let queueIndex = 0
            return midTurnMessages.map((item) => {
              const isSteer = item.mode === "steer"
              if (!isSteer) {
                queueIndex += 1
              }
              const currentQueueRank = queueIndex
              return (
                <div
                  key={item.id}
                  data-testid={`midturn-item-${item.id}`}
                  data-midturn-mode={item.mode}
                  className="flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-hairline bg-pane px-2.5 py-1.5 text-xs text-body"
                >
                  {isSteer ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand"
                      />
                      <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-text">
                        Steer
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-muted-ink @min-[420px]/chat:inline">
                        Auto-sending
                      </span>
                    </>
                  ) : (
                    <span className="shrink-0 rounded border border-hairline bg-inset px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-ink tabular-nums">
                      Queued #{currentQueueRank}
                    </span>
                  )}

                  <span className="min-w-0 flex-1 truncate text-ink">
                    {item.text}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    {!isSteer && isStreaming && (
                      <button
                        type="button"
                        data-testid={`promote-to-steer-${item.id}`}
                        title="Send as steer now without interrupting"
                        onClick={() => {
                          void promoteQueuedMessageToSteer(
                            effectiveSessionId,
                            item.id
                          )
                        }}
                        className="cursor-pointer rounded-md border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-text transition-colors hover:border-brand/50"
                      >
                        Steer
                      </button>
                    )}

                    {!isSteer && !isStreaming && (
                      <button
                        type="button"
                        data-testid={`send-queued-now-${item.id}`}
                        title="Send queued message now"
                        onClick={() =>
                          sendQueuedMessageNow(
                            effectiveSessionId,
                            item.id,
                            queryClient
                          )
                        }
                        className="cursor-pointer rounded-md border border-premium bg-active px-1.5 py-0.5 text-[11px] font-medium text-ink transition-colors hover:border-brand hover:text-brand-text"
                      >
                        Send
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid={`edit-midturn-${item.id}`}
                      aria-label={
                        isSteer ? "Edit steer message" : "Edit queued message"
                      }
                      title="Edit in composer"
                      onClick={() =>
                        editMidTurnMessage(effectiveSessionId, item.id)
                      }
                      className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                    >
                      <Pencil className="size-3" aria-hidden="true" />
                      <span className="hidden @min-[460px]/chat:inline">
                        Edit
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid={`cancel-midturn-${item.id}`}
                      aria-label={
                        isSteer
                          ? "Cancel queued soft interrupt"
                          : "Remove queued message"
                      }
                      onClick={() => {
                        void cancelMidTurnMessage(effectiveSessionId, item.id)
                      }}
                      className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )
            })
          })()}
        </div>
      )}

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
