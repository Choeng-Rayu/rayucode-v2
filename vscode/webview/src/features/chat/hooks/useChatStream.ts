import * as React from "react";

import {
  callRpc,
  createHarnessStreamTracker,
  createStreamBatcher,
  isVsCodeWebview,
  mapHarnessFrameToLiveEvents,
  mapHistoryMessagesToTurns,
  onHarnessFrame,
  sendHarnessRequest,
  useAppStore,
  type ExecutionTurn,
  type HarnessHistoryMessageLike,
  type InlineDiffCardData,
  type MappedLiveTraceEvent,
  type OptimisticUserTurn,
} from "@/lib";
import type { SessionSummaryView } from "@shared/vscodeProtocol";

import type { ApprovalCardRequest } from "../components/ApprovalCard";
import type { CitationItem } from "../components/CiteLink";
import type { ClarifyingQuestionRequest } from "../components/ClarifyingQuestionCard";
import type { ExtendedWorkStepGroup } from "../components/WorkTrace";

export interface TurnBulletItem {
  id: string;
  title: string;
  body: string;
  citations: CitationItem[];
}

export interface ChatTurnView extends Omit<ExecutionTurn, "groups" | "answerBullets"> {
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
    userRefFiles: "vscode/webview/src/features/shell/components/AppShell.tsx:1-60",
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
            intent: "Searched \"ShardStore::lookup\" across crates/ (4 hits)",
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

const EMPTY_DIFF: InlineDiffCardData = {
  id: "diff_empty",
  file: "",
  additions: 0,
  deletions: 0,
  hint: "",
  lines: [],
};

function buildOptimisticLiveTurn(turn: OptimisticUserTurn): ChatTurnView {
  return {
    id: turn.id,
    sessionId: turn.sessionId,
    userPrompt: turn.prompt,
    userRefFiles: turn.refFiles,
    userImages: turn.images,
    workedDuration: "1s",
    isLive: true,
    notes: [],
    groups: [],
    activeToolStatus: "Thinking...",
    answerIntro: "",
    answerBullets: [],
    diffCard: EMPTY_DIFF,
    timestamp: "Just now",
    credits: "0.00 cr",
    kvCachePct: 94,
    pinned: false,
  };
}

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
}

export interface UseChatStreamResult {
  sessionId: string;
  turns: ChatTurnView[];
  isStreaming: boolean;
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
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const storePermission = useAppStore((s) => s.pendingPermission);
  const pendingUserTurn = useAppStore((s) => s.pendingUserTurn);
  const consumeOptimisticTurn = useAppStore((s) => s.consumeOptimisticTurn);
  const setStorePermission = useAppStore((s) => s.setPendingPermission);
  const setIsStreamActive = useAppStore((s) => s.setIsStreamActive);
  const setActiveSession = useAppStore((s) => s.setActiveSession);

  const sessionId =
    options.sessionId ?? storeSessionId ?? (!isVsCodeWebview() ? "ses_vscode_shell" : "");

  const isMockDemoSession = !isVsCodeWebview() && sessionId === "ses_vscode_shell";

  const [turns, setTurns] = React.useState<ChatTurnView[]>(() => {
    if (options.initialTurns) return options.initialTurns;
    return isMockDemoSession ? DEFAULT_SAMPLE_TURNS : [];
  });
  const [liveTurn, setLiveTurn] = React.useState<ChatTurnView | null>(() => {
    if (pendingUserTurn && (!sessionId || pendingUserTurn.sessionId === sessionId)) {
      return buildOptimisticLiveTurn(pendingUserTurn);
    }
    return null;
  });
  const [pendingQuestion, setPendingQuestion] =
    React.useState<ClarifyingQuestionRequest | null>(null);
  const [softInterrupts, setSoftInterrupts] = React.useState<
    SoftInterruptQueueItem[]
  >([]);
  const [rewoundTurnId, setRewoundTurnId] = React.useState<string | null>(null);

  // Consume optimistic turns queued by HomePage or workspace SessionComposer
  React.useEffect(() => {
    if (!pendingUserTurn) return;
    if (sessionId && pendingUserTurn.sessionId !== sessionId) return;
    setLiveTurn((prev) => {
      if (prev && prev.id === pendingUserTurn.id) return prev;
      return buildOptimisticLiveTurn(pendingUserTurn);
    });
    consumeOptimisticTurn(pendingUserTurn.id);
  }, [consumeOptimisticTurn, pendingUserTurn, sessionId]);

  // Reset/hydrate turns when active session changes (never bleed fake sample turns onto live sessions)
  const prevSessionRef = React.useRef(sessionId);
  React.useEffect(() => {
    if (options.initialTurns) {
      setTurns(options.initialTurns);
      prevSessionRef.current = sessionId;
      return;
    }
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      const pending = useAppStore.getState().pendingUserTurn;
      const hasMatchingPending =
        Boolean(pending && pending.sessionId === sessionId);
      setLiveTurn((prev) => {
        if (prev && prev.sessionId === sessionId) return prev;
        return hasMatchingPending && pending
          ? buildOptimisticLiveTurn(pending)
          : null;
      });
      setSoftInterrupts([]);
      setRewoundTurnId(null);
      setTurns(
        !isVsCodeWebview() && sessionId === "ses_vscode_shell"
          ? DEFAULT_SAMPLE_TURNS
          : [],
      );
    }
  }, [options.initialTurns, sessionId]);

  // Hydrate real session history via sessions.history RPC when switching/attaching non-mock sessions
  const hydrateHistory = React.useCallback(
    (messages: HarnessHistoryMessageLike[]) => {
      if (!sessionId) return;
      setTurns(toChatTurnViews(sessionId, messages));
    },
    [sessionId],
  );

  React.useEffect(() => {
    if (options.initialTurns) return;
    if (!sessionId) return;
    // Keep rich sample turns for the standalone demo session when running outside VS Code
    if (!isVsCodeWebview() && sessionId === "ses_vscode_shell") return;

    let cancelled = false;
    void callRpc("sessions.history", { sessionId })
      .then((res) => {
        if (cancelled) return;
        const messages: HarnessHistoryMessageLike[] = (res.messages ?? []).map(
          (msg) => ({
            role: msg.role,
            content: msg.content,
          }),
        );
        if (messages.length > 0) {
          hydrateHistory(messages);
        }
      })
      .catch(() => {
        // Ignore offline/unavailable history errors; optimistic/live stream still renders
      });

    return () => {
      cancelled = true;
    };
  }, [hydrateHistory, options.initialTurns, sessionId]);

  const isStreaming = Boolean(liveTurn?.isLive);

  React.useEffect(() => {
    setIsStreamActive(isStreaming);
  }, [isStreaming, setIsStreamActive]);

  const applyBatchedEvents = React.useCallback(
    (batch: MappedLiveTraceEvent[]) => {
      if (batch.length === 0) return;

      for (const ev of batch) {
        if (ev.type === "permission-request") {
          setStorePermission({
            sessionId: ev.sessionId || sessionId,
            requestId: ev.requestId,
            toolName: ev.toolName,
            description: ev.description,
            riskTier: ev.riskTier,
          });
        }
      }

      setLiveTurn((prev) => {
        let current: ChatTurnView = prev ?? {
          id: `live_${sessionId}_${Date.now()}`,
          sessionId,
          userPrompt: "",
          workedDuration: "1s",
          isLive: true,
          notes: [],
          groups: [],
          activeToolStatus: null,
          answerIntro: "",
          answerBullets: [],
          diffCard: EMPTY_DIFF,
          timestamp: "Just now",
          credits: "0.00 cr",
          kvCachePct: 94,
          pinned: false,
        };

        let completedTurn: ChatTurnView | null = null;

        for (const ev of batch) {
          switch (ev.type) {
            case "note":
              current = {
                ...current,
                notes: [...current.notes, ev.text],
              };
              break;
            case "promote-note":
              if (current.answerIntro.trim()) {
                current = {
                  ...current,
                  notes: [...current.notes, current.answerIntro.trim()],
                  answerIntro: "",
                };
              }
              break;
            case "tool-status":
              current = {
                ...current,
                activeToolStatus: ev.label,
                showLiveBackgroundPill: Boolean(
                  ev.label &&
                    /running command|cargo|npm|pnpm|pytest|bash|shell/i.test(
                      ev.label,
                    ),
                ),
              };
              break;
            case "step": {
              const gId = ev.groupId ?? "wg_live";
              const gTitle = ev.groupTitle ?? "Read files, ran commands";
              const existingIdx = current.groups.findIndex(
                (g) => g.id === gId,
              );
              let nextGroups: ExtendedWorkStepGroup[];
              if (existingIdx >= 0) {
                nextGroups = current.groups.map((g, idx) =>
                  idx === existingIdx
                    ? { ...g, steps: [...g.steps, ev.step] }
                    : g,
                );
              } else {
                nextGroups = [
                  ...current.groups,
                  { id: gId, title: gTitle, steps: [ev.step] },
                ];
              }
              current = { ...current, groups: nextGroups };
              break;
            }
            case "artifact":
              current = {
                ...current,
                artifacts: [...(current.artifacts ?? []), ev.artifact],
              };
              break;
            case "answer-delta":
              current = {
                ...current,
                answerIntro: `${current.answerIntro}${ev.delta}`,
              };
              break;
            case "duration":
              current = {
                ...current,
                workedDuration: ev.workedDuration,
              };
              break;
            case "complete":
              completedTurn = {
                ...current,
                isLive: false,
                activeToolStatus: null,
                showLiveBackgroundPill: false,
                workedDuration: ev.workedDuration || current.workedDuration,
                credits: ev.credits ?? current.credits,
                kvCachePct: ev.kvCachePct ?? current.kvCachePct,
                timestamp: ev.timestamp ?? "Just now",
              };
              break;
            default:
              break;
          }
        }

        if (completedTurn) {
          const finished = completedTurn;
          setTurns((old) => [...old, finished]);
          return null;
        }

        return current;
      });
    },
    [sessionId, setStorePermission],
  );

  const batcherRef = React.useRef<ReturnType<
    typeof createStreamBatcher<MappedLiveTraceEvent>
  > | null>(null);

  React.useEffect(() => {
    const batcher = createStreamBatcher<MappedLiveTraceEvent>(
      applyBatchedEvents,
      16,
    );
    batcherRef.current = batcher;
    return () => {
      batcher.dispose();
      batcherRef.current = null;
    };
  }, [applyBatchedEvents]);

  const pushLiveEvents = React.useCallback(
    (events: MappedLiveTraceEvent[]) => {
      const batcher = batcherRef.current;
      if (!batcher) {
        applyBatchedEvents(events);
        return;
      }
      for (const ev of events) {
        batcher.push(ev);
      }
      if (
        events.some(
          (e) => e.type === "complete" || e.type === "permission-request",
        )
      ) {
        batcher.flushNow();
      }
    },
    [applyBatchedEvents],
  );

  // Subscribe to live harness frames from the Extension Host
  React.useEffect(() => {
    const tracker = createHarnessStreamTracker();
    const unsub = onHarnessFrame((frame) => {
      const frameSession =
        typeof frame.session_id === "string" ? frame.session_id : null;
      if (frameSession && frameSession !== sessionId) return;

      if (frame.ev === "question_request" || frame.ev === "ask_user_question") {
        const reqId = String(frame.request_id ?? `q_${Date.now()}`);
        const prompt = String(
          frame.prompt ?? frame.question ?? "How would you like to proceed?",
        );
        const rawOpts = Array.isArray(frame.options) ? frame.options : [];
        setPendingQuestion({
          requestId: reqId,
          sessionId,
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

      const mapped = mapHarnessFrameToLiveEvents(frame, tracker);
      if (mapped.length > 0) {
        pushLiveEvents(mapped);
      }
    });
    return unsub;
  }, [pushLiveEvents, sessionId]);

  const sendPrompt = React.useCallback(
    (
      prompt: string,
      opts?: {
        refFiles?: string;
        images?: Array<{ name: string; dataUrl: string }>;
      },
    ) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

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

      setLiveTurn({
        id: `live_${sessionId}_${Date.now()}`,
        sessionId,
        userPrompt: trimmed,
        userRefFiles: opts?.refFiles,
        userImages: opts?.images,
        workedDuration: "1s",
        isLive: true,
        notes: [],
        groups: [],
        activeToolStatus: "Thinking...",
        answerIntro: "",
        answerBullets: [],
        diffCard: EMPTY_DIFF,
        timestamp: "Just now",
        credits: "0.00 cr",
        kvCachePct: 94,
        pinned: false,
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
      setPendingQuestion(null);
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
    setPendingQuestion(null);
  }, []);

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
      setTurns((prev) => {
        const idx = prev.findIndex((t) => t.id === turnId);
        return idx >= 0 ? prev.slice(0, idx + 1) : prev;
      });
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
    if (!options.initialTurns) {
      setTurns(DEFAULT_SAMPLE_TURNS);
    }
    try {
      await callRpc("sessions.rewindUndo", { sessionId });
    } catch {
      // ignore offline errors
    }
  }, [options.initialTurns, sessionId]);

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
      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, pinned } : t)),
      );
    },
    [],
  );

  const retryTurn = React.useCallback(
    (turnId: string) => {
      const target = turns.find((t) => t.id === turnId);
      if (target) {
        sendPrompt(target.userPrompt);
      }
    },
    [sendPrompt, turns],
  );

  const allTurns = React.useMemo(
    () => (liveTurn ? [...turns, liveTurn] : turns),
    [liveTurn, turns],
  );

  return {
    sessionId,
    turns: allTurns,
    isStreaming,
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
