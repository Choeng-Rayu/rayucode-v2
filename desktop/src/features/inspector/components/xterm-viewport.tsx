import * as React from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal, type ITheme } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import type { AccentColor, ThemeMode } from "@/lib/app-store"
import { createStreamBatcher } from "@/lib/stream-batcher"

import type { InspectorTerminalLine } from "../types"

export interface XtermViewportProps {
  lines: InspectorTerminalLine[]
  theme: ThemeMode
  accent: AccentColor
  clearGeneration: number
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
  const background = readCssToken("--bg-inset")
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
}: XtermViewportProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const termRef = React.useRef<Terminal | null>(null)
  const fitRef = React.useRef<FitAddon | null>(null)
  const writtenCountRef = React.useRef(0)
  const batcherRef = React.useRef<ReturnType<
    typeof createStreamBatcher<string>
  > | null>(null)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily: readCssToken("--font-mono") ?? "monospace",
      fontSize: 12,
      lineHeight: 1.55,
      theme: buildXtermTheme(),
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    try {
      fitAddon.fit()
    } catch {
      // Ignore fit errors before layout settles
    }

    const batcher = createStreamBatcher<string>((chunks) => {
      if (chunks.length === 0) return
      terminal.writeln(chunks.join("\r\n"))
    }, 16)

    termRef.current = terminal
    fitRef.current = fitAddon
    batcherRef.current = batcher
    writtenCountRef.current = 0

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        try {
          fitAddon.fit()
        } catch {
          // Ignore transient resize errors
        }
      })
      observer.observe(container)
    }

    return () => {
      observer?.disconnect()
      batcher.dispose()
      terminal.dispose()
      termRef.current = null
      fitRef.current = null
      batcherRef.current = null
      writtenCountRef.current = 0
    }
  }, [])

  React.useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = buildXtermTheme()
  }, [theme, accent])

  React.useEffect(() => {
    if (!termRef.current) return
    termRef.current.clear()
    termRef.current.reset()
    writtenCountRef.current = 0
  }, [clearGeneration])

  React.useEffect(() => {
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
  }, [lines, clearGeneration])

  return (
    <div
      ref={containerRef}
      data-testid="xterm-canvas-host"
      className="min-h-0 flex-1 overflow-hidden px-3 py-2.5"
    />
  )
}
