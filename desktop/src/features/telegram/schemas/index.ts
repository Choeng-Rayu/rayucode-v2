import { z } from "zod"

import type { TelegramCommandItem } from "../types"

export const BOT_TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/
export const CHAT_ID_PATTERN = /^-?\d{5,20}$/

export const telegramConnectionModeSchema = z.enum([
  "connected",
  "hosted",
  "byo",
])

export const telegramApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
])

export const telegramApprovalDecisionSchema = z.enum(["approved", "denied"])

export const telegramApprovalItemSchema = z.object({
  id: z.string().min(1),
  toolBadge: z.string().min(1),
  commandOrSummary: z.string().min(1),
  requestedBy: z.string().min(1),
  timeAgo: z.string().min(1),
  status: telegramApprovalStatusSchema,
})

export const telegramCommandItemSchema = z.object({
  command: z.string().min(1),
  description: z.string().min(1),
})

export const telegramStateSchema = z.object({
  mode: telegramConnectionModeSchema,
  connectedBotHandle: z.string().min(1),
  chatId: z.string().min(1),
  drivingSession: z.string().min(1),
  mediaDelivery: z.string().min(1),
  authPath: z.string().min(1),
  pairingCommand: z.string().min(1),
  pairingLink: z.string().min(1),
  remoteUninstallEnabled: z.boolean(),
  approvals: z.array(telegramApprovalItemSchema),
  commands: z.array(telegramCommandItemSchema),
})

export const connectBotTokenInputSchema = z.object({
  botToken: z
    .string()
    .trim()
    .min(1, "Paste your @BotFather token")
    .regex(
      BOT_TOKEN_PATTERN,
      "Enter a valid @BotFather token (format: 123456789:AAF...)"
    ),
  allowedChatId: z
    .string()
    .trim()
    .min(1, "Enter an allowed Telegram chat ID")
    .regex(
      CHAT_ID_PATTERN,
      "Allowed chat ID must be a numeric Telegram ID (e.g. 842910443)"
    ),
})

export type ValidatedConnectBotTokenInput = z.infer<
  typeof connectBotTokenInputSchema
>

export const SUPPLEMENTAL_TELEGRAM_COMMANDS: readonly TelegramCommandItem[] = [
  {
    command: "/status",
    description: "Inspect active session, model route, and bridge latency",
  },
  {
    command: "/approve",
    description: "Approve the latest pending tool or plan request",
  },
  {
    command: "/deny",
    description: "Deny the latest pending tool or plan request",
  },
  {
    command: "/swarm",
    description: "List active swarm workers and message board updates",
  },
  {
    command: "/diff",
    description: "Summarize uncommitted workspace file changes",
  },
  {
    command: "/cancel",
    description: "Cancel the currently streaming agent turn",
  },
  {
    command: "/uninstall-remote",
    description: "Teardown remote bridge (guarded by Safety toggle)",
  },
] as const
