import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  ListCollapse,
  ListTree,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  WrapText,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ContextSkeleton } from "@/components/ui/page-skeletons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TechFileBadge } from "@/components/ui/tech-file-badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { tokenizeCodeLine } from "@/lib/file-icon-theme"
import { cn } from "@/lib/utils"

import {
  fetchWorkspaceFiles,
  inspectorKeys,
  openFileInVSCode,
} from "../api/inspector-api"
import {
  useCodeFile,
  useInspectorChanges,
  useInspectorState,
} from "../hooks/use-context-stats"

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  gitStatus?: "M" | "A" | "D"
  hasModifiedChild?: boolean
  hasAddedChild?: boolean
}

function buildFileTree(
  filePaths: string[],
  statusMap: Map<string, "M" | "A" | "D">
): TreeNode[] {
  const root: TreeNode[] = []
  const dirMap = new Map<string, TreeNode>()

  const getOrCreateDir = (dirPath: string): TreeNode => {
    const existing = dirMap.get(dirPath)
    if (existing) return existing

    const parts = dirPath.split("/")
    const name = parts[parts.length - 1]
    const node: TreeNode = {
      name,
      path: dirPath,
      isDir: true,
      children: [],
    }
    dirMap.set(dirPath, node)

    if (parts.length === 1) {
      root.push(node)
    } else {
      const parent = getOrCreateDir(parts.slice(0, -1).join("/"))
      parent.children.push(node)
    }
    return node
  }

  for (const rawPath of filePaths) {
    const clean = rawPath.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!clean) continue
    const parts = clean.split("/")
    const name = parts[parts.length - 1]
    const status = statusMap.get(clean)
    const fileNode: TreeNode = {
      name,
      path: clean,
      isDir: false,
      children: [],
      gitStatus: status,
    }

    if (parts.length === 1) {
      root.push(fileNode)
    } else {
      const parent = getOrCreateDir(parts.slice(0, -1).join("/"))
      parent.children.push(fileNode)
    }
  }

  const annotateAndSort = (nodes: TreeNode[]): { mod: boolean; add: boolean } => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    let anyMod = false
    let anyAdd = false
    for (const node of nodes) {
      if (node.isDir) {
        const res = annotateAndSort(node.children)
        node.hasModifiedChild = res.mod
        node.hasAddedChild = res.add
        if (res.mod) anyMod = true
        if (res.add) anyAdd = true
      } else {
        if (node.gitStatus === "M" || node.gitStatus === "D") anyMod = true
        if (node.gitStatus === "A") anyAdd = true
      }
    }
    return { mod: anyMod, add: anyAdd }
  }

  annotateAndSort(root)
  return root
}

function InlineFilePreview({ filePath }: { filePath: string }) {
  const { data: fileData, isLoading, isError } = useCodeFile(filePath)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setPendingStreamPrompt = useAppStore((s) => s.setPendingStreamPrompt)
  const [copiedPath, setCopiedPath] = React.useState(false)
  const [wordWrap, setWordWrap] = React.useState(false)
  const [commentLine, setCommentLine] = React.useState<{
    lineNum: number
    lineText: string
  } | null>(null)
  const [commentDraft, setCommentDraft] = React.useState("")

  if (isLoading) {
    return <ContextSkeleton />
  }

  if (isError || !fileData) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileText className="size-5 text-muted-ink" strokeWidth={1.5} />
        <p className="text-xs font-medium text-ink">{filePath}</p>
        <p className="text-[11.5px] text-muted-ink">
          Unable to read file contents in this environment.
        </p>
      </div>
    )
  }

  const handleCopyPath = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fileData.path)
      }
      setCopiedPath(true)
      toast(`Copied path: ${fileData.path}`)
      window.setTimeout(() => setCopiedPath(false), 1400)
    } catch {
      toast(`Path: ${fileData.path}`)
    }
  }

  const handleSendLineComment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!commentLine || !commentDraft.trim()) return
    const prompt = `In \`${fileData.path}:${commentLine.lineNum}\`:\n> ${commentLine.lineText.trim()}\n\n${commentDraft.trim()}`
    if (activeSessionId) {
      setPendingStreamPrompt({
        sessionId: activeSessionId,
        prompt,
        modelLabel: "Auto",
      })
      toast(`Sent note for ${fileData.pill}:${commentLine.lineNum} to chat`)
    } else if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(prompt)
      toast(`Copied note for ${fileData.pill}:${commentLine.lineNum}`)
    }
    setCommentDraft("")
    setCommentLine(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hairline-soft bg-canvas px-3.5 text-[12px] text-muted-ink">
        <TechFileBadge path={fileData.path} />
        <span className="min-w-0 flex-1 truncate font-mono text-body">
          {fileData.path}
        </span>
        <button
          type="button"
          aria-label="Toggle word wrap"
          aria-pressed={wordWrap}
          onClick={() => setWordWrap((prev) => !prev)}
          className={cn(
            "grid size-6 cursor-pointer place-items-center rounded transition-colors",
            wordWrap
              ? "bg-active text-ink"
              : "text-muted-ink hover:bg-hover hover:text-ink"
          )}
        >
          <WrapText className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Copy file path"
          onClick={() => void handleCopyPath()}
          className="grid size-6 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
        >
          {copiedPath ? (
            <Check className="size-3 text-brand-text" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
        <button
          type="button"
          aria-label="Open in VS Code"
          onClick={() => {
            void openFileInVSCode(fileData.path, 1)
            toast(`Opened ${fileData.pill} in Visual Studio Code`)
          }}
          className="grid size-6 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
        >
          <ExternalLink className="size-3" />
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="py-2 pb-8 font-mono text-[12.5px] leading-[1.68]">
          {fileData.lines.map((line, index) => {
            const lineNum = fileData.startLine + index
            const tokens = tokenizeCodeLine(line)
            const isCommentOpen = commentLine?.lineNum === lineNum
            return (
              <React.Fragment key={`${fileData.path}-${lineNum}`}>
                <div className="group relative grid grid-cols-[44px_minmax(0,1fr)] transition-colors hover:bg-hover/60">
                  <div className="relative flex items-start justify-end pr-3 pl-1 select-none">
                    <span className="text-[11.5px] text-faint tabular-nums">
                      {lineNum}
                    </span>
                    <button
                      type="button"
                      aria-label={`Ask about line ${lineNum}`}
                      onClick={() =>
                        setCommentLine({ lineNum, lineText: line })
                      }
                      className="absolute top-0.5 right-1 grid size-[18px] cursor-pointer place-items-center rounded-[4px] bg-ink text-canvas opacity-0 shadow-rayu-1 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    >
                      <Plus className="size-3" strokeWidth={2.5} />
                    </button>
                  </div>
                  <div
                    className={cn(
                      "pr-4 pl-2",
                      wordWrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"
                    )}
                  >
                    {tokens.map((tok, tIdx) => (
                      <span key={tIdx} className={tok.className}>
                        {tok.text}
                      </span>
                    ))}
                  </div>
                </div>

                {isCommentOpen && (
                  <form
                    onSubmit={handleSendLineComment}
                    className="mx-3 my-2 flex flex-col gap-2 rounded-xl border border-premium bg-raised p-3 font-sans shadow-rayu-1"
                  >
                    <div className="flex items-center justify-between text-[11.5px] text-muted-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <MessageSquarePlus className="size-3.5 text-brand-text" />
                        <span>
                          Ask about{" "}
                          <span className="font-mono text-ink">
                            {fileData.pill}:{lineNum}
                          </span>
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label="Cancel line note"
                        onClick={() => {
                          setCommentLine(null)
                          setCommentDraft("")
                        }}
                        className="cursor-pointer text-muted-ink hover:text-ink"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <input
                      type="text"
                      autoFocus
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Ask RayuCode about this line..."
                      className="h-8 rounded-lg border border-hairline bg-inset px-2.5 text-xs text-ink outline-none placeholder:text-faint focus:border-hairline-strong"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setCommentLine(null)
                          setCommentDraft("")
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        variant="primary"
                        size="xs"
                        disabled={!commentDraft.trim()}
                      >
                        <Send className="size-3" />
                        <span>Send to chat</span>
                      </Button>
                    </div>
                  </form>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

export interface FilesTabPanelProps {
  className?: string
}

export function FilesTabPanel({ className }: FilesTabPanelProps) {
  const { data: inspector, isLoading } = useInspectorState()
  const { data: changes } = useInspectorChanges()
  const activeWorkspacePath = useAppStore((s) => s.activeWorkspacePath)
  const openFilesActiveFile = useAppStore((s) => s.openFilesActiveFile)
  const setOpenFilesActiveFile = useAppStore((s) => s.setOpenFilesActiveFile)
  const openDocPreview = useAppStore((s) => s.openDocPreview)
  const fullView = useAppStore((s) => s.fullView)
  const setFullView = useAppStore((s) => s.setFullView)
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)

  const [fileFilter, setFileFilter] = React.useState("")
  const [showTree, setShowTree] = React.useState(true)
  const [expandedDirs, setExpandedDirs] = React.useState<Record<string, boolean>>(
    {}
  )

  const workspaceFilesQuery = useQuery({
    queryKey: [...inspectorKeys.workspaceFiles(), activeWorkspacePath],
    queryFn: fetchWorkspaceFiles,
    staleTime: 15_000,
  })

  const statusMap = React.useMemo(() => {
    const map = new Map<string, "M" | "A" | "D">()
    for (const file of changes?.files ?? []) {
      const clean = file.path.replace(/\\/g, "/").replace(/^\/+/, "")
      if (file.deleted) map.set(clean, "D")
      else if (file.ownerBadge === "new") map.set(clean, "A")
      else map.set(clean, "M")
    }
    return map
  }, [changes?.files])

  const allFilePaths = React.useMemo(() => {
    const set = new Set<string>()
    for (const f of workspaceFilesQuery.data ?? []) {
      set.add(f.path)
    }
    for (const f of Object.values(inspector?.codeFiles ?? {})) {
      set.add(f.path)
    }
    for (const f of changes?.files ?? []) {
      set.add(f.path)
    }
    return Array.from(set)
  }, [changes?.files, inspector?.codeFiles, workspaceFilesQuery.data])

  const filteredPaths = React.useMemo(() => {
    const q = fileFilter.trim().replace(/^\?\s*/, "").toLowerCase()
    if (!q) return allFilePaths
    return allFilePaths.filter((p) => p.toLowerCase().includes(q))
  }, [allFilePaths, fileFilter])

  const fileTree = React.useMemo(
    () => buildFileTree(filteredPaths, statusMap),
    [filteredPaths, statusMap]
  )

  if (isLoading || !inspector) {
    return <ContextSkeleton />
  }

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }))
  }

  const collapseAllDirs = () => {
    setExpandedDirs({})
  }

  const handleSelectFile = (filePath: string) => {
    const lower = filePath.toLowerCase()
    if (lower.endsWith(".xlsx")) {
      openDocPreview("excel", filePath.split("/").pop() ?? filePath)
      return
    }
    if (lower.endsWith(".pptx")) {
      openDocPreview("slide", "Slide")
      return
    }
    setOpenFilesActiveFile(filePath)
  }

  const isSearching = fileFilter.trim().length > 0

  const renderTreeNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => {
    return nodes.map((node) => {
      if (node.isDir) {
        const isExpanded = isSearching || Boolean(expandedDirs[node.path])
        return (
          <div key={node.path}>
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => toggleDir(node.path)}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              className="flex h-7 w-full cursor-pointer items-center gap-1.5 pr-3 text-left text-[12.5px] transition-colors hover:bg-hover"
            >
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 text-faint transition-transform duration-150",
                  isExpanded && "rotate-90 text-muted-ink"
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  node.hasAddedChild
                    ? "text-brand-text"
                    : node.hasModifiedChild
                      ? "text-warn"
                      : "text-body"
                )}
              >
                {node.name}
              </span>
              {node.hasAddedChild ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-brand"
                  aria-hidden="true"
                />
              ) : node.hasModifiedChild ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-warn"
                  aria-hidden="true"
                />
              ) : null}
            </button>
            {isExpanded && renderTreeNodes(node.children, depth + 1)}
          </div>
        )
      }

      const isSelected = openFilesActiveFile === node.path
      return (
        <button
          key={node.path}
          type="button"
          onClick={() => handleSelectFile(node.path)}
          style={{ paddingLeft: `${14 + depth * 14}px` }}
          className={cn(
            "mx-1.5 flex h-7 w-[calc(100%-12px)] cursor-pointer items-center gap-2 rounded-lg pr-2.5 text-left text-[12.5px] transition-colors",
            isSelected
              ? "bg-active/80 text-ink ring-1 ring-info/75"
              : "text-body hover:bg-hover hover:text-ink"
          )}
        >
          <TechFileBadge path={node.path} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              node.gitStatus === "A"
                ? "text-brand-text"
                : node.gitStatus === "M"
                  ? "text-warn"
                  : isSelected
                    ? "text-ink"
                    : "text-body"
            )}
          >
            {node.name}
          </span>
          {node.gitStatus && (
            <span
              className={cn(
                "shrink-0 font-mono text-[10.5px] font-medium",
                node.gitStatus === "A"
                  ? "text-brand-text"
                  : node.gitStatus === "D"
                    ? "text-danger"
                    : "text-warn"
              )}
            >
              {node.gitStatus}
            </span>
          )}
        </button>
      )
    })
  }

  return (
    <div
      data-testid="inspector-files-panel"
      className={cn("flex min-h-0 flex-1 flex-col bg-canvas", className)}
    >
      {/* Unified Claude-style Files Header */}
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-hairline bg-canvas px-4 select-none">
        <span className="text-[13.5px] font-medium text-ink">Files</span>

        {openFilesActiveFile && (
          <div className="inline-flex h-6 max-w-[240px] items-center gap-1.5 rounded-md bg-active pr-1 pl-2 font-mono text-[11.5px] text-ink">
            <TechFileBadge path={openFilesActiveFile} className="size-3.5" />
            <span className="truncate">
              {openFilesActiveFile.split("/").pop()}
            </span>
            <button
              type="button"
              aria-label="Close open file"
              onClick={() => setOpenFilesActiveFile(null)}
              className="grid size-4 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </div>
        )}

        <span className="flex-1" />

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={fullView ? "Exit full view" : "Full view"}
                onClick={() => setFullView(!fullView)}
                className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                {fullView ? (
                  <Minimize2
                    className="size-3.5"
                    strokeWidth={1.65}
                    aria-hidden="true"
                  />
                ) : (
                  <Maximize2
                    className="size-3.5"
                    strokeWidth={1.65}
                    aria-hidden="true"
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {fullView ? "Exit full view" : "Full view"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Close files"
                onClick={toggleRightSidebar}
                className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <X className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Sub-bar (collapse-all, tree toggle, ...) */}
      <div className="flex h-9 shrink-0 items-center justify-end gap-0.5 border-b border-hairline-soft bg-canvas px-3 select-none">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Collapse all folders"
              onClick={collapseAllDirs}
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <ListCollapse
                className="size-3.5"
                strokeWidth={1.65}
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Collapse folders</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Toggle file tree"
              aria-pressed={showTree}
              onClick={() => setShowTree((prev) => !prev)}
              className={cn(
                "grid size-7 cursor-pointer place-items-center rounded-[7px] transition-colors",
                showTree
                  ? "bg-active text-ink"
                  : "text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              <ListTree
                className="size-3.5"
                strokeWidth={1.65}
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle file tree</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Files options"
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
            >
              <MoreHorizontal
                className="size-3.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Documents &amp; Previews</DropdownMenuLabel>
            {inspector.outputs.map((out) => (
              <DropdownMenuItem
                key={out.id}
                onClick={() => openDocPreview(out.kind, out.pillLabel)}
              >
                <span className="truncate">{out.label}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setOpenFilesActiveFile(null)}>
              <span>Clear open file</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Two-Column Split: Left Open File Stage + Right Collapsible File Tree */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
          {openFilesActiveFile ? (
            <InlineFilePreview filePath={openFilesActiveFile} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 text-center">
              <Folder
                className="size-6 text-muted-ink"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <p className="text-[13.5px] font-medium text-ink">
                Open files appear here
              </p>
              <p className="max-w-[230px] text-xs leading-relaxed text-muted-ink">
                Pick a file in the tree, or click a file path in the
                conversation.
              </p>
            </div>
          )}
        </div>

        {showTree && (
          <div className="flex w-[258px] shrink-0 flex-col border-l border-hairline bg-canvas">
            <div className="shrink-0 p-2.5">
              <div className="relative flex items-center">
                <Search
                  className="pointer-events-none absolute left-2.5 size-3.5 text-faint"
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  placeholder="Filter, or ? to search in files"
                  aria-label="Filter workspace files"
                  className="h-8 w-full rounded-lg border border-hairline bg-inset pr-2.5 pl-8 text-xs text-ink placeholder:text-faint focus:border-hairline-strong focus:outline-none"
                />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-0.5 pb-4">
                {fileTree.length === 0 ? (
                  <p className="px-3.5 py-3 text-xs text-faint">
                    {fileFilter.trim()
                      ? `No files matching "${fileFilter.trim()}".`
                      : "No files indexed in this workspace."}
                  </p>
                ) : (
                  renderTreeNodes(fileTree)
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  )
}
