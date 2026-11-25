import * as React from "react"
import { resolveEffortLadder } from "@rayu-dev/rayucode-session-core/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { useAppStore } from "@/lib/app-store"
import { formatHarnessModelSpec } from "@/lib/harness-adapter"
import { ipcClient } from "@/lib/ipc-client"

import {
  capabilitiesQueryOptions,
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
const EFFORT_STORAGE_KEY = "rayu-effort"
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
    const raw = window.localStorage.getItem(EFFORT_STORAGE_KEY)?.trim() ?? ""
    if (!raw || raw.toLowerCase() === "auto") return DEFAULT_EFFORT
    return raw.toLowerCase()
  } catch {
    return DEFAULT_EFFORT
  }
}

function persistEffort(nextEffort: string): void {
  if (typeof window === "undefined") return
  try {
    const normalized = nextEffort.trim().toLowerCase()
    if (!normalized || normalized === "auto") {
      window.localStorage.removeItem(EFFORT_STORAGE_KEY)
    } else {
      window.localStorage.setItem(EFFORT_STORAGE_KEY, normalized)
    }
  } catch {
    // ignore storage errors
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

export function useCapabilities(sessionId?: string | null) {
  return useQuery(capabilitiesQueryOptions(sessionId ?? undefined))
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
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const [modelId, setModelIdState] = React.useState<string>(readStoredModelId)
  const [effort, setEffortState] = React.useState<ReasoningEffort>(readStoredEffort)
  const [permissionMode, setPermissionModeState] =
    React.useState<PermissionModeId>(readStoredPermissionMode)
  const [deferredNotice, setDeferredNotice] = React.useState<string | null>(null)

  const modelIdRef = React.useRef<string>(modelId)
  const effortRef = React.useRef<ReasoningEffort>(effort)
  const modelsRef = React.useRef<readonly ModelOption[]>(models)

  React.useEffect(() => {
    modelIdRef.current = modelId
  }, [modelId])

  React.useEffect(() => {
    effortRef.current = effort
  }, [effort])

  React.useEffect(() => {
    modelsRef.current = models
  }, [models])

  // Reconcile live active model & effort whenever daemon emits `model_info`
  React.useEffect(() => {
    return ipcClient.harness.onEvent((frame) => {
      if (frame.ev !== "model_info") return
      const sid = useAppStore.getState().activeSessionId
      const frameSid =
        typeof frame.session_id === "string" ? frame.session_id : ""
      if (sid && frameSid && frameSid !== sid) return

      const rawModel = typeof frame.model === "string" ? frame.model : ""
      if (rawModel) {
        const matched = modelsRef.current.find(
          (m) =>
            m.id === rawModel ||
            m.label === rawModel ||
            m.id.replace(/^rayu:/i, "") === rawModel.replace(/^rayu:/i, "")
        )
        if (matched) {
          setModelIdState(matched.id)
        }
      }
      const rawEffort =
        typeof frame.reasoning_effort === "string"
          ? frame.reasoning_effort.trim().toLowerCase()
          : ""
      if (rawEffort && rawEffort !== "auto") {
        setEffortState(rawEffort)
      }
      setDeferredNotice(null)
    })
  }, [])

  const selectedModel = React.useMemo<ModelOption>(() => {
    return (
      models.find((m) => m.id === modelId) ??
      models[0] ?? {
        id: modelId || DEFAULT_MODEL_ID,
        label: modelId && modelId !== DEFAULT_MODEL_ID ? modelId : DEFAULT_MODEL_LABEL,
        provider: "rayu",
      }
    )
  }, [modelId, models])

  const effortLadder = React.useMemo(
    () => resolveEffortLadder(selectedModel),
    [selectedModel]
  )

  const effectiveEffort = React.useMemo<ReasoningEffort>(() => {
    if (!effortLadder.supported) return ""
    const normalized = effort.trim().toLowerCase()
    const match = effortLadder.stops.find((s) => s.toLowerCase() === normalized)
    return match ?? effortLadder.defaultStop ?? ""
  }, [effort, effortLadder])

  const setModel = React.useCallback((model: ModelOption) => {
    const previousModelId = modelIdRef.current
    setModelIdState(model.id)
    setDeferredNotice(null)

    const nextLadder = resolveEffortLadder(model)
    if (!nextLadder.supported) {
      setEffortState("")
      persistEffort("")
    } else {
      const currentLower = effortRef.current.trim().toLowerCase()
      const validStop = nextLadder.stops.find(
        (s) => s.toLowerCase() === currentLower
      )
      const reconciled = validStop ?? nextLadder.defaultStop ?? ""
      setEffortState(reconciled)
      persistEffort(reconciled)
    }

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MODEL_ID_STORAGE_KEY, model.id)
      } catch {
        // ignore storage errors
      }
    }

    const sid = useAppStore.getState().activeSessionId
    const spec = formatHarnessModelSpec(model.id, model.provider, model.apiMethod)
    if (sid && !sid.startsWith("ses_") && spec) {
      void ipcClient.harness
        .setModel(sid, spec)
        .then((res) => {
          if (!res || res.ok) {
            setDeferredNotice(null)
            return
          }
          if (res.code === "busy") {
            setDeferredNotice("Applies on next turn")
            return
          }
          setModelIdState(previousModelId)
          toast.error(res.error ?? `Failed to switch model to ${model.label}`)
        })
        .catch((error: unknown) => {
          setModelIdState(previousModelId)
          toast.error(
            error instanceof Error
              ? error.message
              : `Failed to switch model to ${model.label}`
          )
        })
    }
  }, [])

  const setEffort = React.useCallback((nextEffort: ReasoningEffort) => {
    const normalized = nextEffort.trim().toLowerCase()
    if (!normalized || normalized === "auto") return

    const previousEffort = effortRef.current
    setEffortState(normalized)
    persistEffort(normalized)
    setDeferredNotice(null)

    const sid = useAppStore.getState().activeSessionId
    if (sid && !sid.startsWith("ses_")) {
      void ipcClient.harness
        .setReasoningEffort(sid, normalized)
        .then((res) => {
          if (!res || res.ok) {
            setDeferredNotice(null)
            return
          }
          if (res.code === "busy") {
            setDeferredNotice("Applies on next turn")
            return
          }
          setEffortState(previousEffort)
          persistEffort(previousEffort)
          toast.error(res.error ?? `Failed to set reasoning effort to ${normalized}`)
        })
        .catch((error: unknown) => {
          setEffortState(previousEffort)
          persistEffort(previousEffort)
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to update reasoning effort"
          )
        })
    }
  }, [])

  const permissionModeRef = React.useRef<PermissionModeId>(permissionMode)

  const setPermissionMode = React.useCallback(
    (
      nextMode: PermissionModeId,
      onRevert?: (previous: PermissionModeId) => void
    ) => {
      const previousMode = permissionModeRef.current
      permissionModeRef.current = nextMode
      setPermissionModeState(nextMode)
      persistPermissionMode(nextMode)

      const sid = useAppStore.getState().activeSessionId
      if (!sid) return

      const revert = (message: string) => {
        permissionModeRef.current = previousMode
        setPermissionModeState(previousMode)
        persistPermissionMode(previousMode)
        onRevert?.(previousMode)
        toast.error(message)
      }

      void ipcClient.harness
        .setPermissionMode(sid, nextMode)
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
    activeSessionId,
    modelId: selectedModel.id,
    modelLabel: selectedModel.label,
    selectedModel,
    effort: effectiveEffort,
    effortLadder,
    deferredNotice,
    clearDeferredNotice: React.useCallback(() => setDeferredNotice(null), []),
    permissionMode,
    setModel,
    setEffort,
    setPermissionMode,
  }
}
