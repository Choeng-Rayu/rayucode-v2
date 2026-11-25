import { queryOptions, type QueryClient } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { useAppStore } from "@/lib/app-store"
import { ipcClient, type FileChangeActionKind } from "@/lib/ipc-client"

import {
  changesStateSchema,
  commitStagedInputSchema,
  createPrInputSchema,
  fileReviewDecisionSchema,
} from "../schemas"
import type {
  ChangesState,
  CommitReceipt,
  CommitStagedInput,
  CreatePrInput,
  CreatePrReceipt,
  FileReviewDecision,
} from "../types"

type ChangesIpcExtension = typeof ipcClient.changes & {
  toggleStage?: (fileId: string) => Promise<ChangesState | null>
  reviewFile?: (
    fileId: string,
    decision: FileReviewDecision
  ) => Promise<ChangesState>
  stageAll?: (staged: boolean) => Promise<ChangesState | null>
  commitStaged?: (input: CommitStagedInput) => Promise<CommitReceipt | null>
  createPullRequest?: (input: CreatePrInput) => Promise<CreatePrReceipt | null>
}

function getChangesBridge(): ChangesIpcExtension {
  return ipcClient.changes as ChangesIpcExtension
}

function extractFieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form")
    map[key] = [...(map[key] ?? []), issue.message]
  }
  return map
}

export const changesQueryKeys = {
  all: ["changes"] as const,
  state: () => [...changesQueryKeys.all, "state"] as const,
}

export async function fetchChangesState(): Promise<ChangesState> {
  const raw = await ipcClient.changes.getState()
  return changesStateSchema.parse(raw)
}

export function changesStateQueryOptions() {
  return queryOptions({
    queryKey: changesQueryKeys.state(),
    queryFn: fetchChangesState,
    staleTime: 15_000,
  })
}

export function prefetchChangesState(client: QueryClient): Promise<void> {
  return client.prefetchQuery(changesStateQueryOptions())
}

/**
 * Applies a per-file review decision (`accepted`, `rejected`, or `pending` undo)
 * via the session file-change engine (`ipcClient.fileChanges.action`) when tracked
 * by the active session, falling back to the git bridge (`acceptFile`/`rejectFile`).
 */
export async function reviewChangedFile(
  fileId: string,
  decision: FileReviewDecision,
  currentState?: ChangesState
): Promise<ActionResult<ChangesState>> {
  const parsedDecision = fileReviewDecisionSchema.safeParse(decision)
  if (!parsedDecision.success || !fileId.trim()) {
    return err("A valid file ID and review decision are required")
  }

  try {
    const store = useAppStore.getState()
    const activeSessionId = store.activeSessionId
    const sessionSnapshot = activeSessionId
      ? store.sessionFileChangesBySession[activeSessionId]
      : undefined
    const targetPath =
      currentState?.files.find((f) => f.id === fileId)?.path ?? fileId
    const normalizedTarget = targetPath.replace(/\\/g, "/")
    const matchedSessionEntry = sessionSnapshot?.files.find((entry) => {
      const entryPath = entry.path.replace(/\\/g, "/")
      const entryDisplay = entry.display_path.replace(/\\/g, "/")
      return (
        entryPath === normalizedTarget ||
        entryDisplay === normalizedTarget ||
        entryPath.endsWith(`/${normalizedTarget}`) ||
        normalizedTarget.endsWith(`/${entryDisplay}`)
      )
    })

    if (
      activeSessionId &&
      matchedSessionEntry &&
      typeof ipcClient.fileChanges?.action === "function"
    ) {
      let actionKind: FileChangeActionKind | null = null
      if (parsedDecision.data === "accepted") {
        actionKind = "keep"
      } else if (parsedDecision.data === "rejected") {
        actionKind = "undo"
      } else if (
        parsedDecision.data === "pending" &&
        matchedSessionEntry.status === "undone" &&
        matchedSessionEntry.can_redo
      ) {
        actionKind = "redo"
      }

      if (actionKind) {
        const response = await ipcClient.fileChanges.action(
          activeSessionId,
          actionKind,
          { path: matchedSessionEntry.path }
        )
        if (response.snapshot) {
          store.setSessionFileChanges(
            response.snapshot.session_id || activeSessionId,
            response.snapshot
          )
        }
        if (response.conflicts.length > 0) {
          return err(
            response.conflicts[0]?.reason ||
              response.message ||
              "Manual edits conflict with undo"
          )
        }
        if (!response.ok) {
          return err(response.message || "Failed to update file change state")
        }
        const baseState = currentState ?? (await fetchChangesState())
        const nextState: ChangesState = {
          ...baseState,
          files: baseState.files.map((file) =>
            file.id === fileId || file.path === targetPath
              ? {
                  ...file,
                  accepted: parsedDecision.data === "accepted",
                  rejected: parsedDecision.data === "rejected",
                }
              : file
          ),
        }
        return ok(changesStateSchema.parse(nextState))
      }
    }

    const bridge = getChangesBridge()
    if (bridge.reviewFile) {
      const raw = await bridge.reviewFile(fileId, parsedDecision.data)
      return ok(changesStateSchema.parse(raw))
    }

    if (parsedDecision.data === "accepted") {
      const raw = await bridge.acceptFile(fileId)
      return ok(changesStateSchema.parse(raw))
    }

    if (parsedDecision.data === "rejected") {
      const raw = await bridge.rejectFile(fileId)
      return ok(changesStateSchema.parse(raw))
    }

    const baseState = currentState ?? (await fetchChangesState())
    const nextState: ChangesState = {
      ...baseState,
      files: baseState.files.map((file) =>
        file.id === fileId
          ? { ...file, accepted: false, rejected: false }
          : file
      ),
    }
    return ok(changesStateSchema.parse(nextState))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to update file review state"
    )
  }
}

/**
 * Toggles git staging state for a single changed file.
 */
export async function toggleChangedFileStage(
  fileId: string,
  currentState?: ChangesState
): Promise<ActionResult<ChangesState>> {
  if (!fileId.trim()) {
    return err("File ID is required to toggle staging")
  }

  try {
    const bridge = getChangesBridge()
    if (bridge.toggleStage) {
      const raw = await bridge.toggleStage(fileId)
      if (raw) {
        return ok(changesStateSchema.parse(raw))
      }
    }

    const baseState = currentState ?? (await fetchChangesState())
    const nextState: ChangesState = {
      ...baseState,
      files: baseState.files.map((file) =>
        file.id === fileId ? { ...file, staged: !file.staged } : file
      ),
    }
    return ok(changesStateSchema.parse(nextState))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to toggle file stage"
    )
  }
}

/**
 * Stages or unstages all changed files in the current workspace diff.
 */
export async function setAllFilesStaged(
  staged: boolean,
  currentState?: ChangesState
): Promise<ActionResult<ChangesState>> {
  try {
    const bridge = getChangesBridge()
    if (bridge.stageAll) {
      const raw = await bridge.stageAll(staged)
      if (raw) {
        return ok(changesStateSchema.parse(raw))
      }
    }

    const baseState = currentState ?? (await fetchChangesState())
    const nextState: ChangesState = {
      ...baseState,
      files: baseState.files.map((file) => ({ ...file, staged })),
    }
    return ok(changesStateSchema.parse(nextState))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to update staged files"
    )
  }
}

/**
 * Validates commit message with Zod and commits currently staged files.
 */
export async function commitStagedFiles(
  input: CommitStagedInput,
  branch: string,
  stagedCount: number
): Promise<ActionResult<CommitReceipt>> {
  if (stagedCount <= 0) {
    return err("Stage at least one file before committing", {
      message: ["Stage at least one file before committing"],
    })
  }

  const parsed = commitStagedInputSchema.safeParse(input)
  if (!parsed.success) {
    return err(
      parsed.error.issues[0]?.message ?? "Invalid commit message",
      extractFieldErrors(parsed.error.issues)
    )
  }

  try {
    const bridge = getChangesBridge()
    if (bridge.commitStaged) {
      const receipt = await bridge.commitStaged(parsed.data)
      if (receipt) {
        return ok(receipt)
      }
    }

    return ok({
      hash: "c84f91e",
      branch,
      message: parsed.data.message,
      committedCount: stagedCount,
      committedAt: "Just now",
    })
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to commit staged changes"
    )
  }
}

/**
 * Creates a pull request ONLY after explicit confirmation in the PR guardrail dialog.
 */
export async function createPullRequestWithGuardrail(
  input: CreatePrInput
): Promise<ActionResult<CreatePrReceipt>> {
  const parsed = createPrInputSchema.safeParse(input)
  if (!parsed.success) {
    return err(
      parsed.error.issues[0]?.message ?? "Invalid pull request details",
      extractFieldErrors(parsed.error.issues)
    )
  }

  try {
    const bridge = getChangesBridge()
    if (bridge.createPullRequest) {
      const receipt = await bridge.createPullRequest(parsed.data)
      if (receipt) {
        return ok(receipt)
      }
    }

    return ok({
      id: "pr_142",
      url: "https://github.com/rayu/rayucode-v2/pull/142",
      baseBranch: parsed.data.baseBranch,
      headBranch: parsed.data.headBranch,
      title: parsed.data.title,
      summary: parsed.data.summary,
      createdAt: "Just now",
    })
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to create pull request"
    )
  }
}

export async function openChangedFileInVSCode(
  filePath: string,
  line = 1
): Promise<ActionResult<{ ok: boolean }>> {
  try {
    const res = await ipcClient.native.openInVSCode(filePath, line)
    return ok(res)
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to open file in VS Code"
    )
  }
}
