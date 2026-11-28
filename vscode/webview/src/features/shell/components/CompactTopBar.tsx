import * as React from "react";
import {
  ChevronDown,
  ExternalLink,
  Globe,
  Menu,
  MoreHorizontal,
  Palette,
  PanelRight,
  Plus,
  RefreshCw,
  Settings,
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
import { NavGlyph, UsageRingSvg } from "@/components/ui/rayu-symbols";
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

export interface CompactTopBarProps {
  onOpenSessionsDrawer: () => void;
  className?: string;
}

export function CompactTopBar({
  onOpenSessionsDrawer,
  className,
}: CompactTopBarProps) {
  const surface = useAppStore((s) => s.surface);
  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSessionTitle = useAppStore((s) => s.activeSessionTitle);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const activeSwarm = useAppStore((s) => s.activeSwarm);
  const theme = useAppStore((s) => s.theme);
  const accent = useAppStore((s) => s.accent);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const openSettingsSection = useAppStore((s) => s.openSettingsSection);
  const openNewChatDraft = useAppStore((s) => s.openNewChatDraft);
  const requestComposerFocus = useAppStore((s) => s.requestComposerFocus);
  const toggleBackgroundDrawer = useAppStore((s) => s.toggleBackgroundDrawer);
  const cycleTheme = useAppStore((s) => s.cycleTheme);
  const toggleAccent = useAppStore((s) => s.toggleAccent);
  const setDaemonStatus = useAppStore((s) => s.setDaemonStatus);

  const routeMeta = SHELL_ROUTES[activeRoute] ?? SHELL_ROUTES.home;
  const displayTitle =
    activeRoute === "workspace"
      ? activeSessionTitle || "Active session"
      : routeMeta.title;

  const activeBgCount = React.useMemo(
    () =>
      !activeSessionId
        ? 0
        : backgroundTasks.filter(
            (t) =>
              t.sessionId === activeSessionId &&
              (t.status === "running" || t.status === "stalled"),
          ).length,
    [activeSessionId, backgroundTasks],
  );

  const activeSwarmCount = React.useMemo(() => {
    const agents = activeSwarm?.agents ?? [];
    const workers = agents.filter((a) => a.role === "worker");
    const pool = workers.length > 0 ? workers : agents;
    return pool.filter(
      (a) =>
        a.status === "running" ||
        a.status === "spawned" ||
        a.status === "blocked",
    ).length;
  }, [activeSwarm]);

  const totalBackgroundActive = activeBgCount + activeSwarmCount;

  const handlePopOutEditorPanel = () => {
    postToHost({
      type: "rayucode.ui.openEditorPanel",
      route: activeRoute,
      sessionId: activeSessionId ?? undefined,
      beside: true,
    });
  };

  return (
    <header
      data-slot="compact-top-bar"
      data-testid="compact-top-bar"
      className={cn(
        "flex h-[40px] shrink-0 items-center gap-1 border-b border-hairline bg-chrome px-2 select-none",
        className,
      )}
    >
      {/* [☰] Slide-over Session & Projects Drawer (⇧⌘S) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Open sessions and projects drawer"
            data-testid="compact-sessions-drawer-trigger"
            onClick={onOpenSessionsDrawer}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[7px] text-body transition-colors hover:bg-hover hover:text-ink"
          >
            <Menu className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>Sessions &amp; Projects</span>
          <kbd className="font-mono text-[10px] text-muted-ink">⇧⌘S</kbd>
        </TooltipContent>
      </Tooltip>

      {/* <Session Title ▾> single-line truncated switcher */}
      <button
        type="button"
        onClick={onOpenSessionsDrawer}
        data-testid="compact-session-title"
        className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-[7px] px-1.5 py-1 text-left text-xs font-medium text-ink transition-colors hover:bg-hover"
      >
        <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-ink" />
      </button>

      {/* Compact icon cluster */}
      <div className="flex shrink-0 items-center gap-0.5">
        <StatusBarPill compact />

        {/* [+] New Session */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="New session"
              data-testid="compact-new-session"
              onClick={() => {
                openNewChatDraft({ workingDir: activeProjectPath });
                requestComposerFocus();
              }}
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <Plus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New session</TooltipContent>
        </Tooltip>

        {/* [Bg·N] Background Processes & Swarm (badge shown ONLY when >= 1 active) */}
        {totalBackgroundActive > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Background activity (${totalBackgroundActive} active)`}
                data-testid="compact-bg-processes"
                onClick={toggleBackgroundDrawer}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[7px] border border-brand/30 bg-brand-soft px-1.5 font-mono text-[10.5px] font-semibold text-brand-text tabular-nums transition-colors hover:border-brand/50"
              >
                <NavGlyph
                  icon={activeSwarmCount > 0 && activeBgCount === 0 ? "swarm" : "processes"}
                  className="size-3"
                />
                <span>{totalBackgroundActive}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {[
                activeBgCount > 0
                  ? `${activeBgCount} background ${activeBgCount === 1 ? "process" : "processes"}`
                  : null,
                activeSwarmCount > 0
                  ? `${activeSwarmCount} swarm ${activeSwarmCount === 1 ? "agent" : "agents"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* [🌐] Open Browser in VS Code (hidden <360px; always available in Overflow Menu) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open Browser in VS Code"
              data-testid="compact-open-browser"
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openSimpleBrowser",
                })
              }
              className="hidden size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink @min-[360px]/app:grid"
            >
              <Globe className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Browser in VS Code</TooltipContent>
        </Tooltip>

        {/* [>_] Open Terminal in VS Code (hidden <360px; always available in Overflow Menu) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open Terminal in VS Code"
              data-testid="compact-open-terminal"
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openTerminal",
                  sessionId: activeSessionId ?? undefined,
                  cwd: activeSessionId
                    ? undefined
                    : (activeProjectPath ?? undefined),
                })
              }
              className="hidden size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink @min-[360px]/app:grid"
            >
              <Terminal className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Terminal in VS Code</TooltipContent>
        </Tooltip>

        {/* [⤢] Open Beside Editor (hidden <300px; also available in Overflow Menu) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open Beside Editor"
              data-testid="compact-expand-editor-panel"
              onClick={handlePopOutEditorPanel}
              className="hidden size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink @min-[300px]/app:grid"
            >
              <ExternalLink className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Beside Editor</TooltipContent>
        </Tooltip>

        {/* [⋯] Overflow DropdownMenu */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More destinations and settings"
                  data-testid="compact-overflow-menu"
                  className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            className="w-[min(13rem,calc(100vw-16px))]"
          >
            <DropdownMenuItem
              data-testid="compact-menu-open-beside"
              onClick={handlePopOutEditorPanel}
            >
              <ExternalLink className="size-3.5" />
              <span>Open Beside Editor</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="compact-menu-open-browser"
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
              data-testid="compact-menu-open-terminal"
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setActiveRoute("plugins")}>
              <NavGlyph icon="plugins" className="size-3.5" />
              <span>Plugins &amp; MCP</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleBackgroundDrawer}>
              <NavGlyph icon="processes" className="size-3.5" />
              <span>Background Processes</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="compact-menu-swarm"
              onClick={() => openSettingsSection("swarm")}
            >
              <NavGlyph icon="swarm" className="size-3.5" />
              <span>Swarm Mission Control</span>
            </DropdownMenuItem>
            {surface === "editorPanel" && (
              <DropdownMenuItem
                data-testid="compact-focus-sidebar"
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
            <DropdownMenuItem onClick={() => setActiveRoute("settings")}>
              <UsageRingSvg className="size-3.5" />
              <span>Plan &amp; Usage</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveRoute("settings")}>
              <Settings className="size-3.5" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={cycleTheme}>
              <SunMoon className="size-3.5" />
              <span>Theme ({theme})</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleAccent}>
              <Palette className="size-3.5" />
              <span>
                Accent ({accent === "green" ? "Rayu Green" : "Ocean Blue"})
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void callRpc("daemon.restart").then(setDaemonStatus)
              }
            >
              <RefreshCw className="size-3.5" />
              <span>Restart Bridge</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
