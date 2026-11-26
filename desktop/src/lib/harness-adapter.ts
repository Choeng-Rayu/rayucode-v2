import {
  filterVisibleHistory,
  formatDaemonVersionLabel,
  settleHarnessErrorFrame,
} from "@rayu-dev/rayucode-session-core/client"

import type {
  ExecutionTurn,
  FileChangeEntrySummary,
  FileChangeHunk,
  FileChangeKind,
  FileChangesSnapshot,
  FileChangeStatus,
  FileReadStep,
  HiddenInternalMessage,
  InlineDiffCardData,
  ListStep,
  MessageOrigin,
  MessageVisibility,
  ModelOption,
  SessionSummary,
  ShellCommandStep,
  TraceStepItem,
  TurnAttempt,
  TurnAttemptReason,
  TurnOutcome,
  TurnOutputArtifact,
} from "./ipc-client"

export { formatDaemonVersionLabel }

export interface HarnessSessionInfoLike {
  session_id: string
  working_dir?: string
  title?: string
  status?: string
  agent_label?: string
  edit_stats?: { added: number; removed: number; approximate: boolean }
  updated_at_ms?: number
  last_active_at_ms?: number
  saved?: boolean
  archived?: boolean
  archived_at_ms?: number
  source?: string
  external_session_id?: string
  external_path?: string
  external_project_name?: string
  imported?: boolean
  sync_stale?: boolean
}

export function isTempDirectoryPath(raw?: string | null): boolean {
  if (!raw) return false
  const normalized = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalized) return false
  const lower = normalized.toLowerCase()
  if (
    lower === "/tmp" ||
    lower.startsWith("/tmp/") ||
    lower === "/private/tmp" ||
    lower.startsWith("/private/tmp/") ||
    lower === "/var/tmp" ||
    lower.startsWith("/var/tmp/") ||
    lower === "/private/var/tmp" ||
    lower.startsWith("/private/var/tmp/") ||
    lower === "/var/folders" ||
    lower.startsWith("/var/folders/") ||
    lower === "/private/var/folders" ||
    lower.startsWith("/private/var/folders/")
  ) {
    return true
  }
  if (/^[a-z]:\/(temp|tmp)(\/|$)/.test(lower)) return true
  if (/\/appdata\/local\/temp(\/|$)/.test(lower)) return true
  return false
}

export function formatRelativeTimestamp(
  ms?: number | null,
  fallback = "Now"
): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return fallback
  }
  const diffMs = Math.max(0, Date.now() - ms)
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "Now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  return `${weeks}w`
}

export interface HarnessModelRouteLike {
  model: string
  provider: string
  api_method?: string
  available?: boolean
  detail?: string
  supported_efforts?: string[]
  default_effort?: string
  context_window?: number
}

export interface HarnessHistoryMessageLike {
  role: string
  content: string
  origin?: MessageOrigin
  visibility?: MessageVisibility
  attempt_id?: string | null
  attempt_reason?: TurnAttemptReason
  attempt_status?: TurnOutcome
  stop_reason?: string | null
  tool?: {
    id?: string
    name?: string
    input?: unknown
  } | null
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
  | { type: "reasoning-delta"; delta: string }
  | { type: "note"; text: string }
  | { type: "promote-note" }
  | { type: "tool-status"; label: string | null }
  | { type: "step"; groupId?: string; groupTitle?: string; step: TraceStepItem }
  | { type: "artifact"; artifact: TurnOutputArtifact }
  | {
      type: "permission-request"
      sessionId: string
      requestId: string
      toolName: string
      description: string
    }
  | { type: "file-changes"; snapshot: FileChangesSnapshot }
  | { type: "answer-delta"; delta: string }
  | { type: "text-done"; stopReason?: string }
  | {
      type: "model-info"
      sessionId: string
      model?: string
      provider?: string
      reasoningEffort?: string
    }
  | {
      type: "permission-mode-changed"
      sessionId: string
      mode: string
    }
  | {
      type: "config-changed"
      changedKeys: string[]
      requiresRestart: boolean
      values: Record<string, unknown>
    }
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

export function formatDurationSeconds(secs?: number): string {
  if (!secs || !Number.isFinite(secs) || secs <= 0) return "1s"
  const totalSec = Math.max(1, Math.round(secs))
  if (totalSec < 60) return `${totalSec}s`
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const rem = totalSec % 60
  if (hours > 0) {
    if (rem > 0) return `${hours}h ${mins}m ${rem}s`
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
}

function basenameOf(rawPath?: string): string {
  if (!rawPath) return "workspace"
  const parts = rawPath.replace(/\/+$/, "").split(/[\\/]/)
  return parts[parts.length - 1] || "workspace"
}

function parseToolArgs(
  rawInput: unknown,
  fallbackJson = ""
): Record<string, unknown> {
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>
  }
  const str = typeof rawInput === "string" ? rawInput : fallbackJson
  if (!str.trim()) return {}
  try {
    const parsed = JSON.parse(str) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore malformed json
  }
  return {}
}

function describeActiveTool(
  name: string,
  args: Record<string, unknown>
): string {
  const intent =
    typeof args.intent === "string" && args.intent.trim()
      ? args.intent.trim()
      : ""
  if (intent) {
    return intent.endsWith("...") ? intent : `${intent}...`
  }
  const lower = name.toLowerCase()
  if (lower === "batch") {
    const calls = Array.isArray(args.tool_calls) ? args.tool_calls : []
    if (calls.length > 0) {
      const first = calls[0] as Record<string, unknown> | undefined
      const firstIntent =
        typeof first?.intent === "string" && first.intent.trim()
          ? first.intent.trim()
          : ""
      if (firstIntent) {
        return firstIntent.endsWith("...") ? firstIntent : `${firstIntent}...`
      }
      return calls.length === 1
        ? "Inspecting workspace..."
        : `Running ${calls.length} parallel checks...`
    }
    return "Inspecting workspace..."
  }
  if (lower === "read_file" || lower === "read") {
    const p =
      typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
          ? args.file_path
          : ""
    return p ? `Reading ${basenameOf(p)}...` : "Reading files..."
  }
  if (lower === "list_files" || lower === "ls" || lower === "listdir") {
    const d =
      typeof args.directory === "string"
        ? args.directory
        : typeof args.path === "string"
          ? args.path
          : ""
    return d && d !== "." ? `Listing files in ${d}...` : "Listing files..."
  }
  if (
    lower === "search_files" ||
    lower === "grep" ||
    lower === "rg" ||
    lower === "agentgrep" ||
    lower === "glob" ||
    lower === "find_files"
  ) {
    const q =
      typeof args.query === "string"
        ? args.query
        : typeof args.pattern === "string"
          ? args.pattern
          : ""
    return q ? `Searching for "${q}"...` : "Searching files..."
  }
  if (lower === "run_command" || lower === "bash" || lower === "shell") {
    return "Running command..."
  }
  if (lower === "edit" || lower === "write" || lower === "apply_patch") {
    const p =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.path === "string"
          ? args.path
          : ""
    return p ? `Updating ${basenameOf(p)}...` : "Updating files..."
  }
  if (lower === "webfetch" || lower === "websearch") {
    return lower === "websearch" ? "Searching web..." : "Fetching page..."
  }
  if (lower === "todo" || lower === "todowrite") {
    return "Updating plan..."
  }
  if (lower === "create_powerpoint") {
    const title = typeof args.title === "string" ? args.title.trim() : ""
    return title ? `Building presentation "${title}"...` : "Building presentation..."
  }
  if (lower === "write_excel") {
    const p =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.filePath === "string"
          ? args.filePath
          : ""
    return p ? `Writing ${basenameOf(p)}...` : "Writing spreadsheet..."
  }
  if (lower === "read_excel") {
    const p =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.filePath === "string"
          ? args.filePath
          : ""
    return p ? `Reading ${basenameOf(p)}...` : "Reading spreadsheet..."
  }
  if (lower.startsWith("browser_")) {
    if (lower === "browser_navigate") {
      const url = typeof args.url === "string" ? args.url.trim() : ""
      return url ? `Opening ${url}...` : "Navigating browser..."
    }
    if (lower === "browser_snapshot") {
      return "Inspecting browser page..."
    }
    return "Using the browser..."
  }
  if (lower === "list_templates") {
    return "Checking templates..."
  }
  if (lower === "save_template") {
    return "Saving template..."
  }
  return `Using ${name}...`
}

export function mapSessionInfoToSummary(
  info: HarnessSessionInfoLike
): SessionSummary {
  const title =
    info.title?.trim() ||
    info.agent_label?.trim() ||
    `Session ${info.session_id.slice(0, 8)}`
  const updatedAtMs =
    typeof info.last_active_at_ms === "number" && info.last_active_at_ms > 0
      ? info.last_active_at_ms
      : typeof info.updated_at_ms === "number" && info.updated_at_ms > 0
        ? info.updated_at_ms
        : undefined
  const fallbackLabel = info.status === "running" ? "Live" : "Active"
  return {
    id: info.session_id,
    title,
    project: basenameOf(info.working_dir),
    workingDir: info.working_dir,
    checkout: info.working_dir ? "Local Checkout" : "Daemon Session",
    branch: "main",
    updatedAt:
      info.status === "running"
        ? "Live"
        : formatRelativeTimestamp(updatedAtMs, fallbackLabel),
    updatedAtMs,
    status: info.status,
    connection: "local",
    saved: Boolean(info.saved),
    archived: Boolean(info.archived),
    source: info.source ?? "rayu",
    externalSessionId: info.external_session_id,
    externalPath: info.external_path,
    externalProjectName: info.external_project_name,
    imported: info.imported,
    syncStale: info.sync_stale,
    modelId: "claude-opus-5-5",
    modelLabel: "Claude Opus 5.5",
    effort: "Medium",
    permissionMode: "default",
    kvWarmPct: 94,
    creditsUsed: 0,
  }
}

export function formatHarnessModelSpec(
  modelId: string,
  provider?: string,
  apiMethod?: string
): string {
  const trimmed = modelId.trim()
  if (!trimmed || trimmed === "default") return ""
  if (trimmed.includes(":")) return trimmed
  const normalizedApi = apiMethod?.trim().toLowerCase() ?? ""
  const normalizedProvider = provider?.trim().toLowerCase() ?? ""
  if (normalizedApi === "rayu" || normalizedProvider === "rayu") {
    return `rayu:${trimmed}`
  }
  return trimmed
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
      label: route.model.replace(/^rayu:/i, "") || route.model,
      subtitle:
        route.detail || (route.available ? "Available" : "Configure key"),
      provider: route.provider || "Rayu",
      apiMethod: route.api_method,
      recommended: route.available === true && out.length < 2,
      ...(route.available === false ? { available: false } : {}),
      ...(route.available === false && route.detail
        ? { unavailableReason: route.detail }
        : {}),
      ...(Array.isArray(route.supported_efforts)
        ? { supportedEfforts: route.supported_efforts }
        : {}),
      ...(typeof route.default_effort === "string"
        ? { defaultEffort: route.default_effort }
        : {}),
      ...(typeof route.context_window === "number"
        ? { contextWindow: route.context_window }
        : {}),
    })
  }
  return out
}

const REASONING_SENTINEL = "\u{2063}"
const REASONING_LINE_RE = new RegExp(
  `^\\*${REASONING_SENTINEL}([\\s\\S]*)${REASONING_SENTINEL}\\*[ \\t]*$`
)

function splitReasoningFromAssistantContent(raw: string): {
  reasoningNotes: string[]
  answerText: string
} {
  if (!raw.includes(REASONING_SENTINEL)) {
    return { reasoningNotes: [], answerText: raw }
  }
  const reasoningNotes: string[] = []
  const answerLines: string[] = []
  let paragraphLines: string[] = []
  let sawReasoning = false

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    const text = paragraphLines.join("\n").trim()
    if (text) reasoningNotes.push(text)
    paragraphLines = []
  }

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    const match = REASONING_LINE_RE.exec(line)
    if (match) {
      const unescaped = match[1].replace(/\\([\\*_`[\]<>&~|$])/g, "$1")
      if (unescaped.trim().length > 0) {
        paragraphLines.push(unescaped)
      }
      sawReasoning = true
      continue
    }
    if (sawReasoning && line.trim() === "") {
      flushParagraph()
      sawReasoning = false
      continue
    }
    flushParagraph()
    sawReasoning = false
    answerLines.push(line)
  }
  flushParagraph()

  return {
    reasoningNotes,
    answerText: answerLines.join("\n").trim(),
  }
}

function summarizeNotificationLine(trimmed: string): string {
  const firstLine = (trimmed.split("\n")[0] ?? trimmed)
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return firstLine.slice(0, 140) || "Notification"
}

function classifySyntheticUserMessage(
  content: string
): { groupTitle: string; command: string; output: string } | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  const importedMatch = trimmed.match(
    /^\[Imported tool result:[^\]]*\]\s*(.*)$/is
  )
  if (importedMatch) {
    const summary = importedMatch[1]?.trim() || "Imported tool result"
    const skillMatch = summary.match(/Launching skill:\s*(.+)$/i)
    return {
      groupTitle: skillMatch ? `Loaded skill ${skillMatch[1].trim()}` : "Tool result",
      command: summary.slice(0, 140),
      output: trimmed.slice(0, 1200),
    }
  }

  const skillDirMatch = trimmed.match(/^Base directory for this skill:\s*([^\n]+)/i)
  if (skillDirMatch) {
    const dirPath = skillDirMatch[1].trim()
    const skillName = basenameOf(dirPath)
    return {
      groupTitle: `Loaded skill instructions (${skillName})`,
      command: `Skill: ${skillName} (${dirPath})`,
      output: trimmed.slice(0, 1600),
    }
  }

  if (
    /^\*\*Background task(?:\s+(?:started|progress|stalled))?\*\*/i.test(
      trimmed
    )
  ) {
    return {
      groupTitle: "Background task",
      command: summarizeNotificationLine(trimmed),
      output: trimmed.slice(0, 1200),
    }
  }

  if (/^(?:\u{1F41D}\s*)?\*\*Swarm\b/iu.test(trimmed)) {
    return {
      groupTitle: "Swarm update",
      command: summarizeNotificationLine(trimmed),
      output: trimmed.slice(0, 1200),
    }
  }

  if (/^\[Scheduled task\]/i.test(trimmed)) {
    return {
      groupTitle: "Scheduled task",
      command: summarizeNotificationLine(trimmed),
      output: trimmed.slice(0, 1200),
    }
  }

  if (
    /^<(?:system-reminder|command-message|local-command-stdout|local-command-caveat)\b/i.test(
      trimmed
    )
  ) {
    return {
      groupTitle: "System context",
      command: "Injected context",
      output: trimmed.slice(0, 1200),
    }
  }

  return null
}

const ENGINE_INTERNAL_RECOVERY_PREFIXES = [
  "Reassess the user's request using its full context and likely intent rather than isolated keywords.",
  "Review the request again and distinguish legitimate coding, debugging, defensive, educational, or analytical work",
  "Perform one final, independent policy check. Prefer a safe and useful constrained response when possible.",
  "[System reminder: your previous response ended ",
  "[Attached image associated with the preceding tool result:",
] as const

function isEngineInternalRecoveryPrompt(content: string): boolean {
  const trimmed = content.trimStart()
  if (/^You have \d+ incomplete todos?\b/i.test(trimmed)) {
    return true
  }
  return ENGINE_INTERNAL_RECOVERY_PREFIXES.some((prefix) =>
    trimmed.startsWith(prefix)
  )
}

function isSyntheticReasoningPlaceholder(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  return /^reasoning via rayu cloud\b/i.test(trimmed)
}

function isJsonLikeText(text: string): boolean {
  const trimmed = text.trim()
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  )
}

function humanizeToolName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/^(?:mcp_|tool_|rayu_)/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
  if (!cleaned) return "Ran tool"
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function extractReadableFileFromShell(rawCommand: string): string | null {
  const tokens = rawCommand.split(/\s+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 1; i -= 1) {
    const token = tokens[i]!.replace(/^['"]|['"]$/g, "")
    if (
      token.startsWith("-") ||
      token.includes("|") ||
      token.includes(">") ||
      token.includes("<") ||
      token === "." ||
      token === "./" ||
      token === ".." ||
      token.startsWith("/dev/")
    ) {
      continue
    }
    if (/[./]/.test(token) && /\.[a-z0-9]{1,8}$/i.test(token)) {
      return basenameOf(token)
    }
  }
  return null
}

function summarizeShellCommandLabel(rawCommand: string): string {
  const trimmed = rawCommand.trim()
  if (!trimmed) return "Ran command"
  const firstSegment = trimmed.split(/[|;&\n]/)[0]?.trim() ?? trimmed
  const lower = firstSegment.toLowerCase()

  if (/^git\s+status\b/.test(lower)) return "Checked git status"
  if (/^git\s+diff\b/.test(lower)) return "Inspected git diff"
  if (/^git\s+log\b/.test(lower)) return "Checked git history"
  if (/^git\s+branch\b/.test(lower)) return "Checked git branches"
  if (/^git\s+/.test(lower)) return "Ran git command"

  if (
    /\b(?:cargo\s+test|npm\s+test|pnpm\s+test|yarn\s+test|vitest|jest|pytest|go\s+test)\b/.test(
      lower
    ) ||
    /\b(?:npm|pnpm|yarn)\s+run\s+test\b/.test(lower)
  ) {
    return "Ran tests"
  }
  if (
    /\b(?:cargo\s+(?:build|check)|tsc\b|(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|typecheck|verify))\b/.test(
      lower
    )
  ) {
    return "Built and verified project"
  }
  if (
    /\b(?:eslint|clippy|(?:npm|pnpm|yarn)\s+(?:run\s+)?lint)\b/.test(lower)
  ) {
    return "Ran linter"
  }
  if (/^(?:grep|rg|ag|ack)\b/.test(lower)) return "Searched codebase"
  if (/^(?:sed|cat|head|tail|awk|nl|bat)\b/.test(lower)) {
    const file = extractReadableFileFromShell(firstSegment)
    return file ? `Inspected ${file}` : "Inspected file"
  }
  if (/^(?:ls|find|tree|fd)\b/.test(lower)) return "Listed directory"
  if (/^(?:mkdir|rm|mv|cp|touch)\b/.test(lower)) return "Updated workspace files"

  return "Ran shell command"
}

function summarizeToolAction(
  name: string,
  args: Record<string, unknown> | null,
  explicitIntent?: string
): string {
  const argIntent =
    args && typeof args.intent === "string" && args.intent.trim()
      ? args.intent.trim()
      : ""
  const effectiveIntent =
    (explicitIntent && explicitIntent.trim()) || argIntent
  if (effectiveIntent && !isJsonLikeText(effectiveIntent)) {
    return effectiveIntent.length > 90
      ? `${effectiveIntent.slice(0, 87)}...`
      : effectiveIntent
  }

  const lower = name.trim().toLowerCase()
  if (lower === "run_command" || lower === "bash" || lower === "shell") {
    const rawCmd =
      args && typeof args.command === "string" ? args.command.trim() : ""
    return rawCmd ? summarizeShellCommandLabel(rawCmd) : "Ran shell command"
  }
  if (lower === "read_file" || lower === "read") {
    const target =
      args && typeof args.path === "string"
        ? args.path
        : args && typeof args.file_path === "string"
          ? args.file_path
          : ""
    return target ? `Read ${basenameOf(target)}` : "Read file"
  }
  if (
    lower === "edit" ||
    lower === "edit_file" ||
    lower === "write" ||
    lower === "write_file" ||
    lower === "apply_patch"
  ) {
    const target =
      args && typeof args.file_path === "string"
        ? args.file_path
        : args && typeof args.path === "string"
          ? args.path
          : ""
    const verb = lower === "write" || lower === "write_file" ? "Wrote" : "Edited"
    return target ? `${verb} ${basenameOf(target)}` : `${verb} file`
  }
  if (
    lower === "search_files" ||
    lower === "grep" ||
    lower === "rg" ||
    lower === "agentgrep" ||
    lower === "glob" ||
    lower === "find_files"
  ) {
    return "Searched workspace"
  }
  if (lower === "list_files" || lower === "ls" || lower === "listdir") {
    return "Listed files"
  }
  return humanizeToolName(name)
}

function summarizeHistoryToolCall(
  tool: HarnessHistoryMessageLike["tool"]
): { command: string; displayCommand: string } {
  if (!tool?.name) {
    return { command: "Tool step", displayCommand: "Tool step" }
  }
  const input =
    tool.input && typeof tool.input === "object" && !Array.isArray(tool.input)
      ? (tool.input as Record<string, unknown>)
      : null
  const label = summarizeToolAction(tool.name, input)
  return { command: label, displayCommand: label }
}

function resolveAttemptStatus(
  trimmedText: string,
  explicitStatus?: TurnOutcome,
  stopReason?: string | null
): TurnOutcome {
  const isRefusal =
    typeof stopReason === "string" &&
    /(refusal|content_filter|safety|guardrail|policy_violation)/i.test(
      stopReason
    )
  if (explicitStatus) {
    if (explicitStatus === "answered" && trimmedText.length === 0) {
      return isRefusal ? "declined" : "failed"
    }
    return explicitStatus
  }
  if (isRefusal) return "declined"
  return trimmedText.length > 0 ? "answered" : "failed"
}

export function mapHistoryMessagesToTurns(
  sessionId: string,
  messages: HarnessHistoryMessageLike[]
): ExecutionTurn[] {
  const turns: ExecutionTurn[] = []
  let currentUserPrompt: string | null = null
  let assistantChunks: string[] = []
  let workNotes: string[] = []
  let toolSteps: TraceStepItem[] = []
  let lastStats: HarnessHistoryMessageLike["response_stats"]
  let attempts: TurnAttempt[] = []
  let attemptIndexById = new Map<string, number>()
  let hasExplicitAttemptMeta = false
  let hiddenInternalMessages: HiddenInternalMessage[] = []

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
    const finalAttempt =
      attempts.length > 0 ? attempts[attempts.length - 1] : null
    const finalAttemptId = finalAttempt ? finalAttempt.id : null
    const latestAnsweredAttempt = [...attempts]
      .reverse()
      .find((attempt) => attempt.answerText.trim().length > 0)
    const answerIntro =
      finalAttempt?.answerText.trim() ||
      latestAnsweredAttempt?.answerText.trim() ||
      assistantChunks.join("\n\n").trim()
    const outcome: TurnOutcome | undefined = finalAttempt
      ? finalAttempt.answerText.trim().length > 0
        ? finalAttempt.status === "answered_partial"
          ? "answered_partial"
          : "answered"
        : finalAttempt.status === "answered"
          ? "failed"
          : finalAttempt.status
      : undefined

    turns.push({
      id: `hist_${sessionId}_${turns.length + 1}`,
      sessionId,
      userPrompt: currentUserPrompt,
      workedDuration: formatDurationSeconds(stats?.duration_secs),
      notes: workNotes,
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
      answerIntro,
      answerBullets: [],
      diffCard: EMPTY_DIFF,
      timestamp: "History",
      credits,
      kvCachePct,
      pinned: false,
      ...(outcome ? { outcome } : {}),
      ...(attempts.length > 0 ? { attempts, finalAttemptId } : {}),
      ...(hiddenInternalMessages.length > 0
        ? { hiddenInternalMessages }
        : {}),
    })
    currentUserPrompt = null
    assistantChunks = []
    workNotes = []
    toolSteps = []
    lastStats = undefined
    attempts = []
    attemptIndexById = new Map()
    hasExplicitAttemptMeta = false
    hiddenInternalMessages = []
  }

  const visibleMessages = new Set(filterVisibleHistory(messages))

  for (const msg of messages) {
    if (!visibleMessages.has(msg)) {
      if (msg.role === "user") {
        hiddenInternalMessages.push({
          origin: msg.origin ?? "engine_internal",
          visibility: msg.visibility ?? "hidden",
          content: msg.content,
        })
      }
      continue
    }
    if (msg.role === "user") {
      if (isEngineInternalRecoveryPrompt(msg.content)) {
        hiddenInternalMessages.push({
          origin: "engine_internal",
          visibility: "hidden",
          content: msg.content,
        })
        continue
      }
      const synthetic = classifySyntheticUserMessage(msg.content)
      if (synthetic) {
        const step: ShellCommandStep = {
          id: `tool_${turns.length}_${toolSteps.length}`,
          kind: "command",
          command: synthetic.command,
          displayCommand: synthetic.command,
          output: synthetic.output,
          exitCode: 0,
          statusLabel: "Loaded",
          isMono: false,
        }
        if (currentUserPrompt !== null) {
          toolSteps.push(step)
        } else if (turns.length > 0) {
          const prevTurn = turns[turns.length - 1]
          if (prevTurn.groups.length > 0) {
            prevTurn.groups[0].steps.push(step)
          } else {
            prevTurn.groups.push({
              id: `wg_${turns.length}`,
              title: synthetic.groupTitle,
              steps: [step],
            })
          }
        } else {
          currentUserPrompt = synthetic.groupTitle
          toolSteps.push(step)
        }
        continue
      }
      flushTurn()
      currentUserPrompt = msg.content
    } else if (msg.role === "tool") {
      if (assistantChunks.length > 0 && !hasExplicitAttemptMeta) {
        for (const chunk of assistantChunks) {
          const clean = chunk.trim()
          if (clean) workNotes.push(clean)
        }
        assistantChunks = []
        attempts = []
        attemptIndexById = new Map()
      }
      const summary = summarizeHistoryToolCall(msg.tool)
      const step: ShellCommandStep = {
        id: `tool_${turns.length}_${toolSteps.length}`,
        kind: "command",
        command: summary.command,
        displayCommand: summary.displayCommand,
        output: msg.content.slice(0, 1200),
        exitCode: 0,
        statusLabel: "Success",
        isMono: false,
      }
      toolSteps.push(step)
    } else if (msg.role === "assistant") {
      const { reasoningNotes, answerText } = splitReasoningFromAssistantContent(
        msg.content
      )
      for (const note of reasoningNotes) {
        workNotes.push(note)
      }
      const trimmed = answerText.trim()
      if (trimmed) {
        assistantChunks.push(answerText)
      }
      const hasExplicitAttempt =
        msg.attempt_id != null ||
        msg.attempt_status !== undefined ||
        msg.stop_reason != null
      if (hasExplicitAttempt) {
        hasExplicitAttemptMeta = true
      }
      if (trimmed.length > 0 || hasExplicitAttempt) {
        const attemptId =
          msg.attempt_id ??
          (hasExplicitAttempt ? `att_${attempts.length + 1}` : "att_1")
        const existingIdx = attemptIndexById.get(attemptId)
        if (existingIdx !== undefined) {
          const existing = attempts[existingIdx]
          const combinedText = [existing.answerText, trimmed]
            .filter(Boolean)
            .join("\n\n")
          attempts[existingIdx] = {
            ...existing,
            reason: msg.attempt_reason ?? existing.reason,
            answerText: combinedText,
            stopReason: msg.stop_reason ?? existing.stopReason,
            status: resolveAttemptStatus(
              combinedText,
              msg.attempt_status ??
                (combinedText.length > 0 ? existing.status : undefined),
              msg.stop_reason ?? existing.stopReason
            ),
          }
        } else {
          attemptIndexById.set(attemptId, attempts.length)
          attempts.push({
            id: attemptId,
            reason:
              msg.attempt_reason ??
              (attempts.length === 0 ? "initial" : "reassess_refusal"),
            status: resolveAttemptStatus(
              trimmed,
              msg.attempt_status,
              msg.stop_reason
            ),
            answerText: trimmed,
            ...(msg.stop_reason !== undefined
              ? { stopReason: msg.stop_reason }
              : {}),
          })
        }
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
  turnActive: boolean
  turnCompleted?: boolean
  batchEpoch: number
  hasStreamedTextInPhase: boolean
  phaseHasReads: boolean
  phaseHasCommands: boolean
  phaseHasSearches: boolean
  phaseCommandCount: number
  lastCredits?: string
  lastKvCachePct?: number
}

export function createHarnessStreamTracker(): HarnessStreamTracker {
  return {
    toolInputs: new Map(),
    startedAtMs: Date.now(),
    turnActive: false,
    turnCompleted: false,
    batchEpoch: 1,
    hasStreamedTextInPhase: false,
    phaseHasReads: false,
    phaseHasCommands: false,
    phaseHasSearches: false,
    phaseCommandCount: 0,
  }
}

function resetTrackerPhase(tracker: HarnessStreamTracker): void {
  tracker.phaseHasReads = false
  tracker.phaseHasCommands = false
  tracker.phaseHasSearches = false
  tracker.phaseCommandCount = 0
}

function computePhaseGroupTitle(tracker: HarnessStreamTracker): string {
  const hasReadOrSearch = tracker.phaseHasReads || tracker.phaseHasSearches
  if (hasReadOrSearch && tracker.phaseHasCommands) {
    return "Read files, ran commands"
  }
  if (tracker.phaseHasReads) {
    return "Read files"
  }
  if (tracker.phaseHasSearches) {
    return "Searched files"
  }
  if (tracker.phaseHasCommands) {
    return tracker.phaseCommandCount > 1 ? "Ran commands" : "Ran a command"
  }
  return "Read files, ran commands"
}

interface ParsedBatchOutputSection {
  index: number
  tool: string
  output: string
  isError: boolean
}

function splitBatchOutputSections(rawOutput: string): ParsedBatchOutputSection[] {
  if (!rawOutput.trim()) return []
  const cleaned = rawOutput.replace(/^\[batch timing:[^\]]*\]\s*/i, "")
  const headerRegex = /---\s*\[(\d+)\]\s*([^\n-]+?)\s*---/g
  const matches: Array<{
    index: number
    tool: string
    start: number
    contentStart: number
  }> = []
  let m: RegExpExecArray | null
  while ((m = headerRegex.exec(cleaned)) !== null) {
    matches.push({
      index: Number.parseInt(m[1], 10),
      tool: m[2].trim(),
      start: m.index,
      contentStart: m.index + m[0].length,
    })
  }
  if (matches.length === 0) return []
  return matches.map((cur, idx) => {
    const end = idx + 1 < matches.length ? matches[idx + 1].start : cleaned.length
    const sectionText = cleaned.slice(cur.contentStart, end).trim()
    return {
      index: cur.index,
      tool: cur.tool,
      output: sectionText,
      isError: /^error:/i.test(sectionText),
    }
  })
}

function extractBatchSubcallArgs(entry: Record<string, unknown>): {
  tool: string
  args: Record<string, unknown>
} {
  const tool =
    typeof entry.tool === "string" && entry.tool.trim()
      ? entry.tool.trim()
      : typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : typeof entry.tool_name === "string" && entry.tool_name.trim()
          ? entry.tool_name.trim()
          : "tool"
  const nested =
    (entry.parameters && typeof entry.parameters === "object"
      ? (entry.parameters as Record<string, unknown>)
      : null) ??
    (entry.arguments && typeof entry.arguments === "object"
      ? (entry.arguments as Record<string, unknown>)
      : null) ??
    (entry.args && typeof entry.args === "object"
      ? (entry.args as Record<string, unknown>)
      : null) ??
    (entry.input && typeof entry.input === "object"
      ? (entry.input as Record<string, unknown>)
      : null)

  const merged: Record<string, unknown> = { ...(nested ?? {}) }
  for (const [k, v] of Object.entries(entry)) {
    if (
      k === "tool" ||
      k === "name" ||
      k === "tool_name" ||
      k === "parameters" ||
      k === "arguments" ||
      k === "args" ||
      k === "input"
    ) {
      continue
    }
    if (merged[k] === undefined) {
      merged[k] = v
    }
  }
  return { tool, args: merged }
}

function mapSingleWorkStep(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  output: string,
  error: string | undefined,
  tracker: HarnessStreamTracker
): TraceStepItem {
  const lower = name.toLowerCase()
  const intent =
    typeof args.intent === "string" && args.intent.trim()
      ? args.intent.trim()
      : ""

  if (lower === "read_file" || lower === "read") {
    tracker.phaseHasReads = true
    const relPath =
      typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
          ? args.file_path
          : "file"
    const startLine =
      typeof args.start_line === "number"
        ? args.start_line
        : typeof args.offset === "number"
          ? args.offset
          : 1
    const endLine = typeof args.end_line === "number" ? args.end_line : null
    const displayLabel = endLine
      ? `${relPath}:${startLine}-${endLine}`
      : relPath
    const fileStep: FileReadStep = {
      id: callId,
      kind: "read",
      label: "Read",
      files: [
        {
          file: basenameOf(relPath),
          path: relPath,
          line: startLine,
          rangeLabel: displayLabel,
        },
      ],
    }
    return fileStep
  }

  if (lower === "edit" || lower === "write" || lower === "apply_patch") {
    tracker.phaseHasReads = true
    const relPath =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.path === "string"
          ? args.path
          : "file"
    const fileStep: FileReadStep = {
      id: callId,
      kind: "read",
      label: lower === "write" ? "Wrote" : "Edited",
      files: [
        {
          file: basenameOf(relPath),
          path: relPath,
          line: 1,
          rangeLabel: relPath,
        },
      ],
    }
    return fileStep
  }

  if (lower === "list_files" || lower === "ls" || lower === "listdir") {
    tracker.phaseHasReads = true
    const rawDir =
      typeof args.directory === "string"
        ? args.directory.trim()
        : typeof args.path === "string"
          ? args.path.trim()
          : ""
    const hasSubdir = Boolean(rawDir && rawDir !== "." && rawDir !== "./")
    const listStep: ListStep = {
      id: callId,
      kind: "list",
      text: hasSubdir ? "Listed files in" : "Listed files",
      ...(hasSubdir ? { highlight: rawDir } : {}),
    }
    return listStep
  }

  if (
    lower === "search_files" ||
    lower === "grep" ||
    lower === "rg" ||
    lower === "agentgrep" ||
    lower === "glob" ||
    lower === "find_files"
  ) {
    tracker.phaseHasSearches = true
    const query =
      typeof args.query === "string"
        ? args.query
        : typeof args.pattern === "string"
          ? args.pattern
          : "workspace"
    const searchStep: ListStep = {
      id: callId,
      kind: "search",
      text: lower === "glob" || lower === "find_files" ? "Found files matching" : "Searched for",
      highlight: query,
    }
    return searchStep
  }

  if (lower === "webfetch" || lower === "websearch") {
    tracker.phaseHasSearches = true
    const target =
      typeof args.url === "string"
        ? args.url
        : typeof args.query === "string"
          ? args.query
          : name
    const webStep: ListStep = {
      id: callId,
      kind: "search",
      text: lower === "websearch" ? "Searched web for" : "Fetched",
      highlight: target,
    }
    return webStep
  }

  if (lower === "todo" || lower === "todowrite") {
    tracker.phaseHasReads = true
    const todoStep: ListStep = {
      id: callId,
      kind: "list",
      text: intent || "Updated task list",
    }
    return todoStep
  }

  // Shell commands & fallback tool calls — always show concise human-readable action label,
  // never raw shell flag pipelines or raw JSON tool parameters.
  tracker.phaseHasCommands = true
  tracker.phaseCommandCount += 1

  const actionLabel = summarizeToolAction(name, args, intent)
  const displayCommand = error ? `${actionLabel} (failed)` : actionLabel

  const shellStep: ShellCommandStep = {
    id: callId,
    kind: "command",
    command: actionLabel,
    displayCommand,
    output: (error ?? output).slice(0, 2400) || "(no output)",
    exitCode: error ? 1 : 0,
    statusLabel: error ? "Failed" : "Success",
    isFailed: Boolean(error),
    isMono: false,
  }
  return shellStep
}

function normalizeFileChangeKind(value: unknown): FileChangeKind {
  if (
    value === "created" ||
    value === "modified" ||
    value === "deleted" ||
    value === "renamed"
  ) {
    return value
  }
  return "modified"
}

function normalizeFileChangeStatus(value: unknown): FileChangeStatus {
  if (value === "pending" || value === "kept" || value === "undone") {
    return value
  }
  return "pending"
}

function normalizeFileChangeHunk(raw: unknown): FileChangeHunk | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  return {
    old_start: typeof r.old_start === "number" ? r.old_start : 1,
    old_lines: typeof r.old_lines === "number" ? r.old_lines : 0,
    new_start: typeof r.new_start === "number" ? r.new_start : 1,
    new_lines: typeof r.new_lines === "number" ? r.new_lines : 0,
    header: typeof r.header === "string" ? r.header : "@@",
    lines: Array.isArray(r.lines)
      ? r.lines.filter((line): line is string => typeof line === "string")
      : [],
  }
}

function normalizeFileChangeEntry(raw: unknown): FileChangeEntrySummary | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const path = typeof r.path === "string" ? r.path : ""
  if (!path) return null
  const displayPath =
    typeof r.display_path === "string" && r.display_path.trim()
      ? r.display_path
      : path
  const previewHunks = Array.isArray(r.preview_hunks)
    ? r.preview_hunks
        .map(normalizeFileChangeHunk)
        .filter((h): h is FileChangeHunk => h !== null)
    : []
  return {
    path,
    display_path: displayPath,
    ...(typeof r.old_path === "string" ? { old_path: r.old_path } : {}),
    kind: normalizeFileChangeKind(r.kind),
    status: normalizeFileChangeStatus(r.status),
    additions: typeof r.additions === "number" ? r.additions : 0,
    deletions: typeof r.deletions === "number" ? r.deletions : 0,
    changed_in_latest_turn: Boolean(r.changed_in_latest_turn),
    turn_id: typeof r.turn_id === "number" ? r.turn_id : 0,
    edit_count: typeof r.edit_count === "number" ? r.edit_count : 1,
    is_binary: Boolean(r.is_binary),
    undoable: r.undoable !== false,
    can_redo: Boolean(r.can_redo),
    preview_hunks: previewHunks,
    preview_truncated: Boolean(r.preview_truncated),
    updated_at_ms:
      typeof r.updated_at_ms === "number" ? r.updated_at_ms : Date.now(),
  }
}

export function normalizeFileChangesSnapshot(
  raw: unknown,
  fallbackSessionId = ""
): FileChangesSnapshot | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const files = Array.isArray(r.files)
    ? r.files
        .map(normalizeFileChangeEntry)
        .filter((entry): entry is FileChangeEntrySummary => entry !== null)
    : []
  const sessionId =
    typeof r.session_id === "string" && r.session_id
      ? r.session_id
      : fallbackSessionId
  const pendingFiles = files.filter((f) => f.status === "pending")
  return {
    session_id: sessionId,
    latest_turn_id: typeof r.latest_turn_id === "number" ? r.latest_turn_id : 0,
    total_pending_files:
      typeof r.total_pending_files === "number"
        ? r.total_pending_files
        : pendingFiles.length,
    total_additions:
      typeof r.total_additions === "number"
        ? r.total_additions
        : files.reduce((sum, f) => sum + f.additions, 0),
    total_deletions:
      typeof r.total_deletions === "number"
        ? r.total_deletions
        : files.reduce((sum, f) => sum + f.deletions, 0),
    files,
  }
}

export function mapHarnessFrameToLiveEvents(
  frame: Record<string, unknown>,
  tracker: HarnessStreamTracker
): MappedLiveTraceEvent[] {
  const ev = typeof frame.ev === "string" ? frame.ev : ""

  if (ev === "turn_start") {
    tracker.startedAtMs = Date.now()
    tracker.turnActive = true
    tracker.batchEpoch = 1
    tracker.hasStreamedTextInPhase = false
    resetTrackerPhase(tracker)
    tracker.toolInputs.clear()
    return []
  }

  if (
    !tracker.turnActive &&
    (ev === "text_delta" ||
      ev === "reasoning_delta" ||
      ev === "thinking_delta" ||
      ev === "tool_start" ||
      ev === "tool_call")
  ) {
    tracker.startedAtMs = Date.now()
    tracker.turnActive = true
    tracker.turnCompleted = false
  }

  switch (ev) {
    case "text_delta": {
      tracker.turnCompleted = false
      const text = typeof frame.text === "string" ? frame.text : ""
      if (text) {
        tracker.hasStreamedTextInPhase = true
        return [{ type: "answer-delta", delta: text }]
      }
      return []
    }
    case "text_done": {
      const stopReason =
        typeof frame.stop_reason === "string" ? frame.stop_reason : undefined
      return stopReason ? [{ type: "text-done", stopReason }] : []
    }
    case "model_info": {
      const sessionId =
        typeof frame.session_id === "string" ? frame.session_id : ""
      return [
        {
          type: "model-info",
          sessionId,
          ...(typeof frame.model === "string" ? { model: frame.model } : {}),
          ...(typeof frame.provider === "string"
            ? { provider: frame.provider }
            : {}),
          ...(typeof frame.reasoning_effort === "string"
            ? { reasoningEffort: frame.reasoning_effort }
            : {}),
        },
      ]
    }
    case "permission_mode_changed": {
      const sessionId =
        typeof frame.session_id === "string" ? frame.session_id : ""
      const mode = typeof frame.mode === "string" ? frame.mode : ""
      return mode
        ? [{ type: "permission-mode-changed", sessionId, mode }]
        : []
    }
    case "config_changed": {
      const changedKeys = Array.isArray(frame.changed_keys)
        ? frame.changed_keys.filter((k): k is string => typeof k === "string")
        : []
      const requiresRestart = frame.requires_restart === true
      const values =
        frame.values &&
        typeof frame.values === "object" &&
        !Array.isArray(frame.values)
          ? (frame.values as Record<string, unknown>)
          : {}
      return [
        {
          type: "config-changed",
          changedKeys,
          requiresRestart,
          values,
        },
      ]
    }
    case "promote_answer_to_note": {
      tracker.hasStreamedTextInPhase = false
      tracker.batchEpoch += 1
      resetTrackerPhase(tracker)
      return [{ type: "promote-note" }]
    }
    case "reasoning_delta":
    case "thinking_delta": {
      tracker.turnCompleted = false
      const text =
        typeof frame.text === "string"
          ? frame.text
          : typeof frame.delta === "string"
            ? frame.delta
            : ""
      if (text && !isSyntheticReasoningPlaceholder(text)) {
        return [{ type: "reasoning-delta", delta: text }]
      }
      return []
    }
    case "reasoning_done": {
      // Keep the cumulative turn elapsed timer ticking rather than overwriting with single reasoning block duration.
      return []
    }
    case "tool_start": {
      const callId = String(frame.call_id ?? "")
      const name = String(frame.name ?? "tool")
      const args = parseToolArgs(frame.tool_input ?? frame.input)
      if (callId) {
        tracker.toolInputs.set(
          callId,
          Object.keys(args).length > 0 ? JSON.stringify(args) : ""
        )
      }
      const events: MappedLiveTraceEvent[] = []
      if (tracker.hasStreamedTextInPhase) {
        tracker.hasStreamedTextInPhase = false
        tracker.batchEpoch += 1
        resetTrackerPhase(tracker)
        events.push({ type: "promote-note" })
      }
      events.push({
        type: "tool-status",
        label: describeActiveTool(name, args),
      })
      return events
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
    case "tool_exec": {
      const callId = String(frame.call_id ?? "")
      const name = String(frame.name ?? "tool")
      const args = parseToolArgs(
        frame.tool_input ?? frame.input,
        callId ? (tracker.toolInputs.get(callId) ?? "") : ""
      )
      const events: MappedLiveTraceEvent[] = []
      if (tracker.hasStreamedTextInPhase) {
        tracker.hasStreamedTextInPhase = false
        tracker.batchEpoch += 1
        resetTrackerPhase(tracker)
        events.push({ type: "promote-note" })
      }
      events.push({
        type: "tool-status",
        label: describeActiveTool(name, args),
      })
      return events
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
      if (tracker.hasStreamedTextInPhase) {
        tracker.hasStreamedTextInPhase = false
        tracker.batchEpoch += 1
        resetTrackerPhase(tracker)
        return [{ type: "promote-note" }]
      }
      return []
    }
    case "tool_done": {
      const callId = String(frame.call_id ?? `call_${Date.now()}`)
      const name = String(frame.name ?? "tool")
      const lower = name.toLowerCase()
      const output =
        typeof frame.tool_output === "string"
          ? frame.tool_output
          : typeof frame.output === "string"
            ? frame.output
            : ""
      const error = typeof frame.error === "string" ? frame.error : undefined
      const args = parseToolArgs(
        frame.tool_input ?? frame.input,
        tracker.toolInputs.get(callId) ?? ""
      )

      const epoch = tracker.batchEpoch
      const workGroupId = `codex_work_${epoch}`

      // Unpack Rust daemon `batch` calls into individual Codex-style steps under one clean group
      if (lower === "batch") {
        const rawCalls = Array.isArray(args.tool_calls)
          ? (args.tool_calls.filter(
              (c): c is Record<string, unknown> =>
                Boolean(c) && typeof c === "object" && !Array.isArray(c)
            ))
          : []
        const sections = splitBatchOutputSections(output)
        const events: MappedLiveTraceEvent[] = [{ type: "tool-status", label: null }]

        if (rawCalls.length > 0) {
          for (let i = 0; i < rawCalls.length; i += 1) {
            const { tool: subTool, args: subArgs } = extractBatchSubcallArgs(
              rawCalls[i]
            )
            const section = sections[i]
            const subOutput = section?.output ?? (i === 0 ? output : "")
            const subError =
              error ?? (section?.isError ? section.output : undefined)
            const step = mapSingleWorkStep(
              `${callId}_${i + 1}`,
              subTool,
              subArgs,
              subOutput,
              subError,
              tracker
            )
            events.push({
              type: "step",
              groupId: workGroupId,
              groupTitle: computePhaseGroupTitle(tracker),
              step,
            })
          }
          return events
        }

        if (sections.length > 0) {
          for (let i = 0; i < sections.length; i += 1) {
            const section = sections[i]
            const step = mapSingleWorkStep(
              `${callId}_${i + 1}`,
              section.tool,
              {},
              section.output,
              section.isError ? section.output : error,
              tracker
            )
            events.push({
              type: "step",
              groupId: workGroupId,
              groupTitle: computePhaseGroupTitle(tracker),
              step,
            })
          }
          return events
        }

        // Batch failed before running sub-calls (e.g. schema retry) — keep quiet & compact
        if (error) {
          tracker.phaseHasCommands = true
          tracker.phaseCommandCount += 1
          const retryStep: ShellCommandStep = {
            id: callId,
            kind: "command",
            command: "batch",
            displayCommand: "Retried parallel tool call",
            output: error.slice(0, 1200),
            exitCode: 1,
            statusLabel: "Retried",
            isFailed: true,
            isMono: false,
          }
          events.push({
            type: "step",
            groupId: workGroupId,
            groupTitle: computePhaseGroupTitle(tracker),
            step: retryStep,
          })
        }
        return events
      }

      // Map create_powerpoint into visual slide preview thumbnail card with real deck metadata
      if (lower === "create_powerpoint" && !error) {
        const deckTitle =
          typeof args.title === "string" && args.title.trim()
            ? args.title.trim()
            : "Presentation"
        const rawPath =
          typeof args.file_path === "string"
            ? args.file_path
            : typeof args.filePath === "string"
              ? args.filePath
              : ""
        const slideCount = Array.isArray(args.slides)
          ? args.slides.length
          : undefined
        const pillLabel = deckTitle || "Slide"
        const previewStep: ListStep = {
          id: callId,
          kind: "previews",
          text: "",
          previews: [
            {
              id: `slide_${callId}`,
              kind: "slide",
              badge: ".pptx",
              label: deckTitle,
              pillLabel,
            },
          ],
        }
        return [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `codex_slide_${epoch}`,
            groupTitle: "Built presentation",
            step: previewStep,
          },
          {
            type: "artifact",
            artifact: {
              kind: "slide",
              title: deckTitle,
              subtitle: slideCount
                ? `${slideCount} slide${slideCount === 1 ? "" : "s"} · ${rawPath ? basenameOf(rawPath) : ".pptx"}`
                : rawPath
                  ? basenameOf(rawPath)
                  : "PowerPoint deck (.pptx)",
              pillLabel,
            },
          },
        ]
      }

      // Map write_excel / read_excel into real Excel artifact step card
      if ((lower === "write_excel" || lower === "read_excel") && !error) {
        const rawPath =
          typeof args.file_path === "string"
            ? args.file_path
            : typeof args.filePath === "string"
              ? args.filePath
              : typeof args.path === "string"
                ? args.path
                : "workbook.xlsx"
        const fileName = basenameOf(rawPath)
        const excelStep: ListStep = {
          id: callId,
          kind: "previews",
          text:
            lower === "write_excel"
              ? `Updated ${fileName}`
              : `Read ${fileName}`,
          previews: [
            {
              id: `excel_${callId}`,
              kind: "excel",
              badge: ".xlsx",
              label: fileName,
              pillLabel: fileName,
            },
          ],
        }
        const events: MappedLiveTraceEvent[] = [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `codex_excel_${epoch}`,
            groupTitle:
              lower === "write_excel" ? "Updated spreadsheet" : "Read spreadsheet",
            step: excelStep,
          },
        ]
        if (lower === "write_excel") {
          events.push({
            type: "artifact",
            artifact: {
              kind: "excel",
              title: fileName,
              subtitle: rawPath || "Excel workbook (.xlsx)",
              pillLabel: fileName,
            },
          })
        }
        return events
      }

      // Map browser_* tools under "Used the browser" step group
      if (lower.startsWith("browser_")) {
        let browserCmd = name
        if (lower === "browser_navigate" && typeof args.url === "string") {
          browserCmd = `Navigate to ${args.url}`
        } else if (lower === "browser_snapshot") {
          browserCmd = "Inspect page snapshot"
        } else if (lower === "browser_click" && typeof args.ref === "string") {
          browserCmd = `Click ${args.ref}`
        } else if (lower === "browser_type" && typeof args.ref === "string") {
          browserCmd = `Type into ${args.ref}`
        }
        const browserStep: ShellCommandStep = {
          id: callId,
          kind: "command",
          command: browserCmd,
          displayCommand: browserCmd,
          output: (error ?? output).slice(0, 2400) || "(no output)",
          exitCode: error ? 1 : 0,
          statusLabel: error ? "Failed" : "Success",
          isFailed: Boolean(error),
          isMono: false,
        }
        return [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `codex_browser_${epoch}`,
            groupTitle: "Used the browser",
            step: browserStep,
          },
        ]
      }

      // Standard workspace tools (read, ls, grep, glob, bash, edit, write, todo, etc.)
      // all coalesce into one clean Codex-style group per work phase.
      const step = mapSingleWorkStep(callId, name, args, output, error, tracker)
      const durationMs =
        typeof frame.duration_ms === "number" &&
        Number.isFinite(frame.duration_ms)
          ? frame.duration_ms
          : undefined
      if (durationMs !== undefined && step.kind === "command") {
        step.durationMs = durationMs
      }
      return [
        { type: "tool-status", label: null },
        {
          type: "step",
          groupId: workGroupId,
          groupTitle: computePhaseGroupTitle(tracker),
          step,
        },
      ]
    }
    case "permission_request": {
      const requestId = String(frame.request_id ?? "")
      if (!requestId) return []
      const sessionId =
        typeof frame.session_id === "string" ? frame.session_id : ""
      const toolName = String(frame.tool_name ?? "tool")
      const description =
        typeof frame.description === "string" && frame.description.trim()
          ? frame.description.trim()
          : `Allow RayuCode to run ${toolName}?`
      return [
        {
          type: "permission-request",
          sessionId,
          requestId,
          toolName,
          description,
        },
      ]
    }
    case "file_changes_state": {
      const sessionId =
        typeof frame.session_id === "string" ? frame.session_id : ""
      const snapshot = normalizeFileChangesSnapshot(frame.snapshot, sessionId)
      if (!snapshot) return []
      return [{ type: "file-changes", snapshot }]
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
    case "provider_guardrail": {
      tracker.turnCompleted = false
      const message =
        typeof frame.message === "string" && frame.message.trim()
          ? frame.message.trim()
          : "The model declined this request."
      return [{ type: "answer-delta", delta: `\n\n${message}` }]
    }
    case "error": {
      const adapter = {
        startedAtMs: tracker.startedAtMs,
        turnActive: tracker.turnActive,
        turnCompleted: Boolean(tracker.turnCompleted),
        batchEpoch: tracker.batchEpoch,
        hasStreamedTextInPhase: tracker.hasStreamedTextInPhase,
        lastCredits: tracker.lastCredits ?? "",
        lastKvCachePct: tracker.lastKvCachePct ?? 0,
      }
      const settled = settleHarnessErrorFrame(frame, adapter, () =>
        resetTrackerPhase(tracker)
      )
      if (!settled) return []
      tracker.turnCompleted = adapter.turnCompleted
      tracker.turnActive = adapter.turnActive
      tracker.batchEpoch = adapter.batchEpoch
      tracker.hasStreamedTextInPhase = adapter.hasStreamedTextInPhase
      return [
        { type: "tool-status", label: null },
        {
          type: "answer-delta",
          delta: `\n\n**Error:** ${settled.message}`,
        },
        {
          type: "complete",
          workedDuration: settled.workedDuration,
          ...(settled.credits ? { credits: settled.credits } : {}),
          ...(settled.kvCachePct > 0 ? { kvCachePct: settled.kvCachePct } : {}),
          timestamp: "Just now",
        },
      ]
    }
    case "turn_done":
    case "turn_stopped": {
      if (tracker.turnCompleted) {
        return []
      }
      tracker.turnCompleted = true
      const elapsedSec = Math.max(
        1,
        Math.floor((Date.now() - tracker.startedAtMs) / 1000)
      )
      const events: MappedLiveTraceEvent[] = [{ type: "tool-status", label: null }]
      if (
        ev === "turn_stopped" &&
        frame.reason === "failure" &&
        typeof frame.message === "string" &&
        frame.message.trim()
      ) {
        events.push({
          type: "answer-delta",
          delta: `\n\n**Error:** ${frame.message.trim()}`,
        })
      }
      events.push({
        type: "complete",
        workedDuration: formatDurationSeconds(elapsedSec),
        credits: tracker.lastCredits,
        kvCachePct: tracker.lastKvCachePct,
        timestamp: "Just now",
      })
      tracker.batchEpoch = 1
      tracker.turnActive = false
      tracker.hasStreamedTextInPhase = false
      resetTrackerPhase(tracker)
      return events
    }
    default:
      return []
  }
}
