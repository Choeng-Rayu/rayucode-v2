import { queryOptions } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  daemonStatusSchema,
  settingsStateSchema,
  updatePreferencesPatchSchema,
} from "../schemas"
import type {
  DaemonStatus,
  SettingsState,
  UpdatePreferencesInput,
} from "../types"

export const settingsQueryKeys = {
  all: ["settings"] as const,
  state: () => [...settingsQueryKeys.all, "state"] as const,
  daemon: () => [...settingsQueryKeys.all, "daemon"] as const,
}

export async function fetchSettingsState(): Promise<SettingsState> {
  const raw = await ipcClient.settings.getState()
  return settingsStateSchema.parse(raw)
}

export function settingsQueryOptions() {
  return queryOptions({
    queryKey: settingsQueryKeys.state(),
    queryFn: fetchSettingsState,
    staleTime: 30_000,
  })
}

export async function fetchDaemonStatus(): Promise<DaemonStatus> {
  const raw = await ipcClient.daemon.getStatus()
  return daemonStatusSchema.parse(raw)
}

export function daemonStatusQueryOptions() {
  return queryOptions({
    queryKey: settingsQueryKeys.daemon(),
    queryFn: fetchDaemonStatus,
    staleTime: 10_000,
  })
}

export async function updateSettingsPreferences(
  patch: UpdatePreferencesInput
): Promise<ActionResult<SettingsState>> {
  const parsed = updatePreferencesPatchSchema.safeParse(patch)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return err(firstIssue?.message ?? "Invalid preference update")
  }

  try {
    const raw = await ipcClient.settings.updatePreferences(parsed.data)
    const validated = settingsStateSchema.parse(raw)
    return ok(validated)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update preferences"
    return err(message)
  }
}

export async function setUseAllCreditsPreference(
  useAllCredits: boolean
): Promise<ActionResult<SettingsState>> {
  try {
    const raw = await ipcClient.settings.setUseAllCredits(useAllCredits)
    const validated = settingsStateSchema.parse(raw)
    return ok(validated)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update credit pacing setting"
    return err(message)
  }
}

export async function pingDaemon(): Promise<ActionResult<DaemonStatus>> {
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now()
  try {
    const raw = await ipcClient.daemon.getStatus()
    const elapsed = Math.max(
      1,
      Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          startedAt
      )
    )
    const validated = daemonStatusSchema.parse(raw)
    return ok({
      ...validated,
      latencyMs: validated.latencyMs > 0 ? validated.latencyMs : elapsed,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to ping rayu daemon"
    return err(message)
  }
}
