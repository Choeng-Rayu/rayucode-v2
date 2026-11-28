import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  checkoutGitBranch,
  discardGitFile,
  getGitChanges,
  parsePorcelainZStatus,
  parseUnifiedDiff,
} from "../git-bridge"

describe("git-bridge parseUnifiedDiff", () => {
  it("parses hunk headers, context, additions, and deletions with accurate line numbers", () => {
    const sample = [
      "diff --git a/src/lookup.rs b/src/lookup.rs",
      "index 1111111..2222222 100644",
      "--- a/src/lookup.rs",
      "+++ b/src/lookup.rs",
      "@@ -10,4 +10,5 @@ pub fn lookup() {",
      " let id = key;",
      "-legacy_cache.get(id)",
      "+shard_store.lookup(id)",
      "+shard_store.touch_lru(id);",
      " Ok(())",
    ].join("\n")

    const lines = parseUnifiedDiff(sample)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatchObject({ type: "hunk", lineNumber: null, mark: "@@" })
    expect(lines[1]).toMatchObject({ type: "ctx", lineNumber: 10, content: "let id = key;" })
    expect(lines[2]).toMatchObject({ type: "del", lineNumber: 11, mark: "-", content: "legacy_cache.get(id)" })
    expect(lines[3]).toMatchObject({ type: "add", lineNumber: 11, mark: "+", content: "shard_store.lookup(id)" })
    expect(lines[4]).toMatchObject({ type: "add", lineNumber: 12, mark: "+", content: "shard_store.touch_lru(id);" })
    expect(lines[5]).toMatchObject({ type: "ctx", lineNumber: 13, content: "Ok(())" })
  })

  it("returns empty array for empty diff output", () => {
    expect(parseUnifiedDiff("")).toEqual([])
    expect(parseUnifiedDiff("   \n  ")).toEqual([])
  })
})

describe("git-bridge NUL parser, >40 changes, staged-safe discard, and dirty checkout", () => {
  it("parses NUL-delimited porcelain records including renames and literal arrow names", () => {
    const raw =
      "?? a -> b.rs\0" +
      "M  café ✓ file.txt\0" +
      "R  new -> name.ts\0old name.ts\0"
    const parsed = parsePorcelainZStatus(raw)
    expect(parsed).toEqual([
      {
        path: "a -> b.rs",
        indexStatus: "?",
        workTreeStatus: "?",
      },
      {
        path: "café ✓ file.txt",
        indexStatus: "M",
        workTreeStatus: " ",
      },
      {
        path: "new -> name.ts",
        previousPath: "old name.ts",
        indexStatus: "R",
        workTreeStatus: " ",
      },
    ])
  })

  it("lists >40 changed files, preserves staged hunks during worktree discard, and fails closed on dirty checkout", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-git-test-"))
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" })

    try {
      git(["init", "-b", "main"])
      git(["config", "user.email", "test@rayucode.dev"])
      git(["config", "user.name", "Rayu Test"])

      fs.writeFileSync(path.join(repo, "staged.txt"), "base\n", "utf8")
      fs.writeFileSync(path.join(repo, "a -> b.rs"), "fn main() {}\n", "utf8")
      git(["add", "."])
      git(["commit", "-m", "initial"])

      git(["checkout", "-b", "feature"])
      fs.writeFileSync(path.join(repo, "staged.txt"), "feature change\n", "utf8")
      git(["add", "staged.txt"])
      git(["commit", "-m", "feature commit"])
      git(["checkout", "main"])

      // Modify >40 untracked files + a literal arrow filename + staged/unstaged mix
      for (let i = 0; i < 42; i += 1) {
        fs.writeFileSync(path.join(repo, `file_${i}.txt`), `line ${i}\n`, "utf8")
      }
      fs.writeFileSync(path.join(repo, "a -> b.rs"), "fn main() { /* edited */ }\n", "utf8")
      fs.writeFileSync(path.join(repo, "staged.txt"), "staged line\n", "utf8")
      git(["add", "staged.txt"])
      fs.writeFileSync(path.join(repo, "staged.txt"), "staged line\nunstaged noise\n", "utf8")

      const changes = await getGitChanges(repo)
      expect(changes).not.toBeNull()
      expect(changes!.totalChangedFiles).toBe(44)
      expect(changes!.files).toHaveLength(44)
      expect(changes!.files.some((f) => f.path === "a -> b.rs")).toBe(true)

      // discardGitFile must discard only unstaged noise while keeping staged hunk intact
      await discardGitFile(repo, "staged.txt")
      expect(fs.readFileSync(path.join(repo, "staged.txt"), "utf8")).toBe(
        "staged line\n"
      )

      // checkoutGitBranch must report ok: false when uncommitted changes conflict
      const dirtySwitch = await checkoutGitBranch(repo, "feature")
      expect(dirtySwitch.ok).toBe(false)
      expect(dirtySwitch.branch).toBe("main")
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
