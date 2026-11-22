import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  acceptInspectorDiff,
  codeFileQueryOptions,
  inspectorChangesQueryOptions,
  inspectorKeys,
  inspectorStateQueryOptions,
  rejectInspectorDiff,
} from "../api/inspector-api"
import type { ContextBreakdownRow, InspectorChangesState } from "../types"

export interface ContextBarSegment {
  id: string
  label: string
  widthPct: number
  colorClass: string
}

export function useInspectorState() {
  return useQuery(inspectorStateQueryOptions())
}

export function useContextStats() {
  const query = useInspectorState()

  const segments = React.useMemo<ContextBarSegment[]>(() => {
    if (!query.data) return []
    const usedRows: ContextBreakdownRow[] = [
      ...query.data.context.rows,
      query.data.context.bufferRow,
    ]
    return usedRows
      .filter((row) => row.barWidthPct > 0)
      .map((row) => ({
        id: row.id,
        label: row.label,
        widthPct: row.barWidthPct,
        colorClass: row.colorClass,
      }))
  }, [query.data])

  const primaryConnectors = React.useMemo(
    () => query.data?.connectors.filter((c) => c.primary) ?? [],
    [query.data]
  )

  const secondaryConnectors = React.useMemo(
    () => query.data?.connectors.filter((c) => !c.primary) ?? [],
    [query.data]
  )

  return {
    ...query,
    segments,
    primaryConnectors,
    secondaryConnectors,
  }
}

export function useCodeFile(fileKey: string) {
  return useQuery(codeFileQueryOptions(fileKey))
}

export function usePrefetchCodeFile() {
  const queryClient = useQueryClient()
  return React.useCallback(
    (fileKey: string) => {
      void queryClient.prefetchQuery(codeFileQueryOptions(fileKey))
    },
    [queryClient]
  )
}

export function useInspectorChanges() {
  return useQuery(inspectorChangesQueryOptions())
}

export function useDiffDecisionMutation() {
  const queryClient = useQueryClient()

  return useMutation<
    InspectorChangesState,
    Error,
    { fileId: string; decision: "accept" | "reject" }
  >({
    mutationFn: ({ fileId, decision }) =>
      decision === "accept"
        ? acceptInspectorDiff(fileId)
        : rejectInspectorDiff(fileId),
    onSuccess: (nextState) => {
      queryClient.setQueryData(inspectorKeys.changes(), nextState)
    },
  })
}
