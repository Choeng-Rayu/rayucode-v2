import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ipcClient } from "@/lib/ipc-client"

import {
  daemonStatusQueryOptions,
  pingDaemon,
  setUseAllCreditsPreference,
  settingsQueryKeys,
  settingsQueryOptions,
  updateSettingsPreferences,
} from "../api/settings-api"
import { daemonStatusSchema } from "../schemas"
import type {
  DaemonStatus,
  SettingsState,
  UpdatePreferencesInput,
} from "../types"

export function useSettingsState() {
  return useQuery(settingsQueryOptions())
}

export function useDaemonStatus() {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    const unsubscribe = ipcClient.daemon.onStatusChange((nextStatus) => {
      const parsed = daemonStatusSchema.safeParse(nextStatus)
      if (!parsed.success) return
      queryClient.setQueryData<DaemonStatus>(
        settingsQueryKeys.daemon(),
        parsed.data
      )
    })
    return unsubscribe
  }, [queryClient])

  return useQuery(daemonStatusQueryOptions())
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: UpdatePreferencesInput) =>
      updateSettingsPreferences(patch),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<SettingsState>(
        settingsQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useToggleUseAllCredits() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (useAllCredits: boolean) =>
      setUseAllCreditsPreference(useAllCredits),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<SettingsState>(
        settingsQueryKeys.state(),
        result.data
      )
    },
  })
}

export function usePingDaemon() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => pingDaemon(),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<DaemonStatus>(
        settingsQueryKeys.daemon(),
        result.data
      )
    },
  })
}
