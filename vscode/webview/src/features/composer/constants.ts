import type { ComposerInjectionPayload } from "@shared/vscodeProtocol";
import type {
  CacheTtl,
  EditorSelectionView,
  EffortLevel,
  EffortStopConfig,
  ModelOption,
  PermissionModeId,
  PermissionModeOption,
  QuickActionItem,
  ServiceTier,
  SlashCommandItem,
} from "./types";

export const DEFAULT_MODEL_ID = "claude-opus-5-5";
export const DEFAULT_MODEL_LABEL = "Claude Opus 5.5";
export const DEFAULT_EFFORT: EffortLevel = "medium";
export const DEFAULT_EFFORT_INDEX = 1;
export const DEFAULT_SERVICE_TIER: ServiceTier = "auto";
export const DEFAULT_CACHE_TTL: CacheTtl = "5m";
export const DEFAULT_PERMISSION_MODE_ID: PermissionModeId = "default";
export const DEFAULT_PROJECT = "rayucode-v2";
export const DEFAULT_CHECKOUT = "main";

export const EFFORT_LEVELS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const EFFORT_STOPS: readonly EffortStopConfig[] = [
  {
    index: 0,
    level: "low",
    label: "Low",
    description: "Faster responses with lighter reasoning for quick edits.",
    progress: 0,
  },
  {
    index: 1,
    level: "medium",
    label: "Medium",
    description: "Balances speed and reasoning depth for everyday tasks.",
    progress: 0.25,
  },
  {
    index: 2,
    level: "high",
    label: "High",
    description:
      "Deeper multi-step reasoning for complex architecture and debugging.",
    progress: 0.5,
  },
  {
    index: 3,
    level: "xhigh",
    label: "xHigh",
    description:
      "Extended deep verification for intricate refactors and concurrency.",
    progress: 0.75,
  },
  {
    index: 4,
    level: "max",
    label: "Max",
    description:
      "Maximum reasoning depth for the hardest engineering problems.",
    progress: 1,
  },
] as const;

export const SERVICE_TIER_OPTIONS: ReadonlyArray<{
  id: ServiceTier;
  label: string;
}> = [
  { id: "auto", label: "Auto" },
  { id: "priority", label: "Priority" },
  { id: "ultrafast", label: "UltraFast" },
  { id: "flex", label: "Flex" },
  { id: "off", label: "Off" },
];

export const CACHE_TTL_OPTIONS: ReadonlyArray<{
  id: CacheTtl;
  label: string;
}> = [
  { id: "5m", label: "5m TTL" },
  { id: "1h", label: "1h TTL" },
];

/**
 * Normalizes any provider display name or backend alias into its canonical lookup ID.
 */
export function normalizeProviderIdForLookup(raw?: string | null): string {
  const normalized = (raw ?? "").trim().toLowerCase();
  switch (normalized) {
    case "rayu":
    case "rayucode":
    case "rayu-cloud":
    case "rayu cloud":
    case "rayu cloud gateway":
    case "subscription":
      return "rayu";
    case "anthropic":
    case "claude":
    case "claude-api":
      return "anthropic";
    case "openai":
    case "openai-api":
      return "openai";
    case "gemini":
    case "google":
    case "google-gemini":
    case "gemini-api":
      return "gemini";
    case "copilot":
    case "github-copilot":
      return "copilot";
    case "bedrock":
    case "aws-bedrock":
      return "bedrock";
    case "grok":
    case "grok-build":
      return "grok";
    case "azure":
    case "azure-openai":
      return "azure";
    default:
      return normalized;
  }
}

/**
 * Formats a harness model spec matching Desktop & Extension Host 1:1:
 * returns "" for empty / "default", preserves existing "prefix:id", and
 * prefixes "rayu:" whenever provider or apiMethod normalizes to "rayu".
 */
export function formatHarnessModelSpec(
  modelId: string,
  provider?: string,
  apiMethod?: string,
): string {
  const trimmed = modelId.trim();
  if (!trimmed || trimmed === "default") return "";
  if (trimmed.includes(":")) return trimmed;
  const normalizedApi = normalizeProviderIdForLookup(apiMethod);
  const normalizedProvider = normalizeProviderIdForLookup(provider);
  if (normalizedApi === "rayu" || normalizedProvider === "rayu") {
    return `rayu:${trimmed}`;
  }
  return trimmed;
}

/**
 * Formats a canonical or raw provider ID into a crisp UI badge label.
 */
export function formatProviderBadgeLabel(provider?: string | null): string {
  const norm = normalizeProviderIdForLookup(provider);
  switch (norm) {
    case "rayu":
      return "Rayu Cloud";
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "gemini":
      return "Gemini";
    case "copilot":
      return "GitHub Copilot";
    case "bedrock":
      return "AWS Bedrock";
    case "grok":
      return "xAI Grok";
    case "azure":
      return "Azure";
    case "openrouter":
      return "OpenRouter";
    case "deepseek":
      return "DeepSeek";
    case "groq":
      return "Groq";
    case "mistral":
      return "Mistral";
    case "ollama":
      return "Ollama";
    case "antigravity":
      return "Antigravity";
    case "cursor":
      return "Cursor";
    default: {
      const trimmed = (provider ?? "").trim();
      if (!trimmed) return "Provider";
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }
}

/**
 * Offline fallback catalog in exact Rayu Gateway route ordering.
 * Live routes discovered from the Rust daemon always preserve their backend order.
 */
export const FALLBACK_MODELS: readonly ModelOption[] = [
  {
    id: "claude-opus-5-5",
    modelSpec: "rayu:claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "rayu",
    apiMethod: "rayu",
    subtitle: "Rayu Cloud · Flagship reasoning",
    authMethod: "oauth",
    accountLabel: "Rayu Cloud",
    recommended: true,
    available: true,
  },
  {
    id: "claude-sonnet-4-5",
    modelSpec: "rayu:claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "rayu",
    apiMethod: "rayu",
    subtitle: "Rayu Cloud · Fast daily driver",
    authMethod: "oauth",
    accountLabel: "Rayu Cloud",
    available: true,
  },
  {
    id: "gpt-5.2",
    modelSpec: "gpt-5.2",
    label: "GPT-5.2",
    provider: "openai",
    subtitle: "OpenAI · High-precision coding",
    authMethod: "api_key",
    available: true,
  },
  {
    id: "claude-opus-4-5",
    modelSpec: "claude-opus-4-5",
    label: "Claude Opus 4.5",
    provider: "anthropic",
    subtitle: "Anthropic · Deep architecture",
    authMethod: "env",
    available: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    modelSpec: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "gemini",
    subtitle: "Google · Long-context analysis",
    authMethod: "api_key",
    available: true,
  },
  {
    id: "deepseek-v4-flash",
    modelSpec: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    subtitle: "DeepSeek · Low-latency synthesis",
    authMethod: "api_key",
    available: true,
  },
] as const;

/**
 * Exact 5 Local Permission Modes matching vscodeProtocol.ts & Spec 01.
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
] as const;

/**
 * Key Rust engine TUI slash commands (Spec 01 §3).
 */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    command: "/compact",
    insertText: "/compact",
    description: "Summarize conversation history to free context",
    kind: "runtime",
    category: "Context",
  },
  {
    command: "/plan",
    insertText: "/plan ",
    description: "Investigate and write a step-by-step plan before editing",
    kind: "runtime",
    category: "Mode",
  },
  {
    command: "/review",
    insertText: "/review",
    description: "Run an independent engineering & diff review pass",
    kind: "runtime",
    category: "Quality",
  },
  {
    command: "/judge",
    insertText: "/judge",
    description: "Evaluate current session output with the quality judge",
    kind: "runtime",
    category: "Quality",
  },
  {
    command: "/swarm",
    insertText: "/swarm ",
    description: "Spawn parallel multi-agent workers in this repository",
    kind: "runtime",
    category: "Orchestration",
  },
  {
    command: "/overnight",
    insertText: "/overnight ",
    description: "Launch an autonomous overnight engineering run",
    kind: "runtime",
    category: "Automations",
  },
  {
    command: "/goal",
    insertText: "/goal ",
    description: "Set an autonomous goal to pursue until verified complete",
    kind: "runtime",
    category: "Automations",
  },
  {
    command: "/bg",
    insertText: "/bg",
    description: "Inspect or manage background processes and shells",
    kind: "runtime",
    category: "Processes",
  },
  {
    command: "/fast",
    insertText: "/fast",
    description: "Toggle priority / ultrafast service tier",
    kind: "runtime",
    category: "Inference",
  },
  {
    command: "/model",
    insertText: "/model",
    description: "Switch provider route or reasoning effort",
    kind: "runtime",
    category: "Inference",
  },
  {
    command: "/fork",
    insertText: "/fork",
    description: "Branch current conversation into a new session",
    kind: "runtime",
    category: "Session",
  },
  {
    command: "/transfer",
    insertText: "/transfer",
    description: "Transfer session context to another workspace or target",
    kind: "runtime",
    category: "Session",
  },
  {
    command: "/clear",
    insertText: "/clear",
    description: "Reset to a fresh session on Home",
    kind: "runtime",
    category: "Session",
  },
  {
    command: "/rewind",
    insertText: "/rewind",
    description: "Rewind session state to an earlier checkpoint",
    kind: "runtime",
    category: "Session",
  },
  {
    command: "/memory",
    insertText: "/memory",
    description: "Inspect or extract durable semantic memory facts",
    kind: "runtime",
    category: "Knowledge",
  },
  {
    command: "/skills",
    insertText: "/skills",
    description: "Browse and execute installed SKILL.md workflows",
    kind: "runtime",
    category: "Plugins",
  },
  {
    command: "/mcp",
    insertText: "/mcp",
    description: "Inspect 7-layer MCP servers and schema budget",
    kind: "runtime",
    category: "Plugins",
  },
  {
    command: "/doctor",
    insertText: "/doctor",
    description: "Run provider, socket, and authentication diagnostics",
    kind: "runtime",
    category: "System",
  },
] as const;

/**
 * 4 Quiet Quick-Action Pills on HomePage (Brief #14 & Spec 01).
 */
export const HOME_QUICK_ACTIONS: readonly QuickActionItem[] = [
  {
    id: "explain-selection",
    label: "Explain selection",
    prompt:
      "Explain the active editor selection, how it fits into the surrounding module, and any edge cases to watch out for.",
    kind: "explain",
  },
  {
    id: "fix-test-failure",
    label: "Fix test failure",
    prompt:
      "Trace the failing test in this workspace, identify the root cause, and apply a minimal verified fix.",
    kind: "test",
  },
  {
    id: "review-git-diff",
    label: "Review git diff",
    prompt:
      "/review Audit uncommitted git changes for correctness, regressions, and design contract compliance.",
    kind: "diff",
  },
  {
    id: "launch-swarm",
    label: "Launch Swarm",
    prompt:
      "/swarm Coordinate parallel workers to implement, verify, and test the next milestone.",
    kind: "swarm",
  },
] as const;

export function normalizeEffortLevel(raw?: string | null): EffortLevel {
  if (!raw) return DEFAULT_EFFORT;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "low") return "low";
  if (lowered === "medium" || lowered === "auto") return "medium";
  if (lowered === "high") return "high";
  if (lowered === "xhigh" || lowered === "x-high") return "xhigh";
  if (lowered === "max") return "max";
  return DEFAULT_EFFORT;
}

export function formatEffortLabel(effort: EffortLevel | string): string {
  const norm = normalizeEffortLevel(effort);
  const stop = EFFORT_STOPS.find((s) => s.level === norm);
  return stop ? stop.label : "Medium";
}

export function effortToIndex(effort: EffortLevel | string): number {
  const norm = normalizeEffortLevel(effort);
  const idx = EFFORT_LEVELS.indexOf(norm);
  return idx === -1 ? DEFAULT_EFFORT_INDEX : idx;
}

export function indexToEffort(index: number): EffortLevel {
  const clamped = Math.max(
    0,
    Math.min(EFFORT_LEVELS.length - 1, Math.round(index)),
  );
  return EFFORT_LEVELS[clamped] ?? DEFAULT_EFFORT;
}

export function getEffortStop(effort: EffortLevel | string): EffortStopConfig {
  const idx = effortToIndex(effort);
  return EFFORT_STOPS[idx] ?? EFFORT_STOPS[DEFAULT_EFFORT_INDEX];
}

export function nextPermissionModeId(
  current: PermissionModeId,
  modes: readonly PermissionModeOption[] = FALLBACK_PERMISSION_MODES,
): PermissionModeId {
  const list = modes.length > 0 ? modes : FALLBACK_PERMISSION_MODES;
  const idx = list.findIndex((mode) => mode.id === current);
  const next = list[(idx + 1) % list.length];
  return next ? next.id : DEFAULT_PERMISSION_MODE_ID;
}

export function getPermissionMode(
  id: PermissionModeId,
  modes: readonly PermissionModeOption[] = FALLBACK_PERMISSION_MODES,
): PermissionModeOption {
  const list = modes.length > 0 ? modes : FALLBACK_PERMISSION_MODES;
  return list.find((mode) => mode.id === id) ?? list[0];
}

export function formatSelectionRangeLabel(
  selection: EditorSelectionView,
): string {
  const rawPath = selection.relativePath || selection.filePath;
  const parts = rawPath.split(/[\\/]/).filter(Boolean);
  const fileName = parts[parts.length - 1] || rawPath;
  if (selection.lineStart === selection.lineEnd) {
    return `${fileName}:L${selection.lineStart}`;
  }
  return `${fileName}:L${selection.lineStart}-L${selection.lineEnd}`;
}

function normalizeMentionToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasMentionToken(text: string, token: string): boolean {
  if (!text) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?=$|\\s)`);
  return pattern.test(text);
}

/**
 * Pure helper merging contextual host injections (Explorer files, Editor
 * selections, Quick Fixes, Terminal captures, Git diffs) into the composer
 * textarea without creating prohibited file-chip components.
 */
export function mergeComposerInjection(
  currentText: string,
  injection: ComposerInjectionPayload,
): string {
  const prompt = injection.prompt?.trim() ?? "";

  const normalizedMentions: string[] = [];
  for (const raw of injection.mentions ?? []) {
    const token = normalizeMentionToken(raw);
    if (!token) continue;
    if (normalizedMentions.includes(token)) continue;
    normalizedMentions.push(token);
  }

  if (injection.mode === "replace" && prompt.length > 0) {
    const replaceMentions = normalizedMentions.filter(
      (token) => !hasMentionToken(prompt, token),
    );
    if (replaceMentions.length > 0) {
      return `${replaceMentions.join(" ")}\n\n${prompt}`;
    }
    return prompt;
  }

  let next = currentText;
  const newMentions = normalizedMentions.filter(
    (token) =>
      !hasMentionToken(next, token) &&
      (!prompt || !hasMentionToken(prompt, token)),
  );

  if (newMentions.length > 0) {
    const mentionText = newMentions.join(" ");
    if (next.trim().length === 0) {
      next = prompt ? mentionText : `${mentionText} `;
    } else {
      next = prompt
        ? `${next.trimEnd()} ${mentionText}`
        : `${next.trimEnd()} ${mentionText} `;
    }
  }

  if (prompt.length > 0) {
    if (next.trim().length === 0) {
      next = prompt;
    } else {
      next = `${next.trimEnd()}\n\n${prompt}`;
    }
  }

  return next;
}
