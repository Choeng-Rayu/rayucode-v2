import * as React from "react"

import { formatDurationSeconds } from "@/lib/harness-adapter"
import type { PromptImageAttachment } from "@/lib/ipc-client"
import { createStreamBatcher, type StreamBatcher } from "@/lib/stream-batcher"

import type { ExecutionTurn, LiveTraceEvent } from "../types"

const FRAME_BATCH_WINDOW_MS = 16

export const EMPTY_DIFF_CARD = {
  id: "diff_live_pending",
  file: "",
  additions: 0,
  deletions: 0,
  hint: "",
  lines: [],
}

export function applyTraceEvents(
  current: ExecutionTurn | null,
  events: LiveTraceEvent[]
): ExecutionTurn | null {
  if (!current || events.length === 0) return current

  let next: ExecutionTurn = {
    ...current,
    notes: [...current.notes],
    groups: current.groups.map((g) => ({ ...g, steps: [...g.steps] })),
    timeline: current.timeline
      ? current.timeline.map((entry) =>
          entry.type === "group"
            ? {
                type: "group",
                group: { ...entry.group, steps: [...entry.group.steps] },
              }
            : { ...entry }
        )
      : [],
    answerBullets: [...current.answerBullets],
  }

  for (const event of events) {
    switch (event.type) {
      case "reasoning-delta": {
        if (!event.delta) break
        const timeline = next.timeline ?? []
        const last = timeline[timeline.length - 1]
        if (last && last.type === "reasoning") {
          timeline[timeline.length - 1] = {
            ...last,
            text: `${last.text}${event.delta}`,
          }
        } else {
          timeline.push({
            type: "reasoning",
            id: `reasoning_${timeline.length + 1}`,
            text: event.delta,
          })
        }
        next.timeline = timeline
        break
      }
      case "note": {
        next.notes.push(event.text)
        next.timeline?.push({
          type: "note",
          id: `note_${next.timeline.length + 1}`,
          text: event.text,
        })
        break
      }
      case "promote-note": {
        const pendingText = next.answerIntro.trim()
        if (pendingText) {
          next.notes.push(pendingText)
          next.timeline?.push({
            type: "note",
            id: `note_${next.timeline.length + 1}`,
            text: pendingText,
          })
          next.answerIntro = ""
        }
        break
      }
      case "tool-status": {
        next.activeToolStatus = event.label
        break
      }
      case "step": {
        const targetGroupId =
          event.groupId ?? next.groups[next.groups.length - 1]?.id ?? "live_wg_1"
        const targetTitle = event.groupTitle ?? "Read files, ran commands"
        const existingIndex = next.groups.findIndex(
          (g) => g.id === targetGroupId
        )
        if (existingIndex === -1) {
          const createdGroup = {
            id: targetGroupId,
            title: targetTitle,
            steps: [event.step],
          }
          next.groups.push(createdGroup)
          next.timeline?.push({
            type: "group",
            group: { ...createdGroup, steps: [...createdGroup.steps] },
          })
        } else {
          const group = next.groups[existingIndex]
          const updatedGroup = {
            ...group,
            title: event.groupTitle ?? group.title,
            steps: [...group.steps, event.step],
          }
          next.groups[existingIndex] = updatedGroup
          if (next.timeline) {
            const tlIdx = next.timeline.findIndex(
              (entry) =>
                entry.type === "group" && entry.group.id === targetGroupId
            )
            if (tlIdx !== -1) {
              next.timeline[tlIdx] = {
                type: "group",
                group: { ...updatedGroup, steps: [...updatedGroup.steps] },
              }
            }
          }
        }
        break
      }
      case "artifact": {
        next.outputArtifact = event.artifact
        break
      }
      case "file-changes": {
        // Authoritative session snapshot is synchronized via useAppStore.setSessionFileChanges
        break
      }
      case "answer-delta": {
        next.answerIntro = `${next.answerIntro}${event.delta}`
        break
      }
      case "answer-replace": {
        next.answerIntro = event.text
        break
      }
      case "summary-title": {
        next.answerSummaryTitle = event.title
        break
      }
      case "bullet": {
        next.answerBullets.push(event.bullet)
        break
      }
      case "diff": {
        next.diffCard = event.diffCard
        break
      }
      case "duration": {
        next.workedDuration = event.workedDuration
        break
      }
      case "complete": {
        next = {
          ...next,
          isLive: false,
          activeToolStatus: null,
          workedDuration: event.workedDuration,
          credits: event.credits ?? next.credits,
          kvCachePct: event.kvCachePct ?? next.kvCachePct,
          timestamp: event.timestamp ?? "Just now",
        }
        break
      }
    }
  }

  return next
}

export interface UseLiveTraceOptions {
  batchWindowMs?: number
  onComplete?: (completedTurn: ExecutionTurn) => void
}

export interface StartLiveTurnInput {
  sessionId: string
  userPrompt: string
  userImages?: PromptImageAttachment[]
  userRefFiles?: string
  initialNote?: string
  activeToolStatus?: string | null
  startedAtMs?: number
  baseHistoryTurnCount?: number
}

export interface UseLiveTraceResult {
  liveTurn: ExecutionTurn | null
  isStreaming: boolean
  elapsedSeconds: number
  startLiveTurn: (input: StartLiveTurnInput) => string
  pushEvent: (event: LiveTraceEvent) => void
  flushNow: () => void
  resetLiveTurn: () => void
}

export function useLiveTrace(
  options: UseLiveTraceOptions = {}
): UseLiveTraceResult {
  const { batchWindowMs = FRAME_BATCH_WINDOW_MS, onComplete } = options

  const [liveTurn, setLiveTurn] = React.useState<ExecutionTurn | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)
  const liveTurnRef = React.useRef<ExecutionTurn | null>(null)
  const turnStartedAtRef = React.useRef<number>(0)
  const completedTurnIdsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    liveTurnRef.current = liveTurn
  }, [liveTurn])

  const onCompleteRef = React.useRef(onComplete)
  React.useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const batcherRef = React.useRef<StreamBatcher<LiveTraceEvent> | null>(null)
  const simulationTimersRef = React.useRef<Array<ReturnType<typeof setTimeout>>>(
    []
  )
  const sequenceRef = React.useRef(1)

  const clearSimulationTimers = React.useCallback(() => {
    for (const timer of simulationTimersRef.current) {
      clearTimeout(timer)
    }
    simulationTimersRef.current = []
  }, [])

  React.useEffect(() => {
    const batcher = createStreamBatcher<LiveTraceEvent>((events) => {
      const hasComplete = events.some((ev) => ev.type === "complete")
      setLiveTurn((prev) => {
        const updated = applyTraceEvents(prev, events)
        liveTurnRef.current = updated
        if (
          hasComplete &&
          updated &&
          onCompleteRef.current &&
          !completedTurnIdsRef.current.has(updated.id)
        ) {
          completedTurnIdsRef.current.add(updated.id)
          queueMicrotask(() => {
            onCompleteRef.current?.(updated)
          })
        }
        return updated
      })
    }, batchWindowMs)

    batcherRef.current = batcher

    return () => {
      batcher.dispose()
      batcherRef.current = null
      clearSimulationTimers()
    }
  }, [batchWindowMs, clearSimulationTimers])

  const isStreaming = Boolean(liveTurn?.isLive)

  React.useEffect(() => {
    if (!isStreaming) return
    const timer = setInterval(() => {
      const nextSec = Math.max(
        1,
        Math.floor((Date.now() - turnStartedAtRef.current) / 1000)
      )
      const formatted = formatDurationSeconds(nextSec)
      setElapsedSeconds(nextSec)
      setLiveTurn((curr) =>
        curr?.isLive ? { ...curr, workedDuration: formatted } : curr
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [isStreaming])

  const startLiveTurn = React.useCallback(
    (input: StartLiveTurnInput): string => {
      clearSimulationTimers()
      batcherRef.current?.flushNow()
      const existing = liveTurnRef.current
      if (existing && existing.isLive) {
        const finalizedSec = Math.max(
          1,
          Math.floor((Date.now() - turnStartedAtRef.current) / 1000)
        )
        const finalizedTurn: ExecutionTurn = {
          ...existing,
          isLive: false,
          activeToolStatus: null,
          workedDuration: formatDurationSeconds(finalizedSec),
        }
        onCompleteRef.current?.(finalizedTurn)
      }
      const id = `live_turn_${Date.now()}_${sequenceRef.current++}`
      const startedAt =
        typeof input.startedAtMs === "number" && input.startedAtMs > 0
          ? input.startedAtMs
          : Date.now()
      turnStartedAtRef.current = startedAt
      const initialElapsedSec = Math.max(
        1,
        Math.floor((Date.now() - startedAt) / 1000)
      )
      setElapsedSeconds(initialElapsedSec)
      const initialTurn: ExecutionTurn = {
        id,
        sessionId: input.sessionId,
        userRefFiles: input.userRefFiles,
        userPrompt: input.userPrompt,
        userImages: input.userImages,
        workedDuration: formatDurationSeconds(initialElapsedSec),
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
      liveTurnRef.current = initialTurn
      setLiveTurn(initialTurn)
      return id
    },
    [clearSimulationTimers]
  )

  const pushEvent = React.useCallback((event: LiveTraceEvent) => {
    batcherRef.current?.push(event)
  }, [])

  const flushNow = React.useCallback(() => {
    batcherRef.current?.flushNow()
  }, [])

  const resetLiveTurn = React.useCallback(() => {
    clearSimulationTimers()
    liveTurnRef.current = null
    setLiveTurn(null)
    setElapsedSeconds(0)
  }, [clearSimulationTimers])

  return {
    liveTurn,
    isStreaming,
    elapsedSeconds,
    startLiveTurn,
    pushEvent,
    flushNow,
    resetLiveTurn,
  }
}
