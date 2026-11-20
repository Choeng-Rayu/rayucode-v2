import { useMemo } from "react";
import { diffLines } from "diff";
import { DiffIcon } from "./Icons.js";

export interface DiffViewerProps {
  filePath: string;
  before: string;
  after: string;
  canOpenNativeDiff?: boolean;
  onOpenNativeDiff?: (filePath: string, before: string, after: string) => void;
}

interface DiffRow {
  kind: "context" | "added" | "removed";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export function computeDiffRows(before: string, after: string): {
  rows: DiffRow[];
  added: number;
  removed: number;
} {
  const parts = diffLines(before, after);
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;

  for (const part of parts) {
    const rawLines = part.value.split("\n");
    if (rawLines[rawLines.length - 1] === "") {
      rawLines.pop();
    }
    for (const line of rawLines) {
      if (part.added) {
        added += 1;
        rows.push({ kind: "added", newLine: newLine++, text: line });
      } else if (part.removed) {
        removed += 1;
        rows.push({ kind: "removed", oldLine: oldLine++, text: line });
      } else {
        rows.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: line });
      }
    }
  }
  return { rows, added, removed };
}

export function DiffViewer({
  filePath,
  before,
  after,
  canOpenNativeDiff,
  onOpenNativeDiff,
}: DiffViewerProps) {
  const { rows, added, removed } = useMemo(() => computeDiffRows(before, after), [before, after]);

  return (
    <section className="rc-diff-viewer" aria-label={`Diff for ${filePath}`}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          paddingBlockEnd: "8px",
          borderBlockEnd: "1px solid var(--rc-border)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600 }}>
          <DiffIcon size={14} />
          <code>{filePath}</code>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--rc-font-size-xs)" }}>
          <span style={{ color: "var(--rc-accent)" }}>+{added}</span>
          <span style={{ color: "var(--rc-danger)" }}>-{removed}</span>
          {canOpenNativeDiff && onOpenNativeDiff ? (
            <button
              type="button"
              className="rc-btn"
              onClick={() => onOpenNativeDiff(filePath, before, after)}
            >
              Open Diff
            </button>
          ) : null}
        </span>
      </header>
      <div className="rc-scroll" style={{ maxHeight: "360px", marginBlockStart: "6px" }}>
        {rows.map((row, idx) => (
          <div key={idx} className="rc-diff-line" data-kind={row.kind}>
            <span style={{ color: "var(--rc-muted)", userSelect: "none" }}>
              {row.oldLine ?? ""}
            </span>
            <span style={{ color: "var(--rc-muted)", userSelect: "none" }}>
              {row.newLine ?? ""}
            </span>
            <span style={{ userSelect: "none" }}>
              {row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}
            </span>
            <span>{row.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
