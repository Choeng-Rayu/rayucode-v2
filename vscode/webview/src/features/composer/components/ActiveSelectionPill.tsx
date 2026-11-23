import * as React from "react";
import { ExternalLink, Paperclip, X } from "lucide-react";
import type { EditorSelectionView } from "@shared/vscodeProtocol";

import {
  TechFileBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { postToHost, useAppStore } from "@/lib";
import { cn } from "@/lib/utils";

import { formatSelectionRangeLabel } from "../constants";

export interface ActiveSelectionPillProps {
  selection?: EditorSelectionView | null;
  included?: boolean;
  onToggleInclude?: (included: boolean) => void;
  onDismiss?: () => void;
  className?: string;
}

export function ActiveSelectionPill({
  selection: controlledSelection,
  included: controlledIncluded,
  onToggleInclude,
  onDismiss,
  className,
}: ActiveSelectionPillProps) {
  const storeSelection = useAppStore((s) => s.editorSelection);
  const setEditorSelection = useAppStore((s) => s.setEditorSelection);

  const selection =
    controlledSelection !== undefined ? controlledSelection : storeSelection;

  const [internalIncluded, setInternalIncluded] = React.useState(true);
  const isIncluded =
    controlledIncluded !== undefined ? controlledIncluded : internalIncluded;

  // Reset to included whenever the selected file or line range changes
  React.useEffect(() => {
    if (selection && controlledIncluded === undefined) {
      setInternalIncluded(true);
    }
  }, [
    controlledIncluded,
    selection,
    selection?.filePath,
    selection?.lineStart,
    selection?.lineEnd,
  ]);

  if (!selection) {
    return null;
  }

  const rangeLabel = formatSelectionRangeLabel(selection);
  const displayPath = selection.relativePath || selection.filePath;

  const handleToggle = () => {
    const next = !isIncluded;
    if (controlledIncluded === undefined) {
      setInternalIncluded(next);
    }
    onToggleInclude?.(next);
  };

  const handleDismiss = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onDismiss) {
      onDismiss();
    } else {
      setEditorSelection(null);
    }
  };

  const handleOpenInEditor = (event: React.MouseEvent) => {
    event.stopPropagation();
    postToHost({
      type: "rayucode.editor.openFile",
      path: selection.filePath,
      line: selection.lineStart,
    });
  };

  return (
    <div
      data-testid="active-selection-pill"
        data-included={isIncluded ? "true" : "false"}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors select-none",
          isIncluded
            ? "border-premium bg-inset text-ink shadow-bevel-surface"
            : "border-hairline-soft bg-inset/50 text-muted-ink opacity-70",
          className,
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="active-selection-toggle"
              aria-pressed={isIncluded}
              aria-label={
                isIncluded
                  ? `Detach active editor selection ${rangeLabel}`
                  : `Attach active editor selection ${rangeLabel}`
              }
              onClick={handleToggle}
              className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-left focus:outline-none"
            >
              <TechFileBadge path={displayPath} className="shrink-0" />
              <span
                data-testid="active-selection-label"
                className={cn(
                  "truncate font-mono text-[11.5px] font-medium tabular-nums",
                  isIncluded ? "text-ink" : "text-muted-ink line-through",
                )}
              >
                {rangeLabel}
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[10px] font-medium",
                  isIncluded
                    ? "bg-brand-soft text-brand-text"
                    : "bg-hover text-muted-ink",
                )}
              >
                <Paperclip className="size-2.5" aria-hidden="true" />
                <span>{isIncluded ? "Attached" : "Excluded"}</span>
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isIncluded
              ? `Attached ${displayPath} (lines ${selection.lineStart}–${selection.lineEnd}). Click to exclude.`
              : `Excluded ${displayPath}. Click to re-attach to prompt.`}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="active-selection-open"
              aria-label={`Reveal ${rangeLabel} in VS Code editor`}
              onClick={handleOpenInEditor}
              className="grid size-4 shrink-0 cursor-pointer place-items-center rounded text-muted-ink transition-colors hover:bg-hover hover:text-ink focus:outline-none"
            >
              <ExternalLink className="size-3" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Reveal in VS Code editor</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="active-selection-dismiss"
              aria-label={`Dismiss selection ${rangeLabel}`}
              onClick={handleDismiss}
              className="grid size-4 shrink-0 cursor-pointer place-items-center rounded text-muted-ink transition-colors hover:bg-hover hover:text-ink focus:outline-none"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Dismiss editor selection</TooltipContent>
        </Tooltip>
      </div>
  );
}

export { ActiveSelectionPill as EditorSelectionPill };
