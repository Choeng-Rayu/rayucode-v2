import "@testing-library/jest-dom/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { useAppStore } from "@/lib/app-store"
import { ipcClient, type ChangesState } from "@/lib/ipc-client"
import { createQueryClient } from "@/lib/query-client"

import { ChangesView } from "../index"

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver
  }
})

function createInitialChangesFixture(): ChangesState {
  return {
    branch: "feat/retire-session-cache",
    totalAdditions: 82,
    totalDeletions: 224,
    files: [
      {
        id: "chg-lookup",
        path: "src/session/lookup.rs",
        additions: 12,
        deletions: 7,
        ownerBadge: "coordinator · a41f",
        hint: "Ready for review · 14 tests green",
        lines: [
          {
            lineNumber: null,
            type: "hunk",
            mark: "@@",
            content: " -41,12 +41,17 @@ impl SessionLookup {",
          },
          {
            lineNumber: 41,
            type: "ctx",
            mark: "",
            content:
              "     pub async fn get(&self, id: &SessionId) -> Result<Option<Session>> {",
          },
          {
            lineNumber: 42,
            type: "del",
            mark: "−",
            content:
              "         if let Some(hit) = self.legacy_cache.get(id).await {",
          },
          {
            lineNumber: 42,
            type: "add",
            mark: "+",
            content:
              "         if let Some(hit) = self.shards.lookup(id, &self.budget).await? {",
          },
          {
            lineNumber: 46,
            type: "ctx",
            mark: "",
            content: "         self.store.load(id).await",
          },
        ],
      },
      {
        id: "chg-budget",
        path: "src/retry/budget.rs",
        additions: 22,
        deletions: 3,
        ownerBadge: "worker-1 · e7b3",
        hint: "Fixes streaming_midflight_retry (40 == 40)",
        lines: [
          {
            lineNumber: null,
            type: "hunk",
            mark: "@@",
            content: " -209,8 +209,14 @@ impl StreamRetry {",
          },
          {
            lineNumber: 209,
            type: "ctx",
            mark: "",
            content:
              "     pub fn accept_chunk(&mut self, seq: u64, bytes: Bytes) -> Option<Bytes> {",
          },
          {
            lineNumber: 210,
            type: "del",
            mark: "−",
            content: "         self.last_seq = seq;",
          },
          {
            lineNumber: 210,
            type: "add",
            mark: "+",
            content: "         if seq <= self.last_seq { return None; }",
          },
        ],
      },
      {
        id: "chg-cache",
        path: "src/session/cache.rs",
        additions: 0,
        deletions: 214,
        deleted: true,
        ownerBadge: "Delete file",
        hint: "0 remaining references across workspace",
        lines: [
          {
            lineNumber: null,
            type: "hunk",
            mark: "@@",
            content: " -1,6 +0,0 @@",
          },
          {
            lineNumber: 1,
            type: "del",
            mark: "−",
            content:
              " //! Legacy in-memory SessionCache (replaced by ShardStore::lookup)",
          },
        ],
      },
      {
        id: "chg-plan",
        path: "MIGRATION_PLAN.md",
        additions: 48,
        deletions: 0,
        ownerBadge: "docs",
        hint: "Markdown spec updated automatically",
        lines: [
          {
            lineNumber: 1,
            type: "add",
            mark: "+",
            content: " # SessionCache Retirement & ShardStore Migration",
          },
        ],
      },
    ],
  }
}

function renderChangesView() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ChangesView />
    </QueryClientProvider>
  )
}

describe("ChangesView", () => {
  let stateRef: ChangesState

  beforeEach(() => {
    stateRef = createInitialChangesFixture()
    useAppStore.getState().setActiveRoute("changes")

    vi.spyOn(ipcClient.changes, "getState").mockImplementation(async () =>
      structuredClone(stateRef)
    )

    vi.spyOn(ipcClient.changes, "acceptFile").mockImplementation(
      async (fileId) => {
        stateRef = {
          ...stateRef,
          files: stateRef.files.map((f) =>
            f.id === fileId ? { ...f, accepted: true, rejected: false } : f
          ),
        }
        return structuredClone(stateRef)
      }
    )

    vi.spyOn(ipcClient.changes, "rejectFile").mockImplementation(
      async (fileId) => {
        stateRef = {
          ...stateRef,
          files: stateRef.files.map((f) =>
            f.id === fileId ? { ...f, rejected: true, accepted: false } : f
          ),
        }
        return structuredClone(stateRef)
      }
    )

    vi.spyOn(ipcClient.native, "openInVSCode").mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders a flat changed-files list with zero folder tree and switches active DiffPanel on selection", async () => {
    renderChangesView()

    await screen.findByTestId("changes-view")

    // Top branch & diff summary header
    expect(screen.getByTestId("changes-branch-name")).toHaveTextContent(
      "feat/retire-session-cache"
    )
    expect(screen.getByTestId("changes-file-count")).toHaveTextContent(
      "4 changed files"
    )
    expect(screen.getByTestId("changes-diff-totals")).toHaveTextContent("+82")
    expect(screen.getByTestId("changes-diff-totals")).toHaveTextContent("−224")

    // Flat changed-files list (zero folder tree)
    const flatList = screen.getByTestId("flat-changed-files-list")
    expect(screen.queryByRole("tree")).not.toBeInTheDocument()
    expect(screen.queryByRole("treeitem")).not.toBeInTheDocument()

    const listItems = within(flatList).getAllByRole("listitem")
    expect(listItems).toHaveLength(4)
    expect(flatList).toHaveTextContent("src/session/lookup.rs")
    expect(flatList).toHaveTextContent("src/retry/budget.rs")
    expect(flatList).toHaveTextContent("src/session/cache.rs")
    expect(flatList).toHaveTextContent("MIGRATION_PLAN.md")
    expect(flatList).toHaveTextContent("coordinator · a41f")
    expect(flatList).toHaveTextContent("worker-1 · e7b3")

    // Default active DiffPanel is the first file
    expect(screen.getByTestId("diff-panel-chg-lookup")).toBeInTheDocument()
    expect(screen.getByTestId("diff-panel-file-path")).toHaveTextContent(
      "src/session/lookup.rs"
    )

    // Clicking another file switches the active DiffPanel
    fireEvent.click(screen.getByTestId("select-file-chg-budget"))

    expect(screen.getByTestId("diff-panel-chg-budget")).toBeInTheDocument()
    expect(screen.getByTestId("diff-panel-file-path")).toHaveTextContent(
      "src/retry/budget.rs"
    )
    expect(screen.getByTestId("changed-file-row-chg-budget")).toHaveAttribute(
      "data-selected",
      "true"
    )
  })

  it("switches between Unified and Split diff modes and handles Accept, Reject, Undo, Stage, and VS Code actions", async () => {
    renderChangesView()

    await screen.findByTestId("diff-panel-chg-lookup")

    // Starts in Unified mode
    expect(screen.getByTestId("diff-body-unified")).toBeInTheDocument()
    expect(screen.queryByTestId("diff-body-split")).not.toBeInTheDocument()

    // Switch to Split mode
    const splitTab = screen.getByTestId("diff-mode-split-tab")
    fireEvent.mouseDown(splitTab, { button: 0, ctrlKey: false })
    fireEvent.click(splitTab)

    await waitFor(() => {
      expect(screen.getByTestId("diff-body-split")).toBeInTheDocument()
    })
    expect(screen.getByText("Original (base)")).toBeInTheDocument()
    expect(screen.getByText("Modified (working tree)")).toBeInTheDocument()

    // Switch back to Unified mode
    const unifiedTab = screen.getByTestId("diff-mode-unified-tab")
    fireEvent.mouseDown(unifiedTab, { button: 0, ctrlKey: false })
    fireEvent.click(unifiedTab)

    await waitFor(() => {
      expect(screen.getByTestId("diff-body-unified")).toBeInTheDocument()
    })

    // Stage file via DiffPanel Stage button and toggle via flat list checkbox
    const panelStageBtn = screen.getByTestId("diff-panel-stage-btn")
    expect(panelStageBtn).toHaveTextContent("Stage")
    fireEvent.click(panelStageBtn)

    await waitFor(() => {
      expect(screen.getByTestId("diff-panel-stage-btn")).toHaveTextContent(
        "Staged"
      )
      expect(screen.getByTestId("stage-toggle-chg-lookup")).toHaveAttribute(
        "aria-checked",
        "true"
      )
    })

    // Accept file
    fireEvent.click(screen.getByTestId("diff-accept-btn"))

    await waitFor(() => {
      expect(ipcClient.changes.acceptFile).toHaveBeenCalledWith("chg-lookup")
      expect(screen.getByTestId("diff-panel-hint")).toHaveTextContent(
        "Accepted · staged for commit"
      )
      expect(
        screen.getByTestId("file-status-badge-chg-lookup")
      ).toHaveTextContent("Accepted")
    })

    // Undo review decision, then Reject
    fireEvent.click(screen.getByTestId("diff-undo-btn"))
    await waitFor(() => {
      expect(screen.getByTestId("diff-reject-btn")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId("diff-reject-btn"))
    await waitFor(() => {
      expect(ipcClient.changes.rejectFile).toHaveBeenCalledWith("chg-lookup")
      expect(screen.getByTestId("diff-panel-hint")).toHaveTextContent(
        "Rejected · rayu will revise"
      )
      expect(
        screen.getByTestId("file-status-badge-chg-lookup")
      ).toHaveTextContent("Rejected")
    })

    // Open in VS Code from header and DiffPanel
    fireEvent.click(screen.getByTestId("diff-panel-vscode-btn"))
    expect(ipcClient.native.openInVSCode).toHaveBeenCalledWith(
      "src/session/lookup.rs",
      41
    )

    fireEvent.click(screen.getByTestId("header-open-vscode-btn"))
    expect(ipcClient.native.openInVSCode).toHaveBeenCalledWith(
      "src/session/lookup.rs",
      1
    )
  })

  it("stages files via flat list checkboxes and validates commit staged form", async () => {
    renderChangesView()

    await screen.findByTestId("changes-view")

    const commitBtn = screen.getByTestId("commit-staged-btn")
    expect(commitBtn).toBeDisabled()

    // Toggle stage on two files
    fireEvent.click(screen.getByTestId("stage-toggle-chg-lookup"))
    fireEvent.click(screen.getByTestId("stage-toggle-chg-budget"))

    await waitFor(() => {
      expect(screen.getByTestId("commit-staged-btn")).toHaveTextContent(
        "Commit staged (2)"
      )
      expect(screen.getByTestId("commit-staged-btn")).toBeEnabled()
    })

    // Empty message fails Zod validation
    fireEvent.submit(screen.getByTestId("commit-staged-form"))
    await waitFor(() => {
      expect(screen.getByTestId("commit-error")).toHaveTextContent(
        "Enter a commit message (at least 3 characters)"
      )
    })

    // Valid commit message records commit receipt
    fireEvent.change(screen.getByTestId("commit-message-input"), {
      target: { value: "retire SessionCache and dedup midflight retries" },
    })
    fireEvent.submit(screen.getByTestId("commit-staged-form"))

    await waitFor(() => {
      expect(screen.getByTestId("commit-receipt")).toHaveTextContent(
        "Committed c84f91e · 2 file(s)"
      )
    })
  })

  it("requires explicit confirmation guardrail before creating a PR", async () => {
    renderChangesView()

    await screen.findByTestId("changes-view")

    // Guardrail dialog is closed initially and no PR has been created silently
    expect(
      screen.queryByTestId("create-pr-guardrail-dialog")
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId("created-pr-banner")).not.toBeInTheDocument()

    // Clicking Create PR opens confirmation guardrail dialog
    fireEvent.click(screen.getByTestId("create-pr-btn"))

    const dialog = await screen.findByTestId("create-pr-guardrail-dialog")
    expect(dialog).toHaveTextContent("Confirm Pull Request Creation")
    expect(dialog).toHaveTextContent("Explicit approval required · Always ask")
    expect(screen.getByTestId("pr-base-branch-input")).toHaveValue("main")

    // Cancelling closes dialog without creating PR
    fireEvent.click(screen.getByTestId("pr-cancel-btn"))
    await waitFor(() => {
      expect(
        screen.queryByTestId("create-pr-guardrail-dialog")
      ).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId("created-pr-banner")).not.toBeInTheDocument()

    // Re-open and confirm PR creation
    fireEvent.click(screen.getByTestId("create-pr-btn"))
    await screen.findByTestId("create-pr-guardrail-dialog")

    fireEvent.click(screen.getByTestId("pr-confirm-btn"))

    await waitFor(() => {
      expect(
        screen.queryByTestId("create-pr-guardrail-dialog")
      ).not.toBeInTheDocument()
      expect(screen.getByTestId("created-pr-banner")).toHaveTextContent(
        "feat/retire-session-cache → main"
      )
    })
  })
})
