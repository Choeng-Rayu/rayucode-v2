import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { LogIn } from "lucide-react"
import { toast } from "sonner"

import { RayuProcessingMark } from "@/components/ui/rayu-processing-mark"
import { useAppStore } from "@/lib/app-store"
import { getAuthSession } from "@/lib/auth-placeholder"
import { formatDurationSeconds } from "@/lib/harness-adapter"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

import { useCreateSession } from "../hooks/use-sessions"
import type {
  ComposerSubmitPayload,
  PromptImageAttachment,
  SessionSummary,
} from "../types"
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
  const [pendingSubmit, setPendingSubmit] = React.useState<{
    prompt: string
    images?: PromptImageAttachment[]
    startedAtMs: number
  } | null>(null)
  const [pendingElapsedSec, setPendingElapsedSec] = React.useState(0)
  const submitAttemptRef = React.useRef(0)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()

  const createSessionMutation = useCreateSession()

  React.useEffect(() => {
    if (!pendingSubmit) return
    const timer = setInterval(() => {
      setPendingElapsedSec(
        Math.max(1, Math.floor((Date.now() - pendingSubmit.startedAtMs) / 1000))
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [pendingSubmit])

  const handleStopPending = React.useCallback(() => {
    submitAttemptRef.current += 1
    if (pendingSubmit) {
      setComposerValue(pendingSubmit.prompt)
    }
    setPendingSubmit(null)
    setPendingElapsedSec(0)
  }, [pendingSubmit])

  const handleSubmit = React.useCallback(
    async (payload: ComposerSubmitPayload) => {
      const attemptId = ++submitAttemptRef.current
      const submitStartedAtMs = Date.now()
      setPendingSubmit({
        prompt: payload.prompt,
        images: payload.images,
        startedAtMs: submitStartedAtMs,
      })
      setPendingElapsedSec(1)
      setComposerValue("")

      const sessionTitlePrompt =
        payload.prompt ||
        (payload.images?.length
          ? `Image: ${payload.images[0]?.name ?? "attachment"}`
          : "")

      const result = await createSessionMutation.mutateAsync({
        prompt: sessionTitlePrompt,
        project: payload.project,
        checkout: payload.checkout,
        modelId: payload.modelId,
        modelLabel: payload.modelLabel,
        effort: payload.effort,
        permissionMode: payload.permissionMode,
      })

      if (submitAttemptRef.current !== attemptId) {
        return
      }

      if (!result.ok) {
        setPendingSubmit(null)
        setPendingElapsedSec(0)
        setComposerValue(payload.prompt)
        toast.error(result.error)
        return
      }

      setPendingSubmit(null)
      setPendingElapsedSec(0)
      queryClient.setQueryData(
        ["execution-trace", "turns", result.data.id],
        []
      )
      void queryClient.invalidateQueries({ queryKey: ["sessions"] })

      // Sync the chosen Local Permissions mode to the Rust core before the first turn runs
      void ipcClient.harness
        .setPermissionMode(result.data.id, payload.permissionMode)
        .then((res) => {
          if (!res.ok) {
            toast.error(
              res.error ?? "RayuCode core rejected the permission mode"
            )
          }
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to set permission mode for the new session"
          )
        })
      useAppStore.getState().setPendingStreamPrompt({
        sessionId: result.data.id,
        prompt: payload.prompt,
        images: payload.images,
        modelId: payload.modelId,
        modelLabel: payload.modelLabel,
        startedAtMs: submitStartedAtMs,
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
      {pendingSubmit ? (
        <>
          <div
            role="presentation"
            aria-hidden="true"
            className="h-[1.5px] shrink-0 animate-pulse bg-brand"
          />
          <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-5 overflow-y-auto px-6 pt-8 pb-6">
            <div className="flex max-w-[82%] flex-col items-end gap-1.5 self-end">
              {pendingSubmit.images && pendingSubmit.images.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {pendingSubmit.images.map((img, idx) => (
                    <img
                      key={`${img.name}_${idx}`}
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-24 max-w-[180px] rounded-xl border border-hairline bg-inset object-cover shadow-bevel-surface"
                    />
                  ))}
                </div>
              ) : null}
              {pendingSubmit.prompt.trim().length > 0 ? (
                <div
                  data-testid="home-optimistic-prompt"
                  className="max-w-full rounded-2xl bg-active/85 px-4 py-2.5 text-[14.5px] leading-[1.6] text-ink whitespace-pre-wrap"
                >
                  {pendingSubmit.prompt}
                </div>
              ) : null}
            </div>

            <div
              data-testid="home-starting-indicator"
              className="flex flex-col gap-1.5"
            >
              <div className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
                <RayuProcessingMark animated className="size-[17px]" />
                <span className="tabular-nums">
                  {`Working · ${formatDurationSeconds(pendingElapsedSec)}`}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : (
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
      )}

      {/* Floating 732px Composer in Home Mode (shows Project & Checkout top tray) */}
      <SessionComposer
        mode="home"
        value={composerValue}
        onValueChange={setComposerValue}
        inputRef={textareaRef}
        onSubmit={handleSubmit}
        onStop={handleStopPending}
        isSubmitting={Boolean(pendingSubmit) || createSessionMutation.isPending}
      />
    </div>
  )
}
