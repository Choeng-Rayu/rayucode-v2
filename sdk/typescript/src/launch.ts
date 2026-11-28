/**
 * Launching a private rayu instance.
 *
 * `RayucodeClient.connect()` attaches to whatever rayu is already running on the
 * machine, which is right for a tool that automates *your* rayu (an editor
 * plugin, a dashboard) and wrong for everything else. An application embedding
 * rayu as an agent engine wants its own instance: its own sessions, its own
 * state, and no way to disturb the user's live work by accident.
 *
 * `launch()` gives it one. It starts a private daemon and bridge under a
 * dedicated `RAYU_HOME` and runtime directory, and shuts them down on
 * `close()`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { HarnessError } from "./errors.js";
import { bundledRayuBinary, platformBinaryPackage } from "./binary.js";
import { transportEndpoint } from "./sockets.js";

/**
 * Files inherited from the user's rayu home when logins are inherited.
 *
 * Deliberately *not* included: `auth-refresh-state.json` and
 * `auth-validation.json`, which are derived records of past auth failures.
 * Copying them imports another rayu's bad day, and a stale
 * `rejected_refresh_fingerprint` makes a fresh instance refuse to even attempt
 * a refresh with credentials that work.
 */
const CREDENTIAL_FILES = [
  "auth.json",
  "rayu-auth.json",
  "openai-auth.json",
  "antigravity_oauth.json",
  "gemini_oauth.json",
  "google_oauth.json",
  "google_credentials.json",
  "config.toml",
];

/**
 * Credentials that must be *shared* with the user's home, not copied.
 *
 * OAuth refresh tokens rotate: redeeming one issues a new one and invalidates
 * the old. Two homes holding copies of the same token therefore fight, and
 * whichever refreshes second is logged out. A copy also goes stale on its own,
 * since the access token it holds expires in hours while an instance may run
 * for days. Sharing the file keeps one rotation record for one set of
 * credentials, which is what the tokens themselves already assume.
 */
const SHARED_FILES = new Set(CREDENTIAL_FILES.filter((name) => name !== "config.toml"));

/**
 * Where rayu looks for *other* tools' credentials, relative to `$HOME`.
 *
 * rayu can log in by reusing an existing CLI's OAuth store, so a large share
 * of real users have no usable `~/.rayu/auth.json` at all: the working
 * credentials live in files under `~/.claude/` or
 * `~/.config/github-copilot/`. Under
 * `RAYU_HOME` these lookups are sandboxed to `$RAYU_HOME/external/`, so an
 * instance that inherits only `auth.json` silently has no credentials and
 * fails on the first turn. Linking the recognized credential files makes
 * inheritance mean what it says without exposing either directory wholesale.
 */
/**
 * rayu's own config directory, relative to the platform config root.
 *
 * `app_config_dir()` is where provider env files live (`anthropic.env`,
 * `n.env` for subscription routes), and `RAYU_HOME` redirects it to
 * `$RAYU_HOME/config/rayucode`. It is easy to miss because it is not under
 * `~/.rayu` at all, and missing it is not a subtle failure: on a machine
 * whose working credential lives there, `auth.json` may hold only a
 * stale OAuth token, so the instance would inherit the wrong credential
 * and miss the configured env file.
 */
const APP_CONFIG_DIRNAME = "rayucode";

const EXTERNAL_CREDENTIAL_FILES = [
  ".claude/.credentials.json",
  ".codex/auth.json",
  ".gemini/oauth_creds.json",
  ".cursor/auth.json",
  ".config/cursor/auth.json",
  "AppData/Roaming/Cursor/auth.json",
  ".config/Cursor/User/globalStorage/state.vscdb",
  ".config/cursor/User/globalStorage/state.vscdb",
  "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
  "Library/Application Support/cursor/User/globalStorage/state.vscdb",
  "AppData/Roaming/Cursor/User/globalStorage/state.vscdb",
  "AppData/Roaming/cursor/User/globalStorage/state.vscdb",
  ".config/github-copilot/hosts.json",
  ".config/github-copilot/apps.json",
  ".copilot/config.json",
  ".hermes/auth.json",
  ".pi/agent/auth.json",
  ".openclaw/agent/auth.json",
  ".openclaw/credentials/oauth.json",
  ".local/share/opencode/auth.json",
];

/** Ensure a directory below an instance root contains no symlink components. */
function ensureInstanceDirectory(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/u).includes("..")) {
    throw new HarnessError("invalid_instance_home", `unsafe instance path: ${relative}`);
  }

  let current = root;
  for (const part of relative.split(/[\\/]+/u).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink()) {
        // Migrate homes made by SDK versions that linked whole credential
        // directories. unlinkSync removes the link itself, never its target.
        fs.unlinkSync(current);
        fs.mkdirSync(current, { mode: 0o700 });
      } else if (!stats.isDirectory()) {
        throw new HarnessError(
          "invalid_instance_home",
          `instance credential path is not a directory: ${current}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return current;
}

/** Replace an instance-relative path with a link to one credential file. */
function linkCredentialFile(source: string, root: string, relative: string): boolean {
  let sourceStats;
  try {
    sourceStats = fs.statSync(source);
  } catch {
    return false;
  }
  if (!sourceStats.isFile()) return false;

  const parent = ensureInstanceDirectory(root, path.dirname(relative));
  const destination = path.join(parent, path.basename(relative));
  try {
    fs.unlinkSync(destination);
  } catch {
    // Absent, which is the common case.
  }
  try {
    fs.symlinkSync(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (process.platform === "win32" && (code === "EPERM" || code === "ENOTSUP" || code === "EACCES")) {
      fs.copyFileSync(source, destination);
      fs.chmodSync(destination, 0o600);
    } else {
      throw error;
    }
  }
  return true;
}

export type WakeMode = "internal" | "external";

export interface LaunchOptions {
  /**
   * Directory holding the instance's state (sessions, logs, credentials).
   *
   * Defaults to a fresh temporary directory that is removed on `close()`.
   * Pass a stable path to keep sessions across runs.
   */
  rayuHome?: string;
  /** Working directory for sessions created in this instance. */
  workingDir?: string;
  /**
   * Share the user's provider logins with the instance. Defaults to `true`.
   *
   * Without credentials a fresh instance cannot talk to any model, so the
   * default is the one that works. It does mean the embedding application
   * spends the user's provider quota, so pass `false` to start empty and
   * supply credentials yourself.
   */
  inheritLogins?: boolean;
  /** Path to the rayu binary. Defaults to the npm-bundled runtime, then `rayu` on PATH. */
  binary?: string;
  /** Extra environment variables for the instance. */
  env?: Record<string, string>;
  /**
   * Permit launching with no configured credentials for signed-out inspection
   * (sets `RAYU_DEFERRED_AUTH_BOOTSTRAP=1`). Defaults to `false`.
   */
  allowSignedOut?: boolean;
  /**
   * Default model for spawned swarm workers, unless overridden per spawn.
   * Use `inherit` to default to the coordinator's model and auth route. This setting takes
   * precedence over `env.RAYU_SWARM_MODEL`.
   */
  swarmModel?: string;
  /**
   * Who executes autonomous wake requests. This operator-level setting takes
   * precedence over `env.RAYU_WAKE_MODE`.
   */
  wakeMode?: WakeMode;
  /** Milliseconds to wait for the socket to appear. Defaults to 30000. */
  startupTimeoutMs?: number;
  /** Forward the instance's stderr to this process. Defaults to false. */
  inheritStderr?: boolean;
  /**
   * Milliseconds `close()` will spend removing an ephemeral instance home.
   *
   * Background work started before shutdown can keep writing for seconds after
   * the daemon is asked to stop, recreating the directory behind a delete.
   * Defaults to 30000; lower it if a caller would rather leak than wait.
   */
  cleanupTimeoutMs?: number;
}

/** A running private rayu instance. */
export interface LaunchedInstance {
  /** API socket path to connect to. */
  socketPath: string;
  /** The instance's `RAYU_HOME`. */
  rayuHome: string;
  /** The bridge process. */
  process: ChildProcess;
  /** Stop the instance and clean up anything it created. */
  shutdown(): Promise<void>;
}

/** Resolve the user's real rayu home, ignoring any instance override. */
export function userRayuHome(): string {
  return process.env.RAYU_HOME ?? path.join(os.homedir(), ".rayu");
}

/** The user's rayu config directory, mirroring `storage::app_config_dir`. */
export function userAppConfigDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_CONFIG_DIRNAME);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, APP_CONFIG_DIRNAME);
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, APP_CONFIG_DIRNAME);
}

/**
 * Give a launched instance the user's provider logins.
 *
 * Credential files are symlinked so token rotation stays coherent (see
 * {@link SHARED_FILES}); everything else is copied, so the instance can edit
 * its own configuration without touching the user's. Copies are owner-only.
 *
 * Returns the names actually inherited, so a caller can tell "inherited
 * nothing" from "inherited something".
 */
export function inheritCredentials(fromHome: string, toHome: string): string[] {
  fs.mkdirSync(toHome, { recursive: true, mode: 0o700 });
  const toStats = fs.lstatSync(toHome);
  if (toStats.isSymbolicLink() || !toStats.isDirectory()) {
    throw new HarnessError(
      "invalid_instance_home",
      `instance home must be a real directory, not a link or file: ${toHome}`,
    );
  }
  if (
    fs.existsSync(fromHome) &&
    fs.realpathSync(fromHome) === fs.realpathSync(toHome)
  ) {
    throw new HarnessError(
      "invalid_instance_home",
      "instance home must be different from the user's rayu home",
    );
  }

  const inherited: string[] = [];
  for (const name of CREDENTIAL_FILES) {
    const source = path.join(fromHome, name);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(toHome, name);
    if (SHARED_FILES.has(name)) {
      // A reused `rayuHome` already has these links, and symlinkSync throws
      // EEXIST rather than replacing. Relinking also repoints a stale link
      // from an older run, so replace rather than skip.
      linkCredentialFile(source, toHome, name);
    } else {
      fs.copyFileSync(source, destination);
      fs.chmodSync(destination, 0o600);
    }
    inherited.push(name);
  }

  // rayu's provider env files live in its platform config directory, which
  // `RAYU_HOME` moves to `$RAYU_HOME/config/rayucode`. Link only the env files:
  // caches and usage data are not credentials and must stay instance-private.
  // Most importantly, never link the directory itself. A buggy recursive
  // cleanup can descend through a directory link and delete the user's files;
  // a file link can only ever be unlinked at the instance-side path.
  const userConfig = userAppConfigDir();
  try {
    for (const entry of fs.readdirSync(userConfig, { withFileTypes: true })) {
      if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(".env")) continue;
      const relative = `config/${APP_CONFIG_DIRNAME}/${entry.name}`;
      if (linkCredentialFile(path.join(userConfig, entry.name), toHome, relative)) {
        inherited.push(relative);
      }
    }
  } catch {
    // No app config directory is a normal fresh-install state.
  }

  // Other CLIs' credential stores, which rayu reads directly and which
  // `RAYU_HOME` redirects to `$RAYU_HOME/external/`. Share only the exact
  // credential files. Linking whole directories would also expose transcripts,
  // configuration, and anything those tools add in the future.
  for (const relative of EXTERNAL_CREDENTIAL_FILES) {
    const source = path.join(os.homedir(), relative);
    const instanceRelative = path.join("external", relative);
    if (linkCredentialFile(source, toHome, instanceRelative)) {
      inherited.push(`external/${relative}`);
    }
  }

  // OpenClaw's current store is per-agent. Enumerate one level of agent IDs,
  // then link only the two credential filenames its loader recognizes.
  const openclawAgents = path.join(os.homedir(), ".openclaw", "agents");
  try {
    for (const agent of fs.readdirSync(openclawAgents, { withFileTypes: true })) {
      if (!agent.isDirectory()) continue;
      for (const name of ["auth-profiles.json", "auth.json"]) {
        const relative = path.join(".openclaw", "agents", agent.name, "agent", name);
        if (
          linkCredentialFile(
            path.join(os.homedir(), relative),
            toHome,
            path.join("external", relative),
          )
        ) {
          inherited.push(`external/${relative}`);
        }
      }
    }
  } catch {
    // OpenClaw is optional.
  }
  return inherited;
}

/**
 * Pid of the daemon serving an instance, read from its own server registry.
 *
 * Synchronous on purpose: the only caller is a process "exit" handler, which
 * cannot await, so shelling out to the CLI is not available. rayu records
 * every server in `$RAYU_HOME/servers.json` keyed by socket path, and an
 * instance's registry lists only that instance's daemon, so this can never
 * resolve to the server the user is running themselves.
 */
function readDaemonPidSync(rayuHome: string, runtimeDir: string): number | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(rayuHome, "servers.json"), "utf8");
  } catch {
    return undefined;
  }
  let registry: Record<string, { socket?: string; pid?: number }>;
  try {
    registry = JSON.parse(raw) as Record<string, { socket?: string; pid?: number }>;
  } catch {
    return undefined;
  }
  const socket = path.join(runtimeDir, "rayu.sock");
  for (const entry of Object.values(registry)) {
    if (entry?.socket === socket && typeof entry.pid === "number" && entry.pid > 1) {
      return entry.pid;
    }
  }
  return undefined;
}

/** Wait briefly for a newly started daemon to publish its registry entry. */
async function waitForDaemonPid(
  rayuHome: string,
  runtimeDir: string,
  timeoutMs = 2000,
): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const pid = readDaemonPidSync(rayuHome, runtimeDir);
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return undefined;
}

export async function waitForDaemonPidForTest(
  rayuHome: string,
  runtimeDir: string,
  timeoutMs?: number,
): Promise<number | undefined> {
  return waitForDaemonPid(rayuHome, runtimeDir, timeoutMs);
}

/**
 * Stop an instance's daemon and wait for it to actually be gone.
 *
 * The pid comes from the instance's own `servers.json` rather than from
 * `rayu server stop`: spawning a second rayu binary to read a pid out of a
 * JSON file costs five seconds of process startup, and `close()` blocking that
 * long makes the SDK feel broken. The registry is scoped to this instance's
 * socket path, so this can never signal the server the user is running.
 */
async function stopInstanceDaemon(
  _binary: string,
  rayuHome: string,
  runtimeDir: string,
): Promise<void> {
  // The API socket can become connectable just before the daemon writes its
  // servers.json entry. close() may therefore run during this small startup
  // window, so do not silently give up after a single registry read.
  const pid = await waitForDaemonPid(rayuHome, runtimeDir);
  if (pid === undefined) return;

  const signal = (sig: NodeJS.Signals) => {
    try {
      // Negative pid: the daemon leads its own group after setsid(), and its
      // helper children have to go too or they keep writing into the home.
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // Already gone.
      }
    }
  };

  signal("SIGTERM");

  // Wait for a clean exit, but not for long. The daemon's own shutdown does
  // background work (flushing a multi-megabyte search index, among other
  // things) that can take fifteen seconds. Nothing there is worth preserving:
  // the instance is ephemeral and about to be deleted, so a short graceful
  // window followed by SIGKILL is both faster and more predictable.
  const gracePeriod = Date.now() + 2000;
  while (Date.now() < gracePeriod) {
    if (!processExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  signal("SIGKILL");

  // SIGKILL is not instant: the kernel still has to tear the process down, and
  // returning before it is gone races the delete that follows.
  const hardDeadline = Date.now() + 5000;
  while (Date.now() < hardDeadline) {
    if (!processExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** True while `pid` is still a live process. */
function processExists(pid: number): boolean {
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete an ephemeral instance home, refusing to follow symlinks out of it.
 *
 * The home contains symlinks that point at the user's real credential files.
 * Production inheritance never links directories, but cleanup still treats an
 * injected or legacy directory link as hostile: links are unlinked and never
 * descended into, and anything unexpected is left in place rather than
 * force-removed.
 */
export function removeInstanceHomeForTest(home: string): void {
  removeInstanceHome(home);
}

function removeInstanceHome(home: string): void {
  // Only homes created by this module are eligible for recursive cleanup.
  // Persistent caller-supplied homes are never passed here, but keep the guard
  // local to the destructive primitive so a future call site cannot turn a
  // lifecycle bug into deletion of an arbitrary directory.
  const resolvedHome = path.resolve(home);
  const tempRoot = path.resolve(os.tmpdir());
  if (
    path.dirname(resolvedHome) !== tempRoot ||
    !path.basename(resolvedHome).startsWith("rayu-sdk-instance-")
  ) {
    return;
  }

  const walk = (target: string): void => {
    let stats;
    try {
      stats = fs.lstatSync(target);
    } catch {
      return;
    }

    // `lstat`, not `stat`: a symlink must be reported as a link so it is
    // unlinked rather than descended into. Swapping in `stat` here deletes the
    // user's real credential store.
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(target);
      return;
    }

    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        walk(path.join(target, entry));
      }
      fs.rmdirSync(target);
      return;
    }
    fs.unlinkSync(target);
  };
  try {
    walk(home);
  } catch {
    // A stray file is a leaked temp directory; deleting the wrong thing is
    // unrecoverable. Prefer the leak.
  }
}

/**
 * Start a private rayu instance and return once its API socket is accepting
 * connections.
 * Private instances never auto-update: they run the binary that launched them.
 */
export async function launchInstance(options: LaunchOptions = {}): Promise<LaunchedInstance> {
  const binary = options.binary ?? bundledRayuBinary() ?? "rayu";
  const ephemeral = options.rayuHome === undefined;
  const rayuHome =
    options.rayuHome ??
    fs.mkdtempSync(path.join(os.tmpdir(), "rayu-sdk-instance-"));
  fs.mkdirSync(rayuHome, { recursive: true, mode: 0o700 });

  // The runtime directory holds the sockets. Keeping it inside the instance
  // home is what makes the instance private: the daemon binds its socket
  // there rather than in the shared $XDG_RUNTIME_DIR, so a launched instance
  // and the user's own rayu cannot collide or find each other.
  const runtimeDir = path.join(rayuHome, "run");
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const socketPath = path.join(runtimeDir, "rayu-api.sock");

  // A reused `rayuHome` still holds the previous run's socket files. The
  // startup loop waits for the API socket to *appear*, so a leftover one makes
  // launch() return immediately against a socket nothing is listening on, and
  // the first request fails with ECONNREFUSED. Clearing them is safe: a live
  // instance on this home would mean two daemons sharing one state directory,
  // which is already unsupported.
  for (const stale of ["rayu-api.sock", "rayu.sock", "rayu-debug.sock", "rayu.sock.hash"]) {
    try {
      fs.unlinkSync(path.join(runtimeDir, stale));
    } catch {
      // Absent, which is the normal case for a fresh home.
    }
  }

  if (options.inheritLogins ?? true) {
    inheritCredentials(userRayuHome(), rayuHome);
  }

  const spawnedEnv: Record<string, string | undefined> = {
    ...process.env,
    RAYU_HOME: rayuHome,
    RAYU_RUNTIME_DIR: runtimeDir,
    RAYU_API_SOCKET: socketPath,
    RAYU_SOCKET: path.join(runtimeDir, "rayu.sock"),
    // An empty private home always looks out of date, so the release updater
    // would replace and restart the runtime mid-session: the client's turn fails
    // and the restarted server is orphaned. The variable is inherited by every
    // rayu process the instance spawns (argv is not), so it keeps the release
    // auto-installer off in those too. The shared runtime still updates.
    RAYU_NO_AUTO_UPDATE: "1",
    ...(options.allowSignedOut ? { RAYU_DEFERRED_AUTH_BOOTSTRAP: "1" } : {}),
    ...options.env,
    ...(options.swarmModel === undefined
      ? {}
      : { RAYU_SWARM_MODEL: options.swarmModel }),
    ...(options.wakeMode === undefined ? {} : { RAYU_WAKE_MODE: options.wakeMode }),
  };
  const effectiveRayuHome = spawnedEnv.RAYU_HOME ?? rayuHome;

  const child = spawn(
    binary,
    // `--no-update` turns off the bridge's own update check, which also runs for
    // source builds.
    ["--no-update", "api-bridge", "--api-socket", socketPath],
    {
      cwd: options.workingDir ?? process.cwd(),
      env: spawnedEnv,
      stdio: ["ignore", "ignore", options.inheritStderr ? "inherit" : "pipe"],
      detached: false,
    },
  );

  // Keep the last of stderr: when startup fails, the reason is in there, and
  // "timed out" alone sends the caller looking in the wrong place.
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  let exited: { code: number | null; signal: string | null } | undefined;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });

  // A spawn failure (rayu not installed, which is the most likely first-run
  // problem) emits "error" on the child. Node treats an unlistened "error" as
  // a fatal throw from deep inside child_process, so without this the caller
  // cannot catch it at all: their process dies with a raw ENOENT stack instead
  // of being told to install rayu.
  let spawnError: NodeJS.ErrnoException | undefined;
  child.once("error", (error: NodeJS.ErrnoException) => {
    spawnError = error;
    exited = { code: null, signal: null };
  });


  const shutdown = async (): Promise<void> => {
    // A spawn that never started has no daemon to stop and nothing to wait
    // for. Running the full shutdown here would spend its whole budget trying
    // to talk to a daemon that does not exist, and the instance home would be
    // left behind by the very error path that is supposed to clean it up.
    if (spawnError) {
      if (ephemeral) removeInstanceHome(rayuHome);
      return;
    }

    // Stop the daemon *before* the bridge, not after.
    //
    // The instance's daemon is a separate process that the bridge spawned, so
    // killing the bridge does not stop it: it keeps running, keeps writing
    // sessions and caches into the instance home, and outlives close(). It is
    // asked to stop over its own socket, and that socket goes away when the
    // daemon starts shutting down, so doing this after the bridge dies races
    // a window where `server stop` reports "no running server found" and the
    // daemon is simply leaked.
    await stopInstanceDaemon(binary, effectiveRayuHome, runtimeDir);

    if (exited === undefined) {
      child.kill("SIGTERM");
      // Give it a moment to unwind before insisting.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        timer.unref?.();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    if (ephemeral) {
      // Even after the daemon is asked to stop, work it already started can
      // land after the first delete: the session-search indexer writes a
      // multi-megabyte file, and that write finishes seconds later, recreating
      // the directory behind a delete that had already succeeded. So deleting
      // once and seeing an empty result proves nothing. Require the home to
      // stay gone across a settle window, and keep trying for long enough to
      // outlast a slow flush.
      const deadline = Date.now() + (options.cleanupTimeoutMs ?? 30_000);
      while (Date.now() < deadline) {
        removeInstanceHome(rayuHome);
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (fs.existsSync(rayuHome)) continue;
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (!fs.existsSync(rayuHome)) return;
      }
      // Out of time. A leaked temp directory is a much smaller problem than a
      // close() that never returns, but it should not be silent.
      if (fs.existsSync(rayuHome)) {
        process.emitWarning(
          `rayu instance home was still being written to and could not be removed: ${rayuHome}`,
        );
      }
    }
  };

  // A consumer who crashes, or simply forgets close(), would otherwise leave
  // the daemon running forever: a server embedding rayu would accumulate one
  // instance per restart, each holding a temp directory and a model
  // connection. Node runs "exit" handlers on a normal exit and after an
  // uncaught exception, which covers everything short of SIGKILL.
  const reapOnExit = () => {
    try {
      if (exited === undefined) child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    // The daemon calls setsid(), so it leads its own session and no signal
    // aimed at the bridge can reach it. Killing the bridge alone is exactly
    // the leak this handler exists to prevent.
    const pid = readDaemonPidSync(effectiveRayuHome, runtimeDir);
    if (pid !== undefined && !hasActiveOvernightRun(effectiveRayuHome)) {
      // SIGKILL, not SIGTERM: an exit handler cannot await, so there is no
      // chance to wait for a graceful shutdown, and a SIGTERM'd daemon would
      // still be flushing when this process is gone, recreating the very
      // directory being removed below. Skip hard-kill when overnight jobs exist.
      try {
        // Negative pid: the daemon leads a group, so its helpers go with it.
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }

    // Remove the home too. Reaping the daemon alone still leaves a temp
    // directory per crash, which for a server that restarts is the same
    // unbounded growth in a different resource.
    if (ephemeral) {
      try {
        removeInstanceHome(rayuHome);
      } catch {
        // Best-effort: an exit handler must not throw.
      }
    }
  };
  process.once("exit", reapOnExit);

  const deadline = Date.now() + (options.startupTimeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (spawnError) {
      process.removeListener("exit", reapOnExit);
      await shutdown();
      const binaryName = binary;
      const platformPackage = platformBinaryPackage();
      throw new HarnessError(
        "rayu_not_found",
        spawnError.code === "ENOENT"
          ? `could not run \`${binaryName}\`: rayu is not installed, or not on PATH. ` +
            (platformPackage
              ? `The bundled runtime package (${platformPackage}) is missing. Reinstall without ` +
                "--omit=optional, install rayu from https://rayucode.com, or pass `binary` with its full path."
              : "Install rayu from https://rayucode.com, or pass `binary` with its full path.")
          : `could not run \`${binaryName}\`: ${spawnError.message}`,
      );
    }
    if (exited) {
      process.removeListener("exit", reapOnExit);
      await shutdown();
      throw new HarnessError(
        "startup_failed",
        `rayu exited during startup (code ${exited.code}, signal ${exited.signal})` +
          (stderr ? `:\n${stderr.trim()}` : ""),
      );
    }
    if (await isEndpointReady(socketPath)) {
      return {
        socketPath,
        rayuHome: effectiveRayuHome,
        process: child,
        shutdown: async () => {
          process.removeListener("exit", reapOnExit);
          await shutdown();
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  process.removeListener("exit", reapOnExit);
  await shutdown();
  throw new HarnessError(
    "startup_timeout",
    `rayu did not create its API socket at ${socketPath} within the startup timeout` +
      (stderr ? `:\n${stderr.trim()}` : ""),
  );
}

function hasActiveOvernightRun(rayuHome: string): boolean {
  const runsDir = path.join(rayuHome, "overnight");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = fs.readFileSync(path.join(runsDir, entry.name, "manifest.json"), "utf8");
      const parsed = JSON.parse(raw) as { status?: string };
      if (parsed.status === "running" || parsed.status === "pending") return true;
    } catch {
      // Ignore unreadable or non-JSON manifests.
    }
  }
  return false;
}

async function isEndpointReady(socketPath: string): Promise<boolean> {
  if (process.platform !== "win32") {
    return fs.existsSync(socketPath);
  }
  const endpoint = transportEndpoint(socketPath);
  return await new Promise<boolean>((resolve) => {
    const sock = net.createConnection(endpoint);
    const done = (ready: boolean) => {
      sock.destroy();
      resolve(ready);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(150, () => done(false));
  });
}
