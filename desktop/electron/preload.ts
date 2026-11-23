import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

import type { DaemonConnectionStatus } from "./daemon-client.js"

const rayuApi = {
  daemon: {
    getStatus: (): Promise<DaemonConnectionStatus> =>
      ipcRenderer.invoke("rayu:daemon:status"),
    invoke: <T = unknown>(method: string, params?: unknown): Promise<T> =>
      ipcRenderer.invoke("rayu:daemon:invoke", { method, params }),
    onStatusChange: (
      callback: (status: DaemonConnectionStatus) => void
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        status: DaemonConnectionStatus
      ) => {
        callback(status)
      }
      ipcRenderer.on("rayu:daemon:status-changed", listener)
      return () => {
        ipcRenderer.removeListener("rayu:daemon:status-changed", listener)
      }
    },
  },
  native: {
    openInExcel: (filePath: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:native:open-excel", { filePath }),
    openInVSCode: (
      targetPath: string,
      line?: number
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:native:open-vscode", { targetPath, line }),
    openExternal: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:native:open-external", { url }),
  },
}

contextBridge.exposeInMainWorld("rayu", rayuApi)
