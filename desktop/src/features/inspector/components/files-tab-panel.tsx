import * as React from "react"
import {
  Check,
  Code2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Globe,
  ListChecks,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { openFileInVSCode } from "../api/inspector-api"
import { useInspectorState } from "../hooks/use-context-stats"
import type { InspectorOutputKind } from "../types"

function ArtifactIcon({ kind }: { kind: InspectorOutputKind }) {
  switch (kind) {
    case "browser":
      return <Globe className="size-3.5 shrink-0 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
    case "excel":
      return (
        <FileSpreadsheet
          className="size-3.5 shrink-0 text-muted-ink"
          strokeWidth={1.65}
          aria-hidden="true"
        />
      )
    case "markdown":
      return (
        <FileText
          className="size-3.5 shrink-0 text-muted-ink"
          strokeWidth={1.65}
          aria-hidden="true"
        />
      )
  }
}

export interface FilesTabPanelProps {
  className?: string
}

export function FilesTabPanel({ className }: FilesTabPanelProps) {
  const { data: inspector, isLoading } = useInspectorState()
  const openDocPreview = useAppStore((s) => s.openDocPreview)
  const openCodeFile = useAppStore((s) => s.openCodeFile)

  const [completedOverrides, setCompletedOverrides] = React.useState<
    Record<string, boolean>
  >({})

  if (isLoading || !inspector) {
    return <ContextSkeleton />
  }

  const toggleTask = (taskId: string, current: boolean) => {
    setCompletedOverrides((prev) => ({ ...prev, [taskId]: !current }))
  }

  const completedCount = inspector.tasks.filter(
    (task) => completedOverrides[task.id] ?? task.completed
  ).length

  const codeFilesList = Object.values(inspector.codeFiles)

  return (
    <ScrollArea
      data-testid="inspector-files-panel"
      className={cn("min-h-0 flex-1 bg-pane", className)}
    >
      <div className="flex flex-col">
        {/* Session Previews & Documents (flat list — no folder tree) */}
        <section aria-label="Documents and previews" className="px-[18px] py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-medium tracking-tight text-muted-ink">
              Documents &amp; Previews
            </h2>
            <span className="font-mono text-[11px] text-muted-ink tabular-nums">
              {inspector.outputs.length}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {inspector.outputs.map((out) => (
              <button
                key={out.id}
                type="button"
                onClick={() => openDocPreview(out.kind, out.pillLabel)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-hairline bg-inset px-2.5 py-2 text-left text-xs text-ink transition-colors hover:border-premium hover:bg-hover hover:text-brand-text"
              >
                <ArtifactIcon kind={out.kind} />
                <span className="min-w-0 flex-1 truncate">{out.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-ink uppercase">
                  {out.kind}
                </span>
              </button>
            ))}
          </div>
        </section>

        <Separator />

        {/* Referenced Source Files */}
        <section aria-label="Referenced files" className="px-[18px] py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-medium tracking-tight text-muted-ink">
              Referenced Files
            </h2>
            <span className="font-mono text-[11px] text-muted-ink tabular-nums">
              {codeFilesList.length}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {codeFilesList.map((file) => (
              <div
                key={file.pill}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-hover"
              >
                <button
                  type="button"
                  onClick={() => openCodeFile(file.pill, file.defaultLine)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-ink hover:text-brand-text"
                >
                  <Code2
                    className="size-3.5 shrink-0 text-muted-ink"
                    strokeWidth={1.65}
                    aria-hidden="true"
                  />
                  <span className="truncate font-mono text-xs">{file.pill}</span>
                  <span className="truncate text-[11px] text-muted-ink">
                    :{file.defaultLine}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Open ${file.pill} in VS Code`}
                  onClick={() => {
                    void openFileInVSCode(file.path, file.defaultLine)
                    toast(`Opened ${file.pill} in Visual Studio Code`)
                  }}
                >
                  <ExternalLink className="size-3" strokeWidth={1.65} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        {/* Session Tasks Checklist */}
        <section aria-label="Session tasks" className="px-[18px] py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ListChecks
                className="size-3.5 text-muted-ink"
                strokeWidth={1.65}
                aria-hidden="true"
              />
              <h2 className="text-[13px] font-medium tracking-tight text-muted-ink">
                Session Tasks
              </h2>
            </div>
            <span className="font-mono text-[11px] text-muted-ink tabular-nums">
              {completedCount} / {inspector.tasks.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {inspector.tasks.map((task) => {
              const isDone = completedOverrides[task.id] ?? task.completed
              return (
                <div
                  key={task.id}
                  className="flex items-start gap-2.5 rounded-lg border border-hairline bg-inset px-2.5 py-2"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isDone}
                    aria-label={task.title}
                    onClick={() => toggleTask(task.id, isDone)}
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors",
                      isDone
                        ? "border-brand bg-brand text-brand-ink"
                        : "border-hairline-strong bg-transparent text-transparent hover:border-brand"
                    )}
                  >
                    <Check className="size-2.5" strokeWidth={2.5} aria-hidden="true" />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "text-xs font-medium",
                        isDone ? "text-muted-ink line-through" : "text-ink"
                      )}
                    >
                      {task.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-ink">
                      {task.detail}
                    </div>
                  </div>

                  {task.codeFile && (
                    <button
                      type="button"
                      onClick={() =>
                        openCodeFile(task.codeFile!, task.codeLine ?? 1)
                      }
                      className="shrink-0 cursor-pointer font-mono text-[11px] text-brand-text hover:underline"
                    >
                      {task.codeFile}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}
