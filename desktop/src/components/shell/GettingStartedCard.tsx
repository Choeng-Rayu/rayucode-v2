import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronDown,
  Code2,
  EyeOff,
  ListChecks,
  MoreHorizontal,
} from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { BrandLogo } from "@/features/plugins"
import { useAppStore } from "@/lib/app-store"
import { ipcClient, type GettingStartedItem } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

interface ImportAppSource {
  id: string
  name: string
  icon: "code" | "cowork"
  enabled: boolean
}

const IMPORT_SYNC_STORAGE_KEY = "rayu-import-ai-apps-v1"
const GETTING_STARTED_COLLAPSED_KEY = "rayu-getting-started-collapsed-v1"
const IS_TEST_ENV = import.meta.env?.MODE === "test"

function loadGettingStartedCollapsed(): boolean {
  if (IS_TEST_ENV || typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(GETTING_STARTED_COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

function loadSavedImportSources(): {
  sources: ImportAppSource[]
  keepInSync: boolean
} {
  const defaults: ImportAppSource[] = [
    { id: "claude-code", name: "Claude Code", icon: "code", enabled: true },
    { id: "claude-cowork", name: "Claude Cowork", icon: "cowork", enabled: true },
  ]
  if (typeof window === "undefined") {
    return { sources: defaults, keepInSync: true }
  }
  try {
    const raw = window.localStorage.getItem(IMPORT_SYNC_STORAGE_KEY)
    if (!raw) return { sources: defaults, keepInSync: true }
    const parsed = JSON.parse(raw) as {
      enabledIds?: string[]
      keepInSync?: boolean
    }
    const enabledSet = new Set(parsed.enabledIds ?? ["claude-code", "claude-cowork"])
    return {
      sources: defaults.map((s) => ({ ...s, enabled: enabledSet.has(s.id) })),
      keepInSync: parsed.keepInSync ?? true,
    }
  } catch {
    return { sources: defaults, keepInSync: true }
  }
}

function StepRightBadge({ badge }: { badge?: GettingStartedItem["badge"] }) {
  switch (badge) {
    case "github":
      return (
        <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
          <BrandLogo name="github" variant="glyph" className="size-4" />
        </span>
      )
    case "linear":
      return (
        <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
          <BrandLogo name="linear" variant="glyph" className="size-4" />
        </span>
      )
    case "gdrive":
      return (
        <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
          <BrandLogo name="google-drive" variant="glyph" className="size-4" />
        </span>
      )
    default:
      return null
  }
}

export function GettingStartedCard() {
  const queryClient = useQueryClient()
  const daemonMode = useAppStore((s) => s.daemonMode)
  const gettingStartedHidden = useAppStore((s) => s.gettingStartedHidden)
  const setGettingStartedHidden = useAppStore((s) => s.setGettingStartedHidden)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const setPendingStreamPrompt = useAppStore((s) => s.setPendingStreamPrompt)

  const [items, setItems] = React.useState<GettingStartedItem[]>([])
  const [collapsed, setCollapsed] = React.useState<boolean>(
    loadGettingStartedCollapsed
  )
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [importState, setImportState] = React.useState(loadSavedImportSources)

  const handleToggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      if (!IS_TEST_ENV && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            GETTING_STARTED_COLLAPSED_KEY,
            next ? "1" : "0"
          )
        } catch {
          // ignore storage errors
        }
      }
      return next
    })
  }, [])

  React.useEffect(() => {
    void ipcClient.sessions.getGettingStarted().then(setItems)
  }, [daemonMode])

  if (gettingStartedHidden) {
    return null
  }

  const doneCount = items.filter((g) => g.completed).length
  const totalCount = Math.max(1, items.length)
  const pct = Math.round((doneCount / totalCount) * 100)

  const markItemState = async (id: string, forceCompleted?: boolean) => {
    const updated = await ipcClient.sessions.toggleGettingStarted(
      id,
      forceCompleted
    )
    setItems(updated)
  }

  const handleHideSetup = () => {
    setGettingStartedHidden(true)
    toast("Getting started hidden", {
      action: {
        label: "Undo",
        onClick: () => setGettingStartedHidden(false),
      },
    })
  }

  const handleRunItemAction = async (item: GettingStartedItem) => {
    switch (item.badge) {
      case "claude": {
        setImportDialogOpen(true)
        return
      }
      case "notifications": {
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          typeof window.Notification?.requestPermission === "function" &&
          window.Notification.permission === "default"
        ) {
          try {
            await window.Notification.requestPermission()
          } catch {
            // ignore permission errors in non-interactive shells
          }
        }
        await ipcClient.settings.updatePreferences({
          notificationsEnabled: true,
        })
        void queryClient.invalidateQueries({ queryKey: ["settings"] })
        await markItemState(item.id, true)
        toast("Desktop notifications enabled")
        return
      }
      case "daily": {
        setActiveRoute("automations")
        await markItemState(item.id, true)
        toast("Opened Automations — configure a daily or overnight update")
        return
      }
      case "github": {
        setActiveRoute("changes")
        await markItemState(item.id, true)
        toast("Opened Changes to triage diffs and GitHub PRs")
        return
      }
      case "linear": {
        setActiveRoute("plugins")
        await markItemState(item.id, true)
        toast("Opened Plugins & Connectors to connect Linear")
        return
      }
      case "gdrive": {
        const prompt =
          "Review the latest project decisions in this workspace and summarize key changes, open risks, and next steps."
        const created = await ipcClient.sessions.createSession({
          prompt,
          modelLabel: "Auto",
        })
        setActiveSession(created.id, "Review the latest project decisions")
        setPendingStreamPrompt({
          sessionId: created.id,
          prompt,
          modelLabel: "Auto",
        })
        void queryClient.invalidateQueries({ queryKey: ["sessions"] })
        await markItemState(item.id, true)
        return
      }
      default: {
        await markItemState(item.id)
      }
    }
  }

  const handleConfirmImport = async () => {
    const enabledSources = importState.sources.filter((s) => s.enabled)
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          IMPORT_SYNC_STORAGE_KEY,
          JSON.stringify({
            enabledIds: enabledSources.map((s) => s.id),
            keepInSync: importState.keepInSync,
          })
        )
      } catch {
        // ignore storage errors
      }
    }
    setImportDialogOpen(false)
    await markItemState("gs_import_ai", true)
    if (enabledSources.length === 0) {
      toast("No external AI apps selected for import")
    } else {
      const names = enabledSources.map((s) => s.name).join(" and ")
      toast(
        importState.keepInSync
          ? `Imported & syncing from ${names}`
          : `Imported settings from ${names}`
      )
    }
  }

  return (
    <>
      <section
        aria-label="Getting started"
        data-testid="getting-started-card"
        className="rayu-card-bevel mt-1.5 shrink-0 rounded-[16px] bg-pane px-3 pt-2.5 pb-2.5"
      >
        {/* Header Row: Getting started  [0 of 6]  [⋯] [⌄] */}
        <div className="mb-2 flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
            Getting started
          </span>

          <span className="mr-0.5 font-mono text-[11px] text-muted-ink tabular-nums">
            {doneCount} of {items.length}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Getting started options"
                className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
              >
                <MoreHorizontal
                  className="size-3.5"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="w-40 rounded-2xl border border-premium bg-popover-solid p-1.5 shadow-rayu-2"
            >
              <DropdownMenuItem
                onClick={handleHideSetup}
                className="rounded-xl px-2.5 py-2 text-[13px] text-ink"
              >
                <EyeOff
                  className="size-3.5 text-muted-ink"
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
                <span>Hide setup</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            aria-label={
              collapsed ? "Expand getting started" : "Collapse getting started"
            }
            aria-expanded={!collapsed}
            onClick={handleToggleCollapsed}
            className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform duration-150",
                collapsed && "-rotate-90"
              )}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="h-[3.5px] overflow-hidden rounded-full bg-active">
          <span
            className="block h-full rounded-full bg-brand transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Checklist Items */}
        {!collapsed && (
          <div className="mt-2.5 flex flex-col gap-0.5">
            {items.map((item) => (
              <div
                key={item.id}
                className="group flex items-start gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-hover"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.completed}
                  aria-label={`Mark "${item.label}" ${item.completed ? "incomplete" : "complete"}`}
                  onClick={() => void markItemState(item.id)}
                  className={cn(
                    "mt-0.5 grid size-[15px] shrink-0 cursor-pointer place-items-center rounded-full border transition-colors",
                    item.completed
                      ? "border-brand bg-brand text-brand-ink"
                      : "border-hairline-strong bg-transparent hover:border-brand"
                  )}
                >
                  {item.completed && (
                    <Check
                      className="size-2.5"
                      strokeWidth={2.75}
                      aria-hidden="true"
                    />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void handleRunItemAction(item)}
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[12.5px] leading-snug transition-colors",
                    item.completed
                      ? "text-muted-ink line-through"
                      : "text-ink group-hover:text-ink"
                  )}
                >
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <StepRightBadge badge={item.badge} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Import from other AI apps Dialog (matching reference screenshot) */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent
          data-testid="import-ai-apps-dialog"
          className="max-w-[492px] gap-4 rounded-[22px] border border-premium bg-popover-solid p-6 shadow-rayu-2"
        >
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="text-[18px] font-semibold tracking-tight text-ink">
              Import from other AI apps
            </DialogTitle>
            <DialogDescription className="pt-1 text-xs font-medium text-muted-ink">
              Apps found
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {importState.sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center gap-3.5 rounded-2xl border border-hairline-soft bg-inset px-4 py-3.5"
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-tech-rs-bg text-tech-rs-fg"
                >
                  {source.icon === "code" ? (
                    <Code2 className="size-5" strokeWidth={1.85} />
                  ) : (
                    <ListChecks className="size-5" strokeWidth={1.85} />
                  )}
                </span>

                <span className="min-w-0 flex-1 text-[14.5px] font-medium text-ink">
                  {source.name}
                </span>

                <Switch
                  checked={source.enabled}
                  aria-label={`Import from ${source.name}`}
                  onCheckedChange={(checked) =>
                    setImportState((prev) => ({
                      ...prev,
                      sources: prev.sources.map((s) =>
                        s.id === source.id ? { ...s, enabled: checked } : s
                      ),
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <label className="mt-1 flex cursor-pointer items-center justify-between gap-4 select-none">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-ink">
                Keep imports in sync
              </div>
              <div className="mt-0.5 text-xs text-muted-ink">
                Automatically sync new and updated content from connected
                sources
              </div>
            </div>
            <button
              type="button"
              role="checkbox"
              aria-checked={importState.keepInSync}
              aria-label="Keep imports in sync"
              onClick={() =>
                setImportState((prev) => ({
                  ...prev,
                  keepInSync: !prev.keepInSync,
                }))
              }
              className={cn(
                "grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] border transition-colors",
                importState.keepInSync
                  ? "border-hairline-strong bg-active text-ink"
                  : "border-hairline-strong bg-transparent text-transparent"
              )}
            >
              <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </label>

          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setImportDialogOpen(false)}
              className="cursor-pointer rounded-full px-4 py-2 text-[13px] font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmImport()}
              className="cursor-pointer rounded-full bg-ink px-5 py-2 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90"
            >
              Continue
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
