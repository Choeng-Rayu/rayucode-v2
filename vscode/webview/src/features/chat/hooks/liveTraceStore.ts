import * as React from "react";
import { shouldClearStaleLiveTurn } from "@rayu-dev/rayucode-session-core/client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import {
  createHarnessStreamTracker,
  createStreamBatcher,
  formatDurationSeconds,
  mapHarnessFrameToLiveEvents,
  onHarnessFrame,
  useAppStore,
  type HarnessStreamTracker,
  type InlineDiffCardData,
  type MappedLiveTraceEvent,
  type OptimisticUserTurn,
  type StreamBatcher,
} from "@/lib";

import type { ClarifyingQuestionRequest } from "../components/ClarifyingQuestionCard";
import type { ChatTurnView } from "./useChatStream";

const FRAME_BATCH_WINDOW_MS = 16;

const EMPTY_DIFF: InlineDiffCardData = {
  id: "diff_live_empty",
  file: "",
  additions: 0,
  deletions: 0,
  hint: "",
  lines: [],
};

export function chatHistoryQueryKey(sessionId: string) {
  return ["chat", "history", sessionId] as const;
}

export interface StartSessionLiveTurnInput {
  sessionId: string;
  userPrompt: string;
  userRefFiles?: string;
  userImages?: Array<{ name: string; dataUrl: string }>;
  startedAtMs?: number;
  baseHistoryTurnCount?: number;
}

interface LiveTraceStoreState {
  liveTurnsBySession: Record<string, ChatTurnView>;
  completedTurnsBySession: Record<string, ChatTurnView[]>;
  pendingQuestionsBySession: Record<string, ClarifyingQuestionRequest | null>;
  baseHistoryTurnCountBySession: Record<string, number>;
  lastEventAtMsBySession: Record<string, number>;
}

export const useLiveTraceStore = create<LiveTraceStoreState>(() => ({
  liveTurnsBySession: {},
  completedTurnsBySession: {},
  pendingQuestionsBySession: {},
  baseHistoryTurnCountBySession: {},
  lastEventAtMsBySession: {},
}));

const trackersBySession = new Map<string, HarnessStreamTracker>();
const batchersBySession = new Map<string, StreamBatcher<MappedLiveTraceEvent>>();
const startedAtBySession = new Map<string, number>();
const completedTurnIds = new Set<string>();
let turnSequence = 1;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let controllerMountCount = 0;

function stopElapsedTimerIfIdle(): void {
  if (!elapsedTimer) return;
  const hasLive = Object.values(
    useLiveTraceStore.getState().liveTurnsBySession,
  ).some((turn) => turn.isLive);
  if (!hasLive) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function ensureElapsedTimer(): void {
  if (elapsedTimer) return;
  elapsedTimer = setInterval(() => {
    const state = useLiveTraceStore.getState();
    const entries = Object.entries(state.liveTurnsBySession);
    if (entries.length === 0) {
      stopElapsedTimerIfIdle();
      return;
    }
    let changed = false;
    const nextMap: Record<string, ChatTurnView> = { ...state.liveTurnsBySession };
    for (const [sid, turn] of entries) {
      if (!turn.isLive) continue;
      const startedAt = startedAtBySession.get(sid) ?? Date.now();
      const nextSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      const formatted = formatDurationSeconds(nextSec);
      if (turn.workedDuration !== formatted) {
        nextMap[sid] = { ...turn, workedDuration: formatted };
        changed = true;
      }
    }
    if (changed) {
      useLiveTraceStore.setState({ liveTurnsBySession: nextMap });
    }
    stopElapsedTimerIfIdle();
  }, 1000);
}

function getOrCreateTracker(sessionId: string): HarnessStreamTracker {
  let tracker = trackersBySession.get(sessionId);
  if (!tracker) {
    tracker = createHarnessStreamTracker();
    trackersBySession.set(sessionId, tracker);
  }
  return tracker;
}

export function applyTraceEvents(
  current: ChatTurnView | null,
  events: MappedLiveTraceEvent[],
): ChatTurnView | null {
  if (!current || events.length === 0) return current;

  let next: ChatTurnView = {
    ...current,
    notes: [...current.notes],
    groups: current.groups.map((g) => ({ ...g, steps: [...g.steps] })),
    timeline: current.timeline
      ? current.timeline.map((entry) =>
          entry.type === "group"
            ? {
                type: "group",
                group: { ...entry.group, steps: [...entry.group.steps] },
              }
            : { ...entry },
        )
      : [],
    artifacts: current.artifacts ? [...current.artifacts] : undefined,
  };

  for (const ev of events) {
    switch (ev.type) {
      case "reasoning-delta": {
        if (!ev.delta) break;
        const timeline = next.timeline ?? [];
        const last = timeline[timeline.length - 1];
        if (last && last.type === "reasoning") {
          timeline[timeline.length - 1] = {
            ...last,
            text: `${last.text}${ev.delta}`,
          };
        } else {
          timeline.push({
            type: "reasoning",
            id: `reasoning_${timeline.length + 1}`,
            text: ev.delta,
          });
        }
        next.timeline = timeline;
        break;
      }
      case "note":
        next.notes.push(ev.text);
        next.timeline?.push({
          type: "note",
          id: `note_${next.timeline.length + 1}`,
          text: ev.text,
        });
        break;
      case "promote-note": {
        const pendingText = next.answerIntro.trim();
        if (pendingText) {
          next.notes.push(pendingText);
          next.timeline?.push({
            type: "note",
            id: `note_${next.timeline.length + 1}`,
            text: pendingText,
          });
          next.answerIntro = "";
        }
        break;
      }
      case "tool-status":
        next.activeToolStatus = ev.label;
        next.showLiveBackgroundPill = Boolean(
          ev.label &&
            /running command|cargo|npm|pnpm|pytest|bash|shell/i.test(ev.label),
        );
        break;
      case "step": {
        const gId =
          ev.groupId ?? next.groups[next.groups.length - 1]?.id ?? "wg_live";
        const gTitle = ev.groupTitle ?? "Read files, ran commands";
        const idx = next.groups.findIndex((g) => g.id === gId);
        if (idx === -1) {
          const created = { id: gId, title: gTitle, steps: [ev.step] };
          next.groups.push(created);
          next.timeline?.push({
            type: "group",
            group: { ...created, steps: [...created.steps] },
          });
        } else {
          const existing = next.groups[idx]!;
          const updated = {
            ...existing,
            title: ev.groupTitle ?? existing.title,
            steps: [...existing.steps, ev.step],
          };
          next.groups[idx] = updated;
          if (next.timeline) {
            const tlIdx = next.timeline.findIndex(
              (entry) => entry.type === "group" && entry.group.id === gId,
            );
            if (tlIdx !== -1) {
              next.timeline[tlIdx] = {
                type: "group",
                group: { ...updated, steps: [...updated.steps] },
              };
            }
          }
        }
        break;
      }
      case "artifact":
        next.artifacts = [...(next.artifacts ?? []), ev.artifact];
        break;
      case "answer-delta":
        next.answerIntro = `${next.answerIntro}${ev.delta}`;
        break;
      case "duration":
        next.workedDuration = ev.workedDuration;
        break;
      case "complete":
        next = {
          ...next,
          isLive: false,
          activeToolStatus: null,
          showLiveBackgroundPill: false,
          workedDuration: ev.workedDuration || next.workedDuration,
          credits: ev.credits ?? next.credits,
          kvCachePct: ev.kvCachePct ?? next.kvCachePct,
          timestamp: ev.timestamp ?? "Just now",
        };
        break;
      default:
        break;
    }
  }

  return next;
}

export function startSessionLiveTurn(
  input: StartSessionLiveTurnInput,
): ChatTurnView {
  const startedAt =
    typeof input.startedAtMs === "number" && input.startedAtMs > 0
      ? input.startedAtMs
      : Date.now();
  startedAtBySession.set(input.sessionId, startedAt);
  const tracker = getOrCreateTracker(input.sessionId);
  tracker.startedAtMs = startedAt;
  tracker.turnActive = true;
  tracker.turnCompleted = false;
  tracker.batchEpoch = 1;
  tracker.hasStreamedTextInPhase = false;
  tracker.phaseHasReads = false;
  tracker.phaseHasCommands = false;
  tracker.phaseHasSearches = false;
  tracker.phaseCommandCount = 0;
  tracker.toolInputs.clear();

  const turn: ChatTurnView = {
    id: `live_turn_${Date.now()}_${turnSequence++}`,
    sessionId: input.sessionId,
    userPrompt: input.userPrompt,
    userRefFiles: input.userRefFiles,
    userImages: input.userImages,
    workedDuration: formatDurationSeconds(
      Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
    ),
    isLive: true,
    notes: [],
    groups: [],
    timeline: [],
    activeToolStatus: null,
    answerIntro: "",
    answerBullets: [],
    diffCard: EMPTY_DIFF,
    timestamp: "Just now",
    credits: "0.00 cr",
    kvCachePct: 94,
    pinned: false,
  };

  useLiveTraceStore.setState((state) => {
    const nextBaseCounts = { ...state.baseHistoryTurnCountBySession };
    if (
      typeof input.baseHistoryTurnCount === "number" &&
      input.baseHistoryTurnCount >= 0
    ) {
      nextBaseCounts[input.sessionId] = input.baseHistoryTurnCount;
    }
    return {
      liveTurnsBySession: {
        ...state.liveTurnsBySession,
        [input.sessionId]: turn,
      },
      baseHistoryTurnCountBySession: nextBaseCounts,
      lastEventAtMsBySession: {
        ...state.lastEventAtMsBySession,
        [input.sessionId]: Date.now(),
      },
    };
  });
  ensureElapsedTimer();
  return turn;
}

export function startLiveTurnFromOptimistic(
  turn: OptimisticUserTurn,
): ChatTurnView {
  return startSessionLiveTurn({
    sessionId: turn.sessionId,
    userPrompt: turn.prompt,
    userRefFiles: turn.refFiles,
    userImages: turn.images,
    startedAtMs: turn.createdAtMs,
    baseHistoryTurnCount: turn.baseHistoryTurnCount,
  });
}

export function setSessionPendingQuestion(
  sessionId: string,
  question: ClarifyingQuestionRequest | null,
): void {
  if (!sessionId) return;
  useLiveTraceStore.setState((state) => ({
    pendingQuestionsBySession: {
      ...state.pendingQuestionsBySession,
      [sessionId]: question,
    },
  }));
}

export function toggleCompletedTurnPin(
  sessionId: string,
  turnId: string,
  pinned: boolean,
): void {
  if (!sessionId) return;
  useLiveTraceStore.setState((state) => {
    const existing = state.completedTurnsBySession[sessionId];
    if (!existing) return state;
    return {
      completedTurnsBySession: {
        ...state.completedTurnsBySession,
        [sessionId]: existing.map((t) =>
          t.id === turnId ? { ...t, pinned } : t,
        ),
      },
    };
  });
}

export function clearSessionLiveTurn(sessionId: string): void {
  if (!sessionId) return;
  const batcher = batchersBySession.get(sessionId);
  if (batcher) {
    batcher.dispose();
    batchersBySession.delete(sessionId);
  }
  startedAtBySession.delete(sessionId);
  trackersBySession.delete(sessionId);
  useLiveTraceStore.setState((state) => {
    const hasLive = sessionId in state.liveTurnsBySession;
    const hasBase = sessionId in state.baseHistoryTurnCountBySession;
    const hasLast = sessionId in state.lastEventAtMsBySession;
    if (!hasLive && !hasBase && !hasLast) return state;
    const nextLive = { ...state.liveTurnsBySession };
    const nextBase = { ...state.baseHistoryTurnCountBySession };
    const nextLast = { ...state.lastEventAtMsBySession };
    delete nextLive[sessionId];
    delete nextBase[sessionId];
    delete nextLast[sessionId];
    return {
      liveTurnsBySession: nextLive,
      baseHistoryTurnCountBySession: nextBase,
      lastEventAtMsBySession: nextLast,
    };
  });
  stopElapsedTimerIfIdle();
}

export function reconcileStaleLiveTurnForSession(
  sessionId: string,
  sessionStatus: string | null | undefined,
  options?: { nowMs?: number; gracePeriodMs?: number },
): boolean {
  if (!sessionId) return false;
  const state = useLiveTraceStore.getState();
  const liveTurn = state.liveTurnsBySession[sessionId];
  if (!liveTurn) return false;
  const lastEventAtMs =
    state.lastEventAtMsBySession[sessionId] ??
    startedAtBySession.get(sessionId) ??
    0;
  const stale = shouldClearStaleLiveTurn({
    liveTurn: {
      id: liveTurn.id,
      userPrompt: liveTurn.userPrompt,
      answerMarkdown: liveTurn.answerIntro,
      isLive: liveTurn.isLive,
      workGroups: liveTurn.groups,
    },
    sessionStatus,
    lastEventAtMs,
    nowMs: options?.nowMs,
    gracePeriodMs: options?.gracePeriodMs,
  });
  if (stale) {
    clearSessionLiveTurn(sessionId);
    return true;
  }
  return false;
}

export function reconcileStaleLiveTurnsFromSessions(
  sessions: readonly { sessionId: string; status?: string | null }[],
  options?: { nowMs?: number; gracePeriodMs?: number },
): string[] {
  const cleared: string[] = [];
  for (const session of sessions) {
    if (
      reconcileStaleLiveTurnForSession(
        session.sessionId,
        session.status,
        options,
      )
    ) {
      cleared.push(session.sessionId);
    }
  }
  return cleared;
}

export function resetAllLiveTraces(): void {
  for (const batcher of batchersBySession.values()) {
    batcher.dispose();
  }
  batchersBySession.clear();
  trackersBySession.clear();
  startedAtBySession.clear();
  completedTurnIds.clear();
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  useLiveTraceStore.setState({
    liveTurnsBySession: {},
    completedTurnsBySession: {},
    pendingQuestionsBySession: {},
    baseHistoryTurnCountBySession: {},
    lastEventAtMsBySession: {},
  });
}

function getOrCreateBatcher(
  sessionId: string,
  queryClient: QueryClient,
): StreamBatcher<MappedLiveTraceEvent> {
  const existing = batchersBySession.get(sessionId);
  if (existing) return existing;

  const batcher = createStreamBatcher<MappedLiveTraceEvent>((events) => {
    const current =
      useLiveTraceStore.getState().liveTurnsBySession[sessionId] ?? null;
    const updated = applyTraceEvents(current, events);
    if (!updated) return;

    const hasComplete = events.some((ev) => ev.type === "complete");
    if (hasComplete) {
      if (!completedTurnIds.has(updated.id)) {
        completedTurnIds.add(updated.id);
        useLiveTraceStore.setState((state) => {
          const prevCompleted = state.completedTurnsBySession[sessionId] ?? [];
          return {
            completedTurnsBySession: {
              ...state.completedTurnsBySession,
              [sessionId]: prevCompleted.some((t) => t.id === updated.id)
                ? prevCompleted
                : [...prevCompleted, updated],
            },
          };
        });
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        void queryClient.invalidateQueries({
          queryKey: chatHistoryQueryKey(sessionId),
        });
      }
      const perm = useAppStore.getState().pendingPermission;
      if (perm && (!perm.sessionId || perm.sessionId === sessionId)) {
        useAppStore.getState().setPendingPermission(null);
      }
      clearSessionLiveTurn(sessionId);
      return;
    }

    useLiveTraceStore.setState((state) => ({
      liveTurnsBySession: {
        ...state.liveTurnsBySession,
        [sessionId]: updated,
      },
      lastEventAtMsBySession: {
        ...state.lastEventAtMsBySession,
        [sessionId]: Date.now(),
      },
    }));
  }, FRAME_BATCH_WINDOW_MS);

  batchersBySession.set(sessionId, batcher);
  return batcher;
}

export function processHarnessFrame(
  frame: Record<string, unknown>,
  queryClient: QueryClient,
  fallbackSessionId?: string,
): void {
  const frameSession =
    typeof frame.session_id === "string" ? frame.session_id : "";
  const targetSessionId = frameSession || fallbackSessionId || "";
  if (!targetSessionId) return;

  if (frame.ev === "question_request" || frame.ev === "ask_user_question") {
    const reqId = String(frame.request_id ?? `q_${Date.now()}`);
    const prompt = String(
      frame.prompt ?? frame.question ?? "How would you like to proceed?",
    );
    const rawOpts = Array.isArray(frame.options) ? frame.options : [];
    setSessionPendingQuestion(targetSessionId, {
      requestId: reqId,
      sessionId: targetSessionId,
      prompt,
      multiSelect: Boolean(frame.multi_select),
      options:
        rawOpts.length > 0
          ? rawOpts.map((o, idx) => {
              const obj =
                o && typeof o === "object"
                  ? (o as Record<string, unknown>)
                  : { title: String(o) };
              return {
                id: String(obj.id ?? `opt_${idx + 1}`),
                key: String(obj.key ?? idx + 1),
                title: String(obj.title ?? obj.label ?? `Option ${idx + 1}`),
                subtitle:
                  typeof obj.subtitle === "string"
                    ? obj.subtitle
                    : typeof obj.description === "string"
                      ? obj.description
                      : undefined,
                recommended: Boolean(obj.recommended),
              };
            })
          : [
              {
                id: "opt_1",
                key: "1",
                title: "Proceed with recommended defaults",
                recommended: true,
              },
              {
                id: "opt_2",
                key: "2",
                title: "Review changes step-by-step first",
              },
            ],
    });
    return;
  }

  const isTerminalFrame =
    frame.ev === "turn_done" ||
    frame.ev === "turn_stopped" ||
    frame.ev === "error";

  useLiveTraceStore.setState((state) => ({
    lastEventAtMsBySession: {
      ...state.lastEventAtMsBySession,
      [targetSessionId]: Date.now(),
    },
  }));

  const tracker = getOrCreateTracker(targetSessionId);
  const mapped = mapHarnessFrameToLiveEvents(frame, tracker);
  if (mapped.length === 0) {
    if (isTerminalFrame) {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({
        queryKey: chatHistoryQueryKey(targetSessionId),
      });
    }
    return;
  }

  const traceEvents: MappedLiveTraceEvent[] = [];
  for (const ev of mapped) {
    if (ev.type === "permission-request") {
      useAppStore.getState().setPendingPermission({
        sessionId: ev.sessionId || targetSessionId,
        requestId: ev.requestId,
        toolName: ev.toolName,
        description: ev.description,
        riskTier: ev.riskTier,
      });
    } else {
      traceEvents.push(ev);
    }
  }

  if (traceEvents.length === 0) return;

  if (!useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]) {
    startSessionLiveTurn({
      sessionId: targetSessionId,
      userPrompt: "",
    });
  }

  const batcher = getOrCreateBatcher(targetSessionId, queryClient);
  for (const ev of traceEvents) {
    batcher.push(ev);
  }
  if (traceEvents.some((e) => e.type === "complete")) {
    batcher.flushNow();
  }
}

export function LiveTraceController(): null {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const pendingUserTurn = useAppStore((s) => s.pendingUserTurn);
  const isCurrentSessionStreaming = useLiveTraceStore((s) =>
    Boolean(activeSessionId && s.liveTurnsBySession[activeSessionId]?.isLive),
  );

  React.useEffect(() => {
    controllerMountCount += 1;
    const unsub = onHarnessFrame((frame) => {
      processHarnessFrame(
        frame,
        queryClient,
        useAppStore.getState().activeSessionId ?? undefined,
      );
    });
    return () => {
      unsub();
      controllerMountCount = Math.max(0, controllerMountCount - 1);
      if (controllerMountCount === 0) {
        resetAllLiveTraces();
      }
    };
  }, [queryClient]);

  React.useEffect(() => {
    if (!pendingUserTurn) return;
    startLiveTurnFromOptimistic(pendingUserTurn);
    useAppStore.getState().consumeOptimisticTurn(pendingUserTurn.id);
  }, [pendingUserTurn]);

  React.useEffect(() => {
    useAppStore.getState().setIsStreamActive(isCurrentSessionStreaming);
  }, [isCurrentSessionStreaming]);

  return null;
}
