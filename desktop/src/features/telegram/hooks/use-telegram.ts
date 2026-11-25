import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  connectTelegramBotToken,
  disconnectTelegramBridge,
  resolveTelegramApproval,
  selectTelegramSession,
  sendTelegramTestPing,
  setTelegramMode,
  setTelegramRemoteUninstall,
  startHostedTelegramPairing,
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
  return useQuery({
    ...telegramQueryOptions(),
    refetchInterval: (query) => {
      const state = query.state.data
      if (!state) return false
      if (!state.linked && Boolean(state.qrPath || state.pairingLink)) {
        return 2_000
      }
      if (state.linked) {
        return 5_000
      }
      return false
    },
  })
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

export function useStartHostedPairing() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (replaceExisting: boolean = false) =>
      startHostedTelegramPairing(replaceExisting),
    onSuccess: (result) => {
      if (!result.ok) return
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

export function useSelectTelegramSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: string) => selectTelegramSession(sessionId),
    onSuccess: (result) => {
      if (!result.ok) return
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

  const disconnect = React.useCallback(
    async (localOnly = false) => {
      const result = await disconnectTelegramBridge(localOnly)
      if (result.ok) {
        setIsDisconnected(true)
        queryClient.setQueryData<TelegramState>(
          telegramQueryKeys.state(),
          result.data
        )
      }
      return result
    },
    [queryClient]
  )

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

  const ping = React.useCallback(async () => {
    return sendTelegramTestPing()
  }, [])

  return {
    isDisconnected,
    setIsDisconnected,
    disconnect,
    reconnect,
    ping,
  }
}
