/**
 * Wire types for the RayuCode harness API (protocol v1).
 *
 * Mirrors the shared surface of `crates/rayucode-harness-api`. Request tags live under `req`,
 * event tags under `ev`, and every frame carries `v`. Keep this file in sync
 * with the Rust enums; `test/schema-parity.test.ts` fails the build if the
 * tag sets drift apart.
 */

export const API_VERSION_MAJOR = 1;
export const API_VERSION_MINOR = 16;

export const CAPABILITIES_CAPABILITY = "capabilities_v1";
export const CONFIG_CAPABILITY = "config_v1";
export const FRAME_FIDELITY_CAPABILITY = "frame_fidelity_v1";

export type CommandCategory =
  | "session"
  | "model"
  | "quality"
  | "tools"
  | "runtime";

export type CommandDispatch =
  | { kind: "api_request"; req: string }
  | { kind: "runtime_command"; command: string }
  | { kind: "skill"; name: string };

export interface CommandDescriptor {
  name: string;
  description: string;
  category: CommandCategory;
  arg_hint?: string;
  requires_session?: boolean;
  dispatch: CommandDispatch;
}

export interface PermissionModeDescriptor {
  id: string;
  label: string;
  description: string;
  is_default?: boolean;
}

export interface FeatureFlagDescriptor {
  key: string;
  enabled: boolean;
  description: string;
  requires_restart?: boolean;
}

export type ConfigFieldKind =
  | "boolean"
  | "string"
  | "integer"
  | "number"
  | "enum"
  | "string_array";

export type ConfigApplyMode =
  | "immediate"
  | "next_turn"
  | "restart_required";

export interface ConfigEnumOption {
  value: string;
  label: string;
}

export interface ConfigFieldSchema {
  key: string;
  section: string;
  label: string;
  description: string;
  kind: ConfigFieldKind;
  options?: ConfigEnumOption[];
  default_value: unknown;
  apply_mode: ConfigApplyMode;
}

export interface CapabilitiesPayload {
  commands: CommandDescriptor[];
  permission_modes: PermissionModeDescriptor[];
  features: FeatureFlagDescriptor[];
}

export interface ConfigStatePayload {
  path: string;
  sections: string[];
  values: Record<string, unknown>;
  schema: ConfigFieldSchema[];
}

export type MessageOrigin =
  | "user_typed"
  | "engine_internal"
  | "legacy_unknown";

export type MessageVisibility = "visible" | "hidden";

export const KNOWN_RUNTIME_COMMANDS = [
  "skills",
  "context",
  "info",
  "cache",
  "memory",
  "swarm",
  "agents",
  "subagent_model",
  "autoreview",
  "autojudge",
  "transport",
  "fast",
  "telemetry",
  "subscription",
  "overnight",
  "productivity",
  "initiatives",
  "premium",
  "provider_test_coverage",
  "refresh_model_list",
  "continue",
  "resume_all",
  "remote",
  "server_reload",
  "review",
  "judge",
  "subagent",
  "auth",
  "logout",
  "background",
  "mcp",
  "telegram",
  "features",
  "doctor",
  "session_search",
  "schedules",
  "ambient",
] as const;

export type RuntimeCommand =
  | "skills"
  | "context"
  | "info"
  | "cache"
  | "memory"
  | "swarm"
  | "agents"
  | "subagent_model"
  | "autoreview"
  | "autojudge"
  | "transport"
  | "fast"
  | "telemetry"
  | "subscription"
  | "overnight"
  | "productivity"
  | "initiatives"
  | "premium"
  | "provider_test_coverage"
  | "refresh_model_list"
  | "continue"
  | "resume_all"
  | "remote"
  | "server_reload"
  | "review"
  | "judge"
  | "subagent"
  | "auth"
  | "logout"
  | "background"
  | "mcp"
  | "telegram"
  | "features"
  | "doctor"
  | "session_search"
  | "schedules"
  | "ambient";

export interface RuntimeCommandOutput {
  session_id: string;
  command: RuntimeCommand;
  data: unknown;
  message: string;
}

export type PermissionDecision = "allow" | "allow_always" | "deny";

export const KNOWN_PERMISSION_MODES = [
  "default",
  "accept_edits",
  "plan",
  "full_manage",
  "orchestrator",
] as const;

export type PermissionMode =
  | "default"
  | "accept_edits"
  | "plan"
  | "full_manage"
  | "orchestrator";

export type PermissionRiskTier = "safe" | "bounded" | "confirm" | "catastrophic";

export type ErrorCode =
  | "unsupported_version"
  | "unknown_request"
  | "unknown_session"
  | "invalid_request"
  | "busy"
  | "unsupported"
  | "auth_required"
  | "internal";

/** Cumulative built-in file-tool changes, not net worktree diff. */
export interface SessionEditStats {
  added: number;
  removed: number;
  approximate: boolean;
}

export interface SessionInfo {
  edit_stats?: SessionEditStats;
  session_id: string;
  /** Swarm owner, never the transcript's ordinary fork parent. */
  parent_session_id?: string;
  /** Stable task/role label, separate from the canonical display title. */
  agent_label?: string;
  /** Last persisted swarm lifecycle status, not connection status. */
  swarm_status?: string;
  working_dir?: string;
  title?: string;
  status: string;
  /** Whether a user client is attached. Omitted by older servers, meaning false. */
  user_connected?: boolean;
  /** Approximate size of the stored transcript, in bytes. */
  transcript_bytes?: number;
  /** Whether the user pinned/saved this session. */
  saved?: boolean;
  /** Optional label given with `/save <label>`. */
  save_label?: string | null;
  /** Persisted transcript update time, used for newest-first ordering. */
  updated_at_ms?: number;
  /** Most recent active-process timestamp when available. */
  last_active_at_ms?: number;
  archived?: boolean;
  archived_at_ms?: number;
  /** Origin coding agent (e.g. "rayu", "claude_code", "claude_desktop", "codex", "codex_desktop", "cursor", "opencode", "pi"). */
  source?:
    | "rayu"
    | "claude_code"
    | "claude_desktop"
    | "codex"
    | "codex_desktop"
    | "cursor"
    | "opencode"
    | "pi"
    | string;
  /** Session identifier in the source external coding agent. */
  external_session_id?: string;
  /** Filesystem path to the external agent's transcript or metadata record. */
  external_path?: string;
  /** Project/workspace name reported by the external agent (e.g. Claude Desktop or Codex Desktop). */
  external_project_name?: string;
  /** Whether this external session has been materialized into Rayu's local store. */
  imported?: boolean;
  /** Whether the external transcript was modified after the imported Rayu snapshot. */
  sync_stale?: boolean;
}

/** A project discovered in an external coding agent (e.g. Claude Desktop or Codex Desktop). */
export interface ExternalProjectInfo {
  id: string;
  source: string;
  name: string;
  working_dir?: string | null;
  session_count: number;
  updated_at_ms?: number;
  sessions: SessionInfo[];
}

/** One external session selected for import or re-sync. */
export interface ImportExternalSessionItem {
  source: string;
  external_session_id: string;
  external_path?: string;
  working_dir?: string;
}

/** One external session that could not be imported or resynced cleanly. */
export interface ImportSkipInfo {
  external_session_id: string;
  source: string;
  reason: "conflict" | "not_found" | "error" | string;
  message: string;
  existing_session_id?: string | null;
}

/** Structured result of `import_external_sessions`. */
export interface ImportExternalSessionsResult {
  sessions: SessionInfo[];
  skipped: ImportSkipInfo[];
}

/** Tracked turns with a persisted response, separate from historical picker selections. */
export interface ModelUsage {
  count: number;
  last_used_unix_secs?: number | null;
  tracking_started_unix_secs?: number | null;
  selection_count: number;
  last_selected_unix_secs?: number | null;
}

/** Best-first usage ordering. Apply search relevance first and stable identity last. */
export function compareModelUsage(a?: ModelUsage | null, b?: ModelUsage | null): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return b.count - a.count
    || (b.last_used_unix_secs ?? -1) - (a.last_used_unix_secs ?? -1)
    || b.selection_count - a.selection_count
    || (b.last_selected_unix_secs ?? -1) - (a.last_selected_unix_secs ?? -1);
}

export interface ModelRouteInfo {
  model: string;
  provider: string;
  api_method: string;
  available: boolean;
  detail: string;
  usage?: ModelUsage;
  /** Reasoning effort stops supported by this route (excluding TUI-only `swarm*` sentinels). */
  supported_efforts?: string[];
  /** Default reasoning effort for this route, when supported. */
  default_effort?: string;
  /** Effective context window in tokens, when known. */
  context_window?: number;
}

export interface TextMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

/** A session's persisted todo state, as read by the follow-up policy.
 * Todos, plan, goals, and observations use the runtime's todo schema. */
export interface TodoSnapshot {
  todos: Array<Record<string, unknown>>;
  plan: Record<string, unknown>;
  goals: Array<Record<string, unknown>>;
  gate_observations: Array<Record<string, unknown>>;
  long_session_review_due: boolean;
  /** Session-scoped background task IDs still running. Absent on older servers. */
  running_background_tasks?: string[];
}

/** Persistent effects of a follow-up decision. */
export interface TodoEffects {
  clear_gate_observations?: boolean;
  mark_long_session_review_delivered?: boolean;
}

/** Durable raw provider counts summed over all assistant rounds in one user turn.
 * Missing metrics are unknown, not zero. Cache accounting differs by provider.
 * Restored duration is currently unavailable. */
export interface ResponseStats {
  duration_secs?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  rayu_credits?: number;
}

export interface HistoryTool {
  id: string;
  name: string;
  input?: unknown;
}

export interface HistoryMessage {
  /** Only on the final assistant row. Preview/old-server history may omit it. */
  response_stats?: ResponseStats;
  /** "user" | "assistant" | "tool" */
  role: string;
  content: string;
  /** On "tool" rows: the call this result answers. Absent from older servers. */
  tool?: HistoryTool;
  /** Provenance of the message (user-typed vs synthetic engine-internal prompt). */
  origin?: MessageOrigin;
  /** Whether thin clients should display or hide this row. */
  visibility?: MessageVisibility;
}

export type RenderedImageSource =
  | { kind: "user_input" }
  | { kind: "tool_result"; tool_name: string }
  | { kind: "other"; role: string };

export type RenderedImageAnchor =
  | { kind: "tool_call"; id: string }
  | { kind: "user_prompt"; ordinal: number };

export interface RenderedImage {
  media_type: string;
  data: string;
  label?: string;
  source: RenderedImageSource;
  anchor?: RenderedImageAnchor;
  /** Insert before this History.messages index (including hidden rows). Length means append. */
  history_message_index?: number;
}

/** Base64 image attachment: [mediaType, base64Data]. */
export type ImageAttachment = [string, string];

/** A tool definition exposed to the model. */
export interface SessionToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Wire-level session tool policy. Callback functions never cross the wire. */
export interface ToolConfiguration {
  enabled?: string[] | null;
  disabled?: string[];
  custom?: SessionToolDefinition[];
}

/** Type of filesystem mutation tracked for a file in a session. */
export type FileChangeKind = "created" | "modified" | "deleted" | "renamed";

/** Review status of a tracked file change entry. */
export type FileChangeStatus = "pending" | "kept" | "undone";

/** Review action requested by a client on one or all tracked file changes. */
export type FileChangeActionKind =
  | "keep"
  | "undo"
  | "redo"
  | "keep_all"
  | "undo_all"
  | "redo_all";

/** Structured unified-diff hunk shared across summary previews and full diffs. */
export interface FileChangeHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  header: string;
  lines: string[];
}

/** Compact per-file summary sent inside `FileChangesSnapshot`. */
export interface FileChangeEntrySummary {
  path: string;
  display_path: string;
  old_path?: string;
  kind: FileChangeKind;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  changed_in_latest_turn: boolean;
  turn_id: number;
  edit_count: number;
  is_binary: boolean;
  undoable: boolean;
  can_redo: boolean;
  /** Omitted by the runtime when empty. */
  preview_hunks?: FileChangeHunk[];
  preview_truncated: boolean;
  updated_at_ms: number;
}

/** Authoritative session-scoped snapshot of tracked file changes for review UIs. */
export interface FileChangesSnapshot {
  session_id: string;
  latest_turn_id: number;
  total_pending_files: number;
  total_additions: number;
  total_deletions: number;
  files: FileChangeEntrySummary[];
}

/** Full uncapped diff payload returned on demand for a single tracked file. */
export interface FileChangeDiffPayload {
  path: string;
  display_path: string;
  old_path?: string;
  kind: FileChangeKind;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  is_binary: boolean;
  original_content: string;
  modified_content: string;
  unified_diff: string;
  hunks: FileChangeHunk[];
}

/** Conflict encountered while safely undoing or redoing a file change. */
export interface FileChangeConflict {
  path: string;
  display_path: string;
  reason: string;
}

/** Structured response to a `FileChangeActionKind` request. */
export interface FileChangeActionResponse {
  ok: boolean;
  message: string;
  conflicts: FileChangeConflict[];
  snapshot: FileChangesSnapshot;
}

export type ApiRequest =
  | {
      req: "hello";
      min_version: number;
      max_version: number;
      client: string;
      supports_user_response?: boolean;
      supports_permissions?: boolean;
      supports_user_questions?: boolean;
    }
  | {
      req: "list_sessions";
      include_archived?: boolean;
      limit?: number;
      include_external?: boolean;
      sources?: string[];
    }
  | { req: "list_external_projects"; source?: string }
  | {
      req: "import_external_sessions";
      items: ImportExternalSessionItem[];
      force_resync?: boolean;
      fork_on_conflict?: boolean;
    }
  | { req: "archive_session"; session_id: string }
  | { req: "restore_session"; session_id: string }
  | { req: "set_retention_policy"; archive_after_days?: number | null }
  | { req: "create_session"; working_dir?: string; system_prompt?: string }
  | { req: "attach_session"; session_id: string }
  | {
      req: "fork_session";
      session_id: string;
      up_to_message_index?: number;
      up_to_message_id?: string;
    }
  | { req: "transfer_session"; session_id: string }
  | { req: "detach_session"; session_id: string }
  | { req: "configure_tools"; session_id: string; tools: ToolConfiguration }
  | { req: "list_tools"; session_id: string }
  | { req: "tool_result"; session_id: string; call_id: string; output: string; error?: string }
  | {
      req: "send_message";
      session_id: string;
      content: string;
      images?: ImageAttachment[];
      no_reply?: boolean;
      system_reminder?: string;
    }
  | { req: "cancel"; session_id: string }
  | {
      req: "soft_interrupt";
      session_id: string;
      content: string;
      images?: ImageAttachment[];
      urgent?: boolean;
      /** Opaque id echoed in `soft_interrupt_injected` and accepted by a filtered cancel. */
      client_id?: string;
    }
  | { req: "get_history"; session_id: string }
  | { req: "peek_session"; session_id: string; limit?: number }
  | { req: "clear"; session_id: string }
  | { req: "rewind"; session_id: string; message_index: number }
  | {
      req: "permission_response";
      session_id: string;
      request_id: string;
      decision: PermissionDecision;
    }
  | {
      req: "question_response";
      session_id: string;
      request_id: string;
      response: Record<string, unknown>;
    }
  | {
      req: "set_permission_mode";
      session_id: string;
      mode: PermissionMode;
    }
  | { req: "list_models"; session_id: string }
  | { req: "get_runtime_info"; session_id: string }
  | { req: "runtime_command"; session_id: string; command: RuntimeCommand; args?: string[] }
  | { req: "global_runtime_command"; command: RuntimeCommand; args?: string[] }
  | { req: "set_api_key"; provider: string; api_key: string }
  | { req: "notify_auth_changed"; provider: string }
  | { req: "invalidate_usage"; provider: string; account_label?: string }
  | { req: "clear_api_key"; provider: string }
  | { req: "read_file"; session_id: string; path: string; max_bytes?: number }
  | { req: "find_files"; session_id: string; query: string; limit?: number }
  | { req: "search_text"; session_id: string; query: string; path?: string; limit?: number }
  | { req: "file_status"; session_id: string; path: string }
  | { req: "get_file_changes"; session_id: string }
  | { req: "get_file_change_diff"; session_id: string; path: string }
  | {
      req: "file_change_action";
      session_id: string;
      action: FileChangeActionKind;
      path?: string;
      force?: boolean;
    }
  | { req: "get_todo_state"; session_id: string }
  | { req: "ack_todo_follow_up"; session_id: string; effects: TodoEffects }
  | { req: "set_model"; session_id: string; model: string }
  | { req: "set_context_cap"; session_id: string; max_context_tokens: number | null }
  | { req: "set_reasoning_effort"; session_id: string; effort: string }
  | { req: "compact"; session_id: string }
  | { req: "rename_session"; session_id: string; title?: string }
  | { req: "set_session_env"; session_id: string; env: Record<string, string> }
  | { req: "set_session_saved"; session_id: string; saved: boolean; label?: string }
  | {
      req: "applet_action";
      session_id: string;
      instance: string;
      action: AppletAction;
      state?: Record<string, unknown>;
      source_key?: string;
    }
  | { req: "close_applet"; session_id: string; instance: string }
  | { req: "rewind_undo"; session_id: string }
  /** Without `client_ids`, clears the queue (replies `ok`). With them, replies `soft_interrupts_cancelled`. */
  | { req: "cancel_soft_interrupts"; session_id: string; client_ids?: string[] }
  /** Replies `background_tool_result` when the `background_tool_result` capability is advertised, else `ok`. */
  | { req: "background_tool"; session_id: string }
  /** Discover curated engine slash commands, permission modes, and feature flags. */
  | { req: "get_capabilities"; session_id?: string }
  /** Read the curated non-secret view of `~/.rayu/config.toml` plus field schema. */
  | { req: "get_config"; sections?: string[] }
  /** Validate and atomically patch curated fields in `~/.rayu/config.toml`. */
  | { req: "patch_config"; patch: Record<string, unknown> }
  | { req: "ping" };

/** Markdown/PDF panel state, shared with the native runtime. */
export type SidePanelPageFormat = "markdown" | "pdf";
export type SidePanelPageSource = "managed" | "linked_file" | "ephemeral";
export interface SidePanelPage {
  id: string;
  title: string;
  file_path: string;
  format: SidePanelPageFormat;
  source: SidePanelPageSource;
  content: string;
  /** Base64 PDF bytes, separate from the human-readable Markdown fallback. */
  pdf_data?: string;
  updated_at_ms: number;
}
/** A user intent from an applet node (`rayu.applet/1`). */
export interface AppletAction {
  action: string;
  args?: unknown;
}

/** One mounted applet instance. `document` follows the `rayu.applet/1` schema. */
export interface AppletInstance {
  id: string;
  applet: string;
  placement: { kind: string; [key: string]: unknown };
  scope?: { kind: string; [key: string]: unknown };
  lifetime?: "ephemeral" | "session" | "persistent";
  document: {
    revision: number;
    title: string;
    view: { type: string; [key: string]: unknown };
    state?: Record<string, unknown>;
    assets?: unknown[];
  };
}

/** All agent-mounted applet instances for one session, in mount order. */
export interface AgentApplets {
  instances: AppletInstance[];
}

export interface SidePanelSnapshot {
  /** Monotonic explicit-focus intent. Absent on older servers. */
  focus_revision?: number;
  focused_page_id: string | null;
  /** Omitted by the runtime when empty. */
  pages?: SidePanelPage[];
}

export type ApiEvent =
  | { ev: "hello_ok"; version: number; minor_version?: number; server: string; capabilities?: string[] }
  | { ev: "ok" }
  | { ev: "runtime_command_result"; session_id: string; command: RuntimeCommand; data: unknown; message: string }
  | { ev: "error"; code: ErrorCode; message: string }
  | { ev: "sessions"; sessions: SessionInfo[] }
  | { ev: "external_projects"; projects: ExternalProjectInfo[] }
  | {
      ev: "external_sessions_imported";
      sessions: SessionInfo[];
      skipped: ImportSkipInfo[];
    }
  | { ev: "attached"; session: SessionInfo }
  | { ev: "session_forked"; session: SessionInfo }
  | { ev: "history"; session_id: string; messages: HistoryMessage[]; images?: RenderedImage[] }
  | {
      ev: "capabilities";
      commands: CommandDescriptor[];
      permission_modes: PermissionModeDescriptor[];
      features: FeatureFlagDescriptor[];
    }
  | {
      ev: "config_state";
      path: string;
      sections: string[];
      values: Record<string, unknown>;
      schema: ConfigFieldSchema[];
    }
  | {
      ev: "config_changed";
      changed_keys: string[];
      requires_restart?: boolean;
      values: Record<string, unknown>;
    }
  | { ev: "pong" }
  | { ev: "text_delta"; session_id: string; text: string; message_id?: string }
  | { ev: "text_done"; session_id: string; message_id?: string; stop_reason?: string }
  | { ev: "text_replace"; session_id: string; message_id?: string; text: string }
  | { ev: "reasoning_delta"; session_id: string; text: string }
  | { ev: "reasoning_done"; session_id: string; duration_secs?: number }
  | { ev: "tool_start"; session_id: string; call_id: string; name: string }
  | { ev: "tool_input_delta"; session_id: string; call_id: string; delta: string }
  | { ev: "tool_exec"; session_id: string; call_id: string; name: string }
  | { ev: "tools"; session_id: string; tools: SessionToolDefinition[] }
  | { ev: "tool_call"; session_id: string; call_id: string; name: string; input: unknown }
  | {
      ev: "tool_done";
      session_id: string;
      call_id: string;
      name: string;
      output: string;
      error?: string;
      duration_ms?: number;
    }
  | { ev: "side_panel_state"; session_id: string; snapshot: SidePanelSnapshot }
  | { ev: "applet_state"; session_id: string; snapshot: AgentApplets }
  | { ev: "file_changes_state"; session_id: string; snapshot: FileChangesSnapshot }
  | { ev: "file_change_diff"; session_id: string; diff: FileChangeDiffPayload }
  | { ev: "file_change_action_result"; session_id: string; response: FileChangeActionResponse }
  | { ev: "side_pane_images"; session_id: string; images: RenderedImage[] }
  | {
      ev: "token_usage";
      session_id: string;
      input: number;
      output: number;
      cache_read_input?: number;
      cache_creation_input?: number;
      effective_budget?: number;
    }
  | {
      ev: "rayu_credits";
      session_id: string;
      credits: number;
      turn_credits: number;
      billable_tokens?: number;
      tokens_per_credit?: number;
    }
  | { ev: "context_cap_changed"; session_id: string; max_context_tokens: number | null; effective_budget: number }
  | {
      ev: "kv_cache_miss";
      session_id: string;
      reason: string;
      harness_caused: boolean;
      missed_tokens: number;
      expected_tokens: number;
      read_tokens: number;
      documented_cause?: string;
      message: string;
    }
  | { ev: "turn_stopped"; session_id: string; reason: TurnStopReason; message: string; provider_stop_reason?: string }
  /** `pending_soft_interrupts`: queued messages this turn never saw (only when nonzero). */
  | { ev: "turn_done"; session_id: string; pending_soft_interrupts?: number }
  /**
   * Queued soft interrupts reached the model. Output after this event was written
   * having seen them. Several queued messages arrive as one user message, so
   * `client_ids` lists every id delivered, in queue order. `point` is B, C, D, or
   * `turn_start` (sent while idle, so it started a turn).
   */
  | {
      ev: "soft_interrupt_injected";
      session_id: string;
      client_ids: string[];
      point: string;
      tools_skipped?: number;
      display_role?: string;
    }
  /** Reply to a filtered `cancel_soft_interrupts`. Decided atomically against delivery. */
  | { ev: "soft_interrupts_cancelled"; cancelled: string[]; not_queued: string[] }
  /** Reply to `background_tool`. */
  | { ev: "background_tool_result"; moved: boolean; tool_call_id?: string; tool_name?: string }
  | {
      ev: "wake_requested";
      session_id: string;
      reason: string;
      notification: string;
    }
  | {
      ev: "background_progress";
      session_id: string;
      task_id: string;
      label: string;
      percent?: number;
      summary: string;
      done?: boolean;
    }
  | { ev: "message_accepted"; session_id: string }
  | {
      ev: "permission_request";
      session_id: string;
      request_id: string;
      tool_name: string;
      description: string;
      /** Optional risk tier classification ("safe" | "bounded" | "confirm" | "catastrophic"). */
      risk_tier?: string;
    }
  | {
      ev: "permission_mode_changed";
      session_id: string;
      mode: PermissionMode;
    }
  /** Attachment recovery intent. Can precede attached. Never auto-sent by the bridge. */
  | { ev: "session_recovery"; session_id: string; continuation_message: string; reconnect_notice?: string }
  | { ev: "session_status"; session_id: string; status: string; pending_soft_interrupts?: number }
  | { ev: "connection_phase"; session_id: string; phase: string }
  | {
      ev: "model_info";
      session_id: string;
      provider?: string;
      model?: string;
      reasoning_effort?: string;
      auth_method?: string;
      /** OAuth account the daemon's account router selected. */
      account_label?: string;
    }
  | { ev: "models"; session_id: string; models: string[]; current?: string }
  | {
      ev: "runtime_info";
      session_id: string;
      provider?: string;
      model?: string;
      reasoning_effort?: string;
      auth_method?: string;
      /** OAuth account the daemon's account router selected. */
      account_label?: string;
      routes: ModelRouteInfo[];
    }
  | { ev: "credential_updated"; provider: string; configured: boolean }
  | {
      ev: "file_content";
      session_id: string;
      path: string;
      content: string;
      size: number;
      truncated: boolean;
    }
  | { ev: "files"; session_id: string; paths: string[] }
  | { ev: "text_matches"; session_id: string; matches: TextMatch[] }
  | {
      ev: "file_status";
      session_id: string;
      path: string;
      exists: boolean;
      kind: string;
      size?: number;
      modified_ms?: number;
    }
  | { ev: "todo_state"; session_id: string; state: TodoSnapshot }
  | { ev: "compacted"; session_id: string; message: string }
  | {
      ev: "session_renamed";
      session_id: string;
      title?: string;
      display_title: string;
    }
  | {
      ev: "question_request";
      session_id: string;
      request_id: string;
      questions: unknown[];
    }
  | {
      ev: "question_closed";
      session_id: string;
      request_id: string;
    };

/**
 * An event kind this SDK does not know about.
 *
 * The harness may add events at any time within protocol v1, so one can arrive
 * at runtime. It is deliberately *not* part of `ApiEvent`: a member with
 * `ev: string` widens the discriminant, and TypeScript then refuses to narrow
 * `event.ev === "text_delta"` to the text-delta member, leaving every field
 * typed `unknown`. Forward compatibility is a runtime property, and paying for
 * it with the type safety of the ninety-nine percent case is a bad trade.
 *
 * Handle these with a `default` branch, or filter with `isKnownEvent`.
 */
export interface UnknownApiEvent {
  ev: string;
  [key: string]: unknown;
}

/** Any frame off the wire, known or not. Narrow with `isKnownEvent`. */
export type AnyApiEvent = ApiEvent | UnknownApiEvent;

export type ApiEventKind = ApiEvent["ev"];

export interface ClientFrame {
  v: number;
  id: number;
  [key: string]: unknown;
}

export type ServerFrame = {
  v: number;
  reply_to?: number;
  seq?: number;
  turn_id?: string;
} & UnknownApiEvent;

/** Every event tag the SDK knows about, for drift checks and routing. */
export const KNOWN_EVENT_KINDS = [
  "runtime_command_result",
  "hello_ok",
  "ok",
  "error",
  "sessions",
  "external_projects",
  "external_sessions_imported",
  "attached",
  "session_forked",
  "history",
  "capabilities",
  "config_state",
  "config_changed",
  "side_pane_images",
  "side_panel_state",
  "applet_state",
  "file_changes_state",
  "file_change_diff",
  "file_change_action_result",
  "pong",
  "text_delta",
  "text_done",
  "text_replace",
  "reasoning_delta",
  "reasoning_done",
  "tool_start",
  "tools",
  "tool_call",
  "tool_input_delta",
  "tool_exec",
  "tool_done",
  "token_usage",
  "rayu_credits",
  "context_cap_changed",
  "kv_cache_miss",
  "turn_done",
  "soft_interrupt_injected",
  "soft_interrupts_cancelled",
  "background_tool_result",
  "turn_stopped",
  "wake_requested",
  "background_progress",
  "message_accepted",
  "permission_request",
  "permission_mode_changed",
  "question_request",
  "question_closed",
  "session_status",
  "session_recovery",
  "connection_phase",
  "model_info",
  "models",
  "runtime_info",
  "credential_updated",
  "file_content",
  "files",
  "text_matches",
  "file_status",
  "todo_state",
  "compacted",
  "session_renamed",
] as const;

/** Every request tag the SDK can send. */
export const KNOWN_REQUEST_KINDS = [
  "runtime_command",
  "global_runtime_command",
  "hello",
  "list_sessions",
  "list_external_projects",
  "import_external_sessions",
  "archive_session",
  "restore_session",
  "set_retention_policy",
  "create_session",
  "attach_session",
  "fork_session",
  "transfer_session",
  "detach_session",
  "configure_tools",
  "list_tools",
  "tool_result",
  "send_message",
  "cancel",
  "soft_interrupt",
  "get_history",
  "peek_session",
  "clear",
  "rewind",
  "permission_response",
  "question_response",
  "set_permission_mode",
  "list_models",
  "get_runtime_info",
  "set_api_key",
  "clear_api_key",
  "notify_auth_changed",
  "invalidate_usage",
  "read_file",
  "find_files",
  "search_text",
  "file_status",
  "get_file_changes",
  "get_file_change_diff",
  "file_change_action",
  "get_todo_state",
  "ack_todo_follow_up",
  "set_model",
  "set_context_cap",
  "set_reasoning_effort",
  "compact",
  "rename_session",
  "set_session_env",
  "set_session_saved",
  "applet_action",
  "close_applet",
  "rewind_undo",
  "cancel_soft_interrupts",
  "background_tool",
  "get_capabilities",
  "get_config",
  "patch_config",
  "ping",
] as const;

export function isKnownEvent(frame: AnyApiEvent): frame is ApiEvent {
  return (KNOWN_EVENT_KINDS as readonly string[]).includes(frame.ev);
}

/** Natural completion has no stop reason. Transport loss is not proof of a crash. */
export type TurnStopReason = "interrupted" | "failure" | "crash" | "provider_guardrail" | "limit_reached" | "unknown";
