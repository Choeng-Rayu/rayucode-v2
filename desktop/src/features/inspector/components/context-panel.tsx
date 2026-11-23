import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  FileDiff,
  FileSpreadsheet,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Monitor,
  Presentation,
  Settings,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { useContextStats } from "../hooks/use-context-stats"
import type { InspectorOutputKind } from "../types"

function OutputKindIcon({ kind }: { kind: InspectorOutputKind }) {
  switch (kind) {
    case "browser":
      return (
        <Globe
          className="size-3.5 shrink-0 text-info"
          strokeWidth={1.65}
          aria-hidden="true"
        />
      )
    case "excel":
      return (
        <FileSpreadsheet
          className="size-3.5 shrink-0 text-office-excel"
          strokeWidth={1.65}
          aria-hidden="true"
        />
      )
    case "markdown":
      return (
        <FileText
          className="size-3.5 shrink-0 text-code-type"
          strokeWidth={1.65}
          aria-hidden="true"
        />
      )
    case "slide":
      return (
        <Presentation
          className="size-3.5 shrink-0 text-office-ppt"
          strokeWidth={1.65}
          aria-hidden="true"
        />
      )
  }
}

export interface ContextPanelProps {
  className?: string
}

export function ContextPanel({ className }: ContextPanelProps) {
  const {
    data: inspector,
    isLoading,
    isError,
    error,
    refetch,
    segments,
    primaryConnectors,
    secondaryConnectors,
  } = useContextStats()

  const [expandedRowIds, setExpandedRowIds] = React.useState<
    Record<string, boolean>
  >({})
  const [expandedDiscIds, setExpandedDiscIds] = React.useState<
    Record<string, boolean>
  >({})
  const [showMoreConnectors, setShowMoreConnectors] = React.useState(false)

  const queryClient = useQueryClient()
  const openCodeFile = useAppStore((s) => s.openCodeFile)
  const setActiveWorkspacePath = useAppStore((s) => s.setActiveWorkspacePath)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)

  if (isLoading) {
    return <ContextSkeleton />
  }

  if (isError || !inspector) {
    return (
      <div className="p-4">
        <ErrorState
          title="Unable to load session context"
          description={
            error instanceof Error
              ? error.message
              : "Could not read context statistics from the RayuCode daemon."
          }
          actionLabel="Retry"
          onRetry={() => {
            void refetch()
          }}
        />
      </div>
    )
  }

  const toggleRow = (id: string) => {
    setExpandedRowIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleDisc = (id: string) => {
    setExpandedDiscIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const visibleConnectors = showMoreConnectors
    ? [...primaryConnectors, ...secondaryConnectors]
    : primaryConnectors

  return (
    <ScrollArea className={cn("min-h-0 flex-1 bg-canvas", className)}>
      <div className="flex flex-col divide-y divide-hairline-soft">
        {/* Environment */}
        <section aria-label="Environment" className="px-[18px] py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[12.5px] font-medium text-muted-ink">
              Environment
            </h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Environment settings"
                  onClick={() => setActiveRoute("settings")}
                  className="grid size-6 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
                >
                  <Settings
                    className="size-3.5"
                    strokeWidth={1.65}
                    aria-hidden="true"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Environment settings</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-col gap-2.5 text-[13px] text-ink">
            <div className="flex min-w-0 items-center gap-2.5">
              <Monitor
                className="size-[15px] shrink-0 text-muted-ink"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">
                {inspector.environment.host}
              </span>
              <button
                type="button"
                onClick={() => {
                  void ipcClient.workspace.pickFolder().then((picked) => {
                    if (!picked) return
                    setActiveWorkspacePath(picked.path)
                    void queryClient.invalidateQueries({ queryKey: ["inspector"] })
                    void queryClient.invalidateQueries({ queryKey: ["changes"] })
                    void queryClient.invalidateQueries({ queryKey: ["plugins"] })
                    toast(`Switched workspace to ${picked.project}`)
                  })
                }}
                className="shrink-0 cursor-pointer text-xs text-muted-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-ink"
              >
                Switch
              </button>
            </div>

            <div className="flex min-w-0 items-center gap-2.5">
              <Folder
                className="size-[15px] shrink-0 text-muted-ink"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-ink">
                {inspector.environment.project}{" "}
                <span className="text-muted-ink">
                  · {inspector.environment.path}
                </span>
              </span>
            </div>

            <div className="flex min-w-0 items-center gap-2.5">
              <GitBranch
                className="size-[15px] shrink-0 text-muted-ink"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <span className="truncate font-mono text-[12.5px] text-body">
                {inspector.environment.branch}
              </span>
            </div>
          </div>
        </section>

        {/* Context */}
        <section aria-label="Context" className="px-[18px] py-4">
          <h2 className="mb-3 text-[12.5px] font-medium text-muted-ink">
            Context
          </h2>

          <div className="mb-2 flex items-baseline justify-between text-[13px]">
            <span className="font-medium text-ink">
              {inspector.context.usedPctLabel}
            </span>
            <span className="font-mono text-xs text-muted-ink tabular-nums">
              {inspector.context.tokensSummary}
            </span>
          </div>

          {/* Multi-segment progress bar */}
          <div
            role="img"
            aria-label={`Context window breakdown: ${inspector.context.usedPctLabel} (${inspector.context.tokensSummary})`}
            className="mb-4 flex h-[4px] items-center gap-[2px] overflow-hidden rounded-full bg-active"
          >
            {segments.map((seg) => (
              <span
                key={seg.id}
                title={seg.label}
                style={{ width: `${seg.widthPct}%` }}
                className={cn("h-full min-w-[3px] rounded-full", seg.colorClass)}
              />
            ))}
          </div>

          {/* Primary breakdown rows (interactive dotted-underline triggers) */}
          <div className="flex flex-col gap-2">
            {inspector.context.rows.map((row) => {
              const isExpanded = Boolean(expandedRowIds[row.id])
              const panelId = `ctx-detail-${row.id}`
              return (
                <React.Fragment key={row.id}>
                  <div className="grid grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2.5 text-[12.5px] text-body">
                    <span
                      className={cn(
                        "size-[8px] shrink-0 rounded-[2px]",
                        row.colorClass
                      )}
                      aria-hidden="true"
                    />
                    {row.dotted ? (
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        onClick={() => toggleRow(row.id)}
                        className={cn(
                          "cursor-pointer justify-self-start truncate border-b border-dotted pb-px text-left transition-colors",
                          isExpanded
                            ? "border-brand-text text-ink"
                            : "border-faint text-body hover:border-muted-ink hover:text-ink"
                        )}
                      >
                        {row.label}
                      </button>
                    ) : (
                      <span className="truncate text-body">{row.label}</span>
                    )}
                    <span className="text-right font-mono text-xs text-muted-ink tabular-nums">
                      {row.tokensLabel}
                    </span>
                    <span className="text-right font-mono text-xs text-ink tabular-nums">
                      {row.pctLabel}
                    </span>
                  </div>

                  {row.dotted && isExpanded && row.items && (
                    <div
                      id={panelId}
                      data-testid={`ctx-breakdown-${row.id}`}
                      className="my-1 ml-[19px] flex flex-col gap-1.5 rounded-lg border border-hairline bg-inset px-2.5 py-2 text-[11.5px]"
                    >
                      {row.items.map((sub) => (
                        <div
                          key={sub.key}
                          className="flex items-center justify-between gap-2 text-body"
                        >
                          <span className="truncate">{sub.key}</span>
                          <span className="shrink-0 font-mono text-[11px] text-muted-ink tabular-nums">
                            {sub.tokens}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              )
            })}
          </div>

          {/* Buffer & Free space */}
          <div className="mt-4 flex flex-col gap-2">
            {[inspector.context.bufferRow, inspector.context.freeRow].map(
              (row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2.5 text-[12.5px] text-muted-ink"
                >
                  <span
                    className={cn(
                      "size-[8px] shrink-0 rounded-[2px]",
                      row.colorClass
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{row.label}</span>
                  <span className="text-right font-mono text-xs text-muted-ink tabular-nums">
                    {row.tokensLabel}
                  </span>
                  <span className="text-right font-mono text-xs text-body tabular-nums">
                    {row.pctLabel}
                  </span>
                </div>
              )
            )}
          </div>

          {/* Bottom disclosures */}
          <div className="mt-4 flex flex-col gap-0.5">
            {inspector.context.disclosures.map((disc) => {
              const isOpen = Boolean(expandedDiscIds[disc.id])
              const bodyId = `ctx-disc-body-${disc.id}`
              return (
                <div key={disc.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    aria-label={`${disc.label} (${disc.count})`}
                    onClick={() => toggleDisc(disc.id)}
                    className="-mx-1.5 flex w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12.5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 shrink-0 text-faint transition-transform duration-150",
                        isOpen && "rotate-90"
                      )}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span>{disc.label}</span>
                    <span className="ml-auto font-mono text-xs text-muted-ink tabular-nums">
                      {disc.count}
                    </span>
                  </button>
                  {isOpen && (
                    <div
                      id={bodyId}
                      className="flex flex-col gap-1 py-1 pl-[22px] font-mono text-[11px] text-muted-ink"
                    >
                      {disc.items.map((item) => (
                        <span key={item} className="truncate">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Connectors */}
        <section aria-label="Connectors" className="px-[18px] py-4">
          <h2 className="mb-3 text-[12.5px] font-medium text-muted-ink">
            Connectors
          </h2>
          {visibleConnectors.length === 0 ? (
            <p className="text-xs text-faint">
              No MCP connectors configured in{" "}
              <code className="font-mono text-[11px]">~/.rayu/mcp.json</code>.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {visibleConnectors.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center gap-2.5 text-[13px] text-ink"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-active font-mono text-[10.5px] font-medium text-muted-ink"
                  >
                    {conn.glyph}
                  </span>
                  <span className="truncate">{conn.name}</span>
                  {conn.status && (
                    <button
                      type="button"
                      onClick={() => setActiveRoute("plugins")}
                      className={cn(
                        "ml-auto shrink-0 cursor-pointer text-xs font-medium hover:underline",
                        conn.status === "Linked"
                          ? "text-brand-text"
                          : "text-warn"
                      )}
                    >
                      {conn.status}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {secondaryConnectors.length > 0 && (
            <button
              type="button"
              aria-expanded={showMoreConnectors}
              onClick={() => setShowMoreConnectors((prev) => !prev)}
              className="mt-3 cursor-pointer text-xs text-muted-ink transition-colors hover:text-ink"
            >
              {showMoreConnectors ? "Show less" : "Show more"}
            </button>
          )}
        </section>

        {/* Outputs */}
        <section aria-label="Outputs" className="px-[18px] py-4">
          <h2 className="mb-3 text-[12.5px] font-medium text-muted-ink">
            Outputs
          </h2>
          {inspector.outputs.length === 0 ? (
            <p className="text-xs text-faint">
              Session previews and artifacts will appear here.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {inspector.outputs.map((out) => (
                <button
                  key={out.id}
                  type="button"
                  onClick={() =>
                    useAppStore.getState().openDocPreview(out.kind, out.pillLabel)
                  }
                  className="group -mx-1.5 flex w-[calc(100%+12px)] cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover hover:text-brand-text"
                >
                  <OutputKindIcon kind={out.kind} />
                  <span className="truncate">{out.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Changes */}
        <section aria-label="Changes" className="px-[18px] py-4">
          <h2 className="mb-3 text-[12.5px] font-medium text-muted-ink">
            Changes
          </h2>
          <div className="flex items-center gap-2.5">
            <FileDiff
              className="size-4 shrink-0 text-muted-ink"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span className="font-mono text-[13px] font-medium tabular-nums">
              <span className="text-brand-text">
                +{inspector.changesSummary.additions}
              </span>
              <span className="ml-1.5 text-danger">
                −{inspector.changesSummary.deletions}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                const firstCodeFile = Object.values(inspector.codeFiles)[0]
                if (firstCodeFile) {
                  openCodeFile(firstCodeFile.pill, firstCodeFile.defaultLine)
                } else {
                  setActiveRoute("changes")
                }
              }}
              className="cursor-pointer text-xs text-muted-ink transition-colors hover:text-ink"
            >
              Inspect
            </button>
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => setActiveRoute("changes")}
              className="ml-auto"
            >
              Create PR
            </Button>
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}
