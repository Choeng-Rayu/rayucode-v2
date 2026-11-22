import * as React from "react"

import { DaemonBanner } from "@/components/shell/DaemonBanner"
import { LeftSidebar } from "@/components/shell/LeftSidebar"
import {
  RightInspectorHost,
  type RightInspectorHostProps,
} from "@/components/shell/RightInspectorHost"
import { TopBar } from "@/components/shell/TopBar"
import { ROUTES } from "@/config/routes"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

export interface AppShellProps extends RightInspectorHostProps {
  children: React.ReactNode
}

export function AppShell({
  children,
  contextSlot,
  documentSlot,
  previewFallback,
}: AppShellProps) {
  const activeRoute = useAppStore((s) => s.activeRoute)
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar)

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault()
        toggleLeftSidebar()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleLeftSidebar])

  const routeMeta = ROUTES[activeRoute] ?? ROUTES.home

  return (
    <div
      data-slot="app-shell"
      data-route={activeRoute}
      className={cn(
        "flex h-screen w-screen overflow-hidden",
        leftCollapsed ? "bg-canvas" : "bg-chrome"
      )}
    >
      <LeftSidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas",
            !leftCollapsed &&
              "rounded-tl-[14px] border-t border-l border-hairline"
          )}
        >
          <DaemonBanner />
          <TopBar />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </main>
      </div>

      {routeMeta.hasRightInspector && (
        <RightInspectorHost
          contextSlot={contextSlot}
          documentSlot={documentSlot}
          previewFallback={previewFallback}
        />
      )}
    </div>
  )
}
