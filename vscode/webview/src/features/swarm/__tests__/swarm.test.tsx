import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SWARM_LAUNCH_PRESETS,
  SwarmLaunchpad,
  SwarmView,
} from "@/features/swarm";
import * as rpcClient from "@/lib/rpc-client";
import { createQueryClient, useAppStore } from "@/lib";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("Swarm Mission Control (Wave 3D, Spec 04)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    useAppStore.setState({
      surface: "editorPanel",
      route: "swarm",
      activeRoute: "swarm",
    });
    vi.restoreAllMocks();
  });

  it("renders SwarmLaunchpad with 3 curated presets, goal input, and spawns preset squad via swarm.spawn RPC", async () => {
    const onSpawnWorker = vi.fn().mockResolvedValue({ ok: true });

    renderWithQuery(
      <SwarmLaunchpad
        existingAgentNames={[]}
        onSpawnWorker={onSpawnWorker}
      />,
    );

    expect(SWARM_LAUNCH_PRESETS.length).toBe(3);
    expect(screen.getByTestId("swarm-preset-feature-build")).toBeTruthy();
    expect(screen.getByTestId("swarm-preset-code-audit")).toBeTruthy();
    expect(screen.getByTestId("swarm-preset-bug-hunt")).toBeTruthy();

    fireEvent.click(screen.getByTestId("swarm-preset-bug-hunt"));

    const goalTextarea = screen.getByTestId(
      "swarm-launchpad-goal",
    ) as HTMLTextAreaElement;
    fireEvent.change(goalTextarea, {
      target: { value: "Fix race condition in ShardStore lookup retry loop" },
    });

    fireEvent.click(screen.getByTestId("launch-swarm-btn"));

    await waitFor(() => {
      expect(onSpawnWorker).toHaveBeenCalledTimes(2);
    });
    expect(onSpawnWorker).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        label: "fixer-1",
        role: "Worker",
        useWorktree: true,
      }),
    );
    expect(onSpawnWorker).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        label: "reviewer-1",
        role: "Reviewer",
      }),
    );
  });

  it("renders active SwarmTelemetryStrip with agent counts, worktrees, plan version, and cost/KV warm telemetry", async () => {
    renderWithQuery(<SwarmView />);

    await waitFor(() => {
      expect(screen.getByTestId("swarm-telemetry-strip")).toBeTruthy();
    });

    expect(screen.getByTestId("telemetry-total-agents").textContent).toContain(
      "2 agents",
    );
    expect(
      screen.getByTestId("telemetry-worktree-count").textContent,
    ).toContain("1 worktrees");
    expect(screen.getByTestId("telemetry-plan-label").textContent).toContain(
      "Plan v3",
    );
    expect(screen.getByTestId("telemetry-cost-kv").textContent).toContain(
      "93% KV warm",
    );
  });

  it("supports agent selection in AgentRoster, clickable owned file badge, and DM steering via swarm.dm RPC", async () => {
    const callRpcSpy = vi.spyOn(rpcClient, "callRpc");
    const postToHostSpy = vi.spyOn(rpcClient, "postToHost");

    renderWithQuery(<SwarmView />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-roster")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("select-agent-coordinator"));
    expect(screen.getByTestId("inspector-agent-label").textContent).toBe(
      "coordinator",
    );

    fireEvent.click(screen.getByTestId("select-agent-ui-shell"));
    expect(screen.getByTestId("inspector-agent-label").textContent).toBe(
      "ui-shell",
    );

    fireEvent.click(screen.getByTestId("owned-file-AppShell.tsx"));
    expect(postToHostSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.editor.openFile",
        path: "vscode/webview/src/features/shell/components/AppShell.tsx",
      }),
    );

    const dmInput = screen.getByTestId("agent-dm-input");
    fireEvent.change(dmInput, {
      target: { value: "Prioritize CompactTopBar accessibility attributes" },
    });
    fireEvent.click(screen.getByTestId("agent-dm-submit"));

    await waitFor(() => {
      expect(callRpcSpy).toHaveBeenCalledWith(
        "swarm.dm",
        expect.objectContaining({
          agentId: "ui-shell",
          message: "Prioritize CompactTopBar accessibility attributes",
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("Prioritize CompactTopBar accessibility attributes"),
      ).toBeTruthy();
    });
  });

  it("approves and rejects pending plan proposals in CoordinationLedger via swarm.planDecide RPC", async () => {
    const callRpcSpy = vi.spyOn(rpcClient, "callRpc");

    renderWithQuery(<SwarmView />);

    await waitFor(() => {
      expect(screen.getByTestId("coordination-ledger")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("telemetry-pending-proposals-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("ledger-plan-proposals")).toBeTruthy();
    });

    const approveBtn = screen.getByTestId("approve-proposal-prop_wave3_ledger");
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(callRpcSpy).toHaveBeenCalledWith(
        "swarm.planDecide",
        expect.objectContaining({
          proposalId: "prop_wave3_ledger",
          decision: "approve",
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("proposal-status-prop_wave3_ledger").textContent,
      ).toBe("approved");
    });
  });

  it("triggers Open in New VS Code Window for worktrees and renders Expand to Full Editor Panel in Compact Sidebar", async () => {
    const postToHostSpy = vi.spyOn(rpcClient, "postToHost");

    renderWithQuery(<SwarmView />);

    await waitFor(() => {
      expect(screen.getByTestId("coordination-ledger")).toBeTruthy();
    });

    const worktreesTab = screen.getByTestId("ledger-tab-worktrees");
    fireEvent.mouseDown(worktreesTab);
    fireEvent.click(worktreesTab);

    await waitFor(() => {
      expect(screen.getByTestId("open-worktree-window-wt_main")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("open-worktree-window-wt_main"));

    expect(postToHostSpy).toHaveBeenCalledWith({
      type: "rayucode.editor.openWorktreeWindow",
      path: "/workspace/rayucode-v2",
    });

    useAppStore.setState({ surface: "sidebar" });
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 360,
    });

    renderWithQuery(<SwarmView />);

    await waitFor(() => {
      expect(screen.getAllByTestId("swarm-expand-editor-btn").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId("swarm-expand-editor-btn")[0]);
    expect(postToHostSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.ui.openEditorPanel",
        route: "swarm",
      }),
    );
  });
});
