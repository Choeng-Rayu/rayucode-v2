import { z } from "zod"

export const previewTabKindSchema = z.enum([
  "browser",
  "excel",
  "markdown",
  "slide",
  "diagram",
])

export const browserDeviceModeSchema = z.enum(["desktop", "mobile"])

export const markdownViewModeSchema = z.enum(["rendered", "raw"])

export const browserBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(0).finite(),
  height: z.number().min(0).finite(),
})

export const browserKpiSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  delta: z.string(),
})

export const browserTokenBurnPointSchema = z.object({
  label: z.string().min(1),
  cachedK: z.number().min(0),
  uncachedK: z.number().min(0),
})

export const browserEndpointMetricSchema = z.object({
  id: z.string().min(1),
  route: z.string().min(1),
  model: z.string().min(1),
  p50Ms: z.number().min(0),
  p99Ms: z.number().min(0),
  status: z.enum(["Live", "Autonomous", "Review"]),
  credits: z.string(),
})

export const browserChatMessageSchema = z.object({
  id: z.string().min(1),
  sender: z.enum(["user", "agent"]),
  text: z.string().min(1),
  timestamp: z.string().optional(),
})

export const browserPreviewStateSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  zoom: z.number().min(50).max(200),
  deviceMode: browserDeviceModeSchema,
  kpis: z.array(browserKpiSchema),
  tokenBurn: z.array(browserTokenBurnPointSchema),
  endpoints: z.array(browserEndpointMetricSchema),
  chatMessages: z.array(browserChatMessageSchema),
})

export const excelCellValueSchema = z.union([z.string(), z.number()])

export const excelCellFormatSchema = z.enum([
  "currency",
  "percent",
  "number",
  "integer",
  "text",
])

export const excelRowDataSchema = z.object({
  rowNumber: z.number().int().min(1),
  isHeader: z.boolean().optional(),
  isTotal: z.boolean().optional(),
  cells: z.record(z.string(), excelCellValueSchema),
  formulas: z.record(z.string(), z.string()).optional(),
  formats: z.record(z.string(), excelCellFormatSchema).optional(),
})

export const excelSheetDataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(excelRowDataSchema),
})

export const excelWorkbookStateSchema = z.object({
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  activeSheetId: z.string().min(1),
  selectedCellRef: z.string().min(2),
  selectedFormula: z.string(),
  liveWebUrl: z.union([z.literal(""), z.string().url()]),
  sheets: z.array(excelSheetDataSchema).min(1),
})

export const markdownSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
})

export const markdownPreviewStateSchema = z.object({
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  rawContent: z.string(),
  sections: z.array(markdownSectionSchema),
})

export const previewsViewModelSchema = z.object({
  browser: browserPreviewStateSchema,
  excel: excelWorkbookStateSchema,
  markdown: markdownPreviewStateSchema,
})

export const browserQuestionInputSchema = z.object({
  question: z.string().trim().min(1, "Enter a question for RayuCode"),
})

export const updateExcelCellInputSchema = z.object({
  sheetId: z.string().min(1),
  rowNumber: z.number().int().min(1),
  column: z.string().regex(/^[A-Z]+$/),
  value: excelCellValueSchema,
  formula: z.string().optional(),
})

export const excelEmbedUrlSchema = z
  .string()
  .trim()
  .url("Enter a valid HTTPS Office Web Viewer or OneDrive URL")
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "URL must start with http:// or https://"
  )
