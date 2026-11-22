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
import {
  ChatStream,
  sendTracePrompt,
  traceKeys,
  type ExecutionTurn,
} from "@/features/execution-trace"
import {
  HomeView,
  SessionComposer,
  type ComposerSubmitPayload,
} from "@/features/sessions"
import { useAppStore, type AppRoute } from "@/lib/app-store"

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

function RouteFallbackCard({
  route,
  title,
  subtitle,
}: {
  route: AppRoute
  title: string
  subtitle: string
}) {
  return (
    <div
      data-testid={`route-stage-${route}`}
      className="mx-auto flex w-full max-w-[1040px] flex-col gap-4 p-6"
    >
      <div className="rayu-card-bevel rounded-xl bg-pane p-5">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-xs text-muted-ink">{subtitle}</p>
      </div>
    </div>
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
            <RouteFallbackCard
              route="swarm"
              title="Gateway retry & session shards"
              subtitle="rayucode-swarm-core · 4 agents · 2 worktrees · 0 file conflicts"
            />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "automations":
      return (
        <SectionErrorBoundary title="Automations view failed to render">
          <React.Suspense fallback={<AutomationsSkeleton />}>
            <RouteFallbackCard
              route="automations"
              title="Automations"
              subtitle="Run unattended overnight missions (rayucode-overnight-core) and recurring checks with structured morning handoff reports."
            />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "plugins":
      return (
        <SectionErrorBoundary title="Plugins view failed to render">
          <React.Suspense fallback={<PluginsSkeleton />}>
            <RouteFallbackCard
              route="plugins"
              title="Plugins"
              subtitle="Connect plugins to let RayuCode work across your tools"
            />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "changes":
      return (
        <SectionErrorBoundary title="Changes view failed to render">
          <React.Suspense fallback={<ChangesSkeleton />}>
            <RouteFallbackCard
              route="changes"
              title="feat/retire-session-cache"
              subtitle="4 changed files · +82 −224 · explicit PR approval guardrail"
            />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "telegram":
      return (
        <SectionErrorBoundary title="Telegram Remote view failed to render">
          <React.Suspense fallback={<TelegramSkeleton />}>
            <RouteFallbackCard
              route="telegram"
              title="Telegram Remote"
              subtitle="Drive RayuCode sessions, send prompts or images, and approve tool calls or plans from a private Telegram chat (/telegram-bot)."
            />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "settings":
      return (
        <SectionErrorBoundary title="Settings view failed to render">
          <React.Suspense fallback={<SettingsSkeleton />}>
            <RouteFallbackCard
              route="settings"
              title="Settings"
              subtitle="Account, Appearance (Dark / Light + Rayu Green / Ocean Blue), Models, Voice, Connections, Shortcuts"
            />
          </React.Suspense>
        </SectionErrorBoundary>
      )
  }
}

export function App() {
  return (
    <AppProviders>
      <AppShell>
        <ActiveRouteCanvas />
      </AppShell>
    </AppProviders>
  )
}

export default App
