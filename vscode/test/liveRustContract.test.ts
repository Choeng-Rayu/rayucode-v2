import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  HarnessError,
  RayucodeClient,
  launchInstance,
  type LaunchedInstance,
} from "@rayu-dev/rayucode-sdk";
import { WorkspaceRegistry } from "@rayu-dev/rayucode-session-core/host";
import { GitChangesBridge } from "../host/bridges/gitChangesBridge.js";
import {
  createFeatureRouter,
  type FeatureRouterBridge,
  type FeatureRouterDeps,
} from "../host/runtime/featureRouters.js";
import {
  SessionHubCore,
  type SessionHubBridgeLike,
  type SessionHubHostAdapter,
  type SessionHubMemento,
} from "../host/runtime/sessionHubCore.js";
import type {
  DaemonStatusView,
  HostToWebviewMessage,
  PermissionModeId,
} from "../shared/vscodeProtocol.js";

function createMemoryMemento(): SessionHubMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

class LiveBridgeAdapter
  extends EventEmitter
  implements SessionHubBridgeLike, FeatureRouterBridge
{
  private primaryClient: RayucodeClient | null = null;
  private status: DaemonStatusView;

  constructor(private readonly socketPath: string) {
    super();
    this.status = {
      state: "disconnected",
      socketPath,
      capabilities: [],
    };
  }

  async connectPrimary(): Promise<RayucodeClient> {
    const start = Date.now();
    const client = await RayucodeClient.connect({
      socketPath: this.socketPath,
      clientName: "rayucode-vscode-live-contract/1.0",
      supportsPermissions: true,
      supportsUserQuestions: true,
      requestTimeoutMs: 15_000,
    });
    const latencyMs = Math.max(1, Date.now() - start);
    this.primaryClient = client;
    client.on("event", (frame) => {
      this.emit("frame", frame);
    });
    this.status = {
      state: "connected",
      version: client.server || undefined,
      bridgeVersion: client.server || undefined,
      protocolVersion:
        client.protocolMajor === undefined
          ? undefined
          : [client.protocolMajor, client.protocolMinor]
              .filter((v) => v !== undefined)
              .join("."),
      socketPath: this.socketPath,
      latencyMs,
      capabilities: [...client.capabilities],
      isRayuRepo: false,
    };
    this.emit("statusChanged", this.status);
    this.emit("connected", client);
    return client;
  }

  getStatus(): DaemonStatusView {
    return this.status;
  }

  getActiveClient(): RayucodeClient | null {
    return this.primaryClient;
  }

  async ensureConnected(): Promise<RayucodeClient> {
    if (this.primaryClient) return this.primaryClient;
    return this.connectPrimary();
  }

  async dialClient(customSocketPath?: string): Promise<RayucodeClient> {
    return RayucodeClient.connect({
      socketPath: customSocketPath ?? this.socketPath,
      clientName: "rayucode-vscode-live-pool/1.0",
      supportsPermissions: true,
      supportsUserQuestions: true,
      requestTimeoutMs: 15_000,
    });
  }

  async ping(): Promise<{ ok: boolean; latencyMs?: number; version?: string }> {
    const client = await this.ensureConnected();
    const start = Date.now();
    await client.ping();
    return {
      ok: true,
      latencyMs: Math.max(1, Date.now() - start),
      version: this.status.protocolVersion ?? this.status.version,
    };
  }

  async reconnect(): Promise<DaemonStatusView> {
    await this.ensureConnected();
    return this.status;
  }

  async restart(): Promise<DaemonStatusView> {
    return this.status;
  }

  async updateEngine(): Promise<DaemonStatusView> {
    return this.status;
  }

  async reloadDaemon(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: "isolated" };
  }

  openOutputLog(): void {}

  async close(): Promise<void> {
    if (this.primaryClient) {
      await this.primaryClient.close().catch(() => {});
      this.primaryClient = null;
    }
  }
}

function resolveSelfDevBinary(): string {
  const candidates = [
    path.resolve(process.cwd(), "target/selfdev/rayu"),
    path.resolve(process.cwd(), "../target/selfdev/rayu"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Source-built selfdev binary not found. Checked: ${candidates.join(", ")}. Run \`cargo build --profile selfdev --bin rayu\`.`,
  );
}

function initTwoGitWorktrees(root: string): { wtA: string; wtB: string } {
  const wtA = path.join(root, "wt-a");
  const wtB = path.join(root, "wt-b");
  fs.mkdirSync(path.join(wtA, "src"), { recursive: true });

  const git = (cwd: string, args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Rayu Contract Test",
        GIT_AUTHOR_EMAIL: "contract@rayu.local",
        GIT_COMMITTER_NAME: "Rayu Contract Test",
        GIT_COMMITTER_EMAIL: "contract@rayu.local",
      },
      stdio: "pipe",
    });

  git(wtA, ["init", "-b", "main"]);
  fs.writeFileSync(
    path.join(wtA, "src/shared.ts"),
    'export const origin = "base";\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(wtA, "manual.txt"),
    "original tracked content\n",
    "utf8",
  );
  git(wtA, ["add", "."]);
  git(wtA, ["commit", "-m", "initial commit"]);
  git(wtA, ["worktree", "add", "-b", "branch-b", wtB]);

  // Diverge identical relative path across both worktrees
  fs.writeFileSync(
    path.join(wtA, "src/shared.ts"),
    'export const origin = "worktree-a-bytes";\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(wtB, "src/shared.ts"),
    'export const origin = "worktree-b-bytes";\n',
    "utf8",
  );

  // Tracked manual-only edit and untracked file in wtA for byte-safety assertions
  fs.writeFileSync(
    path.join(wtA, "manual.txt"),
    "user manual edit must stay intact\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(wtA, "untracked.txt"),
    "user untracked draft must stay intact\n",
    "utf8",
  );

  return {
    wtA: fs.realpathSync(wtA),
    wtB: fs.realpathSync(wtB),
  };
}

test(
  "live isolated Rust engine contract: two-worktree isolation, file safety, atomic MCP/skills, capabilities, config, and runtime commands",
  { timeout: 120_000 },
  async () => {
    const binary = resolveSelfDevBinary();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-live-contract-"));
    const prevRayuHome = process.env.RAYU_HOME;
    let instance: LaunchedInstance | null = null;
    let bridge: LiveBridgeAdapter | null = null;
    let observer: RayucodeClient | null = null;
    let sessionHub: SessionHubCore | null = null;
    let workspaceRegistry: WorkspaceRegistry | null = null;

    try {
      const { wtA, wtB } = initTwoGitWorktrees(tmpRoot);
      instance = await launchInstance({
        binary,
        workingDir: wtA,
        inheritLogins: false,
        allowSignedOut: true,
        startupTimeoutMs: 30_000,
      });
      process.env.RAYU_HOME = instance.rayuHome;

      bridge = new LiveBridgeAdapter(instance.socketPath);
      const primaryClient = await bridge.connectPrimary();

      // Independent second SDK client verifying actual Rust daemon state
      observer = await RayucodeClient.connect({
        socketPath: instance.socketPath,
        clientName: "live-contract-observer/1.0",
        requestTimeoutMs: 15_000,
      });

      // 1. Handshake protocol major, optional minor, and advertised capabilities
      assert.equal(primaryClient.protocolMajor, 1);
      assert.equal(observer.protocolMajor, 1);
      assert.ok(primaryClient.capabilities.includes("file_changes"));
      assert.ok(primaryClient.capabilities.includes("permissions"));
      assert.ok(primaryClient.capabilities.includes("config_v1"));
      assert.ok(primaryClient.capabilities.includes("capabilities_v1"));
      assert.ok(primaryClient.capabilities.includes("runtime_commands"));

      const broadcastEvents: HostToWebviewMessage[] = [];
      let defaultPerm: PermissionModeId = "default";
      const workspaceState = createMemoryMemento();
      const globalState = new Map<string, unknown>();

      const ledgerPath = path.join(tmpRoot, "workspace-ledger.json");
      workspaceRegistry = new WorkspaceRegistry({ filePath: ledgerPath });
      const hostAdapter: SessionHubHostAdapter = {
        workspaceState,
        getWorkspaceFolders: () => [
          { name: "wt-a", fsPath: wtA },
          { name: "wt-b", fsPath: wtB },
        ],
        getDefaultPermissionModeRaw: () => defaultPerm,
        setDefaultPermissionMode: (mode) => {
          defaultPerm = mode;
        },
      };

      sessionHub = new SessionHubCore(hostAdapter, bridge, {
        workspaceRegistry,
      });
      sessionHub.registerSurface("live-test", "panel", (msg) => {
        broadcastEvents.push(msg);
      });

      const gitBridge = new GitChangesBridge(
        () => sessionHub?.getSessionWorkingDir(),
      );

      const deps: FeatureRouterDeps = {
        bridgeManager: bridge,
        sessionHub,
        gitBridge,
        editorBridge: {
          openFile: async () => {},
          openWorktreeWindow: async () => {},
          openExternal: async () => {},
          pickFiles: async () => [],
          findWorkspaceFiles: async () => ["src/shared.ts"],
        },
        getWorkspaceFolders: async () => [
          { name: "wt-a", path: wtA, branch: "main" },
          { name: "wt-b", path: wtB, branch: "branch-b" },
        ],
        setProjectIcon: async () => {},
        getGlobalState: <T,>(key: string, def: T): T =>
          (globalState.has(key) ? globalState.get(key) : def) as T,
        updateGlobalState: async (key: string, value: unknown) => {
          globalState.set(key, value);
        },
        getRuntimeSettings: () => ({
          socketPath: instance!.socketPath,
          binaryPath: binary,
          autoStart: false,
        }),
        updateRuntimeSettings: async () => {},
        openKeybindings: async () => {},
      };
      const router = createFeatureRouter(deps);

      // Ensure both worktrees exist in the workspace ledger
      await router.call("workspace.ledger.ensure", { path: wtA, name: "wt-a" });
      await router.call("workspace.ledger.ensure", { path: wtB, name: "wt-b" });

      // 2. Ambiguous multi-worktree sessions.create (omitted workingDir) must reject
      await assert.rejects(
        () => router.call("sessions.create", {}),
        (err: unknown) =>
          err instanceof HarnessError && err.code === "invalid_request",
      );

      // Create Session A in wtA and Session B in wtB
      const createdA = await router.call("sessions.create", {
        workingDir: wtA,
      });
      const createdB = await router.call("sessions.create", {
        workingDir: wtB,
      });
      const idA = createdA.session.sessionId;
      const idB = createdB.session.sessionId;
      assert.notEqual(idA, idB);

      // Seed one no-reply context message per session so the Rust daemon persists
      // session transcripts + working_dir for independent second-client readback.
      const clientA = await sessionHub.ensureAttachedClient(idA);
      await clientA.sendMessage(idA, "Worktree A live seed", { noReply: true });
      const clientB = await sessionHub.ensureAttachedClient(idB);
      await clientB.sendMessage(idB, "Worktree B live seed", { noReply: true });

      // Independent second SDK verifies both sessions persisted in Rust engine
      assert.equal(fs.realpathSync(createdA.session.workingDir ?? ""), wtA);
      assert.equal(fs.realpathSync(createdB.session.workingDir ?? ""), wtB);
      const observedSessions = await observer.listSessions({
        includeArchived: true,
        limit: 50,
      });
      const obsA = observedSessions.find((s) => s.session_id === idA);
      const obsB = observedSessions.find((s) => s.session_id === idB);
      assert.ok(obsA, "Session A must exist in Rust engine");
      assert.ok(obsB, "Session B must exist in Rust engine");
      if (obsA.working_dir) {
        assert.equal(fs.realpathSync(obsA.working_dir), wtA);
      }
      if (obsB.working_dir) {
        assert.equal(fs.realpathSync(obsB.working_dir), wtB);
      }
      const attachedObsA = await observer.attachSession(idA);
      if (attachedObsA.working_dir) {
        assert.equal(fs.realpathSync(attachedObsA.working_dir), wtA);
      }
      const obsHistA = await observer.getHistory(idA);
      assert.ok(obsHistA.some((m) => String(m.content ?? "").includes("Worktree A live seed")));
      const attachedObsB = await observer.attachSession(idB);
      if (attachedObsB.working_dir) {
        assert.equal(fs.realpathSync(attachedObsB.working_dir), wtB);
      }
      const obsHistB = await observer.getHistory(idB);
      assert.ok(obsHistB.some((m) => String(m.content ?? "").includes("Worktree B live seed")));

      // Focus Session B, verify Session A retains wtA and mutating Session A never touches Session B
      await router.call("sessions.attach", { sessionId: idB });
      assert.equal(sessionHub.getActiveSessionId(), idB);
      assert.equal(
        fs.realpathSync(sessionHub.getSessionWorkingDirForSession(idA) ?? ""),
        wtA,
      );
      assert.equal(
        fs.realpathSync(sessionHub.getSessionWorkingDirForSession(idB) ?? ""),
        wtB,
      );

      await router.call("sessions.rename", {
        sessionId: idA,
        title: "Worktree A Renamed",
      });
      const afterRename = await observer.listSessions({
        includeArchived: true,
        limit: 50,
      });
      assert.equal(
        afterRename.find((s) => s.session_id === idA)?.title,
        "Worktree A Renamed",
      );
      assert.notEqual(
        afterRename.find((s) => s.session_id === idB)?.title,
        "Worktree A Renamed",
      );

      // Identical relative path src/shared.ts reads distinct bytes per session worktree
      const diffA = await router.call("changes.diff", {
        sessionId: idA,
        path: "src/shared.ts",
        scope: "git",
      });
      const diffB = await router.call("changes.diff", {
        sessionId: idB,
        path: "src/shared.ts",
        scope: "git",
      });
      assert.match(diffA.modifiedContent, /worktree-a-bytes/);
      assert.match(diffB.modifiedContent, /worktree-b-bytes/);

      // Second independent SDK client reads rooted file per session
      await observer.attachSession(idA);
      const fileA = await observer.readFile(idA, "src/shared.ts");
      assert.match(fileA.content, /worktree-a-bytes/);
      await observer.attachSession(idB);
      const fileB = await observer.readFile(idB, "src/shared.ts");
      assert.match(fileB.content, /worktree-b-bytes/);

      // Whole-session Fork on Session A creates a real forked session in Rust
      const forked = await router.call("sessions.fork", { sessionId: idA });
      assert.ok(forked.session.sessionId);
      assert.notEqual(forked.session.sessionId, idA);
      const afterFork = await observer.listSessions({
        includeArchived: true,
        limit: 50,
      });
      assert.ok(
        afterFork.some((s) => s.session_id === forked.session.sessionId),
        "Forked session must exist in Rust engine",
      );

      // Local workspace-ledger archive hides in sidebar without archiving on engine
      await router.call("sessions.archive", {
        sessionId: idA,
        archived: true,
      });
      const listedActive = await router.call("sessions.list", {
        includeArchived: false,
      });
      assert.equal(
        listedActive.sessions.some((s) => s.sessionId === idA),
        false,
      );
      const listedAll = await router.call("sessions.list", {
        includeArchived: true,
      });
      assert.equal(
        listedAll.sessions.find((s) => s.sessionId === idA)?.archived,
        true,
      );
      const engineUnarchived = await observer.listSessions({
        includeArchived: false,
        limit: 50,
      });
      assert.ok(
        engineUnarchived.some((s) => s.session_id === idA),
        "Sidebar archive must remain local workspace-ledger preference without mutating engine archive state",
      );
      await router.call("sessions.archive", {
        sessionId: idA,
        archived: false,
      });

      // Pin, permission mode, history, findFiles
      await router.call("sessions.pin", { sessionId: idA, pinned: true });
      const permRes = await router.call("sessions.setPermissionMode", {
        sessionId: idB,
        mode: "plan",
      });
      assert.equal(permRes.ok, true);
      assert.equal(permRes.mode, "plan");
      const historyA = await router.call("sessions.history", { sessionId: idA });
      assert.ok(Array.isArray(historyA.messages));
      const foundFiles = await router.call("workspace.findFiles", {
        sessionId: idA,
        query: "shared.ts",
      });
      assert.ok(foundFiles.files.some((p) => p.includes("shared.ts")));

      // 3. Real Rust file_changes snapshot & byte-for-byte protection for manual/untracked files
      const summaryA = await router.call("changes.getSessionSummary", {
        sessionId: idA,
      });
      assert.equal(summaryA.sessionId, idA);
      assert.equal(summaryA.totalPendingFiles, 0);
      assert.equal(summaryA.files.length, 0);
      await observer.attachSession(idA);
      const rawSnapshotA = await observer.getFileChanges(idA);
      assert.equal(rawSnapshotA.total_pending_files, 0);
      assert.equal(rawSnapshotA.files.length, 0);

      const manualBefore = fs.readFileSync(path.join(wtA, "manual.txt"));
      const untrackedBefore = fs.readFileSync(path.join(wtA, "untracked.txt"));
      const legacyManualUndo = await gitBridge.undo({
        path: "manual.txt",
        sessionId: idA,
      });
      const legacyUntrackedUndo = await gitBridge.undo({
        path: "untracked.txt",
        sessionId: idA,
      });
      assert.equal(legacyManualUndo.ok, false);
      assert.equal(legacyUntrackedUndo.ok, false);
      assert.deepEqual(
        fs.readFileSync(path.join(wtA, "manual.txt")),
        manualBefore,
      );
      assert.deepEqual(
        fs.readFileSync(path.join(wtA, "untracked.txt")),
        untrackedBefore,
      );

      // 4. Atomic MCP write/edit preserving secrets & unrelated fields + malformed JSON + exclusive skill creation
      const mcpAdd = await router.call("plugins.mcp.add", {
        id: "live-contract-mcp",
        scope: "workspace",
        workspacePath: wtA,
        transport: "stdio",
        command: "node",
        args: ["-e", "console.log('ok')"],
        env: { LIVE_SECRET: "keep-me-secret" },
      });
      assert.equal(mcpAdd.ok, true);
      assert.equal(mcpAdd.saved, true);
      assert.equal(typeof mcpAdd.reloaded, "boolean");

      // Inject an unrelated custom field & verify edit preserves both secret and custom field
      const mcpJsonPath = path.join(wtA, ".mcp.json");
      const rawMcp = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8")) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      rawMcp.mcpServers["live-contract-mcp"]!.customMeta = "preserve-me";
      fs.writeFileSync(mcpJsonPath, JSON.stringify(rawMcp, null, 2), "utf8");

      const mcpEdit = await router.call("plugins.mcp.edit", {
        id: "live-contract-mcp",
        scope: "workspace",
        workspacePath: wtA,
        args: ["-e", "console.log('updated')"],
        env: { LIVE_SECRET: "" },
      });
      assert.equal(mcpEdit.ok, true);
      assert.equal(mcpEdit.saved, true);
      const afterEditMcp = JSON.parse(
        fs.readFileSync(mcpJsonPath, "utf8"),
      ) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      const editedEntry = afterEditMcp.mcpServers["live-contract-mcp"]!;
      assert.equal(editedEntry.customMeta, "preserve-me");
      assert.equal(
        (editedEntry.env as Record<string, string>).LIVE_SECRET,
        "keep-me-secret",
      );

      const mcpRemove = await router.call("plugins.mcp.remove", {
        id: "live-contract-mcp",
        scope: "workspace",
        workspacePath: wtA,
      });
      assert.equal(mcpRemove.ok, true);
      assert.equal(mcpRemove.saved, true);

      // Malformed .mcp.json must reject and preserve exact bytes
      const malformedBytes = Buffer.from("{ broken json ", "utf8");
      fs.writeFileSync(mcpJsonPath, malformedBytes);
      await assert.rejects(
        () =>
          router.call("plugins.mcp.add", {
            id: "should-fail",
            scope: "workspace",
            workspacePath: wtA,
            transport: "stdio",
            command: "node",
          }),
        (err: unknown) =>
          err instanceof HarnessError && err.code === "invalid_request",
      );
      assert.deepEqual(fs.readFileSync(mcpJsonPath), malformedBytes);

      // Exclusive skill creation rejects traversal & preserves bytes on duplicate
      await assert.rejects(() =>
        router.call("plugins.skills.create", {
          name: "../../evil",
          description: "bad",
          scope: "project",
          workspacePath: wtA,
        }),
      );
      const createdSkill = await router.call("plugins.skills.create", {
        name: "live-contract-skill",
        description: "Verify: quoted YAML description",
        content: "Body instructions.",
        scope: "project",
        workspacePath: wtA,
      });
      assert.equal(createdSkill.ok, true);
      assert.equal(createdSkill.saved, true);
      const skillBytesBefore = fs.readFileSync(createdSkill.skill.path);
      assert.match(
        skillBytesBefore.toString("utf8"),
        /description: "Verify: quoted YAML description"/,
      );
      await assert.rejects(() =>
        router.call("plugins.skills.create", {
          name: "live-contract-skill",
          description: "Duplicate overwrite attempt",
          scope: "project",
          workspacePath: wtA,
        }),
      );
      assert.deepEqual(
        fs.readFileSync(createdSkill.skill.path),
        skillBytesBefore,
      );

      // 5. Live capabilities, config, models, doctor (no hardcoded v1.14), and runtime commands
      const caps = await router.call("capabilities.get", { sessionId: idB });
      assert.equal(caps.supported, true);
      assert.ok(caps.permission_modes.length > 0);
      assert.ok(caps.commands.length > 0);

      const cfg = await router.call("config.get", {});
      assert.equal(cfg.supported, true);
      assert.ok(cfg.config && cfg.config.schema.length > 0);

      const daemonStatus = await router.call("daemon.status", {});
      assert.equal(daemonStatus.state, "connected");
      assert.ok(daemonStatus.protocolVersion?.startsWith("1"));

      const ping = await router.call("daemon.ping", {});
      assert.equal(ping.ok, true);

      const doctor = await router.call("settings.doctor.run", {
        scope: "providers",
      });
      assert.ok(doctor.checks.length > 0);
      for (const check of doctor.checks) {
        assert.doesNotMatch(
          check.detail ?? "",
          /v1\.14/,
          "Doctor output must never hardcode v1.14",
        );
      }
      const doctorAuth = await router.call("settings.doctor.run", {
        scope: "auth",
      });
      assert.ok(doctorAuth.checks.length > 0);

      const modelsGet = await router.call("settings.models.get", {
        sessionId: idB,
      });
      assert.ok(modelsGet.sources);
      assert.equal(modelsGet.sources?.engine, "fresh");

      const modelsRefresh = await router.call("settings.models.refresh", {
        sessionId: idB,
      });
      assert.equal(modelsRefresh.sources?.engine, "fresh");
      assert.equal(modelsRefresh.ok, true);

      const features = await router.call("settings.features.get", {});
      assert.equal(typeof features.features.memory, "boolean");
      assert.equal(typeof features.voice.supported, "boolean");

      const mcpList = await router.call("plugins.mcp.list", {});
      assert.ok(Array.isArray(mcpList.servers));

      const skillsList = await router.call("plugins.skills.list", {});
      assert.ok(Array.isArray(skillsList.skills));

      const memoryStatus = await router.call("plugins.memory.status", {});
      assert.equal(typeof memoryStatus.enabled, "boolean");

      const workspaceIntegrations = await router.call("plugins.workspace.status", {});
      assert.equal(workspaceIntegrations.available, false);

      const processes = await router.call("background.list", { sessionId: idB });
      assert.ok(Array.isArray(processes.tasks));

      const searchRes = await router.call("sessions.search", {
        query: "Worktree A",
      });
      assert.ok(Array.isArray(searchRes.hits));

      const overnightList = await router.call("automations.overnight.list", {});
      assert.ok(Array.isArray(overnightList.runs));

      const schedulesList = await router.call("automations.schedules.list", {});
      assert.ok(Array.isArray(schedulesList.schedules));

      const ambient = await router.call("automations.ambient.status", {});
      assert.ok(Array.isArray(ambient.approvals));

      const quality = await router.call("automations.quality.status", {});
      assert.equal(typeof quality.autoReviewEnabled, "boolean");
      assert.equal(typeof quality.autoJudgeEnabled, "boolean");

      const telegram = await router.call("remote.telegram.status", {});
      assert.equal(typeof telegram.linked, "boolean");
      assert.equal(telegram.daemonOnline, true);

      const infra = await router.call("remote.infra.status", {});
      assert.equal(typeof infra.cloudConfigured, "boolean");
      assert.ok(Array.isArray(infra.sessions));

      const swarm = await router.call("swarm.list", {});
      assert.ok(Array.isArray(swarm.swarms));

      const swarmStatus = await router.call("swarm.status", {});
      assert.ok(
        swarmStatus.swarm === null || Array.isArray(swarmStatus.swarm.agents),
      );

      const todosB = await router.call("inspector.todos.get", { sessionId: idB });
      assert.ok(Array.isArray(todosB.todos));

      const ctxSnap = await router.call("workspace.contextSnapshot", { sessionId: idB });
      assert.ok(Array.isArray(ctxSnap.categories));

      const branches = await router.call("workspace.listBranches", { workspacePath: wtA });
      assert.equal(branches.current, "main");

      const folders = await router.call("workspace.listFolders", {});
      assert.equal(folders.folders.length, 2);

      const ledger = await router.call("workspace.ledger.get", {});
      assert.ok(ledger.workspaces.length >= 2);

      const exported = await router.call("sessions.export", {
        sessionId: idA,
        format: "markdown",
      });
      assert.match(exported.content, /Worktree A live seed/);

      const providers = await router.call("settings.providers.list", {});
      assert.ok(Array.isArray(providers.providers));

      const analytics = await router.call("settings.analytics.get", {
        range: "7d",
        groupBy: "model",
      });
      assert.equal(analytics.available, false);

      const hooks = await router.call("settings.hooks.list", {});
      assert.ok(Array.isArray(hooks.hooks));

      const runtimeSettings = await router.call("settings.runtime.get", {});
      assert.equal(runtimeSettings.socketPath, instance.socketPath);

      const shortcuts = await router.call("settings.shortcuts.list", {});
      assert.ok(shortcuts.shortcuts.length > 0);

      const permDefault = await router.call("settings.permission.getDefault", {});
      assert.equal(permDefault.mode, "default");

      const permDefaultSet = await router.call("settings.permission.setDefault", {
        mode: "plan",
        applyToActiveSession: true,
      });
      assert.equal(permDefaultSet.ok, true);
      assert.equal(permDefaultSet.mode, "plan");

      const cacheSet = await router.call("settings.models.setCacheTtl", {
        ttl: "1h",
        sessionId: idB,
      });
      assert.equal(cacheSet.ok, true);
      assert.equal(cacheSet.ttl, "1h");

      // Verify broadcast stream received real host updates
      assert.ok(broadcastEvents.length > 0);
    } finally {
      if (prevRayuHome === undefined) {
        delete process.env.RAYU_HOME;
      } else {
        process.env.RAYU_HOME = prevRayuHome;
      }
      sessionHub?.dispose();
      workspaceRegistry?.dispose();
      if (observer) await observer.close().catch(() => {});
      if (bridge) await bridge.close().catch(() => {});
      if (instance) await instance.shutdown().catch(() => {});
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  },
);
