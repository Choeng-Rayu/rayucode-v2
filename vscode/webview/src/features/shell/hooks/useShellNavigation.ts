import * as React from "react";
import type { AppRoute } from "@shared/vscodeProtocol";

import type { NavGlyphName } from "@/components/ui/rayu-symbols";
import { useAppStore } from "@/lib/app-store";
import { callRpc, postToHost } from "@/lib/rpc-client";

export type ShellFormFactor = "compact" | "medium" | "wide";

export interface RouteMeta {
  id: AppRoute;
  title: string;
}

export const SHELL_ROUTES: Record<AppRoute, RouteMeta> = {
  home: { id: "home", title: "New session" },
  workspace: { id: "workspace", title: "Active session" },
  swarm: { id: "swarm", title: "Swarm Mission Control" },
  agents: { id: "agents", title: "Agents & Personas" },
  automations: { id: "automations", title: "Automations" },
  plugins: { id: "plugins", title: "Plugins, MCP & Memory" },
  changes: { id: "changes", title: "Changes & Review" },
  remote: { id: "remote", title: "Remote Access" },
  settings: { id: "settings", title: "Settings" },
};

export interface PrimaryNavItem {
  id: AppRoute;
  label: string;
  icon: NavGlyphName;
}

export const PRIMARY_NAV_ITEMS: ReadonlyArray<PrimaryNavItem> = [
  { id: "home", label: "Chat", icon: "home" },
  { id: "plugins", label: "Plugins", icon: "plug" },
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
    (route?: AppRoute, sessionId?: string | null, beside = true) => {
      postToHost({
        type: "rayucode.ui.openEditorPanel",
        route: route ?? activeRoute,
        sessionId: (sessionId ?? activeSessionId) || undefined,
        beside,
      });
    },
    [activeRoute, activeSessionId],
  );

  const focusSidebar = React.useCallback(() => {
    postToHost({
      type: "rayucode.ui.focusSidebar",
    });
  }, []);

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
    openInEditorPanel,
    focusSidebar,
  };
}
