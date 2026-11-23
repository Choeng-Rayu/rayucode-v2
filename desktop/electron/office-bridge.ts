import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ExcelJS from "exceljs"
import PptxGenJS from "pptxgenjs"

import { getRayuConfigDir } from "./auth-bridge.js"

export interface OfficeExcelRow {
  rowNumber: number
  cells: Record<string, string | number>
  formulas?: Record<string, string>
  formats?: Record<string, "currency" | "percent" | "number" | "text">
  isTotal?: boolean
}

export interface OfficeExcelSheet {
  id: string
  name: string
  columns: string[]
  headers: Record<string, string>
  rows: OfficeExcelRow[]
}

export interface OfficeExcelWorkbookPayload {
  fileName: string
  filePath: string
  sheets: OfficeExcelSheet[]
}

export interface OfficePowerPointSlideSpec {
  id?: string
  kicker?: string
  title: string
  subtitle?: string
  body: string
  bullets?: string[]
  metrics?: Array<{ label: string; value: string; note?: string }>
  notes?: string
  layout?: "cover" | "scorecard" | "bullets"
}

function expandPath(rawPath: string, workspaceDir: string): string {
  const trimmed = rawPath.trim()
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed)
  }
  return path.resolve(workspaceDir, trimmed)
}

function colIndexToLetter(index: number): string {
  let n = index
  let result = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result || "A"
}

function detectCellFormat(
  numFmt?: string
): "currency" | "percent" | "number" | "text" | undefined {
  if (!numFmt) return undefined
  if (numFmt.includes("$") || numFmt.includes("€") || numFmt.includes("£")) {
    return "currency"
  }
  if (numFmt.includes("%")) {
    return "percent"
  }
  if (numFmt.includes("0") || numFmt.includes("#")) {
    return "number"
  }
  return undefined
}

function extractPrimitiveCellValue(raw: ExcelJS.CellValue): {
  value: string | number
  formula?: string
} {
  if (raw === null || raw === undefined) {
    return { value: "" }
  }
  if (typeof raw === "number" || typeof raw === "string") {
    return { value: raw }
  }
  if (typeof raw === "boolean") {
    return { value: raw ? "TRUE" : "FALSE" }
  }
  if (raw instanceof Date) {
    return { value: raw.toISOString().slice(0, 10) }
  }
  if (typeof raw === "object") {
    if ("formula" in raw && typeof raw.formula === "string") {
      const result = "result" in raw ? raw.result : undefined
      const resolved =
        typeof result === "number" || typeof result === "string" ? result : 0
      return {
        value: resolved,
        formula: raw.formula.startsWith("=") ? raw.formula : `=${raw.formula}`,
      }
    }
    if ("richText" in raw && Array.isArray(raw.richText)) {
      return { value: raw.richText.map((r) => r.text).join("") }
    }
    if ("text" in raw && typeof raw.text === "string") {
      return { value: raw.text }
    }
  }
  return { value: String(raw) }
}

export async function readRealExcelWorkbook(
  workspaceDir: string,
  targetPath: string
): Promise<OfficeExcelWorkbookPayload> {
  const resolved = expandPath(targetPath, workspaceDir)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Excel file not found: ${resolved}`)
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(resolved)

  const sheets: OfficeExcelSheet[] = []

  workbook.eachSheet((ws, idx) => {
    const colCount = Math.max(1, Math.min(26, ws.columnCount || 6))
    const columns: string[] = []
    for (let c = 1; c <= colCount; c += 1) {
      columns.push(colIndexToLetter(c))
    }

    const headers: Record<string, string> = {}
    const rows: OfficeExcelRow[] = []
    const maxRow = Math.min(250, ws.rowCount || 1)

    for (let r = 1; r <= maxRow; r += 1) {
      const excelRow = ws.getRow(r)
      if (r === 1) {
        for (let c = 1; c <= colCount; c += 1) {
          const colLetter = columns[c - 1]
          const { value } = extractPrimitiveCellValue(excelRow.getCell(c).value)
          headers[colLetter] = String(value || colLetter)
        }
        continue
      }

      const cells: Record<string, string | number> = {}
      const formulas: Record<string, string> = {}
      const formats: Record<string, "currency" | "percent" | "number" | "text"> =
        {}
      let hasAnyContent = false

      for (let c = 1; c <= colCount; c += 1) {
        const colLetter = columns[c - 1]
        const cell = excelRow.getCell(c)
        const { value, formula } = extractPrimitiveCellValue(cell.value)
        if (value !== "" || formula) {
          hasAnyContent = true
        }
        cells[colLetter] = value
        if (formula) {
          formulas[colLetter] = formula
        }
        const fmt = detectCellFormat(cell.numFmt)
        if (fmt) {
          formats[colLetter] = fmt
        }
      }

      if (!hasAnyContent) continue
      const firstLabel = String(cells.A ?? "").toLowerCase()
      const isTotal =
        firstLabel.startsWith("total") ||
        firstLabel.startsWith("summary") ||
        Object.keys(formulas).length > 0

      rows.push({
        rowNumber: r,
        cells,
        ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
        ...(Object.keys(formats).length > 0 ? { formats } : {}),
        ...(isTotal ? { isTotal: true } : {}),
      })
    }

    sheets.push({
      id: `sheet_${idx}_${ws.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: ws.name,
      columns,
      headers,
      rows,
    })
  })

  return {
    fileName: path.basename(resolved),
    filePath: resolved,
    sheets,
  }
}

export async function writeRealExcelWorkbook(
  workspaceDir: string,
  input: {
    filePath: string
    sheets: Array<{
      name: string
      columns?: string[]
      headers: Record<string, string>
      rows: Array<{
        rowNumber?: number
        cells: Record<string, string | number>
        formulas?: Record<string, string>
        formats?: Record<string, "currency" | "percent" | "number" | "text">
        isTotal?: boolean
      }>
    }>
  }
): Promise<{
  ok: boolean
  filePath: string
  sheetCount: number
  rowCount: number
  workbook: OfficeExcelWorkbookPayload
}> {
  const resolved = expandPath(input.filePath, workspaceDir)
  const finalPath = resolved.toLowerCase().endsWith(".xlsx")
    ? resolved
    : `${resolved}.xlsx`
  fs.mkdirSync(path.dirname(finalPath), { recursive: true })

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "RayuCode Desktop"
  workbook.created = new Date()

  let totalRows = 0

  for (const sheetSpec of input.sheets) {
    const ws = workbook.addWorksheet(sheetSpec.name.slice(0, 31) || "Sheet1", {
      views: [{ state: "frozen", ySplit: 1 }],
    })

    const cols =
      sheetSpec.columns && sheetSpec.columns.length > 0
        ? sheetSpec.columns
        : Object.keys(sheetSpec.headers)

    // Styled Header Row (Row 1)
    const headerRow = ws.getRow(1)
    cols.forEach((colLetter, idx) => {
      const cell = headerRow.getCell(idx + 1)
      cell.value = sheetSpec.headers[colLetter] ?? colLetter
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F2937" },
      }
      cell.alignment = { vertical: "middle", horizontal: "left" }
    })
    headerRow.height = 24

    // Data & Formula Rows
    sheetSpec.rows.forEach((rowSpec, rIdx) => {
      const rowNum = rowSpec.rowNumber ?? rIdx + 2
      const excelRow = ws.getRow(rowNum)
      totalRows += 1

      cols.forEach((colLetter, cIdx) => {
        const cell = excelRow.getCell(cIdx + 1)
        const formulaRaw = rowSpec.formulas?.[colLetter]
        const rawVal = rowSpec.cells[colLetter]

        if (formulaRaw && formulaRaw.trim()) {
          const cleanFormula = formulaRaw.trim().replace(/^=/, "")
          cell.value = {
            formula: cleanFormula,
            result: typeof rawVal === "number" ? rawVal : undefined,
          }
        } else if (rawVal !== undefined) {
          cell.value = rawVal
        }

        const fmt = rowSpec.formats?.[colLetter]
        if (fmt === "currency") {
          cell.numFmt = "$#,##0.00"
        } else if (fmt === "percent") {
          cell.numFmt = "0.0%"
          if (typeof rawVal === "number" && rawVal > 1 && !formulaRaw) {
            cell.value = rawVal / 100
          }
        } else if (fmt === "number") {
          cell.numFmt = "#,##0.##"
        }

        if (rowSpec.isTotal) {
          cell.font = { bold: true, size: 11 }
          cell.border = {
            top: { style: "thin", color: { argb: "FF94A3B8" } },
            bottom: { style: "double", color: { argb: "FF475569" } },
          }
        }
      })
    })

    // Auto-size columns comfortably
    cols.forEach((colLetter, idx) => {
      let maxLen = String(sheetSpec.headers[colLetter] ?? colLetter).length
      for (const rowSpec of sheetSpec.rows) {
        const v = String(rowSpec.cells[colLetter] ?? "")
        if (v.length > maxLen) maxLen = v.length
      }
      ws.getColumn(idx + 1).width = Math.min(44, Math.max(12, maxLen + 4))
    })
  }

  await workbook.xlsx.writeFile(finalPath)
  const hydrated = await readRealExcelWorkbook(workspaceDir, finalPath)

  return {
    ok: true,
    filePath: finalPath,
    sheetCount: input.sheets.length,
    rowCount: totalRows,
    workbook: hydrated,
  }
}

export async function createRealPowerPointDeck(
  workspaceDir: string,
  input: {
    filePath?: string
    fileName?: string
    title: string
    slides: OfficePowerPointSlideSpec[]
  }
): Promise<{
  ok: boolean
  filePath: string
  slideCount: number
  title: string
  slides: OfficePowerPointSlideSpec[]
}> {
  let finalPath: string
  if (input.filePath?.trim()) {
    const resolved = expandPath(input.filePath, workspaceDir)
    finalPath = resolved.toLowerCase().endsWith(".pptx")
      ? resolved
      : `${resolved}.pptx`
  } else {
    const outDir = path.join(getRayuConfigDir(), "presentations")
    const safeName =
      (input.fileName ?? input.title)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "") || "rayucode-deck"
    finalPath = path.join(outDir, `${safeName}.pptx`)
  }
  fs.mkdirSync(path.dirname(finalPath), { recursive: true })

  type PptxInstance = InstanceType<typeof PptxGenJS.default>
  type PptxConstructor = new () => PptxInstance
  const mod = PptxGenJS as unknown as
    | { default?: PptxConstructor }
    | PptxConstructor
  const PptxCtor: PptxConstructor =
    typeof mod === "function" ? mod : (mod.default as PptxConstructor)
  const pptx = new PptxCtor()
  pptx.layout = "LAYOUT_WIDE" // 13.33 x 7.5 in (16:9)
  pptx.title = input.title
  pptx.author = "RayuCode Desktop"

  for (let i = 0; i < input.slides.length; i += 1) {
    const spec = input.slides[i]
    const slide = pptx.addSlide()
    slide.background = { color: "FFFFFF" }

    // Top subtle kicker
    slide.addText(spec.kicker ?? `Slide ${i + 1}`, {
      x: 0.75,
      y: 0.48,
      w: 11.8,
      h: 0.35,
      fontSize: 11,
      color: "64748B",
      fontFace: "Arial",
    })

    // Title
    const isCover = spec.layout === "cover" || i === 0
    slide.addText(spec.title, {
      x: 0.75,
      y: isCover ? 1.15 : 0.9,
      w: 11.8,
      h: isCover ? 1.45 : 0.85,
      fontSize: isCover ? 34 : 26,
      bold: true,
      color: "1E3A8A",
      fontFace: "Arial",
      valign: "top",
    })

    // Divider hairline
    slide.addShape(pptx.ShapeType.line, {
      x: 0.75,
      y: isCover ? 2.75 : 1.85,
      w: 11.8,
      h: 0,
      line: { color: "CBD5E1", width: 1 },
    })

    let cursorY = isCover ? 3.05 : 2.1

    if (spec.subtitle) {
      slide.addText(spec.subtitle, {
        x: 0.75,
        y: cursorY,
        w: 11.8,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: "2563EB",
        fontFace: "Arial",
      })
      cursorY += 0.48
    }

    if (spec.body?.trim()) {
      slide.addText(spec.body.trim(), {
        x: 0.75,
        y: cursorY,
        w: 11.2,
        h: spec.metrics?.length ? 1.1 : 1.7,
        fontSize: 14,
        color: "334155",
        fontFace: "Arial",
        valign: "top",
      })
      cursorY += spec.metrics?.length ? 1.25 : 1.85
    }

    // Optional KPI metric cards
    if (spec.metrics && spec.metrics.length > 0) {
      const count = Math.min(3, spec.metrics.length)
      const gap = 0.3
      const cardW = (11.8 - gap * (count - 1)) / count
      for (let m = 0; m < count; m += 1) {
        const metric = spec.metrics[m]
        const cardX = 0.75 + m * (cardW + gap)
        slide.addShape(pptx.ShapeType.roundRect, {
          x: cardX,
          y: cursorY,
          w: cardW,
          h: 1.75,
          fill: { color: "F8FAFC" },
          line: { color: "E2E8F0", width: 1 },
          rectRadius: 0.12,
        })
        slide.addText(metric.label, {
          x: cardX + 0.22,
          y: cursorY + 0.2,
          w: cardW - 0.44,
          h: 0.32,
          fontSize: 11,
          color: "64748B",
          fontFace: "Arial",
        })
        slide.addText(metric.value, {
          x: cardX + 0.22,
          y: cursorY + 0.56,
          w: cardW - 0.44,
          h: 0.55,
          fontSize: 22,
          bold: true,
          color: "0F172A",
          fontFace: "Arial",
        })
        if (metric.note) {
          slide.addText(metric.note, {
            x: cardX + 0.22,
            y: cursorY + 1.18,
            w: cardW - 0.44,
            h: 0.4,
            fontSize: 10.5,
            color: "475569",
            fontFace: "Arial",
          })
        }
      }
      cursorY += 2.0
    }

    // Optional bullet list
    if (spec.bullets && spec.bullets.length > 0) {
      slide.addText(
        spec.bullets.map((text) => ({
          text,
          options: { bullet: true, breakLine: true, paraSpaceAfter: 8 },
        })),
        {
          x: 0.85,
          y: Math.min(cursorY, 4.6),
          w: 11.4,
          h: 2.4,
          fontSize: 14,
          color: "1E293B",
          fontFace: "Arial",
          valign: "top",
        }
      )
    }

    // Footer slide number
    slide.addText(`${input.title} · ${i + 1} / ${input.slides.length}`, {
      x: 0.75,
      y: 6.95,
      w: 11.8,
      h: 0.3,
      fontSize: 9.5,
      color: "94A3B8",
      align: "right",
      fontFace: "Arial",
    })

    if (spec.notes?.trim()) {
      slide.addNotes(spec.notes.trim())
    }
  }

  await pptx.writeFile({ fileName: finalPath })

  return {
    ok: true,
    filePath: finalPath,
    slideCount: input.slides.length,
    title: input.title,
    slides: input.slides,
  }
}

export function formatExcelSummaryForAi(wb: OfficeExcelWorkbookPayload): string {
  const parts: string[] = [`Workbook: ${wb.fileName} (${wb.filePath})`]
  for (const sheet of wb.sheets) {
    parts.push(`\n## Sheet: ${sheet.name}`)
    const headerLine = sheet.columns
      .map((c) => `${c}: ${sheet.headers[c] ?? c}`)
      .join(" | ")
    parts.push(`Headers: ${headerLine}`)
    for (const row of sheet.rows.slice(0, 60)) {
      const vals = sheet.columns
        .map((c) => {
          const formula = row.formulas?.[c]
          const val = row.cells[c]
          return formula ? `${c}${row.rowNumber}=${val} (${formula})` : `${c}${row.rowNumber}=${val ?? ""}`
        })
        .join(" | ")
      parts.push(`Row ${row.rowNumber}: ${vals}`)
    }
  }
  return parts.join("\n").slice(0, 12_000)
}
