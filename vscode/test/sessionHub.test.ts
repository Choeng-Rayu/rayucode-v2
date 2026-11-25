import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type * as vscode from "vscode";
import type {
  RayucodeClient,
  RuntimeCommand,
  ServerFrame,
  SessionInfo,
} from "@rayu-dev/rayucode-sdk";
import type { HostToWebviewMessage } from "../shared/vscodeProtocol.js";
import type { GitChangesBridge } from "../host/bridges/gitChangesBridge.js";
import type { BridgeManager } from "../host/runtime/bridgeManager.js";
import { SessionHub } from "../host/runtime/sessionHub.js";

interface FakeClientOptions {
  capabilities?: string[];
  onRuntimeCommand?: (
    sessionId: string,
    command: RuntimeCommand,
    args: string[],
  ) => Promise<{ session_id: string; command: RuntimeCommand; data: unknown; message: string }>;
}

class FakeHarnessClient extends EventEmitter {
  readonly capabilities: string[];
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
  private createSeq = 0;

  constructor(private readonly opts: FakeClientOptions = {}) {
    super();
    this.capabilities = opts.capabilities ?? ["permissions", "soft_interrupt_ids"];
  }

  supports(capability: string): boolean {
    return this.capabilities.includes(capability);
  }

  async createSession(options?: { workingDir?: string }): Promise<SessionInfo> {
    this.createSeq += 1;
    const info: SessionInfo = {
      session_id: `sess_created_${this.createSeq}`,
      title: `Created ${this.createSeq}`,
      working_dir: options?.workingDir ?? "/workspace",
      status: "idle",
      updated_at_ms: 1000 + this.createSeq,
    };
    this.createdSessions.push(info);
    return info;
  }

  async attachSession(sessionId: string): Promise<SessionInfo> {
    return {
      session_id: sessionId,
      title: `Session ${sessionId}`,
      working_dir: "/workspace",
      status: "idle",
      updated_at_ms: 2000,
    };
  }

  async listSessions(): Promise<SessionInfo[]> {
    return [];
  }

  async setPermissionMode(): Promise<void> {}

  async getRuntimeInfo(sessionId: string) {
    return {
      server: "rayu-test/1.14",
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

  async close(): Promise<void> {}

  emitFrame(frame: ServerFrame): void {
    this.emit("event", frame);
  }
}

function createFakeContext(initialActiveSessionId?: string): vscode.ExtensionContext {
  const workspaceMap = new Map<string, unknown>();
  if (initialActiveSessionId) {
    workspaceMap.set("rayucode.sessions.activeSessionId", initialActiveSessionId);
  }
  return {
    workspaceState: {
      get: <T>(key: string, defaultValue?: T): T =>
        workspaceMap.has(key) ? (workspaceMap.get(key) as T) : (defaultValue as T),
      update: async (key: string, value: unknown) => {
        workspaceMap.set(key, value);
      },
      keys: () => [...workspaceMap.keys()],
    },
  } as unknown as vscode.ExtensionContext;
}

function createFakeBridgeManager(client: FakeHarnessClient): BridgeManager {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getStatus: () => ({
      state: "connected" as const,
      version: "1.14",
      capabilities: client.capabilities,
    }),
    getActiveClient: () => client as unknown as RayucodeClient,
    ensureConnected: async () => client as unknown as RayucodeClient,
    dialClient: async () => client as unknown as RayucodeClient,
  }) as unknown as BridgeManager;
}

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

test("SessionHub isolates background tasks per session across refresh, progress frames, cleanup, and session switches", async (t) => {
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

  const client = new FakeHarnessClient({
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

  const hub = new SessionHub(
    createFakeContext(),
    createFakeBridgeManager(client),
    {} as GitChangesBridge,
  );
  t.after(() => hub.dispose());

  const snapshots: Array<Extract<HostToWebviewMessage, { type: "rayucode.processes.snapshot" }>> = [];
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
    hub.getBackgroundTasks("sess_b").map((task) => `${task.taskId}:${task.sessionId}`),
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
  const client = new FakeHarnessClient();
  const hub = new SessionHub(
    createFakeContext(),
    createFakeBridgeManager(client),
    {} as GitChangesBridge,
  );
  t.after(() => hub.dispose());

  await hub.attachSession("sess_stream");
  assert.equal(hub.getIsTurnStreaming(), false);

  // reasoning_delta activates streaming; turn_stopped clears it
  client.emitFrame({ v: 1, ev: "reasoning_delta", session_id: "sess_stream", text: "Thinking..." });
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
  client.emitFrame({ v: 1, ev: "session_status", session_id: "sess_stream", status: "idle" });
  assert.equal(hub.getIsTurnStreaming(), false);

  for (const activeStatus of ["generating", "tool_running", "running", "busy"]) {
    client.emitFrame({
      v: 1,
      ev: "session_status",
      session_id: "sess_stream",
      status: activeStatus,
    });
    assert.equal(hub.getIsTurnStreaming(), true, `status ${activeStatus} should set streaming`);
    client.emitFrame({ v: 1, ev: "session_status", session_id: "sess_stream", status: "idle" });
    assert.equal(hub.getIsTurnStreaming(), false);
  }
});

test("SessionHub handleHarnessRequest routes soft_interrupt and cancel_soft_interrupts with capability awareness", async (t) => {
  const clientWithIds = new FakeHarnessClient({
    capabilities: ["permissions", "soft_interrupt_ids"],
  });
  const hubWithIds = new SessionHub(
    createFakeContext(),
    createFakeBridgeManager(clientWithIds),
    {} as GitChangesBridge,
  );
  t.after(() => hubWithIds.dispose());

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
  const legacyClient = new FakeHarnessClient({ capabilities: ["permissions"] });
  const legacyHub = new SessionHub(
    createFakeContext(),
    createFakeBridgeManager(legacyClient),
    {} as GitChangesBridge,
  );
  t.after(() => legacyHub.dispose());
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
