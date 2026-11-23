import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, ipcMain } from "electron"

import { RayuDaemonClient } from "./daemon-client.js"
import {
  DaemonInvokePayloadSchema,
  OpenExternalPayloadSchema,
  OpenInExcelPayloadSchema,
  OpenInVSCodePayloadSchema,
} from "./ipc-schemas.js"
import { openExternal, openInExcel, openInVSCode } from "./native-bridge.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const daemonClient = new RayuDaemonClient()

let mainWindow: BrowserWindow | null = null

function registerIpcHandlers(): void {
  ipcMain.handle("rayu:daemon:status", async () => {
    return daemonClient.checkConnection()
  })

  ipcMain.handle("rayu:daemon:invoke", async (_event, rawPayload: unknown) => {
    const parsed = DaemonInvokePayloadSchema.parse(rawPayload)
    return daemonClient.invoke(parsed.method, parsed.params)
  })

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

  daemonClient.on("status", (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("rayu:daemon:status-changed", status)
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

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
