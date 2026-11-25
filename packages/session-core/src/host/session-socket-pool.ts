import type {
  HarnessFrameLike,
  SessionClientLike,
  SessionSocketPoolOptions,
} from "./types.js";

const ACTIVE_TURN_EVENTS = new Set([
  "turn_start",
  "text_delta",
  "reasoning_delta",
  "thinking_delta",
  "tool_start",
  "tool_input_delta",
  "tool_exec",
  "tool_call",
]);

const TERMINAL_TURN_EVENTS = new Set(["turn_done", "turn_stopped", "error"]);

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
  private focusedSessionId: string | null = null;
  private operationTail: Promise<unknown> = Promise.resolve();

  constructor(options: SessionSocketPoolOptions<TClient>) {
    this.maxIdleClients = Math.max(1, options.maxIdleClients ?? 6);
    this.dialClient = options.dialClient;
    this.onFrame = options.onFrame;
    this.onSessionClosed = options.onSessionClosed;
    this.onClientEvicted = options.onClientEvicted;
    this.disconnectMessage =
      options.disconnectMessage ?? "Connection to Rayu daemon lost.";
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
      const boundSessions = this.getBoundSessionIds(client);
      const rawSid =
        typeof rawFrame.session_id === "string" ? rawFrame.session_id.trim() : "";
      const resolvedSid =
        rawSid || (boundSessions.length === 1 ? boundSessions[0] : "");

      const frame: HarnessFrameLike =
        resolvedSid && !rawSid
          ? { ...rawFrame, session_id: resolvedSid }
          : rawFrame;

      const ev = typeof frame.ev === "string" ? frame.ev : "";
      if (resolvedSid) {
        if (ACTIVE_TURN_EVENTS.has(ev)) {
          this.activeTurnSessions.add(resolvedSid);
        } else if (ev === "permission_request") {
          this.pendingPermissionSessions.add(resolvedSid);
        } else if (ev === "permission_resolved") {
          this.pendingPermissionSessions.delete(resolvedSid);
        } else if (TERMINAL_TURN_EVENTS.has(ev)) {
          this.activeTurnSessions.delete(resolvedSid);
          this.pendingPermissionSessions.delete(resolvedSid);
        }
      }

      this.onFrame?.(frame, resolvedSid, client);

      if (resolvedSid && TERMINAL_TURN_EVENTS.has(ev)) {
        this.evictOverflowIdleClients();
      }
    });

    client.once("close", () => {
      const boundSessions = this.getBoundSessionIds(client);
      this.clientToSessions.delete(client);
      this.pinnedClients.delete(client);

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

  register(sessionId: string, client: TClient): void {
    if (!sessionId) return;
    this.bindListeners(client);

    const prevClient = this.sessionClients.get(sessionId);
    if (prevClient && prevClient !== client) {
      this.clientToSessions.get(prevClient)?.delete(sessionId);
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
      try {
        evictClient.close();
      } catch {
        // ignore close errors on evicted idle client
      }
    }
  }

  closeAll(): void {
    const clients = new Set<TClient>(this.sessionClients.values());
    this.sessionClients.clear();
    this.clientToSessions.clear();
    this.activeTurnSessions.clear();
    this.pendingPermissionSessions.clear();
    this.pinnedClients.clear();
    this.focusedSessionId = null;

    for (const client of clients) {
      try {
        client.close();
      } catch {
        // ignore close errors during shutdown
      }
    }
  }
}
