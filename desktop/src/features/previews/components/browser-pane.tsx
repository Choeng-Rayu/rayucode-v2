import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ExternalLink,
  Globe,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  Monitor,
  MoreHorizontal,
  MousePointerClick,
  PanelRight,
  Plus,
  Puzzle,
  RotateCw,
  Search,
  Smartphone,
  Tablet,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"
import type { ElectronWebviewElement } from "@/vite-env"

import {
  openUrlInSystemBrowser,
  previewsKeys,
  previewsQueryOptions,
  sendBrowserQuestion,
} from "../api/previews-api"
import { useBrowserBounds } from "../hooks/use-browser-bounds"
import type { BrowserChatMessage, BrowserDeviceMode } from "../types"
import { FloatingAskChat } from "./floating-ask-chat"

const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10
const IS_TEST_ENV = import.meta.env.MODE === "test"
const DEFAULT_INTERNET_URL = "https://www.google.com/"
const DEFAULT_DEMO_URL = "http://localhost:3000/credits-dashboard"

const QUICK_SITES = [
  { label: "Google", url: "https://www.google.com/" },
  { label: "GitHub", url: "https://github.com/" },
  { label: "RayuCode", url: "https://rayucode.com/" },
  { label: "W3C Validator", url: "https://jigsaw.w3.org/css-validator/" },
  { label: "localhost:3000", url: "http://localhost:3000/" },
  { label: "localhost:5173", url: "http://localhost:5173/" },
]

interface BrowserTabItem {
  id: string
  initialUrl: string
  url: string
  title: string
  favicon?: string
  history: string[]
  historyIndex: number
  isLoading: boolean
}

function formatUrlHost(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    return parsed.host.replace(/^www\./, "") || rawUrl
  } catch {
    return rawUrl.replace(/^https?:\/\//i, "").replace(/^www\./, "")
  }
}

function normalizeAddressInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_INTERNET_URL
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`
  }
  if (!/\s/.test(trimmed) && /\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

function createInitialTab(url: string, title?: string): BrowserTabItem {
  return {
    id: `btab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    initialUrl: url,
    url,
    title: title ?? formatUrlHost(url),
    history: [url],
    historyIndex: 0,
    isLoading: false,
  }
}

export interface BrowserPaneProps {
  className?: string
}

export function BrowserPane({ className }: BrowserPaneProps) {
  const queryClient = useQueryClient()
  const fullView = useAppStore((s) => s.fullView)
  const setFullView = useAppStore((s) => s.setFullView)
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)

  const { data } = useQuery(previewsQueryOptions())
  const browserData = data?.browser

  const isElectronRuntime =
    typeof window !== "undefined" && Boolean(window.rayu)

  const initialUrl = IS_TEST_ENV ? DEFAULT_DEMO_URL : DEFAULT_INTERNET_URL

  const [tabs, setTabs] = React.useState<BrowserTabItem[]>(() => [
    createInitialTab(
      initialUrl,
      IS_TEST_ENV ? "localhost:3000" : "Google"
    ),
  ])
  const [activeTabId, setActiveTabId] = React.useState<string>(
    () => tabs[0]?.id ?? "btab_init"
  )
  const [urlDraft, setUrlDraft] = React.useState(initialUrl)
  const [isEditingUrl, setIsEditingUrl] = React.useState(false)
  const [deviceMode, setDeviceMode] = React.useState<BrowserDeviceMode>("desktop")
  const [tabletFrame, setTabletFrame] = React.useState(false)
  const [zoom, setZoom] = React.useState<number>(100)
  const [inspectMode, setInspectMode] = React.useState(false)
  const [findOpen, setFindOpen] = React.useState(false)
  const [findQuery, setFindQuery] = React.useState("")
  const [liveWebMode] = React.useState<boolean>(!IS_TEST_ENV)
  const [visitedHistory, setVisitedHistory] = React.useState<string[]>([
    initialUrl,
  ])
  const [chatMinimized, setChatMinimized] = React.useState(false)
  const [localMessages, setLocalMessages] = React.useState<BrowserChatMessage[]>(
    []
  )

  const webviewRef = React.useRef<ElectronWebviewElement | null>(null)
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const urlInputRef = React.useRef<HTMLInputElement | null>(null)

  const activeTab =
    tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const currentUrl = activeTab?.url ?? initialUrl

  const { containerRef, bounds } = useBrowserBounds({
    enabled: true,
    url: currentUrl,
    zoom,
    deviceMode,
    fullView,
  })

  // Wire real Electron <webview> navigation/title/favicon/zoom events
  React.useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !liveWebMode || !isElectronRuntime) return

    const onStartLoading = () => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, isLoading: true } : t))
      )
    }
    const onStopLoading = () => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id ? { ...t, isLoading: false } : t
        )
      )
      try {
        wv.setZoomFactor?.(zoom / 100)
      } catch {
        // ignore before dom-ready
      }
    }
    const onDomReady = () => {
      try {
        wv.setZoomFactor?.(zoom / 100)
      } catch {
        // ignore
      }
    }
    const onTitleUpdated = (ev: Event) => {
      const title = (ev as unknown as { title?: string }).title?.trim()
      if (!title) return
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, title } : t))
      )
    }
    const onFaviconUpdated = (ev: Event) => {
      const favicons = (ev as unknown as { favicons?: string[] }).favicons
      const icon = favicons?.[0]
      if (!icon) return
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, favicon: icon } : t))
      )
    }
    const onDidNavigate = (ev: Event) => {
      const nextUrl = (ev as unknown as { url?: string }).url
      if (!nextUrl) return
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? {
                ...t,
                url: nextUrl,
                title: t.title || formatUrlHost(nextUrl),
              }
            : t
        )
      )
      setUrlDraft(nextUrl)
      setVisitedHistory((prev) =>
        prev[0] === nextUrl
          ? prev
          : [nextUrl, ...prev.filter((u) => u !== nextUrl)].slice(0, 20)
      )
    }

    wv.addEventListener("did-start-loading", onStartLoading)
    wv.addEventListener("did-stop-loading", onStopLoading)
    wv.addEventListener("dom-ready", onDomReady)
    wv.addEventListener("page-title-updated", onTitleUpdated)
    wv.addEventListener("page-favicon-updated", onFaviconUpdated)
    wv.addEventListener("did-navigate", onDidNavigate)
    wv.addEventListener("did-navigate-in-page", onDidNavigate)

    return () => {
      wv.removeEventListener("did-start-loading", onStartLoading)
      wv.removeEventListener("did-stop-loading", onStopLoading)
      wv.removeEventListener("dom-ready", onDomReady)
      wv.removeEventListener("page-title-updated", onTitleUpdated)
      wv.removeEventListener("page-favicon-updated", onFaviconUpdated)
      wv.removeEventListener("did-navigate", onDidNavigate)
      wv.removeEventListener("did-navigate-in-page", onDidNavigate)
    }
  }, [activeTab.id, isElectronRuntime, liveWebMode, zoom])

  // Sync zoom factor to Electron <webview>
  React.useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !liveWebMode || !isElectronRuntime) return
    try {
      wv.setZoomFactor?.(zoom / 100)
    } catch {
      // ignore before dom-ready
    }
  }, [zoom, liveWebMode, isElectronRuntime])

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

  const navigateActiveTab = (rawInput: string) => {
    const normalized = normalizeAddressInput(rawInput)
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t
        const nextHistory = t.history.slice(0, t.historyIndex + 1)
        nextHistory.push(normalized)
        return {
          ...t,
          url: normalized,
          title: formatUrlHost(normalized),
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
          isLoading: true,
        }
      })
    )
    setUrlDraft(normalized)
    setIsEditingUrl(false)
    setVisitedHistory((prev) =>
      [normalized, ...prev.filter((u) => u !== normalized)].slice(0, 20)
    )
    if (liveWebMode && isElectronRuntime && webviewRef.current?.loadURL) {
      void webviewRef.current.loadURL(normalized)
    }
  }

  const handleAddTab = () => {
    const tab = createInitialTab(DEFAULT_INTERNET_URL, "Google")
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setUrlDraft(tab.url)
    setIsEditingUrl(false)
  }

  const handleCloseTab = (tabId: string) => {
    if (tabs.length <= 1) {
      toggleRightSidebar()
      return
    }
    const nextTabs = tabs.filter((t) => t.id !== tabId)
    setTabs(nextTabs)
    if (activeTabId === tabId) {
      const fallback = nextTabs[nextTabs.length - 1]
      setActiveTabId(fallback.id)
      setUrlDraft(fallback.url)
    }
  }

  const handleSelectTab = (tab: BrowserTabItem) => {
    setActiveTabId(tab.id)
    setUrlDraft(tab.url)
    setIsEditingUrl(false)
  }

  const handleBack = () => {
    if (liveWebMode && isElectronRuntime && webviewRef.current?.canGoBack?.()) {
      webviewRef.current.goBack?.()
      return
    }
    if (activeTab.historyIndex <= 0) return
    const nextIdx = activeTab.historyIndex - 1
    const nextUrl = activeTab.history[nextIdx]
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              url: nextUrl,
              title: formatUrlHost(nextUrl),
              historyIndex: nextIdx,
            }
          : t
      )
    )
    setUrlDraft(nextUrl)
  }

  const handleForward = () => {
    if (
      liveWebMode &&
      isElectronRuntime &&
      webviewRef.current?.canGoForward?.()
    ) {
      webviewRef.current.goForward?.()
      return
    }
    if (activeTab.historyIndex >= activeTab.history.length - 1) return
    const nextIdx = activeTab.historyIndex + 1
    const nextUrl = activeTab.history[nextIdx]
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              url: nextUrl,
              title: formatUrlHost(nextUrl),
              historyIndex: nextIdx,
            }
          : t
      )
    )
    setUrlDraft(nextUrl)
  }

  const handleReload = () => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, isLoading: true } : t))
    )
    if (liveWebMode && isElectronRuntime && webviewRef.current?.reload) {
      webviewRef.current.reload()
      return
    }
    if (liveWebMode && iframeRef.current) {
      const current = iframeRef.current.src
      iframeRef.current.src = current
    }
    window.setTimeout(() => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id ? { ...t, isLoading: false } : t
        )
      )
    }, 280)
  }

  const adjustZoom = (delta: number) => {
    setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)))
  }

  const resetZoom = () => {
    setZoom(100)
  }

  const applyDeviceMode = (target: "desktop" | "mobile" | "tablet") => {
    if (target === "tablet") {
      setDeviceMode("desktop")
      setTabletFrame(true)
      toast("Device toolbar: Tablet (768px)")
      return
    }
    setTabletFrame(false)
    setDeviceMode(target)
    toast(
      target === "mobile"
        ? "Device toolbar: Mobile (375px)"
        : "Device toolbar: Desktop"
    )
  }

  const handleFindChange = (value: string) => {
    setFindQuery(value)
    if (liveWebMode && isElectronRuntime && webviewRef.current) {
      if (value.trim()) {
        webviewRef.current.findInPage?.(value)
      } else {
        webviewRef.current.stopFindInPage?.("clearSelection")
      }
    }
  }

  const handleTakeScreenshot = async () => {
    const shot = await ipcClient.workspace.captureAppshot()
    if (shot) {
      toast(`Captured screenshot: ${shot.name}`)
      return
    }
    toast("Captured browser viewport screenshot")
  }

  const handlePrint = () => {
    if (liveWebMode && isElectronRuntime && webviewRef.current?.print) {
      void webviewRef.current.print()
      return
    }
    toast("Print dialog ready for browser viewport")
  }

  const handleSendChat = async (question: string) => {
    const optimisticId = `u_local_${Date.now()}`
    setLocalMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        sender: "user",
        text: question,
        timestamp: "Just now",
      },
    ])
    await sendQuestionMutation.mutateAsync(question)
  }

  const displayHost = formatUrlHost(currentUrl)
  const canGoBack = activeTab.historyIndex > 0
  const canGoForward = activeTab.historyIndex < activeTab.history.length - 1

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
        "relative flex min-h-0 flex-1 flex-col bg-canvas",
        className
      )}
    >
      {/* Row 1: Codex-Style Browser Tab Strip (46px with crisp bottom hairline) */}
      <div className="flex h-[46px] shrink-0 items-center gap-1.5 border-b border-hairline bg-canvas px-2.5 select-none">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab, idx) => {
            const isActive = tab.id === activeTab.id
            return (
              <div
                key={tab.id}
                data-testid="browser-tab-pill"
                className={cn(
                  "group inline-flex h-[30px] max-w-[210px] shrink-0 items-center gap-2 rounded-[9px] pr-1.5 pl-2.5 text-[12.5px] transition-colors",
                  isActive
                    ? "bg-active text-ink"
                    : "text-muted-ink hover:bg-hover hover:text-ink"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectTab(tab)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  {tab.favicon ? (
                    <img
                      src={tab.favicon}
                      alt=""
                      className="size-3.5 shrink-0 rounded-xs object-contain"
                    />
                  ) : (
                    <Globe
                      className="size-3.5 shrink-0 text-muted-ink"
                      strokeWidth={1.65}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate font-medium">{tab.title}</span>
                </button>

                <span className="shrink-0 font-mono text-[10px] text-muted-ink">
                  ⌘{idx + 1}
                </span>

                <button
                  type="button"
                  aria-label={`Close tab ${tab.title}`}
                  onClick={() => handleCloseTab(tab.id)}
                  className="grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            )
          })}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="New browser tab"
                data-testid="browser-new-tab-btn"
                onClick={handleAddTab}
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[7px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New tab</TooltipContent>
          </Tooltip>
        </div>

        {/* Right Header Controls: Full View + Sidebar Toggle */}
        <div className="flex shrink-0 items-center gap-1">
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
                aria-label="Close preview"
                onClick={toggleRightSidebar}
                className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-raised text-body transition-colors hover:bg-hover hover:text-ink"
              >
                <PanelRight
                  className="size-3.5"
                  strokeWidth={1.65}
                  aria-hidden="true"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close browser panel</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Row 2: Codex-Style Rounded Pill Navigation & Address Bar */}
      <div className="relative flex h-[48px] shrink-0 items-center gap-2 border-b border-hairline bg-canvas px-3 select-none">
        {/* Back / Forward / Reload Pill */}
        <div className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-raised px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Browser back"
                onClick={handleBack}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors hover:bg-hover",
                  canGoBack || isElectronRuntime
                    ? "text-body hover:text-ink"
                    : "text-faint"
                )}
              >
                <ArrowLeft
                  className="size-3.5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
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
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full transition-colors hover:bg-hover",
                  canGoForward || isElectronRuntime
                    ? "text-body hover:text-ink"
                    : "text-faint"
                )}
              >
                <ArrowRight
                  className="size-3.5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
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
                className="grid size-6 cursor-pointer place-items-center rounded-full text-body transition-colors hover:bg-hover hover:text-ink"
              >
                <RotateCw
                  className={cn(
                    "size-3.5",
                    activeTab.isLoading && "animate-spin"
                  )}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reload</TooltipContent>
          </Tooltip>
        </div>

        {/* Inspect Element Circle Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Inspect element"
              aria-pressed={inspectMode}
              onClick={() => {
                setInspectMode((prev) => !prev)
                toast(
                  inspectMode
                    ? "Inspect mode disabled"
                    : "Inspect mode enabled"
                )
              }}
              className={cn(
                "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-hairline bg-raised transition-colors hover:bg-hover",
                inspectMode
                  ? "border-brand/50 bg-brand-soft text-brand-text"
                  : "text-body hover:text-ink"
              )}
            >
              <MousePointerClick
                className="size-3.5"
                strokeWidth={1.65}
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Inspect element</TooltipContent>
        </Tooltip>

        {/* Centered Pill Address Bar */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            navigateActiveTab(urlDraft)
            urlInputRef.current?.blur()
          }}
          className="flex h-8 min-w-0 flex-1 items-center rounded-full border border-hairline bg-raised px-3.5 transition-colors focus-within:border-premium-hi focus-within:bg-active"
        >
          <input
            ref={urlInputRef}
            type="text"
            aria-label="Browser URL"
            data-testid="browser-url-input"
            value={isEditingUrl ? urlDraft : displayHost}
            onFocus={() => {
              setIsEditingUrl(true)
              setUrlDraft(currentUrl)
              window.setTimeout(() => urlInputRef.current?.select(), 0)
            }}
            onBlur={() => setIsEditingUrl(false)}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="Search or enter website URL"
            className={cn(
              "w-full min-w-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-muted-ink",
              isEditingUrl ? "text-left font-mono" : "text-center font-medium"
            )}
          />
        </form>

        {/* Quick Sites / Extensions Circle Button */}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Browser bookmarks and extensions"
                  className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-hairline bg-raised text-body transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
                >
                  <Puzzle
                    className="size-3.5"
                    strokeWidth={1.65}
                    aria-hidden="true"
                  />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Quick sites &amp; tools</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" sideOffset={8} className="w-60 p-1.5">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-ink">
              Quick sites
            </div>
            {QUICK_SITES.map((site) => (
              <button
                key={site.url}
                type="button"
                onClick={() => navigateActiveTab(site.url)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-body transition-colors hover:bg-hover hover:text-ink"
              >
                <span className="truncate font-medium">{site.label}</span>
                <span className="truncate font-mono text-[10.5px] text-muted-ink">
                  {formatUrlHost(site.url)}
                </span>
              </button>
            ))}
            <div className="my-1 h-px bg-hairline-soft" />
            <button
              type="button"
              onClick={() => {
                void openUrlInSystemBrowser(currentUrl)
                toast(`Opened ${currentUrl} in system browser`)
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-body transition-colors hover:bg-hover hover:text-ink"
            >
              <ExternalLink className="size-3.5 text-muted-ink" aria-hidden="true" />
              <span>Open in system browser</span>
            </button>
          </PopoverContent>
        </Popover>

        {/* Codex-Style Browser Overflow Menu (...) */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Browser menu"
                  data-testid="browser-more-menu-trigger"
                  className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-hairline bg-raised text-body transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
                >
                  <MoreHorizontal
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">More options</TooltipContent>
          </Tooltip>

          <DropdownMenuContent
            align="end"
            sideOffset={8}
            data-testid="browser-more-menu"
            className="w-[248px] rounded-2xl p-1.5"
          >
            <DropdownMenuItem onClick={() => setFindOpen(true)}>
              <span>Find in page</span>
              <span className="ml-auto font-mono text-[10px] text-muted-ink">
                ⌘F
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePrint}>
              <span>Print</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Inline Zoom Row (matches Codex screenshot exactly) */}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-ink">
              <span>Zoom</span>
              <div className="flex items-center gap-1.5">
                <div className="inline-flex items-center rounded-lg border border-hairline bg-inset">
                  <button
                    type="button"
                    aria-label="Menu zoom out"
                    onClick={() => adjustZoom(-ZOOM_STEP)}
                    className="grid size-6 cursor-pointer place-items-center text-muted-ink transition-colors hover:text-ink"
                  >
                    <Minus className="size-3" aria-hidden="true" />
                  </button>
                  <span className="min-w-[38px] border-x border-hairline px-1.5 text-center font-mono text-[11px] tabular-nums">
                    {zoom}%
                  </span>
                  <button
                    type="button"
                    aria-label="Menu zoom in"
                    onClick={() => adjustZoom(ZOOM_STEP)}
                    className="grid size-6 cursor-pointer place-items-center text-muted-ink transition-colors hover:text-ink"
                  >
                    <Plus className="size-3" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Menu reset zoom"
                  onClick={resetZoom}
                  className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                >
                  <RotateCw className="size-3" aria-hidden="true" />
                </button>
              </div>
            </div>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>Device toolbar</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44 rounded-xl">
                <DropdownMenuItem onClick={() => applyDeviceMode("desktop")}>
                  <Monitor className="size-3.5" aria-hidden="true" />
                  <span>Desktop</span>
                  {deviceMode === "desktop" && !tabletFrame ? (
                    <Check className="ml-auto size-3.5" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyDeviceMode("tablet")}>
                  <Tablet className="size-3.5" aria-hidden="true" />
                  <span>Tablet (768px)</span>
                  {tabletFrame ? (
                    <Check className="ml-auto size-3.5" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyDeviceMode("mobile")}>
                  <Smartphone className="size-3.5" aria-hidden="true" />
                  <span>Mobile (375px)</span>
                  {deviceMode === "mobile" ? (
                    <Check className="ml-auto size-3.5" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem onClick={() => void handleTakeScreenshot()}>
              <span>Take a screenshot</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>History</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56 rounded-xl">
                {visitedHistory.length === 0 ? (
                  <DropdownMenuItem disabled>No history yet</DropdownMenuItem>
                ) : (
                  visitedHistory.slice(0, 8).map((url) => (
                    <DropdownMenuItem
                      key={url}
                      onClick={() => navigateActiveTab(url)}
                    >
                      <span className="truncate">{formatUrlHost(url)}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              onClick={() => {
                setVisitedHistory([currentUrl])
                toast("Cleared tab history")
              }}
            >
              <span>Clear tab history</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => {
                void openUrlInSystemBrowser(currentUrl)
                toast(`Opened ${currentUrl} in system browser`)
              }}
            >
              <span>Open in system browser</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Subtle loading hairline bar */}
        {activeTab.isLoading ? (
          <div className="absolute right-0 bottom-0 left-0 h-[1.5px] overflow-hidden bg-hairline-soft">
            <div className="h-full w-1/3 animate-pulse bg-brand" />
          </div>
        ) : null}
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
            autoFocus
            value={findQuery}
            onChange={(event) => handleFindChange(event.target.value)}
            placeholder="Find in page..."
            aria-label="Find in page"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted-ink"
          />
          {!liveWebMode ? (
            <span className="font-mono text-[11px] text-muted-ink tabular-nums">
              {filteredEndpoints.length} match
              {filteredEndpoints.length === 1 ? "" : "es"}
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Close find in page"
            onClick={() => {
              setFindOpen(false)
              handleFindChange("")
            }}
            className="grid size-5 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
          >
            <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Viewport Stage */}
      <div
        ref={containerRef}
        data-testid="browser-stage"
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas",
          inspectMode && "cursor-crosshair"
        )}
      >
        {liveWebMode ? (
          <div
            data-testid="browser-live-viewport"
            className={cn(
              "flex min-h-0 flex-1 justify-center overflow-auto",
              (deviceMode === "mobile" || tabletFrame) && "bg-inset p-4"
            )}
          >
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas",
                deviceMode === "mobile"
                  ? "max-w-[375px] rounded-2xl border border-hairline-strong shadow-rayu-2"
                  : tabletFrame
                    ? "max-w-[768px] rounded-2xl border border-hairline-strong shadow-rayu-2"
                    : "w-full"
              )}
            >
              {isElectronRuntime ? (
                <webview
                  ref={webviewRef}
                  key={activeTab.id}
                  src={activeTab.initialUrl}
                  partition="persist:rayu-browser"
                  allowpopups
                  className="h-full w-full flex-1 border-0 bg-canvas"
                />
              ) : (
                <iframe
                  ref={iframeRef}
                  key={`${activeTab.id}-${activeTab.url}`}
                  src={activeTab.url}
                  title={`Live preview of ${activeTab.url}`}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  style={{
                    transform: zoom === 100 ? undefined : `scale(${zoom / 100})`,
                    transformOrigin: "top left",
                    width: zoom === 100 ? "100%" : `${10000 / zoom}%`,
                    height: zoom === 100 ? "100%" : `${10000 / zoom}%`,
                  }}
                  className="h-full w-full flex-1 border-0 bg-canvas"
                />
              )}
            </div>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className={cn("p-4", fullView && "p-6")}>
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
                      ? "max-w-[980px]"
                      : "max-w-full"
                )}
              >
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
                    <button
                      type="button"
                      onClick={() => void handleTakeScreenshot()}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-hairline bg-inset px-2.5 py-1 text-xs text-body hover:bg-hover hover:text-ink"
                    >
                      <Camera
                        className="size-3"
                        strokeWidth={1.65}
                        aria-hidden="true"
                      />
                      <span>Attach to chat</span>
                    </button>
                  </div>

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
                        <div className="text-[11px] text-muted-ink">
                          {kpi.label}
                        </div>
                        <div className="mt-1 font-mono text-base font-semibold text-ink tabular-nums">
                          {kpi.value}
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-brand-text">
                          {kpi.delta}
                        </div>
                      </div>
                    ))}
                  </div>

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
                            key={ep.route}
                            className="border-b border-hairline-soft last:border-b-0"
                          >
                            <td className="px-3 py-2 font-mono text-[11px] text-ink">
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
                                  "inline-flex rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                                  ep.status === "Live"
                                    ? "bg-brand-soft text-brand-text"
                                    : ep.status === "Autonomous"
                                      ? "bg-info-soft text-info"
                                      : "bg-warn-soft text-warn"
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
                </div>
              </div>
            </div>
          </ScrollArea>
        )}

        {fullView && (
          <FloatingAskChat
            messages={chatMessages}
            contextLabel={`${currentUrl} · ${bounds?.width || 1280}×${bounds?.height || 800} · ${zoom}%`}
            minimized={chatMinimized}
            onMinimizedChange={setChatMinimized}
            isSending={sendQuestionMutation.isPending}
            onSendMessage={handleSendChat}
          />
        )}
      </div>

      {/* Quiet Micro Footer Bar (Ask RayuCode + Quick Device & Zoom Controls) */}
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-hairline-soft bg-canvas px-3 text-[11px] text-muted-ink select-none">
        <div className="flex items-center gap-2">
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
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <MessageSquare
              className="size-3 text-brand-text"
              strokeWidth={1.65}
              aria-hidden="true"
            />
            <span>Ask RayuCode</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Device mode"
            className="inline-flex items-center gap-0.5"
          >
            <button
              type="button"
              aria-label="Desktop viewport"
              aria-pressed={deviceMode === "desktop" && !tabletFrame}
              onClick={() => applyDeviceMode("desktop")}
              className={cn(
                "grid size-5 cursor-pointer place-items-center rounded transition-colors",
                deviceMode === "desktop" && !tabletFrame
                  ? "bg-active text-ink"
                  : "text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              <Monitor className="size-3" strokeWidth={1.65} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Mobile viewport"
              aria-pressed={deviceMode === "mobile"}
              onClick={() => applyDeviceMode("mobile")}
              className={cn(
                "grid size-5 cursor-pointer place-items-center rounded transition-colors",
                deviceMode === "mobile"
                  ? "bg-active text-ink"
                  : "text-muted-ink hover:bg-hover hover:text-ink"
              )}
            >
              <Smartphone
                className="size-3"
                strokeWidth={1.65}
                aria-hidden="true"
              />
            </button>
          </div>

          <span className="h-3 w-px bg-hairline" aria-hidden="true" />

          <div
            role="group"
            aria-label="Zoom controls"
            className="inline-flex items-center gap-0.5"
          >
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => adjustZoom(-ZOOM_STEP)}
              className="grid size-5 cursor-pointer place-items-center rounded text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <Minus className="size-3" strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Reset zoom"
              data-testid="browser-zoom-value"
              onClick={resetZoom}
              className="min-w-[36px] cursor-pointer rounded px-1 text-center font-mono text-[11px] text-body tabular-nums hover:bg-hover hover:text-ink"
            >
              {zoom}%
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => adjustZoom(ZOOM_STEP)}
              className="grid size-5 cursor-pointer place-items-center rounded text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <Plus className="size-3" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
