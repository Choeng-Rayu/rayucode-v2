import type {
  EffortStopConfig,
  ModelOption,
  PermissionModeId,
  PermissionModeOption,
  QuickStartSuggestion,
  ReasoningEffort,
  SlashCommandItem,
} from "../types"

export const DEFAULT_MODEL_ID = "claude-opus-5-5"
export const DEFAULT_MODEL_LABEL = "Claude Opus 5.5"
export const DEFAULT_EFFORT: ReasoningEffort = "Medium"
export const DEFAULT_EFFORT_INDEX = 2
export const DEFAULT_PERMISSION_MODE_ID: PermissionModeId = "default"
export const DEFAULT_PROJECT = "rayucode-v2"
export const DEFAULT_CHECKOUT = "Local Checkout"

export const EFFORT_LEVELS: readonly ReasoningEffort[] = [
  "Auto",
  "Low",
  "Medium",
  "High",
  "Max",
] as const

export const EFFORT_STOPS: readonly EffortStopConfig[] = [
  {
    index: 0,
    level: "Auto",
    description: "Automatically adapts reasoning depth to the task.",
    progress: 0,
  },
  {
    index: 1,
    level: "Low",
    description: "Faster responses with lighter reasoning for quick edits.",
    progress: 0.25,
  },
  {
    index: 2,
    level: "Medium",
    description: "Balances speed and reasoning depth for everyday tasks.",
    progress: 0.5,
  },
  {
    index: 3,
    level: "High",
    description: "Deeper multi-step reasoning for complex architecture and debugging.",
    progress: 0.75,
  },
  {
    index: 4,
    level: "Max",
    description: "Maximum reasoning depth for the hardest engineering problems.",
    progress: 1,
  },
] as const

/**
 * Offline fallback catalog matching crates/rayucode-provider-core/src/models.rs.
 * Live discovery from ipcClient.models.list() / refresh() always takes precedence.
 */
export const FALLBACK_MODELS: readonly ModelOption[] = [
  {
    id: "default",
    label: "Default",
    subtitle: "Recommended set of models",
    provider: "rayu",
    recommended: true,
  },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "openai" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "openai" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai" },
  { id: "gpt-5.6-pro", label: "GPT-5.6 Pro", provider: "openai" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "google" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "google" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek" },
  { id: "kimi-k2.5", label: "Kimi K2.5", provider: "moonshot" },
  { id: "gpt-oss-120b", label: "GPT-OSS 120B", provider: "openrouter" },
  { id: "minimax-m2.7", label: "MiniMax M2.7", provider: "minimax" },
  { id: "GLM-5.1", label: "GLM-5.1", provider: "zhipu" },
] as const

/**
 * Exact 5 Local Permission Modes matching vscode/shared/permissionModes.ts.
 */
export const FALLBACK_PERMISSION_MODES: readonly PermissionModeOption[] = [
  {
    id: "default",
    label: "Ask",
    description: "Ask before running tools that change anything.",
    isDefault: true,
    iconName: "lock",
  },
  {
    id: "acceptEdits",
    label: "Auto-edit",
    description: "Apply file edits without asking. Still asks for commands.",
    iconName: "shield-outline",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Investigate and write a plan without asking. Never changes your code.",
    iconName: "eye",
  },
  {
    id: "fullManage",
    label: "Full Manage",
    description: "Run all non-interactive tools without asking.",
    iconName: "shield-alert",
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    description: "Full access for delegated workers; the main agent only coordinates.",
    iconName: "swarm",
  },
] as const

export const HOME_PROJECTS: readonly string[] = [
  "rayucode-v2",
  "rayu-web",
  "specs-and-docs",
] as const

export const HOME_CHECKOUTS: readonly string[] = [
  "Local Checkout",
  "Isolated Worktree",
] as const

export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    command: "/goal",
    insertText: "/goal",
    description: "Set an autonomous goal to pursue until complete",
  },
  {
    command: "/plan",
    insertText: "/plan",
    description: "Investigate and write a step-by-step plan before editing",
  },
  {
    command: "/swarm",
    insertText: "/swarm",
    description: "Spawn parallel workers in this repo",
  },
  {
    command: "/review",
    insertText: "/review",
    description: "Run an engineering & diff review pass",
  },
  {
    command: "/compact",
    insertText: "/compact",
    description: "Summarize conversation history to free context",
  },
  {
    command: "/model",
    insertText: "/model",
    description: "Switch route in Rayu-first gateway order",
  },
  {
    command: "/preview",
    insertText: "/preview browser",
    description: "Open Browser, Microsoft Office, or MD preview",
  },
  {
    command: "/memory",
    insertText: "/memory status",
    description: "Inspect or extract durable session memory",
  },
  {
    command: "/cache",
    insertText: "/cache stats",
    description: "KV prompt cache stats & TTL (5m / 1h)",
  },
  {
    command: "/telegram-bot",
    insertText: "/telegram-bot status",
    description: "Pair or inspect Telegram remote control",
  },
] as const

export const QUICK_START_SUGGESTIONS: readonly QuickStartSuggestion[] = [
  {
    id: "qs_retire_cache",
    label: "Retire SessionCache via ShardStore",
    prompt:
      "Retire SessionCache in src/session/cache.rs and route reads through ShardStore::lookup with the LRU budget preserved.",
    kind: "code",
  },
  {
    id: "qs_swarm_retry",
    label: "Parallel Swarm: gateway retry tests",
    prompt:
      "/swarm Audit gateway retry budget tests and verify deduplication across worker worktrees.",
    kind: "swarm",
  },
  {
    id: "qs_cost_sheet",
    label: "Update Q4 token cost workbook",
    prompt:
      "Recalculate KV prompt cache savings in Q4-Token-Cost-Model.xlsx and summarize deltas in MIGRATION_PLAN.md.",
    kind: "sheet",
  },
  {
    id: "qs_browser_preview",
    label: "Inspect localhost:3000 dashboard",
    prompt:
      "/preview browser Verify credits usage dashboard KPIs and latency deltas on localhost:3000.",
    kind: "preview",
  },
] as const

export function effortToIndex(effort: ReasoningEffort): number {
  const idx = EFFORT_LEVELS.indexOf(effort)
  return idx === -1 ? DEFAULT_EFFORT_INDEX : idx
}

export function indexToEffort(index: number): ReasoningEffort {
  const clamped = Math.max(0, Math.min(EFFORT_LEVELS.length - 1, Math.round(index)))
  return EFFORT_LEVELS[clamped] ?? DEFAULT_EFFORT
}

export function getEffortStop(effort: ReasoningEffort): EffortStopConfig {
  const idx = effortToIndex(effort)
  return EFFORT_STOPS[idx] ?? EFFORT_STOPS[DEFAULT_EFFORT_INDEX]
}

export function nextPermissionModeId(
  current: PermissionModeId,
  modes: readonly PermissionModeOption[] = FALLBACK_PERMISSION_MODES
): PermissionModeId {
  const list = modes.length > 0 ? modes : FALLBACK_PERMISSION_MODES
  const idx = list.findIndex((mode) => mode.id === current)
  const next = list[(idx + 1) % list.length]
  return next ? next.id : DEFAULT_PERMISSION_MODE_ID
}

export function getPermissionMode(
  id: PermissionModeId,
  modes: readonly PermissionModeOption[] = FALLBACK_PERMISSION_MODES
): PermissionModeOption {
  const list = modes.length > 0 ? modes : FALLBACK_PERMISSION_MODES
  return list.find((mode) => mode.id === id) ?? list[0]
}
