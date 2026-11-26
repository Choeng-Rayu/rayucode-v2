import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetMockV116StateForTest,
  __setMockV116StateForTest,
  createHarnessStreamTracker,
  createQueryClient,
  mapHarnessFrameToLiveEvents,
  mapHistoryMessagesToTurns,
} from "@/lib";

import { ModelEffortPopover } from "../components/ModelEffortPopover";
import { SessionComposer } from "../components/SessionComposer";

function renderComposer(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  __resetMockV116StateForTest();
});

describe("SessionComposer mid-sentence /skill autocomplete", () => {
  it("opens SlashCommandMenu mid-sentence and splices only the active /token", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;

    const text = "Please /rev";
    fireEvent.change(textarea, {
      target: {
        value: text,
        selectionStart: text.length,
        selectionEnd: text.length,
      },
    });

    const menu = screen.getByTestId("slash-command-menu");
    expect(menu).toBeTruthy();

    const reviewItem = screen
      .getAllByTestId("slash-command-item")
      .find((el) => el.getAttribute("data-command") === "/review");
    expect(reviewItem).toBeTruthy();

    fireEvent.click(reviewItem!);
    expect(textarea.value).toBe("Please /review ");
  });

  it("preserves trailing text when editing mid-sentence at caret", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("Check /rev before merging");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;

    textarea.setSelectionRange(10, 10);
    fireEvent.select(textarea, {
      target: { selectionStart: 10, selectionEnd: 10 },
    });

    const reviewItem = screen
      .getAllByTestId("slash-command-item")
      .find((el) => el.getAttribute("data-command") === "/review");
    expect(reviewItem).toBeTruthy();

    fireEvent.click(reviewItem!);
    expect(textarea.value).toBe("Check /review before merging");
  });

  it("gives @file mention precedence over / when typing a path with slashes", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;
    const text = "Inspect @src/app";
    fireEvent.change(textarea, {
      target: {
        value: text,
        selectionStart: text.length,
        selectionEnd: text.length,
      },
    });

    expect(screen.getByTestId("mention-menu")).toBeTruthy();
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();
  });

  it("renders two-group slash popover (Engine Commands + Separator + Skills + arg_hint) and dispatches real commands with inline feedback", async () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("");
      return (
        <SessionComposer
          sessionId="ses_vscode_shell"
          value={val}
          onValueChange={setVal}
        />
      );
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, {
      target: { value: "/", selectionStart: 1, selectionEnd: 1 },
    });

    await waitFor(() => {
      expect(screen.getByTestId("slash-group-engine")).toBeTruthy();
      expect(screen.getByTestId("slash-group-skills")).toBeTruthy();
      expect(screen.getByTestId("slash-group-separator")).toBeTruthy();
    });

    // arg_hint is rendered for /effort
    const hints = screen.getAllByTestId("slash-command-arghint");
    expect(hints.some((h) => h.textContent?.includes("<low|medium|high|xhigh|max>"))).toBe(true);

    // Click /compact -> dispatches real workspace.compact RPC and shows inline success banner
    const compactItem = screen
      .getAllByTestId("slash-command-item")
      .find((el) => el.getAttribute("data-command") === "/compact");
    expect(compactItem).toBeTruthy();
    fireEvent.click(compactItem!);

    await waitFor(() => {
      const banner = screen.getByTestId("composer-command-banner");
      expect(banner.getAttribute("data-tone")).toBe("success");
    });

    // Submitting /effort with missing arg shows error banner and preserves input
    fireEvent.change(textarea, {
      target: { value: "/effort", selectionStart: 7, selectionEnd: 7 },
    });
    fireEvent.keyDown(textarea, { key: "Escape" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      const banner = screen.getByTestId("composer-command-banner");
      expect(banner.getAttribute("data-tone")).toBe("error");
      expect(banner.textContent).toContain("Specify a reasoning effort");
    });
    expect(textarea.value).toBe("/effort");
  });

  it("adapts ModelEffortPopover dynamically for 0-stop models, N-stop xhigh ladders, and mid-turn busy deferral", async () => {
    const onSelectModel = vi.fn();
    const onSelectEffort = vi.fn();
    const onDeferredChange = vi.fn();

    // 1) 0-stop model: hides effort label on trigger and opens directly into Stage 2 with static header
    const zeroStopModels = [
      {
        id: "gpt-4o-mini",
        label: "GPT-4o Mini",
        provider: "openai",
        supportedEfforts: [] as string[],
        defaultEffort: null,
        contextWindow: 128_000,
      },
    ];
    const { unmount } = renderComposer(
      <ModelEffortPopover
        defaultOpen
        modelId="gpt-4o-mini"
        modelLabel="GPT-4o Mini"
        effort="medium"
        models={zeroStopModels}
        onSelectModel={onSelectModel}
        onSelectEffort={onSelectEffort}
      />,
    );

    expect(screen.queryByTestId("model-effort-trigger-label")).toBeNull();
    expect(screen.getByTestId("model-list-card")).toBeTruthy();
    expect(screen.getByTestId("model-list-header-static")).toBeTruthy();
    expect(screen.queryByTestId("model-list-back-btn")).toBeNull();
    unmount();

    // 2) Dynamic 6-stop ladder with xhigh + busy mid-turn deferral
    __setMockV116StateForTest({ busyMode: true });
    const sixStopModels = [
      {
        id: "gpt-5.2",
        label: "GPT-5.2",
        provider: "openai",
        supportedEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
        defaultEffort: "medium",
        contextWindow: 256_000,
      },
    ];

    renderComposer(
      <ModelEffortPopover
        defaultOpen
        sessionId="ses_vscode_shell"
        modelId="gpt-5.2"
        modelLabel="GPT-5.2"
        effort="xhigh"
        models={sixStopModels}
        deferredNotice="Applies on next turn"
        onDeferredChange={onDeferredChange}
        onSelectModel={onSelectModel}
        onSelectEffort={onSelectEffort}
      />,
    );

    // Header uses "Extra High" while compact slider tick uses "X-High"
    expect(screen.getByTestId("effort-level-value").textContent).toBe("Extra High");
    expect(screen.getByText("X-High")).toBeTruthy();
    expect(screen.getByTestId("effort-deferred-badge").textContent).toContain(
      "Applies on next turn",
    );

    // Clicking another stop while daemon is busy triggers onDeferredChange("Applies on next turn")
    const lowStop = document.querySelector('[data-effort-level="low"]')!;
    fireEvent.click(lowStop);
    await waitFor(() => {
      expect(onDeferredChange).toHaveBeenCalledWith("Applies on next turn");
    });
  });

  it("filters engine_internal / hidden history messages via session-core filterVisibleHistory and consumes ToolDone.duration_ms + TextDone.stop_reason", () => {
    const turns = mapHistoryMessagesToTurns("ses_test", [
      {
        role: "user",
        content: "Summarize the module",
        origin: "user_typed",
        visibility: "visible",
      },
      {
        role: "user",
        content: "Synthetic recovery prompt",
        origin: "engine_internal",
        visibility: "hidden",
      },
      {
        role: "assistant",
        content: "Here is the summary.",
      },
    ]);
    expect(turns.length).toBe(1);
    expect(turns[0]?.userPrompt).toBe("Summarize the module");
    expect(turns[0]?.answerIntro).toContain("Here is the summary.");

    const tracker = createHarnessStreamTracker();
    const toolEvents = mapHarnessFrameToLiveEvents(
      {
        ev: "tool_done",
        call_id: "c1",
        name: "bash",
        input: { command: "echo hi" },
        output: "hi",
        duration_ms: 412,
      },
      tracker,
    );
    const stepEv = toolEvents.find((e) => e.type === "step");
    expect(stepEv && stepEv.type === "step" && stepEv.step.kind === "command" ? stepEv.step.durationMs : undefined).toBe(412);

    mapHarnessFrameToLiveEvents(
      { ev: "text_done", stop_reason: "end_turn" },
      tracker,
    );
    const doneEvents = mapHarnessFrameToLiveEvents({ ev: "turn_done" }, tracker);
    const completeEv = doneEvents.find((e) => e.type === "complete");
    expect(completeEv && completeEv.type === "complete" ? completeEv.stopReason : undefined).toBe("end_turn");
  });
});
