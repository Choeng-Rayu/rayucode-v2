import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeUnifiedDiff,
  parseUnifiedDiffHunks,
  reversePatch,
  tryReversePatch,
  verifyHunksMatchContent,
} from "../host/bridges/reversePatch.js";

test("computeUnifiedDiff and reversePatch roundtrip single and multi-line edits", () => {
  const before = [
    "import { x } from './a.js';",
    "export function greet(name: string) {",
    "  return 'hello ' + name;",
    "}",
    "",
  ].join("\n");

  const after = [
    "import { x } from './a.js';",
    "export function greet(name: string, punctuation = '!') {",
    "  const prefix = 'Hello, ';",
    "  return prefix + name + punctuation;",
    "}",
    "",
  ].join("\n");

  const diff = computeUnifiedDiff("src/greet.ts", before, after);
  assert.equal(diff.additions, 3);
  assert.equal(diff.deletions, 2);
  assert.equal(diff.hunks.length, 1);

  const parsedHunks = parseUnifiedDiffHunks(diff.unifiedDiff);
  assert.deepEqual(parsedHunks, diff.hunks);

  const check = verifyHunksMatchContent(after, parsedHunks);
  assert.equal(check.matches, true);

  const restored = reversePatch(after, parsedHunks);
  assert.equal(restored, before);
});

test("tryReversePatch refuses to clobber manual user edits made after Rayu's edit", () => {
  const before = "line 1\nline 2\nline 3\n";
  const afterRayu = "line 1\nline 2 modified by rayu\nline 3\n";
  const afterManualUserEdit = "line 1\nline 2 modified by user by hand\nline 3\n";

  const diff = computeUnifiedDiff("file.txt", before, afterRayu);

  const conflictResult = tryReversePatch(afterManualUserEdit, diff.hunks);
  assert.equal(conflictResult.ok, false);
  if (!conflictResult.ok) {
    assert.equal(conflictResult.conflict, true);
    assert.match(conflictResult.message, /Line 2 was modified/);
  }

  const cleanResult = tryReversePatch(afterRayu, diff.unifiedDiff);
  assert.equal(cleanResult.ok, true);
  if (cleanResult.ok) {
    assert.equal(cleanResult.content, before);
  }
});
