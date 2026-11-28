import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FileChangeEntryView,
  FileChangesSnapshotView,
} from "@shared/vscodeProtocol";

import { InlineDiffCard } from "@/features/chat";
import {
  createQueryClient,
  useAppStore,
  type InlineDiffCardData,
} from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function makeDiff(
  overrides: Partial<InlineDiffCardData> = {},
): InlineDiffCardData {
  return {
    id: "diff_inline_1",
    file: "src/auth.ts",
    additions: 2,
    deletions: 1,
    hint: "Tightened token prefix validation",
    lines: [
      { kind: "context", oldLine: 10, newLine: 10, text: "export function verify(token: string) {" },
      { kind: "del", oldLine: 11, text: "  return token.length > 0;" },
      { kind: "add", newLine: 11, text: "  const trimmed = token.trim();" },
      { kind: "add", newLine: 12, text: "  return trimmed.startsWith('rayu_');" },
      { kind: "context", oldLine: 12, newLine: 13, text: "}" },
    ],
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<FileChangeEntryView> = {},
): FileChangeEntryView {
  return {
    path: "/repo/src/auth.ts",
    displayPath: "src/auth.ts",
    kind: "modified",
    status: "pending",
    additions: 2,
    deletions: 1,
    changedInLatestTurn: true,
    turnId: 2,
    editCount: 1,
    isBinary: false,
    undoable: true,
    canRedo: false,
    previewHunks: [],
    previewTruncated: false,
    updatedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSnapshot(
  entryOverrides: Partial<FileChangeEntryView> = {},
  sessionId = "ses_inline_1",
): FileChangesSnapshotView {
  const entry = makeEntry(entryOverrides);
  return {
    sessionId,
    latestTurnId: 2,
    totalPendingFiles: entry.status === "pending" ? 1 : 0,
    totalAdditions: entry.status === "pending" ? entry.additions : 0,
    totalDeletions: entry.status === "pending" ? entry.deletions : 0,
    files: [entry],
  };
}

describe("InlineDiffCard", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: "ses_inline_1",
      fileChangesBySession: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens unified FileReviewConflictDialog on conflict and supports Open Diff, Cancel, and Force Restore", async () => {
    const initialSnap = makeSnapshot({ status: "pending", undoable: true });
    const undoneSnap = makeSnapshot({ status: "undone", canRedo: true });
    useAppStore.getState().setFileChangesSnapshot("ses_inline_1", initialSnap);

    const postSpy = vi.spyOn(rpcClient, "postToHost").mockImplementation(() => {});
    const onOpenDiff = vi.fn();
    const onReject = vi.fn();
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
                reason: "File was modified on disk after AI turn",
              },
            ],
            snapshot: initialSnap,
          };
        }
        if (method === "changes.undo" && params?.force === true) {
          return {
            ok: true,
            conflict: false,
            conflicts: [],
            snapshot: undoneSnap,
          };
        }
        if (method === "changes.getSessionSummary") {
          return initialSnap;
        }
        return { ok: true };
      }) as typeof rpcClient.callRpc);

    renderWithQuery(
      <InlineDiffCard
        diff={makeDiff()}
        sessionId="ses_inline_1"
        onOpenInVSCodeDiff={onOpenDiff}
        onReject={onReject}
      />,
    );

    // Trigger conflict dialog via Reject
    fireEvent.click(screen.getByTestId("reject-diff-diff_inline_1"));
    await waitFor(() => {
      expect(screen.getByTestId("file-change-conflict-dialog")).toBeTruthy();
    });
    expect(
      screen.getByTestId("file-change-conflict-dialog").textContent,
    ).toContain("File was modified on disk after AI turn");

    // 1. Open Diff from conflict dialog
    fireEvent.click(screen.getByTestId("conflict-open-diff-btn"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openDiff",
      path: "/repo/src/auth.ts",
      sessionId: "ses_inline_1",
      scope: "session",
    });
    expect(onOpenDiff).toHaveBeenCalledWith("/repo/src/auth.ts");

    // 2. Cancel closes the dialog without invoking force undo
    fireEvent.click(screen.getByTestId("conflict-cancel-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("file-change-conflict-dialog")).toBeNull();
    });
    expect(callSpy).not.toHaveBeenCalledWith(
      "changes.undo",
      expect.objectContaining({ force: true }),
    );
    expect(onReject).not.toHaveBeenCalled();

    // 3. Reopen conflict dialog and confirm Force Restore
    fireEvent.click(screen.getByTestId("reject-diff-diff_inline_1"));
    await waitFor(() => {
      expect(screen.getByTestId("file-change-conflict-dialog")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("conflict-force-restore-btn"));

    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith("changes.undo", {
        sessionId: "ses_inline_1",
        path: "/repo/src/auth.ts",
        force: true,
      });
      expect(screen.queryByTestId("file-change-conflict-dialog")).toBeNull();
      expect(onReject).toHaveBeenCalledWith("diff_inline_1", "src/auth.ts");
      expect(
        screen
          .getByTestId("inline-diff-card-diff_inline_1")
          .getAttribute("data-decision"),
      ).toBe("rejected");
    });
  });

  it("lets live snapshot decision 'pending' take precedence over initialDecision", () => {
    useAppStore
      .getState()
      .setFileChangesSnapshot("ses_inline_1", makeSnapshot({ status: "pending" }));

    const { rerender } = renderWithQuery(
      <InlineDiffCard
        diff={makeDiff()}
        sessionId="ses_inline_1"
        initialDecision="accepted"
      />,
    );

    expect(
      screen
        .getByTestId("inline-diff-card-diff_inline_1")
        .getAttribute("data-decision"),
    ).toBe("pending");
    expect(screen.getByTestId("accept-diff-diff_inline_1")).toBeTruthy();
    expect(screen.getByTestId("reject-diff-diff_inline_1")).toBeTruthy();

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <InlineDiffCard
          diff={makeDiff()}
          sessionId="ses_inline_1"
          initialDecision="rejected"
        />
      </QueryClientProvider>,
    );

    expect(
      screen
        .getByTestId("inline-diff-card-diff_inline_1")
        .getAttribute("data-decision"),
    ).toBe("pending");
    expect(screen.getByTestId("accept-diff-diff_inline_1")).toBeTruthy();
    expect(screen.getByTestId("reject-diff-diff_inline_1")).toBeTruthy();
  });

  it("disables Undo when entry.undoable is false while keeping Accept enabled", () => {
    useAppStore
      .getState()
      .setFileChangesSnapshot(
        "ses_inline_1",
        makeSnapshot({ status: "pending", undoable: false }),
      );

    renderWithQuery(
      <InlineDiffCard diff={makeDiff()} sessionId="ses_inline_1" />,
    );

    const rejectBtn = screen.getByTestId(
      "reject-diff-diff_inline_1",
    ) as HTMLButtonElement;
    const acceptBtn = screen.getByTestId(
      "accept-diff-diff_inline_1",
    ) as HTMLButtonElement;

    expect(rejectBtn.disabled).toBe(true);
    expect(rejectBtn.title).toMatch(/10 MiB snapshot limit/i);
    expect(acceptBtn.disabled).toBe(false);
  });

  it("shows and enables Redo only when entry.canRedo is true on an undone entry", async () => {
    useAppStore
      .getState()
      .setFileChangesSnapshot(
        "ses_inline_1",
        makeSnapshot({ status: "undone", canRedo: false }),
      );

    const onReset = vi.fn();
    const pendingSnap = makeSnapshot({ status: "pending", canRedo: false });
    const callSpy = vi
      .spyOn(rpcClient, "callRpc")
      .mockImplementation((async (method: string) => {
        if (method === "changes.redo") {
          return { ok: true, snapshot: pendingSnap };
        }
        return { ok: true };
      }) as typeof rpcClient.callRpc);

    renderWithQuery(
      <InlineDiffCard
        diff={makeDiff()}
        sessionId="ses_inline_1"
        onReset={onReset}
      />,
    );

    expect(
      screen
        .getByTestId("inline-diff-card-diff_inline_1")
        .getAttribute("data-decision"),
    ).toBe("rejected");
    expect(screen.queryByTestId("undo-diff-diff_inline_1")).toBeNull();

    // Flip live snapshot entry to canRedo: true
    act(() => {
      useAppStore
        .getState()
        .setFileChangesSnapshot(
          "ses_inline_1",
          makeSnapshot({ status: "undone", canRedo: true }),
        );
    });

    await waitFor(() => {
      const redoBtn = screen.getByTestId(
        "undo-diff-diff_inline_1",
      ) as HTMLButtonElement;
      expect(redoBtn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId("undo-diff-diff_inline_1"));
    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith("changes.redo", {
        sessionId: "ses_inline_1",
        path: "/repo/src/auth.ts",
      });
      expect(onReset).toHaveBeenCalledWith("diff_inline_1", "src/auth.ts");
      expect(
        screen
          .getByTestId("inline-diff-card-diff_inline_1")
          .getAttribute("data-decision"),
      ).toBe("pending");
    });
  });
});
