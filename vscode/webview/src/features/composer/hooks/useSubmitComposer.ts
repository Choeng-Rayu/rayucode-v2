import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionSummaryView } from "@shared/vscodeProtocol";
import {
  chatHistoryQueryKey,
  clearSessionLiveTurn,
  startSessionLiveTurn,
  useLiveTraceStore,
  type ChatTurnView,
} from "@/features/chat";
import {
  callRpc,
  requestHarnessAck,
  useAppStore,
  type SessionComposerPrefs,
} from "@/lib";
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
    let liveTurnStarted = false;
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

      const currentAckPrefs = useAppStore.getState().sessionPrefsBySession[sessionId] ?? {};
      const pendingPatch: Partial<SessionComposerPrefs> = {};
      if (model !== undefined && model !== currentAckPrefs.modelId) {
        pendingPatch.modelId = model;
        if (payload.modelLabel) pendingPatch.modelLabel = payload.modelLabel;
        if (payload.apiMethod) pendingPatch.apiMethod = payload.apiMethod;
      }
      if (payload.effort !== undefined && payload.effort !== currentAckPrefs.effort) {
        pendingPatch.effort = payload.effort;
      }
      if (permissionMode !== undefined && permissionMode !== currentAckPrefs.permissionMode) {
        pendingPatch.permissionMode = permissionMode;
      }
      if (
        payload.serviceTier !== undefined &&
        payload.serviceTier !== currentAckPrefs.serviceTier
      ) {
        pendingPatch.serviceTier = payload.serviceTier;
      }
      if (Object.keys(pendingPatch).length > 0) {
        state.setPendingSessionPrefs(sessionId, pendingPatch);
      }

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
      liveTurnStarted = true;
      if (useAppStore.getState().activeSessionId === sessionId) state.setIsStreamActive(true);
      await requestHarnessAck({
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
      });
      state.clearPendingSessionPrefs(sessionId);
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
      if (liveTurnStarted && sessionId) {
        clearSessionLiveTurn(sessionId);
      }
      if (sessionId === useAppStore.getState().activeSessionId) state.setIsStreamActive(false);
      if (sessionId) void queryClient.invalidateQueries({ queryKey: chatHistoryQueryKey(sessionId) });
      throw error;
    } finally {
      inFlight.current.delete(submitKey);
    }
  }, [queryClient]);
}
