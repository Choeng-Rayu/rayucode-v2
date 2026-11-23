import { test } from "node:test";
import assert from "node:assert/strict";
import { RayucodeClient, HarnessError, type RuntimeCommand } from "../dist/index.js";
import { startMockHarness } from "./mock-harness.ts";

test("runtime commands revalidate stale hello capabilities without retrying mutations", async () => {
  const requests: any[] = [];
  const server = await startMockHarness({
    capabilities: [],
    onRequest(request, send) {
      requests.push(request);
      send({ v: 1, reply_to: request.id, ev: "runtime_command_result",
        session_id: request.session_id, command: request.command,
        data: { enabled: false }, message: "Memory off" });
    },
  });
  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  try {
    assert.deepEqual(client.capabilities, []);
    const output = await client.runtimeCommand("runtime-session", "memory", ["off"]);
    assert.deepEqual(output.data, { enabled: false });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].req, "runtime_command");
    assert.equal(requests[0].session_id, "runtime-session");
    assert.deepEqual(requests[0].args, ["off"]);
    assert.equal(requests[0].content, undefined);
  } finally {
    client.close();
    await server.close();
  }
});

test("runtime commands preserve an old bridge rejection without resubmitting", async () => {
  let count = 0;
  const server = await startMockHarness({
    capabilities: [],
    onRequest(request, send) {
      count++;
      send({ v: 1, reply_to: request.id, ev: "error", code: "unknown_request",
        message: "Upgrade the runtime host with rayu server reload" });
    },
  });
  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  try {
    await assert.rejects(() => client.runtimeCommand("runtime-session", "skills"), (error: unknown) => {
      assert.ok(error instanceof HarnessError);
      assert.equal(error.code, "unknown_request");
      assert.match(error.message, /rayu server reload/);
      return true;
    });
    assert.equal(count, 1);
  } finally {
    client.close();
    await server.close();
  }
});

test("runtime commands support all v1.14 extensions", async () => {
  const seen: RuntimeCommand[] = [];
  const server = await startMockHarness({
    capabilities: [
      "runtime_commands",
      "background_tasks",
      "swarm_control",
      "mcp_control",
      "telegram_control",
      "config_features",
      "doctor",
    ],
    onRequest(request, send) {
      seen.push(request.command);
      send({
        v: 1,
        reply_to: request.id,
        ev: "runtime_command_result",
        session_id: request.session_id,
        command: request.command,
        data: { ok: true, command: request.command, args: request.args ?? [] },
        message: `${request.command} ok`,
      });
    },
  });
  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  try {
    const v114Commands: RuntimeCommand[] = [
      "background",
      "mcp",
      "telegram",
      "features",
      "doctor",
      "session_search",
      "schedules",
      "ambient",
    ];
    for (const cmd of v114Commands) {
      const res = await client.runtimeCommand("sess-v114", cmd, ["status"]);
      assert.equal(res.command, cmd);
      assert.equal(res.session_id, "sess-v114");
      assert.deepEqual(res.data, { ok: true, command: cmd, args: ["status"] });
    }
    assert.deepEqual(seen, v114Commands);
  } finally {
    client.close();
    await server.close();
  }
});
