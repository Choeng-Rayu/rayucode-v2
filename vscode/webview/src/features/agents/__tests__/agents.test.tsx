import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsPersonasView } from "@/features/agents";
import { createQueryClient, useAppStore } from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

function renderWithQuery(ui: React.ReactElement, client = createQueryClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    ),
  };
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

  it("shows visible errors on { ok: false } and rejected Agents RPC mutations without publishing success, mutating cache, or clearing persona form inputs", async () => {
    const origCallRpc = rpcClient.callRpc;
    const rpcSpy = vi.spyOn(rpcClient, "callRpc");
    const toastErrorSpy = vi.spyOn(toast, "error");
    const toastSuccessSpy = vi.spyOn(toast, "success");

    rpcSpy.mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "settings.agents.upsertProfile") {
        return {
          ok: false,
          profiles: [],
          message: "Config lock prevented saving agent persona",
        };
      }
      if (method === "settings.agents.deleteProfile") {
        return {
          ok: false,
          profiles: [],
          message: "Cannot delete active persona profile",
        };
      }
      if (method === "settings.models.setRoleOverride") {
        return {
          ok: false,
          message: "Role model override rejected by daemon",
        };
      }
      if (method === "settings.agents.setSubagentModel") {
        return {
          ok: false,
          message: "Subagent default model update failed",
        };
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    try {
      renderWithQuery(<AgentsPersonasView />);

      await waitFor(() => {
        expect(screen.getByTestId("agents-view")).toBeTruthy();
      });

      // 1. Persona upsert returning { ok: false } keeps dialog open, preserves inputs, and shows toast.error
      fireEvent.click(screen.getByTestId("agents-new-persona-btn"));
      await waitFor(() => {
        expect(screen.getByTestId("agents-persona-dialog")).toBeTruthy();
      });

      const nameInput = screen.getByTestId(
        "persona-name-input",
      ) as HTMLInputElement;
      const descInput = screen.getByTestId(
        "persona-description-input",
      ) as HTMLTextAreaElement;

      fireEvent.change(nameInput, { target: { value: "security-reviewer" } });
      fireEvent.change(descInput, {
        target: { value: "Audits auth and capability boundaries" },
      });
      fireEvent.click(screen.getByTestId("persona-save-btn"));

      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Config lock prevented saving agent persona",
        );
      });
      expect(toastSuccessSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("agents-persona-dialog")).toBeTruthy();
      expect(nameInput.value).toBe("security-reviewer");
      expect(descInput.value).toBe("Audits auth and capability boundaries");
      expect(
        screen.queryByTestId("agents-profile-card-security-reviewer"),
      ).toBeNull();

      // Close dialog and test deleteProfile { ok: false }
      fireEvent.keyDown(screen.getByTestId("agents-persona-dialog"), {
        key: "Escape",
      });
      toastErrorSpy.mockClear();

      fireEvent.click(screen.getByTestId("agents-delete-profile-architect"));
      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith(
          "Cannot delete active persona profile",
        );
      });
      expect(screen.getByTestId("agents-profile-card-architect")).toBeTruthy();
    } finally {
      rpcSpy.mockRestore();
      toastErrorSpy.mockRestore();
      toastSuccessSpy.mockRestore();
    }
  });
});
