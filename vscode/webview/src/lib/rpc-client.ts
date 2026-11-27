import {
  parseHostToWebviewMessage,
  type HostToWebviewMessage,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type SurfaceKind,
  type WebviewToHostMessage,
} from "@shared/vscodeProtocol";

import { handleMockHostMessage } from "./mock-vscode-bridge";

export interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeWebviewApi;
  }
}

export class RpcError extends Error {
  readonly code: string;
  readonly method: RpcMethod;

  constructor(method: RpcMethod, code: string, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.method = method;
  }
}

interface PendingRpc {
  method: RpcMethod;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

let cachedVsCodeApi: VsCodeWebviewApi | null = null;
let cachedAcquireFn: (() => VsCodeWebviewApi) | undefined;
let nextRequestId = 1;
let listenerBound = false;

const pendingRequests = new Map<number, PendingRpc>();
const hostMessageListeners = new Set<(msg: HostToWebviewMessage) => void>();
const harnessFrameListeners = new Set<(frame: Record<string, unknown>) => void>();

function getVsCodeApi(): VsCodeWebviewApi | null {
  const fn =
    typeof window !== "undefined" &&
    typeof window.acquireVsCodeApi === "function"
      ? window.acquireVsCodeApi
      : undefined;
  if (!fn) {
    cachedVsCodeApi = null;
    cachedAcquireFn = undefined;
    return null;
  }
  if (cachedAcquireFn === fn && cachedVsCodeApi) {
    return cachedVsCodeApi;
  }
  try {
    cachedAcquireFn = fn;
    cachedVsCodeApi = fn();
    return cachedVsCodeApi;
  } catch {
    cachedVsCodeApi = null;
    return null;
  }
}

export function isVsCodeWebview(): boolean {
  return getVsCodeApi() !== null;
}

export function getWebviewState<T = unknown>(): T | undefined {
  return getVsCodeApi()?.getState<T>();
}

export function setWebviewState<T = unknown>(state: T): void {
  getVsCodeApi()?.setState(state);
}

function dispatchHostMessage(msg: HostToWebviewMessage): void {
  if (msg.type === "rayucode.rpc.result") {
    const pending = pendingRequests.get(msg.id);
    if (pending) {
      pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.ok) {
        pending.resolve(msg.data);
      } else {
        pending.reject(new RpcError(pending.method, msg.code, msg.error));
      }
    }
  } else if (msg.type === "rayucode.harness.frame") {
    for (const listener of harnessFrameListeners) {
      listener(msg.frame);
    }
  }

  for (const listener of hostMessageListeners) {
    listener(msg);
  }
}

function ensureWindowListener(): void {
  if (listenerBound || typeof window === "undefined") return;
  listenerBound = true;
  window.addEventListener("message", (event: MessageEvent) => {
    const parsed = parseHostToWebviewMessage(event.data);
    if (!parsed.success) return;
    dispatchHostMessage(parsed.data);
  });
}

export function postToHost(msg: WebviewToHostMessage): void {
  ensureWindowListener();
  const api = getVsCodeApi();
  if (api) {
    api.postMessage(msg);
    return;
  }
  handleMockHostMessage(msg, dispatchHostMessage);
}

export function callRpc<M extends RpcMethod>(
  method: M,
  params?: RpcParams<M>,
  options?: { timeoutMs?: number },
): Promise<RpcResult<M>> {
  ensureWindowListener();
  const id = nextRequestId;
  nextRequestId += 1;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

  return new Promise<RpcResult<M>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new RpcError(
          method,
          "RPC_TIMEOUT",
          `RPC call "${method}" timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    pendingRequests.set(id, {
      method,
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });

    postToHost({
      type: "rayucode.rpc.call",
      id,
      method,
      params,
    });
  });
}

export function sendHarnessRequest(frame: Record<string, unknown>): void {
  postToHost({
    type: "rayucode.harness.request",
    frame,
  });
}

export async function submitHarnessMessage(frame: Record<string, unknown>): Promise<void> {
  if (!isVsCodeWebview()) {
    sendHarnessRequest(frame);
    return;
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const stop = onHarnessFrame((reply) => {
      if (reply.reply_to !== id || (reply.ev !== "ok" && reply.ev !== "error")) return;
      clearTimeout(timer);
      stop();
      if (reply.ev === "error") {
        reject(new Error(typeof reply.message === "string" ? reply.message : "Rayu could not submit the prompt."));
      } else {
        resolve();
      }
    });
    const timer = setTimeout(() => {
      stop();
      reject(new Error("Rayu could not confirm this prompt. Review session history before retrying."));
    }, 90_000);
    sendHarnessRequest({ ...frame, id });
  });
}

export function onHostMessage(
  listener: (msg: HostToWebviewMessage) => void,
): () => void {
  ensureWindowListener();
  hostMessageListeners.add(listener);
  return () => {
    hostMessageListeners.delete(listener);
  };
}

export function onHarnessFrame(
  listener: (frame: Record<string, unknown>) => void,
): () => void {
  ensureWindowListener();
  harnessFrameListeners.add(listener);
  return () => {
    harnessFrameListeners.delete(listener);
  };
}

export function signalWebviewReady(surface: SurfaceKind): void {
  postToHost({
    type: "rayucode.webview.ready",
    surface,
  });
}

/** Test utility to inject a synthetic host message into subscribers. */
export function __dispatchHostMessageForTest(msg: HostToWebviewMessage): void {
  dispatchHostMessage(msg);
}
