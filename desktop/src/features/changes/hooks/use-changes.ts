import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  changesQueryKeys,
  changesStateQueryOptions,
  commitStagedFiles,
  createPullRequestWithGuardrail,
  openChangedFileInVSCode,
  prefetchChangesState,
  reviewChangedFile,
  setAllFilesStaged,
  toggleChangedFileStage,
} from "../api/changes-api"
import {
  getFileReviewDecision,
  type ChangedFileDiff,
  type ChangesState,
  type ChangesSummaryMetrics,
  type CommitReceipt,
  type CreatePrInput,
  type CreatePrReceipt,
  type DiffViewMode,
  type FileReviewDecision,
} from "../types"

export function computeChangesSummary(
  changes: ChangesState | undefined
): ChangesSummaryMetrics {
  const files = changes?.files ?? []
  let stagedCount = 0
  let acceptedCount = 0
  let rejectedCount = 0

  for (const file of files) {
    if (file.staged) stagedCount += 1
    const decision = getFileReviewDecision(file)
    if (decision === "accepted") acceptedCount += 1
    else if (decision === "rejected") rejectedCount += 1
  }

  const totalFiles = changes?.totalChangedFiles ?? files.length

  return {
    fileCount: totalFiles,
    stagedCount,
    acceptedCount,
    rejectedCount,
    pendingCount: totalFiles - acceptedCount - rejectedCount,
    totalAdditions:
      changes?.totalAdditions ??
      files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions:
      changes?.totalDeletions ??
      files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

export interface UseChangesResult {
  changes: ChangesState | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
  summary: ChangesSummaryMetrics
  selectedFileId: string | null
  selectedFile: ChangedFileDiff | undefined
  isLoadingDiff: boolean
  selectFile: (fileId: string) => void
  diffMode: DiffViewMode
  setDiffMode: (mode: DiffViewMode) => void
  prefetchChanges: () => void
  reviewFile: (
    fileId: string,
    decision: FileReviewDecision
  ) => Promise<ActionResult<ChangesState>>
  isReviewing: boolean
  toggleStage: (fileId: string) => Promise<ActionResult<ChangesState>>
  isTogglingStage: boolean
  stageAll: (staged: boolean) => Promise<ActionResult<ChangesState>>
  isStagingAll: boolean
  commitStaged: (message: string) => Promise<ActionResult<CommitReceipt>>
  isCommitting: boolean
  lastCommit: CommitReceipt | null
  createPr: (input: CreatePrInput) => Promise<ActionResult<CreatePrReceipt>>
  isCreatingPr: boolean
  createdPr: CreatePrReceipt | null
  openInVSCode: (filePath: string, line?: number) => Promise<void>
}

export function useChanges(): UseChangesResult {
  const queryClient = useQueryClient()
  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(
    null
  )
  const [diffMode, setDiffMode] = React.useState<DiffViewMode>("unified")
  const [lastCommit, setLastCommit] = React.useState<CommitReceipt | null>(null)
  const [createdPr, setCreatedPr] = React.useState<CreatePrReceipt | null>(null)

  const query = useQuery(changesStateQueryOptions())

  const summary = React.useMemo(
    () => computeChangesSummary(query.data),
    [query.data]
  )

  const rawSelectedFile = React.useMemo(() => {
    const files = query.data?.files ?? []
    if (files.length === 0) return undefined
    if (selectedFileId) {
      const matched = files.find((f) => f.id === selectedFileId)
      if (matched) return matched
    }
    return files[0]
  }, [query.data, selectedFileId])

  const lazyDiffQuery = useQuery({
    queryKey: ["changes", "file-diff", rawSelectedFile?.path ?? ""] as const,
    queryFn: () => ipcClient.changes.getFileDiff(rawSelectedFile!.path),
    enabled: Boolean(
      rawSelectedFile && rawSelectedFile.diffLoaded === false
    ),
    staleTime: 15_000,
  })

  const selectedFile = React.useMemo(() => {
    if (!rawSelectedFile) return undefined
    if (
      rawSelectedFile.diffLoaded === false &&
      Array.isArray(lazyDiffQuery.data) &&
      lazyDiffQuery.data.length > 0
    ) {
      return {
        ...rawSelectedFile,
        diffLoaded: true,
        lines: lazyDiffQuery.data,
      }
    }
    return rawSelectedFile
  }, [lazyDiffQuery.data, rawSelectedFile])

  const resolvedSelectedFileId = selectedFile?.id ?? null

  const reviewMutation = useMutation({
    mutationFn: ({
      fileId,
      decision,
    }: {
      fileId: string
      decision: FileReviewDecision
    }) => {
      const current = queryClient.getQueryData<ChangesState>(
        changesQueryKeys.state()
      )
      return reviewChangedFile(fileId, decision, current)
    },
    onSuccess: (result, variables) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const updatedFile = result.data.files.find(
        (f) => f.id === variables.fileId
      )
      queryClient.setQueryData<ChangesState>(
        changesQueryKeys.state(),
        (prev) => {
          if (!prev || !updatedFile) return result.data
          return {
            ...prev,
            files: prev.files.map((f) =>
              f.id === variables.fileId
                ? {
                    ...f,
                    accepted: updatedFile.accepted,
                    rejected: updatedFile.rejected,
                  }
                : f
            ),
          }
        }
      )
      const label = updatedFile?.path ?? variables.fileId
      if (variables.decision === "accepted") {
        toast(`Accepted changes in ${label}`)
      } else if (variables.decision === "rejected") {
        toast(`Rejected changes in ${label}`)
      } else {
        toast(`Restored review state for ${label}`)
      }
    },
  })

  const stageMutation = useMutation({
    mutationFn: (fileId: string) => {
      const current = queryClient.getQueryData<ChangesState>(
        changesQueryKeys.state()
      )
      return toggleChangedFileStage(fileId, current)
    },
    onSuccess: (result, fileId) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const updatedFile = result.data.files.find((f) => f.id === fileId)
      queryClient.setQueryData<ChangesState>(
        changesQueryKeys.state(),
        (prev) => {
          if (!prev || !updatedFile) return result.data
          return {
            ...prev,
            files: prev.files.map((f) =>
              f.id === fileId ? { ...f, staged: updatedFile.staged } : f
            ),
          }
        }
      )
      if (updatedFile) {
        toast(
          updatedFile.staged
            ? `Staged ${updatedFile.path}`
            : `Unstaged ${updatedFile.path}`
        )
      }
    },
  })

  const stageAllMutation = useMutation({
    mutationFn: (staged: boolean) => {
      const current = queryClient.getQueryData<ChangesState>(
        changesQueryKeys.state()
      )
      return setAllFilesStaged(staged, current)
    },
    onSuccess: (result, staged) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<ChangesState>(
        changesQueryKeys.state(),
        result.data
      )
      toast(
        staged
          ? `Staged all ${result.data.files.length} files`
          : "Unstaged all files"
      )
    },
  })

  const commitMutation = useMutation({
    mutationFn: (message: string) =>
      commitStagedFiles(
        { message },
        query.data?.branch ?? "feat/retire-session-cache",
        summary.stagedCount
      ),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setLastCommit(result.data)
      void queryClient.invalidateQueries({ queryKey: changesQueryKeys.state() })
      void queryClient.invalidateQueries({ queryKey: ["inspector", "changes"] })
      toast(
        `Committed ${result.data.committedCount} staged file(s) (${result.data.hash})`
      )
    },
  })

  const createPrMutation = useMutation({
    mutationFn: (input: CreatePrInput) => createPullRequestWithGuardrail(input),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setCreatedPr(result.data)
      toast(`Created PR targeting ${result.data.baseBranch}`)
    },
  })

  const prefetchChanges = React.useCallback(() => {
    void prefetchChangesState(queryClient)
  }, [queryClient])

  const reviewFile = React.useCallback(
    (fileId: string, decision: FileReviewDecision) =>
      reviewMutation.mutateAsync({ fileId, decision }),
    [reviewMutation]
  )

  const toggleStage = React.useCallback(
    (fileId: string) => stageMutation.mutateAsync(fileId),
    [stageMutation]
  )

  const stageAll = React.useCallback(
    (staged: boolean) => stageAllMutation.mutateAsync(staged),
    [stageAllMutation]
  )

  const commitStaged = React.useCallback(
    (message: string) => commitMutation.mutateAsync(message),
    [commitMutation]
  )

  const createPr = React.useCallback(
    (input: CreatePrInput) => createPrMutation.mutateAsync(input),
    [createPrMutation]
  )

  const openInVSCode = React.useCallback(
    async (filePath: string, line = 1) => {
      const result = await openChangedFileInVSCode(filePath, line)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast(`Opened ${filePath}:${line} in Visual Studio Code`)
    },
    []
  )

  const refetch = React.useCallback(() => {
    void query.refetch()
  }, [query])

  return {
    changes: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error : null,
    refetch,
    summary,
    selectedFileId: resolvedSelectedFileId,
    selectedFile,
    isLoadingDiff: Boolean(
      rawSelectedFile &&
        rawSelectedFile.diffLoaded === false &&
        lazyDiffQuery.isPending
    ),
    selectFile: setSelectedFileId,
    diffMode,
    setDiffMode,
    prefetchChanges,
    reviewFile,
    isReviewing: reviewMutation.isPending,
    toggleStage,
    isTogglingStage: stageMutation.isPending,
    stageAll,
    isStagingAll: stageAllMutation.isPending,
    commitStaged,
    isCommitting: commitMutation.isPending,
    lastCommit,
    createPr,
    isCreatingPr: createPrMutation.isPending,
    createdPr,
    openInVSCode,
  }
}
