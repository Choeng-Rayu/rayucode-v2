import * as React from "react"
import { Check, Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore, type ThemeMode } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { openFileInVSCode } from "../api/inspector-api"
import {
  useCodeFile,
  useInspectorState,
  usePrefetchCodeFile,
} from "../hooks/use-context-stats"

interface HighlightedToken {
  content: string
  color?: string
  tokenClass?: string
}

const RUST_KEYWORDS = new Set([
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
])

const RUST_TYPES = new Set([
  "SessionLookup",
  "ShardStore",
  "CacheBudget",
  "Session",
  "SessionKey",
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

const shikiTokenCache = new Map<string, HighlightedToken[][]>()

function tokenizeLineFallback(line: string): HighlightedToken[] {
  if (!line) return [{ content: " ", tokenClass: "text-[var(--code-plain)]" }]

  const trimmed = line.trimStart()
  if (trimmed.startsWith("//")) {
    return [{ content: line, tokenClass: "italic text-[var(--code-com)]" }]
  }

  const tokens: HighlightedToken[] = []
  const regex =
    /(\/\/.*$)|("(?:\\.|[^"\\])*")|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\b\d+\b)|([^\sA-Za-z0-9_"]+)|(\s+)/g

  for (const match of line.matchAll(regex)) {
    const [full, comment, str, ident, num] = match
    const matchIndex = match.index ?? 0
    if (comment) {
      tokens.push({ content: comment, tokenClass: "italic text-[var(--code-com)]" })
    } else if (str) {
      tokens.push({ content: str, tokenClass: "text-[var(--code-str)]" })
    } else if (num) {
      tokens.push({ content: num, tokenClass: "text-[var(--code-num)]" })
    } else if (ident) {
      const nextChar = line[matchIndex + full.length]
      if (RUST_KEYWORDS.has(ident)) {
        tokens.push({ content: ident, tokenClass: "text-[var(--code-kw)]" })
      } else if (RUST_TYPES.has(ident)) {
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

async function highlightLinesWithShiki(
  lines: string[],
  language: string,
  theme: ThemeMode
): Promise<HighlightedToken[][]> {
  const shikiTheme = theme === "light" ? "vitesse-light" : "vitesse-dark"
  const source = lines.join("\n")
  const cacheKey = `${language}::${shikiTheme}::${source}`
  const cached = shikiTokenCache.get(cacheKey)
  if (cached) return cached

  const { codeToTokens } = await import("shiki")
  const result = await codeToTokens(source, {
    lang: language as "rust",
    theme: shikiTheme,
  })

  const mapped: HighlightedToken[][] = result.tokens.map((lineTokens) =>
    lineTokens.length > 0
      ? lineTokens.map((tok) => ({
          content: tok.content,
          color: tok.color,
        }))
      : [{ content: " ", tokenClass: "text-[var(--code-plain)]" }]
  )

  shikiTokenCache.set(cacheKey, mapped)
  return mapped
}

export interface CodeViewerProps {
  className?: string
}

export function CodeViewer({ className }: CodeViewerProps) {
  const activeCodeFile = useAppStore((s) => s.activeCodeFile) ?? "lookup.rs"
  const activeCodeLine = useAppStore((s) => s.activeCodeLine)
  const theme = useAppStore((s) => s.theme)
  const openCodeFile = useAppStore((s) => s.openCodeFile)

  const { data: inspector, isLoading: isStateLoading } = useInspectorState()
  const {
    data: fetchedFile,
    isError,
    error,
    refetch,
  } = useCodeFile(activeCodeFile)
  const prefetchCodeFile = usePrefetchCodeFile()

  const [copiedPath, setCopiedPath] = React.useState(false)
  const [shikiResult, setShikiResult] = React.useState<{
    key: string
    tokens: HighlightedToken[][]
  } | null>(null)
  const highlightedLineRef = React.useRef<HTMLDivElement | null>(null)

  const codeSpec =
    fetchedFile ??
    inspector?.codeFiles[activeCodeFile] ??
    inspector?.codeFiles["lookup.rs"]

  const fileKeys = React.useMemo(
    () =>
      inspector
        ? Object.keys(inspector.codeFiles)
        : ["lookup.rs", "store.rs", "cache.rs"],
    [inspector]
  )

  const fallbackTokens = React.useMemo<HighlightedToken[][]>(
    () => (codeSpec ? codeSpec.lines.map(tokenizeLineFallback) : []),
    [codeSpec]
  )

  const highlightKey = codeSpec
    ? `${codeSpec.pill}::${codeSpec.language}::${theme}::${codeSpec.lines.length}`
    : ""

  React.useEffect(() => {
    if (!codeSpec || !highlightKey) return
    let cancelled = false

    void highlightLinesWithShiki(codeSpec.lines, codeSpec.language, theme)
      .then((tokens) => {
        if (!cancelled) {
          setShikiResult({ key: highlightKey, tokens })
        }
      })
      .catch(() => {
        // Keep synchronous fallback tokenizer on WASM/test environments
      })

    return () => {
      cancelled = true
    }
  }, [codeSpec, highlightKey, theme])

  React.useEffect(() => {
    if (!activeCodeLine || !highlightedLineRef.current) return
    if (typeof highlightedLineRef.current.scrollIntoView === "function") {
      highlightedLineRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    }
  }, [activeCodeFile, activeCodeLine, codeSpec?.pill])

  if (isStateLoading && !codeSpec) {
    return <ContextSkeleton />
  }

  if (isError && !codeSpec) {
    return (
      <div className="p-4">
        <ErrorState
          title="Unable to load code file"
          description={
            error instanceof Error
              ? error.message
              : "Failed to read file contents from workspace."
          }
          actionLabel="Retry"
          onRetry={() => {
            void refetch()
          }}
        />
      </div>
    )
  }

  if (!codeSpec) {
    return <ContextSkeleton />
  }

  const renderedLines =
    shikiResult &&
    shikiResult.key === highlightKey &&
    shikiResult.tokens.length === codeSpec.lines.length
      ? shikiResult.tokens
      : fallbackTokens

  const handleCopyPath = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeSpec.path)
      }
      setCopiedPath(true)
      toast(`Copied path: ${codeSpec.path}`)
      window.setTimeout(() => setCopiedPath(false), 1400)
    } catch {
      toast(`Path: ${codeSpec.path}`)
    }
  }

  const handleOpenInVSCode = () => {
    void openFileInVSCode(codeSpec.path, activeCodeLine ?? codeSpec.defaultLine)
    toast(
      `Opened ${codeSpec.pill}${activeCodeLine ? `:${activeCodeLine}` : ""} in Visual Studio Code`
    )
  }

  return (
    <div
      data-testid="inspector-code-viewer"
      className={cn("flex min-h-0 flex-1 flex-col bg-pane", className)}
    >
      {/* File tab switcher */}
      <div
        role="tablist"
        aria-label="Referenced code files"
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-hairline px-3 py-2"
      >
        {fileKeys.map((fileKey) => {
          const isActive = activeCodeFile === fileKey
          const targetDefaultLine =
            inspector?.codeFiles[fileKey]?.defaultLine ?? 1
          return (
            <button
              key={fileKey}
              type="button"
              role="tab"
              aria-selected={isActive}
              onMouseEnter={() => prefetchCodeFile(fileKey)}
              onFocus={() => prefetchCodeFile(fileKey)}
              onClick={() => openCodeFile(fileKey, targetDefaultLine)}
              className={cn(
                "cursor-pointer rounded-[7px] border px-[9px] py-1 font-mono text-[11px] whitespace-nowrap transition-colors",
                isActive
                  ? "border-premium bg-active text-ink"
                  : "border-transparent text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              {fileKey}
            </button>
          )
        })}
      </div>

      {/* File path bar & VS Code handoff */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-chrome px-3.5 py-2 text-xs text-muted-ink">
        <span
          data-testid="code-viewer-path"
          title={codeSpec.path}
          className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-body"
        >
          {codeSpec.path}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Copy file path"
              onClick={() => {
                void handleCopyPath()
              }}
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              {copiedPath ? (
                <Check className="size-3 text-brand-text" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Copy className="size-3" strokeWidth={1.65} aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Copy path</TooltipContent>
        </Tooltip>

        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={handleOpenInVSCode}
          className="h-6 px-2 text-xs text-body hover:text-ink"
        >
          <ExternalLink className="size-3" strokeWidth={1.65} aria-hidden="true" />
          <span>VS Code</span>
        </Button>
      </div>

      {/* Code viewport */}
      <ScrollArea className="min-h-0 flex-1">
        <div
          role="region"
          aria-label={`Source code for ${codeSpec.pill}`}
          className="py-2.5 pb-4 font-mono text-xs leading-[1.62]"
        >
          {codeSpec.lines.map((_, index) => {
            const lineNumber = codeSpec.startLine + index
            const isHighlighted = activeCodeLine === lineNumber
            const tokens = renderedLines[index] ?? []

            return (
              <div
                key={`${codeSpec.pill}-${lineNumber}`}
                ref={isHighlighted ? highlightedLineRef : undefined}
                data-line-number={lineNumber}
                data-highlighted={isHighlighted ? "true" : "false"}
                onClick={() => openCodeFile(codeSpec.pill, lineNumber)}
                className={cn(
                  "grid cursor-pointer grid-cols-[42px_minmax(0,1fr)] border-l-2 pr-3.5 whitespace-pre transition-colors",
                  isHighlighted
                    ? "border-l-brand bg-brand-softer"
                    : "border-l-transparent hover:bg-hover"
                )}
              >
                <span
                  className={cn(
                    "pr-3 pl-2 text-right select-none tabular-nums",
                    isHighlighted
                      ? "font-semibold text-brand-text"
                      : "text-faint"
                  )}
                >
                  {lineNumber}
                </span>
                <span className="overflow-x-visible text-[var(--code-plain)]">
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
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
