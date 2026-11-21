import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerFrame } from "@rayu-dev/rayucode-sdk";
import { startMockHarness } from "../../sdk/typescript/test/mock-harness.js";
import { HarnessSession } from "../host/harnessSession.js";

test("the editor scopes sessions and acknowledges sends through a tool-free Harness turn", async (t) => {
  const requests: string[] = [];
  const events: ServerFrame[] = [];
  let denyConfiguration = false;
  const fixture = { session_id: "editor", status: "idle", working_dir: "/fixture" };
  const harness = await startMockHarness({
    capabilities: ["session_tools"],
    onRequest(request, send) {
      requests.push(request.req);
      const reply = { v: 1, reply_to: request.id };
      switch (request.req) {
        case "create_session":
          assert.equal(request.working_dir, fixture.working_dir);
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
    emit: (frame) => events.push(frame),
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
  assert.deepEqual(await session.request({ req: "cancel", session_id: "editor" }), { ev: "ok" });
  assert.deepEqual(events.map((frame) => frame.ev), ["message_accepted", "turn_done"]);
});
