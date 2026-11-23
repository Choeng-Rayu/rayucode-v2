import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardPaste,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useAppStore, type AccentColor, type ThemeMode } from "@/lib/app-store"
import { ipcClient, type PermissionModeId } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

type AuthScreenStep =
  | "welcome"
  | "manual-key"
  | "choose-plan"
  | "onboarding"
  | "connect-account"

interface OnboardingPlan {
  id: string
  name: string
  price: string
  cadence: string
  credits: string
  summary: string
  group: "personal" | "team"
  recommended?: boolean
  features: string[]
}

const ONBOARDING_PLANS: readonly OnboardingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "forever",
    credits: "BYOK · 50 turns/day",
    summary: "Bring your own API keys across 30+ providers with full CLI & MCP tools.",
    group: "personal",
    features: [
      "Full RayuCode Desktop, CLI & MCP tools",
      "BYOK across Anthropic, OpenAI, Gemini & more",
      "Local Git diff, preview & terminal workflow",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$10",
    cadence: "/ mo",
    credits: "50,000 cr / mo",
    summary: "Hosted frontier models, Orchestrator subagents, Telegram & Hosted API.",
    group: "personal",
    features: [
      "50,000 Rayu Cloud credits / month",
      "Orchestrator subagents & Telegram remote",
      "Hosted API access + 10x cheaper KV cache reads",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    price: "$20",
    cadence: "/ mo",
    credits: "115,000 cr / mo",
    summary: "Most popular for daily full-stack building, Swarms, and overnight runs.",
    group: "personal",
    recommended: true,
    features: [
      "115,000 Rayu Cloud credits / month",
      "Full hosted model catalog (Opus, Sonnet, GPT, Gemini)",
      "Parallel Swarm worktrees & overnight automations",
    ],
  },
  {
    id: "max",
    name: "Max",
    price: "$50",
    cadence: "/ mo",
    credits: "300,000 cr / mo",
    summary: "Highest personal credit pool and pacing headroom for power builders.",
    group: "personal",
    features: [
      "300,000 Rayu Cloud credits / month",
      "3,750 cr / 5h session cap · 75,000 / wk",
      "Priority gateway routing across all models",
    ],
  },
  {
    id: "team",
    name: "Team",
    price: "$10",
    cadence: "/ mo",
    credits: "30,000 shared cr",
    summary: "Unlimited seats with shared credits for small engineering teams.",
    group: "team",
    features: [
      "Unlimited seats on shared credit pool",
      "7,500 cr / member weekly pacing",
      "Centralized billing & usage visibility",
    ],
  },
  {
    id: "team-plus",
    name: "Team Plus",
    price: "$29",
    cadence: "/ mo",
    credits: "100,000 shared cr",
    summary: "Built for shipping teams running parallel agents across repositories.",
    group: "team",
    recommended: true,
    features: [
      "100,000 shared Rayu Cloud credits / month",
      "25,000 cr / member weekly pacing",
      "Unlimited seats + Hosted API & Telegram",
    ],
  },
  {
    id: "team-max",
    name: "Team Max",
    price: "$79",
    cadence: "/ mo",
    credits: "400,000 shared cr",
    summary: "High-throughput shared pool for multi-team Swarm & CI automation.",
    group: "team",
    features: [
      "400,000 shared Rayu Cloud credits / month",
      "100,000 cr / member weekly pacing",
      "Dedicated org controls & priority routing",
    ],
  },
]

const ONBOARDING_PERMISSIONS: ReadonlyArray<{
  id: PermissionModeId
  label: string
  detail: string
}> = [
  {
    id: "default",
    label: "Ask before changes",
    detail: "Prompt before editing files or running shell commands.",
  },
  {
    id: "acceptEdits",
    label: "Auto-edit",
    detail: "Apply code edits automatically; still ask for terminal commands.",
  },
  {
    id: "plan",
    label: "Plan first",
    detail: "Research and draft an implementation plan without modifying files.",
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    detail: "Coordinate parallel workers across isolated git worktrees.",
  },
]

export function AuthWelcomeScreen() {
  const authState = useAppStore((s) => s.authState)
  const setAuthState = useAppStore((s) => s.setAuthState)
  const setAuthBypassed = useAppStore((s) => s.setAuthBypassed)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const accent = useAppStore((s) => s.accent)
  const setAccent = useAppStore((s) => s.setAccent)
  const activeWorkspacePath = useAppStore((s) => s.activeWorkspacePath)
  const setActiveWorkspacePath = useAppStore((s) => s.setActiveWorkspacePath)

  const [step, setStep] = React.useState<AuthScreenStep>("welcome")
  const [planGroup, setPlanGroup] = React.useState<"personal" | "team">("personal")
  const [selectedPlanId, setSelectedPlanId] = React.useState<string>("plus")
  const [selectedPermission, setSelectedPermission] =
    React.useState<PermissionModeId>("default")
  const [manualMode, setManualMode] = React.useState<"apikey" | "callback">(
    "apikey"
  )
  const [manualInput, setManualInput] = React.useState("")
  const [showSecret, setShowSecret] = React.useState(false)
  const [copiedLink, setCopiedLink] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const webBase = authState?.webBase ?? "https://rayucode.com"
  const isWaitingForBrowser = Boolean(
    authState?.signingIn || (submitting && step !== "manual-key")
  )
  const selectedPlan =
    ONBOARDING_PLANS.find((p) => p.id === selectedPlanId) ?? ONBOARDING_PLANS[2]
  const visiblePlans = ONBOARDING_PLANS.filter((p) => p.group === planGroup)

  const handleBrowserLogin = React.useCallback(async () => {
    setErrorMessage(null)
    setSubmitting(true)
    try {
      const next = await ipcClient.auth.signInWithBrowser()
      setAuthState(next)
      setAuthBypassed(false)
      toast.success(
        next.user?.displayName || next.user?.email
          ? `Welcome back, ${next.user.displayName || next.user.email}`
          : "Signed in to Rayu Cloud"
      )
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Rayu Cloud sign-in failed"
      setErrorMessage(msg)
    } finally {
      setSubmitting(false)
    }
  }, [setAuthBypassed, setAuthState])

  const handleCancelLogin = async () => {
    try {
      const next = await ipcClient.auth.cancelSignIn()
      setAuthState(next)
    } finally {
      setSubmitting(false)
      setErrorMessage(null)
    }
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = manualInput.trim()
    if (!trimmed) {
      setErrorMessage(
        manualMode === "apikey"
          ? "Enter a Rayu API key starting with rayu_sk_live_."
          : "Paste the callback URL containing code= and state= from your browser."
      )
      return
    }
    setErrorMessage(null)
    setSubmitting(true)
    try {
      const isApiKey =
        trimmed.startsWith("rayu_sk_live_") ||
        (manualMode === "apikey" && !trimmed.includes("code="))
      const next = isApiKey
        ? await ipcClient.auth.signInWithApiKey(trimmed)
        : await ipcClient.auth.completeCallback(trimmed)
      setAuthState(next)
      setAuthBypassed(false)
      setManualInput("")
      toast.success(
        isApiKey
          ? "Rayu Cloud API key connected"
          : "Signed in to Rayu Cloud"
      )
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not complete Rayu Cloud sign-in"
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        const cleaned = text.trim()
        setManualInput(cleaned)
        if (cleaned.startsWith("rayu_sk_live_")) setManualMode("apikey")
        else if (cleaned.includes("code=")) setManualMode("callback")
        setErrorMessage(null)
      }
    } catch {
      toast("Unable to read clipboard")
    }
  }

  const handleCompleteOnboardingToWebSignup = async () => {
    setErrorMessage(null)
    await ipcClient.settings
      .updatePreferences({ defaultPermissionMode: selectedPermission })
      .catch(() => {})

    const signupUrl =
      selectedPlan.id === "free"
        ? `${webBase}/sign-up`
        : `${webBase}/sign-up?plan=${encodeURIComponent(selectedPlan.id)}`
    await ipcClient.native.openExternal(signupUrl)
    setStep("connect-account")
  }

  const handlePickWorkspace = async () => {
    try {
      const picked = await ipcClient.workspace.pickFolder()
      if (picked?.path) {
        setActiveWorkspacePath(picked.path)
        toast.success(`Workspace set to ${picked.project}`)
      }
    } catch {
      toast.error("Unable to open folder picker")
    }
  }

  const handleCopyAuthUrl = async () => {
    const url = authState?.pendingAuthUrl
    if (!url) {
      toast("Generating sign-in link, please try again in a moment")
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopiedLink(true)
      toast.success("Sign-in link copied — paste it into any browser")
      window.setTimeout(() => setCopiedLink(false), 2400)
    } catch {
      toast("Unable to copy sign-in link")
    }
  }

  return (
    <div
      data-testid="auth-welcome-screen"
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink select-none"
    >
      {/* Subtle Antigravity-inspired bottom ambient glow */}
      <div
        aria-hidden="true"
        className="rayu-auth-ambient-glow pointer-events-none absolute inset-0"
      />

      {/* macOS hiddenInset top drag bar safe area */}
      <div className="relative z-10 flex h-[44px] shrink-0 items-center justify-between px-5">
        <div>
          {step !== "welcome" && (
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null)
                if (step === "onboarding") setStep("choose-plan")
                else if (step === "connect-account") setStep("onboarding")
                else setStep("welcome")
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span>Back</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="grid size-8 cursor-pointer place-items-center rounded-full border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
          >
            {theme === "dark" ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Main Centered Stage */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
        {/* ==================== STEP 1: WELCOME (DEVIN + ANTIGRAVITY MOTION) ==================== */}
        {step === "welcome" && (
          <div className="flex w-full max-w-[360px] flex-col items-center text-center">
            {/* Motion Stage 1: Logo appears first */}
            <div className="rayu-auth-logo-enter mb-5 flex flex-col items-center">
              <img
                src="./rayu-fox.png"
                alt="RayuCode"
                className="h-[68px] w-auto object-contain drop-shadow-sm"
              />
            </div>

            {/* Motion Stage 2: Heading + Subtitle */}
            <div className="rayu-auth-text-enter mb-6 space-y-1.5">
              <h1 className="m-0 text-[22px] font-medium tracking-[-0.025em] text-ink">
                Welcome to RayuCode
              </h1>
              <p className="m-0 text-[13.5px] text-muted-ink">
                Sign in or create an account
              </p>
            </div>

            {/* Motion Stage 3: Buttons & Secondary Actions */}
            <div className="rayu-auth-actions-enter flex w-full flex-col gap-2.5">
              {isWaitingForBrowser ? (
                <div
                  data-testid="auth-waiting-card"
                  className="flex flex-col items-center gap-3.5 rounded-2xl border border-premium bg-pane p-5 text-center shadow-bevel-card"
                >
                  <button
                    type="button"
                    disabled
                    className="flex h-[40px] w-full items-center justify-center gap-2 rounded-full border border-brand bg-brand-soft px-4 text-[13px] font-medium text-brand-text opacity-90"
                  >
                    <Loader2
                      className="size-3.5 shrink-0 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Continue with RayuCode</span>
                  </button>

                  <div className="flex flex-col items-center gap-2.5 pt-0.5 text-xs">
                    <button
                      type="button"
                      data-testid="copy-signin-link-btn"
                      onClick={() => void handleCopyAuthUrl()}
                      className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-brand-text"
                    >
                      {copiedLink ? (
                        <>
                          <Check
                            className="size-3.5 text-brand-text"
                            aria-hidden="true"
                          />
                          <span className="text-brand-text">
                            Copied sign-in link
                          </span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" aria-hidden="true" />
                          <span>Copy sign-in link</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      data-testid="waiting-manual-auth-btn"
                      onClick={() => {
                        setErrorMessage(null)
                        setManualMode("callback")
                        setStep("manual-key")
                      }}
                      className="cursor-pointer text-muted-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-ink"
                    >
                      Trouble signing in? Paste callback URL or API key
                    </button>

                    <button
                      type="button"
                      data-testid="waiting-back-btn"
                      onClick={() => void handleCancelLogin()}
                      className="cursor-pointer pt-0.5 text-muted-ink transition-colors hover:text-ink"
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Primary Button: Sign up -> Choose plan & onboarding */}
                  <button
                    type="button"
                    data-testid="welcome-signup-btn"
                    onClick={() => {
                      setErrorMessage(null)
                      setStep("choose-plan")
                    }}
                    className="rayu-primary-bevel flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-[13.5px] font-semibold text-brand-ink transition-colors hover:bg-brand-bright"
                  >
                    <span>Sign up</span>
                    <CornerDownLeft className="size-3.5 opacity-80" aria-hidden="true" />
                  </button>

                  {/* Secondary Button: Log in -> Opens RayuCode Web OAuth loopback */}
                  <button
                    type="button"
                    data-testid="welcome-login-btn"
                    onClick={() => void handleBrowserLogin()}
                    className="rayu-surface-bevel flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-raised px-4 text-[13.5px] font-medium text-ink transition-colors hover:bg-active"
                  >
                    <span>Log in</span>
                  </button>
                </>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="mt-1 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-left text-xs text-danger"
                >
                  {errorMessage}
                </div>
              )}

              <div className="mt-3 flex flex-col items-center gap-2 text-xs">
                <button
                  type="button"
                  data-testid="welcome-manual-key-btn"
                  onClick={() => {
                    setErrorMessage(null)
                    setManualMode("apikey")
                    setStep("manual-key")
                  }}
                  className="cursor-pointer text-body underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-ink"
                >
                  Having trouble? Enter your Rayu API key manually
                </button>
                <button
                  type="button"
                  data-testid="welcome-open-offline-btn"
                  onClick={() => setAuthBypassed(true)}
                  className="cursor-pointer text-muted-ink transition-colors hover:text-ink"
                >
                  Open workspace
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== MANUAL CALLBACK URL OR API KEY ENTRY ==================== */}
        {step === "manual-key" && (
          <div
            data-testid="manual-auth-panel"
            className="flex w-full max-w-[448px] flex-col items-center"
          >
            {/* Brand Header matching Welcome cadence */}
            <div className="rayu-auth-logo-enter mb-5 flex flex-col items-center text-center">
              <img
                src="./rayu-fox.png"
                alt="RayuCode"
                className="mb-4 h-[52px] w-auto object-contain"
              />
              <h1 className="m-0 text-[20px] font-medium tracking-[-0.025em] text-ink">
                Connect manually
              </h1>
              <p className="mt-1 text-[13px] text-muted-ink">
                Authenticate with a Rayu API key or browser OAuth callback link.
              </p>
            </div>

            {/* Premium Beveled Card */}
            <div className="rayu-card-bevel w-full rounded-2xl bg-pane p-5">
              {/* Segmented Mode Switcher */}
              <div
                role="tablist"
                aria-label="Manual sign-in method"
                className="mb-4 grid grid-cols-2 gap-1 rounded-[11px] border border-hairline bg-inset p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={manualMode === "apikey"}
                  onClick={() => {
                    setManualMode("apikey")
                    setErrorMessage(null)
                  }}
                  className={cn(
                    "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] text-xs font-medium transition-all",
                    manualMode === "apikey"
                      ? "rayu-surface-bevel bg-raised text-ink"
                      : "text-muted-ink hover:text-ink"
                  )}
                >
                  <KeyRound className="size-3.5" aria-hidden="true" />
                  <span>Rayu API Key</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={manualMode === "callback"}
                  onClick={() => {
                    setManualMode("callback")
                    setErrorMessage(null)
                  }}
                  className={cn(
                    "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] text-xs font-medium transition-all",
                    manualMode === "callback"
                      ? "rayu-surface-bevel bg-raised text-ink"
                      : "text-muted-ink hover:text-ink"
                  )}
                >
                  <Link2 className="size-3.5" aria-hidden="true" />
                  <span>Callback URL</span>
                </button>
              </div>

              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="manual-auth-input"
                      className="text-xs font-medium text-body"
                    >
                      {manualMode === "apikey"
                        ? "Secret key"
                        : "Browser callback URL"}
                    </label>
                    {manualInput.trim().startsWith("rayu_sk_live_") && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                        <Check className="size-2.5" aria-hidden="true" />
                        Valid prefix
                      </span>
                    )}
                    {manualMode === "callback" &&
                      manualInput.includes("code=") &&
                      manualInput.includes("state=") && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                          <Check className="size-2.5" aria-hidden="true" />
                          Code detected
                        </span>
                      )}
                  </div>

                  <div className="relative flex items-center">
                    <input
                      id="manual-auth-input"
                      type={
                        manualMode === "apikey" && !showSecret
                          ? "password"
                          : "text"
                      }
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={
                        manualMode === "apikey"
                          ? "rayu_sk_live_••••••••••••••••"
                          : "http://127.0.0.1:54321/callback?code=...&state=..."
                      }
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      className="h-11 w-full rounded-[11px] border border-hairline-strong bg-inset pr-24 pl-3.5 font-mono text-[12.5px] text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                    />
                    <div className="absolute right-2 flex items-center gap-1">
                      {manualMode === "apikey" && (
                        <button
                          type="button"
                          aria-label={
                            showSecret ? "Hide API key" : "Show API key"
                          }
                          onClick={() => setShowSecret((v) => !v)}
                          className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                        >
                          {showSecret ? (
                            <EyeOff className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Eye className="size-3.5" aria-hidden="true" />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handlePasteFromClipboard()}
                        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-hairline bg-raised px-2 text-[11px] font-medium text-body transition-colors hover:border-hairline-strong hover:text-ink"
                      >
                        <ClipboardPaste className="size-3" aria-hidden="true" />
                        <span>Paste</span>
                      </button>
                    </div>
                  </div>
                </div>

                {errorMessage && (
                  <div
                    role="alert"
                    className="rounded-[10px] border border-danger bg-danger-soft px-3.5 py-2.5 text-xs text-danger"
                  >
                    {errorMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="rayu-primary-bevel flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-[13.5px] font-semibold text-brand-ink transition-colors hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="size-4" aria-hidden="true" />
                  )}
                  <span>Verify &amp; Connect</span>
                  {!submitting && (
                    <ArrowRight className="size-3.5 opacity-80" aria-hidden="true" />
                  )}
                </button>
              </form>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline-soft pt-3.5 text-[11.5px] text-muted-ink">
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="size-3 text-brand-text" aria-hidden="true" />
                  <span>Saved locally (0600) · Synced with CLI</span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void ipcClient.native.openExternal(
                      `${webBase}/dashboard/api-keys`
                    )
                  }
                  className="inline-flex cursor-pointer items-center gap-1 font-medium text-brand-text hover:underline"
                >
                  <span>Get API key</span>
                  <ExternalLink className="size-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== SIGN UP STEP 1: CHOOSE YOUR PLAN ==================== */}
        {step === "choose-plan" && (
          <div
            data-testid="signup-choose-plan"
            className="w-full max-w-[820px] space-y-6"
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-pane px-2.5 py-0.5 text-[11px] font-medium text-muted-ink">
                <span>Step 1 of 3</span>
                <span>·</span>
                <span>Choose your plan</span>
              </div>
              <h1 className="m-0 text-2xl font-medium tracking-[-0.025em] text-ink">
                Pick how you want to build with RayuCode
              </h1>
              <p className="mt-1.5 text-[13.5px] text-muted-ink">
                One account works across Desktop, CLI, VS Code, Swarm, and Telegram.
              </p>

              {/* Personal / Team toggle */}
              <div className="mt-4 inline-flex items-center rounded-full border border-hairline bg-pane p-1">
                {(["personal", "team"] as const).map((group) => (
                  <button
                    key={group}
                    type="button"
                    onClick={() => {
                      setPlanGroup(group)
                      setSelectedPlanId(group === "personal" ? "plus" : "team-plus")
                    }}
                    className={cn(
                      "cursor-pointer rounded-full px-4 py-1 text-xs font-medium capitalize transition-colors",
                      planGroup === group
                        ? "bg-active text-ink shadow-bevel-surface"
                        : "text-muted-ink hover:text-ink"
                    )}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={cn(
                "grid gap-3",
                planGroup === "personal"
                  ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
                  : "grid-cols-1 sm:grid-cols-3"
              )}
            >
              {visiblePlans.map((plan) => {
                const isSelected = selectedPlanId === plan.id
                return (
                  <button
                    key={plan.id}
                    type="button"
                    data-testid={`plan-card-${plan.id}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={cn(
                      "flex cursor-pointer flex-col rounded-2xl border p-4 text-left transition-all",
                      isSelected
                        ? "border-brand bg-brand-softer shadow-bevel-card"
                        : "border-hairline bg-pane hover:border-hairline-strong hover:bg-raised"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {plan.name}
                      </span>
                      {plan.recommended && (
                        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                          Recommended
                        </span>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-baseline gap-1">
                      <span className="text-2xl font-semibold tracking-tight text-ink tabular-nums">
                        {plan.price}
                      </span>
                      <span className="text-xs text-muted-ink">
                        {plan.cadence}
                      </span>
                    </div>

                    <div className="mt-1 font-mono text-[11px] text-brand-text">
                      {plan.credits}
                    </div>

                    <p className="mt-2.5 text-xs leading-relaxed text-muted-ink">
                      {plan.summary}
                    </p>

                    <ul className="mt-3.5 space-y-1.5 border-t border-hairline-soft pt-3">
                      {plan.features.map((feat) => (
                        <li
                          key={feat}
                          className="flex items-start gap-1.5 text-[11.5px] text-body"
                        >
                          <Check
                            className="mt-0.5 size-3 shrink-0 text-brand-text"
                            aria-hidden="true"
                          />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline-soft pt-4">
              <button
                type="button"
                onClick={() =>
                  void ipcClient.native.openExternal(`${webBase}/plans`)
                }
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-ink hover:text-ink"
              >
                <span>Compare all 9 plans on rayucode.com/plans</span>
                <ExternalLink className="size-3" aria-hidden="true" />
              </button>

              <button
                type="button"
                data-testid="plan-continue-btn"
                onClick={() => setStep("onboarding")}
                className="rayu-primary-bevel inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-5 text-[13px] font-semibold text-brand-ink transition-colors hover:bg-brand-bright"
              >
                <span>Continue with {selectedPlan.name}</span>
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* ==================== SIGN UP STEP 2: PERSONALIZE ONBOARDING ==================== */}
        {step === "onboarding" && (
          <div
            data-testid="signup-onboarding"
            className="w-full max-w-[560px] space-y-5 rounded-2xl border border-premium bg-pane p-6 shadow-bevel-card"
          >
            <div>
              <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-inset px-2.5 py-0.5 text-[11px] font-medium text-muted-ink">
                <span>Step 2 of 3</span>
                <span>·</span>
                <span>Workspace onboarding</span>
              </div>
              <h2 className="m-0 text-xl font-medium tracking-[-0.02em] text-ink">
                Set up your workspace
              </h2>
              <p className="mt-1 text-xs text-muted-ink">
                You can change any of these later in Settings.
              </p>
            </div>

            {/* Theme & Accent */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-ink">
                Theme &amp; Accent
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    { id: "dark", label: "Warm Graphite Dark" },
                    { id: "light", label: "Warm Paper Light" },
                  ] as Array<{ id: ThemeMode; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors",
                      theme === opt.id
                        ? "border-brand bg-brand-softer text-ink"
                        : "border-hairline bg-inset text-body hover:border-hairline-strong"
                    )}
                  >
                    <span>{opt.label}</span>
                    {theme === opt.id && (
                      <Check className="size-3.5 text-brand-text" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    { id: "green", label: "Rayu Green" },
                    { id: "blue", label: "Ocean Blue" },
                  ] as Array<{ id: AccentColor; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAccent(opt.id)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                      accent === opt.id
                        ? "border-brand bg-brand-softer text-ink"
                        : "border-hairline bg-inset text-body hover:border-hairline-strong"
                    )}
                  >
                    <span>{opt.label}</span>
                    {accent === opt.id && (
                      <Check className="size-3.5 text-brand-text" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Permission Mode */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-ink">
                Default Agent Autonomy
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ONBOARDING_PERMISSIONS.map((perm) => (
                  <button
                    key={perm.id}
                    type="button"
                    onClick={() => setSelectedPermission(perm.id)}
                    className={cn(
                      "cursor-pointer rounded-xl border p-3 text-left transition-colors",
                      selectedPermission === perm.id
                        ? "border-brand bg-brand-softer"
                        : "border-hairline bg-inset hover:border-hairline-strong"
                    )}
                  >
                    <div className="text-xs font-medium text-ink">
                      {perm.label}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted-ink">
                      {perm.detail}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Primary Project Folder */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-inset px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-xs font-medium text-ink">
                  Default repository folder
                </div>
                <div className="truncate font-mono text-[11px] text-muted-ink">
                  {activeWorkspacePath ?? "Choose a local project folder"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void handlePickWorkspace()}
              >
                <FolderOpen className="size-3.5" aria-hidden="true" />
                Choose
              </Button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="text-xs text-muted-ink">
                Selected:{" "}
                <span className="font-medium text-ink">
                  {selectedPlan.name} ({selectedPlan.price}
                  {selectedPlan.id === "free" ? "" : selectedPlan.cadence})
                </span>
              </div>
              <button
                type="button"
                data-testid="onboarding-create-account-btn"
                onClick={() => void handleCompleteOnboardingToWebSignup()}
                className="rayu-primary-bevel inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-5 text-[13px] font-semibold text-brand-ink transition-colors hover:bg-brand-bright"
              >
                <Sparkles className="size-4" aria-hidden="true" />
                <span>Create account on RayuCode</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================== SIGN UP STEP 3: FINISH CONNECTING DESKTOP ==================== */}
        {step === "connect-account" && (
          <div
            data-testid="signup-connect-account"
            className="w-full max-w-[440px] space-y-4 rounded-2xl border border-premium bg-pane p-6 text-center shadow-bevel-card"
          >
            <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand-text">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-ink">
                Step 3 of 3 · Connect RayuCode Desktop
              </div>
              <h2 className="m-0 text-lg font-medium text-ink">
                Complete sign-up in your browser
              </h2>
              <p className="m-0 text-xs leading-relaxed text-muted-ink">
                We opened <span className="font-mono text-ink">{webBase}/sign-up</span>{" "}
                for your <span className="font-medium text-ink">{selectedPlan.name}</span>{" "}
                setup. Once your account is created, click below to authorize
                RayuCode Desktop in one click.
              </p>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-left text-xs text-danger"
              >
                {errorMessage}
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                data-testid="connect-authorize-desktop-btn"
                disabled={isWaitingForBrowser}
                onClick={() => void handleBrowserLogin()}
                className="rayu-primary-bevel flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-[13px] font-semibold text-brand-ink transition-colors hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isWaitingForBrowser ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Waiting for browser authorization...</span>
                  </>
                ) : (
                  <>
                    <span>Authorize RayuCode Desktop</span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </>
                )}
              </button>

              {isWaitingForBrowser && (
                <div className="flex flex-col items-center gap-2 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => void handleCopyAuthUrl()}
                    className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-brand-text"
                  >
                    {copiedLink ? (
                      <>
                        <Check
                          className="size-3.5 text-brand-text"
                          aria-hidden="true"
                        />
                        <span className="text-brand-text">
                          Copied sign-in link
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" aria-hidden="true" />
                        <span>Copy sign-in link</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCancelLogin()}
                    className="cursor-pointer text-muted-ink transition-colors hover:text-ink"
                  >
                    Back
                  </button>
                </div>
              )}

              <div className="flex items-center justify-center gap-4 pt-1 text-xs text-muted-ink">
                <button
                  type="button"
                  onClick={() =>
                    void ipcClient.native.openExternal(`${webBase}/sign-up`)
                  }
                  className="cursor-pointer underline underline-offset-4 hover:text-ink"
                >
                  Re-open sign-up page
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void ipcClient.native.openExternal(`${webBase}/dashboard/plan`)
                  }
                  className="cursor-pointer underline underline-offset-4 hover:text-ink"
                >
                  Manage plan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Footer Attribution (matching Devin's clean bottom footer) */}
      <footer className="rayu-auth-footer-enter relative z-10 flex h-12 shrink-0 items-center justify-center gap-2 text-xs text-muted-ink">
        <span>made by</span>
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <img
            src="./rayu-fox.png"
            alt=""
            aria-hidden="true"
            className="h-4 w-auto object-contain"
          />
          <span>Rayu</span>
        </span>
      </footer>
    </div>
  )
}
