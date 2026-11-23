/**
 * Pure, dependency-free unified diff parser, hunk verifier, and safe reverse-patcher.
 *
 * Free of `vscode` imports so it can be unit-tested directly under `node --test`.
 * Refuses to clobber manual user edits made after Rayu's recorded change.
 */

export interface ReviewHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Unified-diff lines, each prefixed with ' ', '-', '+', or '\'. */
  lines: string[];
}

export interface ReversePatchVerification {
  matches: boolean;
  conflictLine?: number;
  reason?: string;
}

export type SafeReversePatchResult =
  | { ok: true; content: string }
  | { ok: false; conflict: true; message: string };

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Parse unified diff text into structured `ReviewHunk[]`.
 */
export function parseUnifiedDiffHunks(unifiedDiff: string): ReviewHunk[] {
  if (!unifiedDiff.trim()) return [];
  const rawLines = unifiedDiff.replace(/\r\n/g, "\n").split("\n");
  const hunks: ReviewHunk[] = [];
  let current: ReviewHunk | null = null;

  for (const line of rawLines) {
    const header = HUNK_HEADER_RE.exec(line);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number.parseInt(header[1]!, 10),
        oldLines: header[2] !== undefined ? Number.parseInt(header[2], 10) : 1,
        newStart: Number.parseInt(header[3]!, 10),
        newLines: header[4] !== undefined ? Number.parseInt(header[4], 10) : 1,
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    if (
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith("\\")
    ) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function splitContentLines(content: string): { lines: string[]; hasTrailingNewline: boolean } {
  if (content === "") {
    return { lines: [], hasTrailingNewline: false };
  }
  const normalized = content.replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const body = hasTrailingNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: body === "" ? [""] : body.split("\n"),
    hasTrailingNewline,
  };
}

/**
 * Verify that every hunk's post-edit lines (`' '` and `'+'`) match `currentContent`
 * at the recorded `newStart` line positions.
 */
export function verifyHunksMatchContent(
  currentContent: string,
  hunks: readonly ReviewHunk[],
): ReversePatchVerification {
  if (hunks.length === 0) return { matches: true };

  const { lines: fileLines } = splitContentLines(currentContent);
  const sorted = [...hunks].sort((a, b) => a.newStart - b.newStart);

  for (const hunk of sorted) {
    let cursor = Math.max(0, hunk.newStart - 1);
    for (const rawLine of hunk.lines) {
      const prefix = rawLine[0];
      if (prefix === "\\" || prefix === "-") {
        continue;
      }
      if (prefix === " " || prefix === "+") {
        const expected = rawLine.slice(1);
        const actual = fileLines[cursor];
        if (actual !== expected) {
          return {
            matches: false,
            conflictLine: cursor + 1,
            reason: `Line ${cursor + 1} was modified since Rayu's edit (expected "${expected}", found "${actual ?? "<EOF>"}").`,
          };
        }
        cursor += 1;
      }
    }
  }

  return { matches: true };
}

/**
 * Reverse-apply recorded hunks to `newContent` to reconstruct the exact pre-edit content.
 * Throws if the file on disk no longer matches the recorded post-edit lines.
 */
export function reversePatch(newContent: string, hunks: readonly ReviewHunk[]): string {
  if (hunks.length === 0) return newContent;

  const usesCrLf = newContent.includes("\r\n");
  const lineEnding = usesCrLf ? "\r\n" : "\n";
  const { lines: fileLines, hasTrailingNewline } = splitContentLines(newContent);
  const sorted = [...hunks].sort((a, b) => a.newStart - b.newStart);

  const verification = verifyHunksMatchContent(newContent, sorted);
  if (!verification.matches) {
    throw new Error(
      `The file no longer matches the recorded Rayu changes. ${verification.reason ?? ""}`.trim(),
    );
  }

  const outLines: string[] = [];
  let fileIndex = 0;
  let oldHadTrailingNewline = hasTrailingNewline;

  for (const hunk of sorted) {
    const hunkStartIdx = Math.max(0, hunk.newStart - 1);
    while (fileIndex < hunkStartIdx && fileIndex < fileLines.length) {
      outLines.push(fileLines[fileIndex]!);
      fileIndex += 1;
    }

    let lastOp: " " | "+" | "-" = " ";
    for (const rawLine of hunk.lines) {
      const prefix = rawLine[0];
      if (prefix === "\\") {
        if (lastOp === "-") {
          oldHadTrailingNewline = false;
        } else if (lastOp === "+") {
          oldHadTrailingNewline = true;
        }
        continue;
      }
      const text = rawLine.slice(1);
      if (prefix === " ") {
        outLines.push(text);
        fileIndex += 1;
        lastOp = " ";
      } else if (prefix === "+") {
        fileIndex += 1;
        lastOp = "+";
      } else if (prefix === "-") {
        outLines.push(text);
        lastOp = "-";
      }
    }
  }

  while (fileIndex < fileLines.length) {
    outLines.push(fileLines[fileIndex]!);
    fileIndex += 1;
  }

  if (outLines.length === 0) {
    return "";
  }

  const joined = outLines.join(lineEnding);
  return oldHadTrailingNewline ? `${joined}${lineEnding}` : joined;
}

/**
 * High-level safe reverse-patch helper accepting either structured hunks or a unified diff.
 */
export function tryReversePatch(
  currentContent: string,
  hunksOrDiff: readonly ReviewHunk[] | string,
): SafeReversePatchResult {
  const hunks =
    typeof hunksOrDiff === "string" ? parseUnifiedDiffHunks(hunksOrDiff) : hunksOrDiff;
  if (hunks.length === 0) {
    return { ok: true, content: currentContent };
  }
  const verification = verifyHunksMatchContent(currentContent, hunks);
  if (!verification.matches) {
    return {
      ok: false,
      conflict: true,
      message:
        verification.reason ??
        "The file was modified manually after Rayu's edit and cannot be reverted automatically.",
    };
  }
  try {
    const reverted = reversePatch(currentContent, hunks);
    return { ok: true, content: reverted };
  } catch (error) {
    return {
      ok: false,
      conflict: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Compute a deterministic unified diff and structured hunks between `originalContent` and `modifiedContent`.
 */
export function computeUnifiedDiff(
  filePath: string,
  originalContent: string,
  modifiedContent: string,
  contextLines = 3,
): {
  unifiedDiff: string;
  additions: number;
  deletions: number;
  hunks: ReviewHunk[];
} {
  if (originalContent === modifiedContent) {
    return { unifiedDiff: "", additions: 0, deletions: 0, hunks: [] };
  }

  const oldSplit = splitContentLines(originalContent);
  const newSplit = splitContentLines(modifiedContent);
  const oldLines = oldSplit.lines;
  const newLines = newSplit.lines;

  // Trim common prefix and suffix for fast LCS on the changed region
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const oldMid = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const newMid = newLines.slice(prefixLen, newLines.length - suffixLen);

  type DiffOp = { type: " " | "-" | "+"; text: string };
  const midOps: DiffOp[] = [];

  if (oldMid.length === 0) {
    for (const line of newMid) midOps.push({ type: "+", text: line });
  } else if (newMid.length === 0) {
    for (const line of oldMid) midOps.push({ type: "-", text: line });
  } else if (oldMid.length * newMid.length <= 250_000) {
    const m = oldMid.length;
    const n = newMid.length;
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i -= 1) {
      for (let j = n - 1; j >= 0; j -= 1) {
        if (oldMid[i] === newMid[j]) {
          dp[i]![j] = dp[i + 1]![j + 1]! + 1;
        } else {
          dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (oldMid[i] === newMid[j]) {
        midOps.push({ type: " ", text: oldMid[i]! });
        i += 1;
        j += 1;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        midOps.push({ type: "-", text: oldMid[i]! });
        i += 1;
      } else {
        midOps.push({ type: "+", text: newMid[j]! });
        j += 1;
      }
    }
    while (i < m) {
      midOps.push({ type: "-", text: oldMid[i]! });
      i += 1;
    }
    while (j < n) {
      midOps.push({ type: "+", text: newMid[j]! });
      j += 1;
    }
  } else {
    for (const line of oldMid) midOps.push({ type: "-", text: line });
    for (const line of newMid) midOps.push({ type: "+", text: line });
  }

  let additions = 0;
  let deletions = 0;
  for (const op of midOps) {
    if (op.type === "+") additions += 1;
    else if (op.type === "-") deletions += 1;
  }

  const preContextStart = Math.max(0, prefixLen - contextLines);
  const postContextEnd = Math.min(oldLines.length, oldLines.length - suffixLen + contextLines);

  const hunkLines: string[] = [];
  for (let i = preContextStart; i < prefixLen; i += 1) {
    hunkLines.push(` ${oldLines[i]!}`);
  }
  for (const op of midOps) {
    hunkLines.push(`${op.type}${op.text}`);
  }
  for (let i = oldLines.length - suffixLen; i < postContextEnd; i += 1) {
    hunkLines.push(` ${oldLines[i]!}`);
  }

  let oldCount = 0;
  let newCount = 0;
  for (const line of hunkLines) {
    if (line.startsWith(" ")) {
      oldCount += 1;
      newCount += 1;
    } else if (line.startsWith("-")) {
      oldCount += 1;
    } else if (line.startsWith("+")) {
      newCount += 1;
    }
  }

  const oldStart = oldLines.length === 0 ? 0 : preContextStart + 1;
  const newStart = newLines.length === 0 ? 0 : preContextStart + 1;

  const hunk: ReviewHunk = {
    oldStart,
    oldLines: oldCount,
    newStart,
    newLines: newCount,
    lines: hunkLines,
  };

  const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  const unifiedDiff = `${header}\n${hunkLines.join("\n")}`;

  return {
    unifiedDiff,
    additions,
    deletions,
    hunks: [hunk],
  };
}
