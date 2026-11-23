import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { AppProviders } from "@/components/providers/app-providers"
import { AppShell } from "@/components/shell/AppShell"
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
import { AutomationsView } from "@/features/automations"
import { ChangesView } from "@/features/changes"
import {
  ChatStream,
  sendTracePrompt,
  traceKeys,
  type ExecutionTurn,
} from "@/features/execution-trace"
import { PluginsView } from "@/features/plugins"
import { PreviewsHost } from "@/features/previews"
import {
  HomeView,
  SessionComposer,
  type ComposerSubmitPayload,
} from "@/features/sessions"
import { SettingsView } from "@/features/settings"
import { SwarmView } from "@/features/swarm"
import { TelegramView } from "@/features/telegram"
import { applyUrlQueryParamsToStore, useAppStore } from "@/lib/app-store"

function ActiveWorkspaceStage() {
  const activeSessionId =
    useAppStore((s) => s.activeSessionId) ?? "ses_retire_cache"
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleWorkspaceSubmit = React.useCallback(
    async (payload: ComposerSubmitPayload) => {
      setIsSubmitting(true)
      try {
        const result = await sendTracePrompt({
          sessionId: activeSessionId,
          prompt: payload.prompt,
          modelLabel: payload.modelLabel,
        })
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        queryClient.setQueryData<ExecutionTurn[]>(
          traceKeys.turns(activeSessionId),
          (prev) => (prev ? [...prev, result.data] : [result.data])
        )
      } finally {
        setIsSubmitting(false)
      }
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
          isSubmitting={isSubmitting}
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

export function App() {
  React.useEffect(() => {
    if (window.location.search) {
      applyUrlQueryParamsToStore(window.location.search)
    }
    const handlePopState = () => {
      applyUrlQueryParamsToStore(window.location.search)
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  return (
    <AppProviders>
      <AppShell previewFallback={<PreviewsHost />}>
        <ActiveRouteCanvas />
      </AppShell>
    </AppProviders>
  )
}

export default App
