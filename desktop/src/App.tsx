import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { AppProviders } from "@/components/providers/app-providers"
import { AppShell } from "@/components/shell/AppShell"
import { AuthSignInDialog } from "@/components/shell/AuthSignInDialog"
import { AuthWelcomeScreen } from "@/components/shell/AuthWelcomeScreen"
import {
  AutomationsSkeleton,
  ChangesSkeleton,
  ChatSkeleton,
  PluginsSkeleton,
  SettingsSkeleton,
  SwarmSkeleton,
  TelegramSkeleton,
} from "@/components/ui/page-skeletons"
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary"
import { ChatStream } from "@/features/execution-trace"
import {
  HomeView,
  SessionComposer,
  type ComposerSubmitPayload,
} from "@/features/sessions"
import { applyUrlQueryParamsToStore, useAppStore } from "@/lib/app-store"
import { normalizeFileChangesSnapshot } from "@/lib/harness-adapter"
import { ipcClient } from "@/lib/ipc-client"

const AutomationsView = React.lazy(() =>
  import("@/features/automations").then((m) => ({ default: m.AutomationsView }))
)
const ChangesView = React.lazy(() =>
  import("@/features/changes").then((m) => ({ default: m.ChangesView }))
)
const PluginsView = React.lazy(() =>
  import("@/features/plugins").then((m) => ({ default: m.PluginsView }))
)
const PreviewsHost = React.lazy(() =>
  import("@/features/previews").then((m) => ({ default: m.PreviewsHost }))
)
const SettingsView = React.lazy(() =>
  import("@/features/settings").then((m) => ({ default: m.SettingsView }))
)
const SwarmView = React.lazy(() =>
  import("@/features/swarm").then((m) => ({ default: m.SwarmView }))
)
const TelegramView = React.lazy(() =>
  import("@/features/telegram").then((m) => ({ default: m.TelegramView }))
)

function ActiveWorkspaceStage() {
  const queryClient = useQueryClient()
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const pendingStreamPrompt = useAppStore((s) => s.pendingStreamPrompt)
  const isStreamActive = useAppStore((s) => s.isStreamActive)

  const handleWorkspaceSubmit = React.useCallback(
    async (payload: ComposerSubmitPayload) => {
      let targetSessionId = activeSessionId
      if (!targetSessionId) {
        const sessionTitlePrompt =
          payload.prompt ||
          (payload.images?.length
            ? `Image: ${payload.images[0]?.name ?? "attachment"}`
            : "")
        const created = await ipcClient.sessions.createSession({
          prompt: sessionTitlePrompt,
          modelId: payload.modelId,
          modelLabel: payload.modelLabel,
          effort: payload.effort,
          permissionMode: payload.permissionMode,
        })
        targetSessionId = created.id
        queryClient.setQueryData(
          ["execution-trace", "turns", created.id],
          []
        )
        useAppStore.getState().setActiveSession(created.id, created.title)
        void queryClient.invalidateQueries({ queryKey: ["sessions"] })
      }
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: targetSessionId,
        prompt: payload.prompt,
        images: payload.images,
        modelId: payload.modelId,
        modelLabel: payload.modelLabel,
      })
    },
    [activeSessionId, queryClient]
  )

  return (
    <ChatStream
      sessionId={activeSessionId}
      composerSlot={
        <SessionComposer
          mode="workspace"
          onSubmit={handleWorkspaceSubmit}
          onStop={() => {
            useAppStore.getState().setPendingStreamPrompt(null)
            useAppStore.getState().setIsStreamActive(false)
            if (activeSessionId) {
              void ipcClient.trace.cancel(activeSessionId)
            }
          }}
          isSubmitting={Boolean(pendingStreamPrompt) || isStreamActive}
        />
      }
    />
  )
}

function ActiveRouteCanvas() {
  const activeRoute = useAppStore((s) => s.activeRoute)

  switch (activeRoute) {
    case "home":
      return (
        <SectionErrorBoundary title="Home session view failed to render">
          <React.Suspense fallback={<ChatSkeleton />}>
            <HomeView />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "workspace":
      return (
        <SectionErrorBoundary title="Active workspace failed to render">
          <React.Suspense fallback={<ChatSkeleton />}>
            <ActiveWorkspaceStage />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "swarm":
      return (
        <SectionErrorBoundary title="Swarm orchestration view failed to render">
          <React.Suspense fallback={<SwarmSkeleton />}>
            <SwarmView />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "automations":
      return (
        <SectionErrorBoundary title="Automations view failed to render">
          <React.Suspense fallback={<AutomationsSkeleton />}>
            <AutomationsView />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "plugins":
      return (
        <SectionErrorBoundary title="Plugins view failed to render">
          <React.Suspense fallback={<PluginsSkeleton />}>
            <PluginsView />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "changes":
      return (
        <SectionErrorBoundary title="Changes view failed to render">
          <React.Suspense fallback={<ChangesSkeleton />}>
            <ChangesView />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "telegram":
      return (
        <SectionErrorBoundary title="Telegram Remote view failed to render">
          <React.Suspense fallback={<TelegramSkeleton />}>
            <TelegramView />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "settings":
      return (
        <SectionErrorBoundary title="Settings view failed to render">
          <React.Suspense fallback={<SettingsSkeleton />}>
            <SettingsView />
          </React.Suspense>
        </SectionErrorBoundary>
      )
  }
}

function AuthQuerySync() {
  const queryClient = useQueryClient()
  const authState = useAppStore((s) => s.authState)
  const daemonMode = useAppStore((s) => s.daemonMode)
  const signedIn = authState?.signedIn ?? false
  const method = authState?.method ?? "none"
  const remainingCredits = authState?.credits?.remainingCredits ?? null
  const allowedModelsCount = authState?.allowedModels.length ?? 0

  React.useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["settings"] })
    void queryClient.invalidateQueries({ queryKey: ["models"] })
    void queryClient.invalidateQueries({ queryKey: ["sessions"] })
  }, [
    queryClient,
    signedIn,
    method,
    remainingCredits,
    allowedModelsCount,
    daemonMode,
  ])

  return null
}

export function App() {
  const authState = useAppStore((s) => s.authState)
  const authLoaded = useAppStore((s) => s.authLoaded)
  const authBypassed = useAppStore((s) => s.authBypassed)

  React.useEffect(() => {
    if (window.location.search) {
      applyUrlQueryParamsToStore(window.location.search)
    }
    const handlePopState = () => {
      applyUrlQueryParamsToStore(window.location.search)
    }
    window.addEventListener("popstate", handlePopState)

    // Sync real Rayu Cloud auth and daemon status (leave activeWorkspacePath null until user selects a project)
    void ipcClient.auth.getState().then((auth) => {
      useAppStore.getState().setAuthState(auth)
      useAppStore.getState().setAuthLoaded(true)
      if (auth.signedIn) {
        void ipcClient.auth.refresh().then((refreshed) => {
          useAppStore.getState().setAuthState(refreshed)
        })
      }
    })
    const unsubAuth = ipcClient.auth.onAuthChange((auth) => {
      const store = useAppStore.getState()
      store.setAuthState(auth)
      store.setAuthLoaded(true)
      if (auth.signedIn) {
        store.setAuthBypassed(false)
      }
    })
    void ipcClient.daemon.getStatus().then((status) => {
      useAppStore
        .getState()
        .setDaemonMode(status.connected && status.mode !== "demo" ? "live" : "demo")
    })
    const unsubStatus = ipcClient.daemon.onStatusChange((status) => {
      useAppStore
        .getState()
        .setDaemonMode(status.connected && status.mode !== "demo" ? "live" : "demo")
    })
    const unsubHarness = ipcClient.harness.onEvent((frame) => {
      if (frame.ev === "permission_request") {
        useAppStore.getState().setPendingPermission({
          sessionId: String(frame.session_id ?? ""),
          requestId: String(frame.request_id ?? ""),
          toolName: String(frame.tool_name ?? "tool"),
          description: String(frame.description ?? "Tool execution requested"),
        })
      } else if (frame.ev === "file_changes_state") {
        const sid = typeof frame.session_id === "string" ? frame.session_id : ""
        const snapshot = normalizeFileChangesSnapshot(frame.snapshot, sid)
        if (snapshot && snapshot.session_id) {
          useAppStore
            .getState()
            .setSessionFileChanges(snapshot.session_id, snapshot)
        }
      } else if (frame.ev === "turn_done" || frame.ev === "turn_stopped") {
        useAppStore.getState().setPendingPermission(null)
      }
    })

    return () => {
      window.removeEventListener("popstate", handlePopState)
      unsubAuth()
      unsubStatus()
      unsubHarness()
    }
  }, [])

  const isTestEnv =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: { MODE?: string } }).env?.MODE === "test"
  const showWelcomeGate =
    !isTestEnv && authLoaded && !authState?.signedIn && !authBypassed

  return (
    <AppProviders>
      <AuthQuerySync />
      <AuthSignInDialog />
      {showWelcomeGate ? (
        <AuthWelcomeScreen />
      ) : (
        <AppShell previewFallback={<PreviewsHost />}>
          <ActiveRouteCanvas />
        </AppShell>
      )}
    </AppProviders>
  )
}

export default App
