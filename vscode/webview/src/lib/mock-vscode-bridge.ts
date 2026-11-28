import type {
  AccentPreference,
  AccountStatusView,
  AgentRoleOverrideView,
  AmbientStatusView,
  AnalyticsSummaryView,
  AppletStateView,
  BackgroundProcessView,
  CacheTtl,
  ChangesStatusView,
  ContextSnapshotView,
  DaemonStatusView,
  DensityPreference,
  EffortChoice,
  FeatureFlagsView,
  FileChangeActionKind,
  FileChangeActionResultView,
  FileChangeStatus,
  FileChangesSnapshotView,
  HistoryMessageView,
  HostToWebviewMessage,
  McpServerView,
  MemoryStatusView,
  ModelRouteOptionView,
  OvernightRunView,
  PermissionModeId,
  ProviderEntryView,
  ProviderTransport,
  QualityStatusView,
  RemoteInfraStatusView,
  RpcMethod,
  RpcParams,
  RpcResult,
  ScheduleItemView,
  ServiceTier,
  SessionSummaryView,
  SidePanelPageView,
  SkillView,
  SwarmStatusView,
  TelegramStatusView,
  TelemetryConfigView,
  ThemePreference,
  TodoItemView,
  VoiceStatusView,
  WebviewToHostMessage,
  WorkbenchPreferences,
  WorkspaceFolderView,
  WorkspaceIntegrationsView,
  WorkspaceLedgerView,
} from "@shared/vscodeProtocol";

type HostMessageDispatch = (msg: HostToWebviewMessage) => void;

const NOW = Date.now();

interface MockBridgeState {
  daemon: DaemonStatusView;
  workspaces: WorkspaceFolderView[];
  collapsedWorkspaceIds: string[];
  sessions: SessionSummaryView[];
  sessionHistories: Record<string, HistoryMessageView[]>;
  activeSessionId: string | undefined;
  backgroundTasks: BackgroundProcessView[];
  account: AccountStatusView;
  swarm: SwarmStatusView;
  overnightRuns: OvernightRunView[];
  schedules: ScheduleItemView[];
  ambient: AmbientStatusView;
  quality: QualityStatusView;
  mcpServers: McpServerView[];
  skills: SkillView[];
  memory: MemoryStatusView;
  workspaceIntegrations: WorkspaceIntegrationsView;
  changes: ChangesStatusView;
  fileChangesBySession: Record<string, FileChangesSnapshotView>;
  telegram: TelegramStatusView;
  remoteInfra: RemoteInfraStatusView;
  providers: ProviderEntryView[];
  features: FeatureFlagsView;
  voice: VoiceStatusView;
  telemetry: TelemetryConfigView;
  sidePanelPages: SidePanelPageView[];
  applets: AppletStateView[];
  todos: TodoItemView[];
  modelSettings: {
    defaultModel?: string;
    defaultEffort: EffortChoice;
    serviceTier: ServiceTier;
    cacheTtl: CacheTtl;
    transport: ProviderTransport;
    subagentModel?: string | null;
    inheritModel?: string | null;
    roleOverrides: AgentRoleOverrideView[];
    effectiveRoleModels?: Record<string, string | null>;
    profiles: Array<{
      name: string;
      model: string;
      description: string;
      effort?: string | null;
      scope: "global" | "session";
    }>;
    configPath?: string;
    routes: ModelRouteOptionView[];
  };
  appearance: {
    theme: ThemePreference;
    accent: AccentPreference;
    density: DensityPreference;
    reduceMotion: boolean;
  };
  workbench: WorkbenchPreferences;
}

interface MockV116State {
  capabilitiesSupported: boolean;
  configSupported: boolean;
  busyMode: boolean;
  rejectPatchKeys: Record<string, string>;
  commands: Array<{
    name: string;
    description: string;
    category: string;
    arg_hint?: string;
    requires_session?: boolean;
    dispatch:
      | { kind: "api_request"; req: string }
      | { kind: "runtime_command"; command: string }
      | { kind: "skill"; name: string };
  }>;
  permissionModes: Array<{
    id: string;
    label: string;
    description: string;
    is_default?: boolean;
  }>;
  featureDescriptors: Array<{
    key: string;
    enabled: boolean;
    description: string;
    requires_restart?: boolean;
  }>;
  configPath: string;
  configSections: string[];
  configValues: Record<string, unknown>;
  configSchema: Array<{
    key: string;
    section: string;
    label: string;
    description: string;
    kind: "boolean" | "string" | "integer" | "number" | "enum" | "string_array";
    options?: Array<{ value: string; label: string }>;
    default_value: unknown;
    apply_mode: "immediate" | "next_turn" | "restart_required";
  }>;
}

function createDefaultMockV116State(): MockV116State {
  return {
    capabilitiesSupported: true,
    configSupported: true,
    busyMode: false,
    rejectPatchKeys: {},
    commands: [
      {
        name: "compact",
        description: "Summarize conversation history to free context",
        category: "session",
        requires_session: true,
        dispatch: { kind: "api_request", req: "compact" },
      },
      {
        name: "effort",
        description: "Set reasoning effort for the active model",
        category: "model",
        arg_hint: "<low|medium|high|xhigh|max>",
        requires_session: true,
        dispatch: { kind: "api_request", req: "set_reasoning_effort" },
      },
      {
        name: "model",
        description: "Switch provider route for the active session",
        category: "model",
        arg_hint: "<id>",
        requires_session: true,
        dispatch: { kind: "api_request", req: "set_model" },
      },
      {
        name: "review",
        description: "Run an independent engineering and diff review pass",
        category: "quality",
        requires_session: true,
        dispatch: { kind: "runtime_command", command: "review" },
      },
      {
        name: "context",
        description: "Inspect context token usage breakdown",
        category: "session",
        requires_session: true,
        dispatch: { kind: "runtime_command", command: "context" },
      },
      {
        name: "clear",
        description: "Reset to a fresh session on Home",
        category: "session",
        dispatch: { kind: "runtime_command", command: "clear" },
      },
    ],
    permissionModes: [
      {
        id: "default",
        label: "Ask",
        description: "Ask before running tools that change anything.",
        is_default: true,
      },
      {
        id: "accept_edits",
        label: "Auto-edit",
        description: "Apply file edits without asking.",
      },
      {
        id: "plan",
        label: "Plan",
        description: "Investigate and write a plan without editing.",
      },
    ],
    featureDescriptors: [
      {
        key: "features.swarm",
        enabled: true,
        description: "Enable parallel coordinator/worker swarm mission control",
        requires_restart: true,
      },
      {
        key: "features.memory",
        enabled: true,
        description: "Persist and recall architectural facts across sessions",
        requires_restart: false,
      },
    ],
    configPath: "~/.rayu/config.toml",
    configSections: ["provider", "compaction", "features", "safety", "agents"],
    configValues: {
      "provider.default_model": "claude-sonnet-4-5",
      "provider.default_effort": "medium",
      "provider.service_tier": "auto",
      "provider.cache_ttl": "5m",
      "features.memory": true,
      "features.swarm": true,
      "features.mermaid": true,
      "features.auto_poke": false,
      "features.todo_gate_digest": true,
      "features.todo_gate_diagnostics": true,
      "features.message_timestamps": true,
      "features.persist_memory_injections": true,
      "features.kv_cache_miss_notices": false,
      "features.check_updates": true,
      "features.update_channel": "stable",
      "safety.default_permission_mode": "default",
    },
    configSchema: [
      {
        key: "provider.default_model",
        section: "provider",
        label: "Default model route",
        description: "Primary model route used for new sessions",
        kind: "string",
        default_value: "claude-sonnet-4-5",
        apply_mode: "next_turn",
      },
      {
        key: "provider.default_effort",
        section: "provider",
        label: "Default reasoning effort",
        description: "Default thinking budget for reasoning models",
        kind: "enum",
        default_value: "medium",
        apply_mode: "next_turn",
      },
      {
        key: "features.swarm",
        section: "features",
        label: "Swarm Multi-Agent Orchestration",
        description: "Enable parallel coordinator/worker swarm mission control",
        kind: "boolean",
        default_value: true,
        apply_mode: "restart_required",
      },
      {
        key: "features.memory",
        section: "features",
        label: "Semantic & Jev Memory Graph",
        description: "Persist and recall architectural facts across sessions",
        kind: "boolean",
        default_value: true,
        apply_mode: "immediate",
      },
      {
        key: "features.update_channel",
        section: "features",
        label: "Update Channel",
        description: "Release channel for managed RayuCode binaries",
        kind: "enum",
        options: [
          { value: "stable", label: "stable" },
          { value: "preview", label: "preview" },
          { value: "main", label: "main" },
        ],
        default_value: "stable",
        apply_mode: "restart_required",
      },
    ],
  };
}

let mockV116State: MockV116State = createDefaultMockV116State();

export function __setMockV116StateForTest(
  patch: Partial<MockV116State>,
): void {
  mockV116State = {
    ...mockV116State,
    ...patch,
    configValues: patch.configValues
      ? { ...patch.configValues }
      : { ...mockV116State.configValues },
    rejectPatchKeys: patch.rejectPatchKeys
      ? { ...patch.rejectPatchKeys }
      : { ...mockV116State.rejectPatchKeys },
  };
}

export function __resetMockV116StateForTest(): void {
  mockV116State = createDefaultMockV116State();
}

const mockState: MockBridgeState = {
  daemon: {
    state: "connected",
    version: "2.4.0-dev",
    bridgeVersion: "1.14.0",
    protocolVersion: "1.14",
    socketPath: "/run/user/1000/rayu-daemon.sock",
    latencyMs: 4,
    pid: 41092,
    capabilities: [
      "sessions",
      "background",
      "swarm",
      "swarm_mutations_v1",
      "overnight",
      "overnight_v1",
      "schedules",
      "schedules_cron_v1",
      "ambient",
      "mcp",
      "skills",
      "memory",
      "telegram",
      "telegram_remote",
      "gateway",
      "voice",
      "codemode",
      "file_changes",
    ],
    isRayuRepo: true,
  },

  workspaces: [
    {
      name: "rayucode-v2",
      path: "/workspace/rayucode-v2",
      branch: "main",
      icon: { kind: "icon", value: "rocket", color: "brand" },
      isPrimary: true,
    },
    {
      name: "rayu-cloud-api",
      path: "/workspace/rayu-cloud-api",
      branch: "feat/kv-cache",
      icon: { kind: "icon", value: "database", color: "info" },
    },
  ],

  collapsedWorkspaceIds: [],

  sessions: [
    {
      sessionId: "ses_vscode_shell",
      title: "Build VS Code dual-form-factor shell",
      workingDir: "/workspace/rayucode-v2",
      branch: "main",
      status: "idle",
      model: "claude-sonnet-4-5",
      provider: "rayu-cloud",
      permissionMode: "acceptEdits",
      updatedAtMs: NOW - 180_000,
      createdAtMs: NOW - 3_600_000,
      pinned: true,
      archived: false,
      diffAdditions: 248,
      diffDeletions: 34,
      previewText: "Wired AppShell, LeftSidebar, and CompactTopBar with Tailwind v4 tokens.",
      sourceTool: "rayu",
    },
    {
      sessionId: "ses_shard_lookup",
      title: "Optimize ShardStore lookup p99 latency",
      workingDir: "/workspace/rayucode-v2",
      branch: "main",
      status: "running",
      model: "claude-opus-4-5",
      provider: "rayu-cloud",
      permissionMode: "default",
      updatedAtMs: NOW - 45_000,
      createdAtMs: NOW - 7_200_000,
      pinned: false,
      archived: false,
      diffAdditions: 92,
      diffDeletions: 41,
      previewText: "Running cargo bench on shard_store::lookup...",
      sourceTool: "rayu",
    },
    {
      sessionId: "ses_kv_cache",
      title: "Add 1h KV-cache TTL header propagation",
      workingDir: "/workspace/rayu-cloud-api",
      branch: "feat/kv-cache",
      status: "idle",
      model: "gpt-5.2",
      provider: "openai",
      permissionMode: "plan",
      updatedAtMs: NOW - 86_400_000,
      createdAtMs: NOW - 90_000_000,
      pinned: false,
      archived: false,
      diffAdditions: 54,
      diffDeletions: 12,
      previewText: "Verified cache_control propagation across gateway routes.",
      sourceTool: "rayu",
    },
    {
      sessionId: "ses_archived_mcp",
      title: "Audit 7-layer MCP schema token budget",
      workingDir: "/workspace/rayucode-v2",
      branch: "main",
      status: "idle",
      model: "claude-sonnet-4-5",
      provider: "rayu-cloud",
      permissionMode: "default",
      updatedAtMs: NOW - 432_000_000,
      createdAtMs: NOW - 500_000_000,
      pinned: false,
      archived: true,
      previewText: "Completed budget report: 3,420 / 8,000 tokens used.",
      sourceTool: "rayu",
    },
  ],

  sessionHistories: {
    ses_shard_lookup: [
      {
        id: "hist_shard_1",
        role: "user",
        content: "Profile ShardStore::lookup p99 latency under concurrent reads.",
        createdAtMs: NOW - 120_000,
      },
      {
        id: "hist_shard_2",
        role: "assistant",
        content:
          "Benchmarked `crates/rayu-harness/src/lookup.rs` and removed the redundant key clone on hot-path hits, lowering p99 lookup latency by 38%.",
        createdAtMs: NOW - 60_000,
        model: "claude-opus-4-5",
      },
    ],
    ses_kv_cache: [
      {
        id: "hist_kv_1",
        role: "user",
        content: "Verify 1h KV-cache TTL header propagation across gateway routes.",
        createdAtMs: NOW - 86_500_000,
      },
      {
        id: "hist_kv_2",
        role: "assistant",
        content:
          "Verified `cache_control: ephemeral` TTL propagation on Anthropic and Rayu Cloud gateway routes.",
        createdAtMs: NOW - 86_400_000,
        model: "gpt-5.2",
      },
    ],
  },

  activeSessionId: "ses_vscode_shell",

  backgroundTasks: [
    {
      taskId: "bg_cargo_test",
      sessionId: "ses_vscode_shell",
      group: "shells",
      toolName: "run_command",
      displayName: "cargo test -p rayu-harness",
      status: "running",
      progressKind: "determinate",
      percent: 68,
      current: 34,
      total: 50,
      unit: "tests",
      summary: "34/50 integration tests passed",
      etaSeconds: 18,
      outputFile: "/tmp/rayu-bg-cargo-test.log",
      startedAtMs: NOW - 42_000,
      updatedAtMs: NOW - 2_000,
      durationSecs: 42,
      unread: false,
    },
  ],

  account: {
    signedIn: true,
    authMethod: "oauth",
    signingIn: false,
    pendingAuthUrl: null,
    pendingMode: null,
    webBase: "https://rayucode.com",
    error: null,
    displayName: "Rayu Developer",
    email: "dev@rayucode.com",
    planName: "Plus",
    creditsRemaining: 94_250,
    topUpBalance: 12_000,
    bypassPacing: false,
    windows: [
      {
        label: "5-hour limit",
        remainingPercent: 86,
        usedPercent: 14,
        resetCountdown: "Resets in 3h 42m",
      },
      {
        label: "Weekly limit",
        remainingPercent: 74,
        usedPercent: 26,
        resetCountdown: "Resets in 4d 11h",
      },
    ],
    planLadder: [
      {
        id: "free",
        name: "Free",
        priceLabel: "$0",
        current: false,
        highlights: ["BYOK across 55+ providers", "Local CLI & VS Code extension"],
      },
      {
        id: "pro",
        name: "Pro",
        priceLabel: "$10 / mo",
        current: false,
        highlights: ["50,000 Rayu Cloud credits / mo", "Hosted Telegram pairing"],
      },
      {
        id: "plus",
        name: "Plus",
        priceLabel: "$20 / mo",
        current: true,
        highlights: ["115,000 Rayu Cloud credits / mo", "Swarms & Overnight runs"],
      },
      {
        id: "max",
        name: "Max",
        priceLabel: "$50 / mo",
        current: false,
        highlights: ["300,000 Rayu Cloud credits / mo", "Priority routing"],
      },
      {
        id: "team",
        name: "Team",
        priceLabel: "$10 / mo",
        current: false,
        highlights: ["30,000 shared credits / mo", "Unlimited seats"],
      },
      {
        id: "team-plus",
        name: "Team Plus",
        priceLabel: "$29 / mo",
        current: false,
        highlights: ["100,000 shared credits / mo", "Unlimited seats & Telegram"],
      },
      {
        id: "team-max",
        name: "Team Max",
        priceLabel: "$79 / mo",
        current: false,
        highlights: ["400,000 shared credits / mo", "Dedicated priority capacity"],
      },
    ],
  },

  swarm: {
    swarmId: "swarm_vscode_wave2",
    label: "VS Code Extension Wave 2",
    planVersion: 3,
    planLabel: "Dual-Form-Factor Architecture",
    creditsUsed: 42.6,
    kvWarmPercent: 93,
    agents: [
      {
        agentId: "coordinator",
        sessionId: "ses_vscode_shell",
        label: "coordinator",
        role: "coordinator",
        depth: 0,
        status: "running",
        model: "claude-opus-4-5",
        provider: "rayu-cloud",
        currentIntent: "Coordinating Wave 2B UI shell & host runtime",
        branch: "main",
        todoCompleted: 4,
        todoTotal: 6,
        updatedAtMs: NOW - 5_000,
      },
      {
        agentId: "ui-shell",
        sessionId: "ses_worker_shell",
        label: "ui-shell",
        role: "worker",
        depth: 1,
        status: "running",
        model: "claude-sonnet-4-5",
        provider: "rayu-cloud",
        currentIntent: "Building design tokens, Radix primitives, and AppShell",
        branch: "main",
        diffAdditions: 248,
        diffDeletions: 34,
        todoCompleted: 3,
        todoTotal: 4,
        elapsedSecs: 94,
        filesTouched: [
          "vscode/VSCODE_DESIGN.md",
          "vscode/webview/src/features/shell/components/AppShell.tsx",
        ],
        todoItems: [
          { content: "Read design tokens & theme vars", status: "completed" },
          { content: "Wire dual-form-factor AppShell", status: "completed" },
          { content: "Unify background & swarm progress drawer", status: "in_progress" },
          { content: "Run design lint & unit tests", status: "pending" },
        ],
        outputTail: "Updating BackgroundDockBar and BackgroundProcessDrawer with live swarm progress...",
        updatedAtMs: NOW - 2_000,
      },
    ],
    board: [
      {
        seq: 1,
        kind: "broadcast",
        from: "coordinator",
        text: "Wave 2 started: host-runtime and ui-shell running in parallel.",
        timestampMs: NOW - 120_000,
      },
    ],
    planItems: [
      {
        id: "p1",
        phase: "Wave 2",
        title: "Design tokens & Radix primitives",
        assignee: "ui-shell",
        status: "completed",
      },
      {
        id: "p2",
        phase: "Wave 2",
        title: "Dual-form-factor AppShell & Sidebar",
        assignee: "ui-shell",
        status: "in_progress",
      },
    ],
    pendingProposals: [],
    worktrees: [
      {
        id: "wt_main",
        branch: "main",
        path: "/workspace/rayucode-v2",
        manager: "git",
        agents: ["coordinator", "ui-shell"],
        dirtyFiles: 3,
      },
    ],
    conflicts: [],
    modelAllowlist: ["claude-opus-4-5", "claude-sonnet-4-5", "gpt-5.2"],
  },

  overnightRuns: [
    {
      runId: "ov_01",
      mission: "Add regression tests for provider model discovery across all native backends",
      status: "completed",
      mode: "worktree",
      repo: "rayucode-v2",
      branch: "overnight/model-discovery",
      agentCount: 3,
      durationLabel: "2h 14m",
      taskCardCount: 5,
      validationsGreen: 5,
      reviewPath: "/workspace/rayucode-v2/OVERNIGHT_REVIEW.md",
      startedAtMs: NOW - 28_800_000,
      updatedAtMs: NOW - 20_760_000,
      tasks: [
        {
          id: "t1",
          title: "Verify forced refresh bypasses fresh cache",
          status: "completed",
          outcome: "Passed 18/18 tests",
          validationResult: "cargo test --workspace green",
          evidence: ["crates/rayu-providers/src/discovery.rs"],
          followups: [],
        },
      ],
    },
  ],

  schedules: [
    {
      id: "sched_morning_deps",
      title: "Daily dependency & security audit",
      prompt: "Check Cargo.lock and package.json for critical advisories and summarize.",
      cronSummary: "Weekdays at 08:30",
      cronExpression: "30 8 * * 1-5",
      repo: "rayucode-v2",
      permissionMode: "plan",
      enabled: true,
      nextRunAt: "Tomorrow 08:30",
      lastRunAt: "Today 08:30",
    },
  ],

  ambient: {
    enabled: false,
    currentCycleStatus: "idle",
    nextWakeupAt: "Paused",
    recentCycles: [],
    approvals: [
  {
    id: "amb_appr_01",
    action: "cargo test --workspace --all-targets",
    urgency: "normal",
    reason:
      "Ambient drift detector noticed 3 modified Rust crates since last validation cycle.",
    createdAtMs: Date.now() - 240_000,
    status: "pending",
  },
  {
    id: "amb_appr_02",
    action: "git worktree prune && cargo clippy -p rayu-harness",
    urgency: "high",
    reason:
      "Stale worktree lock detected after interrupted background task; requires cleanup confirmation.",
    createdAtMs: Date.now() - 95_000,
    status: "pending",
  },
],
  },

  quality: {
    autoReviewEnabled: true,
    autoReviewModel: "claude-sonnet-4-5",
    autoJudgeEnabled: false,
    autoJudgeModel: "claude-opus-4-5",
  },

  mcpServers: [
    {
      id: "github",
      name: "GitHub",
      brandId: "github",
      status: "connected",
      enabled: true,
      transport: "streamable-http",
      configLayer: "user",
      shared: true,
      cachedToolCount: 14,
      tokenBudgetUsed: 1240,
      oauthRequired: true,
      oauthAuthenticated: true,
      url: "https://api.githubcopilot.com/mcp/",
    },
    {
      id: "linear",
      name: "Linear",
      brandId: "linear",
      status: "cached",
      enabled: true,
      transport: "streamable-http",
      configLayer: "workspace",
      shared: true,
      cachedToolCount: 9,
      tokenBudgetUsed: 860,
      oauthRequired: true,
      oauthAuthenticated: true,
      url: "https://mcp.linear.app/sse",
    },
    {
      id: "context7-docs",
      name: "Context7 Docs",
      brandId: "context7-docs",
      status: "connected",
      enabled: true,
      transport: "stdio",
      configLayer: "global",
      shared: true,
      cachedToolCount: 4,
      tokenBudgetUsed: 420,
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    },
  ],

  skills: [
    {
      name: "rust-verify",
      description: "Run targeted cargo check, clippy, and socket runtime verification.",
      path: ".rayu/skills/rust-verify/SKILL.md",
      scope: "project",
      activeInSession: true,
      installed: true,
      category: "Engineering",
    },
    {
      name: "pr-review",
      description: "Structured security, architecture, and diff review checklist.",
      path: "~/.rayu/skills/pr-review/SKILL.md",
      scope: "global",
      installed: true,
      category: "Quality",
    },
  ],

  memory: {
    enabled: true,
    persistInjections: true,
    pipelineActive: false,
    totalCount: 2,
    facts: [
      {
        id: "mem_1",
        content: "Always use semantic tokens from vscode/webview/src/styles/globals.css — zero raw hex.",
        scope: "project",
        tags: ["design", "vscode"],
        confidence: 0.98,
        updatedAtMs: NOW - 600_000,
      },
      {
        id: "mem_2",
        content: "Test daemon changes against an isolated --socket before restarting shared-server.",
        scope: "global",
        tags: ["rust", "daemon"],
        confidence: 0.95,
        updatedAtMs: NOW - 86_400_000,
      },
    ],
  },

  workspaceIntegrations: {
    gmail: { connected: false, actionCount: 0 },
    calendar: { connected: false, calendarCount: 0, actionCount: 0 },
    browser: {
      detectedBrowsers: ["Chromium"],
      handoffActive: false,
      actionCount: 0,
    },
    companion: { running: true, keepAwake: false, version: "2.4.0" },
  },

  changes: {
    branch: "main",
    baseBranch: "origin/main",
    totalAdditions: 248,
    totalDeletions: 34,
    stagedCount: 1,
    hasGhCli: true,
    files: [
      {
        path: "vscode/webview/src/styles/globals.css",
        status: "added",
        staged: true,
        additions: 180,
        deletions: 0,
        decision: "accepted",
        fromSession: true,
      },
      {
        path: "vscode/webview/src/features/shell/components/AppShell.tsx",
        status: "modified",
        staged: false,
        additions: 68,
        deletions: 34,
        decision: "pending",
        fromSession: true,
      },
    ],
  },

  fileChangesBySession: {
    ses_vscode_shell: {
      sessionId: "ses_vscode_shell",
      latestTurnId: 2,
      totalPendingFiles: 1,
      totalAdditions: 248,
      totalDeletions: 34,
      files: [
        {
          path: "/workspace/rayucode-v2/vscode/webview/src/styles/globals.css",
          displayPath: "vscode/webview/src/styles/globals.css",
          kind: "created",
          status: "kept",
          additions: 180,
          deletions: 0,
          changedInLatestTurn: false,
          turnId: 1,
          editCount: 1,
          isBinary: false,
          undoable: true,
          canRedo: false,
          previewHunks: [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 4,
              header: "@@ -0,0 +1,4 @@",
              lines: [
                "+:root {",
                "+  --surface-canvas: var(--bg-canvas);",
                "+  --surface-accent: var(--accent);",
                "+}",
              ],
            },
          ],
          previewTruncated: true,
          updatedAtMs: NOW - 180_000,
        },
        {
          path: "/workspace/rayucode-v2/vscode/webview/src/features/shell/components/AppShell.tsx",
          displayPath: "vscode/webview/src/features/shell/components/AppShell.tsx",
          kind: "modified",
          status: "pending",
          additions: 68,
          deletions: 34,
          changedInLatestTurn: true,
          turnId: 2,
          editCount: 2,
          isBinary: false,
          undoable: true,
          canRedo: false,
          previewHunks: [
            {
              oldStart: 18,
              oldLines: 4,
              newStart: 18,
              newLines: 5,
              header: "@@ -18,4 +18,5 @@",
              lines: [
                " export function AppShell({ children }: AppShellProps) {",
                "-  return <div className=\"flex h-screen\">{children}</div>;",
                "+  return (",
                "+    <div className=\"@container/app flex h-screen w-screen overflow-hidden\">{children}</div>",
                "+  );",
                " }",
              ],
            },
          ],
          previewTruncated: false,
          updatedAtMs: NOW - 60_000,
        },
      ],
    },
  },

  telegram: {
    linked: false,
    configured: false,
    statusLabel: "Disconnected",
    authPath: "~/.rayu/telegram-remote.json",
    daemonOnline: true,
    remoteUninstallEnabled: false,
    approvals: [],
  },

  remoteInfra: {
    gateway: {
      enabled: false,
      bindAddr: "127.0.0.1",
      port: 7643,
      dialAddress: "ws://127.0.0.1:7643",
      devices: [],
    },
    sessions: [],
    cloudConfigured: true,
    sshHosts: ["devbox-east", "gpu-runner-01"],
  },

  providers: [
    {
      id: "rayu",
      name: "Rayu Cloud Gateway",
      category: "native",
      status: "ready",
      authMethod: "oauth",
      accountLabel: "dev@rayucode.com",
      modelCount: 18,
      supportsOAuth: true,
    },
    {
      id: "anthropic",
      name: "Anthropic (Claude)",
      category: "native",
      status: "env_key",
      authMethod: "env",
      modelCount: 8,
      supportsOAuth: true,
    },
    {
      id: "openai",
      name: "OpenAI",
      category: "native",
      status: "needs_key",
      authMethod: "none",
      modelCount: 12,
      supportsOAuth: true,
    },
  ],

  features: {
    memory: true,
    swarm: true,
    mermaid: true,
    auto_poke: false,
    todo_gate_digest: true,
    todo_gate_diagnostics: false,
    message_timestamps: true,
    persist_memory_injections: true,
    kv_cache_miss_notices: false,
    check_updates: true,
    update_channel: "stable",
    codemode: true,
    integration_tools: true,
  },

  voice: {
    supported: true,
    enabled: false,
    devices: [{ id: "default", label: "System Default Microphone" }],
    noiseSuppression: true,
    autoSendOnSilence: false,
    hotkeyHint: "Alt+V",
  },

  telemetry: {
    lockedByEnv: false,
    content: false,
    usage: true,
    crashes: true,
    features: true,
    cost: true,
    accounts: false,
  },

  sidePanelPages: [
    {
      id: "sp_arch",
      title: "Extension Architecture.md",
      kind: "markdown",
      content: "# RayuCode VS Code Extension\n\nDual-form-factor React 19 + Tailwind v4 shell.",
      updatedAtMs: NOW - 60_000,
    },
  ],

  applets: [],

  todos: [
    {
      content: "Port Warm Graphite & Warm Paper tokens to globals.css",
      status: "completed",
    },
    {
      content: "Build dual-form-factor AppShell and CompactTopBar",
      status: "in_progress",
      activeForm: "Building dual-form-factor AppShell",
    },
    {
      content: "Run typecheck, lint:design, and Vitest verification",
      status: "pending",
    },
  ],

  modelSettings: {
    defaultModel: "rayu:claude-sonnet-4-5",
    defaultEffort: "medium",
    serviceTier: "auto",
    cacheTtl: "5m",
    transport: "auto",
    subagentModel: null,
    inheritModel: "rayu:claude-sonnet-4-5",
    roleOverrides: [
      { role: "swarm", label: "Swarm Workers", model: "rayu:claude-sonnet-4-5", scope: "global" },
      { role: "review", label: "Code Review", model: "architect", scope: "global" },
      { role: "judge", label: "Acceptance Judge", model: "inherit", scope: "global" },
      { role: "memory", label: "Memory Extraction", model: "inherit", scope: "global" },
      { role: "ambient", label: "Ambient Cycles", model: "inherit", scope: "global" },
    ],
    effectiveRoleModels: {
      swarm: "rayu:claude-sonnet-4-5",
      review: "rayu:claude-opus-4-5",
      judge: null,
      memory: null,
      ambient: null,
    },
    profiles: [
      {
        name: "architect",
        model: "rayu:claude-opus-4-5",
        effort: "high",
        description: "Systems architecture, API design, and thorough code reviews.",
        scope: "global",
      },
      {
        name: "coder",
        model: "rayu:claude-sonnet-4-5",
        effort: "medium",
        description: "Focused feature implementation, surgical edits, and unit tests.",
        scope: "global",
      },
    ],
    configPath: "~/.rayu/config.toml",
    routes: [
      {
        id: "claude-sonnet-4-5",
        model: "claude-sonnet-4-5",
        modelSpec: "rayu:claude-sonnet-4-5",
        provider: "rayu",
        label: "Claude Sonnet 4.5",
        apiMethod: "rayu",
        authMethod: "oauth",
        accountLabel: "dev@rayucode.com",
        available: true,
        detail: "Balanced speed & reasoning",
        supportsEffort: true,
        supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
        supportsFast: true,
        contextWindow: 200_000,
      },
      {
        id: "claude-opus-4-5",
        model: "claude-opus-4-5",
        modelSpec: "rayu:claude-opus-4-5",
        provider: "rayu",
        label: "Claude Opus 4.5",
        apiMethod: "rayu",
        authMethod: "oauth",
        accountLabel: "dev@rayucode.com",
        available: true,
        detail: "Deep architecture & complex refactors",
        supportsEffort: true,
        supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "high",
        supportsFast: true,
        contextWindow: 200_000,
      },
      {
        id: "gpt-5.2",
        model: "gpt-5.2",
        modelSpec: "gpt-5.2",
        provider: "openai",
        label: "GPT-5.2",
        apiMethod: "responses",
        authMethod: "none",
        available: false,
        detail: "Configure OpenAI API key",
        supportsEffort: true,
        supportedEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
        defaultEffort: "medium",
        supportsFast: true,
        contextWindow: 256_000,
      },
      {
        id: "gpt-4o-mini",
        model: "gpt-4o-mini",
        modelSpec: "gpt-4o-mini",
        provider: "openai",
        label: "GPT-4o Mini",
        apiMethod: "responses",
        available: true,
        detail: "Fast non-reasoning model",
        supportsEffort: false,
        supportedEfforts: [],
        defaultEffort: null,
        supportsFast: true,
        contextWindow: 128_000,
      },
      {
        id: "gemini-2.5-pro",
        model: "gemini-2.5-pro",
        modelSpec: "gemini-2.5-pro",
        provider: "google",
        label: "Gemini 2.5 Pro",
        apiMethod: "gemini",
        available: true,
        detail: "1M-token long-context synthesis",
        supportsEffort: true,
        supportsFast: false,
        contextWindow: 1_000_000,
      },
      {
        id: "deepseek-r1",
        model: "deepseek-r1",
        modelSpec: "deepseek-r1",
        provider: "deepseek",
        label: "DeepSeek R1",
        apiMethod: "openai-compatible",
        available: true,
        detail: "Open-weight reasoning model",
        supportsEffort: true,
        supportsFast: false,
        contextWindow: 128_000,
      },
    ],
  },

  appearance: {
    theme: "auto",
    accent: "green",
    density: "comfortable",
    reduceMotion: false,
  },

  workbench: {
    openLocation: "secondarySidebar",
    contextActionsAutoSubmit: false,
    showEditorTitleIcon: true,
  },
};

export function createMockHostInitMessage(): Extract<
  HostToWebviewMessage,
  { type: "rayucode.host.init" }
> {
  const surface =
    typeof window !== "undefined" && window.__RAYU_SURFACE__ === "sidebar"
      ? "sidebar"
      : "editorPanel";
  return {
    type: "rayucode.host.init",
    surface,
    mediaBaseUri: "./assets",
    theme: mockState.appearance.theme,
    accent: mockState.appearance.accent,
    density: mockState.appearance.density,
    reduceMotion: mockState.appearance.reduceMotion,
    workbench: { ...mockState.workbench },
    route: "home",
    sessionId: mockState.activeSessionId,
    capabilities: [...mockState.daemon.capabilities],
    daemonStatus: { ...mockState.daemon },
    workspaces: mockState.workspaces.map((w) => ({ ...w })),
    editorSelection: null,
    backgroundTasks: mockState.backgroundTasks.map((t) => ({ ...t })),
    accountStatus: {
      ...mockState.account,
      windows: mockState.account.windows.map((w) => ({ ...w })),
    },
    fileChanges: mockState.activeSessionId
      ? cloneFileChangesSnapshot(
          mockState.fileChangesBySession[mockState.activeSessionId],
          mockState.activeSessionId,
        )
      : null,
  };
}

function emptyFileChangesSnapshot(sessionId: string): FileChangesSnapshotView {
  return {
    sessionId,
    latestTurnId: 0,
    totalPendingFiles: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    files: [],
  };
}

function cloneFileChangesSnapshot(
  snapshot: FileChangesSnapshotView | undefined,
  sessionId: string,
): FileChangesSnapshotView {
  if (!snapshot) return emptyFileChangesSnapshot(sessionId);
  return {
    ...snapshot,
    files: snapshot.files.map((f) => ({
      ...f,
      previewHunks: f.previewHunks.map((h) => ({
        ...h,
        lines: [...h.lines],
      })),
    })),
  };
}

function recomputeMockSnapshotTotals(
  snapshot: FileChangesSnapshotView,
): FileChangesSnapshotView {
  let totalPendingFiles = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of snapshot.files) {
    if (f.status === "pending") totalPendingFiles += 1;
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }
  return {
    ...snapshot,
    totalPendingFiles,
    totalAdditions,
    totalDeletions,
  };
}

function applyMockFileChangeAction(
  sessionId: string,
  action: FileChangeActionKind,
  targetPath?: string,
  dispatch?: HostMessageDispatch,
): FileChangeActionResultView {
  const existing =
    mockState.fileChangesBySession[sessionId] ??
    emptyFileChangesSnapshot(sessionId);
  const nextFiles = existing.files.map((file) => {
    const matchesTarget =
      !targetPath ||
      file.path === targetPath ||
      file.displayPath === targetPath;
    if (!matchesTarget) return file;

    let nextStatus: FileChangeStatus = file.status;
    let nextCanRedo = file.canRedo;
    if (action === "keep" || action === "keep_all") {
      if (action === "keep" || file.status === "pending") {
        nextStatus = "kept";
        nextCanRedo = false;
      }
    } else if (action === "undo" || action === "undo_all") {
      if (action === "undo" || file.status === "pending") {
        nextStatus = "undone";
        nextCanRedo = true;
      }
    } else if (action === "redo" || action === "redo_all") {
      if (file.status === "undone" && file.canRedo) {
        nextStatus = "pending";
        nextCanRedo = false;
      }
    }
    return {
      ...file,
      status: nextStatus,
      canRedo: nextCanRedo,
      updatedAtMs: Date.now(),
    };
  });

  const nextSnapshot = recomputeMockSnapshotTotals({
    ...existing,
    files: nextFiles,
  });
  mockState.fileChangesBySession[sessionId] = nextSnapshot;

  // Keep mockState.changes review decisions synchronized for ChangesView tests
  mockState.changes = {
    ...mockState.changes,
    files: mockState.changes.files.map((cf) => {
      const matched = nextSnapshot.files.find(
        (f) => f.displayPath === cf.path || f.path === cf.path,
      );
      if (!matched) return cf;
      const decision =
        matched.status === "kept"
          ? "accepted"
          : matched.status === "undone"
            ? "rejected"
            : "pending";
      return {
        ...cf,
        decision,
        staged: matched.status === "undone" ? false : cf.staged,
      };
    }),
  };
  mockState.changes.stagedCount = mockState.changes.files.filter(
    (f) => f.staged,
  ).length;

  const cloned = cloneFileChangesSnapshot(nextSnapshot, sessionId);
  dispatch?.({
    type: "rayucode.fileChanges.updated",
    sessionId,
    snapshot: cloned,
  });
  return {
    ok: true,
    conflict: false,
    conflicts: [],
    snapshot: cloned,
  };
}

const DEFAULT_MOCK_WINDOWS: AccountStatusView["windows"] = [
  {
    label: "5-hour limit",
    remainingPercent: 86,
    usedPercent: 14,
    resetCountdown: "Resets in 3h 42m",
  },
  {
    label: "Weekly limit",
    remainingPercent: 74,
    usedPercent: 26,
    resetCountdown: "Resets in 4d 11h",
  },
];

export function __setMockAccountStateForTest(
  next: Partial<AccountStatusView>,
): AccountStatusView {
  mockState.account = {
    ...mockState.account,
    ...next,
    windows: next.windows
      ? next.windows.map((w) => ({ ...w }))
      : next.signedIn === false
        ? []
        : mockState.account.windows.map((w) => ({ ...w })),
  };
  updateMockRayuProviderFromAccount();
  return {
    ...mockState.account,
    windows: mockState.account.windows.map((w) => ({ ...w })),
  };
}

function updateMockRayuProviderFromAccount(): void {
  const acct = mockState.account;
  const authMethod = acct.signedIn
    ? acct.authMethod === "apiKey"
      ? ("api_key" as const)
      : ("oauth" as const)
    : ("none" as const);
  const accountLabel = acct.signedIn
    ? acct.email ?? acct.displayName ?? "Rayu Cloud"
    : undefined;
  mockState.providers = mockState.providers.map((p) => {
    if (p.id !== "rayu") return p;
    return {
      ...p,
      status: acct.signedIn ? "ready" : "needs_key",
      authMethod,
      accountLabel,
    };
  });
  mockState.modelSettings.routes = mockState.modelSettings.routes.map((r) => {
    if (r.provider !== "rayu") return r;
    return {
      ...r,
      available: acct.signedIn,
      authMethod,
      accountLabel,
    };
  });
}

function cloneAccount(account: AccountStatusView): AccountStatusView {
  return {
    ...account,
    windows: account.windows.map((w) => ({ ...w })),
    planLadder: account.planLadder?.map((t) => ({
      ...t,
      highlights: [...t.highlights],
    })),
  };
}

function buildMockWorkspaceLedger(): WorkspaceLedgerView {
  const now = Date.now();
  return {
    version: 1,
    updatedAt: now,
    workspaces: mockState.workspaces.map((w, idx) => ({
      id: w.id ?? `ws_${w.name}_${idx}`,
      name: w.name,
      path: w.path,
      canonicalPath: w.canonicalPath ?? w.path,
      sessionIds: mockState.sessions
        .filter((s) => s.workingDir === w.path)
        .map((s) => s.sessionId),
      createdAt: NOW - 86_400_000,
      updatedAt: now,
      lastOpenedAt: now,
      branch: w.branch,
      icon: w.icon,
      isPrimary: w.isPrimary,
    })),
    pinnedSessionIds: mockState.sessions
      .filter((s) => s.pinned)
      .map((s) => s.sessionId),
    archivedSessionIds: mockState.sessions
      .filter((s) => s.archived)
      .map((s) => s.sessionId),
    collapsedWorkspaceIds: [...mockState.collapsedWorkspaceIds],
    manualWorkspaceOrder: [],
    openFolderPaths: mockState.workspaces.map((w) => w.path),
  };
}

export async function handleMockRpcCall<M extends RpcMethod>(
  method: M,
  rawParams?: RpcParams<M>,
  dispatch?: HostMessageDispatch,
): Promise<RpcResult<M>> {
  const params = (rawParams ?? {}) as Record<string, unknown>;

  switch (method) {
    // --- Daemon ---
    case "daemon.status":
    case "daemon.reconnect":
    case "daemon.restart":
    case "daemon.updateEngine":
      mockState.daemon = {
        ...mockState.daemon,
        state: "connected",
        error: undefined,
        downloadProgress: undefined,
        downloadVersion: undefined,
        statusMessage: undefined,
      };
      return { ...mockState.daemon } as RpcResult<M>;
    case "daemon.ping":
      return { ok: true, latencyMs: 4, version: mockState.daemon.version } as RpcResult<M>;
    case "daemon.reload":
    case "daemon.openOutputLog":
      return { ok: true } as RpcResult<M>;
    case "daemon.selfdev":
      return { ok: true, status: "idle", output: "Self-dev channel ready (mock)" } as RpcResult<M>;

    // --- Workspace ---
    case "workspace.listFolders":
      return { folders: mockState.workspaces.map((w) => ({ ...w })) } as RpcResult<M>;
    case "workspace.ledger.get":
      return buildMockWorkspaceLedger() as RpcResult<M>;
    case "workspace.ledger.ensure": {
      const targetPath = String(params.path ?? "").trim();
      if (
        targetPath &&
        !mockState.workspaces.some((w) => w.path === targetPath)
      ) {
        const name =
          typeof params.name === "string" && params.name.trim()
            ? params.name.trim()
            : targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
        mockState.workspaces = [
          ...mockState.workspaces,
          { name, path: targetPath },
        ];
      }
      const ledger = buildMockWorkspaceLedger();
      dispatch?.({ type: "rayucode.workspaces.ledgerChanged", ledger });
      return ledger as RpcResult<M>;
    }
    case "workspace.ledger.remove": {
      const idOrPath = String(params.idOrPath ?? "");
      mockState.workspaces = mockState.workspaces.filter(
        (w, idx) =>
          w.path !== idOrPath && (w.id ?? `ws_${w.name}_${idx}`) !== idOrPath,
      );
      const ledger = buildMockWorkspaceLedger();
      dispatch?.({ type: "rayucode.workspaces.ledgerChanged", ledger });
      return ledger as RpcResult<M>;
    }
    case "workspace.ledger.setPinned": {
      const id = String(params.sessionId ?? "");
      const pinned = Boolean(params.pinned);
      mockState.sessions = mockState.sessions.map((s) =>
        s.sessionId === id ? { ...s, pinned, ...(pinned ? { archived: false } : {}) } : s,
      );
      const ledger = buildMockWorkspaceLedger();
      dispatch?.({ type: "rayucode.workspaces.ledgerChanged", ledger });
      return ledger as RpcResult<M>;
    }
    case "workspace.ledger.setArchived": {
      const id = String(params.sessionId ?? "");
      const archived = Boolean(params.archived);
      mockState.sessions = mockState.sessions.map((s) =>
        s.sessionId === id ? { ...s, archived, ...(archived ? { pinned: false } : {}) } : s,
      );
      const ledger = buildMockWorkspaceLedger();
      dispatch?.({ type: "rayucode.workspaces.ledgerChanged", ledger });
      return ledger as RpcResult<M>;
    }
    case "workspace.ledger.setCollapsed": {
      const wsId = String(params.workspaceId ?? "");
      const collapsed = Boolean(params.collapsed);
      if (collapsed && !mockState.collapsedWorkspaceIds.includes(wsId)) {
        mockState.collapsedWorkspaceIds = [...mockState.collapsedWorkspaceIds, wsId];
      } else if (!collapsed) {
        mockState.collapsedWorkspaceIds = mockState.collapsedWorkspaceIds.filter(
          (id) => id !== wsId,
        );
      }
      const ledger = buildMockWorkspaceLedger();
      dispatch?.({ type: "rayucode.workspaces.ledgerChanged", ledger });
      return ledger as RpcResult<M>;
    }
    case "workspace.ledger.attachSession": {
      const wsPath = String(params.workspaceIdOrPath ?? "");
      const sid = String(params.sessionId ?? "");
      mockState.sessions = mockState.sessions.map((s) =>
        s.sessionId === sid ? { ...s, workingDir: wsPath } : s,
      );
      const ledger = buildMockWorkspaceLedger();
      dispatch?.({ type: "rayucode.workspaces.ledgerChanged", ledger });
      return ledger as RpcResult<M>;
    }
    case "workspace.findFiles": {
      const q = String(params.query ?? "").toLowerCase();
      const sample = [
        "vscode/webview/src/styles/globals.css",
        "vscode/webview/src/lib/rpc-client.ts",
        "vscode/webview/src/lib/app-store.ts",
        "vscode/webview/src/features/shell/components/AppShell.tsx",
        "crates/rayu-harness/src/lib.rs",
      ];
      return {
        files: sample.filter((f) => !q || f.toLowerCase().includes(q)),
      } as RpcResult<M>;
    }
    case "workspace.contextSnapshot": {
      const sessionId = String(params.sessionId ?? mockState.activeSessionId ?? "ses_vscode_shell");
      const snapshot: ContextSnapshotView = {
        sessionId,
        usedTokens: 34_800,
        maxTokens: 200_000,
        usedPercent: 17.4,
        freeTokens: 165_200,
        bufferTokens: 12_000,
        cacheTtl: mockState.modelSettings.cacheTtl,
        kvCacheHitPercent: 94,
        categories: [
          { id: "system", label: "System & Tools", tokens: 12_400, colorToken: "code-fn" },
          { id: "files", label: "Workspace Files", tokens: 14_200, colorToken: "brand" },
          { id: "messages", label: "Conversation", tokens: 8_200, colorToken: "code-type" },
        ],
      };
      return snapshot as RpcResult<M>;
    }
    case "workspace.setContextCap":
    case "workspace.compact":
      return { ok: true } as RpcResult<M>;
    case "workspace.setProjectIcon":
    case "sessions.projectIcon": {
      const wp = String(params.workspacePath ?? "");
      const icon = params.icon as WorkspaceFolderView["icon"] | null;
      mockState.workspaces = mockState.workspaces.map((w) =>
        w.path === wp ? { ...w, icon: icon ?? undefined } : w,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "workspace.pickFiles":
      return { paths: [] } as RpcResult<M>;
    case "workspace.listBranches":
      return { current: "main", branches: ["main", "feat/kv-cache", "swarm/vscode-wave2"] } as RpcResult<M>;
    case "workspace.checkoutBranch":
      return { ok: true, branch: String(params.branch ?? "main") } as RpcResult<M>;

    // --- Sessions ---
    case "workspace.ledger.importProjectGroup": {
      const targetPath = String(params.path ?? "").trim();
      if (
        targetPath &&
        !mockState.workspaces.some((w) => w.path === targetPath)
      ) {
        const name =
          typeof params.name === "string" && params.name.trim()
            ? params.name.trim()
            : targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
        mockState.workspaces = [
          ...mockState.workspaces,
          { name, path: targetPath },
        ];
      }
      return buildMockWorkspaceLedger() as RpcResult<M>;
    }
    case "sessions.listExternalProjects":
      return { projects: [] } as RpcResult<M>;
    case "sessions.importExternal":
      return { sessions: [], skipped: [] } as RpcResult<M>;
    case "sessions.list": {
      const includeArchived = Boolean(params.includeArchived);
      const list = includeArchived
        ? mockState.sessions
        : mockState.sessions.filter((s) => !s.archived);
      return {
        sessions: list.map((s) => ({ ...s })),
        activeSessionId: mockState.activeSessionId,
      } as RpcResult<M>;
    }
    case "sessions.search": {
      const q = String(params.query ?? "").toLowerCase();
      const hits = mockState.sessions
        .filter(
          (s) =>
            !q ||
            s.title.toLowerCase().includes(q) ||
            (s.previewText ?? "").toLowerCase().includes(q),
        )
        .map((s) => ({
          sessionId: s.sessionId,
          title: s.title,
          snippet: s.previewText ?? s.title,
          sourceTool: s.sourceTool ?? ("rayu" as const),
          workingDir: s.workingDir,
          updatedAtMs: s.updatedAtMs,
          score: 0.92,
        }));
      return { hits } as RpcResult<M>;
    }
    case "sessions.create": {
      const id = `ses_${Date.now().toString(36)}`;
      const created: SessionSummaryView = {
        sessionId: id,
        title: "New session",
        workingDir:
          typeof params.workingDir === "string"
            ? params.workingDir
            : mockState.workspaces[0]?.path,
        branch: "main",
        status: "idle",
        model:
          typeof params.model === "string"
            ? params.model
            : mockState.modelSettings.defaultModel,
        provider: "rayu-cloud",
        ...(typeof params.effort === "string"
          ? { effort: params.effort as SessionSummaryView["effort"] }
          : {}),
        ...(typeof params.serviceTier === "string"
          ? { serviceTier: params.serviceTier as SessionSummaryView["serviceTier"] }
          : {}),
        ...(typeof params.cacheTtl === "string"
          ? { cacheTtl: params.cacheTtl as SessionSummaryView["cacheTtl"] }
          : {}),
        permissionMode:
          (params.permissionMode as SessionSummaryView["permissionMode"]) ?? "default",
        updatedAtMs: Date.now(),
        createdAtMs: Date.now(),
        pinned: false,
        archived: false,
        sourceTool: "rayu",
      };
      mockState.sessions = [created, ...mockState.sessions];
      mockState.activeSessionId = id;
      return { session: { ...created } } as RpcResult<M>;
    }
    case "sessions.attach": {
      const id = String(params.sessionId ?? "");
      const found =
        mockState.sessions.find((s) => s.sessionId === id) ?? mockState.sessions[0];
      mockState.activeSessionId = found.sessionId;
      return { session: { ...found } } as RpcResult<M>;
    }
    case "sessions.history": {
      const id = String(params.sessionId ?? "");
      const messages = mockState.sessionHistories[id] ?? [];
      return {
        sessionId: id,
        messages: messages.map((m) => ({
          ...m,
          images: m.images ? m.images.map((img) => ({ ...img })) : undefined,
        })),
      } as RpcResult<M>;
    }
    case "sessions.rename": {
      const id = String(params.sessionId ?? "");
      const title = String(params.title ?? "Untitled session");
      mockState.sessions = mockState.sessions.map((s) =>
        s.sessionId === id ? { ...s, title, updatedAtMs: Date.now() } : s,
      );
      return { ok: true, title } as RpcResult<M>;
    }
    case "sessions.fork": {
      const src =
        mockState.sessions.find((s) => s.sessionId === params.sessionId) ??
        mockState.sessions[0];
      const forked: SessionSummaryView = {
        ...src,
        sessionId: `ses_fork_${Date.now().toString(36)}`,
        title: `${src.title} (fork)`,
        updatedAtMs: Date.now(),
        pinned: false,
        archived: false,
      };
      mockState.sessions = [forked, ...mockState.sessions];
      mockState.activeSessionId = forked.sessionId;
      return { session: { ...forked } } as RpcResult<M>;
    }
    case "sessions.transfer": {
      const src =
        mockState.sessions.find((s) => s.sessionId === params.sessionId) ??
        mockState.sessions[0];
      const updated: SessionSummaryView = {
        ...src,
        workingDir:
          typeof params.targetWorkingDir === "string"
            ? params.targetWorkingDir
            : src.workingDir,
        updatedAtMs: Date.now(),
      };
      mockState.sessions = mockState.sessions.map((s) =>
        s.sessionId === updated.sessionId ? updated : s,
      );
      return { session: { ...updated } } as RpcResult<M>;
    }
    case "sessions.export":
      return { content: "# Exported Session\n\nMock transcript export." } as RpcResult<M>;
    case "sessions.archive": {
      const id = String(params.sessionId ?? "");
      const archived = Boolean(params.archived);
      mockState.sessions = mockState.sessions.map((s) =>
        s.sessionId === id ? { ...s, archived } : s,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "sessions.pin": {
      const id = String(params.sessionId ?? "");
      const pinned = Boolean(params.pinned);
      mockState.sessions = mockState.sessions.map((s) =>
        s.sessionId === id ? { ...s, pinned } : s,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "sessions.setPermissionMode": {
      const sid = typeof params.sessionId === "string" ? params.sessionId : "";
      const mode =
        (params.mode as SessionSummaryView["permissionMode"]) ?? "default";
      if (sid) {
        mockState.sessions = mockState.sessions.map((s) =>
          s.sessionId === sid ? { ...s, permissionMode: mode } : s,
        );
      }
      return { ok: true, mode } as RpcResult<M>;
    }
    case "sessions.rewind":
    case "sessions.rewindUndo":
    case "sessions.respondPermission":
    case "sessions.respondQuestion":
      return { ok: true } as RpcResult<M>;
    case "sessions.cancelSoftInterrupts":
      return { ok: true, cancelled: true } as RpcResult<M>;
    case "sessions.softInterrupt": {
      const clientId =
        typeof params.clientId === "string" && params.clientId.trim()
          ? params.clientId.trim()
          : `int_${Date.now()}`;
      return { ok: true, interruptId: clientId } as RpcResult<M>;
    }

    // --- Background ---
    case "background.list": {
      const sid =
        typeof params.sessionId === "string" && params.sessionId.trim()
          ? params.sessionId.trim()
          : null;
      const list = sid
        ? mockState.backgroundTasks.filter((t) => t.sessionId === sid)
        : mockState.backgroundTasks;
      return { tasks: list.map((t) => ({ ...t })) } as RpcResult<M>;
    }
    case "background.status": {
      const task =
        mockState.backgroundTasks.find((t) => t.taskId === params.taskId) ?? null;
      return { task } as RpcResult<M>;
    }
    case "background.output":
      return {
        taskId: String(params.taskId ?? ""),
        content: "running 50 tests\ntest harness::protocol ... ok\ntest harness::stream ... ok\n",
        truncated: false,
        byteLength: 82,
        outputFile: "/tmp/rayu-bg-cargo-test.log",
        status: "running",
      } as RpcResult<M>;
    case "background.cancel": {
      mockState.backgroundTasks = mockState.backgroundTasks.map((t) =>
        t.taskId === params.taskId ? { ...t, status: "completed", exitCode: 130 } : t,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "background.cleanup": {
      const sid =
        typeof params.sessionId === "string" && params.sessionId.trim()
          ? params.sessionId.trim()
          : null;
      const before = mockState.backgroundTasks.length;
      mockState.backgroundTasks = mockState.backgroundTasks.filter(
        (t) =>
          (sid !== null && t.sessionId !== sid) ||
          t.status === "running" ||
          t.status === "stalled",
      );
      return { ok: true, removedCount: before - mockState.backgroundTasks.length } as RpcResult<M>;
    }
    case "background.backgroundTool":
      return { ok: true, taskId: `bg_${Date.now().toString(36)}` } as RpcResult<M>;

    // --- Swarm ---
    case "swarm.status":
      return { swarm: { ...mockState.swarm } } as RpcResult<M>;
    case "swarm.list":
      return {
        swarms: [
          {
            swarmId: mockState.swarm.swarmId,
            label: mockState.swarm.label,
            coordinatorSessionId: "ses_vscode_shell",
            memberCount: mockState.swarm.agents.length,
            runningCount: mockState.swarm.agents.filter((a) => a.status === "running").length,
            completedCount: mockState.swarm.agents.filter((a) => a.status === "completed").length,
            active: true,
          },
        ],
      } as RpcResult<M>;
    case "swarm.setLabel":
      mockState.swarm.label = String(params.label ?? mockState.swarm.label);
      return { ok: true } as RpcResult<M>;
    case "swarm.spawn": {
      const agent = {
        agentId: String(params.label ?? `worker-${Date.now()}`),
        sessionId: `ses_${Date.now().toString(36)}`,
        label: String(params.label ?? "worker"),
        role: "worker" as const,
        depth: 1,
        status: "running" as const,
        model: typeof params.model === "string" ? params.model : "claude-sonnet-4-5",
        currentIntent: String(params.prompt ?? "").slice(0, 80),
        updatedAtMs: Date.now(),
      };
      mockState.swarm.agents = [...mockState.swarm.agents, agent];
      return { ok: true, agent } as RpcResult<M>;
    }
    case "swarm.kill": {
      const targetId = String(params.agentId ?? "");
      const resume = Boolean(params.resume);
      mockState.swarm.agents = mockState.swarm.agents.map((a) =>
        a.agentId === targetId || a.sessionId === targetId || a.label === targetId
          ? { ...a, status: resume ? "running" : "stopped" }
          : a,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "swarm.salvage":
    case "swarm.planDecide":
    case "swarm.worktreeOpen":
      return { ok: true } as RpcResult<M>;
    case "swarm.pauseAll": {
      mockState.swarm.agents = mockState.swarm.agents.map((a) =>
        a.role === "worker" ? { ...a, status: "stopped" } : a,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "swarm.broadcast": {
      const seq = mockState.swarm.board.length + 1;
      mockState.swarm.board.push({
        seq,
        kind: "broadcast",
        from: "user",
        text: String(params.message ?? ""),
        timestampMs: Date.now(),
      });
      return { ok: true, seq } as RpcResult<M>;
    }
    case "swarm.board":
      return { messages: mockState.swarm.board.map((m) => ({ ...m })) } as RpcResult<M>;
    case "swarm.dm": {
      const seq = mockState.swarm.board.length + 1;
      mockState.swarm.board.push({
        seq,
        kind: "dm",
        from: "user",
        to: String(params.agentId ?? "coordinator"),
        text: String(params.message ?? ""),
        timestampMs: Date.now(),
      });
      return { ok: true, seq } as RpcResult<M>;
    }
    case "swarm.peekSession":
      return { entries: [], todos: mockState.todos.map((t) => ({ ...t })) } as RpcResult<M>;

    // --- Automations ---
    case "automations.overnight.list":
      return { runs: mockState.overnightRuns.map((r) => ({ ...r })) } as RpcResult<M>;
    case "automations.overnight.start": {
      const run: OvernightRunView = {
        runId: `ov_${Date.now().toString(36)}`,
        mission: String(params.mission ?? "Overnight run"),
        status: "running",
        agentCount: Number(params.maxAgents ?? 2),
        durationLabel: String(params.duration ?? "4h"),
        taskCardCount: 0,
        validationsGreen: 0,
        startedAtMs: Date.now(),
      };
      mockState.overnightRuns = [run, ...mockState.overnightRuns];
      return { run } as RpcResult<M>;
    }
    case "automations.overnight.pause":
    case "automations.overnight.runNow":
    case "automations.overnight.cancel":
    case "automations.schedules.toggle":
    case "automations.schedules.runNow":
    case "automations.schedules.cancel":
      return { ok: true } as RpcResult<M>;
    case "automations.ambient.decide":
      mockState.ambient.approvals = mockState.ambient.approvals.map((approval) =>
        approval.id === params.id
          ? { ...approval, status: params.decision === "allow" ? "approved" : "denied" }
          : approval,
      );
      return { ok: true } as RpcResult<M>;
    case "automations.overnight.log":
      return {
        runId: String(params.runId ?? ""),
        lines: ["[00:01] Initialized overnight worktree", "[00:14] All validation suites passed"],
      } as RpcResult<M>;
    case "automations.overnight.report":
      return {
        run: mockState.overnightRuns[0],
        markdown: "# Morning Handoff\n\nAll checks green.",
      } as RpcResult<M>;
    case "automations.schedules.list":
      return { schedules: mockState.schedules.map((s) => ({ ...s })) } as RpcResult<M>;
    case "automations.schedules.create": {
      const schedule: ScheduleItemView = {
        id: `sched_${Date.now().toString(36)}`,
        title: String(params.title ?? "Scheduled task"),
        prompt: String(params.prompt ?? ""),
        cronSummary: String(params.schedule ?? "Daily"),
        permissionMode: "default",
        enabled: true,
      };
      mockState.schedules = [schedule, ...mockState.schedules];
      return { schedule } as RpcResult<M>;
    }
    case "automations.ambient.status":
      return { ...mockState.ambient } as RpcResult<M>;
    case "automations.ambient.approvals":
      return { approvals: mockState.ambient.approvals } as RpcResult<M>;
    case "automations.quality.status":
      return { ...mockState.quality } as RpcResult<M>;
    case "automations.quality.setAutoReview":
      mockState.quality.autoReviewEnabled = Boolean(params.enabled);
      return { ok: true, enabled: mockState.quality.autoReviewEnabled } as RpcResult<M>;
    case "automations.quality.setAutoJudge":
      mockState.quality.autoJudgeEnabled = Boolean(params.enabled);
      return { ok: true, enabled: mockState.quality.autoJudgeEnabled } as RpcResult<M>;
    case "automations.quality.runReview":
    case "automations.quality.runJudge":
      return { ok: true, summary: "Quality gate passed with 0 blockers." } as RpcResult<M>;
    case "automations.quality.productivity":
      return {
        markdown: "## 7-Day Productivity\n\n- 14 sessions completed\n- 94% KV cache hit rate",
        generatedAtMs: Date.now(),
      } as RpcResult<M>;

    // --- Plugins / MCP / Skills / Memory ---
    case "plugins.mcp.list":
      return {
        servers: mockState.mcpServers.map((s) => ({ ...s })),
        totalTokenBudget: 8000,
        usedTokenBudget: 2520,
      } as RpcResult<M>;
    case "plugins.mcp.test":
      return { ok: true, toolCount: 9, latencyMs: 18 } as RpcResult<M>;
    case "plugins.mcp.toggle": {
      mockState.mcpServers = mockState.mcpServers.map((s) =>
        s.id === params.id ? { ...s, enabled: Boolean(params.enabled) } : s,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "plugins.mcp.reload":
      return { ok: true, servers: mockState.mcpServers.map((s) => ({ ...s })) } as RpcResult<M>;
    case "plugins.mcp.add":
    case "plugins.mcp.edit": {
      const server: McpServerView = {
        id: String(params.id ?? "custom-mcp"),
        name: String(params.id ?? "Custom MCP"),
        status: "connected",
        enabled: true,
        transport: (params.transport as McpServerView["transport"]) ?? "stdio",
        configLayer: String(params.scope ?? "workspace"),
        shared: Boolean(params.shared ?? true),
      };
      mockState.mcpServers = [server, ...mockState.mcpServers.filter((previous) => previous.id !== server.id)];
      return { ok: true, server, reloaded: true } as RpcResult<M>;
    }
    case "plugins.mcp.remove":
      mockState.mcpServers = mockState.mcpServers.filter((server) => server.id !== params.id);
      return { ok: true, reloaded: true } as RpcResult<M>;
    case "plugins.mcp.logout":
    case "plugins.skills.run":
    case "plugins.memory.forget":
    case "plugins.memory.tag":
    case "plugins.memory.link":
      return { ok: true } as RpcResult<M>;
    case "plugins.mcp.login":
      return { ok: true, message: "Authenticated with OAuth 2.1" } as RpcResult<M>;
    case "plugins.mcp.oauth":
      return { ok: true, authenticated: params.action !== "logout" } as RpcResult<M>;
    case "plugins.skills.list":
      return {
        skills: mockState.skills.map((s) => ({ ...s })),
        endorsed: [],
      } as RpcResult<M>;
    case "plugins.skills.create": {
      const skill: SkillView = {
        name: String(params.name ?? "new-skill"),
        description: String(params.description ?? ""),
        path: `.rayu/skills/${String(params.name ?? "new-skill")}/SKILL.md`,
        scope: (params.scope as SkillView["scope"]) ?? "project",
        installed: true,
      };
      mockState.skills = [skill, ...mockState.skills];
      return { ok: true, skill } as RpcResult<M>;
    }
    case "plugins.skills.install":
      return { ok: true } as RpcResult<M>;
    case "plugins.skills.reload":
      return { ok: true, skills: mockState.skills.map((s) => ({ ...s })) } as RpcResult<M>;
    case "plugins.skills.toggle": {
      const targetName = String(params.name ?? "");
      const enabled = Boolean(params.enabled);
      mockState.skills = mockState.skills.map((s) =>
        s.name === targetName ? { ...s, enabled } : s,
      );
      return { ok: true, enabled } as RpcResult<M>;
    }
    case "plugins.memory.status":
      return { ...mockState.memory } as RpcResult<M>;
    case "plugins.memory.toggle":
      mockState.memory.enabled = Boolean(params.enabled);
      return { ok: true, enabled: mockState.memory.enabled } as RpcResult<M>;
    case "plugins.memory.extract":
      return { ok: true, extractedCount: 1 } as RpcResult<M>;
    case "plugins.memory.remember": {
      const fact = {
        id: `mem_${Date.now().toString(36)}`,
        content: String(params.content ?? ""),
        scope: (params.scope as "project" | "global") ?? "project",
        tags: Array.isArray(params.tags) ? (params.tags as string[]) : [],
        updatedAtMs: Date.now(),
      };
      mockState.memory.facts = [fact, ...mockState.memory.facts];
      mockState.memory.totalCount = mockState.memory.facts.length;
      return { ok: true, fact } as RpcResult<M>;
    }
    case "plugins.memory.recall":
    case "plugins.memory.search":
      return { facts: mockState.memory.facts.map((f) => ({ ...f })) } as RpcResult<M>;
    case "plugins.workspace.status":
      return { ...mockState.workspaceIntegrations } as RpcResult<M>;
    case "plugins.workspace.trigger": {
      if (params.integration === "browser" && params.action === "handoff") {
        mockState.workspaceIntegrations.browser.handoffActive =
          !mockState.workspaceIntegrations.browser.handoffActive;
      } else if (
        params.integration === "companion" &&
        params.action === "toggleKeepAwake"
      ) {
        mockState.workspaceIntegrations.companion.keepAwake =
          !mockState.workspaceIntegrations.companion.keepAwake;
      }
      return { ok: true, message: "Triggered workspace integration action" } as RpcResult<M>;
    }

    // --- Changes ---
    case "changes.status":
      return {
        ...mockState.changes,
        files: mockState.changes.files.map((f) => ({ ...f })),
      } as RpcResult<M>;
    case "changes.getSessionSummary": {
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      return cloneFileChangesSnapshot(
        mockState.fileChangesBySession[sid],
        sid,
      ) as RpcResult<M>;
    }
    case "changes.diff": {
      const reqPath = String(params.path ?? "");
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      const matched = mockState.fileChangesBySession[sid]?.files.find(
        (f) => f.path === reqPath || f.displayPath === reqPath,
      );
      if (matched) {
        const unifiedDiff = matched.previewHunks
          .map((h) => [h.header, ...h.lines].join("\n"))
          .join("\n");
        return {
          path: matched.displayPath,
          originalContent: "// original\n",
          modifiedContent: "// modified\n",
          unifiedDiff:
            unifiedDiff || "@@ -1 +1 @@\n-// original\n+// modified\n",
          additions: matched.additions,
          deletions: matched.deletions,
          languageId: "typescript",
          isBinary: matched.isBinary,
          kind: matched.kind,
          status: matched.status,
          hunks: matched.previewHunks.map((h) => ({
            ...h,
            lines: [...h.lines],
          })),
        } as RpcResult<M>;
      }
      return {
        path: reqPath,
        originalContent: "// original\n",
        modifiedContent: "// modified\n",
        unifiedDiff: "@@ -1 +1 @@\n-// original\n+// modified\n",
        additions: 1,
        deletions: 1,
        languageId: "typescript",
      } as RpcResult<M>;
    }
    case "changes.stage":
    case "changes.unstage":
      return { ok: true } as RpcResult<M>;
    case "changes.keep": {
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      return applyMockFileChangeAction(
        sid,
        "keep",
        String(params.path ?? ""),
        dispatch,
      ) as RpcResult<M>;
    }
    case "changes.undo": {
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      return applyMockFileChangeAction(
        sid,
        "undo",
        String(params.path ?? ""),
        dispatch,
      ) as RpcResult<M>;
    }
    case "changes.redo": {
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      return applyMockFileChangeAction(
        sid,
        "redo",
        String(params.path ?? ""),
        dispatch,
      ) as RpcResult<M>;
    }
    case "changes.keepAll": {
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      return applyMockFileChangeAction(
        sid,
        "keep_all",
        undefined,
        dispatch,
      ) as RpcResult<M>;
    }
    case "changes.undoAll": {
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      return applyMockFileChangeAction(
        sid,
        "undo_all",
        undefined,
        dispatch,
      ) as RpcResult<M>;
    }
    case "changes.redoAll": {
      const sid = String(params.sessionId ?? mockState.activeSessionId ?? "");
      return applyMockFileChangeAction(
        sid,
        "redo_all",
        undefined,
        dispatch,
      ) as RpcResult<M>;
    }
    case "changes.commit":
      return { ok: true, commitHash: "a1b2c3d", summary: String(params.message ?? "") } as RpcResult<M>;
    case "changes.createPr":
      return { ok: true, url: "https://github.com/rayu-dev/rayucode/pull/101", number: 101 } as RpcResult<M>;

    // --- Remote ---
    case "remote.telegram.status":
      return {
        ...mockState.telegram,
        approvals: mockState.telegram.approvals.map((a) => ({ ...a })),
      } as RpcResult<M>;
    case "remote.telegram.linkHosted":
      mockState.telegram = {
        ...mockState.telegram,
        linked: false,
        configured: true,
        statusLabel: "Waiting for pairing",
        mode: "hosted",
        botHandle: "@RayuCodeBot",
        pairingCode: "live_pair_9k4m2p",
        pairingUrl: "https://t.me/RayuCodeBot?start=live_pair_9k4m2p",
        pairingExpiresAtMs: Date.now() + 600_000,
        qrSize: 29,
        qrPath: "M2 2h7v1h-7zM2 3h1v5h-1zM8 3h1v5h-1zM4 4h3v3h-3zM2 8h7v1h-7z",
      };
      return { ...mockState.telegram } as RpcResult<M>;
    case "remote.telegram.linkBotfather": {
      const chatId =
        typeof params.allowedChatId === "string" && params.allowedChatId.trim()
          ? params.allowedChatId.trim()
          : undefined;
      mockState.telegram = {
        ...mockState.telegram,
        linked: Boolean(chatId),
        configured: true,
        statusLabel: chatId ? "Linked" : "Waiting for pairing",
        mode: "botfather",
        botHandle: "@CustomRayuBot",
        chatId,
        pairingCode: chatId ? undefined : "bf_pair_8m2k",
        pairingUrl: chatId
          ? undefined
          : "https://t.me/CustomRayuBot?start=bf_pair_8m2k",
        pairingExpiresAtMs: chatId ? undefined : Date.now() + 600_000,
        qrSize: chatId ? null : 29,
        qrPath: chatId
          ? null
          : "M2 2h7v1h-7zM2 3h1v5h-1zM8 3h1v5h-1zM4 4h3v3h-3zM2 8h7v1h-7z",
      };
      return { ...mockState.telegram } as RpcResult<M>;
    }
    case "remote.telegram.disconnect":
      mockState.telegram = {
        ...mockState.telegram,
        linked: false,
        configured: false,
        statusLabel: "Disconnected",
        chatId: undefined,
        pairingCode: undefined,
        pairingUrl: undefined,
        qrSize: null,
        qrPath: null,
      };
      return { ok: true } as RpcResult<M>;
    case "remote.telegram.testPing":
      return {
        ok: true,
        target: mockState.telegram.botHandle ?? "@RayuCodeBot",
        chatId: mockState.telegram.chatId,
        message: "Sent Telegram ping.",
      } as RpcResult<M>;
    case "remote.telegram.driveSession":
      mockState.telegram.boundSessionId = String(params.sessionId ?? "");
      return { ok: true } as RpcResult<M>;
    case "remote.telegram.decide": {
      const id = String(params.id ?? "");
      const decision = params.decision === "allow" ? "approved" : "denied";
      mockState.telegram.approvals = mockState.telegram.approvals.map((a) =>
        a.id === id ? { ...a, status: decision, resolvedVia: "host" } : a,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "remote.gateway.revoke":
    case "remote.cloud.syncEnv":
      return { ok: true } as RpcResult<M>;
    case "remote.telegram.uninstallToggle":
      mockState.telegram.remoteUninstallEnabled = Boolean(params.enabled);
      return { ok: true, enabled: mockState.telegram.remoteUninstallEnabled } as RpcResult<M>;
    case "remote.telegram.approvals":
      return { approvals: mockState.telegram.approvals } as RpcResult<M>;
    case "remote.infra.status":
      return { ...mockState.remoteInfra } as RpcResult<M>;
    case "remote.gateway.toggle":
      mockState.remoteInfra.gateway.enabled = Boolean(params.enabled);
      return { ...mockState.remoteInfra.gateway } as RpcResult<M>;
    case "remote.gateway.pair":
      return { ...mockState.remoteInfra.gateway } as RpcResult<M>;
    case "remote.cloud.moveToCloud":
      return { ok: true, remoteSessionId: `cloud_${Date.now().toString(36)}` } as RpcResult<M>;
    case "remote.cloud.returnLocal":
    case "remote.cloud.attach":
      return { ok: true, sessionId: mockState.activeSessionId } as RpcResult<M>;

    // --- Settings ---
    case "settings.account.get":
    case "settings.account.refresh":
      return cloneAccount(mockState.account) as RpcResult<M>;
    case "settings.account.signInBrowser": {
      const mode = params.mode === "loopback" ? "loopback" : "vscode";
      const webBase = mockState.account.webBase ?? "https://rayucode.com";
      const stateHex = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
      const authUrl =
        mode === "loopback"
          ? `${webBase}/cli-login?port=54321&state=${stateHex}`
          : `${webBase}/vscode-login?state=${stateHex}`;
      mockState.account = {
        ...mockState.account,
        signingIn: true,
        pendingAuthUrl: authUrl,
        pendingMode: mode,
        error: null,
      };
      const snapshot = cloneAccount(mockState.account);
      dispatch?.({ type: "rayucode.account.changed", account: snapshot });
      return { ok: true, authUrl, state: snapshot } as RpcResult<M>;
    }
    case "settings.account.cancelSignIn": {
      mockState.account = {
        ...mockState.account,
        signingIn: false,
        pendingAuthUrl: null,
        pendingMode: null,
        error: null,
      };
      const snapshot = cloneAccount(mockState.account);
      dispatch?.({ type: "rayucode.account.changed", account: snapshot });
      return snapshot as RpcResult<M>;
    }
    case "settings.account.signInApiKey": {
      const apiKey = String(params.apiKey ?? "").trim();
      if (!apiKey.startsWith("rayu_sk_live_") || apiKey.length < 18) {
        throw new Error(
          "Invalid Rayu API key — keys must start with rayu_sk_live_.",
        );
      }
      mockState.account = {
        ...mockState.account,
        signedIn: true,
        authMethod: "apiKey",
        signingIn: false,
        pendingAuthUrl: null,
        pendingMode: null,
        error: null,
        displayName: "Rayu API Key",
        email: undefined,
        planName: "Plus",
        creditsRemaining: 94_250,
        topUpBalance: 12_000,
        windows: DEFAULT_MOCK_WINDOWS.map((w) => ({ ...w })),
      };
      updateMockRayuProviderFromAccount();
      const snapshot = cloneAccount(mockState.account);
      dispatch?.({ type: "rayucode.account.changed", account: snapshot });
      return snapshot as RpcResult<M>;
    }
    case "settings.account.completeCallback": {
      const callbackUrl = String(params.callbackUrl ?? "").trim();
      if (
        !callbackUrl.includes("code=") ||
        !callbackUrl.includes("state=") ||
        (!callbackUrl.startsWith("vscode://") &&
          !callbackUrl.startsWith("http://127.0.0.1") &&
          !callbackUrl.startsWith("http://localhost"))
      ) {
        throw new Error(
          "Invalid callback URL — expected vscode://rayucode.rayucode/auth?code=...&state=... or http://127.0.0.1:.../callback?code=...&state=...",
        );
      }
      mockState.account = {
        ...mockState.account,
        signedIn: true,
        authMethod: "oauth",
        signingIn: false,
        pendingAuthUrl: null,
        pendingMode: null,
        error: null,
        displayName: "Rayu Developer",
        email: "dev@rayucode.com",
        planName: "Plus",
        creditsRemaining: 94_250,
        topUpBalance: 12_000,
        windows: DEFAULT_MOCK_WINDOWS.map((w) => ({ ...w })),
      };
      updateMockRayuProviderFromAccount();
      const snapshot = cloneAccount(mockState.account);
      dispatch?.({ type: "rayucode.account.changed", account: snapshot });
      return snapshot as RpcResult<M>;
    }
    case "settings.account.signOut": {
      mockState.account = {
        signedIn: false,
        authMethod: "none",
        signingIn: false,
        pendingAuthUrl: null,
        pendingMode: null,
        webBase: mockState.account.webBase ?? "https://rayucode.com",
        error: null,
        windows: [],
        planLadder: mockState.account.planLadder?.map((t) => ({
          ...t,
          current: false,
          highlights: [...t.highlights],
        })),
      };
      updateMockRayuProviderFromAccount();
      const snapshot = cloneAccount(mockState.account);
      dispatch?.({ type: "rayucode.account.changed", account: snapshot });
      return snapshot as RpcResult<M>;
    }
    case "settings.account.setBypassPacing":
      mockState.account.bypassPacing = Boolean(params.enabled);
      return { ok: true, enabled: mockState.account.bypassPacing } as RpcResult<M>;
    case "settings.analytics.get": {
      const summary: AnalyticsSummaryView = {
        range: (params.range as "7d" | "30d") ?? "7d",
        groupBy: (params.groupBy as "feature" | "model") ?? "model",
        totalCredits: 1840,
        breakdown: [
          { key: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", credits: 1120, percent: 61, colorToken: "brand" },
          { key: "claude-opus-4-5", label: "Claude Opus 4.5", credits: 720, percent: 39, colorToken: "code-type" },
        ],
        topSessions: mockState.sessions.slice(0, 2).map((s, idx) => ({
          sessionId: s.sessionId,
          title: s.title,
          credits: idx === 0 ? 480 : 320,
          model: s.model,
          updatedAtMs: s.updatedAtMs,
        })),
      };
      return summary as RpcResult<M>;
    }
    case "settings.providers.list":
      return { providers: mockState.providers.map((p) => ({ ...p })) } as RpcResult<M>;
    case "settings.providers.setApiKey": {
      const pid = String(params.providerId ?? "");
      const baseUrl =
        typeof params.baseUrl === "string" && params.baseUrl.trim()
          ? params.baseUrl.trim()
          : undefined;
      const existing = mockState.providers.find((p) => p.id === pid);
      if (existing) {
        mockState.providers = mockState.providers.map((p) =>
          p.id === pid
            ? {
                ...p,
                status: "ready",
                authMethod: "api_key",
                baseUrl: baseUrl ?? p.baseUrl,
              }
            : p,
        );
      } else if (pid) {
        mockState.providers = [
          ...mockState.providers,
          {
            id: pid,
            name: pid,
            category: "native",
            status: "ready",
            authMethod: "api_key",
            baseUrl,
          },
        ];
      }
      return { ok: true } as RpcResult<M>;
    }
    case "settings.providers.clearApiKey": {
      const pid = String(params.providerId ?? "");
      mockState.providers = mockState.providers.map((p) =>
        p.id === pid ? { ...p, status: "needs_key", authMethod: "none" } : p,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "settings.providers.logout": {
      const pid = String(params.providerId ?? "");
      mockState.providers = mockState.providers.map((p) =>
        p.id === pid
          ? {
              ...p,
              status: "needs_key",
              authMethod: "none",
              accountLabel: undefined,
            }
          : p,
      );
      return { ok: true } as RpcResult<M>;
    }
    case "settings.models.setRoleOverride": {
      const role = String(params.role ?? "");
      const model = String(params.model ?? "inherit");
      const scope = params.scope === "session" ? "session" : "global";
      mockState.modelSettings.roleOverrides =
        mockState.modelSettings.roleOverrides.map((r) =>
          r.role === role ? { ...r, model, scope } : r,
        );
      return { ok: true } as RpcResult<M>;
    }
    case "settings.agents.setSubagentModel": {
      const model = String(params.model ?? "inherit");
      mockState.modelSettings.subagentModel = model === "default" ? null : model;
      return {
        ok: true,
        model: mockState.modelSettings.subagentModel,
        configuredDefault: mockState.modelSettings.subagentModel,
      } as RpcResult<M>;
    }
    case "settings.agents.upsertProfile": {
      const name = String(params.name ?? "").trim().toLowerCase();
      const model = String(params.model ?? "").trim();
      const scope = params.scope === "session" ? "session" : "global";
      const next = {
        name,
        model,
        effort:
          typeof params.effort === "string" && params.effort.trim()
            ? params.effort.trim()
            : null,
        description: String(params.description ?? "").trim(),
        scope,
      } as const;
      mockState.modelSettings.profiles = [
        ...mockState.modelSettings.profiles.filter(
          (p) => !(p.name === name && p.scope === scope),
        ),
        next,
      ];
      return {
        ok: true,
        profiles: mockState.modelSettings.profiles.map((p) => ({ ...p })),
      } as RpcResult<M>;
    }
    case "settings.agents.deleteProfile": {
      const name = String(params.name ?? "").trim().toLowerCase();
      const scope = params.scope === "session" ? "session" : "global";
      mockState.modelSettings.profiles = mockState.modelSettings.profiles.filter(
        (p) => !(p.name === name && p.scope === scope),
      );
      return {
        ok: true,
        profiles: mockState.modelSettings.profiles.map((p) => ({ ...p })),
      } as RpcResult<M>;
    }
    case "settings.hooks.openConfig":
    case "settings.shortcuts.openKeybindings":
    case "settings.runtime.update":
    case "settings.feedback.submit":
      return { ok: true } as RpcResult<M>;
    case "settings.doctor.run": {
      const scope = (params.scope as "providers" | "auth") ?? "providers";
      return {
        checks:
          scope === "providers"
            ? [
                {
                  id: "chk_daemon",
                  scope: "providers",
                  label: "Rayu Daemon Socket",
                  status: "pass",
                  detail: "Connected via local Unix socket (4ms RTT)",
                },
              ]
            : [
                {
                  id: "chk_cloud",
                  scope: "auth",
                  label: "Rayu Cloud Session",
                  status: mockState.account.signedIn ? "pass" : "warn",
                  detail: mockState.account.signedIn
                    ? "Authenticated as dev@rayucode.com"
                    : "Not signed in (BYOK providers active)",
                },
              ],
        ranAtMs: Date.now(),
      } as RpcResult<M>;
    }
    case "settings.models.get":
      return {
        ...mockState.modelSettings,
        roleOverrides: mockState.modelSettings.roleOverrides.map((r) => ({ ...r })),
        profiles: mockState.modelSettings.profiles.map((p) => ({ ...p })),
        globalProfiles: mockState.modelSettings.profiles
          .filter((p) => p.scope === "global")
          .map((p) => ({ ...p })),
        sessionProfiles: mockState.modelSettings.profiles
          .filter((p) => p.scope === "session")
          .map((p) => ({ ...p })),
        routes: mockState.modelSettings.routes.map((r) => ({ ...r })),
      } as RpcResult<M>;
    case "settings.models.refresh":
      return {
        ok: true,
        routeCount: mockState.modelSettings.routes.length,
        routes: mockState.modelSettings.routes.map((r) => ({ ...r })),
      } as RpcResult<M>;
    case "settings.models.setFast":
      mockState.modelSettings.serviceTier = params.tier as typeof mockState.modelSettings.serviceTier;
      return { ok: true, tier: mockState.modelSettings.serviceTier } as RpcResult<M>;
    case "settings.models.setCacheTtl":
      mockState.modelSettings.cacheTtl = params.ttl as typeof mockState.modelSettings.cacheTtl;
      return { ok: true, ttl: mockState.modelSettings.cacheTtl } as RpcResult<M>;
    case "settings.models.setTransport":
      mockState.modelSettings.transport = params.transport as typeof mockState.modelSettings.transport;
      return { ok: true, transport: mockState.modelSettings.transport } as RpcResult<M>;
    case "settings.features.get":
      return {
        features: { ...mockState.features },
        voice: { ...mockState.voice },
        telemetry: { ...mockState.telemetry },
      } as RpcResult<M>;
    case "settings.features.set": {
      const k = String(params.key ?? "");
      if (k in mockState.features) {
        (mockState.features as Record<string, unknown>)[k] = params.value;
      }
      return { ok: true, features: { ...mockState.features } } as RpcResult<M>;
    }
    case "settings.voice.update":
      mockState.voice = {
        ...mockState.voice,
        ...(typeof params.enabled === "boolean" ? { enabled: params.enabled } : {}),
        ...(typeof params.noiseSuppression === "boolean"
          ? { noiseSuppression: params.noiseSuppression }
          : {}),
        ...(typeof params.autoSendOnSilence === "boolean"
          ? { autoSendOnSilence: params.autoSendOnSilence }
          : {}),
      };
      return { ...mockState.voice } as RpcResult<M>;
    case "settings.telemetry.set":
      return { ...mockState.telemetry } as RpcResult<M>;
    case "settings.hooks.list":
      return {
        hooks: [
          { event: "pre_tool", label: "Pre-Tool Gate", mode: "sync", configured: false },
          { event: "post_tool", label: "Post-Tool Hook", mode: "async", configured: false },
          { event: "turn_end", label: "Turn End", mode: "async", configured: false },
        ],
        configPath: "~/.rayu/config.toml",
      } as RpcResult<M>;
    case "settings.shortcuts.list":
      return {
        shortcuts: [
          {
            id: "open-from-editor-title",
            label: "Open / Focus RayuCode (Preferred Surface)",
            keybinding: "Cmd/Ctrl+Alt+R",
            when: "global",
            commandId: "rayucode.openFromEditorTitle",
          },
          {
            id: "open-beside",
            label: "Open RayuCode Split Beside Editor",
            keybinding: "Cmd/Ctrl+Alt+Shift+R",
            when: "global",
            commandId: "rayucode.openBeside",
          },
          {
            id: "open-workspace-panel",
            label: "Open Mission Control Panel",
            keybinding: "Cmd/Ctrl+Shift+R",
            when: "global",
            commandId: "rayucode.openWorkspacePanel",
          },
          {
            id: "send-selection",
            label: "Add Selection to RayuCode Context",
            keybinding: "Cmd/Ctrl+Shift+L",
            when: "editorTextFocus",
            commandId: "rayucode.sendSelection",
          },
          {
            id: "open-background-processes",
            label: "Open Background Processes Drawer",
            keybinding: "Alt+Shift+B",
            when: "global",
            commandId: "rayucode.openBackgroundProcesses",
          },
          {
            id: "add-to-context",
            label: "Add File(s) to RayuCode Context (Explorer & Tab)",
            keybinding: "Context Menu",
            when: "explorerResourceScheme == file",
            commandId: "rayucode.addToContext",
          },
          {
            id: "explain-selection",
            label: "Explain Selection with RayuCode",
            keybinding: "Editor Menu",
            when: "editorHasSelection",
            commandId: "rayucode.explainSelection",
          },
          {
            id: "refactor-selection",
            label: "Refactor / Fix Selection with RayuCode",
            keybinding: "Editor Menu",
            when: "editorHasSelection",
            commandId: "rayucode.refactorSelection",
          },
          {
            id: "fix-diagnostic",
            label: "Fix Error / Diagnostic with RayuCode (Quick Fix)",
            keybinding: "Cmd/Ctrl+.",
            when: "editorTextFocus",
            commandId: "rayucode.fixDiagnostic",
          },
          {
            id: "ask-terminal",
            label: "Ask RayuCode about Terminal Output",
            keybinding: "Terminal Menu",
            when: "terminalFocus",
            commandId: "rayucode.askTerminal",
          },
          {
            id: "scm-open-changes",
            label: "Review Git Changes in RayuCode (SCM Header)",
            keybinding: "SCM Title",
            when: "scmProvider == git",
            commandId: "rayucode.scmOpenChanges",
          },
          {
            id: "toggle-sessions-pane",
            label: "Toggle Sessions & Projects Sidebar Pane",
            keybinding: "Shift+Cmd/Ctrl+S",
            commandId: "rayucode.toggleSessionsPane",
          },
          {
            id: "open-integrated-terminal",
            label: "Open Native VS Code Integrated Terminal",
            keybinding: "Cmd/Ctrl+J",
            commandId: "workbench.action.terminal.toggleTerminal",
          },
        ],
      } as RpcResult<M>;
    case "settings.permission.getDefault":
      return {
        mode: (mockState as { defaultPermissionMode?: PermissionModeId })
          .defaultPermissionMode ?? "default",
      } as RpcResult<M>;
    case "settings.permission.setDefault": {
      const p = (params ?? {}) as {
        mode?: PermissionModeId;
        applyToActiveSession?: boolean;
      };
      const nextMode: PermissionModeId = p.mode ?? "default";
      (mockState as { defaultPermissionMode?: PermissionModeId }).defaultPermissionMode =
        nextMode;
      return { ok: true, mode: nextMode } as RpcResult<M>;
    }
    case "settings.runtime.get":
      return {
        socketPath: mockState.daemon.socketPath ?? "/run/user/1000/rayu-daemon.sock",
        binaryPath: "~/.local/bin/rayu",
        autoStart: true,
        transport: mockState.modelSettings.transport,
      } as RpcResult<M>;

    // --- v1.16 Capabilities, Config & Session Controls ---
    case "capabilities.get":
      return {
        supported: mockV116State.capabilitiesSupported,
        commands: mockV116State.capabilitiesSupported
          ? mockV116State.commands.map((c) => ({ ...c }))
          : [],
        permission_modes: mockV116State.capabilitiesSupported
          ? mockV116State.permissionModes.map((m) => ({ ...m }))
          : [],
        features: mockV116State.capabilitiesSupported
          ? mockV116State.featureDescriptors.map((f) => ({ ...f }))
          : [],
      } as RpcResult<M>;
    case "config.get":
      if (!mockV116State.configSupported) {
        return { supported: false, config: null } as RpcResult<M>;
      }
      return {
        supported: true,
        config: {
          path: mockV116State.configPath,
          sections: [...mockV116State.configSections],
          values: { ...mockV116State.configValues },
          schema: mockV116State.configSchema.map((f) => ({ ...f })),
        },
      } as RpcResult<M>;
    case "config.patch": {
      if (!mockV116State.configSupported) {
        return {
          ok: false,
          code: "unsupported",
          message: "This Rayu daemon does not support config_v1.",
        } as RpcResult<M>;
      }
      const patch = (params as { patch?: Record<string, unknown> })?.patch ?? {};
      for (const [k, v] of Object.entries(patch)) {
        const rejection = mockV116State.rejectPatchKeys[k];
        if (rejection) {
          return {
            ok: false,
            code: "invalid_request",
            message: rejection,
          } as RpcResult<M>;
        }
        mockV116State.configValues[k] = v;
        if (k === "provider.default_model" && typeof v === "string") {
          mockState.modelSettings.defaultModel = v;
        }
        if (k.startsWith("features.")) {
          const fk = k.slice("features.".length);
          if (fk in mockState.features) {
            (mockState.features as Record<string, unknown>)[fk] = v;
          }
        }
      }
      const patchedKeys = new Set(Object.keys(patch));
      const requiresRestart = mockV116State.configSchema.some(
        (field) =>
          patchedKeys.has(field.key) && field.apply_mode === "restart_required",
      );
      return {
        ok: true,
        requiresRestart,
        config: {
          path: mockV116State.configPath,
          sections: [...mockV116State.configSections],
          values: { ...mockV116State.configValues },
          schema: mockV116State.configSchema.map((f) => ({ ...f })),
        },
      } as RpcResult<M>;
    }
    case "sessions.setModel": {
      if (mockV116State.busyMode) {
        return {
          ok: false,
          deferred: true,
          code: "busy",
          message: "Applies on next turn",
        } as RpcResult<M>;
      }
      const p = params as { model?: string };
      if (p?.model) mockState.modelSettings.defaultModel = p.model;
      return { ok: true } as RpcResult<M>;
    }
    case "sessions.setEffort": {
      if (mockV116State.busyMode) {
        return {
          ok: false,
          deferred: true,
          code: "busy",
          message: "Applies on next turn",
        } as RpcResult<M>;
      }
      return { ok: true } as RpcResult<M>;
    }
    case "sessions.runtimeCommand": {
      const p = params as { command?: string; args?: string[] };
      if (mockV116State.busyMode) {
        return {
          ok: false,
          command: p?.command ?? "",
          code: "busy",
          message: "Turn in progress; queued until active turn finishes.",
        } as RpcResult<M>;
      }
      return {
        ok: true,
        command: p?.command ?? "",
        message: `Ran /${p?.command ?? ""}`,
        data: {},
      } as RpcResult<M>;
    }

    // --- Inspector ---
    case "inspector.sidePanel.get":
      return {
        pages: mockState.sidePanelPages.map((p) => ({ ...p })),
        activePageId: mockState.sidePanelPages[0]?.id,
      } as RpcResult<M>;
    case "inspector.sidePanel.close":
      mockState.sidePanelPages = params.pageId
        ? mockState.sidePanelPages.filter((p) => p.id !== params.pageId)
        : [];
      return { ok: true } as RpcResult<M>;
    case "inspector.applet.get":
      return { applets: mockState.applets.map((a) => ({ ...a })) } as RpcResult<M>;
    case "inspector.applet.action":
      return { ok: true } as RpcResult<M>;
    case "inspector.applet.close":
      return { ok: true } as RpcResult<M>;
    case "inspector.todos.get":
      return { todos: mockState.todos.map((t) => ({ ...t })) } as RpcResult<M>;

    default: {
      const exhaustive: never = method;
      throw new Error(`Unhandled mock RPC method: ${String(exhaustive)}`);
    }
  }
}

export function handleMockHostMessage(
  msg: WebviewToHostMessage,
  dispatch: HostMessageDispatch,
): void {
  switch (msg.type) {
    case "rayucode.webview.ready": {
      queueMicrotask(() => {
        dispatch(createMockHostInitMessage());
      });
      return;
    }
    case "rayucode.rpc.call": {
      void handleMockRpcCall(
        msg.method,
        msg.params as RpcParams<typeof msg.method>,
        dispatch,
      )
        .then((data) => {
          dispatch({
            type: "rayucode.rpc.result",
            id: msg.id,
            ok: true,
            data,
          });
        })
        .catch((err) => {
          dispatch({
            type: "rayucode.rpc.result",
            id: msg.id,
            ok: false,
            code: "MOCK_RPC_ERROR",
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }
    case "rayucode.ui.setAppearance": {
      if (msg.theme !== undefined) mockState.appearance.theme = msg.theme;
      if (msg.accent !== undefined) mockState.appearance.accent = msg.accent;
      if (msg.density !== undefined) mockState.appearance.density = msg.density;
      if (msg.reduceMotion !== undefined) {
        mockState.appearance.reduceMotion = msg.reduceMotion;
      }
      dispatch({
        type: "rayucode.ui.appearanceSync",
        theme: mockState.appearance.theme,
        accent: mockState.appearance.accent,
        density: mockState.appearance.density,
        reduceMotion: mockState.appearance.reduceMotion,
      });
      return;
    }
    case "rayucode.ui.setWorkbench": {
      if (msg.openLocation !== undefined) {
        mockState.workbench.openLocation = msg.openLocation;
      }
      if (msg.contextActionsAutoSubmit !== undefined) {
        mockState.workbench.contextActionsAutoSubmit =
          msg.contextActionsAutoSubmit;
      }
      if (msg.showEditorTitleIcon !== undefined) {
        mockState.workbench.showEditorTitleIcon = msg.showEditorTitleIcon;
      }
      dispatch({
        type: "rayucode.ui.workbenchSync",
        workbench: { ...mockState.workbench },
      });
      return;
    }
    case "rayucode.ui.focusSidebar": {
      return;
    }
    case "rayucode.editor.copy":
    case "rayucode.host.copyToClipboard": {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(msg.text).catch(() => {});
      }
      return;
    }
    case "rayucode.dialog.pickFiles":
    case "rayucode.dialog.pickFolder": {
      dispatch({
        type: "rayucode.dialog.filesPicked",
        requestId: msg.requestId,
        paths: [],
      });
      return;
    }
    default:
      return;
  }
}
