import * as React from "react";
import { Check, ExternalLink, FileCode2, RotateCcw } from "lucide-react";
import type { ChangedFileStatus, ChangedFileView } from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import { TechFileBadge } from "@/components/ui/tech-file-badge";
import { basenameOf, cn } from "@/lib/utils";

export interface FlatChangedFileRowProps {
  file: ChangedFileView;
  isSelected: boolean;
  isCompact?: boolean;
  isBusy?: boolean;
  onSelect: (path: string) => void;
  onToggleStage: (file: ChangedFileView) => void;
  onKeep: (path: string) => void;
  onUndo: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onHover?: (path: string) => void;
}

const STATUS_CODE: Record<ChangedFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

function relativeDirOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx > 0 ? normalized.slice(0, idx) : "";
}

export function FlatChangedFileRow({
  file,
  isSelected,
  isCompact = false,
  isBusy = false,
  onSelect,
  onToggleStage,
  onKeep,
  onUndo,
  onOpenDiff,
  onOpenFile,
  onHover,
}: FlatChangedFileRowProps) {
  const baseName = basenameOf(file.path);
  const relDir = relativeDirOf(file.path);
  const ownerLabel = file.ownerBadge ?? (file.fromSession ? "agent" : "user");
  const statusShort = STATUS_CODE[file.status] ?? "M";

  const handleRowClick = () => {
    onSelect(file.path);
    if (isCompact) {
      onOpenDiff(file.path);
    }
  };

  return (
    <div
      role="listitem"
      data-testid={`changed-file-row-${file.path}`}
      data-selected={isSelected ? "true" : "false"}
      onMouseEnter={() => onHover?.(file.path)}
      className={cn(
        "group flex flex-col gap-1.5 rounded-[9px] border px-2.5 py-2 text-xs transition-colors",
        isSelected
          ? "border-premium bg-active text-ink shadow-bevel-surface"
          : "border-transparent text-body hover:bg-hover hover:text-ink",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={Boolean(file.staged)}
          aria-label={`Stage ${file.path}`}
          disabled={isBusy}
          data-testid={`stage-checkbox-${file.path}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStage(file);
          }}
          className={cn(
            "mt-0.5 grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            file.staged
              ? "border-brand bg-brand text-brand-ink"
              : "border-hairline-strong bg-inset hover:border-premium-hi",
          )}
        >
          {file.staged && (
            <Check className="size-2.5" strokeWidth={2.5} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={handleRowClick}
          data-testid={`select-file-${file.path}`}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <TechFileBadge path={file.path} />
              <span className="truncate font-mono text-xs font-medium text-ink">
                {baseName}
              </span>
            </div>

            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              {file.additions > 0 && (
                <span className="text-brand-text">+{file.additions}</span>
              )}
              {file.additions > 0 && file.deletions > 0 && " "}
              {file.deletions > 0 && (
                <span className="text-danger">-{file.deletions}</span>
              )}
            </span>
          </div>

          {relDir ? (
            <span className="truncate font-mono text-[10.5px] text-muted-ink">
              {relDir}
            </span>
          ) : null}
        </button>
      </div>

      {/* Metadata pills + Keep / Undo / Open in VS Code Diff controls */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pl-6">
        <div className="flex flex-wrap items-center gap-1">
          <span
            data-testid={`owner-badge-${file.path}`}
            className="rounded-full border border-hairline bg-raised px-1.5 py-px font-mono text-[10px] text-muted-ink"
          >
            {ownerLabel}
          </span>
          <span className="rounded-full border border-hairline-soft bg-inset px-1.5 py-px font-mono text-[10px] text-muted-ink">
            {statusShort}
          </span>
          {file.decision === "accepted" && (
            <span
              data-testid={`decision-badge-${file.path}`}
              className="rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand-text"
            >
              Accepted
            </span>
          )}
          {file.decision === "rejected" && (
            <span
              data-testid={`decision-badge-${file.path}`}
              className="rounded-full bg-danger-soft px-1.5 py-px text-[10px] font-medium text-danger"
            >
              Rejected
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isBusy}
            onClick={() => onKeep(file.path)}
            data-testid={`keep-file-${file.path}`}
            title={`Keep changes in ${file.path}`}
          >
            <Check className="size-3 text-brand-text" aria-hidden="true" />
            <span>Keep</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isBusy}
            onClick={() => onUndo(file.path)}
            data-testid={`undo-file-${file.path}`}
            title={`Undo changes in ${file.path}`}
          >
            <RotateCcw className="size-3 text-danger" aria-hidden="true" />
            <span>Undo</span>
          </Button>

          {onOpenFile && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onOpenFile(file.path)}
              data-testid={`open-editor-file-${file.path}`}
              aria-label={`Open ${file.path} in Editor`}
              title={`Open ${file.path} in Editor`}
            >
              <FileCode2 className="size-3" aria-hidden="true" />
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onOpenDiff(file.path)}
            data-testid={`open-vscode-diff-${file.path}`}
            title={`Open ${file.path} in VS Code Diff`}
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            <span>VS Code Diff</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
