import { z } from "zod"

export const contextBreakdownSubItemSchema = z.object({
  key: z.string().min(1),
  tokens: z.string().min(1),
})

export const contextBreakdownRowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tokensLabel: z.string().min(1),
  pctLabel: z.string().min(1),
  barWidthPct: z.number().min(0).max(100),
  colorClass: z.string().min(1),
  dotted: z.boolean().optional(),
  items: z.array(contextBreakdownSubItemSchema).optional(),
})

export const contextDisclosureSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  count: z.number().int().nonnegative(),
  items: z.array(z.string()),
})

export const inspectorEnvironmentSchema = z.object({
  host: z.string().min(1),
  project: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().min(1),
})

export const inspectorConnectorSchema = z.object({
  id: z.string().min(1),
  glyph: z.string().min(1).max(2),
  name: z.string().min(1),
  status: z.enum(["Linked", "Reconnect"]).optional(),
  primary: z.boolean(),
})

export const inspectorOutputSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["browser", "markdown", "excel"]),
  label: z.string().min(1),
  pillLabel: z.string().min(1),
})

export const inspectorChangesSummarySchema = z.object({
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFilesCount: z.number().int().nonnegative(),
})

export const inspectorCodeFileSchema = z.object({
  pill: z.string().min(1),
  path: z.string().min(1),
  language: z.string().min(1),
  startLine: z.number().int().positive(),
  defaultLine: z.number().int().positive(),
  lines: z.array(z.string()),
})

export const inspectorTerminalLineSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().optional(),
  command: z.string().optional(),
  output: z.string().optional(),
  isOk: z.boolean().optional(),
  isError: z.boolean().optional(),
})

export const inspectorTaskItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string(),
  completed: z.boolean(),
  codeFile: z.string().optional(),
  codeLine: z.number().int().positive().optional(),
})

export const inspectorViewModelSchema = z.object({
  environment: inspectorEnvironmentSchema,
  context: z.object({
    usedPctLabel: z.string().min(1),
    tokensSummary: z.string().min(1),
    rows: z.array(contextBreakdownRowSchema),
    bufferRow: contextBreakdownRowSchema,
    freeRow: contextBreakdownRowSchema,
    disclosures: z.array(contextDisclosureSchema),
  }),
  connectors: z.array(inspectorConnectorSchema),
  outputs: z.array(inspectorOutputSchema),
  changesSummary: inspectorChangesSummarySchema,
  codeFiles: z.record(z.string(), inspectorCodeFileSchema),
  terminalLines: z.array(inspectorTerminalLineSchema),
  tasks: z.array(inspectorTaskItemSchema),
})

export const terminalCommandInputSchema = z.object({
  command: z.string().trim().min(1, "Enter a command to execute"),
})

export type TerminalCommandInput = z.infer<typeof terminalCommandInputSchema>
