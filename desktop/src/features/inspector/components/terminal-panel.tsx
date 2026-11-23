import * as React from "react"
import { CornerDownLeft, Play, Terminal as TerminalIcon, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppStore } from "@/lib/app-store"
import { createStreamBatcher } from "@/lib/stream-batcher"
import { cn } from "@/lib/utils"

import { runInspectorTerminalCommand } from "../api/inspector-api"
import { useInspectorState } from "../hooks/use-context-stats"
import type { InspectorTerminalLine } from "../types"

const LazyXtermViewport = React.lazy(() => import("./xterm-viewport"))

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

function TerminalDomFallback({ lines }: { lines: InspectorTerminalLine[] }) {
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
        className="flex flex-col gap-2 p-3.5 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-faint">
            Terminal cleared. Type a command below or click Run test.
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="flex flex-col gap-0.5">
              {line.command && (
                <div className="break-all">
                  <span className="text-brand-text">{line.prompt ?? "$"}</span>{" "}
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

  const [appendedLines, setAppendedLines] = React.useState<
    InspectorTerminalLine[]
  >([])
  const [clearedInitial, setClearedInitial] = React.useState(false)
  const [commandInput, setCommandInput] = React.useState("")
  const [history, setHistory] = React.useState<string[]>([])
  const [historyCursor, setHistoryCursor] = React.useState<number | null>(null)
  const [isRunning, setIsRunning] = React.useState(false)
  const [clearGeneration, setClearGeneration] = React.useState(0)

  const lines = React.useMemo(
    () =>
      clearedInitial
        ? appendedLines
        : [...(inspector?.terminalLines ?? []), ...appendedLines],
    [clearedInitial, inspector?.terminalLines, appendedLines]
  )

  const useXterm = React.useMemo(() => canUseXtermCanvas(), [])
  const batcherRef = React.useRef<ReturnType<
    typeof createStreamBatcher<InspectorTerminalLine>
  > | null>(null)

  React.useEffect(() => {
    const batcher = createStreamBatcher<InspectorTerminalLine>((incoming) => {
      setAppendedLines((prev) => [...prev, ...incoming])
    }, 16)
    batcherRef.current = batcher
    return () => {
      batcher.dispose()
      batcherRef.current = null
    }
  }, [])

  const clearTerminal = React.useCallback(() => {
    setClearedInitial(true)
    setAppendedLines([])
    setClearGeneration((n) => n + 1)
  }, [])

  const executeCommand = React.useCallback(async (rawCmd: string) => {
    const trimmed = rawCmd.trim()
    if (!trimmed) return

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
        setAppendedLines((prev) => [...prev, result])
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to run command"
      const errorLine: InspectorTerminalLine = {
        id: `term_err_${Date.now()}`,
        prompt: "$",
        command: trimmed,
        output: message,
        isError: true,
      }
      setAppendedLines((prev) => [...prev, errorLine])
      toast(message)
    } finally {
      setIsRunning(false)
      setCommandInput("")
    }
  }, [clearTerminal])

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
        "flex min-h-0 flex-1 flex-col bg-inset font-mono text-xs text-body",
        className
      )}
    >
      {/* Header strip */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-chrome px-3 py-2 text-muted-ink">
        <TerminalIcon className="size-3.5 shrink-0 text-muted-ink" strokeWidth={1.65} aria-hidden="true" />
        <span className="truncate font-mono text-xs text-ink">rayu daemon</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-text">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
          <span>live</span>
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isRunning}
            onClick={() => {
              void executeCommand("cargo test -p rayucode session:: -- --nocapture")
            }}
            className="h-6 px-2 text-[11px]"
          >
            <Play className="size-2.5" strokeWidth={1.75} aria-hidden="true" />
            <span>Run test</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Clear terminal"
            onClick={clearTerminal}
            className="h-6 px-2 text-[11px]"
          >
            <Trash2 className="size-3" strokeWidth={1.65} aria-hidden="true" />
            <span>Clear</span>
          </Button>
        </div>
      </div>

      {/* Terminal viewport: lazy xterm.js in browser, clean DOM fallback in jsdom */}
      {useXterm ? (
        <React.Suspense fallback={<TerminalDomFallback lines={lines} />}>
          <LazyXtermViewport
            lines={lines}
            theme={theme}
            accent={accent}
            clearGeneration={clearGeneration}
          />
        </React.Suspense>
      ) : (
        <TerminalDomFallback lines={lines} />
      )}

      {/* Interactive command input */}
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-2 border-t border-hairline bg-chrome px-3 py-2"
      >
        <span className="font-mono text-xs text-brand-text select-none">$</span>
        <input
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder="Run command on rayu daemon..."
          aria-label="Terminal command input"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-faint"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isRunning || commandInput.trim().length === 0}
          aria-label="Run command"
        >
          <CornerDownLeft className="size-3" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </form>
    </div>
  )
}
