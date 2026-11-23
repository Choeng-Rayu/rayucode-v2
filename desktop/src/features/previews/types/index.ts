export type PreviewTabKind = "browser" | "excel" | "markdown"

export type BrowserDeviceMode = "desktop" | "mobile"

export type MarkdownViewMode = "rendered" | "raw"

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserKpi {
  label: string
  value: string
  delta: string
}

export interface BrowserTokenBurnPoint {
  label: string
  cachedK: number
  uncachedK: number
}

export interface BrowserEndpointMetric {
  id: string
  route: string
  model: string
  p50Ms: number
  p99Ms: number
  status: "Live" | "Autonomous" | "Review"
  credits: string
}

export interface BrowserChatMessage {
  id: string
  sender: "user" | "agent"
  text: string
  timestamp?: string
}

export interface BrowserPreviewState {
  url: string
  title: string
  zoom: number
  deviceMode: BrowserDeviceMode
  kpis: BrowserKpi[]
  tokenBurn: BrowserTokenBurnPoint[]
  endpoints: BrowserEndpointMetric[]
  chatMessages: BrowserChatMessage[]
}

export type ExcelCellValue = string | number

export type ExcelCellFormat =
  | "currency"
  | "percent"
  | "number"
  | "integer"
  | "text"

export interface ExcelRowData {
  rowNumber: number
  isHeader?: boolean
  isTotal?: boolean
  cells: Record<string, ExcelCellValue>
  formulas?: Record<string, string>
  formats?: Record<string, ExcelCellFormat>
}

export interface ExcelSheetData {
  id: string
  name: string
  columns: string[]
  rows: ExcelRowData[]
}

export interface ExcelWorkbookState {
  fileName: string
  filePath: string
  activeSheetId: string
  selectedCellRef: string
  selectedFormula: string
  liveWebUrl: string
  sheets: ExcelSheetData[]
}

export interface MarkdownSection {
  id: string
  title: string
}

export interface MarkdownPreviewState {
  fileName: string
  filePath: string
  rawContent: string
  sections: MarkdownSection[]
}

export interface PreviewsViewModel {
  browser: BrowserPreviewState
  excel: ExcelWorkbookState
  markdown: MarkdownPreviewState
}

export interface UpdateExcelCellInput {
  sheetId: string
  rowNumber: number
  column: string
  value: ExcelCellValue
  formula?: string
}

export interface BrowserBoundsSyncPayload {
  bounds: BrowserBounds
  url: string
  zoom: number
  deviceMode: BrowserDeviceMode
  visible: boolean
}
