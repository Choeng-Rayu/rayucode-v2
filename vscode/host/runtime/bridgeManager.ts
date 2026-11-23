import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import {
  API_VERSION_MAJOR,
  API_VERSION_MINOR,
  RayucodeClient,
  apiSocketPath as defaultSdkApiSocketPath,
  bundledRayuBinary,
} from "@rayu-dev/rayucode-sdk";
import type { DaemonStatusView } from "../../shared/vscodeProtocol.js";

export interface ResolveBinaryOptions {
  configuredPath?: string;
  workspacePaths?: string[];
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

function findInSystemPath(binName: string): string | undefined {
  const rawPath = process.env.PATH ?? "";
  for (const dir of rawPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binName);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Auto-discover the `rayu` binary in priority order:
 * 1. `rayucode.binaryPath` (or legacy `rayucode.runtime.binaryPath`) setting
 * 2. `RAYU_BINARY` env var
 * 3. `~/.local/bin/rayu`
 * 4. `~/.rayu/builds/current/rayu`
 * 5. `~/.rayu/builds/stable/rayu`
 * 6. System `PATH`
 * 7. Bundled SDK binary
 * 8. Open workspace `./target/selfdev/rayu` or `./target/release/rayu`
 */
export function resolveRayuBinary(options: ResolveBinaryOptions = {}): string | undefined {
  const binName = process.platform === "win32" ? "rayu.exe" : "rayu";
  const home = os.homedir();
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");

  const workspaceCandidates: string[] = [];
  for (const ws of options.workspacePaths ?? []) {
    workspaceCandidates.push(
      path.join(ws, "target", "selfdev", binName),
      path.join(ws, "target", "release", binName),
      path.join(ws, "target", "debug", binName),
    );
  }

  const directCandidates = [
    options.configuredPath?.trim(),
    process.env.RAYU_BINARY?.trim(),
    path.join(home, ".local", "bin", binName),
    path.join(home, ".rayu", "builds", "current", binName),
    path.join(home, ".rayu", "builds", "stable", binName),
    process.platform === "win32"
      ? path.join(localAppData, "rayu", "bin", binName)
      : undefined,
    process.platform === "win32"
      ? path.join(localAppData, "rayu", "builds", "stable", binName)
      : undefined,
    findInSystemPath(binName),
    bundledRayuBinary(),
    path.join(home, ".cargo", "bin", binName),
    `/opt/homebrew/bin/${binName}`,
    `/usr/local/bin/${binName}`,
    ...workspaceCandidates,
  ].filter((item): item is string => Boolean(item));

  return directCandidates.find(isExecutableFile);
}

/**
 * Resolve the Harness API socket path:
 * 1. `rayucode.apiSocketPath` (or `rayucode.runtime.socketPath`) setting
 * 2. `RAYU_API_SOCKET` env var
 * 3. Default runtime socket from `@rayu-dev/rayucode-sdk`
 */
export function resolveApiSocketPath(configuredSocketPath?: string): string {
  const trimmed = configuredSocketPath?.trim();
  if (trimmed) return trimmed;
  if (process.env.RAYU_API_SOCKET?.trim()) {
    return process.env.RAYU_API_SOCKET.trim();
  }
  return defaultSdkApiSocketPath();
}

export function detectIsRayuRepo(workspacePaths: readonly string[]): boolean {
  for (const ws of workspacePaths) {
    if (
      fs.existsSync(path.join(ws, "crates", "rayucode-harness-api", "Cargo.toml"))
    ) {
      return true;
    }
  }
  return false;
}

export class BridgeManager extends EventEmitter implements vscode.Disposable {
  private client: RayucodeClient | null = null;
  private bridgeProcess: ChildProcess | null = null;
  private connectingPromise: Promise<RayucodeClient> | null = null;
  private spawningPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private disposed = false;
  private readonly outputChannel: vscode.OutputChannel;
  private status: DaemonStatusView;

  constructor() {
    super();
    this.outputChannel = vscode.window.createOutputChannel("RayuCode Runtime");
    const socketPath = this.getConfiguredSocketPath();
    this.status = {
      state: "disconnected",
      protocolVersion: `${API_VERSION_MAJOR}.${API_VERSION_MINOR}`,
      socketPath,
      capabilities: [],
      isRayuRepo: detectIsRayuRepo(this.getWorkspacePaths()),
    };
  }

  getWorkspacePaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  getConfiguredSocketPath(): string {
    const cfg = vscode.workspace.getConfiguration("rayucode");
    const primary = cfg.get<string>("apiSocketPath")?.trim();
    const legacy = cfg.get<string>("runtime.socketPath")?.trim();
    return resolveApiSocketPath(primary || legacy);
  }

  getConfiguredBinaryPath(): string | undefined {
    const cfg = vscode.workspace.getConfiguration("rayucode");
    const primary = cfg.get<string>("binaryPath")?.trim();
    const legacy = cfg.get<string>("runtime.binaryPath")?.trim();
    return primary || legacy || undefined;
  }

  isAutoStartEnabled(): boolean {
    const cfg = vscode.workspace.getConfiguration("rayucode");
    return cfg.get<boolean>("autoStartBridge", true);
  }

  getStatus(): DaemonStatusView {
    return {
      ...this.status,
      capabilities: [...this.status.capabilities],
      isRayuRepo: detectIsRayuRepo(this.getWorkspacePaths()),
    };
  }

  getActiveClient(): RayucodeClient | null {
    return this.client;
  }

  openOutputLog(): void {
    this.outputChannel.show(true);
  }

  log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  private updateStatus(patch: Partial<DaemonStatusView>): DaemonStatusView {
    this.status = {
      ...this.status,
      ...patch,
      isRayuRepo: detectIsRayuRepo(this.getWorkspacePaths()),
    };
    const snapshot = this.getStatus();
    this.emit("statusChanged", snapshot);
    return snapshot;
  }

  /**
   * Open a fresh `RayucodeClient` connection to the active bridge socket with
   * `supportsPermissions: true` and `supportsUserResponse: true`.
   */
  async dialClient(customSocketPath?: string): Promise<RayucodeClient> {
    const socketPath = customSocketPath ?? this.getConfiguredSocketPath();
    return RayucodeClient.connect({
      socketPath,
      clientName: "rayucode-vscode/3.0.0",
      supportsUserResponse: true,
      supportsPermissions: true,
      requestTimeoutMs: 15_000,
    });
  }

  /**
   * Ensure the primary control client is connected, auto-spawning `rayu --no-update api-bridge`
   * when `rayucode.autoStartBridge` is enabled.
   */
  async ensureConnected(): Promise<RayucodeClient> {
    if (this.client) return this.client;
    if (this.connectingPromise) return this.connectingPromise;

    this.clearReconnectTimer();
    const socketPath = this.getConfiguredSocketPath();
    this.updateStatus({
      state: this.reconnectAttempts > 0 ? "reconnecting" : "connecting",
      socketPath,
      error: undefined,
    });

    this.connectingPromise = (async () => {
      try {
        return await this.connectAndAttach(socketPath);
      } catch (initialError) {
        if (this.isAutoStartEnabled()) {
          const binary = resolveRayuBinary({
            configuredPath: this.getConfiguredBinaryPath(),
            workspacePaths: this.getWorkspacePaths(),
          });
          if (binary) {
            this.updateStatus({ state: "starting", socketPath, error: undefined });
            await this.spawnBridgeIdempotent(binary, socketPath);
            return await this.connectAndAttach(socketPath);
          }
        }
        const message =
          initialError instanceof Error ? initialError.message : String(initialError);
        this.updateStatus({
          state: "disconnected",
          socketPath,
          error: message,
        });
        throw initialError;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  private async connectAndAttach(socketPath: string): Promise<RayucodeClient> {
    const startedAt = Date.now();
    const client = await this.dialClient(socketPath);
    const latencyMs = Math.max(1, Date.now() - startedAt);
    this.attachPrimaryClient(client, socketPath, latencyMs);
    return client;
  }

  private attachPrimaryClient(
    client: RayucodeClient,
    socketPath: string,
    latencyMs: number,
  ): void {
    const previous = this.client;
    this.client = client;
    if (previous && previous !== client) {
      void previous.close();
    }
    this.reconnectAttempts = 0;

    client.on("event", (frame) => {
      this.emit("frame", frame);
    });

    const onDisconnect = (err?: Error) => {
      if (this.client !== client || this.disposed) return;
      this.client = null;
      const reason = err?.message ?? "Bridge connection closed";
      this.log(`Disconnected from ${socketPath}: ${reason}`);
      this.updateStatus({
        state: "disconnected",
        error: reason,
      });
      this.emit("disconnected", reason);
      this.scheduleReconnect();
    };

    client.once("close", onDisconnect);
    client.on("error", (err) => {
      this.log(`Client error: ${err instanceof Error ? err.message : String(err)}`);
    });

    this.log(
      `Connected to ${socketPath} (server=${client.server}, capabilities=${client.capabilities.join(",")})`,
    );
    this.updateStatus({
      state: "connected",
      version: client.server || "rayu-harness-v1.14",
      bridgeVersion: client.server || "rayu-harness-v1.14",
      protocolVersion: `${API_VERSION_MAJOR}.${API_VERSION_MINOR}`,
      socketPath,
      latencyMs,
      pid: this.bridgeProcess?.pid,
      capabilities: [...client.capabilities],
      error: undefined,
    });
    this.emit("connected", client);
  }

  private async spawnBridgeIdempotent(binary: string, socketPath: string): Promise<void> {
    if (this.spawningPromise) return this.spawningPromise;

    this.spawningPromise = (async () => {
      const lockPath = `${socketPath}.vscode.lock`;
      let lockFd: number | undefined;
      try {
        fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
        try {
          lockFd = fs.openSync(lockPath, "wx", 0o600);
          fs.writeFileSync(lockFd, String(process.pid));
        } catch {
          // Another VS Code window is already spawning the bridge; wait for socket
          this.log(`Waiting for another process holding ${lockPath} to start api-bridge...`);
          await this.waitForSocketConnectable(socketPath, 12_000);
          return;
        }

        // Clean up stale socket file if nothing is listening
        if (process.platform !== "win32" && fs.existsSync(socketPath)) {
          try {
            const probe = await this.dialClient(socketPath);
            await probe.close();
            return;
          } catch {
            try {
              fs.unlinkSync(socketPath);
            } catch {
              // ignore
            }
          }
        }

        const cwd = this.getWorkspacePaths()[0] ?? os.homedir();
        this.log(`Spawning bridge: ${binary} --no-update api-bridge --api-socket ${socketPath}`);
        const child = spawn(
          binary,
          ["--no-update", "api-bridge", "--api-socket", socketPath],
          {
            cwd,
            env: {
              ...process.env,
              RAYU_API_SOCKET: socketPath,
              RAYU_NO_AUTO_UPDATE: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
          },
        );
        this.bridgeProcess = child;

        child.stdout?.on("data", (chunk: Buffer) => {
          this.log(`[bridge:stdout] ${chunk.toString().trimEnd()}`);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          this.log(`[bridge:stderr] ${chunk.toString().trimEnd()}`);
        });
        child.once("exit", (code, signal) => {
          this.log(`Bridge process exited (code=${code}, signal=${signal})`);
          if (this.bridgeProcess === child) {
            this.bridgeProcess = null;
          }
        });
        child.once("error", (err) => {
          this.log(`Bridge spawn error: ${err.message}`);
        });

        await this.waitForSocketConnectable(socketPath, 15_000);
      } finally {
        if (lockFd !== undefined) {
          try {
            fs.closeSync(lockFd);
          } catch {
            // ignore
          }
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // ignore
          }
        }
        this.spawningPromise = null;
      }
    })();

    return this.spawningPromise;
  }

  private async waitForSocketConnectable(socketPath: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (process.platform === "win32" || fs.existsSync(socketPath)) {
        try {
          const probe = await this.dialClient(socketPath);
          await probe.close();
          return;
        } catch (err) {
          lastError = err;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Timed out waiting for Rayu api-bridge at ${socketPath}`);
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || !this.isAutoStartEnabled()) return;
    this.reconnectAttempts += 1;
    const delayMs = Math.min(15_000, 1_000 * Math.pow(2, Math.min(4, this.reconnectAttempts - 1)));
    this.updateStatus({ state: "reconnecting" });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      void this.ensureConnected().catch(() => {
        this.scheduleReconnect();
      });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; version?: string }> {
    const startedAt = Date.now();
    try {
      const client = await this.ensureConnected();
      await client.ping();
      const latencyMs = Math.max(1, Date.now() - startedAt);
      this.updateStatus({ state: "connected", latencyMs, error: undefined });
      return { ok: true, latencyMs, version: client.server || this.status.version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus({ state: "disconnected", error: message });
      return { ok: false, latencyMs: 0 };
    }
  }

  async reconnect(): Promise<DaemonStatusView> {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    const current = this.client;
    this.client = null;
    if (current) {
      await current.close().catch(() => {});
    }
    try {
      await this.ensureConnected();
    } catch {
      // status is updated inside ensureConnected
    }
    return this.getStatus();
  }

  private async terminateProcess(child: ChildProcess, timeoutMs = 3_000): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("exit", done);
        child.removeListener("close", done);
        resolve();
      };

      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        done();
      }, timeoutMs);
      timer.unref?.();

      child.once("exit", done);
      child.once("close", done);
      try {
        child.kill("SIGTERM");
      } catch {
        done();
      }
    });
  }

  async restart(): Promise<DaemonStatusView> {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    const current = this.client;
    this.client = null;
    if (current) {
      await current.close().catch(() => {});
    }
    if (this.bridgeProcess) {
      const child = this.bridgeProcess;
      this.bridgeProcess = null;
      await this.terminateProcess(child, 3_000);
    }
    try {
      await this.ensureConnected();
    } catch {
      // status updated in ensureConnected
    }
    return this.getStatus();
  }

  async reloadDaemon(activeSessionId?: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const client = await this.ensureConnected();
      if (activeSessionId) {
        const res = await client.runtimeCommand(activeSessionId, "server_reload", []);
        return { ok: true, message: res.message || "Daemon reloaded." };
      }
      await this.restart();
      return { ok: true, message: "Bridge restarted." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    const current = this.client;
    this.client = null;
    void current?.close();
    if (this.bridgeProcess) {
      try {
        this.bridgeProcess.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.bridgeProcess = null;
    }
    this.outputChannel.dispose();
  }
}
