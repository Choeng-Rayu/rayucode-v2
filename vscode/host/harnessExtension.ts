import * as vscode from "vscode";
import type { AppRoute } from "../shared/vscodeProtocol.js";
import { EditorBridge } from "./bridges/editorBridge.js";
import { GitChangesBridge } from "./bridges/gitChangesBridge.js";
import { StatusBarBridge } from "./bridges/statusBarBridge.js";
import {
  SIDEBAR_VIEW_ID,
  WorkspacePanelManager,
} from "./panel/workspacePanelManager.js";
import { BridgeManager } from "./runtime/bridgeManager.js";
import { createFeatureRouter } from "./runtime/featureRouters.js";
import { SessionHub } from "./runtime/sessionHub.js";

export function activate(context: vscode.ExtensionContext): void {
  const bridgeManager = new BridgeManager();
  const gitBridge = new GitChangesBridge(
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  );
  const sessionHub = new SessionHub(context, bridgeManager, gitBridge);
  const statusBar = new StatusBarBridge();

  const editorBridge = new EditorBridge((selection) => {
    sessionHub.broadcast({
      type: "rayucode.editor.selectionChanged",
      selection,
    });
  });

  let panelManager: WorkspacePanelManager;

  const featureRouter = createFeatureRouter({
    bridgeManager,
    sessionHub,
    gitBridge,
    editorBridge,
    getWorkspaceFolders: () => panelManager.getWorkspaceFoldersView(),
    setProjectIcon: (workspacePath, icon) =>
      panelManager.setProjectIcon(workspacePath, icon),
    getGlobalState: <T>(key: string, defaultValue: T) =>
      context.globalState.get<T>(key, defaultValue),
    updateGlobalState: async (key: string, value: unknown) => {
      await context.globalState.update(key, value);
    },
    getRuntimeSettings: () => {
      const cfg = vscode.workspace.getConfiguration("rayucode");
      return {
        socketPath:
          cfg.get<string>("apiSocketPath") ||
          cfg.get<string>("runtime.socketPath") ||
          "",
        binaryPath: cfg.get<string>("binaryPath") || "",
        autoStart: cfg.get<boolean>("autoStartBridge", true),
      };
    },
    updateRuntimeSettings: async (patch) => {
      const cfg = vscode.workspace.getConfiguration("rayucode");
      if (patch.socketPath !== undefined) {
        await cfg.update(
          "apiSocketPath",
          patch.socketPath,
          vscode.ConfigurationTarget.Global,
        );
      }
      if (patch.binaryPath !== undefined) {
        await cfg.update(
          "binaryPath",
          patch.binaryPath,
          vscode.ConfigurationTarget.Global,
        );
      }
      if (patch.autoStart !== undefined) {
        await cfg.update(
          "autoStartBridge",
          patch.autoStart,
          vscode.ConfigurationTarget.Global,
        );
      }
    },
    openKeybindings: async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openGlobalKeybindings",
        "rayucode",
      );
    },
  });

  panelManager = new WorkspacePanelManager(
    context,
    bridgeManager,
    sessionHub,
    featureRouter,
    editorBridge,
    gitBridge,
  );

  const syncStatusBar = (): void => {
    statusBar.update({
      daemonStatus: bridgeManager.getStatus(),
      model: sessionHub.getActiveModel(),
      permissionMode: sessionHub.getActivePermissionMode(),
      backgroundTasks: sessionHub.getBackgroundTasks(),
      sessionCredits: sessionHub.getTotalSessionCredits(),
    });
  };

  sessionHub.on("stateChanged", syncStatusBar);
  syncStatusBar();

  context.subscriptions.push(
    bridgeManager,
    sessionHub,
    editorBridge,
    statusBar,
    panelManager,
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, panelManager, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("rayucode.newSession", async () => {
      await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
      panelManager.sendHostCommand("newSession");
      await panelManager.navigateAll({ route: "home" });
    }),
    vscode.commands.registerCommand("rayucode.resumeSession", async () => {
      await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
      panelManager.sendHostCommand("resumeSession");
    }),
    vscode.commands.registerCommand("rayucode.openSidebar", async () => {
      await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
    }),
    vscode.commands.registerCommand(
      "rayucode.openWorkspacePanel",
      async (route?: string, sessionId?: string) => {
        await panelManager.openWorkspacePanel({
          route: typeof route === "string" ? (route as AppRoute) : undefined,
          sessionId: typeof sessionId === "string" ? sessionId : undefined,
        });
      },
    ),
    vscode.commands.registerCommand("rayucode.openSwarm", async () => {
      await panelManager.navigateAll({ route: "swarm", preferEditorPanel: true });
    }),
    vscode.commands.registerCommand("rayucode.openBackgroundProcesses", async () => {
      await panelManager.navigateAll({
        route: "workspace",
        openProcessesDrawer: true,
      });
    }),
    vscode.commands.registerCommand("rayucode.openChanges", async () => {
      await panelManager.navigateAll({ route: "changes" });
    }),
    vscode.commands.registerCommand("rayucode.openSettings", async () => {
      await panelManager.navigateAll({ route: "settings" });
    }),
    vscode.commands.registerCommand("rayucode.sendSelection", async () => {
      const selection = editorBridge.readActiveSelectionImmediate();
      await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
      sessionHub.broadcast({
        type: "rayucode.editor.selectionChanged",
        selection,
      });
      if (selection && selection.lineCount > 0 && selection.selectedText) {
        panelManager.sendHostCommand("sendSelection", selection);
      } else {
        panelManager.sendHostCommand("focusComposer", selection);
      }
    }),
    vscode.commands.registerCommand("rayucode.reloadDaemon", async () => {
      const res = await bridgeManager.reloadDaemon(sessionHub.getActiveSessionId());
      if (res.ok) {
        void vscode.window.showInformationMessage(
          res.message ?? "RayuCode daemon reloaded.",
        );
      } else {
        void vscode.window.showWarningMessage(
          `RayuCode reload failed: ${res.message ?? "Unknown error"}`,
        );
      }
    }),
    vscode.commands.registerCommand("rayucode.statusBarAction", async () => {
      if (statusBar.hasActiveBackgroundTasks) {
        await panelManager.navigateAll({
          route: "workspace",
          openProcessesDrawer: true,
        });
      } else {
        await panelManager.openWorkspacePanel();
      }
    }),
  );
}
