import { execFile } from "node:child_process"
import { shell } from "electron"

export async function openInExcel(filePath: string): Promise<{ ok: boolean }> {
  try {
    const errMsg = await shell.openPath(filePath)
    return { ok: errMsg === "" }
  } catch {
    return { ok: false }
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
