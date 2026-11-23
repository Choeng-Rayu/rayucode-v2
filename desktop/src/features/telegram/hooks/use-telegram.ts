import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  connectTelegramBotToken,
  disconnectTelegramBridge,
  resolveTelegramApproval,
  sendTelegramTestPing,
  setTelegramMode,
  setTelegramRemoteUninstall,
  telegramQueryKeys,
  telegramQueryOptions,
} from "../api/telegram-api"
import type {
  ConnectBotTokenInput,
  TelegramApprovalDecision,
  TelegramConnectionMode,
  TelegramState,
} from "../types"

export function useTelegramState() {
  return useQuery(telegramQueryOptions())
}

export function useSetTelegramMode() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (mode: TelegramConnectionMode) => setTelegramMode(mode),
    onMutate: async (mode) => {
      await queryClient.cancelQueries({ queryKey: telegramQueryKeys.state() })
      const previous = queryClient.getQueryData<TelegramState>(
        telegramQueryKeys.state()
      )
      if (previous) {
        queryClient.setQueryData<TelegramState>(telegramQueryKeys.state(), {
          ...previous,
          mode,
        })
      }
      return { previous }
    },
    onError: (_error, _mode, context) => {
      if (context?.previous) {
        queryClient.setQueryData(telegramQueryKeys.state(), context.previous)
      }
    },
    onSuccess: (result, _mode, context) => {
      if (!result.ok) {
        if (context?.previous) {
          queryClient.setQueryData(telegramQueryKeys.state(), context.previous)
        }
        return
      }
      queryClient.setQueryData<TelegramState>(
        telegramQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useConnectBotToken() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ConnectBotTokenInput) => connectTelegramBotToken(input),
    onSuccess: (result) => {
      if (!result.ok) return
      queryClient.setQueryData<TelegramState>(
        telegramQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useResolveTelegramApproval() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      approvalId,
      decision,
    }: {
      approvalId: string
      decision: TelegramApprovalDecision
    }) => resolveTelegramApproval(approvalId, decision),
    onMutate: async ({ approvalId, decision }) => {
      await queryClient.cancelQueries({ queryKey: telegramQueryKeys.state() })
      const previous = queryClient.getQueryData<TelegramState>(
        telegramQueryKeys.state()
      )
      if (previous) {
        queryClient.setQueryData<TelegramState>(telegramQueryKeys.state(), {
          ...previous,
          approvals: previous.approvals.map((item) =>
            item.id === approvalId ? { ...item, status: decision } : item
          ),
        })
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(telegramQueryKeys.state(), context.previous)
      }
    },
    onSuccess: (result, _variables, context) => {
      if (!result.ok) {
        if (context?.previous) {
          queryClient.setQueryData(telegramQueryKeys.state(), context.previous)
        }
        return
      }
      queryClient.setQueryData<TelegramState>(
        telegramQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useSetRemoteUninstall() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (enabled: boolean) => setTelegramRemoteUninstall(enabled),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: telegramQueryKeys.state() })
      const previous = queryClient.getQueryData<TelegramState>(
        telegramQueryKeys.state()
      )
      if (previous) {
        queryClient.setQueryData<TelegramState>(telegramQueryKeys.state(), {
          ...previous,
          remoteUninstallEnabled: enabled,
        })
      }
      return { previous }
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(telegramQueryKeys.state(), context.previous)
      }
    },
    onSuccess: (result, _enabled, context) => {
      if (!result.ok) {
        if (context?.previous) {
          queryClient.setQueryData(telegramQueryKeys.state(), context.previous)
        }
        return
      }
      queryClient.setQueryData<TelegramState>(
        telegramQueryKeys.state(),
        result.data
      )
    },
  })
}

export function useTelegramBridgeActions() {
  const queryClient = useQueryClient()
  const [isDisconnected, setIsDisconnected] = React.useState(false)

  const disconnect = React.useCallback(async () => {
    const result = await disconnectTelegramBridge()
    if (result.ok) {
      setIsDisconnected(true)
      queryClient.setQueryData<TelegramState>(
        telegramQueryKeys.state(),
        result.data
      )
    }
    return result
  }, [queryClient])

  const reconnect = React.useCallback(async () => {
    const result = await setTelegramMode("connected")
    if (result.ok) {
      setIsDisconnected(false)
      queryClient.setQueryData<TelegramState>(
        telegramQueryKeys.state(),
        result.data
      )
    }
    return result
  }, [queryClient])

  const regeneratePairing = React.useCallback(() => {
    const token = `rayu_${Math.random().toString(36).slice(2, 10)}`
    queryClient.setQueryData<TelegramState>(
      telegramQueryKeys.state(),
      (prev) => {
        if (!prev) return prev
        const botHandle = prev.connectedBotHandle.replace(/^@/, "") || "RayuCodeBot"
        return {
          ...prev,
          pairingCommand: `/pair ${token}`,
          pairingLink: `https://t.me/${botHandle}?start=${token}`,
        }
      }
    )
    return token
  }, [queryClient])

  const attachSession = React.useCallback(
    (sessionLabel: string) => {
      queryClient.setQueryData<TelegramState>(
        telegramQueryKeys.state(),
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            drivingSession: sessionLabel,
          }
        }
      )
    },
    [queryClient]
  )

  const ping = React.useCallback(async () => {
    return sendTelegramTestPing()
  }, [])

  return {
    isDisconnected,
    setIsDisconnected,
    disconnect,
    reconnect,
    regeneratePairing,
    attachSession,
    ping,
  }
}
