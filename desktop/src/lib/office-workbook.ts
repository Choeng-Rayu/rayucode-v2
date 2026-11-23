// Pure converters between Electron office-bridge workbook payloads and the
// renderer's Excel pane state. Shared by AppShell (cache hydration) and ExcelPane.

import type { ExcelSheetData, ExcelWorkbookState } from "@/features/previews"

import type {
  OfficeExcelSheetPayload,
  OfficeExcelWorkbookData,
} from "./ipc-client"

export function officeSheetsToExcelSheets(
  list: OfficeExcelSheetPayload[]
): ExcelSheetData[] {
  return list.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    columns: sheet.columns,
    rows: [
      {
        rowNumber: 1,
        isHeader: true,
        cells: sheet.headers,
      },
      ...sheet.rows.map((r) => ({
        rowNumber: r.rowNumber,
        cells: r.cells,
        formulas: r.formulas,
        formats: r.formats,
        isTotal: r.isTotal,
      })),
    ],
  }))
}

export function officeWorkbookToPreviewState(
  workbook: OfficeExcelWorkbookData
): ExcelWorkbookState {
  const sheets = officeSheetsToExcelSheets(workbook.sheets)
  return {
    fileName: workbook.fileName,
    filePath: workbook.filePath,
    activeSheetId: sheets[0]?.id ?? "",
    selectedCellRef: "A1",
    selectedFormula: "",
    liveWebUrl: "",
    sheets,
  }
}
