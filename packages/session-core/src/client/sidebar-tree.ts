export type SessionSourceId =
  | "rayu"
  | "claude_code"
  | "claude_desktop"
  | "codex"
  | "codex_desktop"
  | "cursor"
  | "opencode"
  | "pi";

export type SessionSourceFilter =
  | "all"
  | "rayu"
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "pi";

export function normalizeSessionSource(raw?: string | null): SessionSourceId {
  const normalized = raw?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  switch (normalized) {
    case "claude_code":
    case "claude":
      return "claude_code";
    case "claude_desktop":
      return "claude_desktop";
    case "codex":
    case "codex_cli":
      return "codex";
    case "codex_desktop":
      return "codex_desktop";
    case "cursor":
      return "cursor";
    case "opencode":
    case "open_code":
      return "opencode";
    case "pi":
      return "pi";
    case "rayu":
    case "rayucode":
    default:
      return "rayu";
  }
}

export function sessionSourceToFilterGroup(
  source?: string | null
): Exclude<SessionSourceFilter, "all"> {
  switch (normalizeSessionSource(source)) {
    case "claude_code":
    case "claude_desktop":
      return "claude";
    case "codex":
    case "codex_desktop":
      return "codex";
    case "cursor":
      return "cursor";
    case "opencode":
      return "opencode";
    case "pi":
      return "pi";
    case "rayu":
    default:
      return "rayu";
  }
}

export function formatSessionSourceLabel(source?: string | null): string {
  switch (normalizeSessionSource(source)) {
    case "claude_code":
      return "Claude Code";
    case "claude_desktop":
      return "Claude Desktop";
    case "codex":
      return "Codex CLI";
    case "codex_desktop":
      return "Codex Desktop";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    case "rayu":
    default:
      return "RayuCode";
  }
}

export interface SidebarWorkspaceLike {
  id: string;
  name: string;
  path: string;
  canonicalPath?: string;
  sessionIds?: readonly string[];
  hidden?: boolean;
  missingOnDisk?: boolean;
  lastOpenedAt?: number;
}

export interface SidebarSessionLike {
  id: string;
  title: string;
  workingDir?: string | null;
  updatedAtMs?: number;
  status?: string;
  archived?: boolean;
  isLive?: boolean;
  needsAttention?: boolean;
  messageCount?: number;
  source?: string | null;
  externalSessionId?: string;
  externalPath?: string;
  externalProjectName?: string;
  imported?: boolean;
  syncStale?: boolean;
}

export interface ProvisionalDraftSession {
  draftId: string;
  title?: string;
  workingDir: string | null;
  workspaceId: string | null;
  model?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  createdAt: number;
}

export interface SidebarWorkspaceGroup<TSession extends SidebarSessionLike> {
  workspace: SidebarWorkspaceLike;
  sessions: TSession[];
  hasDraft: boolean;
  isCollapsed: boolean;
  latestUpdatedAtMs: number;
}

export interface DeriveSidebarTreeInput<TSession extends SidebarSessionLike> {
  sessions: readonly TSession[];
  workspaces: readonly SidebarWorkspaceLike[];
  pinnedSessionIds?: readonly string[];
  archivedSessionIds?: readonly string[];
  collapsedWorkspaceIds?: readonly string[];
  manualWorkspaceOrder?: readonly string[];
  scopePaths?: readonly string[];
  showAllProjects?: boolean;
  viewMode?: "grouped" | "flat";
  sortBy?: "updated" | "manual";
  searchQuery?: string;
  sourceFilter?: SessionSourceFilter;
  activeDraft?: ProvisionalDraftSession | null;
}

export interface DerivedSidebarTree<TSession extends SidebarSessionLike> {
  viewMode: "grouped" | "flat";
  pinned: TSession[];
  groups: SidebarWorkspaceGroup<TSession>[];
  ungrouped: TSession[];
  ungroupedHasDraft: boolean;
  flat: TSession[];
  archived: TSession[];
  hiddenOutOfScopeCount: number;
  sessionWorkspaceMap: Record<string, string>;
  sourceCounts: Record<SessionSourceFilter, number>;
  activeSourceFilter: SessionSourceFilter;
}

export function normalizeClientPath(raw?: string | null): string {
  if (!raw) return "";
  let normalized = raw.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  if (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized;
}

export function pathComparisonKey(raw?: string | null): string {
  return normalizeClientPath(raw).toLowerCase();
}

export function formatDaemonVersionLabel(rawVersion?: string | null): string {
  const trimmed = rawVersion?.trim() ?? "";
  if (!trimmed) return "";
  if (/^v\d/i.test(trimmed)) return trimmed;
  if (/^\d/.test(trimmed)) return `v${trimmed}`;
  // e.g. "rayu-harness-api-bridge/0.1.0" -> "v0.1.0" (never "vrayu-harness-api-bridge/0.1.0")
  const slashVersion = trimmed.match(/\/v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)$/i);
  if (slashVersion?.[1]) {
    return `v${slashVersion[1]}`;
  }
  return trimmed;
}

export function createOrReuseDraft(
  currentDraft: ProvisionalDraftSession | null | undefined,
  target: {
    workingDir?: string | null;
    workspaceId?: string | null;
    model?: string;
    reasoningEffort?: string;
    permissionMode?: string;
  },
  now = Date.now()
): ProvisionalDraftSession {
  const nextDir = target.workingDir ? normalizeClientPath(target.workingDir) : null;
  const nextWsId = target.workspaceId ?? null;

  if (currentDraft) {
    const sameWorkspace =
      (nextWsId && currentDraft.workspaceId === nextWsId) ||
      (nextDir &&
        currentDraft.workingDir &&
        pathComparisonKey(currentDraft.workingDir) === pathComparisonKey(nextDir)) ||
      (!nextWsId && !nextDir && !currentDraft.workspaceId && !currentDraft.workingDir);

    if (sameWorkspace) {
      return {
        ...currentDraft,
        ...(target.model !== undefined ? { model: target.model } : {}),
        ...(target.reasoningEffort !== undefined
          ? { reasoningEffort: target.reasoningEffort }
          : {}),
        ...(target.permissionMode !== undefined
          ? { permissionMode: target.permissionMode }
          : {}),
      };
    }

    // Re-target the single ephemeral draft rather than spawning a second draft
    return {
      ...currentDraft,
      workingDir: nextDir,
      workspaceId: nextWsId,
      ...(target.model !== undefined ? { model: target.model } : {}),
      ...(target.reasoningEffort !== undefined
        ? { reasoningEffort: target.reasoningEffort }
        : {}),
      ...(target.permissionMode !== undefined
        ? { permissionMode: target.permissionMode }
        : {}),
    };
  }

  return {
    draftId: `draft_${now}`,
    title: "New chat",
    workingDir: nextDir,
    workspaceId: nextWsId,
    model: target.model,
    reasoningEffort: target.reasoningEffort,
    permissionMode: target.permissionMode,
    createdAt: now,
  };
}

export function deriveSidebarTree<TSession extends SidebarSessionLike>(
  input: DeriveSidebarTreeInput<TSession>
): DerivedSidebarTree<TSession> {
  const viewMode = input.viewMode ?? "grouped";
  const sortBy = input.sortBy ?? "updated";
  const query = input.searchQuery?.trim().toLowerCase() ?? "";
  const activeSourceFilter: SessionSourceFilter = input.sourceFilter ?? "all";

  const pinnedOrder = new Map<string, number>();
  (input.pinnedSessionIds ?? []).forEach((id, idx) => {
    if (!pinnedOrder.has(id)) pinnedOrder.set(id, idx);
  });

  const archivedSet = new Set<string>(input.archivedSessionIds ?? []);
  const collapsedSet = new Set<string>(input.collapsedWorkspaceIds ?? []);
  const manualOrder = new Map<string, number>();
  (input.manualWorkspaceOrder ?? []).forEach((id, idx) => {
    if (!manualOrder.has(id)) manualOrder.set(id, idx);
  });

  // Deduplicate input sessions by id (newest wins)
  const uniqueSessions = new Map<string, TSession>();
  for (const session of input.sessions) {
    if (!session.id) continue;
    const prev = uniqueSessions.get(session.id);
    if (!prev || (session.updatedAtMs ?? 0) >= (prev.updatedAtMs ?? 0)) {
      uniqueSessions.set(session.id, session);
    }
  }

  const allSessions = Array.from(uniqueSessions.values());
  const matchesQuery = (s: TSession, wsName?: string): boolean => {
    if (!query) return true;
    const title = (s.title ?? "").toLowerCase();
    const dir = (s.workingDir ?? "").toLowerCase();
    const extProj = (s.externalProjectName ?? "").toLowerCase();
    return (
      title.includes(query) ||
      dir.includes(query) ||
      extProj.includes(query) ||
      Boolean(wsName && wsName.toLowerCase().includes(query))
    );
  };

  const matchesSourceFilter = (s: TSession): boolean =>
    activeSourceFilter === "all" ||
    sessionSourceToFilterGroup(s.source) === activeSourceFilter;

  // Partition archived vs active sessions
  const archived: TSession[] = [];
  const activeSessions: TSession[] = [];
  for (const session of allSessions) {
    const isArchived = Boolean(session.archived) || archivedSet.has(session.id);
    if (isArchived) {
      if (matchesQuery(session)) archived.push(session);
    } else {
      activeSessions.push(session);
    }
  }
  archived.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));

  // Build workspace lookup indices
  const visibleWorkspaces = input.workspaces.filter((ws) => !ws.hidden);
  const wsById = new Map<string, SidebarWorkspaceLike>();
  const wsByPathKey = new Map<string, SidebarWorkspaceLike>();
  const explicitSessionOwner = new Map<string, string>();

  for (const ws of visibleWorkspaces) {
    wsById.set(ws.id, ws);
    const canonicalKey = pathComparisonKey(ws.canonicalPath || ws.path);
    const rawKey = pathComparisonKey(ws.path);
    if (canonicalKey && !wsByPathKey.has(canonicalKey)) {
      wsByPathKey.set(canonicalKey, ws);
    }
    if (rawKey && !wsByPathKey.has(rawKey)) {
      wsByPathKey.set(rawKey, ws);
    }
    for (const sid of ws.sessionIds ?? []) {
      if (sid && !explicitSessionOwner.has(sid)) {
        explicitSessionOwner.set(sid, ws.id);
      }
    }
  }

  // Determine VS Code open-folder scope filter if provided
  const scopeKeys = new Set(
    (input.scopePaths ?? []).map((p) => pathComparisonKey(p)).filter(Boolean)
  );
  const applyScopeFilter =
    scopeKeys.size > 0 && input.showAllProjects !== true;

  let hiddenOutOfScopeCount = 0;
  const scopedWorkspaces: SidebarWorkspaceLike[] = [];
  for (const ws of visibleWorkspaces) {
    if (!applyScopeFilter) {
      scopedWorkspaces.push(ws);
      continue;
    }
    const cKey = pathComparisonKey(ws.canonicalPath || ws.path);
    const rKey = pathComparisonKey(ws.path);
    if ((cKey && scopeKeys.has(cKey)) || (rKey && scopeKeys.has(rKey))) {
      scopedWorkspaces.push(ws);
    } else {
      hiddenOutOfScopeCount += 1;
    }
  }
  const visibleWorkspaceIds = new Set(scopedWorkspaces.map((w) => w.id));

  // Assign each active session to AT MOST ONE workspace (never matching empty workingDir!)
  // and compute sourceCounts BEFORE applying sourceFilter over non-archived, scope-visible sessions.
  const sessionsByWorkspace = new Map<string, TSession[]>();
  const sessionWorkspaceMap: Record<string, string> = {};
  const ungrouped: TSession[] = [];
  const sourceCounts: Record<SessionSourceFilter, number> = {
    all: 0,
    rayu: 0,
    claude: 0,
    codex: 0,
    cursor: 0,
    opencode: 0,
    pi: 0,
  };

  for (const session of activeSessions) {
    let ownerId = explicitSessionOwner.get(session.id);
    if (!ownerId && session.workingDir) {
      const sKey = pathComparisonKey(session.workingDir);
      if (sKey) {
        const directMatch = wsByPathKey.get(sKey);
        if (directMatch) {
          ownerId = directMatch.id;
        }
      }
    }

    const validOwnerId = ownerId && wsById.has(ownerId) ? ownerId : undefined;
    if (validOwnerId) {
      sessionWorkspaceMap[session.id] = validOwnerId;
    }

    const isScopeVisible =
      !applyScopeFilter ||
      !validOwnerId ||
      visibleWorkspaceIds.has(validOwnerId);
    if (isScopeVisible) {
      sourceCounts.all += 1;
      sourceCounts[sessionSourceToFilterGroup(session.source)] += 1;
    }

    if (!matchesSourceFilter(session)) {
      continue;
    }

    if (validOwnerId) {
      const ws = wsById.get(validOwnerId)!;
      if (!matchesQuery(session, ws.name)) continue;
      let bucket = sessionsByWorkspace.get(validOwnerId);
      if (!bucket) {
        bucket = [];
        sessionsByWorkspace.set(validOwnerId, bucket);
      }
      bucket.push(session);
    } else {
      if (matchesQuery(session)) {
        ungrouped.push(session);
      }
    }
  }

  const sortSessions = (list: TSession[]): TSession[] =>
    list.sort((a, b) => {
      const aPin = pinnedOrder.has(a.id) ? pinnedOrder.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bPin = pinnedOrder.has(b.id) ? pinnedOrder.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (aPin !== bPin) return aPin - bPin;
      return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
    });

  sortSessions(ungrouped);

  // Determine where the single provisional draft attaches (at most 1 place)
  let draftWorkspaceId: string | null = null;
  let ungroupedHasDraft = false;
  if (input.activeDraft) {
    const d = input.activeDraft;
    if (d.workspaceId && scopedWorkspaces.some((w) => w.id === d.workspaceId)) {
      draftWorkspaceId = d.workspaceId;
    } else if (d.workingDir) {
      const dKey = pathComparisonKey(d.workingDir);
      const matched = scopedWorkspaces.find(
        (w) =>
          pathComparisonKey(w.canonicalPath || w.path) === dKey ||
          pathComparisonKey(w.path) === dKey
      );
      if (matched) {
        draftWorkspaceId = matched.id;
      } else {
        ungroupedHasDraft = true;
      }
    } else {
      ungroupedHasDraft = true;
    }
  }

  const groups: SidebarWorkspaceGroup<TSession>[] = scopedWorkspaces
    .map((ws) => {
      const list = sortSessions([...(sessionsByWorkspace.get(ws.id) ?? [])]);
      const latestUpdatedAtMs = list.reduce(
        (max, s) => Math.max(max, s.updatedAtMs ?? 0),
        ws.lastOpenedAt ?? 0
      );
      return {
        workspace: ws,
        sessions: list,
        hasDraft: draftWorkspaceId === ws.id,
        isCollapsed: collapsedSet.has(ws.id),
        latestUpdatedAtMs,
      };
    })
    .filter((group) => {
      if (!query) return true;
      return (
        group.sessions.length > 0 ||
        group.workspace.name.toLowerCase().includes(query)
      );
    });

  groups.sort((a, b) => {
    if (sortBy === "manual") {
      const aOrder = manualOrder.get(a.workspace.id) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = manualOrder.get(b.workspace.id) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    return b.latestUpdatedAtMs - a.latestUpdatedAtMs;
  });

  // Pinned & flat lists (respecting scope, search query, and sourceFilter)
  const scopedActiveSessions = activeSessions.filter((s) => {
    if (!matchesSourceFilter(s)) return false;
    if (!matchesQuery(s, wsById.get(sessionWorkspaceMap[s.id] ?? "")?.name)) {
      return false;
    }
    if (!applyScopeFilter) return true;
    const owner = sessionWorkspaceMap[s.id];
    return !owner || visibleWorkspaceIds.has(owner);
  });

  const pinned = scopedActiveSessions
    .filter((s) => pinnedOrder.has(s.id))
    .sort((a, b) => pinnedOrder.get(a.id)! - pinnedOrder.get(b.id)!);

  const flat = [...scopedActiveSessions].sort(
    (a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0)
  );

  return {
    viewMode,
    pinned,
    groups,
    ungrouped,
    ungroupedHasDraft,
    flat,
    archived,
    hiddenOutOfScopeCount,
    sessionWorkspaceMap,
    sourceCounts,
    activeSourceFilter,
  };
}
