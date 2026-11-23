import * as React from "react"
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Globe,
  Network,
  Presentation,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary"
import { useAppStore, type RightPaneMode } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import type { PreviewDocumentTab } from "../types"
import { ContextPanel } from "./context-panel"
import { DiffTabPanel } from "./diff-tab-panel"
import { FilesTabPanel } from "./files-tab-panel"

const LazyCodeViewer = React.lazy(() =>
  import("./code-viewer").then((mod) => ({ default: mod.CodeViewer }))
)

const LazyTerminalPanel = React.lazy(() =>
  import("./terminal-panel").then((mod) => ({ default: mod.TerminalPanel }))
)

export interface InspectorSidebarProps {
  /** Optional explicit override; defaults to `useAppStore((s) => s.rightMode)`. */
  mode?: RightPaneMode
  /**
   * Optional renderer or ReactNode for document previews (`browser` | `excel` | `markdown`),
   * supplied by `features/previews` once wired in Wave 2.
   */
  previewFallback?:
    | React.ReactNode
    | ((tab: PreviewDocumentTab) => React.ReactNode)
  className?: string
}

function DefaultPreviewPlaceholder({ tab }: { tab: PreviewDocumentTab }) {
  const activeDocPill = useAppStore((s) => s.activeDocPill)
  const closeDocumentToContext = useAppStore((s) => s.closeDocumentToContext)
  const openRightTab = useAppStore((s) => s.openRightTab)

  const meta: Record<
    PreviewDocumentTab,
    { label: string; description: string; Icon: typeof Globe }
  > = {
    browser: {
      label: activeDocPill ?? "localhost:3000",
      description: "Live local browser preview pane ready for connection.",
      Icon: Globe,
    },
    excel: {
      label: activeDocPill ?? "Q4-Token-Cost-Model.xlsx",
      description: "Interactive spreadsheet workbook preview pane ready.",
      Icon: FileSpreadsheet,
    },
    markdown: {
      label: activeDocPill ?? "MIGRATION_PLAN.md",
      description: "Rendered Markdown document preview pane ready.",
      Icon: FileText,
    },
    slide: {
      label: activeDocPill ?? "Slide",
      description: "Interactive presentation & PowerPoint slide studio ready.",
      Icon: Presentation,
    },
    diagram: {
      label: activeDocPill ?? "Flowchart",
      description: "Interactive Mermaid diagram preview & source code editor.",
      Icon: Network,
    },
  }

  const { label, description, Icon } = meta[tab]

  return (
    <div
      data-testid={`inspector-preview-fallback-${tab}`}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-pane p-6 text-center"
    >
      <div className="grid size-10 place-items-center rounded-xl border border-hairline bg-inset text-brand-text">
        <Icon className="size-5" strokeWidth={1.65} aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-xs font-medium text-ink">{label}</p>
        <p className="max-w-[240px] text-xs text-muted-ink">{description}</p>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => openRightTab("files")}
        >
          View files
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={closeDocumentToContext}
        >
          <ArrowLeft className="size-3" strokeWidth={1.65} aria-hidden="true" />
          <span>Context</span>
        </Button>
      </div>
    </div>
  )
}

export function InspectorSidebar({
  mode,
  previewFallback,
  className,
}: InspectorSidebarProps) {
  const storeMode = useAppStore((s) => s.rightMode)
  const activeRightTab = useAppStore((s) => s.activeRightTab)
  const resolvedMode = mode ?? storeMode

  const renderContent = () => {
    if (resolvedMode === "context") {
      return <ContextPanel />
    }

    switch (activeRightTab) {
      case "code":
        return <LazyCodeViewer />
      case "terminal":
        return <LazyTerminalPanel />
      case "diff":
        return <DiffTabPanel />
      case "files":
        return <FilesTabPanel />
      case "browser":
      case "excel":
      case "markdown":
      case "slide":
      case "diagram": {
        if (typeof previewFallback === "function") {
          return previewFallback(activeRightTab)
        }
        if (previewFallback !== undefined && previewFallback !== null) {
          return previewFallback
        }
        return <DefaultPreviewPlaceholder tab={activeRightTab} />
      }
      case "overview":
      default:
        return <ContextPanel />
    }
  }

  return (
    <div
      data-testid="inspector-sidebar"
      data-mode={resolvedMode}
      data-tab={activeRightTab}
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <SectionErrorBoundary title="Inspector panel failed to render">
        <React.Suspense fallback={<ContextSkeleton />}>
          {renderContent()}
        </React.Suspense>
      </SectionErrorBoundary>
    </div>
  )
}
