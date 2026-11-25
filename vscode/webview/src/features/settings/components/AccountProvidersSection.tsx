import * as React from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import type {
  AccountStatusView,
  AnalyticsSummaryView,
  ProviderEntryView,
} from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import { RayuProcessingMark } from "@/components/ui/rayu-processing-mark";
import { UsageRingSvg } from "@/components/ui/rayu-symbols";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postToHost } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

import { FULL_PLAN_LADDER } from "../hooks/useSettings";

export interface AccountProvidersSectionProps {
  account: AccountStatusView;
  analytics: AnalyticsSummaryView | null;
  analyticsRange: "7d" | "30d";
  onAnalyticsRangeChange: (range: "7d" | "30d") => void;
  analyticsGroupBy: "feature" | "model";
  onAnalyticsGroupByChange: (groupBy: "feature" | "model") => void;
  providers: ReadonlyArray<ProviderEntryView>;
  onRefreshAccount: () => Promise<unknown>;
  isRefreshingAccount: boolean;
  onSignInBrowser: (mode?: "vscode" | "loopback") => Promise<unknown>;
  onCancelSignIn: () => Promise<unknown>;
  onSignInApiKey: (apiKey: string) => Promise<unknown>;
  onCompleteCallback: (callbackUrl: string) => Promise<unknown>;
  onSignOut: () => Promise<unknown>;
  isSigningOut?: boolean;
  onSetBypassPacing: (enabled: boolean) => Promise<unknown>;
  onSetProviderApiKey: (input: {
    providerId: string;
    apiKey: string;
    baseUrl?: string;
  }) => Promise<unknown>;
  onClearProviderApiKey: (providerId: string) => Promise<unknown>;
  onLogoutProvider: (providerId: string) => Promise<unknown>;
  onRefreshModels: () => Promise<unknown>;
  isRefreshingModels: boolean;
}

type ProviderTabCategory = "native" | "openai_compatible" | "enterprise";

function getInitials(name?: string, email?: string): string {
  const clean = (name?.trim() || email?.trim() || "RC").trim();
  const parts = clean.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "RC";
  if (parts.length === 1) return (parts[0] ?? "RC").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? "R"}${parts[parts.length - 1]?.[0] ?? "C"}`.toUpperCase();
}

export function AccountProvidersSection({
  account,
  analytics,
  analyticsRange,
  onAnalyticsRangeChange,
  analyticsGroupBy,
  onAnalyticsGroupByChange,
  providers,
  onRefreshAccount,
  isRefreshingAccount,
  onSignInBrowser,
  onCancelSignIn,
  onSignInApiKey,
  onCompleteCallback,
  onSignOut,
  isSigningOut = false,
  onSetBypassPacing,
  onSetProviderApiKey,
  onClearProviderApiKey,
  onLogoutProvider,
  onRefreshModels,
  isRefreshingModels,
}: AccountProvidersSectionProps) {
  const [accountTab, setAccountTab] = React.useState<"overview" | "analytics">(
    "overview",
  );
  const [planLadderExpanded, setPlanLadderExpanded] = React.useState(false);
  const [providerCategory, setProviderCategory] =
    React.useState<ProviderTabCategory>("native");
  const [providerSearch, setProviderSearch] = React.useState("");
  const [editingProviderId, setEditingProviderId] = React.useState<
    string | null
  >(null);
  const [apiKeyDraft, setApiKeyDraft] = React.useState("");
  const [baseUrlDraft, setBaseUrlDraft] = React.useState("");
  const [failedAvatarUrl, setFailedAvatarUrl] = React.useState<string | null>(
    null,
  );
  const [inlineAuthOpen, setInlineAuthOpen] = React.useState(false);
  const [inlineAuthDraft, setInlineAuthDraft] = React.useState("");
  const [inlineAuthError, setInlineAuthError] = React.useState<string | null>(
    null,
  );
  const [inlineAuthSubmitting, setInlineAuthSubmitting] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);

  const webBase = account.webBase ?? "https://rayucode.com";

  const nativeProviders = React.useMemo(
    () => providers.filter((p) => p.category === "native"),
    [providers],
  );
  const compatProviders = React.useMemo(
    () => providers.filter((p) => p.category === "openai_compatible"),
    [providers],
  );
  const enterpriseProviders = React.useMemo(
    () => providers.filter((p) => p.category === "enterprise"),
    [providers],
  );

  const visibleProviders = React.useMemo(() => {
    const pool =
      providerCategory === "native"
        ? nativeProviders
        : providerCategory === "openai_compatible"
          ? compatProviders
          : enterpriseProviders;
    const q = providerSearch.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.baseUrl ?? "").toLowerCase().includes(q),
    );
  }, [
    compatProviders,
    enterpriseProviders,
    nativeProviders,
    providerCategory,
    providerSearch,
  ]);

  const plans =
    account.planLadder && account.planLadder.length > 0
      ? account.planLadder
      : FULL_PLAN_LADDER;

  const handleSaveKey = async (provider: ProviderEntryView) => {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) return;
    try {
      await onSetProviderApiKey({
        providerId: provider.id,
        apiKey: trimmed,
        baseUrl: baseUrlDraft.trim() || provider.baseUrl,
      });
      setEditingProviderId(null);
      setApiKeyDraft("");
      setBaseUrlDraft("");
    } catch {
      // Error surfaced via mutation toast & status banner
    }
  };

  const handleInlineAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inlineAuthDraft.trim();
    if (!trimmed) {
      setInlineAuthError(
        "Enter a rayu_sk_live_ API key or OAuth callback URL.",
      );
      return;
    }
    setInlineAuthError(null);
    setInlineAuthSubmitting(true);
    try {
      if (trimmed.includes("code=")) {
        await onCompleteCallback(trimmed);
      } else {
        if (!trimmed.startsWith("rayu_sk_live_")) {
          setInlineAuthError(
            "Invalid Rayu API key — keys must start with rayu_sk_live_.",
          );
          return;
        }
        await onSignInApiKey(trimmed);
      }
      setInlineAuthDraft("");
      setInlineAuthOpen(false);
    } catch (err) {
      setInlineAuthError(
        err instanceof Error ? err.message : "Unable to connect Rayu account",
      );
    } finally {
      setInlineAuthSubmitting(false);
    }
  };

  const handleCopyPendingLink = () => {
    if (!account.pendingAuthUrl) return;
    postToHost({ type: "rayucode.editor.copy", text: account.pendingAuthUrl });
    setCopiedLink(true);
    toast.success("Sign-in link copied");
    window.setTimeout(() => setCopiedLink(false), 2400);
  };

  const authMethodLabel =
    account.authMethod === "oauth"
      ? "Google OAuth"
      : account.authMethod === "apiKey"
        ? "API Key"
        : null;

  const displayName =
    account.displayName?.trim() ||
    account.email?.trim() ||
    (account.authMethod === "apiKey" ? "Rayu API Key" : "Rayu Cloud Account");

  return (
    <section
      data-testid="settings-section-account"
      aria-labelledby="settings-h-account"
      className="flex flex-col gap-7"
    >
      {/* Part 1: Rayu Cloud Account & Usage Card */}
      <div className="flex flex-col gap-5">
        {account.signedIn ? (
          <>
            {/* Truthful Signed-In Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3.5">
                {account.avatarUrl && account.avatarUrl !== failedAvatarUrl ? (
                  <img
                    src={account.avatarUrl}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    onError={() => setFailedAvatarUrl(account.avatarUrl ?? null)}
                    className="size-12 shrink-0 rounded-[14px] border border-premium object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid size-12 shrink-0 place-items-center rounded-[14px] border border-premium bg-brand-soft text-base font-semibold text-brand-text"
                  >
                    {getInitials(account.displayName, account.email)}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1
                      id="settings-h-account"
                      className="m-0 truncate text-xl font-semibold tracking-[-0.02em] text-ink"
                    >
                      {displayName}
                    </h1>
                    {account.planName && (
                      <span
                        data-testid="account-plan-pill"
                        className="inline-flex items-center gap-1 rounded-full border border-hairline bg-pane px-2.5 py-0.5 text-xs font-medium text-ink"
                      >
                        <UsageRingSvg className="size-3.5 text-brand-text" />
                        <span>{account.planName} Plan</span>
                      </span>
                    )}
                    {authMethodLabel && (
                      <span
                        data-testid="account-auth-method-badge"
                        className="inline-flex items-center rounded-full border border-brand/40 bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-text"
                      >
                        {authMethodLabel}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-ink">
                    {account.email ? `${account.email} · ` : ""}
                    Signed in to Rayu Cloud
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={isRefreshingAccount}
                  onClick={() => void onRefreshAccount().catch(() => {})}
                  data-testid="account-refresh-btn"
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      isRefreshingAccount && "animate-spin",
                    )}
                    aria-hidden="true"
                  />
                  <span>Refresh</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSigningOut}
                  onClick={() => void onSignOut().catch(() => {})}
                  data-testid="account-signout-btn"
                >
                  <LogOut className="size-3.5" aria-hidden="true" />
                  <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
                </Button>
              </div>
            </div>

            {/* Overview & Usage Analytics Sub-Tabs */}
            <Tabs
              value={accountTab}
              onValueChange={(v) => setAccountTab(v as "overview" | "analytics")}
            >
              <TabsList aria-label="Account usage view">
                <TabsTrigger value="overview" data-testid="account-tab-overview">
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="analytics"
                  data-testid="account-tab-analytics"
                >
                  Usage Analytics
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 flex flex-col gap-5">
                {/* Credits & Usage Ring Summary */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rayu-card-bevel flex items-center gap-3 rounded-xl border border-hairline bg-pane p-3.5">
                    <UsageRingSvg className="size-6 shrink-0 text-brand-text" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-ink">
                        Credits remaining
                      </div>
                      <div
                        data-testid="account-credits-remaining"
                        className="font-mono text-base font-semibold text-ink tabular-nums"
                      >
                        {account.creditsRemaining != null
                          ? `${account.creditsRemaining.toLocaleString()} cr`
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="rayu-card-bevel rounded-xl border border-hairline bg-pane p-3.5">
                    <div className="text-[11px] text-muted-ink">
                      PAYG top-up balance
                    </div>
                    <div
                      data-testid="account-topup-balance"
                      className="mt-0.5 font-mono text-base font-semibold text-brand-text tabular-nums"
                    >
                      {account.topUpBalance != null
                        ? `${account.topUpBalance.toLocaleString()} cr`
                        : "—"}
                    </div>
                  </div>

                  <div className="rayu-card-bevel flex items-center justify-between gap-2 rounded-xl border border-hairline bg-pane p-3.5">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-ink">
                        Use all credits
                      </div>
                      <div className="text-[11px] text-muted-ink">
                        Bypass pacing windows
                      </div>
                    </div>
                    <Switch
                      checked={Boolean(account.bypassPacing)}
                      onCheckedChange={(checked) =>
                        void onSetBypassPacing(checked).catch(() => {})
                      }
                      aria-label="Use all credits"
                      data-testid="use-all-credits-switch"
                    />
                  </div>
                </div>

                {/* Truthful Pacing Windows */}
                {account.windows.length > 0 && (
                  <div
                    data-testid="account-pacing-windows"
                    className="rayu-card-bevel space-y-3.5 rounded-xl border border-hairline bg-pane p-4"
                  >
                    {account.windows.map((win) => (
                      <div key={win.label}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                          <span className="font-medium text-ink">
                            {win.label}
                          </span>
                          <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                            {win.remainingPercent}% left
                            {win.resetCountdown
                              ? ` · ${win.resetCountdown}`
                              : ""}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-active">
                          <div
                            className="rayu-effort-bar h-full rounded-full transition-all"
                            style={{ width: `${win.remainingPercent}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="analytics"
                className="mt-4 flex flex-col gap-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center rounded-md border border-hairline bg-pane p-[2px]">
                    {(["7d", "30d"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        data-testid={`analytics-range-${r}`}
                        aria-pressed={analyticsRange === r}
                        onClick={() => onAnalyticsRangeChange(r)}
                        className={cn(
                          "cursor-pointer rounded-xs px-2.5 py-1 text-xs font-medium",
                          analyticsRange === r
                            ? "border border-premium bg-active text-ink"
                            : "text-muted-ink hover:text-ink",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  <Select
                    value={analyticsGroupBy}
                    onValueChange={(v) =>
                      onAnalyticsGroupByChange(v as "feature" | "model")
                    }
                  >
                    <SelectTrigger
                      aria-label="Group analytics by"
                      className="w-[170px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="feature">Group by feature</SelectItem>
                      <SelectItem value="model">Group by model</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div
                  data-testid="analytics-breakdown-card"
                  className="rayu-card-bevel rounded-xl border border-hairline bg-pane p-4"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">
                      Credit Breakdown ({analyticsRange})
                    </span>
                    <span className="font-mono text-brand-text tabular-nums">
                      {analytics?.totalCredits != null
                        ? `${analytics.totalCredits.toLocaleString()} cr total`
                        : "0 cr total"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {(analytics?.breakdown ?? []).map((row) => (
                      <div
                        key={row.key}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-body">{row.label}</span>
                        <span className="font-mono text-ink tabular-nums">
                          {row.credits.toLocaleString()} cr ({row.percent}%)
                        </span>
                      </div>
                    ))}
                  </div>

                  {(analytics?.topSessions ?? []).length > 0 && (
                    <div className="mt-4 border-t border-hairline-soft pt-3">
                      <div className="mb-2 text-xs font-medium text-ink">
                        Top Sessions
                      </div>
                      <div className="space-y-1.5">
                        {analytics?.topSessions.map((ses) => (
                          <div
                            key={ses.sessionId}
                            className="flex items-center justify-between gap-2 font-mono text-[11px] text-body"
                          >
                            <span className="truncate">{ses.title}</span>
                            <span className="shrink-0 text-ink tabular-nums">
                              {ses.credits} cr
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          /* Truthful Signed-Out Card (ZERO fabricated fallbacks!) */
          <div
            data-testid="account-signed-out-card"
            className="rayu-card-bevel flex flex-col gap-4 rounded-2xl border border-premium bg-pane p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3.5">
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-hairline bg-inset text-muted-ink"
                >
                  <User className="size-5" />
                </span>
                <div className="min-w-0">
                  <h1
                    id="settings-h-account"
                    className="m-0 text-lg font-semibold tracking-[-0.02em] text-ink"
                  >
                    Not signed in
                  </h1>
                  <p className="mt-0.5 mb-0 text-xs text-muted-ink">
                    Sign in to Rayu Cloud for hosted models, synced credits, and
                    Swarms — or configure local BYOK providers below.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                size="xs"
                disabled={isRefreshingAccount}
                onClick={() => void onRefreshAccount().catch(() => {})}
                data-testid="account-refresh-btn"
              >
                <RefreshCw
                  className={cn(
                    "size-3",
                    isRefreshingAccount && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                <span>Refresh</span>
              </Button>
            </div>

            {account.signingIn || account.pendingAuthUrl ? (
              <div
                data-testid="account-waiting-banner"
                className="flex flex-col gap-2.5 rounded-xl border border-brand/40 bg-brand-soft p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-medium text-brand-text">
                    <RayuProcessingMark animated className="size-3.5" />
                    <span>Waiting for browser sign-in...</span>
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {account.pendingAuthUrl && (
                      <Button
                        type="button"
                        variant="default"
                        size="xs"
                        onClick={handleCopyPendingLink}
                        data-testid="account-copy-link-btn"
                      >
                        {copiedLink ? (
                          <Check className="size-3" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3" aria-hidden="true" />
                        )}
                        <span>{copiedLink ? "Copied" : "Copy link"}</span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => void onCancelSignIn().catch(() => {})}
                      data-testid="account-cancel-signin-btn"
                    >
                      <X className="size-3" aria-hidden="true" />
                      <span>Cancel</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void onSignInBrowser("vscode").catch(() => {})}
                data-testid="account-signin-btn"
              >
                <LogIn className="size-3.5" aria-hidden="true" />
                <span>Log in with browser</span>
              </Button>

              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void onSignInBrowser("loopback").catch(() => {})}
                data-testid="account-signin-loopback-btn"
              >
                <Globe className="size-3.5" aria-hidden="true" />
                <span>Use localhost fallback</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setInlineAuthError(null);
                  setInlineAuthOpen((v) => !v);
                }}
                data-testid="account-connect-apikey-btn"
              >
                <KeyRound className="size-3.5" aria-hidden="true" />
                <span>Connect API key</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  postToHost({
                    type: "rayucode.editor.openExternal",
                    url: `${webBase}/sign-up`,
                  })
                }
                data-testid="account-signup-btn"
              >
                <span>Sign up</span>
                <ExternalLink className="size-3" aria-hidden="true" />
              </Button>
            </div>

            {inlineAuthOpen && (
              <form
                onSubmit={(e) => void handleInlineAuthSubmit(e)}
                data-testid="account-inline-apikey-form"
                className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-inset p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <label
                    htmlFor="settings-rayu-apikey"
                    className="font-medium text-ink"
                  >
                    Rayu API key or OAuth callback URL
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      postToHost({
                        type: "rayucode.editor.openExternal",
                        url: `${webBase}/dashboard/api-keys`,
                      })
                    }
                    className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-brand-text hover:underline"
                  >
                    <span>Get API key</span>
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="settings-rayu-apikey"
                    data-testid="account-inline-apikey-input"
                    type="password"
                    value={inlineAuthDraft}
                    onChange={(e) => {
                      setInlineAuthDraft(e.target.value);
                      if (inlineAuthError) setInlineAuthError(null);
                    }}
                    placeholder="rayu_sk_live_... or vscode://rayucode.rayucode/auth?code=..."
                    className="h-8 min-w-0 flex-1 rounded-md border border-control-border bg-pane px-2.5 font-mono text-xs text-ink placeholder:text-faint focus-visible:border-ring focus-visible:outline-none sm:min-w-[220px]"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={inlineAuthSubmitting}
                    data-testid="account-inline-apikey-submit"
                  >
                    {inlineAuthSubmitting ? "Connecting..." : "Connect"}
                  </Button>
                </div>

                {inlineAuthError && (
                  <div
                    role="alert"
                    data-testid="account-inline-apikey-error"
                    className="text-xs text-danger"
                  >
                    {inlineAuthError}
                  </div>
                )}
              </form>
            )}
          </div>
        )}

        {/* Plan Ladder (Always available for comparison) */}
        <div className="rounded-xl border border-hairline bg-pane p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-ink">
                Rayu Cloud Plan Ladder ({plans.length} tiers)
              </div>
              <div className="text-[11px] text-muted-ink">
                Compare Free, Pro, Plus, Max, Team, Team Plus, and Team Max
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setPlanLadderExpanded((v) => !v)}
              data-testid="toggle-plan-ladder-btn"
            >
              {planLadderExpanded ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
              <span>
                {planLadderExpanded ? "Hide Plan Ladder" : "View Plan Ladder"}
              </span>
            </Button>
          </div>

          {planLadderExpanded && (
            <div
              data-testid="plan-ladder-grid"
              className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
            >
              {plans.map((tier) => (
                <div
                  key={tier.id}
                  data-testid={`plan-tier-${tier.id}`}
                  className={cn(
                    "rounded-lg border p-3 text-xs",
                    tier.current
                      ? "border-brand bg-brand-softer"
                      : "border-hairline bg-inset",
                  )}
                >
                  <div className="flex items-center justify-between font-medium text-ink">
                    <span>{tier.name}</span>
                    <span className="font-mono text-[11px] text-muted-ink">
                      {tier.priceLabel}
                    </span>
                  </div>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-muted-ink">
                    {tier.highlights.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Part 2: All Providers & Multi-Account Readiness Table (10 Native + 45 OpenAI-Compat + 2 Enterprise) */}
      <div className="border-t border-hairline pt-6">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-semibold tracking-[-0.015em] text-ink">
              Provider Runtimes &amp; Model Discovery
            </h2>
            <p className="mt-0.5 text-xs text-muted-ink">
              {nativeProviders.length} native provider runtimes,{" "}
              {compatProviders.length} OpenAI-compatible profiles, and{" "}
              {enterpriseProviders.length} enterprise workspace integrations
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isRefreshingModels}
            onClick={() => void onRefreshModels().catch(() => {})}
            data-testid="providers-refresh-models-btn"
          >
            <RefreshCw
              className={cn("size-3.5", isRefreshingModels && "animate-spin")}
              aria-hidden="true"
            />
            <span>Refresh Models</span>
          </Button>
        </div>

        {/* Category Filter Tabs + Search Input */}
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
          <div
            role="tablist"
            aria-label="Provider categories"
            className="inline-flex max-w-full flex-wrap items-center rounded-md border border-hairline bg-pane p-[2px]"
          >
            <button
              type="button"
              role="tab"
              data-testid="providers-tab-native"
              aria-selected={providerCategory === "native"}
              onClick={() => setProviderCategory("native")}
              className={cn(
                "cursor-pointer rounded-xs px-2.5 py-1 text-xs font-medium",
                providerCategory === "native"
                  ? "border border-premium bg-active text-ink"
                  : "text-muted-ink hover:text-ink",
              )}
            >
              Native ({nativeProviders.length})
            </button>
            <button
              type="button"
              role="tab"
              data-testid="providers-tab-openai-compatible"
              aria-selected={providerCategory === "openai_compatible"}
              onClick={() => setProviderCategory("openai_compatible")}
              className={cn(
                "cursor-pointer rounded-xs px-2.5 py-1 text-xs font-medium",
                providerCategory === "openai_compatible"
                  ? "border border-premium bg-active text-ink"
                  : "text-muted-ink hover:text-ink",
              )}
            >
              OpenAI-Compatible ({compatProviders.length})
            </button>
            <button
              type="button"
              role="tab"
              data-testid="providers-tab-enterprise"
              aria-selected={providerCategory === "enterprise"}
              onClick={() => setProviderCategory("enterprise")}
              className={cn(
                "cursor-pointer rounded-xs px-2.5 py-1 text-xs font-medium",
                providerCategory === "enterprise"
                  ? "border border-premium bg-active text-ink"
                  : "text-muted-ink hover:text-ink",
              )}
            >
              Enterprise &amp; Workspace ({enterpriseProviders.length})
            </button>
          </div>

          <div className="relative min-w-0 flex-1 sm:min-w-[210px] sm:flex-none">
            <Search
              className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-ink"
              aria-hidden="true"
            />
            <input
              type="search"
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
              placeholder="Filter providers..."
              aria-label="Filter providers"
              data-testid="providers-search-input"
              className="h-7 w-full rounded-md border border-control-border bg-inset pr-2.5 pl-8 text-xs text-ink placeholder:text-muted-ink focus-visible:border-ring focus-visible:outline-none"
            />
          </div>
        </div>

        {/* Provider Rows */}
        <div
          data-testid="providers-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
        >
          {visibleProviders.map((provider) => {
            const isEditing = editingProviderId === provider.id;
            const isReady =
              provider.status === "ready" || provider.status === "env_key";

            return (
              <div
                key={provider.id}
                data-testid={`provider-row-${provider.id}`}
                className="flex flex-col gap-2 px-4 py-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      <span>{provider.name}</span>
                      <span
                        data-testid={`provider-status-${provider.id}`}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                          isReady
                            ? "bg-brand-soft text-brand-text"
                            : provider.status === "expired"
                              ? "bg-danger-soft text-danger"
                              : "bg-raised text-muted-ink",
                        )}
                      >
                        {provider.status === "ready"
                          ? "Ready"
                          : provider.status === "env_key"
                            ? "Env key"
                            : provider.status === "expired"
                              ? "Expired"
                              : "Needs key"}
                      </span>
                      {provider.authMethod && provider.authMethod !== "none" && (
                        <span className="rounded-full border border-hairline bg-inset px-1.5 py-0.5 font-mono text-[10px] text-muted-ink uppercase">
                          {provider.authMethod}
                        </span>
                      )}
                      {provider.modelCount !== undefined && (
                        <span className="font-mono text-[11px] text-muted-ink tabular-nums">
                          {provider.modelCount} models
                        </span>
                      )}
                    </div>
                    {(provider.baseUrl || provider.accountLabel) && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-ink">
                        {provider.accountLabel
                          ? `Account: ${provider.accountLabel}`
                          : ""}
                        {provider.accountLabel && provider.baseUrl ? " · " : ""}
                        {provider.baseUrl ?? ""}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="default"
                      size="xs"
                      onClick={() => {
                        setEditingProviderId(isEditing ? null : provider.id);
                        setApiKeyDraft("");
                        setBaseUrlDraft(provider.baseUrl ?? "");
                      }}
                      data-testid={`provider-connect-btn-${provider.id}`}
                    >
                      <KeyRound className="size-3" aria-hidden="true" />
                      <span>{isReady ? "Set API Key" : "Connect"}</span>
                    </Button>

                    {isReady && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            void onClearProviderApiKey(provider.id).catch(
                              () => {},
                            )
                          }
                          data-testid={`provider-clear-btn-${provider.id}`}
                        >
                          <Trash2 className="size-3" aria-hidden="true" />
                          <span>Clear</span>
                        </Button>
                        {provider.supportsOAuth && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() =>
                              void onLogoutProvider(provider.id).catch(() => {})
                            }
                            data-testid={`provider-logout-btn-${provider.id}`}
                          >
                            <span>Logout</span>
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div
                    data-testid={`provider-key-form-${provider.id}`}
                    className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-inset p-2.5"
                  >
                    <input
                      type="password"
                      value={apiKeyDraft}
                      onChange={(e) => setApiKeyDraft(e.target.value)}
                      placeholder={`Enter ${provider.name} API key...`}
                      data-testid={`provider-key-input-${provider.id}`}
                      className="h-7 min-w-0 flex-1 rounded border border-control-border bg-pane px-2 font-mono text-xs text-ink focus-visible:border-ring focus-visible:outline-none sm:min-w-[200px]"
                    />
                    {provider.category !== "native" && (
                      <input
                        type="text"
                        value={baseUrlDraft}
                        onChange={(e) => setBaseUrlDraft(e.target.value)}
                        placeholder="Base URL (optional)"
                        className="h-7 min-w-0 flex-1 rounded border border-control-border bg-pane px-2 font-mono text-xs text-ink focus-visible:border-ring focus-visible:outline-none sm:min-w-[180px] sm:flex-none"
                      />
                    )}
                    <Button
                      type="button"
                      variant="primary"
                      size="xs"
                      onClick={() => void handleSaveKey(provider)}
                      data-testid={`provider-key-save-${provider.id}`}
                    >
                      Save Key
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
