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
  isTodoToolEvent,
  normalizeSessionSource,
  normalizeTodoItems,
  sessionSourceToFilterGroup,
} from "@rayu-dev/rayucode-session-core/client";
import {
  fromHarnessPermissionMode,
  toHarnessPermissionMode,
  type AccountStatusView,
  type AppletStateView,
  type BackgroundProcessView,
  type CacheTtl,
  type DaemonStatusView,
  type EffortLevel,
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
  type PendingPermissionView,
  type PermissionModeId,
  type ProjectIconView,
  type RiskTier,
  type ServiceTier,
  type SessionHistoryView,
  type SessionSourceId,
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
export const SESSION_PREFS_KEY = "rayucode.sessions.composerPrefs";
export const ACTIVE_SESSION_KEY = "rayucode.sessions.activeSessionId";

export interface StoredSessionComposerPrefs {
  model?: string;
  provider?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionModeId;
  serviceTier?: ServiceTier;
  cacheTtl?: CacheTtl;
}

const VALID_EFFORT_LEVELS = new Set<EffortLevel>([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function normalizeStoredEffort(raw: unknown): EffortLevel | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase() as EffortLevel;
  return VALID_EFFORT_LEVELS.has(trimmed) ? trimmed : undefined;
}

export interface SessionHubWorkspaceFolder {
  name: string;
  fsPath: string;
}

export interface SessionHubMemento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void> | void;
}

const SYNTHETIC_EXTERNAL_SESSION_RE =
  /^(claude_code|claude_desktop|codex|codex_desktop|cursor|opencode|pi):(.+)$/;

export function parseSyntheticExternalSessionId(
  sessionId: string,
): { source: SessionSourceId; externalSessionId: string } | null {
  const match = SYNTHETIC_EXTERNAL_SESSION_RE.exec(sessionId.trim());
  if (!match) return null;
  const source = match[1] as SessionSourceId;
  const externalSessionId = match[2]?.trim() ?? "";
  if (!externalSessionId) return null;
  return { source, externalSessionId };
}

export interface SessionHubHostAdapter {
  workspaceState: SessionHubMemento;
  getWorkspaceFolders(): SessionHubWorkspaceFolder[];
  getDefaultPermissionModeRaw(): string;
  setDefaultPermissionMode?(mode: PermissionModeId): PromiseLike<void> | void;
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
  private readonly todoRefreshSeqBySession = new Map<string, number>();
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
  private readonly pendingModelBySession = new Map<
    string,
    { modelSpec: string; provider?: string }
  >();
  private readonly pendingEffortBySession = new Map<string, string>();
  private readonly pendingPermissionModeBySession = new Map<
    string,
    PermissionModeId
  >();
  private readonly pendingPermissionsBySession = new Map<
    string,
    PendingPermissionView[]
  >();
  private readonly resolvedExternalSessionIds = new Map<string, string>();
  private readonly resolvingExternalSessionPromises = new Map<
    string,
    Promise<string>
  >();
  private readonly appliedModelBySession = new Map<string, string>();
  private readonly appliedEffortBySession = new Map<string, string>();

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
          this.appliedModelBySession.delete(sessionId);
          this.appliedEffortBySession.delete(sessionId);
          this.clearPendingPermissionsForSession(sessionId);
          if (sessionId === this.activeSessionId) {
            this.isTurnStreaming = false;
          }
        }
        this.emit("stateChanged");
      },
      onClientEvicted: (sessionId) => {
        if (sessionId) {
          this.appliedModelBySession.delete(sessionId);
          this.appliedEffortBySession.delete(sessionId);
        }
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

    this.bridgeManager.on("disconnected", () => {
      this.socketPool.closeAll();
      this.streamingBySession.clear();
      this.appliedModelBySession.clear();
      this.appliedEffortBySession.clear();
      this.pendingModelBySession.clear();
      this.pendingEffortBySession.clear();
      this.pendingPermissionModeBySession.clear();
      this.pendingPermissionsBySession.clear();
      this.isTurnStreaming = false;
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
    if (latest === null) {
      this.broadcast({
        type: "rayucode.workspaces.ledgerChanged",
        ledger: ledgerView,
      });
    }
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

  async setDefaultPermissionMode(
    mode: PermissionModeId,
    options?: { applyToActiveSession?: boolean },
  ): Promise<{ ok: boolean; mode: PermissionModeId; deferred?: boolean }> {
    await this.host.setDefaultPermissionMode?.(mode);
    if (!this.activeSessionId) {
      this.activePermissionMode = mode;
    }
    this.broadcast({
      type: "rayucode.permission.modeSync",
      mode,
      isDefault: true,
    });
    this.emit("stateChanged");
    if (options?.applyToActiveSession && this.activeSessionId) {
      return this.setPermissionMode(this.activeSessionId, mode);
    }
    return { ok: true, mode };
  }

  broadcastDefaultPermissionModeSync(): void {
    const mode = this.getDefaultPermissionMode();
    if (!this.activeSessionId) {
      this.activePermissionMode = mode;
    }
    this.broadcast({
      type: "rayucode.permission.modeSync",
      mode,
      isDefault: true,
    });
    this.emit("stateChanged");
  }

  getPendingPermissionsSnapshot(): Record<string, PendingPermissionView[]> {
    const snapshot: Record<string, PendingPermissionView[]> = {};
    for (const [sid, list] of this.pendingPermissionsBySession.entries()) {
      if (list.length > 0) {
        snapshot[sid] = [...list];
      }
    }
    return snapshot;
  }

  private recordPendingPermission(perm: PendingPermissionView): void {
    const sid = perm.sessionId;
    if (!sid || !perm.requestId) return;
    const existing = this.pendingPermissionsBySession.get(sid) ?? [];
    const idx = existing.findIndex((item) => item.requestId === perm.requestId);
    const next =
      idx >= 0
        ? existing.map((item, i) => (i === idx ? perm : item))
        : [...existing, perm];
    this.pendingPermissionsBySession.set(sid, next);
    this.socketPool.markPermissionPending(sid, true);
    this.emit("stateChanged");
  }

  private removePendingPermission(sessionId: string, requestId?: string): void {
    const existing = this.pendingPermissionsBySession.get(sessionId);
    if (!existing || existing.length === 0) {
      if (!requestId) {
        this.socketPool.markPermissionPending(sessionId, false);
      }
      return;
    }
    const next = requestId
      ? existing.filter((item) => item.requestId !== requestId)
      : [];
    if (next.length === 0) {
      this.pendingPermissionsBySession.delete(sessionId);
      this.socketPool.markPermissionPending(sessionId, false);
    } else {
      this.pendingPermissionsBySession.set(sessionId, next);
    }
    this.emit("stateChanged");
  }

  private clearPendingPermissionsForSession(sessionId: string): void {
    if (!sessionId) return;
    if (this.pendingPermissionsBySession.has(sessionId)) {
      this.pendingPermissionsBySession.delete(sessionId);
      this.socketPool.markPermissionPending(sessionId, false);
    }
  }

  private clientSupportsPermissionModes(client: RayucodeClient): boolean {
    if (typeof client.supports !== "function") return true;
    return client.supports("permission_modes") || client.supports("permissions");
  }

  async resolveAttachableSessionId(sessionId: string): Promise<string> {
    const trimmed = sessionId.trim();
    if (!trimmed) return trimmed;
    const alreadyMapped = this.resolvedExternalSessionIds.get(trimmed);
    if (alreadyMapped) return alreadyMapped;

    const cached = this.sessionInfoCache.get(trimmed);
    const parsed = parseSyntheticExternalSessionId(trimmed);
    const isUnimportedCached = Boolean(
      cached &&
        cached.imported === false &&
        typeof cached.external_session_id === "string" &&
        cached.external_session_id.trim().length > 0,
    );
    if (!parsed && !isUnimportedCached) {
      return trimmed;
    }

    const inFlight = this.resolvingExternalSessionPromises.get(trimmed);
    if (inFlight) return inFlight;

    const task = (async (): Promise<string> => {
      const source =
        (typeof cached?.source === "string" && cached.source.trim()) ||
        parsed?.source ||
        "claude_code";
      const externalSessionId =
        (typeof cached?.external_session_id === "string" &&
          cached.external_session_id.trim()) ||
        parsed?.externalSessionId ||
        trimmed;
      const res = await this.importExternalSessions([
        {
          source,
          externalSessionId,
          ...(cached?.external_path ? { externalPath: cached.external_path } : {}),
          ...(cached?.working_dir ? { workingDir: cached.working_dir } : {}),
        },
      ]);
      const imported = res.sessions[0];
      if (imported?.sessionId) {
        this.resolvedExternalSessionIds.set(trimmed, imported.sessionId);
        return imported.sessionId;
      }
      const skippedWithExisting = res.skipped.find((s) =>
        Boolean(s.existingSessionId),
      );
      if (skippedWithExisting?.existingSessionId) {
        this.resolvedExternalSessionIds.set(
          trimmed,
          skippedWithExisting.existingSessionId,
        );
        return skippedWithExisting.existingSessionId;
      }
      const skipDetail = res.skipped[0]?.message || res.skipped[0]?.reason;
      throw new HarnessError(
        "not_found",
        skipDetail
          ? `Could not import external session '${trimmed}': ${skipDetail}`
          : `Could not import external session '${trimmed}'. Ensure the RayuCode daemon is up to date and the source transcript exists on disk.`,
      );
    })().finally(() => {
      this.resolvingExternalSessionPromises.delete(trimmed);
    });

    this.resolvingExternalSessionPromises.set(trimmed, task);
    return task;
  }

  getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  getSessionWorkingDir(sessionId?: string): string | undefined {
    const sid = sessionId ?? this.activeSessionId;
    if (!sid) return undefined;
    return this.sessionWorkingDirs.get(sid);
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
    if (sessionId && !next) {
      this.flushPendingNextTurnSettings(sessionId);
    }
  }

  private isSessionTurnActive(sessionId: string): boolean {
    if (!sessionId) return false;
    return (
      Boolean(this.streamingBySession.get(sessionId)) ||
      this.socketPool.getActiveTurnSessionIds().includes(sessionId)
    );
  }

  private isTimeoutError(error: unknown): boolean {
    if (error instanceof HarnessError && error.code === "timeout") {
      return true;
    }
    const msg = error instanceof Error ? error.message : String(error ?? "");
    return /\btimeout\b|timed out/i.test(msg);
  }

  private flushPendingNextTurnSettings(sessionId: string): void {
    const hasPendingModel = this.pendingModelBySession.has(sessionId);
    const hasPendingEffort = this.pendingEffortBySession.has(sessionId);
    const hasPendingPerm = this.pendingPermissionModeBySession.has(sessionId);
    if (!hasPendingModel && !hasPendingEffort && !hasPendingPerm) return;

    void (async () => {
      if (this.isSessionTurnActive(sessionId)) return;
      const client = this.socketPool.get(sessionId);
      if (!client) return;

      const pendingPerm = this.pendingPermissionModeBySession.get(sessionId);
      if (pendingPerm && !this.isSessionTurnActive(sessionId)) {
        try {
          await client.setPermissionMode(
            sessionId,
            toHarnessPermissionMode(pendingPerm),
          );
          if (this.pendingPermissionModeBySession.get(sessionId) === pendingPerm) {
            this.pendingPermissionModeBySession.delete(sessionId);
          }
        } catch {
          // Keep queued so the next send_message applies it.
        }
      }

      const pendingModel = this.pendingModelBySession.get(sessionId);
      if (pendingModel && !this.isSessionTurnActive(sessionId)) {
        try {
          await client.setModel(sessionId, pendingModel.modelSpec);
          if (
            this.pendingModelBySession.get(sessionId)?.modelSpec ===
            pendingModel.modelSpec
          ) {
            this.pendingModelBySession.delete(sessionId);
          }
          this.appliedModelBySession.set(sessionId, pendingModel.modelSpec);
        } catch {
          // Keep queued in pendingModelBySession so the next send_message applies it.
        }
      }

      const pendingEffort = this.pendingEffortBySession.get(sessionId);
      if (pendingEffort && !this.isSessionTurnActive(sessionId)) {
        try {
          await client.setReasoningEffort(sessionId, pendingEffort);
          if (this.pendingEffortBySession.get(sessionId) === pendingEffort) {
            this.pendingEffortBySession.delete(sessionId);
          }
          this.appliedEffortBySession.set(sessionId, pendingEffort);
        } catch {
          // Keep queued in pendingEffortBySession so the next send_message applies it.
        }
      }
    })();
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

  setCachedTodos(sessionId: string, todos: TodoItemView[]): void {
    this.todosBySession.set(sessionId, todos);
  }

  broadcastTodos(sessionId: string, todos: TodoItemView[]): void {
    this.todosBySession.set(sessionId, todos);
    this.broadcast({
      type: "rayucode.todos.updated",
      sessionId,
      todos,
    });
    this.emit("todosUpdated", { sessionId, todos });
  }

  private clientSupportsTodoState(client: RayucodeClient): boolean {
    if (typeof client.todoState !== "function") {
      return false;
    }
    if (typeof client.supports === "function") {
      return client.supports("todo_state");
    }
    const caps = this.bridgeManager.getStatus().capabilities;
    return caps.length === 0 || caps.includes("todo_state");
  }

  async refreshAndBroadcastTodos(sessionId: string): Promise<TodoItemView[]> {
    const resolvedId = await this.resolveAttachableSessionId(sessionId).catch(
      () => sessionId,
    );
    const seq = (this.todoRefreshSeqBySession.get(resolvedId) ?? 0) + 1;
    this.todoRefreshSeqBySession.set(resolvedId, seq);
    try {
      const client = await this.ensureAttachedClient(resolvedId);
      if (!this.clientSupportsTodoState(client)) {
        return this.todosBySession.get(resolvedId) ?? [];
      }
      const snapshot = await client.todoState(resolvedId);
      const todos = this.mapTodoSnapshot(snapshot);
      if (this.todoRefreshSeqBySession.get(resolvedId) === seq) {
        this.broadcastTodos(resolvedId, todos);
      }
      return todos;
    } catch {
      return this.todosBySession.get(resolvedId) ?? [];
    }
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
    const rawSid = sessionId ?? this.activeSessionId;
    if (!rawSid) return null;
    try {
      const sid = await this.resolveAttachableSessionId(rawSid);
      const client = await this.ensureAttachedClient(sid);
      if (!this.clientSupportsFileChanges(client)) {
        return this.fileChangesBySession.get(sid) ?? null;
      }
      const raw = await client.getFileChanges(sid);
      const snapshot = mapRawFileChangesSnapshot(raw, sid);
      this.fileChangesBySession.set(sid, snapshot);
      return snapshot;
    } catch {
      return this.fileChangesBySession.get(rawSid) ?? null;
    }
  }

  async getFileChangeDiff(
    sessionId: string,
    filePath: string,
  ): Promise<FileDiffView | null> {
    const sid = await this.resolveAttachableSessionId(sessionId);
    const client = await this.ensureAttachedClient(sid);
    if (!this.clientSupportsFileChanges(client)) {
      return null;
    }
    const targetPath = this.resolveTrackedFilePath(sid, filePath);
    const raw = await client.getFileChangeDiff(sid, targetPath);
    return mapRawFileChangeDiff(raw, filePath);
  }

  async runFileChangeAction(
    sessionId: string,
    action: FileChangeActionKind,
    opts?: { path?: string; force?: boolean },
  ): Promise<FileChangeActionResultView | null> {
    const sid = await this.resolveAttachableSessionId(sessionId);
    const client = await this.ensureAttachedClient(sid);
    if (!this.clientSupportsFileChanges(client)) {
      return null;
    }
    const snapshot = mapRawFileChangesSnapshot(await client.getFileChanges(sid), sid);
    const target = opts?.path === undefined
      ? undefined
      : snapshot.files.find((file) => file.path === opts.path || file.displayPath === opts.path);
    if (snapshot.sessionId !== sid || (opts?.path !== undefined && !target)) {
      return { ok: false, message: "This file has no review snapshot in the selected session." };
    }
    try {
      const raw = await client.fileChangeAction(sid, action, {
        ...(target ? { path: target.path } : {}),
        ...(opts?.force ? { force: true } : {}),
      });
      const mapped = mapRawFileChangeActionResponse(raw, sid);
      if (mapped.snapshot?.sessionId === sid) {
        this.broadcastFileChanges(sid, mapped.snapshot);
      }
      return mapped;
    } finally {
      const latest = await this.fetchFileChanges(sid);
      if (latest?.sessionId === sid) this.broadcastFileChanges(sid, latest);
    }
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
    const attachedClient = this.activeSessionId
      ? this.socketPool.get(this.activeSessionId)
      : undefined;
    const activeClient = attachedClient ?? this.bridgeManager.getActiveClient();
    if (!activeClient) return;
    await activeClient.notifyAuthChanged(provider).catch(() => {});
    if (this.activeSessionId && attachedClient) {
      await attachedClient
        .runtimeCommand(this.activeSessionId, "refresh_model_list", [])
        .catch(() => {});
    }
  }

  async setDaemonApiKey(provider: string, apiKey: string): Promise<void> {
    const client =
      (this.activeSessionId
        ? this.socketPool.get(this.activeSessionId)
        : undefined) ?? this.bridgeManager.getActiveClient();
    if (!client) return;
    await client.setApiKey(provider, apiKey);
  }

  async clearDaemonApiKey(provider: string): Promise<void> {
    const client =
      (this.activeSessionId
        ? this.socketPool.get(this.activeSessionId)
        : undefined) ?? this.bridgeManager.getActiveClient();
    if (!client) return;
    await client.clearApiKey(provider);
  }

  async logoutDaemonProvider(provider: string): Promise<void> {
    const sid = this.activeSessionId;
    if (!sid) return;
    await this.runtimeCommand("logout", [provider, "confirm"], sid);
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

  /**
   * Return a client guaranteed to be attached to `sessionId` (or the active session),
   * attaching on demand via the session socket pool so `REQUIRES_ATTACH` RPCs never
   * fail with `unknown_session` on unattached or evicted sockets.
   */
  async ensureAttachedClient(sessionId?: string): Promise<RayucodeClient> {
    const target = sessionId ?? this.activeSessionId;
    if (target) {
      return this.ensureSessionClient(target);
    }
    return this.bridgeManager.ensureConnected();
  }

  private async ensureSessionClient(sessionId: string): Promise<RayucodeClient> {
    const resolvedId = await this.resolveAttachableSessionId(sessionId);
    const existing = this.socketPool.get(resolvedId);
    if (existing) return existing;

    return this.socketPool.runSerialized(async () => {
      const already = this.socketPool.get(resolvedId);
      if (already) return already;
      const { client, reused } = await this.socketPool.acquireForSession(resolvedId);
      if (!reused) {
        try {
          const attached = await client.attachSession(resolvedId);
          this.socketPool.register(attached.session_id, client);
          this.sessionInfoCache.set(attached.session_id, attached);
          if (attached.working_dir) {
            this.sessionWorkingDirs.set(attached.session_id, attached.working_dir);
          }
          const savedPrefs = this.getSessionPrefs(attached.session_id);
          const desiredMode =
            savedPrefs?.permissionMode ?? this.getDefaultPermissionMode();
          if (
            (savedPrefs?.permissionMode !== undefined ||
              desiredMode !== "default") &&
            this.clientSupportsPermissionModes(client)
          ) {
            await client
              .setPermissionMode(
                attached.session_id,
                toHarnessPermissionMode(desiredMode),
              )
              .catch(() => {});
          }
        } catch (err) {
          try {
            client.close();
          } catch {
            // ignore close errors on failed attach
          }
          throw err;
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

    // Session-bound sockets always stamp session_id via SessionSocketPool.
    // An unsolicited sessionless error/stop (e.g. "daemon connection closed"
    // from an unbound or one-shot control socket) must never terminate or
    // broadcast onto whichever unrelated session happens to be focused.
    if (
      !resolvedSessionId &&
      frame.reply_to === undefined &&
      (frame.ev === "error" ||
        frame.ev === "turn_stopped" ||
        frame.ev === "turn_aborted")
    ) {
      return;
    }

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
        if (resolvedSessionId) {
          this.clearPendingPermissionsForSession(resolvedSessionId);
        }
        this.setSessionTurnStreaming(resolvedSessionId, isFocusedSession, false);
        break;
      }
      case "session_status": {
        if (typeof frame.status === "string") {
          const status = frame.status.trim().toLowerCase();
          if (
            status === "running" ||
            status === "processing" ||
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
          if (resolvedSessionId) {
            this.clearPendingPermissionsForSession(resolvedSessionId);
          }
          this.setSessionTurnStreaming(
            resolvedSessionId,
            isFocusedSession,
            false,
          );
        }
        break;
      }
      case "permission_request": {
        if (
          resolvedSessionId &&
          typeof frame.request_id === "string" &&
          frame.request_id.trim()
        ) {
          const rawTier = frame.risk_tier;
          const riskTier: RiskTier | undefined =
            rawTier === "safe" ||
            rawTier === "bounded" ||
            rawTier === "confirm" ||
            rawTier === "catastrophic" ||
            rawTier === "hard_deny"
              ? rawTier
              : undefined;
          const toolName =
            typeof frame.tool_name === "string" ? frame.tool_name : "tool";
          const description =
            typeof frame.description === "string" && frame.description.trim()
              ? frame.description.trim()
              : `Allow RayuCode to run ${toolName}?`;
          this.recordPendingPermission({
            sessionId: resolvedSessionId,
            requestId: frame.request_id.trim(),
            toolName,
            description,
            ...(riskTier ? { riskTier } : {}),
          });
        }
        break;
      }
      case "permission_resolved": {
        if (resolvedSessionId) {
          const reqId =
            typeof frame.request_id === "string" ? frame.request_id.trim() : "";
          this.removePendingPermission(resolvedSessionId, reqId || undefined);
          if (reqId) {
            const rawDecision = String(frame.decision ?? "allow");
            const decision: "allow_once" | "allow_always" | "deny" =
              rawDecision === "allow_always"
                ? "allow_always"
                : rawDecision === "deny"
                  ? "deny"
                  : "allow_once";
            this.broadcast({
              type: "rayucode.permission.resolved",
              sessionId: resolvedSessionId,
              requestId: reqId,
              decision,
            });
          }
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
            void this.saveSessionPrefs(resolvedSessionId, {
              permissionMode: uiMode,
            });
          }
          this.broadcast({
            type: "rayucode.permission.modeSync",
            ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {}),
            mode: uiMode,
          });
          this.emit("stateChanged");
        }
        break;
      }
      case "model_info":
      case "runtime_info": {
        if (resolvedSessionId) {
          if (typeof frame.model === "string" && frame.model.trim()) {
            const formatted = formatHarnessModelSpec(
              frame.model,
              typeof frame.provider === "string" ? frame.provider : undefined,
            );
            if (formatted) {
              this.appliedModelBySession.set(resolvedSessionId, formatted);
            }
          }
          const rawEffort =
            typeof frame.reasoning_effort === "string"
              ? frame.reasoning_effort.trim()
              : typeof frame.effort === "string"
                ? frame.effort.trim()
                : "";
          if (rawEffort) {
            this.appliedEffortBySession.set(resolvedSessionId, rawEffort);
          }
        }
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
            updated_at_ms: Date.now(),
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
        if (frame.done === true) {
          void this.refreshBackgroundProcesses(frameSessionId).catch(() => {});
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
          this.broadcastTodos(resolvedSessionId, todos);
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
      case "config_changed": {
        const changedKeys = Array.isArray(frame.changed_keys)
          ? frame.changed_keys.filter((k): k is string => typeof k === "string")
          : [];
        const values =
          frame.values && typeof frame.values === "object" && !Array.isArray(frame.values)
            ? (frame.values as Record<string, unknown>)
            : {};
        this.broadcast({
          type: "rayucode.config.changed",
          changedKeys,
          requiresRestart: frame.requires_restart === true,
          values,
        });
        break;
      }
      case "tool_done": {
        if (
          resolvedSessionId &&
          typeof frame.name === "string" &&
          !frame.error &&
          [
            "edit",
            "write",
            "multiedit",
            "patch",
            "edit_file",
            "write_file",
            "multi_edit",
            "apply_patch",
          ].includes(frame.name)
        ) {
          this.emit("filesChanged", resolvedSessionId);
          void this.fetchFileChanges(resolvedSessionId)
            .then((snapshot) => {
              if (snapshot) {
                this.broadcastFileChanges(resolvedSessionId, snapshot);
              }
            })
            .catch(() => {});
        }
        if (
          resolvedSessionId &&
          isTodoToolEvent(frame as Record<string, unknown>)
        ) {
          void this.refreshAndBroadcastTodos(resolvedSessionId);
        }
        break;
      }
    }

    this.broadcast({
      type: "rayucode.harness.frame",
      frame: frame as Record<string, unknown>,
    });
  }

  mapTodoSnapshot(snapshot: TodoSnapshot | unknown): TodoItemView[] {
    return normalizeTodoItems(snapshot);
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

  private getSessionPrefsMap(): Record<string, StoredSessionComposerPrefs> {
    return this.host.workspaceState.get<Record<string, StoredSessionComposerPrefs>>(
      SESSION_PREFS_KEY,
      {},
    );
  }

  getSessionPrefs(sessionId: string): StoredSessionComposerPrefs | undefined {
    if (!sessionId) return undefined;
    const stored = this.getSessionPrefsMap()[sessionId];
    const legacyMode = this.getPermissionModesMap()[sessionId];
    if (!stored && !legacyMode) return undefined;
    return {
      ...stored,
      ...(stored?.permissionMode
        ? { permissionMode: stored.permissionMode }
        : legacyMode
          ? { permissionMode: legacyMode }
          : {}),
    };
  }

  async saveSessionPrefs(
    sessionId: string,
    patch: Partial<StoredSessionComposerPrefs>,
  ): Promise<void> {
    if (!sessionId) return;
    const existingMap = this.getSessionPrefsMap();
    const prev = existingMap[sessionId] ?? {};
    const next: StoredSessionComposerPrefs = { ...prev };
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.provider !== undefined) next.provider = patch.provider;
    if (patch.effort !== undefined) next.effort = patch.effort;
    if (patch.permissionMode !== undefined) {
      next.permissionMode = patch.permissionMode;
    }
    if (patch.serviceTier !== undefined) next.serviceTier = patch.serviceTier;
    if (patch.cacheTtl !== undefined) next.cacheTtl = patch.cacheTtl;
    await this.host.workspaceState.update(SESSION_PREFS_KEY, {
      ...existingMap,
      [sessionId]: next,
    });
    if (patch.permissionMode !== undefined) {
      await this.saveSessionPermissionMode(sessionId, patch.permissionMode);
    }
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
    const hasPendingPermission =
      (this.pendingPermissionsBySession.get(info.session_id)?.length ?? 0) > 0;
    const rawStatus = (info.status ?? "idle").toLowerCase();
    const status = hasPendingPermission
      ? "waiting"
      : rawStatus === "running" ||
          rawStatus === "processing" ||
          rawStatus === "busy"
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

    const savedPrefs = this.getSessionPrefs(info.session_id);
    const resolvedPermissionMode =
      savedPrefs?.permissionMode ??
      (info.session_id === this.activeSessionId
        ? this.activePermissionMode
        : this.getDefaultPermissionMode());

    return {
      sessionId: info.session_id,
      title: info.save_label || info.title || info.agent_label || "Untitled session",
      workingDir: info.working_dir,
      status,
      model:
        savedPrefs?.model ??
        (info.session_id === this.activeSessionId ? this.activeModel : undefined),
      provider:
        savedPrefs?.provider ??
        (info.session_id === this.activeSessionId
          ? this.activeProvider
          : undefined),
      ...(savedPrefs?.effort ? { effort: savedPrefs.effort } : {}),
      ...(savedPrefs?.serviceTier ? { serviceTier: savedPrefs.serviceTier } : {}),
      ...(savedPrefs?.cacheTtl ? { cacheTtl: savedPrefs.cacheTtl } : {}),
      permissionMode: resolvedPermissionMode,
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
      effort?: EffortLevel;
      serviceTier?: ServiceTier;
      cacheTtl?: CacheTtl;
    } = {},
  ): Promise<SessionSummaryView> {
    return this.socketPool.runSerialized(async () => {
      const defaultDir =
        options.workingDir ??
        this.host.getWorkspaceFolders()[0]?.fsPath ??
        process.cwd();
      const client = await this.socketPool.dialFreshClient();
      let info: SessionInfo;
      try {
        info = await client.createSession({ workingDir: defaultDir });
      } catch (err) {
        try {
          client.close();
        } catch {
          // ignore close errors on failed create
        }
        throw err;
      }
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

      let resolvedModelSpec: string | undefined;
      let resolvedProvider: string | undefined = options.provider;
      if (options.model) {
        const modelSpec = formatHarnessModelSpec(
          options.model,
          options.provider,
          options.apiMethod,
        );
        if (modelSpec) {
          resolvedModelSpec = modelSpec;
          if (!resolvedProvider && modelSpec.startsWith("rayu:")) {
            resolvedProvider = "rayu";
          }
        }
      }
      const normalizedEffort = normalizeStoredEffort(options.effort);

      await this.saveSessionPrefs(info.session_id, {
        permissionMode: desiredMode,
        ...(resolvedModelSpec ? { model: resolvedModelSpec } : {}),
        ...(resolvedProvider ? { provider: resolvedProvider } : {}),
        ...(normalizedEffort ? { effort: normalizedEffort } : {}),
        ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
        ...(options.cacheTtl ? { cacheTtl: options.cacheTtl } : {}),
      });

      if (this.clientSupportsPermissionModes(client)) {
        await client
          .setPermissionMode(info.session_id, toHarnessPermissionMode(desiredMode))
          .catch(() => {});
      }
      this.broadcast({
        type: "rayucode.permission.modeSync",
        sessionId: info.session_id,
        mode: desiredMode,
      });
      if (resolvedModelSpec) {
        await client
          .setModel(info.session_id, resolvedModelSpec)
          .then(() => {
            this.appliedModelBySession.set(info.session_id, resolvedModelSpec!);
          })
          .catch(() => {});
        this.activeModel = resolvedModelSpec;
        if (resolvedProvider) {
          this.activeProvider = resolvedProvider;
        }
      }
      if (normalizedEffort) {
        await client
          .setReasoningEffort(info.session_id, normalizedEffort)
          .then(() => {
            this.appliedEffortBySession.set(info.session_id, normalizedEffort);
          })
          .catch(() => {});
      }

      const runtimeInfo = await client
        .getRuntimeInfo(info.session_id)
        .catch(() => null);
      if (runtimeInfo) {
        this.activeModel = resolvedModelSpec ?? runtimeInfo.model ?? this.activeModel;
        this.activeProvider =
          resolvedProvider ?? runtimeInfo.provider ?? this.activeProvider;
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
    const resolvedSessionId = await this.resolveAttachableSessionId(sessionId);
    return this.socketPool.runSerialized(async () => {
      const { client, reused } =
        await this.socketPool.acquireForSession(resolvedSessionId);
      let info: SessionInfo;
      if (reused) {
        const cached = this.sessionInfoCache.get(resolvedSessionId);
        if (cached) {
          info = cached;
        } else {
          const listed = await client
            .listSessions({ includeArchived: true, limit: 200 })
            .catch(() => []);
          info = listed.find((s) => s.session_id === resolvedSessionId) ?? {
            session_id: resolvedSessionId,
            status: this.streamingBySession.get(resolvedSessionId)
              ? "running"
              : "idle",
          };
        }
      } else {
        try {
          info = await client.attachSession(resolvedSessionId);
        } catch (err) {
          try {
            client.close();
          } catch {
            // ignore close errors on failed attach
          }
          throw err;
        }
        this.socketPool.register(info.session_id, client);
      }

      this.sessionInfoCache.set(info.session_id, info);
      if (info.working_dir) {
        this.sessionWorkingDirs.set(info.session_id, info.working_dir);
      }
      this.socketPool.setFocusedSession(info.session_id);
      this.activeSessionId = info.session_id;
      if (!reused) {
        const rawStatus = (info.status ?? "").toLowerCase();
        const isRunning =
          rawStatus === "running" ||
          rawStatus === "processing" ||
          rawStatus === "busy";
        this.streamingBySession.set(info.session_id, isRunning);
      }
      this.setTurnStreaming(this.streamingBySession.get(info.session_id) ?? false);
      this.broadcastProcessesSnapshot();
      this.syncBackgroundPollTimer();
      void this.refreshBackgroundProcesses(info.session_id).catch(() => {});
      await this.host.workspaceState.update(ACTIVE_SESSION_KEY, info.session_id);

      const savedPrefs = this.getSessionPrefs(info.session_id);
      const savedMode = savedPrefs?.permissionMode;
      const desiredMode = savedMode ?? this.getDefaultPermissionMode();
      this.activePermissionMode = desiredMode;
      if (
        !reused &&
        (savedMode !== undefined || desiredMode !== "default") &&
        this.clientSupportsPermissionModes(client)
      ) {
        await client
          .setPermissionMode(info.session_id, toHarnessPermissionMode(desiredMode))
          .catch(() => {});
      }
      if (savedPrefs?.effort && !reused && !this.isSessionTurnActive(info.session_id)) {
        await client
          .setReasoningEffort(info.session_id, savedPrefs.effort)
          .then(() => {
            this.appliedEffortBySession.set(info.session_id, savedPrefs.effort!);
          })
          .catch(() => {});
      }
      if (savedPrefs?.model) {
        this.activeModel = savedPrefs.model;
        if (savedPrefs.provider) {
          this.activeProvider = savedPrefs.provider;
        }
      }

      if (!reused) {
        const runtimeInfo = await client
          .getRuntimeInfo(info.session_id)
          .catch(() => null);
        if (runtimeInfo) {
          if (runtimeInfo.model) {
            const actualSpec = formatHarnessModelSpec(
              runtimeInfo.model,
              runtimeInfo.provider,
            );
            if (actualSpec) {
              this.appliedModelBySession.set(info.session_id, actualSpec);
            }
          }
          this.activeModel = savedPrefs?.model ?? runtimeInfo.model ?? this.activeModel;
          this.activeProvider =
            savedPrefs?.provider ?? runtimeInfo.provider ?? this.activeProvider;
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
  ): Promise<{ ok: boolean; mode: PermissionModeId; deferred?: boolean }> {
    const resolvedId = await this.resolveAttachableSessionId(sessionId);
    if (!this.activeSessionId || this.activeSessionId === resolvedId) {
      this.activePermissionMode = mode;
    }
    await this.saveSessionPrefs(resolvedId, { permissionMode: mode });

    // Rust daemon handles SetPermissionMode lock-free mid-turn, so apply immediately
    // and only defer to the next turn on a genuine timeout or busy error.
    const client = await this.ensureAttachedClient(resolvedId);
    const wireMode = toHarnessPermissionMode(mode);
    try {
      await client.setPermissionMode(resolvedId, wireMode);
      this.pendingPermissionModeBySession.delete(resolvedId);
    } catch (permErr) {
      if (
        this.isTimeoutError(permErr) ||
        (permErr instanceof HarnessError && permErr.code === "busy")
      ) {
        this.pendingPermissionModeBySession.set(resolvedId, mode);
        this.broadcast({
          type: "rayucode.permission.modeSync",
          sessionId: resolvedId,
          mode,
        });
        this.emit("stateChanged");
        return { ok: true, mode, deferred: true };
      }
      throw permErr;
    }
    this.broadcast({
      type: "rayucode.permission.modeSync",
      sessionId: resolvedId,
      mode,
    });
    this.emit("stateChanged");
    return { ok: true, mode };
  }

  async setSessionModel(
    sessionId: string,
    model: string,
    options: {
      provider?: string;
      apiMethod?: string;
      applyNextTurn?: boolean;
    } = {},
  ): Promise<{ ok: boolean; deferred?: boolean; code?: string; message?: string }> {
    const requestedProvider = options.provider?.trim() || undefined;
    const requestedApiMethod = options.apiMethod?.trim() || undefined;
    const modelSpec = formatHarnessModelSpec(
      model,
      requestedProvider,
      requestedApiMethod,
    );
    if (!modelSpec) {
      return { ok: true };
    }

    const effectiveProvider =
      requestedProvider ?? (modelSpec.startsWith("rayu:") ? "rayu" : undefined);
    await this.saveSessionPrefs(sessionId, {
      model: modelSpec,
      ...(effectiveProvider ? { provider: effectiveProvider } : {}),
    });

    const updateFocusedModel = () => {
      if (!this.activeSessionId || this.activeSessionId === sessionId) {
        this.activeModel = modelSpec;
        if (effectiveProvider) {
          this.activeProvider = effectiveProvider;
        }
      }
    };

    const deferForNextTurn =
      options.applyNextTurn === true || this.isSessionTurnActive(sessionId);
    if (deferForNextTurn) {
      this.pendingModelBySession.set(sessionId, {
        modelSpec,
        provider: effectiveProvider,
      });
      updateFocusedModel();
      this.emit("stateChanged");
      return { ok: true, deferred: true, message: "Applies on next turn" };
    }

    const client = await this.ensureAttachedClient(sessionId);
    try {
      await client.setModel(sessionId, modelSpec);
      this.pendingModelBySession.delete(sessionId);
      this.appliedModelBySession.set(sessionId, modelSpec);
    } catch (modelErr) {
      if (
        this.isTimeoutError(modelErr) ||
        (modelErr instanceof HarnessError && modelErr.code === "busy")
      ) {
        this.pendingModelBySession.set(sessionId, {
          modelSpec,
          provider: effectiveProvider,
        });
        updateFocusedModel();
        this.emit("stateChanged");
        return { ok: true, deferred: true, message: "Applies on next turn" };
      }
      throw modelErr;
    }

    updateFocusedModel();
    this.emit("stateChanged");
    return { ok: true };
  }

  async setSessionEffort(
    sessionId: string,
    rawEffort: string,
    options: { applyNextTurn?: boolean } = {},
  ): Promise<{ ok: boolean; deferred?: boolean; code?: string; message?: string }> {
    const effort = rawEffort.trim();
    if (!effort) {
      return { ok: true };
    }
    const normalizedEffort = normalizeStoredEffort(effort);
    if (normalizedEffort) {
      await this.saveSessionPrefs(sessionId, { effort: normalizedEffort });
    }

    const deferForNextTurn =
      options.applyNextTurn === true || this.isSessionTurnActive(sessionId);
    if (deferForNextTurn) {
      this.pendingEffortBySession.set(sessionId, effort);
      return { ok: true, deferred: true, message: "Applies on next turn" };
    }

    if (this.appliedEffortBySession.get(sessionId) === effort) {
      this.pendingEffortBySession.delete(sessionId);
      return { ok: true };
    }

    const client = await this.ensureAttachedClient(sessionId);
    try {
      await client.setReasoningEffort(sessionId, effort);
      this.pendingEffortBySession.delete(sessionId);
      this.appliedEffortBySession.set(sessionId, effort);
    } catch (effortErr) {
      if (
        this.isTimeoutError(effortErr) ||
        (effortErr instanceof HarnessError && effortErr.code === "busy")
      ) {
        this.pendingEffortBySession.set(sessionId, effort);
        return { ok: true, deferred: true, message: "Applies on next turn" };
      }
      throw effortErr;
    }
    return { ok: true };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const client = await this.ensureAttachedClient(sessionId);
    await client.cancel(sessionId);
  }

  async respondPermission(options: {
    sessionId: string;
    requestId: string;
    decision: "allow_once" | "allow_always" | "deny";
  }): Promise<void> {
    const client = await this.ensureAttachedClient(options.sessionId);
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
    this.removePendingPermission(options.sessionId, options.requestId);
    this.broadcast({
      type: "rayucode.permission.resolved",
      sessionId: options.sessionId,
      requestId: options.requestId,
      decision: options.decision,
    });
  }

  async getHistory(sessionId: string): Promise<SessionHistoryView> {
    const resolvedId = await this.resolveAttachableSessionId(sessionId);
    const client = await this.ensureAttachedClient(resolvedId);
    const { messages: rawMessages, images: rawImages } =
      await client.getHistoryWithImages(resolvedId);

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
        id: `hist_${resolvedId}_${idx}`,
        model:
          msg.role === "assistant" && resolvedId === this.activeSessionId
            ? this.activeModel
            : undefined,
        images: imagesByMessageIndex.get(idx),
      }),
    );

    return { sessionId: resolvedId, messages };
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
    if (!targetSessionId) {
      const control = await this.bridgeManager.ensureConnected();
      const listed = await control.listSessions({ limit: 1 }).catch(() => []);
      if (listed[0]) {
        targetSessionId = listed[0].session_id;
      } else {
        const created = await this.createSession();
        targetSessionId = created.sessionId;
      }
    }
    const client = await this.ensureAttachedClient(targetSessionId);
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
          const systemPrompt =
            typeof apiReq.system_prompt === "string"
              ? apiReq.system_prompt
              : undefined;
          const client = await this.socketPool.dialFreshClient();
          let created: SessionInfo;
          try {
            created = await client.createSession({
              workingDir,
              ...(systemPrompt !== undefined ? { systemPrompt } : {}),
            });
          } catch (err) {
            try {
              client.close();
            } catch {
              // ignore close errors on failed create
            }
            throw err;
          }
          this.socketPool.register(created.session_id, client);
          this.socketPool.setFocusedSession(created.session_id);
          this.sessionInfoCache.set(created.session_id, created);
          if (created.working_dir || workingDir) {
            this.sessionWorkingDirs.set(
              created.session_id,
              created.working_dir || workingDir!,
            );
          }
          const initialMode = this.getDefaultPermissionMode();
          if (
            initialMode !== "default" &&
            this.clientSupportsPermissionModes(client)
          ) {
            await client
              .setPermissionMode(
                created.session_id,
                toHarnessPermissionMode(initialMode),
              )
              .catch(() => {});
          }
          this.newlyCreatedSessions.add(created.session_id);
          this.activeSessionId = created.session_id;
          this.activePermissionMode = initialMode;
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
        const targetSessionId = await this.resolveAttachableSessionId(
          apiReq.session_id,
        );
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
            attached = listed.find((s) => s.session_id === targetSessionId) ?? {
              session_id: targetSessionId,
              status: this.streamingBySession.get(targetSessionId)
                ? "running"
                : "idle",
            };
          } else {
            try {
              attached = await client.attachSession(targetSessionId);
            } catch (err) {
              try {
                client.close();
              } catch {
                // ignore close errors on failed attach
              }
              throw err;
            }
            this.socketPool.register(attached.session_id, client);
          }
          const savedPrefs = this.getSessionPrefs(attached.session_id);
          const desiredMode =
            savedPrefs?.permissionMode ?? this.getDefaultPermissionMode();
          if (
            !reused &&
            (savedPrefs?.permissionMode !== undefined ||
              desiredMode !== "default") &&
            this.clientSupportsPermissionModes(client)
          ) {
            await client
              .setPermissionMode(
                attached.session_id,
                toHarnessPermissionMode(desiredMode),
              )
              .catch(() => {});
          }
          this.sessionInfoCache.set(attached.session_id, attached);
          if (attached.working_dir) {
            this.sessionWorkingDirs.set(attached.session_id, attached.working_dir);
          }
          this.socketPool.setFocusedSession(attached.session_id);
          this.activeSessionId = attached.session_id;
          this.activePermissionMode = desiredMode;
          if (!reused) {
            const rawStatus = (attached.status ?? "").toLowerCase();
            const isRunning =
              rawStatus === "running" ||
              rawStatus === "processing" ||
              rawStatus === "busy";
            this.streamingBySession.set(attached.session_id, isRunning);
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
        const sessionId = await this.resolveAttachableSessionId(
          apiReq.session_id,
        );
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

        const pendingModel = this.pendingModelBySession.get(sessionId);
        const pendingEffort = this.pendingEffortBySession.get(sessionId);
        const pendingPerm = this.pendingPermissionModeBySession.get(sessionId);
        this.pendingModelBySession.delete(sessionId);
        this.pendingEffortBySession.delete(sessionId);
        this.pendingPermissionModeBySession.delete(sessionId);

        if (pendingPerm) {
          try {
            await client.setPermissionMode(
              sessionId,
              toHarnessPermissionMode(pendingPerm),
            );
          } catch {
            // Non-fatal: keep proceeding with send_message
          }
        }

        const effectiveModelSpec = pendingModel?.modelSpec || requestedModelSpec;
        const effectiveProvider = pendingModel?.provider || requestedProvider;
        const effectiveEffort = pendingEffort || requestedEffort;
        const normalizedEffectiveEffort = normalizeStoredEffort(effectiveEffort);

        if (effectiveModelSpec || normalizedEffectiveEffort) {
          void this.saveSessionPrefs(sessionId, {
            ...(effectiveModelSpec ? { model: effectiveModelSpec } : {}),
            ...(effectiveProvider ? { provider: effectiveProvider } : {}),
            ...(normalizedEffectiveEffort
              ? { effort: normalizedEffectiveEffort }
              : {}),
          });
        }

        const appliedModelSpec = this.appliedModelBySession.get(sessionId) ?? "";

        if (effectiveModelSpec && effectiveModelSpec !== appliedModelSpec) {
          try {
            await client.setModel(sessionId, effectiveModelSpec);
            this.appliedModelBySession.set(sessionId, effectiveModelSpec);
          } catch (modelErr) {
            if (!this.isTimeoutError(modelErr)) {
              throw modelErr;
            }
          }
          if (!this.activeSessionId || this.activeSessionId === sessionId) {
            this.activeModel = effectiveModelSpec;
            if (effectiveProvider) {
              this.activeProvider = effectiveProvider;
            } else if (effectiveModelSpec.startsWith("rayu:")) {
              this.activeProvider = "rayu";
            }
          }
          this.emit("stateChanged");
        }

        const appliedEffort = this.appliedEffortBySession.get(sessionId);
        if (effectiveEffort && effectiveEffort !== appliedEffort) {
          try {
            await client.setReasoningEffort(sessionId, effectiveEffort);
            this.appliedEffortBySession.set(sessionId, effectiveEffort);
          } catch {
            // Non-fatal: model may not support effort or daemon is mid-handoff.
          }
        }

        const noReply = apiReq.no_reply === true;
        if (!noReply) {
          this.socketPool.markTurnActive(sessionId);
        }
        try {
          if (reminder && !noReply) {
            await client.sendMessageWithReminder(
              sessionId,
              content,
              images,
              reminder,
              { requireAccept: true, acceptTimeoutMs: 30_000 },
            );
          } else {
            await client.sendMessage(sessionId, content, {
              images,
              ...(reminder ? { systemReminder: reminder } : {}),
              ...(noReply ? { noReply: true } : { requireAccept: true, acceptTimeoutMs: 30_000 }),
            });
          }
        } catch (err) {
          if (!noReply) {
            this.socketPool.markTurnSettled(sessionId);
          }
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

      if (
        req === "set_model" &&
        typeof apiReq.session_id === "string" &&
        typeof apiReq.model === "string"
      ) {
        const res = await this.setSessionModel(apiReq.session_id, apiReq.model, {
          provider:
            typeof apiReq.provider === "string" ? apiReq.provider : undefined,
          apiMethod:
            typeof apiReq.api_method === "string"
              ? apiReq.api_method
              : typeof apiReq.apiMethod === "string"
                ? apiReq.apiMethod
                : undefined,
          applyNextTurn: apiReq.apply_next_turn === true,
        });
        replyCallback({
          ...replyMeta,
          ev: "ok",
          ...(res.deferred ? { deferred: true } : {}),
        });
        return;
      }

      if (
        req === "set_reasoning_effort" &&
        typeof apiReq.session_id === "string" &&
        typeof apiReq.effort === "string"
      ) {
        const res = await this.setSessionEffort(
          apiReq.session_id,
          apiReq.effort,
          { applyNextTurn: apiReq.apply_next_turn === true },
        );
        replyCallback({
          ...replyMeta,
          ev: "ok",
          ...(res.deferred ? { deferred: true } : {}),
        });
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

      const rawReqSessionId =
        typeof apiReq.session_id === "string" ? apiReq.session_id : undefined;
      const reqSessionId = rawReqSessionId
        ? await this.resolveAttachableSessionId(rawReqSessionId)
        : undefined;
      if (reqSessionId && reqSessionId !== rawReqSessionId) {
        apiReq.session_id = reqSessionId;
      }
      const client = reqSessionId
        ? await this.ensureAttachedClient(reqSessionId)
        : await this.getClient();

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
      const reqName = typeof rawFrame.req === "string" ? rawFrame.req : undefined;
      const isTurnMutation =
        reqName === "send_message" || reqName === "user_input";
      replyCallback({
        ...replyMeta,
        ev: "error",
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(reqName ? { req: reqName } : {}),
        ...(!isTurnMutation ? { non_turn: true } : {}),
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
    this.pendingModelBySession.clear();
    this.pendingEffortBySession.clear();
    this.pendingPermissionModeBySession.clear();
    this.appliedModelBySession.clear();
    this.appliedEffortBySession.clear();
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
