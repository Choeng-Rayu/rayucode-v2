import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import type { ServerFrame } from "@rayu-dev/rayucode-sdk";
import { startMockHarness } from "../../sdk/typescript/test/mock-harness.js";
import { HarnessSession } from "../host/harnessSession.js";

test("the editor scopes sessions and acknowledges sends through a tool-free Harness turn", async (t) => {
  const requests: string[] = [];
  const events: ServerFrame[] = [];
  const eventsReceived = new EventEmitter();
  let denyConfiguration = false;
  let failTurn = false;
  const fixture = { session_id: "editor", status: "idle", working_dir: "/fixture" };
  const nextFixture = { ...fixture, session_id: "second" };
  const harness = await startMockHarness({
    capabilities: ["session_tools"],
    onRequest(request, send) {
      requests.push(request.req);
      const reply = { v: 1, reply_to: request.id };
      switch (request.req) {
        case "create_session":
          assert.equal(request.working_dir, fixture.working_dir);
          send({ ...reply, ev: "attached", session: harness.clientCount() === 2 ? nextFixture : fixture });
          break;
        case "attach_session":
          assert.equal(request.session_id, fixture.session_id);
          send({ ...reply, ev: "attached", session: fixture });
          break;
        case "list_sessions":
          send({ ...reply, ev: "sessions", sessions: [fixture, { session_id: "terminal", status: "idle" }] });
          break;
        case "configure_tools":
          assert.deepEqual(request.tools.enabled, []);
          send(denyConfiguration
            ? { ...reply, ev: "error", code: "invalid_request", message: "configuration refused" }
            : { ...reply, ev: "ok" });
          break;
        case "send_message":
          assert.equal(request.content, "hello");
          send({ v: 1, ev: "message_accepted", session_id: fixture.session_id });
          send({ v: 1, ev: "text_delta", session_id: "terminal", text: "unrelated" });
          if (failTurn) send({ v: 1, ev: "error", code: "internal", message: "Provider failed" });
          break;
        case "cancel":
          send({ ...reply, ev: "ok" });
          send({ v: 1, ev: "turn_done", session_id: fixture.session_id });
          break;
      }
    },
  });
  const owned: string[] = [];
  const session = new HarnessSession({
    socketPath: () => harness.socketPath,
    chooseWorkspace: async () => "/fixture",
    sessions: () => owned,
    selected: () => owned.at(-1),
    remember: async (sessionId, created) => { if (created) owned.push(sessionId); },
    emit: (frame) => {
      events.push(frame);
      eventsReceived.emit("frame:" + frame.ev);
    },
  });
  t.after(async () => {
    session.dispose();
    await harness.close();
  });

  await assert.rejects(session.request({ req: "attach_session", session_id: "terminal" }), /created by this VS Code workspace/);
  assert.deepEqual(await session.request({ req: "create_session", working_dir: "/ignored" }), { ev: "attached", session: fixture });
  assert.deepEqual(await session.request({ req: "list_sessions" }), { ev: "sessions", sessions: [fixture] });

  const prompt = { req: "send_message", session_id: "editor", content: "hello" };
  denyConfiguration = true;
  await assert.rejects(session.request(prompt), /configuration refused/);
  assert.equal(requests.includes("send_message"), false);
  denyConfiguration = false;
  assert.deepEqual(await session.request(prompt), { ev: "ok" });
  assert.deepEqual(requests.slice(-2), ["configure_tools", "send_message"]);
  await assert.rejects(session.request(prompt), /current turn/);
  const done = once(eventsReceived, "frame:turn_done");
  assert.deepEqual(await session.request({ req: "cancel", session_id: "editor" }), { ev: "ok" });
  await done;
  assert.deepEqual(events.map((frame) => frame.ev), ["message_accepted", "turn_done"]);
  assert.deepEqual(await session.request({ req: "create_session" }), { ev: "attached", session: nextFixture });
  assert.deepEqual(await session.request({ req: "attach_session", session_id: "editor" }), { ev: "attached", session: fixture });
  failTurn = true;
  const terminalError = once(eventsReceived, "frame:error");
  assert.deepEqual(await session.request(prompt), { ev: "ok" });
  await terminalError;
  failTurn = false;
  assert.deepEqual(await session.request(prompt), { ev: "ok" });
});

test("reconnecting discards late attachments and uses the new runtime socket", async (t) => {
  const oldSession = { session_id: "old", status: "idle" };
  const newSession = { session_id: "new", status: "idle" };
  const events: ServerFrame[] = [];
  const received = new EventEmitter();
  let replyToAttach: (() => void) | undefined;
  const oldRuntime = await startMockHarness({
    onRequest(request, send) {
      if (request.req !== "attach_session") return;
      replyToAttach = () => send({ v: 1, reply_to: request.id, ev: "attached", session: oldSession });
      received.emit("attach");
    },
  });
  const newRuntime = await startMockHarness({
    onRequest(request, send) {
      if (request.req === "attach_session") {
        send({ v: 1, reply_to: request.id, ev: "attached", session: newSession });
      } else if (request.req === "list_sessions") {
        send({ v: 1, reply_to: request.id, ev: "sessions", sessions: [newSession] });
      }
    },
  });
  let socketPath = oldRuntime.socketPath;
  const session = new HarnessSession({
    socketPath: () => socketPath,
    chooseWorkspace: async () => "/fixture",
    sessions: () => ["old", "new"],
    selected: () => "old",
    remember: async () => {},
    emit: (frame) => events.push(frame),
  });
  t.after(async () => {
    session.dispose();
    await Promise.all([oldRuntime.close(), newRuntime.close()]);
  });

  const started = once(received, "attach");
  const oldAttachment = session.request({ req: "attach_session", session_id: "old" });
  await started;
  socketPath = newRuntime.socketPath;
  session.resetConnection();
  replyToAttach!();
  await assert.rejects(oldAttachment, { code: "disconnected" });
  assert.equal(events[0]?.ev, "connection_phase");
  assert.deepEqual(await session.request({ req: "list_sessions" }), { ev: "sessions", sessions: [newSession] });
  assert.deepEqual(await session.request({ req: "attach_session", session_id: "new" }), { ev: "attached", session: newSession });
});
