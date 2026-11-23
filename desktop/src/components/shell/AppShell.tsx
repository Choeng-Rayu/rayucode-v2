import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { DaemonBanner } from "@/components/shell/DaemonBanner"
import { LeftSidebar } from "@/components/shell/LeftSidebar"
import {
  RightInspectorHost,
  type RightInspectorHostProps,
} from "@/components/shell/RightInspectorHost"
import { SideChatDrawer } from "@/components/shell/SideChatDrawer"
import { TopBar } from "@/components/shell/TopBar"
import { ROUTES } from "@/config/routes"
import { previewsKeys, type PreviewsViewModel } from "@/features/previews"
import { useAppStore, type SlideItem } from "@/lib/app-store"
import { ipcClient, type DesktopArtifactEvent } from "@/lib/ipc-client"
import { officeWorkbookToPreviewState } from "@/lib/office-workbook"
import { cn } from "@/lib/utils"

export interface AppShellProps extends RightInspectorHostProps {
  children: React.ReactNode
}

function basenameOf(rawPath: string): string {
  const parts = rawPath.replace(/[\\/]+$/, "").split(/[\\/]/)
  return parts[parts.length - 1] || rawPath
}

function mapArtifactSlides(
  slides: Extract<DesktopArtifactEvent, { kind: "slide" }>["slides"]
): SlideItem[] {
  return slides.map((slide, idx) => ({
    id: slide.id ?? `slide_${idx + 1}`,
    kicker: slide.kicker ?? "",
    title: slide.title,
    subtitle: slide.subtitle ?? "",
    body: slide.body,
    bullets: slide.bullets,
    metrics: slide.metrics?.map((m) => ({
      label: m.label,
      value: m.value,
      note: m.note ?? "",
    })),
    notes: slide.notes,
    layout: slide.layout,
  }))
}

function browserPillFor(url?: string): string {
  if (!url) return "Browser"
  try {
    return new URL(url).host.replace(/^www\./, "") || "Browser"
  } catch {
    return "Browser"
  }
}

export function AppShell({
  children,
  contextSlot,
  documentSlot,
  previewFallback,
}: AppShellProps) {
  const queryClient = useQueryClient()
  const activeRoute = useAppStore((s) => s.activeRoute)
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const rightCollapsed = useAppStore((s) => s.rightCollapsed)
  const chatCollapsedByRight = useAppStore((s) => s.chatCollapsedByRight)
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar)
  const toggleSideChat = useAppStore((s) => s.toggleSideChat)
  const setChatCollapsedByRight = useAppStore((s) => s.setChatCollapsedByRight)
  const goBack = useAppStore((s) => s.goBack)
  const goForward = useAppStore((s) => s.goForward)

  // Hydrate Slide Studio / Excel pane / Browser tab from real desktop tool execution
  React.useEffect(() => {
    const unsubArtifact = ipcClient.desktop.onArtifact((artifact) => {
      const store = useAppStore.getState()
      if (artifact.kind === "slide") {
        const slides = mapArtifactSlides(artifact.slides)
        store.setSlideDeck({
          title: artifact.title,
          templateName: basenameOf(artifact.filePath),
          filePath: artifact.filePath,
          activeSlideIndex: 0,
          slides,
        })
        store.openDocPreview("slide", artifact.title || "Slide")
        return
      }
      if (artifact.kind === "excel") {
        const workbook = artifact.workbook
        store.setLiveExcelWorkbook(workbook)
        const nextExcel = officeWorkbookToPreviewState(workbook)
        queryClient.setQueryData<PreviewsViewModel>(
          previewsKeys.state(),
          (prev) => (prev ? { ...prev, excel: nextExcel } : prev)
        )
        store.openDocPreview("excel", workbook.fileName)
      }
    })

    const unsubBrowser = ipcClient.browser.onEnsureOpen((payload) => {
      useAppStore
        .getState()
        .openDocPreview("browser", browserPillFor(payload.url))
    })

    return () => {
      unsubArtifact()
      unsubBrowser()
    }
  }, [queryClient])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault()
        toggleLeftSidebar()
        return
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === "[") {
        event.preventDefault()
        goBack()
        return
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === "]") {
        event.preventDefault()
        goForward()
        return
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === "1") {
        const state = useAppStore.getState()
        if (state.chatCollapsedByRight) {
          event.preventDefault()
          setChatCollapsedByRight(false)
          return
        }
      }
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault()
        const state = useAppStore.getState()
        if (
          !state.rightCollapsed &&
          state.rightMode === "document" &&
          state.activeRightTab === "terminal"
        ) {
          state.toggleRightSidebar()
        } else {
          state.openRightTab("terminal", "Terminal")
        }
        return
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === ";") {
        event.preventDefault()
        toggleSideChat()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [goBack, goForward, setChatCollapsedByRight, toggleLeftSidebar, toggleSideChat])

  const routeMeta = ROUTES[activeRoute] ?? ROUTES.home
  const isFullPageSettings = activeRoute === "settings"
  const isChatClipped =
    routeMeta.hasRightInspector && !rightCollapsed && chatCollapsedByRight

  return (
    <div
      data-slot="app-shell"
      data-route={activeRoute}
      className={cn(
        "flex h-screen w-screen overflow-hidden",
        !isFullPageSettings && leftCollapsed ? "bg-canvas" : "bg-chrome"
      )}
    >
      {isFullPageSettings ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <DaemonBanner />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      ) : (
        <>
          <LeftSidebar />

          <div
            data-slot="workspace-split-stage"
            className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {!isChatClipped && (
              <div className="flex min-h-0 min-w-[320px] flex-1 flex-col overflow-hidden">
                <main
                  className={cn(
                    "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas",
                    !leftCollapsed &&
                      "rounded-tl-[14px] border-t border-l border-hairline"
                  )}
                >
                  <DaemonBanner />
                  <TopBar />
                  <div
                    className={cn(
                      "flex min-h-0 flex-1 flex-col",
                      activeRoute === "home" || activeRoute === "workspace"
                        ? "overflow-hidden"
                        : "overflow-y-auto"
                    )}
                  >
                    {children}
                  </div>
                  <SideChatDrawer />
                </main>
              </div>
            )}

            {routeMeta.hasRightInspector && (
              <RightInspectorHost
                contextSlot={contextSlot}
                documentSlot={documentSlot}
                previewFallback={previewFallback}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
