import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  Database,
  Eye,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Laptop,
  LayoutGrid,
  Lightbulb,
  ListTodo,
  Mic,
  Minimize2,
  Monitor,
  Network,
  Paperclip,
  PawPrint,
  Pencil,
  Plug,
  Plus,
  Presentation,
  Puzzle,
  Scan,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Target,
  Timer,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { getFileColorClass } from "@/lib/file-icon-theme"
import {
  BUILTIN_PRESENTATION_TEMPLATES,
  BUILTIN_SPREADSHEET_TEMPLATES,
  buildTemplatePrompt,
  mapCustomTemplateToItem,
  type ClarifyingOption,
  type ComposerTemplateItem,
  type ComposerTemplateKind,
} from "@/lib/composer-templates"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import {
  DEFAULT_CHECKOUT,
  DEFAULT_PROJECT,
  HOME_CHECKOUTS,
  HOME_PROJECTS,
  SLASH_COMMANDS,
} from "../constants/models"
import {
  useModelCatalog,
  usePermissionModes,
  usePersistedInferenceSettings,
} from "../hooks/use-sessions"
import type {
  ComposerMode,
  ComposerSubmitPayload,
  ModelOption,
  PermissionModeId,
  ReasoningEffort,
} from "../types"
import { ClarifyingQuestionCard } from "./clarifying-question-card"
import { ModelEffortPopover } from "./model-effort-popover"
import { PermissionPopover } from "./permission-popover"
import { SketchDialog } from "./sketch-dialog"
import { TemplateCarousel, TemplateCreatorDialog } from "./template-carousel"

interface ComposerAttachment {
  id: string
  kind: "file" | "folder" | "image" | "conversation"
  name: string
  path?: string
  dataUrl?: string
  sessionId?: string
}

type SkillTokenIconId =
  | "goal"
  | "plan"
  | "swarm"
  | "review"
  | "compact"
  | "model"
  | "preview"
  | "memory"
  | "cache"
  | "telegram"
  | "spreadsheets"
  | "presentations"
  | "browser"
  | "computer"
  | "pages"
  | "sites"
  | "visualize"
  | "documents"
  | "mcp"
  | "skill"

interface ActiveSkillToken {
  id: string
  label: string
  command: string
  icon: SkillTokenIconId
  tone?: "default" | "spreadsheet" | "presentation" | "info" | "brand"
}

function resolveBuiltinSkillToken(rawCommand: string): ActiveSkillToken {
  const cleaned = rawCommand.trim().replace(/^\/+/, "")
  const base = cleaned.split(/\s+/)[0]?.toLowerCase() || "skill"
  const command = rawCommand.trim().startsWith("/")
    ? rawCommand.trim()
    : `/${cleaned}`

  switch (base) {
    case "goal":
      return { id: "goal", label: "goal", command: "/goal", icon: "goal" }
    case "plan":
      return { id: "plan", label: "plan", command: "/plan", icon: "plan" }
    case "swarm":
      return { id: "swarm", label: "swarm", command: "/swarm", icon: "swarm" }
    case "review":
      return { id: "review", label: "review", command: "/review", icon: "review" }
    case "compact":
      return {
        id: "compact",
        label: "compact",
        command: "/compact",
        icon: "compact",
      }
    case "model":
      return { id: "model", label: "model", command, icon: "model" }
    case "preview":
      return { id: "preview", label: "preview", command, icon: "preview" }
    case "memory":
      return { id: "memory", label: "memory", command, icon: "memory" }
    case "cache":
      return { id: "cache", label: "cache", command, icon: "cache" }
    case "telegram-bot":
      return {
        id: "telegram-bot",
        label: "telegram",
        command,
        icon: "telegram",
      }
    default:
      return { id: base, label: base, command, icon: "skill" }
  }
}

function PluginBadgeIcon({
  kind,
  size = "md",
}: {
  kind:
    | "spreadsheets"
    | "presentations"
    | "template-creator"
    | "browser"
    | "computer"
    | "pages"
    | "pets"
    | "plugin-management"
    | "sites"
    | "visualize"
  size?: "sm" | "md"
}) {
  const boxCls =
    size === "sm"
      ? "grid size-[18px] shrink-0 place-items-center rounded-[5px]"
      : "grid size-[20px] shrink-0 place-items-center rounded-[6px]"
  const iconCls = size === "sm" ? "size-[11px]" : "size-[12.5px]"

  switch (kind) {
    case "spreadsheets":
      return (
        <span
          className={boxCls}
          style={{
            backgroundColor: "rgba(34, 197, 94, 0.22)",
            color: "rgb(74, 222, 128)",
          }}
        >
          <FileSpreadsheet
            className={iconCls}
            strokeWidth={2}
            aria-hidden="true"
          />
        </span>
      )
    case "presentations":
      return (
        <span
          className={boxCls}
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.22)",
            color: "rgb(251, 191, 36)",
          }}
        >
          <Presentation className={iconCls} strokeWidth={2} aria-hidden="true" />
        </span>
      )
    case "template-creator":
      return (
        <span className={cn(boxCls, "bg-inset text-muted-ink")}>
          <LayoutGrid className={iconCls} strokeWidth={1.8} aria-hidden="true" />
        </span>
      )
    case "browser":
      return (
        <span
          className={boxCls}
          style={{
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            color: "rgb(96, 165, 250)",
          }}
        >
          <Globe className={iconCls} strokeWidth={1.9} aria-hidden="true" />
        </span>
      )
    case "computer":
      return (
        <span
          className={boxCls}
          style={{
            backgroundColor: "rgba(168, 85, 247, 0.2)",
            color: "rgb(192, 132, 252)",
          }}
        >
          <Laptop className={iconCls} strokeWidth={1.9} aria-hidden="true" />
        </span>
      )
    case "pages":
      return (
        <span className={cn(boxCls, "bg-inset text-muted-ink")}>
          <FileText className={iconCls} strokeWidth={1.8} aria-hidden="true" />
        </span>
      )
    case "pets":
      return (
        <span className={cn(boxCls, "bg-inset text-body")}>
          <PawPrint className={iconCls} strokeWidth={1.9} aria-hidden="true" />
        </span>
      )
    case "plugin-management":
      return (
        <span
          className={boxCls}
          style={{
            backgroundColor: "rgba(20, 184, 166, 0.22)",
            color: "rgb(45, 212, 191)",
          }}
        >
          <Puzzle className={iconCls} strokeWidth={1.9} aria-hidden="true" />
        </span>
      )
    case "sites":
      return (
        <span
          className={boxCls}
          style={{
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            color: "rgb(96, 165, 250)",
          }}
        >
          <LayoutGrid className={iconCls} strokeWidth={1.9} aria-hidden="true" />
        </span>
      )
    case "visualize":
      return (
        <span
          className={boxCls}
          style={{
            backgroundColor: "rgba(56, 189, 248, 0.22)",
            color: "rgb(125, 211, 252)",
          }}
        >
          <Sparkles className={iconCls} strokeWidth={1.9} aria-hidden="true" />
        </span>
      )
  }
}

function SkillTokenIcon({ icon }: { icon: SkillTokenIconId }) {
  const cls = "size-[15px] shrink-0 text-muted-ink"
  switch (icon) {
    case "goal":
      return <Timer className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "plan":
      return <ListTodo className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "swarm":
      return <Network className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "review":
      return <FileSearch className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "compact":
      return <Minimize2 className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "model":
      return (
        <SlidersHorizontal className={cls} strokeWidth={1.7} aria-hidden="true" />
      )
    case "preview":
      return <Eye className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "memory":
      return <Brain className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "cache":
      return <Database className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "telegram":
      return <Send className={cls} strokeWidth={1.7} aria-hidden="true" />
    case "spreadsheets":
      return <PluginBadgeIcon kind="spreadsheets" size="sm" />
    case "presentations":
      return <PluginBadgeIcon kind="presentations" size="sm" />
    case "browser":
      return <PluginBadgeIcon kind="browser" size="sm" />
    case "computer":
      return <PluginBadgeIcon kind="computer" size="sm" />
    case "pages":
      return <PluginBadgeIcon kind="pages" size="sm" />
    case "sites":
      return <PluginBadgeIcon kind="sites" size="sm" />
    case "visualize":
      return <PluginBadgeIcon kind="visualize" size="sm" />
    case "documents":
      return <FileText className="size-[15px] shrink-0 text-info" strokeWidth={1.7} aria-hidden="true" />
    case "mcp":
      return <Plug className="size-[15px] shrink-0 text-brand-text" strokeWidth={1.7} aria-hidden="true" />
    default:
      return <Sparkles className={cls} strokeWidth={1.7} aria-hidden="true" />
  }
}

export interface SessionComposerProps {
  mode?: ComposerMode
  project?: string
  checkout?: string
  onProjectChange?: (project: string) => void
  onCheckoutChange?: (checkout: string) => void
  modelId?: string
  modelLabel?: string
  effort?: ReasoningEffort
  permissionMode?: PermissionModeId
  onModelChange?: (model: ModelOption) => void
  onEffortChange?: (effort: ReasoningEffort) => void
  onPermissionModeChange?: (mode: PermissionModeId) => void
  onSubmit?: (payload: ComposerSubmitPayload) => void | Promise<void>
  onStop?: () => void
  placeholder?: string
  disabled?: boolean
  isSubmitting?: boolean
  value?: string
  onValueChange?: (value: string) => void
  inputRef?: React.Ref<HTMLTextAreaElement>
  className?: string
}

export function SessionComposer({
  mode = "home",
  project: controlledProject,
  checkout: controlledCheckout,
  onProjectChange,
  onCheckoutChange,
  modelId: controlledModelId,
  modelLabel: controlledModelLabel,
  effort: controlledEffort,
  permissionMode: controlledPermissionMode,
  onModelChange,
  onEffortChange,
  onPermissionModeChange,
  onSubmit,
  onStop,
  placeholder,
  disabled = false,
  isSubmitting = false,
  value: controlledValue,
  onValueChange,
  inputRef,
  className,
}: SessionComposerProps) {
  const queryClient = useQueryClient()
  const activeWorkspacePath = useAppStore((s) => s.activeWorkspacePath)
  const setActiveWorkspacePath = useAppStore((s) => s.setActiveWorkspacePath)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const openRightTab = useAppStore((s) => s.openRightTab)
  const pendingPermission = useAppStore((s) => s.pendingPermission)
  const setPendingPermission = useAppStore((s) => s.setPendingPermission)
  const { models, refreshModels, isRefreshing } = useModelCatalog()
  const { modes } = usePermissionModes()
  const persisted = usePersistedInferenceSettings(models)

  const isTestEnv = import.meta.env?.MODE === "test"
  const [internalValue, setInternalValue] = React.useState("")
  const [internalProject, setInternalProject] = React.useState(
    isTestEnv ? DEFAULT_PROJECT : ""
  )
  const [internalCheckout, setInternalCheckout] =
    React.useState(DEFAULT_CHECKOUT)
  const [workspaceOptions, setWorkspaceOptions] = React.useState<
    Array<{ name: string; path?: string }>
  >(() => (isTestEnv ? HOME_PROJECTS.map((name) => ({ name })) : []))
  const [slashOpen, setSlashOpen] = React.useState(false)
  const [plusMenuView, setPlusMenuView] = React.useState<"add" | "slash" | "mention">("add")
  const [slashTipOpen, setSlashTipOpen] = React.useState(false)
  const [projectOpen, setProjectOpen] = React.useState(false)
  const [checkoutOpen, setCheckoutOpen] = React.useState(false)
  const [voiceActive, setVoiceActive] = React.useState(false)
  const [sketchOpen, setSketchOpen] = React.useState(false)
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const [skillTokens, setSkillTokens] = React.useState<ActiveSkillToken[]>([])

  // Template carousel, creator dialog, and clarifying question card
  const [activeTemplateKind, setActiveTemplateKind] =
    React.useState<ComposerTemplateKind | null>(null)
  const [templateCreatorOpen, setTemplateCreatorOpen] = React.useState(false)
  const [templateCreatorKind, setTemplateCreatorKind] =
    React.useState<ComposerTemplateKind>("spreadsheet")
  const [activeClarifyingTemplate, setActiveClarifyingTemplate] =
    React.useState<ComposerTemplateItem | null>(null)
  const [filesAndChatsSearch, setFilesAndChatsSearch] = React.useState("")

  const pluginsQuery = useQuery({
    queryKey: ["plugins", "state"],
    queryFn: () => ipcClient.plugins.getState(),
    enabled: !isTestEnv && slashOpen,
    staleTime: 30_000,
  })

  const settingsQuery = useQuery({
    queryKey: ["settings", "state"],
    queryFn: () => ipcClient.settings.getState(),
    enabled: !isTestEnv && slashOpen,
    staleTime: 30_000,
  })

  const sessionsQuery = useQuery({
    queryKey: ["sessions", "list"],
    queryFn: () => ipcClient.sessions.list(),
    enabled: slashOpen,
    staleTime: 15_000,
  })

  const workspaceFilesQuery = useQuery({
    queryKey: ["workspace", "files", activeWorkspacePath ?? "default"],
    queryFn: () => ipcClient.workspace.listFiles(),
    enabled: slashOpen,
    staleTime: 30_000,
  })

  const customTemplatesQuery = useQuery({
    queryKey: ["templates", "custom"],
    queryFn: () => ipcClient.templates.list(),
    enabled: activeTemplateKind !== null || templateCreatorOpen,
    staleTime: 30_000,
  })

  const installedPlugins = React.useMemo(
    () => (pluginsQuery.data?.plugins ?? []).filter((p) => p.installed),
    [pluginsQuery.data]
  )
  const enabledLocalSkills = React.useMemo(
    () => (pluginsQuery.data?.skills ?? []).filter((s) => s.enabled),
    [pluginsQuery.data]
  )
  const pastConversations = React.useMemo(
    () => (sessionsQuery.data ?? []).slice(0, 8),
    [sessionsQuery.data]
  )
  const showMiniPet = Boolean(settingsQuery.data?.preferences?.showMiniPet)

  const carouselTemplates = React.useMemo<ComposerTemplateItem[]>(() => {
    if (!activeTemplateKind) return []
    const builtins =
      activeTemplateKind === "presentation"
        ? BUILTIN_PRESENTATION_TEMPLATES
        : BUILTIN_SPREADSHEET_TEMPLATES
    const custom = (customTemplatesQuery.data ?? [])
      .filter((t) => t.kind === activeTemplateKind)
      .map(mapCustomTemplateToItem)
    return [...custom, ...builtins]
  }, [activeTemplateKind, customTemplatesQuery.data])

  React.useEffect(() => {
    if (isTestEnv || mode !== "home") return
    let cancelled = false
    void Promise.all([
      ipcClient.workspace.getInfo(),
      ipcClient.workspace.listRecent(),
    ]).then(([info, recent]) => {
      if (cancelled) return
      const seen = new Map<string, { name: string; path?: string }>()
      for (const item of recent ?? []) {
        if (!seen.has(item.path)) {
          seen.set(item.path, { name: item.name, path: item.path })
        }
      }
      if (info?.project && info.path && !seen.has(info.path)) {
        seen.set(info.path, { name: info.project, path: info.path })
      }
      setWorkspaceOptions(Array.from(seen.values()))

      if (activeWorkspacePath) {
        const matched = seen.get(activeWorkspacePath)
        const name =
          matched?.name ??
          activeWorkspacePath.split(/[\\/]/).filter(Boolean).pop() ??
          ""
        if (!controlledProject && name) {
          setInternalProject(name)
        }
        if (info?.branch && !controlledCheckout) {
          setInternalCheckout(info.branch)
        }
      } else if (!controlledProject) {
        setInternalProject("")
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspacePath, controlledCheckout, controlledProject, isTestEnv, mode])

  const localTextareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useImperativeHandle(
    inputRef,
    () => localTextareaRef.current as HTMLTextAreaElement
  )

  const textValue = controlledValue ?? internalValue
  const activeProject = controlledProject ?? internalProject
  const hasSelectedProject = activeProject.trim().length > 0
  const activeCheckout = controlledCheckout ?? internalCheckout
  const activeModelId = controlledModelId ?? persisted.modelId
  const activeModelLabel = controlledModelLabel ?? persisted.modelLabel
  const activeEffort = controlledEffort ?? persisted.effort
  const activePermissionMode =
    controlledPermissionMode ?? persisted.permissionMode

  const effectivePlaceholder = React.useMemo(() => {
    if (skillTokens.length > 0) return ""
    if (placeholder) return placeholder
    if (activePermissionMode === "plan") {
      return "Describe your task to generate a plan..."
    }
    return "Ask anything, @ to mention, / for actions"
  }, [activePermissionMode, placeholder, skillTokens.length])

  // Derive active `@query` from either composer textarea or popup search box
  const activeMentionQuery = React.useMemo(() => {
    if (plusMenuView === "mention") {
      const m = /(?:^|\s)@([^\s]*)$/.exec(textValue)
      return (m?.[1] ?? "").trim().toLowerCase()
    }
    return filesAndChatsSearch.trim().toLowerCase()
  }, [filesAndChatsSearch, plusMenuView, textValue])

  const filteredWorkspaceFiles = React.useMemo(() => {
    const files = workspaceFilesQuery.data ?? []
    if (!activeMentionQuery) return files.slice(0, 6)
    return files
      .filter(
        (f) =>
          f.path.toLowerCase().includes(activeMentionQuery) ||
          f.name.toLowerCase().includes(activeMentionQuery)
      )
      .slice(0, 8)
  }, [activeMentionQuery, workspaceFilesQuery.data])

  const filteredConversations = React.useMemo(() => {
    const sessions = sessionsQuery.data ?? []
    if (!activeMentionQuery) return sessions.slice(0, 5)
    return sessions
      .filter(
        (s) =>
          s.title.toLowerCase().includes(activeMentionQuery) ||
          s.project.toLowerCase().includes(activeMentionQuery)
      )
      .slice(0, 6)
  }, [activeMentionQuery, sessionsQuery.data])

  const setTextValue = React.useCallback(
    (next: string) => {
      if (onValueChange) {
        onValueChange(next)
      } else {
        setInternalValue(next)
      }
    },
    [onValueChange]
  )

  const handleModelSelect = React.useCallback(
    (model: ModelOption) => {
      persisted.setModel(model)
      onModelChange?.(model)
    },
    [onModelChange, persisted]
  )

  const handleEffortSelect = React.useCallback(
    (nextEffort: ReasoningEffort) => {
      persisted.setEffort(nextEffort)
      onEffortChange?.(nextEffort)
    },
    [onEffortChange, persisted]
  )

  const handlePermissionSelect = React.useCallback(
    (nextMode: PermissionModeId) => {
      persisted.setPermissionMode(nextMode)
      onPermissionModeChange?.(nextMode)
    },
    [onPermissionModeChange, persisted]
  )

  const handleProjectSelect = (nextProject: string, nextPath?: string) => {
    setInternalProject(nextProject)
    if (!nextProject) {
      setActiveWorkspacePath(null)
    } else if (nextPath) {
      setActiveWorkspacePath(nextPath)
      void ipcClient.workspace.setPath(nextPath).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["changes"] })
        void queryClient.invalidateQueries({ queryKey: ["inspector"] })
        void queryClient.invalidateQueries({ queryKey: ["plugins"] })
        void queryClient.invalidateQueries({ queryKey: ["workspace", "files"] })
      })
    }
    onProjectChange?.(nextProject)
    setProjectOpen(false)
    toast(nextProject ? `Project: ${nextProject}` : "Cleared project selection")
  }

  const handleAttachFiles = async () => {
    setSlashOpen(false)
    const picked = await ipcClient.workspace.pickFiles()
    if (picked.length === 0) return
    setAttachments((prev) => {
      const next = [...prev]
      for (const item of picked) {
        if (next.some((a) => a.path === item.path)) continue
        next.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: item.isDirectory ? "folder" : "file",
          name: item.name,
          path: item.path,
        })
      }
      return next
    })
    toast(`Attached ${picked.length} item${picked.length === 1 ? "" : "s"}`)
    localTextareaRef.current?.focus()
  }

  const handleAttachWorkspaceFile = (filePath: string, name: string) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.path === filePath)) return prev
      return [
        ...prev,
        {
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: "file",
          name,
          path: filePath,
        },
      ]
    })
    if (plusMenuView === "mention") {
      setTextValue(textValue.replace(/(?:^|\s)@[^\s]*$/, "").trimStart())
    }
    setFilesAndChatsSearch("")
    setSlashOpen(false)
    localTextareaRef.current?.focus()
  }

  const handleAttachConversation = (sessionId: string, title: string) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.sessionId === sessionId)) return prev
      return [
        ...prev,
        {
          id: `conv_${sessionId}`,
          kind: "conversation",
          name: title,
          sessionId,
        },
      ]
    })
    if (plusMenuView === "mention") {
      setTextValue(textValue.replace(/(?:^|\s)@[^\s]*$/, "").trimStart())
    }
    setFilesAndChatsSearch("")
    setSlashOpen(false)
    toast(`Attached conversation: ${title}`)
    localTextareaRef.current?.focus()
  }

  const handleAttachAppshot = async () => {
    setSlashOpen(false)
    const shot = await ipcClient.workspace.captureAppshot()
    if (!shot) {
      toast("Appshot capture is available in the Desktop app")
      return
    }
    setAttachments((prev) => [
      ...prev,
      {
        id: `shot_${Date.now()}`,
        kind: "image",
        name: shot.name,
        dataUrl: shot.dataUrl,
      },
    ])
    toast(`Attached appshot (${shot.name})`)
    localTextareaRef.current?.focus()
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  const addSkillToken = React.useCallback((token: ActiveSkillToken) => {
    setSkillTokens((prev) =>
      prev.some((t) => t.id === token.id) ? prev : [...prev, token]
    )
  }, [])

  const removeSkillToken = React.useCallback(
    (tokenId: string) => {
      setSkillTokens((prev) => prev.filter((t) => t.id !== tokenId))
      if (tokenId === "plan" && activePermissionMode === "plan") {
        handlePermissionSelect("default")
      }
      if (tokenId === "spreadsheets" && activeTemplateKind === "spreadsheet") {
        setActiveTemplateKind(null)
      }
      if (tokenId === "presentations" && activeTemplateKind === "presentation") {
        setActiveTemplateKind(null)
      }
    },
    [activePermissionMode, activeTemplateKind, handlePermissionSelect]
  )

  const toggleSkillToken = React.useCallback((token: ActiveSkillToken) => {
    setSkillTokens((prev) =>
      prev.some((t) => t.id === token.id)
        ? prev.filter((t) => t.id !== token.id)
        : [...prev, token]
    )
  }, [])

  const activateTemplateMode = (kind: "spreadsheet" | "presentation") => {
    const token: ActiveSkillToken =
      kind === "spreadsheet"
        ? {
            id: "spreadsheets",
            label: "Spreadsheets",
            command: "/spreadsheets",
            icon: "spreadsheets",
            tone: "spreadsheet",
          }
        : {
            id: "presentations",
            label: "Presentations",
            command: "/presentations",
            icon: "presentations",
            tone: "presentation",
          }
    // Keep one document-builder mode active at a time for clarity
    setSkillTokens((prev) => [
      ...prev.filter(
        (t) => t.id !== "spreadsheets" && t.id !== "presentations"
      ),
      token,
    ])
    setActiveClarifyingTemplate(null)
    setActiveTemplateKind(kind)
    setSlashOpen(false)
    localTextareaRef.current?.focus()
  }

  const handleTogglePets = async () => {
    const next = !showMiniPet
    setSlashOpen(false)
    await ipcClient.settings.updatePreferences({ showMiniPet: next })
    void queryClient.invalidateQueries({ queryKey: ["settings"] })
    toast(next ? "RayuCode desktop pet enabled" : "RayuCode desktop pet hidden")
  }

  const handleOpenFolder = async () => {
    setProjectOpen(false)
    const picked = await ipcClient.workspace.pickFolder()
    if (!picked) return
    setActiveWorkspacePath(picked.path)
    setInternalProject(picked.project)
    if (picked.branch) {
      setInternalCheckout(picked.branch)
    }
    onProjectChange?.(picked.project)
    void queryClient.invalidateQueries({ queryKey: ["changes"] })
    void queryClient.invalidateQueries({ queryKey: ["inspector"] })
    void queryClient.invalidateQueries({ queryKey: ["plugins"] })
    void queryClient.invalidateQueries({ queryKey: ["sessions"] })
    void queryClient.invalidateQueries({ queryKey: ["workspace", "files"] })
    toast(`Opened workspace: ${picked.project}`)
  }

  const handleCheckoutSelect = (nextCheckout: string) => {
    setInternalCheckout(nextCheckout)
    onCheckoutChange?.(nextCheckout)
    setCheckoutOpen(false)
    toast(`Checkout: ${nextCheckout}`)
  }

  const adjustTextareaHeight = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      if (!node) return
      node.style.height = "auto"
      node.style.height = `${Math.min(node.scrollHeight, 180)}px`
    },
    []
  )

  React.useEffect(() => {
    adjustTextareaHeight(localTextareaRef.current)
  }, [textValue, adjustTextareaHeight])

  const submitComposedPayload = async (overridePrompt?: string) => {
    if (disabled || isSubmitting) return
    const trimmed = (overridePrompt ?? textValue).trim()
    if (!trimmed && attachments.length === 0 && skillTokens.length === 0) {
      localTextareaRef.current?.focus()
      toast("Type a prompt or /command first")
      return
    }

    const attachmentPrefix =
      attachments.length > 0
        ? `${attachments
            .map((a) => {
              if (a.kind === "conversation") {
                return `[Referenced RayuCode conversation: "${a.name}" (${a.sessionId ?? "session"})]`
              }
              return a.path
                ? `[Attached ${a.kind}: ${a.path}]`
                : `[Attached image: ${a.name}]`
            })
            .join("\n")}\n\n`
        : ""

    const skillPrefix =
      skillTokens.length > 0
        ? `${skillTokens.map((t) => t.command).join(" ")} `
        : ""

    setSlashOpen(false)
    setActiveTemplateKind(null)
    setActiveClarifyingTemplate(null)
    const payload: ComposerSubmitPayload = {
      prompt: `${attachmentPrefix}${skillPrefix}${trimmed}`.trim(),
      project: activeProject || "No Project",
      checkout: activeCheckout,
      modelId: activeModelId,
      modelLabel: activeModelLabel,
      effort: activeEffort,
      permissionMode: activePermissionMode,
    }

    setTextValue("")
    setAttachments([])
    setSkillTokens([])
    await onSubmit?.(payload)
  }

  const handleSend = async () => {
    await submitComposedPayload()
  }

  const handleSelectTemplate = (template: ComposerTemplateItem) => {
    setActiveTemplateKind(null)
    setActiveClarifyingTemplate(template)
  }

  const handleClarifyingOption = (option: ClarifyingOption) => {
    if (!activeClarifyingTemplate) return
    const template = activeClarifyingTemplate
    if (option.id === "provide_data") {
      // Let user attach files or type/paste their metrics right inside the composer
      const draft = buildTemplatePrompt({ template, selectedOption: option })
      setActiveClarifyingTemplate(null)
      setTextValue(`${draft}\n\nSource data / notes: `)
      localTextareaRef.current?.focus()
      toast("Attach files or paste your data, then press Enter to generate")
      return
    }
    const finalPrompt = buildTemplatePrompt({
      template,
      selectedOption: option,
    })
    void submitComposedPayload(finalPrompt)
  }

  const handleClarifyingCustom = (instruction: string) => {
    if (!activeClarifyingTemplate) return
    const finalPrompt = buildTemplatePrompt({
      template: activeClarifyingTemplate,
      customInstruction: instruction,
    })
    void submitComposedPayload(finalPrompt)
  }

  const handleClarifyingSkip = () => {
    if (!activeClarifyingTemplate) return
    const finalPrompt = buildTemplatePrompt({
      template: activeClarifyingTemplate,
    })
    void submitComposedPayload(finalPrompt)
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value

    // Auto-convert typed built-in `/goal `, `/plan `, `/swarm `, etc. on trailing space into clean inline skill tokens
    const typedBuiltinMatch = /^\/([a-zA-Z0-9-]+)\s$/.exec(next)
    if (typedBuiltinMatch) {
      const cmdName = typedBuiltinMatch[1].toLowerCase()
      const knownCmd = SLASH_COMMANDS.find(
        (c) => c.command.slice(1).toLowerCase() === cmdName
      )
      const knownSkill = enabledLocalSkills.find(
        (s) => s.name.toLowerCase() === cmdName
      )
      if (knownCmd) {
        const token = resolveBuiltinSkillToken(knownCmd.insertText)
        addSkillToken(token)
        if (token.id === "plan" && activePermissionMode !== "plan") {
          handlePermissionSelect("plan")
        }
        setTextValue("")
        setSlashOpen(false)
        return
      }
      if (knownSkill) {
        addSkillToken({
          id: knownSkill.id,
          label: knownSkill.name,
          command: `/${knownSkill.name}`,
          icon: "skill",
        })
        setTextValue("")
        setSlashOpen(false)
        return
      }
    }

    setTextValue(next)
    if (next.startsWith("/")) {
      setPlusMenuView("slash")
      setSlashOpen(true)
    } else if (/(?:^|\s)@[^\s]*$/.test(next)) {
      setPlusMenuView("mention")
      setSlashOpen(true)
    } else if (plusMenuView === "slash" || plusMenuView === "mention") {
      setSlashOpen(false)
    }
  }

  const handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Escape" && slashOpen) {
      event.preventDefault()
      setSlashOpen(false)
      return
    }
    if (
      event.key === "Backspace" &&
      skillTokens.length > 0 &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault()
      const last = skillTokens[skillTokens.length - 1]
      if (last) removeSkillToken(last.id)
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const handleInsertSlashCommand = (insertText: string) => {
    const token = resolveBuiltinSkillToken(insertText)
    addSkillToken(token)
    if (token.id === "plan" && activePermissionMode !== "plan") {
      handlePermissionSelect("plan")
    }
    setTextValue("")
    setSlashOpen(false)
    localTextareaRef.current?.focus()
  }

  const handleVoiceToggle = () => {
    setVoiceActive((prev) => {
      const next = !prev
      toast(next ? "Voice input listening..." : "Voice input stopped")
      return next
    })
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div
        data-testid="session-composer-dock"
        data-composer-mode={mode}
        className={cn(
          "flex w-full shrink-0 flex-col items-center px-6",
          mode === "home" ? "pb-[22px]" : "pb-3.5",
          className
        )}
      >
        {/* Floating Clarifying Question Card (Image 5) */}
        {activeClarifyingTemplate ? (
          <ClarifyingQuestionCard
            key={activeClarifyingTemplate.id}
            template={activeClarifyingTemplate}
            onSelectOption={handleClarifyingOption}
            onSubmitCustom={handleClarifyingCustom}
            onSkip={handleClarifyingSkip}
            onClose={() => setActiveClarifyingTemplate(null)}
            voiceActive={voiceActive}
            onVoiceToggle={handleVoiceToggle}
          />
        ) : null}

        {/* Floating Templates Carousel (Images 1 & 4) */}
        {!activeClarifyingTemplate && activeTemplateKind ? (
          <TemplateCarousel
            kind={activeTemplateKind}
            templates={carouselTemplates}
            onSelectTemplate={handleSelectTemplate}
            onCreateTemplateClick={() => {
              setTemplateCreatorKind(activeTemplateKind)
              setTemplateCreatorOpen(true)
            }}
            onDeleteCustomTemplate={(id) => {
              void ipcClient.templates.remove(id).then(() => {
                void queryClient.invalidateQueries({
                  queryKey: ["templates", "custom"],
                })
                toast("Removed custom template")
              })
            }}
            onClose={() => setActiveTemplateKind(null)}
          />
        ) : null}

        <div
          data-testid="composer-shell"
          className="rayu-card-bevel relative w-full max-w-[732px] rounded-[22px] bg-shell p-[5px] focus:shadow-none focus:outline-none"
        >
          {/* Project & Checkout Top Tray — ONLY rendered on Home (New Session) */}
          {mode === "home" ? (
            <div
              data-testid="composer-top-tray"
              className="flex items-center gap-2.5 px-[13px] pt-[5px] pb-2 text-xs text-muted-ink"
            >
              <Popover open={projectOpen} onOpenChange={setProjectOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="composer-project-trigger"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-[3px] text-xs font-normal text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-body focus:outline-none"
                  >
                    {hasSelectedProject ? (
                      <Folder
                        className="size-[13px] text-folder"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span>
                      {hasSelectedProject ? activeProject : "No Project"}
                    </span>
                    <ChevronDown
                      className="size-[11px] opacity-70"
                      aria-hidden="true"
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="rayu-card-bevel w-52 rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-rayu-2"
                >
                  <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-ink uppercase">
                    Workspace
                  </div>
                  {!isTestEnv ? (
                    <button
                      type="button"
                      onClick={() => handleProjectSelect("")}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink",
                        !hasSelectedProject && "bg-active text-ink"
                      )}
                    >
                      <span>No Project</span>
                      {!hasSelectedProject ? (
                        <Check
                          className="size-3.5 shrink-0 text-ink"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  ) : null}
                  {(workspaceOptions.length > 0
                    ? workspaceOptions
                    : isTestEnv
                      ? HOME_PROJECTS.map((name) => ({ name, path: undefined }))
                      : []
                  ).map((proj) => (
                    <button
                      key={proj.path ?? proj.name}
                      type="button"
                      onClick={() => handleProjectSelect(proj.name, proj.path)}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover",
                        proj.name === activeProject && "bg-active"
                      )}
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <Folder
                          className="size-3.5 shrink-0 text-folder"
                          aria-hidden="true"
                        />
                        <span className="truncate">{proj.name}</span>
                      </span>
                      {proj.name === activeProject ? (
                        <Check
                          className="size-3.5 shrink-0 text-ink"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  ))}
                  {!isTestEnv ? (
                    <>
                      <div className="my-1 h-px bg-hairline" />
                      <button
                        type="button"
                        onClick={() => void handleOpenFolder()}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-brand-text transition-colors hover:bg-hover"
                      >
                        <FolderOpen
                          className="size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Open folder…</span>
                      </button>
                    </>
                  ) : null}
                </PopoverContent>
              </Popover>

              {hasSelectedProject ? (
                <Popover open={checkoutOpen} onOpenChange={setCheckoutOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="composer-checkout-trigger"
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-[3px] text-xs font-normal text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-body focus:outline-none"
                    >
                      <Monitor
                        className="size-[13px] text-muted-ink"
                        aria-hidden="true"
                      />
                      <span>{activeCheckout}</span>
                      <ChevronDown
                        className="size-[11px] opacity-70"
                        aria-hidden="true"
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    sideOffset={8}
                    className="rayu-card-bevel w-52 rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-rayu-2"
                  >
                    <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-ink uppercase">
                      Checkout
                    </div>
                    {HOME_CHECKOUTS.map((co) => (
                      <button
                        key={co}
                        type="button"
                        onClick={() => handleCheckoutSelect(co)}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover",
                          co === activeCheckout && "bg-active"
                        )}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Monitor
                            className="size-3.5 text-muted-ink"
                            aria-hidden="true"
                          />
                          <span>{co}</span>
                        </span>
                        {co === activeCheckout ? (
                          <Check
                            className="size-3.5 text-ink"
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          ) : null}

          {/* Inner Elevated Composer Surface */}
          <div
            data-testid="composer-inner"
            className="flex flex-col rounded-[17px] border border-premium-hi bg-raised shadow-rayu-1 focus-within:ring-0 focus-within:outline-none"
          >
            {attachments.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-3">
                {attachments.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border border-hairline bg-inset px-2 py-1 text-xs text-ink"
                  >
                    {att.kind === "image" && att.dataUrl ? (
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        className="size-4 rounded object-cover"
                      />
                    ) : att.kind === "folder" ? (
                      <Folder
                        className="size-3.5 shrink-0 text-folder"
                        aria-hidden="true"
                      />
                    ) : att.kind === "conversation" ? (
                      <Circle
                        className="size-3 shrink-0 text-code-type"
                        aria-hidden="true"
                      />
                    ) : (
                      <Paperclip
                        className={cn(
                          "size-3.5 shrink-0",
                          getFileColorClass(att.name)
                        )}
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate font-mono text-[11px]">
                      {att.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${att.name}`}
                      onClick={() => handleRemoveAttachment(att.id)}
                      className="ml-0.5 grid size-4 shrink-0 cursor-pointer place-items-center rounded text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div
              onClick={() => localTextareaRef.current?.focus()}
              className="flex min-h-[52px] w-full cursor-text flex-wrap items-center gap-x-2.5 gap-y-1 px-[18px] pt-3.5 pb-[9px]"
            >
              {skillTokens.map((token) => (
                <button
                  key={token.id}
                  type="button"
                  data-testid={`composer-skill-token-${token.id}`}
                  title={`Remove ${token.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeSkillToken(token.id)
                    localTextareaRef.current?.focus()
                  }}
                  style={
                    token.tone === "spreadsheet"
                      ? { color: "rgb(134, 239, 172)" }
                      : token.tone === "presentation"
                        ? { color: "rgb(252, 211, 77)" }
                        : undefined
                  }
                  className={cn(
                    "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-[15px] leading-none font-medium tracking-[-0.01em] transition-colors hover:bg-hover",
                    !token.tone && "text-ink",
                    token.tone === "info" && "text-info",
                    token.tone === "brand" && "text-brand-text"
                  )}
                >
                  <SkillTokenIcon icon={token.icon} />
                  <span>{token.label}</span>
                </button>
              ))}

              <textarea
                ref={localTextareaRef}
                rows={1}
                value={textValue}
                disabled={disabled || isSubmitting}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                placeholder={effectivePlaceholder}
                aria-label={
                  mode === "home" ? "Message RayuCode" : "Reply to RayuCode"
                }
                className="block max-h-[180px] min-h-[24px] min-w-[140px] flex-1 resize-none border-none bg-transparent p-0 text-sm leading-normal text-ink placeholder:text-muted-ink focus:ring-0 focus:shadow-none focus:outline-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-60"
              />
            </div>

            <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-[11px]">
              {/* Left + Codex-style Add, Plugins, Apps, Conversations & @ Mention Trigger */}
              <Popover
                open={slashOpen}
                onOpenChange={(open) => {
                  if (open) {
                    if (textValue.startsWith("/")) {
                      setPlusMenuView("slash")
                    } else if (/(?:^|\s)@[^\s]*$/.test(textValue)) {
                      setPlusMenuView("mention")
                    } else {
                      setPlusMenuView("add")
                    }
                  } else {
                    setFilesAndChatsSearch("")
                  }
                  setSlashOpen(open)
                }}
              >
                <Tooltip
                  open={!slashOpen && slashTipOpen}
                  onOpenChange={setSlashTipOpen}
                >
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label="Add files and more"
                        data-testid="composer-plus-trigger"
                        onClick={() => {
                          if (!textValue.startsWith("/")) {
                            setPlusMenuView("add")
                          }
                        }}
                        className="grid size-7 cursor-pointer place-items-center rounded-full border border-transparent text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none data-[state=open]:border-hairline data-[state=open]:bg-active data-[state=open]:text-ink"
                      >
                        <Plus className="size-[15px]" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="inline-flex items-center gap-1.5"
                  >
                    <span>Add files and more</span>
                    <kbd className="rounded bg-active px-1 py-px font-mono text-[10.5px] text-body">
                      @
                    </kbd>
                  </TooltipContent>
                </Tooltip>

                <PopoverContent
                  side="top"
                  align="start"
                  alignOffset={-16}
                  sideOffset={14}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onFocusOutside={(event) => {
                    if (
                      event.detail.originalEvent.target ===
                      localTextareaRef.current
                    ) {
                      event.preventDefault()
                    }
                  }}
                  onInteractOutside={(event) => {
                    if (
                      event.detail.originalEvent.target ===
                      localTextareaRef.current
                    ) {
                      event.preventDefault()
                    }
                  }}
                  className={cn(
                    "rayu-card-bevel max-w-[calc(100vw-32px)] border border-premium-hi bg-popover-solid shadow-rayu-2",
                    plusMenuView === "slash"
                      ? "w-[390px] rounded-[14px] p-1.5"
                      : "w-[min(720px,calc(100vw-48px))] rounded-[18px] p-2"
                  )}
                >
                  {plusMenuView === "slash" ? (
                    <>
                      <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.06em] text-muted-ink uppercase">
                        Built-in Skills &amp; Commands
                      </div>
                      <div className="flex max-h-[280px] flex-col overflow-y-auto">
                        {SLASH_COMMANDS.filter((item) => {
                          const q = textValue.slice(1).trim().toLowerCase()
                          if (!q) return true
                          return (
                            item.command.toLowerCase().includes(q) ||
                            item.description.toLowerCase().includes(q)
                          )
                        }).map((item) => {
                          const tok = resolveBuiltinSkillToken(item.insertText)
                          return (
                            <button
                              key={item.command}
                              type="button"
                              onClick={() =>
                                handleInsertSlashCommand(item.insertText)
                              }
                              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hover"
                            >
                              <SkillTokenIcon icon={tok.icon} />
                              <span className="min-w-[88px] font-medium text-ink">
                                {tok.label}
                              </span>
                              <span className="truncate text-muted-ink">
                                {item.description}
                              </span>
                            </button>
                          )
                        })}
                        {enabledLocalSkills
                          .filter((skill) => {
                            const q = textValue.slice(1).trim().toLowerCase()
                            if (!q) return true
                            return (
                              skill.name.toLowerCase().includes(q) ||
                              skill.description.toLowerCase().includes(q)
                            )
                          })
                          .map((skill) => (
                            <button
                              key={skill.id}
                              type="button"
                              onClick={() => {
                                addSkillToken({
                                  id: skill.id,
                                  label: skill.name,
                                  command: `/${skill.name}`,
                                  icon: "skill",
                                })
                                setTextValue("")
                                setSlashOpen(false)
                                localTextareaRef.current?.focus()
                              }}
                              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hover"
                            >
                              <SkillTokenIcon icon="skill" />
                              <span className="min-w-[88px] truncate font-medium text-ink">
                                {skill.name}
                              </span>
                              <span className="truncate text-muted-ink">
                                {skill.description}
                              </span>
                            </button>
                          ))}
                      </div>
                    </>
                  ) : plusMenuView === "mention" ? (
                    <div
                      data-testid="composer-mention-menu"
                      className="flex max-h-[360px] flex-col gap-0.5 overflow-y-auto"
                    >
                      <div className="px-3 pt-1.5 pb-1 text-xs font-medium text-muted-ink">
                        Files and chats
                      </div>
                      {filteredWorkspaceFiles.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() =>
                            handleAttachWorkspaceFile(file.path, file.name)
                          }
                          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                        >
                          <span className="inline-flex min-w-0 items-center gap-2.5">
                            <FileText
                              className="size-4 shrink-0 text-muted-ink"
                              strokeWidth={1.7}
                              aria-hidden="true"
                            />
                            <span className="truncate font-mono text-xs">
                              {file.path}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-ink">
                            File
                          </span>
                        </button>
                      ))}
                      {filteredConversations.map((conv) => (
                        <button
                          key={conv.id}
                          type="button"
                          onClick={() =>
                            handleAttachConversation(conv.id, conv.title)
                          }
                          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                        >
                          <span className="inline-flex min-w-0 items-center gap-2.5">
                            <Circle
                              className="size-3.5 shrink-0 text-muted-ink"
                              strokeWidth={1.7}
                              aria-hidden="true"
                            />
                            <span className="truncate">{conv.title}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-ink">
                            RayuCode conversation
                          </span>
                        </button>
                      ))}
                      {filteredWorkspaceFiles.length === 0 &&
                      filteredConversations.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-muted-ink">
                          No matching workspace files or RayuCode conversations.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      data-testid="composer-add-menu"
                      className="flex max-h-[460px] flex-col gap-0.5 overflow-y-auto pr-0.5"
                    >
                      <div className="px-3 pt-1.5 pb-1 text-xs font-medium text-muted-ink">
                        Add
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleAttachFiles()}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <Paperclip
                          className="size-4 shrink-0 text-muted-ink"
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="font-medium">Files and folders</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleAttachAppshot()}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <Scan
                          className="size-4 shrink-0 text-muted-ink"
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="font-medium">Attach appshot</span>
                        <span className="text-muted-ink">
                          Capture current window
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          void handleOpenFolder()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <Folder
                          className="size-4 shrink-0 text-folder"
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="font-medium">Work in a project</span>
                        <span className="truncate text-muted-ink">
                          Choose project for new chats
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          toggleSkillToken({
                            id: "goal",
                            label: "goal",
                            command: "/goal",
                            icon: "goal",
                          })
                          localTextareaRef.current?.focus()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <Target
                          className={cn(
                            "size-4 shrink-0",
                            skillTokens.some((t) => t.id === "goal")
                              ? "text-brand-text"
                              : "text-muted-ink"
                          )}
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="font-medium">Goal</span>
                        <span className="truncate text-muted-ink">
                          Set a goal to keep pursuing
                        </span>
                        {skillTokens.some((t) => t.id === "goal") ? (
                          <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
                            On
                          </span>
                        ) : null}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const nextMode: PermissionModeId =
                            activePermissionMode === "plan"
                              ? "default"
                              : "plan"
                          handlePermissionSelect(nextMode)
                          if (nextMode === "plan") {
                            addSkillToken({
                              id: "plan",
                              label: "plan",
                              command: "/plan",
                              icon: "plan",
                            })
                          } else {
                            setSkillTokens((prev) =>
                              prev.filter((t) => t.id !== "plan")
                            )
                          }
                          setSlashOpen(false)
                          localTextareaRef.current?.focus()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <Lightbulb
                          className={cn(
                            "size-4 shrink-0",
                            activePermissionMode === "plan"
                              ? "text-brand-text"
                              : "text-muted-ink"
                          )}
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="font-medium">Plan mode</span>
                        <span className="truncate text-muted-ink">
                          {activePermissionMode === "plan"
                            ? "Turn plan mode off"
                            : "Turn plan mode on"}
                        </span>
                        {activePermissionMode === "plan" ? (
                          <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
                            On
                          </span>
                        ) : null}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          setActiveRoute("plugins")
                          toast("Open Skills tab to create a new local skill")
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <CircleDot
                          className="size-4 shrink-0 text-muted-ink"
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="font-medium">Record a skill</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          setSketchOpen(true)
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <Pencil
                          className="size-4 shrink-0 text-brand-text"
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span className="font-medium">Sketch</span>
                        <span className="truncate text-muted-ink">
                          Draw a sketch
                        </span>
                      </button>

                      {/* Plugins Section (Image 2) */}
                      <div className="mt-1 px-3 pt-2 pb-1 text-xs font-medium text-muted-ink">
                        Plugins
                      </div>

                      <button
                        type="button"
                        data-testid="plugin-spreadsheets-btn"
                        onClick={() => activateTemplateMode("spreadsheet")}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="spreadsheets" />
                        <span className="font-medium">Spreadsheets</span>
                        <span className="truncate text-muted-ink">
                          Create and edit spreadsheets
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="plugin-presentations-btn"
                        onClick={() => activateTemplateMode("presentation")}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="presentations" />
                        <span className="font-medium">Presentations</span>
                        <span className="truncate text-muted-ink">
                          Create and edit presentations
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="plugin-template-creator-btn"
                        onClick={() => {
                          setSlashOpen(false)
                          setTemplateCreatorKind(
                            activeTemplateKind ?? "spreadsheet"
                          )
                          setTemplateCreatorOpen(true)
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="template-creator" />
                        <span className="font-medium">Template Creator</span>
                        <span className="truncate text-muted-ink">
                          Create or update reusable templates from reference
                          content
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          addSkillToken({
                            id: "browser",
                            label: "Browser",
                            command: "/browser",
                            icon: "browser",
                            tone: "info",
                          })
                          if (mode === "workspace") {
                            openRightTab("browser", "localhost:3000")
                          }
                          localTextareaRef.current?.focus()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="browser" />
                        <span className="font-medium">Browser</span>
                        <span className="truncate text-muted-ink">
                          Control the in-app browser
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          addSkillToken({
                            id: "computer",
                            label: "Computer",
                            command: "/computer",
                            icon: "computer",
                          })
                          localTextareaRef.current?.focus()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="computer" />
                        <span className="font-medium">Computer</span>
                        <span className="truncate text-muted-ink">
                          Control Mac apps from RayuCode
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          addSkillToken({
                            id: "pages",
                            label: "Pages",
                            command: "/pages",
                            icon: "pages",
                          })
                          localTextareaRef.current?.focus()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="pages" />
                        <span className="font-medium">Pages</span>
                        <span className="truncate text-muted-ink">
                          Create and edit pages and spaces
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleTogglePets()}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="pets" />
                        <span className="font-medium">Pets</span>
                        <span className="truncate text-muted-ink">
                          Create and manage animated RayuCode pets
                        </span>
                        {showMiniPet ? (
                          <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text">
                            On
                          </span>
                        ) : null}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          setActiveRoute("plugins")
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="plugin-management" />
                        <span className="font-medium">Plugin Management</span>
                        <span className="truncate text-muted-ink">
                          Discover and manage plugins
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          addSkillToken({
                            id: "sites",
                            label: "Sites",
                            command: "/sites",
                            icon: "sites",
                            tone: "info",
                          })
                          localTextareaRef.current?.focus()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="sites" />
                        <span className="font-medium">Sites</span>
                        <span className="truncate text-muted-ink">
                          Build and deploy websites
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSlashOpen(false)
                          addSkillToken({
                            id: "visualize",
                            label: "Visualize",
                            command: "/visualize",
                            icon: "visualize",
                            tone: "info",
                          })
                          localTextareaRef.current?.focus()
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                      >
                        <PluginBadgeIcon kind="visualize" />
                        <span className="font-medium">Visualize</span>
                        <span className="truncate text-muted-ink">
                          Create interactive visuals
                        </span>
                      </button>

                      {/* Apps Section (Image 3 — Live installed MCP servers) */}
                      <div className="mt-1 px-3 pt-2 pb-1 text-xs font-medium text-muted-ink">
                        Apps
                      </div>

                      {installedPlugins.length > 0 ? (
                        installedPlugins.map((plugin) => (
                          <button
                            key={plugin.id}
                            type="button"
                            onClick={() => {
                              addSkillToken({
                                id: `mcp_${plugin.id}`,
                                label: plugin.name,
                                command: `@${plugin.mcpServerId ?? plugin.id}`,
                                icon: "mcp",
                                tone: "brand",
                              })
                              setSlashOpen(false)
                              localTextareaRef.current?.focus()
                            }}
                            className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                          >
                            <Plug
                              className="size-4 shrink-0 text-muted-ink"
                              strokeWidth={1.7}
                              aria-hidden="true"
                            />
                            <span className="font-medium">{plugin.name}</span>
                            <span className="truncate text-muted-ink">
                              {plugin.description}
                            </span>
                          </button>
                        ))
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSlashOpen(false)
                            setActiveRoute("plugins")
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left text-xs text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                        >
                          <Plug
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Connect MCP apps in Customizations…</span>
                        </button>
                      )}

                      {/* RayuCode Conversations Section (Image 3 — Real past sessions) */}
                      <div className="mt-1 px-3 pt-2 pb-1 text-xs font-medium text-muted-ink">
                        RayuCode conversations
                      </div>

                      {pastConversations.length > 0 ? (
                        pastConversations.map((conv) => (
                          <button
                            key={conv.id}
                            type="button"
                            data-testid={`composer-conv-${conv.id}`}
                            onClick={() =>
                              handleAttachConversation(conv.id, conv.title)
                            }
                            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-hover"
                          >
                            <span className="inline-flex min-w-0 items-center gap-3">
                              <Circle
                                className="size-3.5 shrink-0 text-muted-ink"
                                strokeWidth={1.6}
                                aria-hidden="true"
                              />
                              <span className="truncate font-normal">
                                {conv.title}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-ink">
                              RayuCode conversation
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-1.5 text-xs text-muted-ink">
                          No prior conversations yet
                        </div>
                      )}

                      {/* Files and chats Section (Image 3 — Real live workspace file & chat search) */}
                      <div className="mt-1 px-3 pt-2 pb-1 text-xs font-medium text-muted-ink">
                        Files and chats
                      </div>

                      <div className="px-2 pb-1">
                        <div className="flex items-center gap-2 rounded-[10px] border border-transparent bg-inset/60 px-2.5 py-1.5 focus-within:border-hairline">
                          <Search
                            className="size-3.5 shrink-0 text-muted-ink"
                            aria-hidden="true"
                          />
                          <input
                            type="text"
                            data-testid="files-and-chats-search"
                            value={filesAndChatsSearch}
                            onChange={(e) =>
                              setFilesAndChatsSearch(e.target.value)
                            }
                            placeholder="Type to search files or chats"
                            className="w-full bg-transparent text-[13px] text-ink placeholder:text-muted-ink focus:outline-none"
                          />
                        </div>

                        {filesAndChatsSearch.trim().length > 0 ? (
                          <div className="mt-1 flex flex-col gap-0.5">
                            {filteredWorkspaceFiles.map((file) => (
                              <button
                                key={file.path}
                                type="button"
                                onClick={() =>
                                  handleAttachWorkspaceFile(
                                    file.path,
                                    file.name
                                  )
                                }
                                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover"
                              >
                                <span className="inline-flex min-w-0 items-center gap-2">
                                  <FileText
                                    className="size-3.5 shrink-0 text-muted-ink"
                                    aria-hidden="true"
                                  />
                                  <span className="truncate font-mono">
                                    {file.path}
                                  </span>
                                </span>
                                <span className="shrink-0 text-[11px] text-muted-ink">
                                  File
                                </span>
                              </button>
                            ))}
                            {filteredConversations.map((conv) => (
                              <button
                                key={`search_${conv.id}`}
                                type="button"
                                onClick={() =>
                                  handleAttachConversation(conv.id, conv.title)
                                }
                                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover"
                              >
                                <span className="inline-flex min-w-0 items-center gap-2">
                                  <Circle
                                    className="size-3 shrink-0 text-muted-ink"
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">{conv.title}</span>
                                </span>
                                <span className="shrink-0 text-[11px] text-muted-ink">
                                  RayuCode conversation
                                </span>
                              </button>
                            ))}
                            {filteredWorkspaceFiles.length === 0 &&
                            filteredConversations.length === 0 ? (
                              <div className="px-2.5 py-2 text-xs text-muted-ink">
                                No matching files or conversations.
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              {/* 2-Stage Model & 5-Stop Reasoning Effort Popover */}
              {mode === "workspace" && (isSubmitting || pendingPermission) ? (
                <button
                  type="button"
                  data-testid="composer-approve-for-me-btn"
                  onClick={() => {
                    handlePermissionSelect("acceptEdits")
                    if (pendingPermission) {
                      void ipcClient.trace.respondToPermission(
                        pendingPermission.sessionId,
                        pendingPermission.requestId,
                        "allow"
                      )
                      setPendingPermission(null)
                    }
                    toast("Auto-approving edits for this conversation")
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <span>Approve for me</span>
                </button>
              ) : null}

              <ModelEffortPopover
                modelId={activeModelId}
                modelLabel={activeModelLabel}
                effort={activeEffort}
                models={models}
                onSelectModel={handleModelSelect}
                onSelectEffort={handleEffortSelect}
                onRefreshModels={refreshModels}
                isRefreshing={isRefreshing}
                disabled={disabled}
              />

              <span className="flex-1" />

              {/* 5 Local Permission Modes Popover (Shift+Tab cycle) */}
              <PermissionPopover
                value={activePermissionMode}
                onChange={handlePermissionSelect}
                modes={modes}
                disabled={disabled}
              />

              {/* Voice Input Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label="Voice input"
                    aria-pressed={voiceActive}
                    onClick={handleVoiceToggle}
                    className={cn(
                      "grid size-7 cursor-pointer place-items-center rounded-lg border border-transparent text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none",
                      voiceActive &&
                        "border-brand/40 bg-brand-softer text-brand-text"
                    )}
                  >
                    <Mic className="size-[15px]" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Voice input</TooltipContent>
              </Tooltip>

              {/* Primary Send Orb Button OR Stop Generation Button (Screenshot 2) */}
              {isSubmitting ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Stop generation"
                      data-testid="composer-stop-btn"
                      onClick={() => {
                        onStop?.()
                        toast("Stopped active generation")
                      }}
                      className="ml-0.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-info text-ink transition-all outline-none hover:scale-[1.04] focus:outline-none active:scale-[0.98]"
                    >
                      <span
                        aria-hidden="true"
                        className="block size-2.5 rounded-[2px] bg-ink"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Stop generation</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label="Send message"
                      data-testid="composer-send-btn"
                      onClick={() => void handleSend()}
                      className="rayu-primary-bevel ml-0.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-brand-ink transition-all outline-none hover:scale-[1.04] hover:bg-brand-bright focus:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                    >
                      <ArrowUp
                        className="size-[15px]"
                        strokeWidth={2.2}
                        aria-hidden="true"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Send message</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      <SketchDialog
        open={sketchOpen}
        onOpenChange={setSketchOpen}
        onAttach={(sketch) => {
          setAttachments((prev) => [
            ...prev,
            {
              id: `sketch_${Date.now()}`,
              kind: "image",
              name: sketch.name,
              dataUrl: sketch.dataUrl,
            },
          ])
          toast(`Attached sketch (${sketch.name})`)
          localTextareaRef.current?.focus()
        }}
      />

      <TemplateCreatorDialog
        key={`${templateCreatorKind}_${templateCreatorOpen ? "open" : "closed"}`}
        open={templateCreatorOpen}
        defaultKind={templateCreatorKind}
        onOpenChange={setTemplateCreatorOpen}
        onSave={async (input) => {
          await ipcClient.templates.save(input)
          void queryClient.invalidateQueries({
            queryKey: ["templates", "custom"],
          })
          setActiveTemplateKind(input.kind)
          toast(`Saved template: ${input.name}`)
        }}
      />
    </TooltipProvider>
  )
}
