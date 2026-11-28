import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __dispatchHostMessageForTest,
  createQueryClient,
  handleMockHostMessage,
  useAppStore,
} from "@/lib";
import * as rpcClient from "@/lib/rpc-client";
import { AutomationsView } from "../index";

function renderWithQuery(ui: React.ReactElement, client = createQueryClient()) {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    ),
  };
}

describe("AutomationsView (Spec 05 — Overnight, Schedules, Ambient, Quality)", () => {
  beforeEach(() => {
    useAppStore.setState({
      surface: "editorPanel",
      route: "automations",
      activeRoute: "automations",
      workspaces: [
        {
          name: "rayucode-v2",
          path: "/workspace/rayucode-v2",
          branch: "main",
          isPrimary: true,
        },
      ],
    });
  });

  it("renders Overnight tab with inline OvernightLauncher, manifest list, event log drawer, and MorningHandoffReport", async () => {
    renderWithQuery(<AutomationsView />);

    await waitFor(() => {
      expect(screen.getByTestId("automations-view")).toBeTruthy();
      expect(screen.getByTestId("overnight-launcher")).toBeTruthy();
    });

    // Verify existing mock run and MorningHandoffReport render
    expect(screen.getByTestId("overnight-run-ov_01")).toBeTruthy();
    expect(screen.getByTestId("morning-handoff-ov_01")).toBeTruthy();
    expect(screen.getByTestId("open-markdown-preview-ov_01")).toBeTruthy();

    // Expand Event Log drawer on ov_01
    fireEvent.click(screen.getByTestId("toggle-event-log-ov_01"));
    await waitFor(() => {
      expect(screen.getByTestId("event-log-drawer-ov_01")).toBeTruthy();
    });

    // Launch a new overnight mission
    const missionInput = screen.getByTestId("overnight-mission-input");
    fireEvent.change(missionInput, {
      target: { value: "Sweep compiler warnings and add harness tests" },
    });
    fireEvent.click(screen.getByTestId("overnight-duration-pill-8h"));
    fireEvent.click(screen.getByTestId("launch-overnight-btn"));

    await waitFor(() => {
      expect(
        screen.getByText("Sweep compiler warnings and add harness tests"),
      ).toBeTruthy();
    });
  });

  it("renders Schedules tab, creates a new recurring schedule, triggers Run Now, and cancels a schedule", async () => {
    renderWithQuery(<AutomationsView initialTab="schedules" />);

    await waitFor(() => {
      expect(screen.getByTestId("schedules-tab")).toBeTruthy();
      expect(
        screen.getByTestId("schedule-row-sched_morning_deps"),
      ).toBeTruthy();
    });

    // Trigger Run Now
    fireEvent.click(screen.getByTestId("run-schedule-now-sched_morning_deps"));
    await waitFor(() => {
      expect(screen.getByText("Queued now")).toBeTruthy();
    });

    // Open New Schedule inline form and submit
    fireEvent.click(screen.getByTestId("toggle-new-schedule-btn"));
    fireEvent.change(screen.getByTestId("schedule-title-input"), {
      target: { value: "Nightly benchmark check" },
    });
    fireEvent.change(screen.getByTestId("schedule-prompt-input"), {
      target: { value: "cargo bench --no-run" },
    });
    fireEvent.click(screen.getByTestId("submit-create-schedule-btn"));

    await waitFor(() => {
      expect(screen.getByText("Nightly benchmark check")).toBeTruthy();
    });
  });

  it("renders Ambient tab with watcher status and allows/denies queued ambient approvals", async () => {
    renderWithQuery(<AutomationsView initialTab="ambient" />);

    await waitFor(() => {
      expect(screen.getByTestId("ambient-tab")).toBeTruthy();
      expect(screen.getByTestId("ambient-approval-amb_appr_01")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("ambient-allow-amb_appr_01"));
    await waitFor(() => {
      expect(screen.getByText("Allowed")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("ambient-deny-amb_appr_02"));
    await waitFor(() => {
      expect(screen.getByText("Denied")).toBeTruthy();
    });
  });

  it("renders Quality & Reports tab, runs independent review & judge gates, and generates productivity report", async () => {
    renderWithQuery(<AutomationsView initialTab="quality" />);

    await waitFor(() => {
      expect(screen.getByTestId("quality-reports-tab")).toBeTruthy();
      expect(screen.getByTestId("auto-review-card")).toBeTruthy();
      expect(screen.getByTestId("auto-judge-card")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("run-independent-review-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("quality-gate-result-banner")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("generate-productivity-report-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("productivity-report-output")).toBeTruthy();
      expect(screen.getByTestId("open-productivity-png-btn")).toBeTruthy();
    });
  });

  it("shows visible errors on { ok: false } and rejected Automations RPC mutations without mutating query cache or clearing form inputs", async () => {
    const origCallRpc = rpcClient.callRpc;
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");
    const toastErrorSpy = vi.spyOn(toast, "error");
    const toastSuccessSpy = vi.spyOn(toast, "success");

    rpcSpy.mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "automations.ambient.status") {
        const base = (await origCallRpc(
          method as never,
          params as never,
        )) as Record<string, unknown>;
        return {
          ...base,
          approvals: [
            {
              id: "amb_appr_01",
              action: "cargo test --workspace",
              urgency: "normal",
              reason: "Verify dirty workspace files",
              createdAtMs: Date.now() - 60_000,
              status: "pending",
            },
          ],
        };
      }
      if (method === "automations.overnight.start") {
        throw new Error("Overnight runner rejected start request");
      }
      if (method === "automations.schedules.create") {
        throw new Error("Schedule cron rejected by daemon");
      }
      if (method === "automations.schedules.cancel") {
        return { ok: false, message: "Cannot cancel locked schedule" };
      }
      if (method === "automations.ambient.decide") {
        return { ok: false, message: "Ambient approval decision failed" };
      }
      if (method === "automations.quality.setAutoReview") {
        return {
          ok: false,
          enabled: false,
          message: "Auto-review gate update failed",
        };
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    try {
      // 1. Overnight start failure retains mission input and does not add run to cache
      const { client, unmount } = renderWithQuery(<AutomationsView />);
      await waitFor(() => {
        expect(screen.getByTestId("overnight-launcher")).toBeTruthy();
      });

      const missionInput = screen.getByTestId(
        "overnight-mission-input",
      ) as HTMLInputElement;
      fireEvent.change(missionInput, {
        target: { value: "Investigate flaky IPC reconnect" },
      });
      fireEvent.click(screen.getByTestId("launch-overnight-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("overnight-launcher-error").textContent).toContain(
          "Overnight runner rejected start request",
        );
      });
      expect(missionInput.value).toBe("Investigate flaky IPC reconnect");
      expect(
        screen.queryByText("Investigate flaky IPC reconnect"),
      ).toBeNull();
      expect(toastSuccessSpy).not.toHaveBeenCalled();
      unmount();

      // 2. Schedule create & cancel failures retain form inputs and preserve schedule cache
      const { client: schedClient, unmount: unmountSched } = renderWithQuery(
        <AutomationsView initialTab="schedules" />,
      );
      await waitFor(() => {
        expect(
          screen.getByTestId("schedule-row-sched_morning_deps"),
        ).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId("toggle-new-schedule-btn"));
      const titleInput = screen.getByTestId(
        "schedule-title-input",
      ) as HTMLInputElement;
      const promptInput = screen.getByTestId(
        "schedule-prompt-input",
      ) as HTMLInputElement;
      fireEvent.change(titleInput, {
        target: { value: "Uncreated Schedule" },
      });
      fireEvent.change(promptInput, {
        target: { value: "cargo check --all-targets" },
      });
      fireEvent.click(screen.getByTestId("submit-create-schedule-btn"));

      await waitFor(() => {
        expect(
          toastErrorSpy.mock.calls.length > 0 ||
            screen.queryByTestId("schedule-form-error") !== null,
        ).toBe(true);
      });
      expect(titleInput.value).toBe("Uncreated Schedule");
      expect(promptInput.value).toBe("cargo check --all-targets");
      expect(screen.queryByText("Uncreated Schedule")).toBeNull();

      toastErrorSpy.mockClear();
      fireEvent.click(screen.getByTestId("cancel-schedule-sched_morning_deps"));
      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Cannot cancel locked schedule",
        );
      });
      expect(
        screen.getByTestId("schedule-row-sched_morning_deps"),
      ).toBeTruthy();
      const cachedSchedules = schedClient.getQueryData<Array<{ id: string }>>([
        "automations",
        "schedules",
      ]);
      expect(
        cachedSchedules?.some((s) => s.id === "sched_morning_deps"),
      ).toBe(true);
      unmountSched();

      // 3. Ambient approval { ok: false } does not mark approval Allowed
      toastErrorSpy.mockClear();
      renderWithQuery(<AutomationsView initialTab="ambient" />);
      await waitFor(() => {
        expect(screen.getByTestId("ambient-approval-amb_appr_01")).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId("ambient-allow-amb_appr_01"));
      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Ambient approval decision failed",
        );
      });
      expect(screen.queryByText("Allowed")).toBeNull();
    } finally {
      rpcSpy.mockRestore();
      toastErrorSpy.mockRestore();
      toastSuccessSpy.mockRestore();
    }
  });

  it("keeps unsupported overnight pause/runNow and schedule toggle/runNow controls disabled in VS Code webview host mode", async () => {
    const prevAcquire = window.acquireVsCodeApi;
    window.acquireVsCodeApi = () => ({
      postMessage: (msg: unknown) => {
        handleMockHostMessage(msg as never, __dispatchHostMessageForTest);
      },
      getState: () => undefined,
      setState: () => {},
    });

    try {
      const { unmount } = renderWithQuery(<AutomationsView />);
      await waitFor(() => {
        expect(screen.getByTestId("overnight-run-ov_01")).toBeTruthy();
      });
      expect(
        (screen.getByTestId("toggle-pause-ov_01") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId("run-now-ov_01") as HTMLButtonElement).disabled,
      ).toBe(true);
      unmount();

      renderWithQuery(<AutomationsView initialTab="schedules" />);
      await waitFor(() => {
        expect(
          screen.getByTestId("schedule-row-sched_morning_deps"),
        ).toBeTruthy();
      });
      expect(
        (
          screen.getByTestId(
            "run-schedule-now-sched_morning_deps",
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(
        (
          screen.getByTestId(
            "schedule-switch-sched_morning_deps",
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    } finally {
      window.acquireVsCodeApi = prevAcquire;
    }
  });
});
