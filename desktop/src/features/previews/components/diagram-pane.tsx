import * as React from "react"
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  Minus,
  Network,
  Plus,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { MermaidDiagramSvg } from "@/components/ui/mermaid-diagram"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppStore } from "@/lib/app-store"
import {
  layoutMermaidFlowchart,
  type PositionedNode,
} from "@/lib/mermaid-flowchart"
import { cn } from "@/lib/utils"

export interface DiagramPaneProps {
  className?: string
}

type DiagramViewMode = "preview" | "code"

const KNOWN_NODE_FILE_MAP: Array<{ match: RegExp; file: string }> = [
  { match: /preload\.cjs/i, file: "desktop/electron/preload.cjs" },
  { match: /ipc-client/i, file: "desktop/src/lib/ipc-client.ts" },
  { match: /app-store/i, file: "desktop/src/lib/app-store.ts" },
  { match: /query-client|tanstack/i, file: "desktop/src/lib/query-client.ts" },
  { match: /daemon-client|RayuDaemonClient/i, file: "desktop/electron/daemon-client.ts" },
  { match: /auth-bridge|RayuAuthManager/i, file: "desktop/electron/auth-bridge.ts" },
  { match: /IPC handlers|Electron main/i, file: "desktop/electron/main.ts" },
]

function resolveNodeTargetFile(node: PositionedNode): string | null {
  const directFile = node.label.match(
    /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|cjs|mjs|rs|json|md|css|toml|yml|yaml))/
  )
  if (directFile?.[1]) {
    return directFile[1]
  }
  for (const entry of KNOWN_NODE_FILE_MAP) {
    if (entry.match.test(node.label) || entry.match.test(node.id)) {
      return entry.file
    }
  }
  return null
}

export function DiagramPane({ className }: DiagramPaneProps) {
  const activeDiagram = useAppStore((s) => s.activeDiagram)
  const setActiveDiagramSource = useAppStore((s) => s.setActiveDiagramSource)
  const openCodeFile = useAppStore((s) => s.openCodeFile)

  const [viewMode, setViewMode] = React.useState<DiagramViewMode>("preview")
  const [zoom, setZoom] = React.useState(1)
  const [copied, setCopied] = React.useState(false)
  const svgRef = React.useRef<SVGSVGElement | null>(null)

  const layout = React.useMemo(
    () => layoutMermaidFlowchart(activeDiagram.source),
    [activeDiagram.source]
  )

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeDiagram.source)
      }
      setCopied(true)
      toast("Copied Mermaid source to clipboard")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast("Clipboard access unavailable")
    }
  }

  const handleExportSvg = () => {
    const svgEl = svgRef.current
    if (!svgEl) {
      toast("Switch to Preview mode to export SVG")
      return
    }
    try {
      const serializer = new XMLSerializer()
      const svgMarkup = serializer.serializeToString(svgEl)
      const blob = new Blob([svgMarkup], {
        type: "image/svg+xml;charset=utf-8",
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      const slug = activeDiagram.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
      anchor.download = `${slug || "flowchart"}.svg`
      anchor.click()
      URL.revokeObjectURL(url)
      toast(`Exported ${anchor.download}`)
    } catch {
      toast("Unable to export SVG in this environment")
    }
  }

  const handleNodeClick = (node: PositionedNode) => {
    const targetFile = resolveNodeTargetFile(node)
    if (targetFile) {
      openCodeFile(targetFile, null)
      toast(`Opened ${targetFile}`)
      return
    }
    toast(`Selected node: ${node.label}`)
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div
      data-testid="diagram-pane"
      data-view-mode={viewMode}
      className={cn("flex min-h-0 flex-1 flex-col bg-canvas", className)}
    >
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-chrome px-3 py-2 select-none">
        <div className="flex min-w-0 items-center gap-1.5">
          <Network
            className="size-3.5 shrink-0 text-code-type"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span
            data-testid="diagram-title"
            className="truncate font-mono text-xs font-medium text-ink"
          >
            {activeDiagram.title}
          </span>
          <span className="hidden rounded-full border border-pill-edit-fg/25 bg-pill-edit-bg px-2 py-0.5 font-mono text-[10px] font-medium text-code-type sm:inline">
            flowchart {layout.direction}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Tabs
            value={viewMode}
            onValueChange={(value) => {
              if (value === "preview" || value === "code") {
                setViewMode(value)
              }
            }}
            className="gap-0"
          >
            <TabsList className="h-7 p-0.5">
              <TabsTrigger
                value="preview"
                data-testid="diagram-mode-preview"
                className="h-6 px-2 text-[11px]"
              >
                <Eye className="size-3" strokeWidth={1.65} aria-hidden="true" />
                <span>Preview</span>
              </TabsTrigger>
              <TabsTrigger
                value="code"
                data-testid="diagram-mode-code"
                className="h-6 px-2 text-[11px]"
              >
                <Code2 className="size-3" strokeWidth={1.65} aria-hidden="true" />
                <span>Code</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {viewMode === "preview" ? (
            <div className="inline-flex items-center rounded-md border border-hairline bg-inset p-0.5">
              <button
                type="button"
                aria-label="Zoom out diagram"
                onClick={() =>
                  setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))
                }
                className="grid size-6 cursor-pointer place-items-center rounded-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <Minus className="size-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Reset diagram zoom"
                onClick={() => setZoom(1)}
                data-testid="diagram-zoom-value"
                className="min-w-[42px] cursor-pointer px-1 text-center font-mono text-[10.5px] text-body tabular-nums hover:text-ink"
              >
                {zoomPercent}%
              </button>
              <button
                type="button"
                aria-label="Zoom in diagram"
                onClick={() =>
                  setZoom((z) => Math.min(2, Number((z + 0.15).toFixed(2))))
                }
                className="grid size-6 cursor-pointer place-items-center rounded-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <Plus className="size-3" aria-hidden="true" />
              </button>
              {zoom !== 1 ? (
                <button
                  type="button"
                  aria-label="Fit diagram"
                  onClick={() => setZoom(1)}
                  className="grid size-6 cursor-pointer place-items-center rounded-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <RotateCcw className="size-2.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void handleCopy()}
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
            onClick={handleExportSvg}
            className="h-7 px-2 text-[11px]"
          >
            <Download className="size-3" strokeWidth={1.65} aria-hidden="true" />
            <span>SVG</span>
          </Button>
        </div>
      </div>

      {/* Main Content */}
      {viewMode === "preview" ? (
        <ScrollArea className="min-h-0 flex-1 bg-canvas">
          <div
            data-testid="diagram-preview-stage"
            className="flex min-h-full flex-col gap-3 p-4"
          >
            <div className="rounded-xl border border-premium bg-pane/70 p-2 shadow-bevel-surface">
              <MermaidDiagramSvg
                source={activeDiagram.source}
                zoom={zoom}
                svgRef={svgRef}
                onNodeClick={handleNodeClick}
                className="min-h-[300px]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-inset/70 px-3 py-2 text-[11px] text-muted-ink">
              <span>
                Click any component node linked to a source file to inspect it
                in the editor.
              </span>
              <span className="font-mono text-[10.5px] text-body tabular-nums">
                {layout.subgraphs.length} subgraphs · {layout.nodes.length}{" "}
                nodes · {layout.edges.length} edges
              </span>
            </div>
          </div>
        </ScrollArea>
      ) : (
        <div
          data-testid="diagram-code-view"
          className="flex min-h-0 flex-1 flex-col bg-inset"
        >
          <div className="flex items-center justify-between border-b border-hairline-soft bg-pane/70 px-3 py-1.5 text-[11px] text-muted-ink">
            <span className="font-mono text-code-type">mermaid</span>
            <span>Edits update Preview immediately</span>
          </div>
          <textarea
            aria-label="Mermaid diagram source"
            data-testid="diagram-code-editor"
            spellCheck={false}
            value={activeDiagram.source}
            onChange={(event) => setActiveDiagramSource(event.target.value)}
            className="min-h-0 flex-1 resize-none bg-inset p-4 font-mono text-xs leading-6 text-ink outline-none"
          />
        </div>
      )}
    </div>
  )
}
