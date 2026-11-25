import * as React from "react"
import { reconcileChatTurns } from "@rayu-dev/rayucode-session-core/client"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { create } from "zustand"

import { changesQueryKeys } from "@/features/changes"
import { useAppStore, type PendingStreamPrompt } from "@/lib/app-store"
import {
  createHarnessStreamTracker,
  formatDurationSeconds,
  mapHarnessFrameToLiveEvents,
  type HarnessStreamTracker,
} from "@/lib/harness-adapter"
import { ipcClient, type CloudChatMessage } from "@/lib/ipc-client"
import { createStreamBatcher, type StreamBatcher } from "@/lib/stream-batcher"

import { traceKeys } from "../api/trace-api"
import type { ExecutionTurn, LiveTraceEvent } from "../types"
import {
  applyTraceEvents,
  EMPTY_DIFF_CARD,
  type StartLiveTurnInput,
} from "./use-live-trace"

const FRAME_BATCH_WINDOW_MS = 16

export type ReconcilableExecutionTurn = ExecutionTurn & {
  answerMarkdown: string
  workGroups: ExecutionTurn["groups"]
}

export function toReconcilableTurn(
  turn: ExecutionTurn
): ReconcilableExecutionTurn {
  return {
    ...turn,
    answerMarkdown:
      turn.answerIntro.trim() ||
      (turn.answerBullets.length > 0 ? turn.answerBullets[0]!.body : ""),
    workGroups: turn.groups,
  }
}

interface LiveTraceStoreState {
  liveTurnsBySession: Record<string, ExecutionTurn>
  completedLiveTurnsBySession: Record<string, ExecutionTurn[]>
  baseHistoryTurnCountBySession: Record<string, number>
  lastEventAtMsBySession: Record<string, number>
}

export const useLiveTraceStore = create<LiveTraceStoreState>(() => ({
  liveTurnsBySession: {},
  completedLiveTurnsBySession: {},
  baseHistoryTurnCountBySession: {},
  lastEventAtMsBySession: {},
}))

const trackersBySession = new Map<string, HarnessStreamTracker>()
const batchersBySession = new Map<string, StreamBatcher<LiveTraceEvent>>()
const startedAtBySession = new Map<string, number>()
const completedTurnIds = new Set<string>()
let turnSequence = 1
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let controllerMountCount = 0

export function isLiveTraceControllerMounted(): boolean {
  return controllerMountCount > 0
}

function stopElapsedTimerIfIdle(): void {
  if (!elapsedTimer) return
  const hasLive = Object.values(
    useLiveTraceStore.getState().liveTurnsBySession
  ).some((turn) => turn.isLive)
  if (!hasLive) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

function ensureElapsedTimer(): void {
  if (elapsedTimer) return
  elapsedTimer = setInterval(() => {
    const state = useLiveTraceStore.getState()
    const entries = Object.entries(state.liveTurnsBySession)
    if (entries.length === 0) {
      stopElapsedTimerIfIdle()
      return
    }
    let changed = false
    const nextMap: Record<string, ExecutionTurn> = {
      ...state.liveTurnsBySession,
    }
    for (const [sid, turn] of entries) {
      if (!turn.isLive) continue
      const startedAt = startedAtBySession.get(sid) ?? Date.now()
      const nextSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000))
      const formatted = formatDurationSeconds(nextSec)
      if (turn.workedDuration !== formatted) {
        nextMap[sid] = { ...turn, workedDuration: formatted }
        changed = true
      }
    }
    if (changed) {
      useLiveTraceStore.setState({ liveTurnsBySession: nextMap })
    }
    stopElapsedTimerIfIdle()
  }, 1000)
}

function getOrCreateTracker(sessionId: string): HarnessStreamTracker {
  let tracker = trackersBySession.get(sessionId)
  if (!tracker) {
    tracker = createHarnessStreamTracker()
    trackersBySession.set(sessionId, tracker)
  }
  return tracker
}

function prepareTrackerForPrompt(
  sessionId: string,
  startedAtMs: number
): HarnessStreamTracker {
  const tracker = getOrCreateTracker(sessionId)
  tracker.startedAtMs = startedAtMs
  tracker.turnActive = true
  tracker.turnCompleted = false
  tracker.hasStreamedTextInPhase = false
  tracker.batchEpoch = 1
  tracker.phaseHasReads = false
  tracker.phaseHasCommands = false
  tracker.phaseHasSearches = false
  tracker.phaseCommandCount = 0
  tracker.toolInputs.clear()
  return tracker
}

export function startSessionLiveTurn(input: StartLiveTurnInput): ExecutionTurn {
  const startedAt =
    typeof input.startedAtMs === "number" && input.startedAtMs > 0
      ? input.startedAtMs
      : Date.now()
  startedAtBySession.set(input.sessionId, startedAt)
  const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000))
  const turn: ExecutionTurn = {
    id: `live_turn_${Date.now()}_${turnSequence++}`,
    sessionId: input.sessionId,
    userRefFiles: input.userRefFiles,
    userPrompt: input.userPrompt,
    userImages: input.userImages,
    workedDuration: formatDurationSeconds(elapsedSec),
    isLive: true,
    notes: input.initialNote ? [input.initialNote] : [],
    groups: [],
    timeline: input.initialNote
      ? [{ type: "note", id: "note_0", text: input.initialNote }]
      : [],
    activeToolStatus: null,
    answerIntro: "",
    answerBullets: [],
    diffCard: EMPTY_DIFF_CARD,
    timestamp: "Just now",
    credits: "0.08 cr",
    kvCachePct: 94,
    pinned: false,
  }
  useLiveTraceStore.setState((state) => ({
    liveTurnsBySession: {
      ...state.liveTurnsBySession,
      [input.sessionId]: turn,
    },
    baseHistoryTurnCountBySession: {
      ...state.baseHistoryTurnCountBySession,
      [input.sessionId]:
        typeof input.baseHistoryTurnCount === "number" &&
        input.baseHistoryTurnCount >= 0
          ? input.baseHistoryTurnCount
          : (state.baseHistoryTurnCountBySession[input.sessionId] ?? 0),
    },
    lastEventAtMsBySession: {
      ...state.lastEventAtMsBySession,
      [input.sessionId]: startedAt,
    },
  }))
  ensureElapsedTimer()
  return turn
}

export function clearSessionLiveTurn(sessionId: string): void {
  if (!sessionId) return
  const batcher = batchersBySession.get(sessionId)
  if (batcher) {
    batcher.dispose()
    batchersBySession.delete(sessionId)
  }
  startedAtBySession.delete(sessionId)
  trackersBySession.delete(sessionId)
  useLiveTraceStore.setState((state) => {
    const hasLive = sessionId in state.liveTurnsBySession
    const hasBase = sessionId in state.baseHistoryTurnCountBySession
    const hasEvent = sessionId in state.lastEventAtMsBySession
    if (!hasLive && !hasBase && !hasEvent) return state
    const nextLive = { ...state.liveTurnsBySession }
    const nextBase = { ...state.baseHistoryTurnCountBySession }
    const nextLastEvent = { ...state.lastEventAtMsBySession }
    delete nextLive[sessionId]
    delete nextBase[sessionId]
    delete nextLastEvent[sessionId]
    return {
      liveTurnsBySession: nextLive,
      baseHistoryTurnCountBySession: nextBase,
      lastEventAtMsBySession: nextLastEvent,
    }
  })
  stopElapsedTimerIfIdle()
}

export function resetAllLiveTraces(): void {
  for (const batcher of batchersBySession.values()) {
    batcher.dispose()
  }
  batchersBySession.clear()
  trackersBySession.clear()
  startedAtBySession.clear()
  completedTurnIds.clear()
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
  useLiveTraceStore.setState({
    liveTurnsBySession: {},
    completedLiveTurnsBySession: {},
    baseHistoryTurnCountBySession: {},
    lastEventAtMsBySession: {},
  })
}

function getOrCreateBatcher(
  sessionId: string,
  queryClient: QueryClient
): StreamBatcher<LiveTraceEvent> {
  const existing = batchersBySession.get(sessionId)
  if (existing) return existing

  const batcher = createStreamBatcher<LiveTraceEvent>((events) => {
    const storeState = useLiveTraceStore.getState()
    const current = storeState.liveTurnsBySession[sessionId] ?? null
    const updated = applyTraceEvents(current, events)
    if (!updated) return

    const hasComplete = events.some((ev) => ev.type === "complete")
    if (hasComplete) {
      const baseHistoryCount =
        storeState.baseHistoryTurnCountBySession[sessionId]
      if (!completedTurnIds.has(updated.id)) {
        completedTurnIds.add(updated.id)
        ipcClient.trace.recordTurn(updated)
        useLiveTraceStore.setState((state) => {
          const prevCompleted = state.completedLiveTurnsBySession[sessionId] ?? []
          const nextCompleted = [
            ...prevCompleted.filter((t) => t.id !== updated.id),
            updated,
          ].slice(-5)
          return {
            completedLiveTurnsBySession: {
              ...state.completedLiveTurnsBySession,
              [sessionId]: nextCompleted,
            },
          }
        })
        queryClient.setQueryData<ExecutionTurn[]>(
          traceKeys.turns(sessionId),
          (prev) => {
            const history = prev ?? []
            return reconcileChatTurns({
              historyTurns: history.map(toReconcilableTurn),
              liveTurn: toReconcilableTurn(updated),
              baseHistoryTurnCount: baseHistoryCount,
            })
          }
        )
        void queryClient.invalidateQueries({ queryKey: ["sessions"] })
        void queryClient.invalidateQueries({
          queryKey: traceKeys.turns(sessionId),
        })
      }
      const perm = useAppStore.getState().pendingPermission
      if (perm && (!perm.sessionId || perm.sessionId === sessionId)) {
        useAppStore.getState().setPendingPermission(null)
      }
      clearSessionLiveTurn(sessionId)
      return
    }

    useLiveTraceStore.setState((state) => ({
      liveTurnsBySession: {
        ...state.liveTurnsBySession,
        [sessionId]: updated,
      },
    }))
  }, FRAME_BATCH_WINDOW_MS)

  batchersBySession.set(sessionId, batcher)
  return batcher
}

export function processHarnessFrame(
  frame: Record<string, unknown>,
  queryClient: QueryClient,
  fallbackSessionId?: string
): void {
  const frameSession =
    typeof frame.session_id === "string" ? frame.session_id : ""
  const targetSessionId = frameSession || fallbackSessionId || ""
  if (!targetSessionId) return

  const nowMs = Date.now()
  useLiveTraceStore.setState((state) => ({
    lastEventAtMsBySession: {
      ...state.lastEventAtMsBySession,
      [targetSessionId]: nowMs,
    },
  }))

  const evName = typeof frame.ev === "string" ? frame.ev : ""
  const isTerminalFrame =
    evName === "turn_done" || evName === "turn_stopped" || evName === "error"

  const tracker = getOrCreateTracker(targetSessionId)
  const mapped = mapHarnessFrameToLiveEvents(frame, tracker)
  if (mapped.length === 0) {
    if (isTerminalFrame) {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] })
      void queryClient.invalidateQueries({
        queryKey: traceKeys.turns(targetSessionId),
      })
    }
    return
  }

  const store = useAppStore.getState()
  const traceEvents: LiveTraceEvent[] = []
  for (const ev of mapped) {
    if (ev.type === "permission-request") {
      store.setPendingPermission({
        sessionId: ev.sessionId || targetSessionId,
        requestId: ev.requestId,
        toolName: ev.toolName,
        description: ev.description,
      })
    } else if (ev.type === "file-changes") {
      const changesSid = ev.snapshot.session_id || targetSessionId
      if (changesSid) {
        store.setSessionFileChanges(changesSid, ev.snapshot)
        void queryClient.invalidateQueries({
          queryKey: changesQueryKeys.state(),
        })
        void queryClient.invalidateQueries({
          queryKey: ["inspector", "changes"],
        })
      }
    } else if (
      ev.type === "text-done" ||
      ev.type === "model-info" ||
      ev.type === "permission-mode-changed" ||
      ev.type === "config-changed"
    ) {
      // Handled at session/app level rather than live trace step reducer
    } else {
      traceEvents.push(ev)
    }
  }

  if (traceEvents.length === 0) {
    if (isTerminalFrame) {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] })
      void queryClient.invalidateQueries({
        queryKey: traceKeys.turns(targetSessionId),
      })
    }
    return
  }

  if (!useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]) {
    const existingTurns =
      queryClient.getQueryData<ExecutionTurn[]>(
        traceKeys.turns(targetSessionId)
      ) ?? []
    startSessionLiveTurn({
      sessionId: targetSessionId,
      userPrompt: "Live daemon turn",
      baseHistoryTurnCount: existingTurns.filter((t) => !t.isLive).length,
    })
  }

  const batcher = getOrCreateBatcher(targetSessionId, queryClient)
  for (const ev of traceEvents) {
    batcher.push(ev)
  }
  if (isTerminalFrame) {
    batcher.flushNow()
  }
}

export function dispatchPendingStreamPrompt(
  promptToSend: PendingStreamPrompt,
  queryClient: QueryClient
): void {
  const sessionId = promptToSend.sessionId
  const store = useAppStore.getState()
  const isLiveDaemon =
    !sessionId.startsWith("ses_") &&
    (store.daemonMode === "live" ||
      (typeof window !== "undefined" &&
        Boolean(window.rayu?.harness?.sendMessage)))
  const isCloudLive = Boolean(
    store.authState?.signedIn &&
      typeof window !== "undefined" &&
      (window.rayu?.cloud?.streamChat ||
        (import.meta.env.DEV && import.meta.env.MODE !== "test"))
  )

  if (isLiveDaemon || isCloudLive) {
    const existingTurns =
      queryClient.getQueryData<ExecutionTurn[]>(traceKeys.turns(sessionId)) ??
      []
    const baseHistoryTurnCount = existingTurns.filter((t) => !t.isLive).length
    const history: CloudChatMessage[] = []
    for (const t of existingTurns) {
      if (t.isLive) continue
      if (t.userPrompt.trim()) {
        history.push({ role: "user", content: t.userPrompt })
      }
      if (t.answerIntro.trim()) {
        history.push({ role: "assistant", content: t.answerIntro })
      }
    }

    const startedAtMs = promptToSend.startedAtMs ?? Date.now()
    prepareTrackerForPrompt(sessionId, startedAtMs)
    startSessionLiveTurn({
      sessionId,
      userPrompt: promptToSend.prompt,
      userImages: promptToSend.images,
      startedAtMs,
      baseHistoryTurnCount,
    })

    void ipcClient.trace
      .sendPrompt({
        sessionId,
        prompt: promptToSend.prompt,
        images: promptToSend.images,
        modelId: promptToSend.modelId,
        modelLabel: promptToSend.modelLabel,
        history,
      })
      .catch((error: unknown) => {
        clearSessionLiveTurn(sessionId)
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
      sessionId,
      prompt: promptToSend.prompt,
      images: promptToSend.images,
      modelId: promptToSend.modelId,
      modelLabel: promptToSend.modelLabel,
    })
    .then((turn) => {
      queryClient.setQueryData<ExecutionTurn[]>(
        traceKeys.turns(sessionId),
        (prev) => {
          if (!prev) return [turn]
          return prev.some((t) => t.id === turn.id) ? prev : [...prev, turn]
        }
      )
    })
    .catch((error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to send prompt"
      )
    })
}

export function LiveTraceController() {
  const queryClient = useQueryClient()
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const pendingStreamPrompt = useAppStore((s) => s.pendingStreamPrompt)
  const isCurrentSessionStreaming = useLiveTraceStore((s) =>
    Boolean(activeSessionId && s.liveTurnsBySession[activeSessionId]?.isLive)
  )

  React.useEffect(() => {
    controllerMountCount += 1
    const unsubscribe = ipcClient.harness.onEvent((frame) => {
      processHarnessFrame(
        frame,
        queryClient,
        useAppStore.getState().activeSessionId ?? undefined
      )
    })
    return () => {
      unsubscribe()
      controllerMountCount = Math.max(0, controllerMountCount - 1)
      if (controllerMountCount === 0) {
        resetAllLiveTraces()
      }
    }
  }, [queryClient])

  React.useEffect(() => {
    if (!pendingStreamPrompt) return
    useAppStore.getState().setPendingStreamPrompt(null)
    dispatchPendingStreamPrompt(pendingStreamPrompt, queryClient)
  }, [pendingStreamPrompt, queryClient])

  React.useEffect(() => {
    useAppStore.getState().setIsStreamActive(isCurrentSessionStreaming)
  }, [isCurrentSessionStreaming])

  return null
}
