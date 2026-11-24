import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"

import type { BrowserCdpController } from "./browser-cdp.js"
import {
  DESKTOP_CLOUD_TOOL_SCHEMAS,
  executeDesktopTool,
  type DesktopArtifactEvent,
} from "./desktop-tools.js"

const DEFAULT_API_BASE = "https://api.rayucode.com/api"
const DEFAULT_WEB_BASE = "https://rayucode.com"
const DEFAULT_GATEWAY_BASE = "https://gateway.rayucode.com"
const SESSION_FILE = "rayu-auth.json"
const ENV_FILE = "rayu.env"
const KEY_PREFIX = "rayu_sk_live_"
const REFRESH_SKEW_MS = 60_000
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export interface RayuSessionUser {
  id: number
  email: string | null
  displayName: string | null
  avatarUrl: string | null
  role: string
}

interface StoredRayuSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: RayuSessionUser
}

export interface RayuCloudCredits {
  plan: string
  planName: string
  creditsPerPeriod: number | null
  usedCredits: number
  remainingCredits: number | null
  resetSeconds: number
  periodEnd: string | null
  topupBalance: number
  topUpEnabled: boolean
  creditsPerWeek: number | null
  weekUsedCredits: number
  weekResetSeconds: number
  creditsPer5h: number | null
  windowUsedCredits: number
  windowResetSeconds: number
  sessionWindowMinutes: number
  limitMode: "gated" | "unlimited" | null
  fetchedAt: number
}

export interface RayuCloudModelEntry {
  code: string
  label?: string
  description?: string
  contextWindow?: number
  supportsReasoning?: boolean
}

/**
 * Token-free snapshot safe to pass across IPC into the renderer.
 * Access tokens and API keys NEVER leave the Electron main process.
 */
export interface RayuAuthState {
  signedIn: boolean
  method: "oauth" | "apiKey" | "none"
  signingIn: boolean
  pendingAuthUrl: string | null
  user: RayuSessionUser | null
  credits: RayuCloudCredits | null
  allowedModels: RayuCloudModelEntry[]
  apiBase: string
  webBase: string
  gatewayBase: string
  error: string | null
}

export interface CloudChatMessage {
  role: "user" | "assistant"
  content: string
  images?: Array<[string, string]>
}

export interface CloudStreamEvent {
  ev: string
  session_id: string
  text?: string
  call_id?: string
  name?: string
  tool_input?: Record<string, unknown>
  tool_output?: string
  error?: string
  input?: number
  output?: number
  cache_read_input?: number
  message?: string
  reason?: string
}

const TOOL_IGNORED_DIRS = new Set([
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

function resolveSafeWorkspacePath(rootDir: string, rawPath = "."): string {
  const root = path.resolve(rootDir)
  const candidate = path.resolve(root, rawPath || ".")
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path "${rawPath}" escapes workspace directory.`)
  }
  return candidate
}

function executeListFilesTool(
  workspaceDir: string,
  args: Record<string, unknown>
): string {
  const relDir = typeof args.directory === "string" ? args.directory.trim() : "."
  const maxFiles = Math.min(
    200,
    Math.max(10, typeof args.max_files === "number" ? args.max_files : 120)
  )
  const startDir = resolveSafeWorkspacePath(workspaceDir, relDir)
  const resolvedRoot = path.resolve(workspaceDir)
  const results: string[] = []

  const walk = (dir: string, depth: number) => {
    if (depth > 3 || results.length >= maxFiles) return
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
      const full = path.join(dir, entry.name)
      const rel = path.relative(resolvedRoot, full)
      if (entry.isDirectory()) {
        if (TOOL_IGNORED_DIRS.has(entry.name)) continue
        results.push(`${rel}/`)
        walk(full, depth + 1)
      } else if (entry.isFile()) {
        results.push(rel)
      }
    }
  }

  walk(startDir, 0)
  return results.length > 0 ? results.join("\n") : "(empty directory)"
}

function executeReadFileTool(
  workspaceDir: string,
  args: Record<string, unknown>
): string {
  const relPath = typeof args.path === "string" ? args.path.trim() : ""
  if (!relPath) throw new Error("Missing required 'path' argument.")
  const target = resolveSafeWorkspacePath(workspaceDir, relPath)
  const stat = fs.statSync(target)
  if (!stat.isFile()) throw new Error(`"${relPath}" is not a file.`)
  const raw = fs.readFileSync(target, "utf8")
  const lines = raw.split(/\r?\n/)
  const start = Math.max(
    1,
    typeof args.start_line === "number" ? Math.floor(args.start_line) : 1
  )
  const end = Math.min(
    lines.length,
    typeof args.end_line === "number"
      ? Math.floor(args.end_line)
      : start + 249
  )
  const slice = lines
    .slice(start - 1, end)
    .map((line, idx) => `${start + idx}: ${line}`)
    .join("\n")
  return slice.slice(0, 16_000)
}

function executeSearchFilesTool(
  workspaceDir: string,
  args: Record<string, unknown>
): string {
  const query = typeof args.query === "string" ? args.query.trim() : ""
  if (!query) throw new Error("Missing required 'query' argument.")
  const relDir = typeof args.directory === "string" ? args.directory.trim() : "."
  const startDir = resolveSafeWorkspacePath(workspaceDir, relDir)
  const resolvedRoot = path.resolve(workspaceDir)
  const needle = query.toLowerCase()
  const matches: string[] = []

  const walk = (dir: string, depth: number) => {
    if (depth > 4 || matches.length >= 35) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (matches.length >= 35) break
      if (entry.name.startsWith(".")) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (TOOL_IGNORED_DIRS.has(entry.name)) continue
        walk(full, depth + 1)
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full)
          if (stat.size > 512_000) continue
          const content = fs.readFileSync(full, "utf8")
          if (!content.toLowerCase().includes(needle)) continue
          const rel = path.relative(resolvedRoot, full)
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length && matches.length < 35; i += 1) {
            if (lines[i].toLowerCase().includes(needle)) {
              matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
            }
          }
        } catch {
          // skip unreadable or binary files
        }
      }
    }
  }

  walk(startDir, 0)
  return matches.length > 0 ? matches.join("\n") : `No matches found for "${query}".`
}

async function executeRunCommandTool(
  workspaceDir: string,
  args: Record<string, unknown>
): Promise<string> {
  const command = typeof args.command === "string" ? args.command.trim() : ""
  if (!command) throw new Error("Missing required 'command' argument.")
  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-lc", command],
      {
        cwd: path.resolve(workspaceDir),
        timeout: 12_000,
        maxBuffer: 256 * 1024,
      },
      (err, stdout, stderr) => {
        const combined = [stdout, stderr].filter(Boolean).join("\n").trim()
        if (err && !combined) {
          resolve(`Command exited with error: ${err.message}`)
          return
        }
        resolve((combined || "(no output)").slice(0, 8000))
      }
    )
  })
}

async function runWorkspaceAgentTool(
  workspaceDir: string,
  name: string,
  args: Record<string, unknown>,
  options?: {
    browserCdp?: BrowserCdpController
    onArtifact?: (artifact: DesktopArtifactEvent) => void
    sessionId?: string
  }
): Promise<{ output: string; error?: string }> {
  try {
    switch (name) {
      case "list_files":
        return { output: executeListFilesTool(workspaceDir, args) }
      case "read_file":
        return { output: executeReadFileTool(workspaceDir, args) }
      case "search_files":
        return { output: executeSearchFilesTool(workspaceDir, args) }
      case "run_command":
        return { output: await executeRunCommandTool(workspaceDir, args) }
      default: {
        const desktopResult = await executeDesktopTool(
          {
            getWorkspaceDir: () => workspaceDir,
            browserCdp: options?.browserCdp,
            onArtifact: options?.onArtifact,
          },
          name,
          args,
          options?.sessionId
        )
        if (desktopResult !== null) {
          return desktopResult
        }
        return { output: "", error: `Unknown tool: ${name}` }
      }
    }
  } catch (err) {
    return {
      output: "",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const BASE_CLOUD_WORKSPACE_TOOLS = [
  {
    name: "list_files",
    description:
      "List files and folders inside the active local workspace directory.",
    input_schema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Relative subdirectory to inspect (defaults to workspace root '.').",
        },
        max_files: {
          type: "number",
          description: "Maximum entries to return (default 120).",
        },
      },
    },
  },
  {
    name: "read_file",
    description:
      "Read a text file from the active local workspace with line numbers.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path inside the workspace (e.g. 'README.md' or 'desktop/package.json').",
        },
        start_line: { type: "number" },
        end_line: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for a text string or symbol across files in the active workspace.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term or symbol name." },
        directory: { type: "string", description: "Optional relative subdirectory." },
      },
      required: ["query"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a quick shell inspection command (such as git status, git log -n 5, ls) in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
      },
      required: ["command"],
    },
  },
]

function getCloudWorkspaceTools() {
  return [...BASE_CLOUD_WORKSPACE_TOOLS, ...DESKTOP_CLOUD_TOOL_SCHEMAS]
}

export function isSafeRayuBaseUrl(base: string): boolean {
  try {
    const url = new URL(base)
    if (url.username || url.password) return false
    if (url.protocol === "https:") return Boolean(url.hostname)
    if (url.protocol === "http:") {
      const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
      return host === "localhost" || host === "127.0.0.1" || host === "::1"
    }
    return false
  } catch {
    return false
  }
}

function validatedBase(envKey: string, fallback: string): string {
  const raw = process.env[envKey]?.trim()
  if (!raw) return fallback
  const candidate = raw.replace(/\/+$/, "")
  return isSafeRayuBaseUrl(candidate) ? candidate : fallback
}

export function getRayuApiBase(): string {
  return validatedBase("RAYU_API_URL", DEFAULT_API_BASE)
}

export function getRayuWebBase(): string {
  return validatedBase("RAYU_WEB_URL", DEFAULT_WEB_BASE)
}

export function getRayuGatewayBase(): string {
  return validatedBase("RAYU_GATEWAY_URL", DEFAULT_GATEWAY_BASE)
}

export function getRayuConfigDir(): string {
  for (const key of ["RAYU_AUTH_CONFIG_DIR", "RAYU_HOME", "RAYU_CONFIG_DIR"]) {
    const val = process.env[key]?.trim()
    if (val) return val
  }
  return path.join(os.homedir(), ".rayu")
}

export function getRayuAppConfigDir(): string {
  for (const key of ["RAYU_HOME", "RAYU_CONFIG_DIR"]) {
    const val = process.env[key]?.trim()
    if (val) return path.join(val, "config", "rayucode")
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "rayucode")
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA?.trim() ||
      path.join(os.homedir(), "AppData", "Roaming")
    return path.join(appData, "rayucode")
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  if (xdg) return path.join(xdg, "rayucode")
  return path.join(os.homedir(), ".config", "rayucode")
}

function getLegacyAppConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  if (xdg) return path.join(xdg, "rayucode")
  return path.join(os.homedir(), ".config", "rayucode")
}

function openExternalUrlFallback(url: string): void {
  if (!isSafeRayuBaseUrl(url)) return
  try {
    if (process.platform === "darwin") {
      execFile("open", [url], () => {})
    } else if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", url], () => {})
    } else {
      execFile("xdg-open", [url], () => {})
    }
  } catch {
    // ignore if launcher unavailable
  }
}

export function buildCliLoginUrl(
  webBaseUrl: string,
  port: number,
  state: string
): string {
  const url = new URL(`${webBaseUrl.replace(/\/+$/, "")}/cli-login`)
  url.searchParams.set("port", String(port))
  url.searchParams.set("state", state)
  return url.toString()
}

export function parseCallbackUrl(input: string): { code: string; state: string } {
  const trimmed = input.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    parsed = new URL(`http://127.0.0.1${trimmed.startsWith("/") ? "" : "/"}${trimmed}`)
  }
  const code = parsed.searchParams.get("code")?.trim() ?? ""
  const state = parsed.searchParams.get("state")?.trim() ?? ""
  if (!code) {
    throw new Error("Callback URL does not contain an authorization code.")
  }
  if (!state) {
    throw new Error("Callback URL does not contain a state parameter.")
  }
  return { code, state }
}

function sessionFilePath(): string {
  return path.join(getRayuConfigDir(), SESSION_FILE)
}

function readStoredSession(): StoredRayuSession | null {
  try {
    const raw = fs.readFileSync(sessionFilePath(), "utf8")
    const parsed = JSON.parse(raw) as StoredRayuSession
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStoredSession(session: StoredRayuSession): void {
  const dir = getRayuConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  const target = sessionFilePath()
  const content = JSON.stringify(session, null, 2)
  fs.writeFileSync(target, content, { mode: 0o600 })
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(target, 0o600)
    } catch {
      // ignore chmod errors on special filesystems
    }
  }
}

function readApiKeyFromPath(envPath: string): string | null {
  try {
    const content = fs.readFileSync(envPath, "utf8")
    for (const line of content.split(/\r?\n/)) {
      if (line.startsWith("RAYU_API_KEY=")) {
        const val = line
          .slice("RAYU_API_KEY=".length)
          .trim()
          .replace(/^['"]|['"]$/g, "")
        if (val.startsWith(KEY_PREFIX)) return val
      }
    }
  } catch {
    // file absent
  }
  return null
}

function readConfiguredApiKey(): string | null {
  const envVal = process.env.RAYU_API_KEY?.trim().replace(/^['"]|['"]$/g, "")
  if (envVal && envVal.startsWith(KEY_PREFIX)) return envVal

  const primary = path.join(getRayuAppConfigDir(), ENV_FILE)
  const found = readApiKeyFromPath(primary)
  if (found) return found

  const legacy = path.join(getLegacyAppConfigDir(), ENV_FILE)
  if (legacy !== primary) {
    return readApiKeyFromPath(legacy)
  }
  return null
}

function saveApiKeyToEnvFile(key: string): void {
  const dir = getRayuAppConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  const envPath = path.join(dir, ENV_FILE)
  let lines: string[]
  try {
    lines = fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("RAYU_API_KEY="))
  } catch {
    lines = []
  }
  lines.push(`RAYU_API_KEY=${key}`)
  fs.writeFileSync(envPath, `${lines.filter(Boolean).join("\n")}\n`, {
    mode: 0o600,
  })
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(envPath, 0o600)
    } catch {
      // ignore
    }
  }
}

function clearApiKeyFromEnvFile(): void {
  const paths = new Set([
    path.join(getRayuAppConfigDir(), ENV_FILE),
    path.join(getLegacyAppConfigDir(), ENV_FILE),
  ])
  for (const envPath of paths) {
    try {
      const lines = fs
        .readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => !l.startsWith("RAYU_API_KEY="))
      fs.writeFileSync(envPath, lines.filter(Boolean).join("\n"), {
        mode: 0o600,
      })
    } catch {
      // ignore if absent
    }
  }
}

export function parseAnthropicSseChunk(
  rawEventBlock: string
): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = []
  for (const line of rawEventBlock.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === "[DONE]") continue
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      results.push(parsed)
    } catch {
      // ignore malformed SSE lines
    }
  }
  return results
}

export class RayuAuthManager extends EventEmitter {
  private activeLoginServer: http.Server | null = null
  private activeLoginTimer: ReturnType<typeof setTimeout> | null = null
  private activeLoginState: string | null = null
  private activeLoginResolve: ((state: RayuAuthState) => void) | null = null
  private signingIn = false
  private pendingAuthUrl: string | null = null
  private refreshInFlight: Promise<string | null> | null = null
  private cachedCredits: RayuCloudCredits | null = null
  private cachedModels: RayuCloudModelEntry[] = []
  private lastError: string | null = null
  private activeStreams = new Map<string, AbortController>()

  getState(): RayuAuthState {
    const session = readStoredSession()
    const hasOAuth = Boolean(
      session?.accessToken &&
        (Date.now() < session.expiresAt - REFRESH_SKEW_MS ||
          Boolean(session.refreshToken))
    )
    const hasKey = Boolean(readConfiguredApiKey())
    const method: RayuAuthState["method"] = hasOAuth
      ? "oauth"
      : hasKey
        ? "apiKey"
        : "none"

    return {
      signedIn: method !== "none",
      method,
      signingIn: this.signingIn,
      pendingAuthUrl: this.pendingAuthUrl,
      user: hasOAuth ? (session?.user ?? null) : null,
      credits: this.cachedCredits,
      allowedModels: [...this.cachedModels],
      apiBase: getRayuApiBase(),
      webBase: getRayuWebBase(),
      gatewayBase: getRayuGatewayBase(),
      error: this.lastError,
    }
  }

  private emitState(): RayuAuthState {
    const snapshot = this.getState()
    this.emit("auth-changed", snapshot)
    return snapshot
  }

  async getValidAccessToken(): Promise<string | null> {
    const session = readStoredSession()
    if (!session?.accessToken) return null
    if (Date.now() < session.expiresAt - REFRESH_SKEW_MS) {
      return session.accessToken
    }
    return this.refreshAccessToken(session.accessToken)
  }

  async refreshAccessToken(staleToken?: string): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = (async () => {
      const session = readStoredSession()
      if (!session?.refreshToken) return null
      if (
        staleToken &&
        session.accessToken !== staleToken &&
        Date.now() < session.expiresAt - REFRESH_SKEW_MS
      ) {
        return session.accessToken
      }

      try {
        const res = await fetch(`${getRayuApiBase()}/cli/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
          redirect: "manual",
        })
        if (!res.ok) {
          if (res.status === 400 || res.status === 401) {
            const latest = readStoredSession()
            if (latest?.refreshToken === session.refreshToken) {
              try {
                fs.unlinkSync(sessionFilePath())
              } catch {
                // ignore
              }
            }
          }
          return null
        }
        const data = (await res.json()) as {
          accessToken?: string
          refreshToken?: string
          expiresAt?: number
        }
        if (!data.accessToken) return null
        const latest = readStoredSession()
        if (!latest || latest.refreshToken !== session.refreshToken) {
          return latest?.accessToken ?? data.accessToken
        }
        const updated: StoredRayuSession = {
          ...latest,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? latest.refreshToken,
          expiresAt: data.expiresAt ?? latest.expiresAt,
        }
        writeStoredSession(updated)
        return updated.accessToken
      } catch {
        return null
      }
    })().finally(() => {
      this.refreshInFlight = null
    })

    return this.refreshInFlight
  }

  async getGatewayCredential(): Promise<string | null> {
    const jwt = await this.getValidAccessToken()
    if (jwt) return jwt
    return readConfiguredApiKey()
  }

  async refreshAccountDetails(): Promise<RayuAuthState> {
    this.lastError = null
    const credential = await this.getGatewayCredential()
    if (!credential) {
      this.cachedCredits = null
      this.cachedModels = []
      return this.emitState()
    }

    const jwt = await this.getValidAccessToken()

    const [meRes, creditsRes, modelsRes] = await Promise.allSettled([
      jwt
        ? fetch(`${getRayuApiBase()}/me`, {
            headers: { Authorization: `Bearer ${jwt}` },
            redirect: "manual",
          })
        : Promise.resolve(null),
      fetch(`${getRayuGatewayBase()}/v1/credits`, {
        headers: { Authorization: `Bearer ${credential}` },
        redirect: "manual",
      }),
      jwt
        ? fetch(`${getRayuApiBase()}/me/entitlements`, {
            headers: { Authorization: `Bearer ${jwt}` },
            redirect: "manual",
          })
        : fetch(`${getRayuGatewayBase()}/v1/models`, {
            headers: { Authorization: `Bearer ${credential}` },
            redirect: "manual",
          }),
    ])

    if (meRes.status === "fulfilled" && meRes.value?.ok) {
      try {
        const me = (await meRes.value.json()) as { user?: RayuSessionUser }
        const existing = readStoredSession()
        if (me.user && existing) {
          writeStoredSession({ ...existing, user: me.user })
        }
      } catch {
        // keep stored user
      }
    }

    if (creditsRes.status === "fulfilled" && creditsRes.value.ok) {
      try {
        const raw = (await creditsRes.value.json()) as Partial<RayuCloudCredits>
        this.cachedCredits = {
          plan: raw.plan ?? "plus",
          planName: raw.planName ?? raw.plan ?? "RayuCode",
          creditsPerPeriod: raw.creditsPerPeriod ?? null,
          usedCredits: raw.usedCredits ?? 0,
          remainingCredits: raw.remainingCredits ?? null,
          resetSeconds: raw.resetSeconds ?? 0,
          periodEnd: raw.periodEnd ?? null,
          topupBalance: raw.topupBalance ?? 0,
          topUpEnabled: Boolean(raw.topUpEnabled),
          creditsPerWeek: raw.creditsPerWeek ?? null,
          weekUsedCredits: raw.weekUsedCredits ?? 0,
          weekResetSeconds: raw.weekResetSeconds ?? 0,
          creditsPer5h: raw.creditsPer5h ?? null,
          windowUsedCredits: raw.windowUsedCredits ?? 0,
          windowResetSeconds: raw.windowResetSeconds ?? 0,
          sessionWindowMinutes: raw.sessionWindowMinutes ?? 300,
          limitMode: raw.limitMode ?? null,
          fetchedAt: Date.now(),
        }
      } catch {
        // ignore parse error
      }
    }

    if (modelsRes.status === "fulfilled" && modelsRes.value.ok) {
      try {
        const body = (await modelsRes.value.json()) as {
          allowedModels?: RayuCloudModelEntry[]
          hostedModels?: RayuCloudModelEntry[]
          data?: Array<{ id: string }>
        }
        const entries =
          body.hostedModels ??
          body.allowedModels ??
          body.data?.map((m) => ({ code: m.id, label: m.id })) ??
          []
        if (entries.length > 0) {
          this.cachedModels = entries
        }
      } catch {
        // ignore parse error
      }
    }

    return this.emitState()
  }

  cancelBrowserSignIn(): RayuAuthState {
    if (this.activeLoginTimer) {
      clearTimeout(this.activeLoginTimer)
      this.activeLoginTimer = null
    }
    if (this.activeLoginServer) {
      try {
        this.activeLoginServer.close()
      } catch {
        // ignore
      }
      this.activeLoginServer = null
    }
    this.activeLoginState = null
    this.signingIn = false
    this.pendingAuthUrl = null
    const snapshot = this.emitState()
    if (this.activeLoginResolve) {
      const resolvePending = this.activeLoginResolve
      this.activeLoginResolve = null
      resolvePending(snapshot)
    }
    return snapshot
  }

  async completeManualCallback(rawCallbackUrl: string): Promise<RayuAuthState> {
    this.lastError = null
    const { code, state } = parseCallbackUrl(rawCallbackUrl)
    if (this.activeLoginState && state !== this.activeLoginState) {
      throw new Error(
        "Callback state does not match this sign-in session. Copy a fresh sign-in link and try again."
      )
    }
    await this.exchangeCode(code, state)
    const resolvePending = this.activeLoginResolve
    this.activeLoginResolve = null
    this.cancelBrowserSignIn()
    const snapshot = await this.refreshAccountDetails()
    resolvePending?.(snapshot)
    return snapshot
  }

  async signInWithBrowser(): Promise<RayuAuthState> {
    this.cancelBrowserSignIn()
    this.lastError = null
    const expectedState = randomBytes(16).toString("hex")
    this.activeLoginState = expectedState

    return new Promise<RayuAuthState>((resolve, reject) => {
      this.activeLoginResolve = resolve
      const server = http.createServer((req, res) => {
        const reqPath = req.url ?? "/"
        let parsed: URL
        try {
          parsed = new URL(`http://127.0.0.1${reqPath}`)
        } catch {
          res.writeHead(400)
          res.end("Bad request")
          return
        }

        const code = parsed.searchParams.get("code")?.trim() ?? ""
        const state = parsed.searchParams.get("state")?.trim() ?? ""

        if (!code) {
          res.writeHead(204)
          res.end()
          return
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" })
          res.end("<h3>Invalid state parameter.</h3>")
          this.lastError = "OAuth state mismatch. Please try signing in again."
          this.activeLoginResolve = null
          this.cancelBrowserSignIn()
          reject(new Error(this.lastError))
          return
        }

        const dashboardUrl = `${getRayuWebBase()}/dashboard`
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(
          `<!doctype html><html><body style="font-family:-apple-system,Inter,sans-serif;background:#11110E;color:#ECEAE3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#161613;border:1px solid #2A2924;border-radius:14px;padding:28px 32px;max-width:420px;text-align:center"><h2 style="margin:0 0 8px;color:#3DBD84">Signed in to RayuCode</h2><p style="margin:0 0 16px;color:#D4D0C5;font-size:14px">You can close this tab and return to RayuCode Desktop.</p><a href="${dashboardUrl}" style="color:#5FD19C;font-size:13px">Open Dashboard</a></div></body></html>`
        )

        void this.exchangeCode(code, state)
          .then(async () => {
            this.activeLoginResolve = null
            this.cancelBrowserSignIn()
            const snapshot = await this.refreshAccountDetails()
            resolve(snapshot)
          })
          .catch((err: unknown) => {
            this.lastError =
              err instanceof Error ? err.message : "Rayu Cloud sign-in failed"
            this.activeLoginResolve = null
            this.cancelBrowserSignIn()
            reject(err instanceof Error ? err : new Error(this.lastError))
          })
      })

      server.once("error", (err) => {
        this.lastError = `Could not start local auth callback server: ${err.message}`
        this.activeLoginResolve = null
        this.cancelBrowserSignIn()
        reject(new Error(this.lastError))
      })

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        if (!addr || typeof addr === "string") {
          this.activeLoginResolve = null
          this.cancelBrowserSignIn()
          reject(new Error("Could not determine callback port"))
          return
        }
        this.activeLoginServer = server
        this.signingIn = true
        const loginUrl = buildCliLoginUrl(getRayuWebBase(), addr.port, expectedState)
        this.pendingAuthUrl = loginUrl
        this.emitState()

        void import("electron")
          .then(({ shell }) => {
            if (shell?.openExternal) {
              return shell.openExternal(loginUrl)
            }
            openExternalUrlFallback(loginUrl)
            return undefined
          })
          .catch(() => {
            openExternalUrlFallback(loginUrl)
          })

        this.activeLoginTimer = setTimeout(() => {
          this.lastError = "Rayu Cloud sign-in timed out after 5 minutes."
          this.activeLoginResolve = null
          this.cancelBrowserSignIn()
          reject(new Error(this.lastError))
        }, LOGIN_TIMEOUT_MS)
      })
    })
  }

  private async exchangeCode(code: string, state: string): Promise<RayuSessionUser> {
    const res = await fetch(`${getRayuApiBase()}/cli/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
      redirect: "manual",
    })
    if (!res.ok) {
      throw new Error(`Rayu Cloud token exchange failed (HTTP ${res.status}).`)
    }
    const session = (await res.json()) as StoredRayuSession
    if (!session?.accessToken) {
      throw new Error("Rayu Cloud returned an empty access token.")
    }
    writeStoredSession(session)
    return session.user
  }

  async signInWithApiKey(rawKey: string): Promise<RayuAuthState> {
    this.lastError = null
    const key = rawKey.trim()
    if (!key.startsWith(KEY_PREFIX)) {
      throw new Error(`Rayu API keys must start with '${KEY_PREFIX}'.`)
    }

    const res = await fetch(`${getRayuGatewayBase()}/v1/credits`, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "manual",
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error("Rayu API key was rejected (HTTP 401). Check your key.")
    }
    if (!res.ok) {
      throw new Error(`Could not verify Rayu API key (HTTP ${res.status}).`)
    }

    saveApiKeyToEnvFile(key)
    process.env.RAYU_API_KEY = key
    return this.refreshAccountDetails()
  }

  async signOut(): Promise<RayuAuthState> {
    this.cancelBrowserSignIn()
    try {
      fs.unlinkSync(sessionFilePath())
    } catch {
      // ignore if absent
    }
    clearApiKeyFromEnvFile()
    delete process.env.RAYU_API_KEY
    for (const cacheFile of ["rayu-entitlements.json", "rayu-feature-usage.json"]) {
      try {
        fs.unlinkSync(path.join(getRayuConfigDir(), cacheFile))
      } catch {
        // ignore
      }
    }
    this.cachedCredits = null
    this.cachedModels = []
    this.lastError = null
    return this.emitState()
  }

  cancelStream(sessionId: string): void {
    const controller = this.activeStreams.get(sessionId)
    if (controller) {
      controller.abort()
      this.activeStreams.delete(sessionId)
    }
  }

  /**
   * Direct HTTPS SSE streaming against `{gatewayBase}/anthropic/v1/messages`
   * using the authenticated Rayu Cloud JWT or API key.
   * Mirrors `crates/rayucode-provider-rayu-runtime/src/lib.rs` wire headers.
   */
  async streamCloudChat(input: {
    sessionId: string
    model: string
    messages: CloudChatMessage[]
    workspaceDir?: string
    browserCdp?: BrowserCdpController
    onArtifact?: (artifact: DesktopArtifactEvent) => void
    onEvent: (event: CloudStreamEvent) => void
  }): Promise<void> {
    let credential = await this.getGatewayCredential()
    if (!credential) {
      throw new Error("Sign in to Rayu Cloud before sending messages.")
    }

    this.cancelStream(input.sessionId)
    const controller = new AbortController()
    this.activeStreams.set(input.sessionId, controller)

    const requestedModel = input.model.replace(/^rayu:/, "").trim()
    const bareModel =
      !requestedModel || requestedModel === "default"
        ? (this.cachedModels[0]?.code ?? "claude-sonnet-4-6")
        : requestedModel
    const requestId = `rv2_${randomBytes(12).toString("hex")}`
    const workspaceDir = input.workspaceDir?.trim()
    const hasTools = Boolean(workspaceDir && fs.existsSync(workspaceDir))

    const systemPrompt = hasTools
      ? [
          `You are RayuCode, an autonomous local engineering assistant running inside RayuCode Desktop.`,
          `Active workspace directory: ${workspaceDir}`,
          `You have real local tools (list_files, read_file, search_files, run_command), real Microsoft Office tools (read_excel, write_excel, create_powerpoint for genuine .xlsx/.pptx files on disk), template library tools (list_templates, save_template), and live embedded browser CDP tools (browser_navigate, browser_snapshot, browser_click, browser_type).`,
          `When the user asks about this codebase or project, inspect key top-level files (README.md, package.json/Cargo.toml, main folders) in 1-2 quick targeted tool rounds instead of exhaustively scanning every subdirectory.`,
          `Before your first tool call, write 1 short sentence explaining what you are checking.`,
          `Keep your final reply concise, clean, and scannable (short intro + crisp bullet points with key paths). Never generate Mermaid or ASCII diagrams unless the user explicitly asks for a diagram.`,
        ].join("\n")
      : undefined

    const conversationMessages: Array<{
      role: "user" | "assistant"
      content: string | Array<Record<string, unknown>>
    }> = input.messages.map((m) => {
      if (m.role === "user" && m.images && m.images.length > 0) {
        const blocks: Array<Record<string, unknown>> = m.images.map(
          ([mediaType, base64Data]) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Data,
            },
          })
        )
        blocks.push({
          type: "text",
          text: m.content.trim() || "Analyze the attached image(s).",
        })
        return {
          role: m.role,
          content: blocks,
        }
      }
      return {
        role: m.role,
        content: m.content,
      }
    })

    const makeRequest = (bearer: string) => {
      const payload: Record<string, unknown> = {
        model: bareModel,
        max_tokens: 4096,
        stream: true,
        messages: conversationMessages,
      }
      if (systemPrompt) {
        payload.system = systemPrompt
      }
      if (hasTools) {
        payload.tools = getCloudWorkspaceTools()
      }
      return fetch(`${getRayuGatewayBase()}/anthropic/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
          "anthropic-version": "2023-06-01",
          "x-rayu-client": "cli",
          "x-rayu-request-id": requestId,
          "x-rayu-logical-request-id": requestId,
          "x-rayu-query-source": "rayucode_v2_agent",
          "x-rayu-session-id": input.sessionId,
          "x-rayu-intended-model": bareModel,
        },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: controller.signal,
      })
    }

    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let timedOutReason: string | null = null
    const armWatchdog = (ms: number, reason: string) => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        timedOutReason = reason
        controller.abort()
      }, ms)
    }

    try {
      const maxRounds = hasTools ? 6 : 1
      let terminated = false

      for (let round = 0; round < maxRounds && !terminated; round += 1) {
        armWatchdog(
          45_000,
          "Rayu Cloud timed out waiting for a response (45s)."
        )
        let res = await makeRequest(credential)
        if (res.status === 401) {
          const refreshed = await this.refreshAccessToken(credential)
          if (refreshed) {
            credential = refreshed
            armWatchdog(
              45_000,
              "Rayu Cloud timed out after token refresh (45s)."
            )
            res = await makeRequest(credential)
          }
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          throw new Error(
            `Rayu Cloud returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 180)}` : ""}`
          )
        }

        if (!res.body) {
          throw new Error("Rayu Cloud returned an empty response stream.")
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder("utf-8")
        let buffer = ""
        let roundText = ""

        const activeBlocks = new Map<
          number,
          {
            type: "text" | "tool_use"
            id?: string
            name?: string
            text: string
            inputJson: string
          }
        >()
        const completedToolCalls: Array<{
          id: string
          name: string
          input: Record<string, unknown>
        }> = []

        const processBlock = (block: string) => {
          if (terminated) return
          for (const evt of parseAnthropicSseChunk(block)) {
            const type = typeof evt.type === "string" ? evt.type : ""
            if (type === "content_block_start") {
              const index = typeof evt.index === "number" ? evt.index : 0
              const cb = evt.content_block as
                | { type?: string; id?: string; name?: string }
                | undefined
              if (cb?.type === "tool_use" && cb.id && cb.name) {
                activeBlocks.set(index, {
                  type: "tool_use",
                  id: cb.id,
                  name: cb.name,
                  text: "",
                  inputJson: "",
                })
              } else if (cb?.type === "text") {
                activeBlocks.set(index, {
                  type: "text",
                  text: "",
                  inputJson: "",
                })
              }
            } else if (type === "content_block_delta") {
              const index = typeof evt.index === "number" ? evt.index : 0
              const delta = evt.delta as
                | {
                    type?: string
                    text?: string
                    thinking?: string
                    partial_json?: string
                  }
                | undefined
              if (delta?.type === "text_delta" && delta.text) {
                roundText += delta.text
                const b = activeBlocks.get(index)
                if (b) b.text += delta.text
                input.onEvent({
                  ev: "text_delta",
                  session_id: input.sessionId,
                  text: delta.text,
                })
              } else if (delta?.type === "thinking_delta" && delta.thinking) {
                input.onEvent({
                  ev: "reasoning_delta",
                  session_id: input.sessionId,
                  text: delta.thinking,
                })
              } else if (
                delta?.type === "input_json_delta" &&
                typeof delta.partial_json === "string"
              ) {
                const b = activeBlocks.get(index)
                if (b) b.inputJson += delta.partial_json
              }
            } else if (type === "content_block_stop") {
              const index = typeof evt.index === "number" ? evt.index : 0
              const b = activeBlocks.get(index)
              if (b?.type === "tool_use" && b.id && b.name) {
                let parsedInput: Record<string, unknown> = {}
                if (b.inputJson.trim()) {
                  try {
                    const parsed = JSON.parse(b.inputJson) as unknown
                    if (parsed && typeof parsed === "object") {
                      parsedInput = parsed as Record<string, unknown>
                    }
                  } catch {
                    // keep empty input object
                  }
                }
                completedToolCalls.push({
                  id: b.id,
                  name: b.name,
                  input: parsedInput,
                })
              }
            } else if (type === "message_delta") {
              const usage = evt.usage as
                | {
                    input_tokens?: number
                    output_tokens?: number
                    cache_read_input_tokens?: number
                  }
                | undefined
              if (usage) {
                input.onEvent({
                  ev: "token_usage",
                  session_id: input.sessionId,
                  input: usage.input_tokens ?? 0,
                  output: usage.output_tokens ?? 0,
                  cache_read_input: usage.cache_read_input_tokens ?? 0,
                })
              }
            } else if (type === "error") {
              terminated = true
              const errObj = evt.error as { message?: string } | undefined
              input.onEvent({
                ev: "turn_stopped",
                session_id: input.sessionId,
                reason: "failure",
                message: errObj?.message ?? "Rayu Cloud stream error",
              })
              return
            }
          }
        }

        while (!terminated) {
          armWatchdog(90_000, "Rayu Cloud stream stalled for 90s.")
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split(/\r?\n\r?\n/)
          buffer = parts.pop() ?? ""

          for (const block of parts) {
            processBlock(block)
            if (terminated) break
          }
        }

        if (!terminated && buffer.trim()) {
          processBlock(buffer)
        }

        if (terminated) break

        // Execute local workspace tool calls if the model requested tools
        if (completedToolCalls.length > 0 && workspaceDir && round < maxRounds - 1) {
          if (roundText.trim()) {
            input.onEvent({
              ev: "promote_answer_to_note",
              session_id: input.sessionId,
            })
          }

          const assistantContent: Array<Record<string, unknown>> = []
          if (roundText.trim()) {
            assistantContent.push({ type: "text", text: roundText })
          }
          const toolResults: Array<Record<string, unknown>> = []

          for (const tc of completedToolCalls) {
            assistantContent.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })
            input.onEvent({
              ev: "tool_start",
              session_id: input.sessionId,
              call_id: tc.id,
              name: tc.name,
              tool_input: tc.input,
            })

            const { output, error } = await runWorkspaceAgentTool(
              workspaceDir,
              tc.name,
              tc.input,
              {
                browserCdp: input.browserCdp,
                onArtifact: input.onArtifact,
                sessionId: input.sessionId,
              }
            )

            input.onEvent({
              ev: "tool_done",
              session_id: input.sessionId,
              call_id: tc.id,
              name: tc.name,
              tool_input: tc.input,
              tool_output: output,
              error,
            })

            toolResults.push({
              type: "tool_result",
              tool_use_id: tc.id,
              content: error ? `Error: ${error}` : output,
              ...(error ? { is_error: true } : {}),
            })
          }

          conversationMessages.push({
            role: "assistant",
            content: assistantContent,
          })
          conversationMessages.push({
            role: "user",
            content: toolResults,
          })
          continue
        }

        break
      }

      if (!terminated) {
        input.onEvent({
          ev: "turn_done",
          session_id: input.sessionId,
        })
      }
      void this.refreshAccountDetails().catch(() => {})
    } catch (err) {
      if (controller.signal.aborted) {
        if (timedOutReason) {
          input.onEvent({
            ev: "turn_stopped",
            session_id: input.sessionId,
            reason: "failure",
            message: timedOutReason,
          })
          return
        }
        // User-initiated cancellation — do not surface as a failure error
        input.onEvent({
          ev: "turn_stopped",
          session_id: input.sessionId,
          reason: "cancelled",
        })
        return
      }
      throw err
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      this.activeStreams.delete(input.sessionId)
    }
  }

  dispose(): void {
    this.cancelBrowserSignIn()
    for (const controller of this.activeStreams.values()) {
      controller.abort()
    }
    this.activeStreams.clear()
  }
}
