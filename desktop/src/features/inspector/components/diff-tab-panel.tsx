import * as React from "react"
import { Check, Code2, ExternalLink, FileDiff, GitBranch, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { openFileInVSCode } from "../api/inspector-api"
import {
  useDiffDecisionMutation,
  useInspectorChanges,
} from "../hooks/use-context-stats"

function resolveCodeFileKey(path: string): string {
  const base = path.split("/").pop() ?? "lookup.rs"
  if (base === "lookup.rs" || base === "cache.rs" || base === "store.rs") {
    return base
  }
  return "lookup.rs"
}

export interface DiffTabPanelProps {
  className?: string
}

export function DiffTabPanel({ className }: DiffTabPanelProps) {
  const {
    data: changes,
    isLoading,
    isError,
    error,
    refetch,
  } = useInspectorChanges()
  const decisionMutation = useDiffDecisionMutation()
  const openCodeFile = useAppStore((s) => s.openCodeFile)
  const openDocPreview = useAppStore((s) => s.openDocPreview)

  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(
    null
  )

  if (isLoading) {
    return <ContextSkeleton />
  }

  if (isError || !changes) {
    return (
      <div className="p-4">
        <ErrorState
          title="Unable to load file diffs"
          description={
            error instanceof Error
              ? error.message
              : "Could not read changed files from workspace."
          }
          actionLabel="Retry"
          onRetry={() => {
            void refetch()
          }}
        />
      </div>
    )
  }

  const activeFile =
    changes.files.find((f) => f.id === selectedFileId) ?? changes.files[0]

  const handleDecision = (fileId: string, path: string, decision: "accept" | "reject") => {
    decisionMutation.mutate(
      { fileId, decision },
      {
        onSuccess: () => {
          toast(
            decision === "accept"
              ? `Accepted diff for ${path}`
              : `Rejected diff for ${path}`
          )
        },
      }
    )
  }

  return (
    <div
      data-testid="inspector-diff-panel"
      className={cn("flex min-h-0 flex-1 flex-col bg-pane", className)}
    >
      {/* Branch summary header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-chrome px-3.5 py-2.5">
        <GitBranch className="size-3.5 shrink-0 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
          {changes.branch}
        </span>
        <span className="shrink-0 font-mono text-xs font-medium tabular-nums">
          <span className="text-brand-text">+{changes.totalAdditions}</span>
          <span className="ml-1.5 text-danger">−{changes.totalDeletions}</span>
        </span>
      </div>

      {/* Flat changed file selector pills (no folder tree) */}
      <div
        role="tablist"
        aria-label="Changed files"
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-hairline px-3 py-2"
      >
        {changes.files.map((file) => {
          const isSelected = activeFile?.id === file.id
          const shortName = file.path.split("/").pop() ?? file.path
          return (
            <button
              key={file.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelectedFileId(file.id)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-2 py-1 font-mono text-[11px] whitespace-nowrap transition-colors",
                isSelected
                  ? "border-premium bg-active text-ink"
                  : "border-transparent text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              <span>{shortName}</span>
              <span className="text-[10px] text-brand-text tabular-nums">
                +{file.additions}
              </span>
              {file.deletions > 0 && (
                <span className="text-[10px] text-danger tabular-nums">
                  −{file.deletions}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Active diff hunk card */}
      {activeFile && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3.5">
            <div className="rayu-card-bevel overflow-hidden rounded-[10px] border border-hairline bg-inset">
              <div className="flex items-center gap-2 border-b border-hairline bg-chrome px-3 py-2">
                <FileDiff
                  className="size-3.5 shrink-0 text-muted-ink"
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                  {activeFile.path}
                </span>
                <span className="rounded-sm bg-active px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
                  {activeFile.ownerBadge}
                </span>
              </div>

              <div className="overflow-x-auto py-2 font-mono text-[11.5px] leading-relaxed">
                {activeFile.lines.map((line, idx) => (
                  <div
                    key={`${activeFile.id}-${idx}`}
                    className={cn(
                      "grid grid-cols-[34px_16px_minmax(0,1fr)] px-2 whitespace-pre",
                      line.type === "hunk" && "bg-chrome text-muted-ink",
                      line.type === "add" && "bg-diff-add text-ink",
                      line.type === "del" && "bg-diff-del text-body",
                      line.type === "ctx" && "text-body"
                    )}
                  >
                    <span className="pr-2 text-right text-faint select-none tabular-nums">
                      {line.lineNumber ?? ""}
                    </span>
                    <span
                      className={cn(
                        "text-center select-none",
                        line.type === "add" && "text-brand-text",
                        line.type === "del" && "text-danger",
                        line.type === "hunk" && "text-muted-ink"
                      )}
                    >
                      {line.mark}
                    </span>
                    <span className="pr-2">{line.content}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline bg-chrome px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-ink">
                  {activeFile.accepted
                    ? "Accepted"
                    : activeFile.rejected
                      ? "Rejected"
                      : activeFile.hint}
                </span>

                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    if (activeFile.path.endsWith(".md")) {
                      openDocPreview("markdown", activeFile.path)
                    } else {
                      openCodeFile(resolveCodeFileKey(activeFile.path), 21)
                    }
                  }}
                >
                  <Code2 className="size-3" strokeWidth={1.65} aria-hidden="true" />
                  <span>Code</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    void openFileInVSCode(activeFile.path, 19)
                    toast(`Opened ${activeFile.path} in Visual Studio Code`)
                  }}
                >
                  <ExternalLink className="size-3" strokeWidth={1.65} aria-hidden="true" />
                  <span>VS Code</span>
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                size="xs"
                disabled={decisionMutation.isPending}
                onClick={() =>
                  handleDecision(activeFile.id, activeFile.path, "reject")
                }
              >
                <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
                <span>Reject</span>
              </Button>
              <Button
                type="button"
                variant="primary"
                size="xs"
                disabled={decisionMutation.isPending}
                onClick={() =>
                  handleDecision(activeFile.id, activeFile.path, "accept")
                }
              >
                <Check className="size-3" strokeWidth={1.75} aria-hidden="true" />
                <span>Accept</span>
              </Button>
              <Button
                type="button"
                variant="default"
                size="xs"
                onClick={() =>
                  toast("Create PR requires explicit confirmation (Always ask)")
                }
                className="ml-auto"
              >
                Create PR
              </Button>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
