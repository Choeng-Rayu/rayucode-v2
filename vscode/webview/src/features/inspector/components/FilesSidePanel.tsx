import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  FileDiff,
  Search,
  Terminal,
} from "lucide-react";

import { Button, ScrollArea, TechFileBadge } from "@/components/ui";
import { basenameOf, callRpc, cn, postToHost, useAppStore } from "@/lib";

import { CodeViewer } from "./CodeViewer";

export interface TouchedFileEntry {
  path: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface FilesSidePanelProps {
  sessionId?: string;
  filesOverride?: TouchedFileEntry[];
  className?: string;
}

export function FilesSidePanel({
  sessionId: sessionIdProp,
  filesOverride,
  className,
}: FilesSidePanelProps) {
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionId = sessionIdProp ?? storeSessionId ?? "ses_vscode_shell";
  const activeCodeFile = useAppStore((s) => s.activeCodeFile);
  const openCodeFile = useAppStore((s) => s.openCodeFile);

  const [query, setQuery] = React.useState("");

  const changesQuery = useQuery({
    queryKey: ["inspector", "changes", sessionId],
    queryFn: () => callRpc("changes.status", { sessionId }),
    enabled: !filesOverride,
    staleTime: 15_000,
  });

  const findFilesQuery = useQuery({
    queryKey: ["inspector", "findFiles", sessionId, query],
    queryFn: () =>
      callRpc("workspace.findFiles", {
        sessionId,
        query,
        limit: 50,
      }),
    enabled: !filesOverride,
    staleTime: 15_000,
  });

  const allFiles = React.useMemo<TouchedFileEntry[]>(() => {
    if (filesOverride) return filesOverride;
    const map = new Map<string, TouchedFileEntry>();
    for (const f of changesQuery.data?.files ?? []) {
      map.set(f.path, {
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        status: f.status,
      });
    }
    for (const path of findFilesQuery.data?.files ?? []) {
      if (!map.has(path)) {
        map.set(path, { path });
      }
    }
    return Array.from(map.values());
  }, [changesQuery.data?.files, filesOverride, findFilesQuery.data?.files]);

  const filteredFiles = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [allFiles, query]);

  const selectedPath =
    activeCodeFile ?? filteredFiles[0]?.path ?? "crates/rayu-harness/src/lookup.rs";

  return (
    <div
      data-slot="files-side-panel"
      data-testid="inspector-files-panel"
      className={cn("flex min-h-0 flex-1 flex-col bg-canvas", className)}
    >
      {/* Top Quick Actions & Search Bar */}
      <div className="flex flex-col gap-2 border-b border-hairline bg-pane p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink">
            Touched &amp; Workspace Files ({filteredFiles.length})
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="files-panel-open-vscode"
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openFile",
                  path: selectedPath,
                })
              }
            >
              <ExternalLink className="size-3" />
              <span>Open in VS Code</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="files-panel-open-diff"
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openDiff",
                  path: selectedPath,
                  sessionId,
                  scope: "session",
                })
              }
            >
              <FileDiff className="size-3" />
              <span>Open Diff</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="files-panel-open-terminal"
              onClick={() =>
                postToHost({
                  type: "rayucode.editor.openTerminal",
                  name: "RayuCode Workspace",
                })
              }
            >
              <Terminal className="size-3" />
              <span>Open Terminal</span>
            </Button>
          </div>
        </div>

        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2.5 size-3.5 text-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter touched files..."
            aria-label="Filter touched files"
            className="h-7 w-full rounded-lg border border-hairline bg-inset pr-2.5 pl-8 text-xs text-ink placeholder:text-faint focus:border-hairline-strong focus:outline-none"
          />
        </div>
      </div>

      {/* Flat Touched Files List (zero folder tree in v1) */}
      <ScrollArea className="max-h-[190px] shrink-0 border-b border-hairline">
        <div className="flex flex-col gap-0.5 p-2">
          {filteredFiles.map((file) => {
            const isSelected = file.path === selectedPath;
            return (
              <div
                key={file.path}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  isSelected
                    ? "bg-active text-ink"
                    : "text-body hover:bg-hover hover:text-ink",
                )}
              >
                <button
                  type="button"
                  data-testid={`files-panel-select-${file.path}`}
                  onClick={() => openCodeFile(file.path, 1)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  <TechFileBadge path={file.path} />
                  <span className="truncate font-mono text-[11.5px] font-medium">
                    {basenameOf(file.path)}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-muted-ink">
                    {file.path}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  {(file.additions !== undefined ||
                    file.deletions !== undefined) && (
                    <span className="font-mono text-[10.5px] tabular-nums">
                      <span className="text-brand-text">
                        +{file.additions ?? 0}
                      </span>{" "}
                      <span className="text-danger">
                        -{file.deletions ?? 0}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Embedded Shiki CodeViewer */}
      <CodeViewer filePath={selectedPath} className="min-h-0 flex-1" />
    </div>
  );
}
