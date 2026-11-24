import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { useAppStore } from "@/lib/app-store"
import { formatHarnessModelSpec } from "@/lib/harness-adapter"
import { ipcClient } from "@/lib/ipc-client"

import {
  createSession,
  modelsQueryOptions,
  permissionModesQueryOptions,
  refreshModelsCatalog,
  sessionsQueryKeys,
  sessionsQueryOptions,
} from "../api/sessions-api"
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LABEL,
  DEFAULT_PERMISSION_MODE_ID,
  FALLBACK_MODELS,
  FALLBACK_PERMISSION_MODES,
  effortToIndex,
  indexToEffort,
} from "../constants/models"
import { permissionModeIdSchema } from "../schemas"
import type {
  CreateSessionInput,
  ModelOption,
  PermissionModeId,
  ReasoningEffort,
  SessionSummary,
} from "../types"

const MODEL_ID_STORAGE_KEY = "rayu-model-id"
const EFFORT_INDEX_STORAGE_KEY = "rayu-effort-idx"
const PERMISSION_MODE_STORAGE_KEY = "rayu-permission-mode"

function readStoredModelId(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL_ID
  try {
    return window.localStorage.getItem(MODEL_ID_STORAGE_KEY) || DEFAULT_MODEL_ID
  } catch {
    return DEFAULT_MODEL_ID
  }
}

function readStoredEffort(): ReasoningEffort {
  if (typeof window === "undefined") return DEFAULT_EFFORT
  try {
    const raw = window.localStorage.getItem(EFFORT_INDEX_STORAGE_KEY)
    if (raw === null) return DEFAULT_EFFORT
    const parsed = Number.parseInt(raw, 10)
    return Number.isNaN(parsed) ? DEFAULT_EFFORT : indexToEffort(parsed)
  } catch {
    return DEFAULT_EFFORT
  }
}

function readStoredPermissionMode(): PermissionModeId {
  if (typeof window === "undefined") return DEFAULT_PERMISSION_MODE_ID
  try {
    const raw = window.localStorage.getItem(PERMISSION_MODE_STORAGE_KEY)
    const parsed = permissionModeIdSchema.safeParse(raw)
    return parsed.success ? parsed.data : DEFAULT_PERMISSION_MODE_ID
  } catch {
    return DEFAULT_PERMISSION_MODE_ID
  }
}

function persistPermissionMode(mode: PermissionModeId): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PERMISSION_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore storage errors
  }
}

export function useSessions() {
  return useQuery(sessionsQueryOptions())
}

export function useModelCatalog() {
  const queryClient = useQueryClient()
  const query = useQuery(modelsQueryOptions())

  const refreshMutation = useMutation({
    mutationFn: refreshModelsCatalog,
    onSuccess: (models) => {
      queryClient.setQueryData(sessionsQueryKeys.models(), models)
    },
    // Preserve last good catalog on refresh failure (per AGENTS.md)
  })

  return {
    ...query,
    models: query.data ?? [...FALLBACK_MODELS],
    refreshModels: refreshMutation.mutateAsync,
    isRefreshing: refreshMutation.isPending,
  }
}

export function usePermissionModes() {
  const query = useQuery(permissionModesQueryOptions())
  return {
    ...query,
    modes: query.data ?? [...FALLBACK_PERMISSION_MODES],
  }
}

export function useCreateSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateSessionInput) => createSession(input),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<SessionSummary[]>(
        sessionsQueryKeys.list(),
        (prev) => {
          const existing = prev ?? []
          const withoutDup = existing.filter((s) => s.id !== result.data.id)
          return [result.data, ...withoutDup]
        }
      )
      void queryClient.invalidateQueries({
        queryKey: sessionsQueryKeys.list(),
      })
    },
  })
}

export function usePersistedInferenceSettings(models: readonly ModelOption[]) {
  const [modelId, setModelIdState] = React.useState<string>(readStoredModelId)
  const [effort, setEffortState] = React.useState<ReasoningEffort>(readStoredEffort)
  const [permissionMode, setPermissionModeState] =
    React.useState<PermissionModeId>(readStoredPermissionMode)

  const selectedModel = React.useMemo(() => {
    return (
      models.find((m) => m.id === modelId) ??
      FALLBACK_MODELS.find((m) => m.id === modelId) ?? {
        id: DEFAULT_MODEL_ID,
        label: DEFAULT_MODEL_LABEL,
        provider: "anthropic",
      }
    )
  }, [modelId, models])

  const setModel = React.useCallback((model: ModelOption) => {
    setModelIdState(model.id)
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MODEL_ID_STORAGE_KEY, model.id)
      } catch {
        // ignore storage errors
      }
    }
    const activeSessionId = useAppStore.getState().activeSessionId
    const spec = formatHarnessModelSpec(model.id, model.provider, model.apiMethod)
    if (
      activeSessionId &&
      !activeSessionId.startsWith("ses_") &&
      spec
    ) {
      void ipcClient.harness
        .setModel(activeSessionId, spec)
        .then((res) => {
          if (res && !res.ok) {
            toast.error(res.error ?? `Failed to switch model to ${model.label}`)
          }
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : `Failed to switch model to ${model.label}`
          )
        })
    }
  }, [])

  const setEffort = React.useCallback((nextEffort: ReasoningEffort) => {
    setEffortState(nextEffort)
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          EFFORT_INDEX_STORAGE_KEY,
          String(effortToIndex(nextEffort))
        )
      } catch {
        // ignore storage errors
      }
    }
    const activeSessionId = useAppStore.getState().activeSessionId
    if (activeSessionId && !activeSessionId.startsWith("ses_")) {
      void ipcClient.harness
        .setReasoningEffort(activeSessionId, nextEffort.toLowerCase())
        .catch(() => {})
    }
  }, [])

  const permissionModeRef = React.useRef<PermissionModeId>(permissionMode)

  const setPermissionMode = React.useCallback(
    (nextMode: PermissionModeId, onRevert?: (previous: PermissionModeId) => void) => {
      const previousMode = permissionModeRef.current
      permissionModeRef.current = nextMode
      setPermissionModeState(nextMode)
      persistPermissionMode(nextMode)

      const activeSessionId = useAppStore.getState().activeSessionId
      if (!activeSessionId) return

      const revert = (message: string) => {
        permissionModeRef.current = previousMode
        setPermissionModeState(previousMode)
        persistPermissionMode(previousMode)
        onRevert?.(previousMode)
        toast.error(message)
      }

      void ipcClient.harness
        .setPermissionMode(activeSessionId, nextMode)
        .then((res) => {
          if (!res.ok) {
            revert(res.error ?? "RayuCode core rejected the permission mode")
          }
        })
        .catch((error: unknown) => {
          revert(
            error instanceof Error
              ? error.message
              : "Failed to update permission mode"
          )
        })
    },
    []
  )

  return {
    modelId: selectedModel.id,
    modelLabel: selectedModel.label,
    selectedModel,
    effort,
    permissionMode,
    setModel,
    setEffort,
    setPermissionMode,
  }
}
