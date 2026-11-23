import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  automationsQueryKeys,
  automationsQueryOptions,
  launchOvernightMission,
  toggleAutomationSchedule,
} from "../api/automations-api"
import type {
  AutomationsState,
  LaunchOvernightInput,
  OvernightRun,
} from "../types"

function formatManifestTimestamp(): string {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, "0")
  const mm = String(now.getMinutes()).padStart(2, "0")
  const ss = String(now.getSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

export function useAutomationsState() {
  return useQuery(automationsQueryOptions())
}

export function useLaunchOvernightMission() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: LaunchOvernightInput) => launchOvernightMission(input),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<AutomationsState>(
        automationsQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useToggleSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (scheduleId: string) => toggleAutomationSchedule(scheduleId),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<AutomationsState>(
        automationsQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useOvernightRunActions() {
  const queryClient = useQueryClient()

  const updateRun = React.useCallback(
    (runId: string, updater: (run: OvernightRun) => OvernightRun) => {
      queryClient.setQueryData<AutomationsState>(
        automationsQueryKeys.state(),
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            running: prev.running.map((run) =>
              run.id === runId ? updater(run) : run
            ),
          }
        }
      )
    },
    [queryClient]
  )

  const togglePauseRun = React.useCallback(
    (runId: string) => {
      const ts = formatManifestTimestamp()
      updateRun(runId, (run) => {
        if (run.status === "Cancelled" || run.status === "Completed") {
          return run
        }
        const nextStatus = run.status === "Paused" ? "Running" : "Paused"
        const actionVerb = nextStatus === "Paused" ? "paused" : "resumed"
        return {
          ...run,
          status: nextStatus,
          eventLog: [
            ...run.eventLog,
            `[${ts}] coordinator ${actionVerb} mission (${run.id})`,
          ],
        }
      })
    },
    [updateRun]
  )

  const triggerRunNow = React.useCallback(
    (runId: string) => {
      const ts = formatManifestTimestamp()
      updateRun(runId, (run) => {
        if (run.status === "Cancelled") return run
        return {
          ...run,
          status: "Running",
          validationsGreen: run.validationsGreen + 1,
          eventLog: [
            ...run.eventLog,
            `[${ts}] verifier-1 passed immediate validation check (${run.validationsGreen + 1} green)`,
          ],
        }
      })
    },
    [updateRun]
  )

  const cancelRun = React.useCallback(
    (runId: string) => {
      const ts = formatManifestTimestamp()
      updateRun(runId, (run) => ({
        ...run,
        status: "Cancelled",
        eventLog: [
          ...run.eventLog,
          `[${ts}] coordinator cancelled overnight run (${run.id})`,
        ],
      }))
    },
    [updateRun]
  )

  return {
    togglePauseRun,
    triggerRunNow,
    cancelRun,
  }
}
