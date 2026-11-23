import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { LogIn } from "lucide-react"
import { toast } from "sonner"

import { useAppStore } from "@/lib/app-store"
import { getAuthSession } from "@/lib/auth-placeholder"
import { cn } from "@/lib/utils"

import { useCreateSession } from "../hooks/use-sessions"
import type { ComposerSubmitPayload, SessionSummary } from "../types"
import { SessionComposer } from "./composer"

export interface HomeViewProps {
  userName?: string
  onSelectSession?: (sessionId: string) => void
  onSessionCreated?: (session: SessionSummary) => void
  className?: string
}

function resolveDisplayName(
  explicitName?: string,
  cloudDisplayName?: string | null,
  cloudEmail?: string | null
): string | null {
  if (explicitName && explicitName.trim().length > 0) {
    return explicitName.trim()
  }
  const source =
    cloudDisplayName?.trim() ||
    (cloudEmail?.includes("@") ? cloudEmail.split("@")[0] : "") ||
    getAuthSession().name
  const parts = source.trim().split(/\s+/).filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last) return null
  return last.charAt(0).toUpperCase() + last.slice(1)
}

export function HomeView({
  userName,
  onSessionCreated,
  className,
}: HomeViewProps) {
  const authState = useAppStore((s) => s.authState)
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen)
  const displayName = resolveDisplayName(
    userName,
    authState?.signedIn ? authState.user?.displayName : null,
    authState?.signedIn ? authState.user?.email : null
  )
  const showCloudSignIn = !authState?.signedIn && !userName
  const [composerValue, setComposerValue] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()

  const createSessionMutation = useCreateSession()

  const handleSubmit = React.useCallback(
    async (payload: ComposerSubmitPayload) => {
      const result = await createSessionMutation.mutateAsync({
        prompt: payload.prompt,
        project: payload.project,
        checkout: payload.checkout,
        modelId: payload.modelId,
        modelLabel: payload.modelLabel,
        effort: payload.effort,
        permissionMode: payload.permissionMode,
      })

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      setComposerValue("")
      void queryClient.invalidateQueries({ queryKey: ["sessions"] })
      void queryClient.invalidateQueries({ queryKey: ["execution-trace"] })
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: result.data.id,
        prompt: payload.prompt,
        modelId: payload.modelId,
        modelLabel: payload.modelLabel,
      })
      useAppStore
        .getState()
        .setActiveSession(result.data.id, result.data.title)
      onSessionCreated?.(result.data)
    },
    [createSessionMutation, onSessionCreated, queryClient]
  )

  return (
    <div
      data-testid="home-view"
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      {/* Clean, serene welcome hero matching prototype/index.html 1:1 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-10 text-center">
        <img
          src="./rayu-fox.png"
          alt="Rayu Code"
          className="h-[74px] w-auto object-contain select-none"
        />

        <h1 className="m-0 text-2xl font-medium tracking-[-0.025em] text-ink">
          {displayName ? `Good to see you, ${displayName}.` : "Good to see you."}{" "}
          What&apos;s{" "}
          <em className="font-serif text-[1.08em] font-normal tracking-[-0.005em] text-brand-text italic">
            next?
          </em>
        </h1>

        {showCloudSignIn && (
          <button
            type="button"
            data-testid="home-cloud-signin-btn"
            onClick={() => setAuthDialogOpen(true)}
            className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-full border border-premium bg-raised px-3.5 py-1.5 text-xs font-medium text-ink shadow-bevel-surface transition-colors hover:border-brand hover:text-brand-text"
          >
            <LogIn className="size-3.5 text-brand-text" aria-hidden="true" />
            <span>Sign in to Rayu Cloud</span>
          </button>
        )}
      </div>

      {/* Floating 732px Composer in Home Mode (shows Project & Checkout top tray) */}
      <SessionComposer
        mode="home"
        value={composerValue}
        onValueChange={setComposerValue}
        inputRef={textareaRef}
        onSubmit={handleSubmit}
        isSubmitting={createSessionMutation.isPending}
      />
    </div>
  )
}
