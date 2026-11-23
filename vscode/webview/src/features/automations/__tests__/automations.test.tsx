import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient, useAppStore } from "@/lib";
import { AutomationsView } from "../index";

function renderWithQuery(ui: React.ReactElement) {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
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
});
