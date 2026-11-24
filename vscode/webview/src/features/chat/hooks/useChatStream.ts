import * as React from "react";
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
  setSessionPendingQuestion,
  startSessionLiveTurn,
  toggleCompletedTurnPin,
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

export interface UseChatStreamOptions {
  sessionId?: string | null;
  initialTurns?: ChatTurnView[];
  initialFileChanges?: FileChangesSnapshotView | null;
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

  const isMockDemoSession =
    !isVsCodeWebview() && sessionId === "ses_vscode_shell";

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
  const [softInterrupts, setSoftInterrupts] = React.useState<
    SoftInterruptQueueItem[]
  >([]);
  const [rewoundTurnId, setRewoundTurnId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSoftInterrupts([]);
    setRewoundTurnId(null);
  }, [sessionId]);

  const baseTurns = React.useMemo(() => {
    if (options.initialTurns) return options.initialTurns;
    if (isMockDemoSession) return DEFAULT_SAMPLE_TURNS;
    const fetched = historyQuery.data ?? [];
    if (completedTurns.length === 0) return fetched;
    const seenKeys = new Set(
      fetched.map((t) => `${t.userPrompt.trim()}::${t.answerIntro.trim()}`),
    );
    const extraCompleted = completedTurns.filter(
      (t) => !seenKeys.has(`${t.userPrompt.trim()}::${t.answerIntro.trim()}`),
    );
    return extraCompleted.length > 0 ? [...fetched, ...extraCompleted] : fetched;
  }, [completedTurns, historyQuery.data, isMockDemoSession, options.initialTurns]);

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

  const pushLiveEvents = React.useCallback(
    (events: MappedLiveTraceEvent[]) => {
      if (!sessionId || events.length === 0) return;
      const current =
        useLiveTraceStore.getState().liveTurnsBySession[sessionId] ??
        startSessionLiveTurn({ sessionId, userPrompt: "" });
      const updated = applyTraceEvents(current, events);
      if (!updated) return;
      if (events.some((ev) => ev.type === "complete")) {
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
        return;
      }
      useLiveTraceStore.setState((state) => ({
        liveTurnsBySession: {
          ...state.liveTurnsBySession,
          [sessionId]: updated,
        },
      }));
    },
    [sessionId],
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
        const item: SoftInterruptQueueItem = {
          id: `si_${Date.now()}`,
          text: trimmed,
          queuedAtMs: Date.now(),
        };
        setSoftInterrupts((prev) => [...prev, item]);
        void callRpc("sessions.softInterrupt", {
          sessionId,
          text: trimmed,
        }).catch(() => {});
        return;
      }

      startSessionLiveTurn({
        sessionId,
        userPrompt: trimmed,
        userRefFiles: opts?.refFiles,
        userImages: opts?.images,
      });

      sendHarnessRequest({
        req: "send_message",
        session_id: sessionId,
        content: trimmed,
      });
    },
    [isStreaming, sessionId],
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
      setRewoundTurnId(turnId);
      try {
        await callRpc("sessions.rewind", { sessionId, turnId });
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
      if (!options.initialTurns && !isMockDemoSession && sessionId) {
        await queryClient.invalidateQueries({
          queryKey: chatHistoryQueryKey(sessionId),
        });
      }
    } catch {
      // ignore offline errors
    }
  }, [isMockDemoSession, options.initialTurns, queryClient, sessionId]);

  const queueSoftInterrupt = React.useCallback(
    async (text: string, urgent = false) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const item: SoftInterruptQueueItem = {
        id: `si_${Date.now()}`,
        text: trimmed,
        urgent,
        queuedAtMs: Date.now(),
      };
      setSoftInterrupts((prev) => [...prev, item]);
      try {
        await callRpc("sessions.softInterrupt", {
          sessionId,
          text: trimmed,
          urgent,
        });
      } catch {
        // ignore offline errors
      }
    },
    [sessionId],
  );

  const cancelSoftInterrupt = React.useCallback(
    async (interruptId?: string) => {
      setSoftInterrupts((prev) =>
        interruptId ? prev.filter((i) => i.id !== interruptId) : [],
      );
      try {
        await callRpc("sessions.cancelSoftInterrupts", {
          sessionId,
          interruptId,
        });
      } catch {
        // ignore offline errors
      }
    },
    [sessionId],
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

  const allTurns = React.useMemo(
    () => (liveTurn ? [...visibleHistoryTurns, liveTurn] : visibleHistoryTurns),
    [liveTurn, visibleHistoryTurns],
  );

  return {
    sessionId,
    turns: allTurns,
    isStreaming,
    fileChangesSnapshot,
    setFileChangesSnapshot,
    pendingPermission: storePermission,
    pendingQuestion,
    softInterrupts,
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
    cancelSoftInterrupt,
    forkFromTurn,
    togglePinTurn,
    retryTurn,
  };
}
