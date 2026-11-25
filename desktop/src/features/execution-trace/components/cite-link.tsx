import * as React from "react"
import {
  Check,
  Code2,
  Copy,
  Eye,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Network,
  PanelRightOpen,
  Presentation,
} from "lucide-react"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { toast } from "sonner"
import { unified } from "unified"

import { MermaidDiagramSvg } from "@/components/ui/mermaid-diagram"
import { useAppStore } from "@/lib/app-store"
import {
  classifyInlineCode,
  tokenizeCodeLine,
  type InlineCodeCategory,
} from "@/lib/file-icon-theme"
import { layoutMermaidFlowchart } from "@/lib/mermaid-flowchart"
import { cn } from "@/lib/utils"

import type { CitationItem } from "../types"

interface MdastNode {
  type: string
  value?: string
  url?: string
  depth?: number
  ordered?: boolean
  lang?: string | null
  align?: Array<"left" | "right" | "center" | null>
  children?: MdastNode[]
}

const markdownProcessor = unified().use(remarkParse).use(remarkGfm)

function getInlineCodeClasses(category: InlineCodeCategory): string {
  switch (category) {
    case "folder":
    case "file-ts":
    case "file-rust":
    case "file-doc":
    case "file-data":
      // Single clean theme accent (Rayu Green or Ocean Blue based on user theme)
      return "text-brand-text hover:bg-brand-soft/60"
    case "command":
    case "component":
    case "symbol":
    default:
      return "bg-hover/55 text-ink"
  }
}

function getLanguageBadgeClass(_lang?: string | null): string {
  return "text-muted-ink bg-active/70"
}

function CodeBlockView({
  value,
  lang,
}: {
  value: string
  lang?: string | null
}) {
  const [copied, setCopied] = React.useState(false)
  const lines = React.useMemo(() => value.split(/\r?\n/), [value])
  const langLabel = lang?.trim() || "code"

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      }
    } catch {
      // ignore clipboard errors
    }
    setCopied(true)
    toast("Copied code block")
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div
      data-slot="markdown-code-block"
      className="my-1.5 overflow-hidden rounded-xl border border-hairline bg-inset/80"
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline-soft bg-pane/50 px-3 py-1.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[11px] font-medium",
            getLanguageBadgeClass(lang)
          )}
        >
          {langLabel}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label="Copy code"
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink",
            copied && "text-brand-text"
          )}
        >
          {copied ? (
            <>
              <Check className="size-3" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="m-0 max-h-[320px] overflow-auto px-3.5 py-3 font-mono text-[12.2px] leading-[1.6] tabular-nums">
        <code>
          {lines.map((line, lineIdx) => (
            <span key={lineIdx} className="block">
              {tokenizeCodeLine(line).map((tok, tokIdx) => (
                <span key={tokIdx} className={tok.className}>
                  {tok.text}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function isMermaidCodeBlock(value: string, lang?: string | null): boolean {
  const lower = (lang ?? "").trim().toLowerCase()
  if (lower === "mermaid" || lower === "mmd") {
    return true
  }
  if (!lower || lower === "text" || lower === "txt") {
    return /^(?:flowchart|graph)\s+(?:LR|RL|TD|TB|BT)\b/im.test(value.trim())
  }
  return false
}

function isDiagramInlineToken(raw: string): boolean {
  const trimmed = raw.trim()
  return (
    /\.(?:mmd|mermaid)$/i.test(trimmed) ||
    /^(?:flowchart(?:\s+(?:LR|RL|TD|TB|BT))?|mermaid(?:\s+diagram)?|architecture\s+diagram|diagram)$/i.test(
      trimmed
    )
  )
}

function openInlineFileTarget(raw: string): void {
  const trimmed = raw.trim()
  const store = useAppStore.getState()
  const lineMatch = trimmed.match(/^(.+?):(\d+)$/)
  const cleanPath = lineMatch ? lineMatch[1] : trimmed
  const lineNum = lineMatch ? Number.parseInt(lineMatch[2], 10) : null
  const basename = cleanPath.split("/").filter(Boolean).pop() ?? cleanPath
  const lower = cleanPath.toLowerCase()

  if (lower.endsWith(".xlsx") || lower.endsWith(".csv")) {
    store.openDocPreview("excel", basename)
    return
  }
  if (lower.endsWith(".pptx")) {
    store.openDocPreview("slide", "Slide")
    return
  }
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) {
    store.openDocPreview("markdown", basename)
    return
  }
  if (lower.endsWith(".mmd") || lower.endsWith(".mermaid")) {
    store.openDocPreview("diagram", basename)
    return
  }
  store.openCodeFile(cleanPath, lineNum)
}

function findFirstMermaidInTree(node: MdastNode): string | null {
  if (node.type === "code" && isMermaidCodeBlock(node.value ?? "", node.lang)) {
    return node.value ?? null
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findFirstMermaidInTree(child)
      if (found) return found
    }
  }
  return null
}

function MermaidCodeBlockCard({ value }: { value: string }) {
  const [viewMode, setViewMode] = React.useState<"preview" | "code">("preview")
  const [copied, setCopied] = React.useState(false)
  const layout = React.useMemo(() => layoutMermaidFlowchart(value), [value])
  const lines = React.useMemo(() => value.split(/\r?\n/), [value])

  const handleOpenInSidebar = () => {
    useAppStore.getState().openDiagramPreview(value, layout.title)
  }

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      }
    } catch {
      // ignore clipboard errors
    }
    setCopied(true)
    toast("Copied Mermaid diagram source")
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div
      data-slot="markdown-mermaid-block"
      data-view-mode={viewMode}
      className="my-1.5 overflow-hidden rounded-[12px] border border-premium bg-pane shadow-bevel-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft bg-inset/80 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-wide text-brand-text uppercase">
            <Network className="size-3 shrink-0" aria-hidden="true" />
            <span>mermaid</span>
          </span>
          <span className="truncate text-xs font-medium text-ink">
            {layout.title}
          </span>
          <span className="hidden font-mono text-[10px] text-muted-ink sm:inline">
            {layout.direction}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div
            role="tablist"
            aria-label="Diagram view mode"
            className="inline-flex items-center rounded-md border border-hairline bg-pane p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "preview"}
              data-testid="inline-mermaid-preview-btn"
              onClick={() => setViewMode("preview")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-xs px-2 py-0.5 text-[11px] font-medium transition-colors",
                viewMode === "preview"
                  ? "bg-active text-ink shadow-xs"
                  : "text-muted-ink hover:text-ink"
              )}
            >
              <Eye className="size-3" aria-hidden="true" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "code"}
              data-testid="inline-mermaid-code-btn"
              onClick={() => setViewMode("code")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-xs px-2 py-0.5 text-[11px] font-medium transition-colors",
                viewMode === "code"
                  ? "bg-active text-ink shadow-xs"
                  : "text-muted-ink hover:text-ink"
              )}
            >
              <Code2 className="size-3" aria-hidden="true" />
              <span>Code</span>
            </button>
          </div>

          <button
            type="button"
            data-testid="mermaid-open-sidebar-btn"
            onClick={handleOpenInSidebar}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-brand/30 bg-brand-softer px-2 py-0.5 text-[11px] font-medium text-brand-text transition-colors hover:bg-brand-soft hover:text-brand-bright"
          >
            <PanelRightOpen className="size-3" aria-hidden="true" />
            <span>Open in Sidebar</span>
          </button>

          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy code"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink",
              copied && "text-brand-text"
            )}
          >
            {copied ? (
              <>
                <Check className="size-3" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {viewMode === "preview" ? (
        <div className="p-2">
          <MermaidDiagramSvg
            source={value}
            onNodeClick={() => handleOpenInSidebar()}
          />
        </div>
      ) : (
        <pre className="m-0 max-h-[320px] overflow-auto bg-inset px-3.5 py-3 font-mono text-[12.2px] leading-[1.6] tabular-nums">
          <code>
            {lines.map((line, lineIdx) => (
              <span key={lineIdx} className="block">
                {tokenizeCodeLine(line).map((tok, tokIdx) => (
                  <span key={tokIdx} className={tok.className}>
                    {tok.text}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  )
}

function renderMdastChildren(
  nodes: MdastNode[] | undefined,
  keyPrefix: string,
  contextDiagramSource: string | null
): React.ReactNode {
  if (!nodes || nodes.length === 0) return null
  return nodes.map((node, index) =>
    renderMdastNode(node, `${keyPrefix}-${index}`, contextDiagramSource)
  )
}

function renderMdastNode(
  node: MdastNode,
  key: string,
  contextDiagramSource: string | null
): React.ReactNode {
  switch (node.type) {
    case "root":
      return (
        <React.Fragment key={key}>
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </React.Fragment>
      )
    case "paragraph":
      return (
        <p key={key} className="m-0 max-w-[72ch] text-body">
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </p>
      )
    case "heading": {
      if (node.depth && node.depth <= 2) {
        return (
          <h3
            key={key}
            className="mt-4 mb-0.5 text-[15.5px] font-semibold tracking-tight text-ink"
          >
            {renderMdastChildren(node.children, key, contextDiagramSource)}
          </h3>
        )
      }
      return (
        <h4
          key={key}
          className="mt-2.5 -mb-0.5 text-[14.5px] font-semibold tracking-tight text-ink"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </h4>
      )
    }
    case "strong":
      return (
        <strong key={key} className="font-semibold text-ink">
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </strong>
      )
    case "emphasis":
      return (
        <em key={key} className="italic">
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </em>
      )
    case "delete":
      return (
        <del key={key} className="text-muted-ink line-through">
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </del>
      )
    case "inlineCode": {
      const value = node.value ?? ""
      const isExplicitMermaidFile = /\.(?:mmd|mermaid)$/i.test(value.trim())
      if (
        isDiagramInlineToken(value) &&
        (Boolean(contextDiagramSource) || isExplicitMermaidFile)
      ) {
        return (
          <button
            key={key}
            type="button"
            data-code-kind="diagram"
            title="Open flowchart preview in right sidebar"
            onClick={() => {
              const store = useAppStore.getState()
              if (contextDiagramSource) {
                store.openDiagramPreview(contextDiagramSource, value)
              } else {
                store.openDocPreview("diagram", value)
              }
            }}
            className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded px-1 py-[0.5px] text-left align-baseline font-mono text-[0.88em] font-medium break-all text-brand-text transition-colors hover:bg-brand-soft/60 hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Network className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-all">{value}</span>
          </button>
        )
      }

      const category = classifyInlineCode(value)
      const isClickableFileOrFolder =
        category === "folder" ||
        category === "file-ts" ||
        category === "file-rust" ||
        category === "file-doc" ||
        category === "file-data"

      if (isClickableFileOrFolder) {
        return (
          <button
            key={key}
            type="button"
            data-code-kind={category}
            title={
              category === "folder"
                ? `Open folder ${value} in right sidebar`
                : `Open ${value} in right sidebar`
            }
            onClick={() => {
              if (category === "folder") {
                useAppStore.getState().openRightTab("files", value)
              } else {
                openInlineFileTarget(value)
              }
            }}
            className={cn(
              "inline-flex max-w-full cursor-pointer items-center gap-1 rounded px-1 py-[0.5px] text-left align-baseline font-mono text-[0.88em] font-medium break-all transition-colors hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              getInlineCodeClasses(category)
            )}
          >
            {category === "folder" ? (
              <Folder className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <FileText className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 break-all">{value}</span>
          </button>
        )
      }

      return (
        <code
          key={key}
          data-code-kind={category}
          className={cn(
            "inline-flex max-w-full items-center rounded px-1 py-[0.5px] align-baseline font-mono text-[0.88em] break-all",
            getInlineCodeClasses(category)
          )}
        >
          <span className="min-w-0 break-all">{value}</span>
        </code>
      )
    }
    case "code": {
      const rawValue = node.value ?? ""
      if (isMermaidCodeBlock(rawValue, node.lang)) {
        return <MermaidCodeBlockCard key={key} value={rawValue} />
      }
      return <CodeBlockView key={key} value={rawValue} lang={node.lang} />
    }
    case "table": {
      const rows = node.children ?? []
      const [headerRow, ...bodyRows] = rows
      const alignList = node.align ?? []
      const isNumericCell = (cell?: MdastNode): boolean => {
        if (!cell?.children?.length) return false
        const text = cell.children
          .map((c) => c.value ?? "")
          .join("")
          .trim()
        return /^[$€£¥+\-−]?\d[\d,._]*%?$/.test(text)
      }
      const numericCols = (headerRow?.children ?? []).map((_, cIdx) => {
        if (alignList[cIdx] === "right") return true
        if (alignList[cIdx] === "left" || alignList[cIdx] === "center") {
          return false
        }
        return (
          bodyRows.length > 0 &&
          bodyRows.every((r) => isNumericCell(r.children?.[cIdx]))
        )
      })
      return (
        <div
          key={key}
          data-slot="markdown-table"
          className="my-2 overflow-x-auto"
        >
          <table className="w-full border-collapse text-left text-[13.5px] leading-[1.6] tabular-nums">
            {headerRow ? (
              <thead>
                <tr className="border-b border-hairline">
                  {(headerRow.children ?? []).map((cell, cIdx) => (
                    <th
                      key={`${key}-th-${cIdx}`}
                      className={cn(
                        "py-2.5 pr-5 pl-0 text-[13px] font-semibold text-ink last:pr-0",
                        (alignList[cIdx] === "right" || numericCols[cIdx]) &&
                          "text-right",
                        alignList[cIdx] === "center" && "text-center"
                      )}
                    >
                      {renderMdastChildren(
                        cell.children,
                        `${key}-th-${cIdx}`,
                        contextDiagramSource
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            {bodyRows.length > 0 ? (
              <tbody className="divide-y divide-hairline-soft">
                {bodyRows.map((row, rIdx) => (
                  <tr key={`${key}-tr-${rIdx}`}>
                    {(row.children ?? []).map((cell, cIdx) => (
                      <td
                        key={`${key}-td-${rIdx}-${cIdx}`}
                        className={cn(
                          "py-3 pr-5 pl-0 align-top text-body last:pr-0",
                          (alignList[cIdx] === "right" || numericCols[cIdx]) &&
                            "text-right font-mono text-[13px] text-ink",
                          alignList[cIdx] === "center" && "text-center"
                        )}
                      >
                        {renderMdastChildren(
                          cell.children,
                          `${key}-td-${rIdx}-${cIdx}`,
                          contextDiagramSource
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      )
    }
    case "list":
      if (node.ordered) {
        return (
          <ol
            key={key}
            className="m-0 flex max-w-[72ch] list-decimal flex-col gap-2 pl-5 text-body marker:font-medium marker:text-muted-ink"
          >
            {renderMdastChildren(node.children, key, contextDiagramSource)}
          </ol>
        )
      }
      return (
        <ul
          key={key}
          className="m-0 flex max-w-[72ch] list-disc flex-col gap-2 pl-5 text-body marker:text-muted-ink"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </ul>
      )
    case "listItem":
      return (
        <li key={key} className="pl-0.5 text-body">
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </li>
      )
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="m-0 border-l-2 border-hairline-hi py-0.5 pl-3.5 text-[13.5px] leading-[1.6] text-muted-ink"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </blockquote>
      )
    case "link":
      return (
        <a
          key={key}
          href={node.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-text underline-offset-3 hover:text-brand-bright hover:underline"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </a>
      )
    case "break":
      return <br key={key} />
    case "thematicBreak":
      return <hr key={key} className="my-2 border-hairline" />
    case "text":
      return <React.Fragment key={key}>{node.value ?? ""}</React.Fragment>
    default:
      if (node.children) {
        return (
          <React.Fragment key={key}>
            {renderMdastChildren(node.children, key, contextDiagramSource)}
          </React.Fragment>
        )
      }
      return <React.Fragment key={key}>{node.value ?? ""}</React.Fragment>
  }
}

export interface EditorialMarkdownProps {
  content: string
  inline?: boolean
  className?: string
}

export function EditorialMarkdown({
  content,
  inline = false,
  className,
}: EditorialMarkdownProps) {
  const tree = React.useMemo(
    () => markdownProcessor.parse(content) as unknown as MdastNode,
    [content]
  )
  const contextDiagramSource = React.useMemo(
    () => findFirstMermaidInTree(tree),
    [tree]
  )

  if (inline) {
    const firstChild = tree.children?.[0]
    if (
      tree.children?.length === 1 &&
      firstChild?.type === "paragraph" &&
      firstChild.children
    ) {
      return (
        <span className={className}>
          {renderMdastChildren(
            firstChild.children,
            "md-inline",
            contextDiagramSource
          )}
        </span>
      )
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-3 break-words", className)}>
      {renderMdastNode(tree, "md-root", contextDiagramSource)}
    </div>
  )
}

export interface CiteLinkProps {
  citation: CitationItem
  onNavigate?: (citation: CitationItem) => void
  className?: string
}

export function CiteLink({ citation, onNavigate, className }: CiteLinkProps) {
  const handleClick = () => {
    if (citation.kind === "code") {
      useAppStore
        .getState()
        .openCodeFile(citation.file, citation.line ?? null)
    } else {
      useAppStore.getState().openDocPreview(citation.kind, citation.file)
    }
    onNavigate?.(citation)
  }

  return (
    <button
      type="button"
      data-slot="cite-link"
      data-cite-kind={citation.kind}
      onClick={handleClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-[3px] align-baseline text-[13.5px] font-medium text-brand-text no-underline transition-colors hover:bg-brand-soft hover:text-brand-bright hover:underline hover:underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {citation.kind === "code" && (
        <span
          className="font-mono text-[11.5px] opacity-95"
          aria-hidden="true"
        >
          &lt;/&gt;
        </span>
      )}
      {citation.kind === "browser" && (
        <Globe className="size-3 shrink-0" aria-hidden="true" />
      )}
      {citation.kind === "excel" && (
        <FileSpreadsheet className="size-3 shrink-0" aria-hidden="true" />
      )}
      {citation.kind === "markdown" && (
        <FileText className="size-3 shrink-0" aria-hidden="true" />
      )}
      {citation.kind === "slide" && (
        <Presentation className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span>{citation.label}</span>
    </button>
  )
}
