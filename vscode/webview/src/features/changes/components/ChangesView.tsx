import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { ChangesSkeleton } from "@/components/ui/page-skeletons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShellFormFactor } from "@/features/shell";
import { cn } from "@/lib/utils";

import {
  useChanges,
  type ChangesScope,
  type DiffViewMode,
} from "../hooks/useChanges";
import { CreatePrDialog } from "./CreatePrDialog";
import { DiffPanel } from "./DiffPanel";
import { FlatChangedFileRow } from "./FlatChangedFileRow";

export interface ChangesViewProps {
  className?: string;
}

export function ChangesView({ className }: ChangesViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { formFactor } = useShellFormFactor(containerRef);
  const isCompact = formFactor === "compact";

  const {
    changes,
    files,
    activeFile,
    diffLines,
    summary,
    scope,
    setScope,
    diffMode,
    setDiffMode,
    selectedPath,
    selectFile,
    inlinePreviewOpen,
    setInlinePreviewOpen,
    isLoading,
    isError,
    error,
    refetch,
    toggleStage,
    stageAll,
    isStaging,
    keepFile,
    undoFile,
    isReviewing,
    commitStaged,
    isCommitting,
    lastCommit,
    createPr,
    isCreatingPr,
    createdPr,
    actionError,
    openDiffInVsCode,
    openFileInVsCode,
    prefetchFileDiff,
  } = useChanges();

  const [commitMessage, setCommitMessage] = React.useState("");
  const [commitError, setCommitError] = React.useState<string | null>(null);
  const [prDialogOpen, setPrDialogOpen] = React.useState(false);

  const handleCommitSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setCommitError(null);
    const result = await commitStaged(commitMessage);
    if (!result.ok) {
      setCommitError(result.error);
      return;
    }
    setCommitMessage("");
  };

  if (isLoading && !changes) {
    return <ChangesSkeleton />;
  }

  if (isError || !changes) {
    return (
      <div className="mx-auto w-full max-w-[1080px] p-6">
        <ErrorState
          title="Unable to load workspace changes"
          description={
            error instanceof Error
              ? error.message
              : "The local RayuCode daemon did not return git diff information."
          }
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const allStaged =
    summary.fileCount > 0 && summary.stagedCount === summary.fileCount;

  return (
    <SectionErrorBoundary title="Changes Review Error">
      <div
        ref={containerRef}
        data-slot="changes-view"
        data-testid="changes-view"
        className={cn(
          "flex h-full min-h-0 w-full flex-1 flex-col bg-canvas",
          className,
        )}
      >
          {/* Top Branch, Staged/Unstaged Summary & Guardrail Actions Header */}
          <header
            data-slot="changes-header"
            className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-hairline bg-canvas px-4 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-hairline bg-pane px-2.5 py-0.5">
              <GitBranch
                className="size-3.5 shrink-0 text-brand-text"
                aria-hidden="true"
              />
              <span
                data-testid="changes-branch-name"
                className="truncate font-mono text-xs font-semibold text-ink"
              >
                {changes.branch}
              </span>
            </div>

            <span
              data-testid="changes-file-count"
              className="rounded-full border border-hairline bg-pane px-2.5 py-0.5 font-mono text-[11px] text-body tabular-nums"
            >
              {summary.fileCount} changed files · {summary.stagedCount} staged /{" "}
              {summary.unstagedCount} unstaged
            </span>

            <span
              data-testid="changes-diff-totals"
              className="font-mono text-xs tabular-nums"
            >
              <span className="text-brand-text">+{summary.totalAdditions}</span>{" "}
              <span className="text-danger">-{summary.totalDeletions}</span>
            </span>

            {/* Scope Toggle: Session Edits vs All Git Changes */}
            <div
              role="group"
              aria-label="Changes scope"
              className="inline-flex items-center rounded-md border border-hairline bg-pane p-[2px]"
            >
              {(
                [
                  { id: "session", label: "Session Edits" },
                  { id: "git", label: "All Git Changes" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`changes-scope-${item.id}`}
                  aria-pressed={scope === item.id}
                  onClick={() => setScope(item.id as ChangesScope)}
                  className={cn(
                    "cursor-pointer rounded-xs px-2 py-0.5 text-[11px] font-medium transition-colors",
                    scope === item.id
                      ? "border border-premium bg-active text-ink shadow-bevel-surface"
                      : "border border-transparent text-muted-ink hover:text-ink",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <span className="flex-1" />

            {/* Unified vs Split Diff Mode Toggle */}
            <Tabs
              value={diffMode}
              onValueChange={(value) => {
                if (value === "unified" || value === "split") {
                  setDiffMode(value as DiffViewMode);
                }
              }}
            >
              <TabsList aria-label="Diff view mode">
                <TabsTrigger
                  value="unified"
                  onClick={() => setDiffMode("unified")}
                  data-testid="diff-mode-unified-tab"
                >
                  Unified
                </TabsTrigger>
                <TabsTrigger
                  value="split"
                  onClick={() => setDiffMode("split")}
                  data-testid="diff-mode-split-tab"
                >
                  Split
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refetch()}
              data-testid="changes-refresh-btn"
              title="Refresh workspace changes"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>Refresh</span>
            </Button>

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => openDiffInVsCode(activeFile?.path)}
              data-testid="header-open-vscode-diff-btn"
            >
              <Columns2 className="size-3.5" aria-hidden="true" />
              <span>Open Diff in VS Code</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setPrDialogOpen(true)}
              data-testid="create-pr-btn"
            >
              <GitPullRequest className="size-3.5" aria-hidden="true" />
              <span>Create PR</span>
            </Button>
          </header>

          {actionError && (
            <div
              data-testid="changes-action-error"
              className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-xs text-danger"
            >
              {actionError}
            </div>
          )}

          {createdPr && (
            <div
              data-testid="created-pr-banner"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-brand/30 bg-brand-soft px-4 py-2 text-xs text-ink"
            >
              <div className="flex items-center gap-2">
                <GitPullRequest
                  className="size-3.5 shrink-0 text-brand-text"
                  aria-hidden="true"
                />
                <span className="font-medium">
                  Pull Request #{createdPr.number} created: {createdPr.title}
                </span>
                <span className="font-mono text-[11px] text-muted-ink">
                  {createdPr.headBranch} -&gt; {createdPr.baseBranch}
                </span>
              </div>
              <span className="font-mono text-[11px] text-brand-text">
                {createdPr.url}
              </span>
            </div>
          )}

          {/* Body: Left Flat Changed-Files List + Right DiffPanel */}
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* Flat Changed-Files Rail (NO folder tree in v1) */}
            <aside
              aria-label="Changed files"
              className="flex w-full shrink-0 flex-col border-b border-hairline bg-pane/50 lg:w-[330px] lg:border-r lg:border-b-0"
            >
              <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2 text-xs">
                <span className="font-medium text-ink">
                  Flat changed files ({summary.fileCount})
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isStaging || summary.fileCount === 0}
                  onClick={() => void stageAll(!allStaged)}
                  data-testid="stage-all-btn"
                >
                  {allStaged ? "Unstage all" : "Stage all"}
                </Button>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div
                  role="list"
                  aria-label="Flat changed files list"
                  data-testid="flat-changed-files-list"
                  className="flex flex-col gap-1 p-2"
                >
                  {files.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-muted-ink">
                      Working tree clean for this scope.
                    </div>
                  ) : (
                    files.map((file) => (
                      <FlatChangedFileRow
                        key={file.path}
                        file={file}
                        isSelected={file.path === selectedPath}
                        isCompact={isCompact}
                        isBusy={isStaging || isReviewing}
                        onSelect={selectFile}
                        onToggleStage={(f) => void toggleStage(f)}
                        onKeep={(p) => void keepFile(p)}
                        onUndo={(p) => void undoFile(p)}
                        onOpenDiff={openDiffInVsCode}
                        onOpenFile={(p) => openFileInVsCode(p, 1)}
                        onHover={prefetchFileDiff}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>

              {isCompact && activeFile && (
                <div className="border-t border-hairline px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => setInlinePreviewOpen((prev) => !prev)}
                    data-testid="compact-inline-preview-toggle"
                    className="flex w-full cursor-pointer items-center justify-between text-[11px] font-medium text-muted-ink hover:text-ink"
                  >
                    <span>Preview inline diff ({activeFile.path})</span>
                    {inlinePreviewOpen ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                </div>
              )}

              {/* Inline Commit Form */}
              <form
                onSubmit={(e) => void handleCommitSubmit(e)}
                data-testid="commit-staged-form"
                className="flex shrink-0 flex-col gap-2 border-t border-hairline bg-chrome/60 p-3"
              >
                <div className="flex items-center justify-between text-[11px] font-medium text-muted-ink">
                  <label htmlFor="changes-commit-message">
                    Commit staged ({summary.stagedCount})
                  </label>
                  <span className="font-mono tabular-nums">
                    {summary.unstagedCount} unstaged
                  </span>
                </div>
                <input
                  id="changes-commit-message"
                  type="text"
                  value={commitMessage}
                  onChange={(e) => {
                    setCommitMessage(e.target.value);
                    if (commitError) setCommitError(null);
                  }}
                  placeholder="feat(vscode): describe staged changes..."
                  data-testid="commit-message-input"
                  className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink placeholder:text-muted-ink focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                />
                {commitError && (
                  <p
                    data-testid="commit-error"
                    className="text-[11px] text-danger"
                  >
                    {commitError}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={summary.stagedCount === 0 || isCommitting}
                  data-testid="commit-staged-btn"
                  className="w-full"
                >
                  <GitCommitHorizontal className="size-3.5" aria-hidden="true" />
                  <span>
                    {isCommitting
                      ? "Committing..."
                      : `Commit ${summary.stagedCount} staged`}
                  </span>
                </Button>
                {lastCommit && (
                  <div
                    data-testid="commit-receipt"
                    className="rounded-md border border-hairline bg-pane px-2.5 py-1.5 font-mono text-[11px] text-brand-text"
                  >
                    Committed {lastCommit.commitHash} ·{" "}
                    {lastCommit.committedCount} file(s)
                  </div>
                )}
              </form>
            </aside>

            {/* Right Diff Canvas */}
            {(!isCompact || inlinePreviewOpen) && (
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-4 p-5">
                  {activeFile ? (
                    <DiffPanel
                      file={activeFile}
                      lines={diffLines}
                      mode={diffMode}
                      isBusy={isStaging || isReviewing}
                      onToggleStage={(f) => void toggleStage(f)}
                      onKeep={(p) => void keepFile(p)}
                      onUndo={(p) => void undoFile(p)}
                      onOpenDiffInVsCode={openDiffInVsCode}
                      onOpenFileInVsCode={openFileInVsCode}
                    />
                  ) : (
                    <div className="rayu-card-bevel rounded-xl bg-pane p-8 text-center text-xs text-muted-ink">
                      No changed files selected.
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Explicit Create PR Approval Guardrail Dialog */}
          <CreatePrDialog
            open={prDialogOpen}
            onOpenChange={setPrDialogOpen}
            headBranch={changes.branch}
            defaultBaseBranch={
              changes.baseBranch?.replace(/^origin\//, "") ?? "main"
            }
            files={files}
            totalAdditions={summary.totalAdditions}
            totalDeletions={summary.totalDeletions}
            stagedCount={summary.stagedCount}
            isSubmitting={isCreatingPr}
            onConfirm={createPr}
          />
      </div>
    </SectionErrorBoundary>
  );
}
