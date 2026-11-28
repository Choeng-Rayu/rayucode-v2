import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createRealPowerPointDeck,
  formatExcelSummaryForAi,
  readRealExcelWorkbook,
  writeRealExcelWorkbook,
} from "../office-bridge"

describe("office-bridge (real .xlsx & .pptx generation and reading)", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-office-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("writes a real .xlsx workbook with live formulas and reads it back accurately", async () => {
    const outPath = path.join(tmpDir, "Q4-Model.xlsx")
    const written = await writeRealExcelWorkbook(tmpDir, {
      filePath: outPath,
      sheets: [
        {
          name: "Budget",
          columns: ["A", "B", "C"],
          headers: { A: "Item", B: "Units", C: "Cost" },
          rows: [
            {
              rowNumber: 2,
              cells: { A: "Compute", B: 10, C: 250 },
              formats: { C: "currency" },
            },
            {
              rowNumber: 3,
              cells: { A: "Storage", B: 5, C: 100 },
              formats: { C: "currency" },
            },
            {
              rowNumber: 4,
              cells: { A: "Total", B: 15, C: 350 },
              formulas: { B: "=SUM(B2:B3)", C: "=SUM(C2:C3)" },
              formats: { C: "currency" },
              isTotal: true,
            },
          ],
        },
      ],
    })

    expect(written.ok).toBe(true)
    expect(fs.existsSync(written.filePath)).toBe(true)
    expect(written.workbook.fileName).toBe("Q4-Model.xlsx")
    expect(written.workbook.filePath).toBe(written.filePath)
    expect(written.workbook.sheets).toHaveLength(1)
    expect(written.workbook.sheets[0].name).toBe("Budget")
    expect(written.workbook.sheets[0].rows[2].formulas?.C).toBe("=SUM(C2:C3)")

    const loaded = await readRealExcelWorkbook(tmpDir, written.filePath)
    expect(loaded.fileName).toBe("Q4-Model.xlsx")
    expect(loaded.sheets).toHaveLength(1)
    expect(loaded.sheets[0].name).toBe("Budget")
    expect(loaded.sheets[0].headers.A).toBe("Item")
    expect(loaded.sheets[0].rows).toHaveLength(3)
    expect(loaded.sheets[0].rows[2].formulas?.C).toBe("=SUM(C2:C3)")

    const summary = formatExcelSummaryForAi(loaded)
    expect(summary).toContain("Budget")
    expect(summary).toContain("=SUM(C2:C3)")
  })

  it("creates a real OOXML .pptx PowerPoint file on disk", async () => {
    const outPath = path.join(tmpDir, "Review.pptx")
    const created = await createRealPowerPointDeck(tmpDir, {
      filePath: outPath,
      title: "Q3 Product Review",
      slides: [
        {
          kicker: "RayuCode",
          title: "Q3 Product Review",
          subtitle: "Executive Summary",
          body: "Real OOXML PowerPoint deck generated from RayuCode Desktop.",
          layout: "cover",
        },
        {
          kicker: "Scorecard",
          title: "Key Metrics",
          body: "Verified latency and cache performance.",
          metrics: [
            { label: "p99 Lookup", value: "144 ns", note: "-30% latency" },
            { label: "KV Warm", value: "94.2%", note: "Shared cache" },
          ],
          bullets: ["Native PTY terminal", "Real Chromium CDP browser"],
          notes: "Present metric highlights first.",
        },
      ],
    })

    expect(created.ok).toBe(true)
    expect(created.slideCount).toBe(2)
    expect(created.title).toBe("Q3 Product Review")
    expect(created.slides).toHaveLength(2)
    expect(created.slides[0].title).toBe("Q3 Product Review")
    expect(fs.existsSync(created.filePath)).toBe(true)

    // Verify real OOXML ZIP header (PK\x03\x04)
    const buf = fs.readFileSync(created.filePath)
    expect(buf.length).toBeGreaterThan(2000)
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it("preserves untouched sheets when updating an existing workbook and round-trips fractional percents accurately", async () => {
    const outPath = path.join(tmpDir, "Preserve.xlsx")
    await writeRealExcelWorkbook(tmpDir, {
      filePath: outPath,
      sheets: [
        {
          name: "Existing",
          columns: ["A", "B"],
          headers: { A: "Key", B: "Rate" },
          rows: [
            {
              rowNumber: 2,
              cells: { A: "Margin", B: 94.5 },
              formats: { B: "percent" },
            },
          ],
        },
        {
          name: "Notes",
          columns: ["A"],
          headers: { A: "Keep Me" },
          rows: [{ rowNumber: 2, cells: { A: "Untouched sheet row" } }],
        },
      ],
    })

    // Read fractional decimal (0.945) then write another sheet update
    const before = await readRealExcelWorkbook(tmpDir, outPath)
    const decimalRate = before.sheets[0].rows[0].cells.B
    expect(Number(decimalRate)).toBeCloseTo(0.945, 4)

    await writeRealExcelWorkbook(tmpDir, {
      filePath: outPath,
      sheets: [
        {
          name: "Existing",
          columns: ["A", "B"],
          headers: { A: "Key", B: "Rate" },
          rows: [
            {
              rowNumber: 2,
              cells: { A: "Margin", B: decimalRate },
              formats: { B: "percent" },
            },
          ],
        },
      ],
    })

    const after = await readRealExcelWorkbook(tmpDir, outPath)
    expect(after.sheets.map((s) => s.name)).toContain("Notes")
    expect(after.sheets.find((s) => s.name === "Notes")?.rows[0].cells.A).toBe(
      "Untouched sheet row"
    )
    expect(Number(after.sheets[0].rows[0].cells.B)).toBeCloseTo(0.945, 4)
  })
})
