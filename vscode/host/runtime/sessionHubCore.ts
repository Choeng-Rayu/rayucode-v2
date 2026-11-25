import { EventEmitter } from "node:events";
import {
  API_VERSION_MAJOR,
  HarnessError,
  RayuCreditsAccumulator,
  type AppletInstance,
  type PermissionDecision,
  type RayucodeClient,
  type RuntimeCommand,
  type ServerFrame,
  type SessionInfo,
  type SidePanelPage,
  type TodoSnapshot,
} from "@rayu-dev/rayucode-sdk";
import {
  SessionSocketPool,
  WorkspaceRegistry,
  type WorkspaceLedger,
} from "@rayu-dev/rayucode-session-core/host";
import {
  normalizeSessionSource,
  sessionSourceToFilterGroup,
} from "@rayu-dev/rayucode-session-core/client";
import {
  fromHarnessPermissionMode,
  toHarnessPermissionMode,
  type AccountStatusView,
  type AppletStateView,
  type BackgroundProcessView,
  type DaemonStatusView,
  type ExternalProjectView,
  type FileChangeActionKind,
  type FileChangeActionResultView,
  type FileChangesSnapshotView,
  type FileDiffView,
  type HistoryImageView,
  type HistoryMessageView,
  type HostToWebviewMessage,
  type ImportExternalSessionItemView,
  type ImportSkipView,
  type PermissionModeId,
  type ProjectIconView,
  type SessionHistoryView,
  type SessionSummaryView,
  type SidePanelPageView,
  type SurfaceKind,
  type TodoItemView,
  type WorkspaceLedgerView,
} from "../../shared/vscodeProtocol.js";
import {
  buildQuestionResponseWire,
  emptyFileChangesSnapshot,
  formatHarnessModelSpec,
  mapRawBackgroundTask,
  mapRawFileChangeActionResponse,
  mapRawFileChangeDiff,
  mapRawFileChangesSnapshot,
  mapRawHistoryMessage,
  normalizeHarnessRequestFrame,
  normalizeImageAttachments,
} from "./featureRouters.js";

export const PINNED_SESSIONS_KEY = "rayucode.sessions.pinned";
export const ARCHIVED_SESSIONS_KEY = "rayucode.sessions.archived";
export const PERMISSION_MODES_KEY = "rayucode.sessions.permissionModes";
export const ACTIVE_SESSION_KEY = "rayucode.sessions.activeSessionId";

export interface SessionHubWorkspaceFolder {
  name: string;
  fsPath: string;
}

export interface SessionHubMemento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void> | void;
}

export interface SessionHubHostAdapter {
  workspaceState: SessionHubMemento;
  getWorkspaceFolders(): SessionHubWorkspaceFolder[];
  getDefaultPermissionModeRaw(): string;
  onDidChangeWorkspaceFolders?(listener: () => void): { dispose(): void };
  getProjectIcons?(): Record<string, ProjectIconView>;
}

export interface SessionHubBridgeLike extends EventEmitter {
  getStatus(): DaemonStatusView;
  getActiveClient(): RayucodeClient | null;
  ensureConnected(): Promise<RayucodeClient>;
  dialClient(customSocketPath?: string): Promise<RayucodeClient>;
}

export interface SessionHubCoreOptions {
  workspaceRegistry?: WorkspaceRegistry;
  maxIdleClients?: number;
}

interface RegisteredSurface {
  id: string;
  surface: SurfaceKind;
  postMessage: (message: HostToWebviewMessage) => void;
}

export class SessionHubCore extends EventEmitter {
  private readonly surfaces = new Map<string, RegisteredSurface>();
  private readonly backgroundTasksBySession = new Map<
    string,
    Map<string, BackgroundProcessView>
  >();
  private readonly streamingBySession = new Map<string, boolean>();
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
  private readonly sessionInfoCache = new Map<string, SessionInfo>();
  private readonly sessionWorkingDirs = new Map<string, string>();
  private readonly newlyCreatedSessions = new Set<string>();
  private readonly creditsAccumulator = new RayuCreditsAccumulator();

  private readonly socketPool: SessionSocketPool<RayucodeClient>;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly ownsWorkspaceRegistry: boolean;
  private workspaceUnsub: (() => void) | null = null;
  private folderWatchDisposable: { dispose(): void } | null = null;
  private readonly workspacesReadyPromise: Promise<WorkspaceLedgerView>;

  private activeSessionId: string | undefined;
  private activeModel: string | undefined;
  private activeProvider: string | undefined;
  private activePermissionMode: PermissionModeId;
  private isTurnStreaming = false;
  private backgroundPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    protected readonly host: SessionHubHostAdapter,
    protected readonly bridgeManager: SessionHubBridgeLike,
    options: SessionHubCoreOptions = {},
  ) {
    super();
    this.activeSessionId = this.host.workspaceState.get<string>(ACTIVE_SESSION_KEY);
    this.activePermissionMode = this.getDefaultPermissionMode();

    this.socketPool = new SessionSocketPool<RayucodeClient>({
      maxIdleClients: options.maxIdleClients ?? 6,
      dialClient: () => this.bridgeManager.dialClient(),
      onFrame: (frame, sessionId) => {
        this.ingestFrame(frame as ServerFrame, sessionId);
      },
      onSessionClosed: (sessionId) => {
        if (sessionId) {
          this.streamingBySession.set(sessionId, false);
          if (sessionId === this.activeSessionId) {
            this.isTurnStreaming = false;
          }
        }
        this.emit("stateChanged");
      },
      disconnectMessage: "Connection to Rayu daemon lost.",
    });

    this.ownsWorkspaceRegistry = !options.workspaceRegistry;
    this.workspaceRegistry = options.workspaceRegistry ?? new WorkspaceRegistry();

    this.workspaceUnsub = this.workspaceRegistry.subscribe((event) => {
      this.broadcastWorkspaceLedger(event.ledger);
    });

    if (this.host.onDidChangeWorkspaceFolders) {
      this.folderWatchDisposable = this.host.onDidChangeWorkspaceFolders(() => {
        void this.syncOpenWorkspaceFolders().catch(() => {});
      });
    }

    this.workspacesReadyPromise = this.initializeWorkspaces().catch(() =>
      this.getWorkspaceLedger(),
    );

    this.bridgeManager.on("statusChanged", (status) => {
      if (status.state === "disconnected" || status.state === "error") {
        this.streamingBySession.clear();
        this.isTurnStreaming = false;
      }
      this.broadcast({ type: "rayucode.daemon.statusChanged", status });
      this.emit("stateChanged");
    });

    this.bridgeManager.on("connected", () => {
      if (this.activeSessionId && !this.socketPool.has(this.activeSessionId)) {
        void this.attachSession(this.activeSessionId).catch(() => {});
      }
    });

    this.bridgeManager.on("frame", (frame: ServerFrame) => {
      const sid =
        typeof frame.session_id === "string" ? frame.session_id.trim() : "";
      if (!sid || !this.socketPool.has(sid)) {
        this.ingestFrame(frame, sid || undefined);
      }
    });
  }

  private async initializeWorkspaces(): Promise<WorkspaceLedgerView> {
    const legacyPinnedMap = this.getLegacyPinnedMap();
    const legacyArchivedMap = this.getLegacyArchivedMap();
    const pinnedSessionIds = Object.entries(legacyPinnedMap)
      .filter(([, pinned]) => Boolean(pinned))
      .map(([sid]) => sid);
    const archivedSessionIds = Object.entries(legacyArchivedMap)
      .filter(([, archived]) => Boolean(archived))
      .map(([sid]) => sid);
    const openFolders = this.host.getWorkspaceFolders();

    await this.workspaceRegistry.migrateLegacy({
      sourceKey: "vscode-v1",
      pinnedSessionIds,
      archivedSessionIds,
      workspaces: openFolders.map((folder) => ({
        name: folder.name,
        path: folder.fsPath,
      })),
    });

    for (const folder of openFolders) {
      await this.workspaceRegistry.ensureWorkspace(folder.fsPath, {
        name: folder.name,
        unhide: true,
      });
    }

    return this.getWorkspaceLedger();
  }

  async waitUntilWorkspacesReady(): Promise<WorkspaceLedgerView> {
    return this.workspacesReadyPromise;
  }

  async syncOpenWorkspaceFolders(): Promise<WorkspaceLedgerView> {
    const openFolders = this.host.getWorkspaceFolders();
    let latest: WorkspaceLedger | null = null;
    for (const folder of openFolders) {
      const res = await this.workspaceRegistry.ensureWorkspace(folder.fsPath, {
        name: folder.name,
        unhide: true,
      });
      latest = res.ledger;
    }
    const ledgerView = this.buildWorkspaceLedgerView(
      latest ?? this.workspaceRegistry.getSnapshot(),
    );
    this.broadcast({
      type: "rayucode.workspaces.ledgerChanged",
      ledger: ledgerView,
    });
    return ledgerView;
  }

  private buildWorkspaceLedgerView(ledger: WorkspaceLedger): WorkspaceLedgerView {
    const openFolders = this.host.getWorkspaceFolders();
    const openFolderPaths = openFolders.map((f) => f.fsPath);
    const primaryPath = openFolderPaths[0];
    const icons = this.host.getProjectIcons?.() ?? {};

    return {
      version: ledger.version,
      updatedAt: ledger.updatedAt,
      workspaces: ledger.workspaces.map((ws) => ({
        ...ws,
        icon: icons[ws.path] ?? icons[ws.canonicalPath],
        isPrimary:
          primaryPath !== undefined &&
          (ws.path === primaryPath || ws.canonicalPath === primaryPath),
      })),
      pinnedSessionIds: [...ledger.pinnedSessionIds],
      archivedSessionIds: [...ledger.archivedSessionIds],
      collapsedWorkspaceIds: [...ledger.collapsedWorkspaceIds],
      manualWorkspaceOrder: [...ledger.manualWorkspaceOrder],
      openFolderPaths,
    };
  }

  private broadcastWorkspaceLedger(ledger: WorkspaceLedger): void {
    const ledgerView = this.buildWorkspaceLedgerView(ledger);
    this.broadcast({
      type: "rayucode.workspaces.ledgerChanged",
      ledger: ledgerView,
    });
    this.emit("workspacesChanged", ledgerView);
  }

  getWorkspaceLedger(): WorkspaceLedgerView {
    return this.buildWorkspaceLedgerView(this.workspaceRegistry.getSnapshot());
  }

  async loadWorkspaceLedger(): Promise<WorkspaceLedgerView> {
    await this.workspacesReadyPromise;
    const ledger = await this.workspaceRegistry.load();
    return this.buildWorkspaceLedgerView(ledger);
  }

  async ensureWorkspace(
    rawPath: string,
    options?: { name?: string; unhide?: boolean },
  ): Promise<WorkspaceLedgerView> {
    const { ledger } = await this.workspaceRegistry.ensureWorkspace(
      rawPath,
      options,
    );
    return this.buildWorkspaceLedgerView(ledger);
  }

  async removeWorkspace(idOrPath: string): Promise<WorkspaceLedgerView> {
    const ledger = await this.workspaceRegistry.removeWorkspace(idOrPath);
    return this.buildWorkspaceLedgerView(ledger);
  }

  async setWorkspaceCollapsed(
    workspaceId: string,
    collapsed: boolean,
  ): Promise<WorkspaceLedgerView> {
    const ledger = await this.workspaceRegistry.setCollapsed(
      workspaceId,
      collapsed,
    );
    return this.buildWorkspaceLedgerView(ledger);
  }

  async attachSessionToWorkspace(
    workspaceIdOrPath: string,
    sessionId: string,
  ): Promise<WorkspaceLedgerView> {
    const ledger = await this.workspaceRegistry.attachSession(
      workspaceIdOrPath,
      sessionId,
    );
    return this.buildWorkspaceLedgerView(ledger);
  }

  async importProjectGroup(
    rawPath: string,
    options: { name?: string; sessionIds: readonly string[] },
  ): Promise<WorkspaceLedgerView> {
    const { ledger } = await this.workspaceRegistry.importProjectGroup(
      rawPath,
      options,
    );
    return this.buildWorkspaceLedgerView(ledger);
  }

  getSocketPool(): SessionSocketPool<RayucodeClient> {
    return this.socketPool;
  }

  getWorkspaceRegistry(): WorkspaceRegistry {
    return this.workspaceRegistry;
  }

  getDefaultPermissionMode(): PermissionModeId {
    return fromHarnessPermissionMode(this.host.getDefaultPermissionModeRaw());
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

  getIsTurnStreaming(): boolean {
    return this.isTurnStreaming;
  }

  private setTurnStreaming(next: boolean): void {
    if (this.isTurnStreaming === next) return;
    this.isTurnStreaming = next;
    this.emit("stateChanged");
  }

  private setSessionTurnStreaming(
    sessionId: string,
    isFocusedSession: boolean,
    next: boolean,
  ): void {
    if (sessionId) {
      this.streamingBySession.set(sessionId, next);
    }
    if (isFocusedSession) {
      this.setTurnStreaming(next);
    }
  }

  getTotalSessionCredits(): number | undefined {
    return this.creditsAccumulator.totalCredits;
  }

  getBackgroundTasks(sessionId?: string): BackgroundProcessView[] {
    const targetSessionId = sessionId ?? this.activeSessionId;
    if (!targetSessionId) {
      return [];
    }
    return [
      ...(this.backgroundTasksBySession.get(targetSessionId)?.values() ?? []),
    ].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
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
      this.sidePanelsBySession.set(sessionId, {
        pages: [],
        activePageId: undefined,
      });
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
      const client = await this.getClient(sid);
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
    const client = await this.getClient(sessionId);
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
    const client = await this.getClient(sessionId);
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
  ): { dispose(): void } {
    this.surfaces.set(id, { id, surface, postMessage });
    return {
      dispose: () => {
        this.surfaces.delete(id);
      },
    };
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

  postToSurface(surfaceId: string, message: HostToWebviewMessage): boolean {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return false;
    try {
      surface.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  broadcastAccountChanged(account: AccountStatusView): void {
    this.broadcast({
      type: "rayucode.account.changed",
      account,
    });
  }

  async notifyDaemonAuthChanged(provider = "rayu"): Promise<void> {
    const activeClient =
      (this.activeSessionId
        ? this.socketPool.get(this.activeSessionId)
        : undefined) ?? this.bridgeManager.getActiveClient();
    if (!activeClient) return;
    await activeClient.notifyAuthChanged(provider).catch(() => {});
    if (this.activeSessionId) {
      await activeClient
        .runtimeCommand(this.activeSessionId, "refresh_model_list", [])
        .catch(() => {});
    }
  }

  /**
   * Return the pooled client for `sessionId` (or the focused session) if bound,
   * otherwise the primary control client.
   */
  async getClient(sessionId?: string): Promise<RayucodeClient> {
    if (sessionId) {
      const pooled = this.socketPool.get(sessionId);
      if (pooled) return pooled;
    }
    if (this.activeSessionId) {
      const focused = this.socketPool.get(this.activeSessionId);
      if (focused) return focused;
    }
    return this.bridgeManager.ensureConnected();
  }

  private async ensureSessionClient(sessionId: string): Promise<RayucodeClient> {
    const existing = this.socketPool.get(sessionId);
    if (existing) return existing;

    return this.socketPool.runSerialized(async () => {
      const already = this.socketPool.get(sessionId);
      if (already) return already;
      const { client, reused } = await this.socketPool.acquireForSession(sessionId);
      if (!reused) {
        const attached = await client.attachSession(sessionId);
        this.socketPool.register(attached.session_id, client);
        this.sessionInfoCache.set(attached.session_id, attached);
        if (attached.working_dir) {
          this.sessionWorkingDirs.set(attached.session_id, attached.working_dir);
        }
      }
      return client;
    });
  }

  private ingestFrame(rawFrame: ServerFrame, boundSessionId?: string): void {
    const rawSid =
      typeof rawFrame.session_id === "string" ? rawFrame.session_id.trim() : "";
    const resolvedSessionId = rawSid || boundSessionId || "";
    const frame: ServerFrame =
      resolvedSessionId && !rawSid
        ? ({ ...rawFrame, session_id: resolvedSessionId } as ServerFrame)
        : rawFrame;

    const isFocusedSession =
      !this.activeSessionId ||
      !resolvedSessionId ||
      resolvedSessionId === this.activeSessionId;

    switch (frame.ev) {
      case "message_accepted":
      case "turn_start":
      case "text_delta":
      case "reasoning_delta":
      case "thinking_delta":
      case "tool_start":
      case "tool_exec":
      case "tool_call":
      case "soft_interrupt_injected": {
        this.setSessionTurnStreaming(resolvedSessionId, isFocusedSession, true);
        break;
      }
      case "turn_done":
      case "turn_stopped":
      case "turn_aborted": {
        this.setSessionTurnStreaming(resolvedSessionId, isFocusedSession, false);
        break;
      }
      case "session_status": {
        if (typeof frame.status === "string") {
          const status = frame.status.trim().toLowerCase();
          if (
            status === "running" ||
            status === "generating" ||
            status === "tool_running" ||
            status === "busy"
          ) {
            this.setSessionTurnStreaming(
              resolvedSessionId,
              isFocusedSession,
              true,
            );
          } else if (status === "idle") {
            this.setSessionTurnStreaming(
              resolvedSessionId,
              isFocusedSession,
              false,
            );
          }
        }
        break;
      }
      case "error": {
        if (frame.reply_to === undefined) {
          this.setSessionTurnStreaming(
            resolvedSessionId,
            isFocusedSession,
            false,
          );
        }
        break;
      }
      case "permission_mode_changed": {
        if (typeof frame.mode === "string") {
          const uiMode = fromHarnessPermissionMode(frame.mode);
          if (isFocusedSession) {
            this.activePermissionMode = uiMode;
          }
          if (resolvedSessionId) {
            void this.saveSessionPermissionMode(resolvedSessionId, uiMode);
          }
          this.emit("stateChanged");
        }
        break;
      }
      case "model_info":
      case "runtime_info": {
        if (isFocusedSession) {
          if (typeof frame.model === "string") {
            this.activeModel = frame.model;
          }
          if (typeof frame.provider === "string") {
            this.activeProvider = frame.provider;
          }
          this.emit("stateChanged");
        }
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
        const frameSessionId = resolvedSessionId || this.activeSessionId;
        if (!frameSessionId) {
          break;
        }
        let sessionTasks = this.backgroundTasksBySession.get(frameSessionId);
        if (!sessionTasks) {
          sessionTasks = new Map<string, BackgroundProcessView>();
          this.backgroundTasksBySession.set(frameSessionId, sessionTasks);
        }
        const existing =
          typeof frame.task_id === "string"
            ? sessionTasks.get(frame.task_id)
            : undefined;
        const mapped = mapRawBackgroundTask(
          {
            ...existing,
            ...frame,
            session_id: frameSessionId,
          },
          frameSessionId,
        );
        sessionTasks.set(mapped.taskId, {
          ...mapped,
          sessionId: frameSessionId,
        });
        if (frameSessionId === this.activeSessionId) {
          this.broadcastProcessesSnapshot();
          this.syncBackgroundPollTimer();
        }
        break;
      }
      case "side_panel_state": {
        if (
          resolvedSessionId &&
          frame.snapshot &&
          typeof frame.snapshot === "object"
        ) {
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
          this.sidePanelsBySession.set(resolvedSessionId, {
            pages,
            activePageId: snapshot.focused_page_id ?? pages[0]?.id,
          });
        }
        break;
      }
      case "applet_state": {
        if (
          resolvedSessionId &&
          frame.snapshot &&
          typeof frame.snapshot === "object"
        ) {
          const snapshot = frame.snapshot as { instances?: AppletInstance[] };
          const applets: AppletStateView[] = (snapshot.instances ?? []).map(
            (inst) => ({
              appletId: inst.id,
              title: inst.document?.title ?? inst.applet,
              kind: inst.applet,
              state: inst.document?.state ?? {},
              schema: inst.document?.view,
              updatedAtMs: Date.now(),
            }),
          );
          this.appletsBySession.set(resolvedSessionId, applets);
        }
        break;
      }
      case "todo_state": {
        if (resolvedSessionId && frame.state && typeof frame.state === "object") {
          const todos = this.mapTodoSnapshot(frame.state as TodoSnapshot);
          this.todosBySession.set(resolvedSessionId, todos);
        }
        break;
      }
      case "file_changes_state": {
        const sid = resolvedSessionId || this.activeSessionId;
        if (sid && frame.snapshot && typeof frame.snapshot === "object") {
          const snapshot = mapRawFileChangesSnapshot(frame.snapshot, sid);
          this.broadcastFileChanges(sid, snapshot);
        }
        break;
      }
      case "tool_done": {
        if (
          resolvedSessionId &&
          typeof frame.name === "string" &&
          !frame.error &&
          ["edit_file", "write_file", "multi_edit", "apply_patch"].includes(
            frame.name,
          )
        ) {
          this.emit("filesChanged", resolvedSessionId);
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

  private getLegacyPinnedMap(): Record<string, boolean> {
    return this.host.workspaceState.get<Record<string, boolean>>(
      PINNED_SESSIONS_KEY,
      {},
    );
  }

  private getLegacyArchivedMap(): Record<string, boolean> {
    return this.host.workspaceState.get<Record<string, boolean>>(
      ARCHIVED_SESSIONS_KEY,
      {},
    );
  }

  private getPermissionModesMap(): Record<string, PermissionModeId> {
    return this.host.workspaceState.get<Record<string, PermissionModeId>>(
      PERMISSION_MODES_KEY,
      {},
    );
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    await this.setSessionPinnedLedger(sessionId, pinned);
  }

  async setSessionPinnedLedger(
    sessionId: string,
    pinned: boolean,
  ): Promise<WorkspaceLedgerView> {
    const ledger = await this.workspaceRegistry.setPinned(sessionId, pinned);
    const map = { ...this.getLegacyPinnedMap(), [sessionId]: pinned };
    await this.host.workspaceState.update(PINNED_SESSIONS_KEY, map);
    const client = await this.getClient(sessionId).catch(() => null);
    if (client) {
      await client.setSessionSaved(sessionId, pinned).catch(() => {});
    }
    return this.buildWorkspaceLedgerView(ledger);
  }

  async setSessionArchived(sessionId: string, archived: boolean): Promise<void> {
    await this.setSessionArchivedLedger(sessionId, archived);
  }

  async setSessionArchivedLedger(
    sessionId: string,
    archived: boolean,
  ): Promise<WorkspaceLedgerView> {
    const ledger = await this.workspaceRegistry.setArchived(sessionId, archived);
    const map = { ...this.getLegacyArchivedMap(), [sessionId]: archived };
    await this.host.workspaceState.update(ARCHIVED_SESSIONS_KEY, map);
    const client = await this.getClient(sessionId).catch(() => null);
    if (client) {
      if (archived) {
        await client.archiveSession(sessionId).catch(() => {});
      } else {
        await client.restoreSession(sessionId).catch(() => {});
      }
    }
    return this.buildWorkspaceLedgerView(ledger);
  }

  private async saveSessionPermissionMode(
    sessionId: string,
    mode: PermissionModeId,
  ): Promise<void> {
    const map = { ...this.getPermissionModesMap(), [sessionId]: mode };
    await this.host.workspaceState.update(PERMISSION_MODES_KEY, map);
  }

  mapSessionInfoToSummary(info: SessionInfo): SessionSummaryView {
    const ledger = this.workspaceRegistry.getSnapshot();
    const pinnedSet = new Set(ledger.pinnedSessionIds);
    const archivedSet = new Set(ledger.archivedSessionIds);
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

    const isPinned = pinnedSet.has(info.session_id) || Boolean(info.saved);
    const isArchived =
      !isPinned && (archivedSet.has(info.session_id) || Boolean(info.archived));

    const normalizedSource = normalizeSessionSource(info.source);
    const sourceTool = sessionSourceToFilterGroup(normalizedSource);

    return {
      sessionId: info.session_id,
      title: info.save_label || info.title || info.agent_label || "Untitled session",
      workingDir: info.working_dir,
      status,
      model: info.session_id === this.activeSessionId ? this.activeModel : undefined,
      provider:
        info.session_id === this.activeSessionId ? this.activeProvider : undefined,
      permissionMode: permMap[info.session_id] ?? this.activePermissionMode,
      updatedAtMs: info.updated_at_ms ?? info.last_active_at_ms ?? Date.now(),
      pinned: isPinned,
      archived: isArchived,
      diffAdditions: info.edit_stats?.added,
      diffDeletions: info.edit_stats?.removed,
      sourceTool,
      source: normalizedSource,
      externalSessionId: info.external_session_id,
      externalPath: info.external_path,
      externalProjectName: info.external_project_name,
      imported: info.imported,
      syncStale: info.sync_stale,
    };
  }

  async listSessions(
    includeArchived = false,
    options?: { includeExternal?: boolean; sources?: string[] },
  ): Promise<{
    sessions: SessionSummaryView[];
    activeSessionId?: string;
  }> {
    const client = await this.getClient();
    const supportsExternal =
      typeof client.supports === "function"
        ? client.supports("external_sessions")
        : false;
    const includeExternal =
      (options?.includeExternal ?? true) && supportsExternal;
    const rawList = await client.listSessions({
      includeArchived,
      limit: 200,
      ...(includeExternal ? { includeExternal: true } : {}),
      ...(includeExternal && options?.sources?.length
        ? { sources: options.sources }
        : {}),
    });
    for (const info of rawList) {
      this.sessionInfoCache.set(info.session_id, info);
      if (info.working_dir) {
        this.sessionWorkingDirs.set(info.session_id, info.working_dir);
      }
    }
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

  async listExternalProjects(
    source?: string,
  ): Promise<{ projects: ExternalProjectView[] }> {
    const client = await this.getClient();
    const supportsExternal =
      typeof client.supports === "function"
        ? client.supports("external_sessions")
        : false;
    if (!supportsExternal || typeof client.listExternalProjects !== "function") {
      return { projects: [] };
    }
    const rawProjects = await client.listExternalProjects(
      source ? { source } : {},
    );
    return {
      projects: rawProjects.map((project) => ({
        id: project.id,
        source: normalizeSessionSource(project.source),
        name: project.name,
        workingDir: project.working_dir ?? null,
        sessionCount: project.session_count,
        updatedAtMs: project.updated_at_ms,
        sessions: project.sessions.map((s) => this.mapSessionInfoToSummary(s)),
      })),
    };
  }

  async importExternalSessions(
    items: ImportExternalSessionItemView[],
    options?: { forceResync?: boolean; forkOnConflict?: boolean },
  ): Promise<{ sessions: SessionSummaryView[]; skipped: ImportSkipView[] }> {
    const client = await this.getClient();
    const supportsExternal =
      typeof client.supports === "function"
        ? client.supports("external_sessions")
        : false;
    if (
      !supportsExternal ||
      typeof client.importExternalSessions !== "function"
    ) {
      return { sessions: [], skipped: [] };
    }
    const wireItems = items.map((item) => ({
      source: item.source,
      external_session_id: item.externalSessionId,
      ...(item.externalPath ? { external_path: item.externalPath } : {}),
      ...(item.workingDir ? { working_dir: item.workingDir } : {}),
    }));
    const result = await client.importExternalSessions(wireItems, {
      forceResync: options?.forceResync,
      forkOnConflict: options?.forkOnConflict,
    });
    for (const info of result.sessions) {
      this.sessionInfoCache.set(info.session_id, info);
      if (info.working_dir) {
        this.sessionWorkingDirs.set(info.session_id, info.working_dir);
      }
    }
    return {
      sessions: result.sessions.map((info) =>
        this.mapSessionInfoToSummary(info),
      ),
      skipped: result.skipped.map((skip) => ({
        externalSessionId: skip.external_session_id,
        source: skip.source,
        reason: skip.reason,
        message: skip.message,
        existingSessionId: skip.existing_session_id ?? null,
      })),
    };
  }

  /**
   * Create a new session WITHOUT disabling tools and WITHOUT killing existing
   * active-turn / pending-permission sockets (managed by `SessionSocketPool`).
   */
  async createSession(
    options: {
      workingDir?: string;
      permissionMode?: PermissionModeId;
      model?: string;
      provider?: string;
      apiMethod?: string;
    } = {},
  ): Promise<SessionSummaryView> {
    return this.socketPool.runSerialized(async () => {
      const defaultDir =
        options.workingDir ??
        this.host.getWorkspaceFolders()[0]?.fsPath ??
        process.cwd();
      const client = await this.socketPool.dialFreshClient();
      const info = await client.createSession({ workingDir: defaultDir });
      this.socketPool.register(info.session_id, client);
      this.socketPool.setFocusedSession(info.session_id);
      this.sessionInfoCache.set(info.session_id, info);
      this.sessionWorkingDirs.set(info.session_id, info.working_dir || defaultDir);
      this.newlyCreatedSessions.add(info.session_id);

      this.activeSessionId = info.session_id;
      this.streamingBySession.set(info.session_id, false);
      this.setTurnStreaming(false);
      this.backgroundTasksBySession.set(info.session_id, new Map());
      this.broadcastProcessesSnapshot();
      this.syncBackgroundPollTimer();
      await this.host.workspaceState.update(ACTIVE_SESSION_KEY, info.session_id);

      const desiredMode = options.permissionMode ?? this.getDefaultPermissionMode();
      this.activePermissionMode = desiredMode;
      await this.saveSessionPermissionMode(info.session_id, desiredMode);

      if (client.supports("permissions")) {
        await client
          .setPermissionMode(info.session_id, toHarnessPermissionMode(desiredMode))
          .catch(() => {});
      }
      if (options.model) {
        const modelSpec = formatHarnessModelSpec(
          options.model,
          options.provider,
          options.apiMethod,
        );
        if (modelSpec) {
          await client.setModel(info.session_id, modelSpec).catch(() => {});
          this.activeModel = modelSpec;
          if (options.provider) {
            this.activeProvider = options.provider;
          } else if (modelSpec.startsWith("rayu:")) {
            this.activeProvider = "rayu";
          }
        }
      }

      const runtimeInfo = await client
        .getRuntimeInfo(info.session_id)
        .catch(() => null);
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
    return this.socketPool.runSerialized(async () => {
      const { client, reused } = await this.socketPool.acquireForSession(sessionId);
      let info: SessionInfo;
      if (reused) {
        const cached = this.sessionInfoCache.get(sessionId);
        if (cached) {
          info = cached;
        } else {
          const listed = await client
            .listSessions({ includeArchived: true, limit: 200 })
            .catch(() => []);
          info =
            listed.find((s) => s.session_id === sessionId) ??
            (await client.attachSession(sessionId));
        }
      } else {
        info = await client.attachSession(sessionId);
        this.socketPool.register(info.session_id, client);
      }

      this.sessionInfoCache.set(info.session_id, info);
      if (info.working_dir) {
        this.sessionWorkingDirs.set(info.session_id, info.working_dir);
      }
      this.socketPool.setFocusedSession(info.session_id);
      this.activeSessionId = info.session_id;
      if (!reused) {
        this.streamingBySession.set(info.session_id, false);
      }
      this.setTurnStreaming(this.streamingBySession.get(info.session_id) ?? false);
      this.broadcastProcessesSnapshot();
      this.syncBackgroundPollTimer();
      void this.refreshBackgroundProcesses(info.session_id).catch(() => {});
      await this.host.workspaceState.update(ACTIVE_SESSION_KEY, info.session_id);

      const savedMode = this.getPermissionModesMap()[info.session_id];
      if (savedMode) {
        this.activePermissionMode = savedMode;
        if (!reused && client.supports("permissions")) {
          await client
            .setPermissionMode(info.session_id, toHarnessPermissionMode(savedMode))
            .catch(() => {});
        }
      }

      if (!reused) {
        const runtimeInfo = await client
          .getRuntimeInfo(info.session_id)
          .catch(() => null);
        if (runtimeInfo) {
          this.activeModel = runtimeInfo.model ?? this.activeModel;
          this.activeProvider = runtimeInfo.provider ?? this.activeProvider;
        }
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
    const client = await this.getClient(sessionId);
    const wireMode = toHarnessPermissionMode(mode);
    await client.setPermissionMode(sessionId, wireMode);
    if (!this.activeSessionId || this.activeSessionId === sessionId) {
      this.activePermissionMode = mode;
    }
    await this.saveSessionPermissionMode(sessionId, mode);
    this.emit("stateChanged");
    return { ok: true, mode };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const client =
      this.socketPool.get(sessionId) ?? (await this.getClient(sessionId));
    await client.cancel(sessionId);
  }

  async respondPermission(options: {
    sessionId: string;
    requestId: string;
    decision: "allow_once" | "allow_always" | "deny";
  }): Promise<void> {
    const client =
      this.socketPool.get(options.sessionId) ??
      (await this.getClient(options.sessionId));
    const wireDecision: PermissionDecision =
      options.decision === "allow_once"
        ? "allow"
        : options.decision === "allow_always"
          ? "allow_always"
          : "deny";
    await client.respondToPermission(
      options.sessionId,
      options.requestId,
      wireDecision,
    );
    this.socketPool.markPermissionPending(options.sessionId, false);
  }

  async getHistory(sessionId: string): Promise<SessionHistoryView> {
    const client = await this.getClient(sessionId);
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
      if (
        targetIdx === undefined &&
        typeof img.history_message_index === "number"
      ) {
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
  ): Promise<{
    session_id: string;
    command: RuntimeCommand;
    data: unknown;
    message: string;
  }> {
    let targetSessionId = sessionId ?? this.activeSessionId;
    const client = await this.getClient(targetSessionId);
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
   * Forward raw `rayucode.harness.request` frames from webviews to the pooled
   * per-session client without killing background streams.
   */
  async handleHarnessRequest(
    rawFrame: Record<string, unknown>,
    replyCallback: (replyFrame: Record<string, unknown>) => void,
  ): Promise<void> {
    const id = typeof rawFrame.id === "number" ? rawFrame.id : undefined;
    const replyMeta =
      id !== undefined
        ? { v: API_VERSION_MAJOR, reply_to: id }
        : { v: API_VERSION_MAJOR };

    try {
      const apiReq = normalizeHarnessRequestFrame(rawFrame);
      const req = apiReq.req;

      if (req === "create_session") {
        const session = await this.socketPool.runSerialized(async () => {
          const workingDir =
            typeof apiReq.working_dir === "string"
              ? apiReq.working_dir
              : this.host.getWorkspaceFolders()[0]?.fsPath;
          const client = await this.socketPool.dialFreshClient();
          const created = await client.createSession({ workingDir });
          this.socketPool.register(created.session_id, client);
          this.socketPool.setFocusedSession(created.session_id);
          this.sessionInfoCache.set(created.session_id, created);
          if (created.working_dir || workingDir) {
            this.sessionWorkingDirs.set(
              created.session_id,
              created.working_dir || workingDir!,
            );
          }
          this.newlyCreatedSessions.add(created.session_id);
          this.activeSessionId = created.session_id;
          this.streamingBySession.set(created.session_id, false);
          this.setTurnStreaming(false);
          this.backgroundTasksBySession.set(created.session_id, new Map());
          this.broadcastProcessesSnapshot();
          this.syncBackgroundPollTimer();
          await this.host.workspaceState.update(
            ACTIVE_SESSION_KEY,
            created.session_id,
          );
          this.emit("stateChanged");
          return created;
        });
        replyCallback({ ...replyMeta, ev: "attached", session });
        return;
      }

      if (req === "attach_session" && typeof apiReq.session_id === "string") {
        const targetSessionId = apiReq.session_id;
        const session = await this.socketPool.runSerialized(async () => {
          const { client, reused } =
            await this.socketPool.acquireForSession(targetSessionId);
          let attached: SessionInfo;
          if (reused && this.sessionInfoCache.has(targetSessionId)) {
            attached = this.sessionInfoCache.get(targetSessionId)!;
          } else if (reused) {
            const listed = await client
              .listSessions({ includeArchived: true, limit: 200 })
              .catch(() => []);
            attached =
              listed.find((s) => s.session_id === targetSessionId) ??
              (await client.attachSession(targetSessionId));
          } else {
            attached = await client.attachSession(targetSessionId);
            this.socketPool.register(attached.session_id, client);
          }
          this.sessionInfoCache.set(attached.session_id, attached);
          if (attached.working_dir) {
            this.sessionWorkingDirs.set(attached.session_id, attached.working_dir);
          }
          this.socketPool.setFocusedSession(attached.session_id);
          this.activeSessionId = attached.session_id;
          if (!reused) {
            this.streamingBySession.set(attached.session_id, false);
          }
          this.setTurnStreaming(
            this.streamingBySession.get(attached.session_id) ?? false,
          );
          this.broadcastProcessesSnapshot();
          this.syncBackgroundPollTimer();
          void this.refreshBackgroundProcesses(attached.session_id).catch(() => {});
          await this.host.workspaceState.update(
            ACTIVE_SESSION_KEY,
            attached.session_id,
          );
          this.emit("stateChanged");
          return attached;
        });
        replyCallback({ ...replyMeta, ev: "attached", session });
        return;
      }

      if (req === "send_message" && typeof apiReq.session_id === "string") {
        const sessionId = apiReq.session_id;
        const client = await this.ensureSessionClient(sessionId);
        const content = typeof apiReq.content === "string" ? apiReq.content : "";
        const images = normalizeImageAttachments(apiReq.images);
        const reminder =
          typeof apiReq.system_reminder === "string"
            ? apiReq.system_reminder
            : undefined;
        const rawRequestedModel =
          typeof apiReq.model === "string" && apiReq.model.trim()
            ? apiReq.model.trim()
            : undefined;
        const requestedProvider =
          typeof apiReq.provider === "string" && apiReq.provider.trim()
            ? apiReq.provider.trim()
            : undefined;
        const requestedApiMethod =
          typeof apiReq.api_method === "string" && apiReq.api_method.trim()
            ? apiReq.api_method.trim()
            : typeof apiReq.apiMethod === "string" && apiReq.apiMethod.trim()
              ? apiReq.apiMethod.trim()
              : undefined;
        const requestedModelSpec = rawRequestedModel
          ? formatHarnessModelSpec(
              rawRequestedModel,
              requestedProvider,
              requestedApiMethod,
            )
          : "";
        const requestedEffort =
          typeof apiReq.effort === "string" && apiReq.effort.trim()
            ? apiReq.effort.trim()
            : undefined;

        const explicitDir =
          typeof apiReq.working_dir === "string" && apiReq.working_dir.trim()
            ? apiReq.working_dir.trim()
            : undefined;
        const resolvedWorkingDir =
          explicitDir ??
          this.sessionWorkingDirs.get(sessionId) ??
          this.host.getWorkspaceFolders()[0]?.fsPath;

        if (
          resolvedWorkingDir &&
          (this.newlyCreatedSessions.has(sessionId) || Boolean(explicitDir))
        ) {
          this.newlyCreatedSessions.delete(sessionId);
          await this.workspaceRegistry
            .attachSession(resolvedWorkingDir, sessionId)
            .catch(() => {});
        }

        const activeModelSpec = this.activeModel
          ? formatHarnessModelSpec(this.activeModel, this.activeProvider)
          : "";

        if (requestedModelSpec && requestedModelSpec !== activeModelSpec) {
          await client.setModel(sessionId, requestedModelSpec);
          if (!this.activeSessionId || this.activeSessionId === sessionId) {
            this.activeModel = requestedModelSpec;
            if (requestedProvider) {
              this.activeProvider = requestedProvider;
            } else if (requestedModelSpec.startsWith("rayu:")) {
              this.activeProvider = "rayu";
            }
          }
          this.emit("stateChanged");
        }
        if (requestedEffort) {
          await client
            .setReasoningEffort(sessionId, requestedEffort)
            .catch(() => {});
        }

        this.socketPool.markTurnActive(sessionId);
        try {
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
        } catch (err) {
          this.socketPool.markTurnSettled(sessionId);
          throw err;
        }
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      if (req === "cancel" && typeof apiReq.session_id === "string") {
        await this.cancelSession(apiReq.session_id);
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      if (
        req === "permission_response" &&
        typeof apiReq.session_id === "string" &&
        typeof apiReq.request_id === "string"
      ) {
        const rawDecision = String(apiReq.decision ?? "deny");
        const decision: "allow_once" | "allow_always" | "deny" =
          rawDecision === "allow_always"
            ? "allow_always"
            : rawDecision === "allow" || rawDecision === "allow_once"
              ? "allow_once"
              : "deny";
        await this.respondPermission({
          sessionId: apiReq.session_id,
          requestId: apiReq.request_id,
          decision,
        });
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      const reqSessionId =
        typeof apiReq.session_id === "string" ? apiReq.session_id : undefined;
      const client = await this.getClient(reqSessionId);

      if (
        req === "set_model" &&
        typeof apiReq.session_id === "string" &&
        typeof apiReq.model === "string"
      ) {
        const requestedProvider =
          typeof apiReq.provider === "string" && apiReq.provider.trim()
            ? apiReq.provider.trim()
            : undefined;
        const requestedApiMethod =
          typeof apiReq.api_method === "string" && apiReq.api_method.trim()
            ? apiReq.api_method.trim()
            : typeof apiReq.apiMethod === "string" && apiReq.apiMethod.trim()
              ? apiReq.apiMethod.trim()
              : undefined;
        const modelSpec = formatHarnessModelSpec(
          apiReq.model,
          requestedProvider,
          requestedApiMethod,
        );
        if (modelSpec) {
          await client.setModel(apiReq.session_id, modelSpec);
          if (!this.activeSessionId || this.activeSessionId === apiReq.session_id) {
            this.activeModel = modelSpec;
            if (requestedProvider) {
              this.activeProvider = requestedProvider;
            } else if (modelSpec.startsWith("rayu:")) {
              this.activeProvider = "rayu";
            }
          }
          this.emit("stateChanged");
        }
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      if (req === "set_permission_mode" && typeof apiReq.session_id === "string") {
        const uiMode = fromHarnessPermissionMode(
          String(apiReq.mode ?? "default"),
        );
        await this.setPermissionMode(apiReq.session_id, uiMode);
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      if (req === "soft_interrupt" && typeof apiReq.session_id === "string") {
        const content = typeof apiReq.content === "string" ? apiReq.content : "";
        const images = normalizeImageAttachments(apiReq.images);
        const urgent = apiReq.urgent === true;
        const clientId =
          typeof apiReq.client_id === "string" && apiReq.client_id.length > 0
            ? apiReq.client_id
            : undefined;
        await client.softInterruptWithId(apiReq.session_id, content, {
          urgent,
          clientId,
          ...(images.length > 0 ? { images } : {}),
        });
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      if (
        req === "cancel_soft_interrupts" &&
        typeof apiReq.session_id === "string"
      ) {
        const clientIds = Array.isArray(apiReq.client_ids)
          ? apiReq.client_ids.filter(
              (x): x is string => typeof x === "string" && x.length > 0,
            )
          : [];
        if (
          clientIds.length > 0 &&
          (typeof client.supports !== "function" ||
            client.supports("soft_interrupt_ids"))
        ) {
          const res = await client.cancelSoftInterruptsById(
            apiReq.session_id,
            clientIds,
          );
          replyCallback({
            ...replyMeta,
            ev: "soft_interrupts_cancelled",
            cancelled: res.cancelled,
            not_queued: res.notQueued,
          });
          return;
        }
        await client.cancelSoftInterrupts(apiReq.session_id);
        replyCallback({ ...replyMeta, ev: "ok" });
        return;
      }

      const response = await client.request(
        apiReq as unknown as Parameters<RayucodeClient["request"]>[0],
      );
      replyCallback({ ...response, ...replyMeta });
    } catch (error) {
      const code = error instanceof HarnessError ? error.code : "internal";
      const message =
        error instanceof Error
          ? error.message
          : "Rayu could not complete the request.";
      const sessionId =
        typeof rawFrame.session_id === "string" ? rawFrame.session_id : undefined;
      replyCallback({
        ...replyMeta,
        ev: "error",
        ...(sessionId ? { session_id: sessionId } : {}),
        code,
        message,
      });
    }
  }

  async refreshBackgroundProcesses(
    sessionId?: string,
  ): Promise<BackgroundProcessView[]> {
    const normalizedSessionId =
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.trim()
        : undefined;
    const targetSessionId = normalizedSessionId ?? this.activeSessionId;
    if (!targetSessionId) {
      if (!this.activeSessionId) {
        this.broadcastProcessesSnapshot();
      }
      this.syncBackgroundPollTimer();
      return [];
    }
    try {
      const out = await this.runtimeCommand(
        "background",
        ["list", "session"],
        targetSessionId,
      );
      const data =
        typeof out.data === "object" && out.data !== null
          ? (out.data as Record<string, unknown>)
          : {};
      const rawTasks = Array.isArray(data.tasks) ? data.tasks : [];
      const nextMap = new Map<string, BackgroundProcessView>();
      for (const item of rawTasks) {
        if (typeof item === "object" && item !== null) {
          const rec = item as Record<string, unknown>;
          const explicitSessionId =
            typeof rec.session_id === "string" && rec.session_id.trim()
              ? rec.session_id.trim()
              : typeof rec.sessionId === "string" && rec.sessionId.trim()
                ? rec.sessionId.trim()
                : undefined;
          if (explicitSessionId && explicitSessionId !== targetSessionId) {
            continue;
          }
          const mapped = mapRawBackgroundTask(rec, targetSessionId);
          nextMap.set(mapped.taskId, {
            ...mapped,
            sessionId: targetSessionId,
          });
        }
      }
      this.backgroundTasksBySession.set(targetSessionId, nextMap);
      if (targetSessionId === this.activeSessionId) {
        this.broadcastProcessesSnapshot();
        this.syncBackgroundPollTimer();
      }
    } catch {
      // keep existing snapshot if bridge is offline
    }
    return this.getBackgroundTasks(targetSessionId);
  }

  removeCompletedBackgroundTasks(sessionId?: string): number {
    const targetSessionId = sessionId ?? this.activeSessionId;
    if (!targetSessionId) {
      return 0;
    }
    const sessionTasks = this.backgroundTasksBySession.get(targetSessionId);
    let removed = 0;
    if (sessionTasks) {
      for (const [id, task] of sessionTasks.entries()) {
        if (
          task.status === "completed" ||
          task.status === "failed" ||
          task.status === "superseded"
        ) {
          sessionTasks.delete(id);
          removed += 1;
        }
      }
    }
    if (targetSessionId === this.activeSessionId) {
      this.broadcastProcessesSnapshot();
      this.syncBackgroundPollTimer();
    }
    return removed;
  }

  private broadcastProcessesSnapshot(): void {
    const sessionId = this.activeSessionId;
    const tasks = this.getBackgroundTasks(sessionId);
    this.broadcast({
      type: "rayucode.processes.snapshot",
      sessionId,
      tasks,
    });
    this.emit("processesChanged", tasks);
    this.emit("stateChanged");
  }

  private syncBackgroundPollTimer(): void {
    const hasRunning = this.getBackgroundTasks(this.activeSessionId).some(
      (t) => t.status === "running" || t.status === "stalled",
    );
    if (hasRunning && !this.backgroundPollTimer) {
      this.backgroundPollTimer = setInterval(() => {
        if (this.activeSessionId) {
          void this.refreshBackgroundProcesses(this.activeSessionId);
        }
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
    this.streamingBySession.clear();
    this.isTurnStreaming = false;
    this.workspaceUnsub?.();
    this.workspaceUnsub = null;
    this.folderWatchDisposable?.dispose();
    this.folderWatchDisposable = null;
    if (this.ownsWorkspaceRegistry) {
      this.workspaceRegistry.dispose();
    }
    this.socketPool.closeAll();
    this.surfaces.clear();
  }
}
