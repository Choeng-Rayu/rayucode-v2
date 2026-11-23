import * as React from "react";
import { FileCode2 } from "lucide-react";

import { ScrollArea, TechFileBadge } from "@/components/ui";
import { basenameOf, cn } from "@/lib";

import { useWorkspaceFilesSearch } from "../hooks/useComposerData";

export interface MentionMenuProps {
  open: boolean;
  query: string;
  sessionId?: string | null;
  files?: readonly string[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelectFile: (filePath: string) => void;
  onClose: () => void;
  className?: string;
}

const FALLBACK_WORKSPACE_FILES: readonly string[] = [
  "vscode/webview/src/styles/globals.css",
  "vscode/webview/src/lib/rpc-client.ts",
  "vscode/webview/src/lib/app-store.ts",
  "vscode/webview/src/features/shell/components/AppShell.tsx",
  "crates/rayu-harness/src/lib.rs",
];

export function MentionMenu({
  open,
  query,
  sessionId,
  files: controlledFiles,
  activeIndex,
  onActiveIndexChange,
  onSelectFile,
  className,
}: MentionMenuProps) {
  const filesQuery = useWorkspaceFilesSearch(
    query,
    open && !controlledFiles,
    sessionId,
  );

  const items = React.useMemo(() => {
    const source =
      controlledFiles ??
      (filesQuery.data?.files && filesQuery.data.files.length > 0
        ? filesQuery.data.files
        : FALLBACK_WORKSPACE_FILES);
    const q = query.trim().toLowerCase();
    if (!q) return source.slice(0, 12);
    return source
      .filter((filePath) => filePath.toLowerCase().includes(q))
      .slice(0, 12);
  }, [controlledFiles, filesQuery.data?.files, query]);

  if (!open) {
    return null;
  }

  const clampedIndex =
    items.length > 0
      ? Math.max(0, Math.min(items.length - 1, activeIndex))
      : 0;

  return (
    <div
      data-testid="mention-menu"
      role="listbox"
      aria-label="Workspace file mentions"
      className={cn(
        "rayu-card-bevel rayu-animate-pop z-40 w-full max-w-[460px] overflow-hidden rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-popover",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline-soft px-2.5 py-1.5 text-[11px] font-medium text-muted-ink">
        <span className="inline-flex items-center gap-1.5">
          <FileCode2 className="size-3.5 text-brand-text" aria-hidden="true" />
          <span>
            {query.trim()
              ? `Files matching "@${query.trim()}"`
              : "Mention workspace file"}
          </span>
        </span>
        <span className="font-mono text-[10px] text-faint">
          Enter to insert · Esc
        </span>
      </div>

      {items.length === 0 ? (
        <div
          data-testid="mention-menu-empty"
          className="px-3 py-4 text-center text-xs text-muted-ink"
        >
          No matching workspace files for &ldquo;@{query}&rdquo;
        </div>
      ) : (
        <ScrollArea className="max-h-[232px]">
          <div className="flex flex-col gap-0.5 py-1">
            {items.map((filePath, idx) => {
              const isSelected = idx === clampedIndex;
              const name = basenameOf(filePath);
              const dir =
                filePath.length > name.length
                  ? filePath.slice(0, filePath.length - name.length - 1)
                  : "";
              return (
                <button
                  key={filePath}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-testid="mention-item"
                  data-file-path={filePath}
                  onMouseEnter={() => onActiveIndexChange(idx)}
                  onMouseDown={(event) => {
                    // Prevent textarea blur before selection completes
                    event.preventDefault();
                    onSelectFile(filePath);
                  }}
                  onClick={() => onSelectFile(filePath)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-xs transition-colors",
                    isSelected
                      ? "border-hairline bg-active text-ink"
                      : "text-body hover:bg-hover hover:text-ink",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <TechFileBadge path={filePath} className="shrink-0" />
                    <span className="truncate font-medium text-ink">
                      {name}
                    </span>
                  </span>
                  {dir ? (
                    <span className="max-w-[55%] truncate font-mono text-[11px] text-muted-ink">
                      {dir}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
