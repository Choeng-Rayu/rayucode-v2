import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { RIGHT_INSPECTOR_TABS, type RightInspectorTabItem } from "@/config/navigation"
import { ROUTES } from "@/config/routes"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

function InspectorTabIcon({ icon }: { icon: RightInspectorTabItem["icon"] }) {
  switch (icon) {
    case "list":
      return (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
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
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
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
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
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
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
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
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l1.8 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9.5Z" />
        </svg>
      )
  }
}

export function MoreOptionsMenu({ triggerClassName }: { triggerClassName?: string }) {
  const theme = useAppStore((s) => s.theme)
  const accent = useAppStore((s) => s.accent)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setAccent = useAppStore((s) => s.setAccent)
  const openDocPreview = useAppStore((s) => s.openDocPreview)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              className={cn(
                "grid h-8 w-[34px] cursor-pointer place-items-center rounded-[9px] border border-transparent text-body transition-all hover:border-hairline hover:bg-hover hover:text-ink data-[state=open]:border-premium data-[state=open]:bg-active data-[state=open]:text-ink data-[state=open]:shadow-bevel-surface",
                triggerClassName
              )}
            >
              <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5.5" cy="12" r="1.35" fill="currentColor" />
                <circle cx="12" cy="12" r="1.35" fill="currentColor" />
                <circle cx="18.5" cy="12" r="1.35" fill="currentColor" />
              </svg>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">More</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Session &amp; View</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            toggleTheme()
          }}
        >
          <span>
            Theme: {theme === "dark" ? "Dark" : "Light"} (Toggle Light / Dark)
          </span>
        </DropdownMenuItem>

        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-body">
          <span>Accent</span>
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              aria-pressed={accent === "green"}
              onClick={() => {
                setAccent("green")
                toast("Accent color: Rayu Green")
              }}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                accent === "green"
                  ? "border-brand bg-brand-soft text-ink"
                  : "border-hairline bg-inset text-body hover:border-premium-hi hover:text-ink"
              )}
            >
              <span className="size-2 rounded-full bg-brand" />
              <span>Rayu Green</span>
            </button>
            <button
              type="button"
              aria-pressed={accent === "blue"}
              onClick={() => {
                setAccent("blue")
                toast("Accent color: Ocean Blue")
              }}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                accent === "blue"
                  ? "border-brand bg-brand-soft text-ink"
                  : "border-hairline bg-inset text-body hover:border-premium-hi hover:text-ink"
              )}
            >
              <span className="size-2 rounded-full bg-info" />
              <span>Ocean Blue</span>
            </button>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => openDocPreview("browser", "localhost:3000")}
        >
          <span>Full Browser Preview</span>
          <span className="ml-auto font-mono text-[10px] text-muted-ink">
            :3000
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            openDocPreview("excel", "Q4-Token-Cost-Model.xlsx")
          }
        >
          <span>Microsoft Excel Session</span>
          <span className="ml-auto font-mono text-[10px] text-muted-ink">
            .xlsx
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => openDocPreview("markdown", "MIGRATION_PLAN.md")}
        >
          <span>Full Preview MD</span>
          <span className="ml-auto font-mono text-[10px] text-muted-ink">
            .md
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openDocPreview("slide", "Slide")}>
          <span>PowerPoint Slide Studio</span>
          <span className="ml-auto font-mono text-[10px] text-muted-ink">
            .pptx
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => openDocPreview("diagram", "Architecture Flowchart")}
        >
          <span>Flowchart Diagram Preview</span>
          <span className="ml-auto font-mono text-[10px] text-muted-ink">
            .mmd
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            void ipcClient.native.openInVSCode("~/workspace/rayu/rayucode-v2")
            toast("Opened ~/workspace/rayu/rayucode-v2 in Visual Studio Code")
          }}
        >
          <span>Open in VS Code</span>
          <span className="ml-auto font-mono text-[10px] text-muted-ink">
            external
          </span>
        </DropdownMenuItem>
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

  const handleTabClick = (tab: RightInspectorTabItem) => {
    if (tab.id === "overview") {
      if (rightMode === "context" && !rightCollapsed) {
        toggleRightSidebar()
      } else {
        openRightTab("overview", null)
      }
      return
    }
    openRightTab(tab.id, tab.pillLabel)
  }

  return (
    <div
      role="tablist"
      aria-label="Right sidebar panels"
      className={cn("inline-flex items-center gap-1", className)}
    >
      {RIGHT_INSPECTOR_TABS.map((tab) => {
        const isSelected =
          !rightCollapsed &&
          ((tab.id === "overview" && rightMode === "context") ||
            (rightMode === "document" && activeRightTab === tab.id) ||
            (tab.id === "files" &&
              rightMode === "document" &&
              (activeRightTab === "excel" ||
                activeRightTab === "markdown" ||
                activeRightTab === "slide" ||
                activeRightTab === "diagram")))
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
                  "grid h-8 w-[34px] cursor-pointer place-items-center rounded-[9px] border transition-all",
                  isSelected
                    ? "border-premium bg-active text-ink shadow-bevel-surface"
                    : "border-transparent text-body hover:border-hairline hover:bg-hover hover:text-ink"
                )}
              >
                <InspectorTabIcon icon={tab.icon} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tab.label}</TooltipContent>
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
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const openRightTab = useAppStore((s) => s.openRightTab)

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

  // On Home with collapsed right sidebar, match prototype/index.html calm actions (Theme, Terminal, Files).
  const isCleanHomeHeader = activeRoute === "home" && rightCollapsed
  const showCenterStrip =
    routeMeta.hasRightInspector &&
    !isCleanHomeHeader &&
    (rightMode === "document" || rightCollapsed)

  return (
    <header
      className={cn(
        "flex h-[46px] shrink-0 items-center gap-2.5 bg-canvas pr-4 select-none",
        leftCollapsed ? "pl-2" : "pl-[18px]",
        activeRoute !== "home" && "border-b border-hairline"
      )}
    >
      {/* Inline < > New-chat controls when left sidebar is collapsed */}
      {leftCollapsed && (
        <div className="mr-1.5 inline-flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Back"
            onClick={() => setActiveRoute("home")}
            className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-ink hover:bg-hover hover:text-ink"
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="New chat"
            onClick={() => {
              setActiveSession(null)
              setActiveRoute("home")
            }}
            className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-ink hover:bg-hover hover:text-ink"
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              aria-hidden="true"
            >
              <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
              <path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-4 1 1-4 9.5-9.5Z" />
            </svg>
          </button>
        </div>
      )}

      {/* Session / Route Title button */}
      <button
        type="button"
        onClick={() => toast(`Session: ${sessionTitle}`)}
        className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-sm font-medium tracking-tight text-ink transition-colors hover:bg-hover"
      >
        <span className="truncate">{sessionTitle}</span>
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
      </button>

      <div className="flex-1" />

      {/* Dual-mode 6-icon strip & utility actions */}
      <div className="flex items-center gap-1.5">
        {isCleanHomeHeader && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Open terminal"
                  onClick={() => openRightTab("terminal", "rayu daemon")}
                  className="grid size-7 cursor-pointer place-items-center rounded-sm border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
                >
                  <InspectorTabIcon icon="terminal" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">CLI Terminal</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Open files and previews"
                  onClick={() => openRightTab("files", "MIGRATION_PLAN.md")}
                  className="grid size-7 cursor-pointer place-items-center rounded-sm border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
                >
                  <InspectorTabIcon icon="folder" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Files &amp; Previews</TooltipContent>
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
    <div className="flex h-[46px] shrink-0 items-center gap-1.5 border-b border-hairline bg-chrome px-3 select-none">
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

          {/* Background open doc tab (e.g. template_following.md ⌘1) matching Screenshot 2 */}
          {backgroundTabs.map((bgTab, idx) => (
            <button
              key={bgTab.pill}
              type="button"
              onClick={() => openRightTab(bgTab.tab, bgTab.pill)}
              className="inline-flex h-[30px] max-w-[180px] cursor-pointer items-center gap-2 rounded-[9px] px-2.5 text-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <span className="truncate">{bgTab.pill}</span>
              <span className="font-mono text-[10px] opacity-70">
                ⌘{idx + 1}
              </span>
            </button>
          ))}

          {/* Active document pill (e.g. Slide ⌘2 × or lookup.rs ×) */}
          <div className="rayu-surface-bevel inline-flex h-[30px] max-w-[240px] items-center gap-2 rounded-[9px] bg-active pr-2 pl-3 text-[13px] font-medium text-ink italic">
            <span className="truncate not-italic" data-testid="active-doc-pill">
              {currentPill}
            </span>
            {backgroundTabs.length > 0 ? (
              <span className="font-mono text-[10px] not-italic text-muted-ink">
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
              className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
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
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-premium bg-raised px-2.5 py-1 text-xs font-medium text-ink shadow-bevel-surface hover:bg-active"
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
            <div className="inline-flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Full view"
                    onClick={() => setFullView(true)}
                    className="grid size-[30px] cursor-pointer place-items-center rounded-sm border border-transparent text-body transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
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
                    className="grid size-[30px] cursor-pointer place-items-center rounded-sm border border-transparent text-body transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
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
                <TooltipContent side="bottom">Close sidebar</TooltipContent>
              </Tooltip>
            </div>
          )}
        </>
      )}
    </div>
  )
}
