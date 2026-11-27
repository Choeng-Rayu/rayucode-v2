import { queryOptions, type QueryClient } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  agentRoleIdSchema,
  agentScopeSchema,
  agentsStateSchema,
  upsertAgentProfileInputSchema,
} from "../schemas"
import type {
  AgentRoleId,
  AgentScope,
  AgentsState,
  UpsertAgentProfileInput,
} from "../types"

export const agentsQueryKeys = {
  all: ["agents"] as const,
  state: (sessionId?: string | null) =>
    [...agentsQueryKeys.all, "state", sessionId ?? "default"] as const,
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

export async function fetchAgentsState(
  sessionId?: string | null
): Promise<AgentsState> {
  const raw = await ipcClient.agents.getState(sessionId ?? undefined)
  return agentsStateSchema.parse(raw)
}

export function agentsQueryOptions(sessionId?: string | null) {
  return queryOptions({
    queryKey: agentsQueryKeys.state(sessionId),
    queryFn: () => fetchAgentsState(sessionId),
    staleTime: 10_000,
  })
}

export function prefetchAgentsState(
  client: QueryClient,
  sessionId?: string | null
): Promise<void> {
  return client.prefetchQuery(agentsQueryOptions(sessionId))
}

export async function setAgentRoleModel(input: {
  role: AgentRoleId
  model: string
  scope: AgentScope
  sessionId?: string | null
}): Promise<ActionResult<AgentsState>> {
  const parsedRole = agentRoleIdSchema.safeParse(input.role)
  const parsedScope = agentScopeSchema.safeParse(input.scope)
  if (!parsedRole.success || !parsedScope.success || !input.model.trim()) {
    return err("Invalid role model selection")
  }
  try {
    const raw = await ipcClient.agents.setRoleModel({
      role: parsedRole.data,
      model: input.model.trim(),
      scope: parsedScope.data,
      sessionId: input.sessionId ?? undefined,
    })
    return ok(agentsStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to update agent role model"
    )
  }
}

export async function setDefaultSubagentModel(input: {
  model: string
  scope?: AgentScope
  sessionId?: string | null
}): Promise<ActionResult<AgentsState>> {
  if (!input.model.trim()) {
    return err("Select a subagent model route")
  }
  try {
    const raw = await ipcClient.agents.setSubagentModel({
      model: input.model.trim(),
      scope: input.scope,
      sessionId: input.sessionId ?? undefined,
    })
    return ok(agentsStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to update subagent default model"
    )
  }
}

export async function upsertAgentProfile(
  input: UpsertAgentProfileInput & { sessionId?: string | null }
): Promise<ActionResult<AgentsState>> {
  const parsed = upsertAgentProfileInputSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors = extractFieldErrors(parsed.error.issues)
    return err(
      parsed.error.issues[0]?.message ?? "Invalid agent persona configuration",
      fieldErrors
    )
  }
  try {
    const raw = await ipcClient.agents.upsertProfile({
      name: parsed.data.name,
      model: parsed.data.model,
      effort: parsed.data.effort === "auto" ? null : parsed.data.effort,
      description: parsed.data.description,
      scope: parsed.data.scope,
      sessionId: input.sessionId ?? undefined,
    })
    return ok(agentsStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to save agent persona profile"
    )
  }
}

export async function deleteAgentProfile(input: {
  name: string
  scope: AgentScope
  sessionId?: string | null
}): Promise<ActionResult<AgentsState>> {
  if (!input.name.trim()) {
    return err("Missing persona name")
  }
  try {
    const raw = await ipcClient.agents.deleteProfile({
      name: input.name.trim(),
      scope: input.scope,
      sessionId: input.sessionId ?? undefined,
    })
    return ok(agentsStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to delete agent persona profile"
    )
  }
}
