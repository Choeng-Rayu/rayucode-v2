import type { TelegramApprovalItem, TelegramState } from "@/lib/ipc-client"

export type { TelegramApprovalItem, TelegramState }

export type TelegramConnectionMode = TelegramState["mode"]

export type TelegramApprovalStatus = TelegramApprovalItem["status"]

export type TelegramApprovalDecision = "approved" | "denied"

export type TelegramCommandItem = TelegramState["commands"][number]

export interface ConnectBotTokenInput {
  botToken: string
  allowedChatId?: string
  replaceExisting?: boolean
}
