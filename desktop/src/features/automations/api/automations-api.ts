import { queryOptions } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  automationsStateSchema,
  launchOvernightInputSchema,
} from "../schemas"
import type { AutomationsState, LaunchOvernightInput } from "../types"

export const automationsQueryKeys = {
  all: ["automations"] as const,
  state: () => [...automationsQueryKeys.all, "state"] as const,
}

export async function fetchAutomationsState(): Promise<AutomationsState> {
  const raw = await ipcClient.automations.getState()
  return automationsStateSchema.parse(raw)
}

export function automationsQueryOptions() {
  return queryOptions({
    queryKey: automationsQueryKeys.state(),
    queryFn: fetchAutomationsState,
    staleTime: 30_000,
  })
}

export async function launchOvernightMission(
  input: LaunchOvernightInput
): Promise<ActionResult<AutomationsState>> {
  const parsed = launchOvernightInputSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form")
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
    }
    return err(firstIssue?.message ?? "Invalid overnight mission input", fieldErrors)
  }

  try {
    const raw = await ipcClient.automations.launchOvernight({
      mission: parsed.data.mission,
      duration: parsed.data.duration,
      maxAgents: parsed.data.maxAgents,
      permissionMode: parsed.data.permissionMode,
    })
    const validated = automationsStateSchema.parse(raw)

    // Preserve launcher repository & morning handoff time on the newly launched head run
    const [headRun, ...restRuns] = validated.running
    if (headRun && headRun.title === parsed.data.mission) {
      const enrichedHead = {
        ...headRun,
        repo: parsed.data.repo,
        handoffTime: parsed.data.handoffTime,
      }
      return ok({
        ...validated,
        running: [enrichedHead, ...restRuns],
      })
    }

    return ok(validated)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to launch overnight mission"
    return err(message)
  }
}

export async function toggleAutomationSchedule(
  scheduleId: string
): Promise<ActionResult<AutomationsState>> {
  try {
    const raw = await ipcClient.automations.toggleSchedule(scheduleId)
    const validated = automationsStateSchema.parse(raw)
    return ok(validated)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to toggle schedule"
    return err(message)
  }
}
