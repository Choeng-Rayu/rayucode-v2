import { describe, expect, it } from "vitest"

import { parseUnifiedDiff } from "../git-bridge"

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
