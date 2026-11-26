import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummaryView } from "@shared/vscodeProtocol";

const rpcCalls: Array<{ method: string; params: unknown }> = [];

vi.mock("@/lib/rpc-client", () => ({
  callRpc: vi.fn(async (method: string, params?: unknown) => {
    rpcCalls.push({ method, params });
    if (method === "sessions.list") {
      return {
        sessions: mockSessions,
        activeSessionId: "ses_rayu_1",
      };
    }
    if (method === "workspace.listFolders") {
      return {
        folders: [
          {
            id: "ws_repo",
            name: "rayucode-v2",
            path: "/repo/rayucode-v2",
            canonicalPath: "/repo/rayucode-v2",
            isPrimary: true,
          },
        ],
      };
    }
    if (method === "workspace.ledger.get") {
      return {
        version: 1,
        updatedAt: Date.now(),
        workspaces: [
          {
            id: "ws_repo",
            name: "rayucode-v2",
            path: "/repo/rayucode-v2",
            canonicalPath: "/repo/rayucode-v2",
            sessionIds: ["ses_rayu_1"],
            createdAt: 1,
            updatedAt: 1,
            lastOpenedAt: 1,
          },
        ],
        pinnedSessionIds: [],
        archivedSessionIds: [],
        collapsedWorkspaceIds: [],
        manualWorkspaceOrder: [],
        openFolderPaths: ["/repo/rayucode-v2"],
      };
    }
    if (method === "sessions.importExternal") {
      const p = params as {
        items: Array<{ source: string; externalSessionId: string; workingDir?: string }>;
        forkOnConflict?: boolean;
      };
      return {
        sessions: p.items.map((item) => ({
          sessionId: p.forkOnConflict
            ? `imported_${item.source}_${item.externalSessionId}_fork`
            : `imported_${item.source}_${item.externalSessionId}`,
          title: `Imported ${item.externalSessionId}`,
          workingDir: item.workingDir ?? "/repo/rayucode-v2",
          status: "idle" as const,
          updatedAtMs: Date.now(),
          source: item.source,
          imported: true,
        })),
        skipped: [],
      };
    }
    if (method === "sessions.listExternalProjects") {
      return {
        projects: [
          {
            id: "proj_claude_1",
            source: "claude_desktop",
            name: "Claude Desktop Repo",
            workingDir: "/repo/claude-proj",
            sessionCount: 1,
            updatedAtMs: Date.now(),
            sessions: [
              {
                sessionId: "claude_desktop:c_desk_1",
                title: "Refactor auth pipeline",
                workingDir: "/repo/claude-proj",
                status: "idle",
                updatedAtMs: Date.now(),
                source: "claude_desktop",
                externalSessionId: "c_desk_1",
                imported: false,
              },
            ],
          },
        ],
      };
    }
    if (method === "workspace.ledger.importProjectGroup") {
      return {
        version: 1,
        updatedAt: Date.now(),
        workspaces: [],
        pinnedSessionIds: [],
        archivedSessionIds: [],
        collapsedWorkspaceIds: [],
        manualWorkspaceOrder: [],
        openFolderPaths: ["/repo/rayucode-v2"],
      };
    }
    if (method === "sessions.attach") {
      const p = params as { sessionId: string };
      return {
        session: {
          sessionId: p.sessionId,
          title: "Attached",
          status: "idle",
          updatedAtMs: Date.now(),
        },
      };
    }
    return { ok: true };
  }),
  onHarnessFrame: vi.fn(() => () => {}),
}));

let mockSessions: SessionSummaryView[] = [];

import { SidebarProjectsPane } from "@/features/shell/components/SidebarProjectsPane";
import { ImportSessionsDialog } from "@/features/shell/components/ImportSessionsDialog";
import { useAppStore } from "@/lib/app-store";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("VS Code Cross-Agent Sync, Logos & Source Filter", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    useAppStore.setState({
      activeSessionId: "ses_rayu_1",
      activeProjectPath: "/repo/rayucode-v2",
      activeDraft: null,
      workspaces: [],
      workspaceLedger: null,
    });
    mockSessions = [
      {
        sessionId: "ses_rayu_1",
        title: "Rayu native chat",
        workingDir: "/repo/rayucode-v2",
        status: "idle",
        updatedAtMs: 3000,
        source: "rayu",
        sourceTool: "rayu",
      },
      {
        sessionId: "codex:cx_42",
        title: "Codex debugging session",
        workingDir: "/repo/rayucode-v2",
        status: "idle",
        updatedAtMs: 2500,
        source: "codex",
        sourceTool: "codex",
        externalSessionId: "cx_42",
        externalPath: "/tmp/cx_42.jsonl",
        imported: false,
      },
      {
        sessionId: "claude_code:cl_99",
        title: "Claude refactor chat",
        workingDir: "/repo/rayucode-v2",
        status: "idle",
        updatedAtMs: 2000,
        source: "claude_code",
        sourceTool: "claude",
        externalSessionId: "cl_99",
        externalPath: "/tmp/cl_99.jsonl",
        imported: false,
      },
    ];
  });

  it("displays agent source logos and filters sessions by coding agent", async () => {
    renderWithQuery(<SidebarProjectsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-source-badge-rayu")).toBeTruthy();
      expect(screen.getByTestId("agent-source-badge-codex")).toBeTruthy();
      expect(
        screen.getByTestId("agent-source-badge-claude_code"),
      ).toBeTruthy();
    });

    // Source filter bar shows detected agents
    expect(screen.getByTestId("sidebar-source-filter-bar")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sidebar-source-filter-codex"));

    expect(screen.getByText("Codex debugging session")).toBeTruthy();
    expect(screen.queryByText("Rayu native chat")).toBeNull();
    expect(screen.queryByText("Claude refactor chat")).toBeNull();

    // Clicking All restores every agent
    fireEvent.click(screen.getByTestId("sidebar-source-filter-all"));
    expect(screen.getByText("Rayu native chat")).toBeTruthy();
    expect(screen.getByText("Claude refactor chat")).toBeTruthy();
  });

  it("lazy-imports unimported external session on click", async () => {
    renderWithQuery(<SidebarProjectsPane />);

    await waitFor(() => {
      expect(screen.getByText("Codex debugging session")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Codex debugging session"));

    await waitFor(() => {
      const importCall = rpcCalls.find(
        (c) => c.method === "sessions.importExternal",
      );
      expect(importCall).toBeDefined();
      expect(useAppStore.getState().activeSessionId).toBe("imported_codex_cx_42");
    });
  });

  it("imports a whole Desktop project and groups sessions via workspace.ledger.importProjectGroup", async () => {
    const onOpenChange = vi.fn();
    renderWithQuery(
      <ImportSessionsDialog open={true} onOpenChange={onOpenChange} />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("import-whole-project-btn-Claude Desktop Repo"),
      ).toBeTruthy();
    });

    fireEvent.click(
      screen.getByTestId("import-whole-project-btn-Claude Desktop Repo"),
    );

    await waitFor(() => {
      expect(
        rpcCalls.some((c) => c.method === "sessions.importExternal"),
      ).toBe(true);
      expect(
        rpcCalls.some((c) => c.method === "workspace.ledger.importProjectGroup"),
      ).toBe(true);
    });
  });
});
