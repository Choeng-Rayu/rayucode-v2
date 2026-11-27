export type SessionTodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface SessionTodoItem {
  id?: string;
  content: string;
  status: SessionTodoStatus;
  activeForm?: string;
  group?: string;
  stage?: number;
  blockedReason?: string;
}

export interface TodoProgressSummary {
  total: number;
  activeTotal: number;
  completed: number;
  inProgress: number;
  pending: number;
  cancelled: number;
  percent: number;
  activeItem: SessionTodoItem | null;
  allCompleted: boolean;
}

const TODO_TOOL_NAMES = new Set<string>([
  "todo",
  "todowrite",
  "todo_write",
  "todoread",
  "todo_read",
  "todos",
]);

const BATCH_TODO_OUTPUT_REGEX =
  /---\s*\[\d+\]\s*(?:todo|todowrite|todo_write|todoread|todo_read|todos)\s*---/i;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveStage(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

function extractBlockerReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return nonEmptyString((value as Record<string, unknown>).reason);
}

/**
 * Normalizes raw todo status strings into one of the four canonical Rust statuses
 * (mirrors `canonical_todo_status` in `crates/rayucode-todo-policy`).
 */
export function normalizeTodoStatus(raw: unknown): SessionTodoStatus {
  if (typeof raw !== "string") return "pending";
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case "completed":
    case "complete":
    case "done":
    case "finished":
      return "completed";
    case "in_progress":
    case "in progress":
    case "in-progress":
    case "running":
      return "in_progress";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Normalizes a single raw todo item from daemon/SDK payloads into a canonical `SessionTodoItem`.
 */
export function normalizeTodoItem(raw: unknown): SessionTodoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const content =
    nonEmptyString(record.content) ??
    nonEmptyString(record.name) ??
    nonEmptyString(record.title);
  if (!content) return null;

  const status = normalizeTodoStatus(record.status);
  const id = nonEmptyString(record.id);
  const activeForm =
    nonEmptyString(record.activeForm) ?? nonEmptyString(record.active_form);
  const group = nonEmptyString(record.group) ?? nonEmptyString(record.lane);
  const stage =
    parsePositiveStage(record.stage) ??
    parsePositiveStage(record.phase) ??
    parsePositiveStage(record.wave);
  const blockedReason =
    extractBlockerReason(record.completely_blocked) ??
    extractBlockerReason(record.external_blocker) ??
    nonEmptyString(record.blockedReason) ??
    nonEmptyString(record.blocked_reason);

  const item: SessionTodoItem = { content, status };
  if (id !== undefined) item.id = id;
  if (activeForm !== undefined) item.activeForm = activeForm;
  if (group !== undefined) item.group = group;
  if (stage !== undefined) item.stage = stage;
  if (blockedReason !== undefined) item.blockedReason = blockedReason;
  return item;
}

/**
 * Normalizes either an array of raw todos or a snapshot object containing `.todos`.
 */
export function normalizeTodoItems(raw: unknown): SessionTodoItem[] {
  let list: unknown[] | null = null;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    const candidate = (raw as Record<string, unknown>).todos;
    if (Array.isArray(candidate)) {
      list = candidate;
    }
  }
  if (!list) return [];

  const normalized: SessionTodoItem[] = [];
  for (const entry of list) {
    const item = normalizeTodoItem(entry);
    if (item) {
      normalized.push(item);
    }
  }
  return normalized;
}

/**
 * Checks whether a tool name refers to a todo read/write tool.
 */
export function isTodoToolName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  return TODO_TOOL_NAMES.has(name.trim().toLowerCase());
}

function batchInputContainsTodoCall(rawInput: unknown): boolean {
  let parsed: unknown = rawInput;
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!trimmed) return false;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== "object") return false;
  const toolCalls = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>).tool_calls;
  if (!Array.isArray(toolCalls)) return false;

  for (const call of toolCalls) {
    if (!call || typeof call !== "object") continue;
    const record = call as Record<string, unknown>;
    if (
      isTodoToolName(record.tool) ||
      isTodoToolName(record.name) ||
      isTodoToolName(record.tool_name)
    ) {
      return true;
    }
  }
  return false;
}

function batchOutputContainsTodoSection(rawOutput: unknown): boolean {
  return typeof rawOutput === "string" && BATCH_TODO_OUTPUT_REGEX.test(rawOutput);
}

/**
 * Detects successful `tool_done` harness frames that executed a todo tool directly
 * or inside a `batch` tool invocation.
 */
export function isTodoToolEvent(frame: Record<string, unknown>): boolean {
  if (!frame || typeof frame !== "object") return false;
  if (frame.ev !== "tool_done") return false;
  if (frame.error) return false;

  if (isTodoToolName(frame.name)) {
    return true;
  }

  if (
    typeof frame.name === "string" &&
    frame.name.trim().toLowerCase() === "batch"
  ) {
    if (
      batchInputContainsTodoCall(frame.tool_input) ||
      batchInputContainsTodoCall(frame.input) ||
      batchOutputContainsTodoSection(frame.tool_output) ||
      batchOutputContainsTodoSection(frame.output)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts normalized todos from a `todo_state` harness event frame.
 */
export function extractTodosFromHarnessFrame(
  frame: Record<string, unknown>,
  fallbackSessionId?: string
): { sessionId: string; todos: SessionTodoItem[] } | null {
  if (!frame || typeof frame !== "object") return null;
  if (frame.ev !== "todo_state") return null;

  const sessionId =
    nonEmptyString(frame.session_id) ?? nonEmptyString(fallbackSessionId) ?? "";
  if (!sessionId) return null;

  const stateObj =
    frame.state && typeof frame.state === "object"
      ? (frame.state as Record<string, unknown>)
      : null;
  const rawTodos =
    stateObj && Array.isArray(stateObj.todos) ? stateObj.todos : frame.todos;

  return {
    sessionId,
    todos: normalizeTodoItems(rawTodos),
  };
}

/**
 * Computes progress counters, completion percentage (excluding cancelled items),
 * active item, and all-completed status for a list of normalized todos.
 */
export function summarizeTodoProgress(
  todos: readonly SessionTodoItem[]
): TodoProgressSummary {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let cancelled = 0;
  let activeItem: SessionTodoItem | null = null;

  for (const item of todos) {
    switch (item.status) {
      case "completed":
        completed += 1;
        break;
      case "in_progress":
        inProgress += 1;
        if (!activeItem) {
          activeItem = item;
        }
        break;
      case "cancelled":
        cancelled += 1;
        break;
      default:
        pending += 1;
        break;
    }
  }

  const total = todos.length;
  const activeTotal = total - cancelled;
  const percent =
    activeTotal > 0
      ? Math.round((completed / activeTotal) * 100)
      : total > 0
        ? 100
        : 0;
  const allCompleted =
    total > 0 && inProgress === 0 && pending === 0 && completed > 0;

  return {
    total,
    activeTotal,
    completed,
    inProgress,
    pending,
    cancelled,
    percent,
    activeItem,
    allCompleted,
  };
}
