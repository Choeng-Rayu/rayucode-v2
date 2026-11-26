import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_45_RUST_TOOLS,
  ApprovalCard,
  ChatStream,
  ChatWorkspaceView,
  CiteLink,
  ClarifyingQuestionCard,
  classifyRustTool,
  coalesceTraceGroups,
  EditorialMarkdown,
  InlineDiffCard,
  resetAllLiveTraces,
  ShellCard,
  ToolStepCard,
  WorkTrace,
  type ChatTurnView,
  type ExtendedWorkStepGroup,
} from "@/features/chat";
import * as rpcClient from "@/lib/rpc-client";
import {
  __dispatchHostMessageForTest,
  createHarnessStreamTracker,
  createQueryClient,
  mapHarnessFrameToLiveEvents,
  useAppStore,
} from "@/lib";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RayuCode VS Code Active Chat & Quiet 3-Depth Trace (Wave 3B, Spec 02)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAllLiveTraces();
    useAppStore.setState({
      activeSessionId: "ses_vscode_shell",
      inspectorOpen: false,
      activeCodeFile: null,
      activeCodeLine: null,
      pendingPermission: null,
      pendingUserTurn: null,
      isStreamActive: false,
      midTurnSendMode: "steer",
      midTurnMessagesBySession: {},
      pausedQueueSessions: {},
      composerDrafts: {},
    });
  });

  it("coalesces consecutive read steps and renders 3-depth Quiet WorkTrace progressive disclosure", () => {
    const groups: ExtendedWorkStepGroup[] = [
      {
        id: "g1",
        title: "Read files",
        steps: [
          {
            id: "r1",
            kind: "read",
            label: "Read",
            files: [
              {
                file: "AppShell.tsx",
                path: "vscode/webview/src/features/shell/components/AppShell.tsx",
                line: 10,
                rangeLabel: "AppShell.tsx:10-40",
              },
            ],
          },
          {
            id: "r2",
            kind: "read",
            label: "Read",
            files: [
              {
                file: "lookup.rs",
                path: "crates/rayu-harness/src/lookup.rs",
                line: 42,
                rangeLabel: "lookup.rs:42-80",
              },
              {
                file: "globals.css",
                path: "vscode/webview/src/styles/globals.css",
                line: 1,
                rangeLabel: "globals.css:1-50",
              },
            ],
          },
          {
            id: "cmd1",
            kind: "command",
            command: "cargo test -p rayu-harness",
            displayCommand: "cargo test -p rayu-harness",
            output: "test result: ok. 12 passed; 0 failed",
            exitCode: 0,
            statusLabel: "Success · 1.2s",
            isMono: true,
          },
        ],
      },
    ];

    const coalesced = coalesceTraceGroups(groups);
    expect(coalesced).toHaveLength(1);
    // Two consecutive read steps coalesce into a single read step + 1 command step = 2 steps
    expect(coalesced[0]?.steps).toHaveLength(2);
    const firstStep = coalesced[0]?.steps[0];
    expect(firstStep?.kind).toBe("read");
    if (firstStep?.kind === "read") {
      expect(firstStep.files).toHaveLength(3);
      expect(firstStep.label).toBe("Explored 3 files");
    }

    renderWithQuery(
      <WorkTrace
        workedDuration="14s"
        notes={["Coalesced file exploration before running tests."]}
        groups={groups}
      />,
    );

    // Depth 0: single calm line by default
    expect(screen.getByTestId("work-trace").getAttribute("data-depth")).toBe(
      "0",
    );
    expect(screen.getByTestId("work-trace-summary").textContent).toBe(
      "Worked for 14s",
    );
    expect(screen.queryByTestId("work-trace-body")).toBeNull();

    // Expand to Depth 1
    fireEvent.click(screen.getByTestId("work-trace-toggle"));
    expect(screen.getByTestId("work-trace").getAttribute("data-depth")).toBe(
      "1",
    );
    expect(screen.getByTestId("work-trace-body")).toBeTruthy();
    expect(screen.getByText(/Explored 3 files/)).toBeTruthy();

    // Expand Depth 2 ShellCard
    fireEvent.click(screen.getByText("$ cargo test -p rayu-harness"));
    expect(screen.getByTestId("shell-card-cmd1")).toBeTruthy();
    expect(screen.getByTestId("shell-move-to-bg-cmd1")).toBeTruthy();
  });

  it("classifies all 45 Rust engine tools cleanly and expands ToolStepCard from Depth 1 to Depth 2", () => {
    expect(ALL_45_RUST_TOOLS.length).toBe(45);
    for (const toolName of ALL_45_RUST_TOOLS) {
      const meta = classifyRustTool(toolName);
      expect(meta.group).toBeTruthy();
      expect(meta.groupLabel).toBeTruthy();
    }

    renderWithQuery(
      <ToolStepCard
        step={{
          id: "step_ag",
          toolName: "agentgrep",
          intent: 'Searched "ShardStore" across crates/ (6 hits)',
          filePath: "crates/rayu-harness/src/lookup.rs",
          line: 42,
          durationLabel: "0.3s",
          payloadJson: '{"query":"ShardStore"}',
          output: "crates/rayu-harness/src/lookup.rs:42: impl ShardStore",
        }}
      />,
    );

    expect(
      screen.getByText('Searched "ShardStore" across crates/ (6 hits)'),
    ).toBeTruthy();
    expect(screen.queryByTestId("tool-step-detail-step_ag")).toBeNull();

    fireEvent.click(
      screen.getByText('Searched "ShardStore" across crates/ (6 hits)'),
    );
    expect(screen.getByTestId("tool-step-detail-step_ag")).toBeTruthy();
  });

  it("renders ApprovalCard risk_tier badges (safe, bounded, confirm, catastrophic) and dispatches decisions", () => {
    const onDecision = vi.fn();

    const { rerender } = renderWithQuery(
      <ApprovalCard
        request={{
          sessionId: "ses_vscode_shell",
          requestId: "perm_1",
          toolName: "bash",
          description: "Run database migration script?",
          command: "cargo sqlx migrate run",
          riskTier: "confirm",
        }}
        onDecision={onDecision}
      />,
    );

    expect(screen.getByTestId("approval-risk-badge").textContent).toBe(
      "Confirm",
    );
    expect(screen.getByTestId("approval-command-preview").textContent).toContain(
      "cargo sqlx migrate run",
    );

    fireEvent.click(screen.getByTestId("approval-allow-once-btn"));
    expect(onDecision).toHaveBeenCalledWith(
      "allow_once",
      expect.objectContaining({ requestId: "perm_1" }),
    );

    fireEvent.click(screen.getByTestId("approval-allow-session-btn"));
    expect(onDecision).toHaveBeenCalledWith(
      "allow_always",
      expect.objectContaining({ requestId: "perm_1" }),
    );

    fireEvent.click(screen.getByTestId("approval-deny-btn"));
    expect(onDecision).toHaveBeenCalledWith(
      "deny",
      expect.objectContaining({ requestId: "perm_1" }),
    );

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <ApprovalCard
          request={{
            sessionId: "ses_vscode_shell",
            requestId: "perm_2",
            toolName: "bash",
            description: "Force delete production volume?",
            riskTier: "catastrophic",
          }}
          onDecision={onDecision}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("approval-risk-badge").textContent).toBe(
      "Catastrophic",
    );
  });

  it("renders EditorialMarkdown, CiteLink file:line jump, code block VS Code actions, and MermaidDiagramSvg", () => {
    const postSpy = vi.fn();
    window.acquireVsCodeApi = () => ({
      postMessage: postSpy,
      getState: () => undefined,
      setState: () => undefined,
    });

    const md = [
      "Updated `crates/rayu-harness/src/lookup.rs:42` to avoid cloning.",
      "",
      "```rust",
      "pub fn lookup(&self, key: &str) -> Option<&ShardEntry> {",
      "    self.entries.get(key)",
      "}",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Webview] --> B[ExtensionHost]",
      "```",
    ].join("\n");

    renderWithQuery(
      <div>
        <EditorialMarkdown content={md} />
        <CiteLink
          citation={{
            label: "AppShell.tsx:24",
            file: "vscode/webview/src/features/shell/components/AppShell.tsx",
            line: 24,
            kind: "code",
          }}
        />
      </div>,
    );

    // Click inline CiteLink parsed from markdown
    fireEvent.click(
      screen.getByTestId("cite-link-crates/rayu-harness/src/lookup.rs:42"),
    );
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openFile",
      path: "crates/rayu-harness/src/lookup.rs",
      line: 42,
      column: undefined,
    });

    // Click explicit CiteLink component
    fireEvent.click(
      screen.getByTestId(
        "cite-link-vscode/webview/src/features/shell/components/AppShell.tsx:24",
      ),
    );
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openFile",
      path: "vscode/webview/src/features/shell/components/AppShell.tsx",
      line: 24,
      column: undefined,
    });

    // Click Insert at Cursor and Apply as Diff on fenced code block
    fireEvent.click(screen.getByTestId("code-block-insert-cursor"));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.editor.insertCode",
        mode: "cursor",
        languageId: "rust",
      }),
    );

    fireEvent.click(screen.getByTestId("code-block-apply-diff"));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.editor.insertCode",
        mode: "diff",
        languageId: "rust",
      }),
    );

    // Mermaid diagram block renders
    expect(screen.getByTestId("inline-mermaid-preview-btn")).toBeTruthy();

    delete window.acquireVsCodeApi;
  });

  it("renders InlineDiffCard with Open in VS Code Diff and ClarifyingQuestionCard", () => {
    const onDiffOpen = vi.fn();
    const onQuestionSubmit = vi.fn();

    renderWithQuery(
      <div>
        <InlineDiffCard
          diff={{
            id: "diff_1",
            file: "crates/rayu-harness/src/lookup.rs",
            additions: 2,
            deletions: 1,
            hint: "Zero-copy slice lookup",
            lines: [
              { kind: "del", oldLine: 42, text: "self.entries.get(&owned)" },
              { kind: "add", newLine: 42, text: "self.entries.get(key)" },
            ],
          }}
          onOpenInVSCodeDiff={onDiffOpen}
        />
        <ClarifyingQuestionCard
          question={{
            requestId: "q_1",
            sessionId: "ses_vscode_shell",
            prompt: "Which target branch should receive the migration?",
            options: [
              {
                id: "o1",
                key: "1",
                title: "main",
                subtitle: "Apply directly to primary branch",
                recommended: true,
              },
              {
                id: "o2",
                key: "2",
                title: "feat/migration",
                subtitle: "Create isolated feature branch",
              },
            ],
          }}
          onSubmitAnswer={onQuestionSubmit}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("open-vscode-diff-diff_1"));
    expect(onDiffOpen).toHaveBeenCalledWith(
      "crates/rayu-harness/src/lookup.rs",
    );

    fireEvent.click(screen.getByTestId("clarifying-option-1"));
    expect(onQuestionSubmit).toHaveBeenCalledWith({ q_1: "main" }, undefined);
  });

  it("renders ChatWorkspaceView with optional backgroundDockSlot and composerSlot", () => {
    renderWithQuery(
      <ChatWorkspaceView
        backgroundDockSlot={
          <div data-testid="mock-bg-dock">Background Dock Slot</div>
        }
        composerSlot={<div data-testid="mock-composer">Composer Slot</div>}
      />,
    );

    expect(screen.getByTestId("chat-workspace-view")).toBeTruthy();
    expect(screen.getByTestId("mock-bg-dock")).toBeTruthy();
    expect(screen.getByTestId("mock-composer")).toBeTruthy();
  });

  it("triggers background.backgroundTool when Move to Background is clicked on ShellCard", () => {
    const onMoveBg = vi.fn();
    renderWithQuery(
      <ShellCard
        standalone
        step={{
          id: "sh_bg_1",
          kind: "command",
          command: "cargo bench",
          displayCommand: "cargo bench",
          output: "running benchmarks...",
          exitCode: 0,
          statusLabel: "Running",
          isMono: true,
        }}
        onMoveToBackground={onMoveBg}
      />,
    );

    fireEvent.click(screen.getByTestId("shell-move-to-bg-sh_bg_1"));
    expect(onMoveBg).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Moved to Background")).toBeTruthy();
  });

  it("hydrates real session history via sessions.history RPC when attaching non-mock sessions", async () => {
    useAppStore.setState({
      activeSessionId: "ses_shard_lookup",
    });

    renderWithQuery(<ChatWorkspaceView sessionId="ses_shard_lookup" />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Profile ShardStore::lookup p99 latency under concurrent reads.",
        ),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(/lowering p99 lookup latency by 38%/i),
    ).toBeTruthy();
  });

  it("prevents ghost turns when turn_stopped is followed by turn_done", async () => {
    useAppStore.setState({
      activeSessionId: "ses_stop_once",
      pendingUserTurn: {
        id: "opt_stop_1",
        sessionId: "ses_stop_once",
        prompt: "Run benchmark suite",
        createdAtMs: Date.now(),
      },
    });

    renderWithQuery(<ChatWorkspaceView sessionId="ses_stop_once" />);

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "turn_start",
          session_id: "ses_stop_once",
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "text_delta",
          session_id: "ses_stop_once",
          text: "Partial benchmark output before stop.",
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "turn_stopped",
          session_id: "ses_stop_once",
          reason: "cancelled",
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "turn_done",
          session_id: "ses_stop_once",
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Partial benchmark output before stop."),
      ).toBeTruthy();
    });

    const articles = document.querySelectorAll('[data-slot="execution-turn"]');
    expect(articles).toHaveLength(1);
  });

  it("clears matching steer on soft_interrupt_injected by client_id and records a live trace note", async () => {
    useAppStore.setState({
      activeSessionId: "ses_steer_live",
      pendingUserTurn: {
        id: "opt_steer_1",
        sessionId: "ses_steer_live",
        prompt: "Refactor auth handler",
        createdAtMs: Date.now(),
      },
      midTurnMessagesBySession: {
        ses_steer_live: [
          {
            id: "si_match_1",
            sessionId: "ses_steer_live",
            mode: "steer",
            text: "Keep token refresh idempotent",
            createdAtMs: Date.now(),
          },
          {
            id: "si_other_2",
            sessionId: "ses_steer_live",
            mode: "steer",
            text: "Preserve backward-compatible error codes",
            createdAtMs: Date.now() + 1,
          },
        ],
      },
    });

    renderWithQuery(<ChatWorkspaceView sessionId="ses_steer_live" />);

    expect(screen.getByTestId("midturn-item-si_match_1")).toBeTruthy();
    expect(screen.getByTestId("midturn-item-si_other_2")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "soft_interrupt_injected",
          session_id: "ses_steer_live",
          client_ids: ["si_match_1"],
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("midturn-item-si_match_1")).toBeNull();
      expect(screen.getByTestId("midturn-item-si_other_2")).toBeTruthy();
    });

    // Live WorkTrace auto-expands; expand if collapsed before verifying recorded steer note
    if (screen.getByTestId("work-trace").getAttribute("data-depth") === "0") {
      fireEvent.click(screen.getByTestId("work-trace-toggle"));
    }
    expect(
      screen.getByText("Steered: Keep token refresh idempotent"),
    ).toBeTruthy();
  });

  it("auto-drains next queued message on natural turn_done, and pauses auto-drain while preserving queued items after Stop/turn_stopped", async () => {
    const onDrain = vi.fn();

    useAppStore.setState({
      activeSessionId: "ses_drain_1",
      pendingUserTurn: {
        id: "opt_drain_1",
        sessionId: "ses_drain_1",
        prompt: "First task",
        createdAtMs: Date.now(),
      },
      midTurnMessagesBySession: {
        ses_drain_1: [
          {
            id: "q_next_1",
            sessionId: "ses_drain_1",
            mode: "queue",
            text: "Second queued follow-up",
            createdAtMs: Date.now(),
          },
          {
            id: "q_next_2",
            sessionId: "ses_drain_1",
            mode: "queue",
            text: "Third queued follow-up",
            createdAtMs: Date.now() + 1,
          },
        ],
      },
    });

    renderWithQuery(
      <ChatWorkspaceView
        sessionId="ses_drain_1"
        onDrainQueuedMessage={onDrain}
      />,
    );

    // Natural turn_done drains first queued message via microtask
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_start", session_id: "ses_drain_1" },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "text_delta", session_id: "ses_drain_1", text: "Done #1" },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_done", session_id: "ses_drain_1" },
      });
    });

    await waitFor(() => {
      expect(onDrain).toHaveBeenCalledTimes(1);
      expect(onDrain).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "q_next_1",
          mode: "queue",
          text: "Second queued follow-up",
        }),
      );
    });

    // Now simulate an active turn that gets cancelled/stopped with a pending steer + queued message
    onDrain.mockClear();
    act(() => {
      useAppStore.getState().addMidTurnMessage({
        id: "si_pending_stop",
        sessionId: "ses_drain_1",
        mode: "steer",
        text: "Uninjected steer note",
        createdAtMs: Date.now() + 2,
      });
      useAppStore.getState().enqueueOptimisticTurn({
        id: "opt_drain_2",
        sessionId: "ses_drain_1",
        prompt: "Second task",
        createdAtMs: Date.now() + 3,
      });
    });

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_start", session_id: "ses_drain_1" },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "turn_stopped",
          session_id: "ses_drain_1",
          reason: "cancelled",
        },
      });
    });

    await waitFor(() => {
      expect(useAppStore.getState().pausedQueueSessions["ses_drain_1"]).toBe(
        true,
      );
    });

    // Must NOT auto-drain on stop; queued item stays preserved and uninjected steer demoted to queue
    expect(onDrain).not.toHaveBeenCalled();
    const remaining =
      useAppStore.getState().midTurnMessagesBySession["ses_drain_1"] ?? [];
    expect(remaining.map((m) => ({ id: m.id, mode: m.mode }))).toEqual([
      { id: "q_next_2", mode: "queue" },
      { id: "si_pending_stop", mode: "queue" },
    ]);
  });

  it("promotes a queued item to live steer via promote-to-steer-<id> without interrupting", async () => {
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");

    useAppStore.setState({
      activeSessionId: "ses_promote_1",
      pendingUserTurn: {
        id: "opt_promote_1",
        sessionId: "ses_promote_1",
        prompt: "Investigate slow query",
        createdAtMs: Date.now(),
      },
      midTurnMessagesBySession: {
        ses_promote_1: [
          {
            id: "q_promote_target",
            sessionId: "ses_promote_1",
            mode: "queue",
            text: "Check composite index selectivity first",
            createdAtMs: Date.now(),
          },
        ],
      },
    });

    renderWithQuery(<ChatWorkspaceView sessionId="ses_promote_1" />);

    const promoteBtn = screen.getByTestId("promote-to-steer-q_promote_target");
    fireEvent.click(promoteBtn);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith("sessions.softInterrupt", {
        sessionId: "ses_promote_1",
        text: "Check composite index selectivity first",
        urgent: false,
        clientId: "q_promote_target",
      });
    });

    const updated =
      useAppStore.getState().midTurnMessagesBySession["ses_promote_1"] ?? [];
    expect(updated[0]?.mode).toBe("steer");
    expect(
      screen
        .getByTestId("midturn-item-q_promote_target")
        .getAttribute("data-midturn-mode"),
    ).toBe("steer");
  });

  it("handles Rust question_request + question_closed, catastrophic permission_request, and text_replace frames", async () => {
    useAppStore.setState({
      activeSessionId: "ses_rust_frames",
      pendingUserTurn: {
        id: "opt_rust_1",
        sessionId: "ses_rust_frames",
        prompt: "Apply schema update",
        createdAtMs: Date.now(),
      },
    });

    renderWithQuery(<ChatWorkspaceView sessionId="ses_rust_frames" />);

    // 1. text_delta followed by text_replace replaces the answer text cleanly
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_start", session_id: "ses_rust_frames" },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "text_delta",
          session_id: "ses_rust_frames",
          text: "Draft answer to be replaced",
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "text_replace",
          session_id: "ses_rust_frames",
          text: "Authoritative replacement response",
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Authoritative replacement response"),
      ).toBeTruthy();
      expect(screen.queryByText("Draft answer to be replaced")).toBeNull();
    });

    // 2. Rust permission_request with catastrophic (and legacy hard_deny -> catastrophic)
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "permission_request",
          session_id: "ses_rust_frames",
          request_id: "perm_cat_1",
          tool_name: "bash",
          description: "Drop staging tables?",
          risk_tier: "catastrophic",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("approval-card")).toBeTruthy();
      expect(screen.getByTestId("approval-risk-badge").textContent).toBe(
        "Catastrophic",
      );
      expect(
        screen.getByTestId("approval-card").getAttribute("data-risk-tier"),
      ).toBe("catastrophic");
    });

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "permission_request",
          session_id: "ses_rust_frames",
          request_id: "perm_legacy_2",
          tool_name: "bash",
          description: "Delete backup archive?",
          risk_tier: "hard_deny",
        },
      });
    });

    await waitFor(() => {
      expect(useAppStore.getState().pendingPermission?.riskTier).toBe(
        "catastrophic",
      );
    });

    // 3. Rust question_request with questions[0] + question_closed dismissal
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "question_request",
          session_id: "ses_rust_frames",
          request_id: "q_rust_1",
          questions: [
            {
              question: "Which deployment target should be updated?",
              multiSelect: false,
              options: [
                {
                  label: "Canary",
                  description: "Roll out to 5% traffic first",
                },
                {
                  label: "Production",
                  description: "Deploy directly to all regions",
                },
              ],
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("clarifying-question-card")).toBeTruthy();
      expect(
        screen.getByText("Which deployment target should be updated?"),
      ).toBeTruthy();
      expect(screen.getByText("Canary")).toBeTruthy();
      expect(screen.getByText("Roll out to 5% traffic first")).toBeTruthy();
    });

    // question_closed dismisses pendingQuestion cleanly
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "question_closed",
          session_id: "ses_rust_frames",
          request_id: "q_rust_1",
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("clarifying-question-card")).toBeNull();
    });
  });

  it("auto-expands WorkTrace while live, renders chronological timeline, and opens monochrome file links in VS Code", () => {
    const postSpy = vi.fn();
    window.acquireVsCodeApi = () => ({
      postMessage: postSpy,
      getState: () => undefined,
      setState: () => undefined,
    });

    const { rerender } = renderWithQuery(
      <WorkTrace
        workedDuration="3s"
        isLive
        showLiveBackgroundPill
        notes={["Checking lookup hot path."]}
        groups={[]}
        timeline={[
          { type: "note", id: "n1", text: "Checking lookup hot path." },
          {
            type: "group",
            group: {
              id: "g_tl",
              title: "Read files",
              steps: [
                {
                  id: "r_tl",
                  kind: "read",
                  label: "Read",
                  files: [
                    {
                      file: "lookup.rs",
                      path: "crates/rayu-harness/src/lookup.rs",
                      line: 42,
                      rangeLabel: "lookup.rs:42-80",
                    },
                  ],
                },
              ],
            },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("work-trace").getAttribute("data-depth")).toBe("1");
    expect(screen.getByTestId("work-trace-summary").textContent).toBe("Working · 3s");
    expect(screen.getByTestId("work-trace-live-bg-btn")).toBeTruthy();
    expect(screen.getByText("Checking lookup hot path.")).toBeTruthy();

    fireEvent.click(
      screen.getByTestId("trace-file-link-crates/rayu-harness/src/lookup.rs"),
    );
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openFile",
      path: "crates/rayu-harness/src/lookup.rs",
      line: 42,
    });

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <WorkTrace
          workedDuration="3s"
          isLive={false}
          notes={["Checking lookup hot path."]}
          groups={[]}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("work-trace").getAttribute("data-depth")).toBe("0");
    expect(screen.getByTestId("work-trace-summary").textContent).toBe(
      "Worked for 3s",
    );

    delete window.acquireVsCodeApi;
  });

  it("streams real model reasoning into WorkTrace while suppressing placeholders and raw tool parameters", () => {
    const tracker = createHarnessStreamTracker();

    // Synthetic cloud placeholder is filtered out
    expect(
      mapHarnessFrameToLiveEvents(
        { ev: "reasoning_delta", text: "Reasoning via Rayu Cloud..." },
        tracker,
      ),
    ).toEqual([]);

    // Real model reasoning emits reasoning-delta
    expect(
      mapHarnessFrameToLiveEvents(
        {
          ev: "reasoning_delta",
          text: "I should check the composer model sync before editing.",
        },
        tracker,
      ),
    ).toEqual([
      {
        type: "reasoning-delta",
        delta: "I should check the composer model sync before editing.",
      },
    ]);

    // Raw shell flags / tool parameters are summarized into clean human-readable labels
    mapHarnessFrameToLiveEvents(
      {
        ev: "tool_input_delta",
        call_id: "c_grep",
        delta: JSON.stringify({
          command:
            'grep -rn "Explain the active editor selection" --include="*" -l . 2>/dev/null | head -50',
        }),
      },
      tracker,
    );
    const doneEvents = mapHarnessFrameToLiveEvents(
      { ev: "tool_done", call_id: "c_grep", name: "bash", output: "matched.ts" },
      tracker,
    );
    expect(doneEvents[1]).toMatchObject({
      type: "step",
      step: {
        kind: "command",
        displayCommand: "Searched codebase",
        isMono: false,
      },
    });

    // WorkTrace renders the reasoning block cleanly and ToolStepCard never shows raw JSON payload
    renderWithQuery(
      <div>
        <WorkTrace
          workedDuration="2s"
          isLive
          notes={[]}
          groups={[]}
          timeline={[
            {
              type: "reasoning",
              id: "r1",
              text: "I should check the composer model sync before editing.",
            },
          ]}
        />
        <ToolStepCard
          defaultExpanded
          step={{
            id: "no_payload",
            toolName: "read_file",
            intent: "Read SessionComposer.tsx",
            payloadJson: '{"secret_param":"should_never_render"}',
            output: "ok",
          }}
        />
      </div>,
    );

    // Reasoning is collapsed by default and can be expanded/collapsed on click
    const reasoningToggle = screen.getByTestId("work-reasoning-toggle");
    expect(reasoningToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("work-reasoning-body")).toBeNull();

    fireEvent.click(reasoningToggle);
    expect(reasoningToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("work-reasoning-body").textContent).toContain(
      "I should check the composer model sync before editing.",
    );

    fireEvent.click(reasoningToggle);
    expect(reasoningToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("work-reasoning-body")).toBeNull();

    expect(screen.queryByText(/Payload/i)).toBeNull();
    expect(screen.queryByText(/should_never_render/)).toBeNull();
  });

  it("renders live working progress and status in the message footer after streamed content instead of duplicating it at the top", () => {
    const qc = createQueryClient();
    const baseTurn: ChatTurnView = {
      id: "turn_footer_live",
      sessionId: "ses_footer",
      userPrompt: "Read proposal and write mockup",
      workedDuration: "7s",
      notes: [],
      groups: [],
      timeline: [
        {
          type: "reasoning",
          id: "r_footer_1",
          text: "Analyzing project structure before creating the mockup.",
        },
      ],
      activeToolStatus: "Reading Project_Proposal.pdf...",
      answerIntro: "Here is the initial mockup draft.",
      answerBullets: [],
      diffCard: {
        id: "d_footer",
        file: "",
        additions: 0,
        deletions: 0,
        hint: "",
        lines: [],
      },
      timestamp: "Just now",
      credits: "",
      kvCachePct: 0,
      pinned: false,
      isLive: true,
    };

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ChatStream sessionId="ses_footer" turns={[baseTurn]} isStreaming />
      </QueryClientProvider>,
    );

    // Thinking block starts collapsed by default inside the live turn
    expect(
      screen.getByTestId("work-reasoning-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("work-reasoning-body")).toBeNull();

    // No top work-trace-toggle while live; working indicator lives in the message footer!
    expect(screen.queryByTestId("work-trace-toggle")).toBeNull();
    const footer = screen.getByTestId("turn-live-footer-turn_footer_live");
    expect(screen.getByTestId("work-trace-summary").textContent).toBe(
      "Working · 7s",
    );
    expect(screen.getByTestId("turn-live-status").textContent).toBe(
      "Reading Project_Proposal.pdf...",
    );

    // Verify footer appears AFTER the streamed answer block in DOM order
    const answerEl = document.querySelector('[data-slot="agent-answer"]');
    expect(answerEl).toBeTruthy();
    expect(
      Boolean(
        answerEl!.compareDocumentPosition(footer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    // When activeToolStatus clears while streaming answer, footer shows Writing response...
    rerender(
      <QueryClientProvider client={qc}>
        <ChatStream
          sessionId="ses_footer"
          turns={[
            {
              ...baseTurn,
              workedDuration: "11s",
              activeToolStatus: null,
            },
          ]}
          isStreaming
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("work-trace-summary").textContent).toBe(
      "Working · 11s",
    );
    expect(screen.getByTestId("turn-live-status").textContent).toBe(
      "Writing response...",
    );

    // When turn finishes, live footer swaps cleanly to TurnActions and top shows collapsed Worked for 11s
    rerender(
      <QueryClientProvider client={qc}>
        <ChatStream
          sessionId="ses_footer"
          turns={[
            {
              ...baseTurn,
              workedDuration: "11s",
              activeToolStatus: null,
              isLive: false,
            },
          ]}
          isStreaming={false}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("turn-live-footer-turn_footer_live")).toBeNull();
    expect(screen.getByTestId("turn-actions-turn_footer_live")).toBeTruthy();
    expect(screen.getByTestId("work-trace-summary").textContent).toBe(
      "Worked for 11s",
    );
  });

  it("ignores non-turn control errors (e.g. set_reasoning_effort) without aborting or polluting the active live stream", async () => {
    useAppStore.setState({
      activeSessionId: "ses_non_turn_err",
      pendingUserTurn: {
        id: "opt_non_turn_1",
        sessionId: "ses_non_turn_1",
        prompt: "Read project proposal",
        createdAtMs: Date.now(),
      },
    });
    // Align optimistic sessionId with rendered session
    useAppStore.setState({
      pendingUserTurn: {
        id: "opt_non_turn_1",
        sessionId: "ses_non_turn_err",
        prompt: "Read project proposal",
        createdAtMs: Date.now(),
      },
    });

    renderWithQuery(<ChatWorkspaceView sessionId="ses_non_turn_err" />);

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_start", session_id: "ses_non_turn_err" },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "text_delta",
          session_id: "ses_non_turn_err",
          text: "Reading proposal...",
        },
      });
      // Non-turn control error must NOT inject **Error:** or terminate the stream
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "error",
          session_id: "ses_non_turn_err",
          req: "set_reasoning_effort",
          non_turn: true,
          code: "timeout",
          message: "timeout: no reply to set_reasoning_effort within 15000ms",
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "text_delta",
          session_id: "ses_non_turn_err",
          text: " Still streaming cleanly!",
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Reading proposal\.\.\. Still streaming cleanly!/),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/no reply to set_reasoning_effort/i)).toBeNull();
    expect(useAppStore.getState().isStreamActive).toBe(true);
  });

  it("scroll-to-bottom button scrolls to latest message and re-engages sticky live auto-follow forever until user scrolls up", () => {
    const makeTurn = (text: string): ChatTurnView => ({
      id: "turn_live_scroll",
      sessionId: "ses_scroll",
      userPrompt: "Stream long report",
      workedDuration: "3s",
      notes: [],
      groups: [],
      answerIntro: text,
      answerBullets: [],
      diffCard: {
        id: "d0",
        file: "",
        additions: 0,
        deletions: 0,
        hint: "",
        lines: [],
      },
      timestamp: "Just now",
      credits: "",
      kvCachePct: 0,
      pinned: false,
      isLive: true,
    });

    const qc = createQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ChatStream
          sessionId="ses_scroll"
          turns={[makeTurn("Initial chunk")]}
          isStreaming
        />
      </QueryClientProvider>,
    );

    const viewport = document.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLDivElement;
    expect(viewport).toBeTruthy();

    let scrollHeight = 1200;
    const clientHeight = 400;
    let scrollTop = 800;
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });

    // User scrolls UP away from bottom -> button appears & auto-follow pauses
    scrollTop = 200;
    fireEvent.wheel(viewport, { deltaY: -120 });
    fireEvent.scroll(viewport);

    const scrollDownBtn = screen.getByTestId("chat-scroll-to-bottom-btn");
    expect(scrollDownBtn).toBeTruthy();

    // New streamed chunk arrives while user scrolled up -> stays at 200 (doesn't yank user)
    scrollHeight = 1600;
    rerender(
      <QueryClientProvider client={qc}>
        <ChatStream
          sessionId="ses_scroll"
          turns={[makeTurn("Initial chunk\nMore streamed output")]}
          isStreaming
        />
      </QueryClientProvider>,
    );
    expect(scrollTop).toBe(200);

    // User clicks scroll-down button -> snaps to bottom, hides button, AND stays live-following forever
    fireEvent.click(scrollDownBtn);
    expect(scrollTop).toBe(1600);
    expect(screen.queryByTestId("chat-scroll-to-bottom-btn")).toBeNull();

    // Subsequent streamed chunks grow scrollHeight -> auto-follow keeps snapping to latest bottom!
    scrollHeight = 2400;
    rerender(
      <QueryClientProvider client={qc}>
        <ChatStream
          sessionId="ses_scroll"
          turns={[
            makeTurn(
              "Initial chunk\nMore streamed output\nEven newer live tokens",
            ),
          ]}
          isStreaming
        />
      </QueryClientProvider>,
    );
    expect(scrollTop).toBe(2400);

    scrollHeight = 3200;
    rerender(
      <QueryClientProvider client={qc}>
        <ChatStream
          sessionId="ses_scroll"
          turns={[
            makeTurn(
              "Initial chunk\nMore streamed output\nEven newer live tokens\nFinal live tokens",
            ),
          ]}
          isStreaming
        />
      </QueryClientProvider>,
    );
    expect(scrollTop).toBe(3200);
  });
});
