import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  GitFork,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type {
  SessionSearchHitView,
  SessionSourceTool,
  SessionSummaryView,
  WorkspaceFolderView,
} from "@shared/vscodeProtocol";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { RunStatusPulse } from "@/components/ui/rayu-symbols";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/app-store";
import { callRpc } from "@/lib/rpc-client";
import { basenameOf, cn, formatRelativeTime } from "@/lib/utils";

import {
  ProjectIconPicker,
  toProjectIconSpec,
  toProjectIconView,
  type ProjectIconSpec,
} from "./ProjectIconPicker";

type OrganizeMode = "project" | "chronological";
type SortMode = "updated" | "title";

export interface SidebarProjectsPaneProps {
  onSessionSelected?: () => void;
  onCloseDrawer?: () => void;
  className?: string;
}

export function SidebarProjectsPane({
  onSessionSelected,
  onCloseDrawer,
  className,
}: SidebarProjectsPaneProps) {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const workspaces = useAppStore((s) => s.workspaces);
  const sessionSearchFocusNonce = useAppStore((s) => s.sessionSearchFocusNonce);
  const setWorkspaces = useAppStore((s) => s.setWorkspaces);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const lastSearchNonceRef = React.useRef(sessionSearchFocusNonce);

  React.useEffect(() => {
    if (sessionSearchFocusNonce > lastSearchNonceRef.current) {
      lastSearchNonceRef.current = sessionSearchFocusNonce;
      setSearchOpen(true);
      queueMicrotask(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [sessionSearchFocusNonce]);
  const [crossToolSearch, setCrossToolSearch] = React.useState(false);
  const [sourceScope, setSourceScope] = React.useState<"all" | SessionSourceTool>(
    "all",
  );
  const [organizeMode, setOrganizeMode] =
    React.useState<OrganizeMode>("project");
  const [sortMode, setSortMode] = React.useState<SortMode>("updated");
  const [collapsedProjects, setCollapsedProjects] = React.useState<
    Record<string, boolean>
  >({});
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);
  const [renamingSession, setRenamingSession] =
    React.useState<SessionSummaryView | null>(null);
  const [renameTitle, setRenameTitle] = React.useState("");

  const sessionsQuery = useQuery({
    queryKey: ["sessions", "list", { includeArchived: true }],
    queryFn: () => callRpc("sessions.list", { includeArchived: true }),
    staleTime: 15_000,
  });

  const foldersQuery = useQuery({
    queryKey: ["shell", "workspace", "folders"],
    queryFn: async () => {
      const res = await callRpc("workspace.listFolders");
      return res.folders;
    },
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (foldersQuery.data && foldersQuery.data.length > 0 && workspaces.length === 0) {
      setWorkspaces(foldersQuery.data);
    }
  }, [foldersQuery.data, setWorkspaces, workspaces.length]);

  const crossSearchQuery = useQuery({
    queryKey: ["sessions", "search", searchQuery, sourceScope],
    queryFn: () =>
      callRpc("sessions.search", {
        query: searchQuery.trim(),
        scope: sourceScope,
      }),
    enabled: crossToolSearch && searchQuery.trim().length > 0,
    staleTime: 10_000,
  });

  const allSessions = React.useMemo(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data?.sessions],
  );
  const resolvedFolders: WorkspaceFolderView[] = React.useMemo(() => {
    if (workspaces.length > 0) return workspaces;
    if (foldersQuery.data && foldersQuery.data.length > 0) return foldersQuery.data;
    const rawDirs = allSessions
      .map((s) => s.workingDir)
      .filter((d): d is string => Boolean(d && d.trim().length > 0));
    const dirs = Array.from(
      new Set(
        rawDirs.length > 0
          ? rawDirs
          : activeProjectPath
            ? [activeProjectPath]
            : ["Workspace"],
      ),
    );
    return dirs.map((path, idx) => ({
      name: path === "Workspace" ? "Workspace" : basenameOf(path),
      path,
      isPrimary: idx === 0,
    }));
  }, [activeProjectPath, allSessions, foldersQuery.data, workspaces]);

  const filteredSessions = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = allSessions.filter((s) => {
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        (s.previewText ?? "").toLowerCase().includes(q) ||
        (s.workingDir ?? "").toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      if (sortMode === "title") {
        return a.title.localeCompare(b.title);
      }
      return b.updatedAtMs - a.updatedAtMs;
    });
  }, [allSessions, searchQuery, sortMode]);

  const activeSessions = React.useMemo(
    () => filteredSessions.filter((s) => !s.archived),
    [filteredSessions],
  );
  const archivedSessions = React.useMemo(
    () => filteredSessions.filter((s) => s.archived),
    [filteredSessions],
  );

  const refreshSessions = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }, [queryClient]);

  const handleCreateSession = async (workingDir?: string) => {
    try {
      const res = await callRpc("sessions.create", { workingDir });
      setActiveSession(res.session.sessionId, res.session.title);
      if (workingDir) setActiveProjectPath(workingDir);
      refreshSessions();
      onSessionSelected?.();
    } catch {
      setActiveSession(null);
      setActiveRoute("home");
      onSessionSelected?.();
    }
  };

  const handleSelectSession = async (session: SessionSummaryView) => {
    setActiveSession(session.sessionId, session.title);
    if (session.workingDir) setActiveProjectPath(session.workingDir);
    onSessionSelected?.();
    void callRpc("sessions.attach", { sessionId: session.sessionId }).catch(
      () => {},
    );
  };

  const handleTogglePin = async (session: SessionSummaryView) => {
    await callRpc("sessions.pin", {
      sessionId: session.sessionId,
      pinned: !session.pinned,
    });
    refreshSessions();
  };

  const handleToggleArchive = async (session: SessionSummaryView) => {
    await callRpc("sessions.archive", {
      sessionId: session.sessionId,
      archived: !session.archived,
    });
    refreshSessions();
  };

  const handleForkSession = async (session: SessionSummaryView) => {
    const res = await callRpc("sessions.fork", { sessionId: session.sessionId });
    setActiveSession(res.session.sessionId, res.session.title);
    refreshSessions();
    onSessionSelected?.();
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingSession || !renameTitle.trim()) return;
    const trimmed = renameTitle.trim();
    await callRpc("sessions.rename", {
      sessionId: renamingSession.sessionId,
      title: trimmed,
    });
    if (activeSessionId === renamingSession.sessionId) {
      setActiveSession(renamingSession.sessionId, trimmed);
    }
    setRenamingSession(null);
    refreshSessions();
  };

  const handleProjectIconChange = async (
    folderPath: string,
    spec: ProjectIconSpec,
  ) => {
    const iconView = toProjectIconView(spec);
    const updated = resolvedFolders.map((w) =>
      w.path === folderPath ? { ...w, icon: iconView } : w,
    );
    setWorkspaces(updated);
    await callRpc("workspace.setProjectIcon", {
      workspacePath: folderPath,
      icon: iconView,
    });
  };

  const renderSessionRow = (session: SessionSummaryView) => {
    const isActive = activeSessionId === session.sessionId;
    const tone =
      session.status === "running"
        ? "running"
        : session.status === "waiting"
          ? "warn"
          : session.status === "error"
            ? "danger"
            : "idle";

    return (
      <HoverCard key={session.sessionId} openDelay={360}>
        <HoverCardTrigger asChild>
          <div
            data-testid={`session-row-${session.sessionId}`}
            data-active={isActive ? "true" : "false"}
            className={cn(
              "group/session relative flex h-8 items-center gap-2 rounded-md px-2 text-xs transition-colors",
              isActive
                ? "bg-active font-medium text-ink shadow-bevel-surface"
                : "text-body hover:bg-hover hover:text-ink",
            )}
          >
            <button
              type="button"
              onClick={() => void handleSelectSession(session)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none"
            >
              <RunStatusPulse status={tone} />
              <span className="min-w-0 flex-1 truncate">{session.title}</span>
            </button>

            {session.pinned && (
              <Pin
                aria-label="Pinned"
                className="size-3 shrink-0 text-brand-text opacity-80 group-hover/session:hidden"
              />
            )}

            {(session.diffAdditions || session.diffDeletions) && (
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums group-hover/session:hidden">
                {session.diffAdditions ? (
                  <span className="text-brand-text">+{session.diffAdditions}</span>
                ) : null}
                {session.diffDeletions ? (
                  <span className="text-danger">-{session.diffDeletions}</span>
                ) : null}
              </span>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Session options for ${session.title}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hidden size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-ink hover:bg-control hover:text-ink group-hover/session:grid data-[state=open]:grid"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => void handleTogglePin(session)}>
                  <Pin className="size-3.5" />
                  <span>{session.pinned ? "Unpin session" : "Pin session"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setRenamingSession(session);
                    setRenameTitle(session.title);
                  }}
                >
                  <Pencil className="size-3.5" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleForkSession(session)}>
                  <GitFork className="size-3.5" />
                  <span>Fork session</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void handleToggleArchive(session)}
                >
                  {session.archived ? (
                    <>
                      <ArchiveRestore className="size-3.5" />
                      <span>Restore from archive</span>
                    </>
                  ) : (
                    <>
                      <Archive className="size-3.5" />
                      <span>Archive</span>
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </HoverCardTrigger>

        <HoverCardContent side="right" align="start" className="w-64">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-ink">
                {session.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-ink">
                {formatRelativeTime(session.updatedAtMs)}
              </span>
            </div>
            {session.previewText && (
              <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-ink">
                {session.previewText}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-ink">
              {session.branch && (
                <Badge variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
                  {session.branch}
                </Badge>
              )}
              {session.model && (
                <span className="truncate font-mono">{session.model}</span>
              )}
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  };

  const renderCrossToolHit = (hit: SessionSearchHitView) => (
    <button
      key={`${hit.sourceTool}-${hit.sessionId}`}
      type="button"
      onClick={() => {
        setActiveSession(hit.sessionId, hit.title);
        onSessionSelected?.();
      }}
      className="flex w-full cursor-pointer flex-col gap-1 rounded-md border border-hairline-soft bg-pane p-2 text-left text-xs transition-colors hover:border-premium hover:bg-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-ink">{hit.title}</span>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] uppercase">
          {hit.sourceTool}
        </Badge>
      </div>
      <p className="line-clamp-2 text-[11px] text-muted-ink">{hit.snippet}</p>
    </button>
  );

  return (
    <aside
      aria-label="Sessions and projects"
      data-slot="sidebar-projects-pane"
      className={cn(
        "flex h-full w-[244px] shrink-0 flex-col bg-chrome text-ink select-none",
        className,
      )}
    >
      {/* Top 46px Action Header */}
      <div className="flex h-[46px] shrink-0 items-center justify-between gap-1.5 px-2.5">
        <Button
          type="button"
          variant="default"
          size="sm"
          data-testid="sidebar-new-session-btn"
          onClick={() => void handleCreateSession()}
          className="flex-1 justify-start gap-2 px-2.5 text-xs font-medium"
        >
          <Plus className="size-3.5 text-brand-text" />
          <span>New session</span>
        </Button>

        <Button
          type="button"
          variant={searchOpen ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Search sessions"
          aria-pressed={searchOpen}
          data-testid="sidebar-search-toggle"
          onClick={() => setSearchOpen((v) => !v)}
        >
          <Search className="size-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Organize and sort sessions"
            >
              <SlidersHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Organize</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={organizeMode}
              onValueChange={(v) => setOrganizeMode(v as OrganizeMode)}
            >
              <DropdownMenuRadioItem value="project">
                By project
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="chronological">
                Chronological
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortMode}
              onValueChange={(v) => setSortMode(v as SortMode)}
            >
              <DropdownMenuRadioItem value="updated">
                Recently updated
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="title">
                Title (A-Z)
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {onCloseDrawer && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close sessions drawer"
            data-testid="close-sessions-drawer-btn"
            onClick={onCloseDrawer}
            className="shrink-0"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Expandable Search Filter + Cross-Tool Search Toggle */}
      {searchOpen && (
        <div className="flex flex-col gap-1.5 border-b border-hairline-soft px-2.5 pb-2.5">
          <div className="relative flex items-center">
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter sessions..."
              aria-label="Filter sessions"
              data-testid="sidebar-search-input"
              className="h-7 pr-7 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 cursor-pointer text-muted-ink hover:text-ink"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setCrossToolSearch((v) => !v)}
              aria-pressed={crossToolSearch}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] transition-colors",
                crossToolSearch
                  ? "bg-brand-soft text-brand-text"
                  : "text-muted-ink hover:bg-hover hover:text-ink",
              )}
            >
              <Sparkles className="size-2.5" />
              <span>Cross-tool search</span>
            </button>
            {crossToolSearch && (
              <select
                aria-label="Source tool scope"
                value={sourceScope}
                onChange={(e) =>
                  setSourceScope(e.target.value as "all" | SessionSourceTool)
                }
                className="rounded border border-hairline bg-inset px-1 py-0.5 text-[10px] text-ink outline-none"
              >
                <option value="all">All tools</option>
                <option value="rayu">Rayu</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="cursor">Cursor</option>
                <option value="opencode">OpenCode</option>
                <option value="pi">Pi</option>
              </select>
            )}
          </div>
        </div>
      )}

      {/* Sessions & Project Groups */}
      <ScrollArea className="min-h-0 flex-1 px-2 py-1.5">
        {crossToolSearch && searchQuery.trim().length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="px-1 text-[10.5px] font-semibold tracking-wider text-muted-ink uppercase">
              Cross-Tool Hits ({crossSearchQuery.data?.hits.length ?? 0})
            </div>
            {(crossSearchQuery.data?.hits ?? []).map(renderCrossToolHit)}
          </div>
        ) : organizeMode === "chronological" ? (
          <div className="flex flex-col gap-0.5">
            {activeSessions.map(renderSessionRow)}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {resolvedFolders.map((folder) => {
              const isCollapsed = Boolean(collapsedProjects[folder.path]);
              const folderSessions = activeSessions.filter(
                (s) =>
                  !s.workingDir ||
                  s.workingDir === folder.path ||
                  (folder.isPrimary &&
                    !resolvedFolders.some(
                      (other) =>
                        other.path !== folder.path &&
                        other.path === s.workingDir,
                    )),
              );
              const iconSpec = toProjectIconSpec(folder.icon);

              return (
                <div
                  key={folder.path}
                  data-testid={`project-group-${folder.name}`}
                  className="flex flex-col gap-0.5"
                >
                  <div className="group/proj flex h-7 items-center gap-1 rounded-md px-1 text-xs text-muted-ink hover:bg-hover hover:text-ink">
                    <ProjectIconPicker
                      compact
                      value={iconSpec}
                      onChange={(next) =>
                        void handleProjectIconChange(folder.path, next)
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedProjects((prev) => ({
                          ...prev,
                          [folder.path]: !prev[folder.path],
                        }))
                      }
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left font-medium text-ink"
                    >
                      <span className="truncate">{folder.name}</span>
                      {isCollapsed ? (
                        <ChevronRight className="size-3 shrink-0 text-muted-ink" />
                      ) : (
                        <ChevronDown className="size-3 shrink-0 text-muted-ink" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`New session in ${folder.name}`}
                      onClick={() => void handleCreateSession(folder.path)}
                      className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-ink opacity-0 transition-opacity hover:bg-active hover:text-ink group-hover/proj:opacity-100 focus-visible:opacity-100"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="flex flex-col gap-0.5 pl-1.5">
                      {folderSessions.length > 0 ? (
                        folderSessions.map(renderSessionRow)
                      ) : (
                        <div className="px-2 py-1.5 text-[11px] text-faint">
                          No sessions in this project
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Collapsible Archived Section */}
        {archivedSessions.length > 0 && (
          <div className="mt-4 border-t border-hairline-soft pt-2">
            <button
              type="button"
              onClick={() => setArchivedExpanded((v) => !v)}
              className="flex h-7 w-full cursor-pointer items-center justify-between rounded-md px-2 text-[11px] font-medium text-muted-ink hover:bg-hover hover:text-ink"
            >
              <span className="inline-flex items-center gap-1.5">
                <Archive className="size-3" />
                <span>Archived ({archivedSessions.length})</span>
              </span>
              {archivedExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
            </button>
            {archivedExpanded && (
              <div className="mt-1 flex flex-col gap-0.5 opacity-80">
                {archivedSessions.map(renderSessionRow)}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Rename Session Dialog */}
      <Dialog
        open={renamingSession !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingSession(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleRenameSubmit(e)} className="flex flex-col gap-3">
            <Input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Session title"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenamingSession(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
