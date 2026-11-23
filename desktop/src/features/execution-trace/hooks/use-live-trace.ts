import * as React from "react"

import { createStreamBatcher, type StreamBatcher } from "@/lib/stream-batcher"

import type { ExecutionTurn, LiveTraceEvent } from "../types"

const FRAME_BATCH_WINDOW_MS = 16

const EMPTY_DIFF_CARD = {
  id: "diff_live_pending",
  file: "src/session/lookup.rs",
  additions: 0,
  deletions: 0,
  hint: "Inspecting workspace changes",
  lines: [],
}

function applyTraceEvents(
  current: ExecutionTurn | null,
  events: LiveTraceEvent[]
): ExecutionTurn | null {
  if (!current || events.length === 0) return current

  let next: ExecutionTurn = {
    ...current,
    notes: [...current.notes],
    groups: current.groups.map((g) => ({ ...g, steps: [...g.steps] })),
    answerBullets: [...current.answerBullets],
  }

  for (const event of events) {
    switch (event.type) {
      case "note": {
        next.notes.push(event.text)
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
          next.groups.push({
            id: targetGroupId,
            title: targetTitle,
            steps: [event.step],
          })
        } else {
          const group = next.groups[existingIndex]
          next.groups[existingIndex] = {
            ...group,
            steps: [...group.steps, event.step],
          }
        }
        break
      }
      case "answer-delta": {
        next.answerIntro = `${next.answerIntro}${event.delta}`
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
  userRefFiles?: string
  initialNote?: string
}

export interface UseLiveTraceResult {
  liveTurn: ExecutionTurn | null
  isStreaming: boolean
  elapsedSeconds: number
  startLiveTurn: (input: StartLiveTurnInput) => string
  pushEvent: (event: LiveTraceEvent) => void
  flushNow: () => void
  resetLiveTurn: () => void
  simulateLiveRun: (options?: {
    sessionId?: string
    prompt?: string
  }) => void
}

export function useLiveTrace(
  options: UseLiveTraceOptions = {}
): UseLiveTraceResult {
  const { batchWindowMs = FRAME_BATCH_WINDOW_MS, onComplete } = options

  const [liveTurn, setLiveTurn] = React.useState<ExecutionTurn | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)

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
        if (hasComplete && updated && onCompleteRef.current) {
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
      setElapsedSeconds((prev) => {
        const nextSec = prev + 1
        setLiveTurn((curr) =>
          curr?.isLive ? { ...curr, workedDuration: `${nextSec}s` } : curr
        )
        return nextSec
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [isStreaming])

  const startLiveTurn = React.useCallback(
    (input: StartLiveTurnInput): string => {
      clearSimulationTimers()
      const id = `live_turn_${Date.now()}_${sequenceRef.current++}`
      setElapsedSeconds(1)
      const initialTurn: ExecutionTurn = {
        id,
        sessionId: input.sessionId,
        userRefFiles: input.userRefFiles,
        userPrompt: input.userPrompt,
        workedDuration: "1s",
        isLive: true,
        notes: input.initialNote ? [input.initialNote] : [],
        groups: [],
        answerIntro: "",
        answerBullets: [],
        diffCard: EMPTY_DIFF_CARD,
        timestamp: "Just now",
        credits: "0.08 cr",
        kvCachePct: 94,
        pinned: false,
      }
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
    setLiveTurn(null)
    setElapsedSeconds(0)
  }, [clearSimulationTimers])

  const simulateLiveRun = React.useCallback(
    (simOptions?: { sessionId?: string; prompt?: string }) => {
      const sessionId = simOptions?.sessionId ?? "ses_retire_cache"
      const prompt =
        simOptions?.prompt ?? "Re-verify session:: tests and ShardStore routing"
      const uid = startLiveTurn({
        sessionId,
        userPrompt: prompt,
        initialNote:
          "I'll inspect the relevant files in rayucode-v2 and verify the changes with cargo test before reporting back.",
      })

      const schedule = (delayMs: number, fn: () => void) => {
        const handle = setTimeout(fn, delayMs)
        simulationTimersRef.current.push(handle)
      }

      schedule(320, () => {
        pushEvent({
          type: "step",
          groupId: `${uid}_wg`,
          groupTitle: "Read files, ran commands",
          step: {
            id: `${uid}_search`,
            kind: "search",
            text: "Searched for symbols matching request in",
            highlight: "crates/rayucode-core",
          },
        })
      })

      schedule(900, () => {
        pushEvent({
          type: "step",
          groupId: `${uid}_wg`,
          step: {
            id: `${uid}_read`,
            kind: "read",
            label: "Read",
            files: [
              {
                file: "lookup.rs",
                path: "src/session/lookup.rs",
                line: 19,
                rangeLabel: "src/session/lookup.rs:1-64",
              },
            ],
          },
        })
      })

      schedule(1550, () => {
        pushEvent({
          type: "step",
          groupId: `${uid}_wg`,
          step: {
            id: `${uid}_sh`,
            kind: "command",
            command: "cargo test -p rayucode session:: -- --nocapture",
            displayCommand: "cargo test -p rayucode session:: -- --nocapture",
            output:
              "running 14 tests\ntest session::lookup::routes_via_shard_store ... ok\ntest session::budget::preserves_lru_eviction ... ok\ntest result: ok. 14 passed; 0 failed; 0 ignored; finished in 0.42s",
            exitCode: 0,
            statusLabel: "Success",
            isMono: true,
          },
        })
      })

      schedule(2400, () => {
        pushEvent({
          type: "answer-delta",
          delta:
            "**Done.** Checked the local workspace for your request, verified `session::` tests (14/14 passing), and kept the right-sidebar previews in sync.",
        })
        pushEvent({
          type: "bullet",
          bullet: {
            id: `${uid}_b1`,
            title: "Verified ShardStore lookup path.",
            body: "All 14 session unit tests pass with 94% warm KV cache hit rate.",
            citations: [
              {
                label: "src/session/lookup.rs (line 19)",
                kind: "code",
                file: "lookup.rs",
                line: 19,
              },
            ],
          },
        })
        pushEvent({
          type: "complete",
          workedDuration: "3s",
          credits: "0.08 cr",
          kvCachePct: 94,
          timestamp: "Just now",
        })
      })
    },
    [pushEvent, startLiveTurn]
  )

  return {
    liveTurn,
    isStreaming,
    elapsedSeconds,
    startLiveTurn,
    pushEvent,
    flushNow,
    resetLiveTurn,
    simulateLiveRun,
  }
}
