import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundProcessView } from "@shared/vscodeProtocol";

import * as rpcClient from "@/lib/rpc-client";
import { __dispatchHostMessageForTest, useAppStore } from "@/lib";

import {
  BackgroundDockBar,
  BackgroundProcessDrawer,
  ProcessOutputTail,
  __resetProcessesStateForTest,
  parseAnsiSegments,
} from "../index";

const NOW = Date.now();

const SAMPLE_TASKS: BackgroundProcessView[] = [
  {
    taskId: "bg_cargo_test",
    sessionId: "ses_vscode_shell",
    group: "shells",
    toolName: "run_command",
    displayName: "cargo test -p rayu-harness",
    status: "running",
    progressKind: "determinate",
    percent: 64,
    current: 12,
    total: 19,
    unit: "tests",
    summary: "12/19 integration tests passed",
    etaSeconds: 38,
    outputFile: "/tmp/rayu-bg-cargo-test.log",
    startedAtMs: NOW - 72_000,
    updatedAtMs: NOW - 2_000,
    durationSecs: 72,
    unread: false,
  },
  {
    taskId: "bg_stalled_pkg",
    sessionId: "ses_vscode_shell",
    group: "shells",
    toolName: "run_command",
    displayName: "npm run package:vscode",
    status: "stalled",
    progressKind: "indeterminate",
    summary: "Bundling VSIX artifact",
    outputFile: "/tmp/rayu-bg-package.log",
    startedAtMs: NOW - 124_000,
    updatedAtMs: NOW - 65_000,
    durationSecs: 124,
    stallQuietSecs: 65,
    unread: false,
  },
  {
    taskId: "bg_done_check",
    sessionId: "ses_vscode_shell",
    group: "shells",
    toolName: "run_command",
    displayName: "cargo check --workspace",
    status: "completed",
    progressKind: "indeterminate",
    summary: "Finished dev profile target(s)",
    exitCode: 0,
    outputFile: "/tmp/rayu-bg-check.log",
    startedAtMs: NOW - 180_000,
    updatedAtMs: NOW - 162_000,
    durationSecs: 18,
    unread: true,
  },
  {
    taskId: "bg_failed_lint",
    sessionId: "ses_vscode_shell",
    group: "agents",
    toolName: "swarm_worker",
    displayName: "worker-2 · verify migration.sql",
    status: "failed",
    progressKind: "indeterminate",
    summary: "Migration check failed on line 42",
    exitCode: 1,
    outputFile: "/tmp/rayu-bg-worker2.log",
    startedAtMs: NOW - 240_000,
    updatedAtMs: NOW - 200_000,
    durationSecs: 40,
    unread: false,
  },
];

describe("RayuCode VS Code Background Process Viewer (Wave 3C, Spec 03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetProcessesStateForTest();
    useAppStore.setState({
      surface: "editorPanel",
      route: "workspace",
      activeRoute: "workspace",
      activeSessionId: "ses_vscode_shell",
      backgroundDrawerOpen: false,
      backgroundTasks: [],
      isStreamActive: false,
    });
  });

  it("renders zero noise (null) when background task list is idle, and reveals BackgroundDockBar when tasks arrive", async () => {
    const { container } = render(<BackgroundDockBar />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("background-dock-bar")).toBeNull();

    // Push live snapshot from host via onHostMessage
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.processes.snapshot",
        tasks: [SAMPLE_TASKS[0]],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("background-dock-bar")).toBeTruthy();
    });
    expect(screen.getByTestId("dock-active-count").textContent).toBe(
      "1 running",
    );
    expect(screen.getByTestId("dock-latest-process").textContent).toBe(
      "cargo test -p rayu-harness",
    );
    expect(screen.queryByTestId("dock-stall-watchdog")).toBeNull();
  });

  it("displays Stall Watchdog amber indicator on BackgroundDockBar and inside BackgroundProcessDrawer when a task is stalled", async () => {
    useAppStore.setState({
      backgroundTasks: SAMPLE_TASKS,
      backgroundDrawerOpen: true,
    });

    render(
      <div>
        <BackgroundDockBar />
        <BackgroundProcessDrawer />
      </div>,
    );

    const dockWatchdog = screen.getByTestId("dock-stall-watchdog");
    expect(dockWatchdog).toBeTruthy();
    expect(dockWatchdog.textContent).toContain("1 stalled");

    expect(screen.getByTestId("drawer-stalled-badge").textContent).toContain(
      "1 stalled",
    );
    expect(
      screen.getByTestId("process-stall-badge-bg_stalled_pkg").textContent,
    ).toContain("Stalled");

    // Stalled task is prioritized for initial inspection so its quiet warn banner is visible
    await waitFor(() => {
      expect(
        screen.getByTestId("output-stall-watchdog-banner").textContent,
      ).toContain("No output for 65s");
    });
  });

  it("filters processes across All, Running, Stalled, Completed, and Failed tabs and search input", async () => {
    useAppStore.setState({
      backgroundTasks: SAMPLE_TASKS,
      backgroundDrawerOpen: true,
    });

    render(<BackgroundProcessDrawer />);

    // All 4 sample tasks visible initially
    expect(screen.getByTestId("process-row-bg_cargo_test")).toBeTruthy();
    expect(screen.getByTestId("process-row-bg_stalled_pkg")).toBeTruthy();
    expect(screen.getByTestId("process-row-bg_done_check")).toBeTruthy();
    expect(screen.getByTestId("process-row-bg_failed_lint")).toBeTruthy();

    // Filter: Running (only non-stalled running tasks)
    fireEvent.mouseDown(screen.getByTestId("process-filter-running"));
    fireEvent.click(screen.getByTestId("process-filter-running"));
    await waitFor(() => {
      expect(screen.getByTestId("process-row-bg_cargo_test")).toBeTruthy();
      expect(screen.queryByTestId("process-row-bg_stalled_pkg")).toBeNull();
      expect(screen.queryByTestId("process-row-bg_done_check")).toBeNull();
    });

    // Filter: Stalled
    fireEvent.mouseDown(screen.getByTestId("process-filter-stalled"));
    fireEvent.click(screen.getByTestId("process-filter-stalled"));
    await waitFor(() => {
      expect(screen.getByTestId("process-row-bg_stalled_pkg")).toBeTruthy();
      expect(screen.queryByTestId("process-row-bg_cargo_test")).toBeNull();
    });

    // Filter: Completed
    fireEvent.mouseDown(screen.getByTestId("process-filter-completed"));
    fireEvent.click(screen.getByTestId("process-filter-completed"));
    await waitFor(() => {
      expect(screen.getByTestId("process-row-bg_done_check")).toBeTruthy();
      expect(screen.queryByTestId("process-row-bg_failed_lint")).toBeNull();
    });

    // Filter: Failed
    fireEvent.mouseDown(screen.getByTestId("process-filter-failed"));
    fireEvent.click(screen.getByTestId("process-filter-failed"));
    await waitFor(() => {
      expect(screen.getByTestId("process-row-bg_failed_lint")).toBeTruthy();
      expect(screen.queryByTestId("process-row-bg_done_check")).toBeNull();
    });

    // Back to All + Search filter
    fireEvent.mouseDown(screen.getByTestId("process-filter-all"));
    fireEvent.click(screen.getByTestId("process-filter-all"));
    const searchInput = screen.getByTestId("process-search-input");
    fireEvent.change(searchInput, { target: { value: "migration.sql" } });

    await waitFor(() => {
      expect(screen.getByTestId("process-row-bg_failed_lint")).toBeTruthy();
      expect(screen.queryByTestId("process-row-bg_cargo_test")).toBeNull();
    });
  });

  it("loads live output tail on selection and dispatches rayucode.editor.openFile and rayucode.editor.openTerminal", async () => {
    const postSpy = vi.spyOn(rpcClient, "postToHost");
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");

    useAppStore.setState({
      backgroundTasks: [SAMPLE_TASKS[0]],
      backgroundDrawerOpen: true,
    });

    render(<BackgroundProcessDrawer />);

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith("background.output", {
        taskId: "bg_cargo_test",
        maxBytes: 131072,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("output-tail-well").textContent).toContain(
        "running 50 tests",
      );
    });

    fireEvent.click(screen.getByTestId("output-open-file-button"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openFile",
      path: "/tmp/rayu-bg-cargo-test.log",
      preview: false,
    });

    fireEvent.click(screen.getByTestId("output-open-terminal-button"));
    expect(postSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openTerminal",
      cwd: undefined,
      name: "cargo test -p rayu-harness",
    });
  });

  it("executes background.cancel and background.cleanup RPC mutations and Alt+B foreground handoff", async () => {
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");

    useAppStore.setState({
      backgroundTasks: SAMPLE_TASKS,
      backgroundDrawerOpen: true,
      isStreamActive: true,
    });

    render(
      <div>
        <BackgroundDockBar />
        <BackgroundProcessDrawer />
      </div>,
    );

    // Stop active running task from row button
    fireEvent.click(screen.getByTestId("process-stop-bg_cargo_test"));
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith("background.cancel", {
        taskId: "bg_cargo_test",
      });
    });

    // Clean finished tasks
    fireEvent.click(screen.getByTestId("drawer-cleanup-button"));
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith("background.cleanup", undefined);
    });

    await waitFor(() => {
      const remaining = useAppStore.getState().backgroundTasks;
      expect(remaining.some((t) => t.taskId === "bg_done_check")).toBe(false);
      expect(remaining.some((t) => t.taskId === "bg_failed_lint")).toBe(false);
    });

    // Global Alt+B shortcut triggers background.backgroundTool
    fireEvent.keyDown(window, { key: "b", code: "KeyB", altKey: true });
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith("background.backgroundTool", {
        sessionId: "ses_vscode_shell",
      });
    });
  });

  it("renders ANSI-colored terminal output segments cleanly without raw escape noise", () => {
    const segments = parseAnsiSegments(
      "\u001b[32mPASS\u001b[0m \u001b[31mFAIL\u001b[0m",
    );
    expect(segments).toEqual([
      { text: "PASS", tone: "brand" },
      { text: " ", tone: "default" },
      { text: "FAIL", tone: "danger" },
    ]);

    render(
      <ProcessOutputTail
        task={SAMPLE_TASKS[0]}
        output={{
          taskId: "bg_cargo_test",
          content: "\u001b[32mok\u001b[0m\n\u001b[33mwarning\u001b[0m\n",
          truncated: true,
          byteLength: 131072,
          outputFile: "/tmp/rayu-bg-cargo-test.log",
          status: "running",
        }}
        follow={true}
        onFollowChange={() => {}}
        onRefresh={() => {}}
        onCopy={() => {}}
        onOpenFile={() => {}}
        onOpenTerminal={() => {}}
        onStop={() => {}}
      />,
    );

    expect(screen.getByTestId("output-truncated-banner")).toBeTruthy();
    expect(screen.getByTestId("output-tail-well").textContent).toContain("ok");
    expect(screen.getByTestId("output-tail-well").textContent).toContain(
      "warning",
    );
  });
});
