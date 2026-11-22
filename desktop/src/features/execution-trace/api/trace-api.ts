import { queryOptions, type QueryClient } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  executionTurnListSchema,
  executionTurnSchema,
  forkTurnInputSchema,
  sendPromptInputSchema,
  togglePinInputSchema,
} from "../schemas"
import type { ExecutionTurn, SessionSummary } from "../types"

export const traceKeys = {
  all: ["execution-trace"] as const,
  turns: (sessionId?: string | null) =>
    [...traceKeys.all, "turns", sessionId ?? "default"] as const,
}

export function traceTurnsQueryOptions(sessionId?: string | null) {
  return queryOptions({
    queryKey: traceKeys.turns(sessionId),
    queryFn: async (): Promise<ExecutionTurn[]> => {
      const raw = await ipcClient.trace.listTurns(sessionId)
      return executionTurnListSchema.parse(raw)
    },
    staleTime: 30_000,
  })
}

export function prefetchTraceTurns(
  client: QueryClient,
  sessionId?: string | null
): Promise<void> {
  return client.prefetchQuery(traceTurnsQueryOptions(sessionId))
}

export async function sendTracePrompt(input: {
  sessionId: string
  prompt: string
  modelLabel: string
}): Promise<ActionResult<ExecutionTurn>> {
  const parsed = sendPromptInputSchema.safeParse(input)
  if (!parsed.success) {
    return err("Validation failed for trace prompt")
  }
  try {
    const raw = await ipcClient.trace.sendPrompt(parsed.data)
    const turn = executionTurnSchema.parse(raw)
    return ok(turn)
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to send prompt"
    )
  }
}

export async function toggleTurnPin(
  turnId: string
): Promise<ActionResult<ExecutionTurn>> {
  const parsed = togglePinInputSchema.safeParse({ turnId })
  if (!parsed.success) {
    return err("Validation failed for turn pin")
  }
  try {
    const raw = await ipcClient.trace.togglePin(parsed.data.turnId)
    if (!raw) {
      return err(`Turn "${turnId}" not found`)
    }
    return ok(executionTurnSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to toggle pin state"
    )
  }
}

export async function forkTurnFromHere(
  sessionId: string,
  turnId: string
): Promise<ActionResult<SessionSummary>> {
  const parsed = forkTurnInputSchema.safeParse({ sessionId, turnId })
  if (!parsed.success) {
    return err("Validation failed for fork turn")
  }
  try {
    const forked = await ipcClient.trace.forkTurn(parsed.data.turnId)
    return ok(forked)
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to fork session"
    )
  }
}

export async function openDiffInVSCode(
  targetPath: string,
  line?: number
): Promise<ActionResult<{ ok: boolean }>> {
  try {
    const result = await ipcClient.native.openInVSCode(targetPath, line)
    return ok(result)
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to open file in VS Code"
    )
  }
}
