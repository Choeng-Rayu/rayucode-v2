import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import {
  RayucodeClient,
  apiSocketPath as defaultSdkApiSocketPath,
  bundledRayuBinary,
} from "@rayu-dev/rayucode-sdk";
import type { DaemonStatusView } from "../../shared/vscodeProtocol.js";
import {
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  checkAndUpdateManagedBinary,
  ensureManagedBinary,
  readManagedBinaryInfo,
  type InstallProgressEvent,
} from "./binaryInstaller.js";

const FATAL_COOLDOWN_MS = 15_000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 800;
const MAX_BRIDGE_LOG_BYTES = 512 * 1024;
const STDERR_TAIL_BYTES = 4096;

export type BinarySource =
  | "configured"
  | "env"
  | "workspace"
  | "managed"
  | "local"
  | "path"
  | "bundled"
  | "system";

export interface ResolveBinaryOptions {
  configuredPath?: string;
  workspacePaths?: string[];
  storageDir?: string;
  preferManaged?: boolean;
}

export interface ResolvedBinary {
  path: string;
  source: BinarySource;
  managedVersion?: string;
}

export interface BridgeManagerOptions {
  storageDir?: string;
  extensionVersion?: string;
  isTurnActive?: () => boolean;
}

class LegacyBridgeCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyBridgeCliError";
  }
}

class FatalBridgeSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalBridgeSpawnError";
  }
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    if (process.platform !== "win32") {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
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

function isLegacyCliStderr(stderrText: string): boolean {
  return /unrecognized subcommand.*api-bridge|unknown (?:command|subcommand).*api-bridge|unexpected argument.*api-bridge/i.test(
    stderrText,
  );
}

/**
 * Resolve the `rayu` binary alongside its provenance source.
 * Priority:
 * 1. Explicit `rayucode.binaryPath` (`configured`)
 * 2. `RAYU_BINARY` env var (`env`)
 * 3. Open workspace `./target/{selfdev,release,debug}/rayu` (`workspace`)
 * 4. Managed auto-downloaded binary in extension storage (`managed`)
 * 5. `~/.local/bin/rayu`, `~/.rayu/builds/*`, Windows `%LOCALAPPDATA%\rayu\...` (`local`)
 * 6. System `PATH` (`path`)
 * 7. Bundled SDK binary (`bundled`)
 * 8. `~/.cargo/bin`, `/opt/homebrew/bin`, `/usr/local/bin` (`system`)
 */
export function resolveRayuBinaryWithSource(
  options: ResolveBinaryOptions = {},
): ResolvedBinary | undefined {
  const binName = process.platform === "win32" ? "rayu.exe" : "rayu";
  const home = os.homedir();
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");

  const workspaceCandidates: Array<{ path: string; source: BinarySource }> = [];
  for (const ws of options.workspacePaths ?? []) {
    workspaceCandidates.push(
      { path: path.join(ws, "target", "selfdev", binName), source: "workspace" },
      { path: path.join(ws, "target", "release", binName), source: "workspace" },
      { path: path.join(ws, "target", "debug", binName), source: "workspace" },
    );
  }

  const managedInfo = options.storageDir
    ? readManagedBinaryInfo(options.storageDir)
    : null;

  const candidates: Array<{
    path?: string;
    source: BinarySource;
    managedVersion?: string;
  }> = [
    { path: options.configuredPath?.trim(), source: "configured" },
    { path: process.env.RAYU_BINARY?.trim(), source: "env" },
  ];

  if (options.preferManaged && managedInfo) {
    candidates.push({
      path: managedInfo.binaryPath,
      source: "managed",
      managedVersion: managedInfo.version,
    });
  }

  candidates.push(...workspaceCandidates);

  if (!options.preferManaged && managedInfo) {
    candidates.push({
      path: managedInfo.binaryPath,
      source: "managed",
      managedVersion: managedInfo.version,
    });
  }

  candidates.push(
    { path: path.join(home, ".local", "bin", binName), source: "local" },
    { path: path.join(home, ".rayu", "builds", "current", binName), source: "local" },
    { path: path.join(home, ".rayu", "builds", "stable", binName), source: "local" },
    ...(process.platform === "win32"
      ? [
          {
            path: path.join(localAppData, "rayu", "bin", binName),
            source: "local" as const,
          },
          {
            path: path.join(localAppData, "rayu", "builds", "current", binName),
            source: "local" as const,
          },
          {
            path: path.join(localAppData, "rayu", "builds", "stable", binName),
            source: "local" as const,
          },
        ]
      : []),
    { path: findInSystemPath(binName), source: "path" },
    { path: bundledRayuBinary(), source: "bundled" },
    { path: path.join(home, ".cargo", "bin", binName), source: "system" },
    { path: `/opt/homebrew/bin/${binName}`, source: "system" },
    { path: `/usr/local/bin/${binName}`, source: "system" },
  );

  for (const item of candidates) {
    if (item.path && isExecutableFile(item.path)) {
      return {
        path: item.path,
        source: item.source,
        managedVersion: item.managedVersion,
      };
    }
  }
  return undefined;
}

/**
 * Auto-discover the `rayu` binary path.
 */
export function resolveRayuBinary(options: ResolveBinaryOptions = {}): string | undefined {
  return resolveRayuBinaryWithSource(options)?.path;
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

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === "EPERM";
  }
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

function readLogTailSince(logPath: string, offsetBefore: number): string {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size <= offsetBefore) return "";
    const bytesToRead = Math.min(STDERR_TAIL_BYTES, stat.size - offsetBefore);
    const startPos = stat.size - bytesToRead;
    const fd = fs.openSync(logPath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const read = fs.readSync(fd, buffer, 0, bytesToRead, startPos);
      return buffer.subarray(0, read).toString("utf8").trim();
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

export class BridgeManager extends EventEmitter implements vscode.Disposable {
  private client: RayucodeClient | null = null;
  private bridgeProcess: ChildProcess | null = null;
  private connectingPromise: Promise<RayucodeClient> | null = null;
  private spawningPromise: Promise<void> | null = null;
  private installingPromise: Promise<{ binaryPath: string; version: string }> | null = null;
  private activeUpdatePromise: Promise<DaemonStatusView> | null = null;
  private backgroundUpdatePromise: Promise<void> | null = null;
  private isUpdatingBinary = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private initialUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicUpdateTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private fatalCooldownUntil = 0;
  private lastFatalError: Error | null = null;
  private preferManagedBinary = false;
  private binarySource?: BinarySource;
  private managedVersion?: string;
  private pendingRestartVersion?: string;
  private disposed = false;
  private readonly storageDir?: string;
  private readonly extensionVersion?: string;
  private readonly isTurnActive?: () => boolean;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly configDisposable?: vscode.Disposable;
  private status: DaemonStatusView;

  constructor(options: BridgeManagerOptions = {}) {
    super();
    this.storageDir = options.storageDir;
    this.extensionVersion = options.extensionVersion;
    this.isTurnActive = options.isTurnActive;
    this.outputChannel = vscode.window.createOutputChannel("RayuCode Runtime");
    const socketPath = this.getConfiguredSocketPath();
    const managed = this.storageDir ? readManagedBinaryInfo(this.storageDir) : null;
    this.managedVersion = managed?.version;
    this.status = {
      state: "disconnected",
      socketPath,
      capabilities: [],
      isRayuRepo: detectIsRayuRepo(this.getWorkspacePaths()),
      managedVersion: managed?.version,
    };

    this.configDisposable = vscode.workspace.onDidChangeConfiguration?.((e) => {
      if (
        e.affectsConfiguration("rayucode.binaryPath") ||
        e.affectsConfiguration("rayucode.autoStartBridge") ||
        e.affectsConfiguration("rayucode.apiSocketPath") ||
        e.affectsConfiguration("rayucode.runtime.binaryPath") ||
        e.affectsConfiguration("rayucode.runtime.socketPath")
      ) {
        this.clearFatalCooldown();
      }
    });
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

  isAutoUpdateEnabled(): boolean {
    const cfg = vscode.workspace.getConfiguration("rayucode");
    return cfg.get<boolean>("autoUpdateEngine", true);
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

  private clearFatalCooldown(): void {
    this.fatalCooldownUntil = 0;
    this.lastFatalError = null;
  }

  private updateStatus(patch: Partial<DaemonStatusView>): DaemonStatusView {
    this.status = {
      ...this.status,
      ...patch,
      isRayuRepo: detectIsRayuRepo(this.getWorkspacePaths()),
      binarySource: patch.binarySource ?? this.binarySource,
      managedVersion: patch.managedVersion ?? this.managedVersion,
    };
    const snapshot = this.getStatus();
    this.emit("statusChanged", snapshot);
    return snapshot;
  }

  private emitInstallProgress(socketPath: string, event: InstallProgressEvent): void {
    this.log(`[engine-installer] ${event.message}`);
    const isActiveTransfer =
      event.phase === "downloading" ||
      event.phase === "verifying" ||
      event.phase === "extracting" ||
      event.phase === "installing";
    if (isActiveTransfer) {
      this.ensureNotificationProgress()?.report(event);
    } else if (event.phase === "ready") {
      this.notificationProgress?.report(event);
    }
    this.updateStatus({
      state: this.client ? "connected" : "downloading",
      socketPath,
      error: undefined,
      downloadProgress: event.percent,
      downloadPhase: event.phase === "up_to_date" || event.phase === "ready" ? "starting" : event.phase,
      downloadVersion: event.version,
      downloadedBytes: event.downloadedBytes,
      totalBytes: event.totalBytes,
      statusMessage: event.message,
    });
  }

  private notificationProgress: {
    report: (ev: InstallProgressEvent) => void;
    finish: () => void;
  } | null = null;

  private ensureNotificationProgress() {
    if (this.notificationProgress) return this.notificationProgress;
    if (typeof vscode.window?.withProgress !== "function") return null;

    let progressSink:
      | vscode.Progress<{ message?: string; increment?: number }>
      | undefined;
    let lastPct = 0;
    let resolveTask: (() => void) | undefined;
    let latestEvent: InstallProgressEvent | null = null;
    let closed = false;

    const controller = {
      report: (ev: InstallProgressEvent) => {
        if (closed) return;
        latestEvent = ev;
        if (!progressSink) return;
        const targetPct = ev.percent ?? lastPct;
        const increment = Math.max(0, targetPct - lastPct);
        lastPct = Math.max(lastPct, targetPct);
        progressSink.report({
          message: ev.message,
          ...(increment > 0 ? { increment } : {}),
        });
      },
      finish: () => {
        if (closed) return;
        closed = true;
        resolveTask?.();
        resolveTask = undefined;
        progressSink = undefined;
        latestEvent = null;
        if (this.notificationProgress === controller) {
          this.notificationProgress = null;
        }
      },
    };

    this.notificationProgress = controller;
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "RayuCode Engine",
        cancellable: false,
      },
      (progress) => {
        if (closed) return Promise.resolve();
        progressSink = progress;
        if (latestEvent) {
          controller.report(latestEvent);
        }
        return new Promise<void>((resolve) => {
          resolveTask = resolve;
        });
      },
    );

    return controller;
  }

  private finishNotificationProgress(): void {
    this.notificationProgress?.finish();
    this.notificationProgress = null;
  }

  private async ensureManagedBinaryLocked(
    socketPath: string,
    force = false,
  ): Promise<{ binaryPath: string; version: string }> {
    if (!this.storageDir) {
      throw new FatalBridgeSpawnError(
        "RayuCode CLI (`rayu`) was not found on this machine and managed download storage is unavailable. Install RayuCode CLI or set `rayucode.binaryPath` in Settings.",
      );
    }
    if (this.installingPromise) {
      return this.installingPromise;
    }

    this.installingPromise = (async () => {
      try {
        const result = await ensureManagedBinary({
          storageDir: this.storageDir!,
          extensionVersion: this.extensionVersion,
          force,
          onProgress: (event) => this.emitInstallProgress(socketPath, event),
        });
        this.preferManagedBinary = true;
        this.binarySource = "managed";
        this.managedVersion = result.version;
        return { binaryPath: result.binaryPath, version: result.version };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new FatalBridgeSpawnError(
          `Failed to auto-download Rayu engine: ${msg}. Check your internet connection or set \`rayucode.binaryPath\` in Settings.`,
        );
      } finally {
        this.finishNotificationProgress();
        this.installingPromise = null;
      }
    })();

    return this.installingPromise;
  }

  /**
   * Open a fresh `RayucodeClient` connection to the active bridge socket with
   * `supportsPermissions: true`, `supportsUserResponse: true`, and `supportsUserQuestions: true`.
   */
  async dialClient(customSocketPath?: string): Promise<RayucodeClient> {
    const socketPath = customSocketPath ?? this.getConfiguredSocketPath();
    return RayucodeClient.connect({
      socketPath,
      clientName: "rayucode-vscode/3.0.0",
      supportsUserResponse: true,
      supportsPermissions: true,
      supportsUserQuestions: true,
      requestTimeoutMs: 15_000,
    });
  }

  /**
   * Ensure the primary control client is connected, auto-downloading and auto-spawning
   * `rayu --no-update api-bridge` when needed.
   */
  async ensureConnected(options?: { manual?: boolean }): Promise<RayucodeClient> {
    if (this.client) return this.client;
    if (this.connectingPromise) return this.connectingPromise;

    if (this.isUpdatingBinary && (this.activeUpdatePromise || this.backgroundUpdatePromise)) {
      await Promise.resolve(
        this.activeUpdatePromise ?? this.backgroundUpdatePromise,
      ).catch(() => {});
      if (this.client) return this.client;
      if (this.connectingPromise) return this.connectingPromise;
    }

    if (
      !options?.manual &&
      Date.now() < this.fatalCooldownUntil &&
      this.lastFatalError
    ) {
      throw this.lastFatalError;
    }

    this.clearReconnectTimer();
    const socketPath = this.getConfiguredSocketPath();
    this.updateStatus({
      state: this.reconnectAttempts > 0 ? "reconnecting" : "connecting",
      socketPath,
      error: undefined,
      downloadProgress: undefined,
      downloadPhase: undefined,
      downloadVersion: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      statusMessage: undefined,
    });

    this.connectingPromise = (async () => {
      try {
        return await this.connectAndAttach(socketPath);
      } catch (initialError) {
        let spawnOrInstallError: Error | null = null;
        let isFatal = false;

        if (this.isAutoStartEnabled()) {
          try {
            let resolved = resolveRayuBinaryWithSource({
              configuredPath: this.getConfiguredBinaryPath(),
              workspacePaths: this.getWorkspacePaths(),
              storageDir: this.storageDir,
              preferManaged: this.preferManagedBinary,
            });

            if (!resolved) {
              const installed = await this.ensureManagedBinaryLocked(socketPath, false);
              resolved = {
                path: installed.binaryPath,
                source: "managed",
                managedVersion: installed.version,
              };
            }

            this.binarySource = resolved.source;
            if (resolved.managedVersion) {
              this.managedVersion = resolved.managedVersion;
            }

            this.updateStatus({
              state: "starting",
              socketPath,
              error: undefined,
              downloadProgress: undefined,
              downloadPhase: "starting",
              downloadVersion: undefined,
              downloadedBytes: undefined,
              totalBytes: undefined,
              statusMessage: undefined,
            });

            try {
              await this.spawnBridgeIdempotent(resolved.path, socketPath);
            } catch (err) {
              if (
                err instanceof LegacyBridgeCliError &&
                resolved.source !== "configured" &&
                resolved.source !== "env" &&
                this.storageDir
              ) {
                this.log(
                  `Detected legacy CLI at ${resolved.path}; installing latest managed Rayu engine...`,
                );
                const installed = await this.ensureManagedBinaryLocked(
                  socketPath,
                  true,
                );
                this.updateStatus({
                  state: "starting",
                  socketPath,
                  error: undefined,
                  downloadProgress: undefined,
                  downloadPhase: "starting",
                  downloadVersion: undefined,
                  downloadedBytes: undefined,
                  totalBytes: undefined,
                  statusMessage: undefined,
                });
                await this.spawnBridgeIdempotent(installed.binaryPath, socketPath);
              } else {
                throw err;
              }
            }

            return await this.connectAndAttach(socketPath);
          } catch (err) {
            spawnOrInstallError =
              err instanceof Error ? err : new Error(String(err));
            isFatal =
              err instanceof FatalBridgeSpawnError ||
              err instanceof LegacyBridgeCliError;
          }
        }

        const effectiveError = spawnOrInstallError ?? initialError;
        const message =
          effectiveError instanceof Error
            ? effectiveError.message
            : String(effectiveError);

        if (isFatal) {
          const fatalErr =
            effectiveError instanceof Error
              ? effectiveError
              : new Error(message);
          this.lastFatalError = fatalErr;
          this.fatalCooldownUntil = Date.now() + FATAL_COOLDOWN_MS;
          this.updateStatus({
            state: "error",
            socketPath,
            error: message,
            downloadProgress: undefined,
            downloadPhase: undefined,
            downloadVersion: undefined,
            downloadedBytes: undefined,
            totalBytes: undefined,
            statusMessage: undefined,
          });
        } else {
          this.updateStatus({
            state: "disconnected",
            socketPath,
            error: message,
            downloadProgress: undefined,
            downloadPhase: undefined,
            downloadVersion: undefined,
            downloadedBytes: undefined,
            totalBytes: undefined,
            statusMessage: undefined,
          });
        }
        throw effectiveError;
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
    this.clearFatalCooldown();

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
        downloadProgress: undefined,
        downloadPhase: undefined,
        downloadVersion: undefined,
        downloadedBytes: undefined,
        totalBytes: undefined,
        statusMessage: undefined,
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
      version: client.server || undefined,
      bridgeVersion: client.server || undefined,
      protocolVersion: client.protocolMajor === undefined
        ? undefined
        : [client.protocolMajor, client.protocolMinor].filter((value) => value !== undefined).join("."),
      socketPath,
      latencyMs,
      pid: this.bridgeProcess?.pid,
      capabilities: [...client.capabilities],
      error: undefined,
      downloadProgress: undefined,
      downloadPhase: undefined,
      downloadVersion: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      statusMessage: this.pendingRestartVersion
        ? `Rayu engine ${this.pendingRestartVersion} downloaded; restart bridge when ready`
        : undefined,
    });
    this.emit("connected", client);
  }

  private async spawnBridgeIdempotent(binary: string, socketPath: string): Promise<void> {
    if (this.spawningPromise) return this.spawningPromise;

    this.spawningPromise = (async () => {
      const isWindowsPipe = socketPath.startsWith("\\\\.\\pipe\\");
      const lockPath = isWindowsPipe
        ? path.join(
            this.storageDir ?? os.tmpdir(),
            `rayu-api-bridge-${crypto.createHash("sha256").update(socketPath).digest("hex").slice(0, 12)}.vscode.lock`,
          )
        : `${socketPath}.vscode.lock`;
      let lockFd: number | undefined;
      let logFd: number | undefined;
      try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
        const acquireLock = (): number | undefined => {
          try {
            const fd = fs.openSync(lockPath, "wx", 0o600);
            fs.writeFileSync(fd, String(process.pid));
            return fd;
          } catch (err) {
            const code = (err as NodeJS.ErrnoException | undefined)?.code;
            if (code !== "EEXIST") throw err;
            // Reclaim stale lock if the owning PID is no longer alive (or lock is ancient)
            try {
              const rawPid = fs.readFileSync(lockPath, "utf8").trim();
              const holderPid = Number.parseInt(rawPid, 10);
              const stat = fs.statSync(lockPath);
              const ageMs = Date.now() - stat.mtimeMs;
              const stale =
                (Number.isInteger(holderPid) && holderPid > 0 && !isProcessAlive(holderPid)) ||
                (!Number.isInteger(holderPid) && ageMs > 20_000) ||
                ageMs > 60_000;
              if (stale) {
                fs.unlinkSync(lockPath);
                const fd = fs.openSync(lockPath, "wx", 0o600);
                fs.writeFileSync(fd, String(process.pid));
                return fd;
              }
            } catch {
              // Lock disappeared or raced with another window; fall through to waiting
            }
            return undefined;
          }
        };

        lockFd = acquireLock();
        if (lockFd === undefined) {
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

        const logDir = this.storageDir ?? os.tmpdir();
        fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
        const bridgeLogPath = path.join(logDir, "rayu-api-bridge-startup.log");
        try {
          if (
            fs.existsSync(bridgeLogPath) &&
            fs.statSync(bridgeLogPath).size > MAX_BRIDGE_LOG_BYTES
          ) {
            fs.truncateSync(bridgeLogPath, 0);
          }
        } catch {
          // ignore rotation failure
        }
        const offsetBefore = fs.existsSync(bridgeLogPath)
          ? fs.statSync(bridgeLogPath).size
          : 0;
        logFd = fs.openSync(bridgeLogPath, "a", 0o600);

        const cwd = this.getWorkspacePaths()[0] ?? os.homedir();
        this.log(
          `Spawning bridge (${this.binarySource ?? "system"}): ${binary} --no-update api-bridge --api-socket ${socketPath}`,
        );
        let childExitedError: Error | null = null;
        const child = spawn(
          binary,
          ["--no-update", "api-bridge", "--api-socket", socketPath],
          {
            cwd,
            env: {
              ...process.env,
              RAYU_API_SOCKET: socketPath,
              RAYU_NO_AUTO_UPDATE: "1",
              RAYU_DEFERRED_AUTH_BOOTSTRAP: "1",
            },
            stdio: ["ignore", logFd, logFd],
            detached: true,
            windowsHide: true,
          },
        );
        child.unref();
        this.bridgeProcess = child;
        if (this.storageDir && child.pid) {
          try {
            fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
            fs.writeFileSync(
              path.join(this.storageDir, "api-bridge.pid"),
              JSON.stringify({
                pid: child.pid,
                socketPath,
                binaryPath: binary,
                version: this.managedVersion,
              }),
              "utf8",
            );
          } catch {
            // best-effort PID metadata for cross-window upgrade cleanup
          }
        }

        child.once("exit", (code, signal) => {
          const tail = readLogTailSince(bridgeLogPath, offsetBefore);
          if (tail) {
            this.log(`Bridge startup stderr/stdout:\n${tail}`);
          }
          this.log(`Bridge process exited (code=${code}, signal=${signal})`);
          const suffix = tail ? `: ${tail.split(/\r?\n/).slice(-3).join(" | ")}` : "";
          const baseMessage = `Rayu api-bridge exited before socket became ready (code=${code}, signal=${signal})${suffix}`;
          childExitedError = isLegacyCliStderr(tail)
            ? new LegacyBridgeCliError(baseMessage)
            : new FatalBridgeSpawnError(baseMessage);
          if (this.bridgeProcess === child) {
            this.bridgeProcess = null;
          }
        });
        child.once("error", (err) => {
          this.log(`Bridge spawn error: ${err.message}`);
          childExitedError = new FatalBridgeSpawnError(
            `Failed to start Rayu api-bridge (${binary}): ${err.message}`,
          );
        });

        await this.waitForSocketConnectable(socketPath, 15_000, () => childExitedError);
      } finally {
        if (logFd !== undefined) {
          try {
            fs.closeSync(logFd);
          } catch {
            // ignore
          }
        }
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

  private async waitForSocketConnectable(
    socketPath: string,
    timeoutMs: number,
    getEarlyError?: () => Error | null,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      const earlyErr = getEarlyError?.();
      if (earlyErr) {
        if (process.platform === "win32" || fs.existsSync(socketPath)) {
          try {
            const probe = await this.dialClient(socketPath);
            await probe.close();
            return;
          } catch {
            // No live listener; surface the actual startup error below
          }
        }
        throw earlyErr;
      }
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
    if (
      this.disposed ||
      this.reconnectTimer ||
      !this.isAutoStartEnabled() ||
      Date.now() < this.fatalCooldownUntil
    ) {
      return;
    }
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
      this.updateStatus({
        state: "connected",
        latencyMs,
        capabilities: [...client.capabilities],
        error: undefined,
      });
      return {
        ok: true,
        latencyMs,
        version: client.server || this.status.version,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus({
        state: Date.now() < this.fatalCooldownUntil ? "error" : "disconnected",
        error: message,
      });
      return { ok: false, latencyMs: 0 };
    }
  }

  async reconnect(): Promise<DaemonStatusView> {
    this.clearReconnectTimer();
    this.clearFatalCooldown();
    this.reconnectAttempts = 0;
    const current = this.client;
    this.client = null;
    this.emit("disconnected", "Reconnecting to Rayu bridge");
    if (current) {
      await current.close().catch(() => {});
    }
    try {
      await this.ensureConnected({ manual: true });
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
    this.clearFatalCooldown();
    this.reconnectAttempts = 0;
    this.pendingRestartVersion = undefined;
    const current = this.client;
    this.client = null;
    this.emit("disconnected", "Restarting Rayu bridge");
    if (current) {
      await current.close().catch(() => {});
    }
    if (this.bridgeProcess) {
      const child = this.bridgeProcess;
      this.bridgeProcess = null;
      await this.terminateProcess(child, 3_000);
    }
    try {
      await this.ensureConnected({ manual: true });
    } catch {
      // status updated in ensureConnected
    }
    return this.getStatus();
  }

  private async stopDetachedManagedBridge(socketPath: string): Promise<void> {
    if (!this.storageDir) return;
    const pidFile = path.join(this.storageDir, "api-bridge.pid");
    try {
      if (!fs.existsSync(pidFile)) return;
      const raw = JSON.parse(fs.readFileSync(pidFile, "utf8")) as {
        pid?: number;
        socketPath?: string;
      };
      const pid = raw?.pid;
      if (
        typeof pid === "number" &&
        Number.isInteger(pid) &&
        pid > 0 &&
        pid !== process.pid &&
        raw.socketPath === socketPath &&
        isProcessAlive(pid)
      ) {
        this.log(`Stopping previous managed api-bridge PID ${pid} before upgrade`);
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // ignore
        }
        const deadline = Date.now() + 2_000;
        while (Date.now() < deadline && isProcessAlive(pid)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      fs.rmSync(pidFile, { force: true });
    } catch {
      // best-effort cleanup
    }
  }

  private async triggerDaemonReloadBestEffort(binaryPath: string): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      let child: ChildProcess;
      try {
        child = spawn(binaryPath, ["--no-update", "server", "reload"], {
          env: {
            ...process.env,
            RAYU_NO_AUTO_UPDATE: "1",
            RAYU_DEFERRED_AUTH_BOOTSTRAP: "1",
          },
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        done();
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        done();
      }, 5_000);
      timer.unref?.();
      child.once("exit", done);
      child.once("error", done);
    });
  }

  private async restartForEngineUpgrade(
    newBinaryPath?: string,
  ): Promise<DaemonStatusView> {
    if (newBinaryPath) {
      await this.triggerDaemonReloadBestEffort(newBinaryPath);
    }
    const current = this.client;
    this.client = null;
    this.emit("disconnected", "Upgrading Rayu engine");
    if (current) {
      await current.close().catch(() => {});
    }
    if (this.bridgeProcess) {
      const child = this.bridgeProcess;
      this.bridgeProcess = null;
      await this.terminateProcess(child, 3_000);
    } else {
      await this.stopDetachedManagedBridge(this.getConfiguredSocketPath());
    }
    return this.restart();
  }

  /**
   * Explicitly install or update the managed Rayu engine binary from GitHub Releases
   * and connect/restart the bridge using it.
   */
  async updateEngine(): Promise<DaemonStatusView> {
    if (this.activeUpdatePromise) return this.activeUpdatePromise;
    this.clearFatalCooldown();

    this.activeUpdatePromise = (async () => {
      const socketPath = this.getConfiguredSocketPath();
      const wasConnected = Boolean(this.client);
      if (!this.storageDir) {
        return this.updateStatus({
          state: wasConnected ? "connected" : "error",
          error: "Managed engine storage directory is unavailable.",
        });
      }

      const previousStatus = this.getStatus();
      let updated = false;
      let installedBinaryPath: string | undefined;
      let currentVersion: string | undefined;
      try {
        this.isUpdatingBinary = true;
        const res = await checkAndUpdateManagedBinary({
          storageDir: this.storageDir,
          extensionVersion: this.extensionVersion,
          force: true,
          onProgress: (event) => this.emitInstallProgress(socketPath, event),
        });

        if (res.error) {
          return this.updateStatus({
            state: wasConnected ? "connected" : "error",
            error: res.error,
            downloadProgress: undefined,
            downloadPhase: undefined,
            downloadVersion: undefined,
            downloadedBytes: undefined,
            totalBytes: undefined,
            statusMessage: undefined,
          });
        }

        if (res.binaryPath) {
          this.preferManagedBinary = true;
          this.binarySource = "managed";
          this.managedVersion = res.currentVersion;
          installedBinaryPath = res.binaryPath;
          currentVersion = res.currentVersion;
        }
        updated = res.updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return this.updateStatus({
          state: wasConnected ? "connected" : "error",
          error: message,
          downloadProgress: undefined,
          downloadPhase: undefined,
          downloadVersion: undefined,
          downloadedBytes: undefined,
          totalBytes: undefined,
          statusMessage: undefined,
        });
      } finally {
        this.isUpdatingBinary = false;
        this.finishNotificationProgress();
      }

      try {
        if (updated) {
          return await this.restartForEngineUpgrade(installedBinaryPath);
        }
        if (!wasConnected) {
          return await this.restart();
        }
        return this.updateStatus({
          state: "connected",
          downloadProgress: undefined,
          downloadPhase: undefined,
          downloadVersion: undefined,
          downloadedBytes: undefined,
          totalBytes: undefined,
          statusMessage: currentVersion
            ? `Rayu engine ${currentVersion} is up to date`
            : undefined,
          error: undefined,
        });
      } finally {
        this.activeUpdatePromise = null;
      }
    })();

    return this.activeUpdatePromise;
  }

  /**
   * Automatically ensure & keep the managed Rayu engine updated on VS Code startup
   * (even before the user opens the RayuCode sidebar or editor panel), after extension
   * Marketplace upgrades, and on a 4-hour background cadence.
   */
  bootstrapOnStartup(): void {
    if (this.disposed || !this.storageDir || this.initialUpdateTimer) return;

    const runStartupOrPeriodicCheck = async () => {
      if (this.disposed || !this.storageDir) return;
      if (this.backgroundUpdatePromise) {
        await this.backgroundUpdatePromise.catch(() => {});
        return;
      }
      if (this.getConfiguredBinaryPath() || process.env.RAYU_BINARY?.trim()) {
        return;
      }

      const resolved = resolveRayuBinaryWithSource({
        workspacePaths: this.getWorkspacePaths(),
        storageDir: this.storageDir,
      });

      // Fresh machine with no local/system `rayu` binary: immediately download
      // and warm up the managed engine + api-bridge in the background.
      if (!resolved) {
        if (this.isAutoStartEnabled() || this.isAutoUpdateEnabled()) {
          await this.ensureConnected().catch((err) => {
            this.log(
              `Startup engine bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
        return;
      }

      const existingManaged = readManagedBinaryInfo(this.storageDir);
      if (
        !this.isAutoUpdateEnabled() ||
        (!existingManaged && resolved.source !== "managed")
      ) {
        return;
      }

      const socketPath = this.getConfiguredSocketPath();
      const task = (async () => {
        let res;
        try {
          res = await checkAndUpdateManagedBinary({
            storageDir: this.storageDir!,
            extensionVersion: this.extensionVersion,
            checkIntervalMs: DEFAULT_UPDATE_CHECK_INTERVAL_MS,
            onProgress: (event) => {
              const isActive =
                event.phase === "downloading" ||
                event.phase === "verifying" ||
                event.phase === "extracting" ||
                event.phase === "installing";
              if (isActive) {
                this.isUpdatingBinary = true;
              }
              if (isActive || event.phase === "ready") {
                this.emitInstallProgress(socketPath, event);
              }
            },
          });
        } finally {
          this.isUpdatingBinary = false;
          this.finishNotificationProgress();
        }

        if (!res.updated || !res.currentVersion) {
          return;
        }

        this.preferManagedBinary = true;
        this.binarySource = "managed";
        this.managedVersion = res.currentVersion;
        this.log(`Background engine update installed ${res.currentVersion}`);

        if (!this.isTurnActive?.()) {
          await this.restartForEngineUpgrade(res.binaryPath);
        } else {
          this.pendingRestartVersion = res.currentVersion;
          this.updateStatus({
            managedVersion: res.currentVersion,
            binarySource: "managed",
            downloadProgress: undefined,
            downloadPhase: undefined,
            downloadVersion: undefined,
            downloadedBytes: undefined,
            totalBytes: undefined,
            statusMessage: `Rayu engine ${res.currentVersion} downloaded; restart bridge when ready`,
          });
        }
      })();

      this.backgroundUpdatePromise = task;
      try {
        await task;
      } finally {
        if (this.backgroundUpdatePromise === task) {
          this.backgroundUpdatePromise = null;
        }
      }
    };

    this.initialUpdateTimer = setTimeout(() => {
      void runStartupOrPeriodicCheck().catch((err) => {
        this.log(
          `Startup engine bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, INITIAL_UPDATE_CHECK_DELAY_MS);
    this.initialUpdateTimer.unref?.();

    this.periodicUpdateTimer = setInterval(() => {
      void runStartupOrPeriodicCheck().catch((err) => {
        this.log(
          `Periodic engine update check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, DEFAULT_UPDATE_CHECK_INTERVAL_MS);
    this.periodicUpdateTimer.unref?.();
  }

  scheduleEngineUpdateCheck(): void {
    this.bootstrapOnStartup();
  }

  async reloadDaemon(
    activeSessionId?: string,
    attachedClient?: RayucodeClient,
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      if (activeSessionId) {
        const client = attachedClient ?? (await this.ensureConnected({ manual: true }));
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
    this.finishNotificationProgress();
    if (this.initialUpdateTimer) {
      clearTimeout(this.initialUpdateTimer);
      this.initialUpdateTimer = null;
    }
    if (this.periodicUpdateTimer) {
      clearInterval(this.periodicUpdateTimer);
      this.periodicUpdateTimer = null;
    }
    this.configDisposable?.dispose();
    const current = this.client;
    this.client = null;
    void current?.close();
    // Do NOT SIGTERM the detached shared api-bridge on window dispose:
    // other VS Code windows and RayuCode Desktop share the same socket.
    this.bridgeProcess = null;
    this.outputChannel.dispose();
  }
}
