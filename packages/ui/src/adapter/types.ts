/**
 * Platform adapter contract separating shared React UI components from
 * host-specific transports (Next.js Browser WebSocket/HTTP vs VS Code Webview
 * `postMessage` + Extension Host).
 */

import type {
  AnyApiEvent,
  HistoryMessage,
  ImageAttachment,
  ModelRouteInfo,
  PermissionDecision,
  RenderedImage,
  SessionInfo,
  TodoSnapshot,
} from "@rayu-dev/rayucode-sdk/browser";

export type RayucodePlatformKind = "web" | "vscode";

export interface RayucodePlatformCapabilities {
  readonly platform: RayucodePlatformKind;
  readonly canOpenLocalFile: boolean;
  readonly canShowNativeDiff: boolean;
  readonly canPickWorkspaceFolder: boolean;
  readonly supportsNativeAccountMenu: boolean;
}

export interface HistoryPayload {
  sessionId: string;
  messages: HistoryMessage[];
  images?: RenderedImage[];
}

export interface RuntimeInfoSnapshot {
  sessionId: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  authMethod?: string;
  accountLabel?: string;
  routes: ModelRouteInfo[];
}

export interface SettingsAccountSummary {
  signedIn: boolean;
  provider?: string;
  email?: string;
  plan?: string;
  balanceLabel?: string;
}

export interface RayucodePlatformAdapter {
  readonly capabilities: RayucodePlatformCapabilities;

  // Session & turn lifecycle
  listSessions(options?: { includeArchived?: boolean; limit?: number }): Promise<SessionInfo[]>;
  createSession(options?: { workingDir?: string; systemPrompt?: string }): Promise<SessionInfo>;
  attachSession(sessionId: string): Promise<HistoryPayload>;
  sendMessage(
    sessionId: string,
    content: string,
    options?: { images?: ImageAttachment[] },
  ): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  clearSession?(sessionId: string): Promise<void>;
  compactSession?(sessionId: string): Promise<void>;
  renameSession?(sessionId: string, title?: string): Promise<void>;

  // Models, runtime metadata & todos
  getRuntimeInfo(sessionId: string): Promise<RuntimeInfoSnapshot>;
  setModel(sessionId: string, model: string): Promise<void>;
  setReasoningEffort?(sessionId: string, effort: string): Promise<void>;
  getTodoState?(sessionId: string): Promise<TodoSnapshot>;

  // Permissions & auth
  respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<void>;
  getAccountSummary?(): Promise<SettingsAccountSummary>;
  startSignIn?(): Promise<void>;
  signOut?(): Promise<void>;
  setApiKey?(provider: string, apiKey: string): Promise<void>;

  // Platform-native integrations (browser fallbacks on Web, editor APIs in VS Code)
  openFile?(filePath: string, line?: number): Promise<void>;
  openDiff?(filePath: string, before: string, after: string): Promise<void>;
  pickWorkspaceFolder?(): Promise<string | undefined>;
  openExternalUrl(url: string): Promise<void>;
  copyToClipboard(text: string): Promise<void>;

  // Real-time event stream from Harness API v1.12
  subscribe(listener: (event: AnyApiEvent) => void): () => void;
}
