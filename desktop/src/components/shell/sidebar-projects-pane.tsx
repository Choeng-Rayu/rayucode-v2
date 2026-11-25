import * as React from "react"
import {
  deriveSidebarTree,
  type SidebarWorkspaceLike,
} from "@rayu-dev/rayucode-session-core/client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Eye,
  Folder,
  GitBranch,
  GripVertical,
  Laptop,
  List,
  MessageCircle,
  Monitor,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Pin,
  Plus,
  Settings,
  SlidersHorizontal,
  SquarePen,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { prefetchTraceTurns, traceKeys } from "@/features/execution-trace"
import { sessionsQueryOptions } from "@/features/sessions"
import { useAppStore } from "@/lib/app-store"
import { formatRelativeTimestamp, isTempDirectoryPath } from "@/lib/harness-adapter"
import {
  ipcClient,
  type ProjectGroup,
  type ProjectGroupSessionItem,
  type SidebarProjectMeta,
  type SidebarSectionItem,
  type SidebarState,
} from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { CreateProjectDialog } from "./create-project-dialog"
import { EditProjectDialog } from "./edit-project-dialog"
import { ProjectIconGlyph } from "./project-icon-picker"

interface ChatListItem {
  id: string
  title: string
  route?: string
  projectId?: string
  projectName?: string
  workingDir?: string
  connection: "local" | "cloud"
  relativeTime: string
  updatedAtMs: number
  saved?: boolean
}

interface MergedProject extends SidebarProjectMeta {
  expanded: boolean
  hasDraft: boolean
  lastActivityMs: number
  sessions: ChatListItem[]
}

type ActiveHoverCard =
  | { kind: "project"; project: MergedProject; top: number; left: number }
  | {
      kind: "chat"
      chat: ChatListItem
      project: MergedProject | null
      top: number
      left: number
    }

const DEFAULT_VISIBLE_PROJECT_CHATS = 5

const EMPTY_SIDEBAR_STATE: SidebarState = {
  projects: [],
  sections: [],
  pinnedChatIds: [],
  archivedChatIds: [],
  organizeBy: "project",
  sortBy: "updated",
  showProjectChatsInRecents: false,
  manualProjectOrder: [],
  collapsedProjectIds: [],
  hiddenProjectPaths: [],
}

function shortenDisplayPath(rawPath: string): string {
  return rawPath.replace(/^\/Users\/[^/]+/, "~")
}

function normalizePathForMatch(raw?: string | null): string {
  if (!raw) return ""
  return raw
    .trim()
    .replace(/^~(?=\/|$)/, "/Users/~")
    .replace(/^\/Users\/[^/]+/, "/Users/~")
    .replace(/\/+$/, "")
    .toLowerCase()
}

function pathMatchesFolder(sessionDir: string, folder: string): boolean {
  const s = normalizePathForMatch(sessionDir)
  const f = normalizePathForMatch(folder)
  if (!s || !f) return false
  return s === f || s.startsWith(`${f}/`)
}

export interface SidebarProjectsPaneProps {
  onOpenSession: (sessionId: string, route?: string, title?: string) => void
  searchQuery?: string
}

export function SidebarProjectsPane({
  onOpenSession,
  searchQuery = "",
}: SidebarProjectsPaneProps) {
  const queryClient = useQueryClient()
  const activeRoute = useAppStore((s) => s.activeRoute)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const activeDraft = useAppStore((s) => s.activeDraft)
  const activeWorkspacePath = useAppStore((s) => s.activeWorkspacePath)
  const daemonMode = useAppStore((s) => s.daemonMode)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const setActiveSessionTitle = useAppStore((s) => s.setActiveSessionTitle)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const openNewChatDraft = useAppStore((s) => s.openNewChatDraft)

  const sessionsQuery = useQuery(sessionsQueryOptions())
  const projectsQuery = useQuery({
    queryKey: ["sessions", "projects", daemonMode],
    queryFn: () => ipcClient.sessions.listProjects(),
    staleTime: 15_000,
  })
  const recentsQuery = useQuery({
    queryKey: ["sessions", "recents", daemonMode],
    queryFn: () => ipcClient.sessions.listRecents(),
    staleTime: 15_000,
  })

  const [sidebarState, setSidebarState] =
    React.useState<SidebarState>(EMPTY_SIDEBAR_STATE)
  const [expandedOverrides, setExpandedOverrides] = React.useState<
    Record<string, boolean>
  >({})
  const [expandedChatLists, setExpandedChatLists] = React.useState<
    Record<string, boolean>
  >({})
  const [projectsCollapsed, setProjectsCollapsed] = React.useState(false)
  const [editingProject, setEditingProject] =
    React.useState<SidebarProjectMeta | null>(null)
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [creatingSection, setCreatingSection] = React.useState(false)
  const [newSectionName, setNewSectionName] = React.useState("")
  const [renamingChatId, setRenamingChatId] = React.useState<string | null>(
    null
  )
  const [renamingTitle, setRenamingTitle] = React.useState("")
  const [hoverCard, setHoverCard] = React.useState<ActiveHoverCard | null>(null)
  const [menuOpenCount, setMenuOpenCount] = React.useState(0)

  const hoverTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void ipcClient.sidebar.getState().then((savedState) => {
      if (cancelled) return
      setSidebarState({
        ...EMPTY_SIDEBAR_STATE,
        ...savedState,
        collapsedProjectIds: savedState.collapsedProjectIds ?? [],
        hiddenProjectPaths: savedState.hiddenProjectPaths ?? [],
      })
    })
    const unsubscribeExternal = ipcClient.sidebar.onStateChange((updated) => {
      if (cancelled) return
      setSidebarState({
        ...EMPTY_SIDEBAR_STATE,
        ...updated,
        collapsedProjectIds: updated.collapsedProjectIds ?? [],
        hiddenProjectPaths: updated.hiddenProjectPaths ?? [],
      })
      void queryClient.invalidateQueries({ queryKey: ["sessions"] })
    })
    return () => {
      cancelled = true
      unsubscribeExternal()
    }
  }, [daemonMode, queryClient])

  React.useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  const persistSidebarState = React.useCallback(
    (updater: (prev: SidebarState) => SidebarState) => {
      setSidebarState((prev) => {
        const next = updater(prev)
        void ipcClient.sidebar.saveState(next)
        return next
      })
    },
    []
  )

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const scheduleHideHoverCard = React.useCallback(() => {
    clearHoverTimer()
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverCard(null)
    }, 140)
  }, [clearHoverTimer])

  const showHoverCard = React.useCallback(
    (card: ActiveHoverCard) => {
      if (menuOpenCount > 0) return
      clearHoverTimer()
      setHoverCard(card)
    },
    [clearHoverTimer, menuOpenCount]
  )

  const handleMenuOpenChange = React.useCallback(
    (open: boolean) => {
      if (open) {
        clearHoverTimer()
        setHoverCard(null)
      }
      setMenuOpenCount((c) => Math.max(0, c + (open ? 1 : -1)))
    },
    [clearHoverTimer]
  )

  const baseProjects: ProjectGroup[] = React.useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data]
  )
  const baseRecents: ProjectGroupSessionItem[] = React.useMemo(
    () => recentsQuery.data ?? [],
    [recentsQuery.data]
  )
  const liveSessions = React.useMemo(
    () => sessionsQuery.data ?? [],
    [sessionsQuery.data]
  )

  const archivedSet = React.useMemo(
    () => new Set(sidebarState.archivedChatIds),
    [sidebarState.archivedChatIds]
  )
  const pinnedChatSet = React.useMemo(
    () => new Set(sidebarState.pinnedChatIds),
    [sidebarState.pinnedChatIds]
  )
  const collapsedSet = React.useMemo(
    () => new Set(sidebarState.collapsedProjectIds ?? []),
    [sidebarState.collapsedProjectIds]
  )
  const hiddenPathSet = React.useMemo(
    () =>
      new Set(
        (sidebarState.hiddenProjectPaths ?? [])
          .map((p) => normalizePathForMatch(p))
          .filter(Boolean)
      ),
    [sidebarState.hiddenProjectPaths]
  )

  const normalizedSearch = searchQuery.trim().toLowerCase()

  // Build deduplicated project list and derive strict disjoint grouping via deriveSidebarTree
  const {
    mergedProjects,
    filteredProjects,
    filteredRecentChats,
    allFlatChats,
    ungroupedHasDraft,
  } = React.useMemo(() => {
    const baseById = new Map(baseProjects.map((bp) => [bp.id, bp]))
    const liveById = new Map(liveSessions.map((s) => [s.id, s]))

    const candidateMetas: Array<{
      meta: SidebarProjectMeta
      baseGroup?: ProjectGroup
    }> = []
    const seenIds = new Set<string>()
    const seenNormFolders = new Set<string>()

    for (const saved of sidebarState.projects) {
      if (seenIds.has(saved.id)) continue
      const savedNormFolders = saved.folders
        .map((f) => normalizePathForMatch(f))
        .filter(Boolean)
      if (
        savedNormFolders.length > 0 &&
        savedNormFolders.every((nf) => seenNormFolders.has(nf))
      ) {
        continue
      }
      seenIds.add(saved.id)
      for (const nf of savedNormFolders) {
        seenNormFolders.add(nf)
      }
      candidateMetas.push({
        meta: saved,
        baseGroup:
          baseById.get(saved.id) ??
          baseProjects.find((bp) =>
            saved.folders.some(
              (f) =>
                normalizePathForMatch(f) !== "" &&
                normalizePathForMatch(f) === normalizePathForMatch(bp.path)
            )
          ),
      })
    }

    // Do NOT halt project auto-discovery simply because sidebarState.projects.length > 0;
    // still skip temp directories and explicitly hidden paths.
    for (const bp of baseProjects) {
      if (seenIds.has(bp.id)) continue
      if (isTempDirectoryPath(bp.path)) continue
      const nf = normalizePathForMatch(bp.path)
      if (nf && (seenNormFolders.has(nf) || hiddenPathSet.has(nf))) continue
      if (nf) seenNormFolders.add(nf)
      seenIds.add(bp.id)
      candidateMetas.push({
        meta: {
          id: bp.id,
          name: bp.name,
          folders: [bp.path],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          pinned: false,
          sectionId: null,
          updatedAt: 0,
        },
        baseGroup: bp,
      })
    }

    const candidateById = new Map(
      candidateMetas.map((entry) => [entry.meta.id, entry])
    )

    // Collect unified deduplicated session pool from liveSessions, baseProjects, and baseRecents
    const chatMap = new Map<string, ChatListItem>()
    const explicitOwnerBySessionId = new Map<string, string>()

    const matchBestProject = (workingDir?: string): SidebarProjectMeta | null => {
      if (!workingDir) return null
      let best: SidebarProjectMeta | null = null
      let bestLen = 0
      for (const { meta } of candidateMetas) {
        for (const folder of meta.folders) {
          if (pathMatchesFolder(workingDir, folder)) {
            const len = normalizePathForMatch(folder).length
            if (len > bestLen) {
              bestLen = len
              best = meta
            }
          }
        }
      }
      return best
    }

    for (const session of liveSessions) {
      if (session.archived || archivedSet.has(session.id)) continue
      const owner = matchBestProject(session.workingDir)
      if (!owner && isTempDirectoryPath(session.workingDir)) continue
      if (owner) {
        explicitOwnerBySessionId.set(session.id, owner.id)
      }
      const updatedAtMs = session.updatedAtMs ?? 0
      chatMap.set(session.id, {
        id: session.id,
        title: session.title,
        projectId: owner?.id,
        projectName: owner?.name,
        workingDir: session.workingDir,
        connection:
          session.connection ??
          (session.id.startsWith("ses_") ? "cloud" : "local"),
        relativeTime: formatRelativeTimestamp(
          session.updatedAtMs,
          session.updatedAt || "Now"
        ),
        updatedAtMs,
        saved: session.saved,
      })
    }

    // Fallback for test/mock ProjectGroups whose sessions lack workingDir on liveSessions
    for (const { meta, baseGroup } of candidateMetas) {
      if (!baseGroup) continue
      for (const raw of baseGroup.sessions) {
        if (archivedSet.has(raw.id)) continue
        const existing = chatMap.get(raw.id)
        if (existing) {
          if (raw.route && !existing.route) {
            existing.route = raw.route
          }
          continue
        }
        if (raw.workingDir) {
          const matchesOwn = meta.folders.some((f) =>
            pathMatchesFolder(raw.workingDir!, f)
          )
          if (!matchesOwn) continue
        }
        const live = liveById.get(raw.id)
        if (live?.workingDir) continue
        explicitOwnerBySessionId.set(raw.id, meta.id)
        const updatedAtMs = raw.updatedAtMs ?? live?.updatedAtMs ?? 0
        chatMap.set(raw.id, {
          id: raw.id,
          title: live?.title ?? raw.title,
          route: raw.route,
          projectId: meta.id,
          projectName: meta.name,
          workingDir: raw.workingDir ?? meta.folders[0],
          connection:
            raw.connection ??
            live?.connection ??
            (raw.id.startsWith("ses_") ? "cloud" : "local"),
          relativeTime: formatRelativeTimestamp(
            updatedAtMs || undefined,
            raw.updatedAt ?? live?.updatedAt ?? "Now"
          ),
          updatedAtMs,
          saved: raw.saved ?? live?.saved,
        })
      }
    }

    // Include any mock/recent sessions absent from liveSessions (e.g. swarm route entries)
    for (const raw of baseRecents) {
      if (archivedSet.has(raw.id)) continue
      const existing = chatMap.get(raw.id)
      if (existing) {
        if (raw.route && !existing.route) {
          existing.route = raw.route
        }
        continue
      }
      const live = liveById.get(raw.id)
      const workingDir = raw.workingDir ?? live?.workingDir
      const owner = matchBestProject(workingDir)
      if (!owner && isTempDirectoryPath(workingDir)) continue
      if (owner) {
        explicitOwnerBySessionId.set(raw.id, owner.id)
      }
      const updatedAtMs = raw.updatedAtMs ?? live?.updatedAtMs ?? 0
      chatMap.set(raw.id, {
        id: raw.id,
        title: live?.title ?? raw.title,
        route: raw.route,
        projectId: owner?.id,
        projectName: owner?.name,
        workingDir,
        connection:
          raw.connection ??
          live?.connection ??
          (raw.id.startsWith("ses_") ? "cloud" : "local"),
        relativeTime: formatRelativeTimestamp(
          updatedAtMs || undefined,
          raw.updatedAt ?? live?.updatedAt ?? "Now"
        ),
        updatedAtMs,
        saved: raw.saved ?? live?.saved,
      })
    }

    const explicitIdsByWorkspace = new Map<string, string[]>()
    for (const [sid, wsId] of explicitOwnerBySessionId.entries()) {
      const bucket = explicitIdsByWorkspace.get(wsId) ?? []
      bucket.push(sid)
      explicitIdsByWorkspace.set(wsId, bucket)
    }

    const workspaceInputs: SidebarWorkspaceLike[] = candidateMetas.map(
      ({ meta }) => ({
        id: meta.id,
        name: meta.name,
        path: meta.folders[0] ?? "",
        canonicalPath: meta.folders[0] ?? "",
        sessionIds: explicitIdsByWorkspace.get(meta.id) ?? [],
        hidden: false,
        lastOpenedAt: meta.updatedAt,
      })
    )

    const allSessions = Array.from(chatMap.values())

    const derivedAll = deriveSidebarTree({
      sessions: allSessions,
      workspaces: workspaceInputs,
      pinnedSessionIds: sidebarState.pinnedChatIds,
      archivedSessionIds: sidebarState.archivedChatIds,
      collapsedWorkspaceIds: sidebarState.collapsedProjectIds ?? [],
      manualWorkspaceOrder: sidebarState.manualProjectOrder,
      viewMode: sidebarState.organizeBy === "flat" ? "flat" : "grouped",
      sortBy: sidebarState.sortBy,
      activeDraft,
    })

    const derivedFiltered = normalizedSearch
      ? deriveSidebarTree({
          sessions: allSessions,
          workspaces: workspaceInputs,
          pinnedSessionIds: sidebarState.pinnedChatIds,
          archivedSessionIds: sidebarState.archivedChatIds,
          collapsedWorkspaceIds: sidebarState.collapsedProjectIds ?? [],
          manualWorkspaceOrder: sidebarState.manualProjectOrder,
          viewMode: sidebarState.organizeBy === "flat" ? "flat" : "grouped",
          sortBy: sidebarState.sortBy,
          searchQuery: normalizedSearch,
          activeDraft,
        })
      : derivedAll

    const toMergedProjects = (
      tree: typeof derivedAll,
      forceExpand: boolean
    ): MergedProject[] => {
      const mapped = tree.groups.map((group) => {
        const entry = candidateById.get(group.workspace.id)
        const meta: SidebarProjectMeta = entry?.meta ?? {
          id: group.workspace.id,
          name: group.workspace.name,
          folders: group.workspace.path ? [group.workspace.path] : [],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          pinned: false,
          sectionId: null,
          updatedAt: group.latestUpdatedAtMs,
        }
        const expanded = forceExpand
          ? true
          : (expandedOverrides[meta.id] ??
            (collapsedSet.has(meta.id)
              ? false
              : (entry?.baseGroup?.expanded ?? !group.isCollapsed)))
        return {
          ...meta,
          expanded,
          hasDraft: group.hasDraft,
          lastActivityMs: Math.max(meta.updatedAt ?? 0, group.latestUpdatedAtMs),
          sessions: group.sessions.map((s) => ({
            ...s,
            projectId: meta.id,
            projectName: meta.name,
          })),
        }
      })

      // Keep pinned projects at the top while preserving deriveSidebarTree sort order within groups
      const orderIdx = new Map(
        sidebarState.manualProjectOrder.map((id, i) => [id, i])
      )
      mapped.sort((a, b) => {
        const aPin = a.pinned ? 1 : 0
        const bPin = b.pinned ? 1 : 0
        if (aPin !== bPin) return bPin - aPin
        if (sidebarState.sortBy === "manual") {
          const ai = orderIdx.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const bi = orderIdx.get(b.id) ?? Number.MAX_SAFE_INTEGER
          if (ai !== bi) return ai - bi
        }
        return b.lastActivityMs - a.lastActivityMs
      })
      return mapped
    }

    const allMerged = toMergedProjects(derivedAll, false)
    const filteredMerged = normalizedSearch
      ? toMergedProjects(derivedFiltered, true)
      : allMerged

    const sortFlatWithPins = (list: ChatListItem[]): ChatListItem[] =>
      [...list].sort((a, b) => {
        const aPin = pinnedChatSet.has(a.id) ? 1 : 0
        const bPin = pinnedChatSet.has(b.id) ? 1 : 0
        if (aPin !== bPin) return bPin - aPin
        return b.updatedAtMs - a.updatedAtMs
      })

    const flatList = sortFlatWithPins(derivedFiltered.flat)
    const recentsList = sidebarState.showProjectChatsInRecents
      ? flatList
      : derivedFiltered.ungrouped

    return {
      mergedProjects: allMerged,
      filteredProjects: filteredMerged,
      filteredRecentChats: recentsList,
      allFlatChats: flatList,
      ungroupedHasDraft: derivedFiltered.ungroupedHasDraft,
    }
  }, [
    activeDraft,
    archivedSet,
    baseProjects,
    baseRecents,
    collapsedSet,
    expandedOverrides,
    hiddenPathSet,
    liveSessions,
    normalizedSearch,
    pinnedChatSet,
    sidebarState.archivedChatIds,
    sidebarState.collapsedProjectIds,
    sidebarState.manualProjectOrder,
    sidebarState.organizeBy,
    sidebarState.pinnedChatIds,
    sidebarState.projects,
    sidebarState.showProjectChatsInRecents,
    sidebarState.sortBy,
  ])

  const projectById = React.useMemo(
    () => new Map(mergedProjects.map((p) => [p.id, p])),
    [mergedProjects]
  )

  const ensureProjectInState = React.useCallback(
    (
      proj: MergedProject,
      mutate: (meta: SidebarProjectMeta) => SidebarProjectMeta
    ) => {
      persistSidebarState((prev) => {
        const exists = prev.projects.some((p) => p.id === proj.id)
        const baseMeta: SidebarProjectMeta = exists
          ? prev.projects.find((p) => p.id === proj.id)!
          : {
              id: proj.id,
              name: proj.name,
              folders: proj.folders,
              iconKind: proj.iconKind,
              iconValue: proj.iconValue,
              iconColor: proj.iconColor,
              pinned: proj.pinned,
              sectionId: proj.sectionId ?? null,
              gitRemote: proj.gitRemote,
              updatedAt: Date.now(),
            }
        const updated = mutate(baseMeta)
        const nextProjects = exists
          ? prev.projects.map((p) => (p.id === proj.id ? updated : p))
          : [...prev.projects, updated]
        return { ...prev, projects: nextProjects }
      })
    },
    [persistSidebarState]
  )

  const handleToggleProjectExpanded = (proj: MergedProject) => {
    const nextExpanded = !proj.expanded
    setExpandedOverrides((prev) => ({ ...prev, [proj.id]: nextExpanded }))
    persistSidebarState((prev) => {
      const current = new Set(prev.collapsedProjectIds ?? [])
      if (nextExpanded) {
        current.delete(proj.id)
      } else {
        current.add(proj.id)
      }
      return { ...prev, collapsedProjectIds: Array.from(current) }
    })
  }

  const handleCreateProject = (project: SidebarProjectMeta) => {
    const primary = project.folders[0]
    const normNewFolders = new Set(
      project.folders.map((f) => normalizePathForMatch(f)).filter(Boolean)
    )
    persistSidebarState((prev) => {
      const remaining = prev.projects.filter(
        (existing) =>
          existing.id !== project.id &&
          !existing.folders.some((f) =>
            normNewFolders.has(normalizePathForMatch(f))
          )
      )
      return {
        ...prev,
        projects: [project, ...remaining],
        manualProjectOrder: [
          project.id,
          ...prev.manualProjectOrder.filter((x) => x !== project.id),
        ],
        hiddenProjectPaths: (prev.hiddenProjectPaths ?? []).filter(
          (p) => !normNewFolders.has(normalizePathForMatch(p))
        ),
      }
    })
    setExpandedOverrides((prev) => ({ ...prev, [project.id]: true }))
    setProjectsCollapsed(false)
    if (primary) {
      useAppStore.getState().setActiveWorkspacePath(primary)
      void ipcClient.workspace.setPath(primary)
    }
    void queryClient.invalidateQueries({ queryKey: ["changes"] })
    void queryClient.invalidateQueries({ queryKey: ["inspector"] })
    void queryClient.invalidateQueries({ queryKey: ["plugins"] })
    void queryClient.invalidateQueries({ queryKey: ["sessions"] })
    toast(`Created project ${project.name}`)
  }

  const handleToggleProjectPin = (proj: MergedProject) => {
    const nextPinned = !proj.pinned
    ensureProjectInState(proj, (m) => ({
      ...m,
      pinned: nextPinned,
      updatedAt: Date.now(),
    }))
    toast(nextPinned ? `Pinned ${proj.name}` : `Unpinned ${proj.name}`)
  }

  const handleAssignProjectSection = (
    proj: MergedProject,
    sectionId: string | null
  ) => {
    ensureProjectInState(proj, (m) => ({
      ...m,
      sectionId,
      updatedAt: Date.now(),
    }))
    const sectionName =
      sidebarState.sections.find((s) => s.id === sectionId)?.name ?? "Projects"
    toast(`Moved ${proj.name} to ${sectionName}`)
  }

  const handleMoveProjectManual = (projId: string, delta: -1 | 1) => {
    const ids = mergedProjects.map((p) => p.id)
    const idx = ids.indexOf(projId)
    const nextIdx = idx + delta
    if (idx < 0 || nextIdx < 0 || nextIdx >= ids.length) return
    const swapped = [...ids]
    ;[swapped[idx], swapped[nextIdx]] = [swapped[nextIdx], swapped[idx]]
    persistSidebarState((prev) => ({
      ...prev,
      sortBy: "manual",
      manualProjectOrder: swapped,
    }))
  }

  const handleRevealInFinder = (proj: MergedProject) => {
    const target = proj.folders[0]
    if (!target) {
      toast.error(`No folder configured for ${proj.name}`)
      return
    }
    void ipcClient.native.revealInFinder(target)
    toast(`Revealed ${shortenDisplayPath(target)} in Finder`)
  }

  const handleArchiveProjectChats = (proj: MergedProject) => {
    const ids = proj.sessions.map((s) => s.id)
    if (ids.length === 0) {
      toast(`No active chats to archive in ${proj.name}`)
      return
    }
    if (activeSessionId && ids.includes(activeSessionId)) {
      setActiveSession(null)
      setActiveRoute("home")
    }
    persistSidebarState((prev) => ({
      ...prev,
      archivedChatIds: Array.from(new Set([...prev.archivedChatIds, ...ids])),
    }))
    void Promise.all(ids.map((id) => ipcClient.sessions.archive(id))).then(() =>
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
    )
    toast(
      `Archived ${ids.length} chat${ids.length === 1 ? "" : "s"} in ${proj.name}`,
      {
        action: {
          label: "Undo",
          onClick: () => {
            persistSidebarState((prev) => ({
              ...prev,
              archivedChatIds: prev.archivedChatIds.filter(
                (id) => !ids.includes(id)
              ),
            }))
            void Promise.all(
              ids.map((id) => ipcClient.sessions.restore(id))
            ).then(() =>
              queryClient.invalidateQueries({ queryKey: ["sessions"] })
            )
          },
        },
      }
    )
  }

  const handleRemoveProject = (projectId: string) => {
    const target = mergedProjects.find((p) => p.id === projectId)
    const removedFolders = target?.folders ?? []
    persistSidebarState((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== projectId),
      manualProjectOrder: prev.manualProjectOrder.filter(
        (id) => id !== projectId
      ),
      collapsedProjectIds: (prev.collapsedProjectIds ?? []).filter(
        (id) => id !== projectId
      ),
      hiddenProjectPaths: Array.from(
        new Set([...(prev.hiddenProjectPaths ?? []), ...removedFolders])
      ),
    }))
    setHoverCard(null)
    toast(`Removed ${target?.name ?? "project"} from sidebar`)
  }

  const handleSaveEditedProject = (updated: SidebarProjectMeta) => {
    persistSidebarState((prev) => {
      const exists = prev.projects.some((p) => p.id === updated.id)
      return {
        ...prev,
        projects: exists
          ? prev.projects.map((p) => (p.id === updated.id ? updated : p))
          : [updated, ...prev.projects],
      }
    })
    toast(`Saved ${updated.name}`)
  }

  const handleStartNewChatInProject = async (proj: MergedProject) => {
    const targetPath = proj.folders[0]
    if (targetPath) {
      useAppStore.getState().setActiveWorkspacePath(targetPath)
      await ipcClient.workspace.setPath(targetPath)
      void queryClient.invalidateQueries({ queryKey: ["changes"] })
      void queryClient.invalidateQueries({ queryKey: ["inspector"] })
      void queryClient.invalidateQueries({ queryKey: ["plugins"] })
      void queryClient.invalidateQueries({ queryKey: ["workspace", "files"] })
    }
    openNewChatDraft({
      workingDir: targetPath ?? null,
      workspaceId: proj.id,
    })
    toast(`New chat in ${proj.name}`)
  }

  const handleOpenChat = (
    chat: ChatListItem,
    parentProj: MergedProject | null
  ) => {
    const targetDir = chat.workingDir ?? parentProj?.folders[0]
    if (
      targetDir &&
      normalizePathForMatch(targetDir) !==
        normalizePathForMatch(activeWorkspacePath)
    ) {
      useAppStore.getState().setActiveWorkspacePath(targetDir)
      void ipcClient.workspace.setPath(targetDir).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["changes"] })
        void queryClient.invalidateQueries({ queryKey: ["inspector"] })
        void queryClient.invalidateQueries({ queryKey: ["plugins"] })
        void queryClient.invalidateQueries({ queryKey: ["workspace", "files"] })
      })
    }
    onOpenSession(chat.id, chat.route, chat.title)
  }

  const handleTogglePinChat = (chat: ChatListItem) => {
    const pinned = pinnedChatSet.has(chat.id)
    persistSidebarState((prev) => ({
      ...prev,
      pinnedChatIds: pinned
        ? prev.pinnedChatIds.filter((id) => id !== chat.id)
        : [chat.id, ...prev.pinnedChatIds],
    }))
    toast(pinned ? `Unpinned "${chat.title}"` : `Pinned "${chat.title}"`)
  }

  const handleArchiveChat = (chat: ChatListItem) => {
    if (activeSessionId === chat.id) {
      setActiveSession(null)
      setActiveRoute("home")
    }
    persistSidebarState((prev) => ({
      ...prev,
      archivedChatIds: Array.from(new Set([...prev.archivedChatIds, chat.id])),
    }))
    setHoverCard(null)
    void ipcClient.sessions.archive(chat.id).then(() =>
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
    )
    toast(`Archived "${chat.title}"`, {
      action: {
        label: "Undo",
        onClick: () => {
          persistSidebarState((prev) => ({
            ...prev,
            archivedChatIds: prev.archivedChatIds.filter(
              (id) => id !== chat.id
            ),
          }))
          void ipcClient.sessions.restore(chat.id).then(() =>
            queryClient.invalidateQueries({ queryKey: ["sessions"] })
          )
        },
      },
    })
  }

  const handleCommitRenameChat = async (chat: ChatListItem) => {
    const clean = renamingTitle.trim()
    setRenamingChatId(null)
    setRenamingTitle("")
    if (!clean || clean === chat.title) return
    await ipcClient.sessions.rename(chat.id, clean)
    if (activeSessionId === chat.id) {
      setActiveSessionTitle(clean)
    }
    void queryClient.invalidateQueries({ queryKey: ["sessions"] })
    toast(`Renamed chat to "${clean}"`)
  }

  const handleCreateSection = (event: React.FormEvent) => {
    event.preventDefault()
    const clean = newSectionName.trim()
    if (!clean) {
      setCreatingSection(false)
      return
    }
    const section: SidebarSectionItem = {
      id: `sec_${Date.now().toString(36)}`,
      name: clean,
      collapsed: false,
    }
    persistSidebarState((prev) => ({
      ...prev,
      sections: [...prev.sections, section],
    }))
    setNewSectionName("")
    setCreatingSection(false)
    toast(`Created section "${clean}"`)
  }

  const handleToggleSectionCollapsed = (sectionId: string) => {
    persistSidebarState((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s
      ),
    }))
  }

  const renderChatRow = (chat: ChatListItem, indented: boolean) => {
    const isActive = activeRoute === "workspace" && activeSessionId === chat.id
    const isPinned = pinnedChatSet.has(chat.id)
    const isRenaming = renamingChatId === chat.id
    const parentProj = chat.projectId
      ? (projectById.get(chat.projectId) ?? null)
      : null

    if (isRenaming) {
      return (
        <form
          key={chat.id}
          onSubmit={(e) => {
            e.preventDefault()
            void handleCommitRenameChat(chat)
          }}
          className="flex w-full items-center gap-1 rounded-[9px] bg-inset px-2 py-1"
        >
          <input
            type="text"
            autoFocus
            aria-label={`Rename chat ${chat.title}`}
            value={renamingTitle}
            onChange={(e) => setRenamingTitle(e.target.value)}
            onBlur={() => void handleCommitRenameChat(chat)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setRenamingChatId(null)
                setRenamingTitle("")
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] leading-[1.38] text-ink outline-none"
          />
        </form>
      )
    }

    return (
      <div
        key={chat.id}
        data-testid="sidebar-chat-row"
        data-chat-id={chat.id}
        onMouseEnter={(e) => {
          if (
            !useAppStore.getState().isStreamActive &&
            chat.id !== activeSessionId &&
            !chat.id.startsWith("ses_") &&
            !queryClient.getQueryData(traceKeys.turns(chat.id))
          ) {
            void prefetchTraceTurns(queryClient, chat.id)
          }
          const rect = e.currentTarget.getBoundingClientRect()
          showHoverCard({
            kind: "chat",
            chat,
            project: parentProj,
            top: Math.max(12, Math.min(rect.top - 4, window.innerHeight - 110)),
            left: rect.right + 10,
          })
        }}
        onMouseLeave={scheduleHideHoverCard}
        className={cn(
          "group relative flex w-full items-center gap-1 rounded-[9px] pr-1 transition-colors",
          indented ? "pl-2.5" : "pl-2.5",
          isActive
            ? "bg-active text-ink"
            : "text-body hover:bg-hover hover:text-ink"
        )}
      >
        <button
          type="button"
          onClick={() => handleOpenChat(chat, parentProj)}
          className={cn(
            "min-w-0 flex-1 cursor-pointer truncate py-[6px] text-left text-[13.5px] leading-[1.38]",
            isActive && "font-medium"
          )}
        >
          {chat.title}
        </button>

        {isPinned ? (
          <Pin
            className="size-3 shrink-0 text-muted-ink group-hover:hidden"
            aria-hidden="true"
          />
        ) : null}

        <div className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex">
          <button
            type="button"
            aria-label={`Rename chat ${chat.title}`}
            data-testid={`chat-rename-btn-${chat.id}`}
            onClick={(e) => {
              e.stopPropagation()
              setHoverCard(null)
              setRenamingChatId(chat.id)
              setRenamingTitle(chat.title)
            }}
            className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-active hover:text-ink"
          >
            <Pencil className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={
              isPinned ? `Unpin chat ${chat.title}` : `Pin chat ${chat.title}`
            }
            data-testid={`chat-pin-btn-${chat.id}`}
            onClick={(e) => {
              e.stopPropagation()
              handleTogglePinChat(chat)
            }}
            className={cn(
              "grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-active hover:text-ink",
              isPinned && "text-brand-text"
            )}
          >
            <Pin className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Archive chat ${chat.title}`}
            data-testid={`chat-archive-btn-${chat.id}`}
            onClick={(e) => {
              e.stopPropagation()
              handleArchiveChat(chat)
            }}
            className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-active hover:text-ink"
          >
            <Archive
              className="size-3.5"
              strokeWidth={1.65}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    )
  }

  const renderProjectBlock = (proj: MergedProject) => {
    const showAll = Boolean(expandedChatLists[proj.id] || normalizedSearch)
    const visibleSessions = showAll
      ? proj.sessions
      : proj.sessions.slice(0, DEFAULT_VISIBLE_PROJECT_CHATS)
    const hiddenCount = proj.sessions.length - visibleSessions.length

    return (
      <div key={proj.id} className="mb-0.5" data-testid="sidebar-project-group">
        <div
          data-testid="sidebar-project-row"
          data-project-id={proj.id}
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            showHoverCard({
              kind: "project",
              project: proj,
              top: Math.max(12, Math.min(rect.top - 4, window.innerHeight - 210)),
              left: rect.right + 10,
            })
          }}
          onMouseLeave={scheduleHideHoverCard}
          className="group flex w-full items-center gap-1 rounded-[8px] pr-1 text-body transition-colors hover:bg-hover hover:text-ink"
        >
          <button
            type="button"
            aria-expanded={proj.expanded}
            onClick={() => handleToggleProjectExpanded(proj)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-[6px] pl-2.5 text-left text-[13.5px] leading-[1.38]"
          >
            <ProjectIconGlyph
              iconKind={proj.iconKind}
              iconValue={proj.iconValue}
              iconColor={proj.iconColor}
              expanded={proj.expanded}
            />
            <span className="truncate font-normal">{proj.name}</span>
            {proj.pinned ? (
              <Pin
                className="ml-0.5 size-3 shrink-0 text-muted-ink group-hover:hidden"
                aria-hidden="true"
              />
            ) : null}
          </button>

          {/* Hover Mini Actions: ... Overflow Menu + New Chat in Project */}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <DropdownMenu onOpenChange={handleMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Project options for ${proj.name}`}
                  data-testid={`project-menu-trigger-${proj.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-active hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
                >
                  <MoreHorizontal className="size-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                sideOffset={8}
                className="w-[208px] rounded-xl"
              >
                <DropdownMenuItem
                  data-testid="project-menu-pin"
                  onClick={() => handleToggleProjectPin(proj)}
                >
                  <Pin className="size-3.5" aria-hidden="true" />
                  <span>{proj.pinned ? "Unpin" : "Pin"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="project-menu-edit"
                  onClick={() => setEditingProject(proj)}
                >
                  <Settings className="size-3.5" aria-hidden="true" />
                  <span>Edit</span>
                </DropdownMenuItem>

                {sidebarState.sortBy === "manual" ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleMoveProjectManual(proj.id, -1)}
                    >
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                      <span>Move up</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleMoveProjectManual(proj.id, 1)}
                    >
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                      <span>Move down</span>
                    </DropdownMenuItem>
                  </>
                ) : null}

                <DropdownMenuSeparator />

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <List className="size-3.5" aria-hidden="true" />
                    <span>Section</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-[180px] rounded-xl">
                    <DropdownMenuItem
                      onClick={() => handleAssignProjectSection(proj, null)}
                    >
                      <span>Projects (Default)</span>
                      {!proj.sectionId ? (
                        <Check className="ml-auto size-3.5" aria-hidden="true" />
                      ) : null}
                    </DropdownMenuItem>
                    {sidebarState.sections.map((sec) => (
                      <DropdownMenuItem
                        key={sec.id}
                        onClick={() => handleAssignProjectSection(proj, sec.id)}
                      >
                        <span className="truncate">{sec.name}</span>
                        {proj.sectionId === sec.id ? (
                          <Check
                            className="ml-auto size-3.5"
                            aria-hidden="true"
                          />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setCreatingSection(true)}>
                      <Plus className="size-3.5" aria-hidden="true" />
                      <span>New section</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuItem
                  data-testid="project-menu-reveal"
                  onClick={() => handleRevealInFinder(proj)}
                >
                  <Folder className="size-3.5" aria-hidden="true" />
                  <span>Reveal in Finder</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  data-testid="project-menu-archive"
                  onClick={() => handleArchiveProjectChats(proj)}
                >
                  <Archive className="size-3.5" aria-hidden="true" />
                  <span>Archive chats</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  variant="destructive"
                  data-testid="project-menu-remove"
                  onClick={() => handleRemoveProject(proj.id)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                  <span>Remove project</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              aria-label={`New chat in ${proj.name}`}
              data-testid={`project-new-chat-${proj.id}`}
              onClick={(e) => {
                e.stopPropagation()
                void handleStartNewChatInProject(proj)
              }}
              className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-active hover:text-ink"
            >
              <SquarePen className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
            </button>
          </div>
        </div>

        {proj.expanded ? (
          proj.sessions.length > 0 || proj.hasDraft ? (
            <div className="mt-0.5 flex flex-col gap-px pl-[18px]">
              {proj.hasDraft ? (
                <button
                  type="button"
                  data-testid="sidebar-draft-row"
                  onClick={() =>
                    openNewChatDraft({
                      workingDir: proj.folders[0] ?? null,
                      workspaceId: proj.id,
                    })
                  }
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-1.5 rounded-[9px] px-2.5 py-[6px] text-left text-[13.5px] leading-[1.38] italic transition-colors",
                    activeRoute === "home" && !activeSessionId
                      ? "bg-active font-medium text-ink"
                      : "text-muted-ink hover:bg-hover hover:text-ink"
                  )}
                >
                  <span className="truncate">New chat</span>
                </button>
              ) : null}
              {visibleSessions.map((chat) => renderChatRow(chat, true))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedChatLists((prev) => ({
                      ...prev,
                      [proj.id]: true,
                    }))
                  }
                  className="cursor-pointer rounded-[8px] py-1 pl-2.5 text-left text-[12.5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  Show {hiddenCount} more
                </button>
              ) : expandedChatLists[proj.id] &&
                proj.sessions.length > DEFAULT_VISIBLE_PROJECT_CHATS &&
                !normalizedSearch ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedChatLists((prev) => ({
                      ...prev,
                      [proj.id]: false,
                    }))
                  }
                  className="cursor-pointer rounded-[8px] py-1 pl-2.5 text-left text-[12.5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  Show less
                </button>
              ) : null}
            </div>
          ) : (
            <div className="py-1 pl-[30px] text-[13px] text-faint">No chats</div>
          )
        ) : null}
      </div>
    )
  }

  const unsectionedProjects = filteredProjects.filter(
    (p) =>
      !p.sectionId || !sidebarState.sections.some((s) => s.id === p.sectionId)
  )

  const organizeMenu = (
    <DropdownMenu onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Organize sidebar"
          data-testid="sidebar-organize-trigger"
          className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
        >
          <SlidersHorizontal
            className="size-3.5"
            strokeWidth={1.65}
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        data-testid="sidebar-organize-menu"
        className="w-[216px] rounded-xl"
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="organize-submenu-trigger">
            <PanelLeft className="size-3.5" aria-hidden="true" />
            <span>Organize sidebar</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[186px] rounded-xl">
            <DropdownMenuItem
              data-testid="organize-by-project"
              onClick={() =>
                persistSidebarState((prev) => ({
                  ...prev,
                  organizeBy: "project",
                }))
              }
            >
              <Folder className="size-3.5" aria-hidden="true" />
              <span>By project</span>
              {sidebarState.organizeBy === "project" ? (
                <Check className="ml-auto size-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="organize-by-connection"
              onClick={() =>
                persistSidebarState((prev) => ({
                  ...prev,
                  organizeBy: "connection",
                }))
              }
            >
              <Monitor className="size-3.5" aria-hidden="true" />
              <span>By connection</span>
              {sidebarState.organizeBy === "connection" ? (
                <Check className="ml-auto size-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="organize-in-one-list"
              onClick={() =>
                persistSidebarState((prev) => ({
                  ...prev,
                  organizeBy: "flat",
                }))
              }
            >
              <List className="size-3.5" aria-hidden="true" />
              <span>In one list</span>
              {sidebarState.organizeBy === "flat" ? (
                <Check className="ml-auto size-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="sort-submenu-trigger">
            <ArrowUpDown className="size-3.5" aria-hidden="true" />
            <span>Sort chats by</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[180px] rounded-xl">
            <DropdownMenuItem
              data-testid="sort-by-updated"
              onClick={() =>
                persistSidebarState((prev) => ({
                  ...prev,
                  sortBy: "updated",
                }))
              }
            >
              <Calendar className="size-3.5" aria-hidden="true" />
              <span>Last updated</span>
              {sidebarState.sortBy === "updated" ? (
                <Check className="ml-auto size-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="sort-by-manual"
              onClick={() =>
                persistSidebarState((prev) => ({
                  ...prev,
                  sortBy: "manual",
                }))
              }
            >
              <GripVertical className="size-3.5" aria-hidden="true" />
              <span>Manual order</span>
              {sidebarState.sortBy === "manual" ? (
                <Check className="ml-auto size-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="show-submenu-trigger">
            <Eye className="size-3.5" aria-hidden="true" />
            <span>Show</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[180px] rounded-xl">
            <DropdownMenuItem
              data-testid="show-project-chats-toggle"
              onClick={() =>
                persistSidebarState((prev) => ({
                  ...prev,
                  showProjectChatsInRecents: !prev.showProjectChatsInRecents,
                }))
              }
            >
              <span>Project chats</span>
              {sidebarState.showProjectChatsInRecents ? (
                <Check className="ml-auto size-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-testid="sidebar-new-section-btn"
          onClick={() => setCreatingSection(true)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span>New section</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* Projects Section (shown in "By project" mode) */}
        {sidebarState.organizeBy === "project" ? (
          <>
            <div className="flex items-center justify-between px-2.5 pt-3 pb-1 text-[12.5px] font-medium text-muted-ink">
              <button
                type="button"
                onClick={() => setProjectsCollapsed((c) => !c)}
                className="inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-ink"
              >
                <span>Projects</span>
                {projectsCollapsed ? (
                  <ChevronRight className="size-3" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3" aria-hidden="true" />
                )}
              </button>
              <div className="flex items-center gap-0.5">
                {organizeMenu}
                <button
                  type="button"
                  aria-label="Create project"
                  data-testid="sidebar-create-project-btn"
                  onClick={() => setCreatingProject(true)}
                  className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <Plus className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
                </button>
              </div>
            </div>

            {!projectsCollapsed ? (
              <>
                {unsectionedProjects.map(renderProjectBlock)}

                {/* Custom user sections */}
                {sidebarState.sections.map((section) => {
                  const sectionProjects = filteredProjects.filter(
                    (p) => p.sectionId === section.id
                  )
                  return (
                    <div
                      key={section.id}
                      data-testid="sidebar-custom-section"
                      className="mt-2"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleSectionCollapsed(section.id)}
                        className="flex w-full cursor-pointer items-center gap-1 px-2.5 py-1 text-[12.5px] font-medium text-muted-ink transition-colors hover:text-ink"
                      >
                        {section.collapsed ? (
                          <ChevronRight className="size-3" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-3" aria-hidden="true" />
                        )}
                        <span className="truncate">{section.name}</span>
                      </button>
                      {!section.collapsed ? (
                        sectionProjects.length > 0 ? (
                          sectionProjects.map(renderProjectBlock)
                        ) : (
                          <div className="px-3 py-1 text-[12.5px] text-faint">
                            Use project ··· → Section to move here
                          </div>
                        )
                      ) : null}
                    </div>
                  )
                })}
              </>
            ) : null}
          </>
        ) : null}

        {/* Inline New Section Creator */}
        {creatingSection ? (
          <form
            onSubmit={handleCreateSection}
            data-testid="new-section-form"
            className="mx-2 mt-2 flex items-center gap-1 rounded-lg border border-hairline-hi bg-inset px-2 py-1"
          >
            <input
              type="text"
              autoFocus
              aria-label="New section name"
              data-testid="new-section-input"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Section name..."
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted-ink"
            />
            <button
              type="submit"
              className="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-brand-text hover:bg-hover"
            >
              Add
            </button>
            <button
              type="button"
              aria-label="Cancel new section"
              onClick={() => {
                setCreatingSection(false)
                setNewSectionName("")
              }}
              className="cursor-pointer rounded p-0.5 text-muted-ink hover:text-ink"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </form>
        ) : null}

        {/* Recents Header + Organize/Sort/Show/+ New Section Popover + New Chat */}
        <div className="flex items-center justify-between px-2.5 pt-3 pb-1 text-[12.5px] font-medium text-muted-ink">
          <span>
            {sidebarState.organizeBy === "connection"
              ? "By connection"
              : sidebarState.organizeBy === "flat"
                ? "All chats"
                : "Recents"}
          </span>

          <div className="flex items-center gap-0.5">
            {sidebarState.organizeBy !== "project" ? organizeMenu : null}

            <button
              type="button"
              aria-label="New recent conversation"
              onClick={() => {
                openNewChatDraft({ workingDir: null, workspaceId: null })
              }}
              className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <SquarePen
                className="size-3.5"
                strokeWidth={1.65}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        {/* Chats list according to active organizeBy mode */}
        {sidebarState.organizeBy === "connection" ? (
          <div
            className="flex flex-col gap-2"
            data-testid="connection-grouped-list"
          >
            <div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[12.5px] font-medium text-muted-ink">
                <Laptop className="size-3.5" aria-hidden="true" />
                <span>Local daemon</span>
              </div>
              {allFlatChats
                .filter((c) => c.connection === "local")
                .map((c) => renderChatRow(c, false))}
            </div>
            <div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[12.5px] font-medium text-muted-ink">
                <Cloud className="size-3.5" aria-hidden="true" />
                <span>Rayu Cloud</span>
              </div>
              {allFlatChats
                .filter((c) => c.connection === "cloud")
                .map((c) => renderChatRow(c, false))}
            </div>
          </div>
        ) : sidebarState.organizeBy === "flat" ? (
          <div className="flex flex-col gap-0.5" data-testid="flat-chat-list">
            {allFlatChats.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[13px] text-faint">
                No conversations yet
              </div>
            ) : (
              allFlatChats.map((c) => renderChatRow(c, false))
            )}
          </div>
        ) : filteredRecentChats.length === 0 && !ungroupedHasDraft ? (
          <div className="px-2.5 py-1.5 text-[13px] text-faint">
            No conversations yet
          </div>
        ) : (
          <div className="flex flex-col gap-px" data-testid="ungrouped-chat-list">
            {ungroupedHasDraft ? (
              <button
                type="button"
                data-testid="sidebar-draft-row"
                onClick={() =>
                  openNewChatDraft({ workingDir: null, workspaceId: null })
                }
                className={cn(
                  "flex w-full cursor-pointer items-center gap-1.5 rounded-[9px] px-2.5 py-[6px] text-left text-[13.5px] leading-[1.38] italic transition-colors",
                  activeRoute === "home" && !activeSessionId
                    ? "bg-active font-medium text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <span className="truncate">New chat</span>
              </button>
            ) : null}
            {filteredRecentChats.map((c) => renderChatRow(c, false))}
          </div>
        )}
      </div>

      {/* Floating Mini Hover Card (Project or Chat) */}
      {hoverCard && menuOpenCount === 0 ? (
        <div
          data-testid={
            hoverCard.kind === "project"
              ? "project-hover-card"
              : "chat-hover-card"
          }
          onMouseEnter={clearHoverTimer}
          onMouseLeave={scheduleHideHoverCard}
          style={{ top: `${hoverCard.top}px`, left: `${hoverCard.left}px` }}
          className="fixed z-50 w-[268px] rounded-2xl border border-premium-hi bg-popover p-1.5 text-ink shadow-bevel-card shadow-rayu-2"
        >
          {hoverCard.kind === "project" ? (
            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-ink">
                  <ProjectIconGlyph
                    iconKind={hoverCard.project.iconKind}
                    iconValue={hoverCard.project.iconValue}
                    iconColor={hoverCard.project.iconColor}
                    expanded={hoverCard.project.expanded}
                  />
                  <span className="truncate">{hoverCard.project.name}</span>
                </div>
                <button
                  type="button"
                  aria-label={
                    hoverCard.project.pinned ? "Unpin project" : "Pin project"
                  }
                  data-testid="hover-card-pin-project"
                  onClick={() => handleToggleProjectPin(hoverCard.project)}
                  className={cn(
                    "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink",
                    hoverCard.project.pinned && "text-brand-text"
                  )}
                >
                  <Pin className="size-3.5" aria-hidden="true" />
                </button>
              </div>

              <div className="flex items-center gap-2 px-2.5 pb-2 text-xs text-muted-ink">
                <MessageCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {hoverCard.project.sessions.length} chat
                  {hoverCard.project.sessions.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mx-1.5 h-px bg-hairline-soft" />

              <div className="flex flex-col gap-1.5 px-2.5 py-2 text-xs text-body">
                {hoverCard.project.gitRemote ? (
                  <div className="flex items-center gap-2 truncate">
                    <GitBranch
                      className="size-3.5 shrink-0 text-muted-ink"
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono text-[12px]">
                      {hoverCard.project.gitRemote}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 truncate">
                  <Folder
                    className="size-3.5 shrink-0 text-muted-ink"
                    aria-hidden="true"
                  />
                  <span className="truncate font-mono text-[12px]">
                    {shortenDisplayPath(
                      hoverCard.project.folders[0] ?? "~/workspace"
                    )}
                  </span>
                </div>
              </div>

              <div className="mx-1.5 h-px bg-hairline-soft" />

              <button
                type="button"
                data-testid="hover-card-edit-project"
                onClick={() => {
                  setEditingProject(hoverCard.project)
                  setHoverCard(null)
                }}
                className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-body transition-colors hover:bg-hover hover:text-ink"
              >
                <Settings
                  className="size-3.5 shrink-0 text-muted-ink"
                  aria-hidden="true"
                />
                <span>Edit project</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium text-ink">
                  <span className="line-clamp-2">{hoverCard.chat.title}</span>
                  <span
                    data-connection={hoverCard.chat.connection}
                    className="inline-flex shrink-0 items-center"
                  >
                    {hoverCard.chat.connection === "local" ? (
                      <Laptop
                        className="size-3.5 text-muted-ink"
                        aria-hidden="true"
                      />
                    ) : (
                      <Cloud
                        className="size-3.5 text-muted-ink"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[11.5px] text-muted-ink">
                  {hoverCard.chat.relativeTime}
                </span>
              </div>
              {hoverCard.project ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-ink">
                  <ProjectIconGlyph
                    iconKind={hoverCard.project.iconKind}
                    iconValue={hoverCard.project.iconValue}
                    iconColor={hoverCard.project.iconColor}
                    className="size-3.5 text-[12px]"
                  />
                  <span className="truncate">{hoverCard.project.name}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={creatingProject}
        onOpenChange={setCreatingProject}
        onCreate={handleCreateProject}
      />

      {/* Edit Project Dialog */}
      <EditProjectDialog
        project={editingProject}
        open={editingProject !== null}
        onOpenChange={(open) => {
          if (!open) setEditingProject(null)
        }}
        onSave={handleSaveEditedProject}
        onRemove={handleRemoveProject}
      />
    </>
  )
}
