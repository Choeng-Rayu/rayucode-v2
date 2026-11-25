import * as React from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileDown,
  Folder,
  GitFork,
  ListTodo,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Palette,
  PanelRight,
  Pencil,
  Plus,
  Sparkles,
  SunMoon,
  X,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InspectorTabIcon, NavGlyph } from "@/components/ui/rayu-symbols";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore, type RightTabId } from "@/lib/app-store";
import { callRpc, postToHost } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

import {
  RIGHT_INSPECTOR_TABS,
  SHELL_ROUTES,
  type RightInspectorTabItem,
} from "../hooks/useShellNavigation";
import { StatusBarPill } from "./StatusBarPill";

export function MoreOptionsMenu({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const surface = useAppStore((s) => s.surface);
  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const keepAwake = useAppStore((s) => s.keepAwake);
  const theme = useAppStore((s) => s.theme);
  const accent = useAppStore((s) => s.accent);
  const setKeepAwake = useAppStore((s) => s.setKeepAwake);
  const toggleBackgroundDrawer = useAppStore((s) => s.toggleBackgroundDrawer);
  const openRightTab = useAppStore((s) => s.openRightTab);
  const cycleTheme = useAppStore((s) => s.cycleTheme);
  const toggleAccent = useAppStore((s) => s.toggleAccent);

  const handleToggleKeepAwake = (checked: boolean) => {
    setKeepAwake(checked);
    void callRpc("plugins.workspace.trigger", {
      integration: "companion",
      action: "setKeepAwake",
      payload: { keepAwake: checked },
    }).catch(() => {});
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              data-testid="topbar-more-options"
              className={cn(
                "grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink",
                triggerClassName,
              )}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">More options</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" sideOffset={6} className="w-[236px]">
        <DropdownMenuItem onClick={toggleBackgroundDrawer}>
          <NavGlyph icon="processes" className="size-3.5" />
          <span>Background processes</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => openRightTab("sidePanel", "Side Panel")}>
          <ListTodo className="size-3.5" />
          <span>Plan &amp; Side Panel</span>
        </DropdownMenuItem>

        {surface === "sidebar" && (
          <DropdownMenuItem
            data-testid="more-menu-open-beside"
            onClick={() =>
              postToHost({
                type: "rayucode.ui.openEditorPanel",
                route: activeRoute,
                sessionId: activeSessionId ?? undefined,
                beside: true,
              })
            }
          >
            <ExternalLink className="size-3.5" />
            <span>Open Beside Editor</span>
          </DropdownMenuItem>
        )}

        {surface === "editorPanel" && (
          <DropdownMenuItem
            data-testid="more-menu-focus-sidebar"
            onClick={() =>
              postToHost({
                type: "rayucode.ui.focusSidebar",
              })
            }
          >
            <PanelRight className="size-3.5" />
            <span>Focus Secondary Sidebar</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={cycleTheme}>
          <SunMoon className="size-3.5" />
          <span>Cycle theme ({theme})</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={toggleAccent}>
          <Palette className="size-3.5" />
          <span>
            Switch accent ({accent === "green" ? "Rayu Green" : "Ocean Blue"})
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <div className="flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 transition-colors hover:bg-hover">
          <div className="min-w-0">
            <div className="text-xs leading-snug text-ink">
              Keep computer awake
            </div>
            <div className="text-[10.5px] leading-snug text-muted-ink">
              Via Rayu Companion
            </div>
          </div>
          <Switch
            size="sm"
            checked={keepAwake}
            onCheckedChange={handleToggleKeepAwake}
            aria-label="Keep computer awake"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SixIconStrip({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const activeRightTab = useAppStore((s) => s.activeRightTab);
  const rightMode = useAppStore((s) => s.rightMode);
  const inspectorOpen = useAppStore((s) => s.inspectorOpen);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const openRightTab = useAppStore((s) => s.openRightTab);
  const toggleInspector = useAppStore((s) => s.toggleInspector);

  const isTabSelected = (tab: RightInspectorTabItem): boolean => {
    if (!inspectorOpen) return false;
    if (tab.id === "overview") return rightMode === "context";
    if (rightMode !== "document") return false;
    if (activeRightTab === tab.id) return true;
    if (
      tab.id === "files" &&
      (activeRightTab === "code" ||
        activeRightTab === "markdown" ||
        activeRightTab === "diagram" ||
        activeRightTab === "sidePanel")
    ) {
      return true;
    }
    return false;
  };

  const handleTabClick = (tab: RightInspectorTabItem) => {
    if (tab.id === "terminal") {
      postToHost({
        type: "rayucode.editor.openTerminal",
        cwd: activeProjectPath ?? undefined,
        name: "RayuCode",
      });
      return;
    }
    if (tab.id === "overview") {
      if (rightMode === "context" && inspectorOpen) {
        toggleInspector();
      } else {
        openRightTab("overview", null);
      }
      return;
    }
    if (inspectorOpen && rightMode === "document" && activeRightTab === tab.id) {
      toggleInspector();
      return;
    }
    openRightTab(tab.id, tab.pillLabel);
  };

  return (
    <div
      role="tablist"
      aria-label="Right inspector panels"
      data-slot="six-icon-strip"
      className={cn(
        "inline-flex min-w-0 items-center",
        compact ? "shrink gap-0 overflow-x-auto" : "gap-0.5",
        className,
      )}
    >
      {RIGHT_INSPECTOR_TABS.map((tab) => {
        const isSelected = isTabSelected(tab);
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="tab"
                aria-label={tab.label}
                aria-selected={isSelected}
                data-testid={`inspector-strip-${tab.id}`}
                onClick={() => handleTabClick(tab)}
                className={cn(
                  "grid cursor-pointer place-items-center rounded-[7px] transition-colors",
                  compact ? "size-6 shrink-0" : "h-7 w-7",
                  isSelected
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink",
                )}
              >
                <InspectorTabIcon icon={tab.icon} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>{tab.label}</span>
              {tab.shortcut ? (
                <kbd className="font-mono text-[10.5px] text-muted-ink">
                  {tab.shortcut}
                </kbd>
              ) : null}
            </TooltipContent>
          </Tooltip>
        );
      })}
      <MoreOptionsMenu
        triggerClassName={compact ? "h-6 w-6 shrink-0" : undefined}
      />
    </div>
  );
}

export function TopBar() {
  const surface = useAppStore((s) => s.surface);
  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSessionTitle = useAppStore((s) => s.activeSessionTitle);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const inspectorOpen = useAppStore((s) => s.inspectorOpen);
  const rightMode = useAppStore((s) => s.rightMode);
  const navHistory = useAppStore((s) => s.navHistory);
  const navHistoryIndex = useAppStore((s) => s.navHistoryIndex);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);

  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;

  const routeMeta = SHELL_ROUTES[activeRoute] ?? SHELL_ROUTES.home;
  const displayTitle =
    activeRoute === "workspace"
      ? activeSessionTitle || "Active session"
      : routeMeta.title;

  const showCenterStrip =
    routeMeta.hasRightInspector &&
    (rightMode === "document" || !inspectorOpen);

  const handleForkCurrent = async () => {
    if (!activeSessionId) return;
    const res = await callRpc("sessions.fork", { sessionId: activeSessionId });
    setActiveSession(res.session.sessionId, res.session.title);
  };

  const handleCompactCurrent = async () => {
    if (!activeSessionId) return;
    await callRpc("workspace.compact", { sessionId: activeSessionId });
  };

  const handleExportCurrent = async () => {
    if (!activeSessionId) return;
    const res = await callRpc("sessions.export", {
      sessionId: activeSessionId,
      format: "markdown",
    });
    if (res.content) {
      postToHost({ type: "rayucode.host.copyToClipboard", text: res.content });
    }
  };

  return (
    <header
      data-slot="top-bar"
      className={cn(
        "flex h-[46px] shrink-0 items-center gap-1.5 border-b border-hairline bg-canvas pr-2.5 select-none",
        sidebarCollapsed ? "pl-2" : "pl-3.5",
      )}
    >
      {sidebarCollapsed && (
        <div className="mr-1 inline-flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Back"
                disabled={!canGoBack}
                onClick={goBack}
                className={cn(
                  "grid size-7 place-items-center rounded-md transition-colors",
                  canGoBack
                    ? "cursor-pointer text-muted-ink hover:bg-hover hover:text-ink"
                    : "cursor-default text-faint opacity-45",
                )}
              >
                <ChevronLeft className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>Back</span>
              <kbd className="font-mono text-[10.5px] text-muted-ink">⌘[</kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Forward"
                disabled={!canGoForward}
                onClick={goForward}
                className={cn(
                  "grid size-7 place-items-center rounded-md transition-colors",
                  canGoForward
                    ? "cursor-pointer text-muted-ink hover:bg-hover hover:text-ink"
                    : "cursor-default text-faint opacity-45",
                )}
              >
                <ChevronRight className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>Forward</span>
              <kbd className="font-mono text-[10.5px] text-muted-ink">⌘]</kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="New chat"
                onClick={() => {
                  setActiveSession(null);
                  setActiveRoute("home");
                }}
                className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <Plus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New session</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Session / Route Title Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="topbar-session-title"
            className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-[13.5px] font-medium tracking-tight text-ink transition-colors hover:bg-hover"
          >
            {activeRoute === "workspace" && (
              <Folder
                className="size-[15px] shrink-0 text-muted-ink"
                strokeWidth={1.6}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{displayTitle}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-ink" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            onClick={() => {
              setActiveSession(null);
              setActiveRoute("home");
            }}
          >
            <Plus className="size-3.5" />
            <span>New session</span>
          </DropdownMenuItem>
          {activeSessionId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleForkCurrent()}>
                <GitFork className="size-3.5" />
                <span>Fork session</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCompactCurrent()}>
                <Sparkles className="size-3.5" />
                <span>Compact context</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExportCurrent()}>
                <FileDown className="size-3.5" />
                <span>Copy Markdown export</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-1">
        <StatusBarPill />

        {surface === "sidebar" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Open Beside Editor"
                data-testid="topbar-open-editor-panel"
                onClick={() =>
                  postToHost({
                    type: "rayucode.ui.openEditorPanel",
                    route: activeRoute,
                    sessionId: activeSessionId ?? undefined,
                    beside: true,
                  })
                }
                className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <ExternalLink className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open Beside Editor</TooltipContent>
          </Tooltip>
        )}

        {surface === "editorPanel" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Focus Secondary Sidebar"
                data-testid="topbar-focus-sidebar"
                onClick={() =>
                  postToHost({
                    type: "rayucode.ui.focusSidebar",
                  })
                }
                className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <PanelRight className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Focus Secondary Sidebar
            </TooltipContent>
          </Tooltip>
        )}

        {showCenterStrip && <SixIconStrip />}
        {!routeMeta.hasRightInspector && <MoreOptionsMenu />}
      </div>
    </header>
  );
}

export function RightSidebarTopBar({
  sheetMode = false,
}: {
  sheetMode?: boolean;
}) {
  const rightMode = useAppStore((s) => s.rightMode);
  const activeDocPill = useAppStore((s) => s.activeDocPill);
  const activeCodeFile = useAppStore((s) => s.activeCodeFile);
  const activeCodeLine = useAppStore((s) => s.activeCodeLine);
  const openDocTabs = useAppStore((s) => s.openDocTabs);
  const fullView = useAppStore((s) => s.fullView);
  const openRightTab = useAppStore((s) => s.openRightTab);
  const closeDocumentToContext = useAppStore((s) => s.closeDocumentToContext);
  const setFullView = useAppStore((s) => s.setFullView);
  const setInspectorOpen = useAppStore((s) => s.setInspectorOpen);
  const toggleInspector = useAppStore((s) => s.toggleInspector);
  const inspectorTab = useAppStore((s) => s.inspectorTab);
  const setInspectorTab = useAppStore((s) => s.setInspectorTab);

  const currentPill = activeDocPill ?? "Code";
  const backgroundTabs = openDocTabs
    .filter((t) => t.pill !== currentPill)
    .slice(-1);

  const contextSubTabs: ReadonlyArray<{ id: RightTabId; label: string }> = [
    { id: "overview", label: "Context" },
    { id: "tools", label: "Tools" },
    { id: "artifacts", label: "Outputs" },
  ];

  return (
    <div
      data-slot="right-sidebar-top-bar"
      className={cn(
        "flex h-[46px] w-full min-w-0 shrink-0 items-center overflow-hidden border-b border-hairline bg-canvas select-none",
        sheetMode ? "gap-1 px-2" : "gap-1.5 px-3",
      )}
    >
      {rightMode === "context" ? (
        <>
          <div
            className={cn(
              "inline-flex min-w-0 shrink items-center overflow-x-auto rounded-md border border-hairline-soft bg-pane p-0.5",
              sheetMode ? "gap-0" : "gap-0.5",
            )}
          >
            {contextSubTabs.map((sub) => {
              const active = inspectorTab === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setInspectorTab(sub.id)}
                  className={cn(
                    "shrink-0 cursor-pointer rounded-sm py-0.5 text-[11px] font-medium transition-colors",
                    sheetMode ? "px-1.5" : "px-2",
                    active
                      ? "bg-active text-ink shadow-bevel-surface"
                      : "text-muted-ink hover:text-ink",
                  )}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>
          <div
            className={cn(
              "ml-auto flex items-center gap-0.5",
              sheetMode ? "min-w-0 shrink" : "shrink-0",
            )}
          >
            <SixIconStrip compact={sheetMode} />
            {sheetMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Close inspector"
                    data-testid="inspector-sheet-close-btn"
                    onClick={() => setInspectorOpen(false)}
                    className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Close</TooltipContent>
              </Tooltip>
            )}
          </div>
        </>
      ) : (
        <>
          {fullView && (
            <button
              type="button"
              onClick={() => setFullView(false)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-hairline bg-raised px-2 py-1 text-xs text-body hover:bg-hover hover:text-ink"
            >
              <span className="font-mono text-[10px] text-muted-ink">⌘1</span>
              <span>Active session</span>
            </button>
          )}

          {backgroundTabs.map((bgTab, idx) => (
            <button
              key={bgTab.pill}
              type="button"
              onClick={() => openRightTab(bgTab.tab, bgTab.pill)}
              className="inline-flex h-7 min-w-0 max-w-[160px] cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <span className="truncate">{bgTab.pill}</span>
              <span className="shrink-0 font-mono text-[10px] opacity-70">
                ⌘{idx + 1}
              </span>
            </button>
          ))}

          <div className="inline-flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-[7px] bg-active pr-1.5 pl-2.5 text-xs font-medium text-ink">
            <span className="truncate" data-testid="active-doc-pill">
              {currentPill}
            </span>
            <button
              type="button"
              aria-label="Close document"
              title="Back to Context"
              onClick={closeDocumentToContext}
              className="grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </div>

          {activeCodeFile && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Open in VS Code Editor"
                  onClick={() =>
                    postToHost({
                      type: "rayucode.editor.openFile",
                      path: activeCodeFile,
                      line: activeCodeLine ?? undefined,
                    })
                  }
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <ExternalLink className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Open in VS Code Editor
              </TooltipContent>
            </Tooltip>
          )}

          <span className="min-w-0 flex-1" />

          {fullView ? (
            <button
              type="button"
              onClick={() => setFullView(false)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-hairline bg-raised px-2.5 py-1 text-xs font-medium text-ink hover:bg-active"
            >
              <Minimize2 className="size-3.5" />
              <span>Exit full view</span>
            </button>
          ) : (
            <div className="inline-flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Full view"
                    onClick={() => setFullView(true)}
                    className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                  >
                    <Maximize2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Full view</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Close inspector"
                    data-testid={
                      sheetMode ? "inspector-sheet-close-btn" : undefined
                    }
                    onClick={toggleInspector}
                    className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Close</TooltipContent>
              </Tooltip>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export { Pencil };
