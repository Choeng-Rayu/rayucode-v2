import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogOut,
  Palette,
  RefreshCw,
  Settings,
  SunMoon,
  User,
} from "lucide-react";
import type { AccentPreference, AppRoute, ThemePreference } from "@shared/vscodeProtocol";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NavGlyph, UsageRingSvg } from "@/components/ui/rayu-symbols";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/app-store";
import { callRpc } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

import { PRIMARY_NAV_ITEMS } from "../hooks/useShellNavigation";
import { SidebarProjectsPane } from "./SidebarProjectsPane";

export interface IconRailProps {
  onOpenSessionsDrawer?: () => void;
  onCloseDrawer?: () => void;
}

export function IconRail({
  onOpenSessionsDrawer,
  onCloseDrawer,
}: IconRailProps) {
  const queryClient = useQueryClient();
  const activeRoute = useAppStore((s) => s.activeRoute);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const theme = useAppStore((s) => s.theme);
  const accent = useAppStore((s) => s.accent);
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const accountStatus = useAppStore((s) => s.accountStatus);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setTheme = useAppStore((s) => s.setTheme);
  const setAccent = useAppStore((s) => s.setAccent);
  const toggleBackgroundDrawer = useAppStore((s) => s.toggleBackgroundDrawer);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);
  const setDaemonStatus = useAppStore((s) => s.setDaemonStatus);

  const [usageOpen, setUsageOpen] = React.useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = React.useState<string | null>(
    null,
  );

  const accountQuery = useQuery({
    queryKey: ["shell", "account", "status"],
    queryFn: () => callRpc("settings.account.get"),
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (accountQuery.data && !accountStatus) {
      setAccountStatus(accountQuery.data);
    }
  }, [accountQuery.data, accountStatus, setAccountStatus]);

  const telegramQuery = useQuery({
    queryKey: ["shell", "remote", "telegram"],
    queryFn: () => callRpc("remote.telegram.status"),
    staleTime: 30_000,
  });

  const changesQuery = useQuery({
    queryKey: ["shell", "changes", "status"],
    queryFn: () => callRpc("changes.status"),
    staleTime: 15_000,
  });

  const account = accountStatus ?? accountQuery.data ?? null;
  const isSignedIn = Boolean(account?.signedIn);

  const activeBgCount = React.useMemo(
    () =>
      backgroundTasks.filter(
        (t) => t.status === "running" || t.status === "stalled",
      ).length,
    [backgroundTasks],
  );

  const hasLiveDotForRoute = (route: AppRoute): boolean => {
    switch (route) {
      case "changes":
        return Boolean((changesQuery.data?.files.length ?? 0) > 0);
      case "remote":
        return Boolean(
          telegramQuery.data?.linked && telegramQuery.data?.daemonOnline,
        );
      default:
        return false;
    }
  };

  const isNavItemActive = (itemId: AppRoute) => {
    if (itemId === "home") {
      return activeRoute === "home" || activeRoute === "workspace";
    }
    return activeRoute === itemId;
  };

  const resolvedInitials = React.useMemo(() => {
    if (!isSignedIn) return null;
    const src = account?.displayName?.trim() || account?.email || "RC";
    const parts = src.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length === 0) return "RC";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }, [account, isSignedIn]);

  const handleToggleSidebar = () => {
    if (onOpenSessionsDrawer) {
      onOpenSessionsDrawer();
    } else if (onCloseDrawer) {
      onCloseDrawer();
    } else {
      toggleSidebar();
    }
  };

  const handleSignOut = async () => {
    try {
      const next = await callRpc("settings.account.signOut");
      setAccountStatus(next);
      queryClient.setQueryData(["shell", "account", "status"], next);
      queryClient.setQueryData(["settings", "account"], next);
      void queryClient.invalidateQueries({ queryKey: ["settings", "account"] });
      void queryClient.invalidateQueries({
        queryKey: ["shell", "account", "status"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["settings", "providers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      toast("Signed out of Rayu Cloud");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to sign out of Rayu Cloud",
      );
    }
  };

  return (
    <nav
      aria-label="Primary"
      data-slot="icon-rail"
      className={cn(
        "flex w-[52px] shrink-0 flex-col items-center gap-1.5 pb-3 select-none",
        sidebarCollapsed ? "bg-canvas" : "bg-chrome",
      )}
    >
      {/* Top 46px sidebar toggle button */}
      <div className="grid h-[46px] w-full place-items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleToggleSidebar}
              aria-pressed={!sidebarCollapsed}
              aria-label="Toggle sidebar"
              data-testid="rail-toggle-sidebar"
              className="grid size-[34px] cursor-pointer place-items-center rounded-full border border-transparent text-body transition-all hover:border-premium hover:bg-active hover:text-ink hover:shadow-bevel-surface"
            >
              <svg
                className="size-[17px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.65"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span>Toggle sidebar</span>
            <kbd className="rounded-full bg-active px-1.5 py-0.5 font-sans text-[11px] text-body">
              ⇧⌘S
            </kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Exact 5 primary navigation items (matching Desktop) */}
      {PRIMARY_NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item.id);
        const showDot = hasLiveDotForRoute(item.id);
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                data-testid={`rail-nav-${item.id}`}
                onClick={() => {
                  setActiveRoute(item.id);
                  onCloseDrawer?.();
                }}
                className={cn(
                  "relative grid size-9 cursor-pointer place-items-center rounded-[10px] border transition-all",
                  active
                    ? "border-premium bg-active text-ink shadow-bevel-surface"
                    : "border-transparent text-muted-ink hover:border-hairline hover:bg-hover hover:text-ink",
                )}
              >
                <NavGlyph icon={item.icon} />
                {showDot && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "rail-live-dot absolute top-[7px] right-[7px] size-1.5 rounded-full bg-brand-bright ring-2",
                      sidebarCollapsed ? "ring-canvas" : "ring-chrome",
                    )}
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}

      {/* Background Processes Drawer Trigger (shown when tasks exist) */}
      {activeBgCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Background processes (${activeBgCount} active)`}
              data-testid="rail-bg-processes"
              onClick={() => {
                toggleBackgroundDrawer();
                onCloseDrawer?.();
              }}
              className="relative grid size-9 cursor-pointer place-items-center rounded-[10px] border border-brand/30 bg-brand-soft text-brand-text transition-all hover:border-brand/50"
            >
              <NavGlyph icon="processes" />
              <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 font-mono text-[9.5px] font-bold text-brand-ink tabular-nums">
                {activeBgCount}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            Background processes ({activeBgCount} running)
          </TooltipContent>
        </Tooltip>
      )}

      <div className="flex-1" />

      {/* Bottom Icon 1: Plan & Usage Popover (#i-ring) */}
      <Popover
        open={usageOpen}
        onOpenChange={(open) => {
          setUsageOpen(open);
          if (open && isSignedIn) {
            void callRpc("settings.account.refresh")
              .then((next) => {
                setAccountStatus(next);
                queryClient.setQueryData(["shell", "account", "status"], next);
                queryClient.setQueryData(["settings", "account"], next);
              })
              .catch(() => {});
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Plan & usage limits"
                data-testid="rail-usage-trigger"
                className="grid size-9 cursor-pointer place-items-center rounded-[10px] border border-transparent text-muted-ink transition-all hover:border-hairline hover:bg-hover hover:text-ink data-[state=open]:border-premium data-[state=open]:bg-active data-[state=open]:text-ink data-[state=open]:shadow-bevel-surface"
              >
                <UsageRingSvg />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Plan &amp; usage limits</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={10}
          className="w-[308px] rounded-2xl border-premium-hi bg-popover-solid p-0 text-ink shadow-popover"
        >
          <div className="flex items-center justify-between gap-2 px-[18px] pt-[15px] pb-[13px]">
            <span className="text-[13px] font-medium text-muted-ink">
              {isSignedIn
                ? `Usage source: ${account?.planName ?? "Rayu Cloud"}`
                : "Not signed in to Rayu Cloud"}
            </span>
            {isSignedIn && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand/25 bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
                Active
              </span>
            )}
          </div>
          <div className="mx-[18px] h-px bg-hairline" />
          <div className="flex flex-col gap-3.5 px-[18px] py-[15px] text-sm">
            {(account?.windows ?? []).length > 0 ? (
              account!.windows.map((win) => {
                const pct = Math.max(
                  0,
                  Math.min(100, Math.round(win.remainingPercent)),
                );
                const fillClass =
                  pct <= 10
                    ? "bg-danger"
                    : pct <= 20
                      ? "bg-warn"
                      : "rayu-effort-bar";
                return (
                  <div key={win.label} className="flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-ink">{win.label}</div>
                        {win.resetCountdown && (
                          <div className="mt-0.5 text-[11px] text-muted-ink">
                            {win.resetCountdown}
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-xs font-medium text-ink tabular-nums">
                        {win.remainingPercent}% left
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={win.label}
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-1.5 w-full overflow-hidden rounded-full bg-active"
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          fillClass,
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-ink">5-hour limit</span>
                    <span className="font-mono text-xs text-ink tabular-nums">
                      —
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-active" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-ink">Weekly limit</span>
                    <span className="font-mono text-xs text-ink tabular-nums">
                      —
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-active" />
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-hairline-soft pt-2.5">
              <span className="font-medium text-ink">Credits</span>
              <span
                data-testid="usage-credits-badge"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full font-mono text-xs font-semibold tabular-nums",
                  isSignedIn && account?.creditsRemaining != null
                    ? "border border-brand/25 bg-brand-soft px-2.5 py-0.5 text-brand-text"
                    : "text-muted-ink",
                )}
              >
                {isSignedIn && account?.creditsRemaining != null && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden="true"
                  />
                )}
                {isSignedIn && account?.creditsRemaining != null
                  ? `${account.creditsRemaining.toLocaleString()} credits`
                  : "—"}
              </span>
            </div>
          </div>
          <div className="mx-[18px] h-px bg-hairline" />
          <div className="p-2.5">
            {!isSignedIn ? (
              <button
                type="button"
                onClick={() => {
                  setUsageOpen(false);
                  setAuthDialogOpen(true);
                }}
                className="flex w-full cursor-pointer items-center rounded-[9px] border border-transparent px-2.5 py-2 text-sm font-medium text-brand-text transition-colors hover:border-hairline hover:bg-hover"
              >
                Sign in to Rayu Cloud
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setUsageOpen(false);
                  setActiveRoute("settings");
                }}
                className="flex w-full cursor-pointer items-center rounded-[9px] border border-transparent px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:border-hairline hover:bg-hover"
              >
                Manage usage
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Bottom Icon 2: Profile Menu */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="User profile menu"
                data-testid="rail-profile-trigger"
                className="mt-0.5 grid size-[38px] cursor-pointer place-items-center rounded-[11px] border border-transparent transition-all hover:border-hairline hover:bg-hover data-[state=open]:border-hairline data-[state=open]:bg-active data-[state=open]:shadow-bevel-surface"
              >
                {isSignedIn ? (
                  account?.avatarUrl && account.avatarUrl !== failedAvatarUrl ? (
                    <img
                      src={account.avatarUrl}
                      alt={account.displayName || account.email || "Rayu Cloud"}
                      referrerPolicy="no-referrer"
                      onError={() => setFailedAvatarUrl(account.avatarUrl ?? null)}
                      className="size-[26px] rounded-full border border-hairline object-cover select-none"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid size-[26px] place-items-center rounded-full bg-danger text-[10.5px] font-semibold tracking-tight text-destructive-foreground select-none"
                    >
                      {resolvedInitials}
                    </span>
                  )
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid size-[26px] place-items-center rounded-full border border-hairline bg-active text-muted-ink select-none"
                  >
                    <User className="size-3.5" strokeWidth={1.75} />
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isSignedIn
              ? `${account?.displayName || account?.email} · Rayu Cloud`
              : "Profile & Appearance"}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={10}
          className="w-[240px] rounded-xl"
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-xs font-medium text-ink">
              {isSignedIn
                ? account?.displayName || account?.email || "Rayu Cloud"
                : "Local Workspace"}
            </div>
            <div className="truncate text-[11px] text-muted-ink">
              {isSignedIn
                ? account?.email || `${account?.planName ?? "Plus"} plan`
                : "BYOK & Rayu Cloud"}
            </div>
          </div>
          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SunMoon className="size-3.5" />
              <span>Theme ({theme})</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(v) => setTheme(v as ThemePreference)}
              >
                <DropdownMenuRadioItem value="auto">
                  Auto (Follow VS Code)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  Warm Graphite Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  Warm Paper Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="vscode">
                  Match VS Code Theme
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette className="size-3.5" />
              <span>Accent ({accent === "green" ? "Rayu Green" : "Ocean Blue"})</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={accent}
                onValueChange={(v) => setAccent(v as AccentPreference)}
              >
                <DropdownMenuRadioItem value="green">
                  Rayu Green
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="blue">
                  Ocean Blue
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem onClick={toggleBackgroundDrawer}>
            <NavGlyph icon="processes" className="size-3.5" />
            <span>Background Processes</span>
            {activeBgCount > 0 && (
              <span className="ml-auto font-mono text-[10.5px] text-brand-text tabular-nums">
                {activeBgCount}
              </span>
            )}
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              setActiveRoute("settings");
              onCloseDrawer?.();
            }}
          >
            <Settings className="size-3.5" />
            <span>Settings</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() =>
              void callRpc("daemon.restart").then(setDaemonStatus)
            }
          >
            <RefreshCw className="size-3.5" />
            <span>Restart Bridge</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {isSignedIn ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void handleSignOut()}
            >
              <LogOut className="size-3.5" />
              <span>Sign out</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setAuthDialogOpen(true)}>
              <User className="size-3.5" />
              <span>Sign in to Rayu Cloud</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

export interface LeftSidebarProps {
  showProjectsPane?: boolean;
}

export function LeftSidebar({ showProjectsPane = true }: LeftSidebarProps) {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <div
      data-slot="left-sidebar"
      className="flex h-full shrink-0 overflow-hidden bg-chrome"
    >
      <IconRail />
      {showProjectsPane && !sidebarCollapsed && <SidebarProjectsPane />}
    </div>
  );
}
