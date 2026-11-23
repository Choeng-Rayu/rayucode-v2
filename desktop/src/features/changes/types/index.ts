import type {
  ChangedFileDiff as IpcChangedFileDiff,
  ChangesState as IpcChangesState,
  InlineDiffHunkLine,
} from "@/lib/ipc-client"

export type DiffLineType = InlineDiffHunkLine["type"]

export type DiffHunkLine = InlineDiffHunkLine

export type DiffViewMode = "unified" | "split"

export type FileReviewDecision = "pending" | "accepted" | "rejected"

export type ChangedFileDiff = IpcChangedFileDiff

export type ChangesState = IpcChangesState

export interface CommitStagedInput {
  message: string
}

export interface CommitReceipt {
  hash: string
  branch: string
  message: string
  committedCount: number
  committedAt: string
}

export interface CreatePrInput {
  baseBranch: string
  headBranch: string
  title: string
  summary: string
}

export interface CreatePrReceipt {
  id: string
  url: string
  baseBranch: string
  headBranch: string
  title: string
  summary: string
  createdAt: string
}

export interface ChangesSummaryMetrics {
  fileCount: number
  stagedCount: number
  acceptedCount: number
  rejectedCount: number
  pendingCount: number
  totalAdditions: number
  totalDeletions: number
}

export function getFileReviewDecision(
  file: Pick<ChangedFileDiff, "accepted" | "rejected">
): FileReviewDecision {
  if (file.accepted) return "accepted"
  if (file.rejected) return "rejected"
  return "pending"
}
