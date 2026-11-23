import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface GitDiffHunkLine {
  lineNumber: number | null
  type: "hunk" | "ctx" | "add" | "del"
  mark: string
  content: string
}

export interface GitChangedFile {
  id: string
  path: string
  additions: number
  deletions: number
  deleted?: boolean
  ownerBadge: string
  hint: string
  accepted?: boolean
  rejected?: boolean
  staged: boolean
  lines: GitDiffHunkLine[]
}

export interface GitChangesPayload {
  branch: string
  totalAdditions: number
  totalDeletions: number
  files: GitChangedFile[]
}

export interface GitCommitReceipt {
  hash: string
  branch: string
  message: string
  committedCount: number
  committedAt: string
}

export interface GitCreatePrReceipt {
  id: string
  url: string
  baseBranch: string
  headBranch: string
  title: string
  summary: string
  createdAt: string
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

export function parseUnifiedDiff(diffText: string): GitDiffHunkLine[] {
  if (!diffText.trim()) return []
  const rawLines = diffText.split("\n")
  const result: GitDiffHunkLine[] = []
  let newLineNum = 1
  let oldLineNum = 1
  let inHunk = false

  for (const raw of rawLines) {
    if (
      raw.startsWith("diff --git ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file mode ") ||
      raw.startsWith("deleted file mode ") ||
      raw.startsWith("similarity index ") ||
      raw.startsWith("rename from ") ||
      raw.startsWith("rename to ")
    ) {
      continue
    }

    if (raw.startsWith("@@")) {
      inHunk = true
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
      if (match) {
        oldLineNum = Number.parseInt(match[1], 10)
        newLineNum = Number.parseInt(match[2], 10)
      }
      result.push({
        lineNumber: null,
        type: "hunk",
        mark: "@@",
        content: raw,
      })
      continue
    }

    if (!inHunk) continue
    if (raw.startsWith("\\ No newline at end of file")) continue

    if (raw.startsWith("+")) {
      result.push({
        lineNumber: newLineNum++,
        type: "add",
        mark: "+",
        content: raw.slice(1),
      })
    } else if (raw.startsWith("-")) {
      result.push({
        lineNumber: oldLineNum++,
        type: "del",
        mark: "-",
        content: raw.slice(1),
      })
    } else if (raw.startsWith(" ")) {
      result.push({
        lineNumber: newLineNum++,
        type: "ctx",
        mark: " ",
        content: raw.slice(1),
      })
      oldLineNum++
    }
  }

  return result
}

function parseNumstat(output: string): Map<string, { add: number; del: number }> {
  const map = new Map<string, { add: number; del: number }>()
  for (const line of output.split("\n")) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const add = parts[0] === "-" ? 0 : Number.parseInt(parts[0], 10) || 0
    const del = parts[1] === "-" ? 0 : Number.parseInt(parts[1], 10) || 0
    const filePath = parts.slice(2).join("\t")
    const prev = map.get(filePath) ?? { add: 0, del: 0 }
    map.set(filePath, { add: prev.add + add, del: prev.del + del })
  }
  return map
}

export async function getGitBranch(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
    return out.trim() || null
  } catch {
    return null
  }
}

export async function getGitChanges(
  cwd: string
): Promise<GitChangesPayload | null> {
  const branch = await getGitBranch(cwd)
  if (!branch) return null

  const [statusOut, unstagedStatOut, stagedStatOut] = await Promise.all([
    runGit(cwd, ["status", "--porcelain=v1", "-uall"]),
    runGit(cwd, ["diff", "--numstat"]),
    runGit(cwd, ["diff", "--cached", "--numstat"]),
  ])

  const unstagedStats = parseNumstat(unstagedStatOut)
  const stagedStats = parseNumstat(stagedStatOut)

  const entries: Array<{
    path: string
    indexStatus: string
    workTreeStatus: string
  }> = []

  for (const line of statusOut.split("\n")) {
    if (line.length < 4) continue
    const indexStatus = line[0]
    const workTreeStatus = line[1]
    let filePath = line.slice(3).trim()
    if (filePath.includes(" -> ")) {
      filePath = filePath.split(" -> ").pop()?.trim() ?? filePath
    }
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1)
    }
    if (!filePath) continue
    entries.push({ path: filePath, indexStatus, workTreeStatus })
  }

  // Cap per-refresh diff reads at 40 files to stay responsive on huge worktrees
  const limited = entries.slice(0, 40)
  const files: GitChangedFile[] = await Promise.all(
    limited.map(async (entry, idx) => {
      const staged =
        entry.indexStatus !== " " && entry.indexStatus !== "?"
      const deleted =
        entry.indexStatus === "D" || entry.workTreeStatus === "D"
      const untracked = entry.indexStatus === "?" && entry.workTreeStatus === "?"

      const uStat = unstagedStats.get(entry.path) ?? { add: 0, del: 0 }
      const sStat = stagedStats.get(entry.path) ?? { add: 0, del: 0 }
      let additions = uStat.add + sStat.add
      let deletions = uStat.del + sStat.del

      let diffText: string
      try {
        if (untracked) {
          // Synthesize unified preview for untracked file
          const rawDiff = await runGit(cwd, [
            "diff",
            "--no-index",
            "--",
            "/dev/null",
            entry.path,
          ]).catch((err: { stdout?: string }) => err.stdout ?? "")
          diffText = rawDiff
        } else if (staged && entry.workTreeStatus === " ") {
          diffText = await runGit(cwd, ["diff", "--cached", "--", entry.path])
        } else {
          diffText = await runGit(cwd, ["diff", "HEAD", "--", entry.path]).catch(
            () => runGit(cwd, ["diff", "--", entry.path])
          )
        }
      } catch {
        diffText = ""
      }

      const lines = parseUnifiedDiff(diffText)
      if (additions === 0 && deletions === 0 && lines.length > 0) {
        additions = lines.filter((l) => l.type === "add").length
        deletions = lines.filter((l) => l.type === "del").length
      }

      const statusHint = deleted
        ? "Deleted in working tree"
        : untracked
          ? "Untracked new file"
          : staged
            ? "Staged for commit"
            : "Modified in working tree"

      return {
        id: `git_${idx}_${entry.path}`,
        path: entry.path,
        additions,
        deletions,
        deleted: deleted || undefined,
        ownerBadge: staged ? "staged" : untracked ? "new" : "workspace",
        hint: statusHint,
        staged,
        lines:
          lines.length > 0
            ? lines
            : [
                {
                  lineNumber: null,
                  type: "hunk" as const,
                  mark: "@@",
                  content: `@@ ${statusHint}: ${entry.path} @@`,
                },
              ],
      }
    })
  )

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

  return {
    branch,
    totalAdditions,
    totalDeletions,
    files,
  }
}

export async function toggleGitStage(
  cwd: string,
  filePath: string,
  currentlyStaged: boolean
): Promise<GitChangesPayload | null> {
  if (currentlyStaged) {
    await runGit(cwd, ["reset", "HEAD", "--", filePath])
  } else {
    await runGit(cwd, ["add", "--", filePath])
  }
  return getGitChanges(cwd)
}

export async function setAllGitStaged(
  cwd: string,
  staged: boolean
): Promise<GitChangesPayload | null> {
  if (staged) {
    await runGit(cwd, ["add", "-A"])
  } else {
    await runGit(cwd, ["reset", "HEAD"])
  }
  return getGitChanges(cwd)
}

export async function discardGitFile(
  cwd: string,
  filePath: string
): Promise<GitChangesPayload | null> {
  await runGit(cwd, ["checkout", "HEAD", "--", filePath]).catch(async () => {
    await runGit(cwd, ["checkout", "--", filePath])
  })
  return getGitChanges(cwd)
}

export async function commitGitStaged(
  cwd: string,
  message: string
): Promise<GitCommitReceipt> {
  const before = await getGitChanges(cwd)
  const stagedCount = before?.files.filter((f) => f.staged).length ?? 0
  if (stagedCount === 0) {
    throw new Error("No staged files to commit")
  }
  await runGit(cwd, ["commit", "-m", message])
  const [hashOut, branchOut] = await Promise.all([
    runGit(cwd, ["rev-parse", "--short", "HEAD"]),
    runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ])
  return {
    hash: hashOut.trim(),
    branch: branchOut.trim(),
    message,
    committedCount: stagedCount,
    committedAt: "Just now",
  }
}

export async function createGitPullRequest(
  cwd: string,
  input: {
    baseBranch: string
    headBranch: string
    title: string
    summary: string
  }
): Promise<GitCreatePrReceipt> {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "pr",
      "create",
      "--base",
      input.baseBranch,
      "--head",
      input.headBranch,
      "--title",
      input.title,
      "--body",
      input.summary,
    ],
    { cwd, maxBuffer: 2 * 1024 * 1024 }
  )
  const url =
    stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("https://")) ?? stdout.trim()
  const prMatch = /\/pull\/(\d+)/.exec(url)
  return {
    id: prMatch ? `pr_${prMatch[1]}` : `pr_${Date.now()}`,
    url,
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    title: input.title,
    summary: input.summary,
    createdAt: "Just now",
  }
}
