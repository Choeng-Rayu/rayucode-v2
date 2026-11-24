import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  RayucodeClient,
  apiSocketPath,
  unixSocketTransport,
  type ApiRequest,
  type ConnectOptions,
  type FileChangeActionKind,
  type FileChangeActionResponse,
  type FileChangeDiffPayload,
  type FileChangesSnapshot,
  type FileContent,
  type HistoryMessage,
  type ImageAttachment,
  type PermissionDecision,
  type RenderedImage,
  type RuntimeCommand,
  type RuntimeInfo,
  type ServerFrame,
  type SessionInfo,
  type Transport,
} from "@rayu-dev/rayucode-sdk"

import { getRayuAppConfigDir, getRayuConfigDir } from "./auth-bridge.js"
import {
  buildDesktopSdkTools,
  type DesktopToolDeps,
} from "./desktop-tools.js"

export type PermissionModeId =
  | "default"
  | "acceptEdits"
  | "plan"
  | "fullManage"
  | "orchestrator"

function toWirePermissionMode(mode: PermissionModeId): string {
  if (mode === "acceptEdits") return "accept_edits"
  if (mode === "fullManage") return "full_manage"
  return mode
}

function isUnixSocketPath(socketPath: string): boolean {
  try {
    return fs.statSync(socketPath).isSocket()
  } catch {
    return false
  }
}

export function wrapTransportWithSupportsPermissions(base: Transport): Transport {
  let patchedHello = false
  return {
    write(data: string) {
      if (!patchedHello && data.includes('"hello"')) {
        const rewritten = data
          .split("\n")
          .map((line) => {
            const trimmed = line.trim()
            if (!trimmed || patchedHello) return line
            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>
              if (parsed.req === "hello") {
                patchedHello = true
                if (parsed.supports_permissions === undefined) {
                  parsed.supports_permissions = true
                }
                return JSON.stringify(parsed)
              }
            } catch {
              // preserve non-JSON line
            }
            return line
          })
          .join("\n")
        base.write(rewritten)
        return
      }
      base.write(data)
    },
    onData: (listener) => base.onData(listener),
    onClose: (listener) => base.onClose(listener),
    close: () => base.close(),
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getDesktopInstanceHome(): string {
  return path.join(getRayuConfigDir(), "desktop-instance")
}

function safeSymlinkFile(source: string, destination: string): void {
  try {
    if (!fs.existsSync(source)) return
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
    try {
      fs.unlinkSync(destination)
    } catch {
      // absent
    }
    fs.symlinkSync(source, destination)
  } catch {
    // Fallback to copy if symlinks are restricted (e.g. Windows without Developer Mode)
    try {
      fs.copyFileSync(source, destination)
      if (process.platform !== "win32") {
        fs.chmodSync(destination, 0o600)
      }
    } catch {
      // non-fatal
    }
  }
}

/**
 * `@rayu-dev/rayucode-sdk`'s `launch()` omits `rayu-auth.json` from its
 * `CREDENTIAL_FILES` list. Mirror both `~/.rayu/rayu-auth.json` and the
 * platform `rayu.env` into our persistent Desktop instance home so the
 * launched Rust `rayu` daemon shares Desktop's live Rayu Cloud sign-in.
 */
export function syncRayuCredentialsToInstanceHome(instanceHome: string): void {
  try {
    fs.mkdirSync(instanceHome, { recursive: true, mode: 0o700 })
  } catch {
    return
  }

  const userHome = getRayuConfigDir()
  const authSource = path.join(userHome, "rayu-auth.json")
  const authDest = path.join(instanceHome, "rayu-auth.json")
  if (fs.existsSync(authSource)) {
    safeSymlinkFile(authSource, authDest)
  } else {
    try {
      fs.unlinkSync(authDest)
    } catch {
      // absent
    }
  }

  const envSource = path.join(getRayuAppConfigDir(), "rayu.env")
  const envDest = path.join(instanceHome, "config", "rayucode", "rayu.env")
  if (fs.existsSync(envSource)) {
    safeSymlinkFile(envSource, envDest)
  } else {
    try {
      fs.unlinkSync(envDest)
    } catch {
      // absent
    }
  }

  // Share user's MCP server registry (~/.rayu/mcp.json) with the Desktop daemon
  const mcpSource = path.join(userHome, "mcp.json")
  const mcpDest = path.join(instanceHome, "mcp.json")
  if (fs.existsSync(mcpSource)) {
    safeSymlinkFile(mcpSource, mcpDest)
  } else {
    try {
      fs.unlinkSync(mcpDest)
    } catch {
      // absent
    }
  }

  // Migrate any legacy isolated sessions from ~/.rayu/desktop-instance/sessions
  // into the canonical shared ~/.rayu/sessions directory so CLI, VS Code, and
  // Desktop all see the same unified session store.
  const isolatedSessionsDir = path.join(instanceHome, "sessions")
  const canonicalSessionsDir = path.join(userHome, "sessions")
  try {
    if (
      fs.existsSync(isolatedSessionsDir) &&
      !fs.lstatSync(isolatedSessionsDir).isSymbolicLink()
    ) {
      fs.mkdirSync(canonicalSessionsDir, { recursive: true, mode: 0o700 })
      for (const entry of fs.readdirSync(isolatedSessionsDir)) {
        const srcPath = path.join(isolatedSessionsDir, entry)
        const dstPath = path.join(canonicalSessionsDir, entry)
        if (!fs.existsSync(dstPath)) {
          try {
            fs.renameSync(srcPath, dstPath)
          } catch {
            try {
              fs.copyFileSync(srcPath, dstPath)
            } catch {
              // ignore individual copy error
            }
          }
        }
      }
    }
  } catch {
    // non-fatal migration
  }
}

function pickNewestExisting(paths: string[]): string | undefined {
  let bestPath: string | undefined
  let bestMtime = -1
  for (const p of paths) {
    try {
      const st = fs.statSync(p)
      if (st.isFile() && st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs
        bestPath = p
      }
    } catch {
      // absent
    }
  }
  return bestPath
}

function resolveLocalRayuBinary(): string | undefined {
  const binName = process.platform === "win32" ? "rayu.exe" : "rayu"
  const repoRoot = path.resolve(__dirname, "..", "..")
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath
  const localDevBinary = pickNewestExisting([
    path.join(repoRoot, "target", "release", binName),
    path.join(repoRoot, "target", "debug", binName),
  ])
  const candidates = [
    process.env.RAYU_BINARY,
    // Packaged desktop app: bundled inside RayuCode.app/Contents/Resources/bin/rayu
    resourcesPath ? path.join(resourcesPath, "bin", binName) : undefined,
    // Newest local developer build inside rayucode-v2 (debug or release)
    localDevBinary,
    // User-installed CLI on PATH / Cargo / Homebrew
    path.join(os.homedir(), ".cargo", "bin", binName),
    `/opt/homebrew/bin/${binName}`,
    `/usr/local/bin/${binName}`,
  ].filter((p): p is string => Boolean(p))
  return candidates.find((candidate) => fs.existsSync(candidate))
}

export interface DaemonConnectionStatus {
  connected: boolean
  reconnecting: boolean
  socketPath: string
  version: string
  latencyMs: number
  mode?: "live" | "demo"
  lastError?: string | null
}

function hasLocalRayuCredentials(): boolean {
  if (process.env.RAYU_API_KEY?.trim()) return true
  const userHome = getRayuConfigDir()
  const credentialFiles = [
    "rayu-auth.json",
    "auth.json",
    "openai-auth.json",
    "gemini_oauth.json",
    "antigravity_oauth.json",
  ]
  for (const file of credentialFiles) {
    if (fs.existsSync(path.join(userHome, file))) return true
  }
  if (fs.existsSync(path.join(getRayuAppConfigDir(), "rayu.env"))) return true
  const legacyEnv = path.join(
    process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"),
    "rayucode",
    "rayu.env"
  )
  return fs.existsSync(legacyEnv)
}

function emptyFileChangesSnapshot(sessionId: string): FileChangesSnapshot {
  return {
    session_id: sessionId,
    latest_turn_id: 0,
    total_pending_files: 0,
    total_additions: 0,
    total_deletions: 0,
    files: [],
  }
}

function isUnsupportedFileChangesError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /unknown_request|unsupported|not support|file_changes/i.test(msg)
}

export class RayuDaemonClient extends EventEmitter {
  private socketPath: string
  private client: RayucodeClient | null = null
  private launchedClient: RayucodeClient | null = null
  private attachedSessionId: string | null = null
  private attachQueue: Promise<unknown> = Promise.resolve()
  private connecting: Promise<RayucodeClient> | null = null
  private launching: Promise<DaemonConnectionStatus> | null = null
  private checking: Promise<DaemonConnectionStatus> | null = null
  private hasConnectedOnce = false
  private hasProbedOnce = false
  private desktopRuntime: DesktopToolDeps | null = null
  private activeWorkingDir: string | null = null
  private desiredPermissionMode: PermissionModeId | null = null
  private syncedPermissionModeBySession = new Map<string, PermissionModeId>()
  private pendingPermissionSync = new Map<string, PermissionModeId>()
  private pendingToolSync = new Set<string>()
  private configuredToolSessions = new Set<string>()
  private status: DaemonConnectionStatus

  constructor(customSocketPath?: string) {
    super()
    this.socketPath = customSocketPath ?? apiSocketPath()
    this.status = {
      connected: false,
      reconnecting: false,
      socketPath: this.socketPath,
      version: "offline",
      latencyMs: 0,
      mode: "demo",
      lastError: null,
    }
  }

  configureDesktopRuntime(deps: DesktopToolDeps): void {
    this.desktopRuntime = deps
  }

  private getDesktopToolDeps(): DesktopToolDeps {
    return (
      this.desktopRuntime ?? {
        getWorkspaceDir: () => this.activeWorkingDir ?? process.cwd(),
      }
    )
  }

  getStatus(): DaemonConnectionStatus {
    return { ...this.status }
  }

  /**
   * Safe status reader for IPC `rayu:daemon:status`:
   * returns the live/cached status immediately if already connected, in-flight,
   * or already probed, so multiple UI mounts and window-focus refetches never
   * spawn duplicate daemon launches or flash a false Reconnecting banner.
   */
  async getOrProbeStatus(workingDir?: string): Promise<DaemonConnectionStatus> {
    if (this.client) {
      return this.getStatus()
    }
    if (this.launching) {
      return this.launching
    }
    if (this.checking) {
      return this.checking
    }
    if (this.hasProbedOnce) {
      return this.getStatus()
    }
    return this.checkConnection(workingDir)
  }

  private updateStatus(next: DaemonConnectionStatus): DaemonConnectionStatus {
    this.status = next
    this.emit("status", this.getStatus())
    return this.getStatus()
  }

  private attachClient(
    client: RayucodeClient,
    latencyMs: number,
    activeSocketPath?: string
  ): void {
    if (
      this.client &&
      this.client !== client &&
      this.client !== this.launchedClient
    ) {
      this.client.close()
    }
    this.client = client
    this.attachedSessionId = null
    this.configuredToolSessions.clear()
    this.syncedPermissionModeBySession.clear()
    this.hasConnectedOnce = true
    if (activeSocketPath) {
      this.socketPath = activeSocketPath
    }

    client.on("event", (frame: ServerFrame) => {
      this.emit("harness-event", frame)
      if (
        (frame.ev === "turn_done" || frame.ev === "turn_stopped") &&
        typeof frame.session_id === "string"
      ) {
        const sid = frame.session_id
        if (this.pendingToolSync.has(sid)) {
          this.pendingToolSync.delete(sid)
          void this.syncSessionTools(client, sid)
        }
        const queuedMode = this.pendingPermissionSync.get(sid)
        if (queuedMode) {
          this.pendingPermissionSync.delete(sid)
          void this.sendPermissionModeToClient(client, sid, queuedMode)
        }
      }
    })

    const onDisconnect = () => {
      if (this.client !== client) return
      this.client = null
      this.attachedSessionId = null
      this.configuredToolSessions.clear()
      this.updateStatus({
        connected: false,
        reconnecting: false,
        socketPath: this.socketPath,
        version: "offline",
        latencyMs: 0,
        mode: "demo",
        lastError: "Daemon socket closed",
      })
    }

    client.once("close", onDisconnect)
    client.on("error", () => {
      // Handled via close listener; avoid uncaught EventEmitter errors
    })

    this.updateStatus({
      connected: true,
      reconnecting: false,
      socketPath: this.socketPath,
      version: client.server || "rayu-harness-v1",
      latencyMs,
      mode: "live",
      lastError: null,
    })
  }

  private async dialSocket(targetSocket: string): Promise<RayucodeClient> {
    const startedAt = Date.now()
    let transport: Transport | undefined
    if (isUnixSocketPath(targetSocket)) {
      try {
        const rawTransport = await unixSocketTransport(targetSocket)
        transport = wrapTransportWithSupportsPermissions(rawTransport)
      } catch {
        transport = undefined
      }
    }
    const connectOptions = {
      socketPath: targetSocket,
      ...(transport ? { transport } : {}),
      clientName: "rayucode-desktop/0.1.0",
      supportsUserResponse: true,
      supportsPermissions: true,
      requestTimeoutMs: 15_000,
    } as ConnectOptions & { supportsPermissions?: boolean }
    const client = await RayucodeClient.connect(connectOptions)
    const latencyMs = Math.max(1, Date.now() - startedAt)
    this.attachClient(client, latencyMs, targetSocket)
    return client
  }

  async connect(
    workingDir?: string,
    options?: { autoLaunch?: boolean }
  ): Promise<RayucodeClient> {
    if (this.client) return this.client
    if (this.launching) {
      await this.launching.catch(() => {})
      if (this.client) return this.client
    }
    if (this.connecting) return this.connecting

    const allowAutoLaunch = options?.autoLaunch ?? true

    if (this.hasConnectedOnce) {
      this.updateStatus({
        ...this.status,
        reconnecting: true,
      })
    }

    this.connecting = (async () => {
      const instanceSocket = path.join(
        getDesktopInstanceHome(),
        "run",
        "rayu-api.sock"
      )
      // Fast-path: if the Desktop daemon socket is already alive and the default
      // socket path is absent, dial the live instance socket immediately.
      if (
        this.socketPath !== instanceSocket &&
        !isUnixSocketPath(this.socketPath) &&
        isUnixSocketPath(instanceSocket)
      ) {
        try {
          return await this.dialSocket(instanceSocket)
        } catch {
          // Fall through to standard probe/launch flow
        }
      }
      try {
        return await this.dialSocket(this.socketPath)
      } catch (firstErr) {
        if (this.socketPath !== instanceSocket && fs.existsSync(instanceSocket)) {
          try {
            return await this.dialSocket(instanceSocket)
          } catch {
            // Fall through to launch
          }
        }
        if (allowAutoLaunch && resolveLocalRayuBinary()) {
          const launchedStatus = await this.launchAndConnect(workingDir)
          if (this.client) return this.client
          if (launchedStatus.lastError) {
            throw new Error(launchedStatus.lastError, { cause: firstErr })
          }
        }
        const reason =
          firstErr instanceof Error ? firstErr.message : String(firstErr)
        this.updateStatus({
          connected: false,
          reconnecting: false,
          socketPath: this.socketPath,
          version: "offline",
          latencyMs: 0,
          mode: "demo",
          lastError: reason,
        })
        throw firstErr
      } finally {
        this.connecting = null
      }
    })()

    return this.connecting
  }

  async launchAndConnect(workingDir?: string): Promise<DaemonConnectionStatus> {
    if (this.client) {
      return this.getStatus()
    }
    if (this.launching) {
      return this.launching
    }

    const startedAt = Date.now()
    const instanceHome = getDesktopInstanceHome()
    const canonicalHome = getRayuConfigDir()
    const instanceSocket = path.join(instanceHome, "run", "rayu-api.sock")

    if (this.hasConnectedOnce) {
      this.updateStatus({
        ...this.status,
        reconnecting: true,
        socketPath: instanceSocket,
        lastError: null,
      })
    }

    this.launching = (async () => {
      try {
        const binary = resolveLocalRayuBinary()
        syncRayuCredentialsToInstanceHome(instanceHome)

        const launched = await RayucodeClient.launch({
          binary,
          workingDir,
          rayuHome: instanceHome,
          // Keep the private runtime socket in desktop-instance/run while
          // sharing the canonical ~/.rayu home so CLI, VS Code, and Desktop
          // all read and write the exact same ~/.rayu/sessions store.
          env: {
            RAYU_HOME: canonicalHome,
            RAYU_ENABLE_MERMAID: process.env.RAYU_ENABLE_MERMAID ?? "false",
          },
          inheritLogins: true,
          clientName: "rayucode-desktop/0.1.0",
          supportsUserResponse: true,
          supportsPermissions: true,
          requestTimeoutMs: 25_000,
        } as Parameters<typeof RayucodeClient.launch>[0] & {
          supportsPermissions?: boolean
        })
        this.launchedClient = launched
        const latencyMs = Math.max(1, Date.now() - startedAt)
        this.attachClient(launched, latencyMs, instanceSocket)
        return this.getStatus()
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error)
        return this.updateStatus({
          connected: false,
          reconnecting: false,
          socketPath: instanceSocket,
          version: `offline (${reason.slice(0, 96)})`,
          latencyMs: 0,
          mode: "demo",
          lastError: reason,
        })
      } finally {
        this.launching = null
      }
    })()

    return this.launching
  }

  async checkConnection(workingDir?: string): Promise<DaemonConnectionStatus> {
    if (this.launching) {
      return this.launching
    }
    if (this.checking) {
      return this.checking
    }

    this.hasProbedOnce = true
    const startedAt = Date.now()

    this.checking = (async () => {
      try {
        if (this.client) {
          await this.client.ping()
          return this.updateStatus({
            connected: true,
            reconnecting: false,
            socketPath: this.socketPath,
            version: this.client.server || "rayu-harness-v1",
            latencyMs: Math.max(1, Date.now() - startedAt),
            mode: "live",
            lastError: null,
          })
        }

        const client = await this.connect(workingDir, {
          autoLaunch: hasLocalRayuCredentials(),
        })
        await client.ping()
        return this.updateStatus({
          connected: true,
          reconnecting: false,
          socketPath: this.socketPath,
          version: client.server || "rayu-harness-v1",
          latencyMs: Math.max(1, Date.now() - startedAt),
          mode: "live",
          lastError: null,
        })
      } catch (connectErr) {
        // Auto-launch the local rayu binary once credentials exist
        if (resolveLocalRayuBinary() && hasLocalRayuCredentials()) {
          return this.launchAndConnect(workingDir)
        }
        const reason = !hasLocalRayuCredentials()
          ? "Sign in to Rayu Cloud to start the local Rust daemon."
          : connectErr instanceof Error
            ? connectErr.message
            : String(connectErr)
        return this.updateStatus({
          connected: false,
          reconnecting: false,
          socketPath: this.socketPath,
          version: "offline",
          latencyMs: 0,
          mode: "demo",
          lastError: reason,
        })
      } finally {
        this.checking = null
      }
    })()

    return this.checking
  }

  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.attachQueue.then(fn, fn)
    this.attachQueue = next.catch(() => {})
    return next
  }

  private async syncSessionTools(
    client: RayucodeClient,
    sessionId: string
  ): Promise<void> {
    if (!sessionId || typeof client.configureTools !== "function") {
      return
    }
    if (
      typeof client.supports === "function" &&
      !client.supports("session_tools")
    ) {
      return
    }
    const desktopTools = buildDesktopSdkTools(this.getDesktopToolDeps())
    try {
      await client.configureTools(sessionId, { custom: desktopTools })
      this.configuredToolSessions.add(sessionId)
      this.pendingToolSync.delete(sessionId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/busy/i.test(msg)) {
        this.pendingToolSync.add(sessionId)
      }
    }
  }

  private async sendPermissionModeToClient(
    client: RayucodeClient,
    sessionId: string,
    mode: PermissionModeId
  ): Promise<{ ok: boolean; error?: string }> {
    if (typeof client.request !== "function") {
      return { ok: true }
    }
    try {
      const frame = await client.request({
        req: "set_permission_mode",
        session_id: sessionId,
        mode: toWirePermissionMode(mode),
      } as unknown as ApiRequest)
      if (frame?.ev === "error") {
        const msg = String(frame.message ?? "Failed to set permission mode")
        if (/busy/i.test(msg)) {
          this.pendingPermissionSync.set(sessionId, mode)
          return { ok: true }
        }
        return { ok: false, error: msg }
      }
      this.pendingPermissionSync.delete(sessionId)
      this.syncedPermissionModeBySession.set(sessionId, mode)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/busy/i.test(msg)) {
        this.pendingPermissionSync.set(sessionId, mode)
        return { ok: true }
      }
      return { ok: false, error: msg }
    }
  }

  private async syncDesiredPermissionMode(
    client: RayucodeClient,
    sessionId: string
  ): Promise<void> {
    if (!this.desiredPermissionMode || !sessionId) return
    if (
      typeof client.supports === "function" &&
      Array.isArray(client.capabilities) &&
      client.capabilities.length > 0 &&
      !client.supports("permission_modes") &&
      !client.supports("permissions")
    ) {
      return
    }
    await this.sendPermissionModeToClient(
      client,
      sessionId,
      this.desiredPermissionMode
    ).catch(() => {})
  }

  private async ensureAttached(
    client: RayucodeClient,
    sessionId: string
  ): Promise<RayucodeClient> {
    if (!sessionId) {
      return client
    }
    if (this.attachedSessionId === sessionId) {
      if (!this.configuredToolSessions.has(sessionId)) {
        await this.syncSessionTools(client, sessionId)
      }
      return client
    }
    // Just like `vscode/host/harnessSession.ts`, a socket connection in the
    // Rust daemon is bound to the first session it subscribes to. When
    // switching to a different sessionId, open a fresh socket connection so
    // `attach_session` replies immediately instead of timing out after 15s.
    let targetClient = client
    if (this.attachedSessionId !== null) {
      targetClient = await this.dialSocket(this.socketPath)
    }
    const info = await targetClient.attachSession(sessionId)
    this.attachedSessionId = info.session_id
    await Promise.allSettled([
      this.syncSessionTools(targetClient, info.session_id),
      this.syncDesiredPermissionMode(targetClient, info.session_id),
    ])
    return targetClient
  }

  async listSessions(includeArchived = false): Promise<SessionInfo[]> {
    const client = await this.connect()
    return client.listSessions({ includeArchived, limit: 100 })
  }

  async createSession(
    workingDir: string,
    title?: string
  ): Promise<SessionInfo> {
    return this.runSerialized(async () => {
      this.activeWorkingDir = workingDir
      let client = await this.connect(workingDir)
      // In the RayuCode Harness protocol, a socket connection binds its
      // provisional session on the first `create_session` subscribe. Just like
      // `vscode/host/harnessSession.ts`, open a fresh client connection when
      // creating a subsequent session so the Rust daemon allocates a brand-new
      // Agent and session_id while keeping the previous session persisted.
      if (this.attachedSessionId !== null) {
        client = await this.dialSocket(this.socketPath)
      }
      const info = await client.createSession({ workingDir })
      this.attachedSessionId = info.session_id
      const normalizedTitle = title?.trim()
      let renamed = false
      await Promise.allSettled([
        this.syncSessionTools(client, info.session_id),
        this.syncDesiredPermissionMode(client, info.session_id),
        normalizedTitle
          ? client
              .renameSession(info.session_id, normalizedTitle)
              .then(() => {
                renamed = true
              })
          : Promise.resolve(),
      ])
      if (normalizedTitle && renamed) {
        return {
          ...info,
          title: normalizedTitle,
        }
      }
      return info
    })
  }

  async attachSession(sessionId: string): Promise<SessionInfo> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      if (this.attachedSessionId === sessionId) {
        if (!this.configuredToolSessions.has(sessionId)) {
          await this.syncSessionTools(client, sessionId)
        }
        await this.syncDesiredPermissionMode(client, sessionId)
        const list = await client
          .listSessions({ includeArchived: true, limit: 100 })
          .catch(() => [])
        const matched = list.find((s) => s.session_id === sessionId)
        if (matched) return matched
      }
      if (this.attachedSessionId !== null && this.attachedSessionId !== sessionId) {
        client = await this.dialSocket(this.socketPath)
      }
      const info = await client.attachSession(sessionId)
      this.attachedSessionId = info.session_id
      await Promise.allSettled([
        this.syncSessionTools(client, info.session_id),
        this.syncDesiredPermissionMode(client, info.session_id),
      ])
      return info
    })
  }

  async forkSession(sessionId: string): Promise<SessionInfo> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      return client.forkSession(sessionId)
    })
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      await client.renameSession(sessionId, title)
    })
  }

  async getHistory(
    sessionId: string
  ): Promise<{ messages: HistoryMessage[]; images: RenderedImage[] }> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      return client.getHistoryWithImages(sessionId)
    })
  }

  async sendMessage(
    sessionId: string,
    content: string,
    images?: ImageAttachment[]
  ): Promise<void> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      const trimmed = content.trim()
      const finalContent =
        trimmed.length > 0 ? content : "Analyze the attached image(s)."
      await client.sendMessage(sessionId, finalContent, {
        waitForAccept: true,
        ...(images && images.length > 0 ? { images } : {}),
      })
    })
  }

  async cancel(sessionId: string): Promise<void> {
    const client = await this.connect()
    await client.cancel(sessionId)
  }

  async respondToPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision
  ): Promise<void> {
    const client = await this.connect()
    await client.respondToPermission(sessionId, requestId, decision)
  }

  async setPermissionMode(
    sessionId: string,
    mode: PermissionModeId
  ): Promise<{ ok: boolean; error?: string }> {
    this.desiredPermissionMode = mode
    if (!sessionId || sessionId.startsWith("ses_")) {
      return { ok: true }
    }
    if (!this.client) {
      return { ok: true }
    }
    if (this.syncedPermissionModeBySession.get(sessionId) === mode) {
      return { ok: true }
    }
    if (this.attachedSessionId === sessionId) {
      return this.sendPermissionModeToClient(this.client, sessionId, mode)
    }
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      return this.sendPermissionModeToClient(client, sessionId, mode)
    })
  }

  async getRuntimeInfo(sessionId: string): Promise<RuntimeInfo> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      return client.getRuntimeInfo(sessionId)
    })
  }

  async listModels(
    sessionId: string
  ): Promise<{ models: string[]; current?: string }> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      return client.listModels(sessionId)
    })
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    if (!sessionId || sessionId.startsWith("ses_")) return
    return this.runSerialized(async () => {
      try {
        let client = await this.connect()
        client = await this.ensureAttached(client, sessionId)
        await client.setModel(sessionId, model)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/not support|invalid_request|busy|unknown model/i.test(msg)) {
          return
        }
        throw err
      }
    })
  }

  async setReasoningEffort(sessionId: string, effort: string): Promise<void> {
    if (!sessionId || sessionId.startsWith("ses_")) return
    return this.runSerialized(async () => {
      try {
        let client = await this.connect()
        client = await this.ensureAttached(client, sessionId)
        await client.setReasoningEffort(sessionId, effort)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/not support|reasoning effort|invalid_request|busy/i.test(msg)) {
          return
        }
        throw err
      }
    })
  }

  async readFile(sessionId: string, filePath: string): Promise<FileContent> {
    const client = await this.connect()
    return client.readFile(sessionId, filePath)
  }

  async runtimeCommand(
    sessionId: string,
    command: RuntimeCommand,
    args: string[] = []
  ): Promise<{ command: RuntimeCommand; data: unknown; message: string }> {
    return this.runSerialized(async () => {
      let client = await this.connect()
      client = await this.ensureAttached(client, sessionId)
      return client.runtimeCommand(sessionId, command, args)
    })
  }

  private supportsFileChanges(client: RayucodeClient): boolean {
    if (typeof client.getFileChanges !== "function") {
      return false
    }
    if (
      typeof client.supports === "function" &&
      Array.isArray(client.capabilities) &&
      client.capabilities.length > 0 &&
      !client.supports("file_changes")
    ) {
      return false
    }
    return true
  }

  async getFileChanges(sessionId: string): Promise<FileChangesSnapshot> {
    if (!sessionId || sessionId.startsWith("ses_")) {
      return emptyFileChangesSnapshot(sessionId)
    }
    if (this.client && this.attachedSessionId === sessionId) {
      try {
        if (!this.supportsFileChanges(this.client)) {
          return emptyFileChangesSnapshot(sessionId)
        }
        return await this.client.getFileChanges(sessionId)
      } catch {
        return emptyFileChangesSnapshot(sessionId)
      }
    }
    return this.runSerialized(async () => {
      try {
        let client = await this.connect()
        if (!this.supportsFileChanges(client)) {
          return emptyFileChangesSnapshot(sessionId)
        }
        client = await this.ensureAttached(client, sessionId)
        return await client.getFileChanges(sessionId)
      } catch (err) {
        if (isUnsupportedFileChangesError(err)) {
          return emptyFileChangesSnapshot(sessionId)
        }
        return emptyFileChangesSnapshot(sessionId)
      }
    })
  }

  async getFileChangeDiff(
    sessionId: string,
    filePath: string
  ): Promise<FileChangeDiffPayload | null> {
    if (!sessionId || sessionId.startsWith("ses_") || !filePath) {
      return null
    }
    return this.runSerialized(async () => {
      try {
        let client = await this.connect()
        if (!this.supportsFileChanges(client)) {
          return null
        }
        client = await this.ensureAttached(client, sessionId)
        return await client.getFileChangeDiff(sessionId, filePath)
      } catch (err) {
        if (isUnsupportedFileChangesError(err)) {
          return null
        }
        throw err
      }
    })
  }

  async fileChangeAction(
    sessionId: string,
    action: FileChangeActionKind,
    opts?: { path?: string; force?: boolean }
  ): Promise<FileChangeActionResponse> {
    if (!sessionId || sessionId.startsWith("ses_")) {
      return {
        ok: false,
        message: "Daemon is not connected",
        conflicts: [],
        snapshot: emptyFileChangesSnapshot(sessionId),
      }
    }
    return this.runSerialized(async () => {
      try {
        let client = await this.connect()
        if (!this.supportsFileChanges(client)) {
          return {
            ok: false,
            message: "Connected daemon does not support file_changes",
            conflicts: [],
            snapshot: emptyFileChangesSnapshot(sessionId),
          }
        }
        client = await this.ensureAttached(client, sessionId)
        const response = await client.fileChangeAction(sessionId, action, opts)
        if (response.snapshot) {
          this.emit("harness-event", {
            ev: "file_changes_state",
            session_id: sessionId,
            snapshot: response.snapshot,
          } as unknown as ServerFrame)
        }
        return response
      } catch (err) {
        if (isUnsupportedFileChangesError(err)) {
          return {
            ok: false,
            message: "Connected daemon does not support file_changes",
            conflicts: [],
            snapshot: emptyFileChangesSnapshot(sessionId),
          }
        }
        throw err
      }
    })
  }

  async notifyAuthChanged(provider = "rayu"): Promise<void> {
    syncRayuCredentialsToInstanceHome(getDesktopInstanceHome())
    if (!this.client) return
    await this.client.notifyAuthChanged(provider).catch(() => {})
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    syncRayuCredentialsToInstanceHome(getDesktopInstanceHome())
    if (!this.client) return
    await this.client.setApiKey(provider, apiKey).catch(() => {})
  }

  async clearApiKey(provider: string): Promise<void> {
    syncRayuCredentialsToInstanceHome(getDesktopInstanceHome())
    if (!this.client) return
    await this.client.clearApiKey(provider).catch(() => {})
  }

  async invoke<T = unknown>(method: string, params?: unknown): Promise<T> {
    const p = (params ?? {}) as Record<string, unknown>
    switch (method) {
      case "sessions.list":
        return (await this.listSessions(Boolean(p.includeArchived))) as T
      case "sessions.create":
        return (await this.createSession(String(p.workingDir ?? process.cwd()))) as T
      case "sessions.attach":
        return (await this.attachSession(String(p.sessionId))) as T
      case "sessions.fork":
        return (await this.forkSession(String(p.sessionId))) as T
      case "sessions.history":
        return (await this.getHistory(String(p.sessionId))) as T
      case "sessions.send":
        await this.sendMessage(String(p.sessionId), String(p.content))
        return { ok: true } as T
      case "sessions.cancel":
        await this.cancel(String(p.sessionId))
        return { ok: true } as T
      case "sessions.permission":
        await this.respondToPermission(
          String(p.sessionId),
          String(p.requestId),
          p.decision as PermissionDecision
        )
        return { ok: true } as T
      case "sessions.setPermissionMode":
        return (await this.setPermissionMode(
          String(p.sessionId),
          p.mode as PermissionModeId
        )) as T
      case "models.runtimeInfo":
        return (await this.getRuntimeInfo(String(p.sessionId))) as T
      case "models.list":
        return (await this.listModels(String(p.sessionId))) as T
      case "models.setModel":
        await this.setModel(String(p.sessionId), String(p.model))
        return { ok: true } as T
      case "models.setEffort":
        await this.setReasoningEffort(String(p.sessionId), String(p.effort))
        return { ok: true } as T
      case "runtime.command":
        return (await this.runtimeCommand(
          String(p.sessionId),
          p.command as RuntimeCommand,
          Array.isArray(p.args) ? p.args.map(String) : []
        )) as T
      case "fileChanges.get":
        return (await this.getFileChanges(String(p.sessionId))) as T
      case "fileChanges.diff":
        return (await this.getFileChangeDiff(
          String(p.sessionId),
          String(p.path)
        )) as T
      case "fileChanges.action":
        return (await this.fileChangeAction(
          String(p.sessionId),
          p.action as FileChangeActionKind,
          {
            path: typeof p.path === "string" ? p.path : undefined,
            force: typeof p.force === "boolean" ? p.force : undefined,
          }
        )) as T
      case "previews.setBrowserBounds":
        return { ok: true } as T
      default:
        return { ok: false, error: `Unsupported daemon invoke method: ${method}` } as T
    }
  }

  dispose(): void {
    const primary = this.client
    const launched = this.launchedClient
    this.client = null
    this.launchedClient = null
    if (primary) {
      void primary.close()
    }
    if (launched && launched !== primary) {
      void launched.close()
    }
  }
}
