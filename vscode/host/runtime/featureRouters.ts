import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HarnessError,
  type RayucodeClient,
  type RuntimeCommand,
} from "@rayu-dev/rayucode-sdk";
import { normalizeTodoItems } from "@rayu-dev/rayucode-session-core/client";
import {
  RPC_METHODS,
  RpcContractSchemas,
  fromHarnessPermissionMode,
  parseRpcParams,
  type AccountStatusView,
  type AgentProfileView,
  type AgentRoleId,
  type AgentRoleOverrideView,
  type AmbientApprovalView,
  type AmbientStatusView,
  type AnalyticsSummaryView,
  type AppletStateView,
  type BackgroundProcessOutputView,
  type BackgroundProcessView,
  type CacheTtl,
  type ChangedFileStatus,
  type ChangedFileView,
  type ChangesStatusView,
  type ContextSnapshotView,
  type DaemonStatusView,
  type DoctorCheckView,
  type EffortChoice,
  type EffortLevel,
  type FeatureFlagsView,
  type FileChangeActionKind,
  type FileChangeActionResultView,
  type FileChangeConflictView,
  type FileChangeEntryView,
  type FileChangeHunkView,
  type FileChangeKind,
  type FileChangeStatus,
  type FileChangesSnapshotView,
  type FileDiffView,
  type FileReviewDecision,
  type GatewayStatusView,
  type HistoryImageView,
  type HistoryMessageView,
  type HistoryResponseStatsView,
  type HookEntryView,
  type HookEventId,
  type HostToWebviewMessage,
  type McpServerView,
  type McpTransport,
  type MemoryFactView,
  type MemoryStatusView,
  type ModelRouteOptionView,
  type OvernightRunView,
  type PermissionModeId,
  type ProductivityReportView,
  type ProjectIconView,
  type ProviderEntryView,
  type ProviderTransport,
  type QualityStatusView,
  type RemoteInfraStatusView,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type ScheduleItemView,
  type ServiceTier,
  type SessionHistoryView,
  type SessionSearchHitView,
  type SessionSourceTool,
  type SessionSummaryView,
  type ShortcutEntryView,
  type SidePanelPageView,
  type SkillView,
  type SwarmAgentView,
  type SwarmBoardMessageView,
  type SwarmStatusView,
  type SwarmSummaryView,
  type TelegramApprovalView,
  type TelegramStatusView,
  type TelemetryConfigView,
  type TodoItemView,
  type UpdateChannel,
  type VoiceStatusView,
  type WorkspaceFolderView,
  type WorkspaceIntegrationsView,
  type WorkspaceLedgerView,
} from "../../shared/vscodeProtocol.js";
import type {
  BackgroundProcessGroup,
  BackgroundProcessStatus,
} from "../../shared/vscodeProtocol.js";
import {
  buildRayuPlanLadder,
  buildVscodeLoginUrl,
  getRayuWebBase,
  type RayuCloudModelEntry,
  type RayuSignInMode,
} from "../auth/rayuHostAuthManager.js";

function parseTimestampMs(val: unknown, fallback = Date.now()): number {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val > 0 && val < 10_000_000_000 ? Math.round(val * 1000) : val;
  }
  if (typeof val === "string" && val.trim()) {
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const totalMins = Math.max(1, Math.round(seconds / 60));
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export function formatHarnessModelSpec(
  model: string,
  provider?: string,
  apiMethod?: string,
): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") return "";
  if (trimmed.includes(":")) return trimmed;
  if (
    normalizeUiProviderId(provider ?? "") === "rayu" ||
    normalizeUiProviderId(apiMethod ?? "") === "rayu"
  ) {
    return `rayu:${trimmed}`;
  }
  return trimmed;
}

export function mapModelRouteOption(raw: unknown): ModelRouteOptionView | null {
  const r = asRecord(raw);
  const rawModel = typeof r.model === "string" ? r.model.trim() : "";
  if (!rawModel) return null;
  const bareModel = rawModel.replace(/^rayu:/i, "").trim();
  if (!bareModel) return null;
  const rawProvider = typeof r.provider === "string" ? r.provider.trim() : "";
  const provider =
    /^rayu:/i.test(rawModel) || !rawProvider
      ? "rayu"
      : normalizeUiProviderId(rawProvider);
  const rawApiMethod =
    typeof r.api_method === "string" && r.api_method.trim()
      ? r.api_method.trim()
      : typeof r.apiMethod === "string" && r.apiMethod.trim()
        ? r.apiMethod.trim()
        : undefined;
  const apiMethod = rawApiMethod ?? (provider === "rayu" ? "rayu" : undefined);
  const modelSpec = formatHarnessModelSpec(rawModel, provider, apiMethod);
  const id =
    provider === "rayu"
      ? `rayu:${bareModel}`
      : `${apiMethod || provider}:${bareModel}`;
  const label =
    typeof r.label === "string" && r.label.trim() ? r.label.trim() : bareModel;
  const rawAuthMethod =
    typeof r.auth_method === "string"
      ? r.auth_method.trim().toLowerCase()
      : typeof r.authMethod === "string"
        ? r.authMethod.trim().toLowerCase()
        : undefined;
  const authMethod: ModelRouteOptionView["authMethod"] =
    rawAuthMethod === "oauth" ||
    rawAuthMethod === "api_key" ||
    rawAuthMethod === "env" ||
    rawAuthMethod === "none"
      ? rawAuthMethod
      : undefined;
  const accountLabel =
    typeof r.account_label === "string" && r.account_label.trim()
      ? r.account_label.trim()
      : typeof r.accountLabel === "string" && r.accountLabel.trim()
        ? r.accountLabel.trim()
        : undefined;
  const available = typeof r.available === "boolean" ? r.available : undefined;
  const detail = typeof r.detail === "string" ? r.detail : undefined;
  const supportsEffort =
    typeof r.supports_effort === "boolean"
      ? r.supports_effort
      : typeof r.supportsEffort === "boolean"
        ? r.supportsEffort
        : undefined;
  const rawSupportedEfforts = Array.isArray(r.supported_efforts)
    ? r.supported_efforts
    : Array.isArray(r.supportedEfforts)
      ? r.supportedEfforts
      : undefined;
  const supportedEfforts = rawSupportedEfforts
    ? rawSupportedEfforts
        .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
        .map((e) => e.trim())
    : undefined;
  const defaultEffort =
    typeof r.default_effort === "string"
      ? r.default_effort
      : r.default_effort === null
        ? null
        : typeof r.defaultEffort === "string"
          ? r.defaultEffort
          : r.defaultEffort === null
            ? null
            : undefined;
  const supportsFast =
    typeof r.supports_fast === "boolean"
      ? r.supports_fast
      : typeof r.supportsFast === "boolean"
        ? r.supportsFast
        : undefined;
  const contextWindow =
    typeof r.context_window === "number" && r.context_window > 0
      ? Math.round(r.context_window)
      : typeof r.contextWindow === "number" && r.contextWindow > 0
        ? Math.round(r.contextWindow)
        : undefined;
  const pricingLabel =
    typeof r.pricing_label === "string"
      ? r.pricing_label
      : typeof r.pricingLabel === "string"
        ? r.pricingLabel
        : undefined;

  return {
    id,
    model: bareModel,
    ...(modelSpec ? { modelSpec } : {}),
    provider,
    label,
    ...(apiMethod !== undefined ? { apiMethod } : {}),
    ...(authMethod !== undefined ? { authMethod } : {}),
    ...(accountLabel !== undefined ? { accountLabel } : {}),
    ...(available !== undefined ? { available } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(supportsEffort !== undefined ? { supportsEffort } : {}),
    ...(supportedEfforts !== undefined ? { supportedEfforts } : {}),
    ...(defaultEffort !== undefined ? { defaultEffort } : {}),
    ...(supportsFast !== undefined ? { supportsFast } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(pricingLabel !== undefined ? { pricingLabel } : {}),
  };
}

export interface ReconcileAuthConsistentRoutesInput {
  rawRoutes?: readonly unknown[];
  hostAccount?: AccountStatusView;
  rayuHostedModels?: readonly RayuCloudModelEntry[];
  runtimeModel?: string;
  runtimeProvider?: string;
  fallbackActiveModel?: string;
}

export interface ReconcileAuthConsistentRoutesResult {
  routes: ModelRouteOptionView[];
  defaultModel?: string;
}

export function reconcileAuthConsistentRoutes(
  input: ReconcileAuthConsistentRoutesInput,
): ReconcileAuthConsistentRoutesResult {
  const seenIds = new Set<string>();
  const mapped: ModelRouteOptionView[] = [];
  for (const raw of input.rawRoutes ?? []) {
    const option = mapModelRouteOption(raw);
    if (!option || seenIds.has(option.id)) continue;
    seenIds.add(option.id);
    mapped.push(option);
  }

  const hostAccount = input.hostAccount;
  let reconciled: ModelRouteOptionView[];

  if (hostAccount?.signedIn === true) {
    const rayuAuthMethod: "api_key" | "oauth" =
      hostAccount.authMethod === "apiKey" ? "api_key" : "oauth";
    const rayuAccountLabel =
      hostAccount.email ??
      hostAccount.displayName ??
      (hostAccount.authMethod === "apiKey" ? "Rayu API Key" : "Rayu Cloud");

    const existingRayuCodes = new Set<string>();
    reconciled = mapped.map((route) => {
      if (route.provider !== "rayu") return route;
      existingRayuCodes.add(route.model);
      return {
        ...route,
        available: true,
        authMethod: rayuAuthMethod,
        accountLabel: rayuAccountLabel,
        modelSpec: formatHarnessModelSpec(route.model, "rayu", "rayu"),
      };
    });

    for (const entry of input.rayuHostedModels ?? []) {
      const bare = entry.code.trim().replace(/^rayu:/i, "").trim();
      if (!bare || existingRayuCodes.has(bare)) continue;
      existingRayuCodes.add(bare);
      reconciled.push({
        id: `rayu:${bare}`,
        model: bare,
        modelSpec: `rayu:${bare}`,
        provider: "rayu",
        label: entry.label?.trim() || bare,
        apiMethod: "rayu",
        authMethod: rayuAuthMethod,
        accountLabel: rayuAccountLabel,
        available: true,
        detail: entry.description?.trim() || "Rayu Cloud",
        ...(entry.supportsEffort !== undefined
          ? { supportsEffort: entry.supportsEffort }
          : {}),
        ...(entry.supportsFast !== undefined
          ? { supportsFast: entry.supportsFast }
          : {}),
      });
    }
  } else if (hostAccount?.signedIn === false) {
    reconciled = mapped.map((route) => {
      if (route.provider !== "rayu") return route;
      return {
        ...route,
        available: false,
        detail: "Sign in to Rayu Cloud",
      };
    });
  } else {
    reconciled = mapped;
  }

  const availableRayuRoutes: ModelRouteOptionView[] = [];
  const availableOtherRoutes: ModelRouteOptionView[] = [];
  const unavailableRoutes: ModelRouteOptionView[] = [];

  for (const route of reconciled) {
    if (route.available === false) {
      unavailableRoutes.push(route);
    } else if (route.provider === "rayu") {
      availableRayuRoutes.push(route);
    } else {
      availableOtherRoutes.push(route);
    }
  }

  const routes = [
    ...availableRayuRoutes,
    ...availableOtherRoutes,
    ...unavailableRoutes,
  ];

  const candidateModel =
    input.runtimeModel?.trim() || input.fallbackActiveModel?.trim() || "";
  const candidateBare = candidateModel.replace(/^rayu:/i, "").trim();
  const candidateProvider = /^rayu:/i.test(candidateModel)
    ? "rayu"
    : input.runtimeProvider?.trim()
      ? normalizeUiProviderId(input.runtimeProvider)
      : undefined;

  let matched: ModelRouteOptionView | undefined;
  if (candidateModel) {
    if (candidateProvider) {
      matched = routes.find(
        (r) =>
          r.provider === candidateProvider &&
          (r.modelSpec === candidateModel || r.model === candidateBare),
      );
    }
    if (!matched) {
      matched = routes.find((r) => r.modelSpec === candidateModel);
    }
    if (!matched && !candidateProvider) {
      matched =
        routes.find(
          (r) =>
            r.available !== false &&
            (r.model === candidateBare || r.modelSpec === candidateModel),
        ) ??
        routes.find(
          (r) => r.model === candidateBare || r.modelSpec === candidateModel,
        );
    }
  }

  let defaultModel: string | undefined;
  if (matched && matched.available !== false) {
    defaultModel = matched.modelSpec || matched.model;
  } else {
    const firstAvailable = routes.find((r) => r.available !== false);
    if (firstAvailable) {
      defaultModel = firstAvailable.modelSpec || firstAvailable.model;
    } else {
      defaultModel = input.runtimeModel ?? input.fallbackActiveModel;
    }
  }

  return { routes, defaultModel };
}

const DATA_URL_PREFIX_RE = /^data:([^;]+);base64,/i;

/**
 * Normalize image attachments from either `[mediaType, base64]` tuples or
 * `ImageAttachmentView` objects (`{ mediaType, data: "data:image/...;base64,..." }`)
 * into the wire-level `[mediaType, rawBase64]` tuple format expected by Rust `SendMessage`.
 */
export function normalizeImageAttachments(raw: unknown): Array<[string, string]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[string, string]> = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      const mediaType = typeof item[0] === "string" ? item[0].trim() : "";
      const rawData = typeof item[1] === "string" ? item[1].trim() : "";
      const match = DATA_URL_PREFIX_RE.exec(rawData);
      const base64 = match ? rawData.slice(match[0].length) : rawData;
      const effectiveMedia = mediaType || match?.[1] || "image/png";
      if (effectiveMedia && base64) {
        out.push([effectiveMedia, base64]);
      }
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const rawData = typeof obj.data === "string" ? obj.data.trim() : "";
      const match = DATA_URL_PREFIX_RE.exec(rawData);
      const base64 = match ? rawData.slice(match[0].length) : rawData;
      const mediaType =
        (typeof obj.mediaType === "string" && obj.mediaType.trim()) ||
        (typeof obj.media_type === "string" && obj.media_type.trim()) ||
        match?.[1] ||
        "";
      if (mediaType && base64) {
        out.push([mediaType, base64]);
      }
    }
  }
  return out;
}

/**
 * Build a Rust `QuestionResponse` wire object (`{ kind: "answered", answers }` or `{ kind: "declined" }`)
 * from flat `{ answers: Record<string, string>, notes?: Record<string, string>, selected?: Record<string, number[]>, declined?: boolean }`.
 */
export function buildQuestionResponseWire(
  answers: Record<string, string>,
  notes?: Record<string, string>,
  options?: {
    selected?: Record<string, number[]>;
    declined?: boolean;
  },
): Record<string, unknown> {
  if (options?.declined) {
    return { kind: "declined" };
  }
  const allQuestions = new Set<string>([
    ...Object.keys(answers),
    ...Object.keys(options?.selected ?? {}),
  ]);
  const structured: Record<
    string,
    { selected?: number[]; custom?: string[]; notes?: string }
  > = {};
  for (const question of allQuestions) {
    const customAnswer = answers[question]?.trim() ?? "";
    const selectedIndices = (options?.selected?.[question] ?? []).filter(
      (idx) => Number.isInteger(idx) && idx >= 0,
    );
    const note = notes?.[question]?.trim();
    if (selectedIndices.length === 0 && !customAnswer) {
      continue;
    }
    structured[question] = {
      ...(selectedIndices.length > 0
        ? { selected: selectedIndices }
        : customAnswer
          ? { custom: [customAnswer] }
          : {}),
      ...(note ? { notes: note } : {}),
    };
  }
  if (Object.keys(structured).length === 0) {
    return { kind: "declined" };
  }
  return {
    kind: "answered",
    answers: structured,
  };
}

/**
 * Normalize raw webview harness request frames into canonical Harness API v1 `req:` frames.
 * Maps legacy `type:` / `op:` discriminants -> `req:`, `user_input` -> `send_message`,
 * `permission_response` `allow_once` -> `allow`, and wraps `question_response` `answers`.
 */
export function normalizeHarnessRequestFrame(
  rawFrame: Record<string, unknown>,
): Record<string, unknown> {
  const { v: _v, id: _id, type, op, req: explicitReq, ...rest } = rawFrame;
  const rawReq = explicitReq ?? type ?? op;
  const req = rawReq === "user_input" ? "send_message" : rawReq;
  const normalized: Record<string, unknown> = { ...rest };
  if (typeof req === "string" && req.trim()) {
    normalized.req = req.trim();
  }
  if (normalized.req === "permission_response" && normalized.decision === "allow_once") {
    normalized.decision = "allow";
  }
  if (
    normalized.req === "question_response" &&
    normalized.response === undefined &&
    (normalized.declined === true ||
      (typeof normalized.answers === "object" && normalized.answers !== null))
  ) {
    const answersRec: Record<string, string> = {};
    if (typeof normalized.answers === "object" && normalized.answers !== null) {
      for (const [k, val] of Object.entries(normalized.answers as Record<string, unknown>)) {
        if (typeof val === "string") answersRec[k] = val;
      }
    }
    const notesRec: Record<string, string> | undefined =
      typeof normalized.notes === "object" && normalized.notes !== null
        ? Object.fromEntries(
            Object.entries(normalized.notes as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : undefined;
    const selectedRec: Record<string, number[]> | undefined =
      typeof normalized.selected === "object" && normalized.selected !== null
        ? Object.fromEntries(
            Object.entries(normalized.selected as Record<string, unknown>)
              .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
              .map(([k, arr]) => [
                k,
                arr.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0),
              ]),
          )
        : undefined;
    const declined = normalized.declined === true;
    delete normalized.answers;
    delete normalized.notes;
    delete normalized.selected;
    delete normalized.declined;
    normalized.response = buildQuestionResponseWire(answersRec, notesRec, {
      selected: selectedRec,
      declined,
    });
  }
  if (
    (normalized.req === "send_message" || normalized.req === "soft_interrupt") &&
    Array.isArray(normalized.images)
  ) {
    normalized.images = normalizeImageAttachments(normalized.images);
  }
  return normalized;
}

function mapRawResponseStats(raw: unknown): HistoryResponseStatsView | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const durationSecs = typeof r.duration_secs === "number" ? r.duration_secs : undefined;
  const inputTokens = typeof r.input_tokens === "number" ? r.input_tokens : undefined;
  const outputTokens = typeof r.output_tokens === "number" ? r.output_tokens : undefined;
  const cacheReadTokens = typeof r.cache_read_tokens === "number" ? r.cache_read_tokens : undefined;
  const cacheCreationTokens =
    typeof r.cache_creation_tokens === "number" ? r.cache_creation_tokens : undefined;
  const rayuCredits = typeof r.rayu_credits === "number" ? r.rayu_credits : undefined;
  if (
    durationSecs === undefined &&
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheCreationTokens === undefined &&
    rayuCredits === undefined
  ) {
    return undefined;
  }
  return {
    ...(durationSecs !== undefined ? { durationSecs } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    ...(rayuCredits !== undefined ? { rayuCredits } : {}),
  };
}

export function mapRawHistoryMessage(
  raw: Record<string, unknown>,
  opts: { id: string; model?: string; images?: HistoryImageView[] },
): HistoryMessageView {
  const toolObj =
    raw.tool && typeof raw.tool === "object" && !Array.isArray(raw.tool)
      ? (raw.tool as Record<string, unknown>)
      : null;
  const responseStats = mapRawResponseStats(raw.response_stats);
  return {
    id: opts.id,
    role: typeof raw.role === "string" ? raw.role : "assistant",
    content: typeof raw.content === "string" ? raw.content : "",
    ...(opts.model ? { model: opts.model } : {}),
    ...(typeof toolObj?.id === "string" ? { toolId: toolObj.id } : {}),
    ...(typeof toolObj?.name === "string" ? { toolName: toolObj.name } : {}),
    ...(toolObj && toolObj.input !== undefined ? { toolInput: toolObj.input } : {}),
    ...(typeof raw.origin === "string" ? { origin: raw.origin } : {}),
    ...(typeof raw.visibility === "string" ? { visibility: raw.visibility } : {}),
    ...(raw.attempt_id === null || typeof raw.attempt_id === "string"
      ? { attemptId: raw.attempt_id }
      : {}),
    ...(typeof raw.attempt_reason === "string" ? { attemptReason: raw.attempt_reason } : {}),
    ...(typeof raw.attempt_status === "string" ? { attemptStatus: raw.attempt_status } : {}),
    ...(raw.stop_reason === null || typeof raw.stop_reason === "string"
      ? { stopReason: raw.stop_reason }
      : {}),
    ...(responseStats ? { responseStats } : {}),
    ...(opts.images && opts.images.length > 0 ? { images: opts.images } : {}),
  };
}

function classifyProcessGroup(toolName: string): BackgroundProcessGroup {
  const lower = toolName.toLowerCase();
  if (lower.includes("swarm") || lower.includes("agent") || lower.includes("worker")) {
    return "agents";
  }
  if (lower.includes("overnight") || lower.includes("memory") || lower.includes("schedule")) {
    return "runtime";
  }
  return "shells";
}

function normalizeProcessStatus(raw: unknown, done?: boolean): BackgroundProcessStatus {
  if (done) return "completed";
  if (typeof raw !== "string") return "running";
  const lower = raw.toLowerCase();
  if (lower === "stalled") return "stalled";
  if (lower === "completed" || lower === "done" || lower === "succeeded") return "completed";
  if (lower === "failed" || lower === "error" || lower === "cancelled") return "failed";
  if (lower === "superseded") return "superseded";
  return "running";
}

export function mapRawBackgroundTask(
  raw: Record<string, unknown>,
  fallbackSessionId = "",
): BackgroundProcessView {
  const now = Date.now();
  const progress = asRecord(raw.progress);
  const taskId = String(raw.task_id ?? raw.taskId ?? raw.id ?? `bg_${now}`);
  const sessionId = String(raw.session_id ?? raw.sessionId ?? fallbackSessionId);
  const toolName = String(raw.tool_name ?? raw.toolName ?? raw.command ?? "bash");
  const displayName = String(raw.display_name ?? raw.displayName ?? raw.label ?? toolName);
  const status = normalizeProcessStatus(raw.status, raw.done === true);

  const rawPercent =
    typeof raw.percent === "number"
      ? raw.percent
      : typeof progress.percent === "number"
        ? progress.percent
        : undefined;
  const percent =
    rawPercent !== undefined && Number.isFinite(rawPercent)
      ? Math.max(0, Math.min(100, rawPercent))
      : undefined;
  const current =
    typeof raw.current === "number"
      ? raw.current
      : typeof progress.current === "number"
        ? progress.current
        : undefined;
  const total =
    typeof raw.total === "number"
      ? raw.total
      : typeof progress.total === "number"
        ? progress.total
        : undefined;
  const unit =
    typeof raw.unit === "string"
      ? raw.unit
      : typeof progress.unit === "string"
        ? progress.unit
        : undefined;
  const etaSeconds =
    typeof raw.eta_seconds === "number"
      ? raw.eta_seconds
      : typeof progress.eta_seconds === "number"
        ? progress.eta_seconds
        : undefined;
  const progressKind =
    percent !== undefined || (current !== undefined && total !== undefined)
      ? "determinate"
      : "indeterminate";

  const startedAtMs = parseTimestampMs(
    raw.started_at_ms ?? raw.startedAtMs ?? raw.started_at,
    now,
  );
  const updatedAtMs = parseTimestampMs(
    raw.updated_at_ms ?? raw.updatedAtMs ?? raw.completed_at ?? raw.started_at,
    startedAtMs,
  );

  return {
    taskId,
    sessionId,
    group: classifyProcessGroup(toolName),
    toolName,
    displayName,
    status,
    progressKind,
    percent,
    current,
    total,
    unit,
    summary: String(
      raw.summary ??
        progress.message ??
        raw.status_text ??
        (typeof raw.error === "string" && raw.error ? raw.error : undefined) ??
        displayName,
    ),
    etaSeconds,
    exitCode: typeof raw.exit_code === "number" ? raw.exit_code : undefined,
    outputFile:
      typeof raw.output_file === "string"
        ? raw.output_file
        : typeof raw.outputFile === "string"
          ? raw.outputFile
          : undefined,
    startedAtMs,
    updatedAtMs,
    durationSecs:
      typeof raw.duration_secs === "number" ? raw.duration_secs : undefined,
    stallQuietSecs:
      typeof raw.stall_quiet_secs === "number" ? raw.stall_quiet_secs : undefined,
    unread: typeof raw.unread === "boolean" ? raw.unread : undefined,
  };
}

function inferFileLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rs": "rust",
    ".py": "python",
    ".go": "go",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".html": "html",
    ".toml": "toml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".sh": "shellscript",
    ".sql": "sql",
  };
  return map[ext] ?? "plaintext";
}

function normalizeFileChangeKind(raw: unknown): FileChangeKind {
  switch (raw) {
    case "created":
    case "modified":
    case "deleted":
    case "renamed":
      return raw;
    default:
      return "modified";
  }
}

function normalizeFileChangeStatus(raw: unknown): FileChangeStatus {
  switch (raw) {
    case "pending":
    case "kept":
    case "undone":
      return raw;
    default:
      return "pending";
  }
}

function toNonNegInt(val: unknown, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val)
    ? Math.max(0, Math.round(val))
    : fallback;
}

export function emptyFileChangesSnapshot(
  sessionId: string,
): FileChangesSnapshotView {
  return {
    sessionId,
    latestTurnId: 0,
    totalPendingFiles: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    files: [],
  };
}

export function mapRawFileChangeHunk(raw: unknown): FileChangeHunkView | null {
  const r = asRecord(raw);
  const header = typeof r.header === "string" ? r.header : "";
  const lines = asArray(r.lines).filter((l): l is string => typeof l === "string");
  if (!header && lines.length === 0) return null;
  return {
    oldStart: toNonNegInt(r.old_start ?? r.oldStart, 0),
    oldLines: toNonNegInt(r.old_lines ?? r.oldLines, 0),
    newStart: toNonNegInt(r.new_start ?? r.newStart, 0),
    newLines: toNonNegInt(r.new_lines ?? r.newLines, 0),
    header,
    lines,
  };
}

export function mapRawFileChangeEntry(raw: unknown): FileChangeEntryView | null {
  const r = asRecord(raw);
  const filePath = typeof r.path === "string" ? r.path : "";
  if (!filePath) return null;
  const displayPath =
    typeof r.display_path === "string" && r.display_path
      ? r.display_path
      : typeof r.displayPath === "string" && r.displayPath
        ? r.displayPath
        : filePath;
  const oldPath =
    typeof r.old_path === "string"
      ? r.old_path
      : typeof r.oldPath === "string"
        ? r.oldPath
        : undefined;
  const previewHunks = asArray(r.preview_hunks ?? r.previewHunks)
    .map(mapRawFileChangeHunk)
    .filter((h): h is FileChangeHunkView => h !== null);

  return {
    path: filePath,
    displayPath,
    ...(oldPath ? { oldPath } : {}),
    kind: normalizeFileChangeKind(r.kind),
    status: normalizeFileChangeStatus(r.status),
    additions: toNonNegInt(r.additions, 0),
    deletions: toNonNegInt(r.deletions, 0),
    changedInLatestTurn: Boolean(
      r.changed_in_latest_turn ?? r.changedInLatestTurn ?? false,
    ),
    turnId: toNonNegInt(r.turn_id ?? r.turnId, 0),
    editCount: toNonNegInt(r.edit_count ?? r.editCount, 1),
    isBinary: Boolean(r.is_binary ?? r.isBinary ?? false),
    undoable:
      typeof r.undoable === "boolean" ? r.undoable : true,
    canRedo: Boolean(r.can_redo ?? r.canRedo ?? false),
    previewHunks,
    previewTruncated: Boolean(
      r.preview_truncated ?? r.previewTruncated ?? false,
    ),
    updatedAtMs: parseTimestampMs(r.updated_at_ms ?? r.updatedAtMs),
  };
}

export function mapRawFileChangesSnapshot(
  raw: unknown,
  fallbackSessionId = "",
): FileChangesSnapshotView {
  const r = asRecord(raw);
  const files = asArray(r.files)
    .map(mapRawFileChangeEntry)
    .filter((f): f is FileChangeEntryView => f !== null);
  const computedPending = files.filter((f) => f.status === "pending").length;
  const computedAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const computedDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

  return {
    sessionId: String(r.session_id ?? r.sessionId ?? fallbackSessionId),
    latestTurnId: toNonNegInt(r.latest_turn_id ?? r.latestTurnId, 0),
    totalPendingFiles: toNonNegInt(
      r.total_pending_files ?? r.totalPendingFiles,
      computedPending,
    ),
    totalAdditions: toNonNegInt(
      r.total_additions ?? r.totalAdditions,
      computedAdditions,
    ),
    totalDeletions: toNonNegInt(
      r.total_deletions ?? r.totalDeletions,
      computedDeletions,
    ),
    files,
  };
}

export function mapRawFileChangeDiff(
  raw: unknown,
  fallbackPath = "",
): FileDiffView {
  const r = asRecord(raw);
  const filePath = String(r.path ?? fallbackPath);
  const displayPath = String(r.display_path ?? r.displayPath ?? filePath);
  const oldPath =
    typeof r.old_path === "string"
      ? r.old_path
      : typeof r.oldPath === "string"
        ? r.oldPath
        : undefined;
  const hunks = asArray(r.hunks)
    .map(mapRawFileChangeHunk)
    .filter((h): h is FileChangeHunkView => h !== null);

  return {
    path: filePath,
    originalContent: String(r.original_content ?? r.originalContent ?? ""),
    modifiedContent: String(r.modified_content ?? r.modifiedContent ?? ""),
    unifiedDiff: String(r.unified_diff ?? r.unifiedDiff ?? ""),
    additions: toNonNegInt(r.additions, 0),
    deletions: toNonNegInt(r.deletions, 0),
    languageId: inferFileLanguageId(displayPath || filePath),
    isBinary: Boolean(r.is_binary ?? r.isBinary ?? false),
    kind: normalizeFileChangeKind(r.kind),
    status: normalizeFileChangeStatus(r.status),
    ...(oldPath ? { oldPath } : {}),
    ...(hunks.length > 0 ? { hunks } : {}),
  };
}

export function mapRawFileChangeActionResponse(
  raw: unknown,
  fallbackSessionId = "",
): FileChangeActionResultView {
  const r = asRecord(raw);
  const conflicts: FileChangeConflictView[] = asArray(r.conflicts)
    .map((item) => {
      const c = asRecord(item);
      const p = typeof c.path === "string" ? c.path : "";
      if (!p) return null;
      return {
        path: p,
        displayPath: String(c.display_path ?? c.displayPath ?? p),
        reason: String(c.reason ?? "Conflict detected"),
      };
    })
    .filter((c): c is FileChangeConflictView => c !== null);

  const snapshot =
    r.snapshot && typeof r.snapshot === "object"
      ? mapRawFileChangesSnapshot(r.snapshot, fallbackSessionId)
      : undefined;

  return {
    ok: Boolean(r.ok),
    message: typeof r.message === "string" ? r.message : undefined,
    conflict: conflicts.length > 0,
    conflicts,
    ...(snapshot ? { snapshot } : {}),
  };
}

export interface FeatureRouterBridge {
  getStatus(): DaemonStatusView;
  ping(): Promise<{ ok: boolean; latencyMs: number; version?: string }>;
  reconnect(): Promise<DaemonStatusView>;
  restart(): Promise<DaemonStatusView>;
  updateEngine?(): Promise<DaemonStatusView>;
  reloadDaemon(activeSessionId?: string): Promise<{ ok: boolean; message?: string }>;
  openOutputLog(): void;
}

export interface FeatureRouterHub {
  getSessionWorkingDir?(sessionId?: string): string | undefined;
  getSessionWorkingDirForSession?(sessionId: string): string | undefined;
  getActiveSessionId(): string | undefined;
  getActiveModel(): string | undefined;
  getActiveProvider(): string | undefined;
  getActivePermissionMode(): PermissionModeId;
  getDefaultPermissionMode?(): PermissionModeId;
  setDefaultPermissionMode?(
    mode: PermissionModeId,
    options?: { applyToActiveSession?: boolean },
  ): Promise<{ ok: boolean; mode: PermissionModeId; deferred?: boolean }>;
  getClient(sessionId?: string): Promise<RayucodeClient>;
  ensureAttachedClient?(sessionId?: string): Promise<RayucodeClient>;
  setSessionModel?(
    sessionId: string,
    model: string,
    options?: {
      provider?: string;
      apiMethod?: string;
      applyNextTurn?: boolean;
    },
  ): Promise<{ ok: boolean; deferred?: boolean; code?: string; message?: string }>;
  setSessionEffort?(
    sessionId: string,
    effort: string,
    options?: { applyNextTurn?: boolean },
  ): Promise<{ ok: boolean; deferred?: boolean; code?: string; message?: string }>;
  listSessions(
    includeArchived?: boolean,
    options?: { includeExternal?: boolean; sources?: string[] },
  ): Promise<{
    sessions: SessionSummaryView[];
    activeSessionId?: string;
  }>;
  listExternalProjects?(
    source?: string,
  ): Promise<{ projects: import("../../shared/vscodeProtocol.js").ExternalProjectView[] }>;
  importExternalSessions?(
    items: import("../../shared/vscodeProtocol.js").ImportExternalSessionItemView[],
    options?: { forceResync?: boolean; forkOnConflict?: boolean },
  ): Promise<{
    sessions: SessionSummaryView[];
    skipped: import("../../shared/vscodeProtocol.js").ImportSkipView[];
  }>;
  createSession(options?: {
    workingDir?: string;
    permissionMode?: PermissionModeId;
    model?: string;
    provider?: string;
    apiMethod?: string;
    effort?: EffortLevel;
    serviceTier?: ServiceTier;
    cacheTtl?: CacheTtl;
  }): Promise<SessionSummaryView>;
  getSessionPrefs?(sessionId: string): {
    model?: string;
    provider?: string;
    effort?: EffortLevel;
    permissionMode?: PermissionModeId;
    serviceTier?: ServiceTier;
  } | undefined;
  saveSessionPrefs?(
    sessionId: string,
    patch: {
      model?: string;
      provider?: string;
      effort?: EffortLevel;
      permissionMode?: PermissionModeId;
      serviceTier?: ServiceTier;
    },
  ): Promise<void>;
  attachSession(sessionId: string): Promise<SessionSummaryView>;
  getHistory(sessionId: string): Promise<SessionHistoryView>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<void>;
  setSessionArchived(sessionId: string, archived: boolean): Promise<void>;
  setPermissionMode(
    sessionId: string,
    mode: PermissionModeId,
  ): Promise<{ ok: boolean; mode: PermissionModeId; deferred?: boolean }>;
  respondPermission(options: {
    sessionId: string;
    requestId: string;
    decision: "allow_once" | "allow_always" | "deny";
  }): Promise<void>;
  runtimeCommand(
    command: RuntimeCommand,
    args?: string[],
    sessionId?: string,
  ): Promise<{
    session_id: string;
    command: RuntimeCommand;
    data: unknown;
    message: string;
  }>;
  getBackgroundTasks(sessionId?: string): BackgroundProcessView[];
  refreshBackgroundProcesses(sessionId?: string): Promise<BackgroundProcessView[]>;
  removeCompletedBackgroundTasks(sessionId?: string): number;
  getSidePanelState(sessionId: string): {
    pages: SidePanelPageView[];
    activePageId?: string;
  };
  closeSidePanelPage(sessionId: string, pageId?: string): void;
  getApplets(sessionId: string): AppletStateView[];
  getCachedTodos(sessionId: string): TodoItemView[];
  setCachedTodos?(sessionId: string, todos: TodoItemView[]): void;
  mapSessionInfoToSummary(info: {
    session_id: string;
    title?: string;
    working_dir?: string;
    status: string;
    saved?: boolean;
    save_label?: string | null;
    updated_at_ms?: number;
    archived?: boolean;
  }): SessionSummaryView;
  notifyDaemonAuthChanged?(provider?: string): Promise<void>;
  broadcastAccountChanged?(account: AccountStatusView): void;
  getFileChangesSnapshot?(sessionId: string): FileChangesSnapshotView | undefined;
  fetchFileChanges?(sessionId?: string): Promise<FileChangesSnapshotView | null>;
  getFileChangeDiff?(
    sessionId: string,
    filePath: string,
  ): Promise<FileDiffView | null>;
  runFileChangeAction?(
    sessionId: string,
    action: FileChangeActionKind,
    opts?: { path?: string; force?: boolean },
  ): Promise<FileChangeActionResultView | null>;
  broadcastFileChanges?(
    sessionId: string,
    snapshot: FileChangesSnapshotView,
  ): void;
  getWorkspaceLedger?(): WorkspaceLedgerView;
  loadWorkspaceLedger?(): Promise<WorkspaceLedgerView>;
  ensureWorkspace?(
    rawPath: string,
    options?: { name?: string; unhide?: boolean },
  ): Promise<WorkspaceLedgerView>;
  removeWorkspace?(idOrPath: string): Promise<WorkspaceLedgerView>;
  setWorkspaceCollapsed?(
    workspaceId: string,
    collapsed: boolean,
  ): Promise<WorkspaceLedgerView>;
  attachSessionToWorkspace?(
    workspaceIdOrPath: string,
    sessionId: string,
  ): Promise<WorkspaceLedgerView>;
  importProjectGroup?(
    rawPath: string,
    options: { name?: string; sessionIds: readonly string[] },
  ): Promise<WorkspaceLedgerView>;
  setSessionPinnedLedger?(
    sessionId: string,
    pinned: boolean,
  ): Promise<WorkspaceLedgerView>;
  setSessionArchivedLedger?(
    sessionId: string,
    archived: boolean,
  ): Promise<WorkspaceLedgerView>;
}

export interface FeatureRouterAuthManager {
  getAccountStatusSnapshot(): AccountStatusView;
  getAccountStatus(forceRefresh?: boolean): Promise<AccountStatusView>;
  startBrowserSignIn(mode?: RayuSignInMode): Promise<{
    ok: boolean;
    authUrl: string;
    state: AccountStatusView;
  }>;
  cancelSignIn(): AccountStatusView;
  signInWithApiKey(apiKey: string): Promise<AccountStatusView>;
  completeManualCallback(rawUrl: string): Promise<AccountStatusView>;
  signOut(): Promise<AccountStatusView>;
  clearSavedApiKeyOnly(): Promise<AccountStatusView>;
  setBypassPacing(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }>;
  getCachedHostedModels?(): RayuCloudModelEntry[];
  fetchHostedModels?(forceRefresh?: boolean): Promise<RayuCloudModelEntry[]>;
  getHostedModelCatalog?(forceRefresh?: boolean): Promise<{
    models: RayuCloudModelEntry[];
    status: "fresh" | "cached" | "stale" | "failed" | "unavailable";
  }>;
}

export interface FeatureRouterGit {
  getStatus(options?: {
    sessionId?: string;
    scope?: "session" | "git";
  }): Promise<ChangesStatusView>;
  getDiff(options: {
    path: string;
    workingDir?: string;
    sessionId?: string;
    scope?: "session" | "git";
  }): Promise<FileDiffView>;
  stage(paths: string[]): Promise<{ ok: boolean; message?: string }>;
  unstage(paths: string[]): Promise<{ ok: boolean; message?: string }>;
  keep(options: { path: string; sessionId?: string }): {
    ok: boolean;
    message?: string;
  };
  undo(options: {
    path: string;
    sessionId?: string;
  }): Promise<{ ok: boolean; conflict?: boolean; message?: string }>;
  commit(message: string): Promise<{
    ok: boolean;
    commitHash?: string;
    summary?: string;
  }>;
  createPr(options: {
    baseBranch: string;
    headBranch: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<{ ok: boolean; url?: string; number?: number }>;
  listBranches(cwd?: string): Promise<{ current: string; branches: string[] }>;
  checkoutBranch(
    workspacePath: string,
    branch: string,
  ): Promise<{ ok: boolean; branch: string }>;
}

export interface FeatureRouterEditor {
  openFile(options: {
    path: string;
    line?: number;
    column?: number;
    preview?: boolean;
  }): Promise<void>;
  openWorktreeWindow(folderPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  pickFiles(options?: {
    canSelectMany?: boolean;
    filters?: Record<string, string[]>;
  }): Promise<string[]>;
  findWorkspaceFiles(query: string, limit?: number): Promise<string[]>;
}

export interface FeatureRouterDeps {
  bridgeManager: FeatureRouterBridge;
  sessionHub: FeatureRouterHub;
  gitBridge: FeatureRouterGit;
  editorBridge: FeatureRouterEditor;
  authManager?: FeatureRouterAuthManager;
  getWorkspaceFolders: () => Promise<WorkspaceFolderView[]>;
  setProjectIcon: (
    workspacePath: string,
    icon: ProjectIconView | null,
  ) => Promise<void>;
  getGlobalState: <T>(key: string, defaultValue: T) => T;
  updateGlobalState: (key: string, value: unknown) => Promise<void>;
  getRuntimeSettings: () => {
    socketPath: string;
    binaryPath: string;
    autoStart: boolean;
  };
  updateRuntimeSettings: (patch: {
    socketPath?: string;
    binaryPath?: string;
    autoStart?: boolean;
  }) => Promise<void>;
  openKeybindings: () => Promise<void>;
}

export interface FeatureRouter {
  dispatch(
    id: number,
    method: string,
    rawParams: unknown,
  ): Promise<Extract<HostToWebviewMessage, { type: "rayucode.rpc.result" }>>;
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
}

function asRecord(val: unknown): Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function asArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

const DEFAULT_FEATURE_FLAGS: FeatureFlagsView = {
  memory: true,
  swarm: true,
  mermaid: true,
  auto_poke: true,
  todo_gate_digest: true,
  todo_gate_diagnostics: true,
  message_timestamps: true,
  persist_memory_injections: true,
  kv_cache_miss_notices: false,
  check_updates: true,
  update_channel: "stable",
  codemode: false,
  integration_tools: false,
};

const DEFAULT_VOICE_STATUS: VoiceStatusView = {
  supported: false,
  enabled: false,
  devices: [{ id: "default", label: "System Default Microphone" }],
  noiseSuppression: true,
  autoSendOnSilence: false,
  hotkeyHint: "Alt+V",
};

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfigView = {
  lockedByEnv: Boolean(process.env.RAYU_NO_TELEMETRY),
  envVarName: process.env.RAYU_NO_TELEMETRY ? "RAYU_NO_TELEMETRY" : undefined,
  content: false,
  usage: true,
  crashes: true,
  features: true,
  cost: true,
  accounts: false,
};

const DEFAULT_SHORTCUTS: ShortcutEntryView[] = [
  {
    id: "open-from-editor-title",
    label: "Open RayuCode (Preferred Location)",
    keybinding: "Cmd/Ctrl+Alt+R",
    commandId: "rayucode.openFromEditorTitle",
  },
  {
    id: "open-beside",
    label: "Open RayuCode Beside Editor",
    keybinding: "Cmd/Ctrl+Alt+Shift+R",
    commandId: "rayucode.openBeside",
  },
  {
    id: "open-workspace-panel",
    label: "Open Mission Control Editor Panel",
    keybinding: "Cmd/Ctrl+Shift+R",
    commandId: "rayucode.openWorkspacePanel",
  },
  {
    id: "send-selection",
    label: "Add Active Selection to RayuCode Context",
    keybinding: "Cmd/Ctrl+Shift+L",
    when: "Editor Focus",
    commandId: "rayucode.sendSelection",
  },
  {
    id: "open-background-drawer",
    label: "Open Background Processes Drawer",
    keybinding: "Alt+Shift+B",
    commandId: "rayucode.openBackgroundProcesses",
  },
  {
    id: "add-to-context",
    label: "Add File(s) to RayuCode Context",
    keybinding: "Explorer / Tab Context",
    commandId: "rayucode.addToContext",
  },
  {
    id: "explain-selection",
    label: "Explain Selection with RayuCode",
    keybinding: "Editor Context Menu",
    when: "Editor Selection",
    commandId: "rayucode.explainSelection",
  },
  {
    id: "refactor-selection",
    label: "Refactor / Fix Selection with RayuCode",
    keybinding: "Editor Context Menu",
    when: "Editor Selection",
    commandId: "rayucode.refactorSelection",
  },
  {
    id: "fix-diagnostic",
    label: "Fix Diagnostic with RayuCode",
    keybinding: "Cmd/Ctrl+. (Quick Fix)",
    when: "Diagnostic on Line",
    commandId: "rayucode.fixDiagnostic",
  },
  {
    id: "ask-terminal",
    label: "Ask RayuCode about Terminal Output",
    keybinding: "Terminal Context Menu",
    commandId: "rayucode.askTerminal",
  },
  {
    id: "scm-open-changes",
    label: "Review Changes in RayuCode",
    keybinding: "Source Control Header",
    when: "Git Repository",
    commandId: "rayucode.scmOpenChanges",
  },
  {
    id: "cycle-permissions",
    label: "Cycle Local Permission Mode",
    keybinding: "Shift+Tab",
    when: "Composer Focus",
  },
  {
    id: "background-tool",
    label: "Move Running Tool to Background",
    keybinding: "Alt+B",
    when: "Active Turn",
  },
  {
    id: "toggle-session-pane",
    label: "Toggle Session & Projects Pane",
    keybinding: "Cmd/Ctrl+Shift+S",
  },
  {
    id: "search-sessions",
    label: "Search Sessions Across Tools",
    keybinding: "Cmd/Ctrl+K",
  },
  {
    id: "open-terminal",
    label: "Focus Integrated Terminal",
    keybinding: "Cmd/Ctrl+J",
  },
];

export function normalizeCredentialProviderId(providerId: string): string {
  const key = providerId.trim().toLowerCase();
  switch (key) {
    case "rayu":
    case "rayu-cloud":
    case "rayucode":
    case "subscription":
      return "rayu";
    case "anthropic":
    case "claude":
    case "claude-api":
    case "anthropic-api":
    case "anthropic-key":
    case "claude-key":
      return "claude-api";
    case "openai":
    case "openai-api":
    case "openai-key":
    case "openai-apikey":
      return "openai-api";
    case "github-copilot":
    case "copilot":
      return "copilot";
    case "aws-bedrock":
    case "bedrock":
      return "bedrock";
    case "azure-openai":
    case "azure":
      return "azure";
    case "google-gemini":
    case "gemini-api":
    case "gemini":
      return "gemini";
    case "google-workspace-vertex":
    case "google-workspace":
    case "google_workspace":
      return "google_workspace";
    default:
      return key;
  }
}

export function normalizeLogoutProviderId(providerId: string): string {
  const key = providerId.trim().toLowerCase();
  switch (key) {
    case "rayu":
    case "rayu-cloud":
    case "rayucode":
    case "subscription":
      return "rayu";
    case "anthropic":
    case "claude":
      return "claude";
    case "claude-api":
    case "anthropic-api":
      return "claude-api";
    case "openai":
      return "openai";
    case "openai-api":
      return "openai-api";
    case "github-copilot":
    case "copilot":
      return "copilot";
    case "aws-bedrock":
    case "bedrock":
      return "bedrock";
    case "azure-openai":
    case "azure":
      return "azure";
    case "google-gemini":
    case "gemini-api":
    case "gemini":
      return "gemini";
    case "google-workspace-vertex":
    case "google-workspace":
    case "google_workspace":
      return "google_workspace";
    default:
      return key;
  }
}

function normalizeUiProviderId(providerId: string): string {
  const key = providerId.trim().toLowerCase();
  switch (key) {
    case "rayu":
    case "rayu-cloud":
    case "rayucode":
    case "subscription":
      return "rayu";
    case "claude":
    case "claude-api":
    case "anthropic":
    case "anthropic-api":
      return "anthropic";
    case "openai":
    case "openai-api":
      return "openai";
    case "github-copilot":
    case "copilot":
      return "copilot";
    case "aws-bedrock":
    case "bedrock":
      return "bedrock";
    case "azure-openai":
    case "azure":
      return "azure";
    case "google-gemini":
    case "gemini-api":
    case "gemini":
      return "gemini";
    case "google-workspace-vertex":
    case "google-workspace":
    case "google_workspace":
      return "google_workspace";
    default:
      return key;
  }
}

const DEFAULT_PROVIDERS: ProviderEntryView[] = [
  { id: "rayu", name: "Rayu Cloud Gateway", category: "native", status: "needs_key", authMethod: "oauth", supportsOAuth: true },
  { id: "anthropic", name: "Anthropic (Claude)", category: "native", status: "needs_key", authMethod: "api_key", supportsOAuth: true },
  { id: "openai", name: "OpenAI", category: "native", status: "needs_key", authMethod: "api_key", supportsOAuth: true },
  { id: "gemini", name: "Google Gemini", category: "native", status: "needs_key", authMethod: "api_key", supportsOAuth: true },
  { id: "openrouter", name: "OpenRouter", category: "native", status: "needs_key", authMethod: "api_key" },
  { id: "copilot", name: "GitHub Copilot", category: "native", status: "needs_key", authMethod: "oauth", supportsOAuth: true },
  { id: "bedrock", name: "AWS Bedrock", category: "native", status: "needs_key", authMethod: "env" },
  { id: "antigravity", name: "Google Antigravity", category: "native", status: "needs_key", authMethod: "oauth", supportsOAuth: true },
  { id: "cursor", name: "Cursor", category: "native", status: "needs_key", authMethod: "oauth", supportsOAuth: true },
  { id: "grok", name: "xAI Grok", category: "native", status: "needs_key", authMethod: "api_key" },
  { id: "deepseek", name: "DeepSeek", category: "openai_compatible", status: "needs_key", authMethod: "api_key" },
  { id: "groq", name: "Groq", category: "openai_compatible", status: "needs_key", authMethod: "api_key" },
  { id: "mistral", name: "Mistral AI", category: "openai_compatible", status: "needs_key", authMethod: "api_key" },
  { id: "together", name: "Together AI", category: "openai_compatible", status: "needs_key", authMethod: "api_key" },
  { id: "fireworks", name: "Fireworks AI", category: "openai_compatible", status: "needs_key", authMethod: "api_key" },
  { id: "cerebras", name: "Cerebras", category: "openai_compatible", status: "needs_key", authMethod: "api_key" },
  { id: "perplexity", name: "Perplexity", category: "openai_compatible", status: "needs_key", authMethod: "api_key" },
  { id: "ollama", name: "Ollama (Local)", category: "openai_compatible", status: "ready", authMethod: "none" },
  { id: "lmstudio", name: "LM Studio (Local)", category: "openai_compatible", status: "ready", authMethod: "none" },
  { id: "azure", name: "Azure OpenAI", category: "enterprise", status: "needs_key", authMethod: "api_key" },
  { id: "google_workspace", name: "Google Workspace", category: "enterprise", status: "needs_key", authMethod: "oauth", supportsOAuth: true },
];

const HOOK_EVENTS: Array<{ event: HookEventId; label: string; mode: "sync" | "async" }> = [
  { event: "pre_tool", label: "Pre-Tool Execution Gate", mode: "sync" },
  { event: "post_tool", label: "Post-Tool Notification", mode: "async" },
  { event: "post_tool_feedback", label: "Post-Tool Agent Feedback", mode: "sync" },
  { event: "turn_start", label: "Turn Start Hook", mode: "async" },
  { event: "turn_end", label: "Turn End Hook", mode: "async" },
  { event: "session_start", label: "Session Start Hook", mode: "async" },
  { event: "session_end", label: "Session End Hook", mode: "async" },
];

function readMcpConfig(target: string): Record<string, unknown> {
  try {
    if (!fs.lstatSync(target).isFile()) {
      throw new HarnessError("invalid_request", "MCP config must be a regular file.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    throw new HarnessError(
      "invalid_request",
      "Existing MCP config contains malformed JSON. Repair it before editing.",
    );
  }
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    ("mcpServers" in parsed &&
      (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)))
  ) {
    throw new HarnessError("invalid_request", "Repair the existing MCP config before editing it.");
  }
  return asRecord(parsed);
}

function writeMcpConfig(target: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function createFeatureRouter(deps: FeatureRouterDeps): FeatureRouter {
  let pendingTelegramPairing: {
    generation: string | null;
    mode: "hosted" | "botfather";
    username?: string;
    pairingUrl: string;
    pairingCode?: string;
    qrSize?: number | null;
    qrPath?: string | null;
    pairingExpiresAtMs?: number;
  } | null = null;

  const execRuntimeCmd = async (
    command: RuntimeCommand,
    args: string[] = [],
    sessionId?: string,
  ): Promise<{
    ok: boolean;
    data: Record<string, unknown>;
    rawData: unknown;
    message: string;
  }> => {
    try {
      const out = await deps.sessionHub.runtimeCommand(command, args, sessionId);
      return {
        ok: true,
        data: asRecord(out.data),
        rawData: out.data,
        message: out.message ?? "",
      };
    } catch (error) {
      return {
        ok: false,
        data: {},
        rawData: undefined,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };

  /**
   * Read-only runtime command helper that degrades to `{}` when offline or idle-locked.
   * NEVER use for mutations — use `requireRuntimeCmd` so daemon errors propagate honestly.
   */
  const safeRuntimeCmd = async (
    command: RuntimeCommand,
    args: string[] = [],
    sessionId?: string,
  ): Promise<Record<string, unknown>> => (await execRuntimeCmd(command, args, sessionId)).data;

  const clientSupportsFileChanges = (client: RayucodeClient): boolean => {
    if (typeof client.supports === "function") {
      return client.supports("file_changes");
    }
    return deps.bridgeManager.getStatus().capabilities.includes("file_changes");
  };

  const resolveTrackedSessionPath = (
    sessionId: string,
    rawPath: string,
  ): string => {
    const cached = deps.sessionHub.getFileChangesSnapshot?.(sessionId);
    const matched = cached?.files.find(
      (f) => f.path === rawPath || f.displayPath === rawPath,
    );
    return matched?.path ?? rawPath;
  };

  const getSessionClient = (sessionId?: string): Promise<RayucodeClient> =>
    deps.sessionHub.ensureAttachedClient
      ? deps.sessionHub.ensureAttachedClient(sessionId)
      : deps.sessionHub.getClient(sessionId);

  const resolveEngineSnapshot = async (
    sessionId: string,
  ): Promise<FileChangesSnapshotView | null> => {
    if (typeof deps.sessionHub.fetchFileChanges === "function") {
      return deps.sessionHub.fetchFileChanges(sessionId);
    }
    try {
      const client = await getSessionClient(sessionId);
      if (
        clientSupportsFileChanges(client) &&
        typeof client.getFileChanges === "function"
      ) {
        const raw = await client.getFileChanges(sessionId);
        return mapRawFileChangesSnapshot(raw, sessionId);
      }
    } catch {
      // Fall back to cached snapshot or GitChangesBridge
    }
    return deps.sessionHub.getFileChangesSnapshot?.(sessionId) ?? null;
  };

  const tryEngineFileChangeDiff = async (
    sessionId: string,
    rawPath: string,
  ): Promise<FileDiffView | null> => {
    const targetPath = resolveTrackedSessionPath(sessionId, rawPath);
    if (typeof deps.sessionHub.getFileChangeDiff === "function") {
      try {
        return await deps.sessionHub.getFileChangeDiff(sessionId, targetPath);
      } catch {
        return null;
      }
    }
    try {
      const client = await getSessionClient(sessionId);
      if (
        clientSupportsFileChanges(client) &&
        typeof client.getFileChangeDiff === "function"
      ) {
        const raw = await client.getFileChangeDiff(sessionId, targetPath);
        return mapRawFileChangeDiff(raw, rawPath);
      }
    } catch {
      return null;
    }
    return null;
  };

  const runReviewAction = async (
    sessionId: string | undefined,
    action: FileChangeActionKind,
    opts?: { path?: string; force?: boolean },
  ): Promise<FileChangeActionResultView> => {
    if (!sessionId) {
      return { ok: false, message: "Select the session that made these edits." };
    }
    if (opts?.force && (action === "undo_all" || action === "redo_all")) {
      return { ok: false, message: "Force Restore requires an explicitly confirmed file." };
    }
    const unavailable = {
      ok: false,
      message: "Agent file actions require an engine with session file tracking.",
    };
    if (deps.sessionHub.runFileChangeAction) {
      return (await deps.sessionHub.runFileChangeAction(sessionId, action, opts)) ?? unavailable;
    }
    const client = await getSessionClient(sessionId);
    if (!clientSupportsFileChanges(client) || !client.fileChangeAction || !client.getFileChanges) {
      return unavailable;
    }
    const snapshot = mapRawFileChangesSnapshot(await client.getFileChanges(sessionId), sessionId);
    const target = opts?.path === undefined
      ? undefined
      : snapshot.files.find((file) => file.path === opts.path || file.displayPath === opts.path);
    if (snapshot.sessionId !== sessionId || (opts?.path !== undefined && !target)) {
      return { ok: false, message: "This file has no review snapshot in the selected session." };
    }
    const raw = await (async () => {
      try {
        return await client.fileChangeAction(sessionId, action, {
          ...(target ? { path: target.path } : {}),
          ...(opts?.force ? { force: true } : {}),
        });
      } catch (error) {
        try {
          const fresh = mapRawFileChangesSnapshot(await client.getFileChanges(sessionId), sessionId);
          if (fresh.sessionId === sessionId) {
            deps.sessionHub.broadcastFileChanges?.(sessionId, fresh);
          }
        } catch {
          // Best-effort snapshot recovery after uncertain error.
        }
        throw error;
      }
    })();
    const mapped = mapRawFileChangeActionResponse(raw, sessionId);
    if (mapped.snapshot?.sessionId === sessionId) {
      deps.sessionHub.broadcastFileChanges?.(sessionId, mapped.snapshot);
    } else if (!mapped.ok || !mapped.snapshot) {
      try {
        const fresh = mapRawFileChangesSnapshot(await client.getFileChanges(sessionId), sessionId);
        if (fresh.sessionId === sessionId) {
          deps.sessionHub.broadcastFileChanges?.(sessionId, fresh);
          mapped.snapshot = fresh;
        }
      } catch {
        // Leave original response intact when snapshot readback fails.
      }
    }
    return mapped;
  };

  /**
   * Mutation runtime command helper that propagates daemon errors cleanly instead of faking `{ ok: true }`.
   */
  const requireRuntimeCmd = async (
    command: RuntimeCommand,
    args: string[] = [],
    sessionId?: string,
  ): Promise<{
    data: Record<string, unknown>;
    rawData: unknown;
    message: string;
  }> => {
    const out = await deps.sessionHub.runtimeCommand(command, args, sessionId);
    return {
      data: asRecord(out.data),
      rawData: out.data,
      message: out.message ?? "",
    };
  };

  const extractFeatureFlags = (data: Record<string, unknown>): FeatureFlagsView => {
    const remoteFeatures = asRecord(data.features);
    const remoteTools = asRecord(data.tools);
    const savedFeatures = deps.getGlobalState<Partial<FeatureFlagsView>>(
      "rayucode.settings.features",
      {},
    );
    const channelRaw =
      typeof remoteFeatures.update_channel === "string"
        ? remoteFeatures.update_channel
        : savedFeatures.update_channel;
    const update_channel: UpdateChannel =
      channelRaw === "preview" || channelRaw === "main" || channelRaw === "stable"
        ? channelRaw
        : DEFAULT_FEATURE_FLAGS.update_channel;

    return {
      ...DEFAULT_FEATURE_FLAGS,
      ...savedFeatures,
      ...(typeof remoteFeatures.check_updates === "boolean"
        ? { check_updates: remoteFeatures.check_updates }
        : {}),
      ...(typeof remoteFeatures.memory === "boolean"
        ? { memory: remoteFeatures.memory }
        : {}),
      ...(typeof remoteFeatures.swarm === "boolean"
        ? { swarm: remoteFeatures.swarm }
        : {}),
      ...(typeof remoteFeatures.mermaid === "boolean"
        ? { mermaid: remoteFeatures.mermaid }
        : {}),
      ...(typeof remoteFeatures.auto_poke === "boolean"
        ? { auto_poke: remoteFeatures.auto_poke }
        : {}),
      ...(typeof remoteFeatures.todo_gate_digest === "boolean"
        ? { todo_gate_digest: remoteFeatures.todo_gate_digest }
        : {}),
      ...(typeof remoteFeatures.todo_gate_diagnostics === "boolean"
        ? { todo_gate_diagnostics: remoteFeatures.todo_gate_diagnostics }
        : {}),
      ...(typeof remoteFeatures.message_timestamps === "boolean"
        ? { message_timestamps: remoteFeatures.message_timestamps }
        : {}),
      ...(typeof remoteFeatures.persist_memory_injections === "boolean"
        ? { persist_memory_injections: remoteFeatures.persist_memory_injections }
        : {}),
      ...(typeof remoteFeatures.kv_cache_miss_notices === "boolean"
        ? { kv_cache_miss_notices: remoteFeatures.kv_cache_miss_notices }
        : {}),
      update_channel,
      ...(typeof remoteTools.codemode === "boolean"
        ? { codemode: remoteTools.codemode }
        : {}),
      ...(typeof remoteTools.integration_tools === "boolean"
        ? { integration_tools: remoteTools.integration_tools }
        : {}),
    };
  };

  const mapTelegramApprovals = (rawList: unknown): TelegramApprovalView[] =>
    asArray(rawList).map((raw, idx) => {
      const a = asRecord(raw);
      return {
        id: String(a.id ?? `tg_app_${idx}`),
        toolName: String(a.tool_name ?? a.toolName ?? a.action ?? "action"),
        commandOrSummary: String(
          a.description ??
            a.command_or_summary ??
            a.commandOrSummary ??
            a.rationale ??
            a.action ??
            "",
        ),
        requestedBy:
          typeof a.requested_by === "string"
            ? a.requested_by
            : typeof a.urgency === "string"
              ? a.urgency
              : undefined,
        createdAtMs: parseTimestampMs(a.created_at_ms ?? a.created_at),
        status: (
          ["pending", "approved", "denied"].includes(String(a.status))
            ? String(a.status)
            : "pending"
        ) as TelegramApprovalView["status"],
      };
    });

  const mapAmbientApprovals = (rawList: unknown): AmbientApprovalView[] =>
    asArray(rawList).map((raw, idx) => {
      const a = asRecord(raw);
      return {
        id: String(a.id ?? `amb_${idx}`),
        action: String(a.action ?? a.description ?? ""),
        urgency: (
          ["low", "normal", "high"].includes(String(a.urgency).toLowerCase())
            ? String(a.urgency).toLowerCase()
            : "normal"
        ) as AmbientApprovalView["urgency"],
        reason: String(
          a.rationale ?? a.why_permission_needed ?? a.reason ?? a.description ?? "",
        ),
        createdAtMs: parseTimestampMs(a.created_at_ms ?? a.created_at),
        status: (
          ["pending", "approved", "denied"].includes(String(a.status))
            ? String(a.status)
            : "pending"
        ) as AmbientApprovalView["status"],
      };
    });

  type HandlerMap = {
    [M in RpcMethod]: (params: RpcParams<M>) => Promise<RpcResult<M>>;
  };

  const workspaceRootFor = async (requestedPath?: string): Promise<string> => {
    const [folders, ledger] = await Promise.all([
      deps.getWorkspaceFolders(),
      deps.sessionHub.loadWorkspaceLedger?.() ?? deps.sessionHub.getWorkspaceLedger?.(),
    ]);
    const roots = new Set<string>();
    for (const folder of [...folders, ...(ledger?.workspaces ?? [])]) {
      try {
        roots.add(fs.realpathSync(folder.path));
      } catch {
        // An unavailable workspace cannot be a configuration target.
      }
    }
    if (requestedPath && path.isAbsolute(requestedPath)) {
      try {
        const resolved = fs.realpathSync(requestedPath);
        if (roots.has(resolved)) return resolved;
      } catch {
        throw new HarnessError("invalid_request", "Selected workspace directory does not exist on disk.");
      }
    } else if (!requestedPath && roots.size === 1) {
      return [...roots][0]!;
    }
    throw new HarnessError("invalid_request", "Select an available workspace for this change.");
  };

  const canonicalizeWorkspacePath = (rawPath: string): string => {
    const trimmed = rawPath.trim();
    try {
      return fs.realpathSync(trimmed);
    } catch {
      return path.resolve(trimmed);
    }
  };

  const resolveSessionCreateRoot = async (
    requestedPath?: string,
  ): Promise<string | undefined> => {
    const [folders, ledger] = await Promise.all([
      deps.getWorkspaceFolders(),
      deps.sessionHub.loadWorkspaceLedger?.() ??
        deps.sessionHub.getWorkspaceLedger?.(),
    ]);
    const roots = new Set<string>();
    const addRoot = (rawPath?: string) => {
      const trimmed = rawPath?.trim();
      if (!trimmed) return;
      roots.add(canonicalizeWorkspacePath(trimmed));
    };
    for (const folder of folders) {
      addRoot(folder.canonicalPath || folder.path);
    }
    for (const ws of ledger?.workspaces ?? []) {
      if (!ws.hidden && !ws.missingOnDisk) {
        addRoot(ws.canonicalPath || ws.path);
      }
    }

    const trimmedReq = requestedPath?.trim();
    if (trimmedReq) {
      if (!path.isAbsolute(trimmedReq)) {
        throw new HarnessError(
          "invalid_request",
          "Select a project workspace before starting a session.",
        );
      }
      let existsOnDisk = false;
      let canonicalReq = path.resolve(trimmedReq);
      try {
        canonicalReq = fs.realpathSync(trimmedReq);
        existsOnDisk = true;
      } catch {
        existsOnDisk = false;
      }
      if (roots.size > 0) {
        if (roots.has(canonicalReq)) {
          return canonicalReq;
        }
        if (existsOnDisk) {
          try {
            if (fs.statSync(canonicalReq).isDirectory()) {
              return canonicalReq;
            }
          } catch {
            // fall through
          }
        }
        throw new HarnessError(
          "invalid_request",
          "Selected workspace directory is not an available project workspace.",
        );
      }
      return existsOnDisk ? canonicalReq : trimmedReq;
    }

    if (roots.size > 1) {
      throw new HarnessError(
        "invalid_request",
        "Select a project workspace before starting a session.",
      );
    }
    if (roots.size === 1) {
      return [...roots][0];
    }
    return undefined;
  };

  const mcpConfigPath = async (
    scope: "global" | "workspace" | undefined,
    workspacePath?: string,
  ): Promise<string> => {
    if (scope === "workspace") return path.join(await workspaceRootFor(workspacePath), ".mcp.json");
    if (scope === "global") {
      return path.join(process.env.RAYU_HOME?.trim() || path.join(os.homedir(), ".rayu"), "mcp.json");
    }
    throw new HarnessError("invalid_request", "Select the scope of the existing MCP connector.");
  };

  const saveMcpServer = async (
    params: RpcParams<"plugins.mcp.edit">,
    editing: boolean,
  ): Promise<RpcResult<"plugins.mcp.edit">> => {
    const id = params.id.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(id) || Object.hasOwn(Object.prototype, id)) {
      return { ok: false, saved: false, message: "Enter a valid MCP server ID." };
    }
    const configPath = await mcpConfigPath(params.scope, params.workspacePath);
    const config = readMcpConfig(configPath);
    const servers = asRecord(config.mcpServers);
    const exists = Object.hasOwn(servers, id);
    if (editing !== exists) {
      return { ok: false, saved: false, message: editing ? "Connector does not exist in this config." : "This connector ID already exists in this scope." };
    }

    const existingEntry = asRecord(servers[id]);
    const entry = { ...existingEntry };
    const existingTransport: McpTransport = existingEntry.command
      ? "stdio"
      : existingEntry.type === "sse"
        ? "sse"
        : "streamable-http";
    const transport = params.transport ?? existingTransport;
    const transportChanged = !editing || (params.transport !== undefined && params.transport !== existingTransport);

    if (transport === "stdio") {
      const command = params.command ?? entry.command;
      if (typeof command !== "string" || !command.trim()) {
        return { ok: false, saved: false, message: "Provide an executable command for stdio MCP servers." };
      }
      entry.command = command.trim();
      if (params.args !== undefined) entry.args = params.args;
      if (transportChanged) {
        delete entry.type;
        delete entry.url;
      }
    } else {
      const url = params.url ?? entry.url;
      if (typeof url !== "string" || !url.trim()) {
        return { ok: false, saved: false, message: "Provide a remote URL for HTTP/SSE MCP servers." };
      }
      entry.url = url.trim();
      if (transportChanged) {
        entry.type = transport === "sse" ? "sse" : "http";
        delete entry.command;
        delete entry.args;
      } else if (params.transport && entry.type === undefined) {
        entry.type = transport === "sse" ? "sse" : "http";
      }
    }
    if (params.env) {
      const mergedEnv = { ...asRecord(entry.env) };
      for (const [k, v] of Object.entries(params.env)) {
        if (v !== "" || !(k in mergedEnv)) {
          mergedEnv[k] = v;
        }
      }
      entry.env = mergedEnv;
    }
    if (params.shared !== undefined) entry.shared = params.shared;
    if (params.timeoutSecs !== undefined) entry.timeout_secs = params.timeoutSecs;
    writeMcpConfig(configPath, { ...config, mcpServers: { ...servers, [id]: entry } });

    const reload = await execRuntimeCmd("mcp", ["reload"]);
    const reloadError = reload.ok ? undefined : (reload.message || "Engine MCP reload failed.");
    return {
      ok: true,
      saved: true,
      reloaded: reload.ok,
      ...(reloadError ? { reloadError } : {}),
      message: reload.ok ? "Connector saved and engine reloaded." : `Connector saved to disk. Engine reload failed: ${reloadError}`,
      server: {
        id,
        name: id,
        status: "cached",
        enabled: entry.enabled !== false,
        transport,
        configLayer: params.scope ?? "global",
        configPath,
        shared: entry.shared !== false,
        command: typeof entry.command === "string" ? entry.command : undefined,
        args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
        url: typeof entry.url === "string" ? entry.url : undefined,
        envKeys: entry.env ? Object.keys(asRecord(entry.env)) : undefined,
        timeoutSecs: typeof entry.timeout_secs === "number" ? entry.timeout_secs : undefined,
      },
    };
  };

  const handlers: HandlerMap = {
    // -------------------------------------------------------------------------
    // 1. Daemon / Bridge
    // -------------------------------------------------------------------------
    "daemon.status": async () => deps.bridgeManager.getStatus(),
    "daemon.ping": async () => deps.bridgeManager.ping(),
    "daemon.reconnect": async () => deps.bridgeManager.reconnect(),
    "daemon.restart": async () => deps.bridgeManager.restart(),
    "daemon.updateEngine": async () =>
      deps.bridgeManager.updateEngine
        ? deps.bridgeManager.updateEngine()
        : deps.bridgeManager.restart(),
    "daemon.reload": async () => {
      const sid = deps.sessionHub.getActiveSessionId();
      if (sid && deps.sessionHub.ensureAttachedClient) {
        try {
          const out = await deps.sessionHub.runtimeCommand("server_reload", [], sid);
          return { ok: true, message: out.message || "Daemon reloaded." };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return deps.bridgeManager.reloadDaemon(sid);
    },
    "daemon.selfdev": async (params) => {
      const action = params?.action ?? "status";
      if (action === "status") {
        const res = await execRuntimeCmd("info", ["status"]);
        return {
          ok: res.ok,
          status: res.ok ? "ready" : "offline",
          output: res.message || undefined,
        };
      }
      return {
        ok: false,
        status: "unsupported",
        output: `Self-dev '${action}' is not exposed via runtime_command; run \`rayu self-dev --${action}\` in the integrated terminal.`,
      };
    },
    "daemon.openOutputLog": async () => {
      deps.bridgeManager.openOutputLog();
      return { ok: true, message: "Opened RayuCode Runtime output log." };
    },

    // -------------------------------------------------------------------------
    // 2. Workspace
    // -------------------------------------------------------------------------
    "workspace.listFolders": async () => ({
      folders: await deps.getWorkspaceFolders(),
    }),
    "workspace.ledger.get": async () => {
      if (typeof deps.sessionHub.loadWorkspaceLedger === "function") {
        return deps.sessionHub.loadWorkspaceLedger();
      }
      if (typeof deps.sessionHub.getWorkspaceLedger === "function") {
        return deps.sessionHub.getWorkspaceLedger();
      }
      const folders = await deps.getWorkspaceFolders();
      const now = Date.now();
      return {
        version: 1 as const,
        updatedAt: now,
        workspaces: folders.map((f, idx) => ({
          id: f.id ?? `ws_${idx}_${f.name}`,
          name: f.name,
          path: f.path,
          canonicalPath: f.canonicalPath ?? f.path,
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
          branch: f.branch,
          icon: f.icon,
          isPrimary: f.isPrimary,
        })),
        pinnedSessionIds: [],
        archivedSessionIds: [],
        collapsedWorkspaceIds: [],
        manualWorkspaceOrder: [],
        openFolderPaths: folders.map((f) => f.path),
      };
    },
    "workspace.ledger.ensure": async (params) => {
      if (typeof deps.sessionHub.ensureWorkspace === "function") {
        return deps.sessionHub.ensureWorkspace(params.path, {
          name: params.name,
          unhide: params.unhide,
        });
      }
      return handlers["workspace.ledger.get"](undefined);
    },
    "workspace.ledger.remove": async (params) => {
      if (typeof deps.sessionHub.removeWorkspace === "function") {
        return deps.sessionHub.removeWorkspace(params.idOrPath);
      }
      return handlers["workspace.ledger.get"](undefined);
    },
    "workspace.ledger.setPinned": async (params) => {
      if (typeof deps.sessionHub.setSessionPinnedLedger === "function") {
        return deps.sessionHub.setSessionPinnedLedger(
          params.sessionId,
          params.pinned,
        );
      }
      await deps.sessionHub.setSessionPinned(params.sessionId, params.pinned);
      return handlers["workspace.ledger.get"](undefined);
    },
    "workspace.ledger.setArchived": async (params) => {
      if (typeof deps.sessionHub.setSessionArchivedLedger === "function") {
        return deps.sessionHub.setSessionArchivedLedger(
          params.sessionId,
          params.archived,
        );
      }
      await deps.sessionHub.setSessionArchived(
        params.sessionId,
        params.archived,
      );
      return handlers["workspace.ledger.get"](undefined);
    },
    "workspace.ledger.setCollapsed": async (params) => {
      if (typeof deps.sessionHub.setWorkspaceCollapsed === "function") {
        return deps.sessionHub.setWorkspaceCollapsed(
          params.workspaceId,
          params.collapsed,
        );
      }
      return handlers["workspace.ledger.get"](undefined);
    },
    "workspace.ledger.attachSession": async (params) => {
      if (typeof deps.sessionHub.attachSessionToWorkspace === "function") {
        return deps.sessionHub.attachSessionToWorkspace(
          params.workspaceIdOrPath,
          params.sessionId,
        );
      }
      return handlers["workspace.ledger.get"](undefined);
    },
    "workspace.ledger.importProjectGroup": async (params) => {
      if (typeof deps.sessionHub.importProjectGroup === "function") {
        return deps.sessionHub.importProjectGroup(params.path, {
          name: params.name,
          sessionIds: params.sessionIds,
        });
      }
      return handlers["workspace.ledger.get"](undefined);
    },
    "workspace.findFiles": async (params) => {
      const limit = params.limit ?? 50;
      const sid = params.sessionId ?? deps.sessionHub.getActiveSessionId();
      if (sid) {
        try {
          const client = await getSessionClient(sid);
          const files = await client.findFiles(sid, params.query, limit);
          return { files };
        } catch {
          // fall back to local VS Code workspace search
        }
      }
      const files = await deps.editorBridge.findWorkspaceFiles(params.query, limit);
      return { files };
    },
    "workspace.contextSnapshot": async (params) => {
      const { data } = await requireRuntimeCmd("context", [], params.sessionId);
      const breakdown = asRecord(data.token_breakdown ?? data);
      const system = Number(breakdown.system ?? 0);
      const tools = Number(breakdown.tools ?? 0);
      const memory = Number(breakdown.memory ?? 0);
      const files = Number(breakdown.files ?? 0);
      const messages = Number(breakdown.messages ?? 0);
      const usedTokens = Number(
        breakdown.total_used ?? data.used_tokens ?? system + tools + memory + files + messages,
      );
      const maxTokens = Number(breakdown.context_window ?? data.max_tokens ?? 200_000);
      const freeTokens = Math.max(0, Number(breakdown.free ?? maxTokens - usedTokens));
      const usedPercent =
        maxTokens > 0 ? Math.min(100, Math.round((usedTokens / maxTokens) * 1000) / 10) : 0;

      const categories: ContextSnapshotView["categories"] = [
        { id: "system", label: "System & Instructions", tokens: system, colorToken: "brand" },
        { id: "tools", label: "Tools & MCP Schemas", tokens: tools, colorToken: "info" },
        { id: "memory", label: "Memory Graph", tokens: memory, colorToken: "type" },
        { id: "files", label: "Referenced Files", tokens: files, colorToken: "folder" },
        { id: "messages", label: "Conversation Transcript", tokens: messages, colorToken: "num" },
      ];

      return {
        sessionId: params.sessionId,
        usedTokens,
        maxTokens,
        usedPercent,
        freeTokens,
        cacheTtl: deps.getGlobalState<CacheTtl>("rayucode.settings.cacheTtl", "5m"),
        kvCacheHitPercent:
          typeof data.kv_cache_hit_percent === "number"
            ? data.kv_cache_hit_percent
            : undefined,
        categories,
      };
    },
    "workspace.setContextCap": async (params) => {
      try {
        const client = await getSessionClient(params.sessionId);
        await client.setContextCap(params.sessionId, params.maxTokens);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    "workspace.compact": async (params) => {
      try {
        const client = await getSessionClient(params.sessionId);
        const message = await client.compact(params.sessionId);
        return { ok: true, message };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    "workspace.setProjectIcon": async (params) => {
      await deps.setProjectIcon(params.workspacePath, params.icon);
      return { ok: true };
    },
    "workspace.pickFiles": async (params) => {
      const paths = await deps.editorBridge.pickFiles({
        canSelectMany: params.canSelectMany,
        filters: params.filters,
      });
      return { paths };
    },
    "workspace.listBranches": async (params) =>
      deps.gitBridge.listBranches(params?.workspacePath),
    "workspace.checkoutBranch": async (params) =>
      deps.gitBridge.checkoutBranch(params.workspacePath, params.branch),

    // -------------------------------------------------------------------------
    // 3. Sessions
    // -------------------------------------------------------------------------
    "sessions.list": async (params) => deps.sessionHub.listSessions(
      params?.includeArchived ?? false,
      { includeExternal: params?.includeExternal ?? true, sources: params?.sources },
    ),
    "sessions.listExternalProjects": async (params) => {
      try {
        if (typeof deps.sessionHub.listExternalProjects === "function") {
          return await deps.sessionHub.listExternalProjects(params?.source);
        }
        return { projects: [] };
      } catch {
        return { projects: [] };
      }
    },
    "sessions.importExternal": async (params) => {
      if (typeof deps.sessionHub.importExternalSessions === "function") {
        return await deps.sessionHub.importExternalSessions(params.items, {
          forceResync: params.forceResync,
          forkOnConflict: params.forkOnConflict,
        });
      }
      return { sessions: [], skipped: [] };
    },
    "sessions.search": async (params) => {
      const queryWords = params.query.trim().split(/\s+/).filter(Boolean);
      const args = queryWords.length > 0 ? [...queryWords] : [params.query];
      if (params.scope && params.scope !== "all") {
        args.push("--scope", params.scope);
      }
      const data = await safeRuntimeCmd("session_search", args);
      const rawMatches = asArray(data.results ?? data.matches ?? data.hits);
      const validSources = new Set([
        "rayu",
        "claude",
        "codex",
        "cursor",
        "pi",
        "opencode",
      ]);
      const hits: SessionSearchHitView[] = rawMatches.map((raw, idx) => {
        const item = asRecord(raw);
        const rawSource = String(item.source ?? item.sourceTool ?? "rayu").toLowerCase();
        const sourceTool = (
          validSources.has(rawSource) ? rawSource : "rayu"
        ) as SessionSourceTool;
        const rawUpdated = item.updated_at ?? item.updatedAtMs;
        return {
          sessionId: String(item.session_id ?? item.sessionId ?? `hit_${idx}`),
          title: String(item.title ?? item.short_name ?? "Session"),
          snippet: String(item.snippet ?? ""),
          sourceTool,
          workingDir:
            typeof item.working_dir === "string"
              ? item.working_dir
              : typeof item.workingDir === "string"
                ? item.workingDir
                : undefined,
          updatedAtMs:
            rawUpdated !== undefined && rawUpdated !== null
              ? parseTimestampMs(rawUpdated)
              : undefined,
          score: typeof item.score === "number" ? item.score : undefined,
        };
      });
      return { hits };
    },
    "sessions.create": async (params) => {
      const workingDir = await resolveSessionCreateRoot(params?.workingDir);
      const session = await deps.sessionHub.createSession({ ...params, workingDir });
      return { session };
    },
    "sessions.attach": async (params) => {
      const session = await deps.sessionHub.attachSession(params.sessionId);
      return { session };
    },
    "sessions.history": async (params) => deps.sessionHub.getHistory(params.sessionId),
    "sessions.rename": async (params) => {
      const client = await getSessionClient(params.sessionId);
      await client.renameSession(params.sessionId, params.title);
      return { ok: true, title: params.title };
    },
    "sessions.fork": async (params) => {
      if (params.atTurnId) {
        throw new HarnessError("unsupported", "The engine can fork a whole session. Forking at a particular turn is unavailable.");
      }
      const client = await getSessionClient(params.sessionId);
      const info = await client.forkSession(params.sessionId);
      return { session: deps.sessionHub.mapSessionInfoToSummary(info) };
    },
    "sessions.transfer": async (params) => {
      const client = await getSessionClient(params.sessionId);
      const info = await client.transferSession(params.sessionId);
      return { session: deps.sessionHub.mapSessionInfoToSummary(info) };
    },
    "sessions.export": async (params) => {
      const client = await getSessionClient(params.sessionId);
      const history = await client.getHistory(params.sessionId);
      if (params.format === "json") {
        return { content: JSON.stringify(history, null, 2) };
      }
      const lines = history.map(
        (msg) => `### ${msg.role.toUpperCase()}\n\n${msg.content}\n`,
      );
      return { content: lines.join("\n---\n\n") };
    },
    "sessions.archive": async (params) => {
      await deps.sessionHub.setSessionArchived(params.sessionId, params.archived);
      return { ok: true };
    },
    "sessions.pin": async (params) => {
      await deps.sessionHub.setSessionPinned(params.sessionId, params.pinned);
      return { ok: true };
    },
    "sessions.projectIcon": async (params) => {
      await deps.setProjectIcon(params.workspacePath, params.icon);
      return { ok: true };
    },
    "sessions.setPermissionMode": async (params) =>
      deps.sessionHub.setPermissionMode(params.sessionId, params.mode),
    "sessions.rewind": async (params) => {
      const client = await getSessionClient(params.sessionId);
      let index = 0;
      if (
        typeof params.messageIndex === "number" &&
        Number.isInteger(params.messageIndex) &&
        params.messageIndex >= 1
      ) {
        index = params.messageIndex;
      } else {
        const suffixMatch = /_(\d+)$/.exec(params.turnId);
        if (suffixMatch) {
          const parsedSuffix = Number.parseInt(suffixMatch[1]!, 10);
          if (Number.isFinite(parsedSuffix) && parsedSuffix >= 1) {
            index = parsedSuffix;
          }
        } else {
          const parsedDirect = Number.parseInt(params.turnId, 10);
          if (Number.isFinite(parsedDirect) && parsedDirect >= 1) {
            index = parsedDirect;
          }
        }
      }
      if (index < 1) {
        throw new HarnessError(
          "invalid_request",
          `Invalid rewind target '${params.turnId}': expected a 1-based user message index.`,
        );
      }
      await client.rewind(params.sessionId, index);
      return { ok: true };
    },
    "sessions.rewindUndo": async (params) => {
      const client = await getSessionClient(params.sessionId);
      await client.rewindUndo(params.sessionId);
      return { ok: true };
    },
    "sessions.softInterrupt": async (params) => {
      const client = await getSessionClient(params.sessionId);
      const interruptId =
        params.clientId?.trim() ||
        `si_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const images = normalizeImageAttachments(params.images);
      await client.softInterruptWithId(params.sessionId, params.text, {
        urgent: params.urgent ?? false,
        clientId: interruptId,
        ...(images.length > 0 ? { images } : {}),
      });
      return { ok: true, interruptId };
    },
    "sessions.cancelSoftInterrupts": async (params) => {
      const client = await getSessionClient(params.sessionId);
      if (params.interruptId) {
        const supportsIds =
          typeof client.supports === "function"
            ? client.supports("soft_interrupt_ids")
            : true;
        if (supportsIds && typeof client.cancelSoftInterrupt === "function") {
          const cancelled = await client.cancelSoftInterrupt(
            params.sessionId,
            params.interruptId,
          );
          return { ok: true, cancelled: Boolean(cancelled) };
        }
        await client.cancelSoftInterrupts(params.sessionId);
        return { ok: true, cancelled: true };
      }
      await client.cancelSoftInterrupts(params.sessionId);
      return { ok: true, cancelled: true };
    },
    "sessions.respondPermission": async (params) => {
      await deps.sessionHub.respondPermission(params);
      return { ok: true };
    },
    "sessions.respondQuestion": async (params) => {
      const client = await getSessionClient(params.sessionId);
      const response = buildQuestionResponseWire(params.answers, params.notes, {
        selected: params.selected,
        declined: params.declined,
      });
      const reply = await client.request({
        req: "question_response",
        session_id: params.sessionId,
        request_id: params.requestId,
        response,
      } as unknown as Parameters<RayucodeClient["request"]>[0]);
      if (reply && reply.ev === "error") {
        throw new HarnessError(
          String(reply.code ?? "internal"),
          String(reply.message ?? "Question response rejected by runtime."),
        );
      }
      return { ok: true };
    },

    // -------------------------------------------------------------------------
    // 4. Background Tasks
    // -------------------------------------------------------------------------
    "background.list": async (params) => {
      const targetSessionId =
        params?.sessionId ?? deps.sessionHub.getActiveSessionId();
      if (!targetSessionId) {
        return { tasks: [] };
      }
      const tasks = await deps.sessionHub.refreshBackgroundProcesses(targetSessionId);
      return { tasks: tasks.filter((t) => t.sessionId === targetSessionId) };
    },
    "background.status": async (params) => {
      const data = await safeRuntimeCmd("background", ["status", params.taskId]);
      if (data.task && typeof data.task === "object") {
        return {
          task: mapRawBackgroundTask(
            data.task as Record<string, unknown>,
            deps.sessionHub.getActiveSessionId(),
          ),
        };
      }
      const existing =
        deps.sessionHub
          .getBackgroundTasks()
          .find((t) => t.taskId === params.taskId) ?? null;
      return { task: existing };
    },
    "background.output": async (params): Promise<BackgroundProcessOutputView> => {
      const maxBytes = params.maxBytes ?? 131_072;
      const data = await safeRuntimeCmd("background", [
        "output",
        params.taskId,
        String(maxBytes),
      ]);
      let content = "";
      let truncated = Boolean(data.truncated);
      let byteLength: number | undefined =
        typeof data.total_bytes === "number" ? data.total_bytes : undefined;
      let outputFile =
        typeof data.output_file === "string" ? data.output_file : undefined;

      if (typeof data.output === "string") {
        content = data.output;
      } else if (data.output && typeof data.output === "object") {
        const outObj = asRecord(data.output);
        content = String(outObj.text ?? outObj.content ?? "");
        truncated = Boolean(outObj.truncated ?? truncated);
        if (typeof outObj.bytes === "number") byteLength = outObj.bytes;
        if (typeof outObj.output_file === "string") outputFile = outObj.output_file;
      } else if (typeof data.text === "string" || typeof data.content === "string") {
        content = String(data.text ?? data.content ?? "");
      }

      const existing = deps.sessionHub
        .getBackgroundTasks()
        .find((t) => t.taskId === params.taskId);
      return {
        taskId: params.taskId,
        content,
        truncated,
        byteLength: byteLength ?? Buffer.byteLength(content, "utf8"),
        outputFile: outputFile ?? existing?.outputFile,
        status: existing?.status ?? "running",
      };
    },
    "background.cancel": async (params) => {
      const { data, message } = await requireRuntimeCmd(
        "background",
        ["cancel", params.taskId],
        params.sessionId,
      );
      await deps.sessionHub.refreshBackgroundProcesses(params.sessionId);
      const cancelled = data.cancelled !== false;
      return {
        ok: cancelled,
        message: message || (cancelled ? `Stopped task ${params.taskId}.` : `Task ${params.taskId} could not be cancelled.`),
      };
    },
    "background.cleanup": async (params) => {
      const targetSessionId =
        params?.sessionId ?? deps.sessionHub.getActiveSessionId();
      const { data } = await requireRuntimeCmd(
        "background",
        ["cleanup"],
        targetSessionId,
      );
      const localRemoved =
        deps.sessionHub.removeCompletedBackgroundTasks(targetSessionId);
      const removedCount =
        typeof data.removed_files === "number"
          ? data.removed_files
          : typeof data.cleaned === "number"
            ? data.cleaned
            : localRemoved;
      return { ok: true, removedCount };
    },
    "background.backgroundTool": async (params) => {
      const client = await getSessionClient(params.sessionId);
      const res = await client.backgroundToolResult(params.sessionId);
      await deps.sessionHub.refreshBackgroundProcesses(params.sessionId);
      return { ok: res.moved, taskId: res.toolCallId };
    },

    // -------------------------------------------------------------------------
    // 5. Swarm Mission Control
    // -------------------------------------------------------------------------
    "swarm.status": async (params) => {
      // Rust `swarm` accepts at most 1 arg (`status` / `list` / `board`)
      const { data } = await requireRuntimeCmd("swarm", ["status"]);
      const rawSwarms = asArray(data.swarms).map(asRecord);
      const selectedSwarm = params?.swarmId
        ? rawSwarms.find((s) => String(s.swarm_id ?? s.swarmId ?? "") === params.swarmId)
        : rawSwarms.find((s) => Boolean(s.live)) ?? rawSwarms[0];
      const rawSwarm = asRecord(data.swarm ?? selectedSwarm ?? data);

      const rawMembers = asArray(
        selectedSwarm?.members ??
          data.members ??
          rawSwarm.members ??
          rawSwarm.agents,
      );
      const resolvedSwarmId =
        typeof rawSwarm.swarm_id === "string"
          ? rawSwarm.swarm_id
          : typeof rawSwarm.swarmId === "string"
            ? rawSwarm.swarmId
            : typeof data.swarm_id === "string"
              ? data.swarm_id
              : undefined;

      if (!resolvedSwarmId && rawMembers.length === 0 && rawSwarms.length === 0) {
        return { swarm: null };
      }

      const agents: SwarmAgentView[] = rawMembers.map((raw, idx) => {
        const a = asRecord(raw);
        const todoProg = asRecord(a.todo_progress);
        const rawStatus = String(a.status ?? "running").toLowerCase();
        const status: SwarmAgentView["status"] = (
          [
            "spawned",
            "ready",
            "running",
            "blocked",
            "completed",
            "failed",
            "crashed",
            "stopped",
          ].includes(rawStatus)
            ? rawStatus
            : rawStatus === "working" || rawStatus === "active"
              ? "running"
              : rawStatus === "waiting" || rawStatus === "idle"
                ? "ready"
                : rawStatus === "done"
                  ? "completed"
                  : "running"
        ) as SwarmAgentView["status"];

        return {
          agentId: String(
            a.agent_id ??
              a.agentId ??
              a.friendly_name ??
              a.session_id ??
              a.id ??
              `worker-${idx + 1}`,
          ),
          sessionId: String(a.session_id ?? a.sessionId ?? ""),
          label: String(
            a.friendly_name ??
              a.label ??
              a.task_label ??
              a.name ??
              `worker-${idx + 1}`,
          ),
          role: a.role === "coordinator" ? "coordinator" : "worker",
          depth: typeof a.depth === "number" ? a.depth : a.role === "coordinator" ? 0 : 1,
          status,
          model: typeof a.model === "string" ? a.model : undefined,
          provider: typeof a.provider === "string" ? a.provider : undefined,
          currentIntent:
            typeof a.detail === "string" && a.detail
              ? a.detail
              : typeof a.task_label === "string" && a.task_label
                ? a.task_label
                : typeof a.current_intent === "string"
                  ? a.current_intent
                  : typeof a.currentIntent === "string"
                    ? a.currentIntent
                    : undefined,
          worktreePath:
            typeof a.working_dir === "string"
              ? a.working_dir
              : typeof a.worktree_path === "string"
                ? a.worktree_path
                : typeof a.worktreePath === "string"
                  ? a.worktreePath
                  : undefined,
          branch: typeof a.branch === "string" ? a.branch : undefined,
          diffAdditions:
            typeof a.diff_additions === "number" ? a.diff_additions : undefined,
          diffDeletions:
            typeof a.diff_deletions === "number" ? a.diff_deletions : undefined,
          todoCompleted:
            typeof a.todo_completed === "number"
              ? a.todo_completed
              : typeof todoProg.completed === "number"
                ? todoProg.completed
                : undefined,
          todoTotal:
            typeof a.todo_total === "number"
              ? a.todo_total
              : typeof todoProg.total === "number"
                ? todoProg.total
                : undefined,
          updatedAtMs:
            typeof a.updated_at_ms === "number" ? a.updated_at_ms : undefined,
        };
      });

      const rawBoard = asArray(data.board ?? rawSwarm.board ?? data.messages);
      const board: SwarmBoardMessageView[] = rawBoard
        .map(asRecord)
        .filter((m) => {
          if (!resolvedSwarmId || !m.swarm_id) return true;
          return String(m.swarm_id) === resolvedSwarmId;
        })
        .map((m, idx) => {
          const eventObj = asRecord(m.event);
          const rawKind = String(m.kind ?? eventObj.kind ?? "lifecycle").toLowerCase();
          const kind: SwarmBoardMessageView["kind"] = (
            ["dm", "broadcast", "channel", "lifecycle", "completion"].includes(rawKind)
              ? rawKind
              : "lifecycle"
          ) as SwarmBoardMessageView["kind"];
          const text =
            typeof m.text === "string"
              ? m.text
              : typeof m.event === "string"
                ? m.event
                : typeof eventObj.message === "string"
                  ? eventObj.message
                  : typeof eventObj.text === "string"
                    ? eventObj.text
                    : Object.keys(eventObj).length > 0
                      ? JSON.stringify(eventObj)
                      : "";
          return {
            seq: typeof m.seq === "number" ? m.seq : idx + 1,
            kind,
            from: String(
              m.from ?? m.session_name ?? m.agent ?? m.session_id ?? "coordinator",
            ),
            to: typeof m.to === "string" ? m.to : undefined,
            channel: typeof m.channel === "string" ? m.channel : undefined,
            text,
            timestampMs: parseTimestampMs(m.timestamp_ms ?? m.timestampMs),
          };
        });

      const rawPlans = asArray(data.plans).map(asRecord);
      const matchedPlan =
        (resolvedSwarmId
          ? rawPlans.find((p) => String(p.swarm_id ?? "") === resolvedSwarmId)
          : undefined) ??
        (selectedSwarm?.plan ? asRecord(selectedSwarm.plan) : undefined) ??
        rawPlans[0];
      const rawPlanItems = asArray(
        matchedPlan?.items ?? rawSwarm.plan_items ?? rawSwarm.planItems,
      );

      const swarm: SwarmStatusView = {
        swarmId: resolvedSwarmId ?? "default",
        label: String(rawSwarm.label ?? resolvedSwarmId ?? "Active Swarm"),
        planVersion:
          typeof matchedPlan?.version === "number"
            ? matchedPlan.version
            : typeof rawSwarm.plan_version === "number"
              ? rawSwarm.plan_version
              : 1,
        planLabel:
          typeof rawSwarm.plan_label === "string" ? rawSwarm.plan_label : undefined,
        creditsUsed:
          typeof rawSwarm.credits_used === "number" ? rawSwarm.credits_used : undefined,
        kvWarmPercent:
          typeof rawSwarm.kv_warm_percent === "number"
            ? rawSwarm.kv_warm_percent
            : undefined,
        agents,
        board,
        planItems: rawPlanItems.map((p, idx) => {
          const item = asRecord(p);
          return {
            id: String(item.id ?? `plan_${idx}`),
            phase: typeof item.phase === "string" ? item.phase : undefined,
            title: String(item.title ?? item.description ?? ""),
            assignee:
              typeof item.assignee === "string"
                ? item.assignee
                : typeof item.owner === "string"
                  ? item.owner
                  : undefined,
            status: (
              ["pending", "in_progress", "completed", "blocked"].includes(
                String(item.status),
              )
                ? String(item.status)
                : "pending"
            ) as SwarmStatusView["planItems"][number]["status"],
          };
        }),
        pendingProposals: asArray(
          rawSwarm.pending_proposals ?? rawSwarm.pendingProposals,
        ).map((p, idx) => {
          const prop = asRecord(p);
          return {
            proposalId: String(prop.proposal_id ?? prop.proposalId ?? `prop_${idx}`),
            version: typeof prop.version === "number" ? prop.version : 1,
            author: String(prop.author ?? "worker"),
            summary: String(prop.summary ?? ""),
            diffSummary:
              typeof prop.diff_summary === "string" ? prop.diff_summary : undefined,
            status: (
              ["pending", "approved", "rejected"].includes(String(prop.status))
                ? String(prop.status)
                : "pending"
            ) as SwarmStatusView["pendingProposals"][number]["status"],
            createdAtMs: parseTimestampMs(prop.created_at_ms ?? prop.created_at),
          };
        }),
        worktrees: asArray(rawSwarm.worktrees).map((w, idx) => {
          const wt = asRecord(w);
          return {
            id: String(wt.id ?? `wt_${idx}`),
            branch: String(wt.branch ?? "HEAD"),
            path: String(wt.path ?? ""),
            manager: typeof wt.manager === "string" ? wt.manager : undefined,
            agents: asArray(wt.agents).map(String),
            dirtyFiles: typeof wt.dirty_files === "number" ? wt.dirty_files : 0,
          };
        }),
        conflicts: asArray(rawSwarm.conflicts).map((c) => {
          const cf = asRecord(c);
          return {
            path: String(cf.path ?? ""),
            agents: asArray(cf.agents).map(String),
            detail: typeof cf.detail === "string" ? cf.detail : undefined,
          };
        }),
        modelAllowlist: Array.isArray(rawSwarm.model_allowlist)
          ? rawSwarm.model_allowlist.map(String)
          : undefined,
      };
      return { swarm };
    },
    "swarm.list": async () => {
      const { data } = await requireRuntimeCmd("swarm", ["list"]);
      const swarms: SwarmSummaryView[] = asArray(data.swarms).map((raw, idx) => {
        const s = asRecord(raw);
        const members = asArray(s.members).map(asRecord);
        const memberCount =
          typeof s.member_count === "number"
            ? s.member_count
            : members.length > 0
              ? members.length
              : 1;
        const runningCount =
          typeof s.running_count === "number"
            ? s.running_count
            : members.filter((m) =>
                ["running", "working", "active", "spawned"].includes(
                  String(m.status ?? "").toLowerCase(),
                ),
              ).length;
        const completedCount =
          typeof s.completed_count === "number"
            ? s.completed_count
            : members.filter((m) =>
                ["completed", "done"].includes(String(m.status ?? "").toLowerCase()),
              ).length;
        return {
          swarmId: String(s.swarm_id ?? s.swarmId ?? `swarm_${idx}`),
          label: String(s.label ?? s.swarm_id ?? "Swarm"),
          coordinatorSessionId: String(
            s.coordinator_session_id ?? s.coordinatorSessionId ?? "",
          ),
          memberCount,
          runningCount,
          completedCount,
          active: Boolean(s.live ?? s.active ?? true),
        };
      });
      return { swarms };
    },
    "swarm.setLabel": async () => ({
      ok: false,
      message: "Swarm title updates are not supported via runtime_command yet.",
    }),
    "swarm.spawn": async () => ({
      ok: false,
      message:
        "Live worker spawning via runtime_command is not supported yet; ask the coordinator agent in chat to spawn workers.",
    }),
    "swarm.kill": async () => ({
      ok: false,
      message:
        "Stopping or killing swarm workers via runtime_command is not supported yet.",
    }),
    "swarm.salvage": async () => ({
      ok: false,
      message: "Swarm salvage via runtime_command is not supported yet.",
    }),
    "swarm.pauseAll": async () => ({
      ok: false,
      message: "Pausing all swarm workers via runtime_command is not supported yet.",
    }),
    "swarm.board": async (params) => {
      // Rust `swarm` accepts at most 1 arg (`board`)
      const { data } = await requireRuntimeCmd("swarm", ["board"]);
      const messages: SwarmBoardMessageView[] = asArray(data.board ?? data.messages)
        .map(asRecord)
        .filter((m) => {
          if (params?.swarmId && m.swarm_id && String(m.swarm_id) !== params.swarmId) {
            return false;
          }
          return true;
        })
        .map((m, idx) => {
          const eventObj = asRecord(m.event);
          const rawKind = String(m.kind ?? eventObj.kind ?? "lifecycle").toLowerCase();
          const kind: SwarmBoardMessageView["kind"] = (
            ["dm", "broadcast", "channel", "lifecycle", "completion"].includes(rawKind)
              ? rawKind
              : "lifecycle"
          ) as SwarmBoardMessageView["kind"];
          const text =
            typeof m.text === "string"
              ? m.text
              : typeof m.event === "string"
                ? m.event
                : typeof eventObj.message === "string"
                  ? eventObj.message
                  : typeof eventObj.text === "string"
                    ? eventObj.text
                    : Object.keys(eventObj).length > 0
                      ? JSON.stringify(eventObj)
                      : "";
          return {
            seq: typeof m.seq === "number" ? m.seq : idx + 1,
            kind,
            from: String(
              m.from ?? m.session_name ?? m.agent ?? m.session_id ?? "coordinator",
            ),
            to: typeof m.to === "string" ? m.to : undefined,
            channel: typeof m.channel === "string" ? m.channel : undefined,
            text,
            timestampMs: parseTimestampMs(m.timestamp_ms ?? m.timestampMs),
          };
        })
        .filter((msg) => {
          if (params?.filter && params.filter !== "all") {
            return msg.kind === params.filter;
          }
          return true;
        });
      return { messages };
    },
    "swarm.planDecide": async () => ({
      ok: false,
      message: "Swarm plan approval via runtime_command is not supported yet.",
    }),
    "swarm.worktreeOpen": async (params) => {
      await deps.editorBridge.openWorktreeWindow(params.path);
      return { ok: true };
    },
    "swarm.dm": async () => ({
      ok: false,
      message: "Direct-messaging swarm workers via runtime_command is not supported yet.",
    }),
    "swarm.peekSession": async (params) => {
      try {
        const client = await deps.sessionHub.getClient();
        const [entries, todoSnap] = await Promise.all([
          client.peekSession(params.sessionId, 50).catch(() => []),
          client.todoState(params.sessionId).catch(() => null),
        ]);
        const todos = todoSnap
          ? normalizeTodoItems(todoSnap)
          : deps.sessionHub.getCachedTodos(params.sessionId);
        return { entries, todos };
      } catch {
        return {
          entries: [],
          todos: deps.sessionHub.getCachedTodos(params.sessionId),
        };
      }
    },

    // -------------------------------------------------------------------------
    // 6. Automations
    // -------------------------------------------------------------------------
    "automations.overnight.list": async () => {
      const { data } = await requireRuntimeCmd("overnight", ["list"]);
      const runs: OvernightRunView[] = asArray(data.runs).map((raw, idx) => {
        const r = asRecord(raw);
        const taskSummary = asRecord(r.task_summary);
        const rawStatus = String(r.status ?? "running").toLowerCase();
        const status: OvernightRunView["status"] =
          rawStatus === "paused"
            ? "paused"
            : rawStatus === "completed" || rawStatus === "done"
              ? "completed"
              : rawStatus === "cancelled" || rawStatus === "cancel_requested"
                ? "cancelled"
                : rawStatus === "failed" || rawStatus === "error"
                  ? "failed"
                  : "running";
        const rawUpdated = r.updated_at_ms ?? r.updated_at ?? r.completed_at;
        return {
          runId: String(r.run_id ?? r.runId ?? `ovn_${idx}`),
          mission: String(r.mission ?? r.goal ?? "Overnight run"),
          status,
          mode: typeof r.mode === "string" ? r.mode : "local",
          repo:
            typeof r.repo === "string"
              ? r.repo
              : typeof r.working_dir === "string"
                ? r.working_dir
                : undefined,
          branch: typeof r.branch === "string" ? r.branch : undefined,
          agentCount: typeof r.agent_count === "number" ? r.agent_count : 1,
          durationLabel: String(
            r.duration_label ?? r.duration ?? r.duration_secs ?? "4h",
          ),
          wakesAt: typeof r.wakes_at === "string" ? r.wakes_at : undefined,
          handoffAt:
            typeof r.handoff_at === "string"
              ? r.handoff_at
              : typeof r.ends_at === "string"
                ? r.ends_at
                : undefined,
          taskCardCount:
            typeof r.task_card_count === "number"
              ? r.task_card_count
              : typeof taskSummary.total === "number"
                ? taskSummary.total
                : 0,
          validationsGreen:
            typeof r.validations_green === "number"
              ? r.validations_green
              : typeof taskSummary.passed === "number"
                ? taskSummary.passed
                : typeof taskSummary.completed === "number"
                  ? taskSummary.completed
                  : 0,
          coordinatorSessionId:
            typeof r.coordinator_session_id === "string"
              ? r.coordinator_session_id
              : typeof r.session_id === "string"
                ? r.session_id
                : undefined,
          reviewPath:
            typeof r.review_path === "string"
              ? r.review_path
              : typeof r.path === "string"
                ? r.path
                : undefined,
          startedAtMs: parseTimestampMs(r.started_at_ms ?? r.started_at),
          updatedAtMs:
            rawUpdated !== undefined && rawUpdated !== null
              ? parseTimestampMs(rawUpdated)
              : undefined,
        };
      });
      return { runs };
    },
    "automations.overnight.start": async (params) => {
      // Rust `parse_overnight_command` expects `[duration, mission]` directly (no leading `"start"` token).
      const { data } = await requireRuntimeCmd("overnight", [
        params.duration,
        params.mission,
      ]);
      const r = asRecord(data.run ?? data);
      const run: OvernightRunView = {
        runId: String(r.run_id ?? r.runId ?? `ovn_${Date.now()}`),
        mission: String(r.mission ?? params.mission),
        status: "running",
        mode: typeof r.mode === "string" ? r.mode : "local",
        repo:
          typeof r.working_dir === "string"
            ? r.working_dir
            : params.workingDir,
        branch: typeof r.branch === "string" ? r.branch : undefined,
        agentCount:
          typeof r.agent_count === "number"
            ? r.agent_count
            : params.maxAgents ?? 4,
        durationLabel: String(r.duration_label ?? params.duration),
        taskCardCount:
          typeof r.task_card_count === "number" ? r.task_card_count : 0,
        validationsGreen:
          typeof r.validations_green === "number" ? r.validations_green : 0,
        reviewPath:
          typeof r.review_path === "string" ? r.review_path : undefined,
        startedAtMs: parseTimestampMs(r.started_at_ms ?? r.started_at),
      };
      return { run };
    },
    "automations.overnight.pause": async () => ({
      ok: false,
      message:
        "Pausing or resuming overnight runs is not supported by the runtime command.",
    }),
    "automations.overnight.runNow": async () => ({
      ok: false,
      message:
        "Triggering an overnight run immediately via run_now is not supported; use Start instead.",
    }),
    "automations.overnight.cancel": async () => {
      // Rust parse_overnight_command accepts 1-arg `["cancel"]` (no runId arg)
      const { message } = await requireRuntimeCmd("overnight", ["cancel"]);
      return { ok: true, message: message || "Cancellation requested." };
    },
    "automations.overnight.log": async (params) => {
      // Rust parse_overnight_command accepts 1-arg `["log"]` and returns `data.events`
      const data = await safeRuntimeCmd("overnight", ["log"]);
      const rawEvents = asArray(data.events ?? data.lines);
      const formatted = rawEvents.map((ev) => {
        if (typeof ev === "string") return ev;
        const obj = asRecord(ev);
        const ts = typeof obj.timestamp === "string" ? `[${obj.timestamp}] ` : "";
        const kind =
          typeof obj.kind === "string"
            ? `[${obj.kind}] `
            : typeof obj.event === "string"
              ? `[${obj.event}] `
              : "";
        const msg =
          typeof obj.message === "string"
            ? obj.message
            : typeof obj.summary === "string"
              ? obj.summary
              : JSON.stringify(obj);
        return `${ts}${kind}${msg}`.trim();
      });
      const maxLines = params.maxLines ?? 200;
      const lines =
        formatted.length > maxLines ? formatted.slice(-maxLines) : formatted;
      return {
        runId: typeof data.run_id === "string" ? data.run_id : params.runId,
        lines,
      };
    },
    "automations.overnight.report": async (params) => {
      // Rust parse_overnight_command accepts 1-arg `["review"]` and returns `{ run_id, html, path, tasks }` + markdown in `out.message`
      const out = await execRuntimeCmd("overnight", ["review"]);
      const data = out.data;
      const r = asRecord(data.run ?? data);
      const rawTasks = asArray(data.tasks ?? r.tasks);
      const tasks = rawTasks.map((t, idx) => {
        const item = asRecord(t);
        const validation = asRecord(item.validation);
        const evidence = asArray(validation.evidence ?? item.evidence).map(String);
        const validationResult =
          typeof validation.result === "string"
            ? validation.result
            : typeof item.validation_result === "string"
              ? item.validation_result
              : undefined;
        return {
          id: String(item.id ?? `task_${idx}`),
          title: String(item.title ?? ""),
          status: String(item.status ?? "completed"),
          outcome: typeof item.outcome === "string" ? item.outcome : undefined,
          validationResult,
          evidence,
          followups: asArray(item.followups).map(String),
        };
      });
      const greenCount = tasks.filter((t) =>
        ["pass", "passed", "green", "completed", "ok"].includes(
          String(t.validationResult ?? t.status).toLowerCase(),
        ),
      ).length;
      const run: OvernightRunView = {
        runId: typeof data.run_id === "string" ? data.run_id : params.runId,
        mission: String(r.mission ?? "Completed Overnight Run"),
        status: "completed",
        agentCount: typeof r.agent_count === "number" ? r.agent_count : 1,
        durationLabel: String(r.duration_label ?? r.duration ?? "4h"),
        taskCardCount:
          typeof r.task_card_count === "number" ? r.task_card_count : tasks.length,
        validationsGreen:
          typeof r.validations_green === "number" ? r.validations_green : greenCount,
        reviewPath:
          typeof data.path === "string"
            ? data.path
            : typeof r.review_path === "string"
              ? r.review_path
              : undefined,
        startedAtMs: parseTimestampMs(r.started_at_ms ?? r.started_at),
        tasks,
      };
      return {
        run,
        markdown:
          typeof data.markdown === "string"
            ? data.markdown
            : out.message || undefined,
        html: typeof data.html === "string" ? data.html : undefined,
      };
    },
    "automations.schedules.list": async () => {
      const { data } = await requireRuntimeCmd("schedules", ["list"]);
      const schedules: ScheduleItemView[] = asArray(data.schedules).map(
        (raw, idx) => {
          const s = asRecord(raw);
          return {
            id: String(s.id ?? `sched_${idx}`),
            title: String(
              s.title ?? s.task_description ?? s.context ?? "Scheduled Task",
            ),
            prompt: String(
              s.prompt ?? s.context ?? s.task_description ?? s.title ?? "",
            ),
            cronSummary: String(
              s.cron_summary ?? s.cronSummary ?? s.scheduled_for ?? "Scheduled",
            ),
            cronExpression:
              typeof s.cron_expression === "string"
                ? s.cron_expression
                : undefined,
            repo:
              typeof s.repo === "string"
                ? s.repo
                : typeof s.working_dir === "string"
                  ? s.working_dir
                  : undefined,
            description:
              typeof s.description === "string"
                ? s.description
                : typeof s.task_description === "string"
                  ? s.task_description
                  : undefined,
            permissionMode: fromHarnessPermissionMode(
              String(s.permission_mode ?? "default"),
            ),
            enabled: Boolean(s.enabled ?? true),
            queuedNow:
              typeof s.queued_now === "boolean" ? s.queued_now : undefined,
            nextRunAt:
              typeof s.next_run === "string"
                ? s.next_run
                : typeof s.scheduled_for === "string"
                  ? s.scheduled_for
                  : undefined,
            lastRunAt:
              typeof s.last_run === "string" ? s.last_run : undefined,
          };
        },
      );
      return { schedules };
    },
    "automations.schedules.create": async (params) => {
      const trimmedSched = params.schedule.trim();
      const minsMatch = /^(\d+)\s*m?$/i.exec(trimmedSched);
      const payload: Record<string, unknown> = {
        ...(params.title ? { title: params.title } : {}),
        prompt: params.prompt,
        task: params.prompt,
        schedule: trimmedSched,
        ...(minsMatch
          ? { wake_in_minutes: Number.parseInt(minsMatch[1]!, 10) }
          : {}),
        ...(params.permissionMode
          ? { permissionMode: params.permissionMode }
          : {}),
      };
      const { data } = await requireRuntimeCmd("schedules", [
        "create",
        JSON.stringify(payload),
      ]);
      const s = asRecord(data.schedule ?? data);
      const schedule: ScheduleItemView = {
        id: String(s.id ?? data.id ?? `sched_${Date.now()}`),
        title: String(
          s.title ?? params.title ?? params.prompt.slice(0, 60),
        ),
        prompt: String(s.prompt ?? s.context ?? params.prompt),
        cronSummary: String(s.cron_summary ?? s.scheduled_for ?? params.schedule),
        nextRunAt:
          typeof s.next_run === "string"
            ? s.next_run
            : typeof s.scheduled_for === "string"
              ? s.scheduled_for
              : undefined,
        permissionMode: fromHarnessPermissionMode(
          String(s.permission_mode ?? params.permissionMode ?? "default"),
        ),
        enabled: Boolean(s.enabled ?? true),
      };
      return { schedule };
    },
    "automations.schedules.toggle": async () => ({
      ok: false,
      message:
        "Toggling scheduled tasks is not supported by the runtime daemon; cancel and recreate instead.",
    }),
    "automations.schedules.runNow": async () => ({
      ok: false,
      message:
        "Triggering a scheduled task early via run_now is not supported by the runtime daemon.",
    }),
    "automations.schedules.cancel": async (params) => {
      const { data, message } = await requireRuntimeCmd("schedules", [
        "cancel",
        params.id,
      ]);
      return { ok: data.cancelled !== false, message: message || undefined };
    },
    "automations.ambient.status": async (): Promise<AmbientStatusView> => {
      const { data } = await requireRuntimeCmd("ambient", ["status"]);
      const stateObj = asRecord(data.state);
      const rawCycle = String(
        data.active_cycle ?? stateObj.status ?? stateObj.phase ?? "idle",
      ).toLowerCase();
      const currentCycleStatus: AmbientStatusView["currentCycleStatus"] =
        rawCycle === "running" || rawCycle === "active"
          ? "running"
          : rawCycle === "paused"
            ? "paused"
            : "idle";
      const nextWakeupRaw =
        data.next_wakeup ?? stateObj.next_wakeup ?? stateObj.next_wake_at;
      const approvals = mapAmbientApprovals(
        data.pending_approvals ?? data.approvals,
      );
      return {
        enabled: Boolean(data.enabled ?? false),
        currentCycleStatus,
        nextWakeupAt:
          typeof nextWakeupRaw === "string" ? nextWakeupRaw : undefined,
        recentCycles: asArray(data.recent_cycles ?? stateObj.recent_cycles).map(
          (raw, idx) => {
            const c = asRecord(raw);
            return {
              id: String(c.id ?? `cycle_${idx}`),
              summary: String(c.summary ?? ""),
              startedAtMs: parseTimestampMs(c.started_at_ms ?? c.started_at),
              status: String(c.status ?? "completed"),
            };
          },
        ),
        approvals,
      };
    },
    "automations.ambient.approvals": async () => {
      const data = await safeRuntimeCmd("ambient", ["approvals"]);
      return {
        approvals: mapAmbientApprovals(data.approvals ?? data.pending_approvals),
      };
    },
    "automations.ambient.decide": async (params) => {
      const { message } = await requireRuntimeCmd("ambient", [
        "decide",
        params.id,
        params.decision,
      ]);
      return { ok: true, message: message || undefined };
    },
    "automations.quality.status": async (): Promise<QualityStatusView> => {
      const [ar, aj] = await Promise.all([
        safeRuntimeCmd("autoreview", ["status"]),
        safeRuntimeCmd("autojudge", ["status"]),
      ]);
      return {
        autoReviewEnabled: Boolean(ar.enabled ?? false),
        autoReviewModel: typeof ar.model === "string" ? ar.model : undefined,
        autoJudgeEnabled: Boolean(aj.enabled ?? false),
        autoJudgeModel: typeof aj.model === "string" ? aj.model : undefined,
      };
    },
    "automations.quality.setAutoReview": async (params) => {
      await requireRuntimeCmd("autoreview", [params.enabled ? "on" : "off"]);
      return { ok: true, enabled: params.enabled };
    },
    "automations.quality.setAutoJudge": async (params) => {
      await requireRuntimeCmd("autojudge", [params.enabled ? "on" : "off"]);
      return { ok: true, enabled: params.enabled };
    },
    "automations.quality.runReview": async (params) => {
      const { data, message } = await requireRuntimeCmd(
        "review",
        [],
        params?.sessionId,
      );
      return {
        ok: true,
        sessionId:
          typeof data.session_id === "string" ? data.session_id : params?.sessionId,
        summary:
          typeof data.summary === "string"
            ? data.summary
            : message || "Review started.",
      };
    },
    "automations.quality.runJudge": async (params) => {
      const { data, message } = await requireRuntimeCmd(
        "judge",
        [],
        params?.sessionId,
      );
      return {
        ok: true,
        sessionId:
          typeof data.session_id === "string" ? data.session_id : params?.sessionId,
        summary:
          typeof data.summary === "string"
            ? data.summary
            : message || "Judge started.",
      };
    },
    "automations.quality.productivity": async (): Promise<ProductivityReportView> => {
      // Rust `productivity` accepts `[] | ["status"|"show"]` (no range arg!)
      const out = await execRuntimeCmd("productivity", []);
      const data = out.data;
      const imageObj = asRecord(data.image);
      const markdown =
        out.ok && out.message
          ? out.message
          : typeof data.markdown === "string"
            ? data.markdown
            : typeof data.report === "string"
              ? data.report
              : "### Productivity Summary\n\nNo productivity report data available.";
      return {
        markdown,
        chartBase64:
          typeof imageObj.base64 === "string"
            ? imageObj.base64
            : typeof data.chart_base64 === "string"
              ? data.chart_base64
              : undefined,
        chartPath:
          typeof data.png_path === "string"
            ? data.png_path
            : typeof data.chart_path === "string"
              ? data.chart_path
              : undefined,
        generatedAtMs: Date.now(),
      };
    },

    // -------------------------------------------------------------------------
    // 7. Plugins, MCP, Skills, Memory & Workspace Integrations
    // -------------------------------------------------------------------------
    "plugins.mcp.list": async () => {
      const { data } = await requireRuntimeCmd("mcp", ["list"]);
      const servers: McpServerView[] = asArray(data.servers).map((raw, idx) => {
        const s = asRecord(raw);
        const id = String(s.id ?? `mcp_${idx}`);
        const enabled =
          typeof s.enabled === "boolean"
            ? s.enabled
            : String(s.status ?? "").toLowerCase() !== "disabled";
        const connected =
          typeof s.connected === "boolean"
            ? s.connected
            : String(s.status ?? "").toLowerCase() === "connected";
        const rawStatus = String(s.status ?? "").toLowerCase();
        const cachedToolCount =
          typeof s.cached_tool_count === "number"
            ? s.cached_tool_count
            : typeof s.tool_count === "number"
              ? s.tool_count
              : undefined;
        let status: McpServerView["status"];
        if (!enabled || rawStatus === "disabled") {
          status = "disabled";
        } else if (rawStatus === "auth_needed" || s.auth_required === true) {
          status = "auth_needed";
        } else if (rawStatus === "error") {
          status = "error";
        } else if (connected || rawStatus === "connected") {
          status = "connected";
        } else if (rawStatus === "cached" || rawStatus === "disconnected") {
          status = "cached";
        } else {
          status = "cached";
        }

        const rawTransport = String(s.transport ?? "stdio").toLowerCase();
        const transport: McpServerView["transport"] =
          rawTransport === "sse"
            ? "sse"
            : rawTransport === "streamable-http" || rawTransport === "http"
              ? "streamable-http"
              : "stdio";

        const tools = Array.isArray(s.tools)
          ? s.tools.map((t) => {
              if (typeof t === "string") {
                return { name: t, fullName: `mcp__${id}__${t}` };
              }
              const tool = asRecord(t);
              return {
                name: String(tool.name ?? ""),
                fullName: String(tool.full_name ?? tool.name ?? ""),
                description:
                  typeof tool.description === "string"
                    ? tool.description
                    : undefined,
                tokenEstimate:
                  typeof tool.token_estimate === "number"
                    ? tool.token_estimate
                    : undefined,
              };
            })
          : Array.isArray(s.cached_tools)
            ? s.cached_tools.map((name) => ({
                name: String(name),
                fullName: `mcp__${id}__${String(name)}`,
              }))
            : [];

        return {
          id,
          name: String(s.name ?? id),
          brandId: typeof s.brand_id === "string" ? s.brand_id : undefined,
          status,
          enabled,
          transport,
          configLayer: String(s.layer ?? s.configLayer ?? "user"),
          configPath: typeof s.config_path === "string" ? s.config_path : undefined,
          shared: Boolean(s.shared ?? true),
          cachedToolCount,
          oauthRequired:
            typeof s.auth_required === "boolean" ? s.auth_required : undefined,
          oauthAuthenticated:
            typeof s.oauth_logged_in === "boolean"
              ? s.oauth_logged_in
              : undefined,
          command: typeof s.command === "string" ? s.command : undefined,
          args: Array.isArray(s.args) ? s.args.map(String) : undefined,
          url: typeof s.url === "string" ? s.url : undefined,
          timeoutSecs:
            typeof s.timeout_secs === "number" && s.timeout_secs > 0
              ? Math.round(s.timeout_secs)
              : undefined,
          error: typeof s.error === "string" ? s.error : undefined,
          tools,
        };
      });
      return {
        servers,
        totalTokenBudget:
          typeof data.total_token_budget === "number"
            ? data.total_token_budget
            : 25_000,
        usedTokenBudget:
          typeof data.used_token_budget === "number" ? data.used_token_budget : 0,
      };
    },
    "plugins.mcp.test": async (params) => {
      const startedAt = Date.now();
      const res = await execRuntimeCmd("mcp", ["test", params.id]);
      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: res.message,
        };
      }
      const testRes = asRecord(res.data.test_result ?? res.data);
      return {
        ok: Boolean(testRes.ok ?? true),
        toolCount:
          typeof testRes.tool_count === "number" ? testRes.tool_count : undefined,
        latencyMs:
          typeof testRes.latency_ms === "number"
            ? testRes.latency_ms
            : Date.now() - startedAt,
        error: typeof testRes.error === "string" ? testRes.error : undefined,
      };
    },
    "plugins.mcp.toggle": async (params) => {
      const { message } = await requireRuntimeCmd("mcp", [
        "toggle",
        params.id,
        params.enabled ? "on" : "off",
      ]);
      return { ok: true, message: message || undefined };
    },
    "plugins.mcp.reload": async () => {
      await requireRuntimeCmd("mcp", ["reload"]);
      const listed = await handlers["plugins.mcp.list"](undefined);
      return { ok: true, servers: listed.servers };
    },
    "plugins.mcp.add": async (params) => saveMcpServer(params, false),
    "plugins.mcp.edit": async (params) => saveMcpServer(params, true),
    "plugins.mcp.remove": async (params) => {
      const target = await mcpConfigPath(params.scope, params.workspacePath);
      const config = readMcpConfig(target);
      const servers = { ...asRecord(config.mcpServers) };
      if (!Object.hasOwn(servers, params.id)) {
        return { ok: false, saved: false, message: "Connector does not exist in this config." };
      }
      delete servers[params.id];
      writeMcpConfig(target, { ...config, mcpServers: servers });
      const reload = await execRuntimeCmd("mcp", ["reload"]);
      const reloadError = reload.ok ? undefined : (reload.message || "Engine MCP reload failed.");
      return {
        ok: true,
        saved: true,
        reloaded: reload.ok,
        ...(reloadError ? { reloadError } : {}),
        message: reload.ok ? "Connector removed and engine reloaded." : `Connector removed from config. Engine reload failed: ${reloadError}`,
      };
    },
    "plugins.mcp.login": async () => ({
      ok: false,
      message:
        "MCP OAuth login via runtime_command is not supported yet; run `rayu mcp login` in the terminal.",
    }),
    "plugins.mcp.logout": async () => ({
      ok: false,
      message:
        "MCP OAuth logout via runtime_command is not supported yet; run `rayu mcp logout` in the terminal.",
    }),
    "plugins.mcp.oauth": async (params) => {
      if (params.action === "status") {
        const listed = await handlers["plugins.mcp.list"](undefined);
        const server = listed.servers.find((s) => s.id === params.id);
        return {
          ok: true,
          authenticated: Boolean(server?.oauthAuthenticated),
        };
      }
      return {
        ok: false,
        authenticated: false,
        message: `MCP OAuth '${params.action}' via runtime_command is not supported yet.`,
      };
    },
    "plugins.skills.list": async () => {
      // Rust `skills` accepts `[] | ["status"]` (rejects `["list"]`)
      const { data } = await requireRuntimeCmd("skills", []);
      const mapSkill = (raw: unknown, defaultScope: SkillView["scope"]): SkillView => {
        const s = asRecord(raw);
        return {
          name: String(s.name ?? "skill"),
          description: String(s.description ?? ""),
          path: String(s.path ?? ""),
          scope: (
            ["global", "project", "endorsed"].includes(String(s.scope))
              ? String(s.scope)
              : defaultScope
          ) as SkillView["scope"],
          allowedTools: Array.isArray(s.allowed_tools)
            ? s.allowed_tools.map(String)
            : undefined,
          activeInSession:
            typeof s.active === "boolean" ? s.active : undefined,
          installed: Boolean(s.installed ?? true),
          category: typeof s.category === "string" ? s.category : undefined,
        };
      };
      return {
        skills: asArray(data.skills).map((s) => mapSkill(s, "project")),
        endorsed: asArray(data.endorsed).map((s) => mapSkill(s, "endorsed")),
      };
    },
    "plugins.skills.create": async (params) => {
      const rawName = params.name.trim();
      if (/[/\\]/.test(rawName) || rawName.includes("..")) {
        throw new HarnessError(
          "invalid_request",
          "Skill name cannot contain path separators or '..'.",
        );
      }
      const slug = rawName
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug || !/[a-z0-9]/.test(slug)) {
        throw new HarnessError(
          "invalid_request",
          "Skill name must contain letters or numbers.",
        );
      }
      const scope = params.scope === "global" ? "global" : "project";
      const rayuHome =
        process.env.RAYU_HOME?.trim() || path.join(os.homedir(), ".rayu");
      const baseDir =
        scope === "global"
          ? path.join(rayuHome, "skills")
          : path.join(await workspaceRootFor(params.workspacePath), ".agents", "skills");
      const skillDir = path.join(baseDir, slug);
      const skillFile = path.join(skillDir, "SKILL.md");
      const cleanDescription = params.description.trim();
      const body =
        params.content?.trim() ||
        `# ${rawName}\n\nDescribe step-by-step instructions and verification rules for this skill.\n`;
      const markdown = `---\nname: ${slug}\ndescription: ${JSON.stringify(cleanDescription)}\n---\n\n${body}\n`;
      fs.mkdirSync(skillDir, { recursive: true });
      try {
        fs.writeFileSync(skillFile, markdown, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new HarnessError("invalid_request", "A skill with this name already exists in this scope.");
        }
        throw error;
      }
      const reload = await execRuntimeCmd("skills", []);
      const reloadError = reload.ok ? undefined : (reload.message || "Could not refresh engine skills list.");
      return {
        ok: true,
        saved: true,
        reloaded: reload.ok,
        ...(reloadError ? { reloadError } : {}),
        skill: {
          name: slug,
          description: cleanDescription,
          path: skillFile,
          scope,
          installed: true,
        },
      };
    },
    "plugins.skills.install": async () => ({
      ok: false,
    }),
    "plugins.skills.reload": async () => {
      const listed = await handlers["plugins.skills.list"](undefined);
      return { ok: true, skills: listed.skills };
    },
    "plugins.skills.run": async () => ({
      ok: false,
      message:
        "Running skills via runtime_command is not supported yet; invoke the skill from chat.",
    }),
    "plugins.memory.status": async (): Promise<MemoryStatusView> => {
      const { data } = await requireRuntimeCmd("memory", ["status"]);
      const facts: MemoryFactView[] = asArray(data.facts).map((raw, idx) => {
        const f = asRecord(raw);
        return {
          id: String(f.id ?? `mem_${idx}`),
          content: String(f.content ?? ""),
          scope: f.scope === "global" ? "global" : "project",
          tags: asArray(f.tags).map(String),
          confidence:
            typeof f.confidence === "number" ? f.confidence : undefined,
          updatedAtMs: parseTimestampMs(f.updated_at_ms ?? f.updated_at),
          relatedIds: Array.isArray(f.related_ids)
            ? f.related_ids.map(String)
            : undefined,
        };
      });
      return {
        enabled: Boolean(data.enabled ?? true),
        persistInjections: Boolean(data.persist_injections ?? true),
        pipelineActive: Boolean(data.pipeline_active ?? false),
        totalCount:
          typeof data.total_count === "number" ? data.total_count : facts.length,
        facts,
      };
    },
    "plugins.memory.toggle": async (params) => {
      await requireRuntimeCmd("memory", [params.enabled ? "on" : "off"]);
      return { ok: true, enabled: params.enabled };
    },
    "plugins.memory.extract": async (params) => {
      const { data } = await requireRuntimeCmd(
        "memory",
        ["extract"],
        params?.sessionId,
      );
      return {
        ok: true,
        extractedCount:
          typeof data.extracted_count === "number" ? data.extracted_count : 0,
      };
    },
    "plugins.memory.remember": async () => {
      throw new HarnessError(
        "invalid_request",
        "Saving memory facts via runtime_command is not supported yet.",
      );
    },
    "plugins.memory.recall": async (params) => {
      const status = await handlers["plugins.memory.status"](undefined);
      let facts = status.facts;
      if (params?.scope && params.scope !== "all") {
        facts = facts.filter((f) => f.scope === params.scope);
      }
      if (params?.tag) {
        facts = facts.filter((f) => f.tags.includes(params.tag!));
      }
      if (params?.query) {
        const q = params.query.toLowerCase();
        facts = facts.filter((f) => f.content.toLowerCase().includes(q));
      }
      return { facts };
    },
    "plugins.memory.search": async (params) =>
      handlers["plugins.memory.recall"](params),
    "plugins.memory.forget": async () => ({
      ok: false,
      message: "Deleting memory facts via runtime_command is not supported yet.",
    }),
    "plugins.memory.tag": async () => ({
      ok: false,
      message: "Tagging memory facts via runtime_command is not supported yet.",
    }),
    "plugins.memory.link": async () => ({
      ok: false,
      message: "Linking memory facts via runtime_command is not supported yet.",
    }),
    "plugins.workspace.status": async (): Promise<WorkspaceIntegrationsView> => ({
      available: false,
      gmail: {
        connected: false,
        actionCount: 0,
      },
      calendar: {
        connected: false,
        calendarCount: 0,
        actionCount: 0,
      },
      browser: {
        detectedBrowsers: [],
        handoffActive: false,
        actionCount: 0,
      },
      companion: {
        running: false,
        keepAwake: false,
      },
    }),
    "plugins.workspace.trigger": async (params) => ({
      ok: false,
      message: `Workspace integration action '${params.integration}:${params.action}' is not exposed via runtime_command.`,
    }),

    // -------------------------------------------------------------------------
    // 8. Changes & PR Guardrail
    // -------------------------------------------------------------------------
    "changes.status": async (params) => {
      const sessionId = params?.sessionId ?? deps.sessionHub.getActiveSessionId();
      const gitStatus = await deps.gitBridge.getStatus({
        sessionId,
        scope: params?.scope,
      });

      if (!sessionId) {
        return gitStatus;
      }

      const snapshot = await resolveEngineSnapshot(sessionId);
      if (!snapshot || snapshot.files.length === 0) {
        return gitStatus;
      }

      const gitByPath = new Map<string, ChangedFileView>();
      for (const gf of gitStatus.files) {
        gitByPath.set(gf.path, gf);
      }

      const toChangedStatus = (kind: FileChangeKind): ChangedFileStatus => {
        if (kind === "created") return "added";
        if (kind === "deleted") return "deleted";
        if (kind === "renamed") return "renamed";
        return "modified";
      };

      const toReviewDecision = (status: FileChangeStatus): FileReviewDecision => {
        if (status === "kept") return "accepted";
        if (status === "undone") return "rejected";
        return "pending";
      };

      if (params?.scope === "session") {
        const files: ChangedFileView[] = snapshot.files.map((entry) => {
          const matchedGit =
            gitByPath.get(entry.displayPath) ?? gitByPath.get(entry.path);
          return {
            path: entry.displayPath,
            status: toChangedStatus(entry.kind),
            staged: matchedGit?.staged ?? false,
            additions: entry.additions,
            deletions: entry.deletions,
            ownerBadge: matchedGit?.ownerBadge ?? "agent",
            decision: toReviewDecision(entry.status),
            fromSession: true,
            ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
          };
        });
        return {
          ...gitStatus,
          files,
          totalAdditions: files.reduce((acc, f) => acc + f.additions, 0),
          totalDeletions: files.reduce((acc, f) => acc + f.deletions, 0),
          stagedCount: files.filter((f) => f.staged).length,
        };
      }

      const seen = new Set<string>();
      const mergedFiles = gitStatus.files.map((gf) => {
        const matched = snapshot.files.find(
          (entry) => entry.displayPath === gf.path || entry.path === gf.path,
        );
        if (!matched) return gf;
        seen.add(matched.path);
        return {
          ...gf,
          fromSession: true,
          decision: toReviewDecision(matched.status),
        };
      });

      for (const entry of snapshot.files) {
        if (seen.has(entry.path)) continue;
        mergedFiles.push({
          path: entry.displayPath,
          status: toChangedStatus(entry.kind),
          staged: false,
          additions: entry.additions,
          deletions: entry.deletions,
          ownerBadge: "agent",
          decision: toReviewDecision(entry.status),
          fromSession: true,
          ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
        });
      }

      return {
        ...gitStatus,
        files: mergedFiles,
        totalAdditions: mergedFiles.reduce((acc, f) => acc + f.additions, 0),
        totalDeletions: mergedFiles.reduce((acc, f) => acc + f.deletions, 0),
        stagedCount: mergedFiles.filter((f) => f.staged).length,
      };
    },
    "changes.getSessionSummary": async (params) => {
      const sessionId = params?.sessionId ?? deps.sessionHub.getActiveSessionId();
      if (!sessionId) {
        return emptyFileChangesSnapshot("");
      }

      const engineSnapshot = await resolveEngineSnapshot(sessionId);
      if (engineSnapshot) {
        return engineSnapshot;
      }

      const fallbackStatus = await deps.gitBridge
        .getStatus({ sessionId, scope: "session" })
        .catch(() => null);
      if (!fallbackStatus) {
        return emptyFileChangesSnapshot(sessionId);
      }

      const sessionFiles = fallbackStatus.files.filter((f) => f.fromSession);
      const mappedFiles: FileChangeEntryView[] = sessionFiles.map((f) => ({
        path: f.path,
        displayPath: f.path,
        ...(f.oldPath ? { oldPath: f.oldPath } : {}),
        kind:
          f.status === "added" || f.status === "untracked"
            ? "created"
            : f.status === "deleted"
              ? "deleted"
              : f.status === "renamed"
                ? "renamed"
                : "modified",
        status:
          f.decision === "accepted"
            ? "kept"
            : f.decision === "rejected"
              ? "undone"
              : "pending",
        additions: f.additions,
        deletions: f.deletions,
        changedInLatestTurn: true,
        turnId: 1,
        editCount: 1,
        isBinary: false,
        undoable: false,
        canRedo: false,
        previewHunks: [],
        previewTruncated: false,
        updatedAtMs: Date.now(),
      }));

      return {
        sessionId,
        latestTurnId: mappedFiles.length > 0 ? 1 : 0,
        totalPendingFiles: mappedFiles.filter((f) => f.status === "pending").length,
        totalAdditions: mappedFiles.reduce((acc, f) => acc + f.additions, 0),
        totalDeletions: mappedFiles.reduce((acc, f) => acc + f.deletions, 0),
        files: mappedFiles,
      };
    },
    "changes.diff": async (params) => {
      const sessionId = params.sessionId;
      if (params.scope === "session" && sessionId) {
        const engineDiff = await tryEngineFileChangeDiff(sessionId, params.path);
        if (engineDiff) {
          return engineDiff;
        }
      }
      try {
        const workingDir = sessionId
          ? (deps.sessionHub.getSessionWorkingDirForSession?.(sessionId) ??
            deps.sessionHub.getSessionWorkingDir?.(sessionId))
          : undefined;
        if (
          sessionId &&
          (deps.sessionHub.getSessionWorkingDirForSession ||
            deps.sessionHub.getSessionWorkingDir) &&
          !workingDir
        ) {
          throw new HarnessError("invalid_request", "Could not resolve the session worktree for this diff.");
        }
        const gitDiff = await deps.gitBridge.getDiff({
          path: params.path,
          workingDir: workingDir || undefined,
          sessionId,
          scope: params.scope,
        });
        if (
          sessionId &&
          !gitDiff.unifiedDiff.trim() &&
          !gitDiff.originalContent &&
          !gitDiff.modifiedContent
        ) {
          const engineDiff = await tryEngineFileChangeDiff(sessionId, params.path);
          if (engineDiff) {
            return engineDiff;
          }
        }
        return gitDiff;
      } catch (err) {
        if (sessionId) {
          const engineDiff = await tryEngineFileChangeDiff(sessionId, params.path);
          if (engineDiff) {
            return engineDiff;
          }
        }
        throw err;
      }
    },
    "changes.stage": async (params) => deps.gitBridge.stage(params.paths),
    "changes.unstage": async (params) => deps.gitBridge.unstage(params.paths),
    "changes.keep": async (params) =>
      runReviewAction(params.sessionId, "keep", { path: params.path }),
    "changes.undo": async (params) =>
      runReviewAction(params.sessionId, "undo", params),
    "changes.redo": async (params) =>
      runReviewAction(params.sessionId, "redo", params),
    "changes.keepAll": async (params) =>
      runReviewAction(params?.sessionId, "keep_all"),
    "changes.undoAll": async (params) =>
      runReviewAction(params?.sessionId, "undo_all", params),
    "changes.redoAll": async (params) =>
      runReviewAction(params?.sessionId, "redo_all", params),
    "changes.commit": async (params) => deps.gitBridge.commit(params.message),
    "changes.createPr": async (params) => deps.gitBridge.createPr(params),

    // -------------------------------------------------------------------------
    // 9. Remote (Telegram, Cloud, SSH, WS Gateway)
    // -------------------------------------------------------------------------
    "remote.telegram.status": async (): Promise<TelegramStatusView> => {
      const daemonOnline = deps.bridgeManager.getStatus().state === "connected";
      if (!daemonOnline) {
        pendingTelegramPairing = null;
        return {
          linked: false,
          configured: false,
          statusLabel: "Daemon offline",
          daemonOnline: false,
          remoteUninstallEnabled: false,
          authPath: "~/.rayu/telegram-remote.json",
          daemonError: "Start the local Rayu daemon to manage Telegram remote.",
          approvals: [],
        };
      }
      const [statusRes, approvalsRes] = await Promise.all([
        execRuntimeCmd("telegram", ["status"]),
        execRuntimeCmd("telegram", ["approvals"]),
      ]);
      const data = statusRes.data;
      const approvalsData = approvalsRes.data;
      if (!statusRes.ok) {
        return {
          linked: false,
          configured: false,
          statusLabel: "Unavailable",
          daemonOnline,
          remoteUninstallEnabled: false,
          authPath: "~/.rayu/telegram-remote.json",
          daemonError:
            statusRes.message ||
            "Could not query Telegram remote status from the Rust daemon.",
          approvals: [],
        };
      }
      const approvals = mapTelegramApprovals(
        approvalsData.approvals ?? data.approvals,
      );
      const linked = Boolean(data.linked ?? data.connected ?? false);
      const configured = Boolean(data.configured ?? linked);
      const expired = Boolean(data.expired ?? false);
      const generation =
        typeof data.generation === "string" ? data.generation : undefined;

      if (
        linked ||
        !configured ||
        expired ||
        (pendingTelegramPairing?.generation &&
          generation &&
          pendingTelegramPairing.generation !== generation)
      ) {
        pendingTelegramPairing = null;
      }

      const activePairing = pendingTelegramPairing;
      const chatIdRaw = data.owner_chat_id ?? data.chat_id;
      const pendingUntilRaw = data.pending_until;
      const rawUsername =
        typeof data.username === "string"
          ? data.username
          : typeof data.bot_handle === "string"
            ? data.bot_handle
            : activePairing?.username;
      const cleanHandle = rawUsername?.trim().replace(/^@+/, "");
      const mode: "hosted" | "botfather" | undefined =
        data.mode === "hosted" || data.mode === "botfather"
          ? data.mode
          : activePairing?.mode;

      return {
        linked,
        configured,
        statusLabel:
          typeof data.status === "string"
            ? data.status
            : linked
              ? "Linked"
              : "Disconnected",
        generation,
        expired,
        activeAccount:
          typeof data.active_account === "boolean"
            ? data.active_account
            : undefined,
        mode,
        botHandle: cleanHandle ? `@${cleanHandle}` : undefined,
        chatId:
          chatIdRaw !== undefined && chatIdRaw !== null
            ? String(chatIdRaw)
            : undefined,
        boundSessionId:
          typeof data.selected_session === "string" &&
          data.selected_session.trim().length > 0
            ? data.selected_session.trim()
            : undefined,
        authPath:
          typeof data.auth_path === "string" && data.auth_path.trim().length > 0
            ? data.auth_path.trim()
            : "~/.rayu/telegram-remote.json",
        daemonOnline: true,
        remoteUninstallEnabled: Boolean(data.uninstall_enabled ?? false),
        pairingUrl:
          typeof data.pairing_url === "string"
            ? data.pairing_url
            : activePairing?.pairingUrl,
        pairingCode:
          typeof data.pairing_code === "string"
            ? data.pairing_code
            : activePairing?.pairingCode,
        pairingExpiresAtMs:
          pendingUntilRaw !== undefined && pendingUntilRaw !== null
            ? parseTimestampMs(pendingUntilRaw)
            : activePairing?.pairingExpiresAtMs ??
              (typeof data.ttl_secs === "number"
                ? Date.now() + data.ttl_secs * 1000
                : undefined),
        qrSize:
          typeof data.qr_size === "number"
            ? data.qr_size
            : activePairing?.qrSize ?? null,
        qrPath:
          typeof data.qr_path === "string"
            ? data.qr_path
            : activePairing?.qrPath ?? null,
        daemonError: null,
        approvals,
      };
    },
    "remote.telegram.linkHosted": async (params) => {
      const args = params?.replaceExisting
        ? ["link_hosted", "replace"]
        : ["link_hosted"];
      const { data } = await requireRuntimeCmd("telegram", args);
      const pairingUrl =
        typeof data.pairing_url === "string" ? data.pairing_url : "";
      const pairingCode =
        typeof data.pairing_code === "string" ? data.pairing_code : undefined;
      const username =
        typeof data.username === "string" ? data.username : undefined;
      const qrSize = typeof data.qr_size === "number" ? data.qr_size : null;
      const qrPath = typeof data.qr_path === "string" ? data.qr_path : null;
      const pairingExpiresAtMs =
        data.pending_until !== undefined && data.pending_until !== null
          ? parseTimestampMs(data.pending_until)
          : undefined;
      if (pairingUrl) {
        pendingTelegramPairing = {
          generation:
            typeof data.generation === "string" ? data.generation : null,
          mode: "hosted",
          username,
          pairingUrl,
          pairingCode,
          qrSize,
          qrPath,
          pairingExpiresAtMs,
        };
      }
      const status = await handlers["remote.telegram.status"](undefined);
      return {
        ...status,
        mode: "hosted",
        botHandle: username
          ? `@${username.replace(/^@+/, "")}`
          : status.botHandle,
        pairingUrl: pairingUrl || status.pairingUrl,
        pairingCode: pairingCode ?? status.pairingCode,
        qrSize: qrSize ?? status.qrSize,
        qrPath: qrPath ?? status.qrPath,
        pairingExpiresAtMs: pairingExpiresAtMs ?? status.pairingExpiresAtMs,
      };
    },
    "remote.telegram.linkBotfather": async (params) => {
      const args = ["link_botfather", params.botToken.trim()];
      if (params.allowedChatId?.trim()) {
        args.push(params.allowedChatId.trim());
      }
      if (params.replaceExisting) {
        args.push("replace");
      }
      const { data } = await requireRuntimeCmd("telegram", args);
      const linked = Boolean(data.linked);
      const pairingUrl =
        typeof data.pairing_url === "string" ? data.pairing_url : "";
      const pairingCode =
        typeof data.pairing_code === "string" ? data.pairing_code : undefined;
      const username =
        typeof data.username === "string" ? data.username : undefined;
      const qrSize = typeof data.qr_size === "number" ? data.qr_size : null;
      const qrPath = typeof data.qr_path === "string" ? data.qr_path : null;
      const pairingExpiresAtMs =
        data.pending_until !== undefined && data.pending_until !== null
          ? parseTimestampMs(data.pending_until)
          : undefined;
      if (!linked && pairingUrl) {
        pendingTelegramPairing = {
          generation:
            typeof data.generation === "string" ? data.generation : null,
          mode: "botfather",
          username,
          pairingUrl,
          pairingCode,
          qrSize,
          qrPath,
          pairingExpiresAtMs,
        };
      } else {
        pendingTelegramPairing = null;
      }
      const status = await handlers["remote.telegram.status"](undefined);
      return {
        ...status,
        linked: linked || status.linked,
        mode: "botfather",
        botHandle: username
          ? `@${username.replace(/^@+/, "")}`
          : status.botHandle,
        pairingUrl: pairingUrl || status.pairingUrl,
        pairingCode: pairingCode ?? status.pairingCode,
        qrSize: qrSize ?? status.qrSize,
        qrPath: qrPath ?? status.qrPath,
        pairingExpiresAtMs: pairingExpiresAtMs ?? status.pairingExpiresAtMs,
      };
    },
    "remote.telegram.disconnect": async (params) => {
      const args = params?.localOnly
        ? ["disconnect", "local_only"]
        : ["disconnect"];
      const { message } = await requireRuntimeCmd("telegram", args);
      pendingTelegramPairing = null;
      return { ok: true, message: message || undefined };
    },
    "remote.telegram.testPing": async () => {
      const { data, message } = await requireRuntimeCmd("telegram", ["ping"]);
      const rawUser =
        typeof data.username === "string" ? data.username.trim() : "";
      return {
        ok: data.ok !== false,
        target: rawUser ? `@${rawUser.replace(/^@+/, "")}` : undefined,
        chatId:
          data.chat_id !== undefined && data.chat_id !== null
            ? String(data.chat_id)
            : undefined,
        message: message || undefined,
      };
    },
    "remote.telegram.driveSession": async (params) => {
      const { message } = await requireRuntimeCmd("telegram", [
        "select_session",
        params.sessionId.trim(),
      ]);
      return { ok: true, message: message || undefined };
    },
    "remote.telegram.uninstallToggle": async (params) => {
      const { data } = await requireRuntimeCmd("telegram", [
        "uninstall",
        params.enabled ? "enable" : "disable",
      ]);
      return {
        ok: true,
        enabled:
          typeof data.enabled === "boolean" ? data.enabled : params.enabled,
      };
    },
    "remote.telegram.approvals": async () => {
      const data = await safeRuntimeCmd("telegram", ["approvals"]);
      return { approvals: mapTelegramApprovals(data.approvals) };
    },
    "remote.telegram.decide": async (params) => {
      const { message } = await requireRuntimeCmd("telegram", [
        "decide",
        params.id,
        params.decision,
      ]);
      return { ok: true, message: message || undefined };
    },
    "remote.infra.status": async (): Promise<RemoteInfraStatusView> => {
      const data = await safeRuntimeCmd("remote", ["status"]);
      const gw = asRecord(data.gateway ?? data);
      const gateway: GatewayStatusView = {
        enabled: Boolean(gw.enabled ?? false),
        bindAddr: typeof gw.bind_addr === "string" ? gw.bind_addr : "127.0.0.1",
        port: typeof gw.port === "number" ? gw.port : 7643,
        dialAddress:
          typeof gw.dial_address === "string"
            ? gw.dial_address
            : "ws://127.0.0.1:7643",
        restartRequired:
          typeof gw.restart_required === "boolean"
            ? gw.restart_required
            : undefined,
        devices: asArray(gw.devices).map((d, idx) => {
          const dev = asRecord(d);
          const rawLastSeen = dev.last_seen_at_ms ?? dev.last_seen;
          return {
            id: String(dev.id ?? `dev_${idx}`),
            name: String(dev.name ?? `Mobile Device ${idx + 1}`),
            pairedAtMs: parseTimestampMs(dev.paired_at_ms ?? dev.paired_at),
            lastSeenAtMs:
              rawLastSeen !== undefined && rawLastSeen !== null
                ? parseTimestampMs(rawLastSeen)
                : undefined,
          };
        }),
      };
      return {
        gateway,
        sessions: asArray(data.sessions).map((s, idx) => {
          const sess = asRecord(s);
          return {
            id: String(sess.id ?? `rem_${idx}`),
            kind: sess.kind === "ssh" ? "ssh" : "cloud",
            label: String(sess.label ?? `Remote Session ${idx + 1}`),
            host: typeof sess.host === "string" ? sess.host : undefined,
            status: (
              ["running", "idle", "stopped"].includes(String(sess.status))
                ? String(sess.status)
                : "idle"
            ) as "running" | "idle" | "stopped",
            workingDir:
              typeof sess.working_dir === "string" ? sess.working_dir : undefined,
          };
        }),
        cloudConfigured: Boolean(data.cloud_configured ?? false),
        sshHosts: asArray(data.ssh_hosts).map(String),
      };
    },
    "remote.gateway.toggle": async (params) => {
      // Rust `remote` expects `"on"` / `"off"` (NOT `"enable"` / `"disable"`)
      const { data } = await requireRuntimeCmd("remote", [
        params.enabled ? "on" : "off",
      ]);
      const infra = await handlers["remote.infra.status"](undefined);
      return {
        ...infra.gateway,
        enabled:
          typeof data.enabled === "boolean" ? data.enabled : params.enabled,
        restartRequired:
          typeof data.restart_required === "boolean"
            ? data.restart_required
            : infra.gateway.restartRequired,
      };
    },
    "remote.gateway.pair": async () => {
      const { data } = await requireRuntimeCmd("remote", ["pair"]);
      const infra = await handlers["remote.infra.status"](undefined);
      const code = String(data.code ?? "");
      const dialAddress = String(
        data.dial_address ?? infra.gateway.dialAddress ?? "ws://127.0.0.1:7643",
      );
      const uri = String(
        data.uri ?? `rayu://pair?addr=${encodeURIComponent(dialAddress)}&code=${code}`,
      );
      const expiresInSecs =
        typeof data.expires_in_seconds === "number"
          ? data.expires_in_seconds
          : 300;
      return {
        ...infra.gateway,
        pairingQr: {
          uri,
          code,
          dialAddress,
          expiresAtMs: Date.now() + expiresInSecs * 1000,
        },
      };
    },
    "remote.gateway.revoke": async (params) => {
      const { message } = await requireRuntimeCmd("remote", [
        "revoke",
        params.deviceId,
      ]);
      return { ok: true, message: message || undefined };
    },
    "remote.cloud.moveToCloud": async () => ({
      ok: false,
      message: "Moving sessions to Rayu Cloud via runtime_command is not supported yet.",
    }),
    "remote.cloud.returnLocal": async () => ({
      ok: false,
      message: "Returning cloud sessions to local via runtime_command is not supported yet.",
    }),
    "remote.cloud.attach": async () => ({
      ok: false,
      message: "Attaching cloud sessions via runtime_command is not supported yet.",
    }),
    "remote.cloud.syncEnv": async () => ({
      ok: false,
      message: "Cloud environment sync via runtime_command is not supported yet.",
    }),

    // -------------------------------------------------------------------------
    // 10. Settings
    // -------------------------------------------------------------------------
    "settings.account.get": async (): Promise<AccountStatusView> => {
      if (deps.authManager) {
        return deps.authManager.getAccountStatus(false);
      }

      const data = await safeRuntimeCmd("subscription", ["status"]);
      const credits = asRecord(data.credits);
      const user = asRecord(data.user);
      const signedIn = Boolean(
        data.configured ?? data.signed_in ?? data.signedIn ?? false,
      );
      const planCode =
        typeof credits.plan === "string" ? credits.plan : undefined;
      const planName =
        typeof credits.plan_name === "string"
          ? credits.plan_name
          : typeof credits.plan === "string"
            ? credits.plan
            : typeof data.plan_name === "string"
              ? data.plan_name
              : undefined;
      const creditsPerPeriod =
        typeof credits.credits_per_period === "number"
          ? credits.credits_per_period
          : undefined;
      const usedCredits =
        typeof credits.used_credits === "number"
          ? credits.used_credits
          : undefined;
      const creditsRemaining =
        typeof credits.remaining_credits === "number"
          ? credits.remaining_credits
          : typeof data.credits_remaining === "number"
            ? data.credits_remaining
            : undefined;
      const topUpBalance =
        typeof credits.topup_balance === "number"
          ? credits.topup_balance
          : typeof data.top_up_balance === "number"
            ? data.top_up_balance
            : undefined;
      const topUpEnabled =
        typeof credits.top_up_enabled === "boolean"
          ? credits.top_up_enabled
          : undefined;
      const resetSeconds =
        typeof credits.reset_seconds === "number"
          ? credits.reset_seconds
          : undefined;
      const periodEnd =
        typeof credits.period_end === "string" ? credits.period_end : undefined;

      const windows: AccountStatusView["windows"] = [];
      const creditsPer5h =
        typeof credits.credits_per_5h === "number"
          ? credits.credits_per_5h
          : undefined;
      const windowUsed =
        typeof credits.window_used_credits === "number"
          ? credits.window_used_credits
          : 0;
      const windowResetSecs =
        typeof credits.window_reset_seconds === "number"
          ? credits.window_reset_seconds
          : undefined;
      if (creditsPer5h !== undefined && creditsPer5h > 0) {
        const usedPct = Math.min(
          100,
          Math.max(0, Math.round((windowUsed / creditsPer5h) * 100)),
        );
        windows.push({
          label: "5h session window",
          remainingPercent: Math.max(0, 100 - usedPct),
          usedPercent: usedPct,
          resetCountdown:
            windowResetSecs !== undefined && windowResetSecs > 0
              ? formatCountdown(windowResetSecs)
              : undefined,
        });
      }

      const creditsPerWeek =
        typeof credits.credits_per_week === "number"
          ? credits.credits_per_week
          : undefined;
      const weekUsed =
        typeof credits.week_used_credits === "number"
          ? credits.week_used_credits
          : 0;
      const weekResetSecs =
        typeof credits.week_reset_seconds === "number"
          ? credits.week_reset_seconds
          : undefined;
      if (creditsPerWeek !== undefined && creditsPerWeek > 0) {
        const usedPct = Math.min(
          100,
          Math.max(0, Math.round((weekUsed / creditsPerWeek) * 100)),
        );
        windows.push({
          label: "Weekly limit",
          remainingPercent: Math.max(0, 100 - usedPct),
          usedPercent: usedPct,
          resetCountdown:
            weekResetSecs !== undefined && weekResetSecs > 0
              ? formatCountdown(weekResetSecs)
              : undefined,
        });
      }

      if (creditsPerPeriod !== undefined && creditsPerPeriod > 0) {
        const usedPct = Math.min(
          100,
          Math.max(
            0,
            Math.round(((usedCredits ?? 0) / creditsPerPeriod) * 100),
          ),
        );
        const remPct = Math.min(100, Math.max(0, 100 - usedPct));
        windows.push({
          label: "Period credits",
          remainingPercent: remPct,
          usedPercent: usedPct,
          resetsAt: periodEnd,
          resetCountdown:
            resetSeconds !== undefined ? formatCountdown(resetSeconds) : undefined,
        });
      }

      const rawAuthMethod =
        typeof data.auth_method === "string" ? data.auth_method : undefined;
      const authMethod: AccountStatusView["authMethod"] =
        rawAuthMethod === "oauth"
          ? "oauth"
          : rawAuthMethod === "api_key" || rawAuthMethod === "apiKey"
            ? "apiKey"
            : signedIn
              ? "oauth"
              : "none";

      return {
        signedIn,
        authMethod,
        signingIn: false,
        pendingAuthUrl: null,
        pendingMode: null,
        webBase: getRayuWebBase(),
        error: null,
        displayName:
          typeof user.display_name === "string"
            ? user.display_name
            : typeof data.display_name === "string"
              ? data.display_name
              : undefined,
        email:
          typeof user.email === "string"
            ? user.email
            : typeof data.email === "string"
              ? data.email
              : undefined,
        avatarUrl:
          typeof user.avatar_url === "string" ? user.avatar_url : undefined,
        planName,
        creditsRemaining,
        creditsPerPeriod,
        usedCredits,
        topUpBalance,
        topUpEnabled,
        resetSeconds,
        periodEnd,
        bypassPacing: deps.getGlobalState<boolean>(
          "rayucode.account.bypassPacing",
          false,
        ),
        windows,
        planLadder: buildRayuPlanLadder(signedIn, planCode, planName),
      };
    },
    "settings.account.refresh": async () => {
      if (deps.authManager) {
        return deps.authManager.getAccountStatus(true);
      }
      return handlers["settings.account.get"](undefined);
    },
    "settings.account.signInBrowser": async (params) => {
      if (deps.authManager) {
        const res = await deps.authManager.startBrowserSignIn(
          params?.mode ?? "vscode",
        );
        await deps.editorBridge.openExternal(res.authUrl);
        return {
          ok: res.ok,
          authUrl: res.authUrl,
          state: res.state,
        };
      }
      const fallbackState = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
      const authUrl = buildVscodeLoginUrl(getRayuWebBase(), fallbackState);
      await deps.editorBridge.openExternal(authUrl);
      const state = await handlers["settings.account.get"](undefined);
      return {
        ok: true,
        authUrl,
        state,
      };
    },
    "settings.account.cancelSignIn": async () => {
      if (deps.authManager) {
        return deps.authManager.cancelSignIn();
      }
      return handlers["settings.account.get"](undefined);
    },
    "settings.account.signInApiKey": async (params) => {
      if (deps.authManager) {
        return deps.authManager.signInWithApiKey(params.apiKey);
      }
      const client = await deps.sessionHub.getClient();
      await client.setApiKey("rayu", params.apiKey);
      await deps.sessionHub.notifyDaemonAuthChanged?.("rayu").catch(() => {});
      return handlers["settings.account.get"](undefined);
    },
    "settings.account.completeCallback": async (params) => {
      if (deps.authManager) {
        return deps.authManager.completeManualCallback(params.callbackUrl);
      }
      throw new HarnessError(
        "internal",
        "Host authentication manager is not configured for callback redemption.",
      );
    },
    "settings.account.signOut": async () => {
      if (deps.authManager) {
        return deps.authManager.signOut();
      }
      await requireRuntimeCmd("logout", ["rayu", "confirm"]);
      await deps.sessionHub.notifyDaemonAuthChanged?.("rayu").catch(() => {});
      return handlers["settings.account.get"](undefined);
    },
    "settings.account.setBypassPacing": async (params) => {
      if (deps.authManager) {
        return deps.authManager.setBypassPacing(params.enabled);
      }
      await deps.updateGlobalState("rayucode.account.bypassPacing", params.enabled);
      return { ok: true, enabled: params.enabled };
    },
    "settings.analytics.get": async (params): Promise<AnalyticsSummaryView> => ({
      available: false,
      range: params.range,
      groupBy: params.groupBy,
      totalCredits: 0,
      breakdown: [],
      topSessions: [],
    }),
    "settings.providers.list": async () => {
      const data = await safeRuntimeCmd("auth", ["status"]);
      // Rust `auth status` returns `data.providers` as an ARRAY of `{ id, display_name, state, readiness, credential_source, refresh_support }`
      const remoteById = new Map<string, Record<string, unknown>>();
      if (Array.isArray(data.providers)) {
        for (const item of data.providers) {
          const rec = asRecord(item);
          const rawId = typeof rec.id === "string" ? rec.id.trim() : "";
          if (!rawId) continue;
          const uiId = normalizeUiProviderId(rawId);
          remoteById.set(uiId, rec);
        }
      } else {
        for (const [k, v] of Object.entries(asRecord(data.providers))) {
          remoteById.set(normalizeUiProviderId(k), asRecord(v));
        }
      }

      const mapRemoteStatus = (
        remote: Record<string, unknown>,
        fallback: ProviderEntryView["status"],
      ): ProviderEntryView["status"] => {
        const state = String(remote.state ?? remote.readiness ?? "").toLowerCase();
        const credSrc = String(remote.credential_source ?? "").toLowerCase();
        if (
          remote.configured === true ||
          remote.ready === true ||
          state === "ready" ||
          state === "configured" ||
          state === "authenticated" ||
          state === "ok"
        ) {
          return credSrc.includes("env") ? "env_key" : "ready";
        }
        if (state === "expired" || state === "needs_refresh") {
          return "expired";
        }
        if (
          state === "missing" ||
          state === "unconfigured" ||
          state === "needs_key" ||
          state === "logged_out"
        ) {
          return "needs_key";
        }
        return fallback;
      };

      const mapAuthMethod = (
        remote: Record<string, unknown>,
        fallback: ProviderEntryView["authMethod"],
      ): ProviderEntryView["authMethod"] => {
        const src = String(remote.credential_source ?? "").toLowerCase();
        if (src.includes("oauth")) return "oauth";
        if (src.includes("env")) return "env";
        if (src.includes("key") || src.includes("api")) return "api_key";
        return fallback;
      };

      const hostAccount = deps.authManager?.getAccountStatusSnapshot();
      const seen = new Set<string>();
      const providers: ProviderEntryView[] = DEFAULT_PROVIDERS.map((p) => {
        const uiId = normalizeUiProviderId(p.id);
        seen.add(uiId);

        if (uiId === "rayu" && hostAccount) {
          return {
            ...p,
            status: hostAccount.signedIn ? "ready" : "needs_key",
            authMethod:
              hostAccount.authMethod === "apiKey" ? "api_key" : "oauth",
            accountLabel: hostAccount.signedIn
              ? hostAccount.email ??
                hostAccount.displayName ??
                (hostAccount.authMethod === "apiKey"
                  ? "Rayu API Key"
                  : "Signed in")
              : undefined,
          };
        }

        const remote = remoteById.get(uiId);
        if (!remote) return p;
        return {
          ...p,
          name:
            typeof remote.display_name === "string" && remote.display_name
              ? remote.display_name
              : p.name,
          status: mapRemoteStatus(remote, p.status),
          authMethod: mapAuthMethod(remote, p.authMethod),
          accountLabel:
            typeof remote.account_label === "string"
              ? remote.account_label
              : typeof remote.credential_source === "string" &&
                  remote.credential_source
                ? remote.credential_source
                : p.accountLabel,
        };
      });

      for (const [id, remote] of remoteById.entries()) {
        if (seen.has(id)) continue;
        providers.push({
          id,
          name:
            typeof remote.display_name === "string" && remote.display_name
              ? remote.display_name
              : id,
          category: "openai_compatible",
          status: mapRemoteStatus(remote, "needs_key"),
          authMethod: mapAuthMethod(remote, "api_key"),
          accountLabel:
            typeof remote.credential_source === "string"
              ? remote.credential_source
              : undefined,
        });
      }

      return { providers };
    },
    "settings.providers.setApiKey": async (params) => {
      const normalized = normalizeCredentialProviderId(params.providerId);
      if (normalized === "rayu" && deps.authManager) {
        await deps.authManager.signInWithApiKey(params.apiKey);
        return { ok: true };
      }
      // Transmit straight to Rust daemon — never write secrets to VS Code storage
      const client = await deps.sessionHub.getClient();
      await client.setApiKey(normalized, params.apiKey);
      if (deps.sessionHub.notifyDaemonAuthChanged) {
        await deps.sessionHub.notifyDaemonAuthChanged(normalized).catch(() => {});
      } else {
        await client.notifyAuthChanged?.(normalized).catch(() => {});
      }
      return { ok: true };
    },
    "settings.providers.clearApiKey": async (params) => {
      const normalized = normalizeCredentialProviderId(params.providerId);
      if (normalized === "rayu" && deps.authManager) {
        await deps.authManager.clearSavedApiKeyOnly();
        return { ok: true };
      }
      const client = await deps.sessionHub.getClient();
      await client.clearApiKey(normalized);
      if (deps.sessionHub.notifyDaemonAuthChanged) {
        await deps.sessionHub.notifyDaemonAuthChanged(normalized).catch(() => {});
      } else {
        await client.notifyAuthChanged?.(normalized).catch(() => {});
      }
      return { ok: true };
    },
    "settings.providers.logout": async (params) => {
      const normalized = normalizeLogoutProviderId(params.providerId);
      if (normalized === "rayu" && deps.authManager) {
        await deps.authManager.signOut();
        return { ok: true, message: "Signed out of Rayu." };
      }
      const { message } = await requireRuntimeCmd("logout", [
        normalized,
        "confirm",
      ]);
      await deps.sessionHub
        .notifyDaemonAuthChanged?.(normalizeCredentialProviderId(normalized))
        .catch(() => {});
      return { ok: true, message: message || undefined };
    },
    "settings.doctor.run": async (params) => {
      const data = await safeRuntimeCmd("doctor", [params.scope]);
      const rawChecks = asArray(data.checks);
      const checks: DoctorCheckView[] =
        rawChecks.length > 0
          ? rawChecks.map((raw, idx) => {
              const c = asRecord(raw);
              const rawStatus = String(c.status ?? "pass").toLowerCase();
              return {
                id: String(c.id ?? `chk_${idx}`),
                scope: params.scope,
                label: String(c.label ?? c.name ?? "Diagnostic Check"),
                status:
                  rawStatus === "fail"
                    ? "fail"
                    : rawStatus === "warn"
                      ? "warn"
                      : "pass",
                detail: String(c.detail ?? "OK"),
              };
            })
          : [
              {
                id: `${params.scope}-bridge`,
                scope: params.scope,
                label: "Harness API Bridge Connectivity",
                status:
                  deps.bridgeManager.getStatus().state === "connected"
                    ? "pass"
                    : "warn",
                detail:
                  deps.bridgeManager.getStatus().state === "connected"
                    ? "Connected to Harness API v1.14 socket."
                    : "Bridge is currently offline.",
              },
            ];
      return { checks, ranAtMs: Date.now() };
    },
    "settings.models.get": async (params) => {
      let targetSessionId =
        params?.sessionId ?? deps.sessionHub.getActiveSessionId();
      if (!targetSessionId) {
        targetSessionId = await deps.sessionHub
          .getClient()
          .then((c) =>
            typeof c.listSessions === "function"
              ? c.listSessions({ limit: 1 })
              : [],
          )
          .then((sessions) => sessions[0]?.session_id)
          .catch(() => undefined);
      }

      const hostAccount = deps.authManager?.getAccountStatusSnapshot();
      const [data, subagentData, runtimeInfo, rayuHostedModels] =
        await Promise.all([
          safeRuntimeCmd("agents", ["status"], targetSessionId),
          safeRuntimeCmd("subagent_model", ["status"], targetSessionId),
          targetSessionId
            ? getSessionClient(targetSessionId)
                .then((c) =>
                  typeof c.getRuntimeInfo === "function"
                    ? c.getRuntimeInfo(targetSessionId)
                    : null,
                )
                .catch(() => null)
            : Promise.resolve(null),
          hostAccount?.signedIn && deps.authManager?.fetchHostedModels
            ? deps.authManager.fetchHostedModels(false).catch(() => [])
            : Promise.resolve([]),
        ]);

      const roles: Array<{ role: AgentRoleId; label: string }> = [
        { role: "swarm", label: "Swarm Workers" },
        { role: "review", label: "Code Review" },
        { role: "judge", label: "Acceptance Judge" },
        { role: "memory", label: "Memory Extraction" },
        { role: "ambient", label: "Ambient Cycles" },
      ];
      const overridesObj = asRecord(data.overrides);
      const defaultsObj = asRecord(data.defaults);
      const effectiveObj = asRecord(data.effective);
      const roleOverrides: AgentRoleOverrideView[] = roles.map((r) => {
        const sessionOverride = overridesObj[r.role];
        const globalDefault = defaultsObj[r.role];
        if (typeof sessionOverride === "string" && sessionOverride.trim()) {
          return {
            role: r.role,
            label: r.label,
            model: sessionOverride,
            scope: "session",
          };
        }
        return {
          role: r.role,
          label: r.label,
          model:
            typeof globalDefault === "string" && globalDefault.trim()
              ? globalDefault
              : "inherit",
          scope: "global",
        };
      });

      const effectiveRoleModels: Record<string, string | null> = {};
      for (const r of roles) {
        const eff = effectiveObj[r.role];
        effectiveRoleModels[r.role] =
          typeof eff === "string" && eff.trim() ? eff.trim() : null;
      }

      const mapProfileList = (
        raw: unknown,
        fallbackScope: "global" | "session",
      ): AgentProfileView[] => {
        const out: AgentProfileView[] = [];
        for (const item of asArray(raw)) {
          const rec = asRecord(item);
          const name = typeof rec.name === "string" ? rec.name.trim() : "";
          const model = typeof rec.model === "string" ? rec.model.trim() : "";
          if (!name || !model) continue;
          const scope: "global" | "session" =
            rec.scope === "global" || rec.scope === "session"
              ? rec.scope
              : fallbackScope;
          out.push({
            name,
            model,
            description:
              typeof rec.description === "string" ? rec.description.trim() : "",
            effort:
              typeof rec.effort === "string" && rec.effort.trim()
                ? rec.effort.trim()
                : null,
            scope,
          });
        }
        return out;
      };

      const globalProfiles = mapProfileList(data.global_profiles, "global");
      const sessionProfiles = mapProfileList(data.session_profiles, "session");
      const mergedProfiles = mapProfileList(data.profiles, "global");
      const profiles =
        mergedProfiles.length > 0
          ? mergedProfiles
          : [
              ...globalProfiles.filter(
                (gp) =>
                  !sessionProfiles.some(
                    (sp) => sp.name.toLowerCase() === gp.name.toLowerCase(),
                  ),
              ),
              ...sessionProfiles,
            ];

      const sessionScopedPrefs = params?.sessionId
        ? deps.sessionHub.getSessionPrefs?.(params.sessionId)
        : undefined;

      const { routes, defaultModel } = reconcileAuthConsistentRoutes({
        rawRoutes: runtimeInfo?.routes,
        hostAccount,
        rayuHostedModels,
        runtimeModel: sessionScopedPrefs?.model ?? runtimeInfo?.model,
        runtimeProvider: sessionScopedPrefs?.provider ?? runtimeInfo?.provider,
        fallbackActiveModel:
          sessionScopedPrefs?.model ?? deps.sessionHub.getActiveModel(),
      });

      const subagentModel =
        typeof subagentData.model === "string" && subagentData.model.trim()
          ? subagentData.model.trim()
          : typeof data.subagent_model === "string" && data.subagent_model.trim()
            ? data.subagent_model.trim()
            : null;
      const inheritModel =
        typeof subagentData.inherit_model === "string" &&
        subagentData.inherit_model.trim()
          ? subagentData.inherit_model.trim()
          : typeof data.inherit_model === "string" && data.inherit_model.trim()
            ? data.inherit_model.trim()
            : defaultModel ?? null;

      return {
        defaultModel,
        defaultEffort:
          sessionScopedPrefs?.effort ??
          deps.getGlobalState<EffortChoice>(
            "rayucode.settings.defaultEffort",
            "medium",
          ),
        serviceTier:
          sessionScopedPrefs?.serviceTier ??
          deps.getGlobalState<ServiceTier>(
            "rayucode.settings.serviceTier",
            "auto",
          ),
        cacheTtl: deps.getGlobalState<CacheTtl>("rayucode.settings.cacheTtl", "5m"),
        transport: deps.getGlobalState<ProviderTransport>(
          "rayucode.settings.transport",
          "auto",
        ),
        subagentModel,
        inheritModel,
        roleOverrides,
        effectiveRoleModels,
        profiles,
        globalProfiles,
        sessionProfiles,
        swarmAllowlist: Array.isArray(data.swarm_allowlist)
          ? data.swarm_allowlist.map(String)
          : undefined,
        configPath:
          typeof data.config_path === "string" && data.config_path.trim()
            ? data.config_path.trim()
            : "~/.rayu/config.toml",
        ...(routes.length > 0 || runtimeInfo?.routes !== undefined
          ? { routes }
          : {}),
      };
    },
    "settings.models.refresh": async (params) => {
      const hostAccount = deps.authManager?.getAccountStatusSnapshot();
      const daemonConnected = deps.bridgeManager.getStatus().state === "connected";

      const [hostedRefresh, daemonRefresh] = await Promise.all([
        hostAccount?.signedIn && deps.authManager?.getHostedModelCatalog
          ? deps.authManager.getHostedModelCatalog(true).catch(() => ({ models: [], status: "failed" as const }))
          : Promise.resolve({ models: [], status: "unavailable" as const }),
        daemonConnected
          ? execRuntimeCmd("refresh_model_list", [], params?.sessionId)
          : Promise.resolve({ ok: false, data: {} as Record<string, unknown>, message: "" }),
      ]);

      const rayuHostedModels = hostedRefresh.models;
      const rawRoutes = asArray(daemonRefresh.data.routes);
      const { routes } = reconcileAuthConsistentRoutes({
        rawRoutes,
        hostAccount,
        rayuHostedModels,
      });
      const routeCount =
        routes.length > 0
          ? routes.length
          : typeof daemonRefresh.data.route_count === "number"
            ? daemonRefresh.data.route_count
            : 0;
      return {
        ok: daemonRefresh.ok || hostedRefresh.status === "fresh",
        message: hostedRefresh.status === "stale"
          ? "Hosted catalogs could not refresh. Keeping last known models."
          : !daemonRefresh.ok && hostedRefresh.status !== "fresh"
            ? daemonRefresh.message || "Model catalogs could not refresh."
            : undefined,
        sources: {
          engine: daemonConnected ? (daemonRefresh.ok ? "fresh" : "failed") : "unavailable",
          hosted: hostedRefresh.status,
        },
        routeCount,
        routes,
      };
    },
    "settings.models.setFast": async (params) => {
      const wireArg = params.tier === "auto" ? "off" : params.tier;
      await requireRuntimeCmd("fast", [wireArg], params.sessionId);
      if (params.sessionId) {
        await deps.sessionHub.saveSessionPrefs?.(params.sessionId, { serviceTier: params.tier });
      }
      await deps.updateGlobalState("rayucode.settings.serviceTier", params.tier);
      return { ok: true, tier: params.tier };
    },
    "settings.models.setCacheTtl": async (params) => {
      await requireRuntimeCmd("cache", [params.ttl], params.sessionId);
      await deps.updateGlobalState("rayucode.settings.cacheTtl", params.ttl);
      return { ok: true, ttl: params.ttl };
    },
    "settings.models.setTransport": async (params) => {
      await requireRuntimeCmd("transport", [params.transport]);
      await deps.updateGlobalState("rayucode.settings.transport", params.transport);
      return { ok: true, transport: params.transport };
    },
    "settings.models.setRoleOverride": async (params) => {
      // Rust `agents` expects `[role, model]` or `["global", role, model]` (never `["set", ...]`)
      const args =
        params.scope === "global"
          ? ["global", params.role, params.model]
          : [params.role, params.model];
      const { message } = await requireRuntimeCmd(
        "agents",
        args,
        params.sessionId,
      );
      return { ok: true, message: message || undefined };
    },
    "settings.agents.setSubagentModel": async (params) => {
      const args =
        params.scope === "global"
          ? ["global", params.model.trim()]
          : [params.model.trim()];
      const { data, message } = await requireRuntimeCmd(
        "subagent_model",
        args,
        params.sessionId,
      );
      return {
        ok: true,
        model: typeof data.model === "string" ? data.model : null,
        configuredDefault:
          typeof data.configured_default === "string"
            ? data.configured_default
            : null,
        message: message || undefined,
      };
    },
    "settings.agents.upsertProfile": async (params) => {
      const args: string[] = [];
      if (params.scope === "global") {
        args.push("global");
      }
      args.push("profile", "add", params.name.trim(), params.model.trim());
      const effort = params.effort?.trim();
      if (effort && effort !== "auto" && effort !== "none") {
        args.push("--effort", effort);
      }
      const description = params.description?.trim();
      if (description) {
        args.push(description);
      }
      const { data, message } = await requireRuntimeCmd(
        "agents",
        args,
        params.sessionId,
      );
      const profiles: AgentProfileView[] = [];
      for (const item of asArray(data.profiles)) {
        const rec = asRecord(item);
        const name = typeof rec.name === "string" ? rec.name.trim() : "";
        const model = typeof rec.model === "string" ? rec.model.trim() : "";
        if (!name || !model) continue;
        profiles.push({
          name,
          model,
          description:
            typeof rec.description === "string" ? rec.description.trim() : "",
          effort:
            typeof rec.effort === "string" && rec.effort.trim()
              ? rec.effort.trim()
              : null,
          scope:
            rec.scope === "session" || rec.scope === "global"
              ? rec.scope
              : params.scope,
        });
      }
      return { ok: true, profiles, message: message || undefined };
    },
    "settings.agents.deleteProfile": async (params) => {
      const args =
        params.scope === "global"
          ? ["global", "profile", "rm", params.name.trim()]
          : ["profile", "rm", params.name.trim()];
      const { data, message } = await requireRuntimeCmd(
        "agents",
        args,
        params.sessionId,
      );
      const profiles: AgentProfileView[] = [];
      for (const item of asArray(data.profiles)) {
        const rec = asRecord(item);
        const name = typeof rec.name === "string" ? rec.name.trim() : "";
        const model = typeof rec.model === "string" ? rec.model.trim() : "";
        if (!name || !model) continue;
        profiles.push({
          name,
          model,
          description:
            typeof rec.description === "string" ? rec.description.trim() : "",
          effort:
            typeof rec.effort === "string" && rec.effort.trim()
              ? rec.effort.trim()
              : null,
          scope:
            rec.scope === "session" || rec.scope === "global"
              ? rec.scope
              : "global",
        });
      }
      return { ok: true, profiles, message: message || undefined };
    },
    "settings.features.get": async () => {
      const data = await safeRuntimeCmd("features", ["status"]);
      const features = extractFeatureFlags(data);
      const voice = deps.getGlobalState<VoiceStatusView>(
        "rayucode.settings.voice",
        DEFAULT_VOICE_STATUS,
      );
      const telemetry = deps.getGlobalState<TelemetryConfigView>(
        "rayucode.settings.telemetry",
        DEFAULT_TELEMETRY_CONFIG,
      );
      return { features, voice, telemetry };
    },
    "settings.features.set": async (params) => {
      const { data } = await requireRuntimeCmd("features", [
        "set",
        params.key,
        String(params.value),
      ]);
      const base = extractFeatureFlags(data);
      const updated: FeatureFlagsView = {
        ...base,
        [params.key]: params.value,
      };
      await deps.updateGlobalState("rayucode.settings.features", updated);
      return { ok: true, features: updated };
    },
    "settings.voice.update": async (params) => {
      const current = deps.getGlobalState<VoiceStatusView>(
        "rayucode.settings.voice",
        DEFAULT_VOICE_STATUS,
      );
      const next: VoiceStatusView = {
        ...current,
        ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
        ...(params.deviceId !== undefined ? { deviceId: params.deviceId } : {}),
        ...(params.noiseSuppression !== undefined
          ? { noiseSuppression: params.noiseSuppression }
          : {}),
        ...(params.autoSendOnSilence !== undefined
          ? { autoSendOnSilence: params.autoSendOnSilence }
          : {}),
      };
      await deps.updateGlobalState("rayucode.settings.voice", next);
      return next;
    },
    "settings.telemetry.set": async (params) => {
      const current = deps.getGlobalState<TelemetryConfigView>(
        "rayucode.settings.telemetry",
        DEFAULT_TELEMETRY_CONFIG,
      );
      let next: TelemetryConfigView;
      let args: string[];
      if (params.category === "all") {
        next = {
          ...current,
          content: true,
          usage: true,
          crashes: true,
          features: true,
          cost: true,
          accounts: true,
        };
        args = ["all"];
      } else if (params.category === "none") {
        next = {
          ...current,
          content: false,
          usage: false,
          crashes: false,
          features: false,
          cost: false,
          accounts: false,
        };
        args = ["none"];
      } else {
        const nextEnabled = params.enabled ?? !current[params.category];
        next = {
          ...current,
          [params.category]: nextEnabled,
        };
        args = [params.category, nextEnabled ? "on" : "off"];
      }
      await requireRuntimeCmd("telemetry", args);
      await deps.updateGlobalState("rayucode.settings.telemetry", next);
      return next;
    },
    "settings.hooks.list": async () => {
      const configPath = path.join(os.homedir(), ".rayu", "config.toml");
      const doctorData = await safeRuntimeCmd("doctor", ["status"]);
      const remoteHooks = asArray(doctorData.hooks).map(asRecord);
      const configuredMap = new Map<string, boolean>();
      for (const h of remoteHooks) {
        if (typeof h.name === "string") {
          configuredMap.set(h.name, Boolean(h.configured));
        }
      }

      let rawToml = "";
      if (configuredMap.size === 0) {
        try {
          rawToml = fs.readFileSync(configPath, "utf8");
        } catch {
          rawToml = "";
        }
      }

      const hooks: HookEntryView[] = HOOK_EVENTS.map((h) => ({
        event: h.event,
        label: h.label,
        mode: h.mode,
        configured: configuredMap.has(h.event)
          ? Boolean(configuredMap.get(h.event))
          : rawToml.includes(h.event),
      }));
      return { hooks, configPath };
    },
    "settings.hooks.openConfig": async () => {
      const configPath = path.join(os.homedir(), ".rayu", "config.toml");
      await deps.editorBridge.openFile({ path: configPath, preview: false });
      return { ok: true };
    },
    "settings.permission.getDefault": async () => ({
      mode: deps.sessionHub.getDefaultPermissionMode
        ? deps.sessionHub.getDefaultPermissionMode()
        : deps.sessionHub.getActivePermissionMode(),
    }),
    "settings.permission.setDefault": async (params) => {
      if (deps.sessionHub.setDefaultPermissionMode) {
        return deps.sessionHub.setDefaultPermissionMode(params.mode, {
          applyToActiveSession: params.applyToActiveSession,
        });
      }
      const activeSid = deps.sessionHub.getActiveSessionId();
      if (params.applyToActiveSession && activeSid) {
        return deps.sessionHub.setPermissionMode(activeSid, params.mode);
      }
      return { ok: true, mode: params.mode };
    },
    "settings.shortcuts.list": async () => ({
      shortcuts: DEFAULT_SHORTCUTS,
    }),
    "settings.shortcuts.openKeybindings": async () => {
      await deps.openKeybindings();
      return { ok: true };
    },
    "settings.runtime.get": async () => {
      const rt = deps.getRuntimeSettings();
      return {
        ...rt,
        transport: deps.getGlobalState<ProviderTransport>(
          "rayucode.settings.transport",
          "auto",
        ),
      };
    },
    "settings.runtime.update": async (params) => {
      await deps.updateRuntimeSettings(params);
      return { ok: true };
    },
    "settings.feedback.submit": async () => ({
      ok: false,
      message: "Feedback submission via runtime_command is not supported yet.",
    }),

    // -------------------------------------------------------------------------
    // 11. Inspector (SidePanel, Applet, Todos)
    // -------------------------------------------------------------------------
    "inspector.sidePanel.get": async (params) =>
      deps.sessionHub.getSidePanelState(params.sessionId),
    "inspector.sidePanel.close": async (params) => {
      deps.sessionHub.closeSidePanelPage(params.sessionId, params.pageId);
      return { ok: true };
    },
    "inspector.applet.get": async (params) => ({
      applets: deps.sessionHub.getApplets(params.sessionId),
    }),
    "inspector.applet.action": async (params) => {
      const client = await getSessionClient(params.sessionId);
      await client.appletAction(
        params.sessionId,
        params.appletId,
        { action: params.action, args: params.payload },
        params.payload ?? {},
      );
      const applet = deps.sessionHub
        .getApplets(params.sessionId)
        .find((a) => a.appletId === params.appletId);
      return { ok: true, applet };
    },
    "inspector.applet.close": async (params) => {
      const client = await getSessionClient(params.sessionId);
      await client.closeApplet(params.sessionId, params.appletId);
      return { ok: true };
    },
    "capabilities.get": async (params) => {
      try {
        const client = await deps.sessionHub.getClient(params?.sessionId);
        if (typeof client.getCapabilities !== "function") {
          return {
            supported: false,
            commands: [],
            permission_modes: [],
            features: [],
          };
        }
        const caps = await client.getCapabilities(
          params?.sessionId ?? deps.sessionHub.getActiveSessionId(),
        );
        if (!caps) {
          return {
            supported: false,
            commands: [],
            permission_modes: [],
            features: [],
          };
        }
        return {
          supported: true,
          commands: caps.commands ?? [],
          permission_modes: caps.permission_modes ?? [],
          features: caps.features ?? [],
        };
      } catch (error) {
        if (
          error instanceof HarnessError &&
          (error.code === "unsupported" || error.code === "unknown_request")
        ) {
          return {
            supported: false,
            commands: [],
            permission_modes: [],
            features: [],
          };
        }
        throw error;
      }
    },
    "config.get": async (params) => {
      try {
        const client = await deps.sessionHub.getClient();
        if (typeof client.getConfig !== "function") {
          return { supported: false, config: null };
        }
        const config = await client.getConfig(params?.sections);
        if (!config) {
          return { supported: false, config: null };
        }
        return { supported: true, config };
      } catch (error) {
        if (
          error instanceof HarnessError &&
          (error.code === "unsupported" || error.code === "unknown_request")
        ) {
          return { supported: false, config: null };
        }
        throw error;
      }
    },
    "config.patch": async (params) => {
      try {
        const client = await deps.sessionHub.getClient();
        if (typeof client.patchConfig !== "function") {
          return {
            ok: false,
            code: "unsupported",
            message: "This Rayu daemon does not support config_v1.",
          };
        }
        const config = await client.patchConfig(params.patch);
        const patchedKeys = new Set(Object.keys(params.patch));
        const requiresRestart = (config.schema ?? []).some(
          (field) =>
            patchedKeys.has(field.key) &&
            field.apply_mode === "restart_required",
        );
        return {
          ok: true,
          config,
          requiresRestart,
        };
      } catch (error) {
        if (
          error instanceof HarnessError &&
          (error.code === "invalid_request" ||
            error.code === "unsupported" ||
            error.code === "busy")
        ) {
          return {
            ok: false,
            code: error.code,
            message: error.message,
          };
        }
        throw error;
      }
    },
    "sessions.setModel": async (params) => {
      if (typeof deps.sessionHub.setSessionModel === "function") {
        return deps.sessionHub.setSessionModel(params.sessionId, params.model, {
          provider: params.provider,
          apiMethod: params.apiMethod,
          applyNextTurn: params.applyNextTurn,
        });
      }
      try {
        const client = await getSessionClient(params.sessionId);
        const modelSpec = formatHarnessModelSpec(
          params.model,
          params.provider,
          params.apiMethod,
        );
        await client.setModel(params.sessionId, modelSpec || params.model);
        return { ok: true };
      } catch (error) {
        if (error instanceof HarnessError && error.code === "busy") {
          return {
            ok: false,
            deferred: true,
            code: "busy",
            message: error.message || "Applies on next turn",
          };
        }
        throw error;
      }
    },
    "sessions.setEffort": async (params) => {
      if (typeof deps.sessionHub.setSessionEffort === "function") {
        return deps.sessionHub.setSessionEffort(params.sessionId, params.effort, {
          applyNextTurn: params.applyNextTurn,
        });
      }
      try {
        const client = await getSessionClient(params.sessionId);
        await client.setReasoningEffort(params.sessionId, params.effort);
        return { ok: true };
      } catch (error) {
        if (error instanceof HarnessError && error.code === "busy") {
          return {
            ok: false,
            deferred: true,
            code: "busy",
            message: error.message || "Applies on next turn",
          };
        }
        throw error;
      }
    },
    "sessions.runtimeCommand": async (params) => {
      try {
        const out = await deps.sessionHub.runtimeCommand(
          params.command as RuntimeCommand,
          params.args ?? [],
          params.sessionId ?? deps.sessionHub.getActiveSessionId(),
        );
        return {
          ok: true,
          command: String(out.command ?? params.command),
          message: out.message,
          data: out.data,
        };
      } catch (error) {
        if (
          error instanceof HarnessError &&
          (error.code === "busy" ||
            error.code === "unsupported" ||
            error.code === "invalid_request")
        ) {
          return {
            ok: false,
            command: params.command,
            code: error.code,
            message: error.message,
          };
        }
        throw error;
      }
    },
    "inspector.todos.get": async (params) => {
      try {
        const client = await getSessionClient(params.sessionId);
        const snap = await client.todoState(params.sessionId);
        const todos: TodoItemView[] = normalizeTodoItems(snap);
        deps.sessionHub.setCachedTodos?.(params.sessionId, todos);
        return { todos };
      } catch {
        return { todos: deps.sessionHub.getCachedTodos(params.sessionId) };
      }
    },
  };

  return {
    async call<M extends RpcMethod>(
      method: M,
      params: RpcParams<M>,
    ): Promise<RpcResult<M>> {
      const parsedParams = parseRpcParams(method, params);
      if (!parsedParams.success) {
        throw new HarnessError("invalid_request", parsedParams.error.message);
      }
      const handler = handlers[method];
      const rawResult = await handler(parsedParams.data as RpcParams<M>);
      const parsedResult = RpcContractSchemas[method].result.parse(rawResult);
      return parsedResult as RpcResult<M>;
    },

    async dispatch(
      id: number,
      method: string,
      rawParams: unknown,
    ): Promise<Extract<HostToWebviewMessage, { type: "rayucode.rpc.result" }>> {
      if (!(RPC_METHODS as readonly string[]).includes(method)) {
        return {
          type: "rayucode.rpc.result",
          id,
          ok: false,
          code: "VALIDATION_ERROR",
          error: `Unknown RPC method: ${method}`,
        };
      }

      const rpcMethod = method as RpcMethod;
      const parsedParams = parseRpcParams(rpcMethod, rawParams);
      if (!parsedParams.success) {
        return {
          type: "rayucode.rpc.result",
          id,
          ok: false,
          code: "VALIDATION_ERROR",
          error: parsedParams.error.message,
        };
      }

      try {
        const handler = handlers[rpcMethod];
        const rawData = await handler(parsedParams.data as never);
        const parsedResult = RpcContractSchemas[rpcMethod].result.safeParse(rawData);
        if (!parsedResult.success) {
          return {
            type: "rayucode.rpc.result",
            id,
            ok: false,
            code: "INTERNAL_ERROR",
            error: `RPC result schema violation for ${rpcMethod}: ${parsedResult.error.message}`,
          };
        }
        return {
          type: "rayucode.rpc.result",
          id,
          ok: true,
          data: parsedResult.data,
        };
      } catch (error) {
        const code =
          error instanceof HarnessError
            ? error.code === "connect_failed" || error.code === "disconnected"
              ? "BRIDGE_OFFLINE"
              : error.code === "unknown_session"
                ? "SESSION_NOT_FOUND"
                : error.code === "invalid_request"
                  ? "VALIDATION_ERROR"
                  : error.code === "busy"
                    ? "BUSY"
                    : error.code === "unsupported"
                      ? "UNSUPPORTED"
                      : error.code === "timeout"
                        ? "TIMEOUT"
                        : "INTERNAL_ERROR"
            : "INTERNAL_ERROR";
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          type: "rayucode.rpc.result",
          id,
          ok: false,
          code,
          error: message,
        };
      }
    },
  };
}
