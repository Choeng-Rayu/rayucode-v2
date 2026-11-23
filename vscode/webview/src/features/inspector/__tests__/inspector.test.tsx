import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppletRenderer,
  ArtifactsPanel,
  CodeViewer,
  ContextPanel,
  FilesSidePanel,
  ToolsProgressPanel,
} from "@/features/inspector";
import { createQueryClient, useAppStore } from "@/lib";
import type { ContextSnapshotView } from "@shared/vscodeProtocol";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RayuCode VS Code Dual-Mode Right Inspector (Wave 3B, Spec 02)", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: "ses_vscode_shell",
      activeCodeFile: "crates/rayu-harness/src/lookup.rs",
      activeCodeLine: 42,
      inspectorOpen: true,
      rightMode: "context",
      inspectorTab: "overview",
    });
  });

  it("renders ContextPanel with token breakdown (system, tools, memory, files, messages, free) and Compact button", async () => {
    const snapshot: ContextSnapshotView = {
      sessionId: "ses_vscode_shell",
      usedTokens: 41_200,
      maxTokens: 200_000,
      usedPercent: 20.6,
      freeTokens: 158_800,
      bufferTokens: 12_000,
      cacheTtl: "5m",
      kvCacheHitPercent: 95,
      categories: [
        {
          id: "system",
          label: "System & Rules",
          tokens: 6_400,
          items: [{ name: "VSCODE_DESIGN.md", tokens: 3_200 }],
        },
        {
          id: "tools",
          label: "MCP & Built-in Tools",
          tokens: 5_200,
          items: [{ name: "45 Rust tools", tokens: 2_600 }],
        },
        {
          id: "memory",
          label: "Memory & Skills",
          tokens: 3_400,
          items: [{ name: "Semantic memory graph", tokens: 1_800 }],
        },
        {
          id: "files",
          label: "Attached Files",
          tokens: 16_000,
          items: [{ name: "crates/rayu-harness/src/lookup.rs", tokens: 8_400 }],
        },
        {
          id: "messages",
          label: "Messages",
          tokens: 10_200,
        },
      ],
    };

    renderWithQuery(<ContextPanel snapshotOverride={snapshot} />);

    expect(screen.getByTestId("inspector-context-panel")).toBeTruthy();
    expect(screen.getByTestId("context-used-pct").textContent).toBe(
      "20.6% used",
    );
    expect(screen.getByTestId("context-usage-bar")).toBeTruthy();

    // Verify all 6 categories: system, tools, memory, files, messages, free
    expect(screen.getByTestId("context-category-system")).toBeTruthy();
    expect(screen.getByTestId("context-category-tools")).toBeTruthy();
    expect(screen.getByTestId("context-category-memory")).toBeTruthy();
    expect(screen.getByTestId("context-category-files")).toBeTruthy();
    expect(screen.getByTestId("context-category-messages")).toBeTruthy();
    expect(screen.getByTestId("context-category-free")).toBeTruthy();

    // Expand dotted-underline category trigger to inspect item breakdown
    fireEvent.click(screen.getByTestId("context-category-trigger-files"));
    expect(screen.getByTestId("ctx-breakdown-files").textContent).toContain(
      "crates/rayu-harness/src/lookup.rs",
    );

    // Click Compact button
    fireEvent.click(screen.getByTestId("context-compact-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("context-action-feedback").textContent).toBe(
        "Context compacted",
      );
    });

    // Toggle KV-Cache TTL pill (5m -> 1h)
    expect(screen.getByTestId("context-ttl-pill").textContent).toContain("5m");
    fireEvent.click(screen.getByTestId("context-ttl-pill"));
    expect(screen.getByTestId("context-ttl-pill").textContent).toContain("1h");
  });

  it("renders ToolsProgressPanel live todo lanes and active tool telemetry", () => {
    renderWithQuery(
      <ToolsProgressPanel
        todosOverride={[
          {
            content: "Coalesce consecutive read steps",
            status: "completed",
          },
          {
            content: "Verify ContextPanel token breakdown",
            status: "in_progress",
            activeForm: "Testing ContextPanel categories",
          },
          {
            content: "Run lint:design gate",
            status: "pending",
          },
        ]}
        activeTools={[
          {
            id: "t1",
            toolName: "agentgrep",
            intent: "Searching ShardStore references",
            status: "running",
            durationLabel: "0.4s",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("tools-progress-panel")).toBeTruthy();
    expect(screen.getByText("1/3 (33%)")).toBeTruthy();
    expect(
      screen.getByText("Verify ContextPanel token breakdown"),
    ).toBeTruthy();
    expect(screen.getByText("Searching ShardStore references")).toBeTruthy();
  });

  it("renders ArtifactsPanel and sandboxed AppletRenderer preview with interactive actions", async () => {
    const onAppletAction = vi.fn();
    const onAppletClose = vi.fn();

    renderWithQuery(
      <div>
        <ArtifactsPanel
          pagesOverride={[
            {
              id: "page_1",
              title: "Architecture Spec.md",
              kind: "markdown",
              content: "# Dual-Mode Right Inspector\nZero raw hex tokens.",
            },
          ]}
          appletsOverride={[
            {
              appletId: "app_bench",
              title: "ShardStore Latency Profiler",
              kind: "profiler",
              state: { p50: "0.14ms", p99: "0.42ms" },
            },
          ]}
        />
        <AppletRenderer
          applet={{
            appletId: "app_standalone",
            title: "Standalone Applet",
            kind: "sandbox",
            state: { status: "ready" },
          }}
          onAction={onAppletAction}
          onClose={onAppletClose}
        />
      </div>,
    );

    expect(screen.getByTestId("inspector-artifacts-panel")).toBeTruthy();
    expect(screen.getByTestId("artifact-viewer-page_1").textContent).toContain(
      "Dual-Mode Right Inspector",
    );
    expect(screen.getByTestId("applet-renderer-app_bench")).toBeTruthy();

    fireEvent.click(screen.getByTestId("applet-run-app_standalone"));
    await waitFor(() => {
      expect(onAppletAction).toHaveBeenCalledWith("app_standalone", "run", {
        status: "ready",
      });
    });

    fireEvent.click(screen.getByTestId("applet-close-app_standalone"));
    await waitFor(() => {
      expect(onAppletClose).toHaveBeenCalledWith("app_standalone");
    });
  });

  it("renders FilesSidePanel and CodeViewer with TechFileBadge and one-click VS Code actions", () => {
    renderWithQuery(
      <FilesSidePanel
        filesOverride={[
          {
            path: "crates/rayu-harness/src/lookup.rs",
            additions: 12,
            deletions: 4,
            status: "modified",
          },
          {
            path: "vscode/webview/src/features/shell/components/AppShell.tsx",
            additions: 48,
            deletions: 6,
            status: "modified",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("inspector-files-panel")).toBeTruthy();
    expect(screen.getByTestId("inspector-code-viewer")).toBeTruthy();
    expect(screen.getByTestId("code-viewer-path").textContent).toBe(
      "crates/rayu-harness/src/lookup.rs",
    );

    // Switch active file in FilesSidePanel
    fireEvent.click(
      screen.getByTestId(
        "files-panel-select-vscode/webview/src/features/shell/components/AppShell.tsx",
      ),
    );
    expect(useAppStore.getState().activeCodeFile).toBe(
      "vscode/webview/src/features/shell/components/AppShell.tsx",
    );
  });
});
