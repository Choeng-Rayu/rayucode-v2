import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import type { BrowserWindow, OpenDialogOptions } from "electron"

import { getGitBranch } from "./git-bridge.js"

export interface WorkspaceInfo {
  host: string
  project: string
  path: string
  branch: string
}

export interface WorkspaceCodeFile {
  pill: string
  path: string
  language: string
  startLine: number
  lines: string[]
  truncated?: boolean
  isBinary?: boolean
}

const EXT_TO_LANG: Record<string, string> = {
  ".rs": "rust",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".html": "html",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "bash",
  ".zsh": "bash",
  ".py": "python",
  ".go": "go",
  ".sql": "sql",
}

export function detectLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return EXT_TO_LANG[ext] ?? "text"
}

function resolveRealpathWithFallback(targetPath: string): string {
  const abs = path.resolve(targetPath)
  const missingSegments: string[] = []
  let probe = abs
  while (true) {
    try {
      const real = fsSync.realpathSync(probe)
      return missingSegments.length > 0
        ? path.join(real, ...missingSegments)
        : real
    } catch {
      const parent = path.dirname(probe)
      if (parent === probe) {
        return abs
      }
      missingSegments.unshift(path.basename(probe))
      probe = parent
    }
  }
}

export function resolveSafeWorkspacePath(
  rootDir: string,
  targetPath: string
): string {
  const normalizedRoot = path.resolve(rootDir)
  const candidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(normalizedRoot, targetPath)
  const lexicalRel = path.relative(normalizedRoot, candidate)
  if (lexicalRel.startsWith("..") || path.isAbsolute(lexicalRel)) {
    throw new Error("Path escapes active workspace root")
  }
  const realRoot = resolveRealpathWithFallback(normalizedRoot)
  const realCandidate = resolveRealpathWithFallback(candidate)
  const realRel = path.relative(realRoot, realCandidate)
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
    throw new Error("Path escapes active workspace root via symlink")
  }
  return fsSync.existsSync(candidate) ? realCandidate : candidate
}

function formatHostLabel(): string {
  const platform =
    process.platform === "darwin"
      ? "macOS"
      : process.platform === "win32"
        ? "Windows"
        : "Linux"
  return `Local · ${platform} (${os.arch()})`
}

export async function getWorkspaceInfo(rootDir: string): Promise<WorkspaceInfo> {
  const resolved = path.resolve(rootDir)
  const branch = (await getGitBranch(resolved)) ?? "main"
  return {
    host: formatHostLabel(),
    project: path.basename(resolved),
    path: resolved,
    branch,
  }
}

export async function readWorkspaceFile(
  rootDir: string,
  filePath: string,
  maxBytes = 256_000
): Promise<WorkspaceCodeFile> {
  const resolved = resolveSafeWorkspacePath(rootDir, filePath)
  const realRoot = resolveRealpathWithFallback(rootDir)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`)
  }

  const handle = await fs.open(resolved, "r")
  try {
    const readSize = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(readSize)
    const { bytesRead } = await handle.read(buffer, 0, readSize, 0)
    const active = buffer.subarray(0, bytesRead)
    const probeLen = Math.min(bytesRead, 8192)
    const hasNulByte = active.subarray(0, probeLen).includes(0)
    const truncated = stat.size > bytesRead
    const relPath =
      path.relative(realRoot, resolved) ||
      path.relative(path.resolve(rootDir), resolved) ||
      path.basename(resolved)

    if (hasNulByte) {
      return {
        pill: path.basename(resolved),
        path: relPath,
        language: "text",
        startLine: 1,
        lines: ["[Binary file — preview unavailable]"],
        truncated,
        isBinary: true,
      }
    }

    const decoder = new StringDecoder("utf8")
    const content = truncated ? decoder.write(active) : decoder.end(active)
    return {
      pill: path.basename(resolved),
      path: relPath,
      language: detectLanguageFromPath(resolved),
      startLine: 1,
      lines: content.split("\n"),
      truncated,
      isBinary: false,
    }
  } finally {
    await handle.close()
  }
}

export interface PickedWorkspaceEntry {
  name: string
  path: string
  isDirectory: boolean
  dataUrl?: string
  mediaType?: string
}

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

const MAX_PICKED_IMAGE_BYTES = 10 * 1024 * 1024

export async function pickWorkspaceFiles(
  parentWindow: BrowserWindow | null,
  defaultPath?: string
): Promise<PickedWorkspaceEntry[]> {
  const { dialog } = await import("electron")
  const options: OpenDialogOptions = {
    title: "Add Files or Folders",
    defaultPath,
    properties: ["openFile", "openDirectory", "multiSelections"],
  }
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return []
  }

  const entries: PickedWorkspaceEntry[] = []
  for (const filePath of result.filePaths) {
    let isDirectory = false
    let dataUrl: string | undefined
    let mediaType: string | undefined
    try {
      const stat = await fs.stat(filePath)
      isDirectory = stat.isDirectory()
      if (!isDirectory && stat.size > 0 && stat.size <= MAX_PICKED_IMAGE_BYTES) {
        const mime = IMAGE_EXT_TO_MIME[path.extname(filePath).toLowerCase()]
        if (mime) {
          const bytes = await fs.readFile(filePath)
          mediaType = mime
          dataUrl = `data:${mime};base64,${bytes.toString("base64")}`
        }
      }
    } catch {
      // ignore stat/read errors
    }
    entries.push({
      name: path.basename(filePath) || filePath,
      path: filePath,
      isDirectory,
      ...(dataUrl ? { dataUrl, mediaType } : {}),
    })
  }
  return entries
}

export async function pickWorkspaceFolder(
  parentWindow: BrowserWindow | null
): Promise<string | null> {
  const { dialog } = await import("electron")
  const options: OpenDialogOptions = {
    title: "Open Project Workspace",
    properties: ["openDirectory", "createDirectory"],
  }
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
}
