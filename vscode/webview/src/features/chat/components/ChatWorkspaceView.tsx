import * as React from "react";

import { ChatSkeleton, SectionErrorBoundary } from "@/components/ui";
import { cn } from "@/lib";

import { useChatStream, type ChatTurnView } from "../hooks/useChatStream";
import type { ApprovalCardRequest } from "./ApprovalCard";
import { ChatStream } from "./ChatStream";
import type { ClarifyingQuestionRequest } from "./ClarifyingQuestionCard";

export interface ChatWorkspaceViewProps {
  sessionId?: string | null;
  initialTurns?: ChatTurnView[];
  pendingPermissionOverride?: ApprovalCardRequest | null;
  pendingQuestionOverride?: ClarifyingQuestionRequest | null;
  backgroundDockSlot?: React.ReactNode;
  composerSlot?: React.ReactNode;
  className?: string;
}

export function ChatWorkspaceView({
  sessionId,
  initialTurns,
  pendingPermissionOverride,
  pendingQuestionOverride,
  backgroundDockSlot,
  composerSlot,
  className,
}: ChatWorkspaceViewProps) {
  const stream = useChatStream({
    sessionId,
    initialTurns,
  });

  const effectivePermission =
    pendingPermissionOverride !== undefined
      ? pendingPermissionOverride
      : stream.pendingPermission;

  const effectiveQuestion =
    pendingQuestionOverride !== undefined
      ? pendingQuestionOverride
      : stream.pendingQuestion;

  return (
    <SectionErrorBoundary title="Chat workspace failed to render">
      <React.Suspense fallback={<ChatSkeleton />}>
        <div
          data-slot="chat-workspace-view"
          data-testid="chat-workspace-view"
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-canvas",
            className,
          )}
        >
          <ChatStream
            sessionId={stream.sessionId}
            turns={stream.turns}
            isStreaming={stream.isStreaming}
            fileChangesSnapshot={stream.fileChangesSnapshot}
            onFileChangesUpdated={stream.setFileChangesSnapshot}
            pendingPermission={effectivePermission}
            pendingQuestion={effectiveQuestion}
            softInterrupts={stream.softInterrupts}
            rewoundTurnId={stream.rewoundTurnId}
            onPermissionDecision={(decision, req) => {
              void stream.respondPermission(decision, req);
            }}
            onQuestionSubmit={(answers, notes) => {
              void stream.respondQuestion(answers, notes);
            }}
            onQuestionDismiss={stream.dismissQuestion}
            onCancelSoftInterrupt={(id) => {
              void stream.cancelSoftInterrupt(id);
            }}
            onRewindTurn={(turnId) => {
              void stream.rewindToTurn(turnId);
            }}
            onUndoRewind={() => {
              void stream.undoRewind();
            }}
            onBackgroundTool={() => {
              void stream.backgroundActiveTool();
            }}
            onPinToggled={stream.togglePinTurn}
            onRetryTurn={stream.retryTurn}
          />

          {backgroundDockSlot && (
            <div
              data-slot="chat-background-dock-slot"
              className="mx-auto w-full max-w-[732px] shrink-0 px-4 @min-[640px]/app:px-6"
            >
              {backgroundDockSlot}
            </div>
          )}

          {composerSlot && (
            <div
              data-slot="chat-composer-slot"
              className="mx-auto w-full max-w-[732px] shrink-0 px-4 pb-3 @min-[640px]/app:px-6"
            >
              {composerSlot}
            </div>
          )}
        </div>
      </React.Suspense>
    </SectionErrorBoundary>
  );
}
