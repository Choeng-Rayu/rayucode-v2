import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Code2, Copy, ExternalLink, Eye, FileText } from "lucide-react"
import rehypeStringify from "rehype-stringify"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { toast } from "sonner"
import { unified } from "unified"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { openMarkdownInVSCode, previewsQueryOptions } from "../api/previews-api"
import type { MarkdownViewMode } from "../types"

export interface MarkdownPaneProps {
  className?: string
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify)

function renderMarkdownToHtml(source: string): string {
  try {
    return String(markdownProcessor.processSync(source))
  } catch {
    return `<p>${source}</p>`
  }
}

export function MarkdownPane({ className }: MarkdownPaneProps) {
  const fullView = useAppStore((s) => s.fullView)
  const { data } = useQuery(previewsQueryOptions())
  const markdown = data?.markdown

  const [viewMode, setViewMode] = React.useState<MarkdownViewMode>("rendered")
  const [copied, setCopied] = React.useState(false)

  const fileName = markdown?.fileName ?? "MIGRATION_PLAN.md"
  const filePath = markdown?.filePath ?? "docs/MIGRATION_PLAN.md"
  const rawContent = markdown?.rawContent ?? ""
  const sections = markdown?.sections ?? []

  const renderedHtml = React.useMemo(
    () => renderMarkdownToHtml(rawContent),
    [rawContent]
  )

  const rawLines = React.useMemo(
    () => rawContent.replace(/\n$/, "").split("\n"),
    [rawContent]
  )

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawContent)
      }
      setCopied(true)
      toast(`Copied ${fileName} to clipboard`)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast("Clipboard access unavailable")
    }
  }

  const handleOpenInVSCode = async () => {
    await openMarkdownInVSCode(fileName, 1)
    toast(`Opened ${filePath} in Visual Studio Code`)
  }

  return (
    <div
      data-testid="markdown-pane"
      data-view-mode={viewMode}
      className={cn("flex min-h-0 flex-1 flex-col bg-canvas", className)}
    >
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-chrome px-3 py-2 select-none">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText
            className="size-3.5 shrink-0 text-brand-text"
            strokeWidth={1.65}
            aria-hidden="true"
          />
          <span
            data-testid="markdown-file-path"
            className="truncate font-mono text-xs font-medium text-ink"
          >
            {filePath}
          </span>
          <span className="hidden rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10px] text-muted-ink sm:inline">
            GFM
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Tabs
            value={viewMode}
            onValueChange={(value) => {
              if (value === "rendered" || value === "raw") {
                setViewMode(value)
              }
            }}
            className="gap-0"
          >
            <TabsList className="h-7 p-0.5">
              <TabsTrigger
                value="rendered"
                className="h-6 px-2 text-[11px]"
              >
                <Eye className="size-3" strokeWidth={1.65} aria-hidden="true" />
                <span>Rendered</span>
              </TabsTrigger>
              <TabsTrigger value="raw" className="h-6 px-2 text-[11px]">
                <Code2 className="size-3" strokeWidth={1.65} aria-hidden="true" />
                <span>Raw</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleCopy}
            className="h-7 px-2 text-[11px]"
          >
            {copied ? (
              <Check
                className="size-3 text-brand-text"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            ) : (
              <Copy className="size-3" strokeWidth={1.65} aria-hidden="true" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleOpenInVSCode}
            className="h-7 px-2 text-[11px]"
          >
            <ExternalLink
              className="size-3"
              strokeWidth={1.65}
              aria-hidden="true"
            />
            <span>Open in VS Code</span>
          </Button>
        </div>
      </div>

      {/* Document Body */}
      <ScrollArea className="min-h-0 flex-1 bg-canvas">
        {!markdown ? (
          <div className="space-y-3 p-5">
            <div className="h-6 w-2/3 animate-pulse rounded bg-active" />
            <div className="h-4 w-full animate-pulse rounded bg-active" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-active" />
          </div>
        ) : viewMode === "rendered" ? (
          <div
            data-testid="markdown-rendered-view"
            className={cn(
              "mx-auto p-5",
              fullView
                ? "grid max-w-[920px] grid-cols-[170px_minmax(0,1fr)] gap-7"
                : "max-w-[720px]"
            )}
          >
            {fullView && sections.length > 0 && (
              <nav
                aria-label="On this page"
                className="sticky top-0 flex flex-col gap-1 self-start"
              >
                <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted-ink uppercase">
                  On this page
                </div>
                {sections.map((section, idx) => (
                  <span
                    key={section.id}
                    className={cn(
                      "rounded-sm px-2 py-1 text-xs",
                      idx === 0
                        ? "bg-hover font-medium text-ink"
                        : "text-muted-ink"
                    )}
                  >
                    {section.title}
                  </span>
                ))}
              </nav>
            )}

            <article
              className={cn(
                "max-w-[68ch] text-sm leading-relaxed text-body",
                "[&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-ink",
                "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-hairline [&_h2]:pb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-ink",
                "[&_p]:mb-3 [&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:text-body",
                "[&_strong]:font-semibold [&_strong]:text-ink",
                "[&_blockquote]:my-3 [&_blockquote]:rounded-md [&_blockquote]:border [&_blockquote]:border-brand/35 [&_blockquote]:bg-brand-softer [&_blockquote]:px-3.5 [&_blockquote]:py-2.5 [&_blockquote]:text-xs [&_blockquote]:text-ink [&_blockquote_p]:mb-0",
                "[&_ul]:my-2.5 [&_ul]:space-y-1.5 [&_ul]:pl-4 [&_ul]:text-[13px]",
                "[&_li]:text-body [&_li_input]:mr-2 [&_li_input]:accent-brand",
                "[&_code]:rounded [&_code]:border [&_code]:border-hairline [&_code]:bg-inset [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11.5px] [&_code]:text-ink",
                "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-inset [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-relaxed [&_pre]:text-ink",
                "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
                "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_table]:border-hairline [&_table]:text-xs [&_table]:tabular-nums",
                "[&_th]:border [&_th]:border-hairline [&_th]:bg-inset [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink",
                "[&_td]:border [&_td]:border-hairline [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-body"
              )}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        ) : (
          <div
            data-testid="markdown-raw-view"
            className="bg-inset p-3 font-mono text-xs leading-6 text-body tabular-nums"
          >
            {rawLines.map((line, index) => (
              <div
                key={index}
                data-line-number={index + 1}
                className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 rounded-xs px-1 hover:bg-hover"
              >
                <span className="text-right text-faint select-none">
                  {index + 1}
                </span>
                <span className="break-words whitespace-pre-wrap text-ink">
                  {line || " "}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
