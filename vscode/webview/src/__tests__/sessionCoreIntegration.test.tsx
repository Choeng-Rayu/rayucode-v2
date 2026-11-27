import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionSummaryView,
  WorkspaceLedgerView,
} from "@shared/vscodeProtocol";

import { TooltipProvider } from "@/components/ui";
import {
  ChatWorkspaceView,
  LiveTraceController,
  chatHistoryQueryKey,
  processHarnessFrame,
  reconcileStaleLiveTurnForSession,
  resetAllLiveTraces,
  startSessionLiveTurn,
  useLiveTraceStore,
} from "@/features/chat";
import { SidebarProjectsPane, StatusBarPill } from "@/features/shell";
import { createQueryClient, useAppStore } from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

describe("VS Code webview integration with @rayu-dev/rayucode-session-core", () => {
  beforeEach(() => {
    resetAllLiveTraces();
    useAppStore.setState({
      activeSessionId: null,
      activeSessionTitle: null,
      activeProjectPath: "/workspace/repo-a",
      activeDraft: null,
      workspaces: [
        { name: "repo-a", path: "/workspace/repo-a", isPrimary: true },
        { name: "repo-b", path: "/workspace/repo-b" },
      ],
      workspaceLedger: null,
      daemonStatus: {
        state: "connected",
        version: "rayu-harness-api-bridge/0.1.0",
        capabilities: ["sessions", "permissions"],
      },
      pendingPermission: null,
      isStreamActive: false,
      pendingUserTurn: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAllLiveTraces();
    cleanup();
  });

  it("settles ev: error frames in LiveTraceStore and invalidates both sessions and chat history queries", () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    startSessionLiveTurn({
      sessionId: "ses_err_1",
      userPrompt: "Run build",
      baseHistoryTurnCount: 0,
    });

    expect(
      useLiveTraceStore.getState().liveTurnsBySession["ses_err_1"]?.isLive,
    ).toBe(true);

    processHarnessFrame(
      {
        ev: "error",
        session_id: "ses_err_1",
        message: "Daemon returned 503",
      },
      queryClient,
    );

    // Live turn is settled and moved to completedTurns with error text
    expect(
      useLiveTraceStore.getState().liveTurnsBySession["ses_err_1"],
    ).toBeUndefined();
    const completed =
      useLiveTraceStore.getState().completedTurnsBySession["ses_err_1"] ?? [];
    expect(completed).toHaveLength(1);
    expect(completed[0]?.isLive).toBe(false);
    expect(completed[0]?.answerIntro).toContain("Daemon returned 503");

    // Both ["sessions"] and ["chat", "history", sessionId] were invalidated
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatHistoryQueryKey("ses_err_1"),
    });
  });

  it("ignores sessionless daemon connection closed errors without aborting an active turn or clearing pending permissions", () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    useAppStore.setState({
      activeSessionId: "ses_live_active",
      pendingPermission: {
        sessionId: "ses_live_active",
        requestId: "perm_1",
        toolName: "bash",
        description: "ls -la",
      },
    });
    startSessionLiveTurn({
      sessionId: "ses_live_active",
      userPrompt: "read my codebase",
      baseHistoryTurnCount: 0,
    });

    // Unbound/foreign socket disconnect arriving with no session_id
    processHarnessFrame(
      {
        ev: "error",
        code: "internal",
        message: "daemon connection closed",
      },
      queryClient,
      "ses_live_active",
    );

    expect(
      useLiveTraceStore.getState().liveTurnsBySession["ses_live_active"]?.isLive,
    ).toBe(true);
    expect(
      useLiveTraceStore.getState().completedTurnsBySession["ses_live_active"] ??
        [],
    ).toHaveLength(0);
    expect(useAppStore.getState().pendingPermission?.requestId).toBe("perm_1");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("clears stale liveTurn via shouldClearStaleLiveTurn when daemon reports idle past grace window", () => {
    const startedAt = 10_000;
    startSessionLiveTurn({
      sessionId: "ses_stale",
      userPrompt: "Hello",
      startedAtMs: startedAt,
    });
    useLiveTraceStore.setState((s) => ({
      lastEventAtMsBySession: {
        ...s.lastEventAtMsBySession,
        ses_stale: startedAt,
      },
    }));

    // Still within grace period -> do NOT clear
    expect(
      reconcileStaleLiveTurnForSession("ses_stale", "idle", {
        nowMs: startedAt + 1_000,
        gracePeriodMs: 2_500,
      }),
    ).toBe(false);
    expect(
      useLiveTraceStore.getState().liveTurnsBySession["ses_stale"],
    ).toBeTruthy();

    // Status running -> do NOT clear even past grace period
    expect(
      reconcileStaleLiveTurnForSession("ses_stale", "running", {
        nowMs: startedAt + 10_000,
        gracePeriodMs: 2_500,
      }),
    ).toBe(false);

    // Status idle + past grace window -> clear stale spinner
    expect(
      reconcileStaleLiveTurnForSession("ses_stale", "idle", {
        nowMs: startedAt + 5_000,
        gracePeriodMs: 2_500,
      }),
    ).toBe(true);
    expect(
      useLiveTraceStore.getState().liveTurnsBySession["ses_stale"],
    ).toBeUndefined();
  });

  it("never renders a duplicate user prompt bubble when sessions.history resolves mid-stream, while preserving intentional repeated prompts", async () => {
    const queryClient = createQueryClient();

    vi.spyOn(rpcClient, "callRpc").mockImplementation(async (method) => {
      if (method === "sessions.history") {
        return {
          sessionId: "ses_dedup",
          messages: [
            { id: "m1", role: "user", content: "Inspect shard lookup" },
          ],
        } as never;
      }
      if (method === "changes.getSessionSummary") {
        return {
          sessionId: "ses_dedup",
          latestTurnId: 0,
          totalPendingFiles: 0,
          totalAdditions: 0,
          totalDeletions: 0,
          files: [],
        } as never;
      }
      return {} as never;
    });

    startSessionLiveTurn({
      sessionId: "ses_dedup",
      userPrompt: "Inspect shard lookup",
      baseHistoryTurnCount: 0,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <LiveTraceController />
          <ChatWorkspaceView sessionId="ses_dedup" />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Inspect shard lookup")).toHaveLength(1);
    });
    expect(screen.getByTestId("work-trace").getAttribute("data-live")).toBe(
      "true",
    );

    // Now simulate an intentional repeated prompt after Turn 1 already exists in durable history
    cleanup();
    resetAllLiveTraces();
    const queryClient2 = createQueryClient();

    vi.spyOn(rpcClient, "callRpc").mockImplementation(async (method) => {
      if (method === "sessions.history") {
        return {
          sessionId: "ses_repeat",
          messages: [
            { id: "r1", role: "user", content: "Run tests" },
            { id: "r2", role: "assistant", content: "All tests passed." },
          ],
        } as never;
      }
      if (method === "changes.getSessionSummary") {
        return {
          sessionId: "ses_repeat",
          latestTurnId: 0,
          totalPendingFiles: 0,
          totalAdditions: 0,
          totalDeletions: 0,
          files: [],
        } as never;
      }
      return {} as never;
    });

    startSessionLiveTurn({
      sessionId: "ses_repeat",
      userPrompt: "Run tests",
      baseHistoryTurnCount: 1,
    });

    render(
      <QueryClientProvider client={queryClient2}>
        <TooltipProvider delayDuration={0}>
          <LiveTraceController />
          <ChatWorkspaceView sessionId="ses_repeat" />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Run tests")).toHaveLength(2);
    });
  });

  it("groups sessions disjointly without duplicating empty-workingDir sessions, defaults to open workspace scope with All Projects toggle, and activates lazy New Chat draft without eager sessions.create", async () => {
    const queryClient = createQueryClient();
    const now = Date.now();

    const sessions: SessionSummaryView[] = [
      {
        sessionId: "s_alpha",
        title: "Alpha task",
        workingDir: "/workspace/repo-a",
        status: "idle",
        updatedAtMs: now - 1_000,
      },
      {
        sessionId: "s_beta",
        title: "Beta task",
        workingDir: "/workspace/repo-b",
        status: "idle",
        updatedAtMs: now - 2_000,
      },
      {
        sessionId: "s_orphan",
        title: "Orphan without dir",
        workingDir: undefined,
        status: "idle",
        updatedAtMs: now - 3_000,
      },
    ];

    const ledger: WorkspaceLedgerView = {
      version: 1,
      updatedAt: now,
      workspaces: [
        {
          id: "ws_a",
          name: "repo-a",
          path: "/workspace/repo-a",
          canonicalPath: "/workspace/repo-a",
          sessionIds: ["s_alpha"],
          createdAt: now - 10_000,
          updatedAt: now,
          lastOpenedAt: now,
          isPrimary: true,
        },
        {
          id: "ws_b",
          name: "repo-b",
          path: "/workspace/repo-b",
          canonicalPath: "/workspace/repo-b",
          sessionIds: ["s_beta"],
          createdAt: now - 10_000,
          updatedAt: now - 1_000,
          lastOpenedAt: now - 1_000,
        },
      ],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      collapsedWorkspaceIds: [],
      manualWorkspaceOrder: [],
      openFolderPaths: ["/workspace/repo-a"],
    };

    const callRpcSpy = vi
      .spyOn(rpcClient, "callRpc")
      .mockImplementation(async (method) => {
        if (method === "sessions.list") {
          return { sessions, activeSessionId: "s_alpha" } as never;
        }
        if (method === "workspace.listFolders") {
          return {
            folders: [
              { name: "repo-a", path: "/workspace/repo-a", isPrimary: true },
            ],
          } as never;
        }
        if (method === "workspace.ledger.get") {
          return ledger as never;
        }
        return { ok: true } as never;
      });

    useAppStore.setState({
      workspaceLedger: ledger,
      workspaces: [{ name: "repo-a", path: "/workspace/repo-a", isPrimary: true }],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <SidebarProjectsPane />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    // Default scope shows repo-a and hides repo-b behind "All Projects (+1)"
    const groupA = await screen.findByTestId("project-group-repo-a");
    expect(await within(groupA).findByText("Alpha task")).toBeTruthy();
    expect(within(groupA).queryByText("Orphan without dir")).toBeNull();
    expect(screen.queryByTestId("project-group-repo-b")).toBeNull();

    // Empty-workingDir session appears once in ungrouped "Other sessions" (never duplicated!)
    const ungrouped = await screen.findByTestId("project-group-ungrouped");
    expect(within(ungrouped).getByText("Orphan without dir")).toBeTruthy();
    expect(screen.getAllByText("Orphan without dir")).toHaveLength(1);

    // Click "All Projects (+1)" scope toggle -> reveals repo-b disjointly
    const scopeToggle = screen.getByTestId("sidebar-scope-toggle");
    expect(scopeToggle.textContent).toContain("All Projects (+1)");
    fireEvent.click(scopeToggle);

    const groupB = await screen.findByTestId("project-group-repo-b");
    expect(await within(groupB).findByText("Beta task")).toBeTruthy();
    expect(within(groupB).queryByText("Orphan without dir")).toBeNull();
    expect(screen.getAllByText("Orphan without dir")).toHaveLength(1);

    // Clicking "New session" multiple times activates ONE lazy client-side draft and NEVER calls sessions.create!
    const newBtn = screen.getByTestId("sidebar-new-session-btn");
    fireEvent.click(newBtn);
    fireEvent.click(newBtn);

    expect(screen.getAllByTestId("sidebar-draft-row")).toHaveLength(1);
    expect(useAppStore.getState().activeDraft).toBeTruthy();
    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(
      callRpcSpy.mock.calls.filter(([method]) => method === "sessions.create"),
    ).toHaveLength(0);
  });

  it("formats daemon version cleanly with formatDaemonVersionLabel in StatusBarPill (never vrayu-harness-api...)", () => {
    const queryClient = createQueryClient();
    useAppStore.setState({
      daemonStatus: {
        state: "connected",
        version: "rayu-harness-api-bridge/0.1.0",
        capabilities: ["sessions"],
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <StatusBarPill />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    const pill = screen.getByTestId("status-bar-pill");
    expect(pill.textContent).toContain("v0.1.0");
    expect(pill.textContent).not.toContain("vrayu-harness");
  });
});
