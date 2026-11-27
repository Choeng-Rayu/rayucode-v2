import { z } from "zod"

export const reasoningEffortSchema = z.string()

export const permissionModeIdSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "fullManage",
  "orchestrator",
])

export const modelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  subtitle: z.string().optional(),
  provider: z.string().min(1),
  apiMethod: z.string().optional(),
  recommended: z.boolean().optional(),
  available: z.boolean().optional(),
  unavailableReason: z.string().optional(),
  supportedEfforts: z.array(z.string()).optional(),
  defaultEffort: z.string().optional(),
  contextWindow: z.number().optional(),
})

export const permissionModeOptionSchema = z.object({
  id: permissionModeIdSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  isDefault: z.boolean().optional(),
  iconName: z.enum([
    "lock",
    "shield-outline",
    "eye",
    "shield-alert",
    "swarm",
  ]),
})

export const sessionSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  project: z.string().min(1),
  workingDir: z.string().optional(),
  checkout: z.string().min(1),
  branch: z.string().min(1),
  updatedAt: z.string().min(1),
  updatedAtMs: z.number().optional(),
  status: z.string().optional(),
  connection: z.enum(["local", "cloud"]).optional(),
  saved: z.boolean().optional(),
  archived: z.boolean().optional(),
  source: z.string().optional(),
  externalSessionId: z.string().optional(),
  externalPath: z.string().optional(),
  externalProjectName: z.string().optional(),
  imported: z.boolean().optional(),
  syncStale: z.boolean().optional(),
  modelId: z.string().min(1),
  modelLabel: z.string().min(1),
  effort: reasoningEffortSchema,
  permissionMode: permissionModeIdSchema,
  kvWarmPct: z.number(),
  creditsUsed: z.number(),
})

export const createSessionInputSchema = z.object({
  prompt: z.string().trim().min(1, "Type a prompt or /command first"),
  project: z.string().min(1).default("rayucode-v2"),
  workingDir: z.string().min(1).optional(),
  checkout: z.string().min(1).default("Local Checkout"),
  modelId: z.string().min(1).default("default"),
  modelLabel: z.string().min(1).default("Default"),
  effort: reasoningEffortSchema.default(""),
  permissionMode: permissionModeIdSchema.default("default"),
})

export type ValidatedCreateSessionInput = z.infer<
  typeof createSessionInputSchema
>
