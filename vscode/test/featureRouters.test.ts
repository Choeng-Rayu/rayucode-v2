import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HarnessError, type RuntimeCommand } from "@rayu-dev/rayucode-sdk";
import {
  HistoryMessageViewSchema,
  RPC_METHODS,
  RpcContractSchemas,
  type DaemonStatusView,
  type PermissionModeId,
} from "../shared/vscodeProtocol.js";
import {
  createFeatureRouter,
  formatHarnessModelSpec,
  mapModelRouteOption,
  mapRawBackgroundTask,
  mapRawFileChangeActionResponse,
  mapRawFileChangeDiff,
  mapRawFileChangesSnapshot,
  mapRawHistoryMessage,
  normalizeCredentialProviderId,
  normalizeHarnessRequestFrame,
  normalizeImageAttachments,
  normalizeLogoutProviderId,
  reconcileAuthConsistentRoutes,
  type FeatureRouterAuthManager,
  type FeatureRouterDeps,
} from "../host/runtime/featureRouters.js";

interface TestRouterOptions {
  authManager?: FeatureRouterAuthManager;
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
  const apiKeyCalls: Array<{ action: "set" | "clear" | "notify"; provider: string; key?: string }> = [];
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
      updateEngine: async () => ({
        ...daemonStatus,
        binarySource: "managed",
        managedVersion: "3.1.0",
      }),
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
          setApiKey: async (provider: string, key: string) => {
            apiKeyCalls.push({ action: "set", provider, key });
          },
          clearApiKey: async (provider: string) => {
            apiKeyCalls.push({ action: "clear", provider });
          },
          notifyAuthChanged: async (provider: string) => {
            apiKeyCalls.push({ action: "notify", provider });
          },
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
      notifyDaemonAuthChanged: async (provider = "rayu") => {
        apiKeyCalls.push({ action: "notify", provider });
      },
    },
    authManager: options.authManager,
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
    apiKeyCalls,
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
  const updateEngineRes = await router.dispatch(1, "daemon.updateEngine", undefined);
  assert.equal(updateEngineRes.ok, true);
  if (updateEngineRes.ok) {
    const parsedEngine = RpcContractSchemas["daemon.updateEngine"].result.parse(
      updateEngineRes.data,
    );
    assert.equal(parsedEngine.binarySource, "managed");
    assert.equal(parsedEngine.managedVersion, "3.1.0");
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
              generation: "gen-hosted-1",
              username: "rayu_hosted_bot",
              status: "Waiting for pairing",
              pairing_url: "https://t.me/rayu_hosted_bot?start=pair_xyz",
              pairing_code: "pair_xyz",
              qr_size: 29,
              qr_path: "M2 2h7v1h-7z",
              pending_until: "2026-11-23T18:00:00Z",
            },
          };
        }
        if (command === "telegram" && args[0] === "link_botfather") {
          return {
            data: {
              generation: "gen-bf-2",
              linked: Boolean(args[2] && args[2] !== "replace"),
              mode: "botfather",
              username: "my_custom_bot",
              owner_chat_id: args[2] && args[2] !== "replace" ? Number(args[2]) : null,
              status: args[2] && args[2] !== "replace" ? "Linked" : "Waiting for pairing",
              pairing_url: args[2] && args[2] !== "replace" ? null : "https://t.me/my_custom_bot?start=bf_code",
              pairing_code: args[2] && args[2] !== "replace" ? null : "bf_code",
              qr_size: args[2] && args[2] !== "replace" ? null : 29,
              qr_path: args[2] && args[2] !== "replace" ? null : "M2 2h7v1h-7z",
            },
          };
        }
        if (command === "telegram" && args[0] === "ping") {
          return {
            data: { ok: true, username: "rayu_hosted_bot", chat_id: 987654321, message_id: 77 },
            message: "Sent Telegram ping to @rayu_hosted_bot (chat 987654321).",
          };
        }
        if (command === "telegram" && args[0] === "select_session") {
          return {
            data: { ok: true, selected_session: args[1] },
            message: `Telegram remote now drives session \`${args[1]}\`.`,
          };
        }
        if (command === "subagent_model") {
          return {
            data: {
              model: args[0] === "status" ? "coder" : args[args.length - 1],
              configured_default: "rayu:claude-sonnet-4-6",
              inherit_model: "rayu:claude-opus-4-6",
            },
            message: "Updated subagent model.",
          };
        }
        if (command === "agents" && (args[0] === "profile" || args[1] === "profile")) {
          const isRm = args.includes("rm");
          return {
            data: {
              profiles: isRm
                ? []
                : [
                    {
                      name: "architect",
                      model: "rayu:claude-opus-4-6",
                      effort: "high",
                      description: "System architecture reviews",
                      scope: args[0] === "global" ? "global" : "session",
                    },
                  ],
            },
            message: isRm ? "Removed profile." : "Saved profile.",
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

  // 11. remote.telegram.linkHosted, linkBotfather, testPing, driveSession & approvals
  const hosted = await router.call("remote.telegram.linkHosted", undefined);
  assert.equal(hosted.pairingUrl, "https://t.me/rayu_hosted_bot?start=pair_xyz");
  assert.equal(hosted.pairingCode, "pair_xyz");
  assert.equal(hosted.qrSize, 29);
  assert.equal(hosted.qrPath, "M2 2h7v1h-7z");
  assert.equal(hosted.botHandle, "@rayu_hosted_bot");
  assert.equal(hosted.chatId, "987654321");
  assert.equal(hosted.approvals.length, 1);

  const bf = await router.call("remote.telegram.linkBotfather", {
    botToken: "123456789:AAF_ValidToken1234567890",
    allowedChatId: "5551234",
    replaceExisting: true,
  });
  assert.equal(bf.mode, "botfather");
  assert.equal(bf.botHandle, "@my_custom_bot");
  assert.equal(bf.linked, true);
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "telegram" && c.args[0] === "link_botfather").at(-1)?.args,
    ["link_botfather", "123456789:AAF_ValidToken1234567890", "5551234", "replace"],
  );

  const ping = await router.call("remote.telegram.testPing", undefined);
  assert.equal(ping.ok, true);
  assert.equal(ping.target, "@rayu_hosted_bot");
  assert.equal(ping.chatId, "987654321");

  const drive = await router.call("remote.telegram.driveSession", { sessionId: "ses_live_9" });
  assert.equal(drive.ok, true);
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "telegram" && c.args[0] === "select_session").at(-1)?.args,
    ["select_session", "ses_live_9"],
  );

  // 11b. settings.agents.* RPCs forward directly to Rust `subagent_model` and `agents [global] profile add|rm`
  const subModel = await router.call("settings.agents.setSubagentModel", {
    model: "coder",
    scope: "session",
  });
  assert.equal(subModel.ok, true);
  assert.equal(subModel.model, "coder");

  const upserted = await router.call("settings.agents.upsertProfile", {
    name: "architect",
    model: "rayu:claude-opus-4-6",
    effort: "high",
    description: "System architecture reviews",
    scope: "global",
  });
  assert.equal(upserted.ok, true);
  assert.equal(upserted.profiles[0]?.name, "architect");
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "agents").at(-1)?.args,
    ["global", "profile", "add", "architect", "rayu:claude-opus-4-6", "--effort", "high", "System architecture reviews"],
  );

  const deleted = await router.call("settings.agents.deleteProfile", {
    name: "architect",
    scope: "global",
  });
  assert.equal(deleted.ok, true);
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "agents").at(-1)?.args,
    ["global", "profile", "rm", "architect"],
  );

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

test("featureRouters wires settings.account.* to authManager and normalizes provider IDs with daemon notifications", async () => {
  const authCalls: string[] = [];
  let signedIn = false;
  let signingIn = false;
  let pendingMode: "vscode" | "loopback" | null = null;
  let pendingAuthUrl: string | null = null;

  const mockSnapshot = () => ({
    signedIn,
    authMethod: (signedIn ? "oauth" : "none") as "oauth" | "apiKey" | "none",
    signingIn,
    pendingAuthUrl,
    pendingMode,
    webBase: "https://rayucode.com",
    error: null,
    displayName: signedIn ? "Test User" : undefined,
    email: signedIn ? "test@rayucode.com" : undefined,
    windows: [],
  });

  const authManager: FeatureRouterAuthManager = {
    getAccountStatusSnapshot: () => mockSnapshot(),
    getAccountStatus: async (forceRefresh) => {
      authCalls.push(`get:${Boolean(forceRefresh)}`);
      return mockSnapshot();
    },
    startBrowserSignIn: async (mode = "vscode") => {
      authCalls.push(`signInBrowser:${mode}`);
      signingIn = true;
      pendingMode = mode;
      pendingAuthUrl =
        mode === "loopback"
          ? "https://rayucode.com/cli-login?port=12345&state=abc"
          : "https://rayucode.com/vscode-login?state=abc";
      return { ok: true, authUrl: pendingAuthUrl, state: mockSnapshot() };
    },
    cancelSignIn: () => {
      authCalls.push("cancelSignIn");
      signingIn = false;
      pendingMode = null;
      pendingAuthUrl = null;
      return mockSnapshot();
    },
    signInWithApiKey: async (apiKey) => {
      authCalls.push(`signInApiKey:${apiKey}`);
      signedIn = true;
      return mockSnapshot();
    },
    completeManualCallback: async (callbackUrl) => {
      authCalls.push(`completeCallback:${callbackUrl}`);
      signedIn = true;
      signingIn = false;
      pendingAuthUrl = null;
      pendingMode = null;
      return mockSnapshot();
    },
    signOut: async () => {
      authCalls.push("signOut");
      signedIn = false;
      signingIn = false;
      return mockSnapshot();
    },
    clearSavedApiKeyOnly: async () => {
      authCalls.push("clearSavedApiKeyOnly");
      return mockSnapshot();
    },
    setBypassPacing: async (enabled) => {
      authCalls.push(`setBypassPacing:${enabled}`);
      return { ok: true, enabled };
    },
  };

  const { router, externalUrlsOpened, apiKeyCalls, runtimeCommandsCalled } =
    createTestFeatureRouter({ authManager });

  // Provider normalization unit assertions
  assert.equal(normalizeCredentialProviderId("rayu-cloud"), "rayu");
  assert.equal(normalizeCredentialProviderId("anthropic"), "claude-api");
  assert.equal(normalizeCredentialProviderId("claude"), "claude-api");
  assert.equal(normalizeCredentialProviderId("openai"), "openai-api");
  assert.equal(normalizeCredentialProviderId("github-copilot"), "copilot");
  assert.equal(normalizeLogoutProviderId("anthropic"), "claude");
  assert.equal(normalizeLogoutProviderId("rayu-cloud"), "rayu");
  assert.equal(normalizeLogoutProviderId("github-copilot"), "copilot");

  // Default rayu provider status reflects signed-out host authManager (never fake "ready")
  const provsSignedOut = await router.call("settings.providers.list", undefined);
  assert.equal(
    provsSignedOut.providers.find((p) => p.id === "rayu")?.status,
    "needs_key",
  );

  // Browser sign-in (vscode & loopback) + cancelSignIn
  const signInVscode = await router.call("settings.account.signInBrowser", undefined);
  assert.equal(signInVscode.ok, true);
  assert.match(signInVscode.authUrl ?? "", /\/vscode-login\?state=/);
  assert.equal(externalUrlsOpened.at(-1), signInVscode.authUrl);

  const cancelled = await router.call("settings.account.cancelSignIn", undefined);
  assert.equal(cancelled.signingIn, false);

  const signInLoopback = await router.call("settings.account.signInBrowser", {
    mode: "loopback",
  });
  assert.match(signInLoopback.authUrl ?? "", /\/cli-login\?port=/);

  // Complete callback + refresh + bypass pacing + signOut
  const completed = await router.call("settings.account.completeCallback", {
    callbackUrl: "vscode://rayucode.rayucode/auth?code=c1&state=s1",
  });
  assert.equal(completed.signedIn, true);

  const provsSignedIn = await router.call("settings.providers.list", undefined);
  assert.equal(
    provsSignedIn.providers.find((p) => p.id === "rayu")?.status,
    "ready",
  );
  assert.equal(
    provsSignedIn.providers.find((p) => p.id === "rayu")?.accountLabel,
    "test@rayucode.com",
  );

  const pacing = await router.call("settings.account.setBypassPacing", {
    enabled: true,
  });
  assert.deepEqual(pacing, { ok: true, enabled: true });

  await router.call("settings.account.refresh", undefined);
  const signedOut = await router.call("settings.account.signOut", undefined);
  assert.equal(signedOut.signedIn, false);

  // Provider credential mutations normalize IDs and notify daemon
  await router.call("settings.providers.setApiKey", {
    providerId: "anthropic",
    apiKey: "sk-ant-test",
  });
  await router.call("settings.providers.setApiKey", {
    providerId: "openai",
    apiKey: "sk-openai-test",
  });
  await router.call("settings.providers.clearApiKey", {
    providerId: "anthropic",
  });
  await router.call("settings.providers.logout", {
    providerId: "anthropic",
  });
  await router.call("settings.providers.logout", {
    providerId: "rayu-cloud",
  });

  assert.deepEqual(apiKeyCalls, [
    { action: "set", provider: "claude-api", key: "sk-ant-test" },
    { action: "notify", provider: "claude-api" },
    { action: "set", provider: "openai-api", key: "sk-openai-test" },
    { action: "notify", provider: "openai-api" },
    { action: "clear", provider: "claude-api" },
    { action: "notify", provider: "claude-api" },
    { action: "notify", provider: "claude-api" },
  ]);
  assert.deepEqual(
    runtimeCommandsCalled.find((c) => c.command === "logout")?.args,
    ["claude", "confirm"],
  );
  assert.ok(authCalls.includes("signInBrowser:vscode"));
  assert.ok(authCalls.includes("signInBrowser:loopback"));
  assert.ok(authCalls.includes("cancelSignIn"));
  assert.ok(authCalls.includes("setBypassPacing:true"));
  assert.ok(authCalls.includes("get:true"));
  assert.equal(authCalls.filter((c) => c === "signOut").length, 2);
});

test("featureRouters routes session file-change RPCs through Rust RayucodeClient when file_changes capability is present and falls back on older bridges", async () => {
  const engineActions: Array<{
    sessionId: string;
    action: string;
    opts?: { path?: string; force?: boolean };
  }> = [];
  const engineDiffPaths: string[] = [];
  const broadcasted: Array<{ sessionId: string; pending: number }> = [];
  const gitFallbackCalls: string[] = [];

  const rawSnapshot = {
    session_id: "sess_fc",
    latest_turn_id: 4,
    total_pending_files: 2,
    total_additions: 14,
    total_deletions: 3,
    files: [
      {
        path: "/repo/src/new_file.ts",
        display_path: "src/new_file.ts",
        kind: "created" as const,
        status: "pending" as const,
        additions: 10,
        deletions: 0,
        changed_in_latest_turn: true,
        turn_id: 4,
        edit_count: 1,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [
          {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: 2,
            header: "@@ -0,0 +1,2 @@",
            lines: ["+export const ok = true;", "+export const n = 1;"],
          },
        ],
        preview_truncated: false,
        updated_at_ms: 1_700_000_000_000,
      },
      {
        path: "/repo/src/app.ts",
        display_path: "src/app.ts",
        kind: "modified" as const,
        status: "pending" as const,
        additions: 4,
        deletions: 3,
        changed_in_latest_turn: false,
        turn_id: 2,
        edit_count: 2,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [],
        preview_truncated: false,
        updated_at_ms: 1_700_000_000_100,
      },
    ],
  };

  // Pure mapper roundtrip checks
  const mappedSnap = mapRawFileChangesSnapshot(rawSnapshot);
  assert.equal(mappedSnap.sessionId, "sess_fc");
  assert.equal(mappedSnap.latestTurnId, 4);
  assert.equal(mappedSnap.files[0]?.displayPath, "src/new_file.ts");
  assert.equal(mappedSnap.files[0]?.previewHunks[0]?.newStart, 1);

  const mappedDiff = mapRawFileChangeDiff({
    path: "/repo/src/new_file.ts",
    display_path: "src/new_file.ts",
    kind: "created",
    status: "pending",
    additions: 2,
    deletions: 0,
    is_binary: false,
    original_content: "",
    modified_content: "export const ok = true;\n",
    unified_diff: "@@ -0,0 +1,1 @@\n+export const ok = true;\n",
    hunks: rawSnapshot.files[0]!.preview_hunks,
  });
  assert.equal(mappedDiff.kind, "created");
  assert.equal(mappedDiff.languageId, "typescript");
  assert.equal(mappedDiff.hunks?.length, 1);

  const mappedConflict = mapRawFileChangeActionResponse({
    ok: false,
    message: "1 conflict",
    conflicts: [
      {
        path: "/repo/src/app.ts",
        display_path: "src/app.ts",
        reason: "Manual edits detected",
      },
    ],
    snapshot: rawSnapshot,
  });
  assert.equal(mappedConflict.ok, false);
  assert.equal(mappedConflict.conflict, true);
  assert.equal(mappedConflict.conflicts?.[0]?.displayPath, "src/app.ts");

  const makeEngineRouter = (supportsFileChanges: boolean) => {
    const cachedSnapshots = new Map<string, ReturnType<typeof mapRawFileChangesSnapshot>>();
    if (supportsFileChanges) {
      cachedSnapshots.set("sess_fc", mappedSnap);
    }

    const daemonStatus: DaemonStatusView = {
      state: "connected",
      version: "rayu-harness-v1.14",
      protocolVersion: "1.14",
      socketPath: "/tmp/rayu-test.sock",
      latencyMs: 2,
      capabilities: supportsFileChanges
        ? ["permissions", "file_changes"]
        : ["permissions"],
      isRayuRepo: true,
    };

    const deps: FeatureRouterDeps = {
      bridgeManager: {
        getStatus: () => daemonStatus,
        ping: async () => ({ ok: true, latencyMs: 2 }),
        reconnect: async () => daemonStatus,
        restart: async () => daemonStatus,
        reloadDaemon: async () => ({ ok: true }),
        openOutputLog: () => {},
      },
      sessionHub: {
        getActiveSessionId: () => "sess_fc",
        getActiveModel: () => "claude-opus-4-6",
        getActiveProvider: () => "rayu",
        getActivePermissionMode: () => "default",
        getClient: async () =>
          ({
            supports: (cap: string) =>
              supportsFileChanges && cap === "file_changes",
            getFileChanges: async () => rawSnapshot,
            getFileChangeDiff: async (_sid: string, targetPath: string) => {
              engineDiffPaths.push(targetPath);
              return {
                path: targetPath,
                display_path: "src/app.ts",
                kind: "modified",
                status: "pending",
                additions: 4,
                deletions: 3,
                is_binary: false,
                original_content: "engine-original\n",
                modified_content: "engine-modified\n",
                unified_diff: "@@ -1 +1 @@\n-engine-original\n+engine-modified\n",
                hunks: [
                  {
                    old_start: 1,
                    old_lines: 1,
                    new_start: 1,
                    new_lines: 1,
                    header: "@@ -1 +1 @@",
                    lines: ["-engine-original", "+engine-modified"],
                  },
                ],
              };
            },
            fileChangeAction: async (
              sessionId: string,
              action: string,
              opts?: { path?: string; force?: boolean },
            ) => {
              engineActions.push({ sessionId, action, opts });
              if (action === "undo" && !opts?.force) {
                return {
                  ok: false,
                  message: "Manual edit detected",
                  conflicts: [
                    {
                      path: "/repo/src/app.ts",
                      display_path: "src/app.ts",
                      reason: "File changed on disk",
                    },
                  ],
                  snapshot: rawSnapshot,
                };
              }
              return {
                ok: true,
                message: `Applied ${action}`,
                conflicts: [],
                snapshot: {
                  ...rawSnapshot,
                  total_pending_files: action === "keep_all" || action === "undo_all" ? 0 : 1,
                },
              };
            },
          }) as unknown as Awaited<ReturnType<FeatureRouterDeps["sessionHub"]["getClient"]>>,
        listSessions: async () => ({ sessions: [], activeSessionId: "sess_fc" }),
        createSession: async () => ({
          sessionId: "sess_fc",
          title: "Session",
          status: "idle",
          updatedAtMs: 1,
        }),
        attachSession: async (sessionId) => ({
          sessionId,
          title: "Session",
          status: "idle",
          updatedAtMs: 1,
        }),
        getHistory: async (sessionId) => ({ sessionId, messages: [] }),
        setSessionPinned: async () => {},
        setSessionArchived: async () => {},
        setPermissionMode: async (_sid, mode) => ({ ok: true, mode }),
        respondPermission: async () => {},
        runtimeCommand: async (command, _args, sessionId) => ({
          session_id: sessionId ?? "sess_fc",
          command,
          data: {},
          message: "ok",
        }),
        getBackgroundTasks: () => [],
        refreshBackgroundProcesses: async () => [],
        removeCompletedBackgroundTasks: () => 0,
        getSidePanelState: () => ({ pages: [] }),
        closeSidePanelPage: () => {},
        getApplets: () => [],
        getCachedTodos: () => [],
        mapSessionInfoToSummary: (info) => ({
          sessionId: info.session_id,
          title: info.title ?? "Untitled",
          status: "idle",
          updatedAtMs: 1,
        }),
        getFileChangesSnapshot: (sid) => cachedSnapshots.get(sid),
        broadcastFileChanges: (sid, snap) => {
          cachedSnapshots.set(sid, snap);
          broadcasted.push({ sessionId: sid, pending: snap.totalPendingFiles });
        },
      },
      gitBridge: {
        getStatus: async () => ({
          branch: "main",
          baseBranch: "main",
          totalAdditions: 4,
          totalDeletions: 3,
          files: [
            {
              path: "src/app.ts",
              status: "modified",
              staged: false,
              additions: 4,
              deletions: 3,
              decision: "pending",
              fromSession: true,
            },
          ],
          stagedCount: 0,
          hasGhCli: true,
        }),
        getDiff: async ({ path: p }) => {
          gitFallbackCalls.push(`diff:${p}`);
          if (p === "src/new_file.ts") {
            return {
              path: p,
              originalContent: "",
              modifiedContent: "",
              unifiedDiff: "",
              additions: 0,
              deletions: 0,
              languageId: "typescript",
            };
          }
          return {
            path: p,
            originalContent: "git-head\n",
            modifiedContent: "git-working\n",
            unifiedDiff: "@@ -1 +1 @@\n-git-head\n+git-working\n",
            additions: 1,
            deletions: 1,
            languageId: "typescript",
          };
        },
        stage: async () => ({ ok: true }),
        unstage: async () => ({ ok: true }),
        keep: ({ path: p }) => {
          gitFallbackCalls.push(`keep:${p}`);
          return { ok: true };
        },
        undo: async ({ path: p }) => {
          gitFallbackCalls.push(`undo:${p}`);
          return { ok: true, conflict: false };
        },
        commit: async () => ({ ok: true }),
        createPr: async () => ({ ok: true }),
        listBranches: async () => ({ current: "main", branches: ["main"] }),
        checkoutBranch: async (_w, branch) => ({ ok: true, branch }),
      },
      editorBridge: {
        openFile: async () => {},
        openWorktreeWindow: async () => {},
        openExternal: async () => {},
        pickFiles: async () => [],
        findWorkspaceFiles: async () => [],
      },
      getWorkspaceFolders: async () => [],
      setProjectIcon: async () => {},
      getGlobalState: <T>(_k: string, d: T) => d,
      updateGlobalState: async () => {},
      getRuntimeSettings: () => ({
        socketPath: "/tmp/rayu-test.sock",
        binaryPath: "/usr/local/bin/rayu",
        autoStart: true,
      }),
      updateRuntimeSettings: async () => {},
      openKeybindings: async () => {},
    };

    return createFeatureRouter(deps);
  };

  // 1. Engine-backed routing when bridge supports "file_changes"
  const engineRouter = makeEngineRouter(true);

  const summary = await engineRouter.call("changes.getSessionSummary", {
    sessionId: "sess_fc",
  });
  assert.equal(summary.sessionId, "sess_fc");
  assert.equal(summary.files.length, 2);
  assert.equal(summary.totalPendingFiles, 2);

  // Session scope diff uses engine originalContent & resolves displayPath -> absolute engine path
  const sessionDiff = await engineRouter.call("changes.diff", {
    path: "src/app.ts",
    sessionId: "sess_fc",
    scope: "session",
  });
  assert.equal(sessionDiff.originalContent, "engine-original\n");
  assert.deepEqual(engineDiffPaths, ["/repo/src/app.ts"]);

  // Git scope diff uses GitChangesBridge when git has diff, and falls back to engine diff for untracked/non-git session files
  const gitDiff = await engineRouter.call("changes.diff", {
    path: "src/app.ts",
    sessionId: "sess_fc",
    scope: "git",
  });
  assert.equal(gitDiff.originalContent, "git-head\n");
  assert.ok(gitFallbackCalls.includes("diff:src/app.ts"));

  const untrackedGitScopeDiff = await engineRouter.call("changes.diff", {
    path: "src/new_file.ts",
    sessionId: "sess_fc",
    scope: "git",
  });
  assert.equal(untrackedGitScopeDiff.originalContent, "engine-original\n");
  assert.ok(engineDiffPaths.includes("/repo/src/new_file.ts"));

  // Session status reflects engine files
  const sessionStatus = await engineRouter.call("changes.status", {
    sessionId: "sess_fc",
    scope: "session",
  });
  assert.equal(sessionStatus.files.length, 2);
  assert.equal(sessionStatus.files[0]?.status, "added");

  // Keep, Undo (conflict + force), Redo, KeepAll, UndoAll, RedoAll
  const keepRes = await engineRouter.call("changes.keep", {
    path: "src/app.ts",
    sessionId: "sess_fc",
  });
  assert.equal(keepRes.ok, true);

  const undoConflict = await engineRouter.call("changes.undo", {
    path: "src/app.ts",
    sessionId: "sess_fc",
  });
  assert.equal(undoConflict.ok, false);
  assert.equal(undoConflict.conflict, true);
  assert.equal(undoConflict.conflicts?.length, 1);

  const undoForced = await engineRouter.call("changes.undo", {
    path: "src/app.ts",
    sessionId: "sess_fc",
    force: true,
  });
  assert.equal(undoForced.ok, true);

  const redoRes = await engineRouter.call("changes.redo", {
    path: "src/app.ts",
    sessionId: "sess_fc",
  });
  assert.equal(redoRes.ok, true);

  const keepAllRes = await engineRouter.call("changes.keepAll", {
    sessionId: "sess_fc",
  });
  assert.equal(keepAllRes.ok, true);

  const undoAllRes = await engineRouter.call("changes.undoAll", {
    sessionId: "sess_fc",
    force: true,
  });
  assert.equal(undoAllRes.ok, true);

  const redoAllRes = await engineRouter.call("changes.redoAll", {
    sessionId: "sess_fc",
  });
  assert.equal(redoAllRes.ok, true);

  assert.deepEqual(
    engineActions.map((a) => `${a.action}:${a.opts?.path ?? "*"}:${Boolean(a.opts?.force)}`),
    [
      "keep:/repo/src/app.ts:false",
      "undo:/repo/src/app.ts:false",
      "undo:/repo/src/app.ts:true",
      "redo:/repo/src/app.ts:false",
      "keep_all:*:false",
      "undo_all:*:true",
      "redo_all:*:false",
    ],
  );
  assert.ok(broadcasted.length >= 6);

  // 2. Graceful fallback when older bridge lacks "file_changes"
  gitFallbackCalls.length = 0;
  const legacyRouter = makeEngineRouter(false);

  const fallbackSummary = await legacyRouter.call("changes.getSessionSummary", {
    sessionId: "sess_fc",
  });
  assert.equal(fallbackSummary.files.length, 1);
  assert.equal(fallbackSummary.files[0]?.displayPath, "src/app.ts");

  const fallbackDiff = await legacyRouter.call("changes.diff", {
    path: "src/app.ts",
    sessionId: "sess_fc",
    scope: "session",
  });
  assert.equal(fallbackDiff.originalContent, "git-head\n");

  const fallbackKeepAll = await legacyRouter.call("changes.keepAll", {
    sessionId: "sess_fc",
  });
  assert.equal(fallbackKeepAll.ok, true);
  assert.ok(gitFallbackCalls.includes("keep:src/app.ts"));

  const fallbackUndoAll = await legacyRouter.call("changes.undoAll", {
    sessionId: "sess_fc",
  });
  assert.equal(fallbackUndoAll.ok, true);
  assert.ok(gitFallbackCalls.includes("undo:src/app.ts"));

  const fallbackRedo = await legacyRouter.call("changes.redo", {
    path: "src/app.ts",
    sessionId: "sess_fc",
  });
  assert.equal(fallbackRedo.ok, false);
});

test("formatHarnessModelSpec, mapModelRouteOption, and reconcileAuthConsistentRoutes enforce auth consistency and rayu: routing", async () => {
  // 1. formatHarnessModelSpec rules
  assert.equal(formatHarnessModelSpec(""), "");
  assert.equal(formatHarnessModelSpec("   "), "");
  assert.equal(formatHarnessModelSpec("default"), "");
  assert.equal(formatHarnessModelSpec("claude-opus-4-6", "rayu"), "rayu:claude-opus-4-6");
  assert.equal(formatHarnessModelSpec("claude-opus-4-6", "rayu-cloud"), "rayu:claude-opus-4-6");
  assert.equal(formatHarnessModelSpec("claude-opus-4-6", undefined, "rayu"), "rayu:claude-opus-4-6");
  assert.equal(formatHarnessModelSpec("rayu:claude-opus-4-6", "rayu"), "rayu:claude-opus-4-6");
  assert.equal(formatHarnessModelSpec("openrouter:foo/bar", "rayu"), "openrouter:foo/bar");
  assert.equal(formatHarnessModelSpec("claude-opus-4-6", "anthropic", "messages"), "claude-opus-4-6");

  // 2. mapModelRouteOption generates collision-free route IDs & modelSpec
  const rayuRoute = mapModelRouteOption({
    model: "rayu:claude-opus-4-6",
    provider: "rayu-cloud",
    label: "Claude Opus 4.6",
    available: true,
  });
  assert.equal(rayuRoute?.id, "rayu:claude-opus-4-6");
  assert.equal(rayuRoute?.model, "claude-opus-4-6");
  assert.equal(rayuRoute?.modelSpec, "rayu:claude-opus-4-6");
  assert.equal(rayuRoute?.provider, "rayu");
  assert.equal(rayuRoute?.apiMethod, "rayu");

  const anthropicRoute = mapModelRouteOption({
    model: "claude-opus-4-6",
    provider: "claude",
    api_method: "messages",
    available: false,
    detail: "Missing ANTHROPIC_API_KEY",
  });
  assert.equal(anthropicRoute?.id, "messages:claude-opus-4-6");
  assert.equal(anthropicRoute?.model, "claude-opus-4-6");
  assert.equal(anthropicRoute?.modelSpec, "claude-opus-4-6");
  assert.equal(anthropicRoute?.provider, "anthropic");
  assert.notEqual(rayuRoute?.id, anthropicRoute?.id);

  // 3. Reconcile deduplicates rayu vs unavailable anthropic for same model name & orders auth-first
  const reconciledSignedIn = reconcileAuthConsistentRoutes({
    rawRoutes: [
      {
        model: "claude-opus-4-6",
        provider: "anthropic",
        api_method: "messages",
        available: false,
        detail: "Missing ANTHROPIC_API_KEY",
      },
      {
        model: "gpt-5.4",
        provider: "openai",
        api_method: "responses",
        available: true,
        detail: "OpenAI Direct",
      },
      {
        model: "claude-opus-4-6",
        provider: "rayu",
        api_method: "rayu",
        available: false,
        detail: "Stale daemon status",
      },
    ],
    hostAccount: {
      signedIn: true,
      authMethod: "oauth",
      email: "alice@rayucode.com",
      windows: [],
    },
    rayuHostedModels: [
      { code: "claude-opus-4-6", label: "Claude Opus 4.6" },
      {
        code: "rayu-future-2099-pro",
        label: "Rayu Future 2099 Pro",
        description: "Next-gen coding",
        supportsEffort: true,
        supportsFast: true,
      },
    ],
    runtimeModel: "claude-opus-4-6",
    runtimeProvider: "anthropic",
  });

  // No duplicate rayu:claude-opus-4-6, distinct ID from messages:claude-opus-4-6,
  // and stable auth-first partition: [available Rayu, available other, unavailable]
  assert.deepEqual(
    reconciledSignedIn.routes.map((r) => `${r.id}:${r.available}`),
    [
      "rayu:claude-opus-4-6:true",
      "rayu:rayu-future-2099-pro:true",
      "responses:gpt-5.4:true",
      "messages:claude-opus-4-6:false",
    ],
  );
  assert.equal(reconciledSignedIn.routes[0]?.authMethod, "oauth");
  assert.equal(reconciledSignedIn.routes[0]?.accountLabel, "alice@rayucode.com");
  assert.equal(reconciledSignedIn.routes[0]?.modelSpec, "rayu:claude-opus-4-6");
  assert.equal(reconciledSignedIn.routes[1]?.modelSpec, "rayu:rayu-future-2099-pro");
  // defaultModel MUST NOT point to unavailable anthropic — must pick first available authenticated route
  assert.equal(reconciledSignedIn.defaultModel, "rayu:claude-opus-4-6");

  // 4. Signed-out hostAccount marks daemon Rayu routes unavailable and selects available provider instead
  const reconciledSignedOut = reconcileAuthConsistentRoutes({
    rawRoutes: [
      {
        model: "claude-opus-4-6",
        provider: "rayu",
        api_method: "rayu",
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
    hostAccount: {
      signedIn: false,
      authMethod: "none",
      windows: [],
    },
    runtimeModel: "claude-opus-4-6",
    runtimeProvider: "rayu",
  });
  assert.deepEqual(
    reconciledSignedOut.routes.map((r) => `${r.id}:${r.available}`),
    ["responses:gpt-5.4:true", "rayu:claude-opus-4-6:false"],
  );
  assert.equal(reconciledSignedOut.routes[1]?.detail, "Sign in to Rayu Cloud");
  assert.equal(reconciledSignedOut.defaultModel, "gpt-5.4");
});

test("settings.models.get works with no active session (HomePage) and settings.models.refresh forces live refresh", async () => {
  const fetchCalls: boolean[] = [];
  const notifyCalls: string[] = [];
  const runtimeCalls: string[] = [];
  let hostedModels = [
    {
      code: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      description: "Rayu Cloud default",
      supportsEffort: true,
    },
    {
      code: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      description: "Flagship",
    },
  ];

  const daemonStatus: DaemonStatusView = {
    state: "connected",
    version: "rayu-harness-v1.14",
    protocolVersion: "1.14",
    socketPath: "/tmp/rayu-test.sock",
    latencyMs: 2,
    capabilities: ["permissions"],
    isRayuRepo: true,
  };

  const deps: FeatureRouterDeps = {
    bridgeManager: {
      getStatus: () => daemonStatus,
      ping: async () => ({ ok: true, latencyMs: 2 }),
      reconnect: async () => daemonStatus,
      restart: async () => daemonStatus,
      reloadDaemon: async () => ({ ok: true }),
      openOutputLog: () => {},
    },
    sessionHub: {
      getActiveSessionId: () => undefined,
      getActiveModel: () => undefined,
      getActiveProvider: () => undefined,
      getActivePermissionMode: () => "default",
      getClient: async () =>
        ({
          listSessions: async () => [],
          getRuntimeInfo: async () => {
            throw new Error("should not be called when no session exists");
          },
        }) as unknown as Awaited<ReturnType<FeatureRouterDeps["sessionHub"]["getClient"]>>,
      listSessions: async () => ({ sessions: [] }),
      createSession: async () => ({
        sessionId: "sess_1",
        title: "Session",
        status: "idle",
        updatedAtMs: 1,
      }),
      attachSession: async (sessionId) => ({
        sessionId,
        title: "Session",
        status: "idle",
        updatedAtMs: 1,
      }),
      getHistory: async (sessionId) => ({ sessionId, messages: [] }),
      setSessionPinned: async () => {},
      setSessionArchived: async () => {},
      setPermissionMode: async (_sid, mode) => ({ ok: true, mode }),
      respondPermission: async () => {},
      runtimeCommand: async (command) => {
        runtimeCalls.push(command);
        if (command === "refresh_model_list") {
          return {
            session_id: "sess_1",
            command,
            data: {
              routes: [
                {
                  model: "claude-opus-4-6",
                  provider: "anthropic",
                  api_method: "messages",
                  available: false,
                  detail: "No API key",
                },
              ],
            },
            message: "refreshed",
          };
        }
        return { session_id: "", command, data: {}, message: "ok" };
      },
      getBackgroundTasks: () => [],
      refreshBackgroundProcesses: async () => [],
      removeCompletedBackgroundTasks: () => 0,
      getSidePanelState: () => ({ pages: [] }),
      closeSidePanelPage: () => {},
      getApplets: () => [],
      getCachedTodos: () => [],
      mapSessionInfoToSummary: (info) => ({
        sessionId: info.session_id,
        title: info.title ?? "Untitled",
        status: "idle",
        updatedAtMs: 1,
      }),
      notifyDaemonAuthChanged: async (provider = "rayu") => {
        notifyCalls.push(provider);
      },
    },
    authManager: {
      getAccountStatusSnapshot: () => ({
        signedIn: true,
        authMethod: "oauth",
        email: "dev@rayucode.com",
        displayName: "Dev User",
        windows: [],
      }),
      getAccountStatus: async () => ({
        signedIn: true,
        authMethod: "oauth",
        email: "dev@rayucode.com",
        displayName: "Dev User",
        windows: [],
      }),
      startBrowserSignIn: async () => ({
        ok: true,
        authUrl: "https://rayucode.com/vscode-login?state=1",
        state: { signedIn: true, authMethod: "oauth", windows: [] },
      }),
      cancelSignIn: () => ({ signedIn: true, authMethod: "oauth", windows: [] }),
      signInWithApiKey: async () => ({ signedIn: true, authMethod: "apiKey", windows: [] }),
      completeManualCallback: async () => ({ signedIn: true, authMethod: "oauth", windows: [] }),
      signOut: async () => ({ signedIn: false, authMethod: "none", windows: [] }),
      clearSavedApiKeyOnly: async () => ({ signedIn: false, authMethod: "none", windows: [] }),
      setBypassPacing: async (enabled) => ({ ok: true, enabled }),
      getCachedHostedModels: () => [...hostedModels],
      fetchHostedModels: async (forceRefresh = false) => {
        fetchCalls.push(forceRefresh);
        if (forceRefresh) {
          hostedModels = [
            ...hostedModels,
            {
              code: "rayu-quantum-2099",
              label: "Rayu Quantum 2099",
              description: "Arbitrary future model",
            },
          ];
        }
        return [...hostedModels];
      },
    },
    gitBridge: {
      getStatus: async () => ({
        branch: "main",
        totalAdditions: 0,
        totalDeletions: 0,
        files: [],
        stagedCount: 0,
      }),
      getDiff: async ({ path }) => ({
        path,
        originalContent: "",
        modifiedContent: "",
        unifiedDiff: "",
        additions: 0,
        deletions: 0,
      }),
      stage: async () => ({ ok: true }),
      unstage: async () => ({ ok: true }),
      keep: () => ({ ok: true }),
      undo: async () => ({ ok: true }),
      commit: async () => ({ ok: true }),
      createPr: async () => ({ ok: true }),
      listBranches: async () => ({ current: "main", branches: ["main"] }),
      checkoutBranch: async (_w, branch) => ({ ok: true, branch }),
    },
    editorBridge: {
      openFile: async () => {},
      openWorktreeWindow: async () => {},
      openExternal: async () => {},
      pickFiles: async () => [],
      findWorkspaceFiles: async () => [],
    },
    getWorkspaceFolders: async () => [],
    setProjectIcon: async () => {},
    getGlobalState: <T>(_k: string, d: T) => d,
    updateGlobalState: async () => {},
    getRuntimeSettings: () => ({
      socketPath: "/tmp/rayu-test.sock",
      binaryPath: "/usr/local/bin/rayu",
      autoStart: true,
    }),
    updateRuntimeSettings: async () => {},
    openKeybindings: async () => {},
  };

  const router = createFeatureRouter(deps);

  // 1. settings.models.get on HomePage (no active session) still returns signed-in Rayu models + rayu: defaultModel
  const homeModels = await router.call("settings.models.get", undefined);
  assert.deepEqual(fetchCalls, [false]);
  assert.equal(homeModels.defaultModel, "rayu:claude-sonnet-4-6");
  assert.deepEqual(
    homeModels.routes?.map((r) => `${r.id}:${r.modelSpec}:${r.available}`),
    [
      "rayu:claude-sonnet-4-6:rayu:claude-sonnet-4-6:true",
      "rayu:claude-opus-4-6:rayu:claude-opus-4-6:true",
    ],
  );
  assert.equal(homeModels.routes?.[0]?.accountLabel, "dev@rayucode.com");
  assert.equal(homeModels.routes?.[0]?.authMethod, "oauth");

  // 2. settings.models.refresh forces fetchHostedModels(true) + notifies daemon + merges & orders routes
  const refreshed = await router.call("settings.models.refresh", undefined);
  assert.equal(refreshed.ok, true);
  assert.deepEqual(fetchCalls, [false, true]);
  assert.deepEqual(notifyCalls, ["rayu"]);
  assert.ok(runtimeCalls.includes("refresh_model_list"));
  assert.equal(refreshed.routeCount, 4);
  assert.deepEqual(
    refreshed.routes?.map((r) => `${r.id}:${r.available}`),
    [
      "rayu:claude-sonnet-4-6:true",
      "rayu:claude-opus-4-6:true",
      "rayu:rayu-quantum-2099:true",
      "messages:claude-opus-4-6:false",
    ],
  );
});

test("featureRouters enforces background session isolation, softInterrupt/cancelSoftInterrupts parity, and rewind messageIndex parsing", async () => {
  const softInterruptCalls: Array<{
    sessionId: string;
    text: string;
    options?: { urgent?: boolean; clientId?: string; images?: Array<[string, string]> };
  }> = [];
  const cancelSingleCalls: Array<{ sessionId: string; interruptId: string }> = [];
  const cancelAllCalls: string[] = [];
  const rewindCalls: Array<{ sessionId: string; index: number }> = [];
  const runtimeCalls: Array<{ command: string; args: string[]; sessionId?: string }> = [];
  const refreshCalls: Array<string | undefined> = [];
  const cleanupLocalCalls: Array<string | undefined> = [];

  let activeSessionId: string | undefined = "sess_1";
  let supportsSoftInterruptIds = true;
  let singleCancelReturn = true;

  const makeRouter = () =>
    createFeatureRouter({
      bridgeManager: {
        getStatus: () => ({
          state: "connected",
          version: "rayu-harness-v1.14",
          capabilities: supportsSoftInterruptIds
            ? ["permissions", "soft_interrupt_ids"]
            : ["permissions"],
        }),
        ping: async () => ({ ok: true, latencyMs: 1 }),
        reconnect: async () => ({ state: "connected", capabilities: [] }),
        restart: async () => ({ state: "connected", capabilities: [] }),
        reloadDaemon: async () => ({ ok: true }),
        openOutputLog: () => {},
      },
      sessionHub: {
        getActiveSessionId: () => activeSessionId,
        getActiveModel: () => "claude-opus-4-6",
        getActiveProvider: () => "rayu",
        getActivePermissionMode: () => "default",
        getClient: async () =>
          ({
            supports: (cap: string) =>
              cap === "soft_interrupt_ids" ? supportsSoftInterruptIds : true,
            softInterruptWithId: async (
              sessionId: string,
              text: string,
              options?: {
                urgent?: boolean;
                clientId?: string;
                images?: Array<[string, string]>;
              },
            ) => {
              softInterruptCalls.push({ sessionId, text, options });
            },
            cancelSoftInterrupt: async (sessionId: string, interruptId: string) => {
              cancelSingleCalls.push({ sessionId, interruptId });
              return singleCancelReturn;
            },
            cancelSoftInterrupts: async (sessionId: string) => {
              cancelAllCalls.push(sessionId);
            },
            rewind: async (sessionId: string, index: number) => {
              rewindCalls.push({ sessionId, index });
            },
          }) as unknown as Awaited<ReturnType<FeatureRouterDeps["sessionHub"]["getClient"]>>,
        listSessions: async () => ({ sessions: [], activeSessionId }),
        createSession: async () => ({
          sessionId: "sess_1",
          title: "S1",
          status: "idle",
          updatedAtMs: 1,
        }),
        attachSession: async (sessionId) => ({
          sessionId,
          title: sessionId,
          status: "idle",
          updatedAtMs: 1,
        }),
        getHistory: async (sessionId) => ({ sessionId, messages: [] }),
        setSessionPinned: async () => {},
        setSessionArchived: async () => {},
        setPermissionMode: async (_sid, mode) => ({ ok: true, mode }),
        respondPermission: async () => {},
        runtimeCommand: async (command, args = [], sessionId) => {
          runtimeCalls.push({ command, args, sessionId });
          if (command === "background" && args[0] === "cleanup") {
            return {
              session_id: sessionId ?? "",
              command,
              data: { removed_files: 2 },
              message: "ok",
            };
          }
          return {
            session_id: sessionId ?? "",
            command,
            data: { cancelled: true },
            message: "ok",
          };
        },
        getBackgroundTasks: () => [],
        refreshBackgroundProcesses: async (sessionId) => {
          refreshCalls.push(sessionId);
          return [
            {
              taskId: "bg_s1",
              sessionId: "sess_1",
              group: "shells",
              toolName: "bash",
              displayName: "cargo test",
              status: "running",
              progressKind: "indeterminate",
              summary: "Running",
              startedAtMs: 1000,
              updatedAtMs: 2000,
            },
            {
              taskId: "bg_other",
              sessionId: "sess_2",
              group: "shells",
              toolName: "bash",
              displayName: "other task",
              status: "running",
              progressKind: "indeterminate",
              summary: "Other",
              startedAtMs: 1000,
              updatedAtMs: 2100,
            },
          ];
        },
        removeCompletedBackgroundTasks: (sessionId) => {
          cleanupLocalCalls.push(sessionId);
          return 1;
        },
        getSidePanelState: () => ({ pages: [] }),
        closeSidePanelPage: () => {},
        getApplets: () => [],
        getCachedTodos: () => [],
        mapSessionInfoToSummary: (info) => ({
          sessionId: info.session_id,
          title: info.title ?? "Untitled",
          status: "idle",
          updatedAtMs: 1,
        }),
      },
      gitBridge: {
        getStatus: async () => ({
          branch: "main",
          totalAdditions: 0,
          totalDeletions: 0,
          files: [],
          stagedCount: 0,
        }),
        getDiff: async ({ path }) => ({
          path,
          originalContent: "",
          modifiedContent: "",
          unifiedDiff: "",
          additions: 0,
          deletions: 0,
        }),
        stage: async () => ({ ok: true }),
        unstage: async () => ({ ok: true }),
        keep: () => ({ ok: true }),
        undo: async () => ({ ok: true }),
        commit: async () => ({ ok: true }),
        createPr: async () => ({ ok: true }),
        listBranches: async () => ({ current: "main", branches: ["main"] }),
        checkoutBranch: async (_w, branch) => ({ ok: true, branch }),
      },
      editorBridge: {
        openFile: async () => {},
        openWorktreeWindow: async () => {},
        openExternal: async () => {},
        pickFiles: async () => [],
        findWorkspaceFiles: async () => [],
      },
      getWorkspaceFolders: async () => [],
      setProjectIcon: async () => {},
      getGlobalState: <T>(_k: string, d: T) => d,
      updateGlobalState: async () => {},
      getRuntimeSettings: () => ({
        socketPath: "/tmp/rayu-test.sock",
        binaryPath: "/usr/local/bin/rayu",
        autoStart: true,
      }),
      updateRuntimeSettings: async () => {},
      openKeybindings: async () => {},
    });

  const router = makeRouter();

  // 1. background.list filters strictly to targetSessionId and returns [] when no active session exists
  const listForS1 = await router.call("background.list", undefined);
  assert.deepEqual(
    listForS1.tasks.map((t) => t.taskId),
    ["bg_s1"],
  );
  assert.deepEqual(refreshCalls, ["sess_1"]);

  activeSessionId = undefined;
  const listWithNoSession = await router.call("background.list", undefined);
  assert.deepEqual(listWithNoSession.tasks, []);
  assert.equal(refreshCalls.length, 1); // Did NOT call refreshBackgroundProcesses

  activeSessionId = "sess_1";

  // 2. background.cancel and background.cleanup forward target sessionId
  await router.call("background.cancel", { taskId: "bg_s1", sessionId: "sess_1" });
  assert.deepEqual(runtimeCalls.at(-1), {
    command: "background",
    args: ["cancel", "bg_s1"],
    sessionId: "sess_1",
  });
  assert.equal(refreshCalls.at(-1), "sess_1");

  await router.call("background.cleanup", undefined);
  assert.deepEqual(runtimeCalls.at(-1), {
    command: "background",
    args: ["cleanup"],
    sessionId: "sess_1",
  });
  assert.equal(cleanupLocalCalls.at(-1), "sess_1");

  // 3. sessions.softInterrupt forwards urgent: false, caller clientId, and normalized images
  const siRes = await router.call("sessions.softInterrupt", {
    sessionId: "sess_1",
    text: "Use strict types",
    clientId: "client_steer_42",
    images: [
      {
        mediaType: "image/png",
        data: "data:image/png;base64,iVBORw0KGgo=",
      },
    ],
  });
  assert.deepEqual(siRes, { ok: true, interruptId: "client_steer_42" });
  assert.deepEqual(softInterruptCalls[0], {
    sessionId: "sess_1",
    text: "Use strict types",
    options: {
      urgent: false,
      clientId: "client_steer_42",
      images: [["image/png", "iVBORw0KGgo="]],
    },
  });

  // 4. sessions.cancelSoftInterrupts uses cancelSoftInterrupt when capability is present, else falls back
  singleCancelReturn = false;
  const cancelByIdRes = await router.call("sessions.cancelSoftInterrupts", {
    sessionId: "sess_1",
    interruptId: "client_steer_42",
  });
  assert.deepEqual(cancelByIdRes, { ok: true, cancelled: false });
  assert.deepEqual(cancelSingleCalls, [
    { sessionId: "sess_1", interruptId: "client_steer_42" },
  ]);

  supportsSoftInterruptIds = false;
  const fallbackCancelRes = await router.call("sessions.cancelSoftInterrupts", {
    sessionId: "sess_1",
    interruptId: "client_steer_42",
  });
  assert.deepEqual(fallbackCancelRes, { ok: true, cancelled: true });
  assert.equal(cancelSingleCalls.length, 1);
  assert.deepEqual(cancelAllCalls, ["sess_1"]);

  // 5. sessions.rewind resolves 1-based messageIndex, hist_<sid>_<n>, numeric string, and rejects invalid/0 targets
  await router.call("sessions.rewind", {
    sessionId: "sess_1",
    turnId: "hist_ses_abc_3",
  });
  await router.call("sessions.rewind", {
    sessionId: "sess_1",
    turnId: "hist_ses_abc_1",
    messageIndex: 7,
  });
  await router.call("sessions.rewind", {
    sessionId: "sess_1",
    turnId: "5",
  });
  await assert.rejects(
    () =>
      router.call("sessions.rewind", {
        sessionId: "sess_1",
        turnId: "not_a_number",
      }),
    /Invalid rewind target/,
  );
  await assert.rejects(
    () =>
      router.call("sessions.rewind", {
        sessionId: "sess_1",
        turnId: "0",
      }),
    /Invalid rewind target/,
  );
  assert.deepEqual(rewindCalls, [
    { sessionId: "sess_1", index: 3 },
    { sessionId: "sess_1", index: 7 },
    { sessionId: "sess_1", index: 5 },
  ]);
});

test("HistoryMessageViewSchema and mapRawHistoryMessage forward tool, responseStats, and provenance fields", () => {
  const legacyParsed = HistoryMessageViewSchema.parse({
    id: "hist_1",
    role: "user",
    content: "hello",
  });
  assert.equal(legacyParsed.role, "user");
  assert.equal(legacyParsed.responseStats, undefined);

  const mapped = mapRawHistoryMessage(
    {
      role: "assistant",
      content: "Done",
      origin: "engine_internal",
      visibility: "hidden",
      attempt_id: "att_2",
      attempt_reason: "reassess_refusal",
      attempt_status: "answered",
      stop_reason: "end_turn",
      tool: { id: "call_1", name: "bash", input: { command: "pwd" } },
      response_stats: {
        duration_secs: 4.2,
        input_tokens: 100,
        output_tokens: 40,
        cache_read_tokens: 90,
        cache_creation_tokens: 10,
        rayu_credits: 0.15,
      },
    },
    { id: "hist_2", model: "claude-opus-4-6" },
  );

  const parsed = HistoryMessageViewSchema.parse(mapped);
  assert.equal(parsed.toolId, "call_1");
  assert.equal(parsed.toolName, "bash");
  assert.deepEqual(parsed.toolInput, { command: "pwd" });
  assert.equal(parsed.origin, "engine_internal");
  assert.equal(parsed.visibility, "hidden");
  assert.equal(parsed.attemptId, "att_2");
  assert.equal(parsed.attemptReason, "reassess_refusal");
  assert.equal(parsed.attemptStatus, "answered");
  assert.equal(parsed.stopReason, "end_turn");
  assert.equal(parsed.responseStats?.durationSecs, 4.2);
  assert.equal(parsed.responseStats?.cacheReadTokens, 90);
  assert.equal(parsed.responseStats?.rayuCredits, 0.15);
});

test("plugins.mcp.add/edit/remove and plugins.skills.create write real files on disk and reload MCP", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-vsc-plugins-"));
  const rayuHome = path.join(tmpDir, "rayu-home");
  const prevRayuHome = process.env.RAYU_HOME;
  process.env.RAYU_HOME = rayuHome;
  try {
    const { router, runtimeCommandsCalled } = createTestFeatureRouter({
      runtimeHandler: (command, args) => {
        if (command === "mcp" && args[0] === "list") {
          return { data: { servers: [] }, message: "ok" };
        }
        return { data: { reloaded: true }, message: "ok" };
      },
    });

    const addRes = await router.call("plugins.mcp.add", {
      id: "context7",
      scope: "global",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      shared: true,
      timeoutSecs: 30,
    });
    assert.equal(addRes.ok, true);
    const mcpJsonPath = path.join(rayuHome, "mcp.json");
    assert.equal(fs.existsSync(mcpJsonPath), true);
    const saved = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8")) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>;
    };
    assert.equal(saved.mcpServers.context7?.command, "npx");
    assert.deepEqual(saved.mcpServers.context7?.args, [
      "-y",
      "@upstash/context7-mcp",
    ]);
    assert.equal(
      runtimeCommandsCalled.some(
        (c) => c.command === "mcp" && c.args[0] === "reload",
      ),
      true,
    );

    const removeRes = await router.call("plugins.mcp.remove", {
      id: "context7",
      scope: "global",
    });
    assert.equal(removeRes.ok, true);
    const afterRemove = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    assert.equal("context7" in afterRemove.mcpServers, false);

    const skillRes = await router.call("plugins.skills.create", {
      name: "Release Gate",
      description: "Verify release checklist before shipping",
      scope: "global",
    });
    assert.equal(skillRes.ok, true);
    assert.equal(skillRes.skill.name, "release-gate");
    assert.equal(fs.existsSync(skillRes.skill.path), true);
    const skillText = fs.readFileSync(skillRes.skill.path, "utf8");
    assert.match(skillText, /name: release-gate/);
    assert.match(skillText, /Verify release checklist before shipping/);
  } finally {
    if (prevRayuHome === undefined) {
      delete process.env.RAYU_HOME;
    } else {
      process.env.RAYU_HOME = prevRayuHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("featureRouters exposes v1.16 capabilities.get, config.get, config.patch and degrades cleanly on v1.15 daemons", async () => {
  let configValues: Record<string, unknown> = {
    "provider.default_model": "claude-opus-5-5",
    "features.swarm": true,
    "compaction.auto_compact": true,
  };
  const configSchema = [
    {
      key: "provider.default_model",
      section: "provider",
      label: "Default model",
      description: "Primary model route",
      kind: "string" as const,
      default_value: "claude-opus-5-5",
      apply_mode: "next_turn" as const,
    },
    {
      key: "features.swarm",
      section: "features",
      label: "Swarm orchestration",
      description: "Enable multi-agent swarm",
      kind: "boolean" as const,
      default_value: true,
      apply_mode: "restart_required" as const,
    },
  ];

  // 1) v1.16 daemon client
  let v116ClientMode: "v116" | "v115" | "busy" = "v116";
  const base = createTestFeatureRouter({
    runtimeInfoRoutes: [
      {
        model: "claude-opus-5-5",
        provider: "rayu",
        api_method: "messages",
        available: true,
        detail: "Rayu Cloud",
      },
    ],
  });
  void base;

  const customDeps = (() => {
    const globalStore = new Map<string, unknown>();
    const daemonStatus: DaemonStatusView = {
      state: "connected",
      version: "rayu-harness-v1.16",
      protocolVersion: "1.16",
      socketPath: "/tmp/rayu-v116.sock",
      latencyMs: 2,
      capabilities: ["permissions", "capabilities_v1", "config_v1", "frame_fidelity_v1"],
      isRayuRepo: true,
    };
    const deps: FeatureRouterDeps = {
      bridgeManager: {
        getStatus: () => daemonStatus,
        ping: async () => ({ ok: true, latencyMs: 2, version: "1.16" }),
        reconnect: async () => daemonStatus,
        restart: async () => daemonStatus,
        reloadDaemon: async () => ({ ok: true, message: "Reloaded" }),
        openOutputLog: () => {},
      },
      sessionHub: {
        getActiveSessionId: () => "sess_1",
        getActiveModel: () => "claude-opus-5-5",
        getActiveProvider: () => "rayu",
        getActivePermissionMode: () => "default",
        getClient: async () =>
          ({
            getRuntimeInfo: async () => ({
              provider: "rayu",
              model: "claude-opus-5-5",
              routes: [
                {
                  model: "claude-opus-5-5",
                  provider: "rayu",
                  api_method: "messages",
                  available: true,
                  detail: "Rayu Cloud",
                  supported_efforts: ["low", "medium", "high", "xhigh", "max"],
                  default_effort: "medium",
                  context_window: 200_000,
                },
                {
                  model: "gpt-4o-mini",
                  provider: "openai",
                  api_method: "responses",
                  available: true,
                  detail: "Fixed reasoning",
                  supported_efforts: [],
                  default_effort: null,
                },
              ],
            }),
            getCapabilities: async () => {
              if (v116ClientMode === "v115") return null;
              return {
                commands: [
                  {
                    name: "compact",
                    description: "Compact session context",
                    category: "session",
                    requires_session: true,
                    dispatch: { kind: "api_request", req: "compact" },
                  },
                  {
                    name: "effort",
                    description: "Set reasoning effort",
                    category: "model",
                    arg_hint: "<low|medium|high|xhigh|max>",
                    requires_session: true,
                    dispatch: { kind: "api_request", req: "set_reasoning_effort" },
                  },
                ],
                permission_modes: [
                  {
                    id: "default",
                    label: "Ask",
                    description: "Prompt before mutations",
                    is_default: true,
                  },
                ],
                features: [
                  {
                    key: "features.swarm",
                    enabled: true,
                    description: "Swarm orchestration",
                    requires_restart: true,
                  },
                ],
              };
            },
            getConfig: async () => {
              if (v116ClientMode === "v115") return null;
              return {
                path: "~/.rayu/config.toml",
                sections: ["provider", "features"],
                values: { ...configValues },
                schema: configSchema,
              };
            },
            patchConfig: async (patch: Record<string, unknown>) => {
              if (v116ClientMode === "v115") {
                throw new HarnessError("unsupported", "config_v1 not supported");
              }
              if ("provider.bad_key" in patch) {
                throw new HarnessError("invalid_request", "Unknown config key: provider.bad_key");
              }
              configValues = { ...configValues, ...patch };
              return {
                path: "~/.rayu/config.toml",
                sections: ["provider", "features"],
                values: { ...configValues },
                schema: configSchema,
              };
            },
            setModel: async () => {
              if (v116ClientMode === "busy") {
                throw new HarnessError("busy", "Turn in progress; applies on next turn");
              }
            },
            setReasoningEffort: async () => {
              if (v116ClientMode === "busy") {
                throw new HarnessError("busy", "Turn in progress; applies on next turn");
              }
            },
          }) as unknown as Awaited<ReturnType<FeatureRouterDeps["sessionHub"]["getClient"]>>,
        listSessions: async () => ({ sessions: [], activeSessionId: "sess_1" }),
        createSession: async () => ({
          sessionId: "sess_1",
          title: "Main",
          status: "idle",
          updatedAtMs: 1,
        }),
        attachSession: async (sessionId) => ({
          sessionId,
          title: "Main",
          status: "idle",
          updatedAtMs: 1,
        }),
        getHistory: async (sessionId) => ({ sessionId, messages: [] }),
        setSessionPinned: async () => {},
        setSessionArchived: async () => {},
        setPermissionMode: async (_sid, mode) => ({ ok: true, mode }),
        respondPermission: async () => {},
        runtimeCommand: async (command, _args = [], sessionId) => {
          if (v116ClientMode === "busy") {
            throw new HarnessError("busy", "Session is busy");
          }
          return {
            session_id: sessionId ?? "sess_1",
            command,
            data: { ok: true },
            message: `Ran ${command}`,
          };
        },
        getBackgroundTasks: () => [],
        refreshBackgroundProcesses: async () => [],
        removeCompletedBackgroundTasks: () => 0,
        getSidePanelState: () => ({ pages: [] }),
        closeSidePanelPage: () => {},
        getApplets: () => [],
        getCachedTodos: () => [],
        mapSessionInfoToSummary: (info) => ({
          sessionId: info.session_id,
          title: info.title ?? "Untitled",
          status: "idle",
          updatedAtMs: 1,
        }),
      },
      gitBridge: {
        getStatus: async () => ({
          branch: "main",
          baseBranch: "main",
          totalAdditions: 0,
          totalDeletions: 0,
          files: [],
          stagedCount: 0,
          hasGhCli: true,
        }),
        getDiff: async ({ path: p }) => ({
          path: p,
          originalContent: "",
          modifiedContent: "",
          unifiedDiff: "",
          additions: 0,
          deletions: 0,
          languageId: "typescript",
        }),
        stage: async () => ({ ok: true }),
        unstage: async () => ({ ok: true }),
        keep: () => ({ ok: true }),
        undo: async () => ({ ok: true }),
        commit: async () => ({ ok: true }),
        createPr: async () => ({ ok: true }),
        listBranches: async () => ({ current: "main", branches: ["main"] }),
        checkoutBranch: async (_ws, branch) => ({ ok: true, branch }),
      },
      editorBridge: {
        openFile: async () => {},
        openWorktreeWindow: async () => {},
        openExternal: async () => {},
        pickFiles: async () => [],
        findWorkspaceFiles: async () => [],
      },
      getWorkspaceFolders: async () => [],
      setProjectIcon: async () => {},
      getGlobalState: <T>(key: string, defaultValue: T): T =>
        globalStore.has(key) ? (globalStore.get(key) as T) : defaultValue,
      updateGlobalState: async (key, value) => {
        globalStore.set(key, value);
      },
      getRuntimeSettings: () => ({
        socketPath: "/tmp/rayu-v116.sock",
        binaryPath: "/usr/local/bin/rayu",
        autoStart: true,
      }),
      updateRuntimeSettings: async () => {},
      openKeybindings: async () => {},
    };
    return deps;
  })();

  const router = createFeatureRouter(customDeps);

  // Capabilities returns live engine commands, permission modes, and features
  const caps = await router.call("capabilities.get", { sessionId: "sess_1" });
  assert.equal(caps.supported, true);
  assert.equal(caps.commands.length, 2);
  assert.equal(caps.commands[0]?.name, "compact");
  assert.equal(caps.commands[1]?.arg_hint, "<low|medium|high|xhigh|max>");
  assert.equal(caps.permission_modes.length, 1);
  assert.equal(caps.features[0]?.requires_restart, true);

  // settings.models.get forwards v1.16 supported_efforts + default_effort + context_window
  const modelsRes = await router.call("settings.models.get", { sessionId: "sess_1" });
  assert.deepEqual(modelsRes.routes?.[0]?.supportedEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.equal(modelsRes.routes?.[0]?.defaultEffort, "medium");
  assert.equal(modelsRes.routes?.[0]?.contextWindow, 200_000);
  assert.deepEqual(modelsRes.routes?.[1]?.supportedEfforts, []);
  assert.equal(modelsRes.routes?.[1]?.defaultEffort, null);

  // config.get returns curated config snapshot
  const cfg = await router.call("config.get", {});
  assert.equal(cfg.supported, true);
  assert.equal(cfg.config?.path, "~/.rayu/config.toml");
  assert.equal(cfg.config?.values["features.swarm"], true);

  // config.patch updates value and computes requiresRestart for restart_required keys
  const patchOk = await router.call("config.patch", {
    patch: { "features.swarm": false },
  });
  assert.equal(patchOk.ok, true);
  assert.equal(patchOk.requiresRestart, true);
  assert.equal(patchOk.config?.values["features.swarm"], false);

  // config.patch returns honest validation error without faking ok: true
  const patchInvalid = await router.call("config.patch", {
    patch: { "provider.bad_key": "oops" },
  });
  assert.equal(patchInvalid.ok, false);
  assert.equal(patchInvalid.code, "invalid_request");
  assert.match(patchInvalid.message ?? "", /Unknown config key/);

  // Busy mid-turn propagation on setModel / setEffort / runtimeCommand
  v116ClientMode = "busy";
  const busyModel = await router.call("sessions.setModel", {
    sessionId: "sess_1",
    model: "gpt-4o-mini",
  });
  assert.equal(busyModel.ok, false);
  assert.equal(busyModel.deferred, true);
  assert.equal(busyModel.code, "busy");

  const busyEffort = await router.call("sessions.setEffort", {
    sessionId: "sess_1",
    effort: "high",
  });
  assert.equal(busyEffort.ok, false);
  assert.equal(busyEffort.deferred, true);
  assert.equal(busyEffort.code, "busy");

  const busyCmd = await router.call("sessions.runtimeCommand", {
    sessionId: "sess_1",
    command: "context",
  });
  assert.equal(busyCmd.ok, false);
  assert.equal(busyCmd.code, "busy");

  // Graceful v1.15 daemon degradation (returns supported: false instead of crashing)
  v116ClientMode = "v115";
  const legacyCaps = await router.call("capabilities.get", {});
  assert.equal(legacyCaps.supported, false);
  assert.deepEqual(legacyCaps.commands, []);

  const legacyCfg = await router.call("config.get", {});
  assert.equal(legacyCfg.supported, false);
  assert.equal(legacyCfg.config, null);

  const legacyPatch = await router.call("config.patch", {
    patch: { "features.swarm": true },
  });
  assert.equal(legacyPatch.ok, false);
  assert.equal(legacyPatch.code, "unsupported");
});

test("featureRouters forwards overnight.start without 'start' prefix, question_response selected/declined, and honest contextSnapshot zeros", async () => {
  const { router, runtimeCommandsCalled } = createTestFeatureRouter({
    runtimeHandler: (command, args) => {
      if (command === "overnight") {
        return {
          data: {
            run_id: "ovn_new_1",
            status: "running",
            mission: args.slice(1).join(" "),
          },
          message: "started",
        };
      }
      return { data: {}, message: "ok" };
    },
  });

  // 1. automations.overnight.start passes [duration, mission] without bogus "start" prefix
  await router.call("automations.overnight.start", {
    duration: "2h",
    mission: "Audit Rust and VS Code protocol",
  });
  assert.deepEqual(
    runtimeCommandsCalled.filter((c) => c.command === "overnight").at(-1)?.args,
    ["2h", "Audit Rust and VS Code protocol"],
  );

  // 2. normalizeHarnessRequestFrame translates question_response into Rust QuestionResponse wire shape
  const selectedWire = normalizeHarnessRequestFrame({
    req: "question_response",
    session_id: "sess_q",
    request_id: "q_multi",
    answers: { "Pick env": "staging" },
    selected: { "Pick env": [1] },
  });
  assert.equal(selectedWire.req, "question_response");
  assert.deepEqual(selectedWire.response, {
    kind: "answered",
    answers: {
      "Pick env": {
        selected: [1],
      },
    },
  });

  const declinedWire = normalizeHarnessRequestFrame({
    req: "question_response",
    session_id: "sess_q",
    request_id: "q_multi",
    answers: {},
    declined: true,
  });
  assert.deepEqual(declinedWire.response, { kind: "declined" });

  // 3. workspace.contextSnapshot returns honest zero usage rather than fabricated breakdown numbers
  const snap = await router.call("workspace.contextSnapshot", {
    sessionId: "sess_1",
  });
  assert.equal(snap.usedTokens, 0);
  assert.equal(snap.usedPercent, 0);
  assert.equal(snap.freeTokens, snap.maxTokens);
  assert.deepEqual(
    snap.categories.map((c) => c.tokens),
    [0, 0, 0, 0, 0],
  );
});

test("featureRouters handles settings.permission.getDefault and settings.permission.setDefault with optional active-session apply", async () => {
  const { router } = createTestFeatureRouter();

  const initial = await router.call("settings.permission.getDefault", undefined);
  assert.equal(initial.mode, "default");

  const updated = await router.call("settings.permission.setDefault", {
    mode: "acceptEdits",
    applyToActiveSession: true,
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.mode, "acceptEdits");

  const sessionsAfter = await router.call("sessions.list", undefined);
  assert.equal(sessionsAfter.sessions[0]?.permissionMode, "acceptEdits");

  const reloaded = await router.call("settings.permission.getDefault", undefined);
  assert.equal(reloaded.mode, "acceptEdits");
});
