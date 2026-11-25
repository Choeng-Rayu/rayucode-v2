import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_45_RUST_TOOLS,
  ApprovalCard,
  ChatWorkspaceView,
  CiteLink,
  ClarifyingQuestionCard,
  classifyRustTool,
  coalesceTraceGroups,
  EditorialMarkdown,
  InlineDiffCard,
  ShellCard,
  ToolStepCard,
  WorkTrace,
  type ExtendedWorkStepGroup,
} from "@/features/chat";
import { createQueryClient, useAppStore } from "@/lib";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RayuCode VS Code Active Chat & Quiet 3-Depth Trace (Wave 3B, Spec 02)", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: "ses_vscode_shell",
      inspectorOpen: false,
      activeCodeFile: null,
      activeCodeLine: null,
      pendingPermission: null,
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
});
