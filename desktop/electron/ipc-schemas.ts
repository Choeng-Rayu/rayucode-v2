import { z } from "zod"

export const DaemonInvokePayloadSchema = z.object({
  method: z.string().min(1),
  params: z.unknown().optional(),
})

export const OpenInExcelPayloadSchema = z.object({
  filePath: z.string().min(1),
})

export const OpenInPowerPointPayloadSchema = z.object({
  fileName: z.string().max(160).optional(),
  title: z.string().min(1).max(240),
  slides: z
    .array(
      z.object({
        id: z.string().min(1),
        kicker: z.string().optional(),
        title: z.string().min(1),
        subtitle: z.string().optional(),
        body: z.string(),
        bullets: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
    )
    .min(1)
    .max(60),
})

export const OpenInVSCodePayloadSchema = z.object({
  targetPath: z.string().min(1),
  line: z.number().int().positive().optional(),
})

export const OpenExternalPayloadSchema = z.object({
  url: z.string().url(),
})

export const WorkspaceSetPayloadSchema = z.object({
  path: z.string().min(1),
})

export const WorkspaceReadFilePayloadSchema = z.object({
  filePath: z.string().min(1),
})

export const TerminalRunPayloadSchema = z.object({
  command: z.string().trim().min(1).max(4000),
})

export const GitToggleStagePayloadSchema = z.object({
  filePath: z.string().min(1),
  staged: z.boolean(),
})

export const GitStageAllPayloadSchema = z.object({
  staged: z.boolean(),
})

export const GitDiscardFilePayloadSchema = z.object({
  filePath: z.string().min(1),
})

export const GitCommitPayloadSchema = z.object({
  message: z.string().trim().min(3).max(200),
})

export const GitCreatePrPayloadSchema = z.object({
  baseBranch: z.string().trim().min(1),
  headBranch: z.string().trim().min(1),
  title: z.string().trim().min(3),
  summary: z.string().trim().min(5),
})

export const HarnessSessionIdSchema = z.object({
  sessionId: z.string().min(1),
})

export const HarnessCreateSessionSchema = z.object({
  workingDir: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
})

export const HarnessRenameSessionSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
})

export const HarnessSendMessageSchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().trim().min(1).max(100_000),
})

export const HarnessPermissionResponseSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  decision: z.enum(["allow", "allow_always", "deny"]),
})

export const HarnessSetModelSchema = z.object({
  sessionId: z.string().min(1),
  model: z.string().min(1).max(256),
})

export const HarnessSetEffortSchema = z.object({
  sessionId: z.string().min(1),
  effort: z.string().min(1).max(64),
})

export const HarnessRuntimeCommandSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
})

export const AuthApiKeyPayloadSchema = z.object({
  apiKey: z.string().trim().min(10).max(512),
})

export const AuthCallbackUrlPayloadSchema = z.object({
  callbackUrl: z.string().trim().min(8).max(4096),
})

export const CloudStreamChatPayloadSchema = z.object({
  sessionId: z.string().min(1),
  model: z.string().min(1).max(256),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
})

export const CloudCancelStreamPayloadSchema = z.object({
  sessionId: z.string().min(1),
})

export const StoragePreferencesPatchSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  voiceModel: z.string().min(1).max(128).optional(),
  autoCompactContext: z.boolean().optional(),
  showMiniPet: z.boolean().optional(),
  defaultPermissionMode: z
    .enum(["default", "acceptEdits", "plan", "fullManage", "orchestrator"])
    .optional(),
  useAllCredits: z.boolean().optional(),
  defaultModel: z.string().min(1).max(128).optional(),
  kvCacheTtl: z.string().min(1).max(64).optional(),
})

export const StorageSessionStoreSchema = z.object({
  sessions: z.array(z.unknown()).max(100),
  turns: z.array(z.unknown()).max(1000),
})

export const StorageSaveTemplateSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(["spreadsheet", "presentation", "document"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).default(""),
  promptSpec: z.string().trim().min(1).max(8000),
  accent: z
    .enum(["emerald", "navy", "amber", "forest", "obsidian"])
    .optional(),
})

export const StorageDeleteTemplateSchema = z.object({
  id: z.string().trim().min(1).max(120),
})

export const ExtensionUpsertMcpSchema = z.object({
  id: z.string().trim().min(1).max(80),
  scope: z.enum(["global", "workspace"]).optional(),
  command: z.string().trim().max(512).optional(),
  args: z.array(z.string().max(512)).max(32).optional(),
  url: z.string().trim().max(2048).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

export const ExtensionRemoveMcpSchema = z.object({
  id: z.string().trim().min(1).max(80),
  scope: z.enum(["global", "workspace"]).optional(),
})

export const ExtensionCreateSkillSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  instructions: z.string().max(16_000).optional(),
})

export const ExtensionToggleSkillSchema = z.object({
  skillId: z.string().trim().min(1).max(160),
})

export type DaemonInvokePayload = z.infer<typeof DaemonInvokePayloadSchema>
export type OpenInExcelPayload = z.infer<typeof OpenInExcelPayloadSchema>
export type OpenInVSCodePayload = z.infer<typeof OpenInVSCodePayloadSchema>
export type OpenExternalPayload = z.infer<typeof OpenExternalPayloadSchema>
