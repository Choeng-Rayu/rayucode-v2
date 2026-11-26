import type {
  ModelOption,
  PermissionModeId,
  PermissionModeOption,
  QuickStartSuggestion,
  ReasoningEffort,
} from "../types"

export const DEFAULT_MODEL_ID = "default"
export const DEFAULT_MODEL_LABEL = "Default"
export const DEFAULT_EFFORT: ReasoningEffort = ""
export const DEFAULT_PERMISSION_MODE_ID: PermissionModeId = "default"
export const DEFAULT_PROJECT = "rayucode-v2"
export const DEFAULT_CHECKOUT = "Local Checkout"

/**
 * Empty offline fallback: models come strictly from live daemon discovery
 * (`ipcClient.models.list()` / `refresh()`).
 */
export const FALLBACK_MODELS: readonly ModelOption[] = [] as const

/**
 * Minimal offline fallback for Local Permission Modes when daemon capabilities
 * are not yet loaded.
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
    description:
      "Investigate and write a plan without asking. Never changes your code.",
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
    description:
      "Full access for delegated workers; the main agent only coordinates.",
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

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  none: "Direct responses with extended reasoning turned off.",
  minimal: "Minimal reasoning for the fastest possible turn latency.",
  low: "Faster responses with lighter reasoning for quick edits.",
  medium: "Balances speed and reasoning depth for everyday tasks.",
  high: "Deeper multi-step reasoning for complex architecture and debugging.",
  xhigh: "Extended deep deliberation for intricate multi-file engineering.",
  max: "Maximum reasoning depth for the hardest engineering problems.",
}

export function getEffortDescription(stop: string): string {
  const key = stop.trim().toLowerCase()
  return (
    EFFORT_DESCRIPTIONS[key] ??
    "Adjusts how deeply the model deliberates before answering."
  )
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
