import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAppStore } from "@/lib/app-store"

import {
  acceptInspectorDiff,
  codeFileQueryOptions,
  inspectorChangesQueryOptions,
  inspectorKeys,
  inspectorStateQueryOptions,
  rejectInspectorDiff,
} from "../api/inspector-api"
import type {
  ContextBreakdownRow,
  InspectorChangesState,
  InspectorViewModel,
} from "../types"

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`
  }
  return String(tokens)
}

export interface ContextBarSegment {
  id: string
  label: string
  widthPct: number
  colorClass: string
}

export function useInspectorState() {
  const query = useQuery(inspectorStateQueryOptions())
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessionUsage = useAppStore((s) =>
    activeSessionId ? s.sessionTokenUsageBySession[activeSessionId] : undefined
  )

  const data = React.useMemo<InspectorViewModel | undefined>(() => {
    if (!query.data || !sessionUsage) {
      return query.data
    }
    const usedTokens =
      sessionUsage.input + sessionUsage.cacheRead + sessionUsage.cacheCreation
    if (usedTokens <= 0) {
      return query.data
    }
    const budget = sessionUsage.effectiveBudget ?? 200_000
    const pct = Math.min(100, Math.round((usedTokens / budget) * 100))
    return {
      ...query.data,
      context: {
        ...query.data.context,
        usedPctLabel: `${pct}% used`,
        tokensSummary: `${formatCompactTokens(usedTokens)} / ${formatCompactTokens(budget)}`,
      },
    }
  }, [query.data, sessionUsage])

  return {
    ...query,
    data,
  }
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
