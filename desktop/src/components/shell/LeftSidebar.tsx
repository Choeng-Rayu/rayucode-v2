import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUpRight,
  ChevronRight,
  Crown,
  FileText,
  Ghost,
  Gift,
  HeartHandshake,
  Info,
  LogIn,
  LogOut,
  Palette,
  Plus,
  Search,
  Settings,
  Smartphone,
  User,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PRIMARY_NAV_ITEMS, type PrimaryNavItem } from "@/config/navigation"
import { automationsQueryOptions } from "@/features/automations"
import { changesStateQueryOptions } from "@/features/changes"
import { pluginsQueryOptions } from "@/features/plugins"
import { sessionsQueryOptions } from "@/features/sessions"
import { settingsQueryOptions } from "@/features/settings"
import { swarmStateQueryOptions } from "@/features/swarm"
import { telegramQueryOptions } from "@/features/telegram"
import { useAppStore, type AppRoute } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { GettingStartedCard } from "./GettingStartedCard"
import { SidebarProjectsPane } from "./sidebar-projects-pane"

function NavGlyph({ icon }: { icon: PrimaryNavItem["icon"] }) {
  switch (icon) {
    case "home":
      return (
        <svg className="size-[17px]" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H14.5v-5.5h-5v5.5H5.5A1.5 1.5 0 0 1 4 19v-8.5Z"
            fill="currentColor"
          />
        </svg>
      )
    case "swarm":
      return (
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
          <circle cx="12" cy="5.5" r="2.5" />
          <circle cx="5.5" cy="17.5" r="2.5" />
          <circle cx="18.5" cy="17.5" r="2.5" />
          <path d="M10.5 7.7 6.8 15.2M13.5 7.7l3.7 7.5M8 17.5h8" />
        </svg>
      )
    case "clock":
      return (
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
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      )
    case "plug":
      return (
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
          <circle cx="12" cy="12" r="8.5" />
          <path d="M10.5 8.5v3M13.5 8.5v3M9 11.5h6v1.2a3 3 0 0 1-6 0v-1.2Z" />
          <path d="M12 15.7v2.3" />
        </svg>
      )
    case "branch":
      return (
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
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <path d="M6 8.5v7M18 10.5c0 4-4.5 4.5-9 4.5" />
        </svg>
      )
    case "telegram":
      return (
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
          <path d="m21 4-3.2 15.5-5.8-4.5-3 2.8v-4.6L21 4Z" />
          <path d="M9 13.2 18.2 6.8" />
        </svg>
      )
  }
}

function formatResetCountdown(
  resetSeconds?: number,
  fetchedAt?: number,
  nowMs?: number
): string | null {
  if (!resetSeconds || resetSeconds <= 0) return null
  const elapsedSec =
    fetchedAt && nowMs ? Math.max(0, Math.floor((nowMs - fetchedAt) / 1000)) : 0
  const remaining = Math.max(0, Math.round(resetSeconds - elapsedSec))
  if (remaining <= 0) return "Resets soon"
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const mins = Math.floor((remaining % 3600) / 60)
  if (days > 0) return `Resets in ${days}d ${hours}h`
  if (hours > 0) return `Resets in ${hours}h ${mins}m`
  return `Resets in ${Math.max(1, mins)}m`
}

function computeWindowPctLeft(
  cap?: number | null,
  used?: number,
  limitMode?: "gated" | "unlimited" | null
): number | null {
  if (limitMode === "unlimited") return 100
  if (!cap || cap <= 0) return null
  const left = Math.max(0, cap - (used ?? 0))
  return Math.max(0, Math.min(100, Math.round((left / cap) * 1000) / 10))
}

function formatWindowPctLeft(
  cap?: number | null,
  used?: number,
  limitMode?: "gated" | "unlimited" | null
): string {
  if (limitMode === "unlimited") return "Unlimited"
  const pct = computeWindowPctLeft(cap, used, limitMode)
  if (pct == null) return "—"
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}% left`
}

function usageBarFillClass(pct: number | null): string {
  if (pct == null) return "bg-hairline-strong"
  if (pct <= 10) return "bg-danger"
  if (pct <= 20) return "bg-warn"
  return "rayu-effort-bar"
}

export function IconRail() {
  const activeRoute = useAppStore((s) => s.activeRoute)
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const gettingStartedHidden = useAppStore((s) => s.gettingStartedHidden)
  const authState = useAppStore((s) => s.authState)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen)
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar)
  const setGettingStartedHidden = useAppStore((s) => s.setGettingStartedHidden)
  const queryClient = useQueryClient()

  const [failedAvatarUrl, setFailedAvatarUrl] = React.useState<string | null>(
    null
  )
  const [usageNowMs, setUsageNowMs] = React.useState<number>(() => Date.now())
  const [usageOpen, setUsageOpen] = React.useState(false)
  const isSignedIn = Boolean(authState?.signedIn)

  React.useEffect(() => {
    if (!usageOpen || !isSignedIn) return
    const timer = window.setInterval(() => setUsageNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [isSignedIn, usageOpen])

  const credits = authState?.credits ?? null
  const fiveHourPct = isSignedIn
    ? computeWindowPctLeft(
        credits?.creditsPer5h,
        credits?.windowUsedCredits,
        credits?.limitMode
      )
    : null
  const fiveHourLabel = isSignedIn
    ? formatWindowPctLeft(
        credits?.creditsPer5h,
        credits?.windowUsedCredits,
        credits?.limitMode
      )
    : "—"
  const fiveHourResetLabel =
    isSignedIn && credits?.limitMode !== "unlimited"
      ? formatResetCountdown(
          credits?.windowResetSeconds,
          credits?.fetchedAt,
          usageNowMs
        )
      : null
  const weeklyPct = isSignedIn
    ? computeWindowPctLeft(
        credits?.creditsPerWeek,
        credits?.weekUsedCredits,
        credits?.limitMode
      )
    : null
  const weeklyLabel = isSignedIn
    ? formatWindowPctLeft(
        credits?.creditsPerWeek,
        credits?.weekUsedCredits,
        credits?.limitMode
      )
    : "—"
  const weeklyResetLabel =
    isSignedIn && credits?.limitMode !== "unlimited"
      ? formatResetCountdown(
          credits?.weekResetSeconds,
          credits?.fetchedAt,
          usageNowMs
        )
      : null
  const monthlyPct = isSignedIn
    ? computeWindowPctLeft(
        credits?.creditsPerPeriod,
        credits?.usedCredits,
        credits?.limitMode
      )
    : null
  const monthlyLabel = isSignedIn
    ? formatWindowPctLeft(
        credits?.creditsPerPeriod,
        credits?.usedCredits,
        credits?.limitMode
      )
    : "—"
  const monthlyResetLabel =
    isSignedIn && credits?.limitMode !== "unlimited"
      ? formatResetCountdown(
          credits?.resetSeconds,
          credits?.fetchedAt,
          usageNowMs
        )
      : null

  const usageWindows = [
    {
      id: "5h",
      label: "5h session window",
      pct: fiveHourPct,
      valueLabel: fiveHourLabel,
      resetLabel: fiveHourResetLabel,
    },
    {
      id: "weekly",
      label: "Weekly limit",
      pct: weeklyPct,
      valueLabel: weeklyLabel,
      resetLabel: weeklyResetLabel,
    },
    ...(credits?.creditsPerPeriod && credits.creditsPerPeriod > 0
      ? [
          {
            id: "monthly",
            label: "Monthly allowance",
            pct: monthlyPct,
            valueLabel: monthlyLabel,
            resetLabel: monthlyResetLabel,
          },
        ]
      : []),
  ]
  const avatarUrl =
    isSignedIn &&
    authState?.user?.avatarUrl &&
    authState.user.avatarUrl !== failedAvatarUrl
      ? authState.user.avatarUrl
      : null
  const resolvedName = isSignedIn
    ? authState?.user?.displayName?.trim() ||
      authState?.user?.email ||
      "Rayu Cloud API Key"
    : "Not signed in"
  const resolvedEmail = isSignedIn
    ? authState?.user?.email ||
      (authState?.method === "apiKey" ? "Connected via API key" : "")
    : ""
  const resolvedInitials = React.useMemo(() => {
    if (!isSignedIn) return null
    const src =
      authState?.user?.displayName?.trim() || authState?.user?.email || ""
    const parts = src.split(/[\s@._-]+/).filter(Boolean)
    if (parts.length === 0) return "RC"
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase()
  }, [authState, isSignedIn])

  const handleSignOut = React.useCallback(async () => {
    const next = await ipcClient.auth.signOut()
    const store = useAppStore.getState()
    store.setAuthState(next)
    store.setAuthLoaded(true)
    store.setAuthBypassed(false)
    store.setActiveSession(null)
    store.setActiveRoute("home")
    toast("Signed out of Rayu Cloud")
  }, [])

  const handlePrefetchRoute = React.useCallback(
    (route: AppRoute) => {
      switch (route) {
        case "home":
        case "workspace":
          void queryClient.prefetchQuery(sessionsQueryOptions())
          break
        case "swarm":
          void queryClient.prefetchQuery(swarmStateQueryOptions())
          break
        case "automations":
          void queryClient.prefetchQuery(automationsQueryOptions())
          break
        case "plugins":
          void queryClient.prefetchQuery(pluginsQueryOptions())
          break
        case "changes":
          void queryClient.prefetchQuery(changesStateQueryOptions())
          break
        case "telegram":
          void queryClient.prefetchQuery(telegramQueryOptions())
          break
        case "settings":
          void queryClient.prefetchQuery(settingsQueryOptions())
          break
      }
    },
    [queryClient]
  )

  const isNavItemActive = (itemId: AppRoute) => {
    if (itemId === "home") {
      return activeRoute === "home" || activeRoute === "workspace"
    }
    return activeRoute === itemId
  }

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex w-[52px] shrink-0 flex-col items-center gap-1.5 pb-3 select-none",
        leftCollapsed ? "bg-canvas" : "bg-chrome"
      )}
    >
      {/* Top 46px sidebar toggle button */}
      <div className="grid h-[46px] w-full place-items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleLeftSidebar}
              aria-pressed={!leftCollapsed}
              aria-label="Toggle sidebar"
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

      {/* Exact 6 primary navigation items */}
      {PRIMARY_NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item.id)
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => handlePrefetchRoute(item.id)}
                onFocus={() => handlePrefetchRoute(item.id)}
                onClick={() => {
                  if (
                    item.id === "home" &&
                    activeRoute !== "home" &&
                    activeRoute !== "workspace" &&
                    useAppStore.getState().activeSessionId
                  ) {
                    setActiveRoute("workspace")
                    return
                  }
                  setActiveRoute(item.id)
                }}
                className={cn(
                  "relative grid size-9 cursor-pointer place-items-center rounded-[10px] border transition-all",
                  active
                    ? "border-premium bg-active text-ink shadow-bevel-surface"
                    : "border-transparent text-muted-ink hover:border-hairline hover:bg-hover hover:text-ink"
                )}
              >
                <NavGlyph icon={item.icon} />
                {item.hasLiveDot && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "rail-live-dot absolute top-[7px] right-[7px] size-1.5 rounded-full bg-brand-bright ring-2",
                      leftCollapsed ? "ring-canvas" : "ring-chrome"
                    )}
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        )
      })}

      <div className="flex-1" />

      {/* Bottom Icon 1: Plan & Usage Popover (two-arc ring + diamond #i-ring) */}
      <Popover
        open={usageOpen}
        onOpenChange={(open) => {
          setUsageOpen(open)
          if (open) {
            setUsageNowMs(Date.now())
            if (isSignedIn) {
              void ipcClient.auth.refresh().then((next) => {
                useAppStore.getState().setAuthState(next)
              })
            }
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Plan & usage limits"
                className="grid size-9 cursor-pointer place-items-center rounded-[10px] border border-transparent text-muted-ink transition-all hover:border-hairline hover:bg-hover hover:text-ink data-[state=open]:border-premium data-[state=open]:bg-active data-[state=open]:text-ink data-[state=open]:shadow-bevel-surface"
              >
                <svg
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path
                    d="M7.18 6.25A7.5 7.5 0 0 1 16.82 6.25"
                    strokeWidth="1.9"
                  />
                  <path
                    d="M19.24 10.06A7.5 7.5 0 1 1 4.76 10.06"
                    strokeWidth="1.9"
                  />
                  <rect
                    x="9.6"
                    y="9.6"
                    width="4.8"
                    height="4.8"
                    rx="0.6"
                    transform="rotate(45 12 12)"
                    fill="currentColor"
                    opacity="0.48"
                    stroke="none"
                  />
                </svg>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Plan &amp; usage limits</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={10}
          className="w-[308px] rounded-2xl border-premium-hi bg-popover p-0 text-ink shadow-bevel-card shadow-rayu-2"
        >
          <div className="flex items-center justify-between gap-2 px-[18px] pt-[15px] pb-[13px]">
            <span className="text-[13px] font-medium text-muted-ink">
              {isSignedIn
                ? `Usage source: ${authState?.credits?.planName ?? "Rayu Cloud"}`
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
            {usageWindows.map((win) => (
              <div key={win.id} className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">{win.label}</div>
                    {win.resetLabel && (
                      <div className="mt-0.5 text-[11px] text-muted-ink">
                        {win.resetLabel}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-xs font-medium text-ink tabular-nums">
                    {win.valueLabel}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={win.label}
                  aria-valuenow={win.pct != null ? Math.round(win.pct) : 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-active"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      usageBarFillClass(win.pct)
                    )}
                    style={{ width: `${win.pct ?? 0}%` }}
                  />
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between gap-3 border-t border-hairline-soft pt-2.5">
              <span className="font-medium text-ink">Credits</span>
              <span
                data-testid="usage-credits-badge"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full font-mono text-xs font-semibold tabular-nums",
                  isSignedIn
                    ? "border border-brand/25 bg-brand-soft px-2.5 py-0.5 text-brand-text"
                    : "text-muted-ink"
                )}
              >
                {isSignedIn && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden="true"
                  />
                )}
                {isSignedIn && credits?.remainingCredits != null
                  ? `${credits.remainingCredits.toLocaleString()} credits`
                  : isSignedIn
                    ? "0 credits"
                    : "—"}
              </span>
            </div>
          </div>
          <div className="mx-[18px] h-px bg-hairline" />
          <div className="p-2.5">
            {!isSignedIn ? (
              <button
                type="button"
                onClick={() => setAuthDialogOpen(true)}
                className="flex w-full cursor-pointer items-center rounded-[9px] border border-transparent px-2.5 py-2 text-sm font-medium text-brand-text transition-colors hover:border-hairline hover:bg-hover"
              >
                Sign in to Rayu Cloud
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveRoute("settings")}
                className="flex w-full cursor-pointer items-center rounded-[9px] border border-transparent px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:border-hairline hover:bg-hover"
              >
                Manage usage
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Bottom Icon 2: LK Profile Menu */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="User profile menu"
                className="mt-0.5 grid size-[38px] cursor-pointer place-items-center rounded-[11px] border border-transparent transition-all hover:border-hairline hover:bg-hover data-[state=open]:border-hairline data-[state=open]:bg-active data-[state=open]:shadow-bevel-surface"
              >
                {isSignedIn ? (
                  avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={resolvedName}
                      referrerPolicy="no-referrer"
                      onError={() => setFailedAvatarUrl(avatarUrl)}
                      className="size-[26px] rounded-full object-cover ring-1 ring-hairline select-none"
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
              ? `${resolvedName} · Rayu Cloud`
              : "Not signed in · Click to connect"}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={10}
          className="w-[248px] rounded-[18px] border-premium-hi bg-popover p-1.5 text-ink shadow-bevel-card shadow-rayu-2"
        >
          {isSignedIn ? (
            <>
              <div className="px-2.5 py-2">
                <div className="truncate text-xs font-medium text-ink">
                  {resolvedName}
                </div>
                {resolvedEmail && (
                  <div className="truncate text-[11px] text-muted-ink">
                    {resolvedEmail}
                  </div>
                )}
              </div>
              <DropdownMenuSeparator />
            </>
          ) : (
            <>
              <div className="px-2.5 py-2">
                <div className="text-xs font-medium text-ink">Not signed in</div>
                <div className="text-[11px] text-muted-ink">
                  Sign in to connect Rayu Cloud
                </div>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onClick={() => setActiveRoute("settings")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <Settings className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Settings</span>
            <span className="ml-auto inline-flex items-center gap-1">
              <kbd className="grid h-[22px] min-w-[22px] place-items-center rounded-md border border-hairline bg-active px-1 text-[11.5px] text-body">
                ⌘
              </kbd>
              <kbd className="grid h-[22px] min-w-[22px] place-items-center rounded-md border border-hairline bg-active px-1 text-[11.5px] text-body">
                ,
              </kbd>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void ipcClient.native.openExternal(
                "https://rayucode.com/dashboard/plan"
              )
            }
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <Crown className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Upgrade Plan</span>
            <ArrowUpRight className="ml-auto size-3.5 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void ipcClient.native.openExternal(
                "https://rayucode.com/dashboard/referrals"
              )
            }
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <Gift className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Rewards center</span>
            <ArrowUpRight className="ml-auto size-3.5 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void ipcClient.native.openExternal(
                "https://rayucode.com/dashboard/referrals"
              )
            }
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <HeartHandshake className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Invite Friends</span>
            <ArrowUpRight className="ml-auto size-3.5 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void ipcClient.settings.getState().then(async (current) => {
                const nextVisible = !current.preferences.showMiniPet
                await ipcClient.settings.updatePreferences({
                  showMiniPet: nextVisible,
                })
                void queryClient.invalidateQueries({ queryKey: ["settings"] })
                toast(
                  nextVisible
                    ? "Mini & Pet companion shown"
                    : "Mini & Pet companion hidden"
                )
              })
            }}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <Ghost className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Toggle pet companion</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setActiveRoute("settings")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <Palette className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Appearance</span>
            <ChevronRight className="ml-auto size-3.5 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
          </DropdownMenuItem>
          {gettingStartedHidden && (
            <DropdownMenuItem
              onClick={() => {
                setGettingStartedHidden(false)
                toast("Getting started restored")
              }}
              className="rounded-[10px] px-2.5 py-2 text-sm"
            >
              <Info className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
              <span>Show getting started</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              void ipcClient.native.openExternal("https://rayucode.com/changelog")
            }
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <FileText className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Changelog</span>
            <ArrowUpRight className="ml-auto size-3.5 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void ipcClient.native.openExternal("https://rayucode.com/dashboard")
            }
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <Smartphone className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>Web dashboard</span>
            <ArrowUpRight className="ml-auto size-3.5 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void ipcClient.native.openExternal("https://rayucode.com/about")
            }
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <Info className="size-4 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
            <span>About RayuCode</span>
            <ArrowUpRight className="ml-auto size-3.5 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {!isSignedIn ? (
            <DropdownMenuItem
              onClick={() => setAuthDialogOpen(true)}
              className="rounded-[10px] px-2.5 py-2 text-sm text-brand-text"
            >
              <LogIn className="size-4 text-brand-text" strokeWidth={1.65} aria-hidden="true" />
              <span>Sign in to Rayu Cloud</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                void handleSignOut()
              }}
              className="rounded-[10px] px-2.5 py-2 text-sm"
            >
              <LogOut className="size-4" strokeWidth={1.65} aria-hidden="true" />
              <span>Sign out</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}

export function SessionPane() {
  const activeRoute = useAppStore((s) => s.activeRoute)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const navHistory = useAppStore((s) => s.navHistory)
  const navHistoryIndex = useAppStore((s) => s.navHistoryIndex)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const openNewChatDraft = useAppStore((s) => s.openNewChatDraft)
  const activeWorkspacePath = useAppStore((s) => s.activeWorkspacePath)
  const goBack = useAppStore((s) => s.goBack)
  const goForward = useAppStore((s) => s.goForward)
  const openDocPreview = useAppStore((s) => s.openDocPreview)

  const [searchOpen, setSearchOpen] = React.useState(false)
  const [sidebarSearchQuery, setSidebarSearchQuery] = React.useState("")

  const canGoBack = navHistoryIndex > 0
  const canGoForward = navHistoryIndex < navHistory.length - 1

  const swarmQuery = useQuery({
    ...swarmStateQueryOptions(),
    enabled: activeRoute === "swarm",
  })

  const openSessionWithOptionalPreview = (
    sessionId: string,
    route?: string,
    title?: string
  ) => {
    if (route === "swarm") {
      setActiveRoute("swarm")
      return
    }
    setActiveSession(sessionId, title ?? null)
    if (import.meta.env.MODE === "test") {
      if (sessionId === "ses_credits_dash") {
        openDocPreview("browser", "localhost:3000")
      } else if (sessionId === "ses_q4_excel") {
        openDocPreview("excel", "Q4-Token-Cost-Model.xlsx")
      } else if (sessionId === "ses_migration_md") {
        openDocPreview("markdown", "MIGRATION_PLAN.md")
      }
    }
  }

  if (leftCollapsed) {
    return null
  }

  // Integrations (Plugins), Changes, Automations, and Telegram own their full workspace layout
  // (Plugins & Changes have their own sub-sidebar) — never render a duplicate chat sidebar next to them.
  if (
    activeRoute === "plugins" ||
    activeRoute === "changes" ||
    activeRoute === "automations" ||
    activeRoute === "telegram"
  ) {
    return null
  }

  if (activeRoute === "swarm") {
    const swarm = swarmQuery.data
    const agents = swarm?.agents ?? []
    const worktrees = swarm?.worktrees ?? []

    return (
      <div className="flex w-[264px] shrink-0 flex-col bg-chrome pr-2.5 pb-2.5 pl-1 select-none">
        <div className="flex h-[46px] shrink-0 items-center justify-end gap-1 pr-0.5">
          <button
            type="button"
            aria-label="Back"
            disabled={!canGoBack}
            onClick={goBack}
            className={cn(
              "grid size-7 place-items-center rounded-sm border border-transparent transition-colors",
              canGoBack
                ? "cursor-pointer text-muted-ink hover:border-hairline hover:bg-hover hover:text-ink"
                : "cursor-default text-faint opacity-45"
            )}
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Forward"
            disabled={!canGoForward}
            onClick={goForward}
            className={cn(
              "grid size-7 place-items-center rounded-sm border border-transparent transition-colors",
              canGoForward
                ? "cursor-pointer text-muted-ink hover:border-hairline hover:bg-hover hover:text-ink"
                : "cursor-default text-faint opacity-45"
            )}
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 px-1.5 pt-0.5 pb-2">
          <span className="px-1 py-0.5 text-base font-semibold tracking-tight text-ink">
            Swarm
          </span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="New swarm worker"
            onClick={() => {
              const goalInput = document.querySelector<HTMLTextAreaElement>(
                '[data-slot="swarm-launchpad-goal"]'
              )
              if (goalInput) {
                goalInput.focus()
                return
              }
              const btn = document.querySelector<HTMLButtonElement>(
                '[data-testid="swarm-toggle-spawn-btn"], [data-slot="toggle-spawn-worker-btn"]'
              )
              btn?.click()
            }}
            className="grid size-7 cursor-pointer place-items-center rounded-sm border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
          >
            <Plus className="size-4" strokeWidth={1.65} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {agents.length === 0 ? (
            <div className="flex flex-col gap-2 px-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  const goalInput = document.querySelector<HTMLTextAreaElement>(
                    '[data-slot="swarm-launchpad-goal"]'
                  )
                  goalInput?.focus()
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-[9px] bg-active px-2.5 py-1.5 text-left text-[13px] font-medium text-ink"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full bg-brand"
                  aria-hidden="true"
                />
                <span>New swarm</span>
              </button>
              <p className="m-0 px-2 text-[12px] leading-relaxed text-faint">
                Active agents and isolated git worktrees will appear here once
                you start a swarm.
              </p>
            </div>
          ) : (
            <>
              <div className="px-2.5 pt-2.5 pb-1.5 text-xs font-medium text-muted-ink">
                Active
              </div>
              {swarm && (
                <button
                  type="button"
                  onClick={() => setActiveRoute("swarm")}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-[9px] bg-active px-2.5 py-1.5 text-left text-[13px] font-medium text-ink"
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden="true"
                  />
                  <span className="truncate">{swarm.title}</span>
                </button>
              )}

              <div className="px-2.5 pt-3.5 pb-1.5 text-xs font-medium text-muted-ink">
                Agents ({agents.length})
              </div>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    const row = document.querySelector<HTMLButtonElement>(
                      `[data-agent-id="${agent.id}"]`
                    )
                    row?.click()
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left font-mono text-[12.5px] text-body transition-colors hover:bg-hover hover:text-ink"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      agent.state === "running"
                        ? "bg-brand"
                        : agent.state === "stopped"
                          ? "bg-danger"
                          : "bg-muted-ink"
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{agent.name}</span>
                </button>
              ))}

              {worktrees.length > 0 && (
                <>
                  <div className="px-2.5 pt-3.5 pb-1.5 text-xs font-medium text-muted-ink">
                    Worktrees ({worktrees.length})
                  </div>
                  {worktrees.map((wt) => (
                    <button
                      key={wt.id}
                      type="button"
                      onClick={() =>
                        void ipcClient.native.openInVSCode(wt.file || wt.label)
                      }
                      className="block w-full cursor-pointer truncate rounded-[9px] px-2.5 py-1.5 text-left font-mono text-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                    >
                      {wt.branch || wt.label}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-[264px] shrink-0 flex-col bg-chrome pr-2.5 pb-2.5 pl-1 select-none">
      {/* Top 46px Back / Forward row */}
      <div className="flex h-[46px] shrink-0 items-center justify-end gap-1 pr-0.5">
        <button
          type="button"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={goBack}
          className={cn(
            "grid size-7 place-items-center rounded-sm border border-transparent transition-colors",
            canGoBack
              ? "cursor-pointer text-muted-ink hover:border-hairline hover:bg-hover hover:text-ink"
              : "cursor-default text-faint opacity-45"
          )}
        >
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={goForward}
          className={cn(
            "grid size-7 place-items-center rounded-sm border border-transparent transition-colors",
            canGoForward
              ? "cursor-pointer text-muted-ink hover:border-hairline hover:bg-hover hover:text-ink"
              : "cursor-default text-faint opacity-45"
          )}
        >
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* Brand row */}
      <div className="flex shrink-0 items-center justify-between px-2.5 pt-0.5 pb-1.5">
        <span className="text-[16px] font-semibold tracking-tight text-ink">
          RayuCode
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Search chats"
              aria-pressed={searchOpen}
              data-testid="sidebar-search-toggle-btn"
              onClick={() => {
                setSearchOpen((prev) => {
                  if (prev) setSidebarSearchQuery("")
                  return !prev
                })
              }}
              className={cn(
                "grid size-7 cursor-pointer place-items-center rounded-md transition-colors",
                searchOpen
                  ? "bg-active text-ink"
                  : "text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              <Search className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Search chats</TooltipContent>
        </Tooltip>
      </div>

      {searchOpen && (
        <div className="mx-1.5 mb-1.5 flex items-center gap-1.5 rounded-[9px] border border-hairline bg-inset px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-ink" aria-hidden="true" />
          <input
            type="text"
            autoFocus
            aria-label="Filter sidebar chats"
            data-testid="sidebar-search-input"
            value={sidebarSearchQuery}
            onChange={(e) => setSidebarSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted-ink"
          />
          {sidebarSearchQuery && (
            <button
              type="button"
              aria-label="Clear sidebar search"
              onClick={() => setSidebarSearchQuery("")}
              className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-ink hover:text-ink"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* New Conversation button */}
      <button
        type="button"
        onClick={() => {
          openNewChatDraft({ workingDir: activeWorkspacePath })
        }}
        className={cn(
          "flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-[7px] text-[13.5px] leading-[1.38] transition-colors",
          activeRoute === "home" && !activeSessionId
            ? "bg-active font-medium text-ink"
            : "text-body hover:bg-hover hover:text-ink"
        )}
      >
        <svg
          className="size-[15px] text-muted-ink"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          <path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-4 1 1-4 9.5-9.5Z" />
        </svg>
        <span>New chat</span>
      </button>

      {/* Scrollable Projects & Recents (Codex-style mini menus, hover cards & emoji/icon picker) */}
      <SidebarProjectsPane
        onOpenSession={openSessionWithOptionalPreview}
        searchQuery={sidebarSearchQuery}
      />

      {/* Bottom Interactive Getting Started Card (hideable + AI apps import dialog) */}
      <GettingStartedCard />
    </div>
  )
}

function routeHasSessionPane(route: AppRoute): boolean {
  return route === "home" || route === "workspace" || route === "swarm"
}

export function LeftSidebar() {
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const activeRoute = useAppStore((s) => s.activeRoute)
  const showSessionPane = !leftCollapsed && routeHasSessionPane(activeRoute)

  return (
    <aside
      aria-label="Navigation and conversations"
      className={cn(
        "flex h-full shrink-0 overflow-hidden transition-[width] duration-150",
        showSessionPane
          ? "w-[316px] bg-chrome"
          : leftCollapsed
            ? "w-[52px] bg-canvas"
            : "w-[52px] bg-chrome"
      )}
    >
      <IconRail />
      {showSessionPane && (
        <span
          aria-hidden="true"
          data-testid="sidebar-rail-divider"
          className="my-2.5 w-px shrink-0 bg-hairline-soft"
        />
      )}
      <SessionPane />
    </aside>
  )
}
