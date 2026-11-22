import * as React from "react"
import { toast } from "sonner"

import { RightSidebarTopBar } from "@/components/shell/TopBar"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary"
import { useAppStore } from "@/lib/app-store"
import { ipcClient, type InspectorState } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

export interface RightInspectorHostProps {
  contextSlot?: React.ReactNode
  documentSlot?: React.ReactNode
}

function DefaultContextOverview() {
  const [inspector, setInspector] = React.useState<InspectorState | null>(null)
  const [expandedRowIds, setExpandedRowIds] = React.useState<
    Record<string, boolean>
  >({})
  const [expandedDiscIds, setExpandedDiscIds] = React.useState<
    Record<string, boolean>
  >({})
  const [showMoreConnectors, setShowMoreConnectors] = React.useState(false)

  const openCodeFile = useAppStore((s) => s.openCodeFile)
  const openDocPreview = useAppStore((s) => s.openDocPreview)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)

  React.useEffect(() => {
    void ipcClient.inspector.getState().then(setInspector)
  }, [])

  if (!inspector) {
    return <ContextSkeleton />
  }

  const toggleRow = (id: string) => {
    setExpandedRowIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleDisc = (id: string) => {
    setExpandedDiscIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const primaryConnectors = inspector.connectors.filter((c) => c.primary)
  const extraConnectors = inspector.connectors.filter((c) => !c.primary)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Environment */}
      <section className="border-b border-hairline px-[18px] py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-muted-ink">
            Environment
          </h2>
          <button
            type="button"
            aria-label="Environment settings"
            onClick={() => setActiveRoute("settings")}
            className="grid size-6 cursor-pointer place-items-center rounded-sm text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.35.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.4 2.54a7 7 0 0 0-2.41 1.4l-2.35-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.42 1.4l.39 2.54h3.4l.4-2.54a7 7 0 0 0 2.41-1.4l2.35.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4Z" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-2.5 text-[13px] text-ink">
          <div className="flex items-center gap-2.5">
            <span className="truncate">{inspector.environment.host}</span>
            <button
              type="button"
              onClick={() => toast("Saved environment profile")}
              className="ml-auto cursor-pointer text-xs text-body underline underline-offset-3 hover:text-ink"
            >
              Save
            </button>
          </div>
          <div className="flex items-center gap-2.5 truncate">
            <span>
              {inspector.environment.project}{" "}
              <span className="text-muted-ink">
                · {inspector.environment.path}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2.5 font-mono text-xs text-body">
            <span>{inspector.environment.branch}</span>
          </div>
        </div>
      </section>

      {/* Context */}
      <section className="border-b border-hairline px-[18px] py-4">
        <h2 className="mb-3 text-[13px] font-medium text-muted-ink">Context</h2>
        <div className="mb-2 flex items-baseline justify-between text-[13px]">
          <span className="font-medium text-ink">
            {inspector.context.usedPctLabel}
          </span>
          <span className="font-mono text-xs text-muted-ink tabular-nums">
            {inspector.context.tokensSummary}
          </span>
        </div>

        {/* Multi-segment bar */}
        <div className="mb-3.5 flex h-[5px] items-center gap-0.5 overflow-hidden rounded-full bg-active">
          <span className="h-full w-[12%] rounded-xs bg-info" />
          <span className="h-full w-[6%] rounded-xs bg-warn" />
          <span className="h-full w-[5%] rounded-xs bg-brand" />
          <span className="h-full w-[4%] rounded-xs bg-muted-ink" />
          <span className="h-full w-[10%] rounded-xs bg-faint" />
        </div>

        <div className="flex flex-col gap-1.5">
          {inspector.context.rows.map((row) => {
            const isExpanded = Boolean(expandedRowIds[row.id])
            return (
              <React.Fragment key={row.id}>
                <div className="grid grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2.5 text-xs text-body">
                  <span
                    className={cn("size-[9px] rounded-[2.5px]", row.colorClass)}
                  />
                  {row.dotted ? (
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => toggleRow(row.id)}
                      className="cursor-pointer justify-self-start truncate border-b border-dotted border-faint pb-px text-left text-body transition-colors hover:border-brand-text hover:text-ink"
                    >
                      {row.label}
                    </button>
                  ) : (
                    <span className="truncate">{row.label}</span>
                  )}
                  <span className="text-right font-mono text-xs text-muted-ink tabular-nums">
                    {row.tokensLabel}
                  </span>
                  <span className="text-right font-mono text-xs text-body tabular-nums">
                    {row.pctLabel}
                  </span>
                </div>
                {row.dotted && isExpanded && row.items && (
                  <div className="my-1 ml-[19px] flex flex-col gap-1 rounded-[9px] border border-hairline bg-inset px-2.5 py-2 text-[11.5px]">
                    {row.items.map((sub) => (
                      <div
                        key={sub.key}
                        className="flex items-center justify-between gap-2 text-body"
                      >
                        <span className="truncate">{sub.key}</span>
                        <span className="font-mono text-[11px] text-muted-ink">
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

        <div className="mt-3.5 flex flex-col gap-1.5">
          {[inspector.context.bufferRow, inspector.context.freeRow].map(
            (row) => (
              <div
                key={row.id}
                className="grid grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2.5 text-xs text-body"
              >
                <span
                  className={cn("size-[9px] rounded-[2.5px]", row.colorClass)}
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

        {/* Disclosures */}
        <div className="mt-3.5 flex flex-col gap-0.5">
          {inspector.context.disclosures.map((disc) => {
            const open = Boolean(expandedDiscIds[disc.id])
            return (
              <div key={disc.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleDisc(disc.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-body transition-colors hover:bg-hover hover:text-ink"
                >
                  <svg
                    className={cn(
                      "size-3 text-muted-ink transition-transform",
                      open && "rotate-90"
                    )}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    aria-hidden="true"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                  <span>{disc.label}</span>
                  <span className="ml-auto font-mono text-xs text-muted-ink tabular-nums">
                    {disc.count}
                  </span>
                </button>
                {open && (
                  <div className="flex flex-col gap-1 py-1 pl-5 font-mono text-[11px] text-muted-ink">
                    {disc.items.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Connectors */}
      <section className="border-b border-hairline px-[18px] py-4">
        <h2 className="mb-3 text-[13px] font-medium text-muted-ink">
          Connectors
        </h2>
        <div className="flex flex-col gap-2.5">
          {primaryConnectors.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-2.5 text-[13px] text-ink"
            >
              <span className="grid size-5 place-items-center rounded-[5px] bg-active font-mono text-[11px] font-semibold text-body">
                {conn.glyph}
              </span>
              <span>{conn.name}</span>
              {conn.status && (
                <button
                  type="button"
                  onClick={() => toast(`Connector: ${conn.name}`)}
                  className={cn(
                    "ml-auto cursor-pointer text-xs font-medium",
                    conn.status === "Linked" ? "text-brand-text" : "text-warn"
                  )}
                >
                  {conn.status}
                </button>
              )}
            </div>
          ))}
          {showMoreConnectors &&
            extraConnectors.map((conn) => (
              <div
                key={conn.id}
                className="flex items-center gap-2.5 text-[13px] text-ink"
              >
                <span className="grid size-5 place-items-center rounded-[5px] bg-active font-mono text-[11px] font-semibold text-body">
                  {conn.glyph}
                </span>
                <span>{conn.name}</span>
                {conn.status && (
                  <span className="ml-auto text-xs font-medium text-brand-text">
                    {conn.status}
                  </span>
                )}
              </div>
            ))}
        </div>
        <button
          type="button"
          onClick={() => setShowMoreConnectors((v) => !v)}
          className="mt-2.5 cursor-pointer text-xs text-muted-ink hover:text-ink"
        >
          {showMoreConnectors ? "Show less" : "Show more"}
        </button>
      </section>

      {/* Outputs */}
      <section className="border-b border-hairline px-[18px] py-4">
        <h2 className="mb-3 text-[13px] font-medium text-muted-ink">Outputs</h2>
        <div className="flex flex-col gap-1">
          {inspector.outputs.map((out) => (
            <button
              key={out.id}
              type="button"
              onClick={() => openDocPreview(out.kind, out.pillLabel)}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-1.5 py-1 text-left text-xs text-ink transition-colors hover:bg-hover hover:text-brand-text"
            >
              <span className="truncate">{out.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Changes */}
      <section className="px-[18px] py-4">
        <h2 className="mb-3 text-[13px] font-medium text-muted-ink">Changes</h2>
        <div className="flex items-center gap-2.5">
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
            onClick={() => openCodeFile("lookup.rs", 21)}
            className="cursor-pointer text-xs text-muted-ink hover:text-ink"
          >
            Inspect
          </button>
          <button
            type="button"
            onClick={() =>
              toast("Create PR requires explicit confirmation (Always ask)")
            }
            className="rayu-surface-bevel ml-auto cursor-pointer rounded-sm bg-raised px-3 py-1 text-xs font-medium text-body transition-colors hover:border-premium-hi hover:bg-active hover:text-ink"
          >
            Create PR
          </button>
        </div>
      </section>
    </div>
  )
}

function DefaultDocumentViewer() {
  const activeRightTab = useAppStore((s) => s.activeRightTab)
  const activeCodeFile = useAppStore((s) => s.activeCodeFile) ?? "lookup.rs"
  const activeCodeLine = useAppStore((s) => s.activeCodeLine)
  const openCodeFile = useAppStore((s) => s.openCodeFile)
  const [inspector, setInspector] = React.useState<InspectorState | null>(null)

  React.useEffect(() => {
    void ipcClient.inspector.getState().then(setInspector)
  }, [])

  if (!inspector) {
    return <ContextSkeleton />
  }

  if (activeRightTab === "terminal") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-inset font-mono text-xs text-body">
        <div className="flex items-center justify-between border-b border-hairline bg-chrome px-3.5 py-2 text-muted-ink">
          <span>rayu daemon</span>
          <span className="text-[11px] text-brand-text">● live</span>
        </div>
        <div className="flex-1 overflow-auto p-3.5 leading-relaxed">
          {inspector.terminalLines.map((line) => (
            <div key={line.id} className="mb-1.5">
              <div>
                <span className="text-brand-text">{line.prompt}</span>{" "}
                <span className="text-ink">{line.command}</span>
              </div>
              {line.output && (
                <div className="text-muted-ink">{line.output}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const codeSpec =
    inspector.codeFiles[activeCodeFile] ?? inspector.codeFiles["lookup.rs"]

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-pane">
      <div className="flex items-center gap-1.5 border-b border-hairline px-3 py-2">
        {Object.keys(inspector.codeFiles).map((fileKey) => (
          <button
            key={fileKey}
            type="button"
            onClick={() => openCodeFile(fileKey, 21)}
            className={cn(
              "cursor-pointer rounded-[7px] border px-2.5 py-1 font-mono text-[11px] transition-colors",
              activeCodeFile === fileKey
                ? "border-premium bg-active text-ink"
                : "border-transparent text-muted-ink hover:bg-hover hover:text-ink"
            )}
          >
            {fileKey}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-b border-hairline bg-chrome px-3.5 py-2 text-xs text-muted-ink">
        <span className="truncate font-mono text-[11.5px] text-body">
          {codeSpec.path}
        </span>
        <button
          type="button"
          onClick={() => {
            void ipcClient.native.openInVSCode(
              codeSpec.pill,
              activeCodeLine ?? undefined
            )
            toast(`Opened ${codeSpec.pill} in Visual Studio Code`)
          }}
          className="cursor-pointer rounded-sm px-2 py-0.5 text-xs text-body hover:bg-hover hover:text-ink"
        >
          VS Code
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2.5 font-mono text-xs leading-relaxed">
        {codeSpec.lines.map((lineText, idx) => {
          const ln = codeSpec.startLine + idx
          const isHighlighted = activeCodeLine === ln
          return (
            <div
              key={ln}
              className={cn(
                "grid grid-cols-[42px_minmax(0,1fr)] border-l-2 pr-3.5 whitespace-pre",
                isHighlighted
                  ? "border-l-brand bg-brand-softer"
                  : "border-l-transparent"
              )}
            >
              <span
                className={cn(
                  "pr-3 pl-2 text-right select-none tabular-nums",
                  isHighlighted ? "font-semibold text-brand-text" : "text-faint"
                )}
              >
                {ln}
              </span>
              <span className="text-ink">{lineText}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function RightInspectorHost({
  contextSlot,
  documentSlot,
}: RightInspectorHostProps) {
  const rightCollapsed = useAppStore((s) => s.rightCollapsed)
  const rightMode = useAppStore((s) => s.rightMode)
  const fullView = useAppStore((s) => s.fullView)

  if (rightCollapsed) {
    return null
  }

  return (
    <aside
      aria-label="Environment, context and previews"
      className={cn(
        "flex h-full shrink-0 flex-col border-l border-hairline bg-chrome transition-[width] duration-150",
        fullView ? "fixed inset-0 z-40 w-full" : "w-[344px]"
      )}
    >
      <RightSidebarTopBar />
      <SectionErrorBoundary title="Right inspector failed to load">
        <React.Suspense fallback={<ContextSkeleton />}>
          {rightMode === "context"
            ? (contextSlot ?? <DefaultContextOverview />)
            : (documentSlot ?? <DefaultDocumentViewer />)}
        </React.Suspense>
      </SectionErrorBoundary>
    </aside>
  )
}
