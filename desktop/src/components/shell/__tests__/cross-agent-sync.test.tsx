import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ipcClient, type SessionSummary } from "@/lib/ipc-client"

import { ImportSessionsDialog } from "../import-sessions-dialog"
import { SidebarProjectsPane } from "../sidebar-projects-pane"

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe("Desktop Cross-Agent Sync, Logos & Source Filter", () => {
  const mockSessions: SessionSummary[] = [
    {
      id: "ses_rayu_1",
      title: "Rayu desktop session",
      project: "rayucode-v2",
      workingDir: "/workspace/rayucode-v2",
      checkout: "Local Checkout",
      branch: "main",
      updatedAt: "1m",
      updatedAtMs: 3000,
      modelId: "claude-opus-5-5",
      modelLabel: "Claude Opus 5.5",
      effort: "Medium",
      permissionMode: "default",
      kvWarmPct: 90,
      creditsUsed: 0,
      source: "rayu",
    },
    {
      id: "codex:cx_1",
      title: "Codex bugfix chat",
      project: "rayucode-v2",
      workingDir: "/workspace/rayucode-v2",
      checkout: "Local Checkout",
      branch: "main",
      updatedAt: "2m",
      updatedAtMs: 2500,
      modelId: "claude-opus-5-5",
      modelLabel: "Claude Opus 5.5",
      effort: "Medium",
      permissionMode: "default",
      kvWarmPct: 90,
      creditsUsed: 0,
      source: "codex",
      externalSessionId: "cx_1",
      externalPath: "/tmp/cx_1.jsonl",
      imported: false,
    },
    {
      id: "claude_code:cl_1",
      title: "Claude planning chat",
      project: "rayucode-v2",
      workingDir: "/workspace/rayucode-v2",
      checkout: "Local Checkout",
      branch: "main",
      updatedAt: "3m",
      updatedAtMs: 2000,
      modelId: "claude-opus-5-5",
      modelLabel: "Claude Opus 5.5",
      effort: "Medium",
      permissionMode: "default",
      kvWarmPct: 90,
      creditsUsed: 0,
      source: "claude_code",
      externalSessionId: "cl_1",
      externalPath: "/tmp/cl_1.jsonl",
      imported: false,
    },
  ]

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(ipcClient.sessions, "list").mockResolvedValue(mockSessions)
    vi.spyOn(ipcClient.sessions, "listProjects").mockResolvedValue([
      {
        id: "ws_rayu",
        name: "rayucode-v2",
        path: "/workspace/rayucode-v2",
        expanded: true,
        sessions: [],
      },
    ])
    vi.spyOn(ipcClient.sessions, "listRecents").mockResolvedValue([])
    vi.spyOn(ipcClient.sidebar, "getState").mockResolvedValue({
      projects: [
        {
          id: "ws_rayu",
          name: "rayucode-v2",
          folders: ["/workspace/rayucode-v2"],
          iconKind: "icon",
          iconValue: "folder",
          iconColor: "folder",
          updatedAt: 3000,
        },
      ],
      sections: [],
      pinnedChatIds: [],
      archivedChatIds: [],
      organizeBy: "project",
      sortBy: "updated",
      showProjectChatsInRecents: false,
      manualProjectOrder: [],
    })
  })

  it("shows coding agent logos and filters Desktop sidebar by agent source", async () => {
    renderWithQuery(
      <SidebarProjectsPane searchQuery="" onOpenSession={vi.fn()} />
    )

    await waitFor(() => {
      expect(screen.getByTestId("agent-source-badge-rayu")).toBeTruthy()
      expect(screen.getByTestId("agent-source-badge-codex")).toBeTruthy()
      expect(screen.getByTestId("agent-source-badge-claude_code")).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId("desktop-source-filter-codex"))

    expect(screen.getByText("Codex bugfix chat")).toBeTruthy()
    expect(screen.queryByText("Rayu desktop session")).toBeNull()
    expect(screen.queryByText("Claude planning chat")).toBeNull()

    fireEvent.click(screen.getByTestId("desktop-source-filter-all"))
    expect(screen.getByText("Rayu desktop session")).toBeTruthy()
    expect(screen.getByText("Claude planning chat")).toBeTruthy()
  })

  it("lazy-imports unimported external session when clicked", async () => {
    const importSpy = vi
      .spyOn(ipcClient.sessions, "importExternal")
      .mockResolvedValue({
        sessions: [{ ...mockSessions[1], id: "imported_codex_cx_1", imported: true }],
        skipped: [],
      })
    const onOpenSession = vi.fn()

    renderWithQuery(
      <SidebarProjectsPane searchQuery="" onOpenSession={onOpenSession} />
    )

    await waitFor(() => {
      expect(screen.getByText("Codex bugfix chat")).toBeTruthy()
    })

    fireEvent.click(screen.getByText("Codex bugfix chat"))

    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1)
      expect(onOpenSession).toHaveBeenCalledWith(
        "imported_codex_cx_1",
        undefined,
        "Codex bugfix chat"
      )
    })
  })

  it("imports a whole Desktop project into WorkspaceRegistry via ImportSessionsDialog", async () => {
    vi.spyOn(ipcClient.sessions, "listExternalProjects").mockResolvedValue([
      {
        id: "proj_claude_desk",
        source: "claude_desktop",
        name: "Payments API",
        workingDir: "/workspace/payments-api",
        sessionCount: 1,
        sessions: [mockSessions[2]],
      },
    ])
    const importExtSpy = vi
      .spyOn(ipcClient.sessions, "importExternal")
      .mockResolvedValue({
        sessions: [{ ...mockSessions[2], id: "imported_claude_code_cl_1", imported: true }],
        skipped: [],
      })
    const groupSpy = vi
      .spyOn(ipcClient.workspace, "importProjectGroup")
      .mockResolvedValue({
        id: "ws_payments",
        name: "Payments API",
        path: "/workspace/payments-api",
        canonicalPath: "/workspace/payments-api",
        created: true,
      })

    renderWithQuery(
      <ImportSessionsDialog open={true} onOpenChange={vi.fn()} />
    )

    await waitFor(() => {
      expect(
        screen.getByTestId("desktop-import-whole-project-Payments API")
      ).toBeTruthy()
    })

    fireEvent.click(
      screen.getByTestId("desktop-import-whole-project-Payments API")
    )

    await waitFor(() => {
      expect(importExtSpy).toHaveBeenCalledTimes(1)
      expect(groupSpy).toHaveBeenCalledWith(
        "/workspace/payments-api",
        ["imported_claude_code_cl_1"],
        "Payments API"
      )
    })
  })
})
