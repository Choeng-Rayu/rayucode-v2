import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, ipcMain, Menu, nativeImage } from "electron"
import type { RuntimeCommand, ServerFrame } from "@rayu-dev/rayucode-sdk"

import { RayuAuthManager, type RayuAuthState } from "./auth-bridge.js"
import { RayuDaemonClient } from "./daemon-client.js"
import {
  commitGitStaged,
  createGitPullRequest,
  discardGitFile,
  getGitChanges,
  setAllGitStaged,
  toggleGitStage,
} from "./git-bridge.js"
import {
  AuthApiKeyPayloadSchema,
  AuthCallbackUrlPayloadSchema,
  CloudCancelStreamPayloadSchema,
  CloudStreamChatPayloadSchema,
  DaemonInvokePayloadSchema,
  ExtensionCreateSkillSchema,
  ExtensionRemoveMcpSchema,
  ExtensionToggleSkillSchema,
  ExtensionUpsertMcpSchema,
  GitCommitPayloadSchema,
  GitCreatePrPayloadSchema,
  GitDiscardFilePayloadSchema,
  GitStageAllPayloadSchema,
  GitToggleStagePayloadSchema,
  HarnessCreateSessionSchema,
  HarnessPermissionResponseSchema,
  HarnessRenameSessionSchema,
  HarnessRuntimeCommandSchema,
  HarnessSendMessageSchema,
  HarnessSessionIdSchema,
  HarnessSetEffortSchema,
  HarnessSetModelSchema,
  OpenExternalPayloadSchema,
  OpenInExcelPayloadSchema,
  OpenInPowerPointPayloadSchema,
  OpenInVSCodePayloadSchema,
  StorageDeleteTemplateSchema,
  StoragePreferencesPatchSchema,
  StorageSaveTemplateSchema,
  StorageSessionStoreSchema,
  TerminalRunPayloadSchema,
  WorkspaceReadFilePayloadSchema,
  WorkspaceSetPayloadSchema,
} from "./ipc-schemas.js"
import {
  openExternal,
  openInExcel,
  openInPowerPoint,
  openInVSCode,
} from "./native-bridge.js"
import {
  createLocalSkill,
  deleteCustomTemplate,
  listLocalExtensions,
  listWorkspaceFiles,
  readCustomTemplates,
  readDesktopPreferences,
  readDesktopSessionStore,
  readRecentWorkspaces,
  recordRecentWorkspace,
  removeLocalMcpServer,
  saveCustomTemplate,
  toggleLocalSkill,
  upsertLocalMcpServer,
  writeDesktopPreferences,
  writeDesktopSessionStore,
} from "./storage-bridge.js"
import { runTerminalCommand } from "./terminal-bridge.js"
import {
  getWorkspaceInfo,
  pickWorkspaceFiles,
  pickWorkspaceFolder,
  readWorkspaceFile,
} from "./workspace-bridge.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const daemonClient = new RayuDaemonClient()
const authManager = new RayuAuthManager()

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
let mainWindow: BrowserWindow | null = null

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
  ipcMain.handle("rayu:harness:list-sessions", async () => {
    return daemonClient.listSessions(false)
  })

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
      return daemonClient.getHistory(parsed.sessionId)
    }
  )

  ipcMain.handle(
    "rayu:harness:send-message",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSendMessageSchema.parse(rawPayload)
      await daemonClient.sendMessage(parsed.sessionId, parsed.content)
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
      await daemonClient.setModel(parsed.sessionId, parsed.model)
      return { ok: true }
    }
  )

  ipcMain.handle(
    "rayu:harness:set-effort",
    async (_event, rawPayload: unknown) => {
      const parsed = HarnessSetEffortSchema.parse(rawPayload)
      await daemonClient.setReasoningEffort(parsed.sessionId, parsed.effort)
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

  // Real local Workspace & File Reader
  ipcMain.handle("rayu:workspace:info", async () => {
    recordRecentWorkspace(activeWorkspaceDir)
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:set", async (_event, rawPayload: unknown) => {
    const parsed = WorkspaceSetPayloadSchema.parse(rawPayload)
    activeWorkspaceDir = path.resolve(parsed.path)
    recordRecentWorkspace(activeWorkspaceDir)
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:pick-folder", async () => {
    const chosen = await pickWorkspaceFolder(mainWindow)
    if (!chosen) return null
    activeWorkspaceDir = path.resolve(chosen)
    recordRecentWorkspace(activeWorkspaceDir)
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

  // Real Local Shell Terminal Runner
  ipcMain.handle("rayu:terminal:run", async (_event, rawPayload: unknown) => {
    const parsed = TerminalRunPayloadSchema.parse(rawPayload)
    return runTerminalCommand(activeWorkspaceDir, parsed.command)
  })

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
      return openInExcel(parsed.filePath)
    }
  )

  ipcMain.handle(
    "rayu:native:open-powerpoint",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInPowerPointPayloadSchema.parse(rawPayload)
      return openInPowerPoint(parsed)
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

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 934,
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
    },
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
  authManager.dispose()
  daemonClient.dispose()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
