import * as React from "react";
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { DoctorCheckView } from "@shared/vscodeProtocol";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RunStatusPulse } from "@/components/ui/rayu-symbols";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/app-store";
import { mediaUrl } from "@/lib/media-url";
import { callRpc } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

export interface AuthWelcomeScreenProps {
  onContinue?: () => void;
  className?: string;
}

export function AuthWelcomeScreen({
  onContinue,
  className,
}: AuthWelcomeScreenProps) {
  const daemonStatus = useAppStore((s) => s.daemonStatus);
  const setDaemonStatus = useAppStore((s) => s.setDaemonStatus);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setAuthBypassed = useAppStore((s) => s.setAuthBypassed);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);

  const [mode, setMode] = React.useState<"welcome" | "apikey" | "doctor">(
    "welcome",
  );
  const [apiKeyOrCallback, setApiKeyOrCallback] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [infoMsg, setInfoMsg] = React.useState<string | null>(null);
  const [doctorChecks, setDoctorChecks] = React.useState<DoctorCheckView[]>([]);

  const isDaemonOnline = daemonStatus.state === "connected";

  const handleBrowserSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const res = await callRpc("settings.account.signInBrowser");
      if (res.state) {
        setAccountStatus(res.state);
      }
      if (res.state?.signedIn) {
        setAuthBypassed(false);
        setAuthDialogOpen(false);
        onContinue?.();
      } else {
        setInfoMsg(
          "Complete sign-in in your browser, then return here or paste the OAuth callback URL.",
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to start browser sign-in",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKeyOrCallback.trim();
    if (!trimmed) {
      setErrorMsg("Enter a Rayu Cloud API key or OAuth callback URL.");
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const next = trimmed.includes("code=")
        ? await callRpc("settings.account.completeCallback", {
            callbackUrl: trimmed,
          })
        : await callRpc("settings.account.signInApiKey", { apiKey: trimmed });
      setAccountStatus(next);
      setAuthBypassed(false);
      setAuthDialogOpen(false);
      setApiKeyOrCallback("");
      onContinue?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Unable to verify credentials",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestartDaemon = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const next = await callRpc("daemon.restart");
      setDaemonStatus(next);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to restart Rayu daemon",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunDoctor = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    setMode("doctor");
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
      setSubmitting(false);
    }
  };

  const handleContinueWithByok = () => {
    setAuthBypassed(true);
    setAuthDialogOpen(false);
    onContinue?.();
  };

  return (
    <div
      data-testid="auth-welcome-screen"
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-canvas text-ink select-none",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="rayu-auth-ambient-glow pointer-events-none absolute inset-0"
      />

      <ScrollArea className="relative z-10 min-h-0 flex-1">
        <div className="mx-auto flex min-h-full w-full max-w-[440px] flex-col items-center justify-center gap-5 px-5 py-8">
          {/* Rayu Fox Brand Hero */}
          <div className="rayu-auth-logo-enter flex flex-col items-center gap-3 text-center">
            <img
              src={mediaUrl("rayu-fox.png")}
              alt="RayuCode"
              className="h-14 w-auto object-contain drop-shadow-md"
            />
            <div className="rayu-auth-text-enter flex flex-col items-center gap-1">
              <div className="inline-flex flex-wrap items-center justify-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-ink">
                  RayuCode for VS Code
                </h1>
                <Badge variant="brand">
                  {daemonStatus.version ? `v${daemonStatus.version}` : "VS Code"}
                </Badge>
              </div>
              <p className="max-w-[340px] text-xs leading-relaxed text-muted-ink">
                Quiet 3-depth execution trace, parallel Swarm worktrees, 7-layer MCP, and 55+ model providers powered by the Rust engine.
              </p>
            </div>
          </div>

          {/* Daemon Health Status Card */}
          <Card className="rayu-auth-actions-enter w-full gap-2.5 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <RunStatusPulse
                  status={isDaemonOnline ? "success" : "danger"}
                />
                <span className="text-xs font-semibold text-ink">
                  {isDaemonOnline
                    ? "Rayu Engine Connected"
                    : "Rayu Engine Offline"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={submitting}
                  onClick={() => void handleRunDoctor()}
                  data-testid="auth-run-doctor"
                >
                  <Activity className="size-3" />
                  <span>Doctor</span>
                </Button>
                {!isDaemonOnline && (
                  <Button
                    type="button"
                    variant="default"
                    size="xs"
                    disabled={submitting}
                    onClick={() => void handleRestartDaemon()}
                    data-testid="auth-start-daemon"
                  >
                    <RefreshCw
                      className={cn("size-3", submitting && "animate-spin")}
                    />
                    <span>Start Bridge</span>
                  </Button>
                )}
              </div>
            </div>
            {daemonStatus.socketPath && (
              <div className="truncate font-mono text-[10.5px] text-muted-ink">
                Socket: {daemonStatus.socketPath}
              </div>
            )}
          </Card>

          {/* Main Auth / API Key / Doctor Card */}
          <Card className="rayu-auth-actions-enter w-full gap-3 p-4">
            {mode === "welcome" && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  disabled={submitting}
                  onClick={() => void handleBrowserSignIn()}
                  data-testid="auth-signin-browser"
                  className="w-full"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ExternalLink className="size-4" />
                  )}
                  <span>Sign in with Rayu Cloud</span>
                </Button>

                <Button
                  type="button"
                  variant="default"
                  size="default"
                  onClick={() => {
                    setErrorMsg(null);
                    setMode("apikey");
                  }}
                  data-testid="auth-switch-apikey"
                  className="w-full"
                >
                  <KeyRound className="size-3.5" />
                  <span>Paste API Key or Callback URL</span>
                </Button>

                <div className="my-0.5 flex items-center gap-2">
                  <div className="h-px flex-1 bg-hairline-soft" />
                  <span className="text-[10.5px] text-muted-ink uppercase">
                    or local BYOK
                  </span>
                  <div className="h-px flex-1 bg-hairline-soft" />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={handleContinueWithByok}
                  data-testid="auth-continue-byok"
                  className="w-full"
                >
                  <Wrench className="size-3.5" />
                  <span>Continue with Local BYOK Providers</span>
                </Button>
              </>
            )}

            {mode === "apikey" && (
              <form
                onSubmit={(e) => void handleApiKeySubmit(e)}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="rayu-api-key-input"
                    className="text-xs font-medium text-ink"
                  >
                    Rayu Cloud API Key or OAuth Callback
                  </label>
                  <Input
                    id="rayu-api-key-input"
                    type="password"
                    value={apiKeyOrCallback}
                    onChange={(e) => setApiKeyOrCallback(e.target.value)}
                    placeholder="rayu_sk_live_... or http://localhost.../callback?code=..."
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setErrorMsg(null);
                      setMode("welcome");
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={submitting}
                  >
                    {submitting && <Loader2 className="size-3.5 animate-spin" />}
                    <span>Connect</span>
                  </Button>
                </div>
              </form>
            )}

            {mode === "doctor" && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink">
                    Engine &amp; Auth Doctor
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setMode("welcome")}
                  >
                    Back
                  </Button>
                </div>
                {doctorChecks.length === 0 ? (
                  <div className="py-3 text-center text-xs text-muted-ink">
                    Running diagnostics...
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {doctorChecks.map((chk) => (
                      <div
                        key={chk.id}
                        className="flex items-start justify-between gap-2 rounded-md border border-hairline-soft bg-inset p-2 text-xs"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-ink">
                            {chk.label}
                          </span>
                          <span className="text-[11px] text-muted-ink">
                            {chk.detail}
                          </span>
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
                    ))}
                  </div>
                )}
              </div>
            )}

            {infoMsg && (
              <div
                role="status"
                data-testid="auth-info-message"
                className="rounded-md border border-brand/30 bg-brand-soft px-2.5 py-2 text-xs text-ink"
              >
                {infoMsg}
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-xs text-danger"
              >
                {errorMsg}
              </div>
            )}
          </Card>

          {/* Footer links */}
          <div className="rayu-auth-footer-enter flex items-center justify-center gap-4 text-[11px] text-muted-ink">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-brand-text" />
              <span>Zero-trust command gate</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setAuthBypassed(true);
                setAuthDialogOpen(false);
                setActiveRoute("settings");
              }}
              className="cursor-pointer text-brand-text hover:underline"
            >
              Configure Providers
            </button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export { CheckCircle2, Sparkles };
