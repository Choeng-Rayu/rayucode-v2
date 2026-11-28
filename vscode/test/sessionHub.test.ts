import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  HarnessError,
  type RayucodeClient,
  type RuntimeCommand,
  type ServerFrame,
  type SessionInfo,
} from "@rayu-dev/rayucode-sdk";
import { WorkspaceRegistry } from "@rayu-dev/rayucode-session-core/host";
import {
  parseWebviewToHostMessage,
  type HostToWebviewMessage,
} from "../shared/vscodeProtocol.js";
import { resolveMarkdownPreviewPath } from "../host/bridges/editorBridge.js";
import {
  buildConnectedStatusBarTooltipLines,
  formatStatusBarVersionLabel,
} from "../host/bridges/statusBarBridge.js";
import {
  resolveMarkdownPreviewBaseDirForMessage,
  resolveTerminalCwdForMessage,
} from "../host/panel/workspacePanelManager.js";
import {
  ARCHIVED_SESSIONS_KEY,
  PINNED_SESSIONS_KEY,
  SessionHubCore,
  type SessionHubBridgeLike,
  type SessionHubHostAdapter,
  type SessionHubWorkspaceFolder,
} from "../host/runtime/sessionHubCore.js";

interface FakeClientOptions {
  capabilities?: string[];
  sessionsById?: Map<string, SessionInfo>;
  onRuntimeCommand?: (
    sessionId: string,
    command: RuntimeCommand,
    args: string[],
  ) => Promise<{
    session_id: string;
    command: RuntimeCommand;
    data: unknown;
    message: string;
  }>;
}

class FakeRayucodeClient extends EventEmitter {
  closed = false;
  readonly capabilities: string[];
  readonly cancelledSessions: string[] = [];
  readonly permissionResponses: Array<{
    sessionId: string;
    requestId: string;
    decision: string;
  }> = [];
  readonly sentMessages: Array<{ sessionId: string; content: string }> = [];
  readonly runtimeCommands: Array<{
    sessionId: string;
    command: RuntimeCommand;
    args: string[];
  }> = [];
  readonly softInterruptCalls: Array<{
    sessionId: string;
    content: string;
    options?: {
      clientId?: string;
      images?: Array<[string, string]>;
      urgent?: boolean;
    };
  }> = [];
  readonly cancelByIdCalls: Array<{ sessionId: string; clientIds: string[] }> = [];
  readonly cancelAllCalls: string[] = [];
  readonly createdSessions: SessionInfo[] = [];
  readonly setModelCalls: Array<{ sessionId: string; model: string }> = [];
  readonly setEffortCalls: Array<{ sessionId: string; effort: string }> = [];
  readonly setPermissionModeCalls: Array<{ sessionId: string; mode: string }> = [];
  readonly attachCalls: string[] = [];
  readonly historyCalls: string[] = [];
  readonly importExternalCalls: Array<{
    items: Array<{
      source: string;
      external_session_id: string;
      external_path?: string;
      working_dir?: string;
    }>;
    forkOnConflict?: boolean;
  }> = [];
  readonly authNotifyCalls: string[] = [];
  readonly archiveSessionCalls: string[] = [];
  readonly restoreSessionCalls: string[] = [];
  throwTimeoutOnControl = false;
  throwBusyOnControl = false;
  onImportExternalSessions?: (
    items: Array<{
      source: string;
      external_session_id: string;
      external_path?: string;
      working_dir?: string;
    }>,
    opts?: { forkOnConflict?: boolean },
  ) => Promise<{
    sessions: SessionInfo[];
    skipped: Array<{
      source: string;
      external_session_id: string;
      reason: string;
      message?: string;
      existing_session_id?: string;
    }>;
  }>;

  private readonly sessionsById: Map<string, SessionInfo>;
  private createSeq = 0;

  constructor(private readonly opts: FakeClientOptions = {}) {
    super();
    this.sessionsById = opts.sessionsById ?? new Map<string, SessionInfo>();
    this.capabilities = opts.capabilities ?? [
      "permissions",
      "file_changes",
      "soft_interrupt_ids",
    ];
  }

  supports(cap: string): boolean {
    return this.capabilities.includes(cap);
  }

  async createSession(opts?: { workingDir?: string }): Promise<SessionInfo> {
    this.createSeq += 1;
    const id = `sess_created_${this.sessionsById.size + this.createSeq}`;
    const info: SessionInfo = {
      session_id: id,
      title: `Session ${id}`,
      working_dir: opts?.workingDir ?? "/workspace",
      status: "idle",
      updated_at_ms: Date.now(),
    };
    this.sessionsById.set(id, info);
    this.createdSessions.push(info);
    return info;
  }

  async attachSession(sessionId: string): Promise<SessionInfo> {
    this.attachCalls.push(sessionId);
    const existing = this.sessionsById.get(sessionId);
    if (existing) return existing;
    const info: SessionInfo = {
      session_id: sessionId,
      title: `Session ${sessionId}`,
      working_dir: "/workspace",
      status: "idle",
      updated_at_ms: Date.now(),
    };
    this.sessionsById.set(sessionId, info);
    return info;
  }

  async getHistory(sessionId: string): Promise<Array<Record<string, unknown>>> {
    this.historyCalls.push(sessionId);
    return [{ role: "user", content: `History for ${sessionId}` }];
  }

  async getHistoryWithImages(sessionId: string): Promise<{
    messages: Array<Record<string, unknown>>;
    images: Array<Record<string, unknown>>;
  }> {
    this.historyCalls.push(sessionId);
    return {
      messages: [{ role: "user", content: `History for ${sessionId}` }],
      images: [],
    };
  }

  async importExternalSessions(
    items: Array<{
      source: string;
      external_session_id: string;
      external_path?: string;
      working_dir?: string;
    }>,
    opts?: { forkOnConflict?: boolean },
  ): Promise<{
    sessions: SessionInfo[];
    skipped: Array<{
      source: string;
      external_session_id: string;
      reason: string;
      message?: string;
      existing_session_id?: string;
    }>;
  }> {
    this.importExternalCalls.push({
      items,
      forkOnConflict: opts?.forkOnConflict,
    });
    if (this.onImportExternalSessions) {
      return this.onImportExternalSessions(items, opts);
    }
    const sessions: SessionInfo[] = items.map((item) => {
      const id = `imported_${item.source}_${item.external_session_id}`;
      const info: SessionInfo = {
        session_id: id,
        title: `Imported ${item.source}`,
        working_dir: item.working_dir ?? "/workspace",
        status: "idle",
        updated_at_ms: Date.now(),
        source: item.source as SessionInfo["source"],
        external_session_id: item.external_session_id,
        imported: true,
      };
      this.sessionsById.set(id, info);
      return info;
    });
    return { sessions, skipped: [] };
  }

  async listSessions(): Promise<SessionInfo[]> {
    return Array.from(this.sessionsById.values());
  }

  async getRuntimeInfo(sessionId: string) {
    return {
      server: "rayu-harness-api-bridge/1.14",
      protocolVersion: 1,
      capabilities: this.capabilities,
      healthy: true as const,
      sessionId,
      provider: "rayu",
      model: "claude-opus-4-6",
      providers: ["rayu"],
      routes: [],
    };
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    if (this.throwBusyOnControl) {
      throw new HarnessError("busy", "Session is busy processing a turn");
    }
    if (this.throwTimeoutOnControl) {
      throw new Error("timeout: no reply to set_permission_mode within 15000ms");
    }
    this.setPermissionModeCalls.push({ sessionId, mode });
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    if (this.throwTimeoutOnControl) {
      throw new Error("timeout: no reply to set_model within 15000ms");
    }
    this.setModelCalls.push({ sessionId, model });
  }

  async setReasoningEffort(sessionId: string, effort: string): Promise<void> {
    if (this.throwTimeoutOnControl) {
      throw new Error("timeout: no reply to set_reasoning_effort within 15000ms");
    }
    this.setEffortCalls.push({ sessionId, effort });
  }
  async setSessionSaved(): Promise<void> {}
  async archiveSession(sessionId: string): Promise<void> {
    this.archiveSessionCalls.push(sessionId);
  }
  async restoreSession(sessionId: string): Promise<void> {
    this.restoreSessionCalls.push(sessionId);
  }

  async notifyAuthChanged(provider: string): Promise<void> {
    this.authNotifyCalls.push(provider);
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    this.sentMessages.push({ sessionId, content });
  }

  async sendMessageWithReminder(
    sessionId: string,
    content: string,
  ): Promise<void> {
    this.sentMessages.push({ sessionId, content });
  }

  async cancel(sessionId: string): Promise<void> {
    this.cancelledSessions.push(sessionId);
  }

  async respondToPermission(
    sessionId: string,
    requestId: string,
    decision: string,
  ): Promise<void> {
    this.permissionResponses.push({ sessionId, requestId, decision });
  }

  async getFileChanges() {
    return { files: [] };
  }

  async runtimeCommand(
    sessionId: string,
    command: RuntimeCommand,
    args: string[] = [],
  ) {
    this.runtimeCommands.push({ sessionId, command, args });
    if (this.opts.onRuntimeCommand) {
      return this.opts.onRuntimeCommand(sessionId, command, args);
    }
    return {
      session_id: sessionId,
      command,
      data: { tasks: [] },
      message: "ok",
    };
  }

  async softInterruptWithId(
    sessionId: string,
    content: string,
    options?: {
      clientId?: string;
      images?: Array<[string, string]>;
      urgent?: boolean;
    },
  ): Promise<void> {
    this.softInterruptCalls.push({ sessionId, content, options });
  }

  async cancelSoftInterruptsById(
    sessionId: string,
    clientIds: string[],
  ): Promise<{ cancelled: string[]; notQueued: string[] }> {
    this.cancelByIdCalls.push({ sessionId, clientIds });
    return { cancelled: clientIds, notQueued: [] };
  }

  async cancelSoftInterrupts(sessionId: string): Promise<void> {
    this.cancelAllCalls.push(sessionId);
  }

  emitFrame(frame: ServerFrame): void {
    this.emit("event", frame);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

class FakeBridgeManager extends EventEmitter implements SessionHubBridgeLike {
  readonly dialedClients: FakeRayucodeClient[] = [];
  readonly controlClient: FakeRayucodeClient;
  private readonly sharedClient?: FakeRayucodeClient;
  private readonly clientOpts: FakeClientOptions;

  constructor(options: {
    sessionsById?: Map<string, SessionInfo>;
    sharedClient?: FakeRayucodeClient;
    capabilities?: string[];
  } = {}) {
    super();
    this.sharedClient = options.sharedClient;
    this.clientOpts = {
      sessionsById: options.sessionsById ?? new Map<string, SessionInfo>(),
      capabilities: options.capabilities,
    };
    this.controlClient =
      options.sharedClient ?? new FakeRayucodeClient(this.clientOpts);
  }

  getStatus() {
    return {
      state: "connected" as const,
      version: "rayu-harness-api-bridge/1.14",
      capabilities: this.controlClient.capabilities,
    };
  }

  getActiveClient(): RayucodeClient | null {
    return this.controlClient as unknown as RayucodeClient;
  }

  async ensureConnected(): Promise<RayucodeClient> {
    return this.controlClient as unknown as RayucodeClient;
  }

  async dialClient(): Promise<RayucodeClient> {
    if (this.sharedClient) {
      this.dialedClients.push(this.sharedClient);
      return this.sharedClient as unknown as RayucodeClient;
    }
    const client = new FakeRayucodeClient(this.clientOpts);
    this.dialedClients.push(client);
    return client as unknown as RayucodeClient;
  }
}

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createHostAdapter(initial: {
  folders: SessionHubWorkspaceFolder[];
  state?: Record<string, unknown>;
}) {
  const stateMap = new Map<string, unknown>(Object.entries(initial.state ?? {}));
  let folders = [...initial.folders];
  const folderListeners = new Set<() => void>();

  const adapter: SessionHubHostAdapter = {
    workspaceState: {
      get<T>(key: string, defaultValue?: T): T {
        return (stateMap.has(key) ? stateMap.get(key) : defaultValue) as T;
      },
      update(key: string, value: unknown) {
        stateMap.set(key, value);
      },
    },
    getWorkspaceFolders: () => folders,
    getDefaultPermissionModeRaw: () => "default",
    onDidChangeWorkspaceFolders: (listener) => {
      folderListeners.add(listener);
      return {
        dispose: () => {
          folderListeners.delete(listener);
        },
      };
    },
  };

  return {
    adapter,
    setFolders(next: SessionHubWorkspaceFolder[]) {
      folders = next;
      for (const fn of folderListeners) fn();
    },
  };
}

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

test("SessionHubCore preserves active-turn and pending-permission sockets across session switches and routes cancel/permission to the pooled client", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-pool-");
  const wsPath = path.join(tmpDir, "repo-alpha");
  fs.mkdirSync(wsPath, { recursive: true });
  const registryPath = path.join(tmpDir, "workspaces.json");
  const registry = new WorkspaceRegistry({
    filePath: registryPath,
    enableWatch: false,
  });

  const sessionsById = new Map<string, SessionInfo>([
    [
      "sess_a",
      {
        session_id: "sess_a",
        title: "Session A",
        working_dir: wsPath,
        status: "idle",
      },
    ],
    [
      "sess_b",
      {
        session_id: "sess_b",
        title: "Session B",
        working_dir: wsPath,
        status: "idle",
      },
    ],
  ]);

  const bridge = new FakeBridgeManager({ sessionsById });
  const { adapter } = createHostAdapter({
    folders: [{ name: "repo-alpha", fsPath: wsPath }],
  });
  const hub = new SessionHubCore(adapter, bridge, {
    workspaceRegistry: registry,
    maxIdleClients: 6,
  });

  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await hub.waitUntilWorkspacesReady();

  const broadcasted: HostToWebviewMessage[] = [];
  hub.registerSurface("surf-1", "editorPanel", (msg) => broadcasted.push(msg));

  // Attach Session A and start a live turn
  await hub.attachSession("sess_a");
  const clientA = bridge.dialedClients[0]!;
  assert.ok(clientA);

  await hub.handleHarnessRequest(
    { id: 1, req: "send_message", session_id: "sess_a", content: "Run check" },
    () => {},
  );
  clientA.emit("event", { ev: "turn_start" });
  clientA.emit("event", {
    ev: "permission_request",
    request_id: "perm_1",
    tool_name: "bash",
    description: "Run tests?",
  });

  // Switch focus to Session B — Session A's socket MUST stay alive!
  await hub.attachSession("sess_b");
  const clientB = bridge.dialedClients[1]!;
  assert.ok(clientB);
  assert.equal(
    clientA.closed,
    false,
    "Session A socket must remain open while streaming/waiting",
  );
  assert.equal(hub.getActiveSessionId(), "sess_b");

  // Background stream frames on Session A must still reach the webview with bound session_id
  clientA.emit("event", { ev: "text_delta", text: "Background chunk from A" });
  const bgFrame = broadcasted.find(
    (m) =>
      m.type === "rayucode.harness.frame" &&
      m.frame.ev === "text_delta" &&
      m.frame.text === "Background chunk from A",
  );
  assert.ok(
    bgFrame,
    "Background text_delta from Session A must broadcast to webview",
  );
  if (bgFrame.type === "rayucode.harness.frame") {
    assert.equal(bgFrame.frame.session_id, "sess_a");
  }

  // Permission response & cancel for Session A must route to clientA, NOT clientB
  await hub.respondPermission({
    sessionId: "sess_a",
    requestId: "perm_1",
    decision: "allow_once",
  });
  assert.deepEqual(clientA.permissionResponses, [
    { sessionId: "sess_a", requestId: "perm_1", decision: "allow" },
  ]);
  assert.equal(clientB.permissionResponses.length, 0);

  await hub.cancelSession("sess_a");
  assert.deepEqual(clientA.cancelledSessions, ["sess_a"]);
  assert.equal(clientB.cancelledSessions.length, 0);

  // Unexpected close of active socket A emits synthetic turn_stopped with session_id
  clientA.close();
  const synthStop = broadcasted.find(
    (m) =>
      m.type === "rayucode.harness.frame" &&
      m.frame.ev === "turn_stopped" &&
      m.frame.session_id === "sess_a" &&
      m.frame.reason === "failure",
  );
  assert.ok(
    synthStop,
    "Unexpected socket close during active turn must synthesize turn_stopped",
  );
});

test("SessionHubCore migrates legacy workspaceState pins/archives, tracks folder changes, attaches new sessions on send_message, and pushes external workspaces.json updates", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-ws-");
  const wsOne = path.join(tmpDir, "ws-one");
  const wsTwo = path.join(tmpDir, "ws-two");
  const wsExternal = path.join(tmpDir, "ws-external");
  fs.mkdirSync(wsOne, { recursive: true });
  fs.mkdirSync(wsTwo, { recursive: true });
  fs.mkdirSync(wsExternal, { recursive: true });

  const registryPath = path.join(tmpDir, "workspaces.json");
  const registry = new WorkspaceRegistry({
    filePath: registryPath,
    enableWatch: true,
    watchDebounceMs: 25,
  });

  const sessionsById = new Map<string, SessionInfo>();
  const bridge = new FakeBridgeManager({ sessionsById });
  const { adapter, setFolders } = createHostAdapter({
    folders: [{ name: "ws-one", fsPath: wsOne }],
    state: {
      [PINNED_SESSIONS_KEY]: { ses_legacy_pin: true, ses_not_pinned: false },
      [ARCHIVED_SESSIONS_KEY]: { ses_legacy_arch: true },
    },
  });

  const hub = new SessionHubCore(adapter, bridge, {
    workspaceRegistry: registry,
  });

  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const ledgerEvents: HostToWebviewMessage[] = [];
  hub.registerSurface("surf-ws", "sidebar", (msg) => {
    if (msg.type === "rayucode.workspaces.ledgerChanged") {
      ledgerEvents.push(msg);
    }
  });

  const initialLedger = await hub.waitUntilWorkspacesReady();
  assert.ok(initialLedger.pinnedSessionIds.includes("ses_legacy_pin"));
  assert.ok(!initialLedger.pinnedSessionIds.includes("ses_not_pinned"));
  assert.ok(initialLedger.archivedSessionIds.includes("ses_legacy_arch"));
  assert.equal(initialLedger.workspaces.length, 1);
  assert.equal(initialLedger.workspaces[0]?.name, "ws-one");
  assert.deepEqual(initialLedger.openFolderPaths, [wsOne]);

  // Workspace folder change ensures new folder in canonical ledger
  setFolders([
    { name: "ws-one", fsPath: wsOne },
    { name: "ws-two", fsPath: wsTwo },
  ]);
  await new Promise((r) => setTimeout(r, 80));
  const afterFolderAdd = hub.getWorkspaceLedger();
  assert.equal(afterFolderAdd.workspaces.length, 2);
  assert.ok(afterFolderAdd.workspaces.some((w) => w.name === "ws-two"));

  // Creating a session and running send_message attaches sessionId to workingDir in ledger
  const created = await hub.createSession({ workingDir: wsTwo });
  await hub.handleHarnessRequest(
    {
      id: 2,
      req: "send_message",
      session_id: created.sessionId,
      content: "First message in ws-two",
    },
    () => {},
  );
  const afterSend = await hub.loadWorkspaceLedger();
  const wsTwoRecord = afterSend.workspaces.find((w) => w.name === "ws-two");
  assert.ok(wsTwoRecord?.sessionIds.includes(created.sessionId));

  // External update to workspaces.json via a second WorkspaceRegistry pushes update to webview
  const externalWriter = new WorkspaceRegistry({
    filePath: registryPath,
    enableWatch: false,
  });
  const countBefore = ledgerEvents.length;
  await externalWriter.ensureWorkspace(wsExternal, { name: "ws-external" });
  externalWriter.dispose();

  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const latest = ledgerEvents
      .slice(countBefore)
      .find(
        (m) =>
          m.type === "rayucode.workspaces.ledgerChanged" &&
          m.ledger.workspaces.some((w) => w.name === "ws-external"),
      );
    if (latest) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const externalPush = ledgerEvents
    .slice(countBefore)
    .find(
      (m) =>
        m.type === "rayucode.workspaces.ledgerChanged" &&
        m.ledger.workspaces.some((w) => w.name === "ws-external"),
    );
  assert.ok(
    externalPush,
    "External ~/.rayu/workspaces.json write must push ledgerChanged to webview",
  );
});

test("SessionHub isolates background tasks per session across refresh, progress frames, cleanup, and session switches", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-bg-");
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const tasksByDaemonSession = new Map<string, Array<Record<string, unknown>>>([
    [
      "sess_a",
      [
        {
          task_id: "bg_a1",
          session_id: "sess_a",
          tool_name: "bash",
          display_name: "cargo test -p a",
          status: "running",
          percent: 40,
          summary: "Running A tests",
          started_at_ms: 1000,
          updated_at_ms: 1500,
        },
        {
          // Explicit wrong session ID must be dropped defensively
          task_id: "bg_leak_from_b",
          session_id: "sess_b",
          tool_name: "bash",
          display_name: "other session task",
          status: "running",
          started_at_ms: 1000,
          updated_at_ms: 1600,
        },
        {
          // CamelCase wrong sessionId must also be dropped
          task_id: "bg_leak_from_c",
          sessionId: "sess_c",
          tool_name: "bash",
          display_name: "third session task",
          status: "completed",
          started_at_ms: 1000,
          updated_at_ms: 1700,
        },
        {
          // Missing explicit session_id falls back to targetSessionId
          task_id: "bg_a2_done",
          tool_name: "bash",
          display_name: "cargo check",
          status: "completed",
          started_at_ms: 900,
          updated_at_ms: 1200,
        },
      ],
    ],
    [
      "sess_b",
      [
        {
          task_id: "bg_b1",
          session_id: "sess_b",
          tool_name: "bash",
          display_name: "npm run build",
          status: "completed",
          started_at_ms: 2000,
          updated_at_ms: 2500,
        },
      ],
    ],
  ]);

  const client = new FakeRayucodeClient({
    capabilities: ["permissions", "soft_interrupt_ids"],
    onRuntimeCommand: async (sessionId, command, args) => {
      if (command === "background" && args[0] === "list") {
        return {
          session_id: sessionId,
          command,
          data: { tasks: tasksByDaemonSession.get(sessionId) ?? [] },
          message: "ok",
        };
      }
      return { session_id: sessionId, command, data: {}, message: "ok" };
    },
  });

  const { adapter } = createHostAdapter({ folders: [] });
  const hub = new SessionHubCore(
    adapter,
    new FakeBridgeManager({ sharedClient: client }),
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const snapshots: Array<
    Extract<HostToWebviewMessage, { type: "rayucode.processes.snapshot" }>
  > = [];
  hub.registerSurface("sidebar-main", "sidebar", (msg) => {
    if (msg.type === "rayucode.processes.snapshot") {
      snapshots.push(msg);
    }
  });

  // 1. With no active session, refreshBackgroundProcesses returns [] and NEVER calls runtimeCommand or creates a session
  const emptyRefresh = await hub.refreshBackgroundProcesses();
  assert.deepEqual(emptyRefresh, []);
  assert.equal(client.runtimeCommands.length, 0);
  assert.equal(client.createdSessions.length, 0);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.sessionId, undefined);
  assert.deepEqual(snapshots[0]?.tasks, []);

  // 2. Attach sess_a -> immediately broadcasts empty snapshot then refreshes with ["list", "session"]
  snapshots.length = 0;
  await hub.attachSession("sess_a");
  await flushMicrotasks();

  const listCmd = client.runtimeCommands.find(
    (c) => c.command === "background" && c.sessionId === "sess_a",
  );
  assert.deepEqual(listCmd?.args, ["list", "session"]);

  // Defensive host filtering drops bg_leak_from_b and bg_leak_from_c, keeps bg_a1 and bg_a2_done
  const sessATasks = hub.getBackgroundTasks();
  assert.deepEqual(
    sessATasks.map((task) => `${task.taskId}:${task.sessionId}`),
    ["bg_a1:sess_a", "bg_a2_done:sess_a"],
  );
  assert.equal(snapshots.at(-1)?.sessionId, "sess_a");
  assert.deepEqual(
    snapshots.at(-1)?.tasks.map((task) => task.taskId),
    ["bg_a1", "bg_a2_done"],
  );

  // 3. background_progress from ANOTHER session does NOT leak into active session snapshot
  const snapshotsBeforeForeign = snapshots.length;
  client.emitFrame({
    v: 1,
    ev: "background_progress",
    session_id: "sess_b",
    task_id: "bg_b_live",
    label: "Foreign build",
    percent: 75,
    summary: "Building foreign repo",
    done: false,
  });
  assert.equal(snapshots.length, snapshotsBeforeForeign);
  assert.deepEqual(
    hub.getBackgroundTasks().map((task) => task.taskId),
    ["bg_a1", "bg_a2_done"],
  );
  assert.deepEqual(
    hub
      .getBackgroundTasks("sess_b")
      .map((task) => `${task.taskId}:${task.sessionId}`),
    ["bg_b_live:sess_b"],
  );

  // 4. Refreshing a non-active session stores its tasks without overwriting active session broadcast
  const snapshotsBeforeOtherRefresh = snapshots.length;
  const sessBRefreshed = await hub.refreshBackgroundProcesses("sess_b");
  assert.equal(snapshots.length, snapshotsBeforeOtherRefresh);
  assert.deepEqual(
    sessBRefreshed.map((task) => task.taskId),
    ["bg_b1"],
  );
  assert.deepEqual(
    hub.getBackgroundTasks("sess_a").map((task) => task.taskId),
    ["bg_a1", "bg_a2_done"],
  );

  // 5. removeCompletedBackgroundTasks removes only completed tasks for the target session
  const removedA = hub.removeCompletedBackgroundTasks("sess_a");
  assert.equal(removedA, 1);
  assert.deepEqual(
    hub.getBackgroundTasks("sess_a").map((task) => task.taskId),
    ["bg_a1"],
  );
  assert.deepEqual(
    hub.getBackgroundTasks("sess_b").map((task) => task.taskId),
    ["bg_b1"],
  );

  // 6. Creating a new session clears background tasks immediately with empty snapshot
  snapshots.length = 0;
  const created = await hub.createSession({ workingDir: "/workspace" });
  assert.equal(hub.getActiveSessionId(), created.sessionId);
  assert.deepEqual(hub.getBackgroundTasks(), []);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.sessionId, created.sessionId);
  assert.deepEqual(snapshots[0]?.tasks, []);

  // 7. handleHarnessRequest("attach_session") switches cleanly to sess_b and refreshes sess_b
  snapshots.length = 0;
  const replies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    { id: 10, req: "attach_session", session_id: "sess_b" },
    (reply) => replies.push(reply),
  );
  await flushMicrotasks();
  assert.equal(replies[0]?.ev, "attached");
  assert.equal(hub.getActiveSessionId(), "sess_b");
  assert.equal(snapshots[0]?.sessionId, "sess_b");
  assert.deepEqual(
    hub.getBackgroundTasks().map((task) => task.taskId),
    ["bg_b1"],
  );

  // 8. handleHarnessRequest("create_session") starts fresh empty map and clears previous session's tasks
  snapshots.length = 0;
  await hub.handleHarnessRequest({ id: 11, req: "create_session" }, (reply) =>
    replies.push(reply),
  );
  assert.deepEqual(hub.getBackgroundTasks(), []);
  assert.equal(snapshots[0]?.sessionId, hub.getActiveSessionId());
  assert.deepEqual(snapshots[0]?.tasks, []);
});

test("SessionHub streaming state aligns with Rust Harness API v1.14 events and distinguishes reply vs stream errors", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-stream-");
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const client = new FakeRayucodeClient({
    capabilities: ["permissions", "soft_interrupt_ids"],
  });
  const { adapter } = createHostAdapter({ folders: [] });
  const hub = new SessionHubCore(
    adapter,
    new FakeBridgeManager({ sharedClient: client }),
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await hub.attachSession("sess_stream");
  assert.equal(hub.getIsTurnStreaming(), false);

  // reasoning_delta activates streaming; turn_stopped clears it
  client.emitFrame({
    v: 1,
    ev: "reasoning_delta",
    session_id: "sess_stream",
    text: "Thinking...",
  });
  assert.equal(hub.getIsTurnStreaming(), true);
  client.emitFrame({
    v: 1,
    ev: "turn_stopped",
    session_id: "sess_stream",
    reason: "interrupted",
    message: "Stopped",
  });
  assert.equal(hub.getIsTurnStreaming(), false);

  // tool_exec and tool_call activate streaming; turn_done clears it
  client.emitFrame({
    v: 1,
    ev: "tool_exec",
    session_id: "sess_stream",
    call_id: "call_1",
    name: "bash",
  });
  assert.equal(hub.getIsTurnStreaming(), true);
  client.emitFrame({ v: 1, ev: "turn_done", session_id: "sess_stream" });
  assert.equal(hub.getIsTurnStreaming(), false);

  client.emitFrame({
    v: 1,
    ev: "tool_call",
    session_id: "sess_stream",
    call_id: "call_2",
    name: "custom_tool",
    input: {},
  });
  assert.equal(hub.getIsTurnStreaming(), true);

  // Request-level RPC reply error (with reply_to) MUST NOT flip active stream to idle
  client.emitFrame({
    v: 1,
    reply_to: 99,
    ev: "error",
    code: "invalid_request",
    message: "Unknown model",
  });
  assert.equal(hub.getIsTurnStreaming(), true);

  // Stream-level error (no reply_to) MUST flip streaming to idle
  client.emitFrame({
    v: 1,
    ev: "error",
    code: "internal",
    message: "Provider disconnected",
  });
  assert.equal(hub.getIsTurnStreaming(), false);

  // soft_interrupt_injected activates streaming
  client.emitFrame({
    v: 1,
    ev: "soft_interrupt_injected",
    session_id: "sess_stream",
    client_ids: ["si_1"],
    point: "D",
  });
  assert.equal(hub.getIsTurnStreaming(), true);

  // session_status transitions
  client.emitFrame({
    v: 1,
    ev: "session_status",
    session_id: "sess_stream",
    status: "idle",
  });
  assert.equal(hub.getIsTurnStreaming(), false);

  for (const activeStatus of ["generating", "tool_running", "running", "busy"]) {
    client.emitFrame({
      v: 1,
      ev: "session_status",
      session_id: "sess_stream",
      status: activeStatus,
    });
    assert.equal(
      hub.getIsTurnStreaming(),
      true,
      `status ${activeStatus} should set streaming`,
    );
    client.emitFrame({
      v: 1,
      ev: "session_status",
      session_id: "sess_stream",
      status: "idle",
    });
    assert.equal(hub.getIsTurnStreaming(), false);
  }
});

test("SessionHub handleHarnessRequest routes soft_interrupt and cancel_soft_interrupts with capability awareness", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-si-");
  const registryWithIds = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces-ids.json"),
    enableWatch: false,
  });
  const registryLegacy = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces-legacy.json"),
    enableWatch: false,
  });

  const clientWithIds = new FakeRayucodeClient({
    capabilities: ["permissions", "soft_interrupt_ids"],
  });
  const hubWithIds = new SessionHubCore(
    createHostAdapter({ folders: [] }).adapter,
    new FakeBridgeManager({ sharedClient: clientWithIds }),
    { workspaceRegistry: registryWithIds },
  );

  const legacyClient = new FakeRayucodeClient({
    capabilities: ["permissions"],
  });
  const legacyHub = new SessionHubCore(
    createHostAdapter({ folders: [] }).adapter,
    new FakeBridgeManager({ sharedClient: legacyClient }),
    { workspaceRegistry: registryLegacy },
  );

  t.after(() => {
    hubWithIds.dispose();
    legacyHub.dispose();
    registryWithIds.dispose();
    registryLegacy.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await hubWithIds.attachSession("sess_si");

  const replies: Array<Record<string, unknown>> = [];
  await hubWithIds.handleHarnessRequest(
    {
      id: 21,
      req: "soft_interrupt",
      session_id: "sess_si",
      content: "Also check edge cases",
      client_id: "steer_1",
      images: [{ mediaType: "image/png", data: "data:image/png;base64,QUJD" }],
    },
    (reply) => replies.push(reply),
  );
  assert.deepEqual(replies[0], { v: 1, reply_to: 21, ev: "ok" });
  assert.deepEqual(clientWithIds.softInterruptCalls, [
    {
      sessionId: "sess_si",
      content: "Also check edge cases",
      options: {
        urgent: false,
        clientId: "steer_1",
        images: [["image/png", "QUJD"]],
      },
    },
  ]);

  await hubWithIds.handleHarnessRequest(
    {
      id: 22,
      req: "cancel_soft_interrupts",
      session_id: "sess_si",
      client_ids: ["steer_1"],
    },
    (reply) => replies.push(reply),
  );
  assert.deepEqual(replies[1], {
    v: 1,
    reply_to: 22,
    ev: "soft_interrupts_cancelled",
    cancelled: ["steer_1"],
    not_queued: [],
  });
  assert.deepEqual(clientWithIds.cancelByIdCalls, [
    { sessionId: "sess_si", clientIds: ["steer_1"] },
  ]);

  // Legacy bridge without soft_interrupt_ids falls back to cancelSoftInterrupts
  await legacyHub.attachSession("sess_legacy");

  const legacyReplies: Array<Record<string, unknown>> = [];
  await legacyHub.handleHarnessRequest(
    {
      id: 31,
      req: "cancel_soft_interrupts",
      session_id: "sess_legacy",
      client_ids: ["steer_legacy"],
    },
    (reply) => legacyReplies.push(reply),
  );
  assert.deepEqual(legacyReplies[0], { v: 1, reply_to: 31, ev: "ok" });
  assert.deepEqual(legacyClient.cancelByIdCalls, []);
  assert.deepEqual(legacyClient.cancelAllCalls, ["sess_legacy"]);
});

test("SessionHub defers mid-turn set_model and set_reasoning_effort without timeout errors and applies them for the next message", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-midturn-settings-");
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const client = new FakeRayucodeClient({
    capabilities: ["permissions", "soft_interrupt_ids"],
  });
  const hub = new SessionHubCore(
    createHostAdapter({ folders: [] }).adapter,
    new FakeBridgeManager({ sharedClient: client }),
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await hub.attachSession("sess_busy_opts");

  // Simulate an active streaming turn on sess_busy_opts
  client.emitFrame({
    v: 1,
    ev: "turn_start",
    session_id: "sess_busy_opts",
  });
  assert.equal(hub.getIsTurnStreaming(), true);

  // Changing model & reasoning effort mid-turn MUST NOT hit the busy daemon or error
  const replies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 41,
      req: "set_model",
      session_id: "sess_busy_opts",
      model: "rayu:claude-opus-4-6",
    },
    (reply) => replies.push(reply),
  );
  await hub.handleHarnessRequest(
    {
      id: 42,
      req: "set_reasoning_effort",
      session_id: "sess_busy_opts",
      effort: "high",
    },
    (reply) => replies.push(reply),
  );

  assert.deepEqual(replies[0], {
    v: 1,
    reply_to: 41,
    ev: "ok",
    deferred: true,
  });
  assert.deepEqual(replies[1], {
    v: 1,
    reply_to: 42,
    ev: "ok",
    deferred: true,
  });
  assert.equal(client.setModelCalls.length, 0);
  assert.equal(client.setEffortCalls.length, 0);

  // When the active turn finishes, deferred settings flush cleanly
  client.emitFrame({
    v: 1,
    ev: "turn_done",
    session_id: "sess_busy_opts",
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(client.setModelCalls, [
    { sessionId: "sess_busy_opts", model: "rayu:claude-opus-4-6" },
  ]);
  assert.deepEqual(client.setEffortCalls, [
    { sessionId: "sess_busy_opts", effort: "high" },
  ]);

  // Sending next message with the same effort/model does NOT fire redundant setReasoningEffort/setModel calls
  client.setModelCalls.length = 0;
  client.setEffortCalls.length = 0;
  await hub.handleHarnessRequest(
    {
      id: 43,
      req: "send_message",
      session_id: "sess_busy_opts",
      content: "Next turn prompt",
      model: "rayu:claude-opus-4-6",
      effort: "high",
    },
    (reply) => replies.push(reply),
  );
  assert.equal(client.setModelCalls.length, 0);
  assert.equal(client.setEffortCalls.length, 0);
  assert.equal(client.sentMessages.length, 1);

  // Even if the daemon times out on an idle set_reasoning_effort (externally busy), defer without error
  client.emitFrame({
    v: 1,
    ev: "turn_done",
    session_id: "sess_busy_opts",
  });
  client.throwTimeoutOnControl = true;
  const timeoutReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 44,
      req: "set_reasoning_effort",
      session_id: "sess_busy_opts",
      effort: "xhigh",
    },
    (reply) => timeoutReplies.push(reply),
  );
  assert.deepEqual(timeoutReplies[0], {
    v: 1,
    reply_to: 44,
    ev: "ok",
    deferred: true,
  });

  // Once daemon becomes free, next send_message without explicit effort applies the deferred effort ("xhigh")
  client.throwTimeoutOnControl = false;
  await hub.handleHarnessRequest(
    {
      id: 45,
      req: "send_message",
      session_id: "sess_busy_opts",
      content: "Follow-up prompt using deferred effort",
    },
    (reply) => timeoutReplies.push(reply),
  );
  assert.deepEqual(client.setEffortCalls, [
    { sessionId: "sess_busy_opts", effort: "xhigh" },
  ]);

  // And when explicit effort IS supplied on send_message, requested.effort overrides an older deferred pendingEffort
  client.emitFrame({ v: 1, ev: "turn_done", session_id: "sess_busy_opts" });
  client.throwTimeoutOnControl = true;
  await hub.handleHarnessRequest(
    {
      id: 46,
      req: "set_reasoning_effort",
      session_id: "sess_busy_opts",
      effort: "max",
    },
    (reply) => timeoutReplies.push(reply),
  );
  client.throwTimeoutOnControl = false;
  client.setEffortCalls.length = 0;
  await hub.handleHarnessRequest(
    {
      id: 47,
      req: "send_message",
      session_id: "sess_busy_opts",
      content: "Follow-up prompt overriding deferred effort",
      effort: "medium",
    },
    (reply) => timeoutReplies.push(reply),
  );
  assert.deepEqual(client.setEffortCalls, [
    { sessionId: "sess_busy_opts", effort: "medium" },
  ]);
});

test("SessionHubCore remembers effort, permissionMode, and model independently per session and defers mid-turn permission changes", async () => {
  const sessionsById = new Map<string, SessionInfo>();
  const clients: FakeRayucodeClient[] = [];
  const stateStore = new Map<string, unknown>();
  const workspaceState = {
    get<T>(key: string, defaultValue?: T): T {
      return stateStore.has(key) ? (stateStore.get(key) as T) : (defaultValue as T);
    },
    async update(key: string, value: unknown): Promise<void> {
      stateStore.set(key, value);
    },
  };
  const bridge = Object.assign(new EventEmitter(), {
    getStatus: () => ({ state: "connected" as const, capabilities: ["permissions"] }),
    getActiveClient: () => (clients[0] as unknown as RayucodeClient) ?? null,
    ensureConnected: async () => {
      if (clients.length === 0) {
        clients.push(new FakeRayucodeClient({ sessionsById }));
      }
      return clients[0] as unknown as RayucodeClient;
    },
    dialClient: async () => {
      const c = new FakeRayucodeClient({ sessionsById });
      clients.push(c);
      return c as unknown as RayucodeClient;
    },
  }) as SessionHubBridgeLike;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-session-prefs-"));
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
  });
  const host: SessionHubHostAdapter = {
    workspaceState,
    getWorkspaceFolders: () => [{ name: "workspace", fsPath: "/workspace" }],
    getDefaultPermissionModeRaw: () => "default",
  };
  const hub = new SessionHubCore(host, bridge, { workspaceRegistry: registry });

  try {
    const sessA = await hub.createSession({
      workingDir: "/workspace",
      permissionMode: "acceptEdits",
      model: "rayu:claude-opus-4-6",
      effort: "high",
    });
    const sessB = await hub.createSession({
      workingDir: "/workspace",
      permissionMode: "plan",
      model: "rayu:claude-sonnet-4-5",
      effort: "low",
    });

    assert.equal(sessA.permissionMode, "acceptEdits");
    assert.equal(sessA.effort, "high");
    assert.equal(sessA.model, "rayu:claude-opus-4-6");

    assert.equal(sessB.permissionMode, "plan");
    assert.equal(sessB.effort, "low");
    assert.equal(sessB.model, "rayu:claude-sonnet-4-5");

    // Listing sessions preserves each session's own prefs without cross-session bleed
    const listed = await hub.listSessions();
    const listedA = listed.sessions.find((s) => s.sessionId === sessA.sessionId);
    const listedB = listed.sessions.find((s) => s.sessionId === sessB.sessionId);
    assert.equal(listedA?.permissionMode, "acceptEdits");
    assert.equal(listedA?.effort, "high");
    assert.equal(listedB?.permissionMode, "plan");
    assert.equal(listedB?.effort, "low");

    // Switching back to Session A restores Session A's permission mode and effort
    const reattachedA = await hub.attachSession(sessA.sessionId);
    assert.equal(reattachedA.permissionMode, "acceptEdits");
    assert.equal(reattachedA.effort, "high");
    assert.equal(hub.getActivePermissionMode(), "acceptEdits");

    // While Session A is actively streaming, changing permission mode applies immediately
    // (Rust daemon handles SetPermissionMode lock-free mid-turn).
    const clientA = clients[0]!;
    clientA.setPermissionModeCalls.length = 0;
    clientA.emitFrame({
      v: 1,
      ev: "turn_start",
      session_id: sessA.sessionId,
    });
    const permRes = await hub.setPermissionMode(sessA.sessionId, "fullManage");
    assert.deepEqual(permRes, { ok: true, mode: "fullManage" });
    assert.deepEqual(clientA.setPermissionModeCalls, [
      { sessionId: sessA.sessionId, mode: "full_manage" },
    ]);
    assert.equal(hub.getSessionPrefs(sessA.sessionId)?.permissionMode, "fullManage");

    // If an older daemon times out mid-turn, setPermissionMode defers cleanly and flushes on turn_done
    clientA.setPermissionModeCalls.length = 0;
    clientA.throwTimeoutOnControl = true;
    const deferredPermRes = await hub.setPermissionMode(sessA.sessionId, "plan");
    assert.deepEqual(deferredPermRes, { ok: true, mode: "plan", deferred: true });
    assert.equal(clientA.setPermissionModeCalls.length, 0);
    assert.equal(hub.getSessionPrefs(sessA.sessionId)?.permissionMode, "fullManage");

    clientA.emitFrame({ v: 1, ev: "turn_done", session_id: sessA.sessionId });
    const rejected: Array<Record<string, unknown>> = [];
    await hub.handleHarnessRequest({
      id: 301,
      req: "send_message",
      session_id: sessA.sessionId,
      content: "Must not run without the requested permission",
    }, (frame) => rejected.push(frame));
    assert.equal(rejected[0]?.ev, "error");
    assert.equal(clientA.sentMessages.length, 0);
    assert.equal(hub.getSessionPrefs(sessA.sessionId)?.permissionMode, "fullManage");

    clientA.throwTimeoutOnControl = false;
    clientA.emitFrame({
      v: 1,
      ev: "turn_done",
      session_id: sessA.sessionId,
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(clientA.setPermissionModeCalls, [
      { sessionId: sessA.sessionId, mode: "plan" },
    ]);
  } finally {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionHubCore closes freshly dialed clients on failed attach and ignores sessionless daemon disconnect errors", async () => {
  const sessionsById = new Map<string, SessionInfo>();
  const dialedClients: FakeRayucodeClient[] = [];
  const stateStore = new Map<string, unknown>();
  const workspaceState = {
    get<T>(key: string, defaultValue?: T): T {
      return stateStore.has(key) ? (stateStore.get(key) as T) : (defaultValue as T);
    },
    async update(key: string, value: unknown): Promise<void> {
      stateStore.set(key, value);
    },
  };
  const primaryClient = new FakeRayucodeClient({ sessionsById });
  const bridge = Object.assign(new EventEmitter(), {
    getStatus: () => ({ state: "connected" as const, capabilities: ["permissions"] }),
    getActiveClient: () => primaryClient as unknown as RayucodeClient,
    ensureConnected: async () => primaryClient as unknown as RayucodeClient,
    dialClient: async () => {
      const c = new FakeRayucodeClient({ sessionsById });
      const origAttach = c.attachSession.bind(c);
      c.attachSession = async (sessionId: string) => {
        if (sessionId === "sess_runtime_owner_error") {
          throw new Error(
            "unknown_session: Failed to restore session: Session sess_runtime_owner_error still has a runtime owner",
          );
        }
        return origAttach(sessionId);
      };
      dialedClients.push(c);
      return c as unknown as RayucodeClient;
    },
  }) as SessionHubBridgeLike;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-session-disconnect-"));
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
  });
  const host: SessionHubHostAdapter = {
    workspaceState,
    getWorkspaceFolders: () => [{ name: "workspace", fsPath: "/workspace" }],
    getDefaultPermissionModeRaw: () => "default",
  };
  const hub = new SessionHubCore(host, bridge, { workspaceRegistry: registry });
  const broadcasted: HostToWebviewMessage[] = [];
  hub.registerSurface("webview-1", "sidebar", (msg) => {
    broadcasted.push(msg);
  });

  try {
    // Attempt to attach a session that fails restore -> dialed client must be closed immediately
    await assert.rejects(
      () => hub.attachSession("sess_runtime_owner_error"),
      /still has a runtime owner/,
    );
    const failedClient = dialedClients[0]!;
    assert.equal(failedClient.closed, true);

    // Create a healthy session and start streaming a turn
    const active = await hub.createSession({ workingDir: "/workspace" });
    const activeClient = dialedClients[1]!;
    activeClient.emitFrame({
      v: 1,
      ev: "turn_start",
      session_id: active.sessionId,
    });
    assert.equal(hub.getIsTurnStreaming(), true);
    broadcasted.length = 0;

    // Simulate delayed sessionless "daemon connection closed" arriving on the failed unbound socket
    // AND on the primary control bridge socket
    failedClient.emitFrame({
      v: 1,
      ev: "error",
      code: "internal",
      message: "daemon connection closed",
    });
    bridge.emit("frame", {
      v: 1,
      ev: "error",
      code: "internal",
      message: "daemon connection closed",
    } as ServerFrame);

    // Active session MUST remain streaming and receive zero phantom error broadcasts
    assert.equal(hub.getIsTurnStreaming(), true);
    const errorBroadcasts = broadcasted.filter(
      (msg) =>
        msg.type === "rayucode.harness.frame" &&
        (msg.frame as Record<string, unknown>).ev === "error",
    );
    assert.equal(errorBroadcasts.length, 0);
  } finally {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionHubCore refreshes and broadcasts rayucode.todos.updated on todo and batch tool_done events and normalizes all 4 statuses", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-todos-");
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const client = new FakeRayucodeClient({
    capabilities: ["todo_state"],
  });
  let todoPullCount = 0;
  (
    client as unknown as {
      todoState: (sessionId: string) => Promise<Record<string, unknown>>;
    }
  ).todoState = async () => {
    todoPullCount += 1;
    return {
      todos: [
        { id: "1", content: "Plan architecture", status: "done" },
        {
          id: "2",
          name: "Implement checklist",
          status: "running",
          active_form: "Implementing checklist",
          lane: "ui",
          phase: 2,
        },
        { id: "3", title: "Legacy step", status: "canceled" },
      ],
    };
  };

  const { adapter } = createHostAdapter({ folders: [] });
  const hub = new SessionHubCore(
    adapter,
    new FakeBridgeManager({ sharedClient: client }),
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const todoBroadcasts: Array<Extract<HostToWebviewMessage, { type: "rayucode.todos.updated" }>> = [];
  hub.registerSurface("webview-todos", "sidebar", (msg) => {
    if (msg.type === "rayucode.todos.updated") {
      todoBroadcasts.push(msg);
    }
  });

  await hub.attachSession("sess_todos");

  // 1. Direct todo tool_done triggers todoState pull and broadcasts normalized todos
  client.emitFrame({
    v: 1,
    ev: "tool_done",
    session_id: "sess_todos",
    call_id: "call_todo_1",
    name: "todo",
    output: "ok",
  });
  await flushMicrotasks();

  assert.equal(todoPullCount, 1);
  assert.equal(todoBroadcasts.length, 1);
  assert.equal(todoBroadcasts[0]?.sessionId, "sess_todos");
  assert.deepEqual(todoBroadcasts[0]?.todos, [
    { id: "1", content: "Plan architecture", status: "completed" },
    {
      id: "2",
      content: "Implement checklist",
      status: "in_progress",
      activeForm: "Implementing checklist",
      group: "ui",
      stage: 2,
    },
    { id: "3", content: "Legacy step", status: "cancelled" },
  ]);
  assert.deepEqual(hub.getCachedTodos("sess_todos"), todoBroadcasts[0]?.todos);

  // 2. Batch tool_done containing a todo sub-call also triggers refresh
  client.emitFrame({
    v: 1,
    ev: "tool_done",
    session_id: "sess_todos",
    call_id: "call_batch_1",
    name: "batch",
    tool_input: { tool_calls: [{ name: "todo", input: { action: "update" } }] },
    output: "ok",
  });
  await flushMicrotasks();
  assert.equal(todoPullCount, 2);
  assert.equal(todoBroadcasts.length, 2);

  // 3. Direct todo_state frame normalizes and broadcasts immediately
  client.emitFrame({
    v: 1,
    ev: "todo_state",
    session_id: "sess_todos",
    state: {
      todos: [
        { id: "1", content: "Plan architecture", status: "completed" },
        { id: "2", content: "Implement checklist", status: "completed" },
      ],
    },
  });
  assert.equal(todoBroadcasts.length, 3);
  assert.equal(hub.getCachedTodos("sess_todos").length, 2);
});

test("SessionHubCore attaches unattached sessions on demand, resets pool on bridge disconnect, handles processing status, and broadcasts permission.resolved", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-lifecycle-");
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const sessionsById = new Map<string, SessionInfo>([
    [
      "sess_processing",
      {
        session_id: "sess_processing",
        title: "Processing Session",
        working_dir: "/workspace",
        status: "processing",
        updated_at_ms: Date.now(),
      },
    ],
    [
      "sess_bg_only",
      {
        session_id: "sess_bg_only",
        title: "Unattached Session",
        working_dir: "/workspace",
        status: "idle",
        updated_at_ms: Date.now(),
      },
    ],
  ]);

  const bridge = new FakeBridgeManager({ sessionsById });
  const hub = new SessionHubCore(
    createHostAdapter({ folders: [] }).adapter,
    bridge,
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const messages: HostToWebviewMessage[] = [];
  hub.registerSurface("webview-lifecycle", "sidebar", (msg) => {
    messages.push(msg);
  });

  // 1. Attaching a session whose daemon status is "processing" marks turn streaming active
  const attached = await hub.attachSession("sess_processing");
  assert.equal(attached.status, "running");
  assert.equal(hub.getIsTurnStreaming(), true);

  // 2. respondPermission broadcasts rayucode.permission.resolved to all surfaces
  await hub.respondPermission({
    sessionId: "sess_processing",
    requestId: "perm_req_42",
    decision: "allow_once",
  });
  const permResolved = messages.find(
    (m) => m.type === "rayucode.permission.resolved",
  );
  assert.deepEqual(permResolved, {
    type: "rayucode.permission.resolved",
    sessionId: "sess_processing",
    requestId: "perm_req_42",
    decision: "allow_once",
  });

  // 3. ensureAttachedClient attaches an unattached non-focused session on demand
  const bgClient = await hub.ensureAttachedClient("sess_bg_only");
  assert.ok(bgClient);
  assert.equal(hub.getSocketPool().get("sess_bg_only"), bgClient);

  // 4. Bridge "disconnected" event closes pooled sockets and clears streaming state
  const pooledProcessing = bridge.dialedClients[0]!;
  bridge.emit("disconnected");
  assert.equal(pooledProcessing.closed, true);
  assert.equal(hub.getIsTurnStreaming(), false);
  assert.equal(hub.getSocketPool().get("sess_processing"), undefined);
});

test("SessionHubCore auto-imports synthetic codex_desktop sessions on attachSession and getHistory, deduplicates concurrent imports, and rejects cleanly on not_found", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-codex-import-");
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const syntheticId = "codex_desktop:01a20cda-5903-7ce3-978b-9c5b6a3938f0";
  const missingSyntheticId = "codex_desktop:00000000-0000-0000-0000-000000000000";
  const materializedId = "imported_codex_desktop_01a20cda-5903-7ce3-978b-9c5b6a3938f0";

  const sessionsById = new Map<string, SessionInfo>([
    [
      syntheticId,
      {
        session_id: syntheticId,
        title: "Codex Desktop Refactor",
        working_dir: "/workspace/codex-app",
        status: "idle",
        updated_at_ms: Date.now(),
        source: "codex_desktop",
        external_session_id: "01a20cda-5903-7ce3-978b-9c5b6a3938f0",
        external_path: "/home/rayu/.codex/sessions/rollout-1.jsonl",
        imported: false,
      },
    ],
  ]);

  const sharedClient = new FakeRayucodeClient({
    sessionsById,
    capabilities: ["permissions", "external_sessions"],
  });
  sharedClient.onImportExternalSessions = async (items) => {
    await new Promise((r) => setTimeout(r, 10));
    const item = items[0]!;
    if (item.external_session_id === "00000000-0000-0000-0000-000000000000") {
      return {
        sessions: [],
        skipped: [
          {
            source: item.source,
            external_session_id: item.external_session_id,
            reason: "not_found",
            message: "Codex rollout file no longer exists on disk",
          },
        ],
      };
    }
    const info: SessionInfo = {
      session_id: materializedId,
      title: "Codex Desktop Refactor",
      working_dir: item.working_dir ?? "/workspace/codex-app",
      status: "idle",
      updated_at_ms: Date.now(),
      source: "codex_desktop",
      external_session_id: item.external_session_id,
      external_path: item.external_path,
      imported: true,
    };
    sessionsById.set(materializedId, info);
    return { sessions: [info], skipped: [] };
  };

  const bridge = new FakeBridgeManager({ sharedClient, sessionsById });
  const hub = new SessionHubCore(
    createHostAdapter({ folders: [] }).adapter,
    bridge,
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Prime sessionInfoCache via listSessions so external_path/working_dir are known
  await hub.listSessions(false, { includeExternal: true });

  // Concurrent attachSession + getHistory on the synthetic ID must trigger only ONE import
  const [attached, history] = await Promise.all([
    hub.attachSession(syntheticId),
    hub.getHistory(syntheticId),
  ]);

  assert.equal(attached.sessionId, materializedId);
  assert.equal(hub.getActiveSessionId(), materializedId);
  assert.equal(history.messages.length, 1);
  assert.equal(sharedClient.importExternalCalls.length, 1);
  assert.deepEqual(sharedClient.importExternalCalls[0]?.items, [
    {
      source: "codex_desktop",
      external_session_id: "01a20cda-5903-7ce3-978b-9c5b6a3938f0",
      external_path: "/home/rayu/.codex/sessions/rollout-1.jsonl",
      working_dir: "/workspace/codex-app",
    },
  ]);
  // Raw synthetic ID must NEVER reach client.attachSession or client.getHistory
  assert.equal(sharedClient.attachCalls.includes(syntheticId), false);
  assert.equal(sharedClient.attachCalls.includes(materializedId), true);
  assert.deepEqual(sharedClient.historyCalls, [materializedId]);

  // Missing external session returns clean HarnessError("not_found") without calling attachSession
  await assert.rejects(
    () => hub.attachSession(missingSyntheticId),
    (err: unknown) =>
      err instanceof HarnessError &&
      err.code === "not_found" &&
      /Codex rollout file no longer exists/.test(err.message),
  );
  assert.equal(sharedClient.attachCalls.includes(missingSyntheticId), false);
});

test("SessionHubCore syncs permissions on attach/eviction, caches FIFO pending permissions, marks waiting status, defers on busy, and broadcasts modeSync", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-perms-");
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  let defaultRaw = "acceptEdits";
  const stateStore = new Map<string, unknown>();
  const adapter: SessionHubHostAdapter = {
    workspaceState: {
      get<T>(key: string, defaultValue?: T): T {
        return stateStore.has(key)
          ? (stateStore.get(key) as T)
          : (defaultValue as T);
      },
      async update(key: string, value: unknown): Promise<void> {
        stateStore.set(key, value);
      },
    },
    getWorkspaceFolders: () => [{ name: "workspace", fsPath: "/workspace" }],
    getDefaultPermissionModeRaw: () => defaultRaw,
  };

  const sessionsById = new Map<string, SessionInfo>([
    [
      "sess_perm_1",
      {
        session_id: "sess_perm_1",
        title: "Permission Sync Session",
        working_dir: "/workspace",
        status: "idle",
        updated_at_ms: Date.now(),
      },
    ],
  ]);

  const bridge = new FakeBridgeManager({
    sessionsById,
    capabilities: ["permission_modes"],
  });
  const hub = new SessionHubCore(adapter, bridge, { workspaceRegistry: registry });
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const broadcasts: HostToWebviewMessage[] = [];
  hub.registerSurface("webview-perms", "sidebar", (msg) => {
    broadcasts.push(msg);
  });

  // 1. Attaching a session without saved per-session prefs pushes non-default defaultPermissionMode
  //    even when capabilities advertise `permission_modes` (without legacy `permissions`)
  await hub.attachSession("sess_perm_1");
  const firstClient = bridge.dialedClients[0]!;
  assert.deepEqual(firstClient.setPermissionModeCalls, [
    { sessionId: "sess_perm_1", mode: "accept_edits" },
  ]);

  // 2. Evicting socket and re-acquiring via ensureAttachedClient re-syncs desired permission mode
  hub.getSocketPool().closeAll();
  await hub.ensureAttachedClient("sess_perm_1");
  const redialedClient = bridge.dialedClients[1]!;
  assert.deepEqual(redialedClient.setPermissionModeCalls, [
    { sessionId: "sess_perm_1", mode: "accept_edits" },
  ]);

  // 3. Two parallel permission_request frames are queued FIFO, not overwritten, and mark status "waiting"
  redialedClient.emitFrame({
    v: 1,
    ev: "permission_request",
    session_id: "sess_perm_1",
    request_id: "perm_1",
    tool_name: "bash",
    description: "Run cargo test",
    risk_tier: "confirm",
  });
  redialedClient.emitFrame({
    v: 1,
    ev: "permission_request",
    session_id: "sess_perm_1",
    request_id: "perm_2",
    tool_name: "bash",
    description: "Drop temporary table",
    risk_tier: "catastrophic",
  });

  const snapshot = hub.getPendingPermissionsSnapshot();
  assert.equal(snapshot["sess_perm_1"]?.length, 2);
  assert.equal(snapshot["sess_perm_1"]?.[0]?.requestId, "perm_1");
  assert.equal(snapshot["sess_perm_1"]?.[1]?.requestId, "perm_2");
  assert.equal(snapshot["sess_perm_1"]?.[1]?.riskTier, "catastrophic");

  const listedWaiting = await hub.listSessions();
  assert.equal(
    listedWaiting.sessions.find((s) => s.sessionId === "sess_perm_1")?.status,
    "waiting",
  );

  // Resolving perm_1 keeps perm_2 in the queue
  redialedClient.emitFrame({
    v: 1,
    ev: "permission_resolved",
    session_id: "sess_perm_1",
    request_id: "perm_1",
    decision: "allow_once",
  });
  assert.deepEqual(
    hub.getPendingPermissionsSnapshot()["sess_perm_1"]?.map((p) => p.requestId),
    ["perm_2"],
  );

  // Responding to perm_2 clears the queue and restores idle status
  await hub.respondPermission({
    sessionId: "sess_perm_1",
    requestId: "perm_2",
    decision: "deny",
  });
  assert.equal(hub.getPendingPermissionsSnapshot()["sess_perm_1"], undefined);

  // 4. Busy daemon error defers permission mode without publishing it as applied
  broadcasts.length = 0;
  redialedClient.throwBusyOnControl = true;
  const busyRes = await hub.setPermissionMode("sess_perm_1", "plan");
  assert.deepEqual(busyRes, { ok: true, mode: "plan", deferred: true });
  assert.equal(
    broadcasts.some(
      (m) =>
        m.type === "rayucode.permission.modeSync" &&
        m.sessionId === "sess_perm_1" &&
        m.mode === "plan",
    ),
    false,
  );

  // When turn finishes, deferred mode flushes cleanly
  redialedClient.throwBusyOnControl = false;
  redialedClient.setPermissionModeCalls.length = 0;
  redialedClient.emitFrame({
    v: 1,
    ev: "turn_done",
    session_id: "sess_perm_1",
  });
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(redialedClient.setPermissionModeCalls, [
    { sessionId: "sess_perm_1", mode: "plan" },
  ]);

  // 5. Updating default permission mode broadcasts isDefault sync
  broadcasts.length = 0;
  defaultRaw = "fullManage";
  hub.broadcastDefaultPermissionModeSync();
  assert.equal(
    broadcasts.some(
      (m) =>
        m.type === "rayucode.permission.modeSync" &&
        m.isDefault === true &&
        m.mode === "fullManage",
    ),
    true,
  );
});

test("SessionHubCore isolates two sessions in separate temp Git worktrees with identical relative paths across queue drain, cancel, permissions, file review, streaming, and terminal/markdown actions", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-worktrees-");
  const wtA = path.join(tmpDir, "worktree-alpha");
  const wtB = path.join(tmpDir, "worktree-beta");
  for (const [dir, label] of [
    [wtA, "alpha"],
    [wtB, "beta"],
  ] as const) {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "shared.ts"),
      `export const project = "${label}";\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "docs", "handoff.md"),
      `# ${label} report\n`,
      "utf8",
    );
    execFileSync("git", ["init", "-q"], { cwd: dir });
  }
  const realWtA = fs.realpathSync(wtA);
  const realWtB = fs.realpathSync(wtB);

  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const sessionsById = new Map<string, SessionInfo>();
  const fileChangeActions: Array<{
    sessionId: string;
    action: string;
    path?: string;
    cwd: string;
  }> = [];
  const fileDiffCalls: Array<{ sessionId: string; targetPath: string }> = [];

  const bridge = new FakeBridgeManager({ sessionsById });
  const origDial = bridge.dialClient.bind(bridge);
  bridge.dialClient = async () => {
    const client = (await origDial()) as unknown as Omit<
      FakeRayucodeClient,
      "getFileChanges"
    > & {
      getFileChanges: (sid?: string) => Promise<unknown>;
      getFileChangeDiff: (sid: string, targetPath: string) => Promise<unknown>;
      fileChangeAction: (
        sid: string,
        action: string,
        opts?: { path?: string; force?: boolean },
      ) => Promise<unknown>;
    };
    client.getFileChanges = async (sid?: string) => {
      const targetSid = sid ?? "";
      const dir = sessionsById.get(targetSid)?.working_dir ?? realWtA;
      return {
        session_id: targetSid,
        latest_turn_id: 1,
        total_pending_files: 1,
        total_additions: 1,
        total_deletions: 1,
        files: [
          {
            path: path.join(dir, "src", "shared.ts"),
            display_path: "src/shared.ts",
            kind: "modified",
            status: "pending",
            additions: 1,
            deletions: 1,
            changed_in_latest_turn: true,
            turn_id: 1,
            edit_count: 1,
            is_binary: false,
            undoable: true,
            can_redo: false,
            preview_hunks: [],
            preview_truncated: false,
            updated_at_ms: Date.now(),
          },
        ],
      };
    };
    client.getFileChangeDiff = async (sid: string, targetPath: string) => {
      fileDiffCalls.push({ sessionId: sid, targetPath });
      return {
        path: targetPath,
        display_path: "src/shared.ts",
        kind: "modified",
        status: "pending",
        additions: 1,
        deletions: 1,
        is_binary: false,
        original_content: `export const project = "before";\n`,
        modified_content: fs.readFileSync(targetPath, "utf8"),
        unified_diff: `--- a/src/shared.ts\n+++ b/src/shared.ts\n`,
        hunks: [],
      };
    };
    client.fileChangeAction = async (
      sid: string,
      action: string,
      opts?: { path?: string; force?: boolean },
    ) => {
      const dir = sessionsById.get(sid)?.working_dir ?? "";
      fileChangeActions.push({ sessionId: sid, action, path: opts?.path, cwd: dir });
      return {
        ok: true,
        message: `Applied ${action}`,
        conflicts: [],
        snapshot: {
          session_id: sid,
          latest_turn_id: 1,
          total_pending_files: 0,
          total_additions: 0,
          total_deletions: 0,
          files: [],
        },
      };
    };
    return client as unknown as RayucodeClient;
  };

  const { adapter } = createHostAdapter({
    folders: [
      { name: "worktree-alpha", fsPath: realWtA },
      { name: "worktree-beta", fsPath: realWtB },
    ],
  });
  const hub = new SessionHubCore(adapter, bridge, { workspaceRegistry: registry });
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await hub.waitUntilWorkspacesReady();

  // Ambiguous createSession / create_session without workingDir rejects when >1 workspaces exist
  await assert.rejects(
    () => hub.createSession(),
    (err: unknown) =>
      err instanceof HarnessError &&
      err.code === "invalid_request" &&
      /Select a project workspace/i.test(err.message),
  );
  const createReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest({ id: 500, req: "create_session" }, (r) =>
    createReplies.push(r),
  );
  assert.equal(createReplies[0]?.ev, "error");
  assert.equal(createReplies[0]?.code, "invalid_request");

  const broadcasts: HostToWebviewMessage[] = [];
  hub.registerSurface("surf-wt", "editorPanel", (msg) => broadcasts.push(msg));

  const sessA = await hub.createSession({ workingDir: realWtA });
  const clientA = bridge.dialedClients[0]!;
  const sessB = await hub.createSession({ workingDir: realWtB });
  const clientB = bridge.dialedClients[1]!;

  assert.equal(hub.getSessionWorkingDirForSession(sessA.sessionId), realWtA);
  assert.equal(hub.getSessionWorkingDirForSession(sessB.sessionId), realWtB);
  assert.equal(hub.getSessionWorkingDirForSession("sess_missing"), undefined);
  assert.equal(hub.getActiveSessionId(), sessB.sessionId);

  // Start a turn on Session A while Session B is focused
  await hub.handleHarnessRequest(
    { id: 501, req: "send_message", session_id: sessA.sessionId, content: "Edit alpha shared.ts" },
    () => {},
  );
  clientA.emitFrame({ v: 1, ev: "turn_start", session_id: sessA.sessionId });
  clientA.emitFrame({
    v: 1,
    ev: "text_delta",
    session_id: sessA.sessionId,
    text: "Working in alpha",
  });
  clientA.emitFrame({
    v: 1,
    ev: "permission_request",
    session_id: sessA.sessionId,
    request_id: "perm_alpha_1",
    tool_name: "edit",
    description: "Edit src/shared.ts",
  });

  // Also send first message on Session B
  await hub.handleHarnessRequest(
    { id: 502, req: "send_message", session_id: sessB.sessionId, content: "Edit beta shared.ts" },
    () => {},
  );

  // Verify ledger keeps each session bound strictly to its own project worktree
  const ledger = await hub.loadWorkspaceLedger();
  const wsAlpha = ledger.workspaces.find((w) => w.canonicalPath === realWtA);
  const wsBeta = ledger.workspaces.find((w) => w.canonicalPath === realWtB);
  assert.deepEqual(wsAlpha?.sessionIds, [sessA.sessionId]);
  assert.deepEqual(wsBeta?.sessionIds, [sessB.sessionId]);

  // Streaming frame from Session A stays tagged with sessA while sessB is focused
  assert.ok(
    broadcasts.some(
      (m) =>
        m.type === "rayucode.harness.frame" &&
        m.frame.ev === "text_delta" &&
        m.frame.session_id === sessA.sessionId,
    ),
  );

  // Permission approval & cancel for Session A route strictly to clientA while Session B is focused
  await hub.respondPermission({
    sessionId: sessA.sessionId,
    requestId: "perm_alpha_1",
    decision: "allow_once",
  });
  assert.equal(clientA.permissionResponses.length, 1);
  assert.equal(clientB.permissionResponses.length, 0);

  await hub.cancelSession(sessA.sessionId);
  assert.deepEqual(clientA.cancelledSessions, [sessA.sessionId]);
  assert.equal(clientB.cancelledSessions.length, 0);

  // Finish Session A turn and drain a queued follow-up for Session A while Session B stays focused
  clientA.emitFrame({ v: 1, ev: "turn_done", session_id: sessA.sessionId });
  await hub.handleHarnessRequest(
    { id: 503, req: "send_message", session_id: sessA.sessionId, content: "Queued alpha follow-up" },
    () => {},
  );
  assert.deepEqual(
    clientA.sentMessages.map((m) => m.content),
    ["Edit alpha shared.ts", "Queued alpha follow-up"],
  );
  assert.deepEqual(
    clientB.sentMessages.map((m) => m.content),
    ["Edit beta shared.ts"],
  );

  // File review (diff & keep) for relative path `src/shared.ts` on Session A resolves to wtA, not focused wtB
  await hub.fetchFileChanges(sessA.sessionId);
  const diffA = await hub.getFileChangeDiff(sessA.sessionId, "src/shared.ts");
  assert.ok(diffA);
  assert.equal(fileDiffCalls.at(-1)?.targetPath, path.join(realWtA, "src", "shared.ts"));
  assert.match(diffA.modifiedContent, /alpha/);

  const keepRes = await hub.runFileChangeAction(sessA.sessionId, "keep", {
    path: "src/shared.ts",
  });
  assert.equal(keepRes?.ok, true);
  assert.deepEqual(fileChangeActions, [
    {
      sessionId: sessA.sessionId,
      action: "keep",
      path: path.join(realWtA, "src", "shared.ts"),
      cwd: realWtA,
    },
  ]);

  // Terminal & Markdown preview protocol & host resolution stay bound to Session A while Session B is focused
  const parsedTerm = parseWebviewToHostMessage({
    type: "rayucode.editor.openTerminal",
    sessionId: sessA.sessionId,
    name: "Alpha Shell",
  });
  assert.equal(parsedTerm.success, true);
  assert.deepEqual(
    resolveTerminalCwdForMessage(hub, { sessionId: sessA.sessionId }),
    { ok: true, cwd: realWtA },
  );
  const missingTerm = resolveTerminalCwdForMessage(hub, {
    sessionId: "sess_unresolvable",
  });
  assert.equal(missingTerm.ok, false);

  const parsedMd = parseWebviewToHostMessage({
    type: "rayucode.editor.openMarkdownPreview",
    sessionId: sessA.sessionId,
    path: "docs/handoff.md",
  });
  assert.equal(parsedMd.success, true);
  const resolvedMdBase = resolveMarkdownPreviewBaseDirForMessage(hub, {
    sessionId: sessA.sessionId,
    path: "docs/handoff.md",
  });
  assert.deepEqual(resolvedMdBase, { ok: true, baseDir: realWtA });
  assert.equal(
    resolveMarkdownPreviewPath("docs/handoff.md", resolvedMdBase.baseDir),
    path.join(realWtA, "docs", "handoff.md"),
  );
  const missingMd = resolveMarkdownPreviewBaseDirForMessage(hub, {
    sessionId: "sess_unresolvable",
    path: "docs/handoff.md",
  });
  assert.equal(missingMd.ok, false);

  // Confirm neither session moved between projects after all operations
  const finalLedger = await hub.loadWorkspaceLedger();
  assert.deepEqual(
    finalLedger.workspaces.find((w) => w.canonicalPath === realWtA)?.sessionIds,
    [sessA.sessionId],
  );
  assert.deepEqual(
    finalLedger.workspaces.find((w) => w.canonicalPath === realWtB)?.sessionIds,
    [sessB.sessionId],
  );
});

test("SessionHubCore enforces requested > pending precedence, broadcasts prefsSync, emits non_turn: true on pre-send rejection, handles serviceTier auto on non-fast providers, and keeps cacheTtl out of per-session prefs", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-prefs-precedence-");
  const wsDir = path.join(tmpDir, "repo");
  fs.mkdirSync(wsDir, { recursive: true });
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  let fastModeSupported = false;
  let rejectPermission = false;
  let rejectModel = false;
  let rejectEffort = false;

  const client = new FakeRayucodeClient({
    capabilities: ["permissions", "permission_modes"],
    onRuntimeCommand: async (sessionId, command, args) => {
      if (command === "fast" && !fastModeSupported) {
        throw new HarnessError("unsupported", "Fast service tier is not supported by this provider");
      }
      return { session_id: sessionId, command, data: { tier: args[0] }, message: "ok" };
    },
  });
  const origSetPerm = client.setPermissionMode.bind(client);
  client.setPermissionMode = async (sid, mode) => {
    if (rejectPermission) throw new HarnessError("invalid_request", "Permission mode denied");
    return origSetPerm(sid, mode);
  };
  const origSetModel = client.setModel.bind(client);
  client.setModel = async (sid, model) => {
    if (rejectModel) throw new HarnessError("invalid_request", "Model unavailable");
    return origSetModel(sid, model);
  };
  const origSetEffort = client.setReasoningEffort.bind(client);
  client.setReasoningEffort = async (sid, effort) => {
    if (rejectEffort) throw new HarnessError("invalid_request", "Unsupported effort");
    return origSetEffort(sid, effort);
  };

  const { adapter } = createHostAdapter({
    folders: [{ name: "repo", fsPath: wsDir }],
  });
  const hub = new SessionHubCore(
    adapter,
    new FakeBridgeManager({ sharedClient: client }),
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const prefsSyncEvents: Array<
    Extract<HostToWebviewMessage, { type: "rayucode.session.prefsSync" }>
  > = [];
  hub.registerSurface("surf-prefs", "sidebar", (msg) => {
    if (msg.type === "rayucode.session.prefsSync") {
      prefsSyncEvents.push(msg);
    }
  });

  const created = await hub.createSession({
    workingDir: wsDir,
    permissionMode: "default",
    model: "rayu:claude-sonnet-4-5",
    effort: "low",
    cacheTtl: "1h",
  });
  // cacheTtl must NOT be persisted per session or leaked onto session summaries
  assert.equal("cacheTtl" in (hub.getSessionPrefs(created.sessionId) ?? {}), false);
  assert.equal(created.cacheTtl, undefined);

  // Defer model, effort, and permissionMode mid-turn
  client.emitFrame({ v: 1, ev: "turn_start", session_id: created.sessionId });
  client.throwBusyOnControl = true;
  await hub.setPermissionMode(created.sessionId, "plan");
  client.throwBusyOnControl = false;
  await hub.setSessionModel(created.sessionId, "rayu:claude-haiku-4-5");
  await hub.setSessionEffort(created.sessionId, "low");

  const deferredSync = prefsSyncEvents.at(-1);
  assert.equal(deferredSync?.sessionId, created.sessionId);
  assert.equal(deferredSync?.pending.permissionMode, "plan");
  assert.equal(deferredSync?.pending.model, "rayu:claude-haiku-4-5");
  assert.equal(deferredSync?.pending.effort, "low");
  // Unacknowledged deferred prefs must NOT overwrite persisted acknowledged prefs
  assert.equal(hub.getSessionPrefs(created.sessionId)?.permissionMode, "default");
  assert.equal(hub.getSessionPrefs(created.sessionId)?.model, "rayu:claude-sonnet-4-5");

  // Clear streaming & pool active turn without flushing first, then test send_message pre-send checks & overrides
  client.setPermissionModeCalls.length = 0;
  client.setModelCalls.length = 0;
  client.setEffortCalls.length = 0;
  (hub as unknown as { streamingBySession: Map<string, boolean> }).streamingBySession.set(
    created.sessionId,
    false,
  );
  hub.getSocketPool().markTurnSettled(created.sessionId);

  // 1. Pre-send permission, model, effort, and serviceTier failures emit non_turn: true and stop BEFORE sendMessage
  rejectPermission = true;
  const permFailReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 601,
      req: "send_message",
      session_id: created.sessionId,
      content: "Should not dispatch",
      permission_mode: "accept_edits",
    },
    (r) => permFailReplies.push(r),
  );
  assert.equal(permFailReplies[0]?.ev, "error");
  assert.equal(permFailReplies[0]?.non_turn, true);
  assert.match(String(permFailReplies[0]?.message ?? ""), /Permission mode denied/);
  assert.equal(client.sentMessages.length, 0);
  rejectPermission = false;

  rejectModel = true;
  const modelFailReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 602,
      req: "send_message",
      session_id: created.sessionId,
      content: "Should not dispatch",
      model: "rayu:claude-opus-4-6",
    },
    (r) => modelFailReplies.push(r),
  );
  assert.equal(modelFailReplies[0]?.ev, "error");
  assert.equal(modelFailReplies[0]?.non_turn, true);
  assert.match(String(modelFailReplies[0]?.message ?? ""), /Model unavailable/);
  assert.equal(client.sentMessages.length, 0);
  rejectModel = false;

  rejectEffort = true;
  const effortFailReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 603,
      req: "send_message",
      session_id: created.sessionId,
      content: "Should not dispatch",
      effort: "high",
    },
    (r) => effortFailReplies.push(r),
  );
  assert.equal(effortFailReplies[0]?.ev, "error");
  assert.equal(effortFailReplies[0]?.non_turn, true);
  assert.match(String(effortFailReplies[0]?.message ?? ""), /Unsupported effort/);
  assert.equal(client.sentMessages.length, 0);
  rejectEffort = false;

  // Non-fast provider: service_tier "priority" stops pre-send with non_turn: true
  const tierFailReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 604,
      req: "send_message",
      session_id: created.sessionId,
      content: "Should not dispatch on non-fast provider",
      service_tier: "priority",
    },
    (r) => tierFailReplies.push(r),
  );
  assert.equal(tierFailReplies[0]?.ev, "error");
  assert.equal(tierFailReplies[0]?.non_turn, true);
  assert.match(String(tierFailReplies[0]?.message ?? ""), /Fast service tier is not supported/);
  assert.equal(client.sentMessages.length, 0);

  // 2. Explicit requested.* overrides older pending*, and service_tier: "auto" succeeds on non-fast provider!
  // Re-seed pending prefs (since #602/#603/#604 already applied earlier settings in the pipeline before failing later)
  client.emitFrame({ v: 1, ev: "turn_start", session_id: created.sessionId });
  client.throwBusyOnControl = true;
  await hub.setPermissionMode(created.sessionId, "plan");
  client.throwBusyOnControl = false;
  await hub.setSessionModel(created.sessionId, "rayu:claude-haiku-4-5");
  await hub.setSessionEffort(created.sessionId, "low");
  (hub as unknown as { streamingBySession: Map<string, boolean> }).streamingBySession.set(
    created.sessionId,
    false,
  );
  hub.getSocketPool().markTurnSettled(created.sessionId);

  client.setPermissionModeCalls.length = 0;
  client.setModelCalls.length = 0;
  client.setEffortCalls.length = 0;
  client.runtimeCommands.length = 0;
  const okReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 605,
      req: "send_message",
      session_id: created.sessionId,
      content: "Explicit settings override pending and auto works without fast",
      permission_mode: "accept_edits",
      model: "rayu:claude-opus-4-6",
      effort: "high",
      service_tier: "auto",
    },
    (r) => okReplies.push(r),
  );
  assert.equal(okReplies[0]?.ev, "ok");
  assert.deepEqual(client.setPermissionModeCalls, [
    { sessionId: created.sessionId, mode: "accept_edits" },
  ]);
  assert.deepEqual(client.setModelCalls, [
    { sessionId: created.sessionId, model: "rayu:claude-opus-4-6" },
  ]);
  assert.deepEqual(client.setEffortCalls, [
    { sessionId: created.sessionId, effort: "high" },
  ]);
  assert.equal(
    client.runtimeCommands.filter((c) => c.command === "fast").length,
    0,
    'service_tier "auto" on unset/auto tier must not invoke fast runtime command',
  );
  assert.equal(client.sentMessages.length, 1);

  const ackSync = prefsSyncEvents.at(-1);
  assert.deepEqual(ackSync?.pending, {});
  assert.equal(ackSync?.acknowledged.permissionMode, "acceptEdits");
  assert.equal(ackSync?.acknowledged.model, "rayu:claude-opus-4-6");
  assert.equal(ackSync?.acknowledged.effort, "high");

  // 3. On a fast-capable provider, priority -> auto maps "auto" -> "off" once, then subsequent "auto" is a no-op
  fastModeSupported = true;
  client.emitFrame({ v: 1, ev: "turn_done", session_id: created.sessionId });
  await hub.handleHarnessRequest(
    {
      id: 606,
      req: "send_message",
      session_id: created.sessionId,
      content: "Enable priority",
      service_tier: "priority",
    },
    () => {},
  );
  client.emitFrame({ v: 1, ev: "turn_done", session_id: created.sessionId });
  await hub.handleHarnessRequest(
    {
      id: 607,
      req: "send_message",
      session_id: created.sessionId,
      content: "Reset to auto",
      service_tier: "auto",
    },
    () => {},
  );
  client.emitFrame({ v: 1, ev: "turn_done", session_id: created.sessionId });
  await hub.handleHarnessRequest(
    {
      id: 608,
      req: "send_message",
      session_id: created.sessionId,
      content: "Stay on auto",
      service_tier: "auto",
    },
    () => {},
  );
  assert.deepEqual(
    client.runtimeCommands.filter((c) => c.command === "fast").map((c) => c.args),
    [["priority"], ["off"]],
  );
});

test("SessionHubCore send_message timeout/disconnect checks history BEFORE markTurnSettled and keeps accepted turn active without duplicate retry", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-timeout-race-");
  const wsDir = path.join(tmpDir, "repo");
  fs.mkdirSync(wsDir, { recursive: true });
  const registry = new WorkspaceRegistry({
    filePath: path.join(tmpDir, "workspaces.json"),
    enableWatch: false,
  });

  const historyMessages: Array<Record<string, unknown>> = [
    { role: "user", content: "Earlier prompt" },
  ];
  const traceOrder: string[] = [];
  let failSendWith: HarnessError | null = null;
  let acceptInServerHistory = false;

  const client = new FakeRayucodeClient({ capabilities: ["permissions"] });
  client.getHistory = async () => [...historyMessages];
  client.getHistoryWithImages = async () => {
    traceOrder.push("getHistory");
    return { messages: [...historyMessages], images: [] };
  };
  client.sendMessage = async (sessionId: string, content: string) => {
    client.sentMessages.push({ sessionId, content });
    if (acceptInServerHistory) {
      historyMessages.push({ role: "user", content });
    }
    if (failSendWith) {
      throw failSendWith;
    }
  };

  const { adapter } = createHostAdapter({
    folders: [{ name: "repo", fsPath: wsDir }],
  });
  const hub = new SessionHubCore(
    adapter,
    new FakeBridgeManager({ sharedClient: client }),
    { workspaceRegistry: registry },
  );
  t.after(() => {
    hub.dispose();
    registry.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const created = await hub.createSession({ workingDir: wsDir });

  // Spy on socketPool.markTurnSettled to assert call ordering
  const pool = hub.getSocketPool();
  const origMarkSettled = pool.markTurnSettled.bind(pool);
  pool.markTurnSettled = (sid: string) => {
    traceOrder.push(`markTurnSettled:${sid}`);
    origMarkSettled(sid);
  };

  // Case 1: Timeout after daemon actually accepted prompt -> check history, do NOT markTurnSettled, return ev: "ok"
  traceOrder.length = 0;
  acceptInServerHistory = true;
  failSendWith = new HarnessError("timeout", "accept timed out");
  const acceptedReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 701,
      req: "send_message",
      session_id: created.sessionId,
      content: "Accepted despite timeout",
    },
    (r) => acceptedReplies.push(r),
  );
  assert.deepEqual(acceptedReplies, [{ v: 1, reply_to: 701, ev: "ok" }]);
  assert.deepEqual(traceOrder, ["getHistory"]);
  assert.equal(pool.getActiveTurnSessionIds().includes(created.sessionId), true);

  // Settle turn before Case 2
  origMarkSettled(created.sessionId);
  traceOrder.length = 0;

  // Case 2: Timeout when prompt was NOT accepted in history -> check history BEFORE markTurnSettled, then return timeout error
  acceptInServerHistory = false;
  failSendWith = new HarnessError("timeout", "accept timed out");
  const lostReplies: Array<Record<string, unknown>> = [];
  await hub.handleHarnessRequest(
    {
      id: 702,
      req: "send_message",
      session_id: created.sessionId,
      content: "Dropped before daemon persisted",
    },
    (r) => lostReplies.push(r),
  );
  assert.equal(lostReplies[0]?.ev, "error");
  assert.equal(lostReplies[0]?.code, "timeout");
  assert.deepEqual(traceOrder, [
    "getHistory",
    `markTurnSettled:${created.sessionId}`,
  ]);
  assert.equal(pool.getActiveTurnSessionIds().includes(created.sessionId), false);
});

test("SessionHubCore setSessionArchivedLedger stores archive/restore locally in workspace ledger, preserves pre-existing archived IDs across reloads, and never invokes engine archive/restore RPCs", async (t) => {
  const tmpDir = createTempDir("rayu-vscode-hub-archive-");
  const wsOne = path.join(tmpDir, "ws-archive");
  fs.mkdirSync(wsOne, { recursive: true });
  const registryPath = path.join(tmpDir, "workspaces.json");

  const registry1 = new WorkspaceRegistry({
    filePath: registryPath,
    enableWatch: false,
  });
  const sessionsById = new Map<string, SessionInfo>([
    [
      "ses_preexisting_arch",
      {
        session_id: "ses_preexisting_arch",
        title: "Pre-existing archived",
        working_dir: wsOne,
        status: "idle",
        updated_at_ms: 1000,
      },
    ],
    [
      "ses_sidebar_target",
      {
        session_id: "ses_sidebar_target",
        title: "Sidebar target",
        working_dir: wsOne,
        status: "idle",
        updated_at_ms: 2000,
      },
    ],
  ]);
  const bridge = new FakeBridgeManager({ sessionsById });
  const { adapter } = createHostAdapter({
    folders: [{ name: "ws-archive", fsPath: wsOne }],
    state: {
      [ARCHIVED_SESSIONS_KEY]: { ses_preexisting_arch: true },
    },
  });

  const hub1 = new SessionHubCore(adapter, bridge, {
    workspaceRegistry: registry1,
  });
  t.after(() => {
    hub1.dispose();
    registry1.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Archive a second session while a pre-existing archived session is already present
  const afterArchive = await hub1.setSessionArchivedLedger("ses_sidebar_target", true);
  assert.ok(afterArchive.archivedSessionIds.includes("ses_preexisting_arch"));
  assert.ok(afterArchive.archivedSessionIds.includes("ses_sidebar_target"));
  assert.deepEqual(adapter.workspaceState.get(ARCHIVED_SESSIONS_KEY, {}), {
    ses_preexisting_arch: true,
    ses_sidebar_target: true,
  });

  // Never calls client.archiveSession or client.restoreSession (control or dialed clients)
  for (const client of [bridge.controlClient, ...bridge.dialedClients]) {
    assert.deepEqual(client.archiveSessionCalls, []);
    assert.deepEqual(client.restoreSessionCalls, []);
  }
  assert.equal(bridge.dialedClients.length, 0);

  // Reload a fresh SessionHubCore + WorkspaceRegistry pointing at the same workspaces.json & workspaceState
  const registry2 = new WorkspaceRegistry({
    filePath: registryPath,
    enableWatch: false,
  });
  const hub2 = new SessionHubCore(adapter, bridge, {
    workspaceRegistry: registry2,
  });
  t.after(() => {
    hub2.dispose();
    registry2.dispose();
  });

  const reloadedLedger = await hub2.loadWorkspaceLedger();
  assert.ok(reloadedLedger.archivedSessionIds.includes("ses_preexisting_arch"));
  assert.ok(reloadedLedger.archivedSessionIds.includes("ses_sidebar_target"));

  // Restore ses_sidebar_target locally -> pre-existing archived ID remains preserved and no engine RPC is invoked
  const afterRestore = await hub2.setSessionArchivedLedger("ses_sidebar_target", false);
  assert.ok(afterRestore.archivedSessionIds.includes("ses_preexisting_arch"));
  assert.equal(afterRestore.archivedSessionIds.includes("ses_sidebar_target"), false);
  assert.deepEqual(adapter.workspaceState.get(ARCHIVED_SESSIONS_KEY, {}), {
    ses_preexisting_arch: true,
    ses_sidebar_target: false,
  });
  for (const client of [bridge.controlClient, ...bridge.dialedClients]) {
    assert.deepEqual(client.archiveSessionCalls, []);
    assert.deepEqual(client.restoreSessionCalls, []);
  }
  assert.equal(bridge.dialedClients.length, 0);
});

test("StatusBarBridge formats negotiated protocol version and engine fallback without hardcoding v1.14", () => {
  assert.equal(
    formatStatusBarVersionLabel({ version: "rayu-3.2.0", protocolVersion: "1.16" }),
    "rayu-3.2.0",
  );
  assert.equal(
    formatStatusBarVersionLabel({ protocolVersion: "1" }),
    "v1",
  );
  assert.equal(
    formatStatusBarVersionLabel({ protocolVersion: "1.16" }),
    "v1.16",
  );
  assert.equal(
    formatStatusBarVersionLabel({}),
    "engine",
  );

  const tooltipWithProto = buildConnectedStatusBarTooltipLines({
    daemonStatus: {
      state: "connected",
      protocolVersion: "1",
      latencyMs: 4,
      capabilities: ["permissions"],
    },
    model: "claude-sonnet-4-6",
    permissionMode: "default",
    backgroundTasks: [],
  }).join("\n");
  assert.match(tooltipWithProto, /\*\*RayuCode\*\* \(v1 · 4ms\)/);
  assert.equal(tooltipWithProto.includes("v1.14"), false);

  const tooltipNoVersion = buildConnectedStatusBarTooltipLines({
    daemonStatus: {
      state: "connected",
      capabilities: [],
    },
    permissionMode: "acceptEdits",
    backgroundTasks: [],
  }).join("\n");
  assert.match(tooltipNoVersion, /\*\*RayuCode\*\* \(engine\)/);
  assert.equal(tooltipNoVersion.includes("v1.14"), false);
});
