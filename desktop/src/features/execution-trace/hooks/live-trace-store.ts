import * as React from "react"
import { reconcileChatTurns } from "@rayu-dev/rayucode-session-core/client"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { create } from "zustand"

import { changesQueryKeys } from "@/features/changes"
import {
  useAppStore,
  type MidTurnSendMode,
  type PendingQuestionItem,
  type PendingStreamPrompt,
} from "@/lib/app-store"
import {
  createHarnessStreamTracker,
  formatDurationSeconds,
  mapHarnessFrameToLiveEvents,
  type HarnessStreamTracker,
} from "@/lib/harness-adapter"
import {
  ipcClient,
  type CloudChatMessage,
  type PromptImageAttachment,
} from "@/lib/ipc-client"
import { createStreamBatcher, type StreamBatcher } from "@/lib/stream-batcher"

import { traceKeys } from "../api/trace-api"
import type { ExecutionTurn, LiveTraceEvent, SessionSummary } from "../types"
import {
  applyTraceEvents,
  EMPTY_DIFF_CARD,
  type StartLiveTurnInput,
} from "./use-live-trace"

const FRAME_BATCH_WINDOW_MS = 16

export type DaemonSessionRuntimeStatus = {
  status: "running" | "idle"
  updatedAtMs: number
}

export type ReconcilableExecutionTurn = ExecutionTurn & {
  answerMarkdown: string
  workGroups: ExecutionTurn["groups"]
}

export function toReconcilableTurn(
  turn: ExecutionTurn
): ReconcilableExecutionTurn {
  const recordedBaseCount = baseHistoryCountByTurnId.get(turn.id)
  return {
    ...turn,
    ...(recordedBaseCount !== undefined
      ? { baseHistoryTurnCount: recordedBaseCount }
      : {}),
    answerMarkdown:
      turn.answerIntro.trim() ||
      (turn.answerBullets.length > 0 ? turn.answerBullets[0]!.body : ""),
    workGroups: turn.groups,
  }
}

function hasRenderableTurnContent(turn: ExecutionTurn): boolean {
  return (
    turn.userPrompt.trim().length > 0 ||
    Boolean(turn.userImages && turn.userImages.length > 0) ||
    Boolean(turn.userRefFiles) ||
    Boolean(turn.compactedNotice) ||
    turn.answerIntro.trim().length > 0 ||
    turn.answerBullets.length > 0 ||
    turn.groups.length > 0 ||
    turn.notes.length > 0 ||
    (turn.timeline?.length ?? 0) > 0 ||
    turn.diffCard.lines.length > 0 ||
    Boolean(turn.outputArtifact)
  )
}

function hasAssistantOrWorkContent(turn: ExecutionTurn): boolean {
  return (
    turn.answerIntro.trim().length > 0 ||
    turn.answerBullets.length > 0 ||
    turn.groups.length > 0 ||
    turn.notes.length > 0 ||
    (turn.timeline?.length ?? 0) > 0 ||
    turn.diffCard.lines.length > 0 ||
    Boolean(turn.outputArtifact)
  )
}

function patchCachedSessionStatus(
  queryClient: QueryClient | null,
  sessionId: string,
  status: "running" | "idle"
): void {
  if (!queryClient || !sessionId) return
  queryClient.setQueriesData<SessionSummary[]>(
    { queryKey: ["sessions"] },
    (prev) => {
      if (!Array.isArray(prev)) return prev
      let changed = false
      const next = prev.map((item) => {
        if (item.id !== sessionId) return item
        const desiredUpdatedAt = status === "running" ? "Live" : item.updatedAt
        if (item.status === status && item.updatedAt === desiredUpdatedAt) {
          return item
        }
        changed = true
        return {
          ...item,
          status,
          updatedAt: desiredUpdatedAt,
        }
      })
      return changed ? next : prev
    }
  )
}

interface LiveTraceStoreState {
  liveTurnsBySession: Record<string, ExecutionTurn>
  completedLiveTurnsBySession: Record<string, ExecutionTurn[]>
  baseHistoryTurnCountBySession: Record<string, number>
  lastEventAtMsBySession: Record<string, number>
  daemonSessionStatusBySession: Record<string, DaemonSessionRuntimeStatus>
}

export const useLiveTraceStore = create<LiveTraceStoreState>(() => ({
  liveTurnsBySession: {},
  completedLiveTurnsBySession: {},
  baseHistoryTurnCountBySession: {},
  lastEventAtMsBySession: {},
  daemonSessionStatusBySession: {},
}))

const trackersBySession = new Map<string, HarnessStreamTracker>()
const batchersBySession = new Map<string, StreamBatcher<LiveTraceEvent>>()
const startedAtBySession = new Map<string, number>()
const abnormalStopBySession = new Map<string, boolean>()
const pendingSoftInterruptsAtDoneBySession = new Map<string, number>()
const baseHistoryCountByTurnId = new Map<string, number>()
const sentSteersById = new Map<
  string,
  { sessionId: string; text: string; images?: PromptImageAttachment[] }
>()
const completedTurnIds = new Set<string>()

function clearSessionSentSteers(sessionId: string): void {
  for (const [id, entry] of sentSteersById) {
    if (entry.sessionId === sessionId) {
      sentSteersById.delete(id)
    }
  }
}
let turnSequence = 1
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let controllerMountCount = 0
let activeControllerQueryClient: QueryClient | null = null

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

function resolveDaemonLiveTurnBase(
  queryClient: QueryClient,
  sessionId: string
): {
  userPrompt: string
  userImages?: PromptImageAttachment[]
  userRefFiles?: string
  baseHistoryTurnCount: number
} {
  const existingTurns =
    queryClient.getQueryData<ExecutionTurn[]>(traceKeys.turns(sessionId)) ?? []
  const nonLiveTurns = existingTurns.filter((t) => !t.isLive)
  const trailing = nonLiveTurns[nonLiveTurns.length - 1]
  if (
    trailing &&
    (trailing.userPrompt.trim().length > 0 ||
      (trailing.userImages?.length ?? 0) > 0) &&
    !hasAssistantOrWorkContent(trailing)
  ) {
    return {
      userPrompt: trailing.userPrompt,
      ...(trailing.userImages && trailing.userImages.length > 0
        ? { userImages: trailing.userImages }
        : {}),
      ...(trailing.userRefFiles ? { userRefFiles: trailing.userRefFiles } : {}),
      baseHistoryTurnCount: Math.max(0, nonLiveTurns.length - 1),
    }
  }
  return {
    userPrompt: "",
    baseHistoryTurnCount: nonLiveTurns.length,
  }
}

export function startSessionLiveTurn(input: StartLiveTurnInput): ExecutionTurn {
  const startedAt =
    typeof input.startedAtMs === "number" && input.startedAtMs > 0
      ? input.startedAtMs
      : Date.now()
  startedAtBySession.set(input.sessionId, startedAt)
  abnormalStopBySession.delete(input.sessionId)
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
    activeToolStatus: input.activeToolStatus ?? null,
    answerIntro: "",
    answerBullets: [],
    diffCard: EMPTY_DIFF_CARD,
    timestamp: "Just now",
    credits: "0.08 cr",
    kvCachePct: 94,
    pinned: false,
  }
  if (
    typeof input.baseHistoryTurnCount === "number" &&
    input.baseHistoryTurnCount >= 0
  ) {
    baseHistoryCountByTurnId.set(turn.id, input.baseHistoryTurnCount)
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
    daemonSessionStatusBySession: {
      ...state.daemonSessionStatusBySession,
      [input.sessionId]: { status: "running", updatedAtMs: startedAt },
    },
  }))
  patchCachedSessionStatus(
    activeControllerQueryClient,
    input.sessionId,
    "running"
  )
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
  abnormalStopBySession.delete(sessionId)
  pendingSoftInterruptsAtDoneBySession.delete(sessionId)
  const tracker = trackersBySession.get(sessionId)
  if (tracker) {
    tracker.turnActive = false
    tracker.toolInputs.clear()
  }
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
  abnormalStopBySession.clear()
  pendingSoftInterruptsAtDoneBySession.clear()
  baseHistoryCountByTurnId.clear()
  sentSteersById.clear()
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
    daemonSessionStatusBySession: {},
  })
}

export function settleSessionTurnQueue(
  sessionId: string,
  wasAbnormalStop: boolean,
  queryClient?: QueryClient | null,
  pendingSoftInterrupts = 0
): void {
  if (!sessionId) return
  const store = useAppStore.getState()
  if (wasAbnormalStop || store.pausedQueueSessions[sessionId]) {
    store.demotePendingSteersToQueue(sessionId)
  clearSessionSentSteers(sessionId)
    const remaining = useAppStore.getState().midTurnMessagesBySession[sessionId]
    if (remaining && remaining.some((item) => item.mode === "queue")) {
      store.setQueuePausedForSession(sessionId, true)
    }
    if (pendingSoftInterrupts > 0) {
      clearSessionSentSteers(sessionId)
      void ipcClient.trace.cancelSoftInterrupts(sessionId).catch(() => {})
    }
    return
  }

  if (pendingSoftInterrupts > 0) {
    clearSessionSentSteers(sessionId)
    void ipcClient.trace.cancelSoftInterrupts(sessionId).catch(() => {})
    store.demotePendingSteersToQueue(sessionId)
  clearSessionSentSteers(sessionId)
  } else {
    store.markSteersDelivered(sessionId)
  }
  const next = store.shiftNextQueuedMessage(sessionId)
  if (!next) return

  const qc = queryClient ?? activeControllerQueryClient
  const nextPrompt: PendingStreamPrompt = {
    sessionId,
    prompt: next.text,
    ...(next.images && next.images.length > 0 ? { images: next.images } : {}),
    ...(next.modelId ? { modelId: next.modelId } : {}),
    modelLabel: next.modelLabel ?? "Default",
    ...(next.effort ? { effort: next.effort } : {}),
    startedAtMs: Date.now(),
  }
  if (qc) {
    dispatchPendingStreamPrompt(nextPrompt, qc)
  } else {
    store.setPendingStreamPrompt(nextPrompt)
  }
}

export async function sendMidTurnMessage(
  input: {
    sessionId: string
    mode: MidTurnSendMode
    prompt: string
    images?: PromptImageAttachment[]
    modelId?: string
    modelLabel?: string
    effort?: string
    permissionMode?: string
  },
  queryClient?: QueryClient
): Promise<void> {
  const { sessionId, mode, prompt, images, modelId, modelLabel, effort, permissionMode } =
    input
  if (!sessionId) return
  const store = useAppStore.getState()
  const itemId = `mid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const item = {
    id: itemId,
    sessionId,
    mode,
    text: prompt,
    createdAtMs: Date.now(),
    ...(images && images.length > 0 ? { images } : {}),
    ...(modelId ? { modelId } : {}),
    ...(modelLabel ? { modelLabel } : {}),
    ...(effort ? { effort } : {}),
    ...(permissionMode ? { permissionMode } : {}),
  }

  store.setQueuePausedForSession(sessionId, false)

  if (mode === "queue") {
    store.addMidTurnMessage(sessionId, item)
    return
  }

  store.addMidTurnMessage(sessionId, item)
  sentSteersById.set(itemId, {
    sessionId,
    text: prompt,
    ...(images && images.length > 0 ? { images } : {}),
  })
  try {
    const res = await ipcClient.trace.softInterrupt({
      sessionId,
      prompt,
      clientId: itemId,
      urgent: false,
      images,
    })
    if (res.ok) {
      return
    }
    sentSteersById.delete(itemId)
    // Live steer not supported (e.g., cloud-only stream or offline daemon) or failed -> keep message in Queue
    useAppStore.getState().updateMidTurnMessage(sessionId, itemId, {
      mode: "queue",
    })
    if (res.code === "unsupported") {
      toast("Queued for next turn (live steer requires local daemon)")
    } else {
      toast.error(res.error ?? "Failed to steer turn; moved to queue")
    }
  } catch (err) {
    useAppStore.getState().updateMidTurnMessage(sessionId, itemId, {
      mode: "queue",
    })
    toast.error(
      err instanceof Error
        ? `${err.message}; moved to queue`
        : "Failed to steer turn; moved to queue"
    )
  }
  void queryClient
}

export async function promoteQueuedMessageToSteer(
  sessionId: string,
  itemId: string
): Promise<void> {
  if (!sessionId || !itemId) return
  const store = useAppStore.getState()
  const item = (store.midTurnMessagesBySession[sessionId] ?? []).find(
    (entry) => entry.id === itemId
  )
  if (!item || item.mode === "steer") return

  store.updateMidTurnMessage(sessionId, itemId, { mode: "steer" })
  sentSteersById.set(itemId, {
    sessionId,
    text: item.text,
    ...(item.images && item.images.length > 0 ? { images: item.images } : {}),
  })
  try {
    const res = await ipcClient.trace.softInterrupt({
      sessionId,
      prompt: item.text,
      clientId: itemId,
      urgent: false,
      images: item.images,
    })
    if (!res.ok) {
      sentSteersById.delete(itemId)
      useAppStore.getState().updateMidTurnMessage(sessionId, itemId, {
        mode: "queue",
      })
      toast.error(res.error ?? "Failed to steer message")
    }
  } catch (err) {
    useAppStore.getState().updateMidTurnMessage(sessionId, itemId, {
      mode: "queue",
    })
    toast.error(err instanceof Error ? err.message : "Failed to steer message")
  }
}

export function sendQueuedMessageNow(
  sessionId: string,
  itemId: string,
  queryClient: QueryClient
): void {
  if (!sessionId || !itemId) return
  const store = useAppStore.getState()
  const item = (store.midTurnMessagesBySession[sessionId] ?? []).find(
    (entry) => entry.id === itemId
  )
  if (!item) return
  store.removeMidTurnMessage(sessionId, itemId)
  store.setQueuePausedForSession(sessionId, false)
  dispatchPendingStreamPrompt(
    {
      sessionId,
      prompt: item.text,
      ...(item.images && item.images.length > 0 ? { images: item.images } : {}),
      ...(item.modelId ? { modelId: item.modelId } : {}),
      modelLabel: item.modelLabel ?? "Default",
      ...(item.effort ? { effort: item.effort } : {}),
      startedAtMs: Date.now(),
    },
    queryClient
  )
}

export async function cancelMidTurnMessage(
  sessionId: string,
  itemId: string
): Promise<void> {
  if (!sessionId || !itemId) return
  const store = useAppStore.getState()
  const existing = (store.midTurnMessagesBySession[sessionId] ?? []).find(
    (entry) => entry.id === itemId
  )
  store.removeMidTurnMessage(sessionId, itemId)
  sentSteersById.delete(itemId)
  if (existing?.mode === "steer") {
    await ipcClient.trace.cancelSoftInterrupts(sessionId, itemId).catch(() => {})
  }
}

export function editMidTurnMessage(sessionId: string, itemId: string): void {
  if (!sessionId || !itemId) return
  const store = useAppStore.getState()
  const existing = (store.midTurnMessagesBySession[sessionId] ?? []).find(
    (entry) => entry.id === itemId
  )
  if (!existing) return
  store.removeMidTurnMessage(sessionId, itemId)
  sentSteersById.delete(itemId)
  if (existing.mode === "steer") {
    void ipcClient.trace.cancelSoftInterrupts(sessionId, itemId).catch(() => {})
  }
  store.setComposerDraft(sessionId, existing.text)
  store.requestComposerFocus()
}

export function stopActiveSessionTurn(sessionId: string): void {
  if (!sessionId) return
  const store = useAppStore.getState()
  if (store.pendingStreamPrompt?.sessionId === sessionId) {
    store.setPendingStreamPrompt(null)
  }
  store.demotePendingSteersToQueue(sessionId)
  clearSessionSentSteers(sessionId)
  const remaining = useAppStore.getState().midTurnMessagesBySession[sessionId]
  if (remaining && remaining.some((item) => item.mode === "queue")) {
    store.setQueuePausedForSession(sessionId, true)
  }
  const traceState = useLiveTraceStore.getState()
  const existingLive = traceState.liveTurnsBySession[sessionId]
  let baseHistoryCount = traceState.baseHistoryTurnCountBySession[sessionId]
  const tracker = trackersBySession.get(sessionId)
  if (tracker) {
    tracker.turnActive = false
    tracker.turnCompleted = true
    tracker.toolInputs.clear()
  }

  if (existingLive && hasRenderableTurnContent(existingLive)) {
    let stoppedTurn: ExecutionTurn = {
      ...existingLive,
      isLive: false,
      activeToolStatus: null,
    }
    if (
      !stoppedTurn.userPrompt.trim() &&
      activeControllerQueryClient
    ) {
      const resolvedBase = resolveDaemonLiveTurnBase(
        activeControllerQueryClient,
        sessionId
      )
      if (
        resolvedBase.userPrompt.trim().length > 0 ||
        (resolvedBase.userImages?.length ?? 0) > 0
      ) {
        stoppedTurn = {
          ...stoppedTurn,
          userPrompt: resolvedBase.userPrompt,
          ...(stoppedTurn.userImages && stoppedTurn.userImages.length > 0
            ? {}
            : resolvedBase.userImages
              ? { userImages: resolvedBase.userImages }
              : {}),
          userRefFiles: stoppedTurn.userRefFiles ?? resolvedBase.userRefFiles,
        }
        baseHistoryCount = resolvedBase.baseHistoryTurnCount
      }
    }
    if (typeof baseHistoryCount === "number" && baseHistoryCount >= 0) {
      baseHistoryCountByTurnId.set(stoppedTurn.id, baseHistoryCount)
    }
    if (!completedTurnIds.has(stoppedTurn.id)) {
      completedTurnIds.add(stoppedTurn.id)
      ipcClient.trace.recordTurn(stoppedTurn)
      useLiveTraceStore.setState((state) => {
        const prevCompleted = state.completedLiveTurnsBySession[sessionId] ?? []
        const nextCompleted = [
          ...prevCompleted.filter((t) => t.id !== stoppedTurn.id),
          stoppedTurn,
        ].slice(-5)
        return {
          completedLiveTurnsBySession: {
            ...state.completedLiveTurnsBySession,
            [sessionId]: nextCompleted,
          },
        }
      })
      if (activeControllerQueryClient) {
        activeControllerQueryClient.setQueryData<ExecutionTurn[]>(
          traceKeys.turns(sessionId),
          (prev) => {
            const history = prev ?? []
            return reconcileChatTurns({
              historyTurns: history.map(toReconcilableTurn),
              liveTurn: toReconcilableTurn(stoppedTurn),
              baseHistoryTurnCount: baseHistoryCount,
            })
          }
        )
      }
    }
  }

  useLiveTraceStore.setState((state) => ({
    daemonSessionStatusBySession: {
      ...state.daemonSessionStatusBySession,
      [sessionId]: { status: "idle", updatedAtMs: Date.now() },
    },
  }))
  patchCachedSessionStatus(activeControllerQueryClient, sessionId, "idle")
  clearSessionLiveTurn(sessionId)
  if (activeControllerQueryClient) {
    void activeControllerQueryClient.invalidateQueries({
      queryKey: ["sessions"],
    })
    void activeControllerQueryClient.invalidateQueries({
      queryKey: traceKeys.turns(sessionId),
    })
  }
  void ipcClient.trace.cancelSoftInterrupts(sessionId).catch(() => {})
  void ipcClient.trace.cancel(sessionId)
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
      const wasAbnormalStop = Boolean(abnormalStopBySession.get(sessionId))
      const pendingSoftInterrupts =
        pendingSoftInterruptsAtDoneBySession.get(sessionId) ?? 0
      pendingSoftInterruptsAtDoneBySession.delete(sessionId)
      const nowMs = Date.now()
      useLiveTraceStore.setState((state) => ({
        daemonSessionStatusBySession: {
          ...state.daemonSessionStatusBySession,
          [sessionId]: { status: "idle", updatedAtMs: nowMs },
        },
      }))
      patchCachedSessionStatus(queryClient, sessionId, "idle")

      let finalTurn = updated
      let baseHistoryCount = storeState.baseHistoryTurnCountBySession[sessionId]
      if (!finalTurn.userPrompt.trim()) {
        const resolvedBase = resolveDaemonLiveTurnBase(queryClient, sessionId)
        if (
          resolvedBase.userPrompt.trim().length > 0 ||
          (resolvedBase.userImages?.length ?? 0) > 0
        ) {
          finalTurn = {
            ...finalTurn,
            userPrompt: resolvedBase.userPrompt,
            ...(finalTurn.userImages && finalTurn.userImages.length > 0
              ? {}
              : resolvedBase.userImages
                ? { userImages: resolvedBase.userImages }
                : {}),
            userRefFiles: finalTurn.userRefFiles ?? resolvedBase.userRefFiles,
          }
          baseHistoryCount = resolvedBase.baseHistoryTurnCount
        }
      }
      if (typeof baseHistoryCount === "number" && baseHistoryCount >= 0) {
        baseHistoryCountByTurnId.set(finalTurn.id, baseHistoryCount)
      }

      const shouldPersistAndDisplay =
        hasRenderableTurnContent(finalTurn) &&
        (finalTurn.userPrompt.trim().length > 0 ||
          hasAssistantOrWorkContent(finalTurn))

      if (shouldPersistAndDisplay) {
        if (!completedTurnIds.has(finalTurn.id)) {
          completedTurnIds.add(finalTurn.id)
          ipcClient.trace.recordTurn(finalTurn)
          useLiveTraceStore.setState((state) => {
            const prevCompleted =
              state.completedLiveTurnsBySession[sessionId] ?? []
            const nextCompleted = [
              ...prevCompleted.filter((t) => t.id !== finalTurn.id),
              finalTurn,
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
                liveTurn: toReconcilableTurn(finalTurn),
                baseHistoryTurnCount: baseHistoryCount,
              })
            }
          )
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["sessions"] })
      void queryClient.invalidateQueries({
        queryKey: traceKeys.turns(sessionId),
      })
      useAppStore.getState().clearPendingPermission(sessionId)
      useAppStore.getState().clearPendingQuestion(sessionId)
      clearSessionLiveTurn(sessionId)
      settleSessionTurnQueue(
        sessionId,
        wasAbnormalStop,
        queryClient,
        pendingSoftInterrupts
      )
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
    typeof frame.session_id === "string" ? frame.session_id.trim() : ""
  const evName = typeof frame.ev === "string" ? frame.ev : ""
  if (
    !frameSession &&
    (evName === "error" ||
      evName === "turn_stopped" ||
      evName === "turn_aborted")
  ) {
    return
  }
  const targetSessionId = frameSession || fallbackSessionId || ""
  if (!targetSessionId) return

  const nowMs = Date.now()
  if (evName === "permission_resolved") {
    const reqId =
      typeof frame.request_id === "string" ? frame.request_id.trim() : ""
    useAppStore
      .getState()
      .clearPendingPermission(targetSessionId, reqId || undefined)
    return
  }

  if (evName === "question_request") {
    const reqId =
      typeof frame.request_id === "string" ? frame.request_id.trim() : ""
    const rawQuestions = Array.isArray(frame.questions) ? frame.questions : []
    const questions: PendingQuestionItem[] = rawQuestions
      .map((rawItem) => {
        if (!rawItem || typeof rawItem !== "object") return null
        const q = rawItem as Record<string, unknown>
        const question = typeof q.question === "string" ? q.question.trim() : ""
        if (!question) return null
        const header =
          typeof q.header === "string" && q.header.trim()
            ? q.header.trim()
            : "Question"
        const options = Array.isArray(q.options)
          ? q.options
              .map((opt) => {
                if (!opt || typeof opt !== "object") return null
                const o = opt as Record<string, unknown>
                const label = typeof o.label === "string" ? o.label : ""
                const description =
                  typeof o.description === "string" ? o.description : ""
                if (!label) return null
                return {
                  label,
                  description,
                  ...(typeof o.preview === "string"
                    ? { preview: o.preview }
                    : {}),
                }
              })
              .filter((o): o is NonNullable<typeof o> => o !== null)
          : []
        return {
          question,
          header,
          options,
          ...(q.multiSelect === true || q.multi_select === true
            ? { multiSelect: true }
            : {}),
        }
      })
      .filter((item): item is PendingQuestionItem => item !== null)
    if (reqId && questions.length > 0) {
      useAppStore.getState().setPendingQuestion({
        sessionId: targetSessionId,
        requestId: reqId,
        questions,
      })
    }
    return
  }

  if (evName === "question_closed") {
    const reqId =
      typeof frame.request_id === "string" ? frame.request_id.trim() : ""
    useAppStore
      .getState()
      .clearPendingQuestion(targetSessionId, reqId || undefined)
    return
  }

  if (evName === "soft_interrupt_injected") {
    const displayRole =
      typeof frame.display_role === "string"
        ? frame.display_role.trim().toLowerCase()
        : ""
    if (displayRole === "system" || displayRole === "background_task") {
      return
    }
    const point = typeof frame.point === "string" ? frame.point.trim() : ""
    const clientIds = Array.isArray(frame.client_ids)
      ? frame.client_ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0
        )
      : []
    const store = useAppStore.getState()
    const currentItems = store.midTurnMessagesBySession[targetSessionId] ?? []
    const matchedSteers = currentItems.filter(
      (item) =>
        item.mode === "steer" &&
        (clientIds.length === 0 || clientIds.includes(item.id))
    )
    const fallbackSteers: Array<{
      id: string
      text: string
      images?: PromptImageAttachment[]
    }> =
      matchedSteers.length > 0
        ? matchedSteers
        : clientIds
            .map((id) => {
              const recorded = sentSteersById.get(id)
              if (!recorded || recorded.sessionId !== targetSessionId) {
                return null
              }
              return {
                id,
                text: recorded.text,
                ...(recorded.images ? { images: recorded.images } : {}),
              }
            })
            .filter(
              (
                entry
              ): entry is {
                id: string
                text: string
                images?: PromptImageAttachment[]
              } => entry !== null
            )
    for (const id of clientIds) {
      sentSteersById.delete(id)
    }
    store.markSteersDelivered(targetSessionId, clientIds)
    if (fallbackSteers.length > 0) {
      const texts = fallbackSteers
        .map((item) => item.text.trim())
        .filter(Boolean)
      const mergedImages = fallbackSteers.flatMap((item) => item.images ?? [])
      if (point === "turn_start") {
        if (texts.length > 0 || mergedImages.length > 0) {
          const existingTurns =
            queryClient.getQueryData<ExecutionTurn[]>(
              traceKeys.turns(targetSessionId)
            ) ?? []
          const nonLiveCount = existingTurns.filter((t) => !t.isLive).length
          prepareTrackerForPrompt(targetSessionId, nowMs)
          startSessionLiveTurn({
            sessionId: targetSessionId,
            userPrompt: texts.join("\n\n"),
            ...(mergedImages.length > 0 ? { userImages: mergedImages } : {}),
            startedAtMs: nowMs,
            baseHistoryTurnCount: nonLiveCount,
          })
        }
        return
      }
      if (texts.length > 0) {
        if (!useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]) {
          const base = resolveDaemonLiveTurnBase(queryClient, targetSessionId)
          startSessionLiveTurn({
            sessionId: targetSessionId,
            userPrompt: base.userPrompt,
            ...(base.userImages ? { userImages: base.userImages } : {}),
            ...(base.userRefFiles ? { userRefFiles: base.userRefFiles } : {}),
            baseHistoryTurnCount: base.baseHistoryTurnCount,
          })
        }
        const toolsSkipped =
          typeof frame.tools_skipped === "number" && frame.tools_skipped > 0
            ? Math.floor(frame.tools_skipped)
            : 0
        const noteText =
          toolsSkipped > 0
            ? `Steered: ${texts.join(" · ")} (skipped ${toolsSkipped} pending ${toolsSkipped === 1 ? "tool" : "tools"})`
            : `Steered: ${texts.join(" · ")}`
        const batcher = getOrCreateBatcher(targetSessionId, queryClient)
        batcher.push({ type: "note", text: noteText })
        batcher.flushNow()
      }
    }
    return
  }

  if (evName === "soft_interrupts_cancelled") {
    if (Array.isArray(frame.cancelled)) {
      const store = useAppStore.getState()
      for (const id of frame.cancelled) {
        if (typeof id === "string" && id.length > 0) {
          sentSteersById.delete(id)
          store.removeMidTurnMessage(targetSessionId, id)
        }
      }
    }
    return
  }

  if (evName === "session_status") {
    const status =
      typeof frame.status === "string" ? frame.status.trim().toLowerCase() : ""
    if (
      status === "running" ||
      status === "processing" ||
      status === "busy" ||
      status === "generating" ||
      status === "tool_running"
    ) {
      const existing =
        useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]
      useLiveTraceStore.setState((state) => ({
        lastEventAtMsBySession: {
          ...state.lastEventAtMsBySession,
          [targetSessionId]: nowMs,
        },
        daemonSessionStatusBySession: {
          ...state.daemonSessionStatusBySession,
          [targetSessionId]: { status: "running", updatedAtMs: nowMs },
        },
      }))
      patchCachedSessionStatus(queryClient, targetSessionId, "running")
      if (!existing) {
        const base = resolveDaemonLiveTurnBase(queryClient, targetSessionId)
        startSessionLiveTurn({
          sessionId: targetSessionId,
          userPrompt: base.userPrompt,
          ...(base.userImages ? { userImages: base.userImages } : {}),
          ...(base.userRefFiles ? { userRefFiles: base.userRefFiles } : {}),
          activeToolStatus:
            status === "tool_running" ? "Running tool..." : "Thinking...",
          baseHistoryTurnCount: base.baseHistoryTurnCount,
        })
      } else if (!existing.isLive) {
        useLiveTraceStore.setState((state) => ({
          liveTurnsBySession: {
            ...state.liveTurnsBySession,
            [targetSessionId]: { ...existing, isLive: true },
          },
        }))
      }
    } else if (status === "idle" || status === "cancelled") {
      useLiveTraceStore.setState((state) => ({
        daemonSessionStatusBySession: {
          ...state.daemonSessionStatusBySession,
          [targetSessionId]: { status: "idle", updatedAtMs: nowMs },
        },
      }))
      patchCachedSessionStatus(queryClient, targetSessionId, "idle")
      const existing =
        useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]
      if (
        existing &&
        !existing.userPrompt.trim() &&
        !existing.answerIntro.trim() &&
        existing.answerBullets.length === 0 &&
        existing.groups.length === 0 &&
        existing.notes.length === 0 &&
        (existing.timeline?.length ?? 0) === 0
      ) {
        clearSessionLiveTurn(targetSessionId)
        void queryClient.invalidateQueries({
          queryKey: traceKeys.turns(targetSessionId),
        })
      }
    }
    return
  }

  if (
    evName === "error" &&
    (frame.non_turn === true ||
      frame.req === "set_model" ||
      frame.req === "set_reasoning_effort" ||
      frame.req === "set_permission_mode")
  ) {
    return
  }

  const isTerminalFrame =
    evName === "turn_done" || evName === "turn_stopped" || evName === "error"
  const pendingSoftInterrupts =
    evName === "turn_done" &&
    typeof frame.pending_soft_interrupts === "number" &&
    Number.isFinite(frame.pending_soft_interrupts) &&
    frame.pending_soft_interrupts > 0
      ? Math.floor(frame.pending_soft_interrupts)
      : 0
  if (pendingSoftInterrupts > 0) {
    pendingSoftInterruptsAtDoneBySession.set(
      targetSessionId,
      pendingSoftInterrupts
    )
  }
  if (evName === "turn_stopped" || evName === "error") {
    abnormalStopBySession.set(targetSessionId, true)
  } else if (evName === "turn_start" || evName === "message_accepted") {
    abnormalStopBySession.delete(targetSessionId)
  }

  useLiveTraceStore.setState((state) => ({
    lastEventAtMsBySession: {
      ...state.lastEventAtMsBySession,
      [targetSessionId]: nowMs,
    },
    ...(evName === "turn_start" || evName === "message_accepted"
      ? {
          daemonSessionStatusBySession: {
            ...state.daemonSessionStatusBySession,
            [targetSessionId]: { status: "running", updatedAtMs: nowMs },
          },
        }
      : {}),
  }))

  const tracker = getOrCreateTracker(targetSessionId)
  if (isTerminalFrame && !useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]) {
    tracker.turnActive = false
    tracker.turnCompleted = true
    pendingSoftInterruptsAtDoneBySession.delete(targetSessionId)
    useLiveTraceStore.setState((state) => ({
      daemonSessionStatusBySession: {
        ...state.daemonSessionStatusBySession,
        [targetSessionId]: { status: "idle", updatedAtMs: nowMs },
      },
    }))
    patchCachedSessionStatus(queryClient, targetSessionId, "idle")
    useAppStore.getState().clearPendingPermission(targetSessionId)
    useAppStore.getState().clearPendingQuestion(targetSessionId)
    settleSessionTurnQueue(
      targetSessionId,
      evName === "turn_stopped" || evName === "error",
      queryClient,
      pendingSoftInterrupts
    )
    void queryClient.invalidateQueries({ queryKey: ["sessions"] })
    void queryClient.invalidateQueries({
      queryKey: traceKeys.turns(targetSessionId),
    })
    return
  }

  const mapped = mapHarnessFrameToLiveEvents(frame, tracker)
  if (mapped.length === 0) {
    if (isTerminalFrame) {
      pendingSoftInterruptsAtDoneBySession.delete(targetSessionId)
      useLiveTraceStore.setState((state) => ({
        daemonSessionStatusBySession: {
          ...state.daemonSessionStatusBySession,
          [targetSessionId]: { status: "idle", updatedAtMs: nowMs },
        },
      }))
      patchCachedSessionStatus(queryClient, targetSessionId, "idle")
      settleSessionTurnQueue(
        targetSessionId,
        evName === "turn_stopped" || evName === "error",
        queryClient,
        pendingSoftInterrupts
      )
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
    const base = resolveDaemonLiveTurnBase(queryClient, targetSessionId)
    startSessionLiveTurn({
      sessionId: targetSessionId,
      userPrompt: base.userPrompt,
      ...(base.userImages ? { userImages: base.userImages } : {}),
      ...(base.userRefFiles ? { userRefFiles: base.userRefFiles } : {}),
      baseHistoryTurnCount: base.baseHistoryTurnCount,
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
        ...(promptToSend.effort ? { effort: promptToSend.effort } : {}),
        history,
      })
      .catch((error: unknown) => {
        clearSessionLiveTurn(sessionId)
        useLiveTraceStore.setState((state) => ({
          daemonSessionStatusBySession: {
            ...state.daemonSessionStatusBySession,
            [sessionId]: { status: "idle", updatedAtMs: Date.now() },
          },
        }))
        patchCachedSessionStatus(queryClient, sessionId, "idle")
        const storeState = useAppStore.getState()
        if (!storeState.composerDraftBySession[sessionId]?.trim()) {
          storeState.setComposerDraft(sessionId, promptToSend.prompt)
        }
        const rawCode =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : ""
        const rawMsg =
          error instanceof Error
            ? error.message
            : "Failed to stream response from Rayu Cloud"
        const isAuthError =
          rawCode === "auth_required" ||
          /auth_required|sign in|authenticate|not signed in/i.test(rawMsg)
        toast.error(
          isAuthError
            ? "Sign in required before running a turn. Your draft has been kept."
            : rawMsg
        )
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
      ...(promptToSend.effort ? { effort: promptToSend.effort } : {}),
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
      const storeState = useAppStore.getState()
      if (!storeState.composerDraftBySession[sessionId]?.trim()) {
        storeState.setComposerDraft(sessionId, promptToSend.prompt)
      }
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
    activeControllerQueryClient = queryClient
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
        activeControllerQueryClient = null
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
