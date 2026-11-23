import * as React from "react"

import { RightSidebarTopBar } from "@/components/shell/TopBar"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary"
import {
  ContextPanel,
  InspectorSidebar,
  type PreviewDocumentTab,
} from "@/features/inspector"
import { PreviewsHost } from "@/features/previews"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

export interface RightInspectorHostProps {
  contextSlot?: React.ReactNode
  documentSlot?: React.ReactNode
  /**
   * Optional renderer or ReactNode for document previews (`browser` | `excel` | `markdown`),
   * supplied by `features/previews` (`BrowserPane`, `ExcelPane`, `MarkdownPane`) in Wave 2.
   */
  previewFallback?:
    | React.ReactNode
    | ((tab: PreviewDocumentTab) => React.ReactNode)
}

export function RightInspectorHost({
  contextSlot,
  documentSlot,
  previewFallback,
}: RightInspectorHostProps) {
  const rightCollapsed = useAppStore((s) => s.rightCollapsed)
  const rightMode = useAppStore((s) => s.rightMode)
  const activeRightTab = useAppStore((s) => s.activeRightTab)
  const fullView = useAppStore((s) => s.fullView)
  const isWidePreview =
    rightMode === "document" &&
    (activeRightTab === "slide" ||
      activeRightTab === "excel" ||
      activeRightTab === "browser" ||
      activeRightTab === "diagram")

  if (rightCollapsed) {
    return null
  }

  const renderBody = () => {
    if (rightMode === "context" && contextSlot) {
      return contextSlot
    }
    if (rightMode === "document" && documentSlot) {
      return documentSlot
    }
    return (
      <InspectorSidebar
        mode={rightMode}
        previewFallback={previewFallback ?? <PreviewsHost />}
      />
    )
  }

  return (
    <aside
      aria-label="Environment, context and previews"
      className={cn(
        "flex h-full shrink-0 flex-col border-l border-hairline bg-chrome transition-[width] duration-150",
        fullView
          ? "fixed inset-0 z-40 w-full"
          : isWidePreview
            ? "w-[50%] min-w-[420px] max-w-[760px]"
            : "w-[344px]"
      )}
    >
      <RightSidebarTopBar />
      <SectionErrorBoundary title="Right inspector failed to load">
        <React.Suspense fallback={<ContextSkeleton />}>
          {renderBody()}
        </React.Suspense>
      </SectionErrorBoundary>
    </aside>
  )
}

export { ContextPanel }
