import type {
  HarnessFrameLike,
  SessionClientLike,
  SessionSocketPoolOptions,
} from "./types.js";

const ACTIVE_TURN_EVENTS = new Set([
  "turn_start",
  "message_accepted",
  "soft_interrupt_injected",
  "text_delta",
  "reasoning_delta",
  "thinking_delta",
  "tool_start",
  "tool_input_delta",
  "tool_exec",
  "tool_call",
]);

const TERMINAL_TURN_EVENTS = new Set([
  "turn_done",
  "turn_stopped",
  "turn_aborted",
  "error",
]);

const GLOBAL_SESSIONLESS_EVENTS = new Set([
  "config_changed",
  "credential_updated",
  "models",
  "runtime_info",
]);

/**
 * Per-session daemon socket pool shared by Electron main and VS Code Extension Host.
 *
 * ```
 *  sessionClients (LRU map, target cap = maxIdleClients)
 *    ├── session A [activeTurnSessions]         -> protected from eviction
 *    ├── session B [pendingPermissionSessions]  -> protected from eviction
 *    ├── session C [focusedSessionId]           -> protected from eviction
 *    └── session D..H [idle]                    -> oldest idle evicted first
 *
 *  on socket close while active:
 *    synthesizes { ev: "turn_stopped", reason: "failure", session_id }
 *    so UI turns never hang forever.
 * ```
 */
export class SessionSocketPool<TClient extends SessionClientLike> {
  private readonly maxIdleClients: number;
  private readonly dialClient: () => Promise<TClient>;
  private readonly onFrame?: (
    frame: HarnessFrameLike,
    sessionId: string,
    client: TClient
  ) => void;
  private readonly onGlobalFrame?: (
    frame: HarnessFrameLike,
    client: TClient
  ) => void;
  private readonly onSessionClosed?: (
    sessionId: string,
    client: TClient,
    wasActiveTurn: boolean
  ) => void;
  private readonly onClientEvicted?: (sessionId: string, client: TClient) => void;
  private readonly disconnectMessage: string;

  private readonly sessionClients = new Map<string, TClient>();
  private readonly clientToSessions = new Map<TClient, Set<string>>();
  private readonly boundClients = new WeakSet<TClient>();
  private readonly activeTurnSessions = new Set<string>();
  private readonly pendingPermissionSessions = new Set<string>();
  private pinnedClients = new Set<TClient>();
  private primaryControlClient: TClient | null = null;
  private focusedSessionId: string | null = null;
  private operationTail: Promise<unknown> = Promise.resolve();

  constructor(options: SessionSocketPoolOptions<TClient>) {
    this.maxIdleClients = Math.max(1, options.maxIdleClients ?? 6);
    this.dialClient = options.dialClient;
    this.onFrame = options.onFrame;
    this.onGlobalFrame = options.onGlobalFrame;
    this.onSessionClosed = options.onSessionClosed;
    this.onClientEvicted = options.onClientEvicted;
    this.disconnectMessage =
      options.disconnectMessage ?? "Connection to Rayu daemon lost.";
  }

  setPrimaryControlClient(client: TClient | null): void {
    this.primaryControlClient = client;
  }

  runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(fn, fn);
    this.operationTail = next.catch(() => {});
    return next;
  }

  pinClient(client: TClient): void {
    this.pinnedClients.add(client);
  }

  unpinClient(client: TClient): void {
    this.pinnedClients.delete(client);
  }

  setFocusedSession(sessionId: string | null): void {
    this.focusedSessionId = sessionId;
    if (sessionId) {
      const existing = this.sessionClients.get(sessionId);
      if (existing) {
        this.sessionClients.delete(sessionId);
        this.sessionClients.set(sessionId, existing);
      }
    }
    this.evictOverflowIdleClients(sessionId ?? undefined);
  }

  getFocusedSession(): string | null {
    return this.focusedSessionId;
  }

  get(sessionId: string): TClient | undefined {
    return this.sessionClients.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessionClients.has(sessionId);
  }

  isClientBound(client: TClient): boolean {
    const sessions = this.clientToSessions.get(client);
    return Boolean(sessions && sessions.size > 0);
  }

  getBoundSessionIds(client: TClient): string[] {
    return Array.from(this.clientToSessions.get(client) ?? []);
  }

  getActiveTurnSessionIds(): string[] {
    return Array.from(this.activeTurnSessions);
  }

  getPendingPermissionSessionIds(): string[] {
    return Array.from(this.pendingPermissionSessions);
  }

  size(): number {
    return this.sessionClients.size;
  }

  markTurnActive(sessionId: string): void {
    if (!sessionId) return;
    this.activeTurnSessions.add(sessionId);
  }

  markTurnSettled(sessionId: string): void {
    if (!sessionId) return;
    this.activeTurnSessions.delete(sessionId);
    this.pendingPermissionSessions.delete(sessionId);
    this.evictOverflowIdleClients();
  }

  markPermissionPending(sessionId: string, pending: boolean): void {
    if (!sessionId) return;
    if (pending) {
      this.pendingPermissionSessions.add(sessionId);
    } else {
      this.pendingPermissionSessions.delete(sessionId);
      this.evictOverflowIdleClients();
    }
  }

  bindListeners(client: TClient): void {
    if (this.boundClients.has(client)) return;
    this.boundClients.add(client);

    client.on("event", (rawFrame: HarnessFrameLike) => {
      const evRaw = typeof rawFrame.ev === "string" ? rawFrame.ev : "";
      const boundSessions = this.getBoundSessionIds(client);
      const rawSid =
        typeof rawFrame.session_id === "string" ? rawFrame.session_id.trim() : "";

      // Never stamp a synthetic session_id onto global bridge-wide broadcasts
      // (such as `config_changed`, `credential_updated`, `models`, `runtime_info`).
      // Forward them once from the designated primary control client (if set)
      // and suppress duplicates from pooled session sockets.
      if (!rawSid && GLOBAL_SESSIONLESS_EVENTS.has(evRaw)) {
        if (this.primaryControlClient === client) {
          this.onGlobalFrame?.(rawFrame, client);
        }
        return;
      }

      const resolvedSid =
        rawSid || (boundSessions.length === 1 ? boundSessions[0] : "");

      // Ignore unsolicited sessionless frames (for example a delayed
      // "daemon connection closed" error) on an unbound socket that never
      // completed attach/create; forwarding them without a session_id causes
      // downstream handlers to abort whichever unrelated session is focused.
      if (!resolvedSid && boundSessions.length === 0) {
        return;
      }

      const frame: HarnessFrameLike =
        resolvedSid && !rawSid
          ? { ...rawFrame, session_id: resolvedSid }
          : rawFrame;

      const ev = typeof frame.ev === "string" ? frame.ev : "";
      const isReplyFrame = frame.reply_to !== undefined;
      const statusText =
        ev === "session_status" && typeof frame.status === "string"
          ? frame.status.trim().toLowerCase()
          : "";
      const isSessionStatusRunning =
        statusText === "running" ||
        statusText === "processing" ||
        statusText === "busy" ||
        statusText === "generating" ||
        statusText === "tool_running";
      const isSessionStatusIdle = statusText === "idle";
      const isTerminalEvent =
        (!isReplyFrame && TERMINAL_TURN_EVENTS.has(ev)) || isSessionStatusIdle;

      if (resolvedSid) {
        if (ACTIVE_TURN_EVENTS.has(ev) || isSessionStatusRunning) {
          this.activeTurnSessions.add(resolvedSid);
        } else if (ev === "permission_request") {
          this.pendingPermissionSessions.add(resolvedSid);
        } else if (ev === "permission_resolved") {
          this.pendingPermissionSessions.delete(resolvedSid);
        } else if (isTerminalEvent) {
          this.activeTurnSessions.delete(resolvedSid);
          this.pendingPermissionSessions.delete(resolvedSid);
        }
      }

      this.onFrame?.(frame, resolvedSid, client);

      if (resolvedSid && isTerminalEvent) {
        this.evictOverflowIdleClients();
      }
    });

    client.once("close", () => {
      const boundSessions = this.getBoundSessionIds(client);
      this.clientToSessions.delete(client);
      this.pinnedClients.delete(client);
      if (this.primaryControlClient === client) {
        this.primaryControlClient = null;
      }

      for (const sid of boundSessions) {
        if (this.sessionClients.get(sid) === client) {
          this.sessionClients.delete(sid);
        }
        const wasActive =
          this.activeTurnSessions.has(sid) ||
          this.pendingPermissionSessions.has(sid);
        this.activeTurnSessions.delete(sid);
        this.pendingPermissionSessions.delete(sid);

        if (wasActive) {
          this.onFrame?.(
            {
              ev: "turn_stopped",
              reason: "failure",
              session_id: sid,
              message: this.disconnectMessage,
            },
            sid,
            client
          );
        }
        this.onSessionClosed?.(sid, client, wasActive);
      }
    });

    client.on("error", (err: unknown) => {
      const boundSessions = this.getBoundSessionIds(client);
      const message =
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : typeof err === "string" && err.trim()
            ? err.trim()
            : this.disconnectMessage;

      for (const sid of boundSessions) {
        if (
          this.activeTurnSessions.has(sid) ||
          this.pendingPermissionSessions.has(sid)
        ) {
          this.activeTurnSessions.delete(sid);
          this.pendingPermissionSessions.delete(sid);
          this.onFrame?.(
            {
              ev: "error",
              session_id: sid,
              message,
            },
            sid,
            client
          );
        }
      }
    });
  }

  private closeClientSafely(client: TClient, detachSessionId?: string): void {
    const closeNow = () => {
      try {
        client.close();
      } catch {
        // ignore close errors during teardown/eviction
      }
    };
    if (detachSessionId && typeof client.detachSession === "function") {
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          closeNow();
        }
      }, 300);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
      void client
        .detachSession(detachSessionId)
        .catch(() => {})
        .finally(() => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            closeNow();
          }
        });
      return;
    }
    closeNow();
  }

  register(sessionId: string, client: TClient): void {
    if (!sessionId) return;
    this.bindListeners(client);

    const prevClient = this.sessionClients.get(sessionId);
    if (prevClient && prevClient !== client) {
      const prevSet = this.clientToSessions.get(prevClient);
      prevSet?.delete(sessionId);
      if ((prevSet?.size ?? 0) === 0) {
        this.clientToSessions.delete(prevClient);
        if (!this.pinnedClients.has(prevClient)) {
          this.closeClientSafely(prevClient, sessionId);
        }
      }
    }

    this.sessionClients.delete(sessionId);
    this.sessionClients.set(sessionId, client);

    let set = this.clientToSessions.get(client);
    if (!set) {
      set = new Set<string>();
      this.clientToSessions.set(client, set);
    }
    set.add(sessionId);

    this.evictOverflowIdleClients(sessionId);
  }

  async acquireForSession(
    sessionId: string,
    reuseCandidate?: TClient | null
  ): Promise<{ client: TClient; reused: boolean }> {
    const pooled = this.sessionClients.get(sessionId);
    if (pooled) {
      this.register(sessionId, pooled);
      return { client: pooled, reused: true };
    }

    if (reuseCandidate && !this.isClientBound(reuseCandidate)) {
      this.bindListeners(reuseCandidate);
      return { client: reuseCandidate, reused: false };
    }

    const fresh = await this.dialClient();
    this.bindListeners(fresh);
    return { client: fresh, reused: false };
  }

  async dialFreshClient(): Promise<TClient> {
    const fresh = await this.dialClient();
    this.bindListeners(fresh);
    return fresh;
  }

  evictOverflowIdleClients(protectedSessionId?: string): void {
    while (this.sessionClients.size > this.maxIdleClients) {
      let evictKey: string | null = null;
      let evictClient: TClient | null = null;

      for (const [sid, candidate] of this.sessionClients) {
        if (sid === protectedSessionId) continue;
        if (sid === this.focusedSessionId) continue;
        if (this.activeTurnSessions.has(sid)) continue;
        if (this.pendingPermissionSessions.has(sid)) continue;
        if (this.pinnedClients.has(candidate)) continue;
        const boundSet = this.clientToSessions.get(candidate);
        if (boundSet && boundSet.size > 1) continue;

        evictKey = sid;
        evictClient = candidate;
        break;
      }

      if (!evictKey || !evictClient) {
        break;
      }

      this.sessionClients.delete(evictKey);
      this.clientToSessions.get(evictClient)?.delete(evictKey);
      if ((this.clientToSessions.get(evictClient)?.size ?? 0) === 0) {
        this.clientToSessions.delete(evictClient);
      }
      this.onClientEvicted?.(evictKey, evictClient);
      this.closeClientSafely(evictClient, evictKey);
    }
  }

  closeAll(): void {
    const entries = Array.from(this.sessionClients.entries());
    const closedClients = new Set<TClient>();
    this.sessionClients.clear();
    this.clientToSessions.clear();
    this.activeTurnSessions.clear();
    this.pendingPermissionSessions.clear();
    this.pinnedClients.clear();
    this.primaryControlClient = null;
    this.focusedSessionId = null;

    for (const [sid, client] of entries) {
      if (closedClients.has(client)) continue;
      closedClients.add(client);
      this.closeClientSafely(client, sid);
    }
  }
}
