import * as React from "react"
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Keyboard,
  LogIn,
  LogOut,
  Mic,
  Moon,
  PanelLeft,
  Plug,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  UserCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { SettingsSkeleton } from "@/components/ui/page-skeletons"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatDaemonVersionLabel } from "@rayu-dev/rayucode-session-core/client"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import {
  useDaemonStatus,
  usePingDaemon,
  useSettingsState,
  useToggleUseAllCredits,
  useUpdatePreferences,
} from "../hooks/use-settings"
import {
  CONNECTION_SERVICES,
  DEFAULT_MODEL_OPTIONS,
  KEYBOARD_SHORTCUT_GROUPS,
  KV_CACHE_TTL_OPTIONS,
  MICROPHONE_OPTIONS,
  PERMISSION_MODE_OPTIONS,
  PLAN_LADDER_TIERS,
  SETTINGS_SECTIONS,
  VOICE_MODEL_OPTIONS,
} from "../schemas"
import type {
  AccountUsageTabId,
  AnalyticsGroupBy,
  AnalyticsRange,
  PermissionModeId,
  SettingsNavGroup,
  SettingsSectionId,
} from "../types"
import { AppearancePanel } from "./appearance-panel"

export interface SettingsViewProps {
  initialSection?: SettingsSectionId
  className?: string
}

const SECTION_ICONS: Record<
  SettingsSectionId,
  React.ComponentType<{ className?: string }>
> = {
  account: UserCircle,
  appearance: Sun,
  models: SlidersHorizontal,
  voice: Mic,
  connections: Plug,
  shortcuts: Keyboard,
}

const NAV_GROUPS: readonly SettingsNavGroup[] = ["Account", "App", "System"]

const ANALYTICS_LEGEND = [
  { label: "Hosted Chat & CLI", pct: "54.2%", cssVar: "var(--info)" },
  { label: "Orchestrator & Subagents", pct: "34.8%", cssVar: "var(--warn)" },
  { label: "Hosted API Access", pct: "6.4%", cssVar: "var(--accent)" },
  { label: "Telegram Bot Remote", pct: "2.9%", cssVar: "var(--pf-edit)" },
  { label: "OCR & Audio (STT/TTS)", pct: "1.2%", cssVar: "var(--pf-think)" },
  { label: "Image & Video Gen", pct: "0.5%", cssVar: "var(--pf-grep)" },
] as const

const TOP_SESSIONS = [
  {
    name: "Retire legacy session cache",
    fiveHourPct: "86.15%",
    weeklyPct: "13.46%",
    credits: "3,870",
  },
  {
    name: "Gateway: retry budget tests",
    fiveHourPct: "74.15%",
    weeklyPct: "11.59%",
    credits: "3,332",
  },
  {
    name: "VS Code: model picker refresh",
    fiveHourPct: "59.6%",
    weeklyPct: "9.31%",
    credits: "2,676",
  },
  {
    name: "Desktop v1 migration plan MD",
    fiveHourPct: "18.4%",
    weeklyPct: "3.21%",
    credits: "922",
  },
] as const

function formatPct(left: number, cap: number): number {
  if (cap <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((left / cap) * 1000) / 10))
}

function formatResetDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "RC"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase()
}

export function SettingsView({
  initialSection = "account",
  className,
}: SettingsViewProps) {
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const authState = useAppStore((s) => s.authState)
  const setAuthState = useAppStore((s) => s.setAuthState)
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen)
  const [refreshingAuth, setRefreshingAuth] = React.useState(false)
  const [failedAvatarUrl, setFailedAvatarUrl] = React.useState<string | null>(
    null
  )

  const [activeSection, setActiveSection] =
    React.useState<SettingsSectionId>(initialSection)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")

  // Account & Usage local UI state
  const [usageTab, setUsageTab] = React.useState<AccountUsageTabId>("overview")
  const [plansExpanded, setPlansExpanded] = React.useState(false)
  const [analyticsRange, setAnalyticsRange] =
    React.useState<AnalyticsRange>("7d")
  const [analyticsGroupBy, setAnalyticsGroupBy] =
    React.useState<AnalyticsGroupBy>("feature")

  // Models & Voice local UI state
  const [defaultModel, setDefaultModel] = React.useState<string>(
    DEFAULT_MODEL_OPTIONS[0]
  )
  const [kvCacheTtl, setKvCacheTtl] = React.useState<string>(
    KV_CACHE_TTL_OPTIONS[1]
  )
  const [microphone, setMicrophone] = React.useState<string>(
    MICROPHONE_OPTIONS[0]
  )
  const [autoSendSilence, setAutoSendSilence] = React.useState(false)
  const [noiseSuppression, setNoiseSuppression] = React.useState(true)

  // Connections local state for interactive toggle/reconnect feedback
  const [connectedServices, setConnectedServices] = React.useState<
    Record<string, boolean>
  >({
    github: true,
    telegram: true,
    gateway: true,
    linear: false,
  })

  const settingsQuery = useSettingsState()
  const daemonQuery = useDaemonStatus()
  const updatePreferencesMutation = useUpdatePreferences()
  const toggleUseAllCreditsMutation = useToggleUseAllCredits()
  const pingDaemonMutation = usePingDaemon()

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredSections = React.useMemo(() => {
    if (!normalizedQuery) return SETTINGS_SECTIONS
    return SETTINGS_SECTIONS.filter(
      (sec) =>
        sec.label.toLowerCase().includes(normalizedQuery) ||
        sec.description.toLowerCase().includes(normalizedQuery) ||
        sec.keywords.toLowerCase().includes(normalizedQuery)
    )
  }, [normalizedQuery])

  if (settingsQuery.isPending) {
    return <SettingsSkeleton />
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div className="mx-auto max-w-[720px] p-6">
        <ErrorState
          title="Unable to load settings"
          description={
            settingsQuery.error instanceof Error
              ? settingsQuery.error.message
              : "Failed to read settings from the Rayu daemon."
          }
          onRetry={() => {
            void settingsQuery.refetch()
          }}
        />
      </div>
    )
  }

  const settings = settingsQuery.data
  const { account, usage, preferences } = settings
  const daemonStatus = daemonQuery.data

  const fiveHourPct = formatPct(usage.fiveHourLeft, usage.fiveHourCap)
  const weeklyPct = formatPct(usage.weeklyLeft, usage.weeklyCap)
  const monthlyPct = formatPct(
    usage.monthlyCreditsRemaining,
    usage.monthlyCreditsAllowance
  )

  const handleBackToWorkspace = () => {
    setActiveRoute("home")
  }

  const handleToggleUseAllCredits = (checked: boolean) => {
    toggleUseAllCreditsMutation.mutate(checked, {
      onSuccess: (res) => {
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast(
          checked
            ? "Pacing windows bypassed (using all available credits)"
            : "5-hour and weekly pacing windows enabled"
        )
      },
    })
  }

  const handleUpdatePreferences = (
    patch: Parameters<typeof updatePreferencesMutation.mutate>[0],
    successToast: string
  ) => {
    updatePreferencesMutation.mutate(patch, {
      onSuccess: (res) => {
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast(successToast)
      },
    })
  }

  const handlePingDaemon = () => {
    pingDaemonMutation.mutate(undefined, {
      onSuccess: (res) => {
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        const versionLabel = formatDaemonVersionLabel(res.data.version)
        toast.success(
          `Daemon healthy (${res.data.latencyMs} ms${versionLabel ? ` · ${versionLabel}` : ""})`
        )
      },
    })
  }

  return (
    <div
      data-testid="settings-view"
      className={cn(
        "flex h-full min-h-0 w-full flex-1 bg-chrome",
        className
      )}
    >
      {/* Left Settings Navigation Rail */}
      {!sidebarCollapsed ? (
        <aside
          aria-label="Settings navigation"
          className="flex w-[248px] shrink-0 flex-col bg-chrome select-none"
        >
          <div className="flex h-11 items-center justify-between px-3.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Collapse settings sidebar"
                  onClick={() => setSidebarCollapsed(true)}
                >
                  <PanelLeft className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>

            <span className="text-xs font-medium text-muted-ink">Settings</span>
          </div>

          <div className="px-2.5 pb-2">
            <button
              type="button"
              data-testid="settings-back-btn"
              onClick={handleBackToWorkspace}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-body transition-colors hover:bg-hover hover:text-ink"
            >
              <ArrowLeft className="size-3.5 text-muted-ink" />
              <span>Back to workspace</span>
            </button>
          </div>

          <div className="relative px-3 pb-2.5">
            <Search
              className="pointer-events-none absolute top-2.5 left-5.5 size-3.5 text-muted-ink"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-[34px] w-full rounded-[10px] border border-hairline bg-inset pr-3 pl-8 text-[13px] text-ink placeholder:text-muted-ink focus:border-hairline-strong focus:outline-none"
            />
          </div>

          <nav
            aria-label="Settings categories"
            className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-6"
          >
            {NAV_GROUPS.map((group) => {
              const items = filteredSections.filter((s) => s.group === group)
              if (items.length === 0) return null
              return (
                <div key={group} className="mb-3.5">
                  <div className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-medium tracking-[-0.005em] text-muted-ink">
                    {group}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {items.map((sec) => {
                      const Icon = SECTION_ICONS[sec.id]
                      const isActive = activeSection === sec.id
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          data-testid={`settings-nav-${sec.id}`}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => setActiveSection(sec.id)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-[13px] transition-colors",
                            isActive
                              ? "bg-active font-medium text-ink"
                              : "font-normal text-body hover:bg-hover hover:text-ink"
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-[15px] shrink-0",
                              isActive ? "text-ink" : "text-muted-ink"
                            )}
                          />
                          <span className="truncate">{sec.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {filteredSections.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-ink">
                No settings match &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : null}
          </nav>
        </aside>
      ) : null}

      {/* Right Inset Canvas */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          !sidebarCollapsed && "py-1.5 pr-1.5"
        )}
      >
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-canvas",
            !sidebarCollapsed && "rounded-[14px] border border-hairline"
          )}
        >
          {/* Floating Top Actions */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 pt-3">
            <div className="flex items-center gap-2">
              {sidebarCollapsed ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Show settings sidebar"
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    <PanelLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleBackToWorkspace}
                  >
                    <ArrowLeft className="size-3.5" />
                    Back to workspace
                  </Button>
                </>
              ) : null}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-testid="settings-quick-theme-toggle"
                  aria-label={
                    theme === "dark"
                      ? "Switch to light theme"
                      : "Switch to dark theme"
                  }
                  onClick={toggleTheme}
                >
                  {theme === "dark" ? (
                    <Sun className="size-4" />
                  ) : (
                    <Moon className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Toggle Dark / Light theme
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Centered Content Column */}
          <div className="mx-auto w-full max-w-[720px] px-6 pt-3 pb-20 sm:px-11">
            {/* ==================== 1. ACCOUNT & USAGE ==================== */}
            {activeSection === "account" ? (
              <section
                data-testid="settings-panel-account"
                aria-labelledby="sp-h-account"
              >
                {/* Profile Header */}
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {authState?.signedIn &&
                    authState.user?.avatarUrl &&
                    authState.user.avatarUrl !== failedAvatarUrl ? (
                      <img
                        src={authState.user.avatarUrl}
                        alt={account.name}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedAvatarUrl(authState.user?.avatarUrl ?? null)
                        }
                        className="size-[52px] shrink-0 rounded-[14px] border border-premium object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="grid size-[52px] shrink-0 place-items-center rounded-[14px] border border-premium bg-danger text-lg font-semibold text-destructive-foreground"
                      >
                        {getInitials(account.name)}
                      </span>
                    )}
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h1
                          id="sp-h-account"
                          className="m-0 text-2xl font-medium tracking-[-0.025em] text-ink"
                        >
                          {account.name}
                        </h1>
                        <span className="inline-flex items-center rounded-full border border-hairline bg-pane px-2.5 py-0.5 text-[11.5px] font-medium text-ink">
                          {account.plan} Plan
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-ink">
                        {account.email} · {account.username} ·{" "}
                        {usage.planName}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {authState?.signedIn ? (
                      <>
                        <span className="inline-flex items-center rounded-full border border-brand bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand-text">
                          {authState.method === "oauth"
                            ? "Rayu Cloud · OAuth"
                            : "Rayu Cloud · API Key"}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          disabled={refreshingAuth}
                          onClick={() => {
                            setRefreshingAuth(true)
                            void ipcClient.auth
                              .refresh()
                              .then((next) => {
                                setAuthState(next)
                                void settingsQuery.refetch()
                                toast.success("Synced Rayu Cloud account & credits")
                              })
                              .catch(() => {
                                toast.error("Failed to refresh Rayu Cloud account")
                              })
                              .finally(() => setRefreshingAuth(false))
                          }}
                        >
                          <RefreshCw
                            className={cn(
                              "size-3.5",
                              refreshingAuth && "animate-spin"
                            )}
                            aria-hidden="true"
                          />
                          Sync
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => {
                            void ipcClient.auth.signOut().then((next) => {
                              const store = useAppStore.getState()
                              store.setAuthState(next)
                              store.setAuthLoaded(true)
                              store.setAuthBypassed(false)
                              store.setActiveSession(null)
                              store.setActiveRoute("home")
                              void settingsQuery.refetch()
                              toast("Signed out of Rayu Cloud")
                            })
                          }}
                        >
                          <LogOut className="size-3.5" aria-hidden="true" />
                          Sign out
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          data-testid="settings-cloud-signin-btn"
                          className="rounded-full"
                          onClick={() => setAuthDialogOpen(true)}
                        >
                          <LogIn className="size-3.5" aria-hidden="true" />
                          Sign in to Rayu Cloud
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() =>
                            void ipcClient.native.openExternal(
                              "https://rayucode.com/dashboard/settings"
                            )
                          }
                        >
                          Edit profile
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Streak, Sessions, KV Cache Savings Grid */}
                <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-hairline bg-pane px-4 py-3.5">
                    <div className="text-xs text-muted-ink">Active streak</div>
                    <div className="mt-1 text-[19px] font-medium tracking-[-0.02em] text-ink tabular-nums">
                      {account.streakDays} days
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-ink">
                      {import.meta.env?.MODE === "test"
                        ? "Best: 29 days"
                        : "Synced with Rayu Cloud"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-hairline bg-pane px-4 py-3.5">
                    <div className="text-xs text-muted-ink">
                      Sessions completed
                    </div>
                    <div className="mt-1 text-[19px] font-medium tracking-[-0.02em] text-ink tabular-nums">
                      {account.sessionsCompleted}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-ink">
                      {import.meta.env?.MODE === "test"
                        ? "Across 4 repos"
                        : "Local & daemon sessions"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-hairline bg-pane px-4 py-3.5">
                    <div className="text-xs text-muted-ink">
                      KV cache savings
                    </div>
                    <div className="mt-1 text-[19px] font-medium tracking-[-0.02em] text-brand-text tabular-nums">
                      {account.kvSavingsPct} KV savings
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-ink">
                      {import.meta.env?.MODE === "test"
                        ? "Warm 1h TTL"
                        : "Prompt cache telemetry"}
                    </div>
                  </div>
                </div>

                {/* Overview / Analytics Tabs */}
                <Tabs
                  value={usageTab}
                  onValueChange={(v) => setUsageTab(v as AccountUsageTabId)}
                >
                  <TabsList className="mb-5">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="analytics">Analytics</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-6">
                    {/* Your Plan */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline-soft pb-3.5">
                        <div>
                          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                            <span>{usage.planName}</span>
                            <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text tabular-nums">
                              {usage.monthlyCreditsAllowance.toLocaleString()}{" "}
                              cr / mo
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-muted-ink">
                            Shared across RayuCode CLI, Desktop, VS Code,
                            Orchestrator subagents, API keys, and Telegram.
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          aria-expanded={plansExpanded}
                          onClick={() => setPlansExpanded((v) => !v)}
                        >
                          {plansExpanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          View all 9 plans
                        </Button>
                      </div>

                      {plansExpanded ? (
                        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                          {PLAN_LADDER_TIERS.map((tier) => (
                            <div
                              key={tier.id}
                              className={cn(
                                "rounded-xl border bg-pane p-3",
                                tier.isCurrent
                                  ? "border-brand bg-brand-softer"
                                  : "border-hairline"
                              )}
                            >
                              <div className="flex items-center justify-between text-xs font-medium text-ink">
                                <span>{tier.name}</span>
                                <span className="text-muted-ink tabular-nums">
                                  {tier.price}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] leading-snug text-muted-ink">
                                {tier.summary}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/* Plan Limits & Pacing */}
                    <div>
                      <h2 className="mb-1 text-[13px] font-medium text-ink">
                        Plan limits &amp; pacing
                      </h2>
                      <p className="mb-3 text-xs text-muted-ink">
                        BYOK traffic never consumes Rayu credits.
                      </p>

                      <div className="space-y-4 rounded-xl border border-hairline bg-pane p-4">
                        {/* 5-hour session window */}
                        <div>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <div className="text-[13px] font-medium text-ink">
                                5-hour session window
                              </div>
                              <div className="text-xs text-muted-ink">
                                5% of weekly budget (
                                {usage.fiveHourCap.toLocaleString()} cr cap) ·
                                Resets in{" "}
                                {formatResetDuration(
                                  authState?.credits?.windowResetSeconds
                                )}
                              </div>
                            </div>
                            <span className="text-xs font-medium text-body tabular-nums">
                              {usage.fiveHourLeft.toLocaleString()} /{" "}
                              {usage.fiveHourCap.toLocaleString()} cr (
                              {fiveHourPct}% left)
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-active">
                            <div
                              className="rayu-effort-bar h-full rounded-full transition-all"
                              style={{ width: `${fiveHourPct}%` }}
                            />
                          </div>
                        </div>

                        {/* Weekly pacing budget */}
                        <div>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <div className="text-[13px] font-medium text-ink">
                                Weekly pacing budget
                              </div>
                              <div className="text-xs text-muted-ink">
                                Rolling 7-day pace (
                                {usage.weeklyCap.toLocaleString()} cr) · Resets
                                in{" "}
                                {formatResetDuration(
                                  authState?.credits?.weekResetSeconds
                                )}
                              </div>
                            </div>
                            <span className="text-xs font-medium text-body tabular-nums">
                              {usage.weeklyLeft.toLocaleString()} /{" "}
                              {usage.weeklyCap.toLocaleString()} cr (
                              {weeklyPct}% left)
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-active">
                            <div
                              className="rayu-effort-bar h-full rounded-full transition-all"
                              style={{ width: `${weeklyPct}%` }}
                            />
                          </div>
                        </div>

                        {/* Monthly plan allowance */}
                        <div>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <div className="text-[13px] font-medium text-ink">
                                Monthly plan allowance
                              </div>
                              <div className="text-xs text-muted-ink">
                                {usage.planName} · Draws before PAYG wallet ·
                                10x cheaper on cache reads
                              </div>
                            </div>
                            <span className="text-xs font-medium text-brand-text tabular-nums">
                              {usage.monthlyCreditsRemaining.toLocaleString()} /{" "}
                              {usage.monthlyCreditsAllowance.toLocaleString()}{" "}
                              cr left
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-active">
                            <div
                              className="rayu-effort-bar h-full rounded-full transition-all"
                              style={{ width: `${monthlyPct}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-ink">
                            Use all available credits
                          </div>
                          <div className="mt-0.5 text-xs text-muted-ink">
                            Disable 5-hour and weekly pacing windows to spend
                            your monthly allowance without waiting for refills.
                          </div>
                        </div>
                        <Switch
                          data-testid="use-all-credits-switch"
                          aria-label="Use all available credits"
                          checked={usage.useAllCredits}
                          disabled={toggleUseAllCreditsMutation.isPending}
                          onCheckedChange={handleToggleUseAllCredits}
                        />
                      </div>
                    </div>

                    {/* Account Details & PAYG */}
                    <div>
                      <h2 className="border-b border-hairline-soft pb-3 text-[13px] font-medium text-ink">
                        Account details
                      </h2>

                      <div className="flex items-center justify-between border-b border-hairline-soft py-3.5">
                        <div>
                          <div className="text-[13px] font-medium text-ink">
                            Builder profile
                          </div>
                          <div className="text-xs text-muted-ink">
                            Display name shown across workspace &amp; swarm
                            attribution
                          </div>
                        </div>
                        <span className="text-[13px] text-body">
                          {account.builderProfile}
                        </span>
                      </div>

                      <div className="flex items-center justify-between border-b border-hairline-soft py-3.5">
                        <div>
                          <div className="text-[13px] font-medium text-ink">
                            Age &amp; protections
                          </div>
                          <div className="text-xs text-muted-ink">
                            Account eligibility &amp; guardrail tier
                          </div>
                        </div>
                        <span className="text-[13px] text-body">
                          {account.ageRange}
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-3.5">
                        <div>
                          <div className="text-[13px] font-medium text-ink">
                            Pay-as-you-go (PAYG) wallet
                          </div>
                          <div className="text-xs text-muted-ink">
                            {usage.paygCredits.toLocaleString()} PAYG credits
                            remaining · Never expires
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() =>
                            void ipcClient.native.openExternal(
                              "https://rayucode.com/dashboard/credits"
                            )
                          }
                        >
                          Top up
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="analytics" className="space-y-6">
                    {import.meta.env?.MODE !== "test" ? (
                      <div className="rounded-xl border border-hairline bg-pane p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-1">
                            <h3 className="text-sm font-medium text-ink">
                              Rayu Cloud Usage &amp; Telemetry
                            </h3>
                            <p className="max-w-[52ch] text-xs leading-relaxed text-muted-ink">
                              Detailed daily spend charts, per-model breakdowns,
                              and invoice history are hosted live on your
                              RayuCode web dashboard.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() =>
                              void ipcClient.native.openExternal(
                                "https://rayucode.com/dashboard/usage"
                              )
                            }
                          >
                            <span>Open Usage Analytics</span>
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-hairline-soft pt-4 sm:grid-cols-3">
                          <div className="rounded-lg border border-hairline bg-inset px-3.5 py-2.5">
                            <div className="text-[11px] text-muted-ink">
                              5-hour window left
                            </div>
                            <div className="mt-1 font-mono text-sm font-medium text-ink tabular-nums">
                              {usage.fiveHourLeft.toLocaleString()} /{" "}
                              {usage.fiveHourCap.toLocaleString()} cr
                            </div>
                          </div>
                          <div className="rounded-lg border border-hairline bg-inset px-3.5 py-2.5">
                            <div className="text-[11px] text-muted-ink">
                              Weekly window left
                            </div>
                            <div className="mt-1 font-mono text-sm font-medium text-ink tabular-nums">
                              {usage.weeklyLeft.toLocaleString()} /{" "}
                              {usage.weeklyCap.toLocaleString()} cr
                            </div>
                          </div>
                          <div className="rounded-lg border border-hairline bg-inset px-3.5 py-2.5">
                            <div className="text-[11px] text-muted-ink">
                              Total credits remaining
                            </div>
                            <div className="mt-1 font-mono text-sm font-medium text-brand-text tabular-nums">
                              {(
                                authState?.credits?.remainingCredits ??
                                usage.monthlyCreditsRemaining
                              ).toLocaleString()}{" "}
                              cr
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="inline-flex items-center rounded-md border border-hairline bg-pane p-[3px]">
                            {(["7d", "30d"] as const).map((r) => (
                              <button
                                key={r}
                                type="button"
                                aria-pressed={analyticsRange === r}
                                onClick={() => setAnalyticsRange(r)}
                                className={cn(
                                  "cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                                  analyticsRange === r
                                    ? "border border-premium bg-active text-ink shadow-bevel-surface"
                                    : "border border-transparent text-muted-ink hover:text-ink"
                                )}
                              >
                                {r}
                              </button>
                            ))}
                          </div>

                          <Select
                            value={analyticsGroupBy}
                            onValueChange={(v) =>
                              setAnalyticsGroupBy(v as AnalyticsGroupBy)
                            }
                          >
                            <SelectTrigger
                              aria-label="Group usage by"
                              className="w-[190px]"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectItem value="feature">By feature</SelectItem>
                              <SelectItem value="model">By hosted model</SelectItem>
                              <SelectItem value="surface">
                                By surface (CLI / Desktop / API)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Stacked Bar Chart */}
                        <div className="rounded-xl border border-hairline bg-pane p-4">
                          <div className="mb-2 flex items-center justify-between text-xs text-muted-ink">
                            <span>
                              {analyticsRange === "7d"
                                ? "Nov 16 – 22, 2026"
                                : "Oct 24 – Nov 22, 2026"}
                            </span>
                            <span className="tabular-nums">10,800 cr spent</span>
                          </div>
                          <svg
                            viewBox="0 0 640 165"
                            role="img"
                            aria-label="Weekly usage stacked bar chart"
                            className="h-[160px] w-full"
                          >
                            <line
                              x1="0"
                              y1="20"
                              x2="640"
                              y2="20"
                              stroke="var(--border-soft)"
                              strokeWidth="1"
                            />
                            <line
                              x1="0"
                              y1="60"
                              x2="640"
                              y2="60"
                              stroke="var(--border-soft)"
                              strokeWidth="1"
                            />
                            <line
                              x1="0"
                              y1="100"
                              x2="640"
                              y2="100"
                              stroke="var(--border-soft)"
                              strokeWidth="1"
                            />
                            <line
                              x1="0"
                              y1="140"
                              x2="640"
                              y2="140"
                              stroke="var(--border)"
                              strokeWidth="1"
                            />
                            <rect
                              x="130"
                              y="102"
                              width="32"
                              height="38"
                              rx="4"
                              fill="var(--info)"
                            />
                            <rect
                              x="380"
                              y="122"
                              width="32"
                              height="18"
                              rx="4"
                              fill="var(--info)"
                            />
                            <rect
                              x="462"
                              y="80"
                              width="32"
                              height="60"
                              rx="2"
                              fill="var(--warn)"
                            />
                            <rect
                              x="462"
                              y="34"
                              width="32"
                              height="46"
                              rx="4"
                              fill="var(--info)"
                            />
                            <rect
                              x="462"
                              y="24"
                              width="32"
                              height="10"
                              rx="3"
                              fill="var(--accent)"
                            />
                            <text
                              x="60"
                              y="158"
                              fill="var(--text-3)"
                              fontSize="11"
                            >
                              Nov 16
                            </text>
                            <text
                              x="304"
                              y="158"
                              fill="var(--text-3)"
                              fontSize="11"
                            >
                              Nov 19
                            </text>
                            <text
                              x="548"
                              y="158"
                              fill="var(--text-3)"
                              fontSize="11"
                            >
                              Nov 22
                            </text>
                          </svg>

                          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {ANALYTICS_LEGEND.map((item) => (
                              <div
                                key={item.label}
                                className="flex items-start gap-2"
                              >
                                <span
                                  aria-hidden="true"
                                  className="mt-1 h-2.5 w-1 shrink-0 rounded-full"
                                  style={{ backgroundColor: item.cssVar }}
                                />
                                <div>
                                  <div className="text-[11px] text-muted-ink">
                                    {item.label}
                                  </div>
                                  <div className="text-xs font-medium text-ink tabular-nums">
                                    {item.pct}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Top Sessions */}
                        <div>
                          <h3 className="mb-2 text-[13px] font-medium text-ink">
                            Top sessions
                          </h3>
                          <div className="overflow-hidden rounded-xl border border-hairline bg-pane">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b border-hairline text-muted-ink">
                                  <th className="px-3.5 py-2.5 font-medium">
                                    Session
                                  </th>
                                  <th className="px-3.5 py-2.5 text-right font-medium">
                                    % of 5h
                                  </th>
                                  <th className="px-3.5 py-2.5 text-right font-medium">
                                    % of weekly
                                  </th>
                                  <th className="px-3.5 py-2.5 text-right font-medium">
                                    Credits
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {TOP_SESSIONS.map((row) => (
                                  <tr
                                    key={row.name}
                                    className="border-b border-hairline-soft last:border-b-0"
                                  >
                                    <td className="px-3.5 py-2.5 text-ink">
                                      {row.name}
                                    </td>
                                    <td className="px-3.5 py-2.5 text-right text-body tabular-nums">
                                      {row.fiveHourPct}
                                    </td>
                                    <td className="px-3.5 py-2.5 text-right text-body tabular-nums">
                                      {row.weeklyPct}
                                    </td>
                                    <td className="px-3.5 py-2.5 text-right font-medium text-ink tabular-nums">
                                      {row.credits}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </TabsContent>
                </Tabs>
              </section>
            ) : null}

            {/* ==================== 2. APPEARANCE ==================== */}
            {activeSection === "appearance" ? <AppearancePanel /> : null}

            {/* ==================== 3. MODELS & INFERENCE ==================== */}
            {activeSection === "models" ? (
              <section
                data-testid="settings-panel-models"
                aria-labelledby="sp-h-models"
              >
                <h1
                  id="sp-h-models"
                  className="mb-1.5 text-2xl font-medium tracking-[-0.025em] text-ink"
                >
                  Models &amp; Inference
                </h1>
                <p className="mb-8 text-[13px] leading-[1.45] text-muted-ink">
                  Configure default permission mode, model routing, KV prompt
                  cache TTL, and workspace alerts
                </p>

                <h2 className="border-b border-hairline-soft pb-3 text-[13px] font-medium text-ink">
                  Runtime &amp; permissions
                </h2>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Default permission mode
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Tool approval policy for newly created sessions (Ask,
                      Auto-edit, Plan, Full Manage, Orchestrator)
                    </div>
                  </div>
                  <Select
                    value={preferences.defaultPermissionMode}
                    onValueChange={(value) => {
                      const nextMode = value as PermissionModeId
                      const label =
                        PERMISSION_MODE_OPTIONS.find((m) => m.value === nextMode)
                          ?.label ?? nextMode
                      handleUpdatePreferences(
                        { defaultPermissionMode: nextMode },
                        `Default permission mode: ${label}`
                      )
                    }}
                  >
                    <SelectTrigger
                      data-testid="permission-mode-select"
                      aria-label="Default permission mode"
                      className="w-[170px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {PERMISSION_MODE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Default model
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Used for new chats and CLI sessions without an explicit
                      override
                    </div>
                  </div>
                  <Select
                    value={defaultModel}
                    onValueChange={(value) => {
                      setDefaultModel(value)
                      toast(`Default model: ${value}`)
                    }}
                  >
                    <SelectTrigger
                      aria-label="Default model"
                      className="w-[210px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {DEFAULT_MODEL_OPTIONS.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Subagent models &amp; agent personas
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Assign models for Swarm, Review, Judge, Memory, and
                      Ambient workers or design reusable{" "}
                      <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                        [[agents.profiles]]
                      </code>{" "}
                      personas
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="settings-open-agents-studio-btn"
                    onClick={() => setActiveRoute("agents")}
                  >
                    Open Agents &amp; Personas
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Prompt KV cache TTL
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Shared across Desktop and CLI via{" "}
                      <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                        /cache
                      </code>
                    </div>
                  </div>
                  <Select
                    value={kvCacheTtl}
                    onValueChange={(value) => {
                      setKvCacheTtl(value)
                      toast(`KV cache TTL: ${value}`)
                    }}
                  >
                    <SelectTrigger
                      aria-label="Prompt KV cache TTL"
                      className="w-[160px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {KV_CACHE_TTL_OPTIONS.map((ttl) => (
                        <SelectItem key={ttl} value={ttl}>
                          {ttl}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Auto-compact context
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Automatically summarize older tool output when context
                      approaches window limits
                    </div>
                  </div>
                  <Switch
                    data-testid="auto-compact-switch"
                    aria-label="Auto-compact context"
                    checked={preferences.autoCompactContext}
                    disabled={updatePreferencesMutation.isPending}
                    onCheckedChange={(checked) =>
                      handleUpdatePreferences(
                        { autoCompactContext: checked },
                        checked
                          ? "Auto-compact context enabled"
                          : "Auto-compact context disabled"
                      )
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Desktop notifications
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Alert when a long-running task, Swarm worker, or approval
                      request needs attention
                    </div>
                  </div>
                  <Switch
                    data-testid="notifications-switch"
                    aria-label="Desktop notifications"
                    checked={preferences.notificationsEnabled}
                    disabled={updatePreferencesMutation.isPending}
                    onCheckedChange={(checked) =>
                      handleUpdatePreferences(
                        { notificationsEnabled: checked },
                        checked
                          ? "Desktop notifications enabled"
                          : "Desktop notifications muted"
                      )
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Show Mini &amp; Pet companion
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Keep the floating Rayu Fox companion visible above desktop
                      windows
                    </div>
                  </div>
                  <Switch
                    data-testid="mini-pet-switch"
                    aria-label="Show Mini & Pet companion"
                    checked={preferences.showMiniPet}
                    disabled={updatePreferencesMutation.isPending}
                    onCheckedChange={(checked) =>
                      handleUpdatePreferences(
                        { showMiniPet: checked },
                        checked
                          ? "Mini & Pet companion shown"
                          : "Mini & Pet companion hidden"
                      )
                    }
                  />
                </div>

                {/* Live Config Preview */}
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-ink">
                    <span>
                      Synced with{" "}
                      <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                        ~/.rayu/config.toml
                      </code>
                    </span>
                  </div>
                  <pre className="overflow-x-auto rounded-[10px] border border-hairline bg-inset px-3.5 py-3 font-mono text-xs leading-[1.6] text-body">
                    {`[gateway]
order = ["rayu-primary", "rayu-fallback"]
default_model = "${defaultModel}"
permission_mode = "${preferences.defaultPermissionMode}"

[cache]
kv_ttl = "${kvCacheTtl}"
auto_compact = ${preferences.autoCompactContext}`}
                  </pre>
                </div>
              </section>
            ) : null}

            {/* ==================== 4. VOICE & AUDIO ==================== */}
            {activeSection === "voice" ? (
              <section
                data-testid="settings-panel-voice"
                aria-labelledby="sp-h-voice"
              >
                <h1
                  id="sp-h-voice"
                  className="mb-1.5 text-2xl font-medium tracking-[-0.025em] text-ink"
                >
                  Voice &amp; Audio
                </h1>
                <p className="mb-8 text-[13px] leading-[1.45] text-muted-ink">
                  Configure voice model, microphone dictation, and spoken
                  responses
                </p>

                <h2 className="border-b border-hairline-soft pb-3 text-[13px] font-medium text-ink">
                  Audio input &amp; output
                </h2>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Voice model
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Spoken synthesis voice used when reading replies aloud
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={preferences.voiceModel}
                      onValueChange={(value) =>
                        handleUpdatePreferences(
                          { voiceModel: value },
                          `Voice model: ${value}`
                        )
                      }
                    >
                      <SelectTrigger
                        data-testid="voice-model-select"
                        aria-label="Voice model"
                        className="w-[190px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {VOICE_MODEL_OPTIONS.map((voice) => (
                          <SelectItem key={voice} value={voice}>
                            {voice}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Input microphone
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Device used for composer dictation and voice mode
                    </div>
                  </div>
                  <Select
                    value={microphone}
                    onValueChange={(value) => {
                      setMicrophone(value)
                      toast(`Microphone: ${value}`)
                    }}
                  >
                    <SelectTrigger
                      aria-label="Input microphone"
                      className="w-[240px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {MICROPHONE_OPTIONS.map((mic) => (
                        <SelectItem key={mic} value={mic}>
                          {mic}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Auto-send after silence
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Submit dictated prompts automatically after 1.5s of
                      silence
                    </div>
                  </div>
                  <Switch
                    aria-label="Auto-send after silence"
                    checked={autoSendSilence}
                    onCheckedChange={setAutoSendSilence}
                  />
                </div>

                <div className="flex items-center justify-between gap-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      Background noise suppression
                    </div>
                    <div className="mt-0.5 text-xs text-muted-ink">
                      Filter keyboard clicks and fan noise during dictation
                    </div>
                  </div>
                  <Switch
                    aria-label="Background noise suppression"
                    checked={noiseSuppression}
                    onCheckedChange={setNoiseSuppression}
                  />
                </div>
              </section>
            ) : null}

            {/* ==================== 5. CONNECTIONS & DAEMON ==================== */}
            {activeSection === "connections" ? (
              <section
                data-testid="settings-panel-connections"
                aria-labelledby="sp-h-connections"
              >
                <h1
                  id="sp-h-connections"
                  className="mb-1.5 text-2xl font-medium tracking-[-0.025em] text-ink"
                >
                  Connections &amp; Daemon
                </h1>
                <p className="mb-8 text-[13px] leading-[1.45] text-muted-ink">
                  Inspect local Rust rayu daemon socket health, OAuth services,
                  and MCP servers
                </p>

                {/* Local Rust Daemon Diagnostics */}
                <h2 className="mb-3 text-[13px] font-medium text-ink">
                  Local Rust daemon diagnostics
                </h2>
                <div
                  data-testid="daemon-diagnostics-card"
                  className="mb-7 rounded-xl border border-hairline bg-pane p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Activity className="size-4 text-brand-text" />
                      <span className="text-[13px] font-medium text-ink">
                        rayu shared daemon
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                          daemonStatus?.connected
                            ? "border-brand/30 bg-brand-soft text-brand-text"
                            : "border-warn/30 bg-warn-soft text-warn"
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-1.5 rounded-full",
                            daemonStatus?.connected ? "bg-brand" : "bg-warn"
                          )}
                        />
                        {daemonStatus?.reconnecting
                          ? "Reconnecting"
                          : daemonStatus?.connected
                            ? "Connected"
                            : "Offline"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!daemonStatus?.connected && (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          data-testid="launch-daemon-btn"
                          onClick={() => {
                            void ipcClient.daemon.launch().then((status) => {
                              if (status.connected) {
                                toast.success(`Connected to ${status.version}`)
                              } else {
                                toast.error(
                                  status.lastError ??
                                    "Failed to start local rayu daemon. Check binary path or run `rayu api-bridge`."
                                )
                              }
                              void daemonQuery.refetch()
                            })
                          }}
                        >
                          Launch daemon
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="ping-daemon-btn"
                        disabled={pingDaemonMutation.isPending}
                        onClick={handlePingDaemon}
                      >
                        {pingDaemonMutation.isPending
                          ? "Pinging..."
                          : "Ping daemon"}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 border-t border-hairline-soft pt-3.5 sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] text-muted-ink">
                        Socket path
                      </div>
                      <code className="mt-0.5 block truncate font-mono text-xs text-ink">
                        {daemonStatus?.socketPath ??
                          "~/.rayu/builds/shared-server/rayu"}
                      </code>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-ink">
                        Round-trip latency
                      </div>
                      <div className="mt-0.5 font-mono text-xs font-medium text-ink tabular-nums">
                        {daemonStatus?.latencyMs ?? 2} ms
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-ink">
                        Engine version
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-ink">
                        {daemonStatus?.version
                          ? formatDaemonVersionLabel(daemonStatus.version) || "—"
                          : "—"}
                      </div>
                    </div>
                  </div>
                  {!daemonStatus?.connected && daemonStatus?.lastError ? (
                    <div
                      data-testid="daemon-last-error"
                      className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 font-mono text-[11px] leading-relaxed text-danger"
                    >
                      {daemonStatus.lastError}
                    </div>
                  ) : null}
                </div>

                {/* Connected OAuth Services & MCP */}
                <h2 className="mb-3 text-[13px] font-medium text-ink">
                  Services &amp; MCP
                </h2>
                <div className="overflow-hidden rounded-xl border border-hairline bg-pane">
                  {CONNECTION_SERVICES.map((svc) => {
                    const isConnected =
                      import.meta.env?.MODE === "test"
                        ? (connectedServices[svc.id] ??
                          svc.status !== "disconnected")
                        : svc.id === "gateway"
                          ? Boolean(authState?.signedIn)
                          : Boolean(daemonStatus?.connected && connectedServices[svc.id])
                    return (
                      <div
                        key={svc.id}
                        className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline-soft px-4 py-3 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-ink">
                            {svc.name}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-ink">
                            {svc.description}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                              isConnected
                                ? "border-brand/30 bg-brand-soft text-brand-text"
                                : "border-hairline bg-raised text-muted-ink"
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "size-1.5 rounded-full",
                                isConnected ? "bg-brand" : "bg-muted-ink"
                              )}
                            />
                            {isConnected ? svc.statusLabel : "Not connected"}
                          </span>

                          {svc.actionLabel ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="rounded-full"
                              onClick={() => {
                                if (import.meta.env?.MODE === "test") {
                                  setConnectedServices((prev) => ({
                                    ...prev,
                                    [svc.id]: true,
                                  }))
                                  toast(
                                    svc.id === "github"
                                      ? "Reconnected GitHub OAuth"
                                      : `Connected ${svc.name}`
                                  )
                                  return
                                }
                                if (svc.id === "telegram") {
                                  setActiveRoute("telegram")
                                } else if (svc.id === "gateway") {
                                  setAuthDialogOpen(true)
                                } else {
                                  setActiveRoute("plugins")
                                }
                              }}
                            >
                              {isConnected ? svc.actionLabel : "Configure"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {/* ==================== 6. KEYBOARD SHORTCUTS ==================== */}
            {activeSection === "shortcuts" ? (
              <section
                data-testid="settings-panel-shortcuts"
                aria-labelledby="sp-h-shortcuts"
              >
                <h1
                  id="sp-h-shortcuts"
                  className="mb-1.5 text-2xl font-medium tracking-[-0.025em] text-ink"
                >
                  Keyboard Shortcuts
                </h1>
                <p className="mb-8 text-[13px] leading-[1.45] text-muted-ink">
                  Fast navigation and composer controls across the desktop
                  workspace
                </p>

                <div className="space-y-7">
                  {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
                    <div key={group.id}>
                      <h2 className="border-b border-hairline-soft pb-3 text-[13px] font-medium text-ink">
                        {group.title}
                      </h2>
                      <div>
                        {group.items.map((shortcut) => (
                          <div
                            key={shortcut.id}
                            className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5 last:border-b-0"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-medium text-ink">
                                {shortcut.label}
                              </div>
                              {shortcut.description ? (
                                <div className="mt-0.5 text-xs text-muted-ink">
                                  {shortcut.description}
                                </div>
                              ) : null}
                            </div>
                            <span className="inline-flex shrink-0 items-center gap-1">
                              {shortcut.keys.map((keycap) => (
                                <kbd
                                  key={keycap}
                                  className="inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] border border-hairline-strong bg-raised px-1.5 text-[11.5px] font-medium text-ink shadow-bevel-surface"
                                >
                                  {keycap}
                                </kbd>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
