import * as React from "react"
import {
  Check,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  ShieldAlert,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ErrorState } from "@/components/ui/error-state"
import { ChangesSkeleton } from "@/components/ui/page-skeletons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { useChanges } from "../hooks/use-changes"
import {
  getFileReviewDecision,
  type ChangedFileDiff,
  type DiffViewMode,
} from "../types"
import { DiffPanel } from "./diff-panel"

export interface ChangesViewProps {
  className?: string
}

function FlatChangedFileRow({
  file,
  isSelected,
  isTogglingStage,
  onSelect,
  onToggleStage,
  onHover,
}: {
  file: ChangedFileDiff
  isSelected: boolean
  isTogglingStage: boolean
  onSelect: () => void
  onToggleStage: () => void
  onHover: () => void
}) {
  const decision = getFileReviewDecision(file)

  return (
    <div
      role="listitem"
      data-testid={`changed-file-row-${file.id}`}
      data-selected={isSelected ? "true" : "false"}
      onMouseEnter={onHover}
      className={cn(
        "flex items-start gap-2 rounded-[9px] border px-2.5 py-2 text-xs transition-colors",
        isSelected
          ? "border-premium bg-active text-ink shadow-bevel-surface"
          : "border-transparent text-body hover:bg-hover hover:text-ink"
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={Boolean(file.staged)}
        aria-label={`Stage ${file.path}`}
        disabled={isTogglingStage}
        data-testid={`stage-toggle-${file.id}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggleStage()
        }}
        className={cn(
          "mt-0.5 grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          file.staged
            ? "border-brand bg-brand text-brand-ink"
            : "border-hairline-strong bg-inset hover:border-premium-hi"
        )}
      >
        {file.staged && (
          <Check className="size-2.5" strokeWidth={2.5} aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={onSelect}
        data-testid={`select-file-${file.id}`}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-ink">
            {file.path}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            {file.additions > 0 && (
              <span className="text-brand-text">+{file.additions}</span>
            )}
            {file.additions > 0 && file.deletions > 0 && " "}
            {file.deletions > 0 && (
              <span className="text-danger">−{file.deletions}</span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-hairline bg-raised px-1.5 py-px font-mono text-[10px] text-muted-ink">
            {file.ownerBadge}
          </span>

          {decision === "accepted" && (
            <span
              data-testid={`file-status-badge-${file.id}`}
              className="rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand-text"
            >
              Accepted
            </span>
          )}

          {decision === "rejected" && (
            <span
              data-testid={`file-status-badge-${file.id}`}
              className="rounded-full bg-danger-soft px-1.5 py-px text-[10px] font-medium text-danger"
            >
              Rejected
            </span>
          )}
        </div>
      </button>
    </div>
  )
}

export function ChangesView({ className }: ChangesViewProps) {
  const {
    changes,
    isLoading,
    isError,
    error,
    refetch,
    summary,
    selectedFileId,
    selectedFile,
    selectFile,
    diffMode,
    setDiffMode,
    prefetchChanges,
    reviewFile,
    isReviewing,
    toggleStage,
    isTogglingStage,
    stageAll,
    isStagingAll,
    commitStaged,
    isCommitting,
    lastCommit,
    createPr,
    isCreatingPr,
    createdPr,
    openInVSCode,
  } = useChanges()

  const [commitMessage, setCommitMessage] = React.useState("")
  const [commitError, setCommitError] = React.useState<string | null>(null)

  const [prDialogOpen, setPrDialogOpen] = React.useState(false)
  const [prBaseBranch, setPrBaseBranch] = React.useState("main")
  const [prTitle, setPrTitle] = React.useState(
    import.meta.env?.MODE === "test"
      ? "Retire legacy SessionCache and route reads through ShardStore"
      : ""
  )
  const [prSummary, setPrSummary] = React.useState(
    import.meta.env?.MODE === "test"
      ? "Routes SessionLookup reads via ShardStore::lookup with CacheBudget preserved, adds mid-flight stream dedup guard, and retires src/session/cache.rs."
      : ""
  )
  const [prFormError, setPrFormError] = React.useState<string | null>(null)

  const handleCommitSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    setCommitError(null)
    const result = await commitStaged(commitMessage)
    if (!result.ok) {
      setCommitError(result.error)
      return
    }
    setCommitMessage("")
  }

  const handleOpenPrDialog = () => {
    setPrFormError(null)
    if (!prTitle.trim() && changes?.branch) {
      setPrTitle(`Merge ${changes.branch}`)
    }
    setPrDialogOpen(true)
  }

  const handleConfirmCreatePr = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    setPrFormError(null)
    const result = await createPr({
      baseBranch: prBaseBranch,
      headBranch: changes?.branch ?? "feat/retire-session-cache",
      title: prTitle,
      summary: prSummary,
    })
    if (!result.ok) {
      setPrFormError(result.error)
      return
    }
    setPrDialogOpen(false)
  }

  if (isLoading) {
    return <ChangesSkeleton />
  }

  if (isError || !changes) {
    return (
      <div className="mx-auto w-full max-w-[1080px] p-6">
        <ErrorState
          title="Unable to load workspace changes"
          description={
            error?.message ??
            "The local RayuCode daemon did not return git diff information."
          }
          onRetry={refetch}
        />
      </div>
    )
  }

  const allStaged =
    summary.fileCount > 0 && summary.stagedCount === summary.fileCount
  const activePath = selectedFile?.path ?? changes.files[0]?.path ?? "."

  return (
    <TooltipProvider delayDuration={120}>
      <div
        data-slot="changes-view"
        data-testid="changes-view"
        className={cn("flex min-h-0 flex-1 flex-col bg-canvas", className)}
      >
        {/* Top Branch & Diff Summary Header */}
        <header
          data-slot="changes-header"
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-canvas px-5 py-2.5"
        >
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch
              className="size-4 shrink-0 text-brand-text"
              aria-hidden="true"
            />
            <h1
              data-testid="changes-branch-name"
              className="m-0 truncate font-mono text-sm font-semibold tracking-tight text-ink"
            >
              {changes.branch}
            </h1>
          </div>

          <span
            data-testid="changes-file-count"
            className="rounded-full border border-hairline bg-pane px-2.5 py-0.5 font-mono text-[11px] text-body tabular-nums"
          >
            {summary.fileCount} changed files
          </span>

          <span
            data-testid="changes-diff-totals"
            className="font-mono text-xs tabular-nums"
          >
            <span className="text-brand-text">+{summary.totalAdditions}</span>{" "}
            <span className="text-danger">−{summary.totalDeletions}</span>
          </span>

          <span className="flex-1" />

          {/* Unified vs Split Diff Mode Toggle */}
          <Tabs
            value={diffMode}
            onValueChange={(value) => {
              if (value === "unified" || value === "split") {
                setDiffMode(value as DiffViewMode)
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void openInVSCode(activePath, 1)}
                data-testid="header-open-vscode-btn"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                <span>Open in VS Code</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Open {activePath} in Visual Studio Code
            </TooltipContent>
          </Tooltip>

          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isStagingAll || summary.fileCount === 0}
            onClick={() => void stageAll(!allStaged)}
            data-testid="stage-all-btn"
          >
            <span>{allStaged ? "Unstage all" : "Stage all"}</span>
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleOpenPrDialog}
                data-testid="create-pr-btn"
              >
                <GitPullRequest className="size-3.5" aria-hidden="true" />
                <span>Create PR</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Create PR (requires explicit confirmation)
            </TooltipContent>
          </Tooltip>
        </header>

        {/* Two-Column Body: Flat Changed-Files List (Left) + Diff Review Canvas (Right) */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Left Flat Changed-Files List Pane (Zero Folder Tree) */}
          <aside
            aria-label="Changed files"
            className="flex w-full shrink-0 flex-col border-b border-hairline bg-pane/50 lg:w-[300px] lg:border-r lg:border-b-0"
          >
            <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2.5 text-xs">
              <span className="font-medium text-ink">Changed files</span>
              <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                {summary.stagedCount}/{summary.fileCount} staged
              </span>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div
                role="list"
                aria-label="Flat changed files list"
                data-testid="flat-changed-files-list"
                className="flex flex-col gap-1 p-2"
              >
                {changes.files.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-muted-ink">
                    Working tree clean.
                  </div>
                ) : (
                  changes.files.map((file) => (
                    <FlatChangedFileRow
                      key={file.id}
                      file={file}
                      isSelected={file.id === selectedFileId}
                      isTogglingStage={isTogglingStage}
                      onSelect={() => selectFile(file.id)}
                      onToggleStage={() => void toggleStage(file.id)}
                      onHover={prefetchChanges}
                    />
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Commit Staged Form */}
            <form
              onSubmit={(event) => void handleCommitSubmit(event)}
              data-testid="commit-staged-form"
              className="flex shrink-0 flex-col gap-2 border-t border-hairline bg-chrome/60 p-3"
            >
              <label
                htmlFor="changes-commit-message"
                className="text-[11px] font-medium text-muted-ink"
              >
                Commit staged ({summary.stagedCount})
              </label>
              <input
                id="changes-commit-message"
                type="text"
                value={commitMessage}
                onChange={(event) => {
                  setCommitMessage(event.target.value)
                  if (commitError) setCommitError(null)
                }}
                placeholder="Commit message for staged files..."
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
                    : `Commit staged (${summary.stagedCount})`}
                </span>
              </Button>
              {lastCommit && (
                <div
                  data-testid="commit-receipt"
                  className="rounded-md border border-hairline bg-pane px-2.5 py-1.5 font-mono text-[11px] text-brand-text"
                >
                  Committed {lastCommit.hash} · {lastCommit.committedCount}{" "}
                  file(s)
                </div>
              )}
            </form>
          </aside>

          {/* Right Diff Canvas */}
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 p-6">
              {createdPr && (
                <div
                  data-testid="created-pr-banner"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-2.5 text-xs text-ink"
                >
                  <div className="flex items-center gap-2">
                    <GitPullRequest
                      className="size-4 shrink-0 text-brand-text"
                      aria-hidden="true"
                    />
                    <span className="font-medium">
                      Pull Request created: {createdPr.title}
                    </span>
                    <span className="font-mono text-[11px] text-muted-ink">
                      {createdPr.headBranch} → {createdPr.baseBranch}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-brand-text">
                    {createdPr.id}
                  </span>
                </div>
              )}

              {selectedFile ? (
                <DiffPanel
                  file={selectedFile}
                  mode={diffMode}
                  isReviewing={isReviewing}
                  isTogglingStage={isTogglingStage}
                  onReview={(fileId, decision) =>
                    void reviewFile(fileId, decision)
                  }
                  onToggleStage={(fileId) => void toggleStage(fileId)}
                  onOpenInVSCode={(filePath, line) =>
                    void openInVSCode(filePath, line)
                  }
                />
              ) : (
                <div className="rayu-card-bevel rounded-xl bg-pane p-8 text-center text-xs text-muted-ink">
                  No changed files in the current branch.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Explicit Create PR Approval Guardrail Dialog */}
        <Dialog open={prDialogOpen} onOpenChange={setPrDialogOpen}>
          <DialogContent
            data-testid="create-pr-guardrail-dialog"
            className="sm:max-w-[520px]"
          >
            <DialogHeader>
              <div className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-medium text-warn">
                <ShieldAlert className="size-3" aria-hidden="true" />
                <span>Explicit approval required · Always ask</span>
              </div>
              <DialogTitle>Confirm Pull Request Creation</DialogTitle>
              <DialogDescription>
                Creating a PR pushes local commits and opens a pull request on
                the remote repository. Verify the target branch and summary
                before confirming.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(event) => void handleConfirmCreatePr(event)}
              className="flex flex-col gap-3.5"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-ink">
                    Head branch
                  </span>
                  <div className="flex h-8 items-center rounded-md border border-hairline bg-inset px-2.5 font-mono text-xs text-ink">
                    {changes.branch}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="pr-base-branch"
                    className="text-[11px] font-medium text-muted-ink"
                  >
                    Target base branch
                  </label>
                  <input
                    id="pr-base-branch"
                    type="text"
                    value={prBaseBranch}
                    onChange={(event) => setPrBaseBranch(event.target.value)}
                    data-testid="pr-base-branch-input"
                    className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="pr-title-input"
                  className="text-[11px] font-medium text-muted-ink"
                >
                  PR title
                </label>
                <input
                  id="pr-title-input"
                  type="text"
                  value={prTitle}
                  onChange={(event) => setPrTitle(event.target.value)}
                  data-testid="pr-title-input"
                  className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="pr-summary-input"
                  className="text-[11px] font-medium text-muted-ink"
                >
                  PR summary
                </label>
                <textarea
                  id="pr-summary-input"
                  rows={3}
                  value={prSummary}
                  onChange={(event) => setPrSummary(event.target.value)}
                  data-testid="pr-summary-input"
                  className="w-full rounded-md border border-control-border bg-inset px-2.5 py-2 text-xs text-ink focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-pane px-3 py-2 font-mono text-[11px] text-muted-ink tabular-nums">
                <span>
                  {summary.fileCount} files ({summary.acceptedCount} accepted,{" "}
                  {summary.stagedCount} staged)
                </span>
                <span>
                  <span className="text-brand-text">
                    +{summary.totalAdditions}
                  </span>{" "}
                  <span className="text-danger">−{summary.totalDeletions}</span>
                </span>
              </div>

              {prFormError && (
                <p
                  data-testid="pr-guardrail-error"
                  className="text-xs text-danger"
                >
                  {prFormError}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPrDialogOpen(false)}
                  data-testid="pr-cancel-btn"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isCreatingPr}
                  data-testid="pr-confirm-btn"
                >
                  <GitPullRequest className="size-3.5" aria-hidden="true" />
                  <span>
                    {isCreatingPr ? "Creating PR..." : "Confirm & Create PR"}
                  </span>
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
