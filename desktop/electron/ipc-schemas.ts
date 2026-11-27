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

export const RevealInFinderPayloadSchema = z.object({
  targetPath: z.string().trim().min(1).max(2048),
})

export const KeepAwakePayloadSchema = z.object({
  enabled: z.boolean(),
})

export const WorkspaceSetPayloadSchema = z.object({
  path: z.string().min(1),
})

export const WorkspaceEnsurePayloadSchema = z.object({
  path: z.string().trim().min(1).max(2048),
  name: z.string().trim().min(1).max(120).optional(),
})

export const WorkspaceImportProjectGroupPayloadSchema = z.object({
  path: z.string().trim().min(1).max(2048),
  name: z.string().trim().min(1).max(120).optional(),
  sessionIds: z.array(z.string().min(1)).max(500),
})

export const HarnessListSessionsPayloadSchema = z
  .object({
    includeArchived: z.boolean().optional(),
    includeExternal: z.boolean().optional(),
    sources: z.array(z.string().min(1)).max(20).optional(),
  })
  .optional()

export const HarnessListExternalProjectsPayloadSchema = z
  .object({
    source: z.string().min(1).max(64).optional(),
  })
  .optional()

export const HarnessImportExternalSessionsPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        source: z.string().min(1).max(64),
        external_session_id: z.string().min(1).max(256),
        external_path: z.string().max(4096).optional(),
        working_dir: z.string().max(4096).optional(),
      })
    )
    .min(1)
    .max(500),
  forceResync: z.boolean().optional(),
  forkOnConflict: z.boolean().optional(),
})

export const WorkspaceReadFilePayloadSchema = z.object({
  filePath: z.string().min(1),
})

export const TerminalRunPayloadSchema = z.object({
  command: z.string().trim().min(1).max(4000),
})

export const TerminalPtyCreatePayloadSchema = z.object({
  sessionId: z.string().min(1).max(120),
  cwd: z.string().max(2048).optional(),
  cols: z.number().int().min(20).max(400).optional(),
  rows: z.number().int().min(5).max(200).optional(),
})

export const TerminalPtyWritePayloadSchema = z.object({
  sessionId: z.string().min(1).max(120),
  data: z.string().max(65_536),
})

export const TerminalPtyResizePayloadSchema = z.object({
  sessionId: z.string().min(1).max(120),
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
})

export const TerminalPtyKillPayloadSchema = z.object({
  sessionId: z.string().min(1).max(120),
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

export const GitCheckoutBranchPayloadSchema = z.object({
  branch: z.string().trim().min(1).max(240),
})

export const GitCreateWorktreePayloadSchema = z.object({
  baseBranch: z.string().trim().min(1).max(240).optional(),
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

const ImageAttachmentTupleSchema = z.tuple([
  z.string().min(1).max(128),
  z.string().min(1),
])

export const HarnessSendMessageSchema = z
  .object({
    sessionId: z.string().min(1),
    content: z.string().max(100_000),
    images: z.array(ImageAttachmentTupleSchema).max(10).optional(),
  })
  .refine(
    (v) => v.content.trim().length > 0 || (v.images?.length ?? 0) > 0,
    "Message content or at least one image is required"
  )

export const HarnessPermissionResponseSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  decision: z.enum(["allow", "allow_always", "deny"]),
})

export const HarnessSetPermissionModeSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.enum([
    "default",
    "acceptEdits",
    "plan",
    "fullManage",
    "orchestrator",
  ]),
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

export const HarnessGetCapabilitiesSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
  })
  .optional()

export const HarnessGetConfigSchema = z
  .object({
    sections: z.array(z.string().min(1)).optional(),
  })
  .optional()

export const HarnessPatchConfigSchema = z.object({
  patch: z.record(z.string().min(1), z.unknown()),
})

export const FileChangeActionKindSchema = z.enum([
  "keep",
  "undo",
  "redo",
  "keep_all",
  "undo_all",
  "redo_all",
])

export const FileChangesGetPayloadSchema = z.object({
  sessionId: z.string().min(1),
})

export const FileChangesDiffPayloadSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1).max(4096),
})

export const FileChangesActionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  action: FileChangeActionKindSchema,
  path: z.string().min(1).max(4096).optional(),
  force: z.boolean().optional(),
})

export const TodosGetPayloadSchema = z.object({
  sessionId: z.string().min(1).max(200),
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
  reasoningEffort: z.string().trim().min(1).max(64).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        images: z.array(ImageAttachmentTupleSchema).max(10).optional(),
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

export const StorageSidebarStateSchema = z.object({
  projects: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().trim().min(1).max(120),
        folders: z.array(z.string().min(1).max(2048)).max(20),
        iconKind: z.enum(["icon", "emoji"]),
        iconValue: z.string().min(1).max(32),
        iconColor: z.enum(["folder", "brand", "info", "type", "num", "danger"]),
        pinned: z.boolean().optional(),
        sectionId: z.string().max(120).nullable().optional(),
        gitRemote: z.string().max(240).optional(),
        updatedAt: z.number(),
      })
    )
    .max(60),
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().trim().min(1).max(120),
        collapsed: z.boolean().optional(),
      })
    )
    .max(30),
  pinnedChatIds: z.array(z.string().max(160)).max(100),
  archivedChatIds: z.array(z.string().max(160)).max(200),
  organizeBy: z.enum(["project", "connection", "flat"]),
  sortBy: z.enum(["updated", "manual"]),
  showProjectChatsInRecents: z.boolean(),
  manualProjectOrder: z.array(z.string().max(120)).max(60),
  collapsedProjectIds: z.array(z.string().max(120)).max(100).optional(),
  hiddenProjectPaths: z.array(z.string().max(2048)).max(100).optional(),
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

export const OfficeReadExcelPayloadSchema = z.object({
  filePath: z.string().trim().min(1).max(2048),
})

export const OfficeWriteExcelPayloadSchema = z.object({
  filePath: z.string().trim().min(1).max(2048),
  sheets: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        columns: z.array(z.string().min(1).max(4)).optional(),
        headers: z.record(z.string(), z.string()),
        rows: z
          .array(
            z.object({
              rowNumber: z.number().int().positive().optional(),
              cells: z.record(z.string(), z.union([z.string(), z.number()])),
              formulas: z.record(z.string(), z.string()).optional(),
              formats: z
                .record(
                  z.string(),
                  z.enum(["currency", "percent", "number", "text"])
                )
                .optional(),
              isTotal: z.boolean().optional(),
            })
          )
          .max(500),
      })
    )
    .min(1)
    .max(20),
})

export const OfficeCreatePptxPayloadSchema = z.object({
  filePath: z.string().trim().min(1).max(2048).optional(),
  fileName: z.string().max(160).optional(),
  title: z.string().min(1).max(240),
  slides: z
    .array(
      z.object({
        id: z.string().optional(),
        kicker: z.string().optional(),
        title: z.string().min(1),
        subtitle: z.string().optional(),
        body: z.string(),
        bullets: z.array(z.string()).optional(),
        metrics: z
          .array(
            z.object({
              label: z.string(),
              value: z.string(),
              note: z.string().optional(),
            })
          )
          .optional(),
        notes: z.string().optional(),
        layout: z.enum(["cover", "scorecard", "bullets"]).optional(),
      })
    )
    .min(1)
    .max(60),
})

export const BrowserCdpNavigateSchema = z.object({
  url: z.string().trim().min(1).max(4096),
})

export const BrowserCdpClickSchema = z.object({
  ref: z.string().trim().min(1).max(32),
})

export const BrowserCdpTypeSchema = z.object({
  ref: z.string().trim().min(1).max(32),
  text: z.string().max(4000),
  submit: z.boolean().optional(),
})

export const TelegramStartHostedSchema = z.object({
  replaceExisting: z.boolean().optional(),
})

export const TelegramConnectBotTokenSchema = z.object({
  botToken: z.string().trim().min(10).max(256),
  allowedChatId: z.string().trim().max(32).optional(),
  replaceExisting: z.boolean().optional(),
})

export const TelegramDisconnectSchema = z.object({
  localOnly: z.boolean().optional(),
})

export const TelegramResolveApprovalSchema = z.object({
  approvalId: z.string().trim().min(1).max(128),
  decision: z.enum(["approved", "denied"]),
})

export const TelegramSetRemoteUninstallSchema = z.object({
  enabled: z.boolean(),
})

export const TelegramSelectSessionSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
})

export const AgentRoleIdSchema = z.enum([
  "swarm",
  "review",
  "judge",
  "memory",
  "ambient",
])

export const AgentsGetStateSchema = z
  .object({
    sessionId: z.string().trim().max(128).optional(),
  })
  .optional()

export const AgentsSetRoleModelSchema = z.object({
  role: AgentRoleIdSchema,
  model: z.string().trim().min(1).max(256),
  scope: z.enum(["global", "session"]),
  sessionId: z.string().trim().max(128).optional(),
})

export const AgentsSetSubagentModelSchema = z.object({
  model: z.string().trim().min(1).max(256),
  scope: z.enum(["global", "session"]).optional(),
  sessionId: z.string().trim().max(128).optional(),
})

export const AgentsUpsertProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/),
  model: z.string().trim().min(1).max(256),
  effort: z.string().trim().max(32).nullable().optional(),
  description: z.string().trim().max(500).optional(),
  scope: z.enum(["global", "session"]),
  sessionId: z.string().trim().max(128).optional(),
})

export const AgentsDeleteProfileSchema = z.object({
  name: z.string().trim().min(1).max(32),
  scope: z.enum(["global", "session"]),
  sessionId: z.string().trim().max(128).optional(),
})

export type DaemonInvokePayload = z.infer<typeof DaemonInvokePayloadSchema>
export type OpenInExcelPayload = z.infer<typeof OpenInExcelPayloadSchema>
export type OpenInVSCodePayload = z.infer<typeof OpenInVSCodePayloadSchema>
export type OpenExternalPayload = z.infer<typeof OpenExternalPayloadSchema>
