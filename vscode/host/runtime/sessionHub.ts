import * as vscode from "vscode";
import type {
  HostToWebviewMessage,
  ProjectIconView,
  SurfaceKind,
} from "../../shared/vscodeProtocol.js";
import type { GitChangesBridge } from "../bridges/gitChangesBridge.js";
import type { BridgeManager } from "./bridgeManager.js";
import {
  buildQuestionResponseWire,
  formatHarnessModelSpec,
  mapRawBackgroundTask,
  normalizeHarnessRequestFrame,
  normalizeImageAttachments,
} from "./featureRouters.js";
import {
  SessionHubCore,
  type SessionHubCoreOptions,
  type SessionHubHostAdapter,
} from "./sessionHubCore.js";

export {
  buildQuestionResponseWire as buildQuestionResponsePayload,
  formatHarnessModelSpec,
  mapRawBackgroundTask,
  normalizeHarnessRequestFrame,
  normalizeImageAttachments,
};

const PROJECT_ICONS_KEY = "rayucode.workspace.projectIcons";

function createVsCodeHostAdapter(
  context: vscode.ExtensionContext,
): SessionHubHostAdapter {
  return {
    workspaceState: context.workspaceState,
    getWorkspaceFolders: () =>
      (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        fsPath: folder.uri.fsPath,
      })),
    getDefaultPermissionModeRaw: () =>
      vscode.workspace
        .getConfiguration("rayucode")
        .get<string>("defaultPermissionMode", "default"),
    onDidChangeWorkspaceFolders: (listener) =>
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        listener();
      }),
    getProjectIcons: () =>
      context.globalState.get<Record<string, ProjectIconView>>(
        PROJECT_ICONS_KEY,
        {},
      ),
  };
}

export class SessionHub extends SessionHubCore implements vscode.Disposable {
  constructor(
    context: vscode.ExtensionContext,
    bridgeManager: BridgeManager,
    _gitBridge: GitChangesBridge,
    options?: SessionHubCoreOptions,
  ) {
    super(createVsCodeHostAdapter(context), bridgeManager, options);
  }

  override registerSurface(
    id: string,
    surface: SurfaceKind,
    postMessage: (message: HostToWebviewMessage) => void,
  ): vscode.Disposable {
    const reg = super.registerSurface(id, surface, postMessage);
    return new vscode.Disposable(() => reg.dispose());
  }
}
