import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  WorkspaceRegistry,
  canonicalizeWorkspacePath,
  getDefaultWorkspacesFilePath,
  type WorkspaceLedger,
} from "@rayu-dev/rayucode-session-core/host"

import { getRayuAppConfigDir, getRayuConfigDir } from "./auth-bridge.js"

export interface PersistedDesktopPreferences {
  notificationsEnabled: boolean
  voiceModel: string
  autoCompactContext: boolean
  showMiniPet: boolean
  defaultPermissionMode:
    | "default"
    | "acceptEdits"
    | "plan"
    | "fullManage"
    | "orchestrator"
  useAllCredits?: boolean
  defaultModel?: string
  kvCacheTtl?: string
  disabledSkills?: string[]
  engineConfigMigratedV1?: boolean
}

export interface PersistedSessionStore {
  sessions: unknown[]
  turns: unknown[]
}

export interface RecentWorkspaceEntry {
  name: string
  path: string
  lastOpenedAt: number
}

export interface LocalWorkspaceFileEntry {
  path: string
  name: string
  sizeBytes: number
  language: string
}

export interface LocalMcpServerEntry {
  id: string
  name: string
  description: string
  sourcePath: string
  scope: "global" | "workspace"
  transport: "stdio" | "url"
  type?: string
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  headerKeys?: string[]
  envKeys?: string[]
  timeout?: number
  revision?: string
  installed: boolean
}

export interface UpsertMcpServerInput {
  id: string
  scope?: "global" | "workspace"
  type?: string
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  timeout?: number
  expectedRevision?: string
  clearFields?: string[]
}

export interface LocalSkillEntry {
  id: string
  name: string
  scope: string
  tokens: string
  description: string
  enabled: boolean
  filePath: string
}

export interface LocalMemoryEntry {
  id: string
  path: string
  tokens: string
  updatedAt: string
  preview: string
}

export interface McpConfigErrorEntry {
  filePath: string
  scope: "global" | "workspace"
  message: string
}

export interface LocalExtensionsSnapshot {
  mcpConfigPath: string
  mcpServers: LocalMcpServerEntry[]
  mcpConfigErrors?: McpConfigErrorEntry[]
  revisions?: Record<string, string>
  skills: LocalSkillEntry[]
  memories: LocalMemoryEntry[]
}

export interface PersistedComposerTemplate {
  id: string
  kind: "spreadsheet" | "presentation" | "document"
  name: string
  description: string
  promptSpec: string
  accent: "emerald" | "navy" | "amber" | "forest" | "obsidian"
  createdAt: number
}

export interface PersistedSidebarProject {
  id: string
  name: string
  folders: string[]
  iconKind: "icon" | "emoji"
  iconValue: string
  iconColor: "folder" | "brand" | "info" | "type" | "num" | "danger"
  pinned?: boolean
  sectionId?: string | null
  gitRemote?: string
  updatedAt: number
}

export interface PersistedSidebarSection {
  id: string
  name: string
  collapsed?: boolean
}

export interface PersistedSidebarState {
  projects: PersistedSidebarProject[]
  sections: PersistedSidebarSection[]
  pinnedChatIds: string[]
  archivedChatIds: string[]
  organizeBy: "project" | "connection" | "flat"
  sortBy: "updated" | "manual"
  showProjectChatsInRecents: boolean
  manualProjectOrder: string[]
  collapsedProjectIds?: string[]
  hiddenProjectPaths?: string[]
}

export interface PersistedWindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

const DEFAULT_PREFERENCES: PersistedDesktopPreferences = {
  notificationsEnabled: true,
  voiceModel: "Rayu Natural Voice",
  autoCompactContext: true,
  showMiniPet: false,
  defaultPermissionMode: "default",
  useAllCredits: false,
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "dist-electron",
  ".next",
  "release",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
])

export class MalformedJsonConfigError extends Error {
  readonly filePath: string

  constructor(filePath: string, causeMessage: string) {
    super(`Malformed JSON config in ${filePath}: ${causeMessage}`)
    this.name = "MalformedJsonConfigError"
    this.filePath = filePath
  }
}

function computeFileRevision(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16)
}

function readJsonFileStrict<T>(
  filePath: string,
  fallback: T
): { value: T; exists: boolean; revision?: string } {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === "ENOENT") {
      return { value: fallback, exists: false }
    }
    throw err
  }
  const revision = computeFileRevision(raw)
  if (!raw.trim()) {
    return { value: fallback, exists: true, revision }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new MalformedJsonConfigError(
        filePath,
        "Top-level JSON value must be an object."
      )
    }
    return { value: parsed as T, exists: true, revision }
  } catch (err) {
    if (err instanceof MalformedJsonConfigError) throw err
    throw new MalformedJsonConfigError(
      filePath,
      err instanceof Error ? err.message : String(err)
    )
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  )
  const content = `${JSON.stringify(payload, null, 2)}\n`
  try {
    fs.writeFileSync(tmpPath, content, { mode: 0o600 })
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(tmpPath, 0o600)
      } catch {
        // ignore chmod errors
      }
    }
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore cleanup failure
    }
    throw err
  }
}

function preferencesPath(): string {
  return path.join(getRayuAppConfigDir(), "desktop-settings.json")
}

function sessionsStorePath(): string {
  return path.join(getRayuConfigDir(), "desktop-sessions.json")
}

function recentWorkspacesPath(): string {
  return path.join(getRayuAppConfigDir(), "desktop-workspaces.json")
}

export function readDesktopPreferences(): PersistedDesktopPreferences {
  const stored = readJsonFile<Partial<PersistedDesktopPreferences>>(
    preferencesPath(),
    {}
  )
  return { ...DEFAULT_PREFERENCES, ...stored }
}

export function writeDesktopPreferences(
  patch: Partial<PersistedDesktopPreferences>
): PersistedDesktopPreferences {
  const next = { ...readDesktopPreferences(), ...patch }
  writeJsonFile(preferencesPath(), next)
  return next
}

export interface LegacyEngineMigrationConfigState {
  values: Record<string, unknown>
  schema: Array<{ key: string; default_value?: unknown }>
}

export interface LegacyEngineMigrationDeps {
  getConfig: () => Promise<LegacyEngineMigrationConfigState | null>
  patchConfig: (
    patch: Record<string, unknown>
  ) => Promise<{ ok: boolean; error?: string } | unknown>
}

export interface LegacyEngineMigrationResult {
  migrated: boolean
  patchedKeys: string[]
}

function toWirePermissionModeForMigration(mode: string): string {
  if (mode === "acceptEdits") return "accept_edits"
  if (mode === "fullManage") return "full_manage"
  return mode
}

function isUnsetOrDefaultConfigValue(
  current: unknown,
  defaultValue: unknown
): boolean {
  if (current === undefined || current === null || current === "") {
    return true
  }
  return defaultValue !== undefined && current === defaultValue
}

/**
 * One-time idempotent migration of legacy engine keys from `desktop-settings.json`
 * (`defaultModel`, `defaultPermissionMode`, `autoCompactContext`, `kvCacheTtl`)
 * into `~/.rayu/config.toml` via the v1.16 `getConfig`/`patchConfig` RPCs.
 *
 * Never overwrites keys already customized in `config.toml`, and stays pending
 * if the daemon is offline or running `v1.15` (`getConfig()` returns `null`).
 */
export async function migrateLegacyEngineSettingsOnce(
  deps: LegacyEngineMigrationDeps
): Promise<LegacyEngineMigrationResult> {
  const rawStored = readJsonFile<Partial<PersistedDesktopPreferences>>(
    preferencesPath(),
    {}
  )
  if (rawStored.engineConfigMigratedV1 === true) {
    return { migrated: false, patchedKeys: [] }
  }

  const config = await deps.getConfig()
  if (!config) {
    return { migrated: false, patchedKeys: [] }
  }

  const schemaByKey = new Map(
    (config.schema ?? []).map((field) => [field.key, field])
  )
  const values = config.values ?? {}
  const patch: Record<string, unknown> = {}

  if (
    typeof rawStored.defaultModel === "string" &&
    rawStored.defaultModel.trim() &&
    rawStored.defaultModel.trim() !== "default"
  ) {
    const field = schemaByKey.get("provider.default_model")
    if (
      field &&
      isUnsetOrDefaultConfigValue(
        values["provider.default_model"],
        field.default_value
      )
    ) {
      patch["provider.default_model"] = rawStored.defaultModel.trim()
    }
  }

  if (rawStored.kvCacheTtl === "1h" || rawStored.kvCacheTtl === "5m") {
    const field = schemaByKey.get("provider.anthropic_cache_ttl_1h")
    const targetVal = rawStored.kvCacheTtl === "1h"
    if (
      field &&
      isUnsetOrDefaultConfigValue(
        values["provider.anthropic_cache_ttl_1h"],
        field.default_value
      ) &&
      values["provider.anthropic_cache_ttl_1h"] !== targetVal
    ) {
      patch["provider.anthropic_cache_ttl_1h"] = targetVal
    }
  }

  if (typeof rawStored.autoCompactContext === "boolean") {
    const autoCompactField = schemaByKey.get("compaction.auto_compact")
    if (
      autoCompactField &&
      isUnsetOrDefaultConfigValue(
        values["compaction.auto_compact"],
        autoCompactField.default_value
      ) &&
      values["compaction.auto_compact"] !== rawStored.autoCompactContext
    ) {
      patch["compaction.auto_compact"] = rawStored.autoCompactContext
    } else if (rawStored.autoCompactContext === false) {
      const tokenField = schemaByKey.get("compaction.reactive_threshold_tokens")
      if (
        tokenField &&
        isUnsetOrDefaultConfigValue(
          values["compaction.reactive_threshold_tokens"],
          tokenField.default_value
        ) &&
        values["compaction.reactive_threshold_tokens"] !== 0
      ) {
        patch["compaction.reactive_threshold_tokens"] = 0
      }
    }
  }

  if (
    typeof rawStored.defaultPermissionMode === "string" &&
    rawStored.defaultPermissionMode.trim()
  ) {
    const candidateKeys = [
      "safety.default_permission_mode",
      "provider.default_permission_mode",
    ]
    const matchedKey = candidateKeys.find((k) => schemaByKey.has(k))
    if (matchedKey) {
      const field = schemaByKey.get(matchedKey)!
      const wireMode = toWirePermissionModeForMigration(
        rawStored.defaultPermissionMode.trim()
      )
      if (
        isUnsetOrDefaultConfigValue(values[matchedKey], field.default_value) &&
        values[matchedKey] !== wireMode
      ) {
        patch[matchedKey] = wireMode
      }
    }
  }

  const patchedKeys = Object.keys(patch)
  if (patchedKeys.length > 0) {
    const res = await deps.patchConfig(patch)
    if (
      res &&
      typeof res === "object" &&
      "ok" in res &&
      (res as { ok?: unknown }).ok === false
    ) {
      return { migrated: false, patchedKeys: [] }
    }
  }

  writeDesktopPreferences({ engineConfigMigratedV1: true })
  return { migrated: true, patchedKeys }
}

export function readDesktopSessionStore(): PersistedSessionStore {
  const stored = readJsonFile<Partial<PersistedSessionStore>>(
    sessionsStorePath(),
    {}
  )
  return {
    sessions: Array.isArray(stored.sessions) ? stored.sessions.slice(0, 50) : [],
    turns: Array.isArray(stored.turns) ? stored.turns.slice(-500) : [],
  }
}

export function writeDesktopSessionStore(
  store: PersistedSessionStore
): PersistedSessionStore {
  const bounded: PersistedSessionStore = {
    sessions: store.sessions.slice(0, 50),
    turns: store.turns.slice(-500),
  }
  writeJsonFile(sessionsStorePath(), bounded)
  return bounded
}

export function readRecentWorkspaces(): RecentWorkspaceEntry[] {
  const list = readJsonFile<RecentWorkspaceEntry[]>(recentWorkspacesPath(), [])
  return Array.isArray(list) ? list.slice(0, 12) : []
}

export function recordRecentWorkspace(targetPath: string): RecentWorkspaceEntry[] {
  const normalized = path.resolve(targetPath)
  const existing = readRecentWorkspaces().filter((w) => w.path !== normalized)
  const next: RecentWorkspaceEntry[] = [
    {
      name: path.basename(normalized) || normalized,
      path: normalized,
      lastOpenedAt: Date.now(),
    },
    ...existing,
  ].slice(0, 12)
  writeJsonFile(recentWorkspacesPath(), next)
  return next
}

export function listWorkspaceFiles(
  rootDir: string,
  maxFiles = 2000,
  maxDepth = 6
): LocalWorkspaceFileEntry[] {
  const resolvedRoot = path.resolve(rootDir)
  const results: LocalWorkspaceFileEntry[] = []

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || results.length >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (results.length >= maxFiles) break
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        walk(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile()) {
        const abs = path.join(dir, entry.name)
        const rel = path.relative(resolvedRoot, abs)
        let sizeBytes = 0
        try {
          sizeBytes = fs.statSync(abs).size
        } catch {
          // ignore
        }
        const ext = path.extname(entry.name).toLowerCase().replace(/^\./, "")
        results.push({
          path: rel,
          name: entry.name,
          sizeBytes,
          language: ext || "text",
        })
      }
    }
  }

  walk(resolvedRoot, 0)
  return results
}

function estimateTokensLabel(bytes: number): string {
  const tokens = Math.max(1, Math.round(bytes / 4))
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`
  return `${tokens} tok`
}

function formatMtimeLabel(mtimeMs: number): string {
  const diffMin = Math.max(0, Math.round((Date.now() - mtimeMs) / 60_000))
  if (diffMin < 2) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.round(diffHr / 24)
  return `${diffDays}d ago`
}

function parseFrontmatter(content: string): {
  name?: string
  description?: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return {}
  let name: string | undefined
  let description: string | undefined
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
    if (key === "name" && value) name = value
    if (key === "description" && value) description = value
  }
  return { name, description }
}

export function listLocalExtensions(
  workspaceDir: string
): LocalExtensionsSnapshot {
  const mcpConfigPath = path.join(getRayuConfigDir(), "mcp.json")
  const userHomeMcpPath = path.join(os.homedir(), ".mcp.json")
  const workspaceRayuMcpPath = path.join(workspaceDir, ".rayu", "mcp.json")
  const workspaceMcpPath = path.join(workspaceDir, ".mcp.json")
  const claudeMcpPath = path.join(workspaceDir, ".claude", "mcp.json")
  const mcpServers: LocalMcpServerEntry[] = []
  const mcpConfigErrors: McpConfigErrorEntry[] = []
  const revisions: Record<string, string> = {}

  const sources: Array<{ cfgPath: string; scope: "global" | "workspace" }> = [
    { cfgPath: userHomeMcpPath, scope: "global" },
    { cfgPath: mcpConfigPath, scope: "global" },
    { cfgPath: workspaceRayuMcpPath, scope: "workspace" },
    { cfgPath: workspaceMcpPath, scope: "workspace" },
    { cfgPath: claudeMcpPath, scope: "workspace" },
  ]

  for (const { cfgPath, scope } of sources) {
    try {
      const readRes = readJsonFileStrict<{
        mcpServers?: Record<
          string,
          {
            type?: string
            command?: string
            args?: string[]
            url?: string
            headers?: Record<string, string>
            env?: Record<string, string>
            timeout?: number
            enabled?: boolean
            disabled?: boolean
          }
        >
      }>(cfgPath, {})
      if (readRes.revision) {
        revisions[cfgPath] = readRes.revision
      }
      const raw = readRes.value
      if (raw.mcpServers && typeof raw.mcpServers === "object") {
        for (const [key, cfg] of Object.entries(raw.mcpServers)) {
          const isEnabled =
            cfg?.disabled === true ? false : cfg?.enabled !== false
          const existingIdx = mcpServers.findIndex((m) => m.id === key)
          if (!isEnabled) {
            if (existingIdx >= 0) {
              mcpServers.splice(existingIdx, 1)
            }
            continue
          }
          const commandStr = cfg?.command
            ? [cfg.command, ...(Array.isArray(cfg.args) ? cfg.args : [])].join(" ")
            : undefined
          const entry: LocalMcpServerEntry = {
            id: key,
            name: key,
            description: cfg?.url
              ? `Remote MCP · ${cfg.url}`
              : commandStr
                ? `stdio · ${commandStr}`
                : "Configured MCP server",
            sourcePath: cfgPath,
            scope,
            transport: cfg?.url ? "url" : "stdio",
            ...(typeof cfg?.type === "string" ? { type: cfg.type } : {}),
            command: cfg?.command,
            args: Array.isArray(cfg?.args) ? cfg.args : undefined,
            url: cfg?.url,
            headers:
              cfg?.headers && typeof cfg.headers === "object"
                ? { ...cfg.headers }
                : undefined,
            headerKeys:
              cfg?.headers && typeof cfg.headers === "object"
                ? Object.keys(cfg.headers)
                : undefined,
            envKeys:
              cfg?.env && typeof cfg.env === "object"
                ? Object.keys(cfg.env)
                : undefined,
            ...(typeof cfg?.timeout === "number" ? { timeout: cfg.timeout } : {}),
            revision: readRes.revision,
            installed: true,
          }
          if (existingIdx >= 0) {
            mcpServers[existingIdx] = entry
          } else {
            mcpServers.push(entry)
          }
        }
      }
    } catch (err) {
      if (err instanceof MalformedJsonConfigError) {
        mcpConfigErrors.push({
          filePath: err.filePath,
          scope,
          message: err.message,
        })
      }
    }
  }

  const prefs = readDesktopPreferences()
  const disabledSet = new Set(prefs.disabledSkills ?? [])
  const skills: LocalSkillEntry[] = []
  const skillRoots: Array<{ dir: string; scope: string }> = [
    { dir: path.join(workspaceDir, ".agents", "skills"), scope: "Workspace" },
    { dir: path.join(workspaceDir, ".claude", "skills"), scope: "Workspace" },
    { dir: path.join(os.homedir(), ".gemini", "skills"), scope: "Global" },
    { dir: path.join(getRayuConfigDir(), "skills"), scope: "Rayu" },
  ]

  for (const root of skillRoots) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(root.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const skillFile = path.join(root.dir, entry.name, "SKILL.md")
      try {
        const stat = fs.statSync(skillFile)
        const content = fs.readFileSync(skillFile, "utf8")
        const fm = parseFrontmatter(content)
        const id = `${root.scope.toLowerCase()}_${entry.name}`
        if (skills.some((s) => s.name === (fm.name ?? entry.name))) continue
        skills.push({
          id,
          name: fm.name ?? entry.name,
          scope: root.scope,
          tokens: estimateTokensLabel(stat.size),
          description:
            fm.description ??
            `Skill defined in ${path.relative(os.homedir(), skillFile)}`,
          enabled: !disabledSet.has(id),
          filePath: skillFile,
        })
      } catch {
        // skip directories without SKILL.md
      }
    }
  }

  const memories: LocalMemoryEntry[] = []
  const memoryCandidates = [
    path.join(workspaceDir, "CLAUDE.md"),
    path.join(workspaceDir, "GEMINI.md"),
    path.join(workspaceDir, "AGENTS.md"),
    path.join(workspaceDir, "DESIGN.md"),
    path.join(workspaceDir, "MEMORY.md"),
    path.join(getRayuConfigDir(), "MEMORY.md"),
  ]

  for (const memFile of memoryCandidates) {
    try {
      const stat = fs.statSync(memFile)
      if (!stat.isFile()) continue
      const content = fs.readFileSync(memFile, "utf8")
      const preview = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .slice(0, 2)
        .join(" ")
        .slice(0, 180)
      memories.push({
        id: `mem_${path.basename(memFile)}_${memories.length}`,
        path: memFile.startsWith(workspaceDir)
          ? path.relative(workspaceDir, memFile)
          : `~/.rayu/${path.basename(memFile)}`,
        tokens: estimateTokensLabel(stat.size),
        updatedAt: formatMtimeLabel(stat.mtimeMs),
        preview: preview || "Project instructions & memory file",
      })
    } catch {
      // absent
    }
  }

  return {
    mcpConfigPath,
    mcpServers,
    ...(mcpConfigErrors.length > 0 ? { mcpConfigErrors } : {}),
    ...(Object.keys(revisions).length > 0 ? { revisions } : {}),
    skills,
    memories,
  }
}

function targetMcpConfigPath(
  workspaceDir: string,
  scope: "global" | "workspace" = "global"
): string {
  return scope === "workspace"
    ? path.join(workspaceDir, ".mcp.json")
    : path.join(getRayuConfigDir(), "mcp.json")
}

export function upsertLocalMcpServer(
  workspaceDir: string,
  input: UpsertMcpServerInput
): LocalExtensionsSnapshot {
  const id = input.id.trim()
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(
      "MCP server ID must contain only letters, numbers, dots, hyphens, or underscores."
    )
  }

  const filePath = targetMcpConfigPath(workspaceDir, input.scope ?? "global")
  const { value: existing, revision } = readJsonFileStrict<
    Record<string, unknown>
  >(filePath, {})

  if (
    input.expectedRevision !== undefined &&
    revision !== undefined &&
    input.expectedRevision !== revision
  ) {
    throw new Error(
      `MCP config ${filePath} changed on disk since it was loaded (expected ${input.expectedRevision}, found ${revision}). Reload before saving.`
    )
  }

  const mcpServers =
    existing.mcpServers &&
    typeof existing.mcpServers === "object" &&
    !Array.isArray(existing.mcpServers)
      ? { ...(existing.mcpServers as Record<string, Record<string, unknown>>) }
      : {}

  const priorEntry =
    mcpServers[id] &&
    typeof mcpServers[id] === "object" &&
    !Array.isArray(mcpServers[id])
      ? { ...mcpServers[id] }
      : {}

  const hasUrl =
    input.url !== undefined ? Boolean(input.url.trim()) : Boolean(priorEntry.url)
  const hasCmd =
    input.command !== undefined
      ? Boolean(input.command.trim())
      : Boolean(priorEntry.command)
  if (!hasUrl && !hasCmd) {
    throw new Error("Provide either a remote MCP URL or a local stdio command.")
  }

  const serverEntry: Record<string, unknown> = { ...priorEntry }
  if (input.type !== undefined) {
    if (input.type.trim()) {
      serverEntry.type = input.type.trim()
    } else {
      delete serverEntry.type
    }
  }
  if (input.url !== undefined) {
    const trimmedUrl = input.url.trim()
    if (trimmedUrl) {
      serverEntry.url = trimmedUrl
      if (input.command === undefined) {
        delete serverEntry.command
        delete serverEntry.args
      }
    } else {
      delete serverEntry.url
    }
  }
  if (input.command !== undefined) {
    const trimmedCmd = input.command.trim()
    if (trimmedCmd) {
      serverEntry.command = trimmedCmd
      if (input.url === undefined) {
        delete serverEntry.url
      }
    } else {
      delete serverEntry.command
    }
  }
  if (input.args !== undefined) {
    const cleanArgs = input.args.filter((a) => a.length > 0)
    if (cleanArgs.length > 0) {
      serverEntry.args = cleanArgs
    } else {
      delete serverEntry.args
    }
  }
  if (input.headers !== undefined) {
    const cleanHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.headers)) {
      const key = k.trim()
      if (key && v.trim()) {
        cleanHeaders[key] = v.trim()
      }
    }
    if (Object.keys(cleanHeaders).length > 0) {
      serverEntry.headers = cleanHeaders
    } else {
      delete serverEntry.headers
    }
  }
  if (input.env !== undefined) {
    const cleanEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.env)) {
      const key = k.trim()
      if (key && v.trim()) {
        cleanEnv[key] = v.trim()
      }
    }
    if (Object.keys(cleanEnv).length > 0) {
      serverEntry.env = cleanEnv
    } else {
      delete serverEntry.env
    }
  }
  if (input.timeout !== undefined) {
    serverEntry.timeout = input.timeout
  }
  if (input.clearFields && input.clearFields.length > 0) {
    for (const field of input.clearFields) {
      if (field === "headers" || field === "env" || field === "timeout" || field === "args" || field === "type") {
        delete serverEntry[field]
      }
    }
  }

  mcpServers[id] = serverEntry
  writeJsonFile(filePath, { ...existing, mcpServers })
  return listLocalExtensions(workspaceDir)
}

export function removeLocalMcpServer(
  workspaceDir: string,
  serverId: string,
  scope?: "global" | "workspace"
): LocalExtensionsSnapshot {
  const id = serverId.trim()
  const targets =
    scope === "workspace"
      ? [
          path.join(workspaceDir, ".mcp.json"),
          path.join(workspaceDir, ".rayu", "mcp.json"),
          path.join(workspaceDir, ".claude", "mcp.json"),
        ]
      : scope === "global"
        ? [
            path.join(getRayuConfigDir(), "mcp.json"),
            path.join(os.homedir(), ".mcp.json"),
          ]
        : [
            path.join(getRayuConfigDir(), "mcp.json"),
            path.join(os.homedir(), ".mcp.json"),
            path.join(workspaceDir, ".mcp.json"),
            path.join(workspaceDir, ".rayu", "mcp.json"),
            path.join(workspaceDir, ".claude", "mcp.json"),
          ]

  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue
    const { value: existing } = readJsonFileStrict<Record<string, unknown>>(
      filePath,
      {}
    )
    if (
      existing.mcpServers &&
      typeof existing.mcpServers === "object" &&
      !Array.isArray(existing.mcpServers) &&
      id in (existing.mcpServers as Record<string, unknown>)
    ) {
      const nextServers = {
        ...(existing.mcpServers as Record<string, unknown>),
      }
      delete nextServers[id]
      writeJsonFile(filePath, { ...existing, mcpServers: nextServers })
    }
  }

  return listLocalExtensions(workspaceDir)
}

export function createLocalSkill(
  workspaceDir: string,
  input: { name: string; description: string; instructions?: string }
): LocalExtensionsSnapshot {
  const slug = input.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!slug) {
    throw new Error("Skill name must contain letters or numbers.")
  }

  const skillDir = path.join(workspaceDir, ".agents", "skills", slug)
  fs.mkdirSync(skillDir, { recursive: true })
  const skillFile = path.join(skillDir, "SKILL.md")
  const body =
    input.instructions?.trim() ||
    `# ${input.name.trim()}\n\nDescribe step-by-step instructions and verification rules for this skill.\n`
  const content = `---\nname: ${input.name.trim()}\ndescription: ${input.description.trim()}\n---\n\n${body}\n`
  fs.writeFileSync(skillFile, content, "utf8")
  return listLocalExtensions(workspaceDir)
}

export function toggleLocalSkill(
  workspaceDir: string,
  skillId: string
): LocalExtensionsSnapshot {
  const prefs = readDesktopPreferences()
  const set = new Set(prefs.disabledSkills ?? [])
  if (set.has(skillId)) {
    set.delete(skillId)
  } else {
    set.add(skillId)
  }
  writeDesktopPreferences({ disabledSkills: Array.from(set) })
  return listLocalExtensions(workspaceDir)
}

function customTemplatesPath(): string {
  return path.join(getRayuConfigDir(), "templates.json")
}

export function readCustomTemplates(): PersistedComposerTemplate[] {
  const raw = readJsonFile<PersistedComposerTemplate[]>(customTemplatesPath(), [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.promptSpec === "string"
    )
    .slice(0, 50)
}

export function saveCustomTemplate(input: {
  id?: string
  kind: "spreadsheet" | "presentation" | "document"
  name: string
  description: string
  promptSpec: string
  accent?: "emerald" | "navy" | "amber" | "forest" | "obsidian"
}): PersistedComposerTemplate[] {
  const name = input.name.trim()
  const promptSpec = input.promptSpec.trim()
  if (!name) {
    throw new Error("Template name is required.")
  }
  if (!promptSpec) {
    throw new Error("Template structure or instructions are required.")
  }
  const existing = readCustomTemplates()
  const id =
    input.id?.trim() ||
    `tpl_${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}_${Date.now().toString(36)}`
  const entry: PersistedComposerTemplate = {
    id,
    kind: input.kind,
    name,
    description: input.description.trim() || "Custom reusable template",
    promptSpec,
    accent:
      input.accent ??
      (input.kind === "spreadsheet"
        ? "emerald"
        : input.kind === "presentation"
          ? "navy"
          : "obsidian"),
    createdAt: Date.now(),
  }
  const next = [entry, ...existing.filter((item) => item.id !== id)].slice(0, 50)
  writeJsonFile(customTemplatesPath(), next)
  return next
}

export function deleteCustomTemplate(id: string): PersistedComposerTemplate[] {
  const target = id.trim()
  const next = readCustomTemplates().filter((item) => item.id !== target)
  writeJsonFile(customTemplatesPath(), next)
  return next
}

const DEFAULT_SIDEBAR_STATE: PersistedSidebarState = {
  projects: [],
  sections: [],
  pinnedChatIds: [],
  archivedChatIds: [],
  organizeBy: "project",
  sortBy: "updated",
  showProjectChatsInRecents: false,
  manualProjectOrder: [],
  collapsedProjectIds: [],
  hiddenProjectPaths: [],
}

function sidebarStatePath(): string {
  return path.join(getRayuAppConfigDir(), "desktop-sidebar.json")
}

function windowBoundsPath(): string {
  return path.join(getRayuAppConfigDir(), "desktop-window-bounds.json")
}

let sharedRegistry: WorkspaceRegistry | null = null
let sharedRegistryPath: string | null = null
let registryInitPromise: Promise<WorkspaceRegistry> | null = null
let registryInitPath: string | null = null

export function getSharedWorkspaceRegistry(): WorkspaceRegistry {
  const targetPath = getDefaultWorkspacesFilePath()
  if (sharedRegistry && sharedRegistryPath === targetPath) {
    return sharedRegistry
  }
  if (sharedRegistry) {
    sharedRegistry.dispose()
  }
  sharedRegistry = new WorkspaceRegistry({ filePath: targetPath })
  sharedRegistryPath = targetPath
  registryInitPromise = null
  registryInitPath = null
  return sharedRegistry
}

export function disposeWorkspaceRegistry(): void {
  if (sharedRegistry) {
    sharedRegistry.dispose()
    sharedRegistry = null
  }
  sharedRegistryPath = null
  registryInitPromise = null
  registryInitPath = null
}

function readRawDesktopSidebarFile(): Partial<PersistedSidebarState> {
  return readJsonFile<Partial<PersistedSidebarState>>(sidebarStatePath(), {})
}

export async function ensureWorkspaceRegistryReady(): Promise<WorkspaceRegistry> {
  const registry = getSharedWorkspaceRegistry()
  const targetPath = registry.getFilePath()
  if (registryInitPromise && registryInitPath === targetPath) {
    return registryInitPromise
  }
  registryInitPath = targetPath
  registryInitPromise = (async () => {
    const ledger = await registry.load()
    if (!ledger.migratedSources.includes("desktop-v1")) {
      const legacySidebar = readRawDesktopSidebarFile()
      const legacyRecent = readRecentWorkspaces()
      const legacyWorkspaces: Array<{
        id?: string
        name?: string
        path: string
        createdAt?: number
        lastOpenedAt?: number
      }> = []

      if (Array.isArray(legacySidebar.projects)) {
        for (const proj of legacySidebar.projects) {
          const primaryFolder = Array.isArray(proj?.folders)
            ? proj.folders.find((f) => typeof f === "string" && f.trim())
            : undefined
          if (!primaryFolder) continue
          legacyWorkspaces.push({
            id: typeof proj.id === "string" ? proj.id : undefined,
            name: typeof proj.name === "string" ? proj.name : undefined,
            path: primaryFolder,
            createdAt: typeof proj.updatedAt === "number" ? proj.updatedAt : undefined,
            lastOpenedAt:
              typeof proj.updatedAt === "number" ? proj.updatedAt : undefined,
          })
        }
      }

      for (const recent of legacyRecent) {
        if (!recent?.path?.trim()) continue
        legacyWorkspaces.push({
          name: recent.name,
          path: recent.path,
          lastOpenedAt: recent.lastOpenedAt,
        })
      }

      // Intentionally ignore desktop-sessions.json phantoms during migration.
      await registry.migrateLegacy({
        sourceKey: "desktop-v1",
        workspaces: legacyWorkspaces,
        pinnedSessionIds: Array.isArray(legacySidebar.pinnedChatIds)
          ? legacySidebar.pinnedChatIds
          : [],
        archivedSessionIds: Array.isArray(legacySidebar.archivedChatIds)
          ? legacySidebar.archivedChatIds
          : [],
        collapsedWorkspaceIds: Array.isArray(legacySidebar.collapsedProjectIds)
          ? legacySidebar.collapsedProjectIds
          : [],
        manualWorkspaceOrder: Array.isArray(legacySidebar.manualProjectOrder)
          ? legacySidebar.manualProjectOrder
          : [],
        hiddenWorkspacePaths: Array.isArray(legacySidebar.hiddenProjectPaths)
          ? legacySidebar.hiddenProjectPaths
          : [],
      })
    }
    return registry
  })()
  return registryInitPromise
}

function mergeLedgerWithDesktopSidebar(
  ledger: WorkspaceLedger,
  desktopStored: Partial<PersistedSidebarState>
): PersistedSidebarState {
  const storedProjects = Array.isArray(desktopStored.projects)
    ? desktopStored.projects.slice(0, 60)
    : []
  const storedById = new Map<string, PersistedSidebarProject>()
  const storedByKey = new Map<string, PersistedSidebarProject>()
  for (const proj of storedProjects) {
    storedById.set(proj.id, proj)
    for (const folder of proj.folders ?? []) {
      const key = canonicalizeWorkspacePath(folder).comparisonKey
      if (key && !storedByKey.has(key)) {
        storedByKey.set(key, proj)
      }
    }
  }

  const projects: PersistedSidebarProject[] = []
  const hiddenFromLedger: string[] = []

  for (const ws of ledger.workspaces) {
    if (ws.hidden) {
      hiddenFromLedger.push(ws.canonicalPath || ws.path)
      continue
    }
    const key = canonicalizeWorkspacePath(
      ws.canonicalPath || ws.path
    ).comparisonKey
    const visual = storedById.get(ws.id) ?? storedByKey.get(key)
    const primaryFolder = ws.canonicalPath || ws.path
    const extraFolders = (visual?.folders ?? []).filter(
      (f) => canonicalizeWorkspacePath(f).comparisonKey !== key
    )
    projects.push({
      id: ws.id,
      name: ws.name,
      folders: [primaryFolder, ...extraFolders],
      iconKind: visual?.iconKind ?? "icon",
      iconValue: visual?.iconValue ?? "folder",
      iconColor: visual?.iconColor ?? "folder",
      pinned: visual?.pinned ?? false,
      sectionId: visual?.sectionId ?? null,
      ...(visual?.gitRemote ? { gitRemote: visual.gitRemote } : {}),
      updatedAt: Math.max(
        ws.updatedAt || 0,
        ws.lastOpenedAt || 0,
        visual?.updatedAt || 0
      ),
    })
  }

  const storedHidden = Array.isArray(desktopStored.hiddenProjectPaths)
    ? desktopStored.hiddenProjectPaths
    : []
  const hiddenProjectPaths = Array.from(
    new Set([...storedHidden, ...hiddenFromLedger])
  ).slice(0, 100)

  return {
    projects: projects.slice(0, 60),
    sections: Array.isArray(desktopStored.sections)
      ? desktopStored.sections.slice(0, 30)
      : [],
    pinnedChatIds: ledger.pinnedSessionIds.slice(0, 100),
    archivedChatIds: ledger.archivedSessionIds.slice(0, 200),
    organizeBy:
      desktopStored.organizeBy === "connection" ||
      desktopStored.organizeBy === "flat"
        ? desktopStored.organizeBy
        : DEFAULT_SIDEBAR_STATE.organizeBy,
    sortBy:
      desktopStored.sortBy === "manual"
        ? "manual"
        : DEFAULT_SIDEBAR_STATE.sortBy,
    showProjectChatsInRecents:
      typeof desktopStored.showProjectChatsInRecents === "boolean"
        ? desktopStored.showProjectChatsInRecents
        : DEFAULT_SIDEBAR_STATE.showProjectChatsInRecents,
    manualProjectOrder: ledger.manualWorkspaceOrder.slice(0, 60),
    collapsedProjectIds: ledger.collapsedWorkspaceIds.slice(0, 100),
    hiddenProjectPaths,
  }
}

export async function ensureRegisteredWorkspace(
  rawPath: string,
  options?: { name?: string; unhide?: boolean }
): Promise<{
  id: string
  name: string
  path: string
  canonicalPath: string
  created: boolean
}> {
  const registry = await ensureWorkspaceRegistryReady()
  const { workspace, created } = await registry.ensureWorkspace(rawPath, {
    name: options?.name,
    unhide: options?.unhide ?? true,
  })
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    canonicalPath: workspace.canonicalPath,
    created,
  }
}

export async function importProjectGroupInRegistry(
  rawPath: string,
  options: { name?: string; sessionIds: readonly string[] }
): Promise<{
  id: string
  name: string
  path: string
  canonicalPath: string
  created: boolean
}> {
  const registry = await ensureWorkspaceRegistryReady()
  const { workspace, created } = await registry.importProjectGroup(rawPath, {
    name: options.name,
    sessionIds: options.sessionIds,
  })
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    canonicalPath: workspace.canonicalPath,
    created,
  }
}

export async function syncSessionArchivedInRegistry(
  sessionId: string,
  archived: boolean
): Promise<void> {
  const registry = await ensureWorkspaceRegistryReady()
  await registry.setArchived(sessionId, archived)
}

export function subscribeExternalWorkspaceChanges(
  listener: (state: PersistedSidebarState) => void
): () => void {
  const registry = getSharedWorkspaceRegistry()
  return registry.subscribe((event) => {
    if (event.source !== "external") return
    const merged = mergeLedgerWithDesktopSidebar(
      event.ledger,
      readRawDesktopSidebarFile()
    )
    listener(merged)
  })
}

export function readWindowBounds(): PersistedWindowBounds | null {
  const stored = readJsonFile<Partial<PersistedWindowBounds> | null>(
    windowBoundsPath(),
    null
  )
  if (
    !stored ||
    typeof stored.width !== "number" ||
    typeof stored.height !== "number" ||
    !Number.isFinite(stored.width) ||
    !Number.isFinite(stored.height) ||
    stored.width < 600 ||
    stored.height < 480
  ) {
    return null
  }
  return {
    width: Math.round(stored.width),
    height: Math.round(stored.height),
    ...(typeof stored.x === "number" && Number.isFinite(stored.x)
      ? { x: Math.round(stored.x) }
      : {}),
    ...(typeof stored.y === "number" && Number.isFinite(stored.y)
      ? { y: Math.round(stored.y) }
      : {}),
    ...(typeof stored.isMaximized === "boolean"
      ? { isMaximized: stored.isMaximized }
      : {}),
  }
}

export function writeWindowBounds(bounds: PersistedWindowBounds): void {
  writeJsonFile(windowBoundsPath(), bounds)
}

export async function readSidebarState(): Promise<PersistedSidebarState> {
  const registry = await ensureWorkspaceRegistryReady()
  const ledger = await registry.load()
  return mergeLedgerWithDesktopSidebar(ledger, readRawDesktopSidebarFile())
}

export async function writeSidebarState(
  next: PersistedSidebarState
): Promise<PersistedSidebarState> {
  const registry = await ensureWorkspaceRegistryReady()
  const priorStored = readRawDesktopSidebarFile()
  let ledger = await registry.load()

  const idRemap = new Map<string, string>()
  const canonicalProjectsById = new Map<string, PersistedSidebarProject>()

  for (const proj of next.projects.slice(0, 60)) {
    const primaryFolder = proj.folders.find((f) => f.trim())
    if (!primaryFolder) continue
    const ensured = await registry.ensureWorkspace(primaryFolder, {
      name: proj.name,
      unhide: true,
    })
    ledger = ensured.ledger
    const ws = ensured.workspace
    idRemap.set(proj.id, ws.id)

    const primaryKey = canonicalizeWorkspacePath(
      ws.canonicalPath || ws.path
    ).comparisonKey
    const extraFolders = proj.folders.filter(
      (f) => canonicalizeWorkspacePath(f).comparisonKey !== primaryKey
    )
    const canonicalProj: PersistedSidebarProject = {
      ...proj,
      id: ws.id,
      name: ws.name,
      folders: [ws.canonicalPath || ws.path, ...extraFolders],
    }
    canonicalProjectsById.set(ws.id, canonicalProj)
  }

  // Remove workspaces explicitly hidden or removed from desktop sidebar
  const nextHiddenPaths = Array.isArray(next.hiddenProjectPaths)
    ? next.hiddenProjectPaths.slice(0, 100)
    : []
  const hiddenKeys = new Set(
    nextHiddenPaths.map((p) => canonicalizeWorkspacePath(p).comparisonKey)
  )
  const priorProjectIds = new Set(
    (Array.isArray(priorStored.projects) ? priorStored.projects : []).map(
      (p) => p.id
    )
  )
  for (const ws of [...ledger.workspaces]) {
    const wsKey = canonicalizeWorkspacePath(
      ws.canonicalPath || ws.path
    ).comparisonKey
    const explicitlyHidden = hiddenKeys.has(wsKey)
    const removedFromDesktop =
      priorProjectIds.has(ws.id) && !canonicalProjectsById.has(ws.id)
    if (explicitlyHidden || removedFromDesktop) {
      ledger = await registry.removeWorkspace(ws.id)
    }
  }

  // Sync pinned and archived session sets atomically with ~/.rayu/workspaces.json
  const desiredPinned = new Set(next.pinnedChatIds.slice(0, 100))
  const desiredArchived = new Set(next.archivedChatIds.slice(0, 200))

  for (const sid of ledger.pinnedSessionIds) {
    if (!desiredPinned.has(sid)) {
      ledger = await registry.setPinned(sid, false)
    }
  }
  for (const sid of desiredPinned) {
    if (!ledger.pinnedSessionIds.includes(sid)) {
      ledger = await registry.setPinned(sid, true)
    }
  }

  for (const sid of ledger.archivedSessionIds) {
    if (!desiredArchived.has(sid)) {
      ledger = await registry.setArchived(sid, false)
    }
  }
  for (const sid of desiredArchived) {
    if (!ledger.archivedSessionIds.includes(sid)) {
      ledger = await registry.setArchived(sid, true)
    }
  }

  // Sync collapsed workspace IDs and manual workspace order using remapped canonical IDs
  const remappedCollapsed = Array.from(
    new Set(
      (next.collapsedProjectIds ?? [])
        .map((id) => idRemap.get(id) ?? id)
        .filter(Boolean)
    )
  ).slice(0, 100)
  const desiredCollapsedSet = new Set(remappedCollapsed)
  for (const id of ledger.collapsedWorkspaceIds) {
    if (!desiredCollapsedSet.has(id)) {
      ledger = await registry.setCollapsed(id, false)
    }
  }
  for (const id of desiredCollapsedSet) {
    if (!ledger.collapsedWorkspaceIds.includes(id)) {
      ledger = await registry.setCollapsed(id, true)
    }
  }

  const remappedOrder = Array.from(
    new Set(
      next.manualProjectOrder
        .map((id) => idRemap.get(id) ?? id)
        .filter(Boolean)
    )
  ).slice(0, 60)
  ledger = await registry.setManualOrder(remappedOrder)

  const bounded: PersistedSidebarState = {
    projects: Array.from(canonicalProjectsById.values()).slice(0, 60),
    sections: next.sections.slice(0, 30),
    pinnedChatIds: ledger.pinnedSessionIds.slice(0, 100),
    archivedChatIds: ledger.archivedSessionIds.slice(0, 200),
    organizeBy: next.organizeBy,
    sortBy: next.sortBy,
    showProjectChatsInRecents: next.showProjectChatsInRecents,
    manualProjectOrder: ledger.manualWorkspaceOrder.slice(0, 60),
    collapsedProjectIds: ledger.collapsedWorkspaceIds.slice(0, 100),
    hiddenProjectPaths: nextHiddenPaths,
  }
  writeJsonFile(sidebarStatePath(), bounded)
  return mergeLedgerWithDesktopSidebar(ledger, bounded)
}
