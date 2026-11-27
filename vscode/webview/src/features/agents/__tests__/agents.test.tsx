import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { AgentsPersonasView } from "@/features/agents";
import { createQueryClient, useAppStore } from "@/lib";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("Agents & Personas Studio (VS Code)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    useAppStore.setState({
      surface: "editorPanel",
      route: "agents",
      activeRoute: "agents",
      activeSessionId: "ses_vscode_shell",
    });
  });

  it("renders subagent model routing, 5 per-role targets, personas, and supports creating & deleting personas", async () => {
    renderWithQuery(<AgentsPersonasView />);

    await waitFor(() => {
      expect(screen.getByTestId("agents-view")).toBeTruthy();
    });

    expect(screen.getByTestId("agents-subagent-model-row")).toBeTruthy();
    expect(screen.getByTestId("agents-role-row-swarm")).toBeTruthy();
    expect(screen.getByTestId("agents-role-row-review").textContent).toContain(
      "Resolves to rayu:claude-opus-4-5",
    );
    expect(screen.getByTestId("agents-profile-card-architect")).toBeTruthy();

    // Open quick blueprint -> create research persona
    fireEvent.click(screen.getByTestId("agents-preset-research"));
    await waitFor(() => {
      expect(screen.getByTestId("agents-persona-dialog")).toBeTruthy();
    });
    expect(
      (screen.getByTestId("persona-name-input") as HTMLInputElement).value,
    ).toBe("research");

    fireEvent.click(screen.getByTestId("persona-save-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("agents-profile-card-research")).toBeTruthy();
    });

    // Delete research persona
    fireEvent.click(screen.getByTestId("agents-delete-profile-research"));
    await waitFor(() => {
      expect(screen.queryByTestId("agents-profile-card-research")).toBeNull();
    });
  });
});
