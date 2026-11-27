import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  agentsQueryKeys,
  agentsQueryOptions,
  deleteAgentProfile,
  setAgentRoleModel,
  setDefaultSubagentModel,
  upsertAgentProfile,
} from "../api/agents-api"
import type {
  AgentRoleId,
  AgentScope,
  AgentsState,
  UpsertAgentProfileInput,
} from "../types"

export function useAgentsState(sessionId?: string | null) {
  return useQuery(agentsQueryOptions(sessionId))
}

export function useSetAgentRoleModel(sessionId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      role: AgentRoleId
      model: string
      scope: AgentScope
    }) => setAgentRoleModel({ ...input, sessionId }),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<AgentsState>(
        agentsQueryKeys.state(sessionId),
        result.data
      )
    },
  })
}

export function useSetDefaultSubagentModel(sessionId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { model: string; scope?: AgentScope }) =>
      setDefaultSubagentModel({ ...input, sessionId }),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<AgentsState>(
        agentsQueryKeys.state(sessionId),
        result.data
      )
    },
  })
}

export function useUpsertAgentProfile(sessionId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertAgentProfileInput) =>
      upsertAgentProfile({ ...input, sessionId }),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<AgentsState>(
        agentsQueryKeys.state(sessionId),
        result.data
      )
    },
  })
}

export function useDeleteAgentProfile(sessionId?: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; scope: AgentScope }) =>
      deleteAgentProfile({ ...input, sessionId }),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<AgentsState>(
        agentsQueryKeys.state(sessionId),
        result.data
      )
    },
  })
}
