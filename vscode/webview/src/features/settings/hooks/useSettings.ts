import * as React from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AccountStatusView,
  AgentRoleId,
  AgentRoleOverrideView,
  AnalyticsSummaryView,
  CacheTtl,
  DaemonStatusView,
  DoctorCheckView,
  EffortChoice,
  FeatureFlagsView,
  HookEntryView,
  PermissionModeId,
  ProviderEntryView,
  ProviderTransport,
  ServiceTier,
  ShortcutEntryView,
  TelemetryCategory,
  TelemetryConfigView,
  VoiceStatusView,
} from "@shared/vscodeProtocol";

import { useAppStore } from "@/lib/app-store";
import { callRpc } from "@/lib/rpc-client";

export type SettingsSectionId =
  | "account"
  | "appearance"
  | "models"
  | "features"
  | "safety"
  | "runtime"
  | "shortcuts";

export type SettingsNavGroup = "Account" | "App" | "System";

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  group: SettingsNavGroup;
  label: string;
  description: string;
  keywords: string;
}

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSectionMeta> = [
  {
    id: "account",
    group: "Account",
    label: "Account & Providers",
    description:
      "Rayu Cloud plan, usage analytics, 10 native runtimes, 45 OpenAI-compatible profiles, Azure & Google Workspace",
    keywords:
      "account cloud credits plan ladder analytics usage providers native openai anthropic gemini openrouter copilot bedrock cursor grok deepseek groq mistral ollama azure vertex api key oauth",
  },
  {
    id: "appearance",
    group: "App",
    label: "Appearance",
    description:
      "Theme polarity (Auto, Warm Graphite Dark, Warm Paper Light, Match VS Code), Rayu Green & Ocean Blue accent, density",
    keywords:
      "appearance theme dark light auto match vscode accent rayu green ocean blue density comfortable compact motion",
  },
  {
    id: "models",
    group: "App",
    label: "Models & Agents",
    description:
      "Default model route, reasoning effort, service tier, KV prompt cache TTL, per-role subagent & swarm overrides",
    keywords:
      "models agents effort reasoning fast priority ultrafast flex cache ttl 5m 1h swarm review judge memory ambient allowlist",
  },
  {
    id: "features",
    group: "App",
    label: "Features & Voice",
    description:
      "All 11 Rust runtime [features] flags, Codemode QuickJS sandbox, integration tools, streaming voice dictation & TTS",
    keywords:
      "features voice memory swarm mermaid auto_poke todo_gate_digest todo_gate_diagnostics message_timestamps persist_memory_injections kv_cache_miss_notices check_updates update_channel codemode integration_tools microphone dictation noise suppression",
  },
  {
    id: "safety",
    group: "System",
    label: "Safety & Hooks",
    description:
      "Default permission mode (5 modes), 2-stage Command-Risk Gate rules, and all 7 lifecycle hooks",
    keywords:
      "safety permissions ask auto-edit plan full manage orchestrator command risk gate safe bounded confirm hard_deny hooks pre_tool post_tool post_tool_feedback turn_start turn_end session_start session_end",
  },
  {
    id: "runtime",
    group: "System",
    label: "Runtime, Bridge & Doctor",
    description:
      "Daemon socket, binary path, Reload Daemon & Bridge, Provider & Auth Doctor, Self-Dev, and 6 Telemetry privacy switches",
    keywords:
      "runtime bridge daemon socket binary auto start reload ping doctor providers auth selfdev desktop_selfdev telemetry privacy content usage crashes features cost accounts feedback",
  },
  {
    id: "shortcuts",
    group: "System",
    label: "Shortcuts",
    description:
      "Searchable keyboard shortcuts reference (Shift+Tab, Alt+B, Cmd/Ctrl+Shift+P, session & inspector navigation)",
    keywords:
      "shortcuts keybindings keyboard shift+tab alt+b cmd ctrl terminal sidebar inspector permissions background",
  },
];

export const NATIVE_10_PROVIDERS: ReadonlyArray<ProviderEntryView> = [
  {
    id: "rayu",
    name: "Rayu Cloud Gateway",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 18,
    supportsOAuth: true,
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 9,
    supportsOAuth: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 14,
    supportsOAuth: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 10,
    supportsOAuth: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 120,
    supportsOAuth: false,
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 12,
    supportsOAuth: true,
  },
  {
    id: "bedrock",
    name: "AWS Bedrock",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 16,
    supportsOAuth: false,
  },
  {
    id: "antigravity",
    name: "Google Antigravity",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 8,
    supportsOAuth: true,
  },
  {
    id: "cursor",
    name: "Cursor",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 7,
    supportsOAuth: true,
  },
  {
    id: "grok",
    name: "xAI Grok",
    category: "native",
    status: "needs_key",
    authMethod: "none",
    modelCount: 6,
    supportsOAuth: false,
  },
];

const OPENAI_COMPAT_45_NAMES: ReadonlyArray<{
  id: string;
  name: string;
  baseUrl: string;
  localNoKey?: boolean;
}> = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1" },
  { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai" },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  { id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1" },
  { id: "xai", name: "xAI (OpenAI-Compat)", baseUrl: "https://api.x.ai/v1" },
  { id: "cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1" },
  { id: "moonshot", name: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.chat/v1" },
  { id: "zai", name: "Z.AI (GLM)", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "huggingface", name: "Hugging Face TGI", baseUrl: "https://api-inference.huggingface.co/v1" },
  { id: "nvidia-nim", name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1" },
  { id: "ollama", name: "Ollama (Local)", baseUrl: "http://127.0.0.1:11434/v1", localNoKey: true },
  { id: "lmstudio", name: "LM Studio (Local)", baseUrl: "http://127.0.0.1:1234/v1", localNoKey: true },
  { id: "meta-llama", name: "Meta Llama API", baseUrl: "https://api.llama.com/compat/v1" },
  { id: "cohere", name: "Cohere Compat", baseUrl: "https://api.cohere.ai/compatibility/v1" },
  { id: "ai21", name: "AI21 Labs", baseUrl: "https://api.ai21.com/studio/v1" },
  { id: "sambanova", name: "SambaNova Cloud", baseUrl: "https://api.sambanova.ai/v1" },
  { id: "hyperbolic", name: "Hyperbolic", baseUrl: "https://api.hyperbolic.xyz/v1" },
  { id: "novita", name: "Novita AI", baseUrl: "https://api.novita.ai/v3/openai" },
  { id: "baseten", name: "Baseten", baseUrl: "https://bridge.baseten.co/v1" },
  { id: "replicate", name: "Replicate OpenAI Proxy", baseUrl: "https://openai-proxy.replicate.com/v1" },
  { id: "anyscale", name: "Anyscale Endpoints", baseUrl: "https://api.endpoints.anyscale.com/v1" },
  { id: "lepton", name: "Lepton AI", baseUrl: "https://api.lepton.ai/v1" },
  { id: "nebius", name: "Nebius AI Studio", baseUrl: "https://api.studio.nebius.ai/v1" },
  { id: "crusoe", name: "Crusoe Cloud", baseUrl: "https://api.crusoe.ai/v1" },
  { id: "lambda", name: "Lambda Inference", baseUrl: "https://api.lambdalabs.com/v1" },
  { id: "scaleway", name: "Scaleway Generative", baseUrl: "https://api.scaleway.ai/v1" },
  { id: "ovhcloud", name: "OVHcloud AI Endpoints", baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1" },
  { id: "featherless", name: "Featherless AI", baseUrl: "https://api.featherless.ai/v1" },
  { id: "chutes", name: "Chutes AI", baseUrl: "https://llm.chutes.ai/v1" },
  { id: "inferencenet", name: "Inference.net", baseUrl: "https://api.inference.net/v1" },
  { id: "friendli", name: "FriendliAI", baseUrl: "https://api.friendli.ai/serverless/v1" },
  { id: "octoai", name: "OctoAI", baseUrl: "https://text.octoai.run/v1" },
  { id: "deepinfra", name: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai" },
  { id: "siliconflow", name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1" },
  { id: "stepfun", name: "StepFun", baseUrl: "https://api.stepfun.com/v1" },
  { id: "baichuan", name: "Baichuan AI", baseUrl: "https://api.baichuan-ai.com/v1" },
  { id: "dashscope", name: "Alibaba Qwen (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "yi-01ai", name: "01.AI (Yi)", baseUrl: "https://api.01.ai/v1" },
  { id: "spark", name: "iFlyTek Spark", baseUrl: "https://spark-api-open.xf-yun.com/v1" },
  { id: "hunyuan", name: "Tencent Hunyuan", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1" },
  { id: "volcengine", name: "Volcengine Ark (Doubao)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "vllm-local", name: "vLLM Local Server", baseUrl: "http://127.0.0.1:8000/v1" },
];

export const OPENAI_COMPAT_45_PROVIDERS: ReadonlyArray<ProviderEntryView> =
  OPENAI_COMPAT_45_NAMES.map((p) => ({
    id: p.id,
    name: p.name,
    category: "openai_compatible",
    status: p.localNoKey ? "ready" : "needs_key",
    authMethod: "none",
    baseUrl: p.baseUrl,
    supportsOAuth: false,
  }));

export const ENTERPRISE_2_PROVIDERS: ReadonlyArray<ProviderEntryView> = [
  {
    id: "azure",
    name: "Azure OpenAI Service",
    category: "enterprise",
    status: "needs_key",
    authMethod: "none",
    supportsOAuth: true,
  },
  {
    id: "google_workspace",
    name: "Google Workspace & Vertex AI",
    category: "enterprise",
    status: "needs_key",
    authMethod: "none",
    supportsOAuth: true,
  },
];

function normalizeProviderIdForUi(rawId: string): string {
  switch (rawId.trim().toLowerCase()) {
    case "rayu-cloud":
    case "rayu":
      return "rayu";
    case "claude":
    case "claude-api":
    case "anthropic":
      return "anthropic";
    case "openai-api":
    case "openai":
      return "openai";
    case "github-copilot":
    case "copilot":
      return "copilot";
    case "aws-bedrock":
    case "bedrock":
      return "bedrock";
    case "azure-openai":
    case "azure":
      return "azure";
    case "google-gemini":
    case "gemini-api":
    case "gemini":
      return "gemini";
    case "grok-build":
    case "grok":
      return "grok";
    case "google-workspace-vertex":
    case "google-workspace":
    case "google_workspace":
      return "google_workspace";
    default:
      return rawId;
  }
}

export const ALL_57_DEFAULT_PROVIDERS: ReadonlyArray<ProviderEntryView> = [
  ...NATIVE_10_PROVIDERS,
  ...OPENAI_COMPAT_45_PROVIDERS,
  ...ENTERPRISE_2_PROVIDERS,
];

export const ALL_7_DEFAULT_HOOKS: ReadonlyArray<
  HookEntryView & {
    kindLabel: "1 Sync Gate" | "1 Sync Feedback" | "5 Async Observers";
    description: string;
  }
> = [
  {
    event: "pre_tool",
    label: "pre_tool",
    mode: "sync",
    kindLabel: "1 Sync Gate",
    configured: true,
    commandSummary: "rayu-policy-gate --verify-paths",
    description:
      "Synchronous pre-execution gate; non-zero exit blocks tool execution and returns stderr to agent",
  },
  {
    event: "post_tool_feedback",
    label: "post_tool_feedback",
    mode: "sync",
    kindLabel: "1 Sync Feedback",
    configured: true,
    commandSummary: "cargo check --message-format=short",
    description:
      "Synchronous post-tool feedback injector; appends compiler/linter diagnostics directly into tool result",
  },
  {
    event: "post_tool",
    label: "post_tool",
    mode: "async",
    kindLabel: "5 Async Observers",
    configured: false,
    description:
      "Asynchronous observer fired after each tool call without delaying turn latency",
  },
  {
    event: "turn_start",
    label: "turn_start",
    mode: "async",
    kindLabel: "5 Async Observers",
    configured: false,
    description:
      "Asynchronous observer triggered when a user prompt begins a new execution turn",
  },
  {
    event: "turn_end",
    label: "turn_end",
    mode: "async",
    kindLabel: "5 Async Observers",
    configured: true,
    commandSummary: "notify-send 'RayuCode Turn Complete'",
    description:
      "Asynchronous observer triggered when an execution turn completes or halts",
  },
  {
    event: "session_start",
    label: "session_start",
    mode: "async",
    kindLabel: "5 Async Observers",
    configured: false,
    description:
      "Asynchronous observer triggered when a session is created or attached",
  },
  {
    event: "session_end",
    label: "session_end",
    mode: "async",
    kindLabel: "5 Async Observers",
    configured: false,
    description:
      "Asynchronous observer triggered when a session is archived or closed",
  },
];

export const DEFAULT_5_ROLE_OVERRIDES: ReadonlyArray<AgentRoleOverrideView> = [
  {
    role: "swarm",
    label: "Swarm Workers",
    model: "claude-sonnet-4-5",
    scope: "global",
  },
  {
    role: "review",
    label: "Code Review (/review & autoreview)",
    model: "claude-sonnet-4-5",
    scope: "global",
  },
  {
    role: "judge",
    label: "Acceptance Judge (/judge & autojudge)",
    model: "claude-opus-4-5",
    scope: "global",
  },
  {
    role: "memory",
    label: "Memory Extraction (Jev & Semantic Graph)",
    model: "inherit",
    scope: "global",
  },
  {
    role: "ambient",
    label: "Ambient Autonomous Cycles",
    model: "claude-sonnet-4-5",
    scope: "global",
  },
];

export const DEFAULT_SHORTCUT_ENTRIES: ReadonlyArray<
  ShortcutEntryView & { category: string }
> = [
  {
    id: "cycle-permission-mode",
    label: "Cycle Permission Mode (Ask / Auto-edit / Plan / Full Manage / Orchestrator)",
    keybinding: "Shift+Tab",
    when: "rayucode.focused",
    commandId: "rayucode.cyclePermissionMode",
    category: "Composer & Execution",
  },
  {
    id: "background-running-tool",
    label: "Move Running Foreground Tool to Background Task Manager",
    keybinding: "Alt+B",
    when: "rayucode.turnRunning",
    commandId: "rayucode.backgroundRunningTool",
    category: "Composer & Execution",
  },
  {
    id: "command-palette-rayu",
    label: "Open VS Code Command Palette (RayuCode Commands)",
    keybinding: "Cmd/Ctrl+Shift+P",
    when: "global",
    commandId: "workbench.action.showCommands",
    category: "Workspace & Navigation",
  },
  {
    id: "toggle-sessions-pane",
    label: "Toggle Sessions & Projects Sidebar Pane",
    keybinding: "Shift+Cmd/Ctrl+S",
    when: "rayucode.focused",
    commandId: "rayucode.toggleSessionsPane",
    category: "Workspace & Navigation",
  },
  {
    id: "open-integrated-terminal",
    label: "Open Native VS Code Integrated Terminal",
    keybinding: "Cmd/Ctrl+J",
    when: "global",
    commandId: "workbench.action.terminal.toggleTerminal",
    category: "Workspace & Navigation",
  },
  {
    id: "search-sessions",
    label: "Cross-Tool Session Search (Rayu, Claude, Codex, Cursor, OpenCode, Pi)",
    keybinding: "Cmd/Ctrl+K",
    when: "rayucode.focused",
    commandId: "rayucode.searchSessions",
    category: "Workspace & Navigation",
  },
  {
    id: "nav-history-back",
    label: "Navigate Back in Session & Route History",
    keybinding: "Cmd/Ctrl+[",
    when: "rayucode.focused",
    commandId: "rayucode.navigateBack",
    category: "Workspace & Navigation",
  },
  {
    id: "nav-history-forward",
    label: "Navigate Forward in Session & Route History",
    keybinding: "Cmd/Ctrl+]",
    when: "rayucode.focused",
    commandId: "rayucode.navigateForward",
    category: "Workspace & Navigation",
  },
  {
    id: "restore-clipped-chat",
    label: "Restore Chat Session Canvas from Full-Width Inspector",
    keybinding: "Cmd/Ctrl+1",
    when: "rayucode.inspectorFullView",
    commandId: "rayucode.restoreChatCanvas",
    category: "Inspector & Review",
  },
  {
    id: "send-prompt",
    label: "Send Prompt or Soft-Interrupt Steer",
    keybinding: "Cmd/Ctrl+Enter",
    when: "rayucode.composerFocused",
    commandId: "rayucode.sendPrompt",
    category: "Composer & Execution",
  },
  {
    id: "stop-turn",
    label: "Stop Active Streaming Turn",
    keybinding: "Esc",
    when: "rayucode.turnRunning",
    commandId: "rayucode.stopTurn",
    category: "Composer & Execution",
  },
];

export const FULL_PLAN_LADDER = [
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
    current: false,
    highlights: ["115,000 Rayu Cloud credits / mo", "Swarms & Overnight runs"],
  },
  {
    id: "max",
    name: "Max",
    priceLabel: "$50 / mo",
    current: false,
    highlights: ["300,000 Rayu Cloud credits / mo", "Priority routing & 1h KV TTL"],
  },
  {
    id: "team",
    name: "Team",
    priceLabel: "$10 / mo",
    current: false,
    highlights: ["30,000 shared credits / mo", "Unlimited seats & centralized billing"],
  },
  {
    id: "team-plus",
    name: "Team Plus",
    priceLabel: "$29 / mo",
    current: false,
    highlights: ["100,000 shared credits / mo", "Unlimited seats & Hosted API"],
  },
  {
    id: "team-max",
    name: "Team Max",
    priceLabel: "$79 / mo",
    current: false,
    highlights: ["400,000 shared credits / mo", "Dedicated org controls & priority capacity"],
  },
];

function buildPlanLadderForAccount(account: AccountStatusView) {
  const base =
    account.planLadder && account.planLadder.length >= 7
      ? account.planLadder
      : FULL_PLAN_LADDER;
  const activePlan = account.signedIn
    ? (account.planName ?? "").trim().toLowerCase()
    : "";
  return base.map((tier) => ({
    ...tier,
    current: Boolean(
      activePlan &&
        (tier.id.toLowerCase() === activePlan ||
          tier.name.toLowerCase() === activePlan),
    ),
  }));
}

export function useSettings(initialSection: SettingsSectionId = "account") {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const daemonStatusFromStore = useAppStore((s) => s.daemonStatus);
  const setDaemonStatus = useAppStore((s) => s.setDaemonStatus);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setAuthLoaded = useAppStore((s) => s.setAuthLoaded);
  const setAuthBypassed = useAppStore((s) => s.setAuthBypassed);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);

  const [activeSection, setActiveSection] =
    React.useState<SettingsSectionId>(initialSection);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [analyticsRange, setAnalyticsRange] = React.useState<"7d" | "30d">(
    "7d",
  );
  const [analyticsGroupBy, setAnalyticsGroupBy] = React.useState<
    "feature" | "model"
  >("feature");
  const [defaultPermissionMode, setDefaultPermissionModeState] =
    React.useState<PermissionModeId>("default");
  const [doctorResults, setDoctorResults] = React.useState<DoctorCheckView[]>(
    [],
  );
  const [selfDevOutput, setSelfDevOutput] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const syncAccountEverywhere = React.useCallback(
    (next: AccountStatusView) => {
      const normalized: AccountStatusView = {
        ...next,
        planLadder: buildPlanLadderForAccount(next),
      };
      setAccountStatus(normalized);
      setAuthLoaded(true);
      if (normalized.signedIn) {
        setAuthBypassed(false);
        setAuthDialogOpen(false);
      }
      queryClient.setQueryData(["settings", "account"], normalized);
      queryClient.setQueryData(["shell", "account", "status"], normalized);
      void queryClient.invalidateQueries({ queryKey: ["settings", "account"] });
      void queryClient.invalidateQueries({
        queryKey: ["shell", "account", "status"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["settings", "providers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      return normalized;
    },
    [
      queryClient,
      setAccountStatus,
      setAuthBypassed,
      setAuthDialogOpen,
      setAuthLoaded,
    ],
  );

  const accountQuery = useQuery(
    queryOptions({
      queryKey: ["settings", "account"] as const,
      queryFn: async (): Promise<AccountStatusView> => {
        const res = await callRpc("settings.account.get");
        const normalized: AccountStatusView = {
          ...res,
          planLadder: buildPlanLadderForAccount(res),
        };
        setAccountStatus(normalized);
        setAuthLoaded(true);
        return normalized;
      },
    }),
  );

  const analyticsQuery = useQuery(
    queryOptions({
      queryKey: [
        "settings",
        "analytics",
        analyticsRange,
        analyticsGroupBy,
      ] as const,
      queryFn: () =>
        callRpc("settings.analytics.get", {
          range: analyticsRange,
          groupBy: analyticsGroupBy,
        }),
    }),
  );

  const providersQuery = useQuery(
    queryOptions({
      queryKey: ["settings", "providers"] as const,
      queryFn: async (): Promise<ProviderEntryView[]> => {
        const res = await callRpc("settings.providers.list");
        const byId = new Map<string, ProviderEntryView>();
        for (const p of res.providers) {
          const id = normalizeProviderIdForUi(p.id);
          byId.set(id, { ...p, id });
        }
        return ALL_57_DEFAULT_PROVIDERS.map((def) => {
          const live = byId.get(def.id);
          return live ? { ...def, ...live, id: def.id } : def;
        });
      },
    }),
  );

  const modelsQuery = useQuery(
    queryOptions({
      queryKey: ["settings", "models", activeSessionId ?? "global"] as const,
      queryFn: async () => {
        const res = await callRpc("settings.models.get", {
          sessionId: activeSessionId ?? undefined,
        });
        const byRole = new Map(res.roleOverrides.map((r) => [r.role, r]));
        const roleOverrides = DEFAULT_5_ROLE_OVERRIDES.map(
          (def) => byRole.get(def.role) ?? def,
        );
        return {
          ...res,
          defaultModel: res.defaultModel ?? "claude-sonnet-4-5",
          roleOverrides,
          swarmAllowlist: res.swarmAllowlist ?? [
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "gpt-5.2",
          ],
        };
      },
    }),
  );

  const featuresQuery = useQuery(
    queryOptions({
      queryKey: ["settings", "features"] as const,
      queryFn: () => callRpc("settings.features.get"),
    }),
  );

  const hooksQuery = useQuery(
    queryOptions({
      queryKey: ["settings", "hooks"] as const,
      queryFn: async () => {
        const res = await callRpc("settings.hooks.list");
        const byEvent = new Map(res.hooks.map((h) => [h.event, h]));
        return {
          configPath: res.configPath ?? "~/.rayu/config.toml",
          hooks: ALL_7_DEFAULT_HOOKS.map((def) => {
            const live = byEvent.get(def.event);
            return live
              ? {
                  ...def,
                  configured: live.configured || def.configured,
                  commandSummary: live.commandSummary ?? def.commandSummary,
                }
              : def;
          }),
        };
      },
    }),
  );

  const runtimeQuery = useQuery(
    queryOptions({
      queryKey: ["settings", "runtime"] as const,
      queryFn: () => callRpc("settings.runtime.get"),
    }),
  );

  const daemonQuery = useQuery(
    queryOptions({
      queryKey: ["daemon", "status"] as const,
      queryFn: async () => {
        const res = await callRpc("daemon.status");
        setDaemonStatus(res);
        return res;
      },
    }),
  );

  const shortcutsQuery = useQuery(
    queryOptions({
      queryKey: ["settings", "shortcuts"] as const,
      queryFn: async () => {
        const res = await callRpc("settings.shortcuts.list");
        const existingIds = new Set(DEFAULT_SHORTCUT_ENTRIES.map((s) => s.id));
        const extras = res.shortcuts
          .filter((s) => !existingIds.has(s.id))
          .map((s) => ({ ...s, category: "Custom" }));
        return [...DEFAULT_SHORTCUT_ENTRIES, ...extras];
      },
    }),
  );

  // --- Mutations ---
  const refreshAccountMutation = useMutation({
    mutationFn: () => callRpc("settings.account.refresh"),
    onSuccess: (next) => {
      syncAccountEverywhere(next);
      setStatusMessage("Synced Rayu Cloud account & usage windows.");
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to refresh Rayu Cloud account";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const signOutMutation = useMutation({
    mutationFn: () => callRpc("settings.account.signOut"),
    onSuccess: (next) => {
      syncAccountEverywhere(next);
      setStatusMessage("Signed out of Rayu Cloud.");
      toast("Signed out of Rayu Cloud");
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to sign out of Rayu Cloud";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const signInBrowserMutation = useMutation({
    mutationFn: (mode?: "vscode" | "loopback") =>
      callRpc("settings.account.signInBrowser", mode ? { mode } : undefined),
    onSuccess: (res) => {
      if (res.state) {
        syncAccountEverywhere(res.state);
      }
      setStatusMessage(
        res.state?.signedIn
          ? "Authenticated with Rayu Cloud."
          : "Complete sign-in in your browser...",
      );
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to start browser sign-in";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const cancelSignInMutation = useMutation({
    mutationFn: () => callRpc("settings.account.cancelSignIn"),
    onSuccess: (next) => {
      syncAccountEverywhere(next);
      setStatusMessage("Cancelled browser sign-in.");
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to cancel browser sign-in";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const signInApiKeyMutation = useMutation({
    mutationFn: (apiKey: string) =>
      callRpc("settings.account.signInApiKey", { apiKey }),
    onSuccess: (next) => {
      syncAccountEverywhere(next);
      setStatusMessage("Connected Rayu Cloud API key.");
      toast.success("Rayu Cloud API key connected");
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to verify Rayu API key";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const completeCallbackMutation = useMutation({
    mutationFn: (callbackUrl: string) =>
      callRpc("settings.account.completeCallback", { callbackUrl }),
    onSuccess: (next) => {
      syncAccountEverywhere(next);
      setStatusMessage("Completed browser sign-in.");
      toast.success("Signed in to Rayu Cloud");
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to complete OAuth callback";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const bypassPacingMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      callRpc("settings.account.setBypassPacing", { enabled }),
    onSuccess: (_res, enabled) => {
      queryClient.setQueryData<AccountStatusView>(
        ["settings", "account"],
        (prev) => (prev ? { ...prev, bypassPacing: enabled } : prev),
      );
      setStatusMessage(
        enabled
          ? "Pacing windows bypassed (using all available credits)."
          : "5-hour and weekly pacing windows enabled.",
      );
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to update pacing setting";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const setProviderKeyMutation = useMutation({
    mutationFn: (input: {
      providerId: string;
      apiKey: string;
      baseUrl?: string;
    }) => callRpc("settings.providers.setApiKey", input),
    onSuccess: (_res, { providerId, baseUrl }) => {
      queryClient.setQueryData<ProviderEntryView[]>(
        ["settings", "providers"],
        (prev) =>
          (prev ?? []).map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  status: "ready",
                  authMethod: "api_key",
                  baseUrl: baseUrl ?? p.baseUrl,
                }
              : p,
          ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["settings", "providers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      if (providerId === "rayu") {
        void queryClient.invalidateQueries({
          queryKey: ["settings", "account"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["shell", "account", "status"],
        });
      }
      setStatusMessage(`Saved API key for provider ${providerId}.`);
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to save provider API key";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const clearProviderKeyMutation = useMutation({
    mutationFn: (providerId: string) =>
      callRpc("settings.providers.clearApiKey", { providerId }),
    onSuccess: (_res, providerId) => {
      queryClient.setQueryData<ProviderEntryView[]>(
        ["settings", "providers"],
        (prev) =>
          (prev ?? []).map((p) =>
            p.id === providerId
              ? { ...p, status: "needs_key", authMethod: "none" }
              : p,
          ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["settings", "providers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      if (providerId === "rayu") {
        void queryClient.invalidateQueries({
          queryKey: ["settings", "account"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["shell", "account", "status"],
        });
      }
      setStatusMessage(`Cleared API key for ${providerId}.`);
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to clear provider API key";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const logoutProviderMutation = useMutation({
    mutationFn: (providerId: string) =>
      callRpc("settings.providers.logout", { providerId }),
    onSuccess: (_res, providerId) => {
      queryClient.setQueryData<ProviderEntryView[]>(
        ["settings", "providers"],
        (prev) =>
          (prev ?? []).map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  status: "needs_key",
                  authMethod: "none",
                  accountLabel: undefined,
                }
              : p,
          ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["settings", "providers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      if (providerId === "rayu") {
        void queryClient.invalidateQueries({
          queryKey: ["settings", "account"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["shell", "account", "status"],
        });
      }
      setStatusMessage(`Logged out of ${providerId}.`);
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Failed to log out provider";
      setStatusMessage(msg);
      toast.error(msg);
    },
  });

  const refreshModelsMutation = useMutation({
    mutationFn: () =>
      callRpc("settings.models.refresh", {
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (res) => {
      setStatusMessage(
        `Refreshed live model discovery catalog (${res.routeCount ?? 38} routes discovered).`,
      );
    },
  });

  const setFastTierMutation = useMutation({
    mutationFn: (tier: ServiceTier) =>
      callRpc("settings.models.setFast", {
        tier,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (_res, tier) => {
      queryClient.setQueryData(
        ["settings", "models", activeSessionId ?? "global"],
        (prev: Record<string, unknown> | undefined) =>
          prev ? { ...prev, serviceTier: tier } : prev,
      );
      setStatusMessage(`Service tier updated to ${tier}.`);
    },
  });

  const setCacheTtlMutation = useMutation({
    mutationFn: (ttl: CacheTtl) =>
      callRpc("settings.models.setCacheTtl", {
        ttl,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (_res, ttl) => {
      queryClient.setQueryData(
        ["settings", "models", activeSessionId ?? "global"],
        (prev: Record<string, unknown> | undefined) =>
          prev ? { ...prev, cacheTtl: ttl } : prev,
      );
      setStatusMessage(`Prompt KV-Cache TTL updated to ${ttl}.`);
    },
  });

  const setRoleOverrideMutation = useMutation({
    mutationFn: (input: {
      role: AgentRoleId;
      model: string;
      scope: "session" | "global";
    }) =>
      callRpc("settings.models.setRoleOverride", {
        ...input,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (_res, input) => {
      queryClient.setQueryData(
        ["settings", "models", activeSessionId ?? "global"],
        (
          prev:
            | {
                roleOverrides: AgentRoleOverrideView[];
                [k: string]: unknown;
              }
            | undefined,
        ) => {
          if (!prev) return prev;
          return {
            ...prev,
            roleOverrides: prev.roleOverrides.map((r) =>
              r.role === input.role
                ? { ...r, model: input.model, scope: input.scope }
                : r,
            ),
          };
        },
      );
      setStatusMessage(
        `Updated ${input.role} model override to ${input.model} (${input.scope}).`,
      );
    },
  });

  const setFeatureFlagMutation = useMutation({
    mutationFn: (input: { key: keyof FeatureFlagsView; value: boolean | string }) =>
      callRpc("settings.features.set", {
        key: String(input.key),
        value: input.value,
      }),
    onSuccess: (res, input) => {
      queryClient.setQueryData(
        ["settings", "features"],
        (
          prev:
            | {
                features: FeatureFlagsView;
                voice: VoiceStatusView;
                telemetry: TelemetryConfigView;
              }
            | undefined,
        ) =>
          prev
            ? {
                ...prev,
                features: {
                  ...prev.features,
                  ...res.features,
                  [input.key]: input.value,
                },
              }
            : prev,
      );
      setStatusMessage(`Updated [features] ${String(input.key)} = ${String(input.value)}.`);
    },
  });

  const updateVoiceMutation = useMutation({
    mutationFn: (patch: {
      enabled?: boolean;
      deviceId?: string;
      noiseSuppression?: boolean;
      autoSendOnSilence?: boolean;
    }) => callRpc("settings.voice.update", patch),
    onSuccess: (nextVoice) => {
      queryClient.setQueryData(
        ["settings", "features"],
        (
          prev:
            | {
                features: FeatureFlagsView;
                voice: VoiceStatusView;
                telemetry: TelemetryConfigView;
              }
            | undefined,
        ) => (prev ? { ...prev, voice: nextVoice } : prev),
      );
      setStatusMessage("Updated voice dictation settings.");
    },
  });

  const setPermissionModeMutation = useMutation({
    mutationFn: async (mode: PermissionModeId) => {
      setDefaultPermissionModeState(mode);
      return callRpc("sessions.setPermissionMode", {
        sessionId: activeSessionId ?? "ses_vscode_shell",
        mode,
      });
    },
    onSuccess: (_res, mode) => {
      setStatusMessage(`Default permission mode set to ${mode}.`);
    },
  });

  const openHooksConfigMutation = useMutation({
    mutationFn: () => callRpc("settings.hooks.openConfig"),
    onSuccess: () => {
      setStatusMessage("Opened hooks configuration in VS Code editor.");
    },
  });

  const pingDaemonMutation = useMutation({
    mutationFn: () => callRpc("daemon.ping"),
    onSuccess: (res) => {
      queryClient.setQueryData<DaemonStatusView>(
        ["daemon", "status"],
        (prev) =>
          prev
            ? {
                ...prev,
                state: "connected",
                latencyMs: res.latencyMs,
                version: res.version ?? prev.version,
              }
            : prev,
      );
      setStatusMessage(
        `Daemon healthy (${res.latencyMs} ms RTT · v${res.version ?? "2.4.0"}).`,
      );
    },
  });

  const reloadDaemonMutation = useMutation({
    mutationFn: async () => {
      await callRpc("daemon.reload");
      return callRpc("daemon.restart");
    },
    onSuccess: (nextStatus) => {
      setDaemonStatus(nextStatus);
      queryClient.setQueryData(["daemon", "status"], nextStatus);
      setStatusMessage("Reloaded Rayu Daemon & Bridge connection.");
    },
  });

  const reconnectDaemonMutation = useMutation({
    mutationFn: () => callRpc("daemon.reconnect"),
    onSuccess: (nextStatus) => {
      setDaemonStatus(nextStatus);
      queryClient.setQueryData(["daemon", "status"], nextStatus);
      setStatusMessage("Reconnected to Rayu Daemon socket.");
    },
  });

  const openOutputLogMutation = useMutation({
    mutationFn: () => callRpc("daemon.openOutputLog"),
    onSuccess: () => {
      setStatusMessage("Opened RayuCode daemon output log in VS Code.");
    },
  });

  const updateRuntimeMutation = useMutation({
    mutationFn: (patch: {
      socketPath?: string;
      binaryPath?: string;
      autoStart?: boolean;
      transport?: ProviderTransport;
    }) => {
      if (patch.transport) {
        void callRpc("settings.models.setTransport", {
          transport: patch.transport,
        });
      }
      return callRpc("settings.runtime.update", {
        socketPath: patch.socketPath,
        binaryPath: patch.binaryPath,
        autoStart: patch.autoStart,
      });
    },
    onSuccess: (_res, patch) => {
      queryClient.setQueryData(
        ["settings", "runtime"],
        (prev: Record<string, unknown> | undefined) =>
          prev ? { ...prev, ...patch } : prev,
      );
      setStatusMessage("Updated daemon runtime & bridge settings.");
    },
  });

  const runDoctorMutation = useMutation({
    mutationFn: (scope: "providers" | "auth") =>
      callRpc("settings.doctor.run", { scope }),
    onSuccess: (res, scope) => {
      setDoctorResults((prev) => [
        ...prev.filter((c) => c.scope !== scope),
        ...res.checks,
      ]);
      setStatusMessage(
        `Completed ${scope === "providers" ? "Provider" : "Auth"} Doctor check (${res.checks.length} item(s)).`,
      );
    },
  });

  const runSelfDevMutation = useMutation({
    mutationFn: (action: "status" | "build" | "reload") =>
      callRpc("daemon.selfdev", { action }),
    onSuccess: (res, action) => {
      setSelfDevOutput(
        res.output ?? `Self-dev (${action}): ${res.status}`,
      );
      setStatusMessage(`Self-dev ${action} finished (${res.status}).`);
    },
  });

  const setTelemetryMutation = useMutation({
    mutationFn: (input: {
      category: TelemetryCategory | "all" | "none";
      enabled?: boolean;
    }) => callRpc("settings.telemetry.set", input),
    onSuccess: (_res, input) => {
      queryClient.setQueryData(
        ["settings", "features"],
        (
          prev:
            | {
                features: FeatureFlagsView;
                voice: VoiceStatusView;
                telemetry: TelemetryConfigView;
              }
            | undefined,
        ) => {
          if (!prev) return prev;
          const current = prev.telemetry;
          if (current.lockedByEnv) return prev;
          let nextTelemetry: TelemetryConfigView = { ...current };
          if (input.category === "all") {
            nextTelemetry = {
              ...current,
              content: true,
              usage: true,
              crashes: true,
              features: true,
              cost: true,
              accounts: true,
            };
          } else if (input.category === "none") {
            nextTelemetry = {
              ...current,
              content: false,
              usage: false,
              crashes: false,
              features: false,
              cost: false,
              accounts: false,
            };
          } else {
            nextTelemetry = {
              ...current,
              [input.category]: Boolean(input.enabled),
            };
          }
          return { ...prev, telemetry: nextTelemetry };
        },
      );
      setStatusMessage(`Updated telemetry preference (${input.category}).`);
    },
  });

  const submitFeedbackMutation = useMutation({
    mutationFn: (input: {
      kind: "bug" | "suggestion" | "usability";
      summary: string;
      details?: string;
    }) => callRpc("settings.feedback.submit", input),
    onSuccess: () => {
      setStatusMessage("Submitted feedback report to RayuCode maintainers.");
    },
  });

  const openKeybindingsMutation = useMutation({
    mutationFn: () => callRpc("settings.shortcuts.openKeybindings"),
    onSuccess: () => {
      setStatusMessage("Opened VS Code Keyboard Shortcuts editor.");
    },
  });

  const setDefaultModel = React.useCallback(
    (model: string) => {
      queryClient.setQueryData(
        ["settings", "models", activeSessionId ?? "global"],
        (prev: Record<string, unknown> | undefined) =>
          prev ? { ...prev, defaultModel: model } : prev,
      );
      setStatusMessage(`Default model route set to ${model}.`);
    },
    [activeSessionId, queryClient],
  );

  const setDefaultEffort = React.useCallback(
    (effort: EffortChoice) => {
      queryClient.setQueryData(
        ["settings", "models", activeSessionId ?? "global"],
        (prev: Record<string, unknown> | undefined) =>
          prev ? { ...prev, defaultEffort: effort } : prev,
      );
      setStatusMessage(`Default reasoning effort set to ${effort ?? "auto"}.`);
    },
    [activeSessionId, queryClient],
  );

  const filteredSections = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter(
      (sec) =>
        sec.label.toLowerCase().includes(q) ||
        sec.description.toLowerCase().includes(q) ||
        sec.keywords.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  return {
    activeSection,
    setActiveSection,
    sidebarCollapsed,
    setSidebarCollapsed,
    searchQuery,
    setSearchQuery,
    filteredSections,
    statusMessage,
    clearStatusMessage: () => setStatusMessage(null),
    goBackToWorkspace: () => setActiveRoute("home"),

    // Data
    account: accountQuery.data ?? null,
    analytics: (analyticsQuery.data as AnalyticsSummaryView | undefined) ?? null,
    analyticsRange,
    setAnalyticsRange,
    analyticsGroupBy,
    setAnalyticsGroupBy,
    providers: providersQuery.data ?? ALL_57_DEFAULT_PROVIDERS,
    models: modelsQuery.data ?? null,
    features: featuresQuery.data?.features ?? null,
    voice: featuresQuery.data?.voice ?? null,
    telemetry: featuresQuery.data?.telemetry ?? null,
    hooksData: hooksQuery.data ?? null,
    runtime: runtimeQuery.data ?? null,
    daemonStatus: daemonQuery.data ?? daemonStatusFromStore,
    shortcuts: shortcutsQuery.data ?? DEFAULT_SHORTCUT_ENTRIES,
    defaultPermissionMode,
    doctorResults,
    selfDevOutput,

    isLoading:
      accountQuery.isPending ||
      providersQuery.isPending ||
      modelsQuery.isPending ||
      featuresQuery.isPending,
    isError:
      accountQuery.isError &&
      providersQuery.isError &&
      modelsQuery.isError,
    refetchAll: () => {
      void accountQuery.refetch();
      void providersQuery.refetch();
      void modelsQuery.refetch();
      void featuresQuery.refetch();
      void hooksQuery.refetch();
      void runtimeQuery.refetch();
      void daemonQuery.refetch();
    },

    // Actions
    refreshAccount: () => refreshAccountMutation.mutateAsync(),
    isRefreshingAccount: refreshAccountMutation.isPending,
    signInBrowser: (mode?: "vscode" | "loopback") =>
      signInBrowserMutation.mutateAsync(mode),
    cancelSignIn: () => cancelSignInMutation.mutateAsync(),
    signInApiKey: (apiKey: string) => signInApiKeyMutation.mutateAsync(apiKey),
    completeCallback: (callbackUrl: string) =>
      completeCallbackMutation.mutateAsync(callbackUrl),
    signOut: () => signOutMutation.mutateAsync(),
    isSigningOut: signOutMutation.isPending,
    setBypassPacing: (enabled: boolean) =>
      bypassPacingMutation.mutateAsync(enabled),
    setProviderApiKey: (input: {
      providerId: string;
      apiKey: string;
      baseUrl?: string;
    }) => setProviderKeyMutation.mutateAsync(input),
    clearProviderApiKey: (providerId: string) =>
      clearProviderKeyMutation.mutateAsync(providerId),
    logoutProvider: (providerId: string) =>
      logoutProviderMutation.mutateAsync(providerId),
    refreshModels: () => refreshModelsMutation.mutateAsync(),
    isRefreshingModels: refreshModelsMutation.isPending,
    setDefaultModel,
    setDefaultEffort,
    setFastTier: (tier: ServiceTier) => setFastTierMutation.mutateAsync(tier),
    setCacheTtl: (ttl: CacheTtl) => setCacheTtlMutation.mutateAsync(ttl),
    setRoleOverride: (input: {
      role: AgentRoleId;
      model: string;
      scope: "session" | "global";
    }) => setRoleOverrideMutation.mutateAsync(input),
    setFeatureFlag: (key: keyof FeatureFlagsView, value: boolean | string) =>
      setFeatureFlagMutation.mutateAsync({ key, value }),
    updateVoice: (patch: {
      enabled?: boolean;
      deviceId?: string;
      noiseSuppression?: boolean;
      autoSendOnSilence?: boolean;
    }) => updateVoiceMutation.mutateAsync(patch),
    setPermissionMode: (mode: PermissionModeId) =>
      setPermissionModeMutation.mutateAsync(mode),
    openHooksConfig: () => openHooksConfigMutation.mutateAsync(),
    pingDaemon: () => pingDaemonMutation.mutateAsync(),
    isPingingDaemon: pingDaemonMutation.isPending,
    reloadDaemonAndBridge: () => reloadDaemonMutation.mutateAsync(),
    isReloadingDaemon: reloadDaemonMutation.isPending,
    reconnectDaemon: () => reconnectDaemonMutation.mutateAsync(),
    openOutputLog: () => openOutputLogMutation.mutateAsync(),
    updateRuntime: (patch: {
      socketPath?: string;
      binaryPath?: string;
      autoStart?: boolean;
      transport?: ProviderTransport;
    }) => updateRuntimeMutation.mutateAsync(patch),
    runDoctor: (scope: "providers" | "auth") =>
      runDoctorMutation.mutateAsync(scope),
    isRunningDoctor: runDoctorMutation.isPending,
    runSelfDev: (action: "status" | "build" | "reload") =>
      runSelfDevMutation.mutateAsync(action),
    isRunningSelfDev: runSelfDevMutation.isPending,
    setTelemetry: (
      category: TelemetryCategory | "all" | "none",
      enabled?: boolean,
    ) => setTelemetryMutation.mutateAsync({ category, enabled }),
    submitFeedback: (input: {
      kind: "bug" | "suggestion" | "usability";
      summary: string;
      details?: string;
    }) => submitFeedbackMutation.mutateAsync(input),
    openKeybindings: () => openKeybindingsMutation.mutateAsync(),
  };
}
