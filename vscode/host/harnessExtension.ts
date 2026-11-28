import path from "node:path";
import * as vscode from "vscode";
import {
  AppRouteSchema,
  type AccountStatusView,
  type ComposerInjectionPayload,
  type PermissionModeId,
} from "../shared/vscodeProtocol.js";
import { registerHostRayuAuthProvider } from "./auth/rayuAuthProvider.js";
import { RayuHostAuthManager } from "./auth/rayuHostAuthManager.js";
import {
  RayuCodeActionProvider,
  buildDiagnosticInjection,
} from "./bridges/codeActionBridge.js";
import { EditorBridge } from "./bridges/editorBridge.js";
import { GitChangesBridge } from "./bridges/gitChangesBridge.js";
import { StatusBarBridge } from "./bridges/statusBarBridge.js";
import {
  TerminalBridge,
  buildTerminalInjection,
} from "./bridges/terminalBridge.js";
import {
  SIDEBAR_VIEW_ID,
  WORKSPACE_PANEL_VIEW_TYPE,
  WorkspacePanelManager,
} from "./panel/workspacePanelManager.js";
import { BridgeManager } from "./runtime/bridgeManager.js";
import { createFeatureRouter } from "./runtime/featureRouters.js";
import { SessionHub } from "./runtime/sessionHub.js";

const PERMISSION_MODE_CHOICES: ReadonlyArray<{
  mode: PermissionModeId;
  label: string;
  description: string;
}> = [
  {
    mode: "default",
    label: "Ask (Default)",
    description: "Ask before editing files or running shell commands",
  },
  {
    mode: "acceptEdits",
    label: "Auto-edit",
    description: "Automatically apply file edits; ask before shell commands",
  },
  {
    mode: "plan",
    label: "Plan",
    description: "Read-only exploration and structured planning",
  },
  {
    mode: "fullManage",
    label: "Full Manage",
    description: "Full autonomous file editing and command execution",
  },
  {
    mode: "orchestrator",
    label: "Orchestrator",
    description: "Coordinate multi-agent swarms and delegated worktrees",
  },
];

let injectionSeq = 0;
function nextInjectionId(prefix: string): string {
  injectionSeq += 1;
  return `${prefix}_${Date.now()}_${injectionSeq}`;
}

function resolveWorkingDirForUri(uri?: vscode.Uri): string | undefined {
  if (uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function normalizeRelativeMention(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
}

function resolveContextUris(
  clickedUri?: vscode.Uri,
  allSelectedUris?: vscode.Uri[],
): vscode.Uri[] {
  if (Array.isArray(allSelectedUris) && allSelectedUris.length > 0) {
    return allSelectedUris.filter(
      (item): item is vscode.Uri => item instanceof vscode.Uri,
    );
  }
  if (clickedUri instanceof vscode.Uri) {
    return [clickedUri];
  }
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri && (activeUri.scheme === "file" || activeUri.scheme === "untitled")) {
    return [activeUri];
  }
  return [];
}

function dedupeRelativeMentions(uris: readonly vscode.Uri[]): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const uri of uris) {
    const rel = normalizeRelativeMention(uri).trim();
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    mentions.push(rel);
  }
  return mentions;
}

export function activate(context: vscode.ExtensionContext): void {
  let sessionHub!: SessionHub;
  const bridgeManager = new BridgeManager({
    storageDir: path.join(context.globalStorageUri.fsPath, "engine"),
    extensionVersion: String(
      (context.extension.packageJSON as { version?: unknown } | undefined)
        ?.version ?? "",
    ),
    isTurnActive: () => sessionHub?.getIsTurnStreaming() ?? false,
  });
  const gitBridge = new GitChangesBridge(
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  );
  sessionHub = new SessionHub(context, bridgeManager, gitBridge);
  const statusBar = new StatusBarBridge();
  const terminalBridge = new TerminalBridge();

  const editorBridge = new EditorBridge((selection) => {
    sessionHub.broadcast({
      type: "rayucode.editor.selectionChanged",
      selection,
    });
  });

  const authManager = new RayuHostAuthManager({
    watch: true,
    daemonBridge: {
      notifyAuthChanged: (provider) =>
        sessionHub.notifyDaemonAuthChanged(provider),
      setApiKey: (provider, apiKey) =>
        sessionHub.setDaemonApiKey(provider, apiKey),
      clearApiKey: (provider) =>
        sessionHub.clearDaemonApiKey(provider),
      logoutProvider: (provider) =>
        sessionHub.logoutDaemonProvider(provider),
    },
  });

  const authProvider = registerHostRayuAuthProvider(
    context,
    authManager,
    (url) => editorBridge.openExternal(url),
  );

  let panelManager: WorkspacePanelManager;

  const featureRouter = createFeatureRouter({
    bridgeManager,
    sessionHub,
    gitBridge,
    editorBridge,
    authManager,
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
    authManager,
  );

  editorBridge.setPanelViewColumnResolver(() =>
    panelManager.getEditorPanelViewColumn(),
  );

  const syncStatusBar = (): void => {
    statusBar.update({
      daemonStatus: bridgeManager.getStatus(),
      model: sessionHub.getActiveModel(),
      permissionMode: sessionHub.getActivePermissionMode(),
      backgroundTasks: sessionHub.getBackgroundTasks(),
      activeSwarm: sessionHub.getActiveSwarm(),
      sessionCredits: sessionHub.getTotalSessionCredits(),
      isStreaming: sessionHub.getIsTurnStreaming(),
      signedIn: authManager.getAccountStatusSnapshot().signedIn,
    });
  };

  authManager.on("authChanged", (account: AccountStatusView) => {
    sessionHub.broadcastAccountChanged(account);
    authProvider.refresh();
    syncStatusBar();
    void (async () => {
      try {
        await sessionHub.notifyDaemonAuthChanged("rayu");
      } catch {
        // best-effort daemon sync when bridge is offline
      }
    })();
  });

  bridgeManager.on("statusChanged", syncStatusBar);
  sessionHub.on("stateChanged", syncStatusBar);
  sessionHub.on(
    "fileChangesUpdated",
    ({ sessionId }: { sessionId: string }) => {
      void editorBridge.refreshOpenDiffs(sessionId, async (filePath) => {
        try {
          const diff = await featureRouter.call("changes.diff", {
            path: filePath,
            sessionId,
            scope: "session",
          });
          return {
            originalContent: diff.originalContent,
            modifiedContent: diff.modifiedContent,
            isCreated: diff.kind === "created",
            isDeleted: diff.kind === "deleted",
          };
        } catch {
          return null;
        }
      });
    },
  );
  syncStatusBar();
  bridgeManager.bootstrapOnStartup();

  const injectIntoPreferredSurface = async (
    injection: ComposerInjectionPayload,
    options: { broadcastSelection?: boolean } = {},
  ): Promise<void> => {
    const surfaceId = await panelManager.openPreferredSurface();
    if (options.broadcastSelection && injection.selection !== undefined) {
      sessionHub.broadcast({
        type: "rayucode.editor.selectionChanged",
        selection: injection.selection,
      });
    }
    panelManager.dispatchToSurface(surfaceId, {
      type: "rayucode.composer.inject",
      injection,
    });
  };

  const runSelectionPromptAction = async (
    intent: "explain" | "refactor" | "tests",
  ): Promise<void> => {
    const selection = editorBridge.readActiveSelectionImmediate();
    if (!selection) {
      void vscode.window.showInformationMessage(
        "Open a file or select code first to send it to RayuCode.",
      );
      return;
    }

    const locationRef =
      selection.lineCount > 0
        ? `@${selection.relativePath}#L${selection.lineStart}-L${selection.lineEnd}`
        : `@${selection.relativePath}`;

    const promptByIntent: Record<typeof intent, string> = {
      explain: `Explain what the selected code in ${locationRef} does, including key invariants and edge cases.`,
      refactor: `Review and refactor/fix the selected code in ${locationRef} for clarity, correctness, and maintainability while preserving behavior.`,
      tests: `Generate thorough unit tests for the selected code in ${locationRef}, covering happy paths and edge cases.`,
    };

    const labelByIntent: Record<typeof intent, string> = {
      explain: "Explain Selection",
      refactor: "Refactor Selection",
      tests: "Generate Tests",
    };

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const autoSubmit = panelManager.getWorkbenchSettings().contextActionsAutoSubmit;

    await injectIntoPreferredSurface(
      {
        id: nextInjectionId(`sel_${intent}`),
        mentions: [selection.relativePath],
        prompt: promptByIntent[intent],
        mode: "append",
        selection,
        workingDir: resolveWorkingDirForUri(activeUri),
        autoSubmit,
        sourceLabel: labelByIntent[intent],
      },
      { broadcastSelection: true },
    );
  };

  const runDiagnosticAction = async (
    intent: "fix" | "explain",
    uri?: vscode.Uri,
    range?: vscode.Range,
    providedDiagnostics?: readonly vscode.Diagnostic[],
  ): Promise<void> => {
    let document: vscode.TextDocument | undefined;
    if (uri instanceof vscode.Uri) {
      try {
        document = await vscode.workspace.openTextDocument(uri);
      } catch {
        document = undefined;
      }
    }
    if (!document) {
      document = vscode.window.activeTextEditor?.document;
    }
    if (!document) {
      void vscode.window.showInformationMessage(
        "No active document found for RayuCode diagnostic action.",
      );
      return;
    }

    let diagnostics: readonly vscode.Diagnostic[] =
      Array.isArray(providedDiagnostics) && providedDiagnostics.length > 0
        ? providedDiagnostics
        : vscode.languages.getDiagnostics(document.uri);

    if (
      (!providedDiagnostics || providedDiagnostics.length === 0) &&
      range instanceof vscode.Range
    ) {
      const intersecting = diagnostics.filter((d) =>
        Boolean(d.range.intersection(range)),
      );
      if (intersecting.length > 0) {
        diagnostics = intersecting;
      }
    }

    if (diagnostics.length === 0) {
      void vscode.window.showInformationMessage(
        "No diagnostics found at the current location.",
      );
      return;
    }

    const relativePath = normalizeRelativeMention(document.uri);
    const autoSubmit = panelManager.getWorkbenchSettings().contextActionsAutoSubmit;
    const injection = buildDiagnosticInjection({
      id: nextInjectionId(`diag_${intent}`),
      intent,
      filePath: document.uri.fsPath || document.uri.path,
      relativePath,
      languageId: document.languageId,
      diagnostics,
      documentText: document.getText(),
      fallbackRange:
        range instanceof vscode.Range
          ? { startLine: range.start.line, endLine: range.end.line }
          : undefined,
      workingDir: resolveWorkingDirForUri(document.uri),
      autoSubmit,
    });

    await injectIntoPreferredSurface(injection, { broadcastSelection: true });
  };

  const runTerminalAction = async (
    intent: "ask" | "fix",
    terminal?: vscode.Terminal,
  ): Promise<void> => {
    const capture = await terminalBridge.captureTerminalContext(terminal);
    if (!capture) {
      void vscode.window.showInformationMessage(
        "Select terminal output first (or enable Terminal Shell Integration) to send it to RayuCode.",
      );
      return;
    }

    const autoSubmit = panelManager.getWorkbenchSettings().contextActionsAutoSubmit;
    const injection = buildTerminalInjection(capture, intent, {
      id: nextInjectionId(`term_${intent}`),
      workingDir: resolveWorkingDirForUri(),
      autoSubmit,
    });

    await injectIntoPreferredSurface(injection);
  };

  context.subscriptions.push(
    { dispose: () => { bridgeManager.off("statusChanged", syncStatusBar); } },
    authManager,
    bridgeManager,
    sessionHub,
    editorBridge,
    terminalBridge,
    statusBar,
    panelManager,
    vscode.window.registerUriHandler({
      handleUri: async (uri: vscode.Uri) => {
        const normalizedPath = uri.path.replace(/\/+$/, "").toLowerCase();
        if (normalizedPath !== "/auth") return;
        try {
          const account = await authManager.handleUriCallback(uri.toString(true));
          void vscode.window.showInformationMessage(
            `Signed in to RayuCode${account.email ? ` as ${account.email}` : ""}.`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`RayuCode sign-in failed: ${msg}`);
        }
      },
    }),
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, panelManager, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewPanelSerializer(
      WORKSPACE_PANEL_VIEW_TYPE,
      panelManager,
    ),
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      new RayuCodeActionProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),

    // --- Tier 1 Workbench Placement & Navigation Commands ---
    vscode.commands.registerCommand("rayucode.openFromEditorTitle", async () => {
      const prefs = panelManager.getWorkbenchSettings();
      if (prefs.openLocation === "secondarySidebar") {
        await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
        return;
      }
      await panelManager.openPreferredSurface();
    }),
    vscode.commands.registerCommand("rayucode.openBeside", async () => {
      await panelManager.openWorkspacePanel({
        viewColumn: vscode.ViewColumn.Beside,
      });
    }),
    vscode.commands.registerCommand("rayucode.openSidebar", async () => {
      await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
    }),
    vscode.commands.registerCommand(
      "rayucode.openWorkspacePanel",
      async (route?: string, sessionId?: string) => {
        const parsedRoute = AppRouteSchema.safeParse(route);
        await panelManager.openWorkspacePanel({
          route: parsedRoute.success ? parsedRoute.data : undefined,
          sessionId: typeof sessionId === "string" ? sessionId : undefined,
        });
      },
    ),
    vscode.commands.registerCommand("rayucode.openSwarm", async () => {
      await panelManager.openWorkspacePanel({
        route: "swarm",
        viewColumn: vscode.ViewColumn.Beside,
      });
    }),
    vscode.commands.registerCommand("rayucode.openAgents", async () => {
      await panelManager.openPreferredSurface({ route: "agents" });
    }),
    vscode.commands.registerCommand("rayucode.openAutomations", async () => {
      await panelManager.openPreferredSurface({ route: "automations" });
    }),
    vscode.commands.registerCommand("rayucode.openPlugins", async () => {
      await panelManager.openPreferredSurface({ route: "plugins" });
    }),
    vscode.commands.registerCommand("rayucode.openRemote", async () => {
      await panelManager.openPreferredSurface({ route: "remote" });
    }),
    vscode.commands.registerCommand("rayucode.openChanges", async () => {
      await vscode.commands.executeCommand("workbench.view.scm");
    }),
    vscode.commands.registerCommand("rayucode.scmOpenChanges", async () => {
      await vscode.commands.executeCommand("workbench.view.scm");
    }),
    vscode.commands.registerCommand("rayucode.openBackgroundProcesses", async () => {
      await panelManager.openPreferredSurface({
        route: "workspace",
        openProcessesDrawer: true,
      });
    }),
    vscode.commands.registerCommand("rayucode.openSettings", async () => {
      await panelManager.openPreferredSurface({ route: "settings" });
    }),
    vscode.commands.registerCommand("rayucode.newSession", async () => {
      const surfaceId = await panelManager.openPreferredSurface({ route: "home" });
      panelManager.dispatchToSurface(surfaceId, {
        type: "rayucode.host.command",
        command: "newSession",
      });
    }),
    vscode.commands.registerCommand("rayucode.resumeSession", async () => {
      const surfaceId = await panelManager.openPreferredSurface();
      panelManager.dispatchToSurface(surfaceId, {
        type: "rayucode.host.command",
        command: "resumeSession",
      });
    }),

    // --- Tier 2 Editor, Explorer, Tab, Diagnostic, Terminal & Git Context Actions ---
    vscode.commands.registerCommand("rayucode.sendSelection", async () => {
      const selection = editorBridge.readActiveSelectionImmediate();
      const surfaceId = await panelManager.openPreferredSurface();
      sessionHub.broadcast({
        type: "rayucode.editor.selectionChanged",
        selection,
      });
      if (selection) {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        panelManager.dispatchToSurface(surfaceId, {
          type: "rayucode.composer.inject",
          injection: {
            id: nextInjectionId("send_sel"),
            mentions: [selection.relativePath],
            selection,
            workingDir: resolveWorkingDirForUri(activeUri),
            autoSubmit: false,
            sourceLabel: "Editor Selection",
          },
        });
      } else {
        panelManager.dispatchToSurface(surfaceId, {
          type: "rayucode.host.command",
          command: "focusComposer",
          payload: selection,
        });
      }
    }),
    vscode.commands.registerCommand(
      "rayucode.addToContext",
      async (uri?: vscode.Uri, allUris?: vscode.Uri[]) => {
        const uris = resolveContextUris(uri, allUris);
        const mentions = dedupeRelativeMentions(uris);
        if (mentions.length === 0) {
          void vscode.window.showInformationMessage(
            "Select a file or open an editor first to add it to RayuCode context.",
          );
          return;
        }
        await injectIntoPreferredSurface({
          id: nextInjectionId("ctx"),
          mentions,
          workingDir: resolveWorkingDirForUri(uris[0]),
          autoSubmit: false,
          sourceLabel:
            mentions.length === 1 ? "File Context" : `${mentions.length} Files`,
        });
      },
    ),
    vscode.commands.registerCommand(
      "rayucode.askAboutResource",
      async (uri?: vscode.Uri, allUris?: vscode.Uri[]) => {
        const uris = resolveContextUris(uri, allUris);
        const mentions = dedupeRelativeMentions(uris);
        if (mentions.length === 0) {
          void vscode.window.showInformationMessage(
            "Select a file or folder first to ask RayuCode about it.",
          );
          return;
        }
        await injectIntoPreferredSurface({
          id: nextInjectionId("ask_res"),
          mentions,
          workingDir: resolveWorkingDirForUri(uris[0]),
          autoSubmit: false,
          sourceLabel: "Ask About Resource",
        });
      },
    ),
    vscode.commands.registerCommand("rayucode.explainSelection", async () => {
      await runSelectionPromptAction("explain");
    }),
    vscode.commands.registerCommand("rayucode.refactorSelection", async () => {
      await runSelectionPromptAction("refactor");
    }),
    vscode.commands.registerCommand(
      "rayucode.generateTestsForSelection",
      async () => {
        await runSelectionPromptAction("tests");
      },
    ),
    vscode.commands.registerCommand(
      "rayucode.fixDiagnostic",
      async (
        uri?: vscode.Uri,
        range?: vscode.Range,
        diagnostics?: readonly vscode.Diagnostic[],
      ) => {
        await runDiagnosticAction("fix", uri, range, diagnostics);
      },
    ),
    vscode.commands.registerCommand(
      "rayucode.explainDiagnostic",
      async (
        uri?: vscode.Uri,
        range?: vscode.Range,
        diagnostics?: readonly vscode.Diagnostic[],
      ) => {
        await runDiagnosticAction("explain", uri, range, diagnostics);
      },
    ),
    vscode.commands.registerCommand(
      "rayucode.askTerminal",
      async (terminal?: vscode.Terminal) => {
        await runTerminalAction("ask", terminal);
      },
    ),
    vscode.commands.registerCommand(
      "rayucode.fixTerminalError",
      async (terminal?: vscode.Terminal) => {
        await runTerminalAction("fix", terminal);
      },
    ),
    vscode.commands.registerCommand("rayucode.reviewGitDiff", async () => {
      const status = await gitBridge.getStatus({ scope: "git" });
      if (status.files.length === 0) {
        void vscode.window.showInformationMessage(
          "Working tree is clean — no uncommitted changes to review.",
        );
        return;
      }

      const listed = status.files.slice(0, 30);
      const summaryLines = listed.map(
        (f) =>
          `- \`${f.path}\` (${f.status}${f.staged ? ", staged" : ""}, +${f.additions}/-${f.deletions})`,
      );
      if (status.files.length > listed.length) {
        summaryLines.push(
          `- ... and ${status.files.length - listed.length} more file(s)`,
        );
      }

      const prompt = [
        `Review my current working tree changes on branch \`${status.branch}\` (${status.files.length} file${status.files.length === 1 ? "" : "s"}, +${status.totalAdditions}/-${status.totalDeletions}):`,
        summaryLines.join("\n"),
        "Identify any bugs, edge cases, regressions, security issues, or missing tests, and suggest concrete improvements.",
      ].join("\n\n");

      const autoSubmit = panelManager.getWorkbenchSettings().contextActionsAutoSubmit;
      await injectIntoPreferredSurface({
        id: nextInjectionId("git_review"),
        prompt,
        mode: "append",
        workingDir: resolveWorkingDirForUri(),
        autoSubmit,
        sourceLabel: "Git Diff Review",
      });
    }),
    vscode.commands.registerCommand("rayucode.draftCommitMessage", async () => {
      const status = await gitBridge.getStatus({ scope: "git" });
      if (status.files.length === 0) {
        void vscode.window.showInformationMessage(
          "Working tree is clean — no changes to draft a commit message for.",
        );
        return;
      }

      const stagedFiles = status.files.filter((f) => f.staged);
      const targetFiles = stagedFiles.length > 0 ? stagedFiles : status.files;
      const scopeLabel =
        stagedFiles.length > 0 ? "staged changes" : "uncommitted working tree changes";
      const listed = targetFiles.slice(0, 30);
      const summaryLines = listed.map(
        (f) =>
          `- \`${f.path}\` (${f.status}, +${f.additions}/-${f.deletions})`,
      );
      if (targetFiles.length > listed.length) {
        summaryLines.push(
          `- ... and ${targetFiles.length - listed.length} more file(s)`,
        );
      }

      const prompt = [
        `Draft a concise Conventional Commit message (subject line <= 72 chars + brief bullet body if helpful) for my ${scopeLabel} on branch \`${status.branch}\`:`,
        summaryLines.join("\n"),
        "Inspect the actual git diff before finalizing the commit message.",
      ].join("\n\n");

      const autoSubmit = panelManager.getWorkbenchSettings().contextActionsAutoSubmit;
      await injectIntoPreferredSurface({
        id: nextInjectionId("git_commit"),
        prompt,
        mode: "append",
        workingDir: resolveWorkingDirForUri(),
        autoSubmit,
        sourceLabel: "Draft Commit Message",
      });
    }),

    // --- Daemon, Auth & Status Bar QuickPick Hub ---
    vscode.commands.registerCommand("rayucode.openTerminal", (cwd?: string) => {
      editorBridge.openTerminal({
        cwd:
          typeof cwd === "string" && cwd.trim()
            ? cwd.trim()
            : sessionHub.getSessionWorkingDir(),
      });
    }),
    vscode.commands.registerCommand(
      "rayucode.openBrowser",
      async (url?: string) => {
        await editorBridge.openSimpleBrowser(
          typeof url === "string" ? url : undefined,
        );
      },
    ),
    vscode.commands.registerCommand("rayucode.reloadDaemon", async () => {
      const res = await featureRouter.call("daemon.reload", undefined);
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
    vscode.commands.registerCommand("rayucode.updateEngine", async () => {
      const next = await bridgeManager.updateEngine();
      if (next.state === "error" || next.error) {
        void vscode.window.showWarningMessage(
          `Rayu engine update failed: ${next.error ?? "Unknown error"}`,
        );
      } else {
        void vscode.window.showInformationMessage(
          next.statusMessage ??
            `Rayu engine ready${next.managedVersion ? ` (${next.managedVersion})` : ""}.`,
        );
      }
    }),
    vscode.commands.registerCommand("rayucode.statusBarAction", async () => {
      const bgTasks = sessionHub.getBackgroundTasks();
      const runningBg = bgTasks.filter(
        (t) => t.status === "running" || t.status === "stalled",
      ).length;
      const stalledBg = bgTasks.filter((t) => t.status === "stalled").length;
      const currentMode = sessionHub.getActivePermissionMode();
      const currentModeLabel =
        PERMISSION_MODE_CHOICES.find((c) => c.mode === currentMode)?.label ??
        currentMode;
      const signedIn = authManager.getAccountStatusSnapshot().signedIn;

      type QuickActionItem = vscode.QuickPickItem & {
        action?: () => Promise<unknown> | Thenable<unknown> | void;
      };

      const items: QuickActionItem[] = [];

      if (runningBg > 0) {
        items.push({
          label: `$(terminal) Open Background Processes (${runningBg} active${stalledBg > 0 ? `, ${stalledBg} stalled` : ""})`,
          description: "Live tasks",
          action: () =>
            vscode.commands.executeCommand("rayucode.openBackgroundProcesses"),
        });
      }

      items.push(
        { label: "Workbench", kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(rayucode) Focus RayuCode (Secondary Sidebar)",
          description: "Sidebar view",
          action: () => vscode.commands.executeCommand("rayucode.openSidebar"),
        },
        {
          label: "$(split-horizontal) Open RayuCode Beside Editor",
          description: "Split column",
          action: () => vscode.commands.executeCommand("rayucode.openBeside"),
        },
        {
          label: "$(add) New Session",
          description: "Start fresh conversation",
          action: () => vscode.commands.executeCommand("rayucode.newSession"),
        },
        {
          label: "$(globe) Open Browser in VS Code",
          description: "Simple Browser",
          action: () => vscode.commands.executeCommand("rayucode.openBrowser"),
        },
        {
          label: "$(terminal) Open Terminal in VS Code",
          description: "Integrated terminal",
          action: () => vscode.commands.executeCommand("rayucode.openTerminal"),
        },
        {
          label: "$(shield) Switch Permission Mode",
          description: `Current: ${currentModeLabel}`,
          action: async () => {
            const pickedMode = await vscode.window.showQuickPick(
              PERMISSION_MODE_CHOICES.map((choice) => ({
                label:
                  choice.mode === currentMode
                    ? `$(check) ${choice.label}`
                    : choice.label,
                description: choice.description,
                mode: choice.mode,
              })),
              {
                title: "RayuCode Permission Mode",
                placeHolder: "Select permission mode for RayuCode",
              },
            );
            if (!pickedMode) return;
            const sid = sessionHub.getActiveSessionId();
            if (sid) {
              try {
                await sessionHub.setPermissionMode(sid, pickedMode.mode);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                void vscode.window.showWarningMessage(
                  `Failed to switch permission mode: ${msg}`,
                );
              }
            } else {
              await sessionHub.setDefaultPermissionMode(pickedMode.mode);
              syncStatusBar();
            }
          },
        },
        { label: "Mission Control", kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(git-compare) Open Changes & Diff Review",
          action: () => vscode.commands.executeCommand("rayucode.openChanges"),
        },
        {
          label: "$(organization) Open Swarm Mission Control",
          action: () => vscode.commands.executeCommand("rayucode.openSwarm"),
        },
        {
          label: "$(hubot) Open Agents & Personas",
          action: () => vscode.commands.executeCommand("rayucode.openAgents"),
        },
        {
          label: "$(clock) Open Automations",
          action: () =>
            vscode.commands.executeCommand("rayucode.openAutomations"),
        },
        {
          label: "$(plug) Open Plugins, MCP & Skills",
          action: () => vscode.commands.executeCommand("rayucode.openPlugins"),
        },
        {
          label: "$(radio-tower) Open Remote Access",
          action: () => vscode.commands.executeCommand("rayucode.openRemote"),
        },
        {
          label: "$(settings-gear) Open RayuCode Settings",
          action: () => vscode.commands.executeCommand("rayucode.openSettings"),
        },
        { label: "Account & Runtime", kind: vscode.QuickPickItemKind.Separator },
        signedIn
          ? {
              label: "$(sign-out) Sign Out of RayuCode",
              action: () => vscode.commands.executeCommand("rayucode.signOut"),
            }
          : {
              label: "$(account) Sign In to RayuCode",
              action: () => vscode.commands.executeCommand("rayucode.signIn"),
            },
        {
          label: "$(cloud-download) Install or Update Rayu Engine",
          action: () => vscode.commands.executeCommand("rayucode.updateEngine"),
        },
        {
          label: "$(refresh) Reload Daemon & Bridge",
          action: () => vscode.commands.executeCommand("rayucode.reloadDaemon"),
        },
      );

      const picked = await vscode.window.showQuickPick(items, {
        title: "RayuCode Quick Actions",
        placeHolder: "Choose a RayuCode action or destination",
      });
      if (picked?.action) {
        await picked.action();
      }
    }),
    vscode.commands.registerCommand("rayucode.signIn", async () => {
      try {
        const started = await authManager.startBrowserSignIn("vscode");
        await editorBridge.openExternal(started.authUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`RayuCode sign-in failed: ${msg}`);
      }
    }),
    vscode.commands.registerCommand("rayucode.signOut", async () => {
      await authManager.signOut();
      void vscode.window.showInformationMessage("Signed out of RayuCode.");
    }),
  );
}

export function deactivate(): void {
  // All resources are disposed automatically via context.subscriptions.
}
