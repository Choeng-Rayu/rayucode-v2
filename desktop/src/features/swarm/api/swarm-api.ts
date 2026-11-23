import { queryOptions, type QueryClient } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  sendDmInputSchema,
  spawnWorkerInputSchema,
  swarmStateSchema,
  toggleAgentStateInputSchema,
} from "../schemas"
import type { SpawnWorkerInput, SwarmAgent, SwarmState } from "../types"

export const swarmKeys = {
  all: ["swarm"] as const,
  state: () => [...swarmKeys.all, "state"] as const,
}

export function swarmStateQueryOptions() {
  return queryOptions({
    queryKey: swarmKeys.state(),
    queryFn: async (): Promise<SwarmState> => {
      const raw = await ipcClient.swarm.getState()
      return swarmStateSchema.parse(raw)
    },
    staleTime: 15_000,
  })
}

export function prefetchSwarmState(client: QueryClient): Promise<void> {
  return client.prefetchQuery(swarmStateQueryOptions())
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

export async function spawnSwarmWorker(
  input: SpawnWorkerInput
): Promise<ActionResult<SwarmState>> {
  const parsed = spawnWorkerInputSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors = extractFieldErrors(parsed.error.issues)
    const firstMessage =
      parsed.error.issues[0]?.message ?? "Invalid worker configuration"
    return err(firstMessage, fieldErrors)
  }

  try {
    const raw = await ipcClient.swarm.spawnWorker({
      name: parsed.data.name,
      model: parsed.data.model,
      worktree: parsed.data.worktree,
      task: parsed.data.task,
    })
    const validated = swarmStateSchema.parse(raw)
    const enriched: SwarmState = {
      ...validated,
      agents: validated.agents.map((agent) =>
        agent.id === parsed.data.name
          ? { ...agent, role: parsed.data.role }
          : agent
      ),
    }
    return ok(enriched)
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to spawn swarm worker"
    )
  }
}

export async function toggleSwarmAgentState(
  agentId: string
): Promise<ActionResult<SwarmState>> {
  const parsed = toggleAgentStateInputSchema.safeParse({ agentId })
  if (!parsed.success) {
    return err("Agent ID is required to toggle lifecycle state")
  }

  try {
    const raw = await ipcClient.swarm.toggleAgentState(parsed.data.agentId)
    return ok(swarmStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to update agent state"
    )
  }
}

export async function sendSwarmAgentDm(
  agentId: string,
  message: string
): Promise<ActionResult<SwarmState>> {
  const parsed = sendDmInputSchema.safeParse({ agentId, message })
  if (!parsed.success) {
    const fieldErrors = extractFieldErrors(parsed.error.issues)
    const firstMessage =
      parsed.error.issues[0]?.message ?? "Steering message cannot be empty"
    return err(firstMessage, fieldErrors)
  }

  try {
    const raw = await ipcClient.swarm.sendDm({
      agentId: parsed.data.agentId,
      message: parsed.data.message,
    })
    return ok(swarmStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to send steering DM"
    )
  }
}

export async function toggleAllSwarmWorkers(
  agents: SwarmAgent[],
  shouldPause: boolean
): Promise<ActionResult<SwarmState>> {
  const targets = agents.filter((agent) => {
    if (agent.id === "coordinator" || agent.state === "coordinating") {
      return false
    }
    return shouldPause
      ? agent.state === "running"
      : agent.state === "stopped" || agent.state === "paused"
  })

  if (targets.length === 0) {
    try {
      const current = await ipcClient.swarm.getState()
      return ok(swarmStateSchema.parse(current))
    } catch (error) {
      return err(
        error instanceof Error ? error.message : "Failed to read swarm state"
      )
    }
  }

  try {
    let latest: SwarmState | null = null
    for (const target of targets) {
      latest = await ipcClient.swarm.toggleAgentState(target.id)
    }
    if (!latest) {
      latest = await ipcClient.swarm.getState()
    }
    return ok(swarmStateSchema.parse(latest))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : shouldPause
          ? "Failed to pause running workers"
          : "Failed to resume paused workers"
    )
  }
}

export async function openWorktreeInVSCode(
  worktreePath: string
): Promise<ActionResult<{ ok: boolean }>> {
  try {
    const res = await ipcClient.native.openInVSCode(worktreePath)
    return ok(res)
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to open in VS Code"
    )
  }
}
