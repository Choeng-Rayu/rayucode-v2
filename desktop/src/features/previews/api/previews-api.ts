import { queryOptions } from "@tanstack/react-query"

import { ipcClient, type PreviewsState } from "@/lib/ipc-client"

import {
  browserQuestionInputSchema,
  previewsViewModelSchema,
  updateExcelCellInputSchema,
} from "../schemas"
import type {
  BrowserBoundsSyncPayload,
  BrowserEndpointMetric,
  BrowserTokenBurnPoint,
  ExcelCellFormat,
  ExcelCellValue,
  ExcelRowData,
  ExcelSheetData,
  ExcelWorkbookState,
  PreviewsViewModel,
  UpdateExcelCellInput,
} from "../types"

interface ExtendedPreviewsBridge {
  setBrowserBounds?: (
    payload: BrowserBoundsSyncPayload
  ) => Promise<{ ok: boolean }>
}

const DEFAULT_BROWSER_URL = "http://localhost:3000/credits-dashboard"

const DEFAULT_TOKEN_BURN: BrowserTokenBurnPoint[] = [
  { label: "09:00", cachedK: 142, uncachedK: 18 },
  { label: "10:00", cachedK: 196, uncachedK: 22 },
  { label: "11:00", cachedK: 248, uncachedK: 19 },
  { label: "12:00", cachedK: 184, uncachedK: 14 },
  { label: "13:00", cachedK: 290, uncachedK: 21 },
  { label: "14:00", cachedK: 318, uncachedK: 16 },
]

const DEFAULT_ENDPOINTS: BrowserEndpointMetric[] = [
  {
    id: "ep_sessions",
    route: "POST /v1/sessions/lookup",
    model: "Claude Opus 5.5",
    p50Ms: 14,
    p99Ms: 38,
    status: "Live",
    credits: "0.42",
  },
  {
    id: "ep_swarm",
    route: "POST /v1/swarm/dispatch",
    model: "Claude Sonnet 5",
    p50Ms: 26,
    p99Ms: 64,
    status: "Autonomous",
    credits: "0.31",
  },
  {
    id: "ep_models",
    route: "GET /v1/models/discover",
    model: "DeepSeek V4 Flash",
    p50Ms: 9,
    p99Ms: 21,
    status: "Review",
    credits: "0.13",
  },
]

const DEFAULT_EXCEL_SHEETS: ExcelSheetData[] = [
  {
    id: "sheet_q4",
    name: "Q4 Token Model",
    columns: ["A", "B", "C", "D", "E"],
    rows: [
      {
        rowNumber: 1,
        isHeader: true,
        cells: {
          A: "Surface / Route",
          B: "Primary Model",
          C: "Tokens (K)",
          D: "KV Warm %",
          E: "Net Cost ($)",
        },
      },
      {
        rowNumber: 2,
        cells: {
          A: "Interactive Chat",
          B: "Claude Opus 5.5",
          C: 210,
          D: 94.5,
          E: 68.2,
        },
        formats: { C: "integer", D: "percent", E: "currency" },
      },
      {
        rowNumber: 3,
        cells: {
          A: "Code Edits & Diffs",
          B: "Claude Sonnet 5",
          C: 164,
          D: 93.0,
          E: 41.5,
        },
        formats: { C: "integer", D: "percent", E: "currency" },
      },
      {
        rowNumber: 4,
        cells: {
          A: "Fast Grep / Verify",
          B: "DeepSeek V4 Flash",
          C: 92,
          D: 96.2,
          E: 9.8,
        },
        formats: { C: "integer", D: "percent", E: "currency" },
      },
      {
        rowNumber: 5,
        cells: {
          A: "Swarm Workers (x4)",
          B: "GPT-6.1 Sol",
          C: 88,
          D: 91.3,
          E: 29.4,
        },
        formats: { C: "integer", D: "percent", E: "currency" },
      },
      {
        rowNumber: 6,
        cells: {
          A: "Overnight Soak Runs",
          B: "Claude Sonnet 5",
          C: 60,
          D: 91.0,
          E: 19.5,
        },
        formats: { C: "integer", D: "percent", E: "currency" },
      },
      {
        rowNumber: 7,
        isTotal: true,
        cells: {
          A: "Q4 Total / Avg",
          B: "5 active routes",
          C: 614,
          D: 93.2,
          E: 168.4,
        },
        formulas: {
          C: "=SUM(C2:C6)",
          D: "=AVERAGE(D2:D6)",
          E: "=SUM(E2:E6)",
        },
        formats: { C: "integer", D: "percent", E: "currency" },
      },
    ],
  },
  {
    id: "sheet_providers",
    name: "Provider Unit Costs",
    columns: ["A", "B", "C", "D", "E"],
    rows: [
      {
        rowNumber: 1,
        isHeader: true,
        cells: {
          A: "Provider / Model",
          B: "Route Tier",
          C: "Input / 1M ($)",
          D: "Cached / 1M ($)",
          E: "Output / 1M ($)",
        },
      },
      {
        rowNumber: 2,
        cells: {
          A: "Claude Opus 5.5",
          B: "Coordinator",
          C: 12.0,
          D: 1.2,
          E: 60.0,
        },
        formats: { C: "currency", D: "currency", E: "currency" },
      },
      {
        rowNumber: 3,
        cells: {
          A: "Claude Sonnet 5",
          B: "Primary Edit",
          C: 3.0,
          D: 0.3,
          E: 15.0,
        },
        formats: { C: "currency", D: "currency", E: "currency" },
      },
      {
        rowNumber: 4,
        cells: {
          A: "GPT-6.1 Sol",
          B: "Swarm Worker",
          C: 5.0,
          D: 0.5,
          E: 20.0,
        },
        formats: { C: "currency", D: "currency", E: "currency" },
      },
      {
        rowNumber: 5,
        cells: {
          A: "DeepSeek V4 Flash",
          B: "Fast Verify",
          C: 0.4,
          D: 0.08,
          E: 1.2,
        },
        formats: { C: "currency", D: "currency", E: "currency" },
      },
      {
        rowNumber: 6,
        isTotal: true,
        cells: {
          A: "Blended Avg Rate",
          B: "Rayu Gateway",
          C: 5.1,
          D: 0.52,
          E: 24.05,
        },
        formulas: {
          C: "=AVERAGE(C2:C5)",
          D: "=AVERAGE(D2:D5)",
          E: "=AVERAGE(E2:E5)",
        },
        formats: { C: "currency", D: "currency", E: "currency" },
      },
    ],
  },
  {
    id: "sheet_cache",
    name: "KV Cache Savings",
    columns: ["A", "B", "C", "D", "E"],
    rows: [
      {
        rowNumber: 1,
        isHeader: true,
        cells: {
          A: "TTL Policy",
          B: "Hit Rate %",
          C: "Saved Tok (K)",
          D: "Uncached ($)",
          E: "Net Savings ($)",
        },
      },
      {
        rowNumber: 2,
        cells: {
          A: "5-min hot prefix",
          B: 89.4,
          C: 1420,
          D: 210.0,
          E: 145.8,
        },
        formats: { B: "percent", C: "integer", D: "currency", E: "currency" },
      },
      {
        rowNumber: 3,
        cells: {
          A: "1-hour extended TTL",
          B: 95.2,
          C: 2665,
          D: 394.5,
          E: 300.3,
        },
        formats: { B: "percent", C: "integer", D: "currency", E: "currency" },
      },
      {
        rowNumber: 4,
        cells: {
          A: "Swarm shared prefix",
          B: 94.0,
          C: 1890,
          D: 280.0,
          E: 218.4,
        },
        formats: { B: "percent", C: "integer", D: "currency", E: "currency" },
      },
      {
        rowNumber: 5,
        isTotal: true,
        cells: {
          A: "Total / Avg Savings",
          B: 92.9,
          C: 5975,
          D: 884.5,
          E: 664.5,
        },
        formulas: {
          B: "=AVERAGE(B2:B4)",
          C: "=SUM(C2:C4)",
          D: "=SUM(D2:D4)",
          E: "=SUM(E2:E4)",
        },
        formats: { B: "percent", C: "integer", D: "currency", E: "currency" },
      },
    ],
  },
]

const DEFAULT_MARKDOWN_CONTENT = `# SessionCache Retirement & ShardStore Migration

Route all session reads through \`ShardStore::lookup\` with \`CacheBudget\` preserved so CLI, VS Code, and RayuCode Desktop share one lock-free path.

> **CLI Parity Verified:** Both \`rayu\` CLI and Desktop connect to the shared daemon socket with zero data migration required.

## Verification Checklist

- [x] Audit all 9 references to \`SessionCache\` across \`crates/rayucode-core\`
- [x] Route reads through \`ShardStore::lookup\` with \`CacheBudget\` LRU touch
- [x] Delete legacy \`src/session/cache.rs\` (48 lines removed)
- [x] Verify 14/14 \`session::\` unit tests and −38% RSS reduction

## Lookup Adapter

\`\`\`rust
pub fn get(&self, key: &SessionKey) -> Option<Session> {
    let hit = self.shards.lookup(key)?;
    self.budget.touch(key);
    Some(hit)
}
\`\`\`

## Memory Impact

| Metric | Before | After (ShardStore) |
| :--- | :---: | :---: |
| Per-session RSS | 114 MB | 71 MB (−38%) |
| Lookup p99 (50k keys) | 206 ns | 144 ns (−30.2%) |
| Session test suite | 14 passed | 14 passed |
`

export type FormulaCellLookup =
  | ((cellRef: string) => ExcelCellValue | undefined)
  | Record<string, ExcelCellValue>
  | ExcelSheetData

function isExcelSheetData(
  lookup: FormulaCellLookup
): lookup is ExcelSheetData {
  return (
    typeof lookup === "object" &&
    lookup !== null &&
    "rows" in lookup &&
    Array.isArray(lookup.rows) &&
    "columns" in lookup
  )
}

function columnLettersToIndex(letters: string): number {
  let result = 0
  const upper = letters.toUpperCase()
  for (let i = 0; i < upper.length; i += 1) {
    result = result * 26 + (upper.charCodeAt(i) - 64)
  }
  return result
}

function indexToColumnLetters(index: number): string {
  let num = index
  let letters = ""
  while (num > 0) {
    const rem = (num - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    num = Math.floor((num - 1) / 26)
  }
  return letters
}

function parseCellReference(
  ref: string
): { column: string; rowNumber: number } | null {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim())
  if (!match) return null
  return {
    column: match[1].toUpperCase(),
    rowNumber: Number.parseInt(match[2], 10),
  }
}

export function parseNumericCellValue(
  value: ExcelCellValue | undefined
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed === "" || trimmed === "—" || trimmed === "-") return null
  const cleaned = trimmed.replace(/[$,%\s,]/g, "").replace(/−/g, "-")
  if (!/^[+-]?\d*\.?\d+$/.test(cleaned)) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveLookupFunction(
  lookup: FormulaCellLookup
): (cellRef: string) => ExcelCellValue | undefined {
  if (typeof lookup === "function") {
    return lookup
  }

  if (isExcelSheetData(lookup)) {
    const byRow = new Map<number, ExcelRowData>()
    for (const row of lookup.rows) {
      byRow.set(row.rowNumber, row)
    }
    return (cellRef: string) => {
      const parsed = parseCellReference(cellRef)
      if (!parsed) return undefined
      const row = byRow.get(parsed.rowNumber)
      return row?.cells[parsed.column]
    }
  }

  const normalizedMap = new Map<string, ExcelCellValue>()
  for (const [key, val] of Object.entries(lookup)) {
    normalizedMap.set(key.toUpperCase(), val)
  }
  return (cellRef: string) => normalizedMap.get(cellRef.toUpperCase())
}

function expandRangeRefs(rangeExpr: string): string[] {
  const parts = rangeExpr.split(":")
  if (parts.length !== 2) return []
  const start = parseCellReference(parts[0])
  const end = parseCellReference(parts[1])
  if (!start || !end) return []

  const startCol = columnLettersToIndex(start.column)
  const endCol = columnLettersToIndex(end.column)
  const minCol = Math.min(startCol, endCol)
  const maxCol = Math.max(startCol, endCol)
  const minRow = Math.min(start.rowNumber, end.rowNumber)
  const maxRow = Math.max(start.rowNumber, end.rowNumber)

  const refs: string[] = []
  for (let col = minCol; col <= maxCol; col += 1) {
    const colName = indexToColumnLetters(col)
    for (let row = minRow; row <= maxRow; row += 1) {
      refs.push(`${colName}${row}`)
    }
  }
  return refs
}

function collectNumericArguments(
  argList: string,
  getCell: (cellRef: string) => ExcelCellValue | undefined
): number[] {
  const values: number[] = []
  const tokens = argList
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)

  for (const token of tokens) {
    if (token.includes(":")) {
      const refs = expandRangeRefs(token)
      for (const ref of refs) {
        const num = parseNumericCellValue(getCell(ref))
        if (num !== null) values.push(num)
      }
      continue
    }

    const parsedRef = parseCellReference(token)
    if (parsedRef) {
      const num = parseNumericCellValue(
        getCell(`${parsedRef.column}${parsedRef.rowNumber}`)
      )
      if (num !== null) values.push(num)
      continue
    }

    const directNum = parseNumericCellValue(token)
    if (directNum !== null) {
      values.push(directNum)
    }
  }

  return values
}

function roundExcelNumber(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Evaluates Excel formulas (`=SUM(...)`, `=AVERAGE(...)`, `=MIN(...)`, `=MAX(...)`,
 * `=COUNT(...)`, cell references, and binary arithmetic like `=D3-D2`) safely without `eval`.
 */
export function evaluateExcelFormula(
  formula: string,
  lookup: FormulaCellLookup
): ExcelCellValue {
  const trimmed = formula.trim()
  if (!trimmed.startsWith("=")) {
    const num = parseNumericCellValue(trimmed)
    return num !== null ? num : trimmed
  }

  const getCell = resolveLookupFunction(lookup)
  const expr = trimmed.slice(1).trim()

  const fnMatch = /^([A-Za-z]+)\((.*)\)$/.exec(expr)
  if (fnMatch) {
    const fnName = fnMatch[1].toUpperCase()
    const argStr = fnMatch[2]
    const nums = collectNumericArguments(argStr, getCell)

    switch (fnName) {
      case "SUM":
        return roundExcelNumber(nums.reduce((acc, n) => acc + n, 0))
      case "AVERAGE":
      case "AVG":
        if (nums.length === 0) return 0
        return roundExcelNumber(
          nums.reduce((acc, n) => acc + n, 0) / nums.length
        )
      case "MIN":
        return nums.length === 0 ? 0 : roundExcelNumber(Math.min(...nums))
      case "MAX":
        return nums.length === 0 ? 0 : roundExcelNumber(Math.max(...nums))
      case "COUNT":
        return nums.length
      default:
        return "#NAME?"
    }
  }

  const binaryMatch =
    /^(\$?[A-Za-z]+\$?\d+|\d+(?:\.\d+)?)\s*([+\-*/])\s*(\$?[A-Za-z]+\$?\d+|\d+(?:\.\d+)?)$/.exec(
      expr
    )
  if (binaryMatch) {
    const resolveOperand = (token: string): number | null => {
      const ref = parseCellReference(token)
      if (ref) {
        return parseNumericCellValue(getCell(`${ref.column}${ref.rowNumber}`))
      }
      return parseNumericCellValue(token)
    }

    const left = resolveOperand(binaryMatch[1])
    const op = binaryMatch[2]
    const right = resolveOperand(binaryMatch[3])

    if (left === null || right === null) return "#VALUE!"
    switch (op) {
      case "+":
        return roundExcelNumber(left + right)
      case "-":
        return roundExcelNumber(left - right)
      case "*":
        return roundExcelNumber(left * right)
      case "/":
        return right === 0 ? "#DIV/0!" : roundExcelNumber(left / right)
      default:
        return "#VALUE!"
    }
  }

  const singleRef = parseCellReference(expr)
  if (singleRef) {
    const resolved = getCell(`${singleRef.column}${singleRef.rowNumber}`)
    return resolved ?? ""
  }

  const literal = parseNumericCellValue(expr)
  return literal !== null ? literal : "#ERROR!"
}

/**
 * Recomputes every formula cell in a worksheet in place on a cloned copy,
 * propagating updates to dependent `SUM`, `AVERAGE`, and arithmetic cells.
 */
export function recalculateExcelSheet(sheet: ExcelSheetData): ExcelSheetData {
  let working: ExcelSheetData = {
    ...sheet,
    columns: [...sheet.columns],
    rows: sheet.rows.map((row) => ({
      ...row,
      cells: { ...row.cells },
      formulas: row.formulas ? { ...row.formulas } : undefined,
      formats: row.formats ? { ...row.formats } : undefined,
    })),
  }

  // Up to 2 passes handles chained formulas cleanly without risk of infinite loops
  for (let pass = 0; pass < 2; pass += 1) {
    working = {
      ...working,
      rows: working.rows.map((row) => {
        if (!row.formulas) return row
        const nextCells = { ...row.cells }
        for (const [col, formula] of Object.entries(row.formulas)) {
          nextCells[col] = evaluateExcelFormula(formula, working)
        }
        return {
          ...row,
          cells: nextCells,
        }
      }),
    }
  }

  return working
}

export function formatExcelCellValue(
  value: ExcelCellValue | undefined,
  format?: ExcelCellFormat
): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value

  switch (format) {
    case "currency":
      return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    case "percent":
      return `${value.toFixed(1)}%`
    case "integer":
      return Math.round(value).toLocaleString("en-US")
    case "number":
      return value.toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })
    default:
      return String(value)
  }
}

let workbookSessionCache: ExcelWorkbookState | null = null

function createNormalizedWorkbook(raw: PreviewsState["excel"]): ExcelWorkbookState {
  if (workbookSessionCache) {
    return structuredClone(workbookSessionCache)
  }

  const normalizedSheets = DEFAULT_EXCEL_SHEETS.map((sheet) =>
    recalculateExcelSheet(sheet)
  )

  const workbook: ExcelWorkbookState = {
    fileName: raw.fileName || "Q4-Token-Cost-Model.xlsx",
    filePath:
      raw.filePath ||
      "~/workspace/rayu/specs-and-docs/Q4-Token-Cost-Model.xlsx",
    activeSheetId: normalizedSheets[0].id,
    selectedCellRef: "C7",
    selectedFormula: "=SUM(C2:C6)",
    liveWebUrl: raw.liveWebUrl || "",
    sheets: normalizedSheets,
  }

  workbookSessionCache = structuredClone(workbook)
  return workbook
}

function normalizePreviewsState(raw: PreviewsState): PreviewsViewModel {
  const browserUrl =
    raw.browser.url && raw.browser.url.startsWith("http")
      ? raw.browser.url
      : DEFAULT_BROWSER_URL

  const normalized: PreviewsViewModel = {
    browser: {
      url: browserUrl,
      title: raw.browser.title || "localhost:3000",
      zoom: raw.browser.zoom || 100,
      deviceMode: raw.browser.deviceMode || "desktop",
      kpis:
        raw.browser.kpis.length >= 4
          ? raw.browser.kpis
          : [
              ...raw.browser.kpis,
              {
                label: "Credits Burn",
                value: "0.86 cr",
                delta: "−58% via KV cache",
              },
            ],
      tokenBurn: DEFAULT_TOKEN_BURN,
      endpoints: DEFAULT_ENDPOINTS,
      chatMessages: raw.browser.chatMessages.map((msg) => ({
        ...msg,
        timestamp: msg.sender === "agent" ? "Just now" : "You",
      })),
    },
    excel: createNormalizedWorkbook(raw.excel),
    markdown: {
      fileName: raw.markdown.fileName || "MIGRATION_PLAN.md",
      filePath: "docs/MIGRATION_PLAN.md",
      rawContent: DEFAULT_MARKDOWN_CONTENT,
      sections: [
        { id: "sessioncache-retirement-shardstore-migration", title: "Overview" },
        { id: "verification-checklist", title: "Verification Checklist" },
        { id: "lookup-adapter", title: "Lookup Adapter" },
        { id: "memory-impact", title: "Memory Impact" },
      ],
    },
  }

  return previewsViewModelSchema.parse(normalized)
}

export const previewsKeys = {
  all: ["previews"] as const,
  state: () => [...previewsKeys.all, "state"] as const,
}

export async function fetchPreviewsState(): Promise<PreviewsViewModel> {
  const raw = await ipcClient.previews.getState()
  return normalizePreviewsState(raw)
}

export function previewsQueryOptions() {
  return queryOptions({
    queryKey: previewsKeys.state(),
    queryFn: fetchPreviewsState,
    staleTime: 30_000,
  })
}

export async function updateExcelCell(
  input: UpdateExcelCellInput
): Promise<PreviewsViewModel> {
  const parsed = updateExcelCellInputSchema.parse(input)

  await ipcClient.previews.updateExcelCell({
    sheetId: parsed.sheetId,
    rowNumber: parsed.rowNumber,
    column: parsed.column,
    value: parsed.value,
  })

  if (!workbookSessionCache) {
    await fetchPreviewsState()
  }

  if (workbookSessionCache) {
    workbookSessionCache = {
      ...workbookSessionCache,
      selectedCellRef: `${parsed.column}${parsed.rowNumber}`,
      selectedFormula:
        parsed.formula !== undefined ? parsed.formula : String(parsed.value),
      sheets: workbookSessionCache.sheets.map((sheet) => {
        if (sheet.id !== parsed.sheetId) return sheet
        const updatedSheet: ExcelSheetData = {
          ...sheet,
          rows: sheet.rows.map((row) => {
            if (row.rowNumber !== parsed.rowNumber) return row
            const nextCells = { ...row.cells }
            const nextFormulas = row.formulas ? { ...row.formulas } : {}

            if (
              typeof parsed.formula === "string" &&
              parsed.formula.trim().startsWith("=")
            ) {
              nextFormulas[parsed.column] = parsed.formula.trim()
            } else if (
              typeof parsed.value === "string" &&
              parsed.value.trim().startsWith("=")
            ) {
              nextFormulas[parsed.column] = parsed.value.trim()
            } else {
              delete nextFormulas[parsed.column]
              const numeric = parseNumericCellValue(parsed.value)
              nextCells[parsed.column] = numeric !== null ? numeric : parsed.value
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
      }),
    }
  }

  return fetchPreviewsState()
}

export async function sendBrowserQuestion(
  question: string
): Promise<PreviewsViewModel> {
  const parsed = browserQuestionInputSchema.parse({ question })
  const raw = await ipcClient.previews.sendBrowserQuestion(parsed.question)
  return normalizePreviewsState(raw)
}

export async function syncBrowserBounds(
  payload: BrowserBoundsSyncPayload
): Promise<{ ok: boolean }> {
  const previewsBridge = ipcClient.previews as typeof ipcClient.previews &
    ExtendedPreviewsBridge

  if (typeof previewsBridge.setBrowserBounds === "function") {
    return previewsBridge.setBrowserBounds(payload)
  }

  if (typeof window !== "undefined" && window.rayu?.daemon?.invoke) {
    try {
      return await window.rayu.daemon.invoke<{ ok: boolean }>(
        "previews.setBrowserBounds",
        payload
      )
    } catch {
      return { ok: false }
    }
  }

  return { ok: true }
}

export async function openExcelInNativeApp(
  filePath: string
): Promise<{ ok: boolean }> {
  return ipcClient.native.openInExcel(filePath)
}

export async function openMarkdownInVSCode(
  filePath: string,
  line = 1
): Promise<{ ok: boolean }> {
  return ipcClient.native.openInVSCode(filePath, line)
}

export async function openUrlInSystemBrowser(
  url: string
): Promise<{ ok: boolean }> {
  return ipcClient.native.openExternal(url)
}

export function resetPreviewsCacheForTests(): void {
  workbookSessionCache = null
}
