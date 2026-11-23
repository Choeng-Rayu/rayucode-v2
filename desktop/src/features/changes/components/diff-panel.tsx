import * as React from "react"
import {
  Check,
  ExternalLink,
  FileDiff,
  FileText,
  RotateCcw,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore, type ThemeMode } from "@/lib/app-store"
import {
  detectLanguageFromPath,
  highlightCodeLines,
  type HighlightedToken,
} from "@/lib/shiki-highlighter"
import { cn } from "@/lib/utils"

import {
  getFileReviewDecision,
  type ChangedFileDiff,
  type DiffHunkLine,
  type DiffViewMode,
  type FileReviewDecision,
} from "../types"

const CODE_KEYWORDS = new Set([
  "use",
  "pub",
  "struct",
  "impl",
  "fn",
  "let",
  "mut",
  "self",
  "as",
  "crate",
  "return",
  "match",
  "if",
  "else",
  "for",
  "in",
  "const",
  "type",
  "enum",
  "trait",
  "where",
  "async",
  "await",
  "mod",
  "export",
  "import",
  "function",
])

const CODE_TYPES = new Set([
  "SessionLookup",
  "ShardStore",
  "CacheBudget",
  "Session",
  "SessionId",
  "SessionKey",
  "StreamRetry",
  "SessionCache",
  "RwLock",
  "HashMap",
  "Bytes",
  "Option",
  "Some",
  "None",
  "Result",
  "Ok",
  "Err",
  "usize",
  "u64",
  "String",
  "Vec",
])

function tokenizeLineFallback(line: string): HighlightedToken[] {
  if (!line) {
    return [{ content: " ", tokenClass: "text-[var(--code-plain)]" }]
  }

  const trimmed = line.trimStart()
  if (trimmed.startsWith("//") || trimmed.startsWith("# ")) {
    return [{ content: line, tokenClass: "italic text-[var(--code-com)]" }]
  }

  const tokens: HighlightedToken[] = []
  const regex =
    /(\/\/.*$)|("(?:\\.|[^"\\])*")|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\b\d+\b)|([^\sA-Za-z0-9_"]+)|(\s+)/g

  for (const match of line.matchAll(regex)) {
    const [full, comment, str, ident, num] = match
    const matchIndex = match.index ?? 0
    if (comment) {
      tokens.push({
        content: comment,
        tokenClass: "italic text-[var(--code-com)]",
      })
    } else if (str) {
      tokens.push({ content: str, tokenClass: "text-[var(--code-str)]" })
    } else if (num) {
      tokens.push({ content: num, tokenClass: "text-[var(--code-num)]" })
    } else if (ident) {
      const nextChar = line[matchIndex + full.length]
      if (CODE_KEYWORDS.has(ident)) {
        tokens.push({ content: ident, tokenClass: "text-[var(--code-kw)]" })
      } else if (CODE_TYPES.has(ident)) {
        tokens.push({ content: ident, tokenClass: "text-[var(--code-type)]" })
      } else if (nextChar === "(") {
        tokens.push({ content: ident, tokenClass: "text-[var(--code-fn)]" })
      } else {
        tokens.push({ content: ident, tokenClass: "text-[var(--code-plain)]" })
      }
    } else {
      tokens.push({ content: full, tokenClass: "text-[var(--code-plain)]" })
    }
  }

  return tokens
}

async function highlightDiffLinesWithShiki(
  lines: DiffHunkLine[],
  filePath: string,
  theme: ThemeMode
): Promise<HighlightedToken[][]> {
  const language = detectLanguageFromPath(filePath)
  return highlightCodeLines(
    lines.map((line) => line.content),
    language,
    theme
  )
}

interface IndexedDiffLine {
  line: DiffHunkLine
  index: number
}

type SplitDiffRow =
  | { kind: "hunk"; line: DiffHunkLine; index: number }
  | {
      kind: "pair"
      left: IndexedDiffLine | null
      right: IndexedDiffLine | null
    }

function buildSplitRows(lines: DiffHunkLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let i = 0

  while (i < lines.length) {
    const current = lines[i]
    if (!current) break

    if (current.type === "hunk") {
      rows.push({ kind: "hunk", line: current, index: i })
      i += 1
      continue
    }

    if (current.type === "ctx") {
      rows.push({
        kind: "pair",
        left: { line: current, index: i },
        right: { line: current, index: i },
      })
      i += 1
      continue
    }

    const delGroup: IndexedDiffLine[] = []
    while (i < lines.length && lines[i]?.type === "del") {
      const delLine = lines[i]
      if (delLine) {
        delGroup.push({ line: delLine, index: i })
      }
      i += 1
    }

    const addGroup: IndexedDiffLine[] = []
    while (i < lines.length && lines[i]?.type === "add") {
      const addLine = lines[i]
      if (addLine) {
        addGroup.push({ line: addLine, index: i })
      }
      i += 1
    }

    const pairCount = Math.max(delGroup.length, addGroup.length)
    for (let k = 0; k < pairCount; k += 1) {
      rows.push({
        kind: "pair",
        left: delGroup[k] ?? null,
        right: addGroup[k] ?? null,
      })
    }
  }

  return rows
}

function TokenizedSource({
  tokens,
  fallbackText,
  lineType,
}: {
  tokens: HighlightedToken[] | undefined
  fallbackText: string
  lineType: DiffHunkLine["type"]
}) {
  if (!tokens || tokens.length === 0) {
    return (
      <span
        className={cn(
          "whitespace-pre",
          lineType === "hunk"
            ? "text-muted-ink"
            : lineType === "add"
              ? "text-ink"
              : "text-body"
        )}
      >
        {fallbackText}
      </span>
    )
  }

  return (
    <span className="whitespace-pre">
      {tokens.map((tok, tokenIdx) => (
        <span
          key={tokenIdx}
          className={tok.tokenClass}
          style={tok.color ? { color: tok.color } : undefined}
        >
          {tok.content}
        </span>
      ))}
    </span>
  )
}

export interface DiffPanelProps {
  file: ChangedFileDiff
  mode: DiffViewMode
  isReviewing?: boolean
  isTogglingStage?: boolean
  onReview: (fileId: string, decision: FileReviewDecision) => void
  onToggleStage: (fileId: string) => void
  onOpenInVSCode: (filePath: string, line?: number) => void
  className?: string
}

export function DiffPanel({
  file,
  mode,
  isReviewing = false,
  isTogglingStage = false,
  onReview,
  onToggleStage,
  onOpenInVSCode,
  className,
}: DiffPanelProps) {
  const theme = useAppStore((s) => s.theme)
  const decision = getFileReviewDecision(file)
  const isMarkdown = file.path.toLowerCase().endsWith(".md")

  const firstCodeLine = React.useMemo(() => {
    const match = file.lines.find(
      (line) => line.lineNumber !== null && line.type !== "hunk"
    )
    return match?.lineNumber ?? 1
  }, [file.lines])

  const fallbackTokens = React.useMemo<HighlightedToken[][]>(
    () => file.lines.map((line) => tokenizeLineFallback(line.content)),
    [file.lines]
  )

  const highlightKey = `${file.id}::${file.path}::${theme}::${file.lines.length}`

  const [shikiResult, setShikiResult] = React.useState<{
    key: string
    tokens: HighlightedToken[][]
  } | null>(null)

  React.useEffect(() => {
    if (file.lines.length === 0) return
    let cancelled = false

    void highlightDiffLinesWithShiki(file.lines, file.path, theme)
      .then((tokens) => {
        if (!cancelled) {
          setShikiResult({ key: highlightKey, tokens })
        }
      })
      .catch(() => {
        // Keep synchronous fallback tokenizer in test/offline environments
      })

    return () => {
      cancelled = true
    }
  }, [file.lines, file.path, highlightKey, theme])

  const renderedTokens =
    shikiResult &&
    shikiResult.key === highlightKey &&
    shikiResult.tokens.length === file.lines.length
      ? shikiResult.tokens
      : fallbackTokens

  const splitRows = React.useMemo(
    () => (mode === "split" ? buildSplitRows(file.lines) : []),
    [file.lines, mode]
  )

  return (
    <section
      data-slot="diff-panel"
      data-testid={`diff-panel-${file.id}`}
      data-diff-mode={mode}
      data-decision={decision}
      aria-label={`Diff review for ${file.path}`}
      className={cn(
        "rayu-card-bevel overflow-hidden rounded-xl bg-pane",
        className
      )}
    >
      {/* Diff Card Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2.5 text-xs">
        {isMarkdown ? (
          <FileText
            className="size-3.5 shrink-0 text-muted-ink"
            aria-hidden="true"
          />
        ) : (
          <FileDiff
            className="size-3.5 shrink-0 text-muted-ink"
            aria-hidden="true"
          />
        )}

        <span
          data-testid="diff-panel-file-path"
          className="font-mono font-medium text-ink"
        >
          {file.path}
        </span>

        <span className="font-mono text-[11px] tabular-nums">
          {file.deleted ? (
            <span className="text-danger">−{file.deletions} (deleted)</span>
          ) : (
            <>
              {file.additions > 0 && (
                <span className="text-brand-text">+{file.additions}</span>
              )}
              {file.additions > 0 && file.deletions > 0 && " "}
              {file.deletions > 0 && (
                <span className="text-danger">−{file.deletions}</span>
              )}
            </>
          )}
        </span>

        <span className="flex-1" />

        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-mono text-[11px]",
            file.deleted
              ? "border-transparent bg-danger-soft text-danger"
              : "border-hairline bg-raised text-body"
          )}
        >
          {file.ownerBadge}
        </span>

        {decision === "accepted" && (
          <span
            data-testid="diff-panel-decision-badge"
            className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text"
          >
            Accepted
          </span>
        )}

        {decision === "rejected" && (
          <span
            data-testid="diff-panel-decision-badge"
            className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger"
          >
            Rejected
          </span>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={file.staged ? "primary" : "outline"}
              size="sm"
              disabled={isTogglingStage}
              onClick={() => onToggleStage(file.id)}
              data-testid="diff-panel-stage-btn"
              aria-pressed={Boolean(file.staged)}
            >
              {file.staged ? "Staged" : "Stage"}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {file.staged ? "Unstage file" : "Stage file for commit"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenInVSCode(file.path, firstCodeLine)}
              data-testid="diff-panel-vscode-btn"
            >
              <ExternalLink className="size-3" aria-hidden="true" />
              <span>VS Code</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Open {file.path} in Visual Studio Code
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Diff Viewport: Unified or Split */}
      {mode === "unified" ? (
        <div
          data-testid="diff-body-unified"
          className="overflow-x-auto bg-inset p-1.5 font-mono text-xs leading-[1.6] tabular-nums"
        >
          {file.lines.map((line, index) => (
            <div
              key={`${file.id}-u-${index}`}
              data-line-type={line.type}
              className={cn(
                "flex min-w-max px-2.5 py-0.5",
                line.type === "hunk" && "bg-pane py-1 text-muted-ink",
                line.type === "add" && "bg-diff-add",
                line.type === "del" && "bg-diff-del"
              )}
            >
              <span className="w-[42px] shrink-0 pr-2.5 text-right text-faint select-none tabular-nums">
                {line.lineNumber ?? ""}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 text-center select-none",
                  line.type === "add" && "text-brand-text",
                  line.type === "del" && "text-danger",
                  line.type === "hunk" && "text-muted-ink"
                )}
              >
                {line.mark}
              </span>
              <TokenizedSource
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
          <div className="grid min-w-[680px] grid-cols-2 border-b border-hairline bg-pane/70 text-[11px] font-medium text-muted-ink">
            <div className="border-r border-hairline px-3 py-1.5">
              Original (base)
            </div>
            <div className="px-3 py-1.5">Modified (working tree)</div>
          </div>

          <div className="min-w-[680px] py-1">
            {splitRows.map((row, rowIdx) => {
              if (row.kind === "hunk") {
                return (
                  <div
                    key={`${file.id}-sh-${rowIdx}`}
                    data-line-type="hunk"
                    className="flex bg-pane px-3 py-1 text-muted-ink"
                  >
                    <span className="mr-2 select-none">{row.line.mark}</span>
                    <span>{row.line.content}</span>
                  </div>
                )
              }

              return (
                <div
                  key={`${file.id}-sp-${rowIdx}`}
                  className="grid grid-cols-2 divide-x divide-hairline"
                >
                  {/* Left: Original */}
                  <div
                    data-split-side="left"
                    data-line-type={row.left?.line.type ?? "empty"}
                    className={cn(
                      "flex min-w-0 overflow-hidden px-2 py-0.5",
                      row.left?.line.type === "del" && "bg-diff-del",
                      !row.left && "bg-chrome/40"
                    )}
                  >
                    <span className="w-[38px] shrink-0 pr-2 text-right text-faint select-none tabular-nums">
                      {row.left?.line.lineNumber ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 text-center select-none",
                        row.left?.line.type === "del" && "text-danger"
                      )}
                    >
                      {row.left?.line.mark ?? ""}
                    </span>
                    {row.left && (
                      <TokenizedSource
                        tokens={renderedTokens[row.left.index]}
                        fallbackText={row.left.line.content}
                        lineType={row.left.line.type}
                      />
                    )}
                  </div>

                  {/* Right: Modified */}
                  <div
                    data-split-side="right"
                    data-line-type={row.right?.line.type ?? "empty"}
                    className={cn(
                      "flex min-w-0 overflow-hidden px-2 py-0.5",
                      row.right?.line.type === "add" && "bg-diff-add",
                      !row.right && "bg-chrome/40"
                    )}
                  >
                    <span className="w-[38px] shrink-0 pr-2 text-right text-faint select-none tabular-nums">
                      {row.right?.line.lineNumber ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 text-center select-none",
                        row.right?.line.type === "add" && "text-brand-text"
                      )}
                    >
                      {row.right?.line.mark ?? ""}
                    </span>
                    {row.right && (
                      <TokenizedSource
                        tokens={renderedTokens[row.right.index]}
                        fallbackText={row.right.line.content}
                        lineType={row.right.line.type}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Diff Card Footer */}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-3.5 py-2.5">
        <span
          data-testid="diff-panel-hint"
          className={cn(
            "text-[11px]",
            decision === "accepted"
              ? "text-brand-text"
              : decision === "rejected"
                ? "text-danger"
                : "text-muted-ink"
          )}
        >
          {decision === "accepted"
            ? "Accepted · staged for commit"
            : decision === "rejected"
              ? "Rejected · rayu will revise"
              : file.hint}
        </span>

        <span className="flex-1" />

        {decision === "pending" ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isReviewing}
              onClick={() => onReview(file.id, "rejected")}
              data-testid="diff-reject-btn"
            >
              <X className="size-3" aria-hidden="true" />
              <span>Reject</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isReviewing}
              onClick={() => onReview(file.id, "accepted")}
              data-testid="diff-accept-btn"
            >
              <Check className="size-3" aria-hidden="true" />
              <span>Accept</span>
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isReviewing}
            onClick={() => onReview(file.id, "pending")}
            data-testid="diff-undo-btn"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            <span>Undo</span>
          </Button>
        )}
      </div>
    </section>
  )
}
