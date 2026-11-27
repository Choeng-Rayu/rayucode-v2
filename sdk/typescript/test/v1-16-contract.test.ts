/**
 * Harness API v1.16 contract tests:
 * - `hasCapability`, `getCapabilities`, `getConfig`, `patchConfig`, `config_changed`
 * - Frame fidelity (`seq`, `turn_id`, `duration_ms`, `stop_reason`, `origin`, `visibility`)
 * - Enriched `ModelRouteInfo` (`supported_efforts`, `default_effort`, `context_window`)
 * - Structured `ErrorCode` (`busy`, `unsupported`)
 * - Graceful `v1.15` downgrade when `capabilities_v1` / `config_v1` are absent
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_VERSION_MINOR,
  CAPABILITIES_CAPABILITY,
  CONFIG_CAPABILITY,
  FRAME_FIDELITY_CAPABILITY,
  HarnessError,
  RayucodeClient,
  type CapabilitiesPayload,
  type ConfigStatePayload,
  type HistoryMessage,
  type ModelRouteInfo,
  type ServerFrame,
} from "../dist/index.js";
import { startMockHarness } from "./mock-harness.ts";

test("v1.16 getCapabilities, getConfig, patchConfig, and config_changed round-trip", async () => {
  assert.equal(API_VERSION_MINOR, 16);

  const receivedRequests: Array<Record<string, unknown>> = [];
  let configValues: Record<string, unknown> = {
    "display.emoji": true,
    "compaction.mode": "auto",
  };

  let mockRef: Awaited<ReturnType<typeof startMockHarness>> | undefined;
  const mock = await startMockHarness({
    capabilities: [
      "sessions",
      "streaming",
      CAPABILITIES_CAPABILITY,
      CONFIG_CAPABILITY,
      FRAME_FIDELITY_CAPABILITY,
    ],
    onRequest(req, send) {
      receivedRequests.push(req);
      if (req.req === "get_capabilities") {
        send({
          v: 1,
          reply_to: req.id,
          ev: "capabilities",
          commands: [
            {
              name: "compact",
              description: "Summarize earlier conversation history",
              category: "session",
              requires_session: true,
              dispatch: { kind: "api_request", req: "compact" },
            },
            {
              name: "review",
              description: "Run an automated code review",
              category: "quality",
              arg_hint: "[focus]",
              requires_session: true,
              dispatch: { kind: "runtime_command", command: "review" },
            },
          ],
          permission_modes: [
            {
              id: "default",
              label: "Default",
              description: "Ask before risky operations",
              is_default: true,
            },
            {
              id: "plan",
              label: "Plan",
              description: "Read-only exploration",
              is_default: false,
            },
          ],
          features: [
            {
              key: "features.memory",
              enabled: true,
              description: "Enable semantic memory",
              requires_restart: false,
            },
          ],
        });
        return;
      }
      if (req.req === "get_config") {
        const sections = Array.isArray(req.sections)
          ? (req.sections as string[])
          : ["display", "compaction"];
        send({
          v: 1,
          reply_to: req.id,
          ev: "config_state",
          path: "/tmp/rayu-test/config.toml",
          sections,
          values: { ...configValues },
          schema: [
            {
              key: "display.emoji",
              section: "display",
              label: "Emoji",
              description: "Show emoji in TUI output",
              kind: "boolean",
              default_value: true,
              apply_mode: "immediate",
            },
            {
              key: "compaction.mode",
              section: "compaction",
              label: "Compaction Mode",
              description: "How transcript compaction runs",
              kind: "enum",
              options: [
                { value: "auto", label: "Automatic" },
                { value: "manual", label: "Manual" },
              ],
              default_value: "auto",
              apply_mode: "next_turn",
            },
          ],
        });
        return;
      }
      if (req.req === "patch_config") {
        const patch = req.patch as Record<string, unknown>;
        if ("provider.api_key" in patch) {
          send({
            v: 1,
            reply_to: req.id,
            ev: "error",
            code: "invalid_request",
            message: "unknown or disallowed config key: provider.api_key",
          });
          return;
        }
        configValues = { ...configValues, ...patch };
        send({
          v: 1,
          reply_to: req.id,
          ev: "config_state",
          path: "/tmp/rayu-test/config.toml",
          sections: ["display", "compaction"],
          values: { ...configValues },
          schema: [
            {
              key: "display.emoji",
              section: "display",
              label: "Emoji",
              description: "Show emoji in TUI output",
              kind: "boolean",
              default_value: true,
              apply_mode: "immediate",
            },
          ],
        });
        mockRef?.broadcast({
          v: 1,
          ev: "config_changed",
          changed_keys: Object.keys(patch),
          requires_restart: false,
          values: { ...configValues },
        });
      }
    },
  });
  mockRef = mock;

  const client = await RayucodeClient.connect({ socketPath: mock.socketPath });
  try {
    assert.equal(client.hasCapability(CAPABILITIES_CAPABILITY), true);
    assert.equal(client.hasCapability(CONFIG_CAPABILITY), true);
    assert.equal(client.hasCapability(FRAME_FIDELITY_CAPABILITY), true);
    assert.equal(client.hasCapability("nonexistent_cap"), false);

    const caps: CapabilitiesPayload | null = await client.getCapabilities("sess_1");
    assert.ok(caps);
    assert.equal(caps.commands.length, 2);
    assert.equal(caps.commands[0]?.name, "compact");
    assert.deepEqual(caps.commands[0]?.dispatch, { kind: "api_request", req: "compact" });
    assert.equal(caps.permission_modes[0]?.id, "default");
    assert.equal(caps.features[0]?.key, "features.memory");
    assert.equal(receivedRequests[0]?.session_id, "sess_1");

    const cfg: ConfigStatePayload | null = await client.getConfig(["display"]);
    assert.ok(cfg);
    assert.equal(cfg.path, "/tmp/rayu-test/config.toml");
    assert.deepEqual(cfg.sections, ["display"]);
    assert.equal(cfg.values["display.emoji"], true);
    assert.equal(cfg.schema[1]?.kind, "enum");
    assert.equal(cfg.schema[1]?.apply_mode, "next_turn");

    const changedPromise = new Promise<ServerFrame>((resolve) => {
      client.once("config_changed", (frame: ServerFrame) => resolve(frame));
    });
    const patched = await client.patchConfig({ "display.emoji": false });
    assert.equal(patched.values["display.emoji"], false);

    const changedEvent = await changedPromise;
    assert.equal(changedEvent.ev, "config_changed");
    assert.deepEqual(changedEvent.changed_keys, ["display.emoji"]);
    assert.equal(changedEvent.requires_restart, false);

    await assert.rejects(
      () => client.patchConfig({ "provider.api_key": "sk-secret" }),
      (err: unknown) =>
        err instanceof HarnessError &&
        err.code === "invalid_request" &&
        err.message.includes("provider.api_key"),
    );
  } finally {
    await client.close();
    await mock.close();
  }
});

test("v1.16 exposes frame fidelity, model route metadata, provenance, and busy/unsupported errors", async () => {
  const mock = await startMockHarness({
    capabilities: [
      "sessions",
      "streaming",
      CAPABILITIES_CAPABILITY,
      CONFIG_CAPABILITY,
      FRAME_FIDELITY_CAPABILITY,
    ],
    onRequest(req, send) {
      if (req.req === "ping") {
        send({ v: 1, reply_to: req.id, ev: "ok" });
      } else if (req.req === "get_runtime_info") {
        const route: ModelRouteInfo = {
          model: "claude-opus-4-6",
          provider: "anthropic",
          api_method: "messages",
          available: true,
          detail: "OAuth",
          supported_efforts: ["low", "medium", "high", "xhigh", "max"],
          default_effort: "high",
          context_window: 200_000,
        };
        send({
          v: 1,
          reply_to: req.id,
          ev: "runtime_info",
          session_id: req.session_id,
          provider: "anthropic",
          model: "claude-opus-4-6",
          reasoning_effort: "high",
          routes: [route],
        });
      } else if (req.req === "get_history") {
        const messages: HistoryMessage[] = [
          {
            role: "user",
            content: "Fix the bug",
            origin: "user_typed",
            visibility: "visible",
          },
          {
            role: "user",
            content: "Reassess the user's request",
            origin: "engine_internal",
            visibility: "hidden",
          },
          {
            role: "assistant",
            content: "Fixed!",
            origin: "legacy_unknown",
            visibility: "visible",
          },
        ];
        send({
          v: 1,
          reply_to: req.id,
          ev: "history",
          session_id: req.session_id,
          messages,
        });
      } else if (req.req === "set_model") {
        send({
          v: 1,
          reply_to: req.id,
          ev: "error",
          code: "busy",
          message: "turn in progress",
        });
      } else if (req.req === "set_reasoning_effort") {
        send({
          v: 1,
          reply_to: req.id,
          ev: "error",
          code: "unsupported",
          message: "reasoning effort is not supported for this model",
        });
      } else if (req.req === "send_message") {
        const sid = req.session_id;
        send({ v: 1, seq: 1, turn_id: "turn_42", ev: "message_accepted", session_id: sid });
        send({
          v: 1,
          seq: 2,
          turn_id: "turn_42",
          ev: "tool_done",
          session_id: sid,
          call_id: "call_1",
          name: "read",
          output: "ok",
          duration_ms: 145,
        });
        send({
          v: 1,
          seq: 3,
          turn_id: "turn_42",
          ev: "text_delta",
          session_id: sid,
          message_id: "m1",
          text: "Done.",
        });
        send({
          v: 1,
          seq: 4,
          turn_id: "turn_42",
          ev: "text_done",
          session_id: sid,
          message_id: "m1",
          stop_reason: "end_turn",
        });
        send({ v: 1, seq: 5, turn_id: "turn_42", ev: "turn_done", session_id: sid });
      }
    },
  });

  const client = await RayucodeClient.connect({ socketPath: mock.socketPath });
  try {
    const info = await client.getRuntimeInfo("sess_1");
    assert.deepEqual(info.routes[0]?.supported_efforts, ["low", "medium", "high", "xhigh", "max"]);
    assert.equal(info.routes[0]?.default_effort, "high");
    assert.equal(info.routes[0]?.context_window, 200_000);

    const history = await client.getHistory("sess_1");
    assert.equal(history.length, 3);
    assert.equal(history[0]?.origin, "user_typed");
    assert.equal(history[0]?.visibility, "visible");
    assert.equal(history[1]?.origin, "engine_internal");
    assert.equal(history[1]?.visibility, "hidden");
    assert.equal(history[2]?.origin, "legacy_unknown");

    await assert.rejects(
      () => client.setModel("sess_1", "gpt-5"),
      (err: unknown) => err instanceof HarnessError && err.code === "busy",
    );
    await assert.rejects(
      () => client.setReasoningEffort("sess_1", "high"),
      (err: unknown) => err instanceof HarnessError && err.code === "unsupported",
    );

    const observedFrames: ServerFrame[] = [];
    client.on("event", (frame: ServerFrame) => observedFrames.push(frame));
    const turn = await client.run("sess_1", "Run check");
    assert.equal(turn.finalText, "Done.");
    assert.equal(turn.messages[0]?.stopReason, "end_turn");
    assert.equal(turn.toolCalls[0]?.durationMs, 145);

    const seqs = observedFrames.map((f) => f.seq);
    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
    assert.ok(observedFrames.every((f) => f.turn_id === "turn_42"));
  } finally {
    await client.close();
    await mock.close();
  }
});

test("v1.15 legacy daemon downgrades getCapabilities and getConfig gracefully to null", async () => {
  const requestsSeen: string[] = [];
  const mock = await startMockHarness({
    capabilities: [],
    onRequest(req, send) {
      requestsSeen.push(String(req.req));
      send({
        v: 1,
        reply_to: req.id,
        ev: "error",
        code: "unknown_request",
        message: `unknown request: ${req.req}`,
      });
    },
  });

  const client = await RayucodeClient.connect({ socketPath: mock.socketPath });
  try {
    assert.equal(client.hasCapability(CAPABILITIES_CAPABILITY), false);
    assert.equal(client.hasCapability(CONFIG_CAPABILITY), false);
    assert.equal(client.hasCapability(FRAME_FIDELITY_CAPABILITY), false);

    const caps = await client.getCapabilities();
    assert.equal(caps, null);

    const cfg = await client.getConfig(["display"]);
    assert.equal(cfg, null);

    // Neither call should even have sent a wire request to the v1.15 server.
    assert.deepEqual(requestsSeen, []);

    await assert.rejects(
      () => client.patchConfig({ "display.emoji": false }),
      (err: unknown) => err instanceof HarnessError && err.code === "unsupported",
    );
  } finally {
    await client.close();
    await mock.close();
  }
});

test("defensive downgrade returns null if server replies unknown_request or unsupported", async () => {
  const mock = await startMockHarness({
    capabilities: [CAPABILITIES_CAPABILITY, CONFIG_CAPABILITY],
    onRequest(req, send) {
      if (req.req === "get_capabilities") {
        send({
          v: 1,
          reply_to: req.id,
          ev: "error",
          code: "unknown_request",
          message: "not implemented",
        });
      } else if (req.req === "get_config") {
        send({
          v: 1,
          reply_to: req.id,
          ev: "error",
          code: "unsupported",
          message: "config RPC disabled",
        });
      }
    },
  });

  const client = await RayucodeClient.connect({ socketPath: mock.socketPath });
  try {
    assert.equal(await client.getCapabilities(), null);
    assert.equal(await client.getConfig(), null);
  } finally {
    await client.close();
    await mock.close();
  }
});
