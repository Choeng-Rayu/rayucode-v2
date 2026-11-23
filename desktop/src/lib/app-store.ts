import { create } from "zustand"

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

export type DocPreviewKind = "code" | "excel" | "markdown" | "browser" | "terminal" | "diff" | "files"
export type DaemonRuntimeMode = "live" | "demo"

export interface PendingPermission {
  sessionId: string
  requestId: string
  toolName: string
  description: string
}

export interface AppStoreState {
  theme: ThemeMode
  accent: AccentColor
  activeRoute: AppRoute
  activeSessionId: string | null
  activeWorkspacePath: string | null
  daemonMode: DaemonRuntimeMode
  pendingPermission: PendingPermission | null
  leftCollapsed: boolean
  rightCollapsed: boolean
  rightMode: RightPaneMode
  activeRightTab: RightTabId
  activeDocPill: string | null
  activeCodeFile: string | null
  activeCodeLine: number | null
  fullView: boolean

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setAccent: (accent: AccentColor) => void
  setActiveRoute: (route: AppRoute) => void
  setActiveSession: (sessionId: string | null) => void
  setActiveWorkspacePath: (workspacePath: string | null) => void
  setDaemonMode: (mode: DaemonRuntimeMode) => void
  setPendingPermission: (permission: PendingPermission | null) => void
  toggleLeftSidebar: () => void
  setLeftCollapsed: (collapsed: boolean) => void
  toggleRightSidebar: () => void
  setRightCollapsed: (collapsed: boolean) => void
  openRightTab: (tab: RightTabId, pillLabel?: string | null) => void
  openCodeFile: (file: string, line?: number | null) => void
  openDocPreview: (kind: DocPreviewKind, pillLabel: string) => void
  closeDocumentToContext: () => void
  setFullView: (fullView: boolean) => void
}

const DEFAULT_TAB_PILLS: Record<RightTabId, string | null> = {
  overview: null,
  terminal: "rayu daemon",
  diff: "3 changed files",
  browser: "localhost:3000",
  files: "MIGRATION_PLAN.md",
  code: "lookup.rs",
  excel: "Q4-Token-Cost-Model.xlsx",
  markdown: "MIGRATION_PLAN.md",
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

export const useAppStore = create<AppStoreState>((set, get) => ({
  theme: readInitialTheme(),
  accent: readInitialAccent(),
  activeRoute: "home",
  activeSessionId: null,
  activeWorkspacePath: null,
  daemonMode: "demo",
  pendingPermission: null,
  leftCollapsed: false,
  rightCollapsed: false,
  rightMode: "context",
  activeRightTab: "overview",
  activeDocPill: null,
  activeCodeFile: "lookup.rs",
  activeCodeLine: 21,
  fullView: false,

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
    set({ activeRoute })
  },

  setActiveSession: (activeSessionId) => {
    set({
      activeSessionId,
      activeRoute: activeSessionId ? "workspace" : "home",
    })
  },

  setActiveWorkspacePath: (activeWorkspacePath) => {
    set({ activeWorkspacePath })
  },

  setDaemonMode: (daemonMode) => {
    set({ daemonMode })
  },

  setPendingPermission: (pendingPermission) => {
    set({ pendingPermission })
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
    }))
  },

  setRightCollapsed: (rightCollapsed) => {
    set((state) => ({
      rightCollapsed,
      fullView: rightCollapsed ? false : state.fullView,
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
    set({
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: tab,
      activeDocPill: resolvedPill,
    })
  },

  openCodeFile: (file, line = null) => {
    set({
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: "code",
      activeDocPill: file,
      activeCodeFile: file,
      activeCodeLine: line,
    })
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
    }
    const targetTab = tabMap[kind]
    set((state) => ({
      rightCollapsed: false,
      rightMode: "document",
      activeRightTab: targetTab,
      activeDocPill: pillLabel,
      activeCodeFile: kind === "code" ? pillLabel : state.activeCodeFile,
    }))
  },

  closeDocumentToContext: () => {
    set({
      rightMode: "context",
      activeRightTab: "overview",
      activeDocPill: null,
      fullView: false,
    })
  },

  setFullView: (fullView) => {
    set((state) => ({
      fullView,
      rightCollapsed: fullView ? false : state.rightCollapsed,
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
        (tabParam === "excel" ? "ses_q4_excel" : "ses_retire_cache")
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
      const fileParam = params.get("file") ?? pillParam ?? "lookup.rs"
      const lineParam = params.get("line")
      store.openCodeFile(
        fileParam,
        lineParam !== null ? Number(lineParam) : 21
      )
    } else {
      store.openRightTab(
        rightTab,
        pillParam !== null ? pillParam : DEFAULT_TAB_PILLS[rightTab]
      )
    }
  } else if (params.has("file")) {
    const fileParam = params.get("file") ?? "lookup.rs"
    const lineParam = params.get("line")
    store.openCodeFile(
      fileParam,
      lineParam !== null ? Number(lineParam) : 21
    )
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

