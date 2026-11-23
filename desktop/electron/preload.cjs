// Electron 45 sandboxed preload script (sandbox: true, contextIsolation: true).
// IMPORTANT: Sandboxed preload scripts ONLY receive `require` (for "electron"),
// `process`, and `global`. Do NOT use ESM `import` or CommonJS `exports`/`module`.
"use strict"

const { contextBridge, ipcRenderer } = require("electron")

const rayuApi = {
  daemon: {
    getStatus: () => ipcRenderer.invoke("rayu:daemon:status"),
    launch: () => ipcRenderer.invoke("rayu:daemon:launch"),
    invoke: (method, params) =>
      ipcRenderer.invoke("rayu:daemon:invoke", { method, params }),
    onStatusChange: (callback) => {
      const listener = (_event, status) => {
        callback(status)
      }
      ipcRenderer.on("rayu:daemon:status-changed", listener)
      return () => {
        ipcRenderer.removeListener("rayu:daemon:status-changed", listener)
      }
    },
  },
  harness: {
    listSessions: () => ipcRenderer.invoke("rayu:harness:list-sessions"),
    createSession: (workingDir, title) =>
      ipcRenderer.invoke("rayu:harness:create-session", { workingDir, title }),
    renameSession: (sessionId, title) =>
      ipcRenderer.invoke("rayu:harness:rename-session", { sessionId, title }),
    attachSession: (sessionId) =>
      ipcRenderer.invoke("rayu:harness:attach-session", { sessionId }),
    forkSession: (sessionId) =>
      ipcRenderer.invoke("rayu:harness:fork-session", { sessionId }),
    getHistory: (sessionId) =>
      ipcRenderer.invoke("rayu:harness:get-history", { sessionId }),
    sendMessage: (sessionId, content, images) =>
      ipcRenderer.invoke("rayu:harness:send-message", {
        sessionId,
        content,
        ...(images && images.length > 0 ? { images } : {}),
      }),
    cancel: (sessionId) =>
      ipcRenderer.invoke("rayu:harness:cancel", { sessionId }),
    respondToPermission: (sessionId, requestId, decision) =>
      ipcRenderer.invoke("rayu:harness:permission-response", {
        sessionId,
        requestId,
        decision,
      }),
    setPermissionMode: (sessionId, mode) =>
      ipcRenderer.invoke("rayu:harness:set-permission-mode", {
        sessionId,
        mode,
      }),
    getRuntimeInfo: (sessionId) =>
      ipcRenderer.invoke("rayu:harness:runtime-info", { sessionId }),
    setModel: (sessionId, model) =>
      ipcRenderer.invoke("rayu:harness:set-model", { sessionId, model }),
    setReasoningEffort: (sessionId, effort) =>
      ipcRenderer.invoke("rayu:harness:set-effort", { sessionId, effort }),
    runtimeCommand: (sessionId, command, args) =>
      ipcRenderer.invoke("rayu:harness:runtime-command", {
        sessionId,
        command,
        args,
      }),
    onEvent: (callback) => {
      const listener = (_event, frame) => {
        callback(frame)
      }
      ipcRenderer.on("rayu:harness:event", listener)
      return () => {
        ipcRenderer.removeListener("rayu:harness:event", listener)
      }
    },
  },
  workspace: {
    getInfo: () => ipcRenderer.invoke("rayu:workspace:info"),
    setPath: (targetPath) =>
      ipcRenderer.invoke("rayu:workspace:set", { path: targetPath }),
    pickFolder: () => ipcRenderer.invoke("rayu:workspace:pick-folder"),
    pickFiles: () => ipcRenderer.invoke("rayu:workspace:pick-files"),
    captureAppshot: () => ipcRenderer.invoke("rayu:workspace:capture-appshot"),
    readFile: (filePath) =>
      ipcRenderer.invoke("rayu:workspace:read-file", { filePath }),
    listFiles: () => ipcRenderer.invoke("rayu:workspace:list-files"),
    listRecent: () => ipcRenderer.invoke("rayu:workspace:list-recent"),
  },
  storage: {
    getPreferences: () => ipcRenderer.invoke("rayu:storage:get-preferences"),
    updatePreferences: (patch) =>
      ipcRenderer.invoke("rayu:storage:update-preferences", patch),
    getSessionStore: () => ipcRenderer.invoke("rayu:storage:get-sessions"),
    saveSessionStore: (store) =>
      ipcRenderer.invoke("rayu:storage:save-sessions", store),
    getTemplates: () => ipcRenderer.invoke("rayu:storage:get-templates"),
    saveTemplate: (input) =>
      ipcRenderer.invoke("rayu:storage:save-template", input),
    deleteTemplate: (id) =>
      ipcRenderer.invoke("rayu:storage:delete-template", { id }),
    getSidebarState: () =>
      ipcRenderer.invoke("rayu:storage:get-sidebar-state"),
    saveSidebarState: (state) =>
      ipcRenderer.invoke("rayu:storage:save-sidebar-state", state),
  },
  extensions: {
    list: () => ipcRenderer.invoke("rayu:extensions:list"),
    upsertMcp: (input) => ipcRenderer.invoke("rayu:extensions:upsert-mcp", input),
    removeMcp: (id, scope) =>
      ipcRenderer.invoke("rayu:extensions:remove-mcp", { id, scope }),
    createSkill: (input) =>
      ipcRenderer.invoke("rayu:extensions:create-skill", input),
    toggleSkill: (skillId) =>
      ipcRenderer.invoke("rayu:extensions:toggle-skill", { skillId }),
  },
  git: {
    getChanges: () => ipcRenderer.invoke("rayu:git:changes"),
    getCommits: () => ipcRenderer.invoke("rayu:git:commits"),
    listBranches: () => ipcRenderer.invoke("rayu:git:branches"),
    checkoutBranch: (branch) =>
      ipcRenderer.invoke("rayu:git:checkout", { branch }),
    createWorktree: (baseBranch) =>
      ipcRenderer.invoke("rayu:git:create-worktree", { baseBranch }),
    toggleStage: (filePath, staged) =>
      ipcRenderer.invoke("rayu:git:toggle-stage", { filePath, staged }),
    stageAll: (staged) =>
      ipcRenderer.invoke("rayu:git:stage-all", { staged }),
    discardFile: (filePath) =>
      ipcRenderer.invoke("rayu:git:discard-file", { filePath }),
    commit: (message) =>
      ipcRenderer.invoke("rayu:git:commit", { message }),
    createPr: (input) => ipcRenderer.invoke("rayu:git:create-pr", input),
  },
  terminal: {
    runCommand: (command) =>
      ipcRenderer.invoke("rayu:terminal:run", { command }),
    ptyCreate: (input) =>
      ipcRenderer.invoke("rayu:terminal:pty-create", input),
    ptyWrite: (sessionId, data) =>
      ipcRenderer.invoke("rayu:terminal:pty-write", { sessionId, data }),
    ptyResize: (sessionId, cols, rows) =>
      ipcRenderer.invoke("rayu:terminal:pty-resize", { sessionId, cols, rows }),
    ptyKill: (sessionId) =>
      ipcRenderer.invoke("rayu:terminal:pty-kill", { sessionId }),
    onPtyData: (callback) => {
      const listener = (_event, payload) => {
        callback(payload)
      }
      ipcRenderer.on("rayu:terminal:pty-data", listener)
      return () => {
        ipcRenderer.removeListener("rayu:terminal:pty-data", listener)
      }
    },
    onPtyExit: (callback) => {
      const listener = (_event, payload) => {
        callback(payload)
      }
      ipcRenderer.on("rayu:terminal:pty-exit", listener)
      return () => {
        ipcRenderer.removeListener("rayu:terminal:pty-exit", listener)
      }
    },
  },
  auth: {
    getState: () => ipcRenderer.invoke("rayu:auth:state"),
    refresh: () => ipcRenderer.invoke("rayu:auth:refresh"),
    signInWithBrowser: () => ipcRenderer.invoke("rayu:auth:sign-in-browser"),
    cancelSignIn: () => ipcRenderer.invoke("rayu:auth:cancel-sign-in"),
    signInWithApiKey: (apiKey) =>
      ipcRenderer.invoke("rayu:auth:sign-in-apikey", { apiKey }),
    completeCallback: (callbackUrl) =>
      ipcRenderer.invoke("rayu:auth:complete-callback", { callbackUrl }),
    signOut: () => ipcRenderer.invoke("rayu:auth:sign-out"),
    onAuthChange: (callback) => {
      const listener = (_event, state) => {
        callback(state)
      }
      ipcRenderer.on("rayu:auth:changed", listener)
      return () => {
        ipcRenderer.removeListener("rayu:auth:changed", listener)
      }
    },
  },
  cloud: {
    streamChat: (input) => ipcRenderer.invoke("rayu:cloud:stream-chat", input),
    cancelStream: (sessionId) =>
      ipcRenderer.invoke("rayu:cloud:cancel-stream", { sessionId }),
  },
  native: {
    openInExcel: (filePath) =>
      ipcRenderer.invoke("rayu:native:open-excel", { filePath }),
    openInPowerPoint: (input) =>
      ipcRenderer.invoke("rayu:native:open-powerpoint", input),
    openInVSCode: (targetPath, line) =>
      ipcRenderer.invoke("rayu:native:open-vscode", { targetPath, line }),
    openExternal: (url) =>
      ipcRenderer.invoke("rayu:native:open-external", { url }),
    revealInFinder: (targetPath) =>
      ipcRenderer.invoke("rayu:native:reveal-in-finder", { targetPath }),
    setKeepAwake: (enabled) =>
      ipcRenderer.invoke("rayu:native:keep-awake", { enabled }),
  },
  office: {
    pickExcelFile: () => ipcRenderer.invoke("rayu:office:pick-excel"),
    readExcel: (filePath) =>
      ipcRenderer.invoke("rayu:office:read-excel", { filePath }),
    writeExcel: (input) => ipcRenderer.invoke("rayu:office:write-excel", input),
    createPowerPoint: (input) =>
      ipcRenderer.invoke("rayu:office:create-pptx", input),
  },
  desktop: {
    onArtifact: (callback) => {
      const listener = (_event, artifact) => {
        callback(artifact)
      }
      ipcRenderer.on("rayu:desktop:artifact", listener)
      return () => {
        ipcRenderer.removeListener("rayu:desktop:artifact", listener)
      }
    },
  },
  browser: {
    navigate: (url) => ipcRenderer.invoke("rayu:browser:cdp-navigate", { url }),
    snapshot: () => ipcRenderer.invoke("rayu:browser:cdp-snapshot"),
    click: (ref) => ipcRenderer.invoke("rayu:browser:cdp-click", { ref }),
    type: (ref, text, submit) =>
      ipcRenderer.invoke("rayu:browser:cdp-type", { ref, text, submit }),
    screenshot: () => ipcRenderer.invoke("rayu:browser:cdp-screenshot"),
    onEnsureOpen: (callback) => {
      const listener = (_event, payload) => {
        callback(payload)
      }
      ipcRenderer.on("rayu:browser:ensure-open", listener)
      return () => {
        ipcRenderer.removeListener("rayu:browser:ensure-open", listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld("rayu", rayuApi)
