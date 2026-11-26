import * as React from "react";
import {
  formatSessionSourceLabel,
  type SessionSourceId,
} from "@rayu-dev/rayucode-session-core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FolderGit2, Loader2 } from "lucide-react";
import type {
  ExternalProjectView,
  SessionSummaryView,
} from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/app-store";
import { callRpc } from "@/lib/rpc-client";
import { cn, formatRelativeTime } from "@/lib/utils";

import { AgentSourceIcon } from "./AgentSourceBadge";

const TOOL_OPTIONS: Array<{
  id: SessionSourceId;
  label: string;
  isDesktop: boolean;
}> = [
  { id: "claude_desktop", label: "Claude Desktop", isDesktop: true },
  { id: "claude_code", label: "Claude Code CLI", isDesktop: false },
  { id: "codex_desktop", label: "Codex Desktop", isDesktop: true },
  { id: "codex", label: "Codex CLI", isDesktop: false },
  { id: "cursor", label: "Cursor", isDesktop: false },
  { id: "opencode", label: "OpenCode", isDesktop: false },
];

export interface ImportSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (session: SessionSummaryView) => void;
}

export function ImportSessionsDialog({
  open,
  onOpenChange,
  onImported,
}: ImportSessionsDialogProps) {
  const queryClient = useQueryClient();
  const setWorkspaceLedger = useAppStore((s) => s.setWorkspaceLedger);
  const [selectedTool, setSelectedTool] =
    React.useState<SessionSourceId>("claude_desktop");
  const [selectedSessionIds, setSelectedSessionIds] = React.useState<
    Set<string>
  >(new Set());
  const [importing, setImporting] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["sessions", "externalProjects", selectedTool],
    queryFn: () =>
      callRpc("sessions.listExternalProjects", { source: selectedTool }),
    enabled: open,
    staleTime: 10_000,
  });

  const projects: ExternalProjectView[] = projectsQuery.data?.projects ?? [];
  const toolMeta =
    TOOL_OPTIONS.find((t) => t.id === selectedTool) ?? TOOL_OPTIONS[0];
  const flatSessions = React.useMemo(
    () => projects.flatMap((p) => p.sessions),
    [projects],
  );

  React.useEffect(() => {
    setSelectedSessionIds(new Set());
    setStatusMessage(null);
  }, [selectedTool, open]);

  const toggleSession = (key: string) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const refreshAfterImport = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace", "ledger"] }),
    ]);
  };

  const handleImportWholeProject = async (project: ExternalProjectView) => {
    if (project.sessions.length === 0) return;
    setImporting(true);
    setStatusMessage(null);
    try {
      const items = project.sessions.map((s) => ({
        source: s.source ?? project.source,
        externalSessionId: s.externalSessionId ?? s.sessionId,
        externalPath: s.externalPath,
        workingDir: s.workingDir ?? project.workingDir ?? undefined,
      }));
      const result = await callRpc("sessions.importExternal", { items });
      const importedIds = result.sessions.map((s) => s.sessionId);
      const targetPath =
        project.workingDir ??
        project.sessions.find((s) => s.workingDir)?.workingDir;
      if (targetPath && importedIds.length > 0) {
        const ledger = await callRpc("workspace.ledger.importProjectGroup", {
          path: targetPath,
          name: project.name,
          sessionIds: importedIds,
        });
        setWorkspaceLedger(ledger);
      }
      await refreshAfterImport();
      if (result.sessions[0]) {
        onImported?.(result.sessions[0]);
      }
      setStatusMessage(
        `Imported ${result.sessions.length} session${result.sessions.length === 1 ? "" : "s"} into ${project.name}.`,
      );
      if (result.sessions.length > 0) {
        onOpenChange(false);
      }
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to import project.",
      );
    } finally {
      setImporting(false);
    }
  };

  const handleImportSelectedSessions = async () => {
    const chosen = flatSessions.filter((s) =>
      selectedSessionIds.has(s.externalSessionId ?? s.sessionId),
    );
    if (chosen.length === 0) return;
    setImporting(true);
    setStatusMessage(null);
    try {
      const items = chosen.map((s) => ({
        source: s.source ?? selectedTool,
        externalSessionId: s.externalSessionId ?? s.sessionId,
        externalPath: s.externalPath,
        workingDir: s.workingDir,
      }));
      const result = await callRpc("sessions.importExternal", { items });
      await refreshAfterImport();
      if (result.sessions[0]) {
        onImported?.(result.sessions[0]);
      }
      setStatusMessage(
        `Imported ${result.sessions.length} session${result.sessions.length === 1 ? "" : "s"}.`,
      );
      if (result.sessions.length > 0) {
        onOpenChange(false);
      }
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to import sessions.",
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="import-sessions-dialog"
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Download className="size-4 text-brand-text" />
            <span>Import chats & projects from coding tools</span>
          </DialogTitle>
        </DialogHeader>

        {/* Source Tool Picker */}
        <div
          role="tablist"
          aria-label="Coding agent source"
          className="flex flex-wrap gap-1.5"
        >
          {TOOL_OPTIONS.map((tool) => {
            const active = selectedTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`import-tool-tab-${tool.id}`}
                onClick={() => setSelectedTool(tool.id)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                  active
                    ? "border-brand/50 bg-brand-soft font-medium text-brand-text"
                    : "border-hairline bg-pane text-body hover:bg-hover hover:text-ink",
                )}
              >
                <AgentSourceIcon source={tool.id} className="size-3.5" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Discovered Projects / Sessions */}
        <ScrollArea className="max-h-72 rounded-md border border-hairline-soft bg-inset p-2">
          {projectsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-ink">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Scanning {toolMeta.label} sessions...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-ink">
              No local {formatSessionSourceLabel(selectedTool)} sessions found on
              this machine.
            </div>
          ) : toolMeta.isDesktop ? (
            <div className="flex flex-col gap-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  data-testid={`import-project-card-${project.name}`}
                  className="rounded-md border border-hairline-soft bg-pane p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <FolderGit2 className="size-3.5 shrink-0 text-muted-ink" />
                      <span className="truncate text-xs font-medium text-ink">
                        {project.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-ink">
                        ({project.sessionCount})
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      disabled={importing}
                      data-testid={`import-whole-project-btn-${project.name}`}
                      onClick={() => void handleImportWholeProject(project)}
                      className="h-6 px-2 text-[11px]"
                    >
                      Import whole project
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {project.sessions.map((s) => {
                      const key = s.externalSessionId ?? s.sessionId;
                      const checked = selectedSessionIds.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleSession(key)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors",
                            checked
                              ? "bg-active text-ink"
                              : "text-body hover:bg-hover hover:text-ink",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-3.5 shrink-0 place-items-center rounded-sm border",
                              checked
                                ? "border-brand bg-brand text-ink-inverse"
                                : "border-hairline bg-inset",
                            )}
                          >
                            {checked && <Check className="size-2.5" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {s.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-ink">
                            {formatRelativeTime(s.updatedAtMs)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {flatSessions.map((s) => {
                const key = s.externalSessionId ?? s.sessionId;
                const checked = selectedSessionIds.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`import-cli-session-${key}`}
                    onClick={() => toggleSession(key)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      checked
                        ? "bg-active text-ink"
                        : "text-body hover:bg-hover hover:text-ink",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-3.5 shrink-0 place-items-center rounded-sm border",
                        checked
                          ? "border-brand bg-brand text-ink-inverse"
                          : "border-hairline bg-inset",
                      )}
                    >
                      {checked && <Check className="size-2.5" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-ink">
                      {formatRelativeTime(s.updatedAtMs)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {statusMessage && (
          <div className="text-xs text-muted-ink">{statusMessage}</div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={importing || selectedSessionIds.size === 0}
            data-testid="import-selected-sessions-btn"
            onClick={() => void handleImportSelectedSessions()}
          >
            {importing
              ? "Importing..."
              : `Import selected (${selectedSessionIds.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
