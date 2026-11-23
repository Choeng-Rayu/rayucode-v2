import { Folder, ListTodo, MessagesSquare } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  RIGHT_INSPECTOR_TABS,
  type RightInspectorTabItem,
} from "@/config/navigation"
import { ROUTES } from "@/config/routes"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

function InspectorTabIcon({ icon }: { icon: RightInspectorTabItem["icon"] }) {
  switch (icon) {
    case "list":
      return (
        <svg
          className="size-[15px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="4.5" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="17.5" r="1.15" fill="currentColor" stroke="none" />
          <path d="M8.5 6.5h11.5M8.5 12h11.5M8.5 17.5h11.5" />
        </svg>
      )
    case "terminal":
      return (
        <svg
          className="size-[15px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 6.5 6 5.5-6 5.5M12.5 17.5h7" />
        </svg>
      )
    case "diff":
      return (
        <svg
          className="size-[15px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="16" height="16" rx="3.5" />
          <path d="M12 7.5v5M9.5 10h5M9.5 15.8h5" />
        </svg>
      )
    case "globe":
      return (
        <svg
          className="size-[15px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5Z" />
        </svg>
      )
    case "folder":
      return (
        <svg
          className="size-[15px]"
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
      )
  }
}

export function MoreOptionsMenu({
  triggerClassName,
}: {
  triggerClassName?: string
}) {
  const keepAwake = useAppStore((s) => s.keepAwake)
  const setKeepAwake = useAppStore((s) => s.setKeepAwake)
  const toggleSideChat = useAppStore((s) => s.toggleSideChat)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const openDocPreview = useAppStore((s) => s.openDocPreview)

  const handleToggleKeepAwake = (checked: boolean) => {
    setKeepAwake(checked)
    void ipcClient.native.setKeepAwake(checked)
    toast(
      checked
        ? "Keeping computer awake for this session"
        : "Computer sleep timer restored"
    )
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              className={cn(
                "grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink",
                triggerClassName
              )}
            >
              <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="6" cy="12" r="1.25" fill="currentColor" />
                <circle cx="12" cy="12" r="1.25" fill="currentColor" />
                <circle cx="18" cy="12" r="1.25" fill="currentColor" />
              </svg>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">More</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-[244px] rounded-[16px] border border-premium bg-popover-solid p-2 shadow-rayu-2"
      >
        <DropdownMenuItem
          onClick={() => toggleSideChat()}
          className="rounded-lg px-2.5 py-2 text-[13.5px] text-ink"
        >
          <MessagesSquare
            className="size-4 text-body"
            strokeWidth={1.65}
            aria-hidden="true"
          />
          <span>Side chat</span>
          <span className="ml-auto font-mono text-[11.5px] text-muted-ink">
            ⌘;
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => setActiveRoute("automations")}
          className="rounded-lg px-2.5 py-2 text-[13.5px] text-ink"
        >
          <svg
            className="size-4 text-body"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m10 5 6 7-6 7-6-7 6-7Z" />
            <path d="m14.5 5 6 7-6 7" />
          </svg>
          <span>Background tasks</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => openDocPreview("markdown", "MIGRATION_PLAN.md")}
          className="rounded-lg px-2.5 py-2 text-[13.5px] text-ink"
        >
          <ListTodo
            className="size-4 text-body"
            strokeWidth={1.65}
            aria-hidden="true"
          />
          <span>Plan</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-2" />

        <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-hover">
          <div className="min-w-0">
            <div className="text-[13.5px] leading-snug text-ink">
              Keep computer awake
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-ink">
              Only for this session
            </div>
          </div>
          <Switch
            checked={keepAwake}
            onCheckedChange={handleToggleKeepAwake}
            aria-label="Keep computer awake"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SixIconStrip({ className }: { className?: string }) {
  const activeRightTab = useAppStore((s) => s.activeRightTab)
  const rightMode = useAppStore((s) => s.rightMode)
  const rightCollapsed = useAppStore((s) => s.rightCollapsed)
  const openRightTab = useAppStore((s) => s.openRightTab)
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)

  const isTabSelected = (tab: RightInspectorTabItem): boolean => {
    if (rightCollapsed) return false
    if (tab.id === "overview") return rightMode === "context"
    if (rightMode !== "document") return false
    if (activeRightTab === tab.id) return true
    if (
      tab.id === "files" &&
      (activeRightTab === "code" ||
        activeRightTab === "excel" ||
        activeRightTab === "markdown" ||
        activeRightTab === "slide" ||
        activeRightTab === "diagram")
    ) {
      return true
    }
    return false
  }

  const handleTabClick = (tab: RightInspectorTabItem) => {
    if (tab.id === "overview") {
      if (rightMode === "context" && !rightCollapsed) {
        toggleRightSidebar()
      } else {
        openRightTab("overview", null)
      }
      return
    }
    if (!rightCollapsed && rightMode === "document" && activeRightTab === tab.id) {
      toggleRightSidebar()
      return
    }
    openRightTab(tab.id, tab.pillLabel)
  }

  return (
    <div
      role="tablist"
      aria-label="Right sidebar panels"
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {RIGHT_INSPECTOR_TABS.map((tab) => {
        const isSelected = isTabSelected(tab)
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="tab"
                aria-label={tab.label}
                aria-selected={isSelected}
                onClick={() => handleTabClick(tab)}
                className={cn(
                  "grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] transition-colors",
                  isSelected
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <InspectorTabIcon icon={tab.icon} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="inline-flex items-center gap-2">
              <span>{tab.label}</span>
              {tab.shortcut ? (
                <kbd className="font-mono text-[10.5px] text-muted-ink">
                  {tab.shortcut}
                </kbd>
              ) : null}
            </TooltipContent>
          </Tooltip>
        )
      })}
      <MoreOptionsMenu />
    </div>
  )
}

export function TopBar() {
  const activeRoute = useAppStore((s) => s.activeRoute)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const activeSessionTitle = useAppStore((s) => s.activeSessionTitle)
  const leftCollapsed = useAppStore((s) => s.leftCollapsed)
  const rightCollapsed = useAppStore((s) => s.rightCollapsed)
  const rightMode = useAppStore((s) => s.rightMode)
  const navHistory = useAppStore((s) => s.navHistory)
  const navHistoryIndex = useAppStore((s) => s.navHistoryIndex)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const goBack = useAppStore((s) => s.goBack)
  const goForward = useAppStore((s) => s.goForward)
  const openRightTab = useAppStore((s) => s.openRightTab)

  const canGoBack = navHistoryIndex > 0
  const canGoForward = navHistoryIndex < navHistory.length - 1

  const routeMeta = ROUTES[activeRoute] ?? ROUTES.home
  const sessionTitle =
    activeRoute === "workspace"
      ? activeSessionTitle ??
        (activeSessionId === "ses_q4_excel"
          ? "Q4 token cost spreadsheet"
          : activeSessionId === "ses_model_picker"
            ? "VS Code: model picker refresh"
            : activeSessionId === "ses_retire_cache"
              ? "Retire legacy session cache"
              : "Active session")
      : routeMeta.title

  const isCleanHomeHeader = activeRoute === "home" && rightCollapsed
  const showCenterStrip =
    routeMeta.hasRightInspector &&
    !isCleanHomeHeader &&
    (rightMode === "document" || rightCollapsed)

  return (
    <header
      className={cn(
        "@container/topbar flex h-[46px] shrink-0 items-center gap-1.5 border-b border-hairline bg-canvas pr-2.5 select-none",
        leftCollapsed ? "pl-2" : "pl-3.5"
      )}
    >
      {leftCollapsed && (
        <div className="mr-1.5 inline-flex shrink-0 items-center gap-1">
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
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>Back</span>
              <kbd className="ml-1.5 font-mono text-[10.5px] text-muted-ink">
                ⌘[
              </kbd>
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
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>Forward</span>
              <kbd className="ml-1.5 font-mono text-[10.5px] text-muted-ink">
                ⌘]
              </kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="New chat"
                onClick={() => {
                  setActiveSession(null)
                  setActiveRoute("home")
                }}
                className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
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
                  <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
                  <path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-4 1 1-4 9.5-9.5Z" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New chat</TooltipContent>
          </Tooltip>
        </div>
      )}

      <button
        type="button"
        onClick={() => toast(`Session: ${sessionTitle}`)}
        className="inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] px-1.5 py-1 text-[13.5px] font-medium tracking-tight text-ink transition-colors hover:bg-hover"
      >
        {activeRoute === "workspace" && (
          <Folder
            className="size-[15px] shrink-0 text-muted-ink"
            strokeWidth={1.6}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{sessionTitle}</span>
        {!leftCollapsed && (
          <svg
            className="size-3 shrink-0 text-muted-ink"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        {isCleanHomeHeader && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Open terminal"
                  onClick={() => openRightTab("terminal", "Terminal")}
                  className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <InspectorTabIcon icon="terminal" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Terminal</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Open files and previews"
                  onClick={() => openRightTab("files", "Files")}
                  className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <InspectorTabIcon icon="folder" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Files</TooltipContent>
            </Tooltip>
          </>
        )}

        {showCenterStrip && <SixIconStrip />}
        {!routeMeta.hasRightInspector && <MoreOptionsMenu />}
      </div>
    </header>
  )
}

export function RightSidebarTopBar() {
  const rightMode = useAppStore((s) => s.rightMode)
  const activeRightTab = useAppStore((s) => s.activeRightTab)
  const activeDocPill = useAppStore((s) => s.activeDocPill)
  const openDocTabs = useAppStore((s) => s.openDocTabs)
  const fullView = useAppStore((s) => s.fullView)
  const openRightTab = useAppStore((s) => s.openRightTab)
  const closeDocumentToContext = useAppStore((s) => s.closeDocumentToContext)
  const setFullView = useAppStore((s) => s.setFullView)
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)
  const addSlide = useAppStore((s) => s.addSlide)

  const currentPill = activeDocPill ?? "lookup.rs"
  const backgroundTabs = openDocTabs
    .filter((t) => t.pill !== currentPill)
    .slice(-1)

  return (
    <div className="flex h-[46px] shrink-0 items-center gap-1.5 border-b border-hairline bg-canvas px-3 select-none">
      {rightMode === "context" ? (
        <div className="ml-auto flex items-center">
          <SixIconStrip />
        </div>
      ) : (
        <>
          {fullView && (
            <button
              type="button"
              onClick={() => setFullView(false)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-hairline bg-raised px-2 py-1 text-xs text-body hover:bg-hover hover:text-ink"
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
              className="inline-flex h-7 max-w-[180px] cursor-pointer items-center gap-2 rounded-[7px] px-2 text-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <span className="truncate">{bgTab.pill}</span>
              <span className="font-mono text-[10px] opacity-70">
                ⌘{idx + 1}
              </span>
            </button>
          ))}

          <div className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-[7px] bg-active pr-1.5 pl-2.5 text-[13px] font-medium text-ink">
            <span className="truncate" data-testid="active-doc-pill">
              {currentPill}
            </span>
            {backgroundTabs.length > 0 ? (
              <span className="font-mono text-[10px] text-muted-ink">
                ⌘{backgroundTabs.length + 1}
              </span>
            ) : null}
            <button
              type="button"
              aria-label="Close document"
              title="Back to Context"
              onClick={closeDocumentToContext}
              className="grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <svg
                className="size-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          {activeRightTab === "slide" ? (
            <button
              type="button"
              aria-label="Add slide tab"
              title="Add new slide"
              onClick={() => {
                addSlide()
                toast("Added new slide")
              }}
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <svg
                className="size-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          ) : null}

          <span className="flex-1" />

          {fullView ? (
            <button
              type="button"
              onClick={() => setFullView(false)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-hairline bg-raised px-2.5 py-1 text-xs font-medium text-ink hover:bg-active"
            >
              <svg
                className="size-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.65"
                aria-hidden="true"
              >
                <path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6" />
              </svg>
              <span>Exit full view</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Full view"
                    onClick={() => setFullView(true)}
                    className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                  >
                    <svg
                      className="size-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.65"
                      aria-hidden="true"
                    >
                      <path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Full view</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Close sidebar"
                    onClick={toggleRightSidebar}
                    className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                  >
                    <svg
                      className="size-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.65"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Close</TooltipContent>
              </Tooltip>
            </div>
          )}
        </>
      )}
    </div>
  )
}
