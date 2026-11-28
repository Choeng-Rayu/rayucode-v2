import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { IpcMainInvokeEvent } from "electron"

export interface TrustedRendererOptions {
  devServerUrl?: string
  distDir: string
}

export function isTrustedRendererUrl(
  frameUrl: string,
  options: TrustedRendererOptions
): boolean {
  const trimmed = frameUrl.trim()
  if (!trimmed) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }

  if (options.devServerUrl) {
    try {
      const devParsed = new URL(options.devServerUrl)
      if (parsed.origin === devParsed.origin) {
        return true
      }
    } catch {
      // Ignore malformed dev server URL
    }
  }

  if (parsed.protocol === "file:") {
    try {
      const filePath = path.resolve(fileURLToPath(parsed))
      const resolvedDist = path.resolve(options.distDir)
      let realFile = filePath
      let realDist = resolvedDist
      try {
        if (fs.existsSync(filePath)) realFile = fs.realpathSync(filePath)
        if (fs.existsSync(resolvedDist)) realDist = fs.realpathSync(resolvedDist)
      } catch {
        // Fall back to lexical resolution
      }
      return (
        realFile === realDist ||
        realFile.startsWith(`${realDist}${path.sep}`)
      )
    } catch {
      return false
    }
  }

  return false
}

export function assertTrustedSender(
  event: Pick<IpcMainInvokeEvent, "senderFrame">,
  options: TrustedRendererOptions
): void {
  const frameUrl = event.senderFrame?.url ?? ""
  if (!isTrustedRendererUrl(frameUrl, options)) {
    throw new Error(
      `Blocked IPC call from untrusted renderer frame: ${frameUrl || "(empty)"}`
    )
  }
}

export function isAllowedWebviewUrl(rawUrl?: string): boolean {
  if (!rawUrl || !rawUrl.trim()) {
    return true
  }
  const trimmed = rawUrl.trim()
  if (trimmed === "about:blank") {
    return true
  }
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
