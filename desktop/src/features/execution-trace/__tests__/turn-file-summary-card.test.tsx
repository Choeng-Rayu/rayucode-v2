import "@testing-library/jest-dom/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { changesQueryKeys } from "@/features/changes"
import { DiffTabPanel } from "@/features/inspector"
import { useAppStore } from "@/lib/app-store"
import {
  createHarnessStreamTracker,
  mapHarnessFrameToLiveEvents,
} from "@/lib/harness-adapter"
import {
  ipcClient,
  type ExecutionTurn,
  type FileChangeActionResponse,
  type FileChangesSnapshot,
} from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { ChatStream, TurnFileSummaryCard } from "../index"

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const SESSION_ID = "ses_file_summary_test"

function createSnapshot(
  overrides?: Partial<FileChangesSnapshot>
): FileChangesSnapshot {
  return {
    session_id: SESSION_ID,
    latest_turn_id: 3,
    total_pending_files: 3,
    total_additions: 26,
    total_deletions: 55,
    files: [
      {
        path: "/repo/src/session/lookup.rs",
        display_path: "src/session/lookup.rs",
        kind: "modified",
        status: "pending",
        additions: 12,
        deletions: 7,
        changed_in_latest_turn: true,
        turn_id: 3,
        edit_count: 2,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [
          {
            old_start: 18,
            old_lines: 4,
            new_start: 18,
            new_lines: 6,
            header: "@@ -18,4 +18,6 @@ impl SessionLookup {",
            lines: [
              "     pub fn get(&self, key: &SessionKey) -> Option<Session> {",
              "-        self.cache.read().get(key).cloned()",
              "+        let hit = self.shards.lookup(key)?;",
              "+        self.budget.touch(key);",
              "+        Some(hit)",
              "     }",
            ],
          },
        ],
        preview_truncated: false,
        updated_at_ms: 1_764_000_000_000,
      },
      {
        path: "/repo/src/session/cache.rs",
        display_path: "src/session/cache.rs",
        kind: "deleted",
        status: "pending",
        additions: 0,
        deletions: 48,
        changed_in_latest_turn: true,
        turn_id: 3,
        edit_count: 1,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [
          {
            old_start: 1,
            old_lines: 2,
            new_start: 0,
            new_lines: 0,
            header: "@@ -1,2 +0,0 @@",
            lines: [
              "-pub struct SessionCache {}",
              "-impl SessionCache {}",
            ],
          },
        ],
        preview_truncated: true,
        updated_at_ms: 1_763_999_990_000,
      },
      {
        path: "/repo/MIGRATION_PLAN.md",
        display_path: "MIGRATION_PLAN.md",
        kind: "created",
        status: "pending",
        additions: 14,
        deletions: 0,
        changed_in_latest_turn: false,
        turn_id: 2,
        edit_count: 1,
        is_binary: false,
        undoable: true,
        can_redo: false,
        preview_hunks: [
          {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: 2,
            header: "@@ -0,0 +1,2 @@",
            lines: [
              "+# Migration Plan",
              "+- Route reads through ShardStore",
            ],
          },
        ],
        preview_truncated: false,
        updated_at_ms: 1_763_999_940_000,
      },
    ],
    ...overrides,
  }
}

function createFinishedTurn(): ExecutionTurn {
  return {
    id: "turn_finished_1",
    sessionId: SESSION_ID,
    userPrompt: "Retire SessionCache and update docs",
    workedDuration: "18s",
    isLive: false,
    notes: [],
    groups: [],
    answerIntro: "Finished routing session lookups through ShardStore.",
    answerBullets: [],
    diffCard: {
      id: "diff_empty",
      file: "workspace",
      additions: 0,
      deletions: 0,
      hint: "",
      lines: [],
    },
    timestamp: "Just now",
    credits: "0.12 cr",
    kvCachePct: 94,
    pinned: false,
  }
}

function renderCard(initialSnapshot: FileChangesSnapshot) {
  const queryClient = createQueryClient()
  useAppStore
    .getState()
    .setSessionFileChanges(initialSnapshot.session_id, initialSnapshot)

  function StatefulHarness() {
    const liveSnap =
      useAppStore(
        (s) => s.sessionFileChangesBySession[initialSnapshot.session_id]
      ) ?? initialSnapshot
    return (
      <TurnFileSummaryCard
        sessionId={initialSnapshot.session_id}
        snapshot={liveSnap}
      />
    )
  }

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <StatefulHarness />
        </TooltipProvider>
      </QueryClientProvider>
    ),
  }
}

describe("TurnFileSummaryCard & file-change sync", () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: "dark",
      accent: "green",
      activeRoute: "workspace",
      activeSessionId: SESSION_ID,
      rightCollapsed: true,
      rightMode: "context",
      activeRightTab: "overview",
      activeDocPill: null,
      selectedDiffFilePath: null,
      sessionFileChangesBySession: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders summary header with turn-scoped badge, kind pills, collapsed inline diff preview, and opens full diff in inspector", async () => {
    const openVsCodeSpy = vi
      .spyOn(ipcClient.native, "openInVSCode")
      .mockResolvedValue({ ok: true })
    const snapshot = createSnapshot()
    renderCard(snapshot)

    expect(screen.getByTestId("summary-file-count")).toHaveTextContent(
      "3 files changed"
    )
    expect(screen.getByTestId("summary-turn-scoped-badge")).toHaveTextContent(
      "2 in this turn"
    )
    expect(screen.getByTestId("summary-diff-totals")).toHaveTextContent("+26")
    expect(screen.getByTestId("summary-diff-totals")).toHaveTextContent("−55")

    expect(
      screen.getByTestId("file-kind-pill-src/session/cache.rs")
    ).toHaveTextContent("deleted")
    expect(
      screen.getByTestId("file-kind-pill-MIGRATION_PLAN.md")
    ).toHaveTextContent("new")
    expect(
      screen.queryByTestId("file-kind-pill-src/session/lookup.rs")
    ).not.toBeInTheDocument()

    // Inline diff is collapsed by default
    expect(
      screen.queryByTestId("file-open-full-diff-src/session/lookup.rs")
    ).not.toBeInTheDocument()

    // Expand inline diff preview via chevron disclosure
    fireEvent.click(screen.getByTestId("file-row-toggle-src/session/lookup.rs"))
    const preview = await screen.findByTestId(
      "file-diff-preview-src/session/lookup.rs"
    )
    expect(preview).toHaveTextContent("let hit = self.shards.lookup(key)?;")
    expect(preview).toHaveTextContent("self.budget.touch(key);")
    expect(
      screen.getByTestId("file-open-full-diff-src/session/lookup.rs")
    ).toBeInTheDocument()

    // Clicking "Open full diff" focuses Right Inspector diff tab on that exact file
    fireEvent.click(
      screen.getByTestId("file-open-full-diff-src/session/lookup.rs")
    )
    expect(useAppStore.getState().rightCollapsed).toBe(false)
    expect(useAppStore.getState().rightMode).toBe("document")
    expect(useAppStore.getState().activeRightTab).toBe("diff")
    expect(useAppStore.getState().selectedDiffFilePath).toBe(
      "/repo/src/session/lookup.rs"
    )

    // Clicking filename focuses Right Inspector diff tab on that file
    fireEvent.click(screen.getByTestId("file-row-open-MIGRATION_PLAN.md"))
    expect(useAppStore.getState().selectedDiffFilePath).toBe(
      "/repo/MIGRATION_PLAN.md"
    )

    // Clicking VS Code opens external editor at first changed line
    fireEvent.click(screen.getByTestId("file-vscode-btn-src/session/lookup.rs"))
    await waitFor(() => {
      expect(openVsCodeSpy).toHaveBeenCalledWith(
        "/repo/src/session/lookup.rs",
        19
      )
    })
  })

  it("handles per-file Keep, Undo, and Redo and invalidates changes queries", async () => {
    const base = createSnapshot()
    let current = structuredClone(base)

    const actionSpy = vi
      .spyOn(ipcClient.fileChanges, "action")
      .mockImplementation(async (_sid, action, opts) => {
        current = {
          ...current,
          files: current.files.map((entry) => {
            if (opts?.path && entry.path !== opts.path) return entry
            if (action === "keep") {
              return { ...entry, status: "kept", can_redo: false }
            }
            if (action === "undo") {
              return { ...entry, status: "undone", can_redo: true }
            }
            if (action === "redo") {
              return { ...entry, status: "pending", can_redo: false }
            }
            return entry
          }),
        }
        current.total_pending_files = current.files.filter(
          (f) => f.status === "pending"
        ).length
        return {
          ok: true,
          message: `${action} ok`,
          conflicts: [],
          snapshot: structuredClone(current),
        }
      })

    const { queryClient } = renderCard(base)
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    // Keep lookup.rs
    fireEvent.click(screen.getByTestId("file-keep-btn-src/session/lookup.rs"))
    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "keep", {
        path: "/repo/src/session/lookup.rs",
      })
      expect(
        screen.getByTestId("file-status-badge-src/session/lookup.rs")
      ).toHaveTextContent("Kept")
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: changesQueryKeys.state(),
    })

    // Undo cache.rs -> shows Undone badge and Redo button
    fireEvent.click(screen.getByTestId("file-undo-btn-src/session/cache.rs"))
    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "undo", {
        path: "/repo/src/session/cache.rs",
      })
      expect(
        screen.getByTestId("file-status-badge-src/session/cache.rs")
      ).toHaveTextContent("Undone")
      expect(
        screen.getByTestId("file-redo-btn-src/session/cache.rs")
      ).toBeInTheDocument()
    })

    // Redo cache.rs -> restores pending controls
    fireEvent.click(screen.getByTestId("file-redo-btn-src/session/cache.rs"))
    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "redo", {
        path: "/repo/src/session/cache.rs",
      })
      expect(
        screen.getByTestId("file-keep-btn-src/session/cache.rs")
      ).toBeInTheDocument()
    })
  })

  it("handles Keep all and collapses into 1-line kept receipt with Expand and Collapse toggles", async () => {
    const base = createSnapshot()
    // Matches real Rust engine: total_additions/total_deletions only count Pending files (0 after Keep all).
    const keptSnap: FileChangesSnapshot = {
      ...base,
      total_pending_files: 0,
      total_additions: 0,
      total_deletions: 0,
      files: base.files.map((f) => ({
        ...f,
        status: "kept",
        can_redo: false,
      })),
    }

    const actionSpy = vi
      .spyOn(ipcClient.fileChanges, "action")
      .mockResolvedValue({
        ok: true,
        message: "Kept all changed files",
        conflicts: [],
        snapshot: keptSnap,
      })

    renderCard(base)

    fireEvent.click(screen.getByTestId("summary-keep-all-btn"))

    const receipt = await screen.findByTestId("turn-file-summary-receipt")
    expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "keep_all", undefined)
    expect(receipt).toHaveTextContent("Kept 3 files")
    expect(receipt).toHaveTextContent("+26")
    expect(receipt).toHaveTextContent("−55")

    // Expand receipt back to full rows, then collapse again
    fireEvent.click(screen.getByTestId("receipt-expand-btn"))
    expect(
      await screen.findByTestId("turn-file-summary-card")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("summary-collapse-btn"))
    expect(
      await screen.findByTestId("turn-file-summary-receipt")
    ).toBeInTheDocument()
  })

  it("handles Undo all into 1-line undone receipt with quiet Redo all action", async () => {
    const base = createSnapshot()
    const undoneSnap: FileChangesSnapshot = {
      ...base,
      total_pending_files: 0,
      files: base.files.map((f) => ({
        ...f,
        status: "undone",
        can_redo: true,
      })),
    }

    const actionSpy = vi
      .spyOn(ipcClient.fileChanges, "action")
      .mockImplementation(async (_sid, action) => {
        if (action === "undo_all") {
          return {
            ok: true,
            message: "Undid all changed files",
            conflicts: [],
            snapshot: undoneSnap,
          }
        }
        return {
          ok: true,
          message: "Redid all undone files",
          conflicts: [],
          snapshot: base,
        }
      })

    renderCard(base)

    fireEvent.click(screen.getByTestId("summary-undo-all-btn"))

    const receipt = await screen.findByTestId("turn-file-summary-receipt")
    expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "undo_all", undefined)
    expect(receipt).toHaveTextContent("Undid 3 files")

    fireEvent.click(screen.getByTestId("receipt-redo-all-btn"))
    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "redo_all", undefined)
      expect(
        screen.getByTestId("turn-file-summary-card")
      ).toBeInTheDocument()
    })
  })

  it("opens Conflict Resolution Dialog on conflicts and supports Open Diff, Cancel, and Force Restore Pre-Edit", async () => {
    const base = createSnapshot()
    const undoneOneSnap: FileChangesSnapshot = {
      ...base,
      total_pending_files: 2,
      files: base.files.map((f) =>
        f.path === "/repo/src/session/lookup.rs"
          ? { ...f, status: "undone", can_redo: true }
          : f
      ),
    }

    const conflictResponse: FileChangeActionResponse = {
      ok: false,
      message: "1 file modified outside this turn",
      conflicts: [
        {
          path: "/repo/src/session/lookup.rs",
          display_path: "src/session/lookup.rs",
          reason: "File hash changed after AI turn completed",
        },
      ],
      snapshot: base,
    }

    const actionSpy = vi
      .spyOn(ipcClient.fileChanges, "action")
      .mockImplementation(async (_sid, _action, opts) => {
        if (opts?.force) {
          return {
            ok: true,
            message: "Force restored src/session/lookup.rs",
            conflicts: [],
            snapshot: undoneOneSnap,
          }
        }
        return conflictResponse
      })

    renderCard(base)

    // Trigger conflict
    fireEvent.click(screen.getByTestId("file-undo-btn-src/session/lookup.rs"))

    const dialog = await screen.findByTestId("file-change-conflict-dialog")
    expect(dialog).toHaveTextContent("src/session/lookup.rs")
    expect(dialog).toHaveTextContent(
      "File hash changed after AI turn completed"
    )

    // Open Diff focuses inspector and closes dialog
    fireEvent.click(screen.getByTestId("conflict-open-diff-btn"))
    await waitFor(() => {
      expect(
        screen.queryByTestId("file-change-conflict-dialog")
      ).not.toBeInTheDocument()
    })
    expect(useAppStore.getState().activeRightTab).toBe("diff")
    expect(useAppStore.getState().selectedDiffFilePath).toBe(
      "/repo/src/session/lookup.rs"
    )

    // Re-trigger conflict and click Cancel
    fireEvent.click(screen.getByTestId("file-undo-btn-src/session/lookup.rs"))
    await screen.findByTestId("file-change-conflict-dialog")
    fireEvent.click(screen.getByTestId("conflict-cancel-btn"))
    await waitFor(() => {
      expect(
        screen.queryByTestId("file-change-conflict-dialog")
      ).not.toBeInTheDocument()
    })

    // Re-trigger conflict and click Force Restore Pre-Edit
    fireEvent.click(screen.getByTestId("file-undo-btn-src/session/lookup.rs"))
    await screen.findByTestId("file-change-conflict-dialog")
    fireEvent.click(screen.getByTestId("conflict-force-restore-btn"))

    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "undo", {
        path: "/repo/src/session/lookup.rs",
        force: true,
      })
      expect(
        screen.getByTestId("file-status-badge-src/session/lookup.rs")
      ).toHaveTextContent("Undone")
    })
  })

  it("maps live file_changes_state frames in harness-adapter and anchors TurnFileSummaryCard in ChatStream", async () => {
    const snap = createSnapshot()
    const events = mapHarnessFrameToLiveEvents(
      {
        ev: "file_changes_state",
        session_id: SESSION_ID,
        snapshot: snap,
      },
      createHarnessStreamTracker()
    )
    expect(events).toEqual([{ type: "file-changes", snapshot: snap }])

    let listener: ((frame: Record<string, unknown>) => void) | null = null
    vi.spyOn(ipcClient.harness, "onEvent").mockImplementation((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    })
    vi.spyOn(ipcClient.fileChanges, "get").mockResolvedValue({
      session_id: SESSION_ID,
      latest_turn_id: 0,
      total_pending_files: 0,
      total_additions: 0,
      total_deletions: 0,
      files: [],
    })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ChatStream sessionId={SESSION_ID} turns={[createFinishedTurn()]} />
      </QueryClientProvider>
    )

    expect(
      screen.queryByTestId("turn-file-summary-card")
    ).not.toBeInTheDocument()

    act(() => {
      listener?.({
        ev: "file_changes_state",
        session_id: SESSION_ID,
        snapshot: snap,
      })
    })

    const card = await screen.findByTestId("turn-file-summary-card")
    expect(within(card).getByTestId("summary-file-count")).toHaveTextContent(
      "3 files changed"
    )
  })

  it("focuses selectedDiffFilePath in Right Inspector DiffTabPanel and syncs Keep/Undo with sessionFileChangesBySession", async () => {
    const snap = createSnapshot()
    useAppStore.getState().setSessionFileChanges(SESSION_ID, snap)
    useAppStore.getState().openDiffFile("/repo/MIGRATION_PLAN.md", SESSION_ID)

    vi.spyOn(ipcClient.fileChanges, "diff").mockResolvedValue({
      path: "/repo/MIGRATION_PLAN.md",
      display_path: "MIGRATION_PLAN.md",
      kind: "created",
      status: "pending",
      additions: 14,
      deletions: 0,
      is_binary: false,
      original_content: "",
      modified_content: "# Migration Plan\n- Route reads through ShardStore\n",
      unified_diff:
        "@@ -0,0 +1,2 @@\n+# Migration Plan\n+- Route reads through ShardStore\n",
      hunks: snap.files[2].preview_hunks ?? [],
    })

    const keptSnap: FileChangesSnapshot = {
      ...snap,
      total_pending_files: 2,
      files: snap.files.map((f) =>
        f.path === "/repo/MIGRATION_PLAN.md" ? { ...f, status: "kept" } : f
      ),
    }
    const actionSpy = vi
      .spyOn(ipcClient.fileChanges, "action")
      .mockResolvedValue({
        ok: true,
        message: "Kept MIGRATION_PLAN.md",
        conflicts: [],
        snapshot: keptSnap,
      })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <DiffTabPanel />
        </TooltipProvider>
      </QueryClientProvider>
    )

    const activeName = await screen.findByTestId(
      "inspector-diff-active-filename"
    )
    expect(activeName).toHaveTextContent("MIGRATION_PLAN.md")

    fireEvent.click(screen.getByTestId("inspector-diff-keep-btn"))
    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledWith(SESSION_ID, "keep", {
        path: "/repo/MIGRATION_PLAN.md",
      })
      expect(
        useAppStore.getState().sessionFileChangesBySession[SESSION_ID]?.files[2]
          ?.status
      ).toBe("kept")
    })
  })

  it("handles >10 MiB non-undoable entries and empty-turns fallback in ChatStream", async () => {
    const largeSnap = createSnapshot({
      total_pending_files: 1,
      total_additions: 0,
      total_deletions: 0,
      files: [
        {
          path: "/repo/assets/huge.dat",
          display_path: "assets/huge.dat",
          kind: "created",
          status: "pending",
          additions: 0,
          deletions: 0,
          changed_in_latest_turn: true,
          turn_id: 3,
          edit_count: 1,
          is_binary: false,
          undoable: false,
          can_redo: false,
          preview_hunks: [],
          preview_truncated: false,
          updated_at_ms: 1_764_000_000_000,
        },
      ],
    })
    useAppStore.getState().setSessionFileChanges(SESSION_ID, largeSnap)
    vi.spyOn(ipcClient.fileChanges, "get").mockResolvedValue(largeSnap)

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ChatStream sessionId={SESSION_ID} turns={[]} />
      </QueryClientProvider>
    )

    const card = await screen.findByTestId("turn-file-summary-card")
    expect(within(card).getByTestId("file-undo-btn-assets/huge.dat")).toBeDisabled()
    fireEvent.click(within(card).getByTestId("file-row-toggle-assets/huge.dat"))
    expect(
      await within(card).findByTestId("file-diff-preview-assets/huge.dat")
    ).toHaveTextContent(/10 MiB snapshot limit/i)
  })

  it("hides TurnFileSummaryCard while a turn is actively streaming and reveals it once finished", async () => {
    const snap = createSnapshot()
    let listener: ((frame: Record<string, unknown>) => void) | null = null
    vi.spyOn(ipcClient.harness, "onEvent").mockImplementation((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    })
    vi.spyOn(ipcClient.fileChanges, "get").mockResolvedValue(snap)

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ChatStream sessionId={SESSION_ID} turns={[createFinishedTurn()]} />
      </QueryClientProvider>
    )

    // Visible while idle after finished turn
    expect(
      await screen.findByTestId("turn-file-summary-card")
    ).toBeInTheDocument()

    // While a new turn is actively streaming, card stays hidden even when file_changes_state arrives mid-turn
    act(() => {
      listener?.({
        ev: "text_delta",
        session_id: SESSION_ID,
        text: "Editing files...",
      })
      listener?.({
        ev: "file_changes_state",
        session_id: SESSION_ID,
        snapshot: snap,
      })
    })
    await waitFor(() => {
      expect(
        screen.queryByTestId("turn-file-summary-card")
      ).not.toBeInTheDocument()
    })

    // Once the turn finishes, the summary card reappears
    act(() => {
      listener?.({
        ev: "turn_done",
        session_id: SESSION_ID,
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId("turn-file-summary-card")).toBeInTheDocument()
    })
  })
})
