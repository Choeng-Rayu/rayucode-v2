import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileChangesSnapshotView } from "@shared/vscodeProtocol";

import { ChatStream, TurnFileSummaryCard, type ChatTurnView } from "@/features/chat";
import {
  __dispatchHostMessageForTest,
  createQueryClient,
  useAppStore,
} from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function makeSnapshot(
  overrides: Partial<FileChangesSnapshotView> = {},
): FileChangesSnapshotView {
  return {
    sessionId: "ses_review_1",
    latestTurnId: 3,
    totalPendingFiles: 2,
    totalAdditions: 18,
    totalDeletions: 5,
    files: [
      {
        path: "/repo/src/auth.ts",
        displayPath: "src/auth.ts",
        kind: "modified",
        status: "pending",
        additions: 12,
        deletions: 5,
        changedInLatestTurn: true,
        turnId: 3,
        editCount: 2,
        isBinary: false,
        undoable: true,
        canRedo: false,
        previewHunks: [
          {
            oldStart: 10,
            oldLines: 3,
            newStart: 10,
            newLines: 4,
            header: "@@ -10,3 +10,4 @@",
            lines: [
              " export function verifyToken(token: string) {",
              "-  return token.length > 0;",
              "+  const trimmed = token.trim();",
              "+  return trimmed.startsWith('rayu_');",
              " }",
            ],
          },
        ],
        previewTruncated: false,
        updatedAtMs: 1_700_000_000_000,
      },
      {
        path: "/repo/src/session.ts",
        displayPath: "src/session.ts",
        kind: "created",
        status: "pending",
        additions: 6,
        deletions: 0,
        changedInLatestTurn: false,
        turnId: 2,
        editCount: 1,
        isBinary: false,
        undoable: true,
        canRedo: false,
        previewHunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 2,
            header: "@@ -0,0 +1,2 @@",
            lines: ["+export const SESSION_TTL = 3600;", "+export const MAX_RETRIES = 3;"],
          },
        ],
        previewTruncated: false,
        updatedAtMs: 1_700_000_000_100,
      },
    ],
    ...overrides,
  };
}

describe("TurnFileSummaryCard & Live File Changes Sync", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: "ses_review_1",
      fileChangesBySession: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders summary header, collapses rows by default, expands inline diff, and dispatches openFile/openDiff host messages", () => {
    const postSpy = vi.spyOn(rpcClient, "postToHost").mockImplementation(() => {});
    const snapshot = makeSnapshot();

    renderWithQuery(<TurnFileSummaryCard snapshot={snapshot} />);

    expect(screen.getByTestId("turn-file-summary-card")).toBeTruthy();
    expect(screen.getByTestId("file-summary-count").textContent).toBe(
      "2 files changed",
    );
    expect(screen.getByTestId("file-summary-turn-count").textContent).toContain(
      "1 in this turn",
    );
    expect(screen.getByTestId("file-summary-stats").textContent).toContain("+18");
    expect(screen.getByTestId("file-summary-stats").textContent).toContain("5");

    // Inline diff is collapsed by default
    expect(screen.queryByTestId("file-summary-inline-diff-src/auth.ts")).toBeNull();

    // Expand inline diff preview
    fireEvent.click(screen.getByTestId("file-summary-toggle-src/auth.ts"));
    const inlineDiff = screen.getByTestId("file-summary-inline-diff-src/auth.ts");
    expect(inlineDiff).toBeTruthy();
    expect(inlineDiff.textContent).toContain("const trimmed = token.trim();");

    // Inline footer "Open in VS Code Diff" dispatches session-scoped openDiff
    fireEvent.click(
      screen.getByTestId("file-summary-inline-open-diff-src/auth.ts"),
    );
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openDiff",
      path: "/repo/src/auth.ts",
      sessionId: "ses_review_1",
      scope: "session",
    });

    // Clicking filename opens VS Code editor at first changed line (line 11: first '-' after line 10 context)
    fireEvent.click(screen.getByTestId("file-summary-open-file-src/auth.ts"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openFile",
      path: "/repo/src/auth.ts",
      line: 11,
    });

    // Clicking row "Diff" button opens native VS Code diff beside with scope: "session"
    fireEvent.click(screen.getByTestId("file-summary-diff-src/session.ts"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openDiff",
      path: "/repo/src/session.ts",
      sessionId: "ses_review_1",
      scope: "session",
    });
  });

  it("invokes Keep, Undo, Redo, Keep all, and Undo all RPCs and collapses into 1-line resolved receipt", async () => {
    const base = makeSnapshot();
    // Matches real Rust engine: totalAdditions/totalDeletions only count Pending files (0 after Keep all).
    const keptAllSnapshot: FileChangesSnapshotView = {
      ...base,
      totalPendingFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      files: base.files.map((f) => ({ ...f, status: "kept", canRedo: false })),
    };
    const undoneAllSnapshot: FileChangesSnapshotView = {
      ...base,
      totalPendingFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      files: base.files.map((f) => ({ ...f, status: "undone", canRedo: true })),
    };

    const callSpy = vi
      .spyOn(rpcClient, "callRpc")
      .mockImplementation((async (method: string) => {
        if (method === "changes.keep") {
          return {
            ok: true,
            snapshot: {
              ...base,
              totalPendingFiles: 1,
              files: [
                { ...base.files[0]!, status: "kept" },
                base.files[1]!,
              ],
            },
          };
        }
        if (method === "changes.keepAll") {
          return { ok: true, snapshot: keptAllSnapshot };
        }
        if (method === "changes.undoAll") {
          return { ok: true, snapshot: undoneAllSnapshot };
        }
        if (method === "changes.redoAll") {
          return { ok: true, snapshot: base };
        }
        return { ok: true };
      }) as typeof rpcClient.callRpc);

    function Harness() {
      const [snap, setSnap] = React.useState(base);
      return (
        <TurnFileSummaryCard snapshot={snap} onSnapshotUpdated={setSnap} />
      );
    }

    renderWithQuery(<Harness />);

    // Keep single file
    fireEvent.click(screen.getByTestId("file-summary-keep-src/auth.ts"));
    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith("changes.keep", {
        path: "/repo/src/auth.ts",
        sessionId: "ses_review_1",
      });
    });

    // Undo all transitions into collapsed 1-line undone receipt with Redo all
    fireEvent.click(screen.getByTestId("file-summary-undo-all-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("turn-file-summary-receipt")).toBeTruthy();
    });
    expect(screen.getByTestId("turn-file-summary-receipt").textContent).toContain(
      "Undid 2 files",
    );

    // Expand receipt Details and verify per-file Redo button is available
    fireEvent.click(screen.getByTestId("file-summary-receipt-expand-btn"));
    expect(screen.getByTestId("file-summary-redo-src/auth.ts")).toBeTruthy();

    // Collapse back and trigger Redo all
    fireEvent.click(screen.getByTestId("file-summary-receipt-collapse-btn"));
    fireEvent.click(screen.getByTestId("file-summary-redo-all-btn"));
    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith("changes.redoAll", {
        sessionId: "ses_review_1",
      });
      expect(screen.getByTestId("turn-file-summary-card")).toBeTruthy();
    });

    // Keep all collapses into 1-line kept receipt with real kept totals (+18 −5)
    fireEvent.click(screen.getByTestId("file-summary-keep-all-btn"));
    await waitFor(() => {
      const receiptText = screen.getByTestId(
        "turn-file-summary-receipt",
      ).textContent;
      expect(receiptText).toContain("Kept 2 files");
      expect(receiptText).toContain("+18");
      expect(receiptText).toContain("5");
    });
  });

  it("opens conflict Dialog when undo detects manual edits and supports Open in VS Code Diff, Cancel, and Force Restore", async () => {
    const base = makeSnapshot();
    const postSpy = vi.spyOn(rpcClient, "postToHost").mockImplementation(() => {});
    const callSpy = vi
      .spyOn(rpcClient, "callRpc")
      .mockImplementation((async (
        method: string,
        params?: Record<string, unknown>,
      ) => {
        if (method === "changes.undo" && !params?.force) {
          return {
            ok: false,
            conflict: true,
            message: "Manual edits detected in src/auth.ts",
            conflicts: [
              {
                path: "/repo/src/auth.ts",
                displayPath: "src/auth.ts",
                reason: "File modified on disk after AI turn completed",
              },
            ],
            snapshot: base,
          };
        }
        if (method === "changes.undo" && params?.force === true) {
          return {
            ok: true,
            conflict: false,
            conflicts: [],
            snapshot: {
              ...base,
              totalPendingFiles: 1,
              files: [
                { ...base.files[0]!, status: "undone", canRedo: true },
                base.files[1]!,
              ],
            },
          };
        }
        return { ok: true };
      }) as typeof rpcClient.callRpc);

    renderWithQuery(<TurnFileSummaryCard snapshot={base} />);

    fireEvent.click(screen.getByTestId("file-summary-undo-src/auth.ts"));

    await waitFor(() => {
      expect(screen.getByTestId("file-change-conflict-dialog")).toBeTruthy();
    });
    expect(
      screen.getByTestId("file-change-conflict-dialog").textContent,
    ).toContain("File modified on disk after AI turn completed");

    // Open in VS Code Diff inside conflict dialog
    fireEvent.click(screen.getByTestId("conflict-open-diff-btn"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openDiff",
      path: "/repo/src/auth.ts",
      sessionId: "ses_review_1",
      scope: "session",
    });

    // Force Restore calls changes.undo with force: true
    fireEvent.click(screen.getByTestId("conflict-force-restore-btn"));
    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith("changes.undo", {
        path: "/repo/src/auth.ts",
        sessionId: "ses_review_1",
        force: true,
      });
    });
  });

  it("anchors TurnFileSummaryCard under the latest finished turn in ChatStream and syncs store on rayucode.fileChanges.updated", async () => {
    const sampleTurn: ChatTurnView = {
      id: "turn_1",
      sessionId: "ses_vscode_shell",
      userPrompt: "Update AppShell container query classes",
      workedDuration: "4s",
      notes: [],
      groups: [],
      answerIntro: "Updated AppShell responsive breakpoints.",
      answerBullets: [],
      diffCard: {
        id: "empty",
        file: "",
        additions: 0,
        deletions: 0,
        hint: "",
        lines: [],
      },
      timestamp: "Just now",
      credits: "0.10 cr",
      kvCachePct: 95,
      pinned: false,
    };

    const snapshot = makeSnapshot({ sessionId: "ses_vscode_shell" });
    useAppStore.setState({
      activeSessionId: "ses_vscode_shell",
      surface: "editorPanel",
    });

    const unsub = rpcClient.onHostMessage((msg) => {
      useAppStore.getState().applyHostMessage(msg);
    });

    try {
      renderWithQuery(
        <ChatStream
          sessionId="ses_vscode_shell"
          turns={[sampleTurn]}
          fileChangesSnapshot={snapshot}
        />,
      );

      expect(screen.getByTestId("turn-file-summary-card")).toBeTruthy();

      const appShellPath =
        "vscode/webview/src/features/shell/components/AppShell.tsx";
      // Simulate host broadcasting rayucode.fileChanges.updated (e.g., user clicked Keep in Chat)
      __dispatchHostMessageForTest({
        type: "rayucode.fileChanges.updated",
        sessionId: "ses_vscode_shell",
        snapshot: {
          sessionId: "ses_vscode_shell",
          latestTurnId: 3,
          totalPendingFiles: 0,
          totalAdditions: 248,
          totalDeletions: 34,
          files: [
            {
              path: "/workspace/rayucode-v2/vscode/webview/src/styles/globals.css",
              displayPath: "vscode/webview/src/styles/globals.css",
              kind: "created",
              status: "kept",
              additions: 180,
              deletions: 0,
              changedInLatestTurn: false,
              turnId: 1,
              editCount: 1,
              isBinary: false,
              undoable: true,
              canRedo: false,
              previewHunks: [],
              previewTruncated: false,
              updatedAtMs: Date.now(),
            },
            {
              path: `/workspace/rayucode-v2/${appShellPath}`,
              displayPath: appShellPath,
              kind: "modified",
              status: "kept",
              additions: 68,
              deletions: 34,
              changedInLatestTurn: true,
              turnId: 3,
              editCount: 2,
              isBinary: false,
              undoable: true,
              canRedo: false,
              previewHunks: [],
              previewTruncated: false,
              updatedAtMs: Date.now(),
            },
          ],
        },
      });

      await waitFor(() => {
        const synced =
          useAppStore.getState().fileChangesBySession["ses_vscode_shell"];
        expect(synced?.totalPendingFiles).toBe(0);
        expect(
          synced?.files.find((f) => f.displayPath === appShellPath)?.status,
        ).toBe("kept");
      });
    } finally {
      unsub();
    }
  });

  it("opens Diff when clicking a deleted file name and explains >10 MiB non-undoable entries", () => {
    const postSpy = vi.spyOn(rpcClient, "postToHost").mockImplementation(() => {});
    const snap = makeSnapshot({
      totalPendingFiles: 2,
      totalAdditions: 0,
      totalDeletions: 5,
      files: [
        {
          path: "/repo/src/removed.ts",
          displayPath: "src/removed.ts",
          kind: "deleted",
          status: "pending",
          additions: 0,
          deletions: 5,
          changedInLatestTurn: true,
          turnId: 3,
          editCount: 1,
          isBinary: false,
          undoable: true,
          canRedo: false,
          previewHunks: [],
          previewTruncated: false,
          updatedAtMs: 1_700_000_000_000,
        },
        {
          path: "/repo/assets/huge.dat",
          displayPath: "assets/huge.dat",
          kind: "created",
          status: "pending",
          additions: 0,
          deletions: 0,
          changedInLatestTurn: true,
          turnId: 3,
          editCount: 1,
          isBinary: false,
          undoable: false,
          canRedo: false,
          previewHunks: [],
          previewTruncated: false,
          updatedAtMs: 1_700_000_000_100,
        },
      ],
    });

    renderWithQuery(<TurnFileSummaryCard snapshot={snap} />);

    // Clicking a deleted file name routes to native diff rather than failing to open missing file
    fireEvent.click(screen.getByTestId("file-summary-open-file-src/removed.ts"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openDiff",
      path: "/repo/src/removed.ts",
      sessionId: "ses_review_1",
      scope: "session",
    });

    // Non-undoable >10 MiB file disables Undo and renders explicit explanation when expanded
    expect(
      (screen.getByTestId("file-summary-undo-assets/huge.dat") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByTestId("file-summary-toggle-assets/huge.dat"));
    expect(
      screen.getByTestId("file-summary-inline-diff-assets/huge.dat").textContent,
    ).toMatch(/10 MiB snapshot limit/i);
  });

  it("hides TurnFileSummaryCard in ChatStream while AI is streaming and shows it after response finishes", () => {
    const sampleTurn: ChatTurnView = {
      id: "turn_stream_guard",
      sessionId: "ses_review_1",
      userPrompt: "Edit auth.ts",
      workedDuration: "3s",
      notes: [],
      groups: [],
      answerIntro: "Done.",
      answerBullets: [],
      diffCard: {
        id: "empty",
        file: "",
        additions: 0,
        deletions: 0,
        hint: "",
        lines: [],
      },
      timestamp: "Just now",
      credits: "0.05 cr",
      kvCachePct: 95,
      pinned: false,
    };
    const snap = makeSnapshot();

    const { rerender } = renderWithQuery(
      <ChatStream
        sessionId="ses_review_1"
        turns={[sampleTurn]}
        isStreaming={true}
        fileChangesSnapshot={snap}
      />,
    );

    expect(screen.queryByTestId("turn-file-summary-card")).toBeNull();

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <ChatStream
          sessionId="ses_review_1"
          turns={[sampleTurn]}
          isStreaming={false}
          fileChangesSnapshot={snap}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("turn-file-summary-card")).toBeTruthy();
  });

  it("shows only the 3 most recently changed files by default and toggles expand/collapse for all files", () => {
    const baseEntry = makeSnapshot().files[0]!;
    const fiveSnap = makeSnapshot({
      totalPendingFiles: 5,
      files: [
        {
          ...baseEntry,
          path: "/repo/src/oldest.ts",
          displayPath: "src/oldest.ts",
          changedInLatestTurn: false,
          updatedAtMs: 1_000,
        },
        {
          ...baseEntry,
          path: "/repo/src/recent-2.ts",
          displayPath: "src/recent-2.ts",
          changedInLatestTurn: true,
          updatedAtMs: 4_000,
        },
        {
          ...baseEntry,
          path: "/repo/src/older.ts",
          displayPath: "src/older.ts",
          changedInLatestTurn: false,
          updatedAtMs: 2_000,
        },
        {
          ...baseEntry,
          path: "/repo/src/recent-1.ts",
          displayPath: "src/recent-1.ts",
          changedInLatestTurn: true,
          updatedAtMs: 5_000,
        },
        {
          ...baseEntry,
          path: "/repo/src/recent-3.ts",
          displayPath: "src/recent-3.ts",
          changedInLatestTurn: false,
          updatedAtMs: 3_000,
        },
      ],
    });

    renderWithQuery(<TurnFileSummaryCard snapshot={fiveSnap} />);

    expect(screen.getByTestId("file-summary-count").textContent).toBe(
      "5 files changed",
    );
    expect(screen.getByTestId("file-summary-row-src/recent-1.ts")).toBeTruthy();
    expect(screen.getByTestId("file-summary-row-src/recent-2.ts")).toBeTruthy();
    expect(screen.getByTestId("file-summary-row-src/recent-3.ts")).toBeTruthy();
    expect(screen.queryByTestId("file-summary-row-src/older.ts")).toBeNull();
    expect(screen.queryByTestId("file-summary-row-src/oldest.ts")).toBeNull();

    const expandBtn = screen.getByTestId("file-summary-expand-all-btn");
    expect(expandBtn.textContent).toContain("Expand all 5 files (+2 more)");
    fireEvent.click(expandBtn);
    expect(screen.getByTestId("file-summary-row-src/older.ts")).toBeTruthy();
    expect(screen.getByTestId("file-summary-row-src/oldest.ts")).toBeTruthy();

    fireEvent.click(screen.getByTestId("file-summary-collapse-list-btn"));
    expect(screen.queryByTestId("file-summary-row-src/older.ts")).toBeNull();
    expect(screen.queryByTestId("file-summary-row-src/oldest.ts")).toBeNull();
  });
});
