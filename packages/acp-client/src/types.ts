export const ACP_PROTOCOL_VERSION = 1 as const;
export const ACP_ERROR_AUTH_REQUIRED = -32000 as const;

export type AcpProfile = "standard" | "extended" | "full";
export type RayuProduct = "cli" | "rayucode" | "studio" | "api";

export type AcpPermissionModeId =
  | "default"
  | "accept_edits"
  | "plan"
  | "full_manage"
  | "orchestrator";

export interface ClientInfo {
  name: string;
  version?: string;
  title?: string;
}

export interface ClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
  auth?: {
    terminal?: boolean;
  };
  _meta?: Record<string, unknown>;
}

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: ClientInfo;
  _meta?: {
    rayu?: {
      profile?: AcpProfile;
      product?: RayuProduct;
    };
    [key: string]: unknown;
  };
}

export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
  type?: string;
  _meta?: Record<string, unknown>;
}

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
  };
  sessionCapabilities?: {
    list?: Record<string, unknown>;
    fork?: Record<string, unknown>;
    resume?: Record<string, unknown>;
    close?: Record<string, unknown>;
    delete?: Record<string, unknown>;
  };
  _meta?: Record<string, unknown>;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: AgentCapabilities;
  agentInfo: {
    name: string;
    title?: string;
    version: string;
  };
  authMethods: AuthMethod[];
}

export interface AuthenticateParams {
  methodId: string;
  apiKey?: string;
  callbackUrl?: string;
  noBrowser?: boolean;
  data?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export type AuthenticateResult = Record<string, unknown>;

export interface KeyValuePair {
  name: string;
  value: string;
}

export interface McpServerStdio {
  type?: "stdio";
  name: string;
  command: string;
  args?: string[];
  env?: KeyValuePair[] | Record<string, string>;
}

export interface McpServerHttp {
  type: "http";
  name: string;
  url: string;
  headers?: KeyValuePair[] | Record<string, string>;
}

export interface McpServerSse {
  type: "sse";
  name: string;
  url: string;
  headers?: KeyValuePair[] | Record<string, string>;
}

export type McpServerConfig = McpServerStdio | McpServerHttp | McpServerSse;

export interface ConfigOptionChoice {
  value: string;
  name: string;
  description?: string;
}

export interface ConfigOption {
  type: "select";
  id: string;
  name: string;
  category?: "mode" | "model" | "thought_level" | string;
  currentValue: string;
  options: ConfigOptionChoice[];
}

export interface SessionModeInfo {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionModeInfo[];
}

export interface SessionModelState {
  currentModelId: string;
  availableModels: Array<{ modelId: string; name: string }>;
}

export interface SessionConfiguration {
  configOptions?: ConfigOption[];
  models?: SessionModelState;
  modes?: SessionModeState;
}

export interface NewSessionParams {
  cwd: string;
  mcpServers?: McpServerConfig[];
  _meta?: Record<string, unknown>;
}

export interface NewSessionResult extends SessionConfiguration {
  sessionId: string;
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
  mcpServers?: McpServerConfig[];
  _meta?: Record<string, unknown>;
}

export type LoadSessionResult = SessionConfiguration;

export type ResumeSessionParams = LoadSessionParams;
export type ResumeSessionResult = SessionConfiguration;

export interface ForkSessionParams {
  sessionId: string;
  cwd?: string;
  mcpServers?: McpServerConfig[];
  _meta?: Record<string, unknown>;
}

export interface ForkSessionResult extends SessionConfiguration {
  sessionId: string;
}

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

export interface ListSessionsParams {
  cwd?: string;
  cursor?: string;
}

export interface ListSessionsResult {
  sessions: SessionInfo[];
  nextCursor?: string;
}

export interface CloseSessionParams {
  sessionId: string;
}

export interface DeleteSessionParams {
  sessionId: string;
}

export interface SetSessionModeParams {
  sessionId: string;
  modeId: AcpPermissionModeId | string;
}

export interface SetConfigOptionParams {
  sessionId: string;
  configId: string;
  value: string;
}

export interface SetConfigOptionResult {
  configOptions: ConfigOption[];
}

export type PromptContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | {
      type: "resource";
      resource: { uri: string; text?: string; blob?: string; mimeType?: string };
    }
  | { type: "resource_link"; uri: string; name?: string };

export interface PromptParams {
  sessionId: string;
  prompt: PromptContentBlock[];
  _meta?: Record<string, unknown>;
}

export type StopReason =
  | "end_turn"
  | "cancelled"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal";

export interface TurnUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export interface PromptResult {
  stopReason: StopReason;
  usage?: TurnUsage;
}

export interface CancelSessionParams {
  sessionId: string;
}

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export type ToolCallContent =
  | { type: "content"; content: { type: "text"; text: string } }
  | { type: "diff"; path: string; oldText: string | null; newText: string };

export type ToolCallKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint?: string };
}

export type SessionUpdate =
  | { sessionUpdate: "user_message_chunk"; content: { type: "text"; text: string } }
  | { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } }
  | { sessionUpdate: "agent_thought_chunk"; content: { type: "text"; text: string } }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title: string;
      kind: ToolCallKind;
      status: ToolCallStatus;
      rawInput?: Record<string, unknown>;
      locations?: ToolCallLocation[];
      content?: ToolCallContent[];
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      title?: string;
      kind?: ToolCallKind;
      status?: ToolCallStatus;
      rawInput?: Record<string, unknown>;
      rawOutput?: Record<string, unknown>;
      locations?: ToolCallLocation[];
      content?: ToolCallContent[];
    }
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  | { sessionUpdate: "available_commands_update"; availableCommands: AvailableCommand[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "config_option_update"; configOptions: ConfigOption[] }
  | { sessionUpdate: "usage_update"; used: number; size: number }
  | { sessionUpdate: "session_info_update"; title?: string; updatedAt?: string };

export interface SessionUpdateNotification {
  sessionId: string;
  update: SessionUpdate;
}

export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    kind: ToolCallKind;
    status: ToolCallStatus;
    rawInput?: unknown;
    locations?: ToolCallLocation[];
    _meta?: Record<string, unknown>;
  };
  options: PermissionOption[];
}

export type PermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface RequestPermissionResult {
  outcome: PermissionOutcome;
}

export interface RayuServerEventNotification {
  sessionId: string;
  event: Record<string, unknown>;
}

export class AcpRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "AcpRpcError";
    this.code = code;
    this.data = data;
  }

  isAuthRequired(): boolean {
    if (this.code !== ACP_ERROR_AUTH_REQUIRED) {
      return false;
    }
    if (this.data && typeof this.data === "object") {
      return (this.data as Record<string, unknown>).errorKind === "auth_required";
    }
    return this.message.toLowerCase().includes("authentication required");
  }

  authMethods(): AuthMethod[] {
    if (this.data && typeof this.data === "object") {
      const methods = (this.data as Record<string, unknown>).authMethods;
      if (Array.isArray(methods)) {
        return methods as AuthMethod[];
      }
    }
    return [];
  }
}

export function isAuthRequiredError(error: unknown): error is AcpRpcError {
  return error instanceof AcpRpcError && error.isAuthRequired();
}
