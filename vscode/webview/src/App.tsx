import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { HostToWebviewMessage } from "@shared/vscodeProtocol";

import {
  AutomationsSkeleton,
  ChangesSkeleton,
  ChatSkeleton,
  PluginsSkeleton,
  RemoteSkeleton,
  SectionErrorBoundary,
  SettingsSkeleton,
  SwarmSkeleton,
} from "@/components/ui";
import { ChatWorkspaceView } from "@/features/chat";
import {
  HomePage,
  SessionComposer,
  type ComposerSubmitPayload,
} from "@/features/composer";
import {
  ArtifactsPanel,
  CodeViewer,
  ContextPanel,
  FilesSidePanel,
  ToolsProgressPanel,
} from "@/features/inspector";
import {
  BackgroundDockBar,
  BackgroundProcessDrawer,
} from "@/features/processes";
import { AppShell, AuthWelcomeScreen } from "@/features/shell";
import {
  callRpc,
  onHostMessage,
  sendHarnessRequest,
  useAppStore,
} from "@/lib";

const SwarmView = React.lazy(() =>
  import("@/features/swarm").then((m) => ({ default: m.SwarmView })),
);
const AutomationsView = React.lazy(() =>
  import("@/features/automations").then((m) => ({
    default: m.AutomationsView,
  })),
);
const PluginsView = React.lazy(() =>
  import("@/features/plugins").then((m) => ({ default: m.PluginsView })),
);
const ChangesView = React.lazy(() =>
  import("@/features/changes").then((m) => ({ default: m.ChangesView })),
);
const RemoteView = React.lazy(() =>
  import("@/features/remote").then((m) => ({ default: m.RemoteView })),
);
const SettingsView = React.lazy(() =>
  import("@/features/settings").then((m) => ({ default: m.SettingsView })),
);

function RoutePanel({
  title,
  fallback,
  children,
}: {
  title: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SectionErrorBoundary title={title}>
      <React.Suspense fallback={fallback}>{children}</React.Suspense>
    </SectionErrorBoundary>
  );
}

export function App() {
  const queryClient = useQueryClient();

  const activeRoute = useAppStore((s) => s.activeRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeRightTab = useAppStore((s) => s.activeRightTab);
  const daemonStatus = useAppStore((s) => s.daemonStatus);
  const authLoaded = useAppStore((s) => s.authLoaded);
  const authBypassed = useAppStore((s) => s.authBypassed);
  const backgroundDrawerOpen = useAppStore((s) => s.backgroundDrawerOpen);
  const isStreamActive = useAppStore((s) => s.isStreamActive);

  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setAuthLoaded = useAppStore((s) => s.setAuthLoaded);
  const setAuthBypassed = useAppStore((s) => s.setAuthBypassed);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);
  const setIsStreamActive = useAppStore((s) => s.setIsStreamActive);
  const enqueueOptimisticTurn = useAppStore((s) => s.enqueueOptimisticTurn);
  const requestSessionSearchFocus = useAppStore(
    (s) => s.requestSessionSearchFocus,
  );
  const requestComposerFocus = useAppStore((s) => s.requestComposerFocus);

  // Hydrate Rayu Cloud / account status once daemon is connected.
  React.useEffect(() => {
    if (daemonStatus.state !== "connected" || authLoaded) return;
    let cancelled = false;
    void callRpc("settings.account.get")
      .then((account) => {
        if (cancelled) return;
        setAccountStatus(account);
        setAuthLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoaded, daemonStatus.state, setAccountStatus, setAuthLoaded]);

  // Handle host commands and query invalidations pushed from Extension Host.
  React.useEffect(() => {
    return onHostMessage((msg: HostToWebviewMessage) => {
      if (msg.type === "rayucode.host.init") {
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        void queryClient.invalidateQueries({ queryKey: ["processes"] });
        return;
      }
      if (msg.type === "rayucode.processes.snapshot") {
        void queryClient.invalidateQueries({ queryKey: ["processes"] });
        return;
      }
      if (msg.type === "rayucode.workspaces.changed") {
        void queryClient.invalidateQueries({ queryKey: ["composer"] });
        void queryClient.invalidateQueries({ queryKey: ["changes"] });
        return;
      }
      if (msg.type === "rayucode.host.command") {
        if (msg.command === "newSession") {
          setActiveSession(null);
          setActiveRoute("home");
          requestComposerFocus();
        } else if (msg.command === "openBackgroundProcesses") {
          setBackgroundDrawerOpen(true);
        } else if (
          msg.command === "sendSelection" ||
          msg.command === "focusComposer"
        ) {
          setActiveRoute(
            useAppStore.getState().activeSessionId ? "workspace" : "home",
          );
          requestComposerFocus();
        } else if (msg.command === "resumeSession") {
          requestSessionSearchFocus();
        }
      }
    });
  }, [
    queryClient,
    requestComposerFocus,
    requestSessionSearchFocus,
    setActiveRoute,
    setActiveSession,
    setBackgroundDrawerOpen,
  ]);

  const handleWorkspaceSubmit = React.useCallback(
    async (payload: ComposerSubmitPayload) => {
      let targetSessionId = useAppStore.getState().activeSessionId;

      if (!targetSessionId) {
        try {
          const created = await callRpc("sessions.create", {
            workingDir: payload.workingDir,
            permissionMode: payload.permissionMode,
            model: payload.modelId,
          });
          targetSessionId = created.session.sessionId;
          setActiveSession(created.session.sessionId, created.session.title);
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        } catch {
          return;
        }
      }

      const selectionContext = payload.editorSelection
        ? `\n\n[Active Editor Selection: ${payload.editorSelection.relativePath}#L${payload.editorSelection.lineStart}-L${payload.editorSelection.lineEnd}]`
        : "";

      const refFiles = payload.editorSelection
        ? `${payload.editorSelection.relativePath}:${payload.editorSelection.lineStart}-${payload.editorSelection.lineEnd}`
        : undefined;

      enqueueOptimisticTurn({
        id: `opt_${targetSessionId}_${Date.now()}`,
        sessionId: targetSessionId,
        prompt: payload.prompt,
        refFiles,
        images: payload.images?.map((img) => ({
          name: img.name ?? "Attachment",
          dataUrl: img.data,
        })),
        createdAtMs: Date.now(),
      });

      setIsStreamActive(true);
      sendHarnessRequest({
        req: "send_message",
        session_id: targetSessionId,
        content: `${payload.prompt}${selectionContext}`,
        model: payload.modelId,
        effort: payload.effort,
        images: payload.images,
      });
    },
    [enqueueOptimisticTurn, queryClient, setActiveSession, setIsStreamActive],
  );

  const handleWorkspaceStop = React.useCallback(() => {
    const sid = useAppStore.getState().activeSessionId;
    if (!sid) return;
    setIsStreamActive(false);
    sendHarnessRequest({
      req: "cancel",
      session_id: sid,
    });
  }, [setIsStreamActive]);

  const isDaemonOffline =
    (daemonStatus.state === "disconnected" || daemonStatus.state === "error") &&
    !authBypassed;

  if (isDaemonOffline) {
    return (
      <div
        data-testid="rayu-offline-gate"
        className="h-screen w-screen overflow-hidden bg-canvas"
      >
        <AuthWelcomeScreen onContinue={() => setAuthBypassed(true)} />
      </div>
    );
  }

  const documentSlot =
    activeRightTab === "code" ? (
      <CodeViewer />
    ) : activeRightTab === "sidePanel" ? (
      <ArtifactsPanel />
    ) : activeRightTab === "diff" ? (
      <React.Suspense fallback={<ChangesSkeleton />}>
        <ChangesView />
      </React.Suspense>
    ) : undefined;

  const renderRoute = () => {
    switch (activeRoute) {
      case "home":
        return (
          <RoutePanel title="Home failed to render" fallback={<ChatSkeleton />}>
            <HomePage
              onSelectSession={(sid) => {
                setActiveSession(sid);
              }}
            />
          </RoutePanel>
        );

      case "workspace":
        return (
          <RoutePanel
            title="Chat workspace failed to render"
            fallback={<ChatSkeleton />}
          >
            <ChatWorkspaceView
              sessionId={activeSessionId}
              backgroundDockSlot={<BackgroundDockBar />}
              composerSlot={
                <SessionComposer
                  mode="workspace"
                  sessionId={activeSessionId}
                  isSubmitting={isStreamActive}
                  onSubmit={handleWorkspaceSubmit}
                  onStop={handleWorkspaceStop}
                />
              }
            />
          </RoutePanel>
        );

      case "swarm":
        return (
          <RoutePanel
            title="Swarm Mission Control failed to load"
            fallback={<SwarmSkeleton />}
          >
            <SwarmView />
          </RoutePanel>
        );

      case "automations":
        return (
          <RoutePanel
            title="Automations failed to load"
            fallback={<AutomationsSkeleton />}
          >
            <AutomationsView />
          </RoutePanel>
        );

      case "plugins":
        return (
          <RoutePanel
            title="Plugins & MCP failed to load"
            fallback={<PluginsSkeleton />}
          >
            <PluginsView />
          </RoutePanel>
        );

      case "changes":
        return (
          <RoutePanel
            title="Changes review failed to load"
            fallback={<ChangesSkeleton />}
          >
            <ChangesView />
          </RoutePanel>
        );

      case "remote":
        return (
          <RoutePanel
            title="Remote access failed to load"
            fallback={<RemoteSkeleton />}
          >
            <RemoteView />
          </RoutePanel>
        );

      case "settings":
        return (
          <RoutePanel
            title="Settings failed to load"
            fallback={<SettingsSkeleton />}
          >
            <SettingsView />
          </RoutePanel>
        );
    }
  };

  return (
    <AppShell
      contextSlot={<ContextPanel />}
      toolsSlot={<ToolsProgressPanel />}
      artifactsSlot={<ArtifactsPanel />}
      filesSlot={<FilesSidePanel />}
      documentSlot={documentSlot}
      backgroundDockSlot={
        activeRoute === "workspace" ? undefined : <BackgroundDockBar />
      }
      backgroundDrawerSlot={
        <BackgroundProcessDrawer
          open={backgroundDrawerOpen}
          onOpenChange={setBackgroundDrawerOpen}
          onClose={() => setBackgroundDrawerOpen(false)}
        />
      }
    >
      {renderRoute()}
    </AppShell>
  );
}

export default App;
