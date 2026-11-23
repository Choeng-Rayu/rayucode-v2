import assert from "node:assert/strict";
import { test } from "node:test";
import { HarnessError, type RuntimeCommand } from "@rayu-dev/rayucode-sdk";
import {
  RPC_METHODS,
  RpcContractSchemas,
  type DaemonStatusView,
  type PermissionModeId,
} from "../shared/vscodeProtocol.js";
import {
  createFeatureRouter,
  mapRawBackgroundTask,
  normalizeHarnessRequestFrame,
  normalizeImageAttachments,
  type FeatureRouterDeps,
} from "../host/runtime/featureRouters.js";

interface TestRouterOptions {
  runtimeHandler?: (
    command: RuntimeCommand,
    args: string[],
    sessionId?: string,
  ) => Promise<{ data: unknown; message?: string }> | { data: unknown; message?: string };
  runtimeInfoRoutes?: Array<{
    model: string;
    provider: string;
    api_method: string;
    available: boolean;
    detail: string;
  }>;
}

function createTestFeatureRouter(options: TestRouterOptions = {}) {
  const globalStore = new Map<string, unknown>();
  const runtimeCommandsCalled: Array<{ command: string; args: string[] }> = [];
  const rawRequestsCalled: Array<Record<string, unknown>> = [];
  const externalUrlsOpened: string[] = [];
  let currentPermissionMode: PermissionModeId = "default";

  const daemonStatus: DaemonStatusView = {
    state: "connected",
    version: "rayu-harness-v1.14",
    protocolVersion: "1.14",
    socketPath: "/tmp/rayu-test.sock",
    latencyMs: 3,
    capabilities: [
      "permissions",
      "background_tasks",
      "swarm_control",
      "mcp_control",
      "telegram_control",
      "config_features",
      "doctor",
    ],
    isRayuRepo: true,
  };

  const deps: FeatureRouterDeps = {
    bridgeManager: {
      getStatus: () => daemonStatus,
      ping: async () => ({ ok: true, latencyMs: 2, version: "1.14" }),
      reconnect: async () => daemonStatus,
      restart: async () => daemonStatus,
      reloadDaemon: async () => ({ ok: true, message: "Reloaded" }),
      openOutputLog: () => {},
    },
    sessionHub: {
      getActiveSessionId: () => "sess_1",
      getActiveModel: () => "claude-opus-4-6",
      getActiveProvider: () => "rayu",
      getActivePermissionMode: () => currentPermissionMode,
      getClient: async () =>
        ({
          findFiles: async () => ["src/index.ts", "README.md"],
          setContextCap: async () => 128_000,
          compact: async () => "Compacted transcript",
          renameSession: async () => {},
          forkSession: async () => ({
            session_id: "sess_forked",
            title: "Forked Session",
            status: "idle",
          }),
          transferSession: async () => ({
            session_id: "sess_transferred",
            title: "Transferred Session",
            status: "idle",
          }),
          getHistory: async () => [{ role: "user", content: "hello" }],
          getRuntimeInfo: async (sessionId: string) => ({
            server: "rayu-harness-v1.14",
            protocolVersion: 1,
            capabilities: daemonStatus.capabilities,
            healthy: true,
            sessionId,
            provider: "rayu",
            model: "claude-opus-4-6",
            providers: ["rayu", "openai"],
            routes: options.runtimeInfoRoutes ?? [
              {
                model: "claude-opus-4-6",
                provider: "rayu",
                api_method: "messages",
                available: true,
                detail: "Rayu Cloud",
              },
              {
                model: "gpt-5.4",
                provider: "openai",
                api_method: "responses",
                available: true,
                detail: "OpenAI Direct",
              },
            ],
          }),
          request: async (req: Record<string, unknown>) => {
            rawRequestsCalled.push(req);
            return { v: 1, ev: "ok" };
          },
          rewind: async () => {},
          rewindUndo: async () => {},
          softInterruptWithId: async () => {},
          cancelSoftInterrupt: async () => true,
          cancelSoftInterrupts: async () => {},
          submitToolResult: async () => {},
          backgroundToolResult: async () => ({
            moved: true,
            toolCallId: "bg_1",
            toolName: "bash",
          }),
          peekSession: async () => [{ role: "assistant", content: "working" }],
          todoState: async () => ({
            todos: [{ content: "Write tests", status: "in_progress" }],
            plan: {},
            goals: [],
            gate_observations: [],
            long_session_review_due: false,
          }),
          setApiKey: async () => {},
          clearApiKey: async () => {},
          appletAction: async () => {},
          closeApplet: async () => {},
        }) as unknown as Awaited<ReturnType<FeatureRouterDeps["sessionHub"]["getClient"]>>,
      listSessions: async () => ({
        sessions: [
          {
            sessionId: "sess_1",
            title: "Main Session",
            status: "idle",
            updatedAtMs: 1000,
            permissionMode: currentPermissionMode,
          },
        ],
        activeSessionId: "sess_1",
      }),
      createSession: async (opts) => ({
        sessionId: "sess_new",
        title: "New Session",
        workingDir: opts?.workingDir ?? "/workspace",
        status: "idle",
        permissionMode: opts?.permissionMode ?? "default",
        updatedAtMs: Date.now(),
      }),
      attachSession: async (sessionId) => ({
        sessionId,
        title: "Attached Session",
        status: "idle",
        updatedAtMs: Date.now(),
      }),
      getHistory: async (sessionId) => ({
        sessionId,
        messages: [
          {
            id: `hist_${sessionId}_0`,
            role: "user",
            content: "Inspect this screenshot",
            images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }],
          },
          {
            id: `hist_${sessionId}_1`,
            role: "tool",
            content: "ok",
            toolName: "read_file",
            toolInput: { path: "src/index.ts" },
          },
          {
            id: `hist_${sessionId}_2`,
            role: "assistant",
            content: "Looks good!",
            model: "claude-opus-4-6",
          },
        ],
      }),
      setSessionPinned: async () => {},
      setSessionArchived: async () => {},
      setPermissionMode: async (_sid, mode) => {
        currentPermissionMode = mode;
        return { ok: true, mode };
      },
      respondPermission: async () => {},
      runtimeCommand: async (command, args = [], sessionId) => {
        runtimeCommandsCalled.push({ command, args });
        if (options.runtimeHandler) {
          const res = await options.runtimeHandler(command, args, sessionId);
          return {
            session_id: sessionId ?? "sess_1",
            command,
            data: res.data,
            message: res.message ?? "ok",
          };
        }
        return {
          session_id: sessionId ?? "sess_1",
          command,
          data: {},
          message: "ok",
        };
      },
      getBackgroundTasks: () => [
        {
          taskId: "bg_1",
          sessionId: "sess_1",
          group: "shells",
          toolName: "bash",
          displayName: "cargo test",
          status: "running",
          progressKind: "determinate",
          percent: 50,
          summary: "Running tests",
          startedAtMs: 1000,
          updatedAtMs: 2000,
        },
      ],
      refreshBackgroundProcesses: async () => [
        {
          taskId: "bg_1",
          sessionId: "sess_1",
          group: "shells",
          toolName: "bash",
          displayName: "cargo test",
          status: "running",
          progressKind: "determinate",
          percent: 50,
          summary: "Running tests",
          startedAtMs: 1000,
          updatedAtMs: 2000,
        },
      ],
      removeCompletedBackgroundTasks: () => 2,
      getSidePanelState: () => ({
        pages: [
          {
            id: "page_1",
            title: "Architecture Plan",
            kind: "markdown",
            content: "# Plan",
          },
        ],
        activePageId: "page_1",
      }),
      closeSidePanelPage: () => {},
      getApplets: () => [
        {
          appletId: "app_1",
          title: "SQL Explorer",
          kind: "table",
          state: { rows: 10 },
        },
      ],
      getCachedTodos: () => [{ content: "Cached todo", status: "pending" }],
      mapSessionInfoToSummary: (info) => ({
        sessionId: info.session_id,
        title: info.title ?? "Untitled",
        status: "idle",
        updatedAtMs: Date.now(),
      }),
    },
    gitBridge: {
      getStatus: async () => ({
        branch: "main",
        baseBranch: "main",
        totalAdditions: 10,
        totalDeletions: 2,
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            staged: false,
            additions: 10,
            deletions: 2,
            decision: "pending",
            fromSession: true,
          },
        ],
        stagedCount: 0,
        hasGhCli: true,
      }),
      getDiff: async ({ path }) => ({
        path,
        originalContent: "const a = 1;\n",
        modifiedContent: "const a = 2;\n",
        unifiedDiff: "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
        additions: 1,
        deletions: 1,
        languageId: "typescript",
      }),
      stage: async () => ({ ok: true }),
      unstage: async () => ({ ok: true }),
      keep: () => ({ ok: true }),
      undo: async () => ({ ok: true, conflict: false }),
      commit: async () => ({ ok: true, commitHash: "abc1234", summary: "feat: update" }),
      createPr: async () => ({
        ok: true,
        url: "https://github.com/Choeng-Rayu/rayucode-v2/pull/42",
        number: 42,
      }),
      listBranches: async () => ({ current: "main", branches: ["main", "dev"] }),
      checkoutBranch: async (_ws, branch) => ({ ok: true, branch }),
    },
    editorBridge: {
      openFile: async () => {},
      openWorktreeWindow: async () => {},
      openExternal: async (url) => {
        externalUrlsOpened.push(url);
      },
      pickFiles: async () => ["/workspace/file.ts"],
      findWorkspaceFiles: async () => ["src/fallback.ts"],
    },
    getWorkspaceFolders: async () => [
      { name: "rayucode-v2", path: "/workspace", branch: "main", isPrimary: true },
    ],
    setProjectIcon: async () => {},
    getGlobalState: <T>(key: string, defaultValue: T): T =>
      (globalStore.has(key) ? (globalStore.get(key) as T) : defaultValue),
    updateGlobalState: async (key, value) => {
      globalStore.set(key, value);
    },
    getRuntimeSettings: () => ({
      socketPath: "/tmp/rayu-test.sock",
      binaryPath: "/usr/local/bin/rayu",
      autoStart: true,
    }),
    updateRuntimeSettings: async () => {},
    openKeybindings: async () => {},
  };

  return {
    router: createFeatureRouter(deps),
    runtimeCommandsCalled,
    rawRequestsCalled,
    externalUrlsOpened,
  };
}

test("featureRouters validates and dispatches RPC calls across all 11 domains", async () => {
  const { router, runtimeCommandsCalled } = createTestFeatureRouter();

  // Verify every RPC_METHODS entry exists in RpcContractSchemas
  assert.ok(RPC_METHODS.length >= 111);
  for (const method of RPC_METHODS) {
    assert.ok(method in RpcContractSchemas, `Missing schema for ${method}`);
  }

  // 1. Daemon domain
  const statusRes = await router.dispatch(1, "daemon.status", undefined);
  assert.equal(statusRes.ok, true);
  if (statusRes.ok) {
    assert.deepEqual(
      RpcContractSchemas["daemon.status"].result.parse(statusRes.data).state,
      "connected",
    );
  }

  // 2. Workspace domain
  const filesRes = await router.call("workspace.findFiles", { query: "index" });
  assert.deepEqual(filesRes.files, ["src/index.ts", "README.md"]);

  // 3. Sessions domain + permission mode + history
  const permRes = await router.call("sessions.setPermissionMode", {
    sessionId: "sess_1",
    mode: "acceptEdits",
  });
  assert.equal(permRes.ok, true);
  assert.equal(permRes.mode, "acceptEdits");

  const histRes = await router.call("sessions.history", { sessionId: "sess_1" });
  assert.equal(histRes.sessionId, "sess_1");
  assert.equal(histRes.messages.length, 3);
  assert.equal(histRes.messages[0]?.images?.[0]?.mediaType, "image/png");
  assert.equal(histRes.messages[1]?.toolName, "read_file");

  // 4. Background domain
  const bgList = await router.call("background.list", { sessionId: "sess_1" });
  assert.equal(bgList.tasks.length, 1);
  assert.equal(bgList.tasks[0]?.taskId, "bg_1");

  // 5. Swarm domain (unsupported live spawn returns honest ok: false instead of faking success)
  const swarmSpawn = await router.call("swarm.spawn", {
    label: "verifier",
    prompt: "Verify tests pass",
    useWorktree: true,
  });
  assert.equal(swarmSpawn.ok, false);
  assert.ok(swarmSpawn.message);

  // 6. Automations domain
  const ovnStart = await router.call("automations.overnight.start", {
    mission: "Fix warnings",
    duration: "4h",
    maxAgents: 4,
  });
  assert.equal(ovnStart.run.mission, "Fix warnings");

  // 7. Plugins domain
  const mcpList = await router.call("plugins.mcp.list", undefined);
  assert.ok(Array.isArray(mcpList.servers));

  // 8. Changes domain
  const prRes = await router.call("changes.createPr", {
    baseBranch: "main",
    headBranch: "feat/vscode",
    title: "feat(vscode): host runtime",
    body: "Summary",
  });
  assert.equal(prRes.ok, true);
  assert.equal(prRes.number, 42);

  // 9. Remote domain
  const tgStatus = await router.call("remote.telegram.status", undefined);
  assert.equal(tgStatus.daemonOnline, true);

  // 10. Settings domain
  const featSet = await router.call("settings.features.set", {
    key: "codemode",
    value: true,
  });
  assert.equal(featSet.ok, true);
  assert.equal(featSet.features.codemode, true);

  // 11. Inspector domain
  const todosRes = await router.call("inspector.todos.get", { sessionId: "sess_1" });
  assert.equal(todosRes.todos.length, 1);
  assert.equal(todosRes.todos[0]?.content, "Write tests");

  assert.ok(runtimeCommandsCalled.some((c) => c.command === "overnight"));
  assert.ok(runtimeCommandsCalled.some((c) => c.command === "features"));
});

test("featureRouters matches Rust v1.14 RuntimeCommand wire contracts 1:1", async () => {
  const { router, runtimeCommandsCalled, rawRequestsCalled, externalUrlsOpened } =
    createTestFeatureRouter({
      runtimeHandler: (command, args) => {
        if (command === "background" && args[0] === "output") {
          return {
            data: {
              task_id: args[1],
              output: "line 1\nline 2\n",
              total_bytes: 14,
              truncated: true,
              output_file: "/tmp/bg_1.log",
            },
          };
        }
        if (command === "background" && args[0] === "cleanup") {
          return {
            data: {
              matched_files: 5,
              removed_files: 3,
              skipped_running_files: 2,
              max_age_hours: 24,
            },
          };
        }
        if (command === "session_search") {
          return {
            data: {
              query: "shard",
              scope: "claude",
              results: [
                {
                  session_id: "claude_42",
                  title: "ShardStore lookup",
                  snippet: "Optimized p99",
                  source: "claude",
                  working_dir: "/repo",
                  updated_at: "2026-11-23T12:00:00Z",
                  score: 0.95,
                },
              ],
              matches: [],
              count: 1,
            },
          };
        }
        if (command === "subscription") {
          return {
            data: {
              configured: true,
              source: "live",
              credits: {
                plan: "pro",
                plan_name: "Rayu Pro",
                credits_per_period: 100_000,
                used_credits: 25_000,
                remaining_credits: 75_000,
                reset_seconds: 13_320,
                period_end: "2026-12-01T00:00:00Z",
                topup_balance: 5_000,
                top_up_enabled: true,
              },
            },
          };
        }
        if (command === "auth") {
          return {
            data: {
              scope: "runtime host",
              providers: [
                {
                  id: "anthropic",
                  display_name: "Anthropic (Claude)",
                  state: "ready",
                  readiness: "ready",
                  credential_source: "api_key",
                },
                {
                  id: "openai",
                  display_name: "OpenAI",
                  state: "ready",
                  readiness: "ready",
                  credential_source: "env",
                },
              ],
            },
          };
        }
        if (command === "telegram" && args[0] === "link_hosted") {
          return {
            data: {
              username: "rayu_hosted_bot",
              status: "pending",
              pairing_url: "https://t.me/rayu_hosted_bot?start=pair_xyz",
              pending_until: "2026-11-23T18:00:00Z",
            },
          };
        }
        if (command === "telegram" && args[0] === "status") {
          return {
            data: {
              linked: false,
              configured: true,
              username: "rayu_hosted_bot",
              mode: "hosted",
              owner_chat_id: 987654321,
              pending_approvals_count: 1,
            },
          };
        }
        if (command === "telegram" && args[0] === "approvals") {
          return {
            data: {
              approvals: [
                {
                  id: "tg_1",
                  action: "bash",
                  description: "rm -rf dist",
                  rationale: "Clean build",
                  urgency: "high",
                  created_at: "2026-11-23T17:00:00Z",
                },
              ],
              count: 1,
            },
          };
        }
        if (command === "remote" && (args[0] === "on" || args[0] === "off")) {
          return {
            data: {
              enabled: args[0] === "on",
              changed: true,
              restart_required: true,
            },
          };
        }
        if (command === "refresh_model_list") {
          return {
            data: {
              routes: [
                {
                  model: "claude-sonnet-4-6",
                  provider: "rayu",
                  api_method: "messages",
                  available: true,
                  detail: "First in backend order",
                },
                {
                  model: "gemini-3-pro",
                  provider: "gemini",
                  api_method: "generateContent",
                  available: true,
                  detail: "Second in backend order",
                },
              ],
            },
          };
        }
        if (command === "doctor") {
          return {
            data: {
              scope: args[0] ?? "status",
              checks: [
                {
                  id: "chk_auth",
                  name: "Auth Provider Readiness",
                  status: "pass",
                  detail: "All good",
                },
              ],
              hooks: [
                { name: "pre_tool", configured: true },
                { name: "post_tool", configured: false },
                { name: "post_tool_feedback", configured: false },
                { name: "turn_start", configured: true },
                { name: "turn_end", configured: false },
                { name: "session_start", configured: false },
                { name: "session_end", configured: false },
              ],
            },
          };
        }
        if (command === "mcp" && args[0] === "list") {
          return {
            data: {
              servers: [
                {
                  id: "github",
                  status: "disabled",
                  enabled: false,
                  connected: false,
                  transport: "streamable-http",
                  shared: true,
                  cached_tool_count: 2,
                  cached_tools: ["list_issues", "get_pr"],
                  oauth_logged_in: true,
                },
              ],
            },
          };
        }
        if (command === "skills") {
          return {
            data: {
              skills: [
                {
                  name: "rust-verify",
                  description: "Verify Rust crates",
                  path: ".agents/skills/rust-verify/SKILL.md",
                  scope: "project",
                },
              ],
              endorsed: [],
            },
          };
        }
        if (command === "productivity") {
          return {
            data: {
              png_path: "/tmp/prod.png",
              image: { media_type: "image/png", base64: "QUJD" },
            },
            message: "## Weekly Productivity\n- 42 commits",
          };
        }
        if (command === "overnight" && args[0] === "log") {
          return {
            data: {
              run_id: "ovn_9",
              events: [
                {
                  timestamp: "2026-11-23T02:00:00Z",
                  kind: "task_done",
                  message: "All tests green",
                },
              ],
            },
          };
        }
        if (command === "overnight" && args[0] === "review") {
          return {
            data: {
              run_id: "ovn_9",
              html: "<html><body>Review</body></html>",
              path: "/tmp/review.html",
              tasks: [
                {
                  id: "t1",
                  title: "Audit wire",
                  status: "completed",
                  validation: { result: "passed", evidence: ["cargo test green"] },
                  followups: [],
                },
              ],
            },
            message: "# Overnight review: ovn_9",
          };
        }
        if (command === "features") {
          return {
            data: {
              features: {
                check_updates: false,
                memory: true,
                swarm: true,
                mermaid: false,
                auto_poke: false,
                todo_gate_digest: false,
                todo_gate_diagnostics: false,
                message_timestamps: false,
                persist_memory_injections: false,
                kv_cache_miss_notices: true,
                update_channel: "preview",
              },
              tools: {
                codemode: true,
                integration_tools: true,
              },
            },
          };
        }
        return { data: {} };
      },
    });

  // 1. background.output reads string `data.output` + `total_bytes` + `truncated`
  const bgOut = await router.call("background.output", { taskId: "bg_1" });
  assert.equal(bgOut.content, "line 1\nline 2\n");
  assert.equal(bgOut.byteLength, 14);
  assert.equal(bgOut.truncated, true);
  assert.equal(bgOut.outputFile, "/tmp/bg_1.log");

  // 2. background.cleanup reads `removed_files`
  const bgClean = await router.call("background.cleanup", undefined);
  assert.equal(bgClean.removedCount, 3);

  // 3. mapRawBackgroundTask parses RFC3339 started_at + nested progress
  const mappedTask = mapRawBackgroundTask(
    {
      task_id: "bg_nested",
      tool_name: "bash",
      display_name: "cargo check",
      status: "running",
      started_at: "2026-11-23T12:00:00Z",
      progress: {
        percent: 42,
        current: 21,
        total: 50,
        unit: "crates",
        message: "Compiling rayucode-app-core",
        eta_seconds: 12,
      },
    },
    "sess_1",
  );
  assert.equal(mappedTask.startedAtMs, Date.parse("2026-11-23T12:00:00Z"));
  assert.equal(mappedTask.percent, 42);
  assert.equal(mappedTask.current, 21);
  assert.equal(mappedTask.total, 50);
  assert.equal(mappedTask.unit, "crates");
  assert.equal(mappedTask.summary, "Compiling rayucode-app-core");
  assert.equal(mappedTask.etaSeconds, 12);

  // 4. sessions.search passes `--scope` and reads `results`
  const search = await router.call("sessions.search", {
    query: "shard lookup",
    scope: "claude",
  });
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0]?.sessionId, "claude_42");
  assert.equal(search.hits[0]?.sourceTool, "claude");
  assert.deepEqual(
    runtimeCommandsCalled.find((c) => c.command === "session_search")?.args,
    ["shard", "lookup", "--scope", "claude"],
  );

  // 5. sessions.respondQuestion uses `req: "question_response"` with `QuestionResponse` schema
  await router.call("sessions.respondQuestion", {
    sessionId: "sess_1",
    requestId: "q_1",
    answers: { "Which backend?": "Rust" },
    notes: { "Which backend?": "Fastest" },
  });
  assert.deepEqual(rawRequestsCalled[0], {
    req: "question_response",
    session_id: "sess_1",
    request_id: "q_1",
    response: {
      kind: "answered",
      answers: {
        "Which backend?": { custom: ["Rust"], notes: "Fastest" },
      },
    },
  });

  // 6. settings.account.get reads `configured` + nested `credits`
  const acct = await router.call("settings.account.get", undefined);
  assert.equal(acct.signedIn, true);
  assert.equal(acct.planName, "Rayu Pro");
  assert.equal(acct.creditsRemaining, 75_000);
  assert.equal(acct.creditsPerPeriod, 100_000);
  assert.equal(acct.usedCredits, 25_000);
  assert.equal(acct.topUpBalance, 5_000);
  assert.equal(acct.topUpEnabled, true);
  assert.equal(acct.windows.length, 1);
  assert.equal(acct.windows[0]?.usedPercent, 25);
  assert.equal(acct.windows[0]?.remainingPercent, 75);
  assert.equal(acct.windows[0]?.resetCountdown, "3h 42m");

  // 7. settings.account.signInBrowser opens external browser
  const signIn = await router.call("settings.account.signInBrowser", undefined);
  assert.equal(signIn.ok, true);
  assert.equal(externalUrlsOpened.length, 1);
  assert.equal(externalUrlsOpened[0], signIn.authUrl);

  // 8. settings.providers.list reads `data.providers` ARRAY
  const provs = await router.call("settings.providers.list", undefined);
  assert.equal(
    provs.providers.find((p) => p.id === "anthropic")?.status,
    "ready",
  );
  assert.equal(
    provs.providers.find((p) => p.id === "openai")?.status,
    "env_key",
  );

  // 9. settings.models.get & refresh preserve exact backend route ordering
  const modelsGet = await router.call("settings.models.get", undefined);
  assert.deepEqual(
    modelsGet.routes?.map((r) => `${r.provider}:${r.model}`),
    ["rayu:claude-opus-4-6", "openai:gpt-5.4"],
  );
  const modelsRefresh = await router.call("settings.models.refresh", undefined);
  assert.equal(modelsRefresh.routeCount, 2);
  assert.deepEqual(
    modelsRefresh.routes?.map((r) => `${r.provider}:${r.model}`),
    ["rayu:claude-sonnet-4-6", "gemini:gemini-3-pro"],
  );

  // 10. settings.models.setRoleOverride sends `[role, model]` / `["global", role, model]` (no `"set"`)
  await router.call("settings.models.setRoleOverride", {
    role: "review",
    model: "claude-sonnet-4-6",
    scope: "global",
  });
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "agents").at(-1)?.args,
    ["global", "review", "claude-sonnet-4-6"],
  );

  // 11. remote.telegram.linkHosted preserves `pairing_url` & approvals calls `["approvals"]`
  const hosted = await router.call("remote.telegram.linkHosted", undefined);
  assert.equal(hosted.pairingUrl, "https://t.me/rayu_hosted_bot?start=pair_xyz");
  assert.equal(hosted.botHandle, "rayu_hosted_bot");
  assert.equal(hosted.chatId, "987654321");
  assert.equal(hosted.approvals.length, 1);

  // 12. remote.gateway.toggle passes `"on"` / `"off"` (not `"enable"`/`"disable"`)
  const gwOn = await router.call("remote.gateway.toggle", { enabled: true });
  assert.equal(gwOn.enabled, true);
  assert.equal(gwOn.restartRequired, true);
  assert.deepEqual(
    runtimeCommandsCalled.find((c) => c.command === "remote" && c.args[0] === "on")?.args,
    ["on"],
  );

  // 13. plugins.mcp.list reads disabled status + cached_tools + oauth_logged_in
  const mcp = await router.call("plugins.mcp.list", undefined);
  assert.equal(mcp.servers[0]?.status, "disabled");
  assert.equal(mcp.servers[0]?.enabled, false);
  assert.equal(mcp.servers[0]?.cachedToolCount, 2);
  assert.equal(mcp.servers[0]?.tools?.length, 2);
  assert.equal(mcp.servers[0]?.oauthAuthenticated, true);

  // 14. plugins.skills.list calls `skills` with `[]` (not `["list"]`)
  const skills = await router.call("plugins.skills.list", undefined);
  assert.equal(skills.skills.length, 1);
  assert.deepEqual(
    runtimeCommandsCalled.find((c) => c.command === "skills")?.args,
    [],
  );

  // 15. automations.quality.productivity passes `[]` and reads `out.message`, `image.base64`, `png_path`
  const prod = await router.call("automations.quality.productivity", { range: "7d" });
  assert.equal(prod.markdown, "## Weekly Productivity\n- 42 commits");
  assert.equal(prod.chartBase64, "QUJD");
  assert.equal(prod.chartPath, "/tmp/prod.png");
  assert.deepEqual(
    runtimeCommandsCalled.find((c) => c.command === "productivity")?.args,
    [],
  );

  // 16. automations.overnight.log/report pass 1-arg commands & parse events/html/tasks
  const ovnLog = await router.call("automations.overnight.log", { runId: "ovn_9" });
  assert.equal(ovnLog.lines.length, 1);
  assert.match(ovnLog.lines[0]!, /All tests green/);
  const ovnRep = await router.call("automations.overnight.report", { runId: "ovn_9" });
  assert.equal(ovnRep.markdown, "# Overnight review: ovn_9");
  assert.equal(ovnRep.html, "<html><body>Review</body></html>");
  assert.equal(ovnRep.run.reviewPath, "/tmp/review.html");
  assert.equal(ovnRep.run.tasks?.[0]?.validationResult, "passed");

  // 17. settings.doctor.run reads `c.name` fallback and settings.hooks.list reads all 7 hooks
  const doc = await router.call("settings.doctor.run", { scope: "auth" });
  assert.equal(doc.checks[0]?.label, "Auth Provider Readiness");
  const hooks = await router.call("settings.hooks.list", undefined);
  assert.equal(hooks.hooks.length, 7);
  assert.equal(hooks.hooks.find((h) => h.event === "pre_tool")?.configured, true);
  assert.equal(hooks.hooks.find((h) => h.event === "turn_start")?.configured, true);

  // 18. settings.features.get maps all 13 keys
  const feats = await router.call("settings.features.get", undefined);
  assert.equal(feats.features.check_updates, false);
  assert.equal(feats.features.kv_cache_miss_notices, true);
  assert.equal(feats.features.update_channel, "preview");
  assert.equal(feats.features.codemode, true);
  assert.equal(feats.features.integration_tools, true);

  // 19. settings.telemetry.set passes 1-arg `["all"]` / `["none"]` and toggles accurately
  await router.call("settings.telemetry.set", { category: "none" });
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "telemetry").at(-1)?.args,
    ["none"],
  );
  await router.call("settings.telemetry.set", { category: "usage" });
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "telemetry").at(-1)?.args,
    ["usage", "on"],
  );
});

test("featureRouters propagates daemon errors on mutations instead of faking ok: true", async () => {
  const { router } = createTestFeatureRouter({
    runtimeHandler: (command) => {
      throw new HarnessError("internal", `Daemon rejected ${command}`);
    },
  });

  const cancelRes = await router.dispatch(10, "background.cancel", { taskId: "bg_1" });
  assert.equal(cancelRes.ok, false);
  if (!cancelRes.ok) {
    assert.match(cancelRes.error, /Daemon rejected background/);
  }

  const toggleRes = await router.dispatch(11, "plugins.mcp.toggle", {
    id: "github",
    enabled: false,
  });
  assert.equal(toggleRes.ok, false);
});

test("normalizeImageAttachments and normalizeHarnessRequestFrame enforce wire contract", () => {
  const tuples = normalizeImageAttachments([
    {
      name: "shot.png",
      mediaType: "image/png",
      data: "data:image/png;base64,aGVsbG8=",
      sizeBytes: 5,
    },
    ["image/jpeg", "data:image/jpeg;base64,/9j/4AAQ"],
    ["image/webp", "UklGRg=="],
    { mediaType: "image/png", data: "" },
  ]);
  assert.deepEqual(tuples, [
    ["image/png", "aGVsbG8="],
    ["image/jpeg", "/9j/4AAQ"],
    ["image/webp", "UklGRg=="],
  ]);

  assert.deepEqual(
    normalizeHarnessRequestFrame({
      v: 1,
      id: 42,
      type: "set_model",
      session_id: "sess_1",
      model: "claude-opus-4-6",
    }),
    {
      req: "set_model",
      session_id: "sess_1",
      model: "claude-opus-4-6",
    },
  );

  assert.deepEqual(
    normalizeHarnessRequestFrame({
      op: "permission_response",
      session_id: "sess_1",
      request_id: "req_1",
      decision: "allow_once",
    }),
    {
      req: "permission_response",
      session_id: "sess_1",
      request_id: "req_1",
      decision: "allow",
    },
  );

  assert.deepEqual(
    normalizeHarnessRequestFrame({
      type: "user_input",
      session_id: "sess_1",
      content: "hi",
      images: [{ mediaType: "image/png", data: "data:image/png;base64,QUJD" }],
    }),
    {
      req: "send_message",
      session_id: "sess_1",
      content: "hi",
      images: [["image/png", "QUJD"]],
    },
  );
});

test("featureRouters rejects unknown RPC methods and invalid params with VALIDATION_ERROR", async () => {
  const { router } = createTestFeatureRouter();

  const unknownMethod = await router.dispatch(99, "nonexistent.method", {});
  assert.equal(unknownMethod.ok, false);
  if (!unknownMethod.ok) {
    assert.equal(unknownMethod.code, "VALIDATION_ERROR");
  }

  const badParams = await router.dispatch(100, "sessions.rename", {
    sessionId: "sess_1",
    title: "", // min(1) violation
  });
  assert.equal(badParams.ok, false);
  if (!badParams.ok) {
    assert.equal(badParams.code, "VALIDATION_ERROR");
  }
});
