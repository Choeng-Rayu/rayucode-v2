import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { ActionResult } from "@/lib/action-result"

import {
  prefetchSwarmState,
  sendSwarmAgentDm,
  spawnSwarmWorker,
  swarmKeys,
  swarmStateQueryOptions,
  toggleAllSwarmWorkers,
  toggleSwarmAgentState,
} from "../api/swarm-api"
import type {
  SpawnWorkerInput,
  SwarmAgent,
  SwarmState,
  SwarmTelemetrySummary,
} from "../types"

function formatPlanVersion(planVersion: string): {
  planLabel: string
  planVersionShort: string
} {
  const match = planVersion.match(/v\d+/i)
  const short = match ? match[0].toLowerCase() : planVersion
  return {
    planLabel: `Shared Plan ${short}`,
    planVersionShort: short,
  }
}

export function computeSwarmTelemetry(
  swarm: SwarmState | undefined
): SwarmTelemetrySummary {
  const agents = swarm?.agents ?? []
  const worktrees = swarm?.worktrees ?? []
  const runningCount = agents.filter((a) => a.state === "running").length
  const completedCount = agents.filter((a) => a.state === "completed").length
  const rootCount = agents.filter(
    (a) => a.state === "coordinating" || a.id === "coordinator"
  ).length
  const stoppedCount = agents.filter((a) => a.state === "stopped").length
  const pausedCount = agents.filter((a) => a.state === "paused").length
  const { planLabel, planVersionShort } = formatPlanVersion(
    swarm?.planVersion ?? "plan v3"
  )

  return {
    totalAgents: agents.length,
    runningCount,
    completedCount,
    rootCount,
    stoppedCount,
    pausedCount,
    worktreeCount: worktrees.length,
    conflictCount: 0,
    allWorkersPaused: runningCount === 0 && stoppedCount + pausedCount > 0,
    planLabel,
    planVersionShort,
  }
}

export interface UseSwarmResult {
  swarm: SwarmState | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
  telemetry: SwarmTelemetrySummary
  selectedAgentId: string
  selectedAgent: SwarmAgent | undefined
  selectAgent: (agentId: string) => void
  prefetchSwarm: () => void
  spawnWorker: (input: SpawnWorkerInput) => Promise<ActionResult<SwarmState>>
  isSpawning: boolean
  toggleAgentState: (agentId: string) => Promise<ActionResult<SwarmState>>
  isTogglingAgent: boolean
  sendDm: (
    agentId: string,
    message: string
  ) => Promise<ActionResult<SwarmState>>
  isSendingDm: boolean
  togglePauseAll: () => Promise<ActionResult<SwarmState>>
  isTogglingAll: boolean
}

export function useSwarm(): UseSwarmResult {
  const queryClient = useQueryClient()
  const [selectedAgentId, setSelectedAgentId] = React.useState<string>("worker-1")

  const query = useQuery(swarmStateQueryOptions())

  const telemetry = React.useMemo(
    () => computeSwarmTelemetry(query.data),
    [query.data]
  )

  const selectedAgent = React.useMemo(() => {
    const agents = query.data?.agents ?? []
    if (agents.length === 0) return undefined
    return (
      agents.find((agent) => agent.id === selectedAgentId) ??
      agents.find((agent) => agent.id === "worker-1") ??
      agents[0]
    )
  }, [query.data, selectedAgentId])

  const resolvedSelectedId = selectedAgent?.id ?? selectedAgentId

  const spawnMutation = useMutation({
    mutationFn: (input: SpawnWorkerInput) => spawnSwarmWorker(input),
    onSuccess: (result, variables) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<SwarmState>(swarmKeys.state(), result.data)
      setSelectedAgentId(variables.name.trim())
      toast(`Spawned ${variables.name.trim()} (${variables.model})`)
    },
  })

  const toggleAgentMutation = useMutation({
    mutationFn: (agentId: string) => toggleSwarmAgentState(agentId),
    onSuccess: (result, agentId) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<SwarmState>(swarmKeys.state(), result.data)
      const updated = result.data.agents.find((a) => a.id === agentId)
      if (updated) {
        toast(
          updated.state === "stopped"
            ? `Stopped ${updated.name} cleanly`
            : `Resumed ${updated.name}`
        )
      }
    },
  })

  const sendDmMutation = useMutation({
    mutationFn: ({ agentId, message }: { agentId: string; message: string }) =>
      sendSwarmAgentDm(agentId, message),
    onSuccess: (result, variables) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<SwarmState>(swarmKeys.state(), result.data)
      toast(`Sent steering DM to @${variables.agentId}`)
    },
  })

  const toggleAllMutation = useMutation({
    mutationFn: ({
      agents,
      shouldPause,
    }: {
      agents: SwarmAgent[]
      shouldPause: boolean
    }) => toggleAllSwarmWorkers(agents, shouldPause),
    onSuccess: (result, variables) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      queryClient.setQueryData<SwarmState>(swarmKeys.state(), result.data)
      toast(
        variables.shouldPause
          ? `Paused running workers in ${result.data.swarmId}`
          : `Resumed workers in ${result.data.swarmId}`
      )
    },
  })

  const prefetchSwarm = React.useCallback(() => {
    void prefetchSwarmState(queryClient)
  }, [queryClient])

  const spawnWorker = React.useCallback(
    (input: SpawnWorkerInput) => spawnMutation.mutateAsync(input),
    [spawnMutation]
  )

  const toggleAgentState = React.useCallback(
    (agentId: string) => toggleAgentMutation.mutateAsync(agentId),
    [toggleAgentMutation]
  )

  const sendDm = React.useCallback(
    (agentId: string, message: string) =>
      sendDmMutation.mutateAsync({ agentId, message }),
    [sendDmMutation]
  )

  const togglePauseAll = React.useCallback(async () => {
    const agents = query.data?.agents ?? []
    const shouldPause = !telemetry.allWorkersPaused
    return toggleAllMutation.mutateAsync({ agents, shouldPause })
  }, [query.data, telemetry.allWorkersPaused, toggleAllMutation])

  const refetch = React.useCallback(() => {
    void query.refetch()
  }, [query])

  return {
    swarm: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error : null,
    refetch,
    telemetry,
    selectedAgentId: resolvedSelectedId,
    selectedAgent,
    selectAgent: setSelectedAgentId,
    prefetchSwarm,
    spawnWorker,
    isSpawning: spawnMutation.isPending,
    toggleAgentState,
    isTogglingAgent: toggleAgentMutation.isPending,
    sendDm,
    isSendingDm: sendDmMutation.isPending,
    togglePauseAll,
    isTogglingAll: toggleAllMutation.isPending,
  }
}
