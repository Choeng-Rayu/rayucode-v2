import * as React from "react";
import {
  ArrowDown,
  ChevronDown,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  List,
  Presentation,
  RotateCcw,
  X,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ScrollArea,
  TechFileBadge,
} from "@/components/ui";
import { cn, postToHost, useAppStore } from "@/lib";
import type {
  FileChangesSnapshotView,
  SessionSummaryView,
} from "@shared/vscodeProtocol";

import type {
  ChatTurnView,
  SoftInterruptQueueItem,
} from "../hooks/useChatStream";
import { ApprovalCard, type ApprovalCardRequest } from "./ApprovalCard";
import { CiteLink } from "./CiteLink";
import {
  ClarifyingQuestionCard,
  type ClarifyingQuestionRequest,
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
  const hasFileSummary = Boolean(
    fileChangesSnapshot && fileChangesSnapshot.files.length > 0,
  );
  const hasPrimaryDiff =
    !hasFileSummary && Boolean(turn.diffCard && turn.diffCard.lines.length > 0);

  return (
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
      <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
        {turn.userRefFiles && (
          <button
            type="button"
            data-slot="user-ref-pill"
            onClick={() => {
              const cleanPath = turn.userRefFiles!.split(":")[0] ?? turn.userRefFiles!;
              postToHost({
                type: "rayucode.editor.openFile",
                path: cleanPath,
              });
            }}
            className="inline-flex max-w-[340px] cursor-pointer items-center gap-1.5 rounded-[9px] border border-hairline bg-pane px-2.5 py-1 text-xs text-body transition-colors hover:border-premium hover:text-ink"
          >
            <TechFileBadge
              path={turn.userRefFiles.split(":")[0] ?? turn.userRefFiles}
              className="size-3.5"
            />
            <span className="truncate font-mono text-[11.5px]">
              {turn.userRefFiles}
            </span>
          </button>
        )}

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
              className="rayu-prose max-w-full rounded-2xl bg-active/85 px-4 py-2.5 text-[14px] leading-[1.6] text-ink whitespace-pre-wrap"
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
        {(turn.isLive ||
          turn.notes.length > 0 ||
          turn.groups.length > 0) && (
          <WorkTrace
            workedDuration={turn.workedDuration}
            isLive={turn.isLive}
            connectionPhaseLabel={turn.connectionPhaseLabel}
            notes={turn.notes}
            groups={turn.groups}
            activeToolStatus={turn.activeToolStatus}
            showLiveBackgroundPill={turn.showLiveBackgroundPill}
            sessionId={turn.sessionId}
            onBackgroundTool={onBackgroundTool}
          />
        )}

        {hasAnswer && (
          <div
            data-slot="agent-answer"
            className="flex min-w-0 flex-col gap-3 text-[14px] leading-[1.64] break-words text-body"
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
              <ol className="rayu-prose m-0 flex max-w-[72ch] list-decimal flex-col gap-2.5 pl-5 text-body marker:font-medium marker:text-muted-ink">
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
                className="flex min-w-0 items-center justify-between gap-3 rounded-[14px] border border-hairline bg-raised px-3.5 py-2.5 shadow-bevel-surface"
              >
                <button
                  type="button"
                  onClick={() => {
                    useAppStore
                      .getState()
                      .openRightTab("artifacts", artifact.pillLabel);
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
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

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="artifact-open-trigger"
                      className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hairline-strong bg-inset px-3 text-xs font-medium text-ink transition-colors hover:bg-hover"
                    >
                      <span>Open</span>
                      <ChevronDown
                        className="size-3.5 text-muted-ink"
                        aria-hidden="true"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem
                      onClick={() =>
                        useAppStore
                          .getState()
                          .openRightTab("artifacts", artifact.pillLabel)
                      }
                    >
                      <span>Open in Right Inspector</span>
                    </DropdownMenuItem>
                    {artifact.filePath && (
                      <DropdownMenuItem
                        onClick={() =>
                          postToHost({
                            type: "rayucode.editor.openFile",
                            path: artifact.filePath!,
                          })
                        }
                      >
                        <ExternalLink
                          className="mr-2 size-3.5"
                          aria-hidden="true"
                        />
                        <span>Open in VS Code Editor</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}

        {fileChangesSnapshot && fileChangesSnapshot.files.length > 0 && (
          <TurnFileSummaryCard
            snapshot={fileChangesSnapshot}
            sessionId={turn.sessionId}
            onSnapshotUpdated={onFileChangesUpdated}
          />
        )}

        {!turn.isLive && (
          <TurnActions
            sessionId={turn.sessionId}
            turnId={turn.id}
            responseMarkdown={responseMarkdown}
            timestamp={turn.timestamp}
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
  );
}

export interface ChatStreamProps {
  sessionId?: string;
  turns: ChatTurnView[];
  isStreaming?: boolean;
  fileChangesSnapshot?: FileChangesSnapshotView | null;
  onFileChangesUpdated?: (snapshot: FileChangesSnapshotView) => void;
  pendingPermission?: ApprovalCardRequest | null;
  pendingQuestion?: ClarifyingQuestionRequest | null;
  softInterrupts?: SoftInterruptQueueItem[];
  rewoundTurnId?: string | null;
  onPermissionDecision?: (
    decision: "allow_once" | "allow_always" | "deny",
    request: ApprovalCardRequest,
  ) => void;
  onQuestionSubmit?: (
    answers: Record<string, string>,
    notes?: Record<string, string>,
  ) => void;
  onQuestionDismiss?: () => void;
  onCancelSoftInterrupt?: (interruptId?: string) => void;
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
  pendingQuestion,
  softInterrupts = [],
  rewoundTurnId,
  onPermissionDecision,
  onQuestionSubmit,
  onQuestionDismiss,
  onCancelSoftInterrupt,
  onRewindTurn,
  onUndoRewind,
  onBackgroundTool,
  onForked,
  onPinToggled,
  onRetryTurn,
  className,
  ref,
}: ChatStreamProps) {
  const bottomAnchorRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (typeof bottomAnchorRef.current?.scrollIntoView === "function") {
      bottomAnchorRef.current.scrollIntoView({ block: "end" });
    }
  }, [turns.length]);

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

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div
          data-slot="stream-container"
          className="mx-auto flex w-full max-w-[732px] min-w-0 flex-col gap-6 px-4 pt-5 pb-10 @min-[640px]/app:px-6"
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

          {hasFileChanges &&
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

      {isStreaming && (
        <div className="pointer-events-none relative -mt-8 mb-2 flex justify-center">
          <button
            type="button"
            aria-label="Scroll to latest output"
            onClick={() => {
              if (
                typeof bottomAnchorRef.current?.scrollIntoView === "function"
              ) {
                bottomAnchorRef.current.scrollIntoView({
                  behavior: "smooth",
                  block: "end",
                });
              }
            }}
            className="pointer-events-auto grid size-8 cursor-pointer place-items-center rounded-full border border-hairline-strong bg-popover-solid/95 text-body shadow-rayu-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* SoftInterruptQueueStrip above composer when user queues follow-up instructions mid-turn */}
      {softInterrupts.length > 0 && (
        <div
          data-testid="soft-interrupt-queue-strip"
          className="mx-auto mb-1.5 flex w-full max-w-[732px] flex-col gap-1 px-4 @min-[640px]/app:px-6"
        >
          {softInterrupts.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-pane px-3 py-1.5 text-xs text-body"
            >
              <span className="truncate">
                <strong className="font-medium text-ink">Queued steer:</strong>{" "}
                {item.text}
              </span>
              {onCancelSoftInterrupt && (
                <button
                  type="button"
                  aria-label="Cancel queued soft interrupt"
                  onClick={() => onCancelSoftInterrupt(item.id)}
                  className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
