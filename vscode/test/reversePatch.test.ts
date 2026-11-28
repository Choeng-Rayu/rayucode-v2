import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GitChangesBridge } from "../host/bridges/gitChangesBridge.js";
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

test("legacy agent undo preserves tracked manual edits and untracked files byte-for-byte", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-git-review-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  const tracked = path.join(root, "tracked.txt");
  const untracked = path.join(root, "untracked.txt");
  fs.writeFileSync(tracked, "original\n");
  git("add", "--", tracked);
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Fixture",
  );

  // Manual-only modification to a tracked file + brand-new untracked file (with CRLF & trailing bytes)
  const trackedManualBytes = Buffer.from("original\r\nmanual edit line\r\n# keep exact bytes\n", "utf8");
  const untrackedManualBytes = Buffer.from("untracked manual content\r\n\tindented\n", "utf8");
  fs.writeFileSync(tracked, trackedManualBytes);
  fs.writeFileSync(untracked, untrackedManualBytes);

  const bridge = new GitChangesBridge(() => root);

  // Legacy undo without recorded session baseline must refuse both absolute & relative paths,
  // with or without sessionId, and leave exact bytes untouched on disk.
  const cases: Array<{ target: string; diskPath: string; expected: Buffer; sessionId?: string }> = [
    { target: tracked, diskPath: tracked, expected: trackedManualBytes, sessionId: "legacy" },
    { target: "tracked.txt", diskPath: tracked, expected: trackedManualBytes, sessionId: "legacy" },
    { target: tracked, diskPath: tracked, expected: trackedManualBytes, sessionId: undefined },
    { target: untracked, diskPath: untracked, expected: untrackedManualBytes, sessionId: "legacy" },
    { target: "untracked.txt", diskPath: untracked, expected: untrackedManualBytes, sessionId: "legacy" },
    { target: untracked, diskPath: untracked, expected: untrackedManualBytes, sessionId: undefined },
  ];

  for (const { target, diskPath, expected, sessionId } of cases) {
    const res = await bridge.undo({ path: target, sessionId });
    assert.equal(res.ok, false);
    assert.equal(fs.existsSync(diskPath), true);
    const after = fs.readFileSync(diskPath);
    assert.equal(Buffer.compare(after, expected), 0);
    assert.deepEqual(after, expected);
  }
});

test("GitChangesBridge.undo with recorded session edit refuses conflicting manual edits and preserves exact bytes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-git-conflict-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");

  const tracked = path.join(root, "app.ts");
  const untracked = path.join(root, "new-helper.ts");
  fs.writeFileSync(tracked, "export const v = 1;\n");
  git("add", "--", tracked);
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Initial",
  );

  const bridge = new GitChangesBridge(() => root);
  bridge.recordSessionFileEdit({
    sessionId: "sess_conflict",
    filePath: tracked,
    beforeContent: "export const v = 1;\n",
    afterContent: "export const v = 2;\n",
  });
  bridge.recordSessionFileEdit({
    sessionId: "sess_conflict",
    filePath: untracked,
    beforeContent: undefined,
    afterContent: "export const helper = true;\n",
  });

  // User subsequently edits both files manually on disk
  const trackedBytes = Buffer.from("export const v = 99; // manual user edit\n", "utf8");
  const untrackedBytes = Buffer.from("export const helper = false; // manual user edit\n", "utf8");
  fs.writeFileSync(tracked, trackedBytes);
  fs.writeFileSync(untracked, untrackedBytes);

  for (const [filePath, expected] of [
    [tracked, trackedBytes],
    [untracked, untrackedBytes],
  ] as const) {
    const res = await bridge.undo({ path: filePath, sessionId: "sess_conflict" });
    assert.equal(res.ok, false);
    assert.equal(res.conflict, true);
    assert.equal(fs.existsSync(filePath), true);
    const actual = fs.readFileSync(filePath);
    assert.equal(Buffer.compare(actual, expected), 0);
    assert.deepEqual(actual, expected);
  }
});
