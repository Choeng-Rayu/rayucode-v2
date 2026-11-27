import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  ACP_PROTOCOL_VERSION,
  AcpRpcError,
  type AcpPermissionModeId,
  type AcpProfile,
  type AuthenticateParams,
  type AuthenticateResult,
  type CancelSessionParams,
  type ClientCapabilities,
  type ClientInfo,
  type CloseSessionParams,
  type DeleteSessionParams,
  type ForkSessionParams,
  type ForkSessionResult,
  type InitializeParams,
  type InitializeResult,
  type ListSessionsParams,
  type ListSessionsResult,
  type LoadSessionParams,
  type LoadSessionResult,
  type NewSessionParams,
  type NewSessionResult,
  type PromptParams,
  type PromptResult,
  type RayuProduct,
  type RayuServerEventNotification,
  type RequestPermissionParams,
  type RequestPermissionResult,
  type ResumeSessionParams,
  type ResumeSessionResult,
  type SessionUpdateNotification,
  type SetConfigOptionParams,
  type SetConfigOptionResult,
  type SetSessionModeParams,
} from "./types.js";

export interface AcpTransport {
  readonly input: Readable;
  readonly output: Writable;
  readonly stderr?: Readable | null;
  close?: () => void | Promise<void>;
}

export interface SpawnAcpOptions {
  /** Path to the `rayu` binary (defaults to `"rayu"` on PATH). */
  binaryPath?: string;
  /** Compatibility profile (`"standard"` for generic IDEs, `"extended"`/`"full"` for Desktop & VS Code). */
  profile?: AcpProfile;
  /** Rayu client product attribution (`"studio"`, `"rayucode"`, `"cli"`, `"api"`). */
  product?: RayuProduct;
  /** Extra CLI flags appended before `acp` (e.g. `--provider`, `--model`). */
  globalArgs?: string[];
  /** Optional working directory for the spawned `rayu acp` process. */
  cwd?: string;
  /** Additional environment variables merged with `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export type PermissionRequestHandler = (
  params: RequestPermissionParams,
) => Promise<RequestPermissionResult> | RequestPermissionResult;

export type ClientRequestHandler = (params: unknown) => Promise<unknown> | unknown;

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Bidirectional JSON-RPC 2.0 ACP client shared across RayuCode Desktop,
 * the VS Code extension, CLI tooling, and external Node-based IDE integrations.
 */
export class AcpClient {
  private readonly transport: AcpTransport;
  private readonly rl: ReadlineInterface;
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<string, PendingRpc>();
  private readonly sessionUpdateListeners = new Set<(event: SessionUpdateNotification) => void>();
  private readonly rayuEventListeners = new Set<(event: RayuServerEventNotification) => void>();
  private readonly closeListeners = new Set<(reason?: Error) => void>();
  private readonly stderrListeners = new Set<(line: string) => void>();
  private readonly clientRequestHandlers = new Map<string, ClientRequestHandler>();
  private permissionHandler: PermissionRequestHandler | null = null;
  private stderrRl: ReadlineInterface | null = null;

  constructor(transport: AcpTransport) {
    this.transport = transport;
    this.rl = createInterface({ input: transport.input, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      void this.handleLine(line);
    });
    this.rl.on("close", () => {
      this.handleTransportClosed();
    });
    transport.input.on("error", (err) => {
      this.handleTransportClosed(err);
    });
    if (transport.stderr) {
      this.stderrRl = createInterface({ input: transport.stderr, crlfDelay: Infinity });
      this.stderrRl.on("line", (line) => {
        for (const listener of this.stderrListeners) {
          listener(line);
        }
      });
    }
  }

  /**
   * Spawn `rayu acp` over stdio and return a connected bidirectional `AcpClient`.
   */
  static spawn(options: SpawnAcpOptions = {}): AcpClient {
    const binary = options.binaryPath ?? "rayu";
    const args: string[] = [...(options.globalArgs ?? []), "acp"];
    if (options.profile) {
      args.push("--profile", options.profile);
    }
    if (options.product) {
      args.push("--product", options.product);
    }
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
    if (options.product && !env.RAYU_CLIENT_PRODUCT) {
      env.RAYU_CLIENT_PRODUCT = options.product;
    }

    const child: ChildProcess = spawn(binary, args, {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!child.stdout || !child.stdin) {
      throw new Error("Failed to open stdio pipes for rayu acp subprocess");
    }

    const client = new AcpClient({
      input: child.stdout,
      output: child.stdin,
      stderr: child.stderr,
      close: () => {
        if (!child.killed) {
          child.stdin?.end();
          child.kill("SIGTERM");
        }
      },
    });
    child.on("error", (err) => {
      client.handleTransportClosed(err);
    });
    child.on("exit", (code, signal) => {
      if (code && code !== 0) {
        client.handleTransportClosed(
          new Error(`rayu acp exited with code ${code}${signal ? ` (${signal})` : ""}`),
        );
      } else {
        client.handleTransportClosed();
      }
    });
    return client;
  }

  onSessionUpdate(listener: (event: SessionUpdateNotification) => void): () => void {
    this.sessionUpdateListeners.add(listener);
    return () => {
      this.sessionUpdateListeners.delete(listener);
    };
  }

  onRayuServerEvent(listener: (event: RayuServerEventNotification) => void): () => void {
    this.rayuEventListeners.add(listener);
    return () => {
      this.rayuEventListeners.delete(listener);
    };
  }

  onStderr(listener: (line: string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => {
      this.stderrListeners.delete(listener);
    };
  }

  onClose(listener: (reason?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /**
   * Register the handler invoked when `rayu acp` sends `session/request_permission`.
   * If no handler is registered, permission requests default to `{ outcome: { outcome: "cancelled" } }`.
   */
  onPermissionRequest(handler: PermissionRequestHandler | null): void {
    this.permissionHandler = handler;
  }

  /**
   * Register a custom Agent -> Client request handler (e.g. `fs/read_text_file`,
   * `fs/write_text_file`, or `terminal/*`).
   */
  onClientRequest(method: string, handler: ClientRequestHandler): () => void {
    this.clientRequestHandlers.set(method, handler);
    return () => {
      this.clientRequestHandlers.delete(method);
    };
  }

  async initialize(
    options: {
      clientInfo?: ClientInfo;
      clientCapabilities?: ClientCapabilities;
      profile?: AcpProfile;
      product?: RayuProduct;
      meta?: Record<string, unknown>;
    } = {},
  ): Promise<InitializeResult> {
    const params: InitializeParams = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: options.clientCapabilities ?? {},
      clientInfo: options.clientInfo,
    };
    if (options.profile || options.product || options.meta) {
      params._meta = {
        ...options.meta,
        ...(options.profile || options.product
          ? {
              rayu: {
                ...(options.profile ? { profile: options.profile } : {}),
                ...(options.product ? { product: options.product } : {}),
              },
            }
          : {}),
      };
    }
    return this.request<InitializeResult>("initialize", params);
  }

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    return this.request<AuthenticateResult>("authenticate", params);
  }

  async newSession(params: NewSessionParams): Promise<NewSessionResult> {
    return this.request<NewSessionResult>("session/new", params);
  }

  async loadSession(params: LoadSessionParams): Promise<LoadSessionResult> {
    return this.request<LoadSessionResult>("session/load", params);
  }

  async resumeSession(params: ResumeSessionParams): Promise<ResumeSessionResult> {
    return this.request<ResumeSessionResult>("session/resume", params);
  }

  async forkSession(params: ForkSessionParams): Promise<ForkSessionResult> {
    return this.request<ForkSessionResult>("session/fork", params);
  }

  async listSessions(params: ListSessionsParams = {}): Promise<ListSessionsResult> {
    return this.request<ListSessionsResult>("session/list", params);
  }

  async closeSession(params: CloseSessionParams): Promise<void> {
    await this.request("session/close", params);
  }

  async deleteSession(params: DeleteSessionParams): Promise<void> {
    await this.request("session/delete", params);
  }

  async setMode(params: SetSessionModeParams): Promise<void> {
    await this.request("session/set_mode", params);
  }

  async setConfigOption(params: SetConfigOptionParams): Promise<SetConfigOptionResult> {
    return this.request<SetConfigOptionResult>("session/set_config_option", params);
  }

  async setModel(sessionId: string, modelId: string): Promise<SetConfigOptionResult> {
    return this.setConfigOption({ sessionId, configId: "model", value: modelId });
  }

  async setReasoningEffort(sessionId: string, effort: string): Promise<SetConfigOptionResult> {
    return this.setConfigOption({ sessionId, configId: "reasoning_effort", value: effort });
  }

  async setPermissionMode(
    sessionId: string,
    mode: AcpPermissionModeId,
  ): Promise<void> {
    await this.setMode({ sessionId, modeId: mode });
  }

  async prompt(params: PromptParams): Promise<PromptResult> {
    return this.request<PromptResult>("session/prompt", params);
  }

  async cancel(params: CancelSessionParams): Promise<void> {
    await this.notify("session/cancel", params);
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      throw new Error(`ACP client is closed (cannot call ${method})`);
    }
    const id = this.nextId++;
    const key = JSON.stringify(id);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.writeMessage({
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      }).catch((err) => {
        this.pending.delete(key);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.writeMessage({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    });
  }

  async dispose(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.handleTransportClosed();
    this.rl.close();
    this.stderrRl?.close();
    await this.transport.close?.();
  }

  private async writeMessage(payload: Record<string, unknown>): Promise<void> {
    const line = `${JSON.stringify(payload)}\n`;
    await new Promise<void>((resolve, reject) => {
      this.transport.output.write(line, "utf8", (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async handleLine(rawLine: string): Promise<void> {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    const hasMethod = typeof msg.method === "string";
    const hasId = msg.id !== undefined && msg.id !== null;

    // 1. Response to one of our Client -> Agent requests
    if (!hasMethod && hasId) {
      const key = JSON.stringify(msg.id);
      const pending = this.pending.get(key);
      if (!pending) {
        return;
      }
      this.pending.delete(key);
      if (msg.error && typeof msg.error === "object") {
        const errObj = msg.error as Record<string, unknown>;
        const code = typeof errObj.code === "number" ? errObj.code : -32603;
        const message = typeof errObj.message === "string" ? errObj.message : "ACP RPC error";
        pending.reject(new AcpRpcError(code, message, errObj.data));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // 2. Notification from Agent -> Client
    if (hasMethod && !hasId) {
      const method = msg.method as string;
      if (method === "session/update" && msg.params && typeof msg.params === "object") {
        const update = msg.params as SessionUpdateNotification;
        for (const listener of this.sessionUpdateListeners) {
          listener(update);
        }
      } else if (
        method === "_rayu/server_event" &&
        msg.params &&
        typeof msg.params === "object"
      ) {
        const event = msg.params as RayuServerEventNotification;
        for (const listener of this.rayuEventListeners) {
          listener(event);
        }
      }
      return;
    }

    // 3. Bidirectional request from Agent -> Client (e.g. session/request_permission)
    if (hasMethod && hasId) {
      const method = msg.method as string;
      const id = msg.id;
      try {
        if (method === "session/request_permission") {
          const result: RequestPermissionResult = this.permissionHandler
            ? await this.permissionHandler(msg.params as RequestPermissionParams)
            : { outcome: { outcome: "cancelled" } };
          if (!this.closed) {
            await this.writeMessage({ jsonrpc: "2.0", id, result });
          }
          return;
        }
        const customHandler = this.clientRequestHandlers.get(method);
        if (customHandler) {
          const result = await customHandler(msg.params);
          if (!this.closed) {
            await this.writeMessage({ jsonrpc: "2.0", id, result: result ?? {} });
          }
          return;
        }
        if (!this.closed) {
          await this.writeMessage({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Client does not implement ACP method: ${method}`,
            },
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!this.closed) {
          await this.writeMessage({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message },
          });
        }
      }
    }
  }

  private handleTransportClosed(reason?: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const error = reason ?? new Error("ACP transport closed");
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.closeListeners) {
      listener(reason);
    }
  }
}
