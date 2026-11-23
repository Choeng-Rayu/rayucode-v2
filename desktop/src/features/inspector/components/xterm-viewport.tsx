import * as React from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal, type ITheme } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import type { AccentColor, ThemeMode } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { createStreamBatcher } from "@/lib/stream-batcher"

import type { InspectorTerminalLine } from "../types"

export interface XtermViewportProps {
  lines: InspectorTerminalLine[]
  theme: ThemeMode
  accent: AccentColor
  clearGeneration: number
  interactive?: boolean
  sessionId?: string
  cwd?: string
  onCwdResolved?: (cwd: string) => void
}

function readCssToken(name: string): string | undefined {
  if (typeof window === "undefined") return undefined
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || undefined
}

function buildXtermTheme(): ITheme {
  const background = readCssToken("--bg-canvas") ?? readCssToken("--bg-inset")
  const foreground = readCssToken("--text-1")
  const muted = readCssToken("--text-3")
  const brand = readCssToken("--accent")
  const brandBright = readCssToken("--accent-text")
  const danger = readCssToken("--danger")
  const warn = readCssToken("--warn")
  const info = readCssToken("--info")
  const selectionBackground = readCssToken("--selection-bg")

  return {
    background,
    foreground,
    cursor: brand ?? foreground,
    cursorAccent: background,
    selectionBackground,
    black: background,
    brightBlack: muted,
    green: brand,
    brightGreen: brandBright,
    red: danger,
    brightRed: danger,
    yellow: warn,
    brightYellow: warn,
    blue: info,
    brightBlue: info,
    white: foreground,
    brightWhite: foreground,
  }
}

function formatLineForXterm(line: InspectorTerminalLine): string {
  const parts: string[] = []
  if (line.command) {
    const prompt = line.prompt ?? "$"
    parts.push(`\x1b[32m${prompt}\x1b[0m ${line.command}`)
  }
  if (line.output) {
    const outLines = line.output.split("\n")
    for (const outLine of outLines) {
      const colorCode = line.isError ? "31" : "90"
      parts.push(`\x1b[${colorCode}m${outLine}\x1b[0m`)
    }
  }
  return parts.join("\r\n")
}

export default function XtermViewport({
  lines,
  theme,
  accent,
  clearGeneration,
  interactive = false,
  sessionId,
  cwd,
  onCwdResolved,
}: XtermViewportProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const termRef = React.useRef<Terminal | null>(null)
  const fitRef = React.useRef<FitAddon | null>(null)
  const writtenCountRef = React.useRef(0)
  const onCwdResolvedRef = React.useRef(onCwdResolved)
  const batcherRef = React.useRef<ReturnType<
    typeof createStreamBatcher<string>
  > | null>(null)

  React.useEffect(() => {
    onCwdResolvedRef.current = onCwdResolved
  }, [onCwdResolved])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      convertEol: !interactive,
      cursorBlink: true,
      disableStdin: !interactive,
      fontFamily:
        readCssToken("--font-mono") ??
        "'JetBrains Mono', 'SF Mono', Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.45,
      scrollback: 5000,
      theme: buildXtermTheme(),
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    const fitAndNotify = () => {
      try {
        fitAddon.fit()
        if (interactive && sessionId && terminal.cols > 0 && terminal.rows > 0) {
          void ipcClient.terminal.ptyResize(
            sessionId,
            terminal.cols,
            terminal.rows
          )
        }
      } catch {
        // Ignore fit errors before layout settles
      }
    }

    fitAndNotify()

    const batcher = createStreamBatcher<string>((chunks) => {
      if (chunks.length === 0) return
      terminal.writeln(chunks.join("\r\n"))
    }, 16)

    termRef.current = terminal
    fitRef.current = fitAddon
    batcherRef.current = batcher
    writtenCountRef.current = 0

    let disposeOnData: { dispose: () => void } | null = null
    let unsubPtyData: (() => void) | null = null
    let unsubPtyExit: (() => void) | null = null

    if (interactive && sessionId) {
      unsubPtyData = ipcClient.terminal.onPtyData((payload) => {
        if (payload.sessionId !== sessionId) return
        terminal.write(payload.data)
      })
      unsubPtyExit = ipcClient.terminal.onPtyExit((payload) => {
        if (payload.sessionId !== sessionId) return
        terminal.writeln(
          `\r\n\x1b[90m[process exited with code ${payload.exitCode}]\x1b[0m`
        )
      })
      disposeOnData = terminal.onData((data) => {
        void ipcClient.terminal.ptyWrite(sessionId, data)
      })

      void ipcClient.terminal
        .ptyCreate({
          sessionId,
          cwd,
          cols: Math.max(20, terminal.cols || 96),
          rows: Math.max(5, terminal.rows || 28),
        })
        .then((res) => {
          if (res.ok && res.cwd) {
            onCwdResolvedRef.current?.(res.cwd)
          }
          fitAndNotify()
          terminal.focus()
        })
    }

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        fitAndNotify()
      })
      observer.observe(container)
    }

    return () => {
      observer?.disconnect()
      disposeOnData?.dispose()
      unsubPtyData?.()
      unsubPtyExit?.()
      if (interactive && sessionId) {
        void ipcClient.terminal.ptyKill(sessionId)
      }
      batcher.dispose()
      terminal.dispose()
      termRef.current = null
      fitRef.current = null
      batcherRef.current = null
      writtenCountRef.current = 0
    }
  }, [cwd, interactive, sessionId])

  React.useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = buildXtermTheme()
  }, [theme, accent])

  React.useEffect(() => {
    if (!termRef.current || clearGeneration === 0) return
    if (interactive && sessionId) {
      termRef.current.clear()
      void ipcClient.terminal.ptyWrite(sessionId, "\x0c")
      return
    }
    termRef.current.clear()
    termRef.current.reset()
    writtenCountRef.current = 0
  }, [clearGeneration, interactive, sessionId])

  React.useEffect(() => {
    if (interactive) return
    const batcher = batcherRef.current
    if (!batcher) return

    if (lines.length < writtenCountRef.current) {
      termRef.current?.clear()
      writtenCountRef.current = 0
    }

    const pending = lines.slice(writtenCountRef.current)
    for (const line of pending) {
      const formatted = formatLineForXterm(line)
      if (formatted) {
        batcher.push(formatted)
      }
    }
    writtenCountRef.current = lines.length
  }, [lines, clearGeneration, interactive])

  return (
    <div
      ref={containerRef}
      data-testid="xterm-canvas-host"
      onClick={() => termRef.current?.focus()}
      className="min-h-0 flex-1 overflow-hidden px-3 py-2.5"
    />
  )
}
