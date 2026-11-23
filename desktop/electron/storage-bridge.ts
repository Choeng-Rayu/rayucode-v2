import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
  command?: string
  args?: string[]
  url?: string
  envKeys?: string[]
  installed: boolean
}

export interface UpsertMcpServerInput {
  id: string
  scope?: "global" | "workspace"
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
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

export interface LocalExtensionsSnapshot {
  mcpConfigPath: string
  mcpServers: LocalMcpServerEntry[]
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

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  })
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // ignore chmod errors
    }
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
  maxFiles = 250,
  maxDepth = 4
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
  const workspaceMcpPath = path.join(workspaceDir, ".mcp.json")
  const claudeMcpPath = path.join(workspaceDir, ".claude", "mcp.json")
  const mcpServers: LocalMcpServerEntry[] = []

  const sources: Array<{ cfgPath: string; scope: "global" | "workspace" }> = [
    { cfgPath: mcpConfigPath, scope: "global" },
    { cfgPath: workspaceMcpPath, scope: "workspace" },
    { cfgPath: claudeMcpPath, scope: "workspace" },
  ]

  for (const { cfgPath, scope } of sources) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
        mcpServers?: Record<
          string,
          {
            command?: string
            args?: string[]
            url?: string
            env?: Record<string, string>
          }
        >
      }
      if (raw.mcpServers && typeof raw.mcpServers === "object") {
        for (const [key, cfg] of Object.entries(raw.mcpServers)) {
          const existingIdx = mcpServers.findIndex((m) => m.id === key)
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
            command: cfg?.command,
            args: Array.isArray(cfg?.args) ? cfg.args : undefined,
            url: cfg?.url,
            envKeys:
              cfg?.env && typeof cfg.env === "object"
                ? Object.keys(cfg.env)
                : undefined,
            installed: true,
          }
          if (existingIdx >= 0) {
            // Project .mcp.json overrides global ~/.rayu/mcp.json (mirrors Rust loader)
            mcpServers[existingIdx] = entry
          } else {
            mcpServers.push(entry)
          }
        }
      }
    } catch {
      // absent or invalid JSON
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
  const hasUrl = Boolean(input.url?.trim())
  const hasCmd = Boolean(input.command?.trim())
  if (!hasUrl && !hasCmd) {
    throw new Error("Provide either a remote MCP URL or a local stdio command.")
  }

  const filePath = targetMcpConfigPath(workspaceDir, input.scope ?? "global")
  const existing = readJsonFile<Record<string, unknown>>(filePath, {})
  const mcpServers =
    existing.mcpServers &&
    typeof existing.mcpServers === "object" &&
    !Array.isArray(existing.mcpServers)
      ? { ...(existing.mcpServers as Record<string, Record<string, unknown>>) }
      : {}

  const serverEntry: Record<string, unknown> = {}
  if (hasUrl && input.url) {
    serverEntry.url = input.url.trim()
  } else if (input.command) {
    serverEntry.command = input.command.trim()
    if (input.args && input.args.length > 0) {
      serverEntry.args = input.args.filter((a) => a.length > 0)
    }
  }

  if (input.env) {
    const cleanEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.env)) {
      const key = k.trim()
      if (key && v.trim()) {
        cleanEnv[key] = v.trim()
      }
    }
    if (Object.keys(cleanEnv).length > 0) {
      serverEntry.env = cleanEnv
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
  const targets = scope
    ? [targetMcpConfigPath(workspaceDir, scope)]
    : [
        targetMcpConfigPath(workspaceDir, "global"),
        targetMcpConfigPath(workspaceDir, "workspace"),
      ]

  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue
    const existing = readJsonFile<Record<string, unknown>>(filePath, {})
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
