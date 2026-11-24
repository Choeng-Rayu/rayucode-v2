// Comprehensive typed IPC client with Live Electron + RayuCode Harness SDK wiring
// Shared contract between Electron window.rayu.*, Vite browser preview, and Vitest

import { findMcpBlueprint, REAL_MCP_BLUEPRINTS } from "./mcp-registry"

import {
  mapHistoryMessagesToTurns,
  mapModelRoutesToOptions,
  mapSessionInfoToSummary,
  type HarnessHistoryMessageLike,
  type HarnessModelRouteLike,
  type HarnessSessionInfoLike,
} from "./harness-adapter"

export type ReasoningEffort = "Auto" | "Low" | "Medium" | "High" | "Max"
export type PermissionModeId =
  | "default"
  | "acceptEdits"
  | "plan"
  | "fullManage"
  | "orchestrator"

export interface SessionSummary {
  id: string
  title: string
  project: string
  checkout: string
  branch: string
  updatedAt: string
  modelId: string
  modelLabel: string
  effort: ReasoningEffort
  permissionMode: PermissionModeId
  kvWarmPct: number
  creditsUsed: number
}

export interface ProjectGroup {
  id: string
  name: string
  path: string
  expanded: boolean
  sessions: Array<{ id: string; title: string; route?: string }>
}

export type ProjectIconColor =
  | "folder"
  | "brand"
  | "info"
  | "type"
  | "num"
  | "danger"

export interface SidebarProjectMeta {
  id: string
  name: string
  folders: string[]
  iconKind: "icon" | "emoji"
  iconValue: string
  iconColor: ProjectIconColor
  pinned?: boolean
  sectionId?: string | null
  gitRemote?: string
  updatedAt: number
}

export interface SidebarSectionItem {
  id: string
  name: string
  collapsed?: boolean
}

export interface SidebarState {
  projects: SidebarProjectMeta[]
  sections: SidebarSectionItem[]
  pinnedChatIds: string[]
  archivedChatIds: string[]
  organizeBy: "project" | "connection" | "flat"
  sortBy: "updated" | "manual"
  showProjectChatsInRecents: boolean
  manualProjectOrder: string[]
}

export interface GettingStartedItem {
  id: string
  label: string
  completed: boolean
  badge?:
    | "claude"
    | "notifications"
    | "daily"
    | "github"
    | "linear"
    | "gdrive"
    | "telegram"
    | "browser"
    | "sheet"
    | "markdown"
    | "swarm"
}

export interface ModelOption {
  id: string
  label: string
  subtitle?: string
  provider: string
  recommended?: boolean
}

export interface PermissionModeOption {
  id: PermissionModeId
  label: string
  description: string
  isDefault?: boolean
  iconName: "lock" | "shield-outline" | "eye" | "shield-alert" | "swarm"
}

export interface ShellCommandStep {
  id: string
  kind: "command"
  command: string
  displayCommand: string
  output: string
  exitCode: number
  statusLabel: string
  isFailed?: boolean
  isMono?: boolean
}

export interface FileReadStep {
  id: string
  kind: "read"
  label: string
  files: Array<{ file: string; path: string; line: number; rangeLabel: string }>
}

export interface ListStep {
  id: string
  kind: "list" | "search" | "previews"
  text: string
  highlight?: string
  previews?: Array<{
    id: string
    kind: "browser" | "excel" | "markdown" | "slide"
    badge: string
    label: string
    pillLabel: string
  }>
}

export type TraceStepItem = ShellCommandStep | FileReadStep | ListStep

export interface TraceGroup {
  id: string
  title: string
  steps: TraceStepItem[]
}

export type TraceTimelineItem =
  | { type: "note"; id: string; text: string }
  | { type: "group"; group: TraceGroup }

export interface TurnOutputArtifact {
  kind: "slide" | "excel" | "markdown"
  title: string
  subtitle: string
  pillLabel: string
}

export interface InlineDiffHunkLine {
  lineNumber: number | null
  type: "hunk" | "ctx" | "add" | "del"
  mark: string
  content: string
}

export interface InlineDiffCardData {
  id: string
  file: string
  additions: number
  deletions: number
  ownerBadge?: string
  hint: string
  accepted?: boolean
  rejected?: boolean
  lines: InlineDiffHunkLine[]
}

export interface GitCommitSummary {
  hash: string
  message: string
  author: string
  relativeTime: string
}

export interface PromptImageAttachment {
  name: string
  mediaType: string
  dataUrl: string
}

export function parseImageDataUrl(
  dataUrl: string
): [string, string] | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  const mediaType = match[1].trim().toLowerCase()
  const base64 = match[2].trim()
  if (!mediaType || !base64) return null
  return [mediaType, base64]
}

export interface ExecutionTurn {
  id: string
  sessionId: string
  compactedNotice?: string
  userRefFiles?: string
  userImages?: PromptImageAttachment[]
  userPrompt: string
  userMeta?: string
  workedDuration: string
  isLive?: boolean
  notes: string[]
  groups: TraceGroup[]
  timeline?: TraceTimelineItem[]
  activeToolStatus?: string | null
  outputArtifact?: TurnOutputArtifact
  answerIntro: string
  answerSummaryTitle?: string
  answerBullets: Array<{
    id: string
    title: string
    body: string
    citations: Array<{
      label: string
      kind: "code" | "excel" | "markdown" | "browser" | "slide"
      file: string
      line?: number
    }>
  }>
  diffCard: InlineDiffCardData
  timestamp: string
  credits: string
  kvCachePct: number
  pinned?: boolean
}

export interface ContextDetailBreakdown {
  id: string
  label: string
  tokensLabel: string
  pctLabel: string
  colorClass: string
  dotted?: boolean
  items?: Array<{ key: string; tokens: string }>
}

export interface InspectorState {
  environment: {
    host: string
    project: string
    path: string
    branch: string
  }
  context: {
    usedPctLabel: string
    tokensSummary: string
    rows: ContextDetailBreakdown[]
    bufferRow: ContextDetailBreakdown
    freeRow: ContextDetailBreakdown
    disclosures: Array<{
      id: string
      label: string
      count: number
      items: string[]
    }>
  }
  connectors: Array<{
    id: string
    glyph: string
    name: string
    status?: "Reconnect" | "Linked"
    primary: boolean
  }>
  outputs: Array<{
    id: string
    kind: "browser" | "markdown" | "excel" | "slide"
    label: string
    pillLabel: string
  }>
  changesSummary: {
    additions: number
    deletions: number
    changedFilesCount: number
  }
  codeFiles: Record<
    string,
    {
      pill: string
      path: string
      language: string
      startLine: number
      lines: string[]
    }
  >
  terminalLines: Array<{
    id: string
    prompt?: string
    command?: string
    output?: string
    isOk?: boolean
  }>
}

export interface ExcelCell {
  ref: string
  raw: string
  formula?: string
  computed: string | number
  isNumeric?: boolean
  isTotal?: boolean
}

export interface OfficeExcelRowData {
  rowNumber: number
  cells: Record<string, string | number>
  formulas?: Record<string, string>
  formats?: Record<string, "currency" | "percent" | "number" | "text">
  isHeader?: boolean
  isTotal?: boolean
}

export interface OfficeExcelSheetPayload {
  id: string
  name: string
  columns: string[]
  headers: Record<string, string>
  rows: OfficeExcelRowData[]
}

export interface OfficeExcelWorkbookData {
  fileName: string
  filePath: string
  sheets: OfficeExcelSheetPayload[]
}

export type OfficeExcelWorkbookPayload = OfficeExcelWorkbookData

export type DesktopArtifactEvent =
  | {
      kind: "slide"
      sessionId?: string
      title: string
      filePath: string
      slides: Array<{
        id?: string
        kicker?: string
        title: string
        subtitle?: string
        body: string
        bullets?: string[]
        metrics?: Array<{ label: string; value: string; note?: string }>
        notes?: string
        layout?: "cover" | "scorecard" | "bullets"
      }>
    }
  | {
      kind: "excel"
      sessionId?: string
      workbook: OfficeExcelWorkbookPayload
    }

export interface ExcelSheetData {
  id: string
  name: string
  columns: string[]
  rows: Array<{
    rowNumber: number
    isTotal?: boolean
    cells: Record<string, string | number>
    formulas?: Record<string, string>
  }>
}

export interface PreviewsState {
  browser: {
    url: string
    title: string
    zoom: number
    deviceMode: "desktop" | "mobile"
    kpis: Array<{ label: string; value: string; delta: string }>
    chatMessages: Array<{ id: string; sender: "user" | "agent"; text: string }>
  }
  excel: {
    fileName: string
    filePath: string
    activeSheetId: string
    selectedCellRef: string
    selectedFormula: string
    liveWebUrl: string
    sheets: ExcelSheetData[]
  }
  markdown: {
    fileName: string
    filePath: string
    rawContent: string
    sections: Array<{ id: string; title: string }>
  }
}

export interface SwarmAgent {
  id: string
  name: string
  role: string
  worktree: string
  state: "coordinating" | "running" | "completed" | "paused" | "stopped"
  task: string
  model: string
  laneProgressLabel: string
  duration: string
  reportsTo?: string
  todoLane: Array<{ id: string; text: string; status: "done" | "now" | "pending" }>
  commands: ShellCommandStep[]
  readFiles?: string[]
  note?: string
}

export interface SwarmBoardMessage {
  id: string
  time: string
  from: string
  to: string
  text: string
  tag: string
  isOk?: boolean
}

export interface SwarmPlanScope {
  id: string
  scopeLabel: string
  ownerRoute: string
  description: string
  statusTag: string
  isOk?: boolean
}

export interface SwarmWorktree {
  id: string
  label: string
  branch: string
  owner: string
  file: string
  additions: number
  deletions: number
}

export interface SwarmState {
  swarmId: string
  title: string
  planVersion: string
  credits: string
  kvCachePct: number
  agents: SwarmAgent[]
  messages: SwarmBoardMessage[]
  planScopes: SwarmPlanScope[]
  worktrees: SwarmWorktree[]
}

export interface OvernightRun {
  id: string
  title: string
  status: "Running" | "Completed" | "Cancelled"
  host: string
  maxAgents: string
  duration: string
  wakeTime: string
  handoffTime: string
  taskCardsCount: number
  validationsGreen: number
  eventLog: string[]
}

export interface AutomationSchedule {
  id: string
  title: string
  modeBadge: "Plan" | "Auto-edit" | "Full Manage"
  cronSummary: string
  repo: string
  description: string
  enabled: boolean
}

export interface MorningHandoffReport {
  id: string
  title: string
  status: "Completed"
  timestamp: string
  testsSummary: string
  credits: string
  kvWarmPct: number
  actionLabel: string
  targetRoute: "changes" | "workspace"
}

export interface AutomationsState {
  running: OvernightRun[]
  schedules: AutomationSchedule[]
  reports: MorningHandoffReport[]
}

export interface PluginCatalogItem {
  id: string
  name: string
  description: string
  category: "featured" | "popular" | "noteworthy" | "business"
  heroDescription?: string
  installed: boolean
  infoOnly?: boolean
  infoToast?: string
  searchKeywords: string
  mcpServerId?: string
  sourcePath?: string
  scope?: "global" | "workspace"
  transport?: "stdio" | "url"
  command?: string
  args?: string[]
  url?: string
  envKeys?: string[]
  isCustomMcp?: boolean
}

export interface SkillItem {
  id: string
  name: string
  scope: string
  tokens: string
  description: string
  enabled: boolean
}

export interface MemoryFileItem {
  id: string
  path: string
  tokens: string
  updatedAt: string
  preview: string
}

export interface PluginsState {
  featuredId: string
  plugins: PluginCatalogItem[]
  skills: SkillItem[]
  memories: MemoryFileItem[]
}

export interface ChangedFileDiff {
  id: string
  path: string
  additions: number
  deletions: number
  deleted?: boolean
  ownerBadge: string
  hint: string
  accepted?: boolean
  rejected?: boolean
  staged?: boolean
  lines: InlineDiffHunkLine[]
}

export interface ChangesState {
  branch: string
  totalAdditions: number
  totalDeletions: number
  files: ChangedFileDiff[]
}

export type FileChangeKind = "created" | "modified" | "deleted" | "renamed"
export type FileChangeStatus = "pending" | "kept" | "undone"
export type FileChangeActionKind =
  | "keep"
  | "undo"
  | "redo"
  | "keep_all"
  | "undo_all"
  | "redo_all"

export interface FileChangeHunk {
  old_start: number
  old_lines: number
  new_start: number
  new_lines: number
  header: string
  lines: string[]
}

export interface FileChangeEntrySummary {
  path: string
  display_path: string
  old_path?: string
  kind: FileChangeKind
  status: FileChangeStatus
  additions: number
  deletions: number
  changed_in_latest_turn: boolean
  turn_id: number
  edit_count: number
  is_binary: boolean
  undoable: boolean
  can_redo: boolean
  preview_hunks?: FileChangeHunk[]
  preview_truncated?: boolean
  updated_at_ms: number
}

export interface FileChangesSnapshot {
  session_id: string
  latest_turn_id: number
  total_pending_files: number
  total_additions: number
  total_deletions: number
  files: FileChangeEntrySummary[]
}

export interface FileChangeDiffPayload {
  path: string
  display_path: string
  old_path?: string
  kind: FileChangeKind
  status: FileChangeStatus
  additions: number
  deletions: number
  is_binary: boolean
  original_content: string
  modified_content: string
  unified_diff: string
  hunks: FileChangeHunk[]
}

export interface FileChangeConflict {
  path: string
  display_path: string
  reason: string
}

export interface FileChangeActionResponse {
  ok: boolean
  message: string
  conflicts: FileChangeConflict[]
  snapshot: FileChangesSnapshot
}

export interface TelegramApprovalItem {
  id: string
  toolBadge: string
  commandOrSummary: string
  requestedBy: string
  timeAgo: string
  status: "pending" | "approved" | "denied"
}

export interface TelegramState {
  mode: "connected" | "hosted" | "byo"
  connectedBotHandle: string
  chatId: string
  drivingSession: string
  mediaDelivery: string
  authPath: string
  pairingCommand: string
  pairingLink: string
  remoteUninstallEnabled: boolean
  approvals: TelegramApprovalItem[]
  commands: Array<{ command: string; description: string }>
}

export interface SettingsState {
  account: {
    name: string
    username: string
    email: string
    plan: string
    ageRange: string
    builderProfile: string
    streakDays: number
    sessionsCompleted: number
    kvSavingsPct: string
  }
  usage: {
    planName: string
    monthlyCreditsAllowance: number
    monthlyCreditsRemaining: number
    fiveHourCap: number
    fiveHourLeft: number
    weeklyCap: number
    weeklyLeft: number
    useAllCredits: boolean
    paygCredits: number
  }
  preferences: {
    notificationsEnabled: boolean
    voiceModel: string
    autoCompactContext: boolean
    showMiniPet: boolean
    defaultPermissionMode: PermissionModeId
  }
}

export interface DaemonStatus {
  connected: boolean
  reconnecting: boolean
  socketPath: string
  version: string
  latencyMs: number
  lastError?: string | null
}

// ============================================================================
// Realistic Prototype Mock State (1:1 with prototype/*.html & prototype/js/app.js)
// ============================================================================

const MOCK_MODELS: ModelOption[] = [
  {
    id: "default",
    label: "Default",
    subtitle: "Recommended set of models",
    provider: "rayu",
    recommended: true,
  },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "openai" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "openai" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai" },
  { id: "gpt-5.6-pro", label: "GPT-5.6 Pro", provider: "openai" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "google" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "google" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek" },
  { id: "kimi-k2.5", label: "Kimi K2.5", provider: "moonshot" },
  { id: "gpt-oss-120b", label: "GPT-OSS 120B", provider: "openrouter" },
  { id: "minimax-m2.7", label: "MiniMax M2.7", provider: "minimax" },
  { id: "GLM-5.1", label: "GLM-5.1", provider: "zhipu" },
]

const MOCK_PERMISSION_MODES: PermissionModeOption[] = [
  {
    id: "default",
    label: "Ask",
    description: "Ask before running tools that change anything.",
    isDefault: true,
    iconName: "lock",
  },
  {
    id: "acceptEdits",
    label: "Auto-edit",
    description: "Apply file edits without asking. Still asks for commands.",
    iconName: "shield-outline",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Investigate and write a plan without asking. Never changes your code.",
    iconName: "eye",
  },
  {
    id: "fullManage",
    label: "Full Manage",
    description: "Run all non-interactive tools without asking.",
    iconName: "shield-alert",
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    description: "Full access for delegated workers; the main agent only coordinates.",
    iconName: "swarm",
  },
]

let mockSessions: SessionSummary[] = [
  {
    id: "ses_retire_cache",
    title: "Retire legacy session cache",
    project: "rayucode-v2",
    checkout: "Local Checkout",
    branch: "feat/retire-session-cache",
    updatedAt: "2m ago",
    modelId: "claude-opus-5-5",
    modelLabel: "Claude Opus 5.5",
    effort: "Medium",
    permissionMode: "default",
    kvWarmPct: 94,
    creditsUsed: 0.42,
  },
  {
    id: "ses_model_picker",
    title: "VS Code: model picker refresh",
    project: "rayucode-v2",
    checkout: "Local Checkout",
    branch: "main",
    updatedAt: "18m ago",
    modelId: "claude-sonnet-5",
    modelLabel: "Claude Sonnet 5",
    effort: "Medium",
    permissionMode: "acceptEdits",
    kvWarmPct: 91,
    creditsUsed: 0.28,
  },
  {
    id: "ses_q4_excel",
    title: "Q4 token cost spreadsheet",
    project: "specs-and-docs",
    checkout: "Local Checkout",
    branch: "main",
    updatedAt: "1h ago",
    modelId: "claude-opus-5-5",
    modelLabel: "Claude Opus 5.5",
    effort: "Medium",
    permissionMode: "acceptEdits",
    kvWarmPct: 95,
    creditsUsed: 0.14,
  },
]

const MOCK_PROJECTS: ProjectGroup[] = [
  {
    id: "proj_rayucode",
    name: "rayucode-v2",
    path: "~/workspace/rayu/rayucode-v2",
    expanded: true,
    sessions: [
      { id: "ses_retire_cache", title: "Retire legacy session cache" },
      { id: "ses_model_picker", title: "VS Code: model picker refresh" },
    ],
  },
  {
    id: "proj_rayu_web",
    name: "rayu-web",
    path: "~/workspace/rayu/rayu-web",
    expanded: false,
    sessions: [{ id: "ses_credits_dash", title: "Credits usage dashboard" }],
  },
  {
    id: "proj_specs",
    name: "specs-and-docs",
    path: "~/workspace/rayu/specs-and-docs",
    expanded: false,
    sessions: [
      { id: "ses_q4_excel", title: "Q4 token cost spreadsheet" },
      { id: "ses_migration_md", title: "Desktop v1 migration plan MD" },
    ],
  },
]

const MOCK_RECENTS: Array<{ id: string; title: string; route?: string }> = [
  { id: "ses_retire_cache", title: "Retire legacy session cache" },
  { id: "ses_model_picker", title: "VS Code: model picker refresh" },
  { id: "ses_gateway_retry", title: "Gateway: retry budget tests", route: "swarm" },
  { id: "ses_credits_dash", title: "Credits usage dashboard preview" },
  { id: "ses_q4_excel", title: "Q4 token cost spreadsheet model" },
  { id: "ses_migration_md", title: "Desktop v1 migration plan MD" },
]

const GETTING_STARTED_STORAGE_KEY = "rayu-getting-started-completed-v2"

const DEFAULT_GETTING_STARTED_ITEMS: GettingStartedItem[] = [
  { id: "gs_import_ai", label: "Import from Claude", completed: false, badge: "claude" },
  { id: "gs_notify", label: "Enable notifications", completed: false, badge: "notifications" },
  { id: "gs_daily", label: "Set up a daily update", completed: false, badge: "daily" },
  { id: "gs_github", label: "Triage GitHub PRs", completed: false, badge: "github" },
  { id: "gs_linear", label: "Catch me up on Linear", completed: false, badge: "linear" },
  {
    id: "gs_decisions",
    label: "Review the latest project decisions",
    completed: false,
    badge: "gdrive",
  },
]

function loadGettingStartedItems(): GettingStartedItem[] {
  if (typeof window === "undefined") {
    return DEFAULT_GETTING_STARTED_ITEMS.map((item) => ({ ...item }))
  }
  try {
    const raw = window.localStorage.getItem(GETTING_STARTED_STORAGE_KEY)
    if (!raw) return DEFAULT_GETTING_STARTED_ITEMS.map((item) => ({ ...item }))
    const doneIds = new Set<string>(JSON.parse(raw) as string[])
    return DEFAULT_GETTING_STARTED_ITEMS.map((item) => ({
      ...item,
      completed: doneIds.has(item.id),
    }))
  } catch {
    return DEFAULT_GETTING_STARTED_ITEMS.map((item) => ({ ...item }))
  }
}

function persistGettingStartedItems(items: GettingStartedItem[]): void {
  if (typeof window === "undefined") return
  try {
    const doneIds = items.filter((i) => i.completed).map((i) => i.id)
    window.localStorage.setItem(
      GETTING_STARTED_STORAGE_KEY,
      JSON.stringify(doneIds)
    )
  } catch {
    // ignore storage errors
  }
}

let mockGettingStarted: GettingStartedItem[] = loadGettingStartedItems()

let mockTurns: ExecutionTurn[] = [
  {
    id: "turn_retire_cache_1",
    sessionId: "ses_retire_cache",
    compactedNotice: "Context automatically compacted",
    userRefFiles: "src/session/cache.rs · src/shard/store.rs",
    userPrompt:
      "Retire SessionCache in src/session/cache.rs and route reads through ShardStore::lookup with the LRU budget preserved. Update the dashboard preview, cost sheet, and MIGRATION_PLAN.md.",
    workedDuration: "1m 25s",
    notes: [
      "I'll audit all SessionCache callers across rayucode-v2 and verify that ShardStore::lookup preserves the existing LRU budget before editing.",
      "Routing through ShardStore::lookup passes all 14 unit tests without data migration. Next I'll verify the localhost dashboard, cost workbook, and migration spec.",
    ],
    groups: [
      {
        id: "wg_1",
        title: "Read files, ran commands",
        steps: [
          {
            id: "sh_cmd_0",
            kind: "command",
            command: "git status --short && rg --files -g 'cache.rs' -g 'store.rs'",
            displayCommand:
              "Command failed (git status --short && rg --files -g 'cache.rs' -g 'store.rs')",
            output:
              "rg: No files were searched, which means ripgrep probably applied a filter you didn't expect.",
            exitCode: 1,
            statusLabel: "Exit 1 · retried with fd/grep",
            isFailed: true,
          },
          {
            id: "rd_1",
            kind: "read",
            label: "Read",
            files: [
              {
                file: "cache.rs",
                path: "src/session/cache.rs",
                line: 1,
                rangeLabel: "src/session/cache.rs:1-6",
              },
              {
                file: "store.rs",
                path: "src/shard/store.rs",
                line: 15,
                rangeLabel: "src/shard/store.rs:14-23",
              },
            ],
          },
          {
            id: "sh_cmd_1",
            kind: "command",
            command: 'grep -rn "SessionCache\\|CacheBudget" crates/rayucode-core/src/session/',
            displayCommand:
              'grep -rn "SessionCache\\|CacheBudget" crates/rayucode-core/src/session/',
            output:
              "crates/rayucode-core/src/session/lookup.rs:19:    self.cache.read().get(key).cloned()\ncrates/rayucode-core/src/session/cache.rs:12:     pub struct SessionCache { ... }\ncrates/rayucode-core/src/session/budget.rs:41:    pub fn touch(&self, key: &SessionKey)",
            exitCode: 0,
            statusLabel: "Success",
            isMono: true,
          },
          {
            id: "sh_cmd_2",
            kind: "command",
            command: "cargo test -p rayucode session:: -- --nocapture",
            displayCommand: "cargo test -p rayucode session:: -- --nocapture",
            output:
              "   Compiling rayucode-core v2.0.0 (/Users/lyyeakkhai/workspace/rayu/rayucode-v2)\nrunning 14 tests\ntest session::lookup::routes_via_shard_store ... ok\ntest session::lookup::touches_lru_budget_on_hit ... ok\ntest session::budget::evicts_oldest_over_cap ... ok\ntest session::store::zero_migration_key_derivation ... ok\ntest result: ok. 14 passed; 0 failed; 0 ignored; finished in 0.48s",
            exitCode: 0,
            statusLabel: "Success",
            isMono: true,
          },
          {
            id: "ls_1",
            kind: "list",
            text: "Listed files in",
            highlight: "docs/specs",
          },
        ],
      },
      {
        id: "wg_2",
        title: "Read files, ran commands",
        steps: [
          {
            id: "sh_cmd_3",
            kind: "command",
            command: "git diff --stat src/session/lookup.rs docs/MIGRATION_PLAN.md",
            displayCommand: "git diff --stat src/session/lookup.rs docs/MIGRATION_PLAN.md",
            output:
              " src/session/lookup.rs   | 19 +++++++-----\n src/session/cache.rs    | 48 ------------------------------\n docs/MIGRATION_PLAN.md  | 14 ++++++++-\n 3 files changed, 26 insertions(+), 55 deletions(-)",
            exitCode: 0,
            statusLabel: "Success",
            isMono: true,
          },
          {
            id: "rd_2",
            kind: "read",
            label: "Read",
            files: [
              {
                file: "MIGRATION_PLAN.md",
                path: "MIGRATION_PLAN.md",
                line: 1,
                rangeLabel: "MIGRATION_PLAN.md",
              },
            ],
          },
          {
            id: "pv_1",
            kind: "previews",
            text: "Viewed 3 previews",
            previews: [
              {
                id: "thumb_browser",
                kind: "browser",
                badge: ":3000",
                label: "Dashboard UI",
                pillLabel: "localhost:3000",
              },
              {
                id: "thumb_excel",
                kind: "excel",
                badge: ".xlsx",
                label: "Token-Cost-Model",
                pillLabel: "Q4-Token-Cost-Model.xlsx",
              },
              {
                id: "thumb_md",
                kind: "markdown",
                badge: ".md",
                label: "MIGRATION_PLAN",
                pillLabel: "MIGRATION_PLAN.md",
              },
            ],
          },
        ],
      },
    ],
    answerIntro:
      "Done — safe to ship without data migration. All session reads now route through ShardStore::lookup with CacheBudget preserved, and all 14/14 tests in session:: pass. Swarm worker-1 also confirmed zero conflicting gateway edits.",
    answerSummaryTitle: "Summary of changes",
    answerBullets: [
      {
        id: "b1",
        title: "Routed reads through ShardStore.",
        body: "Replaced self.cache.read().get(key) with self.shards.lookup(key)? and touched self.budget.touch(key) on every hit so eviction order matches the CLI daemon byte for byte.",
        citations: [
          {
            label: "lookup.rs (line 21)",
            kind: "code",
            file: "lookup.rs",
            line: 21,
          },
        ],
      },
      {
        id: "b2",
        title: "Removed dead cache path.",
        body: "Deleted 48 lines of legacy SessionCache locking in src/session/cache.rs and confirmed zero remaining references across crates/rayucode-core.",
        citations: [
          { label: "cache.rs", kind: "code", file: "cache.rs", line: 5 },
          { label: "store.rs (line 15)", kind: "code", file: "store.rs", line: 15 },
        ],
      },
      {
        id: "b3",
        title: "Synced previews & cost model.",
        body: "Refreshed the localhost dashboard preview, Token-Cost-Model.xlsx, and MIGRATION_PLAN.md in the right sidebar.",
        citations: [
          { label: "localhost:3000", kind: "browser", file: "localhost:3000" },
          {
            label: "Token-Cost-Model.xlsx",
            kind: "excel",
            file: "Q4-Token-Cost-Model.xlsx",
          },
        ],
      },
    ],
    diffCard: {
      id: "diff_lookup_rs",
      file: "src/session/lookup.rs",
      additions: 12,
      deletions: 7,
      hint: "1 of 3 changed files · 14/14 tests passed",
      lines: [
        {
          lineNumber: null,
          type: "hunk",
          mark: "",
          content: "@@ -18,14 +18,19 @@ impl SessionLookup {",
        },
        {
          lineNumber: 18,
          type: "ctx",
          mark: "",
          content: "     pub fn get(&self, key: &SessionKey) -> Option<Session> {",
        },
        {
          lineNumber: 19,
          type: "del",
          mark: "−",
          content: "         self.cache.read().get(key).cloned()",
        },
        {
          lineNumber: 19,
          type: "add",
          mark: "+",
          content: "         let hit = self.shards.lookup(key)?;",
        },
        {
          lineNumber: 20,
          type: "add",
          mark: "+",
          content: "         self.budget.touch(key);",
        },
        {
          lineNumber: 21,
          type: "add",
          mark: "+",
          content: "         Some(hit)",
        },
        {
          lineNumber: 22,
          type: "ctx",
          mark: "",
          content: "     }",
        },
      ],
    },
    timestamp: "2m ago",
    credits: "0.42 cr",
    kvCachePct: 94,
    pinned: false,
  },
]

const MOCK_INSPECTOR: InspectorState = {
  environment: {
    host: "This computer",
    project: "rayucode-v2",
    path: "~/workspace/rayu",
    branch: "feat/retire-session-cache",
  },
  context: {
    usedPctLabel: "6% used",
    tokensSummary: "55.5K / 1M",
    rows: [
      {
        id: "messages",
        label: "Messages",
        tokensLabel: "38.6K",
        pctLabel: "3.9%",
        colorClass: "bg-info",
      },
      {
        id: "skills",
        label: "Skills",
        tokensLabel: "10K",
        pctLabel: "1.0%",
        colorClass: "bg-warn",
        dotted: true,
        items: [
          { key: "impeccable", tokens: "4.2K" },
          { key: "systematic-debugging", tokens: "2.6K" },
          { key: "test-driven-development", tokens: "1.9K" },
          { key: "verification-before-completion", tokens: "1.3K" },
        ],
      },
      {
        id: "system",
        label: "System prompt",
        tokensLabel: "6.7K",
        pctLabel: "0.7%",
        colorClass: "bg-brand",
      },
      {
        id: "mcp",
        label: "MCP server instructions",
        tokensLabel: "700",
        pctLabel: "0.1%",
        colorClass: "bg-pill-done-fg",
        dotted: true,
        items: [
          { key: "chrome-devtools", tokens: "280" },
          { key: "context7", tokens: "240" },
          { key: "github", tokens: "180" },
        ],
      },
      {
        id: "memory",
        label: "Memory files",
        tokensLabel: "353",
        pctLabel: "0.0%",
        colorClass: "bg-muted-ink",
        dotted: true,
        items: [
          { key: "~/.rayu/memory/rayucode-v2.md", tokens: "214" },
          { key: "~/.rayu/memory/shard-store.md", tokens: "139" },
        ],
      },
      {
        id: "agents",
        label: "Custom agents",
        tokensLabel: "132",
        pctLabel: "0.0%",
        colorClass: "bg-muted-ink",
        dotted: true,
        items: [
          { key: "coordinator · Claude Opus 5.5", tokens: "42" },
          { key: "worker-1 · Claude Sonnet 5", tokens: "34" },
          { key: "reviewer · GPT-6.1 Sol", tokens: "30" },
          { key: "verifier · DeepSeek V4 Flash", tokens: "26" },
        ],
      },
    ],
    bufferRow: {
      id: "buffer",
      label: "Autocompact buffer",
      tokensLabel: "33K",
      pctLabel: "3.3%",
      colorClass: "bg-faint",
    },
    freeRow: {
      id: "free",
      label: "Free space",
      tokensLabel: "910.5K",
      pctLabel: "91.0%",
      colorClass: "bg-active",
    },
    disclosures: [
      {
        id: "disc-mcp",
        label: "MCP tools",
        count: 190,
        items: [
          "chrome-devtools · 26",
          "github · 48",
          "rayu-gateway · 14",
          "local-preview · 102",
        ],
      },
      {
        id: "disc-mem",
        label: "Memory files",
        count: 2,
        items: [
          "~/.rayu/memory/rayucode-v2.md",
          "~/.rayu/memory/shard-store.md",
        ],
      },
      {
        id: "disc-agents",
        label: "Custom agents",
        count: 4,
        items: [
          "coordinator · Claude Opus 5.5",
          "worker-1 · Claude Sonnet 5",
          "reviewer · GPT-6.1 Sol",
          "verifier · DeepSeek V4 Flash",
        ],
      },
    ],
  },
  connectors: [
    { id: "exa", glyph: "E", name: "Exa", primary: true },
    { id: "playwright", glyph: "P", name: "Playwright", primary: true },
    {
      id: "github",
      glyph: "G",
      name: "GitHub",
      status: "Reconnect",
      primary: true,
    },
    {
      id: "telegram",
      glyph: "T",
      name: "Telegram Bot",
      status: "Linked",
      primary: false,
    },
    {
      id: "chrome-devtools",
      glyph: "C",
      name: "Chrome devtools",
      primary: false,
    },
    {
      id: "microsoft-office",
      glyph: "M",
      name: "Microsoft Office",
      status: "Linked",
      primary: false,
    },
  ],
  outputs: [
    {
      id: "out_browser",
      kind: "browser",
      label: "dashboard-preview.html",
      pillLabel: "localhost:3000",
    },
    {
      id: "out_md",
      kind: "markdown",
      label: "MIGRATION_PLAN.md",
      pillLabel: "MIGRATION_PLAN.md",
    },
    {
      id: "out_excel",
      kind: "excel",
      label: "Q4-Token-Cost-Model.xlsx",
      pillLabel: "Q4-Token-Cost-Model.xlsx",
    },
  ],
  changesSummary: {
    additions: 60,
    deletions: 221,
    changedFilesCount: 3,
  },
  codeFiles: {
    "lookup.rs": {
      pill: "lookup.rs",
      path: "crates / rayucode-core / src / session / lookup.rs",
      language: "rust",
      startLine: 10,
      lines: [
        "use crate::session::{CacheBudget, Session, SessionKey};",
        "use crate::shard::ShardStore;",
        "",
        "pub struct SessionLookup {",
        "  shards: ShardStore,",
        "  budget: CacheBudget,",
        "}",
        "",
        "impl SessionLookup {",
        "  pub fn get(&self, key: &SessionKey) -> Option<Session> {",
        "    // Routed directly through ShardStore with LRU touch",
        "    let hit = self.shards.lookup(key)?;",
        "    self.budget.touch(key);",
        "    Some(hit)",
        "  }",
        "",
        "  pub fn evict_over_cap(&self) -> usize {",
        "    self.budget.evict_oldest(&self.shards)",
        "  }",
        "}",
      ],
    },
    "cache.rs": {
      pill: "cache.rs",
      path: "crates / rayucode-core / src / session / cache.rs",
      language: "rust",
      startLine: 1,
      lines: [
        "// Legacy SessionCache retired in favor of ShardStore::lookup.",
        "// 48 lines of RwLock cache state removed; key derivation",
        "// now lives directly in src/shard/store.rs.",
        "",
        "pub use crate::session::lookup::SessionLookup;",
        "pub use crate::session::budget::CacheBudget;",
      ],
    },
    "store.rs": {
      pill: "store.rs",
      path: "crates / rayucode-core / src / shard / store.rs",
      language: "rust",
      startLine: 14,
      lines: [
        "impl ShardStore {",
        "  pub fn lookup(&self, key: &SessionKey) -> Option<Session> {",
        "    let shard_idx = self.shard_for(key);",
        "    self.shards[shard_idx].read().get(key).cloned()",
        "  }",
        "",
        "  fn shard_for(&self, key: &SessionKey) -> usize {",
        "    (key.hash64() as usize) % self.shards.len()",
        "  }",
        "}",
      ],
    },
  },
  terminalLines: [
    {
      id: "t1",
      prompt: "$",
      command: "rayu swarm status",
      output: "  ● 3 agents live · 214 MB RAM",
      isOk: true,
    },
    {
      id: "t2",
      prompt: "$",
      command: "rayu cache stats",
      output: "  KV cache: warm · 94.2% hit",
      isOk: true,
    },
  ],
}

const mockPreviews: PreviewsState = {
  browser: {
    url: "localhost:3000/dashboard",
    title: "localhost:3000",
    zoom: 100,
    deviceMode: "desktop",
    kpis: [
      { label: "Memory RSS", value: "71 MB", delta: "−38% vs legacy" },
      { label: "KV Cache Hit", value: "94.2%", delta: "warm · 1h TTL" },
      { label: "Swarm Workers", value: "3 live", delta: "0 conflicts" },
    ],
    chatMessages: [
      {
        id: "fb_1",
        sender: "agent",
        text: "Inspecting localhost:3000/dashboard in your live local preview: Memory RSS 71 MB across coordinator (< 90 MB target), KV Cache 94.2% warm prefix hit. Ready to accept the ShardStore::lookup diff and retire cache.rs.",
      },
    ],
  },
  excel: {
    fileName: "Q4-Token-Cost-Model.xlsx",
    filePath: "~/workspace/rayu/specs-and-docs/Q4-Token-Cost-Model.xlsx",
    activeSheetId: "sheet_q4",
    selectedCellRef: "C7",
    selectedFormula: "=SUM(C2:C6)",
    liveWebUrl: "",
    sheets: [
      {
        id: "sheet_q4",
        name: "Q4 Cost Model",
        columns: ["A", "B", "C", "D", "E", "F"],
        rows: [
          {
            rowNumber: 1,
            cells: {
              A: "Surface / Route",
              B: "Primary Model",
              C: "Tokens (K)",
              D: "KV Warm %",
              E: "Rate / 1M",
              F: "Net Cost ($)",
            },
          },
          {
            rowNumber: 2,
            cells: {
              A: "Interactive Chat",
              B: "Claude Opus 5.5",
              C: 210,
              D: 94.5,
              E: "$1.20",
              F: 68.2,
            },
          },
          {
            rowNumber: 3,
            cells: {
              A: "Code Edits & Diffs",
              B: "Claude Sonnet 5",
              C: 164,
              D: 93.0,
              E: "$0.60",
              F: 41.5,
            },
          },
          {
            rowNumber: 4,
            cells: {
              A: "Fast Grep / Verify",
              B: "DeepSeek V4 Flash",
              C: 92,
              D: 96.2,
              E: "$0.14",
              F: 9.8,
            },
          },
          {
            rowNumber: 5,
            cells: {
              A: "Swarm Workers (x4)",
              B: "GPT-6.1 Sol",
              C: 88,
              D: 91.3,
              E: "$0.80",
              F: 29.4,
            },
          },
          {
            rowNumber: 6,
            cells: {
              A: "Overnight Soak Runs",
              B: "Claude Sonnet 5",
              C: 60,
              D: 91.0,
              E: "$0.60",
              F: 19.5,
            },
          },
          {
            rowNumber: 7,
            isTotal: true,
            cells: {
              A: "Q4 Total / Avg",
              B: "5 active routes",
              C: 614,
              D: 93.2,
              E: "—",
              F: 168.4,
            },
            formulas: {
              C: "=SUM(C2:C6)",
              D: "=AVERAGE(D2:D6)",
              F: "=SUM(F2:F6)",
            },
          },
        ],
      },
      {
        id: "sheet_cache",
        name: "KV Cache ROI",
        columns: ["A", "B", "C", "D"],
        rows: [
          {
            rowNumber: 1,
            cells: {
              A: "TTL Window",
              B: "Hit Rate %",
              C: "Uncached ($)",
              D: "Cached ($)",
            },
          },
          {
            rowNumber: 2,
            cells: {
              A: "5-minute hot window",
              B: 91.4,
              C: 420.0,
              D: 74.2,
            },
          },
          {
            rowNumber: 3,
            cells: {
              A: "1-hour extended TTL",
              B: 95.0,
              C: 510.0,
              D: 94.2,
            },
          },
        ],
      },
      {
        id: "sheet_swarm",
        name: "Swarm Budgets",
        columns: ["A", "B", "C", "D"],
        rows: [
          {
            rowNumber: 1,
            cells: {
              A: "Worker Role",
              B: "Model",
              C: "Credits",
              D: "Duration (s)",
            },
          },
          {
            rowNumber: 2,
            cells: {
              A: "coordinator",
              B: "Claude Opus 5.5",
              C: 0.34,
              D: 134,
            },
          },
          {
            rowNumber: 3,
            cells: {
              A: "worker-1",
              B: "Claude Sonnet 5",
              C: 0.24,
              D: 48,
            },
          },
          {
            rowNumber: 4,
            cells: {
              A: "worker-2",
              B: "GPT-6.1 Sol",
              C: 0.2,
              D: 34,
            },
          },
          {
            rowNumber: 5,
            cells: {
              A: "verifier",
              B: "DeepSeek V4 Flash",
              C: 0.08,
              D: 19,
            },
          },
        ],
      },
    ],
  },
  markdown: {
    fileName: "MIGRATION_PLAN.md",
    filePath: "~/workspace/rayu/rayucode-v2/docs/MIGRATION_PLAN.md",
    rawContent: `# SessionCache Retirement & ShardStore Migration

Route all session reads through \`ShardStore::lookup\` with \`CacheBudget\` preserved so CLI, VS Code, and Desktop share one lock-free path.

## Verification Checklist
- [x] Route reads through \`ShardStore::lookup\` with \`CacheBudget\`
- [x] Delete legacy \`src/session/cache.rs\` (48 lines removed)
- [x] Verify 14/14 \`session::\` unit tests and −38% RSS reduction

\`\`\`rust
pub fn get(&self, key: &SessionKey) -> Option<Session> {
    let hit = self.shards.lookup(key)?;
    self.budget.touch(key);
    Some(hit)
}
\`\`\`
`,
    sections: [
      { id: "overview", title: "Overview" },
      { id: "checklist", title: "Verification Checklist" },
      { id: "benchmarks", title: "Benchmarks" },
    ],
  },
}

let mockSwarm: SwarmState = {
  swarmId: "swm_a41f",
  title: "Gateway retry & session shards",
  planVersion: "plan v3",
  credits: "0.86 cr",
  kvCachePct: 94,
  agents: [
    {
      id: "coordinator",
      name: "coordinator",
      role: "Root · depth 0",
      worktree: "root",
      state: "coordinating",
      task: "Owns VersionedPlan v3 · waiting on worker-1 & worker-2",
      model: "Claude Opus 5.5",
      laneProgressLabel: "3 scopes",
      duration: "2m 14s",
      todoLane: [
        {
          id: "c1",
          text: "Split work into 2 isolated git worktrees (zero file overlap)",
          status: "done",
        },
        {
          id: "c2",
          text: "Received automatic completion report from verifier (14/14 green)",
          status: "done",
        },
        {
          id: "c3",
          text: "Awaiting worker-1 and worker-2 completion before handing off to Worktree Manager",
          status: "now",
        },
      ],
      commands: [],
      note: "Coordinator holds the single VersionedPlan slot and never performs git merges directly; worktree managers integrate once all scopes are verified.",
    },
    {
      id: "worker-1",
      name: "worker-1",
      role: "wt/retry-budget",
      worktree: "wt/retry-budget",
      state: "running",
      task: "Fix streaming_midflight_retry_dedup in src/retry/stream.rs",
      model: "Claude Sonnet 5",
      laneProgressLabel: "2 / 3 lane items",
      duration: "48s",
      reportsTo: "coordinator",
      readFiles: ["src/retry/stream.rs:42-118"],
      todoLane: [
        {
          id: "w1_1",
          text: "Reproduce mid-flight retry dedup failure in retry_budget tests",
          status: "done",
        },
        {
          id: "w1_2",
          text: "Guard duplicate attempt key in src/retry/stream.rs",
          status: "done",
        },
        {
          id: "w1_3",
          text: "Re-run cargo test -p rayu-gateway retry_budget and forward output",
          status: "now",
        },
      ],
      commands: [
        {
          id: "sw_sh_w1_1",
          kind: "command",
          command: "cargo test -p rayu-gateway retry_budget",
          displayCommand: "cargo test -p rayu-gateway retry_budget (first run)",
          output:
            "test retry::budget::tests::streaming_midflight_retry_dedup ... FAILED\nassertion `left == right` failed: left: 2, right: 1",
          exitCode: 1,
          statusLabel: "Exit 1 · isolated to stream.rs:78",
          isFailed: true,
          isMono: true,
        },
        {
          id: "sw_sh_w1_2",
          kind: "command",
          command: "cargo test -p rayu-gateway retry_budget -- --nocapture",
          displayCommand: "cargo test -p rayu-gateway retry_budget -- --nocapture",
          output:
            "running 6 tests\ntest retry::budget::tests::exponential_jitter_bounds ... ok\ntest retry::budget::tests::respects_provider_retry_after ... ok\ntest retry::budget::tests::streaming_midflight_retry_dedup ... ok\ntest result: ok. 6 passed; 0 failed; finished in 0.31s",
          exitCode: 0,
          statusLabel: "Success · auto-forwarding tail to coordinator",
          isMono: true,
        },
      ],
    },
    {
      id: "worker-2",
      name: "worker-2",
      role: "wt/session-shards",
      worktree: "wt/session-shards",
      state: "running",
      task: "Benchmark ShardStore::lookup p99 under 50k active keys",
      model: "GPT-6.1 Sol",
      laneProgressLabel: "1 / 2 lane items",
      duration: "34s",
      reportsTo: "coordinator",
      todoLane: [
        {
          id: "w2_1",
          text: "Add 50k-key lookup benchmark to crates/rayucode-core/benches",
          status: "done",
        },
        {
          id: "w2_2",
          text: "Measure p99 latency delta vs retired SessionCache",
          status: "now",
        },
      ],
      commands: [
        {
          id: "sw_sh_w2_1",
          kind: "command",
          command: "cargo bench -p rayucode-core shard_lookup_50k",
          displayCommand: "cargo bench -p rayucode-core shard_lookup_50k",
          output:
            "shard_lookup_50k        time: [142.4 ns 144.1 ns 146.0 ns]\n                        change: [-31.8% -30.2% -28.9%] (p < 0.001)",
          exitCode: 0,
          statusLabel: "Success",
          isMono: true,
        },
      ],
    },
    {
      id: "verifier",
      name: "verifier",
      role: "read-only",
      worktree: "local checkout",
      state: "completed",
      task: "Verified 14/14 session:: unit tests · auto-reported to root",
      model: "DeepSeek V4 Flash",
      laneProgressLabel: "2 / 2 lane items",
      duration: "19s",
      reportsTo: "coordinator",
      todoLane: [
        {
          id: "v1",
          text: "Verify session:: test suite across workspace",
          status: "done",
        },
        {
          id: "v2",
          text: "Check zero conflicting edits across active worktrees",
          status: "done",
        },
      ],
      commands: [
        {
          id: "sw_sh_v1",
          kind: "command",
          command: "cargo test -p rayucode session::",
          displayCommand: "cargo test -p rayucode session::",
          output: "test result: ok. 14 passed; 0 failed; 0 ignored; finished in 0.44s",
          exitCode: 0,
          statusLabel: "Auto-reported to coordinator",
          isMono: true,
        },
      ],
    },
  ],
  messages: [
    {
      id: "msg_1",
      time: "01:49:18",
      from: "worker-1",
      to: "coordinator",
      text: "Fixed mid-flight retry dedup in src/retry/stream.rs:78 — 6/6 retry_budget tests green.",
      tag: "auto-output",
      isOk: true,
    },
    {
      id: "msg_2",
      time: "01:48:52",
      from: "verifier",
      to: "coordinator",
      text: "Completed read-only check: 14/14 session:: tests pass, zero cross-worktree conflicts.",
      tag: "completed",
      isOk: true,
    },
    {
      id: "msg_3",
      time: "01:48:10",
      from: "coordinator",
      to: "@all",
      text: "Approved VersionedPlan v3: isolated wt/retry-budget and wt/session-shards scopes.",
      tag: "broadcast",
    },
  ],
  planScopes: [
    {
      id: "sc_1",
      scopeLabel: "Scope 1",
      ownerRoute: "worker-1 · wt/retry-budget",
      description:
        "Deduplicate streaming mid-flight retries in rayu-gateway and verify 6 unit tests.",
      statusTag: "6/6 green",
      isOk: true,
    },
    {
      id: "sc_2",
      scopeLabel: "Scope 2",
      ownerRoute: "worker-2 · wt/session-shards",
      description:
        "Benchmark ShardStore::lookup p99 under 50k keys (-30.2% latency confirmed).",
      statusTag: "running",
      isOk: true,
    },
    {
      id: "sc_3",
      scopeLabel: "Scope 3",
      ownerRoute: "verifier · read-only",
      description:
        "Validate workspace session regression suite and report conflicts to root.",
      statusTag: "done",
      isOk: true,
    },
  ],
  worktrees: [
    {
      id: "wt_1",
      label: "wt-1",
      branch: "wt/retry-budget",
      owner: "worker-1",
      file: "src/retry/stream.rs",
      additions: 28,
      deletions: 9,
    },
    {
      id: "wt_2",
      label: "wt-2",
      branch: "wt/session-shards",
      owner: "worker-2",
      file: "benches/shard_lookup.rs",
      additions: 44,
      deletions: 0,
    },
  ],
}

let mockAutomations: AutomationsState = {
  running: [
    {
      id: "ovn_8f2a",
      title: "Overnight: Gateway soak & retry dedup",
      status: "Running",
      host: "choeng-rayu-1",
      maxAgents: "max 4 agents",
      duration: "8h overnight",
      wakeTime: "07:00",
      handoffTime: "06:45",
      taskCardsCount: 3,
      validationsGreen: 1,
      eventLog: [
        "01:14:02  preflight   repo clean on feat/retire-session-cache · 214 MB RAM budget",
        "01:16:40  task_card   spawned worker-1 (e7b3) → stress retry_budget streaming dedup",
        "01:28:11  validation  cargo test -p rayu-gateway retry_budget → 5 ok, 1 patch queued",
        "01:31:05  handoff     drafting review_notes.md for 06:45 morning report",
      ],
    },
  ],
  schedules: [
    {
      id: "sch_1",
      title: "Daily PR & CI triage",
      modeBadge: "Plan",
      cronSummary: "08:30 Mon–Fri",
      repo: "rayucode-v2",
      description: "summarizes failing checks & open review comments to Telegram",
      enabled: true,
    },
    {
      id: "sch_2",
      title: "Nightly Rust clippy + cargo test",
      modeBadge: "Auto-edit",
      cronSummary: "02:00 Daily",
      repo: "rayucode-v2",
      description: "fixes lint warnings on an isolated worktree branch",
      enabled: true,
    },
    {
      id: "sch_3",
      title: "Weekly token & KV cache digest",
      modeBadge: "Plan",
      cronSummary: "Sun 18:00",
      repo: "rayu-web",
      description: "exports Excel cost breakdown & cache hit trend",
      enabled: false,
    },
  ],
  reports: [
    {
      id: "rep_1",
      title: "SessionCache audit & ShardStore port",
      status: "Completed",
      timestamp: "Yesterday · 06:52",
      testsSummary: "14 unit tests passing · 2 issue drafts staged",
      credits: "1.84 credits",
      kvWarmPct: 93,
      actionLabel: "Review diffs",
      targetRoute: "changes",
    },
    {
      id: "rep_2",
      title: "VS Code model picker parity check",
      status: "Completed",
      timestamp: "Nov 20 · 06:48",
      testsSummary: "0 regressions",
      credits: "0.62 credits",
      kvWarmPct: 91,
      actionLabel: "Open session",
      targetRoute: "workspace",
    },
  ],
}

let mockPlugins: PluginsState = {
  featuredId: "Dynatrace",
  plugins: [
    {
      id: "Firebase",
      name: "Firebase",
      description: "Firestore, Auth, Functions & preview channels",
      heroDescription:
        "Inspect Firestore collections, Auth users, Cloud Functions logs, and deploy preview channels directly from RayuCode via MCP.",
      category: "featured",
      installed: false,
      searchKeywords: "firebase firestore google cloud functions auth featured",
    },
    {
      id: "Supabase",
      name: "Supabase",
      description: "Postgres, RLS policies, migrations & Edge logs",
      heroDescription:
        "Query Postgres tables, inspect RLS policies, run migrations, and tail Edge Function logs straight from your RayuCode workspace.",
      category: "featured",
      installed: false,
      searchKeywords: "supabase postgres database rls edge functions featured",
    },
    {
      id: "Dynatrace",
      name: "Dynatrace",
      description: "Production problems, root causes, traces & logs",
      heroDescription:
        "Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities, via skills and the MCP...",
      category: "featured",
      installed: false,
      searchKeywords: "dynatrace observability logs metrics traces apm featured",
    },
    {
      id: "Notion",
      name: "Notion",
      description: "Team wikis, RFC specs & sprint databases",
      heroDescription:
        "Search team wikis, sync RFC specs into Markdown previews, and update sprint databases automatically as RayuCode ships PRs.",
      category: "featured",
      installed: false,
      searchKeywords: "notion docs wiki database specs featured",
    },
    {
      id: "Linear",
      name: "Linear",
      description: "Triage cycles, pull issue context & link PRs",
      heroDescription:
        "Triage cycles, pull issue context directly into your prompt, and auto-link RayuCode Swarm branches and pull requests.",
      category: "featured",
      installed: false,
      searchKeywords: "linear issues cycles project tracking featured",
    },
    {
      id: "Gmail",
      name: "Gmail",
      description: "Read and manage Gmail",
      category: "popular",
      installed: false,
      searchKeywords: "gmail google email mail popular",
    },
    {
      id: "Google Drive",
      name: "Google Drive",
      description: "Drive, Docs, Sheets or Slides",
      category: "popular",
      installed: false,
      searchKeywords: "google drive docs sheets slides popular",
    },
    {
      id: "Health",
      name: "Health",
      description: "Explore your health data",
      category: "popular",
      installed: false,
      infoOnly: true,
      infoToast: "Health requires macOS Apple Health permission",
      searchKeywords: "health apple fitness wellness popular",
    },
    {
      id: "Remote Desktop Commander",
      name: "Remote Desktop Commander",
      description: "Use your computer from chat",
      category: "popular",
      installed: false,
      searchKeywords: "remote desktop commander computer terminal popular",
    },
    {
      id: "Writing Style",
      name: "Writing Style",
      description: "Write with context from your own writing",
      category: "popular",
      installed: false,
      searchKeywords: "writing style prose copywriter popular",
    },
    {
      id: "GitHub",
      name: "GitHub",
      description: "Triage PRs, issues, CI, and publish flows",
      category: "popular",
      installed: false,
      searchKeywords: "github git pr issues ci popular",
    },
    {
      id: "iCloud Mail",
      name: "iCloud Mail",
      description: "Read and manage iCloud email",
      category: "noteworthy",
      installed: false,
      searchKeywords: "icloud mail apple email new noteworthy",
    },
    {
      id: "iCloud Calendar",
      name: "iCloud Calendar",
      description: "Read and manage iCloud events",
      category: "noteworthy",
      installed: false,
      searchKeywords: "icloud calendar apple events schedule new noteworthy",
    },
    {
      id: "ElevenLabs",
      name: "ElevenLabs",
      description: "Voice agents and media",
      category: "noteworthy",
      installed: false,
      searchKeywords: "elevenlabs voice audio agents media tts new noteworthy",
    },
    {
      id: "Tripsy",
      name: "Tripsy",
      description: "Plan and organize your trips",
      category: "noteworthy",
      installed: false,
      searchKeywords: "tripsy travel trips itinerary new noteworthy",
    },
    {
      id: "Sonos",
      name: "Sonos",
      description: "Control your Sonos system",
      category: "noteworthy",
      installed: false,
      searchKeywords: "sonos speaker audio music home new noteworthy",
    },
    {
      id: "Hevy",
      name: "Hevy",
      description: "Gym workout plans and insights",
      category: "noteworthy",
      installed: false,
      searchKeywords: "hevy gym workout fitness new noteworthy",
    },
    {
      id: "Dropbox",
      name: "Dropbox",
      description: "Find, create, and take action",
      category: "business",
      installed: false,
      searchKeywords: "dropbox files cloud storage small business",
    },
    {
      id: "HubSpot",
      name: "HubSpot",
      description: "Insights to action in HubSpot",
      category: "business",
      installed: false,
      searchKeywords: "hubspot crm sales marketing small business",
    },
    {
      id: "Stripe",
      name: "Stripe",
      description: "Accept payments, grow revenue.",
      heroDescription:
        "Inspect payment intents, test webhooks locally, and scaffold billing & checkout flows with real Stripe API schemas.",
      category: "business",
      installed: false,
      searchKeywords: "stripe payments billing revenue small business featured",
    },
    {
      id: "Canva",
      name: "Canva",
      description: "Create and export brand visuals",
      category: "business",
      installed: false,
      searchKeywords: "canva design graphics slides small business",
    },
  ],
  skills: [
    {
      id: "sk_impeccable",
      name: "impeccable",
      scope: "~/.rayu/skills/impeccable",
      tokens: "4.2K",
      description: "High-craft UI design, typography, token hierarchy & anti-slop audits",
      enabled: true,
    },
    {
      id: "sk_debug",
      name: "systematic-debugging",
      scope: "~/.rayu/skills/systematic-debugging",
      tokens: "2.6K",
      description: "Root-cause isolation and reproducible regression tests before fixes",
      enabled: true,
    },
    {
      id: "sk_tdd",
      name: "test-driven-development",
      scope: "~/.rayu/skills/test-driven-development",
      tokens: "1.9K",
      description: "Red-green-refactor workflow across Rust crates and TypeScript features",
      enabled: true,
    },
    {
      id: "sk_verify",
      name: "verification-before-completion",
      scope: "~/.rayu/skills/verification-before-completion",
      tokens: "1.3K",
      description: "Mandatory typecheck, lint, test, and visual verification gates",
      enabled: true,
    },
  ],
  memories: [
    {
      id: "mem_1",
      path: "~/.rayu/memory/rayucode-v2.md",
      tokens: "214 tok",
      updatedAt: "14m ago",
      preview:
        "Shared Rust coding engine in crates/; Desktop uses Warm Graphite Dark (--bg-chrome / --bg-canvas) and Rayu Green or Ocean Blue accent tokens.",
    },
    {
      id: "mem_2",
      path: "~/.rayu/memory/shard-store.md",
      tokens: "139 tok",
      updatedAt: "1h ago",
      preview:
        "SessionLookup routes directly through ShardStore::lookup and touches CacheBudget on every hit.",
    },
  ],
}

let mockChanges: ChangesState = {
  branch: "feat/retire-session-cache",
  totalAdditions: 82,
  totalDeletions: 224,
  files: [
    {
      id: "chg-lookup",
      path: "src/session/lookup.rs",
      additions: 12,
      deletions: 7,
      ownerBadge: "coordinator · a41f",
      hint: "Ready for review · 14 tests green",
      lines: [
        {
          lineNumber: null,
          type: "hunk",
          mark: "@@",
          content: " -41,12 +41,17 @@ impl SessionLookup {",
        },
        {
          lineNumber: 41,
          type: "ctx",
          mark: "",
          content: "     pub async fn get(&self, id: &SessionId) -> Result<Option<Session>> {",
        },
        {
          lineNumber: 42,
          type: "del",
          mark: "−",
          content: "         if let Some(hit) = self.legacy_cache.get(id).await {",
        },
        {
          lineNumber: 43,
          type: "del",
          mark: "−",
          content: "             return Ok(Some(hit));",
        },
        {
          lineNumber: 44,
          type: "del",
          mark: "−",
          content: "         }",
        },
        {
          lineNumber: 42,
          type: "add",
          mark: "+",
          content: "         if let Some(hit) = self.shards.lookup(id, &self.budget).await? {",
        },
        {
          lineNumber: 43,
          type: "add",
          mark: "+",
          content: '             metrics::increment_counter!("rayu.shard.cache_hit");',
        },
        {
          lineNumber: 44,
          type: "add",
          mark: "+",
          content: "             return Ok(Some(hit));",
        },
        {
          lineNumber: 45,
          type: "add",
          mark: "+",
          content: "         }",
        },
        {
          lineNumber: 46,
          type: "ctx",
          mark: "",
          content: "         self.store.load(id).await",
        },
        {
          lineNumber: 47,
          type: "ctx",
          mark: "",
          content: "     }",
        },
      ],
    },
    {
      id: "chg-budget",
      path: "src/retry/budget.rs",
      additions: 22,
      deletions: 3,
      ownerBadge: "worker-1 · e7b3",
      hint: "Fixes streaming_midflight_retry (40 == 40)",
      lines: [
        {
          lineNumber: null,
          type: "hunk",
          mark: "@@",
          content: " -209,8 +209,14 @@ impl StreamRetry {",
        },
        {
          lineNumber: 209,
          type: "ctx",
          mark: "",
          content:
            "     pub fn accept_chunk(&mut self, seq: u64, bytes: Bytes) -> Option<Bytes> {",
        },
        {
          lineNumber: 210,
          type: "del",
          mark: "−",
          content: "         self.last_seq = seq;",
        },
        {
          lineNumber: 211,
          type: "del",
          mark: "−",
          content: "         Some(bytes)",
        },
        {
          lineNumber: 210,
          type: "add",
          mark: "+",
          content: "         if seq <= self.last_seq {",
        },
        {
          lineNumber: 211,
          type: "add",
          mark: "+",
          content: "             return None; // dedup mid-flight replay chunk",
        },
        {
          lineNumber: 212,
          type: "add",
          mark: "+",
          content: "         }",
        },
        {
          lineNumber: 213,
          type: "add",
          mark: "+",
          content: "         self.last_seq = seq;",
        },
        {
          lineNumber: 214,
          type: "add",
          mark: "+",
          content: "         Some(bytes)",
        },
        {
          lineNumber: 215,
          type: "ctx",
          mark: "",
          content: "     }",
        },
      ],
    },
    {
      id: "chg-cache",
      path: "src/session/cache.rs",
      additions: 0,
      deletions: 214,
      deleted: true,
      ownerBadge: "Delete file",
      hint: "0 remaining references across workspace",
      lines: [
        {
          lineNumber: null,
          type: "hunk",
          mark: "@@",
          content: " -1,6 +0,0 @@",
        },
        {
          lineNumber: 1,
          type: "del",
          mark: "−",
          content: " //! Legacy in-memory SessionCache (replaced by ShardStore::lookup)",
        },
        {
          lineNumber: 2,
          type: "del",
          mark: "−",
          content:
            " pub struct SessionCache { map: RwLock<HashMap<SessionId, Session>> }",
        },
      ],
    },
    {
      id: "chg-plan",
      path: "MIGRATION_PLAN.md",
      additions: 48,
      deletions: 0,
      ownerBadge: "docs",
      hint: "Markdown spec updated automatically",
      lines: [
        {
          lineNumber: 1,
          type: "add",
          mark: "+",
          content: " # SessionCache Retirement & ShardStore Migration",
        },
        {
          lineNumber: 2,
          type: "add",
          mark: "+",
          content: " - [x] Route reads through ShardStore::lookup with CacheBudget",
        },
        {
          lineNumber: 3,
          type: "add",
          mark: "+",
          content: " - [x] Verify 14 session:: unit tests and −38% RSS reduction",
        },
      ],
    },
  ],
}

let mockTelegram: TelegramState = {
  mode: "connected",
  connectedBotHandle: "@RayuCodeBot",
  chatId: "842910443",
  drivingSession: "a41f · rayucode-v2",
  mediaDelivery: "Text notice",
  authPath: "~/.rayu/rayu-auth.json",
  pairingCommand: "/start rayu_9k4m2p",
  pairingLink: "https://t.me/RayuCodeBot?start=rayu_9k4m2p",
  remoteUninstallEnabled: false,
  approvals: [
    {
      id: "appr_1",
      toolBadge: "Bash",
      commandOrSummary: "cargo test -p rayu-gateway retry_budget",
      requestedBy: "worker-1 (e7b3)",
      timeAgo: "12s ago",
      status: "pending",
    },
    {
      id: "appr_2",
      toolBadge: "ExitPlanMode",
      commandOrSummary: "Delete legacy src/session/cache.rs after ShardStore migration",
      requestedBy: "coordinator (a41f)",
      timeAgo: "2m ago",
      status: "pending",
    },
  ],
  commands: [
    {
      command: "/sessions",
      description: "Pick which local RayuCode session to drive",
    },
    {
      command: "/model",
      description: "Switch model route in Rayu-first gateway order",
    },
    {
      command: "/provider",
      description: "Switch configured provider on the host",
    },
    {
      command: "/interrupt",
      description: "Soft-cancel the active Telegram turn",
    },
    {
      command: "/connect",
      description: "Prompt host login when auth is missing",
    },
    {
      command: "/stop",
      description: "Disconnect the Telegram remote link",
    },
  ],
}

let mockSettings: SettingsState = {
  account: {
    name: "ly yeak khai",
    username: "@yeakhaily",
    email: "yeakhaily@gmail.com",
    plan: "Plus",
    ageRange: "18 or older",
    builderProfile: "ly yeak khai",
    streakDays: 14,
    sessionsCompleted: 128,
    kvSavingsPct: "94.2%",
  },
  usage: {
    planName: "RayuCode Plus",
    monthlyCreditsAllowance: 115000,
    monthlyCreditsRemaining: 104200,
    fiveHourCap: 1437,
    fiveHourLeft: 1437,
    weeklyCap: 28750,
    weeklyLeft: 28750,
    useAllCredits: false,
    paygCredits: 0,
  },
  preferences: {
    notificationsEnabled: true,
    voiceModel: "Rayu Natural Voice",
    autoCompactContext: true,
    showMiniPet: false,
    defaultPermissionMode: "default",
  },
}

const mockDaemonStatus: DaemonStatus = {
  connected: true,
  reconnecting: false,
  socketPath: "~/.rayu/builds/shared-server/rayu",
  version: "2.0.0",
  latencyMs: 2,
}

function createEmptyFileChangesSnapshot(sessionId: string): FileChangesSnapshot {
  return {
    session_id: sessionId,
    latest_turn_id: 0,
    total_pending_files: 0,
    total_additions: 0,
    total_deletions: 0,
    files: [],
  }
}

function recalcFileChangesSnapshot(
  snapshot: FileChangesSnapshot
): FileChangesSnapshot {
  const pending = snapshot.files.filter((f) => f.status === "pending")
  return {
    ...snapshot,
    total_pending_files: pending.length,
    total_additions: snapshot.files.reduce((sum, f) => sum + f.additions, 0),
    total_deletions: snapshot.files.reduce((sum, f) => sum + f.deletions, 0),
  }
}

const mockFileChangesBySession: Record<string, FileChangesSnapshot> = {
  ses_retire_cache: {
    session_id: "ses_retire_cache",
    latest_turn_id: 3,
    total_pending_files: 3,
    total_additions: 26,
    total_deletions: 55,
    files: [
      {
        path: "src/session/lookup.rs",
        display_path: "src/session/lookup.rs",
        kind: "modified",
        status: "pending",
        additions: 12,
        deletions: 7,
        changed_in_latest_turn: true,
        turn_id: 3,
        edit_count: 2,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [
          {
            old_start: 18,
            old_lines: 5,
            new_start: 18,
            new_lines: 7,
            header: "@@ -18,5 +18,7 @@ impl SessionLookup {",
            lines: [
              "     pub fn get(&self, key: &SessionKey) -> Option<Session> {",
              "-        self.cache.read().get(key).cloned()",
              "+        let hit = self.shards.lookup(key)?;",
              "+        self.budget.touch(key);",
              "+        Some(hit)",
              "     }",
            ],
          },
        ],
        preview_truncated: false,
        updated_at_ms: 1_764_000_000_000,
      },
      {
        path: "src/session/cache.rs",
        display_path: "src/session/cache.rs",
        kind: "deleted",
        status: "pending",
        additions: 0,
        deletions: 48,
        changed_in_latest_turn: true,
        turn_id: 3,
        edit_count: 1,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [
          {
            old_start: 1,
            old_lines: 4,
            new_start: 0,
            new_lines: 0,
            header: "@@ -1,4 +0,0 @@",
            lines: [
              "-//! Legacy in-memory SessionCache (replaced by ShardStore::lookup)",
              "-pub struct SessionCache {",
              "-    map: RwLock<HashMap<SessionId, Session>>,",
              "-}",
            ],
          },
        ],
        preview_truncated: true,
        updated_at_ms: 1_763_999_990_000,
      },
      {
        path: "MIGRATION_PLAN.md",
        display_path: "MIGRATION_PLAN.md",
        kind: "created",
        status: "pending",
        additions: 14,
        deletions: 0,
        changed_in_latest_turn: false,
        turn_id: 2,
        edit_count: 1,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [
          {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: 3,
            header: "@@ -0,0 +1,3 @@",
            lines: [
              "+# SessionCache Retirement & ShardStore Migration",
              "+- [x] Route reads through ShardStore::lookup with CacheBudget",
              "+- [x] Verify 14 session:: unit tests and -38% RSS reduction",
            ],
          },
        ],
        preview_truncated: false,
        updated_at_ms: 1_763_999_940_000,
      },
    ],
  },
}

// ============================================================================
// Window Bridge Interface & Typed Client
// ============================================================================

export interface WorkspaceInfo {
  host: string
  project: string
  path: string
  branch: string
}

export interface TerminalCommandResult {
  id: string
  prompt: string
  command: string
  output: string
  exitCode: number
  durationMs: number
  isOk: boolean
  isError: boolean
}

export interface RayuSessionUser {
  id: number
  email: string | null
  displayName: string | null
  avatarUrl: string | null
  role: string
}

export interface RayuCloudCredits {
  plan: string
  planName: string
  creditsPerPeriod: number | null
  usedCredits: number
  remainingCredits: number | null
  resetSeconds: number
  periodEnd: string | null
  topupBalance: number
  topUpEnabled: boolean
  creditsPerWeek?: number | null
  weekUsedCredits?: number
  weekResetSeconds?: number
  creditsPer5h?: number | null
  windowUsedCredits?: number
  windowResetSeconds?: number
  sessionWindowMinutes?: number
  limitMode?: "gated" | "unlimited" | null
  fetchedAt?: number
}

export interface RayuCloudModelEntry {
  code: string
  label?: string
  description?: string
  contextWindow?: number
  supportsReasoning?: boolean
}

export interface RayuAuthState {
  signedIn: boolean
  method: "oauth" | "apiKey" | "none"
  signingIn: boolean
  pendingAuthUrl: string | null
  user: RayuSessionUser | null
  credits: RayuCloudCredits | null
  allowedModels: RayuCloudModelEntry[]
  apiBase: string
  webBase: string
  gatewayBase: string
  error: string | null
}

export interface CloudChatMessage {
  role: "user" | "assistant"
  content: string
  images?: Array<[string, string]>
}

export interface PersistedComposerTemplate {
  id: string
  kind: "spreadsheet" | "presentation" | "document"
  name: string
  description: string
  promptSpec: string
  accent: "emerald" | "navy" | "amber" | "forest" | "obsidian"
  createdAt: number
}

export interface RayuBridgeApi {
  daemon?: {
    getStatus?: () => Promise<DaemonStatus & { mode?: "live" | "demo" }>
    launch?: () => Promise<DaemonStatus & { mode?: "live" | "demo" }>
    invoke?: <T = unknown>(method: string, params?: unknown) => Promise<T>
    onStatusChange?: (
      cb: (status: DaemonStatus & { mode?: "live" | "demo" }) => void
    ) => () => void
  }
  harness?: {
    listSessions?: () => Promise<HarnessSessionInfoLike[]>
    createSession?: (
      workingDir?: string,
      title?: string
    ) => Promise<HarnessSessionInfoLike>
    renameSession?: (sessionId: string, title: string) => Promise<{ ok: boolean }>
    attachSession?: (sessionId: string) => Promise<HarnessSessionInfoLike>
    forkSession?: (sessionId: string) => Promise<HarnessSessionInfoLike>
    getHistory?: (sessionId: string) => Promise<{
      messages: HarnessHistoryMessageLike[]
      images?: unknown[]
    }>
    sendMessage?: (
      sessionId: string,
      content: string,
      images?: Array<[string, string]>
    ) => Promise<{ ok: boolean }>
    cancel?: (sessionId: string) => Promise<{ ok: boolean }>
    respondToPermission?: (
      sessionId: string,
      requestId: string,
      decision: "allow" | "allow_always" | "deny"
    ) => Promise<{ ok: boolean }>
    setPermissionMode?: (
      sessionId: string,
      mode: PermissionModeId
    ) => Promise<{ ok: boolean; error?: string }>
    getRuntimeInfo?: (sessionId: string) => Promise<{
      provider?: string
      model?: string
      routes?: HarnessModelRouteLike[]
    }>
    setModel?: (sessionId: string, model: string) => Promise<{ ok: boolean }>
    setReasoningEffort?: (
      sessionId: string,
      effort: string
    ) => Promise<{ ok: boolean }>
    runtimeCommand?: (
      sessionId: string,
      command: string,
      args?: string[]
    ) => Promise<{ command: string; data: unknown; message: string }>
    onEvent?: (cb: (frame: Record<string, unknown>) => void) => () => void
  }
  fileChanges?: {
    get?: (sessionId: string) => Promise<FileChangesSnapshot>
    diff?: (
      sessionId: string,
      filePath: string
    ) => Promise<FileChangeDiffPayload | null>
    action?: (
      sessionId: string,
      action: FileChangeActionKind,
      opts?: { path?: string; force?: boolean }
    ) => Promise<FileChangeActionResponse>
  }
  workspace?: {
    getInfo?: () => Promise<WorkspaceInfo>
    setPath?: (targetPath: string) => Promise<WorkspaceInfo>
    pickFolder?: () => Promise<WorkspaceInfo | null>
    pickFiles?: () => Promise<
      Array<{
        name: string
        path: string
        isDirectory: boolean
        dataUrl?: string
        mediaType?: string
      }>
    >
    captureAppshot?: () => Promise<{ name: string; dataUrl: string } | null>
    readFile?: (filePath: string) => Promise<{
      pill: string
      path: string
      language: string
      startLine: number
      lines: string[]
    }>
    listFiles?: () => Promise<
      Array<{ path: string; name: string; sizeBytes: number; language: string }>
    >
    listRecent?: () => Promise<
      Array<{ name: string; path: string; lastOpenedAt: number }>
    >
  }
  storage?: {
    getPreferences?: () => Promise<
      Partial<SettingsState["preferences"]> & { useAllCredits?: boolean }
    >
    updatePreferences?: (
      patch: Partial<SettingsState["preferences"]> & { useAllCredits?: boolean }
    ) => Promise<
      Partial<SettingsState["preferences"]> & { useAllCredits?: boolean }
    >
    getSessionStore?: () => Promise<{
      sessions: SessionSummary[]
      turns: ExecutionTurn[]
    }>
    saveSessionStore?: (store: {
      sessions: SessionSummary[]
      turns: ExecutionTurn[]
    }) => Promise<{ sessions: SessionSummary[]; turns: ExecutionTurn[] }>
    getTemplates?: () => Promise<PersistedComposerTemplate[]>
    saveTemplate?: (input: {
      id?: string
      kind: "spreadsheet" | "presentation" | "document"
      name: string
      description: string
      promptSpec: string
      accent?: "emerald" | "navy" | "amber" | "forest" | "obsidian"
    }) => Promise<PersistedComposerTemplate[]>
    deleteTemplate?: (id: string) => Promise<PersistedComposerTemplate[]>
    getSidebarState?: () => Promise<SidebarState>
    saveSidebarState?: (state: SidebarState) => Promise<SidebarState>
  }
  extensions?: {
    list?: () => Promise<{
      mcpConfigPath: string
      mcpServers: Array<{
        id: string
        name: string
        description: string
        sourcePath: string
        scope: "global" | "workspace"
        transport: "stdio" | "url"
        command?: string
        args?: string[]
        url?: string
        envKeys?: string[]
        installed: boolean
      }>
      skills: SkillItem[]
      memories: MemoryFileItem[]
    }>
    upsertMcp?: (input: {
      id: string
      scope?: "global" | "workspace"
      command?: string
      args?: string[]
      url?: string
      env?: Record<string, string>
    }) => Promise<{
      mcpConfigPath: string
      mcpServers: Array<{
        id: string
        name: string
        description: string
        sourcePath: string
        scope: "global" | "workspace"
        transport: "stdio" | "url"
        command?: string
        args?: string[]
        url?: string
        envKeys?: string[]
        installed: boolean
      }>
      skills: SkillItem[]
      memories: MemoryFileItem[]
    }>
    removeMcp?: (
      id: string,
      scope?: "global" | "workspace"
    ) => Promise<{
      mcpConfigPath: string
      mcpServers: Array<{
        id: string
        name: string
        description: string
        sourcePath: string
        scope: "global" | "workspace"
        transport: "stdio" | "url"
        command?: string
        args?: string[]
        url?: string
        envKeys?: string[]
        installed: boolean
      }>
      skills: SkillItem[]
      memories: MemoryFileItem[]
    }>
    createSkill?: (input: {
      name: string
      description: string
      instructions?: string
    }) => Promise<{
      mcpConfigPath: string
      mcpServers: Array<{
        id: string
        name: string
        description: string
        sourcePath: string
        scope: "global" | "workspace"
        transport: "stdio" | "url"
        command?: string
        args?: string[]
        url?: string
        envKeys?: string[]
        installed: boolean
      }>
      skills: SkillItem[]
      memories: MemoryFileItem[]
    }>
    toggleSkill?: (skillId: string) => Promise<{
      mcpConfigPath: string
      mcpServers: Array<{
        id: string
        name: string
        description: string
        sourcePath: string
        scope: "global" | "workspace"
        transport: "stdio" | "url"
        command?: string
        args?: string[]
        url?: string
        envKeys?: string[]
        installed: boolean
      }>
      skills: SkillItem[]
      memories: MemoryFileItem[]
    }>
  }
  git?: {
    getChanges?: () => Promise<ChangesState | null>
    getCommits?: () => Promise<GitCommitSummary[]>
    listBranches?: () => Promise<{ current: string; branches: string[] }>
    checkoutBranch?: (
      branch: string
    ) => Promise<{ ok: boolean; branch: string; error?: string }>
    createWorktree?: (baseBranch?: string) => Promise<{
      ok: boolean
      path: string
      branch: string
      project: string
      error?: string
    }>
    toggleStage?: (
      filePath: string,
      staged: boolean
    ) => Promise<ChangesState | null>
    stageAll?: (staged: boolean) => Promise<ChangesState | null>
    discardFile?: (filePath: string) => Promise<ChangesState | null>
    commit?: (message: string) => Promise<{
      hash: string
      branch: string
      message: string
      committedCount: number
      committedAt: string
    }>
    createPr?: (input: {
      baseBranch: string
      headBranch: string
      title: string
      summary: string
    }) => Promise<{
      id: string
      url: string
      baseBranch: string
      headBranch: string
      title: string
      summary: string
      createdAt: string
    }>
  }
  terminal?: {
    runCommand?: (command: string) => Promise<TerminalCommandResult>
    ptyCreate?: (input: {
      sessionId: string
      cwd?: string
      cols?: number
      rows?: number
    }) => Promise<{ ok: boolean; cwd: string; shell: string }>
    ptyWrite?: (sessionId: string, data: string) => Promise<{ ok: boolean }>
    ptyResize?: (
      sessionId: string,
      cols: number,
      rows: number
    ) => Promise<{ ok: boolean }>
    ptyKill?: (sessionId: string) => Promise<{ ok: boolean }>
    onPtyData?: (
      cb: (payload: { sessionId: string; data: string }) => void
    ) => () => void
    onPtyExit?: (
      cb: (payload: { sessionId: string; exitCode: number }) => void
    ) => () => void
  }
  auth?: {
    getState?: () => Promise<RayuAuthState>
    refresh?: () => Promise<RayuAuthState>
    signInWithBrowser?: () => Promise<RayuAuthState>
    cancelSignIn?: () => Promise<RayuAuthState>
    signInWithApiKey?: (apiKey: string) => Promise<RayuAuthState>
    completeCallback?: (callbackUrl: string) => Promise<RayuAuthState>
    signOut?: () => Promise<RayuAuthState>
    onAuthChange?: (cb: (state: RayuAuthState) => void) => () => void
  }
  cloud?: {
    streamChat?: (input: {
      sessionId: string
      model: string
      messages: CloudChatMessage[]
    }) => Promise<{ ok: boolean }>
    cancelStream?: (sessionId: string) => Promise<{ ok: boolean }>
  }
  native?: {
    openInExcel?: (filePath: string) => Promise<{ ok: boolean }>
    openInPowerPoint?: (input: {
      fileName?: string
      title: string
      slides: Array<{
        id: string
        kicker?: string
        title: string
        subtitle?: string
        body: string
        bullets?: string[]
        notes?: string
      }>
    }) => Promise<{ ok: boolean; filePath: string }>
    openInVSCode?: (targetPath: string, line?: number) => Promise<{ ok: boolean }>
    openExternal?: (url: string) => Promise<{ ok: boolean }>
    revealInFinder?: (targetPath: string) => Promise<{ ok: boolean }>
    setKeepAwake?: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
  }
  office?: {
    pickExcelFile?: () => Promise<OfficeExcelWorkbookData | null>
    readExcel?: (filePath: string) => Promise<OfficeExcelWorkbookData>
    writeExcel?: (input: {
      filePath: string
      sheets: OfficeExcelSheetPayload[]
    }) => Promise<{
      ok: boolean
      filePath: string
      sheetCount: number
      rowCount: number
      workbook?: OfficeExcelWorkbookPayload
    }>
    createPowerPoint?: (input: {
      filePath?: string
      fileName?: string
      title: string
      slides: Array<{
        id?: string
        kicker?: string
        title: string
        subtitle?: string
        body: string
        bullets?: string[]
        metrics?: Array<{ label: string; value: string; note?: string }>
        notes?: string
        layout?: "cover" | "scorecard" | "bullets"
      }>
    }) => Promise<{
      ok: boolean
      filePath: string
      slideCount: number
      title?: string
      slides?: Array<{
        id?: string
        kicker?: string
        title: string
        subtitle?: string
        body: string
        bullets?: string[]
        metrics?: Array<{ label: string; value: string; note?: string }>
        notes?: string
        layout?: "cover" | "scorecard" | "bullets"
      }>
    }>
  }
  desktop?: {
    onArtifact?: (cb: (artifact: DesktopArtifactEvent) => void) => () => void
  }
  browser?: {
    navigate?: (url: string) => Promise<{ ok: boolean; url: string; title: string; error?: string }>
    snapshot?: () => Promise<{
      ok: boolean
      url: string
      title: string
      refCount: number
      tree: string
      error?: string
    }>
    click?: (ref: string) => Promise<{ ok: boolean; message: string }>
    type?: (
      ref: string,
      text: string,
      submit?: boolean
    ) => Promise<{ ok: boolean; message: string }>
    screenshot?: () => Promise<{
      ok: boolean
      url: string
      title: string
      dataUrl: string
      error?: string
    }>
    onEnsureOpen?: (cb: (payload: { url?: string }) => void) => () => void
  }
}

declare global {
  interface Window {
    rayu?: RayuBridgeApi
  }
}

function getBridge(): RayuBridgeApi | undefined {
  if (typeof window === "undefined") return undefined
  return window.rayu
}

const IS_TEST_ENV = import.meta.env.MODE === "test"

const IS_DEV_SERVER =
  Boolean(import.meta.env.DEV) &&
  !IS_TEST_ENV &&
  typeof window !== "undefined" &&
  window.location.protocol.startsWith("http")

const localHarnessListeners = new Set<
  (frame: Record<string, unknown>) => void
>()

function emitLocalHarnessFrame(frame: Record<string, unknown>): void {
  for (const listener of localHarnessListeners) {
    listener(frame)
  }
}

async function devAuthFetch<T>(
  route: string,
  options?: { method?: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const res = await fetch(`/__rayu_dev/${route}`, {
    method: options?.method ?? "GET",
    headers: options?.body
      ? { "Content-Type": "application/json" }
      : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (HTTP ${res.status})`)
  }
  return data
}

let lastKnownDaemonLive = false
let lastActiveHarnessSessionId: string | null = null
let lastKnownAuthState: RayuAuthState | null = null
let runtimeSessions: SessionSummary[] = []
let runtimeTurns: ExecutionTurn[] = []
let runtimeSessionsHydrated = false
const newlyCreatedEmptySessions = new Set<string>()
let runtimeSwarm: SwarmState = {
  swarmId: "idle",
  title: "No active swarm",
  planVersion: "v1",
  credits: "0.00 cr",
  kvCachePct: 0,
  agents: [],
  messages: [],
  planScopes: [],
  worktrees: [],
}
let runtimeAutomations: AutomationsState = {
  running: [],
  schedules: [],
  reports: [],
}
let runtimeTelegram: TelegramState = {
  mode: "hosted",
  connectedBotHandle: "@rayucode_bot",
  chatId: "Not paired",
  drivingSession: "None",
  mediaDelivery: "Disabled until paired",
  authPath: "~/.rayu/telegram.json",
  pairingCommand: "rayu telegram pair",
  pairingLink: "https://t.me/rayucode_bot",
  remoteUninstallEnabled: false,
  approvals: [],
  commands: mockTelegram.commands,
}

async function ensureRuntimeSessionsHydrated(): Promise<void> {
  if (runtimeSessionsHydrated || IS_TEST_ENV) return
  runtimeSessionsHydrated = true
  const bridge = getBridge()
  if (!bridge?.storage?.getSessionStore) return
  try {
    const saved = await bridge.storage.getSessionStore()
    if (Array.isArray(saved.sessions) && runtimeSessions.length === 0) {
      runtimeSessions = saved.sessions
    }
    if (Array.isArray(saved.turns) && runtimeTurns.length === 0) {
      runtimeTurns = saved.turns
    }
  } catch {
    // ignore storage read error
  }
}

function persistRuntimeSessions(): void {
  if (IS_TEST_ENV) return
  const bridge = getBridge()
  if (!bridge?.storage?.saveSessionStore) return
  void bridge.storage
    .saveSessionStore({
      sessions: runtimeSessions.slice(0, 50),
      turns: runtimeTurns.slice(-500),
    })
    .catch(() => {})
}

const DEFAULT_SIGNED_OUT_AUTH_STATE: RayuAuthState = {
  signedIn: false,
  method: "none",
  signingIn: false,
  pendingAuthUrl: null,
  user: null,
  credits: null,
  allowedModels: [],
  apiBase: "https://api.rayucode.com/api",
  webBase: "https://rayucode.com",
  gatewayBase: "https://gateway.rayucode.com",
  error: null,
}

async function isHarnessLive(): Promise<boolean> {
  const bridge = getBridge()
  if (!bridge?.harness || !bridge?.daemon?.getStatus) return false
  if (lastKnownDaemonLive) return true
  try {
    const status = await bridge.daemon.getStatus()
    lastKnownDaemonLive = Boolean(status.connected && status.mode !== "demo")
    return lastKnownDaemonLive
  } catch {
    lastKnownDaemonLive = false
    return false
  }
}

export const ipcClient = {
  sessions: {
    async list(): Promise<SessionSummary[]> {
      await ensureRuntimeSessionsHydrated()
      const bridge = getBridge()
      if (bridge?.harness?.listSessions && !IS_TEST_ENV && (await isHarnessLive())) {
        try {
          const liveSessions = await bridge.harness.listSessions()
          lastKnownDaemonLive = true
          const mappedLive = liveSessions.map((info) => {
            const summary = mapSessionInfoToSummary(info)
            const cached = runtimeSessions.find((s) => s.id === summary.id)
            if (!cached) return summary
            return {
              ...summary,
              title:
                !info.title || summary.title === "Untitled session"
                  ? cached.title || summary.title
                  : summary.title,
              modelId: cached.modelId ?? summary.modelId,
              modelLabel: cached.modelLabel ?? summary.modelLabel,
              effort: cached.effort ?? summary.effort,
              permissionMode: cached.permissionMode ?? summary.permissionMode,
            }
          })
          const liveIds = new Set(mappedLive.map((s) => s.id))
          const localOnly = runtimeSessions.filter((s) => !liveIds.has(s.id))
          return [...mappedLive, ...localOnly]
        } catch {
          // Fall through if daemon could not be reached
        }
      }
      if (!IS_TEST_ENV) {
        return [...runtimeSessions]
      }
      return [...mockSessions]
    },
    async listProjects(): Promise<ProjectGroup[]> {
      const bridge = getBridge()
      const liveSessions = await ipcClient.sessions.list()
      if (bridge?.workspace?.getInfo) {
        try {
          const info = await bridge.workspace.getInfo()
          return [
            {
              id: `proj_${info.project}`,
              name: info.project,
              path: info.path,
              expanded: true,
              sessions: liveSessions.map((s) => ({
                id: s.id,
                title: s.title,
              })),
            },
          ]
        } catch {
          // Fall through
        }
      }
      if (!IS_TEST_ENV) {
        return [
          {
            id: "proj_workspace",
            name: "rayucode-v2",
            path: "~/workspace/rayu/rayucode-v2",
            expanded: true,
            sessions: liveSessions.map((s) => ({
              id: s.id,
              title: s.title,
            })),
          },
        ]
      }
      return MOCK_PROJECTS.map((p) => ({ ...p, sessions: [...p.sessions] }))
    },
    async listRecents(): Promise<Array<{ id: string; title: string; route?: string }>> {
      if (!IS_TEST_ENV) {
        const liveSessions = await ipcClient.sessions.list()
        return liveSessions.map((s) => ({ id: s.id, title: s.title }))
      }
      const createdRecents = mockSessions
        .filter((s) => !MOCK_RECENTS.some((r) => r.id === s.id))
        .map((s) => ({ id: s.id, title: s.title }))
      return [...createdRecents, ...MOCK_RECENTS]
    },
    async getGettingStarted(): Promise<GettingStartedItem[]> {
      mockGettingStarted = loadGettingStartedItems()
      return mockGettingStarted.map((item) => ({ ...item }))
    },
    async toggleGettingStarted(
      id: string,
      forceCompleted?: boolean
    ): Promise<GettingStartedItem[]> {
      mockGettingStarted = mockGettingStarted.map((item) =>
        item.id === id
          ? {
              ...item,
              completed:
                forceCompleted !== undefined ? forceCompleted : !item.completed,
            }
          : item
      )
      persistGettingStartedItems(mockGettingStarted)
      return mockGettingStarted.map((item) => ({ ...item }))
    },
    async createSession(input: {
      prompt: string
      project?: string
      checkout?: string
      modelId?: string
      modelLabel?: string
      effort?: ReasoningEffort
      permissionMode?: PermissionModeId
    }): Promise<SessionSummary> {
      if (IS_TEST_ENV) {
        await ensureRuntimeSessionsHydrated()
      } else {
        void ensureRuntimeSessionsHydrated()
      }
      const bridge = getBridge()
      const derivedTitle =
        input.prompt.trim().length > 48
          ? `${input.prompt.trim().slice(0, 48)}...`
          : input.prompt.trim() || "New session"
      if (bridge?.harness?.createSession && !IS_TEST_ENV) {
        try {
          const live = await bridge.harness.createSession(
            undefined,
            derivedTitle
          )
          lastKnownDaemonLive = true
          lastActiveHarnessSessionId = live.session_id
          newlyCreatedEmptySessions.add(live.session_id)
          const hasExplicitStoredModel =
            typeof window !== "undefined" &&
            Boolean(window.localStorage.getItem("rayu-model-id"))
          const hasExplicitStoredEffort =
            typeof window !== "undefined" &&
            Boolean(window.localStorage.getItem("rayu-effort"))
          if (
            input.modelId &&
            input.modelId !== "default" &&
            hasExplicitStoredModel &&
            bridge.harness.setModel
          ) {
            void bridge.harness
              .setModel(live.session_id, input.modelId)
              .catch(() => {})
          }
          if (
            input.effort &&
            hasExplicitStoredEffort &&
            input.effort !== "Auto" &&
            bridge.harness.setReasoningEffort
          ) {
            void bridge.harness
              .setReasoningEffort(live.session_id, input.effort.toLowerCase())
              .catch(() => {})
          }
          const mapped = mapSessionInfoToSummary(live)
          const summary: SessionSummary = {
            ...mapped,
            title: derivedTitle || mapped.title,
            modelId: input.modelId ?? mapped.modelId,
            modelLabel: input.modelLabel ?? mapped.modelLabel,
            effort: input.effort ?? mapped.effort,
            permissionMode: input.permissionMode ?? mapped.permissionMode,
          }
          runtimeSessions = [
            summary,
            ...runtimeSessions.filter((s) => s.id !== summary.id),
          ]
          persistRuntimeSessions()
          return summary
        } catch {
          // Fall through to local offline session creation only if Rust daemon is unavailable
        }
      }

      const created: SessionSummary = {
        id: `ses_${Date.now()}`,
        title: derivedTitle,
        project: input.project ?? "rayucode-v2",
        checkout: input.checkout ?? "Local Checkout",
        branch: "main",
        updatedAt: "Just now",
        modelId: input.modelId ?? "claude-opus-5-5",
        modelLabel: input.modelLabel ?? "Claude Opus 5.5",
        effort: input.effort ?? "Medium",
        permissionMode: input.permissionMode ?? "default",
        kvWarmPct: 0,
        creditsUsed: 0,
      }
      runtimeSessions = [created, ...runtimeSessions]
      persistRuntimeSessions()
      if (IS_TEST_ENV) {
        mockSessions = [created, ...mockSessions]
      }
      return created
    },
    async listPermissionModes(): Promise<PermissionModeOption[]> {
      return [...MOCK_PERMISSION_MODES]
    },
  },

  models: {
    async list(): Promise<ModelOption[]> {
      const bridge = getBridge()
      if (
        bridge?.harness?.getRuntimeInfo &&
        lastActiveHarnessSessionId &&
        (await isHarnessLive())
      ) {
        try {
          const info = await bridge.harness.getRuntimeInfo(
            lastActiveHarnessSessionId
          )
          if (info.routes && info.routes.length > 0) {
            return mapModelRoutesToOptions(info.routes)
          }
        } catch {
          // Fall back to Rayu Cloud or curated catalog
        }
      }
      if (
        lastKnownAuthState?.signedIn &&
        lastKnownAuthState.allowedModels.length > 0
      ) {
        const cloudOptions: ModelOption[] = [
          {
            id: "default",
            label: "Default",
            subtitle: "Recommended Rayu Cloud model",
            provider: "rayu",
            recommended: true,
          },
          ...lastKnownAuthState.allowedModels.map((m) => ({
            id: m.code,
            label: m.label || m.code,
            subtitle: m.description,
            provider: "rayu",
          })),
        ]
        return cloudOptions
      }
      return [...MOCK_MODELS]
    },
    async refresh(): Promise<ModelOption[]> {
      const bridge = getBridge()
      if (
        bridge?.harness?.runtimeCommand &&
        lastActiveHarnessSessionId &&
        (await isHarnessLive())
      ) {
        await bridge.harness
          .runtimeCommand(lastActiveHarnessSessionId, "refresh_model_list")
          .catch(() => {})
      } else if (bridge?.auth?.refresh) {
        const refreshed = await bridge.auth.refresh().catch(() => null)
        if (refreshed) lastKnownAuthState = refreshed
      }
      return ipcClient.models.list()
    },
  },

  trace: {
    async listTurns(sessionId?: string | null): Promise<ExecutionTurn[]> {
      await ensureRuntimeSessionsHydrated()
      if (sessionId) {
        const cachedTurns = runtimeTurns.filter((t) => t.sessionId === sessionId)
        if (cachedTurns.length > 0) {
          return cachedTurns
        }
      }
      const bridge = getBridge()
      if (
        sessionId &&
        bridge?.harness?.getHistory &&
        !sessionId.startsWith("ses_") &&
        !newlyCreatedEmptySessions.has(sessionId) &&
        !IS_TEST_ENV
      ) {
        try {
          lastActiveHarnessSessionId = sessionId
          const history = await bridge.harness.getHistory(sessionId)
          lastKnownDaemonLive = true
          const turns = mapHistoryMessagesToTurns(sessionId, history.messages)
          if (turns.length > 0) {
            runtimeTurns = [
              ...runtimeTurns.filter((t) => t.sessionId !== sessionId),
              ...turns,
            ]
            persistRuntimeSessions()
            return turns
          }
          return turns
        } catch {
          // Fall back to cached local turns
        }
      }

      if (!sessionId) {
        return IS_TEST_ENV ? [...mockTurns] : []
      }
      const localTurns = runtimeTurns.filter((t) => t.sessionId === sessionId)
      if (localTurns.length > 0) return localTurns
      if (!IS_TEST_ENV) {
        return []
      }
      const filtered = mockTurns.filter((t) => t.sessionId === sessionId)
      if (filtered.length > 0) return filtered
      if (
        sessionId === "ses_retire_cache" ||
        sessionId === "ses_model_picker" ||
        sessionId === "ses_q4_excel"
      ) {
        return [...mockTurns]
      }
      return []
    },
    async sendPrompt(input: {
      sessionId: string
      prompt: string
      images?: PromptImageAttachment[]
      modelId?: string
      modelLabel: string
      history?: CloudChatMessage[]
    }): Promise<ExecutionTurn> {
      const bridge = getBridge()
      const imageTuples: Array<[string, string]> = (input.images ?? [])
        .map((img) => parseImageDataUrl(img.dataUrl))
        .filter((pair): pair is [string, string] => pair !== null)
      const effectivePrompt =
        input.prompt.trim().length > 0
          ? input.prompt
          : imageTuples.length > 0
            ? "Analyze the attached image(s)."
            : input.prompt

      if (
        bridge?.harness?.sendMessage &&
        !input.sessionId.startsWith("ses_") &&
        !IS_TEST_ENV
      ) {
        await bridge.harness.sendMessage(
          input.sessionId,
          effectivePrompt,
          imageTuples.length > 0 ? imageTuples : undefined
        )
        lastKnownDaemonLive = true
        return {
          id: `live_turn_${Date.now()}`,
          sessionId: input.sessionId,
          userImages: input.images,
          userPrompt: input.prompt,
          workedDuration: "1s",
          isLive: true,
          notes: [],
          groups: [],
          answerIntro: "",
          answerBullets: [],
          diffCard: {
            id: `diff_${Date.now()}`,
            file: "workspace",
            additions: 0,
            deletions: 0,
            hint: "Streaming response from rayu daemon",
            lines: [],
          },
          timestamp: "Just now",
          credits: "0.00 cr",
          kvCachePct: 94,
          pinned: false,
        }
      }

      if (
        (bridge?.cloud?.streamChat || IS_DEV_SERVER) &&
        lastKnownAuthState?.signedIn
      ) {
        const messages: CloudChatMessage[] = [
          ...(input.history ?? []),
          {
            role: "user",
            content: effectivePrompt,
            ...(imageTuples.length > 0 ? { images: imageTuples } : {}),
          },
        ]
        await ipcClient.cloud.streamChat({
          sessionId: input.sessionId,
          model: input.modelId || "default",
          messages,
        })
        return {
          id: `cloud_turn_${Date.now()}`,
          sessionId: input.sessionId,
          userImages: input.images,
          userPrompt: input.prompt,
          workedDuration: "1s",
          isLive: true,
          notes: [],
          groups: [],
          answerIntro: "",
          answerBullets: [],
          diffCard: {
            id: `diff_${Date.now()}`,
            file: "workspace",
            additions: 0,
            deletions: 0,
            hint: "Streamed via Rayu Cloud",
            lines: [],
          },
          timestamp: "Just now",
          credits: "0.00 cr",
          kvCachePct: 0,
          pinned: false,
        }
      }

      const newTurn: ExecutionTurn = {
        id: `turn_${Date.now()}`,
        sessionId: input.sessionId,
        userPrompt: input.prompt,
        workedDuration: "0s",
        notes: [],
        groups: [],
        answerIntro:
          "You are not signed in to Rayu Cloud and the local `rayu` daemon is offline, so this prompt was not sent to **" +
          input.modelLabel +
          "**.\n\nClick **Sign in to Rayu Cloud** in the Profile menu or **Settings → Account & Usage** to authenticate and stream live responses immediately.",
        answerBullets: [],
        diffCard: {
          id: `diff_empty_${Date.now()}`,
          file: "workspace",
          additions: 0,
          deletions: 0,
          hint: "No workspace changes yet",
          lines: [],
        },
        timestamp: "Just now",
        credits: "0.00 cr",
        kvCachePct: 0,
        pinned: false,
      }
      runtimeTurns = [...runtimeTurns, newTurn]
      persistRuntimeSessions()
      if (IS_TEST_ENV) {
        mockTurns = [...mockTurns, newTurn]
      }
      return newTurn
    },
    recordTurn(turn: ExecutionTurn): void {
      if (turn.sessionId) {
        newlyCreatedEmptySessions.delete(turn.sessionId)
      }
      runtimeTurns = [
        ...runtimeTurns.filter((t) => t.id !== turn.id),
        turn,
      ]
      if (
        turn.sessionId &&
        !runtimeSessions.some((s) => s.id === turn.sessionId)
      ) {
        const promptTitle =
          turn.userPrompt.trim().length > 48
            ? `${turn.userPrompt.trim().slice(0, 48)}...`
            : turn.userPrompt.trim() || "New session"
        runtimeSessions = [
          {
            id: turn.sessionId,
            title: promptTitle,
            project: "rayucode-v2",
            checkout: "Local Checkout",
            branch: "main",
            updatedAt: "Just now",
            modelId: "claude-opus-5-5",
            modelLabel: "Claude Opus 5.5",
            effort: "Medium",
            permissionMode: "default",
            kvWarmPct: turn.kvCachePct ?? 0,
            creditsUsed: 0,
          },
          ...runtimeSessions,
        ]
      }
      persistRuntimeSessions()
    },
    async togglePin(turnId: string): Promise<ExecutionTurn | undefined> {
      runtimeTurns = runtimeTurns.map((t) =>
        t.id === turnId ? { ...t, pinned: !t.pinned } : t
      )
      persistRuntimeSessions()
      if (!IS_TEST_ENV) {
        return runtimeTurns.find((t) => t.id === turnId)
      }
      mockTurns = mockTurns.map((t) =>
        t.id === turnId ? { ...t, pinned: !t.pinned } : t
      )
      return mockTurns.find((t) => t.id === turnId)
    },
    async forkTurn(turnId: string): Promise<SessionSummary> {
      const bridge = getBridge()
      if (
        bridge?.harness?.forkSession &&
        lastActiveHarnessSessionId &&
        (await isHarnessLive())
      ) {
        try {
          const forked = await bridge.harness.forkSession(
            lastActiveHarnessSessionId
          )
          return mapSessionInfoToSummary(forked)
        } catch {
          // Fall back to mock fork
        }
      }
      const source = mockTurns.find((t) => t.id === turnId) ?? mockTurns[0]
      return ipcClient.sessions.createSession({
        prompt: `Forked: ${source.userPrompt}`,
      })
    },
    async cancel(sessionId: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.cloud?.cancelStream) {
        await bridge.cloud.cancelStream(sessionId).catch(() => {})
      }
      if (bridge?.harness?.cancel && (await isHarnessLive())) {
        return bridge.harness.cancel(sessionId)
      }
      return { ok: true }
    },
    async respondToPermission(
      sessionId: string,
      requestId: string,
      decision: "allow" | "allow_always" | "deny"
    ): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.harness?.respondToPermission) {
        return bridge.harness.respondToPermission(sessionId, requestId, decision)
      }
      return { ok: true }
    },
  },

  inspector: {
    async getState(): Promise<InspectorState> {
      const state: InspectorState = IS_TEST_ENV
        ? structuredClone(MOCK_INSPECTOR)
        : {
            environment: {
              host: "Local",
              project: "workspace",
              path: ".",
              branch: "main",
            },
            context: {
              usedPctLabel: "0%",
              tokensSummary: "0 / 200k tokens",
              rows: [],
              bufferRow: {
                id: "ctx_buf",
                label: "Autocompact buffer",
                tokensLabel: "0",
                pctLabel: "0%",
                colorClass: "bg-muted-ink",
              },
              freeRow: {
                id: "ctx_free",
                label: "Available window",
                tokensLabel: "200k",
                pctLabel: "100%",
                colorClass: "bg-active",
              },
              disclosures: [],
            },
            connectors: [],
            outputs: [],
            changesSummary: {
              additions: 0,
              deletions: 0,
              changedFilesCount: 0,
            },
            codeFiles: {},
            terminalLines: [],
          }
      const bridge = getBridge()
      if (bridge?.workspace?.getInfo) {
        try {
          const info = await bridge.workspace.getInfo()
          state.environment = {
            host: info.host,
            project: info.project,
            path: info.path,
            branch: info.branch,
          }
        } catch {
          // Keep default environment metadata
        }
      }
      if (bridge?.git?.getChanges) {
        try {
          const gitChanges = await bridge.git.getChanges()
          if (gitChanges) {
            state.environment.branch = gitChanges.branch
            state.changesSummary = {
              additions: gitChanges.totalAdditions,
              deletions: gitChanges.totalDeletions,
              changedFilesCount: gitChanges.files.length,
            }
          }
        } catch {
          // Keep default changes summary
        }
      }
      if (!IS_TEST_ENV && bridge?.extensions?.list) {
        try {
          const ext = await bridge.extensions.list()
          state.connectors = ext.mcpServers.map((srv) => ({
            id: srv.id,
            glyph: srv.name.slice(0, 2).toUpperCase(),
            name: srv.name,
            status: "Linked" as const,
            primary: true,
          }))
          if (ext.skills.length > 0 || ext.memories.length > 0) {
            state.context.disclosures = [
              ...(ext.skills.length > 0
                ? [
                    {
                      id: "disc_skills",
                      label: "Loaded skills",
                      count: ext.skills.length,
                      items: ext.skills.map((s) => s.name),
                    },
                  ]
                : []),
              ...(ext.memories.length > 0
                ? [
                    {
                      id: "disc_memory",
                      label: "Workspace memory files",
                      count: ext.memories.length,
                      items: ext.memories.map((m) => m.path),
                    },
                  ]
                : []),
            ]
          }
        } catch {
          // ignore
        }
      }
      return state
    },
    async getCodeFile(fileKey: string) {
      const bridge = getBridge()
      if (bridge?.workspace?.readFile && fileKey) {
        try {
          const realFile = await bridge.workspace.readFile(fileKey)
          if (realFile && realFile.lines.length > 0) {
            return realFile
          }
        } catch {
          // Fall through to test fixture or empty placeholder
        }
      }
      if (IS_TEST_ENV) {
        return (
          MOCK_INSPECTOR.codeFiles[fileKey] ??
          MOCK_INSPECTOR.codeFiles["lookup.rs"]
        )
      }
      const displayPill = fileKey || "Code"
      return {
        pill: displayPill,
        path: fileKey || "",
        language: "typescript",
        startLine: 1,
        lines: ["// Select a workspace file from Files or Diff to inspect."],
      }
    },
    async runTerminalCommand(command: string): Promise<{
      id: string
      prompt: string
      command: string
      output: string
      isOk: boolean
      isError: boolean
    } | null> {
      const bridge = getBridge()
      if (bridge?.terminal?.runCommand) {
        const res = await bridge.terminal.runCommand(command)
        return {
          id: res.id,
          prompt: res.prompt,
          command: res.command,
          output: res.output,
          isOk: res.isOk,
          isError: res.isError,
        }
      }
      return null
    },
  },

  workspace: {
    async getInfo(): Promise<WorkspaceInfo | null> {
      const bridge = getBridge()
      if (!bridge?.workspace?.getInfo) return null
      try {
        return await bridge.workspace.getInfo()
      } catch {
        return null
      }
    },
    async pickFolder(): Promise<WorkspaceInfo | null> {
      const bridge = getBridge()
      if (!bridge?.workspace?.pickFolder) return null
      return bridge.workspace.pickFolder()
    },
    async pickFiles(): Promise<
      Array<{
        name: string
        path: string
        isDirectory: boolean
        dataUrl?: string
        mediaType?: string
      }>
    > {
      const bridge = getBridge()
      if (!bridge?.workspace?.pickFiles) return []
      return bridge.workspace.pickFiles()
    },
    async captureAppshot(): Promise<{ name: string; dataUrl: string } | null> {
      const bridge = getBridge()
      if (!bridge?.workspace?.captureAppshot) return null
      return bridge.workspace.captureAppshot()
    },
    async setPath(targetPath: string): Promise<WorkspaceInfo | null> {
      const bridge = getBridge()
      if (!bridge?.workspace?.setPath) return null
      return bridge.workspace.setPath(targetPath)
    },
    async listFiles(): Promise<
      Array<{ path: string; name: string; sizeBytes: number; language: string }>
    > {
      const bridge = getBridge()
      if (!bridge?.workspace?.listFiles) return []
      try {
        return await bridge.workspace.listFiles()
      } catch {
        return []
      }
    },
    async listRecent(): Promise<
      Array<{ name: string; path: string; lastOpenedAt: number }>
    > {
      const bridge = getBridge()
      if (!bridge?.workspace?.listRecent) return []
      try {
        return await bridge.workspace.listRecent()
      } catch {
        return []
      }
    },
    async listBranches(): Promise<{ current: string; branches: string[] }> {
      const bridge = getBridge()
      if (bridge?.git?.listBranches) {
        try {
          const live = await bridge.git.listBranches()
          if (live && Array.isArray(live.branches) && live.branches.length > 0) {
            return live
          }
        } catch {
          // Fall through to default branches
        }
      }
      return {
        current: "feat/desktop-ui",
        branches: ["feat/desktop-ui", "main", "prototype-ui"],
      }
    },
    async checkoutBranch(
      branch: string
    ): Promise<{ ok: boolean; branch: string; error?: string }> {
      const bridge = getBridge()
      if (bridge?.git?.checkoutBranch) {
        try {
          return await bridge.git.checkoutBranch(branch)
        } catch (err) {
          return {
            ok: false,
            branch,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }
      return { ok: true, branch }
    },
    async createWorktree(baseBranch?: string): Promise<{
      ok: boolean
      path: string
      branch: string
      project: string
      error?: string
    }> {
      const bridge = getBridge()
      if (bridge?.git?.createWorktree) {
        try {
          return await bridge.git.createWorktree(baseBranch)
        } catch (err) {
          return {
            ok: false,
            path: "",
            branch: baseBranch ?? "main",
            project: "rayucode-v2",
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }
      const shortId = Date.now().toString(36).slice(-4)
      return {
        ok: true,
        path: `~/.rayu/worktrees/rayucode-v2-${shortId}`,
        branch: `worktree/${baseBranch ?? "main"}-${shortId}`,
        project: "rayucode-v2",
      }
    },
  },

  previews: {
    async getState(): Promise<PreviewsState> {
      return structuredClone(mockPreviews)
    },
    async updateExcelCell(input: {
      sheetId: string
      rowNumber: number
      column: string
      value: string | number
    }): Promise<PreviewsState> {
      const sheet = mockPreviews.excel.sheets.find((s) => s.id === input.sheetId)
      if (sheet) {
        const row = sheet.rows.find((r) => r.rowNumber === input.rowNumber)
        if (row) {
          const numVal = Number(input.value)
          row.cells[input.column] =
            typeof input.value === "string" &&
            input.value.trim() !== "" &&
            !Number.isNaN(numVal)
              ? numVal
              : input.value
        }
        const dataRows = sheet.rows.filter((r) => r.rowNumber >= 2 && !r.isTotal)
        const totalRow = sheet.rows.find((r) => r.isTotal)
        if (totalRow) {
          const sumC = dataRows.reduce(
            (acc, r) => acc + (Number(r.cells.C) || 0),
            0
          )
          const avgD =
            dataRows.reduce((acc, r) => acc + (Number(r.cells.D) || 0), 0) /
            Math.max(1, dataRows.length)
          const sumF = dataRows.reduce(
            (acc, r) => acc + (Number(r.cells.F) || 0),
            0
          )
          totalRow.cells.C = Math.round(sumC * 100) / 100
          totalRow.cells.D = Math.round(avgD * 10) / 10
          totalRow.cells.F = Math.round(sumF * 100) / 100
        }
      }
      return structuredClone(mockPreviews)
    },
    async sendBrowserQuestion(question: string): Promise<PreviewsState> {
      if (IS_TEST_ENV) {
        mockPreviews.browser.chatMessages.push(
          { id: `u_${Date.now()}`, sender: "user", text: question },
          {
            id: `a_${Date.now() + 1}`,
            sender: "agent",
            text: "Inspected the live page DOM and updated the active session context.",
          }
        )
        return structuredClone(mockPreviews)
      }
      mockPreviews.browser.chatMessages.push({
        id: `u_${Date.now()}`,
        sender: "user",
        text: question,
      })
      return structuredClone(mockPreviews)
    },
  },

  swarm: {
    async getState(): Promise<SwarmState> {
      const bridge = getBridge()
      if (
        bridge?.harness?.runtimeCommand &&
        lastActiveHarnessSessionId &&
        (await isHarnessLive())
      ) {
        await bridge.harness
          .runtimeCommand(lastActiveHarnessSessionId, "swarm", ["status"])
          .catch(() => {})
      }
      return structuredClone(IS_TEST_ENV ? mockSwarm : runtimeSwarm)
    },
    async spawnWorker(input: {
      name: string
      model: string
      worktree: string
      task: string
    }): Promise<SwarmState> {
      const bridge = getBridge()
      if (
        bridge?.harness?.runtimeCommand &&
        lastActiveHarnessSessionId &&
        (await isHarnessLive())
      ) {
        await bridge.harness
          .runtimeCommand(lastActiveHarnessSessionId, "swarm", [
            "spawn",
            input.name,
            input.task,
          ])
          .catch(() => {})
      }
      const worker: SwarmAgent = {
        id: input.name,
        name: input.name,
        role: input.worktree,
        worktree: input.worktree,
        state: "running",
        task: input.task,
        model: input.model,
        laneProgressLabel: "0 / 2 lane items",
        duration: "1s",
        reportsTo: "coordinator",
        todoLane: [
          { id: `${input.name}_1`, text: input.task, status: "now" },
          {
            id: `${input.name}_2`,
            text: "Run verification checks and report diff summary",
            status: "pending",
          },
        ],
        commands: [],
      }
      const target = IS_TEST_ENV ? mockSwarm : runtimeSwarm
      const wasIdle = target.agents.length === 0
      const derivedTitle =
        input.task.length > 56 ? `${input.task.slice(0, 53)}...` : input.task
      const nextWorktrees =
        input.worktree !== "local checkout"
          ? [
              ...target.worktrees,
              {
                id: `wt_${Date.now()}_${target.worktrees.length + 1}`,
                label: `wt-${target.worktrees.length + 1}`,
                branch:
                  input.worktree === "new git worktree"
                    ? `wt/${input.name}`
                    : input.worktree,
                owner: input.name,
                file: "workspace",
                additions: 0,
                deletions: 0,
              },
            ]
          : target.worktrees
      const updated: SwarmState = {
        ...target,
        swarmId:
          wasIdle && target.swarmId === "idle"
            ? `swm_${Math.random().toString(16).slice(2, 6)}`
            : target.swarmId,
        title: wasIdle ? derivedTitle : target.title,
        agents: [...target.agents, worker],
        worktrees: nextWorktrees,
        messages: [
          {
            id: `msg_${Date.now()}`,
            time: "Just now",
            from: "coordinator",
            to: input.name,
            text: `Spawned ${input.name} (${input.model}) in ${input.worktree}: ${input.task}`,
            tag: "spawned",
            isOk: true,
          },
          ...target.messages,
        ],
      }
      if (IS_TEST_ENV) mockSwarm = updated
      else runtimeSwarm = updated
      return structuredClone(updated)
    },
    async toggleAgentState(agentId: string): Promise<SwarmState> {
      const target = IS_TEST_ENV ? mockSwarm : runtimeSwarm
      const updated: SwarmState = {
        ...target,
        agents: target.agents.map((a) => {
          if (a.id !== agentId) return a
          const nextState = a.state === "stopped" ? "running" : "stopped"
          return { ...a, state: nextState }
        }),
      }
      if (IS_TEST_ENV) mockSwarm = updated
      else runtimeSwarm = updated
      return structuredClone(updated)
    },
    async sendDm(input: { agentId: string; message: string }): Promise<SwarmState> {
      const target = IS_TEST_ENV ? mockSwarm : runtimeSwarm
      const updated: SwarmState = {
        ...target,
        messages: [
          {
            id: `dm_${Date.now()}`,
            time: "Just now",
            from: "you",
            to: input.agentId,
            text: input.message,
            tag: "steering-dm",
            isOk: true,
          },
          ...target.messages,
        ],
      }
      if (IS_TEST_ENV) mockSwarm = updated
      else runtimeSwarm = updated
      return structuredClone(updated)
    },
  },

  automations: {
    async getState(): Promise<AutomationsState> {
      return structuredClone(IS_TEST_ENV ? mockAutomations : runtimeAutomations)
    },
    async launchOvernight(input: {
      mission: string
      duration: string
      maxAgents: string
      permissionMode: string
    }): Promise<AutomationsState> {
      const bridge = getBridge()
      if (
        bridge?.harness?.runtimeCommand &&
        lastActiveHarnessSessionId &&
        (await isHarnessLive())
      ) {
        await bridge.harness
          .runtimeCommand(lastActiveHarnessSessionId, "overnight", [
            "start",
            input.mission,
          ])
          .catch(() => {})
      }
      const run: OvernightRun = {
        id: `ovn_${Math.random().toString(36).slice(2, 6)}`,
        title: input.mission,
        status: "Running",
        host: "local",
        maxAgents: input.maxAgents,
        duration: input.duration,
        wakeTime: "07:00",
        handoffTime: "06:45",
        taskCardsCount: 1,
        validationsGreen: 0,
        eventLog: [
          `Just now  preflight   launched ${input.duration} (${input.permissionMode})`,
        ],
      }
      const target = IS_TEST_ENV ? mockAutomations : runtimeAutomations
      const updated: AutomationsState = {
        ...target,
        running: [run, ...target.running],
      }
      if (IS_TEST_ENV) mockAutomations = updated
      else runtimeAutomations = updated
      return structuredClone(updated)
    },
    async toggleSchedule(scheduleId: string): Promise<AutomationsState> {
      const target = IS_TEST_ENV ? mockAutomations : runtimeAutomations
      const updated: AutomationsState = {
        ...target,
        schedules: target.schedules.map((s) =>
          s.id === scheduleId ? { ...s, enabled: !s.enabled } : s
        ),
      }
      if (IS_TEST_ENV) mockAutomations = updated
      else runtimeAutomations = updated
      return structuredClone(updated)
    },
  },

  plugins: {
    async getState(): Promise<PluginsState> {
      const mapExtensionsSnapshot = (ext: {
        mcpConfigPath: string
        mcpServers: Array<{
          id: string
          name: string
          description: string
          sourcePath: string
          scope: "global" | "workspace"
          transport: "stdio" | "url"
          command?: string
          args?: string[]
          url?: string
          envKeys?: string[]
          installed: boolean
        }>
        skills: SkillItem[]
        memories: MemoryFileItem[]
      }): PluginsState => {
        const installedById = new Map(
          ext.mcpServers.map((s) => [s.id.toLowerCase(), s])
        )

        const blueprintPlugins: PluginCatalogItem[] = REAL_MCP_BLUEPRINTS.map(
          (bp) => {
            const live =
              installedById.get(bp.mcpServerId.toLowerCase()) ??
              installedById.get(bp.id.toLowerCase())
            return {
              id: bp.id,
              mcpServerId: live?.id ?? bp.mcpServerId,
              name: bp.name,
              description: live ? live.description : bp.description,
              category: bp.category,
              installed: Boolean(live),
              sourcePath: live?.sourcePath,
              scope: live?.scope ?? "global",
              transport: live?.transport ?? bp.transport,
              command: live?.command ?? bp.command,
              args: live?.args ?? bp.args,
              url: live?.url ?? bp.url,
              envKeys: live?.envKeys,
              searchKeywords: `${bp.searchKeywords} ${bp.mcpServerId}`.toLowerCase(),
            }
          }
        )

        const matchedServerIds = new Set(
          blueprintPlugins
            .filter((p) => p.installed && p.mcpServerId)
            .map((p) => p.mcpServerId!.toLowerCase())
        )

        const customMcpPlugins: PluginCatalogItem[] = ext.mcpServers
          .filter((s) => !matchedServerIds.has(s.id.toLowerCase()))
          .map((s) => ({
            id: s.id,
            mcpServerId: s.id,
            name: s.name,
            description: s.description,
            category: "featured" as const,
            installed: true,
            sourcePath: s.sourcePath,
            scope: s.scope,
            transport: s.transport,
            command: s.command,
            args: s.args,
            url: s.url,
            envKeys: s.envKeys,
            isCustomMcp: true,
            searchKeywords: `${s.name} mcp custom ${s.description}`.toLowerCase(),
          }))

        const allPlugins = [...customMcpPlugins, ...blueprintPlugins]
        return {
          featuredId: allPlugins[0]?.id ?? "Context7 Docs",
          plugins: allPlugins,
          skills: ext.skills,
          memories: ext.memories,
        }
      }

      const bridge = getBridge()
      if (!IS_TEST_ENV && bridge?.extensions?.list) {
        try {
          const ext = await bridge.extensions.list()
          return mapExtensionsSnapshot(ext)
        } catch {
          // Fall through
        }
      }
      if (!IS_TEST_ENV) {
        return mapExtensionsSnapshot({
          mcpConfigPath: "~/.rayu/mcp.json",
          mcpServers: [],
          skills: [],
          memories: [],
        })
      }
      return structuredClone(mockPlugins)
    },
    async toggleInstall(pluginId: string): Promise<PluginsState> {
      const bridge = getBridge()
      if (
        !IS_TEST_ENV &&
        bridge?.extensions?.list &&
        bridge.extensions.upsertMcp &&
        bridge.extensions.removeMcp
      ) {
        const current = await this.getState()
        const target = current.plugins.find(
          (p) =>
            p.id === pluginId ||
            p.mcpServerId?.toLowerCase() === pluginId.toLowerCase()
        )
        const serverId = target?.mcpServerId ?? pluginId
        if (target?.installed) {
          await bridge.extensions.removeMcp(serverId, target.scope)
          return this.getState()
        }
        const bp = findMcpBlueprint(pluginId)
        if (bp) {
          await bridge.extensions.upsertMcp({
            id: bp.mcpServerId,
            scope: "global",
            command: bp.command,
            args: bp.args,
            url: bp.url,
          })
          return this.getState()
        }
      }
      mockPlugins = {
        ...mockPlugins,
        plugins: mockPlugins.plugins.map((p) =>
          p.id === pluginId && !p.infoOnly
            ? { ...p, installed: !p.installed }
            : p
        ),
      }
      return structuredClone(mockPlugins)
    },
    async upsertMcp(input: {
      id: string
      scope?: "global" | "workspace"
      command?: string
      args?: string[]
      url?: string
      env?: Record<string, string>
    }): Promise<PluginsState> {
      const bridge = getBridge()
      if (bridge?.extensions?.upsertMcp) {
        await bridge.extensions.upsertMcp(input)
      }
      return this.getState()
    },
    async removeMcp(
      id: string,
      scope?: "global" | "workspace"
    ): Promise<PluginsState> {
      const bridge = getBridge()
      if (bridge?.extensions?.removeMcp) {
        await bridge.extensions.removeMcp(id, scope)
      }
      return this.getState()
    },
    async createSkill(input: {
      name: string
      description: string
      instructions?: string
    }): Promise<PluginsState> {
      const bridge = getBridge()
      if (bridge?.extensions?.createSkill) {
        await bridge.extensions.createSkill(input)
      }
      return this.getState()
    },
    async toggleSkill(skillId: string): Promise<PluginsState> {
      const bridge = getBridge()
      if (!IS_TEST_ENV && bridge?.extensions?.toggleSkill) {
        await bridge.extensions.toggleSkill(skillId)
        return this.getState()
      }
      mockPlugins = {
        ...mockPlugins,
        skills: mockPlugins.skills.map((s) =>
          s.id === skillId ? { ...s, enabled: !s.enabled } : s
        ),
      }
      return structuredClone(mockPlugins)
    },
    async setFeatured(pluginId: string): Promise<PluginsState> {
      mockPlugins = {
        ...mockPlugins,
        featuredId: pluginId,
      }
      if (!IS_TEST_ENV) {
        const next = await this.getState()
        return { ...next, featuredId: pluginId }
      }
      return structuredClone(mockPlugins)
    },
  },

  changes: {
    async getState(): Promise<ChangesState> {
      const bridge = getBridge()
      if (bridge?.git?.getChanges) {
        try {
          const live = await bridge.git.getChanges()
          // CRITICAL FIX: return live even when files.length === 0 (clean repo!),
          // never fall back to fake prototype diffs on a clean git worktree.
          if (live) {
            return live
          }
        } catch {
          // Fall through when outside a git repository
        }
      }
      if (!IS_TEST_ENV) {
        return {
          branch: "main",
          totalAdditions: 0,
          totalDeletions: 0,
          files: [],
        }
      }
      return structuredClone(mockChanges)
    },
    async acceptFile(fileId: string): Promise<ChangesState> {
      const bridge = getBridge()
      if (bridge?.git?.getChanges && bridge?.git?.toggleStage) {
        try {
          const live = await bridge.git.getChanges()
          const target = live?.files.find((f) => f.id === fileId)
          if (target) {
            const updated = await bridge.git.toggleStage(target.path, false)
            if (updated) return updated
          }
        } catch {
          // Fall back to mock state
        }
      }
      mockChanges = {
        ...mockChanges,
        files: mockChanges.files.map((f) =>
          f.id === fileId ? { ...f, accepted: true, rejected: false } : f
        ),
      }
      return structuredClone(mockChanges)
    },
    async rejectFile(fileId: string): Promise<ChangesState> {
      const bridge = getBridge()
      if (bridge?.git?.getChanges && bridge?.git?.discardFile) {
        try {
          const live = await bridge.git.getChanges()
          const target = live?.files.find((f) => f.id === fileId)
          if (target) {
            const updated = await bridge.git.discardFile(target.path)
            if (updated) return updated
          }
        } catch {
          // Fall back to mock state
        }
      }
      mockChanges = {
        ...mockChanges,
        files: mockChanges.files.map((f) =>
          f.id === fileId ? { ...f, rejected: true, accepted: false } : f
        ),
      }
      return structuredClone(mockChanges)
    },
    async toggleStage(fileId: string): Promise<ChangesState | null> {
      const bridge = getBridge()
      if (bridge?.git?.getChanges && bridge?.git?.toggleStage) {
        const live = await bridge.git.getChanges()
        const target = live?.files.find((f) => f.id === fileId)
        if (target) {
          const updated = await bridge.git.toggleStage(
            target.path,
            Boolean(target.staged)
          )
          if (updated) return updated
        }
      }
      return null
    },
    async stageAll(staged: boolean): Promise<ChangesState | null> {
      const bridge = getBridge()
      if (bridge?.git?.stageAll) {
        const updated = await bridge.git.stageAll(staged)
        if (updated) return updated
      }
      return null
    },
    async commitStaged(input: { message: string }) {
      const bridge = getBridge()
      if (bridge?.git?.commit) {
        return bridge.git.commit(input.message)
      }
      return null
    },
    async createPullRequest(input: {
      baseBranch: string
      headBranch: string
      title: string
      summary: string
    }) {
      const bridge = getBridge()
      if (bridge?.git?.createPr) {
        return bridge.git.createPr(input)
      }
      return null
    },
    async getCommits(): Promise<GitCommitSummary[]> {
      const bridge = getBridge()
      if (bridge?.git?.getCommits) {
        try {
          const live = await bridge.git.getCommits()
          if (Array.isArray(live)) {
            return live
          }
        } catch {
          // Fall back below
        }
      }
      if (!IS_TEST_ENV) {
        return []
      }
      return [
        {
          hash: "d28d576f",
          message: "feat(session): route lookups through ShardStore::lookup",
          author: "rayu@rayucode.com",
          relativeTime: "2h ago",
        },
        {
          hash: "42d20e80",
          message: "refactor(cache): retire legacy RwLock SessionCache path",
          author: "rayu@rayucode.com",
          relativeTime: "5h ago",
        },
        {
          hash: "2fe96905",
          message: "docs(migration): document KV prefix cache rollout plan",
          author: "rayu@rayucode.com",
          relativeTime: "1d ago",
        },
      ]
    },
  },

  telegram: {
    async getState(): Promise<TelegramState> {
      return structuredClone(IS_TEST_ENV ? mockTelegram : runtimeTelegram)
    },
    async setMode(mode: TelegramState["mode"]): Promise<TelegramState> {
      if (IS_TEST_ENV) {
        mockTelegram = { ...mockTelegram, mode }
        return structuredClone(mockTelegram)
      }
      runtimeTelegram = { ...runtimeTelegram, mode }
      return structuredClone(runtimeTelegram)
    },
    async resolveApproval(
      approvalId: string,
      decision: "approved" | "denied"
    ): Promise<TelegramState> {
      const target = IS_TEST_ENV ? mockTelegram : runtimeTelegram
      const updated = {
        ...target,
        approvals: target.approvals.map((a) =>
          a.id === approvalId ? { ...a, status: decision } : a
        ),
      }
      if (IS_TEST_ENV) mockTelegram = updated
      else runtimeTelegram = updated
      return structuredClone(updated)
    },
    async setRemoteUninstall(enabled: boolean): Promise<TelegramState> {
      if (IS_TEST_ENV) {
        mockTelegram = { ...mockTelegram, remoteUninstallEnabled: enabled }
        return structuredClone(mockTelegram)
      }
      runtimeTelegram = { ...runtimeTelegram, remoteUninstallEnabled: enabled }
      return structuredClone(runtimeTelegram)
    },
  },

  settings: {
    async getState(): Promise<SettingsState> {
      if (IS_TEST_ENV) {
        return structuredClone(mockSettings)
      }

      const bridge = getBridge()
      let persistedPrefs: Partial<SettingsState["preferences"]> & {
        useAllCredits?: boolean
      } = {}
      if (bridge?.storage?.getPreferences) {
        try {
          persistedPrefs = await bridge.storage.getPreferences()
        } catch {
          // ignore
        }
      }
      const mergedPrefs: SettingsState["preferences"] = {
        ...mockSettings.preferences,
        ...persistedPrefs,
      }

      const signedOutState: SettingsState = {
        account: {
          name: "Not signed in",
          username: "Guest",
          email: "Sign in to connect your Rayu Cloud account",
          plan: "Signed out",
          ageRange: "—",
          builderProfile: "Not connected",
          streakDays: 0,
          sessionsCompleted: runtimeSessions.length,
          kvSavingsPct: "0%",
        },
        usage: {
          planName: "No active plan",
          monthlyCreditsAllowance: 0,
          monthlyCreditsRemaining: 0,
          fiveHourCap: 0,
          fiveHourLeft: 0,
          weeklyCap: 0,
          weeklyLeft: 0,
          useAllCredits:
            persistedPrefs.useAllCredits ?? mockSettings.usage.useAllCredits,
          paygCredits: 0,
        },
        preferences: mergedPrefs,
      }

      if (!lastKnownAuthState?.signedIn) {
        return signedOutState
      }

      const state = structuredClone(signedOutState)
      const user = lastKnownAuthState.user
      if (user) {
        const email = user.email ?? ""
        const handle = email.includes("@")
          ? `@${email.split("@")[0]}`
          : user.role || "member"
        const displayName = user.displayName?.trim() || email || "Rayu User"
        state.account = {
          ...state.account,
          name: displayName,
          email: email || "Connected via Rayu Cloud",
          username: handle,
          builderProfile: displayName,
        }
      } else if (lastKnownAuthState.method === "apiKey") {
        state.account = {
          ...state.account,
          name: "Rayu Cloud API Key",
          email: "Authenticated via RAYU_API_KEY",
          username: "api-key",
          builderProfile: "API Key",
        }
      }

      const credits = lastKnownAuthState.credits
      if (credits) {
        const fiveHourCap = credits.creditsPer5h ?? 0
        const fiveHourUsed = credits.windowUsedCredits ?? 0
        const fiveHourLeft =
          fiveHourCap > 0
            ? Math.max(0, Math.round((fiveHourCap - fiveHourUsed) * 100) / 100)
            : 0

        const weeklyCap = credits.creditsPerWeek ?? 0
        const weeklyUsed = credits.weekUsedCredits ?? 0
        const weeklyLeft =
          weeklyCap > 0
            ? Math.max(0, Math.round((weeklyCap - weeklyUsed) * 100) / 100)
            : 0

        state.account.plan = credits.plan || "Rayu Cloud"
        state.usage = {
          ...state.usage,
          planName: credits.planName || credits.plan || "Rayu Cloud",
          monthlyCreditsAllowance: credits.creditsPerPeriod ?? 0,
          monthlyCreditsRemaining: credits.remainingCredits ?? 0,
          fiveHourCap,
          fiveHourLeft,
          weeklyCap,
          weeklyLeft,
          useAllCredits:
            credits.limitMode === "unlimited" ||
            state.usage.useAllCredits,
          paygCredits: Math.round(credits.topupBalance ?? 0),
        }
      }
      return state
    },
    async updatePreferences(
      patch: Partial<SettingsState["preferences"]>
    ): Promise<SettingsState> {
      mockSettings = {
        ...mockSettings,
        preferences: { ...mockSettings.preferences, ...patch },
      }
      const bridge = getBridge()
      if (!IS_TEST_ENV && bridge?.storage?.updatePreferences) {
        await bridge.storage.updatePreferences(patch).catch(() => {})
      }
      return ipcClient.settings.getState()
    },
    async setUseAllCredits(useAllCredits: boolean): Promise<SettingsState> {
      mockSettings = {
        ...mockSettings,
        usage: { ...mockSettings.usage, useAllCredits },
      }
      const bridge = getBridge()
      if (!IS_TEST_ENV && bridge?.storage?.updatePreferences) {
        await bridge.storage.updatePreferences({ useAllCredits }).catch(() => {})
      }
      return ipcClient.settings.getState()
    },
  },

  harness: {
    onEvent(cb: (frame: Record<string, unknown>) => void): () => void {
      localHarnessListeners.add(cb)
      const bridge = getBridge()
      const unsubBridge = bridge?.harness?.onEvent
        ? bridge.harness.onEvent(cb)
        : () => {}
      return () => {
        localHarnessListeners.delete(cb)
        unsubBridge()
      }
    },
    async setModel(sessionId: string, model: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.harness?.setModel && (await isHarnessLive())) {
        return bridge.harness.setModel(sessionId, model)
      }
      return { ok: true }
    },
    async setReasoningEffort(
      sessionId: string,
      effort: string
    ): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.harness?.setReasoningEffort && (await isHarnessLive())) {
        return bridge.harness.setReasoningEffort(sessionId, effort)
      }
      return { ok: true }
    },
    async setPermissionMode(
      sessionId: string,
      mode: PermissionModeId
    ): Promise<{ ok: boolean; error?: string }> {
      const bridge = getBridge()
      if (bridge?.harness?.setPermissionMode) {
        try {
          return await bridge.harness.setPermissionMode(sessionId, mode)
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }
      return { ok: true }
    },
  },

  daemon: {
    async getStatus(): Promise<DaemonStatus & { mode?: "live" | "demo" }> {
      const bridge = getBridge()
      if (bridge?.daemon?.getStatus) {
        try {
          const status = await bridge.daemon.getStatus()
          lastKnownDaemonLive = Boolean(
            status.connected && status.mode !== "demo"
          )
          return status
        } catch {
          lastKnownDaemonLive = false
        }
      }
      return { ...mockDaemonStatus, mode: "demo" }
    },
    async launch(): Promise<DaemonStatus & { mode?: "live" | "demo" }> {
      const bridge = getBridge()
      if (bridge?.daemon?.launch) {
        const status = await bridge.daemon.launch()
        lastKnownDaemonLive = Boolean(
          status.connected && status.mode !== "demo"
        )
        return status
      }
      return { ...mockDaemonStatus, mode: "demo" }
    },
    onStatusChange(
      cb: (status: DaemonStatus & { mode?: "live" | "demo" }) => void
    ): () => void {
      const bridge = getBridge()
      if (bridge?.daemon?.onStatusChange) {
        return bridge.daemon.onStatusChange((status) => {
          lastKnownDaemonLive = Boolean(
            status.connected && status.mode !== "demo"
          )
          cb(status)
        })
      }
      return () => {}
    },
  },

  auth: {
    async getState(): Promise<RayuAuthState> {
      const bridge = getBridge()
      if (bridge?.auth?.getState) {
        const state = await bridge.auth.getState()
        lastKnownAuthState = state
        return state
      }
      if (IS_DEV_SERVER) {
        try {
          const state = await devAuthFetch<RayuAuthState>("auth/state")
          lastKnownAuthState = state
          return state
        } catch {
          // Fall through
        }
      }
      return { ...DEFAULT_SIGNED_OUT_AUTH_STATE }
    },
    async refresh(): Promise<RayuAuthState> {
      const bridge = getBridge()
      if (bridge?.auth?.refresh) {
        const state = await bridge.auth.refresh()
        lastKnownAuthState = state
        return state
      }
      if (IS_DEV_SERVER) {
        try {
          const state = await devAuthFetch<RayuAuthState>("auth/refresh", {
            method: "POST",
          })
          lastKnownAuthState = state
          return state
        } catch {
          // Fall through
        }
      }
      return { ...DEFAULT_SIGNED_OUT_AUTH_STATE }
    },
    async signInWithBrowser(): Promise<RayuAuthState> {
      const bridge = getBridge()
      if (bridge?.auth?.signInWithBrowser) {
        const state = await bridge.auth.signInWithBrowser()
        lastKnownAuthState = state
        return state
      }
      if (IS_DEV_SERVER) {
        const state = await devAuthFetch<RayuAuthState>(
          "auth/sign-in-browser",
          { method: "POST" }
        )
        lastKnownAuthState = state
        return state
      }
      throw new Error(
        "Rayu Cloud sign-in requires the RayuCode Desktop app (Electron)."
      )
    },
    async cancelSignIn(): Promise<RayuAuthState> {
      const bridge = getBridge()
      if (bridge?.auth?.cancelSignIn) {
        const state = await bridge.auth.cancelSignIn()
        lastKnownAuthState = state
        return state
      }
      if (IS_DEV_SERVER) {
        const state = await devAuthFetch<RayuAuthState>("auth/cancel-sign-in", {
          method: "POST",
        })
        lastKnownAuthState = state
        return state
      }
      return { ...DEFAULT_SIGNED_OUT_AUTH_STATE }
    },
    async signInWithApiKey(apiKey: string): Promise<RayuAuthState> {
      const bridge = getBridge()
      if (bridge?.auth?.signInWithApiKey) {
        const state = await bridge.auth.signInWithApiKey(apiKey)
        lastKnownAuthState = state
        return state
      }
      if (IS_DEV_SERVER) {
        const state = await devAuthFetch<RayuAuthState>("auth/sign-in-apikey", {
          method: "POST",
          body: { apiKey },
        })
        lastKnownAuthState = state
        return state
      }
      throw new Error(
        "Saving a Rayu API key requires the RayuCode Desktop app (Electron)."
      )
    },
    async completeCallback(callbackUrl: string): Promise<RayuAuthState> {
      const bridge = getBridge()
      if (bridge?.auth?.completeCallback) {
        const state = await bridge.auth.completeCallback(callbackUrl)
        lastKnownAuthState = state
        return state
      }
      if (IS_DEV_SERVER) {
        const state = await devAuthFetch<RayuAuthState>(
          "auth/complete-callback",
          {
            method: "POST",
            body: { callbackUrl },
          }
        )
        lastKnownAuthState = state
        return state
      }
      throw new Error(
        "Completing Rayu Cloud sign-in requires the RayuCode Desktop app (Electron)."
      )
    },
    async signOut(): Promise<RayuAuthState> {
      const bridge = getBridge()
      if (bridge?.auth?.signOut) {
        const state = await bridge.auth.signOut()
        lastKnownAuthState = state
        return state
      }
      if (IS_DEV_SERVER) {
        try {
          const state = await devAuthFetch<RayuAuthState>("auth/sign-out", {
            method: "POST",
          })
          lastKnownAuthState = state
          return state
        } catch {
          // Fall through
        }
      }
      lastKnownAuthState = { ...DEFAULT_SIGNED_OUT_AUTH_STATE }
      return lastKnownAuthState
    },
    onAuthChange(cb: (state: RayuAuthState) => void): () => void {
      const bridge = getBridge()
      if (bridge?.auth?.onAuthChange) {
        return bridge.auth.onAuthChange((state) => {
          lastKnownAuthState = state
          cb(state)
        })
      }
      if (IS_DEV_SERVER && typeof EventSource !== "undefined") {
        const es = new EventSource("/__rayu_dev/auth/events")
        es.onmessage = (event) => {
          try {
            const state = JSON.parse(event.data) as RayuAuthState
            lastKnownAuthState = state
            cb(state)
          } catch {
            // ignore malformed event
          }
        }
        return () => {
          es.close()
        }
      }
      return () => {}
    },
  },

  cloud: {
    async streamChat(input: {
      sessionId: string
      model: string
      messages: CloudChatMessage[]
    }): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.cloud?.streamChat) {
        return bridge.cloud.streamChat(input)
      }
      if (IS_DEV_SERVER) {
        const res = await fetch("/__rayu_dev/cloud/stream-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!res.ok || !res.body) {
          throw new Error(`Rayu Cloud dev stream failed (HTTP ${res.status})`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder("utf-8")
        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split(/\r?\n\r?\n/)
          buffer = parts.pop() ?? ""
          for (const block of parts) {
            for (const line of block.split(/\r?\n/)) {
              const trimmed = line.trim()
              if (!trimmed.startsWith("data:")) continue
              try {
                const frame = JSON.parse(trimmed.slice(5).trim()) as Record<
                  string,
                  unknown
                >
                emitLocalHarnessFrame(frame)
              } catch {
                // ignore malformed frame
              }
            }
          }
        }
        return { ok: true }
      }
      throw new Error("Rayu Cloud streaming is only available in Desktop.")
    },
    async cancelStream(sessionId: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.cloud?.cancelStream) {
        return bridge.cloud.cancelStream(sessionId)
      }
      if (IS_DEV_SERVER) {
        await devAuthFetch("cloud/cancel-stream", {
          method: "POST",
          body: { sessionId },
        }).catch(() => {})
      }
      return { ok: true }
    },
  },

  native: {
    async openInExcel(filePath: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.native?.openInExcel) {
        return bridge.native.openInExcel(filePath)
      }
      return { ok: true }
    },
    async openInPowerPoint(input: {
      fileName?: string
      title: string
      slides: Array<{
        id: string
        kicker?: string
        title: string
        subtitle?: string
        body: string
        bullets?: string[]
        notes?: string
      }>
    }): Promise<{ ok: boolean; filePath: string }> {
      const bridge = getBridge()
      if (bridge?.native?.openInPowerPoint) {
        return bridge.native.openInPowerPoint(input)
      }
      return {
        ok: true,
        filePath: `~/.rayu/presentations/${(input.fileName ?? input.title)
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, "-")}.html`,
      }
    },
    async openInVSCode(
      targetPath: string,
      line?: number
    ): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.native?.openInVSCode) {
        return bridge.native.openInVSCode(targetPath, line)
      }
      return { ok: true }
    },
    async openExternal(url: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.native?.openExternal) {
        return bridge.native.openExternal(url)
      }
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(url, "_blank", "noopener,noreferrer")
      }
      return { ok: true }
    },
    async revealInFinder(targetPath: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.native?.revealInFinder) {
        return bridge.native.revealInFinder(targetPath)
      }
      return { ok: true }
    },
    async setKeepAwake(
      enabled: boolean
    ): Promise<{ ok: boolean; enabled: boolean }> {
      const bridge = getBridge()
      if (bridge?.native?.setKeepAwake) {
        return bridge.native.setKeepAwake(enabled)
      }
      return { ok: true, enabled }
    },
  },

  templates: {
    async list(): Promise<PersistedComposerTemplate[]> {
      const bridge = getBridge()
      if (bridge?.storage?.getTemplates && !IS_TEST_ENV) {
        try {
          return await bridge.storage.getTemplates()
        } catch {
          // Fall back to localStorage below
        }
      }
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem("rayu.customTemplates.v1")
          if (raw) {
            const parsed = JSON.parse(raw) as PersistedComposerTemplate[]
            if (Array.isArray(parsed)) return parsed
          }
        } catch {
          // ignore
        }
      }
      return []
    },
    async save(input: {
      id?: string
      kind: "spreadsheet" | "presentation" | "document"
      name: string
      description: string
      promptSpec: string
      accent?: "emerald" | "navy" | "amber" | "forest" | "obsidian"
    }): Promise<PersistedComposerTemplate[]> {
      const bridge = getBridge()
      if (bridge?.storage?.saveTemplate && !IS_TEST_ENV) {
        return bridge.storage.saveTemplate(input)
      }
      const existing = await ipcClient.templates.list()
      const id =
        input.id?.trim() ||
        `tpl_${input.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")}_${Date.now().toString(36)}`
      const entry: PersistedComposerTemplate = {
        id,
        kind: input.kind,
        name: input.name.trim(),
        description: input.description.trim() || "Custom reusable template",
        promptSpec: input.promptSpec.trim(),
        accent:
          input.accent ??
          (input.kind === "spreadsheet"
            ? "emerald"
            : input.kind === "presentation"
              ? "navy"
              : "obsidian"),
        createdAt: Date.now(),
      }
      const next = [entry, ...existing.filter((item) => item.id !== id)].slice(
        0,
        50
      )
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            "rayu.customTemplates.v1",
            JSON.stringify(next)
          )
        } catch {
          // ignore
        }
      }
      return next
    },
    async remove(id: string): Promise<PersistedComposerTemplate[]> {
      const bridge = getBridge()
      if (bridge?.storage?.deleteTemplate && !IS_TEST_ENV) {
        return bridge.storage.deleteTemplate(id)
      }
      const existing = await ipcClient.templates.list()
      const next = existing.filter((item) => item.id !== id)
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            "rayu.customTemplates.v1",
            JSON.stringify(next)
          )
        } catch {
          // ignore
        }
      }
      return next
    },
  },

  sidebar: {
    async getState(): Promise<SidebarState> {
      const fallback: SidebarState = {
        projects: [],
        sections: [],
        pinnedChatIds: [],
        archivedChatIds: [],
        organizeBy: "project",
        sortBy: "updated",
        showProjectChatsInRecents: true,
        manualProjectOrder: [],
      }
      const bridge = getBridge()
      if (bridge?.storage?.getSidebarState && !IS_TEST_ENV) {
        try {
          const loaded = await bridge.storage.getSidebarState()
          if (loaded && typeof loaded === "object") {
            return { ...fallback, ...loaded }
          }
        } catch {
          // Fall back to localStorage below
        }
      }
      if (typeof window !== "undefined" && !IS_TEST_ENV) {
        try {
          const raw = window.localStorage.getItem("rayu.sidebarState.v1")
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<SidebarState>
            if (parsed && typeof parsed === "object") {
              return { ...fallback, ...parsed }
            }
          }
        } catch {
          // ignore
        }
      }
      return fallback
    },
    async saveState(state: SidebarState): Promise<SidebarState> {
      const bridge = getBridge()
      if (bridge?.storage?.saveSidebarState && !IS_TEST_ENV) {
        try {
          return await bridge.storage.saveSidebarState(state)
        } catch {
          // Fall back to localStorage below
        }
      }
      if (typeof window !== "undefined" && !IS_TEST_ENV) {
        try {
          window.localStorage.setItem(
            "rayu.sidebarState.v1",
            JSON.stringify(state)
          )
        } catch {
          // ignore
        }
      }
      return state
    },
  },

  terminal: {
    hasLivePty(): boolean {
      const bridge = getBridge()
      return Boolean(
        !IS_TEST_ENV &&
          bridge?.terminal?.ptyCreate &&
          bridge?.terminal?.ptyWrite &&
          bridge?.terminal?.onPtyData
      )
    },
    async ptyCreate(input: {
      sessionId: string
      cwd?: string
      cols?: number
      rows?: number
    }): Promise<{ ok: boolean; cwd: string; shell: string }> {
      const bridge = getBridge()
      if (bridge?.terminal?.ptyCreate) {
        return bridge.terminal.ptyCreate(input)
      }
      return { ok: false, cwd: input.cwd ?? "", shell: "" }
    },
    async ptyWrite(sessionId: string, data: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.terminal?.ptyWrite) {
        return bridge.terminal.ptyWrite(sessionId, data)
      }
      return { ok: false }
    },
    async ptyResize(
      sessionId: string,
      cols: number,
      rows: number
    ): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.terminal?.ptyResize) {
        return bridge.terminal.ptyResize(sessionId, cols, rows)
      }
      return { ok: false }
    },
    async ptyKill(sessionId: string): Promise<{ ok: boolean }> {
      const bridge = getBridge()
      if (bridge?.terminal?.ptyKill) {
        return bridge.terminal.ptyKill(sessionId)
      }
      return { ok: false }
    },
    onPtyData(
      cb: (payload: { sessionId: string; data: string }) => void
    ): () => void {
      const bridge = getBridge()
      if (bridge?.terminal?.onPtyData) {
        return bridge.terminal.onPtyData(cb)
      }
      return () => {}
    },
    onPtyExit(
      cb: (payload: { sessionId: string; exitCode: number }) => void
    ): () => void {
      const bridge = getBridge()
      if (bridge?.terminal?.onPtyExit) {
        return bridge.terminal.onPtyExit(cb)
      }
      return () => {}
    },
  },

  office: {
    async pickExcelFile(): Promise<OfficeExcelWorkbookData | null> {
      const bridge = getBridge()
      if (bridge?.office?.pickExcelFile) {
        return bridge.office.pickExcelFile()
      }
      return null
    },
    async readExcel(filePath: string): Promise<OfficeExcelWorkbookData | null> {
      const bridge = getBridge()
      if (bridge?.office?.readExcel) {
        return bridge.office.readExcel(filePath)
      }
      return null
    },
    async writeExcel(input: {
      filePath: string
      sheets: OfficeExcelSheetPayload[]
    }): Promise<{ ok: boolean; filePath: string; sheetCount: number; rowCount: number }> {
      const bridge = getBridge()
      if (bridge?.office?.writeExcel) {
        return bridge.office.writeExcel(input)
      }
      return {
        ok: true,
        filePath: input.filePath,
        sheetCount: input.sheets.length,
        rowCount: input.sheets.reduce((sum, s) => sum + s.rows.length, 0),
      }
    },
    async createPowerPoint(input: {
      filePath?: string
      fileName?: string
      title: string
      slides: Array<{
        id?: string
        kicker?: string
        title: string
        subtitle?: string
        body: string
        bullets?: string[]
        metrics?: Array<{ label: string; value: string; note?: string }>
        notes?: string
        layout?: "cover" | "scorecard" | "bullets"
      }>
    }): Promise<{ ok: boolean; filePath: string; slideCount: number }> {
      const bridge = getBridge()
      if (bridge?.office?.createPowerPoint) {
        return bridge.office.createPowerPoint(input)
      }
      return {
        ok: true,
        filePath: input.filePath ?? "~/.rayu/presentations/deck.pptx",
        slideCount: input.slides.length,
      }
    },
  },

  desktop: {
    onArtifact(listener: (artifact: DesktopArtifactEvent) => void): () => void {
      const bridge = getBridge()
      if (bridge?.desktop?.onArtifact) {
        return bridge.desktop.onArtifact(listener)
      }
      return () => {}
    },
  },

  browser: {
    async navigate(url: string) {
      const bridge = getBridge()
      if (bridge?.browser?.navigate) {
        return bridge.browser.navigate(url)
      }
      return { ok: false, url, title: "", error: "Electron browser bridge unavailable" }
    },
    async snapshot() {
      const bridge = getBridge()
      if (bridge?.browser?.snapshot) {
        return bridge.browser.snapshot()
      }
      return {
        ok: false,
        url: "",
        title: "",
        refCount: 0,
        tree: "",
        error: "Electron browser bridge unavailable",
      }
    },
    async click(ref: string) {
      const bridge = getBridge()
      if (bridge?.browser?.click) {
        return bridge.browser.click(ref)
      }
      return { ok: false, message: "Electron browser bridge unavailable" }
    },
    async type(ref: string, text: string, submit?: boolean) {
      const bridge = getBridge()
      if (bridge?.browser?.type) {
        return bridge.browser.type(ref, text, submit)
      }
      return { ok: false, message: "Electron browser bridge unavailable" }
    },
    async screenshot() {
      const bridge = getBridge()
      if (bridge?.browser?.screenshot) {
        return bridge.browser.screenshot()
      }
      return {
        ok: false,
        url: "",
        title: "",
        dataUrl: "",
        error: "Electron browser bridge unavailable",
      }
    },
    onEnsureOpen(listener: (payload: { url?: string }) => void): () => void {
      const bridge = getBridge()
      if (bridge?.browser?.onEnsureOpen) {
        return bridge.browser.onEnsureOpen(listener)
      }
      return () => {}
    },
  },

  fileChanges: {
    async get(sessionId: string): Promise<FileChangesSnapshot> {
      if (!sessionId) {
        return createEmptyFileChangesSnapshot("")
      }
      const bridge = getBridge()
      if (
        bridge?.fileChanges?.get &&
        !sessionId.startsWith("ses_") &&
        !IS_TEST_ENV
      ) {
        try {
          return await bridge.fileChanges.get(sessionId)
        } catch {
          return createEmptyFileChangesSnapshot(sessionId)
        }
      }
      const existing = mockFileChangesBySession[sessionId]
      if (existing) {
        return structuredClone(existing)
      }
      return createEmptyFileChangesSnapshot(sessionId)
    },

    async diff(
      sessionId: string,
      filePath: string
    ): Promise<FileChangeDiffPayload | null> {
      if (!sessionId || !filePath) return null
      const bridge = getBridge()
      if (
        bridge?.fileChanges?.diff &&
        !sessionId.startsWith("ses_") &&
        !IS_TEST_ENV
      ) {
        try {
          return await bridge.fileChanges.diff(sessionId, filePath)
        } catch {
          return null
        }
      }
      const snap = mockFileChangesBySession[sessionId]
      const entry = snap?.files.find(
        (f) => f.path === filePath || f.display_path === filePath
      )
      if (!entry) return null
      const originalLines: string[] = []
      const modifiedLines: string[] = []
      const diffParts: string[] = [
        `--- a/${entry.old_path ?? entry.display_path}`,
        `+++ b/${entry.display_path}`,
      ]
      const entryHunks = entry.preview_hunks ?? []
      for (const hunk of entryHunks) {
        diffParts.push(hunk.header)
        for (const line of hunk.lines) {
          diffParts.push(line)
          if (line.startsWith("-")) {
            originalLines.push(line.slice(1))
          } else if (line.startsWith("+")) {
            modifiedLines.push(line.slice(1))
          } else {
            const body = line.startsWith(" ") ? line.slice(1) : line
            originalLines.push(body)
            modifiedLines.push(body)
          }
        }
      }
      return {
        path: entry.path,
        display_path: entry.display_path,
        ...(entry.old_path ? { old_path: entry.old_path } : {}),
        kind: entry.kind,
        status: entry.status,
        additions: entry.additions,
        deletions: entry.deletions,
        is_binary: entry.is_binary,
        original_content: originalLines.join("\n"),
        modified_content: modifiedLines.join("\n"),
        unified_diff: diffParts.join("\n"),
        hunks: structuredClone(entryHunks),
      }
    },

    async action(
      sessionId: string,
      action: FileChangeActionKind,
      opts?: { path?: string; force?: boolean }
    ): Promise<FileChangeActionResponse> {
      const bridge = getBridge()
      if (
        bridge?.fileChanges?.action &&
        !sessionId.startsWith("ses_") &&
        !IS_TEST_ENV
      ) {
        return bridge.fileChanges.action(sessionId, action, opts)
      }
      const existing =
        mockFileChangesBySession[sessionId] ??
        createEmptyFileChangesSnapshot(sessionId)
      const targetPath = opts?.path
      const nextFiles = existing.files.map((entry) => {
        const matches =
          !targetPath ||
          entry.path === targetPath ||
          entry.display_path === targetPath
        if (!matches) return entry
        if (action === "keep" || action === "keep_all") {
          if (entry.status !== "pending") return entry
          return { ...entry, status: "kept" as const, can_redo: false }
        }
        if (action === "undo" || action === "undo_all") {
          if (entry.status !== "pending" || !entry.undoable) return entry
          return { ...entry, status: "undone" as const, can_redo: true }
        }
        if (action === "redo" || action === "redo_all") {
          if (entry.status !== "undone" || !entry.can_redo) return entry
          return { ...entry, status: "pending" as const, can_redo: false }
        }
        return entry
      })
      const updated = recalcFileChangesSnapshot({
        ...existing,
        files: nextFiles,
      })
      mockFileChangesBySession[sessionId] = updated
      const messageMap: Record<FileChangeActionKind, string> = {
        keep: targetPath ? `Kept ${targetPath}` : "Kept file",
        undo: targetPath ? `Undid ${targetPath}` : "Undid file",
        redo: targetPath ? `Redid ${targetPath}` : "Redid file",
        keep_all: "Kept all changed files",
        undo_all: "Undid all changed files",
        redo_all: "Redid all undone files",
      }
      return {
        ok: true,
        message: messageMap[action],
        conflicts: [],
        snapshot: structuredClone(updated),
      }
    },
  },
}
