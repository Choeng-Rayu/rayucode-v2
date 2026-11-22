import { queryOptions } from "@tanstack/react-query"
import { z } from "zod"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  FALLBACK_MODELS,
  FALLBACK_PERMISSION_MODES,
} from "../constants/models"
import {
  createSessionInputSchema,
  modelOptionSchema,
  permissionModeOptionSchema,
  sessionSummarySchema,
} from "../schemas"
import type {
  CreateSessionInput,
  ModelOption,
  PermissionModeOption,
  SessionSummary,
} from "../types"

export const sessionsQueryKeys = {
  all: ["sessions"] as const,
  list: () => [...sessionsQueryKeys.all, "list"] as const,
  models: () => ["models", "catalog"] as const,
  permissionModes: () => [...sessionsQueryKeys.all, "permission-modes"] as const,
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const raw = await ipcClient.sessions.list()
  return z.array(sessionSummarySchema).parse(raw)
}

export async function fetchModels(): Promise<ModelOption[]> {
  try {
    const raw = await ipcClient.models.list()
    const parsed = z.array(modelOptionSchema).parse(raw)
    return parsed.length > 0 ? parsed : [...FALLBACK_MODELS]
  } catch {
    return [...FALLBACK_MODELS]
  }
}

export async function refreshModelsCatalog(): Promise<ModelOption[]> {
  const raw = await ipcClient.models.refresh()
  const parsed = z.array(modelOptionSchema).parse(raw)
  if (parsed.length === 0) {
    throw new Error("Empty model catalog response")
  }
  return parsed
}

export async function fetchPermissionModes(): Promise<PermissionModeOption[]> {
  try {
    const raw = await ipcClient.sessions.listPermissionModes()
    const parsed = z.array(permissionModeOptionSchema).parse(raw)
    return parsed.length > 0 ? parsed : [...FALLBACK_PERMISSION_MODES]
  } catch {
    return [...FALLBACK_PERMISSION_MODES]
  }
}

export async function createSession(
  input: CreateSessionInput
): Promise<ActionResult<SessionSummary>> {
  const parsed = createSessionInputSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return err(firstIssue?.message ?? "Invalid session input")
  }

  try {
    const created = await ipcClient.sessions.createSession(parsed.data)
    const validated = sessionSummarySchema.parse(created)
    return ok(validated)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create session"
    return err(message)
  }
}

export function sessionsQueryOptions() {
  return queryOptions({
    queryKey: sessionsQueryKeys.list(),
    queryFn: fetchSessions,
    staleTime: 30_000,
  })
}

export function modelsQueryOptions() {
  return queryOptions({
    queryKey: sessionsQueryKeys.models(),
    queryFn: fetchModels,
    staleTime: 60_000,
    placeholderData: [...FALLBACK_MODELS],
  })
}

export function permissionModesQueryOptions() {
  return queryOptions({
    queryKey: sessionsQueryKeys.permissionModes(),
    queryFn: fetchPermissionModes,
    staleTime: 300_000,
    placeholderData: [...FALLBACK_PERMISSION_MODES],
  })
}
