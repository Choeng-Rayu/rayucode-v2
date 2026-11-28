import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  RayuHostAuthManager,
  getRayuApiBase,
  getRayuGatewayBase,
  getRayuWebBase,
  isSafeRayuBaseUrl,
  parseHostedModelsPayload,
  resolveRayuAppConfigDir,
  resolveRayuAuthDir,
} from "../host/auth/rayuHostAuthManager.js";

interface MockRayuServer {
  baseUrl: string;
  requests: Array<{
    method: string;
    path: string;
    auth?: string;
    body?: Record<string, unknown>;
  }>;
  setEntitlementsHandler(
    handler: () =>
      | { status: number; body: unknown }
      | null
      | Promise<{ status: number; body: unknown } | null>,
  ): void;
  setGatewayModelsHandler(
    handler: () =>
      | { status: number; body: unknown }
      | null
      | Promise<{ status: number; body: unknown } | null>,
  ): void;
  close(): Promise<void>;
}

async function startMockRayuServer(options?: {
  rejectApiKey?: boolean;
  rejectRefresh?: boolean;
  creditsResponse?: Record<string, unknown>;
  entitlementsResponse?: { status: number; body: unknown };
  gatewayModelsResponse?: { status: number; body: unknown };
}): Promise<MockRayuServer> {
  const requests: MockRayuServer["requests"] = [];
  let limitMode: "gated" | "full_credits" = "gated";
  let entitlementsHandler: () =>
    | { status: number; body: unknown }
    | null
    | Promise<{ status: number; body: unknown } | null> = () =>
    options?.entitlementsResponse ?? {
      status: 200,
      body: {
        hostedModels: [
          {
            code: "claude-sonnet-4-6",
            label: "Claude Sonnet 4.6",
            description: "Balanced coding model",
            supportsEffort: true,
            supportsFast: true,
          },
          {
            code: "rayu:claude-opus-4-6",
            label: "Claude Opus 4.6",
            description: "Flagship reasoning",
          },
        ],
      },
    };
  let gatewayModelsHandler: () =>
    | { status: number; body: unknown }
    | null
    | Promise<{ status: number; body: unknown } | null> = () =>
    options?.gatewayModelsResponse ?? {
      status: 200,
      body: {
        object: "list",
        data: [
          {
            id: "claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            description: "Gateway catalog model",
          },
          {
            id: "gpt-5.4",
            name: "GPT-5.4",
          },
        ],
      },
    };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let parsedBody: Record<string, unknown> | undefined;
      if (rawBody.trim()) {
        try {
          parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          parsedBody = undefined;
        }
      }
      const reqPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const auth = req.headers.authorization;
      requests.push({
        method: req.method ?? "GET",
        path: reqPath,
        auth,
        body: parsedBody,
      });

      const sendJson = (status: number, data: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };

      if (
        req.method === "POST" &&
        (reqPath === "/api/vscode/token" || reqPath === "/api/cli/token")
      ) {
        sendJson(200, {
          accessToken:
            reqPath === "/api/vscode/token"
              ? "jwt_vscode_access_1"
              : "jwt_cli_access_1",
          refreshToken: "rt_rayu_refresh_1",
          expiresAt: Date.now() + 3_600_000,
          user: {
            id: 42,
            email: "alice@rayucode.com",
            displayName: "Alice Rayu",
            avatarUrl: "https://rayucode.com/avatars/alice.png",
            role: "user",
          },
        });
        return;
      }

      if (req.method === "POST" && reqPath === "/api/cli/refresh") {
        if (options?.rejectRefresh) {
          sendJson(401, { message: "Refresh token revoked" });
          return;
        }
        sendJson(200, {
          accessToken: "jwt_refreshed_access_2",
          refreshToken: "rt_rayu_refresh_2",
          expiresAt: Date.now() + 3_600_000,
        });
        return;
      }

      if (req.method === "GET" && reqPath === "/api/me") {
        if (!auth?.startsWith("Bearer jwt_")) {
          sendJson(401, { message: "Unauthorized" });
          return;
        }
        sendJson(200, {
          user: {
            id: 42,
            email: "alice@rayucode.com",
            displayName: "Alice Rayu Live",
            avatarUrl: "https://rayucode.com/avatars/alice-live.png",
            role: "member",
          },
          status: "active",
        });
        return;
      }

      if (req.method === "GET" && reqPath === "/v1/credits") {
        if (options?.rejectApiKey || auth === "Bearer rayu_sk_live_revoked") {
          sendJson(401, { message: "Invalid API key" });
          return;
        }
        sendJson(
          200,
          options?.creditsResponse ?? {
            plan: "plus",
            planName: "Plus",
            creditsPerPeriod: 200_000,
            usedCredits: 50_000,
            remainingCredits: 150_000,
            resetSeconds: 86_400 * 10,
            periodEnd: "2026-12-01T00:00:00.000Z",
            topupBalance: 12_500,
            topUpEnabled: true,
            creditsPer5h: 10_000,
            windowUsedCredits: 2_000,
            windowResetSeconds: 7_200,
            sessionWindowMinutes: 300,
            creditsPerWeek: 60_000,
            weekUsedCredits: 15_000,
            weekResetSeconds: 86_400 * 3,
            limitMode,
          },
        );
        return;
      }

      if (req.method === "PUT" && reqPath === "/api/billing/limit-mode") {
        if (!auth?.startsWith("Bearer jwt_")) {
          sendJson(401, { message: "Unauthorized" });
          return;
        }
        limitMode =
          parsedBody?.limitMode === "full_credits" ? "full_credits" : "gated";
        sendJson(200, { limitMode });
        return;
      }

      if (req.method === "GET" && reqPath === "/api/me/entitlements") {
        if (!auth?.startsWith("Bearer jwt_")) {
          sendJson(401, { message: "Unauthorized" });
          return;
        }
        void Promise.resolve(entitlementsHandler()).then((reply) => {
          if (!reply) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{malformed-json");
            return;
          }
          sendJson(reply.status, reply.body);
        });
        return;
      }

      if (req.method === "GET" && reqPath === "/v1/models") {
        if (!auth?.startsWith("Bearer ")) {
          sendJson(401, { message: "Unauthorized" });
          return;
        }
        void Promise.resolve(gatewayModelsHandler()).then((reply) => {
          if (!reply) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{malformed-json");
            return;
          }
          sendJson(reply.status, reply.body);
        });
        return;
      }

      sendJson(404, { message: `Unhandled route ${req.method} ${reqPath}` });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    setEntitlementsHandler: (handler) => {
      entitlementsHandler = handler;
    },
    setGatewayModelsHandler: (handler) => {
      gatewayModelsHandler = handler;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function withIsolatedAuthEnv<T>(
  serverBaseUrl: string,
  fn: (dirs: { rayuHome: string; xdgConfig: string }) => Promise<T>,
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-auth-test-"));
  const rayuHome = path.join(tempRoot, "rayu-home");
  const xdgConfig = path.join(tempRoot, "xdg-config");
  fs.mkdirSync(rayuHome, { recursive: true });
  fs.mkdirSync(xdgConfig, { recursive: true });

  const envKeys = [
    "RAYU_AUTH_CONFIG_DIR",
    "RAYU_HOME",
    "RAYU_CONFIG_DIR",
    "XDG_CONFIG_HOME",
    "RAYU_API_KEY",
    "RAYU_API_URL",
    "RAYU_WEB_URL",
    "RAYU_GATEWAY_URL",
  ] as const;

  const saved: Record<string, string | undefined> = {};
  for (const k of envKeys) saved[k] = process.env[k];

  delete process.env.RAYU_AUTH_CONFIG_DIR;
  delete process.env.RAYU_CONFIG_DIR;
  delete process.env.RAYU_API_KEY;
  process.env.RAYU_HOME = rayuHome;
  process.env.XDG_CONFIG_HOME = xdgConfig;
  process.env.RAYU_API_URL = `${serverBaseUrl}/api`;
  process.env.RAYU_WEB_URL = serverBaseUrl;
  process.env.RAYU_GATEWAY_URL = serverBaseUrl;

  return fn({ rayuHome, xdgConfig }).finally(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
}

test("validates base URLs and rejects insecure non-loopback HTTP overrides", () => {
  assert.equal(isSafeRayuBaseUrl("https://api.rayucode.com/api"), true);
  assert.equal(isSafeRayuBaseUrl("http://127.0.0.1:4000/api"), true);
  assert.equal(isSafeRayuBaseUrl("http://localhost:3000"), true);
  assert.equal(isSafeRayuBaseUrl("http://evil.example.com/api"), false);
  assert.equal(isSafeRayuBaseUrl("https://user:pass@api.rayucode.com"), false);

  const prev = process.env.RAYU_API_URL;
  process.env.RAYU_API_URL = "http://insecure.example.com/api";
  try {
    assert.equal(getRayuApiBase(), "https://api.rayucode.com/api");
  } finally {
    if (prev === undefined) delete process.env.RAYU_API_URL;
    else process.env.RAYU_API_URL = prev;
  }
});

test("VS Code deep-link OAuth flow exchanges at /vscode/token, writes 0600 rayu-auth.json, fetches /me + /v1/credits, and rejects CSRF mismatch", async () => {
  const mock = await startMockRayuServer();
  try {
    await withIsolatedAuthEnv(mock.baseUrl, async ({ rayuHome }) => {
      const notifiedProviders: string[] = [];
      const manager = new RayuHostAuthManager({
        daemonBridge: {
          notifyAuthChanged: async (provider) => {
            notifiedProviders.push(provider);
          },
        },
      });

      try {
        // Signed-out snapshot never fabricates fake profile/credits
        const initial = await manager.getAccountStatus();
        assert.equal(initial.signedIn, false);
        assert.equal(initial.authMethod, "none");
        assert.equal(initial.displayName, undefined);
        assert.equal(initial.email, undefined);
        assert.equal(initial.creditsRemaining, undefined);
        assert.deepEqual(initial.windows, []);
        assert.equal(getRayuWebBase(), mock.baseUrl);
        assert.equal(getRayuGatewayBase(), mock.baseUrl);

        // Start VS Code deep-link sign-in
        const started = await manager.startBrowserSignIn("vscode");
        assert.equal(started.ok, true);
        const loginUrl = new URL(started.authUrl);
        assert.equal(loginUrl.pathname, "/vscode-login");
        const state = loginUrl.searchParams.get("state");
        assert.ok(state && /^[a-f0-9]{32}$/.test(state));
        assert.equal(started.state.signingIn, true);
        assert.equal(started.state.pendingMode, "vscode");
        assert.equal(started.state.pendingAuthUrl, started.authUrl);

        // CSRF state mismatch MUST reject
        await assert.rejects(
          manager.handleUriCallback(
            `vscode://rayucode.rayucode/auth?code=code_123&state=wrong_state`,
          ),
          /OAuth state mismatch/,
        );

        // Start fresh and redeem valid deep-link URI callback
        const started2 = await manager.startBrowserSignIn("vscode");
        const state2 = new URL(started2.authUrl).searchParams.get("state")!;
        const account = await manager.handleUriCallback(
          `vscode://rayucode.rayucode/auth?code=vscode_code_abc&state=${state2}`,
        );

        assert.equal(account.signedIn, true);
        assert.equal(account.authMethod, "oauth");
        assert.equal(account.signingIn, false);
        assert.equal(account.pendingAuthUrl, null);
        assert.equal(account.displayName, "Alice Rayu Live");
        assert.equal(account.email, "alice@rayucode.com");
        assert.equal(account.avatarUrl, "https://rayucode.com/avatars/alice-live.png");
        assert.equal(account.userId, "42");
        assert.equal(account.role, "member");
        assert.equal(account.planName, "Plus");
        assert.equal(account.creditsRemaining, 150_000);
        assert.equal(account.creditsPerPeriod, 200_000);
        assert.equal(account.usedCredits, 50_000);
        assert.equal(account.topUpBalance, 12_500);
        assert.equal(account.topUpEnabled, true);
        assert.equal(account.bypassPacing, false);
        assert.equal(account.windows.length, 3);
        assert.equal(account.windows[0]?.label, "5h session window");
        assert.equal(account.windows[0]?.usedPercent, 20);
        assert.equal(account.windows[1]?.label, "Weekly limit");
        assert.equal(account.windows[1]?.usedPercent, 25);
        assert.equal(account.windows[2]?.label, "Monthly allowance");
        assert.equal(account.windows[2]?.usedPercent, 25);

        // Verify accurate RayuCode plan ladder
        assert.equal(
          account.planLadder?.find((p) => p.id === "pro")?.priceLabel,
          "$10/mo",
        );
        assert.equal(
          account.planLadder?.find((p) => p.id === "plus")?.priceLabel,
          "$20/mo",
        );
        assert.equal(
          account.planLadder?.find((p) => p.id === "plus")?.current,
          true,
        );
        assert.equal(
          account.planLadder?.find((p) => p.id === "max")?.priceLabel,
          "$50/mo",
        );
        assert.equal(
          account.planLadder?.find((p) => p.id === "team_max")?.priceLabel,
          "$79/mo",
        );

        // Verify POST /api/vscode/token was called
        const tokenReq = mock.requests.find((r) => r.path === "/api/vscode/token");
        assert.ok(tokenReq);
        assert.deepEqual(tokenReq.body, {
          code: "vscode_code_abc",
          state: state2,
        });

        // Verify rayu-auth.json exists with 0600 permissions
        const sessionPath = path.join(rayuHome, "rayu-auth.json");
        assert.equal(resolveRayuAuthDir(), rayuHome);
        assert.equal(fs.existsSync(sessionPath), true);
        if (process.platform !== "win32") {
          const mode = fs.statSync(sessionPath).mode & 0o777;
          assert.equal(mode, 0o600);
        }

        // Verify daemon notification fired
        assert.deepEqual(notifiedProviders, ["rayu"]);

        // Verify setBypassPacing calls PUT /api/billing/limit-mode
        const pacingRes = await manager.setBypassPacing(true);
        assert.deepEqual(pacingRes, { ok: true, enabled: true });
        const limitReq = mock.requests.find(
          (r) => r.method === "PUT" && r.path === "/api/billing/limit-mode",
        );
        assert.ok(limitReq);
        assert.deepEqual(limitReq.body, { limitMode: "full_credits" });
        assert.equal(manager.getAccountStatusSnapshot().bypassPacing, true);
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});

test("loopback OAuth flow binds 127.0.0.1:0, redeems /cli/token, and cancelSignIn closes server cleanly", async () => {
  const mock = await startMockRayuServer();
  try {
    await withIsolatedAuthEnv(mock.baseUrl, async () => {
      const manager = new RayuHostAuthManager();
      try {
        const started = await manager.startBrowserSignIn("loopback");
        const loginUrl = new URL(started.authUrl);
        assert.equal(loginUrl.pathname, "/cli-login");
        const port = Number(loginUrl.searchParams.get("port"));
        const state = loginUrl.searchParams.get("state")!;
        assert.ok(port > 0);
        assert.equal(started.state.pendingMode, "loopback");

        // Hit the loopback callback server
        const cbRes = await fetch(
          `http://127.0.0.1:${port}/callback?code=cli_code_999&state=${state}`,
        );
        assert.equal(cbRes.status, 200);
        const html = await cbRes.text();
        assert.match(html, /Signed in to RayuCode/);

        const status = manager.getAccountStatusSnapshot();
        assert.equal(status.signedIn, true);
        assert.equal(status.authMethod, "oauth");
        assert.equal(status.signingIn, false);

        const cliTokenReq = mock.requests.find((r) => r.path === "/api/cli/token");
        assert.ok(cliTokenReq);
        assert.deepEqual(cliTokenReq.body, {
          code: "cli_code_999",
          state,
        });

        // Verify cancelSignIn clears pending state
        const startedAgain = await manager.startBrowserSignIn("loopback");
        assert.equal(startedAgain.state.signingIn, true);
        const cancelled = manager.cancelSignIn();
        assert.equal(cancelled.signingIn, false);
        assert.equal(cancelled.pendingAuthUrl, null);
        assert.equal(cancelled.pendingMode, null);
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});

test("completeManualCallback accepts both vscode:// and http://127.0.0.1 loopback URLs and routes to matching token endpoint", async () => {
  const mock = await startMockRayuServer();
  try {
    await withIsolatedAuthEnv(mock.baseUrl, async () => {
      const manager = new RayuHostAuthManager();
      try {
        // 1. Manual vscode:// paste
        const res1 = await manager.completeManualCallback(
          "vscode://rayucode.rayucode/auth?code=manual_vs_1&state=manual_state_1",
        );
        assert.equal(res1.signedIn, true);
        assert.ok(
          mock.requests.some(
            (r) =>
              r.path === "/api/vscode/token" &&
              r.body?.code === "manual_vs_1" &&
              r.body?.state === "manual_state_1",
          ),
        );

        // 2. Manual loopback paste
        const res2 = await manager.completeManualCallback(
          "http://127.0.0.1:43123/callback?code=manual_cli_2&state=manual_state_2",
        );
        assert.equal(res2.signedIn, true);
        assert.ok(
          mock.requests.some(
            (r) =>
              r.path === "/api/cli/token" &&
              r.body?.code === "manual_cli_2" &&
              r.body?.state === "manual_state_2",
          ),
        );
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});

test("auto-refreshes expired JWT via POST /cli/refresh and persists updated rayu-auth.json", async () => {
  const mock = await startMockRayuServer();
  try {
    await withIsolatedAuthEnv(mock.baseUrl, async ({ rayuHome }) => {
      const sessionPath = path.join(rayuHome, "rayu-auth.json");
      fs.writeFileSync(
        sessionPath,
        JSON.stringify(
          {
            accessToken: "jwt_expired_token",
            refreshToken: "rt_valid_refresh",
            expiresAt: Date.now() - 10_000,
            user: {
              id: 42,
              email: "alice@rayucode.com",
              displayName: "Alice Old",
              avatarUrl: null,
              role: "user",
            },
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );

      const manager = new RayuHostAuthManager();
      try {
        const status = await manager.getAccountStatus(true);
        assert.equal(status.signedIn, true);
        assert.equal(status.displayName, "Alice Rayu Live");

        assert.ok(
          mock.requests.some(
            (r) =>
              r.path === "/api/cli/refresh" &&
              r.body?.refreshToken === "rt_valid_refresh",
          ),
        );

        const updated = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as {
          accessToken: string;
          refreshToken: string;
        };
        assert.equal(updated.accessToken, "jwt_refreshed_access_2");
        assert.equal(updated.refreshToken, "rt_rayu_refresh_2");
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});

test("signInWithApiKey enforces rayu_sk_live_ prefix, verifies /v1/credits live, writes 0600 rayu.env, and signOut purges all credentials & caches even when daemon is offline", async () => {
  const mock = await startMockRayuServer();
  try {
    await withIsolatedAuthEnv(mock.baseUrl, async ({ rayuHome }) => {
      const daemonCalls: string[] = [];
      const manager = new RayuHostAuthManager({
        daemonBridge: {
          setApiKey: async () => {
            daemonCalls.push("setApiKey");
            throw new Error("daemon offline");
          },
          clearApiKey: async () => {
            daemonCalls.push("clearApiKey");
            throw new Error("daemon offline");
          },
          logoutProvider: async () => {
            daemonCalls.push("logoutProvider");
            throw new Error("daemon offline");
          },
          notifyAuthChanged: async () => {
            daemonCalls.push("notifyAuthChanged");
            throw new Error("daemon offline");
          },
        },
      });

      try {
        // 1. Rejects non-rayu_sk_live_ prefix
        await assert.rejects(
          manager.signInWithApiKey("sk-ant-invalid-prefix"),
          /must start with 'rayu_sk_live_'/,
        );

        // 2. Rejects 401 from /v1/credits
        await assert.rejects(
          manager.signInWithApiKey("rayu_sk_live_revoked"),
          /Invalid or revoked Rayu API key/,
        );

        // 3. Accepts valid key, writes 0600 rayu.env, succeeds even if daemon throws offline
        const signedIn = await manager.signInWithApiKey(
          "  rayu_sk_live_valid_12345  ",
        );
        assert.equal(signedIn.signedIn, true);
        assert.equal(signedIn.authMethod, "apiKey");
        assert.equal(signedIn.creditsRemaining, 150_000);
        assert.equal(process.env.RAYU_API_KEY, "rayu_sk_live_valid_12345");

        const envPath = path.join(resolveRayuAppConfigDir(), "rayu.env");
        assert.equal(fs.existsSync(envPath), true);
        assert.match(
          fs.readFileSync(envPath, "utf8"),
          /RAYU_API_KEY=rayu_sk_live_valid_12345/,
        );
        if (process.platform !== "win32") {
          const mode = fs.statSync(envPath).mode & 0o777;
          assert.equal(mode, 0o600);
        }

        // Bypass pacing requires OAuth
        await assert.rejects(
          manager.setBypassPacing(true),
          /requires an active Rayu account \(OAuth\)/,
        );

        // Plant OAuth session + cache files to verify complete signOut cleanup
        const sessionPath = path.join(rayuHome, "rayu-auth.json");
        fs.writeFileSync(
          sessionPath,
          JSON.stringify({
            accessToken: "jwt_temp",
            refreshToken: "rt_temp",
            expiresAt: Date.now() + 60_000,
            user: { id: 1, email: "a@b.com", displayName: "A", avatarUrl: null, role: "user" },
          }),
        );
        const cacheDir = path.join(rayuHome, "cache");
        fs.mkdirSync(cacheDir, { recursive: true });
        const cacheFiles = [
          path.join(rayuHome, "rayu-apikey-state.json"),
          path.join(rayuHome, "rayu-entitlements.json"),
          path.join(rayuHome, "rayu-feature-usage.json"),
          path.join(cacheDir, "rayu_models_abc123.json"),
        ];
        for (const f of cacheFiles) fs.writeFileSync(f, "{}");

        // 4. signOut succeeds even with offline daemon and purges everything
        const signedOut = await manager.signOut();
        assert.equal(signedOut.signedIn, false);
        assert.equal(signedOut.authMethod, "none");
        assert.equal(signedOut.creditsRemaining, undefined);
        assert.deepEqual(signedOut.windows, []);
        assert.equal(process.env.RAYU_API_KEY, undefined);
        assert.equal(fs.existsSync(sessionPath), false);
        assert.equal(
          fs.readFileSync(envPath, "utf8").includes("RAYU_API_KEY="),
          false,
        );
        for (const f of cacheFiles) {
          assert.equal(fs.existsSync(f), false, `Cache file should be deleted: ${f}`);
        }
        assert.ok(daemonCalls.includes("clearApiKey"));
        assert.ok(daemonCalls.includes("notifyAuthChanged"));
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});

test("parseHostedModelsPayload handles hostedModels, allowedModels, models, OpenAI data, and deduplicates preserving order", () => {
  assert.deepEqual(
    parseHostedModelsPayload({
      hostedModels: [
        {
          code: "rayu:claude-sonnet-4-6",
          label: "Claude Sonnet 4.6",
          description: "Primary",
          supportsEffort: true,
          supportsFast: true,
        },
        {
          code: "claude-sonnet-4-6",
          label: "Duplicate Should Be Ignored",
        },
        {
          model: "rayu-future-x1",
          name: "Rayu Future X1",
        },
      ],
    }),
    [
      {
        code: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        description: "Primary",
        supportsEffort: true,
        supportsFast: true,
      },
      {
        code: "rayu-future-x1",
        label: "Rayu Future X1",
      },
    ],
  );

  assert.deepEqual(
    parseHostedModelsPayload({
      allowedModels: [
        "rayu:model-alpha",
        { id: "model-alpha" },
        { id: "model-beta", name: "Beta", description: "Second" },
      ],
    }),
    [
      { code: "model-alpha" },
      { code: "model-beta", label: "Beta", description: "Second" },
    ],
  );

  assert.deepEqual(
    parseHostedModelsPayload({
      models: [{ code: "m-one" }, "m-two"],
    }),
    [{ code: "m-one" }, { code: "m-two" }],
  );

  assert.deepEqual(
    parseHostedModelsPayload({
      object: "list",
      data: [
        { id: "rayu:openai-style-1", name: "OpenAI Style 1", description: "Desc" },
        { id: "openai-style-1" },
        { id: "future-gateway-2099" },
      ],
    }),
    [
      { code: "openai-style-1", label: "OpenAI Style 1", description: "Desc" },
      { code: "future-gateway-2099" },
    ],
  );
});

test("OAuth discovers arbitrary future models via /me/entitlements, caches, bypasses fresh cache on forceRefresh, preserves last-good on failure, and clears on signOut", async () => {
  const mock = await startMockRayuServer({
    entitlementsResponse: {
      status: 200,
      body: {
        hostedModels: [
          {
            code: "rayu-future-omega-9999",
            label: "Rayu Future Omega 9999",
            description: "Unlisted future model",
            supportsEffort: true,
          },
          {
            code: "claude-opus-4-6",
            label: "Claude Opus 4.6",
          },
        ],
      },
    },
  });

  try {
    await withIsolatedAuthEnv(mock.baseUrl, async () => {
      const manager = new RayuHostAuthManager();
      try {
        // Signed out -> empty
        assert.deepEqual(await manager.fetchHostedModels(false), []);

        // Sign in via OAuth -> refreshAccountDetails fetches /me/entitlements
        const started = await manager.startBrowserSignIn("vscode");
        const state = new URL(started.authUrl).searchParams.get("state")!;
        await manager.handleUriCallback(
          `vscode://rayucode.rayucode/auth?code=c_models&state=${state}`,
        );

        const initial = manager.getCachedHostedModels();
        assert.deepEqual(
          initial.map((m) => m.code),
          ["rayu-future-omega-9999", "claude-opus-4-6"],
        );

        const entCallsBefore = mock.requests.filter(
          (r) => r.path === "/api/me/entitlements",
        ).length;
        assert.equal(entCallsBefore, 1);

        // Fresh cache hit (forceRefresh=false) MUST NOT hit network again
        const cached = await manager.fetchHostedModels(false);
        assert.deepEqual(
          cached.map((m) => m.code),
          ["rayu-future-omega-9999", "claude-opus-4-6"],
        );
        assert.equal(
          mock.requests.filter((r) => r.path === "/api/me/entitlements").length,
          entCallsBefore,
        );

        // Server publishes an arbitrary new future model -> forceRefresh=true bypasses fresh cache
        mock.setEntitlementsHandler(() => ({
          status: 200,
          body: {
            allowedModels: [
              { code: "rayu-future-nova-2099", label: "Nova 2099" },
              { code: "rayu-future-omega-9999", label: "Rayu Future Omega 9999" },
            ],
          },
        }));
        const forced = await manager.fetchHostedModels(true);
        assert.deepEqual(
          forced.map((m) => m.code),
          ["rayu-future-nova-2099", "rayu-future-omega-9999"],
        );
        assert.equal(
          mock.requests.filter((r) => r.path === "/api/me/entitlements").length,
          entCallsBefore + 1,
        );

        // Failure on both /me/entitlements (500) and /v1/models (malformed) MUST preserve last-good cache
        mock.setEntitlementsHandler(() => ({
          status: 500,
          body: { error: "upstream down" },
        }));
        mock.setGatewayModelsHandler(() => null);
        const preserved = await manager.getHostedModelCatalog(true);
        assert.equal(preserved.status, "stale");
        assert.deepEqual(
          preserved.models.map((m) => m.code),
          ["rayu-future-nova-2099", "rayu-future-omega-9999"],
        );

        mock.setEntitlementsHandler(() => ({ status: 401, body: { error: "expired" } }));
        mock.setGatewayModelsHandler(() => ({ status: 401, body: { error: "expired" } }));
        const rejected = await manager.getHostedModelCatalog(true);
        assert.equal(rejected.status, "stale");
        assert.deepEqual(rejected.models, preserved.models);

        const otherGateway = process.env.RAYU_GATEWAY_URL;
        try {
          process.env.RAYU_GATEWAY_URL = "http://127.0.0.1:1";
          assert.deepEqual(manager.getCachedHostedModels(), []);
          assert.deepEqual(await manager.getHostedModelCatalog(true), { models: [], status: "failed" });
        } finally {
          process.env.RAYU_GATEWAY_URL = otherGateway;
        }

        // signOut clears cachedModels
        await manager.signOut();
        assert.deepEqual(manager.getCachedHostedModels(), []);
        assert.deepEqual(await manager.fetchHostedModels(true), []);
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});

test("OAuth falls back to /v1/models when /me/entitlements fails or returns empty, and API key fetches /v1/models directly", async () => {
  const mock = await startMockRayuServer({
    entitlementsResponse: {
      status: 200,
      body: { hostedModels: [] },
    },
    gatewayModelsResponse: {
      status: 200,
      body: {
        object: "list",
        data: [
          {
            id: "rayu-gateway-future-777",
            name: "Gateway Future 777",
            description: "Discovered from /v1/models",
          },
          { id: "claude-sonnet-4-6" },
        ],
      },
    },
  });

  try {
    await withIsolatedAuthEnv(mock.baseUrl, async () => {
      const manager = new RayuHostAuthManager();
      try {
        // 1. OAuth with empty /me/entitlements falls back to /v1/models
        const started = await manager.startBrowserSignIn("vscode");
        const state = new URL(started.authUrl).searchParams.get("state")!;
        await manager.handleUriCallback(
          `vscode://rayucode.rayucode/auth?code=c_fallback&state=${state}`,
        );
        assert.deepEqual(
          manager.getCachedHostedModels().map((m) => m.code),
          ["rayu-gateway-future-777", "claude-sonnet-4-6"],
        );
        assert.ok(
          mock.requests.some((r) => r.path === "/api/me/entitlements"),
        );
        assert.ok(mock.requests.some((r) => r.path === "/v1/models"));

        // 2. Sign out and sign in with API key -> calls /v1/models directly (NOT /me/entitlements)
        await manager.signOut();
        const entCountAfterSignOut = mock.requests.filter(
          (r) => r.path === "/api/me/entitlements",
        ).length;

        mock.setGatewayModelsHandler(() => ({
          status: 200,
          body: {
            object: "list",
            data: [{ id: "rayu-apikey-future-888", name: "API Key Future 888" }],
          },
        }));

        await manager.signInWithApiKey("rayu_sk_live_models_test");
        const apiKeyModels = await manager.fetchHostedModels(false);
        assert.deepEqual(
          apiKeyModels.map((m) => m.code),
          ["rayu-apikey-future-888"],
        );
        assert.equal(
          mock.requests.filter((r) => r.path === "/api/me/entitlements").length,
          entCountAfterSignOut,
          "API key auth should query /v1/models directly, not /me/entitlements",
        );

        // API key transient error preserves last-good models
        mock.setGatewayModelsHandler(() => ({
          status: 503,
          body: { error: "temporarily unavailable" },
        }));
        const preservedApiKey = await manager.fetchHostedModels(true);
        assert.deepEqual(
          preservedApiKey.map((m) => m.code),
          ["rayu-apikey-future-888"],
        );

        // signOut clears API key models too
        await manager.signOut();
        assert.deepEqual(manager.getCachedHostedModels(), []);
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});

test("getHostedModelCatalog coalesces concurrent reads, discovers rayu:future-zenith-9000 on forced refresh, isolates credentials/endpoints, and marks stale on 401/5xx/network/malformed JSON", async () => {
  const mock = await startMockRayuServer();
  try {
    await withIsolatedAuthEnv(mock.baseUrl, async () => {
      const manager = new RayuHostAuthManager();
      try {
        await manager.signInWithApiKey("rayu_sk_live_coalesce_1");

        // 1. Concurrent identical reads (forceRefresh=false) coalesce into a single HTTP request
        let releaseInitial!: () => void;
        const initialGate = new Promise<void>((resolve) => {
          releaseInitial = resolve;
        });
        mock.setGatewayModelsHandler(async () => {
          await initialGate;
          return {
            status: 200,
            body: {
              object: "list",
              data: [
                {
                  id: "rayu:future-zenith-9000",
                  name: "Future Zenith 9000",
                  description: "Arbitrary unlisted future model",
                },
                { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
              ],
            },
          };
        });

        const callsBefore = mock.requests.filter((r) => r.path === "/v1/models").length;
        const [r1, r2, r3] = await Promise.all([
          manager.getHostedModelCatalog(false),
          manager.getHostedModelCatalog(false),
          (async () => {
            await new Promise((r) => setTimeout(r, 15));
            releaseInitial();
            return manager.getHostedModelCatalog(false);
          })(),
        ]);
        const callsAfterCoalesce = mock.requests.filter((r) => r.path === "/v1/models").length;
        assert.equal(callsAfterCoalesce - callsBefore, 1, "Concurrent reads must coalesce to 1 request");
        assert.equal(r1.status, "fresh");
        assert.equal(r2.status, "fresh");
        assert.deepEqual(
          r1.models.map((m) => m.code),
          ["future-zenith-9000", "claude-sonnet-4-6"],
        );
        assert.deepEqual(r2.models, r1.models);
        assert.deepEqual(r3.models, r1.models);

        // 2. Warm cache hit returns status: "cached" with 0 network calls
        const warmHit = await manager.getHostedModelCatalog(false);
        assert.equal(warmHit.status, "cached");
        assert.equal(
          mock.requests.filter((r) => r.path === "/v1/models").length,
          callsAfterCoalesce,
        );

        // 3. Concurrent forceRefresh=true bypasses fresh cache and coalesces into 1 network request
        let releaseForced!: () => void;
        const forcedGate = new Promise<void>((resolve) => {
          releaseForced = resolve;
        });
        mock.setGatewayModelsHandler(async () => {
          await forcedGate;
          return {
            status: 200,
            body: {
              object: "list",
              data: [
                { id: "rayu:future-zenith-9000", name: "Future Zenith 9000" },
                { id: "rayu:future-zenith-9001", name: "Future Zenith 9001" },
              ],
            },
          };
        });
        const [f1, f2] = await Promise.all([
          manager.getHostedModelCatalog(true),
          (async () => {
            await new Promise((r) => setTimeout(r, 15));
            const p = manager.getHostedModelCatalog(true);
            releaseForced();
            return p;
          })(),
        ]);
        assert.equal(
          mock.requests.filter((r) => r.path === "/v1/models").length,
          callsAfterCoalesce + 1,
          "Concurrent forceRefresh=true calls must coalesce to 1 request",
        );
        assert.equal(f1.status, "fresh");
        assert.equal(f2.status, "fresh");
        assert.deepEqual(
          f1.models.map((m) => m.code),
          ["future-zenith-9000", "future-zenith-9001"],
        );

        // 4. 401, 5xx, malformed JSON, and network error all preserve last-good models marked stale
        mock.setGatewayModelsHandler(() => ({ status: 401, body: { error: "unauthorized" } }));
        const on401 = await manager.getHostedModelCatalog(true);
        assert.equal(on401.status, "stale");
        assert.deepEqual(on401.models.map((m) => m.code), ["future-zenith-9000", "future-zenith-9001"]);

        mock.setGatewayModelsHandler(() => ({ status: 502, body: { error: "bad gateway" } }));
        const on502 = await manager.getHostedModelCatalog(true);
        assert.equal(on502.status, "stale");
        assert.deepEqual(on502.models.map((m) => m.code), ["future-zenith-9000", "future-zenith-9001"]);

        mock.setGatewayModelsHandler(() => null);
        const onMalformed = await manager.getHostedModelCatalog(true);
        assert.equal(onMalformed.status, "stale");
        assert.deepEqual(onMalformed.models.map((m) => m.code), ["future-zenith-9000", "future-zenith-9001"]);

        const origFetch = globalThis.fetch;
        globalThis.fetch = async () => {
          throw new TypeError("fetch failed: ECONNREFUSED");
        };
        try {
          const onNetworkErr = await manager.getHostedModelCatalog(true);
          assert.equal(onNetworkErr.status, "stale");
          assert.deepEqual(
            onNetworkErr.models.map((m) => m.code),
            ["future-zenith-9000", "future-zenith-9001"],
          );
        } finally {
          globalThis.fetch = origFetch;
        }

        // 5. Slow in-flight response from old credential NEVER overwrites new credential's catalog
        let releaseSlowOld!: () => void;
        const slowOldGate = new Promise<void>((resolve) => {
          releaseSlowOld = resolve;
        });
        mock.setGatewayModelsHandler(async () => {
          await slowOldGate;
          return {
            status: 200,
            body: {
              object: "list",
              data: [{ id: "rayu:stale-old-account-model" }],
            },
          };
        });
        const oldInFlight = manager.getHostedModelCatalog(true);
        await new Promise((r) => setTimeout(r, 15));

        // Switch API key while old request is in flight
        await manager.signInWithApiKey("rayu_sk_live_coalesce_2");
        mock.setGatewayModelsHandler(() => ({
          status: 200,
          body: {
            object: "list",
            data: [{ id: "rayu:new-account-zenith-9002" }],
          },
        }));
        const newAccountRes = await manager.getHostedModelCatalog(true);
        assert.equal(newAccountRes.status, "fresh");
        assert.deepEqual(
          newAccountRes.models.map((m) => m.code),
          ["new-account-zenith-9002"],
        );

        // Now resolve old in-flight request — MUST return unavailable and NEVER overwrite new account state
        releaseSlowOld();
        const settledOld = await oldInFlight;
        assert.equal(settledOld.status, "unavailable");
        assert.deepEqual(settledOld.models, []);
        assert.deepEqual(
          manager.getCachedHostedModels().map((m) => m.code),
          ["new-account-zenith-9002"],
        );
      } finally {
        manager.dispose();
      }
    });
  } finally {
    await mock.close();
  }
});
