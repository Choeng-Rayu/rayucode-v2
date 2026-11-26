import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ipcClient, type ConfigStatePayload } from "@/lib/ipc-client"

import {
  daemonStatusQueryOptions,
  engineConfigQueryOptions,
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

export function useEngineConfig() {
  const queryClient = useQueryClient()
  const query = useQuery(engineConfigQueryOptions())
  const [requiresRestart, setRequiresRestart] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>(
    {}
  )
  const [sectionError, setSectionError] = React.useState<string | null>(null)
  const [externalSyncNotice, setExternalSyncNotice] = React.useState<
    string | null
  >(null)

  React.useEffect(() => {
    if (!externalSyncNotice) return
    const timer = window.setTimeout(() => setExternalSyncNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [externalSyncNotice])

  // Subscribe to live `config_changed` broadcasts from `~/.rayu/config.toml`
  React.useEffect(() => {
    const unsub = ipcClient.harness.onEvent((frame) => {
      if (frame.ev !== "config_changed") return
      const incomingValues =
        frame.values &&
        typeof frame.values === "object" &&
        !Array.isArray(frame.values)
          ? (frame.values as Record<string, unknown>)
          : null
      if (incomingValues) {
        queryClient.setQueryData<ConfigStatePayload | null>(
          settingsQueryKeys.engineConfig(),
          (prev) => {
            if (!prev) return prev
            return {
              ...prev,
              values: { ...prev.values, ...incomingValues },
            }
          }
        )
      }
      if (frame.requires_restart === true) {
        setRequiresRestart(true)
      }
      setExternalSyncNotice("Synced update from ~/.rayu/config.toml")
    })
    return unsub
  }, [queryClient])

  const patchMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const res = await ipcClient.harness.patchConfig({ [key]: value })
      return { key, res }
    },
    onSuccess: ({ key, res }) => {
      if (!res.ok) {
        const message = res.error ?? `Failed to update ${key}`
        if (res.code === "invalid_request") {
          setFieldErrors((prev) => ({ ...prev, [key]: message }))
        } else {
          setSectionError(message)
        }
        return
      }
      setFieldErrors((prev) => {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      setSectionError(null)
      if (res.state) {
        queryClient.setQueryData<ConfigStatePayload | null>(
          settingsQueryKeys.engineConfig(),
          res.state
        )
        const field = res.state.schema.find((f) => f.key === key)
        if (field?.apply_mode === "restart_required") {
          setRequiresRestart(true)
        }
      }
    },
    onError: (error, { key }) => {
      const message =
        error instanceof Error ? error.message : `Failed to update ${key}`
      setSectionError(message)
    },
  })

  const dismissFieldError = React.useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  return {
    config: query.data ?? null,
    isLoading: query.isLoading,
    isUnsupported: !query.isLoading && query.data === null,
    isPatching: patchMutation.isPending,
    patchField: (key: string, value: unknown) =>
      patchMutation.mutateAsync({ key, value }),
    requiresRestart,
    clearRequiresRestart: () => setRequiresRestart(false),
    fieldErrors,
    dismissFieldError,
    sectionError,
    dismissSectionError: () => setSectionError(null),
    externalSyncNotice,
  }
}
