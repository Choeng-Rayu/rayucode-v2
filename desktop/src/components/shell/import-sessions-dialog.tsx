import * as React from "react"
import {
  formatSessionSourceLabel,
  type SessionSourceId,
} from "@rayu-dev/rayucode-session-core/client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Download, FolderGit2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ipcClient,
  type ExternalProjectSummary,
  type SessionSummary,
} from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { AgentSourceIcon } from "./agent-source-badge"

const TOOL_OPTIONS: Array<{
  id: SessionSourceId
  label: string
  isDesktop: boolean
}> = [
  { id: "claude_desktop", label: "Claude Desktop", isDesktop: true },
  { id: "claude_code", label: "Claude Code CLI", isDesktop: false },
  { id: "codex_desktop", label: "Codex Desktop", isDesktop: true },
  { id: "codex", label: "Codex CLI", isDesktop: false },
  { id: "cursor", label: "Cursor", isDesktop: false },
  { id: "opencode", label: "OpenCode", isDesktop: false },
]

export interface ImportSessionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (session: SessionSummary) => void
}

export function ImportSessionsDialog({
  open,
  onOpenChange,
  onImported,
}: ImportSessionsDialogProps) {
  const queryClient = useQueryClient()
  const [selectedTool, setSelectedTool] =
    React.useState<SessionSourceId>("claude_desktop")
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set())
  const [importing, setImporting] = React.useState(false)

  const projectsQuery = useQuery({
    queryKey: ["sessions", "externalProjects", selectedTool],
    queryFn: () => ipcClient.sessions.listExternalProjects(selectedTool),
    enabled: open,
    staleTime: 10_000,
  })

  const projects = React.useMemo<ExternalProjectSummary[]>(
    () => projectsQuery.data ?? [],
    [projectsQuery.data]
  )
  const toolMeta =
    TOOL_OPTIONS.find((t) => t.id === selectedTool) ?? TOOL_OPTIONS[0]
  const flatSessions = React.useMemo(
    () => projects.flatMap((p) => p.sessions),
    [projects]
  )

  const handleSelectTool = (toolId: SessionSourceId) => {
    setSelectedTool(toolId)
    setSelectedKeys(new Set())
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedKeys(new Set())
    }
    onOpenChange(nextOpen)
  }

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar", "state"] }),
    ])
  }

  const handleImportWholeProject = async (project: ExternalProjectSummary) => {
    if (project.sessions.length === 0) return
    setImporting(true)
    try {
      const items = project.sessions.map((s) => ({
        source: s.source ?? project.source,
        external_session_id: s.externalSessionId ?? s.id,
        external_path: s.externalPath,
        working_dir: s.workingDir ?? project.workingDir ?? undefined,
      }))
      const result = await ipcClient.sessions.importExternal(items)
      const importedIds = result.sessions.map((s) => s.id)
      const targetPath =
        project.workingDir ??
        project.sessions.find((s) => s.workingDir)?.workingDir
      if (targetPath && importedIds.length > 0) {
        await ipcClient.workspace.importProjectGroup(
          targetPath,
          importedIds,
          project.name
        )
      }
      await refreshAll()
      toast(
        `Imported ${result.sessions.length} chat${result.sessions.length === 1 ? "" : "s"} into ${project.name}`
      )
      if (result.sessions[0]) {
        onImported?.(result.sessions[0])
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import project."
      )
    } finally {
      setImporting(false)
    }
  }

  const handleImportSelected = async () => {
    const chosen = flatSessions.filter((s) =>
      selectedKeys.has(s.externalSessionId ?? s.id)
    )
    if (chosen.length === 0) return
    setImporting(true)
    try {
      const items = chosen.map((s) => ({
        source: s.source ?? selectedTool,
        external_session_id: s.externalSessionId ?? s.id,
        external_path: s.externalPath,
        working_dir: s.workingDir,
      }))
      const result = await ipcClient.sessions.importExternal(items)
      await refreshAll()
      toast(
        `Imported ${result.sessions.length} chat${result.sessions.length === 1 ? "" : "s"}`
      )
      if (result.sessions[0]) {
        onImported?.(result.sessions[0])
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import chats."
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="desktop-import-sessions-dialog"
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Download className="size-4 text-accent" aria-hidden="true" />
            <span>Import chats & projects from coding tools</span>
          </DialogTitle>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Coding agent source"
          className="flex flex-wrap gap-1.5"
        >
          {TOOL_OPTIONS.map((tool) => {
            const active = selectedTool === tool.id
            return (
              <button
                key={tool.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`desktop-import-tool-${tool.id}`}
                onClick={() => handleSelectTool(tool.id)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                  active
                    ? "border-premium bg-active font-medium text-ink"
                    : "border-hairline bg-pane text-body hover:bg-hover hover:text-ink"
                )}
              >
                <AgentSourceIcon source={tool.id} className="size-3.5" />
                <span>{tool.label}</span>
              </button>
            )
          })}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border border-hairline bg-inset p-2">
          {projectsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span>Scanning {toolMeta.label} chats...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted">
              No local {formatSessionSourceLabel(selectedTool)} chats found on
              this machine.
            </div>
          ) : toolMeta.isDesktop ? (
            <div className="flex flex-col gap-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  data-testid={`desktop-import-project-${project.name}`}
                  className="rounded-md border border-hairline bg-pane p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <FolderGit2
                        className="size-3.5 shrink-0 text-muted"
                        aria-hidden="true"
                      />
                      <span className="truncate text-xs font-medium text-ink">
                        {project.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        ({project.sessionCount})
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={importing}
                      data-testid={`desktop-import-whole-project-${project.name}`}
                      onClick={() => void handleImportWholeProject(project)}
                      className="h-6 px-2 text-[11px]"
                    >
                      Import whole project
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {project.sessions.map((s) => {
                      const key = s.externalSessionId ?? s.id
                      const checked = selectedKeys.has(key)
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleKey(key)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors",
                            checked
                              ? "bg-active text-ink"
                              : "text-body hover:bg-hover hover:text-ink"
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-3.5 shrink-0 place-items-center rounded-sm border",
                              checked
                                ? "border-premium bg-raised text-accent"
                                : "border-hairline bg-inset"
                            )}
                          >
                            {checked && (
                              <Check className="size-2.5" aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {s.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted">
                            {s.updatedAt}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {flatSessions.map((s) => {
                const key = s.externalSessionId ?? s.id
                const checked = selectedKeys.has(key)
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`desktop-import-cli-session-${key}`}
                    onClick={() => toggleKey(key)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      checked
                        ? "bg-active text-ink"
                        : "text-body hover:bg-hover hover:text-ink"
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-3.5 shrink-0 place-items-center rounded-sm border",
                        checked
                          ? "border-premium bg-raised text-accent"
                          : "border-hairline bg-inset"
                      )}
                    >
                      {checked && (
                        <Check className="size-2.5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">
                      {s.updatedAt}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

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
            disabled={importing || selectedKeys.size === 0}
            data-testid="desktop-import-selected-btn"
            onClick={() => void handleImportSelected()}
          >
            {importing
              ? "Importing..."
              : `Import selected (${selectedKeys.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
