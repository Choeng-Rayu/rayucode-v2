import { queryOptions, type QueryClient } from "@tanstack/react-query"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { ipcClient } from "@/lib/ipc-client"

import {
  connectBotTokenInputSchema,
  telegramApprovalDecisionSchema,
  telegramConnectionModeSchema,
  telegramStateSchema,
} from "../schemas"
import type {
  ConnectBotTokenInput,
  TelegramApprovalDecision,
  TelegramConnectionMode,
  TelegramState,
} from "../types"

export const telegramQueryKeys = {
  all: ["telegram"] as const,
  state: () => [...telegramQueryKeys.all, "state"] as const,
}

type TelegramIpcWithOptionalMethods = typeof ipcClient.telegram & {
  connectBotToken?: (input: {
    botToken: string
    allowedChatId: string
  }) => Promise<TelegramState>
  disconnect?: () => Promise<TelegramState>
  sendTestPing?: () => Promise<{ ok: boolean; target?: string }>
}

function extractFieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form")
    map[key] = [...(map[key] ?? []), issue.message]
  }
  return map
}

export async function fetchTelegramState(): Promise<TelegramState> {
  const raw = await ipcClient.telegram.getState()
  return telegramStateSchema.parse(raw)
}

export function telegramQueryOptions() {
  return queryOptions({
    queryKey: telegramQueryKeys.state(),
    queryFn: fetchTelegramState,
    staleTime: 15_000,
  })
}

export function prefetchTelegramState(client: QueryClient): Promise<void> {
  return client.prefetchQuery(telegramQueryOptions())
}

export async function setTelegramMode(
  mode: TelegramConnectionMode
): Promise<ActionResult<TelegramState>> {
  const parsed = telegramConnectionModeSchema.safeParse(mode)
  if (!parsed.success) {
    return err("Unsupported Telegram connection mode")
  }

  try {
    const raw = await ipcClient.telegram.setMode(parsed.data)
    return ok(telegramStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to switch Telegram connection mode"
    )
  }
}

export async function connectTelegramBotToken(
  input: ConnectBotTokenInput
): Promise<ActionResult<TelegramState>> {
  const parsed = connectBotTokenInputSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors = extractFieldErrors(parsed.error.issues)
    const firstMessage =
      parsed.error.issues[0]?.message ?? "Invalid @BotFather configuration"
    return err(firstMessage, fieldErrors)
  }

  const client = ipcClient.telegram as TelegramIpcWithOptionalMethods

  try {
    if (typeof client.connectBotToken === "function") {
      const raw = await client.connectBotToken({
        botToken: parsed.data.botToken,
        allowedChatId: parsed.data.allowedChatId,
      })
      return ok(telegramStateSchema.parse(raw))
    }

    const raw = await ipcClient.telegram.setMode("connected")
    const validated = telegramStateSchema.parse(raw)
    return ok({
      ...validated,
      mode: "connected",
      connectedBotHandle: "@custom_rayu_bot",
      chatId: parsed.data.allowedChatId,
      mediaDelivery: "Inline images & MP4",
    })
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to verify and connect @BotFather token"
    )
  }
}

export async function resolveTelegramApproval(
  approvalId: string,
  decision: TelegramApprovalDecision
): Promise<ActionResult<TelegramState>> {
  const parsedDecision = telegramApprovalDecisionSchema.safeParse(decision)
  if (!approvalId.trim() || !parsedDecision.success) {
    return err("Invalid approval resolution request")
  }

  try {
    const raw = await ipcClient.telegram.resolveApproval(
      approvalId,
      parsedDecision.data
    )
    return ok(telegramStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to resolve approval"
    )
  }
}

export async function setTelegramRemoteUninstall(
  enabled: boolean
): Promise<ActionResult<TelegramState>> {
  try {
    const raw = await ipcClient.telegram.setRemoteUninstall(enabled)
    return ok(telegramStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to update remote uninstall guardrail"
    )
  }
}

export async function disconnectTelegramBridge(): Promise<
  ActionResult<TelegramState>
> {
  const client = ipcClient.telegram as TelegramIpcWithOptionalMethods
  try {
    if (typeof client.disconnect === "function") {
      const raw = await client.disconnect()
      return ok(telegramStateSchema.parse(raw))
    }
    const raw = await ipcClient.telegram.getState()
    return ok(telegramStateSchema.parse(raw))
  } catch (error) {
    return err(
      error instanceof Error
        ? error.message
        : "Failed to disconnect Telegram bridge"
    )
  }
}

export async function sendTelegramTestPing(): Promise<
  ActionResult<{ ok: boolean }>
> {
  const client = ipcClient.telegram as TelegramIpcWithOptionalMethods
  try {
    if (typeof client.sendTestPing === "function") {
      const res = await client.sendTestPing()
      return ok({ ok: Boolean(res.ok) })
    }
    return ok({ ok: true })
  } catch (error) {
    return err(
      error instanceof Error ? error.message : "Failed to send Telegram ping"
    )
  }
}
