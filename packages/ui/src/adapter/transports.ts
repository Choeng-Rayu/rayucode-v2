/**
 * Built-in browser-safe transport adapters implementing `RayucodePlatformAdapter`:
 *
 * 1. `createPostMessageAdapter`: connects a VS Code Webview to the Extension Host
 *    via an injected `postMessage` / `addEventListener` bridge (never calling
 *    `acquireVsCodeApi()` directly inside the shared package).
 * 2. `createWebSocketAdapter`: connects a Next.js / browser client directly to a
 *    RayuCode WebSocket harness bridge speaking protocol v1.12 JSON frames.
 */

import {
  API_VERSION_MAJOR,
  HarnessError,
  type AnyApiEvent,
  type ApiRequest,
  type ImageAttachment,
  type PermissionDecision,
  type ServerFrame,
  type SessionInfo,
  type TodoSnapshot,
} from "@rayu-dev/rayucode-sdk/browser";
import type {
  HistoryPayload,
  RayucodePlatformAdapter,
  RayucodePlatformCapabilities,
  RuntimeInfoSnapshot,
  SettingsAccountSummary,
} from "./types.js";

type PendingReply = {
  resolve: (frame: ServerFrame) => void;
  reject: (err: Error) => void;
};

function createFrameRpcChannel(sendRaw: (payload: string) => void) {
  let nextId = 1;
  const pending = new Map<number, PendingReply>();
  const listeners = new Set<(event: AnyApiEvent) => void>();

  function handleIncoming(frame: ServerFrame): void {
    if (typeof frame.reply_to === "number") {
      const waiter = pending.get(frame.reply_to);
      if (waiter) {
        pending.delete(frame.reply_to);
        if (frame.ev === "error") {
          const code = typeof frame.code === "string" ? frame.code : "internal";
          const message = typeof frame.message === "string" ? frame.message : "Harness error";
          waiter.reject(new HarnessError(code, message));
        } else {
          waiter.resolve(frame);
        }
      }
    }
    for (const listener of listeners) {
      listener(frame);
    }
  }

  function rejectAll(reason: Error): void {
    for (const waiter of pending.values()) {
      waiter.reject(reason);
    }
    pending.clear();
  }

  function request(req: ApiRequest): Promise<ServerFrame> {
    const id = nextId++;
    const frame = { v: API_VERSION_MAJOR, id, ...req };
    return new Promise<ServerFrame>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        sendRaw(JSON.stringify(frame));
      } catch (err) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function subscribe(listener: (event: AnyApiEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { request, subscribe, handleIncoming, rejectAll };
}

function buildRpcAdapter(
  rpc: ReturnType<typeof createFrameRpcChannel>,
  capabilities: RayucodePlatformCapabilities,
  hostActions: {
    openFile?: (filePath: string, line?: number) => Promise<void>;
    openDiff?: (filePath: string, before: string, after: string) => Promise<void>;
    pickWorkspaceFolder?: () => Promise<string | undefined>;
    openExternalUrl: (url: string) => Promise<void>;
    copyToClipboard: (text: string) => Promise<void>;
    getAccountSummary?: () => Promise<SettingsAccountSummary>;
    startSignIn?: () => Promise<void>;
    signOut?: () => Promise<void>;
  },
): RayucodePlatformAdapter {
  return {
    capabilities,
    async listSessions(options) {
      const reply = await rpc.request({
        req: "list_sessions",
        include_archived: options?.includeArchived,
        limit: options?.limit,
      });
      return (reply.sessions as SessionInfo[] | undefined) ?? [];
    },
    async createSession(options) {
      const reply = await rpc.request({
        req: "create_session",
        working_dir: options?.workingDir,
        system_prompt: options?.systemPrompt,
      });
      return reply.session as SessionInfo;
    },
    async attachSession(sessionId) {
      await rpc.request({ req: "attach_session", session_id: sessionId });
      const history = await rpc.request({ req: "get_history", session_id: sessionId });
      return {
        sessionId,
        messages: (history.messages as HistoryPayload["messages"] | undefined) ?? [],
        images: history.images as HistoryPayload["images"] | undefined,
      };
    },
    async sendMessage(sessionId, content, options) {
      await rpc.request({
        req: "send_message",
        session_id: sessionId,
        content,
        images: options?.images as ImageAttachment[] | undefined,
      });
    },
    async cancelTurn(sessionId) {
      await rpc.request({ req: "cancel", session_id: sessionId });
    },
    async clearSession(sessionId) {
      await rpc.request({ req: "clear", session_id: sessionId });
    },
    async compactSession(sessionId) {
      await rpc.request({ req: "compact", session_id: sessionId });
    },
    async renameSession(sessionId, title) {
      await rpc.request({ req: "rename_session", session_id: sessionId, title });
    },
    async getRuntimeInfo(sessionId) {
      const reply = await rpc.request({ req: "get_runtime_info", session_id: sessionId });
      return {
        sessionId,
        provider: typeof reply.provider === "string" ? reply.provider : undefined,
        model: typeof reply.model === "string" ? reply.model : undefined,
        reasoningEffort:
          typeof reply.reasoning_effort === "string" ? reply.reasoning_effort : undefined,
        authMethod: typeof reply.auth_method === "string" ? reply.auth_method : undefined,
        accountLabel: typeof reply.account_label === "string" ? reply.account_label : undefined,
        routes: (reply.routes as RuntimeInfoSnapshot["routes"] | undefined) ?? [],
      };
    },
    async setModel(sessionId, model) {
      await rpc.request({ req: "set_model", session_id: sessionId, model });
    },
    async setReasoningEffort(sessionId, effort) {
      await rpc.request({ req: "set_reasoning_effort", session_id: sessionId, effort });
    },
    async getTodoState(sessionId) {
      const reply = await rpc.request({ req: "get_todo_state", session_id: sessionId });
      return reply.state as TodoSnapshot;
    },
    async respondPermission(sessionId, requestId, decision: PermissionDecision) {
      await rpc.request({
        req: "permission_response",
        session_id: sessionId,
        request_id: requestId,
        decision,
      });
    },
    async setApiKey(provider, apiKey) {
      await rpc.request({ req: "set_api_key", provider, api_key: apiKey });
    },
    openFile: hostActions.openFile,
    openDiff: hostActions.openDiff,
    pickWorkspaceFolder: hostActions.pickWorkspaceFolder,
    openExternalUrl: hostActions.openExternalUrl,
    copyToClipboard: hostActions.copyToClipboard,
    getAccountSummary: hostActions.getAccountSummary,
    startSignIn: hostActions.startSignIn,
    signOut: hostActions.signOut,
    subscribe: rpc.subscribe,
  };
}

export interface PostMessageBridge {
  postMessage(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

export interface PostMessageAdapterOptions {
  bridge: PostMessageBridge;
  capabilities?: Partial<RayucodePlatformCapabilities>;
}

/**
 * Creates a `RayucodePlatformAdapter` for VS Code Webviews without coupling
 * `@rayu-dev/rayucode-ui` to VS Code globals.
 */
export function createPostMessageAdapter(
  options: PostMessageAdapterOptions,
): { adapter: RayucodePlatformAdapter; dispose: () => void } {
  const { bridge } = options;
  const rpc = createFrameRpcChannel((payload) => {
    bridge.postMessage({ type: "rayucode.harness.request", frame: JSON.parse(payload) });
  });

  const dispose = bridge.onMessage((raw) => {
    if (typeof raw !== "object" || raw === null) return;
    const msg = raw as Record<string, unknown>;
    if (msg.type === "rayucode.harness.frame" && typeof msg.frame === "object" && msg.frame !== null) {
      rpc.handleIncoming(msg.frame as ServerFrame);
    }
  });

  const capabilities: RayucodePlatformCapabilities = {
    platform: "vscode",
    canOpenLocalFile: true,
    canShowNativeDiff: true,
    canPickWorkspaceFolder: true,
    supportsNativeAccountMenu: true,
    ...options.capabilities,
  };

  const adapter = buildRpcAdapter(rpc, capabilities, {
    async openFile(filePath, line) {
      bridge.postMessage({ type: "rayucode.host.openFile", filePath, line });
    },
    async openDiff(filePath, before, after) {
      bridge.postMessage({ type: "rayucode.host.openDiff", filePath, before, after });
    },
    async openExternalUrl(url) {
      bridge.postMessage({ type: "rayucode.host.openExternal", url });
    },
    async copyToClipboard(text) {
      bridge.postMessage({ type: "rayucode.host.copyToClipboard", text });
    },
    async startSignIn() {
      bridge.postMessage({ type: "rayucode.host.signIn" });
    },
    async signOut() {
      bridge.postMessage({ type: "rayucode.host.signOut" });
    },
  });

  return { adapter, dispose };
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (ev: any) => void): void;
  removeEventListener(type: "open" | "message" | "close" | "error", listener: (ev: any) => void): void;
}

export interface WebSocketAdapterOptions {
  socket: WebSocketLike;
  clientName?: string;
  capabilities?: Partial<RayucodePlatformCapabilities>;
}

/**
 * Creates a `RayucodePlatformAdapter` over a browser WebSocket connected to
 * a RayuCode WebSocket harness bridge (Next.js / RayuCode Web).
 */
export function createWebSocketAdapter(
  options: WebSocketAdapterOptions,
): { adapter: RayucodePlatformAdapter; dispose: () => void } {
  const { socket } = options;
  const rpc = createFrameRpcChannel((payload) => {
    socket.send(payload);
  });

  const onMessage = (ev: { data: unknown }) => {
    if (typeof ev.data !== "string") return;
    try {
      const parsed = JSON.parse(ev.data) as ServerFrame;
      if (parsed && typeof parsed.ev === "string") {
        rpc.handleIncoming(parsed);
      }
    } catch {
      // Ignore malformed frames
    }
  };

  const onClose = () => {
    rpc.rejectAll(new HarnessError("internal", "WebSocket connection closed"));
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);

  const capabilities: RayucodePlatformCapabilities = {
    platform: "web",
    canOpenLocalFile: false,
    canShowNativeDiff: false,
    canPickWorkspaceFolder: false,
    supportsNativeAccountMenu: false,
    ...options.capabilities,
  };

  const adapter = buildRpcAdapter(rpc, capabilities, {
    async openExternalUrl(url) {
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    async copyToClipboard(text) {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    },
  });

  const dispose = () => {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
  };

  return { adapter, dispose };
}
