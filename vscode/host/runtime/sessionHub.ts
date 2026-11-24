import { EventEmitter } from "node:events";
import * as vscode from "vscode";
import {
  API_VERSION_MAJOR,
  HarnessError,
  RayuCreditsAccumulator,
  RayucodeClient,
  type AppletInstance,
  type ImageAttachment,
  type PermissionDecision,
  type RuntimeCommand,
  type ServerFrame,
  type SessionInfo,
  type SidePanelPage,
  type TodoSnapshot,
} from "@rayu-dev/rayucode-sdk";
import {
  fromHarnessPermissionMode,
  toHarnessPermissionMode,
  type AccountStatusView,
  type AppletStateView,
  type BackgroundProcessView,
  type FileChangeActionKind,
  type FileChangeActionResultView,
  type FileChangesSnapshotView,
  type FileDiffView,
  type HistoryImageView,
  type HistoryMessageView,
  type HostToWebviewMessage,
  type PermissionModeId,
  type SessionHistoryView,
  type SessionSummaryView,
  type SidePanelPageView,
  type SurfaceKind,
  type TodoItemView,
} from "../../shared/vscodeProtocol.js";
import type { GitChangesBridge } from "../bridges/gitChangesBridge.js";
import type { BridgeManager } from "./bridgeManager.js";
import {
  buildQuestionResponseWire,
  emptyFileChangesSnapshot,
  mapRawBackgroundTask,
  mapRawFileChangeActionResponse,
  mapRawFileChangeDiff,
  mapRawFileChangesSnapshot,
  mapRawHistoryMessage,
  normalizeHarnessRequestFrame,
  normalizeImageAttachments,
} from "./featureRouters.js";

export {
  buildQuestionResponseWire as buildQuestionResponsePayload,
  mapRawBackgroundTask,
  normalizeHarnessRequestFrame,
  normalizeImageAttachments,
};

const PINNED_SESSIONS_KEY = "rayucode.sessions.pinned";
const ARCHIVED_SESSIONS_KEY = "rayucode.sessions.archived";
const PERMISSION_MODES_KEY = "rayucode.sessions.permissionModes";
const ACTIVE_SESSION_KEY = "rayucode.sessions.activeSessionId";

interface RegisteredSurface {
  id: string;
  surface: SurfaceKind;
  postMessage: (message: HostToWebviewMessage) => void;
}

export class SessionHub extends EventEmitter implements vscode.Disposable {
  private readonly surfaces = new Map<string, RegisteredSurface>();
  private readonly backgroundTasks = new Map<string, BackgroundProcessView>();
  private readonly sidePanelsBySession = new Map<
    string,
    { pages: SidePanelPageView[]; activePageId?: string }
  >();
  private readonly appletsBySession = new Map<string, AppletStateView[]>();
  private readonly todosBySession = new Map<string, TodoItemView[]>();
  private readonly fileChangesBySession = new Map<
    string,
    FileChangesSnapshotView
  >();
  private readonly creditsAccumulator = new RayuCreditsAccumulator();

  private sessionClient: RayucodeClient | null = null;
  private activeSessionId: string | undefined;
  private activeModel: string | undefined;
  private activeProvider: string | undefined;
  private activePermissionMode: PermissionModeId;
  private backgroundPollTimer: ReturnType<typeof setInterval> | null = null;
  private attachChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly bridgeManager: BridgeManager,
    private readonly gitBridge: GitChangesBridge,
  ) {
    super();
    this.activeSessionId = this.context.workspaceState.get<string>(ACTIVE_SESSION_KEY);
    this.activePermissionMode = this.getDefaultPermissionMode();

    this.bridgeManager.on("statusChanged", (status) => {
      this.broadcast({ type: "rayucode.daemon.statusChanged", status });
      this.emit("stateChanged");
    });

    this.bridgeManager.on("connected", () => {
      if (this.activeSessionId && !this.sessionClient) {
        void this.attachSession(this.activeSessionId).catch(() => {});
      }
    });

    this.bridgeManager.on("frame", (frame: ServerFrame) => {
      if (!this.sessionClient) {
        this.ingestFrame(frame);
      }
    });
  }

  getDefaultPermissionMode(): PermissionModeId {
    const raw = vscode.workspace
      .getConfiguration("rayucode")
      .get<string>("defaultPermissionMode", "default");
    return fromHarnessPermissionMode(raw);
  }

  getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  getActiveModel(): string | undefined {
    return this.activeModel;
  }

  getActiveProvider(): string | undefined {
    return this.activeProvider;
  }

  getActivePermissionMode(): PermissionModeId {
    return this.activePermissionMode;
  }

  getTotalSessionCredits(): number | undefined {
    return this.creditsAccumulator.totalCredits;
  }

  getBackgroundTasks(): BackgroundProcessView[] {
    return [...this.backgroundTasks.values()].sort(
      (a, b) => b.updatedAtMs - a.updatedAtMs,
    );
  }

  getSidePanelState(sessionId: string): {
    pages: SidePanelPageView[];
    activePageId?: string;
  } {
    return (
      this.sidePanelsBySession.get(sessionId) ?? {
        pages: [],
        activePageId: undefined,
      }
    );
  }

  closeSidePanelPage(sessionId: string, pageId?: string): void {
    const current = this.sidePanelsBySession.get(sessionId);
    if (!current) return;
    if (!pageId) {
      this.sidePanelsBySession.set(sessionId, { pages: [], activePageId: undefined });
      return;
    }
    const pages = current.pages.filter((p) => p.id !== pageId);
    const activePageId =
      current.activePageId === pageId ? pages[0]?.id : current.activePageId;
    this.sidePanelsBySession.set(sessionId, { pages, activePageId });
  }

  getApplets(sessionId: string): AppletStateView[] {
    return this.appletsBySession.get(sessionId) ?? [];
  }

  getCachedTodos(sessionId: string): TodoItemView[] {
    return this.todosBySession.get(sessionId) ?? [];
  }

  getFileChangesSnapshot(sessionId: string): FileChangesSnapshotView | undefined {
    return this.fileChangesBySession.get(sessionId);
  }

  broadcastFileChanges(
    sessionId: string,
    snapshot: FileChangesSnapshotView,
  ): void {
    this.fileChangesBySession.set(sessionId, snapshot);
    this.broadcast({
      type: "rayucode.fileChanges.updated",
      sessionId,
      snapshot,
    });
    this.emit("fileChangesUpdated", { sessionId, snapshot });
  }

  private clientSupportsFileChanges(client: RayucodeClient): boolean {
    if (typeof client.supports === "function") {
      return client.supports("file_changes");
    }
    return this.bridgeManager.getStatus().capabilities.includes("file_changes");
  }

  private resolveTrackedFilePath(sessionId: string, filePath: string): string {
    const cached = this.fileChangesBySession.get(sessionId);
    const matched = cached?.files.find(
      (f) => f.path === filePath || f.displayPath === filePath,
    );
    return matched?.path ?? filePath;
  }

  async fetchFileChanges(
    sessionId?: string,
  ): Promise<FileChangesSnapshotView | null> {
    const sid = sessionId ?? this.activeSessionId;
    if (!sid) return null;
    try {
      const client = await this.getClient();
      if (!this.clientSupportsFileChanges(client)) {
        return this.fileChangesBySession.get(sid) ?? null;
      }
      const raw = await client.getFileChanges(sid);
      const snapshot = mapRawFileChangesSnapshot(raw, sid);
      this.fileChangesBySession.set(sid, snapshot);
      return snapshot;
    } catch {
      return this.fileChangesBySession.get(sid) ?? null;
    }
  }

  async getFileChangeDiff(
    sessionId: string,
    filePath: string,
  ): Promise<FileDiffView | null> {
    const client = await this.getClient();
    if (!this.clientSupportsFileChanges(client)) {
      return null;
    }
    const targetPath = this.resolveTrackedFilePath(sessionId, filePath);
    const raw = await client.getFileChangeDiff(sessionId, targetPath);
    return mapRawFileChangeDiff(raw, filePath);
  }

  async runFileChangeAction(
    sessionId: string,
    action: FileChangeActionKind,
    opts?: { path?: string; force?: boolean },
  ): Promise<FileChangeActionResultView | null> {
    const client = await this.getClient();
    if (!this.clientSupportsFileChanges(client)) {
      return null;
    }
    const targetPath =
      opts?.path !== undefined
        ? this.resolveTrackedFilePath(sessionId, opts.path)
        : undefined;
    const raw = await client.fileChangeAction(sessionId, action, {
      ...(targetPath !== undefined ? { path: targetPath } : {}),
      ...(opts?.force !== undefined ? { force: opts.force } : {}),
    });
    const mapped = mapRawFileChangeActionResponse(raw, sessionId);
    if (mapped.snapshot) {
      this.broadcastFileChanges(sessionId, mapped.snapshot);
    }
    return mapped;
  }

  registerSurface(
    id: string,
    surface: SurfaceKind,
    postMessage: (message: HostToWebviewMessage) => void,
  ): vscode.Disposable {
    this.surfaces.set(id, { id, surface, postMessage });
    return new vscode.Disposable(() => {
      this.surfaces.delete(id);
    });
  }

  broadcast(message: HostToWebviewMessage): void {
    for (const surface of this.surfaces.values()) {
      try {
        surface.postMessage(message);
      } catch {
        // ignore disposed surface
      }
    }
  }

  broadcastAccountChanged(account: AccountStatusView): void {
    this.broadcast({
      type: "rayucode.account.changed",
      account,
    });
  }

  async notifyDaemonAuthChanged(provider = "rayu"): Promise<void> {
    const client = this.sessionClient ?? this.bridgeManager.getActiveClient();
    if (!client) return;
    await client.notifyAuthChanged(provider).catch(() => {});
  }

  /**
   * Return the attached session client if bound, otherwise the primary control client.
   */
  async getClient(): Promise<RayucodeClient> {
    if (this.sessionClient) return this.sessionClient;
    return this.bridgeManager.ensureConnected();
  }

  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.attachChain.then(fn, fn);
    this.attachChain = next.catch(() => {});
    return next;
  }

  private bindSessionClient(client: RayucodeClient): void {
    const previous = this.sessionClient;
    this.sessionClient = client;
    if (previous && previous !== client && previous !== this.bridgeManager.getActiveClient()) {
      void previous.close();
    }

    client.on("event", (frame: ServerFrame) => {
      if (this.sessionClient !== client) return;
      this.ingestFrame(frame);
    });

    const onClose = () => {
      if (this.sessionClient !== client) return;
      this.sessionClient = null;
    };
    client.once("close", onClose);
  }

  private ingestFrame(frame: ServerFrame): void {
    switch (frame.ev) {
      case "permission_mode_changed": {
        if (typeof frame.mode === "string") {
          const uiMode = fromHarnessPermissionMode(frame.mode);
          this.activePermissionMode = uiMode;
          if (typeof frame.session_id === "string") {
            void this.saveSessionPermissionMode(frame.session_id, uiMode);
          }
          this.emit("stateChanged");
        }
        break;
      }
      case "model_info":
      case "runtime_info": {
        if (typeof frame.model === "string") {
          this.activeModel = frame.model;
        }
        if (typeof frame.provider === "string") {
          this.activeProvider = frame.provider;
        }
        this.emit("stateChanged");
        break;
      }
      case "rayu_credits": {
        if (typeof frame.turn_credits === "number") {
          this.creditsAccumulator.syncTurnTotal(frame.turn_credits);
        } else if (typeof frame.credits === "number") {
          this.creditsAccumulator.recordCredits(frame.credits);
        }
        this.emit("stateChanged");
        break;
      }
      case "background_progress": {
        const existing =
          typeof frame.task_id === "string"
            ? this.backgroundTasks.get(frame.task_id)
            : undefined;
        const mapped = mapRawBackgroundTask(
          {
            ...existing,
            ...frame,
          },
          this.activeSessionId,
        );
        this.backgroundTasks.set(mapped.taskId, mapped);
        this.broadcastProcessesSnapshot();
        this.syncBackgroundPollTimer();
        break;
      }
      case "side_panel_state": {
        if (typeof frame.session_id === "string" && frame.snapshot && typeof frame.snapshot === "object") {
          const snapshot = frame.snapshot as {
            focused_page_id?: string | null;
            pages?: SidePanelPage[];
          };
          const pages: SidePanelPageView[] = (snapshot.pages ?? []).map((p) => ({
            id: p.id,
            title: p.title,
            kind: p.format === "pdf" ? "pdf" : "markdown",
            content: p.content,
            filePath: p.file_path,
            updatedAtMs: p.updated_at_ms,
          }));
          this.sidePanelsBySession.set(frame.session_id, {
            pages,
            activePageId: snapshot.focused_page_id ?? pages[0]?.id,
          });
        }
        break;
      }
      case "applet_state": {
        if (typeof frame.session_id === "string" && frame.snapshot && typeof frame.snapshot === "object") {
          const snapshot = frame.snapshot as { instances?: AppletInstance[] };
          const applets: AppletStateView[] = (snapshot.instances ?? []).map((inst) => ({
            appletId: inst.id,
            title: inst.document?.title ?? inst.applet,
            kind: inst.applet,
            state: inst.document?.state ?? {},
            schema: inst.document?.view,
            updatedAtMs: Date.now(),
          }));
          this.appletsBySession.set(frame.session_id, applets);
        }
        break;
      }
      case "todo_state": {
        if (typeof frame.session_id === "string" && frame.state && typeof frame.state === "object") {
          const todos = this.mapTodoSnapshot(frame.state as TodoSnapshot);
          this.todosBySession.set(frame.session_id, todos);
        }
        break;
      }
      case "file_changes_state": {
        const sid =
          typeof frame.session_id === "string"
            ? frame.session_id
            : this.activeSessionId;
        if (sid && frame.snapshot && typeof frame.snapshot === "object") {
          const snapshot = mapRawFileChangesSnapshot(frame.snapshot, sid);
          this.broadcastFileChanges(sid, snapshot);
        }
        break;
      }
      case "tool_done": {
        if (
          typeof frame.session_id === "string" &&
          typeof frame.name === "string" &&
          !frame.error &&
          ["edit_file", "write_file", "multi_edit", "apply_patch"].includes(frame.name)
        ) {
          this.emit("filesChanged", frame.session_id);
        }
        break;
      }
    }

    this.broadcast({
      type: "rayucode.harness.frame",
      frame: frame as Record<string, unknown>,
    });
  }

  mapTodoSnapshot(snapshot: TodoSnapshot): TodoItemView[] {
    return (snapshot.todos ?? []).map((item) => {
      const rawStatus = String(item.status ?? "pending").toLowerCase();
      const status =
        rawStatus === "completed" || rawStatus === "done"
          ? "completed"
          : rawStatus === "in_progress" || rawStatus === "running"
            ? "in_progress"
            : "pending";
      return {
        content: String(item.content ?? item.title ?? ""),
        status,
        activeForm:
          typeof item.activeForm === "string"
            ? item.activeForm
            : typeof item.active_form === "string"
              ? item.active_form
              : undefined,
      };
    });
  }

  private getPinnedMap(): Record<string, boolean> {
    return this.context.workspaceState.get<Record<string, boolean>>(PINNED_SESSIONS_KEY, {});
  }

  private getArchivedMap(): Record<string, boolean> {
    return this.context.workspaceState.get<Record<string, boolean>>(ARCHIVED_SESSIONS_KEY, {});
  }

  private getPermissionModesMap(): Record<string, PermissionModeId> {
    return this.context.workspaceState.get<Record<string, PermissionModeId>>(
      PERMISSION_MODES_KEY,
      {},
    );
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    const map = { ...this.getPinnedMap(), [sessionId]: pinned };
    await this.context.workspaceState.update(PINNED_SESSIONS_KEY, map);
    const client = await this.getClient().catch(() => null);
    if (client) {
      await client.setSessionSaved(sessionId, pinned).catch(() => {});
    }
  }

  async setSessionArchived(sessionId: string, archived: boolean): Promise<void> {
    const map = { ...this.getArchivedMap(), [sessionId]: archived };
    await this.context.workspaceState.update(ARCHIVED_SESSIONS_KEY, map);
    const client = await this.getClient().catch(() => null);
    if (client) {
      if (archived) {
        await client.archiveSession(sessionId).catch(() => {});
      } else {
        await client.restoreSession(sessionId).catch(() => {});
      }
    }
  }

  private async saveSessionPermissionMode(
    sessionId: string,
    mode: PermissionModeId,
  ): Promise<void> {
    const map = { ...this.getPermissionModesMap(), [sessionId]: mode };
    await this.context.workspaceState.update(PERMISSION_MODES_KEY, map);
  }

  mapSessionInfoToSummary(info: SessionInfo): SessionSummaryView {
    const pinnedMap = this.getPinnedMap();
    const archivedMap = this.getArchivedMap();
    const permMap = this.getPermissionModesMap();
    const rawStatus = (info.status ?? "idle").toLowerCase();
    const status =
      rawStatus === "running" || rawStatus === "busy"
        ? "running"
        : rawStatus === "waiting" || rawStatus === "permission"
          ? "waiting"
          : rawStatus === "error" || rawStatus === "failed"
            ? "error"
            : "idle";

    return {
      sessionId: info.session_id,
      title: info.save_label || info.title || info.agent_label || "Untitled session",
      workingDir: info.working_dir,
      status,
      model: info.session_id === this.activeSessionId ? this.activeModel : undefined,
      provider: info.session_id === this.activeSessionId ? this.activeProvider : undefined,
      permissionMode: permMap[info.session_id] ?? this.activePermissionMode,
      updatedAtMs: info.updated_at_ms ?? info.last_active_at_ms ?? Date.now(),
      pinned: pinnedMap[info.session_id] ?? info.saved ?? false,
      archived: archivedMap[info.session_id] ?? info.archived ?? false,
      diffAdditions: info.edit_stats?.added,
      diffDeletions: info.edit_stats?.removed,
      sourceTool: "rayu",
    };
  }

  async listSessions(includeArchived = false): Promise<{
    sessions: SessionSummaryView[];
    activeSessionId?: string;
  }> {
    const client = await this.getClient();
    const rawList = await client.listSessions({ includeArchived, limit: 100 });
    const summaries = rawList
      .map((info) => this.mapSessionInfoToSummary(info))
      .filter((s) => includeArchived || !s.archived)
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) {
          return a.pinned ? -1 : 1;
        }
        return b.updatedAtMs - a.updatedAtMs;
      });
    return {
      sessions: summaries,
      activeSessionId: this.activeSessionId,
    };
  }

  /**
   * Create a new session WITHOUT disabling tools (`configureTools({ enabled: [] })` is removed)
   * and wire Harness API v1.14 `setPermissionMode`.
   */
  async createSession(options: {
    workingDir?: string;
    permissionMode?: PermissionModeId;
    model?: string;
  } = {}): Promise<SessionSummaryView> {
    return this.runSerialized(async () => {
      const defaultDir =
        options.workingDir ??
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        process.cwd();
      const client = await this.bridgeManager.dialClient();
      const info = await client.createSession({ workingDir: defaultDir });
      this.bindSessionClient(client);
      this.activeSessionId = info.session_id;
      await this.context.workspaceState.update(ACTIVE_SESSION_KEY, info.session_id);

      const desiredMode = options.permissionMode ?? this.getDefaultPermissionMode();
      this.activePermissionMode = desiredMode;
      await this.saveSessionPermissionMode(info.session_id, desiredMode);

      if (client.supports("permissions")) {
        await client
          .setPermissionMode(info.session_id, toHarnessPermissionMode(desiredMode))
          .catch(() => {});
      }
      if (options.model) {
        await client.setModel(info.session_id, options.model).catch(() => {});
        this.activeModel = options.model;
      }

      const runtimeInfo = await client.getRuntimeInfo(info.session_id).catch(() => null);
      if (runtimeInfo) {
        this.activeModel = runtimeInfo.model ?? this.activeModel;
        this.activeProvider = runtimeInfo.provider ?? this.activeProvider;
      }

      this.fileChangesBySession.set(
        info.session_id,
        emptyFileChangesSnapshot(info.session_id),
      );
      this.emit("stateChanged");
      return this.mapSessionInfoToSummary(info);
    });
  }

  async attachSession(sessionId: string): Promise<SessionSummaryView> {
    return this.runSerialized(async () => {
      const client = await this.bridgeManager.dialClient();
      const info = await client.attachSession(sessionId);
      this.bindSessionClient(client);
      this.activeSessionId = info.session_id;
      await this.context.workspaceState.update(ACTIVE_SESSION_KEY, info.session_id);

      const savedMode = this.getPermissionModesMap()[info.session_id];
      if (savedMode) {
        this.activePermissionMode = savedMode;
        if (client.supports("permissions")) {
          await client
            .setPermissionMode(info.session_id, toHarnessPermissionMode(savedMode))
            .catch(() => {});
        }
      }

      const runtimeInfo = await client.getRuntimeInfo(info.session_id).catch(() => null);
      if (runtimeInfo) {
        this.activeModel = runtimeInfo.model ?? this.activeModel;
        this.activeProvider = runtimeInfo.provider ?? this.activeProvider;
      }

      if (this.clientSupportsFileChanges(client)) {
        void this.fetchFileChanges(info.session_id)
          .then((snapshot) => {
            if (snapshot) {
              this.broadcastFileChanges(info.session_id, snapshot);
            }
          })
          .catch(() => {});
      }

      this.emit("stateChanged");
      return this.mapSessionInfoToSummary(info);
    });
  }

  async setPermissionMode(
    sessionId: string,
    mode: PermissionModeId,
  ): Promise<{ ok: boolean; mode: PermissionModeId }> {
    const client = await this.getClient();
    const wireMode = toHarnessPermissionMode(mode);
    await client.setPermissionMode(sessionId, wireMode);
    this.activePermissionMode = mode;
    await this.saveSessionPermissionMode(sessionId, mode);
    this.emit("stateChanged");
    return { ok: true, mode };
  }

  async respondPermission(options: {
    sessionId: string;
    requestId: string;
    decision: "allow_once" | "allow_always" | "deny";
  }): Promise<void> {
    const client = await this.getClient();
    const wireDecision: PermissionDecision =
      options.decision === "allow_once"
        ? "allow"
        : options.decision === "allow_always"
          ? "allow_always"
          : "deny";
    await client.respondToPermission(options.sessionId, options.requestId, wireDecision);
  }

  async getHistory(sessionId: string): Promise<SessionHistoryView> {
    const client = await this.getClient();
    const { messages: rawMessages, images: rawImages } =
      await client.getHistoryWithImages(sessionId);

    const imagesByMessageIndex = new Map<number, HistoryImageView[]>();
    const userOrdinalToIndex: number[] = [];
    const toolCallIdToIndex = new Map<string, number>();

    rawMessages.forEach((msg, idx) => {
      if (msg.role === "user") {
        userOrdinalToIndex.push(idx);
      }
      if (msg.tool?.id) {
        toolCallIdToIndex.set(msg.tool.id, idx);
      }
    });

    for (const img of rawImages ?? []) {
      let targetIdx: number | undefined;
      if (img.anchor?.kind === "tool_call") {
        targetIdx = toolCallIdToIndex.get(img.anchor.id);
      } else if (img.anchor?.kind === "user_prompt") {
        targetIdx = userOrdinalToIndex[img.anchor.ordinal];
      }
      if (targetIdx === undefined && typeof img.history_message_index === "number") {
        targetIdx = Math.min(
          Math.max(0, img.history_message_index),
          Math.max(0, rawMessages.length - 1),
        );
      }
      if (targetIdx !== undefined && rawMessages[targetIdx]) {
        const list = imagesByMessageIndex.get(targetIdx) ?? [];
        list.push({
          mediaType: img.media_type,
          data: img.data,
        });
        imagesByMessageIndex.set(targetIdx, list);
      }
    }

    const messages: HistoryMessageView[] = rawMessages.map((msg, idx) =>
      mapRawHistoryMessage(msg as unknown as Record<string, unknown>, {
        id: `hist_${sessionId}_${idx}`,
        model:
          msg.role === "assistant" && sessionId === this.activeSessionId
            ? this.activeModel
            : undefined,
        images: imagesByMessageIndex.get(idx),
      }),
    );

    return { sessionId, messages };
  }

  async runtimeCommand(
    command: RuntimeCommand,
    args: string[] = [],
    sessionId?: string,
  ): Promise<{ session_id: string; command: RuntimeCommand; data: unknown; message: string }> {
    const client = await this.getClient();
    let targetSessionId = sessionId ?? this.activeSessionId;
    if (!targetSessionId) {
      const listed = await client.listSessions({ limit: 1 }).catch(() => []);
      if (listed[0]) {
        targetSessionId = listed[0].session_id;
      } else {
        const created = await this.createSession();
        targetSessionId = created.sessionId;
      }
    }
    return client.runtimeCommand(targetSessionId, command, args);
  }

  /**
   * Forward raw `rayucode.harness.request` frames from webviews to the connected client
   * without disabling session tools, and broadcast the correlated reply frame.
   */
  async handleHarnessRequest(
    rawFrame: Record<string, unknown>,
    replyCallback: (replyFrame: Record<string, unknown>) => void,
  ): Promise<void> {
    const id = typeof rawFrame.id === "number" ? rawFrame.id : undefined;
    const replyMeta = id !== undefined ? { v: API_VERSION_MAJOR, reply_to: id } : { v: API_VERSION_MAJOR };

    try {
      const apiReq = normalizeHarnessRequestFrame(rawFrame);
      const req = apiReq.req;
      if (req === "create_session") {
        const session = await this.runSerialized(async () => {
          const workingDir =
            typeof apiReq.working_dir === "string"
              ? apiReq.working_dir
              : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const client = await this.bridgeManager.dialClient();
          const created = await client.createSession({ workingDir });
          this.bindSessionClient(client);
          this.activeSessionId = created.session_id;
          await this.context.workspaceState.update(ACTIVE_SESSION_KEY, created.session_id);
          this.emit("stateChanged");
          return created;
        });
        const reply = { ...replyMeta, ev: "attached", session };
        replyCallback(reply);
        return;
      }

      if (req === "attach_session" && typeof apiReq.session_id === "string") {
        const targetSessionId = apiReq.session_id;
        const session = await this.runSerialized(async () => {
          const client = await this.bridgeManager.dialClient();
          const attached = await client.attachSession(targetSessionId);
          this.bindSessionClient(client);
          this.activeSessionId = attached.session_id;
          await this.context.workspaceState.update(ACTIVE_SESSION_KEY, attached.session_id);
          this.emit("stateChanged");
          return attached;
        });
        const reply = { ...replyMeta, ev: "attached", session };
        replyCallback(reply);
        return;
      }

      const client = await this.getClient();

      if (req === "send_message" && typeof apiReq.session_id === "string") {
        const sessionId = apiReq.session_id;
        const content = typeof apiReq.content === "string" ? apiReq.content : "";
        const images = normalizeImageAttachments(apiReq.images);
        const reminder =
          typeof apiReq.system_reminder === "string" ? apiReq.system_reminder : undefined;
        const requestedModel =
          typeof apiReq.model === "string" && apiReq.model.trim()
            ? apiReq.model.trim()
            : undefined;
        const requestedEffort =
          typeof apiReq.effort === "string" && apiReq.effort.trim()
            ? apiReq.effort.trim()
            : undefined;

        if (requestedModel && requestedModel !== this.activeModel) {
          await client.setModel(sessionId, requestedModel);
          this.activeModel = requestedModel;
          this.emit("stateChanged");
        }
        if (requestedEffort) {
          await client.setReasoningEffort(sessionId, requestedEffort).catch(() => {});
        }

        if (reminder) {
          await client.sendMessageWithReminder(
            sessionId,
            content,
            images,
            reminder,
            { requireAccept: true },
          );
        } else {
          await client.sendMessage(sessionId, content, {
            images,
            requireAccept: true,
          });
        }
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      if (req === "set_model" && typeof apiReq.session_id === "string" && typeof apiReq.model === "string") {
        await client.setModel(apiReq.session_id, apiReq.model);
        this.activeModel = apiReq.model;
        this.emit("stateChanged");
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      if (req === "set_permission_mode" && typeof apiReq.session_id === "string") {
        const uiMode = fromHarnessPermissionMode(String(apiReq.mode ?? "default"));
        await this.setPermissionMode(apiReq.session_id, uiMode);
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      // Generic request forwarding with canonical `req:` discriminant
      const response = await client.request(
        apiReq as unknown as Parameters<RayucodeClient["request"]>[0],
      );
      replyCallback({ ...response, ...replyMeta });
    } catch (error) {
      const code =
        error instanceof HarnessError ? error.code : "internal";
      const message =
        error instanceof Error ? error.message : "Rayu could not complete the request.";
      replyCallback({
        ...replyMeta,
        ev: "error",
        code,
        message,
      });
    }
  }

  async refreshBackgroundProcesses(sessionId?: string): Promise<BackgroundProcessView[]> {
    try {
      const out = await this.runtimeCommand("background", ["list"], sessionId);
      const data =
        typeof out.data === "object" && out.data !== null
          ? (out.data as Record<string, unknown>)
          : {};
      const rawTasks = Array.isArray(data.tasks) ? data.tasks : [];
      this.backgroundTasks.clear();
      for (const item of rawTasks) {
        if (typeof item === "object" && item !== null) {
          const mapped = mapRawBackgroundTask(
            item as Record<string, unknown>,
            out.session_id,
          );
          this.backgroundTasks.set(mapped.taskId, mapped);
        }
      }
      this.broadcastProcessesSnapshot();
      this.syncBackgroundPollTimer();
    } catch {
      // keep existing snapshot if bridge is offline
    }
    return this.getBackgroundTasks();
  }

  removeCompletedBackgroundTasks(sessionId?: string): number {
    let removed = 0;
    for (const [id, task] of this.backgroundTasks.entries()) {
      if (sessionId && task.sessionId !== sessionId) continue;
      if (
        task.status === "completed" ||
        task.status === "failed" ||
        task.status === "superseded"
      ) {
        this.backgroundTasks.delete(id);
        removed += 1;
      }
    }
    this.broadcastProcessesSnapshot();
    this.syncBackgroundPollTimer();
    return removed;
  }

  private broadcastProcessesSnapshot(): void {
    const tasks = this.getBackgroundTasks();
    this.broadcast({
      type: "rayucode.processes.snapshot",
      tasks,
    });
    this.emit("processesChanged", tasks);
    this.emit("stateChanged");
  }

  private syncBackgroundPollTimer(): void {
    const hasRunning = [...this.backgroundTasks.values()].some(
      (t) => t.status === "running" || t.status === "stalled",
    );
    if (hasRunning && !this.backgroundPollTimer) {
      this.backgroundPollTimer = setInterval(() => {
        void this.refreshBackgroundProcesses();
      }, 3_000);
      this.backgroundPollTimer.unref?.();
    } else if (!hasRunning && this.backgroundPollTimer) {
      clearInterval(this.backgroundPollTimer);
      this.backgroundPollTimer = null;
    }
  }

  dispose(): void {
    if (this.backgroundPollTimer) {
      clearInterval(this.backgroundPollTimer);
      this.backgroundPollTimer = null;
    }
    const client = this.sessionClient;
    this.sessionClient = null;
    if (client && client !== this.bridgeManager.getActiveClient()) {
      void client.close();
    }
    this.surfaces.clear();
  }
}
