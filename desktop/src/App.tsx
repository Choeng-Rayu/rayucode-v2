import * as React from "react"
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
import { useAppStore, type AppRoute } from "@/lib/app-store"
import { getAuthSession } from "@/lib/auth-placeholder"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

function DefaultHomeStage() {
  const auth = getAuthSession()
  const [prompt, setPrompt] = React.useState("")
  const setActiveSession = useAppStore((s) => s.setActiveSession)

  const handleSend = async () => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      toast("Type a prompt or /command first")
      return
    }
    const created = await ipcClient.sessions.createSession({ prompt: trimmed })
    setPrompt("")
    setActiveSession(created.id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-8 text-center">
        <h1 className="m-0 text-2xl font-medium tracking-tight text-ink">
          Good to see you, {auth.userId.replace("usr_", "")}. What&apos;s{" "}
          <em className="font-serif text-[1.08em] font-normal text-brand-text italic">
            next?
          </em>
        </h1>
      </div>

      {/* Double-bordered floating composer (max-width: 732px, zero focus glow, zero file chips) */}
      <div className="flex shrink-0 justify-center px-6 pb-[22px]">
        <div className="rayu-card-bevel w-full max-w-[732px] rounded-[22px] bg-shell p-[5px]">
          <div className="flex items-center gap-2.5 px-[13px] pt-[5px] pb-2 text-xs text-muted-ink">
            <button
              type="button"
              onClick={() => toast("Project: rayucode-v2")}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-ink hover:bg-hover hover:text-body"
            >
              <span>rayucode-v2</span>
            </button>
            <button
              type="button"
              onClick={() => toast("Checkout: Local Checkout")}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-ink hover:bg-hover hover:text-body"
            >
              <span>Local Checkout</span>
            </button>
          </div>
          <div className="flex flex-col rounded-[17px] border border-premium-hi bg-raised shadow-rayu-1">
            <textarea
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="Ask anything, @ to mention, / for actions"
              aria-label="Message RayuCode"
              className="min-h-[52px] w-full resize-none border-none bg-transparent px-[18px] pt-3.5 pb-2.5 text-sm text-ink placeholder:text-muted-ink focus:shadow-none focus:outline-none"
            />
            <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-[11px]">
              <span className="rounded-full px-2.5 py-1 text-xs font-medium text-ink">
                Claude Opus 5.5 <span className="text-muted-ink">Medium</span>
              </span>
              <span className="flex-1" />
              <span className="rounded-full px-2.5 py-1 text-xs font-medium text-body">
                Ask
              </span>
              <button
                type="button"
                aria-label="Send message"
                onClick={() => void handleSend()}
                className="rayu-primary-bevel grid size-8 cursor-pointer place-items-center rounded-full bg-brand text-brand-ink transition-transform hover:scale-105 hover:bg-brand-bright"
              >
                <svg
                  className="size-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DefaultActiveWorkspaceStage() {
  const openCodeFile = useAppStore((s) => s.openCodeFile)
  const openDocPreview = useAppStore((s) => s.openDocPreview)
  const [traceExpanded, setTraceExpanded] = React.useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-5 px-6 py-5">
          <div className="inline-flex items-center gap-2 text-xs text-muted-ink">
            <span>Context automatically compacted</span>
          </div>

          <div className="flex max-w-[82%] flex-col items-end gap-1.5 self-end">
            <div className="rounded-[9px] border border-hairline bg-pane px-2.5 py-1 text-xs text-body">
              src/session/cache.rs · src/shard/store.rs
            </div>
            <div className="rayu-surface-bevel rounded-2xl bg-raised px-[15px] py-[11px] text-sm text-ink">
              Retire{" "}
              <code className="rounded-xs border border-hairline bg-inset px-1.5 py-0.5 font-mono text-xs">
                SessionCache
              </code>{" "}
              in{" "}
              <code className="rounded-xs border border-hairline bg-inset px-1.5 py-0.5 font-mono text-xs">
                src/session/cache.rs
              </code>{" "}
              and route reads through{" "}
              <code className="rounded-xs border border-hairline bg-inset px-1.5 py-0.5 font-mono text-xs">
                ShardStore::lookup
              </code>{" "}
              with the LRU budget preserved.
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={traceExpanded}
              onClick={() => setTraceExpanded((v) => !v)}
              className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full px-2 py-1 text-[13.5px] font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink"
            >
              <span>Worked for 1m 25s</span>
              <svg
                className={cn(
                  "size-3 transition-transform",
                  traceExpanded && "rotate-90"
                )}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>

            <div className="text-[14.5px] leading-relaxed text-body">
              <p>
                <strong className="font-semibold text-ink">
                  Done — safe to ship without data migration.
                </strong>{" "}
                All session reads now route through{" "}
                <code className="rounded-xs border border-hairline bg-inset px-1.5 py-0.5 font-mono text-xs text-ink">
                  ShardStore::lookup
                </code>{" "}
                with{" "}
                <code className="rounded-xs border border-hairline bg-inset px-1.5 py-0.5 font-mono text-xs text-ink">
                  CacheBudget
                </code>{" "}
                preserved, and all{" "}
                <strong className="font-semibold text-ink">14/14</strong> tests
                in{" "}
                <code className="rounded-xs border border-hairline bg-inset px-1.5 py-0.5 font-mono text-xs text-ink">
                  session::
                </code>{" "}
                pass.{" "}
                <button
                  type="button"
                  onClick={() => openCodeFile("lookup.rs", 21)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-xs px-1 font-medium text-brand-text hover:bg-brand-soft hover:underline"
                >
                  <span className="font-mono text-xs">&lt;/&gt;</span>
                  <span>src/session/lookup.rs (line 21)</span>
                </button>
                <span className="mx-1 text-muted-ink">·</span>
                <button
                  type="button"
                  onClick={() =>
                    openDocPreview("markdown", "MIGRATION_PLAN.md")
                  }
                  className="inline-flex cursor-pointer items-center gap-1 rounded-xs px-1 font-medium text-brand-text hover:bg-brand-soft hover:underline"
                >
                  <span>MIGRATION_PLAN.md (line 14)</span>
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
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
            <DefaultHomeStage />
          </React.Suspense>
        </SectionErrorBoundary>
      )
    case "workspace":
      return (
        <SectionErrorBoundary title="Active workspace failed to render">
          <React.Suspense fallback={<ChatSkeleton />}>
            <DefaultActiveWorkspaceStage />
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
