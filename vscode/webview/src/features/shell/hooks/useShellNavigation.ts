import * as React from "react";
import type { AppRoute } from "@shared/vscodeProtocol";

import type { InspectorGlyphName, NavGlyphName } from "@/components/ui/rayu-symbols";
import { useAppStore, type RightTabId } from "@/lib/app-store";
import { callRpc, postToHost } from "@/lib/rpc-client";

export type ShellFormFactor = "compact" | "medium" | "wide";

export interface RouteMeta {
  id: AppRoute;
  title: string;
  hasRightInspector: boolean;
}

export const SHELL_ROUTES: Record<AppRoute, RouteMeta> = {
  home: { id: "home", title: "New session", hasRightInspector: true },
  workspace: { id: "workspace", title: "Active session", hasRightInspector: true },
  swarm: { id: "swarm", title: "Swarm Mission Control", hasRightInspector: false },
  automations: { id: "automations", title: "Automations", hasRightInspector: false },
  plugins: { id: "plugins", title: "Plugins, MCP & Memory", hasRightInspector: false },
  changes: { id: "changes", title: "Changes & Review", hasRightInspector: false },
  remote: { id: "remote", title: "Remote Access", hasRightInspector: false },
  settings: { id: "settings", title: "Settings", hasRightInspector: false },
};

export interface PrimaryNavItem {
  id: AppRoute;
  label: string;
  icon: NavGlyphName;
}

export const PRIMARY_NAV_ITEMS: ReadonlyArray<PrimaryNavItem> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "automations", label: "Automations", icon: "clock" },
  { id: "plugins", label: "Plugins", icon: "plug" },
  { id: "changes", label: "Changes", icon: "branch" },
  { id: "remote", label: "Remote", icon: "telegram" },
];

export interface RightInspectorTabItem {
  id: RightTabId;
  label: string;
  shortcut?: string;
  pillLabel: string | null;
  icon: InspectorGlyphName;
}

export const RIGHT_INSPECTOR_TABS: ReadonlyArray<RightInspectorTabItem> = [
  {
    id: "overview",
    label: "Context & Environment",
    pillLabel: null,
    icon: "list",
  },
  {
    id: "terminal",
    label: "Integrated Terminal",
    shortcut: "⌘J",
    pillLabel: "Terminal",
    icon: "terminal",
  },
  {
    id: "diff",
    label: "Changes & Diff",
    pillLabel: "Changes",
    icon: "diff",
  },
  {
    id: "browser",
    label: "Simple Browser Preview",
    pillLabel: "Preview",
    icon: "globe",
  },
  {
    id: "files",
    label: "Files & Side Panel",
    pillLabel: "Files",
    icon: "folder",
  },
];

export function resolveFormFactorFromWidth(width: number): ShellFormFactor {
  if (width < 560) return "compact";
  if (width < 960) return "medium";
  return "wide";
}

export function useShellFormFactor(
  containerRef?: React.RefObject<HTMLElement | null>,
): { formFactor: ShellFormFactor; width: number } {
  const surface = useAppStore((s) => s.surface);
  const [width, setWidth] = React.useState<number>(() => {
    if (typeof window !== "undefined" && window.innerWidth > 0) {
      return window.innerWidth;
    }
    return surface === "sidebar" ? 360 : 1280;
  });

  React.useEffect(() => {
    const el = containerRef?.current;
    const updateWidth = (nextW: number) => {
      if (nextW > 0) {
        setWidth(Math.round(nextW));
      }
    };

    if (el && typeof ResizeObserver !== "undefined") {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) updateWidth(rect.width);
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && entry.contentRect.width > 0) {
          updateWidth(entry.contentRect.width);
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }

    if (typeof window !== "undefined") {
      const onResize = () => updateWidth(window.innerWidth);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    return undefined;
  }, [containerRef]);

  return {
    formFactor: resolveFormFactorFromWidth(width),
    width,
  };
}

export function useShellNavigation() {
  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSessionTitle = useAppStore((s) => s.activeSessionTitle);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const surface = useAppStore((s) => s.surface);
  const navHistory = useAppStore((s) => s.navHistory);
  const navHistoryIndex = useAppStore((s) => s.navHistoryIndex);

  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleInspector = useAppStore((s) => s.toggleInspector);
  const openRightTab = useAppStore((s) => s.openRightTab);

  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;

  const startNewSession = React.useCallback(
    async (workingDir?: string) => {
      try {
        const res = await callRpc("sessions.create", {
          workingDir: workingDir ?? activeProjectPath ?? undefined,
        });
        setActiveSession(res.session.sessionId, res.session.title);
        return res.session;
      } catch {
        setActiveSession(null);
        setActiveRoute("home");
        return null;
      }
    },
    [activeProjectPath, setActiveRoute, setActiveSession],
  );

  const openInEditorPanel = React.useCallback(
    (route?: AppRoute, sessionId?: string | null) => {
      postToHost({
        type: "rayucode.ui.openEditorPanel",
        route: route ?? activeRoute,
        sessionId: (sessionId ?? activeSessionId) || undefined,
      });
    },
    [activeRoute, activeSessionId],
  );

  const openIntegratedTerminal = React.useCallback(
    (cwd?: string) => {
      postToHost({
        type: "rayucode.editor.openTerminal",
        cwd: cwd ?? activeProjectPath ?? undefined,
        name: "RayuCode",
      });
    },
    [activeProjectPath],
  );

  return {
    surface,
    activeRoute,
    activeSessionId,
    activeSessionTitle,
    activeProjectPath,
    canGoBack,
    canGoForward,
    navigateTo: setActiveRoute,
    selectSession: setActiveSession,
    startNewSession,
    goBack,
    goForward,
    toggleSidebar,
    toggleInspector,
    openRightTab,
    openInEditorPanel,
    openIntegratedTerminal,
  };
}
