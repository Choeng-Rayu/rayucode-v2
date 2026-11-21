import { API_VERSION_MAJOR, HarnessError, RayucodeClient, type ApiEvent, type ServerFrame } from "@rayu-dev/rayucode-sdk";

interface SessionOptions {
  socketPath: () => string | undefined;
  chooseWorkspace: () => Promise<string>;
  sessions: () => readonly string[];
  selected: () => string | undefined;
  remember: (sessionId: string, created: boolean) => PromiseLike<void>;
  emit: (frame: ServerFrame) => void;
}

export class HarnessSession {
  private client?: RayucodeClient;
  private connectionGeneration = 0;
  private sessionId?: string;
  private changingSession = false;
  private submitting = false;
  private turnActive = false;
  private disposed = false;

  constructor(private readonly options: SessionOptions) {}

  async request(frame: Record<string, unknown>): Promise<ApiEvent> {
    switch (frame.req) {
      case "list_sessions": {
        const generation = this.connectionGeneration;
        const attached = this.client;
        const client = attached ?? await this.openConnection(generation);
        try {
          const listed = await client.listSessions();
          this.checkConnection(generation);
          const owned = new Set(this.options.sessions());
          const sessions = listed.filter((session) => owned.has(session.session_id));
          const selected = this.options.selected();
          const selectedIndex = sessions.findIndex((session) => session.session_id === selected);
          if (selectedIndex > 0) sessions.unshift(...sessions.splice(selectedIndex, 1));
          return { ev: "sessions", sessions };
        } finally {
          if (!attached) void client.close();
        }
      }
      case "create_session":
      case "attach_session":
        return this.attach(frame);
      case "get_history": {
        const { client, sessionId } = this.attached(frame.session_id);
        return { ev: "history", session_id: sessionId, ...await client.getHistoryWithImages(sessionId) };
      }
      case "get_runtime_info": {
        const { client, sessionId } = this.attached(frame.session_id);
        const info = await client.getRuntimeInfo(sessionId);
        return {
          ev: "runtime_info",
          session_id: sessionId,
          provider: info.provider,
          model: info.model,
          routes: info.routes,
        };
      }
      case "send_message": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (typeof frame.content !== "string" || !frame.content.trim() || frame.content.length > 100_000) {
          throw new HarnessError("invalid_request", "Enter a prompt of 1 to 100,000 characters.");
        }
        if (this.submitting || this.turnActive) {
          throw new HarnessError("busy", "Stop or finish the current turn before sending another prompt.");
        }
        this.submitting = true;
        try {
          // The preview has no interactive approval path. Require the runtime to
          // acknowledge an empty tool policy on this connection before each turn.
          await client.configureTools(sessionId, { enabled: [] });
          if (this.client !== client) throw new HarnessError("disconnected", "The Rayu connection closed.");
          this.turnActive = true;
          await client.sendMessage(sessionId, frame.content, { requireAccept: true });
        } catch (error) {
          this.turnActive = false;
          if (this.client === client && error instanceof HarnessError
              && (error.code === "timeout" || error.code === "disconnected")) {
            this.disconnect(true);
          }
          throw error;
        } finally {
          this.submitting = false;
        }
        return { ev: "ok" };
      }
      case "cancel": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (this.turnActive) await client.cancel(sessionId);
        return { ev: "ok" };
      }
      case "set_model": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (typeof frame.model !== "string" || !frame.model.trim() || frame.model.length > 512) {
          throw new HarnessError("invalid_request", "Choose an available model.");
        }
        await client.setModel(sessionId, frame.model);
        return { ev: "ok" };
      }
      default:
        throw new HarnessError("unknown_request", "This operation is unavailable in the VS Code preview.");
    }
  }

  private async attach(frame: Record<string, unknown>): Promise<ApiEvent> {
    if (this.changingSession || this.submitting || this.turnActive) {
      throw new HarnessError("busy", "Stop or finish the current turn before changing sessions.");
    }
    this.changingSession = true;
    const generation = this.connectionGeneration;
    let candidate: RayucodeClient | undefined;
    try {
      const created = frame.req === "create_session";
      const target = typeof frame.session_id === "string" ? frame.session_id : "";
      if (!created && !this.options.sessions().includes(target)) {
        throw new HarnessError("unknown_session", "Choose a session created by this VS Code workspace.");
      }
      const workingDir = created ? await this.options.chooseWorkspace() : undefined;
      // Keep the current attachment usable if the new attach or its initial
      // tool configuration fails after the daemon switches sessions.
      candidate = await this.openConnection(generation);
      const session = created
        ? await candidate.createSession({ workingDir, tools: { enabled: [] } })
        : await candidate.attachSession(target);
      this.checkConnection(generation);
      if (!created && session.session_id !== target) {
        throw new HarnessError("unexpected_reply", "Rayu returned a different session.");
      }
      await this.options.remember(session.session_id, created);
      this.checkConnection(generation);
      this.useClient(candidate);
      this.sessionId = session.session_id;
      return { ev: "attached", session };
    } finally {
      if (candidate && candidate !== this.client) void candidate.close();
      this.changingSession = false;
    }
  }

  private attached(id: unknown): { client: RayucodeClient; sessionId: string } {
    if (!this.client || !this.sessionId) {
      throw new HarnessError("disconnected", "Connect to Rayu and open a session before continuing.");
    }
    if (this.changingSession || id !== this.sessionId) {
      throw new HarnessError("unknown_session", "This request belongs to a different session.");
    }
    return { client: this.client, sessionId: this.sessionId };
  }

  private checkConnection(generation: number): void {
    if (this.disposed || this.connectionGeneration !== generation) {
      throw new HarnessError("disconnected", "The Rayu connection changed. Reconnect to continue.");
    }
  }

  private async openConnection(generation: number): Promise<RayucodeClient> {
    this.checkConnection(generation);
    const client = await RayucodeClient.connect({
      socketPath: this.options.socketPath(),
      clientName: "rayucode-vscode-preview",
      requestTimeoutMs: 15_000,
    });
    try {
      this.checkConnection(generation);
      return client;
    } catch (error) {
      void client.close();
      throw error;
    }
  }

  private useClient(client: RayucodeClient): void {
    const previous = this.client;
    this.client = client;
    void previous?.close();
    client.on("event", (frame: ServerFrame) => {
      if (this.client !== client || this.changingSession || !this.sessionId) return;
      if ("session_id" in frame && frame.session_id !== this.sessionId) return;
      if (frame.ev === "turn_done" || (frame.ev === "error" && frame.reply_to === undefined)) {
        this.turnActive = false;
      }
      this.options.emit(frame);
    });
    const lostConnection = () => {
      if (this.client === client) this.disconnect(true);
    };
    client.once("close", lostConnection);
    client.on("error", lostConnection);
  }

  private disconnect(notify = false) {
    this.connectionGeneration++;
    const client = this.client;
    const sessionId = this.sessionId;
    this.client = undefined;
    this.sessionId = undefined;
    this.turnActive = false;
    void client?.close();
    if (notify) {
      this.options.emit({
        v: API_VERSION_MAJOR,
        ev: "connection_phase",
        session_id: sessionId ?? "",
        phase: "disconnected",
      });
    }
  }

  resetConnection() {
    this.disconnect(true);
  }

  dispose() {
    this.disposed = true;
    this.disconnect();
  }
}
