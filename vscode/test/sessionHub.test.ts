import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  RayucodeClient,
  RuntimeCommand,
  ServerFrame,
  SessionInfo,
} from "@rayu-dev/rayucode-sdk";
import { WorkspaceRegistry } from "@rayu-dev/rayucode-session-core/host";
import type { HostToWebviewMessage } from "../shared/vscodeProtocol.js";
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
  readonly authNotifyCalls: string[] = [];

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

  async setPermissionMode(): Promise<void> {}

  async setModel(sessionId: string, model: string): Promise<void> {
    this.setModelCalls.push({ sessionId, model });
  }

  async setReasoningEffort(): Promise<void> {}
  async setSessionSaved(): Promise<void> {}
  async archiveSession(): Promise<void> {}
  async restoreSession(): Promise<void> {}

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
