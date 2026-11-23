import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { shell } from "electron"

import { getRayuConfigDir } from "./auth-bridge.js"
import {
  createRealPowerPointDeck,
  writeRealExcelWorkbook,
  type OfficePowerPointSlideSpec,
} from "./office-bridge.js"

function openFileWithAppOrDefault(
  filePath: string,
  macAppName: string
): Promise<boolean> {
  if (process.platform === "darwin") {
    return new Promise((resolve) => {
      execFile("open", ["-a", macAppName, filePath], (err) => {
        if (err) {
          void shell.openPath(filePath).then((errMsg) => resolve(errMsg === ""))
          return
        }
        resolve(true)
      })
    })
  }
  return shell.openPath(filePath).then((errMsg) => errMsg === "")
}

export async function openInExcel(
  filePath: string,
  workspaceDir = process.cwd()
): Promise<{ ok: boolean; filePath?: string }> {
  try {
    const trimmed = filePath.trim()
    const expanded = trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(2))
      : path.isAbsolute(trimmed)
        ? trimmed
        : path.resolve(workspaceDir, trimmed)

    let target = expanded
    if (!fs.existsSync(target)) {
      // Materialize a real .xlsx workbook in ~/.rayu/workbooks when opening a template/demo path
      const outDir = path.join(getRayuConfigDir(), "workbooks")
      const base = path.basename(target).endsWith(".xlsx")
        ? path.basename(target)
        : `${path.basename(target) || "RayuCode-Workbook"}.xlsx`
      const generated = await writeRealExcelWorkbook(workspaceDir, {
        filePath: path.join(outDir, base),
        sheets: [
          {
            name: "Q4 Cost Model",
            columns: ["A", "B", "C", "D", "E"],
            headers: {
              A: "Workflow",
              B: "Primary Model",
              C: "Tokens (M)",
              D: "KV Warm %",
              E: "Est. Cost ($)",
            },
            rows: [
              {
                rowNumber: 2,
                cells: {
                  A: "Codebase refactor",
                  B: "Claude Opus 5.5",
                  C: 210,
                  D: 94.5,
                  E: 420,
                },
                formats: { C: "number", D: "percent", E: "currency" },
              },
              {
                rowNumber: 3,
                cells: {
                  A: "Parallel swarm QA",
                  B: "GPT-6.1 Sol",
                  C: 164,
                  D: 93.0,
                  E: 295,
                },
                formats: { C: "number", D: "percent", E: "currency" },
              },
              {
                rowNumber: 4,
                cells: {
                  A: "Total / Average",
                  B: "Blended",
                  C: 374,
                  D: 93.8,
                  E: 715,
                },
                formulas: {
                  C: "=SUM(C2:C3)",
                  D: "=AVERAGE(D2:D3)",
                  E: "=SUM(E2:E3)",
                },
                formats: { C: "number", D: "percent", E: "currency" },
                isTotal: true,
              },
            ],
          },
        ],
      })
      target = generated.filePath
    }

    const ok = await openFileWithAppOrDefault(target, "Microsoft Excel")
    return { ok, filePath: target }
  } catch {
    return { ok: false }
  }
}

export interface PowerPointSlideInput extends OfficePowerPointSlideSpec {
  id: string
}

export async function openInPowerPoint(
  input: {
    filePath?: string
    fileName?: string
    title: string
    slides: PowerPointSlideInput[]
  },
  workspaceDir = process.cwd()
): Promise<{ ok: boolean; filePath: string }> {
  try {
    const created = await createRealPowerPointDeck(workspaceDir, {
      filePath: input.filePath,
      fileName: input.fileName,
      title: input.title,
      slides: input.slides,
    })
    const ok = await openFileWithAppOrDefault(
      created.filePath,
      "Microsoft PowerPoint"
    )
    return { ok, filePath: created.filePath }
  } catch {
    return { ok: false, filePath: "" }
  }
}

export async function openInVSCode(
  targetPath: string,
  line?: number
): Promise<{ ok: boolean }> {
  const target = line ? `${targetPath}:${line}` : targetPath
  return new Promise((resolve) => {
    execFile("code", ["--goto", target], (err) => {
      if (err) {
        resolve({ ok: false })
        return
      }
      resolve({ ok: true })
    })
  })
}

export async function openExternal(url: string): Promise<{ ok: boolean }> {
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export async function revealInFinder(
  targetPath: string
): Promise<{ ok: boolean }> {
  try {
    const expanded = targetPath.startsWith("~/")
      ? path.join(os.homedir(), targetPath.slice(2))
      : targetPath
    const resolved = path.resolve(expanded)
    shell.showItemInFolder(resolved)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
