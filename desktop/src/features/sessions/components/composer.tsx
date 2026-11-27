import * as React from "react"
import {
  formatEffortLabel,
  parseSlashInvocation,
} from "@rayu-dev/rayucode-session-core/client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  Clock,
  CornerDownLeft,
  Database,
  Eye,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Globe,
  Laptop,
  LayoutGrid,
  Lightbulb,
  ListPlus,
  ListTodo,
  Loader2,
  Minimize2,
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
  Square,
  Target,
  Terminal,
  Timer,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
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
import {
  ipcClient,
  parseImageDataUrl,
  type CommandDescriptor,
} from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import {
  DEFAULT_CHECKOUT,
  DEFAULT_PROJECT,
  HOME_PROJECTS,
} from "../constants/models"
import {
  useCapabilities,
  useModelCatalog,
  usePermissionModes,
  usePersistedInferenceSettings,
} from "../hooks/use-sessions"
import type {
  ComposerMode,
  ComposerSubmitPayload,
  ModelOption,
  PermissionModeId,
  PromptImageAttachment,
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
  mediaType?: string
  sessionId?: string
}

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024
const MAX_ATTACHED_IMAGES = 10

function inferImageMediaType(file: File): string | null {
  const rawType = file.type.toLowerCase().trim()
  if (rawType === "image/jpg") return "image/jpeg"
  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(rawType)) return rawType
  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith(".png")) return "image/png"
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg"
  }
  if (lowerName.endsWith(".webp")) return "image/webp"
  if (lowerName.endsWith(".gif")) return "image/gif"
  return null
}

function readImageFileAsAttachment(
  file: File
): Promise<ComposerAttachment | null> {
  const mediaType = inferImageMediaType(file)
  if (!mediaType) return Promise.resolve(null)
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    toast.error(`"${file.name || "Image"}" exceeds the 10 MB image limit`)
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : ""
      if (!dataUrl.startsWith("data:image/")) {
        resolve(null)
        return
      }
      const ext = mediaType.split("/")[1] || "png"
      const fallbackName = `screenshot-${Date.now()}.${ext}`
      const filePath = (file as File & { path?: string }).path
      resolve({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "image",
        name: file.name || fallbackName,
        ...(filePath ? { path: filePath } : {}),
        dataUrl,
        mediaType,
      })
    }
    reader.onerror = () => {
      toast.error(`Could not read image "${file.name || "attachment"}"`)
      resolve(null)
    }
    reader.readAsDataURL(file)
  })
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

interface ActiveSlashTrigger {
  slashIndex: number
  endIndex: number
  query: string
}

interface CompletedSlashTokenMatch {
  tokenStart: number
  tokenEnd: number
  commandName: string
}

type SlashMenuItem =
  | {
      kind: "engine"
      key: string
      name: string
      description: string
      category: string
      argHint?: string
      requiresSession: boolean
      descriptor: CommandDescriptor
    }
  | {
      kind: "skill"
      key: string
      name: string
      description: string
      skillId: string
    }

interface CommandFeedbackState {
  status: "running" | "success" | "busy" | "error"
  message: string
}

function clampCursorIndex(value: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, value.length))
}

function resolveTextareaCursor(
  target: HTMLTextAreaElement,
  valueLength: number
): number {
  const sel = target.selectionStart
  if (
    typeof sel === "number" &&
    (document.activeElement === target || sel > 0 || valueLength === 0)
  ) {
    return sel
  }
  return valueLength
}

function getActiveSlashTrigger(
  value: string,
  cursor: number = value.length
): ActiveSlashTrigger | null {
  const safeCursor = clampCursorIndex(value, cursor)
  const beforeCursor = value.slice(0, safeCursor)
  const match = /(?:^|\s)(\/([^\s/]*))$/.exec(beforeCursor)
  if (!match) return null
  return {
    slashIndex: safeCursor - match[1].length,
    endIndex: safeCursor,
    query: match[2] ?? "",
  }
}

function matchCompletedSlashToken(
  value: string,
  cursor: number = value.length
): CompletedSlashTokenMatch | null {
  const safeCursor = clampCursorIndex(value, cursor)
  const beforeCursor = value.slice(0, safeCursor)
  const match = /(?:^|\s)(\/([a-zA-Z0-9._-]+))\s$/.exec(beforeCursor)
  if (!match) return null
  return {
    tokenStart: safeCursor - match[1].length - 1,
    tokenEnd: safeCursor,
    commandName: match[2],
  }
}

function stripSlashRange(
  value: string,
  start: number,
  end: number
): { nextValue: string; nextCursor: number } {
  const before = value.slice(0, start)
  let after = value.slice(end)
  if (before.length > 0 && /\s$/.test(before) && /^\s/.test(after)) {
    after = after.replace(/^\s+/, "")
  }
  return {
    nextValue: `${before}${after}`,
    nextCursor: before.length,
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
  commands?: readonly CommandDescriptor[]
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
  commands: controlledCommands,
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
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const midTurnSendMode = useAppStore((s) => s.midTurnSendMode)
  const setMidTurnSendMode = useAppStore((s) => s.setMidTurnSendMode)
  const composerFocusNonce = useAppStore((s) => s.composerFocusNonce)
  const isWorkspaceMidTurn = mode === "workspace" && isSubmitting
  const { models, refreshModels, isRefreshing } = useModelCatalog()
  const { modes } = usePermissionModes()
  const capabilitiesQuery = useCapabilities(activeSessionId)
  const persisted = usePersistedInferenceSettings(models)
  const [commandFeedback, setCommandFeedback] =
    React.useState<CommandFeedbackState | null>(null)
  const liveCommands = React.useMemo<readonly CommandDescriptor[]>(
    () => controlledCommands ?? capabilitiesQuery.data?.commands ?? [],
    [capabilitiesQuery.data?.commands, controlledCommands]
  )

  React.useEffect(() => {
    if (commandFeedback?.status !== "success") return
    const timer = window.setTimeout(() => {
      setCommandFeedback(null)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [commandFeedback])

  const isTestEnv = import.meta.env?.MODE === "test"
  const [internalValue, setInternalValue] = React.useState("")
  const [internalProject, setInternalProject] = React.useState(
    isTestEnv ? DEFAULT_PROJECT : ""
  )
  const [internalCheckout, setInternalCheckout] =
    React.useState(DEFAULT_CHECKOUT)
  const userPickedCheckoutRef = React.useRef<string | null>(null)
  const [branchOptions, setBranchOptions] = React.useState<string[]>([
    "feat/desktop-ui",
    "main",
    "prototype-ui",
  ])
  const [workspaceOptions, setWorkspaceOptions] = React.useState<
    Array<{ name: string; path?: string }>
  >(() => (isTestEnv ? HOME_PROJECTS.map((name) => ({ name })) : []))
  const [slashOpen, setSlashOpen] = React.useState(false)
  const [cursorPos, setCursorPos] = React.useState<number | null>(null)
  const [pendingCaret, setPendingCaret] = React.useState<{
    pos: number
    seq: number
  } | null>(null)
  const [slashHighlightIndex, setSlashHighlightIndex] = React.useState(0)
  const [plusMenuView, setPlusMenuView] = React.useState<"add" | "slash" | "mention">("add")
  const [slashTipOpen, setSlashTipOpen] = React.useState(false)
  const [projectOpen, setProjectOpen] = React.useState(false)
  const [checkoutOpen, setCheckoutOpen] = React.useState(false)
  const [sketchOpen, setSketchOpen] = React.useState(false)
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const [skillTokens, setSkillTokens] = React.useState<ActiveSkillToken[]>([])
  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const dragDepthRef = React.useRef(0)

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
    enabled: !isTestEnv || slashOpen,
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
      ipcClient.workspace.listBranches(),
    ]).then(([info, recent, branchData]) => {
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
      if (branchData?.branches?.length) {
        setBranchOptions(branchData.branches)
      }

      if (activeWorkspacePath) {
        const matched = seen.get(activeWorkspacePath)
        const name =
          matched?.name ??
          activeWorkspacePath.split(/[\\/]/).filter(Boolean).pop() ??
          ""
        if (!controlledProject && name) {
          setInternalProject(name)
        }
        const liveBranch = branchData?.current || info?.branch
        if (
          liveBranch &&
          !controlledCheckout &&
          !userPickedCheckoutRef.current
        ) {
          setInternalCheckout(liveBranch)
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

  React.useEffect(() => {
    if (composerFocusNonce === 0 || mode !== "workspace") return
    const el = localTextareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [composerFocusNonce, mode])

  const textValue = controlledValue ?? internalValue
  const activeProject = controlledProject ?? internalProject
  const hasSelectedProject = activeProject.trim().length > 0
  const activeCheckout = controlledCheckout ?? internalCheckout
  const activeModelId = controlledModelId ?? persisted.modelId
  const activeModelLabel = controlledModelLabel ?? persisted.modelLabel
  const activeEffort = controlledEffort ?? persisted.effort
  const activePermissionMode =
    controlledPermissionMode ?? persisted.permissionMode

  const hasPromptContent =
    textValue.trim().length > 0 ||
    attachments.length > 0 ||
    skillTokens.length > 0

  const effectivePlaceholder = React.useMemo(() => {
    if (skillTokens.length > 0) return ""
    if (isWorkspaceMidTurn) {
      return midTurnSendMode === "steer"
        ? "Steer without interrupting... (Enter to steer, Alt+Enter to queue)"
        : "Queue follow-up for after response... (Enter to queue, Alt+Enter to steer)"
    }
    if (placeholder) return placeholder
    if (activePermissionMode === "plan") {
      return "Describe your task to generate a plan..."
    }
    return "Ask anything, @ to mention, / for actions"
  }, [
    activePermissionMode,
    isWorkspaceMidTurn,
    midTurnSendMode,
    placeholder,
    skillTokens.length,
  ])

  const effectiveCursor =
    cursorPos === null ? textValue.length : clampCursorIndex(textValue, cursorPos)

  const activeSlashTrigger = React.useMemo(
    () => getActiveSlashTrigger(textValue, effectiveCursor),
    [effectiveCursor, textValue]
  )

  const activeSlashQuery = (activeSlashTrigger?.query ?? "").trim().toLowerCase()

  const { engineSlashItems, skillSlashItems, slashMenuItems } =
    React.useMemo(() => {
      const engineItems: SlashMenuItem[] = liveCommands
        .filter((cmd) => {
          if (!activeSlashQuery) return true
          return (
            cmd.name.toLowerCase().includes(activeSlashQuery) ||
            cmd.description.toLowerCase().includes(activeSlashQuery) ||
            cmd.category.toLowerCase().includes(activeSlashQuery)
          )
        })
        .map((cmd) => ({
          kind: "engine" as const,
          key: `cmd:${cmd.name}`,
          name: cmd.name,
          description: cmd.description,
          category: cmd.category,
          argHint: cmd.arg_hint,
          requiresSession: Boolean(cmd.requires_session),
          descriptor: cmd,
        }))

      const skillItems: SlashMenuItem[] = enabledLocalSkills
        .filter((skill) => {
          if (!activeSlashQuery) return true
          return (
            skill.name.toLowerCase().includes(activeSlashQuery) ||
            skill.description.toLowerCase().includes(activeSlashQuery)
          )
        })
        .map((skill) => ({
          kind: "skill" as const,
          key: `skill:${skill.id}`,
          name: skill.name,
          description: skill.description,
          skillId: skill.id,
        }))

      return {
        engineSlashItems: engineItems,
        skillSlashItems: skillItems,
        slashMenuItems: [...engineItems, ...skillItems],
      }
    }, [activeSlashQuery, enabledLocalSkills, liveCommands])

  const clampedSlashHighlightIndex =
    slashMenuItems.length > 0
      ? Math.min(slashHighlightIndex, slashMenuItems.length - 1)
      : 0

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
      // Persists locally, then syncs to the Rust core engine for the active session
      // (reverts + toast.error when the daemon rejects the mode)
      persisted.setPermissionMode(nextMode, (previousMode) => {
        onPermissionModeChange?.(previousMode)
      })
      onPermissionModeChange?.(nextMode)
    },
    [onPermissionModeChange, persisted]
  )

  const handleProjectSelect = (nextProject: string, nextPath?: string) => {
    userPickedCheckoutRef.current = null
    setInternalProject(nextProject)
    if (!nextProject) {
      setActiveWorkspacePath(null)
    } else if (nextPath) {
      setActiveWorkspacePath(nextPath)
      void ipcClient.workspace.setPath(nextPath).then(async (info) => {
        if (info?.branch && !controlledCheckout) {
          setInternalCheckout(info.branch)
        }
        const branchData = await ipcClient.workspace.listBranches()
        if (branchData?.branches?.length) {
          setBranchOptions(branchData.branches)
          if (branchData.current && !controlledCheckout) {
            setInternalCheckout(branchData.current)
          }
        }
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

  const attachDroppedOrPastedFiles = React.useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const imageCandidates: File[] = []
    const otherFiles: File[] = []
    for (const file of files) {
      if (inferImageMediaType(file) !== null) {
        imageCandidates.push(file)
      } else {
        otherFiles.push(file)
      }
    }

    const readImages = (
      await Promise.all(imageCandidates.map((file) => readImageFileAsAttachment(file)))
    ).filter((att): att is ComposerAttachment => att !== null)

    let addedImageCount = 0
    let addedFileCount = 0
    let skippedLimit = false

    setAttachments((prev) => {
      const next = [...prev]
      let currentImages = next.filter((a) => a.kind === "image").length

      for (const img of readImages) {
        if (currentImages >= MAX_ATTACHED_IMAGES) {
          skippedLimit = true
          break
        }
        next.push(img)
        currentImages += 1
        addedImageCount += 1
      }

      for (const file of otherFiles) {
        const filePath = (file as File & { path?: string }).path ?? file.name
        if (next.some((a) => a.path === filePath)) continue
        next.push({
          id: `drop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: "file",
          name: file.name || "file",
          path: filePath,
        })
        addedFileCount += 1
      }

      return next
    })

    if (skippedLimit) {
      toast.error(`You can attach up to ${MAX_ATTACHED_IMAGES} images per turn`)
    }
    const totalAdded = addedImageCount + addedFileCount
    if (totalAdded > 0) {
      if (addedImageCount > 0 && addedFileCount === 0) {
        toast(
          addedImageCount === 1
            ? `Attached image (${readImages[0]?.name ?? "image"})`
            : `Attached ${addedImageCount} images`
        )
      } else {
        toast(`Attached ${totalAdded} item${totalAdded === 1 ? "" : "s"}`)
      }
      localTextareaRef.current?.focus()
    }
  }, [])

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboard = event.clipboardData
      if (!clipboard) return

      const imageFiles: File[] = []
      if (clipboard.items && clipboard.items.length > 0) {
        for (const item of Array.from(clipboard.items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile()
            if (file) imageFiles.push(file)
          }
        }
      }
      if (imageFiles.length === 0 && clipboard.files && clipboard.files.length > 0) {
        for (const file of Array.from(clipboard.files)) {
          if (inferImageMediaType(file) !== null) {
            imageFiles.push(file)
          }
        }
      }

      if (imageFiles.length === 0) return

      const plainText = clipboard.getData("text/plain")
      if (!plainText) {
        event.preventDefault()
      }
      void attachDroppedOrPastedFiles(imageFiles)
    },
    [attachDroppedOrPastedFiles]
  )

  const handleDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types?.includes("Files")) return
      event.preventDefault()
      dragDepthRef.current += 1
      setIsDraggingOver(true)
    },
    []
  )

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types?.includes("Files")) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
    },
    []
  )

  const handleDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types?.includes("Files")) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) {
        setIsDraggingOver(false)
      }
    },
    []
  )

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer?.files ?? [])
      dragDepthRef.current = 0
      setIsDraggingOver(false)
      if (files.length === 0) return
      event.preventDefault()
      void attachDroppedOrPastedFiles(files)
    },
    [attachDroppedOrPastedFiles]
  )

  const handleAttachFiles = async () => {
    setSlashOpen(false)
    const picked = await ipcClient.workspace.pickFiles()
    if (picked.length === 0) return
    setAttachments((prev) => {
      const next = [...prev]
      for (const item of picked) {
        if (next.some((a) => a.path === item.path)) continue
        if (item.dataUrl) {
          next.push({
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            kind: "image",
            name: item.name,
            path: item.path,
            dataUrl: item.dataUrl,
            mediaType: item.mediaType,
          })
        } else {
          next.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            kind: item.isDirectory ? "folder" : "file",
            name: item.name,
            path: item.path,
          })
        }
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
        mediaType: "image/png",
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
    const branchData = await ipcClient.workspace.listBranches()
    if (branchData?.branches?.length) {
      setBranchOptions(branchData.branches)
      if (branchData.current) {
        setInternalCheckout(branchData.current)
      }
    }
    onProjectChange?.(picked.project)
    void queryClient.invalidateQueries({ queryKey: ["changes"] })
    void queryClient.invalidateQueries({ queryKey: ["inspector"] })
    void queryClient.invalidateQueries({ queryKey: ["plugins"] })
    void queryClient.invalidateQueries({ queryKey: ["sessions"] })
    void queryClient.invalidateQueries({ queryKey: ["workspace", "files"] })
    toast(`Opened workspace: ${picked.project}`)
  }

  const handleCheckoutSelect = async (nextCheckout: string) => {
    userPickedCheckoutRef.current = nextCheckout
    setInternalCheckout(nextCheckout)
    onCheckoutChange?.(nextCheckout)
    setCheckoutOpen(false)
    if (!isTestEnv) {
      const res = await ipcClient.workspace.checkoutBranch(nextCheckout)
      if (!res.ok) {
        toast.error(res.error || `Failed to switch to ${nextCheckout}`)
        if (res.branch) {
          setInternalCheckout(res.branch)
          onCheckoutChange?.(res.branch)
        }
        return
      }
      if (res.branch) {
        userPickedCheckoutRef.current = res.branch
        setInternalCheckout(res.branch)
        onCheckoutChange?.(res.branch)
      }
      void queryClient.invalidateQueries({ queryKey: ["changes"] })
      void queryClient.invalidateQueries({ queryKey: ["inspector"] })
    }
  }

  const handleCreateWorktree = async () => {
    setCheckoutOpen(false)
    const created = await ipcClient.workspace.createWorktree(activeCheckout)
    if (!created.ok) {
      toast.error(created.error || "Could not create git worktree")
      return
    }
    userPickedCheckoutRef.current = created.branch
    setBranchOptions((prev) =>
      prev.includes(created.branch) ? prev : [created.branch, ...prev]
    )
    setInternalCheckout(created.branch)
    onCheckoutChange?.(created.branch)
    void queryClient.invalidateQueries({ queryKey: ["changes"] })
    void queryClient.invalidateQueries({ queryKey: ["inspector"] })
    void queryClient.invalidateQueries({ queryKey: ["workspace", "files"] })
    toast(`Working in new worktree (${created.branch})`)
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

  const executeSlashInput = async (rawInput: string): Promise<boolean> => {
    const invocation = parseSlashInvocation(
      rawInput,
      liveCommands,
      enabledLocalSkills
    )
    if (
      invocation.kind === "plain_prompt" ||
      invocation.kind === "skill_prompt"
    ) {
      return false
    }

    const descriptor = liveCommands.find(
      (c) => c.name.toLowerCase() === invocation.slashName.toLowerCase()
    )
    const sid = useAppStore.getState().activeSessionId
    if (descriptor?.requires_session && !sid) {
      setCommandFeedback({
        status: "error",
        message: `/${invocation.slashName} requires an active chat session.`,
      })
      return true
    }

    setSlashOpen(false)
    setCommandFeedback({
      status: "running",
      message: `Running /${invocation.slashName}...`,
    })

    try {
      if (invocation.kind === "api_request") {
        const targetSid = sid ?? ""
        if (invocation.req === "compact") {
          const res = await ipcClient.harness.compact(targetSid)
          if (!res.ok) {
            setCommandFeedback({
              status: res.code === "busy" ? "busy" : "error",
              message:
                res.code === "busy"
                  ? "/compact is queued until the active turn finishes."
                  : (res.error ?? "Failed to compact context."),
            })
            return true
          }
          setTextValue("")
          setCommandFeedback({
            status: "success",
            message: res.message || "Context compacted",
          })
          return true
        }

        if (invocation.req === "set_reasoning_effort") {
          const effortArg = String(invocation.params.effort ?? "").trim().toLowerCase()
          if (!effortArg) {
            setCommandFeedback({
              status: "error",
              message: `Usage: /${invocation.slashName} ${descriptor?.arg_hint ?? "<effort>"}`,
            })
            return true
          }
          const res = await ipcClient.harness.setReasoningEffort(
            targetSid,
            effortArg
          )
          if (!res.ok) {
            setCommandFeedback({
              status: res.code === "busy" ? "busy" : "error",
              message:
                res.code === "busy"
                  ? "Applies on next turn"
                  : (res.error ?? `Failed to set reasoning effort to ${effortArg}.`),
            })
            return true
          }
          if (targetSid) {
            const prevInfo =
              useAppStore.getState().sessionModelInfoBySession[targetSid]
            useAppStore.getState().setSessionModelInfo(targetSid, {
              ...prevInfo,
              reasoningEffort: effortArg,
            })
          }
          setTextValue("")
          setCommandFeedback({
            status: "success",
            message: `Reasoning effort set to ${formatEffortLabel(effortArg, "header")}`,
          })
          return true
        }

        if (invocation.req === "set_model") {
          const modelArg = String(invocation.params.model ?? "").trim()
          if (!modelArg) {
            setCommandFeedback({
              status: "error",
              message: `Usage: /${invocation.slashName} ${descriptor?.arg_hint ?? "<model>"}`,
            })
            return true
          }
          const res = await ipcClient.harness.setModel(targetSid, modelArg)
          if (!res.ok) {
            setCommandFeedback({
              status: res.code === "busy" ? "busy" : "error",
              message:
                res.code === "busy"
                  ? "Applies on next turn"
                  : (res.error ?? `Failed to switch model to ${modelArg}.`),
            })
            return true
          }
          setTextValue("")
          setCommandFeedback({
            status: "success",
            message: `Model switched to ${modelArg}`,
          })
          return true
        }

        if (invocation.req === "set_permission_mode") {
          const modeArg = String(invocation.params.mode ?? "").trim()
          if (!modeArg) {
            setCommandFeedback({
              status: "error",
              message: `Usage: /${invocation.slashName} ${descriptor?.arg_hint ?? "<mode>"}`,
            })
            return true
          }
          const res = await ipcClient.harness.setPermissionMode(
            targetSid,
            modeArg as PermissionModeId
          )
          if (!res.ok) {
            setCommandFeedback({
              status: res.code === "busy" ? "busy" : "error",
              message:
                res.code === "busy"
                  ? "Applies on next turn"
                  : (res.error ?? `Failed to set permission mode to ${modeArg}.`),
            })
            return true
          }
          setTextValue("")
          setCommandFeedback({
            status: "success",
            message: `Permission mode set to ${modeArg}`,
          })
          return true
        }

        const fallbackRes = await ipcClient.harness.runtimeCommand(
          targetSid,
          invocation.slashName,
          invocation.rawArgs ? [invocation.rawArgs] : []
        )
        setTextValue("")
        setCommandFeedback({
          status: "success",
          message: fallbackRes.message || `Ran /${invocation.slashName}`,
        })
        return true
      }

      const res = await ipcClient.harness.runtimeCommand(
        sid ?? "",
        invocation.command,
        invocation.args
      )
      setTextValue("")
      setCommandFeedback({
        status: "success",
        message: res.message || `Ran /${invocation.slashName}`,
      })
      return true
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : `Failed to run /${invocation.slashName}`
      const errCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : undefined
      setCommandFeedback({
        status: errCode === "busy" ? "busy" : "error",
        message: errCode === "busy" ? "Applies on next turn" : msg,
      })
      return true
    }
  }

  const submitComposedPayload = async (
    overridePrompt?: string,
    midTurnOverride?: "steer" | "queue"
  ) => {
    if (disabled || (mode === "home" && isSubmitting)) return
    const rawCandidate = overridePrompt ?? textValue
    const trimmed = rawCandidate.trim()
    if (!trimmed && attachments.length === 0 && skillTokens.length === 0) {
      localTextareaRef.current?.focus()
      toast(
        isWorkspaceMidTurn
          ? "Type a steer or follow-up message first"
          : "Type a prompt or /command first"
      )
      return
    }

    if (
      !isWorkspaceMidTurn &&
      attachments.length === 0 &&
      skillTokens.length === 0 &&
      (await executeSlashInput(rawCandidate))
    ) {
      return
    }

    const images: PromptImageAttachment[] = attachments
      .filter(
        (a): a is ComposerAttachment & { dataUrl: string } =>
          a.kind === "image" && Boolean(a.dataUrl)
      )
      .map((a) => ({
        name: a.name,
        mediaType:
          a.mediaType ?? parseImageDataUrl(a.dataUrl)?.[0] ?? "image/png",
        dataUrl: a.dataUrl,
      }))

    const nonImageAttachments = attachments.filter(
      (a) => !(a.kind === "image" && Boolean(a.dataUrl))
    )

    const attachmentPrefix =
      nonImageAttachments.length > 0
        ? `${nonImageAttachments
            .map((a) => {
              if (a.kind === "conversation") {
                return `[Referenced RayuCode conversation: "${a.name}" (${a.sessionId ?? "session"})]`
              }
              return a.path
                ? `[Attached ${a.kind}: ${a.path}]`
                : `[Attached file: ${a.name}]`
            })
            .join("\n")}\n\n`
        : ""

    const skillPrefix =
      skillTokens.length > 0
        ? `${skillTokens.map((t) => t.command).join(" ")} `
        : ""

    const effectiveMidTurnMode = isWorkspaceMidTurn
      ? (midTurnOverride ?? midTurnSendMode)
      : undefined

    setSlashOpen(false)
    setActiveTemplateKind(null)
    setActiveClarifyingTemplate(null)
    const payload: ComposerSubmitPayload = {
      prompt: `${attachmentPrefix}${skillPrefix}${trimmed}`.trim(),
      ...(images.length > 0 ? { images } : {}),
      project: activeProject || "No Project",
      checkout: activeCheckout,
      modelId: activeModelId,
      modelLabel: activeModelLabel,
      effort: activeEffort,
      permissionMode: activePermissionMode,
      ...(effectiveMidTurnMode ? { midTurnMode: effectiveMidTurnMode } : {}),
    }

    setTextValue("")
    setAttachments([])
    setSkillTokens([])
    await onSubmit?.(payload)
  }

  const handleSend = async (midTurnOverride?: "steer" | "queue") => {
    await submitComposedPayload(undefined, midTurnOverride)
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

  React.useLayoutEffect(() => {
    if (!pendingCaret) return
    const el = localTextareaRef.current
    if (!el) return
    el.focus()
    const safePos = clampCursorIndex(el.value, pendingCaret.pos)
    el.setSelectionRange(safePos, safePos)
  }, [pendingCaret])

  const restoreCaret = (pos: number) => {
    setCursorPos(pos)
    setPendingCaret((prev) => ({ pos, seq: (prev?.seq ?? 0) + 1 }))
  }

  const handleSelectSlashItem = (
    item: SlashMenuItem,
    interaction: "click" | "tab" | "enter" = "click"
  ) => {
    if (item.kind === "engine") {
      const trigger = getActiveSlashTrigger(textValue, effectiveCursor)
      const replacement = `/${item.name} `

      if (item.requiresSession && !activeSessionId) {
        setSlashOpen(false)
        setCommandFeedback({
          status: "error",
          message: `/${item.name} requires an active chat session.`,
        })
        return
      }

      // Dispatch immediately on Enter/click if the command takes no required args
      if (
        interaction !== "tab" &&
        !item.argHint &&
        (!trigger ||
          (textValue.slice(0, trigger.slashIndex).trim() === "" &&
            textValue.slice(trigger.endIndex).trim() === ""))
      ) {
        setSlashOpen(false)
        void executeSlashInput(`/${item.name}`)
        return
      }

      if (trigger) {
        const before = textValue.slice(0, trigger.slashIndex)
        const after = textValue.slice(trigger.endIndex)
        const nextValue = `${before}${replacement}${after}`
        setTextValue(nextValue)
        restoreCaret(before.length + replacement.length)
      } else {
        setTextValue(replacement)
        restoreCaret(replacement.length)
      }
      setSlashOpen(false)
      return
    }

    addSkillToken({
      id: item.skillId,
      label: item.name,
      command: `/${item.name}`,
      icon: "skill",
    })

    const trigger = getActiveSlashTrigger(textValue, effectiveCursor)
    if (trigger) {
      const { nextValue, nextCursor } = stripSlashRange(
        textValue,
        trigger.slashIndex,
        trigger.endIndex
      )
      setTextValue(nextValue)
      restoreCaret(nextCursor)
    } else {
      restoreCaret(effectiveCursor)
    }
    setSlashOpen(false)
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value
    const cursor = resolveTextareaCursor(event.target, next.length)
    if (commandFeedback && commandFeedback.status === "success") {
      setCommandFeedback(null)
    }

    // Auto-convert typed local `/skill ` on trailing space into clean inline skill tokens
    const completedMatch = matchCompletedSlashToken(next, cursor)
    if (completedMatch) {
      const cmdName = completedMatch.commandName.toLowerCase()
      const knownSkill = enabledLocalSkills.find(
        (s) => s.name.toLowerCase() === cmdName
      )
      if (knownSkill) {
        addSkillToken({
          id: knownSkill.id,
          label: knownSkill.name,
          command: `/${knownSkill.name}`,
          icon: "skill",
        })
        const { nextValue, nextCursor } = stripSlashRange(
          next,
          completedMatch.tokenStart,
          completedMatch.tokenEnd
        )
        setTextValue(nextValue)
        setSlashOpen(false)
        restoreCaret(nextCursor)
        return
      }
    }

    setTextValue(next)
    setCursorPos(cursor)

    if (getActiveSlashTrigger(next, cursor)) {
      setPlusMenuView("slash")
      setSlashHighlightIndex(0)
      setSlashOpen(true)
    } else if (/(?:^|\s)@[^\s]*$/.test(next.slice(0, cursor))) {
      setPlusMenuView("mention")
      setSlashOpen(true)
    } else if (plusMenuView === "slash" || plusMenuView === "mention") {
      setSlashOpen(false)
    }
  }

  const syncTextareaCursor = (target: HTMLTextAreaElement) => {
    const cursor = resolveTextareaCursor(target, target.value.length)
    setCursorPos(cursor)
    if (
      slashOpen &&
      plusMenuView === "slash" &&
      !getActiveSlashTrigger(target.value, cursor)
    ) {
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
    if (slashOpen && plusMenuView === "slash" && slashMenuItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSlashHighlightIndex(
          (clampedSlashHighlightIndex + 1) % slashMenuItems.length
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSlashHighlightIndex(
          (clampedSlashHighlightIndex - 1 + slashMenuItems.length) %
            slashMenuItems.length
        )
        return
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        const selected = slashMenuItems[clampedSlashHighlightIndex]
        if (selected) {
          event.preventDefault()
          handleSelectSlashItem(
            selected,
            event.key === "Tab" ? "tab" : "enter"
          )
          return
        }
      }
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
      if (isWorkspaceMidTurn) {
        const targetMode: "steer" | "queue" = event.altKey
          ? midTurnSendMode === "steer"
            ? "queue"
            : "steer"
          : midTurnSendMode
        void handleSend(targetMode)
      } else {
        void handleSend()
      }
    }
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div
        data-testid="session-composer-dock"
        data-composer-mode={mode}
        className={cn(
          "@container/dock flex w-full shrink-0 flex-col items-center px-3 @min-[480px]/dock:px-6",
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
          className="rayu-card-bevel @container/composer relative w-full max-w-[732px] overflow-hidden rounded-[22px] bg-shell p-[5px] focus:shadow-none focus:outline-none"
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
                        className="size-[13px] text-muted-ink"
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
                          className="size-3.5 shrink-0 text-muted-ink"
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
                <Popover
                  open={checkoutOpen}
                  onOpenChange={(open) => {
                    setCheckoutOpen(open)
                    if (open && !isTestEnv) {
                      void ipcClient.workspace.listBranches().then((data) => {
                        if (data?.branches?.length) {
                          setBranchOptions(data.branches)
                        }
                      })
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="composer-checkout-trigger"
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-[3px] text-xs font-normal text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-body focus:outline-none"
                    >
                      <GitBranch
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
                    className="rayu-card-bevel w-64 rounded-2xl border border-premium-hi bg-popover-solid p-1.5 shadow-rayu-2"
                  >
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-ink">
                      <Folder
                        className="size-3.5 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                      <span className="truncate">{activeProject}</span>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {Array.from(
                        new Set(
                          activeCheckout &&
                            activeCheckout !== DEFAULT_CHECKOUT &&
                            !branchOptions.includes(activeCheckout)
                            ? [activeCheckout, ...branchOptions]
                            : branchOptions
                        )
                      ).map((branchName) => {
                        const isSelected = branchName === activeCheckout
                        return (
                          <button
                            key={branchName}
                            type="button"
                            onClick={() => void handleCheckoutSelect(branchName)}
                            className={cn(
                              "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-hover",
                              isSelected
                                ? "font-medium text-ink"
                                : "text-body hover:text-ink"
                            )}
                          >
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <GitBranch
                                className="size-3.5 shrink-0 text-muted-ink"
                                aria-hidden="true"
                              />
                              <span className="truncate">{branchName}</span>
                            </span>
                            {isSelected ? (
                              <Check
                                className="size-3.5 shrink-0 text-ink"
                                aria-hidden="true"
                              />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                    <div className="my-1 h-px bg-hairline" />
                    <button
                      type="button"
                      data-testid="composer-new-worktree-btn"
                      onClick={() => void handleCreateWorktree()}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                    >
                      <GitFork
                        className="size-3.5 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[12.5px] leading-tight font-medium text-ink">
                          Work in a New Worktree
                        </span>
                        <span className="mt-0.5 text-[11px] leading-tight text-muted-ink">
                          Keeps your checkout untouched
                        </span>
                      </span>
                    </button>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          ) : null}

          {/* Inline Command Feedback Banner (Anchored cleanly above composer-inner) */}
          {commandFeedback ? (
            <div
              role={commandFeedback.status === "error" ? "alert" : "status"}
              data-testid="composer-command-feedback"
              data-feedback-status={commandFeedback.status}
              className={cn(
                "mb-1.5 flex items-center justify-between gap-2 rounded-[10px] border px-3 py-1.5 text-xs",
                commandFeedback.status === "running" &&
                  "border-hairline bg-pane text-body",
                commandFeedback.status === "success" &&
                  "border-brand/30 bg-brand-soft text-ink",
                commandFeedback.status === "busy" &&
                  "border-warn/30 bg-warn-soft text-warn",
                commandFeedback.status === "error" &&
                  "border-danger/30 bg-danger-soft text-danger"
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {commandFeedback.status === "running" ? (
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin text-brand-text"
                    aria-hidden="true"
                  />
                ) : commandFeedback.status === "success" ? (
                  <Check
                    className="size-3.5 shrink-0 text-brand-text"
                    aria-hidden="true"
                  />
                ) : commandFeedback.status === "busy" ? (
                  <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertCircle
                    className="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{commandFeedback.message}</span>
              </span>
              {commandFeedback.status === "error" ||
              commandFeedback.status === "busy" ? (
                <button
                  type="button"
                  aria-label="Dismiss command error"
                  onClick={() => setCommandFeedback(null)}
                  className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-current opacity-80 transition-opacity hover:opacity-100"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Inner Elevated Composer Surface */}
          <div
            data-testid="composer-inner"
            data-dragging={isDraggingOver ? "true" : "false"}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "relative flex flex-col rounded-[17px] border border-premium-hi bg-raised shadow-rayu-1 transition-colors focus-within:ring-0 focus-within:outline-none",
              isDraggingOver && "border-brand bg-brand-softer/25"
            )}
          >
            {isDraggingOver ? (
              <div
                data-testid="composer-drop-overlay"
                className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[17px] bg-raised/75 backdrop-blur-[1px]"
              >
                <span className="inline-flex items-center gap-2 rounded-full border border-brand bg-popover-solid px-3.5 py-1.5 text-xs font-medium text-brand-text shadow-rayu-1">
                  <Paperclip className="size-3.5" aria-hidden="true" />
                  <span>Drop images or files to attach</span>
                </span>
              </div>
            ) : null}

            {/* Mid-Turn Steer / Queue Mode Bar (shown in workspace while AI responds) */}
            {isWorkspaceMidTurn ? (
              <div
                data-testid="composer-midturn-bar"
                className="flex min-w-0 items-center justify-between gap-2 border-b border-hairline-soft px-3.5 py-1.5"
              >
                <span className="min-w-0 truncate text-[11px] text-muted-ink @max-[360px]/composer:hidden">
                  {midTurnSendMode === "steer"
                    ? "Auto-sends at next safe step"
                    : "Waits until response finishes"}
                </span>
                <div
                  role="group"
                  aria-label="Mid-turn send mode"
                  data-testid="midturn-mode-toggle"
                  className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-hairline bg-inset p-0.5"
                >
                  <button
                    type="button"
                    data-testid="midturn-mode-steer"
                    aria-pressed={midTurnSendMode === "steer"}
                    onClick={() => setMidTurnSendMode("steer")}
                    className={cn(
                      "cursor-pointer rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-all focus:outline-none",
                      midTurnSendMode === "steer"
                        ? "bg-active text-ink shadow-bevel-surface"
                        : "text-muted-ink hover:text-ink"
                    )}
                  >
                    Steer
                  </button>
                  <button
                    type="button"
                    data-testid="midturn-mode-queue"
                    aria-pressed={midTurnSendMode === "queue"}
                    onClick={() => setMidTurnSendMode("queue")}
                    className={cn(
                      "cursor-pointer rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-all focus:outline-none",
                      midTurnSendMode === "queue"
                        ? "bg-active text-ink shadow-bevel-surface"
                        : "text-muted-ink hover:text-ink"
                    )}
                  >
                    Queue
                  </button>
                </div>
              </div>
            ) : null}

            {attachments.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
                {attachments.map((att) =>
                  att.kind === "image" && att.dataUrl ? (
                    <div
                      key={att.id}
                      data-testid="composer-image-attachment"
                      title={att.name}
                      className="group relative size-12 shrink-0 overflow-hidden rounded-lg border border-hairline bg-inset shadow-bevel-surface"
                    >
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        className="size-full object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${att.name}`}
                        onClick={() => handleRemoveAttachment(att.id)}
                        className="absolute top-0.5 right-0.5 grid size-4 cursor-pointer place-items-center rounded-full bg-popover-solid/90 text-ink transition-colors hover:bg-hover"
                      >
                        <X className="size-2.5" aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <span
                      key={att.id}
                      className="inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border border-hairline bg-inset px-2 py-1 text-xs text-ink"
                    >
                      {att.kind === "folder" ? (
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
                  )
                )}
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
                    "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-[15px] leading-[1.5] font-medium tracking-[-0.01em] transition-colors hover:bg-hover",
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
                disabled={disabled || (mode === "home" && isSubmitting)}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                onKeyUp={(e) => syncTextareaCursor(e.currentTarget)}
                onClick={(e) => syncTextareaCursor(e.currentTarget)}
                onSelect={(e) => syncTextareaCursor(e.currentTarget)}
                onPaste={handlePaste}
                placeholder={effectivePlaceholder}
                aria-label={
                  mode === "home" ? "Message RayuCode" : "Reply to RayuCode"
                }
                className="block max-h-[180px] min-h-[26px] min-w-[140px] flex-1 resize-none border-none bg-transparent p-0 text-[15px] leading-[1.5] text-ink placeholder:text-muted-ink focus:ring-0 focus:shadow-none focus:outline-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-60"
              />
            </div>

            <div className="flex min-w-0 items-center gap-1 px-2.5 pt-1.5 pb-[11px] @min-[420px]/composer:gap-1.5 @min-[420px]/composer:px-3">
              {/* Left + Codex-style Add, Plugins, Apps, Conversations & @ Mention Trigger */}
              <Popover
                open={slashOpen}
                onOpenChange={(open) => {
                  if (open) {
                    if (getActiveSlashTrigger(textValue, effectiveCursor)) {
                      setPlusMenuView("slash")
                    } else if (
                      /(?:^|\s)@[^\s]*$/.test(textValue.slice(0, effectiveCursor))
                    ) {
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
                          if (!getActiveSlashTrigger(textValue, effectiveCursor)) {
                            setPlusMenuView("add")
                          }
                        }}
                        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border border-transparent text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none data-[state=open]:border-hairline data-[state=open]:bg-active data-[state=open]:text-ink"
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
                      ? "w-[min(560px,calc(100vw-48px))] rounded-[14px] p-1.5"
                      : "w-[min(720px,calc(100vw-48px))] rounded-[18px] p-2"
                  )}
                >
                  {plusMenuView === "slash" ? (
                    <>
                      <div
                        data-testid="composer-slash-menu"
                        className="flex max-h-[300px] flex-col overflow-y-auto"
                      >
                        {slashMenuItems.length > 0 ? (
                          <>
                            {engineSlashItems.length > 0 ? (
                              <div data-testid="slash-group-engine">
                                <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-muted-ink uppercase">
                                  Engine Commands
                                </div>
                                {engineSlashItems.map((item, idx) => {
                                  if (item.kind !== "engine") return null
                                  const isHighlighted =
                                    idx === clampedSlashHighlightIndex
                                  const needsSession =
                                    item.requiresSession && !activeSessionId
                                  return (
                                    <button
                                      key={item.key}
                                      type="button"
                                      data-active={
                                        isHighlighted ? "true" : "false"
                                      }
                                      aria-current={
                                        isHighlighted ? "true" : undefined
                                      }
                                      onMouseEnter={() =>
                                        setSlashHighlightIndex(idx)
                                      }
                                      onClick={() =>
                                        handleSelectSlashItem(item, "click")
                                      }
                                      className={cn(
                                        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                                        isHighlighted
                                          ? "bg-active"
                                          : "hover:bg-hover",
                                        needsSession && "opacity-50"
                                      )}
                                    >
                                      <Terminal
                                        className={cn(
                                          "size-3.5 shrink-0",
                                          isHighlighted
                                            ? "text-code-kw"
                                            : "text-muted-ink"
                                        )}
                                        aria-hidden="true"
                                      />
                                      <span className="shrink-0 font-mono text-xs font-medium text-ink">
                                        /{item.name}
                                      </span>
                                      {item.argHint ? (
                                        <span className="shrink-0 font-mono text-[11px] text-faint">
                                          {item.argHint}
                                        </span>
                                      ) : null}
                                      <span className="min-w-0 flex-1 truncate text-xs text-muted-ink">
                                        {item.description}
                                      </span>
                                      {needsSession ? (
                                        <span className="shrink-0 text-[10px] text-faint">
                                          Needs chat
                                        </span>
                                      ) : null}
                                      <Badge
                                        variant="outline"
                                        className="shrink-0 px-1.5 py-0 text-[10px]"
                                      >
                                        {item.category}
                                      </Badge>
                                    </button>
                                  )
                                })}
                              </div>
                            ) : null}

                            {engineSlashItems.length > 0 &&
                            skillSlashItems.length > 0 ? (
                              <Separator className="my-1 bg-hairline-soft" />
                            ) : null}

                            {skillSlashItems.length > 0 ? (
                              <div data-testid="slash-group-skills">
                                <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-muted-ink uppercase">
                                  Skills
                                </div>
                                {skillSlashItems.map((item, skillIdx) => {
                                  if (item.kind !== "skill") return null
                                  const flatIdx =
                                    engineSlashItems.length + skillIdx
                                  const isHighlighted =
                                    flatIdx === clampedSlashHighlightIndex
                                  return (
                                    <button
                                      key={item.key}
                                      type="button"
                                      data-active={
                                        isHighlighted ? "true" : "false"
                                      }
                                      aria-current={
                                        isHighlighted ? "true" : undefined
                                      }
                                      onMouseEnter={() =>
                                        setSlashHighlightIndex(flatIdx)
                                      }
                                      onClick={() =>
                                        handleSelectSlashItem(item, "click")
                                      }
                                      className={cn(
                                        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                                        isHighlighted
                                          ? "bg-active"
                                          : "hover:bg-hover"
                                      )}
                                    >
                                      <Sparkles
                                        className="size-3.5 shrink-0 text-code-type"
                                        aria-hidden="true"
                                      />
                                      <span className="shrink-0 font-mono text-xs font-medium text-ink">
                                        /{item.name}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-xs text-muted-ink">
                                        {item.description}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className="shrink-0 px-1.5 py-0 text-[10px]"
                                      >
                                        skill
                                      </Badge>
                                    </button>
                                  )
                                })}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="px-3 py-3 text-center text-xs text-muted-ink">
                            {activeSlashQuery
                              ? `No matching commands or skills for "/${activeSlashQuery}"`
                              : "No matching commands or skills"}
                          </div>
                        )}
                      </div>
                      <div className="mt-1 border-t border-hairline-soft px-2.5 pt-1.5 pb-0.5 font-mono text-[10px] text-faint">
                        ↑↓ navigate · Tab complete · Enter run · Esc
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

              {/* 2-Stage Model & Reasoning Effort Popover */}
              <ModelEffortPopover
                modelId={activeModelId}
                modelLabel={activeModelLabel}
                effort={activeEffort}
                models={models}
                onSelectModel={handleModelSelect}
                onSelectEffort={handleEffortSelect}
                onRefreshModels={refreshModels}
                isRefreshing={isRefreshing}
                deferredNotice={persisted.deferredNotice}
                disabled={disabled}
              />

              {persisted.deferredNotice ? (
                <Badge
                  variant="warn"
                  data-testid="composer-deferred-badge"
                  className="shrink-0"
                >
                  <Clock className="size-3" aria-hidden="true" />
                  <span>{persisted.deferredNotice}</span>
                </Badge>
              ) : null}

              <span className="flex-1" />

              {/* 5 Local Permission Modes Popover (Shift+Tab cycle) */}
              <PermissionPopover
                value={activePermissionMode}
                onChange={handlePermissionSelect}
                modes={modes}
                disabled={disabled}
              />

              {/* Primary Send Orb OR Mid-Turn Stop + Steer/Queue Controls */}
              {isWorkspaceMidTurn ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Abort active turn"
                        data-testid="composer-stop-btn"
                        onClick={() => {
                          onStop?.()
                          toast("Stopped active generation")
                        }}
                        className="ml-0.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-premium bg-active text-ink shadow-bevel-surface transition-colors hover:border-danger hover:bg-danger-soft hover:text-danger focus:outline-none"
                      >
                        <Square
                          className="size-3.5 fill-current"
                          aria-hidden="true"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Stop / Abort</TooltipContent>
                  </Tooltip>

                  {midTurnSendMode === "steer" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-testid="composer-steer-btn"
                          aria-label="Steer active turn without interrupting"
                          disabled={disabled || !hasPromptContent}
                          onClick={() => void handleSend("steer")}
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full transition-all focus:outline-none",
                            hasPromptContent && !disabled
                              ? "rayu-primary-bevel cursor-pointer bg-brand text-brand-ink hover:scale-[1.04] hover:bg-brand-bright active:scale-[0.98]"
                              : "cursor-not-allowed border border-hairline bg-inset text-faint opacity-60"
                          )}
                        >
                          <CornerDownLeft
                            className="size-[15px]"
                            strokeWidth={2.2}
                            aria-hidden="true"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Steer without interrupting (Enter · Alt+Enter to queue)
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-testid="composer-queue-btn"
                          aria-label="Queue message for after response"
                          disabled={disabled || !hasPromptContent}
                          onClick={() => void handleSend("queue")}
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full transition-all focus:outline-none",
                            hasPromptContent && !disabled
                              ? "cursor-pointer border border-premium bg-active text-ink shadow-bevel-surface hover:border-brand hover:bg-brand-soft hover:text-brand-text active:scale-95"
                              : "cursor-not-allowed border border-hairline bg-inset text-faint opacity-60"
                          )}
                        >
                          <ListPlus
                            className="size-4"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Queue for after response (Enter · Alt+Enter to steer)
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              ) : isSubmitting ? (
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
                      className="rayu-primary-bevel ml-0.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-brand-ink transition-all outline-none hover:scale-[1.04] hover:bg-brand-bright focus:outline-none active:scale-[0.98]"
                    >
                      <span
                        aria-hidden="true"
                        className="block size-2.5 rounded-[2px] bg-brand-ink"
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
              mediaType: "image/png",
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
