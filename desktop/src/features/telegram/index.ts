export {
  TelegramView,
  type TelegramViewProps,
} from "./components/telegram-view"

export {
  useConnectBotToken,
  useResolveTelegramApproval,
  useSelectTelegramSession,
  useSetRemoteUninstall,
  useSetTelegramMode,
  useStartHostedPairing,
  useTelegramBridgeActions,
  useTelegramState,
} from "./hooks/use-telegram"

export {
  connectTelegramBotToken,
  disconnectTelegramBridge,
  fetchTelegramState,
  prefetchTelegramState,
  resolveTelegramApproval,
  selectTelegramSession,
  sendTelegramTestPing,
  setTelegramMode,
  setTelegramRemoteUninstall,
  startHostedTelegramPairing,
  telegramQueryKeys,
  telegramQueryOptions,
} from "./api/telegram-api"

export {
  BOT_TOKEN_PATTERN,
  CHAT_ID_PATTERN,
  SUPPLEMENTAL_TELEGRAM_COMMANDS,
  connectBotTokenInputSchema,
  telegramApprovalDecisionSchema,
  telegramApprovalItemSchema,
  telegramApprovalStatusSchema,
  telegramCommandItemSchema,
  telegramConnectionModeSchema,
  telegramStateSchema,
  type ValidatedConnectBotTokenInput,
} from "./schemas"

export type {
  ConnectBotTokenInput,
  TelegramApprovalDecision,
  TelegramApprovalItem,
  TelegramApprovalStatus,
  TelegramCommandItem,
  TelegramConnectionMode,
  TelegramState,
} from "./types"
