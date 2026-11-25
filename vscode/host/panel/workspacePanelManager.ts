import { randomBytes } from "node:crypto";
import type * as vscode from "vscode";
import {
  AccentPreferenceSchema,
  AppRouteSchema,
  DensityPreferenceSchema,
  OpenLocationSchema,
  ThemePreferenceSchema,
  parseWebviewToHostMessage,
  type AccentPreference,
  type AppRoute,
  type DensityPreference,
  type HostToWebviewMessage,
  type OpenLocation,
  type ProjectIconView,
  type SurfaceKind,
  type ThemePreference,
  type WebviewToHostMessage,
  type WorkbenchPreferences,
  type WorkspaceFolderView,
} from "../../shared/vscodeProtocol.js";
import type { RayuHostAuthManager } from "../auth/rayuHostAuthManager.js";
import type { EditorBridge } from "../bridges/editorBridge.js";
import type { GitChangesBridge } from "../bridges/gitChangesBridge.js";
import type { BridgeManager } from "../runtime/bridgeManager.js";
import type { FeatureRouter } from "../runtime/featureRouters.js";
import type { SessionHub } from "../runtime/sessionHub.js";

function getVscode(): typeof vscode {
  return require("vscode") as typeof vscode;
}

export const SIDEBAR_VIEW_ID = "rayucode.chat";
export const WORKSPACE_PANEL_VIEW_TYPE = "rayucode.workspace";
export const SIDEBAR_SURFACE_ID = "sidebar-main";
export const EDITOR_PANEL_SURFACE_ID = "editor-panel-main";

export type SurfaceId = typeof SIDEBAR_SURFACE_ID | typeof EDITOR_PANEL_SURFACE_ID;

const THEME_STATE_KEY = "rayucode.appearance.theme";
const ACCENT_STATE_KEY = "rayucode.appearance.accent";
const DENSITY_STATE_KEY = "rayucode.appearance.density";
const REDUCE_MOTION_KEY = "rayucode.appearance.reduceMotion";
const PROJECT_ICONS_KEY = "rayucode.workspace.projectIcons";

export interface SurfaceCommandQueueOptions {
  maxPerSurface?: number;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Pure per-surface cold-start command queue with bounded capacity and TTL.
 * Ensures one-shot commands (context injections, navigation, new/resume session)
 * are delivered deterministically to a single target surface and never dropped
 * during webview cold start.
 */
export class SurfaceCommandQueue<TMessage = HostToWebviewMessage> {
  private readonly readySurfaces = new Set<string>();
  private readonly pendingBySurface = new Map<
    string,
    Array<{ message: TMessage; expiresAt: number }>
  >();
  private readonly maxPerSurface: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: SurfaceCommandQueueOptions = {}) {
    this.maxPerSurface = Math.max(1, options.maxPerSurface ?? 10);
    this.ttlMs = Math.max(0, options.ttlMs ?? 15_000);
    this.now = options.now ?? (() => Date.now());
  }

  isReady(surfaceId: string): boolean {
    return this.readySurfaces.has(surfaceId);
  }

  /**
   * Mark a surface ready and return all non-expired pending messages for it in FIFO order.
   */
  markReady(surfaceId: string): TMessage[] {
    this.readySurfaces.add(surfaceId);
    return this.flush(surfaceId);
  }

  /**
   * Mark a surface as no longer ready (e.g. on dispose).
   * Preserves buffered messages by default so a pending cold-start launch
   * isn't lost if an old instance disposes right before a replacement attaches.
   */
  markDisposed(surfaceId: string, clearPending = false): void {
    this.readySurfaces.delete(surfaceId);
    if (clearPending) {
      this.pendingBySurface.delete(surfaceId);
    }
  }

  /**
   * Deliver directly to `surfaceId` if ready and registered; otherwise enqueue
   * for flush immediately after `rayucode.host.init`.
   */
  dispatch(
    surfaceId: string,
    message: TMessage,
    deliver: (targetSurfaceId: string, msg: TMessage) => boolean,
  ): "delivered" | "queued" {
    if (this.readySurfaces.has(surfaceId) && deliver(surfaceId, message)) {
      return "delivered";
    }
    this.enqueue(surfaceId, message);
    return "queued";
  }

  enqueue(surfaceId: string, message: TMessage): void {
    const currentTime = this.now();
    const existing = this.pruneExpired(surfaceId, currentTime);
    existing.push({
      message,
      expiresAt: currentTime + this.ttlMs,
    });
    if (existing.length > this.maxPerSurface) {
      existing.splice(0, existing.length - this.maxPerSurface);
    }
    this.pendingBySurface.set(surfaceId, existing);
  }

  flush(surfaceId: string): TMessage[] {
    const currentTime = this.now();
    const valid = this.pruneExpired(surfaceId, currentTime);
    this.pendingBySurface.delete(surfaceId);
    return valid.map((entry) => entry.message);
  }

  pendingCount(surfaceId: string): number {
    return this.pruneExpired(surfaceId, this.now()).length;
  }

  clear(): void {
    this.readySurfaces.clear();
    this.pendingBySurface.clear();
  }

  private pruneExpired(
    surfaceId: string,
    currentTime: number,
  ): Array<{ message: TMessage; expiresAt: number }> {
    const entries = this.pendingBySurface.get(surfaceId);
    if (!entries || entries.length === 0) return [];
    const valid = entries.filter((entry) => entry.expiresAt > currentTime);
    if (valid.length === 0) {
      this.pendingBySurface.delete(surfaceId);
    } else if (valid.length !== entries.length) {
      this.pendingBySurface.set(surfaceId, valid);
    }
    return valid;
  }
}

export class WorkspacePanelManager
  implements
    vscode.WebviewViewProvider,
    vscode.WebviewPanelSerializer,
    vscode.Disposable
{
  private sidebarView?: vscode.WebviewView;
  private sidebarDisposable?: vscode.Disposable;
  private editorPanel?: vscode.WebviewPanel;
  private editorPanelDisposable?: vscode.Disposable;
  private currentRoute: AppRoute = "home";
  private readonly disposables: vscode.Disposable[] = [];
  private readonly surfaceQueue = new SurfaceCommandQueue<HostToWebviewMessage>({
    maxPerSurface: 10,
    ttlMs: 15_000,
  });

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly bridgeManager: BridgeManager,
    private readonly sessionHub: SessionHub,
    private readonly featureRouter: FeatureRouter,
    private readonly editorBridge: EditorBridge,
    private readonly gitBridge: GitChangesBridge,
    private readonly authManager?: RayuHostAuthManager,
  ) {
    const vscodeApi = getVscode();
    this.disposables.push(
      vscodeApi.workspace.onDidChangeWorkspaceFolders(() => {
        void this.broadcastWorkspacesChanged();
      }),
      vscodeApi.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("rayucode.theme") ||
          event.affectsConfiguration("rayucode.accent")
        ) {
          const cfg = vscodeApi.workspace.getConfiguration("rayucode");
          if (event.affectsConfiguration("rayucode.theme")) {
            void this.context.globalState.update(
              THEME_STATE_KEY,
              cfg.get<string>("theme", "auto"),
            );
          }
          if (event.affectsConfiguration("rayucode.accent")) {
            void this.context.globalState.update(
              ACCENT_STATE_KEY,
              cfg.get<string>("accent", "green"),
            );
          }
          this.broadcastAppearanceSync();
        }
        if (
          event.affectsConfiguration("rayucode.openLocation") ||
          event.affectsConfiguration("rayucode.contextActionsAutoSubmit") ||
          event.affectsConfiguration("rayucode.showEditorTitleIcon")
        ) {
          this.broadcastWorkbenchSync();
        }
        if (
          event.affectsConfiguration("rayucode.apiSocketPath") ||
          event.affectsConfiguration("rayucode.runtime.socketPath") ||
          event.affectsConfiguration("rayucode.binaryPath")
        ) {
          void this.bridgeManager.reconnect();
        }
      }),
    );
  }

  getWorkbenchSettings(): WorkbenchPreferences {
    const vscodeApi = getVscode();
    const cfg = vscodeApi.workspace.getConfiguration("rayucode");
    const rawLocation = cfg.get<string>("openLocation", "secondarySidebar");
    const parsedLocation = OpenLocationSchema.safeParse(rawLocation);
    return {
      openLocation: parsedLocation.success
        ? parsedLocation.data
        : "secondarySidebar",
      contextActionsAutoSubmit: Boolean(
        cfg.get<boolean>("contextActionsAutoSubmit", false),
      ),
      showEditorTitleIcon: Boolean(
        cfg.get<boolean>("showEditorTitleIcon", true),
      ),
    };
  }

  async updateWorkbenchSettings(
    patch: Partial<WorkbenchPreferences>,
  ): Promise<void> {
    const vscodeApi = getVscode();
    const cfg = vscodeApi.workspace.getConfiguration("rayucode");
    if (patch.openLocation !== undefined) {
      await Promise.resolve(
        cfg.update(
          "openLocation",
          patch.openLocation,
          vscodeApi.ConfigurationTarget.Global,
        ),
      ).catch(() => {});
    }
    if (patch.contextActionsAutoSubmit !== undefined) {
      await Promise.resolve(
        cfg.update(
          "contextActionsAutoSubmit",
          patch.contextActionsAutoSubmit,
          vscodeApi.ConfigurationTarget.Global,
        ),
      ).catch(() => {});
    }
    if (patch.showEditorTitleIcon !== undefined) {
      await Promise.resolve(
        cfg.update(
          "showEditorTitleIcon",
          patch.showEditorTitleIcon,
          vscodeApi.ConfigurationTarget.Global,
        ),
      ).catch(() => {});
    }
    this.broadcastWorkbenchSync();
  }

  private broadcastWorkbenchSync(): void {
    this.sessionHub.broadcast({
      type: "rayucode.ui.workbenchSync",
      workbench: this.getWorkbenchSettings(),
    });
  }

  getAppearance(): {
    theme: ThemePreference;
    accent: AccentPreference;
    density: DensityPreference;
    reduceMotion: boolean;
  } {
    const vscodeApi = getVscode();
    const cfg = vscodeApi.workspace.getConfiguration("rayucode");
    const inspectedTheme = cfg.inspect<string>("theme");
    const configuredTheme =
      inspectedTheme?.workspaceFolderValue ??
      inspectedTheme?.workspaceValue ??
      inspectedTheme?.globalValue;
    const inspectedAccent = cfg.inspect<string>("accent");
    const configuredAccent =
      inspectedAccent?.workspaceFolderValue ??
      inspectedAccent?.workspaceValue ??
      inspectedAccent?.globalValue;

    const rawTheme =
      configuredTheme ??
      this.context.globalState.get<string>(THEME_STATE_KEY) ??
      cfg.get<string>("theme", "auto");
    const rawAccent =
      configuredAccent ??
      this.context.globalState.get<string>(ACCENT_STATE_KEY) ??
      cfg.get<string>("accent", "green");
    const rawDensity =
      this.context.globalState.get<string>(DENSITY_STATE_KEY) ?? "comfortable";
    const reduceMotion = this.context.globalState.get<boolean>(
      REDUCE_MOTION_KEY,
      false,
    );

    const themeParsed = ThemePreferenceSchema.safeParse(rawTheme);
    const accentParsed = AccentPreferenceSchema.safeParse(rawAccent);
    const densityParsed = DensityPreferenceSchema.safeParse(rawDensity);

    return {
      theme: themeParsed.success ? themeParsed.data : "auto",
      accent: accentParsed.success ? accentParsed.data : "green",
      density: densityParsed.success ? densityParsed.data : "comfortable",
      reduceMotion,
    };
  }

  async setAppearance(patch: {
    theme?: ThemePreference;
    accent?: AccentPreference;
    density?: DensityPreference;
    reduceMotion?: boolean;
  }): Promise<void> {
    const vscodeApi = getVscode();
    const cfg = vscodeApi.workspace.getConfiguration("rayucode");
    if (patch.theme !== undefined) {
      await this.context.globalState.update(THEME_STATE_KEY, patch.theme);
      await Promise.resolve(
        cfg.update("theme", patch.theme, vscodeApi.ConfigurationTarget.Global),
      ).catch(() => {});
    }
    if (patch.accent !== undefined) {
      await this.context.globalState.update(ACCENT_STATE_KEY, patch.accent);
      await Promise.resolve(
        cfg.update("accent", patch.accent, vscodeApi.ConfigurationTarget.Global),
      ).catch(() => {});
    }
    if (patch.density !== undefined) {
      await this.context.globalState.update(DENSITY_STATE_KEY, patch.density);
    }
    if (patch.reduceMotion !== undefined) {
      await this.context.globalState.update(
        REDUCE_MOTION_KEY,
        patch.reduceMotion,
      );
    }
    this.broadcastAppearanceSync();
  }

  private broadcastAppearanceSync(): void {
    const { theme, accent, density, reduceMotion } = this.getAppearance();
    this.sessionHub.broadcast({
      type: "rayucode.ui.appearanceSync",
      theme,
      accent,
      density,
      reduceMotion,
    });
  }

  getProjectIcons(): Record<string, ProjectIconView> {
    return this.context.globalState.get<Record<string, ProjectIconView>>(
      PROJECT_ICONS_KEY,
      {},
    );
  }

  async setProjectIcon(
    workspacePath: string,
    icon: ProjectIconView | null,
  ): Promise<void> {
    const current = { ...this.getProjectIcons() };
    if (icon === null) {
      delete current[workspacePath];
    } else {
      current[workspacePath] = icon;
    }
    await this.context.globalState.update(PROJECT_ICONS_KEY, current);
    await this.broadcastWorkspacesChanged();
  }

  async getWorkspaceFoldersView(): Promise<WorkspaceFolderView[]> {
    const vscodeApi = getVscode();
    const folders = vscodeApi.workspace.workspaceFolders ?? [];
    const icons = this.getProjectIcons();
    const views: WorkspaceFolderView[] = [];
    for (let i = 0; i < folders.length; i += 1) {
      const folder = folders[i]!;
      const fsPath = folder.uri.fsPath;
      const branch = await this.gitBridge
        .getBranch(fsPath)
        .catch(() => undefined);
      views.push({
        name: folder.name,
        path: fsPath,
        branch,
        icon: icons[fsPath],
        isPrimary: i === 0,
      });
    }
    return views;
  }

  private async broadcastWorkspacesChanged(): Promise<void> {
    const workspaces = await this.getWorkspaceFoldersView();
    this.sessionHub.broadcast({
      type: "rayucode.workspaces.changed",
      workspaces,
    });
  }

  private buildPanelIconPath(mediaUri: vscode.Uri): {
    light: vscode.Uri;
    dark: vscode.Uri;
  } {
    const vscodeApi = getVscode();
    const foxIconUri = vscodeApi.Uri.joinPath(mediaUri, "rayu-fox.png");
    return {
      light: foxIconUri,
      dark: foxIconUri,
    };
  }

  getEditorPanelViewColumn(): vscode.ViewColumn | undefined {
    return this.editorPanel?.viewColumn;
  }

  dispatchToSurface(
    surfaceId: string,
    message: HostToWebviewMessage,
  ): "delivered" | "queued" {
    return this.surfaceQueue.dispatch(surfaceId, message, (targetId, msg) =>
      this.sessionHub.postToSurface(targetId, msg),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.sidebarDisposable?.dispose();
    this.sidebarView = view;
    this.sidebarDisposable = this.attachWebviewSurface(
      view.webview,
      "sidebar",
      SIDEBAR_SURFACE_ID,
      view.onDidDispose,
      () => {
        if (this.sidebarView === view) {
          this.sidebarView = undefined;
        }
      },
    );
  }

  async deserializeWebviewPanel(
    panel: vscode.WebviewPanel,
    rawState: unknown,
  ): Promise<void> {
    const vscodeApi = getVscode();
    let restoredRoute: AppRoute | undefined;
    let restoredSessionId: string | undefined;

    if (rawState && typeof rawState === "object") {
      const rec = rawState as Record<string, unknown>;
      const parsedRoute = AppRouteSchema.safeParse(rec.route);
      if (parsedRoute.success) {
        restoredRoute = parsedRoute.data;
      }
      if (typeof rec.sessionId === "string" && rec.sessionId.trim()) {
        restoredSessionId = rec.sessionId.trim();
      }
    }

    if (restoredRoute) {
      this.currentRoute = restoredRoute;
    }

    const mediaUri = vscodeApi.Uri.joinPath(this.context.extensionUri, "media");
    panel.iconPath = this.buildPanelIconPath(mediaUri);

    this.editorPanel = panel;
    this.editorPanelDisposable?.dispose();
    this.editorPanelDisposable = this.attachWebviewSurface(
      panel.webview,
      "editorPanel",
      EDITOR_PANEL_SURFACE_ID,
      panel.onDidDispose,
      () => {
        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
        }
      },
      {
        route: restoredRoute,
        sessionId: restoredSessionId,
      },
    );
  }

  async openWorkspacePanel(options: {
    route?: AppRoute;
    sessionId?: string;
    openProcessesDrawer?: boolean;
    viewColumn?: vscode.ViewColumn;
  } = {}): Promise<void> {
    const vscodeApi = getVscode();
    if (options.route) {
      this.currentRoute = options.route;
    }

    if (this.editorPanel) {
      this.editorPanel.reveal(
        options.viewColumn ?? this.editorPanel.viewColumn,
        false,
      );
      if (options.route || options.sessionId || options.openProcessesDrawer) {
        this.dispatchToSurface(EDITOR_PANEL_SURFACE_ID, {
          type: "rayucode.ui.navigate",
          route: options.route ?? this.currentRoute,
          sessionId: options.sessionId ?? this.sessionHub.getActiveSessionId(),
          openProcessesDrawer: options.openProcessesDrawer,
        });
      }
      return;
    }

    const mediaUri = vscodeApi.Uri.joinPath(this.context.extensionUri, "media");
    const targetColumn =
      options.viewColumn ??
      (vscodeApi.window.activeTextEditor
        ? vscodeApi.ViewColumn.Beside
        : vscodeApi.ViewColumn.One);

    const panel = vscodeApi.window.createWebviewPanel(
      WORKSPACE_PANEL_VIEW_TYPE,
      "RayuCode Mission Control",
      targetColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaUri],
      },
    );
    panel.iconPath = this.buildPanelIconPath(mediaUri);

    this.editorPanel = panel;
    this.editorPanelDisposable?.dispose();
    this.editorPanelDisposable = this.attachWebviewSurface(
      panel.webview,
      "editorPanel",
      EDITOR_PANEL_SURFACE_ID,
      panel.onDidDispose,
      () => {
        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
        }
      },
      options,
    );
  }

  async openPreferredSurface(options: {
    locationOverride?: OpenLocation;
    route?: AppRoute;
    sessionId?: string;
    openProcessesDrawer?: boolean;
  } = {}): Promise<SurfaceId> {
    const vscodeApi = getVscode();
    const effective =
      options.locationOverride ?? this.getWorkbenchSettings().openLocation;

    if (options.route) {
      this.currentRoute = options.route;
    }

    if (effective === "beside") {
      await this.openWorkspacePanel({
        route: options.route,
        sessionId: options.sessionId,
        openProcessesDrawer: options.openProcessesDrawer,
        viewColumn: vscodeApi.ViewColumn.Beside,
      });
      return EDITOR_PANEL_SURFACE_ID;
    }

    if (effective === "editorTab") {
      await this.openWorkspacePanel({
        route: options.route,
        sessionId: options.sessionId,
        openProcessesDrawer: options.openProcessesDrawer,
        viewColumn: vscodeApi.ViewColumn.Active,
      });
      return EDITOR_PANEL_SURFACE_ID;
    }

    await vscodeApi.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
    if (options.route || options.sessionId || options.openProcessesDrawer) {
      this.dispatchToSurface(SIDEBAR_SURFACE_ID, {
        type: "rayucode.ui.navigate",
        route: options.route ?? this.currentRoute,
        sessionId: options.sessionId ?? this.sessionHub.getActiveSessionId(),
        openProcessesDrawer: options.openProcessesDrawer,
      });
    }
    return SIDEBAR_SURFACE_ID;
  }

  async navigateAll(options: {
    route: AppRoute;
    sessionId?: string;
    openProcessesDrawer?: boolean;
    preferEditorPanel?: boolean;
  }): Promise<void> {
    this.currentRoute = options.route;
    const navMsg: HostToWebviewMessage = {
      type: "rayucode.ui.navigate",
      route: options.route,
      sessionId: options.sessionId ?? this.sessionHub.getActiveSessionId(),
      openProcessesDrawer: options.openProcessesDrawer,
    };

    if (options.preferEditorPanel || this.editorPanel) {
      await this.openWorkspacePanel({
        route: options.route,
        sessionId: options.sessionId,
        openProcessesDrawer: options.openProcessesDrawer,
      });
      return;
    }

    const surfaceId = await this.openPreferredSurface({
      route: options.route,
      sessionId: options.sessionId,
      openProcessesDrawer: options.openProcessesDrawer,
    });
    if (surfaceId !== SIDEBAR_SURFACE_ID && surfaceId !== EDITOR_PANEL_SURFACE_ID) {
      this.dispatchToSurface(surfaceId, navMsg);
    }
  }

  sendHostCommand(command: string, payload?: unknown): void {
    this.sessionHub.broadcast({
      type: "rayucode.host.command",
      command,
      payload,
    });
  }

  private attachWebviewSurface(
    webview: vscode.Webview,
    surface: SurfaceKind,
    surfaceId: string,
    onDidDispose: vscode.Event<void>,
    onCleanup: () => void,
    initialNav?: {
      route?: AppRoute;
      sessionId?: string;
      openProcessesDrawer?: boolean;
    },
  ): vscode.Disposable {
    const vscodeApi = getVscode();
    const mediaUri = vscodeApi.Uri.joinPath(this.context.extensionUri, "media");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaUri],
    };

    const postToSurface = (message: HostToWebviewMessage): void => {
      void webview.postMessage(message);
    };

    const hubRegistration = this.sessionHub.registerSurface(
      surfaceId,
      surface,
      postToSurface,
    );

    const sendInit = async (): Promise<void> => {
      const { theme, accent, density, reduceMotion } = this.getAppearance();
      const workbench = this.getWorkbenchSettings();
      const mediaBaseUri = webview
        .asWebviewUri(mediaUri)
        .toString()
        .replace(/\/$/, "");
      const workspaces = await this.getWorkspaceFoldersView();
      const daemonStatus = this.bridgeManager.getStatus();
      const route = initialNav?.route ?? this.currentRoute;
      const sessionId =
        initialNav?.sessionId ?? this.sessionHub.getActiveSessionId();
      const accountStatus = this.authManager
        ? this.authManager.getAccountStatusSnapshot()
        : undefined;
      const fileChanges = sessionId
        ? (this.sessionHub.getFileChangesSnapshot(sessionId) ?? null)
        : null;

      postToSurface({
        type: "rayucode.host.init",
        surface,
        mediaBaseUri,
        theme,
        accent,
        density,
        reduceMotion,
        route,
        sessionId,
        capabilities: daemonStatus.capabilities,
        daemonStatus,
        workspaces,
        editorSelection: this.editorBridge.getSelection(),
        backgroundTasks: sessionId
          ? this.sessionHub.getBackgroundTasks(sessionId)
          : [],
        ...(accountStatus ? { accountStatus } : {}),
        fileChanges,
        workbench,
      });

      if (initialNav?.openProcessesDrawer) {
        postToSurface({
          type: "rayucode.ui.navigate",
          route,
          sessionId,
          openProcessesDrawer: true,
        });
      }

      const queuedMessages = this.surfaceQueue.markReady(surfaceId);
      for (const queued of queuedMessages) {
        postToSurface(queued);
      }
    };

    const msgListener = webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!vscodeApi.workspace.isTrusted) return;
      await this.handleWebviewMessage(raw, postToSurface, sendInit);
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.surfaceQueue.markDisposed(surfaceId);
      hubRegistration.dispose();
      msgListener.dispose();
      disposeListener.dispose();
      onCleanup();
    };

    const disposeListener = onDidDispose(cleanup);

    webview.html = this.buildWebviewHtml(webview, mediaUri, surface);

    return new vscodeApi.Disposable(cleanup);
  }

  private async handleWebviewMessage(
    raw: unknown,
    postToSurface: (message: HostToWebviewMessage) => void,
    sendInit: () => Promise<void>,
  ): Promise<void> {
    const vscodeApi = getVscode();
    const parsed = parseWebviewToHostMessage(raw);
    if (!parsed.success) {
      if (
        typeof raw === "object" &&
        raw !== null &&
        (raw as Record<string, unknown>).type === "rayucode.rpc.call" &&
        typeof (raw as Record<string, unknown>).id === "number"
      ) {
        postToSurface({
          type: "rayucode.rpc.result",
          id: (raw as { id: number }).id,
          ok: false,
          code: "VALIDATION_ERROR",
          error: parsed.error.message,
        });
      }
      return;
    }

    const message: WebviewToHostMessage = parsed.data;

    switch (message.type) {
      case "rayucode.webview.ready": {
        await sendInit();
        void this.bridgeManager.ensureConnected().catch(() => {});
        if (this.authManager?.getAccountStatusSnapshot().signedIn) {
          void this.authManager.getAccountStatus(false).catch(() => {});
        }
        break;
      }
      case "rayucode.rpc.call": {
        const result = await this.featureRouter.dispatch(
          message.id,
          message.method,
          message.params,
        );
        postToSurface(result);
        break;
      }
      case "rayucode.harness.request": {
        await this.sessionHub.handleHarnessRequest(message.frame, (replyFrame) => {
          postToSurface({
            type: "rayucode.harness.frame",
            frame: replyFrame,
          });
        });
        break;
      }
      case "rayucode.ui.openEditorPanel": {
        await this.openWorkspacePanel({
          route: message.route,
          sessionId: message.sessionId,
          viewColumn:
            message.beside !== false
              ? vscodeApi.ViewColumn.Beside
              : vscodeApi.ViewColumn.Active,
        });
        break;
      }
      case "rayucode.ui.focusSidebar": {
        await vscodeApi.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
        break;
      }
      case "rayucode.ui.setAppearance": {
        await this.setAppearance({
          theme: message.theme,
          accent: message.accent,
          density: message.density,
          reduceMotion: message.reduceMotion,
        });
        break;
      }
      case "rayucode.ui.setWorkbench": {
        await this.updateWorkbenchSettings({
          openLocation: message.openLocation,
          contextActionsAutoSubmit: message.contextActionsAutoSubmit,
          showEditorTitleIcon: message.showEditorTitleIcon,
        });
        break;
      }
      case "rayucode.editor.openFile": {
        await this.editorBridge.openFile({
          path: message.path,
          line: message.line,
          column: message.column,
          preview: message.preview,
        });
        break;
      }
      case "rayucode.editor.openDiff": {
        const resolvedSessionId =
          message.sessionId ?? this.sessionHub.getActiveSessionId();
        const diff = await this.featureRouter.call("changes.diff", {
          path: message.path,
          sessionId: resolvedSessionId,
          scope: message.scope,
        });
        await this.editorBridge.openDiff({
          path: diff.path || message.path,
          originalContent: diff.originalContent,
          modifiedContent: diff.modifiedContent,
          sessionId: resolvedSessionId,
          scope: message.scope,
          isCreated: diff.kind === "created",
          isDeleted: diff.kind === "deleted",
        });
        break;
      }
      case "rayucode.editor.insertCode": {
        await this.editorBridge.insertCode({
          code: message.code,
          mode: message.mode,
          languageId: message.languageId,
        });
        break;
      }
      case "rayucode.editor.openTerminal": {
        this.editorBridge.openTerminal({
          cwd: message.cwd,
          name: message.name,
        });
        break;
      }
      case "rayucode.editor.openWorktreeWindow": {
        await this.editorBridge.openWorktreeWindow(message.path);
        break;
      }
      case "rayucode.editor.openMarkdownPreview": {
        await this.editorBridge.openMarkdownPreview(message.path);
        break;
      }
      case "rayucode.editor.openSimpleBrowser": {
        await this.editorBridge.openSimpleBrowser(message.url);
        break;
      }
      case "rayucode.editor.openExternal": {
        await this.editorBridge.openExternal(message.url);
        break;
      }
      case "rayucode.editor.copy":
      case "rayucode.host.copyToClipboard": {
        await this.editorBridge.copyToClipboard(message.text);
        break;
      }
      case "rayucode.dialog.pickFiles": {
        const paths = await this.editorBridge.pickFiles({
          canSelectMany: message.canSelectMany,
          filters: message.filters,
        });
        postToSurface({
          type: "rayucode.dialog.filesPicked",
          requestId: message.requestId,
          paths,
        });
        break;
      }
      case "rayucode.dialog.pickFolder": {
        const paths = await this.editorBridge.pickFiles({
          canSelectMany: false,
          canSelectFolders: true,
        });
        postToSurface({
          type: "rayucode.dialog.filesPicked",
          requestId: message.requestId,
          paths,
        });
        break;
      }
    }
  }

  buildWebviewHtml(
    webview: vscode.Webview,
    mediaUri: vscode.Uri,
    surface: SurfaceKind,
  ): string {
    const vscodeApi = getVscode();
    const nonce = randomBytes(18).toString("base64");
    const mediaBaseUri = webview
      .asWebviewUri(mediaUri)
      .toString()
      .replace(/\/$/, "");
    const cssUri = webview.asWebviewUri(
      vscodeApi.Uri.joinPath(mediaUri, "webview.css"),
    );
    const jsUri = webview.asWebviewUri(
      vscodeApi.Uri.joinPath(mediaUri, "webview.js"),
    );

    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: https:`,
      "connect-src 'none'",
    ].join("; ");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta property="csp-nonce" nonce="${nonce}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${cssUri}">
    <title>RayuCode</title>
  </head>
  <body data-surface="${surface}">
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__RAYU_MEDIA_BASE__ = ${JSON.stringify(mediaBaseUri)};
      window.__RAYU_SURFACE__ = ${JSON.stringify(surface)};
    </script>
    <script nonce="${nonce}" type="module" src="${jsUri}"></script>
  </body>
</html>`;
  }

  dispose(): void {
    this.surfaceQueue.clear();
    this.sidebarDisposable?.dispose();
    this.editorPanelDisposable?.dispose();
    this.editorPanel?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
