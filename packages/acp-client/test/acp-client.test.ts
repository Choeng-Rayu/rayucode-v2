import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import {
  ACP_ERROR_AUTH_REQUIRED,
  AcpClient,
  AcpRpcError,
  buildAcpLaunchSpec,
  buildIdeAcpConfig,
  isAuthRequiredError,
  type RayuServerEventNotification,
  type SessionUpdateNotification,
} from "../src/index.js";

function createHarness() {
  const clientToAgent = new PassThrough();
  const agentToClient = new PassThrough();
  const client = new AcpClient({
    input: agentToClient,
    output: clientToAgent,
    close: () => {
      clientToAgent.end();
      agentToClient.end();
    },
  });

  const agentRl = createInterface({ input: clientToAgent, crlfDelay: Infinity });
  const sendFromAgent = (msg: Record<string, unknown>) => {
    agentToClient.write(`${JSON.stringify(msg)}\n`);
  };

  return { client, agentRl, sendFromAgent, clientToAgent, agentToClient };
}

describe("@rayu-dev/rayucode-acp-client", () => {
  it("handles bidirectional session lifecycle, permissions, updates, and Rayu extensions", async () => {
    const { client, agentRl, sendFromAgent } = createHarness();
    const updates: SessionUpdateNotification[] = [];
    const rayuEvents: RayuServerEventNotification[] = [];

    client.onSessionUpdate((u) => updates.push(u));
    client.onRayuServerEvent((e) => rayuEvents.push(e));
    client.onPermissionRequest(async (params) => {
      expect(params.sessionId).toBe("ses_1");
      expect(params.toolCall.kind).toBe("execute");
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    });

    const receivedFromClient: Array<Record<string, unknown>> = [];
    agentRl.on("line", (line) => {
      const msg = JSON.parse(line) as Record<string, unknown>;
      receivedFromClient.push(msg);

      if (msg.method === "initialize") {
        sendFromAgent({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
              sessionCapabilities: { list: {}, fork: {}, resume: {}, close: {}, delete: {} },
              mcpCapabilities: { http: true, sse: true },
              _meta: { rayu: { profile: "extended", extensions: ["raw_server_event"] } },
            },
            agentInfo: { name: "rayu", title: "RayuCode", version: "3.0.0" },
            authMethods: [{ id: "rayu-login", name: "Sign in with Rayu" }],
          },
        });
      } else if (msg.method === "session/new") {
        sendFromAgent({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            sessionId: "ses_1",
            modes: {
              currentModeId: "default",
              availableModes: [{ id: "default", name: "Default" }],
            },
          },
        });
      } else if (msg.method === "session/list") {
        sendFromAgent({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            sessions: [{ sessionId: "ses_1", cwd: "/repo", title: "Work" }],
            nextCursor: "50",
          },
        });
      } else if (msg.method === "session/fork") {
        sendFromAgent({
          jsonrpc: "2.0",
          id: msg.id,
          result: { sessionId: "ses_1_fork" },
        });
      } else if (msg.method === "session/set_mode") {
        sendFromAgent({ jsonrpc: "2.0", id: msg.id, result: {} });
        sendFromAgent({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "ses_1",
            update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
          },
        });
      } else if (msg.method === "session/prompt") {
        sendFromAgent({
          jsonrpc: "2.0",
          method: "_rayu/server_event",
          params: { sessionId: "ses_1", event: { type: "rayu_credits", credits: 0.01 } },
        });
        sendFromAgent({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "ses_1",
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "planning" },
            },
          },
        });
        // Send Agent -> Client permission request
        sendFromAgent({
          jsonrpc: "2.0",
          id: 99,
          method: "session/request_permission",
          params: {
            sessionId: "ses_1",
            toolCall: {
              toolCallId: "tc_1",
              title: "Run `pnpm test`",
              kind: "execute",
              status: "pending",
            },
            options: [{ optionId: "allow_once", name: "Allow once", kind: "allow_once" }],
          },
        });
      } else if (!msg.method && msg.id === 99) {
        // Permission reply received from client! Complete the prompt turn.
        expect((msg.result as Record<string, unknown>).outcome).toEqual({
          outcome: "selected",
          optionId: "allow_once",
        });
        const promptReq = receivedFromClient.find((m) => m.method === "session/prompt");
        sendFromAgent({
          jsonrpc: "2.0",
          id: promptReq?.id,
          result: { stopReason: "end_turn" },
        });
      } else if (msg.method === "session/delete") {
        sendFromAgent({ jsonrpc: "2.0", id: msg.id, result: {} });
      }
    });

    const init = await client.initialize({
      clientInfo: { name: "rayucode-desktop", version: "0.1.0" },
      profile: "extended",
      product: "studio",
    });
    expect(init.agentCapabilities.sessionCapabilities?.list).toBeDefined();
    expect(init.agentCapabilities.sessionCapabilities?.fork).toBeDefined();

    const created = await client.newSession({ cwd: "/repo" });
    expect(created.sessionId).toBe("ses_1");

    const listed = await client.listSessions({ cwd: "/repo" });
    expect(listed.sessions[0].sessionId).toBe("ses_1");
    expect(listed.nextCursor).toBe("50");

    const forked = await client.forkSession({ sessionId: "ses_1", cwd: "/repo" });
    expect(forked.sessionId).toBe("ses_1_fork");

    await client.setMode({ sessionId: "ses_1", modeId: "plan" });

    const promptRes = await client.prompt({
      sessionId: "ses_1",
      prompt: [{ type: "text", text: "run tests" }],
    });
    expect(promptRes.stopReason).toBe("end_turn");
    expect(updates.some((u) => u.update.sessionUpdate === "current_mode_update")).toBe(true);
    expect(updates.some((u) => u.update.sessionUpdate === "agent_thought_chunk")).toBe(true);
    expect(rayuEvents).toHaveLength(1);

    await client.deleteSession({ sessionId: "ses_1_fork" });
    await client.dispose();
  });

  it("detects structured -32000 auth_required errors and exposes authMethods", async () => {
    const { client, agentRl, sendFromAgent } = createHarness();
    agentRl.on("line", (line) => {
      const msg = JSON.parse(line) as Record<string, unknown>;
      if (msg.method === "session/new") {
        sendFromAgent({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: ACP_ERROR_AUTH_REQUIRED,
            message: "Rayu authentication required.",
            data: {
              errorKind: "auth_required",
              authMethods: [{ id: "rayu-login", name: "Sign in with Rayu" }],
            },
          },
        });
      }
    });

    await expect(client.newSession({ cwd: "/repo" })).rejects.toSatisfy((err: unknown) => {
      expect(isAuthRequiredError(err)).toBe(true);
      const rpcErr = err as AcpRpcError;
      expect(rpcErr.authMethods()[0].id).toBe("rayu-login");
      return true;
    });
    await client.dispose();
  });

  it("builds consistent IDE and first-party product ACP launch configs", () => {
    const desktopSpec = buildAcpLaunchSpec({ profile: "extended", product: "studio" });
    expect(desktopSpec.args).toEqual(["acp", "--profile", "extended", "--product", "studio"]);
    expect(desktopSpec.env.RAYU_CLIENT_PRODUCT).toBe("studio");

    const zed = buildIdeAcpConfig("zed", { command: "/usr/local/bin/rayu" }) as {
      agent_servers: { RayuCode: { command: string; args: string[] } };
    };
    expect(zed.agent_servers.RayuCode.command).toBe("/usr/local/bin/rayu");
    expect(zed.agent_servers.RayuCode.args).toEqual(["acp"]);

    const vscode = buildIdeAcpConfig("vscode") as {
      args: string[];
      env: Record<string, string>;
    };
    expect(vscode.args).toEqual(["acp", "--profile", "extended", "--product", "rayucode"]);
    expect(vscode.env.RAYU_CLIENT_PRODUCT).toBe("rayucode");

    const nvim = buildIdeAcpConfig("neovim-codecompanion") as {
      adapters: { acp: { rayucode: { commands: { default: string[] } } } };
    };
    expect(nvim.adapters.acp.rayucode.commands.default).toEqual(["rayu", "acp"]);
  });

  it("rejects cleanly instead of crashing when spawned binary does not exist", async () => {
    const client = AcpClient.spawn({
      binaryPath: "/nonexistent/rayu-acp-test-binary-404",
    });
    const closed = new Promise<Error | undefined>((resolve) => {
      client.onClose((err) => resolve(err));
    });
    await expect(client.initialize()).rejects.toThrow();
    const err = await closed;
    expect(err).toBeDefined();
    await client.dispose();
  });
});
