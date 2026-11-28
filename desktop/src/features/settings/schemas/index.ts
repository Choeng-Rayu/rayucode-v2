import { z } from "zod"

import type {
  ConnectionServiceItem,
  KeyboardShortcutGroup,
  PlanLadderTier,
  SettingsSectionMeta,
} from "../types"

export const permissionModeIdSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "fullManage",
  "orchestrator",
])

export const settingsAccountSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(1),
  email: z.string().min(1),
  plan: z.string().min(1),
  ageRange: z.string().min(1),
  builderProfile: z.string().min(1),
  streakDays: z.number().int().nonnegative(),
  sessionsCompleted: z.number().int().nonnegative(),
  kvSavingsPct: z.string().min(1),
})

export const settingsUsageSchema = z.object({
  planName: z.string().min(1),
  monthlyCreditsAllowance: z.number().nonnegative(),
  monthlyCreditsRemaining: z.number().nonnegative(),
  fiveHourCap: z.number().nonnegative(),
  fiveHourLeft: z.number().nonnegative(),
  weeklyCap: z.number().nonnegative(),
  weeklyLeft: z.number().nonnegative(),
  useAllCredits: z.boolean(),
  paygCredits: z.number().nonnegative(),
})

export const settingsPreferencesSchema = z.object({
  notificationsEnabled: z.boolean(),
  voiceModel: z.string().min(1),
  autoCompactContext: z.boolean(),
  showMiniPet: z.boolean(),
  defaultPermissionMode: permissionModeIdSchema,
})

export const settingsStateSchema = z.object({
  account: settingsAccountSchema,
  usage: settingsUsageSchema,
  preferences: settingsPreferencesSchema,
})

export const daemonStatusSchema = z.object({
  connected: z.boolean(),
  reconnecting: z.boolean(),
  socketPath: z.string().min(1),
  version: z.string().min(1),
  latencyMs: z.number().nonnegative(),
})

export const updatePreferencesPatchSchema = settingsPreferencesSchema.partial()

export type ValidatedSettingsState = z.infer<typeof settingsStateSchema>
export type ValidatedDaemonStatus = z.infer<typeof daemonStatusSchema>
export type ValidatedPreferencesPatch = z.infer<
  typeof updatePreferencesPatchSchema
>

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  {
    id: "account",
    label: "Account & Usage",
    group: "Account",
    description: "Profile, plan credits, pacing windows, and KV cache savings",
    keywords: "account profile plan usage billing credits streak kv cache",
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "App",
    description: "Theme mode, brand accent swatches, and reading typography",
    keywords: "appearance theme dark light graphite paper accent green blue font",
  },
  {
    id: "models",
    label: "Models & Inference",
    group: "App",
    description: "Permission defaults, context compaction, and desktop alerts",
    keywords: "models inference permissions ask auto-edit plan compact notifications",
  },
  {
    id: "voice",
    label: "Voice & Audio",
    group: "App",
    description: "Voice model, microphone dictation, and spoken playback",
    keywords: "voice audio microphone dictation tts stt",
  },
  {
    id: "connections",
    label: "Connections & Daemon",
    group: "System",
    description: "Local Rust rayu daemon diagnostics, MCP servers, and OAuth",
    keywords: "connections daemon socket ping latency github telegram mcp",
  },
  {
    id: "shortcuts",
    label: "Keyboard Shortcuts",
    group: "System",
    description: "Fast navigation, composer, and permission mode bindings",
    keywords: "keyboard shortcuts hotkeys keybindings sidebar palette",
  },
] as const

export const PERMISSION_MODE_OPTIONS = [
  {
    value: "default",
    label: "Ask",
    description: "Ask before running tools that change anything.",
  },
  {
    value: "acceptEdits",
    label: "Auto-edit",
    description: "Apply file edits without asking. Still asks for commands.",
  },
  {
    value: "plan",
    label: "Plan",
    description: "Investigate and write a plan without modifying files.",
  },
  {
    value: "fullManage",
    label: "Full Manage",
    description: "Run all non-interactive tools without asking.",
  },
  {
    value: "orchestrator",
    label: "Orchestrator",
    description: "Full access for delegated workers; main agent coordinates.",
  },
] as const

export const DEFAULT_MODEL_OPTIONS = [
  "choeng-rayu-1 · Medium",
  "choeng-rayu-1 · High",
  "choeng-rayu-1-mini · Fast",
  "Claude Opus 5.5",
  "Claude Sonnet 5",
] as const

export const KV_CACHE_TTL_OPTIONS = ["5m TTL", "1h TTL (warm)"] as const

export const VOICE_MODEL_OPTIONS = [
  "Rayu Natural Voice",
  "Breeze · Calm",
  "Ember · Warm",
  "Juniper · Crisp",
] as const

export const MICROPHONE_OPTIONS = [
  "MacBook Pro Microphone (Default)",
  "AirPods Pro",
  "USB Studio Mic",
] as const

export const CODE_FONT_OPTIONS = [
  "JetBrains Mono",
  "SF Mono",
  "Berkeley Mono",
] as const

export const PLAN_LADDER_TIERS: readonly PlanLadderTier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    summary: "BYOK only (30+ providers) · 50 turns/day · Full CLI & MCP tools",
  },
  {
    id: "basic",
    name: "Basic",
    price: "$3/mo",
    summary:
      "15,000 cr/mo · 3,750/wk · Hosted models, Orchestrator, Telegram, OCR/Audio",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$10/mo",
    summary: "50,000 cr/mo · 12,500/wk · Unlocks Hosted API access + Basic",
  },
  {
    id: "plus",
    name: "Plus · Current",
    price: "$20/mo",
    summary:
      "115,000 cr/mo · 28,750/wk · 1,437 cr/5h · Full hosted catalog & API",
    isCurrent: true,
  },
  {
    id: "max",
    name: "Max",
    price: "$50/mo",
    summary: "300,000 cr/mo · 75,000/wk · 3,750 cr/5h · Largest personal tier",
  },
  {
    id: "team",
    name: "Team",
    price: "$10/mo",
    summary: "30,000 shared cr · Unlimited seats · 7,500/member wk",
  },
  {
    id: "team-plus",
    name: "Team Plus",
    price: "$29/mo",
    summary: "100,000 shared cr · Unlimited seats · 25,000/member wk",
  },
  {
    id: "team-max",
    name: "Team Max",
    price: "$79/mo",
    summary: "400,000 shared cr · Unlimited seats · 100,000/member wk",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    summary: "Negotiated credits, custom pacing, dedicated SLA & all features",
  },
] as const

export const CONNECTION_SERVICES: readonly ConnectionServiceItem[] = [
  {
    id: "github",
    name: "GitHub",
    description: "48 tools · PRs, branches, and Actions logs",
    status: "connected",
    statusLabel: "Connected",
    actionLabel: "Reconnect",
  },
  {
    id: "telegram",
    name: "Telegram Bot",
    description: "Remote approvals & session alerts via @rayucode_bot",
    status: "linked",
    statusLabel: "Linked",
  },
  {
    id: "gateway",
    name: "Rayu Gateway",
    description: "14 tools · Model routing, telemetry & cache stats",
    status: "active",
    statusLabel: "Active",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Sync issues and sprint context into prompts",
    status: "disconnected",
    statusLabel: "Not connected",
    actionLabel: "Connect",
  },
] as const

export const KEYBOARD_SHORTCUT_GROUPS: readonly KeyboardShortcutGroup[] = [
  {
    id: "global",
    title: "Global & navigation",
    items: [
      {
        id: "toggle-sidebar",
        label: "Toggle sidebar",
        description: "Show or collapse the workspace navigation pane",
        keys: ["⇧", "⌘", "S"],
      },
      {
        id: "open-settings",
        label: "Toggle Settings",
        description: "Jump straight to full-page settings",
        keys: ["⌘", ","],
      },
      {
        id: "toggle-terminal",
        label: "Toggle embedded terminal",
        description: "Show or hide the terminal panel in the inspector",
        keys: ["⌘", "J"],
      },
      {
        id: "toggle-side-chat",
        label: "Toggle Side chat drawer",
        description: "Open the quick side question drawer without leaving chat",
        keys: ["⌘", ";"],
      },
      {
        id: "nav-back",
        label: "Navigate back",
        description: "Step backward in session and route history",
        keys: ["⌘", "["],
      },
      {
        id: "nav-forward",
        label: "Navigate forward",
        description: "Step forward in session and route history",
        keys: ["⌘", "]"],
      },
    ],
  },
  {
    id: "composer",
    title: "Composer & permissions",
    items: [
      {
        id: "cycle-permission",
        label: "Cycle permission mode",
        description:
          "Rotate Ask, Auto-edit, Plan, Full Manage, and Orchestrator",
        keys: ["⇧", "Tab"],
      },
      {
        id: "send-prompt",
        label: "Send prompt",
        description: "Submit the active message to the Rayu daemon",
        keys: ["⌘", "Enter"],
      },
      {
        id: "new-line",
        label: "Insert new line",
        description: "Add a newline inside the floating composer",
        keys: ["⇧", "Enter"],
      },
    ],
  },
] as const
