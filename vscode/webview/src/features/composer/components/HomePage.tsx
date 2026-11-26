import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  FileSearch,
  GitCompare,
  LogIn,
  Network,
  Wrench,
} from "lucide-react";
import type {
  ImageAttachmentView,
  SessionSummaryView,
} from "@shared/vscodeProtocol";

import { RayuProcessingMark } from "@/components/ui";
import {
  callRpc,
  cn,
  formatRelativeTime,
  mediaUrl,
  sendHarnessRequest,
  useAppStore,
} from "@/lib";

import { HOME_QUICK_ACTIONS, normalizeEffortLevel } from "../constants";
import {
  recentSessionsQueryOptions,
  useCreateSessionMutation,
} from "../hooks/useComposerData";
import type { ComposerSubmitPayload, QuickActionItem } from "../types";
import { SessionComposer } from "./SessionComposer";

export interface HomePageProps {
  userName?: string;
  onSelectSession?: (sessionId: string) => void;
  onSessionCreated?: (session: SessionSummaryView) => void;
  className?: string;
}

function resolveDisplayName(
  explicitName?: string,
  cloudDisplayName?: string | null,
  cloudEmail?: string | null,
): string | null {
  if (explicitName && explicitName.trim().length > 0) {
    return explicitName.trim();
  }
  const source =
    cloudDisplayName?.trim() ||
    (cloudEmail?.includes("@") ? cloudEmail.split("@")[0] : "") ||
    "";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function QuickActionIcon({ kind }: { kind: QuickActionItem["kind"] }) {
  const cls = "size-3.5 shrink-0 text-brand-text";
  switch (kind) {
    case "explain":
      return <FileSearch className={cls} aria-hidden="true" />;
    case "test":
      return <Wrench className={cls} aria-hidden="true" />;
    case "diff":
      return <GitCompare className={cls} aria-hidden="true" />;
    case "swarm":
      return <Network className={cls} aria-hidden="true" />;
  }
}

export function HomePage({
  userName,
  onSelectSession,
  onSessionCreated,
  className,
}: HomePageProps) {
  const queryClient = useQueryClient();
  const accountStatus = useAppStore((s) => s.accountStatus);
  const activeDraft = useAppStore((s) => s.activeDraft);
  const setAuthDialogOpen = useAppStore((s) => s.setAuthDialogOpen);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const enqueueOptimisticTurn = useAppStore((s) => s.enqueueOptimisticTurn);
  const setIsStreamActive = useAppStore((s) => s.setIsStreamActive);

  const displayName = resolveDisplayName(
    userName,
    accountStatus?.signedIn ? accountStatus.displayName : null,
    accountStatus?.signedIn ? accountStatus.email : null,
  );
  const showCloudSignIn = accountStatus !== null && !accountStatus.signedIn && !userName;

  const composerValue = useAppStore((s) => s.composerDrafts["__home__"] ?? "");
  const setComposerDraft = useAppStore((s) => s.setComposerDraft);
  const setComposerValue = React.useCallback(
    (next: string) => setComposerDraft("__home__", next),
    [setComposerDraft],
  );
  const [pendingSubmit, setPendingSubmit] = React.useState<{
    prompt: string;
    images?: ImageAttachmentView[];
    startedAtMs: number;
  } | null>(null);
  const [pendingElapsedSec, setPendingElapsedSec] = React.useState(0);
  const submitAttemptRef = React.useRef(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const createSessionMutation = useCreateSessionMutation();
  const sessionsQuery = useQuery(recentSessionsQueryOptions());

  const recentSessions = React.useMemo(
    () => (sessionsQuery.data?.sessions ?? []).slice(0, 3),
    [sessionsQuery.data?.sessions],
  );

  React.useEffect(() => {
    if (!pendingSubmit) return;
    const timer = setInterval(() => {
      setPendingElapsedSec(
        Math.max(
          1,
          Math.floor((Date.now() - pendingSubmit.startedAtMs) / 1000),
        ),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [pendingSubmit]);

  const handleStopPending = React.useCallback(() => {
    submitAttemptRef.current += 1;
    if (pendingSubmit) {
      setComposerValue(pendingSubmit.prompt);
    }
    setPendingSubmit(null);
    setPendingElapsedSec(0);
  }, [pendingSubmit]);

  const handleQuickActionClick = (action: QuickActionItem) => {
    setComposerValue(action.prompt);
    textareaRef.current?.focus();
  };

  const handleSelectRecentSession = async (session: SessionSummaryView) => {
    useAppStore.getState().seedSessionPrefsFromSummary(session);
    setActiveSession(session.sessionId, session.title);
    onSelectSession?.(session.sessionId);
    const attached = await callRpc("sessions.attach", {
      sessionId: session.sessionId,
    }).catch(() => null);
    if (attached?.session) {
      useAppStore.getState().seedSessionPrefsFromSummary(attached.session);
    }
  };

  const handleSubmit = React.useCallback(
    async (payload: ComposerSubmitPayload) => {
      const attemptId = ++submitAttemptRef.current;
      setPendingSubmit({
        prompt: payload.prompt,
        images: payload.images,
        startedAtMs: Date.now(),
      });
      setPendingElapsedSec(0);
      setComposerValue("");

      const storeSnapshot = useAppStore.getState();
      const draft = storeSnapshot.activeDraft;
      const draftPrefs = storeSnapshot.sessionPrefsBySession.__draft__;
      const effectiveWorkingDir =
        payload.workingDir ??
        draft?.workingDir ??
        storeSnapshot.activeProjectPath ??
        undefined;
      const effectiveModel =
        payload.modelSpec ||
        payload.modelId ||
        draft?.model ||
        draftPrefs?.modelId ||
        undefined;
      const effectiveEffort = normalizeEffortLevel(
        payload.effort ?? draft?.reasoningEffort ?? draftPrefs?.effort,
      );
      const effectivePermissionMode =
        payload.permissionMode ??
        (draft?.permissionMode as
          | ComposerSubmitPayload["permissionMode"]
          | undefined) ??
        draftPrefs?.permissionMode ??
        "default";
      const effectiveServiceTier =
        payload.serviceTier ?? draftPrefs?.serviceTier;
      const effectiveCacheTtl = payload.cacheTtl ?? draftPrefs?.cacheTtl;

      try {
        const created = await createSessionMutation.mutateAsync({
          workingDir: effectiveWorkingDir,
          permissionMode: effectivePermissionMode,
          model: effectiveModel,
          effort: effectiveEffort,
          ...(effectiveServiceTier ? { serviceTier: effectiveServiceTier } : {}),
          ...(effectiveCacheTtl ? { cacheTtl: effectiveCacheTtl } : {}),
        });

        if (submitAttemptRef.current !== attemptId) {
          return;
        }

        const session = created.session;
        setPendingSubmit(null);
        setPendingElapsedSec(0);

        // Persist the user's chosen composer configuration on this session BEFORE
        // transitioning from HomePage -> Workspace so the 2nd+ messages never reset.
        useAppStore.getState().setSessionPrefs(session.sessionId, {
          ...(effectiveModel ? { modelId: effectiveModel } : {}),
          ...(payload.modelLabel ? { modelLabel: payload.modelLabel } : {}),
          ...(payload.apiMethod ? { apiMethod: payload.apiMethod } : {}),
          effort: effectiveEffort,
          permissionMode: effectivePermissionMode,
          ...(effectiveServiceTier ? { serviceTier: effectiveServiceTier } : {}),
          ...(effectiveCacheTtl ? { cacheTtl: effectiveCacheTtl } : {}),
        });

        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        void queryClient.invalidateQueries({
          queryKey: ["workspace", "ledger"],
        });

        // Sync permission mode via typed RPC (no duplicate sendHarnessRequest)
        void callRpc("sessions.setPermissionMode", {
          sessionId: session.sessionId,
          mode: effectivePermissionMode,
        }).catch(() => {});

        const formattedSelectionContext = payload.editorSelection
          ? `\n\n[Active Editor Selection: ${payload.editorSelection.relativePath}#L${payload.editorSelection.lineStart}-L${payload.editorSelection.lineEnd}]`
          : "";

        const refFiles = payload.editorSelection
          ? `${payload.editorSelection.relativePath}:${payload.editorSelection.lineStart}-${payload.editorSelection.lineEnd}`
          : undefined;

        enqueueOptimisticTurn({
          id: `opt_${session.sessionId}_${Date.now()}`,
          sessionId: session.sessionId,
          prompt: payload.prompt,
          refFiles,
          images: payload.images?.map((img) => ({
            name: img.name ?? "Attachment",
            dataUrl: img.data,
          })),
          createdAtMs: Date.now(),
          baseHistoryTurnCount: 0,
        });

        setIsStreamActive(true);
        setActiveSession(session.sessionId, session.title);
        onSessionCreated?.(session);

        sendHarnessRequest({
          req: "send_message",
          session_id: session.sessionId,
          content: `${payload.prompt}${formattedSelectionContext}`,
          ...(effectiveModel ? { model: effectiveModel } : {}),
          ...(payload.apiMethod ? { api_method: payload.apiMethod } : {}),
          effort: effectiveEffort,
          images: payload.images,
          ...(effectiveWorkingDir ? { working_dir: effectiveWorkingDir } : {}),
        });
      } catch {
        if (submitAttemptRef.current !== attemptId) return;
        setPendingSubmit(null);
        setPendingElapsedSec(0);
        setComposerValue(payload.prompt);
      }
    },
    [
      createSessionMutation,
      enqueueOptimisticTurn,
      onSessionCreated,
      queryClient,
      setActiveSession,
      setIsStreamActive,
    ],
  );

  return (
    <div
      data-testid="home-page"
      className={cn(
        "@container/home flex min-h-0 flex-1 flex-col justify-between overflow-y-auto bg-canvas",
        className,
      )}
    >
      {pendingSubmit ? (
        <>
          <div
            role="presentation"
            aria-hidden="true"
            className="h-[1.5px] shrink-0 animate-pulse bg-brand"
          />
          <div className="mx-auto flex w-full max-w-[732px] flex-1 flex-col gap-5 overflow-y-auto px-4 pt-6 pb-4 @min-[640px]/app:px-6 @min-[640px]/app:pt-8">
            <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
              {pendingSubmit.images && pendingSubmit.images.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {pendingSubmit.images.map((img, idx) => (
                    <img
                      key={`${img.name ?? "img"}_${idx}`}
                      src={img.data}
                      alt={img.name ?? "Attachment"}
                      className="h-20 max-w-[160px] rounded-xl border border-hairline bg-inset object-cover shadow-bevel-surface"
                    />
                  ))}
                </div>
              ) : null}
              {pendingSubmit.prompt.trim().length > 0 ? (
                <div
                  data-testid="home-optimistic-prompt"
                  className="rayu-prose max-w-full rounded-2xl bg-active/85 px-4 py-2.5 text-[14px] leading-[1.6] text-ink whitespace-pre-wrap"
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
                  {`Working · ${Math.max(1, pendingElapsedSec)}s`}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="mx-auto flex w-full max-w-[732px] flex-1 flex-col items-center justify-center gap-3.5 px-4 pt-6 pb-4 text-center @min-[640px]/app:gap-4 @min-[640px]/app:px-6 @min-[640px]/app:pt-10">
          <img
            src={mediaUrl("rayu-fox.png")}
            alt="Rayu Code"
            data-testid="home-hero-logo"
            className="h-[48px] w-auto object-contain select-none @min-[640px]/app:h-[74px]"
          />

          <div className="flex flex-col items-center gap-1">
            {displayName ? (
              <p
                data-testid="home-greeting-sub"
                className="m-0 text-xs font-medium text-muted-ink"
              >
                Good to see you, {displayName}.
              </p>
            ) : null}
            <h1
              data-testid="home-hero-headline"
              className="m-0 text-lg font-medium tracking-[-0.025em] text-ink @min-[640px]/app:text-2xl"
            >
              What shall we build{" "}
              <em className="font-serif text-[1.08em] font-normal tracking-[-0.005em] text-brand-text italic">
                next?
              </em>
            </h1>
          </div>

          {showCloudSignIn ? (
            <button
              type="button"
              data-testid="home-cloud-signin-btn"
              onClick={() => setAuthDialogOpen(true)}
              className="mt-0.5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-premium bg-raised px-3.5 py-1.5 text-xs font-medium text-ink shadow-bevel-surface transition-colors hover:border-brand hover:text-brand-text"
            >
              <LogIn className="size-3.5 text-brand-text" aria-hidden="true" />
              <span>Sign in to Rayu Cloud</span>
            </button>
          ) : null}

          {/* 4 Quiet Quick-Action Pills */}
          <div
            data-testid="home-quick-actions"
            className="mt-1 flex flex-wrap items-center justify-center gap-1.5 @min-[640px]/app:gap-2"
          >
            {HOME_QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={`quick-action-${action.id}`}
                onClick={() => handleQuickActionClick(action)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-pane px-3 py-1.5 text-xs font-medium text-body shadow-bevel-surface transition-colors hover:border-premium-hi hover:bg-active hover:text-ink"
              >
                <QuickActionIcon kind={action.kind} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>

          {/* Compact Recent Sessions Preview Strip (especially useful in Compact Sidebar <560px) */}
          {recentSessions.length > 0 ? (
            <div
              data-testid="home-recent-sessions"
              className="mt-2 w-full max-w-[520px] rounded-xl border border-hairline-soft bg-pane/70 p-2 text-left @min-[960px]/app:max-w-[620px]"
            >
              <div className="mb-1 flex items-center justify-between px-1.5 text-[11px] font-medium text-muted-ink">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3 text-muted-ink" aria-hidden="true" />
                  <span>Recent sessions</span>
                </span>
                <span className="font-mono text-[10px] text-faint">
                  {recentSessions.length} active
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {recentSessions.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    data-testid={`home-recent-session-${session.sessionId}`}
                    onClick={() => void handleSelectRecentSession(session)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-hover"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          session.status === "running"
                            ? "animate-pulse bg-brand"
                            : "bg-muted-ink/60",
                        )}
                      />
                      <span className="truncate font-medium text-ink">
                        {session.title}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 font-mono text-[10.5px] text-muted-ink tabular-nums">
                      {session.diffAdditions || session.diffDeletions ? (
                        <span>
                          <span className="text-brand-text">
                            +{session.diffAdditions ?? 0}
                          </span>{" "}
                          <span className="text-danger">
                            -{session.diffDeletions ?? 0}
                          </span>
                        </span>
                      ) : null}
                      <span>{formatRelativeTime(session.updatedAtMs)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Embedded Floating SessionComposer */}
      <SessionComposer
        mode="home"
        value={composerValue}
        onValueChange={setComposerValue}
        inputRef={textareaRef}
        modelId={activeDraft?.model}
        effort={activeDraft?.reasoningEffort}
        permissionMode={
          activeDraft?.permissionMode as
            | ComposerSubmitPayload["permissionMode"]
            | undefined
        }
        onSubmit={handleSubmit}
        onStop={handleStopPending}
        isSubmitting={
          Boolean(pendingSubmit) || createSessionMutation.isPending
        }
      />
    </div>
  );
}

export { HomePage as HomeView };
