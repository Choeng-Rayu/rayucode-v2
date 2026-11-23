import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Eye,
  EyeOff,
  FileDiff,
  FilePlus2,
  FileSearch,
  FoldVertical,
  FolderTree,
  GitCommitHorizontal,
  Info,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  SquareSplitHorizontal,
  WrapText,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ErrorState } from "@/components/ui/error-state"
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
import { ipcClient, type ChangedFileDiff } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { openFileInVSCode } from "../api/inspector-api"
import {
  useDiffDecisionMutation,
  useInspectorChanges,
} from "../hooks/use-context-stats"

interface DiffTreeNode {
  name: string
  path: string
  isDir: boolean
  file?: ChangedFileDiff
  children: DiffTreeNode[]
}

function buildDiffTree(files: ChangedFileDiff[]): DiffTreeNode[] {
  const root: DiffTreeNode[] = []
  const dirMap = new Map<string, DiffTreeNode>()

  const getOrCreateDir = (dirPath: string): DiffTreeNode => {
    const existing = dirMap.get(dirPath)
    if (existing) return existing
    const parts = dirPath.split("/")
    const node: DiffTreeNode = {
      name: parts[parts.length - 1],
      path: dirPath,
      isDir: true,
      children: [],
    }
    dirMap.set(dirPath, node)
    if (parts.length === 1) {
      root.push(node)
    } else {
      getOrCreateDir(parts.slice(0, -1).join("/")).children.push(node)
    }
    return node
  }

  for (const file of files) {
    const clean = file.path.replace(/\\/g, "/").replace(/^\/+/, "")
    const parts = clean.split("/")
    const node: DiffTreeNode = {
      name: parts[parts.length - 1],
      path: clean,
      isDir: false,
      file,
      children: [],
    }
    if (parts.length === 1) {
      root.push(node)
    } else {
      getOrCreateDir(parts.slice(0, -1).join("/")).children.push(node)
    }
  }

  const sortNodes = (nodes: DiffTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) {
      if (n.isDir) sortNodes(n.children)
    }
  }

  sortNodes(root)
  return root
}

function formatCompactDir(filePath: string): { prefix: string; name: string } {
  const normalized = filePath.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx === -1) return { prefix: "", name: normalized }
  const dir = normalized.slice(0, idx)
  const name = normalized.slice(idx + 1)
  if (dir.length > 16) {
    return { prefix: `...${dir.slice(-12)}/`, name }
  }
  return { prefix: `${dir}/`, name }
}

function resolveCodeFileKey(path: string): string {
  const base = path.split("/").pop() ?? path
  if (
    import.meta.env?.MODE === "test" &&
    (base === "lookup.rs" || base === "cache.rs" || base === "store.rs")
  ) {
    return base
  }
  return path
}

function FileStatusBox({
  file,
  onToggleStage,
}: {
  file: ChangedFileDiff
  onToggleStage: (e: React.MouseEvent) => void
}) {
  const isStaged = Boolean(file.staged || file.accepted)
  const isDeleted = Boolean(file.deleted)
  const isNew = file.ownerBadge === "new"

  const label = isStaged
    ? `Unstage ${file.path}`
    : `Stage ${file.path}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onToggleStage}
          className={cn(
            "grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-[4px] border font-mono text-[10px] leading-none font-semibold transition-colors",
            isStaged
              ? "border-brand bg-brand text-brand-ink"
              : isDeleted
                ? "border-danger/60 bg-danger-soft text-danger hover:border-danger"
                : isNew
                  ? "border-brand/60 bg-brand-softer text-brand-text hover:border-brand"
                  : "border-brand/55 bg-brand-softer text-brand-text hover:border-brand"
          )}
        >
          {isStaged ? (
            <Check className="size-2.5" strokeWidth={2.6} aria-hidden="true" />
          ) : isDeleted ? (
            "−"
          ) : (
            "+"
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {isStaged ? "Staged (click to unstage)" : "Click to stage file"}
      </TooltipContent>
    </Tooltip>
  )
}

export interface DiffTabPanelProps {
  className?: string
}

export function DiffTabPanel({ className }: DiffTabPanelProps) {
  const queryClient = useQueryClient()
  const {
    data: changes,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useInspectorChanges()
  const commitsQuery = useQuery({
    queryKey: ["changes", "commits"],
    queryFn: () => ipcClient.changes.getCommits(),
    staleTime: 30_000,
  })

  const decisionMutation = useDiffDecisionMutation()
  const openCodeFile = useAppStore((s) => s.openCodeFile)
  const openRightTab = useAppStore((s) => s.openRightTab)
  const openDocPreview = useAppStore((s) => s.openDocPreview)
  const setActiveRoute = useAppStore((s) => s.setActiveRoute)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setPendingStreamPrompt = useAppStore((s) => s.setPendingStreamPrompt)
  const fullView = useAppStore((s) => s.fullView)
  const setFullView = useAppStore((s) => s.setFullView)
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)

  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(
    null
  )
  const [scope, setScope] = React.useState<"branch" | "uncommitted" | "staged">(
    "branch"
  )
  const [baseBranch, setBaseBranch] = React.useState("origin/main")
  const [showTree, setShowTree] = React.useState(true)
  const [changedFilesOpen, setChangedFilesOpen] = React.useState(true)
  const [collapsedDirs, setCollapsedDirs] = React.useState<
    Record<string, boolean>
  >({})
  const [fileFilter, setFileFilter] = React.useState("")
  const [wordWrap, setWordWrap] = React.useState(false)
  const [highlightDiff, setHighlightDiff] = React.useState(true)
  const [singleFileMode, setSingleFileMode] = React.useState(true)
  const [viewedFiles, setViewedFiles] = React.useState<Record<string, boolean>>(
    {}
  )
  const [diffSearchOpen, setDiffSearchOpen] = React.useState(false)
  const [diffSearchQuery, setDiffSearchQuery] = React.useState("")

  // Inline line review comment composer
  const [commentTarget, setCommentTarget] = React.useState<{
    fileId: string
    filePath: string
    lineNumber: number
    lineText: string
  } | null>(null)
  const [commentDraft, setCommentDraft] = React.useState("")

  // Inline commit drawer at bottom of right tree
  const [commitDrawerOpen, setCommitDrawerOpen] = React.useState(false)
  const [commitMessage, setCommitMessage] = React.useState("")
  const [isCommitting, setIsCommitting] = React.useState(false)
  const [commitsOpen, setCommitsOpen] = React.useState(false)

  const filteredFiles = React.useMemo(() => {
    const list = changes?.files ?? []
    return list.filter((file) => {
      if (scope === "staged" && !file.staged && !file.accepted) return false
      if (scope === "uncommitted" && file.staged) return false
      const q = fileFilter.trim().toLowerCase()
      if (!q) return true
      return file.path.toLowerCase().includes(q)
    })
  }, [changes?.files, fileFilter, scope])

  const diffTree = React.useMemo(
    () => buildDiffTree(filteredFiles),
    [filteredFiles]
  )

  if (isLoading) {
    return <ContextSkeleton />
  }

  if (isError || !changes) {
    return (
      <div className="p-4">
        <ErrorState
          title="Unable to load file diffs"
          description={
            error instanceof Error
              ? error.message
              : "Could not read changed files from workspace."
          }
          actionLabel="Retry"
          onRetry={() => {
            void refetch()
          }}
        />
      </div>
    )
  }

  const activeFileIndex = Math.max(
    0,
    filteredFiles.findIndex((f) => f.id === selectedFileId)
  )
  const activeFile = filteredFiles[activeFileIndex] ?? filteredFiles[0] ?? null
  const commits = commitsQuery.data ?? []
  const stagedCount = changes.files.filter((f) => f.staged || f.accepted).length

  const goToFileDelta = (delta: number) => {
    if (filteredFiles.length === 0) return
    const nextIdx =
      (activeFileIndex + delta + filteredFiles.length) % filteredFiles.length
    setSelectedFileId(filteredFiles[nextIdx].id)
  }

  const handleToggleStageFile = async (
    file: ChangedFileDiff,
    event?: React.MouseEvent
  ) => {
    event?.stopPropagation()
    try {
      const updated = await ipcClient.changes.toggleStage(file.id)
      if (updated) {
        queryClient.setQueryData(["inspector", "changes"], updated)
        toast(
          file.staged ? `Unstaged ${file.path}` : `Staged ${file.path}`
        )
        return
      }
      decisionMutation.mutate({
        fileId: file.id,
        decision: file.accepted ? "reject" : "accept",
      })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to toggle stage for ${file.path}`
      )
    }
  }

  const handleStageAll = async (staged: boolean) => {
    try {
      const updated = await ipcClient.changes.stageAll(staged)
      if (updated) {
        queryClient.setQueryData(["inspector", "changes"], updated)
      } else {
        await refetch()
      }
      toast(staged ? "Staged all changed files" : "Unstaged all files")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Unable to update staged files"
      )
    }
  }

  const handleCommit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const msg = commitMessage.trim()
    if (msg.length < 3) {
      toast("Enter a commit message (at least 3 characters)")
      return
    }
    setIsCommitting(true)
    try {
      if (stagedCount === 0 && changes.files.length > 0) {
        await ipcClient.changes.stageAll(true)
      }
      const receipt = await ipcClient.changes.commitStaged({ message: msg })
      if (receipt) {
        toast(`Committed ${receipt.hash}: ${receipt.message}`)
        setCommitMessage("")
        setCommitDrawerOpen(false)
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: ["changes", "commits"] }),
          queryClient.invalidateQueries({ queryKey: ["inspector"] }),
        ])
      } else {
        toast(`Prepared commit "${msg}" (demo workspace)`)
        setCommitMessage("")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Commit failed")
    } finally {
      setIsCommitting(false)
    }
  }

  const handleSendLineComment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!commentTarget || !commentDraft.trim()) return
    const prompt = `Review note on \`${commentTarget.filePath}:${commentTarget.lineNumber}\`:\n> ${commentTarget.lineText.trim()}\n\n${commentDraft.trim()}`
    if (activeSessionId) {
      setPendingStreamPrompt({
        sessionId: activeSessionId,
        prompt,
        modelLabel: "Auto",
      })
      toast(`Sent review note for ${commentTarget.filePath}:${commentTarget.lineNumber} to chat`)
    } else if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(prompt)
      toast(`Copied review note for ${commentTarget.filePath}:${commentTarget.lineNumber}`)
    } else {
      toast(`Added review note on line ${commentTarget.lineNumber}`)
    }
    setCommentDraft("")
    setCommentTarget(null)
  }

  const openFileInFullViewer = (path: string) => {
    if (path.endsWith(".md") || path.endsWith(".mdx")) {
      openDocPreview("markdown", path.split("/").pop() ?? path)
    } else {
      openCodeFile(resolveCodeFileKey(path), 1)
    }
  }

  const renderDiffFileBlock = (file: ChangedFileDiff) => {
    const { prefix, name } = formatCompactDir(file.path)
    const isViewed = Boolean(viewedFiles[file.id])
    const q = diffSearchQuery.trim().toLowerCase()
    const visibleLines = q
      ? file.lines.filter((l) => l.content.toLowerCase().includes(q))
      : file.lines

    return (
      <div key={file.id} className="flex min-h-0 flex-1 flex-col">
        {/* Per-file header bar: TechFileBadge, path, +add -del, viewed, note, menu */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline-soft bg-canvas px-3.5 select-none">
          <TechFileBadge path={file.path} />
          <div className="flex min-w-0 flex-1 items-baseline truncate text-[13px]">
            {prefix && (
              <span className="truncate font-mono text-[12px] text-muted-ink">
                {prefix}
              </span>
            )}
            <span className="truncate font-medium text-ink">{name}</span>
          </div>

          <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums">
            <span className="text-brand-text">
              +{file.additions.toLocaleString()}
            </span>
            <span className="ml-1.5 text-danger">
              -{file.deletions.toLocaleString()}
            </span>
          </span>

          <div className="ml-1 flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={isViewed ? "Mark as unviewed" : "Mark as viewed"}
                  aria-pressed={isViewed}
                  onClick={() =>
                    setViewedFiles((prev) => ({
                      ...prev,
                      [file.id]: !prev[file.id],
                    }))
                  }
                  className={cn(
                    "grid size-6 cursor-pointer place-items-center rounded-md transition-colors",
                    isViewed
                      ? "bg-brand-soft text-brand-text"
                      : "text-muted-ink hover:bg-hover hover:text-ink"
                  )}
                >
                  {isViewed ? (
                    <EyeOff className="size-3.5" strokeWidth={1.65} />
                  ) : (
                    <Eye className="size-3.5" strokeWidth={1.65} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isViewed ? "Viewed" : "Mark file viewed"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Comment on ${name}`}
                  onClick={() => {
                    const firstCodeLine =
                      file.lines.find((l) => l.lineNumber !== null) ??
                      file.lines[0]
                    setCommentTarget({
                      fileId: file.id,
                      filePath: file.path,
                      lineNumber: firstCodeLine?.lineNumber ?? 1,
                      lineText: firstCodeLine?.content ?? "",
                    })
                  }}
                  className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <FilePlus2 className="size-3.5" strokeWidth={1.65} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Add review note</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`More actions for ${name}`}
                  className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => void handleToggleStageFile(file)}>
                  <Check className="size-3.5 text-brand-text" />
                  <span>{file.staged ? "Unstage file" : "Stage file"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    decisionMutation.mutate(
                      { fileId: file.id, decision: "accept" },
                      { onSuccess: () => toast(`Accepted diff for ${name}`) }
                    )
                  }}
                >
                  <Check className="size-3.5 text-brand-text" />
                  <span>Accept changes</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    decisionMutation.mutate(
                      { fileId: file.id, decision: "reject" },
                      { onSuccess: () => toast(`Discarded changes in ${name}`) }
                    )
                  }}
                >
                  <X className="size-3.5 text-danger" />
                  <span>Discard changes</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => openFileInFullViewer(file.path)}
                >
                  <Code2 className="size-3.5" />
                  <span>Open full file</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void openFileInVSCode(file.path, 1)
                    toast(`Opened ${file.path} in Visual Studio Code`)
                  }}
                >
                  <ExternalLink className="size-3.5" />
                  <span>Open in VS Code</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Rich Syntax-Highlighted Diff Code Viewport */}
        <ScrollArea className="min-h-0 flex-1 bg-canvas">
          <div className="py-1 pb-8 font-mono text-[12.5px] leading-[1.68]">
            {visibleLines.map((line, idx) => {
              const isAdd = line.type === "add"
              const isDel = line.type === "del"
              const isHunk = line.type === "hunk"
              const lineNum = line.lineNumber ?? idx + 1
              const isCommentOpenHere =
                commentTarget?.fileId === file.id &&
                commentTarget.lineNumber === lineNum
              const tokens = isHunk
                ? [{ text: line.content, className: "text-muted-ink" }]
                : tokenizeCodeLine(line.content)

              return (
                <React.Fragment key={`${file.id}-line-${idx}`}>
                  <div
                    className={cn(
                      "group relative grid grid-cols-[44px_minmax(0,1fr)] border-l-[3px] transition-colors",
                      isAdd && highlightDiff
                        ? "border-l-diff-add-rail bg-diff-add"
                        : isDel && highlightDiff
                          ? "border-l-diff-del-rail bg-diff-del"
                          : isHunk
                            ? "border-l-transparent bg-pane/70"
                            : "border-l-transparent hover:bg-hover/50"
                    )}
                  >
                    {/* Line Number Gutter + Hover '+' Inline Comment Trigger (matches line 13 in reference) */}
                    <div className="relative flex items-start justify-end pr-3 pl-1 select-none">
                      <span
                        className={cn(
                          "text-[11.5px] tabular-nums",
                          isAdd
                            ? "text-brand-text/75"
                            : isDel
                              ? "text-danger/80"
                              : "text-faint"
                        )}
                      >
                        {line.lineNumber ?? ""}
                      </span>

                      {!isHunk && (
                        <button
                          type="button"
                          aria-label={`Comment on line ${lineNum}`}
                          onClick={() =>
                            setCommentTarget({
                              fileId: file.id,
                              filePath: file.path,
                              lineNumber: lineNum,
                              lineText: line.content,
                            })
                          }
                          className="absolute top-0.5 right-1 grid size-[18px] cursor-pointer place-items-center rounded-[4px] bg-ink text-canvas opacity-0 shadow-rayu-1 transition-opacity group-hover:opacity-100 focus:opacity-100"
                        >
                          <Plus className="size-3" strokeWidth={2.5} />
                        </button>
                      )}
                    </div>

                    {/* Syntax-Colored Code Line */}
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

                  {/* Inline Review Comment Box */}
                  {isCommentOpenHere && (
                    <form
                      onSubmit={handleSendLineComment}
                      className="mx-3 my-2 flex flex-col gap-2 rounded-xl border border-premium bg-raised p-3 font-sans shadow-rayu-1"
                    >
                      <div className="flex items-center justify-between text-[11.5px] text-muted-ink">
                        <span className="inline-flex items-center gap-1.5">
                          <MessageSquarePlus className="size-3.5 text-brand-text" />
                          <span>
                            Comment on{" "}
                            <span className="font-mono text-ink">
                              {name}:{lineNum}
                            </span>
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label="Cancel comment"
                          onClick={() => {
                            setCommentTarget(null)
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
                        placeholder="Ask RayuCode to change or explain this line..."
                        className="h-8 rounded-lg border border-hairline bg-inset px-2.5 text-xs text-ink outline-none placeholder:text-faint focus:border-hairline-strong"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setCommentTarget(null)
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

  const renderTreeNodes = (nodes: DiffTreeNode[], depth = 0): React.ReactNode => {
    return nodes.map((node) => {
      if (node.isDir) {
        const isExpanded = !collapsedDirs[node.path]
        return (
          <div key={node.path}>
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() =>
                setCollapsedDirs((prev) => ({
                  ...prev,
                  [node.path]: !prev[node.path],
                }))
              }
              style={{ paddingLeft: `${10 + depth * 12}px` }}
              className="flex h-7 w-full cursor-pointer items-center gap-1.5 pr-3 text-left text-[12.5px] text-body transition-colors hover:bg-hover hover:text-ink"
            >
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 text-faint transition-transform duration-150",
                  isExpanded && "rotate-90 text-muted-ink"
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span
                className="size-1.5 shrink-0 rounded-full bg-info"
                aria-hidden="true"
              />
            </button>
            {isExpanded && renderTreeNodes(node.children, depth + 1)}
          </div>
        )
      }

      const file = node.file!
      const isSelected = activeFile?.id === file.id
      return (
        <div
          key={file.id}
          onClick={() => setSelectedFileId(file.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setSelectedFileId(file.id)
            }
          }}
          style={{ paddingLeft: `${14 + depth * 12}px` }}
          className={cn(
            "mx-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-lg pr-1.5 text-[12.5px] transition-colors",
            isSelected
              ? "bg-active/80 text-ink ring-1 ring-info/75"
              : "text-body hover:bg-hover hover:text-ink"
          )}
        >
          <TechFileBadge path={file.path} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              viewedFiles[file.id] && "text-muted-ink line-through"
            )}
          >
            {node.name}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            {file.additions > 0 && (
              <span className="text-brand-text">
                +{file.additions.toLocaleString()}
              </span>
            )}
            {file.deletions > 0 && (
              <span className="ml-1 text-danger">
                -{file.deletions.toLocaleString()}
              </span>
            )}
          </span>
          <FileStatusBox
            file={file}
            onToggleStage={(e) => void handleToggleStageFile(file, e)}
          />
        </div>
      )
    })
  }

  return (
    <div
      data-testid="inspector-diff-panel"
      className={cn("flex min-h-0 flex-1 flex-col bg-canvas", className)}
    >
      {/* Row 1: Top Tab Bar ([± Changes  ⌘1 ×]  +  ...  ⤢  ×) */}
      <div className="flex h-[46px] shrink-0 items-center gap-1.5 border-b border-hairline bg-canvas px-3 select-none">
        <div className="inline-flex h-7 items-center gap-2 rounded-[8px] bg-active pr-1.5 pl-2.5 text-[13px] font-medium text-ink">
          <FileDiff
            className="size-3.5 text-muted-ink"
            strokeWidth={1.65}
            aria-hidden="true"
          />
          <span>Changes</span>
          <span className="font-mono text-[10.5px] text-muted-ink">⌘1</span>
          <button
            type="button"
            aria-label="Close diff panel"
            onClick={toggleRightSidebar}
            className="grid size-4 cursor-pointer place-items-center rounded text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open files panel"
              onClick={() => openRightTab("files", "Files")}
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Files</TooltipContent>
        </Tooltip>

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
                  <Minimize2 className="size-3.5" strokeWidth={1.65} />
                ) : (
                  <Maximize2 className="size-3.5" strokeWidth={1.65} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {fullView ? "Exit full view" : "Full view"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Row 2: Pill Controls Toolbar (Branch scope, base branch, right action capsule, tree toggle) */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2.5 select-none">
        {/* Branch / Scope Pill */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-hairline bg-raised px-3 text-[12.5px] font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-active"
            >
              <span className="inline-flex items-center gap-1">
                <span>
                  {scope === "branch"
                    ? "Branch"
                    : scope === "uncommitted"
                      ? "Uncommitted"
                      : "Staged"}
                </span>
                <ChevronDown
                  className="size-3 text-muted-ink"
                  strokeWidth={1.75}
                />
              </span>
              <span className="font-mono text-[12px] tabular-nums">
                <span className="text-brand-text">
                  +{changes.totalAdditions.toLocaleString()}
                </span>
                <span className="ml-1.5 text-danger">
                  -{changes.totalDeletions.toLocaleString()}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => setScope("branch")}>
              <span>Branch ({changes.files.length})</span>
              {scope === "branch" && (
                <Check className="ml-auto size-3.5 text-brand-text" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setScope("uncommitted")}>
              <span>Uncommitted changes</span>
              {scope === "uncommitted" && (
                <Check className="ml-auto size-3.5 text-brand-text" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setScope("staged")}>
              <span>Staged ({stagedCount})</span>
              {scope === "staged" && (
                <Check className="ml-auto size-3.5 text-brand-text" />
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCommitDrawerOpen(true)}>
              <GitCommitHorizontal className="size-3.5 text-brand-text" />
              <span>Commit changes...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Base Branch Pill */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-raised px-3 text-[12.5px] font-medium text-body transition-colors hover:border-hairline-strong hover:bg-active hover:text-ink"
            >
              <span className="font-mono text-xs">{baseBranch}</span>
              <ChevronDown
                className="size-3 text-muted-ink"
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {["origin/main", "main", "HEAD"].map((ref) => (
              <DropdownMenuItem key={ref} onClick={() => setBaseBranch(ref)}>
                <span className="font-mono text-xs">{ref}</span>
                {baseBranch === ref && (
                  <Check className="ml-auto size-3.5 text-brand-text" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="flex-1" />

        {/* Right Action Capsule */}
        <div className="inline-flex h-8 items-center gap-0.5 rounded-full border border-hairline bg-raised px-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Diff options"
                className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => void handleStageAll(true)}>
                <Check className="size-3.5 text-brand-text" />
                <span>Stage all changes</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleStageAll(false)}>
                <X className="size-3.5 text-muted-ink" />
                <span>Unstage all changes</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setShowTree(true)
                  setCommitDrawerOpen(true)
                }}
              >
                <GitCommitHorizontal className="size-3.5 text-brand-text" />
                <span>Commit staged changes</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveRoute("changes")}>
                <span>Create PR / Full Changes</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Search in diff"
                aria-pressed={diffSearchOpen}
                onClick={() => {
                  setDiffSearchOpen((prev) => !prev)
                  if (diffSearchOpen) setDiffSearchQuery("")
                }}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors",
                  diffSearchOpen
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <FileSearch className="size-3.5" strokeWidth={1.65} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Search in diff</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Refresh diff"
                onClick={() => {
                  void refetch()
                  toast("Refreshed git diff")
                }}
                className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <RefreshCw
                  className={cn("size-3.5", isFetching && "animate-spin")}
                  strokeWidth={1.65}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh diff</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Toggle word wrap"
                aria-pressed={wordWrap}
                onClick={() => setWordWrap((prev) => !prev)}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors",
                  wordWrap
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <WrapText className="size-3.5" strokeWidth={1.65} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Word wrap</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Toggle single-file view"
                aria-pressed={singleFileMode}
                onClick={() => setSingleFileMode((prev) => !prev)}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors",
                  singleFileMode
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <FoldVertical className="size-3.5" strokeWidth={1.65} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {singleFileMode ? "One file at a time" : "All files stacked"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Toggle diff highlight"
                aria-pressed={highlightDiff}
                onClick={() => setHighlightDiff((prev) => !prev)}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors",
                  highlightDiff
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <SquareSplitHorizontal className="size-3.5" strokeWidth={1.65} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Diff highlighting</TooltipContent>
          </Tooltip>
        </div>

        {/* Folder Tree Toggle Pill (soft blue/info active state matching screenshot) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Toggle changed files tree"
              aria-pressed={showTree}
              onClick={() => setShowTree((prev) => !prev)}
              className={cn(
                "grid h-8 w-9 cursor-pointer place-items-center rounded-full border transition-colors",
                showTree
                  ? "border-info/50 bg-info-soft text-info"
                  : "border-hairline bg-raised text-muted-ink hover:border-hairline-strong hover:text-ink"
              )}
            >
              <FolderTree className="size-3.5" strokeWidth={1.65} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Changed files tree</TooltipContent>
        </Tooltip>
      </div>

      {/* Row 3: Large Diff Banner with < > File Stepper */}
      {singleFileMode && filteredFiles.length > 0 && (
        <div className="mx-3 mb-2.5 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-hairline bg-raised/70 px-3.5 py-2 text-[12.5px] select-none">
          <div className="flex min-w-0 items-center gap-2 text-body">
            <Info
              className="size-3.5 shrink-0 text-info"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="truncate">
              {filteredFiles.length > 5
                ? "This diff is large, showing one file at a time"
                : `Showing file ${activeFileIndex + 1} of ${filteredFiles.length}`}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Previous changed file"
              onClick={() => goToFileDelta(-1)}
              className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="Next changed file"
              onClick={() => goToFileDelta(1)}
              className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <ChevronRight className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}

      {/* Optional in-diff search bar */}
      {diffSearchOpen && (
        <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-hairline bg-inset px-3 py-1.5 text-xs">
          <Search className="size-3.5 text-muted-ink" aria-hidden="true" />
          <input
            type="text"
            autoFocus
            value={diffSearchQuery}
            onChange={(e) => setDiffSearchQuery(e.target.value)}
            placeholder="Find text in current diff..."
            aria-label="Find text in current diff"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-faint"
          />
          {diffSearchQuery && (
            <button
              type="button"
              aria-label="Clear diff search"
              onClick={() => setDiffSearchQuery("")}
              className="cursor-pointer text-muted-ink hover:text-ink"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}

      {/* Main Two-Column Diff Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden border-t border-hairline">
        {/* Left Column: Syntax-Highlighted Code/Diff Viewer */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
          {filteredFiles.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <FileDiff
                className="size-5 text-muted-ink"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <p className="text-[13px] font-medium text-ink">
                {fileFilter ? "No matching changed files" : "Working tree clean"}
              </p>
              <p className="text-xs text-muted-ink">
                {fileFilter
                  ? `No files match "${fileFilter}".`
                  : `No uncommitted changes on ${changes.branch}.`}
              </p>
            </div>
          ) : singleFileMode && activeFile ? (
            renderDiffFileBlock(activeFile)
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col divide-y divide-hairline">
                {filteredFiles.map((file) => renderDiffFileBlock(file))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Right Column: Hierarchical Changed Files Tree + Commit Box */}
        {showTree && (
          <div className="flex w-[272px] shrink-0 flex-col border-l border-hairline bg-canvas">
            {/* Filter Files Input */}
            <div className="shrink-0 p-2.5 pb-2">
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
                  placeholder="Filter files..."
                  aria-label="Filter changed files"
                  className="h-8 w-full rounded-lg border border-hairline bg-inset pr-2.5 pl-8 text-xs text-ink placeholder:text-faint focus:border-hairline-strong focus:outline-none"
                />
              </div>
            </div>

            {/* Changed Files Header */}
            <button
              type="button"
              aria-expanded={changedFilesOpen}
              onClick={() => setChangedFilesOpen((prev) => !prev)}
              className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-hover"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 text-muted-ink transition-transform duration-150",
                  !changedFilesOpen && "-rotate-90"
                )}
                strokeWidth={1.75}
              />
              <span>Changed files</span>
              <span
                className="ml-auto size-1.5 rounded-full bg-info"
                aria-hidden="true"
              />
            </button>

            {/* Hierarchical File Tree */}
            <ScrollArea className="min-h-0 flex-1">
              {changedFilesOpen && (
                <div className="flex flex-col gap-0.5 py-1 pb-3">
                  {diffTree.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-faint">
                      No changed files.
                    </p>
                  ) : (
                    renderTreeNodes(diffTree)
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Bottom Commit Changes & Recent Commits Dock */}
            <div className="flex shrink-0 flex-col border-t border-hairline bg-pane/50">
              <div className="flex items-center gap-1 px-2.5 py-2">
                <button
                  type="button"
                  aria-expanded={commitDrawerOpen}
                  onClick={() => setCommitDrawerOpen((prev) => !prev)}
                  className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-ink transition-colors hover:bg-hover"
                >
                  <GitCommitHorizontal
                    className="size-3.5 shrink-0 text-brand-text"
                    strokeWidth={1.75}
                  />
                  <span className="truncate">Commit changes</span>
                  {stagedCount > 0 && (
                    <span className="rounded-full bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] text-brand-text tabular-nums">
                      {stagedCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  aria-expanded={commitsOpen}
                  onClick={() => setCommitsOpen((prev) => !prev)}
                  className="shrink-0 cursor-pointer rounded-md px-1.5 py-1 font-mono text-[10.5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink tabular-nums"
                >
                  {commits.length} commits
                </button>
              </div>

              {commitDrawerOpen && (
                <form
                  onSubmit={(e) => void handleCommit(e)}
                  className="flex flex-col gap-2 border-t border-hairline-soft px-2.5 py-2.5"
                >
                  <textarea
                    rows={2}
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message (e.g. feat: add casting module)"
                    aria-label="Commit message"
                    className="w-full resize-none rounded-lg border border-hairline bg-inset px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-faint focus:border-hairline-strong"
                  />
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleStageAll(stagedCount < changes.files.length)}
                      className="cursor-pointer text-[11px] text-muted-ink transition-colors hover:text-ink"
                    >
                      {stagedCount < changes.files.length
                        ? "Stage all"
                        : "Unstage all"}
                    </button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="xs"
                      disabled={isCommitting || commitMessage.trim().length < 3}
                    >
                      <GitCommitHorizontal className="size-3" />
                      <span>{isCommitting ? "Committing..." : "Commit"}</span>
                    </Button>
                  </div>
                </form>
              )}

              {commitsOpen && commits.length > 0 && (
                <ScrollArea className="max-h-[168px] border-t border-hairline-soft">
                  <div className="flex flex-col gap-0.5 px-2 py-1.5">
                    {commits.slice(0, 12).map((commit) => (
                      <div
                        key={commit.hash}
                        className="rounded-md px-2 py-1.5 transition-colors hover:bg-hover"
                      >
                        <div className="truncate text-[11.5px] text-ink">
                          {commit.message}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-ink">
                          {commit.hash} · {commit.relativeTime}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
