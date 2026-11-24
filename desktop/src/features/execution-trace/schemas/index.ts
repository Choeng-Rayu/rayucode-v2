import { z } from "zod"

export const shellCommandStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("command"),
  command: z.string(),
  displayCommand: z.string(),
  output: z.string(),
  exitCode: z.number().int(),
  statusLabel: z.string(),
  isFailed: z.boolean().optional(),
  isMono: z.boolean().optional(),
})

export const fileReadTargetSchema = z.object({
  file: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().min(1),
  rangeLabel: z.string().min(1),
})

export const fileReadStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("read"),
  label: z.string(),
  files: z.array(fileReadTargetSchema),
})

export const previewThumbSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["browser", "excel", "markdown", "slide"]),
  badge: z.string(),
  label: z.string(),
  pillLabel: z.string(),
})

export const listStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["list", "search", "previews"]),
  text: z.string(),
  highlight: z.string().optional(),
  previews: z.array(previewThumbSchema).optional(),
})

export const traceStepItemSchema = z.union([
  shellCommandStepSchema,
  fileReadStepSchema,
  listStepSchema,
])

export const traceGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  steps: z.array(traceStepItemSchema),
})

export const inlineDiffHunkLineSchema = z.object({
  lineNumber: z.number().int().nullable(),
  type: z.enum(["hunk", "ctx", "add", "del"]),
  mark: z.string(),
  content: z.string(),
})

export const inlineDiffCardDataSchema = z.object({
  id: z.string().min(1),
  file: z.string(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  ownerBadge: z.string().optional(),
  hint: z.string(),
  accepted: z.boolean().optional(),
  rejected: z.boolean().optional(),
  lines: z.array(inlineDiffHunkLineSchema),
})

export const citationSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["code", "excel", "markdown", "browser", "slide"]),
  file: z.string().min(1),
  line: z.number().int().min(1).optional(),
})

export const answerBulletSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  citations: z.array(citationSchema),
})

export const traceTimelineItemSchema = z.union([
  z.object({
    type: z.literal("note"),
    id: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    type: z.literal("group"),
    group: traceGroupSchema,
  }),
])

export const executionTurnSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  compactedNotice: z.string().optional(),
  userRefFiles: z.string().optional(),
  userImages: z
    .array(
      z.object({
        name: z.string(),
        mediaType: z.string(),
        dataUrl: z.string(),
      })
    )
    .optional(),
  userPrompt: z.string(),
  userMeta: z.string().optional(),
  workedDuration: z.string(),
  isLive: z.boolean().optional(),
  notes: z.array(z.string()),
  groups: z.array(traceGroupSchema),
  timeline: z.array(traceTimelineItemSchema).optional(),
  activeToolStatus: z.string().nullable().optional(),
  outputArtifact: z
    .object({
      kind: z.enum(["slide", "excel", "markdown"]),
      title: z.string(),
      subtitle: z.string(),
      pillLabel: z.string(),
    })
    .optional(),
  answerIntro: z.string(),
  answerSummaryTitle: z.string().optional(),
  answerBullets: z.array(answerBulletSchema),
  diffCard: inlineDiffCardDataSchema,
  timestamp: z.string(),
  credits: z.string(),
  kvCachePct: z.number(),
  pinned: z.boolean().optional(),
})

export const executionTurnListSchema = z.array(executionTurnSchema)

export const sendPromptInputSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().trim().min(1, "Prompt cannot be empty"),
  modelLabel: z.string().min(1),
})

export const forkTurnInputSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
})

export const togglePinInputSchema = z.object({
  turnId: z.string().min(1),
})
