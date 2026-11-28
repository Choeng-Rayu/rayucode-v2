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
  CacheTtl,
  ComposerInjectionPayload,
  DaemonStatusView,
  DensityPreference,
  EditorSelectionView,
  EffortLevel,
  FileChangesSnapshotView,
  HostToWebviewMessage,
  ImageAttachmentView,
  OpenLocation,
  PermissionModeId,
  ServiceTier,
  SessionSummaryView,
  SurfaceKind,
  ThemePreference,
  TodoItemView,
  WorkbenchPreferences,
  WorkspaceFolderView,
  WorkspaceLedgerView,
} from "@shared/vscodeProtocol";

import type { PendingPermissionRequest } from "./harness-adapter";
import { setMediaBaseUri } from "./media-url";
import { getWebviewState, postToHost, setWebviewState } from "./rpc-client";

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

export interface NavHistoryEntry {
  route: AppRoute;
  sessionId: string | null;
  sessionTitle: string | null;
  settingsSection?: string;
}

export function normalizeRouteTarget(
  route: AppRoute,
  activeSessionId: string | null,
): { route: AppRoute; settingsSection?: string } {
  if (
    route === "agents" ||
    route === "swarm" ||
    route === "automations" ||
    route === "remote"
  ) {
    return { route: "settings", settingsSection: route };
  }
  if (route === "changes") {
    return { route: activeSessionId ? "workspace" : "home" };
  }
  return { route };
}

export function makeTurnDurationKey(
  turnIndex: number,
  userPrompt: string,
): string {
  const normalized = userPrompt.trim().replace(/\s+/g, " ").slice(0, 120);
  return `${turnIndex}:${normalized}`;
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

export type MidTurnSendMode = "steer" | "queue";

export interface SessionComposerPrefs {
  modelId?: string;
  modelLabel?: string;
  apiMethod?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionModeId;
  serviceTier?: ServiceTier;
  cacheTtl?: CacheTtl;
}

export interface MidTurnMessageItem {
  id: string;
  sessionId: string;
  mode: MidTurnSendMode;
  text: string;
  createdAtMs: number;
  workingDir?: string;
  images?: ImageAttachmentView[];
  editorSelection?: EditorSelectionView | null;
  modelSpec?: string;
  apiMethod?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionModeId;
  serviceTier?: ServiceTier;
  cacheTtl?: CacheTtl;
}

export interface AppStoreState {
  // Surface & navigation
  surface: SurfaceKind;
  route: AppRoute;
  activeRoute: AppRoute;
  activeSettingsSection: string;
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
  workspaceLedger: WorkspaceLedgerView | null;
  activeDraft: ProvisionalDraftSession | null;
  editorSelection: EditorSelectionView | null;
  pendingComposerInjection: ComposerInjectionPayload | null;

  // Shell chrome & drawers
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  backgroundDrawerOpen: boolean;
  backgroundTasks: BackgroundProcessView[];
  fileChangesBySession: Record<string, FileChangesSnapshotView>;
  todosBySession: Record<string, TodoItemView[]>;
  turnDurationsBySession: Record<string, Record<string, string>>;

  // Daemon, Auth & Notifications
  daemonStatus: DaemonStatusView;
  capabilities: string[];
  accountStatus: AccountStatusView | null;
  authLoaded: boolean;
  authBypassed: boolean;
  authDialogOpen: boolean;
  pendingPermission: PendingPermissionRequest | null;
  pendingPermissionBySession: Record<string, PendingPermissionRequest | null>;
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  defaultPermissionMode: PermissionModeId;
  isStreamActive: boolean;
  keepAwake: boolean;
  unreadNotifications: number;
  pendingUserTurn: OptimisticUserTurn | null;
  composerDrafts: Record<string, string>;
  sessionPrefsBySession: Record<string, SessionComposerPrefs>;
  pendingSessionPrefsBySession: Record<string, SessionComposerPrefs>;
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
  setActiveSettingsSection: (section: string) => void;
  openSettingsSection: (section: string) => void;
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
  queueComposerInjection: (injection: ComposerInjectionPayload) => void;
  consumeComposerInjection: (id: string) => void;
  setComposerDraft: (key: string, value: string) => void;
  setSessionPrefs: (
    sessionId: string,
    patch: Partial<SessionComposerPrefs>,
  ) => void;
  clearSessionPrefField: (
    sessionId: string,
    field: keyof SessionComposerPrefs,
  ) => void;
  setPendingSessionPrefs: (
    sessionId: string,
    patch: Partial<SessionComposerPrefs> | null,
    replace?: boolean,
  ) => void;
  clearPendingSessionPrefs: (
    sessionId: string,
    field?: keyof SessionComposerPrefs,
  ) => void;
  seedSessionPrefsFromSummary: (
    summary: Pick<
      SessionSummaryView,
      | "sessionId"
      | "model"
      | "effort"
      | "permissionMode"
      | "serviceTier"
      | "cacheTtl"
    >,
  ) => void;
  goBack: () => void;
  goForward: () => void;

  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setBackgroundDrawerOpen: (open: boolean) => void;
  toggleBackgroundDrawer: () => void;
  setBackgroundTasks: (tasks: BackgroundProcessView[]) => void;
  setFileChangesSnapshot: (
    sessionId: string,
    snapshot: FileChangesSnapshotView,
  ) => void;
  setSessionTodos: (sessionId: string, todos: TodoItemView[]) => void;
  recordTurnDuration: (
    sessionId: string,
    key: string,
    workedDuration: string,
  ) => void;

  setDaemonStatus: (status: DaemonStatusView) => void;
  setAccountStatus: (status: AccountStatusView | null) => void;
  setAuthLoaded: (loaded: boolean) => void;
  setAuthBypassed: (bypassed: boolean) => void;
  setAuthDialogOpen: (open: boolean) => void;
  setPendingPermission: (
    perm: PendingPermissionRequest | null,
    sessionId?: string,
  ) => void;
  clearPendingPermission: (sessionId: string, requestId?: string) => void;
  setDefaultPermissionMode: (mode: PermissionModeId) => void;
  setIsStreamActive: (active: boolean) => void;
  setKeepAwake: (keepAwake: boolean) => void;
  setUnreadNotifications: (count: number) => void;
  enqueueOptimisticTurn: (turn: OptimisticUserTurn) => void;
  consumeOptimisticTurn: (id: string) => void;
  setMidTurnSendMode: (mode: MidTurnSendMode) => void;
  addMidTurnMessage: (item: MidTurnMessageItem, restoreFirst?: boolean) => void;
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

function readInitialSessionPrefs(): Record<string, SessionComposerPrefs> {
  try {
    const raw = getWebviewState<{
      sessionPrefsBySession?: Record<string, SessionComposerPrefs>;
    }>();
    if (
      raw &&
      typeof raw === "object" &&
      raw.sessionPrefsBySession &&
      typeof raw.sessionPrefsBySession === "object"
    ) {
      return { ...raw.sessionPrefsBySession };
    }
  } catch {
    // ignore storage read errors in test/non-webview environments
  }
  return {};
}

function readInitialTurnDurations(): Record<string, Record<string, string>> {
  try {
    const raw = getWebviewState<{
      turnDurationsBySession?: Record<string, Record<string, string>>;
    }>();
    if (
      raw &&
      typeof raw === "object" &&
      raw.turnDurationsBySession &&
      typeof raw.turnDurationsBySession === "object"
    ) {
      return { ...raw.turnDurationsBySession };
    }
  } catch {
    // ignore storage read errors in test/non-webview environments
  }
  return {};
}

function persistWebviewStateSnapshot(state: {
  surface: SurfaceKind;
  activeRoute: AppRoute;
  activeSessionId: string | null;
  sessionPrefsBySession: Record<string, SessionComposerPrefs>;
  turnDurationsBySession: Record<string, Record<string, string>>;
}): void {
  try {
    const prev = getWebviewState<Record<string, unknown>>();
    const base = prev && typeof prev === "object" ? prev : {};
    const hasPrefs = Object.keys(state.sessionPrefsBySession).length > 0;
    const hasDurations = Object.keys(state.turnDurationsBySession).length > 0;
    const nextState: Record<string, unknown> = {
      ...base,
      ...(state.surface === "editorPanel"
        ? {
            route: state.activeRoute,
            sessionId: state.activeSessionId ?? undefined,
          }
        : {}),
    };
    if (hasPrefs) {
      nextState.sessionPrefsBySession = state.sessionPrefsBySession;
    } else {
      delete nextState.sessionPrefsBySession;
    }
    if (hasDurations) {
      nextState.turnDurationsBySession = state.turnDurationsBySession;
    } else {
      delete nextState.turnDurationsBySession;
    }
    setWebviewState(nextState);
  } catch {
    // ignore
  }
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  surface: detectInitialSurface(),
  route: "home",
  activeRoute: "home",
  activeSettingsSection: "account",
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
  workspaceLedger: null,
  activeDraft: null,
  editorSelection: null,
  pendingComposerInjection: null,

  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  backgroundDrawerOpen: false,
  backgroundTasks: [],
  fileChangesBySession: {},
  todosBySession: {},
  turnDurationsBySession: readInitialTurnDurations(),

  daemonStatus: DEFAULT_DAEMON_STATUS,
  capabilities: [],
  accountStatus: null,
  authLoaded: false,
  authBypassed: false,
  authDialogOpen: false,
  pendingPermission: null,
  pendingPermissionBySession: {},
  pendingPermissionsBySession: {},
  defaultPermissionMode: "default",
  isStreamActive: false,
  keepAwake: false,
  unreadNotifications: 0,
  pendingUserTurn: null,
  composerDrafts: {},
  sessionPrefsBySession: readInitialSessionPrefs(),
  pendingSessionPrefsBySession: {},
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

  setActiveRoute: (rawRoute) => {
    set((state) => {
      const normalized = normalizeRouteTarget(rawRoute, state.activeSessionId);
      const nextRoute = normalized.route;
      const nextSettingsSection =
        normalized.settingsSection ??
        (nextRoute === "settings" ? state.activeSettingsSection : undefined);
      const nextEntry: NavHistoryEntry = {
        route: nextRoute,
        sessionId: nextRoute === "workspace" ? state.activeSessionId : null,
        sessionTitle:
          nextRoute === "workspace" ? state.activeSessionTitle : null,
        ...(nextSettingsSection ? { settingsSection: nextSettingsSection } : {}),
      };
      const current = state.navHistory[state.navHistoryIndex];
      const isSame =
        current &&
        current.route === nextEntry.route &&
        current.sessionId === nextEntry.sessionId &&
        current.settingsSection === nextEntry.settingsSection;
      const nextHistory = isSame
        ? state.navHistory
        : [
            ...state.navHistory.slice(0, state.navHistoryIndex + 1),
            nextEntry,
          ].slice(-50);
      return {
        route: nextRoute,
        activeRoute: nextRoute,
        ...(normalized.settingsSection
          ? { activeSettingsSection: normalized.settingsSection }
          : {}),
        navHistory: nextHistory,
        navHistoryIndex: nextHistory.length - 1,
      };
    });
    const next = get();
    if (next.surface === "editorPanel") {
      persistWebviewStateSnapshot(next);
    }
  },

  setActiveSettingsSection: (activeSettingsSection) =>
    set({ activeSettingsSection }),

  openSettingsSection: (section) => {
    set((state) => {
      const nextEntry: NavHistoryEntry = {
        route: "settings",
        sessionId: null,
        sessionTitle: null,
        settingsSection: section,
      };
      const current = state.navHistory[state.navHistoryIndex];
      const isSame =
        current &&
        current.route === "settings" &&
        current.settingsSection === section;
      const nextHistory = isSame
        ? state.navHistory
        : [
            ...state.navHistory.slice(0, state.navHistoryIndex + 1),
            nextEntry,
          ].slice(-50);
      return {
        route: "settings",
        activeRoute: "settings",
        activeSettingsSection: section,
        navHistory: nextHistory,
        navHistoryIndex: nextHistory.length - 1,
      };
    });
    const next = get();
    if (next.surface === "editorPanel") {
      persistWebviewStateSnapshot(next);
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
        ...(activeSessionId ? { activeDraft: null } : {}),
        route: resolvedRoute,
        activeRoute: resolvedRoute,
        navHistory: nextHistory,
        navHistoryIndex: nextHistory.length - 1,
        pendingPermission: activeSessionId
          ? (state.pendingPermissionBySession[activeSessionId] ?? null)
          : null,
        backgroundTasks: activeSessionId
          ? state.backgroundTasks.filter((t) => t.sessionId === activeSessionId)
          : [],
      };
    });
    const next = get();
    if (next.surface === "editorPanel") {
      persistWebviewStateSnapshot(next);
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

    const nextDraftPrefs: SessionComposerPrefs = {
      ...(draft.model ? { modelId: draft.model } : {}),
      ...(draft.reasoningEffort
        ? { effort: draft.reasoningEffort as EffortLevel }
        : {}),
      ...(draft.permissionMode
        ? { permissionMode: draft.permissionMode as PermissionModeId }
        : {}),
    };
    const nextSessionPrefs = { ...state.sessionPrefsBySession };
    if (Object.keys(nextDraftPrefs).length > 0) {
      nextSessionPrefs.__draft__ = nextDraftPrefs;
    } else {
      delete nextSessionPrefs.__draft__;
    }

    set({
      activeDraft: draft,
      activeSessionId: null,
      activeSessionTitle: null,
      activeProjectPath: draft.workingDir ?? state.activeProjectPath,
      sessionPrefsBySession: nextSessionPrefs,
      route: "home",
      activeRoute: "home",
      navHistory: nextHistory,
      navHistoryIndex: nextHistory.length - 1,
      pendingPermission: null,
      backgroundTasks: [],
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

  setSessionPrefs: (sessionId, patch) => {
    if (!sessionId) return;
    let didChange = false;
    set((state) => {
      const prev = state.sessionPrefsBySession[sessionId] ?? {};
      const next: SessionComposerPrefs = { ...prev };
      if (patch.modelId !== undefined && patch.modelId !== prev.modelId) {
        next.modelId = patch.modelId;
        if (patch.modelLabel === undefined) {
          delete next.modelLabel;
        }
        didChange = true;
      }
      if (
        patch.modelLabel !== undefined &&
        patch.modelLabel !== prev.modelLabel
      ) {
        next.modelLabel = patch.modelLabel;
        didChange = true;
      }
      if (patch.apiMethod !== undefined && patch.apiMethod !== prev.apiMethod) {
        next.apiMethod = patch.apiMethod;
        didChange = true;
      }
      if (patch.effort !== undefined && patch.effort !== prev.effort) {
        next.effort = patch.effort;
        didChange = true;
      }
      if (
        patch.permissionMode !== undefined &&
        patch.permissionMode !== prev.permissionMode
      ) {
        next.permissionMode = patch.permissionMode;
        didChange = true;
      }
      if (
        patch.serviceTier !== undefined &&
        patch.serviceTier !== prev.serviceTier
      ) {
        next.serviceTier = patch.serviceTier;
        didChange = true;
      }
      if ("cacheTtl" in next) {
        delete next.cacheTtl;
        didChange = true;
      }

      const prevPending = state.pendingSessionPrefsBySession[sessionId];
      let nextPendingMap = state.pendingSessionPrefsBySession;
      if (prevPending) {
        const nextPending: SessionComposerPrefs = { ...prevPending };
        let pendingChanged = false;
        if (
          patch.modelId !== undefined &&
          nextPending.modelId === patch.modelId
        ) {
          delete nextPending.modelId;
          delete nextPending.modelLabel;
          delete nextPending.apiMethod;
          pendingChanged = true;
        }
        if (patch.effort !== undefined && nextPending.effort === patch.effort) {
          delete nextPending.effort;
          pendingChanged = true;
        }
        if (
          patch.permissionMode !== undefined &&
          nextPending.permissionMode === patch.permissionMode
        ) {
          delete nextPending.permissionMode;
          pendingChanged = true;
        }
        if (
          patch.serviceTier !== undefined &&
          nextPending.serviceTier === patch.serviceTier
        ) {
          delete nextPending.serviceTier;
          pendingChanged = true;
        }
        if (pendingChanged) {
          nextPendingMap = { ...state.pendingSessionPrefsBySession };
          if (Object.keys(nextPending).length === 0) {
            delete nextPendingMap[sessionId];
          } else {
            nextPendingMap[sessionId] = nextPending;
          }
        }
      }

      if (!didChange && nextPendingMap === state.pendingSessionPrefsBySession) {
        return state;
      }
      return {
        ...(didChange
          ? {
              sessionPrefsBySession: {
                ...state.sessionPrefsBySession,
                [sessionId]: next,
              },
            }
          : {}),
        ...(nextPendingMap !== state.pendingSessionPrefsBySession
          ? { pendingSessionPrefsBySession: nextPendingMap }
          : {}),
      };
    });
    if (didChange) {
      persistWebviewStateSnapshot(get());
    }
  },

  clearSessionPrefField: (sessionId, field) => {
    if (!sessionId) return;
    let didChange = false;
    set((state) => {
      const prev = state.sessionPrefsBySession[sessionId];
      if (!prev || !(field in prev)) return state;
      const next: SessionComposerPrefs = { ...prev };
      delete next[field];
      didChange = true;
      return {
        sessionPrefsBySession: {
          ...state.sessionPrefsBySession,
          [sessionId]: next,
        },
      };
    });
    if (didChange) {
      persistWebviewStateSnapshot(get());
    }
  },

  setPendingSessionPrefs: (sessionId, patch, replace = false) => {
    if (!sessionId) return;
    set((state) => {
      const nextMap = { ...state.pendingSessionPrefsBySession };
      if (patch === null) {
        if (!(sessionId in nextMap)) return state;
        delete nextMap[sessionId];
        return { pendingSessionPrefsBySession: nextMap };
      }
      const base: SessionComposerPrefs = replace
        ? {}
        : { ...(state.pendingSessionPrefsBySession[sessionId] ?? {}) };
      if (patch.modelId !== undefined) base.modelId = patch.modelId;
      if (patch.modelLabel !== undefined) base.modelLabel = patch.modelLabel;
      if (patch.apiMethod !== undefined) base.apiMethod = patch.apiMethod;
      if (patch.effort !== undefined) base.effort = patch.effort;
      if (patch.permissionMode !== undefined) {
        base.permissionMode = patch.permissionMode;
      }
      if (patch.serviceTier !== undefined) base.serviceTier = patch.serviceTier;
      delete base.cacheTtl;

      if (Object.keys(base).length === 0) {
        if (!(sessionId in nextMap)) return state;
        delete nextMap[sessionId];
      } else {
        nextMap[sessionId] = base;
      }
      return { pendingSessionPrefsBySession: nextMap };
    });
  },

  clearPendingSessionPrefs: (sessionId, field) => {
    if (!sessionId) return;
    set((state) => {
      const prev = state.pendingSessionPrefsBySession[sessionId];
      if (!prev) return state;
      const nextMap = { ...state.pendingSessionPrefsBySession };
      if (!field) {
        delete nextMap[sessionId];
        return { pendingSessionPrefsBySession: nextMap };
      }
      if (!(field in prev)) return state;
      const next: SessionComposerPrefs = { ...prev };
      delete next[field];
      if (field === "modelId") {
        delete next.modelLabel;
        delete next.apiMethod;
      }
      if (Object.keys(next).length === 0) {
        delete nextMap[sessionId];
      } else {
        nextMap[sessionId] = next;
      }
      return { pendingSessionPrefsBySession: nextMap };
    });
  },

  seedSessionPrefsFromSummary: (summary) => {
    if (!summary.sessionId) return;
    const prev = get().sessionPrefsBySession[summary.sessionId] ?? {};
    const patch: Partial<SessionComposerPrefs> = {};
    if (summary.model && prev.modelId === undefined) {
      patch.modelId = summary.model;
    }
    if (summary.effort && prev.effort === undefined) {
      patch.effort = summary.effort;
    }
    if (summary.permissionMode && prev.permissionMode === undefined) {
      patch.permissionMode = summary.permissionMode;
    }
    if (summary.serviceTier && prev.serviceTier === undefined) {
      patch.serviceTier = summary.serviceTier;
    }
    if (Object.keys(patch).length > 0) {
      get().setSessionPrefs(summary.sessionId, patch);
    }
  },

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
        ...(target.settingsSection
          ? { activeSettingsSection: target.settingsSection }
          : {}),
        activeSessionId: target.sessionId,
        activeSessionTitle: target.sessionTitle,
        pendingPermission: target.sessionId
          ? (state.pendingPermissionBySession[target.sessionId] ?? null)
          : null,
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
        ...(target.settingsSection
          ? { activeSettingsSection: target.settingsSection }
          : {}),
        activeSessionId: target.sessionId,
        activeSessionTitle: target.sessionTitle,
        pendingPermission: target.sessionId
          ? (state.pendingPermissionBySession[target.sessionId] ?? null)
          : null,
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

  setSessionTodos: (sessionId, todos) => {
    if (!sessionId) return;
    set((state) => ({
      todosBySession: {
        ...state.todosBySession,
        [sessionId]: todos,
      },
    }));
  },

  recordTurnDuration: (sessionId, key, workedDuration) => {
    if (!sessionId || !key || !workedDuration.trim()) return;
    let didChange = false;
    set((state) => {
      const prevSession = state.turnDurationsBySession[sessionId] ?? {};
      if (prevSession[key] === workedDuration) return state;
      didChange = true;
      const nextSessionEntries = Object.entries({
        ...prevSession,
        [key]: workedDuration,
      }).slice(-50);
      const nextBySession: Record<string, Record<string, string>> = {
        ...state.turnDurationsBySession,
        [sessionId]: Object.fromEntries(nextSessionEntries),
      };
      const sessionKeys = Object.keys(nextBySession);
      if (sessionKeys.length > 40) {
        for (const staleKey of sessionKeys.slice(0, sessionKeys.length - 40)) {
          delete nextBySession[staleKey];
        }
      }
      return { turnDurationsBySession: nextBySession };
    });
    if (didChange) {
      persistWebviewStateSnapshot(get());
    }
  },

  setDaemonStatus: (daemonStatus) =>
    set({ daemonStatus, capabilities: daemonStatus.capabilities }),

  setAccountStatus: (accountStatus) => set({ accountStatus }),

  setAuthLoaded: (authLoaded) => set({ authLoaded }),

  setAuthBypassed: (authBypassed) => set({ authBypassed }),

  setAuthDialogOpen: (authDialogOpen) => set({ authDialogOpen }),

  setPendingPermission: (pendingPermission, explicitSessionId) =>
    set((state) => {
      const nextQueues = { ...state.pendingPermissionsBySession };
      const nextMap = { ...state.pendingPermissionBySession };
      if (pendingPermission) {
        const targetSid =
          pendingPermission.sessionId ||
          explicitSessionId ||
          state.activeSessionId ||
          "__default__";
        const currentQueue = nextQueues[targetSid] ?? [];
        const existingIdx = currentQueue.findIndex(
          (item) => item.requestId === pendingPermission.requestId,
        );
        const updatedQueue =
          existingIdx >= 0
            ? currentQueue.map((item, i) =>
                i === existingIdx ? pendingPermission : item,
              )
            : [...currentQueue, pendingPermission];
        nextQueues[targetSid] = updatedQueue;
        const head = updatedQueue[0] ?? null;
        nextMap[targetSid] = head;
        const isActive =
          !state.activeSessionId ||
          targetSid === state.activeSessionId ||
          targetSid === "__default__";
        return {
          pendingPermissionsBySession: nextQueues,
          pendingPermissionBySession: nextMap,
          ...(isActive ? { pendingPermission: head } : {}),
        };
      }
      const targetSid = explicitSessionId ?? state.activeSessionId;
      if (targetSid) {
        delete nextQueues[targetSid];
        delete nextMap[targetSid];
      } else {
        delete nextQueues.__default__;
        delete nextMap.__default__;
      }
      const shouldClearActive =
        !explicitSessionId || explicitSessionId === state.activeSessionId;
      return {
        pendingPermissionsBySession: nextQueues,
        pendingPermissionBySession: nextMap,
        ...(shouldClearActive ? { pendingPermission: null } : {}),
      };
    }),

  clearPendingPermission: (sessionId, requestId) =>
    set((state) => {
      const existingQueue = state.pendingPermissionsBySession[sessionId] ?? [];
      const fallbackSingle = state.pendingPermissionBySession[sessionId];
      const effectiveQueue =
        existingQueue.length > 0
          ? existingQueue
          : fallbackSingle
            ? [fallbackSingle]
            : [];
      const nextQueue = requestId
        ? effectiveQueue.filter((item) => item.requestId !== requestId)
        : [];
      const queueChanged = nextQueue.length !== effectiveQueue.length;
      const activeMatch =
        state.pendingPermission &&
        (!state.pendingPermission.sessionId ||
          state.pendingPermission.sessionId === sessionId) &&
        (!requestId || state.pendingPermission.requestId === requestId);
      if (!queueChanged && !activeMatch) return state;

      const nextQueues = { ...state.pendingPermissionsBySession };
      const nextMap = { ...state.pendingPermissionBySession };
      const nextHead = nextQueue[0] ?? null;
      if (nextQueue.length === 0) {
        delete nextQueues[sessionId];
        delete nextMap[sessionId];
      } else {
        nextQueues[sessionId] = nextQueue;
        nextMap[sessionId] = nextHead;
      }

      const isActiveSession =
        !state.activeSessionId || state.activeSessionId === sessionId;
      return {
        pendingPermissionsBySession: nextQueues,
        pendingPermissionBySession: nextMap,
        ...(isActiveSession || activeMatch
          ? { pendingPermission: isActiveSession ? nextHead : state.pendingPermission }
          : {}),
      };
    }),

  setDefaultPermissionMode: (defaultPermissionMode) =>
    set({ defaultPermissionMode }),

  setIsStreamActive: (isStreamActive) => set({ isStreamActive }),

  setKeepAwake: (keepAwake) => set({ keepAwake }),

  setUnreadNotifications: (unreadNotifications) => set({ unreadNotifications }),

  enqueueOptimisticTurn: (pendingUserTurn) => set({ pendingUserTurn }),

  consumeOptimisticTurn: (id) =>
    set((state) =>
      state.pendingUserTurn?.id === id ? { pendingUserTurn: null } : state,
    ),

  setMidTurnSendMode: (midTurnSendMode) => set({ midTurnSendMode }),

  addMidTurnMessage: (item, restoreFirst) =>
    set((state) => {
      const existing = state.midTurnMessagesBySession[item.sessionId] ?? [];
      if (existing.some((m) => m.id === item.id)) return state;
      return {
        midTurnMessagesBySession: {
          ...state.midTurnMessagesBySession,
          [item.sessionId]: restoreFirst ? [item, ...existing] : [...existing, item],
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
          const normalized = normalizeRouteTarget(msg.route, resolvedSessionId);
          const rawTasks = msg.backgroundTasks ?? state.backgroundTasks;
          const scopedTasks = resolvedSessionId
            ? rawTasks.filter((t) => t.sessionId === resolvedSessionId)
            : [];
          const nextPendingQueues: Record<string, PendingPermissionRequest[]> = {
            ...state.pendingPermissionsBySession,
          };
          const nextPendingHeads: Record<
            string,
            PendingPermissionRequest | null
          > = {
            ...state.pendingPermissionBySession,
          };
          if (msg.pendingPermissions) {
            for (const [sid, list] of Object.entries(msg.pendingPermissions)) {
              const normalizedList: PendingPermissionRequest[] = list.map(
                (item) => ({
                  sessionId: item.sessionId || sid,
                  requestId: item.requestId,
                  toolName: item.toolName,
                  description: item.description,
                  riskTier:
                    item.riskTier === "hard_deny"
                      ? "catastrophic"
                      : item.riskTier,
                  command: item.command,
                  permissionMode: item.permissionMode,
                }),
              );
              if (normalizedList.length > 0) {
                nextPendingQueues[sid] = normalizedList;
                nextPendingHeads[sid] = normalizedList[0] ?? null;
              }
            }
          }
          const activePendingHead = resolvedSessionId
            ? (nextPendingHeads[resolvedSessionId] ?? state.pendingPermission)
            : state.pendingPermission;
          const nextSessionPrefs = { ...state.sessionPrefsBySession };
          if (resolvedSessionId && msg.activePermissionMode) {
            nextSessionPrefs[resolvedSessionId] = {
              ...nextSessionPrefs[resolvedSessionId],
              permissionMode: msg.activePermissionMode,
            };
          }
          return {
            surface: msg.surface,
            theme: msg.theme,
            resolvedTheme,
            accent: msg.accent,
            density: msg.density ?? state.density,
            reduceMotion: msg.reduceMotion ?? state.reduceMotion,
            ...(msg.workbench ? { workbench: msg.workbench } : {}),
            ...(msg.defaultPermissionMode
              ? { defaultPermissionMode: msg.defaultPermissionMode }
              : {}),
            sessionPrefsBySession: nextSessionPrefs,
            pendingPermissionsBySession: nextPendingQueues,
            pendingPermissionBySession: nextPendingHeads,
            pendingPermission: activePendingHead,
            route: normalized.route,
            activeRoute: normalized.route,
            ...(normalized.settingsSection
              ? { activeSettingsSection: normalized.settingsSection }
              : {}),
            activeSessionId: resolvedSessionId,
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
            backgroundTasks: scopedTasks,
            ...(msg.sessionId && msg.fileChanges
              ? {
                  fileChangesBySession: {
                    ...state.fileChangesBySession,
                    [msg.sessionId]: msg.fileChanges,
                  },
                }
              : {}),
            ...(resolvedSessionId && msg.todos
              ? {
                  todosBySession: {
                    ...state.todosBySession,
                    [resolvedSessionId]: msg.todos,
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
            composerFocusNonce: state.composerFocusNonce + 1,
          };
        });
        const next = get();
        if (next.surface === "editorPanel") {
          persistWebviewStateSnapshot(next);
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
      case "rayucode.todos.updated":
        set((state) => ({
          todosBySession: {
            ...state.todosBySession,
            [msg.sessionId]: msg.todos,
          },
        }));
        return;
      case "rayucode.permission.resolved":
        get().clearPendingPermission(msg.sessionId, msg.requestId);
        return;
      case "rayucode.permission.modeSync": {
        if (msg.isDefault) {
          set({ defaultPermissionMode: msg.mode });
        }
        if (msg.sessionId) {
          get().setSessionPrefs(msg.sessionId, { permissionMode: msg.mode });
          get().clearPendingSessionPrefs(msg.sessionId, "permissionMode");
        }
        return;
      }
      case "rayucode.session.prefsSync": {
        const sid = msg.sessionId;
        if (!sid) return;
        const prevPending = get().pendingSessionPrefsBySession[sid];
        const ackRaw = (msg.acknowledged ?? {}) as Record<string, unknown>;
        const ackModel =
          typeof ackRaw.model === "string" && ackRaw.model
            ? ackRaw.model
            : typeof ackRaw.modelId === "string" && ackRaw.modelId
              ? ackRaw.modelId
              : undefined;
        const ackPatch: Partial<SessionComposerPrefs> = {
          ...(ackModel !== undefined ? { modelId: ackModel } : {}),
          ...(ackModel !== undefined &&
          prevPending?.modelId === ackModel &&
          prevPending.modelLabel
            ? { modelLabel: prevPending.modelLabel }
            : {}),
          ...(ackModel !== undefined &&
          prevPending?.modelId === ackModel &&
          prevPending.apiMethod
            ? { apiMethod: prevPending.apiMethod }
            : {}),
          ...(typeof ackRaw.effort === "string"
            ? { effort: ackRaw.effort as EffortLevel }
            : {}),
          ...(typeof ackRaw.permissionMode === "string"
            ? { permissionMode: ackRaw.permissionMode as PermissionModeId }
            : {}),
          ...(typeof ackRaw.serviceTier === "string"
            ? { serviceTier: ackRaw.serviceTier as ServiceTier }
            : {}),
        };
        if (Object.keys(ackPatch).length > 0) {
          get().setSessionPrefs(sid, ackPatch);
        }

        const pendingRaw = (msg.pending ?? {}) as Record<string, unknown>;
        const pendingModel =
          typeof pendingRaw.model === "string" && pendingRaw.model
            ? pendingRaw.model
            : typeof pendingRaw.modelId === "string" && pendingRaw.modelId
              ? pendingRaw.modelId
              : undefined;
        const pendingPatch: Partial<SessionComposerPrefs> = {
          ...(pendingModel !== undefined ? { modelId: pendingModel } : {}),
          ...(pendingModel !== undefined &&
          prevPending?.modelId === pendingModel &&
          prevPending.modelLabel
            ? { modelLabel: prevPending.modelLabel }
            : {}),
          ...(pendingModel !== undefined &&
          prevPending?.modelId === pendingModel &&
          prevPending.apiMethod
            ? { apiMethod: prevPending.apiMethod }
            : {}),
          ...(typeof pendingRaw.effort === "string"
            ? { effort: pendingRaw.effort as EffortLevel }
            : {}),
          ...(typeof pendingRaw.permissionMode === "string"
            ? { permissionMode: pendingRaw.permissionMode as PermissionModeId }
            : {}),
          ...(typeof pendingRaw.serviceTier === "string"
            ? { serviceTier: pendingRaw.serviceTier as ServiceTier }
            : {}),
        };
        get().setPendingSessionPrefs(sid, pendingPatch, true);
        return;
      }
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
