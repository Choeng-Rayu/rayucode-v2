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

export interface AppStoreState {
  theme: ThemeMode
  accent: AccentColor
  activeRoute: AppRoute
  activeSessionId: string | null
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
