import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { HostToWebviewMessage } from "@shared/vscodeProtocol";

import {
  ChatSkeleton,
  PluginsSkeleton,
  SectionErrorBoundary,
  SettingsSkeleton,
} from "@/components/ui";
import {
  ChatWorkspaceView,
  LiveTraceController,
} from "@/features/chat";
import {
  HomePage,
  SessionComposer,
  useSubmitComposer,
  type ComposerSubmitPayload,
} from "@/features/composer";
import {
  BackgroundDockBar,
  BackgroundProcessDrawer,
} from "@/features/processes";
import { AppShell, AuthWelcomeScreen } from "@/features/shell";
import {
  callRpc,
  isVsCodeWebview,
  onHostMessage,
  sendHarnessRequest,
  useAppStore,
  type MidTurnMessageItem,
} from "@/lib";

const PluginsView = React.lazy(() =>
  import("@/features/plugins").then((m) => ({ default: m.PluginsView })),
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
  const daemonStatus = useAppStore((s) => s.daemonStatus);
  const accountStatus = useAppStore((s) => s.accountStatus);
  const authLoaded = useAppStore((s) => s.authLoaded);
  const authBypassed = useAppStore((s) => s.authBypassed);
  const authDialogOpen = useAppStore((s) => s.authDialogOpen);
  const backgroundDrawerOpen = useAppStore((s) => s.backgroundDrawerOpen);
  const isStreamActive = useAppStore((s) => s.isStreamActive);

  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const openNewChatDraft = useAppStore((s) => s.openNewChatDraft);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setAuthLoaded = useAppStore((s) => s.setAuthLoaded);
  const setAuthBypassed = useAppStore((s) => s.setAuthBypassed);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);
  const setIsStreamActive = useAppStore((s) => s.setIsStreamActive);
  const requestSessionSearchFocus = useAppStore(
    (s) => s.requestSessionSearchFocus,
  );
  const requestComposerFocus = useAppStore((s) => s.requestComposerFocus);

  // Hydrate Rayu Cloud / account status immediately on mount (never blocked on daemon connection).
  React.useEffect(() => {
    if (authLoaded) return;
    let cancelled = false;
    void callRpc("settings.account.get")
      .then((account) => {
        if (cancelled) return;
        setAccountStatus(account);
        setAuthLoaded(true);
        if (account.signedIn) {
          setAuthBypassed(false);
          setAuthDialogOpen(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAuthLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    authLoaded,
    setAccountStatus,
    setAuthBypassed,
    setAuthDialogOpen,
    setAuthLoaded,
  ]);

  // Handle host commands and query invalidations pushed from Extension Host.
  React.useEffect(() => {
    const invalidateModelAndProviderQueries = () => {
      void queryClient.invalidateQueries({
        queryKey: ["composer", "model-settings"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["composer", "providers"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["settings", "models"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["settings", "providers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    };

    return onHostMessage((msg: HostToWebviewMessage) => {
      if (msg.type === "rayucode.host.init") {
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        void queryClient.invalidateQueries({ queryKey: ["processes"] });
        void queryClient.invalidateQueries({
          queryKey: ["workspace", "ledger"],
        });
        if (msg.accountStatus) {
          queryClient.setQueryData(["settings", "account"], msg.accountStatus);
          queryClient.setQueryData(
            ["shell", "account", "status"],
            msg.accountStatus,
          );
          invalidateModelAndProviderQueries();
        } else if (msg.daemonStatus.state === "connected") {
          invalidateModelAndProviderQueries();
        }
        return;
      }
      if (msg.type === "rayucode.account.changed") {
        queryClient.setQueryData(["settings", "account"], msg.account);
        queryClient.setQueryData(["shell", "account", "status"], msg.account);
        void queryClient.invalidateQueries({
          queryKey: ["settings", "account"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["shell", "account", "status"],
        });
        invalidateModelAndProviderQueries();
        return;
      }
      if (msg.type === "rayucode.daemon.statusChanged") {
        if (msg.status.state === "connected") {
          invalidateModelAndProviderQueries();
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
          void queryClient.invalidateQueries({ queryKey: ["chat", "history"] });
          void queryClient.invalidateQueries({ queryKey: ["processes"] });
          void queryClient.invalidateQueries({
            queryKey: ["workspace", "ledger"],
          });
          void queryClient.invalidateQueries({ queryKey: ["settings", "config"] });
        }
        return;
      }
      if (msg.type === "rayucode.config.changed") {
        invalidateModelAndProviderQueries();
        void queryClient.invalidateQueries({ queryKey: ["settings", "features"] });
        void queryClient.invalidateQueries({ queryKey: ["settings", "config"] });
        return;
      }
      if (msg.type === "rayucode.processes.snapshot") {
        void queryClient.invalidateQueries({ queryKey: ["processes"] });
        return;
      }
      if (msg.type === "rayucode.fileChanges.updated") {
        void queryClient.invalidateQueries({ queryKey: ["changes"] });
        return;
      }
      if (msg.type === "rayucode.workspaces.changed") {
        void queryClient.invalidateQueries({ queryKey: ["composer"] });
        void queryClient.invalidateQueries({ queryKey: ["changes"] });
        void queryClient.invalidateQueries({
          queryKey: ["workspace", "ledger"],
        });
        return;
      }
      if (msg.type === "rayucode.workspaces.ledgerChanged") {
        queryClient.setQueryData(["workspace", "ledger"], msg.ledger);
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        return;
      }
      if (msg.type === "rayucode.host.command") {
        if (msg.command === "newSession") {
          openNewChatDraft({
            workingDir: useAppStore.getState().activeProjectPath,
          });
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
    openNewChatDraft,
    queryClient,
    requestComposerFocus,
    requestSessionSearchFocus,
    setActiveRoute,
    setBackgroundDrawerOpen,
  ]);

  const submitComposer = useSubmitComposer();
  const handleWorkspaceSubmit = React.useCallback(async (payload: ComposerSubmitPayload) => {
    await submitComposer(payload);
  }, [submitComposer]);

  const handleDrainQueuedMessage = React.useCallback(
    async (item: MidTurnMessageItem) => {
      const state = useAppStore.getState();
      const project = state.workspaces.find((workspace) => workspace.path === item.workingDir);
      try {
        await submitComposer({
          prompt: item.text,
          images: item.images,
          project: project?.name ?? "workspace",
          workingDir: item.workingDir,
          checkout: project?.branch ?? "",
          modelId: item.modelSpec ?? "",
          modelSpec: item.modelSpec,
          modelLabel: item.modelSpec ?? "",
          apiMethod: item.apiMethod,
          effort: item.effort,
          serviceTier: item.serviceTier,
          cacheTtl: item.cacheTtl,
          permissionMode: item.permissionMode ?? "default",
          editorSelection: item.editorSelection ?? null,
          selectionIncluded: Boolean(item.editorSelection),
        }, { sessionId: item.sessionId });
      } catch (error) {
        state.setQueuePausedForSession(item.sessionId, true);
        state.addMidTurnMessage(item, true);
        toast.error(error instanceof Error ? error.message : "Could not send the queued message.");
      }
    },
    [submitComposer],
  );

  const handleWorkspaceStop = React.useCallback(() => {
    const sid = useAppStore.getState().activeSessionId;
    if (!sid) return;
    useAppStore.getState().setQueuePausedForSession(sid, true);
    setIsStreamActive(false);
    sendHarnessRequest({
      req: "cancel",
      session_id: sid,
    });
  }, [setIsStreamActive]);

  const isDaemonOffline =
    (daemonStatus.state === "disconnected" || daemonStatus.state === "error") &&
    !authBypassed;
  const isSignedOutGate =
    isVsCodeWebview() &&
    authLoaded &&
    !accountStatus?.signedIn &&
    !authBypassed;
  const showAuthGate = authDialogOpen || isSignedOutGate || isDaemonOffline;

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
              onDrainQueuedMessage={handleDrainQueuedMessage}
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

      case "plugins":
        return (
          <RoutePanel
            title="Plugins & MCP failed to load"
            fallback={<PluginsSkeleton />}
          >
            <PluginsView />
          </RoutePanel>
        );

      case "settings":
      case "swarm":
      case "agents":
      case "automations":
      case "remote":
        return (
          <RoutePanel
            title="Settings failed to load"
            fallback={<SettingsSkeleton />}
          >
            <SettingsView />
          </RoutePanel>
        );

      case "changes":
      default:
        return activeSessionId ? (
          <RoutePanel
            title="Chat workspace failed to render"
            fallback={<ChatSkeleton />}
          >
            <ChatWorkspaceView
              sessionId={activeSessionId}
              onDrainQueuedMessage={handleDrainQueuedMessage}
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
        ) : (
          <RoutePanel title="Home failed to render" fallback={<ChatSkeleton />}>
            <HomePage
              onSelectSession={(sid) => {
                setActiveSession(sid);
              }}
            />
          </RoutePanel>
        );
    }
  };

  return (
    <>
      <LiveTraceController />
      {showAuthGate ? (
        <div
          data-testid={isDaemonOffline ? "rayu-offline-gate" : "rayu-auth-gate"}
          className="h-screen w-screen overflow-hidden bg-canvas"
        >
          <AuthWelcomeScreen
            onContinue={() => {
              setAuthDialogOpen(false);
              if (
                !useAppStore.getState().accountStatus?.signedIn ||
                isDaemonOffline
              ) {
                setAuthBypassed(true);
              }
            }}
          />
        </div>
      ) : (
        <AppShell
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
      )}
    </>
  );
}

export default App;
