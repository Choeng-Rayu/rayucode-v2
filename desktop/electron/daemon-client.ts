import { EventEmitter } from "node:events"
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

export interface DaemonConnectionStatus {
  connected: boolean
  reconnecting: boolean
  socketPath: string
  version: string
  latencyMs: number
  mode?: "live" | "demo"
}

export class RayuDaemonClient extends EventEmitter {
  private socketPath: string
  private client: RayucodeClient | null = null
  private connecting: Promise<RayucodeClient> | null = null
  private status: DaemonConnectionStatus

  constructor(customSocketPath?: string) {
    super()
    this.socketPath = customSocketPath ?? apiSocketPath()
    this.status = {
      connected: false,
      reconnecting: false,
      socketPath: this.socketPath,
      version: "offline (demo fallback)",
      latencyMs: 0,
      mode: "demo",
    }
  }

  getStatus(): DaemonConnectionStatus {
    return { ...this.status }
  }

  private updateStatus(next: DaemonConnectionStatus): DaemonConnectionStatus {
    this.status = next
    this.emit("status", this.getStatus())
    return this.getStatus()
  }

  private attachClient(client: RayucodeClient, latencyMs: number): void {
    if (this.client && this.client !== client) {
      this.client.close()
    }
    this.client = client

    client.on("event", (frame: ServerFrame) => {
      this.emit("harness-event", frame)
    })

    const onDisconnect = () => {
      if (this.client !== client) return
      this.client = null
      this.updateStatus({
        connected: false,
        reconnecting: false,
        socketPath: this.socketPath,
        version: "offline (demo fallback)",
        latencyMs: 0,
        mode: "demo",
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
    })
  }

  async connect(): Promise<RayucodeClient> {
    if (this.client) return this.client
    if (this.connecting) return this.connecting

    const startedAt = Date.now()
    this.updateStatus({
      ...this.status,
      reconnecting: true,
    })

    this.connecting = RayucodeClient.connect({
      socketPath: this.socketPath,
      clientName: "rayucode-desktop/0.1.0",
      supportsUserResponse: true,
      requestTimeoutMs: 15_000,
    })
      .then((client) => {
        const latencyMs = Math.max(1, Date.now() - startedAt)
        this.attachClient(client, latencyMs)
        return client
      })
      .catch((error: unknown) => {
        this.updateStatus({
          connected: false,
          reconnecting: false,
          socketPath: this.socketPath,
          version: "offline (demo fallback)",
          latencyMs: 0,
          mode: "demo",
        })
        throw error
      })
      .finally(() => {
        this.connecting = null
      })

    return this.connecting
  }

  async launchAndConnect(): Promise<DaemonConnectionStatus> {
    const startedAt = Date.now()
    this.updateStatus({
      ...this.status,
      reconnecting: true,
    })
    try {
      const client = await RayucodeClient.launch({
        clientName: "rayucode-desktop/0.1.0",
        supportsUserResponse: true,
        requestTimeoutMs: 20_000,
      })
      const latencyMs = Math.max(1, Date.now() - startedAt)
      this.attachClient(client, latencyMs)
      return this.getStatus()
    } catch {
      return this.updateStatus({
        connected: false,
        reconnecting: false,
        socketPath: this.socketPath,
        version: "offline (start `rayu api-bridge`)",
        latencyMs: 0,
        mode: "demo",
      })
    }
  }

  async checkConnection(): Promise<DaemonConnectionStatus> {
    const startedAt = Date.now()
    try {
      const client = await this.connect()
      await client.ping()
      return this.updateStatus({
        connected: true,
        reconnecting: false,
        socketPath: this.socketPath,
        version: client.server || "rayu-harness-v1",
        latencyMs: Math.max(1, Date.now() - startedAt),
        mode: "live",
      })
    } catch {
      return this.updateStatus({
        connected: false,
        reconnecting: false,
        socketPath: this.socketPath,
        version: "offline (demo fallback)",
        latencyMs: 0,
        mode: "demo",
      })
    }
  }

  async listSessions(includeArchived = false): Promise<SessionInfo[]> {
    const client = await this.connect()
    return client.listSessions({ includeArchived, limit: 100 })
  }

  async createSession(workingDir: string): Promise<SessionInfo> {
    const client = await this.connect()
    return client.createSession({ workingDir })
  }

  async attachSession(sessionId: string): Promise<SessionInfo> {
    const client = await this.connect()
    return client.attachSession(sessionId)
  }

  async forkSession(sessionId: string): Promise<SessionInfo> {
    const client = await this.connect()
    return client.forkSession(sessionId)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const client = await this.connect()
    await client.renameSession(sessionId, title)
  }

  async getHistory(
    sessionId: string
  ): Promise<{ messages: HistoryMessage[]; images: RenderedImage[] }> {
    const client = await this.connect()
    return client.getHistoryWithImages(sessionId)
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const client = await this.connect()
    await client.sendMessage(sessionId, content, { waitForAccept: true })
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
    const client = await this.connect()
    return client.getRuntimeInfo(sessionId)
  }

  async listModels(
    sessionId: string
  ): Promise<{ models: string[]; current?: string }> {
    const client = await this.connect()
    return client.listModels(sessionId)
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    const client = await this.connect()
    await client.setModel(sessionId, model)
  }

  async setReasoningEffort(sessionId: string, effort: string): Promise<void> {
    const client = await this.connect()
    await client.setReasoningEffort(sessionId, effort)
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
    const client = await this.connect()
    return client.runtimeCommand(sessionId, command, args)
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
