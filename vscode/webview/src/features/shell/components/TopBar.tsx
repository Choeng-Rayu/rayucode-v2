import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileDown,
  Folder,
  GitFork,
  Globe,
  MoreHorizontal,
  Palette,
  PanelRight,
  Pencil,
  Plus,
  Sparkles,
  SunMoon,
  Terminal,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NavGlyph } from "@/components/ui/rayu-symbols";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/app-store";
import { callRpc, postToHost } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

import { SHELL_ROUTES } from "../hooks/useShellNavigation";
import { StatusBarPill } from "./StatusBarPill";

export function MoreOptionsMenu({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const surface = useAppStore((s) => s.surface);
  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const keepAwake = useAppStore((s) => s.keepAwake);
  const theme = useAppStore((s) => s.theme);
  const accent = useAppStore((s) => s.accent);
  const setKeepAwake = useAppStore((s) => s.setKeepAwake);
  const toggleBackgroundDrawer = useAppStore((s) => s.toggleBackgroundDrawer);
  const openSettingsSection = useAppStore((s) => s.openSettingsSection);
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

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-[min(236px,calc(100vw-16px))]"
      >
        <DropdownMenuItem
          data-testid="more-menu-open-browser"
          onClick={() =>
            postToHost({
              type: "rayucode.editor.openSimpleBrowser",
            })
          }
        >
          <Globe className="size-3.5" />
          <span>Open Browser in VS Code</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          data-testid="more-menu-open-terminal"
          onClick={() =>
            postToHost({
              type: "rayucode.editor.openTerminal",
              sessionId: activeSessionId ?? undefined,
              cwd: activeSessionId
                ? undefined
                : (activeProjectPath ?? undefined),
            })
          }
        >
          <Terminal className="size-3.5" />
          <span>Open Terminal</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={toggleBackgroundDrawer}>
          <NavGlyph icon="processes" className="size-3.5" />
          <span>Background processes</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          data-testid="more-menu-swarm"
          onClick={() => openSettingsSection("swarm")}
        >
          <NavGlyph icon="swarm" className="size-3.5" />
          <span>Swarm mission control</span>
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

export function TopBar() {
  const queryClient = useQueryClient();
  const surface = useAppStore((s) => s.surface);
  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSessionTitle = useAppStore((s) => s.activeSessionTitle);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const navHistory = useAppStore((s) => s.navHistory);
  const navHistoryIndex = useAppStore((s) => s.navHistoryIndex);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const openNewChatDraft = useAppStore((s) => s.openNewChatDraft);
  const requestComposerFocus = useAppStore((s) => s.requestComposerFocus);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);

  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;

  const routeMeta = SHELL_ROUTES[activeRoute] ?? SHELL_ROUTES.home;
  const displayTitle =
    activeRoute === "workspace"
      ? activeSessionTitle || "Active session"
      : routeMeta.title;

  const handleForkCurrent = async () => {
    if (!activeSessionId) return;
    const res = await callRpc("sessions.fork", { sessionId: activeSessionId });
    await callRpc("sessions.attach", {
      sessionId: res.session.sessionId,
    }).catch(() => {});
    setActiveSession(res.session.sessionId, res.session.title);
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
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
                  openNewChatDraft({ workingDir: activeProjectPath });
                  requestComposerFocus();
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
        <DropdownMenuContent
          align="start"
          className="w-[min(13rem,calc(100vw-16px))]"
        >
          <DropdownMenuItem
            onClick={() => {
              openNewChatDraft({ workingDir: activeProjectPath });
              requestComposerFocus();
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

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open Browser in VS Code"
              data-testid="topbar-open-browser"
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openSimpleBrowser",
                })
              }
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <Globe className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Browser in VS Code</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open Terminal in VS Code"
              data-testid="topbar-open-terminal"
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openTerminal",
                  sessionId: activeSessionId ?? undefined,
                  cwd: activeSessionId
                    ? undefined
                    : (activeProjectPath ?? undefined),
                })
              }
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <Terminal className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Terminal in VS Code</TooltipContent>
        </Tooltip>

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

        <MoreOptionsMenu />
      </div>
    </header>
  );
}

export { Pencil };
