import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import type { DoctorCheckView } from "@shared/vscodeProtocol";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RayuProcessingMark } from "@/components/ui/rayu-processing-mark";
import { RunStatusPulse } from "@/components/ui/rayu-symbols";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/app-store";
import { mediaUrl } from "@/lib/media-url";
import { callRpc, postToHost } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

export interface AuthWelcomeScreenProps {
  onContinue?: () => void;
  className?: string;
}

export function AuthWelcomeScreen({
  onContinue,
  className,
}: AuthWelcomeScreenProps) {
  const queryClient = useQueryClient();
  const daemonStatus = useAppStore((s) => s.daemonStatus);
  const accountStatus = useAppStore((s) => s.accountStatus);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setDaemonStatus = useAppStore((s) => s.setDaemonStatus);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setAuthLoaded = useAppStore((s) => s.setAuthLoaded);
  const setAuthBypassed = useAppStore((s) => s.setAuthBypassed);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);

  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualTab, setManualTab] = React.useState<"apikey" | "callback">(
    "apikey",
  );
  const [apiKeyInput, setApiKeyInput] = React.useState("");
  const [callbackInput, setCallbackInput] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);
  const [waitingLocal, setWaitingLocal] = React.useState(false);
  const [localAuthUrl, setLocalAuthUrl] = React.useState<string | null>(null);
  const [localPendingMode, setLocalPendingMode] = React.useState<
    "vscode" | "loopback" | null
  >(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [restartingDaemon, setRestartingDaemon] = React.useState(false);
  const [updatingEngine, setUpdatingEngine] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [doctorOpen, setDoctorOpen] = React.useState(false);
  const [doctorLoading, setDoctorLoading] = React.useState(false);
  const [doctorChecks, setDoctorChecks] = React.useState<DoctorCheckView[]>([]);

  const webBase = accountStatus?.webBase ?? "https://rayucode.com";
  const pendingAuthUrl = accountStatus?.pendingAuthUrl ?? localAuthUrl;
  const pendingMode = accountStatus?.pendingMode ?? localPendingMode;
  const isWaitingForBrowser = Boolean(
    !accountStatus?.signedIn &&
      (accountStatus?.signingIn || pendingAuthUrl || waitingLocal),
  );
  const isDaemonDownloading = daemonStatus.state === "downloading";
  const isDaemonOffline =
    daemonStatus.state === "disconnected" || daemonStatus.state === "error";

  const invalidateAuthQueries = React.useCallback(
    (next?: typeof accountStatus) => {
      if (next) {
        queryClient.setQueryData(["settings", "account"], next);
        queryClient.setQueryData(["shell", "account", "status"], next);
      }
      void queryClient.invalidateQueries({ queryKey: ["settings", "account"] });
      void queryClient.invalidateQueries({
        queryKey: ["shell", "account", "status"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["settings", "providers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    [queryClient],
  );

  // Sync clear of local waiting state once signed in asynchronously via URI/loopback.
  React.useEffect(() => {
    if (accountStatus?.signedIn) {
      setWaitingLocal(false);
      setLocalAuthUrl(null);
      setLocalPendingMode(null);
      setErrorMsg(null);
    }
  }, [accountStatus?.signedIn]);

  const handleBrowserSignIn = async (mode: "vscode" | "loopback" = "vscode") => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await callRpc("settings.account.signInBrowser", { mode });
      const nextState = res.state;
      const nextUrl = res.authUrl ?? nextState?.pendingAuthUrl ?? null;

      if (nextState) {
        setAccountStatus(nextState);
        setAuthLoaded(true);
        invalidateAuthQueries(nextState);
      }

      if (nextState?.signedIn) {
        setWaitingLocal(false);
        setLocalAuthUrl(null);
        setLocalPendingMode(null);
        setAuthBypassed(false);
        setAuthDialogOpen(false);
        toast.success(
          nextState.displayName || nextState.email
            ? `Welcome back, ${nextState.displayName || nextState.email}`
            : "Signed in to Rayu Cloud",
        );
        onContinue?.();
        return;
      }

      setWaitingLocal(true);
      setLocalAuthUrl(nextUrl);
      setLocalPendingMode(nextState?.pendingMode ?? mode);
      if (mode === "loopback") {
        toast("Opened localhost callback sign-in in your browser");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to start browser sign-in",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSignIn = async () => {
    setErrorMsg(null);
    try {
      const next = await callRpc("settings.account.cancelSignIn");
      setAccountStatus(next);
      invalidateAuthQueries(next);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to cancel sign-in",
      );
    } finally {
      setWaitingLocal(false);
      setLocalAuthUrl(null);
      setLocalPendingMode(null);
      setSubmitting(false);
    }
  };

  const handleCopyAuthUrl = () => {
    if (!pendingAuthUrl) {
      toast("Sign-in link is not ready yet");
      return;
    }
    postToHost({ type: "rayucode.editor.copy", text: pendingAuthUrl });
    setCopiedLink(true);
    toast.success("Sign-in link copied");
    window.setTimeout(() => setCopiedLink(false), 2400);
  };

  const handleOpenSignUp = () => {
    postToHost({
      type: "rayucode.editor.openExternal",
      url: `${webBase}/sign-up`,
    });
  };

  const handleOpenApiKeysPage = () => {
    postToHost({
      type: "rayucode.editor.openExternal",
      url: `${webBase}/dashboard/api-keys`,
    });
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        toast("Clipboard read is unavailable in this environment");
        return;
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      if (text.startsWith("rayu_sk_live_")) {
        setManualTab("apikey");
        setApiKeyInput(text);
      } else if (text.includes("code=")) {
        setManualTab("callback");
        setCallbackInput(text);
      } else if (manualTab === "apikey") {
        setApiKeyInput(text);
      } else {
        setCallbackInput(text);
      }
      setErrorMsg(null);
    } catch {
      toast("Unable to read clipboard — paste directly into the field");
    }
  };

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setErrorMsg("Enter a Rayu API key starting with rayu_sk_live_.");
      return;
    }
    if (!trimmed.startsWith("rayu_sk_live_")) {
      setErrorMsg("Invalid Rayu API key — keys must start with rayu_sk_live_.");
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const next = await callRpc("settings.account.signInApiKey", {
        apiKey: trimmed,
      });
      setAccountStatus(next);
      setAuthLoaded(true);
      setAuthBypassed(false);
      setAuthDialogOpen(false);
      setApiKeyInput("");
      setWaitingLocal(false);
      setLocalAuthUrl(null);
      invalidateAuthQueries(next);
      toast.success("Rayu Cloud API key connected");
      onContinue?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Unable to verify Rayu API key. Check the key and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = callbackInput.trim();
    if (!trimmed) {
      setErrorMsg(
        "Paste the callback URL containing code= and state= from your browser.",
      );
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const next = await callRpc("settings.account.completeCallback", {
        callbackUrl: trimmed,
      });
      setAccountStatus(next);
      setAuthLoaded(true);
      setAuthBypassed(false);
      setAuthDialogOpen(false);
      setCallbackInput("");
      setWaitingLocal(false);
      setLocalAuthUrl(null);
      invalidateAuthQueries(next);
      toast.success("Signed in to Rayu Cloud");
      onContinue?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Could not complete OAuth callback sign-in",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestartDaemon = async () => {
    setErrorMsg(null);
    setRestartingDaemon(true);
    try {
      const next = await callRpc("daemon.restart");
      setDaemonStatus(next);
      if (next.state === "connected") {
        toast.success("Rayu Engine reconnected");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to restart Rayu engine",
      );
    } finally {
      setRestartingDaemon(false);
    }
  };

  const handleUpdateEngine = async () => {
    setErrorMsg(null);
    setUpdatingEngine(true);
    try {
      const next = await callRpc("daemon.updateEngine");
      setDaemonStatus(next);
      if (next.state === "connected") {
        toast.success(next.statusMessage ?? "Rayu Engine installed and ready");
      } else if (next.error) {
        setErrorMsg(next.error);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to install Rayu engine",
      );
    } finally {
      setUpdatingEngine(false);
    }
  };

  const handleRunDoctor = async () => {
    setErrorMsg(null);
    setDoctorOpen(true);
    setDoctorLoading(true);
    try {
      const [prov, auth] = await Promise.all([
        callRpc("settings.doctor.run", { scope: "providers" }),
        callRpc("settings.doctor.run", { scope: "auth" }),
      ]);
      setDoctorChecks([...prov.checks, ...auth.checks]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to run Doctor diagnostics",
      );
    } finally {
      setDoctorLoading(false);
    }
  };

  const handleOpenWorkspace = () => {
    setAuthBypassed(true);
    setAuthDialogOpen(false);
    onContinue?.();
  };

  const trimmedApiKey = apiKeyInput.trim();
  const hasValidKeyPrefix = trimmedApiKey.startsWith("rayu_sk_live_");
  const hasCallbackParams =
    callbackInput.includes("code=") && callbackInput.includes("state=");

  return (
    <div
      data-testid="auth-welcome-screen"
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-canvas text-ink select-none",
        className,
      )}
    >
      {/* Subtle bottom ambient glow matching Desktop */}
      <div
        aria-hidden="true"
        className="rayu-auth-ambient-glow pointer-events-none absolute inset-0"
      />

      {/* Minimal top utility strip */}
      <div className="relative z-10 flex h-11 shrink-0 items-center justify-between px-4">
        <div className="min-w-0" />
        <button
          type="button"
          aria-label="Toggle theme"
          data-testid="auth-theme-toggle"
          onClick={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
          className="grid size-8 cursor-pointer place-items-center rounded-full border border-transparent text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink"
        >
          {resolvedTheme === "dark" ? (
            <Sun className="size-4" aria-hidden="true" />
          ) : (
            <Moon className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <ScrollArea className="relative z-10 min-h-0 flex-1">
        <div className="mx-auto flex min-h-full w-full max-w-[400px] min-w-0 flex-col items-center justify-center px-4 pt-2 pb-8">
          {/* Hero: Rayu Fox + Serif Heading + Subtitle */}
          <div className="rayu-auth-logo-enter mb-4 flex flex-col items-center">
            <img
              src={mediaUrl("rayu-fox.png")}
              alt="RayuCode"
              className="h-[64px] w-auto object-contain drop-shadow-sm"
            />
          </div>

          <div className="rayu-auth-text-enter mb-6 space-y-1.5 text-center">
            <h1 className="m-0 font-serif text-[24px] leading-tight font-medium tracking-[-0.02em] text-ink">
              Welcome to RayuCode
            </h1>
            <p className="m-0 text-[13.5px] text-muted-ink">
              Sign in or create an account
            </p>
          </div>

          {/* Primary Auth Stage */}
          <div className="rayu-auth-actions-enter flex w-full min-w-0 flex-col gap-2.5">
            {isWaitingForBrowser ? (
              <div
                data-testid="auth-waiting-card"
                className="rayu-card-bevel flex w-full min-w-0 flex-col items-center gap-3.5 rounded-2xl bg-pane p-4 text-center"
              >
                <div className="flex w-full items-center justify-center gap-2 rounded-full border border-brand bg-brand-soft px-3.5 py-2 text-[12.5px] font-medium text-brand-text">
                  <RayuProcessingMark animated className="size-4 shrink-0" />
                  <span className="truncate">Waiting for browser sign-in</span>
                </div>

                <p className="m-0 text-xs leading-relaxed text-muted-ink">
                  {pendingMode === "loopback"
                    ? "Complete sign-in in your browser — localhost callback is listening automatically."
                    : "Complete sign-in in your browser — VS Code will receive the callback automatically."}
                </p>

                <div className="flex w-full flex-col gap-2 pt-0.5 text-xs">
                  <button
                    type="button"
                    data-testid="copy-signin-link-btn"
                    onClick={handleCopyAuthUrl}
                    className="rayu-surface-bevel inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] bg-raised px-3 text-xs font-medium text-ink transition-colors hover:bg-active"
                  >
                    {copiedLink ? (
                      <>
                        <Check
                          className="size-3.5 shrink-0 text-brand-text"
                          aria-hidden="true"
                        />
                        <span className="text-brand-text">
                          Copied sign-in link
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 shrink-0" aria-hidden="true" />
                        <span>Copy sign-in link</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    data-testid="auth-loopback-fallback-btn"
                    disabled={submitting}
                    onClick={() => void handleBrowserSignIn("loopback")}
                    className="inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-hairline bg-inset px-3 text-xs font-medium text-body transition-colors hover:border-hairline-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Globe className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>Use localhost fallback</span>
                  </button>

                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 pt-1">
                    <button
                      type="button"
                      data-testid="waiting-manual-auth-btn"
                      onClick={() => {
                        setErrorMsg(null);
                        setManualTab("callback");
                        setManualOpen((prev) => !prev);
                      }}
                      className="cursor-pointer text-muted-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-ink"
                    >
                      Paste callback URL or API key
                    </button>
                    <span className="text-faint" aria-hidden="true">
                      ·
                    </span>
                    <button
                      type="button"
                      data-testid="auth-cancel-signin-btn"
                      onClick={() => void handleCancelSignIn()}
                      className="inline-flex cursor-pointer items-center gap-1 text-muted-ink transition-colors hover:text-danger"
                    >
                      <X className="size-3" aria-hidden="true" />
                      <span>Cancel</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="auth-signin-browser"
                  disabled={submitting}
                  onClick={() => void handleBrowserSignIn("vscode")}
                  className="rayu-primary-bevel flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-[13.5px] font-semibold text-brand-ink transition-colors hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  <span>Log in</span>
                  {!submitting ? (
                    <ArrowRight className="size-3.5 opacity-80" aria-hidden="true" />
                  ) : null}
                </button>

                <button
                  type="button"
                  data-testid="auth-signup-btn"
                  onClick={handleOpenSignUp}
                  className="rayu-surface-bevel flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-raised px-4 text-[13.5px] font-medium text-ink transition-colors hover:bg-active"
                >
                  <span>Sign up</span>
                  <ExternalLink
                    className="size-3.5 text-muted-ink"
                    aria-hidden="true"
                  />
                </button>

                <button
                  type="button"
                  data-testid="auth-switch-apikey"
                  aria-expanded={manualOpen}
                  onClick={() => {
                    setErrorMsg(null);
                    setManualOpen((prev) => !prev);
                  }}
                  className="mt-1 inline-flex cursor-pointer items-center justify-center gap-1 text-xs text-body transition-colors hover:text-ink"
                >
                  <span>Connect manually</span>
                  {manualOpen ? (
                    <ChevronUp className="size-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              </>
            )}

            {/* Collapsible Connect Manually Card (Rayu API Key + Callback URL) */}
            {manualOpen && (
              <div
                data-testid="manual-auth-panel"
                className="rayu-card-bevel mt-1 w-full min-w-0 rounded-2xl bg-pane p-4"
              >
                <div
                  role="tablist"
                  aria-label="Manual sign-in method"
                  className="mb-3.5 grid grid-cols-2 gap-1 rounded-[10px] border border-hairline bg-inset p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    data-testid="manual-tab-apikey"
                    aria-selected={manualTab === "apikey"}
                    onClick={() => {
                      setManualTab("apikey");
                      setErrorMsg(null);
                    }}
                    className={cn(
                      "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] px-2 text-xs font-medium transition-all",
                      manualTab === "apikey"
                        ? "rayu-surface-bevel bg-raised text-ink"
                        : "text-muted-ink hover:text-ink",
                    )}
                  >
                    <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">Rayu API Key</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    data-testid="manual-tab-callback"
                    aria-selected={manualTab === "callback"}
                    onClick={() => {
                      setManualTab("callback");
                      setErrorMsg(null);
                    }}
                    className={cn(
                      "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] px-2 text-xs font-medium transition-all",
                      manualTab === "callback"
                        ? "rayu-surface-bevel bg-raised text-ink"
                        : "text-muted-ink hover:text-ink",
                    )}
                  >
                    <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">Callback URL</span>
                  </button>
                </div>

                {manualTab === "apikey" ? (
                  <form
                    onSubmit={(e) => void handleApiKeySubmit(e)}
                    className="space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <label
                          htmlFor="rayu-api-key-input"
                          className="text-xs font-medium text-body"
                        >
                          Secret key
                        </label>
                        {hasValidKeyPrefix ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                            <Check className="size-2.5" aria-hidden="true" />
                            <span>Valid prefix</span>
                          </span>
                        ) : (
                          <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10px] text-muted-ink">
                            rayu_sk_live_
                          </span>
                        )}
                      </div>

                      <div className="relative flex items-center">
                        <input
                          id="rayu-api-key-input"
                          data-testid="manual-apikey-input"
                          type={showSecret ? "text" : "password"}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="rayu_sk_live_..."
                          value={apiKeyInput}
                          onChange={(e) => {
                            setApiKeyInput(e.target.value);
                            if (errorMsg) setErrorMsg(null);
                          }}
                          className="h-10 w-full min-w-0 rounded-[10px] border border-hairline-strong bg-inset pr-[88px] pl-3 font-mono text-xs text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                        />
                        <div className="absolute right-1.5 flex items-center gap-1">
                          <button
                            type="button"
                            data-testid="manual-toggle-secret"
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
                          <button
                            type="button"
                            data-testid="manual-paste-btn"
                            onClick={() => void handlePasteFromClipboard()}
                            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-hairline bg-raised px-2 text-[11px] font-medium text-body transition-colors hover:border-hairline-strong hover:text-ink"
                          >
                            <ClipboardPaste
                              className="size-3"
                              aria-hidden="true"
                            />
                            <span>Paste</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      data-testid="manual-submit-apikey"
                      disabled={submitting}
                      className="rayu-primary-bevel flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-xs font-semibold text-brand-ink transition-colors hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? (
                        <Loader2
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ShieldCheck className="size-3.5" aria-hidden="true" />
                      )}
                      <span>Connect with API key</span>
                    </button>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline-soft pt-3 text-[11px] text-muted-ink">
                      <span className="inline-flex items-center gap-1">
                        <Lock
                          className="size-3 shrink-0 text-brand-text"
                          aria-hidden="true"
                        />
                        <span>Saved locally (0600)</span>
                      </span>
                      <button
                        type="button"
                        data-testid="auth-get-apikey-link"
                        onClick={handleOpenApiKeysPage}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-brand-text hover:underline"
                      >
                        <span>Get API key</span>
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </button>
                    </div>
                  </form>
                ) : (
                  <form
                    onSubmit={(e) => void handleCallbackSubmit(e)}
                    className="space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <label
                          htmlFor="rayu-callback-url-input"
                          className="text-xs font-medium text-body"
                        >
                          Browser callback URL
                        </label>
                        {hasCallbackParams && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                            <Check className="size-2.5" aria-hidden="true" />
                            <span>Code detected</span>
                          </span>
                        )}
                      </div>

                      <div className="relative flex items-center">
                        <input
                          id="rayu-callback-url-input"
                          data-testid="manual-callback-input"
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="vscode://rayucode.rayucode/auth?code=...&state=..."
                          value={callbackInput}
                          onChange={(e) => {
                            setCallbackInput(e.target.value);
                            if (errorMsg) setErrorMsg(null);
                          }}
                          className="h-10 w-full min-w-0 rounded-[10px] border border-hairline-strong bg-inset pr-[68px] pl-3 font-mono text-xs text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none"
                        />
                        <button
                          type="button"
                          data-testid="manual-paste-callback-btn"
                          onClick={() => void handlePasteFromClipboard()}
                          className="absolute right-1.5 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-hairline bg-raised px-2 text-[11px] font-medium text-body transition-colors hover:border-hairline-strong hover:text-ink"
                        >
                          <ClipboardPaste
                            className="size-3"
                            aria-hidden="true"
                          />
                          <span>Paste</span>
                        </button>
                      </div>
                      <p className="m-0 text-[11px] text-muted-ink">
                        Accepts both vscode://rayucode.rayucode/auth and
                        http://127.0.0.1 callback URLs.
                      </p>
                    </div>

                    <button
                      type="submit"
                      data-testid="manual-submit-callback"
                      disabled={submitting}
                      className="rayu-primary-bevel flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-xs font-semibold text-brand-ink transition-colors hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? (
                        <Loader2
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ShieldCheck className="size-3.5" aria-hidden="true" />
                      )}
                      <span>Complete sign-in</span>
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Inline Error Alert */}
            {errorMsg && (
              <div
                role="alert"
                data-testid="auth-error-message"
                className="rounded-[10px] border border-danger bg-danger-soft px-3 py-2 text-left text-xs text-danger"
              >
                {errorMsg}
              </div>
            )}

            {/* Footer: Open workspace bypass */}
            <div className="rayu-auth-footer-enter mt-3 flex flex-col items-center gap-2 text-xs">
              <button
                type="button"
                data-testid="auth-continue-byok"
                onClick={handleOpenWorkspace}
                className="cursor-pointer text-muted-ink transition-colors hover:text-ink"
              >
                Open workspace
              </button>
            </div>

            {/* Downloading Engine Strip */}
            {isDaemonDownloading && (
              <div
                data-testid="auth-daemon-downloading-strip"
                className="mt-4 flex w-full min-w-0 flex-col gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-warn">
                  <div className="flex min-w-0 items-center gap-2">
                    <RunStatusPulse status="warn" />
                    <span className="truncate font-medium">
                      Installing Rayu engine — please wait
                    </span>
                  </div>
                  {daemonStatus.downloadProgress !== undefined && (
                    <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums">
                      {daemonStatus.downloadProgress}%
                    </span>
                  )}
                </div>
                <div
                  data-testid="auth-daemon-progress-bar"
                  className="h-1.5 w-full overflow-hidden rounded-full bg-inset"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={daemonStatus.downloadProgress ?? 0}
                >
                  <div
                    className={cn(
                      "h-full rounded-full bg-brand transition-[width] duration-200",
                      daemonStatus.downloadProgress === undefined &&
                        "animate-pulse",
                    )}
                    style={{
                      width: `${Math.max(6, Math.min(100, daemonStatus.downloadProgress ?? 20))}%`,
                    }}
                  />
                </div>
                <p className="m-0 truncate text-[11px] text-muted-ink">
                  {daemonStatus.statusMessage ??
                    `Downloading Rayu engine${daemonStatus.downloadVersion ? ` ${daemonStatus.downloadVersion}` : ""} — please wait...`}{" "}
                  RayuCode will connect automatically once setup finishes.
                </p>
              </div>
            )}

            {/* Subtle compact Engine Offline Strip (ONLY when daemon is disconnected or error) */}
            {isDaemonOffline && (
              <div
                data-testid="auth-daemon-offline-strip"
                className="mt-4 w-full min-w-0 rounded-xl border border-hairline bg-pane p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RunStatusPulse status="danger" />
                    <span className="truncate text-xs font-medium text-ink">
                      Engine offline
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={doctorLoading}
                      onClick={() => void handleRunDoctor()}
                      data-testid="auth-run-doctor"
                    >
                      <Activity className="size-3" aria-hidden="true" />
                      <span>Run Doctor</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={updatingEngine || restartingDaemon}
                      onClick={() => void handleUpdateEngine()}
                      data-testid="auth-install-engine"
                    >
                      <Download
                        className={cn(
                          "size-3",
                          updatingEngine && "animate-pulse",
                        )}
                        aria-hidden="true"
                      />
                      <span>
                        {updatingEngine ? "Installing..." : "Install / Update Engine"}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="xs"
                      disabled={restartingDaemon || updatingEngine}
                      onClick={() => void handleRestartDaemon()}
                      data-testid="auth-start-daemon"
                    >
                      <RefreshCw
                        className={cn(
                          "size-3",
                          restartingDaemon && "animate-spin",
                        )}
                        aria-hidden="true"
                      />
                      <span>Retry</span>
                    </Button>
                  </div>
                </div>

                {daemonStatus.error && (
                  <p className="mt-1.5 mb-0 truncate font-mono text-[10.5px] text-muted-ink">
                    {daemonStatus.error}
                  </p>
                )}

                {doctorOpen && (
                  <div className="mt-2.5 flex flex-col gap-1.5 border-t border-hairline-soft pt-2.5">
                    {doctorLoading && doctorChecks.length === 0 ? (
                      <div className="py-1.5 text-center text-[11px] text-muted-ink">
                        Running diagnostics...
                      </div>
                    ) : (
                      doctorChecks.map((chk) => (
                        <div
                          key={chk.id}
                          className="flex items-start justify-between gap-2 rounded-md border border-hairline-soft bg-inset p-2 text-[11px]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-ink">
                              {chk.label}
                            </div>
                            <div className="text-muted-ink">{chk.detail}</div>
                          </div>
                          <Badge
                            variant={
                              chk.status === "pass"
                                ? "brand"
                                : chk.status === "warn"
                                  ? "warn"
                                  : "danger"
                            }
                          >
                            {chk.status}
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
