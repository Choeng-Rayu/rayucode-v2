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

function normalizeModelKey(id: string): string {
  return id.trim().replace(/^rayu:/i, "").toLowerCase()
}

function findModelOption(
  models: readonly ModelOption[],
  modelId?: string | null,
  provider?: string | null
): ModelOption | undefined {
  const raw = modelId?.trim()
  if (!raw) return undefined
  const prov = provider?.trim().toLowerCase()
  const normalized = normalizeModelKey(raw)
  if (prov === "rayu") {
    const rayuPrefixed = raw.toLowerCase().startsWith("rayu:")
      ? raw
      : `rayu:${raw}`
    const rayuMatch = models.find(
      (m) =>
        m.id === rayuPrefixed ||
        (m.provider.toLowerCase() === "rayu" &&
          normalizeModelKey(m.id) === normalized)
    )
    if (rayuMatch) return rayuMatch
  }
  const exact = models.find((m) => m.id === raw)
  if (exact) return exact
  return models.find(
    (m) =>
      normalizeModelKey(m.id) === normalized ||
      m.label.trim().toLowerCase() === raw.toLowerCase()
  )
}

export function useSessions() {
  return useQuery(sessionsQueryOptions())
}

export function useModelCatalog() {
  const queryClient = useQueryClient()
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const query = useQuery(modelsQueryOptions(activeSessionId))

  const refreshMutation = useMutation({
    mutationFn: () => refreshModelsCatalog(activeSessionId),
    onSuccess: (models) => {
      queryClient.setQueryData(sessionsQueryKeys.models(activeSessionId), models)
      if (activeSessionId) {
        queryClient.setQueryData(sessionsQueryKeys.models(), models)
      }
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
      void queryClient.invalidateQueries({
        queryKey: ["models"],
      })
    },
  })
}

export function usePersistedInferenceSettings(models: readonly ModelOption[]) {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessionModelInfo = useAppStore((s) =>
    s.activeSessionId ? s.sessionModelInfoBySession[s.activeSessionId] : undefined
  )
  const [localModelId, setLocalModelId] = React.useState<string>(readStoredModelId)
  const [localEffort, setLocalEffort] =
    React.useState<ReasoningEffort>(readStoredEffort)
  const [permissionMode, setPermissionModeState] =
    React.useState<PermissionModeId>(readStoredPermissionMode)
  const [deferredNoticeState, setDeferredNoticeState] = React.useState<{
    sessionId: string | null
    text: string
  } | null>(null)

  const sessionModel = sessionModelInfo?.model
  const sessionProvider = sessionModelInfo?.provider
  const selectedModel = React.useMemo<ModelOption>(() => {
    const fromSession = sessionModel
      ? findModelOption(models, sessionModel, sessionProvider)
      : undefined
    if (fromSession) return fromSession

    const fromLocal = findModelOption(models, localModelId)
    if (fromLocal) return fromLocal

    if (models[0]) return models[0]

    const fallbackId = sessionModel || localModelId || DEFAULT_MODEL_ID
    return {
      id: fallbackId,
      label:
        fallbackId && fallbackId !== DEFAULT_MODEL_ID
          ? fallbackId
          : DEFAULT_MODEL_LABEL,
      provider: sessionProvider || "rayu",
    }
  }, [localModelId, models, sessionModel, sessionProvider])

  const effortLadder = React.useMemo(
    () => resolveEffortLadder(selectedModel),
    [selectedModel]
  )

  const rawEffort = React.useMemo<ReasoningEffort>(() => {
    if (sessionModelInfo) {
      const sessionEffort =
        sessionModelInfo.reasoningEffort?.trim().toLowerCase() ?? ""
      return sessionEffort && sessionEffort !== "auto" ? sessionEffort : ""
    }
    return localEffort
  }, [localEffort, sessionModelInfo])

  const effectiveEffort = React.useMemo<ReasoningEffort>(() => {
    if (!effortLadder.supported) return ""
    const normalized = rawEffort.trim().toLowerCase()
    const match = effortLadder.stops.find((s) => s.toLowerCase() === normalized)
    return match ?? effortLadder.defaultStop ?? ""
  }, [effortLadder, rawEffort])

  const deferredNotice =
    deferredNoticeState && deferredNoticeState.sessionId === activeSessionId
      ? deferredNoticeState.text
      : null

  const modelIdRef = React.useRef<string>(selectedModel.id)
  const effortRef = React.useRef<ReasoningEffort>(effectiveEffort)
  const modelsRef = React.useRef<readonly ModelOption[]>(models)

  React.useEffect(() => {
    modelIdRef.current = selectedModel.id
  }, [selectedModel.id])

  React.useEffect(() => {
    effortRef.current = effectiveEffort
  }, [effectiveEffort])

  React.useEffect(() => {
    modelsRef.current = models
  }, [models])

  // Reconcile live active model & effort whenever daemon emits `model_info`.
  // Note: Rust `ApiEvent::ModelInfo` omits `reasoning_effort` when cleared
  // (`skip_serializing_if = "Option::is_none"`), so absent effort overwrites
  // (clears) any stale effort rather than preserving the prior value.
  React.useEffect(() => {
    return ipcClient.harness.onEvent((frame) => {
      if (frame.ev !== "model_info") return
      const sid = useAppStore.getState().activeSessionId
      const frameSid =
        typeof frame.session_id === "string" ? frame.session_id : ""
      if (sid && frameSid && frameSid !== sid) return

      const rawModel = typeof frame.model === "string" ? frame.model : ""
      const rawProvider =
        typeof frame.provider === "string" ? frame.provider : undefined
      const rawEffortFrame =
        typeof frame.reasoning_effort === "string"
          ? frame.reasoning_effort.trim().toLowerCase()
          : ""
      const cleanEffort =
        rawEffortFrame && rawEffortFrame !== "auto"
          ? rawEffortFrame
          : undefined

      const targetSid = frameSid || sid
      if (targetSid) {
        useAppStore.getState().setSessionModelInfo(targetSid, {
          model: rawModel || undefined,
          provider: rawProvider,
          reasoningEffort: cleanEffort,
        })
      }

      if (rawModel) {
        const matched = findModelOption(modelsRef.current, rawModel, rawProvider)
        if (matched) {
          setLocalModelId(matched.id)
        }
      }
      setLocalEffort(cleanEffort ?? "")
      setDeferredNoticeState(null)
    })
  }, [])

  const setModel = React.useCallback((model: ModelOption) => {
    const previousModelId = modelIdRef.current
    const previousEffort = effortRef.current
    setLocalModelId(model.id)
    setDeferredNoticeState(null)

    const nextLadder = resolveEffortLadder(model)
    let reconciledEffort = ""
    if (!nextLadder.supported) {
      setLocalEffort("")
      persistEffort("")
    } else {
      const currentLower = effortRef.current.trim().toLowerCase()
      const validStop = nextLadder.stops.find(
        (s) => s.toLowerCase() === currentLower
      )
      reconciledEffort = validStop ?? nextLadder.defaultStop ?? ""
      setLocalEffort(reconciledEffort)
      persistEffort(reconciledEffort)
    }

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MODEL_ID_STORAGE_KEY, model.id)
      } catch {
        // ignore storage errors
      }
    }

    const sid = useAppStore.getState().activeSessionId
    const previousSessionInfo = sid
      ? useAppStore.getState().sessionModelInfoBySession[sid]
      : undefined
    if (sid) {
      useAppStore.getState().setSessionModelInfo(sid, {
        provider: model.provider,
        model: model.id,
        reasoningEffort: reconciledEffort || undefined,
      })
    }

    const spec = formatHarnessModelSpec(model.id, model.provider, model.apiMethod)
    if (sid && !sid.startsWith("ses_") && spec) {
      const revertModel = () => {
        setLocalModelId(previousModelId)
        setLocalEffort(previousEffort)
        persistEffort(previousEffort)
        useAppStore.getState().setSessionModelInfo(sid, {
          provider: previousSessionInfo?.provider,
          model: previousSessionInfo?.model ?? previousModelId,
          reasoningEffort:
            previousSessionInfo?.reasoningEffort ??
            (previousEffort || undefined),
        })
      }

      void ipcClient.harness
        .setModel(sid, spec)
        .then((res) => {
          if (!res || res.ok) {
            setDeferredNoticeState(null)
            return
          }
          if (res.code === "busy") {
            setDeferredNoticeState({
              sessionId: sid,
              text: "Applies on next turn",
            })
            return
          }
          revertModel()
          toast.error(res.error ?? `Failed to switch model to ${model.label}`)
        })
        .catch((error: unknown) => {
          revertModel()
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
    setLocalEffort(normalized)
    persistEffort(normalized)
    setDeferredNoticeState(null)

    const sid = useAppStore.getState().activeSessionId
    const previousSessionInfo = sid
      ? useAppStore.getState().sessionModelInfoBySession[sid]
      : undefined
    if (sid) {
      useAppStore.getState().setSessionModelInfo(sid, {
        ...previousSessionInfo,
        reasoningEffort: normalized,
      })
    }

    if (sid && !sid.startsWith("ses_")) {
      const revertEffort = () => {
        setLocalEffort(previousEffort)
        persistEffort(previousEffort)
        useAppStore.getState().setSessionModelInfo(sid, {
          ...previousSessionInfo,
          reasoningEffort:
            previousSessionInfo?.reasoningEffort ??
            (previousEffort || undefined),
        })
      }

      void ipcClient.harness
        .setReasoningEffort(sid, normalized)
        .then((res) => {
          if (!res || res.ok) {
            setDeferredNoticeState(null)
            return
          }
          if (res.code === "busy") {
            setDeferredNoticeState({
              sessionId: sid,
              text: "Applies on next turn",
            })
            return
          }
          revertEffort()
          toast.error(res.error ?? `Failed to set reasoning effort to ${normalized}`)
        })
        .catch((error: unknown) => {
          revertEffort()
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
    clearDeferredNotice: React.useCallback(
      () => setDeferredNoticeState(null),
      []
    ),
    permissionMode,
    setModel,
    setEffort,
    setPermissionMode,
  }
}
