import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __dispatchHostMessageForTest,
  createQueryClient,
  useAppStore,
} from "@/lib";

import {
  ChatWorkspaceView,
  LiveTraceController,
  resetAllLiveTraces,
  startSessionLiveTurn,
} from "../index";

describe("VS Code live trace persistence and shared 1s timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllLiveTraces();
    useAppStore.setState({
      activeSessionId: "ses_live_1",
      pendingPermission: null,
      isStreamActive: false,
      pendingUserTurn: null,
      fileChangesBySession: {},
    });
  });

  afterEach(() => {
    resetAllLiveTraces();
    vi.useRealTimers();
  });

  it("ticks Working duration every 1s, survives route/view unmount, and commits on turn_done", () => {
    const client = createQueryClient();

    const Harness = ({
      showChat,
      sessionId,
    }: {
      showChat: boolean;
      sessionId: string;
    }) => (
      <QueryClientProvider client={client}>
        <LiveTraceController />
        {showChat ? (
          <ChatWorkspaceView sessionId={sessionId} />
        ) : (
          <div data-testid="other-route" />
        )}
      </QueryClientProvider>
    );

    const { rerender } = render(<Harness showChat sessionId="ses_live_1" />);

    act(() => {
      startSessionLiveTurn({
        sessionId: "ses_live_1",
        userPrompt: "Run tests and explain",
      });
    });

    expect(screen.getByTestId("work-trace-summary").textContent).toBe(
      "Working · 1s",
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("work-trace-summary").textContent).toBe(
      "Working · 3s",
    );

    // Navigate away from chat to another route (unmounts ChatWorkspaceView, keeps LiveTraceController)
    rerender(<Harness showChat={false} sessionId="ses_live_1" />);
    expect(screen.getByTestId("other-route")).toBeTruthy();

    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "tool_exec",
          session_id: "ses_live_1",
          call_id: "c_1",
          name: "bash",
          input: { command: "cargo test" },
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "text_delta",
          session_id: "ses_live_1",
          text: "Streamed while on another route.",
        },
      });
      vi.advanceTimersByTime(50);
    });

    // Switch to another session and back
    rerender(<Harness showChat sessionId="ses_other" />);
    rerender(<Harness showChat sessionId="ses_live_1" />);

    expect(screen.getByText("Streamed while on another route.")).toBeTruthy();
    expect(screen.getByTestId("work-trace-live-bg-btn")).toBeTruthy();

    // Finish turn while mounted (and verify second turn_done does not duplicate)
    act(() => {
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: {
          ev: "tool_done",
          session_id: "ses_live_1",
          call_id: "c_1",
          name: "bash",
          input: { command: "cargo test" },
          output: "ok",
        },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_done", session_id: "ses_live_1" },
      });
      __dispatchHostMessageForTest({
        type: "rayucode.harness.frame",
        frame: { ev: "turn_done", session_id: "ses_live_1" },
      });
      vi.advanceTimersByTime(50);
    });

    expect(screen.getAllByText("Streamed while on another route.")).toHaveLength(
      1,
    );
    expect(screen.getByTestId("work-trace").getAttribute("data-live")).toBe(
      "false",
    );
  });
});
