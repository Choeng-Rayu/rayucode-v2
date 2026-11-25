import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import type {
  LegacyMigrationInput,
  WorkspaceChangeEvent,
  WorkspaceLedger,
  WorkspaceRecord,
  WorkspaceRegistryOptions,
} from "./types.js";

const WorkspaceRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  canonicalPath: z.string().min(1),
  sessionIds: z.array(z.string().min(1)).default([]),
  createdAt: z.number().finite().default(0),
  updatedAt: z.number().finite().default(0),
  lastOpenedAt: z.number().finite().default(0),
  missingOnDisk: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

const WorkspaceLedgerSchema = z.object({
  version: z.literal(1).default(1),
  updatedAt: z.number().finite().default(0),
  workspaces: z.array(WorkspaceRecordSchema).default([]),
  pinnedSessionIds: z.array(z.string().min(1)).default([]),
  archivedSessionIds: z.array(z.string().min(1)).default([]),
  unarchiveSlotOrder: z.record(z.string(), z.number().finite()).default({}),
  collapsedWorkspaceIds: z.array(z.string().min(1)).default([]),
  manualWorkspaceOrder: z.array(z.string().min(1)).default([]),
  migratedSources: z.array(z.string().min(1)).default([]),
});

export interface CanonicalPathResult {
  rawPath: string;
  canonicalPath: string;
  comparisonKey: string;
  missingOnDisk: boolean;
}

export function getDefaultWorkspacesFilePath(): string {
  const rayuHome =
    process.env.RAYU_HOME?.trim() || path.join(os.homedir(), ".rayu");
  return path.join(rayuHome, "workspaces.json");
}

function stripTrailingSeparators(target: string): string {
  if (!target) return target;
  const parsed = path.parse(target);
  if (target === parsed.root) return target;
  return target.replace(/[\\/]+$/, "") || parsed.root;
}

function expandHomePrefix(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function canonicalizeWorkspacePath(rawPath: string): CanonicalPathResult {
  const expanded = expandHomePrefix(rawPath);
  const resolved = stripTrailingSeparators(path.resolve(expanded));
  let canonicalPath = resolved;
  let missingOnDisk = false;

  try {
    canonicalPath = stripTrailingSeparators(fs.realpathSync(resolved));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR") {
      missingOnDisk = true;
    }
    canonicalPath = resolved;
  }

  const comparisonKey =
    process.platform === "win32" || process.platform === "darwin"
      ? canonicalPath.toLowerCase()
      : canonicalPath;

  return {
    rawPath: resolved,
    canonicalPath,
    comparisonKey,
    missingOnDisk,
  };
}

export function deriveStableWorkspaceId(canonicalPath: string): string {
  const key =
    process.platform === "win32" || process.platform === "darwin"
      ? canonicalPath.toLowerCase()
      : canonicalPath;
  const hash = crypto
    .createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 12);
  const slug =
    path
      .basename(canonicalPath)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "workspace";
  return `ws_${slug}_${hash}`;
}

function createEmptyLedger(now = Date.now()): WorkspaceLedger {
  return {
    version: 1,
    updatedAt: now,
    workspaces: [],
    pinnedSessionIds: [],
    archivedSessionIds: [],
    unarchiveSlotOrder: {},
    collapsedWorkspaceIds: [],
    manualWorkspaceOrder: [],
    migratedSources: [],
  };
}

function dedupeStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeLedger(ledger: WorkspaceLedger): WorkspaceLedger {
  const pinned = dedupeStrings(ledger.pinnedSessionIds);
  const pinnedSet = new Set(pinned);
  const archived = dedupeStrings(ledger.archivedSessionIds).filter(
    (id) => !pinnedSet.has(id)
  );

  // Deduplicate workspaces by canonical comparison key, merging sessionIds
  const byKey = new Map<string, WorkspaceRecord>();
  for (const ws of ledger.workspaces) {
    const info = canonicalizeWorkspacePath(ws.canonicalPath || ws.path);
    const existing = byKey.get(info.comparisonKey);
    if (!existing) {
      byKey.set(info.comparisonKey, {
        ...ws,
        id: ws.id || deriveStableWorkspaceId(info.canonicalPath),
        name: ws.name.trim() || path.basename(info.canonicalPath) || info.canonicalPath,
        path: ws.path || info.rawPath,
        canonicalPath: info.canonicalPath,
        sessionIds: dedupeStrings(ws.sessionIds),
        missingOnDisk: info.missingOnDisk || undefined,
      });
    } else {
      existing.sessionIds = dedupeStrings([
        ...existing.sessionIds,
        ...ws.sessionIds,
      ]);
      existing.updatedAt = Math.max(existing.updatedAt, ws.updatedAt);
      existing.lastOpenedAt = Math.max(existing.lastOpenedAt, ws.lastOpenedAt);
      existing.hidden = Boolean(existing.hidden && ws.hidden) || undefined;
    }
  }

  const workspaces = Array.from(byKey.values());
  const validWorkspaceIds = new Set(workspaces.map((w) => w.id));

  return {
    version: 1,
    updatedAt: ledger.updatedAt || Date.now(),
    workspaces,
    pinnedSessionIds: pinned,
    archivedSessionIds: archived,
    unarchiveSlotOrder: { ...ledger.unarchiveSlotOrder },
    collapsedWorkspaceIds: dedupeStrings(ledger.collapsedWorkspaceIds).filter(
      (id) => validWorkspaceIds.has(id)
    ),
    manualWorkspaceOrder: dedupeStrings(ledger.manualWorkspaceOrder).filter(
      (id) => validWorkspaceIds.has(id)
    ),
    migratedSources: dedupeStrings(ledger.migratedSources),
  };
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return code === "EPERM";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class WorkspaceRegistry {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly staleLockMs: number;
  private readonly lockTimeoutMs: number;
  private readonly watchDebounceMs: number;
  private readonly enableWatch: boolean;

  private operationTail: Promise<unknown> = Promise.resolve();
  private cachedLedger: WorkspaceLedger | null = null;
  private lastWrittenHash: string | null = null;
  private listeners = new Set<(event: WorkspaceChangeEvent) => void>();
  private watcher: fs.FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: WorkspaceRegistryOptions = {}) {
    this.filePath = path.resolve(
      options.filePath ?? getDefaultWorkspacesFilePath()
    );
    this.lockPath = `${this.filePath}.lock`;
    this.staleLockMs = options.staleLockMs ?? 5_000;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.watchDebounceMs = options.watchDebounceMs ?? 50;
    this.enableWatch = options.enableWatch ?? true;
  }

  getFilePath(): string {
    return this.filePath;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(fn, fn);
    this.operationTail = next.catch(() => {});
    return next;
  }

  private ensureParentDir(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
  }

  private readLedgerFromDisk(): WorkspaceLedger {
    if (!fs.existsSync(this.filePath)) {
      return createEmptyLedger();
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      return createEmptyLedger();
    }
    try {
      const parsed = JSON.parse(raw);
      const validated = WorkspaceLedgerSchema.parse(parsed);
      return normalizeLedger(validated);
    } catch {
      const backupPath = `${this.filePath}.corrupt.${Date.now()}`;
      try {
        fs.copyFileSync(this.filePath, backupPath);
      } catch {
        // best-effort backup
      }
      const fresh = createEmptyLedger();
      this.writeLedgerAtomically(fresh);
      return fresh;
    }
  }

  private writeLedgerAtomically(ledger: WorkspaceLedger): void {
    this.ensureParentDir();
    const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
    const nonce = crypto.randomBytes(6).toString("hex");
    const tmpPath = `${this.filePath}.${process.pid}.${nonce}.tmp`;
    fs.writeFileSync(tmpPath, serialized, { mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(this.filePath, 0o600);
      } catch {
        // ignore chmod errors
      }
    }
    this.lastWrittenHash = hashContent(serialized);
  }

  private isLockStale(): boolean {
    try {
      const stat = fs.statSync(this.lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs >= this.staleLockMs) {
        return true;
      }
      try {
        const raw = fs.readFileSync(this.lockPath, "utf8");
        const info = JSON.parse(raw) as { pid?: number; acquiredAt?: number };
        if (
          typeof info.acquiredAt === "number" &&
          Date.now() - info.acquiredAt >= this.staleLockMs
        ) {
          return true;
        }
        if (typeof info.pid === "number" && !isPidAlive(info.pid)) {
          return true;
        }
      } catch {
        // Lockfile mid-write or malformed; rely on age check above
      }
      return false;
    } catch {
      return false;
    }
  }

  private async withFileLock<T>(fn: () => T | Promise<T>): Promise<T> {
    this.ensureParentDir();
    const deadline = Date.now() + this.lockTimeoutMs;
    const token = crypto.randomBytes(6).toString("hex");
    let delayMs = 15;
    let acquired = false;

    while (!acquired) {
      try {
        const fd = fs.openSync(this.lockPath, "wx", 0o600);
        try {
          fs.writeFileSync(
            fd,
            JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), token }),
            "utf8"
          );
        } finally {
          fs.closeSync(fd);
        }
        acquired = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (code !== "EEXIST") {
          throw err;
        }
        if (this.isLockStale()) {
          try {
            fs.unlinkSync(this.lockPath);
          } catch {
            // another process already broke or released it
          }
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `Timed out waiting for workspace registry lock: ${this.lockPath}`
          );
        }
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 120);
      }
    }

    try {
      return await fn();
    } finally {
      try {
        const raw = fs.readFileSync(this.lockPath, "utf8");
        const parsed = JSON.parse(raw) as { token?: string };
        if (parsed.token === token) {
          fs.unlinkSync(this.lockPath);
        }
      } catch {
        try {
          fs.unlinkSync(this.lockPath);
        } catch {
          // already removed
        }
      }
    }
  }

  private startWatcherIfNeeded(): void {
    if (!this.enableWatch || this.watcher || this.disposed) return;
    this.ensureParentDir();
    const targetName = path.basename(this.filePath);
    try {
      this.watcher = fs.watch(path.dirname(this.filePath), (_event, filename) => {
        if (filename && filename.toString() !== targetName) return;
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => {
          this.watchTimer = null;
          void this.handleExternalChange();
        }, this.watchDebounceMs);
      });
      this.watcher.on("error", () => {
        // non-fatal watch error
      });
    } catch {
      // platform/fs does not support watch; callers still read fresh on mutations
    }
  }

  private async handleExternalChange(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf8");
      const currentHash = hashContent(raw);
      if (this.lastWrittenHash && currentHash === this.lastWrittenHash) {
        return;
      }
      const next = this.readLedgerFromDisk();
      this.lastWrittenHash = currentHash;
      this.cachedLedger = next;
      this.emitChange({ ledger: structuredClone(next), source: "external" });
    } catch {
      // transient rename race; next change or read will recover
    }
  }

  private emitChange(event: WorkspaceChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // isolate subscriber errors
      }
    }
  }

  private async mutate(
    updater: (draft: WorkspaceLedger) => boolean | void
  ): Promise<WorkspaceLedger> {
    return this.enqueue(async () => {
      const updated = await this.withFileLock(() => {
        const current = this.readLedgerFromDisk();
        const changed = updater(current);
        if (changed === false) {
          this.cachedLedger = current;
          return { ledger: current, wrote: false };
        }
        current.updatedAt = Date.now();
        const normalized = normalizeLedger(current);
        this.writeLedgerAtomically(normalized);
        this.cachedLedger = normalized;
        return { ledger: normalized, wrote: true };
      });

      this.startWatcherIfNeeded();
      if (updated.wrote) {
        this.emitChange({
          ledger: structuredClone(updated.ledger),
          source: "local",
        });
      }
      return structuredClone(updated.ledger);
    });
  }

  async load(): Promise<WorkspaceLedger> {
    return this.enqueue(async () => {
      const ledger = this.readLedgerFromDisk();
      this.cachedLedger = ledger;
      this.startWatcherIfNeeded();
      return structuredClone(ledger);
    });
  }

  getSnapshot(): WorkspaceLedger {
    if (!this.cachedLedger) {
      this.cachedLedger = this.readLedgerFromDisk();
      this.startWatcherIfNeeded();
    }
    return structuredClone(this.cachedLedger);
  }

  async ensureWorkspace(
    rawPath: string,
    options?: { name?: string; unhide?: boolean }
  ): Promise<{ workspace: WorkspaceRecord; ledger: WorkspaceLedger; created: boolean }> {
    const info = canonicalizeWorkspacePath(rawPath);
    let created = false;
    let targetId = "";

    const ledger = await this.mutate((draft) => {
      const existing = draft.workspaces.find(
        (w) =>
          canonicalizeWorkspacePath(w.canonicalPath || w.path).comparisonKey ===
          info.comparisonKey
      );
      const now = Date.now();
      if (existing) {
        targetId = existing.id;
        existing.lastOpenedAt = now;
        existing.updatedAt = now;
        existing.missingOnDisk = info.missingOnDisk || undefined;
        if (options?.name?.trim()) {
          existing.name = options.name.trim();
        }
        if (options?.unhide) {
          existing.hidden = undefined;
        }
        return true;
      }

      created = true;
      const id = deriveStableWorkspaceId(info.canonicalPath);
      targetId = id;
      const displayName =
        options?.name?.trim() ||
        path.basename(info.canonicalPath) ||
        info.canonicalPath;
      draft.workspaces.unshift({
        id,
        name: displayName,
        path: info.rawPath,
        canonicalPath: info.canonicalPath,
        sessionIds: [],
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        ...(info.missingOnDisk ? { missingOnDisk: true } : {}),
      });
      return true;
    });

    const workspace = ledger.workspaces.find((w) => w.id === targetId)!;
    return { workspace, ledger, created };
  }

  async importProjectGroup(
    rawPath: string,
    options: { name?: string; sessionIds: readonly string[] }
  ): Promise<{
    workspace: WorkspaceRecord;
    ledger: WorkspaceLedger;
    created: boolean;
  }> {
    const info = canonicalizeWorkspacePath(rawPath);
    const cleanSessionIds = dedupeStrings(options.sessionIds);
    const cleanSessionIdSet = new Set(cleanSessionIds);
    let created = false;
    let targetId = "";

    const ledger = await this.mutate((draft) => {
      let target = draft.workspaces.find(
        (w) =>
          canonicalizeWorkspacePath(w.canonicalPath || w.path).comparisonKey ===
          info.comparisonKey
      );
      const now = Date.now();
      if (target) {
        targetId = target.id;
        target.lastOpenedAt = now;
        target.updatedAt = now;
        target.missingOnDisk = info.missingOnDisk || undefined;
        target.hidden = undefined;
        if (options.name?.trim()) {
          target.name = options.name.trim();
        }
      } else {
        created = true;
        const id = deriveStableWorkspaceId(info.canonicalPath);
        targetId = id;
        const displayName =
          options.name?.trim() ||
          path.basename(info.canonicalPath) ||
          info.canonicalPath;
        target = {
          id,
          name: displayName,
          path: info.rawPath,
          canonicalPath: info.canonicalPath,
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
          ...(info.missingOnDisk ? { missingOnDisk: true } : {}),
        };
        draft.workspaces.unshift(target);
      }

      if (cleanSessionIds.length > 0) {
        // Ensure every imported session belongs to at most one workspace
        for (const ws of draft.workspaces) {
          if (ws.id !== target.id) {
            ws.sessionIds = ws.sessionIds.filter(
              (id) => !cleanSessionIdSet.has(id)
            );
          }
        }
        target.sessionIds = [
          ...cleanSessionIds,
          ...target.sessionIds.filter((id) => !cleanSessionIdSet.has(id)),
        ];
        target.updatedAt = now;
      }

      return true;
    });

    const workspace = ledger.workspaces.find((w) => w.id === targetId)!;
    return { workspace, ledger, created };
  }

  async renameWorkspace(
    workspaceId: string,
    newName: string
  ): Promise<WorkspaceLedger> {
    const trimmed = newName.trim();
    if (!trimmed) return this.load();
    return this.mutate((draft) => {
      const target = draft.workspaces.find((w) => w.id === workspaceId);
      if (!target || target.name === trimmed) return false;
      target.name = trimmed;
      target.updatedAt = Date.now();
      return true;
    });
  }

  async removeWorkspace(idOrPath: string): Promise<WorkspaceLedger> {
    const key = canonicalizeWorkspacePath(idOrPath).comparisonKey;
    return this.mutate((draft) => {
      const before = draft.workspaces.length;
      draft.workspaces = draft.workspaces.filter((w) => {
        if (w.id === idOrPath) return false;
        const wKey = canonicalizeWorkspacePath(
          w.canonicalPath || w.path
        ).comparisonKey;
        return wKey !== key;
      });
      return draft.workspaces.length !== before;
    });
  }

  async attachSession(
    workspaceIdOrPath: string,
    sessionId: string
  ): Promise<WorkspaceLedger> {
    const sid = sessionId.trim();
    if (!sid) return this.load();

    return this.mutate((draft) => {
      let target = draft.workspaces.find((w) => w.id === workspaceIdOrPath);
      if (!target) {
        const info = canonicalizeWorkspacePath(workspaceIdOrPath);
        target = draft.workspaces.find(
          (w) =>
            canonicalizeWorkspacePath(w.canonicalPath || w.path)
              .comparisonKey === info.comparisonKey
        );
        if (!target) {
          const now = Date.now();
          target = {
            id: deriveStableWorkspaceId(info.canonicalPath),
            name: path.basename(info.canonicalPath) || info.canonicalPath,
            path: info.rawPath,
            canonicalPath: info.canonicalPath,
            sessionIds: [],
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            ...(info.missingOnDisk ? { missingOnDisk: true } : {}),
          };
          draft.workspaces.unshift(target);
        }
      }

      // Ensure session belongs to at most one workspace
      for (const ws of draft.workspaces) {
        if (ws.id !== target.id) {
          ws.sessionIds = ws.sessionIds.filter((id) => id !== sid);
        }
      }
      if (!target.sessionIds.includes(sid)) {
        target.sessionIds.unshift(sid);
      }
      target.updatedAt = Date.now();
      return true;
    });
  }

  async detachSession(sessionId: string): Promise<WorkspaceLedger> {
    const sid = sessionId.trim();
    if (!sid) return this.load();
    return this.mutate((draft) => {
      let changed = false;
      for (const ws of draft.workspaces) {
        const next = ws.sessionIds.filter((id) => id !== sid);
        if (next.length !== ws.sessionIds.length) {
          ws.sessionIds = next;
          changed = true;
        }
      }
      if (draft.pinnedSessionIds.includes(sid)) {
        draft.pinnedSessionIds = draft.pinnedSessionIds.filter((id) => id !== sid);
        changed = true;
      }
      if (draft.archivedSessionIds.includes(sid)) {
        draft.archivedSessionIds = draft.archivedSessionIds.filter(
          (id) => id !== sid
        );
        changed = true;
      }
      if (sid in draft.unarchiveSlotOrder) {
        delete draft.unarchiveSlotOrder[sid];
        changed = true;
      }
      return changed;
    });
  }

  async setPinned(sessionId: string, pinned: boolean): Promise<WorkspaceLedger> {
    const sid = sessionId.trim();
    if (!sid) return this.load();
    return this.mutate((draft) => {
      if (pinned) {
        draft.archivedSessionIds = draft.archivedSessionIds.filter(
          (id) => id !== sid
        );
        delete draft.unarchiveSlotOrder[sid];
        draft.pinnedSessionIds = [
          sid,
          ...draft.pinnedSessionIds.filter((id) => id !== sid),
        ];
        return true;
      }
      if (!draft.pinnedSessionIds.includes(sid)) return false;
      draft.pinnedSessionIds = draft.pinnedSessionIds.filter((id) => id !== sid);
      return true;
    });
  }

  async setArchived(
    sessionId: string,
    archived: boolean
  ): Promise<WorkspaceLedger> {
    const sid = sessionId.trim();
    if (!sid) return this.load();
    return this.mutate((draft) => {
      if (archived) {
        const pinIdx = draft.pinnedSessionIds.indexOf(sid);
        if (pinIdx >= 0) {
          draft.unarchiveSlotOrder[sid] = pinIdx;
          draft.pinnedSessionIds.splice(pinIdx, 1);
        }
        draft.archivedSessionIds = [
          sid,
          ...draft.archivedSessionIds.filter((id) => id !== sid),
        ];
        return true;
      }
      if (!draft.archivedSessionIds.includes(sid)) return false;
      draft.archivedSessionIds = draft.archivedSessionIds.filter(
        (id) => id !== sid
      );
      const savedIdx = draft.unarchiveSlotOrder[sid];
      if (typeof savedIdx === "number") {
        delete draft.unarchiveSlotOrder[sid];
        const clamped = Math.max(0, Math.min(savedIdx, draft.pinnedSessionIds.length));
        draft.pinnedSessionIds.splice(clamped, 0, sid);
      }
      return true;
    });
  }

  async setCollapsed(
    workspaceId: string,
    collapsed: boolean
  ): Promise<WorkspaceLedger> {
    return this.mutate((draft) => {
      const has = draft.collapsedWorkspaceIds.includes(workspaceId);
      if (collapsed && !has) {
        draft.collapsedWorkspaceIds.push(workspaceId);
        return true;
      }
      if (!collapsed && has) {
        draft.collapsedWorkspaceIds = draft.collapsedWorkspaceIds.filter(
          (id) => id !== workspaceId
        );
        return true;
      }
      return false;
    });
  }

  async setManualOrder(workspaceIds: string[]): Promise<WorkspaceLedger> {
    return this.mutate((draft) => {
      draft.manualWorkspaceOrder = dedupeStrings(workspaceIds);
      return true;
    });
  }

  async migrateLegacy(input: LegacyMigrationInput): Promise<WorkspaceLedger> {
    const sourceKey = input.sourceKey.trim();
    if (!sourceKey) return this.load();
    return this.mutate((draft) => {
      if (draft.migratedSources.includes(sourceKey)) {
        return false;
      }
      const hiddenKeys = new Set(
        (input.hiddenWorkspacePaths ?? []).map(
          (p) => canonicalizeWorkspacePath(p).comparisonKey
        )
      );
      const oldIdToCanonicalId = new Map<string, string>();
      const now = Date.now();

      for (const entry of input.workspaces ?? []) {
        if (!entry.path?.trim()) continue;
        const info = canonicalizeWorkspacePath(entry.path);
        let existing = draft.workspaces.find(
          (w) =>
            canonicalizeWorkspacePath(w.canonicalPath || w.path)
              .comparisonKey === info.comparisonKey
        );
        if (!existing) {
          const id = deriveStableWorkspaceId(info.canonicalPath);
          existing = {
            id,
            name:
              entry.name?.trim() ||
              path.basename(info.canonicalPath) ||
              info.canonicalPath,
            path: info.rawPath,
            canonicalPath: info.canonicalPath,
            sessionIds: [],
            createdAt: entry.createdAt ?? now,
            updatedAt: now,
            lastOpenedAt: entry.lastOpenedAt ?? entry.createdAt ?? now,
            ...(info.missingOnDisk ? { missingOnDisk: true } : {}),
            ...(entry.hidden || hiddenKeys.has(info.comparisonKey)
              ? { hidden: true }
              : {}),
          };
          draft.workspaces.push(existing);
        }
        if (entry.id) {
          oldIdToCanonicalId.set(entry.id, existing.id);
        }
      }

      for (const assignment of input.sessionAssignments ?? []) {
        if (!assignment.workspacePath?.trim() || !assignment.sessionId?.trim()) {
          continue;
        }
        const info = canonicalizeWorkspacePath(assignment.workspacePath);
        const ws = draft.workspaces.find(
          (w) =>
            canonicalizeWorkspacePath(w.canonicalPath || w.path)
              .comparisonKey === info.comparisonKey
        );
        if (ws && !ws.sessionIds.includes(assignment.sessionId)) {
          ws.sessionIds.push(assignment.sessionId);
        }
      }

      for (const sid of input.pinnedSessionIds ?? []) {
        if (
          sid.trim() &&
          !draft.pinnedSessionIds.includes(sid) &&
          !draft.archivedSessionIds.includes(sid)
        ) {
          draft.pinnedSessionIds.push(sid);
        }
      }

      for (const sid of input.archivedSessionIds ?? []) {
        if (
          sid.trim() &&
          !draft.archivedSessionIds.includes(sid) &&
          !draft.pinnedSessionIds.includes(sid)
        ) {
          draft.archivedSessionIds.push(sid);
        }
      }

      for (const oldCollapsedId of input.collapsedWorkspaceIds ?? []) {
        const mapped = oldIdToCanonicalId.get(oldCollapsedId) ?? oldCollapsedId;
        if (!draft.collapsedWorkspaceIds.includes(mapped)) {
          draft.collapsedWorkspaceIds.push(mapped);
        }
      }

      for (const oldOrderId of input.manualWorkspaceOrder ?? []) {
        const mapped = oldIdToCanonicalId.get(oldOrderId) ?? oldOrderId;
        if (!draft.manualWorkspaceOrder.includes(mapped)) {
          draft.manualWorkspaceOrder.push(mapped);
        }
      }

      draft.migratedSources.push(sourceKey);
      return true;
    });
  }

  subscribe(listener: (event: WorkspaceChangeEvent) => void): () => void {
    this.listeners.add(listener);
    this.startWatcherIfNeeded();
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.listeners.clear();
  }
}
