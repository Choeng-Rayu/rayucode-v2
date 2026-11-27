import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FileDiff,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TechFileBadge } from "@/components/ui/tech-file-badge"
import { changesQueryKeys } from "@/features/changes"
import { useAppStore } from "@/lib/app-store"
import { tokenizeCodeLine } from "@/lib/file-icon-theme"
import {
  ipcClient,
  type FileChangeActionKind,
  type FileChangeConflict,
  type FileChangeDiffPayload,
  type FileChangeEntrySummary,
  type FileChangeHunk,
  type FileChangesSnapshot,
} from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { openDiffInVSCode } from "../api/trace-api"

const MAX_INLINE_PREVIEW_LINES = 40
const DEFAULT_VISIBLE_FILES = 3

interface RenderedHunkLine {
  key: string
  type: "hunk" | "add" | "del" | "ctx"
  lineNumber: number | null
  mark: string
  text: string
}

function buildPreviewLines(
  hunks: FileChangeHunk[],
  maxLines = MAX_INLINE_PREVIEW_LINES
): { lines: RenderedHunkLine[]; capped: boolean; firstChangedLine: number } {
  const all: RenderedHunkLine[] = []
  let firstChangedLine = 1
  let foundChangedLine = false

  for (let hIdx = 0; hIdx < hunks.length; hIdx += 1) {
    const hunk = hunks[hIdx]
    all.push({
      key: `hunk-${hIdx}`,
      type: "hunk",
      lineNumber: null,
      mark: "",
      text: hunk.header,
    })

    let oldLine = Math.max(1, hunk.old_start || 1)
    let newLine = Math.max(1, hunk.new_start || 1)

    for (let lIdx = 0; lIdx < hunk.lines.length; lIdx += 1) {
      const raw = hunk.lines[lIdx] ?? ""
      if (raw.startsWith("+")) {
        const ln = newLine
        newLine += 1
        if (!foundChangedLine) {
          firstChangedLine = ln
          foundChangedLine = true
        }
        all.push({
          key: `h-${hIdx}-l-${lIdx}`,
          type: "add",
          lineNumber: ln,
          mark: "+",
          text: raw.slice(1),
        })
      } else if (raw.startsWith("-")) {
        const ln = oldLine
        oldLine += 1
        if (!foundChangedLine) {
          firstChangedLine = ln
          foundChangedLine = true
        }
        all.push({
          key: `h-${hIdx}-l-${lIdx}`,
          type: "del",
          lineNumber: ln,
          mark: "−",
          text: raw.slice(1),
        })
      } else {
        const ln = newLine
        oldLine += 1
        newLine += 1
        all.push({
          key: `h-${hIdx}-l-${lIdx}`,
          type: "ctx",
          lineNumber: ln,
          mark: "",
          text: raw.startsWith(" ") ? raw.slice(1) : raw,
        })
      }
    }
  }

  if (all.length > maxLines) {
    return {
      lines: all.slice(0, maxLines),
      capped: true,
      firstChangedLine,
    }
  }
  return { lines: all, capped: false, firstChangedLine }
}

function kindPillMeta(
  kind: FileChangeEntrySummary["kind"]
): { label: string; className: string } | null {
  switch (kind) {
    case "created":
      return {
        label: "new",
        className: "bg-brand-soft text-brand-text",
      }
    case "deleted":
      return {
        label: "deleted",
        className: "bg-danger-soft text-danger",
      }
    case "renamed":
      return {
        label: "moved",
        className: "bg-info-soft text-info",
      }
    case "modified":
    default:
      return null
  }
}

interface PendingConflictState {
  sessionId: string
  action: FileChangeActionKind
  path?: string
  message: string
  conflicts: FileChangeConflict[]
}

export interface TurnFileSummaryCardProps {
  sessionId: string
  snapshot: FileChangesSnapshot
  className?: string
}

export function TurnFileSummaryCard({
  sessionId,
  snapshot,
  className,
}: TurnFileSummaryCardProps) {
  const queryClient = useQueryClient()
  const openDiffFile = useAppStore((s) => s.openDiffFile)
  const setSessionFileChanges = useAppStore((s) => s.setSessionFileChanges)

  const [expandedRows, setExpandedRows] = React.useState<
    Record<string, boolean>
  >({})
  const [loadedDiffs, setLoadedDiffs] = React.useState<
    Record<string, FileChangeDiffPayload>
  >({})
  const [receiptExpandedKey, setReceiptExpandedKey] = React.useState<
    string | null
  >(null)
  const [showAllFilesSessionId, setShowAllFilesSessionId] = React.useState<
    string | null
  >(null)
  const [busyKey, setBusyKey] = React.useState<string | null>(null)
  const [conflictState, setConflictState] =
    React.useState<PendingConflictState | null>(null)

  const files = snapshot.files
  const orderedFiles = React.useMemo(
    () =>
      files
        .map((entry, idx) => ({ entry, idx }))
        .sort((a, b) => {
          const turnDiff =
            (b.entry.changed_in_latest_turn ? 1 : 0) -
            (a.entry.changed_in_latest_turn ? 1 : 0)
          if (turnDiff !== 0) return turnDiff
          const timeDiff =
            (b.entry.updated_at_ms ?? 0) - (a.entry.updated_at_ms ?? 0)
          if (timeDiff !== 0) return timeDiff
          return a.idx - b.idx
        })
        .map(({ entry }) => entry),
    [files]
  )
  const hasMoreFiles = orderedFiles.length > DEFAULT_VISIBLE_FILES
  const showAllFiles = showAllFilesSessionId === sessionId
  const visibleFiles =
    hasMoreFiles && !showAllFiles
      ? orderedFiles.slice(0, DEFAULT_VISIBLE_FILES)
      : orderedFiles
  const hiddenFileCount = Math.max(
    0,
    orderedFiles.length - DEFAULT_VISIBLE_FILES
  )
  const pendingFiles = React.useMemo(
    () => files.filter((f) => f.status === "pending"),
    [files]
  )
  const keptFiles = React.useMemo(
    () => files.filter((f) => f.status === "kept"),
    [files]
  )
  const undoneFiles = React.useMemo(
    () => files.filter((f) => f.status === "undone"),
    [files]
  )

  const allResolved = files.length > 0 && pendingFiles.length === 0
  const receiptKey = `${sessionId}:${snapshot.latest_turn_id}:${allResolved ? "resolved" : "pending"}`
  const receiptExpanded = allResolved && receiptExpandedKey === receiptKey
  const activeConflict =
    conflictState && conflictState.sessionId === sessionId ? conflictState : null
  const hasUndoablePending = pendingFiles.some((f) => f.undoable)
  const hasRedoableUndone = undoneFiles.some((f) => f.can_redo)
  const keptAdditions = React.useMemo(
    () => keptFiles.reduce((acc, f) => acc + f.additions, 0),
    [keptFiles]
  )
  const keptDeletions = React.useMemo(
    () => keptFiles.reduce((acc, f) => acc + f.deletions, 0),
    [keptFiles]
  )
  const displayAdditions = allResolved ? keptAdditions : snapshot.total_additions
  const displayDeletions = allResolved ? keptDeletions : snapshot.total_deletions
  const latestTurnCount = React.useMemo(
    () => files.filter((f) => f.changed_in_latest_turn).length,
    [files]
  )
  const showTurnBadge = latestTurnCount > 0 && latestTurnCount < files.length

  const invalidateChangeQueries = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: changesQueryKeys.state() })
    void queryClient.invalidateQueries({ queryKey: ["inspector", "changes"] })
  }, [queryClient])

  const runAction = React.useCallback(
    async (
      action: FileChangeActionKind,
      opts?: { path?: string; force?: boolean }
    ) => {
      const key = opts?.path ?? "all"
      setBusyKey(key)
      try {
        const response = await ipcClient.fileChanges.action(
          sessionId,
          action,
          opts
        )
        if (response.snapshot) {
          setSessionFileChanges(
            response.snapshot.session_id || sessionId,
            response.snapshot
          )
        }
        invalidateChangeQueries()

        if (response.conflicts && response.conflicts.length > 0) {
          setConflictState({
            sessionId,
            action,
            path: opts?.path,
            message: response.message,
            conflicts: response.conflicts,
          })
          return
        }

        if (!response.ok) {
          toast.error(response.message || "File change action failed")
          return
        }

        setConflictState(null)
        if (response.message) {
          toast(response.message)
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to apply file change action"
        )
      } finally {
        setBusyKey(null)
      }
    },
    [invalidateChangeQueries, sessionId, setSessionFileChanges]
  )

  const handleToggleRow = React.useCallback(
    (entry: FileChangeEntrySummary, nextOpen: boolean) => {
      const rowKey = `${sessionId}:${entry.path}`
      setExpandedRows((prev) => ({ ...prev, [rowKey]: nextOpen }))
      const cacheKey = `${sessionId}:${entry.path}:${entry.updated_at_ms}`
      if (
        nextOpen &&
        (entry.preview_hunks?.length ?? 0) === 0 &&
        !entry.is_binary &&
        entry.undoable &&
        !loadedDiffs[cacheKey]
      ) {
        void ipcClient.fileChanges
          .diff(sessionId, entry.path)
          .then((payload) => {
            if (payload) {
              setLoadedDiffs((prev) => ({ ...prev, [cacheKey]: payload }))
            }
          })
          .catch(() => {
            // Non-fatal: inline fallback message remains visible
          })
      }
    },
    [loadedDiffs, sessionId]
  )

  const handleOpenVSCode = React.useCallback(
    async (entry: FileChangeEntrySummary, firstLine: number) => {
      const result = await openDiffInVSCode(entry.path, firstLine)
      if (result.ok) {
        toast(`Opened ${entry.display_path}:${firstLine} in Visual Studio Code`)
      } else {
        toast.error(result.error)
      }
    },
    []
  )

  if (files.length === 0) {
    return null
  }

  const fileCountLabel = `${files.length} ${files.length === 1 ? "file" : "files"} changed`

  const renderConflictDialog = () => (
    <Dialog
      open={activeConflict !== null}
      onOpenChange={(open) => {
        if (!open) setConflictState(null)
      }}
    >
      <DialogContent
        data-testid="file-change-conflict-dialog"
        className="sm:max-w-[500px]"
      >
        <DialogHeader>
          <div className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-medium text-warn">
            <AlertTriangle className="size-3" aria-hidden="true" />
            <span>Manual edits detected</span>
          </div>
          <DialogTitle>Resolve file change conflict</DialogTitle>
          <DialogDescription>
            {activeConflict?.message ||
              "One or more files were modified after the AI finished editing. Inspect the diff or force-restore the pre-edit snapshot."}
          </DialogDescription>
        </DialogHeader>

        {activeConflict && activeConflict.conflicts.length > 0 && (
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-lg border border-hairline bg-inset p-2.5">
            {activeConflict.conflicts.map((conflict) => (
              <div
                key={conflict.path}
                data-testid={`conflict-item-${conflict.display_path}`}
                className="flex items-start gap-2 rounded-md border border-hairline-soft bg-pane px-2.5 py-2 text-xs"
              >
                <TechFileBadge
                  path={conflict.display_path}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono font-medium text-ink">
                    {conflict.display_path}
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-ink">
                    {conflict.reason}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="conflict-open-diff-btn"
            onClick={() => {
              const first = activeConflict?.conflicts[0]
              if (first) {
                openDiffFile(first.path, sessionId)
              }
              setConflictState(null)
            }}
          >
            Open Diff
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="conflict-cancel-btn"
            onClick={() => setConflictState(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busyKey !== null}
            data-testid="conflict-force-restore-btn"
            onClick={() => {
              if (!activeConflict) return
              const pending = activeConflict
              setConflictState(null)
              void runAction(pending.action, {
                path: pending.path,
                force: true,
              })
            }}
          >
            Force Restore Pre-Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (allResolved && !receiptExpanded) {
    const isAllKept = keptFiles.length > 0 && undoneFiles.length === 0
    const isAllUndone = undoneFiles.length > 0 && keptFiles.length === 0
    const keptCount = keptFiles.length
    const undoneCount = undoneFiles.length
    const receiptText = isAllKept
      ? `Kept ${keptCount} ${keptCount === 1 ? "file" : "files"}`
      : isAllUndone
        ? `Undid ${undoneCount} ${undoneCount === 1 ? "file" : "files"}`
        : `Kept ${keptCount}, undid ${undoneCount} files`

    return (
      <>
        <div
          data-slot="turn-file-summary-receipt"
          data-testid="turn-file-summary-receipt"
          className={cn(
            "rayu-card-bevel flex flex-wrap items-center gap-2 rounded-xl border border-premium bg-pane px-3.5 py-2 text-xs",
            className
          )}
        >
          {isAllUndone ? (
            <RotateCcw
              className="size-3.5 shrink-0 text-muted-ink"
              aria-hidden="true"
            />
          ) : (
            <Check
              className="size-3.5 shrink-0 text-brand-text"
              aria-hidden="true"
            />
          )}
          <span className="font-medium text-ink">{receiptText}</span>
          {!isAllUndone && (keptAdditions > 0 || keptDeletions > 0) && (
            <span className="font-mono text-[11px] tabular-nums">
              <span className="text-brand-text">(+{keptAdditions}</span>{" "}
              <span className="text-danger">−{keptDeletions})</span>
            </span>
          )}
          <span className="flex-1" />
          {hasRedoableUndone && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busyKey !== null}
              data-testid="receipt-redo-all-btn"
              onClick={() => void runAction("redo_all")}
            >
              Redo all
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="receipt-expand-btn"
            onClick={() => setReceiptExpandedKey(receiptKey)}
          >
            Expand
          </Button>
        </div>
        {renderConflictDialog()}
      </>
    )
  }

  return (
    <>
      <section
        data-slot="turn-file-summary-card"
        data-testid="turn-file-summary-card"
        aria-label="Turn file changes summary"
        className={cn(
          "rayu-card-bevel overflow-hidden rounded-xl border border-premium bg-pane",
          className
        )}
      >
        {/* Summary Header */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2.5 text-xs">
          <FileDiff
            className="size-3.5 shrink-0 text-muted-ink"
            aria-hidden="true"
          />
          <span
            data-testid="summary-file-count"
            className="font-medium text-ink"
          >
            {fileCountLabel}
          </span>
          {showTurnBadge && (
            <span
              data-testid="summary-turn-scoped-badge"
              className="rounded-full border border-hairline bg-raised px-2 py-0.5 text-[11px] text-muted-ink tabular-nums"
            >
              {latestTurnCount} in this turn
            </span>
          )}
          <span
            data-testid="summary-diff-totals"
            className="font-mono text-[11.5px] font-medium tabular-nums"
          >
            <span className="text-brand-text">+{displayAdditions}</span>{" "}
            <span className="text-danger">−{displayDeletions}</span>
          </span>
          <span className="flex-1" />

          {!allResolved ? (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyKey !== null || !hasUndoablePending}
                data-testid="summary-undo-all-btn"
                onClick={() => void runAction("undo_all")}
              >
                Undo all
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busyKey !== null || pendingFiles.length === 0}
                data-testid="summary-keep-all-btn"
                onClick={() => void runAction("keep_all")}
              >
                Keep all
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {hasRedoableUndone && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyKey !== null}
                  data-testid="summary-redo-all-btn"
                  onClick={() => void runAction("redo_all")}
                >
                  Redo all
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="summary-collapse-btn"
                onClick={() => setReceiptExpandedKey(null)}
              >
                Collapse
              </Button>
            </div>
          )}
        </div>

        {/* Collapsible Per-File Rows */}
        <div className="divide-y divide-hairline-soft">
          {visibleFiles.map((entry) => {
            const isOpen = Boolean(expandedRows[`${sessionId}:${entry.path}`])
            const previewHunks = entry.preview_hunks ?? []
            const diffCacheKey = `${sessionId}:${entry.path}:${entry.updated_at_ms}`
            const effectiveHunks =
              previewHunks.length > 0
                ? previewHunks
                : (loadedDiffs[diffCacheKey]?.hunks ?? [])
            const { lines, capped, firstChangedLine } =
              buildPreviewLines(effectiveHunks)
            const showTruncatedHint = Boolean(entry.preview_truncated) || capped
            const kindPill = kindPillMeta(entry.kind)
            const isRowBusy = busyKey === "all" || busyKey === entry.path

            return (
              <Collapsible
                key={entry.path}
                open={isOpen}
                onOpenChange={(open) => handleToggleRow(entry, open)}
                data-testid={`file-summary-row-${entry.display_path}`}
              >
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-hover/60">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Toggle diff preview for ${entry.display_path}`}
                      data-testid={`file-row-toggle-${entry.display_path}`}
                      className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-ink transition-colors hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight
                        className={cn(
                          "size-3.5 transition-transform duration-150",
                          isOpen && "rotate-90 text-ink"
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  </CollapsibleTrigger>

                  <button
                    type="button"
                    data-testid={`file-row-open-${entry.display_path}`}
                    onClick={() => openDiffFile(entry.path, sessionId)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left font-mono text-xs text-ink transition-colors hover:text-brand-text focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <TechFileBadge path={entry.display_path} />
                    <span
                      className={cn(
                        "truncate",
                        entry.status === "undone" &&
                          "text-muted-ink line-through"
                      )}
                    >
                      {entry.display_path}
                    </span>
                  </button>

                  {kindPill && (
                    <span
                      data-testid={`file-kind-pill-${entry.display_path}`}
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] font-medium",
                        kindPill.className
                      )}
                    >
                      {kindPill.label}
                    </span>
                  )}

                  <span className="shrink-0 font-mono text-[11px] tabular-nums">
                    {entry.additions > 0 && (
                      <span className="text-brand-text">
                        +{entry.additions}
                      </span>
                    )}
                    {entry.additions > 0 && entry.deletions > 0 && " "}
                    {entry.deletions > 0 && (
                      <span className="text-danger">−{entry.deletions}</span>
                    )}
                  </span>

                  {entry.status === "kept" && (
                    <span
                      data-testid={`file-status-badge-${entry.display_path}`}
                      className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text"
                    >
                      Kept
                    </span>
                  )}

                  {entry.status === "undone" && (
                    <span
                      data-testid={`file-status-badge-${entry.display_path}`}
                      className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-medium text-warn"
                    >
                      Undone
                    </span>
                  )}

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-testid={`file-diff-btn-${entry.display_path}`}
                      onClick={() => openDiffFile(entry.path, sessionId)}
                    >
                      Diff
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-testid={`file-vscode-btn-${entry.display_path}`}
                      onClick={() =>
                        void handleOpenVSCode(entry, firstChangedLine)
                      }
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                      <span>VS Code</span>
                    </Button>

                    {entry.status === "pending" && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={isRowBusy || !entry.undoable}
                          title={
                            entry.undoable
                              ? "Undo AI edits in this file"
                              : "Exceeds 10 MiB snapshot limit — undo unavailable"
                          }
                          data-testid={`file-undo-btn-${entry.display_path}`}
                          onClick={() =>
                            void runAction("undo", { path: entry.path })
                          }
                        >
                          Undo
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={isRowBusy}
                          data-testid={`file-keep-btn-${entry.display_path}`}
                          onClick={() =>
                            void runAction("keep", { path: entry.path })
                          }
                        >
                          Keep
                        </Button>
                      </>
                    )}

                    {entry.status === "undone" && entry.can_redo && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isRowBusy}
                        data-testid={`file-redo-btn-${entry.display_path}`}
                        onClick={() =>
                          void runAction("redo", { path: entry.path })
                        }
                      >
                        Redo
                      </Button>
                    )}
                  </div>
                </div>

                <CollapsibleContent
                  data-testid={`file-diff-preview-${entry.display_path}`}
                >
                  <div className="border-t border-hairline-soft bg-inset">
                    {!entry.undoable ? (
                      <div className="px-3.5 py-2.5 text-xs text-muted-ink">
                        Exceeds 10 MiB snapshot limit — inline diff and snapshot
                        undo are unavailable for this file.
                      </div>
                    ) : entry.is_binary ? (
                      <div className="px-3.5 py-2.5 text-xs text-muted-ink">
                        Binary file changed — open full diff in inspector for
                        details.
                      </div>
                    ) : lines.length === 0 ? (
                      <div className="px-3.5 py-2.5 text-xs text-muted-ink">
                        No text hunks available for inline preview.
                      </div>
                    ) : (
                      <div className="overflow-x-auto py-1 font-mono text-[11.5px] leading-[1.6] tabular-nums">
                        {lines.map((line) => {
                          const tokens =
                            line.type === "hunk"
                              ? [
                                  {
                                    text: line.text,
                                    className: "text-muted-ink",
                                  },
                                ]
                              : tokenizeCodeLine(line.text)

                          return (
                            <div
                              key={line.key}
                              data-line-type={line.type}
                              className={cn(
                                "flex min-w-max border-l-2 px-2.5 py-0.5",
                                line.type === "hunk" &&
                                  "border-l-transparent bg-pane/70 py-1 text-muted-ink",
                                line.type === "add" &&
                                  "border-l-diff-add-rail bg-diff-add",
                                line.type === "del" &&
                                  "border-l-diff-del-rail bg-diff-del",
                                line.type === "ctx" && "border-l-transparent"
                              )}
                            >
                              <span
                                className={cn(
                                  "w-[36px] shrink-0 pr-2.5 text-right select-none tabular-nums",
                                  line.type === "add"
                                    ? "text-brand-text/80"
                                    : line.type === "del"
                                      ? "text-danger/80"
                                      : "text-faint"
                                )}
                              >
                                {line.lineNumber ?? ""}
                              </span>
                              <span
                                className={cn(
                                  "w-4 shrink-0 text-center select-none",
                                  line.type === "add" && "text-brand-text",
                                  line.type === "del" && "text-danger"
                                )}
                              >
                                {line.mark}
                              </span>
                              <span className="whitespace-pre">
                                {tokens.map((tok, tIdx) => (
                                  <span key={tIdx} className={tok.className}>
                                    {tok.text}
                                  </span>
                                ))}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 border-t border-hairline-soft bg-pane/60 px-3 py-1.5 text-[11px] text-muted-ink">
                      <span className="truncate">
                        {showTruncatedHint
                          ? "Showing capped preview"
                          : entry.old_path
                            ? `Renamed from ${entry.old_path}`
                            : `${entry.edit_count} ${entry.edit_count === 1 ? "edit" : "edits"} in session`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        data-testid={`file-open-full-diff-${entry.display_path}`}
                        onClick={() => openDiffFile(entry.path, sessionId)}
                      >
                        Open full diff
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>

        {hasMoreFiles && (
          <div className="border-t border-hairline-soft bg-pane/60">
            <button
              type="button"
              data-testid={
                showAllFiles
                  ? "file-summary-collapse-list-btn"
                  : "file-summary-expand-all-btn"
              }
              aria-expanded={showAllFiles}
              onClick={() =>
                setShowAllFilesSessionId(showAllFiles ? null : sessionId)
              }
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-ink transition-colors hover:bg-hover/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAllFiles ? (
                <>
                  <ChevronUp className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Show recent {DEFAULT_VISIBLE_FILES} files</span>
                </>
              ) : (
                <>
                  <ChevronDown
                    className="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    Expand all {orderedFiles.length} files (+{hiddenFileCount}{" "}
                    more)
                  </span>
                </>
              )}
            </button>
          </div>
        )}
      </section>
      {renderConflictDialog()}
    </>
  )
}
