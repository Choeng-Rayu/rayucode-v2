import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  AccentPreferenceSchema,
  DensityPreferenceSchema,
  ThemePreferenceSchema,
  parseWebviewToHostMessage,
  type AccentPreference,
  type AppRoute,
  type DensityPreference,
  type HostToWebviewMessage,
  type ProjectIconView,
  type SurfaceKind,
  type ThemePreference,
  type WebviewToHostMessage,
  type WorkspaceFolderView,
} from "../../shared/vscodeProtocol.js";
import type { RayuHostAuthManager } from "../auth/rayuHostAuthManager.js";
import type { EditorBridge } from "../bridges/editorBridge.js";
import type { GitChangesBridge } from "../bridges/gitChangesBridge.js";
import type { BridgeManager } from "../runtime/bridgeManager.js";
import type { FeatureRouter } from "../runtime/featureRouters.js";
import type { SessionHub } from "../runtime/sessionHub.js";

export const SIDEBAR_VIEW_ID = "rayucode.chat";
export const WORKSPACE_PANEL_VIEW_TYPE = "rayucode.workspace";

const THEME_STATE_KEY = "rayucode.appearance.theme";
const ACCENT_STATE_KEY = "rayucode.appearance.accent";
const DENSITY_STATE_KEY = "rayucode.appearance.density";
const REDUCE_MOTION_KEY = "rayucode.appearance.reduceMotion";
const PROJECT_ICONS_KEY = "rayucode.workspace.projectIcons";

export class WorkspacePanelManager
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private sidebarView?: vscode.WebviewView;
  private sidebarDisposable?: vscode.Disposable;
  private editorPanel?: vscode.WebviewPanel;
  private editorPanelDisposable?: vscode.Disposable;
  private currentRoute: AppRoute = "home";
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly bridgeManager: BridgeManager,
    private readonly sessionHub: SessionHub,
    private readonly featureRouter: FeatureRouter,
    private readonly editorBridge: EditorBridge,
    private readonly gitBridge: GitChangesBridge,
    private readonly authManager?: RayuHostAuthManager,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.broadcastWorkspacesChanged();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("rayucode.theme") ||
          event.affectsConfiguration("rayucode.accent")
        ) {
          const cfg = vscode.workspace.getConfiguration("rayucode");
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
          event.affectsConfiguration("rayucode.apiSocketPath") ||
          event.affectsConfiguration("rayucode.runtime.socketPath") ||
          event.affectsConfiguration("rayucode.binaryPath")
        ) {
          void this.bridgeManager.reconnect();
        }
      }),
    );
  }

  getAppearance(): {
    theme: ThemePreference;
    accent: AccentPreference;
    density: DensityPreference;
    reduceMotion: boolean;
  } {
    const cfg = vscode.workspace.getConfiguration("rayucode");
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
    const cfg = vscode.workspace.getConfiguration("rayucode");
    if (patch.theme !== undefined) {
      await this.context.globalState.update(THEME_STATE_KEY, patch.theme);
      await Promise.resolve(
        cfg.update("theme", patch.theme, vscode.ConfigurationTarget.Global),
      ).catch(() => {});
    }
    if (patch.accent !== undefined) {
      await this.context.globalState.update(ACCENT_STATE_KEY, patch.accent);
      await Promise.resolve(
        cfg.update("accent", patch.accent, vscode.ConfigurationTarget.Global),
      ).catch(() => {});
    }
    if (patch.density !== undefined) {
      await this.context.globalState.update(DENSITY_STATE_KEY, patch.density);
    }
    if (patch.reduceMotion !== undefined) {
      await this.context.globalState.update(REDUCE_MOTION_KEY, patch.reduceMotion);
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
    const folders = vscode.workspace.workspaceFolders ?? [];
    const icons = this.getProjectIcons();
    const views: WorkspaceFolderView[] = [];
    for (let i = 0; i < folders.length; i += 1) {
      const folder = folders[i]!;
      const fsPath = folder.uri.fsPath;
      const branch = await this.gitBridge.getBranch(fsPath).catch(() => undefined);
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
    const [workspaces, workspaceLedger] = await Promise.all([
      this.getWorkspaceFoldersView(),
      this.sessionHub.syncOpenWorkspaceFolders().catch(() =>
        this.sessionHub.getWorkspaceLedger(),
      ),
    ]);
    this.sessionHub.broadcast({
      type: "rayucode.workspaces.changed",
      workspaces,
      workspaceLedger,
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.sidebarDisposable?.dispose();
    this.sidebarView = view;
    this.sidebarDisposable = this.attachWebviewSurface(
      view.webview,
      "sidebar",
      "sidebar-main",
      view.onDidDispose,
      () => {
        if (this.sidebarView === view) {
          this.sidebarView = undefined;
        }
      },
    );
  }

  async openWorkspacePanel(options: {
    route?: AppRoute;
    sessionId?: string;
    openProcessesDrawer?: boolean;
  } = {}): Promise<void> {
    if (options.route) {
      this.currentRoute = options.route;
    }

    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.One);
      if (options.route || options.sessionId || options.openProcessesDrawer) {
        void this.editorPanel.webview.postMessage({
          type: "rayucode.ui.navigate",
          route: options.route ?? this.currentRoute,
          sessionId: options.sessionId ?? this.sessionHub.getActiveSessionId(),
          openProcessesDrawer: options.openProcessesDrawer,
        } satisfies HostToWebviewMessage);
      }
      return;
    }

    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      WORKSPACE_PANEL_VIEW_TYPE,
      "RayuCode Mission Control",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaUri],
      },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(mediaUri, "icon.svg"),
      dark: vscode.Uri.joinPath(mediaUri, "icon.svg"),
    };

    this.editorPanel = panel;
    this.editorPanelDisposable?.dispose();
    this.editorPanelDisposable = this.attachWebviewSurface(
      panel.webview,
      "editorPanel",
      "editor-panel-main",
      panel.onDidDispose,
      () => {
        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
        }
      },
      options,
    );
  }

  async navigateAll(options: {
    route: AppRoute;
    sessionId?: string;
    openProcessesDrawer?: boolean;
    preferEditorPanel?: boolean;
  }): Promise<void> {
    this.currentRoute = options.route;
    if (options.preferEditorPanel || this.editorPanel) {
      await this.openWorkspacePanel({
        route: options.route,
        sessionId: options.sessionId,
        openProcessesDrawer: options.openProcessesDrawer,
      });
    } else {
      await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
    }

    this.sessionHub.broadcast({
      type: "rayucode.ui.navigate",
      route: options.route,
      sessionId: options.sessionId ?? this.sessionHub.getActiveSessionId(),
      openProcessesDrawer: options.openProcessesDrawer,
    });
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
    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, "media");
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
      const mediaBaseUri = webview.asWebviewUri(mediaUri).toString().replace(/\/$/, "");
      const workspaces = await this.getWorkspaceFoldersView();
      const workspaceLedger = await this.sessionHub
        .waitUntilWorkspacesReady()
        .catch(() => this.sessionHub.getWorkspaceLedger());
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
        workspaceLedger,
        editorSelection: this.editorBridge.getSelection(),
        backgroundTasks: this.sessionHub.getBackgroundTasks(),
        ...(accountStatus ? { accountStatus } : {}),
        fileChanges,
      });

      if (initialNav?.openProcessesDrawer) {
        postToSurface({
          type: "rayucode.ui.navigate",
          route,
          sessionId,
          openProcessesDrawer: true,
        });
      }
    };

    const msgListener = webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!vscode.workspace.isTrusted) return;
      await this.handleWebviewMessage(raw, postToSurface, sendInit);
    });

    const disposeListener = onDidDispose(() => {
      hubRegistration.dispose();
      msgListener.dispose();
      disposeListener.dispose();
      onCleanup();
    });

    webview.html = this.buildWebviewHtml(webview, mediaUri, surface);

    return new vscode.Disposable(() => {
      hubRegistration.dispose();
      msgListener.dispose();
      disposeListener.dispose();
      onCleanup();
    });
  }

  private async handleWebviewMessage(
    raw: unknown,
    postToSurface: (message: HostToWebviewMessage) => void,
    sendInit: () => Promise<void>,
  ): Promise<void> {
    const parsed = parseWebviewToHostMessage(raw);
    if (!parsed.success) {
      // Check if it was an RPC call with an unknown method or malformed envelope
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
        });
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
    const nonce = randomBytes(18).toString("base64");
    const mediaBaseUri = webview.asWebviewUri(mediaUri).toString().replace(/\/$/, "");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, "webview.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, "webview.js"));

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
    this.sidebarDisposable?.dispose();
    this.editorPanelDisposable?.dispose();
    this.editorPanel?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
