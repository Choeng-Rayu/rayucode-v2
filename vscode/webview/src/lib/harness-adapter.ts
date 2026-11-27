import {
  extractActiveEditorSelectionFromPrompt,
  filterVisibleHistory,
  isVisibleHistoryMessage,
  settleHarnessErrorFrame,
} from "@rayu-dev/rayucode-session-core/client";
import type {
  HistoryImageView,
  HistoryResponseStatsView,
  PermissionModeId,
  RiskTier,
} from "@shared/vscodeProtocol";
import { basenameOf, formatDurationSeconds } from "./utils";

export interface ModelOption {
  id: string;
  label: string;
  subtitle?: string;
  provider: string;
  recommended?: boolean;
  supportsEffort?: boolean;
  effortLevels?: string[];
}

export interface FileReadTarget {
  file: string;
  path: string;
  line: number;
  rangeLabel: string;
}

export interface FileReadStep {
  id: string;
  kind: "read";
  label: string;
  files: FileReadTarget[];
}

export interface PreviewStepItem {
  id: string;
  kind: "slide" | "excel" | "markdown" | "diagram" | "pdf" | "html";
  badge: string;
  label: string;
  pillLabel: string;
}

export interface ListStep {
  id: string;
  kind: "list" | "search" | "previews";
  text: string;
  highlight?: string;
  previews?: PreviewStepItem[];
}

export interface ShellCommandStep {
  id: string;
  kind: "command";
  command: string;
  displayCommand: string;
  output: string;
  exitCode: number;
  statusLabel: string;
  isFailed?: boolean;
  isMono?: boolean;
  toolName?: string;
  intent?: string;
  durationMs?: number;
}

export type TraceStepItem = FileReadStep | ListStep | ShellCommandStep;

export interface WorkStepGroup {
  id: string;
  title: string;
  steps: TraceStepItem[];
}

export type TraceTimelineItem =
  | { type: "reasoning"; id: string; text: string }
  | { type: "note"; id: string; text: string }
  | { type: "group"; group: WorkStepGroup };

export interface InlineDiffLine {
  kind: "context" | "add" | "del";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface InlineDiffCardData {
  id: string;
  file: string;
  additions: number;
  deletions: number;
  hint: string;
  lines: InlineDiffLine[];
}

export interface TurnOutputArtifact {
  kind: "slide" | "excel" | "markdown" | "diagram" | "pdf" | "html" | "file";
  title: string;
  subtitle: string;
  pillLabel: string;
  filePath?: string;
}

export type TurnOutcome =
  | "answered"
  | "answered_partial"
  | "declined"
  | "failed";

export type TurnAttemptReason =
  | "initial"
  | "reassess_refusal"
  | "reassess_incomplete"
  | "recovery";

export interface TurnAttempt {
  id: string;
  reason: TurnAttemptReason;
  status: TurnOutcome;
  answerText: string;
  stopReason?: string | null;
}

export interface HiddenInternalMessage {
  origin: string;
  visibility: string;
  content: string;
}

export interface ExecutionTurn {
  id: string;
  sessionId: string;
  /** 1-based visible user message index matching Rust `RewindToUserMessage`. */
  userMessageIndex?: number;
  userPrompt: string;
  userRefFiles?: string;
  userImages?: Array<{ name: string; dataUrl: string }>;
  workedDuration: string;
  notes: string[];
  groups: WorkStepGroup[];
  timeline?: TraceTimelineItem[];
  answerIntro: string;
  answerBullets: string[];
  diffCard: InlineDiffCardData;
  artifacts?: TurnOutputArtifact[];
  timestamp: string;
  credits: string;
  kvCachePct: number;
  pinned: boolean;
  outcome?: TurnOutcome;
  attempts?: TurnAttempt[];
  finalAttemptId?: string | null;
  hiddenInternalMessages?: HiddenInternalMessage[];
}

export interface HarnessModelRouteLike {
  model: string;
  provider: string;
  api_method?: string;
  available?: boolean;
  detail?: string;
}

export interface HarnessHistoryMessageLike {
  role: string;
  content: string;
  origin?: string;
  visibility?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: unknown;
  attemptId?: string | null;
  attempt_id?: string | null;
  attemptReason?: string;
  attempt_reason?: string;
  attemptStatus?: string;
  attempt_status?: string;
  stopReason?: string | null;
  stop_reason?: string | null;
  images?: HistoryImageView[];
  tool?: {
    id?: string;
    name?: string;
    input?: unknown;
  } | null;
  responseStats?: HistoryResponseStatsView;
  response_stats?: {
    duration_secs?: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    rayu_credits?: number;
  };
}

export type PermissionRiskTier = RiskTier | "catastrophic";

export interface PendingPermissionRequest {
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  riskTier?: PermissionRiskTier;
  command?: string;
  permissionMode?: PermissionModeId;
}

export type MappedLiveTraceEvent =
  | { type: "reasoning-delta"; delta: string }
  | { type: "note"; text: string }
  | { type: "promote-note" }
  | { type: "tool-status"; label: string | null }
  | { type: "step"; groupId?: string; groupTitle?: string; step: TraceStepItem }
  | { type: "artifact"; artifact: TurnOutputArtifact }
  | {
      type: "permission-request";
      sessionId: string;
      requestId: string;
      toolName: string;
      description: string;
      riskTier?: PermissionRiskTier;
    }
  | { type: "answer-delta"; delta: string }
  | { type: "answer-replace"; text: string }
  | { type: "connection-phase"; phase: string | null }
  | { type: "kv-cache-miss"; reason: string }
  | { type: "turn-stopped"; reason?: string; message?: string }
  | { type: "duration"; workedDuration: string }
  | {
      type: "complete";
      workedDuration: string;
      credits?: string;
      kvCachePct?: number;
      stopReason?: string;
      timestamp?: string;
    };

const EMPTY_DIFF: InlineDiffCardData = {
  id: "diff_live_empty",
  file: "workspace",
  additions: 0,
  deletions: 0,
  hint: "No inline diff attached",
  lines: [],
};

function parseToolArgs(
  rawInput: unknown,
  fallbackJson = "",
): Record<string, unknown> {
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  const str = typeof rawInput === "string" ? rawInput : fallbackJson;
  if (!str.trim()) return {};
  try {
    const parsed = JSON.parse(str) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed json
  }
  return {};
}

export function describeActiveTool(
  name: string,
  args: Record<string, unknown>,
  intent?: string,
): string {
  const argIntent =
    typeof args.intent === "string" && args.intent.trim()
      ? args.intent.trim()
      : "";
  const effectiveIntent = intent && intent.trim() ? intent.trim() : argIntent;
  if (effectiveIntent) {
    return effectiveIntent.endsWith("...")
      ? effectiveIntent
      : `${effectiveIntent}...`;
  }
  const lower = name.toLowerCase();
  if (lower === "batch") {
    const calls = Array.isArray(args.tool_calls) ? args.tool_calls : [];
    if (calls.length > 0) {
      const first = calls[0] as Record<string, unknown> | undefined;
      const firstIntent =
        typeof first?.intent === "string" && first.intent.trim()
          ? first.intent.trim()
          : "";
      if (firstIntent) {
        return firstIntent.endsWith("...") ? firstIntent : `${firstIntent}...`;
      }
      return calls.length === 1
        ? "Inspecting workspace..."
        : `Running ${calls.length} parallel checks...`;
    }
    return "Inspecting workspace...";
  }
  if (lower === "read_file" || lower === "read") {
    const p =
      typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
          ? args.file_path
          : "";
    return p ? `Reading ${basenameOf(p)}...` : "Reading files...";
  }
  if (lower === "list_files" || lower === "ls" || lower === "listdir") {
    const d =
      typeof args.directory === "string"
        ? args.directory
        : typeof args.path === "string"
          ? args.path
          : "";
    return d && d !== "." ? `Listing files in ${d}...` : "Listing workspace files...";
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
          : "";
    return q ? `Searching for "${q}"...` : "Searching files...";
  }
  if (lower === "run_command" || lower === "bash" || lower === "shell") {
    return "Running command...";
  }
  if (
    lower === "edit_file" ||
    lower === "write_file" ||
    lower === "edit" ||
    lower === "write" ||
    lower === "apply_patch"
  ) {
    const p =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.path === "string"
          ? args.path
          : "";
    return p ? `Editing ${basenameOf(p)}...` : "Editing files...";
  }
  if (lower === "webfetch" || lower === "websearch") {
    return lower === "websearch" ? "Searching web..." : "Fetching page...";
  }
  if (lower === "todo" || lower === "todowrite") {
    return "Updating plan...";
  }
  if (lower === "create_powerpoint") {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    return title ? `Building presentation "${title}"...` : "Building presentation...";
  }
  if (lower === "write_excel") {
    const p =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.filePath === "string"
          ? args.filePath
          : "";
    return p ? `Writing ${basenameOf(p)}...` : "Writing spreadsheet...";
  }
  if (lower === "read_excel") {
    const p =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.filePath === "string"
          ? args.filePath
          : "";
    return p ? `Reading ${basenameOf(p)}...` : "Reading spreadsheet...";
  }
  if (lower.startsWith("browser_")) {
    if (lower === "browser_navigate") {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      return url ? `Opening ${url}...` : "Navigating browser...";
    }
    if (lower === "browser_snapshot") {
      return "Inspecting browser page...";
    }
    return "Using the browser...";
  }
  return `Using ${name}...`;
}

export function mapModelRoutesToOptions(
  routes: HarnessModelRouteLike[],
): ModelOption[] {
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const route of routes) {
    if (!route.model || seen.has(route.model)) continue;
    seen.add(route.model);
    out.push({
      id: route.model,
      label: route.model,
      subtitle:
        route.detail || (route.available ? "Available" : "Configure key"),
      provider: route.provider || "Rayu",
      recommended: route.available === true && out.length < 2,
    });
  }
  return out;
}

const REASONING_SENTINEL = "\u{2063}";
const REASONING_LINE_RE = new RegExp(
  `^\\*${REASONING_SENTINEL}([\\s\\S]*)${REASONING_SENTINEL}\\*[ \\t]*$`,
);

function splitReasoningFromAssistantContent(raw: string): {
  reasoningNotes: string[];
  answerText: string;
} {
  if (!raw.includes(REASONING_SENTINEL)) {
    return { reasoningNotes: [], answerText: raw };
  }
  const reasoningNotes: string[] = [];
  const answerLines: string[] = [];
  let paragraphLines: string[] = [];
  let sawReasoning = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join("\n").trim();
    if (text) reasoningNotes.push(text);
    paragraphLines = [];
  };

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const match = REASONING_LINE_RE.exec(line);
    if (match) {
      const unescaped = (match[1] ?? "").replace(/\\([\\*_`[\]<>&~|$])/g, "$1");
      if (unescaped.trim().length > 0) {
        paragraphLines.push(unescaped);
      }
      sawReasoning = true;
      continue;
    }
    if (sawReasoning && line.trim() === "") {
      flushParagraph();
      sawReasoning = false;
      continue;
    }
    flushParagraph();
    sawReasoning = false;
    answerLines.push(line);
  }
  flushParagraph();

  return {
    reasoningNotes,
    answerText: answerLines.join("\n").trim(),
  };
}

function summarizeNotificationLine(trimmed: string): string {
  const firstLine = (trimmed.split("\n")[0] ?? trimmed)
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return firstLine.slice(0, 140) || "Notification";
}

function classifySyntheticUserMessage(
  content: string,
): { groupTitle: string; command: string; output: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const importedMatch = trimmed.match(
    /^\[Imported tool result:[^\]]*\]\s*(.*)$/is,
  );
  if (importedMatch) {
    const summary = importedMatch[1]?.trim() || "Imported tool result";
    const skillMatch = summary.match(/Launching skill:\s*(.+)$/i);
    return {
      groupTitle: skillMatch
        ? `Loaded skill ${skillMatch[1]!.trim()}`
        : "Tool result",
      command: summary.slice(0, 140),
      output: trimmed.slice(0, 1200),
    };
  }

  const skillDirMatch = trimmed.match(/^Base directory for this skill:\s*([^\n]+)/i);
  if (skillDirMatch) {
    const dirPath = skillDirMatch[1]!.trim();
    const skillName = basenameOf(dirPath);
    return {
      groupTitle: `Loaded skill instructions (${skillName})`,
      command: `Skill: ${skillName} (${dirPath})`,
      output: trimmed.slice(0, 1600),
    };
  }

  if (
    /^\*\*Background task(?:\s+(?:started|progress|stalled))?\*\*/i.test(
      trimmed,
    )
  ) {
    return {
      groupTitle: "Background task",
      command: summarizeNotificationLine(trimmed),
      output: trimmed.slice(0, 1200),
    };
  }

  if (/^(?:\u{1F41D}\s*)?\*\*Swarm\b/iu.test(trimmed)) {
    return {
      groupTitle: "Swarm update",
      command: summarizeNotificationLine(trimmed),
      output: trimmed.slice(0, 1200),
    };
  }

  if (/^\[Scheduled task\]/i.test(trimmed)) {
    return {
      groupTitle: "Scheduled task",
      command: summarizeNotificationLine(trimmed),
      output: trimmed.slice(0, 1200),
    };
  }

  if (
    /^<(?:system-reminder|command-message|local-command-stdout|local-command-caveat)\b/i.test(
      trimmed,
    )
  ) {
    return {
      groupTitle: "System context",
      command: "Injected context",
      output: trimmed.slice(0, 1200),
    };
  }

  return null;
}

const ENGINE_INTERNAL_RECOVERY_PREFIXES = [
  "Reassess the user's request using its full context and likely intent rather than isolated keywords.",
  "Review the request again and distinguish legitimate coding, debugging, defensive, educational, or analytical work",
  "Perform one final, independent policy check. Prefer a safe and useful constrained response when possible.",
  "[System reminder: your previous response ended ",
  "[Attached image associated with the preceding tool result:",
] as const;

function isEngineInternalRecoveryPrompt(content: string): boolean {
  const trimmed = content.trimStart();
  if (/^You have \d+ incomplete todos?\b/i.test(trimmed)) {
    return true;
  }
  return ENGINE_INTERNAL_RECOVERY_PREFIXES.some((prefix) =>
    trimmed.startsWith(prefix),
  );
}

function isSyntheticReasoningPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^reasoning via rayu cloud\b/i.test(trimmed);
}

function isJsonLikeText(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function humanizeToolName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/^(?:mcp_|tool_|rayu_)/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!cleaned) return "Ran tool";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractReadableFileFromShell(rawCommand: string): string | null {
  const tokens = rawCommand.split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 1; i -= 1) {
    const token = tokens[i]!.replace(/^['"]|['"]$/g, "");
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
      continue;
    }
    if (/[./]/.test(token) && /\.[a-z0-9]{1,8}$/i.test(token)) {
      return basenameOf(token);
    }
  }
  return null;
}

function summarizeShellCommandLabel(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  if (!trimmed) return "Ran command";
  const firstSegment = trimmed.split(/[|;&\n]/)[0]?.trim() ?? trimmed;
  const lower = firstSegment.toLowerCase();

  if (/^git\s+status\b/.test(lower)) return "Checked git status";
  if (/^git\s+diff\b/.test(lower)) return "Inspected git diff";
  if (/^git\s+log\b/.test(lower)) return "Checked git history";
  if (/^git\s+branch\b/.test(lower)) return "Checked git branches";
  if (/^git\s+/.test(lower)) return "Ran git command";

  if (
    /\b(?:cargo\s+test|npm\s+test|pnpm\s+test|yarn\s+test|vitest|jest|pytest|go\s+test)\b/.test(
      lower,
    ) ||
    /\b(?:npm|pnpm|yarn)\s+run\s+test\b/.test(lower)
  ) {
    return "Ran tests";
  }
  if (
    /\b(?:cargo\s+(?:build|check)|tsc\b|(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|typecheck|verify))\b/.test(
      lower,
    )
  ) {
    return "Built and verified project";
  }
  if (/\b(?:eslint|clippy|(?:npm|pnpm|yarn)\s+(?:run\s+)?lint)\b/.test(lower)) {
    return "Ran linter";
  }
  if (/^(?:grep|rg|ag|ack)\b/.test(lower)) return "Searched codebase";
  if (/^(?:sed|cat|head|tail|awk|nl|bat)\b/.test(lower)) {
    const file = extractReadableFileFromShell(firstSegment);
    return file ? `Inspected ${file}` : "Inspected file";
  }
  if (/^(?:ls|find|tree|fd)\b/.test(lower)) return "Listed directory";
  if (/^(?:mkdir|rm|mv|cp|touch)\b/.test(lower)) {
    return "Updated workspace files";
  }

  return "Ran shell command";
}

function summarizeToolAction(
  name: string,
  args: Record<string, unknown> | null,
  explicitIntent?: string,
): string {
  const argIntent =
    args && typeof args.intent === "string" && args.intent.trim()
      ? args.intent.trim()
      : "";
  const effectiveIntent =
    (explicitIntent && explicitIntent.trim()) || argIntent;
  if (effectiveIntent && !isJsonLikeText(effectiveIntent)) {
    return effectiveIntent.length > 90
      ? `${effectiveIntent.slice(0, 87)}...`
      : effectiveIntent;
  }

  const lower = name.trim().toLowerCase();
  if (lower === "run_command" || lower === "bash" || lower === "shell") {
    const rawCmd =
      args && typeof args.command === "string" ? args.command.trim() : "";
    return rawCmd ? summarizeShellCommandLabel(rawCmd) : "Ran shell command";
  }
  if (lower === "read_file" || lower === "read") {
    const target =
      args && typeof args.path === "string"
        ? args.path
        : args && typeof args.file_path === "string"
          ? args.file_path
          : "";
    return target ? `Read ${basenameOf(target)}` : "Read file";
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
          : "";
    const verb =
      lower === "write" || lower === "write_file" ? "Wrote" : "Edited";
    return target ? `${verb} ${basenameOf(target)}` : `${verb} file`;
  }
  if (
    lower === "search_files" ||
    lower === "grep" ||
    lower === "rg" ||
    lower === "agentgrep" ||
    lower === "glob" ||
    lower === "find_files"
  ) {
    return "Searched workspace";
  }
  if (lower === "list_files" || lower === "ls" || lower === "listdir") {
    return "Listed files";
  }
  return humanizeToolName(name);
}

function summarizeHistoryToolCall(
  msg: HarnessHistoryMessageLike,
): { command: string; displayCommand: string; toolName?: string } {
  const name = msg.tool?.name ?? msg.toolName;
  const rawInput = msg.tool?.input ?? msg.toolInput;
  if (!name) {
    return { command: "Tool step", displayCommand: "Tool step" };
  }
  const input =
    rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : null;
  const label = summarizeToolAction(name, input);
  return { command: label, displayCommand: label, toolName: name };
}

function resolveAttemptStatus(
  trimmedText: string,
  explicitStatus?: TurnOutcome,
  stopReason?: string | null,
): TurnOutcome {
  const isRefusal =
    typeof stopReason === "string" &&
    /(refusal|content_filter|safety|guardrail|policy_violation)/i.test(
      stopReason,
    );
  if (explicitStatus) {
    if (explicitStatus === "answered" && trimmedText.length === 0) {
      return isRefusal ? "declined" : "failed";
    }
    return explicitStatus;
  }
  if (isRefusal) return "declined";
  return trimmedText.length > 0 ? "answered" : "failed";
}

function toUserImages(
  images?: HistoryImageView[],
): Array<{ name: string; dataUrl: string }> | undefined {
  if (!images || images.length === 0) return undefined;
  const mapped: Array<{ name: string; dataUrl: string }> = [];
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    if (!img?.data) continue;
    const dataUrl = img.data.startsWith("data:")
      ? img.data
      : `data:${img.mediaType || "image/png"};base64,${img.data}`;
    mapped.push({
      name: `Attachment ${i + 1}`.replace(" 1", ""),
      dataUrl,
    });
  }
  return mapped.length > 0 ? mapped : undefined;
}

export function mapHistoryMessagesToTurns(
  sessionId: string,
  messages: HarnessHistoryMessageLike[],
): ExecutionTurn[] {
  const turns: ExecutionTurn[] = [];
  let visibleUserMessageCount = 0;
  let currentUserMessageIndex: number | undefined;
  let currentUserPrompt: string | null = null;
  let currentUserRefFiles: string | undefined;
  let currentUserImages: Array<{ name: string; dataUrl: string }> | undefined;
  let assistantChunks: string[] = [];
  let workNotes: string[] = [];
  let timelineEntries: TraceTimelineItem[] = [];
  let toolSteps: TraceStepItem[] = [];
  let lastDurationSecs: number | undefined;
  let lastInputTokens: number | undefined;
  let lastCacheReadTokens: number | undefined;
  let lastRayuCredits: number | undefined;
  let attempts: TurnAttempt[] = [];
  let attemptIndexById = new Map<string, number>();
  let hasExplicitAttemptMeta = false;
  let hiddenInternalMessages: HiddenInternalMessage[] = [];

  const flushTurn = () => {
    if (currentUserPrompt === null) return;
    const cacheTotal = (lastInputTokens ?? 0) + (lastCacheReadTokens ?? 0);
    const kvCachePct =
      cacheTotal > 0 && lastCacheReadTokens
        ? Math.min(99, Math.round((lastCacheReadTokens / cacheTotal) * 100))
        : 94;
    const credits =
      typeof lastRayuCredits === "number"
        ? `${lastRayuCredits.toFixed(2)} cr`
        : "0.00 cr";
    const finalAttempt =
      attempts.length > 0 ? attempts[attempts.length - 1] : null;
    const finalAttemptId = finalAttempt ? finalAttempt.id : null;
    const latestAnsweredAttempt = [...attempts]
      .reverse()
      .find((attempt) => attempt.answerText.trim().length > 0);
    const answerIntro =
      finalAttempt?.answerText.trim() ||
      latestAnsweredAttempt?.answerText.trim() ||
      assistantChunks.join("\n\n").trim();
    const outcome: TurnOutcome | undefined = finalAttempt
      ? finalAttempt.answerText.trim().length > 0
        ? finalAttempt.status === "answered_partial"
          ? "answered_partial"
          : "answered"
        : finalAttempt.status === "answered"
          ? "failed"
          : finalAttempt.status
      : undefined;

    const groups: WorkStepGroup[] =
      toolSteps.length > 0
        ? [
            {
              id: `wg_${turns.length + 1}`,
              title: `Ran ${toolSteps.length} tool${toolSteps.length === 1 ? "" : "s"}`,
              steps: toolSteps,
            },
          ]
        : [];

    const timeline: TraceTimelineItem[] | undefined =
      timelineEntries.some((entry) => entry.type === "reasoning")
        ? [
            ...timelineEntries,
            ...groups.map(
              (group): TraceTimelineItem => ({ type: "group", group }),
            ),
          ]
        : undefined;

    turns.push({
      id: `hist_${sessionId}_${turns.length + 1}`,
      sessionId,
      ...(currentUserMessageIndex !== undefined
        ? { userMessageIndex: currentUserMessageIndex }
        : {}),
      userPrompt: currentUserPrompt,
      ...(currentUserRefFiles ? { userRefFiles: currentUserRefFiles } : {}),
      ...(currentUserImages ? { userImages: currentUserImages } : {}),
      workedDuration:
        typeof lastDurationSecs === "number" && lastDurationSecs > 0
          ? formatDurationSeconds(lastDurationSecs)
          : "",
      notes: workNotes,
      groups,
      ...(timeline ? { timeline } : {}),
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
    });

    currentUserPrompt = null;
    currentUserMessageIndex = undefined;
    currentUserRefFiles = undefined;
    currentUserImages = undefined;
    assistantChunks = [];
    workNotes = [];
    timelineEntries = [];
    toolSteps = [];
    lastDurationSecs = undefined;
    lastInputTokens = undefined;
    lastCacheReadTokens = undefined;
    lastRayuCredits = undefined;
    attempts = [];
    attemptIndexById = new Map();
    hasExplicitAttemptMeta = false;
    hiddenInternalMessages = [];
  };

  for (const msg of messages) {
    if (!isVisibleHistoryMessage(msg)) {
      hiddenInternalMessages.push({
        origin: msg.origin ?? "engine_internal",
        visibility: msg.visibility ?? "hidden",
        content: msg.content,
      });
      continue;
    }
  }
  const visibleMessages = filterVisibleHistory(messages);

  for (const msg of visibleMessages) {
    if (msg.role === "user") {
      if (isEngineInternalRecoveryPrompt(msg.content)) {
        hiddenInternalMessages.push({
          origin: "engine_internal",
          visibility: "hidden",
          content: msg.content,
        });
        continue;
      }
      const synthetic = classifySyntheticUserMessage(msg.content);
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
        };
        if (currentUserPrompt !== null) {
          toolSteps.push(step);
        } else if (turns.length > 0) {
          const prevTurn = turns[turns.length - 1]!;
          if (prevTurn.groups.length > 0) {
            prevTurn.groups[0]!.steps.push(step);
          } else {
            prevTurn.groups.push({
              id: `wg_${turns.length}`,
              title: synthetic.groupTitle,
              steps: [step],
            });
          }
        } else {
          currentUserPrompt = synthetic.groupTitle;
          toolSteps.push(step);
        }
        continue;
      }
      flushTurn();
      visibleUserMessageCount += 1;
      currentUserMessageIndex = visibleUserMessageCount;
      const extracted = extractActiveEditorSelectionFromPrompt(msg.content);
      currentUserPrompt = extracted.prompt;
      currentUserRefFiles = extracted.refFiles;
      currentUserImages = toUserImages(msg.images);
    } else if (msg.role === "tool") {
      if (assistantChunks.length > 0 && !hasExplicitAttemptMeta) {
        for (const chunk of assistantChunks) {
          const clean = chunk.trim();
          if (clean) {
            workNotes.push(clean);
            timelineEntries.push({
              type: "note",
              id: `hist_note_${turns.length + 1}_${timelineEntries.length + 1}`,
              text: clean,
            });
          }
        }
        assistantChunks = [];
        attempts = [];
        attemptIndexById = new Map();
      }
      const summary = summarizeHistoryToolCall(msg);
      const step: ShellCommandStep = {
        id: `tool_${turns.length}_${toolSteps.length}`,
        kind: "command",
        command: summary.command,
        displayCommand: summary.displayCommand,
        output: msg.content.slice(0, 1200),
        exitCode: 0,
        statusLabel: "Success",
        isMono: false,
        ...(summary.toolName ? { toolName: summary.toolName } : {}),
      };
      toolSteps.push(step);
    } else if (msg.role === "assistant") {
      const { reasoningNotes, answerText } = splitReasoningFromAssistantContent(
        msg.content,
      );
      for (const note of reasoningNotes) {
        workNotes.push(note);
        timelineEntries.push({
          type: "reasoning",
          id: `hist_reason_${turns.length + 1}_${timelineEntries.length + 1}`,
          text: note,
        });
      }
      const trimmed = answerText.trim();
      if (trimmed) {
        assistantChunks.push(answerText);
      }

      const rawAttemptId = msg.attemptId ?? msg.attempt_id;
      const rawAttemptReason = (msg.attemptReason ?? msg.attempt_reason) as
        | TurnAttemptReason
        | undefined;
      const rawAttemptStatus = (msg.attemptStatus ?? msg.attempt_status) as
        | TurnOutcome
        | undefined;
      const rawStopReason = msg.stopReason ?? msg.stop_reason;

      const hasExplicitAttempt =
        rawAttemptId != null ||
        rawAttemptStatus !== undefined ||
        rawStopReason != null;
      if (hasExplicitAttempt) {
        hasExplicitAttemptMeta = true;
      }
      if (trimmed.length > 0 || hasExplicitAttempt) {
        const attemptId =
          rawAttemptId ??
          (hasExplicitAttempt ? `att_${attempts.length + 1}` : "att_1");
        const existingIdx = attemptIndexById.get(attemptId);
        if (existingIdx !== undefined) {
          const existing = attempts[existingIdx]!;
          const combinedText = [existing.answerText, trimmed]
            .filter(Boolean)
            .join("\n\n");
          attempts[existingIdx] = {
            ...existing,
            reason: rawAttemptReason ?? existing.reason,
            answerText: combinedText,
            stopReason: rawStopReason ?? existing.stopReason,
            status: resolveAttemptStatus(
              combinedText,
              rawAttemptStatus ??
                (combinedText.length > 0 ? existing.status : undefined),
              rawStopReason ?? existing.stopReason,
            ),
          };
        } else {
          attemptIndexById.set(attemptId, attempts.length);
          attempts.push({
            id: attemptId,
            reason:
              rawAttemptReason ??
              (attempts.length === 0 ? "initial" : "reassess_refusal"),
            status: resolveAttemptStatus(
              trimmed,
              rawAttemptStatus,
              rawStopReason,
            ),
            answerText: trimmed,
            ...(rawStopReason !== undefined ? { stopReason: rawStopReason } : {}),
          });
        }
      }

      const camelStats = msg.responseStats;
      const snakeStats = msg.response_stats;
      if (camelStats || snakeStats) {
        lastDurationSecs =
          camelStats?.durationSecs ?? snakeStats?.duration_secs ?? lastDurationSecs;
        lastInputTokens =
          camelStats?.inputTokens ?? snakeStats?.input_tokens ?? lastInputTokens;
        lastCacheReadTokens =
          camelStats?.cacheReadTokens ??
          snakeStats?.cache_read_tokens ??
          lastCacheReadTokens;
        lastRayuCredits =
          camelStats?.rayuCredits ?? snakeStats?.rayu_credits ?? lastRayuCredits;
      }
    }
  }

  flushTurn();
  return turns;
}

export interface HarnessStreamTracker {
  toolInputs: Map<string, string>;
  startedAtMs: number;
  turnActive: boolean;
  turnCompleted: boolean;
  batchEpoch: number;
  stoppedInTurn: boolean;
  hasBufferedText: boolean;
  textDonePendingTool: boolean;
  hasStreamedTextInPhase: boolean;
  phaseHasReads: boolean;
  phaseHasCommands: boolean;
  phaseHasSearches: boolean;
  phaseCommandCount: number;
  lastCredits: string;
  lastKvCachePct: number;
}

export function createHarnessStreamTracker(): HarnessStreamTracker {
  return {
    toolInputs: new Map(),
    startedAtMs: Date.now(),
    turnActive: false,
    turnCompleted: false,
    batchEpoch: 1,
    stoppedInTurn: false,
    hasBufferedText: false,
    textDonePendingTool: false,
    hasStreamedTextInPhase: false,
    phaseHasReads: false,
    phaseHasCommands: false,
    phaseHasSearches: false,
    phaseCommandCount: 0,
    lastCredits: "0.00 cr",
    lastKvCachePct: 94,
  };
}

function resetTrackerPhase(tracker: HarnessStreamTracker): void {
  tracker.phaseHasReads = false;
  tracker.phaseHasCommands = false;
  tracker.phaseHasSearches = false;
  tracker.phaseCommandCount = 0;
}

function computePhaseGroupTitle(tracker: HarnessStreamTracker): string {
  const hasReadOrSearch = tracker.phaseHasReads || tracker.phaseHasSearches;
  if (hasReadOrSearch && tracker.phaseHasCommands) {
    return "Read files, ran commands";
  }
  if (tracker.phaseHasReads) {
    return "Read files";
  }
  if (tracker.phaseHasSearches) {
    return "Searched files";
  }
  if (tracker.phaseHasCommands) {
    return tracker.phaseCommandCount > 1 ? "Ran commands" : "Ran a command";
  }
  return "Read files, ran commands";
}

interface ParsedBatchOutputSection {
  index: number;
  tool: string;
  output: string;
  isError: boolean;
}

function splitBatchOutputSections(rawOutput: string): ParsedBatchOutputSection[] {
  if (!rawOutput.trim()) return [];
  const cleaned = rawOutput.replace(/^\[batch timing:[^\]]*\]\s*/i, "");
  const headerRegex = /---\s*\[(\d+)\]\s*([^\n-]+?)\s*---/g;
  const matches: Array<{
    index: number;
    tool: string;
    start: number;
    contentStart: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(cleaned)) !== null) {
    matches.push({
      index: Number.parseInt(m[1] ?? "0", 10),
      tool: (m[2] ?? "tool").trim(),
      start: m.index,
      contentStart: m.index + m[0].length,
    });
  }
  if (matches.length === 0) return [];
  return matches.map((cur, idx) => {
    const nextStart =
      idx + 1 < matches.length ? matches[idx + 1]!.start : cleaned.length;
    const sectionText = cleaned.slice(cur.contentStart, nextStart).trim();
    return {
      index: cur.index,
      tool: cur.tool,
      output: sectionText,
      isError: /^error:/i.test(sectionText),
    };
  });
}

function extractBatchSubcallArgs(entry: Record<string, unknown>): {
  tool: string;
  args: Record<string, unknown>;
} {
  const tool =
    typeof entry.tool === "string" && entry.tool.trim()
      ? entry.tool.trim()
      : typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : typeof entry.tool_name === "string" && entry.tool_name.trim()
          ? entry.tool_name.trim()
          : "tool";
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
      : null);

  const merged: Record<string, unknown> = { ...(nested ?? {}) };
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
      continue;
    }
    if (merged[k] === undefined) {
      merged[k] = v;
    }
  }
  return { tool, args: merged };
}

function mapSingleWorkStep(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  output: string,
  error: string | undefined,
  tracker: HarnessStreamTracker,
  explicitIntent?: string,
): TraceStepItem {
  const lower = name.toLowerCase();
  const intent =
    (explicitIntent && explicitIntent.trim()) ||
    (typeof args.intent === "string" && args.intent.trim()
      ? args.intent.trim()
      : "");

  if (lower === "read_file" || lower === "read") {
    tracker.phaseHasReads = true;
    const relPath =
      typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
          ? args.file_path
          : "file";
    const startLine =
      typeof args.start_line === "number"
        ? args.start_line
        : typeof args.offset === "number"
          ? args.offset
          : 1;
    const endLine = typeof args.end_line === "number" ? args.end_line : null;
    const displayLabel = endLine ? `${relPath}:${startLine}-${endLine}` : relPath;
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
    };
    return fileStep;
  }

  if (
    lower === "edit_file" ||
    lower === "write_file" ||
    lower === "edit" ||
    lower === "write" ||
    lower === "apply_patch"
  ) {
    tracker.phaseHasReads = true;
    const relPath =
      typeof args.file_path === "string"
        ? args.file_path
        : typeof args.path === "string"
          ? args.path
          : "file";
    const fileStep: FileReadStep = {
      id: callId,
      kind: "read",
      label: lower === "write" || lower === "write_file" ? "Wrote" : "Edited",
      files: [
        {
          file: basenameOf(relPath),
          path: relPath,
          line: 1,
          rangeLabel: relPath,
        },
      ],
    };
    return fileStep;
  }

  if (lower === "list_files" || lower === "ls" || lower === "listdir") {
    tracker.phaseHasReads = true;
    const rawDir =
      typeof args.directory === "string"
        ? args.directory.trim()
        : typeof args.path === "string"
          ? args.path.trim()
          : "";
    const hasSubdir = Boolean(rawDir && rawDir !== "." && rawDir !== "./");
    const listStep: ListStep = {
      id: callId,
      kind: "list",
      text: hasSubdir ? "Listed files in" : "Listed files",
      ...(hasSubdir ? { highlight: rawDir } : {}),
    };
    return listStep;
  }

  if (
    lower === "search_files" ||
    lower === "grep" ||
    lower === "rg" ||
    lower === "agentgrep" ||
    lower === "glob" ||
    lower === "find_files"
  ) {
    tracker.phaseHasSearches = true;
    const query =
      typeof args.query === "string"
        ? args.query
        : typeof args.pattern === "string"
          ? args.pattern
          : "workspace";
    const searchStep: ListStep = {
      id: callId,
      kind: "search",
      text:
        lower === "glob" || lower === "find_files"
          ? "Found files matching"
          : "Searched for",
      highlight: query,
    };
    return searchStep;
  }

  if (lower === "webfetch" || lower === "websearch") {
    tracker.phaseHasSearches = true;
    const target =
      typeof args.url === "string"
        ? args.url
        : typeof args.query === "string"
          ? args.query
          : name;
    const webStep: ListStep = {
      id: callId,
      kind: "search",
      text: lower === "websearch" ? "Searched web for" : "Fetched",
      highlight: target,
    };
    return webStep;
  }

  if (lower === "todo" || lower === "todowrite") {
    tracker.phaseHasReads = true;
    const todoStep: ListStep = {
      id: callId,
      kind: "list",
      text: intent || "Updated task list",
    };
    return todoStep;
  }

  // Shell commands & fallback tool calls — always show concise human-readable action label,
  // never raw shell flag pipelines or raw JSON tool parameters.
  tracker.phaseHasCommands = true;
  tracker.phaseCommandCount += 1;

  const actionLabel = summarizeToolAction(name, args, intent);
  const displayCommand = error ? `${actionLabel} (failed)` : actionLabel;

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
    toolName: name,
    ...(intent && !isJsonLikeText(intent) ? { intent } : {}),
  };
  return shellStep;
}

export function mapHarnessFrameToLiveEvents(
  frame: Record<string, unknown>,
  tracker: HarnessStreamTracker,
): MappedLiveTraceEvent[] {
  const ev = typeof frame.ev === "string" ? frame.ev : "";

  if (ev === "turn_start" || ev === "message_accepted") {
    tracker.startedAtMs = Date.now();
    tracker.turnActive = true;
    tracker.turnCompleted = false;
    tracker.batchEpoch = 1;
    tracker.stoppedInTurn = false;
    tracker.hasBufferedText = false;
    tracker.textDonePendingTool = false;
    tracker.hasStreamedTextInPhase = false;
    resetTrackerPhase(tracker);
    tracker.toolInputs.clear();
    return [];
  }

  if (
    !tracker.turnActive &&
    (ev === "text_delta" ||
      ev === "text_replace" ||
      ev === "reasoning_delta" ||
      ev === "thinking_delta" ||
      ev === "tool_start" ||
      ev === "tool_exec" ||
      ev === "tool_call")
  ) {
    tracker.startedAtMs = Date.now();
    tracker.turnActive = true;
    tracker.turnCompleted = false;
    tracker.stoppedInTurn = false;
  }

  switch (ev) {
    case "text_delta": {
      tracker.turnCompleted = false;
      const text = typeof frame.text === "string" ? frame.text : "";
      if (text) {
        if (text.trim()) {
          tracker.hasBufferedText = true;
        }
        tracker.hasStreamedTextInPhase = true;
        return [{ type: "answer-delta", delta: text }];
      }
      return [];
    }
    case "text_replace": {
      tracker.turnCompleted = false;
      const text = typeof frame.text === "string" ? frame.text : "";
      const hasContent = Boolean(text.trim());
      tracker.hasBufferedText = hasContent;
      tracker.hasStreamedTextInPhase = hasContent;
      tracker.textDonePendingTool = false;
      return [{ type: "answer-replace", text }];
    }
    case "text_done": {
      tracker.textDonePendingTool = tracker.hasBufferedText;
      const stopReason =
        typeof frame.stop_reason === "string" && frame.stop_reason.trim()
          ? frame.stop_reason.trim()
          : undefined;
      if (stopReason) {
        (
          tracker as HarnessStreamTracker & { lastStopReason?: string }
        ).lastStopReason = stopReason;
      }
      return [];
    }
    case "promote_answer_to_note": {
      tracker.hasBufferedText = false;
      tracker.textDonePendingTool = false;
      tracker.hasStreamedTextInPhase = false;
      tracker.batchEpoch += 1;
      resetTrackerPhase(tracker);
      return [{ type: "promote-note" }];
    }
    case "reasoning_delta":
    case "thinking_delta": {
      tracker.turnCompleted = false;
      const text =
        typeof frame.text === "string"
          ? frame.text
          : typeof frame.delta === "string"
            ? frame.delta
            : "";
      if (text && !isSyntheticReasoningPlaceholder(text)) {
        return [{ type: "reasoning-delta", delta: text }];
      }
      return [];
    }
    case "reasoning_done":
      return [];
    case "tool_start":
    case "tool_exec": {
      const callId = String(frame.call_id ?? "");
      const name = String(frame.name ?? "tool");
      const intent = typeof frame.intent === "string" ? frame.intent : undefined;
      const args = parseToolArgs(
        frame.tool_input ?? frame.input,
        ev === "tool_exec" && callId ? (tracker.toolInputs.get(callId) ?? "") : "",
      );
      if (callId && Object.keys(args).length > 0) {
        tracker.toolInputs.set(callId, JSON.stringify(args));
      } else if (callId && ev === "tool_start") {
        tracker.toolInputs.set(callId, "");
      }
      const events: MappedLiveTraceEvent[] = [];
      if (
        tracker.hasStreamedTextInPhase ||
        tracker.textDonePendingTool ||
        tracker.hasBufferedText
      ) {
        tracker.hasStreamedTextInPhase = false;
        tracker.hasBufferedText = false;
        tracker.textDonePendingTool = false;
        tracker.batchEpoch += 1;
        resetTrackerPhase(tracker);
        events.push({ type: "promote-note" });
      }
      events.push({
        type: "tool-status",
        label: describeActiveTool(name, args, intent),
      });
      return events;
    }
    case "connection_phase": {
      const phase = typeof frame.phase === "string" ? frame.phase : null;
      return [{ type: "connection-phase", phase }];
    }
    case "kv_cache_miss": {
      const reason = String(
        frame.message ?? frame.reason ?? "Prompt cache miss",
      );
      return [{ type: "kv-cache-miss", reason }];
    }
    case "tool_input_delta": {
      const callId = String(frame.call_id ?? "");
      const delta = typeof frame.delta === "string" ? frame.delta : "";
      if (callId && delta) {
        tracker.toolInputs.set(
          callId,
          `${tracker.toolInputs.get(callId) ?? ""}${delta}`,
        );
      }
      return [];
    }
    case "tool_call": {
      const callId = String(frame.call_id ?? "");
      if (callId && frame.input !== undefined) {
        const serialized =
          typeof frame.input === "string"
            ? frame.input
            : JSON.stringify(frame.input);
        tracker.toolInputs.set(callId, serialized);
      }
      if (
        tracker.hasStreamedTextInPhase ||
        tracker.textDonePendingTool ||
        tracker.hasBufferedText
      ) {
        tracker.hasStreamedTextInPhase = false;
        tracker.hasBufferedText = false;
        tracker.textDonePendingTool = false;
        tracker.batchEpoch += 1;
        resetTrackerPhase(tracker);
        return [{ type: "promote-note" }];
      }
      return [];
    }
    case "tool_done": {
      const callId = String(frame.call_id ?? `call_${Date.now()}`);
      const name = String(frame.name ?? "tool");
      const lower = name.toLowerCase();
      const intent = typeof frame.intent === "string" ? frame.intent : undefined;
      const output =
        typeof frame.tool_output === "string"
          ? frame.tool_output
          : typeof frame.output === "string"
            ? frame.output
            : "";
      const error = typeof frame.error === "string" ? frame.error : undefined;
      const args = parseToolArgs(
        frame.tool_input ?? frame.input,
        tracker.toolInputs.get(callId) ?? "",
      );

      const epoch = tracker.batchEpoch;
      const workGroupId = `codex_work_${epoch}`;

      if (lower === "batch") {
        const rawCalls = Array.isArray(args.tool_calls)
          ? args.tool_calls.filter(
              (c): c is Record<string, unknown> =>
                Boolean(c) && typeof c === "object" && !Array.isArray(c),
            )
          : [];
        const sections = splitBatchOutputSections(output);
        const events: MappedLiveTraceEvent[] = [{ type: "tool-status", label: null }];

        if (rawCalls.length > 0) {
          for (let i = 0; i < rawCalls.length; i += 1) {
            const { tool: subTool, args: subArgs } = extractBatchSubcallArgs(
              rawCalls[i]!,
            );
            const section = sections[i];
            const subOutput = section?.output ?? (i === 0 ? output : "");
            const subError =
              error ?? (section?.isError ? section.output : undefined);
            const step = mapSingleWorkStep(
              `${callId}_${i + 1}`,
              subTool,
              subArgs,
              subOutput,
              subError,
              tracker,
            );
            events.push({
              type: "step",
              groupId: workGroupId,
              groupTitle: computePhaseGroupTitle(tracker),
              step,
            });
          }
          return events;
        }

        if (sections.length > 0) {
          for (let i = 0; i < sections.length; i += 1) {
            const section = sections[i]!;
            const step = mapSingleWorkStep(
              `${callId}_${i + 1}`,
              section.tool,
              {},
              section.output,
              section.isError ? section.output : error,
              tracker,
            );
            events.push({
              type: "step",
              groupId: workGroupId,
              groupTitle: computePhaseGroupTitle(tracker),
              step,
            });
          }
          return events;
        }

        if (error) {
          tracker.phaseHasCommands = true;
          tracker.phaseCommandCount += 1;
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
            toolName: "batch",
          };
          events.push({
            type: "step",
            groupId: workGroupId,
            groupTitle: computePhaseGroupTitle(tracker),
            step: retryStep,
          });
        }
        return events;
      }

      if (lower === "create_powerpoint" && !error) {
        const deckTitle =
          typeof args.title === "string" && args.title.trim()
            ? args.title.trim()
            : "Presentation";
        const rawPath =
          typeof args.file_path === "string"
            ? args.file_path
            : typeof args.filePath === "string"
              ? args.filePath
              : "";
        const slideCount = Array.isArray(args.slides)
          ? args.slides.length
          : undefined;
        const pillLabel = deckTitle || "Slide";
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
        };
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
              ...(rawPath ? { filePath: rawPath } : {}),
            },
          },
        ];
      }

      if ((lower === "write_excel" || lower === "read_excel") && !error) {
        const rawPath =
          typeof args.file_path === "string"
            ? args.file_path
            : typeof args.filePath === "string"
              ? args.filePath
              : typeof args.path === "string"
                ? args.path
                : "workbook.xlsx";
        const fileName = basenameOf(rawPath);
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
        };
        const events: MappedLiveTraceEvent[] = [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `codex_excel_${epoch}`,
            groupTitle:
              lower === "write_excel" ? "Updated spreadsheet" : "Read spreadsheet",
            step: excelStep,
          },
        ];
        if (lower === "write_excel") {
          events.push({
            type: "artifact",
            artifact: {
              kind: "excel",
              title: fileName,
              subtitle: rawPath || "Excel workbook (.xlsx)",
              pillLabel: fileName,
              ...(rawPath ? { filePath: rawPath } : {}),
            },
          });
        }
        return events;
      }

      if (lower.startsWith("browser_")) {
        let browserCmd = name;
        if (lower === "browser_navigate" && typeof args.url === "string") {
          browserCmd = `Navigate to ${args.url}`;
        } else if (lower === "browser_snapshot") {
          browserCmd = "Inspect page snapshot";
        } else if (lower === "browser_click" && typeof args.ref === "string") {
          browserCmd = `Click ${args.ref}`;
        } else if (lower === "browser_type" && typeof args.ref === "string") {
          browserCmd = `Type into ${args.ref}`;
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
          toolName: name,
          ...(intent ? { intent } : {}),
        };
        return [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `codex_browser_${epoch}`,
            groupTitle: "Used the browser",
            step: browserStep,
          },
        ];
      }

      const durationMs =
        typeof frame.duration_ms === "number" && Number.isFinite(frame.duration_ms)
          ? Math.max(0, Math.round(frame.duration_ms))
          : undefined;
      const step = mapSingleWorkStep(
        callId,
        name,
        args,
        output,
        error,
        tracker,
        intent,
      );
      const enrichedStep: TraceStepItem =
        step.kind === "command" && durationMs !== undefined
          ? { ...step, durationMs }
          : step;
      return [
        { type: "tool-status", label: null },
        {
          type: "step",
          groupId: workGroupId,
          groupTitle: computePhaseGroupTitle(tracker),
          step: enrichedStep,
        },
      ];
    }
    case "permission_request": {
      const requestId = String(frame.request_id ?? "");
      if (!requestId) return [];
      const sessionId =
        typeof frame.session_id === "string" ? frame.session_id : "";
      const toolName = String(frame.tool_name ?? "tool");
      const description =
        typeof frame.description === "string" && frame.description.trim()
          ? frame.description.trim()
          : `Allow RayuCode to run ${toolName}?`;
      const rawTier = frame.risk_tier;
      const riskTier: PermissionRiskTier | undefined =
        rawTier === "safe" ||
        rawTier === "bounded" ||
        rawTier === "confirm" ||
        rawTier === "catastrophic"
          ? rawTier
          : rawTier === "hard_deny"
            ? "catastrophic"
            : undefined;
      return [
        {
          type: "permission-request",
          sessionId,
          requestId,
          toolName,
          description,
          riskTier,
        },
      ];
    }
    case "token_usage": {
      const input = typeof frame.input === "number" ? frame.input : 0;
      const cacheRead =
        typeof frame.cache_read_input === "number" ? frame.cache_read_input : 0;
      const total = input + cacheRead;
      if (total > 0) {
        tracker.lastKvCachePct = Math.min(
          99,
          Math.round((cacheRead / total) * 100),
        );
      }
      return [];
    }
    case "rayu_credits": {
      const turnCredits =
        typeof frame.turn_credits === "number" ? frame.turn_credits : undefined;
      if (turnCredits !== undefined) {
        tracker.lastCredits = `${turnCredits.toFixed(2)} cr`;
      }
      return [];
    }
    case "provider_guardrail": {
      tracker.turnCompleted = false;
      const message =
        typeof frame.message === "string" && frame.message.trim()
          ? frame.message.trim()
          : "The model declined this request.";
      return [{ type: "answer-delta", delta: `\n\n${message}` }];
    }
    case "error": {
      const settled = settleHarnessErrorFrame(frame, tracker, () => {
        tracker.stoppedInTurn = true;
        tracker.hasBufferedText = false;
        tracker.textDonePendingTool = false;
        tracker.hasStreamedTextInPhase = false;
        tracker.batchEpoch = 1;
        tracker.toolInputs.clear();
        resetTrackerPhase(tracker);
      });
      if (!settled) {
        return [];
      }
      return [
        { type: "tool-status", label: null },
        { type: "connection-phase", phase: null },
        {
          type: "answer-delta",
          delta: `\n\n**Error:** ${settled.message}`,
        },
        {
          type: "complete",
          workedDuration: settled.workedDuration,
          credits: settled.credits,
          kvCachePct: settled.kvCachePct,
          timestamp: "Just now",
        },
      ];
    }
    case "turn_stopped": {
      if (tracker.turnCompleted || tracker.stoppedInTurn) {
        return [];
      }
      tracker.turnCompleted = true;
      tracker.stoppedInTurn = true;
      const wireDurationSec =
        typeof frame.duration_secs === "number" &&
        Number.isFinite(frame.duration_secs) &&
        frame.duration_secs > 0
          ? frame.duration_secs
          : typeof frame.duration_ms === "number" &&
              Number.isFinite(frame.duration_ms) &&
              frame.duration_ms > 0
            ? frame.duration_ms / 1000
            : undefined;
      const elapsedSec =
        wireDurationSec ??
        Math.max(1, Math.floor((Date.now() - tracker.startedAtMs) / 1000));
      const reason =
        typeof frame.reason === "string" ? frame.reason : undefined;
      const message =
        typeof frame.message === "string" ? frame.message : undefined;
      tracker.batchEpoch = 1;
      tracker.turnActive = false;
      tracker.hasBufferedText = false;
      tracker.textDonePendingTool = false;
      tracker.hasStreamedTextInPhase = false;
      tracker.toolInputs.clear();
      resetTrackerPhase(tracker);
      const events: MappedLiveTraceEvent[] = [
        { type: "tool-status", label: null },
        { type: "connection-phase", phase: null },
        { type: "turn-stopped", reason, message },
      ];
      if (typeof frame.message === "string" && frame.message.trim()) {
        if (frame.reason === "failure") {
          events.push({
            type: "answer-delta",
            delta: `\n\n**Error:** ${frame.message.trim()}`,
          });
        } else if (
          frame.reason !== "user_cancel" &&
          frame.reason !== "cancelled"
        ) {
          events.push({
            type: "answer-delta",
            delta: `\n\n${frame.message.trim()}`,
          });
        }
      }
      const lastStopReason = (
        tracker as HarnessStreamTracker & { lastStopReason?: string }
      ).lastStopReason;
      events.push({
        type: "complete",
        workedDuration: formatDurationSeconds(elapsedSec),
        credits: tracker.lastCredits,
        kvCachePct: tracker.lastKvCachePct,
        ...(lastStopReason ? { stopReason: lastStopReason } : {}),
        timestamp: "Just now",
      });
      (
        tracker as HarnessStreamTracker & { lastStopReason?: string }
      ).lastStopReason = undefined;
      return events;
    }
    case "turn_done": {
      if (tracker.turnCompleted || tracker.stoppedInTurn) {
        tracker.stoppedInTurn = false;
        return [];
      }
      tracker.turnCompleted = true;
      const wireDurationSec =
        typeof frame.duration_secs === "number" &&
        Number.isFinite(frame.duration_secs) &&
        frame.duration_secs > 0
          ? frame.duration_secs
          : typeof frame.duration_ms === "number" &&
              Number.isFinite(frame.duration_ms) &&
              frame.duration_ms > 0
            ? frame.duration_ms / 1000
            : undefined;
      const elapsedSec =
        wireDurationSec ??
        Math.max(1, Math.floor((Date.now() - tracker.startedAtMs) / 1000));
      const lastStopReason = (
        tracker as HarnessStreamTracker & { lastStopReason?: string }
      ).lastStopReason;
      (
        tracker as HarnessStreamTracker & { lastStopReason?: string }
      ).lastStopReason = undefined;
      tracker.batchEpoch = 1;
      tracker.turnActive = false;
      tracker.hasBufferedText = false;
      tracker.textDonePendingTool = false;
      tracker.hasStreamedTextInPhase = false;
      tracker.toolInputs.clear();
      resetTrackerPhase(tracker);
      return [
        { type: "tool-status", label: null },
        { type: "connection-phase", phase: null },
        {
          type: "complete",
          workedDuration: formatDurationSeconds(elapsedSec),
          credits: tracker.lastCredits,
          kvCachePct: tracker.lastKvCachePct,
          ...(lastStopReason ? { stopReason: lastStopReason } : {}),
          timestamp: "Just now",
        },
      ];
    }
    default:
      return [];
  }
}

export { formatDurationSeconds };
