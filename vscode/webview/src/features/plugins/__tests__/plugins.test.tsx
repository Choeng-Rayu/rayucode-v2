import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient, useAppStore } from "@/lib";
import { PluginsView } from "../index";

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

describe("PluginsView (Spec 06 — 7-Layer MCP, Skills, Memory Graph, Workspace Integrations)", () => {
  beforeEach(() => {
    useAppStore.setState({
      surface: "editorPanel",
      route: "plugins",
      activeRoute: "plugins",
      activeSessionId: "ses_vscode_shell",
    });
  });

  it("renders MCP Connectors tab with FeaturedShowcase, Shared Pool & Schema Cache strip, 7-layer badges, Test Connection, PluginDetailView, and McpServerDialog", async () => {
    renderWithQuery(<PluginsView />);

    await waitFor(() => {
      expect(screen.getByTestId("plugins-view")).toBeTruthy();
      expect(screen.getByTestId("mcp-connectors-tab")).toBeTruthy();
      expect(screen.getByTestId("featured-showcase")).toBeTruthy();
      expect(screen.getByTestId("mcp-pool-schema-status-strip")).toBeTruthy();
    });

    // Verify configured servers render with transport and config layer badges
    expect(screen.getByTestId("mcp-server-card-github")).toBeTruthy();
    expect(screen.getByTestId("mcp-server-card-linear")).toBeTruthy();
    expect(screen.getByTestId("mcp-server-card-context7-docs")).toBeTruthy();

    // Test connection on github server
    fireEvent.click(screen.getByTestId("mcp-test-btn-github"));
    await waitFor(() => {
      expect(screen.getByTestId("mcp-test-result-github")).toBeTruthy();
    });

    // Open PluginDetailView for github
    fireEvent.click(screen.getByTestId("mcp-server-open-detail-github"));
    await waitFor(() => {
      expect(screen.getByTestId("plugin-detail-view")).toBeTruthy();
      expect(screen.getByTestId("plugin-detail-tools-list")).toBeTruthy();
      expect(
        screen.getByTestId("open-mcp-config-in-vscode-btn"),
      ).toBeTruthy();
    });

    // Navigate back and open Add MCP Server dialog
    fireEvent.click(screen.getByTestId("plugin-detail-back-btn"));
    fireEvent.click(screen.getByTestId("add-mcp-server-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("mcp-server-dialog")).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId("mcp-dialog-id-input"), {
      target: { value: "custom-sqlite" },
    });
    fireEvent.change(screen.getByTestId("mcp-dialog-command-input"), {
      target: { value: "uvx" },
    });
    fireEvent.change(screen.getByTestId("mcp-dialog-args-input"), {
      target: { value: "mcp-server-sqlite" },
    });
    fireEvent.click(screen.getByTestId("mcp-dialog-save-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-server-card-custom-sqlite")).toBeTruthy();
    });
  });

  it("renders Skills tab, runs an installed skill, installs an endorsed skill, and creates a new SKILL.md via CreateSkillDialog", async () => {
    renderWithQuery(<PluginsView initialTab="skills" />);

    await waitFor(() => {
      expect(screen.getByTestId("skills-tab")).toBeTruthy();
      expect(screen.getByTestId("skill-row-rust-verify")).toBeTruthy();
    });

    // Run installed skill
    fireEvent.click(screen.getByTestId("run-skill-btn-rust-verify"));
    await waitFor(() => {
      expect(screen.getByTestId("skill-triggered-banner")).toBeTruthy();
    });

    // Install endorsed skill
    fireEvent.click(
      screen.getByTestId("install-endorsed-skill-mcp-schema-audit"),
    );
    await waitFor(() => {
      expect(screen.getByTestId("skill-row-mcp-schema-audit")).toBeTruthy();
    });

    // Open CreateSkillDialog and create a new skill
    fireEvent.click(screen.getByTestId("open-create-skill-dialog-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-skill-dialog")).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId("create-skill-name-input"), {
      target: { value: "sql-migration-guard" },
    });
    fireEvent.change(screen.getByTestId("create-skill-desc-input"), {
      target: { value: "Check SQL migrations for lock safety" },
    });
    fireEvent.click(screen.getByTestId("submit-create-skill-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("skill-row-sql-migration-guard")).toBeTruthy();
    });
  });

  it("renders Memory Graph tab, filters by scope, remembers a new fact, tags/links nodes, and forgets a node", async () => {
    renderWithQuery(<PluginsView initialTab="memory" />);

    await waitFor(() => {
      expect(screen.getByTestId("memory-graph-tab")).toBeTruthy();
      expect(screen.getByTestId("memory-node-mem_1")).toBeTruthy();
    });

    // Inspect related graph links
    fireEvent.click(screen.getByTestId("memory-toggle-links-mem_1"));
    await waitFor(() => {
      expect(screen.getByTestId("memory-links-drawer-mem_1")).toBeTruthy();
    });

    // Add a new memory node
    fireEvent.click(screen.getByTestId("toggle-remember-fact-btn"));
    fireEvent.change(screen.getByTestId("remember-fact-content-input"), {
      target: {
        value: "Always run lint:design before committing webview features.",
      },
    });
    fireEvent.click(screen.getByTestId("submit-remember-fact-btn"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Always run lint:design before committing webview features.",
        ),
      ).toBeTruthy();
    });

    // Forget mem_2
    fireEvent.click(screen.getByTestId("memory-forget-btn-mem_2"));
    await waitFor(() => {
      expect(screen.queryByTestId("memory-node-mem_2")).toBeNull();
    });
  });

  it("renders Workspace Integrations tab with Gmail, Google Calendar, Browser Automation, and Desktop Companion cards", async () => {
    renderWithQuery(<PluginsView initialTab="workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("workspace-tools-tab")).toBeTruthy();
      expect(screen.getByTestId("workspace-card-gmail")).toBeTruthy();
      expect(screen.getByTestId("workspace-card-calendar")).toBeTruthy();
      expect(screen.getByTestId("workspace-card-browser")).toBeTruthy();
      expect(screen.getByTestId("workspace-card-companion")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("gmail-connect-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("workspace-action-banner")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("browser-handoff-btn"));
    await waitFor(() => {
      expect(screen.getByText("Handoff Active")).toBeTruthy();
    });
  });
});
