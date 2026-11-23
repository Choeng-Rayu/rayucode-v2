import * as React from "react"

import { SectionErrorBoundary } from "@/components/ui/section-error-boundary"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import type { PreviewTabKind } from "../types"

const BrowserPane = React.lazy(() =>
  import("./browser-pane").then((m) => ({ default: m.BrowserPane }))
)
const DiagramPane = React.lazy(() =>
  import("./diagram-pane").then((m) => ({ default: m.DiagramPane }))
)
const ExcelPane = React.lazy(() =>
  import("./excel-pane").then((m) => ({ default: m.ExcelPane }))
)
const MarkdownPane = React.lazy(() =>
  import("./markdown-pane").then((m) => ({ default: m.MarkdownPane }))
)
const SlidePane = React.lazy(() =>
  import("./slide-pane").then((m) => ({ default: m.SlidePane }))
)

export interface PreviewsHostProps {
  /** Optional explicit preview tab override; defaults to `useAppStore((s) => s.activeRightTab)`. */
  tab?: PreviewTabKind
  className?: string
}

function PreviewPaneSkeleton() {
  return (
    <div
      data-testid="preview-pane-skeleton"
      className="flex min-h-0 flex-1 flex-col gap-3 bg-canvas p-4"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 flex-1 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
      <Skeleton className="h-44 flex-1 rounded-lg" />
    </div>
  )
}

export function PreviewsHost({ tab, className }: PreviewsHostProps) {
  const activeRightTab = useAppStore((s) => s.activeRightTab)
  const resolvedTab = tab ?? activeRightTab

  const renderPane = () => {
    switch (resolvedTab) {
      case "browser":
        return <BrowserPane />
      case "excel":
        return <ExcelPane />
      case "markdown":
        return <MarkdownPane />
      case "slide":
        return <SlidePane />
      case "diagram":
        return <DiagramPane />
      default:
        return null
    }
  }

  const content = renderPane()
  if (!content) {
    return null
  }

  return (
    <div
      data-testid="previews-host"
      data-preview-tab={resolvedTab}
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <SectionErrorBoundary title="Preview pane failed to render">
        <React.Suspense fallback={<PreviewPaneSkeleton />}>
          {content}
        </React.Suspense>
      </SectionErrorBoundary>
    </div>
  )
}
