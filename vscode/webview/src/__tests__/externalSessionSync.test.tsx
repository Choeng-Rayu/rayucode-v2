import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummaryView } from "@shared/vscodeProtocol";

import { HomePage } from "@/features/composer";
import { SidebarProjectsPane } from "@/features/shell";
import { createQueryClient, useAppStore } from "@/lib";
import * as rpcClient from "@/lib/rpc-client";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const CODEX_SYNTHETIC_SESSION: SessionSummaryView = {
  sessionId: "codex_desktop:01a20cda-5903-7ce3-978b-9c5b6a3938f0",
  title: "Codex Desktop API Audit",
  status: "idle",
  workingDir: "/workspace/rayucode-v2",
  updatedAtMs: Date.now() - 60_000,
  source: "codex_desktop",
  sourceTool: "codex",
  externalSessionId: "01a20cda-5903-7ce3-978b-9c5b6a3938f0",
  externalPath: "/home/rayu/.codex/sessions/rollout-audit.jsonl",
  imported: false,
};

const MATERIALIZED_CODEX_SESSION: SessionSummaryView = {
  ...CODEX_SYNTHETIC_SESSION,
  sessionId: "imported_codex_desktop_01a20cda-5903-7ce3-978b-9c5b6a3938f0",
  imported: true,
};

describe("Cross-platform external session import & open flow (Codex / Claude Code)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      surface: "editorPanel",
      route: "home",
      activeRoute: "home",
      activeSessionId: null,
      activeSessionTitle: null,
      activeProjectPath: "/workspace/rayucode-v2",
      workspaces: [
        {
          name: "rayucode-v2",
          path: "/workspace/rayucode-v2",
          branch: "main",
          isPrimary: true,
        },
      ],
      workspaceLedger: null,
      sessionPrefsBySession: {},
    });
  });

  it("HomePage imports unimported codex_desktop sessions BEFORE calling sessions.attach", async () => {
    const rpcOrder: string[] = [];
    const attachedIds: string[] = [];
    const origCallRpc = rpcClient.callRpc;

    vi.spyOn(rpcClient, "callRpc").mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      rpcOrder.push(method);
      if (method === "sessions.list") {
        return {
          sessions: [CODEX_SYNTHETIC_SESSION],
          activeSessionId: null,
        };
      }
      if (method === "sessions.importExternal") {
        return {
          sessions: [MATERIALIZED_CODEX_SESSION],
          skipped: [],
        };
      }
      if (method === "sessions.attach") {
        attachedIds.push(String(params?.sessionId ?? ""));
        return { session: MATERIALIZED_CODEX_SESSION };
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    const onSelectSession = vi.fn();
    renderWithQuery(<HomePage userName="Rayu" onSelectSession={onSelectSession} />);

    const btn = await screen.findByTestId(
      `home-recent-session-${CODEX_SYNTHETIC_SESSION.sessionId}`,
    );
    fireEvent.click(btn);

    await waitFor(() => {
      expect(attachedIds).toEqual([MATERIALIZED_CODEX_SESSION.sessionId]);
    });
    expect(rpcOrder.indexOf("sessions.importExternal")).toBeGreaterThan(-1);
    expect(rpcOrder.indexOf("sessions.importExternal")).toBeLessThan(
      rpcOrder.indexOf("sessions.attach"),
    );
    expect(attachedIds).not.toContain(CODEX_SYNTHETIC_SESSION.sessionId);
    expect(onSelectSession).toHaveBeenCalledWith(
      MATERIALIZED_CODEX_SESSION.sessionId,
    );
    expect(useAppStore.getState().activeSessionId).toBe(
      MATERIALIZED_CODEX_SESSION.sessionId,
    );
  });

  it("SidebarProjectsPane surfaces sidebar-import-error-banner and NEVER attaches synthetic codex_desktop ID when import fails", async () => {
    const attachedIds: string[] = [];
    const origCallRpc = rpcClient.callRpc;

    vi.spyOn(rpcClient, "callRpc").mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "sessions.list") {
        return {
          sessions: [CODEX_SYNTHETIC_SESSION],
          activeSessionId: null,
        };
      }
      if (method === "workspace.listFolders") {
        return {
          folders: [
            {
              name: "rayucode-v2",
              path: "/workspace/rayucode-v2",
              branch: "main",
              isPrimary: true,
            },
          ],
        };
      }
      if (method === "workspace.ledger.get") {
        return {
          version: 1,
          openFolderPaths: ["/workspace/rayucode-v2"],
          workspaces: [],
          pinnedSessionIds: [],
          archivedSessionIds: [],
          sessionWorkspaceOverrides: {},
        };
      }
      if (method === "sessions.importExternal") {
        return {
          sessions: [],
          skipped: [
            {
              source: "codex_desktop",
              externalSessionId: CODEX_SYNTHETIC_SESSION.externalSessionId!,
              reason: "not_found",
              message: "Session rollout file missing on disk",
            },
          ],
        };
      }
      if (method === "sessions.attach") {
        attachedIds.push(String(params?.sessionId ?? ""));
        return { session: CODEX_SYNTHETIC_SESSION };
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    renderWithQuery(<SidebarProjectsPane />);

    const row = await screen.findByText("Codex Desktop API Audit");
    fireEvent.click(row);

    const banner = await screen.findByTestId("sidebar-import-error-banner");
    expect(banner.textContent).toContain("Session rollout file missing on disk");
    expect(attachedIds).toEqual([]);
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  it("SidebarProjectsPane imports and attaches materialized session ID when selecting an unimported Codex session", async () => {
    const attachedIds: string[] = [];
    const origCallRpc = rpcClient.callRpc;

    vi.spyOn(rpcClient, "callRpc").mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "sessions.list") {
        return {
          sessions: [CODEX_SYNTHETIC_SESSION],
          activeSessionId: null,
        };
      }
      if (method === "workspace.listFolders") {
        return {
          folders: [
            {
              name: "rayucode-v2",
              path: "/workspace/rayucode-v2",
              branch: "main",
              isPrimary: true,
            },
          ],
        };
      }
      if (method === "workspace.ledger.get") {
        return {
          version: 1,
          openFolderPaths: ["/workspace/rayucode-v2"],
          workspaces: [],
          pinnedSessionIds: [],
          archivedSessionIds: [],
          sessionWorkspaceOverrides: {},
        };
      }
      if (method === "sessions.importExternal") {
        return {
          sessions: [MATERIALIZED_CODEX_SESSION],
          skipped: [],
        };
      }
      if (method === "sessions.attach") {
        attachedIds.push(String(params?.sessionId ?? ""));
        return { session: MATERIALIZED_CODEX_SESSION };
      }
      return origCallRpc(method as never, params as never);
    }) as typeof rpcClient.callRpc);

    renderWithQuery(<SidebarProjectsPane />);

    const row = await screen.findByText("Codex Desktop API Audit");
    fireEvent.click(row);

    await waitFor(() => {
      expect(attachedIds).toEqual([MATERIALIZED_CODEX_SESSION.sessionId]);
    });
    expect(screen.queryByTestId("sidebar-import-error-banner")).toBeNull();
    expect(useAppStore.getState().activeSessionId).toBe(
      MATERIALIZED_CODEX_SESSION.sessionId,
    );
  });
});
