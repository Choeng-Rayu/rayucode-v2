import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { shell } from "electron"

import {
  createRealPowerPointDeck,
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
): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  try {
    const trimmed = filePath.trim()
    const target = trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(2))
      : path.isAbsolute(trimmed)
        ? trimmed
        : path.resolve(workspaceDir, trimmed)

    if (!fs.existsSync(target)) {
      return { ok: false, error: `Excel file not found: ${target}` }
    }

    const ok = await openFileWithAppOrDefault(target, "Microsoft Excel")
    return { ok, filePath: target }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
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
  line?: number,
  workspaceDir = process.cwd()
): Promise<{ ok: boolean }> {
  const trimmed = targetPath.trim()
  const expanded = trimmed.startsWith("~/")
    ? path.join(os.homedir(), trimmed.slice(2))
    : path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(workspaceDir, trimmed)
  const target = line ? `${expanded}:${line}` : expanded
  const codeCmd = process.platform === "win32" ? "code.cmd" : "code"
  return new Promise((resolve) => {
    execFile(codeCmd, ["--goto", target], (err) => {
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
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false }
    }
    await shell.openExternal(parsed.toString())
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
