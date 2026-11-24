import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  ChevronDown,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Laptop,
  List,
  Presentation,
  Terminal,
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
import { changesQueryKeys } from "@/features/changes"
import { useAppStore } from "@/lib/app-store"
import {
  createHarnessStreamTracker,
  mapHarnessFrameToLiveEvents,
} from "@/lib/harness-adapter"
import {
  ipcClient,
  type CloudChatMessage,
} from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { traceKeys, traceTurnsQueryOptions } from "../api/trace-api"
import { useLiveTrace } from "../hooks/use-live-trace"
import type {
  ExecutionTurn,
  FileChangesSnapshot,
  LiveTraceEvent,
  SessionSummary,
} from "../types"
import { CiteLink, EditorialMarkdown } from "./cite-link"
import { InlineDiffCard } from "./inline-diff-card"
import { TurnActions } from "./turn-actions"
import { TurnFileSummaryCard } from "./turn-file-summary-card"
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
  const effectiveSessionId =
    sessionIdProp ??
    storeSessionId ??
    (import.meta.env.MODE === "test" ? "ses_retire_cache" : "")

  const queryClient = useQueryClient()
  const { data: fetchedTurns, isLoading } = useQuery({
    ...traceTurnsQueryOptions(effectiveSessionId),
    enabled: controlledTurns === undefined && effectiveSessionId.length > 0,
  })

  const [completedSimulatedTurns, setCompletedSimulatedTurns] = React.useState<
    ExecutionTurn[]
  >([])
  const bottomAnchorRef = React.useRef<HTMLDivElement | null>(null)

  const {
    liveTurn,
    isStreaming,
    startLiveTurn,
    pushEvent,
    resetLiveTurn,
  } = useLiveTrace({
    onComplete: (completedTurn) => {
      ipcClient.trace.recordTurn(completedTurn)
      queryClient.setQueryData<ExecutionTurn[]>(
        traceKeys.turns(effectiveSessionId),
        (prev) => (prev ? [...prev, completedTurn] : [completedTurn])
      )
      resetLiveTurn()
    },
  })

  const pendingPermission = useAppStore((s) => s.pendingPermission)
  const setPendingPermission = useAppStore((s) => s.setPendingPermission)
  const pendingStreamPrompt = useAppStore((s) => s.pendingStreamPrompt)
  const setPendingStreamPrompt = useAppStore((s) => s.setPendingStreamPrompt)
  const setIsStreamActive = useAppStore((s) => s.setIsStreamActive)
  const sessionFileChanges = useAppStore((s) =>
    effectiveSessionId ? s.sessionFileChangesBySession[effectiveSessionId] : undefined
  )
  const setSessionFileChanges = useAppStore((s) => s.setSessionFileChanges)
  const daemonMode = useAppStore((s) => s.daemonMode)
  const authState = useAppStore((s) => s.authState)
  const activeLiveTurnRef = React.useRef(false)
  const turnsForHistoryRef = React.useRef<ExecutionTurn[]>([])

  // Hydrate persisted/session file changes when opening or switching sessions
  React.useEffect(() => {
    if (!effectiveSessionId) return
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
  }, [effectiveSessionId, setSessionFileChanges])

  React.useEffect(() => {
    setIsStreamActive(isStreaming)
  }, [isStreaming, setIsStreamActive])

  React.useEffect(() => {
    return () => {
      useAppStore.getState().setIsStreamActive(false)
    }
  }, [])

  // Stream live RayuCode harness frames directly into the rAF-batched trace
  React.useEffect(() => {
    const tracker = createHarnessStreamTracker()

    const unsubscribe = ipcClient.harness.onEvent((frame) => {
      const frameSession =
        typeof frame.session_id === "string" ? frame.session_id : null
      if (frameSession && frameSession !== effectiveSessionId) return

      const mapped = mapHarnessFrameToLiveEvents(frame, tracker)
      if (mapped.length === 0) return

      const traceEvents: LiveTraceEvent[] = []
      for (const ev of mapped) {
        if (ev.type === "permission-request") {
          setPendingPermission({
            sessionId: ev.sessionId || effectiveSessionId,
            requestId: ev.requestId,
            toolName: ev.toolName,
            description: ev.description,
          })
        } else if (ev.type === "file-changes") {
          const targetSessionId = ev.snapshot.session_id || effectiveSessionId
          if (targetSessionId) {
            setSessionFileChanges(targetSessionId, ev.snapshot)
            void queryClient.invalidateQueries({
              queryKey: changesQueryKeys.state(),
            })
            void queryClient.invalidateQueries({
              queryKey: ["inspector", "changes"],
            })
          }
        } else {
          traceEvents.push(ev)
        }
      }

      if (traceEvents.length === 0) return

      if (!activeLiveTurnRef.current) {
        activeLiveTurnRef.current = true
        startLiveTurn({
          sessionId: effectiveSessionId,
          userPrompt: "Live daemon turn",
        })
      }

      for (const ev of traceEvents) {
        pushEvent(ev)
        if (ev.type === "complete") {
          activeLiveTurnRef.current = false
          setPendingPermission(null)
        }
      }
    })

    return unsubscribe
  }, [
    effectiveSessionId,
    pushEvent,
    queryClient,
    setPendingPermission,
    setSessionFileChanges,
    startLiveTurn,
  ])

  // Dispatch queued prompt AFTER ChatStream mounts its live event listener (0 dropped tokens)
  React.useEffect(() => {
    if (!pendingStreamPrompt) return
    if (pendingStreamPrompt.sessionId !== effectiveSessionId) return

    const promptToSend = pendingStreamPrompt
    setPendingStreamPrompt(null)

    const isLiveDaemon =
      !effectiveSessionId.startsWith("ses_") &&
      (daemonMode === "live" ||
        (typeof window !== "undefined" &&
          Boolean(window.rayu?.harness?.sendMessage)))
    const isCloudLive = Boolean(
      authState?.signedIn &&
        typeof window !== "undefined" &&
        (window.rayu?.cloud?.streamChat ||
          (import.meta.env.DEV && import.meta.env.MODE !== "test"))
    )

    if (isLiveDaemon || isCloudLive) {
      const history: CloudChatMessage[] = []
      for (const t of turnsForHistoryRef.current) {
        if (t.userPrompt.trim()) {
          history.push({ role: "user", content: t.userPrompt })
        }
        if (t.answerIntro.trim()) {
          history.push({ role: "assistant", content: t.answerIntro })
        }
      }

      activeLiveTurnRef.current = true
      startLiveTurn({
        sessionId: effectiveSessionId,
        userPrompt: promptToSend.prompt,
        userImages: promptToSend.images,
      })
      void ipcClient.trace
        .sendPrompt({
          sessionId: effectiveSessionId,
          prompt: promptToSend.prompt,
          images: promptToSend.images,
          modelId: promptToSend.modelId,
          modelLabel: promptToSend.modelLabel,
          history,
        })
        .catch((error: unknown) => {
          activeLiveTurnRef.current = false
          resetLiveTurn()
          const msg =
            error instanceof Error
              ? error.message
              : "Failed to stream response from Rayu Cloud"
          toast.error(msg)
        })
      return
    }

    void ipcClient.trace
      .sendPrompt({
        sessionId: effectiveSessionId,
        prompt: promptToSend.prompt,
        images: promptToSend.images,
        modelId: promptToSend.modelId,
        modelLabel: promptToSend.modelLabel,
      })
      .then((turn) => {
        queryClient.setQueryData<ExecutionTurn[]>(
          traceKeys.turns(effectiveSessionId),
          (prev) => (prev ? [...prev, turn] : [turn])
        )
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to send prompt"
        )
      })
  }, [
    authState?.signedIn,
    daemonMode,
    effectiveSessionId,
    pendingStreamPrompt,
    queryClient,
    resetLiveTurn,
    setPendingStreamPrompt,
    startLiveTurn,
  ])

  const handlePermissionDecision = React.useCallback(
    async (decision: "allow" | "allow_always" | "deny") => {
      if (!pendingPermission) return
      const req = pendingPermission
      setPendingPermission(null)

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
    [pendingPermission, setPendingPermission]
  )

  const allTurns = React.useMemo(() => {
    const baseTurns = controlledTurns ?? fetchedTurns ?? []
    const sessionCompleted = completedSimulatedTurns.filter(
      (t) => t.sessionId === effectiveSessionId
    )
    const merged = [...baseTurns, ...sessionCompleted]
    if (liveTurn && liveTurn.sessionId === effectiveSessionId) {
      merged.push(liveTurn)
    } else if (
      pendingStreamPrompt &&
      pendingStreamPrompt.sessionId === effectiveSessionId
    ) {
      merged.push({
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
      })
    }
    return merged
  }, [
    controlledTurns,
    fetchedTurns,
    completedSimulatedTurns,
    effectiveSessionId,
    liveTurn,
    pendingStreamPrompt,
  ])

  React.useEffect(() => {
    turnsForHistoryRef.current = allTurns.filter((t) => !t.isLive)
  }, [allTurns])

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
      setCompletedSimulatedTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, pinned } : t))
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
                    idx === latestFinishedTurnIdx ? sessionFileChanges : null
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
