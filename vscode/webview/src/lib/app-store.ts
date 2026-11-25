import { create } from "zustand";
import type {
  AccentPreference,
  AccountStatusView,
  AppRoute,
  BackgroundProcessView,
  ComposerInjectionPayload,
  DaemonStatusView,
  DensityPreference,
  EditorSelectionView,
  EffortLevel,
  FileChangesSnapshotView,
  HostToWebviewMessage,
  ImageAttachmentView,
  OpenLocation,
  SurfaceKind,
  ThemePreference,
  WorkbenchPreferences,
  WorkspaceFolderView,
} from "@shared/vscodeProtocol";

import type { PendingPermissionRequest } from "./harness-adapter";
import { setMediaBaseUri } from "./media-url";
import { postToHost, setWebviewState } from "./rpc-client";

export type {
  AccentPreference,
  AppRoute,
  ComposerInjectionPayload,
  DensityPreference,
  OpenLocation,
  SurfaceKind,
  ThemePreference,
  WorkbenchPreferences,
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
}

export type MidTurnSendMode = "steer" | "queue";

export interface MidTurnMessageItem {
  id: string;
  sessionId: string;
  mode: MidTurnSendMode;
  text: string;
  createdAtMs: number;
  images?: ImageAttachmentView[];
  editorSelection?: EditorSelectionView | null;
  modelSpec?: string;
  apiMethod?: string;
  effort?: EffortLevel;
}

export interface AppStoreState {
  // Surface & navigation
  surface: SurfaceKind;
  route: AppRoute;
  activeRoute: AppRoute;
  navHistory: NavHistoryEntry[];
  navHistoryIndex: number;

  // Appearance & Workbench
  theme: ThemePreference;
  resolvedTheme: ResolvedThemePolarity;
  accent: AccentPreference;
  density: DensityPreference;
  reduceMotion: boolean;
  highContrast: boolean;
  workbench: WorkbenchPreferences;

  // Sessions & workspace
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  activeProjectPath: string | null;
  workspaces: WorkspaceFolderView[];
  editorSelection: EditorSelectionView | null;
  pendingComposerInjection: ComposerInjectionPayload | null;

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
  composerDrafts: Record<string, string>;
  midTurnSendMode: MidTurnSendMode;
  midTurnMessagesBySession: Record<string, MidTurnMessageItem[]>;
  pausedQueueSessions: Record<string, boolean>;
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
  setWorkbench: (
    patch: Partial<WorkbenchPreferences>,
    syncHost?: boolean,
  ) => void;

  setRoute: (route: AppRoute) => void;
  setActiveRoute: (route: AppRoute) => void;
  setActiveSession: (sessionId: string | null, title?: string | null) => void;
  setActiveSessionTitle: (title: string | null) => void;
  setActiveProjectPath: (path: string | null) => void;
  setWorkspaces: (workspaces: WorkspaceFolderView[]) => void;
  setEditorSelection: (selection: EditorSelectionView | null) => void;
  queueComposerInjection: (injection: ComposerInjectionPayload) => void;
  consumeComposerInjection: (id: string) => void;
  setComposerDraft: (key: string, value: string) => void;
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
  setMidTurnSendMode: (mode: MidTurnSendMode) => void;
  addMidTurnMessage: (item: MidTurnMessageItem) => void;
  removeMidTurnMessage: (sessionId: string, id: string) => void;
  updateMidTurnMessage: (
    sessionId: string,
    id: string,
    patch: Partial<MidTurnMessageItem>,
  ) => void;
  markSteersDelivered: (sessionId: string, clientIds?: string[]) => void;
  demotePendingSteersToQueue: (sessionId: string) => void;
  shiftNextQueuedMessage: (sessionId: string) => MidTurnMessageItem | null;
  setQueuePausedForSession: (sessionId: string, paused: boolean) => void;
  requestSessionSearchFocus: () => void;
  requestComposerFocus: () => void;
  applyHostMessage: (msg: HostToWebviewMessage) => void;
}

const DEFAULT_DAEMON_STATUS: DaemonStatusView = {
  state: "connecting",
  capabilities: [],
};

const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = {
  openLocation: "secondarySidebar",
  contextActionsAutoSubmit: false,
  showEditorTitleIcon: true,
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
  workbench: { ...DEFAULT_WORKBENCH_PREFERENCES },

  activeSessionId: null,
  activeSessionTitle: null,
  activeProjectPath: null,
  workspaces: [],
  editorSelection: null,
  pendingComposerInjection: null,

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
  composerDrafts: {},
  midTurnSendMode: "steer",
  midTurnMessagesBySession: {},
  pausedQueueSessions: {},
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

  setWorkbench: (patch, syncHost = true) => {
    set((state) => ({
      workbench: {
        ...state.workbench,
        ...patch,
      },
    }));
    if (syncHost) {
      postToHost({
        type: "rayucode.ui.setWorkbench",
        ...patch,
      });
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
    const next = get();
    if (next.surface === "editorPanel") {
      setWebviewState({
        route: next.activeRoute,
        sessionId: next.activeSessionId ?? undefined,
      });
    }
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
        backgroundTasks: activeSessionId
          ? state.backgroundTasks.filter((t) => t.sessionId === activeSessionId)
          : [],
      };
    });
    const next = get();
    if (next.surface === "editorPanel") {
      setWebviewState({
        route: next.activeRoute,
        sessionId: next.activeSessionId ?? undefined,
      });
    }
  },

  setActiveSessionTitle: (activeSessionTitle) => set({ activeSessionTitle }),

  setActiveProjectPath: (activeProjectPath) => set({ activeProjectPath }),

  setWorkspaces: (workspaces) =>
    set((state) => ({
      workspaces,
      activeProjectPath:
        state.activeProjectPath ?? workspaces[0]?.path ?? null,
    })),

  setEditorSelection: (editorSelection) => set({ editorSelection }),

  queueComposerInjection: (pendingComposerInjection) =>
    set({ pendingComposerInjection }),

  consumeComposerInjection: (id) =>
    set((state) =>
      state.pendingComposerInjection?.id === id
        ? { pendingComposerInjection: null }
        : state,
    ),

  setComposerDraft: (key, value) =>
    set((state) => {
      const current = state.composerDrafts[key] ?? "";
      if (current === value) return state;
      const next = { ...state.composerDrafts };
      if (value.length === 0) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return { composerDrafts: next };
    }),

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
        backgroundTasks: target.sessionId
          ? state.backgroundTasks.filter((t) => t.sessionId === target.sessionId)
          : [],
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
        backgroundTasks: target.sessionId
          ? state.backgroundTasks.filter((t) => t.sessionId === target.sessionId)
          : [],
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

  setMidTurnSendMode: (midTurnSendMode) => set({ midTurnSendMode }),

  addMidTurnMessage: (item) =>
    set((state) => {
      const existing = state.midTurnMessagesBySession[item.sessionId] ?? [];
      if (existing.some((m) => m.id === item.id)) return state;
      return {
        midTurnMessagesBySession: {
          ...state.midTurnMessagesBySession,
          [item.sessionId]: [...existing, item],
        },
      };
    }),

  removeMidTurnMessage: (sessionId, id) =>
    set((state) => {
      const existing = state.midTurnMessagesBySession[sessionId];
      if (!existing || existing.length === 0) return state;
      const filtered = existing.filter((m) => m.id !== id);
      if (filtered.length === existing.length) return state;
      const next = { ...state.midTurnMessagesBySession };
      if (filtered.length === 0) {
        delete next[sessionId];
      } else {
        next[sessionId] = filtered;
      }
      return { midTurnMessagesBySession: next };
    }),

  updateMidTurnMessage: (sessionId, id, patch) =>
    set((state) => {
      const existing = state.midTurnMessagesBySession[sessionId];
      if (!existing || existing.length === 0) return state;
      let changed = false;
      const updated = existing.map((m) => {
        if (m.id !== id) return m;
        changed = true;
        return { ...m, ...patch };
      });
      if (!changed) return state;
      return {
        midTurnMessagesBySession: {
          ...state.midTurnMessagesBySession,
          [sessionId]: updated,
        },
      };
    }),

  markSteersDelivered: (sessionId, clientIds) =>
    set((state) => {
      const existing = state.midTurnMessagesBySession[sessionId];
      if (!existing || existing.length === 0) return state;
      const idSet =
        clientIds && clientIds.length > 0 ? new Set(clientIds) : null;
      const remaining = existing.filter((m) => {
        if (m.mode !== "steer") return true;
        if (!idSet) return false;
        return !idSet.has(m.id);
      });
      if (remaining.length === existing.length) return state;
      const next = { ...state.midTurnMessagesBySession };
      if (remaining.length === 0) {
        delete next[sessionId];
      } else {
        next[sessionId] = remaining;
      }
      return { midTurnMessagesBySession: next };
    }),

  demotePendingSteersToQueue: (sessionId) =>
    set((state) => {
      const existing = state.midTurnMessagesBySession[sessionId];
      if (!existing || existing.length === 0) return state;
      let changed = false;
      const updated = existing.map((m) => {
        if (m.mode !== "steer") return m;
        changed = true;
        return { ...m, mode: "queue" as const };
      });
      if (!changed) return state;
      return {
        midTurnMessagesBySession: {
          ...state.midTurnMessagesBySession,
          [sessionId]: updated,
        },
      };
    }),

  shiftNextQueuedMessage: (sessionId) => {
    const existing = get().midTurnMessagesBySession[sessionId];
    if (!existing || existing.length === 0) return null;
    const targetIdx = existing.findIndex((m) => m.mode === "queue");
    if (targetIdx < 0) return null;
    const item = existing[targetIdx];
    const remaining = existing.filter((_, idx) => idx !== targetIdx);
    set((state) => {
      const next = { ...state.midTurnMessagesBySession };
      if (remaining.length === 0) {
        delete next[sessionId];
      } else {
        next[sessionId] = remaining;
      }
      return { midTurnMessagesBySession: next };
    });
    return item;
  },

  setQueuePausedForSession: (sessionId, paused) =>
    set((state) => {
      const currentlyPaused = Boolean(state.pausedQueueSessions[sessionId]);
      if (currentlyPaused === paused) return state;
      const next = { ...state.pausedQueueSessions };
      if (paused) {
        next[sessionId] = true;
      } else {
        delete next[sessionId];
      }
      return { pausedQueueSessions: next };
    }),

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
        set((state) => {
          const resolvedSessionId = msg.sessionId ?? state.activeSessionId;
          const rawTasks = msg.backgroundTasks ?? state.backgroundTasks;
          const scopedTasks = resolvedSessionId
            ? rawTasks.filter((t) => t.sessionId === resolvedSessionId)
            : [];
          return {
            surface: msg.surface,
            theme: msg.theme,
            resolvedTheme,
            accent: msg.accent,
            density: msg.density ?? state.density,
            reduceMotion: msg.reduceMotion ?? state.reduceMotion,
            ...(msg.workbench ? { workbench: msg.workbench } : {}),
            route: msg.route,
            activeRoute: msg.route,
            activeSessionId: resolvedSessionId,
            capabilities: msg.capabilities,
            daemonStatus: msg.daemonStatus,
            workspaces: msg.workspaces,
            activeProjectPath:
              state.activeProjectPath ?? msg.workspaces[0]?.path ?? null,
            editorSelection:
              msg.editorSelection !== undefined
                ? msg.editorSelection
                : state.editorSelection,
            backgroundTasks: scopedTasks,
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
          };
        });
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
      case "rayucode.ui.workbenchSync": {
        set({ workbench: msg.workbench });
        return;
      }
      case "rayucode.composer.inject": {
        const { injection } = msg;
        set((state) => {
          const nextRoute: AppRoute = state.activeSessionId
            ? "workspace"
            : "home";
          const matchedWorkspace = injection.workingDir
            ? state.workspaces.find((w) => w.path === injection.workingDir)
            : undefined;
          const nextProjectPath = matchedWorkspace
            ? matchedWorkspace.path
            : injection.workingDir && state.activeProjectPath === null
              ? injection.workingDir
              : state.activeProjectPath;
          const nextEntry: NavHistoryEntry = {
            route: nextRoute,
            sessionId:
              nextRoute === "workspace" ? state.activeSessionId : null,
            sessionTitle:
              nextRoute === "workspace" ? state.activeSessionTitle : null,
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
            pendingComposerInjection: injection,
            ...(injection.selection !== undefined
              ? { editorSelection: injection.selection }
              : {}),
            activeProjectPath: nextProjectPath,
            route: nextRoute,
            activeRoute: nextRoute,
            navHistory: nextHistory,
            navHistoryIndex: nextHistory.length - 1,
            inspectorOpen: nextRoute === "home" ? false : state.inspectorOpen,
            composerFocusNonce: state.composerFocusNonce + 1,
          };
        });
        const next = get();
        if (next.surface === "editorPanel") {
          setWebviewState({
            route: next.activeRoute,
            sessionId: next.activeSessionId ?? undefined,
          });
        }
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
          activeProjectPath:
            state.activeProjectPath ?? msg.workspaces[0]?.path ?? null,
        }));
        return;
      case "rayucode.editor.selectionChanged":
        set({ editorSelection: msg.selection });
        return;
      case "rayucode.processes.snapshot":
        set((state) => {
          if (
            msg.sessionId &&
            state.activeSessionId &&
            msg.sessionId !== state.activeSessionId
          ) {
            return state;
          }
          return {
            backgroundTasks: state.activeSessionId
              ? msg.tasks.filter((t) => t.sessionId === state.activeSessionId)
              : [],
          };
        });
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
