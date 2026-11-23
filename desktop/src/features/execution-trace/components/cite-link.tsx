import * as React from "react"
import { FileSpreadsheet, FileText, Globe } from "lucide-react"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"

import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import type { CitationItem } from "../types"

interface MdastNode {
  type: string
  value?: string
  url?: string
  depth?: number
  ordered?: boolean
  lang?: string | null
  children?: MdastNode[]
}

const markdownProcessor = unified().use(remarkParse).use(remarkGfm)

function renderMdastChildren(
  nodes: MdastNode[] | undefined,
  keyPrefix: string
): React.ReactNode {
  if (!nodes || nodes.length === 0) return null
  return nodes.map((node, index) =>
    renderMdastNode(node, `${keyPrefix}-${index}`)
  )
}

function renderMdastNode(node: MdastNode, key: string): React.ReactNode {
  switch (node.type) {
    case "root":
      return (
        <React.Fragment key={key}>
          {renderMdastChildren(node.children, key)}
        </React.Fragment>
      )
    case "paragraph":
      return (
        <p key={key} className="m-0 max-w-[72ch] text-body">
          {renderMdastChildren(node.children, key)}
        </p>
      )
    case "heading": {
      const headingClasses =
        node.depth && node.depth <= 2
          ? "mt-2 mb-0 text-[15.5px] font-semibold tracking-tight text-ink"
          : "mt-1 -mb-1 text-[15px] font-semibold tracking-tight text-ink"
      return (
        <h3 key={key} className={headingClasses}>
          {renderMdastChildren(node.children, key)}
        </h3>
      )
    }
    case "strong":
      return (
        <strong key={key} className="font-semibold text-ink">
          {renderMdastChildren(node.children, key)}
        </strong>
      )
    case "emphasis":
      return (
        <em key={key} className="italic">
          {renderMdastChildren(node.children, key)}
        </em>
      )
    case "delete":
      return (
        <del key={key} className="text-muted-ink line-through">
          {renderMdastChildren(node.children, key)}
        </del>
      )
    case "inlineCode":
      return (
        <code
          key={key}
          className="rounded-[5px] border border-hairline bg-inset px-1.5 py-[1px] font-mono text-[0.86em] text-ink"
        >
          {node.value ?? ""}
        </code>
      )
    case "code":
      return (
        <pre
          key={key}
          className="m-0 max-h-[260px] overflow-auto rounded-[10px] border border-hairline bg-inset p-3 font-mono text-xs leading-relaxed text-ink"
        >
          <code>{node.value ?? ""}</code>
        </pre>
      )
    case "list":
      if (node.ordered) {
        return (
          <ol
            key={key}
            className="m-0 flex max-w-[72ch] list-decimal flex-col gap-2 pl-5 text-body marker:font-medium marker:text-muted-ink"
          >
            {renderMdastChildren(node.children, key)}
          </ol>
        )
      }
      return (
        <ul
          key={key}
          className="m-0 flex max-w-[72ch] list-disc flex-col gap-2 pl-5 text-body marker:text-muted-ink"
        >
          {renderMdastChildren(node.children, key)}
        </ul>
      )
    case "listItem":
      return (
        <li key={key} className="pl-0.5 text-body">
          {renderMdastChildren(node.children, key)}
        </li>
      )
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="m-0 border-l-2 border-hairline-strong pl-3 text-muted-ink"
        >
          {renderMdastChildren(node.children, key)}
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
          {renderMdastChildren(node.children, key)}
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
            {renderMdastChildren(node.children, key)}
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

  if (inline) {
    const firstChild = tree.children?.[0]
    if (
      tree.children?.length === 1 &&
      firstChild?.type === "paragraph" &&
      firstChild.children
    ) {
      return (
        <span className={className}>
          {renderMdastChildren(firstChild.children, "md-inline")}
        </span>
      )
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {renderMdastNode(tree, "md-root")}
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
          className="font-mono text-[11.5px] opacity-90"
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
      <span>{citation.label}</span>
    </button>
  )
}
