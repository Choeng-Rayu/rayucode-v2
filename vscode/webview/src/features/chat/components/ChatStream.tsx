import * as React from "react";
import {
  ArrowDown,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Layers,
  List,
  Pencil,
  Presentation,
  RotateCcw,
  X,
} from "lucide-react";

import {
  RayuProcessingMark,
  ScrollArea,
  TechFileBadge,
} from "@/components/ui";
import {
  callRpc,
  cn,
  postToHost,
  useAppStore,
  type MidTurnMessageItem,
} from "@/lib";
import type {
  FileChangesSnapshotView,
  SessionSummaryView,
} from "@shared/vscodeProtocol";

import type {
  ChatTurnView,
  SoftInterruptQueueItem,
} from "../hooks/useChatStream";
import { ApprovalCard, type ApprovalCardRequest } from "./ApprovalCard";
import { ChatSessionContext } from "./ChatSessionContext";
import { CiteLink, parseFileLineTarget } from "./CiteLink";
import {
  ClarifyingQuestionCard,
  type ClarifyingQuestionRequest,
  type ClarifyingQuestionSubmitMeta,
} from "./ClarifyingQuestionCard";
import { EditorialMarkdown } from "./EditorialMarkdown";
import { InlineDiffCard } from "./InlineDiffCard";
import { TurnActions } from "./TurnActions";
import { TurnFileSummaryCard } from "./TurnFileSummaryCard";
import { WorkTrace } from "./WorkTrace";

function formatTurnResponseMarkdown(turn: ChatTurnView): string {
  const parts: string[] = [];
  if (turn.answerIntro.trim()) {
    parts.push(turn.answerIntro.trim());
  }
  if (turn.answerSummaryTitle) {
    parts.push(`### ${turn.answerSummaryTitle}`);
  }
  if (turn.answerBullets.length > 0) {
    const bulletLines = turn.answerBullets.map((bullet, idx) => {
      const cites =
        bullet.citations.length > 0
          ? ` (${bullet.citations.map((c) => c.label).join(", ")})`
          : "";
      return `${idx + 1}. **${bullet.title}** ${bullet.body}${cites}`;
    });
    parts.push(bulletLines.join("\n"));
  }
  return parts.join("\n\n");
}

interface TurnViewProps {
  turn: ChatTurnView;
  fileChangesSnapshot?: FileChangesSnapshotView | null;
  onFileChangesUpdated?: (snapshot: FileChangesSnapshotView) => void;
  onForked?: (session: SessionSummaryView) => void;
  onPinToggled?: (turnId: string, pinned: boolean) => void;
  onRetry?: (turnId: string) => void;
  onRewind?: (turnId: string) => void;
  onBackgroundTool?: () => void;
}

function TurnView({
  turn,
  fileChangesSnapshot,
  onFileChangesUpdated,
  onForked,
  onPinToggled,
  onRetry,
  onRewind,
  onBackgroundTool,
}: TurnViewProps) {
  const responseMarkdown = React.useMemo(
    () => formatTurnResponseMarkdown(turn),
    [turn],
  );

  const hasAnswer =
    turn.answerIntro.trim().length > 0 || turn.answerBullets.length > 0;
  const hasFileSummary =
    !turn.isLive &&
    Boolean(fileChangesSnapshot && fileChangesSnapshot.files.length > 0);
  const hasPrimaryDiff =
    !hasFileSummary && Boolean(turn.diffCard && turn.diffCard.lines.length > 0);
  const hasTraceContent =
    turn.notes.length > 0 ||
    turn.groups.length > 0 ||
    Boolean(turn.timeline && turn.timeline.length > 0);

  const liveSummaryLabel = turn.connectionPhaseLabel
    ? `Working · ${turn.workedDuration} · ${turn.connectionPhaseLabel}`
    : `Working · ${turn.workedDuration}`;

  const lastTimelineEntry =
    turn.timeline && turn.timeline.length > 0
      ? turn.timeline[turn.timeline.length - 1]
      : null;

  const liveProgressStatus = React.useMemo(() => {
    if (turn.activeToolStatus) return turn.activeToolStatus;
    if (turn.connectionPhaseLabel) return null;
    if (hasAnswer) return "Writing response...";
    if (lastTimelineEntry?.type === "reasoning") return "Thinking...";
    if (turn.groups.length > 0 || turn.notes.length > 0) return "Working...";
    return "Thinking...";
  }, [
    hasAnswer,
    lastTimelineEntry?.type,
    turn.activeToolStatus,
    turn.connectionPhaseLabel,
    turn.groups.length,
    turn.notes.length,
  ]);

  const handleFooterBackgroundClick = async () => {
    if (onBackgroundTool) {
      onBackgroundTool();
      return;
    }
    const sid =
      turn.sessionId ||
      useAppStore.getState().activeSessionId ||
      "ses_vscode_shell";
    try {
      await callRpc("background.backgroundTool", { sessionId: sid });
    } catch {
      // ignore offline error
    }
  };

  return (
    <ChatSessionContext.Provider value={turn.sessionId || undefined}>
    <article
      data-slot="execution-turn"
      data-testid={`execution-turn-${turn.id}`}
      data-turn-id={turn.id}
      className="group/turn flex min-w-0 flex-col gap-4"
    >
      {turn.compactedNotice && (
        <div
          data-slot="ctx-note"
          className="inline-flex items-center gap-[7px] py-0.5 text-[12.5px] text-muted-ink"
        >
          <List
            className="size-3.5 shrink-0 text-muted-ink"
            aria-hidden="true"
          />
          <span>{turn.compactedNotice}</span>
        </div>
      )}

      {/* User Prompt Bubble */}
      <div className="flex max-w-[92%] min-w-0 flex-col items-end gap-1.5 self-end @min-[420px]/chat:max-w-[85%]">
        {turn.userRefFiles && (() => {
          const parsedRef = parseFileLineTarget(turn.userRefFiles);
          return (
            <button
              type="button"
              data-slot="user-ref-pill"
              onClick={() => {
                postToHost({
                  type: "rayucode.editor.openFile",
                  sessionId: turn.sessionId,
                  path: parsedRef.path,
                  ...(parsedRef.line ? { line: parsedRef.line } : {}),
                  ...(parsedRef.column ? { column: parsedRef.column } : {}),
                });
              }}
              className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-[9px] border border-hairline bg-pane px-2.5 py-1 text-xs text-body transition-colors hover:border-premium hover:text-ink @min-[420px]/chat:max-w-[340px]"
            >
              <TechFileBadge
                path={parsedRef.path}
                className="size-3.5"
              />
              <span className="truncate font-mono text-[11.5px]">
                {turn.userRefFiles}
              </span>
            </button>
          );
        })()}

        {turn.userImages && turn.userImages.length > 0 && (
          <div
            data-slot="user-image-attachments"
            className="flex flex-wrap justify-end gap-2"
          >
            {turn.userImages.map((img, idx) => (
              <img
                key={`${img.name}_${idx}`}
                src={img.dataUrl}
                alt={img.name}
                className="h-24 max-w-[180px] rounded-xl border border-hairline bg-inset object-cover shadow-bevel-surface"
              />
            ))}
          </div>
        )}

        {(turn.userPrompt.trim().length > 0 || Boolean(turn.userMeta)) && (
          <div className="flex items-center gap-1.5">
            {!turn.isLive && onRewind && (
              <button
                type="button"
                data-testid={`turn-rewind-${turn.id}`}
                onClick={() => onRewind(turn.id)}
                title="Rewind session to this turn"
                className=" inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-ink opacity-0 transition-all group-hover/turn:opacity-100 hover:bg-hover hover:text-ink"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </button>
            )}
            <div
              data-slot="msg-user"
              className="rayu-prose max-w-full rounded-2xl bg-active/85 px-4 py-2.5 text-[14px] leading-[1.6] break-words text-ink whitespace-pre-wrap"
            >
              {turn.userPrompt}
              {turn.userMeta && (
                <div className="mt-1.5 font-mono text-[10px] text-muted-ink">
                  {turn.userMeta}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Assistant Execution Trace & Response */}
      <div data-slot="msg-agent" className="flex min-w-0 flex-col gap-3">
        {hasTraceContent && (
          <WorkTrace
            workedDuration={turn.workedDuration}
            isLive={turn.isLive}
            liveStatusPlacement="footer"
            connectionPhaseLabel={turn.connectionPhaseLabel}
            notes={turn.notes}
            groups={turn.groups}
            timeline={turn.timeline}
            activeToolStatus={turn.activeToolStatus}
            showLiveBackgroundPill={turn.showLiveBackgroundPill}
            sessionId={turn.sessionId}
            defaultExpanded={
              !turn.isLive && !hasAnswer && hasTraceContent ? true : undefined
            }
            onBackgroundTool={onBackgroundTool}
          />
        )}

        {hasAnswer && (
          <div
            data-slot="agent-answer"
            className="flex min-w-0 flex-col gap-3 text-[14px] leading-[1.6] break-words text-body"
          >
            {turn.answerIntro.trim().length > 0 && (
              <EditorialMarkdown content={turn.answerIntro} />
            )}

            {turn.answerSummaryTitle && (
              <h3 className="mt-1 -mb-1 text-[15px] font-semibold tracking-tight text-ink">
                {turn.answerSummaryTitle}
              </h3>
            )}

            {turn.answerBullets.length > 0 && (
              <ol className="rayu-prose m-0 flex max-w-[72ch] list-decimal flex-col gap-2.5 pl-5 text-[14px] leading-[1.6] text-body marker:font-medium marker:text-muted-ink">
                {turn.answerBullets.map((bullet) => (
                  <li key={bullet.id} className="pl-0.5 text-body">
                    <strong className="font-semibold text-ink">
                      {bullet.title}
                    </strong>{" "}
                    <EditorialMarkdown content={bullet.body} inline />
                    {bullet.citations.length > 0 && (
                      <>
                        {" "}
                        {bullet.citations.map((citation, citeIdx) => (
                          <React.Fragment
                            key={`${bullet.id}-${citation.file}-${citation.line ?? citeIdx}`}
                          >
                            {citeIdx > 0 && (
                              <span
                                className="mx-[3px] text-muted-ink"
                                aria-hidden="true"
                              >
                                ·
                              </span>
                            )}
                            <CiteLink citation={citation} />
                          </React.Fragment>
                        ))}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {hasPrimaryDiff && (
          <InlineDiffCard diff={turn.diffCard} sessionId={turn.sessionId} />
        )}

        {!hasFileSummary &&
          turn.diffCards?.map((dc) => (
            <InlineDiffCard key={dc.id} diff={dc} sessionId={turn.sessionId} />
          ))}

        {turn.artifacts && turn.artifacts.length > 0 && (
          <div className="flex flex-col gap-2">
            {turn.artifacts.map((artifact, idx) => (
              <div
                key={`${artifact.title}_${idx}`}
                data-testid="turn-output-artifact-card"
                className="flex min-w-0 flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-hairline bg-raised px-3.5 py-2.5 shadow-bevel-surface"
              >
                <button
                  type="button"
                  disabled={!artifact.filePath}
                  onClick={() => {
                    if (!artifact.filePath) return;
                    postToHost({
                      type: "rayucode.editor.openFile",
                      sessionId: turn.sessionId,
                      path: artifact.filePath,
                    });
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-hairline bg-inset text-code-type">
                    {artifact.kind === "slide" ? (
                      <Presentation className="size-4" aria-hidden="true" />
                    ) : artifact.kind === "excel" ? (
                      <FileSpreadsheet className="size-4" aria-hidden="true" />
                    ) : (
                      <FileText className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {artifact.title}
                    </span>
                    <span className="block truncate text-xs text-muted-ink">
                      {artifact.subtitle}
                    </span>
                  </span>
                </button>

                {artifact.filePath && (
                  <button
                    type="button"
                    data-testid="artifact-open-trigger"
                    onClick={() =>
                      postToHost({
                        type: "rayucode.editor.openFile",
                        sessionId: turn.sessionId,
                        path: artifact.filePath!,
                      })
                    }
                    className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hairline-strong bg-inset px-3 text-xs font-medium text-ink transition-colors hover:bg-hover"
                  >
                    <ExternalLink
                      className="size-3.5 text-muted-ink"
                      aria-hidden="true"
                    />
                    <span>Open</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!turn.isLive &&
          fileChangesSnapshot &&
          fileChangesSnapshot.files.length > 0 && (
            <TurnFileSummaryCard
              snapshot={fileChangesSnapshot}
              sessionId={turn.sessionId}
              onSnapshotUpdated={onFileChangesUpdated}
            />
          )}

        {turn.isLive && (
          <div
            data-slot="turn-live-footer"
            data-testid={`turn-live-footer-${turn.id}`}
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 pt-1 text-[13px] text-muted-ink"
          >
            <span
              data-testid={!hasTraceContent ? "work-trace" : undefined}
              data-live={!hasTraceContent ? "true" : undefined}
              className="inline-flex items-center gap-1.5 font-medium text-ink"
            >
              <RayuProcessingMark animated className="size-4 shrink-0" />
              <span data-testid="work-trace-summary" className="tabular-nums">
                {liveSummaryLabel}
              </span>
            </span>

            {liveProgressStatus && (
              <>
                <span className="text-faint" aria-hidden="true">
                  ·
                </span>
                <span
                  data-testid="turn-live-status"
                  className="min-w-0 truncate text-[12.5px] text-muted-ink animate-pulse"
                >
                  {liveProgressStatus}
                </span>
              </>
            )}

            {turn.showLiveBackgroundPill && (
              <button
                type="button"
                data-testid="work-trace-live-bg-btn"
                onClick={() => void handleFooterBackgroundClick()}
                title="Move foreground command to Background Process Viewer (Alt+B)"
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-hairline bg-pane px-2.5 py-0.5 text-[11px] font-medium text-muted-ink transition-colors hover:border-premium hover:bg-hover hover:text-ink"
              >
                <Layers className="size-3 shrink-0" aria-hidden="true" />
                <span>Background</span>
                <kbd className="ml-0.5 font-mono text-[10px] text-faint">
                  Alt+B
                </kbd>
              </button>
            )}
          </div>
        )}

        {!turn.isLive && (
          <TurnActions
            sessionId={turn.sessionId}
            turnId={turn.id}
            responseMarkdown={responseMarkdown}
            timestamp={turn.timestamp}
            workedDuration={turn.workedDuration || undefined}
            credits={turn.credits}
            kvCachePct={turn.kvCachePct}
            kvCacheMissReason={turn.kvCacheMissReason}
            pinned={turn.pinned}
            onForked={onForked}
            onPinToggled={onPinToggled}
            onRetry={onRetry}
          />
        )}
      </div>
    </article>
    </ChatSessionContext.Provider>
  );
}

export interface ChatStreamProps {
  sessionId?: string;
  turns: ChatTurnView[];
  isStreaming?: boolean;
  fileChangesSnapshot?: FileChangesSnapshotView | null;
  onFileChangesUpdated?: (snapshot: FileChangesSnapshotView) => void;
  pendingPermission?: ApprovalCardRequest | null;
  pendingPermissionQueueCount?: number;
  isPermissionSubmitting?: boolean;
  pendingQuestion?: ClarifyingQuestionRequest | null;
  softInterrupts?: SoftInterruptQueueItem[];
  midTurnMessages?: MidTurnMessageItem[];
  isQueuePaused?: boolean;
  rewoundTurnId?: string | null;
  onPermissionDecision?: (
    decision: "allow_once" | "allow_always" | "deny",
    request: ApprovalCardRequest,
  ) => void;
  onQuestionSubmit?: (
    answers: Record<string, string>,
    notes?: Record<string, string>,
    meta?: ClarifyingQuestionSubmitMeta,
  ) => void;
  onQuestionDismiss?: () => void;
  onCancelSoftInterrupt?: (interruptId?: string) => void;
  onPromoteQueuedToSteer?: (id: string) => void;
  onEditMidTurnMessage?: (id: string) => void;
  onSendQueuedNow?: (id: string) => void;
  onCancelMidTurnMessage?: (id?: string) => void;
  onRewindTurn?: (turnId: string) => void;
  onUndoRewind?: () => void;
  onBackgroundTool?: () => void;
  onForked?: (session: SessionSummaryView) => void;
  onPinToggled?: (turnId: string, pinned: boolean) => void;
  onRetryTurn?: (turnId: string) => void;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}

export function ChatStream({
  sessionId,
  turns,
  isStreaming = false,
  fileChangesSnapshot,
  onFileChangesUpdated,
  pendingPermission,
  pendingPermissionQueueCount = 1,
  isPermissionSubmitting = false,
  pendingQuestion,
  softInterrupts = [],
  midTurnMessages,
  isQueuePaused = false,
  rewoundTurnId,
  onPermissionDecision,
  onQuestionSubmit,
  onQuestionDismiss,
  onCancelSoftInterrupt,
  onPromoteQueuedToSteer,
  onEditMidTurnMessage,
  onSendQueuedNow,
  onCancelMidTurnMessage,
  onRewindTurn,
  onUndoRewind,
  onBackgroundTool,
  onForked,
  onPinToggled,
  onRetryTurn,
  className,
  ref,
}: ChatStreamProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const autoFollowRef = React.useRef(true);
  const lastScrollTopRef = React.useRef(0);
  const programmaticScrollUntilRef = React.useRef(0);
  const prevTurnCountRef = React.useRef(turns.length);
  const [showScrollToBottom, setShowScrollToBottom] = React.useState(false);

  const SCROLL_BOTTOM_THRESHOLD_PX = 48;

  const isViewportNearBottom = React.useCallback((el: HTMLDivElement): boolean => {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottom = React.useCallback(
    (behavior: "auto" | "smooth" = "auto") => {
      autoFollowRef.current = true;
      setShowScrollToBottom(false);
      const viewport = viewportRef.current;
      if (viewport) {
        programmaticScrollUntilRef.current =
          Date.now() + (behavior === "smooth" ? 450 : 80);
        const targetTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        if (behavior === "smooth" && typeof viewport.scrollTo === "function") {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
        } else {
          viewport.scrollTop = viewport.scrollHeight;
        }
        lastScrollTopRef.current = targetTop;
        if (
          viewport.scrollHeight === 0 &&
          typeof bottomAnchorRef.current?.scrollIntoView === "function"
        ) {
          bottomAnchorRef.current.scrollIntoView({ behavior, block: "end" });
        }
        return;
      }
      if (typeof bottomAnchorRef.current?.scrollIntoView === "function") {
        bottomAnchorRef.current.scrollIntoView({ behavior, block: "end" });
      }
    },
    [],
  );

  // Re-engage live auto-follow on session switch
  React.useEffect(() => {
    autoFollowRef.current = true;
    setShowScrollToBottom(false);
    scrollToBottom("auto");
  }, [sessionId, scrollToBottom]);

  // Re-engage live auto-follow when a new turn is added
  React.useEffect(() => {
    if (turns.length > prevTurnCountRef.current) {
      scrollToBottom("auto");
    }
    prevTurnCountRef.current = turns.length;
  }, [turns.length, scrollToBottom]);

  // Track user scroll position & scroll-up intent on the Radix viewport
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        const canScroll = viewport.scrollHeight > viewport.clientHeight + 4;
        if (canScroll) {
          autoFollowRef.current = false;
          programmaticScrollUntilRef.current = 0;
          if (!isViewportNearBottom(viewport)) {
            setShowScrollToBottom(true);
          }
        }
      }
    };

    const handleScroll = () => {
      const currentTop = viewport.scrollTop;
      const nearBottom = isViewportNearBottom(viewport);

      if (nearBottom) {
        autoFollowRef.current = true;
        setShowScrollToBottom(false);
        lastScrollTopRef.current = currentTop;
        return;
      }

      const withinProgrammaticGuard =
        Date.now() < programmaticScrollUntilRef.current;

      if (!withinProgrammaticGuard) {
        if (currentTop < lastScrollTopRef.current - 2) {
          autoFollowRef.current = false;
        }
        if (!autoFollowRef.current) {
          setShowScrollToBottom(true);
        }
      }

      lastScrollTopRef.current = currentTop;
    };

    viewport.addEventListener("wheel", handleWheel, { passive: true });
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [isViewportNearBottom]);

  // Keep locked to the live bottom stream whenever content grows while auto-follow is on
  React.useEffect(() => {
    const contentEl = contentRef.current;
    const viewport = viewportRef.current;
    if (!contentEl || !viewport || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (autoFollowRef.current) {
        scrollToBottom("auto");
      } else {
        setShowScrollToBottom(!isViewportNearBottom(viewport));
      }
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [isViewportNearBottom, scrollToBottom]);

  // Always scroll an incoming approval or clarifying question prompt into view
  React.useEffect(() => {
    if (pendingPermission?.requestId || pendingQuestion?.requestId) {
      scrollToBottom("auto");
    }
  }, [pendingPermission?.requestId, pendingQuestion?.requestId, scrollToBottom]);

  // Follow every live update (streaming deltas, tool steps, approvals, questions) when auto-follow is active
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (autoFollowRef.current) {
      scrollToBottom("auto");
    } else if (viewport) {
      setShowScrollToBottom(!isViewportNearBottom(viewport));
    }
  }, [
    turns,
    isStreaming,
    pendingPermission,
    pendingQuestion,
    isViewportNearBottom,
    scrollToBottom,
  ]);

  const hasFileChanges = Boolean(
    fileChangesSnapshot && fileChangesSnapshot.files.length > 0,
  );
  const lastFinishedTurnIndex = React.useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (!turns[i]?.isLive) return i;
    }
    return -1;
  }, [turns]);
  const anchorSummaryInTurnIndex =
    hasFileChanges && !isStreaming && lastFinishedTurnIndex >= 0
      ? lastFinishedTurnIndex
      : -1;

  return (
    <div
      ref={ref}
      data-slot="chat-stream"
      data-testid="chat-stream"
      className={cn(
        "@container/chat flex min-h-0 min-w-0 flex-1 flex-col",
        className,
      )}
    >
      {isStreaming && (
        <div
          role="presentation"
          aria-hidden="true"
          className="h-[1.5px] shrink-0 animate-pulse bg-brand"
        />
      )}

      {rewoundTurnId && (
        <div
          data-testid="rewind-toast-banner"
          className="flex items-center justify-between gap-2 border-b border-hairline bg-pane px-4 py-1.5 text-xs text-body"
        >
          <span>Turn rewound to checkpoint</span>
          {onUndoRewind && (
            <button
              type="button"
              data-testid="undo-rewind-btn"
              onClick={onUndoRewind}
              className="cursor-pointer font-medium text-brand-text hover:underline"
            >
              Undo Rewind
            </button>
          )}
        </div>
      )}

      <ScrollArea viewportRef={viewportRef} className="min-h-0 min-w-0 flex-1">
        <div
          ref={contentRef}
          data-slot="stream-container"
          className="mx-auto flex w-full max-w-[732px] min-w-0 flex-col gap-6 px-3 pt-4 pb-10 @min-[420px]/chat:px-4 @min-[420px]/chat:pt-5 @min-[640px]/chat:px-6"
        >
          {turns.map((turn, idx) => (
            <TurnView
              key={turn.id}
              turn={turn}
              fileChangesSnapshot={
                idx === anchorSummaryInTurnIndex ? fileChangesSnapshot : null
              }
              onFileChangesUpdated={onFileChangesUpdated}
              onForked={onForked}
              onPinToggled={onPinToggled}
              onRetry={onRetryTurn}
              onRewind={onRewindTurn}
              onBackgroundTool={onBackgroundTool}
            />
          ))}

          {!isStreaming &&
            hasFileChanges &&
            anchorSummaryInTurnIndex === -1 &&
            fileChangesSnapshot && (
              <TurnFileSummaryCard
                snapshot={fileChangesSnapshot}
                sessionId={sessionId}
                onSnapshotUpdated={onFileChangesUpdated}
              />
            )}

          {pendingPermission && onPermissionDecision && (
            <ApprovalCard
              request={pendingPermission}
              queueCount={pendingPermissionQueueCount}
              isSubmitting={isPermissionSubmitting}
              onDecision={onPermissionDecision}
            />
          )}

          {pendingQuestion && onQuestionSubmit && (
            <ClarifyingQuestionCard
              question={pendingQuestion}
              onSubmitAnswer={onQuestionSubmit}
              onDismiss={onQuestionDismiss}
            />
          )}

          <div ref={bottomAnchorRef} />
        </div>
      </ScrollArea>

      {showScrollToBottom && (
        <div className="pointer-events-none relative -mt-8 mb-2 flex justify-center">
          <button
            type="button"
            data-testid="chat-scroll-to-bottom-btn"
            aria-label="Scroll to latest output"
            title={
              isStreaming
                ? "Jump to bottom & follow live stream"
                : "Scroll to bottom"
            }
            onClick={() => {
              // Immediately snap & re-engage sticky live auto-follow so streaming
              // output keeps scrolling forever until the user manually scrolls up.
              scrollToBottom(isStreaming ? "auto" : "smooth");
            }}
            className="pointer-events-auto relative grid size-8 cursor-pointer place-items-center rounded-full border border-hairline-strong bg-popover-solid/95 text-body shadow-rayu-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
            {isStreaming && (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand"
              />
            )}
          </button>
        </div>
      )}

      {/* Unified Mid-Turn Steer & Queue Strip above composer */}
      {(() => {
        const stripItems: MidTurnMessageItem[] =
          midTurnMessages && midTurnMessages.length > 0
            ? midTurnMessages
            : softInterrupts.map((item) => ({
                id: item.id,
                sessionId: sessionId ?? "",
                mode: "steer" as const,
                text: item.text,
                createdAtMs: item.queuedAtMs,
              }));
        if (stripItems.length === 0) return null;
        let queueIndex = 0;
        const hasQueued = stripItems.some((item) => item.mode === "queue");
        return (
          <div
            data-testid="soft-interrupt-queue-strip"
            className="mx-auto mb-1.5 flex w-full max-w-[732px] min-w-0 flex-col gap-1 px-3 @min-[420px]/chat:px-4 @min-[640px]/chat:px-6"
          >
            {isQueuePaused && !isStreaming && hasQueued && (
              <div className="truncate px-1 text-[11px] text-muted-ink">
                Queue paused after stop — send or edit queued items below
              </div>
            )}
            {stripItems.map((item) => {
              const isSteer = item.mode === "steer";
              if (!isSteer) {
                queueIndex += 1;
              }
              const currentQueueRank = queueIndex;
              const handleCancel = () => {
                if (onCancelMidTurnMessage) {
                  onCancelMidTurnMessage(item.id);
                } else {
                  onCancelSoftInterrupt?.(item.id);
                }
              };
              return (
                <div
                  key={item.id}
                  data-testid={`midturn-item-${item.id}`}
                  data-midturn-mode={item.mode}
                  className="flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-hairline bg-pane px-2.5 py-1.5 text-xs text-body"
                >
                  {isSteer ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand"
                      />
                      <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-text">
                        Steer
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-muted-ink @min-[420px]/chat:inline">
                        Auto-sending
                      </span>
                    </>
                  ) : (
                    <span className="shrink-0 rounded border border-hairline bg-inset px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-ink tabular-nums">
                      Queued #{currentQueueRank}
                    </span>
                  )}

                  <span className="min-w-0 flex-1 truncate text-ink">
                    {item.text}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    {!isSteer && isStreaming && onPromoteQueuedToSteer && (
                      <button
                        type="button"
                        data-testid={`promote-to-steer-${item.id}`}
                        title="Send as steer now without interrupting"
                        onClick={() => onPromoteQueuedToSteer(item.id)}
                        className="cursor-pointer rounded-md border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-text transition-colors hover:border-brand/50"
                      >
                        Steer
                      </button>
                    )}

                    {!isSteer && !isStreaming && onSendQueuedNow && (
                      <button
                        type="button"
                        data-testid={`send-queued-now-${item.id}`}
                        title="Send queued message now"
                        onClick={() => onSendQueuedNow(item.id)}
                        className="cursor-pointer rounded-md border border-premium bg-active px-1.5 py-0.5 text-[11px] font-medium text-ink transition-colors hover:border-brand hover:text-brand-text"
                      >
                        Send
                      </button>
                    )}

                    {onEditMidTurnMessage && (
                      <button
                        type="button"
                        data-testid={`edit-midturn-${item.id}`}
                        aria-label={
                          isSteer ? "Edit steer message" : "Edit queued message"
                        }
                        title="Edit in composer"
                        onClick={() => onEditMidTurnMessage(item.id)}
                        className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                      >
                        <Pencil className="size-3" aria-hidden="true" />
                        <span className="hidden @min-[460px]/chat:inline">
                          Edit
                        </span>
                      </button>
                    )}

                    {(onCancelMidTurnMessage || onCancelSoftInterrupt) && (
                      <button
                        type="button"
                        data-testid={`cancel-midturn-${item.id}`}
                        aria-label={
                          isSteer
                            ? "Cancel queued soft interrupt"
                            : "Remove queued message"
                        }
                        onClick={handleCancel}
                        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
