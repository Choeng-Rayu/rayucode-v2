// Public barrel export for desktop/src/features/previews

export {
  PreviewsHost,
  type PreviewsHostProps,
} from "./components/previews-host"
export { BrowserPane, type BrowserPaneProps } from "./components/browser-pane"
export {
  FloatingAskChat,
  type FloatingAskChatProps,
} from "./components/floating-ask-chat"
export { ExcelPane, type ExcelPaneProps } from "./components/excel-pane"
export {
  MarkdownPane,
  type MarkdownPaneProps,
} from "./components/markdown-pane"

export {
  useBrowserBounds,
  type UseBrowserBoundsOptions,
  type UseBrowserBoundsResult,
} from "./hooks/use-browser-bounds"

export {
  evaluateExcelFormula,
  fetchPreviewsState,
  formatExcelCellValue,
  openExcelInNativeApp,
  openMarkdownInVSCode,
  openUrlInSystemBrowser,
  parseNumericCellValue,
  previewsKeys,
  previewsQueryOptions,
  recalculateExcelSheet,
  sendBrowserQuestion,
  syncBrowserBounds,
  updateExcelCell,
  type FormulaCellLookup,
} from "./api/previews-api"

export {
  browserBoundsSchema,
  browserChatMessageSchema,
  browserDeviceModeSchema,
  browserEndpointMetricSchema,
  browserKpiSchema,
  browserPreviewStateSchema,
  browserQuestionInputSchema,
  browserTokenBurnPointSchema,
  excelCellFormatSchema,
  excelCellValueSchema,
  excelEmbedUrlSchema,
  excelRowDataSchema,
  excelSheetDataSchema,
  excelWorkbookStateSchema,
  markdownPreviewStateSchema,
  markdownSectionSchema,
  markdownViewModeSchema,
  previewTabKindSchema,
  previewsViewModelSchema,
  updateExcelCellInputSchema,
} from "./schemas"

export type {
  BrowserBounds,
  BrowserBoundsSyncPayload,
  BrowserChatMessage,
  BrowserDeviceMode,
  BrowserEndpointMetric,
  BrowserKpi,
  BrowserPreviewState,
  BrowserTokenBurnPoint,
  ExcelCellFormat,
  ExcelCellValue,
  ExcelRowData,
  ExcelSheetData,
  ExcelWorkbookState,
  MarkdownPreviewState,
  MarkdownSection,
  MarkdownViewMode,
  PreviewsViewModel,
  PreviewTabKind,
  UpdateExcelCellInput,
} from "./types"
