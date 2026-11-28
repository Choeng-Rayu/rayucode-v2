/**
 * RayuCode VS Code Extension Host — Real Rayu Cloud Auth Manager.
 *
 * Pure Node module (zero `vscode` imports) so it can be unit-tested directly
 * under `node --test` and reused by `harnessExtension.ts`, `featureRouters.ts`,
 * `workspacePanelManager.ts`, and `rayuAuthProvider.ts`.
 *
 * Matches Rust CLI (`crates/rayucode-base/src/rayu/`) and RayuCode Desktop
 * (`desktop/electron/auth-bridge.ts`) credential files & API endpoints 1:1:
 *   - OAuth session: `<resolveRayuAuthDir()>/rayu-auth.json` (`0600`)
 *   - API key:       `<resolveRayuAppConfigDir()>/rayu.env` (`0600`, `RAYU_API_KEY=...`)
 *   - Deep-link:     `${webBase}/vscode-login?state=<hex32>` -> `vscode://rayucode.rayucode/auth?code=...&state=...` -> `POST ${apiBase}/vscode/token`
 *   - Loopback:      `${webBase}/cli-login?port=<port>&state=<hex32>` -> `http://127.0.0.1:<port>/callback?code=...&state=...` -> `POST ${apiBase}/cli/token`
 *   - Refresh:       `POST ${apiBase}/cli/refresh`
 *   - Live profile:  `GET ${apiBase}/me`, `GET ${gatewayBase}/v1/credits`
 *   - Pacing mode:   `PUT ${apiBase}/billing/limit-mode`
 */

import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type {
  AccountStatusView,
  AccountUsageWindowView,
} from "../../shared/vscodeProtocol.js";

const DEFAULT_API_BASE = "https://api.rayucode.com/api";
const DEFAULT_WEB_BASE = "https://rayucode.com";
const DEFAULT_GATEWAY_BASE = "https://gateway.rayucode.com";

const SESSION_FILE = "rayu-auth.json";
const ENV_FILE = "rayu.env";
const KEY_PREFIX = "rayu_sk_live_";
const REFRESH_SKEW_MS = 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const CREDITS_STALE_MS = 30_000;
const MODELS_STALE_MS = 30_000;
const WATCH_DEBOUNCE_MS = 250;
const SELF_WRITE_SUPPRESS_MS = 600;

const ACCOUNT_CACHE_FILES = [
  "rayu-apikey-state.json",
  "rayu-entitlements.json",
  "rayu-feature-usage.json",
] as const;

export type RayuSignInMode = "vscode" | "loopback";
export type RayuAuthMethod = "oauth" | "apiKey" | "none";

export interface RayuSessionUser {
  id: number | string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface StoredRayuSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: RayuSessionUser;
}

export interface RayuCloudCreditsSnapshot {
  plan: string;
  planName: string;
  creditsPerPeriod: number | null;
  usedCredits: number;
  remainingCredits: number | null;
  resetSeconds: number;
  periodEnd: string | null;
  topupBalance: number;
  topUpEnabled: boolean;
  creditsPerWeek: number | null;
  weekUsedCredits: number;
  weekResetSeconds: number;
  creditsPer5h: number | null;
  windowUsedCredits: number;
  windowResetSeconds: number;
  sessionWindowMinutes: number;
  limitMode: "gated" | "full_credits" | "unlimited" | null;
  fetchedAt: number;
}

export interface RayuCloudModelEntry {
  code: string;
  label?: string;
  description?: string;
  supportsEffort?: boolean;
  supportsFast?: boolean;
}

export interface RayuHostAuthDaemonBridge {
  notifyAuthChanged?(provider: string): Promise<void>;
  setApiKey?(provider: string, apiKey: string): Promise<void>;
  clearApiKey?(provider: string): Promise<void>;
  logoutProvider?(provider: string): Promise<void>;
}

export interface RayuHostAuthManagerOptions {
  daemonBridge?: RayuHostAuthDaemonBridge;
  /** Watch auth config directories for external CLI/Desktop login/logout changes. */
  watch?: boolean;
  /** Override sign-in timeout in milliseconds (useful in tests). */
  loginTimeoutMs?: number;
}

interface PendingSignInState {
  mode: RayuSignInMode;
  state: string;
  authUrl: string;
  createdAt: number;
  server?: http.Server;
}

// ---------------------------------------------------------------------------
// Validated Origins & Paths
// ---------------------------------------------------------------------------

export function isSafeRayuBaseUrl(base: string): boolean {
  try {
    const url = new URL(base);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return Boolean(url.hostname);
    if (url.protocol === "http:") {
      const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    }
    return false;
  } catch {
    return false;
  }
}

function validatedBase(envKey: string, fallback: string): string {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const candidate = raw.replace(/\/+$/, "");
  return isSafeRayuBaseUrl(candidate) ? candidate : fallback;
}

export function getRayuApiBase(): string {
  return validatedBase("RAYU_API_URL", DEFAULT_API_BASE);
}

export function getRayuWebBase(): string {
  return validatedBase("RAYU_WEB_URL", DEFAULT_WEB_BASE);
}

export function getRayuGatewayBase(): string {
  return validatedBase("RAYU_GATEWAY_URL", DEFAULT_GATEWAY_BASE);
}

/**
 * Resolve the shared Rayu auth directory (`~/.rayu` by default).
 * Priority matches Rust `crates/rayucode-base/src/rayu/urls.rs` & Desktop:
 *   `RAYU_AUTH_CONFIG_DIR > RAYU_HOME > RAYU_CONFIG_DIR > ~/.rayu`
 */
export function resolveRayuAuthDir(): string {
  for (const key of ["RAYU_AUTH_CONFIG_DIR", "RAYU_HOME", "RAYU_CONFIG_DIR"]) {
    const val = process.env[key]?.trim();
    if (val) return val;
  }
  return path.join(os.homedir(), ".rayu");
}

/**
 * Resolve the application config directory for `rayu.env`.
 * Priority matches Rust `crate::storage::app_config_dir()` & Desktop:
 *   `RAYU_HOME/config/rayucode` / `RAYU_CONFIG_DIR/config/rayucode`
 *   -> macOS `~/Library/Application Support/rayucode`
 *   -> Windows `%APPDATA%/rayucode`
 *   -> Linux `${XDG_CONFIG_HOME || ~/.config}/rayucode`
 */
export function resolveRayuAppConfigDir(): string {
  for (const key of ["RAYU_HOME", "RAYU_CONFIG_DIR"]) {
    const val = process.env[key]?.trim();
    if (val) return path.join(val, "config", "rayucode");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "rayucode");
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA?.trim() ||
      path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "rayucode");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, "rayucode");
  return path.join(os.homedir(), ".config", "rayucode");
}

function resolveLegacyXdgConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, "rayucode");
  return path.join(os.homedir(), ".config", "rayucode");
}

function getSessionFilePath(): string {
  return path.join(resolveRayuAuthDir(), SESSION_FILE);
}

function getAllApiKeyEnvPaths(): string[] {
  const paths = new Set<string>([
    path.join(resolveRayuAppConfigDir(), ENV_FILE),
    path.join(resolveLegacyXdgConfigDir(), ENV_FILE),
    path.join(resolveRayuAuthDir(), ENV_FILE),
  ]);
  return [...paths];
}

// ---------------------------------------------------------------------------
// URL Builders & Callback Parsers
// ---------------------------------------------------------------------------

export function buildVscodeLoginUrl(webBaseUrl: string, state: string): string {
  const url = new URL(`${webBaseUrl.replace(/\/+$/, "")}/vscode-login`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function buildCliLoginUrl(
  webBaseUrl: string,
  port: number,
  state: string,
): string {
  const url = new URL(`${webBaseUrl.replace(/\/+$/, "")}/cli-login`);
  url.searchParams.set("port", String(port));
  url.searchParams.set("state", state);
  return url.toString();
}

export interface ParsedAuthCallback {
  code: string;
  state: string;
  mode: RayuSignInMode | null;
}

export function parseAuthCallbackUrl(input: string): ParsedAuthCallback {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Callback URL is empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = new URL(
      `http://127.0.0.1${trimmed.startsWith("/") ? "" : "/"}${trimmed}`,
    );
  }

  const code = parsed.searchParams.get("code")?.trim() ?? "";
  const state = parsed.searchParams.get("state")?.trim() ?? "";
  if (!code) {
    throw new Error("Callback URL does not contain an authorization code.");
  }
  if (!state) {
    throw new Error("Callback URL does not contain a state parameter.");
  }

  const protocol = parsed.protocol.toLowerCase();
  const normalizedPath = parsed.pathname.replace(/\/+$/, "").toLowerCase();

  let mode: RayuSignInMode | null = null;
  if (
    protocol === "vscode:" ||
    protocol === "vscode-insiders:" ||
    protocol === "cursor:" ||
    protocol === "vscodium:" ||
    protocol === "windsurf:" ||
    normalizedPath === "/auth"
  ) {
    mode = "vscode";
  } else if (
    (protocol === "http:" || protocol === "https:") &&
    (normalizedPath === "/callback" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "[::1]")
  ) {
    mode = "loopback";
  }

  return { code, state, mode };
}

// ---------------------------------------------------------------------------
// Formatting & Plan Ladder
// ---------------------------------------------------------------------------

function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const totalMins = Math.max(1, Math.round(seconds / 60));
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

function asRecord(val: unknown): Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function readNum(rec: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = rec[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return null;
}

function readStr(rec: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = rec[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

function parseCreditsPayload(raw: unknown): RayuCloudCreditsSnapshot | null {
  const r = asRecord(raw);
  if (Object.keys(r).length === 0) return null;

  const plan = readStr(r, "plan", "planCode", "plan_code") ?? "free";
  const planName = readStr(r, "planName", "plan_name") ?? plan;
  const rawLimitMode = readStr(r, "limitMode", "limit_mode")?.toLowerCase();
  const limitMode: RayuCloudCreditsSnapshot["limitMode"] =
    rawLimitMode === "gated"
      ? "gated"
      : rawLimitMode === "full_credits"
        ? "full_credits"
        : rawLimitMode === "unlimited"
          ? "unlimited"
          : null;

  return {
    plan,
    planName,
    creditsPerPeriod: readNum(r, "creditsPerPeriod", "credits_per_period"),
    usedCredits: readNum(r, "usedCredits", "used_credits") ?? 0,
    remainingCredits: readNum(r, "remainingCredits", "remaining_credits"),
    resetSeconds: readNum(r, "resetSeconds", "reset_seconds") ?? 0,
    periodEnd: readStr(r, "periodEnd", "period_end"),
    topupBalance: readNum(r, "topupBalance", "topup_balance", "topUpBalance") ?? 0,
    topUpEnabled: Boolean(r.topUpEnabled ?? r.top_up_enabled ?? false),
    creditsPerWeek: readNum(r, "creditsPerWeek", "credits_per_week"),
    weekUsedCredits: readNum(r, "weekUsedCredits", "week_used_credits") ?? 0,
    weekResetSeconds: readNum(r, "weekResetSeconds", "week_reset_seconds") ?? 0,
    creditsPer5h: readNum(r, "creditsPer5h", "credits_per_5h"),
    windowUsedCredits: readNum(r, "windowUsedCredits", "window_used_credits") ?? 0,
    windowResetSeconds:
      readNum(r, "windowResetSeconds", "window_reset_seconds") ?? 0,
    sessionWindowMinutes:
      readNum(r, "sessionWindowMinutes", "session_window_minutes") ?? 300,
    limitMode,
    fetchedAt: Date.now(),
  };
}

export function parseHostedModelsPayload(raw: unknown): RayuCloudModelEntry[] {
  const candidates: unknown[][] = [];
  if (Array.isArray(raw)) {
    candidates.push(raw);
  } else {
    const r = asRecord(raw);
    if (Array.isArray(r.hostedModels)) candidates.push(r.hostedModels);
    if (Array.isArray(r.allowedModels)) candidates.push(r.allowedModels);
    if (Array.isArray(r.models)) candidates.push(r.models);
    if (Array.isArray(r.data)) candidates.push(r.data);
  }

  for (const list of candidates) {
    const seen = new Set<string>();
    const entries: RayuCloudModelEntry[] = [];
    for (const item of list) {
      if (typeof item === "string") {
        const bare = item.trim().replace(/^rayu:/i, "").trim();
        if (!bare || seen.has(bare)) continue;
        seen.add(bare);
        entries.push({ code: bare });
        continue;
      }
      const obj = asRecord(item);
      const rawCode = readStr(obj, "code", "model", "id");
      if (!rawCode) continue;
      const bare = rawCode.replace(/^rayu:/i, "").trim();
      if (!bare || seen.has(bare)) continue;
      seen.add(bare);

      const label = readStr(obj, "label", "name") ?? undefined;
      const description = readStr(obj, "description") ?? undefined;
      const supportsEffort =
        typeof obj.supportsEffort === "boolean"
          ? obj.supportsEffort
          : typeof obj.supports_effort === "boolean"
            ? obj.supports_effort
            : typeof obj.supportsReasoning === "boolean"
              ? obj.supportsReasoning
              : typeof obj.supports_reasoning === "boolean"
                ? obj.supports_reasoning
                : undefined;
      const supportsFast =
        typeof obj.supportsFast === "boolean"
          ? obj.supportsFast
          : typeof obj.supports_fast === "boolean"
            ? obj.supports_fast
            : undefined;

      entries.push({
        code: bare,
        ...(label !== undefined ? { label } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(supportsEffort !== undefined ? { supportsEffort } : {}),
        ...(supportsFast !== undefined ? { supportsFast } : {}),
      });
    }
    if (entries.length > 0) {
      return entries;
    }
  }

  return [];
}

function buildUsageWindows(
  credits: RayuCloudCreditsSnapshot | null,
): AccountUsageWindowView[] {
  if (!credits) return [];
  const windows: AccountUsageWindowView[] = [];

  if (credits.creditsPer5h !== null && credits.creditsPer5h > 0) {
    const usedPct = Math.min(
      100,
      Math.max(0, Math.round((credits.windowUsedCredits / credits.creditsPer5h) * 100)),
    );
    const hours = Math.max(1, Math.round(credits.sessionWindowMinutes / 60));
    windows.push({
      label: `${hours}h session window`,
      usedPercent: usedPct,
      remainingPercent: Math.max(0, 100 - usedPct),
      resetCountdown:
        credits.windowResetSeconds > 0
          ? formatCountdown(credits.windowResetSeconds)
          : undefined,
    });
  }

  if (credits.creditsPerWeek !== null && credits.creditsPerWeek > 0) {
    const usedPct = Math.min(
      100,
      Math.max(0, Math.round((credits.weekUsedCredits / credits.creditsPerWeek) * 100)),
    );
    windows.push({
      label: "Weekly limit",
      usedPercent: usedPct,
      remainingPercent: Math.max(0, 100 - usedPct),
      resetCountdown:
        credits.weekResetSeconds > 0
          ? formatCountdown(credits.weekResetSeconds)
          : undefined,
    });
  }

  if (credits.creditsPerPeriod !== null && credits.creditsPerPeriod > 0) {
    const usedPct = Math.min(
      100,
      Math.max(0, Math.round((credits.usedCredits / credits.creditsPerPeriod) * 100)),
    );
    windows.push({
      label: "Monthly allowance",
      usedPercent: usedPct,
      remainingPercent: Math.max(0, 100 - usedPct),
      resetsAt: credits.periodEnd ?? undefined,
      resetCountdown:
        credits.resetSeconds > 0
          ? formatCountdown(credits.resetSeconds)
          : undefined,
    });
  }

  return windows;
}

export function buildRayuPlanLadder(
  signedIn: boolean,
  planCode?: string,
  planName?: string,
): NonNullable<AccountStatusView["planLadder"]> {
  const normalized = (planCode ?? planName ?? "")
    .toLowerCase()
    .replace(/^rayu[\s_-]*/, "")
    .replace(/[\s-]+/g, "_")
    .trim();

  const matches = (id: string): boolean => {
    if (!signedIn) return id === "free";
    if (!normalized) return false;
    if (normalized === id) return true;
    if (id === "team_max") return normalized.includes("team") && normalized.includes("max");
    if (id === "team_plus") return normalized.includes("team") && normalized.includes("plus");
    if (id === "team") return normalized === "team" || normalized === "team_starter";
    if (id === "max") return normalized === "max" && !normalized.includes("team");
    if (id === "plus") return normalized === "plus" && !normalized.includes("team");
    if (id === "pro") return normalized === "pro";
    if (id === "free") return normalized === "free";
    return false;
  };

  return [
    {
      id: "free",
      name: "Free",
      priceLabel: "$0",
      current: matches("free"),
      highlights: ["BYOK & local models", "Starter Rayu access"],
    },
    {
      id: "pro",
      name: "Pro",
      priceLabel: "$10/mo",
      current: matches("pro"),
      highlights: ["Rayu Gateway credits", "Fast hosted coding models"],
    },
    {
      id: "plus",
      name: "Plus",
      priceLabel: "$20/mo",
      current: matches("plus"),
      highlights: ["Higher monthly quota", "Priority Rayu Gateway routing"],
    },
    {
      id: "max",
      name: "Max",
      priceLabel: "$50/mo",
      current: matches("max"),
      highlights: ["Heavy Swarm & Overnight runs", "Highest personal credit pool"],
    },
    {
      id: "team",
      name: "Team",
      priceLabel: "$10/mo",
      current: matches("team"),
      highlights: ["Shared team workspace", "Centralized billing & seats"],
    },
    {
      id: "team_plus",
      name: "Team Plus",
      priceLabel: "$29/mo",
      current: matches("team_plus"),
      highlights: ["Expanded team quota", "Team API access & controls"],
    },
    {
      id: "team_max",
      name: "Team Max",
      priceLabel: "$79/mo",
      current: matches("team_max"),
      highlights: ["Maximum team capacity", "Enterprise-grade Swarm scale"],
    },
  ];
}

// ---------------------------------------------------------------------------
// File Persistence Helpers (0600 Owner-Only)
// ---------------------------------------------------------------------------

function hardenOwnerOnly(filePath: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore on filesystems that don't support chmod
  }
}

function readStoredSession(): StoredRayuSession | null {
  try {
    const raw = fs.readFileSync(getSessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredRayuSession>;
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
      user: parsed.user ?? {
        id: 0,
        email: null,
        displayName: null,
        avatarUrl: null,
        role: "user",
      },
    };
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredRayuSession): void {
  const dir = resolveRayuAuthDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = getSessionFilePath();
  // Match Rust / rayu-cli JSON.stringify(session, null, 2)
  const content = JSON.stringify(session, null, 2);
  fs.writeFileSync(target, content, { mode: 0o600 });
  hardenOwnerOnly(target);
}

function readApiKeyFromEnvFile(envPath: string): string | null {
  try {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (line.startsWith("RAYU_API_KEY=")) {
        const val = line
          .slice("RAYU_API_KEY=".length)
          .trim()
          .replace(/^['"]|['"]$/g, "")
          .trim();
        if (val.startsWith(KEY_PREFIX)) return val;
      }
    }
  } catch {
    // absent or unreadable
  }
  return null;
}

function readConfiguredApiKey(): string | null {
  const envVal = process.env.RAYU_API_KEY?.trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
  if (envVal && envVal.startsWith(KEY_PREFIX)) return envVal;

  for (const envPath of getAllApiKeyEnvPaths()) {
    const found = readApiKeyFromEnvFile(envPath);
    if (found) return found;
  }
  return null;
}

function saveApiKeyToEnvFile(key: string): string {
  const dir = resolveRayuAppConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const envPath = path.join(dir, ENV_FILE);
  let lines: string[];
  try {
    lines = fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0 && !line.startsWith("RAYU_API_KEY="));
  } catch {
    lines = [];
  }
  lines.push(`RAYU_API_KEY=${key}`);
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  hardenOwnerOnly(envPath);
  return envPath;
}

function clearApiKeyFromEnvFiles(): void {
  for (const envPath of getAllApiKeyEnvPaths()) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const lines = fs
        .readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0 && !line.startsWith("RAYU_API_KEY="));
      const nextContent = lines.length > 0 ? `${lines.join("\n")}\n` : "";
      fs.writeFileSync(envPath, nextContent, { mode: 0o600 });
      hardenOwnerOnly(envPath);
    } catch {
      // best-effort cleanup
    }
  }
}

function purgeRayuAccountCaches(): void {
  const authDir = resolveRayuAuthDir();
  for (const fileName of ACCOUNT_CACHE_FILES) {
    try {
      fs.unlinkSync(path.join(authDir, fileName));
    } catch {
      // ignore if absent
    }
  }

  const cacheDir = path.join(authDir, "cache");
  try {
    const entries = fs.readdirSync(cacheDir);
    for (const name of entries) {
      if (name.startsWith("rayu_models_") && name.endsWith(".json")) {
        try {
          fs.unlinkSync(path.join(cacheDir, name));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // cache dir absent
  }
}

function renderLoopbackHtml(ok: boolean, message: string, dashboardUrl: string): string {
  const accent = ok ? "#3DBD84" : "#E5534B";
  const heading = ok ? "Signed in to RayuCode" : "RayuCode sign-in failed";
  const safeMsg = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeDash = dashboardUrl.replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${heading}</title>
  </head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#11110E;color:#ECEAE3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <div style="background:#161613;border:1px solid #2A2924;border-radius:14px;padding:28px 32px;max-width:420px;text-align:center">
      <h2 style="margin:0 0 8px;color:${accent}">${heading}</h2>
      <p style="margin:0 0 16px;color:#D4D0C5;font-size:14px;line-height:1.5">${safeMsg}</p>
      <a href="${safeDash}" style="color:#5FD19C;font-size:13px;text-decoration:none">Open RayuCode Dashboard</a>
    </div>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// RayuHostAuthManager
// ---------------------------------------------------------------------------

export class RayuHostAuthManager extends EventEmitter {
  private readonly daemonBridge?: RayuHostAuthDaemonBridge;
  private readonly loginTimeoutMs: number;
  private pendingSignIn: PendingSignInState | null = null;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight: Promise<string | null> | null = null;
  private cachedCredits: RayuCloudCreditsSnapshot | null = null;
  private hostedCatalog: { key: string; models: RayuCloudModelEntry[]; fetchedAt: number; stale: boolean } | undefined;
  private hostedCatalogRequest = 0;
  private hostedCatalogInFlight = new Map<
    string,
    Promise<{
      models: RayuCloudModelEntry[];
      status: "fresh" | "cached" | "stale" | "failed" | "unavailable";
    }>
  >();
  private lastError: string | null = null;
  private watchers: fs.FSWatcher[] = [];
  private watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSelfWriteAt = 0;
  private disposed = false;

  constructor(options: RayuHostAuthManagerOptions = {}) {
    super();
    this.daemonBridge = options.daemonBridge;
    this.loginTimeoutMs = options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
    if (options.watch) {
      this.startWatching();
    }
  }

  private markSelfWrite(): void {
    this.lastSelfWriteAt = Date.now();
  }

  private resolveCurrentAuth(): {
    method: RayuAuthMethod;
    session: StoredRayuSession | null;
    apiKey: string | null;
  } {
    const session = readStoredSession();
    const hasOAuth = Boolean(
      session?.accessToken &&
        (Date.now() < session.expiresAt - REFRESH_SKEW_MS ||
          Boolean(session.refreshToken)),
    );
    if (hasOAuth && session) {
      return { method: "oauth", session, apiKey: null };
    }
    const apiKey = readConfiguredApiKey();
    if (apiKey) {
      return { method: "apiKey", session: null, apiKey };
    }
    return { method: "none", session: null, apiKey: null };
  }

  /**
   * Synchronous token-free snapshot safe for immediate `host.init`,
   * `RayuAuthProvider`, and `rayucode.account.changed` broadcasts.
   */
  getAccountStatusSnapshot(): AccountStatusView {
    const { method, session } = this.resolveCurrentAuth();
    const signedIn = method !== "none";
    const credits = signedIn ? this.cachedCredits : null;
    const windows = buildUsageWindows(credits);
    const planLadder = buildRayuPlanLadder(
      signedIn,
      credits?.plan,
      credits?.planName,
    );

    const user = method === "oauth" ? session?.user ?? null : null;
    const displayName =
      user?.displayName?.trim() ||
      (method === "apiKey" ? "Rayu API Key" : undefined);
    const email = user?.email?.trim() || undefined;
    const avatarUrl = user?.avatarUrl?.trim() || undefined;
    const userId =
      user && user.id !== undefined && user.id !== null && String(user.id) !== "0"
        ? String(user.id)
        : undefined;
    const role = user?.role?.trim() || undefined;

    const bypassPacing =
      credits?.limitMode === "full_credits" || credits?.limitMode === "unlimited"
        ? true
        : credits?.limitMode === "gated"
          ? false
          : undefined;

    return {
      signedIn,
      authMethod: method,
      signingIn: Boolean(this.pendingSignIn),
      pendingAuthUrl: this.pendingSignIn?.authUrl ?? null,
      pendingMode: this.pendingSignIn?.mode ?? null,
      webBase: getRayuWebBase(),
      error: this.lastError,
      ...(userId ? { userId } : {}),
      ...(role ? { role } : {}),
      ...(displayName ? { displayName } : {}),
      ...(email ? { email } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(credits?.planName ? { planName: credits.planName } : {}),
      ...(credits?.remainingCredits !== null &&
      credits?.remainingCredits !== undefined
        ? { creditsRemaining: credits.remainingCredits }
        : {}),
      ...(credits?.creditsPerPeriod !== null &&
      credits?.creditsPerPeriod !== undefined
        ? { creditsPerPeriod: credits.creditsPerPeriod }
        : {}),
      ...(credits ? { usedCredits: credits.usedCredits } : {}),
      ...(credits ? { topUpBalance: credits.topupBalance } : {}),
      ...(credits ? { topUpEnabled: credits.topUpEnabled } : {}),
      ...(credits && credits.resetSeconds > 0
        ? { resetSeconds: credits.resetSeconds }
        : {}),
      ...(credits?.periodEnd ? { periodEnd: credits.periodEnd } : {}),
      ...(bypassPacing !== undefined ? { bypassPacing } : {}),
      windows,
      planLadder,
    };
  }

  private emitAuthChanged(): AccountStatusView {
    const snapshot = this.getAccountStatusSnapshot();
    this.emit("authChanged", snapshot);
    return snapshot;
  }

  private async notifyDaemonAuthChangedBestEffort(): Promise<void> {
    try {
      await this.daemonBridge?.notifyAuthChanged?.("rayu");
    } catch {
      // daemon may be offline
    }
  }

  // -------------------------------------------------------------------------
  // Token Management & Refresh
  // -------------------------------------------------------------------------

  async getValidAccessToken(): Promise<string | null> {
    const session = readStoredSession();
    if (!session?.accessToken) return null;
    if (Date.now() < session.expiresAt - REFRESH_SKEW_MS) {
      return session.accessToken;
    }
    return this.refreshAccessToken(session.accessToken);
  }

  async refreshAccessToken(staleToken?: string): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const session = readStoredSession();
      if (!session?.refreshToken) return null;
      if (
        staleToken &&
        session.accessToken !== staleToken &&
        Date.now() < session.expiresAt - REFRESH_SKEW_MS
      ) {
        return session.accessToken;
      }

      try {
        const res = await fetch(`${getRayuApiBase()}/cli/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
          redirect: "manual",
        });
        if (!res.ok) {
          if (res.status === 400 || res.status === 401) {
            const latest = readStoredSession();
            if (latest?.refreshToken === session.refreshToken) {
              this.markSelfWrite();
              try {
                fs.unlinkSync(getSessionFilePath());
              } catch {
                // ignore
              }
            }
          }
          return null;
        }
        const data = (await res.json()) as {
          accessToken?: string;
          refreshToken?: string;
          expiresAt?: number;
        };
        if (!data.accessToken) return null;

        const latest = readStoredSession();
        if (!latest || latest.refreshToken !== session.refreshToken) {
          return latest?.accessToken ?? data.accessToken;
        }
        const updated: StoredRayuSession = {
          ...latest,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? latest.refreshToken,
          expiresAt: data.expiresAt ?? latest.expiresAt,
        };
        this.markSelfWrite();
        writeStoredSession(updated);
        return updated.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  private async getGatewayCredential(): Promise<{
    token: string;
    isOAuth: boolean;
  } | null> {
    const jwt = await this.getValidAccessToken();
    if (jwt) return { token: jwt, isOAuth: true };
    const apiKey = readConfiguredApiKey();
    if (apiKey) return { token: apiKey, isOAuth: false };
    return null;
  }

  // -------------------------------------------------------------------------
  // Live Account Status, Credits & Entitled Models
  // -------------------------------------------------------------------------

  private async fetchHostedModelsWithCredential(cred: {
    token: string;
    isOAuth: boolean;
  }): Promise<RayuCloudModelEntry[] | null> {
    const fetchAndParse = async (url: string): Promise<RayuCloudModelEntry[] | null> => {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${cred.token}` },
          redirect: "manual",
        });
        if (!res.ok) return null;
        const raw: unknown = await res.json();
        const record = asRecord(raw);
        const lists = [raw, record.hostedModels, record.allowedModels, record.models, record.data].filter(Array.isArray);
        const models = parseHostedModelsPayload(raw);
        return models.length > 0 || (lists.length > 0 && lists.every((list) => list.length === 0)) ? models : null;
      } catch {
        return null;
      }
    };
    if (cred.isOAuth) {
      const entitlements = await fetchAndParse(`${getRayuApiBase()}/me/entitlements`);
      if (entitlements?.length) return entitlements;
    }
    return fetchAndParse(`${getRayuGatewayBase()}/v1/models`);
  }

  private hostedCatalogKey(): string | undefined {
    const auth = this.resolveCurrentAuth();
    if (auth.method === "none") return undefined;
    const rawUserId = auth.session?.user?.id;
    const validUserId =
      rawUserId !== undefined &&
      rawUserId !== null &&
      String(rawUserId).trim() !== "" &&
      String(rawUserId) !== "0"
        ? String(rawUserId)
        : undefined;
    const identity =
      auth.method === "oauth"
        ? (validUserId ??
          auth.session?.user?.email?.trim() ??
          auth.session?.refreshToken ??
          auth.session?.accessToken ??
          "")
        : (auth.apiKey ?? "");
    const fingerprint = createHash("sha256").update(identity).digest("hex");
    return JSON.stringify([getRayuApiBase(), getRayuGatewayBase(), auth.method, fingerprint]);
  }

  private resetHostedCatalogState(): void {
    this.hostedCatalog = undefined;
    this.hostedCatalogRequest += 1;
    this.hostedCatalogInFlight.clear();
  }

  getCachedHostedModels(): RayuCloudModelEntry[] {
    const cached = this.hostedCatalog;
    return cached && cached.key === this.hostedCatalogKey() ? [...cached.models] : [];
  }

  async getHostedModelCatalog(forceRefresh = false): Promise<{
    models: RayuCloudModelEntry[];
    status: "fresh" | "cached" | "stale" | "failed" | "unavailable";
  }> {
    const key = this.hostedCatalogKey();
    if (!key) return { models: [], status: "unavailable" };
    const cached = this.hostedCatalog?.key === key ? this.hostedCatalog : undefined;
    if (!forceRefresh && cached && !cached.stale && Date.now() - cached.fetchedAt < MODELS_STALE_MS) {
      return { models: [...cached.models], status: "cached" };
    }

    const inFlightKey = `${key}::${forceRefresh}`;
    const existing = this.hostedCatalogInFlight.get(inFlightKey);
    if (existing) {
      return existing.then((res) => ({ ...res, models: [...res.models] }));
    }

    const request = ++this.hostedCatalogRequest;
    const run = (async (): Promise<{
      models: RayuCloudModelEntry[];
      status: "fresh" | "cached" | "stale" | "failed" | "unavailable";
    }> => {
      const auth = this.resolveCurrentAuth();
      const credential = await this.getGatewayCredential();
      const models =
        credential && credential.isOAuth === (auth.method === "oauth")
          ? await this.fetchHostedModelsWithCredential(credential)
          : null;

      if (key !== this.hostedCatalogKey()) {
        return { models: [], status: "unavailable" };
      }
      if (request !== this.hostedCatalogRequest) {
        const current = this.hostedCatalog?.key === key ? this.hostedCatalog : undefined;
        if (current) {
          return {
            models: [...current.models],
            status: current.stale ? "stale" : "cached",
          };
        }
        return { models: [], status: "failed" };
      }
      if (models !== null) {
        this.hostedCatalog = { key, models, fetchedAt: Date.now(), stale: false };
        return { models: [...models], status: "fresh" };
      }
      const fallbackCached = this.hostedCatalog?.key === key ? this.hostedCatalog : cached;
      if (fallbackCached) {
        this.hostedCatalog = { ...fallbackCached, stale: true };
        return { models: [...fallbackCached.models], status: "stale" };
      }
      return { models: [], status: "failed" };
    })().finally(() => {
      if (this.hostedCatalogInFlight.get(inFlightKey) === run) {
        this.hostedCatalogInFlight.delete(inFlightKey);
      }
    });

    this.hostedCatalogInFlight.set(inFlightKey, run);
    return run.then((res) => ({ ...res, models: [...res.models] }));
  }

  async fetchHostedModels(forceRefresh = false): Promise<RayuCloudModelEntry[]> {
    return (await this.getHostedModelCatalog(forceRefresh)).models;
  }

  async getAccountStatus(forceRefresh = false): Promise<AccountStatusView> {
    const { method } = this.resolveCurrentAuth();
    if (method === "none") {
      this.cachedCredits = null;
      this.resetHostedCatalogState();
      return this.getAccountStatusSnapshot();
    }

    const isStale =
      !this.cachedCredits ||
      Date.now() - this.cachedCredits.fetchedAt > CREDITS_STALE_MS;
    if (!forceRefresh && !isStale) {
      return this.getAccountStatusSnapshot();
    }

    return this.refreshAccountDetails();
  }

  async refreshAccountDetails(): Promise<AccountStatusView> {
    this.lastError = null;
    const cred = await this.getGatewayCredential();
    if (!cred) {
      if (this.resolveCurrentAuth().method === "none") this.cachedCredits = null;
      await this.getHostedModelCatalog(true);
      return this.emitAuthChanged();
    }

    const [meResult, creditsResult] = await Promise.allSettled([
      cred.isOAuth
        ? fetch(`${getRayuApiBase()}/me`, {
            headers: { Authorization: `Bearer ${cred.token}` },
            redirect: "manual",
          })
        : Promise.resolve(null),
      fetch(`${getRayuGatewayBase()}/v1/credits`, {
        headers: { Authorization: `Bearer ${cred.token}` },
        redirect: "manual",
      }),
      this.getHostedModelCatalog(true),
    ]);

    if (meResult.status === "fulfilled" && meResult.value?.ok) {
      try {
        const body = (await meResult.value.json()) as {
          user?: RayuSessionUser;
        };
        const existing = readStoredSession();
        if (body.user && existing) {
          this.markSelfWrite();
          writeStoredSession({ ...existing, user: body.user });
        }
      } catch {
        // retain stored user
      }
    }

    if (creditsResult.status === "fulfilled" && creditsResult.value.ok) {
      try {
        const raw = await creditsResult.value.json();
        const parsed = parseCreditsPayload(raw);
        if (parsed) {
          this.cachedCredits = parsed;
        }
      } catch {
        // retain last good credits
      }
    }

    return this.emitAuthChanged();
  }

  // -------------------------------------------------------------------------
  // Browser OAuth Sign-In (VS Code Deep-Link + Loopback Fallback)
  // -------------------------------------------------------------------------

  private cleanupPendingSignIn(): void {
    if (this.loginTimer) {
      clearTimeout(this.loginTimer);
      this.loginTimer = null;
    }
    const server = this.pendingSignIn?.server;
    this.pendingSignIn = null;
    if (server) {
      try {
        server.close();
      } catch {
        // ignore
      }
    }
  }

  private armLoginTimer(): void {
    if (this.loginTimer) {
      clearTimeout(this.loginTimer);
    }
    this.loginTimer = setTimeout(() => {
      if (!this.pendingSignIn) return;
      this.lastError = "Rayu Cloud sign-in timed out after 5 minutes.";
      this.cleanupPendingSignIn();
      this.emitAuthChanged();
    }, this.loginTimeoutMs);
    this.loginTimer.unref?.();
  }

  async startBrowserSignIn(mode: RayuSignInMode = "vscode"): Promise<{
    ok: boolean;
    authUrl: string;
    state: AccountStatusView;
  }> {
    this.cleanupPendingSignIn();
    this.lastError = null;
    const expectedState = randomBytes(16).toString("hex");

    if (mode === "vscode") {
      const authUrl = buildVscodeLoginUrl(getRayuWebBase(), expectedState);
      this.pendingSignIn = {
        mode: "vscode",
        state: expectedState,
        authUrl,
        createdAt: Date.now(),
      };
      this.armLoginTimer();
      const snapshot = this.emitAuthChanged();
      return { ok: true, authUrl, state: snapshot };
    }

    // Loopback fallback (`127.0.0.1:0` -> `/cli-login?port=...&state=...` -> `POST /cli/token`)
    const server = http.createServer((req, res) => {
      const reqPath = req.url ?? "/";
      let parsed: URL;
      try {
        parsed = new URL(`http://127.0.0.1${reqPath}`);
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad request");
        return;
      }

      const code = parsed.searchParams.get("code")?.trim() ?? "";
      const state = parsed.searchParams.get("state")?.trim() ?? "";

      if (!code) {
        res.writeHead(204);
        res.end();
        return;
      }

      const dashboardUrl = `${getRayuWebBase()}/dashboard`;

      if (state !== expectedState) {
        this.lastError = "OAuth state mismatch. Please try signing in again.";
        this.cleanupPendingSignIn();
        this.emitAuthChanged();
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          renderLoopbackHtml(
            false,
            "Invalid OAuth state parameter. Return to VS Code and start a fresh sign-in.",
            dashboardUrl,
          ),
        );
        return;
      }

      void this.exchangeCode("/cli/token", code, state)
        .then(async () => {
          this.cleanupPendingSignIn();
          await this.notifyDaemonAuthChangedBestEffort();
          await this.refreshAccountDetails();
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            renderLoopbackHtml(
              true,
              "You can close this tab and return to RayuCode in VS Code.",
              dashboardUrl,
            ),
          );
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Rayu Cloud sign-in failed.";
          this.lastError = message;
          this.cleanupPendingSignIn();
          this.emitAuthChanged();
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderLoopbackHtml(false, message, dashboardUrl));
        });
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", (err) => {
        this.lastError = `Could not start local auth callback server: ${err.message}`;
        reject(new Error(this.lastError));
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          server.close();
          reject(new Error("Could not determine local auth callback port."));
          return;
        }
        resolve(addr.port);
      });
    });

    const authUrl = buildCliLoginUrl(getRayuWebBase(), port, expectedState);
    this.pendingSignIn = {
      mode: "loopback",
      state: expectedState,
      authUrl,
      createdAt: Date.now(),
      server,
    };
    this.armLoginTimer();
    const snapshot = this.emitAuthChanged();
    return { ok: true, authUrl, state: snapshot };
  }

  /**
   * Handle `vscode://rayucode.rayucode/auth?code=...&state=...` URI callback.
   */
  async handleUriCallback(
    uriInput: string | { toString(skipEncoding?: boolean): string },
  ): Promise<AccountStatusView> {
    this.lastError = null;
    const rawUri =
      typeof uriInput === "string" ? uriInput : uriInput.toString(true);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUri);
    } catch {
      throw new Error("Malformed Rayu authentication callback URI.");
    }

    const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "").toLowerCase();
    if (normalizedPath !== "/auth") {
      throw new Error(`Unsupported Rayu callback path: ${parsedUrl.pathname}`);
    }

    const { code, state } = parseAuthCallbackUrl(rawUri);

    if (!this.pendingSignIn) {
      const errMsg =
        "No active Rayu sign-in session. Start a new sign-in from RayuCode.";
      this.lastError = errMsg;
      this.emitAuthChanged();
      throw new Error(errMsg);
    }

    if (state !== this.pendingSignIn.state) {
      const errMsg = "OAuth state mismatch. Please try signing in again.";
      this.lastError = errMsg;
      this.cleanupPendingSignIn();
      this.emitAuthChanged();
      throw new Error(errMsg);
    }

    try {
      await this.exchangeCode("/vscode/token", code, state);
      this.cleanupPendingSignIn();
      await this.notifyDaemonAuthChangedBestEffort();
      return await this.refreshAccountDetails();
    } catch (err) {
      this.lastError =
        err instanceof Error ? err.message : "Rayu Cloud token exchange failed.";
      this.cleanupPendingSignIn();
      this.emitAuthChanged();
      throw err instanceof Error ? err : new Error(this.lastError);
    }
  }

  /**
   * Handle manual callback URL paste (either `vscode://rayucode.rayucode/auth?...`
   * OR `http://127.0.0.1:<port>/callback?...`).
   */
  async completeManualCallback(rawUrl: string): Promise<AccountStatusView> {
    this.lastError = null;
    const { code, state, mode } = parseAuthCallbackUrl(rawUrl);

    if (this.pendingSignIn && state !== this.pendingSignIn.state) {
      const errMsg =
        "Callback state does not match this sign-in session. Copy a fresh sign-in link and try again.";
      this.lastError = errMsg;
      this.emitAuthChanged();
      throw new Error(errMsg);
    }

    const effectiveMode: RayuSignInMode =
      mode ?? this.pendingSignIn?.mode ?? "vscode";
    const endpoint =
      effectiveMode === "loopback" ? "/cli/token" : "/vscode/token";

    try {
      await this.exchangeCode(endpoint, code, state);
      this.cleanupPendingSignIn();
      await this.notifyDaemonAuthChangedBestEffort();
      return await this.refreshAccountDetails();
    } catch (err) {
      this.lastError =
        err instanceof Error ? err.message : "Rayu Cloud token exchange failed.";
      this.emitAuthChanged();
      throw err instanceof Error ? err : new Error(this.lastError);
    }
  }

  cancelSignIn(): AccountStatusView {
    this.cleanupPendingSignIn();
    return this.emitAuthChanged();
  }

  private async exchangeCode(
    endpoint: "/vscode/token" | "/cli/token",
    code: string,
    state: string,
  ): Promise<StoredRayuSession> {
    const res = await fetch(`${getRayuApiBase()}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
      redirect: "manual",
    });
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = (await res.json()) as { message?: string; error?: string };
        detail = errBody.message || errBody.error || "";
      } catch {
        // ignore parse failure
      }
      throw new Error(
        `Rayu Cloud token exchange failed (HTTP ${res.status})${detail ? `: ${detail}` : "."}`,
      );
    }
    const payload = (await res.json()) as Partial<StoredRayuSession>;
    if (typeof payload.accessToken !== "string" || !payload.accessToken) {
      throw new Error("Rayu Cloud returned an empty access token.");
    }
    const session: StoredRayuSession = {
      accessToken: payload.accessToken,
      refreshToken:
        typeof payload.refreshToken === "string" ? payload.refreshToken : "",
      expiresAt:
        typeof payload.expiresAt === "number"
          ? payload.expiresAt
          : Date.now() + 3_600_000,
      user: payload.user ?? {
        id: 0,
        email: null,
        displayName: null,
        avatarUrl: null,
        role: "user",
      },
    };
    this.markSelfWrite();
    writeStoredSession(session);
    this.resetHostedCatalogState();
    return session;
  }

  // -------------------------------------------------------------------------
  // API Key Sign-In, Pacing Mode & Sign-Out
  // -------------------------------------------------------------------------

  async signInWithApiKey(rawKey: string): Promise<AccountStatusView> {
    this.lastError = null;
    const key = rawKey
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .trim();
    if (!key.startsWith(KEY_PREFIX)) {
      throw new Error(`Rayu API keys must start with '${KEY_PREFIX}'.`);
    }

    const res = await fetch(`${getRayuGatewayBase()}/v1/credits`, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "manual",
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Invalid or revoked Rayu API key (HTTP ${res.status}). Check your key and try again.`,
      );
    }
    if (!res.ok) {
      throw new Error(`Could not verify Rayu API key (HTTP ${res.status}).`);
    }

    try {
      const creditsPayload = await res.json();
      const parsed = parseCreditsPayload(creditsPayload);
      if (parsed) {
        this.cachedCredits = parsed;
      }
    } catch {
      // credits will be re-fetched below
    }

    this.markSelfWrite();
    saveApiKeyToEnvFile(key);
    process.env.RAYU_API_KEY = key;
    this.resetHostedCatalogState();

    try {
      await this.daemonBridge?.setApiKey?.("rayu", key);
    } catch {
      // daemon may be offline
    }
    await this.notifyDaemonAuthChangedBestEffort();

    return this.emitAuthChanged();
  }

  async setBypassPacing(
    enabled: boolean,
  ): Promise<{ ok: boolean; enabled: boolean }> {
    const jwt = await this.getValidAccessToken();
    if (!jwt) {
      throw new Error(
        "Bypass pacing requires an active Rayu account (OAuth) sign-in.",
      );
    }

    const limitMode = enabled ? "full_credits" : "gated";
    const res = await fetch(`${getRayuApiBase()}/billing/limit-mode`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limitMode }),
      redirect: "manual",
    });

    if (!res.ok) {
      let detail = "";
      try {
        const errBody = (await res.json()) as { message?: string; error?: string };
        detail = errBody.message || errBody.error || "";
      } catch {
        // ignore
      }
      throw new Error(
        `Failed to update pacing mode (HTTP ${res.status})${detail ? `: ${detail}` : "."}`,
      );
    }

    if (this.cachedCredits) {
      this.cachedCredits = {
        ...this.cachedCredits,
        limitMode,
      };
    }
    this.emitAuthChanged();
    return { ok: true, enabled };
  }

  async clearSavedApiKeyOnly(): Promise<AccountStatusView> {
    this.markSelfWrite();
    clearApiKeyFromEnvFiles();
    delete process.env.RAYU_API_KEY;
    try {
      fs.unlinkSync(path.join(resolveRayuAuthDir(), "rayu-apikey-state.json"));
    } catch {
      // ignore
    }
    try {
      await this.daemonBridge?.clearApiKey?.("rayu");
    } catch {
      // daemon may be offline
    }
    await this.notifyDaemonAuthChangedBestEffort();
    if (this.resolveCurrentAuth().method === "none") {
      this.cachedCredits = null;
      this.resetHostedCatalogState();
    }
    return this.emitAuthChanged();
  }

  async signOut(): Promise<AccountStatusView> {
    this.cleanupPendingSignIn();
    this.markSelfWrite();

    try {
      fs.unlinkSync(getSessionFilePath());
    } catch {
      // ignore if absent
    }
    clearApiKeyFromEnvFiles();
    delete process.env.RAYU_API_KEY;
    purgeRayuAccountCaches();

    this.cachedCredits = null;
    this.resetHostedCatalogState();
    this.lastError = null;

    // Best-effort daemon sync — sign-out MUST succeed even when daemon is offline!
    await Promise.allSettled([
      this.daemonBridge?.clearApiKey?.("rayu"),
      this.daemonBridge?.logoutProvider?.("rayu"),
      this.daemonBridge?.notifyAuthChanged?.("rayu"),
    ]);

    return this.emitAuthChanged();
  }

  // -------------------------------------------------------------------------
  // External Sync Watcher (CLI / Desktop <-> VS Code)
  // -------------------------------------------------------------------------

  startWatching(): void {
    if (this.disposed || this.watchers.length > 0) return;

    const dirs = new Set<string>([
      resolveRayuAuthDir(),
      resolveRayuAppConfigDir(),
    ]);

    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        const watcher = fs.watch(dir, (_eventType, filename) => {
          if (this.disposed) return;
          if (Date.now() - this.lastSelfWriteAt < SELF_WRITE_SUPPRESS_MS) {
            return;
          }
          const name = filename ? String(filename) : "";
          if (name && name !== SESSION_FILE && name !== ENV_FILE) {
            return;
          }
          this.scheduleExternalSync();
        });
        watcher.on("error", () => {
          // ignore watcher errors on ephemeral dirs
        });
        watcher.unref?.();
        this.watchers.push(watcher);
      } catch {
        // ignore if directory cannot be watched
      }
    }
  }

  private scheduleExternalSync(): void {
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
    }
    this.watchDebounceTimer = setTimeout(() => {
      this.watchDebounceTimer = null;
      if (this.disposed) return;
      void this.refreshAccountDetails().catch(() => {
        this.emitAuthChanged();
      });
    }, WATCH_DEBOUNCE_MS);
    this.watchDebounceTimer.unref?.();
  }

  stopWatching(): void {
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    this.watchers = [];
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatching();
    this.cleanupPendingSignIn();
    this.resetHostedCatalogState();
    this.removeAllListeners();
  }
}
