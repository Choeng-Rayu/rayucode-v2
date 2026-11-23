import type {
  ExecutionTurn,
  InlineDiffCardData,
  ModelOption,
  SessionSummary,
  ShellCommandStep,
  TraceStepItem,
} from "./ipc-client"

export interface HarnessSessionInfoLike {
  session_id: string
  working_dir?: string
  title?: string
  status?: string
  agent_label?: string
  edit_stats?: { added: number; removed: number; approximate: boolean }
}

export interface HarnessModelRouteLike {
  model: string
  provider: string
  api_method?: string
  available?: boolean
  detail?: string
}

export interface HarnessHistoryMessageLike {
  role: string
  content: string
  response_stats?: {
    duration_secs?: number
    input_tokens?: number
    output_tokens?: number
    cache_read_tokens?: number
    cache_creation_tokens?: number
    rayu_credits?: number
  }
}

export interface PendingPermissionRequest {
  sessionId: string
  requestId: string
  toolName: string
  description: string
}

export type MappedLiveTraceEvent =
  | { type: "note"; text: string }
  | { type: "step"; groupId?: string; groupTitle?: string; step: TraceStepItem }
  | { type: "answer-delta"; delta: string }
  | { type: "duration"; workedDuration: string }
  | {
      type: "complete"
      workedDuration: string
      credits?: string
      kvCachePct?: number
      timestamp?: string
    }

const EMPTY_DIFF: InlineDiffCardData = {
  id: "diff_live_empty",
  file: "workspace",
  additions: 0,
  deletions: 0,
  hint: "No inline diff attached",
  lines: [],
}

function formatDurationSeconds(secs?: number): string {
  if (!secs || secs <= 0) return "1s"
  if (secs < 60) return `${Math.max(1, Math.round(secs))}s`
  const mins = Math.floor(secs / 60)
  const rem = Math.round(secs % 60)
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
}

function basenameOf(rawPath?: string): string {
  if (!rawPath) return "workspace"
  const parts = rawPath.replace(/\/+$/, "").split(/[\\/]/)
  return parts[parts.length - 1] || "workspace"
}

export function mapSessionInfoToSummary(
  info: HarnessSessionInfoLike
): SessionSummary {
  const title =
    info.title?.trim() || info.agent_label?.trim() || `Session ${info.session_id.slice(0, 8)}`
  return {
    id: info.session_id,
    title,
    project: basenameOf(info.working_dir),
    checkout: info.working_dir ? "Local Checkout" : "Daemon Session",
    branch: "main",
    updatedAt: info.status === "running" ? "Live" : "Active",
    modelId: "claude-opus-5-5",
    modelLabel: "Claude Opus 5.5",
    effort: "Medium",
    permissionMode: "default",
    kvWarmPct: 94,
    creditsUsed: 0,
  }
}

export function mapModelRoutesToOptions(
  routes: HarnessModelRouteLike[]
): ModelOption[] {
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const route of routes) {
    if (!route.model || seen.has(route.model)) continue
    seen.add(route.model)
    out.push({
      id: route.model,
      label: route.model,
      subtitle: route.detail || (route.available ? "Available" : "Configure key"),
      provider: route.provider || "Rayu",
      recommended: route.available === true && out.length < 2,
    })
  }
  return out
}

export function mapHistoryMessagesToTurns(
  sessionId: string,
  messages: HarnessHistoryMessageLike[]
): ExecutionTurn[] {
  const turns: ExecutionTurn[] = []
  let currentUserPrompt: string | null = null
  let assistantChunks: string[] = []
  let toolSteps: TraceStepItem[] = []
  let lastStats: HarnessHistoryMessageLike["response_stats"]

  const flushTurn = () => {
    if (currentUserPrompt === null) return
    const stats = lastStats
    const cacheTotal =
      (stats?.input_tokens ?? 0) + (stats?.cache_read_tokens ?? 0)
    const kvCachePct =
      cacheTotal > 0 && stats?.cache_read_tokens
        ? Math.min(99, Math.round((stats.cache_read_tokens / cacheTotal) * 100))
        : 94
    const credits =
      typeof stats?.rayu_credits === "number"
        ? `${stats.rayu_credits.toFixed(2)} cr`
        : "0.00 cr"

    turns.push({
      id: `hist_${sessionId}_${turns.length + 1}`,
      sessionId,
      userPrompt: currentUserPrompt,
      workedDuration: formatDurationSeconds(stats?.duration_secs),
      notes: [],
      groups:
        toolSteps.length > 0
          ? [
              {
                id: `wg_${turns.length + 1}`,
                title: `Ran ${toolSteps.length} tool${toolSteps.length === 1 ? "" : "s"}`,
                steps: toolSteps,
              },
            ]
          : [],
      answerIntro: assistantChunks.join("\n\n").trim(),
      answerBullets: [],
      diffCard: EMPTY_DIFF,
      timestamp: "History",
      credits,
      kvCachePct,
      pinned: false,
    })
    currentUserPrompt = null
    assistantChunks = []
    toolSteps = []
    lastStats = undefined
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      flushTurn()
      currentUserPrompt = msg.content
    } else if (msg.role === "tool") {
      const step: ShellCommandStep = {
        id: `tool_${turns.length}_${toolSteps.length}`,
        kind: "command",
        command: "tool output",
        displayCommand: "tool execution",
        output: msg.content.slice(0, 1200),
        exitCode: 0,
        statusLabel: "Success",
        isMono: true,
      }
      toolSteps.push(step)
    } else if (msg.role === "assistant") {
      if (msg.content.trim()) {
        assistantChunks.push(msg.content)
      }
      if (msg.response_stats) {
        lastStats = msg.response_stats
      }
    }
  }

  flushTurn()
  return turns
}

export interface HarnessStreamTracker {
  toolInputs: Map<string, string>
  startedAtMs: number
  lastCredits?: string
  lastKvCachePct?: number
}

export function createHarnessStreamTracker(): HarnessStreamTracker {
  return {
    toolInputs: new Map(),
    startedAtMs: Date.now(),
  }
}

export function mapHarnessFrameToLiveEvents(
  frame: Record<string, unknown>,
  tracker: HarnessStreamTracker
): MappedLiveTraceEvent[] {
  const ev = typeof frame.ev === "string" ? frame.ev : ""

  switch (ev) {
    case "text_delta": {
      const text = typeof frame.text === "string" ? frame.text : ""
      return text ? [{ type: "answer-delta", delta: text }] : []
    }
    case "reasoning_done": {
      const secs =
        typeof frame.duration_secs === "number" ? frame.duration_secs : 1
      return [{ type: "duration", workedDuration: formatDurationSeconds(secs) }]
    }
    case "tool_start": {
      const callId = String(frame.call_id ?? "")
      const name = String(frame.name ?? "tool")
      if (callId) tracker.toolInputs.set(callId, "")
      return [{ type: "note", text: `Running ${name}...` }]
    }
    case "tool_input_delta": {
      const callId = String(frame.call_id ?? "")
      const delta = typeof frame.delta === "string" ? frame.delta : ""
      if (callId && delta) {
        tracker.toolInputs.set(
          callId,
          `${tracker.toolInputs.get(callId) ?? ""}${delta}`
        )
      }
      return []
    }
    case "tool_call": {
      const callId = String(frame.call_id ?? "")
      if (callId && frame.input !== undefined) {
        const serialized =
          typeof frame.input === "string"
            ? frame.input
            : JSON.stringify(frame.input)
        tracker.toolInputs.set(callId, serialized)
      }
      return []
    }
    case "tool_done": {
      const callId = String(frame.call_id ?? `call_${Date.now()}`)
      const name = String(frame.name ?? "tool")
      const output = typeof frame.output === "string" ? frame.output : ""
      const error = typeof frame.error === "string" ? frame.error : undefined
      const rawInput = tracker.toolInputs.get(callId) ?? ""
      let displayCommand = name
      if (rawInput) {
        try {
          const parsed = JSON.parse(rawInput) as Record<string, unknown>
          if (typeof parsed.command === "string") {
            displayCommand = parsed.command
          } else if (typeof parsed.path === "string") {
            displayCommand = `${name} ${parsed.path}`
          }
        } catch {
          displayCommand = `${name} ${rawInput.slice(0, 80)}`.trim()
        }
      }
      const step: ShellCommandStep = {
        id: callId,
        kind: "command",
        command: displayCommand,
        displayCommand,
        output: (error ?? output).slice(0, 2400) || "(no output)",
        exitCode: error ? 1 : 0,
        statusLabel: error ? "Failed" : "Success",
        isFailed: Boolean(error),
        isMono: true,
      }
      return [
        {
          type: "step",
          groupId: "live_harness_tools",
          groupTitle: "Ran tools via rayu daemon",
          step,
        },
      ]
    }
    case "token_usage": {
      const input = typeof frame.input === "number" ? frame.input : 0
      const cacheRead =
        typeof frame.cache_read_input === "number" ? frame.cache_read_input : 0
      const total = input + cacheRead
      if (total > 0) {
        tracker.lastKvCachePct = Math.min(
          99,
          Math.round((cacheRead / total) * 100)
        )
      }
      return []
    }
    case "rayu_credits": {
      const turnCredits =
        typeof frame.turn_credits === "number" ? frame.turn_credits : undefined
      if (turnCredits !== undefined) {
        tracker.lastCredits = `${turnCredits.toFixed(2)} cr`
      }
      return []
    }
    case "turn_done":
    case "turn_stopped": {
      const elapsedSec = Math.max(
        1,
        Math.round((Date.now() - tracker.startedAtMs) / 1000)
      )
      return [
        {
          type: "complete",
          workedDuration: formatDurationSeconds(elapsedSec),
          credits: tracker.lastCredits,
          kvCachePct: tracker.lastKvCachePct,
          timestamp: "Just now",
        },
      ]
    }
    default:
      return []
  }
}
