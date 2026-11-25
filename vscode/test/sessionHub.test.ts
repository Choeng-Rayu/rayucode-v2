import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { RayucodeClient, SessionInfo } from "@rayu-dev/rayucode-sdk";
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

class FakeRayucodeClient extends EventEmitter {
  closed = false;
  readonly cancelledSessions: string[] = [];
  readonly permissionResponses: Array<{
    sessionId: string;
    requestId: string;
    decision: string;
  }> = [];
  readonly sentMessages: Array<{ sessionId: string; content: string }> = [];

  constructor(private readonly sessionsById: Map<string, SessionInfo>) {
    super();
  }

  supports(_cap: string): boolean {
    return true;
  }

  async createSession(opts?: { workingDir?: string }): Promise<SessionInfo> {
    const id = `sess_created_${this.sessionsById.size + 1}`;
    const info: SessionInfo = {
      session_id: id,
      title: `Session ${id}`,
      working_dir: opts?.workingDir,
      status: "idle",
      updated_at_ms: Date.now(),
    };
    this.sessionsById.set(id, info);
    return info;
  }

  async attachSession(sessionId: string): Promise<SessionInfo> {
    const existing = this.sessionsById.get(sessionId);
    if (existing) return existing;
    const info: SessionInfo = {
      session_id: sessionId,
      title: `Session ${sessionId}`,
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
      server: "rayu-harness-api-bridge/0.1.0",
      protocolVersion: 1,
      capabilities: ["permissions"],
      healthy: true,
      sessionId,
      provider: "rayu",
      model: "claude-sonnet-4-6",
      providers: ["rayu"],
      routes: [],
    };
  }

  async setPermissionMode(): Promise<void> {}
  async setModel(): Promise<void> {}
  async setReasoningEffort(): Promise<void> {}
  async setSessionSaved(): Promise<void> {}
  async archiveSession(): Promise<void> {}
  async restoreSession(): Promise<void> {}
  async notifyAuthChanged(): Promise<void> {}

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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

class FakeBridgeManager extends EventEmitter implements SessionHubBridgeLike {
  readonly dialedClients: FakeRayucodeClient[] = [];
  readonly controlClient: FakeRayucodeClient;

  constructor(private readonly sessionsById: Map<string, SessionInfo>) {
    super();
    this.controlClient = new FakeRayucodeClient(sessionsById);
  }

  getStatus() {
    return {
      state: "connected" as const,
      version: "rayu-harness-api-bridge/0.1.0",
      capabilities: ["permissions", "file_changes"],
    };
  }

  getActiveClient(): RayucodeClient | null {
    return this.controlClient as unknown as RayucodeClient;
  }

  async ensureConnected(): Promise<RayucodeClient> {
    return this.controlClient as unknown as RayucodeClient;
  }

  async dialClient(): Promise<RayucodeClient> {
    const client = new FakeRayucodeClient(this.sessionsById);
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

  const bridge = new FakeBridgeManager(sessionsById);
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
  assert.equal(clientA.closed, false, "Session A socket must remain open while streaming/waiting");
  assert.equal(hub.getActiveSessionId(), "sess_b");

  // Background stream frames on Session A must still reach the webview with bound session_id
  clientA.emit("event", { ev: "text_delta", text: "Background chunk from A" });
  const bgFrame = broadcasted.find(
    (m) =>
      m.type === "rayucode.harness.frame" &&
      m.frame.ev === "text_delta" &&
      m.frame.text === "Background chunk from A",
  );
  assert.ok(bgFrame, "Background text_delta from Session A must broadcast to webview");
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
  const bridge = new FakeBridgeManager(sessionsById);
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
