import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendLocalUserMessage,
  applyApiEvent,
  createInitialSessionState,
  createPostMessageAdapter,
  createWebSocketAdapter,
  resolveLocalPermission,
} from "../dist/index.js";

test("sessionReducer accumulates rayu_credits, tools, reasoning, and persists ResponseStats on turn_done", () => {
  let state = createInitialSessionState();
  state = applyApiEvent(state, {
    ev: "attached",
    session: { session_id: "sess-1", title: "Demo", status: "idle" },
  });
  state = applyApiEvent(state, {
    ev: "runtime_info",
    session_id: "sess-1",
    provider: "rayu",
    model: "rayu/claude-sonnet-4",
    routes: [
      {
        model: "rayu/claude-sonnet-4",
        provider: "rayu",
        api_method: "rayu",
        available: true,
        detail: "Rayu Auth",
      },
      {
        model: "openrouter/auto",
        provider: "openrouter",
        api_method: "openrouter",
        available: true,
        detail: "OpenRouter",
      },
    ],
  });

  state = appendLocalUserMessage(state, "Inspect Cargo.toml");
  state = applyApiEvent(state, { ev: "reasoning_delta", session_id: "sess-1", text: "Checking file..." });
  state = applyApiEvent(state, { ev: "reasoning_done", session_id: "sess-1", duration_secs: 1.4 });
  state = applyApiEvent(state, { ev: "tool_start", session_id: "sess-1", call_id: "c1", name: "read" });
  state = applyApiEvent(state, {
    ev: "tool_call",
    session_id: "sess-1",
    call_id: "c1",
    name: "read",
    input: { path: "Cargo.toml" },
  });
  state = applyApiEvent(state, {
    ev: "tool_done",
    session_id: "sess-1",
    call_id: "c1",
    name: "read",
    output: "[package]\nname = \"rayucode\"",
  });
  state = applyApiEvent(state, {
    ev: "rayu_credits",
    session_id: "sess-1",
    credits: 120.5,
    turn_credits: 120.5,
  });
  state = applyApiEvent(state, { ev: "text_delta", session_id: "sess-1", text: "Done!" });
  state = applyApiEvent(state, {
    ev: "rayu_credits",
    session_id: "sess-1",
    credits: 323.26,
    turn_credits: 443.76,
  });
  state = applyApiEvent(state, {
    ev: "token_usage",
    session_id: "sess-1",
    input: 2000,
    output: 350,
  });
  state = applyApiEvent(state, { ev: "turn_done", session_id: "sess-1" });

  assert.equal(state.isStreaming, false);
  assert.equal(state.liveTurnCredits, undefined);
  assert.equal(state.routes[0]?.provider, "rayu");
  assert.equal(state.entries.length, 2);
  const assistant = state.entries[1]!;
  assert.equal(assistant.content, "Done!");
  assert.equal(assistant.reasoning, "Checking file...");
  assert.equal(assistant.reasoningDurationSecs, 1.4);
  assert.equal(assistant.tools.length, 1);
  assert.equal(assistant.tools[0]?.status, "done");
  assert.equal(assistant.responseStats?.rayu_credits, 443.76);
  assert.equal(assistant.responseStats?.input_tokens, 2000);
  assert.equal(assistant.responseStats?.output_tokens, 350);
});

test("sessionReducer isolates events from other sessions and handles permission lifecycle", () => {
  let state = createInitialSessionState("sess-a");
  state = applyApiEvent(state, {
    ev: "text_delta",
    session_id: "sess-b",
    text: "should be ignored",
  });
  assert.equal(state.entries.length, 0);

  state = applyApiEvent(state, {
    ev: "permission_request",
    session_id: "sess-a",
    request_id: "req-1",
    tool_name: "bash",
    description: "Run cargo test",
  });
  assert.equal(state.pendingPermissions.length, 1);
  state = resolveLocalPermission(state, "req-1");
  assert.equal(state.pendingPermissions.length, 0);
});

test("createPostMessageAdapter correlates RPC requests and forwards host actions", async () => {
  const sent: unknown[] = [];
  let listener: ((msg: unknown) => void) | undefined;

  const { adapter, dispose } = createPostMessageAdapter({
    bridge: {
      postMessage(msg) {
        sent.push(msg);
        const envelope = msg as { type: string; frame?: { id: number; req: string } };
        if (envelope.type === "rayucode.harness.request" && envelope.frame?.req === "list_sessions") {
          queueMicrotask(() => {
            listener?.({
              type: "rayucode.harness.frame",
              frame: {
                v: 1,
                reply_to: envelope.frame!.id,
                ev: "sessions",
                sessions: [{ session_id: "s1", status: "idle", title: "Hello" }],
              },
            });
          });
        }
      },
      onMessage(handler) {
        listener = handler;
        return () => {
          listener = undefined;
        };
      },
    },
  });

  assert.equal(adapter.capabilities.platform, "vscode");
  assert.equal(adapter.capabilities.canShowNativeDiff, true);

  const sessions = await adapter.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.session_id, "s1");

  await adapter.copyToClipboard("fn main() {}");
  assert.ok(
    sent.some(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>).type === "rayucode.host.copyToClipboard",
    ),
  );
  dispose();
});

test("createWebSocketAdapter correlates protocol frames and propagates HarnessError", async () => {
  const handlers = new Map<string, Set<(ev: any) => void>>();
  const fakeSocket = {
    readyState: 1,
    send(raw: string) {
      const frame = JSON.parse(raw) as { id: number; req: string };
      queueMicrotask(() => {
        const reply =
          frame.req === "set_model"
            ? { v: 1, reply_to: frame.id, ev: "error", code: "invalid_request", message: "bad model" }
            : { v: 1, reply_to: frame.id, ev: "ok" };
        for (const fn of handlers.get("message") ?? []) {
          fn({ data: JSON.stringify(reply) });
        }
      });
    },
    close() {},
    addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: any) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    removeEventListener(type: "open" | "message" | "close" | "error", fn: (ev: any) => void) {
      handlers.get(type)?.delete(fn);
    },
  };

  const { adapter, dispose } = createWebSocketAdapter({ socket: fakeSocket });
  assert.equal(adapter.capabilities.platform, "web");
  await adapter.cancelTurn("s1");
  await assert.rejects(() => adapter.setModel("s1", "nope"), /invalid_request: bad model/);
  dispose();
});
