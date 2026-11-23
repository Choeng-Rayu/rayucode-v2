import * as React from "react";
import { Check, GitPullRequest, ShieldAlert } from "lucide-react";
import type { ChangedFileView } from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TechFileBadge } from "@/components/ui/tech-file-badge";
import { cn } from "@/lib/utils";

import type { CreatePrInput } from "../hooks/useChanges";

export interface CreatePrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headBranch: string;
  defaultBaseBranch?: string;
  files: ChangedFileView[];
  totalAdditions: number;
  totalDeletions: number;
  stagedCount: number;
  isSubmitting?: boolean;
  onConfirm: (
    input: CreatePrInput,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function CreatePrDialog({
  open,
  onOpenChange,
  headBranch,
  defaultBaseBranch = "main",
  files,
  totalAdditions,
  totalDeletions,
  stagedCount,
  isSubmitting = false,
  onConfirm,
}: CreatePrDialogProps) {
  const [baseBranch, setBaseBranch] = React.useState(defaultBaseBranch);
  const [title, setTitle] = React.useState(`Merge ${headBranch}`);
  const [body, setBody] = React.useState(
    `Summary of changes across ${files.length} file(s) (+${totalAdditions} / -${totalDeletions}).`,
  );
  const [draft, setDraft] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFormError(null);
      if (!title.trim()) {
        setTitle(`Merge ${headBranch}`);
      }
    }
  }, [headBranch, open, title]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const result = await onConfirm({
      baseBranch,
      headBranch,
      title,
      body,
      draft,
    });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="create-pr-guardrail-dialog"
        className="sm:max-w-[540px]"
      >
        <DialogHeader className="min-w-0">
          <div className="mb-1 inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-medium text-warn">
            <ShieldAlert className="size-3 shrink-0" aria-hidden="true" />
            <span className="break-words">
              Explicit approval required · Review before pushing
            </span>
          </div>
          <DialogTitle>Confirm Pull Request Creation</DialogTitle>
          <DialogDescription>
            Review branch, commits, and files below before creating a pull
            request. Opening this dialog never pushes commits automatically.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-w-0 flex-col gap-3.5"
        >
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-ink">
                Head branch
              </span>
              <div
                data-testid="pr-head-branch-display"
                className="flex h-8 min-w-0 items-center rounded-md border border-hairline bg-inset px-2.5 font-mono text-xs text-ink"
              >
                <span className="truncate">{headBranch}</span>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <label
                htmlFor="pr-base-branch"
                className="text-[11px] font-medium text-muted-ink"
              >
                Target base branch
              </label>
              <input
                id="pr-base-branch"
                type="text"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="pr-title-input"
              className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="pr-body-input"
              className="text-[11px] font-medium text-muted-ink"
            >
              PR summary &amp; body
            </label>
            <textarea
              id="pr-body-input"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              data-testid="pr-body-input"
              className="w-full rounded-md border border-control-border bg-inset px-2.5 py-2 text-xs text-ink focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </div>

          {/* Included files & diff stats guardrail summary */}
          <div className="rounded-lg border border-hairline bg-pane p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted-ink tabular-nums">
              <span data-testid="pr-files-summary">
                {files.length} changed files ({stagedCount} staged)
              </span>
              <span>
                <span className="text-brand-text">+{totalAdditions}</span>{" "}
                <span className="text-danger">-{totalDeletions}</span>
              </span>
            </div>

            {files.length > 0 && (
              <div className="mt-2 flex max-h-24 flex-col gap-1 overflow-y-auto border-t border-hairline-soft pt-2">
                {files.slice(0, 8).map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between gap-2 font-mono text-[11px] text-body"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <TechFileBadge path={f.path} />
                      <span className="truncate">{f.path}</span>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      <span className="text-brand-text">+{f.additions}</span>{" "}
                      <span className="text-danger">-{f.deletions}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-body">
            <button
              type="button"
              role="checkbox"
              aria-checked={draft}
              aria-label="Open as draft pull request"
              data-testid="pr-draft-checkbox"
              onClick={() => setDraft((prev) => !prev)}
              className={cn(
                "grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border transition-colors",
                draft
                  ? "border-brand bg-brand text-brand-ink"
                  : "border-control-border bg-inset",
              )}
            >
              {draft && <Check className="size-2.5" strokeWidth={2.5} />}
            </button>
            <span>Open as draft pull request</span>
          </div>

          {formError && (
            <p data-testid="pr-guardrail-error" className="text-xs text-danger">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="pr-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
              data-testid="pr-confirm-btn"
            >
              <GitPullRequest className="size-3.5" aria-hidden="true" />
              <span>
                {isSubmitting ? "Creating PR..." : "Confirm & Create PR"}
              </span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
