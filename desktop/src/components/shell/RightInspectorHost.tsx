import * as React from "react"
import { PanelLeftOpen } from "lucide-react"

import { RightSidebarTopBar } from "@/components/shell/TopBar"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary"
import {
  ContextPanel,
  InspectorSidebar,
  type PreviewDocumentTab,
} from "@/features/inspector"
import { PreviewsHost } from "@/features/previews"
import { useAppStore, type RightTabId } from "@/lib/app-store"
import { cn } from "@/lib/utils"

export interface RightInspectorHostProps {
  contextSlot?: React.ReactNode
  documentSlot?: React.ReactNode
  previewFallback?:
    | React.ReactNode
    | ((tab: PreviewDocumentTab) => React.ReactNode)
}

const SELF_HEADERED_TABS = new Set<RightTabId>([
  "terminal",
  "diff",
  "browser",
  "files",
])

/** Minimum comfortable width of the chat session pane before snap-clipping (matches Codex). */
const MIN_CHAT_WIDTH_PX = 320
/** Dragging the right-panel divider further left than this remaining chat width snaps & clips the chat session. */
const SNAP_CLIP_CHAT_THRESHOLD_PX = 210
const MIN_RIGHT_PANEL_WIDTH_PX = 280

function getDefaultWidthClass(
  rightMode: "context" | "document",
  activeRightTab: RightTabId
): string {
  if (rightMode === "context") {
    return "w-[332px] max-w-[calc(100%-320px)]"
  }
  switch (activeRightTab) {
    case "diff":
      return "w-[64%] min-w-[420px] max-w-[calc(100%-320px)]"
    case "files":
      return "w-[60%] min-w-[400px] max-w-[calc(100%-320px)]"
    case "browser":
      return "w-[56%] min-w-[380px] max-w-[calc(100%-320px)]"
    case "terminal":
      return "w-[46%] min-w-[340px] max-w-[calc(100%-320px)]"
    case "slide":
    case "excel":
    case "markdown":
    case "diagram":
    case "code":
      return "w-[54%] min-w-[380px] max-w-[calc(100%-320px)]"
    default:
      return "w-[332px] max-w-[calc(100%-320px)]"
  }
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
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const rightWidthPx = useAppStore((s) => s.rightWidthPx)
  const chatCollapsedByRight = useAppStore((s) => s.chatCollapsedByRight)
  const setRightWidthPx = useAppStore((s) => s.setRightWidthPx)
  const setChatCollapsedByRight = useAppStore((s) => s.setChatCollapsedByRight)

  const asideRef = React.useRef<HTMLElement | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  const handleResizeStart = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (fullView) return
      event.preventDefault()
      setIsDragging(true)

      const stageEl = asideRef.current?.parentElement
      const stageRect = stageEl?.getBoundingClientRect()
      const stageLeft = stageRect ? stageRect.left : leftCollapsed ? 52 : 296
      const stageWidth = stageRect
        ? stageRect.width
        : Math.max(600, window.innerWidth - stageLeft)

      const onMouseMove = (moveEvent: MouseEvent) => {
        const remainingChatWidth = moveEvent.clientX - stageLeft
        const desiredRightWidth = stageLeft + stageWidth - moveEvent.clientX

        // Dragging further left past the chat floor snaps & clips the chat session (Codex-style)
        if (remainingChatWidth < SNAP_CLIP_CHAT_THRESHOLD_PX) {
          setChatCollapsedByRight(true)
          setRightWidthPx(null)
          return
        }

        // Dragging right restores the chat session smoothly with a minimum healthy chat width
        setChatCollapsedByRight(false)
        const maxSplitRightWidth = Math.max(
          MIN_RIGHT_PANEL_WIDTH_PX,
          stageWidth - MIN_CHAT_WIDTH_PX
        )
        const clamped = Math.max(
          MIN_RIGHT_PANEL_WIDTH_PX,
          Math.min(maxSplitRightWidth, desiredRightWidth)
        )
        setRightWidthPx(clamped)
      }

      const onMouseUp = () => {
        setIsDragging(false)
        window.removeEventListener("mousemove", onMouseMove)
        window.removeEventListener("mouseup", onMouseUp)
      }

      window.addEventListener("mousemove", onMouseMove)
      window.addEventListener("mouseup", onMouseUp)
    },
    [fullView, leftCollapsed, setChatCollapsedByRight, setRightWidthPx]
  )

  if (rightCollapsed) {
    return null
  }

  const hasCustomSelfHeader =
    rightMode === "document" &&
    !documentSlot &&
    SELF_HEADERED_TABS.has(activeRightTab)
  const isSeamlessContextHeader =
    rightMode === "context" && !fullView && !chatCollapsedByRight

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
      ref={asideRef}
      aria-label="Environment, context and previews"
      data-chat-clipped={chatCollapsedByRight ? "true" : "false"}
      style={
        !fullView && !chatCollapsedByRight && rightWidthPx !== null
          ? { width: `${rightWidthPx}px` }
          : undefined
      }
      className={cn(
        "relative flex h-full shrink-0 flex-col border-hairline bg-canvas",
        !isDragging && "transition-[width] duration-150",
        fullView
          ? "fixed inset-0 z-40 w-full border-l"
          : chatCollapsedByRight
            ? cn("min-w-0 flex-1 border-l-0", !leftCollapsed && "border-t")
            : cn(
                !isSeamlessContextHeader && "border-l",
                !leftCollapsed && "border-t",
                rightWidthPx === null
                  ? getDefaultWidthClass(rightMode, activeRightTab)
                  : "min-w-[280px] max-w-[calc(100%-320px)]"
              )
      )}
    >
      {/* Interactive Drag-Resize & Snap-Clip Divider Handle */}
      {!fullView && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
          title={
            chatCollapsedByRight
              ? "Drag right to restore chat session"
              : "Drag left to expand (drag further to hide chat · double-click to reset)"
          }
          onMouseDown={handleResizeStart}
          onDoubleClick={() => {
            setChatCollapsedByRight(false)
            setRightWidthPx(null)
          }}
          className={cn(
            "absolute bottom-0 -left-[3px] z-30 w-[6px] cursor-col-resize transition-colors",
            isSeamlessContextHeader ? "top-[46px]" : "top-0",
            isDragging ? "bg-brand/55" : "hover:bg-info/45"
          )}
        />
      )}

      {/* Restore Chat Session Banner when chat was clipped by dragging left */}
      {!fullView && chatCollapsedByRight && (
        <div
          data-testid="restore-chat-bar"
          className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-hairline-soft bg-chrome px-3 text-xs select-none"
        >
          <button
            type="button"
            onClick={() => setChatCollapsedByRight(false)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-hover"
          >
            <PanelLeftOpen
              className="size-3.5 text-brand-text"
              strokeWidth={1.65}
              aria-hidden="true"
            />
            <span>Show chat session</span>
            <kbd className="ml-1 rounded bg-active px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
              ⌘1
            </kbd>
          </button>
          <span className="text-[11px] text-muted-ink">
            Drag left edge right to split
          </span>
        </div>
      )}

      {!hasCustomSelfHeader && <RightSidebarTopBar />}

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          isSeamlessContextHeader && "border-l border-hairline"
        )}
      >
        <SectionErrorBoundary title="Right inspector failed to load">
          <React.Suspense fallback={<ContextSkeleton />}>
            {renderBody()}
          </React.Suspense>
        </SectionErrorBoundary>
      </div>
    </aside>
  )
}

export { ContextPanel }
