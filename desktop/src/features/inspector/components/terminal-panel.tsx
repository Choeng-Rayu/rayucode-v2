import * as React from "react"
import {
  CornerDownLeft,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Play,
  Plus,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { createStreamBatcher } from "@/lib/stream-batcher"
import { cn } from "@/lib/utils"

import { runInspectorTerminalCommand } from "../api/inspector-api"
import { useInspectorState } from "../hooks/use-context-stats"
import type { InspectorTerminalLine } from "../types"
import XtermViewport from "./xterm-viewport"

interface TerminalTabState {
  id: string
  label: string
  cwd?: string
  appendedLines: InspectorTerminalLine[]
  clearedInitial: boolean
  clearGeneration: number
}

function canUseXtermCanvas(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false
  }
  if (
    typeof navigator !== "undefined" &&
    /jsdom/i.test(navigator.userAgent ?? "")
  ) {
    return false
  }
  try {
    const canvas = document.createElement("canvas")
    return Boolean(canvas.getContext?.("2d"))
  } catch {
    return false
  }
}

function TerminalDomFallback({
  lines,
  projectName,
}: {
  lines: InspectorTerminalLine[]
  projectName: string
}) {
  const bottomRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ block: "end" })
    }
  }, [lines.length])

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div
        data-testid="terminal-dom-output"
        className="flex flex-col gap-2 px-4 py-3 font-mono text-[12.5px] leading-[1.55]"
      >
        {lines.length === 0 ? (
          <div className="flex flex-col gap-1 text-faint">
            <div className="text-body">
              <span className="text-muted-ink">rayu@local</span>{" "}
              <span className="text-ink">{projectName}</span>{" "}
              <span className="text-muted-ink">%</span>{" "}
              <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-brand align-baseline" />
            </div>
            <div className="text-[11.5px] text-faint">
              Terminal cleared. Type a command below or run tests from the menu.
            </div>
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="flex flex-col gap-0.5">
              {line.command && (
                <div className="break-all">
                  <span className="text-muted-ink">
                    {line.prompt ?? "%"}
                  </span>{" "}
                  <span className="text-ink">{line.command}</span>
                </div>
              )}
              {line.output && (
                <pre
                  className={cn(
                    "m-0 font-mono text-xs whitespace-pre-wrap",
                    line.isError ? "text-danger" : "text-muted-ink"
                  )}
                >
                  {line.output}
                </pre>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}

export interface TerminalPanelProps {
  className?: string
}

export function TerminalPanel({ className }: TerminalPanelProps) {
  const { data: inspector } = useInspectorState()
  const theme = useAppStore((s) => s.theme)
  const accent = useAppStore((s) => s.accent)
  const activeWorkspacePath = useAppStore((s) => s.activeWorkspacePath)
  const fullView = useAppStore((s) => s.fullView)
  const setFullView = useAppStore((s) => s.setFullView)
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)

  const resolvedProjectCwd =
    activeWorkspacePath ?? inspector?.environment.path ?? undefined

  const [tabs, setTabs] = React.useState<TerminalTabState[]>(() => [
    {
      id: `term_${Date.now().toString(36)}_1`,
      label: "Terminal",
      cwd: activeWorkspacePath ?? undefined,
      appendedLines: [],
      clearedInitial: false,
      clearGeneration: 0,
    },
  ])
  const [activeTabId, setActiveTabId] = React.useState(() => tabs[0].id)
  const [resolvedCwdByTab, setResolvedCwdByTab] = React.useState<
    Record<string, string>
  >({})
  const [commandInput, setCommandInput] = React.useState("")
  const [history, setHistory] = React.useState<string[]>([])
  const [historyCursor, setHistoryCursor] = React.useState<number | null>(null)
  const [isRunning, setIsRunning] = React.useState(false)
  const commandInputRef = React.useRef<HTMLInputElement | null>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const activeTabIdRef = React.useRef(activeTab.id)
  React.useEffect(() => {
    activeTabIdRef.current = activeTab.id
  }, [activeTab.id])

  const projectName = inspector?.environment.project ?? "rayu daemon"

  const lines = React.useMemo(() => {
    const initial =
      activeTab.id === tabs[0]?.id && !activeTab.clearedInitial
        ? inspector?.terminalLines ?? []
        : []
    return [...initial, ...activeTab.appendedLines]
  }, [
    activeTab.appendedLines,
    activeTab.clearedInitial,
    activeTab.id,
    inspector?.terminalLines,
    tabs,
  ])

  const useXterm = React.useMemo(() => canUseXtermCanvas(), [])
  const isLivePty = useXterm && ipcClient.terminal.hasLivePty()
  const batcherRef = React.useRef<ReturnType<
    typeof createStreamBatcher<InspectorTerminalLine>
  > | null>(null)

  React.useEffect(() => {
    const batcher = createStreamBatcher<InspectorTerminalLine>((incoming) => {
      const targetId = activeTabIdRef.current
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === targetId
            ? { ...tab, appendedLines: [...tab.appendedLines, ...incoming] }
            : tab
        )
      )
    }, 16)
    batcherRef.current = batcher
    return () => {
      batcher.dispose()
      batcherRef.current = null
    }
  }, [])

  const clearTerminal = React.useCallback(() => {
    const targetId = activeTabIdRef.current
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === targetId
          ? {
              ...tab,
              clearedInitial: true,
              appendedLines: [],
              clearGeneration: tab.clearGeneration + 1,
            }
          : tab
      )
    )
  }, [])

  const handleAddTab = () => {
    const nextNum = tabs.length + 1
    const nextId = `term_${Date.now().toString(36)}_${nextNum}`
    setTabs((prev) => [
      ...prev,
      {
        id: nextId,
        label: `Terminal ${nextNum}`,
        cwd: resolvedProjectCwd,
        appendedLines: [],
        clearedInitial: true,
        clearGeneration: 0,
      },
    ])
    setActiveTabId(nextId)
  }

  const handleCloseTab = (tabId: string) => {
    if (isLivePty) {
      void ipcClient.terminal.ptyKill(tabId)
    }
    if (tabs.length <= 1) {
      toggleRightSidebar()
      return
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId)
      if (activeTabId === tabId && next.length > 0) {
        setActiveTabId(next[next.length - 1].id)
      }
      return next
    })
  }

  const executeCommand = React.useCallback(
    async (rawCmd: string) => {
      const trimmed = rawCmd.trim()
      if (!trimmed) return

      if (isLivePty) {
        await ipcClient.terminal.ptyWrite(activeTabIdRef.current, `${trimmed}\r`)
        return
      }

      if (trimmed.toLowerCase() === "clear") {
        clearTerminal()
        setCommandInput("")
        return
      }

      setIsRunning(true)
      setHistory((prev) => [trimmed, ...prev.slice(0, 29)])
      setHistoryCursor(null)

      try {
        const result = await runInspectorTerminalCommand(trimmed)
        if (batcherRef.current) {
          batcherRef.current.push(result)
          batcherRef.current.flushNow()
        } else {
          const targetId = activeTabIdRef.current
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === targetId
                ? { ...tab, appendedLines: [...tab.appendedLines, result] }
                : tab
            )
          )
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to run command"
        const errorLine: InspectorTerminalLine = {
          id: `term_err_${Date.now()}`,
          prompt: "%",
          command: trimmed,
          output: message,
          isError: true,
        }
        const targetId = activeTabIdRef.current
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === targetId
              ? { ...tab, appendedLines: [...tab.appendedLines, errorLine] }
              : tab
          )
        )
        toast(message)
      } finally {
        setIsRunning(false)
        setCommandInput("")
      }
    },
    [clearTerminal, isLivePty]
  )

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void executeCommand(commandInput)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault()
      const nextIdx =
        historyCursor === null
          ? 0
          : Math.min(history.length - 1, historyCursor + 1)
      setHistoryCursor(nextIdx)
      setCommandInput(history[nextIdx] ?? "")
    } else if (event.key === "ArrowDown" && historyCursor !== null) {
      event.preventDefault()
      if (historyCursor <= 0) {
        setHistoryCursor(null)
        setCommandInput("")
      } else {
        const nextIdx = historyCursor - 1
        setHistoryCursor(nextIdx)
        setCommandInput(history[nextIdx] ?? "")
      }
    }
  }

  return (
    <div
      data-testid="inspector-terminal-panel"
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-canvas font-mono text-xs text-body",
        className
      )}
    >
      {/* Unified Claude-style Terminal Top Bar */}
      <div className="flex h-[46px] shrink-0 items-center gap-1 border-b border-hairline bg-canvas px-3 font-sans select-none">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab.id
            return (
              <div
                key={tab.id}
                className={cn(
                  "group inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[13px] font-medium transition-colors",
                  isActive
                    ? "text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className="cursor-pointer truncate"
                >
                  {tab.label}
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    onClick={() => handleCloseTab(tab.id)}
                    className="grid size-4 cursor-pointer place-items-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-ink"
                  >
                    <X className="size-2.5" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="New terminal"
                onClick={handleAddTab}
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New terminal</TooltipContent>
          </Tooltip>
        </div>

        <span className="flex-1" />

        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Terminal actions"
                    className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
                  >
                    <MoreHorizontal
                      className="size-3.5"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Terminal actions</TooltipContent>
            </Tooltip>

            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                disabled={isRunning}
                onClick={() => {
                  void executeCommand(
                    "cargo test -p rayucode session:: -- --nocapture"
                  )
                }}
              >
                <Play className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
                <span>Run session tests</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isRunning}
                onClick={() => {
                  void executeCommand("git status")
                }}
              >
                <SquareTerminal
                  className="size-3.5"
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
                <span>Check git status</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearTerminal}>
                <Trash2 className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
                <span>Clear terminal</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Clear terminal"
                onClick={clearTerminal}
                className="grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <Trash2 className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Clear terminal</TooltipContent>
          </Tooltip>

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
                aria-label="Close terminal"
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

      {/* Terminal viewport: real OS PTY xterm.js in Electron, DOM fallback in jsdom */}
      {isLivePty ? (
        <div className="relative flex min-h-0 flex-1 flex-col bg-canvas">
          {tabs.map((tab) => {
            const isVisible = tab.id === activeTab.id
            const tabCwd = tab.cwd ?? resolvedProjectCwd
            return (
              <div
                key={tab.id}
                className={cn(
                  "min-h-0 flex-1 flex-col",
                  isVisible ? "flex" : "hidden"
                )}
              >
                <XtermViewport
                  interactive
                  sessionId={tab.id}
                  cwd={tabCwd}
                  lines={[]}
                  theme={theme}
                  accent={accent}
                  clearGeneration={tab.clearGeneration}
                  onCwdResolved={(resolved) =>
                    setResolvedCwdByTab((prev) => ({
                      ...prev,
                      [tab.id]: resolved,
                    }))
                  }
                />
              </div>
            )
          })}
          {resolvedCwdByTab[activeTab.id] ? (
            <div className="flex h-6 shrink-0 items-center justify-between border-t border-hairline-soft bg-canvas px-3 font-mono text-[10.5px] text-muted-ink select-none">
              <span className="truncate">
                {resolvedCwdByTab[activeTab.id].replace(/^\/Users\/[^/]+/, "~")}
              </span>
              <span className="shrink-0 text-faint">zsh · PTY</span>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div
            onClick={() => commandInputRef.current?.focus()}
            className="flex min-h-0 flex-1 cursor-text flex-col"
          >
            {useXterm ? (
              <XtermViewport
                key={activeTab.id}
                lines={lines}
                theme={theme}
                accent={accent}
                clearGeneration={activeTab.clearGeneration}
              />
            ) : (
              <TerminalDomFallback lines={lines} projectName={projectName} />
            )}
          </div>

          {/* Seamless inline shell prompt bar (fallback when OS PTY bridge is absent) */}
          <form
            onSubmit={handleSubmit}
            className="flex shrink-0 items-center gap-2 border-t border-hairline-soft bg-canvas px-4 py-2.5"
          >
            <span className="shrink-0 font-mono text-xs text-muted-ink select-none">
              {projectName} <span className="text-brand-text">%</span>
            </span>
            <input
              ref={commandInputRef}
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              placeholder="rayu daemon — type a command..."
              aria-label="Terminal command input"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-faint"
            />
            <span className="sr-only">rayu daemon</span>
            <Button
              type="submit"
              variant="ghost"
              size="icon-xs"
              disabled={isRunning || commandInput.trim().length === 0}
              aria-label="Run command"
            >
              <CornerDownLeft
                className="size-3"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </Button>
          </form>
        </>
      )}
    </div>
  )
}
