import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ExternalLink,
  Globe,
  List,
  Plus,
  Sigma,
  Table2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import {
  formatExcelCellValue,
  openExcelInNativeApp,
  parseNumericCellValue,
  previewsKeys,
  previewsQueryOptions,
  recalculateExcelSheet,
  sendBrowserQuestion,
  updateExcelCell,
} from "../api/previews-api"
import { excelEmbedUrlSchema } from "../schemas"
import type { ExcelRowData, ExcelSheetData } from "../types"
import { FloatingAskChat } from "./floating-ask-chat"

export interface ExcelPaneProps {
  className?: string
}

function getDefaultCellForSheet(sheet: ExcelSheetData): {
  ref: string
  formula: string
} {
  const totalRow = sheet.rows.find((row) => row.isTotal)
  if (totalRow?.formulas) {
    const firstFormulaEntry = Object.entries(totalRow.formulas)[0]
    if (firstFormulaEntry) {
      return {
        ref: `${firstFormulaEntry[0]}${totalRow.rowNumber}`,
        formula: firstFormulaEntry[1],
      }
    }
  }
  return { ref: "A1", formula: String(sheet.rows[0]?.cells.A ?? "") }
}

function parseRef(ref: string): { column: string; rowNumber: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase())
  if (!match) return null
  return { column: match[1], rowNumber: Number.parseInt(match[2], 10) }
}

function buildOfficeEmbedSrc(rawUrl: string): string {
  if (
    /view\.officeapps\.live\.com|onedrive\.live\.com\/embed|sharepoint\.com/i.test(
      rawUrl
    )
  ) {
    return rawUrl
  }
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(rawUrl)}`
}

export function ExcelPane({ className }: ExcelPaneProps) {
  const queryClient = useQueryClient()
  const fullView = useAppStore((s) => s.fullView)
  const closeDocumentToContext = useAppStore((s) => s.closeDocumentToContext)

  const { data } = useQuery(previewsQueryOptions())
  const serverWorkbook = data?.excel

  const [sheetsState, setSheetsState] = React.useState<ExcelSheetData[] | null>(
    null
  )
  const [activeSheetId, setActiveSheetId] = React.useState<string>("sheet_q4")
  const [selectedCellRef, setSelectedCellRef] = React.useState<string>("C7")
  const [formulaBarValue, setFormulaBarValue] = React.useState<string>(
    "=SUM(C2:C6)"
  )
  const [focusedCellRef, setFocusedCellRef] = React.useState<string | null>(null)
  const [isLiveWebMode, setIsLiveWebMode] = React.useState<boolean>(false)
  const [embedUrlInput, setEmbedUrlInput] = React.useState<string>(
    "https://view.officeapps.live.com/op/embed.aspx?src=https://rayucode.com/demo/Q4-Token-Cost-Model.xlsx"
  )
  const [activeEmbedSrc, setActiveEmbedSrc] = React.useState<string>(
    "https://view.officeapps.live.com/op/embed.aspx?src=https://rayucode.com/demo/Q4-Token-Cost-Model.xlsx"
  )
  const [chatMinimized, setChatMinimized] = React.useState(false)

  const sheets = sheetsState ?? serverWorkbook?.sheets ?? []
  const fileName = serverWorkbook?.fileName ?? "Q4-Token-Cost-Model.xlsx"
  const filePath =
    serverWorkbook?.filePath ??
    "~/workspace/rayu/specs-and-docs/Q4-Token-Cost-Model.xlsx"

  const activeSheet =
    sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0]

  const updateCellMutation = useMutation({
    mutationFn: updateExcelCell,
    onSuccess: (updated) => {
      queryClient.setQueryData(previewsKeys.state(), updated)
    },
  })

  const sendQuestionMutation = useMutation({
    mutationFn: (question: string) => sendBrowserQuestion(question),
    onSuccess: (updated) => {
      queryClient.setQueryData(previewsKeys.state(), updated)
    },
  })

  const selectCell = (column: string, row: ExcelRowData) => {
    const ref = `${column}${row.rowNumber}`
    setSelectedCellRef(ref)
    const formula = row.formulas?.[column]
    if (formula) {
      setFormulaBarValue(formula)
    } else {
      const val = row.cells[column]
      setFormulaBarValue(val !== undefined ? String(val) : "")
    }
  }

  const commitCellEdit = (
    sheetId: string,
    rowNumber: number,
    column: string,
    rawInput: string
  ) => {
    const baseSheets = sheetsState ?? serverWorkbook?.sheets ?? []
    const isFormula = rawInput.trim().startsWith("=")

    const nextSheets = baseSheets.map((sheet) => {
      if (sheet.id !== sheetId) return sheet
      const updatedSheet: ExcelSheetData = {
        ...sheet,
        rows: sheet.rows.map((row) => {
          if (row.rowNumber !== rowNumber) return row
          const nextCells = { ...row.cells }
          const nextFormulas = row.formulas ? { ...row.formulas } : {}

          if (isFormula) {
            nextFormulas[column] = rawInput.trim()
          } else {
            delete nextFormulas[column]
            const parsed = parseNumericCellValue(rawInput)
            nextCells[column] = parsed !== null ? parsed : rawInput
          }

          return {
            ...row,
            cells: nextCells,
            formulas:
              Object.keys(nextFormulas).length > 0 ? nextFormulas : undefined,
          }
        }),
      }
      return recalculateExcelSheet(updatedSheet)
    })

    setSheetsState(nextSheets)
    setFormulaBarValue(rawInput)

    void updateCellMutation.mutate({
      sheetId,
      rowNumber,
      column,
      value: isFormula ? rawInput.trim() : rawInput,
      formula: isFormula ? rawInput.trim() : undefined,
    })
  }

  const handleFormulaBarCommit = (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!activeSheet) return
    const parsed = parseRef(selectedCellRef)
    if (!parsed) return
    commitCellEdit(
      activeSheet.id,
      parsed.rowNumber,
      parsed.column,
      formulaBarValue
    )
  }

  const handleSwitchSheet = (sheetId: string) => {
    setActiveSheetId(sheetId)
    const target = sheets.find((sheet) => sheet.id === sheetId)
    if (target) {
      const def = getDefaultCellForSheet(target)
      setSelectedCellRef(def.ref)
      setFormulaBarValue(def.formula)
    }
  }

  const handleOpenInExcelApp = async () => {
    await openExcelInNativeApp(filePath)
    toast(`Opened ${fileName} in Microsoft Excel`)
  }

  const handleToggleLiveWeb = () => {
    setIsLiveWebMode((prev) => {
      const next = !prev
      toast(
        next
          ? "Switched to Microsoft Office Web Viewer preview"
          : "Switched back to interactive local workbook"
      )
      return next
    })
  }

  const handleLoadEmbedUrl = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = excelEmbedUrlSchema.safeParse(embedUrlInput)
    if (!result.success) {
      toast(result.error.issues[0]?.message ?? "Enter a valid HTTPS URL")
      return
    }
    setActiveEmbedSrc(buildOfficeEmbedSrc(result.data))
    setIsLiveWebMode(true)
    toast("Loaded live Microsoft Office Web Viewer")
  }

  // Compute summary metrics for status bar
  const statusSummary = React.useMemo(() => {
    if (!activeSheet) return { count: 0, sumLabel: "Sum: —" }
    const dataRows = activeSheet.rows.filter(
      (row) => !row.isHeader && !row.isTotal
    )
    const totalRow = activeSheet.rows.find((row) => row.isTotal)
    const lastCol = activeSheet.columns[activeSheet.columns.length - 1]
    const totalVal = totalRow?.cells[lastCol]
    const totalFormat = totalRow?.formats?.[lastCol]
    const formatted =
      totalVal !== undefined
        ? formatExcelCellValue(totalVal, totalFormat)
        : "—"
    return {
      count: dataRows.length,
      sumLabel: `Sum: ${formatted}`,
    }
  }, [activeSheet])

  return (
    <div
      data-testid="excel-pane"
      data-live-web={isLiveWebMode ? "true" : "false"}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col bg-pane text-ink select-none",
        className
      )}
    >
      {/* Excel Workbook Header Strip (--office-excel / --office-excel-soft semantic tokens) */}
      <div
        style={{
          backgroundColor: "var(--office-excel-soft)",
          borderColor: "var(--border)",
        }}
        className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
      >
        <span
          style={{
            backgroundColor: "var(--office-excel)",
            color: "var(--accent-ink)",
          }}
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center rounded-[5px] font-mono text-[11px] font-bold"
        >
          X
        </span>
        <span
          style={{ color: "var(--office-excel)" }}
          className="min-w-0 truncate text-xs font-semibold"
        >
          {fileName}
        </span>
        <span className="rounded-full border border-brand/25 bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand-text">
          AutoSave On
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant={isLiveWebMode ? "primary" : "outline"}
            size="xs"
            aria-pressed={isLiveWebMode}
            onClick={handleToggleLiveWeb}
            className="h-6 px-2 text-[11px]"
          >
            <Globe className="size-3" strokeWidth={1.65} aria-hidden="true" />
            <span>Live Excel Web</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleOpenInExcelApp}
            className="h-6 px-2 text-[11px]"
          >
            <ExternalLink
              className="size-3"
              strokeWidth={1.65}
              aria-hidden="true"
            />
            <span>Open in Excel App</span>
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Context"
                onClick={closeDocumentToContext}
                className="size-6"
              >
                <List className="size-3.5" strokeWidth={1.7} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Environment &amp; Context</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Compact Ribbon Toolbar */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-hairline bg-chrome px-3 py-1 text-[11px] text-muted-ink">
        <span
          style={{ color: "var(--office-excel)" }}
          className="border-b-2 border-brand pb-0.5 font-semibold"
        >
          Home
        </span>
        <button
          type="button"
          onClick={() => toast("Formulas: SUM, AVERAGE, MIN, MAX, COUNT active")}
          className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink"
        >
          Formulas
        </button>
        <span className="h-3.5 w-px bg-hairline" aria-hidden="true" />
        <button
          type="button"
          onClick={() => {
            if (!activeSheet) return
            const def = getDefaultCellForSheet(activeSheet)
            setSelectedCellRef(def.ref)
            setFormulaBarValue(def.formula)
            toast(`Selected AutoSum cell ${def.ref} (${def.formula})`)
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-body hover:bg-hover hover:text-ink"
        >
          <Sigma className="size-3" strokeWidth={1.7} aria-hidden="true" />
          <span>AutoSum</span>
        </button>
        <span className="ml-auto font-mono text-[10px] text-muted-ink">
          {isLiveWebMode ? "Office Web Viewer" : "Interactive Grid"}
        </span>
      </div>

      {/* Formula Bar (Name Box + fx + Editable Formula/Value Input) */}
      <form
        onSubmit={handleFormulaBarCommit}
        className="flex h-8 shrink-0 items-center border-b border-hairline bg-canvas text-xs"
      >
        <div
          data-testid="excel-name-box"
          className="grid h-full w-14 shrink-0 place-items-center border-r border-hairline bg-inset font-mono text-[11.5px] font-semibold text-ink tabular-nums"
        >
          {selectedCellRef}
        </div>
        <div
          aria-hidden="true"
          className="border-r border-hairline-soft px-2.5 font-serif text-xs text-muted-ink italic"
        >
          fx
        </div>
        <input
          type="text"
          value={formulaBarValue}
          onChange={(event) => setFormulaBarValue(event.target.value)}
          onBlur={() => handleFormulaBarCommit()}
          aria-label="Excel formula bar"
          className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[11.5px] text-brand-text outline-none placeholder:text-muted-ink"
        />
      </form>

      {/* Main Workbook Surface: Live Office Web Viewer OR Interactive Spreadsheet Grid */}
      {isLiveWebMode ? (
        <div
          data-testid="excel-live-web-viewer"
          className="flex min-h-0 flex-1 flex-col bg-canvas"
        >
          <form
            onSubmit={handleLoadEmbedUrl}
            className="flex flex-wrap items-center gap-2 border-b border-hairline bg-brand-softer px-3 py-2 text-xs"
          >
            <span className="font-medium text-brand-text">
              Microsoft Office Embed:
            </span>
            <input
              type="url"
              value={embedUrlInput}
              onChange={(event) => setEmbedUrlInput(event.target.value)}
              placeholder="Paste OneDrive, SharePoint, or public HTTPS .xlsx URL..."
              aria-label="Office Web Viewer URL"
              className="h-7 min-w-[160px] flex-1 rounded-sm border border-hairline bg-canvas px-2 font-mono text-[11px] text-ink outline-none focus:border-brand"
            />
            <Button type="submit" variant="primary" size="xs">
              Load live Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setIsLiveWebMode(false)}
            >
              <Table2 className="size-3" strokeWidth={1.65} aria-hidden="true" />
              <span>Local workbook</span>
            </Button>
          </form>

          <div className="relative flex min-h-0 flex-1 flex-col">
            <iframe
              title="Microsoft Excel Online Live Embed"
              src={activeEmbedSrc}
              referrerPolicy="no-referrer"
              className="min-h-0 w-full flex-1 border-0 bg-canvas"
            />
          </div>
        </div>
      ) : (
        <div
          data-testid="excel-grid-scroll"
          className="min-h-0 flex-1 overflow-auto bg-canvas"
        >
          {activeSheet && (
            <table
              data-testid={`excel-sheet-${activeSheet.id}`}
              className="w-max min-w-full border-collapse text-xs tabular-nums"
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky top-0 left-0 z-20 h-6 w-9 border border-hairline bg-inset text-center font-mono text-[10.5px] font-medium text-muted-ink"
                  />
                  {activeSheet.columns.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className={cn(
                        "sticky top-0 z-10 h-6 border border-hairline bg-inset px-2.5 text-center font-mono text-[11px] font-medium text-muted-ink",
                        col === "A"
                          ? "min-w-[152px]"
                          : col === "B"
                            ? "min-w-[132px]"
                            : "min-w-[92px]"
                      )}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeSheet.rows.map((row) => {
                  const isHeader = Boolean(row.isHeader)
                  const isTotal = Boolean(row.isTotal)
                  return (
                    <tr
                      key={row.rowNumber}
                      data-row-number={row.rowNumber}
                      className={cn(
                        isHeader && "bg-brand-softer font-semibold text-ink",
                        isTotal && "bg-raised font-semibold text-ink"
                      )}
                    >
                      <td className="sticky left-0 z-10 h-7 w-9 border border-hairline bg-inset text-center font-mono text-[10.5px] text-muted-ink">
                        {row.rowNumber}
                      </td>
                      {activeSheet.columns.map((col) => {
                        const cellRef = `${col}${row.rowNumber}`
                        const rawValue = row.cells[col]
                        const formula = row.formulas?.[col]
                        const format = row.formats?.[col]
                        const isSelected = selectedCellRef === cellRef
                        const isFocused = focusedCellRef === cellRef
                        const isNumeric =
                          typeof rawValue === "number" ||
                          format === "currency" ||
                          format === "percent" ||
                          format === "integer" ||
                          format === "number"
                        const formatted = formatExcelCellValue(rawValue, format)
                        const isEditable = !isHeader && !isTotal && !formula

                        return (
                          <td
                            key={cellRef}
                            data-cell-ref={cellRef}
                            data-formula={formula}
                            onClick={() => selectCell(col, row)}
                            className={cn(
                              "relative h-7 border border-hairline px-0 py-0 align-middle",
                              isHeader && "border-b-brand/50 px-2.5 text-ink",
                              isTotal &&
                                "border-t-brand/60 border-b-brand/60 px-2.5",
                              isSelected &&
                                "z-10 bg-brand-soft ring-2 ring-brand ring-inset"
                            )}
                          >
                            {isEditable ? (
                              <input
                                type="text"
                                aria-label={`Cell ${cellRef}`}
                                value={
                                  isFocused
                                    ? rawValue !== undefined
                                      ? String(rawValue)
                                      : ""
                                    : formatted
                                }
                                onFocus={() => {
                                  setFocusedCellRef(cellRef)
                                  selectCell(col, row)
                                }}
                                onBlur={() => setFocusedCellRef(null)}
                                onChange={(event) => {
                                  commitCellEdit(
                                    activeSheet.id,
                                    row.rowNumber,
                                    col,
                                    event.target.value
                                  )
                                }}
                                className={cn(
                                  "h-full w-full bg-transparent px-2.5 text-xs text-ink outline-none",
                                  isNumeric && "text-right font-mono tabular-nums"
                                )}
                              />
                            ) : (
                              <div
                                data-testid={`excel-cell-${cellRef}`}
                                className={cn(
                                  "flex h-full w-full items-center whitespace-nowrap",
                                  !isHeader && !isTotal && "px-2.5",
                                  isNumeric &&
                                    "justify-end font-mono tabular-nums",
                                  formula && "text-brand-text"
                                )}
                              >
                                {formatted}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Bottom Worksheet Tab Switcher */}
      <div
        role="tablist"
        aria-label="Workbook sheets"
        className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-t border-hairline bg-chrome px-2"
      >
        {sheets.map((sheet) => {
          const isActive = sheet.id === activeSheet?.id
          return (
            <button
              key={sheet.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleSwitchSheet(sheet.id)}
              className={cn(
                "h-6 cursor-pointer rounded-t-sm border-b-2 px-2.5 text-[11.5px] whitespace-nowrap transition-colors",
                isActive
                  ? "border-brand bg-canvas font-semibold text-brand-text"
                  : "border-transparent text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              {sheet.name}
            </button>
          )
        })}

        <button
          type="button"
          aria-label="Add worksheet"
          onClick={() => toast("Worksheet templates available via RayuCode chat")}
          className="ml-1 grid size-5 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
        >
          <Plus className="size-3" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {/* Excel Status Strip */}
      <div
        style={{
          backgroundColor: "var(--office-excel-soft)",
          color: "var(--office-excel)",
        }}
        className="flex h-6 shrink-0 items-center gap-4 border-t border-hairline px-3 font-mono text-[10.5px] font-medium tabular-nums"
      >
        <span>Ready</span>
        <span className="flex-1" />
        <span>Count: {statusSummary.count}</span>
        <span data-testid="excel-status-sum">{statusSummary.sumLabel}</span>
        <span>100%</span>
      </div>

      {/* Floating Ask RayuCode Chat Drawer in Full View */}
      {fullView && (
        <FloatingAskChat
          title="Ask RayuCode"
          contextLabel={fileName}
          contextKind="excel"
          messages={data?.browser.chatMessages ?? []}
          minimized={chatMinimized}
          onMinimizedChange={setChatMinimized}
          onSendMessage={async (question) => {
            await sendQuestionMutation.mutateAsync(question)
          }}
          isSending={sendQuestionMutation.isPending}
        />
      )}
    </div>
  )
}
