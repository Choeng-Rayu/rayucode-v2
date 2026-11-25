import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  WorkspaceRegistry,
  canonicalizeWorkspacePath,
} from "../../src/host/workspace-registry.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-ws-registry-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceRegistry", () => {
  it("deduplicates symlink, trailing slash, and raw path via fs.realpath", async () => {
    const root = makeTempDir();
    const realProject = path.join(root, "repo-alpha");
    const symlinkProject = path.join(root, "repo-alpha-link");
    fs.mkdirSync(realProject);
    fs.symlinkSync(realProject, symlinkProject);

    const ledgerPath = path.join(root, "workspaces.json");
    const registry = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });

    const first = await registry.ensureWorkspace(`${realProject}/`);
    const second = await registry.ensureWorkspace(symlinkProject);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.ledger.workspaces).toHaveLength(1);
    expect(second.workspace.canonicalPath).toBe(
      canonicalizeWorkspacePath(realProject).canonicalPath
    );
    registry.dispose();
  });

  it("handles deleted/missing folder paths without throwing (ENOENT fallback)", async () => {
    const root = makeTempDir();
    const missingPath = path.join(root, "does-not-exist-anymore");
    const ledgerPath = path.join(root, "workspaces.json");
    const registry = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });

    const result = await registry.ensureWorkspace(missingPath);
    expect(result.workspace.missingOnDisk).toBe(true);
    expect(result.workspace.path).toBe(path.resolve(missingPath));
    registry.dispose();
  });

  it("enforces mutually exclusive pin and archive while preserving unarchive order", async () => {
    const root = makeTempDir();
    const ledgerPath = path.join(root, "workspaces.json");
    const registry = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });

    await registry.setPinned("s1", true);
    await registry.setPinned("s2", true);
    await registry.setPinned("s3", true);
    // Order is [s3, s2, s1]; archive s2 (index 1)
    let ledger = await registry.setArchived("s2", true);
    expect(ledger.pinnedSessionIds).toEqual(["s3", "s1"]);
    expect(ledger.archivedSessionIds).toEqual(["s2"]);

    // Unarchive restores s2 at index 1
    ledger = await registry.setArchived("s2", false);
    expect(ledger.archivedSessionIds).toEqual([]);
    expect(ledger.pinnedSessionIds).toEqual(["s3", "s2", "s1"]);

    // Pinning an archived session removes it from archived
    await registry.setArchived("s9", true);
    ledger = await registry.setPinned("s9", true);
    expect(ledger.pinnedSessionIds[0]).toBe("s9");
    expect(ledger.archivedSessionIds).not.toContain("s9");
    registry.dispose();
  });

  it("serializes concurrent cross-instance writes via lockfile without losing updates", async () => {
    const root = makeTempDir();
    const ledgerPath = path.join(root, "workspaces.json");
    const regDesktop = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });
    const regVscode = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });

    const dirA = path.join(root, "proj-a");
    const dirB = path.join(root, "proj-b");
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);

    await Promise.all([
      regDesktop.ensureWorkspace(dirA),
      regVscode.ensureWorkspace(dirB),
      regDesktop.setPinned("sess-desktop", true),
      regVscode.setPinned("sess-vscode", true),
      regDesktop.setArchived("sess-arch-1", true),
      regVscode.setArchived("sess-arch-2", true),
    ]);

    const finalLedger = await regDesktop.load();
    expect(finalLedger.workspaces).toHaveLength(2);
    expect(new Set(finalLedger.pinnedSessionIds)).toEqual(
      new Set(["sess-desktop", "sess-vscode"])
    );
    expect(new Set(finalLedger.archivedSessionIds)).toEqual(
      new Set(["sess-arch-1", "sess-arch-2"])
    );

    regDesktop.dispose();
    regVscode.dispose();
  });

  it("recovers from stale lockfiles (dead PID or expired age)", async () => {
    const root = makeTempDir();
    const ledgerPath = path.join(root, "workspaces.json");
    const lockPath = `${ledgerPath}.lock`;
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, acquiredAt: Date.now() - 10_000, token: "dead" }),
      "utf8"
    );

    const registry = new WorkspaceRegistry({
      filePath: ledgerPath,
      staleLockMs: 2_000,
      enableWatch: false,
    });

    const ledger = await registry.setPinned("recovered-session", true);
    expect(ledger.pinnedSessionIds).toEqual(["recovered-session"]);
    expect(fs.existsSync(lockPath)).toBe(false);
    registry.dispose();
  });

  it("backs up corrupt JSON and reinitializes cleanly", async () => {
    const root = makeTempDir();
    const ledgerPath = path.join(root, "workspaces.json");
    fs.writeFileSync(ledgerPath, "{ corrupt json !!!", "utf8");

    const registry = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });
    const ledger = await registry.load();
    expect(ledger.workspaces).toEqual([]);
    const files = fs.readdirSync(root);
    expect(files.some((f) => f.startsWith("workspaces.json.corrupt."))).toBe(
      true
    );
    registry.dispose();
  });

  it("runs one-time idempotent legacy migration without re-importing deleted items", async () => {
    const root = makeTempDir();
    const dirA = path.join(root, "legacy-a");
    fs.mkdirSync(dirA);
    const ledgerPath = path.join(root, "workspaces.json");
    const registry = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });

    let ledger = await registry.migrateLegacy({
      sourceKey: "desktop-v1",
      workspaces: [{ id: "proj_old_1", name: "Legacy A", path: dirA }],
      pinnedSessionIds: ["s-pin"],
      archivedSessionIds: ["s-arch"],
      collapsedWorkspaceIds: ["proj_old_1"],
    });
    expect(ledger.workspaces).toHaveLength(1);
    expect(ledger.collapsedWorkspaceIds).toEqual([ledger.workspaces[0].id]);

    // User removes workspace; re-running migration must NOT resurrect it
    await registry.removeWorkspace(ledger.workspaces[0].id);
    ledger = await registry.migrateLegacy({
      sourceKey: "desktop-v1",
      workspaces: [{ id: "proj_old_1", name: "Legacy A", path: dirA }],
    });
    expect(ledger.workspaces).toHaveLength(0);
    registry.dispose();
  });

  it("importProjectGroup atomically creates/canonicalizes a workspace and attaches all sessions in a single write", async () => {
    const root = makeTempDir();
    const realProject = path.join(root, "desktop-project");
    const symlinkProject = path.join(root, "desktop-project-link");
    const otherProject = path.join(root, "other-project");
    fs.mkdirSync(realProject);
    fs.mkdirSync(otherProject);
    fs.symlinkSync(realProject, symlinkProject);

    const ledgerPath = path.join(root, "workspaces.json");
    const registry = new WorkspaceRegistry({
      filePath: ledgerPath,
      enableWatch: false,
    });

    // Put s2 in another workspace first to verify single-owner invariant during import
    const other = await registry.ensureWorkspace(otherProject);
    await registry.attachSession(other.workspace.id, "s2");

    let changeEvents = 0;
    const unsub = registry.subscribe(() => {
      changeEvents += 1;
    });

    const first = await registry.importProjectGroup(`${symlinkProject}/`, {
      name: "Claude Desktop Project",
      sessionIds: ["s1", "s2", "s1", "  ", "s3"],
    });

    expect(first.created).toBe(true);
    expect(changeEvents).toBe(1);
    expect(first.workspace.name).toBe("Claude Desktop Project");
    expect(first.workspace.canonicalPath).toBe(
      canonicalizeWorkspacePath(realProject).canonicalPath
    );
    expect(first.workspace.sessionIds).toEqual(["s1", "s2", "s3"]);
    // s2 was moved out of otherProject
    const updatedOther = first.ledger.workspaces.find(
      (w) => w.id === other.workspace.id
    )!;
    expect(updatedOther.sessionIds).toEqual([]);

    // Re-importing via the real path reuses the same workspace and merges new sessions
    const second = await registry.importProjectGroup(realProject, {
      sessionIds: ["s4", "s2"],
    });

    expect(second.created).toBe(false);
    expect(changeEvents).toBe(2);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.workspace.name).toBe("Claude Desktop Project");
    expect(second.workspace.sessionIds).toEqual(["s4", "s2", "s1", "s3"]);

    // Verify persisted on disk
    const reloaded = await registry.load();
    const persisted = reloaded.workspaces.find(
      (w) => w.id === first.workspace.id
    )!;
    expect(persisted.sessionIds).toEqual(["s4", "s2", "s1", "s3"]);

    unsub();
    registry.dispose();
  });
});
