import * as React from "react";
import { TaskChecklistCard } from "@rayu-dev/rayucode-ui/tasks";
import { useQueryClient } from "@tanstack/react-query";

import { ChatSkeleton, SectionErrorBoundary } from "@/components/ui";
import { callRpc, cn, useAppStore, type MidTurnMessageItem } from "@/lib";

import { useChatStream, type ChatTurnView } from "../hooks/useChatStream";
import type { ApprovalCardRequest } from "./ApprovalCard";
import { ChatStream } from "./ChatStream";
import type { ClarifyingQuestionRequest } from "./ClarifyingQuestionCard";

export interface ChatWorkspaceViewProps {
  sessionId?: string | null;
  initialTurns?: ChatTurnView[];
  pendingPermissionOverride?: ApprovalCardRequest | null;
  pendingQuestionOverride?: ClarifyingQuestionRequest | null;
  onDrainQueuedMessage?: (item: MidTurnMessageItem) => void | Promise<void>;
  backgroundDockSlot?: React.ReactNode;
  composerSlot?: React.ReactNode;
  className?: string;
}

export function ChatWorkspaceView({
  sessionId,
  initialTurns,
  pendingPermissionOverride,
  pendingQuestionOverride,
  onDrainQueuedMessage,
  backgroundDockSlot,
  composerSlot,
  className,
}: ChatWorkspaceViewProps) {
  const queryClient = useQueryClient();
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const stream = useChatStream({
    sessionId,
    initialTurns,
    onDrainQueuedMessage,
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
            pendingPermissionQueueCount={
              pendingPermissionOverride !== undefined
                ? pendingPermissionOverride
                  ? 1
                  : 0
                : stream.pendingPermissionQueueCount
            }
            isPermissionSubmitting={stream.isPermissionSubmitting}
            pendingQuestion={effectiveQuestion}
            softInterrupts={stream.softInterrupts}
            midTurnMessages={stream.midTurnMessages}
            isQueuePaused={stream.isQueuePaused}
            rewoundTurnId={stream.rewoundTurnId}
            onPermissionDecision={(decision, req) => {
              void stream.respondPermission(decision, req);
            }}
            onQuestionSubmit={(answers, notes, meta) => {
              void stream.respondQuestion(answers, notes, meta);
            }}
            onQuestionDismiss={stream.dismissQuestion}
            onForked={(forked) => {
              void callRpc("sessions.attach", {
                sessionId: forked.sessionId,
              }).catch(() => {});
              setActiveSession(forked.sessionId, forked.title);
              void queryClient.invalidateQueries({ queryKey: ["sessions"] });
            }}
            onCancelSoftInterrupt={(id) => {
              void stream.cancelSoftInterrupt(id);
            }}
            onPromoteQueuedToSteer={(id) => {
              void stream.promoteQueuedToSteer(id);
            }}
            onEditMidTurnMessage={(id) => {
              void stream.editMidTurnMessage(id);
            }}
            onSendQueuedNow={(id) => {
              void stream.sendQueuedNow(id);
            }}
            onCancelMidTurnMessage={(id) => {
              void stream.cancelMidTurnMessage(id);
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

          {stream.todos.length > 0 && (
            <div
              data-slot="chat-tasks-dock-slot"
              className="mx-auto w-full max-w-[732px] shrink-0 px-4 pb-2 @min-[640px]/app:px-6"
            >
              <TaskChecklistCard
                sessionId={stream.sessionId}
                todos={stream.todos}
              />
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
