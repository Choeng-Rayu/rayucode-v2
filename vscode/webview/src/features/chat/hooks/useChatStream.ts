import * as React from "react";
import { reconcileChatTurns } from "@rayu-dev/rayucode-session-core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  callRpc,
  isVsCodeWebview,
  mapHistoryMessagesToTurns,
  onHostMessage,
  sendHarnessRequest,
  useAppStore,
  type ExecutionTurn,
  type HarnessHistoryMessageLike,
  type InlineDiffCardData,
  type MappedLiveTraceEvent,
  type MidTurnMessageItem,
} from "@/lib";
import type {
  FileChangesSnapshotView,
  SessionSummaryView,
} from "@shared/vscodeProtocol";

import type { ApprovalCardRequest } from "../components/ApprovalCard";
import type { CitationItem } from "../components/CiteLink";
import type { ClarifyingQuestionRequest } from "../components/ClarifyingQuestionCard";
import type { ExtendedWorkStepGroup } from "../components/WorkTrace";
import {
  applyTraceEvents,
  chatHistoryQueryKey,
  clearSessionLiveTurn,
  registerSessionQueueDrainHandler,
  setSessionPendingQuestion,
  settleSessionTurnQueue,
  startSessionLiveTurn,
  toggleCompletedTurnPin,
  useLiveTraceBridge,
  useLiveTraceStore,
} from "./liveTraceStore";

export interface TurnBulletItem {
  id: string;
  title: string;
  body: string;
  citations: CitationItem[];
}

export interface ChatTurnView
  extends Omit<ExecutionTurn, "groups" | "answerBullets"> {
  isLive?: boolean;
  compactedNotice?: string;
  userRefFiles?: string;
  userImages?: Array<{ name: string; dataUrl: string }>;
  userMeta?: string;
  activeToolStatus?: string | null;
  showLiveBackgroundPill?: boolean;
  connectionPhaseLabel?: string | null;
  answerSummaryTitle?: string;
  answerBullets: TurnBulletItem[];
  groups: ExtendedWorkStepGroup[];
  diffCards?: InlineDiffCardData[];
  kvCacheMissReason?: string;
}

export interface SoftInterruptQueueItem {
  id: string;
  text: string;
  urgent?: boolean;
  queuedAtMs: number;
}

const DEFAULT_SAMPLE_TURNS: ChatTurnView[] = [
  {
    id: "turn_vscode_1",
    sessionId: "ses_vscode_shell",
    userPrompt:
      "Inspect the dual-form-factor shell and optimize the ShardStore lookup latency.",
    userRefFiles:
      "vscode/webview/src/features/shell/components/AppShell.tsx:1-60",
    workedDuration: "14s",
    notes: [
      "Inspected the shell layout and coalesced consecutive workspace file reads before benchmarking `lookup.rs`.",
    ],
    groups: [
      {
        id: "wg_explore_1",
        title: "Read files, ran commands",
        steps: [
          {
            id: "step_read_1",
            kind: "read",
            label: "Read",
            files: [
              {
                file: "AppShell.tsx",
                path: "vscode/webview/src/features/shell/components/AppShell.tsx",
                line: 1,
                rangeLabel: "AppShell.tsx:1-60",
              },
            ],
          },
          {
            id: "step_read_2",
            kind: "read",
            label: "Read",
            files: [
              {
                file: "lookup.rs",
                path: "crates/rayu-harness/src/lookup.rs",
                line: 42,
                rangeLabel: "lookup.rs:42-98",
              },
              {
                file: "globals.css",
                path: "vscode/webview/src/styles/globals.css",
                line: 18,
                rangeLabel: "globals.css:18-95",
              },
            ],
          },
          {
            id: "step_cmd_1",
            kind: "command",
            command: "cargo test -p rayu-harness lookup::tests",
            displayCommand: "cargo test -p rayu-harness lookup::tests",
            output:
              "running 6 tests\ntest lookup::tests::fast_path_hit ... ok\ntest lookup::tests::zero_alloc_key ... ok\ntest result: ok. 6 passed; 0 failed; finished in 0.42s",
            exitCode: 0,
            statusLabel: "Success · 0.4s",
            isMono: true,
            toolName: "bash",
            intent: "Run ShardStore lookup unit tests",
          },
        ],
        toolSteps: [
          {
            id: "ts_agentgrep_1",
            toolName: "agentgrep",
            intent: 'Searched "ShardStore::lookup" across crates/ (4 hits)',
            status: "completed",
            durationLabel: "0.2s",
            filePath: "crates/rayu-harness/src/lookup.rs",
            line: 42,
          },
        ],
      },
    ],
    answerIntro:
      "Replaced the secondary hash probe in `crates/rayu-harness/src/lookup.rs:42` with a direct inline slice lookup and verified the dual-form-factor container breakpoints in `vscode/webview/src/features/shell/components/AppShell.tsx:24`.",
    answerSummaryTitle: "Key Changes",
    answerBullets: [
      {
        id: "b_1",
        title: "Zero-allocation hot lookup:",
        body: "Eliminated the temporary `String` clone on cache hits.",
        citations: [
          {
            label: "lookup.rs:42",
            file: "crates/rayu-harness/src/lookup.rs",
            line: 42,
            kind: "code",
          },
        ],
      },
      {
        id: "b_2",
        title: "Quiet 3-Depth Trace:",
        body: "Coalesced consecutive read and search steps into a single expandable line.",
        citations: [
          {
            label: "AppShell.tsx:24",
            file: "vscode/webview/src/features/shell/components/AppShell.tsx",
            line: 24,
            kind: "code",
          },
        ],
      },
    ],
    diffCard: {
      id: "diff_lookup_1",
      file: "crates/rayu-harness/src/lookup.rs",
      additions: 4,
      deletions: 2,
      hint: "Zero-allocation ShardStore slice lookup",
      lines: [
        {
          kind: "context",
          oldLine: 41,
          newLine: 41,
          text: "pub fn lookup(&self, key: &str) -> Option<&ShardEntry> {",
        },
        {
          kind: "del",
          oldLine: 42,
          text: "    let owned = key.to_owned();",
        },
        {
          kind: "del",
          oldLine: 43,
          text: "    self.entries.get(&owned)",
        },
        {
          kind: "add",
          newLine: 42,
          text: "    self.entries.get(key)",
        },
        {
          kind: "context",
          oldLine: 44,
          newLine: 43,
          text: "}",
        },
      ],
    },
    artifacts: [
      {
        kind: "markdown",
        title: "Extension Architecture.md",
        subtitle: "SidePanel specification & token audit",
        pillLabel: "Extension Architecture.md",
        filePath: "vscode/VSCODE_DESIGN.md",
      },
    ],
    timestamp: "2m ago",
    credits: "0.42 cr",
    kvCachePct: 94,
    pinned: false,
  },
];

const EMPTY_COMPLETED_TURNS: ChatTurnView[] = [];

function toChatTurnViews(
  sessionId: string,
  messages: HarnessHistoryMessageLike[],
): ChatTurnView[] {
  return mapHistoryMessagesToTurns(sessionId, messages).map((turn) => ({
    ...turn,
    groups: turn.groups,
    answerBullets: [],
  }));
}

const EMPTY_MIDTURN_MESSAGES: MidTurnMessageItem[] = [];

export interface UseChatStreamOptions {
  sessionId?: string | null;
  initialTurns?: ChatTurnView[];
  initialFileChanges?: FileChangesSnapshotView | null;
  onDrainQueuedMessage?: (item: MidTurnMessageItem) => void | Promise<void>;
}

export interface UseChatStreamResult {
  sessionId: string;
  turns: ChatTurnView[];
  isStreaming: boolean;
  fileChangesSnapshot: FileChangesSnapshotView | null;
  setFileChangesSnapshot: (snapshot: FileChangesSnapshotView) => void;
  pendingPermission: ApprovalCardRequest | null;
  pendingQuestion: ClarifyingQuestionRequest | null;
  softInterrupts: SoftInterruptQueueItem[];
  midTurnMessages: MidTurnMessageItem[];
  isQueuePaused: boolean;
  rewoundTurnId: string | null;
  sendPrompt: (
    prompt: string,
    opts?: {
      refFiles?: string;
      images?: Array<{ name: string; dataUrl: string }>;
    },
  ) => void;
  pushLiveEvents: (events: MappedLiveTraceEvent[]) => void;
  respondPermission: (
    decision: "allow_once" | "allow_always" | "deny",
    req?: ApprovalCardRequest,
  ) => Promise<void>;
  respondQuestion: (
    answers: Record<string, string>,
    notes?: Record<string, string>,
  ) => Promise<void>;
  dismissQuestion: () => void;
  setPendingQuestion: React.Dispatch<
    React.SetStateAction<ClarifyingQuestionRequest | null>
  >;
  backgroundActiveTool: () => Promise<void>;
  rewindToTurn: (turnId: string) => Promise<void>;
  undoRewind: () => Promise<void>;
  queueSoftInterrupt: (text: string, urgent?: boolean) => Promise<void>;
  cancelSoftInterrupt: (interruptId?: string) => Promise<void>;
  promoteQueuedToSteer: (id: string) => Promise<void>;
  editMidTurnMessage: (id: string) => Promise<void>;
  sendQueuedNow: (id: string) => Promise<void>;
  cancelMidTurnMessage: (id?: string) => Promise<void>;
  forkFromTurn: (turnId: string) => Promise<SessionSummaryView | null>;
  togglePinTurn: (turnId: string, pinned: boolean) => void;
  retryTurn: (turnId: string) => void;
}

export function useChatStream(
  options: UseChatStreamOptions = {},
): UseChatStreamResult {
  const queryClient = useQueryClient();
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const storePermission = useAppStore((s) => s.pendingPermission);
  const setStorePermission = useAppStore((s) => s.setPendingPermission);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setStoreFileChangesSnapshot = useAppStore(
    (s) => s.setFileChangesSnapshot,
  );

  const sessionId =
    options.sessionId ??
    storeSessionId ??
    (!isVsCodeWebview() ? "ses_vscode_shell" : "");

  useLiveTraceBridge(sessionId);

  const isMockDemoSession =
    !isVsCodeWebview() && sessionId === "ses_vscode_shell";

  const midTurnMessages = useAppStore((s) =>
    sessionId
      ? (s.midTurnMessagesBySession[sessionId] ?? EMPTY_MIDTURN_MESSAGES)
      : EMPTY_MIDTURN_MESSAGES,
  );
  const isQueuePaused = useAppStore((s) =>
    sessionId ? Boolean(s.pausedQueueSessions[sessionId]) : false,
  );

  const softInterrupts = React.useMemo<SoftInterruptQueueItem[]>(
    () =>
      midTurnMessages.map((item) => ({
        id: item.id,
        text: item.text,
        urgent: false,
        queuedAtMs: item.createdAtMs,
      })),
    [midTurnMessages],
  );

  const storeFileChanges = useAppStore((s) =>
    sessionId ? (s.fileChangesBySession[sessionId] ?? null) : null,
  );
  const [localFileChanges, setLocalFileChanges] =
    React.useState<FileChangesSnapshotView | null>(
      options.initialFileChanges ?? null,
    );

  const setFileChangesSnapshot = React.useCallback(
    (snapshot: FileChangesSnapshotView) => {
      const targetSid = snapshot.sessionId || sessionId;
      setLocalFileChanges(snapshot);
      if (targetSid) {
        setStoreFileChangesSnapshot(targetSid, snapshot);
      }
    },
    [sessionId, setStoreFileChangesSnapshot],
  );

  React.useEffect(() => {
    if (options.initialFileChanges !== undefined) {
      setLocalFileChanges(options.initialFileChanges);
    } else {
      setLocalFileChanges(null);
    }
  }, [options.initialFileChanges, sessionId]);

  React.useEffect(() => {
    if (!sessionId) return;
    return onHostMessage((msg) => {
      if (
        msg.type === "rayucode.fileChanges.updated" &&
        msg.sessionId === sessionId
      ) {
        setLocalFileChanges(msg.snapshot);
        setStoreFileChangesSnapshot(msg.sessionId, msg.snapshot);
      }
    });
  }, [sessionId, setStoreFileChangesSnapshot]);

  React.useEffect(() => {
    if (options.initialFileChanges !== undefined) return;
    if (!sessionId) return;
    let cancelled = false;
    void callRpc("changes.getSessionSummary", { sessionId })
      .then((snapshot) => {
        if (cancelled) return;
        setLocalFileChanges(snapshot);
        setStoreFileChangesSnapshot(sessionId, snapshot);
      })
      .catch(() => {
        // Offline / unsupported bridge: rely on live events if any
      });
    return () => {
      cancelled = true;
    };
  }, [options.initialFileChanges, sessionId, setStoreFileChangesSnapshot]);

  const fileChangesSnapshot = localFileChanges ?? storeFileChanges;

  const liveTurn = useLiveTraceStore((s) =>
    sessionId ? (s.liveTurnsBySession[sessionId] ?? null) : null,
  );
  const completedTurns = useLiveTraceStore((s) =>
    sessionId
      ? (s.completedTurnsBySession[sessionId] ?? EMPTY_COMPLETED_TURNS)
      : EMPTY_COMPLETED_TURNS,
  );
  const baseHistoryTurnCount = useLiveTraceStore((s) =>
    sessionId ? s.baseHistoryTurnCountBySession[sessionId] : undefined,
  );
  const pendingQuestion = useLiveTraceStore((s) =>
    sessionId ? (s.pendingQuestionsBySession[sessionId] ?? null) : null,
  );

  const historyQuery = useQuery({
    queryKey: chatHistoryQueryKey(sessionId),
    queryFn: async () => {
      const res = await callRpc("sessions.history", { sessionId });
      return toChatTurnViews(
        sessionId,
        (res.messages ?? []) as HarnessHistoryMessageLike[],
      );
    },
    enabled:
      options.initialTurns === undefined &&
      Boolean(sessionId) &&
      !isMockDemoSession,
    staleTime: 15_000,
  });
  const [pinnedOverrides, setPinnedOverrides] = React.useState<
    Record<string, boolean>
  >({});
  const [rewoundTurnId, setRewoundTurnId] = React.useState<string | null>(null);

  const onDrainQueuedMessageRef = React.useRef(options.onDrainQueuedMessage);
  onDrainQueuedMessageRef.current = options.onDrainQueuedMessage;
  const hasDrainHandler = Boolean(options.onDrainQueuedMessage);

  React.useEffect(() => {
    if (!sessionId || !hasDrainHandler) return;
    return registerSessionQueueDrainHandler(sessionId, (item) =>
      onDrainQueuedMessageRef.current?.(item),
    );
  }, [hasDrainHandler, sessionId]);

  React.useEffect(() => {
    setRewoundTurnId(null);
  }, [sessionId]);

  const baseTurns = React.useMemo(() => {
    if (options.initialTurns) return options.initialTurns;
    if (isMockDemoSession) return DEFAULT_SAMPLE_TURNS;
    return historyQuery.data ?? [];
  }, [historyQuery.data, isMockDemoSession, options.initialTurns]);

  const visibleHistoryTurns = React.useMemo(() => {
    const sliced = rewoundTurnId
      ? (() => {
          const idx = baseTurns.findIndex((t) => t.id === rewoundTurnId);
          return idx >= 0 ? baseTurns.slice(0, idx + 1) : baseTurns;
        })()
      : baseTurns;
    return sliced.map((t) =>
      pinnedOverrides[t.id] !== undefined
        ? { ...t, pinned: pinnedOverrides[t.id]! }
        : t,
    );
  }, [baseTurns, pinnedOverrides, rewoundTurnId]);

  const isStreaming = Boolean(liveTurn?.isLive);
  const turnsRef = React.useRef<ChatTurnView[]>([]);

  const pushLiveEvents = React.useCallback(
    (events: MappedLiveTraceEvent[]) => {
      if (!sessionId || events.length === 0) return;

      const traceEvents: MappedLiveTraceEvent[] = [];
      for (const ev of events) {
        if (ev.type === "permission-request") {
          setStorePermission({
            sessionId: ev.sessionId || sessionId,
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

      const current =
        useLiveTraceStore.getState().liveTurnsBySession[sessionId] ??
        startSessionLiveTurn({ sessionId, userPrompt: "" });
      const updated = applyTraceEvents(current, traceEvents);
      if (!updated) return;
      if (traceEvents.some((ev) => ev.type === "complete")) {
        const wasAbnormalStop = traceEvents.some(
          (ev) => ev.type === "turn-stopped",
        );
        useLiveTraceStore.setState((state) => {
          const prev = state.completedTurnsBySession[sessionId] ?? [];
          return {
            completedTurnsBySession: {
              ...state.completedTurnsBySession,
              [sessionId]: prev.some((t) => t.id === updated.id)
                ? prev
                : [...prev, updated],
            },
          };
        });
        clearSessionLiveTurn(sessionId);
        settleSessionTurnQueue(sessionId, wasAbnormalStop);
        return;
      }
      useLiveTraceStore.setState((state) => ({
        liveTurnsBySession: {
          ...state.liveTurnsBySession,
          [sessionId]: updated,
        },
      }));
    },
    [sessionId, setStorePermission],
  );

  const sendPrompt = React.useCallback(
    (
      prompt: string,
      opts?: {
        refFiles?: string;
        images?: Array<{ name: string; dataUrl: string }>;
      },
    ) => {
      const trimmed = prompt.trim();
      if (!trimmed || !sessionId) return;

      if (isStreaming) {
        const clientId = `si_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        useAppStore.getState().addMidTurnMessage({
          id: clientId,
          sessionId,
          mode: "steer",
          text: trimmed,
          createdAtMs: Date.now(),
        });
        void callRpc("sessions.softInterrupt", {
          sessionId,
          text: trimmed,
          urgent: false,
          clientId,
        }).catch(() => {});
        return;
      }

      startSessionLiveTurn({
        sessionId,
        userPrompt: trimmed,
        userRefFiles: opts?.refFiles,
        userImages: opts?.images,
        baseHistoryTurnCount: visibleHistoryTurns.length,
      });

      sendHarnessRequest({
        req: "send_message",
        session_id: sessionId,
        content: trimmed,
      });
    },
    [isStreaming, sessionId, visibleHistoryTurns.length],
  );

  const respondPermission = React.useCallback(
    async (
      decision: "allow_once" | "allow_always" | "deny",
      req?: ApprovalCardRequest,
    ) => {
      const target = req ?? storePermission;
      if (!target) return;
      setStorePermission(null);
      try {
        await callRpc("sessions.respondPermission", {
          sessionId: target.sessionId || sessionId,
          requestId: target.requestId,
          decision,
        });
      } catch {
        // ignore offline errors
      }
    },
    [sessionId, setStorePermission, storePermission],
  );

  const respondQuestion = React.useCallback(
    async (
      answers: Record<string, string>,
      notes?: Record<string, string>,
    ) => {
      if (!pendingQuestion) return;
      const q = pendingQuestion;
      setSessionPendingQuestion(sessionId, null);
      try {
        await callRpc("sessions.respondQuestion", {
          sessionId: q.sessionId || sessionId,
          requestId: q.requestId,
          answers,
          notes,
        });
      } catch {
        // ignore offline errors
      }
    },
    [pendingQuestion, sessionId],
  );

  const dismissQuestion = React.useCallback(() => {
    setSessionPendingQuestion(sessionId, null);
  }, [sessionId]);

  const setPendingQuestion = React.useCallback<
    React.Dispatch<React.SetStateAction<ClarifyingQuestionRequest | null>>
  >(
    (updater) => {
      const current = sessionId
        ? (useLiveTraceStore.getState().pendingQuestionsBySession[sessionId] ??
          null)
        : null;
      const next =
        typeof updater === "function" ? updater(current) : updater;
      setSessionPendingQuestion(sessionId, next);
    },
    [sessionId],
  );

  const backgroundActiveTool = React.useCallback(async () => {
    try {
      await callRpc("background.backgroundTool", { sessionId });
    } catch {
      // ignore offline errors
    }
  }, [sessionId]);

  const rewindToTurn = React.useCallback(
    async (turnId: string) => {
      const idx = turnsRef.current.findIndex((t) => t.id === turnId);
      const messageIndex = idx >= 0 ? idx + 1 : undefined;
      setRewoundTurnId(turnId);
      try {
        await callRpc("sessions.rewind", {
          sessionId,
          turnId,
          ...(messageIndex !== undefined ? { messageIndex } : {}),
        });
      } catch {
        // ignore offline errors
      }
    },
    [sessionId],
  );

  const undoRewind = React.useCallback(async () => {
    setRewoundTurnId(null);
    try {
      await callRpc("sessions.rewindUndo", { sessionId });
    } catch {
      // ignore offline errors
    }
    if (!options.initialTurns && !isMockDemoSession && sessionId) {
      await queryClient.invalidateQueries({
        queryKey: chatHistoryQueryKey(sessionId),
      });
    }
  }, [isMockDemoSession, options.initialTurns, queryClient, sessionId]);

  const queueSoftInterrupt = React.useCallback(
    async (text: string, urgent = false) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionId) return;
      const clientId = `si_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      useAppStore.getState().addMidTurnMessage({
        id: clientId,
        sessionId,
        mode: "steer",
        text: trimmed,
        createdAtMs: Date.now(),
      });
      try {
        await callRpc("sessions.softInterrupt", {
          sessionId,
          text: trimmed,
          urgent,
          clientId,
        });
      } catch {
        // ignore offline errors
      }
    },
    [sessionId],
  );

  const cancelMidTurnMessage = React.useCallback(
    async (id?: string) => {
      if (!sessionId) return;
      const store = useAppStore.getState();
      if (!id) {
        const items = store.midTurnMessagesBySession[sessionId] ?? [];
        const hasSteer = items.some((m) => m.mode === "steer");
        for (const item of items) {
          store.removeMidTurnMessage(sessionId, item.id);
        }
        if (hasSteer) {
          try {
            await callRpc("sessions.cancelSoftInterrupts", { sessionId });
          } catch {
            // ignore offline errors
          }
        }
        return;
      }
      const item = (store.midTurnMessagesBySession[sessionId] ?? []).find(
        (m) => m.id === id,
      );
      store.removeMidTurnMessage(sessionId, id);
      if (!item || item.mode === "steer") {
        try {
          await callRpc("sessions.cancelSoftInterrupts", {
            sessionId,
            interruptId: id,
          });
        } catch {
          // ignore offline errors
        }
      }
    },
    [sessionId],
  );

  const promoteQueuedToSteer = React.useCallback(
    async (id: string) => {
      if (!sessionId) return;
      const store = useAppStore.getState();
      const item = (store.midTurnMessagesBySession[sessionId] ?? []).find(
        (m) => m.id === id && m.mode === "queue",
      );
      if (!item) return;
      store.updateMidTurnMessage(sessionId, id, { mode: "steer" });
      const steerText = item.text.trim() || "[Image attachment]";
      try {
        await callRpc("sessions.softInterrupt", {
          sessionId,
          text: steerText,
          urgent: false,
          clientId: item.id,
          ...(item.images && item.images.length > 0
            ? { images: item.images }
            : {}),
        });
      } catch {
        // ignore offline errors
      }
    },
    [sessionId],
  );

  const editMidTurnMessage = React.useCallback(
    async (id: string) => {
      if (!sessionId) return;
      const store = useAppStore.getState();
      const item = (store.midTurnMessagesBySession[sessionId] ?? []).find(
        (m) => m.id === id,
      );
      if (!item) return;
      store.removeMidTurnMessage(sessionId, id);
      if (item.mode === "steer") {
        try {
          await callRpc("sessions.cancelSoftInterrupts", {
            sessionId,
            interruptId: id,
          });
        } catch {
          // ignore offline errors
        }
      }
      store.setComposerDraft(sessionId, item.text);
      store.requestComposerFocus();
    },
    [sessionId],
  );

  const sendQueuedNow = React.useCallback(
    async (id: string) => {
      if (!sessionId) return;
      const store = useAppStore.getState();
      const item = (store.midTurnMessagesBySession[sessionId] ?? []).find(
        (m) => m.id === id && m.mode === "queue",
      );
      if (!item) return;
      store.removeMidTurnMessage(sessionId, id);
      store.setQueuePausedForSession(sessionId, false);
      const drain = onDrainQueuedMessageRef.current;
      if (drain) {
        await drain(item);
      } else {
        sendPrompt(item.text, {
          refFiles: item.editorSelection
            ? `${item.editorSelection.relativePath}:${item.editorSelection.lineStart}-${item.editorSelection.lineEnd}`
            : undefined,
          images: item.images?.map((img) => ({
            name: img.name ?? "Attachment",
            dataUrl: img.data,
          })),
        });
      }
    },
    [sendPrompt, sessionId],
  );

  const forkFromTurn = React.useCallback(
    async (turnId: string): Promise<SessionSummaryView | null> => {
      try {
        const res = await callRpc("sessions.fork", {
          sessionId,
          atTurnId: turnId,
        });
        setActiveSession(res.session.sessionId, res.session.title);
        return res.session;
      } catch {
        return null;
      }
    },
    [sessionId, setActiveSession],
  );

  const togglePinTurn = React.useCallback(
    (turnId: string, pinned: boolean) => {
      setPinnedOverrides((prev) => ({ ...prev, [turnId]: pinned }));
      toggleCompletedTurnPin(sessionId, turnId, pinned);
    },
    [sessionId],
  );

  const retryTurn = React.useCallback(
    (turnId: string) => {
      const target = visibleHistoryTurns.find((t) => t.id === turnId);
      if (target) {
        sendPrompt(target.userPrompt);
      }
    },
    [sendPrompt, visibleHistoryTurns],
  );

  const allTurns = React.useMemo(() => {
    const toReconcilable = (t: ChatTurnView) => ({
      ...t,
      answerMarkdown: t.answerIntro,
      workGroups: t.groups,
    });
    const reconciled = reconcileChatTurns({
      historyTurns: visibleHistoryTurns.map(toReconcilable),
      liveTurn: liveTurn ? toReconcilable(liveTurn) : null,
      completedLiveTurns: options.initialTurns
        ? undefined
        : completedTurns.map(toReconcilable),
      baseHistoryTurnCount,
    });
    return reconciled.map((t) =>
      pinnedOverrides[t.id] !== undefined
        ? { ...t, pinned: pinnedOverrides[t.id]! }
        : t,
    );
  }, [
    baseHistoryTurnCount,
    completedTurns,
    isMockDemoSession,
    liveTurn,
    options.initialTurns,
    pinnedOverrides,
    visibleHistoryTurns,
  ]);
  turnsRef.current = allTurns;

  return {
    sessionId,
    turns: allTurns,
    isStreaming,
    fileChangesSnapshot,
    setFileChangesSnapshot,
    pendingPermission: storePermission,
    pendingQuestion,
    softInterrupts,
    midTurnMessages,
    isQueuePaused,
    rewoundTurnId,
    sendPrompt,
    pushLiveEvents,
    respondPermission,
    respondQuestion,
    dismissQuestion,
    setPendingQuestion,
    backgroundActiveTool,
    rewindToTurn,
    undoRewind,
    queueSoftInterrupt,
    cancelSoftInterrupt: cancelMidTurnMessage,
    promoteQueuedToSteer,
    editMidTurnMessage,
    sendQueuedNow,
    cancelMidTurnMessage,
    forkFromTurn,
    togglePinTurn,
    retryTurn,
  };
}
