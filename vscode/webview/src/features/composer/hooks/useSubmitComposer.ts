import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionSummaryView } from "@shared/vscodeProtocol";
import {
  chatHistoryQueryKey,
  startSessionLiveTurn,
  useLiveTraceStore,
  type ChatTurnView,
} from "@/features/chat";
import { callRpc, submitHarnessMessage, useAppStore } from "@/lib";
import type { ComposerSubmitPayload } from "../types";

interface SubmitTarget {
  sessionId?: string;
  fromDraft?: boolean;
  shouldContinue?: () => boolean;
}

export function useSubmitComposer() {
  const queryClient = useQueryClient();
  const retryDraft = React.useRef<SessionSummaryView | undefined>(undefined);
  const inFlight = React.useRef(new Set<string>());
  return React.useCallback(async (payload: ComposerSubmitPayload, target?: SubmitTarget) => {
    const state = useAppStore.getState();
    const draft = target?.fromDraft ? state.activeDraft : undefined;
    let sessionId = target?.sessionId ?? (target?.fromDraft ? undefined : state.activeSessionId ?? undefined);
    const submitKey = sessionId ?? "__draft__";
    if (inFlight.current.has(submitKey)) throw new Error("A prompt is already being submitted to this session.");
    inFlight.current.add(submitKey);
    const workingDir = payload.workingDir ?? draft?.workingDir ?? undefined;
    const permissionMode = payload.permissionMode ?? state.defaultPermissionMode;
    const model = payload.modelSpec || payload.modelId || undefined;
    let created: SessionSummaryView | undefined;
    try {
      if (!sessionId) {
        if (retryDraft.current && (!workingDir || retryDraft.current.workingDir === workingDir)) {
          created = retryDraft.current;
        } else {
          const result = await callRpc("sessions.create", {
            workingDir,
            permissionMode,
            model,
            apiMethod: payload.apiMethod,
            effort: payload.effort,
            deferSettings: true,
          });
          created = result.session;
          retryDraft.current = created;
        }
        sessionId = created.sessionId;
      }
      if (target?.shouldContinue?.() === false) return;

      const selected = payload.editorSelection;
      const selectionContext = selected
        ? `\n\n[Active Editor Selection: ${selected.relativePath}#L${selected.lineStart}-L${selected.lineEnd}]`
        : "";
      const history = queryClient.getQueryData<ChatTurnView[]>(chatHistoryQueryKey(sessionId)) ?? [];
      const settled = useLiveTraceStore.getState().completedTurnsBySession[sessionId] ?? [];
      const nextSlot = settled.reduce(
        (count, turn) => Math.max(count, (turn.baseHistoryTurnCount ?? -1) + 1),
        settled.length,
      );
      startSessionLiveTurn({
        sessionId,
        userPrompt: payload.prompt,
        userRefFiles: selected ? `${selected.relativePath}:${selected.lineStart}-${selected.lineEnd}` : undefined,
        userImages: payload.images?.map((image) => ({ name: image.name ?? "Attachment", dataUrl: image.data })),
        startedAtMs: Date.now(),
        baseHistoryTurnCount: Math.max(history.length, nextSlot),
      });
      if (useAppStore.getState().activeSessionId === sessionId) state.setIsStreamActive(true);
      await submitHarnessMessage({
        req: "send_message",
        session_id: sessionId,
        content: payload.prompt + selectionContext,
        model,
        api_method: payload.apiMethod,
        effort: payload.effort,
        permission_mode: permissionMode,
        service_tier: payload.serviceTier,
        images: payload.images,
      });

      state.setSessionPrefs(sessionId, {
        modelId: model,
        modelLabel: payload.modelLabel,
        apiMethod: payload.apiMethod,
        effort: payload.effort,
        permissionMode,
        serviceTier: payload.serviceTier,
        cacheTtl: payload.cacheTtl,
      });
      if (created) {
        retryDraft.current = undefined;
        if (target?.shouldContinue?.() !== false && useAppStore.getState().activeRoute === "home") {
          state.setActiveSession(sessionId, created.title);
        }
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        void queryClient.invalidateQueries({ queryKey: ["workspace", "ledger"] });
      }
      return created;
    } catch (error) {
      if (sessionId === useAppStore.getState().activeSessionId) state.setIsStreamActive(false);
      if (sessionId) void queryClient.invalidateQueries({ queryKey: chatHistoryQueryKey(sessionId) });
      throw error;
    } finally {
      inFlight.current.delete(submitKey);
    }
  }, [queryClient]);
}
