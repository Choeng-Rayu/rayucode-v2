import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  RayucodeClient,
  apiSocketPath,
  type FileContent,
  type HistoryMessage,
  type PermissionDecision,
  type RenderedImage,
  type RuntimeCommand,
  type RuntimeInfo,
  type ServerFrame,
  type SessionInfo,
} from "@rayu-dev/rayucode-sdk"

import { getRayuAppConfigDir, getRayuConfigDir } from "./auth-bridge.js"

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

function resolveLocalRayuBinary(): string | undefined {
  const binName = process.platform === "win32" ? "rayu.exe" : "rayu"
  const repoRoot = path.resolve(__dirname, "..", "..")
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath
  const candidates = [
    process.env.RAYU_BINARY,
    // Packaged desktop app: bundled inside RayuCode.app/Contents/Resources/bin/rayu
    resourcesPath ? path.join(resourcesPath, "bin", binName) : undefined,
    // Local developer builds inside rayucode-v2
    path.join(repoRoot, "target", "release", binName),
    path.join(repoRoot, "target", "debug", binName),
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
  if (fs.existsSync(path.join(userHome, "rayu-auth.json"))) return true
  if (fs.existsSync(path.join(getRayuAppConfigDir(), "rayu.env"))) return true
  const legacyEnv = path.join(
    process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"),
    "rayucode",
    "rayu.env"
  )
  return fs.existsSync(legacyEnv)
}

export class RayuDaemonClient extends EventEmitter {
  private socketPath: string
  private client: RayucodeClient | null = null
  private attachedSessionId: string | null = null
  private attachQueue: Promise<unknown> = Promise.resolve()
  private connecting: Promise<RayucodeClient> | null = null
  private launching: Promise<DaemonConnectionStatus> | null = null
  private checking: Promise<DaemonConnectionStatus> | null = null
  private hasConnectedOnce = false
  private hasProbedOnce = false
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
    if (this.client && this.client !== client) {
      this.client.close()
    }
    this.client = client
    this.attachedSessionId = null
    this.hasConnectedOnce = true
    if (activeSocketPath) {
      this.socketPath = activeSocketPath
    }

    client.on("event", (frame: ServerFrame) => {
      this.emit("harness-event", frame)
    })

    const onDisconnect = () => {
      if (this.client !== client) return
      this.client = null
      this.attachedSessionId = null
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
    const client = await RayucodeClient.connect({
      socketPath: targetSocket,
      clientName: "rayucode-desktop/0.1.0",
      supportsUserResponse: true,
      requestTimeoutMs: 15_000,
    })
    const latencyMs = Math.max(1, Date.now() - startedAt)
    this.attachClient(client, latencyMs, targetSocket)
    return client
  }

  async connect(workingDir?: string): Promise<RayucodeClient> {
    if (this.client) return this.client
    if (this.launching) {
      await this.launching.catch(() => {})
      if (this.client) return this.client
    }
    if (this.connecting) return this.connecting

    if (this.hasConnectedOnce) {
      this.updateStatus({
        ...this.status,
        reconnecting: true,
      })
    }

    this.connecting = (async () => {
      try {
        return await this.dialSocket(this.socketPath)
      } catch (firstErr) {
        const instanceSocket = path.join(
          getDesktopInstanceHome(),
          "run",
          "rayu-api.sock"
        )
        if (this.socketPath !== instanceSocket && fs.existsSync(instanceSocket)) {
          try {
            return await this.dialSocket(instanceSocket)
          } catch {
            // Fall through to launch
          }
        }
        if (resolveLocalRayuBinary() && hasLocalRayuCredentials()) {
          await this.launchAndConnect(workingDir)
          if (this.client) return this.client
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

        const client = await RayucodeClient.launch({
          binary,
          workingDir,
          rayuHome: instanceHome,
          // Keep the private runtime socket in desktop-instance/run while
          // sharing the canonical ~/.rayu home so CLI, VS Code, and Desktop
          // all read and write the exact same ~/.rayu/sessions store.
          env: {
            RAYU_HOME: canonicalHome,
          },
          inheritLogins: true,
          clientName: "rayucode-desktop/0.1.0",
          supportsUserResponse: true,
          requestTimeoutMs: 25_000,
        })
        const latencyMs = Math.max(1, Date.now() - startedAt)
        this.attachClient(client, latencyMs, instanceSocket)
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

        const client = await this.connect(workingDir)
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

  private async ensureAttached(
    client: RayucodeClient,
    sessionId: string
  ): Promise<void> {
    if (!sessionId || this.attachedSessionId === sessionId) {
      return
    }
    const info = await client.attachSession(sessionId)
    this.attachedSessionId = info.session_id
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
      if (normalizedTitle) {
        try {
          await client.renameSession(info.session_id, normalizedTitle)
          return {
            ...info,
            title: normalizedTitle,
          }
        } catch {
          // Non-fatal if rename fails; session is still attached
        }
      }
      return info
    })
  }

  async attachSession(sessionId: string): Promise<SessionInfo> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      if (this.attachedSessionId === sessionId) {
        const list = await client
          .listSessions({ includeArchived: true, limit: 100 })
          .catch(() => [])
        const matched = list.find((s) => s.session_id === sessionId)
        if (matched) return matched
      }
      const info = await client.attachSession(sessionId)
      this.attachedSessionId = info.session_id
      return info
    })
  }

  async forkSession(sessionId: string): Promise<SessionInfo> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      return client.forkSession(sessionId)
    })
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      await client.renameSession(sessionId, title)
    })
  }

  async getHistory(
    sessionId: string
  ): Promise<{ messages: HistoryMessage[]; images: RenderedImage[] }> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      return client.getHistoryWithImages(sessionId)
    })
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      await client.sendMessage(sessionId, content, { waitForAccept: true })
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

  async getRuntimeInfo(sessionId: string): Promise<RuntimeInfo> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      return client.getRuntimeInfo(sessionId)
    })
  }

  async listModels(
    sessionId: string
  ): Promise<{ models: string[]; current?: string }> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      return client.listModels(sessionId)
    })
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      await client.setModel(sessionId, model)
    })
  }

  async setReasoningEffort(sessionId: string, effort: string): Promise<void> {
    return this.runSerialized(async () => {
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      await client.setReasoningEffort(sessionId, effort)
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
      const client = await this.connect()
      await this.ensureAttached(client, sessionId)
      return client.runtimeCommand(sessionId, command, args)
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
      default:
        throw new Error(`Unsupported daemon invoke method: ${method}`)
    }
  }

  dispose(): void {
    if (this.client) {
      this.client.close()
      this.client = null
    }
  }
}
