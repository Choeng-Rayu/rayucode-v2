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
  useLiveTraceStore,
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
  requestHarnessAck,
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
  const midTurnMessagesBySession = useAppStore(
    (s) => s.midTurnMessagesBySession,
  );
  const pausedQueueSessions = useAppStore((s) => s.pausedQueueSessions);
  const pendingUserTurn = useAppStore((s) => s.pendingUserTurn);
  const liveTurnsBySession = useLiveTraceStore((s) => s.liveTurnsBySession);

  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const openNewChatDraft = useAppStore((s) => s.openNewChatDraft);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setAuthLoaded = useAppStore((s) => s.setAuthLoaded);
  const setAuthBypassed = useAppStore((s) => s.setAuthBypassed);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);
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
    const MODEL_AND_PROVIDER_KEYS = [
      ["composer", "model-settings"],
      ["composer", "providers"],
      ["settings", "models"],
      ["settings", "providers"],
      ["agents", "models"],
      ["models"],
    ] as const;

    const invalidateModelAndProviderQueries = () => {
      for (const queryKey of MODEL_AND_PROVIDER_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    let catalogFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingCatalogGlobal = false;
    const pendingCatalogSessions = new Set<string>();

    const flushCatalogInvalidation = () => {
      catalogFlushTimer = null;
      const isGlobal = pendingCatalogGlobal;
      const sessionIds = [...pendingCatalogSessions];
      pendingCatalogGlobal = false;
      pendingCatalogSessions.clear();

      if (isGlobal || sessionIds.length === 0) {
        invalidateModelAndProviderQueries();
        return;
      }

      for (const prefix of [
        ["composer", "model-settings"],
        ["settings", "models"],
        ["agents", "models"],
        ["models"],
      ] as const) {
        void queryClient.invalidateQueries({
          queryKey: prefix,
          predicate: (query) => {
            const session = query.queryKey.at(-1);
            return (
              session === "global" ||
              session === prefix.at(-1) ||
              (typeof session === "string" && sessionIds.includes(session))
            );
          },
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["composer", "providers"] });
      void queryClient.invalidateQueries({ queryKey: ["settings", "providers"] });
    };

    const scheduleCatalogInvalidation = (
      targetSessionIds: readonly string[],
      isGlobal: boolean,
    ) => {
      const activeSid = useAppStore.getState().activeSessionId;
      if (!isGlobal) {
        const hasMatchingActive = Boolean(
          activeSid && targetSessionIds.includes(activeSid),
        );
        const hasGlobalToken = targetSessionIds.includes("global");
        if (activeSid && !hasMatchingActive && !hasGlobalToken) {
          return;
        }
        if (hasGlobalToken) {
          pendingCatalogGlobal = true;
        } else {
          for (const sid of targetSessionIds) {
            if (sid) pendingCatalogSessions.add(sid);
          }
        }
      } else {
        pendingCatalogGlobal = true;
      }

      if (catalogFlushTimer !== null) return;
      catalogFlushTimer = setTimeout(flushCatalogInvalidation, 16);
    };

    const unsubscribe = onHostMessage((msg: HostToWebviewMessage) => {
      const rawMsg = msg as
        | HostToWebviewMessage
        | {
            type: "rayucode.catalog.changed";
            sessionId?: string;
            sessionIds?: string[];
            credentialsChanged?: boolean;
          };
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
      if (
        rawMsg.type === "rayucode.catalog.changed" ||
        rawMsg.type === "rayucode.models.changed"
      ) {
        const singleSession =
          "sessionId" in rawMsg && typeof rawMsg.sessionId === "string"
            ? rawMsg.sessionId.trim()
            : "";
        const listSessions =
          "sessionIds" in rawMsg && Array.isArray(rawMsg.sessionIds)
            ? rawMsg.sessionIds.filter(
                (id): id is string => typeof id === "string" && id.trim().length > 0,
              )
            : [];
        const ids = [
          ...listSessions,
          ...(singleSession ? [singleSession] : []),
        ];
        const isGlobal =
          Boolean(rawMsg.credentialsChanged) ||
          ids.length === 0 ||
          ids.includes("global");
        scheduleCatalogInvalidation(ids, isGlobal);
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
      if (
        msg.type === "rayucode.session.prefsSync" ||
        msg.type === "rayucode.permission.modeSync"
      ) {
        useAppStore.getState().applyHostMessage(msg);
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

    return () => {
      if (catalogFlushTimer !== null) {
        clearTimeout(catalogFlushTimer);
        catalogFlushTimer = null;
      }
      unsubscribe();
    };
  }, [
    openNewChatDraft,
    queryClient,
    requestComposerFocus,
    requestSessionSearchFocus,
    setActiveRoute,
    setBackgroundDrawerOpen,
  ]);

  const submitComposer = useSubmitComposer();
  const handleWorkspaceSubmit = React.useCallback(
    async (
      payload: ComposerSubmitPayload,
      targetSessionId?: string | null,
    ) => {
      await submitComposer(
        payload,
        targetSessionId ? { sessionId: targetSessionId } : undefined,
      );
    },
    [submitComposer],
  );

  const drainingSessionsRef = React.useRef(new Set<string>());

  const handleDrainQueuedMessage = React.useCallback(
    async (item: MidTurnMessageItem) => {
      const state = useAppStore.getState();
      const sessionPrefs = {
        ...state.sessionPrefsBySession[item.sessionId],
        ...state.pendingSessionPrefsBySession[item.sessionId],
      };
      const project = state.workspaces.find(
        (workspace) => workspace.path === item.workingDir,
      );
      const modelSpec = item.modelSpec ?? sessionPrefs.modelId;
      const apiMethod = item.apiMethod ?? sessionPrefs.apiMethod;
      const effort = item.effort ?? sessionPrefs.effort;
      const serviceTier = item.serviceTier ?? sessionPrefs.serviceTier;
      const permissionMode =
        item.permissionMode ??
        sessionPrefs.permissionMode ??
        state.defaultPermissionMode ??
        "default";
      drainingSessionsRef.current.add(item.sessionId);
      try {
        await submitComposer(
          {
            prompt: item.text,
            images: item.images,
            project: project?.name ?? "workspace",
            workingDir: item.workingDir,
            checkout: project?.branch ?? "",
            modelId: modelSpec ?? "",
            modelSpec,
            modelLabel: sessionPrefs.modelLabel ?? modelSpec ?? "",
            apiMethod,
            effort,
            serviceTier,
            cacheTtl: item.cacheTtl,
            permissionMode,
            editorSelection: item.editorSelection ?? null,
            selectionIncluded: Boolean(item.editorSelection),
          },
          { sessionId: item.sessionId },
        );
      } catch (error) {
        state.setQueuePausedForSession(item.sessionId, true);
        state.addMidTurnMessage(item, true);
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not send the queued message.",
        );
      } finally {
        drainingSessionsRef.current.delete(item.sessionId);
      }
    },
    [submitComposer],
  );

  // Focus-switch-proof mid-turn queue drainer across ALL sessions in the store.
  React.useEffect(() => {
    for (const [sid, messages] of Object.entries(midTurnMessagesBySession)) {
      if (!sid || !messages || messages.length === 0) continue;
      if (pausedQueueSessions[sid]) continue;
      if (liveTurnsBySession[sid]?.isLive) continue;
      if (pendingUserTurn?.sessionId === sid) continue;
      if (drainingSessionsRef.current.has(sid)) continue;
      if (!messages.some((m) => m.mode === "queue")) continue;
      const nextQueued = useAppStore.getState().shiftNextQueuedMessage(sid);
      if (nextQueued) {
        void handleDrainQueuedMessage(nextQueued);
      }
    }
  }, [
    handleDrainQueuedMessage,
    liveTurnsBySession,
    midTurnMessagesBySession,
    pausedQueueSessions,
    pendingUserTurn,
  ]);

  const handleWorkspaceStop = React.useCallback(
    (targetSessionId?: string | null) => {
      const state = useAppStore.getState();
      const sessionId = targetSessionId ?? state.activeSessionId;
      if (!sessionId) return;
      state.setQueuePausedForSession(sessionId, true);
      void requestHarnessAck({ req: "cancel", session_id: sessionId }).catch(
        (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Rayu could not stop the turn.",
          );
        },
      );
    },
    [],
  );

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
              backgroundDockSlot={<BackgroundDockBar />}
              composerSlot={
                <SessionComposer
                  mode="workspace"
                  sessionId={activeSessionId}
                  isSubmitting={isStreamActive}
                  onSubmit={(payload) =>
                    handleWorkspaceSubmit(payload, activeSessionId)
                  }
                  onStop={() => handleWorkspaceStop(activeSessionId)}
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
              backgroundDockSlot={<BackgroundDockBar />}
              composerSlot={
                <SessionComposer
                  mode="workspace"
                  sessionId={activeSessionId}
                  isSubmitting={isStreamActive}
                  onSubmit={(payload) =>
                    handleWorkspaceSubmit(payload, activeSessionId)
                  }
                  onStop={() => handleWorkspaceStop(activeSessionId)}
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
