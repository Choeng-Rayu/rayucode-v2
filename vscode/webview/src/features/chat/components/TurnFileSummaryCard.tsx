import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FileDiff,
  Loader2,
  Redo2,
  RotateCcw,
} from "lucide-react";
import type {
  FileChangeActionResultView,
  FileChangeConflictView,
  FileChangeEntryView,
  FileChangeHunkView,
  FileChangeKind,
  FileChangesSnapshotView,
} from "@shared/vscodeProtocol";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TechFileBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { basenameOf, callRpc, cn, postToHost, useAppStore } from "@/lib";

const DEFAULT_VISIBLE_FILES = 3;

export interface TurnFileSummaryCardProps {
  snapshot: FileChangesSnapshotView;
  sessionId?: string;
  onSnapshotUpdated?: (snapshot: FileChangesSnapshotView) => void;
  className?: string;
}

interface ConflictDialogState {
  action: "undo" | "undo_all" | "redo" | "redo_all";
  path?: string;
  conflicts: FileChangeConflictView[];
  message?: string;
}

interface ParsedHunkRow {
  kind: "add" | "del" | "ctx";
  lineNumber: number | null;
  mark: "+" | "-" | " ";
  text: string;
}

function relativeDirOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx > 0 ? normalized.slice(0, idx) : "";
}

export function firstChangedLineOf(entry: FileChangeEntryView): number {
  const hunk = entry.previewHunks[0];
  if (!hunk) return 1;
  let oldLine = Math.max(1, hunk.oldStart || 1);
  let newLine = Math.max(1, hunk.newStart || 1);
  for (const raw of hunk.lines) {
    if (raw.startsWith("+")) {
      return newLine;
    }
    if (raw.startsWith("-")) {
      return oldLine;
    }
    oldLine += 1;
    newLine += 1;
  }
  return Math.max(1, hunk.newStart || hunk.oldStart || 1);
}

function parseHunkRows(hunk: FileChangeHunkView): ParsedHunkRow[] {
  let oldLine = Math.max(1, hunk.oldStart || 1);
  let newLine = Math.max(1, hunk.newStart || 1);
  const rows: ParsedHunkRow[] = [];

  for (const raw of hunk.lines) {
    if (raw.startsWith("+")) {
      rows.push({
        kind: "add",
        lineNumber: newLine,
        mark: "+",
        text: raw.slice(1),
      });
      newLine += 1;
    } else if (raw.startsWith("-")) {
      rows.push({
        kind: "del",
        lineNumber: oldLine,
        mark: "-",
        text: raw.slice(1),
      });
      oldLine += 1;
    } else {
      rows.push({
        kind: "ctx",
        lineNumber: newLine,
        mark: " ",
        text: raw.startsWith(" ") ? raw.slice(1) : raw,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  return rows;
}

function kindBadgeSpec(
  kind: FileChangeKind,
): { label: string; className: string } | null {
  switch (kind) {
    case "created":
      return {
        label: "New",
        className: "border-brand/30 bg-brand-soft text-brand-text",
      };
    case "deleted":
      return {
        label: "Del",
        className: "border-danger/30 bg-danger-soft text-danger",
      };
    case "renamed":
      return {
        label: "Ren",
        className: "border-info/30 bg-info-soft text-info",
      };
    default:
      return null;
  }
}

export function TurnFileSummaryCard({
  snapshot,
  sessionId,
  onSnapshotUpdated,
  className,
}: TurnFileSummaryCardProps) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setStoreSnapshot = useAppStore((s) => s.setFileChangesSnapshot);
  const resolvedSessionId =
    sessionId || snapshot.sessionId || activeSessionId || undefined;

  const [expandedPaths, setExpandedPaths] = React.useState<
    Record<string, boolean>
  >({});
  const [loadedHunksByPath, setLoadedHunksByPath] = React.useState<
    Record<string, FileChangeHunkView[]>
  >({});
  const [loadingDiffPath, setLoadingDiffPath] = React.useState<string | null>(
    null,
  );
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [conflictPrompt, setConflictPrompt] =
    React.useState<ConflictDialogState | null>(null);
  const [receiptExpanded, setReceiptExpanded] = React.useState(false);
  const [showAllFiles, setShowAllFiles] = React.useState(false);

  const files = snapshot.files;
  const orderedFiles = React.useMemo(
    () =>
      files
        .map((entry, idx) => ({ entry, idx }))
        .sort((a, b) => {
          const turnDiff =
            (b.entry.changedInLatestTurn ? 1 : 0) -
            (a.entry.changedInLatestTurn ? 1 : 0);
          if (turnDiff !== 0) return turnDiff;
          const timeDiff =
            (b.entry.updatedAtMs ?? 0) - (a.entry.updatedAtMs ?? 0);
          if (timeDiff !== 0) return timeDiff;
          return a.idx - b.idx;
        })
        .map(({ entry }) => entry),
    [files],
  );
  const hasMoreFiles = orderedFiles.length > DEFAULT_VISIBLE_FILES;
  const visibleFiles =
    hasMoreFiles && !showAllFiles
      ? orderedFiles.slice(0, DEFAULT_VISIBLE_FILES)
      : orderedFiles;
  const hiddenFileCount = Math.max(
    0,
    orderedFiles.length - DEFAULT_VISIBLE_FILES,
  );
  const pendingFiles = React.useMemo(
    () => files.filter((f) => f.status === "pending"),
    [files],
  );
  const keptFiles = React.useMemo(
    () => files.filter((f) => f.status === "kept"),
    [files],
  );
  const undoneFiles = React.useMemo(
    () => files.filter((f) => f.status === "undone"),
    [files],
  );

  const isFullyResolved = files.length > 0 && pendingFiles.length === 0;
  const hasUndoablePending = pendingFiles.some((f) => f.undoable);
  const hasRedoable = undoneFiles.some((f) => f.canRedo);
  const keptAdditions = React.useMemo(
    () => keptFiles.reduce((acc, f) => acc + f.additions, 0),
    [keptFiles],
  );
  const keptDeletions = React.useMemo(
    () => keptFiles.reduce((acc, f) => acc + f.deletions, 0),
    [keptFiles],
  );
  const displayAdditions = isFullyResolved
    ? keptAdditions
    : snapshot.totalAdditions;
  const displayDeletions = isFullyResolved
    ? keptDeletions
    : snapshot.totalDeletions;
  const latestTurnCount = React.useMemo(
    () => files.filter((f) => f.changedInLatestTurn).length,
    [files],
  );

  // Collapse back to 1-line receipt automatically when a session transitions to fully resolved
  const prevResolvedRef = React.useRef(isFullyResolved);
  React.useEffect(() => {
    if (!prevResolvedRef.current && isFullyResolved) {
      setReceiptExpanded(false);
    }
    prevResolvedRef.current = isFullyResolved;
  }, [isFullyResolved]);

  // Clear local UI caches when switching sessions
  React.useEffect(() => {
    setExpandedPaths({});
    setLoadedHunksByPath({});
    setReceiptExpanded(false);
    setShowAllFiles(false);
    setConflictPrompt(null);
    setActionError(null);
  }, [resolvedSessionId]);

  if (files.length === 0) {
    return null;
  }

  const applyActionResult = (
    res: FileChangeActionResultView,
    conflictAction?: ConflictDialogState["action"],
    targetPath?: string,
  ): void => {
    if (res.snapshot) {
      const targetSid = res.snapshot.sessionId || resolvedSessionId;
      if (targetSid) {
        setStoreSnapshot(targetSid, res.snapshot);
      }
      onSnapshotUpdated?.(res.snapshot);
    }

    const conflicts = res.conflicts ?? [];
    if (conflicts.length > 0 && conflictAction) {
      setConflictPrompt({
        action: conflictAction,
        path: targetPath,
        conflicts,
        message: res.message,
      });
      return;
    }

    if (res.conflict && conflictAction) {
      const fallbackPath = targetPath ?? files[0]?.path ?? "";
      const fallbackDisplay =
        files.find((f) => f.path === fallbackPath)?.displayPath ?? fallbackPath;
      setConflictPrompt({
        action: conflictAction,
        path: targetPath,
        conflicts: [
          {
            path: fallbackPath,
            displayPath: fallbackDisplay,
            reason:
              res.message ??
              "File has manual edits made after the AI snapshot.",
          },
        ],
        message: res.message,
      });
      return;
    }

    if (!res.ok) {
      setActionError(res.message ?? "Unable to apply file change action.");
      return;
    }

    setActionError(null);
  };

  const openFileInEditor = (entry: FileChangeEntryView): void => {
    if (entry.kind === "deleted" && entry.status !== "undone") {
      openDiffInVsCode(entry.path || entry.displayPath);
      return;
    }
    postToHost({
      type: "rayucode.editor.openFile",
      path: entry.path || entry.displayPath,
      line: firstChangedLineOf(entry),
    });
  };

  const openDiffInVsCode = (targetPath: string): void => {
    postToHost({
      type: "rayucode.editor.openDiff",
      path: targetPath,
      sessionId: resolvedSessionId,
      scope: "session",
    });
  };

  const handleToggleRow = (entry: FileChangeEntryView, open: boolean): void => {
    setExpandedPaths((prev) => ({ ...prev, [entry.path]: open }));
    const cacheKey = `${resolvedSessionId ?? ""}:${entry.path}:${entry.updatedAtMs}`;
    if (
      open &&
      !entry.isBinary &&
      entry.undoable &&
      entry.previewHunks.length === 0 &&
      !loadedHunksByPath[cacheKey]
    ) {
      setLoadingDiffPath(entry.path);
      void callRpc("changes.diff", {
        path: entry.path,
        sessionId: resolvedSessionId,
        scope: "session",
      })
        .then((diff) => {
          if (diff.hunks && diff.hunks.length > 0) {
            setLoadedHunksByPath((prev) => ({
              ...prev,
              [cacheKey]: diff.hunks!,
            }));
          } else if (diff.unifiedDiff.trim()) {
            const rawLines = diff.unifiedDiff.replace(/\r\n/g, "\n").split("\n");
            const fallbackLines = rawLines.filter(
              (l) =>
                !l.startsWith("diff --git") &&
                !l.startsWith("index ") &&
                !l.startsWith("--- ") &&
                !l.startsWith("+++ ") &&
                !l.startsWith("@@"),
            );
            const headerLine =
              rawLines.find((l) => l.startsWith("@@")) ?? "@@ -1 +1 @@";
            setLoadedHunksByPath((prev) => ({
              ...prev,
              [cacheKey]: [
                {
                  oldStart: 1,
                  oldLines: entry.deletions,
                  newStart: 1,
                  newLines: entry.additions,
                  header: headerLine,
                  lines: fallbackLines,
                },
              ],
            }));
          }
        })
        .catch(() => {
          // Inline diff fallback stays quiet; user can still click Open in VS Code Diff
        })
        .finally(() => {
          setLoadingDiffPath((cur) => (cur === entry.path ? null : cur));
        });
    }
  };

  const runKeepFile = async (entry: FileChangeEntryView): Promise<void> => {
    setBusyKey(`keep:${entry.path}`);
    setActionError(null);
    try {
      const res = await callRpc("changes.keep", {
        path: entry.path,
        sessionId: resolvedSessionId,
      });
      applyActionResult(res);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to keep file changes.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const runUndoFile = async (
    entryPath: string,
    force = false,
  ): Promise<void> => {
    setBusyKey(`undo:${entryPath}`);
    setActionError(null);
    try {
      const res = await callRpc("changes.undo", {
        path: entryPath,
        sessionId: resolvedSessionId,
        ...(force ? { force: true } : {}),
      });
      applyActionResult(res, force ? undefined : "undo", entryPath);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to undo file changes.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const runRedoFile = async (
    entryPath: string,
    force = false,
  ): Promise<void> => {
    setBusyKey(`redo:${entryPath}`);
    setActionError(null);
    try {
      const res = await callRpc("changes.redo", {
        path: entryPath,
        sessionId: resolvedSessionId,
        ...(force ? { force: true } : {}),
      });
      applyActionResult(res, force ? undefined : "redo", entryPath);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to redo file changes.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const runBatchAction = async (
    action: "keep_all" | "undo_all" | "redo_all",
    force = false,
  ): Promise<void> => {
    setBusyKey(`batch:${action}`);
    setActionError(null);
    try {
      let res: FileChangeActionResultView;
      if (action === "keep_all") {
        res = await callRpc("changes.keepAll", {
          sessionId: resolvedSessionId,
        });
        applyActionResult(res);
      } else if (action === "undo_all") {
        res = await callRpc("changes.undoAll", {
          sessionId: resolvedSessionId,
          ...(force ? { force: true } : {}),
        });
        applyActionResult(res, force ? undefined : "undo_all");
      } else {
        res = await callRpc("changes.redoAll", {
          sessionId: resolvedSessionId,
          ...(force ? { force: true } : {}),
        });
        applyActionResult(res, force ? undefined : "redo_all");
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to apply batch action.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleForceRestore = async (): Promise<void> => {
    if (!conflictPrompt) return;
    const target = conflictPrompt;
    setConflictPrompt(null);
    if (target.action === "undo" && target.path) {
      await runUndoFile(target.path, true);
    } else if (target.action === "redo" && target.path) {
      await runRedoFile(target.path, true);
    } else if (target.action === "undo_all") {
      await runBatchAction("undo_all", true);
    } else if (target.action === "redo_all") {
      await runBatchAction("redo_all", true);
    }
  };

  const fileWord = files.length === 1 ? "file" : "files";
  const isBusy = busyKey !== null;

  const conflictDialog = (
    <Dialog
      open={Boolean(conflictPrompt)}
      onOpenChange={(open) => {
        if (!open) setConflictPrompt(null);
      }}
    >
      <DialogContent data-testid="file-change-conflict-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              className="size-4 shrink-0 text-warn"
              aria-hidden="true"
            />
            <span>Manual edits conflict</span>
          </DialogTitle>
          <DialogDescription>
            {conflictPrompt?.message ||
              "One or more files were modified on disk after the AI finished. Review the diff or force restore to overwrite manual edits."}
          </DialogDescription>
        </DialogHeader>

        {conflictPrompt && conflictPrompt.conflicts.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-inset p-2.5">
            {conflictPrompt.conflicts.map((conflict) => (
              <div
                key={conflict.path}
                className="flex flex-col gap-0.5 text-xs"
              >
                <div className="flex items-center gap-1.5">
                  <TechFileBadge path={conflict.displayPath} />
                  <span className="truncate font-mono font-medium text-ink">
                    {conflict.displayPath}
                  </span>
                </div>
                <span className="pl-5 text-[11px] text-muted-ink">
                  {conflict.reason}
                </span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {conflictPrompt?.conflicts[0] && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="conflict-open-diff-btn"
              onClick={() => {
                const target = conflictPrompt.conflicts[0]!.path;
                openDiffInVsCode(target);
              }}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span>Open in VS Code Diff</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="conflict-cancel-btn"
            onClick={() => setConflictPrompt(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="conflict-force-restore-btn"
            onClick={() => void handleForceRestore()}
          >
            Force Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // Collapsed 1-line resolved receipt when all files are kept or undone
  if (isFullyResolved && !receiptExpanded) {
    const allKept = undoneFiles.length === 0;
    const allUndone = keptFiles.length === 0;
    return (
      <>
        <div
          data-slot="turn-file-summary-receipt"
          data-testid="turn-file-summary-receipt"
          className={cn(
            "@container/file-summary rayu-card-bevel flex flex-wrap items-center justify-between gap-2 rounded-xl bg-pane px-3 py-2 text-xs shadow-diff-card",
            className,
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {allUndone ? (
              <RotateCcw
                className="size-3.5 shrink-0 text-warn"
                aria-hidden="true"
              />
            ) : (
              <Check
                className="size-3.5 shrink-0 text-brand-text"
                aria-hidden="true"
              />
            )}
            <span className="font-medium text-ink">
              {allKept
                ? `Kept ${files.length} ${fileWord}`
                : allUndone
                  ? `Undid ${files.length} ${fileWord}`
                  : `Reviewed ${files.length} ${fileWord} (${keptFiles.length} kept, ${undoneFiles.length} undone)`}
            </span>
            {!allUndone && (keptAdditions > 0 || keptDeletions > 0) && (
              <span className="font-mono text-[11px] tabular-nums">
                <span className="text-brand-text">+{keptAdditions}</span>{" "}
                <span className="text-danger">−{keptDeletions}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {hasRedoable && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={isBusy}
                data-testid="file-summary-redo-all-btn"
                onClick={() => void runBatchAction("redo_all")}
              >
                <Redo2 className="size-3" aria-hidden="true" />
                <span>Redo all</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="file-summary-receipt-expand-btn"
              onClick={() => setReceiptExpanded(true)}
              aria-label="Expand file change details"
            >
              <span>Details</span>
              <ChevronDown className="size-3" aria-hidden="true" />
            </Button>
          </div>
        </div>
        {conflictDialog}
      </>
    );
  }

  return (
    <>
      <section
        data-slot="turn-file-summary-card"
        data-testid="turn-file-summary-card"
        aria-label="Turn file changes summary"
        className={cn(
          "@container/file-summary rayu-card-bevel overflow-hidden rounded-xl bg-pane shadow-diff-card",
          className,
        )}
      >
        {/* Responsive Summary Header */}
        <header className="flex flex-col gap-2 border-b border-hairline px-3 py-2 @min-[480px]/file-summary:flex-row @min-[480px]/file-summary:items-center @min-[480px]/file-summary:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <FileDiff
              className="size-3.5 shrink-0 text-muted-ink"
              aria-hidden="true"
            />
            <span
              data-testid="file-summary-count"
              className="font-medium text-ink"
            >
              {files.length} {fileWord} changed
            </span>
            {latestTurnCount > 0 && latestTurnCount < files.length && (
              <span
                data-testid="file-summary-turn-count"
                className="text-[11px] text-muted-ink"
              >
                · {latestTurnCount} in this turn
              </span>
            )}
            <span
              data-testid="file-summary-stats"
              className="font-mono text-[11px] tabular-nums"
            >
              <span className="text-brand-text">+{displayAdditions}</span>{" "}
              <span className="text-danger">−{displayDeletions}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {pendingFiles.length > 0 ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isBusy || !hasUndoablePending}
                  data-testid="file-summary-undo-all-btn"
                  onClick={() => void runBatchAction("undo_all")}
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  <span>Undo all</span>
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="xs"
                  disabled={isBusy}
                  data-testid="file-summary-keep-all-btn"
                  onClick={() => void runBatchAction("keep_all")}
                >
                  <Check className="size-3" aria-hidden="true" />
                  <span>Keep all</span>
                </Button>
              </>
            ) : (
              <>
                {hasRedoable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={isBusy}
                    data-testid="file-summary-redo-all-btn"
                    onClick={() => void runBatchAction("redo_all")}
                  >
                    <Redo2 className="size-3" aria-hidden="true" />
                    <span>Redo all</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  data-testid="file-summary-receipt-collapse-btn"
                  onClick={() => setReceiptExpanded(false)}
                  aria-label="Collapse resolved file changes summary"
                >
                  <ChevronUp className="size-3" aria-hidden="true" />
                  <span>Collapse</span>
                </Button>
              </>
            )}
          </div>
        </header>

        {actionError && (
          <div
            data-testid="file-summary-error"
            className="flex items-center justify-between gap-2 border-b border-danger/30 bg-danger-soft px-3 py-1.5 text-[11px] text-danger"
          >
            <span className="min-w-0 truncate">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="shrink-0 cursor-pointer font-medium hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Per-File Collapsible Rows */}
        <div role="list" className="divide-y divide-hairline-soft">
          {visibleFiles.map((entry) => {
            const isExpanded = Boolean(expandedPaths[entry.path]);
            const baseName = basenameOf(entry.displayPath);
            const relDir = relativeDirOf(entry.displayPath);
            const kindBadge = kindBadgeSpec(entry.kind);
            const cacheKey = `${resolvedSessionId ?? ""}:${entry.path}:${entry.updatedAtMs}`;
            const hunks =
              entry.previewHunks.length > 0
                ? entry.previewHunks
                : (loadedHunksByPath[cacheKey] ?? []);
            const isLoadingRowDiff = loadingDiffPath === entry.path;

            return (
              <Collapsible
                key={entry.path}
                open={isExpanded}
                onOpenChange={(open) => handleToggleRow(entry, open)}
              >
                <div
                  role="listitem"
                  data-testid={`file-summary-row-${entry.displayPath}`}
                  data-status={entry.status}
                  className="flex flex-col"
                >
                  <div className="flex flex-col gap-1.5 px-2.5 py-2 transition-colors hover:bg-hover/60 @min-[480px]/file-summary:flex-row @min-[480px]/file-summary:items-center @min-[480px]/file-summary:gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          data-testid={`file-summary-toggle-${entry.displayPath}`}
                          aria-label={`Toggle inline diff for ${entry.displayPath}`}
                          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {isExpanded ? (
                            <ChevronDown
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronRight
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </CollapsibleTrigger>

                      <TechFileBadge path={entry.displayPath} />

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            data-testid={`file-summary-open-file-${entry.displayPath}`}
                            onClick={() => openFileInEditor(entry)}
                            className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 text-left transition-colors hover:text-brand-text focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <span className="truncate font-mono text-xs font-medium text-ink group-hover:text-brand-text">
                              {baseName}
                            </span>
                            {relDir && (
                              <span className="hidden truncate font-mono text-[11px] text-muted-ink @min-[360px]/file-summary:inline">
                                {relDir}
                              </span>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>
                            Open {entry.displayPath}:{firstChangedLineOf(entry)}{" "}
                            in VS Code
                          </span>
                        </TooltipContent>
                      </Tooltip>

                      {kindBadge && (
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-1.5 py-px font-mono text-[10px] font-medium",
                            kindBadge.className,
                          )}
                        >
                          {kindBadge.label}
                        </span>
                      )}

                      {entry.status === "kept" && (
                        <span
                          data-testid={`file-summary-status-${entry.displayPath}`}
                          className="shrink-0 rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand-text"
                        >
                          Kept
                        </span>
                      )}
                      {entry.status === "undone" && (
                        <span
                          data-testid={`file-summary-status-${entry.displayPath}`}
                          className="shrink-0 rounded-full bg-warn-soft px-1.5 py-px text-[10px] font-medium text-warn"
                        >
                          Undone
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pl-6 @min-[480px]/file-summary:justify-end @min-[480px]/file-summary:pl-0">
                      <span className="shrink-0 font-mono text-[11px] tabular-nums">
                        {entry.isBinary ? (
                          <span className="text-muted-ink">binary</span>
                        ) : (
                          <>
                            <span className="text-brand-text">
                              +{entry.additions}
                            </span>{" "}
                            <span className="text-danger">
                              −{entry.deletions}
                            </span>
                          </>
                        )}
                      </span>

                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              data-testid={`file-summary-diff-${entry.displayPath}`}
                              onClick={() =>
                                openDiffInVsCode(
                                  entry.path || entry.displayPath,
                                )
                              }
                            >
                              <ExternalLink
                                className="size-3"
                                aria-hidden="true"
                              />
                              <span>Diff</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <span>Open side-by-side diff in VS Code</span>
                          </TooltipContent>
                        </Tooltip>

                        {entry.status === "pending" && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  disabled={isBusy || !entry.undoable}
                                  data-testid={`file-summary-undo-${entry.displayPath}`}
                                  onClick={() => void runUndoFile(entry.path)}
                                >
                                  <RotateCcw
                                    className="size-3 text-danger"
                                    aria-hidden="true"
                                  />
                                  <span>Undo</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <span>
                                  {entry.undoable
                                    ? "Restore pre-edit snapshot"
                                    : "Exceeds 10 MiB snapshot limit — undo unavailable"}
                                </span>
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  disabled={isBusy}
                                  data-testid={`file-summary-keep-${entry.displayPath}`}
                                  onClick={() => void runKeepFile(entry)}
                                >
                                  <Check
                                    className="size-3 text-brand-text"
                                    aria-hidden="true"
                                  />
                                  <span>Keep</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <span>Keep edits in this file</span>
                              </TooltipContent>
                            </Tooltip>
                          </>
                        )}

                        {entry.status === "undone" && entry.canRedo && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                disabled={isBusy}
                                data-testid={`file-summary-redo-${entry.displayPath}`}
                                onClick={() => void runRedoFile(entry.path)}
                              >
                                <Redo2
                                  className="size-3 text-brand-text"
                                  aria-hidden="true"
                                />
                                <span>Redo</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <span>Re-apply undone edits</span>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>

                  <CollapsibleContent>
                    <div
                      data-testid={`file-summary-inline-diff-${entry.displayPath}`}
                      className="border-t border-hairline-soft bg-inset"
                    >
                      {!entry.undoable ? (
                        <div className="px-3 py-3 text-xs text-muted-ink">
                          Exceeds 10 MiB snapshot limit — inline diff and
                          snapshot undo are unavailable for this file.
                        </div>
                      ) : entry.isBinary ? (
                        <div className="px-3 py-3 text-xs text-muted-ink">
                          Binary file changed — open native VS Code diff to
                          inspect.
                        </div>
                      ) : isLoadingRowDiff ? (
                        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-ink">
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          <span>Loading diff preview...</span>
                        </div>
                      ) : hunks.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-muted-ink">
                          No inline diff hunks available. Open in VS Code Diff
                          to inspect full contents.
                        </div>
                      ) : (
                        <div className="max-h-[280px] overflow-auto p-1.5 font-mono text-xs leading-[1.55] tabular-nums">
                          {hunks.map((hunk, hunkIdx) => {
                            const rows = parseHunkRows(hunk);
                            return (
                              <div
                                key={`${entry.path}-hunk-${hunkIdx}`}
                                className="mb-1.5 last:mb-0"
                              >
                                {hunk.header && (
                                  <div className="rounded-xs bg-pane/70 px-2.5 py-0.5 text-[11px] text-muted-ink">
                                    {hunk.header}
                                  </div>
                                )}
                                {rows.map((row, rowIdx) => (
                                  <div
                                    key={`${entry.path}-h-${hunkIdx}-l-${rowIdx}`}
                                    data-line-type={row.kind}
                                    className={cn(
                                      "flex min-w-max border-l-2 px-2 py-px",
                                      row.kind === "add" &&
                                        "border-l-diff-add-rail bg-diff-add",
                                      row.kind === "del" &&
                                        "border-l-diff-del-rail bg-diff-del",
                                      row.kind === "ctx" &&
                                        "border-l-transparent",
                                    )}
                                  >
                                    <span className="w-9 shrink-0 pr-2 text-right text-faint select-none">
                                      {row.lineNumber ?? ""}
                                    </span>
                                    <span
                                      className={cn(
                                        "w-4 shrink-0 text-center select-none",
                                        row.kind === "add" && "text-brand-text",
                                        row.kind === "del" && "text-danger",
                                        row.kind === "ctx" && "text-muted-ink",
                                      )}
                                    >
                                      {row.mark}
                                    </span>
                                    <span
                                      className={cn(
                                        "whitespace-pre",
                                        row.kind === "add" && "text-ink",
                                        row.kind === "del" && "text-body",
                                        row.kind === "ctx" && "text-body",
                                      )}
                                    >
                                      {row.text}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline-soft bg-pane/70 px-3 py-1.5 text-[11px]">
                        <span className="text-muted-ink">
                          {entry.previewTruncated
                            ? "Preview truncated — open full side-by-side diff in VS Code"
                            : entry.oldPath
                              ? `Renamed from ${entry.oldPath}`
                              : entry.displayPath}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          data-testid={`file-summary-inline-open-diff-${entry.displayPath}`}
                          onClick={() =>
                            openDiffInVsCode(entry.path || entry.displayPath)
                          }
                        >
                          <ExternalLink
                            className="size-3"
                            aria-hidden="true"
                          />
                          <span>Open in VS Code Diff</span>
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
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
              onClick={() => setShowAllFiles((prev) => !prev)}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-ink transition-colors hover:bg-hover/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
      {conflictDialog}
    </>
  );
}
