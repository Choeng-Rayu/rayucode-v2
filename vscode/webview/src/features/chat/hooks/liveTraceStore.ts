import * as React from "react";
import {
  extractTodosFromHarnessFrame,
  shouldClearStaleLiveTurn,
} from "@rayu-dev/rayucode-session-core/client";
import { fromHarnessPermissionMode } from "@shared/vscodeProtocol";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import {
  createHarnessStreamTracker,
  createStreamBatcher,
  formatDurationSeconds,
  makeTurnDurationKey,
  mapHarnessFrameToLiveEvents,
  onHarnessFrame,
  useAppStore,
  type HarnessStreamTracker,
  type InlineDiffCardData,
  type MappedLiveTraceEvent,
  type MidTurnMessageItem,
  type OptimisticUserTurn,
  type StreamBatcher,
} from "@/lib";

import type {
  ClarifyingQuestionItem,
  ClarifyingQuestionRequest,
} from "../components/ClarifyingQuestionCard";
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
  activeToolStatus?: string | null;
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
const abnormalStopBySession = new Map<string, boolean>();
const drainHandlersBySession = new Map<
  string,
  (item: MidTurnMessageItem) => void | Promise<void>
>();
const completedTurnIds = new Set<string>();
let turnSequence = 1;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let controllerMountCount = 0;
let activeHarnessUnsub: (() => void) | null = null;
let activeBridgeQueryClient: QueryClient | null = null;

export function registerSessionQueueDrainHandler(
  sessionId: string,
  handler: ((item: MidTurnMessageItem) => void | Promise<void>) | undefined,
): () => void {
  if (!sessionId || !handler) return () => {};
  drainHandlersBySession.set(sessionId, handler);
  return () => {
    if (drainHandlersBySession.get(sessionId) === handler) {
      drainHandlersBySession.delete(sessionId);
    }
  };
}

export function settleSessionTurnQueue(
  sessionId: string,
  wasAbnormalStop: boolean,
): void {
  if (!sessionId) return;
  const store = useAppStore.getState();
  const isPaused = Boolean(store.pausedQueueSessions[sessionId]);
  if (wasAbnormalStop || isPaused) {
    store.demotePendingSteersToQueue(sessionId);
    store.setQueuePausedForSession(sessionId, true);
    return;
  }
  store.markSteersDelivered(sessionId);
  const drain = drainHandlersBySession.get(sessionId);
  if (drain) {
    const nextQueued = store.shiftNextQueuedMessage(sessionId);
    if (nextQueued) {
      queueMicrotask(() => {
        void drain(nextQueued);
      });
    }
  }
}

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
      case "connection-phase":
        next.connectionPhaseLabel = ev.phase;
        break;
      case "kv-cache-miss":
        next.kvCacheMissReason = ev.reason;
        break;
      case "turn-stopped":
        next.activeToolStatus = null;
        next.connectionPhaseLabel = null;
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
      case "answer-replace":
        next.answerIntro = ev.text;
        break;
      case "duration":
        next.workedDuration = ev.workedDuration;
        break;
      case "complete":
        next = {
          ...next,
          isLive: false,
          activeToolStatus: null,
          connectionPhaseLabel: null,
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
  abnormalStopBySession.delete(input.sessionId);
  const tracker = getOrCreateTracker(input.sessionId);
  tracker.startedAtMs = startedAt;
  tracker.turnActive = true;
  tracker.turnCompleted = false;
  tracker.stoppedInTurn = false;
  tracker.hasBufferedText = false;
  tracker.textDonePendingTool = false;
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
    ...(typeof input.baseHistoryTurnCount === "number" &&
    input.baseHistoryTurnCount >= 0
      ? { baseHistoryTurnCount: input.baseHistoryTurnCount }
      : {}),
    workedDuration: formatDurationSeconds(
      Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
    ),
    isLive: true,
    notes: [],
    groups: [],
    timeline: [],
    activeToolStatus: input.activeToolStatus ?? null,
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
  abnormalStopBySession.delete(sessionId);
  const tracker = trackersBySession.get(sessionId);
  if (tracker) {
    tracker.turnActive = false;
    tracker.toolInputs.clear();
  }
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
  abnormalStopBySession.clear();
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
    if (events.some((ev) => ev.type === "turn-stopped")) {
      abnormalStopBySession.set(sessionId, true);
    }

    const current =
      useLiveTraceStore.getState().liveTurnsBySession[sessionId] ?? null;
    const updated = applyTraceEvents(current, events);
    if (!updated) return;

    const hasComplete = events.some((ev) => ev.type === "complete");
    if (hasComplete) {
      const wasAbnormalStop = Boolean(abnormalStopBySession.get(sessionId));
      if (!completedTurnIds.has(updated.id)) {
        completedTurnIds.add(updated.id);
        if (updated.workedDuration) {
          const baseCount =
            useLiveTraceStore.getState().baseHistoryTurnCountBySession[
              sessionId
            ];
          const appStore = useAppStore.getState();
          if (typeof baseCount === "number") {
            appStore.recordTurnDuration(
              sessionId,
              makeTurnDurationKey(baseCount, updated.userPrompt),
              updated.workedDuration,
            );
          } else if (updated.userPrompt.trim()) {
            appStore.recordTurnDuration(
              sessionId,
              makeTurnDurationKey(-1, updated.userPrompt),
              updated.workedDuration,
            );
          }
        }
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
      useAppStore.getState().clearPendingPermission(sessionId);
      clearSessionLiveTurn(sessionId);
      settleSessionTurnQueue(sessionId, wasAbnormalStop);
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
    typeof frame.session_id === "string" ? frame.session_id.trim() : "";
  if (
    !frameSession &&
    (frame.ev === "error" ||
      frame.ev === "turn_stopped" ||
      frame.ev === "turn_aborted")
  ) {
    // Bound session sockets always stamp session_id onto terminal error/stop
    // frames. Ignore sessionless transport disconnects (e.g. a foreign socket
    // closing with "daemon connection closed") so they never abort or clear
    // pending permissions for whichever session happens to be focused.
    return;
  }
  const targetSessionId = frameSession || fallbackSessionId || "";
  if (!targetSessionId) return;

  const todoUpdate = extractTodosFromHarnessFrame(frame, targetSessionId);
  if (todoUpdate) {
    useAppStore.getState().setSessionTodos(todoUpdate.sessionId, todoUpdate.todos);
    return;
  }

  if (frame.ev === "permission_resolved") {
    const reqId =
      typeof frame.request_id === "string" ? frame.request_id.trim() : "";
    useAppStore
      .getState()
      .clearPendingPermission(targetSessionId, reqId || undefined);
    return;
  }

  if (frame.ev === "permission_mode_changed") {
    if (typeof frame.mode === "string") {
      useAppStore.getState().setSessionPrefs(targetSessionId, {
        permissionMode: fromHarnessPermissionMode(frame.mode),
      });
    }
    return;
  }

  if (frame.ev === "soft_interrupt_injected") {
    const clientIds = Array.isArray(frame.client_ids)
      ? frame.client_ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];
    const store = useAppStore.getState();
    const currentItems = store.midTurnMessagesBySession[targetSessionId] ?? [];
    const matchedSteers = currentItems.filter(
      (item) =>
        item.mode === "steer" &&
        (clientIds.length === 0 || clientIds.includes(item.id)),
    );
    store.markSteersDelivered(targetSessionId, clientIds);
    if (matchedSteers.length > 0) {
      const texts = matchedSteers
        .map((item) => item.text.trim())
        .filter(Boolean);
      if (texts.length > 0) {
        if (!useLiveTraceStore.getState().liveTurnsBySession[targetSessionId]) {
          startSessionLiveTurn({
            sessionId: targetSessionId,
            userPrompt: "",
          });
        }
        const batcher = getOrCreateBatcher(targetSessionId, queryClient);
        batcher.push({ type: "note", text: `Steered: ${texts.join(" · ")}` });
        batcher.flushNow();
      }
    }
    return;
  }

  if (frame.ev === "soft_interrupts_cancelled") {
    if (Array.isArray(frame.cancelled)) {
      const store = useAppStore.getState();
      for (const id of frame.cancelled) {
        if (typeof id === "string" && id.length > 0) {
          store.removeMidTurnMessage(targetSessionId, id);
        }
      }
    }
    return;
  }

  if (frame.ev === "question_closed") {
    const closedReqId =
      typeof frame.request_id === "string" ? frame.request_id : null;
    const current =
      useLiveTraceStore.getState().pendingQuestionsBySession[targetSessionId] ??
      null;
    if (current && (!closedReqId || current.requestId === closedReqId)) {
      setSessionPendingQuestion(targetSessionId, null);
    }
    return;
  }

  if (frame.ev === "question_request" || frame.ev === "ask_user_question") {
    const reqId = String(frame.request_id ?? `q_${Date.now()}`);
    const mapRawOptions = (rawOpts: unknown[]) =>
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
          ];

    const rawQuestions = Array.isArray(frame.questions)
      ? frame.questions.filter(
          (q): q is Record<string, unknown> =>
            Boolean(q) && typeof q === "object" && !Array.isArray(q),
        )
      : [];

    const parsedQuestions: ClarifyingQuestionItem[] =
      rawQuestions.length > 0
        ? rawQuestions.map((q) => ({
            question: String(
              q.question ?? q.prompt ?? "How would you like to proceed?",
            ),
            header: typeof q.header === "string" ? q.header : undefined,
            placeholder:
              typeof q.placeholder === "string" ? q.placeholder : undefined,
            multiSelect: Boolean(q.multiSelect ?? q.multi_select),
            options: mapRawOptions(Array.isArray(q.options) ? q.options : []),
          }))
        : [
            {
              question: String(
                frame.prompt ??
                  frame.question ??
                  "How would you like to proceed?",
              ),
              placeholder:
                typeof frame.placeholder === "string"
                  ? frame.placeholder
                  : undefined,
              multiSelect: Boolean(frame.multiSelect ?? frame.multi_select),
              options: mapRawOptions(
                Array.isArray(frame.options) ? frame.options : [],
              ),
            },
          ];

    const primary = parsedQuestions[0]!;
    setSessionPendingQuestion(targetSessionId, {
      requestId: reqId,
      sessionId: targetSessionId,
      prompt: primary.question,
      placeholder: primary.placeholder,
      multiSelect: primary.multiSelect,
      options: primary.options,
      questions: parsedQuestions,
    });
    return;
  }

  if (frame.ev === "session_status") {
    const status = typeof frame.status === "string" ? frame.status.trim().toLowerCase() : "";
    if (
      status === "running" ||
      status === "processing" ||
      status === "busy" ||
      status === "generating" ||
      status === "tool_running"
    ) {
      const existing =
        useLiveTraceStore.getState().liveTurnsBySession[targetSessionId];
      if (!existing) {
        startSessionLiveTurn({
          sessionId: targetSessionId,
          userPrompt: "",
          activeToolStatus:
            status === "tool_running" ? "Running tool..." : "Thinking...",
        });
      } else if (!existing.isLive) {
        useLiveTraceStore.setState((state) => ({
          liveTurnsBySession: {
            ...state.liveTurnsBySession,
            [targetSessionId]: { ...existing, isLive: true },
          },
        }));
      }
    } else if (status === "idle") {
      const existing =
        useLiveTraceStore.getState().liveTurnsBySession[targetSessionId];
      if (
        existing &&
        !existing.userPrompt.trim() &&
        !existing.answerIntro.trim() &&
        existing.groups.length === 0 &&
        existing.notes.length === 0 &&
        (existing.timeline?.length ?? 0) === 0
      ) {
        clearSessionLiveTurn(targetSessionId);
      }
    }
    return;
  }

  if (
    frame.ev === "error" &&
    (frame.non_turn === true ||
      frame.req === "set_model" ||
      frame.req === "set_reasoning_effort" ||
      frame.req === "set_permission_mode")
  ) {
    // Non-turn control requests (e.g. changing model/effort) must never
    // abort or inject an error into an active AI response stream.
    return;
  }

  const isTerminalFrame =
    frame.ev === "turn_done" ||
    frame.ev === "turn_stopped" ||
    frame.ev === "error";

  if (frame.ev === "turn_stopped" || frame.ev === "error") {
    abnormalStopBySession.set(targetSessionId, true);
  } else if (frame.ev === "turn_start" || frame.ev === "message_accepted") {
    abnormalStopBySession.delete(targetSessionId);
  }

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
  if (
    traceEvents.some(
      (e) =>
        e.type === "complete" ||
        e.type === "turn-stopped" ||
        e.type === "note",
    )
  ) {
    batcher.flushNow();
  }
}

export function useLiveTraceBridge(fallbackSessionId?: string | null): void {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const pendingUserTurn = useAppStore((s) => s.pendingUserTurn);
  const effectiveSessionId = activeSessionId ?? fallbackSessionId ?? null;
  const isCurrentSessionStreaming = useLiveTraceStore((s) =>
    Boolean(
      effectiveSessionId && s.liveTurnsBySession[effectiveSessionId]?.isLive,
    ),
  );

  React.useEffect(() => {
    activeBridgeQueryClient = queryClient;
    controllerMountCount += 1;
    if (!activeHarnessUnsub) {
      activeHarnessUnsub = onHarnessFrame((frame) => {
        if (!activeBridgeQueryClient) return;
        processHarnessFrame(
          frame,
          activeBridgeQueryClient,
          useAppStore.getState().activeSessionId ?? undefined,
        );
      });
    }
    return () => {
      controllerMountCount = Math.max(0, controllerMountCount - 1);
      if (controllerMountCount === 0) {
        activeHarnessUnsub?.();
        activeHarnessUnsub = null;
        activeBridgeQueryClient = null;
        resetAllLiveTraces();
      }
    };
  }, [queryClient]);

  React.useEffect(() => {
    if (!pendingUserTurn) return;
    if (useAppStore.getState().pendingUserTurn?.id !== pendingUserTurn.id) {
      return;
    }
    startLiveTurnFromOptimistic(pendingUserTurn);
    useAppStore.getState().consumeOptimisticTurn(pendingUserTurn.id);
  }, [pendingUserTurn]);

  React.useEffect(() => {
    useAppStore.getState().setIsStreamActive(isCurrentSessionStreaming);
  }, [isCurrentSessionStreaming]);
}

export function LiveTraceController(): null {
  useLiveTraceBridge();
  return null;
}
