import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  screen,
} from "electron"
import type { RuntimeCommand, ServerFrame } from "@rayu-dev/rayucode-sdk"

import { RayuAuthManager, type RayuAuthState } from "./auth-bridge.js"
import { BrowserCdpController } from "./browser-cdp.js"
import { RayuDaemonClient } from "./daemon-client.js"
import type { DesktopArtifactEvent } from "./desktop-tools.js"
import {
  checkoutGitBranch,
  commitGitStaged,
  createGitPullRequest,
  createGitWorktree,
  discardGitFile,
  getGitChanges,
  getGitCommits,
  listGitBranches,
  setAllGitStaged,
  toggleGitStage,
} from "./git-bridge.js"
import {
  AuthApiKeyPayloadSchema,
  AuthCallbackUrlPayloadSchema,
  BrowserCdpClickSchema,
  BrowserCdpNavigateSchema,
  BrowserCdpTypeSchema,
  CloudCancelStreamPayloadSchema,
  CloudStreamChatPayloadSchema,
  DaemonInvokePayloadSchema,
  ExtensionCreateSkillSchema,
  ExtensionRemoveMcpSchema,
  ExtensionToggleSkillSchema,
  ExtensionUpsertMcpSchema,
  FileChangesActionPayloadSchema,
  FileChangesDiffPayloadSchema,
  FileChangesGetPayloadSchema,
  GitCheckoutBranchPayloadSchema,
  GitCommitPayloadSchema,
  GitCreatePrPayloadSchema,
  GitCreateWorktreePayloadSchema,
  GitDiscardFilePayloadSchema,
  GitStageAllPayloadSchema,
  GitToggleStagePayloadSchema,
  HarnessCreateSessionSchema,
  HarnessImportExternalSessionsPayloadSchema,
  HarnessListExternalProjectsPayloadSchema,
  HarnessListSessionsPayloadSchema,
  HarnessPermissionResponseSchema,
  HarnessRenameSessionSchema,
  HarnessRuntimeCommandSchema,
  HarnessSendMessageSchema,
  HarnessSessionIdSchema,
  HarnessSetEffortSchema,
  HarnessSetModelSchema,
  HarnessSetPermissionModeSchema,
  KeepAwakePayloadSchema,
  OfficeCreatePptxPayloadSchema,
  OfficeReadExcelPayloadSchema,
  OfficeWriteExcelPayloadSchema,
  OpenExternalPayloadSchema,
  OpenInExcelPayloadSchema,
  OpenInPowerPointPayloadSchema,
  OpenInVSCodePayloadSchema,
  RevealInFinderPayloadSchema,
  StorageDeleteTemplateSchema,
  StoragePreferencesPatchSchema,
  StorageSaveTemplateSchema,
  StorageSessionStoreSchema,
  StorageSidebarStateSchema,
  TelegramConnectBotTokenSchema,
  TelegramDisconnectSchema,
  TelegramResolveApprovalSchema,
  TelegramSelectSessionSchema,
  TelegramSetRemoteUninstallSchema,
  TelegramStartHostedSchema,
  TerminalPtyCreatePayloadSchema,
  TerminalPtyKillPayloadSchema,
  TerminalPtyResizePayloadSchema,
  TerminalPtyWritePayloadSchema,
  TerminalRunPayloadSchema,
  WorkspaceEnsurePayloadSchema,
  WorkspaceImportProjectGroupPayloadSchema,
  WorkspaceReadFilePayloadSchema,
  WorkspaceSetPayloadSchema,
} from "./ipc-schemas.js"
import {
  openExternal,
  openInExcel,
  openInPowerPoint,
  openInVSCode,
  revealInFinder,
} from "./native-bridge.js"
import {
  createRealPowerPointDeck,
  readRealExcelWorkbook,
  writeRealExcelWorkbook,
} from "./office-bridge.js"
import {
  createLocalSkill,
  deleteCustomTemplate,
  disposeWorkspaceRegistry,
  ensureRegisteredWorkspace,
  importProjectGroupInRegistry,
  listLocalExtensions,
  listWorkspaceFiles,
  readCustomTemplates,
  readDesktopPreferences,
  readDesktopSessionStore,
  readRecentWorkspaces,
  readSidebarState,
  readWindowBounds,
  recordRecentWorkspace,
  removeLocalMcpServer,
  saveCustomTemplate,
  subscribeExternalWorkspaceChanges,
  syncSessionArchivedInRegistry,
  toggleLocalSkill,
  upsertLocalMcpServer,
  writeDesktopPreferences,
  writeDesktopSessionStore,
  writeSidebarState,
  writeWindowBounds,
} from "./storage-bridge.js"
import { runTerminalCommand, TerminalPtyManager } from "./terminal-bridge.js"
import { RayuTelegramManager } from "./telegram-bridge.js"
import {
  getWorkspaceInfo,
  pickWorkspaceFiles,
  pickWorkspaceFolder,
  readWorkspaceFile,
} from "./workspace-bridge.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const daemonClient = new RayuDaemonClient()
const authManager = new RayuAuthManager()
const terminalPty = new TerminalPtyManager()
const browserCdp = new BrowserCdpController()

function resolveAppIconPath(): string {
  const candidates = [
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(__dirname, "..", "public", "app-icon.png"),
    path.join(__dirname, "..", "public", "rayu-fox.png"),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

app.setName("RayuCode")

let activeWorkspaceDir =
  process.env.RAYU_WORKSPACE_DIR ?? path.resolve(__dirname, "..", "..")
const telegramManager = new RayuTelegramManager(
  daemonClient,
  () => activeWorkspaceDir
)
let mainWindow: BrowserWindow | null = null
let keepAwakeBlockerId: number | null = null

function emitDesktopArtifact(artifact: DesktopArtifactEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("rayu:desktop:artifact", artifact)
  }
}

browserCdp.setEnsureBrowserOpen(async (url?: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("rayu:browser:ensure-open", { url })
  }
})

daemonClient.configureDesktopRuntime({
  getWorkspaceDir: () => activeWorkspaceDir,
  browserCdp,
  onArtifact: emitDesktopArtifact,
})

function registerIpcHandlers(): void {
  // Daemon lifecycle
  ipcMain.handle("rayu:daemon:status", async () => {
    return daemonClient.getOrProbeStatus(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:daemon:launch", async () => {
    return daemonClient.launchAndConnect(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:daemon:invoke", async (_event, rawPayload: unknown) => {
    const parsed = DaemonInvokePayloadSchema.parse(rawPayload)
    return daemonClient.invoke(parsed.method, parsed.params)
  })

  // Real RayuCode Harness API (@rayu-dev/rayucode-sdk)
  ipcMain.handle(
    "rayu:harness:list-sessions",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessListSessionsPayloadSchema.parse(rawPayload)
      const status = await daemonClient.getOrProbeStatus(activeWorkspaceDir)
      if (!status.connected) {
        return []
      }
      try {
        return await daemonClient.listSessions(parsed?.includeArchived ?? false, {
          includeExternal: parsed?.includeExternal ?? true,
          sources: parsed?.sources,
        })
      } catch {
        return []
      }
    }
  )

  ipcMain.handle(
    "rayu:harness:list-external-projects",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessListExternalProjectsPayloadSchema.parse(rawPayload)
      const status = await daemonClient.getOrProbeStatus(activeWorkspaceDir)
      if (!status.connected) {
        return []
      }
      try {
        return await daemonClient.listExternalProjects(parsed?.source)
      } catch {
        return []
      }
    }
  )

  ipcMain.handle(
    "rayu:harness:import-external-sessions",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessImportExternalSessionsPayloadSchema.parse(rawPayload)
      const status = await daemonClient.getOrProbeStatus(activeWorkspaceDir)
      if (!status.connected) {
        return { sessions: [], skipped: [] }
      }
      return daemonClient.importExternalSessions(parsed.items, {
        forceResync: parsed.forceResync,
        forkOnConflict: parsed.forkOnConflict,
      })
    }
  )

  ipcMain.handle(
    "rayu:harness:create-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessCreateSessionSchema.parse(rawPayload ?? {})
      return daemonClient.createSession(
        parsed.workingDir ?? activeWorkspaceDir,
        parsed.title
      )
    }
  )

  ipcMain.handle(
    "rayu:harness:rename-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessRenameSessionSchema.parse(rawPayload)
      await daemonClient.renameSession(parsed.sessionId, parsed.title)
      return { ok: true }
    }
  )

  ipcMain.handle(
    "rayu:harness:archive-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      await daemonClient.archiveSession(parsed.sessionId)
      await syncSessionArchivedInRegistry(parsed.sessionId, true).catch(() => {})
      return { ok: true }
    }
  )

  ipcMain.handle(
    "rayu:harness:restore-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      await daemonClient.restoreSession(parsed.sessionId)
      await syncSessionArchivedInRegistry(parsed.sessionId, false).catch(
        () => {}
      )
      return { ok: true }
    }
  )

  ipcMain.handle(
    "rayu:harness:attach-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      return daemonClient.attachSession(parsed.sessionId)
    }
  )

  ipcMain.handle(
    "rayu:harness:fork-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      return daemonClient.forkSession(parsed.sessionId)
    }
  )

  ipcMain.handle(
    "rayu:harness:get-history",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      try {
        return await daemonClient.getHistory(parsed.sessionId)
      } catch {
        return { messages: [], images: [] }
      }
    }
  )

  ipcMain.handle(
    "rayu:harness:send-message",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSendMessageSchema.parse(rawPayload)
      await daemonClient.sendMessage(
        parsed.sessionId,
        parsed.content,
        parsed.images
      )
      return { ok: true }
    }
  )

  ipcMain.handle("rayu:harness:cancel", async (_event, rawPayload: unknown) => {
    const parsed = HarnessSessionIdSchema.parse(rawPayload)
    await daemonClient.cancel(parsed.sessionId)
    return { ok: true }
  })

  ipcMain.handle(
    "rayu:harness:permission-response",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessPermissionResponseSchema.parse(rawPayload)
      await daemonClient.respondToPermission(
        parsed.sessionId,
        parsed.requestId,
        parsed.decision
      )
      return { ok: true }
    }
  )

  ipcMain.handle(
    "rayu:harness:set-permission-mode",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSetPermissionModeSchema.parse(rawPayload)
      return daemonClient.setPermissionMode(parsed.sessionId, parsed.mode)
    }
  )

  ipcMain.handle(
    "rayu:harness:runtime-info",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      return daemonClient.getRuntimeInfo(parsed.sessionId)
    }
  )

  ipcMain.handle(
    "rayu:harness:set-model",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSetModelSchema.parse(rawPayload)
      try {
        return await daemonClient.setModel(parsed.sessionId, parsed.model)
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  )

  ipcMain.handle(
    "rayu:harness:set-effort",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSetEffortSchema.parse(rawPayload)
      try {
        await daemonClient.setReasoningEffort(parsed.sessionId, parsed.effort)
      } catch {
        // Non-fatal when provider does not support reasoning effort
      }
      return { ok: true }
    }
  )

  ipcMain.handle(
    "rayu:harness:runtime-command",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessRuntimeCommandSchema.parse(rawPayload)
      return daemonClient.runtimeCommand(
        parsed.sessionId,
        parsed.command as RuntimeCommand,
        parsed.args ?? []
      )
    }
  )

  // Session-scoped File Change Summary & Review Engine
  ipcMain.handle(
    "rayu:file-changes:get",
    async (_event, rawPayload: unknown) => {
      const parsed = FileChangesGetPayloadSchema.parse(rawPayload)
      return daemonClient.getFileChanges(parsed.sessionId)
    }
  )

  ipcMain.handle(
    "rayu:file-changes:diff",
    async (_event, rawPayload: unknown) => {
      const parsed = FileChangesDiffPayloadSchema.parse(rawPayload)
      return daemonClient.getFileChangeDiff(parsed.sessionId, parsed.path)
    }
  )

  ipcMain.handle(
    "rayu:file-changes:action",
    async (_event, rawPayload: unknown) => {
      const parsed = FileChangesActionPayloadSchema.parse(rawPayload)
      return daemonClient.fileChangeAction(parsed.sessionId, parsed.action, {
        path: parsed.path,
        force: parsed.force,
      })
    }
  )

  // Real local Workspace & File Reader
  ipcMain.handle("rayu:workspace:info", async () => {
    recordRecentWorkspace(activeWorkspaceDir)
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:set", async (_event, rawPayload: unknown) => {
    const parsed = WorkspaceSetPayloadSchema.parse(rawPayload)
    activeWorkspaceDir = path.resolve(parsed.path)
    recordRecentWorkspace(activeWorkspaceDir)
    void ensureRegisteredWorkspace(activeWorkspaceDir).catch(() => {})
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle(
    "rayu:workspace:ensure",
    async (_event, rawPayload: unknown) => {
      const parsed = WorkspaceEnsurePayloadSchema.parse(rawPayload)
      return ensureRegisteredWorkspace(parsed.path, {
        name: parsed.name,
        unhide: true,
      })
    }
  )

  ipcMain.handle(
    "rayu:workspace:import-project-group",
    async (_event, rawPayload: unknown) => {
      const parsed = WorkspaceImportProjectGroupPayloadSchema.parse(rawPayload)
      return importProjectGroupInRegistry(parsed.path, {
        name: parsed.name,
        sessionIds: parsed.sessionIds,
      })
    }
  )

  ipcMain.handle("rayu:workspace:pick-folder", async () => {
    const chosen = await pickWorkspaceFolder(mainWindow)
    if (!chosen) return null
    activeWorkspaceDir = path.resolve(chosen)
    recordRecentWorkspace(activeWorkspaceDir)
    void ensureRegisteredWorkspace(activeWorkspaceDir).catch(() => {})
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:pick-files", async () => {
    return pickWorkspaceFiles(mainWindow, activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:capture-appshot", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const image = await mainWindow.webContents.capturePage()
    const resized = image.resize({ width: 960 })
    return {
      name: `appshot-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.png`,
      dataUrl: resized.toDataURL(),
    }
  })

  ipcMain.handle(
    "rayu:workspace:read-file",
    async (_event, rawPayload: unknown) => {
      const parsed = WorkspaceReadFilePayloadSchema.parse(rawPayload)
      return readWorkspaceFile(activeWorkspaceDir, parsed.filePath)
    }
  )

  ipcMain.handle("rayu:workspace:list-files", async () => {
    return listWorkspaceFiles(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:list-recent", async () => {
    return readRecentWorkspaces()
  })

  // Persistent Desktop Settings & Local Sessions
  ipcMain.handle("rayu:storage:get-preferences", async () => {
    return readDesktopPreferences()
  })

  ipcMain.handle(
    "rayu:storage:update-preferences",
    async (_event, rawPayload: unknown) => {
      const parsed = StoragePreferencesPatchSchema.parse(rawPayload)
      return writeDesktopPreferences(parsed)
    }
  )

  ipcMain.handle("rayu:storage:get-sessions", async () => {
    return readDesktopSessionStore()
  })

  ipcMain.handle(
    "rayu:storage:save-sessions",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageSessionStoreSchema.parse(rawPayload)
      return writeDesktopSessionStore(parsed)
    }
  )

  ipcMain.handle("rayu:storage:get-templates", async () => {
    return readCustomTemplates()
  })

  ipcMain.handle(
    "rayu:storage:save-template",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageSaveTemplateSchema.parse(rawPayload)
      return saveCustomTemplate(parsed)
    }
  )

  ipcMain.handle(
    "rayu:storage:delete-template",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageDeleteTemplateSchema.parse(rawPayload)
      return deleteCustomTemplate(parsed.id)
    }
  )

  ipcMain.handle("rayu:storage:get-sidebar-state", async () => {
    return readSidebarState()
  })

  ipcMain.handle(
    "rayu:storage:save-sidebar-state",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageSidebarStateSchema.parse(rawPayload)
      return writeSidebarState(parsed)
    }
  )

  // Real Local Extensions (MCP servers, Skills, Memory files)
  ipcMain.handle("rayu:extensions:list", async () => {
    return listLocalExtensions(activeWorkspaceDir)
  })

  ipcMain.handle(
    "rayu:extensions:upsert-mcp",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionUpsertMcpSchema.parse(rawPayload)
      const snapshot = upsertLocalMcpServer(activeWorkspaceDir, parsed)
      await daemonClient.notifyAuthChanged("rayu")
      return snapshot
    }
  )

  ipcMain.handle(
    "rayu:extensions:remove-mcp",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionRemoveMcpSchema.parse(rawPayload)
      const snapshot = removeLocalMcpServer(
        activeWorkspaceDir,
        parsed.id,
        parsed.scope
      )
      await daemonClient.notifyAuthChanged("rayu")
      return snapshot
    }
  )

  ipcMain.handle(
    "rayu:extensions:create-skill",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionCreateSkillSchema.parse(rawPayload)
      return createLocalSkill(activeWorkspaceDir, parsed)
    }
  )

  ipcMain.handle(
    "rayu:extensions:toggle-skill",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionToggleSkillSchema.parse(rawPayload)
      return toggleLocalSkill(activeWorkspaceDir, parsed.skillId)
    }
  )

  // Real Git Changes & Diff Engine
  ipcMain.handle("rayu:git:changes", async () => {
    return getGitChanges(activeWorkspaceDir)
  })

  ipcMain.handle(
    "rayu:git:toggle-stage",
    async (_event, rawPayload: unknown) => {
      const parsed = GitToggleStagePayloadSchema.parse(rawPayload)
      return toggleGitStage(activeWorkspaceDir, parsed.filePath, parsed.staged)
    }
  )

  ipcMain.handle("rayu:git:stage-all", async (_event, rawPayload: unknown) => {
    const parsed = GitStageAllPayloadSchema.parse(rawPayload)
    return setAllGitStaged(activeWorkspaceDir, parsed.staged)
  })

  ipcMain.handle(
    "rayu:git:discard-file",
    async (_event, rawPayload: unknown) => {
      const parsed = GitDiscardFilePayloadSchema.parse(rawPayload)
      return discardGitFile(activeWorkspaceDir, parsed.filePath)
    }
  )

  ipcMain.handle("rayu:git:commit", async (_event, rawPayload: unknown) => {
    const parsed = GitCommitPayloadSchema.parse(rawPayload)
    return commitGitStaged(activeWorkspaceDir, parsed.message)
  })

  ipcMain.handle("rayu:git:create-pr", async (_event, rawPayload: unknown) => {
    const parsed = GitCreatePrPayloadSchema.parse(rawPayload)
    return createGitPullRequest(activeWorkspaceDir, parsed)
  })

  ipcMain.handle("rayu:git:commits", async () => {
    return getGitCommits(activeWorkspaceDir, 30)
  })

  ipcMain.handle("rayu:git:branches", async () => {
    return listGitBranches(activeWorkspaceDir)
  })

  ipcMain.handle(
    "rayu:git:checkout",
    async (_event, rawPayload: unknown) => {
      const parsed = GitCheckoutBranchPayloadSchema.parse(rawPayload)
      return checkoutGitBranch(activeWorkspaceDir, parsed.branch)
    }
  )

  ipcMain.handle(
    "rayu:git:create-worktree",
    async (_event, rawPayload: unknown) => {
      const parsed = GitCreateWorktreePayloadSchema.parse(rawPayload ?? {})
      const created = await createGitWorktree(
        activeWorkspaceDir,
        parsed.baseBranch
      )
      if (created.ok && created.path) {
        activeWorkspaceDir = path.resolve(created.path)
        recordRecentWorkspace(activeWorkspaceDir)
      }
      return created
    }
  )

  // Real Local Shell Terminal Runner & Interactive OS PTY Sessions
  ipcMain.handle("rayu:terminal:run", async (_event, rawPayload: unknown) => {
    const parsed = TerminalRunPayloadSchema.parse(rawPayload)
    return runTerminalCommand(activeWorkspaceDir, parsed.command)
  })

  ipcMain.handle(
    "rayu:terminal:pty-create",
    async (_event, rawPayload: unknown) => {
      const parsed = TerminalPtyCreatePayloadSchema.parse(rawPayload)
      return terminalPty.create({
        sessionId: parsed.sessionId,
        cwd: parsed.cwd,
        fallbackCwd: activeWorkspaceDir,
        cols: parsed.cols,
        rows: parsed.rows,
        onData: (data) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("rayu:terminal:pty-data", {
              sessionId: parsed.sessionId,
              data,
            })
          }
        },
        onExit: (exitCode) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("rayu:terminal:pty-exit", {
              sessionId: parsed.sessionId,
              exitCode,
            })
          }
        },
      })
    }
  )

  ipcMain.handle(
    "rayu:terminal:pty-write",
    async (_event, rawPayload: unknown) => {
      const parsed = TerminalPtyWritePayloadSchema.parse(rawPayload)
      return terminalPty.write(parsed.sessionId, parsed.data)
    }
  )

  ipcMain.handle(
    "rayu:terminal:pty-resize",
    async (_event, rawPayload: unknown) => {
      const parsed = TerminalPtyResizePayloadSchema.parse(rawPayload)
      return terminalPty.resize(parsed.sessionId, parsed.cols, parsed.rows)
    }
  )

  ipcMain.handle(
    "rayu:terminal:pty-kill",
    async (_event, rawPayload: unknown) => {
      const parsed = TerminalPtyKillPayloadSchema.parse(rawPayload)
      return terminalPty.kill(parsed.sessionId)
    }
  )

  // Real Rayu Cloud Authentication (OAuth loopback + API key + live credits/models)
  ipcMain.handle("rayu:auth:state", async () => {
    return authManager.getState()
  })

  ipcMain.handle("rayu:auth:refresh", async () => {
    return authManager.refreshAccountDetails()
  })

  ipcMain.handle("rayu:auth:sign-in-browser", async () => {
    const state = await authManager.signInWithBrowser()
    await daemonClient.notifyAuthChanged("rayu")
    return state
  })

  ipcMain.handle("rayu:auth:cancel-sign-in", async () => {
    return authManager.cancelBrowserSignIn()
  })

  ipcMain.handle(
    "rayu:auth:sign-in-apikey",
    async (_event, rawPayload: unknown) => {
      const parsed = AuthApiKeyPayloadSchema.parse(rawPayload)
      const state = await authManager.signInWithApiKey(parsed.apiKey)
      await daemonClient.setApiKey("rayu", parsed.apiKey)
      await daemonClient.notifyAuthChanged("rayu")
      return state
    }
  )

  ipcMain.handle(
    "rayu:auth:complete-callback",
    async (_event, rawPayload: unknown) => {
      const parsed = AuthCallbackUrlPayloadSchema.parse(rawPayload)
      const state = await authManager.completeManualCallback(parsed.callbackUrl)
      await daemonClient.notifyAuthChanged("rayu")
      return state
    }
  )

  ipcMain.handle("rayu:auth:sign-out", async () => {
    const state = await authManager.signOut()
    await daemonClient.clearApiKey("rayu")
    await daemonClient.notifyAuthChanged("rayu")
    return state
  })

  // Direct Rayu Cloud Gateway Streaming (works immediately after sign-in even before Rust daemon starts)
  ipcMain.handle(
    "rayu:cloud:stream-chat",
    async (_event, rawPayload: unknown) => {
      const parsed = CloudStreamChatPayloadSchema.parse(rawPayload)
      void authManager
        .streamCloudChat({
          sessionId: parsed.sessionId,
          model: parsed.model,
          messages: parsed.messages,
          workspaceDir: activeWorkspaceDir,
          browserCdp,
          onArtifact: emitDesktopArtifact,
          onEvent: (frame) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("rayu:harness:event", frame)
            }
          },
        })
        .catch((err: unknown) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("rayu:harness:event", {
              ev: "turn_stopped",
              session_id: parsed.sessionId,
              reason: "failure",
              message:
                err instanceof Error ? err.message : "Rayu Cloud stream failed",
            })
          }
        })
      return { ok: true }
    }
  )

  ipcMain.handle(
    "rayu:cloud:cancel-stream",
    async (_event, rawPayload: unknown) => {
      const parsed = CloudCancelStreamPayloadSchema.parse(rawPayload)
      authManager.cancelStream(parsed.sessionId)
      return { ok: true }
    }
  )

  // Native OS Actions
  ipcMain.handle(
    "rayu:native:open-excel",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInExcelPayloadSchema.parse(rawPayload)
      return openInExcel(parsed.filePath, activeWorkspaceDir)
    }
  )

  ipcMain.handle(
    "rayu:native:open-powerpoint",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInPowerPointPayloadSchema.parse(rawPayload)
      return openInPowerPoint(parsed, activeWorkspaceDir)
    }
  )

  ipcMain.handle(
    "rayu:native:open-vscode",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInVSCodePayloadSchema.parse(rawPayload)
      return openInVSCode(parsed.targetPath, parsed.line)
    }
  )

  ipcMain.handle(
    "rayu:native:open-external",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenExternalPayloadSchema.parse(rawPayload)
      return openExternal(parsed.url)
    }
  )

  ipcMain.handle(
    "rayu:native:reveal-in-finder",
    async (_event, rawPayload: unknown) => {
      const parsed = RevealInFinderPayloadSchema.parse(rawPayload)
      return revealInFinder(parsed.targetPath)
    }
  )

  ipcMain.handle(
    "rayu:native:keep-awake",
    async (_event, rawPayload: unknown) => {
      const parsed = KeepAwakePayloadSchema.parse(rawPayload)
      if (parsed.enabled) {
        if (
          keepAwakeBlockerId === null ||
          !powerSaveBlocker.isStarted(keepAwakeBlockerId)
        ) {
          keepAwakeBlockerId = powerSaveBlocker.start("prevent-display-sleep")
        }
        return { ok: true, enabled: true }
      }
      if (
        keepAwakeBlockerId !== null &&
        powerSaveBlocker.isStarted(keepAwakeBlockerId)
      ) {
        powerSaveBlocker.stop(keepAwakeBlockerId)
      }
      keepAwakeBlockerId = null
      return { ok: true, enabled: false }
    }
  )

  // Real Microsoft Office (.xlsx / .pptx) Engine
  ipcMain.handle("rayu:office:pick-excel", async () => {
    const win = mainWindow ?? undefined
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Open Excel Workbook",
          properties: ["openFile"],
          filters: [{ name: "Excel Workbooks", extensions: ["xlsx", "xlsm"] }],
        })
      : await dialog.showOpenDialog({
          title: "Open Excel Workbook",
          properties: ["openFile"],
          filters: [{ name: "Excel Workbooks", extensions: ["xlsx", "xlsm"] }],
        })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return readRealExcelWorkbook(activeWorkspaceDir, result.filePaths[0])
  })

  ipcMain.handle(
    "rayu:office:read-excel",
    async (_event, rawPayload: unknown) => {
      const parsed = OfficeReadExcelPayloadSchema.parse(rawPayload)
      return readRealExcelWorkbook(activeWorkspaceDir, parsed.filePath)
    }
  )

  ipcMain.handle(
    "rayu:office:write-excel",
    async (_event, rawPayload: unknown) => {
      const parsed = OfficeWriteExcelPayloadSchema.parse(rawPayload)
      return writeRealExcelWorkbook(activeWorkspaceDir, parsed)
    }
  )

  ipcMain.handle(
    "rayu:office:create-pptx",
    async (_event, rawPayload: unknown) => {
      const parsed = OfficeCreatePptxPayloadSchema.parse(rawPayload)
      return createRealPowerPointDeck(activeWorkspaceDir, parsed)
    }
  )

  // Native Electron CDP Browser Automation (controls the live right-sidebar <webview>)
  ipcMain.handle(
    "rayu:browser:cdp-navigate",
    async (_event, rawPayload: unknown) => {
      const parsed = BrowserCdpNavigateSchema.parse(rawPayload)
      return browserCdp.navigate(parsed.url)
    }
  )

  ipcMain.handle("rayu:browser:cdp-snapshot", async () => {
    return browserCdp.snapshot()
  })

  ipcMain.handle(
    "rayu:browser:cdp-click",
    async (_event, rawPayload: unknown) => {
      const parsed = BrowserCdpClickSchema.parse(rawPayload)
      return browserCdp.click(parsed.ref)
    }
  )

  ipcMain.handle(
    "rayu:browser:cdp-type",
    async (_event, rawPayload: unknown) => {
      const parsed = BrowserCdpTypeSchema.parse(rawPayload)
      return browserCdp.type(parsed.ref, parsed.text, parsed.submit)
    }
  )

  ipcMain.handle("rayu:browser:cdp-screenshot", async () => {
    return browserCdp.screenshot()
  })

  // Real Telegram Remote (backed by Rust rayu daemon telegram_remote & telegram_bridge)
  ipcMain.handle("rayu:telegram:state", async () => {
    return telegramManager.getState()
  })

  ipcMain.handle(
    "rayu:telegram:start-hosted",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramStartHostedSchema.parse(rawPayload ?? {})
      return telegramManager.startHosted(Boolean(parsed.replaceExisting))
    }
  )

  ipcMain.handle(
    "rayu:telegram:connect-bot-token",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramConnectBotTokenSchema.parse(rawPayload)
      return telegramManager.connectBotToken(parsed)
    }
  )

  ipcMain.handle(
    "rayu:telegram:disconnect",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramDisconnectSchema.parse(rawPayload ?? {})
      return telegramManager.disconnect(Boolean(parsed.localOnly))
    }
  )

  ipcMain.handle(
    "rayu:telegram:resolve-approval",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramResolveApprovalSchema.parse(rawPayload)
      return telegramManager.resolveApproval(parsed.approvalId, parsed.decision)
    }
  )

  ipcMain.handle(
    "rayu:telegram:set-remote-uninstall",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramSetRemoteUninstallSchema.parse(rawPayload)
      return telegramManager.setRemoteUninstall(parsed.enabled)
    }
  )

  ipcMain.handle(
    "rayu:telegram:select-session",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramSelectSessionSchema.parse(rawPayload)
      return telegramManager.selectSession(parsed.sessionId)
    }
  )

  ipcMain.handle("rayu:telegram:ping", async () => {
    return telegramManager.sendTestPing()
  })

  // Push events -> Renderer
  daemonClient.on("status", (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("rayu:daemon:status-changed", status)
    }
  })

  daemonClient.on("harness-event", (frame: ServerFrame) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("rayu:harness:event", frame)
    }
  })

  subscribeExternalWorkspaceChanges((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("rayu:storage:sidebar-changed", state)
    }
  })

  let wasSignedIn = authManager.getState().signedIn
  authManager.on("auth-changed", (state: RayuAuthState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("rayu:auth:changed", state)
      if (state.signedIn && !wasSignedIn) {
        mainWindow.show()
        mainWindow.focus()
      }
    }
    if (state.signedIn && !wasSignedIn) {
      void daemonClient.notifyAuthChanged("rayu").then(() => {
        if (!daemonClient.getStatus().connected) {
          void daemonClient.checkConnection(activeWorkspaceDir)
        }
      })
    }
    wasSignedIn = state.signedIn
  })
}

async function createMainWindow(): Promise<void> {
  const iconPath = resolveAppIconPath()
  const windowIcon = nativeImage.createFromPath(iconPath)

  const preloadCandidates = [
    path.join(__dirname, "preload.cjs"),
    path.join(__dirname, "..", "electron", "preload.cjs"),
  ]
  const preloadPath =
    preloadCandidates.find((p) => fs.existsSync(p)) ?? preloadCandidates[0]

  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const defaultWidth = Math.min(
    1680,
    Math.max(1280, Math.round(primaryWorkArea.width * 0.92))
  )
  const defaultHeight = Math.min(
    1060,
    Math.max(820, Math.round(primaryWorkArea.height * 0.92))
  )
  const savedBounds = readWindowBounds()
  const isSavedBoundsVisible =
    savedBounds !== null &&
    savedBounds.x !== undefined &&
    savedBounds.y !== undefined &&
    screen.getAllDisplays().some((display) => {
      const wa = display.workArea
      return (
        savedBounds.x! + savedBounds.width > wa.x + 80 &&
        savedBounds.x! < wa.x + wa.width - 80 &&
        savedBounds.y! + savedBounds.height > wa.y + 80 &&
        savedBounds.y! < wa.y + wa.height - 80
      )
    })

  const initialWidth = savedBounds
    ? Math.min(primaryWorkArea.width, Math.max(1024, savedBounds.width))
    : Math.min(primaryWorkArea.width, defaultWidth)
  const initialHeight = savedBounds
    ? Math.min(primaryWorkArea.height, Math.max(680, savedBounds.height))
    : Math.min(primaryWorkArea.height, defaultHeight)

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    ...(isSavedBoundsVisible && savedBounds
      ? { x: savedBounds.x, y: savedBounds.y }
      : {}),
    minWidth: 1024,
    minHeight: 680,
    title: "RayuCode",
    icon: windowIcon.isEmpty() ? undefined : windowIcon,
    backgroundColor: "#11110E",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  })

  if (savedBounds?.isMaximized) {
    mainWindow.maximize()
  }

  let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null
  const persistCurrentBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const isMaximized = mainWindow.isMaximized()
    const normal = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
    writeWindowBounds({
      width: normal.width,
      height: normal.height,
      x: normal.x,
      y: normal.y,
      isMaximized,
    })
  }
  const schedulePersistBounds = () => {
    if (saveBoundsTimer !== null) {
      clearTimeout(saveBoundsTimer)
    }
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = null
      persistCurrentBounds()
    }, 250)
  }
  mainWindow.on("resize", schedulePersistBounds)
  mainWindow.on("move", schedulePersistBounds)
  mainWindow.on("maximize", schedulePersistBounds)
  mainWindow.on("unmaximize", schedulePersistBounds)
  mainWindow.on("close", () => {
    if (saveBoundsTimer !== null) {
      clearTimeout(saveBoundsTimer)
      saveBoundsTimer = null
    }
    persistCurrentBounds()
  })

  mainWindow.webContents.on("preload-error", (_event, scriptPath, error) => {
    console.error("[RayuCode] Preload script failed:", scriptPath, error)
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"))
  }
}

app.whenReady().then(async () => {
  const iconPath = resolveAppIconPath()
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(iconPath)
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
    }
  }
  app.setAboutPanelOptions({
    applicationName: "RayuCode",
    applicationVersion: app.getVersion(),
    iconPath,
  })

  if (process.platform === "darwin") {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "RayuCode",
        submenu: [
          { role: "about", label: "About RayuCode" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide", label: "Hide RayuCode" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit", label: "Quit RayuCode" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  registerIpcHandlers()
  await createMainWindow()
  // Probe local rayu api-bridge and refresh existing Rayu Cloud session in background
  void daemonClient.checkConnection(activeWorkspaceDir)
  void authManager.refreshAccountDetails()

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on("before-quit", () => {
  terminalPty.killAll()
  authManager.dispose()
  daemonClient.dispose()
  disposeWorkspaceRegistry()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
