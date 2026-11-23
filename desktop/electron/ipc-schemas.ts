import { z } from "zod"

export const DaemonInvokePayloadSchema = z.object({
  method: z.string().min(1),
  params: z.unknown().optional(),
})

export const OpenInExcelPayloadSchema = z.object({
  filePath: z.string().min(1),
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

export type DaemonInvokePayload = z.infer<typeof DaemonInvokePayloadSchema>
export type OpenInExcelPayload = z.infer<typeof OpenInExcelPayloadSchema>
export type OpenInVSCodePayload = z.infer<typeof OpenInVSCodePayloadSchema>
export type OpenExternalPayload = z.infer<typeof OpenExternalPayloadSchema>
