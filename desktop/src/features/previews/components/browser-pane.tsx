import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  Monitor,
  MoreHorizontal,
  Plus,
  Printer,
  RotateCw,
  Search,
  Smartphone,
  Trash2,
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
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import {
  openUrlInSystemBrowser,
  previewsKeys,
  previewsQueryOptions,
  sendBrowserQuestion,
} from "../api/previews-api"
import { useBrowserBounds } from "../hooks/use-browser-bounds"
import type { BrowserChatMessage, BrowserDeviceMode } from "../types"
import { FloatingAskChat } from "./floating-ask-chat"

const MIN_ZOOM = 70
const MAX_ZOOM = 130
const ZOOM_STEP = 10

export interface BrowserPaneProps {
  className?: string
}

export function BrowserPane({ className }: BrowserPaneProps) {
  const queryClient = useQueryClient()
  const fullView = useAppStore((s) => s.fullView)
  const setFullView = useAppStore((s) => s.setFullView)

  const { data } = useQuery(previewsQueryOptions())
  const browserData = data?.browser

  const [history, setHistory] = React.useState<string[]>([
    "http://localhost:3000/credits-dashboard",
  ])
  const [historyIndex, setHistoryIndex] = React.useState(0)
  const [urlInput, setUrlInput] = React.useState(
    "http://localhost:3000/credits-dashboard"
  )
  const [deviceMode, setDeviceMode] = React.useState<BrowserDeviceMode>("desktop")
  const [zoom, setZoom] = React.useState<number>(100)
  const [isReloading, setIsReloading] = React.useState(false)
  const [findOpen, setFindOpen] = React.useState(false)
  const [findQuery, setFindQuery] = React.useState("")
  const [liveIframeMode, setLiveIframeMode] = React.useState(false)
  const [chatMinimized, setChatMinimized] = React.useState(false)
  const [localMessages, setLocalMessages] = React.useState<BrowserChatMessage[]>(
    []
  )

  const currentUrl = history[historyIndex] ?? urlInput

  const { containerRef, bounds } = useBrowserBounds({
    enabled: true,
    url: currentUrl,
    zoom,
    deviceMode,
    fullView,
  })

  const chatMessages = React.useMemo(() => {
    const base = browserData?.chatMessages ?? []
    if (localMessages.length === 0) return base
    const seen = new Set(base.map((m) => m.id))
    return [...base, ...localMessages.filter((m) => !seen.has(m.id))]
  }, [browserData?.chatMessages, localMessages])

  const sendQuestionMutation = useMutation({
    mutationFn: (question: string) => sendBrowserQuestion(question),
    onSuccess: (updated) => {
      queryClient.setQueryData(previewsKeys.state(), updated)
      setLocalMessages([])
    },
  })

  const handleNavigate = (nextUrl: string) => {
    const trimmed = nextUrl.trim()
    if (!trimmed) return
    const normalized = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`
    const nextHistory = history.slice(0, historyIndex + 1)
    nextHistory.push(normalized)
    setHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
    setUrlInput(normalized)
    toast(`Navigated to ${normalized}`)
  }

  const handleBack = () => {
    if (historyIndex <= 0) {
      toast("At start of preview history")
      return
    }
    const nextIdx = historyIndex - 1
    setHistoryIndex(nextIdx)
    setUrlInput(history[nextIdx])
  }

  const handleForward = () => {
    if (historyIndex >= history.length - 1) {
      toast("At latest preview page")
      return
    }
    const nextIdx = historyIndex + 1
    setHistoryIndex(nextIdx)
    setUrlInput(history[nextIdx])
  }

  const handleReload = () => {
    setIsReloading(true)
    toast(`Reloaded ${currentUrl}`)
    window.setTimeout(() => setIsReloading(false), 260)
  }

  const adjustZoom = (delta: number) => {
    setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)))
  }

  const resetZoom = () => {
    setZoom(100)
  }

  const toggleDeviceMode = (target?: BrowserDeviceMode) => {
    setDeviceMode((prev) => {
      const next = target ?? (prev === "desktop" ? "mobile" : "desktop")
      toast(
        next === "mobile"
          ? "Device toolbar: Mobile (375px)"
          : "Device toolbar: Desktop"
      )
      return next
    })
  }

  const handleToggleFullView = () => {
    setFullView(!fullView)
  }

  const handleSendChat = async (question: string) => {
    const optimisticId = `u_local_${Date.now()}`
    setLocalMessages((prev) => [
      ...prev,
      { id: optimisticId, sender: "user", text: question, timestamp: "Just now" },
    ])
    await sendQuestionMutation.mutateAsync(question)
  }

  const kpis = browserData?.kpis ?? [
    { label: "Memory RSS", value: "71 MB", delta: "−38% vs legacy" },
    { label: "KV Cache Hit", value: "94.2%", delta: "warm · 1h TTL" },
    { label: "Swarm Workers", value: "3 live", delta: "0 conflicts" },
    { label: "Credits Burn", value: "0.86 cr", delta: "−58% via KV cache" },
  ]

  const tokenBurn = browserData?.tokenBurn ?? []
  const maxTokenBucket = Math.max(
    1,
    ...tokenBurn.map((point) => point.cachedK + point.uncachedK)
  )

  const filteredEndpoints = React.useMemo(() => {
    const endpoints = browserData?.endpoints ?? []
    const q = findQuery.trim().toLowerCase()
    if (!q) return endpoints
    return endpoints.filter(
      (ep) =>
        ep.route.toLowerCase().includes(q) ||
        ep.model.toLowerCase().includes(q) ||
        ep.status.toLowerCase().includes(q)
    )
  }, [browserData?.endpoints, findQuery])

  return (
    <div
      data-testid="browser-pane"
      data-device-mode={deviceMode}
      data-zoom={zoom}
      data-full-view={fullView ? "true" : "false"}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col bg-chrome",
        className
      )}
    >
      {/* Browser Chrome Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline bg-chrome px-2.5 py-1.5 select-none">
        {/* Back / Forward / Reload pill */}
        <div className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-raised p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Browser back"
                onClick={handleBack}
                className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <ArrowLeft className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Browser forward"
                onClick={handleForward}
                className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <ArrowRight className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Forward</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Reload page"
                onClick={handleReload}
                className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <RotateCw
                  className={cn("size-3.5", isReloading && "animate-spin")}
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reload</TooltipContent>
          </Tooltip>
        </div>

        {/* Ask RayuCode trigger (prominent in Full View) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Ask RayuCode"
              onClick={() => {
                if (!fullView) {
                  setFullView(true)
                  setChatMinimized(false)
                } else {
                  setChatMinimized((prev) => !prev)
                }
              }}
              className={cn(
                "rayu-surface-bevel inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-raised px-2 text-xs font-medium text-body transition-colors hover:border-premium-hi hover:bg-active hover:text-ink",
                fullView && "px-2.5"
              )}
            >
              <MessageSquare
                className="size-3.5 text-brand-text"
                strokeWidth={1.65}
                aria-hidden="true"
              />
              {fullView && <span>Ask RayuCode</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Ask RayuCode about this page</TooltipContent>
        </Tooltip>

        {/* URL Input Pill */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleNavigate(urlInput)
          }}
          className="flex h-7 min-w-[140px] flex-1 items-center gap-2 rounded-full border border-hairline bg-raised px-3"
        >
          <span
            className="size-1.5 shrink-0 rounded-full bg-brand-bright"
            aria-hidden="true"
          />
          <input
            type="text"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            aria-label="Browser URL"
            className="w-full min-w-0 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-muted-ink"
          />
        </form>

        {/* Device Mode Toggle */}
        <div
          role="group"
          aria-label="Device mode"
          className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-raised p-0.5"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Desktop viewport"
                aria-pressed={deviceMode === "desktop"}
                onClick={() => toggleDeviceMode("desktop")}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors",
                  deviceMode === "desktop"
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <Monitor className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Desktop view</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Mobile viewport"
                aria-pressed={deviceMode === "mobile"}
                onClick={() => toggleDeviceMode("mobile")}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors",
                  deviceMode === "mobile"
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <Smartphone
                  className="size-3.5"
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Mobile view (375px)</TooltipContent>
          </Tooltip>
        </div>

        {/* Inline Zoom Controls */}
        <div
          role="group"
          aria-label="Zoom controls"
          className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-raised px-1 py-0.5"
        >
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => adjustZoom(-ZOOM_STEP)}
            className="grid size-5 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <Minus className="size-3" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            data-testid="browser-zoom-value"
            onClick={resetZoom}
            className="min-w-[38px] cursor-pointer rounded px-1 text-center font-mono text-[11px] text-ink tabular-nums hover:bg-hover"
          >
            {zoom}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => adjustZoom(ZOOM_STEP)}
            className="grid size-5 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <Plus className="size-3" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {/* Full View / Exit Full View Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="xs"
              aria-label={fullView ? "Exit full view" : "Full view"}
              onClick={handleToggleFullView}
              className="h-7 rounded-full px-2.5"
            >
              {fullView ? (
                <>
                  <Minimize2
                    className="size-3.5"
                    strokeWidth={1.65}
                    aria-hidden="true"
                  />
                  <span>Exit full view</span>
                </>
              ) : (
                <Maximize2
                  className="size-3.5"
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {fullView ? "Exit full view" : "Full view"}
          </TooltipContent>
        </Tooltip>

        {/* Browser "..." Menu */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Browser menu"
                  className="rayu-surface-bevel grid size-7 cursor-pointer place-items-center rounded-full bg-raised text-body transition-colors hover:border-premium-hi hover:bg-active hover:text-ink data-[state=open]:border-premium-hi data-[state=open]:bg-active data-[state=open]:text-ink"
                >
                  <MoreHorizontal
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Browser menu</TooltipContent>
          </Tooltip>

          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Browser Preview</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                setFindOpen(true)
              }}
            >
              <Search className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              <span>Find in page</span>
              <span className="ml-auto font-mono text-[10px] text-muted-ink">
                ⌘F
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                toast("Print dialog ready for preview viewport")
              }}
            >
              <Printer className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              <span>Print</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-ink">
              <span>Zoom</span>
              <div className="inline-flex items-center gap-1 rounded-full border border-premium bg-active px-1.5 py-0.5">
                <button
                  type="button"
                  aria-label="Menu zoom out"
                  onClick={() => adjustZoom(-ZOOM_STEP)}
                  className="grid size-5 cursor-pointer place-items-center rounded-full text-body hover:bg-hover hover:text-ink"
                >
                  <Minus className="size-3" strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={resetZoom}
                  className="min-w-[36px] cursor-pointer text-center font-mono text-[11px] text-ink tabular-nums"
                >
                  {zoom}%
                </button>
                <button
                  type="button"
                  aria-label="Menu zoom in"
                  onClick={() => adjustZoom(ZOOM_STEP)}
                  className="grid size-5 cursor-pointer place-items-center rounded-full text-body hover:bg-hover hover:text-ink"
                >
                  <Plus className="size-3" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => toggleDeviceMode()}>
              <Smartphone
                className="size-3.5"
                strokeWidth={1.65}
                aria-hidden="true"
              />
              <span>Device toolbar</span>
              <span className="ml-auto font-mono text-[10px] text-muted-ink">
                {deviceMode}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                toast("Captured browser viewport screenshot")
              }}
            >
              <Camera className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              <span>Take screenshot</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                toast("Cleared preview cookies and cache")
              }}
            >
              <Trash2 className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              <span>Clear cookies</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => {
                setLiveIframeMode((prev) => !prev)
                toast(
                  liveIframeMode
                    ? "Switched to interactive Demo surface"
                    : `Switched to Live iframe (${currentUrl})`
                )
              }}
            >
              <Monitor className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
              <span>
                {liveIframeMode ? "Switch to demo preview" : "Load live URL iframe"}
              </span>
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={() => {
                void openUrlInSystemBrowser(currentUrl)
                toast(`Opened ${currentUrl} in system browser`)
              }}
            >
              <ExternalLink
                className="size-3.5"
                strokeWidth={1.65}
                aria-hidden="true"
              />
              <span>Open in system browser</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Optional inline Find-in-page bar */}
      {findOpen && (
        <div className="flex items-center gap-2 border-b border-hairline bg-pane px-3 py-1.5 text-xs">
          <Search
            className="size-3.5 text-muted-ink"
            strokeWidth={1.65}
            aria-hidden="true"
          />
          <input
            type="text"
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            placeholder="Find in page (filters routes & metrics)..."
            aria-label="Find in page"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted-ink"
          />
          <span className="font-mono text-[11px] text-muted-ink tabular-nums">
            {filteredEndpoints.length} match
            {filteredEndpoints.length === 1 ? "" : "es"}
          </span>
          <button
            type="button"
            aria-label="Close find in page"
            onClick={() => {
              setFindOpen(false)
              setFindQuery("")
            }}
            className="grid size-5 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
          >
            <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Viewport Stage (tracked by ResizeObserver via useBrowserBounds) */}
      <div
        ref={containerRef}
        data-testid="browser-stage"
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-inset"
      >
        {liveIframeMode ? (
          <iframe
            key={currentUrl}
            src={currentUrl}
            title={`Live preview of ${currentUrl}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="h-full w-full flex-1 border-0 bg-canvas"
          />
        ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className={cn("p-3", fullView && "p-6")}>
            <div
              data-testid="browser-page-surface"
              style={{
                transform: zoom === 100 ? undefined : `scale(${zoom / 100})`,
                transformOrigin: "top center",
              }}
              className={cn(
                "mx-auto w-full overflow-hidden rounded-xl border border-hairline bg-pane transition-[max-width,transform] duration-150",
                deviceMode === "mobile"
                  ? "max-w-[375px] border-hairline-strong shadow-rayu-2"
                  : fullView
                    ? "max-w-[980px] shadow-bevel-card"
                    : "max-w-full"
              )}
            >
              {/* Localhost Webapp Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-raised px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <span className="grid size-5 place-items-center rounded-md bg-brand-soft font-mono text-[10px] font-bold text-brand-text">
                    R
                  </span>
                  <span>RayuCode · Credits Usage Dashboard</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10px] text-muted-ink">
                    vite · :3000
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 font-mono text-[10px] font-medium text-brand-text">
                    <span className="size-1.5 rounded-full bg-brand-bright" />
                    HMR Connected
                  </span>
                </div>
              </div>

              {/* Webapp Body */}
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold tracking-tight text-ink">
                      Parallel Agent Throughput &amp; Credits Burn
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-ink">
                      Live local preview from{" "}
                      <code className="rounded border border-hairline bg-inset px-1 py-0.5 font-mono text-[10.5px] text-body">
                        {currentUrl}
                      </code>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      toast("Attached credits dashboard snapshot to active chat")
                    }
                  >
                    <Camera
                      className="size-3"
                      strokeWidth={1.65}
                      aria-hidden="true"
                    />
                    <span>Attach to chat</span>
                  </Button>
                </div>

                {/* KPI Cards Grid */}
                <div
                  className={cn(
                    "grid gap-2.5",
                    deviceMode === "mobile"
                      ? "grid-cols-1"
                      : fullView
                        ? "grid-cols-4"
                        : "grid-cols-2"
                  )}
                >
                  {kpis.map((kpi) => (
                    <div
                      key={kpi.label}
                      className="rounded-lg border border-hairline bg-canvas p-3"
                    >
                      <div className="text-[11px] text-muted-ink">{kpi.label}</div>
                      <div className="mt-1 font-mono text-base font-semibold text-ink tabular-nums">
                        {kpi.value}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-brand-text">
                        {kpi.delta}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Token Burn Chart */}
                <div className="rounded-lg border border-hairline bg-canvas p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium text-ink">
                        Hourly Token Burn (K tokens)
                      </div>
                      <div className="text-[10.5px] text-muted-ink">
                        Warm KV prefix cache vs uncached prompt tokens
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10.5px] text-muted-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-xs bg-brand" />
                        Cached
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-xs bg-info" />
                        Uncached
                      </span>
                    </div>
                  </div>

                  <div
                    role="img"
                    aria-label="Hourly token burn chart"
                    className="grid h-28 grid-cols-6 items-end gap-2 pt-2"
                  >
                    {tokenBurn.map((bucket) => {
                      const total = bucket.cachedK + bucket.uncachedK
                      const cachedHeight = Math.max(
                        12,
                        Math.round((bucket.cachedK / maxTokenBucket) * 84)
                      )
                      const uncachedHeight = Math.max(
                        6,
                        Math.round((bucket.uncachedK / maxTokenBucket) * 84)
                      )
                      return (
                        <div
                          key={bucket.label}
                          className="flex h-full flex-col items-center justify-end gap-1"
                        >
                          <div className="font-mono text-[9.5px] text-muted-ink tabular-nums">
                            {total}K
                          </div>
                          <div className="flex w-full max-w-[32px] flex-col overflow-hidden rounded-t-sm">
                            <div
                              style={{ height: `${uncachedHeight}px` }}
                              className="w-full bg-info/80"
                            />
                            <div
                              style={{ height: `${cachedHeight}px` }}
                              className="w-full bg-brand/85"
                            />
                          </div>
                          <span className="font-mono text-[10px] text-muted-ink tabular-nums">
                            {bucket.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Endpoint Latency Table */}
                <div className="overflow-x-auto rounded-lg border border-hairline bg-canvas">
                  <table className="w-full border-collapse text-left text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-hairline bg-inset text-[10.5px] font-medium text-muted-ink">
                        <th className="px-3 py-2">Endpoint</th>
                        <th className="px-3 py-2">Model Route</th>
                        <th className="px-3 py-2 text-right">p50 / p99</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEndpoints.map((ep) => (
                        <tr
                          key={ep.id}
                          className="border-b border-hairline-soft last:border-b-0"
                        >
                          <td className="px-3 py-2 font-mono text-[11px] font-medium text-ink">
                            {ep.route}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-body">
                            {ep.model}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-ink">
                            {ep.p50Ms}ms / {ep.p99Ms}ms
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                                ep.status === "Review"
                                  ? "bg-warn-soft text-warn"
                                  : "bg-brand-soft text-brand-text"
                              )}
                            >
                              {ep.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-ink">
                            {ep.credits}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-muted-ink">
                  Synthetic localhost preview — click{" "}
                  <strong className="font-medium text-ink">Full view</strong> to
                  expand with the floating Ask RayuCode drawer.
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>
        )}

        {/* Floating Ask RayuCode Chat Drawer when Full View is active */}
        {fullView && (
          <FloatingAskChat
            title="Ask RayuCode"
            contextLabel="localhost:3000"
            contextKind="browser"
            messages={chatMessages}
            minimized={chatMinimized}
            onMinimizedChange={setChatMinimized}
            onSendMessage={handleSendChat}
            isSending={sendQuestionMutation.isPending}
          />
        )}
      </div>

      {/* Quiet Console Status Footer */}
      <div className="flex items-center gap-3 border-t border-hairline bg-chrome px-3 py-1 font-mono text-[10.5px] text-muted-ink tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-brand-text">
          <span className="size-1.5 rounded-full bg-brand-bright" />
          Console: 0 errors
        </span>
        <span className="truncate">GET /api/credits 200 (14ms)</span>
        <span className="flex-1" />
        {bounds && bounds.width > 0 && (
          <span>
            {bounds.width}×{bounds.height}
          </span>
        )}
        <span>{zoom}%</span>
      </div>
    </div>
  )
}
