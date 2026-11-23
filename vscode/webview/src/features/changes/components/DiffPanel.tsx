import * as React from "react";
import {
  Check,
  Columns2,
  ExternalLink,
  FileCode2,
  RotateCcw,
} from "lucide-react";
import type { ChangedFileView } from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import { TechFileBadge } from "@/components/ui/tech-file-badge";
import { useAppStore } from "@/lib/app-store";
import { tokenizeCodeLine } from "@/lib/file-icon-theme";
import {
  detectLanguageFromPath,
  highlightCodeLines,
  type HighlightedToken,
} from "@/lib/shiki-highlighter";
import { cn } from "@/lib/utils";

import type { DiffHunkLine, DiffViewMode } from "../hooks/useChanges";

export interface DiffPanelProps {
  file: ChangedFileView;
  lines: DiffHunkLine[];
  mode: DiffViewMode;
  isBusy?: boolean;
  onToggleStage: (file: ChangedFileView) => void;
  onKeep: (path: string) => void;
  onUndo: (path: string) => void;
  onOpenDiffInVsCode: (path: string) => void;
  onOpenFileInVsCode: (path: string, line?: number) => void;
  className?: string;
}

interface IndexedDiffLine {
  line: DiffHunkLine;
  index: number;
}

type SplitDiffRow =
  | { kind: "hunk"; line: DiffHunkLine; index: number }
  | {
      kind: "pair";
      left: IndexedDiffLine | null;
      right: IndexedDiffLine | null;
    };

function buildSplitRows(lines: DiffHunkLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const current = lines[i];
    if (!current) break;

    if (current.type === "hunk") {
      rows.push({ kind: "hunk", line: current, index: i });
      i += 1;
      continue;
    }

    if (current.type === "ctx") {
      rows.push({
        kind: "pair",
        left: { line: current, index: i },
        right: { line: current, index: i },
      });
      i += 1;
      continue;
    }

    const delGroup: IndexedDiffLine[] = [];
    while (i < lines.length && lines[i]?.type === "del") {
      const delLine = lines[i];
      if (delLine) delGroup.push({ line: delLine, index: i });
      i += 1;
    }

    const addGroup: IndexedDiffLine[] = [];
    while (i < lines.length && lines[i]?.type === "add") {
      const addLine = lines[i];
      if (addLine) addGroup.push({ line: addLine, index: i });
      i += 1;
    }

    const pairCount = Math.max(delGroup.length, addGroup.length);
    for (let k = 0; k < pairCount; k += 1) {
      rows.push({
        kind: "pair",
        left: delGroup[k] ?? null,
        right: addGroup[k] ?? null,
      });
    }
  }

  return rows;
}

function fallbackTokenize(line: string): HighlightedToken[] {
  const spans = tokenizeCodeLine(line);
  return spans.map((s) => ({
    content: s.text,
    tokenClass: s.className,
  }));
}

function TokenizedLineContent({
  tokens,
  fallbackText,
  lineType,
}: {
  tokens: HighlightedToken[] | undefined;
  fallbackText: string;
  lineType: DiffHunkLine["type"];
}) {
  if (!tokens || tokens.length === 0 || lineType === "hunk") {
    return (
      <span
        className={cn(
          "whitespace-pre",
          lineType === "hunk"
            ? "text-muted-ink"
            : lineType === "add"
              ? "text-ink"
              : "text-body",
        )}
      >
        {fallbackText || " "}
      </span>
    );
  }

  return (
    <span className="whitespace-pre">
      {tokens.map((tok, idx) => (
        <span
          key={idx}
          className={tok.tokenClass}
          style={tok.color ? { color: tok.color } : undefined}
        >
          {tok.content}
        </span>
      ))}
    </span>
  );
}

export function DiffPanel({
  file,
  lines,
  mode,
  isBusy = false,
  onToggleStage,
  onKeep,
  onUndo,
  onOpenDiffInVsCode,
  onOpenFileInVsCode,
  className,
}: DiffPanelProps) {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const ownerLabel = file.ownerBadge ?? (file.fromSession ? "agent" : "user");

  const firstCodeLine = React.useMemo(() => {
    const match = lines.find(
      (line) => line.lineNumber !== null && line.type !== "hunk",
    );
    return match?.lineNumber ?? 1;
  }, [lines]);

  const fallbackTokens = React.useMemo<HighlightedToken[][]>(
    () => lines.map((l) => fallbackTokenize(l.content)),
    [lines],
  );

  const highlightKey = `${file.path}::${resolvedTheme}::${lines.length}`;
  const [shikiTokens, setShikiTokens] = React.useState<{
    key: string;
    tokens: HighlightedToken[][];
  } | null>(null);

  React.useEffect(() => {
    if (lines.length === 0) return;
    let cancelled = false;
    const lang = detectLanguageFromPath(file.path);

    void highlightCodeLines(
      lines.map((l) => l.content),
      lang,
      resolvedTheme,
    )
      .then((tokens) => {
        if (!cancelled) {
          setShikiTokens({ key: highlightKey, tokens });
        }
      })
      .catch(() => {
        // Fallback tokenizer remains active
      });

    return () => {
      cancelled = true;
    };
  }, [file.path, highlightKey, lines, resolvedTheme]);

  const renderedTokens =
    shikiTokens &&
    shikiTokens.key === highlightKey &&
    shikiTokens.tokens.length === lines.length
      ? shikiTokens.tokens
      : fallbackTokens;

  const splitRows = React.useMemo(
    () => (mode === "split" ? buildSplitRows(lines) : []),
    [lines, mode],
  );

  return (
    <section
      data-slot="diff-panel"
      data-testid={`diff-panel-${file.path}`}
      data-diff-mode={mode}
      aria-label={`Diff review for ${file.path}`}
      className={cn(
        "rayu-card-bevel overflow-hidden rounded-xl border border-hairline bg-pane",
        className,
      )}
    >
      {/* Diff Panel Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2.5 text-xs">
        <TechFileBadge path={file.path} />

        <span
          data-testid="diff-panel-file-path"
          className="font-mono font-medium text-ink"
        >
          {file.path}
        </span>

        <span className="font-mono text-[11px] tabular-nums">
          {file.additions > 0 && (
            <span className="text-brand-text">+{file.additions}</span>
          )}
          {file.additions > 0 && file.deletions > 0 && " "}
          {file.deletions > 0 && (
            <span className="text-danger">-{file.deletions}</span>
          )}
        </span>

        <span className="rounded-full border border-hairline bg-raised px-2 py-0.5 font-mono text-[10.5px] text-muted-ink">
          {ownerLabel}
        </span>

        {file.decision === "accepted" && (
          <span
            data-testid="diff-panel-decision-badge"
            className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text"
          >
            Accepted
          </span>
        )}
        {file.decision === "rejected" && (
          <span
            data-testid="diff-panel-decision-badge"
            className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger"
          >
            Rejected
          </span>
        )}

        <span className="flex-1" />

        <Button
          type="button"
          variant={file.staged ? "primary" : "outline"}
          size="xs"
          disabled={isBusy}
          onClick={() => onToggleStage(file)}
          data-testid="diff-panel-stage-btn"
        >
          {file.staged ? "Staged" : "Stage"}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={isBusy}
          onClick={() => onKeep(file.path)}
          data-testid="diff-panel-keep-btn"
        >
          <Check className="size-3 text-brand-text" aria-hidden="true" />
          <span>Keep</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={isBusy}
          onClick={() => onUndo(file.path)}
          data-testid="diff-panel-undo-btn"
        >
          <RotateCcw className="size-3 text-danger" aria-hidden="true" />
          <span>Undo</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onOpenFileInVsCode(file.path, firstCodeLine)}
          data-testid="diff-panel-open-file-btn"
        >
          <FileCode2 className="size-3" aria-hidden="true" />
          <span>Open File</span>
        </Button>

        <Button
          type="button"
          variant="default"
          size="xs"
          onClick={() => onOpenDiffInVsCode(file.path)}
          data-testid="diff-panel-vscode-diff-btn"
        >
          <Columns2 className="size-3" aria-hidden="true" />
          <span>Open in VS Code Diff</span>
        </Button>
      </div>

      {/* Unified or Split Diff Viewport */}
      {mode === "unified" ? (
        <div
          data-testid="diff-body-unified"
          className="overflow-x-auto bg-inset py-1.5 font-mono text-xs leading-[1.6] tabular-nums"
        >
          {lines.map((line, index) => (
            <div
              key={`${file.path}-u-${index}`}
              data-line-type={line.type}
              className={cn(
                "flex min-w-max border-l-2 px-2.5 py-0.5",
                line.type === "hunk" &&
                  "border-l-transparent bg-pane py-1 text-muted-ink",
                line.type === "add" &&
                  "border-l-diff-add-rail bg-diff-add",
                line.type === "del" &&
                  "border-l-diff-del-rail bg-diff-del",
                line.type === "ctx" && "border-l-transparent",
              )}
            >
              <span className="w-[36px] shrink-0 pr-2 text-right text-faint select-none tabular-nums">
                {line.oldLineNumber ?? ""}
              </span>
              <span className="w-[36px] shrink-0 pr-2.5 text-right text-faint select-none tabular-nums">
                {line.newLineNumber ?? ""}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 text-center select-none",
                  line.type === "add" && "text-brand-text",
                  line.type === "del" && "text-danger",
                  line.type === "hunk" && "text-muted-ink",
                )}
              >
                {line.mark}
              </span>
              <TokenizedLineContent
                tokens={renderedTokens[index]}
                fallbackText={line.content}
                lineType={line.type}
              />
            </div>
          ))}
        </div>
      ) : (
        <div
          data-testid="diff-body-split"
          className="overflow-x-auto bg-inset font-mono text-xs leading-[1.6] tabular-nums"
        >
          <div className="grid min-w-[660px] grid-cols-2 border-b border-hairline bg-pane/70 text-[11px] font-medium text-muted-ink">
            <div className="border-r border-hairline px-3 py-1.5">
              Original (base)
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span>Modified (working tree)</span>
              <button
                type="button"
                onClick={() => onOpenDiffInVsCode(file.path)}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-brand-text hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden="true" />
                <span>Side-by-side in VS Code</span>
              </button>
            </div>
          </div>

          <div className="min-w-[660px] py-1">
            {splitRows.map((row, rowIdx) => {
              if (row.kind === "hunk") {
                return (
                  <div
                    key={`${file.path}-sh-${rowIdx}`}
                    data-line-type="hunk"
                    className="flex bg-pane px-3 py-1 text-muted-ink"
                  >
                    <span>{row.line.content}</span>
                  </div>
                );
              }

              return (
                <div
                  key={`${file.path}-sp-${rowIdx}`}
                  className="grid grid-cols-2 divide-x divide-hairline"
                >
                  <div
                    data-split-side="left"
                    data-line-type={row.left?.line.type ?? "empty"}
                    className={cn(
                      "flex min-w-0 overflow-hidden border-l-2 px-2 py-0.5",
                      row.left?.line.type === "del"
                        ? "border-l-diff-del-rail bg-diff-del"
                        : "border-l-transparent",
                      !row.left && "bg-chrome/40",
                    )}
                  >
                    <span className="w-[36px] shrink-0 pr-2 text-right text-faint select-none tabular-nums">
                      {row.left?.line.oldLineNumber ??
                        row.left?.line.lineNumber ??
                        ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 text-center select-none",
                        row.left?.line.type === "del" && "text-danger",
                      )}
                    >
                      {row.left?.line.mark ?? ""}
                    </span>
                    {row.left && (
                      <TokenizedLineContent
                        tokens={renderedTokens[row.left.index]}
                        fallbackText={row.left.line.content}
                        lineType={row.left.line.type}
                      />
                    )}
                  </div>

                  <div
                    data-split-side="right"
                    data-line-type={row.right?.line.type ?? "empty"}
                    className={cn(
                      "flex min-w-0 overflow-hidden border-l-2 px-2 py-0.5",
                      row.right?.line.type === "add"
                        ? "border-l-diff-add-rail bg-diff-add"
                        : "border-l-transparent",
                      !row.right && "bg-chrome/40",
                    )}
                  >
                    <span className="w-[36px] shrink-0 pr-2 text-right text-faint select-none tabular-nums">
                      {row.right?.line.newLineNumber ??
                        row.right?.line.lineNumber ??
                        ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 text-center select-none",
                        row.right?.line.type === "add" && "text-brand-text",
                      )}
                    >
                      {row.right?.line.mark ?? ""}
                    </span>
                    {row.right && (
                      <TokenizedLineContent
                        tokens={renderedTokens[row.right.index]}
                        fallbackText={row.right.line.content}
                        lineType={row.right.line.type}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
