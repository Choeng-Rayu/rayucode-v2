import { AlertTriangle, ExternalLink } from "lucide-react";
import type { FileChangeConflictView } from "@shared/vscodeProtocol";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TechFileBadge,
} from "@/components/ui";

export interface ConflictDialogState {
  action: "undo" | "undo_all" | "redo" | "redo_all";
  path?: string;
  conflicts: FileChangeConflictView[];
  message?: string;
}

export interface FileReviewConflictDialogProps {
  conflictPrompt: ConflictDialogState | null;
  onClose: () => void;
  onOpenDiff: (path: string) => void;
  onForceRestore: () => void | Promise<void>;
}

export function FileReviewConflictDialog({
  conflictPrompt,
  onClose,
  onOpenDiff,
  onForceRestore,
}: FileReviewConflictDialogProps) {
  return (
    <Dialog
      open={Boolean(conflictPrompt)}
      onOpenChange={(open) => {
        if (!open) onClose();
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
              "One or more files were modified on disk after the AI finished. Force Restore overwrites manual edits in the listed files."}
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
              onClick={() => onOpenDiff(conflictPrompt.conflicts[0]!.path)}
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
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="conflict-force-restore-btn"
            onClick={() => void onForceRestore()}
          >
            Force Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
