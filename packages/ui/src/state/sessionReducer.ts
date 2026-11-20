/**
 * Deterministic Harness API v1.12 session state reducer shared by RayuCode Web
 * (Next.js) and the VS Code Extension Webview.
 *
 * Uses `RayuCreditsAccumulator` from `@rayu-dev/rayucode-sdk/browser` so live
 * streaming and persisted per-turn credit totals match the Rust CLI/TUI exact
 * to micro-credits.
 */

import {
  RayuCreditsAccumulator,
  isKnownEvent,
  type AnyApiEvent,
  type HistoryMessage,
  type ModelRouteInfo,
  type ResponseStats,
  type SessionInfo,
  type TodoSnapshot,
  type TurnStopReason,
} from "@rayu-dev/rayucode-sdk/browser";

export type ToolExecutionStatus = "pending" | "running" | "done" | "error";

export interface ToolExecutionItem {
  callId: string;
  name: string;
  inputText: string;
  input?: unknown;
  output?: string;
  error?: string;
  status: ToolExecutionStatus;
}

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  reasoningDurationSecs?: number;
  tools: ToolExecutionItem[];
  responseStats?: ResponseStats;
  streaming?: boolean;
  messageId?: string;
}

export interface PendingPermission {
  requestId: string;
  sessionId: string;
  toolName: string;
  description: string;
}

export interface BackgroundTaskActivity {
  taskId: string;
  label: string;
  summary: string;
  percent?: number;
  done: boolean;
}

export interface TokenUsageState {
  input: number;
  output: number;
  cacheReadInput?: number;
  cacheCreationInput?: number;
  effectiveBudget?: number;
}

export interface ChatSessionState {
  sessionId: string | null;
  sessionTitle: string;
  status: string;
  connectionPhase: string;
  isStreaming: boolean;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  authMethod?: string;
  accountLabel?: string;
  routes: ModelRouteInfo[];
  entries: TranscriptEntry[];
  pendingPermissions: PendingPermission[];
  backgroundTasks: Record<string, BackgroundTaskActivity>;
  todoState?: TodoSnapshot;
  tokenUsage?: TokenUsageState;
  liveTurnCredits?: number;
  lastTurnStopReason?: TurnStopReason;
  lastError?: string;
  sessions: SessionInfo[];
}

export function createInitialSessionState(sessionId: string | null = null): ChatSessionState {
  return {
    sessionId,
    sessionTitle: "New Session",
    status: "idle",
    connectionPhase: "connected",
    isStreaming: false,
    routes: [],
    entries: [],
    pendingPermissions: [],
    backgroundTasks: {},
    sessions: [],
  };
}

export function hydrateHistoryMessages(messages: HistoryMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === "user") {
      entries.push({
        id: `hist-${i}`,
        role: "user",
        content: msg.content,
        tools: [],
      });
    } else if (msg.role === "assistant") {
      entries.push({
        id: `hist-${i}`,
        role: "assistant",
        content: msg.content,
        tools: [],
        responseStats: msg.response_stats,
      });
    } else if (msg.role === "tool") {
      const last = entries[entries.length - 1];
      const toolEntry: ToolExecutionItem = {
        callId: `hist-tool-${i}`,
        name: "tool",
        inputText: "",
        output: msg.content,
        status: "done",
      };
      if (last && last.role === "assistant") {
        last.tools = [...last.tools, toolEntry];
      } else {
        entries.push({
          id: `hist-${i}`,
          role: "assistant",
          content: "",
          tools: [toolEntry],
        });
      }
    }
  }
  return entries;
}

function ensureStreamingAssistant(
  entries: TranscriptEntry[],
  messageId?: string,
): { entries: TranscriptEntry[]; index: number } {
  if (messageId) {
    const existingIdx = entries.findIndex(
      (e) => e.role === "assistant" && e.messageId === messageId,
    );
    if (existingIdx !== -1) {
      return { entries: [...entries], index: existingIdx };
    }
  }
  const lastIdx = entries.length - 1;
  const last = lastIdx >= 0 ? entries[lastIdx] : undefined;
  if (last && last.role === "assistant" && last.streaming) {
    return { entries: [...entries], index: lastIdx };
  }
  const next: TranscriptEntry = {
    id: `turn-${entries.length + 1}`,
    role: "assistant",
    content: "",
    tools: [],
    streaming: true,
    messageId,
  };
  return { entries: [...entries, next], index: entries.length };
}

export function appendLocalUserMessage(
  state: ChatSessionState,
  content: string,
): ChatSessionState {
  return {
    ...state,
    isStreaming: true,
    liveTurnCredits: undefined,
    lastError: undefined,
    lastTurnStopReason: undefined,
    entries: [
      ...state.entries,
      {
        id: `local-user-${state.entries.length + 1}`,
        role: "user",
        content,
        tools: [],
      },
    ],
  };
}

export function resolveLocalPermission(
  state: ChatSessionState,
  requestId: string,
): ChatSessionState {
  return {
    ...state,
    pendingPermissions: state.pendingPermissions.filter((p) => p.requestId !== requestId),
  };
}

/**
 * Pure reducer applying any Harness API v1.12 event frame to `ChatSessionState`.
 * Events targeting a different session (when `state.sessionId` is set) are ignored
 * except global events (`sessions`, `error`).
 */
export function applyApiEvent(
  state: ChatSessionState,
  frame: AnyApiEvent,
): ChatSessionState {
  if (!isKnownEvent(frame)) {
    return state;
  }

  const eventSessionId = "session_id" in frame ? frame.session_id : undefined;
  if (
    state.sessionId &&
    eventSessionId &&
    eventSessionId !== state.sessionId &&
    frame.ev !== "sessions"
  ) {
    return state;
  }

  switch (frame.ev) {
    case "sessions":
      return { ...state, sessions: frame.sessions };

    case "attached":
      return {
        ...state,
        sessionId: frame.session.session_id,
        sessionTitle: frame.session.title || frame.session.session_id,
        status: frame.session.status,
      };

    case "session_renamed":
      return {
        ...state,
        sessionTitle: frame.display_title || frame.title || state.sessionTitle,
      };

    case "history":
      return {
        ...state,
        sessionId: frame.session_id,
        entries: hydrateHistoryMessages(frame.messages),
        isStreaming: false,
        liveTurnCredits: undefined,
      };

    case "message_accepted":
      return {
        ...state,
        isStreaming: true,
        lastError: undefined,
        lastTurnStopReason: undefined,
      };

    case "text_delta": {
      const { entries, index } = ensureStreamingAssistant(state.entries, frame.message_id);
      const current = entries[index]!;
      entries[index] = {
        ...current,
        content: current.content + frame.text,
        streaming: true,
      };
      return { ...state, isStreaming: true, entries };
    }

    case "text_replace": {
      const { entries, index } = ensureStreamingAssistant(state.entries, frame.message_id);
      const current = entries[index]!;
      entries[index] = { ...current, content: frame.text };
      return { ...state, entries };
    }

    case "text_done": {
      const { entries, index } = ensureStreamingAssistant(state.entries, frame.message_id);
      const current = entries[index]!;
      entries[index] = { ...current, streaming: false };
      return { ...state, entries };
    }

    case "reasoning_delta": {
      const { entries, index } = ensureStreamingAssistant(state.entries);
      const current = entries[index]!;
      entries[index] = {
        ...current,
        reasoning: (current.reasoning ?? "") + frame.text,
        streaming: true,
      };
      return { ...state, isStreaming: true, entries };
    }

    case "reasoning_done": {
      const { entries, index } = ensureStreamingAssistant(state.entries);
      const current = entries[index]!;
      entries[index] = {
        ...current,
        reasoningDurationSecs: frame.duration_secs,
      };
      return { ...state, entries };
    }

    case "tool_start": {
      const { entries, index } = ensureStreamingAssistant(state.entries);
      const current = entries[index]!;
      const nextTools = [
        ...current.tools.filter((t) => t.callId !== frame.call_id),
        {
          callId: frame.call_id,
          name: frame.name,
          inputText: "",
          status: "pending" as const,
        },
      ];
      entries[index] = { ...current, tools: nextTools, streaming: true };
      return { ...state, isStreaming: true, entries };
    }

    case "tool_input_delta": {
      const { entries, index } = ensureStreamingAssistant(state.entries);
      const current = entries[index]!;
      const nextTools = current.tools.map((t) =>
        t.callId === frame.call_id ? { ...t, inputText: t.inputText + frame.delta } : t,
      );
      entries[index] = { ...current, tools: nextTools };
      return { ...state, entries };
    }

    case "tool_call": {
      const { entries, index } = ensureStreamingAssistant(state.entries);
      const current = entries[index]!;
      const exists = current.tools.some((t) => t.callId === frame.call_id);
      const inputText =
        typeof frame.input === "string" ? frame.input : JSON.stringify(frame.input, null, 2);
      const nextTools = exists
        ? current.tools.map((t) =>
            t.callId === frame.call_id
              ? { ...t, name: frame.name, input: frame.input, inputText, status: "running" as const }
              : t,
          )
        : [
            ...current.tools,
            {
              callId: frame.call_id,
              name: frame.name,
              input: frame.input,
              inputText,
              status: "running" as const,
            },
          ];
      entries[index] = { ...current, tools: nextTools, streaming: true };
      return { ...state, isStreaming: true, entries };
    }

    case "tool_exec": {
      const { entries, index } = ensureStreamingAssistant(state.entries);
      const current = entries[index]!;
      const nextTools = current.tools.map((t) =>
        t.callId === frame.call_id ? { ...t, status: "running" as const } : t,
      );
      entries[index] = { ...current, tools: nextTools };
      return { ...state, entries };
    }

    case "tool_done": {
      const { entries, index } = ensureStreamingAssistant(state.entries);
      const current = entries[index]!;
      const exists = current.tools.some((t) => t.callId === frame.call_id);
      const doneItem: ToolExecutionItem = {
        callId: frame.call_id,
        name: frame.name,
        inputText: "",
        output: frame.output,
        error: frame.error,
        status: frame.error ? "error" : "done",
      };
      const nextTools = exists
        ? current.tools.map((t) =>
            t.callId === frame.call_id
              ? {
                  ...t,
                  output: frame.output,
                  error: frame.error,
                  status: frame.error ? ("error" as const) : ("done" as const),
                }
              : t,
          )
        : [...current.tools, doneItem];
      entries[index] = { ...current, tools: nextTools };
      return { ...state, entries };
    }

    case "token_usage":
      return {
        ...state,
        tokenUsage: {
          input: frame.input,
          output: frame.output,
          cacheReadInput: frame.cache_read_input,
          cacheCreationInput: frame.cache_creation_input,
          effectiveBudget: frame.effective_budget,
        },
      };

    case "rayu_credits": {
      const acc = new RayuCreditsAccumulator();
      if (typeof frame.turn_credits === "number") {
        acc.syncTurnTotal(frame.turn_credits);
      } else {
        if (typeof state.liveTurnCredits === "number") {
          acc.syncTurnTotal(state.liveTurnCredits);
        }
        acc.recordCredits(frame.credits);
      }
      const nextTotal = acc.totalCredits;
      return {
        ...state,
        liveTurnCredits: nextTotal,
      };
    }

    case "turn_stopped": {
      const entries = state.entries.map((e, i) =>
        i === state.entries.length - 1 && e.role === "assistant" ? { ...e, streaming: false } : e,
      );
      return {
        ...state,
        isStreaming: false,
        liveTurnCredits: undefined,
        lastTurnStopReason: frame.reason,
        lastError: frame.reason === "interrupted" ? undefined : frame.message,
        entries,
      };
    }

    case "turn_done": {
      const entries = [...state.entries];
      const lastIdx = entries.length - 1;
      if (lastIdx >= 0 && entries[lastIdx]!.role === "assistant") {
        const current = entries[lastIdx]!;
        const mergedStats: ResponseStats | undefined =
          state.liveTurnCredits !== undefined || state.tokenUsage || current.responseStats
            ? {
                ...current.responseStats,
                input_tokens: state.tokenUsage?.input ?? current.responseStats?.input_tokens,
                output_tokens: state.tokenUsage?.output ?? current.responseStats?.output_tokens,
                cache_read_tokens:
                  state.tokenUsage?.cacheReadInput ?? current.responseStats?.cache_read_tokens,
                cache_creation_tokens:
                  state.tokenUsage?.cacheCreationInput ??
                  current.responseStats?.cache_creation_tokens,
                rayu_credits: state.liveTurnCredits ?? current.responseStats?.rayu_credits,
              }
            : undefined;
        entries[lastIdx] = {
          ...current,
          streaming: false,
          responseStats: mergedStats,
        };
      }
      return {
        ...state,
        isStreaming: false,
        liveTurnCredits: undefined,
        entries,
      };
    }

    case "permission_request":
      return {
        ...state,
        pendingPermissions: [
          ...state.pendingPermissions.filter((p) => p.requestId !== frame.request_id),
          {
            requestId: frame.request_id,
            sessionId: frame.session_id,
            toolName: frame.tool_name,
            description: frame.description,
          },
        ],
      };

    case "background_progress":
      return {
        ...state,
        backgroundTasks: {
          ...state.backgroundTasks,
          [frame.task_id]: {
            taskId: frame.task_id,
            label: frame.label,
            summary: frame.summary,
            percent: frame.percent,
            done: Boolean(frame.done),
          },
        },
      };

    case "session_status":
      return { ...state, status: frame.status };

    case "connection_phase":
      return { ...state, connectionPhase: frame.phase };

    case "model_info":
      return {
        ...state,
        provider: frame.provider ?? state.provider,
        model: frame.model ?? state.model,
        reasoningEffort: frame.reasoning_effort ?? state.reasoningEffort,
        authMethod: frame.auth_method ?? state.authMethod,
        accountLabel: frame.account_label ?? state.accountLabel,
      };

    case "runtime_info":
      return {
        ...state,
        provider: frame.provider ?? state.provider,
        model: frame.model ?? state.model,
        reasoningEffort: frame.reasoning_effort ?? state.reasoningEffort,
        authMethod: frame.auth_method ?? state.authMethod,
        accountLabel: frame.account_label ?? state.accountLabel,
        routes: frame.routes,
      };

    case "todo_state":
      return { ...state, todoState: frame.state };

    case "error":
      return { ...state, lastError: frame.message, isStreaming: false };

    default:
      return state;
  }
}
