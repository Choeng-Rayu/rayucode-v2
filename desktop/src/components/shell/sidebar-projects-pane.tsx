import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import { useAppStore } from "@/lib/app-store"
import {
  ipcClient,
  type ProjectGroup,
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
  connection: "local" | "cloud"
  relativeTime: string
}

interface MergedProject extends SidebarProjectMeta {
  expanded: boolean
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

const EMPTY_SIDEBAR_STATE: SidebarState = {
  projects: [],
  sections: [],
  pinnedChatIds: [],
  archivedChatIds: [],
  organizeBy: "project",
  sortBy: "updated",
  showProjectChatsInRecents: true,
  manualProjectOrder: [],
}

function shortenDisplayPath(rawPath: string): string {
  return rawPath.replace(/^\/Users\/[^/]+/, "~")
}

export interface SidebarProjectsPaneProps {
  onOpenSession: (sessionId: string, route?: string, title?: string) => void
}

export function SidebarProjectsPane({
  onOpenSession,
}: SidebarProjectsPaneProps) {
  const queryClient = useQueryClient()
  const activeRoute = useAppStore((s) => s.activeRoute)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const daemonMode = useAppStore((s) => s.daemonMode)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)

  const [baseProjects, setBaseProjects] = React.useState<ProjectGroup[]>([])
  const [baseRecents, setBaseRecents] = React.useState<
    Array<{ id: string; title: string; route?: string }>
  >([])
  const [sidebarState, setSidebarState] =
    React.useState<SidebarState>(EMPTY_SIDEBAR_STATE)
  const [expandedMap, setExpandedMap] = React.useState<Record<string, boolean>>(
    {}
  )
  const [projectsCollapsed, setProjectsCollapsed] = React.useState(false)
  const [editingProject, setEditingProject] =
    React.useState<SidebarProjectMeta | null>(null)
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [creatingSection, setCreatingSection] = React.useState(false)
  const [newSectionName, setNewSectionName] = React.useState("")
  const [hoverCard, setHoverCard] = React.useState<ActiveHoverCard | null>(null)
  const [menuOpenCount, setMenuOpenCount] = React.useState(0)

  const hoverTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void Promise.all([
      ipcClient.sessions.listProjects(),
      ipcClient.sessions.listRecents(),
      ipcClient.sidebar.getState(),
    ]).then(([projList, recentList, savedState]) => {
      if (cancelled) return
      setBaseProjects(projList)
      setBaseRecents(recentList)
      setSidebarState(savedState)
      setExpandedMap((prev) => {
        const next = { ...prev }
        for (const p of projList) {
          if (next[p.id] === undefined) {
            next[p.id] = p.expanded
          }
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [activeSessionId, daemonMode])

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

  const archivedSet = React.useMemo(
    () => new Set(sidebarState.archivedChatIds),
    [sidebarState.archivedChatIds]
  )
  const pinnedChatSet = React.useMemo(
    () => new Set(sidebarState.pinnedChatIds),
    [sidebarState.pinnedChatIds]
  )

  // Merge live/mock baseProjects with persisted metadata (icon/emoji/rename/pin/sections/extra projects)
  const mergedProjects = React.useMemo<MergedProject[]>(() => {
    const savedById = new Map(sidebarState.projects.map((p) => [p.id, p]))
    const result: MergedProject[] = []
    const seen = new Set<string>()

    const makeChatItems = (
      projId: string,
      projName: string,
      rawSessions: Array<{ id: string; title: string; route?: string }>
    ): ChatListItem[] => {
      const items = rawSessions
        .filter((s) => !archivedSet.has(s.id))
        .map((s, idx) => ({
          id: s.id,
          title: s.title,
          route: s.route,
          projectId: projId,
          projectName: projName,
          connection:
            daemonMode === "live" && !s.id.startsWith("ses_")
              ? ("local" as const)
              : idx % 2 === 0
                ? ("local" as const)
                : ("cloud" as const),
          relativeTime: idx === 0 ? "Now" : `${idx + 1}h`,
        }))
      items.sort((a, b) => {
        const aPin = pinnedChatSet.has(a.id) ? 1 : 0
        const bPin = pinnedChatSet.has(b.id) ? 1 : 0
        return bPin - aPin
      })
      return items
    }

    // Persisted projects first (preserving user-added projects)
    for (const saved of sidebarState.projects) {
      const base = baseProjects.find((bp) => bp.id === saved.id)
      seen.add(saved.id)
      result.push({
        ...saved,
        expanded: expandedMap[saved.id] ?? base?.expanded ?? true,
        sessions: makeChatItems(saved.id, saved.name, base?.sessions ?? []),
      })
    }

    // Any discovered workspace projects not yet in saved state
    for (const bp of baseProjects) {
      if (seen.has(bp.id)) continue
      const saved = savedById.get(bp.id)
      const meta: SidebarProjectMeta = saved ?? {
        id: bp.id,
        name: bp.name,
        folders: [bp.path],
        iconKind: "icon",
        iconValue: "folder",
        iconColor: "folder",
        pinned: false,
        sectionId: null,
        updatedAt: 0,
      }
      result.push({
        ...meta,
        expanded: expandedMap[bp.id] ?? bp.expanded,
        sessions: makeChatItems(meta.id, meta.name, bp.sessions),
      })
    }

    // Sort: pinned projects first, then manual order or updatedAt
    const orderIdx = new Map(
      sidebarState.manualProjectOrder.map((id, i) => [id, i])
    )
    result.sort((a, b) => {
      const aPin = a.pinned ? 1 : 0
      const bPin = b.pinned ? 1 : 0
      if (aPin !== bPin) return bPin - aPin
      if (sidebarState.sortBy === "manual") {
        const ai = orderIdx.get(a.id) ?? 999
        const bi = orderIdx.get(b.id) ?? 999
        return ai - bi
      }
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })

    return result
  }, [
    archivedSet,
    baseProjects,
    daemonMode,
    expandedMap,
    pinnedChatSet,
    sidebarState.manualProjectOrder,
    sidebarState.projects,
    sidebarState.sortBy,
  ])

  const projectById = React.useMemo(
    () => new Map(mergedProjects.map((p) => [p.id, p])),
    [mergedProjects]
  )

  const projectChatIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const p of mergedProjects) {
      for (const s of p.sessions) ids.add(s.id)
    }
    return ids
  }, [mergedProjects])

  const showProjectChatsInRecents = sidebarState.showProjectChatsInRecents

  const recentChats = React.useMemo<ChatListItem[]>(() => {
    const projectForChat = new Map<string, MergedProject>()
    for (const p of mergedProjects) {
      for (const s of p.sessions) {
        projectForChat.set(s.id, p)
      }
    }

    const items: ChatListItem[] = baseRecents
      .filter((r) => !archivedSet.has(r.id))
      .filter((r) => showProjectChatsInRecents || !projectChatIds.has(r.id))
      .map((r, idx) => {
        const parent = projectForChat.get(r.id)
        return {
          id: r.id,
          title: r.title,
          route: r.route,
          projectId: parent?.id,
          projectName: parent?.name,
          connection: idx % 2 === 0 ? "local" : "cloud",
          relativeTime: idx === 0 ? "1h" : `${idx + 2}h`,
        }
      })

    items.sort((a, b) => {
      const aPin = pinnedChatSet.has(a.id) ? 1 : 0
      const bPin = pinnedChatSet.has(b.id) ? 1 : 0
      return bPin - aPin
    })
    return items
  }, [
    archivedSet,
    baseRecents,
    mergedProjects,
    pinnedChatSet,
    projectChatIds,
    showProjectChatsInRecents,
  ])

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

  const handleCreateProject = (project: SidebarProjectMeta) => {
    const primary = project.folders[0]
    persistSidebarState((prev) => ({
      ...prev,
      projects: [project, ...prev.projects],
      manualProjectOrder: [
        project.id,
        ...prev.manualProjectOrder.filter((x) => x !== project.id),
      ],
    }))
    setExpandedMap((prev) => ({ ...prev, [project.id]: true }))
    setProjectsCollapsed(false)
    if (primary) {
      useAppStore.getState().setActiveWorkspacePath(primary)
      void ipcClient.workspace.setPath(primary)
    }
    void queryClient.invalidateQueries({ queryKey: ["changes"] })
    void queryClient.invalidateQueries({ queryKey: ["inspector"] })
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
    const target = proj.folders[0] ?? "~/workspace/rayu/rayucode-v2"
    void ipcClient.native.revealInFinder(target)
    toast(`Revealed ${shortenDisplayPath(target)} in Finder`)
  }

  const handleArchiveProjectChats = (proj: MergedProject) => {
    const ids = proj.sessions.map((s) => s.id)
    if (ids.length === 0) {
      toast(`No active chats to archive in ${proj.name}`)
      return
    }
    persistSidebarState((prev) => ({
      ...prev,
      archivedChatIds: Array.from(new Set([...prev.archivedChatIds, ...ids])),
    }))
    toast(`Archived ${ids.length} chat${ids.length === 1 ? "" : "s"} in ${proj.name}`, {
      action: {
        label: "Undo",
        onClick: () => {
          persistSidebarState((prev) => ({
            ...prev,
            archivedChatIds: prev.archivedChatIds.filter(
              (id) => !ids.includes(id)
            ),
          }))
        },
      },
    })
  }

  const handleRemoveProject = (projectId: string) => {
    const target = mergedProjects.find((p) => p.id === projectId)
    setBaseProjects((prev) => prev.filter((p) => p.id !== projectId))
    persistSidebarState((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== projectId),
      manualProjectOrder: prev.manualProjectOrder.filter(
        (id) => id !== projectId
      ),
    }))
    setHoverCard(null)
    toast(`Removed ${target?.name ?? "project"} from sidebar`)
  }

  const handleSaveEditedProject = (updated: SidebarProjectMeta) => {
    setBaseProjects((prev) =>
      prev.map((p) =>
        p.id === updated.id
          ? { ...p, name: updated.name, path: updated.folders[0] ?? p.path }
          : p
      )
    )
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

  const handleStartNewChatInProject = (proj: MergedProject) => {
    const targetPath = proj.folders[0]
    if (targetPath) {
      useAppStore.getState().setActiveWorkspacePath(targetPath)
      void ipcClient.workspace.setPath(targetPath)
    }
    setActiveSession(null)
    setActiveRoute("home")
    toast(`New chat in ${proj.name}`)
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
    persistSidebarState((prev) => ({
      ...prev,
      archivedChatIds: Array.from(new Set([...prev.archivedChatIds, chat.id])),
    }))
    setHoverCard(null)
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
        },
      },
    })
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
    const parentProj = chat.projectId
      ? (projectById.get(chat.projectId) ?? null)
      : null

    return (
      <div
        key={chat.id}
        data-testid="sidebar-chat-row"
        data-chat-id={chat.id}
        onMouseEnter={(e) => {
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
          onClick={() => onOpenSession(chat.id, chat.route, chat.title)}
          className={cn(
            "min-w-0 flex-1 cursor-pointer truncate py-[5px] text-left text-[12.5px] leading-[1.35]",
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

  const renderProjectBlock = (proj: MergedProject) => (
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
          onClick={() =>
            setExpandedMap((prev) => ({ ...prev, [proj.id]: !proj.expanded }))
          }
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-[5px] pl-2.5 text-left text-[12.5px] leading-[1.35]"
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
              handleStartNewChatInProject(proj)
            }}
            className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-active hover:text-ink"
          >
            <SquarePen className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
          </button>
        </div>
      </div>

      {proj.expanded && proj.sessions.length > 0 ? (
        <div className="mt-0.5 flex flex-col gap-px pl-[18px]">
          {proj.sessions.map((chat) => renderChatRow(chat, true))}
        </div>
      ) : null}
    </div>
  )

  const unsectionedProjects = mergedProjects.filter(
    (p) =>
      !p.sectionId || !sidebarState.sections.some((s) => s.id === p.sectionId)
  )

  const allFlatChats = React.useMemo<ChatListItem[]>(() => {
    const map = new Map<string, ChatListItem>()
    for (const p of mergedProjects) {
      for (const s of p.sessions) map.set(s.id, s)
    }
    for (const r of recentChats) {
      if (!map.has(r.id)) map.set(r.id, r)
    }
    return Array.from(map.values())
  }, [mergedProjects, recentChats])

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
                    showProjectChatsInRecents:
                      !prev.showProjectChatsInRecents,
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
            <div className="flex items-center justify-between px-2.5 pt-3 pb-1 text-[11.5px] font-medium text-muted-ink">
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
                  const sectionProjects = mergedProjects.filter(
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
                        className="flex w-full cursor-pointer items-center gap-1 px-2.5 py-1 text-xs font-medium text-muted-ink transition-colors hover:text-ink"
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
                          <div className="px-3 py-1 text-[11.5px] text-faint">
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
              className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted-ink"
            />
            <button
              type="submit"
              className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-text hover:bg-hover"
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
        <div className="flex items-center justify-between px-2.5 pt-3 pb-1 text-[11.5px] font-medium text-muted-ink">
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
                setActiveSession(null)
                setActiveRoute("home")
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
          <div className="flex flex-col gap-2" data-testid="connection-grouped-list">
            <div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-medium text-muted-ink">
                <Laptop className="size-3" aria-hidden="true" />
                <span>Local daemon</span>
              </div>
              {allFlatChats
                .filter((c) => c.connection === "local")
                .map((c) => renderChatRow(c, false))}
            </div>
            <div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-medium text-muted-ink">
                <Cloud className="size-3" aria-hidden="true" />
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
              <div className="px-2.5 py-1.5 text-xs text-faint">
                No conversations yet
              </div>
            ) : (
              allFlatChats.map((c) => renderChatRow(c, false))
            )}
          </div>
        ) : recentChats.length === 0 ? (
          <div className="px-2.5 py-1.5 text-xs text-faint">
            No conversations yet
          </div>
        ) : (
          <div className="flex flex-col gap-px">
            {recentChats.map((c) => renderChatRow(c, false))}
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
                <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-ink">
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
                    <span className="truncate font-mono text-[11.5px]">
                      {hoverCard.project.gitRemote}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 truncate">
                  <Folder
                    className="size-3.5 shrink-0 text-muted-ink"
                    aria-hidden="true"
                  />
                  <span className="truncate font-mono text-[11.5px]">
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
                className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-body transition-colors hover:bg-hover hover:text-ink"
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
                <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
                  <span className="line-clamp-2">{hoverCard.chat.title}</span>
                  {hoverCard.chat.connection === "local" ? (
                    <Laptop
                      className="size-3.5 shrink-0 text-muted-ink"
                      aria-hidden="true"
                    />
                  ) : (
                    <Cloud
                      className="size-3.5 shrink-0 text-muted-ink"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <span className="shrink-0 font-mono text-[11px] text-muted-ink">
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
