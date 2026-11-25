import {
  API_VERSION_MAJOR,
  HarnessError,
  RayucodeClient,
  type ApiEvent,
  type ImageAttachment,
  type PermissionDecision,
  type PermissionMode,
  type RuntimeCommand,
  type ServerFrame,
} from "@rayu-dev/rayucode-sdk";
import {
  fromHarnessPermissionMode,
  toHarnessPermissionMode,
  type PermissionModeId,
} from "../shared/vscodeProtocol.js";

interface SessionOptions {
  socketPath: () => string | undefined;
  chooseWorkspace: () => Promise<string>;
  sessions: () => readonly string[];
  selected: () => string | undefined;
  remember: (sessionId: string, created: boolean) => PromiseLike<void>;
  emit: (frame: ServerFrame) => void;
  defaultPermissionMode?: () => PermissionModeId | undefined;
}

function normalizePermissionDecision(raw: unknown): PermissionDecision {
  if (raw === "allow" || raw === "allow_once") return "allow";
  if (raw === "allow_always") return "allow_always";
  return "deny";
}

function normalizePermissionMode(raw: unknown): PermissionMode {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HarnessError("invalid_request", "Choose a valid permission mode.");
  }
  return toHarnessPermissionMode(fromHarnessPermissionMode(raw));
}

export class HarnessSession {
  private client?: RayucodeClient;
  private connectionGeneration = 0;
  private sessionId?: string;
  private permissionMode: PermissionMode = "default";
  private changingSession = false;
  private submitting = false;
  private turnActive = false;
  private disposed = false;

  constructor(private readonly options: SessionOptions) {
    const initialMode = this.options.defaultPermissionMode?.();
    if (initialMode) {
      this.permissionMode = toHarnessPermissionMode(initialMode);
    }
  }

  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  get currentPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  async setPermissionMode(mode: PermissionModeId | PermissionMode): Promise<void> {
    const wireMode = normalizePermissionMode(mode);
    this.permissionMode = wireMode;
    if (this.client && this.sessionId) {
      await this.client.setPermissionMode(this.sessionId, wireMode);
    }
  }

  async request(frame: Record<string, unknown>): Promise<ApiEvent> {
    switch (frame.req) {
      case "list_sessions": {
        const generation = this.connectionGeneration;
        const attached = this.client;
        const client = attached ?? await this.openConnection(generation);
        try {
          const includeArchived = typeof frame.include_archived === "boolean" ? frame.include_archived : undefined;
          const limit = typeof frame.limit === "number" ? frame.limit : undefined;
          const listed = await client.listSessions({ includeArchived, limit });
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
          if (this.client !== client) throw new HarnessError("disconnected", "The Rayu connection closed.");
          this.turnActive = true;
          const images = Array.isArray(frame.images) ? (frame.images as ImageAttachment[]) : undefined;
          const reminder = typeof frame.system_reminder === "string" ? frame.system_reminder : undefined;
          if (reminder) {
            await client.sendMessageWithReminder(sessionId, frame.content, images ?? [], reminder, {
              requireAccept: true,
            });
          } else {
            await client.sendMessage(sessionId, frame.content, {
              images,
              requireAccept: true,
            });
          }
        } catch (error) {
          this.turnActive = false;
          if (
            this.client === client &&
            error instanceof HarnessError &&
            (error.code === "timeout" || error.code === "disconnected")
          ) {
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
      case "soft_interrupt": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (typeof frame.content !== "string" || !frame.content.trim()) {
          throw new HarnessError("invalid_request", "Enter a follow-up message.");
        }
        await client.softInterruptWithId(sessionId, frame.content, {
          urgent: frame.urgent === true,
          clientId: typeof frame.client_id === "string" ? frame.client_id : undefined,
          images: Array.isArray(frame.images) ? (frame.images as ImageAttachment[]) : undefined,
        });
        return { ev: "ok" };
      }
      case "cancel_soft_interrupts": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (Array.isArray(frame.client_ids)) {
          const clientIds = frame.client_ids.filter((id): id is string => typeof id === "string");
          const res = await client.cancelSoftInterruptsById(sessionId, clientIds);
          return {
            ev: "soft_interrupts_cancelled",
            cancelled: res.cancelled,
            not_queued: res.notQueued,
          };
        }
        await client.cancelSoftInterrupts(sessionId);
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
      case "set_reasoning_effort": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (typeof frame.effort !== "string" || !frame.effort.trim()) {
          throw new HarnessError("invalid_request", "Choose a valid reasoning effort.");
        }
        await client.setReasoningEffort(sessionId, frame.effort);
        return { ev: "ok" };
      }
      case "set_permission_mode": {
        const { client, sessionId } = this.attached(frame.session_id);
        const mode = normalizePermissionMode(frame.mode);
        this.permissionMode = mode;
        await client.setPermissionMode(sessionId, mode);
        return { ev: "ok" };
      }
      case "permission_response": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (typeof frame.request_id !== "string" || !frame.request_id.trim()) {
          throw new HarnessError("invalid_request", "Missing permission request_id.");
        }
        const decision = normalizePermissionDecision(frame.decision);
        await client.respondToPermission(sessionId, frame.request_id, decision);
        return { ev: "ok" };
      }
      case "background_tool": {
        const { client, sessionId } = this.attached(frame.session_id);
        const result = await client.backgroundToolResult(sessionId);
        return {
          ev: "background_tool_result",
          moved: result.moved,
          tool_call_id: result.toolCallId,
          tool_name: result.toolName,
        };
      }
      case "runtime_command": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (typeof frame.command !== "string" || !frame.command.trim()) {
          throw new HarnessError("invalid_request", "Specify a runtime command.");
        }
        const args = Array.isArray(frame.args)
          ? frame.args.filter((arg): arg is string => typeof arg === "string")
          : [];
        const out = await client.runtimeCommand(sessionId, frame.command as RuntimeCommand, args);
        return {
          ev: "runtime_command_result",
          session_id: out.session_id,
          command: out.command,
          data: out.data,
          message: out.message,
        };
      }
      case "compact": {
        const { client, sessionId } = this.attached(frame.session_id);
        const message = await client.compact(sessionId);
        return { ev: "compacted", session_id: sessionId, message };
      }
      case "rewind": {
        const { client, sessionId } = this.attached(frame.session_id);
        if (typeof frame.message_index !== "number" || !Number.isInteger(frame.message_index)) {
          throw new HarnessError("invalid_request", "Provide a valid message_index to rewind.");
        }
        await client.rewind(sessionId, frame.message_index);
        return { ev: "ok" };
      }
      case "rewind_undo": {
        const { client, sessionId } = this.attached(frame.session_id);
        await client.rewindUndo(sessionId);
        return { ev: "ok" };
      }
      case "get_capabilities": {
        const generation = this.connectionGeneration;
        const attached = this.client;
        const client = attached ?? (await this.openConnection(generation));
        try {
          const targetSid =
            typeof frame.session_id === "string"
              ? frame.session_id
              : this.sessionId;
          const caps = await client.getCapabilities(targetSid);
          this.checkConnection(generation);
          if (!caps) {
            throw new HarnessError(
              "unsupported",
              "This Rayu daemon does not support capabilities_v1.",
            );
          }
          return {
            ev: "capabilities",
            commands: caps.commands,
            permission_modes: caps.permission_modes,
            features: caps.features,
          };
        } finally {
          if (!attached) void client.close();
        }
      }
      case "get_config": {
        const generation = this.connectionGeneration;
        const attached = this.client;
        const client = attached ?? (await this.openConnection(generation));
        try {
          const sections = Array.isArray(frame.sections)
            ? frame.sections.filter((s): s is string => typeof s === "string")
            : undefined;
          const state = await client.getConfig(sections);
          this.checkConnection(generation);
          if (!state) {
            throw new HarnessError(
              "unsupported",
              "This Rayu daemon does not support config_v1.",
            );
          }
          return {
            ev: "config_state",
            path: state.path,
            sections: state.sections,
            values: state.values,
            schema: state.schema,
          };
        } finally {
          if (!attached) void client.close();
        }
      }
      case "patch_config": {
        const generation = this.connectionGeneration;
        const attached = this.client;
        const client = attached ?? (await this.openConnection(generation));
        try {
          if (
            typeof frame.patch !== "object" ||
            frame.patch === null ||
            Array.isArray(frame.patch)
          ) {
            throw new HarnessError(
              "invalid_request",
              "Provide a valid config patch object.",
            );
          }
          const state = await client.patchConfig(
            frame.patch as Record<string, unknown>,
          );
          this.checkConnection(generation);
          return {
            ev: "config_state",
            path: state.path,
            sections: state.sections,
            values: state.values,
            schema: state.schema,
          };
        } finally {
          if (!attached) void client.close();
        }
      }
      case "ping": {
        const generation = this.connectionGeneration;
        const attached = this.client;
        const client = attached ?? await this.openConnection(generation);
        try {
          await client.ping();
          return { ev: "pong" };
        } finally {
          if (!attached) void client.close();
        }
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
      candidate = await this.openConnection(generation);
      const session = created
        ? await candidate.createSession({ workingDir })
        : await candidate.attachSession(target);
      this.checkConnection(generation);
      if (!created && session.session_id !== target) {
        throw new HarnessError("unexpected_reply", "Rayu returned a different session.");
      }
      await this.options.remember(session.session_id, created);
      this.checkConnection(generation);
      this.useClient(candidate);
      this.sessionId = session.session_id;
      if (typeof frame.permission_mode === "string") {
        const desiredMode = normalizePermissionMode(frame.permission_mode);
        this.permissionMode = desiredMode;
        if (candidate.supports("permissions")) {
          await candidate.setPermissionMode(session.session_id, desiredMode);
        }
      }
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
      clientName: "rayucode-vscode/3.0.0",
      supportsUserResponse: true,
      supportsPermissions: true,
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
      if (frame.ev === "permission_mode_changed" && typeof frame.mode === "string") {
        this.permissionMode = normalizePermissionMode(frame.mode);
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
