import type { PermissionModeId, RiskTier } from "@shared/vscodeProtocol";
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
}

export type TraceStepItem = FileReadStep | ListStep | ShellCommandStep;

export interface WorkStepGroup {
  id: string;
  title: string;
  steps: TraceStepItem[];
}

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

export interface ExecutionTurn {
  id: string;
  sessionId: string;
  userPrompt: string;
  workedDuration: string;
  notes: string[];
  groups: WorkStepGroup[];
  answerIntro: string;
  answerBullets: string[];
  diffCard: InlineDiffCardData;
  artifacts?: TurnOutputArtifact[];
  timestamp: string;
  credits: string;
  kvCachePct: number;
  pinned: boolean;
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
  response_stats?: {
    duration_secs?: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    rayu_credits?: number;
  };
}

export interface PendingPermissionRequest {
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  riskTier?: RiskTier;
  command?: string;
  permissionMode?: PermissionModeId;
}

export type MappedLiveTraceEvent =
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
      riskTier?: RiskTier;
    }
  | { type: "answer-delta"; delta: string }
  | { type: "duration"; workedDuration: string }
  | {
      type: "complete";
      workedDuration: string;
      credits?: string;
      kvCachePct?: number;
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
  if (intent && intent.trim()) return intent.trim();
  const lower = name.toLowerCase();
  if (lower === "read_file" || lower === "read") {
    const p = typeof args.path === "string" ? args.path : "";
    return p ? `Reading ${basenameOf(p)}...` : "Reading files...";
  }
  if (lower === "list_files" || lower === "ls") {
    const d = typeof args.directory === "string" ? args.directory : "";
    return d && d !== "." ? `Listing files in ${d}...` : "Listing workspace files...";
  }
  if (lower === "search_files" || lower === "grep" || lower === "rg") {
    const q = typeof args.query === "string" ? args.query : "";
    return q ? `Searching for "${q}"...` : "Searching files...";
  }
  if (lower === "run_command" || lower === "bash" || lower === "shell") {
    return "Running command...";
  }
  if (lower === "edit_file" || lower === "write_file" || lower === "apply_patch") {
    const p = typeof args.path === "string" ? args.path : "";
    return p ? `Editing ${basenameOf(p)}...` : "Editing files...";
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

export function mapHistoryMessagesToTurns(
  sessionId: string,
  messages: HarnessHistoryMessageLike[],
): ExecutionTurn[] {
  const turns: ExecutionTurn[] = [];
  let currentUserPrompt: string | null = null;
  let assistantChunks: string[] = [];
  let toolSteps: TraceStepItem[] = [];
  let lastStats: HarnessHistoryMessageLike["response_stats"];

  const flushTurn = () => {
    if (currentUserPrompt === null) return;
    const stats = lastStats;
    const cacheTotal =
      (stats?.input_tokens ?? 0) + (stats?.cache_read_tokens ?? 0);
    const kvCachePct =
      cacheTotal > 0 && stats?.cache_read_tokens
        ? Math.min(99, Math.round((stats.cache_read_tokens / cacheTotal) * 100))
        : 94;
    const credits =
      typeof stats?.rayu_credits === "number"
        ? `${stats.rayu_credits.toFixed(2)} cr`
        : "0.00 cr";

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
    });
    currentUserPrompt = null;
    assistantChunks = [];
    toolSteps = [];
    lastStats = undefined;
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      flushTurn();
      currentUserPrompt = msg.content;
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
      };
      toolSteps.push(step);
    } else if (msg.role === "assistant") {
      if (msg.content.trim()) {
        assistantChunks.push(msg.content);
      }
      if (msg.response_stats) {
        lastStats = msg.response_stats;
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
  batchEpoch: number;
  lastCredits?: string;
  lastKvCachePct?: number;
}

export function createHarnessStreamTracker(): HarnessStreamTracker {
  return {
    toolInputs: new Map(),
    startedAtMs: Date.now(),
    turnActive: false,
    batchEpoch: 1,
  };
}

export function mapHarnessFrameToLiveEvents(
  frame: Record<string, unknown>,
  tracker: HarnessStreamTracker,
): MappedLiveTraceEvent[] {
  const ev = typeof frame.ev === "string" ? frame.ev : "";

  if (ev === "turn_start") {
    tracker.startedAtMs = Date.now();
    tracker.turnActive = true;
    tracker.batchEpoch = 1;
    tracker.toolInputs.clear();
    return [];
  }

  if (
    !tracker.turnActive &&
    (ev === "text_delta" ||
      ev === "reasoning_delta" ||
      ev === "tool_start" ||
      ev === "tool_call")
  ) {
    tracker.startedAtMs = Date.now();
    tracker.turnActive = true;
  }

  switch (ev) {
    case "text_delta": {
      const text = typeof frame.text === "string" ? frame.text : "";
      return text ? [{ type: "answer-delta", delta: text }] : [];
    }
    case "promote_answer_to_note": {
      tracker.batchEpoch += 1;
      return [{ type: "promote-note" }];
    }
    case "reasoning_delta":
    case "reasoning_done":
      return [];
    case "tool_start": {
      const callId = String(frame.call_id ?? "");
      const name = String(frame.name ?? "tool");
      const intent = typeof frame.intent === "string" ? frame.intent : undefined;
      const args = parseToolArgs(frame.tool_input ?? frame.input);
      if (callId) {
        tracker.toolInputs.set(
          callId,
          Object.keys(args).length > 0 ? JSON.stringify(args) : "",
        );
      }
      return [{ type: "tool-status", label: describeActiveTool(name, args, intent) }];
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

      if (lower === "read_file" || lower === "read") {
        const relPath =
          typeof args.path === "string"
            ? args.path
            : typeof args.file_path === "string"
              ? args.file_path
              : "file";
        const startLine =
          typeof args.start_line === "number" ? args.start_line : 1;
        const endLine = typeof args.end_line === "number" ? args.end_line : null;
        const fileStep: FileReadStep = {
          id: callId,
          kind: "read",
          label: "Read",
          files: [
            {
              file: basenameOf(relPath),
              path: relPath,
              line: startLine,
              rangeLabel: endLine ? `${relPath}:${startLine}-${endLine}` : relPath,
            },
          ],
        };
        return [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `read_${epoch}`,
            groupTitle: "Read files",
            step: fileStep,
          },
        ];
      }

      if (lower === "list_files" || lower === "ls") {
        const dir =
          typeof args.directory === "string" && args.directory.trim() !== "."
            ? args.directory.trim()
            : "workspace";
        const listStep: ListStep = {
          id: callId,
          kind: "list",
          text: "Listed files in",
          highlight: dir,
        };
        return [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `read_${epoch}`,
            groupTitle: "Read files",
            step: listStep,
          },
        ];
      }

      if (lower === "search_files" || lower === "grep" || lower === "rg") {
        const query =
          typeof args.query === "string"
            ? args.query
            : typeof args.pattern === "string"
              ? args.pattern
              : "workspace";
        const searchStep: ListStep = {
          id: callId,
          kind: "search",
          text: "Searched for",
          highlight: query,
        };
        return [
          { type: "tool-status", label: null },
          {
            type: "step",
            groupId: `search_${epoch}`,
            groupTitle: "Searched files",
            step: searchStep,
          },
        ];
      }

      let displayCommand = intent || name;
      if (typeof args.command === "string") {
        displayCommand = args.command;
      } else if (typeof args.path === "string") {
        displayCommand = `${name} ${args.path}`;
      }

      const isShell =
        lower === "run_command" || lower === "bash" || lower === "shell";
      const step: ShellCommandStep = {
        id: callId,
        kind: "command",
        command: displayCommand,
        displayCommand,
        output: (error ?? output).slice(0, 2400) || "(no output)",
        exitCode: error ? 1 : 0,
        statusLabel: error ? "Failed" : "Success",
        isFailed: Boolean(error),
        isMono: isShell,
        toolName: name,
        intent,
      };
      return [
        { type: "tool-status", label: null },
        {
          type: "step",
          groupId: isShell ? `cmd_${epoch}` : `tool_${epoch}`,
          groupTitle: isShell ? "Ran a command" : intent || `Used ${name}`,
          step,
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
      const riskTier =
        frame.risk_tier === "safe" ||
        frame.risk_tier === "bounded" ||
        frame.risk_tier === "confirm" ||
        frame.risk_tier === "hard_deny"
          ? frame.risk_tier
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
    case "turn_done":
    case "turn_stopped": {
      const elapsedSec = Math.max(
        1,
        Math.round((Date.now() - tracker.startedAtMs) / 1000),
      );
      const events: MappedLiveTraceEvent[] = [{ type: "tool-status", label: null }];
      if (
        ev === "turn_stopped" &&
        frame.reason === "failure" &&
        typeof frame.message === "string" &&
        frame.message.trim()
      ) {
        events.push({
          type: "answer-delta",
          delta: `\n\n**Error:** ${frame.message.trim()}`,
        });
      }
      events.push({
        type: "complete",
        workedDuration: formatDurationSeconds(elapsedSec),
        credits: tracker.lastCredits,
        kvCachePct: tracker.lastKvCachePct,
        timestamp: "Just now",
      });
      tracker.turnActive = false;
      tracker.toolInputs.clear();
      return events;
    }
    default:
      return [];
  }
}

export { formatDurationSeconds };
