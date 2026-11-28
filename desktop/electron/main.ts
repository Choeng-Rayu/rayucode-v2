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
  assertTrustedSender,
  isAllowedWebviewUrl,
} from "./ipc-security.js"
import {
  checkoutGitBranch,
  commitGitStaged,
  createGitPullRequest,
  createGitWorktree,
  discardGitFile,
  getGitChanges,
  getGitCommits,
  getGitFileDiff,
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
  TodosGetPayloadSchema,
  GitCheckoutBranchPayloadSchema,
  GitCommitPayloadSchema,
  GitCreatePrPayloadSchema,
  GitCreateWorktreePayloadSchema,
  GitDiscardFilePayloadSchema,
  GitFileDiffPayloadSchema,
  GitStageAllPayloadSchema,
  GitToggleStagePayloadSchema,
  HarnessCreateSessionSchema,
  HarnessForkSessionSchema,
  HarnessGetCapabilitiesSchema,
  HarnessGetConfigSchema,
  HarnessGlobalRuntimeCommandSchema,
  HarnessImportExternalSessionsPayloadSchema,
  HarnessListExternalProjectsPayloadSchema,
  HarnessListSessionsPayloadSchema,
  HarnessPatchConfigSchema,
  HarnessPermissionResponseSchema,
  HarnessQuestionResponseSchema,
  HarnessRenameSessionSchema,
  HarnessRuntimeCommandSchema,
  HarnessSendMessageSchema,
  HarnessSessionIdSchema,
  HarnessSetEffortSchema,
  HarnessSetModelSchema,
  HarnessSetPermissionModeSchema,
  HarnessSoftInterruptSchema,
  HarnessCancelSoftInterruptsSchema,
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
  AgentsDeleteProfileSchema,
  AgentsGetStateSchema,
  AgentsSetRoleModelSchema,
  AgentsSetSubagentModelSchema,
  AgentsUpsertProfileSchema,
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
  migrateLegacyEngineSettingsOnce,
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
import { RayuAgentsManager } from "./agents-bridge.js"
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
const agentsManager = new RayuAgentsManager(
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

daemonClient.setWorkingDir(activeWorkspaceDir)
daemonClient.configureDesktopRuntime({
  getWorkspaceDir: () => activeWorkspaceDir,
  getWorkspaceDirForSession: (sessionId?: string) =>
    daemonClient.getWorkingDirForSession(sessionId),
  browserCdp,
  onArtifact: emitDesktopArtifact,
})

const trustedOriginOptions = {
  devServerUrl: process.env.VITE_DEV_SERVER_URL,
  distDir: path.join(__dirname, "..", "dist"),
}

function registerIpcHandlers(): void {
  const handleTrusted: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, trustedOriginOptions)
      return listener(event, ...args)
    })

  // Daemon lifecycle
  handleTrusted("rayu:daemon:status", async () => {
    return daemonClient.getOrProbeStatus(activeWorkspaceDir)
  })

  handleTrusted("rayu:daemon:launch", async () => {
    return daemonClient.launchAndConnect(activeWorkspaceDir)
  })

  handleTrusted("rayu:daemon:invoke", async (_event, rawPayload: unknown) => {
    const parsed = DaemonInvokePayloadSchema.parse(rawPayload)
    return daemonClient.invoke(parsed.method, parsed.params)
  })

  // Real RayuCode Harness API (@rayu-dev/rayucode-sdk)
  handleTrusted(
    "rayu:harness:list-sessions",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessListSessionsPayloadSchema.parse(rawPayload)
      const status = await daemonClient.getOrProbeStatus(activeWorkspaceDir)
      if (!status.connected) {
        return []
      }
      return await daemonClient.listSessions(parsed?.includeArchived ?? false, {
        includeExternal: parsed?.includeExternal ?? true,
        sources: parsed?.sources,
      })
    }
  )

  handleTrusted(
    "rayu:harness:list-external-projects",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessListExternalProjectsPayloadSchema.parse(rawPayload)
      const status = await daemonClient.getOrProbeStatus(activeWorkspaceDir)
      if (!status.connected) {
        return []
      }
      return await daemonClient.listExternalProjects(parsed?.source)
    }
  )

  handleTrusted(
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

  handleTrusted(
    "rayu:harness:create-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessCreateSessionSchema.parse(rawPayload ?? {})
      return daemonClient.createSession(
        parsed.workingDir ?? activeWorkspaceDir,
        parsed.title
      )
    }
  )

  handleTrusted(
    "rayu:harness:rename-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessRenameSessionSchema.parse(rawPayload)
      await daemonClient.renameSession(parsed.sessionId, parsed.title)
      return { ok: true }
    }
  )

  handleTrusted(
    "rayu:harness:archive-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      await daemonClient.archiveSession(parsed.sessionId)
      await syncSessionArchivedInRegistry(parsed.sessionId, true).catch(() => {})
      return { ok: true }
    }
  )

  handleTrusted(
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

  handleTrusted(
    "rayu:harness:attach-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      return daemonClient.attachSession(parsed.sessionId)
    }
  )

  handleTrusted(
    "rayu:harness:fork-session",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessForkSessionSchema.parse(rawPayload)
      return daemonClient.forkSession(parsed.sessionId, {
        ...(parsed.upToMessageIndex !== undefined
          ? { upToMessageIndex: parsed.upToMessageIndex }
          : {}),
        ...(parsed.upToMessageId !== undefined
          ? { upToMessageId: parsed.upToMessageId }
          : {}),
      })
    }
  )

  handleTrusted(
    "rayu:harness:get-history",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      if (!parsed.sessionId || parsed.sessionId.startsWith("ses_")) {
        return { messages: [], images: [] }
      }
      const status = await daemonClient.getOrProbeStatus(activeWorkspaceDir)
      if (!status.connected) {
        return { messages: [], images: [] }
      }
      return await daemonClient.getHistory(parsed.sessionId)
    }
  )

  handleTrusted(
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

  handleTrusted(
    "rayu:harness:soft-interrupt",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSoftInterruptSchema.parse(rawPayload)
      return daemonClient.softInterrupt(parsed.sessionId, parsed.content, {
        urgent: parsed.urgent,
        clientId: parsed.clientId,
        images: parsed.images,
      })
    }
  )

  handleTrusted(
    "rayu:harness:cancel-soft-interrupts",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessCancelSoftInterruptsSchema.parse(rawPayload)
      return daemonClient.cancelSoftInterrupts(
        parsed.sessionId,
        parsed.interruptId
      )
    }
  )

  handleTrusted("rayu:harness:cancel", async (_event, rawPayload: unknown) => {
    const parsed = HarnessSessionIdSchema.parse(rawPayload)
    await daemonClient.cancel(parsed.sessionId)
    return { ok: true }
  })

  handleTrusted(
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

  handleTrusted(
    "rayu:harness:question-response",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessQuestionResponseSchema.parse(rawPayload)
      await daemonClient.respondToQuestion(
        parsed.sessionId,
        parsed.requestId,
        parsed.response
      )
      return { ok: true }
    }
  )

  handleTrusted(
    "rayu:harness:set-permission-mode",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSetPermissionModeSchema.parse(rawPayload)
      return daemonClient.setPermissionMode(parsed.sessionId, parsed.mode)
    }
  )

  handleTrusted(
    "rayu:harness:runtime-info",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      return daemonClient.getRuntimeInfo(parsed.sessionId)
    }
  )

  handleTrusted(
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

  handleTrusted(
    "rayu:harness:set-effort",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSetEffortSchema.parse(rawPayload)
      try {
        return await daemonClient.setReasoningEffort(
          parsed.sessionId,
          parsed.effort
        )
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  )

  handleTrusted(
    "rayu:harness:compact",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSessionIdSchema.parse(rawPayload)
      return daemonClient.compact(parsed.sessionId)
    }
  )

  handleTrusted(
    "rayu:harness:get-capabilities",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessGetCapabilitiesSchema.parse(rawPayload)
      return daemonClient.getCapabilities(parsed?.sessionId)
    }
  )

  handleTrusted(
    "rayu:harness:get-config",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessGetConfigSchema.parse(rawPayload)
      return daemonClient.getConfig(parsed?.sections)
    }
  )

  handleTrusted(
    "rayu:harness:patch-config",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessPatchConfigSchema.parse(rawPayload)
      return daemonClient.patchConfig(parsed.patch)
    }
  )

  handleTrusted(
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

  handleTrusted(
    "rayu:harness:global-runtime-command",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessGlobalRuntimeCommandSchema.parse(rawPayload)
      return daemonClient.runGlobalRuntimeCommand(
        parsed.command as RuntimeCommand,
        parsed.args ?? [],
        activeWorkspaceDir
      )
    }
  )

  // Session-scoped File Change Summary & Review Engine
  handleTrusted(
    "rayu:file-changes:get",
    async (_event, rawPayload: unknown) => {
      const parsed = FileChangesGetPayloadSchema.parse(rawPayload)
      return daemonClient.getFileChanges(parsed.sessionId)
    }
  )

  handleTrusted(
    "rayu:file-changes:diff",
    async (_event, rawPayload: unknown) => {
      const parsed = FileChangesDiffPayloadSchema.parse(rawPayload)
      return daemonClient.getFileChangeDiff(parsed.sessionId, parsed.path)
    }
  )

  handleTrusted(
    "rayu:file-changes:action",
    async (_event, rawPayload: unknown) => {
      const parsed = FileChangesActionPayloadSchema.parse(rawPayload)
      return daemonClient.fileChangeAction(parsed.sessionId, parsed.action, {
        path: parsed.path,
        force: parsed.force,
      })
    }
  )

  handleTrusted("rayu:todos:get", async (_event, rawPayload: unknown) => {
    const parsed = TodosGetPayloadSchema.parse(rawPayload)
    return daemonClient.getTodos(parsed.sessionId)
  })

  // Real local Workspace & File Reader
  handleTrusted("rayu:workspace:info", async () => {
    recordRecentWorkspace(activeWorkspaceDir)
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  handleTrusted("rayu:workspace:set", async (_event, rawPayload: unknown) => {
    const parsed = WorkspaceSetPayloadSchema.parse(rawPayload)
    activeWorkspaceDir = path.resolve(parsed.path)
    daemonClient.setWorkingDir(activeWorkspaceDir)
    recordRecentWorkspace(activeWorkspaceDir)
    void ensureRegisteredWorkspace(activeWorkspaceDir).catch(() => {})
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  handleTrusted(
    "rayu:workspace:ensure",
    async (_event, rawPayload: unknown) => {
      const parsed = WorkspaceEnsurePayloadSchema.parse(rawPayload)
      return ensureRegisteredWorkspace(parsed.path, {
        name: parsed.name,
        unhide: true,
      })
    }
  )

  handleTrusted(
    "rayu:workspace:import-project-group",
    async (_event, rawPayload: unknown) => {
      const parsed = WorkspaceImportProjectGroupPayloadSchema.parse(rawPayload)
      return importProjectGroupInRegistry(parsed.path, {
        name: parsed.name,
        sessionIds: parsed.sessionIds,
      })
    }
  )

  handleTrusted("rayu:workspace:pick-folder", async () => {
    const chosen = await pickWorkspaceFolder(mainWindow)
    if (!chosen) return null
    activeWorkspaceDir = path.resolve(chosen)
    daemonClient.setWorkingDir(activeWorkspaceDir)
    recordRecentWorkspace(activeWorkspaceDir)
    void ensureRegisteredWorkspace(activeWorkspaceDir).catch(() => {})
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  handleTrusted("rayu:workspace:pick-files", async () => {
    return pickWorkspaceFiles(mainWindow, activeWorkspaceDir)
  })

  handleTrusted("rayu:workspace:capture-appshot", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const image = await mainWindow.webContents.capturePage()
    const resized = image.resize({ width: 960 })
    return {
      name: `appshot-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.png`,
      dataUrl: resized.toDataURL(),
    }
  })

  handleTrusted(
    "rayu:workspace:read-file",
    async (_event, rawPayload: unknown) => {
      const parsed = WorkspaceReadFilePayloadSchema.parse(rawPayload)
      return readWorkspaceFile(activeWorkspaceDir, parsed.filePath)
    }
  )

  handleTrusted("rayu:workspace:list-files", async () => {
    return listWorkspaceFiles(activeWorkspaceDir)
  })

  handleTrusted("rayu:workspace:list-recent", async () => {
    return readRecentWorkspaces()
  })

  // Persistent Desktop Settings & Local Sessions
  handleTrusted("rayu:storage:get-preferences", async () => {
    return readDesktopPreferences()
  })

  handleTrusted(
    "rayu:storage:update-preferences",
    async (_event, rawPayload: unknown) => {
      const parsed = StoragePreferencesPatchSchema.parse(rawPayload)
      return writeDesktopPreferences(parsed)
    }
  )

  handleTrusted("rayu:storage:get-sessions", async () => {
    return readDesktopSessionStore()
  })

  handleTrusted(
    "rayu:storage:save-sessions",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageSessionStoreSchema.parse(rawPayload)
      return writeDesktopSessionStore(parsed)
    }
  )

  handleTrusted("rayu:storage:get-templates", async () => {
    return readCustomTemplates()
  })

  handleTrusted(
    "rayu:storage:save-template",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageSaveTemplateSchema.parse(rawPayload)
      return saveCustomTemplate(parsed)
    }
  )

  handleTrusted(
    "rayu:storage:delete-template",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageDeleteTemplateSchema.parse(rawPayload)
      return deleteCustomTemplate(parsed.id)
    }
  )

  handleTrusted("rayu:storage:get-sidebar-state", async () => {
    return readSidebarState()
  })

  handleTrusted(
    "rayu:storage:save-sidebar-state",
    async (_event, rawPayload: unknown) => {
      const parsed = StorageSidebarStateSchema.parse(rawPayload)
      return writeSidebarState(parsed)
    }
  )

  // Real Local Extensions (MCP servers, Skills, Memory files)
  handleTrusted("rayu:extensions:list", async () => {
    return listLocalExtensions(activeWorkspaceDir)
  })

  handleTrusted(
    "rayu:extensions:upsert-mcp",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionUpsertMcpSchema.parse(rawPayload)
      const snapshot = upsertLocalMcpServer(activeWorkspaceDir, parsed)
      await daemonClient.notifyAuthChanged("rayu").catch(() => {})
      let daemonReloaded = false
      let reloadError: string | undefined
      try {
        await daemonClient.runGlobalRuntimeCommand(
          "mcp",
          ["reload"],
          activeWorkspaceDir
        )
        daemonReloaded = true
      } catch (err) {
        reloadError = err instanceof Error ? err.message : String(err)
      }
      return {
        ...snapshot,
        diskSaved: true,
        daemonReloaded,
        ...(reloadError ? { reloadError } : {}),
      }
    }
  )

  handleTrusted(
    "rayu:extensions:remove-mcp",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionRemoveMcpSchema.parse(rawPayload)
      const snapshot = removeLocalMcpServer(
        activeWorkspaceDir,
        parsed.id,
        parsed.scope
      )
      await daemonClient.notifyAuthChanged("rayu").catch(() => {})
      let daemonReloaded = false
      let reloadError: string | undefined
      try {
        await daemonClient.runGlobalRuntimeCommand(
          "mcp",
          ["reload"],
          activeWorkspaceDir
        )
        daemonReloaded = true
      } catch (err) {
        reloadError = err instanceof Error ? err.message : String(err)
      }
      return {
        ...snapshot,
        diskSaved: true,
        daemonReloaded,
        ...(reloadError ? { reloadError } : {}),
      }
    }
  )

  handleTrusted(
    "rayu:extensions:create-skill",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionCreateSkillSchema.parse(rawPayload)
      return createLocalSkill(activeWorkspaceDir, parsed)
    }
  )

  handleTrusted(
    "rayu:extensions:toggle-skill",
    async (_event, rawPayload: unknown) => {
      const parsed = ExtensionToggleSkillSchema.parse(rawPayload)
      return toggleLocalSkill(activeWorkspaceDir, parsed.skillId)
    }
  )

  // Real Git Changes & Diff Engine
  handleTrusted("rayu:git:changes", async () => {
    return getGitChanges(activeWorkspaceDir)
  })

  handleTrusted(
    "rayu:git:file-diff",
    async (_event, rawPayload: unknown) => {
      const parsed = GitFileDiffPayloadSchema.parse(rawPayload)
      return getGitFileDiff(activeWorkspaceDir, parsed.filePath)
    }
  )

  handleTrusted(
    "rayu:git:toggle-stage",
    async (_event, rawPayload: unknown) => {
      const parsed = GitToggleStagePayloadSchema.parse(rawPayload)
      return toggleGitStage(activeWorkspaceDir, parsed.filePath, parsed.staged)
    }
  )

  handleTrusted("rayu:git:stage-all", async (_event, rawPayload: unknown) => {
    const parsed = GitStageAllPayloadSchema.parse(rawPayload)
    return setAllGitStaged(activeWorkspaceDir, parsed.staged)
  })

  handleTrusted(
    "rayu:git:discard-file",
    async (_event, rawPayload: unknown) => {
      const parsed = GitDiscardFilePayloadSchema.parse(rawPayload)
      return discardGitFile(activeWorkspaceDir, parsed.filePath)
    }
  )

  handleTrusted("rayu:git:commit", async (_event, rawPayload: unknown) => {
    const parsed = GitCommitPayloadSchema.parse(rawPayload)
    return commitGitStaged(activeWorkspaceDir, parsed.message)
  })

  handleTrusted("rayu:git:create-pr", async (_event, rawPayload: unknown) => {
    const parsed = GitCreatePrPayloadSchema.parse(rawPayload)
    return createGitPullRequest(activeWorkspaceDir, parsed)
  })

  handleTrusted("rayu:git:commits", async () => {
    return getGitCommits(activeWorkspaceDir, 30)
  })

  handleTrusted("rayu:git:branches", async () => {
    return listGitBranches(activeWorkspaceDir)
  })

  handleTrusted(
    "rayu:git:checkout",
    async (_event, rawPayload: unknown) => {
      const parsed = GitCheckoutBranchPayloadSchema.parse(rawPayload)
      return checkoutGitBranch(activeWorkspaceDir, parsed.branch)
    }
  )

  handleTrusted(
    "rayu:git:create-worktree",
    async (_event, rawPayload: unknown) => {
      const parsed = GitCreateWorktreePayloadSchema.parse(rawPayload ?? {})
      const created = await createGitWorktree(
        activeWorkspaceDir,
        parsed.baseBranch
      )
      if (created.ok && created.path) {
        activeWorkspaceDir = path.resolve(created.path)
        daemonClient.setWorkingDir(activeWorkspaceDir)
        recordRecentWorkspace(activeWorkspaceDir)
      }
      return created
    }
  )

  // Real Local Shell Terminal Runner & Interactive OS PTY Sessions
  handleTrusted("rayu:terminal:run", async (_event, rawPayload: unknown) => {
    const parsed = TerminalRunPayloadSchema.parse(rawPayload)
    return runTerminalCommand(activeWorkspaceDir, parsed.command)
  })

  handleTrusted(
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

  handleTrusted(
    "rayu:terminal:pty-write",
    async (_event, rawPayload: unknown) => {
      const parsed = TerminalPtyWritePayloadSchema.parse(rawPayload)
      return terminalPty.write(parsed.sessionId, parsed.data)
    }
  )

  handleTrusted(
    "rayu:terminal:pty-resize",
    async (_event, rawPayload: unknown) => {
      const parsed = TerminalPtyResizePayloadSchema.parse(rawPayload)
      return terminalPty.resize(parsed.sessionId, parsed.cols, parsed.rows)
    }
  )

  handleTrusted(
    "rayu:terminal:pty-kill",
    async (_event, rawPayload: unknown) => {
      const parsed = TerminalPtyKillPayloadSchema.parse(rawPayload)
      return terminalPty.kill(parsed.sessionId)
    }
  )

  // Real Rayu Cloud Authentication (OAuth loopback + API key + live credits/models)
  handleTrusted("rayu:auth:state", async () => {
    return authManager.getState()
  })

  handleTrusted("rayu:auth:refresh", async () => {
    return authManager.refreshAccountDetails()
  })

  handleTrusted("rayu:auth:sign-in-browser", async () => {
    const state = await authManager.signInWithBrowser()
    await daemonClient.notifyAuthChanged("rayu")
    return state
  })

  handleTrusted("rayu:auth:cancel-sign-in", async () => {
    return authManager.cancelBrowserSignIn()
  })

  handleTrusted(
    "rayu:auth:sign-in-apikey",
    async (_event, rawPayload: unknown) => {
      const parsed = AuthApiKeyPayloadSchema.parse(rawPayload)
      const state = await authManager.signInWithApiKey(parsed.apiKey)
      await daemonClient.setApiKey("rayu", parsed.apiKey)
      await daemonClient.notifyAuthChanged("rayu")
      return state
    }
  )

  handleTrusted(
    "rayu:auth:complete-callback",
    async (_event, rawPayload: unknown) => {
      const parsed = AuthCallbackUrlPayloadSchema.parse(rawPayload)
      const state = await authManager.completeManualCallback(parsed.callbackUrl)
      await daemonClient.notifyAuthChanged("rayu")
      return state
    }
  )

  handleTrusted("rayu:auth:sign-out", async () => {
    const state = await authManager.signOut()
    await daemonClient.clearApiKey("rayu")
    await daemonClient.notifyAuthChanged("rayu")
    return state
  })

  // Direct Rayu Cloud Gateway Streaming (works immediately after sign-in even before Rust daemon starts)
  handleTrusted(
    "rayu:cloud:stream-chat",
    async (_event, rawPayload: unknown) => {
      const parsed = CloudStreamChatPayloadSchema.parse(rawPayload)
      void authManager
        .streamCloudChat({
          sessionId: parsed.sessionId,
          model: parsed.model,
          reasoningEffort: parsed.reasoningEffort,
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

  handleTrusted(
    "rayu:cloud:cancel-stream",
    async (_event, rawPayload: unknown) => {
      const parsed = CloudCancelStreamPayloadSchema.parse(rawPayload)
      authManager.cancelStream(parsed.sessionId)
      return { ok: true }
    }
  )

  // Native OS Actions
  handleTrusted(
    "rayu:native:open-excel",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInExcelPayloadSchema.parse(rawPayload)
      return openInExcel(parsed.filePath, activeWorkspaceDir)
    }
  )

  handleTrusted(
    "rayu:native:open-powerpoint",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInPowerPointPayloadSchema.parse(rawPayload)
      return openInPowerPoint(parsed, activeWorkspaceDir)
    }
  )

  handleTrusted(
    "rayu:native:open-vscode",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInVSCodePayloadSchema.parse(rawPayload)
      return openInVSCode(parsed.targetPath, parsed.line, activeWorkspaceDir)
    }
  )

  handleTrusted(
    "rayu:native:open-external",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenExternalPayloadSchema.parse(rawPayload)
      return openExternal(parsed.url)
    }
  )

  handleTrusted(
    "rayu:native:reveal-in-finder",
    async (_event, rawPayload: unknown) => {
      const parsed = RevealInFinderPayloadSchema.parse(rawPayload)
      return revealInFinder(parsed.targetPath)
    }
  )

  handleTrusted(
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
  handleTrusted("rayu:office:pick-excel", async () => {
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

  handleTrusted(
    "rayu:office:read-excel",
    async (_event, rawPayload: unknown) => {
      const parsed = OfficeReadExcelPayloadSchema.parse(rawPayload)
      return readRealExcelWorkbook(activeWorkspaceDir, parsed.filePath)
    }
  )

  handleTrusted(
    "rayu:office:write-excel",
    async (_event, rawPayload: unknown) => {
      const parsed = OfficeWriteExcelPayloadSchema.parse(rawPayload)
      return writeRealExcelWorkbook(activeWorkspaceDir, parsed)
    }
  )

  handleTrusted(
    "rayu:office:create-pptx",
    async (_event, rawPayload: unknown) => {
      const parsed = OfficeCreatePptxPayloadSchema.parse(rawPayload)
      return createRealPowerPointDeck(activeWorkspaceDir, parsed)
    }
  )

  // Native Electron CDP Browser Automation (controls the live right-sidebar <webview>)
  handleTrusted(
    "rayu:browser:cdp-navigate",
    async (_event, rawPayload: unknown) => {
      const parsed = BrowserCdpNavigateSchema.parse(rawPayload)
      return browserCdp.navigate(parsed.url)
    }
  )

  handleTrusted("rayu:browser:cdp-snapshot", async () => {
    return browserCdp.snapshot()
  })

  handleTrusted(
    "rayu:browser:cdp-click",
    async (_event, rawPayload: unknown) => {
      const parsed = BrowserCdpClickSchema.parse(rawPayload)
      return browserCdp.click(parsed.ref)
    }
  )

  handleTrusted(
    "rayu:browser:cdp-type",
    async (_event, rawPayload: unknown) => {
      const parsed = BrowserCdpTypeSchema.parse(rawPayload)
      return browserCdp.type(parsed.ref, parsed.text, parsed.submit)
    }
  )

  handleTrusted("rayu:browser:cdp-screenshot", async () => {
    return browserCdp.screenshot()
  })

  // Real Telegram Remote (backed by Rust rayu daemon telegram_remote & telegram_bridge)
  handleTrusted("rayu:telegram:state", async () => {
    return telegramManager.getState()
  })

  handleTrusted(
    "rayu:telegram:start-hosted",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramStartHostedSchema.parse(rawPayload ?? {})
      return telegramManager.startHosted(Boolean(parsed.replaceExisting))
    }
  )

  handleTrusted(
    "rayu:telegram:connect-bot-token",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramConnectBotTokenSchema.parse(rawPayload)
      return telegramManager.connectBotToken(parsed)
    }
  )

  handleTrusted(
    "rayu:telegram:disconnect",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramDisconnectSchema.parse(rawPayload ?? {})
      return telegramManager.disconnect(Boolean(parsed.localOnly))
    }
  )

  handleTrusted(
    "rayu:telegram:resolve-approval",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramResolveApprovalSchema.parse(rawPayload)
      return telegramManager.resolveApproval(parsed.approvalId, parsed.decision)
    }
  )

  handleTrusted(
    "rayu:telegram:set-remote-uninstall",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramSetRemoteUninstallSchema.parse(rawPayload)
      return telegramManager.setRemoteUninstall(parsed.enabled)
    }
  )

  handleTrusted(
    "rayu:telegram:select-session",
    async (_event, rawPayload: unknown) => {
      const parsed = TelegramSelectSessionSchema.parse(rawPayload)
      return telegramManager.selectSession(parsed.sessionId)
    }
  )

  handleTrusted("rayu:telegram:ping", async () => {
    return telegramManager.sendTestPing()
  })

  // Real Subagent Models & Agent Personas (backed by Rust daemon `agents` + `subagent_model`)
  handleTrusted("rayu:agents:state", async (_event, rawPayload: unknown) => {
    const parsed = AgentsGetStateSchema.parse(rawPayload ?? undefined)
    return agentsManager.getState(parsed?.sessionId)
  })

  handleTrusted(
    "rayu:agents:set-role-model",
    async (_event, rawPayload: unknown) => {
      const parsed = AgentsSetRoleModelSchema.parse(rawPayload)
      return agentsManager.setRoleModel(parsed)
    }
  )

  handleTrusted(
    "rayu:agents:set-subagent-model",
    async (_event, rawPayload: unknown) => {
      const parsed = AgentsSetSubagentModelSchema.parse(rawPayload)
      return agentsManager.setSubagentModel(parsed)
    }
  )

  handleTrusted(
    "rayu:agents:upsert-profile",
    async (_event, rawPayload: unknown) => {
      const parsed = AgentsUpsertProfileSchema.parse(rawPayload)
      return agentsManager.upsertProfile(parsed)
    }
  )

  handleTrusted(
    "rayu:agents:delete-profile",
    async (_event, rawPayload: unknown) => {
      const parsed = AgentsDeleteProfileSchema.parse(rawPayload)
      return agentsManager.deleteProfile(parsed)
    }
  )

  // Push events -> Renderer
  daemonClient.on("status", (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("rayu:daemon:status-changed", status)
    }
    if (status?.connected && status.mode === "live") {
      void migrateLegacyEngineSettingsOnce({
        getConfig: () => daemonClient.getConfig(),
        patchConfig: (patch) => daemonClient.patchConfig(patch),
      }).catch(() => {})
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

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (attachEvent, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      if (!isAllowedWebviewUrl(params.src)) {
        attachEvent.preventDefault()
      }
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedWebviewUrl(url) && /^https?:\/\//i.test(url)) {
        void openExternal(url)
      }
      return { action: "deny" }
    })
  })

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

let quitCleanupDone = false

app.on("before-quit", (event) => {
  if (quitCleanupDone) {
    return
  }
  event.preventDefault()
  terminalPty.killAll()
  authManager.dispose()
  browserCdp.detachAll()
  void Promise.race([
    daemonClient.shutdown(),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ])
    .catch(() => {})
    .finally(() => {
      disposeWorkspaceRegistry()
      quitCleanupDone = true
      app.quit()
    })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
