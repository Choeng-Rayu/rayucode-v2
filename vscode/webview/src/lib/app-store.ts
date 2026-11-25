import {
  createOrReuseDraft,
  type ProvisionalDraftSession,
} from "@rayu-dev/rayucode-session-core/client";
import { create } from "zustand";
import type {
  AccentPreference,
  AccountStatusView,
  AppRoute,
  BackgroundProcessView,
  DaemonStatusView,
  DensityPreference,
  EditorSelectionView,
  FileChangesSnapshotView,
  HostToWebviewMessage,
  SurfaceKind,
  ThemePreference,
  WorkspaceFolderView,
  WorkspaceLedgerView,
} from "@shared/vscodeProtocol";

import type { PendingPermissionRequest } from "./harness-adapter";
import { setMediaBaseUri } from "./media-url";
import { postToHost } from "./rpc-client";

export type {
  AccentPreference,
  AppRoute,
  DensityPreference,
  SurfaceKind,
  ThemePreference,
};

export type ResolvedThemePolarity = "dark" | "light";
export type RightPaneMode = "context" | "document";

export type RightTabId =
  | "overview"
  | "tools"
  | "artifacts"
  | "files"
  | "terminal"
  | "diff"
  | "browser"
  | "code"
  | "markdown"
  | "diagram"
  | "sidePanel";

export type InspectorTabId = RightTabId;

export interface OpenDocTabItem {
  tab: RightTabId;
  pill: string;
}

export interface NavHistoryEntry {
  route: AppRoute;
  sessionId: string | null;
  sessionTitle: string | null;
}

export interface ActiveDiagramState {
  title: string;
  source: string;
}

export interface OptimisticUserTurn {
  id: string;
  sessionId: string;
  prompt: string;
  refFiles?: string;
  images?: Array<{ name: string; dataUrl: string }>;
  createdAtMs: number;
  baseHistoryTurnCount?: number;
}

export interface AppStoreState {
  // Surface & navigation
  surface: SurfaceKind;
  route: AppRoute;
  activeRoute: AppRoute;
  navHistory: NavHistoryEntry[];
  navHistoryIndex: number;

  // Appearance
  theme: ThemePreference;
  resolvedTheme: ResolvedThemePolarity;
  accent: AccentPreference;
  density: DensityPreference;
  reduceMotion: boolean;
  highContrast: boolean;

  // Sessions & workspace
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  activeProjectPath: string | null;
  workspaces: WorkspaceFolderView[];
  workspaceLedger: WorkspaceLedgerView | null;
  activeDraft: ProvisionalDraftSession | null;
  editorSelection: EditorSelectionView | null;

  // Shell chrome & drawers
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  inspectorOpen: boolean;
  rightMode: RightPaneMode;
  inspectorTab: RightTabId;
  activeRightTab: RightTabId;
  activeDocPill: string | null;
  activeCodeFile: string | null;
  activeCodeLine: number | null;
  openDocTabs: OpenDocTabItem[];
  fullView: boolean;
  rightWidthPx: number | null;
  chatCollapsedByRight: boolean;
  backgroundDrawerOpen: boolean;
  backgroundTasks: BackgroundProcessView[];
  fileChangesBySession: Record<string, FileChangesSnapshotView>;

  // Daemon, Auth & Notifications
  daemonStatus: DaemonStatusView;
  capabilities: string[];
  accountStatus: AccountStatusView | null;
  authLoaded: boolean;
  authBypassed: boolean;
  authDialogOpen: boolean;
  pendingPermission: PendingPermissionRequest | null;
  isStreamActive: boolean;
  keepAwake: boolean;
  unreadNotifications: number;
  activeDiagram: ActiveDiagramState;
  pendingUserTurn: OptimisticUserTurn | null;
  sessionSearchFocusNonce: number;
  composerFocusNonce: number;

  // Actions
  setSurface: (surface: SurfaceKind) => void;
  setTheme: (theme: ThemePreference, syncHost?: boolean) => void;
  setResolvedTheme: (polarity: ResolvedThemePolarity) => void;
  setHighContrast: (hc: boolean) => void;
  cycleTheme: () => void;
  setAccent: (accent: AccentPreference, syncHost?: boolean) => void;
  toggleAccent: () => void;
  setDensity: (density: DensityPreference, syncHost?: boolean) => void;
  setReduceMotion: (reduce: boolean, syncHost?: boolean) => void;

  setRoute: (route: AppRoute) => void;
  setActiveRoute: (route: AppRoute) => void;
  setActiveSession: (sessionId: string | null, title?: string | null) => void;
  setActiveSessionTitle: (title: string | null) => void;
  setActiveProjectPath: (path: string | null) => void;
  setWorkspaces: (workspaces: WorkspaceFolderView[]) => void;
  setWorkspaceLedger: (ledger: WorkspaceLedgerView | null) => void;
  openNewChatDraft: (target?: {
    workingDir?: string | null;
    workspaceId?: string | null;
    model?: string;
    reasoningEffort?: string;
    permissionMode?: string;
  }) => ProvisionalDraftSession;
  updateActiveDraft: (
    patch: Partial<
      Pick<
        ProvisionalDraftSession,
        "workingDir" | "workspaceId" | "model" | "reasoningEffort" | "permissionMode"
      >
    >,
  ) => void;
  clearActiveDraft: () => void;
  setEditorSelection: (selection: EditorSelectionView | null) => void;
  goBack: () => void;
  goForward: () => void;

  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setInspectorTab: (tab: RightTabId) => void;
  openRightTab: (tab: RightTabId, pillLabel?: string | null) => void;
  openCodeFile: (file: string, line?: number | null) => void;
  closeDocTab: (pill: string) => void;
  closeDocumentToContext: () => void;
  setFullView: (fullView: boolean) => void;
  setRightWidthPx: (width: number | null) => void;
  setChatCollapsedByRight: (collapsed: boolean) => void;
  setBackgroundDrawerOpen: (open: boolean) => void;
  toggleBackgroundDrawer: () => void;
  setBackgroundTasks: (tasks: BackgroundProcessView[]) => void;
  setFileChangesSnapshot: (
    sessionId: string,
    snapshot: FileChangesSnapshotView,
  ) => void;

  setDaemonStatus: (status: DaemonStatusView) => void;
  setAccountStatus: (status: AccountStatusView | null) => void;
  setAuthLoaded: (loaded: boolean) => void;
  setAuthBypassed: (bypassed: boolean) => void;
  setAuthDialogOpen: (open: boolean) => void;
  setPendingPermission: (perm: PendingPermissionRequest | null) => void;
  setIsStreamActive: (active: boolean) => void;
  setKeepAwake: (keepAwake: boolean) => void;
  setUnreadNotifications: (count: number) => void;
  openDiagramPreview: (source: string, title?: string) => void;
  setActiveDiagramSource: (source: string) => void;
  enqueueOptimisticTurn: (turn: OptimisticUserTurn) => void;
  consumeOptimisticTurn: (id: string) => void;
  requestSessionSearchFocus: () => void;
  requestComposerFocus: () => void;
  applyHostMessage: (msg: HostToWebviewMessage) => void;
}

const DEFAULT_DAEMON_STATUS: DaemonStatusView = {
  state: "connecting",
  capabilities: [],
};

const DEFAULT_TAB_PILLS: Record<RightTabId, string | null> = {
  overview: null,
  tools: null,
  artifacts: null,
  files: "Files",
  terminal: "Terminal",
  diff: "Changes",
  browser: "Preview",
  code: "Code",
  markdown: "Markdown",
  diagram: "Diagram",
  sidePanel: "Side Panel",
};

const CONTEXT_MODE_TABS = new Set<RightTabId>(["overview", "tools", "artifacts"]);

const DEFAULT_DIAGRAM_STATE: ActiveDiagramState = {
  title: "RayuCode VS Code Architecture",
  source: `flowchart LR
  subgraph Webview["React 19 Webview"]
    Shell[AppShell] --> RPC[rpc-client]
    RPC --> Store[Zustand Store]
  end
  subgraph Host["Extension Host"]
    Bridge[RPC Router] --> Daemon[rayu serve]
  end
  Shell --> Bridge`,
};

export function detectVsCodeBodyPolarity(): {
  polarity: ResolvedThemePolarity;
  highContrast: boolean;
} {
  if (typeof document === "undefined") {
    return { polarity: "dark", highContrast: false };
  }
  const cls = document.body.classList;
  const isLight =
    cls.contains("vscode-light") || cls.contains("vscode-high-contrast-light");
  const highContrast =
    cls.contains("vscode-high-contrast") ||
    cls.contains("vscode-high-contrast-light");
  return {
    polarity: isLight ? "light" : "dark",
    highContrast,
  };
}

export function resolveThemePolarity(
  theme: ThemePreference,
): ResolvedThemePolarity {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return detectVsCodeBodyPolarity().polarity;
}

export function syncThemeToDom(
  theme: ThemePreference,
  resolvedPolarity?: ResolvedThemePolarity,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const polarity = resolvedPolarity ?? resolveThemePolarity(theme);
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-resolved-theme", polarity);
  const { highContrast } = detectVsCodeBodyPolarity();
  if (highContrast) {
    root.setAttribute("data-hc", "true");
  } else {
    root.removeAttribute("data-hc");
  }
}

export function syncAccentToDom(accent: AccentPreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-accent", accent);
}

export function syncDensityToDom(density: DensityPreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", density);
}

export function syncReduceMotionToDom(reduceMotion: boolean): void {
  if (typeof document === "undefined") return;
  if (reduceMotion) {
    document.documentElement.setAttribute("data-reduce-motion", "true");
  } else {
    document.documentElement.removeAttribute("data-reduce-motion");
  }
}

/**
 * Watches `document.body.classList` for VS Code theme class changes
 * (`vscode-light`, `vscode-dark`, `vscode-high-contrast*`) and keeps
 * `data-theme`, `data-resolved-theme`, and `data-hc` synchronized.
 */
export function installVsCodePolarityObserver(): () => void {
  if (typeof document === "undefined") return () => {};

  const apply = () => {
    const state = useAppStore.getState();
    const { polarity, highContrast } = detectVsCodeBodyPolarity();
    const resolved =
      state.theme === "light"
        ? "light"
        : state.theme === "dark"
          ? "dark"
          : polarity;
    syncThemeToDom(state.theme, resolved);
    if (state.resolvedTheme !== resolved) {
      state.setResolvedTheme(resolved);
    }
    if (state.highContrast !== highContrast) {
      state.setHighContrast(highContrast);
    }
  };

  apply();

  if (typeof MutationObserver === "undefined") {
    return () => {};
  }

  const observer = new MutationObserver(apply);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function detectInitialSurface(): SurfaceKind {
  if (typeof window !== "undefined" && window.__RAYU_SURFACE__ === "sidebar") {
    return "sidebar";
  }
  return "editorPanel";
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  surface: detectInitialSurface(),
  route: "home",
  activeRoute: "home",
  navHistory: [{ route: "home", sessionId: null, sessionTitle: null }],
  navHistoryIndex: 0,

  theme: "auto",
  resolvedTheme: resolveThemePolarity("auto"),
  accent: "green",
  density: "comfortable",
  reduceMotion: false,
  highContrast: detectVsCodeBodyPolarity().highContrast,

  activeSessionId: null,
  activeSessionTitle: null,
  activeProjectPath: null,
  workspaces: [],
  workspaceLedger: null,
  activeDraft: null,
  editorSelection: null,

  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  inspectorOpen: false,
  rightMode: "context",
  inspectorTab: "overview",
  activeRightTab: "overview",
  activeDocPill: null,
  activeCodeFile: null,
  activeCodeLine: null,
  openDocTabs: [],
  fullView: false,
  rightWidthPx: null,
  chatCollapsedByRight: false,
  backgroundDrawerOpen: false,
  backgroundTasks: [],
  fileChangesBySession: {},

  daemonStatus: DEFAULT_DAEMON_STATUS,
  capabilities: [],
  accountStatus: null,
  authLoaded: false,
  authBypassed: false,
  authDialogOpen: false,
  pendingPermission: null,
  isStreamActive: false,
  keepAwake: false,
  unreadNotifications: 0,
  activeDiagram: DEFAULT_DIAGRAM_STATE,
  pendingUserTurn: null,
  sessionSearchFocusNonce: 0,
  composerFocusNonce: 0,

  setSurface: (surface) => set({ surface }),

  setTheme: (theme, syncHost = true) => {
    const resolvedTheme = resolveThemePolarity(theme);
    syncThemeToDom(theme, resolvedTheme);
    set({ theme, resolvedTheme });
    if (syncHost) {
      postToHost({ type: "rayucode.ui.setAppearance", theme });
    }
  },

  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),

  setHighContrast: (highContrast) => set({ highContrast }),

  cycleTheme: () => {
    const order: ThemePreference[] = ["auto", "dark", "light", "vscode"];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    get().setTheme(next, true);
  },

  setAccent: (accent, syncHost = true) => {
    syncAccentToDom(accent);
    set({ accent });
    if (syncHost) {
      postToHost({ type: "rayucode.ui.setAppearance", accent });
    }
  },

  toggleAccent: () => {
    const next: AccentPreference = get().accent === "green" ? "blue" : "green";
    get().setAccent(next, true);
  },

  setDensity: (density, syncHost = true) => {
    syncDensityToDom(density);
    set({ density });
    if (syncHost) {
      postToHost({ type: "rayucode.ui.setAppearance", density });
    }
  },

  setReduceMotion: (reduceMotion, syncHost = true) => {
    syncReduceMotionToDom(reduceMotion);
    set({ reduceMotion });
    if (syncHost) {
      postToHost({ type: "rayucode.ui.setAppearance", reduceMotion });
    }
  },

  setRoute: (route) => get().setActiveRoute(route),

  setActiveRoute: (activeRoute) => {
    set((state) => {
      const nextEntry: NavHistoryEntry = {
        route: activeRoute,
        sessionId: activeRoute === "workspace" ? state.activeSessionId : null,
        sessionTitle:
          activeRoute === "workspace" ? state.activeSessionTitle : null,
      };
      const current = state.navHistory[state.navHistoryIndex];
      const isSame =
        current &&
        current.route === nextEntry.route &&
        current.sessionId === nextEntry.sessionId;
      const nextHistory = isSame
        ? state.navHistory
        : [
            ...state.navHistory.slice(0, state.navHistoryIndex + 1),
            nextEntry,
          ].slice(-50);
      return {
        route: activeRoute,
        activeRoute,
        navHistory: nextHistory,
        navHistoryIndex: nextHistory.length - 1,
        inspectorOpen: activeRoute === "home" ? false : state.inspectorOpen,
      };
    });
  },

  setActiveSession: (activeSessionId, title) => {
    set((state) => {
      const resolvedRoute: AppRoute = activeSessionId ? "workspace" : "home";
      const resolvedTitle =
        activeSessionId === null
          ? null
          : title !== undefined
            ? title
            : state.activeSessionTitle;
      const nextEntry: NavHistoryEntry = {
        route: resolvedRoute,
        sessionId: activeSessionId,
        sessionTitle: resolvedTitle,
      };
      const current = state.navHistory[state.navHistoryIndex];
      const isSame =
        current &&
        current.route === nextEntry.route &&
        current.sessionId === nextEntry.sessionId;
      const nextHistory = isSame
        ? state.navHistory
        : [
            ...state.navHistory.slice(0, state.navHistoryIndex + 1),
            nextEntry,
          ].slice(-50);
      return {
        activeSessionId,
        activeSessionTitle: resolvedTitle,
        ...(activeSessionId ? { activeDraft: null } : {}),
        route: resolvedRoute,
        activeRoute: resolvedRoute,
        navHistory: nextHistory,
        navHistoryIndex: nextHistory.length - 1,
        rightMode: "context",
        inspectorTab: "overview",
        activeRightTab: "overview",
        activeDocPill: null,
        fullView: false,
        chatCollapsedByRight: false,
      };
    });
  },

  setActiveSessionTitle: (activeSessionTitle) => set({ activeSessionTitle }),

  setActiveProjectPath: (activeProjectPath) => set({ activeProjectPath }),

  setWorkspaces: (workspaces) =>
    set((state) => ({
      workspaces,
      activeProjectPath:
        state.activeProjectPath ?? workspaces[0]?.path ?? null,
    })),

  setWorkspaceLedger: (workspaceLedger) =>
    set((state) => ({
      workspaceLedger,
      activeProjectPath:
        state.activeProjectPath ??
        workspaceLedger?.openFolderPaths[0] ??
        workspaceLedger?.workspaces[0]?.path ??
        null,
    })),

  openNewChatDraft: (target = {}) => {
    const state = get();
    const resolvedDir =
      target.workingDir !== undefined
        ? target.workingDir
        : state.activeProjectPath ??
          state.workspaceLedger?.openFolderPaths[0] ??
          state.workspaces[0]?.path ??
          null;
    const draft = createOrReuseDraft(state.activeDraft, {
      ...target,
      workingDir: resolvedDir,
    });
    const nextEntry: NavHistoryEntry = {
      route: "home",
      sessionId: null,
      sessionTitle: null,
    };
    const current = state.navHistory[state.navHistoryIndex];
    const isSame =
      current && current.route === "home" && current.sessionId === null;
    const nextHistory = isSame
      ? state.navHistory
      : [
          ...state.navHistory.slice(0, state.navHistoryIndex + 1),
          nextEntry,
        ].slice(-50);

    set({
      activeDraft: draft,
      activeSessionId: null,
      activeSessionTitle: null,
      activeProjectPath: draft.workingDir ?? state.activeProjectPath,
      route: "home",
      activeRoute: "home",
      navHistory: nextHistory,
      navHistoryIndex: nextHistory.length - 1,
      inspectorOpen: false,
      rightMode: "context",
      inspectorTab: "overview",
      activeRightTab: "overview",
      activeDocPill: null,
      fullView: false,
      chatCollapsedByRight: false,
    });
    return draft;
  },

  updateActiveDraft: (patch) =>
    set((state) => {
      if (!state.activeDraft) return state;
      return {
        activeDraft: {
          ...state.activeDraft,
          ...patch,
        },
      };
    }),

  clearActiveDraft: () => set({ activeDraft: null }),

  setEditorSelection: (editorSelection) => set({ editorSelection }),

  goBack: () => {
    set((state) => {
      if (state.navHistoryIndex <= 0) return state;
      const nextIndex = state.navHistoryIndex - 1;
      const target = state.navHistory[nextIndex];
      if (!target) return state;
      return {
        navHistoryIndex: nextIndex,
        route: target.route,
        activeRoute: target.route,
        activeSessionId: target.sessionId,
        activeSessionTitle: target.sessionTitle,
        inspectorOpen: target.route === "home" ? false : state.inspectorOpen,
        chatCollapsedByRight: false,
      };
    });
  },

  goForward: () => {
    set((state) => {
      if (state.navHistoryIndex >= state.navHistory.length - 1) return state;
      const nextIndex = state.navHistoryIndex + 1;
      const target = state.navHistory[nextIndex];
      if (!target) return state;
      return {
        navHistoryIndex: nextIndex,
        route: target.route,
        activeRoute: target.route,
        activeSessionId: target.sessionId,
        activeSessionTitle: target.sessionTitle,
        inspectorOpen: target.route === "home" ? false : state.inspectorOpen,
        chatCollapsedByRight: false,
      };
    });
  },

  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),

  setInspectorOpen: (inspectorOpen) =>
    set((state) => ({
      inspectorOpen,
      fullView: inspectorOpen ? state.fullView : false,
      chatCollapsedByRight: inspectorOpen ? state.chatCollapsedByRight : false,
    })),

  toggleInspector: () =>
    set((state) => {
      const next = !state.inspectorOpen;
      return {
        inspectorOpen: next,
        fullView: next ? state.fullView : false,
        chatCollapsedByRight: next ? state.chatCollapsedByRight : false,
      };
    }),

  setInspectorTab: (tab) => get().openRightTab(tab),

  openRightTab: (tab, pillLabel) => {
    if (CONTEXT_MODE_TABS.has(tab)) {
      set({
        inspectorOpen: true,
        rightMode: "context",
        inspectorTab: tab,
        activeRightTab: tab,
        activeDocPill: null,
        fullView: false,
      });
      return;
    }
    const resolvedPill =
      pillLabel !== undefined ? pillLabel : DEFAULT_TAB_PILLS[tab];
    set((state) => {
      const nextTabs = resolvedPill
        ? state.openDocTabs.some((t) => t.pill === resolvedPill)
          ? state.openDocTabs
          : [...state.openDocTabs, { tab, pill: resolvedPill }].slice(-5)
        : state.openDocTabs;
      return {
        inspectorOpen: true,
        rightMode: "document",
        inspectorTab: tab,
        activeRightTab: tab,
        activeDocPill: resolvedPill,
        openDocTabs: nextTabs,
      };
    });
  },

  openCodeFile: (file, line = null) => {
    set((state) => ({
      inspectorOpen: true,
      rightMode: "document",
      inspectorTab: "code",
      activeRightTab: "code",
      activeDocPill: file,
      activeCodeFile: file,
      activeCodeLine: line,
      openDocTabs: state.openDocTabs.some((t) => t.pill === file)
        ? state.openDocTabs
        : [...state.openDocTabs, { tab: "code" as RightTabId, pill: file }].slice(
            -5,
          ),
    }));
  },

  closeDocTab: (pill) => {
    set((state) => {
      const remaining = state.openDocTabs.filter((t) => t.pill !== pill);
      if (remaining.length === 0 || state.activeDocPill === pill) {
        const fallback = remaining[remaining.length - 1];
        if (!fallback) {
          return {
            openDocTabs: [],
            rightMode: "context",
            inspectorTab: "overview",
            activeRightTab: "overview",
            activeDocPill: null,
            fullView: false,
          };
        }
        return {
          openDocTabs: remaining,
          inspectorTab: fallback.tab,
          activeRightTab: fallback.tab,
          activeDocPill: fallback.pill,
        };
      }
      return { openDocTabs: remaining };
    });
  },

  closeDocumentToContext: () =>
    set({
      rightMode: "context",
      inspectorTab: "overview",
      activeRightTab: "overview",
      activeDocPill: null,
      fullView: false,
      chatCollapsedByRight: false,
    }),

  setFullView: (fullView) =>
    set((state) => ({
      fullView,
      inspectorOpen: fullView ? true : state.inspectorOpen,
    })),

  setRightWidthPx: (rightWidthPx) => set({ rightWidthPx }),

  setChatCollapsedByRight: (chatCollapsedByRight) =>
    set({ chatCollapsedByRight }),

  setBackgroundDrawerOpen: (backgroundDrawerOpen) =>
    set({ backgroundDrawerOpen }),

  toggleBackgroundDrawer: () =>
    set((state) => ({ backgroundDrawerOpen: !state.backgroundDrawerOpen })),

  setBackgroundTasks: (backgroundTasks) => set({ backgroundTasks }),

  setFileChangesSnapshot: (sessionId, snapshot) =>
    set((state) => ({
      fileChangesBySession: {
        ...state.fileChangesBySession,
        [sessionId]: snapshot,
      },
    })),

  setDaemonStatus: (daemonStatus) =>
    set({ daemonStatus, capabilities: daemonStatus.capabilities }),

  setAccountStatus: (accountStatus) => set({ accountStatus }),

  setAuthLoaded: (authLoaded) => set({ authLoaded }),

  setAuthBypassed: (authBypassed) => set({ authBypassed }),

  setAuthDialogOpen: (authDialogOpen) => set({ authDialogOpen }),

  setPendingPermission: (pendingPermission) => set({ pendingPermission }),

  setIsStreamActive: (isStreamActive) => set({ isStreamActive }),

  setKeepAwake: (keepAwake) => set({ keepAwake }),

  setUnreadNotifications: (unreadNotifications) => set({ unreadNotifications }),

  openDiagramPreview: (source, title) =>
    set((state) => ({
      activeDiagram: {
        title: title?.trim() || "Diagram",
        source,
      },
      inspectorOpen: true,
      rightMode: "document",
      inspectorTab: "diagram",
      activeRightTab: "diagram",
      activeDocPill: title?.trim() || "Diagram",
      openDocTabs: state.openDocTabs.some(
        (t) => t.pill === (title?.trim() || "Diagram"),
      )
        ? state.openDocTabs
        : [
            ...state.openDocTabs,
            { tab: "diagram" as RightTabId, pill: title?.trim() || "Diagram" },
          ].slice(-5),
    })),

  setActiveDiagramSource: (source) =>
    set((state) => ({
      activeDiagram: { ...state.activeDiagram, source },
    })),

  enqueueOptimisticTurn: (pendingUserTurn) => set({ pendingUserTurn }),

  consumeOptimisticTurn: (id) =>
    set((state) =>
      state.pendingUserTurn?.id === id ? { pendingUserTurn: null } : state,
    ),

  requestSessionSearchFocus: () =>
    set((state) => ({
      sessionSearchFocusNonce: state.sessionSearchFocusNonce + 1,
      mobileSidebarOpen: true,
      sidebarCollapsed: false,
    })),

  requestComposerFocus: () =>
    set((state) => ({
      composerFocusNonce: state.composerFocusNonce + 1,
    })),

  applyHostMessage: (msg) => {
    switch (msg.type) {
      case "rayucode.host.init": {
        setMediaBaseUri(msg.mediaBaseUri);
        const resolvedTheme = resolveThemePolarity(msg.theme);
        syncThemeToDom(msg.theme, resolvedTheme);
        syncAccentToDom(msg.accent);
        if (msg.density) syncDensityToDom(msg.density);
        if (msg.reduceMotion !== undefined) {
          syncReduceMotionToDom(msg.reduceMotion);
        }
        set((state) => ({
          surface: msg.surface,
          theme: msg.theme,
          resolvedTheme,
          accent: msg.accent,
          density: msg.density ?? state.density,
          reduceMotion: msg.reduceMotion ?? state.reduceMotion,
          route: msg.route,
          activeRoute: msg.route,
          activeSessionId: msg.sessionId ?? state.activeSessionId,
          capabilities: msg.capabilities,
          daemonStatus: msg.daemonStatus,
          workspaces: msg.workspaces,
          ...(msg.workspaceLedger !== undefined
            ? { workspaceLedger: msg.workspaceLedger }
            : {}),
          activeProjectPath:
            state.activeProjectPath ??
            msg.workspaces[0]?.path ??
            msg.workspaceLedger?.openFolderPaths[0] ??
            null,
          editorSelection:
            msg.editorSelection !== undefined
              ? msg.editorSelection
              : state.editorSelection,
          backgroundTasks: msg.backgroundTasks ?? state.backgroundTasks,
          ...(msg.sessionId && msg.fileChanges
            ? {
                fileChangesBySession: {
                  ...state.fileChangesBySession,
                  [msg.sessionId]: msg.fileChanges,
                },
              }
            : {}),
          ...(msg.accountStatus !== undefined
            ? {
                accountStatus: msg.accountStatus,
                authLoaded: true,
                ...(msg.accountStatus.signedIn
                  ? { authBypassed: false, authDialogOpen: false }
                  : {}),
              }
            : {}),
        }));
        return;
      }
      case "rayucode.account.changed": {
        set((state) => ({
          accountStatus: msg.account,
          authLoaded: true,
          authBypassed: msg.account.signedIn ? false : state.authBypassed,
          authDialogOpen: msg.account.signedIn ? false : state.authDialogOpen,
        }));
        return;
      }
      case "rayucode.ui.appearanceSync": {
        const resolvedTheme = resolveThemePolarity(msg.theme);
        syncThemeToDom(msg.theme, resolvedTheme);
        syncAccentToDom(msg.accent);
        if (msg.density) syncDensityToDom(msg.density);
        if (msg.reduceMotion !== undefined) {
          syncReduceMotionToDom(msg.reduceMotion);
        }
        set((state) => ({
          theme: msg.theme,
          resolvedTheme,
          accent: msg.accent,
          density: msg.density ?? state.density,
          reduceMotion: msg.reduceMotion ?? state.reduceMotion,
        }));
        return;
      }
      case "rayucode.daemon.statusChanged":
        set({
          daemonStatus: msg.status,
          capabilities: msg.status.capabilities,
        });
        return;
      case "rayucode.workspaces.changed":
        set((state) => ({
          workspaces: msg.workspaces,
          ...(msg.workspaceLedger !== undefined
            ? { workspaceLedger: msg.workspaceLedger }
            : {}),
          activeProjectPath:
            state.activeProjectPath ?? msg.workspaces[0]?.path ?? null,
        }));
        return;
      case "rayucode.workspaces.ledgerChanged":
        set((state) => ({
          workspaceLedger: msg.ledger,
          activeProjectPath:
            state.activeProjectPath ??
            msg.ledger.openFolderPaths[0] ??
            msg.ledger.workspaces[0]?.path ??
            null,
        }));
        return;
      case "rayucode.editor.selectionChanged":
        set({ editorSelection: msg.selection });
        return;
      case "rayucode.processes.snapshot":
        set({ backgroundTasks: msg.tasks });
        return;
      case "rayucode.fileChanges.updated":
        set((state) => ({
          fileChangesBySession: {
            ...state.fileChangesBySession,
            [msg.sessionId]: msg.snapshot,
          },
        }));
        return;
      case "rayucode.ui.navigate": {
        if (msg.sessionId) {
          get().setActiveSession(msg.sessionId);
        }
        get().setActiveRoute(msg.route);
        if (msg.openProcessesDrawer !== undefined) {
          set({ backgroundDrawerOpen: msg.openProcessesDrawer });
        }
        return;
      }
      default:
        return;
    }
  },
}));

export { queryClient, createQueryClient } from "./query-client";
