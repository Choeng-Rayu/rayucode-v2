import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";

export const DEFAULT_GITHUB_REPO = "Choeng-Rayu/rayucode-v2";
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_TIMEOUT_MS = 120 * 1000;
const METADATA_TIMEOUT_MS = 15 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export interface ReleaseTarget {
  platform: NodeJS.Platform;
  arch: string;
  assetName: string;
  binaryName: string;
  archiveFormat: "tar.gz" | "exe";
  fallbackAssetName?: string;
  fallbackArchiveFormat?: "tar.gz" | "exe";
}

export interface ManagedBinaryInfo {
  version: string;
  binaryPath: string;
  installedAt: string;
  extensionVersion?: string;
  assetName: string;
  sha256: string;
}

export interface InstallerState {
  lastCheckedAt: string;
  lastExtensionVersion?: string;
  lastKnownLatestVersion?: string;
  lastError?: string;
}

export type InstallProgressPhase =
  | "checking"
  | "downloading"
  | "verifying"
  | "extracting"
  | "installing"
  | "up_to_date"
  | "ready";

export interface InstallProgressEvent {
  phase: InstallProgressPhase;
  version?: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  message: string;
}

export type FetchLike = typeof fetch;

export interface InstallerOptions {
  storageDir: string;
  extensionVersion?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  repo?: string;
  force?: boolean;
  checkIntervalMs?: number;
  fetchImpl?: FetchLike;
  onProgress?: (event: InstallProgressEvent) => void;
}

export interface EnsureBinaryResult {
  binaryPath: string;
  version: string;
  updated: boolean;
  source: "managed-cached" | "managed-downloaded" | "managed-updated";
}

export interface UpdateCheckResult {
  checked: boolean;
  updated: boolean;
  currentVersion?: string;
  latestVersion?: string;
  binaryPath?: string;
  error?: string;
}

const TARGET_MAP: Record<string, Omit<ReleaseTarget, "platform" | "arch">> = {
  "linux:x64": {
    assetName: "rayu-linux-x86_64.tar.gz",
    binaryName: "rayu-linux-x86_64",
    archiveFormat: "tar.gz",
  },
  "linux:arm64": {
    assetName: "rayu-linux-aarch64.tar.gz",
    binaryName: "rayu-linux-aarch64",
    archiveFormat: "tar.gz",
  },
  "darwin:arm64": {
    assetName: "rayu-macos-aarch64.tar.gz",
    binaryName: "rayu-macos-aarch64",
    archiveFormat: "tar.gz",
  },
  "darwin:x64": {
    assetName: "rayu-macos-x86_64.tar.gz",
    binaryName: "rayu-macos-x86_64",
    archiveFormat: "tar.gz",
  },
  "win32:x64": {
    assetName: "rayu-windows-x86_64.tar.gz",
    binaryName: "rayu-windows-x86_64.exe",
    archiveFormat: "tar.gz",
    fallbackAssetName: "rayu-windows-x86_64.exe",
    fallbackArchiveFormat: "exe",
  },
  "win32:arm64": {
    assetName: "rayu-windows-aarch64.tar.gz",
    binaryName: "rayu-windows-aarch64.exe",
    archiveFormat: "tar.gz",
    fallbackAssetName: "rayu-windows-aarch64.exe",
    fallbackArchiveFormat: "exe",
  },
};

export function resolveReleaseTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ReleaseTarget | null {
  const entry = TARGET_MAP[`${platform}:${arch}`];
  if (!entry) return null;
  return { platform, arch, ...entry };
}

const RELEASE_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function isValidReleaseTag(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return false;
  }
  return RELEASE_TAG_RE.test(trimmed);
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(raw: string): ParsedSemver | null {
  const stripped = raw.trim().replace(/^v/i, "").split("+")[0] ?? "";
  const dashIdx = stripped.indexOf("-");
  const core = dashIdx === -1 ? stripped : stripped.slice(0, dashIdx);
  const pre = dashIdx === -1 ? "" : stripped.slice(dashIdx + 1);
  const parts = core.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n, idx) => !Number.isFinite(n) || n < 0 || String(n) !== parts[idx])) {
    return null;
  }
  return {
    major: nums[0],
    minor: nums[1],
    patch: nums[2],
    prerelease: pre ? pre.split(".") : [],
  };
}

/**
 * Compare two release version tags (`a` vs `b`).
 * Returns 1 if `a > b`, -1 if `a < b`, 0 if equivalent.
 */
export function compareReleaseVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    const na = a.trim().replace(/^v/i, "");
    const nb = b.trim().replace(/^v/i, "");
    if (na === nb) return 0;
    return na > nb ? 1 : -1;
  }
  for (const [va, vb] of [
    [pa.major, pb.major],
    [pa.minor, pb.minor],
    [pa.patch, pb.patch],
  ] as const) {
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const maxLen = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < maxLen; i += 1) {
    const sa = pa.prerelease[i];
    const sb = pb.prerelease[i];
    if (sa === undefined) return -1;
    if (sb === undefined) return 1;
    const isNumA = /^\d+$/.test(sa);
    const isNumB = /^\d+$/.test(sb);
    if (isNumA && isNumB) {
      const na = Number.parseInt(sa, 10);
      const nb = Number.parseInt(sb, 10);
      if (na !== nb) return na > nb ? 1 : -1;
    } else if (isNumA !== isNumB) {
      return isNumA ? -1 : 1;
    } else if (sa !== sb) {
      return sa > sb ? 1 : -1;
    }
  }
  return 0;
}

export function parseSha256Sums(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([0-9a-fA-F]{64})\s+[*]?(.+)$/.exec(line);
    if (!match) continue;
    const hash = match[1].toLowerCase();
    const file = match[2].trim().replace(/^\.\//, "");
    const base = path.posix.basename(file);
    map.set(file, hash);
    if (!map.has(base)) map.set(base, hash);
  }
  return map;
}

export async function computeSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex").toLowerCase();
}

function readTarOctalOrBase256(buf: Buffer, offset: number, length: number): number {
  const slice = buf.subarray(offset, offset + length);
  if ((slice[0] & 0x80) !== 0) {
    let val = 0n;
    for (let i = 1; i < slice.length; i += 1) {
      val = (val << 8n) | BigInt(slice[i]);
    }
    return Number(val);
  }
  const str = slice.toString("ascii").replace(/\0.*$/, "").trim();
  if (!str) return 0;
  const parsed = Number.parseInt(str, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readNullTerminatedUtf8(buf: Buffer, offset: number, length: number): string {
  const end = buf.indexOf(0, offset);
  const limit = end !== -1 && end < offset + length ? end : offset + length;
  return buf.subarray(offset, limit).toString("utf8");
}

function parsePaxPath(payload: Buffer): string | undefined {
  const text = payload.toString("utf8");
  let idx = 0;
  while (idx < text.length) {
    const space = text.indexOf(" ", idx);
    if (space === -1) break;
    const len = Number.parseInt(text.slice(idx, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(space + 1, idx + len).replace(/\n$/, "");
    const eq = record.indexOf("=");
    if (eq !== -1 && record.slice(0, eq) === "path") {
      return record.slice(eq + 1);
    }
    idx += len;
  }
  return undefined;
}

function normalizeArchiveEntryPath(rawPath: string): string | null {
  const cleaned = rawPath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!cleaned) return null;
  const segments = cleaned.split("/");
  if (segments.some((seg) => seg === "..")) return null;
  return cleaned;
}

function matchesExtractedBinary(entryPath: string, binaryName: string): boolean {
  const normalized = normalizeArchiveEntryPath(entryPath);
  if (!normalized) return false;
  const base = path.posix.basename(normalized);
  if (base === binaryName) return true;
  if (base === "rayu" || base === "rayu.exe") return true;
  return false;
}

function isCompanionRuntimeFile(entryPath: string, targetBinaryName: string): boolean {
  const normalized = normalizeArchiveEntryPath(entryPath);
  if (!normalized) return false;
  const base = path.posix.basename(normalized);
  if (base === `${targetBinaryName}.bin` || base === "rayu.bin") return true;
  if (/^lib(?:ssl|crypto)\.so(?:\..+)?$/.test(base)) return true;
  if (/\.(?:dll|dylib)$/i.test(base)) return true;
  return false;
}

/**
 * Pure-Node streaming extractor for `.tar.gz` archives containing the Rayu binary
 * and any required runtime companions (e.g. portable wrapper `.bin`, OpenSSL `.so` libs).
 * Handles ustar `prefix`, GNU LongName (`L`), and PAX extended (`x`) headers.
 */
export async function extractBinaryFromTarGz(
  archivePath: string,
  targetBinaryName: string,
  destPath: string,
): Promise<void> {
  const destDir = path.dirname(destPath);
  const stageDir = `${destPath}.stage.${process.pid}.${Date.now()}`;
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const source = fs.createReadStream(archivePath);
  const gunzip = zlib.createGunzip();
  source.on("error", (err) => gunzip.destroy(err));
  source.pipe(gunzip);

  let mode: "header" | "payload" | "padding" = "header";
  let buf = Buffer.alloc(0);
  let pendingLongName: string | undefined;
  let pendingPaxPath: string | undefined;
  let currentType = "0";
  let remainingPayload = 0;
  let remainingPadding = 0;
  let collectChunks: Buffer[] | null = null;
  let outFd: number | null = null;
  let currentStageName: string | null = null;
  let currentIsPrimary = false;
  let primaryStagePath: string | null = null;
  const companionStageFiles: Array<{ src: string; destName: string }> = [];

  const consume = (needed: number): Buffer | null => {
    if (buf.length < needed) return null;
    const slice = buf.subarray(0, needed);
    buf = buf.subarray(needed);
    return slice;
  };

  try {
    for await (const rawChunk of gunzip) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);

      while (buf.length > 0) {
        if (mode === "header") {
          const header = consume(512);
          if (!header) break;
          if (header.every((b) => b === 0)) {
            buf = Buffer.alloc(0);
            break;
          }

          const rawType = header[156];
          currentType = rawType === 0 ? "0" : String.fromCharCode(rawType);
          const size = readTarOctalOrBase256(header, 124, 12);
          const name = readNullTerminatedUtf8(header, 0, 100);
          const magic = header.subarray(257, 263).toString("ascii");
          const prefix = magic.startsWith("ustar")
            ? readNullTerminatedUtf8(header, 345, 155)
            : "";

          const headerPath = prefix ? `${prefix}/${name}` : name;
          const fullName = pendingLongName ?? pendingPaxPath ?? headerPath;

          if (currentType === "L" || currentType === "x") {
            collectChunks = [];
          } else {
            pendingLongName = undefined;
            pendingPaxPath = undefined;
            if ((currentType === "0" || currentType === "\0") && size > 0) {
              if (matchesExtractedBinary(fullName, targetBinaryName)) {
                currentIsPrimary = true;
                currentStageName = path.basename(destPath);
                const stagePath = path.join(stageDir, currentStageName);
                outFd = fs.openSync(stagePath, "w", 0o755);
              } else if (isCompanionRuntimeFile(fullName, targetBinaryName)) {
                currentIsPrimary = false;
                const cleanName = path.posix.basename(
                  normalizeArchiveEntryPath(fullName) ?? "",
                );
                if (cleanName && !cleanName.includes("..")) {
                  currentStageName = cleanName;
                  const stagePath = path.join(stageDir, cleanName);
                  outFd = fs.openSync(stagePath, "w", 0o755);
                }
              }
            }
          }

          remainingPayload = size;
          remainingPadding = (512 - (size % 512)) % 512;
          if (remainingPayload > 0) {
            mode = "payload";
          } else if (remainingPadding > 0) {
            mode = "padding";
          } else {
            mode = "header";
          }
        } else if (mode === "payload") {
          const take = Math.min(buf.length, remainingPayload);
          const piece = consume(take);
          if (!piece) break;

          if (collectChunks) {
            collectChunks.push(Buffer.from(piece));
          } else if (outFd !== null) {
            fs.writeSync(outFd, piece);
          }

          remainingPayload -= take;
          if (remainingPayload === 0) {
            if (collectChunks) {
              const joined = Buffer.concat(collectChunks);
              if (currentType === "L") {
                pendingLongName = joined.toString("utf8").replace(/\0.*$/, "");
              } else if (currentType === "x") {
                pendingPaxPath = parsePaxPath(joined);
              }
              collectChunks = null;
            } else if (outFd !== null) {
              fs.closeSync(outFd);
              outFd = null;
              if (currentStageName) {
                const stagedFile = path.join(stageDir, currentStageName);
                if (currentIsPrimary) {
                  primaryStagePath = stagedFile;
                } else {
                  companionStageFiles.push({
                    src: stagedFile,
                    destName: currentStageName,
                  });
                }
              }
              currentStageName = null;
              currentIsPrimary = false;
            }
            mode = remainingPadding > 0 ? "padding" : "header";
          }
        } else {
          const take = Math.min(buf.length, remainingPadding);
          const skipped = consume(take);
          if (!skipped) break;
          remainingPadding -= take;
          if (remainingPadding === 0) {
            mode = "header";
          }
        }
      }
    }

    if (!primaryStagePath) {
      throw new Error(
        `Release archive ${path.basename(archivePath)} did not contain ${targetBinaryName}`,
      );
    }

    if (process.platform !== "win32") {
      fs.chmodSync(primaryStagePath, 0o755);
      for (const comp of companionStageFiles) {
        if (comp.destName.endsWith(".bin")) {
          fs.chmodSync(comp.src, 0o755);
        }
      }
    }

    // Install companion files (e.g. .bin executable & OpenSSL libs) BEFORE the
    // primary entry script so `destPath` is never observable without its runtime.
    for (const comp of companionStageFiles) {
      atomicRenameSync(comp.src, path.join(destDir, comp.destName));
    }
    atomicRenameSync(primaryStagePath, destPath);
  } finally {
    if (outFd !== null) {
      try {
        fs.closeSync(outFd);
      } catch {
        // ignore close failure on cleanup path
      }
      outFd = null;
    }
    source.destroy();
    gunzip.destroy();
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch {
      // ignore staging cleanup failure
    }
  }
}

function atomicRenameSync(src: string, dst: string): void {
  const maxAttempts = process.platform === "win32" ? 4 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.renameSync(src, dst);
      return;
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (process.platform === "win32" && (code === "EPERM" || code === "EBUSY")) {
        const until = Date.now() + 30 * (attempt + 1);
        while (Date.now() < until) {
          // short spin only for Windows AV/handle release during atomic swap
        }
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function atomicWriteJsonSync(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  atomicRenameSync(tempPath, filePath);
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function isInsideDir(baseDir: string, candidatePath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const rel = path.relative(resolvedBase, resolvedCandidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function readManagedBinaryInfo(storageDir: string): ManagedBinaryInfo | null {
  const currentPath = path.join(storageDir, "current.json");
  const info = readJsonSafe<ManagedBinaryInfo>(currentPath);
  if (!info || typeof info.binaryPath !== "string" || typeof info.version !== "string") {
    return null;
  }
  if (!isInsideDir(storageDir, info.binaryPath)) {
    return null;
  }
  try {
    const stat = fs.statSync(info.binaryPath);
    if (!stat.isFile()) return null;
    if (process.platform !== "win32") {
      fs.accessSync(info.binaryPath, fs.constants.X_OK);
    }
    return info;
  } catch {
    return null;
  }
}

export function readInstallerState(storageDir: string): InstallerState | null {
  return readJsonSafe<InstallerState>(path.join(storageDir, "state.json"));
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === "EPERM";
  }
}

async function withInstallLock<T>(storageDir: string, fn: () => Promise<T>): Promise<T> {
  fs.mkdirSync(storageDir, { recursive: true });
  const lockPath = path.join(storageDir, ".install.lock");
  const start = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(
          fd,
          JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
        );
      } finally {
        fs.closeSync(fd);
      }
      acquired = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw err;

      let stale = false;
      try {
        const stat = fs.statSync(lockPath);
        const lockInfo = readJsonSafe<{ pid?: number; createdAt?: number }>(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          stale = true;
        } else if (lockInfo?.pid && !isPidAlive(lockInfo.pid)) {
          stale = true;
        }
      } catch {
        stale = true;
      }

      if (stale) {
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // ignore race
        }
        continue;
      }

      if (Date.now() - start > LOCK_WAIT_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for engine installer lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const signal =
    init.signal ??
    (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined);
  return fetchImpl(url, {
    ...init,
    signal,
    headers: {
      "User-Agent": "rayucode-vscode",
      ...(init.headers ?? {}),
    },
  });
}

async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  accept = "text/plain",
): Promise<string> {
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    { headers: { Accept: accept } },
    METADATA_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  return res.text();
}

export async function fetchLatestReleaseVersion(options?: {
  repo?: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const repo = options?.repo ?? DEFAULT_GITHUB_REPO;
  const fetchImpl = options?.fetchImpl ?? fetch;

  // 1. Static release-metadata CDN branch (avoids unauthenticated GitHub API limits)
  try {
    const raw = await fetchText(
      fetchImpl,
      `https://raw.githubusercontent.com/${repo}/release-metadata/releases/latest/version`,
    );
    const ver = raw.trim();
    if (isValidReleaseTag(ver)) return ver;
  } catch {
    // fall through to API
  }

  // 2. GitHub Releases REST API
  try {
    const jsonText = await fetchText(
      fetchImpl,
      `https://api.github.com/repos/${repo}/releases/latest`,
      "application/vnd.github+json",
    );
    const parsed = JSON.parse(jsonText) as { tag_name?: unknown };
    if (typeof parsed.tag_name === "string" && isValidReleaseTag(parsed.tag_name)) {
      return parsed.tag_name.trim();
    }
  } catch {
    // fall through to HTML redirect probe
  }

  // 3. GitHub /releases/latest HTTP redirect probe (immune to REST API rate limit)
  const res = await fetchWithTimeout(
    fetchImpl,
    `https://github.com/${repo}/releases/latest`,
    { method: "HEAD", redirect: "follow" },
    METADATA_TIMEOUT_MS,
  );
  if (res.ok && res.url) {
    const match = /\/releases\/tag\/([^/?#]+)$/.exec(res.url);
    if (match?.[1]) {
      const decoded = decodeURIComponent(match[1]).trim();
      if (isValidReleaseTag(decoded)) return decoded;
    }
  }

  throw new Error(`Unable to determine latest RayuCode engine release from ${repo}`);
}

async function fetchSha256Sums(
  repo: string,
  version: string,
  fetchImpl: FetchLike,
): Promise<Map<string, string>> {
  const urls = [
    `https://raw.githubusercontent.com/${repo}/release-metadata/releases/${encodeURIComponent(version)}/SHA256SUMS`,
    `https://github.com/${repo}/releases/download/${encodeURIComponent(version)}/SHA256SUMS`,
  ];
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const text = await fetchText(fetchImpl, url);
      const parsed = parseSha256Sums(text);
      if (parsed.size > 0) return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to fetch SHA256SUMS for ${version}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function fetchDownloadBases(
  repo: string,
  version: string,
  fetchImpl: FetchLike,
): Promise<string[]> {
  const defaultBase = `https://github.com/${repo}/releases/download/${encodeURIComponent(version)}`;
  const bases: string[] = [];
  try {
    const raw = await fetchText(
      fetchImpl,
      `https://raw.githubusercontent.com/${repo}/release-metadata/releases/${encodeURIComponent(version)}/download-bases`,
    );
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim().replace(/\/+$/, "");
      if (trimmed.startsWith("https://") && !bases.includes(trimmed)) {
        bases.push(trimmed);
      }
    }
  } catch {
    // fallback to GitHub releases URL below
  }
  if (!bases.includes(defaultBase)) {
    bases.push(defaultBase);
  }
  return bases;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadFileWithProgress(
  fetchImpl: FetchLike,
  url: string,
  destPath: string,
  version: string,
  onProgress?: (event: InstallProgressEvent) => void,
): Promise<void> {
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    { redirect: "follow" },
    DOWNLOAD_TIMEOUT_MS,
  );
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} downloading ${url}`);
  }
  const totalBytesHeader = res.headers.get("content-length");
  const totalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : 0;
  let downloadedBytes = 0;
  let lastReportedOverall = -1;
  let lastReportedUnboundedBytes = 0;

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.part.${process.pid}`;
  const out = fs.createWriteStream(tempPath);

  try {
    const reader = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
    for await (const rawChunk of reader) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      downloadedBytes += chunk.length;
      if (!out.write(chunk)) {
        await new Promise<void>((resolve) => out.once("drain", resolve));
      }
      if (onProgress) {
        if (totalBytes > 0) {
          const overallPct = Math.min(
            85,
            Math.floor((downloadedBytes / totalBytes) * 85),
          );
          if (
            overallPct >= lastReportedOverall + 2 ||
            downloadedBytes >= totalBytes
          ) {
            lastReportedOverall = overallPct;
            onProgress({
              phase: "downloading",
              version,
              percent: overallPct,
              downloadedBytes,
              totalBytes,
              message: `Downloading Rayu engine ${version} (${overallPct}%, ${formatMegabytes(downloadedBytes)} / ${formatMegabytes(totalBytes)}) — please wait...`,
            });
          }
        } else if (downloadedBytes - lastReportedUnboundedBytes >= 256 * 1024) {
          lastReportedUnboundedBytes = downloadedBytes;
          onProgress({
            phase: "downloading",
            version,
            downloadedBytes,
            message: `Downloading Rayu engine ${version} (${formatMegabytes(downloadedBytes)}) — please wait...`,
          });
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(resolve);
    });
    atomicRenameSync(tempPath, destPath);
  } catch (err) {
    out.destroy();
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore
    }
    throw err;
  }
}

function cleanupOldVersions(storageDir: string, keepVersions: string[]): void {
  const versionsDir = path.join(storageDir, "versions");
  if (!fs.existsSync(versionsDir)) return;
  const keepSet = new Set(keepVersions.filter(Boolean));
  try {
    const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (keepSet.has(entry.name)) continue;
      try {
        fs.rmSync(path.join(versionsDir, entry.name), { recursive: true, force: true });
      } catch {
        // Best-effort only: running Windows .exe may hold a file handle until restart
      }
    }
  } catch {
    // ignore cleanup failure
  }
}

async function installVersionLocked(options: {
  storageDir: string;
  version: string;
  target: ReleaseTarget;
  repo: string;
  extensionVersion?: string;
  previousVersion?: string;
  fetchImpl: FetchLike;
  onProgress?: (event: InstallProgressEvent) => void;
}): Promise<ManagedBinaryInfo> {
  const {
    storageDir,
    version,
    target,
    repo,
    extensionVersion,
    previousVersion,
    fetchImpl,
    onProgress,
  } = options;

  if (!isValidReleaseTag(version)) {
    throw new Error(`Refusing unsafe release tag: ${version}`);
  }

  const versionDir = path.join(storageDir, "versions", version);
  const finalBinaryPath = path.join(versionDir, target.binaryName);

  const sums = await fetchSha256Sums(repo, version, fetchImpl);
  const candidates: Array<{
    assetName: string;
    archiveFormat: "tar.gz" | "exe";
    expectedSha: string;
  }> = [];

  const primarySha = sums.get(target.assetName);
  if (primarySha) {
    candidates.push({
      assetName: target.assetName,
      archiveFormat: target.archiveFormat,
      expectedSha: primarySha,
    });
  }
  if (target.fallbackAssetName && target.fallbackArchiveFormat) {
    const fallbackSha = sums.get(target.fallbackAssetName);
    if (fallbackSha) {
      candidates.push({
        assetName: target.fallbackAssetName,
        archiveFormat: target.fallbackArchiveFormat,
        expectedSha: fallbackSha,
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `SHA256SUMS for ${version} does not include ${target.assetName}${target.fallbackAssetName ? ` or ${target.fallbackAssetName}` : ""}`,
    );
  }

  const bases = await fetchDownloadBases(repo, version, fetchImpl);
  const tempDownloadDir = path.join(storageDir, "tmp");
  fs.mkdirSync(tempDownloadDir, { recursive: true });

  let installedAssetName: string | undefined;
  let installedSha: string | undefined;
  let lastError: unknown;

  for (const candidate of candidates) {
    const downloadPath = path.join(
      tempDownloadDir,
      `${candidate.assetName}.${process.pid}.${Date.now()}`,
    );
    let downloadedOk = false;

    for (const base of bases) {
      const url = `${base}/${encodeURIComponent(candidate.assetName)}`;
      try {
        onProgress?.({
          phase: "downloading",
          version,
          percent: 0,
          message: `Downloading Rayu engine ${version} — please wait...`,
        });
        await downloadFileWithProgress(
          fetchImpl,
          url,
          downloadPath,
          version,
          onProgress,
        );
        downloadedOk = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!downloadedOk) {
      try {
        fs.rmSync(downloadPath, { force: true });
      } catch {
        // ignore
      }
      continue;
    }

    try {
      onProgress?.({
        phase: "verifying",
        version,
        percent: 90,
        message: `Verifying Rayu engine ${version} SHA-256 checksum — please wait...`,
      });
      const actualSha = await computeSha256(downloadPath);
      if (actualSha !== candidate.expectedSha) {
        throw new Error(
          `Checksum mismatch for ${candidate.assetName}: expected ${candidate.expectedSha}, got ${actualSha}`,
        );
      }

      fs.mkdirSync(versionDir, { recursive: true });
      if (candidate.archiveFormat === "tar.gz") {
        onProgress?.({
          phase: "extracting",
          version,
          percent: 95,
          message: `Extracting Rayu engine ${version} — please wait...`,
        });
        await extractBinaryFromTarGz(
          downloadPath,
          target.binaryName,
          finalBinaryPath,
        );
      } else {
        onProgress?.({
          phase: "installing",
          version,
          percent: 98,
          message: `Installing Rayu engine ${version} — please wait...`,
        });
        atomicRenameSync(downloadPath, finalBinaryPath);
      }

      if (process.platform !== "win32") {
        fs.chmodSync(finalBinaryPath, 0o755);
      }
      installedAssetName = candidate.assetName;
      installedSha = candidate.expectedSha;
      break;
    } catch (err) {
      lastError = err;
    } finally {
      try {
        fs.rmSync(downloadPath, { force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }

  if (!installedAssetName || !installedSha) {
    throw new Error(
      `Failed to install Rayu engine ${version}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  const info: ManagedBinaryInfo = {
    version,
    binaryPath: finalBinaryPath,
    installedAt: new Date().toISOString(),
    extensionVersion,
    assetName: installedAssetName,
    sha256: installedSha,
  };
  atomicWriteJsonSync(path.join(storageDir, "current.json"), info);
  cleanupOldVersions(storageDir, [version, previousVersion ?? ""]);

  onProgress?.({
    phase: "ready",
    version,
    percent: 100,
    message: `Rayu engine ${version} installed — starting daemon...`,
  });
  return info;
}

function writeInstallerStateSafe(storageDir: string, state: InstallerState): void {
  try {
    atomicWriteJsonSync(path.join(storageDir, "state.json"), state);
  } catch {
    // non-fatal metadata write
  }
}

/**
 * Ensure a runnable managed `rayu` binary is installed in `storageDir`.
 * Returns the cached managed binary immediately unless `force` is true.
 */
export async function ensureManagedBinary(
  options: InstallerOptions,
): Promise<EnsureBinaryResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = resolveReleaseTarget(platform, arch);
  if (!target) {
    throw new Error(
      `No prebuilt Rayu engine release is available for ${platform}/${arch}`,
    );
  }

  const existing = readManagedBinaryInfo(options.storageDir);
  if (existing && !options.force) {
    return {
      binaryPath: existing.binaryPath,
      version: existing.version,
      updated: false,
      source: "managed-cached",
    };
  }

  const repo = options.repo ?? DEFAULT_GITHUB_REPO;
  const fetchImpl = options.fetchImpl ?? fetch;

  return withInstallLock(options.storageDir, async () => {
    const insideLockExisting = readManagedBinaryInfo(options.storageDir);
    if (insideLockExisting && !options.force) {
      return {
        binaryPath: insideLockExisting.binaryPath,
        version: insideLockExisting.version,
        updated: false,
        source: "managed-cached",
      };
    }

    options.onProgress?.({
      phase: "checking",
      message: "Checking latest Rayu engine release — please wait...",
    });
    const latestVersion = await fetchLatestReleaseVersion({ repo, fetchImpl });

    if (
      insideLockExisting &&
      compareReleaseVersions(latestVersion, insideLockExisting.version) <= 0
    ) {
      writeInstallerStateSafe(options.storageDir, {
        lastCheckedAt: new Date().toISOString(),
        lastExtensionVersion: options.extensionVersion,
        lastKnownLatestVersion: latestVersion,
      });
      options.onProgress?.({
        phase: "up_to_date",
        version: insideLockExisting.version,
        percent: 100,
        message: `Rayu engine ${insideLockExisting.version} is already up to date`,
      });
      return {
        binaryPath: insideLockExisting.binaryPath,
        version: insideLockExisting.version,
        updated: false,
        source: "managed-cached",
      };
    }

    const installed = await installVersionLocked({
      storageDir: options.storageDir,
      version: latestVersion,
      target,
      repo,
      extensionVersion: options.extensionVersion,
      previousVersion: insideLockExisting?.version,
      fetchImpl,
      onProgress: options.onProgress,
    });

    writeInstallerStateSafe(options.storageDir, {
      lastCheckedAt: new Date().toISOString(),
      lastExtensionVersion: options.extensionVersion,
      lastKnownLatestVersion: latestVersion,
    });

    return {
      binaryPath: installed.binaryPath,
      version: installed.version,
      updated: true,
      source: insideLockExisting ? "managed-updated" : "managed-downloaded",
    };
  });
}

/**
 * Check GitHub Releases for a newer managed binary and install it if newer.
 * Respects `checkIntervalMs` cooldown unless `force` is true or `extensionVersion` changed.
 */
export async function checkAndUpdateManagedBinary(
  options: InstallerOptions,
): Promise<UpdateCheckResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = resolveReleaseTarget(platform, arch);
  if (!target) {
    return {
      checked: false,
      updated: false,
      error: `Unsupported platform ${platform}/${arch}`,
    };
  }

  const current = readManagedBinaryInfo(options.storageDir);
  const state = readInstallerState(options.storageDir);
  const checkIntervalMs =
    options.checkIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  const extensionChanged =
    Boolean(options.extensionVersion) &&
    state?.lastExtensionVersion !== options.extensionVersion;

  if (current && !options.force && !extensionChanged && state?.lastCheckedAt) {
    const lastCheckedMs = Date.parse(state.lastCheckedAt);
    if (Number.isFinite(lastCheckedMs) && Date.now() - lastCheckedMs < checkIntervalMs) {
      return {
        checked: false,
        updated: false,
        currentVersion: current?.version,
        latestVersion: state.lastKnownLatestVersion,
        binaryPath: current?.binaryPath,
      };
    }
  }

  const repo = options.repo ?? DEFAULT_GITHUB_REPO;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    return await withInstallLock(options.storageDir, async () => {
      const latestCurrent = readManagedBinaryInfo(options.storageDir);
      options.onProgress?.({
        phase: "checking",
        message: "Checking for Rayu engine updates — please wait...",
      });
      const latestVersion = await fetchLatestReleaseVersion({ repo, fetchImpl });

      if (
        latestCurrent &&
        compareReleaseVersions(latestVersion, latestCurrent.version) <= 0
      ) {
        writeInstallerStateSafe(options.storageDir, {
          lastCheckedAt: new Date().toISOString(),
          lastExtensionVersion: options.extensionVersion,
          lastKnownLatestVersion: latestVersion,
        });
        options.onProgress?.({
          phase: "up_to_date",
          version: latestCurrent.version,
          percent: 100,
          message: `Rayu engine ${latestCurrent.version} is up to date`,
        });
        return {
          checked: true,
          updated: false,
          currentVersion: latestCurrent.version,
          latestVersion,
          binaryPath: latestCurrent.binaryPath,
        };
      }

      const installed = await installVersionLocked({
        storageDir: options.storageDir,
        version: latestVersion,
        target,
        repo,
        extensionVersion: options.extensionVersion,
        previousVersion: latestCurrent?.version,
        fetchImpl,
        onProgress: options.onProgress,
      });

      writeInstallerStateSafe(options.storageDir, {
        lastCheckedAt: new Date().toISOString(),
        lastExtensionVersion: options.extensionVersion,
        lastKnownLatestVersion: latestVersion,
      });

      return {
        checked: true,
        updated: true,
        currentVersion: installed.version,
        latestVersion,
        binaryPath: installed.binaryPath,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeInstallerStateSafe(options.storageDir, {
      lastCheckedAt: new Date().toISOString(),
      lastExtensionVersion: options.extensionVersion,
      lastKnownLatestVersion: state?.lastKnownLatestVersion,
      lastError: message,
    });
    return {
      checked: true,
      updated: false,
      currentVersion: current?.version,
      binaryPath: current?.binaryPath,
      error: message,
    };
  }
}
