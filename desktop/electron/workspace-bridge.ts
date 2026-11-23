import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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

export function resolveSafeWorkspacePath(
  rootDir: string,
  targetPath: string
): string {
  const normalizedRoot = path.resolve(rootDir)
  const candidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(normalizedRoot, targetPath)
  const rel = path.relative(normalizedRoot, candidate)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes active workspace root")
  }
  return candidate
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
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`)
  }

  const handle = await fs.open(resolved, "r")
  try {
    const readSize = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(readSize)
    await handle.read(buffer, 0, readSize, 0)
    const content = buffer.toString("utf8")
    const relPath = path.relative(path.resolve(rootDir), resolved)
    return {
      pill: path.basename(resolved),
      path: relPath || path.basename(resolved),
      language: detectLanguageFromPath(resolved),
      startLine: 1,
      lines: content.split("\n"),
    }
  } finally {
    await handle.close()
  }
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
