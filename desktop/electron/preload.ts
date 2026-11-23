import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

import type { DaemonConnectionStatus } from "./daemon-client.js"
import type {
  GitChangesPayload,
  GitCommitReceipt,
  GitCreatePrReceipt,
} from "./git-bridge.js"
import type { TerminalCommandResult } from "./terminal-bridge.js"
import type { WorkspaceCodeFile, WorkspaceInfo } from "./workspace-bridge.js"

const rayuApi = {
  daemon: {
    getStatus: (): Promise<DaemonConnectionStatus> =>
      ipcRenderer.invoke("rayu:daemon:status"),
    launch: (): Promise<DaemonConnectionStatus> =>
      ipcRenderer.invoke("rayu:daemon:launch"),
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
  harness: {
    listSessions: (): Promise<unknown[]> =>
      ipcRenderer.invoke("rayu:harness:list-sessions"),
    createSession: (workingDir?: string): Promise<unknown> =>
      ipcRenderer.invoke("rayu:harness:create-session", { workingDir }),
    attachSession: (sessionId: string): Promise<unknown> =>
      ipcRenderer.invoke("rayu:harness:attach-session", { sessionId }),
    forkSession: (sessionId: string): Promise<unknown> =>
      ipcRenderer.invoke("rayu:harness:fork-session", { sessionId }),
    getHistory: (sessionId: string): Promise<unknown> =>
      ipcRenderer.invoke("rayu:harness:get-history", { sessionId }),
    sendMessage: (sessionId: string, content: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:harness:send-message", { sessionId, content }),
    cancel: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:harness:cancel", { sessionId }),
    respondToPermission: (
      sessionId: string,
      requestId: string,
      decision: "allow" | "allow_always" | "deny"
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:harness:permission-response", {
        sessionId,
        requestId,
        decision,
      }),
    getRuntimeInfo: (sessionId: string): Promise<unknown> =>
      ipcRenderer.invoke("rayu:harness:runtime-info", { sessionId }),
    setModel: (sessionId: string, model: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:harness:set-model", { sessionId, model }),
    setReasoningEffort: (
      sessionId: string,
      effort: string
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("rayu:harness:set-effort", { sessionId, effort }),
    runtimeCommand: (
      sessionId: string,
      command: string,
      args?: string[]
    ): Promise<{ command: string; data: unknown; message: string }> =>
      ipcRenderer.invoke("rayu:harness:runtime-command", {
        sessionId,
        command,
        args,
      }),
    onEvent: (callback: (frame: Record<string, unknown>) => void): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        frame: Record<string, unknown>
      ) => {
        callback(frame)
      }
      ipcRenderer.on("rayu:harness:event", listener)
      return () => {
        ipcRenderer.removeListener("rayu:harness:event", listener)
      }
    },
  },
  workspace: {
    getInfo: (): Promise<WorkspaceInfo> =>
      ipcRenderer.invoke("rayu:workspace:info"),
    setPath: (targetPath: string): Promise<WorkspaceInfo> =>
      ipcRenderer.invoke("rayu:workspace:set", { path: targetPath }),
    pickFolder: (): Promise<WorkspaceInfo | null> =>
      ipcRenderer.invoke("rayu:workspace:pick-folder"),
    readFile: (filePath: string): Promise<WorkspaceCodeFile> =>
      ipcRenderer.invoke("rayu:workspace:read-file", { filePath }),
  },
  git: {
    getChanges: (): Promise<GitChangesPayload | null> =>
      ipcRenderer.invoke("rayu:git:changes"),
    toggleStage: (
      filePath: string,
      staged: boolean
    ): Promise<GitChangesPayload | null> =>
      ipcRenderer.invoke("rayu:git:toggle-stage", { filePath, staged }),
    stageAll: (staged: boolean): Promise<GitChangesPayload | null> =>
      ipcRenderer.invoke("rayu:git:stage-all", { staged }),
    discardFile: (filePath: string): Promise<GitChangesPayload | null> =>
      ipcRenderer.invoke("rayu:git:discard-file", { filePath }),
    commit: (message: string): Promise<GitCommitReceipt> =>
      ipcRenderer.invoke("rayu:git:commit", { message }),
    createPr: (input: {
      baseBranch: string
      headBranch: string
      title: string
      summary: string
    }): Promise<GitCreatePrReceipt> =>
      ipcRenderer.invoke("rayu:git:create-pr", input),
  },
  terminal: {
    runCommand: (command: string): Promise<TerminalCommandResult> =>
      ipcRenderer.invoke("rayu:terminal:run", { command }),
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
