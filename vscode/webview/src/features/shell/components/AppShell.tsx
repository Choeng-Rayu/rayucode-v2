import * as React from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/lib/app-store";
import { postToHost } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

import {
  SHELL_ROUTES,
  useShellFormFactor,
} from "../hooks/useShellNavigation";
import { AuthWelcomeScreen } from "./AuthWelcomeScreen";
import { CompactTopBar } from "./CompactTopBar";
import { IconRail, LeftSidebar } from "./LeftSidebar";
import {
  RightInspectorHost,
  type RightInspectorHostProps,
} from "./RightInspectorHost";
import { SidebarProjectsPane } from "./SidebarProjectsPane";
import { DaemonBanner } from "./StatusBarPill";
import { TopBar } from "./TopBar";

export interface AppShellProps extends RightInspectorHostProps {
  children: React.ReactNode;
  backgroundDockSlot?: React.ReactNode;
  backgroundDrawerSlot?: React.ReactNode;
}

export function AppShell({
  children,
  contextSlot,
  toolsSlot,
  artifactsSlot,
  filesSlot,
  documentSlot,
  previewFallback,
  backgroundDockSlot,
  backgroundDrawerSlot,
}: AppShellProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { formFactor, width } = useShellFormFactor(containerRef);

  const surface = useAppStore((s) => s.surface);
  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const mobileSidebarOpen = useAppStore((s) => s.mobileSidebarOpen);
  const inspectorOpen = useAppStore((s) => s.inspectorOpen);
  const chatCollapsedByRight = useAppStore((s) => s.chatCollapsedByRight);
  const authDialogOpen = useAppStore((s) => s.authDialogOpen);
  const backgroundDrawerOpen = useAppStore((s) => s.backgroundDrawerOpen);

  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setMobileSidebarOpen = useAppStore((s) => s.setMobileSidebarOpen);
  const setInspectorOpen = useAppStore((s) => s.setInspectorOpen);
  const setChatCollapsedByRight = useAppStore((s) => s.setChatCollapsedByRight);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);

  // Global keyboard shortcuts (⇧⌘S, ⌘[, ⌘], ⌘1, ⌘J)
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (formFactor === "wide") {
          toggleSidebar();
        } else {
          setMobileSidebarOpen(!useAppStore.getState().mobileSidebarOpen);
        }
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === "[") {
        event.preventDefault();
        goBack();
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === "]") {
        event.preventDefault();
        goForward();
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === "1") {
        const state = useAppStore.getState();
        if (state.chatCollapsedByRight) {
          event.preventDefault();
          setChatCollapsedByRight(false);
        }
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        postToHost({
          type: "rayucode.editor.openTerminal",
          cwd: activeProjectPath ?? undefined,
          name: "RayuCode",
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeProjectPath,
    formFactor,
    goBack,
    goForward,
    setChatCollapsedByRight,
    setMobileSidebarOpen,
    toggleSidebar,
  ]);

  const routeMeta = SHELL_ROUTES[activeRoute] ?? SHELL_ROUTES.home;
  const isFullPageSettings = activeRoute === "settings" && formFactor === "wide";
  const isChatClipped =
    formFactor === "wide" &&
    routeMeta.hasRightInspector &&
    inspectorOpen &&
    chatCollapsedByRight;

  return (
    <div
      ref={containerRef}
      data-slot="app-shell"
      data-testid="app-shell"
      data-route={activeRoute}
      data-surface={surface}
      data-form-factor={formFactor}
      data-width={width}
      className={cn(
        "@container/app relative flex h-screen w-screen max-w-full overflow-hidden",
        !isFullPageSettings && sidebarCollapsed ? "bg-canvas" : "bg-chrome",
      )}
    >
        {isFullPageSettings ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
            <DaemonBanner />
            <TopBar />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {children}
            </div>
          </div>
        ) : formFactor === "compact" ? (
          /* ============ Mode C: Compact Docked Sidebar (< 560px) ============ */
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
            <DaemonBanner />
            <CompactTopBar
              onOpenSessionsDrawer={() => setMobileSidebarOpen(true)}
              onOpenInspectorSheet={() => setInspectorOpen(true)}
            />
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col",
                  activeRoute === "home" || activeRoute === "workspace"
                    ? "overflow-hidden"
                    : "overflow-y-auto",
                )}
              >
                {children}
              </div>
              {backgroundDockSlot}
            </main>
          </div>
        ) : formFactor === "medium" ? (
          /* ============ Mode B: Medium Split (560px–959px) ============ */
          <>
            <IconRail
              onOpenSessionsDrawer={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
              <DaemonBanner />
              <TopBar />
              <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div
                  className={cn(
                    "flex min-h-0 flex-1 flex-col",
                    activeRoute === "home" || activeRoute === "workspace"
                      ? "overflow-hidden"
                      : "overflow-y-auto",
                  )}
                >
                  {children}
                </div>
                {backgroundDockSlot}
              </main>
            </div>
          </>
        ) : (
          /* ============ Mode A: Wide Editor Panel (>= 960px) ============ */
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
                      !sidebarCollapsed &&
                        "rounded-tl-[14px] border-t border-l border-hairline",
                    )}
                  >
                    <DaemonBanner />
                    <TopBar />
                    <div
                      className={cn(
                        "flex min-h-0 flex-1 flex-col",
                        activeRoute === "home" || activeRoute === "workspace"
                          ? "overflow-hidden"
                          : "overflow-y-auto",
                      )}
                    >
                      {children}
                    </div>
                    {backgroundDockSlot}
                  </main>
                </div>
              )}

              {routeMeta.hasRightInspector && (
                <RightInspectorHost
                  contextSlot={contextSlot}
                  toolsSlot={toolsSlot}
                  artifactsSlot={artifactsSlot}
                  filesSlot={filesSlot}
                  documentSlot={documentSlot}
                  previewFallback={previewFallback}
                />
              )}
            </div>
          </>
        )}

        {/* Slide-Over Sessions & Projects Drawer for Compact & Medium Form Factors */}
        {formFactor !== "wide" && mobileSidebarOpen && (
          <div
            data-testid="slide-over-sessions-drawer"
            className="fixed inset-0 z-50 flex"
          >
            <div
              aria-hidden="true"
              onClick={() => setMobileSidebarOpen(false)}
              className="rayu-animate-fade fixed inset-0 bg-chrome/70 backdrop-blur-xs"
            />
            <div className="relative z-10 flex h-full max-w-[90vw] border-r border-premium-hi bg-chrome shadow-modal">
              {formFactor === "compact" && (
                <IconRail
                  onCloseDrawer={() => setMobileSidebarOpen(false)}
                />
              )}
              <SidebarProjectsPane
                onSessionSelected={() => setMobileSidebarOpen(false)}
                onCloseDrawer={() => setMobileSidebarOpen(false)}
              />
            </div>
          </div>
        )}

        {/* Slide-Over Right Inspector Sheet for Compact & Medium Form Factors */}
        {formFactor !== "wide" && inspectorOpen && (
          <div
            data-testid="slide-over-inspector-sheet"
            className="fixed inset-0 z-50 flex justify-end"
          >
            <div
              aria-hidden="true"
              onClick={() => setInspectorOpen(false)}
              className="rayu-animate-fade fixed inset-0 bg-chrome/70 backdrop-blur-xs"
            />
            <div
              className={cn(
                "relative z-10 flex h-full flex-col bg-canvas shadow-modal",
                formFactor === "compact" ? "w-full" : "w-[360px] max-w-[90vw]",
              )}
            >
              <RightInspectorHost
                sheetMode
                contextSlot={contextSlot}
                toolsSlot={toolsSlot}
                artifactsSlot={artifactsSlot}
                filesSlot={filesSlot}
                documentSlot={documentSlot}
                previewFallback={previewFallback}
              />
            </div>
          </div>
        )}

        {/* Background Process Drawer Slot */}
        {backgroundDrawerOpen && backgroundDrawerSlot && (
          <div
            data-testid="background-drawer-host"
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[65vh] flex-col overflow-hidden border-t border-premium-hi bg-pane shadow-modal"
          >
            {backgroundDrawerSlot}
          </div>
        )}

        {/* Auth Welcome / Sign-In Modal when triggered from Usage or Profile */}
        <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-md overflow-hidden p-0">
            <DialogTitle className="sr-only">
              Sign in to RayuCode
            </DialogTitle>
            <div className="h-[520px] max-h-[85vh] w-full">
              <AuthWelcomeScreen onContinue={() => setAuthDialogOpen(false)} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
  );
}
