import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import { getAuthSession } from "@/lib/auth-placeholder"
import { ipcClient, type GettingStartedItem, type ProjectGroup } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

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

export function IconRail() {
  const activeRoute = useAppStore((s) => s.activeRoute)
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar)
  const queryClient = useQueryClient()
  const auth = getAuthSession()

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
                onClick={() => setActiveRoute(item.id)}
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
      <Popover>
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
          className="w-[292px] rounded-2xl border-premium-hi bg-popover p-0 text-ink shadow-bevel-card shadow-rayu-2"
        >
          <div className="px-[18px] pt-[15px] pb-[13px] text-[13px] font-medium text-muted-ink">
            Usage source: Your Pro plan
          </div>
          <div className="mx-[18px] h-px bg-hairline" />
          <div className="flex flex-col gap-[13px] px-[18px] py-[15px] text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-ink">5-hour limit</span>
              <span className="font-mono text-ink tabular-nums">100% left</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-ink">Weekly limit</span>
              <span className="font-mono text-ink tabular-nums">100% left</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-ink">Credits</span>
              <span className="font-mono text-ink tabular-nums">0 credits</span>
            </div>
          </div>
          <div className="mx-[18px] h-px bg-hairline" />
          <div className="p-2.5">
            <button
              type="button"
              onClick={() => setActiveRoute("settings")}
              className="flex w-full cursor-pointer items-center rounded-[9px] border border-transparent px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:border-hairline hover:bg-hover"
            >
              Manage usage
            </button>
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
                <span
                  aria-hidden="true"
                  className="grid size-[26px] place-items-center rounded-full bg-danger text-[10.5px] font-semibold tracking-tight text-ink select-none"
                >
                  {auth.avatarInitials}
                </span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">
            {auth.name} · Personal account
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={10}
          className="w-[248px] rounded-[18px] border-premium-hi bg-popover p-1.5 text-ink shadow-bevel-card shadow-rayu-2"
        >
          <DropdownMenuItem
            onClick={() => setActiveRoute("settings")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
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
            onClick={() => setActiveRoute("settings")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <span>Upgrade Plan</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => toast("Rewards center · 0 credits earned")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <span>Rewards center</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => toast("Invite link copied to clipboard")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <span>Invite Friends</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => toast("Pet companion toggled (⌥Space)")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <span>Show pet</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setActiveRoute("settings")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <span>Appearance</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => toast("RayuCode Desktop v1.0.4")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <span>About RayuCode</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => toast("Signed out of Personal account")}
            className="rounded-[10px] px-2.5 py-2 text-sm"
          >
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}

export function SessionPane() {
  const activeRoute = useAppStore((s) => s.activeRoute)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const openRightTab = useAppStore((s) => s.openRightTab)
  const openDocPreview = useAppStore((s) => s.openDocPreview)

  const [projects, setProjects] = React.useState<ProjectGroup[]>([])
  const [recents, setRecents] = React.useState<
    Array<{ id: string; title: string; route?: string }>
  >([])
  const [gettingStarted, setGettingStarted] = React.useState<
    GettingStartedItem[]
  >([])

  React.useEffect(() => {
    void ipcClient.sessions.listProjects().then(setProjects)
    void ipcClient.sessions.listRecents().then(setRecents)
    void ipcClient.sessions.getGettingStarted().then(setGettingStarted)
  }, [])

  const toggleProject = (projId: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projId ? { ...p, expanded: !p.expanded } : p))
    )
  }

  const openSessionWithOptionalPreview = (
    sessionId: string,
    route?: string
  ) => {
    if (route === "swarm") {
      setActiveRoute("swarm")
      return
    }
    setActiveSession(sessionId)
    if (sessionId === "ses_credits_dash") {
      openDocPreview("browser", "localhost:3000")
    } else if (sessionId === "ses_q4_excel") {
      openDocPreview("excel", "Q4-Token-Cost-Model.xlsx")
    } else if (sessionId === "ses_migration_md") {
      openDocPreview("markdown", "MIGRATION_PLAN.md")
    }
  }

  const handleToggleChecklist = async (item: GettingStartedItem) => {
    const updated = await ipcClient.sessions.toggleGettingStarted(item.id)
    setGettingStarted(updated)
    if (item.badge === "telegram") {
      setActiveRoute("telegram")
    } else if (item.badge === "browser") {
      setActiveSession(activeSessionId ?? "ses_retire_cache")
      openRightTab("browser", "localhost:3000")
    } else if (item.badge === "sheet") {
      setActiveSession("ses_q4_excel")
      openDocPreview("excel", "Q4-Token-Cost-Model.xlsx")
    } else if (item.badge === "markdown") {
      setActiveSession(activeSessionId ?? "ses_retire_cache")
      openDocPreview("markdown", "MIGRATION_PLAN.md")
    } else if (item.badge === "swarm") {
      setActiveRoute("swarm")
    }
  }

  if (leftCollapsed) {
    return null
  }

  const doneCount = gettingStarted.filter((g) => g.completed).length
  const totalCount = Math.max(1, gettingStarted.length)
  const pct = Math.round((doneCount / totalCount) * 100)

  return (
    <div className="flex w-[244px] shrink-0 flex-col bg-chrome pr-2.5 pb-2.5 pl-1 select-none">
      {/* Top 46px Back / Forward row */}
      <div className="flex h-[46px] shrink-0 items-center justify-end gap-1 pr-0.5">
        <button
          type="button"
          aria-label="Back"
          onClick={() => setActiveRoute("home")}
          className="grid size-7 cursor-pointer place-items-center rounded-sm border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
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
          onClick={() => toast("Latest view")}
          className="grid size-7 cursor-pointer place-items-center rounded-sm border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
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

      {/* Brand row + Open IDE / Filter / Search */}
      <div className="flex shrink-0 items-center gap-1.5 px-1.5 pt-0.5 pb-2">
        <button
          type="button"
          onClick={() => toast("Workspace: RayuCode Desktop v1")}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-base font-semibold tracking-tight text-ink hover:bg-hover"
        >
          <span>RayuCode</span>
          <svg
            className="size-3 text-muted-ink"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Open IDE"
          onClick={() => {
            void ipcClient.native.openInVSCode("~/workspace/rayu/rayucode-v2")
            toast("Opened ~/workspace/rayu/rayucode-v2 in Visual Studio Code")
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-premium bg-raised px-2 py-0.5 text-[11px] font-medium text-body shadow-bevel-surface transition-colors hover:border-premium-hi hover:text-ink"
        >
          <span>Open IDE</span>
        </button>
      </div>

      {/* New Conversation button */}
      <button
        type="button"
        onClick={() => {
          setActiveSession(null)
          setActiveRoute("home")
        }}
        className={cn(
          "flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-[9px] px-2.5 py-[7px] text-[13px] transition-colors",
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
        <span>+ New Conversation</span>
      </button>

      {/* Scrollable Projects & Recents (Zero Folder Tree!) */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="px-2.5 pt-3.5 pb-1.5 text-xs font-medium text-muted-ink">
          Projects
        </div>
        {projects.map((proj) => (
          <div key={proj.id} className="mb-1">
            <button
              type="button"
              aria-expanded={proj.expanded}
              onClick={() => toggleProject(proj.id)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] text-body transition-colors hover:bg-hover hover:text-ink"
            >
              <svg
                className="size-[15px] shrink-0 text-muted-ink"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.65"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l1.8 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9.5Z" />
              </svg>
              <span className="truncate">{proj.name}</span>
            </button>
            {proj.expanded && (
              <div className="flex flex-col gap-0.5 pl-4">
                {proj.sessions.map((s) => {
                  const isActive =
                    activeRoute === "workspace" && activeSessionId === s.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openSessionWithOptionalPreview(s.id, s.route)}
                      className={cn(
                        "flex w-full cursor-pointer items-center rounded-[9px] px-2.5 py-1.5 text-left text-[13px] transition-colors",
                        isActive
                          ? "bg-active font-medium text-ink"
                          : "text-body hover:bg-hover hover:text-ink"
                      )}
                    >
                      <span className="truncate">{s.title}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        <div className="px-2.5 pt-3.5 pb-1.5 text-xs font-medium text-muted-ink">
          Recents
        </div>
        {recents.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openSessionWithOptionalPreview(r.id, r.route)}
            className="block w-full cursor-pointer truncate rounded-[9px] px-2.5 py-1.5 text-left text-[13px] text-body transition-colors hover:bg-hover hover:text-ink"
          >
            {r.title}
          </button>
        ))}
      </div>

      {/* Bottom Getting Started Checklist Card */}
      <div className="rayu-card-bevel mt-1.5 shrink-0 rounded-[14px] bg-pane px-3 pt-3 pb-2.5">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-ink">Getting started</span>
          <span className="font-mono text-muted-ink tabular-nums">
            {doneCount} of {gettingStarted.length}
          </span>
        </div>
        <div className="mb-2.5 h-[3px] overflow-hidden rounded-full bg-active">
          <span
            className="block h-full rounded-full bg-brand transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-col gap-1">
          {gettingStarted.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void handleToggleChecklist(item)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-0.5 py-1 text-left text-xs transition-colors",
                item.completed
                  ? "text-muted-ink line-through"
                  : "text-body hover:text-ink"
              )}
            >
              <span
                className={cn(
                  "grid size-3.5 shrink-0 place-items-center rounded-full border transition-colors",
                  item.completed
                    ? "border-brand bg-brand text-brand-ink"
                    : "border-hairline-strong"
                )}
              >
                {item.completed && (
                  <svg
                    className="size-2.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <path d="m4.5 12.5 5 5 10-11" />
                  </svg>
                )}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function LeftSidebar() {
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)

  return (
    <aside
      aria-label="Navigation and conversations"
      className={cn(
        "flex h-full shrink-0 overflow-hidden transition-[width] duration-150",
        leftCollapsed ? "w-[52px] bg-canvas" : "w-[296px] bg-chrome"
      )}
    >
      <IconRail />
      <SessionPane />
    </aside>
  )
}
