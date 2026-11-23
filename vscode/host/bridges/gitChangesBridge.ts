import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ChangedFileStatus,
  ChangedFileView,
  ChangesStatusView,
  FileDiffView,
  FileReviewDecision,
} from "../../shared/vscodeProtocol.js";
import {
  computeUnifiedDiff,
  tryReversePatch,
  type ReviewHunk,
} from "./reversePatch.js";

const execFileAsync = promisify(execFile);

interface SessionFileEditRecord {
  path: string;
  beforeContent: string;
  wasUntracked: boolean;
  hunks: ReviewHunk[];
  decision: FileReviewDecision;
  ownerBadge?: string;
}

function inferLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rs": "rust",
    ".py": "python",
    ".go": "go",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".html": "html",
    ".toml": "toml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".sh": "shellscript",
    ".sql": "sql",
  };
  return map[ext] ?? "plaintext";
}

function parsePorcelainStatus(xy: string): {
  status: ChangedFileStatus;
  staged: boolean;
} {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (xy === "??") {
    return { status: "untracked", staged: false };
  }
  const staged = x !== " " && x !== "?";
  const code = staged && y === " " ? x : y !== " " ? y : x;
  switch (code) {
    case "A":
      return { status: "added", staged };
    case "D":
      return { status: "deleted", staged };
    case "R":
      return { status: "renamed", staged };
    default:
      return { status: "modified", staged };
  }
}

export class GitChangesBridge {
  private readonly sessionEdits = new Map<string, Map<string, SessionFileEditRecord>>();
  private readonly fileDecisions = new Map<string, FileReviewDecision>();
  private hasGhCliCached: boolean | undefined;

  constructor(private readonly getWorkspaceRoot: () => string | undefined) {}

  private resolveRoot(overrideRoot?: string): string {
    return overrideRoot || this.getWorkspaceRoot() || process.cwd();
  }

  private async runGit(args: string[], cwd?: string): Promise<string> {
    const root = this.resolveRoot(cwd);
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }

  private async checkHasGhCli(): Promise<boolean> {
    if (this.hasGhCliCached !== undefined) return this.hasGhCliCached;
    try {
      await execFileAsync("gh", ["--version"], { timeout: 3000 });
      this.hasGhCliCached = true;
    } catch {
      this.hasGhCliCached = false;
    }
    return this.hasGhCliCached;
  }

  /**
   * Record a session file edit so `changes.diff` and `changes.undo` know the
   * pre-edit baseline and hunks for that session.
   */
  recordSessionFileEdit(options: {
    sessionId: string;
    filePath: string;
    beforeContent?: string;
    afterContent?: string;
    hunks?: ReviewHunk[];
    ownerBadge?: string;
  }): void {
    const root = this.resolveRoot();
    const relPath = path.isAbsolute(options.filePath)
      ? path.relative(root, options.filePath).replace(/\\/g, "/")
      : options.filePath.replace(/\\/g, "/");

    let map = this.sessionEdits.get(options.sessionId);
    if (!map) {
      map = new Map();
      this.sessionEdits.set(options.sessionId, map);
    }

    const existing = map.get(relPath);
    const beforeContent = existing?.beforeContent ?? options.beforeContent ?? "";
    const absPath = path.resolve(root, relPath);
    let afterContent = options.afterContent;
    if (afterContent === undefined) {
      try {
        afterContent = fs.readFileSync(absPath, "utf8");
      } catch {
        afterContent = "";
      }
    }

    const hunks =
      options.hunks ??
      computeUnifiedDiff(relPath, beforeContent, afterContent).hunks;

    map.set(relPath, {
      path: relPath,
      beforeContent,
      wasUntracked: existing?.wasUntracked ?? options.beforeContent === undefined,
      hunks,
      decision: existing?.decision ?? "pending",
      ownerBadge: options.ownerBadge ?? existing?.ownerBadge ?? "session",
    });
    this.fileDecisions.set(relPath, "pending");
  }

  async getBranch(cwd?: string): Promise<string> {
    try {
      const out = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
      return out.trim() || "HEAD";
    } catch {
      return "main";
    }
  }

  async listBranches(cwd?: string): Promise<{ current: string; branches: string[] }> {
    const current = await this.getBranch(cwd);
    try {
      const out = await this.runGit(
        ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
        cwd,
      );
      const branches = out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (!branches.includes(current)) branches.unshift(current);
      return { current, branches };
    } catch {
      return { current, branches: [current] };
    }
  }

  async checkoutBranch(workspacePath: string, branch: string): Promise<{ ok: boolean; branch: string }> {
    await this.runGit(["checkout", branch], workspacePath);
    const current = await this.getBranch(workspacePath);
    return { ok: true, branch: current };
  }

  async getStatus(options: {
    sessionId?: string;
    scope?: "session" | "git";
  } = {}): Promise<ChangesStatusView> {
    const root = this.resolveRoot();
    const [branch, hasGhCli] = await Promise.all([
      this.getBranch(root),
      this.checkHasGhCli(),
    ]);

    const numstatMap = new Map<string, { additions: number; deletions: number }>();
    try {
      const [unstagedStat, stagedStat] = await Promise.all([
        this.runGit(["diff", "--numstat"], root).catch(() => ""),
        this.runGit(["diff", "--cached", "--numstat"], root).catch(() => ""),
      ]);
      for (const raw of [unstagedStat, stagedStat]) {
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          const [addStr, delStr, filePart] = line.split("\t");
          if (!filePart) continue;
          const cleanPath = filePart.replace(/\\/g, "/");
          const prev = numstatMap.get(cleanPath) ?? { additions: 0, deletions: 0 };
          const add = Number.parseInt(addStr ?? "0", 10);
          const del = Number.parseInt(delStr ?? "0", 10);
          numstatMap.set(cleanPath, {
            additions: prev.additions + (Number.isFinite(add) ? add : 0),
            deletions: prev.deletions + (Number.isFinite(del) ? del : 0),
          });
        }
      }
    } catch {
      // non-git directory
    }

    const sessionMap = options.sessionId
      ? this.sessionEdits.get(options.sessionId)
      : undefined;

    const files: ChangedFileView[] = [];
    try {
      const porcelain = await this.runGit(["status", "--porcelain=v1"], root);
      for (const rawLine of porcelain.split("\n")) {
        if (rawLine.length < 4) continue;
        const xy = rawLine.slice(0, 2);
        const rawPath = rawLine.slice(3).trim();
        let filePath = rawPath;
        let oldPath: string | undefined;
        if (rawPath.includes(" -> ")) {
          const parts = rawPath.split(" -> ");
          oldPath = parts[0]?.trim();
          filePath = parts[1]?.trim() || rawPath;
        }
        filePath = filePath.replace(/^"|"$/g, "").replace(/\\/g, "/");

        const { status, staged } = parsePorcelainStatus(xy);
        let stats = numstatMap.get(filePath);
        if (!stats && status === "untracked") {
          try {
            const abs = path.join(root, filePath);
            const st = fs.statSync(abs);
            if (st.isFile() && st.size < 512_000) {
              const content = fs.readFileSync(abs, "utf8");
              stats = {
                additions: content ? content.split("\n").length : 0,
                deletions: 0,
              };
            }
          } catch {
            // ignore
          }
        }

        const sessionRecord = sessionMap?.get(filePath);
        const fromSession = Boolean(sessionRecord);
        const decision =
          sessionRecord?.decision ?? this.fileDecisions.get(filePath) ?? "pending";

        if (options.scope === "session" && sessionMap && sessionMap.size > 0 && !fromSession) {
          continue;
        }

        files.push({
          path: filePath,
          status,
          staged,
          additions: stats?.additions ?? 0,
          deletions: stats?.deletions ?? 0,
          ownerBadge: sessionRecord?.ownerBadge,
          decision,
          fromSession,
          oldPath,
        });
      }
    } catch {
      // Not a git repository; fall back to session edits if any
      if (sessionMap) {
        for (const rec of sessionMap.values()) {
          files.push({
            path: rec.path,
            status: "modified",
            staged: false,
            additions: rec.hunks.reduce(
              (acc, h) => acc + h.lines.filter((l) => l.startsWith("+")).length,
              0,
            ),
            deletions: rec.hunks.reduce(
              (acc, h) => acc + h.lines.filter((l) => l.startsWith("-")).length,
              0,
            ),
            ownerBadge: rec.ownerBadge,
            decision: rec.decision,
            fromSession: true,
          });
        }
      }
    }

    let totalAdditions = 0;
    let totalDeletions = 0;
    let stagedCount = 0;
    for (const file of files) {
      totalAdditions += file.additions;
      totalDeletions += file.deletions;
      if (file.staged) stagedCount += 1;
    }

    return {
      branch,
      baseBranch: branch === "main" ? "main" : "main",
      totalAdditions,
      totalDeletions,
      files,
      stagedCount,
      hasGhCli,
    };
  }

  private async readGitHeadFile(relPath: string, root: string): Promise<string> {
    try {
      return await this.runGit(["show", `HEAD:${relPath}`], root);
    } catch {
      return "";
    }
  }

  async getDiff(options: {
    path: string;
    sessionId?: string;
    scope?: "session" | "git";
  }): Promise<FileDiffView> {
    const root = this.resolveRoot();
    const relPath = path.isAbsolute(options.path)
      ? path.relative(root, options.path).replace(/\\/g, "/")
      : options.path.replace(/\\/g, "/");
    const absPath = path.resolve(root, relPath);

    let modifiedContent = "";
    let isBinary = false;
    try {
      const buf = fs.readFileSync(absPath);
      if (buf.includes(0)) {
        isBinary = true;
      } else {
        modifiedContent = buf.toString("utf8");
      }
    } catch {
      modifiedContent = "";
    }

    if (isBinary) {
      return {
        path: relPath,
        originalContent: "",
        modifiedContent: "",
        unifiedDiff: "Binary file differs",
        additions: 0,
        deletions: 0,
        languageId: inferLanguageId(relPath),
        isBinary: true,
      };
    }

    const sessionRecord = options.sessionId
      ? this.sessionEdits.get(options.sessionId)?.get(relPath)
      : undefined;

    const originalContent =
      options.scope === "session" && sessionRecord
        ? sessionRecord.beforeContent
        : await this.readGitHeadFile(relPath, root);

    const diff = computeUnifiedDiff(relPath, originalContent, modifiedContent);
    return {
      path: relPath,
      originalContent,
      modifiedContent,
      unifiedDiff: diff.unifiedDiff,
      additions: diff.additions,
      deletions: diff.deletions,
      languageId: inferLanguageId(relPath),
      isBinary: false,
    };
  }

  async stage(paths: string[]): Promise<{ ok: boolean; message?: string }> {
    const root = this.resolveRoot();
    await this.runGit(["add", "--", ...paths], root);
    return { ok: true, message: `Staged ${paths.length} file(s).` };
  }

  async unstage(paths: string[]): Promise<{ ok: boolean; message?: string }> {
    const root = this.resolveRoot();
    try {
      await this.runGit(["restore", "--staged", "--", ...paths], root);
    } catch {
      await this.runGit(["reset", "HEAD", "--", ...paths], root);
    }
    return { ok: true, message: `Unstaged ${paths.length} file(s).` };
  }

  keep(options: { path: string; sessionId?: string }): { ok: boolean; message?: string } {
    const root = this.resolveRoot();
    const relPath = path.isAbsolute(options.path)
      ? path.relative(root, options.path).replace(/\\/g, "/")
      : options.path.replace(/\\/g, "/");

    this.fileDecisions.set(relPath, "accepted");
    if (options.sessionId) {
      const rec = this.sessionEdits.get(options.sessionId)?.get(relPath);
      if (rec) rec.decision = "accepted";
    }
    return { ok: true, message: `Accepted changes in ${relPath}.` };
  }

  async undo(options: {
    path: string;
    sessionId?: string;
  }): Promise<{ ok: boolean; conflict?: boolean; message?: string }> {
    const root = this.resolveRoot();
    const relPath = path.isAbsolute(options.path)
      ? path.relative(root, options.path).replace(/\\/g, "/")
      : options.path.replace(/\\/g, "/");
    const absPath = path.resolve(root, relPath);

    let currentContent = "";
    let fileExists = false;
    try {
      currentContent = fs.readFileSync(absPath, "utf8");
      fileExists = true;
    } catch {
      fileExists = false;
    }

    const sessionRecord = options.sessionId
      ? this.sessionEdits.get(options.sessionId)?.get(relPath)
      : undefined;

    if (sessionRecord) {
      const reversed = tryReversePatch(currentContent, sessionRecord.hunks);
      if (!reversed.ok) {
        return {
          ok: false,
          conflict: true,
          message: reversed.message,
        };
      }
      if (sessionRecord.wasUntracked && reversed.content === "") {
        try {
          fs.unlinkSync(absPath);
        } catch {
          // ignore
        }
      } else {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, reversed.content, "utf8");
      }
      sessionRecord.decision = "rejected";
      this.fileDecisions.set(relPath, "rejected");
      return { ok: true, conflict: false, message: `Reverted changes in ${relPath}.` };
    }

    // Fallback: reverse diff between HEAD and current disk file
    const headContent = await this.readGitHeadFile(relPath, root);
    if (!fileExists && headContent) {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, headContent, "utf8");
      this.fileDecisions.set(relPath, "rejected");
      return { ok: true, conflict: false, message: `Restored ${relPath} from HEAD.` };
    }

    const computed = computeUnifiedDiff(relPath, headContent, currentContent);
    const reversed = tryReversePatch(currentContent, computed.hunks);
    if (!reversed.ok) {
      return {
        ok: false,
        conflict: true,
        message: reversed.message,
      };
    }

    if (headContent === "" && reversed.content === "") {
      try {
        fs.unlinkSync(absPath);
      } catch {
        // ignore
      }
    } else {
      fs.writeFileSync(absPath, reversed.content, "utf8");
    }
    this.fileDecisions.set(relPath, "rejected");
    return { ok: true, conflict: false, message: `Reverted ${relPath} to HEAD.` };
  }

  async commit(message: string): Promise<{
    ok: boolean;
    commitHash?: string;
    summary?: string;
  }> {
    const root = this.resolveRoot();
    const out = await this.runGit(["commit", "-m", message], root);
    const hashOut = await this.runGit(["rev-parse", "--short", "HEAD"], root).catch(
      () => "",
    );
    return {
      ok: true,
      commitHash: hashOut.trim() || undefined,
      summary: out.trim().split("\n")[0] || "Committed staged changes.",
    };
  }

  /**
   * Execute `gh pr create` ONLY after explicit user confirmation from the webview Dialog.
   */
  async createPr(options: {
    baseBranch: string;
    headBranch: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<{ ok: boolean; url?: string; number?: number }> {
    const root = this.resolveRoot();
    const args = [
      "pr",
      "create",
      "--base",
      options.baseBranch,
      "--head",
      options.headBranch,
      "--title",
      options.title,
      "--body",
      options.body,
    ];
    if (options.draft) {
      args.push("--draft");
    }

    const { stdout } = await execFileAsync("gh", args, {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
    });
    const url = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("http://") || line.startsWith("https://"));
    const match = url ? /\/pull\/(\d+)/.exec(url) : null;
    const number = match ? Number.parseInt(match[1]!, 10) : undefined;

    return {
      ok: true,
      url,
      number,
    };
  }
}
