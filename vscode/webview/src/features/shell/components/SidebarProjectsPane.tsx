import * as React from "react";
import {
  deriveSidebarTree,
  formatSessionSourceLabel,
  pathComparisonKey,
  type SessionSourceFilter,
  type SidebarSessionLike,
  type SidebarWorkspaceLike,
} from "@rayu-dev/rayucode-session-core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
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
  ProjectIconView,
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
import {
  reconcileStaleLiveTurnForSession,
  reconcileStaleLiveTurnsFromSessions,
  useLiveTraceStore,
} from "@/features/chat";
import {
  type ExternalSessionOpenTarget,
  parseSyntheticExternalSessionId,
  resolveSessionForOpen,
  useAppStore,
} from "@/lib";
import { callRpc } from "@/lib/rpc-client";
import { basenameOf, cn, formatRelativeTime } from "@/lib/utils";

import { AgentSourceBadge, AgentSourceIcon } from "./AgentSourceBadge";
import { ImportSessionsDialog } from "./ImportSessionsDialog";
import {
  ProjectIconPicker,
  toProjectIconSpec,
  toProjectIconView,
  type ProjectIconSpec,
} from "./ProjectIconPicker";

const SOURCE_FILTER_ORDER: SessionSourceFilter[] = [
  "all",
  "rayu",
  "claude",
  "codex",
  "cursor",
  "opencode",
  "pi",
];

const SOURCE_FILTER_LABELS: Record<SessionSourceFilter, string> = {
  all: "All",
  rayu: "Rayu",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi",
};

type OrganizeMode = "project" | "chronological";
type SortMode = "updated" | "title";

interface AdaptedSidebarSession extends SidebarSessionLike {
  raw: SessionSummaryView;
}

interface EnrichedSidebarWorkspace extends SidebarWorkspaceLike {
  branch?: string;
  icon?: ProjectIconView;
  isPrimary?: boolean;
}

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
  const activeDraft = useAppStore((s) => s.activeDraft);
  const workspaces = useAppStore((s) => s.workspaces);
  const storeLedger = useAppStore((s) => s.workspaceLedger);
  const sessionSearchFocusNonce = useAppStore((s) => s.sessionSearchFocusNonce);
  const setWorkspaces = useAppStore((s) => s.setWorkspaces);
  const setWorkspaceLedger = useAppStore((s) => s.setWorkspaceLedger);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const openNewChatDraft = useAppStore((s) => s.openNewChatDraft);
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);
  const requestComposerFocus = useAppStore((s) => s.requestComposerFocus);

  const liveTurnsBySession = useLiveTraceStore((s) => s.liveTurnsBySession);

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
  const [sourceScope, setSourceScope] = React.useState<
    "all" | SessionSourceTool
  >("all");
  const [sourceFilter, setSourceFilter] =
    React.useState<SessionSourceFilter>("all");
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);
  const [syncConflict, setSyncConflict] = React.useState<{
    session: SessionSummaryView;
    message: string;
  } | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [organizeMode, setOrganizeMode] =
    React.useState<OrganizeMode>("project");
  const [sortMode, setSortMode] = React.useState<SortMode>("updated");
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const [localCollapsedIds, setLocalCollapsedIds] = React.useState<
    Record<string, boolean>
  >({});
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);
  const [renamingSession, setRenamingSession] =
    React.useState<SessionSummaryView | null>(null);
  const [renameTitle, setRenameTitle] = React.useState("");

  const sessionsQuery = useQuery({
    queryKey: ["sessions", "list", { includeArchived: true, includeExternal: true }],
    queryFn: () =>
      callRpc("sessions.list", {
        includeArchived: true,
        includeExternal: true,
      }),
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

  const ledgerQuery = useQuery({
    queryKey: ["workspace", "ledger"],
    queryFn: () => callRpc("workspace.ledger.get"),
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (
      foldersQuery.data &&
      foldersQuery.data.length > 0 &&
      workspaces.length === 0
    ) {
      setWorkspaces(foldersQuery.data);
    }
  }, [foldersQuery.data, setWorkspaces, workspaces.length]);

  React.useEffect(() => {
    if (ledgerQuery.data && !storeLedger) {
      setWorkspaceLedger(ledgerQuery.data);
    }
  }, [ledgerQuery.data, setWorkspaceLedger, storeLedger]);

  // Reconcile stale liveTurn spinners when daemon session list reports idle
  React.useEffect(() => {
    if (sessionsQuery.data?.sessions) {
      reconcileStaleLiveTurnsFromSessions(sessionsQuery.data.sessions);
    }
  }, [sessionsQuery.data?.sessions]);

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

  const effectiveLedger = storeLedger ?? ledgerQuery.data ?? null;

  const allSessions = React.useMemo(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data?.sessions],
  );

  const resolvedFolders: WorkspaceFolderView[] = React.useMemo(() => {
    if (workspaces.length > 0) return workspaces;
    if (foldersQuery.data && foldersQuery.data.length > 0) {
      return foldersQuery.data;
    }
    return [];
  }, [foldersQuery.data, workspaces]);

  const folderMetaByKey = React.useMemo(() => {
    const map = new Map<string, WorkspaceFolderView>();
    for (const folder of resolvedFolders) {
      const key = pathComparisonKey(folder.canonicalPath || folder.path);
      if (key) map.set(key, folder);
      const rawKey = pathComparisonKey(folder.path);
      if (rawKey && !map.has(rawKey)) map.set(rawKey, folder);
    }
    return map;
  }, [resolvedFolders]);

  const sidebarWorkspaces: EnrichedSidebarWorkspace[] = React.useMemo(() => {
    if (effectiveLedger && effectiveLedger.workspaces.length > 0) {
      return effectiveLedger.workspaces.map((ws) => {
        const meta =
          folderMetaByKey.get(pathComparisonKey(ws.canonicalPath || ws.path)) ??
          folderMetaByKey.get(pathComparisonKey(ws.path));
        return {
          id: ws.id,
          name: ws.name,
          path: ws.path,
          canonicalPath: ws.canonicalPath,
          sessionIds: ws.sessionIds,
          hidden: ws.hidden,
          missingOnDisk: ws.missingOnDisk,
          lastOpenedAt: ws.lastOpenedAt,
          branch: ws.branch ?? meta?.branch,
          icon: ws.icon ?? meta?.icon,
          isPrimary: ws.isPrimary ?? meta?.isPrimary,
        };
      });
    }
    if (resolvedFolders.length > 0) {
      return resolvedFolders.map((folder, idx) => ({
        id: folder.id ?? `ws_${idx}_${folder.path}`,
        name: folder.name,
        path: folder.path,
        canonicalPath: folder.canonicalPath ?? folder.path,
        branch: folder.branch,
        icon: folder.icon,
        isPrimary: folder.isPrimary,
      }));
    }
    const fallbackDirs = Array.from(
      new Set(
        allSessions
          .map((s) => s.workingDir)
          .filter((d): d is string => Boolean(d && d.trim().length > 0)),
      ),
    );
    return fallbackDirs.map((dir, idx) => ({
      id: `ws_inferred_${idx}_${dir}`,
      name: basenameOf(dir),
      path: dir,
      canonicalPath: dir,
      isPrimary: idx === 0,
    }));
  }, [allSessions, effectiveLedger, folderMetaByKey, resolvedFolders]);

  const openFolderPaths = React.useMemo(() => {
    if (effectiveLedger && effectiveLedger.openFolderPaths.length > 0) {
      return effectiveLedger.openFolderPaths;
    }
    return resolvedFolders.map((f) => f.path);
  }, [effectiveLedger, resolvedFolders]);

  const collapsedWorkspaceIds = React.useMemo(() => {
    const set = new Set<string>(effectiveLedger?.collapsedWorkspaceIds ?? []);
    for (const [wsId, collapsed] of Object.entries(localCollapsedIds)) {
      if (collapsed) set.add(wsId);
      else set.delete(wsId);
    }
    return Array.from(set);
  }, [effectiveLedger?.collapsedWorkspaceIds, localCollapsedIds]);

  const adaptedSessions: AdaptedSidebarSession[] = React.useMemo(
    () =>
      allSessions.map((session) => ({
        id: session.sessionId,
        title: session.title,
        workingDir: session.workingDir,
        updatedAtMs: session.updatedAtMs,
        status: session.status,
        archived: session.archived,
        isLive: Boolean(liveTurnsBySession[session.sessionId]?.isLive),
        source: session.source ?? session.sourceTool ?? "rayu",
        externalSessionId: session.externalSessionId,
        externalPath: session.externalPath,
        externalProjectName: session.externalProjectName,
        imported: session.imported,
        syncStale: session.syncStale,
        raw: session,
      })),
    [allSessions, liveTurnsBySession],
  );

  const pinnedSessionIds = React.useMemo(() => {
    const fromLedger = effectiveLedger?.pinnedSessionIds ?? [];
    if (fromLedger.length > 0) return fromLedger;
    return allSessions.filter((s) => s.pinned).map((s) => s.sessionId);
  }, [allSessions, effectiveLedger?.pinnedSessionIds]);

  const archivedSessionIds = React.useMemo(() => {
    const fromLedger = effectiveLedger?.archivedSessionIds ?? [];
    if (fromLedger.length > 0) return fromLedger;
    return allSessions.filter((s) => s.archived).map((s) => s.sessionId);
  }, [allSessions, effectiveLedger?.archivedSessionIds]);

  const sidebarTree = React.useMemo(
    () =>
      deriveSidebarTree<AdaptedSidebarSession>({
        sessions: adaptedSessions,
        workspaces: sidebarWorkspaces,
        pinnedSessionIds,
        archivedSessionIds,
        collapsedWorkspaceIds,
        manualWorkspaceOrder: effectiveLedger?.manualWorkspaceOrder,
        scopePaths: openFolderPaths,
        showAllProjects,
        viewMode: organizeMode === "chronological" ? "flat" : "grouped",
        sortBy: "updated",
        searchQuery,
        sourceFilter,
        activeDraft,
      }),
    [
      activeDraft,
      adaptedSessions,
      archivedSessionIds,
      collapsedWorkspaceIds,
      effectiveLedger?.manualWorkspaceOrder,
      openFolderPaths,
      organizeMode,
      pinnedSessionIds,
      searchQuery,
      showAllProjects,
      sidebarWorkspaces,
      sourceFilter,
    ],
  );

  const pinnedSet = React.useMemo(
    () => new Set(pinnedSessionIds),
    [pinnedSessionIds],
  );

  const sortByUiMode = React.useCallback(
    (list: AdaptedSidebarSession[]): AdaptedSidebarSession[] => {
      if (sortMode !== "title") return list;
      return [...list].sort((a, b) => {
        const aPin = pinnedSet.has(a.id);
        const bPin = pinnedSet.has(b.id);
        if (aPin !== bPin) return aPin ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
    },
    [pinnedSet, sortMode],
  );

  const refreshSessions = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace", "ledger"] });
  }, [queryClient]);

  // Lazy draft activation — zero eager `sessions.create` RPC until user submits!
  const handleNewChatDraft = (workingDir?: string, workspaceId?: string) => {
    const targetDir =
      workingDir ??
      activeProjectPath ??
      openFolderPaths[0] ??
      sidebarWorkspaces[0]?.path ??
      null;
    const matchedWs = workspaceId
      ? sidebarWorkspaces.find((w) => w.id === workspaceId)
      : targetDir
        ? sidebarWorkspaces.find(
            (w) =>
              pathComparisonKey(w.canonicalPath || w.path) ===
                pathComparisonKey(targetDir) ||
              pathComparisonKey(w.path) === pathComparisonKey(targetDir),
          )
        : undefined;

    openNewChatDraft({
      workingDir: targetDir,
      workspaceId: matchedWs?.id ?? workspaceId ?? null,
    });
    requestComposerFocus();
    onSessionSelected?.();
  };

  const handleSelectSession = async (
    session: SessionSummaryView | ExternalSessionOpenTarget,
  ) => {
    setSyncConflict(null);
    setImportError(null);

    const resolved = await resolveSessionForOpen(session);
    if (resolved.kind === "error") {
      setImportError(resolved.message);
      return;
    }

    if (resolved.kind === "conflict") {
      setSyncConflict({
        session: session as SessionSummaryView,
        message: resolved.message,
      });
      setActiveSession(resolved.sessionId, resolved.title);
      if (resolved.workingDir) setActiveProjectPath(resolved.workingDir);
      onSessionSelected?.();
      void callRpc("sessions.attach", { sessionId: resolved.sessionId })
        .then((res) => {
          useAppStore.getState().seedSessionPrefsFromSummary(res.session);
          reconcileStaleLiveTurnForSession(
            res.session.sessionId,
            res.session.status,
          );
        })
        .catch(() => {});
      return;
    }

    if (resolved.importedSession) {
      useAppStore
        .getState()
        .seedSessionPrefsFromSummary(resolved.importedSession);
    } else if ("status" in session) {
      useAppStore.getState().seedSessionPrefsFromSummary(session);
    }
    setActiveSession(resolved.sessionId, resolved.title);
    if (resolved.workingDir) setActiveProjectPath(resolved.workingDir);
    if (resolved.wasImported) {
      refreshSessions();
      void queryClient.invalidateQueries({
        queryKey: ["chat", "history", resolved.sessionId],
      });
    }
    onSessionSelected?.();
    void callRpc("sessions.attach", { sessionId: resolved.sessionId })
      .then((res) => {
        useAppStore.getState().seedSessionPrefsFromSummary(res.session);
        reconcileStaleLiveTurnForSession(
          res.session.sessionId,
          res.session.status,
        );
      })
      .catch(() => {});
  };

  const handleOpenSyncedConflictCopy = async () => {
    const s = syncConflict?.session;
    const parsedSynthetic = s
      ? parseSyntheticExternalSessionId(s.sessionId)
      : null;
    const externalId =
      s?.externalSessionId ?? parsedSynthetic?.externalSessionId;
    if (!s || !externalId) return;
    try {
      const result = await callRpc("sessions.importExternal", {
        items: [
          {
            source:
              s.source ??
              parsedSynthetic?.source ??
              s.sourceTool ??
              "claude_code",
            externalSessionId: externalId,
            externalPath: s.externalPath,
            workingDir: s.workingDir,
          },
        ],
        forkOnConflict: true,
      });
      const copied = result.sessions[0];
      if (copied) {
        setSyncConflict(null);
        useAppStore.getState().seedSessionPrefsFromSummary(copied);
        setActiveSession(copied.sessionId, copied.title);
        if (copied.workingDir) setActiveProjectPath(copied.workingDir);
        refreshSessions();
        void queryClient.invalidateQueries({
          queryKey: ["chat", "history", copied.sessionId],
        });
        onSessionSelected?.();
        void callRpc("sessions.attach", { sessionId: copied.sessionId }).catch(
          () => {},
        );
      }
    } catch {
      setSyncConflict(null);
    }
  };

  const handleToggleCollapse = (workspaceId: string, currentlyCollapsed: boolean) => {
    const nextCollapsed = !currentlyCollapsed;
    setLocalCollapsedIds((prev) => ({ ...prev, [workspaceId]: nextCollapsed }));
    void callRpc("workspace.ledger.setCollapsed", {
      workspaceId,
      collapsed: nextCollapsed,
    })
      .then((ledger) => {
        setWorkspaceLedger(ledger);
        queryClient.setQueryData(["workspace", "ledger"], ledger);
      })
      .catch(() => {});
  };

  const handleTogglePin = async (session: SessionSummaryView) => {
    const nextPinned = !(pinnedSet.has(session.sessionId) || session.pinned);
    await callRpc("sessions.pin", {
      sessionId: session.sessionId,
      pinned: nextPinned,
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
    if (updated.length > 0) {
      setWorkspaces(updated);
    }
    await callRpc("workspace.setProjectIcon", {
      workspacePath: folderPath,
      icon: iconView,
    });
  };

  const renderDraftRow = () => {
    if (!activeDraft) return null;
    const isActive = activeSessionId === null;
    return (
      <button
        key={activeDraft.draftId}
        type="button"
        data-testid="sidebar-draft-row"
        data-active={isActive ? "true" : "false"}
        onClick={() => {
          openNewChatDraft({
            workingDir: activeDraft.workingDir,
            workspaceId: activeDraft.workspaceId,
          });
          requestComposerFocus();
          onSessionSelected?.();
        }}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
          isActive
            ? "bg-active font-medium text-ink shadow-bevel-surface"
            : "text-body hover:bg-hover hover:text-ink",
        )}
      >
        <RunStatusPulse status="idle" />
        <span className="min-w-0 flex-1 truncate">
          {activeDraft.title || "New chat"}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-ink">
          Draft
        </span>
      </button>
    );
  };

  const renderSessionRow = (adapted: AdaptedSidebarSession) => {
    const session = adapted.raw;
    const isActive = activeSessionId === session.sessionId;
    const isPinned = pinnedSet.has(session.sessionId) || Boolean(session.pinned);
    const effectiveStatus = adapted.isLive ? "running" : session.status;
    const tone =
      effectiveStatus === "running"
        ? "running"
        : effectiveStatus === "waiting"
          ? "warn"
          : effectiveStatus === "error"
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
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none"
            >
              <RunStatusPulse status={tone} />
              <AgentSourceBadge source={session.source ?? session.sourceTool} />
              <span className="min-w-0 flex-1 truncate">{session.title}</span>
            </button>

            {isPinned && (
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
                  <span>{isPinned ? "Unpin session" : "Pin session"}</span>
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
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 font-mono text-[10px]"
                >
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
        const matched = allSessions.find(
          (s) =>
            s.sessionId === hit.sessionId ||
            s.externalSessionId === hit.sessionId,
        );
        if (matched) {
          void handleSelectSession(matched);
          return;
        }
        const parsed = parseSyntheticExternalSessionId(hit.sessionId);
        const inferredSource =
          parsed?.source ??
          (hit.sourceTool === "claude"
            ? "claude_code"
            : hit.sourceTool === "rayu"
              ? undefined
              : hit.sourceTool);
        void handleSelectSession({
          sessionId: hit.sessionId,
          title: hit.title,
          source: inferredSource,
          sourceTool: hit.sourceTool,
          ...(parsed ? { externalSessionId: parsed.externalSessionId } : {}),
        });
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

  const showScopeToggle =
    sidebarTree.hiddenOutOfScopeCount > 0 || showAllProjects;

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
          onClick={() => handleNewChatDraft()}
          className="flex-1 justify-start gap-2 px-2.5 text-xs font-medium"
        >
          <Plus className="size-3.5 text-brand-text" />
          <span>New session</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Import sessions and projects"
          title="Import chats & projects from Claude, Codex, Cursor..."
          data-testid="sidebar-import-btn"
          onClick={() => setImportDialogOpen(true)}
        >
          <Download className="size-3.5" />
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

      {/* Coding Agent Source Filter Bar (shown whenever external sessions exist or filter active) */}
      {(sidebarTree.sourceCounts.all > sidebarTree.sourceCounts.rayu ||
        sourceFilter !== "all") && (
        <div
          role="group"
          aria-label="Filter chats by coding agent"
          data-testid="sidebar-source-filter-bar"
          className="flex flex-wrap items-center gap-1 border-b border-hairline-soft px-2.5 py-1.5"
        >
          {SOURCE_FILTER_ORDER.filter(
            (key) =>
              key === "all" ||
              key === "rayu" ||
              sidebarTree.sourceCounts[key] > 0 ||
              sourceFilter === key,
          ).map((key) => {
            const active = sourceFilter === key;
            const count = sidebarTree.sourceCounts[key];
            return (
              <button
                key={key}
                type="button"
                data-testid={`sidebar-source-filter-${key}`}
                aria-pressed={active}
                onClick={() => setSourceFilter(key)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors",
                  active
                    ? "border-brand/40 bg-brand-soft font-medium text-brand-text"
                    : "border-hairline bg-pane text-muted-ink hover:border-premium hover:bg-hover hover:text-ink",
                )}
              >
                {key !== "all" && (
                  <AgentSourceIcon source={key} className="size-3" />
                )}
                <span>{SOURCE_FILTER_LABELS[key]}</span>
                <span className="font-mono text-[9.5px] opacity-75">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Non-blocking sync conflict banner */}
      {syncConflict && (
        <div
          data-testid="sidebar-sync-conflict-banner"
          className="flex items-center justify-between gap-2 border-b border-hairline-soft bg-pane px-2.5 py-1.5 text-[11px]"
        >
          <span className="min-w-0 truncate text-muted-ink">
            {syncConflict.message}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid="sidebar-open-synced-copy-btn"
              onClick={() => void handleOpenSyncedConflictCopy()}
              className="cursor-pointer rounded bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium text-brand-text hover:opacity-90"
            >
              Open synced copy
            </button>
            <button
              type="button"
              aria-label="Dismiss sync notice"
              onClick={() => setSyncConflict(null)}
              className="cursor-pointer text-muted-ink hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* Non-blocking external session import error banner */}
      {importError && (
        <div
          role="alert"
          data-testid="sidebar-import-error-banner"
          className="flex items-start justify-between gap-2 border-b border-danger/35 bg-danger-soft px-2.5 py-1.5 text-[11px] text-danger"
        >
          <div className="flex min-w-0 items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words leading-snug">
              {importError}
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss import error"
            onClick={() => setImportError(null)}
            className="shrink-0 cursor-pointer text-danger/80 hover:text-danger"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Workspace Scope Toggle (shown when other projects exist outside open VS Code folders) */}
      {showScopeToggle && (
        <div className="flex items-center justify-between border-b border-hairline-soft px-2.5 py-1.5">
          <span className="text-[10.5px] font-medium text-muted-ink">
            {showAllProjects ? "All projects" : "Workspace scope"}
          </span>
          <button
            type="button"
            data-testid="sidebar-scope-toggle"
            aria-pressed={showAllProjects}
            onClick={() => setShowAllProjects((v) => !v)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
              showAllProjects
                ? "border-brand/40 bg-brand-soft text-brand-text"
                : "border-hairline bg-pane text-muted-ink hover:border-premium hover:bg-hover hover:text-ink",
            )}
          >
            <FolderOpen className="size-3" />
            <span>
              {showAllProjects
                ? "Current workspace"
                : `All Projects (+${sidebarTree.hiddenOutOfScopeCount})`}
            </span>
          </button>
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
            {activeDraft && renderDraftRow()}
            {sortByUiMode(sidebarTree.flat).map(renderSessionRow)}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sidebarTree.groups.map((group) => {
              const ws = group.workspace as EnrichedSidebarWorkspace;
              const folderSessions = sortByUiMode(group.sessions);
              const iconSpec = toProjectIconSpec(ws.icon);

              return (
                <div
                  key={ws.id}
                  data-testid={`project-group-${ws.name}`}
                  className="flex flex-col gap-0.5"
                >
                  <div className="group/proj flex h-7 items-center gap-1 rounded-md px-1 text-xs text-muted-ink hover:bg-hover hover:text-ink">
                    <ProjectIconPicker
                      compact
                      value={iconSpec}
                      onChange={(next) =>
                        void handleProjectIconChange(ws.path, next)
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleCollapse(ws.id, group.isCollapsed)
                      }
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left font-medium text-ink"
                    >
                      <span className="truncate">{ws.name}</span>
                      {group.isCollapsed ? (
                        <ChevronRight className="size-3 shrink-0 text-muted-ink" />
                      ) : (
                        <ChevronDown className="size-3 shrink-0 text-muted-ink" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`New session in ${ws.name}`}
                      onClick={() => handleNewChatDraft(ws.path, ws.id)}
                      className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-ink opacity-0 transition-opacity hover:bg-active hover:text-ink group-hover/proj:opacity-100 focus-visible:opacity-100"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>

                  {!group.isCollapsed && (
                    <div className="flex flex-col gap-0.5 pl-1.5">
                      {group.hasDraft && renderDraftRow()}
                      {folderSessions.length > 0 ? (
                        folderSessions.map(renderSessionRow)
                      ) : !group.hasDraft ? (
                        <div className="px-2 py-1.5 text-[11px] text-faint">
                          No sessions in this project
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}

            {(sidebarTree.ungrouped.length > 0 ||
              sidebarTree.ungroupedHasDraft) && (
              <div
                data-testid="project-group-ungrouped"
                className="flex flex-col gap-0.5"
              >
                <div className="px-2 py-1 text-[10.5px] font-semibold tracking-wider text-muted-ink uppercase">
                  Other sessions
                </div>
                <div className="flex flex-col gap-0.5 pl-1.5">
                  {sidebarTree.ungroupedHasDraft && renderDraftRow()}
                  {sortByUiMode(sidebarTree.ungrouped).map(renderSessionRow)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsible Archived Section */}
        {sidebarTree.archived.length > 0 && (
          <div className="mt-4 border-t border-hairline-soft pt-2">
            <button
              type="button"
              onClick={() => setArchivedExpanded((v) => !v)}
              className="flex h-7 w-full cursor-pointer items-center justify-between rounded-md px-2 text-[11px] font-medium text-muted-ink hover:bg-hover hover:text-ink"
            >
              <span className="inline-flex items-center gap-1.5">
                <Archive className="size-3" />
                <span>Archived ({sidebarTree.archived.length})</span>
              </span>
              {archivedExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
            </button>
            {archivedExpanded && (
              <div className="mt-1 flex flex-col gap-0.5 opacity-80">
                {sidebarTree.archived.map(renderSessionRow)}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Import Sessions & Projects Dialog */}
      <ImportSessionsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImported={(imported) => {
          useAppStore.getState().seedSessionPrefsFromSummary(imported);
          setActiveSession(imported.sessionId, imported.title);
          if (imported.workingDir) setActiveProjectPath(imported.workingDir);
          refreshSessions();
          void queryClient.invalidateQueries({
            queryKey: ["chat", "history", imported.sessionId],
          });
          onSessionSelected?.();
          void callRpc("sessions.attach", { sessionId: imported.sessionId })
            .then((res) => {
              useAppStore.getState().seedSessionPrefsFromSummary(res.session);
              reconcileStaleLiveTurnForSession(
                res.session.sessionId,
                res.session.status,
              );
            })
            .catch(() => {});
        }}
      />

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
          <form
            onSubmit={(e) => void handleRenameSubmit(e)}
            className="flex flex-col gap-3"
          >
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
