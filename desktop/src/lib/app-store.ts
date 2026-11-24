import { create } from "zustand"

import type {
  FileChangesSnapshot,
  OfficeExcelWorkbookData,
  PromptImageAttachment,
  RayuAuthState,
} from "./ipc-client"

export type ThemeMode = "dark" | "light"
export type AccentColor = "green" | "blue"
export type AppRoute =
  | "home"
  | "workspace"
  | "swarm"
  | "automations"
  | "plugins"
  | "changes"
  | "telegram"
  | "settings"

export type RightPaneMode = "context" | "document"
export type RightTabId =
  | "overview"
  | "terminal"
  | "diff"
  | "browser"
  | "files"
  | "code"
  | "excel"
  | "markdown"
  | "slide"
  | "diagram"

export type DocPreviewKind =
  | "code"
  | "excel"
  | "markdown"
  | "browser"
  | "terminal"
  | "diff"
  | "files"
  | "slide"
  | "diagram"

export interface ActiveDiagramState {
  title: string
  source: string
}
export type DaemonRuntimeMode = "live" | "demo"

export interface SlideItem {
  id: string
  kicker: string
  title: string
  subtitle: string
  body: string
  bullets?: string[]
  metrics?: Array<{ label: string; value: string; note: string }>
  notes?: string
  layout?: "cover" | "scorecard" | "two-col" | "decisions" | "bullets"
}

export interface SlideDeckState {
  title: string
  templateName: string
  filePath?: string
  activeSlideIndex: number
  slides: SlideItem[]
}

export interface OpenDocTabItem {
  tab: RightTabId
  pill: string
}

export interface NavHistoryEntry {
  route: AppRoute
  sessionId: string | null
  sessionTitle: string | null
}

export interface PendingPermission {
  sessionId: string
  requestId: string
  toolName: string
  description: string
}

export interface PendingStreamPrompt {
  sessionId: string
  prompt: string
  images?: PromptImageAttachment[]
  modelId?: string
  modelLabel: string
  startedAtMs?: number
}

export interface AppStoreState {
  theme: ThemeMode
  accent: AccentColor
  activeRoute: AppRoute
  activeSessionId: string | null
  activeSessionTitle: string | null
  navHistory: NavHistoryEntry[]
  navHistoryIndex: number
  activeWorkspacePath: string | null
  daemonMode: DaemonRuntimeMode
  authState: RayuAuthState | null
  authLoaded: boolean
  authBypassed: boolean
  authDialogOpen: boolean
  pendingPermission: PendingPermission | null
  pendingStreamPrompt: PendingStreamPrompt | null
  isStreamActive: boolean
  leftCollapsed: boolean
  rightCollapsed: boolean
  rightMode: RightPaneMode
  activeRightTab: RightTabId
  activeDocPill: string | null
  activeCodeFile: string | null
  activeCodeLine: number | null
  fullView: boolean
  keepAwake: boolean
  sideChatOpen: boolean
  rightWidthPx: number | null
  chatCollapsedByRight: boolean
  gettingStartedHidden: boolean
  openFilesActiveFile: string | null
  openDocTabs: OpenDocTabItem[]
  slideDeck: SlideDeckState | null
  liveExcelWorkbook: OfficeExcelWorkbookData | null
  liveExcelWorkbookVersion: number
  activeDiagram: ActiveDiagramState
  sessionFileChangesBySession: Record<string, FileChangesSnapshot>
  selectedDiffFilePath: string | null

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setAccent: (accent: AccentColor) => void
  setActiveRoute: (route: AppRoute) => void
  setActiveSession: (sessionId: string | null, title?: string | null) => void
  setActiveSessionTitle: (title: string | null) => void
  goBack: () => void
  goForward: () => void
  setActiveWorkspacePath: (workspacePath: string | null) => void
  setDaemonMode: (mode: DaemonRuntimeMode) => void
  setAuthState: (state: RayuAuthState | null) => void
  setAuthLoaded: (loaded: boolean) => void
  setAuthBypassed: (bypassed: boolean) => void
  setAuthDialogOpen: (open: boolean) => void
  setPendingPermission: (permission: PendingPermission | null) => void
  setPendingStreamPrompt: (prompt: PendingStreamPrompt | null) => void
  setIsStreamActive: (active: boolean) => void
  toggleLeftSidebar: () => void
  setLeftCollapsed: (collapsed: boolean) => void
  toggleRightSidebar: () => void
  setRightCollapsed: (collapsed: boolean) => void
  openRightTab: (tab: RightTabId, pillLabel?: string | null) => void
  openCodeFile: (file: string, line?: number | null) => void
  openDiffFile: (filePath: string, sessionId?: string) => void
  setSessionFileChanges: (
    sessionId: string,
    snapshot: FileChangesSnapshot
  ) => void
  setSelectedDiffFilePath: (filePath: string | null) => void
  openDocPreview: (kind: DocPreviewKind, pillLabel: string) => void
  closeDocTab: (pill: string) => void
  closeDocumentToContext: () => void
  setFullView: (fullView: boolean) => void
  setKeepAwake: (keepAwake: boolean) => void
  setSideChatOpen: (open: boolean) => void
  toggleSideChat: () => void
  setRightWidthPx: (width: number | null) => void
  setChatCollapsedByRight: (collapsed: boolean) => void
  setGettingStartedHidden: (hidden: boolean) => void
  setOpenFilesActiveFile: (file: string | null) => void
  setSlideDeck: (deck: SlideDeckState | null) => void
  setLiveExcelWorkbook: (workbook: OfficeExcelWorkbookData | null) => void
  setActiveSlideIndex: (index: number) => void
  updateSlide: (slideId: string, patch: Partial<SlideItem>) => void
  addSlide: (slide?: Partial<SlideItem>) => void
  openDiagramPreview: (source: string, title?: string) => void
  setActiveDiagramSource: (source: string) => void
}

const DEFAULT_SLIDE_DECK: SlideDeckState = {
  title: "Enterprise Quarterly Business Review",
  templateName: "Business Review",
  activeSlideIndex: 0,
  slides: [
    {
      id: "slide_1",
      kicker: "Company or team name",
      title: "Enterprise Quarterly Business Review",
      subtitle: "Q3 2026",
      body: "A structured review of Q1 2026 performance, strategic outcomes, and the operational plan for Q2. This deck covers our scorecard against targets, key initiatives delivered, value created, critical learnings, and the decisions needed to accelerate execution in the next quarter.",
      notes:
        "Framed from repository documentation; external revenue/adoption KPIs marked as unavailable until provided.",
      layout: "cover",
    },
    {
      id: "slide_2",
      kicker: "Executive Scorecard · Product & Architecture",
      title: "Platform Capabilities & Operational Readiness",
      subtitle: "Repository-Verified Highlights",
      body: "Core harness, desktop client, and multi-agent swarm capabilities verified directly from workspace source and CI checks.",
      metrics: [
        {
          label: "Session Lookup Latency",
          value: "144 ns p99",
          note: "−30.2% via ShardStore::lookup",
        },
        {
          label: "Warm KV Cache Hit Rate",
          value: "94.2%",
          note: "Shared prefix across CLI & Desktop",
        },
        {
          label: "Business Revenue KPIs",
          value: "Unavailable",
          note: "Not present in repository README",
        },
      ],
      notes:
        "Highlight technical metrics verified in repository and explicitly mark financial KPIs as unavailable.",
      layout: "scorecard",
    },
    {
      id: "slide_3",
      kicker: "Architecture & Delivery",
      title: "Key Initiatives Delivered in Repository",
      subtitle: "Engineering & Desktop Milestones",
      body: "Unified daemon bridge, sandboxed Electron 45 desktop shell, and real MCP plugin configuration.",
      bullets: [
        "Shared Rayu daemon over local Unix socket with automatic launch & auth sync",
        "Interactive Excel formula grid, Markdown preview, and PowerPoint Slide Studio",
        "Multi-agent Swarm worktree isolation with automated verification gates",
        "Zero-trust permission gate with per-conversation and always-allow controls",
      ],
      notes: "Walk through the four pillars shipped in the current release branch.",
      layout: "two-col",
    },
    {
      id: "slide_4",
      kicker: "Next Quarter Execution",
      title: "Decisions Needed & Next Steps",
      subtitle: "Q4 2026 Priorities",
      body: "Key alignment items for engineering, product, and go-to-market stakeholders.",
      bullets: [
        "Attach financial actuals CSV to populate revenue & adoption scorecard cells",
        "Approve production rollout of ShardStore session cache retirement",
        "Finalize default MCP plugin bundle for enterprise workspaces",
      ],
      notes: "Confirm owners and target dates before exporting final PowerPoint deck.",
      layout: "decisions",
    },
  ],
}

const DEFAULT_TAB_PILLS: Record<RightTabId, string | null> = {
  overview: null,
  terminal: "Terminal",
  diff: "Changes",
  browser: "localhost:3000",
  files: "Files",
  code: "Code",
  excel: "Excel",
  markdown: "Markdown",
  slide: "Slide",
  diagram: "Flowchart",
}

const DEFAULT_DIAGRAM_STATE: ActiveDiagramState = {
  title: "RayuCode Architecture",
  source: `flowchart LR
  subgraph Renderer["Renderer: React 19 + Vite"]
    UI[Feature views] --> IPC[ipc-client facade]
    IPC --> Store[Zustand app-store]
    IPC --> TQ[TanStack Query]
    IPC --> Batch[16ms stream batcher]
  end
  subgraph Preload["preload.cjs (sandboxed)"]
    Bridge["contextBridge: window.rayu"]
  end
  subgraph Main["Electron main"]
    H[56 IPC handlers + Zod]
    DC[RayuDaemonClient]
    AM[RayuAuthManager]
    FS[fs / git / gh / shell]
  end
  SDK["@rayu-dev/rayucode-sdk"]
  Rust["Rust rayu daemon"]
  Cloud["Rayu Cloud gateway + API"]

  UI --> Bridge --> H
  H --> DC --> SDK --> Rust
  H --> AM --> Cloud
  H --> FS
  Batch --> UI`,
}

function readInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark"
  try {
    const saved = window.localStorage.getItem("rayu-theme")
    return saved === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

function readInitialAccent(): AccentColor {
  if (typeof window === "undefined") return "green"
  try {
    const saved = window.localStorage.getItem("rayu-accent")
    return saved === "blue" ? "blue" : "green"
  } catch {
    return "green"
  }
}

function readInitialGettingStartedHidden(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem("rayu-getting-started-hidden") === "true"
  } catch {
    return false
  }
}

export function syncThemeToDom(theme: ThemeMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme)
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem("rayu-theme", theme)
    } catch {
      // ignore storage errors in restricted contexts
    }
  }
}

export function syncAccentToDom(accent: AccentColor): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-accent", accent)
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem("rayu-accent", accent)
    } catch {
      // ignore storage errors in restricted contexts
    }
  }
}

const IS_TEST_ENV = import.meta.env.MODE === "test"

export const useAppStore = create<AppStoreState>((set, get) => ({
  theme: readInitialTheme(),
  accent: readInitialAccent(),
  activeRoute: "home",
  activeSessionId: null,
  activeSessionTitle: null,
  navHistory: [{ route: "home", sessionId: null, sessionTitle: null }],
  navHistoryIndex: 0,
  activeWorkspacePath: null,
  daemonMode: "demo",
  authState: null,
  authLoaded: false,
  authBypassed: false,
  authDialogOpen: false,
  pendingPermission: null,
  pendingStreamPrompt: null,
  isStreamActive: false,
  leftCollapsed: false,
  rightCollapsed: true,
  rightMode: "context",
  activeRightTab: "overview",
  activeDocPill: null,
  activeCodeFile: IS_TEST_ENV ? "lookup.rs" : null,
  activeCodeLine: IS_TEST_ENV ? 21 : null,
  fullView: false,
  keepAwake: false,
  sideChatOpen: false,
  rightWidthPx: null,
  chatCollapsedByRight: false,
  gettingStartedHidden: readInitialGettingStartedHidden(),
  openFilesActiveFile: null,
  openDocTabs: IS_TEST_ENV
    ? [
        { tab: "markdown", pill: "template_following.md" },
        { tab: "slide", pill: "Slide" },
      ]
    : [],
  slideDeck: IS_TEST_ENV ? DEFAULT_SLIDE_DECK : null,
  liveExcelWorkbook: null,
  liveExcelWorkbookVersion: 0,
  activeDiagram: DEFAULT_DIAGRAM_STATE,
  sessionFileChangesBySession: {},
  selectedDiffFilePath: null,

  setTheme: (theme) => {
    syncThemeToDom(theme)
    set({ theme })
  },

  toggleTheme: () => {
    const next: ThemeMode = get().theme === "light" ? "dark" : "light"
    syncThemeToDom(next)
    set({ theme: next })
  },

  setAccent: (accent) => {
    syncAccentToDom(accent)
    set({ accent })
  },

  setActiveRoute: (activeRoute) => {
    set((state) => {
      const nextEntry: NavHistoryEntry = {
        route: activeRoute,
        sessionId: activeRoute === "workspace" ? state.activeSessionId : null,
        sessionTitle:
          activeRoute === "workspace" ? state.activeSessionTitle : null,
      }
      const current = state.navHistory[state.navHistoryIndex]
      const isSame =
        current &&
        current.route === nextEntry.route &&
        current.sessionId === nextEntry.sessionId
      const nextHistory = isSame
        ? state.navHistory
        : [
            ...state.navHistory.slice(0, state.navHistoryIndex + 1),
            nextEntry,
          ].slice(-50)
      return {
        activeRoute,
        navHistory: nextHistory,
        navHistoryIndex: nextHistory.length - 1,
        rightCollapsed: activeRoute === "home" ? true : state.rightCollapsed,
      }
    })
  },

  setActiveSession: (activeSessionId, title) => {
    set((state) => {
      const resolvedRoute: AppRoute = activeSessionId ? "workspace" : "home"
      const resolvedTitle =
        activeSessionId === null
          ? null
          : title !== undefined
            ? title
            : null
      const nextEntry: NavHistoryEntry = {
        route: resolvedRoute,
        sessionId: activeSessionId,
        sessionTitle: resolvedTitle,
      }
      const current = state.navHistory[state.navHistoryIndex]
      const isSame =
        current &&
        current.route === nextEntry.route &&
        current.sessionId === nextEntry.sessionId
      const nextHistory = isSame
        ? state.navHistory
        : [
            ...state.navHistory.slice(0, state.navHistoryIndex + 1),
            nextEntry,
          ].slice(-50)
      return {
        activeSessionId,
        activeSessionTitle: resolvedTitle,
        activeRoute: resolvedRoute,
        navHistory: nextHistory,
        navHistoryIndex: nextHistory.length - 1,
        rightCollapsed: !activeSessionId,
        rightMode: "context",
        activeRightTab: "overview",
        activeDocPill: null,
        fullView: false,
        chatCollapsedByRight: false,
      }
    })
  },

  setActiveSessionTitle: (activeSessionTitle) => {
    set({ activeSessionTitle })
  },

  goBack: () => {
    set((state) => {
      if (state.navHistoryIndex <= 0) return state
      const nextIndex = state.navHistoryIndex - 1
      const target = state.navHistory[nextIndex]
      if (!target) return state
      return {
        navHistoryIndex: nextIndex,
        activeRoute: target.route,
        activeSessionId: target.sessionId,
        activeSessionTitle: target.sessionTitle,
        rightCollapsed: target.route === "home" ? true : state.rightCollapsed,
        chatCollapsedByRight: false,
      }
    })
  },

  goForward: () => {
    set((state) => {
      if (state.navHistoryIndex >= state.navHistory.length - 1) return state
      const nextIndex = state.navHistoryIndex + 1
      const target = state.navHistory[nextIndex]
      if (!target) return state
      return {
        navHistoryIndex: nextIndex,
        activeRoute: target.route,
        activeSessionId: target.sessionId,
        activeSessionTitle: target.sessionTitle,
        rightCollapsed: target.route === "home" ? true : state.rightCollapsed,
        chatCollapsedByRight: false,
      }
    })
  },

  setActiveWorkspacePath: (activeWorkspacePath) => {
    set({ activeWorkspacePath })
  },

  setDaemonMode: (daemonMode) => {
    set({ daemonMode })
  },

  setAuthState: (authState) => {
    set({ authState })
  },

  setAuthLoaded: (authLoaded) => {
    set({ authLoaded })
  },

  setAuthBypassed: (authBypassed) => {
    set({ authBypassed })
  },

  setAuthDialogOpen: (authDialogOpen) => {
    set({ authDialogOpen })
  },

  setPendingPermission: (pendingPermission) => {
    set({ pendingPermission })
  },

  setPendingStreamPrompt: (pendingStreamPrompt) => {
    set({ pendingStreamPrompt })
  },

  setIsStreamActive: (isStreamActive) => {
    set({ isStreamActive })
  },

  toggleLeftSidebar: () => {
    set((state) => ({ leftCollapsed: !state.leftCollapsed }))
  },

  setLeftCollapsed: (leftCollapsed) => {
    set({ leftCollapsed })
  },

  toggleRightSidebar: () => {
    set((state) => ({
      rightCollapsed: !state.rightCollapsed,
      fullView: state.rightCollapsed ? state.fullView : false,
      chatCollapsedByRight: state.rightCollapsed
        ? state.chatCollapsedByRight
        : false,
    }))
  },

  setRightCollapsed: (rightCollapsed) => {
    set((state) => ({
      rightCollapsed,
      fullView: rightCollapsed ? false : state.fullView,
      chatCollapsedByRight: rightCollapsed ? false : state.chatCollapsedByRight,
    }))
  },

  openRightTab: (tab, pillLabel) => {
    if (tab === "overview") {
      set({
        rightCollapsed: false,
        rightMode: "context",
        activeRightTab: "overview",
        activeDocPill: null,
        fullView: false,
      })
      return
    }
    const resolvedPill =
      pillLabel !== undefined ? pillLabel : DEFAULT_TAB_PILLS[tab]
    set((state) => {
      const nextTabs = resolvedPill
        ? state.openDocTabs.some((t) => t.pill === resolvedPill)
          ? state.openDocTabs
          : [...state.openDocTabs, { tab, pill: resolvedPill }].slice(-5)
        : state.openDocTabs
      return {
        rightCollapsed: false,
        rightMode: "document",
        activeRightTab: tab,
        activeDocPill: resolvedPill,
        openDocTabs: nextTabs,
      }
    })
  },

  openCodeFile: (file, line = null) => {
    set((state) => ({
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: "code",
      activeDocPill: file,
      activeCodeFile: file,
      activeCodeLine: line,
      openDocTabs: state.openDocTabs.some((t) => t.pill === file)
        ? state.openDocTabs
        : [
            ...state.openDocTabs,
            { tab: "code" as RightTabId, pill: file },
          ].slice(-5),
    }))
  },

  openDiffFile: (filePath, sessionId) => {
    const pill = DEFAULT_TAB_PILLS.diff ?? "Changes"
    set((state) => ({
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: "diff",
      activeDocPill: pill,
      selectedDiffFilePath: filePath,
      activeSessionId: sessionId ?? state.activeSessionId,
      openDocTabs: state.openDocTabs.some(
        (t) => t.tab === "diff" && t.pill === pill
      )
        ? state.openDocTabs
        : [
            ...state.openDocTabs,
            { tab: "diff" as RightTabId, pill },
          ].slice(-5),
    }))
  },

  setSessionFileChanges: (sessionId, snapshot) => {
    if (!sessionId) return
    set((state) => ({
      sessionFileChangesBySession: {
        ...state.sessionFileChangesBySession,
        [sessionId]: snapshot,
      },
    }))
  },

  setSelectedDiffFilePath: (selectedDiffFilePath) => {
    set({ selectedDiffFilePath })
  },

  openDocPreview: (kind, pillLabel) => {
    const tabMap: Record<DocPreviewKind, RightTabId> = {
      code: "code",
      excel: "excel",
      markdown: "markdown",
      browser: "browser",
      terminal: "terminal",
      diff: "diff",
      files: "files",
      slide: "slide",
      diagram: "diagram",
    }
    const targetTab = tabMap[kind]
    set((state) => ({
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: targetTab,
      activeDocPill: pillLabel,
      activeCodeFile: kind === "code" ? pillLabel : state.activeCodeFile,
      openDocTabs: state.openDocTabs.some((t) => t.pill === pillLabel)
        ? state.openDocTabs
        : [...state.openDocTabs, { tab: targetTab, pill: pillLabel }].slice(-5),
    }))
  },

  closeDocTab: (pill) => {
    set((state) => {
      const remaining = state.openDocTabs.filter((t) => t.pill !== pill)
      if (remaining.length === 0 || state.activeDocPill === pill) {
        const fallback = remaining[remaining.length - 1]
        if (!fallback) {
          return {
            openDocTabs: [],
            rightMode: "context",
            activeRightTab: "overview",
            activeDocPill: null,
            fullView: false,
          }
        }
        return {
          openDocTabs: remaining,
          activeRightTab: fallback.tab,
          activeDocPill: fallback.pill,
        }
      }
      return { openDocTabs: remaining }
    })
  },

  closeDocumentToContext: () => {
    set({
      rightMode: "context",
      activeRightTab: "overview",
      activeDocPill: null,
      fullView: false,
      chatCollapsedByRight: false,
    })
  },

  setFullView: (fullView) => {
    set((state) => ({
      fullView,
      rightCollapsed: fullView ? false : state.rightCollapsed,
    }))
  },

  setKeepAwake: (keepAwake) => {
    set({ keepAwake })
  },

  setSideChatOpen: (sideChatOpen) => {
    set({ sideChatOpen })
  },

  toggleSideChat: () => {
    set((state) => ({ sideChatOpen: !state.sideChatOpen }))
  },

  setRightWidthPx: (rightWidthPx) => {
    set({ rightWidthPx })
  },

  setChatCollapsedByRight: (chatCollapsedByRight) => {
    set({ chatCollapsedByRight })
  },

  setGettingStartedHidden: (gettingStartedHidden) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          "rayu-getting-started-hidden",
          gettingStartedHidden ? "true" : "false"
        )
      } catch {
        // ignore storage errors
      }
    }
    set({ gettingStartedHidden })
  },

  setOpenFilesActiveFile: (openFilesActiveFile) => {
    set({ openFilesActiveFile })
  },

  setSlideDeck: (slideDeck) => {
    set({ slideDeck })
  },

  setLiveExcelWorkbook: (liveExcelWorkbook) => {
    set((state) => ({
      liveExcelWorkbook,
      liveExcelWorkbookVersion: state.liveExcelWorkbookVersion + 1,
    }))
  },

  setActiveSlideIndex: (activeSlideIndex) => {
    set((state) => {
      if (!state.slideDeck || state.slideDeck.slides.length === 0) return state
      return {
        slideDeck: {
          ...state.slideDeck,
          activeSlideIndex: Math.max(
            0,
            Math.min(activeSlideIndex, state.slideDeck.slides.length - 1)
          ),
        },
      }
    })
  },

  updateSlide: (slideId, patch) => {
    set((state) => {
      if (!state.slideDeck) return state
      return {
        slideDeck: {
          ...state.slideDeck,
          slides: state.slideDeck.slides.map((s) =>
            s.id === slideId ? { ...s, ...patch } : s
          ),
        },
      }
    })
  },

  addSlide: (partial) => {
    set((state) => {
      const baseDeck: SlideDeckState = state.slideDeck ?? {
        title: partial?.title ?? "Untitled Presentation",
        templateName: "Custom Deck",
        activeSlideIndex: 0,
        slides: [],
      }
      const nextNum = baseDeck.slides.length + 1
      const newSlide: SlideItem = {
        id: `slide_${Date.now()}`,
        kicker: partial?.kicker ?? `${baseDeck.templateName} · Slide ${nextNum}`,
        title: partial?.title ?? `Slide ${nextNum} Title`,
        subtitle: partial?.subtitle ?? "",
        body:
          partial?.body ??
          "Click any text on this slide or use Request edits to customize the layout and key takeaways.",
        bullets: partial?.bullets,
        metrics: partial?.metrics,
        notes: partial?.notes ?? "Speaker notes for this slide.",
        layout: partial?.layout ?? "cover",
      }
      const nextSlides = [...baseDeck.slides, newSlide]
      return {
        slideDeck: {
          ...baseDeck,
          slides: nextSlides,
          activeSlideIndex: nextSlides.length - 1,
        },
      }
    })
  },

  openDiagramPreview: (source, title) => {
    const pill = title?.trim() || "Flowchart"
    set((state) => ({
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: "diagram",
      activeDocPill: pill,
      activeDiagram: {
        title: pill,
        source,
      },
      openDocTabs: state.openDocTabs.some((t) => t.pill === pill)
        ? state.openDocTabs
        : [
            ...state.openDocTabs,
            { tab: "diagram" as RightTabId, pill },
          ].slice(-5),
    }))
  },

  setActiveDiagramSource: (source) => {
    set((state) => ({
      activeDiagram: {
        ...state.activeDiagram,
        source,
      },
    }))
  },
}))

const VALID_ROUTES = new Set<AppRoute>([
  "home",
  "workspace",
  "swarm",
  "automations",
  "plugins",
  "changes",
  "telegram",
  "settings",
])

const VALID_TABS = new Set<RightTabId>([
  "overview",
  "terminal",
  "diff",
  "browser",
  "files",
  "code",
  "excel",
  "markdown",
  "slide",
  "diagram",
])

export function applyUrlQueryParamsToStore(search?: string): void {
  const queryString =
    search !== undefined
      ? search
      : typeof window !== "undefined"
        ? window.location.search
        : ""
  if (!queryString) return

  const params = new URLSearchParams(queryString)
  const store = useAppStore.getState()

  const themeParam = params.get("theme")
  if (themeParam === "dark" || themeParam === "light") {
    store.setTheme(themeParam)
  }

  const accentParam = params.get("accent")
  if (accentParam === "green" || accentParam === "blue") {
    store.setAccent(accentParam)
  }

  const routeParam = params.get("route") as AppRoute | null
  const sessionParam = params.get("session")
  const tabParam = params.get("tab")

  if (routeParam && VALID_ROUTES.has(routeParam)) {
    if (routeParam === "workspace") {
      const defaultSession =
        sessionParam ??
        (IS_TEST_ENV
          ? tabParam === "excel"
            ? "ses_q4_excel"
            : "ses_retire_cache"
          : store.activeSessionId)
      useAppStore.setState({
        activeRoute: "workspace",
        activeSessionId: defaultSession,
      })
    } else {
      useAppStore.setState({
        activeRoute: routeParam,
        activeSessionId:
          sessionParam !== null ? sessionParam : store.activeSessionId,
      })
    }
  } else if (sessionParam) {
    store.setActiveSession(sessionParam)
  }

  if (tabParam === "context" || tabParam === "overview") {
    store.openRightTab("overview", null)
  } else if (tabParam && VALID_TABS.has(tabParam as RightTabId)) {
    const rightTab = tabParam as RightTabId
    const pillParam = params.get("pill")
    if (rightTab === "code") {
      const fileParam =
        params.get("file") ?? pillParam ?? (IS_TEST_ENV ? "lookup.rs" : "")
      const lineParam = params.get("line")
      if (fileParam) {
        store.openCodeFile(
          fileParam,
          lineParam !== null ? Number(lineParam) : null
        )
      }
    } else if (rightTab === "diff") {
      const fileParam = params.get("file")
      if (fileParam) {
        store.openDiffFile(fileParam, sessionParam ?? undefined)
      } else {
        store.openRightTab(
          rightTab,
          pillParam !== null ? pillParam : DEFAULT_TAB_PILLS[rightTab]
        )
      }
    } else {
      store.openRightTab(
        rightTab,
        pillParam !== null ? pillParam : DEFAULT_TAB_PILLS[rightTab]
      )
    }
  } else if (params.has("file")) {
    const fileParam = params.get("file")
    const lineParam = params.get("line")
    if (fileParam) {
      store.openCodeFile(
        fileParam,
        lineParam !== null ? Number(lineParam) : null
      )
    }
  }

  const fullviewParam = params.get("fullview")
  if (fullviewParam === "1" || fullviewParam === "true") {
    store.setFullView(true)
  } else if (fullviewParam === "0" || fullviewParam === "false") {
    store.setFullView(false)
  }

  const leftCollapsedParam = params.get("leftCollapsed")
  if (leftCollapsedParam === "1" || leftCollapsedParam === "true") {
    store.setLeftCollapsed(true)
  }

  const rightCollapsedParam = params.get("rightCollapsed")
  if (rightCollapsedParam === "1" || rightCollapsedParam === "true") {
    store.setRightCollapsed(true)
  }
}

if (typeof window !== "undefined" && window.location.search) {
  applyUrlQueryParamsToStore(window.location.search)
}

