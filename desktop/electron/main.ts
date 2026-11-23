import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, ipcMain } from "electron"
import type { RuntimeCommand, ServerFrame } from "@rayu-dev/rayucode-sdk"

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
  DaemonInvokePayloadSchema,
  GitCommitPayloadSchema,
  GitCreatePrPayloadSchema,
  GitDiscardFilePayloadSchema,
  GitStageAllPayloadSchema,
  GitToggleStagePayloadSchema,
  HarnessCreateSessionSchema,
  HarnessPermissionResponseSchema,
  HarnessRuntimeCommandSchema,
  HarnessSendMessageSchema,
  HarnessSessionIdSchema,
  HarnessSetEffortSchema,
  HarnessSetModelSchema,
  OpenExternalPayloadSchema,
  OpenInExcelPayloadSchema,
  OpenInVSCodePayloadSchema,
  TerminalRunPayloadSchema,
  WorkspaceReadFilePayloadSchema,
  WorkspaceSetPayloadSchema,
} from "./ipc-schemas.js"
import { openExternal, openInExcel, openInVSCode } from "./native-bridge.js"
import { runTerminalCommand } from "./terminal-bridge.js"
import {
  getWorkspaceInfo,
  pickWorkspaceFolder,
  readWorkspaceFile,
} from "./workspace-bridge.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const daemonClient = new RayuDaemonClient()

let activeWorkspaceDir =
  process.env.RAYU_WORKSPACE_DIR ?? path.resolve(__dirname, "..", "..")
let mainWindow: BrowserWindow | null = null

function registerIpcHandlers(): void {
  // Daemon lifecycle
  ipcMain.handle("rayu:daemon:status", async () => {
    return daemonClient.checkConnection()
  })

  ipcMain.handle("rayu:daemon:launch", async () => {
    return daemonClient.launchAndConnect()
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
      return daemonClient.createSession(parsed.workingDir ?? activeWorkspaceDir)
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
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:set", async (_event, rawPayload: unknown) => {
    const parsed = WorkspaceSetPayloadSchema.parse(rawPayload)
    activeWorkspaceDir = path.resolve(parsed.path)
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle("rayu:workspace:pick-folder", async () => {
    const chosen = await pickWorkspaceFolder(mainWindow)
    if (!chosen) return null
    activeWorkspaceDir = path.resolve(chosen)
    return getWorkspaceInfo(activeWorkspaceDir)
  })

  ipcMain.handle(
    "rayu:workspace:read-file",
    async (_event, rawPayload: unknown) => {
      const parsed = WorkspaceReadFilePayloadSchema.parse(rawPayload)
      return readWorkspaceFile(activeWorkspaceDir, parsed.filePath)
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

  // Native OS Actions
  ipcMain.handle(
    "rayu:native:open-excel",
    async (_event, rawPayload: unknown) => {
      const parsed = OpenInExcelPayloadSchema.parse(rawPayload)
      return openInExcel(parsed.filePath)
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
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 934,
    minWidth: 1024,
    minHeight: 680,
    title: "RayuCode",
    backgroundColor: "#11110E",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"))
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers()
  await createMainWindow()
  // Probe local rayu api-bridge in background without blocking window paint
  void daemonClient.checkConnection()

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on("before-quit", () => {
  daemonClient.dispose()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
