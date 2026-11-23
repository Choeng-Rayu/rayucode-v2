import * as React from "react"
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"

export function AuthSignInDialog() {
  const open = useAppStore((s) => s.authDialogOpen)
  const setOpen = useAppStore((s) => s.setAuthDialogOpen)
  const authState = useAppStore((s) => s.authState)
  const setAuthState = useAppStore((s) => s.setAuthState)

  const [activeTab, setActiveTab] = React.useState<"browser" | "apikey">(
    "browser"
  )
  const [apiKey, setApiKey] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setErrorMessage(null)
      setSubmitting(false)
    }
    setOpen(nextOpen)
  }

  const handleBrowserSignIn = async () => {
    setErrorMessage(null)
    setSubmitting(true)
    try {
      const next = await ipcClient.auth.signInWithBrowser()
      setAuthState(next)
      toast.success(
        next.user?.displayName || next.user?.email
          ? `Signed in as ${next.user.displayName || next.user.email}`
          : "Signed in to Rayu Cloud"
      )
      setOpen(false)
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Rayu Cloud browser sign-in failed"
      setErrorMessage(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelBrowserSignIn = async () => {
    try {
      const next = await ipcClient.auth.cancelSignIn()
      setAuthState(next)
      setSubmitting(false)
      setErrorMessage(null)
    } catch {
      setSubmitting(false)
    }
  }

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setErrorMessage("Enter a Rayu API key starting with rayu_sk_live_.")
      return
    }
    setErrorMessage(null)
    setSubmitting(true)
    try {
      const next = await ipcClient.auth.signInWithApiKey(trimmed)
      setAuthState(next)
      setApiKey("")
      toast.success("Rayu Cloud API key verified and saved")
      setOpen(false)
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not verify Rayu API key"
      setErrorMessage(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    setSubmitting(true)
    try {
      const next = await ipcClient.auth.signOut()
      setAuthState(next)
      toast("Signed out of Rayu Cloud")
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyLoginUrl = async () => {
    if (!authState?.pendingAuthUrl) return
    try {
      await navigator.clipboard.writeText(authState.pendingAuthUrl)
      toast("Sign-in URL copied to clipboard")
    } catch {
      toast("Unable to copy URL")
    }
  }

  const isWaitingForBrowser = Boolean(authState?.signingIn || (submitting && activeTab === "browser"))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-brand-text" aria-hidden="true" />
            <span>Connect to Rayu Cloud</span>
          </DialogTitle>
          <DialogDescription>
            Sign in once to authenticate RayuCode Desktop and share credentials
            with your local CLI daemon (~/.rayu/rayu-auth.json).
          </DialogDescription>
        </DialogHeader>

        {authState?.signedIn ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-brand bg-brand-soft p-3.5">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <CheckCircle2
                  className="size-4 shrink-0 text-brand-text"
                  aria-hidden="true"
                />
                <span>
                  {authState.user?.displayName ||
                    authState.user?.email ||
                    "Rayu Cloud API Key Active"}
                </span>
              </div>
              <div className="mt-1 text-xs text-body">
                {authState.method === "oauth"
                  ? `${authState.user?.email ?? "OAuth session"} · ${authState.credits?.planName ?? "Rayu Cloud"}`
                  : `Authenticated via RAYU_API_KEY · ${authState.credits?.planName ?? "Rayu Cloud"}`}
              </div>
              {authState.credits?.remainingCredits != null && (
                <div className="mt-1.5 font-mono text-xs text-brand-text tabular-nums">
                  {authState.credits.remainingCredits.toLocaleString()} credits
                  remaining
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={handleSignOut}
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                Sign out
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              setActiveTab(v as "browser" | "apikey")
              setErrorMessage(null)
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="browser">Browser Sign-In</TabsTrigger>
              <TabsTrigger value="apikey">API Key</TabsTrigger>
            </TabsList>

            <TabsContent value="browser" className="mt-3 space-y-4">
              <div className="rounded-xl border border-hairline bg-pane p-3.5 text-xs leading-relaxed text-body">
                Opens{" "}
                <span className="font-mono text-ink">
                  {authState?.webBase ?? "https://rayucode.com"}/cli-login
                </span>{" "}
                in your default browser and completes authentication over a local
                loopback callback on{" "}
                <span className="font-mono text-ink">127.0.0.1</span>. Tokens
                never leave the main Electron process.
              </div>

              {isWaitingForBrowser ? (
                <div className="space-y-3 rounded-xl border border-hairline bg-inset p-3.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-ink">
                    <Loader2
                      className="size-3.5 animate-spin text-brand-text"
                      aria-hidden="true"
                    />
                    <span>Waiting for browser sign-in to finish...</span>
                  </div>

                  {authState?.pendingAuthUrl && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={authState.pendingAuthUrl}
                        aria-label="Rayu Cloud sign-in URL"
                        className="h-8 min-w-0 flex-1 rounded-lg border border-hairline bg-pane px-2.5 font-mono text-[11px] text-muted-ink focus:outline-none"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={handleCopyLoginUrl}
                      >
                        <Copy className="size-3" aria-hidden="true" />
                        Copy
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          if (authState.pendingAuthUrl) {
                            void ipcClient.native.openExternal(
                              authState.pendingAuthUrl
                            )
                          }
                        }}
                      >
                        <ExternalLink className="size-3" aria-hidden="true" />
                        Open
                      </Button>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={handleCancelBrowserSignIn}
                    >
                      Cancel sign-in
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  data-testid="auth-browser-signin-btn"
                  className="w-full"
                  onClick={handleBrowserSignIn}
                >
                  <LogIn className="size-4" aria-hidden="true" />
                  Continue in Browser
                </Button>
              )}
            </TabsContent>

            <TabsContent value="apikey" className="mt-3">
              <form onSubmit={handleSaveApiKey} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label
                    htmlFor="rayu-api-key-input"
                    className="block text-xs font-medium text-ink"
                  >
                    Rayu Cloud API Key
                  </label>
                  <input
                    id="rayu-api-key-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="rayu_sk_live_..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="h-9 w-full rounded-lg border border-hairline bg-inset px-3 font-mono text-xs text-ink placeholder:text-muted-ink focus:border-hairline-strong focus:outline-none"
                  />
                  <p className="text-[11px] text-muted-ink">
                    Verified live against{" "}
                    <span className="font-mono">
                      {authState?.gatewayBase ?? "https://gateway.rayucode.com"}
                      /v1/credits
                    </span>{" "}
                    and stored in{" "}
                    <span className="font-mono">~/.config/rayucode/rayu.env</span>{" "}
                    (0600).
                  </p>
                </div>

                <Button
                  type="submit"
                  data-testid="auth-apikey-submit-btn"
                  disabled={submitting}
                  className="w-full"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound className="size-4" aria-hidden="true" />
                  )}
                  Validate &amp; Save API Key
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}

        {(errorMessage || authState?.error) && (
          <div
            role="alert"
            className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            {errorMessage ?? authState?.error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
