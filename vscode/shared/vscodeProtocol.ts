/**
 * RayuCode for VS Code — Frozen Host <-> Webview RPC & State Contract.
 *
 * 100% browser-safe (imports ONLY `zod`; zero Node builtins, zero `vscode` imports).
 * Shared by both the Extension Host (Node CJS) and the React 19 Webview (browser ESM).
 * Covers Specs 00..09 and Harness API v1.14 capabilities.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Core Enums & Primitives
// ---------------------------------------------------------------------------

export const AppRouteSchema = z.enum([
  "home",
  "workspace",
  "swarm",
  "automations",
  "plugins",
  "changes",
  "remote",
  "settings",
]);
export type AppRoute = z.infer<typeof AppRouteSchema>;

export const SurfaceKindSchema = z.enum(["sidebar", "editorPanel"]);
export type SurfaceKind = z.infer<typeof SurfaceKindSchema>;

export const ThemePreferenceSchema = z.enum(["auto", "dark", "light", "vscode"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const AccentPreferenceSchema = z.enum(["green", "blue"]);
export type AccentPreference = z.infer<typeof AccentPreferenceSchema>;

export const DensityPreferenceSchema = z.enum(["comfortable", "compact"]);
export type DensityPreference = z.infer<typeof DensityPreferenceSchema>;

export const PermissionModeIdSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "fullManage",
  "orchestrator",
]);
export type PermissionModeId = z.infer<typeof PermissionModeIdSchema>;

export const HarnessPermissionModeSchema = z.enum([
  "default",
  "accept_edits",
  "plan",
  "full_manage",
  "orchestrator",
]);
export type HarnessPermissionMode = z.infer<typeof HarnessPermissionModeSchema>;

const UI_TO_HARNESS_PERMISSION: Record<PermissionModeId, HarnessPermissionMode> = {
  default: "default",
  acceptEdits: "accept_edits",
  plan: "plan",
  fullManage: "full_manage",
  orchestrator: "orchestrator",
};

const HARNESS_TO_UI_PERMISSION: Record<HarnessPermissionMode, PermissionModeId> = {
  default: "default",
  accept_edits: "acceptEdits",
  plan: "plan",
  full_manage: "fullManage",
  orchestrator: "orchestrator",
};

export function toHarnessPermissionMode(mode: PermissionModeId): HarnessPermissionMode {
  return UI_TO_HARNESS_PERMISSION[mode];
}

export function fromHarnessPermissionMode(mode: string): PermissionModeId {
  if (mode in HARNESS_TO_UI_PERMISSION) {
    return HARNESS_TO_UI_PERMISSION[mode as HarnessPermissionMode];
  }
  if (mode in UI_TO_HARNESS_PERMISSION) {
    return mode as PermissionModeId;
  }
  return "default";
}

export const EffortLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

export const EffortChoiceSchema = EffortLevelSchema.nullable();
export type EffortChoice = z.infer<typeof EffortChoiceSchema>;

export const RiskTierSchema = z.enum(["safe", "bounded", "confirm", "hard_deny"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ServiceTierSchema = z.enum(["auto", "priority", "ultrafast", "flex", "off"]);
export type ServiceTier = z.infer<typeof ServiceTierSchema>;

export const CacheTtlSchema = z.enum(["5m", "1h"]);
export type CacheTtl = z.infer<typeof CacheTtlSchema>;

export const ProviderTransportSchema = z.enum(["auto", "https", "websocket"]);
export type ProviderTransport = z.infer<typeof ProviderTransportSchema>;

export const UpdateChannelSchema = z.enum(["stable", "preview", "main"]);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

export const ProjectIconColorSchema = z.enum([
  "folder",
  "brand",
  "info",
  "type",
  "num",
  "danger",
]);
export type ProjectIconColor = z.infer<typeof ProjectIconColorSchema>;

export const ProjectIconViewSchema = z.object({
  kind: z.enum(["emoji", "icon"]),
  value: z.string(),
  color: ProjectIconColorSchema.optional(),
});
export type ProjectIconView = z.infer<typeof ProjectIconViewSchema>;

// ---------------------------------------------------------------------------
// 2. Daemon, Workspace & Editor View Models
// ---------------------------------------------------------------------------

export const DaemonConnectionStateSchema = z.enum([
  "connected",
  "connecting",
  "starting",
  "reconnecting",
  "disconnected",
  "error",
]);
export type DaemonConnectionState = z.infer<typeof DaemonConnectionStateSchema>;

export const DaemonStatusViewSchema = z.object({
  state: DaemonConnectionStateSchema,
  version: z.string().optional(),
  bridgeVersion: z.string().optional(),
  protocolVersion: z.string().optional(),
  socketPath: z.string().optional(),
  latencyMs: z.number().optional(),
  pid: z.number().optional(),
  capabilities: z.array(z.string()),
  error: z.string().optional(),
  isRayuRepo: z.boolean().optional(),
});
export type DaemonStatusView = z.infer<typeof DaemonStatusViewSchema>;

export const WorkspaceFolderViewSchema = z.object({
  name: z.string(),
  path: z.string(),
  branch: z.string().optional(),
  icon: ProjectIconViewSchema.optional(),
  isPrimary: z.boolean().optional(),
});
export type WorkspaceFolderView = z.infer<typeof WorkspaceFolderViewSchema>;

export const EditorSelectionViewSchema = z.object({
  filePath: z.string(),
  relativePath: z.string(),
  languageId: z.string().optional(),
  lineStart: z.number().int().min(1),
  lineEnd: z.number().int().min(1),
  lineCount: z.number().int().min(0),
  selectedText: z.string().optional(),
});
export type EditorSelectionView = z.infer<typeof EditorSelectionViewSchema>;

export const ImageAttachmentViewSchema = z.object({
  name: z.string().optional(),
  mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  data: z.string(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type ImageAttachmentView = z.infer<typeof ImageAttachmentViewSchema>;

// ---------------------------------------------------------------------------
// 3. Sessions & Context View Models (Specs 00, 01, 02)
// ---------------------------------------------------------------------------

export const SessionSourceToolSchema = z.enum([
  "rayu",
  "claude",
  "codex",
  "cursor",
  "pi",
  "opencode",
]);
export type SessionSourceTool = z.infer<typeof SessionSourceToolSchema>;

export const SessionSummaryViewSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  workingDir: z.string().optional(),
  branch: z.string().optional(),
  status: z.enum(["idle", "running", "waiting", "error"]),
  model: z.string().optional(),
  provider: z.string().optional(),
  permissionMode: PermissionModeIdSchema.optional(),
  updatedAtMs: z.number(),
  createdAtMs: z.number().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  diffAdditions: z.number().int().nonnegative().optional(),
  diffDeletions: z.number().int().nonnegative().optional(),
  previewText: z.string().optional(),
  sourceTool: SessionSourceToolSchema.optional(),
});
export type SessionSummaryView = z.infer<typeof SessionSummaryViewSchema>;

export const SessionSearchHitViewSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  snippet: z.string(),
  sourceTool: SessionSourceToolSchema,
  workingDir: z.string().optional(),
  updatedAtMs: z.number().optional(),
  score: z.number().optional(),
});
export type SessionSearchHitView = z.infer<typeof SessionSearchHitViewSchema>;

export const HistoryImageViewSchema = z.object({
  mediaType: z.string(),
  data: z.string().optional(),
});
export type HistoryImageView = z.infer<typeof HistoryImageViewSchema>;

export const HistoryMessageViewSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  createdAtMs: z.number().optional(),
  model: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.unknown().optional(),
  images: z.array(HistoryImageViewSchema).optional(),
});
export type HistoryMessageView = z.infer<typeof HistoryMessageViewSchema>;

export const SessionHistoryViewSchema = z.object({
  sessionId: z.string(),
  messages: z.array(HistoryMessageViewSchema),
});
export type SessionHistoryView = z.infer<typeof SessionHistoryViewSchema>;

export const ContextCategoryItemViewSchema = z.object({
  name: z.string(),
  tokens: z.number().int().nonnegative(),
  detail: z.string().optional(),
  path: z.string().optional(),
});
export type ContextCategoryItemView = z.infer<typeof ContextCategoryItemViewSchema>;

export const ContextCategoryViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  tokens: z.number().int().nonnegative(),
  colorToken: z.string().optional(),
  items: z.array(ContextCategoryItemViewSchema).optional(),
});
export type ContextCategoryView = z.infer<typeof ContextCategoryViewSchema>;

export const ContextSnapshotViewSchema = z.object({
  sessionId: z.string(),
  usedTokens: z.number().int().nonnegative(),
  maxTokens: z.number().int().nonnegative(),
  usedPercent: z.number().min(0),
  freeTokens: z.number().int().nonnegative(),
  bufferTokens: z.number().int().nonnegative().optional(),
  cacheTtl: CacheTtlSchema.optional(),
  kvCacheHitPercent: z.number().min(0).max(100).optional(),
  categories: z.array(ContextCategoryViewSchema),
});
export type ContextSnapshotView = z.infer<typeof ContextSnapshotViewSchema>;

// ---------------------------------------------------------------------------
// 4. Background Process View Models (Spec 03)
// ---------------------------------------------------------------------------

export const BackgroundProcessGroupSchema = z.enum(["shells", "agents", "runtime"]);
export type BackgroundProcessGroup = z.infer<typeof BackgroundProcessGroupSchema>;

export const BackgroundProcessStatusSchema = z.enum([
  "running",
  "stalled",
  "completed",
  "failed",
  "superseded",
]);
export type BackgroundProcessStatus = z.infer<typeof BackgroundProcessStatusSchema>;

export const BackgroundProcessViewSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  group: BackgroundProcessGroupSchema,
  toolName: z.string(),
  displayName: z.string(),
  status: BackgroundProcessStatusSchema,
  progressKind: z.enum(["determinate", "indeterminate"]),
  percent: z.number().min(0).max(100).optional(),
  current: z.number().optional(),
  total: z.number().optional(),
  unit: z.string().optional(),
  summary: z.string(),
  etaSeconds: z.number().optional(),
  exitCode: z.number().int().optional(),
  outputFile: z.string().optional(),
  startedAtMs: z.number(),
  updatedAtMs: z.number(),
  durationSecs: z.number().optional(),
  stallQuietSecs: z.number().optional(),
  unread: z.boolean().optional(),
});
export type BackgroundProcessView = z.infer<typeof BackgroundProcessViewSchema>;

export const BackgroundProcessOutputViewSchema = z.object({
  taskId: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  byteLength: z.number().int().nonnegative(),
  outputFile: z.string().optional(),
  status: BackgroundProcessStatusSchema,
});
export type BackgroundProcessOutputView = z.infer<typeof BackgroundProcessOutputViewSchema>;

// ---------------------------------------------------------------------------
// 5. Swarm Mission Control View Models (Spec 04)
// ---------------------------------------------------------------------------

export const SwarmAgentStatusSchema = z.enum([
  "spawned",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "crashed",
  "stopped",
]);
export type SwarmAgentStatus = z.infer<typeof SwarmAgentStatusSchema>;

export const SwarmAgentViewSchema = z.object({
  agentId: z.string(),
  sessionId: z.string(),
  label: z.string(),
  role: z.enum(["coordinator", "worker"]),
  depth: z.number().int().nonnegative(),
  status: SwarmAgentStatusSchema,
  model: z.string().optional(),
  provider: z.string().optional(),
  currentIntent: z.string().optional(),
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
  diffAdditions: z.number().int().nonnegative().optional(),
  diffDeletions: z.number().int().nonnegative().optional(),
  todoCompleted: z.number().int().nonnegative().optional(),
  todoTotal: z.number().int().nonnegative().optional(),
  updatedAtMs: z.number().optional(),
});
export type SwarmAgentView = z.infer<typeof SwarmAgentViewSchema>;

export const SwarmBoardMessageViewSchema = z.object({
  seq: z.number().int(),
  kind: z.enum(["dm", "broadcast", "channel", "lifecycle", "completion"]),
  from: z.string(),
  to: z.string().optional(),
  channel: z.string().optional(),
  text: z.string(),
  timestampMs: z.number(),
});
export type SwarmBoardMessageView = z.infer<typeof SwarmBoardMessageViewSchema>;

export const SwarmPlanItemViewSchema = z.object({
  id: z.string(),
  phase: z.string().optional(),
  title: z.string(),
  assignee: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
});
export type SwarmPlanItemView = z.infer<typeof SwarmPlanItemViewSchema>;

export const SwarmPlanProposalViewSchema = z.object({
  proposalId: z.string(),
  version: z.number().int(),
  author: z.string(),
  summary: z.string(),
  diffSummary: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAtMs: z.number(),
});
export type SwarmPlanProposalView = z.infer<typeof SwarmPlanProposalViewSchema>;

export const SwarmWorktreeViewSchema = z.object({
  id: z.string(),
  branch: z.string(),
  path: z.string(),
  manager: z.string().optional(),
  agents: z.array(z.string()),
  dirtyFiles: z.number().int().nonnegative(),
});
export type SwarmWorktreeView = z.infer<typeof SwarmWorktreeViewSchema>;

export const SwarmConflictViewSchema = z.object({
  path: z.string(),
  agents: z.array(z.string()),
  detail: z.string().optional(),
});
export type SwarmConflictView = z.infer<typeof SwarmConflictViewSchema>;

export const SwarmSummaryViewSchema = z.object({
  swarmId: z.string(),
  label: z.string(),
  coordinatorSessionId: z.string(),
  memberCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  active: z.boolean(),
});
export type SwarmSummaryView = z.infer<typeof SwarmSummaryViewSchema>;

export const SwarmStatusViewSchema = z.object({
  swarmId: z.string(),
  label: z.string(),
  planVersion: z.number().int().nonnegative(),
  planLabel: z.string().optional(),
  creditsUsed: z.number().optional(),
  kvWarmPercent: z.number().min(0).max(100).optional(),
  agents: z.array(SwarmAgentViewSchema),
  board: z.array(SwarmBoardMessageViewSchema),
  planItems: z.array(SwarmPlanItemViewSchema),
  pendingProposals: z.array(SwarmPlanProposalViewSchema),
  worktrees: z.array(SwarmWorktreeViewSchema),
  conflicts: z.array(SwarmConflictViewSchema),
  modelAllowlist: z.array(z.string()).optional(),
});
export type SwarmStatusView = z.infer<typeof SwarmStatusViewSchema>;

// ---------------------------------------------------------------------------
// 6. Automations View Models (Spec 05)
// ---------------------------------------------------------------------------

export const OvernightStatusSchema = z.enum([
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
]);
export type OvernightStatus = z.infer<typeof OvernightStatusSchema>;

export const OvernightTaskOutcomeViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  outcome: z.string().optional(),
  validationResult: z.string().optional(),
  evidence: z.array(z.string()),
  followups: z.array(z.string()),
});
export type OvernightTaskOutcomeView = z.infer<typeof OvernightTaskOutcomeViewSchema>;

export const OvernightRunViewSchema = z.object({
  runId: z.string(),
  mission: z.string(),
  status: OvernightStatusSchema,
  mode: z.string().optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  agentCount: z.number().int().nonnegative(),
  durationLabel: z.string(),
  wakesAt: z.string().optional(),
  handoffAt: z.string().optional(),
  taskCardCount: z.number().int().nonnegative(),
  validationsGreen: z.number().int().nonnegative(),
  coordinatorSessionId: z.string().optional(),
  reviewPath: z.string().optional(),
  startedAtMs: z.number(),
  updatedAtMs: z.number().optional(),
  tasks: z.array(OvernightTaskOutcomeViewSchema).optional(),
});
export type OvernightRunView = z.infer<typeof OvernightRunViewSchema>;

export const ScheduleItemViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  cronSummary: z.string(),
  cronExpression: z.string().optional(),
  repo: z.string().optional(),
  description: z.string().optional(),
  permissionMode: PermissionModeIdSchema,
  enabled: z.boolean(),
  queuedNow: z.boolean().optional(),
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
});
export type ScheduleItemView = z.infer<typeof ScheduleItemViewSchema>;

export const AmbientApprovalViewSchema = z.object({
  id: z.string(),
  action: z.string(),
  urgency: z.enum(["low", "normal", "high"]),
  reason: z.string(),
  createdAtMs: z.number(),
  status: z.enum(["pending", "approved", "denied"]),
});
export type AmbientApprovalView = z.infer<typeof AmbientApprovalViewSchema>;

export const AmbientStatusViewSchema = z.object({
  enabled: z.boolean(),
  currentCycleStatus: z.enum(["idle", "running", "paused"]),
  nextWakeupAt: z.string().optional(),
  recentCycles: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      startedAtMs: z.number(),
      status: z.string(),
    }),
  ),
  approvals: z.array(AmbientApprovalViewSchema),
});
export type AmbientStatusView = z.infer<typeof AmbientStatusViewSchema>;

export const ProductivityReportViewSchema = z.object({
  markdown: z.string(),
  chartBase64: z.string().optional(),
  chartPath: z.string().optional(),
  generatedAtMs: z.number(),
});
export type ProductivityReportView = z.infer<typeof ProductivityReportViewSchema>;

export const QualityStatusViewSchema = z.object({
  autoReviewEnabled: z.boolean(),
  autoReviewModel: z.string().optional(),
  autoJudgeEnabled: z.boolean(),
  autoJudgeModel: z.string().optional(),
  latestProductivity: ProductivityReportViewSchema.optional(),
});
export type QualityStatusView = z.infer<typeof QualityStatusViewSchema>;

// ---------------------------------------------------------------------------
// 7. Plugins, MCP, Skills, Memory & Workspace Integrations (Spec 06)
// ---------------------------------------------------------------------------

export const McpTransportSchema = z.enum(["stdio", "streamable-http", "sse"]);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpServerStatusSchema = z.enum([
  "connected",
  "cached",
  "auth_needed",
  "disabled",
  "error",
]);
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

export const McpToolDefViewSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  description: z.string().optional(),
  tokenEstimate: z.number().int().nonnegative().optional(),
});
export type McpToolDefView = z.infer<typeof McpToolDefViewSchema>;

export const McpServerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  brandId: z.string().optional(),
  status: McpServerStatusSchema,
  enabled: z.boolean(),
  transport: McpTransportSchema,
  configLayer: z.string(),
  configPath: z.string().optional(),
  shared: z.boolean(),
  cachedToolCount: z.number().int().nonnegative().optional(),
  tokenBudgetUsed: z.number().int().nonnegative().optional(),
  oauthRequired: z.boolean().optional(),
  oauthAuthenticated: z.boolean().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  envKeys: z.array(z.string()).optional(),
  timeoutSecs: z.number().int().positive().optional(),
  error: z.string().optional(),
  tools: z.array(McpToolDefViewSchema).optional(),
});
export type McpServerView = z.infer<typeof McpServerViewSchema>;

export const SkillViewSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  scope: z.enum(["global", "project", "endorsed"]),
  allowedTools: z.array(z.string()).optional(),
  activeInSession: z.boolean().optional(),
  installed: z.boolean().optional(),
  category: z.string().optional(),
});
export type SkillView = z.infer<typeof SkillViewSchema>;

export const MemoryFactViewSchema = z.object({
  id: z.string(),
  content: z.string(),
  scope: z.enum(["project", "global"]),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
  updatedAtMs: z.number(),
  relatedIds: z.array(z.string()).optional(),
});
export type MemoryFactView = z.infer<typeof MemoryFactViewSchema>;

export const MemoryStatusViewSchema = z.object({
  enabled: z.boolean(),
  persistInjections: z.boolean(),
  pipelineActive: z.boolean(),
  totalCount: z.number().int().nonnegative(),
  facts: z.array(MemoryFactViewSchema),
});
export type MemoryStatusView = z.infer<typeof MemoryStatusViewSchema>;

export const WorkspaceIntegrationsViewSchema = z.object({
  gmail: z.object({
    connected: z.boolean(),
    account: z.string().optional(),
    actionCount: z.number().int().nonnegative(),
  }),
  calendar: z.object({
    connected: z.boolean(),
    calendarCount: z.number().int().nonnegative(),
    actionCount: z.number().int().nonnegative(),
  }),
  browser: z.object({
    detectedBrowsers: z.array(z.string()),
    handoffActive: z.boolean(),
    activeUrl: z.string().optional(),
    actionCount: z.number().int().nonnegative(),
  }),
  companion: z.object({
    running: z.boolean(),
    keepAwake: z.boolean(),
    version: z.string().optional(),
  }),
});
export type WorkspaceIntegrationsView = z.infer<typeof WorkspaceIntegrationsViewSchema>;

// ---------------------------------------------------------------------------
// 8. Changes & PR Guardrail View Models (Spec 07)
// ---------------------------------------------------------------------------

export const ChangedFileStatusSchema = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
]);
export type ChangedFileStatus = z.infer<typeof ChangedFileStatusSchema>;

export const FileReviewDecisionSchema = z.enum(["pending", "accepted", "rejected"]);
export type FileReviewDecision = z.infer<typeof FileReviewDecisionSchema>;

export const ChangedFileViewSchema = z.object({
  path: z.string(),
  status: ChangedFileStatusSchema,
  staged: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  ownerBadge: z.string().optional(),
  decision: FileReviewDecisionSchema,
  fromSession: z.boolean(),
  oldPath: z.string().optional(),
});
export type ChangedFileView = z.infer<typeof ChangedFileViewSchema>;

export const ChangesStatusViewSchema = z.object({
  branch: z.string(),
  baseBranch: z.string().optional(),
  totalAdditions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
  files: z.array(ChangedFileViewSchema),
  stagedCount: z.number().int().nonnegative(),
  hasGhCli: z.boolean().optional(),
});
export type ChangesStatusView = z.infer<typeof ChangesStatusViewSchema>;

export const FileChangeKindSchema = z.enum([
  "created",
  "modified",
  "deleted",
  "renamed",
]);
export type FileChangeKind = z.infer<typeof FileChangeKindSchema>;

export const FileChangeStatusSchema = z.enum(["pending", "kept", "undone"]);
export type FileChangeStatus = z.infer<typeof FileChangeStatusSchema>;

export const FileChangeActionKindSchema = z.enum([
  "keep",
  "undo",
  "redo",
  "keep_all",
  "undo_all",
  "redo_all",
]);
export type FileChangeActionKind = z.infer<typeof FileChangeActionKindSchema>;

export const FileChangeHunkViewSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  header: z.string(),
  lines: z.array(z.string()),
});
export type FileChangeHunkView = z.infer<typeof FileChangeHunkViewSchema>;

export const FileChangeEntryViewSchema = z.object({
  path: z.string(),
  displayPath: z.string(),
  oldPath: z.string().optional(),
  kind: FileChangeKindSchema,
  status: FileChangeStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedInLatestTurn: z.boolean(),
  turnId: z.number().int().nonnegative(),
  editCount: z.number().int().nonnegative(),
  isBinary: z.boolean(),
  undoable: z.boolean(),
  canRedo: z.boolean(),
  previewHunks: z.array(FileChangeHunkViewSchema),
  previewTruncated: z.boolean(),
  updatedAtMs: z.number(),
});
export type FileChangeEntryView = z.infer<typeof FileChangeEntryViewSchema>;

export const FileChangesSnapshotViewSchema = z.object({
  sessionId: z.string(),
  latestTurnId: z.number().int().nonnegative(),
  totalPendingFiles: z.number().int().nonnegative(),
  totalAdditions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
  files: z.array(FileChangeEntryViewSchema),
});
export type FileChangesSnapshotView = z.infer<
  typeof FileChangesSnapshotViewSchema
>;

export const FileChangeConflictViewSchema = z.object({
  path: z.string(),
  displayPath: z.string(),
  reason: z.string(),
});
export type FileChangeConflictView = z.infer<
  typeof FileChangeConflictViewSchema
>;

export const FileChangeActionResultViewSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  conflict: z.boolean().optional(),
  conflicts: z.array(FileChangeConflictViewSchema).optional(),
  snapshot: FileChangesSnapshotViewSchema.optional(),
});
export type FileChangeActionResultView = z.infer<
  typeof FileChangeActionResultViewSchema
>;

export const FileDiffViewSchema = z.object({
  path: z.string(),
  originalContent: z.string(),
  modifiedContent: z.string(),
  unifiedDiff: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  languageId: z.string().optional(),
  isBinary: z.boolean().optional(),
  kind: FileChangeKindSchema.optional(),
  status: FileChangeStatusSchema.optional(),
  oldPath: z.string().optional(),
  hunks: z.array(FileChangeHunkViewSchema).optional(),
});
export type FileDiffView = z.infer<typeof FileDiffViewSchema>;

// ---------------------------------------------------------------------------
// 9. Remote Access View Models (Spec 08)
// ---------------------------------------------------------------------------

export const TelegramApprovalViewSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  commandOrSummary: z.string(),
  requestedBy: z.string().optional(),
  createdAtMs: z.number(),
  status: z.enum(["pending", "approved", "denied"]),
  resolvedVia: z.enum(["host", "telegram"]).optional(),
});
export type TelegramApprovalView = z.infer<typeof TelegramApprovalViewSchema>;

export const TelegramStatusViewSchema = z.object({
  linked: z.boolean(),
  mode: z.enum(["hosted", "botfather"]).optional(),
  botHandle: z.string().optional(),
  chatId: z.string().optional(),
  boundSessionId: z.string().optional(),
  daemonOnline: z.boolean(),
  remoteUninstallEnabled: z.boolean(),
  pairingUrl: z.string().optional(),
  pairingCode: z.string().optional(),
  pairingExpiresAtMs: z.number().optional(),
  approvals: z.array(TelegramApprovalViewSchema),
});
export type TelegramStatusView = z.infer<typeof TelegramStatusViewSchema>;

export const GatewayDeviceViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  pairedAtMs: z.number(),
  lastSeenAtMs: z.number().optional(),
});
export type GatewayDeviceView = z.infer<typeof GatewayDeviceViewSchema>;

export const GatewayStatusViewSchema = z.object({
  enabled: z.boolean(),
  bindAddr: z.string().optional(),
  port: z.number().int().optional(),
  dialAddress: z.string().optional(),
  restartRequired: z.boolean().optional(),
  pairingQr: z
    .object({
      uri: z.string(),
      code: z.string(),
      dialAddress: z.string(),
      expiresAtMs: z.number(),
    })
    .optional(),
  devices: z.array(GatewayDeviceViewSchema),
});
export type GatewayStatusView = z.infer<typeof GatewayStatusViewSchema>;

export const RemoteSessionViewSchema = z.object({
  id: z.string(),
  kind: z.enum(["cloud", "ssh"]),
  label: z.string(),
  host: z.string().optional(),
  status: z.enum(["running", "idle", "stopped"]),
  workingDir: z.string().optional(),
  updatedAtMs: z.number().optional(),
});
export type RemoteSessionView = z.infer<typeof RemoteSessionViewSchema>;

export const RemoteInfraStatusViewSchema = z.object({
  gateway: GatewayStatusViewSchema,
  sessions: z.array(RemoteSessionViewSchema),
  cloudConfigured: z.boolean(),
  sshHosts: z.array(z.string()),
});
export type RemoteInfraStatusView = z.infer<typeof RemoteInfraStatusViewSchema>;

// ---------------------------------------------------------------------------
// 10. Settings View Models (Spec 09)
// ---------------------------------------------------------------------------

export const AccountUsageWindowViewSchema = z.object({
  label: z.string(),
  remainingPercent: z.number().min(0).max(100),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().optional(),
  resetCountdown: z.string().optional(),
});
export type AccountUsageWindowView = z.infer<typeof AccountUsageWindowViewSchema>;

export const AccountStatusViewSchema = z.object({
  signedIn: z.boolean(),
  authMethod: z.enum(["oauth", "apiKey", "none"]).optional(),
  signingIn: z.boolean().optional(),
  pendingAuthUrl: z.string().nullable().optional(),
  pendingMode: z.enum(["vscode", "loopback"]).nullable().optional(),
  webBase: z.string().optional(),
  error: z.string().nullable().optional(),
  userId: z.string().optional(),
  role: z.string().optional(),
  displayName: z.string().optional(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
  planName: z.string().optional(),
  creditsRemaining: z.number().optional(),
  creditsPerPeriod: z.number().optional(),
  usedCredits: z.number().optional(),
  topUpBalance: z.number().optional(),
  topUpEnabled: z.boolean().optional(),
  resetSeconds: z.number().optional(),
  periodEnd: z.string().optional(),
  bypassPacing: z.boolean().optional(),
  windows: z.array(AccountUsageWindowViewSchema),
  planLadder: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        priceLabel: z.string().optional(),
        current: z.boolean().optional(),
        highlights: z.array(z.string()),
      }),
    )
    .optional(),
});
export type AccountStatusView = z.infer<typeof AccountStatusViewSchema>;

export const AnalyticsSummaryViewSchema = z.object({
  range: z.enum(["7d", "30d"]),
  groupBy: z.enum(["feature", "model"]),
  totalCredits: z.number(),
  breakdown: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      credits: z.number(),
      percent: z.number(),
      colorToken: z.string(),
    }),
  ),
  topSessions: z.array(
    z.object({
      sessionId: z.string(),
      title: z.string(),
      credits: z.number(),
      model: z.string().optional(),
      updatedAtMs: z.number().optional(),
    }),
  ),
});
export type AnalyticsSummaryView = z.infer<typeof AnalyticsSummaryViewSchema>;

export const ProviderEntryViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["native", "openai_compatible", "enterprise"]),
  status: z.enum(["ready", "needs_key", "expired", "env_key"]),
  authMethod: z.enum(["oauth", "api_key", "env", "none"]).optional(),
  accountLabel: z.string().optional(),
  baseUrl: z.string().optional(),
  modelCount: z.number().int().nonnegative().optional(),
  supportsOAuth: z.boolean().optional(),
});
export type ProviderEntryView = z.infer<typeof ProviderEntryViewSchema>;

export const AgentRoleIdSchema = z.enum(["swarm", "review", "judge", "memory", "ambient"]);
export type AgentRoleId = z.infer<typeof AgentRoleIdSchema>;

export const AgentRoleOverrideViewSchema = z.object({
  role: AgentRoleIdSchema,
  label: z.string(),
  model: z.string(),
  scope: z.enum(["session", "global"]),
});
export type AgentRoleOverrideView = z.infer<typeof AgentRoleOverrideViewSchema>;

export const ModelRouteOptionViewSchema = z.object({
  id: z.string(),
  model: z.string(),
  provider: z.string(),
  label: z.string(),
  apiMethod: z.string().optional(),
  available: z.boolean().optional(),
  detail: z.string().optional(),
  supportsEffort: z.boolean().optional(),
  supportsFast: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional(),
  pricingLabel: z.string().optional(),
});
export type ModelRouteOptionView = z.infer<typeof ModelRouteOptionViewSchema>;

export const FeatureFlagsViewSchema = z.object({
  memory: z.boolean(),
  swarm: z.boolean(),
  mermaid: z.boolean(),
  auto_poke: z.boolean(),
  todo_gate_digest: z.boolean(),
  todo_gate_diagnostics: z.boolean(),
  message_timestamps: z.boolean(),
  persist_memory_injections: z.boolean(),
  kv_cache_miss_notices: z.boolean(),
  check_updates: z.boolean(),
  update_channel: UpdateChannelSchema,
  codemode: z.boolean(),
  integration_tools: z.boolean(),
});
export type FeatureFlagsView = z.infer<typeof FeatureFlagsViewSchema>;

export const VoiceStatusViewSchema = z.object({
  supported: z.boolean(),
  enabled: z.boolean(),
  deviceId: z.string().optional(),
  devices: z.array(z.object({ id: z.string(), label: z.string() })),
  noiseSuppression: z.boolean(),
  autoSendOnSilence: z.boolean(),
  hotkeyHint: z.string().optional(),
});
export type VoiceStatusView = z.infer<typeof VoiceStatusViewSchema>;

export const HookEventIdSchema = z.enum([
  "pre_tool",
  "post_tool",
  "post_tool_feedback",
  "turn_start",
  "turn_end",
  "session_start",
  "session_end",
]);
export type HookEventId = z.infer<typeof HookEventIdSchema>;

export const HookEntryViewSchema = z.object({
  event: HookEventIdSchema,
  label: z.string(),
  mode: z.enum(["sync", "async"]),
  configured: z.boolean(),
  commandSummary: z.string().optional(),
});
export type HookEntryView = z.infer<typeof HookEntryViewSchema>;

export const DoctorCheckViewSchema = z.object({
  id: z.string(),
  scope: z.enum(["providers", "auth"]),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
});
export type DoctorCheckView = z.infer<typeof DoctorCheckViewSchema>;

export const TelemetryCategorySchema = z.enum([
  "content",
  "usage",
  "crashes",
  "features",
  "cost",
  "accounts",
]);
export type TelemetryCategory = z.infer<typeof TelemetryCategorySchema>;

export const TelemetryConfigViewSchema = z.object({
  lockedByEnv: z.boolean(),
  envVarName: z.string().optional(),
  content: z.boolean(),
  usage: z.boolean(),
  crashes: z.boolean(),
  features: z.boolean(),
  cost: z.boolean(),
  accounts: z.boolean(),
});
export type TelemetryConfigView = z.infer<typeof TelemetryConfigViewSchema>;

export const ShortcutEntryViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  keybinding: z.string(),
  when: z.string().optional(),
  commandId: z.string().optional(),
});
export type ShortcutEntryView = z.infer<typeof ShortcutEntryViewSchema>;

// ---------------------------------------------------------------------------
// 11. Inspector SidePanel, Applet & Todo View Models (Spec 02)
// ---------------------------------------------------------------------------

export const SidePanelPageViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["markdown", "pdf", "html"]),
  content: z.string().optional(),
  filePath: z.string().optional(),
  updatedAtMs: z.number().optional(),
});
export type SidePanelPageView = z.infer<typeof SidePanelPageViewSchema>;

export const AppletStateViewSchema = z.object({
  appletId: z.string(),
  title: z.string(),
  kind: z.string(),
  state: z.record(z.string(), z.unknown()),
  schema: z.record(z.string(), z.unknown()).optional(),
  updatedAtMs: z.number().optional(),
});
export type AppletStateView = z.infer<typeof AppletStateViewSchema>;

export const TodoItemViewSchema = z.object({
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  activeForm: z.string().optional(),
});
export type TodoItemView = z.infer<typeof TodoItemViewSchema>;

// ---------------------------------------------------------------------------
// 12. RPC Contracts (Method Names, Request & Response Schemas)
// ---------------------------------------------------------------------------

const EmptyParamsSchema = z.object({}).optional();
const OkResultSchema = z.object({ ok: z.boolean(), message: z.string().optional() });

export const RpcContractSchemas = {
  // --- Daemon / Bridge ---
  "daemon.status": {
    params: EmptyParamsSchema,
    result: DaemonStatusViewSchema,
  },
  "daemon.ping": {
    params: EmptyParamsSchema,
    result: z.object({ ok: z.boolean(), latencyMs: z.number(), version: z.string().optional() }),
  },
  "daemon.reconnect": {
    params: EmptyParamsSchema,
    result: DaemonStatusViewSchema,
  },
  "daemon.restart": {
    params: EmptyParamsSchema,
    result: DaemonStatusViewSchema,
  },
  "daemon.reload": {
    params: EmptyParamsSchema,
    result: OkResultSchema,
  },
  "daemon.selfdev": {
    params: z.object({
      action: z.enum(["status", "build", "reload"]).default("status"),
    }),
    result: z.object({
      ok: z.boolean(),
      status: z.string(),
      output: z.string().optional(),
    }),
  },
  "daemon.openOutputLog": {
    params: EmptyParamsSchema,
    result: OkResultSchema,
  },

  // --- Workspace ---
  "workspace.listFolders": {
    params: EmptyParamsSchema,
    result: z.object({ folders: z.array(WorkspaceFolderViewSchema) }),
  },
  "workspace.findFiles": {
    params: z.object({
      sessionId: z.string().optional(),
      query: z.string(),
      limit: z.number().int().positive().max(200).optional(),
    }),
    result: z.object({ files: z.array(z.string()) }),
  },
  "workspace.contextSnapshot": {
    params: z.object({ sessionId: z.string() }),
    result: ContextSnapshotViewSchema,
  },
  "workspace.setContextCap": {
    params: z.object({
      sessionId: z.string(),
      maxTokens: z.number().int().positive().nullable(),
    }),
    result: OkResultSchema,
  },
  "workspace.compact": {
    params: z.object({ sessionId: z.string() }),
    result: OkResultSchema,
  },
  "workspace.setProjectIcon": {
    params: z.object({
      workspacePath: z.string(),
      icon: ProjectIconViewSchema.nullable(),
    }),
    result: OkResultSchema,
  },
  "workspace.pickFiles": {
    params: z.object({
      canSelectMany: z.boolean().optional(),
      filters: z.record(z.string(), z.array(z.string())).optional(),
    }),
    result: z.object({ paths: z.array(z.string()) }),
  },
  "workspace.listBranches": {
    params: z.object({ workspacePath: z.string().optional() }).optional(),
    result: z.object({ current: z.string(), branches: z.array(z.string()) }),
  },
  "workspace.checkoutBranch": {
    params: z.object({ workspacePath: z.string(), branch: z.string() }),
    result: z.object({ ok: z.boolean(), branch: z.string() }),
  },

  // --- Sessions ---
  "sessions.list": {
    params: z.object({ includeArchived: z.boolean().optional() }).optional(),
    result: z.object({
      sessions: z.array(SessionSummaryViewSchema),
      activeSessionId: z.string().optional(),
    }),
  },
  "sessions.search": {
    params: z.object({
      query: z.string(),
      scope: z.union([z.literal("all"), SessionSourceToolSchema]).optional(),
    }),
    result: z.object({ hits: z.array(SessionSearchHitViewSchema) }),
  },
  "sessions.create": {
    params: z
      .object({
        workingDir: z.string().optional(),
        permissionMode: PermissionModeIdSchema.optional(),
        model: z.string().optional(),
      })
      .optional(),
    result: z.object({ session: SessionSummaryViewSchema }),
  },
  "sessions.attach": {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ session: SessionSummaryViewSchema }),
  },
  "sessions.history": {
    params: z.object({ sessionId: z.string() }),
    result: SessionHistoryViewSchema,
  },
  "sessions.rename": {
    params: z.object({ sessionId: z.string(), title: z.string().min(1).max(200) }),
    result: z.object({ ok: z.boolean(), title: z.string() }),
  },
  "sessions.fork": {
    params: z.object({ sessionId: z.string(), atTurnId: z.string().optional() }),
    result: z.object({ session: SessionSummaryViewSchema }),
  },
  "sessions.transfer": {
    params: z.object({ sessionId: z.string(), targetWorkingDir: z.string().optional() }),
    result: z.object({ session: SessionSummaryViewSchema }),
  },
  "sessions.export": {
    params: z.object({
      sessionId: z.string(),
      format: z.enum(["markdown", "json"]).optional(),
    }),
    result: z.object({ content: z.string(), savedPath: z.string().optional() }),
  },
  "sessions.archive": {
    params: z.object({ sessionId: z.string(), archived: z.boolean() }),
    result: OkResultSchema,
  },
  "sessions.pin": {
    params: z.object({ sessionId: z.string(), pinned: z.boolean() }),
    result: OkResultSchema,
  },
  "sessions.projectIcon": {
    params: z.object({
      workspacePath: z.string(),
      icon: ProjectIconViewSchema.nullable(),
    }),
    result: OkResultSchema,
  },
  "sessions.setPermissionMode": {
    params: z.object({ sessionId: z.string(), mode: PermissionModeIdSchema }),
    result: z.object({ ok: z.boolean(), mode: PermissionModeIdSchema }),
  },
  "sessions.rewind": {
    params: z.object({ sessionId: z.string(), turnId: z.string() }),
    result: OkResultSchema,
  },
  "sessions.rewindUndo": {
    params: z.object({ sessionId: z.string() }),
    result: OkResultSchema,
  },
  "sessions.softInterrupt": {
    params: z.object({
      sessionId: z.string(),
      text: z.string().min(1),
      urgent: z.boolean().optional(),
    }),
    result: z.object({ ok: z.boolean(), interruptId: z.string().optional() }),
  },
  "sessions.cancelSoftInterrupts": {
    params: z.object({ sessionId: z.string(), interruptId: z.string().optional() }),
    result: OkResultSchema,
  },
  "sessions.respondPermission": {
    params: z.object({
      sessionId: z.string(),
      requestId: z.string(),
      decision: z.enum(["allow_once", "allow_always", "deny"]),
    }),
    result: OkResultSchema,
  },
  "sessions.respondQuestion": {
    params: z.object({
      sessionId: z.string(),
      requestId: z.string(),
      answers: z.record(z.string(), z.string()),
      notes: z.record(z.string(), z.string()).optional(),
    }),
    result: OkResultSchema,
  },

  // --- Background Tasks ---
  "background.list": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: z.object({ tasks: z.array(BackgroundProcessViewSchema) }),
  },
  "background.status": {
    params: z.object({ taskId: z.string() }),
    result: z.object({ task: BackgroundProcessViewSchema.nullable() }),
  },
  "background.output": {
    params: z.object({
      taskId: z.string(),
      maxBytes: z.number().int().positive().max(2_000_000).optional(),
    }),
    result: BackgroundProcessOutputViewSchema,
  },
  "background.cancel": {
    params: z.object({ taskId: z.string() }),
    result: OkResultSchema,
  },
  "background.cleanup": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: z.object({ ok: z.boolean(), removedCount: z.number().int().nonnegative() }),
  },
  "background.backgroundTool": {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ ok: z.boolean(), taskId: z.string().optional() }),
  },

  // --- Swarm ---
  "swarm.status": {
    params: z.object({ swarmId: z.string().optional() }).optional(),
    result: z.object({ swarm: SwarmStatusViewSchema.nullable() }),
  },
  "swarm.list": {
    params: EmptyParamsSchema,
    result: z.object({ swarms: z.array(SwarmSummaryViewSchema) }),
  },
  "swarm.setLabel": {
    params: z.object({ swarmId: z.string(), label: z.string().min(1).max(120) }),
    result: OkResultSchema,
  },
  "swarm.spawn": {
    params: z.object({
      swarmId: z.string().optional(),
      label: z.string().min(1).max(80),
      model: z.string().optional(),
      useWorktree: z.boolean().optional(),
      prompt: z.string().min(1),
    }),
    result: z.object({
      ok: z.boolean(),
      agent: SwarmAgentViewSchema.optional(),
      message: z.string().optional(),
    }),
  },
  "swarm.kill": {
    params: z.object({
      swarmId: z.string().optional(),
      agentId: z.string(),
      pauseOnly: z.boolean().optional(),
    }),
    result: OkResultSchema,
  },
  "swarm.salvage": {
    params: z.object({ swarmId: z.string().optional(), agentId: z.string() }),
    result: OkResultSchema,
  },
  "swarm.pauseAll": {
    params: z.object({ swarmId: z.string().optional() }).optional(),
    result: OkResultSchema,
  },
  "swarm.board": {
    params: z
      .object({
        swarmId: z.string().optional(),
        filter: z.enum(["all", "dm", "broadcast", "channel", "lifecycle"]).optional(),
      })
      .optional(),
    result: z.object({ messages: z.array(SwarmBoardMessageViewSchema) }),
  },
  "swarm.planDecide": {
    params: z.object({
      swarmId: z.string().optional(),
      proposalId: z.string(),
      decision: z.enum(["approve", "reject"]),
      reason: z.string().optional(),
    }),
    result: OkResultSchema,
  },
  "swarm.worktreeOpen": {
    params: z.object({ path: z.string() }),
    result: OkResultSchema,
  },
  "swarm.dm": {
    params: z.object({
      swarmId: z.string().optional(),
      agentId: z.string(),
      message: z.string().min(1),
    }),
    result: z.object({
      ok: z.boolean(),
      seq: z.number().int().optional(),
      message: z.string().optional(),
    }),
  },
  "swarm.peekSession": {
    params: z.object({ sessionId: z.string() }),
    result: z.object({
      entries: z.array(z.unknown()),
      todos: z.array(TodoItemViewSchema),
    }),
  },

  // --- Automations ---
  "automations.overnight.list": {
    params: EmptyParamsSchema,
    result: z.object({ runs: z.array(OvernightRunViewSchema) }),
  },
  "automations.overnight.start": {
    params: z.object({
      mission: z.string().min(1),
      duration: z.string().min(1),
      maxAgents: z.number().int().min(1).max(16).optional(),
      permissionMode: PermissionModeIdSchema.optional(),
      workingDir: z.string().optional(),
    }),
    result: z.object({ run: OvernightRunViewSchema }),
  },
  "automations.overnight.pause": {
    params: z.object({ runId: z.string(), resume: z.boolean().optional() }),
    result: OkResultSchema,
  },
  "automations.overnight.runNow": {
    params: z.object({ runId: z.string() }),
    result: OkResultSchema,
  },
  "automations.overnight.cancel": {
    params: z.object({ runId: z.string() }),
    result: OkResultSchema,
  },
  "automations.overnight.log": {
    params: z.object({
      runId: z.string(),
      maxLines: z.number().int().positive().max(2000).optional(),
    }),
    result: z.object({ runId: z.string(), lines: z.array(z.string()) }),
  },
  "automations.overnight.report": {
    params: z.object({ runId: z.string() }),
    result: z.object({
      run: OvernightRunViewSchema,
      markdown: z.string().optional(),
      html: z.string().optional(),
    }),
  },
  "automations.schedules.list": {
    params: EmptyParamsSchema,
    result: z.object({ schedules: z.array(ScheduleItemViewSchema) }),
  },
  "automations.schedules.create": {
    params: z.object({
      title: z.string().optional(),
      prompt: z.string().min(1),
      schedule: z.string().min(1),
      permissionMode: PermissionModeIdSchema.optional(),
    }),
    result: z.object({ schedule: ScheduleItemViewSchema }),
  },
  "automations.schedules.toggle": {
    params: z.object({ id: z.string(), enabled: z.boolean() }),
    result: OkResultSchema,
  },
  "automations.schedules.runNow": {
    params: z.object({ id: z.string() }),
    result: OkResultSchema,
  },
  "automations.schedules.cancel": {
    params: z.object({ id: z.string() }),
    result: OkResultSchema,
  },
  "automations.ambient.status": {
    params: EmptyParamsSchema,
    result: AmbientStatusViewSchema,
  },
  "automations.ambient.approvals": {
    params: EmptyParamsSchema,
    result: z.object({ approvals: z.array(AmbientApprovalViewSchema) }),
  },
  "automations.ambient.decide": {
    params: z.object({ id: z.string(), decision: z.enum(["allow", "deny"]) }),
    result: OkResultSchema,
  },
  "automations.quality.status": {
    params: EmptyParamsSchema,
    result: QualityStatusViewSchema,
  },
  "automations.quality.setAutoReview": {
    params: z.object({ enabled: z.boolean() }),
    result: z.object({ ok: z.boolean(), enabled: z.boolean() }),
  },
  "automations.quality.setAutoJudge": {
    params: z.object({ enabled: z.boolean() }),
    result: z.object({ ok: z.boolean(), enabled: z.boolean() }),
  },
  "automations.quality.runReview": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: z.object({
      ok: z.boolean(),
      sessionId: z.string().optional(),
      summary: z.string().optional(),
    }),
  },
  "automations.quality.runJudge": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: z.object({
      ok: z.boolean(),
      sessionId: z.string().optional(),
      summary: z.string().optional(),
    }),
  },
  "automations.quality.productivity": {
    params: z.object({ range: z.enum(["7d", "30d"]).optional() }).optional(),
    result: ProductivityReportViewSchema,
  },

  // --- Plugins, MCP, Skills, Memory & Workspace ---
  "plugins.mcp.list": {
    params: EmptyParamsSchema,
    result: z.object({
      servers: z.array(McpServerViewSchema),
      totalTokenBudget: z.number().int().nonnegative().optional(),
      usedTokenBudget: z.number().int().nonnegative().optional(),
    }),
  },
  "plugins.mcp.test": {
    params: z.object({ id: z.string() }),
    result: z.object({
      ok: z.boolean(),
      toolCount: z.number().int().nonnegative().optional(),
      latencyMs: z.number().optional(),
      error: z.string().optional(),
    }),
  },
  "plugins.mcp.toggle": {
    params: z.object({ id: z.string(), enabled: z.boolean() }),
    result: OkResultSchema,
  },
  "plugins.mcp.reload": {
    params: EmptyParamsSchema,
    result: z.object({ ok: z.boolean(), servers: z.array(McpServerViewSchema) }),
  },
  "plugins.mcp.add": {
    params: z.object({
      id: z.string().min(1),
      scope: z.enum(["global", "workspace"]),
      transport: McpTransportSchema,
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      url: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      shared: z.boolean().optional(),
      timeoutSecs: z.number().int().positive().optional(),
    }),
    result: z.object({
      ok: z.boolean(),
      server: McpServerViewSchema.optional(),
      message: z.string().optional(),
    }),
  },
  "plugins.mcp.edit": {
    params: z.object({
      id: z.string().min(1),
      scope: z.enum(["global", "workspace"]).optional(),
      transport: McpTransportSchema.optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      url: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      shared: z.boolean().optional(),
      timeoutSecs: z.number().int().positive().optional(),
    }),
    result: z.object({
      ok: z.boolean(),
      server: McpServerViewSchema.optional(),
      message: z.string().optional(),
    }),
  },
  "plugins.mcp.remove": {
    params: z.object({
      id: z.string().min(1),
      scope: z.enum(["global", "workspace"]).optional(),
    }),
    result: OkResultSchema,
  },
  "plugins.mcp.login": {
    params: z.object({ id: z.string() }),
    result: z.object({
      ok: z.boolean(),
      authUrl: z.string().optional(),
      message: z.string().optional(),
    }),
  },
  "plugins.mcp.logout": {
    params: z.object({ id: z.string() }),
    result: OkResultSchema,
  },
  "plugins.mcp.oauth": {
    params: z.object({
      id: z.string(),
      action: z.enum(["status", "login", "logout"]),
    }),
    result: z.object({
      ok: z.boolean(),
      authenticated: z.boolean(),
      authUrl: z.string().optional(),
      message: z.string().optional(),
    }),
  },
  "plugins.skills.list": {
    params: EmptyParamsSchema,
    result: z.object({
      skills: z.array(SkillViewSchema),
      endorsed: z.array(SkillViewSchema),
    }),
  },
  "plugins.skills.create": {
    params: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      content: z.string().optional(),
      scope: z.enum(["project", "global"]).optional(),
    }),
    result: z.object({ ok: z.boolean(), skill: SkillViewSchema }),
  },
  "plugins.skills.install": {
    params: z.object({ name: z.string().min(1) }),
    result: z.object({ ok: z.boolean(), skill: SkillViewSchema.optional() }),
  },
  "plugins.skills.reload": {
    params: EmptyParamsSchema,
    result: z.object({ ok: z.boolean(), skills: z.array(SkillViewSchema) }),
  },
  "plugins.skills.run": {
    params: z.object({
      sessionId: z.string(),
      name: z.string().min(1),
      args: z.string().optional(),
    }),
    result: OkResultSchema,
  },
  "plugins.memory.status": {
    params: EmptyParamsSchema,
    result: MemoryStatusViewSchema,
  },
  "plugins.memory.toggle": {
    params: z.object({ enabled: z.boolean() }),
    result: z.object({ ok: z.boolean(), enabled: z.boolean() }),
  },
  "plugins.memory.extract": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: z.object({ ok: z.boolean(), extractedCount: z.number().int().nonnegative().optional() }),
  },
  "plugins.memory.remember": {
    params: z.object({
      content: z.string().min(1),
      scope: z.enum(["project", "global"]).optional(),
      tags: z.array(z.string()).optional(),
    }),
    result: z.object({ ok: z.boolean(), fact: MemoryFactViewSchema }),
  },
  "plugins.memory.recall": {
    params: z
      .object({
        query: z.string().optional(),
        scope: z.enum(["project", "global", "all"]).optional(),
        tag: z.string().optional(),
      })
      .optional(),
    result: z.object({ facts: z.array(MemoryFactViewSchema) }),
  },
  "plugins.memory.search": {
    params: z.object({
      query: z.string(),
      scope: z.enum(["project", "global", "all"]).optional(),
      tag: z.string().optional(),
    }),
    result: z.object({ facts: z.array(MemoryFactViewSchema) }),
  },
  "plugins.memory.forget": {
    params: z.object({ id: z.string() }),
    result: OkResultSchema,
  },
  "plugins.memory.tag": {
    params: z.object({ id: z.string(), tags: z.array(z.string()) }),
    result: OkResultSchema,
  },
  "plugins.memory.link": {
    params: z.object({
      sourceId: z.string(),
      targetId: z.string(),
      relation: z.string().optional(),
    }),
    result: OkResultSchema,
  },
  "plugins.workspace.status": {
    params: EmptyParamsSchema,
    result: WorkspaceIntegrationsViewSchema,
  },
  "plugins.workspace.trigger": {
    params: z.object({
      integration: z.enum(["gmail", "calendar", "browser", "companion"]),
      action: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    result: z.object({
      ok: z.boolean(),
      message: z.string().optional(),
      url: z.string().optional(),
    }),
  },

  // --- Changes ---
  "changes.status": {
    params: z
      .object({
        sessionId: z.string().optional(),
        scope: z.enum(["session", "git"]).optional(),
      })
      .optional(),
    result: ChangesStatusViewSchema,
  },
  "changes.getSessionSummary": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: FileChangesSnapshotViewSchema,
  },
  "changes.diff": {
    params: z.object({
      path: z.string(),
      sessionId: z.string().optional(),
      scope: z.enum(["session", "git"]).optional(),
    }),
    result: FileDiffViewSchema,
  },
  "changes.stage": {
    params: z.object({ paths: z.array(z.string()).min(1) }),
    result: OkResultSchema,
  },
  "changes.unstage": {
    params: z.object({ paths: z.array(z.string()).min(1) }),
    result: OkResultSchema,
  },
  "changes.keep": {
    params: z.object({ path: z.string(), sessionId: z.string().optional() }),
    result: FileChangeActionResultViewSchema,
  },
  "changes.undo": {
    params: z.object({
      path: z.string(),
      sessionId: z.string().optional(),
      force: z.boolean().optional(),
    }),
    result: FileChangeActionResultViewSchema,
  },
  "changes.redo": {
    params: z.object({
      path: z.string(),
      sessionId: z.string().optional(),
      force: z.boolean().optional(),
    }),
    result: FileChangeActionResultViewSchema,
  },
  "changes.keepAll": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: FileChangeActionResultViewSchema,
  },
  "changes.undoAll": {
    params: z
      .object({
        sessionId: z.string().optional(),
        force: z.boolean().optional(),
      })
      .optional(),
    result: FileChangeActionResultViewSchema,
  },
  "changes.redoAll": {
    params: z
      .object({
        sessionId: z.string().optional(),
        force: z.boolean().optional(),
      })
      .optional(),
    result: FileChangeActionResultViewSchema,
  },
  "changes.commit": {
    params: z.object({ message: z.string().min(1) }),
    result: z.object({
      ok: z.boolean(),
      commitHash: z.string().optional(),
      summary: z.string().optional(),
    }),
  },
  "changes.createPr": {
    params: z.object({
      baseBranch: z.string().min(1),
      headBranch: z.string().min(1),
      title: z.string().min(1),
      body: z.string(),
      draft: z.boolean().optional(),
    }),
    result: z.object({
      ok: z.boolean(),
      url: z.string().optional(),
      number: z.number().int().optional(),
    }),
  },

  // --- Remote (Telegram, Cloud, SSH, WS Gateway) ---
  "remote.telegram.status": {
    params: EmptyParamsSchema,
    result: TelegramStatusViewSchema,
  },
  "remote.telegram.linkHosted": {
    params: EmptyParamsSchema,
    result: TelegramStatusViewSchema,
  },
  "remote.telegram.linkBotfather": {
    params: z.object({
      botToken: z.string().min(1),
      allowedChatId: z.string().optional(),
    }),
    result: TelegramStatusViewSchema,
  },
  "remote.telegram.disconnect": {
    params: EmptyParamsSchema,
    result: OkResultSchema,
  },
  "remote.telegram.testPing": {
    params: EmptyParamsSchema,
    result: OkResultSchema,
  },
  "remote.telegram.driveSession": {
    params: z.object({ sessionId: z.string() }),
    result: OkResultSchema,
  },
  "remote.telegram.uninstallToggle": {
    params: z.object({ enabled: z.boolean() }),
    result: z.object({ ok: z.boolean(), enabled: z.boolean() }),
  },
  "remote.telegram.approvals": {
    params: EmptyParamsSchema,
    result: z.object({ approvals: z.array(TelegramApprovalViewSchema) }),
  },
  "remote.telegram.decide": {
    params: z.object({ id: z.string(), decision: z.enum(["allow", "deny"]) }),
    result: OkResultSchema,
  },
  "remote.infra.status": {
    params: EmptyParamsSchema,
    result: RemoteInfraStatusViewSchema,
  },
  "remote.gateway.toggle": {
    params: z.object({ enabled: z.boolean() }),
    result: GatewayStatusViewSchema,
  },
  "remote.gateway.pair": {
    params: EmptyParamsSchema,
    result: GatewayStatusViewSchema,
  },
  "remote.gateway.revoke": {
    params: z.object({ deviceId: z.string() }),
    result: OkResultSchema,
  },
  "remote.cloud.moveToCloud": {
    params: z.object({ sessionId: z.string() }),
    result: z.object({
      ok: z.boolean(),
      remoteSessionId: z.string().optional(),
      message: z.string().optional(),
    }),
  },
  "remote.cloud.returnLocal": {
    params: z.object({ remoteSessionId: z.string() }),
    result: z.object({
      ok: z.boolean(),
      sessionId: z.string().optional(),
      message: z.string().optional(),
    }),
  },
  "remote.cloud.attach": {
    params: z.object({ remoteSessionId: z.string() }),
    result: z.object({
      ok: z.boolean(),
      sessionId: z.string().optional(),
      message: z.string().optional(),
    }),
  },
  "remote.cloud.syncEnv": {
    params: EmptyParamsSchema,
    result: OkResultSchema,
  },

  // --- Settings ---
  "settings.account.get": {
    params: EmptyParamsSchema,
    result: AccountStatusViewSchema,
  },
  "settings.account.refresh": {
    params: EmptyParamsSchema,
    result: AccountStatusViewSchema,
  },
  "settings.account.signInBrowser": {
    params: z
      .object({
        mode: z.enum(["vscode", "loopback"]).optional(),
      })
      .optional(),
    result: z.object({
      ok: z.boolean(),
      authUrl: z.string().optional(),
      state: AccountStatusViewSchema.optional(),
    }),
  },
  "settings.account.cancelSignIn": {
    params: EmptyParamsSchema,
    result: AccountStatusViewSchema,
  },
  "settings.account.signInApiKey": {
    params: z.object({ apiKey: z.string().min(1) }),
    result: AccountStatusViewSchema,
  },
  "settings.account.completeCallback": {
    params: z.object({ callbackUrl: z.string().min(1) }),
    result: AccountStatusViewSchema,
  },
  "settings.account.signOut": {
    params: EmptyParamsSchema,
    result: AccountStatusViewSchema,
  },
  "settings.account.setBypassPacing": {
    params: z.object({ enabled: z.boolean() }),
    result: z.object({ ok: z.boolean(), enabled: z.boolean() }),
  },
  "settings.analytics.get": {
    params: z.object({
      range: z.enum(["7d", "30d"]),
      groupBy: z.enum(["feature", "model"]),
    }),
    result: AnalyticsSummaryViewSchema,
  },
  "settings.providers.list": {
    params: EmptyParamsSchema,
    result: z.object({ providers: z.array(ProviderEntryViewSchema) }),
  },
  "settings.providers.setApiKey": {
    params: z.object({
      providerId: z.string().min(1),
      apiKey: z.string().min(1),
      baseUrl: z.string().optional(),
    }),
    result: OkResultSchema,
  },
  "settings.providers.clearApiKey": {
    params: z.object({ providerId: z.string().min(1) }),
    result: OkResultSchema,
  },
  "settings.providers.logout": {
    params: z.object({ providerId: z.string().min(1) }),
    result: OkResultSchema,
  },
  "settings.doctor.run": {
    params: z.object({ scope: z.enum(["providers", "auth"]) }),
    result: z.object({
      checks: z.array(DoctorCheckViewSchema),
      ranAtMs: z.number(),
    }),
  },
  "settings.models.get": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: z.object({
      defaultModel: z.string().optional(),
      defaultEffort: EffortChoiceSchema,
      serviceTier: ServiceTierSchema,
      cacheTtl: CacheTtlSchema,
      transport: ProviderTransportSchema,
      roleOverrides: z.array(AgentRoleOverrideViewSchema),
      swarmAllowlist: z.array(z.string()).optional(),
      routes: z.array(ModelRouteOptionViewSchema).optional(),
    }),
  },
  "settings.models.refresh": {
    params: z.object({ sessionId: z.string().optional() }).optional(),
    result: z.object({
      ok: z.boolean(),
      routeCount: z.number().int().nonnegative().optional(),
      routes: z.array(ModelRouteOptionViewSchema).optional(),
    }),
  },
  "settings.models.setFast": {
    params: z.object({ tier: ServiceTierSchema, sessionId: z.string().optional() }),
    result: z.object({ ok: z.boolean(), tier: ServiceTierSchema }),
  },
  "settings.models.setCacheTtl": {
    params: z.object({ ttl: CacheTtlSchema, sessionId: z.string().optional() }),
    result: z.object({ ok: z.boolean(), ttl: CacheTtlSchema }),
  },
  "settings.models.setTransport": {
    params: z.object({ transport: ProviderTransportSchema }),
    result: z.object({ ok: z.boolean(), transport: ProviderTransportSchema }),
  },
  "settings.models.setRoleOverride": {
    params: z.object({
      role: AgentRoleIdSchema,
      model: z.string(),
      scope: z.enum(["session", "global"]),
      sessionId: z.string().optional(),
    }),
    result: OkResultSchema,
  },
  "settings.features.get": {
    params: EmptyParamsSchema,
    result: z.object({
      features: FeatureFlagsViewSchema,
      voice: VoiceStatusViewSchema,
      telemetry: TelemetryConfigViewSchema,
    }),
  },
  "settings.features.set": {
    params: z.object({
      key: z.string(),
      value: z.union([z.boolean(), z.string()]),
    }),
    result: z.object({ ok: z.boolean(), features: FeatureFlagsViewSchema }),
  },
  "settings.voice.update": {
    params: z.object({
      enabled: z.boolean().optional(),
      deviceId: z.string().optional(),
      noiseSuppression: z.boolean().optional(),
      autoSendOnSilence: z.boolean().optional(),
    }),
    result: VoiceStatusViewSchema,
  },
  "settings.telemetry.set": {
    params: z.object({
      category: z.union([TelemetryCategorySchema, z.literal("all"), z.literal("none")]),
      enabled: z.boolean().optional(),
    }),
    result: TelemetryConfigViewSchema,
  },
  "settings.hooks.list": {
    params: EmptyParamsSchema,
    result: z.object({
      hooks: z.array(HookEntryViewSchema),
      configPath: z.string().optional(),
    }),
  },
  "settings.hooks.openConfig": {
    params: EmptyParamsSchema,
    result: OkResultSchema,
  },
  "settings.shortcuts.list": {
    params: EmptyParamsSchema,
    result: z.object({ shortcuts: z.array(ShortcutEntryViewSchema) }),
  },
  "settings.shortcuts.openKeybindings": {
    params: EmptyParamsSchema,
    result: OkResultSchema,
  },
  "settings.runtime.get": {
    params: EmptyParamsSchema,
    result: z.object({
      socketPath: z.string(),
      binaryPath: z.string(),
      autoStart: z.boolean(),
      transport: ProviderTransportSchema,
    }),
  },
  "settings.runtime.update": {
    params: z.object({
      socketPath: z.string().optional(),
      binaryPath: z.string().optional(),
      autoStart: z.boolean().optional(),
    }),
    result: OkResultSchema,
  },
  "settings.feedback.submit": {
    params: z.object({
      kind: z.enum(["bug", "suggestion", "usability"]),
      summary: z.string().min(1),
      details: z.string().optional(),
    }),
    result: OkResultSchema,
  },

  // --- Inspector (SidePanel, Applet, Todos) ---
  "inspector.sidePanel.get": {
    params: z.object({ sessionId: z.string() }),
    result: z.object({
      pages: z.array(SidePanelPageViewSchema),
      activePageId: z.string().optional(),
    }),
  },
  "inspector.sidePanel.close": {
    params: z.object({ sessionId: z.string(), pageId: z.string().optional() }),
    result: OkResultSchema,
  },
  "inspector.applet.get": {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ applets: z.array(AppletStateViewSchema) }),
  },
  "inspector.applet.action": {
    params: z.object({
      sessionId: z.string(),
      appletId: z.string(),
      action: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    result: z.object({ ok: z.boolean(), applet: AppletStateViewSchema.optional() }),
  },
  "inspector.applet.close": {
    params: z.object({ sessionId: z.string(), appletId: z.string() }),
    result: OkResultSchema,
  },
  "inspector.todos.get": {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ todos: z.array(TodoItemViewSchema) }),
  },
} as const;

export type RpcMethod = keyof typeof RpcContractSchemas;

export const RPC_METHODS = Object.keys(RpcContractSchemas) as [RpcMethod, ...RpcMethod[]];
export const RpcMethodSchema = z.enum(RPC_METHODS);

export type RpcParams<M extends RpcMethod> = z.infer<(typeof RpcContractSchemas)[M]["params"]>;
export type RpcResult<M extends RpcMethod> = z.infer<(typeof RpcContractSchemas)[M]["result"]>;

export type RpcRequestMap = {
  [M in RpcMethod]: RpcParams<M>;
};

export type RpcResponseMap = {
  [M in RpcMethod]: RpcResult<M>;
};

// ---------------------------------------------------------------------------
// 13. Webview <-> Host postMessage Envelopes
// ---------------------------------------------------------------------------

export const WebviewToHostMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rayucode.webview.ready"),
    surface: SurfaceKindSchema,
  }),
  z.object({
    type: z.literal("rayucode.rpc.call"),
    id: z.number().int().nonnegative(),
    method: RpcMethodSchema,
    params: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("rayucode.harness.request"),
    frame: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("rayucode.ui.openEditorPanel"),
    route: AppRouteSchema.optional(),
    sessionId: z.string().optional(),
  }),
  z.object({
    type: z.literal("rayucode.ui.setAppearance"),
    theme: ThemePreferenceSchema.optional(),
    accent: AccentPreferenceSchema.optional(),
    density: DensityPreferenceSchema.optional(),
    reduceMotion: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("rayucode.editor.openFile"),
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    preview: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("rayucode.editor.openDiff"),
    path: z.string().min(1),
    sessionId: z.string().optional(),
    scope: z.enum(["session", "git"]).optional(),
  }),
  z.object({
    type: z.literal("rayucode.editor.insertCode"),
    code: z.string(),
    mode: z.enum(["cursor", "diff"]),
    languageId: z.string().optional(),
  }),
  z.object({
    type: z.literal("rayucode.editor.openTerminal"),
    cwd: z.string().optional(),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("rayucode.editor.openWorktreeWindow"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("rayucode.editor.openMarkdownPreview"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("rayucode.editor.openSimpleBrowser"),
    url: z.string().min(1),
  }),
  z.object({
    type: z.literal("rayucode.editor.openExternal"),
    url: z.string().min(1),
  }),
  z.object({
    type: z.literal("rayucode.editor.copy"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("rayucode.dialog.pickFiles"),
    requestId: z.string().min(1),
    canSelectMany: z.boolean().optional(),
    filters: z.record(z.string(), z.array(z.string())).optional(),
  }),
  z.object({
    type: z.literal("rayucode.dialog.pickFolder"),
    requestId: z.string().min(1),
  }),
  z.object({
    type: z.literal("rayucode.host.copyToClipboard"),
    text: z.string(),
  }),
]);
export type WebviewToHostMessage = z.infer<typeof WebviewToHostMessageSchema>;

export const RpcResultSuccessSchema = z.object({
  type: z.literal("rayucode.rpc.result"),
  id: z.number().int().nonnegative(),
  ok: z.literal(true),
  data: z.unknown(),
});

export const RpcResultErrorSchema = z.object({
  type: z.literal("rayucode.rpc.result"),
  id: z.number().int().nonnegative(),
  ok: z.literal(false),
  code: z.string(),
  error: z.string(),
});

export const HostToWebviewMessageSchema = z.union([
  z.object({
    type: z.literal("rayucode.host.init"),
    surface: SurfaceKindSchema,
    mediaBaseUri: z.string(),
    theme: ThemePreferenceSchema,
    accent: AccentPreferenceSchema,
    density: DensityPreferenceSchema.optional(),
    reduceMotion: z.boolean().optional(),
    route: AppRouteSchema,
    sessionId: z.string().optional(),
    capabilities: z.array(z.string()),
    daemonStatus: DaemonStatusViewSchema,
    workspaces: z.array(WorkspaceFolderViewSchema),
    editorSelection: EditorSelectionViewSchema.nullable().optional(),
    backgroundTasks: z.array(BackgroundProcessViewSchema).optional(),
    accountStatus: AccountStatusViewSchema.optional(),
    fileChanges: FileChangesSnapshotViewSchema.nullable().optional(),
  }),
  RpcResultSuccessSchema,
  RpcResultErrorSchema,
  z.object({
    type: z.literal("rayucode.account.changed"),
    account: AccountStatusViewSchema,
  }),
  z.object({
    type: z.literal("rayucode.fileChanges.updated"),
    sessionId: z.string(),
    snapshot: FileChangesSnapshotViewSchema,
  }),
  z.object({
    type: z.literal("rayucode.harness.frame"),
    frame: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("rayucode.editor.selectionChanged"),
    selection: EditorSelectionViewSchema.nullable(),
  }),
  z.object({
    type: z.literal("rayucode.processes.snapshot"),
    tasks: z.array(BackgroundProcessViewSchema),
  }),
  z.object({
    type: z.literal("rayucode.daemon.statusChanged"),
    status: DaemonStatusViewSchema,
  }),
  z.object({
    type: z.literal("rayucode.workspaces.changed"),
    workspaces: z.array(WorkspaceFolderViewSchema),
  }),
  z.object({
    type: z.literal("rayucode.ui.navigate"),
    route: AppRouteSchema,
    sessionId: z.string().optional(),
    openProcessesDrawer: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("rayucode.ui.appearanceSync"),
    theme: ThemePreferenceSchema,
    accent: AccentPreferenceSchema,
    density: DensityPreferenceSchema.optional(),
    reduceMotion: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("rayucode.dialog.filesPicked"),
    requestId: z.string(),
    paths: z.array(z.string()),
  }),
  z.object({
    type: z.literal("rayucode.host.command"),
    command: z.string(),
    payload: z.unknown().optional(),
  }),
]);
export type HostToWebviewMessage = z.infer<typeof HostToWebviewMessageSchema>;

// ---------------------------------------------------------------------------
// 14. Runtime Safe Parsers
// ---------------------------------------------------------------------------

export function parseWebviewToHostMessage(raw: unknown) {
  return WebviewToHostMessageSchema.safeParse(raw);
}

export function parseHostToWebviewMessage(raw: unknown) {
  return HostToWebviewMessageSchema.safeParse(raw);
}

export function parseRpcParams<M extends RpcMethod>(method: M, raw: unknown) {
  return RpcContractSchemas[method].params.safeParse(raw);
}
